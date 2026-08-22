/* train.js — the headless trainer. Node only; the browser never runs this.
 *
 *   node train.js --workers 60 --pop 320 --episodes 12 --tag rocket
 *
 * DISPATCH IS A WORK QUEUE, ONE BRAIN PER JOB. Episode length here varies by
 * more than a factor of ten — a booster that flies into the tower at four
 * seconds against a Ship that flops for a hundred and forty — so a static
 * one-slice-per-worker split leaves a generation waiting on whichever worker
 * drew the long-lived brains. Measured on a 128-core box on a comparable
 * workload, that costs about 30% of the wall clock. Workers pull as they free
 * up, and because the environment is a pure function of (stage, seed) the
 * results are bit-identical whatever order they come back in.
 *
 * THE CHAMPION IS CHOSEN BY THE EXAM AND ONLY BY THE EXAM. The exam is a fixed
 * bank of held-out scenarios drawn from a reserved seed block, stratified across
 * every stage, that no training generation can ever draw. Training fitness is
 * measured on the ten scenarios the population was just selected against and is
 * therefore an optimistic number by construction; a champion crowned on it is
 * whichever individual happened to fit this generation's weather. The best exam
 * score ever seen is kept in training/best_holdout.json and that file is what
 * the browser gets.
 *
 * ON A SHARED MACHINE, IDENTIFY YOUR RUN BY ITS TAG AND ITS WORKING DIRECTORY —
 * never by the script name. `train.js` is not a unique string on a box where
 * somebody else is also training something.
 */
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const NN = require("./nn.js");
const SC = require("./scenarios.js");
const WM = require("./world.js");
const EV = require("./evolution.js");
const SENS = require("./sensors.js");

/* ------------------------------------------------------------------ worker */
if (!isMainThread) {
    const spec = workerData.spec;
    let brain = null;
    parentPort.on("message", (msg) => {
        if (msg.type === "job") {
            brain = NN.Brain.fromJSON({ spec, act: msg.act, sizes: msg.sizes, scales: msg.scales, weights: msg.weights });
            const r = EV.Evolution.evaluate(brain, msg.specs);
            parentPort.postMessage({ type: "done", index: msg.index, scores: r.scores, outcomes: r.outcomes, phases: r.phases });
        } else if (msg.type === "baseline") {
            const b = EV.Evolution.baseline(msg.specs);
            parentPort.postMessage({ type: "baselineDone", base: b, basePhases: b.phases });
        } else if (msg.type === "exam") {
            brain = NN.Brain.fromJSON({ spec, act: msg.act, sizes: msg.sizes, scales: msg.scales, weights: msg.weights });
            const r = EV.Evolution.evaluate(brain, msg.specs);
            parentPort.postMessage({ type: "examDone", index: msg.index, scores: r.scores, outcomes: r.outcomes, phases: r.phases });
        } else if (msg.type === "quit") {
            process.exit(0);
        }
    });
    return;
}

/* -------------------------------------------------------------------- main */

function parseArgs(argv) {
    const a = {};
    for (let i = 2; i < argv.length; i++) {
        const t = argv[i];
        if (!t.startsWith("--")) continue;
        const k = t.slice(2);
        const v = (i + 1 < argv.length && !argv[i + 1].startsWith("--")) ? argv[++i] : "true";
        a[k] = v;
    }
    return a;
}
const args = parseArgs(process.argv);
const num = (k, d) => args[k] != null ? Number(args[k]) : d;
const str = (k, d) => args[k] != null ? String(args[k]) : d;
const bool = (k, d) => args[k] != null ? (args[k] !== "false" && args[k] !== "0") : d;

const CPU = os.cpus().length;
let WORKERS = num("workers", Math.max(1, Math.min(CPU - 2, 60)));
if (WORKERS > CPU) {
    console.warn(`[train] --workers ${WORKERS} exceeds ${CPU} logical cores; capping.`);
    WORKERS = CPU;
}

