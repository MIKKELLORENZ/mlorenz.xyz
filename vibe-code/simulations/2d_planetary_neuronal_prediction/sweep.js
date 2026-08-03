/* sweep.js — paired A/B over search settings and architecture options.
 *
 *   node sweep.js --what outscale --gens 60 --reps 3
 *   node sweep.js --what arch     --gens 120 --reps 2 --workers 6
 *
 * Every variant in a sweep is run on the SAME trial systems, from the SAME
 * population seed, for the same number of generations. That pairing is the
 * whole design: one run of this environment is noisy enough that an unpaired
 * comparison of two settings mostly measures which seed each got, and the
 * conclusion flips if you run it again. Repetitions are reported individually
 * as well as averaged, so a variant that wins on average but loses a rep is
 * visible as exactly that rather than as a fact.
 *
 * Results are printed relative to the coarse-Newton baseline on the same
 * systems — the only scale on which "1.9 digits" means anything.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const SIM_FILES = ["nn.js", "physics.js", "model.js", "world.js", "evolution.js"];
function loadSim() {
    for (const f of SIM_FILES) vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

/* ------------------------------------------------------------------ worker */
/* One worker runs one WHOLE variant-repetition end to end. Splitting a
 * population across workers would be faster per run, but this way each result
 * is produced by a single deterministic thread, so a sweep is exactly
 * reproducible from its seed. */
if (!isMainThread) {
    loadSim();
    parentPort.on("message", (job) => {
        if (job.stop) { process.exit(0); return; }
        setModelCfg(job.model);
        setOutScales(job.edgeOut, job.nodeOut);
        const evo = new Evolution(job.pop, job.seed, rng => new Predictor(rng));
        const curve = [];
        let cache = null, cacheKey = null;
        for (let g = 1; g <= job.gens; g++) {
            const block = Math.floor((g - 1) / job.seedBlock);
            const key = `${block}`;
            if (key !== cacheKey) {
                cacheKey = key;
                cache = new TrialSet(seedsFor(block, job.trials, 0), { level: job.level, tickFrac: job.tickFrac });
            }
            const results = evo.brains.map(brain => {
                const ev = cache.evaluate(predictorRunner(brain));
                return { brain, fitness: fitnessOf(ev), digits: ev.digits, worst: ev.worst, blew: ev.blew };
            });
            const rec = evo.evolve(results, job.mutRate, job.mutSigma, 3, {});
            if (g % 10 === 0 || g === job.gens) curve.push(+(rec.bestDigits).toFixed(4));
        }
        // Scored on held-out systems, never on the ones it trained against.
        const exam = new TrialSet(seedsFor(job.level * 31 + 7, 5, 0x5EED1), { level: job.level, tickFrac: job.tickFrac });
        const ex = exam.evaluate(predictorRunner(evo.champion));
        parentPort.postMessage({
            id: job.id, exam: ex.digits, worst: ex.worst, curve,
            newton: exam.evaluate(NEWTON_RUNNER).digits,
            params: evo.champion.nParams()
        });
    });
    return;
}

/* -------------------------------------------------------------------- main */
loadSim();
const argv = process.argv.slice(2);
function arg(n, d) { const i = argv.indexOf("--" + n); if (i < 0) return d; const v = argv[i + 1]; return v === undefined || v.startsWith("--") ? true : v; }

const WHAT = String(arg("what", "outscale"));
const GENS = parseInt(arg("gens", 60), 10);
const REPS = parseInt(arg("reps", 3), 10);
const POP = parseInt(arg("pop", 48), 10);
const LEVEL = parseInt(arg("level", 1), 10);
const NW = parseInt(arg("workers", Math.max(1, Math.min(6, os.cpus().length - 2))), 10);

/* The output scales come from model.js, not from a copy kept here. They were
 * hard-coded once, the module default changed after the outscale sweep, and the
 * architecture sweep then spent half an hour carefully comparing variants at an
 * initialisation the shipped model no longer uses. */
const BASE = {
    pop: POP, gens: GENS, trials: 4, seedBlock: 3, level: LEVEL,
    tickFrac: 0.02, mutRate: 0.12, mutSigma: 0.4,
    model: { mode: "phys", image: false, mem: 8, lags: 4, rounds: 2, grid: 8 },
    edgeOut: getOutScales().edge, nodeOut: getOutScales().node
};

