/* train.js — the headless trainer. Same code the browser plays back, many more
 * cores.
 *
 *   node train.js --gens 500 --pop 160 --workers 6
 *   node train.js --gens 4000 --pop 384 --bank 8 --workers 60      (big box)
 *   node train.js --stage 0 --gens 200                             (lock a stage)
 *   node train.js --resume training/checkpoint.json --gens 1000
 *   node train.js --bake training/checkpoint.json                  → default_brain.js
 *   node train.js --pilot                                          (rule the ruler)
 *
 * HOW THE WORK IS SPLIT, and why it is not the obvious way. The successive-
 * halving race needs a GLOBAL ranking after every round, so the naive
 * arrangement — deal each round's survivors across the pool — re-ships brain
 * weights on every round. At 23,000 weights a brain that is about 93 KB, and
 * over five rounds it adds up to tens of megabytes of copying per generation
 * for episodes that take fifty milliseconds.
 *
 * So each brain is sent to exactly ONE worker, once, at the start of the
 * generation, and stays there. Only the ALIVE LIST and the resulting scores
 * cross the boundary after that — a few hundred bytes per round. Workers end up
 * unevenly loaded once the cuts bite, which is fine: round 0 is every brain and
 * dominates the cost, and by round 3 there is not enough work left for the
 * imbalance to matter.
 *
 * BE A GOOD NEIGHBOUR. The default worker count deliberately leaves cores free.
 * On a shared machine, pass --workers explicitly rather than letting this take
 * everything; a trainer that saturates a box gets itself killed.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const SIM_FILES = ["nn.js", "orbit.js", "craft.js", "station.js", "sensors.js",
    "scenarios.js", "pilot.js", "world.js", "evolution.js"];

function loadSim() {
    for (const f of SIM_FILES) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    }
}

/* Brains cross the thread boundary as raw Float32Arrays inside a plain object.
 * Structured clone copies typed arrays by memcpy; Brain.toJSON() would turn
 * 23,000 floats into half a megabyte of decimal text per brain. */
function packBrain(b) {
    const p = (st) => ({ sizes: st.sizes, scales: st.scales.slice(), weights: st.weights.map(w => new Float32Array(w)) });
    return { spec: b.spec, trunk: p(b.trunk), guid: p(b.guid), ctrl: p(b.ctrl) };
}
function unpackBrain(o) {
    const b = new Brain(o.spec, null);
    for (const k of ["trunk", "guid", "ctrl"]) {
        for (let l = 0; l < b[k].weights.length; l++) {
            b[k].weights[l].set(o[k].weights[l]);
            b[k].scales[l] = o[k].scales[l];
        }
    }
    return b;
}

/* A bank entry travels as (stage, seed) plus its two calibration scalars —
 * makeScenario is a pure function of the first two, so the worker rebuilds the
 * scenario itself and nothing large is ever sent. */
function hydrate(entry) {
    const sc = makeScenario(entry.stage, entry.seed);
    sc.sNull = entry.sNull; sc.sPilot = entry.sPilot;
    // nullBest is not optional bookkeeping — score() measures the whole
    // progress term from it, so a worker that rebuilt the scenario without it
    // would grade its brains on a different scale from every other worker.
    sc.nullBest = entry.nullBest;
    sc.pilotDocked = entry.pilotDocked; sc.usable = entry.usable;
    return sc;
}

