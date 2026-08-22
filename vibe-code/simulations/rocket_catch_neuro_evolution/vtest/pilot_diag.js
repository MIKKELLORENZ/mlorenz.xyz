/* pilot_diag.js — WHY DOES THE GOLDEN PILOT FAIL, PER STAGE?
 *
 * The pilot is the reference the whole project is measured against: it is the
 * evidence that the environment admits a catch at all, and every "the search is
 * failing, not the target" claim rests on it. So when it breaks up on 73% of
 * stage-2 entries, that number is load-bearing and has to be explained rather
 * than tuned around.
 *
 * The suspicion is stale gains: the structural limits were tightened this
 * session on the strength of a validation report — qAlphaMax 2.6e5 -> 2.25e4,
 * an order of magnitude, and qMax 1.4e5 -> 6.5e4 — and the pilot's gains were
 * grid-searched before that. A controller that was legal under the old limits
 * would tear itself apart under the new ones without a single line of it
 * changing.
 *
 * This does not assume that. It records the state at the moment of failure and
 * says which limit was actually hit, because "breakup" is also what you get
 * from a tumble that happens to be fast, and the fix for those two is opposite.
 */
"use strict";

const M = require("../mathx.js");
const V = require("../vehicle.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");
const GOLD = require("../golden_test.js");
const DEG = Math.PI / 180;

const N = Number(process.argv[2] || 40);
const STAGES = (process.argv[3] || "0,1,2,3").split(",").map(Number);

const pct = (x, n) => `${(100 * x / n).toFixed(0)}%`;
const med = (a) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };

for (const stage of STAGES) {
    if (SC.STAGES[stage].vehicle !== "booster") continue;
    const tally = {}, byOutcome = {};
    let peakQA = [], peakQ = [], peakAoA = [];

    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(stage, 90000 + i * 7919);
        sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
        const w = new WM.World(sc);

        /* Peak loads are sampled from the flight, not read off the terminal
         * state: a vehicle that breaks up is destroyed AT the peak, so the
         * terminal snapshot of a survivor tells you nothing about how close it
         * came. */
        let mQA = 0, mQ = 0, mAoA = 0, alt = 0;
        const pilot = GOLD.makePilot(GOLD.GAINS);
        const r = w.runEpisode((wo, o) => {
            const ae = wo.tel;
            const qa = ae.qAlpha, q = ae.q;
            if (qa > mQA) { mQA = qa; alt = wo.tel.agl; }
            if (q > mQ) mQ = q;
            const aoa = ae.alpha;
            if (aoa > mAoA) mAoA = aoa;
            return pilot(wo, o);
        });
        const nm = WM.OUTCOME_NAME[r.outcome];
        tally[nm] = (tally[nm] || 0) + 1;
        (byOutcome[nm] = byOutcome[nm] || []).push({
            qa: mQA, q: mQ, aoa: mAoA, altAtQA: alt,
            t: r.terminal, ticks: r.ticks
        });
        peakQA.push(mQA); peakQ.push(mQ); peakAoA.push(mAoA);
    }

    console.log(`\nstage ${stage} · ${SC.STAGES[stage].label}   (${N} episodes)`);
    console.log(`   ` + Object.entries(tally).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${pct(v, N)}`).join("  "));
    console.log(`   peak q·alpha  median ${(med(peakQA) / 1e3).toFixed(1)}k   limit ${(V.BOOSTER.qAlphaMax / 1e3).toFixed(1)}k` +
        `   over-limit ${peakQA.filter(x => x > V.BOOSTER.qAlphaMax).length}/${N}`);
    console.log(`   peak q        median ${(med(peakQ) / 1e3).toFixed(1)}k   limit ${(V.BOOSTER.qMax / 1e3).toFixed(1)}k` +
        `   over-limit ${peakQ.filter(x => x > V.BOOSTER.qMax).length}/${N}`);
    console.log(`   peak alpha    median ${(med(peakAoA) / DEG).toFixed(1)}deg`);

    for (const [nm, rows] of Object.entries(byOutcome).sort((a, b) => b[1].length - a[1].length)) {
        if (nm === "caught") continue;
        const d = {
            qa: med(rows.map(r => r.qa)) / 1e3,
            aoa: med(rows.map(r => r.aoa)) / DEG,
            alt: med(rows.map(r => r.t.alt)),
            across: med(rows.map(r => Math.abs(r.t.gateDx))),
            dz: med(rows.map(r => r.t.gateDz)),
            vz: med(rows.map(r => r.t.vzPin)),
            tilt: med(rows.map(r => r.t.tilt)) / DEG,
            prop: med(rows.map(r => r.t.prop)) / 1e3
        };
        console.log(`     ${nm.padEnd(13)} n=${String(rows.length).padStart(2)}  ` +
            `peak q.a ${d.qa.toFixed(0)}k  peak alpha ${d.aoa.toFixed(0)}deg  ` +
            `end: alt ${d.alt.toFixed(0)}m  |across| ${d.across.toFixed(1)}m  ` +
            `dz ${d.dz.toFixed(0)}m  vz ${d.vz.toFixed(1)}  tilt ${d.tilt.toFixed(1)}deg  prop ${d.prop.toFixed(0)}t`);
    }
}
