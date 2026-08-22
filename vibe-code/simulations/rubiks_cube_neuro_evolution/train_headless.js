/* train_headless.js — the offline trainer. Same GA and same episode code the
 * page runs, across every core and with nothing drawn.
 *
 *   node train_headless.js                        # fresh run, forever
 *   node train_headless.js --gens 600
 *   node train_headless.js --config rw-descent --pop 96 --workers 6
 *   node train_headless.js --resume training/champion.json
 *   node train_headless.js --until 1780000000000  # stop at this epoch-ms
 *   node train_headless.js --out training/nightA --seed 99
 *
 * Writes <out>/champion.json (best-ever brain) and <out>/log.csv every
 * generation, so a run can be killed and picked up later. The champion records
 * the config that produced it — observation layout, action space and reward are
 * part of a brain's identity, and one reloaded under the wrong config is not
 * merely worse, it is unusable.
 *
 * ─── the two things that decide whether this run means anything ────────────
 *
 * A held-out gate. A challenger that out-scores the champion on this
 * generation's scrambles has, most of the time, simply drawn easier ones. It
 * only takes the title if it also wins on a bank nothing trains on, and that
 * bank rotates — both when somebody passes it (so it does not slowly become the
 * training set) and when nobody has for a while (so a lucky bank cannot freeze
 * the run, a deadlock this project has diagnosed before).
 *
 * A difficulty ratchet. The frontier only advances when the champion clears the
 * current rung on fresh scrambles of exactly that depth, and the lower rungs are
 * never dropped from the diet.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker, isMainThread, parentPort } = require("worker_threads");
const { load } = require("./load.js");
load();

/* --------------------------------------------------------------- worker side */
if (!isMainThread) {
    /* One Env per config, cached: constructing it builds the render plan and the
     * BFS oracle, which is ~40 MB and a second. The main thread changes only the
     * frontier depth from generation to generation, and that is passed with the
     * bank rather than baked into the Env. */
    let env = null, envKey = null, net = null, netKey = null;
    parentPort.on("message", msg => {
        const k = JSON.stringify(msg.env);
        if (k !== envKey) { env = new Env(msg.env); envKey = k; }
        const out = [];
        /* The bank arrives as plain arrays over the thread boundary; rebuild the
         * typed views once for the whole batch. */
        const bank = msg.bank.map(b => ({
            state: Uint8Array.from(b.state), depth: b.depth, d0: b.d0, budget: b.budget,
        }));
        for (const b of msg.brains) {
            net = netFromJSON(b); netKey = null;
            out.push(env.scoreBrain(net, bank));
        }
        void netKey;
        parentPort.postMessage({ tag: msg.tag, out });
    });
    return;
}

/* ----------------------------------------------------------------- main side */
function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
const num = (n, d) => { const v = arg(n, null); return v === null ? d : +v; };

const CONFIG_ARG = arg("config", null);
let RUN_CFG_NAME = "default";
let RUN_CFG;
if (CONFIG_ARG && typeof CONFIG_ARG === "string") {
    if (CONFIGS[CONFIG_ARG]) { RUN_CFG = resolveConfig(CONFIG_ARG); RUN_CFG_NAME = CONFIG_ARG; }
    else {
        /* a path to a JSON config — how grid_search.js hands its winner over */
        const f = path.resolve(__dirname, CONFIG_ARG);
        const loaded = JSON.parse(fs.readFileSync(f, "utf8"));
        RUN_CFG = resolveConfig(loaded.config || loaded);
        RUN_CFG_NAME = loaded.name || path.basename(CONFIG_ARG);
    }
} else RUN_CFG = resolveConfig("default");

