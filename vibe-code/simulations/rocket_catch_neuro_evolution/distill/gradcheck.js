/* gradcheck.js — the analytic gradient against a central difference.
 *
 * THE STEP SIZE MUST RESPECT Float32. nn.js stores weights in Float32Array, so
 * the textbook h = 1e-6 on a weight of magnitude 1 rounds straight back to the
 * original value: the loss difference comes out EXACTLY zero and every gradient
 * looks infinitely wrong. The first run of this check "failed" on a gradient
 * that was in fact correct to 0.2%. Scale h to the weight and keep it well
 * above Float32 resolution (~1e-7 relative).
 */
"use strict";
const { Trainer } = require("./gradnet.js");
const NN = require("../nn.js");

const spec = { nin: 7, layers: [7, 6, 5, 4], arch: "test" };
const b = new NN.Brain(spec, NN.mulberry32(3), { act: process.argv[2] || "tanh" });
const tr = new Trainer(b, { lr: 0, weightDecay: 0 });
const rng = NN.mulberry32(11);
const x = Float64Array.from({ length: 7 }, () => rng() * 2 - 1);
const y = Float64Array.from({ length: 4 }, () => rng() * 2 - 1);
const wgt = Float64Array.from({ length: 4 }, () => 0.5 + rng());

const loss = () => { const o = b.forward(x); let L = 0; for (let i = 0; i < 4; i++) { const e = o[i] - y[i]; L += wgt[i] * e * e; } return L; };

tr.accumulate(x, y, wgt);
const analytic = tr.grad.map(g => Float64Array.from(g));

let worst = 0, worstAt = "", n = 0;
for (let l = 0; l < b.net.weights.length; l++) {
    const w = b.net.weights[l];
    for (let k = 0; k < w.length; k++) {
        const o0 = w[k];
        const h = Math.max(2e-3, Math.abs(o0) * 2e-3);
        w[k] = o0 + h; const lp = loss();
        w[k] = o0 - h; const lm = loss();
        w[k] = o0;
        const num = (lp - lm) / (2 * h), ana = analytic[l][k];
        /* An ABSOLUTE FLOOR in the denominator. Pure relative error judges a
         * 2e-4 gradient by the same standard as a 2e-1 one, and a central
         * difference with a Float32-sized step simply cannot resolve the small
         * ones — softsign 'failed' at 0.9% on a gradient of 2.08e-4 against
         * 2.05e-4, which is the difference method being imprecise, not the
         * backward pass being wrong. */
        const den = Math.max(2e-3, Math.abs(num) + Math.abs(ana));
        const rel = Math.abs(num - ana) / den;
        n++;
        if (rel > worst) { worst = rel; worstAt = `layer ${l} idx ${k}  num ${num.toExponential(3)}  ana ${ana.toExponential(3)}`; }
    }
}
console.log(`act ${b.act} · ${n} weights checked`);
console.log(`worst relative error ${worst.toExponential(3)}   at ${worstAt}`);
const OK = worst < 5e-3;      // central difference on Float32 weights
console.log(OK ? "GRADIENT CHECK PASSED" : "GRADIENT CHECK FAILED");
process.exit(OK ? 0 : 1);
