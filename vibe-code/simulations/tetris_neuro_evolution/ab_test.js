/* ab_test.js — measure GA variants against each other instead of guessing.
 *
 *   node ab_test.js                          # all variants, default budget
 *   node ab_test.js --gens 150 --pop 48 --reps 2 --workers 5
 *   node ab_test.js --only base,islands
 *
 * Every variant runs the same generation budget from the same seeds. The number
 * that decides it is NOT the training fitness — that is the thing the GA is
 * optimising and it is measured on seeds the population was selected against.
 * Each variant's champion is replayed on a fixed set of held-out piece
 * sequences, and *that* is what gets compared.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort } = require("worker_threads");

for (const f of ["nn.js", "tetris.js", "sensors.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

if (!isMainThread) {
    const BASE_R = Object.assign({}, R);
    parentPort.on("message", msg => {
        // reward-shape variants change R for the duration of their own run
        Object.assign(R, BASE_R, msg.reward || {});
        configureSensors({ rawGrid: msg.rawGrid });
        const out = msg.brains.map(b => {
            const s = scoreBrain(Net.fromJSON(b), msg.seeds, DEFAULT_CFG, msg.pieceCap);
            return { fitness: s.fitness, lines: s.lines, pieces: s.pieces, sig: s.sig };
        });
        Object.assign(R, BASE_R);
        parentPort.postMessage({ out });
    });
    return;
}

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
const GENS = +arg("gens", 150);
const POP = +arg("pop", 48);
const REPS = +arg("reps", 2);
const PIECE_CAP = +arg("pieces", 200);
const NWORK = Math.max(1, +arg("workers", 5));
const ONLY = arg("only", null);

/* The control: exactly what the shipped defaults do today.
 *
 * Round 1 (7 variants × 2 reps × 110 gens, pop 40) settled two of these:
 *   selfadapt 117 · bigmut 105 · smallmut 99 · base 79 · trials3 73 ·
 *   islands4+selfadapt 68 · islands4 51        (held-out fitness)
 * Self-adaptive step size won clearly and is now on by default. Islands *lost*,
 * badly — at pop 40 four islands means ten brains each, which is too few to
 * sustain selection at all; they stay available but default to off. A third
 * training game per brain bought nothing for 1.6× the cost. Notably both a
 * bigger and a smaller fixed σ beat the old default, which says the old value
 * was simply in a bad spot and what actually helps is a *spread* of step sizes.
 */
const BASE = {
    trials: 2,
    ga: {
        mutRate: 0.12, mutSigma: 0.25, grace: 3,
        annealFit: 2000, annealFloor: 0.22, shakeAfter: 8,
        immZeroFit: 3600, childZeroFit: 48000, reinject: true,
        selfAdapt: true, migrateEvery: 0,
    },
    islands: 1,
};
const clone = o => JSON.parse(JSON.stringify(o));
const variant = (name, f) => { const v = clone(BASE); v.name = name; f(v); return v; };

