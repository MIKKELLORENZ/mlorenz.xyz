/* teacher_check.js — does making the pilot STATELESS change what it does?
 *
 * The teacher re-derives ignition state, engine group and descent cap from the
 * world instead of remembering them. That is required for DAgger, and it is
 * also a rewrite of a controller that took a day to get right — so it has to be
 * shown not to have cost anything. Flown on the same episodes as the original.
 *
 * Also reports the re-planning behaviour: how often the teacher judges the
 * rails unreachable and diverts instead, and how often nothing is left at all.
 */
"use strict";
const WM = require("../world.js");
const SC = require("../scenarios.js");
const GOLD = require("../golden_test.js");
const T = require("./teacher.js");

const N = Number(process.argv[2] || 40);
const STAGES = (process.argv[3] || "0,1,2,3").split(",").map(Number);

for (const stage of STAGES) {
    if (SC.STAGES[stage].vehicle !== "booster") continue;
    const res = {};
    for (const [name, mk] of [["original", () => GOLD.makePilot(GOLD.GAINS)],
                              ["stateless teacher", () => { const o = new Float64Array(WM.N_OUT); return (w, oo) => { T.advise(w, oo); void o; }; }]]) {
        let caught = 0; const tally = {}, why = {};
        for (let i = 0; i < N; i++) {
            const sc = SC.makeScenario(stage, 90000 + i * 7919);
            sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
            const w = new WM.World(sc);
            const pol = mk();
            const r = w.runEpisode((ww, oo) => {
                if (name !== "original") { const k = T.advise(ww, oo); why[k] = (why[k] || 0) + 1; return oo; }
                return pol(ww, oo);
            });
            const nm = WM.OUTCOME_NAME[r.outcome];
            tally[nm] = (tally[nm] || 0) + 1;
            if (nm === "caught") caught++;
        }
        res[name] = { caught, tally, why };
    }
    const a = res["original"], b = res["stateless teacher"];
    const totalWhy = Object.values(b.why).reduce((x, y) => x + y, 0) || 1;
    console.log(`stage ${stage}  original ${a.caught}/${N} caught   ·   stateless ${b.caught}/${N} caught`);
    console.log(`   original  : ` + Object.entries(a.tally).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", "));
    console.log(`   stateless : ` + Object.entries(b.tally).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", "));
    console.log(`   labels    : ` + Object.entries(b.why).map(([k, v]) => `${k} ${(100 * v / totalWhy).toFixed(1)}%`).join(", "));
}
