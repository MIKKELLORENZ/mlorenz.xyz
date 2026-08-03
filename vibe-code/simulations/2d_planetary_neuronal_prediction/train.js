/* train.js — headless trainer. Same code as the browser, many more cores.
 *
 *   node train.js --gens 400 --pop 96 --workers 6
 *   node train.js --gens 3000 --pop 512 --trials 6 --workers 96      (big box)
 *   node train.js --mode raw --image 0 --mem 0                        (ablations)
 *   node train.js --resume training/checkpoint.json --gens 500
 *   node train.js --eval training/checkpoint.json                     (full report)
 *   node train.js --bake training/checkpoint.json                     → default_brain.js
 *
 * SCALING. One rollout touches nothing but its own state, so this parallelises
 * almost perfectly. The expensive part of a generation is not the brains, it is
 * integrating the ground truth — and that is shared: every worker builds the
 * same trial set once per seed block and caches it, so a population of 512
 * costs barely more setup than a population of 32.
 *
 * BE A GOOD NEIGHBOUR. The default worker count deliberately leaves cores free.
 * On a shared machine pass --workers explicitly; a trainer that saturates a box
 * gets itself killed.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const SIM_FILES = ["nn.js", "physics.js", "model.js", "world.js", "evolution.js"];
function loadSim() {
    for (const f of SIM_FILES) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    }
}

/* Trial sets are the expensive thing to build, and every worker needs the very
 * same one — that is the point of common random numbers. Caching them by key
 * means a seed block that spans three generations pays the truth-integration
 * cost once instead of three times per worker. */
function makeTrialCache() {
    let key = null, set = null;
    return function (k, build) {
        if (k !== key) { key = k; set = build(); }
        return set;
    };
}

