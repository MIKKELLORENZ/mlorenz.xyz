/* train.js — headless trainer. Same code as the browser, many more cores.
 *
 *   node train.js --gens 300 --pop 96 --workers 6
 *   node train.js --gens 4000 --pop 256 --episodes 10 --workers 60     (big box)
 *   node train.js --resume training/checkpoint.json --gens 500
 *   node train.js --init training/bc.json                              (start from a distilled brain)
 *   node train.js --lin cardiac                                        (one product only, for debugging)
 *   node train.js --bake training/checkpoint.json                      → default_brain.js
 *
 * One episode is fifteen to twenty-seven days of culture at one control step
 * an hour — 360 to 648 decisions — and costs 30–60 ms, so a population of a
 * few hundred over ten scenarios is a few seconds a generation on one core and
 * parallelises almost perfectly. The main thread owns the Evolution object;
 * the workers own nothing but the sim code.
 *
 * FIVE PRODUCTS, ONE BRAIN. Every generation's episode plan rotates the
 * ordered product as well as the difficulty rung (see episodePlan in
 * evolution.js), and the held-out exam covers all five. That matters more
 * than it sounds: the mean advantage of a brain that has learned four
 * protocols and abandoned the fifth looks perfectly healthy, so the exam
 * reports the WEAKEST product as well as the mean, and the difficulty ratchet
 * will not promote until the weakest one is respectable. Otherwise the search
 * discovers that ignoring hepatocytes is cheaper than making them.
 *
 * BE A GOOD NEIGHBOUR. Pass --workers explicitly on a shared machine.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
require("./harness.js");
const { loadBrainFile } = require("./brainfile.js");

/* ------------------------------------------------------------------ worker */
if (!isMainThread) {
    parentPort.on("message", (msg) => {
        if (msg.stop) { process.exit(0); return; }
        /* Held-out exam: several brains over an explicit (seed, level, lineage)
         * list, every (brain, episode) pair one job, dealt across the pool. */
        if (msg.exam) {
            const nets = msg.nets.map(n => Net.fromJSON(n));
            const out = msg.jobs.map(j => {
                const w = new World([nets[j.ni]], { seed: j.seed, level: j.level, lin: j.lin, withNothing: false });
                w.run();
                const r = w.results()[0];
                return {
                    ni: j.ni, level: j.level, lin: j.lin, fit: normalizeFitness(r.advantage), adv: r.advantage,
                    failed: r.failed ? 1 : 0, purity: r.purity, fold: r.fold, func: r.func,
                    score: r.score, sop: w.sop.result.score
                };
            });
            parentPort.postMessage({ idx: msg.idx, exam: out });
            return;
        }
        const nets = msg.brains.map(b => Net.fromJSON(b));
        const out = nets.map(() => ({ fitness: 0, survival: 0, boundaryErr: 0, adv: 0 }));
        msg.plan.forEach((ep) => {
            const w = new World(nets, { seed: ep.seed, level: ep.level, lin: ep.lin, withNothing: false });
            w.run();
            w.results().forEach((r, i) => {
                out[i].fitness += normalizeFitness(r.advantage) / msg.plan.length;
                out[i].adv += r.advantage / msg.plan.length;
                out[i].survival += (r.failed ? 0 : 1) / msg.plan.length;
                out[i].boundaryErr += (1 - r.purity) / msg.plan.length;
            });
        });
        parentPort.postMessage({ idx: msg.idx, out });
    });
    return;
}