/* ------------------------------------------------------------------ worker */
if (!isMainThread) {
    loadSim();
    let mine = [];        // Brain[] owned this generation
    let bank = [];        // hydrated scenarios

    parentPort.on("message", (msg) => {
        if (msg.stop) { process.exit(0); return; }

        if (msg.calibrate) {
            const out = msg.calibrate.map(j => {
                const sc = makeScenario(j.stage, j.seed);
                calibrate(sc);
                return {
                    stage: j.stage, seed: j.seed, sNull: sc.sNull, sPilot: sc.sPilot,
                    nullBest: sc.nullBest, pilotDocked: sc.pilotDocked, usable: sc.usable,
                    pilotDv: sc.pilotDv, pilotT: sc.pilotT, R0: sc.R0
                };
            });
            parentPort.postMessage({ tag: msg.tag, calibrated: out });
            return;
        }

        if (msg.setGen) {
            mine = msg.brains.map(unpackBrain);
            bank = msg.bank.map(hydrate);
            parentPort.postMessage({ tag: msg.tag, ready: true });
            return;
        }

        if (msg.round != null) {
            const sc = bank[msg.round];
            const out = msg.alive.map(i => {
                const r = runEpisode(sc, mine[i], { noiseSeed: msg.noiseSeed });
                return {
                    i, adv: r.advantage, docked: r.docked, contact: r.contact,
                    outcome: r.outcome, best: r.bestRange, dv: r.dv, t: r.t,
                    coasts: r.coasts, coastTotal: r.coastTotal
                };
            });
            parentPort.postMessage({ tag: msg.tag, results: out });
            return;
        }

        /* The held-out exam. Candidate brains arrive with the message rather
         * than being drawn from `mine` — the champion lives on the main thread
         * and is usually not a member of the current population at all. */
        if (msg.exam) {
            const nets = msg.nets.map(unpackBrain);
            const scs = msg.bank.map(hydrate);
            const out = msg.jobs.map(j => {
                const r = runEpisode(scs[j.s], nets[j.n], { noiseSeed: 5000 + j.s * 17 });
                return {
                    n: j.n, s: j.s, stage: scs[j.s].stage, adv: r.advantage,
                    docked: r.docked, contact: r.contact, dv: r.dv, t: r.t,
                    best: r.bestRange, outcome: r.outcome
                };
            });
            parentPort.postMessage({ tag: msg.tag, exam: out });
            return;
        }
    });
    return;
}

/* -------------------------------------------------------------------- main */
loadSim();

