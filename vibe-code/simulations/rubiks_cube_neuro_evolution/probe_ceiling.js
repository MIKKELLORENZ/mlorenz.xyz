/* probe_ceiling.js — is 85% per-move accuracy learnable at all?
 *
 *   node probe_ceiling.js --states 60000 --epochs 12
 *
 * A DIAGNOSTIC, not a training method. Nothing it produces is ever baked; the shipped
 * brain is evolved, and this file exists to tell the evolution what it is up against.
 *
 * The question it answers. Every approach tried so far — reward, imitation, self-play
 * agreement, four architectures, eleven activations, two projections — converges to
 * 40-45% per-move accuracy. That is either a search failure (the mapping is learnable
 * and the GA cannot find it) or a representation failure (the mapping is not there to
 * be found). Those call for opposite responses, and no amount of further evolution
 * distinguishes them.
 *
 * So: take the easiest possible version of the problem — perfect state, 54 facelets
 * one-hot, no pixels, no memory — and fit it with plain gradient descent, which is
 * unencumbered by the search limits of a GA. Whatever accuracy that reaches is an
 * upper bound on what this class of reactive policy can do, and the gap between it and
 * 42% is what evolution is leaving on the table.
 *
 * The labels are every distance-reducing move at each state, so a prediction counts as
 * correct if it names any optimal turn — the same rule the GA's fitness uses, so the
 * two numbers are directly comparable.
 */
"use strict";
const { load } = require("./load.js");
load();

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
const num = (n, d) => { const v = arg(n, null); return v === null ? d : +v; };

const N = num("states", 60000);
const EPOCHS = num("epochs", 12);
const HID = num("hidden", 512);
const LR = num("lr", 0.05);
const MAXD = num("maxd", 7);

const env = new Env(Object.assign({}, resolveConfig("default").env, { forceOracle: true }));
const nM = env.nMoves;

/* ---- data: states drawn the way self-play actually meets them ---------------
 * Random scrambles give the *initial* distribution; the states a policy visits after a
 * mistake are one step further out. Sampling along random walks from the solved cube
 * covers both, and stratifying by true distance stops the easy shallow states from
 * dominating the loss the way they dominate a solve rate. */
const perDist = new Map();
const want = Math.ceil(N / MAXD);
const rng = mulberry32(12345);
let tries = 0;
while (tries < N * 40) {
    tries++;
    const d = 1 + Math.floor(rng() * MAXD);
    const { state } = scramble(rng, d, env.set);
    const dist = distanceOf(env.oracle, state);
    if (dist < 1 || dist > MAXD) continue;
    let arr = perDist.get(dist); if (!arr) perDist.set(dist, arr = []);
    if (arr.length >= want) continue;
    const opt = env.optimalSet(state);
    if (!opt.length) continue;
    arr.push({ state: state.slice(), opt });
    if ([...perDist.values()].every(a => a.length >= want) && perDist.size === MAXD) break;
}
const data = [].concat(...[...perDist.values()]);
console.log(`states: ${data.length} (${[...perDist.entries()].sort((a, b) => a[0] - b[0])
    .map(([d, a]) => `d${d}:${a.length}`).join(" ")})`);

/* one-hot facelets: 54 x 6 */
const IN = 54 * 6;
function enc(state, out) {
    out.fill(0);
    for (let i = 0; i < 54; i++) out[i * 6 + state[i]] = 1;
    return out;
}

/* ---- a plain two-layer net trained by SGD ---- */
const W1 = new Float64Array(IN * HID), b1 = new Float64Array(HID);
const W2 = new Float64Array(HID * nM), b2 = new Float64Array(nM);
const r2 = mulberry32(999);
for (let i = 0; i < W1.length; i++) W1[i] = (r2() * 2 - 1) * Math.sqrt(6 / (IN + HID));
for (let i = 0; i < W2.length; i++) W2[i] = (r2() * 2 - 1) * Math.sqrt(6 / (HID + nM));

const x = new Float64Array(IN), h = new Float64Array(HID), z = new Float64Array(nM);
const dh = new Float64Array(HID), dz = new Float64Array(nM);

function forward(state) {
    enc(state, x);
    for (let j = 0; j < HID; j++) {
        let s = b1[j];
        /* the input is one-hot, so only 54 of its 324 entries are non-zero */
        for (let i = 0; i < 54; i++) s += W1[(i * 6 + state[i]) * HID + j];
        h[j] = s > 0 ? s : 0;
    }
    for (let k = 0; k < nM; k++) {
        let s = b2[k];
        for (let j = 0; j < HID; j++) s += W2[j * nM + k] * h[j];
        z[k] = s;
    }
    return z;
}

const idx = data.map((_, i) => i);
for (let ep = 0; ep < EPOCHS; ep++) {
    for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(r2() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    let hit = 0;
    const lr = LR * Math.pow(0.85, ep);
    for (const ii of idx) {
        const d = data[ii];
        forward(d.state);
        let mx = -Infinity, arg = 0;
        for (let k = 0; k < nM; k++) if (z[k] > mx) { mx = z[k]; arg = k; }
        if (d.opt.indexOf(arg) >= 0) hit++;
        /* softmax cross-entropy against a uniform distribution over the optimal moves */
        let tot = 0;
        for (let k = 0; k < nM; k++) { dz[k] = Math.exp(z[k] - mx); tot += dz[k]; }
        for (let k = 0; k < nM; k++) dz[k] /= tot;
        for (const o of d.opt) dz[o] -= 1 / d.opt.length;
        dh.fill(0);
        for (let j = 0; j < HID; j++) {
            if (h[j] <= 0) continue;
            let g = 0;
            for (let k = 0; k < nM; k++) { g += W2[j * nM + k] * dz[k]; W2[j * nM + k] -= lr * dz[k] * h[j]; }
            dh[j] = g;
        }
        for (let k = 0; k < nM; k++) b2[k] -= lr * dz[k];
        for (let j = 0; j < HID; j++) {
            if (dh[j] === 0) continue;
            const g = lr * dh[j];
            for (let i2 = 0; i2 < 54; i2++) W1[(i2 * 6 + data[ii].state[i2]) * HID + j] -= g;
            b1[j] -= g;
        }
    }
    console.log(`  epoch ${String(ep + 1).padStart(2)}  train accuracy ${(hit / data.length * 100).toFixed(1)}%`);
}

/* held-out, by distance */
console.log("\nheld-out accuracy by true distance:");
const rngT = mulberry32(777001);
const byD = new Map();
for (let i = 0; i < 20000; i++) {
    const d = 1 + Math.floor(rngT() * MAXD);
    const { state } = scramble(rngT, d, env.set);
    const dist = distanceOf(env.oracle, state);
    if (dist < 1 || dist > MAXD) continue;
    const opt = env.optimalSet(state);
    if (!opt.length) continue;
    forward(state);
    let mx = -Infinity, arg = 0;
    for (let k = 0; k < nM; k++) if (z[k] > mx) { mx = z[k]; arg = k; }
    let e = byD.get(dist); if (!e) byD.set(dist, e = { n: 0, hit: 0 });
    e.n++; if (opt.indexOf(arg) >= 0) e.hit++;
}
let n = 0, hit = 0;
for (const k of [...byD.keys()].sort((a, b) => a - b)) {
    const e = byD.get(k);
    console.log(`   d${k}  ${String(e.n).padStart(5)} states   ${(e.hit / e.n * 100).toFixed(1)}%`);
    n += e.n; hit += e.hit;
}
console.log(`  overall ${(hit / n * 100).toFixed(1)}%   (the evolved champion manages 53.5% on its own rollout)`);
