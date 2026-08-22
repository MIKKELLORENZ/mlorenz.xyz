/* ablate.js — WHICH CHANNEL IS LOSING THE FLIGHT?
 *
 * The cloned policy reproduces the teacher's actions to a mean absolute error of
 * about 0.01 on every channel, and still catches nothing. That can mean the
 * residual error compounds (which is DAgger's problem to fix) or that ONE
 * channel is doing all the damage while the others are fine. Those need
 * different responses and the difference is cheap to measure: fly hybrids.
 *
 * Each row replaces some of the student's outputs with the teacher's, on the
 * same episodes, and reports what that buys. If handing back the gimbal
 * recovers most of the teacher's catches, the failure is attitude and the fix
 * is to weight or condition attitude better. If handing back throttle and engine
 * group does it, the failure is the vertical plan. If NOTHING short of the whole
 * teacher recovers it, the errors are genuinely distributed and only more
 * on-policy data helps.
 *
 *   node distill/ablate.js <student.json> [n]
 */
"use strict";

const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const SENS = require("../sensors.js");
const TEACH = require("./teacher.js");
const fs = require("fs");

const file = process.argv[2];
const N = Number(process.argv[3] || 150);
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const brain = NN.Brain.fromJSON(raw.brain);
const lags = raw.lags || null;

/* Channel groups, named for what they physically do. */
const GROUPS = {
    "none (pure student)": [],
    "throttle+engine (0,1)": [0, 1],
    "gimbal (2,3)": [2, 3],
    "fins (4-7)": [4, 5, 6, 7],
    "commit (9)": [9],
    "gimbal+throttle+engine": [0, 1, 2, 3],
    "all (pure teacher)": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
};

function fly(fromTeacher) {
    const sensors = new SENS.Sensors(lags);
    const held = new Float64Array(WM.N_OUT);
    const label = new Float64Array(WM.N_OUT);
    let caught = 0, sum = 0; const tally = {};
    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(0, 9800000 + i * 7919);
        const w = new WM.World(sc);
        sensors.reset(); held.fill(0);
        let tick = 0;
        const r = w.runEpisode((wo, out) => {
            const x = sensors.observe(wo);
            TEACH.advise(wo, label);
            const y = brain.forward(x);
            for (let k = 0; k < WM.N_OUT; k++) out[k] = y[k];
            for (const k of fromTeacher) out[k] = label[k];
            // the same 2 Hz latch the deployed policy runs under
            if (tick % NN.DECIDE_EVERY === 0) { for (const k of NN.DECISION_SLOTS) held[k] = out[k]; }
            else { for (const k of NN.DECISION_SLOTS) out[k] = held[k]; }
            sensors.recordAction(out);
            tick++;
            return out;
        });
        const nm = WM.OUTCOME_NAME[r.outcome];
        tally[nm] = (tally[nm] || 0) + 1;
        if (nm === "caught") caught++;
        sum += r.total;
    }
    return { caught, mean: sum / N, tally };
}

console.log(`${file} · ${N} episodes · which channels, handed back to the teacher, recover the catch?\n`);
console.log(`  channels given to the teacher      caught      mean     top outcomes`);
for (const [name, ch] of Object.entries(GROUPS)) {
    const r = fly(ch);
    console.log(`  ${name.padEnd(32)} ${String(r.caught + "/" + N).padStart(7)}   ${r.mean.toFixed(3).padStart(7)}   ` +
        Object.entries(r.tally).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", "));
}
