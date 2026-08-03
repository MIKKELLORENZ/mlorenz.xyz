/* search.js — run named configs from configs.js against each other.
 *
 *   node search.js --only base,conv3x8 --gens 100 --pop 44 --workers 4 \
 *                  --out training/search_a.json
 *
 * One process runs its configs one after another; overnight.js starts several
 * processes side by side so the whole grid fits in the night. Each config gets
 * the same generation budget from the same GA seeds, and the number that decides
 * it is NOT the training fitness — that is the thing the GA is optimising, on
 * seeds the population was selected against. Every config's champion is replayed
 * on a fixed bank of held-out piece sequences, and that is what gets compared.
 *
 * The champion is validated twice, at the halfway point and at the end, because
 * the question that matters for an overnight run is not only "how good is it
 * after 100 generations" but "was it still climbing".
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { Worker, isMainThread, parentPort } = require("worker_threads");

const SRC = ["nn.js", "tetris.js", "sensors.js", "world.js", "evolution.js", "configs.js"];
for (const f of SRC) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const BASE_R = Object.assign({}, R);

/* --------------------------------------------------------------- worker side */
if (!isMainThread) {
    let curName = null;
    parentPort.on("message", msg => {
        // Sensors and architecture are process globals, so a worker has to be
        // told which config it is scoring before it can rebuild a brain from
        // JSON — the input width is baked into every first-layer row.
        if (msg.config !== curName) { applyConfig(CONFIGS[msg.config], BASE_R); curName = msg.config; }
        const out = msg.brains.map(b => {
            const s = scoreBrain(netFromJSON(b), msg.seeds, DEFAULT_CFG, msg.pieceCap);
            return { fitness: s.fitness, lines: s.lines, pieces: s.pieces, sig: s.sig };
        });
        parentPort.postMessage({ out });
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
const GENS = +arg("gens", 100);
const POP = +arg("pop", 44);
const REPS = +arg("reps", 1);
const PIECE_CAP = +arg("pieces", 200);
const NWORK = Math.max(1, +arg("workers", 4));
const SEED0 = +arg("seed", 9000);
const OUTFILE = arg("out", "training/search.json");
const UNTIL = +arg("until", 0);        // epoch ms; abandon remaining configs past this
const ONLY = String(arg("only", Object.keys(CONFIGS).join(",")));
const NAMES = ONLY.split(",").filter(n => {
    if (CONFIGS[n]) return true;
    console.error("unknown config: " + n);
    return false;
});

/* Held-out validation: seeds nothing ever trains on, the same bank for every
 * config in every process, so numbers from different processes are comparable.
 * 24 games rather than 16 — at a tenth of a line per game, a 16-game sample is
 * decided by one or two lucky clears. */
const HOLDOUT = [];
for (let i = 0; i < 24; i++) HOLDOUT.push(600001 + i * 7919);

function validate(net) {
    let lines = 0, pieces = 0, fit = 0, buried = 0, placements = 0;
    const m = { heights: new Int32Array(BW), holes: new Int32Array(BW) };
    for (const s of HOLDOUT) {
        const a = new Agent(net, s, DEFAULT_CFG);
        let prev = 0;
        while (a.alive) {
            const ev = a.step(400);
            if (ev && ev.locked) {
                const bm = boardMetrics(a.game.grid, m);
                buried += Math.max(0, bm.totalHoles - prev); prev = bm.totalHoles; placements++;
            }
        }
        lines += a.lines; pieces += a.pieces; fit += a.fitness;
    }
    const n = HOLDOUT.length;
    return {
        lines: lines / n, pieces: pieces / n, fitness: fit / n,
        buriedPerPiece: buried / Math.max(1, placements),
        // Reward-independent yardstick. Configs that change the reward cannot be
        // ranked on fitness — that is the very thing they redefine — so rank on
        // what actually happened in the game: how long it survived and how many
        // lines it cleared, on a fixed exchange rate.
        skill: pieces / n + 25 * (lines / n),
    };
}

const workers = [];
for (let i = 0; i < NWORK; i++) workers.push(new Worker(__filename));

function evaluate(brains, seeds, config) {
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
            config, seeds, pieceCap: PIECE_CAP,
            brains: brains.slice(lo, hi).map(b => b.toJSON()),
        });
    }))).then(c => c.flat());
}