/* Command-line overrides, so a sweep never has to edit configs.js. */
RUN_CFG.ga.pop = num("pop", RUN_CFG.ga.pop);
RUN_CFG.ga.islands = num("islands", RUN_CFG.ga.islands);
RUN_CFG.ga.mutRate = num("mut-rate", RUN_CFG.ga.mutRate);
RUN_CFG.ga.mutSigma = num("mut-sigma", RUN_CFG.ga.mutSigma);
RUN_CFG.ga.share = num("share", RUN_CFG.ga.share);
RUN_CFG.ga.grace = num("grace", RUN_CFG.ga.grace);
RUN_CFG.episodes = num("episodes", RUN_CFG.episodes);
RUN_CFG.gate = num("gate", RUN_CFG.gate);
RUN_CFG.ratchet.maxDepth = num("max-depth", RUN_CFG.ratchet.maxDepth);
RUN_CFG.ratchet.threshold = num("threshold", RUN_CFG.ratchet.threshold);
RUN_CFG.ratchet.startDepth = num("start-depth", RUN_CFG.ratchet.startDepth);
/* The diet and the move budget, from the command line.
 *
 * These matter for one specific reason. With a uniform mix over depths 1-7 and 48
 * episodes a brain is judged on about *seven* depth-7 cubes, so an improvement from 8%
 * to 12% at that depth moves the expected count from 0.6 solves to 0.8 and selection
 * cannot see it at all. Raising the deep end of the table is therefore not only a
 * question of what the network can represent — it is a question of whether the bank
 * ever asks. `--depth-mix ramp` weights depth d by d (a quarter of the bank at depth 7
 * instead of a seventh) and `--episodes` buys the rest. */
if (arg("depth-mix", null) !== null) RUN_CFG.env.depthMix = String(arg("depth-mix"));
if (arg("slack", null) !== null) RUN_CFG.env.budget.slack = num("slack", 6);
if (arg("budget-max", null) !== null) RUN_CFG.env.budget.max = num("budget-max", 20);
if (arg("mut-reset", null) !== null) setMutReset(+arg("mut-reset"));

const POP = RUN_CFG.ga.pop;
const GENS = num("gens", 1e9);
const NWORK = Math.max(1, Math.min(num("workers", Math.max(1, os.cpus().length - 2)), POP));
const RESUME = arg("resume", null);
const UNTIL = num("until", 0);
const SEED = num("seed", 1234);
const OUT = path.resolve(__dirname, String(arg("out", "training")));
const RATCHET_EVERY = num("ratchet-every", 10);
/* Periodic immutable snapshots of the champion, for duel.js to sort out afterwards.
 *
 * The champion crowned at the end of a long run is not the best brain the run
 * produced. Elitism is monotone only against a *fixed* bank, and the held-out gate
 * here deliberately rotates so that it cannot become the training set — so a
 * challenger that wins one rotation takes the title permanently and the deposed brain
 * is never re-checked. Near a plateau, where the gate's noise exceeds the real
 * differences, the title random-walks downhill while every log line looks healthy.
 *
 * That is not a hypothesis: two three-hour continuations of the round-three champion
 * both ended *worse* than the brain they started from (0.308 and 0.279 against 0.328,
 * the plain one 2.0 SE down on 1,750 paired scrambles). The result was saved only
 * because every candidate was kept and scored on one shared bank at the end.
 *
 * So keep the candidates. This writes <out>/snaps/gen<N>.json and never deletes one;
 * duel.js scores them all on a common bank and names the winner. Cheap — a snapshot is
 * ~60 KB and the run makes a few dozen. */
const SNAP_EVERY = num("snap-every", 250);

