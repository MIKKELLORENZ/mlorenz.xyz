/* train.js — the headless trainer.
 *
 *   node train.js --pop 120 --workers 5 --minutes 300 --tag run1
 *
 * THE EPISODE BANK IS FIXED FOR THE WHOLE RUN, and that is a deliberate choice
 * with a scar behind it. Redrawing the missions every generation makes the
 * per-generation score a lottery: the champion is then whoever drew the easiest
 * waypoint chain, `championFit` latches onto a lucky generation, and the run
 * becomes a random walk that logs steadily rising numbers. With a fixed bank,
 * two generations are directly comparable and the champion means something.
 *
 * The price is that the bank can be memorised, so it must be big enough to be
 * worth generalising to — 6 missions × up to 30 waypoints each is ~180 distinct
 * legs, plus a different random spawn heading per mission — and the champion is
 * ranked at the end on seeds it has never flown (eval_brain.js). If held-out
 * scores track training scores, the bank was big enough.
 *
 * Resume semantics: --resume reloads population and champion but RESETS the
 * champion fitness, so a score earned under different settings cannot freeze
 * the title forever.
 */
"use strict";
require("./bootstrap.js");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker } = require("worker_threads");

function arg(name, def) {
    const i = process.argv.indexOf("--" + name);
    if (i === -1) return def;
    const v = process.argv[i + 1];
    if (v === undefined || v.startsWith("--")) return true;
    return isNaN(+v) ? v : +v;
}

const POP = arg("pop", 120) | 0;
const WORKERS = Math.max(1, arg("workers", 5) | 0);
const EPISODES = arg("episodes", 6) | 0;
const MINUTES = arg("minutes", 0);
const GENS = arg("gens", 0) | 0;
const SEED = arg("seed", 20260816) | 0;
const TAG = String(arg("tag", "run"));
const TURB = arg("turb", 0.15);
const CKPT_EVERY = arg("ckpt", 20) | 0;
const RESUME = arg("resume", null);
/* Airframe / reward overrides, so candidate designs can be run head to head
 * from one binary instead of a branch per experiment. Every one of these has to
 * be forwarded to the workers as well (see PHYS below) — each worker thread
 * loads its own copy of drone4d.js, and a constant patched only here would
 * silently score the fleet under different physics than the log claims. */
const PHYS = {};
const phys = (flag, key) => { const v = arg(flag, null); if (v !== null && v !== true) PHYS[key] = v; };
phys("airw", "AIR_W"); phys("aircap", "AIR_CAP");
phys("takeoff", "TAKEOFF_H"); phys("cang", "CANG_LIN"); phys("cangq", "CANG_QUAD");
Object.assign(DRONE, PHYS);
const WPFLOOR = arg("wpfloor", null);
if (WPFLOOR !== null && WPFLOOR !== true) ROOM.WP_FLOOR = WPFLOOR;
const OUTDIR = path.join(__dirname, "training");

const MUT_RATE = arg("mrate", 0.12);
const MUT_SIGMA = arg("msigma", 0.09);
const GRACE = arg("grace", 6) | 0;

if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

/* THE MISSION BANK ROTATES EVERY GENERATION, and getting this wrong cost a
 * 435-generation plateau.
 *
 * The first instinct is a bank fixed for the whole run, so that two generations
 * are directly comparable and the champion is not just whoever drew the easiest
 * waypoint chain. That is a real concern, but with six fixed missions it traded
 * one failure for a worse one. Drones die around eight seconds in, so they
 * almost never reach waypoint 2 — the training signal is six FIRST LEGS, and
 * six directions are memorisable. Measured at generation 435: 61% of all deaths
 * were against the −w wall specifically. Random brains, checked as a control,
 * crash symmetrically across all six lateral walls (~57 each), so the physics
 * was not at fault: the population had evolved an open-loop "fly roughly that
 * way" policy fitted to six fixed first legs, instead of a closed-loop policy
 * that reads the waypoint sensor at all. And because it was scored on exactly
 * those six, that strategy was locally optimal and the run could not leave it.
 *
 * Rotating the bank makes the missions un-memorisable. The cost is that the
 * per-generation score is no longer comparable across generations, so the
 * training log's `best` column becomes noisy and `championFit` stops being a
 * meaningful high-water mark. That is handled where it belongs, at the end:
 * pick_champion.js ranks the final population on held-out seeds rather than
 * trusting any number this file printed.
 *
 * Training seeds live in a range disjoint from every evaluation bank, by
 * construction — with rotation the training seeds march upward, and a naive
 * formula walks straight into the held-out seeds after ~50 generations and
 * silently contaminates the one measurement that is supposed to be independent. */
