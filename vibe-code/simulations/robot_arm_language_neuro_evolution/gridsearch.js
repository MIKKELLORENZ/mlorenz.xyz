/* gridsearch.js — A/B the GA's own hyper-parameters on stage 1.
 *
 *   node gridsearch.js --gens 220 --pop 60 --reps 2
 *
 * Stage 1 is the right place to measure this. It is the only stage where the
 * language is irrelevant (one ball, one legal answer), so what is being
 * compared is purely how fast the population discovers the motor loop —
 * approach with the jaws open, close, lift, carry, open. Everything later in
 * the curriculum is gated on that, so a setting that is 2x faster here is worth
 * more than any amount of tuning further up.
 *
 * The reported number is MEAN DELIVERIES PER EPISODE across the fleet, not
 * fitness. Fitness includes shaping, and shaping is exactly the thing that can
 * look like progress while nothing gets delivered.
 *
 * Every config runs the identical sequence of tasks, scenes and noise seeds —
 * only the GA settings and the initial population differ. Repetitions vary the
 * population seed, because one lucky initial fleet can carry a bad setting.
 */
"use strict";

const os = require("os");
const path = require("path");
const { Worker, isMainThread, parentPort } = require("worker_threads");
const { loadSim } = require("./simload.js");

if (!isMainThread) {
    loadSim(__dirname);
    parentPort.on("message", msg => {
        if (msg.type === "quit") process.exit(0);
        const nets = msg.brains.map(b => Brain.fromJSON(b));
        const acc = nets.map(() => ({ fit: 0, del: 0, tgt: 0 }));
        msg.tasks.forEach(tk => {
            const task = TASKS[tk.idx];
            const w = new World(nets, {
                task, embedding: Embedding.forTask(task),
                sceneSeed: tk.sceneSeed, noiseSeed: tk.noiseSeed,
                maxBalls: msg.opts.maxBalls, noise: msg.opts.noise
            });
            let g = 0;
            while (!w.isOver() && g++ < 60 * 140) w.step();
            w.results().forEach((r, i) => {
                acc[i].fit += r.fitness; acc[i].del += r.delivered; acc[i].tgt += r.target;
            });
        });
        parentPort.postMessage({ acc });
    });
    return;
}

loadSim(__dirname);

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const GENS = parseInt(arg("gens", "220"), 10);
const POP = parseInt(arg("pop", "60"), 10);
const EPS = parseInt(arg("episodes", "4"), 10);
const REPS = parseInt(arg("reps", "2"), 10);
const NW = parseInt(arg("workers", String(Math.max(1, Math.min(6, os.cpus().length - 2)))), 10);

/* The interesting axis turned out to be how MANY weights move at once, not how
 * far. The brain is ~6,000 weights; a rate of 0.20 perturbs 1,200 of them in a
 * single child, which reliably destroys a working policy rather than refining
 * it. The gentler settings here mutate tens of weights, which is much closer to
 * the (1+1) hill climb that solved the task in 1,664 evaluations. */
const CONFIGS = argv.includes("--seed-variance")
    /* One config, many population seeds. A GA's run-to-run spread can easily be
     * larger than the gap between two settings, and a 2-rep A/B cannot tell the
     * two apart — which is exactly how a promising sweep result turned into a
     * live run that delivered nothing. Per-seed numbers are printed, not just
     * the mean, because the SHAPE of the distribution is the finding: "half the
     * seeds solve it and half die" needs a different response from "every seed
     * limps". */
    ? [{ name: "modular    0.12/0.20", rate: 0.12, sigma: 0.20, modular: true }]
    : [
        { name: "all-heads  0.20/0.15", rate: 0.20, sigma: 0.15, modular: false },
        { name: "modular    0.20/0.15", rate: 0.20, sigma: 0.15, modular: true },
        { name: "modular    0.30/0.20", rate: 0.30, sigma: 0.20, modular: true },
        { name: "modular    0.12/0.20", rate: 0.12, sigma: 0.20, modular: true }
    ];