/* ---- racing: screen the population cheaply, measure the finalists properly ---
 *
 * probe_resolution.js says this run is signal-limited: on the depth-3 champion the
 * best improvement a mutation offers is worth about +0.03, while a 48-episode bank
 * resolves ±0.105 and a 160-episode bank ±0.057. Selection is choosing close to at
 * random among its best candidates, and the symptom is visible in the log — the
 * held-out gate was rejecting ~85% of in-run winners.
 *
 * The naive fix is more episodes for everybody, and it is wasteful. The accuracy is
 * only *needed* where the decisions are: which challenger fights the champion, and
 * what the champion itself re-scores at. The other two dozen brains only have to be
 * sorted into "breeds" and "does not", and a small bank sorts that well enough.
 *
 * So with --screen N the generation runs two passes over the same workers: every
 * brain plays N episodes, then the top --finalists replay the full bank, and the
 * re-injected champion is *always* a finalist so its honest re-score and every
 * challenger comparison happen on the same large common bank.
 *
 *   32 brains × 160          = 5,120 episode-evaluations, resolution ±0.057
 *   32 × 40 + 9 × 320        = 4,160                    , resolution ±0.040
 *
 * Cheaper *and* sharper, because the resolution that matters is the finalists'.
 * Non-finalists keep their screen fitness for breeding order but are pinned below
 * the worst finalist, so a lucky 40-episode score can never be mistaken for a
 * challenger. Ordering inside each group is preserved, which is all _breed uses.
 *
 * Lifted from the Tetris project, where it was the change that made a round work. */
/* Settable from the config as well as the command line, so racing can be a cell in
 * a grid rather than a switch thrown across the whole run. grid_search.js spawns
 * every cell with the same flags; anything that can only be a flag is a factor that
 * cannot be measured against a control in the same table. */
const SCREEN = num("screen", (RUN_CFG.race && RUN_CFG.race.screen) || 0);
const FINALISTS = Math.max(1, num("finalists", (RUN_CFG.race && RUN_CFG.race.finalists) || 8));

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* The main thread needs an Env too: it draws the banks, runs the held-out gate
 * and probes the ratchet. Same class, same code. */
const env = new Env(RUN_CFG.env);
const DESC = describeConfig(RUN_CFG, env);
const ratchet = new Ratchet(Object.assign({}, RUN_CFG.ratchet, {
    maxDepth: Math.min(RUN_CFG.ratchet.maxDepth, env.depthCap),
}));

const spawn = rng => buildNet(RUN_CFG.arch, env.layout, rng);
const evo = new Evolution(POP, SEED, RUN_CFG.ga.islands, spawn);

if (RESUME && typeof RESUME === "string" && fs.existsSync(path.resolve(__dirname, RESUME))) {
    const saved = JSON.parse(fs.readFileSync(path.resolve(__dirname, RESUME), "utf8"));
    const seed = netFromJSON(saved);
    if (seed.contract() !== DESC.contract) {
        console.error(`refusing to resume: saved brain is ${seed.contract()}, this run is ${DESC.contract}`);
        process.exit(1);
    }
    evo.champion = seed;
    evo.championFit = saved.fitness || 0;
    evo.gen = (saved.gen || 0) + 1;
    /* The saved frontier is the default, but an explicit --start-depth beats it.
     * A resumed run whose whole purpose is to change the diet — put a champion that
     * only ever saw depth ≤4 in front of depth-7 cubes — would otherwise silently
     * inherit the frontier it is trying to leave, and read in the log exactly like a
     * run that had done what was asked. A flag typed on the command line is a
     * statement of intent and should win over a field in a file. */
    if (saved.depth) ratchet.depth = saved.depth;
    if (arg("start-depth", null) !== null) {
        ratchet.depth = Math.max(1, Math.min(+arg("start-depth"), ratchet.maxDepth));
        console.log(`  frontier forced to depth ${ratchet.depth} (saved run was at ${saved.depth})`);
    }
    /* Carry the promotion history across the resume. Without this a resumed run
     * saves an empty ratchetHistory, and the record of *which generation* each rung
     * was cleared at — the only evidence for what a change to the trainer actually
     * did — is lost at the first restart. That cost a wrong causal claim once
     * already: a run resumed at depth 3 looks like the resume earned depth 3. */
    if (Array.isArray(saved.ratchetHistory)) ratchet.history = saved.ratchetHistory.slice();
    for (let i = 0; i < POP; i++) {
        evo.brains[i] = i < POP / 4 ? seed.clone()
            : seed.clone().mutate(RUN_CFG.ga.mutRate, RUN_CFG.ga.mutSigma, evo.rng);
    }
    console.log(`resumed from ${RESUME}: gen ${evo.gen}, fitness ${evo.championFit.toFixed(3)}, depth ${ratchet.depth}`);
}