/* -------------------------------------------------------------------- main */
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
    // ten by default: two passes of the five products
    episodes: parseInt(arg("episodes", 10), 10),
    workers: parseInt(arg("workers", Math.max(1, Math.min(6, os.cpus().length - 2))), 10),
    mutRate: parseFloat(arg("mutrate", 0.10)),
    // Relative to each layer's init scale. 1.0, not the 0.35 the tokamak uses:
    // with the near-zero output init a 5 µM dose is an output of +0.4, and at
    // 0.35 the search shaved cost for 850 generations without ever producing a
    // product cell. Use 0.35 again when starting from a distilled brain
    // (--init), whose scales are calibrated to its real weights.
    mutSigma: parseFloat(arg("mutsigma", arg("init", null) ? 0.35 : 1.0)),
    grace: parseInt(arg("grace", 3), 10),
    seed: parseInt(arg("seed", (Date.now() % 1e9) | 0), 10),
    out: String(arg("out", "training")),
    resume: arg("resume", null),
    init: arg("init", null),
    every: parseInt(arg("every", 10), 10),
    // consecutive generations sharing one draw of the scenario bank
    seedBlock: parseInt(arg("seedblock", 2), 10),
    /* GENERATIONS PER EXAM BANK. The held-out bank used to be fixed for the
     * whole run, and that deadlocks: the champion is only replaced when a
     * candidate BEATS the running best on that bank, so one lucky draw becomes
     * an unbeatable high-water mark and the champion - and therefore the
     * ratchet, and therefore the whole run - freezes. Two runs sat for 350
     * generations with a byte-identical exam line before this was spotted.
     * Rotating the bank costs the guarantee that scores are comparable across
     * epochs, which is why every epoch's best is ARCHIVED and shipping is
     * decided by a separate large paired duel, never by this number. */
    examRot: parseInt(arg("examrot", 150), 10),
    level: parseInt(arg("level", 0), 10),
    maxLevel: parseInt(arg("maxlevel", N_LEVELS - 1), 10),
    // one product only, for debugging a single protocol
    lin: arg("lin", null),
    // promote when the champion's held-out advantage on the top rung clears
    // `promote`, rung 0 still clears `anchor`, and the WEAKEST product clears
    // `minlin` — held for `promotehold` checks running
    promoteFit: parseFloat(arg("promote", 1.0)),
    anchorFit: parseFloat(arg("anchor", 1.0)),
    minLinFit: parseFloat(arg("minlin", 0.5)),
    promoteHold: parseInt(arg("promotehold", 3), 10),
    tag: String(arg("tag", "bioreactor"))
};
if (CFG.workers > os.cpus().length) {
    console.warn(`--workers ${CFG.workers} exceeds ${os.cpus().length} cores; capping`);
    CFG.workers = os.cpus().length;
}
const ONLY_LIN = CFG.lin == null ? null : (LIN_BY_KEY[String(CFG.lin)] ? LIN_BY_KEY[String(CFG.lin)].idx : parseInt(CFG.lin, 10));
const LIN_SET = ONLY_LIN == null ? LINEAGES.map((_, i) => i) : [ONLY_LIN];

/* ------------------------------------------------------------------- bake */
if (arg("bake", null)) {
    const src = loadBrainFile(String(arg("bake")));
    const net = src.net || src;
    const body = "/* default_brain.js — generated by train.js. Drop-in champion.\n" +
        ` * generation ${src.gen || "?"} · rung ${src.level != null ? src.level : "?"} · exam advantage ${src.examFit != null ? src.examFit.toFixed(3) : "?"} */\n` +
        "window.DEFAULT_BRAIN = " + JSON.stringify({
            format: "bioreactor-brain-v2", gen: src.gen, level: src.level, exam: src.examFit,
            byLevel: src.byLevel, byLin: src.byLin, sizes: net.sizes, net
        }) + ";\n";
    fs.writeFileSync(path.join(__dirname, "default_brain.js"), body);
    console.log(`wrote default_brain.js (${net.sizes.join("×")})`);
    process.exit(0);
}

if (!fs.existsSync(path.join(__dirname, CFG.out))) fs.mkdirSync(path.join(__dirname, CFG.out), { recursive: true });

