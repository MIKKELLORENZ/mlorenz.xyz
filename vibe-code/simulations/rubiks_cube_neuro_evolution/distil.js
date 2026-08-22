/* distil.js — fit the oracle's policy by gradient descent, on pixels.
 *
 *   node distil.js --config unf12 --states 80000 --epochs 10 --hidden 512
 *
 * ─── read this before using the result ─────────────────────────────────────
 *
 * This is NOT the project's method. Everything else here is evolved: no gradients, no
 * backpropagation, weights that got where they are by being copied, mutated and crossed
 * over. A brain produced by this file is a different kind of object and is labelled as
 * one wherever it appears.
 *
 * It exists because probe_ceiling.js settled a question five rounds of evolution could
 * not. Every GA approach tried — reward shaping, imitation, self-play agreement, four
 * architectures, eleven activations, two projections, populations from 32 to 256 —
 * converges to 40–45% per-move accuracy. Plain gradient descent on the same mapping
 * reaches 96.7% held out. The mapping was never the problem; the search was, by a
 * factor of two, and no reasonable amount of further evolution closes a gap that size.
 *
 * What is kept, deliberately, is the vision: this reads the same rendered picture the
 * evolved brains read, through the same sparse-matrix renderer, with the same move
 * history and the same eight actions. Only the optimiser changed. Handing it the 54
 * facelets instead would make the numbers better and the project meaningless.
 *
 * The model is a plain MLP because nn.js's Net is a plain MLP, so the result exports
 * straight into the champion format that bake_brain.js, the page and every instrument
 * already understand. A convolution would fit the picture better and would need its own
 * backward pass; on the unfolded view, where every facelet is an axis-aligned block, a
 * dense first layer can learn the same readout.
 *
 * Labels are every distance-reducing move at a state, and a prediction counts correct
 * if it names any of them — identical to the GA's fitness, so the accuracies printed
 * here are directly comparable with burst.js.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { load } = require("./load.js");
load();

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
const num = (n, d) => { const v = arg(n, null); return v === null ? d : +v; };

const CONFIG = String(arg("config", "unf12"));
const N = num("states", 80000);
const EPOCHS = num("epochs", 10);
const HID = num("hidden", 512);
const HID2 = num("hidden2", 0);
const LR = num("lr", 0.002);
const BATCH = num("batch", 32);
const MAXD = num("maxd", 7);
const OUT = String(arg("out", "training/distilled.json"));
const DAGGER = num("dagger", 0);
const DAG_STATES = num("dagger-states", 30000);
const DIST_W = String(arg("dist-weight", "uniform"));

const cfg = resolveConfig(CONFIG);
const env = new Env(Object.assign({}, cfg.env, { forceOracle: true }));
const IN = env.layout.size, nM = env.nMoves;
console.log("distil " + CONFIG + ": " + IN + " inputs -> " + HID + (HID2 ? "-" + HID2 : "") + " -> " + nM);

/* States come from self-play-shaped trajectories: walk an optimal path from a random
 * scramble and record every state on it, together with the move history the observation
 * carries. Sampling isolated cubes would give the network a history block that never
 * matches what it sees at test time, and this project has already lost a round to an
 * observation whose training and test distributions disagreed. */
const rng = mulberry32(4242);
const X = [], Y = [];
const perDist = new Map();
/* How many states to keep at each true distance.
 *
 * Uniform is the obvious choice and it is not the right one. The measured error profile
 * is not flat: a model at 87.7% overall runs at 85.9% across distances four to six, and
 * those are the states a deep episode spends most of its moves in. Every wrong decision
 * there costs two moves — one to make the mistake and one to undo it — so the deep
 * rungs are decided almost entirely by accuracy in that band.
 *
 * "deep" weights a distance by its square, which puts roughly a third of the pool at the
 * far end instead of a seventh, while still keeping every shallow rung populated so the
 * endgame does not rot. */
const distW = [];
for (let d = 1; d <= MAXD; d++) {
    distW.push(DIST_W === "deep" ? d * d : DIST_W === "ramp" ? d : 1);
}
const wTot = distW.reduce((a, b) => a + b, 0);
const wantAt = d => Math.ceil(N * distW[d - 1] / wTot);
let guard = 0;
while (X.length < N && guard++ < N * 6) {
    const d = 1 + Math.floor(rng() * MAXD);
    const s0 = scramble(rng, d, env.set).state;
    const d0 = distanceOf(env.oracle, s0);
    if (d0 < 1 || d0 > MAXD) continue;
    const r = new Runner(env, { forward: () => new Float64Array(nM) }, {
        state: s0.slice(), depth: d, d0, budget: env.budgetFor(env.budgetBasis(d0, d)),
    });
    while (!r.done) {
        const dist = distanceOf(env.oracle, r.state);
        const opt = env.optimalSet(r.state);
        if (!opt.length) break;
        const c = perDist.get(dist) || 0;
        if (c < wantAt(dist)) {
            perDist.set(dist, c + 1);
            X.push(Float32Array.from(r.obs.vec));
            Y.push(opt.slice());
        }
        r.step(opt[Math.floor(rng() * opt.length) % opt.length]);
    }
}
console.log("states: " + X.length + " (" + [...perDist.entries()].sort((a, b) => a[0] - b[0])
    .map(e => "d" + e[0] + ":" + e[1]).join(" ") + ")");