const CFG = {
    pop: num("pop", 320),
    elite: num("elite", 6),
    tournament: num("tournament", 5),
    crossoverRate: num("crossover", 0.65),
    mutRate: num("mutrate", 0.11),
    mutSigma: num("sigma", 0.30),
    episodes: num("episodes", 12),
    worstWeight: num("worst", 0.25),
    bankHold: num("bankhold", 10),
    stratify: bool("stratify", false),
    ship: bool("ship", true),
    advantage: bool("advantage", true),
    arch: str("arch", "std"),
    act: str("act", "tanh"),
    immigrantRate: num("immigrants", 0.02),
    seed: num("seed", 1234567),
    /* --stages 0 or --stages 0,4 pins the training diet and disables the
     * curriculum. Used for controlled A/Bs, where a diet that changes
     * composition mid-experiment invalidates the comparison. */
    stageSet: args.stages ? String(args.stages).split(",").map(Number) : null,
    /* Per-child mutation size, drawn log-normally, plus a sparse mode that
     * edits a handful of genes. See Brain.mutateVaried. */
    /* The breeding recipe (see Evolution.breed). Shares of the whole
     * population; the remainder becomes immigrants. */
    eliteFrac: num("elitefrac", 0.015),
    fMutElite: num("fmutelite", 0.30),
    fXElite: num("fxelite", 0.15),
    fXMutElite: num("fxmutelite", 0.15),
    fXEliteSub: num("fxelitesub", 0.10),
    fXSubSub: num("fxsubsub", 0.10),
    variedMutation: bool("varied", true),
    mutSpread: num("spread", 0.9),
    sparseRate: num("sparse", 0.25),
    sparseMaxGenes: num("sparsegenes", 256)
};
const GENS = num("gens", 100000);
const EXAM_EVERY = num("examevery", 5);
const EXAM_PER_STAGE = num("examper", 4);
const UNLOCK_AT = num("unlock", 0.55);
const SAVE_EVERY = num("saveevery", 250);
/* THE PHASE LADDER. `--phase N` starts on rung N (1-5); the run advances a rung
 * when the held-out score for the current one clears its threshold on three
 * consecutive exams — the same three-in-a-row rule the stage curriculum uses,
 * for the same reason: one lucky exam is not a skill.
 *
 * Thresholds are measured, not guessed, and RE-MEASURED whenever the ladder
 * changes — adding the tower-strike discount moved every rung down, and the
 * old rung-1 bar of 0.90 became unreachable by anything including a rock.
 * On the stages 0,1,2 held-out bank: golden pilot 0.594 / 0.417 / 0.367 /
 * 0.339, inert 0.843 / 0.120 / 0.030 / 0.005, random 0.345 / 0.067 / 0.023 /
 * 0.003. The bars sit near two-thirds of the pilot. They are much lower than
 * the stage-0-only numbers because the diet now includes altitudes the
 * reference controller itself cannot fly: on stage 2 the pilot scores 0.248 /
 * 0.075 and arrives at 163 m/s. Re-measure these whenever the diet changes —
 * a threshold calibrated on a different mix is not a threshold. */
let PHASE = num("phase", 1);
const PHASE_UP = (args.phaseup ? String(args.phaseup).split(",").map(Number)
    : [0.55, 0.30, 0.25, 0.22, 99]);
const PHASE_NAME = ["", "stability", "braking", "targeting", "capture", "consolidate"];
const AUTO_PHASE = bool("autophase", true);
const OUT = str("out", "training");
const TAG = str("tag", "rocket");
const RESUME = str("resume", "");

fs.mkdirSync(OUT, { recursive: true });

console.log(`[train] tag=${TAG} cwd=${process.cwd()}`);
console.log(`[train] ${WORKERS} workers of ${CPU} cores · pop ${CFG.pop} · ${CFG.episodes} episodes/individual · arch ${CFG.arch}/${CFG.act}`);
console.log(`[train] phase ladder starts at rung ${PHASE} (${PHASE_NAME[PHASE]}) · thresholds ${PHASE_UP.slice(0, 4).join("/")} · autophase ${AUTO_PHASE}`);
console.log(`[train] inputs ${SENS.N_INPUT} · outputs ${WM.N_OUT} · lags ${SENS.LAGS.join(",")}`);