const argv = process.argv.slice(2);
function arg(name, dflt) {
    const i = argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
const CFG = {
    gens: parseInt(arg("gens", 400), 10),
    pop: parseInt(arg("pop", 160), 10),
    bank: parseInt(arg("bank", 6), 10),
    workers: parseInt(arg("workers", Math.max(1, Math.min(6, os.cpus().length - 2))), 10),
    mutRate: parseFloat(arg("mutrate", 0.12)),
    mutSigma: parseFloat(arg("mutsigma", 0.55)),
    grace: parseInt(arg("grace", 4), 10),
    seed: parseInt(arg("seed", (Date.now() % 1e9) | 0), 10),
    out: String(arg("out", "training")),
    resume: arg("resume", null),
    every: parseInt(arg("every", 10), 10),
    stageLock: arg("stage", null) === null ? -1 : parseInt(arg("stage", -1), 10),
    // How many consecutive generations share one scenario bank. With a fresh
    // bank every generation the score is dominated by which scenarios were
    // drawn, and the champion is whoever was lucky; holding it for a block lets
    // selection see the brain instead of the calendar.
    block: parseInt(arg("block", 2), 10),
    race: arg("norace", null) === null,
    islands: arg("noislands", null) === null,
    examSeeds: parseInt(arg("examseeds", 3), 10),
    promote: parseFloat(arg("promote", 0.50)),
    anchor: parseFloat(arg("anchor", 0.75))
};

const NIN_ = NIN;
const SPEC = netSpec(NIN_);

/* --------------------------------------------------------------- brainfile */
function saveBrain(file, extra, brain) {
    fs.writeFileSync(file, JSON.stringify(Object.assign({
        format: "dock-brain-v1", nin: NIN_, net: brain.toJSON()
    }, extra)));
}
function loadBrain(file) {
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    const net = o.net || o;
    if (net.spec && net.spec.nin !== NIN_) {
        console.error(`brain is ${net.spec.nin} inputs, this build is ${NIN_} — refusing to load`);
        process.exit(1);
    }
    return { file: o, brain: Brain.fromJSON(net).calibrate() };
}

/* ------------------------------------------------------------------- bake */
if (arg("bake", null)) {
    const src = loadBrain(String(arg("bake")));
    const body = "/* default_brain.js — generated by train.js. Drop-in champion.\n" +
        ` * generation ${src.file.gen || "?"} · stage ${src.file.stage != null ? src.file.stage : "?"}` +
        ` · exam advantage ${src.file.exam != null ? Number(src.file.exam).toFixed(3) : "?"}` +
        ` · dock rate ${src.file.dockRate != null ? (src.file.dockRate * 100).toFixed(0) + "%" : "?"} */\n` +
        "window.DEFAULT_BRAIN = " + JSON.stringify({
            format: "dock-brain-v1", nin: NIN_,
            gen: src.file.gen, stage: src.file.stage,
            exam: src.file.exam, dockRate: src.file.dockRate,
            byStage: src.file.byStage,
            net: src.brain.toJSON()
        }) + ";\n";
    fs.writeFileSync(path.join(__dirname, "default_brain.js"), body);
    console.log(`wrote default_brain.js (${src.brain.weightCount()} weights)`);
    process.exit(0);
}

/* ------------------------------------------------ the ruler, on its own */
if (arg("pilot", null)) {
    const top = CFG.stageLock >= 0 ? CFG.stageLock : N_STAGES - 1;
    for (let st = 0; st <= top; st++) {
        let dock = 0, dv = 0, tt = 0, n = 8;
        for (let s = 0; s < n; s++) {
            const sc = makeScenario(st, 200 + s);
            const r = runEpisode(sc, new Pilot(sc, new Station(sc.station)), { noise: false });
            dock += r.docked; dv += r.dv; tt += r.t;
        }
        console.log(`stage ${st} ${STAGES[st].label.padEnd(16)} autopilot docks ${dock}/${n}  ` +
            `mean Δv ${(dv / n).toFixed(1)} m/s  mean ${(tt / n / 60).toFixed(1)} min`);
    }
    process.exit(0);
}

if (!fs.existsSync(path.join(__dirname, CFG.out))) {
    fs.mkdirSync(path.join(__dirname, CFG.out), { recursive: true });
}

const evo = new Evolution(CFG.pop, CFG.seed, NIN_);
let resumeBrain = null;
evo.islands = false;
let stageState = { stage: 0, run: 0 };
let startGen = 1;
if (CFG.resume) {
    const src = loadBrain(String(CFG.resume));
    evo.seedFrom(src.brain, CFG.mutRate, CFG.mutSigma);
    resumeBrain = src.brain;   // becomes the starting champion below
    evo.history = src.file.history || [];
    evo.gen = (src.file.gen || 1) + 1;
    startGen = evo.gen;
    if (src.file.stage != null && CFG.stageLock < 0) stageState.stage = src.file.stage;
    console.log(`resumed from ${CFG.resume} at generation ${src.file.gen} (stage ${stageState.stage})`);
}

/* ------------------------------------------------------------------ pool */
const workers = [];
for (let i = 0; i < CFG.workers; i++) workers.push(new Worker(__filename));
let tagSeq = 0;
function ask(w, msg) {
    return new Promise(res => {
        const tag = ++tagSeq;
        const on = (m) => { if (m.tag !== tag) return; w.off("message", on); res(m); };
        w.on("message", on);
        w.postMessage(Object.assign({ tag }, msg));
    });
}
function askAll(msgs) { return Promise.all(msgs.map(([w, m]) => ask(w, m))); }

/* ------------------------------------------------------ bank calibration */
/* Every scenario is auditioned before the population ever sees it. Rejected
 * draws are replaced and re-auditioned, up to six attempts; the trainer logs
 * how many draws a bank cost, because a stage whose rejection rate climbs is a
 * stage whose settings have drifted past what the vehicle can fly. */
async function makeBank(topStage, size, block) {
    const wanted = buildBank(topStage, size, block).map(s => ({ stage: s.stage, seed: s.seed }));
    const out = new Array(wanted.length);
    let draws = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
        const todo = [];
        for (let i = 0; i < wanted.length; i++) if (!out[i]) todo.push({ i, ...wanted[i] });
        if (!todo.length) break;
        draws += todo.length;
        const per = Math.ceil(todo.length / workers.length);
        const parts = await askAll(workers.map((w, k) => {
            const mine = todo.slice(k * per, (k + 1) * per);
            return [w, { calibrate: mine.map(j => ({ stage: j.stage, seed: j.seed })) }];
        }).filter(([, m]) => m.calibrate.length));
        const flat = parts.flatMap(p => p.calibrated);
        let fi = 0;
        for (const j of todo) {
            const c = flat[fi++];
            if (c && c.usable) out[j.i] = c;
            else wanted[j.i] = { stage: j.stage, seed: j.seed + 7717 * (attempt + 1) };
        }
    }
    // Anything still unusable after six attempts goes in anyway — a slightly
    // odd scenario is far less damaging than a bank that is one entry short and
    // therefore not the same shape as the generation before it.
    for (let i = 0; i < out.length; i++) {
        if (!out[i]) {
            const sc = makeScenario(wanted[i].stage, wanted[i].seed);
            calibrate(sc);
            out[i] = {
                stage: sc.stage, seed: sc.seed, sNull: sc.sNull, sPilot: sc.sPilot,
                pilotDocked: sc.pilotDocked, usable: false, R0: sc.R0
            };
        }
    }
    return { bank: out, draws };
}

