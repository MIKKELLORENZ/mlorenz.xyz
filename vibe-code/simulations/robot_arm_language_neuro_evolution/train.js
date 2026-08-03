/* train.js — headless trainer. Same code the browser runs, one worker per core.
 *
 *   node train.js --gens 600 --pop 60 --workers 6
 *   node train.js --resume training/champion.json --gens 300
 *   node train.js --gens 120 --stage-lock 4        (drill the ordering rules)
 *
 * Splitting the population across workers is exactly equivalent to running it
 * in one process: the environment is a pure function of (task, sceneSeed,
 * noiseSeed) and stations never interact, so a slice of the fleet in worker 3
 * sees the identical episode a slice in worker 0 does.
 *
 * THE HELD-OUT EXAM. Every --exam-every generations the champion is run on
 * phrasings it has never been trained on — the same 49 goals, worded by
 * different sentences. Training fitness is not the number this project is
 * about. A brain that memorises 392 vectors will show a beautiful training
 * curve and a flat exam line, and without the exam you would not know which
 * one you had until you typed something new at it.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { loadSim } = require("./simload.js");

/* ------------------------------------------------------------------ worker */
if (!isMainThread) {
    loadSim(__dirname);
    parentPort.on("message", msg => {
        if (msg.type === "quit") process.exit(0);
        const { brains, tasks, opts } = msg;
        const nets = brains.map(b => Brain.fromJSON(b));
        const acc = nets.map(() => ({ fit: 0, del: 0, tgt: 0, mis: 0, comp: 0, perTask: [] }));
        tasks.forEach((tk, e) => {
            const task = TASKS[tk.idx];
            const w = new World(nets, {
                task, embedding: Embedding.forTask(task),
                sceneSeed: tk.sceneSeed, noiseSeed: tk.noiseSeed,
                maxBalls: opts.maxBalls, noise: opts.noise
            });
            let guard = 0;
            while (!w.isOver() && guard++ < 60 * 140) w.step();
            w.results().forEach((r, i) => {
                acc[i].fit += r.fitness; acc[i].del += r.delivered; acc[i].tgt += r.target;
                acc[i].mis += r.mistakes; acc[i].comp += r.completed;
                acc[i].perTask.push(+r.fitness.toFixed(1));
            });
        });
        parentPort.postMessage({ acc, n: tasks.length });
    });
    return;
}

/* -------------------------------------------------------------------- main */
loadSim(__dirname);

const argv = process.argv.slice(2);
function arg(n, d) { const i = argv.indexOf("--" + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; }
function flag(n) { return argv.includes("--" + n); }

const CFG = {
    gens: parseInt(arg("gens", "400"), 10),
    pop: parseInt(arg("pop", "60"), 10),
    episodes: parseInt(arg("episodes", "4"), 10),
    workers: parseInt(arg("workers", String(Math.max(1, Math.min(6, os.cpus().length - 2)))), 10),
    seed: parseInt(arg("seed", "42"), 10),
    mutRate: parseFloat(arg("mut-rate", "0.12")),
    mutSigma: parseFloat(arg("mut-sigma", "0.20")),
    grace: parseInt(arg("grace", "3"), 10),
    stageLock: parseInt(arg("stage-lock", "0"), 10),
    examEvery: parseInt(arg("exam-every", "20"), 10),
    examTasks: parseInt(arg("exam-tasks", "16"), 10),
    out: arg("out", "training"),
    resume: arg("resume", null),
    tag: arg("tag", "run")
};

const outDir = path.isAbsolute(CFG.out) ? CFG.out : path.join(__dirname, CFG.out);
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, `${CFG.tag}.log`);
function say(s) {
    const line = typeof s === "string" ? s : JSON.stringify(s);
    console.log(line);
    fs.appendFileSync(logFile, line + "\n");
}

say(`\n=== ${new Date().toISOString()} ===`);
say(`embedding: ${Embedding.mode}` + (Embedding.meta ? ` (${Embedding.meta.model}, ${Embedding.nativeDim}->${Embedding.dim})` : ""));
if (Embedding.warning) say(`! ${Embedding.warning}`);
if (Embedding.mode !== "qwen")
    say(`! running on the bag-of-words surrogate — held-out numbers from this run mean nothing.\n` +
        `  bake real vectors first:  node embed_tasks.js --model qwen3-embedding:8b`);
