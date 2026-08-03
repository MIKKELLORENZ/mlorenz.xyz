/* train.js — headless trainer. Same code as the browser, many more cores.
 *
 *   node train.js --gens 400 --pop 96 --workers 6
 *   node train.js --gens 2000 --pop 512 --episodes 6 --workers 120   (big box)
 *   node train.js --mode trim --gens 200                             (fast demo)
 *   node train.js --resume training/checkpoint.json --gens 500
 *   node train.js --bake training/checkpoint.json                    → default_brain.js
 *
 * SCALING. One episode of one brain is a few million floating-point operations
 * and touches nothing but its own state, so this parallelises almost perfectly:
 * the main thread owns the Evolution object and the workers own nothing but a
 * copy of the (read-only, ~10 MB) Machine tables. Per generation the main thread
 * ships pop × weights out and pop × four numbers back, which at 512 brains is
 * about 19 MB of structured clone per generation — well under the cost of the
 * episodes themselves. A 128-thread box wants a population in the high hundreds
 * and 5-8 episodes per generation, so that every worker gets several whole
 * brains and the per-generation barrier is amortised.
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
const { loadBrainFile } = require("./brainfile.js");

const SIM_FILES = ["nn.js", "greens.js", "machine.js", "tokamak.js", "tasks.js",
    "pid.js", "evolution.js", "world.js", "obs_norm.js"];

function loadSim() {
    for (const f of SIM_FILES) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    }
}

/* ------------------------------------------------------------------ worker */
if (!isMainThread) {
    loadSim();
    setObsMode(workerData.mode);
    refreshNetSizes();
    const mac = getMachine();          // built once, reused for every generation
    parentPort.on("message", (msg) => {
        if (msg.stop) { process.exit(0); return; }
        /* One brain over an explicit list of (task, seed) pairs — the held-out
         * exam. It used to run on the main thread, where it was pure serial
         * time added to every generation: fourteen single-brain episodes while
         * eighteen workers sat idle, about 40% of the wall clock of a
         * generation. Spreading it over the same pool costs nothing and pays
         * for a less noisy selector. */
        if (msg.exam) {
            const nets = msg.nets.map(n => Net.fromJSON(n));
            const out = msg.jobs.map(j => {
                const w = new World(mac, [nets[j.ni]], {
                    taskId: j.tid, missionSeed: j.seed, noise: true, randomise: true,
                    level: j.level | 0
                });
                while (!w.isOver()) w.step();
                const r = w.results()[0];
                return {
                    ni: j.ni, level: j.level | 0,
                    fit: normalizeFitness(r.fitness, msg.scale), survival: r.survival,
                    err: r.boundaryErr, disrupted: r.disrupted ? 1 : 0
                };
            });
            parentPort.postMessage({ idx: msg.idx, exam: out });
            return;
        }
        const nets = msg.brains.map(b => Net.fromJSON(b));
        const out = nets.map(() => ({ fitness: 0, survival: 0, boundaryErr: 0, disruptions: 0 }));
        msg.tasks.forEach((plan, ep) => {
            const w = new World(mac, nets, {
                taskId: plan.tid, missionSeed: msg.seed * 131 + ep,
                noise: true, randomise: msg.randomise !== false,
                duration: msg.duration, level: plan.level | 0
            });
            while (!w.isOver()) w.step();
            w.results().forEach((r, i) => {
                out[i].fitness += normalizeFitness(r.fitness, msg.scale) / msg.tasks.length;
                out[i].survival += r.survival / msg.tasks.length;
                out[i].boundaryErr += r.boundaryErr / msg.tasks.length;
                if (r.disrupted) out[i].disruptions++;
            });
        });
        parentPort.postMessage({ idx: msg.idx, out });
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
    gens: parseInt(arg("gens", 300), 10),
    pop: parseInt(arg("pop", 96), 10),
    episodes: parseInt(arg("episodes", 3), 10),
    workers: parseInt(arg("workers", Math.max(1, Math.min(8, os.cpus().length - 2))), 10),
    mode: String(arg("mode", "full")),
    mutRate: parseFloat(arg("mutrate", 0.10)),
    mutSigma: parseFloat(arg("mutsigma", 0.35)),   // relative to each layer's init scale
    grace: parseInt(arg("grace", 3), 10),
    stageLock: arg("stage", null) === null ? -1 : parseInt(arg("stage", -1), 10),
    seed: parseInt(arg("seed", (Date.now() % 1e9) | 0), 10),
    out: String(arg("out", "training")),
    resume: arg("resume", null),
    every: parseInt(arg("every", 10), 10),
    // How many consecutive generations share one draw of the task perturbation
    // and domain randomisation. With a fresh draw every generation the score is
    // dominated by which machine you happened to get, and the champion is
    // whoever was lucky; holding it for a block lets selection see the brain.
    seedBlock: parseInt(arg("seedblock", 2), 10),
    // Difficulty ladder. `level` is the rung to START on; `maxlevel` caps how
    // far the ratchet may climb; `promote` is the held-out exam score on the
    // TOP rung that earns a promotion, and `anchor` is the score on rung 0 that
    // must still hold when it does.
    level: parseInt(arg("level", 0), 10),
    maxLevel: parseInt(arg("maxlevel", N_LEVELS - 1), 10),
    // 0.85 is not a low bar: it is roughly what the champion scores on the rung
    // it has already mastered. A loose threshold makes the ratchet race to the
    // top of the ladder in a handful of generations and spend the whole run
    // there, which is the opposite of a curriculum. Because achievable fitness
    // falls as the machine gets nastier, a fixed absolute threshold also gives
    // the ladder a natural stopping point — it climbs until the brain cannot
    // clear the bar any more, and then stops. That is the intended behaviour,
    // not a failure to promote.
    promoteFit: parseFloat(arg("promote", 0.85)),
    anchorFit: parseFloat(arg("anchor", 0.85)),
    promoteHold: parseInt(arg("promotehold", 3), 10),
    duration: arg("duration", null) === null ? undefined : parseFloat(arg("duration"))
};

setObsMode(CFG.mode);
refreshNetSizes();
const mac = getMachine();

/* ------------------------------------------------------------------- bake */
if (arg("bake", null)) {
    const src = loadBrainFile(String(arg("bake")));
    const net = src.net || src.champion || src;
    const body = "/* default_brain.js — generated by train.js. Drop-in champion.\n" +
        ` * mode ${src.mode || CFG.mode} · generation ${src.gen || "?"} · exam score ${src.examFit != null ? src.examFit.toFixed(3) : "?"} */\n` +
        "window.DEFAULT_BRAIN = " + JSON.stringify({
            format: "tokamak-brain-v1", mode: src.mode || CFG.mode,
            gen: src.gen, exam: src.examFit, sizes: net.sizes, net
        }) + ";\n";
    fs.writeFileSync(path.join(__dirname, "default_brain.js"), body);
    console.log(`wrote default_brain.js (${net.sizes.join("×")})`);
    process.exit(0);
}

if (!fs.existsSync(path.join(__dirname, CFG.out))) fs.mkdirSync(path.join(__dirname, CFG.out), { recursive: true });

const evo = new Evolution(CFG.pop, CFG.seed, NET_SIZES);
let startGen = 1;
if (CFG.resume) {
    const ck = loadBrainFile(String(CFG.resume));
    if (JSON.stringify(ck.net.sizes) !== JSON.stringify(NET_SIZES)) {
        console.error(`resume failed: checkpoint is ${ck.net.sizes.join("×")}, this run is ${NET_SIZES.join("×")}`);
        process.exit(1);
    }
    // Seed the whole population from the champion and let mutation spread it
    // back out. Resuming from a single brain loses the diversity the original
    // run had built up, so the first few generations after a resume are always
    // a little worse than the checkpoint — that is expected, not a bug.
    const champ = Net.fromJSON(ck.net);
    for (let i = 0; i < evo.brains.length; i++) {
        evo.brains[i] = i === 0 ? champ.clone() : champ.clone().mutate(CFG.mutRate, CFG.mutSigma, evo.rng);
    }
    evo.champion = champ.clone();
    evo.history = ck.history || [];
    evo.gen = (ck.gen || 1) + 1;
    startGen = evo.gen;
    if (ck.level != null && arg("level", null) === null) CFG.level = ck.level;
    console.log(`resumed from ${CFG.resume} at generation ${ck.gen}` +
        (ck.level != null ? ` (difficulty rung ${ck.level})` : ""));
}

/* ------------------------------------------------------------------ pool */
const workers = [];
for (let i = 0; i < CFG.workers; i++) {
    workers.push(new Worker(__filename, { workerData: { mode: CFG.mode } }));
}

/* One outstanding request per worker at a time — every caller here awaits
 * before issuing the next batch, so a one-shot listener is enough. */
function ask(w, msg) {
    return new Promise(res => {
        const on = (m) => { w.off("message", on); res(m); };
        w.on("message", on);
        w.postMessage(msg);
    });
}

/* ---------------------------------------------------------- held-out exam */
/* The training score is measured on the episodes the population was selected
 * against, so the best line is partly luck. The exam is different: fixed seeds
 * the population has never trained on, every task in the registry, and only
 * this decides who is champion. Without it one lucky generation holds the title
 * forever.
 *
 * The seeds are FIXED, which makes every candidate's exam a paired comparison
 * on identical episodes — common random numbers, the same trick the training
 * seed block uses. Two brains differing by one mutation are then ranked on
 * their difference rather than on which machine each happened to draw. */
const EXAM_SEEDS = [90001, 90002, 90003];

/* Examine SEVERAL brains in one pass. Every (brain, episode) pair is one job and
 * the whole set is dealt across the pool at once, so examining three candidates
 * costs barely more wall-clock than examining one — the pool was never full with
 * a single brain's worth of jobs anyway. */
async function examJobs(nets, jobs, scale) {
    const netJSON = nets.map(n => n.toJSON());
    const per = Math.ceil(jobs.length / workers.length);
    const parts = await Promise.all(workers.map((w, i) => {
        const mine = jobs.slice(i * per, Math.min(jobs.length, (i + 1) * per));
        if (!mine.length) return Promise.resolve({ exam: [] });
        return ask(w, { exam: true, idx: i, nets: netJSON, jobs: mine, scale: scale || 40 });
    }));
    const all = parts.flatMap(p => p.exam);
    const mean = (rows, f) => rows.length ? rows.reduce((a, b) => a + f(b), 0) / rows.length : 0;
    return nets.map((_, ni) => {
        const mine = all.filter(r => r.ni === ni);
        const byLevel = {};
        for (const r of mine) (byLevel[r.level] || (byLevel[r.level] = [])).push(r);
        return {
            fit: mean(mine, r => r.fit),
            survival: mean(mine, r => r.survival),
            err: mean(mine, r => r.err),
            disruptRate: mean(mine, r => r.disrupted),
            // Per-rung breakdown, which is what the promotion rule reads: a
            // champion is only allowed up the ladder if it is strong on the
            // TOP rung and has not gone backwards on rung 0.
            level: Object.fromEntries(Object.entries(byLevel).map(([k, rows]) => [k, {
                fit: mean(rows, r => r.fit), survival: mean(rows, r => r.survival),
                err: mean(rows, r => r.err), n: rows.length
            }]))
        };
    });
}

async function exam(net, maxLevel) {
    const jobs = [];
    let i = 0;
    for (const tid of TRAIN_TASKS) {
        for (const s of EXAM_SEEDS) jobs.push({ ni: 0, tid, seed: s, level: i++ % (maxLevel + 1) });
    }
    return (await examJobs([net], jobs, 40))[0];
}
console.log(`tokamak trainer — pop ${CFG.pop}, ${CFG.episodes} episodes/gen, ${CFG.workers} workers, ` +
    `mode ${CFG.mode} (${NET_SIZES.join("×")}), seed ${CFG.seed}`);
console.log(`difficulty ladder: start L${CFG.level} (${difficultyOf(CFG.level).label}), ` +
    `cap L${CFG.maxLevel} (${difficultyOf(CFG.maxLevel).label}); promote at top ≥ ${CFG.promoteFit} ` +
    `with rung 0 ≥ ${CFG.anchorFit}, held ${CFG.promoteHold} checks`);

function evaluateGeneration(tasks, scale, seed) {
    return new Promise((resolve) => {
        const nets = evo.brains.map(b => b.toJSON());
        const per = Math.ceil(nets.length / workers.length);
        const results = new Array(nets.length);
        let pending = 0;
        workers.forEach((w, wi) => {
            const from = wi * per, to = Math.min(nets.length, from + per);
            if (from >= to) return;
            pending++;
            const onMsg = (m) => {
                w.off("message", onMsg);
                m.out.forEach((r, k) => { results[m.idx + k] = r; });
                if (--pending === 0) resolve(results);
            };
            w.on("message", onMsg);
            w.postMessage({
                idx: from, brains: nets.slice(from, to), tasks, scale, seed,
                duration: CFG.duration
            });
        });
        if (pending === 0) resolve(results);
    });
}

let bestExam = -1e18, bestExamLite = -1e18, lastStageSeen = null;   // bestExamLite: champion selector, bestExam: checkpoint gate
let level = Math.max(0, Math.min(N_LEVELS - 1, CFG.level));         // current difficulty rung
let lastLevelSeen = null, promoteRun = 0, bestEverGate = -1e18;

/* The champion selector: the stage's own tasks, on held-out seeds.
 *
 * Averaged over SEVERAL seeds, and that is the whole point. The first version
 * used one episode on one fixed seed, and a single episode of this environment
 * is dominated by which perturbation and which randomised machine it drew — so
 * generation 10 posted a lucky score and still held the title forty-five
 * generations later, every checkpoint the run wrote being that same brain. A
 * noisy selector does not slow a search down, it stops it. */
/* The champion exam spreads its episodes ACROSS the unlocked rungs rather than
 * running the top one only. One number then answers the question the selector
 * actually cares about — "is this brain better over everything it is supposed
 * to be able to do" — at no extra cost, and a brain that trades the nominal
 * machine for the savage one cannot win it. The per-rung breakdown comes back
 * alongside, and that is what the promotion rule reads. */
async function examStage(nets, stage, seeds, maxLevel) {
    const list = stageOpts(stage).tasks;
    const L = Math.max(0, maxLevel | 0);
    const jobs = [];
    for (let ni = 0; ni < nets.length; ni++) {
        let i = 0;
        for (const tid of list) {
            for (let k = 0; k < seeds; k++) {
                jobs.push({ ni, tid, seed: 770001 + k * 9173, level: i++ % (L + 1) });
            }
        }
    }
    return await examJobs(nets, jobs, 40);
}

/* How many held-out seeds the champion selector uses. Four everywhere now that
 * the exam runs on the worker pool: it used to be two at stage 2 because the
 * whole thing was serial main-thread time, and halving the seed count to save
 * a second per generation is a bad trade when the quantity being measured is
 * the difference between a champion and a slightly-mutated copy of it. */
function examSeeds(stage) { return 4; }

(async function run() {
    const t0 = Date.now();
    for (let g = startGen; g < startGen + CFG.gens; g++) {
        const stage = stageFor(evo.gen, evo.history, { stageLock: CFG.stageLock });
        const so = stageOpts(stage);
        // Rotated by the SEED BLOCK, not by the raw generation: every generation
        // sharing a block must also share its task list, or the common-random-
        // numbers trick that makes consecutive generations comparable is broken
        // by the very thing meant to broaden coverage.
        const plan = episodePlan(stage, CFG.episodes, Math.floor((g - 1) / CFG.seedBlock), level);
        const raw = await evaluateGeneration(plan, so.scale, Math.floor((g - 1) / CFG.seedBlock));

        // Survival of the BETTER HALF of the population. The roster deliberately
        // contains high-sigma mutants that mostly disrupt by design, so a
        // whole-population mean cannot reach a promotion threshold however good
        // the competent half is — 375 generations of the previous run never left
        // stage 0 for exactly this reason, and the brain it produced had
        // therefore never seen an unstable plasma.
        const bySurv = raw.map((r, i) => ({ s: r.survival, f: r.fitness }))
            .sort((a, b) => b.f - a.f);
        const half = Math.max(1, bySurv.length >> 1);
        const results = evo.brains.map((brain, i) => ({
            brain, fitness: raw[i].fitness, survival: raw[i].survival,
            boundaryErr: raw[i].boundaryErr
        }));
        const newSurv = bySurv.slice(0, half).reduce((a, b) => a + b.s, 0) / half;
        const rec = evo.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.grace,
            {}, { stage, newSurv });

        // The champion is decided by a HELD-OUT exam, not by the training score.
        // The training score is measured on the very episodes the population was
        // selected against, so one lucky draw crowns a brain that then holds the
        // title forever — with `every` set to 10 that is exactly what happened:
        // the reported exam number sat frozen at generation 10's value for the
        // rest of the run because nothing could beat a lucky training score.
        /* Examine the top CANDIDATES brains, not just the single best-on-training
         * one.
         *
         * With one candidate the search stalls in a way that looks like
         * convergence and is not: `results[0]` is whoever won six noisy training
         * episodes, which under a wide mutation is usually a lucky draw rather
         * than a real improvement, so it fails the held-out exam and the
         * champion never moves. Measured, the title sat frozen for fifty
         * generations while the training best kept climbing — one brain in
         * eighty was ever considered for it. Every (brain, episode) pair goes
         * into one batched call, so three candidates cost about 17% more wall
         * clock than one. */
        const CANDIDATES = 3;
        const cands = results.slice(0, Math.min(CANDIDATES, results.length)).map(r => r.brain);
        const exAll = (await examStage(cands, stage, examSeeds(stage), level)).map(r => r.fit);
        let bi = 0;
        for (let i = 1; i < exAll.length; i++) if (exAll[i] > exAll[bi]) bi = i;
        const ex1 = exAll[bi];
        // BOTH bars reset on a stage change, not just the selector's. A stage-2
        // score is measured on harder tasks than a stage-1 one and is simply not
        // comparable: leaving the checkpoint gate at its stage-0 high-water mark
        // means nothing the run achieves afterwards is ever written to disk. That
        // cost a whole 20-minute run — the population reached stage 2 with 84%
        // survival and the file on disk was still the stage-0 brain from
        // generation 370.
        // Both bars reset on a stage change AND on a difficulty promotion. A
        // score earned on rung 1 is measured against a stiffer machine than one
        // earned on rung 0 and the two are simply not comparable; leaving the
        // gate at the old high-water mark means nothing achieved after the
        // promotion is ever written to disk. That exact bug, in its stage-change
        // form, cost a whole twenty-minute run.
        if (stage !== lastStageSeen || level !== lastLevelSeen) {
            bestExamLite = -1e18;
            bestExam = -1e18;
            lastStageSeen = stage;
            lastLevelSeen = level;
        }
        if (ex1 > bestExamLite) {
            bestExamLite = ex1;
            evo.champion = cands[bi].clone();
        }

        if (g % CFG.every === 0 || g === startGen) {
            // The checkpoint is gated on the same stage-scoped metric the champion
            // is chosen by, with twice the seeds — not on the full registry. At
            // stage 0 the full registry is six tasks the population has never
            // trained on, so gating on it writes checkpoints for whichever brain
            // happens to fall over most slowly at work nothing is selecting for.
            // `ex` is still computed, but it is reported, not used to decide.
            const gateFull = (await examStage([evo.champion], stage, examSeeds(stage) * 2, level))[0];
            const gate = gateFull.fit;
            const ex = await exam(evo.champion, level);
            const better = gate > bestExam;
            if (better) bestExam = gate;
            // Separate from bestExam, which is reset by every stage change and
            // every promotion; this one is only for the closing summary.
            if (gate > bestEverGate) bestEverGate = gate;

            /* THE RATCHET. Climb a rung when the champion is comfortable on the
             * hardest machine it has seen AND has not gone backwards on the
             * easiest one. Both conditions matter: the first is the point of the
             * ladder, the second is the promise that going up does not cost what
             * was already learned. Requiring it twice running keeps one lucky
             * exam from moving the goalposts. It never comes back down — a rung
             * once unlocked stays in the training mix forever. */
            // The rung the exam we just ran was measured ON. `level` may be
            // incremented below, and reading the breakdown with the new value
            // asks gateFull for a rung it never tested — which printed a bare
            // "?" on exactly the lines a reader most wants a number.
            const examLevel = level;
            const top = gateFull.level[examLevel] || { fit: -9, survival: 0 };
            const anchor = gateFull.level[0] || { fit: -9, survival: 0 };
            const ready = level < CFG.maxLevel &&
                top.fit >= CFG.promoteFit && anchor.fit >= CFG.anchorFit;
            promoteRun = ready ? promoteRun + 1 : 0;
            let promoted = null;
            if (promoteRun >= CFG.promoteHold) {
                level++;
                promoteRun = 0;
                promoted = `        ── difficulty ${level - 1} → ${level} ` +
                    `(${difficultyOf(level).label}): top rung ${top.fit.toFixed(2)} ≥ ${CFG.promoteFit}, ` +
                    `rung 0 held at ${anchor.fit.toFixed(2)}. Now ` +
                    `κ×${(1 + difficultyOf(level).kappaGain).toFixed(2)} above round, ` +
                    `wall ×${difficultyOf(level).wall.toFixed(2)}, ` +
                    `noise ×${difficultyOf(level).noise.toFixed(1)}, ` +
                    `start error ×${difficultyOf(level).kick.toFixed(2)}`;
            }
            const el = (Date.now() - t0) / 1000;
            // Rung 0 is printed on every line, always. It is the anchor: if the
            // ladder is quietly costing the population the machine it started
            // on, this is the number that shows it.
            const a0 = gateFull.level[0], aT = gateFull.level[examLevel];
            console.log(
                `gen ${String(evo.gen - 1).padStart(5)}  L${examLevel}/${CFG.maxLevel} ${difficultyOf(examLevel).label.padEnd(7)} ` +
                `train best ${rec.best.toFixed(3)} mean ${rec.avg.toFixed(3)} surv ${(rec.avgSurv * 100).toFixed(0)}%  ` +
                `| EXAM ${ex.fit.toFixed(3)} surv ${(ex.survival * 100).toFixed(0)}% ` +
                `err ${(ex.err * 100).toFixed(2)}cm disrupt ${(ex.disruptRate * 100).toFixed(0)}%  ` +
                `| rung0 ${a0 ? a0.fit.toFixed(2) : "  ?  "} top ${aT ? aT.fit.toFixed(2) : "  ?  "}` +
                `${better ? "  ★" : ""}  [${el.toFixed(0)}s, ${((evo.gen - startGen) / el).toFixed(2)} gen/s]`);
            if (promoted) console.log(promoted);
            if (better) {
                fs.writeFileSync(path.join(__dirname, CFG.out, "checkpoint.json"), JSON.stringify({
                    format: "tokamak-brain-v1", mode: CFG.mode, gen: evo.gen - 1,
                    examFit: gate, stage: stage, level: level, byLevel: gateFull.level,
                    exam: ex, sizes: NET_SIZES, obsNormVersion: OBS_NORM.version,
                    net: evo.champion.toJSON(), history: evo.history
                }));
            }
            // Unconditional snapshot of the current champion, whatever the gate
            // thinks. `checkpoint.json` is the best-so-far; `latest.json` is
            // simply where the run has got to. One gating bug should never again
            // be able to throw away twenty minutes of compute.
            fs.writeFileSync(path.join(__dirname, CFG.out, "latest.json"), JSON.stringify({
                format: "tokamak-brain-v1", mode: CFG.mode, gen: evo.gen - 1,
                examFit: gate, stage: stage, level: level, byLevel: gateFull.level,
                exam: ex, sizes: NET_SIZES,
                obsNormVersion: OBS_NORM.version, net: evo.champion.toJSON()
            }));
            fs.writeFileSync(path.join(__dirname, CFG.out, "history.json"), JSON.stringify(evo.history));
        }
        if (evo.graceEvent) console.log(`        ${evo.graceEvent}`);
    }
    for (const w of workers) w.postMessage({ stop: true });
    console.log(`\ndone. best exam ${bestExam.toFixed(3)} — ${path.join(CFG.out, "checkpoint.json")}`);
    console.log(`bake it into the page with:  node train.js --bake ${path.join(CFG.out, "checkpoint.json")}`);
    process.exit(0);
})();
