/* whenbig.js — is the gimbal failure in the QUIET ticks or the LOUD ones?
 *
 * Two facts that look contradictory:
 *   - handing the gimbal to the teacher takes the student from 0/120 to 42/120;
 *   - corrupting the teacher's gimbal with noise at the student's own error
 *     level (MAE 0.008) costs it nothing at all.
 *
 * Both are true if the student's error is not noise but STRUCTURE: fine in the
 * 88% of ticks where the command is near zero, and wrong exactly when a large
 * correction is demanded. The binned fit supports that — MAE 0.047 in the
 * [0.2,0.5) band and 0.165 above 0.5, against 0.008 near zero.
 *
 * So hand the gimbal back only on ticks where the teacher's command exceeds a
 * threshold, and see how few such ticks are needed to recover the catch. If a
 * handful of loud ticks per episode is enough, the fix is not a better average
 * fit — it is making the rare large corrections learnable at all.
 */
"use strict";
const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const SENS = require("../sensors.js");
const TEACH = require("./teacher.js");
const fs = require("fs");

const file = process.argv[2];
const N = Number(process.argv[3] || 120);
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const brain = NN.Brain.fromJSON(raw.brain);
const lags = raw.lags || null;

function fly(thresh, invert) {
    const sensors = new SENS.Sensors(lags);
    const held = new Float64Array(WM.N_OUT);
    const label = new Float64Array(WM.N_OUT);
    let caught = 0, sum = 0, handed = 0, ticks = 0;
    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(0, 9800000 + i * 7919);
        const w = new WM.World(sc);
        sensors.reset(); held.fill(0); let tick = 0;
        const r = w.runEpisode((wo, out) => {
            const x = sensors.observe(wo);
            TEACH.advise(wo, label);
            const y = brain.forward(x);
            for (let k = 0; k < WM.N_OUT; k++) out[k] = y[k];
            const mag = Math.max(Math.abs(label[2]), Math.abs(label[3]));
            const big = mag >= thresh;
            if (thresh >= 0 && (invert ? !big : big)) { out[2] = label[2]; out[3] = label[3]; handed++; }
            ticks++;
            if (tick % NN.DECIDE_EVERY === 0) { for (const k of NN.DECISION_SLOTS) held[k] = out[k]; }
            else { for (const k of NN.DECISION_SLOTS) out[k] = held[k]; }
            sensors.recordAction(out); tick++;
            return out;
        });
        if (WM.OUTCOME_NAME[r.outcome] === "caught") caught++;
        sum += r.total;
    }
    return { caught, mean: sum / N, share: 100 * handed / ticks };
}

console.log(`${file} · ${N} episodes · gimbal handed to the teacher only on selected ticks\n`);
console.log(`  rule                                    ticks handed   caught     mean`);
for (const t of [0.5, 0.2, 0.1, 0.05, 0.0]) {
    const r = fly(t, false);
    console.log(`  |teacher gimbal| >= ${t.toFixed(2)}                    ${r.share.toFixed(1).padStart(5)}%       ${String(r.caught + "/" + N).padStart(7)}  ${r.mean.toFixed(3)}`);
}
const inv = fly(0.05, true);
console.log(`  |teacher gimbal| <  0.05 (the quiet ones)  ${inv.share.toFixed(1).padStart(5)}%       ${String(inv.caught + "/" + N).padStart(7)}  ${inv.mean.toFixed(3)}`);