const SWEEPS = {
    // How far from zero the kernel coefficients should start. This is the one
    // that decides whether the search ever gets off the ground.
    outscale: [
        { name: "edge 0.02 (control-style)", edgeOut: 0.02 },
        { name: "edge 0.10", edgeOut: 0.10 },
        { name: "edge 0.35", edgeOut: 0.35 },
        { name: "edge 0.70", edgeOut: 0.70 },
        { name: "edge 1.00 (plain He)", edgeOut: 1.00 }
    ],
    // The three architecture questions the brief actually asked.
    arch: [
        { name: "baseline (no image, mem 8, 2 rounds)", model: { image: false, mem: 8, rounds: 2 } },
        { name: "+ image", model: { image: true, mem: 8, rounds: 2 } },
        { name: "− memory", model: { image: false, mem: 0, rounds: 2 } },
        { name: "− 2nd round", model: { image: false, mem: 8, rounds: 1 } },
        { name: "raw features (no 1/r² offered)", model: { mode: "raw", image: false, mem: 8, rounds: 2 } }
    ],
    /* Two variants only, so the whole repetition budget goes into resolving ONE
     * question instead of five. The five-way `arch` sweep at 3 reps produced a
     * per-rep spread of ±0.2 digits against between-variant differences of at
     * most 0.19 — i.e. it could not tell any of them apart, and reading a winner
     * off it would have been reading noise. Distinguishing a 0.12-digit effect
     * at that spread needs roughly a dozen reps a side. */
    image: [
        { name: "no image (pairwise features only)", model: { image: false } },
        { name: "+ 8×8 log-mass raster", model: { image: true } }
    ],
    /* Does a finer picture help? The 8×8 raster lost its own paired A/B, and the
     * suspected reason was redundancy rather than resolution — the edge features
     * already carry every mass and every separation exactly, and the raster
     * carries the same numbers rounded into buckets. If that diagnosis is right
     * then 16×16 cannot rescue it, because more buckets is more of the thing that
     * was never the problem. Worth one cheap run to check rather than to assert. */
    grid: [
        { name: "no image", model: { image: false } },
        { name: "+ 8×8 raster", model: { image: true, grid: 8 } },
        { name: "+ 16×16 raster", model: { image: true, grid: 16 } }
    ],
    /* THE question this architecture change exists to answer: does remembering
     * past force evaluations — i.e. having a multistep scheme available at all —
     * buy accuracy at a fixed one evaluation per tick? `lags 0` is the old
     * memoryless one-step model, and it still gets the velocity split, so this
     * isolates the history rather than measuring both changes at once. */
    lags: [
        { name: "lags 0 (one-step)", model: { lags: 0 } },
        { name: "lags 2", model: { lags: 2 } },
        { name: "lags 4", model: { lags: 4 } }
    ],
    mut: [
        { name: "sigma 0.20", mutSigma: 0.20 }, { name: "sigma 0.40", mutSigma: 0.40 },
        { name: "sigma 0.70", mutSigma: 0.70 }, { name: "rate 0.25 sigma 0.4", mutRate: 0.25 }
    ]
};

const variants = SWEEPS[WHAT];
if (!variants) { console.error(`unknown sweep "${WHAT}" — try: ${Object.keys(SWEEPS).join(", ")}`); process.exit(1); }

const jobs = [];
variants.forEach((v, vi) => {
    for (let r = 0; r < REPS; r++) {
        jobs.push(Object.assign({}, BASE, v, {
            model: Object.assign({}, BASE.model, v.model || {}),
            // Same population seed per repetition across ALL variants — that is
            // the pairing. Variant A's rep 2 and variant B's rep 2 start from
            // the identical random population and see the identical systems.
            seed: 1000 + r * 77, id: `${vi}:${r}`, vi, rep: r
        }));
    }
});

console.log(`sweep "${WHAT}" — ${variants.length} variants × ${REPS} reps × ${GENS} gens, ` +
    `pop ${POP}, rung L${LEVEL} (${levelOf(LEVEL).label}), ${NW} workers`);
console.log(`paired: every variant sees the same populations and the same systems\n`);

const pool = [];
for (let i = 0; i < NW; i++) pool.push(new Worker(__filename));
const results = new Map();
let next = 0, done = 0;
const t0 = Date.now();

function pump(w) {
    if (next >= jobs.length) return;
    const j = jobs[next++];
    w.postMessage(j);
}
for (const w of pool) {
    w.on("message", (m) => {
        results.set(m.id, m);
        done++;
        process.stdout.write(`\r  ${done}/${jobs.length} runs complete (${((Date.now() - t0) / 1000).toFixed(0)}s)   `);
        if (done === jobs.length) finish();
        else pump(w);
    });
    pump(w);
}

function finish() {
    console.log("\n");
    const rows = variants.map((v, vi) => {
        const mine = [];
        for (let r = 0; r < REPS; r++) mine.push(results.get(`${vi}:${r}`));
        const margins = mine.map(m => m.exam - m.newton);
        const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
        return { name: v.name, mean, margins, params: mine[0].params, exam: mine.map(m => m.exam) };
    });
    const best = Math.max(...rows.map(r => r.mean));
    console.log(`  variant                                params    vs Newton (per rep)         mean`);
    for (const r of rows) {
        const reps = r.margins.map(m => (m >= 0 ? "+" : "") + m.toFixed(2)).join("  ").padEnd(24);
        console.log(`  ${r.name.padEnd(36)} ${String(r.params).padStart(6)}    ${reps}  ` +
            `${(r.mean >= 0 ? "+" : "") + r.mean.toFixed(3)}${r.mean === best ? "  ←" : ""}`);
    }
    console.log(`\n  values are held-out digits MINUS coarse-Newton digits on the same systems.`);
    console.log(`  negative = still worse than plain Newton at one force evaluation per tick.`);
    for (const w of pool) w.postMessage({ stop: true });
    process.exit(0);
}
