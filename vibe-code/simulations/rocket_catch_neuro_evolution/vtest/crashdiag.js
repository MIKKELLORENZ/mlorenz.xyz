/* crashdiag.js — the misses that never reach the gate.
 *
 * missdiag.js grades arrivals: which term of the capture box failed. That is the
 * right question for stages 0 and 1, where most episodes get to the rails. It is
 * the WRONG question for 2 and 3, where the teacher crashes 35% and 53% of the
 * time and tower-strikes another quarter — those episodes never arrive, so the
 * capture box has nothing to say about them and the whole failure is invisible
 * to the tool that was being used to look at it.
 *
 * So: for every episode that does not end in a catch, what state was the vehicle
 * in when it ended, and what did the flight look like getting there? The point is
 * to separate causes that have completely different fixes and all read "crash":
 *
 *   - never lit             the ignition rule never fired
 *   - lit too late          it fired, but below the height needed to stop
 *   - ran dry               propellant exhausted with speed left
 *   - structural            broke up on q or q-alpha before it could fly
 *   - flew into the tower   arrived, but through the structure
 *
 *   node vtest/crashdiag.js [n] [stages]
 */
"use strict";
const V = require("../vehicle.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");
const TEACH = require("../distill/teacher.js");
const DEG = Math.PI / 180;

const N = Number(process.argv[2] || 200);
const STAGES = (process.argv[3] || "2,3").split(",").map(Number);
const BASE = Number(process.env.BASE || 960000);

const out = new Float64Array(WM.N_OUT);
const med = (a) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const pct = (k, n) => `${(100 * k / n).toFixed(0)}%`;

for (const stage of STAGES) {
    const tally = {}, rows = [];
    let caught = 0;
    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(stage, BASE + stage * 100003 + i * 7919);
        sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
        const w = new WM.World(sc);

        let litAt = null, litV = null, maxQ = 0, maxQA = 0, minProp = 1e9;
        const r = w.runEpisode((w2, o) => {
            if (litAt === null && w2.act.everLit) { litAt = w2.p[2]; litV = -w2.v[2]; }
            if (w2.tel.q > maxQ) maxQ = w2.tel.q;
            if (w2.acc.maxQAlpha > maxQA) maxQA = w2.acc.maxQAlpha;
            if (w2.prop < minProp) minProp = w2.prop;
            TEACH.advise(w2, out); o.set(out); return o;
        });
        const nm = WM.OUTCOME_NAME[r.outcome];
        tally[nm] = (tally[nm] || 0) + 1;
        if (nm === "caught") { caught++; continue; }
        rows.push({ nm, litAt, litV, maxQ, maxQA, prop: r.terminal.prop,
                    vz: r.terminal.vzBase, alt: r.terminal.alt,
                    gateDist: r.terminal.gateDist, t: r.terminal.t, tMax: sc.tMax });
    }

    const ty = SC.STAGES[stage].vehicle === "ship" ? V.SHIP : V.BOOSTER;
    console.log(`\n=== stage ${stage} · ${SC.STAGES[stage].label} · ${N} episodes ===`);
    console.log(`  caught ${caught}/${N} (${pct(caught, N)})   ` +
        Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));

    const never = rows.filter(r => r.litAt === null);
    const dry = rows.filter(r => r.litAt !== null && r.prop < 500);
    const struct = rows.filter(r => r.nm === "breakup" || r.maxQA > ty.qAlphaMax * 0.98 || r.maxQ > ty.qMax * 0.98);
    const strike = rows.filter(r => r.nm === "tower strike");
    const timeout = rows.filter(r => r.t >= r.tMax - 0.2);

    console.log(`\n  cause                          count   share of failures`);
    const line = (name, arr) => console.log(`  ${name.padEnd(28)} ${String(arr.length).padStart(5)}   ${pct(arr.length, rows.length).padStart(4)}`);
    line("never lit an engine", never);
    line("ran the tank dry", dry);
    line("hit a structural limit", struct);
    line("flew into the tower", strike);
    line("ran out of clock", timeout);

    if (never.length) {
        console.log(`\n  NEVER LIT: median impact speed ${med(never.map(r => r.vz)).toFixed(0)} m/s, ` +
            `median max q ${(med(never.map(r => r.maxQ)) / 1000).toFixed(1)} kPa ` +
            `(limit ${(ty.qMax / 1000).toFixed(0)})`);
    }
    const litRows = rows.filter(r => r.litAt !== null);
    if (litRows.length) {
        console.log(`  LIT: median ignition height ${med(litRows.map(r => r.litAt)).toFixed(0)} m ` +
            `at ${med(litRows.map(r => r.litV)).toFixed(0)} m/s, ` +
            `median propellant left ${(med(litRows.map(r => r.prop)) / 1000).toFixed(1)} t ` +
            `of ${(ty.propMax / 1000).toFixed(0)} t`);
        console.log(`  LIT: median impact speed ${med(litRows.map(r => r.vz)).toFixed(1)} m/s`);
    }
    console.log(`  peak loads over all failures: q ${(med(rows.map(r => r.maxQ)) / 1000).toFixed(1)} kPa ` +
        `(limit ${(ty.qMax / 1000).toFixed(0)}), ` +
        `q-alpha ${(med(rows.map(r => r.maxQA)) / 1000).toFixed(1)} kPa-rad ` +
        `(limit ${(ty.qAlphaMax / 1000).toFixed(1)})`);
}