const workers = [];
for (let i = 0; i < NWORK; i++) workers.push(new Worker(__filename));

console.log(`config ${RUN_CFG_NAME} · ${DESC.line}`);
console.log(`pop ${POP} · ${evo.islands} island(s) · ` +
    (SCREEN > 0 ? `screen ${SCREEN} → top ${FINALISTS} on ` : "") + `${RUN_CFG.episodes} episodes/brain · ` +
    `gate ${RUN_CFG.gate} · ratchet ≥${(ratchet.threshold * 100).toFixed(0)}% every ${RATCHET_EVERY} gens ` +
    `(depth ${ratchet.depth}→${ratchet.maxDepth}) · ${NWORK} workers` +
    (UNTIL ? ` · stopping at ${new Date(UNTIL).toLocaleTimeString()}` : ""));
if (SCREEN > 0) {
    const naive = POP * RUN_CFG.episodes;
    const raced = POP * SCREEN + (FINALISTS + 1) * RUN_CFG.episodes;
    console.log(`  racing: ${raced.toLocaleString("en-US")} episode-evaluations per generation ` +
        `against ${naive.toLocaleString("en-US")} without it ` +
        `(${(100 * raced / naive).toFixed(0)}%), and the finalists are measured on ` +
        `${RUN_CFG.episodes} rather than everyone on ${Math.round(raced / POP)}`);
}
if (!DESC.oracle) {
    console.log(`note: reward "${DESC.reward}" is not oracle-shaped, so the ratchet's ` +
        `held-out probe is the only exact distance measurement in this run.`);
}

const logPath = path.join(OUT, "log.csv");
if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, "gen,depth,best,avg,bestSolve,avgSolve,avgDescent,gate,sigma,secs\n");
}

/* Hand each worker a contiguous slice of the population. */
function evaluate(brains, bank, envCfg) {
    const per = Math.ceil(brains.length / NWORK);
    const flat = bank.map(b => ({
        state: Array.from(b.state), depth: b.depth, d0: b.d0, budget: b.budget,
    }));
    return Promise.all(workers.map((w, i) => new Promise((resolve, reject) => {
        const lo = i * per, hi = Math.min(brains.length, lo + per);
        if (lo >= hi) return resolve([]);
        const done = () => { w.off("message", onMsg); w.off("error", onErr); };
        const onMsg = m => { done(); resolve(m.out); };
        const onErr = e => { done(); reject(e); };
        w.on("message", onMsg);
        w.on("error", onErr);
        w.postMessage({ tag: i, env: envCfg, bank: flat, brains: brains.slice(lo, hi).map(b => b.toJSON()) });
    }))).then(chunks => chunks.flat());
}

/* One brain over one bank, split across the pool by *episodes* rather than by
 * brains, so the gate and the ratchet probe use the whole machine instead of
 * competing with it from the main thread. Recombining slices is exact: every
 * number reported here is a per-episode mean, so a count-weighted average of the
 * parts equals the whole. */