async function runConfig(name, rep) {
    const cfg = CONFIGS[name];
    const desc = applyConfig(cfg, BASE_R);
    const evo = new Evolution(POP, SEED0 + rep * 101, 1);
    let half = null;
    for (let g = 0; g < GENS; g++) {
        const base = evo.gen * 977 + rep * 13;
        const seeds = [];
        for (let t = 0; t < 2; t++) seeds.push(base + t * 31 + 1);
        const scored = await evaluate(evo.brains, seeds, name);
        const results = evo.brains.map((b, i) => ({
            brain: b, fitness: scored[i].fitness, lines: scored[i].lines,
            pieces: scored[i].pieces, sig: scored[i].sig,
        }));
        evo.evolve(results, desc.ga);
        if (g + 1 === Math.floor(GENS / 2)) half = validate(evo.champion);
    }
    return {
        val: validate(evo.champion), half,
        trainFit: evo.championFit, sigma: evo.meanSigma, desc,
        champion: { gen: evo.gen, fitness: evo.championFit, net: evo.champion.toJSON() },
    };
}

(async () => {
    const outPath = path.isAbsolute(OUTFILE) ? OUTFILE : path.join(__dirname, OUTFILE);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });   // a fresh clone has no training/
    console.log(`${NAMES.length} configs × ${REPS} reps × ${GENS} gens, pop ${POP}, ` +
        `${NWORK} workers, validated on ${HOLDOUT.length} held-out games`);
    const rows = [];
    for (const name of NAMES) {
        if (UNTIL && Date.now() > UNTIL) { console.log(`out of time — skipping ${name}`); continue; }
        const t0 = Date.now();
        const reps = [];
        for (let r = 0; r < REPS; r++) reps.push(await runConfig(name, r));
        const mean = (k, from) => reps.reduce((s, x) => s + ((from ? x[from] : x.val) || x.val)[k], 0) / reps.length;
        const best = reps.reduce((a, b) => (b.val.skill > a.val.skill ? b : a));
        const row = {
            name,
            skill: mean("skill"), lines: mean("lines"), pieces: mean("pieces"),
            buried: mean("buriedPerPiece"), fitness: mean("fitness"),
            halfSkill: reps[0].half ? mean("skill", "half") : null,
            trainFit: reps.reduce((s, x) => s + x.trainFit, 0) / reps.length,
            sigma: reps.reduce((s, x) => s + (x.sigma || 1), 0) / reps.length,
            inputs: reps[0].desc.inputs, params: reps[0].desc.params,
            contract: reps[0].desc.contract,
            gens: GENS, pop: POP, reps: REPS,
            mins: (Date.now() - t0) / 60000,
            champion: best.champion,
        };
        rows.push(row);
        const slope = row.halfSkill === null ? "" :
            `  slope ${(row.skill - row.halfSkill >= 0 ? "+" : "")}${(row.skill - row.halfSkill).toFixed(1)}`;
        console.log(
            `${name.padEnd(18)} skill ${row.skill.toFixed(1).padStart(6)}${slope}  |  ` +
            `lines ${row.lines.toFixed(2)}  pieces ${row.pieces.toFixed(1)}  ` +
            `buried ${row.buried.toFixed(2)}  train ${row.trainFit.toFixed(0)}  ` +
            `${row.inputs} in / ${row.params.toLocaleString()} params  ${row.mins.toFixed(1)} min`);
        // written after every config, so a killed process still leaves its results
        fs.writeFileSync(outPath, JSON.stringify(rows, null, 1));
    }
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 1));
    for (const w of workers) w.terminate();
})();