const VARIANTS = [
    variant("base", () => { }),
    variant("noselfadapt", v => { v.ga.selfAdapt = false; }),
    variant("islands4", v => { v.islands = 4; v.ga.migrateEvery = 10; }),
    variant("trials3", v => { v.trials = 3; }),
    variant("sigma40", v => { v.ga.mutSigma = 0.4; }),
    variant("sigma15", v => { v.ga.mutSigma = 0.15; }),
    variant("bigmut", v => { v.ga.mutSigma = 0.4; v.ga.mutRate = 0.2; }),
    variant("smallmut", v => { v.ga.mutSigma = 0.12; v.ga.mutRate = 0.06; }),
    // architecture: a smaller net is a smaller search space, which a GA may walk
    // faster even if its ceiling is lower
    variant("net24x12", v => { v.net = [IN_SIZE, 24, 12, 7]; }),
    variant("net64x32", v => { v.net = [IN_SIZE, 64, 32, 7]; }),
    variant("net1layer", v => { v.net = [IN_SIZE, 32, 7]; }),
    // selection pressure: how hard the rank-weighted picker leans on the top
    variant("softselect", v => { v.rankExp = 1.4; }),
    variant("hardselect", v => { v.rankExp = 3.2; }),
    variant("nocrossover", v => { v.ga.childZeroFit = 1; }),
    // Reward shape. A single line clear is currently worth ~30 placed pieces,
    // but its actual survival value is nearer 2.5 — it clears 10 cells off the
    // stack. Over-paying for it means one lucky clear swamps every genuine
    // difference in stacking skill, and selection ends up chasing bag luck.
    variant("lines_lo", v => { v.reward = { LINES: [0, 60, 180, 440, 1000] }; }),
    variant("lines_hi", v => { v.reward = { LINES: [0, 480, 1280, 3040, 7200] }; }),
    variant("holes_hard", v => { v.reward = { NEW_HOLE: -3.0, FIXED_HOLE: 1.5 }; }),
    variant("nofill", v => { v.reward = { FILL: 0 }; }),
    // Behavioural fitness sharing: keep one full-size pool, but discount a
    // brain's selection score by how many others already play the same way.
    variant("share0.5", v => { v.ga.share = 0.5; }),
    variant("share1.5", v => { v.ga.share = 1.5; }),
    variant("share3", v => { v.ga.share = 3; }),
    variant("share1.5+wide", v => { v.ga.share = 1.5; v.ga.shareRadius = 0.9; }),
    // Input encoding: the literal 20x10 board plane (1 locked, 0.5 falling piece)
    // on top of everything else, versus the compressed features alone. The plane
    // is unambiguous but nearly doubles the weight count, and a GA pays for every
    // extra dimension it has to search.
    variant("rawgrid", v => { v.rawGrid = true; }),
    variant("nogrid", v => { v.rawGrid = false; }),
    variant("rawgrid+narrow", v => { v.rawGrid = true; v.net = [0, 40, 24, 7]; }),
].filter(v => !ONLY || String(ONLY).split(",").includes(v.name));

const workers = [];
for (let i = 0; i < NWORK; i++) workers.push(new Worker(__filename));

function evaluate(brains, seeds, reward) {
    const per = Math.ceil(brains.length / NWORK);
    return Promise.all(workers.map((w, i) => new Promise((resolve, reject) => {
        const lo = i * per, hi = Math.min(brains.length, lo + per);
        if (lo >= hi) return resolve([]);
        // both listeners must come off again — this runs once per generation, and
        // leaving the error handler attached leaks one listener per generation
        const done = () => { w.off("message", onMsg); w.off("error", onErr); };
        const onMsg = m => { done(); resolve(m.out); };
        const onErr = e => { done(); reject(e); };
        w.on("message", onMsg);
        w.on("error", onErr);
        w.postMessage({
            seeds, pieceCap: PIECE_CAP, reward, rawGrid: SENSE_RAW_GRID,
            brains: brains.slice(lo, hi).map(b => b.toJSON()),
        });
    }))).then(c => c.flat());
}

/* Held-out validation: seeds no variant ever trained on, same set for everyone. */
const HOLDOUT = [];
for (let i = 0; i < 16; i++) HOLDOUT.push(600001 + i * 7919);

function validate(net) {
    let lines = 0, pieces = 0, fit = 0, holes = 0, buried = 0, placements = 0;
    for (const s of HOLDOUT) {
        const a = new Agent(net, s, DEFAULT_CFG);
        let prev = 0;
        while (a.alive) {
            const ev = a.step(400);
            if (ev && ev.locked) {
                const m = boardMetrics(a.game.grid, null);
                buried += Math.max(0, m.totalHoles - prev); prev = m.totalHoles; placements++;
            }
        }
        lines += a.lines; pieces += a.pieces; fit += a.fitness;
        holes += boardMetrics(a.game.grid, null).totalHoles;
    }
    const n = HOLDOUT.length;
    return {
        lines: lines / n, pieces: pieces / n, fitness: fit / n,
        holes: holes / n, buriedPerPiece: buried / Math.max(1, placements),
        // Reward-independent yardstick. Variants that change the reward cannot be
        // ranked on fitness — that is the very thing they redefine — so rank on
        // what actually happened in the game: how long it survived and how many
        // lines it cleared, on a fixed exchange rate.
        skill: pieces / n + 25 * (lines / n),
    };
}