/* ------------------------------------------------------------- the race */
/* Deal the population across the workers once, then run the rounds. */
async function evaluate(bank, noiseSeed, protectedIdx) {
    const n = evo.brains.length;
    // Worker k owns population indices [k·per, k·per+per). `per` is a ceiling,
    // so every index maps to exactly one worker and the arithmetic inverts
    // without a lookup table.
    const per = Math.ceil(n / workers.length);

    await askAll(workers.map((w, k) => {
        const from = k * per, to = Math.min(n, from + per);
        return [w, { setGen: evo.gen, brains: evo.brains.slice(from, to).map(packBrain), bank }];
    }));

    const flown = new Array(n).fill(null).map(() => []);
    const meta = new Array(n).fill(null).map(() => ({ docked: 0, contact: 0, outcomes: [], coasts: 0, coastTotal: 0, dv: 0, best: Infinity, t: 0 }));
    let alive = Array.from({ length: n }, (_, i) => i);
    let episodes = 0;
    const plan = racePlan(bank.length, { disabled: !CFG.race });

    for (let r = 0; r < plan.length; r++) {
        const round = plan[r];
        for (const s of round.scenarios) {
            const byWorker = workers.map(() => []);
            for (const i of alive) byWorker[Math.floor(i / per)].push(i % per);
            episodes += alive.length;
            /* Every worker is messaged, including the ones with nothing to do.
             * Skipping the idle ones and filtering the promise list looks
             * tidier and silently breaks the result mapping: `parts` would then
             * be indexed by position in the FILTERED list while `byWorker` is
             * indexed by worker, so as soon as one worker's survivors ran out
             * every score after it would be attributed to the wrong brain. */
            const parts = await askAll(workers.map((w, k) =>
                [w, { round: s, alive: byWorker[k], noiseSeed }]));
            for (let k = 0; k < workers.length; k++) {
                for (const rec of parts[k].results) {
                    const gi = k * per + rec.i;
                    flown[gi].push(rec.adv);
                    const m = meta[gi];
                    m.docked += rec.docked; m.contact += rec.contact;
                    m.outcomes.push(rec.outcome); m.coasts += rec.coasts;
                    m.coastTotal += rec.coastTotal; m.dv += rec.dv; m.t += rec.t;
                    m.best = Math.min(m.best, rec.best);
                }
            }
        }
        if (round.keep >= 1 || r === plan.length - 1) continue;
        /* THE CUT. Rank on what has actually been flown so far — which is the
         * same scenario for everyone, so this is a paired comparison and not a
         * lottery — and keep the better half. The protected set (the elites and
         * the grace holder) survives every cut regardless of where it lands,
         * because the top of the ladder is the one place the extra noise of a
         * short evaluation must not be allowed in. */
        const ranked = alive.slice().sort((a, b) =>
            foldFitness(flown[b], bank.length) - foldFitness(flown[a], bank.length));
        const keepN = Math.max(RACE.minSurvivors, Math.ceil(alive.length * round.keep));
        const keep = new Set(ranked.slice(0, keepN));
        for (const p of protectedIdx) keep.add(p);
        alive = alive.filter(i => keep.has(i));
    }

    return { flown, meta, episodes, full: bank.length * n };
}

/* -------------------------------------------------------- held-out exam */
/* The training score is measured on the episodes the population was selected
 * against, so the best line is partly luck. The exam is different: fixed seeds
 * far outside anything the training bank can draw, every unlocked stage, and
 * only this decides who is champion. */