/* ------------------------------------------------------------------ worker */
if (!isMainThread) {
    loadSim();
    setModelCfg(workerData.model);
    const cache = makeTrialCache();
    const trialsFor = (msg) => cache(msg.key, () => new TrialSet(msg.seeds, {
        level: msg.level, tickFrac: msg.tickFrac, tickRange: msg.tickRange, horizon: msg.horizon
    }));

    parentPort.on("message", (msg) => {
        if (msg.stop) { process.exit(0); return; }
        const ts = trialsFor(msg);

        // Baselines run on the pool too. They are cheap, but they are needed on
        // exactly the same trial set as the brains for the comparison to mean
        // anything, and doing them on the main thread would serialise them.
        if (msg.baselines) {
            const out = {};
            for (const b of msg.baselines) {
                const r = b === "drift" ? DRIFT_RUNNER
                    : b === "newton" ? NEWTON_RUNNER
                        : b === "adams3" ? adamsRunner(3)
                            : newtonSubRunner(parseInt(b.split("x")[1], 10));
                out[b] = ts.evaluate(r).digits;
            }
            parentPort.postMessage({ idx: msg.idx, baseline: out });
            return;
        }

        const out = msg.brains.map(j => {
            const p = Predictor.fromJSON(j);
            const ev = ts.evaluate(predictorRunner(p));
            return { fitness: fitnessOf(ev), digits: ev.digits, worst: ev.worst, blew: ev.blew };
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
const bool = (v, d) => v === undefined || v === null ? d : (v === true || v === "1" || v === "true");

const MODEL = {
    mode: String(arg("mode", "phys")),
    image: bool(arg("image", null), false),
    mem: parseInt(arg("mem", 8), 10),
    // Default 0 to match the shipped architecture (see model.js); --lags 4
    // turns the multistep machinery on.
    lags: parseInt(arg("lags", 0), 10),
    rounds: parseInt(arg("rounds", 2), 10),
    grid: parseInt(arg("grid", 8), 10),
    // "zero" (default) makes phase 2 discover its own integration scheme;
    // "ab3" hands it the classical one to improve on. See model.js.
    schedInit: String(arg("schedinit", "zero"))
};
setModelCfg(MODEL);

const CFG = {
    gens: parseInt(arg("gens", 300), 10),
    pop: parseInt(arg("pop", 96), 10),
    trials: parseInt(arg("trials", 4), 10),
    workers: parseInt(arg("workers", Math.max(1, Math.min(6, os.cpus().length - 2))), 10),
    mutRate: parseFloat(arg("mutrate", 0.12)),
    mutSigma: parseFloat(arg("mutsigma", 0.4)),   // relative to each layer's init scale
    grace: parseInt(arg("grace", 3), 10),
    tickFrac: parseFloat(arg("tickfrac", 0.02)),
    /* Train over a RANGE of step sizes instead of one.
     *
     * `--tickmin 28 --tickmax 110` draws each training system a tick length,
     * log-uniformly, in ticks per fastest orbit. The floor cannot go below
     * MIN_TICKS_PER_ORBIT (20) or the generator rejects every draw and the run
     * silently produces nothing.
     *
     * The exam spans the SAME range — see examJob for why examining at a fixed
     * step while training over a range makes the checkpoint gate unfireable. */
    tickMin: parseFloat(arg("tickmin", 0)),
    tickMax: parseFloat(arg("tickmax", 0)),
    seed: parseInt(arg("seed", (Date.now() % 1e9) | 0), 10),
    out: String(arg("out", "training")),
    resume: arg("resume", null),
    // Phase 2: widen a checkpoint trained with fewer lags. See below.
    graft: arg("graft", null),
    every: parseInt(arg("every", 10), 10),
    // How many consecutive generations share one draw of trial systems. With a
    // fresh draw every generation the score is dominated by which systems you
    // happened to get and the champion is whoever was lucky; holding it for a
    // block lets selection see the brain instead of the draw.
    seedBlock: parseInt(arg("seedblock", 3), 10),
    level: parseInt(arg("level", 0), 10),
    maxLevel: parseInt(arg("maxlevel", N_LEVELS - 1), 10),
    // The promotion bar is set RELATIVE to what coarse Newton scores on the same
    // rung, not as an absolute number of digits. Achievable accuracy falls as
    // the systems get nastier, so an absolute bar would either be unreachable at
    // the top or trivial at the bottom — and "beats the analytic force law it is
    // competing with" is the only threshold that means the same thing on every
    // rung.
    promoteMargin: parseFloat(arg("promote", 0.05)),
    // Which baseline the promotion bar is measured against: "adams3" (the real
    // competitor) or "newton" (the old, now far too easy, one).
    promoteRef: String(arg("promoteref", "adams3")),
    promoteHold: parseInt(arg("promotehold", 2), 10)
};

/* Resolve the step-size range, and refuse a bad one loudly.
 *
 * A floor below MIN_TICKS_PER_ORBIT is the dangerous mistake here, because the
 * resolution rule is GLOBAL rather than per-draw: the tick is *defined* as
 * fastestOrbit/N, so "reject systems under 20 ticks per orbit" rejects either
 * none of them or all of them. Set the floor too low and the generator returns
 * nothing, the trial set comes back empty, and the run trains happily on zero
 * systems while printing plausible numbers. */
CFG.tickRange = null;
if (CFG.tickMin > 0 || CFG.tickMax > 0) {
    const lo = CFG.tickMin > 0 ? CFG.tickMin : 1 / CFG.tickFrac;
    const hi = CFG.tickMax > 0 ? CFG.tickMax : 1 / CFG.tickFrac;
    if (!(lo >= MIN_TICKS_PER_ORBIT)) {
        console.error(`--tickmin ${lo} is below the generator's floor of ${MIN_TICKS_PER_ORBIT} ` +
            `ticks per orbit. Every system would be rejected and the run would train on nothing.`);
        process.exit(1);
    }
    if (!(hi > lo)) {
        console.error(`--tickmax ${hi} must be greater than --tickmin ${lo}.`);
        process.exit(1);
    }
    CFG.tickRange = [lo, hi];
}

/* -------------------------------------------------------------------- bake */
if (arg("bake", null)) {
    const src = JSON.parse(fs.readFileSync(String(arg("bake")), "utf8"));
    const net = src.net || src.champion || src;
    const body = "/* default_brain.js — generated by train.js. Drop-in champion.\n" +
        ` * ${src.label || "?"} · generation ${src.gen || "?"} · exam ${src.exam != null ? src.exam.toFixed(3) : "?"} digits` +
        ` (Newton ${src.newton != null ? src.newton.toFixed(3) : "?"}) */\n` +
        "window.DEFAULT_BRAIN = " + JSON.stringify({
            format: "planet-brain-v1", model: src.model, gen: src.gen,
            exam: src.exam, newton: src.newton, level: src.level, net
        }) + ";\n";
    fs.writeFileSync(path.join(__dirname, "default_brain.js"), body);
    console.log(`wrote default_brain.js (${(JSON.stringify(net).length / 1024).toFixed(0)} kB)`);
    process.exit(0);
}

if (!fs.existsSync(path.join(__dirname, CFG.out))) {
    fs.mkdirSync(path.join(__dirname, CFG.out), { recursive: true });
}

/* ------------------------------------------------------------------ pool */
const workers = [];
for (let i = 0; i < CFG.workers; i++) {
    workers.push(new Worker(__filename, { workerData: { model: MODEL } }));
}
function ask(w, msg) {
    return new Promise(res => {
        const on = (m) => { w.off("message", on); res(m); };
        w.on("message", on);
        w.postMessage(msg);
    });
}

/* ---------------------------------------------------------- held-out exam */
/* Training scores are measured on the very systems the population was selected
 * against, so the best line is partly luck. The exam uses a different salt —
 * systems no generation has ever trained on — and only it decides who is
 * champion. The seeds are FIXED, which makes every candidate's exam a paired
 * comparison on identical systems: two brains differing by one mutation are
 * ranked on their difference, not on which draw each happened to get. */
const EXAM_SALT = 0x5EED1;
const TRAIN_SALT = 0;

/* A label for what the exam actually measures, so a resumed run can tell whether
 * an inherited high-water mark is even comparable. */
const EXAM_TICKS = CFG.tickRange ? `${CFG.tickRange[0]}-${CFG.tickRange[1]}` : String(Math.round(1 / CFG.tickFrac));

/* THE EXAM SPANS THE SAME STEP SIZES AS TRAINING, and getting this wrong cost a
 * run. The first attempt trained over randomised steps but examined at the fixed
 * shipped step, reasoning that it kept the reported digits comparable with
 * earlier runs. That is selection measuring something other than the objective:
 * breadth across step sizes costs accuracy at any single one, so the exam score
 * fell from 2.044 to 1.78 while the population was doing exactly what it had
 * been asked to, the checkpoint gate never fired once in 480 generations, and
 * the run could not have produced anything no matter how long it ran.
 *
 * Comparability is recovered afterwards instead, by running `--eval` at a fixed
 * step — which is a report, not a selection pressure, and so is free to differ. */
function examJob(level, seeds) {
    return {
        key: `exam|${level}|${seeds}|${EXAM_TICKS}`,
        seeds: seedsFor(level * 31 + 7, seeds, EXAM_SALT),
        level, tickFrac: CFG.tickFrac, tickRange: CFG.tickRange
    };
}

/* Examine several brains across every unlocked rung, in one batched pass. Each
 * (brain, rung) pair is a job; the whole set is dealt across the pool at once,
 * so three candidates cost barely more wall-clock than one. */
async function exam(nets, maxLevel) {
    const json = nets.map(n => n.toJSON());
    const jobs = [];
    for (let L = 0; L <= maxLevel; L++) {
        for (let ni = 0; ni < nets.length; ni++) jobs.push({ L, ni });
    }
    const per = Math.ceil(jobs.length / workers.length);
    const parts = await Promise.all(workers.map((w, i) => {
        const mine = jobs.slice(i * per, Math.min(jobs.length, (i + 1) * per));
        if (!mine.length) return Promise.resolve([]);
        // One message per (brain, rung) — the worker's trial-set cache makes the
        // repeated builds free within a rung.
        return (async () => {
            const res = [];
            for (const j of mine) {
                const m = await ask(w, Object.assign(examJob(j.L, 4), { idx: 0, brains: [json[j.ni]] }));
                res.push({ L: j.L, ni: j.ni, digits: m.out[0].digits, worst: m.out[0].worst, blew: m.out[0].blew });
            }
            return res;
        })();
    }));
    const all = parts.flat();
    return nets.map((_, ni) => {
        const mine = all.filter(r => r.ni === ni);
        const byLevel = {};
        for (const r of mine) byLevel[r.L] = { digits: r.digits, worst: r.worst, blew: r.blew };
        return {
            digits: mine.reduce((a, b) => a + b.digits, 0) / Math.max(1, mine.length),
            blew: mine.reduce((a, b) => a + b.blew, 0),
            byLevel
        };
    });
}

/* The analytic competitors, measured on the exam systems. Everything the run
 * prints is relative to these — "2.4 digits" means nothing on its own, "0.3
 * digits above coarse Newton" is the entire result. */
/* `adams3` is the one that matters. Plain Newton is the naive competitor and
 * Newton×8 is a ruler nobody is allowed to use; Adams-Bashforth 3 is what a
 * competent implementer would actually write under this exact budget, so it is
 * the number a claim of "the network learned something" has to clear. */
const REF = { drift: [], newton: [], adams3: [], sub8: [] };
async function measureBaselines(maxLevel) {
    for (let L = 0; L <= maxLevel; L++) {
        const m = await ask(workers[L % workers.length],
            Object.assign(examJob(L, 4), { idx: 0, baselines: ["drift", "newton", "adams3", "newtonx8"] }));
        REF.drift[L] = m.baseline.drift;
        REF.newton[L] = m.baseline.newton;
        REF.adams3[L] = m.baseline.adams3;
        REF.sub8[L] = m.baseline.newtonx8;
    }
}

/* ------------------------------------------------------------- eval report */
if (arg("eval", null)) {
    (async function () {
        const ck = JSON.parse(fs.readFileSync(String(arg("eval")), "utf8"));
        // Re-spawn the pool with the CHECKPOINT's architecture, whatever the
        // command line said. The workers already running were built from the
        // --mode/--mem/--image flags, and evaluating a genome inside workers
        // configured for different widths produces confident nonsense rather
        // than an error. Unconditional: skipping the teardown when the file
        // carries no `model` block leaks the old pool and evaluates against it.
        for (const w of workers) w.postMessage({ stop: true });
        workers.length = 0;
        if (ck.model) setModelCfg(ck.model);
        for (let i = 0; i < CFG.workers; i++) workers.push(new Worker(__filename, { workerData: { model: MODEL_CFG } }));
        const net = Predictor.fromJSON(ck.net);
        await measureBaselines(N_LEVELS - 1);
        const ex = (await exam([net], N_LEVELS - 1))[0];
        console.log(`\n${ck.label || specLabel()} — generation ${ck.gen}, trained to rung ${ck.level}`);
        console.log(`\n  rung          bodies   do-nothing   Newton      AB3   Newton×8    BRAIN   vs Newton   vs AB3`);
        for (let L = 0; L < N_LEVELS; L++) {
            const lv = levelOf(L), b = ex.byLevel[L];
            const d = b.digits - REF.newton[L];
            const da = b.digits - REF.adams3[L];
            console.log(`  L${L} ${lv.label.padEnd(10)} ${(lv.nMin + "-" + lv.nMax).padStart(5)}   ` +
                `${REF.drift[L].toFixed(3).padStart(10)}   ${REF.newton[L].toFixed(3).padStart(6)}   ` +
                `${REF.adams3[L].toFixed(3).padStart(6)}   ${REF.sub8[L].toFixed(3).padStart(8)}   ` +
                `${b.digits.toFixed(3).padStart(6)}   ` +
                `${((d >= 0 ? "+" : "") + d.toFixed(3)).padStart(9)}   ` +
                `${((da >= 0 ? "+" : "") + da.toFixed(3)).padStart(6)}` +
                `${L > (ck.level | 0) ? "   (never trained)" : ""}`);
        }
        console.log(`\n  digits = correct decimal places of relative position error, averaged in log space`);
        console.log(`  AB3 = exact Newtonian forces combined by the classical Adams-Bashforth 3`);
        console.log(`  coefficients — the same ONE force evaluation per tick. That is the honest bar.`);
        for (const w of workers) w.postMessage({ stop: true });
        process.exit(0);
    })();
} else {

    /* ------------------------------------------------------------------ run */
    const evo = new Evolution(CFG.pop, CFG.seed, rng => new Predictor(rng));
    let startGen = 1;
    if (CFG.resume) {
        const ck = JSON.parse(fs.readFileSync(String(CFG.resume), "utf8"));
        if (!Predictor.specMatches(ck.net.spec)) {
            console.error(`resume failed: checkpoint is ${ck.label}, this run is ${specLabel()}`);
            process.exit(1);
        }
        const champ = Predictor.fromJSON(ck.net).calibrateScales();
        evo.seedFrom(champ, CFG.mutRate, CFG.mutSigma);
        evo.history = ck.history || [];
        evo.gen = (ck.gen || 1) + 1;
        startGen = evo.gen;
        if (ck.level != null && arg("level", null) === null) CFG.level = ck.level;
        console.log(`resumed from ${CFG.resume} at generation ${ck.gen} (rung ${ck.level})`);
    }

    /* PHASE 2. Take a brain trained without history and widen it to carry some,
     * preserving every prediction it makes (see Predictor.graft). Unlike
     * --resume this deliberately does NOT require the spec to match: changing
     * the spec is the entire point. It does require the checkpoint to have been
     * trained with FEWER lags than this run, because the graft only knows how to
     * add machinery, not remove it.
     *
     * The rung is inherited, and that matters more than it looks: a grafted
     * champion dropped back to L0 would spend its first hundred generations
     * re-earning a promotion it already has, on systems it has long since
     * mastered, which is exactly the compute the two-phase split was meant to
     * save. */
    if (CFG.graft) {
        const ck = JSON.parse(fs.readFileSync(String(CFG.graft), "utf8"));
        const wasLags = (ck.net.spec && ck.net.spec.lags) | 0;
        if (wasLags >= (MODEL_CFG.lags | 0)) {
            console.error(`graft failed: checkpoint already has ${wasLags} lags, this run wants ` +
                `${MODEL_CFG.lags | 0}. The graft adds history, it cannot take it away.`);
            process.exit(1);
        }
        const champ = Predictor.graft(ck.net);
        evo.seedFrom(champ, CFG.mutRate, CFG.mutSigma);
        evo.history = ck.history || [];
        evo.gen = (ck.gen || 1) + 1;
        startGen = evo.gen;
        if (ck.level != null && arg("level", null) === null) CFG.level = ck.level;
        console.log(`grafted ${CFG.graft}: ${ck.label} → ${specLabel()} ` +
            `(${wasLags} → ${MODEL_CFG.lags | 0} lags, ${champ.nParams()} parameters), ` +
            `generation ${ck.gen}, rung ${ck.level}`);
        console.log(`  the graft is prediction-preserving, so this run starts at exactly the ` +
            `${ck.exam != null ? ck.exam.toFixed(3) : "?"} digits phase 1 finished on.`);
    }

    function evaluateGeneration(job) {
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
                w.postMessage(Object.assign({ idx: from, brains: nets.slice(from, to) }, job));
            });
            if (pending === 0) resolve(results);
        });
    }

    (async function run() {
        const probe = new Predictor(mulberry32(1));
        console.log(`planetary forward-model trainer — ${specLabel()}, ${probe.nParams()} parameters`);
        console.log(`pop ${CFG.pop}, ${CFG.trials} systems/gen, ${CFG.workers} workers, ` +
            `${CFG.tickRange
                ? `${CFG.tickRange[0]}-${CFG.tickRange[1]} ticks per fastest orbit (randomised per system)`
                : `${(1 / CFG.tickFrac).toFixed(0)} ticks per fastest orbit`}, seed ${CFG.seed}`);

        await measureBaselines(CFG.maxLevel);
        console.log(`\nbaselines on the held-out exam (digits of relative position accuracy):`);
        for (let L = 0; L <= CFG.maxLevel; L++) {
            console.log(`  L${L} ${levelOf(L).label.padEnd(10)} horizon ${String(levelOf(L).horizon).padStart(3)} ticks · ` +
                `do-nothing ${REF.drift[L].toFixed(2)} · Newton ${REF.newton[L].toFixed(2)} · ` +
                `Adams-Bashforth 3 ${REF.adams3[L].toFixed(2)} · Newton×8 ${REF.sub8[L].toFixed(2)}`);
        }
        console.log(`\npromotion needs the champion ${CFG.promoteMargin} digits above Newton on the top rung, ` +
            `held ${CFG.promoteHold} checks\n`);

        let level = Math.max(0, Math.min(N_LEVELS - 1, CFG.level));
        let bestExam = -1e18, lastLevel = null, promoteRun = 0;

        /* A resumed run inherits the high-water mark it is resuming FROM.
         *
         * Without this, `bestExam` starts at -1e18, so the first report always
         * counts as an improvement and always overwrites checkpoint.json. And
         * the first report after a resume is reliably WORSE than the checkpoint:
         * the population was rebuilt by mutating one champion outward, so it has
         * lost the diversity the original run accumulated and needs a few dozen
         * generations to recover. The net effect was that resuming a run
         * destroyed the very artifact it resumed from — measured, a 2.129-digit
         * checkpoint was replaced by a 1.828-digit one on the first report.
         *
         * Only when the rung matches: scores earned on different rungs are not
         * comparable, and inheriting across a promotion would freeze the gate. */
        if (CFG.resume) {
            const ck = JSON.parse(fs.readFileSync(String(CFG.resume), "utf8"));
            // ...and only when the EXAM ITSELF is the same. A score earned on a
            // fixed-step exam is not comparable to one earned over a range of
            // steps, and inheriting across that change sets the bar to a number
            // the new exam may never reach — freezing the gate for the whole run
            // and silently producing no checkpoint at all. Same failure as
            // inheriting across a promotion, one level up.
            const sameExam = (ck.examTicks || null) === EXAM_TICKS;
            if (ck.exam != null && (ck.level | 0) === level && sameExam) {
                bestExam = ck.exam;
                lastLevel = level;
                console.log(`checkpoint gate starts at the resumed score, ${bestExam.toFixed(3)} digits ` +
                    `— checkpoint.json is only overwritten by something better`);
            } else if (ck.exam != null && !sameExam) {
                console.log(`checkpoint gate RESET: the resumed checkpoint was scored at ` +
                    `${ck.examTicks || "an unrecorded step"} ticks/orbit, this run examines at ${EXAM_TICKS}. ` +
                    `Those numbers are not comparable, so the old high-water mark is not inherited.`);
            }
        }
        const t0 = Date.now();

        for (let g = startGen; g < startGen + CFG.gens; g++) {
            const block = Math.floor((g - 1) / CFG.seedBlock);
            const job = {
                key: `train|${block}|${level}|${CFG.trials}|${CFG.tickFrac}|${CFG.tickRange || "fixed"}`,
                seeds: seedsFor(block, CFG.trials, TRAIN_SALT),
                level, tickFrac: CFG.tickFrac, tickRange: CFG.tickRange
            };
            const raw = await evaluateGeneration(job);
            const results = evo.brains.map((brain, i) => Object.assign({ brain }, raw[i]));
            const rec = evo.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.grace, {});
            const report = g % CFG.every === 0 || g === startGen;

            if (report) {
                /* Examine the top few brains, not just the single best-on-training
                 * one. results[0] is whoever won four noisy trial systems, which
                 * under a wide mutation is usually a lucky draw rather than a real
                 * improvement — with one candidate the champion stops moving while
                 * the training score keeps climbing, which looks like convergence
                 * and is not. */
                const cands = results.slice(0, 3).map(r => r.brain);
                const ex = await exam(cands, level);
                let bi = 0;
                for (let i = 1; i < ex.length; i++) if (ex[i].digits > ex[bi].digits) bi = i;

                // Both the champion bar and the checkpoint gate reset on a
                // promotion. A score earned on rung 2 is measured against nastier
                // systems than one earned on rung 1 and the two are not
                // comparable; leaving the gate at the old high-water mark means
                // nothing achieved after a promotion is ever written to disk.
                if (level !== lastLevel) { bestExam = -1e18; lastLevel = level; }
                const better = ex[bi].digits > bestExam;
                if (better) { bestExam = ex[bi].digits; evo.champion = cands[bi].clone(); }

                const top = ex[bi].byLevel[level] || { digits: -9 };
                // Promotion is gated on ADAMS-BASHFORTH 3, not on plain Newton.
                // Once the model can remember past force evaluations, beating
                // one-step Newton stopped being evidence of anything — the
                // textbook scheme does it by +0.78 digits — so a Newton-relative
                // gate would wave the population up the ladder for rediscovering
                // nothing. The multistep coefficients that reach AB3 are inside
                // the model's representable set by construction, so this is a
                // demanding bar but not an impossible one.
                const refDigits = REF[CFG.promoteRef][level];
                const margin = top.digits - refDigits;
                const ready = level < CFG.maxLevel && margin >= CFG.promoteMargin;
                promoteRun = ready ? promoteRun + 1 : 0;

                const el = (Date.now() - t0) / 1000;
                console.log(
                    `gen ${String(g).padStart(5)}  L${level} ${levelOf(level).label.padEnd(9)} ` +
                    `train best ${(rec.best / 100).toFixed(3)} mean ${(rec.avgDigits).toFixed(3)}  ` +
                    `| EXAM ${ex[bi].digits.toFixed(3)}  rung${level} ${top.digits.toFixed(3)} ` +
                    `vs ${CFG.promoteRef} ${refDigits.toFixed(3)} → ${(margin >= 0 ? "+" : "") + margin.toFixed(3)}` +
                    `${better ? "  ★" : ""}  [${el.toFixed(0)}s, ${((g - startGen + 1) / el).toFixed(2)} gen/s]`);

                const snap = (extra) => Object.assign({
                    format: "planet-brain-v1", label: specLabel(), model: MODEL_CFG,
                    gen: g, level, exam: ex[bi].digits, byLevel: ex[bi].byLevel,
                    examTicks: EXAM_TICKS,
                    newton: REF.newton[level], drift: REF.drift[level], sub8: REF.sub8[level],
                    adams3: REF.adams3[level],
                    net: evo.champion.toJSON()
                }, extra);

                if (better) {
                    fs.writeFileSync(path.join(__dirname, CFG.out, "checkpoint.json"),
                        JSON.stringify(Object.assign(snap({}), { history: evo.history })));
                }
                // `checkpoint.json` is the best-so-far; `latest.json` is simply
                // where the run has got to. One gating bug should never be able
                // to throw away an entire run's compute.
                fs.writeFileSync(path.join(__dirname, CFG.out, "latest.json"), JSON.stringify(snap({})));
                fs.writeFileSync(path.join(__dirname, CFG.out, "history.json"), JSON.stringify(evo.history));

                if (promoteRun >= CFG.promoteHold) {
                    level++; promoteRun = 0;
                    const lv = levelOf(level);
                    console.log(`        ── promoted to L${level} ${lv.label}: ${lv.nMin}-${lv.nMax} bodies, ` +
                        `e ≤ ${lv.eMax}, horizon ${lv.horizon} ticks (Newton ${REF.newton[level].toFixed(2)}, ` +
                        `Adams-Bashforth 3 ${REF.adams3[level].toFixed(2)} here)`);
                }
            }
            // Grace fires most generations, so printing it unconditionally buries
            // the one line per report that anyone actually reads.
            if (report && evo.graceEvent) console.log(`        ${evo.graceEvent}`);
        }

        for (const w of workers) w.postMessage({ stop: true });
        console.log(`\ndone. best exam ${bestExam.toFixed(3)} digits — ${path.join(CFG.out, "checkpoint.json")}`);
        console.log(`full report:  node train.js --eval ${path.join(CFG.out, "checkpoint.json")}`);
        console.log(`bake it in:   node train.js --bake ${path.join(CFG.out, "checkpoint.json")}`);
        process.exit(0);
    })();
}