function evaluateOne(brain, bank, envCfg) {
    const per = Math.ceil(bank.length / NWORK);
    const json = brain.toJSON();
    return Promise.all(workers.map((w, i) => new Promise((resolve, reject) => {
        const lo = i * per, hi = Math.min(bank.length, lo + per);
        if (lo >= hi) return resolve(null);
        const done = () => { w.off("message", onMsg); w.off("error", onErr); };
        const onMsg = m => { done(); resolve({ n: hi - lo, r: m.out[0] }); };
        const onErr = e => { done(); reject(e); };
        w.on("message", onMsg);
        w.on("error", onErr);
        const flat = bank.slice(lo, hi).map(b => ({
            state: Array.from(b.state), depth: b.depth, d0: b.d0, budget: b.budget,
        }));
        w.postMessage({ tag: "one" + i, env: envCfg, bank: flat, brains: [json] });
    }))).then(parts => {
        let n = 0, solved = 0, descent = 0, fit = 0;
        for (const p of parts) {
            if (!p) continue;
            n += p.n; solved += p.r.solveRate * p.n;
            descent += p.r.descent * p.n; fit += p.r.fitness * p.n;
        }
        return n ? { solveRate: solved / n, descent: descent / n, fitness: fit / n, n } : null;
    });
}

/* ---- the held-out gate ------------------------------------------------------
 *
 * Scored on a reward-independent number — 70% "did it solve" plus 30% "how much
 * of the distance did it remove" — rather than on the run's own reward. If the
 * gate used the reward being trained against, a config that had found a way to
 * farm that reward would sail through its own filter, which is the one thing the
 * gate exists to catch.
 *
 * The two brains evolve() will ask about are both known before it is called (the
 * challenger is whichever result leads, the defender is the sitting champion), so
 * the scores are computed on the pool first and gateFn becomes a cache lookup.
 * Same games, same decision, a fraction of the wall clock. */
const gateSkill = r => 0.7 * r.solveRate + 0.3 * r.descent;
let gateBank = [], gateEpoch = 0;
const gateCache = new Map();
const drawGate = () => {
    gateBank = env.makeBank(2200001 + gateEpoch * 1000003, RUN_CFG.gate, ratchet.depth);
};
if (RUN_CFG.gate > 0) {
    drawGate();
    evo.championSkill = null;
    evo.gateFn = net => (gateCache.has(net) ? gateCache.get(net) : -Infinity);
}

let stop = false;
process.on("SIGINT", () => { console.log("\nstopping after this generation…"); stop = true; });
process.on("SIGTERM", () => { stop = true; });

let lastSnap = -1;
function snapshot(gen) {
    if (SNAP_EVERY <= 0) return;
    const bucket = Math.floor(gen / SNAP_EVERY);
    if (bucket === lastSnap) return;
    lastSnap = bucket;
    const dir = path.join(OUT, "snaps");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    save(path.join("snaps", `gen${String(gen).padStart(6, "0")}.json`), gen);
}

function save(name, gen) {
    fs.writeFileSync(path.join(OUT, name), JSON.stringify({
        gen, fitness: evo.championFit, solveRate: evo.championSolve,
        gateSkill: evo.championSkill === undefined ? null : evo.championSkill,
        gateGames: RUN_CFG.gate, depth: ratchet.depth, ratchetHistory: ratchet.history,
        configName: RUN_CFG_NAME, config: RUN_CFG, desc: DESC,
        net: evo.champion.toJSON(),
    }));
}