const evo = new Evolution(CFG.pop, CFG.seed, NET_SIZES);
let startGen = 1;
function seedFrom(file, label) {
    const ck = loadBrainFile(String(file));
    if (JSON.stringify(ck.net.sizes) !== JSON.stringify(NET_SIZES)) {
        console.error(`${label} failed: brain is ${ck.net.sizes.join("×")}, this run is ${NET_SIZES.join("×")}`);
        process.exit(1);
    }
    // Seed the whole population from the one brain and let mutation spread it
    // back out. calibrateScales() matters for a distilled brain: its output
    // layer is far wider than its init and a mutation scaled to the init
    // would be a rounding error.
    const champ = Net.fromJSON(ck.net).calibrateScales();
    for (let i = 0; i < evo.brains.length; i++) {
        evo.brains[i] = i === 0 ? champ.clone() : champ.clone().mutate(CFG.mutRate, CFG.mutSigma, evo.rng);
    }
    evo.champion = champ.clone();
    return ck;
}
if (CFG.resume) {
    const ck = seedFrom(CFG.resume, "resume");
    evo.history = ck.history || [];
    evo.gen = (ck.gen || 1) + 1;
    startGen = evo.gen;
    if (ck.level != null && arg("level", null) === null) CFG.level = ck.level;
    console.log(`resumed from ${CFG.resume} at generation ${ck.gen}` + (ck.level != null ? ` (rung ${ck.level})` : ""));
} else if (CFG.init) {
    seedFrom(CFG.init, "init");
    console.log(`population seeded from ${CFG.init}`);
}

/* ------------------------------------------------------------------ pool */
const workers = [];
for (let i = 0; i < CFG.workers; i++) workers.push(new Worker(__filename, { workerData: {} }));
function ask(w, msg) {
    return new Promise(res => {
        const on = (m) => { w.off("message", on); res(m); };
        w.on("message", on);
        w.postMessage(msg);
    });
}

/* ---------------------------------------------------------- held-out exam */
/* Fixed seeds no training generation ever draws (the training bank uses
 * block×131 + e×17 + 1, all below 1e6). Every candidate is a paired
 * comparison on identical scenarios. */
const EXAM_BASE = 900001;
async function examJobs(nets, jobs) {
    const netJSON = nets.map(n => n.toJSON());
    const per = Math.ceil(jobs.length / workers.length);
    const parts = await Promise.all(workers.map((w, i) => {
        const mine = jobs.slice(i * per, Math.min(jobs.length, (i + 1) * per));
        if (!mine.length) return Promise.resolve({ exam: [] });
        return ask(w, { exam: true, idx: i, nets: netJSON, jobs: mine });
    }));
    const all = parts.flatMap(p => p.exam);
    const mean = (rows, f) => rows.length ? rows.reduce((a, b) => a + f(b), 0) / rows.length : 0;
    const group = (rows, key) => {
        const g = {};
        for (const r of rows) (g[r[key]] || (g[r[key]] = [])).push(r);
        return Object.fromEntries(Object.entries(g).map(([k, rs]) => [k, {
            fit: mean(rs, r => r.fit), adv: mean(rs, r => r.adv), failRate: mean(rs, r => r.failed),
            purity: mean(rs, r => r.purity), fold: mean(rs, r => r.fold), func: mean(rs, r => r.func), n: rs.length
        }]));
    };
    return nets.map((_, ni) => {
        const mine = all.filter(r => r.ni === ni);
        const byLin = group(mine, "lin");
        const linFits = Object.values(byLin).map(v => v.fit);
        return {
            fit: mean(mine, r => r.fit), adv: mean(mine, r => r.adv), failRate: mean(mine, r => r.failed),
            purity: mean(mine, r => r.purity), fold: mean(mine, r => r.fold), score: mean(mine, r => r.score),
            sop: mean(mine, r => r.sop),
            level: group(mine, "level"), lin: byLin,
            // the number that catches a brain which has quietly given up on one
            // of the five products
            worstLin: linFits.length ? Math.min(...linFits) : -9
        };
    });
}
/* Spread across every unlocked rung and every product, `seeds` scenarios each. */
async function examStage(nets, seeds, maxLevel, rot) {
    const jobs = [];
    for (let ni = 0; ni < nets.length; ni++) {
        for (const li of LIN_SET) {
            for (let L = 0; L <= maxLevel; L++) {
                for (let k = 0; k < seeds; k++) jobs.push({ ni, seed: EXAM_BASE + (rot || 0) * 104729 + k * 9173 + L * 37 + li * 5, level: L, lin: li });
            }
        }
    }
    return await examJobs(nets, jobs);
}