let evo;
if (RESUME && fs.existsSync(RESUME)) {
    evo = EV.Evolution.fromJSON(JSON.parse(fs.readFileSync(RESUME, "utf8")));
    console.log(`[train] resumed from ${RESUME} at generation ${evo.gen}`);
} else {
    evo = new EV.Evolution(CFG);
    const WARM = str("warm", "");
    if (WARM) {
        if (!fs.existsSync(WARM)) { console.error(`[train] --warm ${WARM} not found`); process.exit(1); }
        const w = JSON.parse(fs.readFileSync(WARM, "utf8"));
        const seedBrain = NN.Brain.fromJSON(w.brain || w);
        if (seedBrain.spec.layers.join(",") !== evo.spec.layers.join(",")) {
            console.error(`[train] warm-start shape ${seedBrain.spec.layers} does not match ${evo.spec.layers}`);
            process.exit(1);
        }
        evo.seedFrom(seedBrain);
        console.log(`[train] warm-started from ${WARM}` + (w.eval != null ? ` (imitation eval ${Number(w.eval).toFixed(3)})` : ""));
    }
}
console.log(`[train] genome ${evo.pop[0].weightCount()} weights`);

/* The exam bank: fixed, stratified, disjoint from anything training can draw. */
const EXAM = SC.examBank(EXAM_PER_STAGE).map(s => ({ stage: s.stage, seed: s.seed }));
const LIVE_STAGES = CFG.stageSet || null;

const workers = [];
for (let i = 0; i < WORKERS; i++) {
    const w = new Worker(__filename, { workerData: { spec: evo.spec } });
    w.busy = false;
    w.on("error", (e) => { console.error("[worker]", e); });
    workers.push(w);
}

/* Dispatch a list of jobs across the pool, one at a time per worker, resolving
 * when every job has come back. */
function dispatch(jobs, onResult) {
    return new Promise((resolve) => {
        let next = 0, done = 0;
        const pump = (w) => {
            if (next >= jobs.length) { w.busy = false; return; }
            const job = jobs[next++];
            w.busy = true;
            w.postMessage(job);
        };
        for (const w of workers) {
            w.removeAllListeners("message");
            w.on("message", (msg) => {
                onResult(msg);
                done++;
                if (done === jobs.length) resolve();
                else pump(w);
            });
        }
        for (const w of workers) if (next < jobs.length) pump(w);
    });
}

/* Ship the weights as Float32Arrays, NOT as plain arrays.
 *
 * `Array.from(float32array)` boxes every element into a JS number, and with 384
 * individuals of 39 000 weights that is fifteen million boxed numbers built on
 * the main thread every single generation, then serialised again by structured
 * clone. Measured effect: the box ran at 30 of 128 cores because the workers
 * spent most of each generation idle waiting for the dispatcher to finish
 * packing. Typed arrays are copied by structured clone as raw bytes. */
function packBrain(b) {
    return {
        act: b.act,
        sizes: b.net.sizes,
        scales: b.net.scales,
        weights: b.net.weights
    };
}

const OUTCOME_NAME = WM.OUTCOME_NAME;

let bestExam = -Infinity;
let bestExamGen = -1;
const history = [];
const t0 = Date.now();
let lastAvg = 0;
const baseCache = { era: -1, base: null, phases: null };
let phaseHold = 0;
const phaseLog = [{ gen: 0, phase: PHASE }];

/* THE STALL RESPONSE. `explore` rises from 0 to 1 when the held-out score for
 * the current rung stops improving, and it widens the mutation spread and
 * shifts breeding share out of pure elite-x-elite recombination into mutation
 * of elites. The reasoning is that a stalled population is one whose elites are
 * all near-copies of one genome, and recombining copies of a consensus produces
 * nothing new however many of them you make.
 *
 * It resets to zero on a rung change, because the objective has just moved and
 * "no improvement" against the previous rung says nothing about the new one. */
const STALL_AFTER = num("stallafter", 20);   // exams with no gain before exploring
const STALL_EPS = num("stalleps", 0.005);
let stallCount = 0, bestRungSeen = -Infinity;

/* Champion candidates: the elite of each generation are the only brains ever
 * re-flown on the exam, and the best exam score ever seen wins. Re-flying the
 * whole population would cost more than the generation did. */
/* THE EXAM IS CHUNKED ACROSS THE POOL, not one job per candidate.
 *
 * Four candidates is four jobs, and on a 96-worker box that is 92 workers
 * watching while one of them flies eighty-four episodes end to end. The exam is
 * only about 4% of a generation's total work, but dispatched four-wide it takes
 * as long as the generation did — every fifth generation. Splitting it by
 * episode makes it disappear into the pool. Scores are reassembled in EXAM
 * order, and because an episode is a pure function of (stage, seed) the result
 * is identical to running the bank in one piece. */