const pool = [];
for (let i = 0; i < NW; i++) pool.push(new Worker(__filename));
function run(w, brains, tasks, opts) {
    return new Promise((res, rej) => {
        const ok = m => { w.off("message", ok); w.off("error", er); res(m); };
        const er = e => { w.off("message", ok); w.off("error", er); rej(e); };
        w.on("message", ok); w.on("error", er);
        w.postMessage({ brains, tasks, opts });
    });
}
async function score(brains, tasks, opts) {
    const per = Math.ceil(brains.length / pool.length);
    const parts = await Promise.all(pool.map((w, i) => {
        const slice = brains.slice(i * per, (i + 1) * per);
        if (!slice.length) return Promise.resolve(null);
        return run(w, slice.map(b => b.toJSON()), tasks, opts).then(r => ({ start: i * per, acc: r.acc }));
    }));
    const out = new Array(brains.length);
    for (const p of parts) if (p) p.acc.forEach((a, k) => { out[p.start + k] = a; });
    return out;
}

const stage = STAGES[0];

async function trial(cfg, seed) {
    setModularMutation(cfg.modular !== false);
    const evo = new Evolution(POP, seed, Embedding.dim);
    let bestAvgDel = 0, hitGen = null, lastAvgDel = 0, bestChamp = 0;
    for (let g = 1; g <= GENS; g++) {
        // Scene seeds come FROM the mission bank, exactly as train.js does.
        // Deriving them from the generation number here instead silently turns
        // every sweep into a test of a non-stationary objective — which is the
        // very thing the bank exists to remove, so the sweep would report that
        // nothing helps no matter what was changed.
        const tasks = drawMissions(stage, g, EPS).map(m => ({
            idx: TASKS.indexOf(m.task), sceneSeed: m.sceneSeed, noiseSeed: m.noiseSeed
        }));
        const acc = await score(evo.brains, tasks, { maxBalls: stage.maxBalls, noise: stage.noise });
        const results = evo.brains.map((b, i) => ({
            brain: b, fitness: acc[i].fit / EPS, delivered: acc[i].del / EPS,
            rate: acc[i].tgt ? acc[i].del / acc[i].tgt : 0, mistakes: 0, completed: 0
        }));
        const rec = evo.evolve(results, cfg.rate, cfg.sigma, 3, {});
        // topDel (top quartile), because that is what the curriculum advances on
        // and the fleet mean is dominated by children that fail by design.
        lastAvgDel = rec.topDel;
        if (rec.topDel > bestAvgDel) bestAvgDel = rec.topDel;
        if (bestChamp < rec.bestDel) bestChamp = rec.bestDel;
        if (hitGen === null && rec.topDel >= stage.advance) hitGen = g;
    }
    return { bestAvgDel, lastAvgDel, hitGen, bestChamp };
}

(async function main() {
    console.log(`stage 1 sweep — ${GENS} gens, pop ${POP}, ${EPS} instructions/gen, ${REPS} reps, ${NW} workers`);
    console.log(`advance threshold for stage 1 is ${stage.advance} balls/episode\n`);
    const rows = [];
    for (const cfg of CONFIGS) {
        const runs = [];
        for (let r = 0; r < REPS; r++) {
            const t = await trial(cfg, 1000 + r * 77);
            runs.push(t);
            console.log(`    seed ${1000 + r * 77}: top25 peak ${t.bestAvgDel.toFixed(3)} ` +
                `final ${t.lastAvgDel.toFixed(3)}  best-brain ${t.bestChamp.toFixed(2)}`);
        }
        const mean = k => runs.reduce((s, x) => s + (x[k] || 0), 0) / runs.length;
        const hits = runs.filter(r => r.hitGen !== null);
        rows.push({
            name: cfg.name,
            peak: mean("bestAvgDel"),
            final: mean("lastAvgDel"),
            champ: mean("bestChamp"),
            reached: `${hits.length}/${runs.length}`,
            atGen: hits.length ? Math.round(hits.reduce((s, r) => s + r.hitGen, 0) / hits.length) : "—"
        });
        const r = rows[rows.length - 1];
        console.log(`  ${r.name}  top25 peak ${r.peak.toFixed(3)}  final ${r.final.toFixed(3)}  ` +
            `best-brain peak ${r.champ.toFixed(2)}  reached threshold ${r.reached} (gen ${r.atGen})`);
    }
    rows.sort((a, b) => b.peak - a.peak);
    console.log(`\nbest by peak mean deliveries: ${rows[0].name}`);
    pool.forEach(w => w.postMessage({ type: "quit" }));
    setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error(e); process.exit(1); });