const ROTATE = arg("rotate", 1) ? true : false;
const TRAIN_SEED_BASE = 2000000;      // eval banks live at 60k–93k; never collide
function bankFor(gen) {
    const B = [];
    for (let e = 0; e < EPISODES; e++) {
        const k = ROTATE ? (gen - 1) * EPISODES + e : e;
        B.push({
            missionSeed: TRAIN_SEED_BASE + k * 137,
            noiseSeed: TRAIN_SEED_BASE + 500 + k * 29,
            turbulence: TURB
        });
    }
    return B;
}
let BANK = bankFor(1);
/* airW/airCap ride along in the episode options because each worker thread
 * loads its OWN copy of drone4d.js — a constant patched on the main thread is
 * invisible to them, which would silently score the fleet under a different
 * reward economy than the one being logged. */
const EP_OPTS = {
    noise: true, hardCap: 120, maxArrivals: 30, minSep: 8,
    phys: PHYS, wpFloor: ROOM.WP_FLOOR
};

const evo = new Evolution(POP, SEED);
let startGen = 1;
if (RESUME && fs.existsSync(RESUME)) {
    const ck = JSON.parse(fs.readFileSync(RESUME, "utf8"));
    evo.brains = ck.population.map(o => Net.fromJSON(o));
    while (evo.brains.length < POP) evo.brains.push(new Net(NET_SIZES, evo.rng));
    evo.brains.length = POP;
    evo.champion = ck.champion ? Net.fromJSON(ck.champion) : null;
    evo.championFit = -1e18;                 // never carry a score across settings
    evo.gen = ck.gen + 1; startGen = evo.gen;
    evo.history = ck.history || [];
    console.log(`resumed ${RESUME} at gen ${evo.gen} (champion fitness reset)`);
}

/* ------------------------------------------------------------- worker pool */
const pool = [];
for (let i = 0; i < WORKERS; i++) pool.push(new Worker(path.join(__dirname, "worker.js")));
let nextTask = 0, pending = 0, onAllDone = null;
const CHUNKS = WORKERS * 2;

function packBrain(net) { return net.weights.map(w => w.buffer.slice(0)); }

function evaluateGeneration(cb) {
    const fit = new Float64Array(POP), arr = new Float64Array(POP);
    const crashed = new Float64Array(POP), tookOff = new Float64Array(POP), air = new Float64Array(POP);
    // Interleaved assignment: chunk c gets brains c, c+CHUNKS, c+2·CHUNKS …
    // The population is sorted best-first, so interleaving gives every chunk the
    // same mix of elites and high-sigma mutants and the workers finish together.
    const tasks = [];
    for (let c = 0; c < CHUNKS; c++) {
        const idx = [];
        for (let i = c; i < POP; i += CHUNKS) idx.push(i);
        if (idx.length) tasks.push(idx);
    }
    nextTask = 0; pending = 0;
    let done = 0;

    const dispatch = (w) => {
        if (nextTask >= tasks.length) return false;
        const idx = tasks[nextTask++];
        pending++;
        w.postMessage({
            sizes: NET_SIZES,
            brains: idx.map(i => packBrain(evo.brains[i])),
            indices: idx, episodes: BANK, opts: EP_OPTS
        });
        return true;
    };

    for (const w of pool) {
        w.removeAllListeners("message");
        w.on("message", (res) => {
            for (let j = 0; j < res.indices.length; j++) {
                const i = res.indices[j];
                fit[i] = res.fit[j]; arr[i] = res.arr[j];
                crashed[i] = res.crashed[j]; tookOff[i] = res.tookOff[j]; air[i] = res.air[j];
            }
            pending--; done++;
            if (!dispatch(w) && pending === 0) {
                cb({ fit, arr, crashed, tookOff, air });
            }
        });
    }
    for (const w of pool) dispatch(w);
}