async function exam(nets, topStage) {
    const bank = buildExam(topStage, CFG.examSeeds).map(s => ({ stage: s.stage, seed: s.seed }));
    // Calibrate the exam bank once and cache it — it is the same every time.
    const key = `${topStage}:${CFG.examSeeds}`;
    if (exam._key !== key) {
        const per = Math.ceil(bank.length / workers.length);
        const parts = await askAll(workers.map((w, k) => {
            const mine = bank.slice(k * per, (k + 1) * per);
            return mine.length ? [w, { calibrate: mine }] : null;
        }).filter(Boolean));
        exam._bank = parts.flatMap(p => p.calibrated);
        exam._key = key;
    }
    const eb = exam._bank;
    const jobs = [];
    for (let n = 0; n < nets.length; n++) for (let s = 0; s < eb.length; s++) jobs.push({ n, s });
    const packed = nets.map(packBrain);
    const per = Math.ceil(jobs.length / workers.length);
    const parts = await askAll(workers.map((w, k) => {
        const mine = jobs.slice(k * per, (k + 1) * per);
        return mine.length ? [w, { exam: true, nets: packed, bank: eb, jobs: mine }] : null;
    }).filter(Boolean));
    const all = parts.flatMap(p => p.exam);
    return nets.map((_, n) => {
        const mine = all.filter(r => r.n === n);
        const byStage = {};
        for (const r of mine) (byStage[r.stage] || (byStage[r.stage] = [])).push(r);
        const mean = (a, f) => a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0;
        return {
            adv: mean(mine, r => r.adv),
            docked: mean(mine, r => r.docked),
            contact: mean(mine, r => r.contact),
            dv: mean(mine, r => r.dv),
            fold: foldFitness(mine.map(r => r.adv), mine.length),
            byStage: Object.fromEntries(Object.entries(byStage).map(([k, rows]) => [k, {
                adv: mean(rows, r => r.adv), docked: mean(rows, r => r.docked), n: rows.length
            }]))
        };
    });
}

/* ---------------------------------------------------------------- run */
console.log(`orbital docking trainer — pop ${CFG.pop}, bank ${CFG.bank}, ${CFG.workers} workers`);
console.log(`  net ${SPEC.trunk.join("×")} trunk → guidance ${SPEC.guidance.join("×")} / control ${SPEC.control.join("×")}` +
    `  (${new Brain(SPEC, null).weightCount()} weights, ${NIN_} inputs)`);
console.log(`  race ${CFG.race ? "on" : "OFF"}, islands ${CFG.islands ? "from stage 2" : "OFF"}, ` +
    `bank block ${CFG.block} gens, seed ${CFG.seed}`);

let bestExam = -1e18, bestDock = -1;
/* The reigning champion. Held here and nowhere else — see the note at the
 * candidate list below. */
let champion = resumeBrain;
const t0 = Date.now();