say(`config: ${JSON.stringify(CFG)}`);

const evo = new Evolution(CFG.pop, CFG.seed, Embedding.dim);
if (CFG.resume) {
    const p = path.isAbsolute(CFG.resume) ? CFG.resume : path.join(__dirname, CFG.resume);
    const saved = JSON.parse(fs.readFileSync(p, "utf8"));
    const seed = Brain.fromJSON(saved.brain);
    // Seed the whole population from the champion: rank 0 untouched, everyone
    // else a mutated copy. Resuming into a fresh random fleet throws away the
    // thing being resumed.
    evo.brains[0] = seed.clone();
    for (let i = 1; i < CFG.pop; i++)
        evo.brains[i] = seed.clone().mutate(CFG.mutRate * (0.5 + i / CFG.pop), CFG.mutSigma, evo.rng);
    evo.champion = seed.clone();
    evo.championFit = saved.fitness || 0;
    say(`resumed from ${CFG.resume} (gen ${saved.gen}, fitness ${(saved.fitness || 0).toFixed(0)})`);
}

/* ----------------------------------------------------------------- workers */
const pool = [];
for (let i = 0; i < CFG.workers; i++) pool.push(new Worker(__filename, { argv }));
function runSlice(worker, brains, tasks, opts) {
    return new Promise((resolve, reject) => {
        const onMsg = (m) => { worker.off("message", onMsg); worker.off("error", onErr); resolve(m); };
        const onErr = (e) => { worker.off("message", onMsg); worker.off("error", onErr); reject(e); };
        worker.on("message", onMsg);
        worker.on("error", onErr);
        worker.postMessage({ brains, tasks, opts });
    });
}

/* Score a list of brains on a list of tasks, split across the pool. */
async function scoreAll(brains, tasks, opts) {
    const per = Math.ceil(brains.length / pool.length);
    const jobs = [];
    for (let i = 0; i < pool.length; i++) {
        const slice = brains.slice(i * per, (i + 1) * per);
        if (!slice.length) continue;
        jobs.push(runSlice(pool[i], slice.map(b => b.toJSON()), tasks, opts)
            .then(r => ({ start: i * per, acc: r.acc })));
    }
    const parts = await Promise.all(jobs);
    const out = new Array(brains.length);
    for (const p of parts) p.acc.forEach((a, k) => { out[p.start + k] = a; });
    return out;
}

/* -------------------------------------------------------------- the exam */
async function exam(brain, gen) {
    const tasks = [];
    // One held-out phrasing per goal spec, spread over the whole bank, plus a
    // matched set of TRAINING phrasings of the same specs. The gap between the
    // two is the only honest measure of whether the language generalises: a
    // held-out score on its own confounds "cannot read new wording" with
    // "cannot do these particular goals".
    const specs = [...new Set(TASKS_HOLDOUT.map(t => t.specIdx))];
    const rng = mulberry32(777 + gen);
    for (let i = 0; i < CFG.examTasks; i++) {
        const si = specs[(i * 7 + 3) % specs.length];
        const hs = TASKS_HOLDOUT.filter(t => t.specIdx === si);
        const ts = TASKS_TRAIN.filter(t => t.specIdx === si);
        tasks.push({
            hold: hs[(rng() * hs.length) | 0],
            train: ts[(rng() * ts.length) | 0]
        });
    }
    const run = (task, seed) => {
        const w = new World([brain], {
            task, embedding: Embedding.forTask(task),
            sceneSeed: 90000 + seed, noiseSeed: 40000 + seed, maxBalls: 6, noise: 0.3
        });
        let g = 0;
        while (!w.isOver() && g++ < 60 * 140) w.step();
        const r = w.results()[0];
        return { rate: r.target > 0 ? r.delivered / r.target : 0, complete: r.completed };
    };
    let hr = 0, tr = 0, hc = 0, tc = 0;
    tasks.forEach((pair, i) => {
        const a = run(pair.hold, i * 3);
        const b = run(pair.train, i * 3);         // same scene seed: matched pair
        hr += a.rate; hc += a.complete;
        tr += b.rate; tc += b.complete;
    });
    const n = tasks.length;
    return {
        heldRate: hr / n, trainRate: tr / n,
        heldComplete: hc / n, trainComplete: tc / n
    };
}