const sizes = HID2 ? [IN, HID, HID2, nM] : [IN, HID, nM];
const W = [], B = [];
const r2 = mulberry32(31337);
for (let l = 0; l < sizes.length - 1; l++) {
    const w = new Float64Array(sizes[l] * sizes[l + 1]);
    const lim = Math.sqrt(6 / (sizes[l] + sizes[l + 1]));
    for (let i = 0; i < w.length; i++) w[i] = (r2() * 2 - 1) * lim;
    W.push(w); B.push(new Float64Array(sizes[l + 1]));
}
const A = sizes.map(n => new Float64Array(n));
const D = sizes.map(n => new Float64Array(n));

/* Adam, and mini-batches.
 *
 * Plain SGD on this input is brittle in a way it was not on the facelet probe. There the
 * input was one-hot: 54 non-zeros of magnitude 1. Here it is 1,296 centred pixel values,
 * so the gradient reaching the first layer is orders of magnitude larger and the usable
 * learning rate is correspondingly smaller — a sweep at 0.05 to 0.15 collapsed all six
 * runs to 17.4%, which is exactly the accuracy of always naming the most common optimal
 * move. That is the degenerate solution, not a hard problem.
 *
 * Per-parameter step sizes remove the whole question, and batching cuts the update noise
 * that made the collapse easy to fall into. */
const MW = W.map(w => new Float64Array(w.length)), VW = W.map(w => new Float64Array(w.length));
const MB = B.map(b => new Float64Array(b.length)), VB = B.map(b => new Float64Array(b.length));
const GW = W.map(w => new Float64Array(w.length)), GB = B.map(b => new Float64Array(b.length));
let adamT = 0;
function adamStep(lr) {
    adamT++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - Math.pow(b1, adamT), c2 = 1 - Math.pow(b2, adamT);
    for (let l = 0; l < W.length; l++) {
        const w = W[l], g = GW[l], m = MW[l], v = VW[l];
        for (let i = 0; i < w.length; i++) {
            const gi = g[i] / BATCH;
            m[i] = b1 * m[i] + (1 - b1) * gi;
            v[i] = b2 * v[i] + (1 - b2) * gi * gi;
            w[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps);
            g[i] = 0;
        }
        const bb = B[l], gb = GB[l], mb = MB[l], vb = VB[l];
        for (let i = 0; i < bb.length; i++) {
            const gi = gb[i] / BATCH;
            mb[i] = b1 * mb[i] + (1 - b1) * gi;
            vb[i] = b2 * vb[i] + (1 - b2) * gi * gi;
            bb[i] -= lr * (mb[i] / c1) / (Math.sqrt(vb[i] / c2) + eps);
            gb[i] = 0;
        }
    }
}

function forward(vec) {
    A[0].set(vec);
    for (let l = 0; l < W.length; l++) {
        const nIn = sizes[l], nOut = sizes[l + 1], w = W[l], b = B[l], a = A[l], o = A[l + 1];
        const last = l === W.length - 1;
        for (let k = 0; k < nOut; k++) {
            let s = b[k];
            for (let i = 0; i < nIn; i++) s += w[i * nOut + k] * a[i];
            o[k] = last ? s : (s > 0 ? s : 0);
        }
    }
    return A[A.length - 1];
}

