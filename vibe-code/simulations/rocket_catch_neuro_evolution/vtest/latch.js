/* latch.js — CAN THE POLICY THE STUDENT IS BEING TAUGHT EVEN BE EXECUTED?
 *
 * The teacher catches 23% of stage 0. Five rounds of DAgger from it caught
 * 0/200, every round, with the cloned actions matching to a mean absolute error
 * of about 0.02 per channel. That combination — the copy is accurate and the
 * copy cannot fly — has one more explanation that has not been tested, and it
 * is not about the labels at all.
 *
 * A deployed brain does not choose an engine group every control tick. Slot 1
 * is in DECISION_SLOTS, so it is LATCHED and only re-read every DECIDE_EVERY
 * ticks; between those it repeats. The teacher has no such latch — it decides
 * every tick, and its ignition is a distance-triggered event that the whole
 * approach is built around:
 *
 *     light when h <= (h_brake + v * dead_time) * (1 + margin)
 *
 * At 250 m/s, one latch period is 125 m of altitude. The ignition margin is
 * about 140 m. So the student can be up to a full margin late through no fault
 * of its network — and would look exactly like a student that had failed to
 * learn the trigger.
 *
 * This flies the TEACHER under the student's latch. If its catch rate survives,
 * the latch is innocent and the fault is in the labels or the optimisation. If
 * it collapses, then the target policy is not representable by the thing being
 * trained, and no amount of DAgger can fix that — the latch has to change, or
 * the teacher has to be re-tuned to fly within it.
 *
 *   node vtest/latch.js [n] [stages]
 */
"use strict";
const TEACH = require("../distill/teacher.js");
const NN = require("../nn.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");

const N = Number(process.argv[2] || 100);
const STAGES = (process.argv[3] || "0,1").split(",").map(Number);

function run(stage, every) {
    let caught = 0; const tally = {};
    const out = new Float64Array(WM.N_OUT);
    const held = new Float64Array(WM.N_OUT);
    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(stage, 940000 + stage * 100003 + i * 7919);
        sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
        const w = new WM.World(sc);
        let tick = 0;
        held.fill(0);
        const r = w.runEpisode((wo, o) => {
            TEACH.advise(wo, out);
            for (let k = 0; k < WM.N_OUT; k++) o[k] = out[k];
            if (every > 0) {
                if (tick % every === 0) { for (const k of NN.DECISION_SLOTS) held[k] = o[k]; }
                else { for (const k of NN.DECISION_SLOTS) o[k] = held[k]; }
            }
            tick++;
            return o;
        });
        const nm = WM.OUTCOME_NAME[r.outcome];
        tally[nm] = (tally[nm] || 0) + 1;
        if (nm === "caught") caught++;
    }
    const p = caught / N, se = Math.sqrt(p * (1 - p) / N);
    return { caught, p, se, tally };
}

console.log(`the teacher, flown under the student's decision latch ` +
    `(slots ${NN.DECISION_SLOTS.join(",")}, every ${NN.DECIDE_EVERY} ticks)\n`);
console.log(`  stage  latch          caught          outcomes`);
for (const stage of STAGES) {
    for (const [label, every] of [["none (as taught)", 0], [`every ${NN.DECIDE_EVERY}`, NN.DECIDE_EVERY],
                                  ["every 5", 5], ["every 3", 3], ["every 2", 2]]) {
        const r = run(stage, every);
        console.log(`   ${stage}     ${label.padEnd(16)} ${String(r.caught + "/" + N).padStart(7)} ` +
            `(${(100 * r.p).toFixed(1).padStart(4)}% +/- ${(100 * r.se).toFixed(1)})   ` +
            Object.entries(r.tally).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", "));
    }
    console.log();
}