/* ------------------------------------------------------------------- loop */
const t0 = Date.now();
const deadline = MINUTES ? t0 + MINUTES * 60000 : null;
let bestEverArr = 0;
const logPath = path.join(OUTDIR, `log_${TAG}.txt`);
function log(s) {
    console.log(s);
    try { fs.appendFileSync(logPath, s + "\n"); } catch (e) { /* disk hiccup must not kill a run */ }
}

log(`4D drone trainer — pop ${POP}, ${EPISODES} episodes, ${WORKERS} workers, ` +
    `net ${NET_SIZES.join("-")}, turb ${TURB}, tag ${TAG}`);
log(`bank: ${ROTATE ? "ROTATING every generation (un-memorisable); " +
    "log `best` is noisy by design — rank with pick_champion.js"
    : "fixed " + BANK.map(b => b.missionSeed).join(", ")}`);

function saveCkpt(name) {
    const f = path.join(OUTDIR, name);
    fs.writeFileSync(f, JSON.stringify({
        gen: evo.gen - 1, tag: TAG, popSize: POP, netSizes: NET_SIZES,
        champion: evo.champion ? evo.champion.toJSON() : null,
        championFit: evo.championFit,
        history: evo.history.slice(-400),
        population: evo.brains.map(b => b.toJSON())
    }));
    return f;
}

function generation() {
    const gt = Date.now();
    BANK = bankFor(evo.gen);
    // With a rotating bank a high-water mark is meaningless — it would latch on
    // whichever generation drew the kindest missions and then never move. Clear
    // it so `champion` always holds the CURRENT generation's best brain, and let
    // the search gates track current form rather than a lucky memory.
    if (ROTATE) evo.championFit = -1e18;
    evaluateGeneration((r) => {
        const results = [];
        for (let i = 0; i < POP; i++) {
            results.push({ brain: evo.brains[i], fitness: r.fit[i], arrivals: r.arr[i] });
        }
        const meanTook = r.tookOff.reduce((a, b) => a + b, 0) / POP;
        const meanCrash = r.crashed.reduce((a, b) => a + b, 0) / POP;
        const meanAir = r.air.reduce((a, b) => a + b, 0) / POP;
        const rec = evo.evolve(results, MUT_RATE, MUT_SIGMA, GRACE,
            { immZeroFit: 3000, childZeroFit: 14000 },
            { tookOff: meanTook, crashRate: meanCrash, air: meanAir });

        if (rec.bestArr > bestEverArr) bestEverArr = rec.bestArr;
        const secs = (Date.now() - gt) / 1000;
        const el = (Date.now() - t0) / 60000;
        log(`gen ${String(rec.gen).padStart(5)}  best ${rec.best.toFixed(0).padStart(7)}` +
            `  avg ${rec.avg.toFixed(0).padStart(7)}` +
            `  wp ${rec.bestArr.toFixed(2)}/${rec.avgArr.toFixed(2)}` +
            `  air ${meanAir.toFixed(1)}s  off ${(meanTook * 100).toFixed(0)}%` +
            `  crash ${(meanCrash * 100).toFixed(0)}%` +
            `  ${secs.toFixed(1)}s  [${el.toFixed(1)}m]` +
            (evo.graceEvent ? `  ${evo.graceEvent}` : ""));

        if ((rec.gen % CKPT_EVERY) === 0) saveCkpt(`ckpt_${TAG}.json`);

        const outOfTime = deadline && Date.now() >= deadline;
        const outOfGens = GENS && (evo.gen > startGen + GENS - 1);
        if (outOfTime || outOfGens) {
            const f = saveCkpt(`ckpt_${TAG}.json`);
            log(`\nstopped after ${evo.gen - 1} generations, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
            log(`champion fitness ${evo.championFit.toFixed(0)}, best arrivals seen ${bestEverArr.toFixed(2)}`);
            log(`checkpoint: ${f}`);
            for (const w of pool) w.terminate();
            return;
        }
        setImmediate(generation);
    });
}
generation();