const EXAM_CHUNK = 4;
/* `liveStages` is the set the rung means are taken over. It MUST be the set the
 * curriculum is currently training, not a constant: the exam deliberately covers
 * all seven stages so the reported canonical number is global, but a rung score
 * averaged over stages the population has never flown is noise, and it is the
 * number that decides both the champion and phase advancement.
 *
 * This used to read the pinned `--stages` list, with a comment saying "the other
 * six are noise while the diet is pinned". Correct, and it silently stopped
 * being correct the moment the stage curriculum was turned back on: with no
 * --stages the list is null, the filter is skipped, and the rung is diluted by
 * four Ship stages and every booster stage not yet unlocked. Measured effect:
 * the same fleet read 0.14-0.17 pinned and 0.08-0.11 unpinned, which would have
 * held the phase ladder below a threshold calibrated on the narrower set
 * forever. */
async function runExam(cands, liveStages) {
    const jobs = [];
    const parts = [];
    for (let i = 0; i < cands.length; i++) {
        const packed = packBrain(cands[i]);
        for (let s = 0; s < EXAM.length; s += EXAM_CHUNK) {
            parts.push({ cand: i, start: s });
            jobs.push(Object.assign({ type: "exam", index: jobs.length, specs: EXAM.slice(s, s + EXAM_CHUNK) }, packed));
        }
    }
    const res = cands.map(() => ({
        scores: new Array(EXAM.length), outcomes: new Array(EXAM.length),
        phases: new Float64Array(EXAM.length * 5)
    }));
    await dispatch(jobs, (m) => {
        if (m.type !== "examDone") return;
        const p = parts[m.index], r = res[p.cand];
        for (let k = 0; k < m.scores.length; k++) {
            r.scores[p.start + k] = m.scores[k];
            r.outcomes[p.start + k] = m.outcomes[k];
            for (let q = 0; q < 5; q++) r.phases[(p.start + k) * 5 + q] = m.phases[k * 5 + q];
        }
    });
    return res.map((r, i) => {
        const tally = {};
        let sum = 0, worst = Infinity;
        const perStage = new Array(SC.N_STAGES).fill(0);
        const perStageN = new Array(SC.N_STAGES).fill(0);
        for (let k = 0; k < r.scores.length; k++) {
            sum += r.scores[k];
            if (r.scores[k] < worst) worst = r.scores[k];
            const nm = OUTCOME_NAME[r.outcomes[k]];
            tally[nm] = (tally[nm] || 0) + 1;
            perStage[EXAM[k].stage] += r.scores[k];
            perStageN[EXAM[k].stage]++;
        }
        /* Phase means over the stages actually being trained — see above. */
        const ph = new Array(5).fill(0);
        const phN = new Array(5).fill(0);
        for (let k = 0; k < EXAM.length; k++) {
            if (liveStages && liveStages.indexOf(EXAM[k].stage) < 0) continue;
            for (let q = 0; q < 5; q++) { ph[q] += r.phases[k * 5 + q]; }
            phN[0]++;
        }
        for (let q = 0; q < 5; q++) ph[q] = phN[0] ? ph[q] / phN[0] : 0;
        return {
            i, mean: sum / r.scores.length, worst, tally, phases: ph,
            perStage: perStage.map((v, s) => perStageN[s] ? v / perStageN[s] : 0),
            caught: tally["caught"] || 0,
            landed: (tally["landed"] || 0) + (tally["soft divert"] || 0)
        };
    });
}

function save(file, obj) {
    const tmp = path.join(OUT, file + ".tmp");
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, path.join(OUT, file));
}

