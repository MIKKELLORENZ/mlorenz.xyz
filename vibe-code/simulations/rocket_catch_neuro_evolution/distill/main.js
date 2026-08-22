/* main.js — the DAgger round loop. Required by dagger.js on the main thread.
 *
 * Split out only because dagger.js spawns itself as a worker via __filename,
 * so the worker branch has to stay in that file; everything the worker never
 * touches lives here.
 *
 * The evaluation discipline in this file is deliberate and is not optional:
 *
 *   COLLECT / RANK / CONFIRM are three disjoint seed spaces. Rounds are ranked
 *   on the rank bank; the winner alone is re-flown on a bank nothing has ever
 *   touched. Ranking N candidates IS selection, so a score that also chose the
 *   candidate is optimistic by construction.
 *
 *   THE BEST ROUND IS TAKEN BY MEASUREMENT, NOT THE LAST ONE. As the aggregate
 *   grows it fills with states collected while the student was bad, where every
 *   label is damage limitation, and performance can peak in the middle.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { Worker } = require("worker_threads");

const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const SENS = require("../sensors.js");
const { Trainer, channelError } = require("./gradnet.js");

const N_OUT = WM.N_OUT;

function run(CHANNEL_W, workerFile) {
    const arg = (k, d) => {
        const i = process.argv.indexOf("--" + k);
        return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
    };
    const ROUNDS = Number(arg("rounds", 5));
    const EPS = Number(arg("eps", 400));
    const STAGES = String(arg("stages", "0")).split(",").map(Number);
    const ARCH = String(arg("arch", "std"));
    const NW = Number(arg("workers", Math.max(2, Math.min(24, os.cpus().length - 2))));
    const EPOCHS = Number(arg("epochs", 12));
    const LR = Number(arg("lr", 2e-3));
    const OUT = String(arg("out", "distill/run"));
    const LAGS = arg("lags", "") ? SENS.parseLags(arg("lags", "")) : null;
    const SEEDFROM = arg("seedfrom", "");
    const CAP = Number(arg("cap", 250000));
    /* How much more a successful episode is worth in the dataset. 1 = the old
     * behaviour, every tick weighted equally, which fits the student to a
     * teacher whose trajectories miss four times out of five. */
    const WINW = Number(arg("winw", 1));

    fs.mkdirSync(OUT, { recursive: true });
    const probe = new SENS.Sensors(LAGS);
    const N_IN = probe.nInput;
    const SPEC = NN.netSpec(N_IN, ARCH);

    const log = (m) => { console.log(m); fs.appendFileSync(path.join(OUT, "log.txt"), m + "\n"); };
    log(`[dagger] ${ROUNDS} rounds x ${EPS} episodes · winw ${WINW} · stages ${STAGES.join(",")} · arch ${ARCH}` +
        ` · ${N_IN} inputs · ${NW} workers · ${EPOCHS} epochs · lr ${LR}` +
        (SEEDFROM ? ` · SEEDED FROM ${SEEDFROM}` : " · fresh init"));

    const COLLECT_BASE = 7000000, RANK_BASE = 8000000, CONFIRM_BASE = 9000000;
    const bankOf = (base, n) => {
        const out = [];
        for (let i = 0; i < n; i++) out.push({ stage: STAGES[i % STAGES.length], seed: base + i * 7919 });
        return out;
    };
    const RANK = bankOf(RANK_BASE, Number(arg("rankn", 200)));
    const CONFIRM = bankOf(CONFIRM_BASE, Number(arg("confirmn", 400)));

    function collect(brain, beta, specs) {
        return new Promise((resolve, reject) => {
            const chunks = Array.from({ length: NW }, () => []);
            specs.forEach((s, i) => chunks[i % NW].push(s));
            const parts = []; let live = 0, failed = null;
            const agg = { caught: 0, tally: {}, why: {}, ticks: 0 };
            for (let k = 0; k < NW; k++) {
                if (!chunks[k].length) continue;
                live++;
                const wk = new Worker(workerFile, { workerData: {
                    lags: LAGS, brainJSON: brain ? brain.toJSON() : null, beta,
                    specs: chunks[k], seed: (1234567 + k * 7919 + Math.round(beta * 1e6)) >>> 0,
                    winw: WINW
                } });
                wk.on("message", (m) => {
                    parts.push(m);
                    agg.caught += m.caught; agg.ticks += m.ticks;
                    for (const [kk, v] of Object.entries(m.tally)) agg.tally[kk] = (agg.tally[kk] || 0) + v;
                    for (const [kk, v] of Object.entries(m.why)) agg.why[kk] = (agg.why[kk] || 0) + v;
                });
                wk.on("error", (e) => { failed = e; });
                wk.on("exit", () => { if (--live === 0) { failed ? reject(failed) : resolve({ parts, agg }); } });
            }
            if (live === 0) resolve({ parts: [], agg });
        });
    }

    /* Views into the shard buffers rather than copies — the dataset reaches
     * hundreds of thousands of rows and copying it per round is the difference
     * between fitting in memory and not. */
    function rows(parts) {
        const X = [], Y = [];
        for (const p of parts) {
            for (let i = 0; i < p.n; i++) {
                X.push(p.flatX.subarray(i * p.nIn, (i + 1) * p.nIn));
                Y.push(p.flatY.subarray(i * N_OUT, (i + 1) * N_OUT));
            }
        }
        return { X, Y };
    }

    function evaluate(brain, bank) {
        const pol = new NN.BrainPolicy(brain, { lags: LAGS });
        let caught = 0, sum = 0; const tally = {}; const per = [];
        for (const s of bank) {
            const w = new WM.World(SC.makeScenario(s.stage, s.seed));
            pol.reset();
            const r = w.runEpisode((ww, o) => pol.act(ww, o));
            const nm = WM.OUTCOME_NAME[r.outcome];
            tally[nm] = (tally[nm] || 0) + 1;
            if (nm === "caught") caught++;
            sum += r.total; per.push(r.total);
        }
        const m = sum / bank.length;
        const sd = Math.sqrt(per.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, per.length - 1));
        return { caught, n: bank.length, mean: m, se: sd / Math.sqrt(bank.length), tally };
    }

    (async function () {
        const store = [];
        let brain = null, best = null;

        for (let round = 0; round < ROUNDS; round++) {
            const beta = round === 0 ? 1 : Math.max(0, 1 - round / (ROUNDS - 1));
            const specs = bankOf(COLLECT_BASE + round * 1000003, EPS);
            const t0 = Date.now();
            const { parts, agg } = await collect(brain, beta, specs);
            store.push(...parts);
            const totalWhy = Object.values(agg.why).reduce((a, b) => a + b, 0) || 1;
            const nSamples = store.reduce((a, p) => a + p.n, 0);
            log(`\nround ${round}  beta ${beta.toFixed(2)}  ${agg.ticks} new samples in ` +
                `${((Date.now() - t0) / 1000).toFixed(0)}s  ·  rollout caught ${agg.caught}/${EPS}` +
                `  ·  labels ` + Object.entries(agg.why).map(([k, v]) => `${k} ${(100 * v / totalWhy).toFixed(1)}%`).join(" ") +
                `  ·  dataset ${nSamples}`);
            const stranded = 100 * (agg.why.stranded || 0) / totalWhy;
            if (stranded > 5) log(`  !! stranded ${stranded.toFixed(1)}% — those labels are damage limitation, not demonstrations`);

            let { X, Y } = rows(store);
            /* THE UNION IS CAPPED, AND SAMPLED ACROSS ALL ROUNDS.
             *
             * Retraining from scratch every round is the right thing to do, but
             * the aggregate grows without bound and the cost grows with it: six
             * rounds of 800 episodes is 1.2M samples, and fifteen epochs of that
             * against a 40k-weight net is hours per round in a single thread.
             * So the training set is a uniform sample of the whole aggregate,
             * capped. Uniform over the UNION rather than the newest rounds,
             * because the point of retraining is to keep fitting the earlier
             * distributions, not to quietly become fine-tuning on the latest. */
            if (X.length > CAP) {
                const pick = NN.mulberry32(31337 + round);
                const idx = new Int32Array(X.length);
                for (let i = 0; i < X.length; i++) idx[i] = i;
                for (let i = X.length - 1; i > 0; i--) { const j = (pick() * (i + 1)) | 0; const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
                const Xs = new Array(CAP), Ys = new Array(CAP);
                for (let i = 0; i < CAP; i++) { Xs[i] = X[idx[i]]; Ys[i] = Y[idx[i]]; }
                log(`   dataset ${X.length} -> ${CAP} by uniform sample over the union`);
                X = Xs; Y = Ys;
            }
            /* PER-CHANNEL STANDARDISATION OF THE LOSS.
             *
             * A plain weighted MSE on raw actions is dominated by whichever
             * channel has the widest dynamic range, and here that hid the only
             * failure that mattered. Measured on the cloned policy: the
             * teacher's gimbal command has a mean magnitude of 0.0244 — 88% of
             * ticks are under 0.05 — while the student's error on it is 0.0091.
             * That is 37% of the signal. Throttle swings across most of [-1,1],
             * so an identical absolute error there is negligible. The optimiser
             * was correctly minimising what it was asked to minimise, and what
             * it was asked to minimise was almost independent of attitude.
             *
             * The ablation makes the consequence unambiguous: handing the two
             * gimbal channels back to the teacher and leaving everything else to
             * the student takes it from 0/120 catches to 42/120.
             *
             * So each channel's squared error is divided by that channel's
             * variance in the data, which makes every channel contribute
             * comparably regardless of scale, and CHANNEL_W becomes a
             * deliberate emphasis ON TOP of that rather than an accidental one. */
            const chVar = new Float64Array(N_OUT);
            {
                const mean = new Float64Array(N_OUT);
                for (const y of Y) for (let c = 0; c < N_OUT; c++) mean[c] += y[c];
                for (let c = 0; c < N_OUT; c++) mean[c] /= Y.length;
                for (const y of Y) for (let c = 0; c < N_OUT; c++) { const d = y[c] - mean[c]; chVar[c] += d * d; }
                for (let c = 0; c < N_OUT; c++) chVar[c] = Math.max(1e-6, chVar[c] / Y.length);
            }
            /* AND A FLOOR, because 1/variance explodes on a channel that does
             * not vary. The booster has no flaps and no legs, so the teacher
             * writes a constant zero to channels 4-8; their variance is ~1e-6
             * and dividing by it handed them five orders of magnitude more
             * weight than the controls that fly the vehicle. The first run of
             * this printed eff weights of 2.17 on the fins and 0.00 on throttle,
             * engine, gimbal and commit — a loss that ignored every channel that
             * matters. A channel with no variation has nothing to teach: weight
             * it zero and say so. */
            const EFF_W = new Float64Array(N_OUT);
            const dead = [];
            for (let c = 0; c < N_OUT; c++) {
                if (Math.sqrt(chVar[c]) < 0.01) { EFF_W[c] = 0; dead.push(c); }
                else EFF_W[c] = CHANNEL_W[c] / chVar[c];
            }
            if (dead.length) log(`   constant channels, excluded from the loss: ${dead.join(",")}`);
            { // keep the overall loss scale sane so the learning rate still means something
                let m = 0, live = 0;
                for (let c = 0; c < N_OUT; c++) if (EFF_W[c] > 0) { m += EFF_W[c]; live++; }
                m /= Math.max(1, live);
                for (let c = 0; c < N_OUT; c++) EFF_W[c] /= m;
            }
            log(`   channel sd ` + Array.from(chVar).map(v => Math.sqrt(v).toFixed(3)).join(" ") +
                `
   eff weight ` + Array.from(EFF_W).map(v => v.toFixed(2)).join(" "));

            const cut = Math.floor(X.length * 0.9);
            const Xtr = X.slice(0, cut), Ytr = Y.slice(0, cut);
            const Xva = X.slice(cut), Yva = Y.slice(cut);
            brain = SEEDFROM && round === 0
                ? NN.Brain.fromJSON(JSON.parse(fs.readFileSync(SEEDFROM, "utf8")).brain)
                : new NN.Brain(SPEC, NN.mulberry32(90210 + round), { act: "tanh" });
            const tr = new Trainer(brain, { lr: LR });
            const rng = NN.mulberry32(555 + round);
            for (let e = 0; e < EPOCHS; e++) {
                const loss = tr.trainEpoch(Xtr, Ytr, { batch: 256, weights: EFF_W, rng });
                if (e === EPOCHS - 1 || e % 4 === 0) {
                    const ce = channelError(brain, Xva, Yva);
                    log(`   epoch ${String(e).padStart(2)}  loss ${loss.toFixed(5)}` +
                        `   held-out MAE  thr ${ce[0].toFixed(3)}  eng ${ce[1].toFixed(3)}` +
                        `  gx ${ce[2].toFixed(3)}  gy ${ce[3].toFixed(3)}  commit ${ce[9].toFixed(3)}`);
                }
            }

            const ev = evaluate(brain, RANK);
            log(`   ON-POLICY (rank bank, ${ev.n} eps): caught ${ev.caught}/${ev.n}` +
                `  mean ${ev.mean.toFixed(3)} +/- ${ev.se.toFixed(3)}  ·  ` +
                Object.entries(ev.tally).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(", "));
            fs.writeFileSync(path.join(OUT, `round${round}.json`), JSON.stringify({
                round, beta, caught: ev.caught, n: ev.n, mean: ev.mean, se: ev.se,
                inputs: N_IN, lags: LAGS, arch: ARCH, gen: 0, brain: brain.toJSON()
            }));
            if (!best || ev.caught > best.caught || (ev.caught === best.caught && ev.mean > best.mean)) {
                best = { round, caught: ev.caught, mean: ev.mean, json: brain.toJSON() };
            }
        }

        log(`\nBEST ROUND: ${best.round} — caught ${best.caught}/${RANK.length} on the rank bank`);
        const bb = NN.Brain.fromJSON(best.json);
        const conf = evaluate(bb, CONFIRM);
        log(`CONFIRMATION on an untouched bank (${conf.n} eps): caught ${conf.caught}/${conf.n}` +
            `  mean ${conf.mean.toFixed(3)} +/- ${conf.se.toFixed(3)}`);
        log(`   ` + Object.entries(conf.tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
        /* RE-CALIBRATE BEFORE HANDING BACK TO THE GA.
         *
         * Brain.mutate scales its Gaussian by net.scales[l], which is the RMS of
         * that layer's weights — recorded when the brain was built and NOT
         * updated by gradient descent. A distilled network's weights have a
         * completely different spread from the random draw it started at, so
         * evolving it with the stale scales applies a mutation sized for the
         * wrong distribution: too large and it destroys the distillation on the
         * first generation, too small and it never explores. calibrate()
         * recomputes them from the weights that actually exist.
         *
         * Evolution.fromJSON calibrates on load; the --warm path does not, so
         * doing it here is what makes the hand-off safe either way. */
        bb.calibrate();
        fs.writeFileSync(path.join(OUT, "best.json"), JSON.stringify({
            round: best.round, caught: conf.caught, n: conf.n, mean: conf.mean, se: conf.se,
            inputs: N_IN, lags: LAGS, arch: ARCH, gen: 0, brain: bb.toJSON()
        }));
        log(`wrote ${path.join(OUT, "best.json")}`);
    })();
}

module.exports = { run };