function evaluateGeneration(plan) {
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
            w.postMessage({ idx: from, brains: nets.slice(from, to), plan });
        });
        if (pending === 0) resolve(results);
    });
}

/* The plan for a generation, with the product rotated as well as the rung. */
function planFor(block, level) {
    const plan = episodePlan(CFG.episodes, block, level);
    if (ONLY_LIN != null) for (const ep of plan) ep.lin = ONLY_LIN;
    return plan;
}

console.log(`bioreactor trainer [${CFG.tag}] — pop ${CFG.pop}, ${CFG.episodes} episodes/gen, ${CFG.workers} workers, ` +
    `net ${NET_SIZES.join("×")}, seed ${CFG.seed}`);
console.log(`products: ${LIN_SET.map(i => LINEAGES[i].key).join(", ")}`);
console.log(`difficulty ladder: start L${CFG.level} (${difficultyOf(CFG.level).label}), cap L${CFG.maxLevel} ` +
    `(${difficultyOf(CFG.maxLevel).label}); promote at top ≥ ${CFG.promoteFit} with rung 0 ≥ ${CFG.anchorFit} ` +
    `and the weakest product ≥ ${CFG.minLinFit}, held ${CFG.promoteHold}`);

let bestExam = -1e18, bestExamLite = -1e18, lastLevelSeen = null, lastRotSeen = null;
let level = Math.max(0, Math.min(N_LEVELS - 1, CFG.level));
let promoteRun = 0;