/* -------------------------------------------------------------------- loop */
let stopping = false;
process.on("SIGINT", () => { stopping = true; say("\nstopping after this generation..."); });

(async function main() {
    const t0 = Date.now();
    for (let g = evo.gen; g <= CFG.gens && !stopping; g = evo.gen) {
        const stage = stageFor(g, evo.history, { stageLock: CFG.stageLock });
        evo.stage = stage.id;
        // The scene seed comes FROM the mission, not from the generation number.
        // A mission has to be the same problem every time it comes round, or the
        // bank is not stationary and nothing compounds. See evolution.js.
        const tasks = drawMissions(stage, g, CFG.episodes).map(m => ({
            idx: TASKS.indexOf(m.task),
            sceneSeed: m.sceneSeed,
            noiseSeed: m.noiseSeed
        }));
        const acc = await scoreAll(evo.brains, tasks, { maxBalls: stage.maxBalls, noise: stage.noise });
        const E = CFG.episodes;
        const results = evo.brains.map((b, i) => ({
            brain: b,
            fitness: acc[i].fit / E,
            delivered: acc[i].del / E,
            rate: acc[i].tgt > 0 ? acc[i].del / acc[i].tgt : 0,
            mistakes: acc[i].mis / E,
            completed: acc[i].comp / E
        }));
        const rec = evo.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.grace, {});
        const el = (Date.now() - t0) / 1000;
        say(`gen ${String(g).padStart(4)} | stage ${stage.id} ${stage.name.padEnd(18)} | ` +
            `best ${rec.best.toFixed(0).padStart(6)} avg ${rec.avg.toFixed(0).padStart(6)} | ` +
            `balls best/top25/mean ${rec.bestDel.toFixed(2)}/${rec.topDel.toFixed(2)}/${rec.avgDel.toFixed(2)} | ` +
            `rate ${(rec.avgRate * 100).toFixed(0)}% | done ${(rec.complete * 100).toFixed(0)}% | ` +
            `mist ${rec.mistakes.toFixed(1)} | ${(el / g).toFixed(1)}s/gen`);

        if (g % CFG.examEvery === 0 && evo.champion) {
            const ex = await exam(evo.champion, g);
            say(`   EXAM gen ${g}: trained phrasings ${(ex.trainRate * 100).toFixed(0)}% balls / ` +
                `${(ex.trainComplete * 100).toFixed(0)}% tasks  ·  ` +
                `HELD-OUT phrasings ${(ex.heldRate * 100).toFixed(0)}% balls / ` +
                `${(ex.heldComplete * 100).toFixed(0)}% tasks`);
            fs.writeFileSync(path.join(outDir, `${CFG.tag}_exam.json`),
                JSON.stringify({ gen: g, ...ex }, null, 1));
        }
        if (g % 10 === 0 && evo.champion) {
            fs.writeFileSync(path.join(outDir, "champion.json"), JSON.stringify({
                gen: g, fitness: evo.championFit, championGen: evo.championGen,
                stage: stage.id, embDim: Embedding.dim,
                embModel: Embedding.meta ? Embedding.meta.model : "surrogate",
                corpusHash: corpusHash(),
                brain: evo.champion.toJSON()
            }));
            fs.writeFileSync(path.join(outDir, `${CFG.tag}_history.json`), JSON.stringify(evo.history));
        }
    }
    if (evo.champion) {
        fs.writeFileSync(path.join(outDir, "champion.json"), JSON.stringify({
            gen: evo.gen - 1, fitness: evo.championFit, championGen: evo.championGen,
            stage: evo.stage, embDim: Embedding.dim,
            embModel: Embedding.meta ? Embedding.meta.model : "surrogate",
            corpusHash: corpusHash(),
            brain: evo.champion.toJSON()
        }));
        const ex = await exam(evo.champion, evo.gen);
        say(`FINAL exam: trained ${(ex.trainRate * 100).toFixed(0)}% · held-out ${(ex.heldRate * 100).toFixed(0)}%`);
    }
    say(`done: ${evo.gen - 1} generations, champion ${evo.championFit.toFixed(0)} from gen ${evo.championGen}`);
    pool.forEach(w => w.postMessage({ type: "quit" }));
    setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error(e); process.exit(1); });