(async function main() {
    for (let g = 0; g < GENS; g++) {
        const specsFull = evo.bank();
        const specs = specsFull.map(s => ({ stage: s.stage, seed: s.seed }));

        /* The baseline — the inert policy over this generation's scenarios —
         * is a PURE FUNCTION OF THE BANK, and the bank only changes once every
         * `bankHold` generations. Recomputing it every generation was not just
         * redundant, it was a serial section: one job, dispatched to one worker,
         * with every other worker idle until it came back. That costs nothing
         * at 17 workers where a generation takes twelve seconds, and it is
         * crippling at 96, where the generation itself is about two seconds and
         * the twenty sequential episodes of the baseline are a comparable
         * length. Amdahl decides how many cores this run can actually use, so
         * the baseline is computed once per era and held. */
        let base = null;
        if (CFG.advantage) {
            const era = Math.floor(evo.gen / Math.max(1, CFG.bankHold));
            if (baseCache.era !== era || !baseCache.base) {
                await dispatch([{ type: "baseline", specs }], (m) => {
                    if (m.type === "baselineDone") { baseCache.base = m.base; baseCache.phases = m.basePhases; }
                });
                baseCache.era = era;
            }
            base = baseCache.base;
        }

        const jobs = evo.pop.map((b, i) => Object.assign({ type: "job", index: i, specs }, packBrain(b)));
        const results = new Array(evo.pop.length);
        await dispatch(jobs, (m) => { if (m.type === "done") results[m.index] = m; });

        /* SELECTION IS ON THE CURRENT RUNG, NOT ON THE CANONICAL TOTAL. The
         * canonical score is still computed for every episode and still decides
         * which champion ships — it is just not what breeds. The advantage
         * baseline is taken on the same rung, so "beat the rock" is the literal
         * objective on rung 1, where a rock is genuinely hard to beat. */
        const nEp = specs.length;
        const basePhase = (CFG.advantage && baseCache.phases)
            ? EV.Evolution.column(baseCache.phases, nEp, PHASE - 1) : null;
        const fits = results.map(r =>
            evo.aggregate(EV.Evolution.column(r.phases, nEp, PHASE - 1), basePhase));
        const canon = results.map(r => r.scores.reduce((a, b) => a + b, 0) / nEp);
        let canonMean = 0; for (const c of canon) canonMean += c; canonMean /= canon.length;
        const tally = {};
        for (const r of results) for (const o of r.outcomes) {
            const nm = OUTCOME_NAME[o]; tally[nm] = (tally[nm] || 0) + 1;
        }

        const order = evo.breed(fits);   // NOTE: mutates evo.pop and increments gen
        const bestIdx = order[0];
        const bestFit = fits[bestIdx].fit, bestRaw = fits[bestIdx].raw;
        let meanFit = 0; for (const f of fits) meanFit += f.fit; meanFit /= fits.length;
        const baseMean = base ? base.reduce((a, b) => a + b, 0) / base.length : 0;

        const elapsed = (Date.now() - t0) / 1000;
        const avg = elapsed / (g + 1);
        const inst = (g === 0) ? avg : ((g + 1) * avg - g * lastAvg);
        lastAvg = avg;

        const total = Object.values(tally).reduce((a, b) => a + b, 0) || 1;
        const pct = (k) => (((tally[k] || 0) / total) * 100).toFixed(1);

        let line = `g${String(evo.gen).padStart(5)} P${PHASE}:${PHASE_NAME[PHASE].slice(0, 5)}` +
            ` fit ${bestFit.toFixed(3)}/${meanFit.toFixed(3)}` +
            ` canon ${canonMean.toFixed(3)}` +
            ` | caught ${pct("caught")}% land ${pct("landed")}% divert ${pct("soft divert")}%` +
            ` strike ${pct("tower strike")}% tumble ${pct("tumble")}%` +
            ` | B${evo.unlockedBooster} S${evo.unlockedShip} e${Math.floor((evo.gen - 1) / CFG.bankHold)} | ${inst.toFixed(1)}s`;

        /* ------------------------------------------------------------- exam */
        if (evo.gen % EXAM_EVERY === 0) {
            const cands = [];
            for (let e = 0; e < Math.min(4, evo.o.elite); e++) cands.push(evo.pop[e]);
            /* THE CHAMPION IS CROWNED ON WHAT IT WAS ACTUALLY TAUGHT, and the
             * curriculum is judged the same way.
             *
             * The exam deliberately covers all seven stages, so that the
             * reported number is a global one. But ranking on that global mean
             * is a mistake this run made for 2465 generations: while the diet is
             * stage 0 and stage 4, five of the seven exam stages are ones the
             * population has never seen, and a brain's score on them is noise.
             * Four candidates separated by a few hundredths on the stage they
             * were bred for get re-ordered by that noise, so `best_holdout.json`
             * — the file the browser actually loads — was being awarded to
             * whichever elite got lucky on stages it had never flown. The same
             * mean is what the unlock threshold was read from, which is why the
             * curriculum never advanced.
             *
             * So: rank and crown on the mean over the TRAINED stages, and keep
             * reporting the global mean beside it. */
            const bs = [0, 1, 2, 3].slice(0, evo.unlockedBooster + 1);
            const ss = [4, 5, 6].slice(0, evo.unlockedShip + 1);
            const live = CFG.stageSet ? CFG.stageSet : bs.concat(ss);
            const liveMean = (r) => {
                let s = 0;
                for (const st of live) s += r.perStage[st];
                return s / live.length;
            };

            const ex = await runExam(cands, live);
            for (const r of ex) r.live = liveMean(r);
            /* Crown on the RUNG BEING TRAINED, then report the canonical score
             * beside it. Ranking the elite on the canonical total while breeding
             * them on rung 2 would hand the champion slot to whichever brain
             * happened to suit an objective nobody is selecting for. */
            ex.sort((a, b) => b.phases[PHASE - 1] - a.phases[PHASE - 1]);
            const top = ex[0];
            const unlockedMean = top.live;
            const rung = top.phases[PHASE - 1];
            line += ` | LADDER ` + top.phases.slice(0, 4).map((v, i) =>
                (i === PHASE - 1 ? "[" : " ") + v.toFixed(2) + (i === PHASE - 1 ? "]" : " ")).join("");
            line += ` | EXAM ${top.mean.toFixed(3)} (worst ${top.worst.toFixed(2)}, caught ${top.caught}, safe ${top.landed})`;

            if (rung > bestExam) {
                bestExam = rung;
                bestExamGen = evo.gen;
                save("best_holdout.json", {
                    format: "rocket-champion-v1",
                    gen: evo.gen, exam: top.mean, live: unlockedMean, stages: live,
                    phase: PHASE, rung: rung, ladder: top.phases.slice(0, 4),
                    worst: top.worst,
                    tally: top.tally, perStage: top.perStage,
                    caught: top.caught, safe: top.landed,
                    /* THE OBSERVATION LAYOUT TRAVELS WITH THE GENOME. Without
                     * it a champion is only replayable in a process whose
                     * ROCKET_LAGS happens to match the run that bred it, and
                     * the publisher simply dropped every genome that did not —
                     * which silently kept the two best arms off the page. */
                    inputs: SENS.N_INPUT, outputs: WM.N_OUT, lags: SENS.LAGS,
                    arch: CFG.arch, act: CFG.act,
                    brain: cands[top.i].toJSON()
                });
                /* Hand the champion back to the search so it is re-inserted
                 * unmutated every generation and cannot be lost to a bank
                 * rotation. */
                evo.champion = cands[top.i].clone();
                line += " ★";
            }
            line += ` [live ${unlockedMean.toFixed(3)}]`;
            /* THREE CONSECUTIVE EXAMS ABOVE THE BAR, not one. A rung passed on
             * a single lucky draw is a rung the population cannot actually do,
             * and everything above it then trains on a foundation that is not
             * there. Advancing is one-way on purpose: an oscillating curriculum
             * is a moving objective, which is the failure this whole ladder
             * exists to remove. */
            /* stall bookkeeping, before any rung change resets it */
            if (rung > bestRungSeen + STALL_EPS) { bestRungSeen = rung; stallCount = 0; }
            else stallCount++;
            evo.explore = Math.max(0, Math.min(1, (stallCount - STALL_AFTER) / STALL_AFTER));
            if (evo.explore > 0) line += ` expl ${evo.explore.toFixed(2)}`;

            if (AUTO_PHASE && PHASE < 5) {
                if (rung >= PHASE_UP[PHASE - 1]) phaseHold++; else phaseHold = 0;
                if (phaseHold >= 3) {
                    PHASE++; phaseHold = 0;
                    stallCount = 0; bestRungSeen = -Infinity; evo.explore = 0;
                    /* THE CHAMPION RECORD IS PER-RUNG AND HAS TO BE RESET HERE.
                     *
                     * `bestExam` holds the best score ever seen ON THE RUNG
                     * BEING TRAINED, and the rung has just changed underneath
                     * it. Rungs are not on a common scale — each one multiplies
                     * the one below by a factor with a small floor, so a rung-2
                     * score is roughly a fifth of the rung-1 score of the same
                     * flight. Carrying the old record across the boundary makes
                     * `rung > bestExam` unsatisfiable forever.
                     *
                     * It is not hypothetical. Arms A, B and C banked rung-1
                     * records of about 0.395, advanced to rung 2 where the whole
                     * population scores 0.10-0.18, and then crowned nobody for
                     * the next 150 generations: best_holdout.json — the file the
                     * page loads and the file a warm start reads — stayed frozen
                     * at generations 10, 5 and 15. Worse, `evo.champion` is
                     * re-injected unmutated every generation, so a stale genome
                     * held an elite slot for the entire run. Arm D started
                     * directly on rung 2, never crossed a boundary, and crowned
                     * six times as normal, which is what isolated this. */
                    bestExam = -Infinity;
                    line += `  →RUNG ${PHASE} ${PHASE_NAME[PHASE].toUpperCase()}`;
                    phaseLog.push({ gen: evo.gen, phase: PHASE });
                }
            }
            const unlocked = evo.maybeUnlock(unlockedMean, UNLOCK_AT);
            if (unlocked) {
                /* THE SAME RESET THE RUNG BOUNDARY NEEDS, FOR THE SAME REASON.
                 *
                 * `bestExam` is the best rung score ever seen, and unlocking a
                 * stage makes the diet harder, so every rung score drops the
                 * generation it happens. Without this, `rung > bestExam` becomes
                 * unsatisfiable exactly as it did across a rung change: the
                 * champion freezes at the last generation of the easy diet, the
                 * page stops updating, and — worse — that stale genome goes on
                 * being re-injected unmutated into every later generation.
                 *
                 * This is the bug that wasted three arms of the first run in a
                 * different disguise. It was invisible while the diet was pinned
                 * with --stages, because a pinned diet never unlocks. Turning the
                 * stage curriculum back on brings it straight back, which is why
                 * it is being fixed in the same breath. */
                bestExam = -Infinity;
                line += `  →UNLOCK B${evo.unlockedBooster} S${evo.unlockedShip}`;
            }
            history.push({ gen: evo.gen, phase: PHASE, rung, ladder: top.phases.slice(0, 4),
                fit: bestFit, mean: meanFit, exam: top.mean, live: unlockedMean, caught: top.caught, perStage: top.perStage, base: baseMean, B: evo.unlockedBooster, S: evo.unlockedShip });
            save("history.json", history);
        }

        console.log(line);

        /* Serialising the whole population is a fifteen-million-number JSON
         * string and it blocks the dispatcher while every worker sits idle.
         * Once every 25 generations is plenty of insurance; the champion, which
         * is the thing anybody actually wants, is written the moment it is
         * beaten and costs one brain. */
        /* THE FULL-POPULATION DUMP IS A STOP-THE-WORLD EVENT, and at this
         * population it is not a small one: 448 genomes of 39 000 weights is a
         * 356 MB JSON string, built by JSON.stringify on the main thread while
         * all 88 workers sit idle waiting for the dispatcher. At every 25
         * generations — about 80 seconds of work — it was costing a measurable
         * slice of the box. Measured on the run this replaced: 550 255 cpu-
         * seconds over 9 316 s of wall clock on 88 workers is 67% utilisation.
         * The champion, which is the only thing anybody actually wants, is
         * still written the instant it is beaten and costs one brain. */
        if (evo.gen % SAVE_EVERY === 0) save("latest.json", evo.toJSON({ bestExam, bestExamGen }));
    }
    // Worker threads keep the event loop alive forever; a finite --gens run that
    // does not do this hangs after its last generation looking exactly like a
    // run that is still working.
    save("latest.json", evo.toJSON({ bestExam, bestExamGen }));
    save("checkpoint.json", evo.toJSON({ bestExam, bestExamGen }));
    console.log(`[train] done at generation ${evo.gen}; best exam ${bestExam.toFixed(3)} at g${bestExamGen}`);
    for (const w of workers) await w.terminate();
    process.exit(0);
})();

process.on("SIGINT", () => {
    console.log("\n[train] interrupted; writing checkpoint");
    try { save("checkpoint.json", evo.toJSON({ bestExam, bestExamGen })); } catch (e) { }
    for (const w of workers) w.postMessage({ type: "quit" });
    process.exit(0);
});