(async function run() {
    const t0 = Date.now();
    for (let g = startGen; g < startGen + CFG.gens; g++) {
        const block = Math.floor((g - 1) / CFG.seedBlock);
        const rot = Math.floor((g - 1) / CFG.examRot);
        const plan = planFor(block, level);
        const raw = await evaluateGeneration(plan);
        const results = evo.brains.map((brain, i) => ({
            brain, fitness: raw[i].fitness, survival: raw[i].survival, boundaryErr: raw[i].boundaryErr
        }));
        const rec = evo.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.grace, {}, { stage: level });

        /* The champion is decided by a HELD-OUT exam over the top three
         * candidates on training score, never by the training score itself. */
        const cands = results.sort((a, b) => b.fitness - a.fitness).slice(0, 3).map(r => r.brain);
        const exAll = (await examStage(cands, 2, level, rot)).map(r => r.fit);
        let bi = 0;
        for (let i = 1; i < exAll.length; i++) if (exAll[i] > exAll[bi]) bi = i;
        if (level !== lastLevelSeen || rot !== lastRotSeen) {
            bestExamLite = -1e18; bestExam = -1e18; lastLevelSeen = level; lastRotSeen = rot;
        }
        if (exAll[bi] > bestExamLite) { bestExamLite = exAll[bi]; evo.champion = cands[bi].clone(); }

        if (g % CFG.every === 0 || g === startGen) {
            const gate = (await examStage([evo.champion], 4, level, rot))[0];
            const better = gate.fit > bestExam;
            if (better) bestExam = gate.fit;
            /* THE RATCHET: up a rung when the champion is at least
             * protocol-good on the hardest rung, still protocol-good on the
             * easiest, and has not abandoned any one of the five products. */
            const examLevel = level;
            const top = gate.level[examLevel] || { fit: -9 }, anchor = gate.level[0] || { fit: -9 };
            const ready = level < CFG.maxLevel && top.fit >= CFG.promoteFit &&
                anchor.fit >= CFG.anchorFit && gate.worstLin >= CFG.minLinFit;
            promoteRun = ready ? promoteRun + 1 : 0;
            let promoted = null;
            if (promoteRun >= CFG.promoteHold) {
                level++; promoteRun = 0;
                promoted = `        ── difficulty ${level - 1} → ${level} (${difficultyOf(level).label}): ` +
                    `top rung ${top.fit.toFixed(2)} ≥ ${CFG.promoteFit}, rung 0 held at ${anchor.fit.toFixed(2)}, ` +
                    `weakest product ${gate.worstLin.toFixed(2)}`;
            }
            const el = (Date.now() - t0) / 1000;
            /* PER PRODUCT, ON THE SCALE SELECTION ACTUALLY USES. These print
             * the CLAMPED fit, not the raw advantage, because the raw number
             * is unbounded above and a single product can run away with it:
             * one run showed `beta 7.99` beside `card 0.18`, which reads like
             * the search collapsing into a beta specialist when in fact every
             * gate - worstLin, the ratchet, and which checkpoint gets written
             * - is computed from the clamped fit and was bounded all along.
             * Mixing the two scales on one log line fooled its own author. */
            const perLin = LIN_SET.map(i => {
                const v = gate.lin[i];
                return `${LINEAGES[i].key.slice(0, 4)} ${v ? v.fit.toFixed(2) : "—"}`;
            }).join(" ");
            console.log(
                `gen ${String(evo.gen - 1).padStart(5)}  L${examLevel}/${CFG.maxLevel} ${difficultyOf(examLevel).label.padEnd(15)} ` +
                `train best ${rec.best.toFixed(3)} mean ${rec.avg.toFixed(3)} alive ${(rec.avgSurv * 100).toFixed(0)}%  ` +
                `| EXAM fit ${gate.fit.toFixed(3)} (raw ${gate.adv.toFixed(3)}) purity ${(gate.purity * 100).toFixed(0)}% fail ${(gate.failRate * 100).toFixed(0)}% ` +
                `score ${gate.score.toFixed(0)} (SOP ${gate.sop.toFixed(0)})  | ${perLin}  worst ${gate.worstLin.toFixed(2)}  ` +
                `| rung0 ${anchor.fit.toFixed(2)} top ${top.fit.toFixed(2)}${better ? "  ★" : ""}  ` +
                `[${el.toFixed(0)}s, ${((evo.gen - startGen) / el).toFixed(2)} gen/s]`);
            if (promoted) console.log(promoted);
            const payload = (hist) => JSON.stringify({
                format: "bioreactor-brain-v2", gen: evo.gen - 1, examFit: gate.fit, exam: gate, level,
                byLevel: gate.level, byLin: gate.lin, worstLin: gate.worstLin,
                sizes: NET_SIZES, net: evo.champion.toJSON(), history: hist
            });
            /* checkpoint.json is the best of the CURRENT epoch, not of the
             * run - the marks reset when the bank rotates. The archive is what
             * you duel at the end. */
            if (better) {
                fs.writeFileSync(path.join(__dirname, CFG.out, "checkpoint.json"), payload(evo.history));
                fs.writeFileSync(path.join(__dirname, CFG.out, `champ_e${rot}_g${evo.gen - 1}.json`), payload(undefined));
            }
            fs.writeFileSync(path.join(__dirname, CFG.out, "latest.json"), payload(undefined));
            fs.writeFileSync(path.join(__dirname, CFG.out, "history.json"), JSON.stringify(evo.history));
        }
        if (evo.graceEvent) console.log(`        ${evo.graceEvent}`);
    }
    for (const w of workers) w.postMessage({ stop: true });
    console.log(`\ndone. best exam ${bestExam.toFixed(3)} — ${path.join(CFG.out, "checkpoint.json")}`);
    console.log(`bake it into the page with:  node train.js --bake ${path.join(CFG.out, "checkpoint.json")}`);
    process.exit(0);
})();
