/* missdiag.js — WHICH TERM OF THE CAPTURE BOX IS ACTUALLY FAILING?
 *
 * The teacher catches 23% of stage 0 and "misses the catch" on 71%. A miss is
 * five separate conditions ANDed together — across, along, descent rate,
 * horizontal speed, tilt — and "missed catch" says nothing about which one. The
 * fixes are completely different: an across error is the alignment hold, a vz
 * error is the descent schedule, a vh error is the lateral loop overshooting,
 * a tilt error is the attitude loop.
 *
 * The vehicle already records a snapshot at closest approach to the rail plane
 * (`acc.gate`, added when rung 4 was found to be reading ground impact). This
 * reads it for every episode and reports, per term, the fraction of misses that
 * term alone would have failed — and the fraction that fail on that term ONLY,
 * which is what a targeted fix would actually convert.
 *
 *   node vtest/missdiag.js [n] [stages]
 */
"use strict";
const V = require("../vehicle.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");
const TEACH = require("../distill/teacher.js");
const GOLD = require("../golden_test.js");
const DEG = Math.PI / 180;

const N = Number(process.argv[2] || 150);
const STAGES = (process.argv[3] || "0").split(",").map(Number);
const WHO = process.env.WHO || "teacher";

const C = V.TOWER.capture;
const TERMS = [
    ["across", g => Math.abs(g.dx), C.across, "m"],
    ["along", g => Math.abs(g.dy), C.along, "m"],
    ["descent vz", g => g.vz, C.vz, "m/s"],
    ["horizontal vh", g => g.vh, C.vh, "m/s"],
    ["tilt", g => g.tilt / DEG, C.tilt / DEG, "deg"],
    ["body rate", g => g.rate / DEG, C.rate / DEG, "deg/s"],
    ["height dz", g => Math.abs(g.dz), 3.0, "m"]
];

function policyFor() {
    if (WHO === "reference") return GOLD.makeReference();
    const out = new Float64Array(WM.N_OUT);
    return (w, o) => { TEACH.advise(w, out); o.set(out); return o; };
}

for (const stage of STAGES) {
    const rows = [];
    let caught = 0, noGate = 0;
    const tally = {};
    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(stage, 960000 + stage * 100003 + i * 7919);
        sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
        const w = new WM.World(sc);
        const r = w.runEpisode(policyFor());
        const nm = WM.OUTCOME_NAME[r.outcome];
        tally[nm] = (tally[nm] || 0) + 1;
        if (nm === "caught") { caught++; continue; }
        if (nm !== "missed catch") continue;
        if (!w.acc.gate) { noGate++; continue; }
        rows.push(w.acc.gate);
    }
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };

    console.log(`\n${WHO} · stage ${stage} · ${N} episodes · caught ${caught}, misses analysed ${rows.length}` +
        (noGate ? ` (${noGate} with no gate snapshot)` : ""));
    console.log(`  ` + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
    if (!rows.length) continue;

    console.log(`\n  term            limit      median     fails      fails ALONE`);
    const fails = rows.map(g => TERMS.map(([, f, lim]) => f(g) > lim));
    for (let t = 0; t < TERMS.length; t++) {
        const [name, f, lim, unit] = TERMS[t];
        const nFail = fails.filter(fv => fv[t]).length;
        const nOnly = fails.filter(fv => fv[t] && fv.filter(Boolean).length === 1).length;
        console.log(`  ${name.padEnd(14)} ${(lim.toFixed(2) + " " + unit).padStart(9)}  ` +
            `${med(rows.map(f)).toFixed(2).padStart(8)}   ${String(nFail).padStart(3)}/${rows.length} ` +
            `(${(100 * nFail / rows.length).toFixed(0).padStart(3)}%)   ${String(nOnly).padStart(3)} ` +
            `(${(100 * nOnly / rows.length).toFixed(0).padStart(3)}%)`);
    }
    const nClean = fails.filter(fv => !fv.some(Boolean)).length;
    if (nClean) console.log(`  ${nClean} miss(es) violate NO term — the snapshot is not where the catch was judged.`);
    const hist = {};
    for (const fv of fails) { const k = fv.filter(Boolean).length; hist[k] = (hist[k] || 0) + 1; }
    console.log(`  terms violated per miss: ` +
        Object.entries(hist).sort().map(([k, v]) => `${k}: ${v}`).join("   "));
}
