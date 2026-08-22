/* tolerance.js — HOW ACCURATE DOES THE GIMBAL ACTUALLY HAVE TO BE?
 *
 * The ablation says handing the gimbal back to the teacher recovers most of the
 * catch rate, so attitude fidelity is the binding constraint. That does not say
 * how much fidelity is needed, and without that number there is no way to know
 * whether a cloned policy is one training run away or in the wrong regime
 * entirely.
 *
 * So: take the TEACHER, which catches, and corrupt only its gimbal channels
 * with zero-mean Gaussian noise of increasing sigma. The sigma at which catches
 * collapse is the precision the student has to reach. Compare that against the
 * student's measured gimbal error and the answer is immediate — either the fit
 * needs to get better, or no achievable fit will do and the ACTION SPACE is
 * wrong.
 */
"use strict";
const WM = require("../world.js");
const SC = require("../scenarios.js");
const NN = require("../nn.js");
const TEACH = require("./teacher.js");

const N = Number(process.argv[2] || 150);
const label = new Float64Array(WM.N_OUT);

function fly(sigma, seedBase) {
    const rng = NN.mulberry32(seedBase >>> 0);
    const held = new Float64Array(WM.N_OUT);
    let caught = 0, sum = 0;
    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(0, 9800000 + i * 7919);
        const w = new WM.World(sc);
        held.fill(0); let tick = 0;
        const r = w.runEpisode((wo, out) => {
            TEACH.advise(wo, label);
            for (let k = 0; k < WM.N_OUT; k++) out[k] = label[k];
            if (sigma > 0) {
                for (const c of [2, 3]) {
                    // Box-Muller, fresh each draw; no module-level spare, which
                    // is a bug this collection has shipped before.
                    const u = Math.max(1e-9, rng()), v = rng();
                    out[c] += Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
                    out[c] = Math.max(-1, Math.min(1, out[c]));
                }
            }
            if (tick % NN.DECIDE_EVERY === 0) { for (const k of NN.DECISION_SLOTS) held[k] = out[k]; }
            else { for (const k of NN.DECISION_SLOTS) out[k] = held[k]; }
            tick++;
            return out;
        });
        if (WM.OUTCOME_NAME[r.outcome] === "caught") caught++;
        sum += r.total;
    }
    return { caught, mean: sum / N };
}

console.log(`teacher with Gaussian noise on the gimbal channels only · ${N} episodes\n`);
console.log(`  sigma      MAE it implies    caught      mean`);
for (const sigma of [0, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1]) {
    const r = fly(sigma, 12345);
    const mae = sigma * Math.sqrt(2 / Math.PI);
    console.log(`  ${sigma.toFixed(3)}      ${mae.toFixed(4)}          ${String(r.caught + "/" + N).padStart(7)}   ${r.mean.toFixed(3)}`);
}
console.log(`\n  The student's measured gimbal MAE is about 0.009. Find that row.`);
