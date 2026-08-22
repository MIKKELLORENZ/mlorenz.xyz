/* gate.js — WHY IS THE FLEET 20 m OFF ACROSS THE ARMS AT RAIL HEIGHT?
 *
 * The capture rung is gated almost entirely on one quantity: how far across the
 * arms the pins are when they reach the rail plane. The tolerance is 0.9 m and
 * the champions sit around twenty, so nothing downstream can matter until that
 * moves. Three explanations, with different fixes:
 *
 *   NEVER TRIES     the lateral error at the plane is roughly the lateral error
 *                   it started with — the policy is not steering at all.
 *   TRIES, CANNOT   the error is closing but the vehicle runs out of altitude;
 *                   it is authority- or time-limited, not intent-limited.
 *   TRIES, MISSES   the error closes and then reopens — an unstable or
 *                   mistimed lateral loop, or drift after the engines shed.
 *
 * So this reports the across-arm error at three points — spawn, the last moment
 * the vehicle is a hull-length above the rails, and the rail plane itself —
 * together with how much of the initial error was actually removed. The pilot is
 * flown over the identical episodes as the control, because "20 m is a lot" is
 * only meaningful against what a working controller does on the same draw.
 *
 *   node vtest/gate.js vtest/champ/P5.json [stage] [n]
 */
"use strict";

const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const V = require("../vehicle.js");
const M = require("../mathx.js");
const GOLD = require("../golden_test.js");
const fs = require("fs");
const DEG = Math.PI / 180;

const file = process.argv[2] || "vtest/champ/P5.json";
const STAGE = Number(process.argv[3] || 0);
const N = Number(process.argv[4] || 36);

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const brain = NN.Brain.fromJSON(raw.brain || raw);
const lags = raw.lags || (brain.spec.nin === 139 ? [2, 10, 35] : null);
console.log(`${file} · gen ${raw.gen} · ${brain.spec.nin} inputs · lags ${lags ? lags.join(",") : "default"}\n`);

const bank = SC.examBank(N).filter(s => s.stage === STAGE);
const HULL = V.BOOSTER.length;

function fly(makePol, label) {
    const rows = [];
    for (const spec of bank) {
        const sc = SC.makeScenario(spec.stage, spec.seed);
        const w = new WM.World(sc);
        const pol = makePol();
        let atHigh = null;                 // state one hull-length above the rails
        const r = w.runEpisode((wo, o) => {
            const dz = wo.tel.pinZ - V.TOWER.armZ;
            if (atHigh === null && dz < HULL) {
                atHigh = { across: Math.abs(wo.tel.pinX - V.TOWER.gateX), t: wo.t };
            }
            return pol(wo, o);
        });
        const g = w.acc.gate;
        const start = Math.abs(sc.p0[0] - V.TOWER.gateX);
        rows.push({
            start,
            high: atHigh ? atHigh.across : NaN,
            gate: g ? Math.abs(g.dx) : NaN,
            gateDz: g ? g.dz : NaN,
            vh: g ? g.vh : NaN,
            vz: g ? g.vz : NaN,
            tilt: g ? g.tilt / DEG : NaN,
            out: WM.OUTCOME_NAME[r.outcome]
        });
    }
    const ok = rows.filter(r => isFinite(r.gate));
    const med = (f) => { const a = ok.map(f).filter(isFinite).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };
    /* Fraction of the initial across-arm error that was actually removed by the
     * time it mattered. 1.0 is perfect, 0 is "did not steer", negative is
     * "steered the wrong way or drifted further out". */
    const closed = ok.map(r => (r.start - r.gate) / Math.max(1e-6, r.start));
    const medClosed = closed.slice().sort((a, b) => a - b)[closed.length >> 1];
    console.log(`  ${label}`);
    console.log(`    across-arm error   spawn ${med(r => r.start).toFixed(1)} m` +
        `  →  one hull above rails ${med(r => r.high).toFixed(1)} m` +
        `  →  AT THE RAILS ${med(r => r.gate).toFixed(1)} m   (gate is ${V.TOWER.capture.across} m)`);
    console.log(`    error closed       ${(100 * medClosed).toFixed(0)}% of the initial offset` +
        `   ·  worse-than-spawn on ${closed.filter(c => c < 0).length}/${ok.length}`);
    console.log(`    at the rails       vz ${med(r => r.vz).toFixed(1)} m/s  vh ${med(r => r.vh).toFixed(1)} m/s` +
        `  tilt ${med(r => r.tilt).toFixed(1)}°  height error ${med(r => r.gateDz).toFixed(0)} m`);
    const t = {}; for (const r of rows) t[r.out] = (t[r.out] || 0) + 1;
    console.log(`    outcomes           ` + Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
    return { rows, medClosed };
}

const champ = fly(() => { const p = new NN.BrainPolicy(brain, { lags }); p.reset(); return (w, o) => p.act(w, o); },
    `CHAMPION  arm ${raw.arm || file}`);
console.log("");
const pilot = fly(() => GOLD.makePilot(GOLD.GAINS), "GOLDEN PILOT (same episodes)");

console.log(`\n  VERDICT: champion removes ${(100 * champ.medClosed).toFixed(0)}% of its across-arm error, ` +
    `pilot removes ${(100 * pilot.medClosed).toFixed(0)}%.`);