function trainEpochs(nEpochs, tag) {
const idx = X.map((_, i) => i);
for (let ep = 0; ep < nEpochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(r2() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    const lr = LR * Math.pow(0.85, ep);
    let hit = 0, inBatch = 0;
    for (let q = 0; q < idx.length; q++) {
        const ii = idx[q];
        const z = forward(X[ii]);
        let mx = -Infinity, am = 0;
        for (let k = 0; k < nM; k++) if (z[k] > mx) { mx = z[k]; am = k; }
        if (Y[ii].indexOf(am) >= 0) hit++;
        const dz = D[D.length - 1];
        let tot = 0;
        for (let k = 0; k < nM; k++) { dz[k] = Math.exp(z[k] - mx); tot += dz[k]; }
        for (let k = 0; k < nM; k++) dz[k] /= tot;
        for (let t = 0; t < Y[ii].length; t++) dz[Y[ii][t]] -= 1 / Y[ii].length;
        for (let l = W.length - 1; l >= 0; l--) {
            const nIn = sizes[l], nOut = sizes[l + 1], w = W[l], a = A[l];
            const dOut = D[l + 1], dIn = D[l], gw = GW[l], gb = GB[l];
            if (l > 0) dIn.fill(0);
            for (let k = 0; k < nOut; k++) {
                const g = dOut[k];
                if (g === 0) continue;
                if (l > 0) for (let i = 0; i < nIn; i++) dIn[i] += w[i * nOut + k] * g;
                for (let i = 0; i < nIn; i++) gw[i * nOut + k] += g * a[i];
                gb[k] += g;
            }
            if (l > 0) for (let i = 0; i < nIn; i++) if (a[i] <= 0) dIn[i] = 0;
        }
        if (++inBatch >= BATCH) { adamStep(lr); inBatch = 0; }
    }
    if (inBatch > 0) adamStep(lr);
    console.log("  " + tag + " epoch " + String(ep + 1).padStart(2) + "  train accuracy " +
        (hit / X.length * 100).toFixed(1) + "%");
}
}

trainEpochs(EPOCHS, "base");

/* ---- DAgger --------------------------------------------------------------
 *
 * The gap that matters is not the training accuracy, it is the self-play one. Training
 * states come from *optimal* paths, so the model has never been asked what to do after
 * its own first mistake — and that is exactly where a rollout spends most of its moves.
 * The first pass here fitted its training set to 83% and played its own games at 56%.
 *
 * The fix is to let the model choose the states and the oracle choose the labels: roll
 * out with the current weights, record everything visited, label each with every
 * distance-reducing move, add it to the pool and refit. The distribution the model is
 * trained on converges to the distribution it actually meets.
 *
 * One caveat this folder has paid for before: a label has to be reachable from the
 * state the policy is in. Here that holds automatically inside the oracle's radius, and
 * states outside it are dropped rather than guessed at — an unlabelled state is not the
 * same thing as a hard one, and inventing a target for it is how a DAgger round makes a
 * policy worse instead of better. */
function makeNet() {
    const a = { kind: "mlp", hidden: HID2 ? [HID, HID2] : [HID], acts: { hidden: "relu", out: "linear" } };
    const n = buildNet(a, env.layout, mulberry32(1));
    const jj = n.toJSON();
    for (let l = 0; l < W.length; l++) {
        const nIn = sizes[l], nOut = sizes[l + 1];
        const row = jj.weights[l];
        for (let k = 0; k < nOut; k++) {
            for (let i = 0; i < nIn; i++) row[k * (nIn + 1) + i] = W[l][i * nOut + k];
            row[k * (nIn + 1) + nIn] = B[l][k];
        }
    }
    return { arch: a, net: netFromJSON({ net: jj }), json: jj };
}

/* Checkpoint after every round, not only at the end.
 *
 * A run that writes its artifact once, on completion, is a run whose four hours are
 * worth nothing if it is still going when the deadline arrives — and the intermediate
 * rounds are not throwaway here, since each one is a complete, usable policy. Writing
 * every round also makes the DAgger curve auditable after the fact rather than only
 * visible in a log. */
function save(tag) {
    const built = makeNet();
    const outCfg = JSON.parse(JSON.stringify(cfg));
    outCfg.arch = built.arch;
    fs.writeFileSync(path.resolve(__dirname, OUT), JSON.stringify({
        gen: 0, fitness: 0, depth: 7, configName: CONFIG + "+distilled", config: outCfg,
        distilled: true, daggerRound: tag, net: built.json,
    }));
    console.log("  wrote " + OUT + " (" + built.net.paramCount.toLocaleString("en-US") +
        " weights, GRADIENT-TRAINED, " + tag + ")");
}

save("base");

for (let round = 1; round <= DAGGER; round++) {
    const cur = makeNet().net;
    const rngD = mulberry32(90000 + round * 7919);
    let added = 0, visited = 0, hit = 0;
    while (added < DAG_STATES) {
        const d = 1 + Math.floor(rngD() * MAXD);
        const s0 = scramble(rngD, d, env.set).state;
        const d0 = distanceOf(env.oracle, s0);
        if (d0 < 1 || d0 > MAXD) continue;
        const r = new Runner(env, cur, {
            state: s0.slice(), depth: d, d0, budget: env.budgetFor(env.budgetBasis(d0, d)),
        });
        while (!r.done) {
            const opt = env.optimalSet(r.state);
            if (!opt.length) break;                 /* solved, or outside the radius */
            const pick = chooseMove(r.peek());
            visited++;
            if (opt.indexOf(pick) >= 0) hit++;
            X.push(Float32Array.from(r.obs.vec));
            Y.push(opt.slice());
            added++;
            r.step(pick);                           /* the MODEL drives */
        }
    }
    console.log("dagger round " + round + ": added " + added +
        " states from its own rollouts (self-play accuracy " +
        (hit / visited * 100).toFixed(1) + "%), pool now " + X.length);
    trainEpochs(Math.max(3, Math.round(EPOCHS / 2)), "dag" + round);
    save("dagger" + round);
}

save("final");
