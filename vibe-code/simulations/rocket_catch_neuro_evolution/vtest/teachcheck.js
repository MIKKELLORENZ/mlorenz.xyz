/* teachcheck.js — what does the DAgger teacher actually do, flown end to end? */
"use strict";
const TEACH = require("../distill/teacher.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");

const N = Number(process.argv[2] || 60);
const STAGES = (process.argv[3] || "0,1").split(",").map(Number);
for (const stage of STAGES) {
    let c = 0; const t = {}, k = {};
    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(stage, 810000 + stage * 100003 + i * 7919);
        sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
        const w = new WM.World(sc);
        const out = new Float64Array(10);
        const r = w.runEpisode((wo, o) => {
            const kind = TEACH.advise(wo, out);
            k[kind] = (k[kind] || 0) + 1;
            o.set(out); return o;
        });
        const nm = WM.OUTCOME_NAME[r.outcome];
        t[nm] = (t[nm] || 0) + 1;
        if (nm === "caught") c++;
    }
    const tot = Object.values(k).reduce((a, b) => a + b, 0) || 1;
    const p = c / N, se = Math.sqrt(p * (1 - p) / N);
    console.log(`stage ${stage}  caught ${c}/${N} (${(100 * p).toFixed(1)}% +/- ${(100 * se).toFixed(1)})  ` +
        Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a, b]) => `${a} ${b}`).join(", "));
    console.log(`          labels ` + Object.entries(k).map(([a, b]) => `${a} ${(100 * b / tot).toFixed(0)}%`).join("  "));
}
