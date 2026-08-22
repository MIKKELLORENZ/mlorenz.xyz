/* capacity.js — STEP 3'S DIAGNOSTIC, RUN BEFORE COMMITTING TO AN ARCHITECTURE.
 *
 * The plateau note is explicit that training accuracy against the teacher is a
 * diagnostic and not a result:
 *
 *   low accuracy   -> the observation encoding or the capacity cannot represent
 *                     the teacher. Stop. No amount of DAgger or evolution helps.
 *   high accuracy,
 *   poor play      -> distribution shift, which is what DAgger is for.
 *
 * So before spending hours of DAgger on one architecture, fit them all to the
 * SAME cloned dataset and read off which of them can express the pilot at all.
 * This also decides something the GA cares about downstream: a distilled policy
 * has to be handed back to evolution afterwards, and a 40,000-weight genome is
 * near the edge of what direct encoding searches well, so if a 12,000-weight
 * network fits the teacher just as closely it is strictly the better target.
 *
 *   node distill/capacity.js [episodes] [epochs]
 */
"use strict";

const path = require("path");
const os = require("os");
const { Worker } = require("worker_threads");
const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const SENS = require("../sensors.js");
const { Trainer, channelError } = require("./gradnet.js");
const { CHANNEL_W } = require("./dagger_w.js");

const EPS = Number(process.argv[2] || 300);
const EPOCHS = Number(process.argv[3] || 15);
const NW = Math.max(2, Math.min(40, os.cpus().length - 4));
const WORKER = path.join(__dirname, "dagger.js");

/* Every candidate must see the same episodes; only the network differs. */
const CANDIDATES = [
    { name: "std   209in", lags: null, arch: "std" },
    { name: "tiny  209in", lags: null, arch: "tiny" },
    { name: "tiny  139in", lags: [2, 10, 35], arch: "tiny" },
    { name: "mini  139in", lags: [2, 10, 35], arch: "mini" }
];

function collect(lags, specs) {
    return new Promise((resolve, reject) => {
        const chunks = Array.from({ length: NW }, () => []);
        specs.forEach((s, i) => chunks[i % NW].push(s));
        const parts = []; let live = 0, failed = null; let caught = 0;
        for (let k = 0; k < NW; k++) {
            if (!chunks[k].length) continue;
            live++;
            const wk = new Worker(WORKER, { workerData: {
                lags, brainJSON: null, beta: 1, specs: chunks[k], seed: (999 + k * 7919) >>> 0
            } });
            wk.on("message", (m) => { parts.push(m); caught += m.caught; });
            wk.on("error", (e) => { failed = e; });
            wk.on("exit", () => { if (--live === 0) { failed ? reject(failed) : resolve({ parts, caught }); } });
        }
        if (live === 0) resolve({ parts: [], caught: 0 });
    });
}

function rows(parts) {
    const X = [], Y = [];
    for (const p of parts) for (let i = 0; i < p.n; i++) {
        X.push(p.flatX.subarray(i * p.nIn, (i + 1) * p.nIn));
        Y.push(p.flatY.subarray(i * WM.N_OUT, (i + 1) * WM.N_OUT));
    }
    return { X, Y };
}

function evaluate(brain, lags, bank) {
    const pol = new NN.BrainPolicy(brain, { lags });
    let caught = 0, sum = 0;
    for (const s of bank) {
        const w = new WM.World(SC.makeScenario(s.stage, s.seed));
        pol.reset();
        const r = w.runEpisode((ww, o) => pol.act(ww, o));
        if (WM.OUTCOME_NAME[r.outcome] === "caught") caught++;
        sum += r.total;
    }
    return { caught, mean: sum / bank.length };
}

const specs = [];
for (let i = 0; i < EPS; i++) specs.push({ stage: 0, seed: 7000000 + i * 7919 });
const RANK = [];
for (let i = 0; i < 120; i++) RANK.push({ stage: 0, seed: 8000000 + i * 7919 });

(async function () {
    console.log(`capacity probe · ${EPS} teacher episodes · ${EPOCHS} epochs · ${NW} workers\n`);
    const cache = new Map();
    console.log(`  architecture   weights   held-out MAE (thr/eng/gx/gy)        on-policy`);
    for (const c of CANDIDATES) {
        const key = JSON.stringify(c.lags);
        if (!cache.has(key)) cache.set(key, await collect(c.lags, specs));
        const { parts, caught } = cache.get(key);
        const { X, Y } = rows(parts);
        const cut = Math.floor(X.length * 0.9);
        const nIn = new SENS.Sensors(c.lags).nInput;
        const brain = new NN.Brain(NN.netSpec(nIn, c.arch), NN.mulberry32(4242), { act: "tanh" });
        const tr = new Trainer(brain, { lr: 2e-3 });
        const rng = NN.mulberry32(77);
        for (let e = 0; e < EPOCHS; e++) tr.trainEpoch(X.slice(0, cut), Y.slice(0, cut), { batch: 256, weights: CHANNEL_W, rng });
        const ce = channelError(brain, X.slice(cut), Y.slice(cut));
        const ev = evaluate(brain, c.lags, RANK);
        console.log(`  ${c.name}   ${String(brain.weightCount()).padStart(6)}    ` +
            `${ce[0].toFixed(3)} / ${ce[1].toFixed(3)} / ${ce[2].toFixed(3)} / ${ce[3].toFixed(3)}` +
            `        caught ${ev.caught}/${RANK.length}  mean ${ev.mean.toFixed(3)}` +
            `   (teacher itself caught ${caught}/${EPS})`);
    }
    console.log(`\n  Read this as a CAPACITY test, not a performance test. Low MAE everywhere means`);
    console.log(`  the encoding is fine and any of these can express the pilot; poor play alongside`);
    console.log(`  low MAE is distribution shift, which is DAgger's job, not the architecture's.`);
})();