async function runVariant(v, rep) {
    // architecture and selection pressure are globals the GA reads, so they are
    // set for the duration of this variant's run and restored afterwards
    const savedNet = NET_SIZES.slice();
    const savedGrid = SENSE_RAW_GRID;
    if (v.rawGrid !== undefined) configureSensors({ rawGrid: v.rawGrid });
    if (v.net) { NET_SIZES = v.net.slice(); NET_SIZES[0] = IN_SIZE; }
    if (v.rankExp) v.ga.rankExp = v.rankExp;
    const evo = new Evolution(POP, 9000 + rep * 101, v.islands);
    for (let g = 0; g < GENS; g++) {
        const base = evo.gen * 977 + rep * 13;
        const seeds = [];
        for (let t = 0; t < v.trials; t++) seeds.push(base + t * 31 + 1);
        const scored = await evaluate(evo.brains, seeds, v.reward);
        const results = evo.brains.map((b, i) => ({
            brain: b, fitness: scored[i].fitness, lines: scored[i].lines,
            pieces: scored[i].pieces, sig: scored[i].sig,
        }));
        evo.evolve(results, v.ga);
    }
    const out = { val: validate(evo.champion), trainFit: evo.championFit, sigma: evo.meanSigma };
    NET_SIZES = savedNet;
    configureSensors({ rawGrid: savedGrid });
    return out;
}

(async () => {
    console.log(`${VARIANTS.length} variants × ${REPS} reps × ${GENS} gens, pop ${POP}, ` +
        `${NWORK} workers, validated on ${HOLDOUT.length} held-out games\n`);
    const rows = [];
    for (const v of VARIANTS) {
        const t0 = Date.now();
        const reps = [];
        for (let r = 0; r < REPS; r++) reps.push(await runVariant(v, r));
        const mean = k => reps.reduce((s, x) => s + x.val[k], 0) / reps.length;
        const row = {
            name: v.name,
            lines: mean("lines"), pieces: mean("pieces"), fitness: mean("fitness"),
            skill: mean("skill"), buried: mean("buriedPerPiece"),
            trainFit: reps.reduce((s, x) => s + x.trainFit, 0) / reps.length,
            sigma: reps.reduce((s, x) => s + (x.sigma || 1), 0) / reps.length,
            mins: (Date.now() - t0) / 60000,
        };
        rows.push(row);
        console.log(
            `${row.name.padEnd(19)} skill ${row.skill.toFixed(1).padStart(6)}  |  ` +
            `lines ${row.lines.toFixed(2).padStart(5)}  pieces ${row.pieces.toFixed(1).padStart(5)}  ` +
            `buried/piece ${row.buried.toFixed(2)}  fitness ${row.fitness.toFixed(0).padStart(5)}   ` +
            `(train ${row.trainFit.toFixed(0).padStart(5)}, σ̄ ${row.sigma.toFixed(2)}, ${row.mins.toFixed(1)} min)`);
    }
    rows.sort((a, b) => b.skill - a.skill);
    console.log("\nranked by held-out skill (pieces + 25 × lines):");
    rows.forEach((r, i) => console.log(
        `  ${i + 1}. ${r.name.padEnd(19)} ${r.skill.toFixed(1).padStart(6)}` +
        `   (${r.pieces.toFixed(1)} pieces, ${r.lines.toFixed(2)} lines)`));
    fs.writeFileSync(path.join(__dirname, "training", "ab_results.json"), JSON.stringify(rows, null, 1));
    for (const w of workers) w.terminate();
})();