(async () => {
    const t00 = Date.now();
    let gensRun = 0, promotions = 0, rejectsAtRotate = 0;

    for (let g = 0; g < GENS && !stop; g++) {
        if (UNTIL && Date.now() > UNTIL) { console.log("reached the wall-clock deadline"); break; }
        const t0 = Date.now();

        /* A fresh bank every generation. Re-using scrambles lets the population
         * memorise them and look far better than it is; the stride between
         * generations clears the width of one generation's own draw. */
        const bank = env.makeBank(evo.gen * 7919 + 101, RUN_CFG.episodes, ratchet.depth);
        let scored;
        if (SCREEN > 0) {
            /* pass 1 — everybody, cheap, on a band of scrambles disjoint from the
             * final bank's so a brain cannot be screened and judged on the same cubes */
            const sBank = env.makeBank(evo.gen * 7919 + 500003, SCREEN, ratchet.depth);
            const s1 = await evaluate(evo.brains, sBank, RUN_CFG.env);
            const order = evo.brains.map((_, i) => i).sort((a, b) => s1[b].fitness - s1[a].fitness);
            const pick = new Set(order.slice(0, Math.min(FINALISTS, evo.brains.length)));
            /* The re-injected champion is a finalist by right, not by screen luck: its
             * honest re-score and every challenge it faces have to happen on the same
             * big common bank, or the comparison means nothing. */
            const champIdx = evo.injected ? evo.brains.indexOf(evo.injected) : -1;
            if (champIdx >= 0) pick.add(champIdx);
            const idx = [...pick];
            // pass 2 — the finalists, on the full bank, common random numbers
            const s2 = await evaluate(idx.map(i => evo.brains[i]), bank, RUN_CFG.env);
            scored = s1.slice();
            let worst = Infinity;
            idx.forEach((i, k) => { scored[i] = s2[k]; if (s2[k].fitness < worst) worst = s2[k].fitness; });
            /* Pin the rest below the worst finalist, keeping their screen order. */
            const rest = order.filter(i => !pick.has(i));
            rest.forEach((i, k) => {
                scored[i] = Object.assign({}, s1[i],
                    { fitness: Math.min(s1[i].fitness, worst) - 1e-6 * (k + 1) });
            });
            evo.finalists = idx.length;
        } else {
            scored = await evaluate(evo.brains, bank, RUN_CFG.env);
        }
        const results = evo.brains.map((b, i) => ({
            brain: b, fitness: scored[i].fitness, solveRate: scored[i].solveRate,
            descent: scored[i].descent, sig: scored[i].sig,
        }));

        /* Prime the gate cache for exactly the two brains evolve() will ask
         * about. evolve() re-scores the champion from its re-injected copy before
         * comparing, so mirror that here or we prime on the wrong verdict. */
        if (RUN_CFG.gate > 0) {
            let champFit = evo.championFit;
            if (evo.injected) {
                const r = results.find(x => x.brain === evo.injected);
                if (r) champFit = r.fitness;
            }
            let top = null;
            for (const r of results) if (!top || r.fitness > top.fitness) top = r;
            if (top && top.fitness > champFit) {
                if (evo.champion && !gateCache.has(evo.champion) &&
                    (evo.championSkill === null || evo.championSkill === undefined)) {
                    gateCache.set(evo.champion, gateSkill(await evaluateOne(evo.champion, gateBank, RUN_CFG.env)));
                }
                if (!gateCache.has(top.brain)) {
                    gateCache.set(top.brain, gateSkill(await evaluateOne(top.brain, gateBank, RUN_CFG.env)));
                }
            }
        }

        const gen = evo.gen;
        const prevChamp = evo.championFit;
        const r = evo.evolve(results, RUN_CFG.ga);
        const secs = (Date.now() - t0) / 1000;
        gensRun++;

        const eff = evo.eff;
        const flag = evo.championFit > prevChamp ? " ★" : (eff.shaken ? " ~shake" : "");
        console.log(
            `gen ${String(gen).padStart(5)}  d${ratchet.depth}  ` +
            `best ${r.best.toFixed(3).padStart(7)}  avg ${r.avg.toFixed(3).padStart(7)}  ` +
            `solved ${(r.bestSolve * 100).toFixed(0).padStart(3)}%/${(r.avgSolve * 100).toFixed(0).padStart(3)}%  ` +
            `descent ${r.avgDescent.toFixed(2)}  ` +
            `gate ${evo.championSkill === null || evo.championSkill === undefined ? "  —  " : evo.championSkill.toFixed(3)}` +
            ` (${evo.gateRejects || 0}/${evo.gateChecks || 0} rej)  ` +
            `σ ${eff.sigma.toFixed(3)}×${(evo.meanSigma || 1).toFixed(2)}  ${secs.toFixed(1)}s${flag}`
        );
        fs.appendFileSync(logPath, [
            gen, ratchet.depth, r.best.toFixed(4), r.avg.toFixed(4),
            r.bestSolve.toFixed(4), r.avgSolve.toFixed(4), r.avgDescent.toFixed(4),
            (evo.championSkill === null || evo.championSkill === undefined ? "" : evo.championSkill.toFixed(4)),
            eff.sigma.toFixed(4), secs.toFixed(1),
        ].join(",") + "\n");

        let rotate = false;
        if (evo.championFit > prevChamp) {
            save("champion.json", gen); snapshot(gen);
            promotions++;
            if (RUN_CFG.gateRotate > 0 && promotions % RUN_CFG.gateRotate === 0) rotate = true;
        }
        if (RUN_CFG.gateStale > 0 && (evo.gateRejects || 0) - rejectsAtRotate >= RUN_CFG.gateStale) rotate = true;

        /* ---- the ratchet ----
         * Probed on a bank of exactly the frontier depth that nothing has trained
         * on. A promotion redraws the gate too: the gate bank is drawn at the
         * current depth, so leaving it at the old one would leave the champion
         * defending a bar from an easier puzzle. */
        if (evo.champion && RATCHET_EVERY > 0 && gen % RATCHET_EVERY === 0) {
            const probeBank = env.makeDepthBank(5000003 + ratchet.epoch * 7919 + ratchet.depth * 131,
                ratchet.games, ratchet.depth);
            if (probeBank.length) {
                const pr = await evaluateOne(evo.champion, probeBank, RUN_CFG.env);
                ratchet.epoch++;
                ratchet.lastRate = pr.solveRate;
                if (ratchet.passes(pr.solveRate) && ratchet.depth < ratchet.maxDepth) {
                    ratchet.depth++;
                    ratchet.history.push({ gen, depth: ratchet.depth, rate: pr.solveRate });
                    console.log(`▲ ratchet: champion solved ${(pr.solveRate * 100).toFixed(0)}% of ` +
                        `${probeBank.length} unseen depth-${ratchet.depth - 1} scrambles — frontier now ${ratchet.depth}`);
                    rotate = true;
                    save("champion.json", gen); snapshot(gen);
                } else {
                    const se = Math.sqrt(Math.max(1e-9, pr.solveRate * (1 - pr.solveRate)) / probeBank.length);
                    console.log(`  ratchet probe: ${(pr.solveRate * 100).toFixed(0)}±${(se * 100).toFixed(0)}% on ` +
                        `${probeBank.length} unseen depth-${ratchet.depth} scrambles ` +
                        `(need ${(ratchet.needed() * 100).toFixed(0)}% observed for a ` +
                        `${(ratchet.threshold * 100).toFixed(0)}% lower bound)`);
                }
            }
        }

        if (rotate && RUN_CFG.gate > 0) {
            rejectsAtRotate = evo.gateRejects || 0;
            gateEpoch++;
            drawGate();
            gateCache.clear();
            if (evo.champion) {
                const s = gateSkill(await evaluateOne(evo.champion, gateBank, RUN_CFG.env));
                gateCache.set(evo.champion, s);
                evo.championSkill = s;
            } else evo.championSkill = null;
            console.log(`  gate bank rotated (epoch ${gateEpoch}, depth ≤${ratchet.depth}) — ` +
                `champion re-scored at ${evo.championSkill === null ? "n/a" : evo.championSkill.toFixed(3)}`);
        }
    }

    if (evo.champion) save("final.json", evo.gen - 1);
    console.log(`\ndone — ${gensRun} generations in ${((Date.now() - t00) / 60000).toFixed(1)} min, ` +
        `best ${evo.championFit.toFixed(3)}, frontier depth ${ratchet.depth}`);
    for (const w of workers) await w.terminate();
})();