(async function run() {
    for (let g = startGen; g < startGen + CFG.gens; g++) {
        const stage = CFG.stageLock >= 0 ? CFG.stageLock : stageState.stage;
        evo.islands = CFG.islands && stage >= 2;
        const block = Math.floor((g - 1) / CFG.block);
        const { bank, draws } = await makeBank(stage, CFG.bank, block);

        // The elites of the previous generation sit at the head of the
        // population by construction (see evolution.js), and the grace holder
        // knows its own seat. Those are the ones that must fly the full bank.
        const protectedIdx = [0, 1, 2, 3].filter(i => i < evo.brains.length);
        if (evo.graceIdx >= 0) protectedIdx.push(evo.graceIdx);

        const ev = await evaluate(bank, block * 9173, protectedIdx);
        const results = evo.brains.map((brain, i) => ({
            brain,
            fitness: foldFitness(ev.flown[i], bank.length),
            docked: ev.meta[i].docked / Math.max(1, ev.flown[i].length),
            episodes: ev.flown[i].length,
            meta: ev.meta[i]
        }));
        const rec = evo.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.grace, {},
            { stage, episodes: ev.episodes, full: ev.full });

        if (g % CFG.every === 0 || g === startGen) {
            /* Examine the top few brains, not just the best-on-training one.
             * With one candidate the search stalls in a way that looks like
             * convergence and is not: the training best is whoever won a noisy
             * bank, usually a lucky draw rather than a real improvement, so it
             * fails the exam and the champion never moves. Every (brain,
             * scenario) pair goes into one batched call, so three candidates
             * cost far less than three times one. */
            const sorted = results.slice(0, evo.mainCount).sort((a, b) => b.fitness - a.fitness);
            /* THE TRAINER OWNS THE CHAMPION, not Evolution.
             *
             * Evolution.evolve() also tracks a champion, by training fitness,
             * every generation. The exam runs every fifth. So for four
             * generations out of five the title belonged to whoever won a noisy
             * bank, and then the exam compared its own held-out winner against
             * a brain that had just been swapped underneath it. Two selectors
             * disagreeing is worse than either alone: the exam's verdict was
             * being silently overwritten, and the reported exam score sat frozen
             * at 0.089 for ninety generations while the training best climbed.
             * `champion` below is the only one that decides anything. */
            const cands = [champion].concat(sorted.slice(0, 3).map(r => r.brain)).filter(Boolean);
            const ex = await exam(cands, stage);
            let bi = 0;
            for (let i = 1; i < ex.length; i++) {
                /* DUEL VALIDATION. A challenger takes the crown only by beating
                 * the reigning champion on the SAME fixed exam bank — and the
                 * champion is candidate 0, so this is a paired comparison on
                 * identical scenarios and identical noise. Ranking on the
                 * training bank instead crowns whoever drew the kindest
                 * scenarios that generation. */
                if (ex[i].fold > ex[bi].fold + (i > 0 && bi === 0 ? 0.01 : 0)) bi = i;
            }
            if (bi > 0 || !champion) champion = cands[bi].clone();
            // Keep Evolution's copy in step so --resume and the breeding pool
            // see the same brain, but the decision was made above.
            evo.champion = champion;
            const best = ex[bi];

            const promoted = CFG.stageLock < 0 &&
                ratchet(stageState, best.byStage, {
                    promote: CFG.promote, anchor: CFG.anchor, maxStage: N_STAGES - 1
                });

            const el = (Date.now() - t0) / 1000;
            const saved = 100 * (1 - ev.episodes / ev.full);
            const st0 = best.byStage[0], stT = best.byStage[stage];
            console.log(
                `gen ${String(g).padStart(5)} S${stage} ${STAGES[stage].short.padEnd(9)} ` +
                `train ${rec.best.toFixed(3)}/${rec.avg.toFixed(3)} dock ${(rec.docked * 100).toFixed(0)}%  ` +
                `| EXAM adv ${best.adv.toFixed(3)} dock ${(best.docked * 100).toFixed(0)}% ` +
                `touch ${((best.docked + best.contact) * 100).toFixed(0)}% Δv ${best.dv.toFixed(1)}  ` +
                `| S0 ${st0 ? (st0.docked * 100).toFixed(0) : "?"}% Stop ${stT ? (stT.docked * 100).toFixed(0) : "?"}%  ` +
                `| race −${saved.toFixed(0)}% banks ${draws}  [${el.toFixed(0)}s ${((g - startGen + 1) / el).toFixed(2)} g/s]` +
                (best.fold > bestExam ? "  ★" : ""));
            if (promoted) {
                console.log(`        ── stage ${stageState.stage - 1} → ${stageState.stage} ` +
                    `(${STAGES[stageState.stage].label}): top-stage docking ${(stT.docked * 100).toFixed(0)}% ` +
                    `≥ ${(CFG.promote * 100).toFixed(0)}%, stage 0 held at ${(st0.docked * 100).toFixed(0)}%`);
                bestExam = -1e18;      // scores are not comparable across a stage change
            }

            const meta = {
                gen: g, stage: stageState.stage, exam: best.adv, examFold: best.fold,
                dockRate: best.docked, byStage: best.byStage, history: evo.history
            };
            if (best.fold > bestExam) {
                bestExam = best.fold; bestDock = best.docked;
                saveBrain(path.join(__dirname, CFG.out, "checkpoint.json"), meta, champion);
            }
            // latest.json is simply where the run has got to. One gating bug
            // should never be able to throw away an afternoon of compute.
            saveBrain(path.join(__dirname, CFG.out, "latest.json"), meta, champion);
            fs.writeFileSync(path.join(__dirname, CFG.out, "history.json"), JSON.stringify(evo.history));
        }
        if (evo.graceEvent) console.log(`        ${evo.graceEvent}`);
    }
    for (const w of workers) w.postMessage({ stop: true });
    console.log(`\ndone. best exam ${bestExam.toFixed(3)} (dock ${(bestDock * 100).toFixed(0)}%) — ` +
        path.join(CFG.out, "checkpoint.json"));
    console.log(`bake it into the page with:  node train.js --bake ${path.join(CFG.out, "checkpoint.json")}`);
    process.exit(0);
})();
