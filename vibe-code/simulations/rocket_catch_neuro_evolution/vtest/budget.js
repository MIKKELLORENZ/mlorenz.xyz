/* budget.js — CAN THE VEHICLE AFFORD THE APPROACH IT IS BEING GIVEN?
 *
 * The golden pilot now crashes 200/200 on stage 0 with the propellant tank
 * empty at impact, and the terminal-guidance reference in runin.js runs dry on
 * 48 of 60. Two very different things produce that: a controller wasting
 * propellant, or a spawn whose propellant load cannot pay for the trajectory
 * under ANY controller. Those need opposite fixes, and no amount of tuning
 * settles it — it is arithmetic.
 *
 * The ideal cost of a landing from a drag-limited fall is
 *
 *     dv  =  v_arrival  +  g * t_brake  +  |v_horizontal|
 *
 * — kill the speed you arrive with, pay gravity for every second the burn
 * lasts, and null the ground track. That is a LOWER BOUND: it assumes a single
 * impulse-efficient burn at the maximum thrust the ladder offers, no attitude
 * transient, no margin, and no hover. Against it stands the rocket equation on
 * the spawn's own propellant load. If the bound exceeds what is in the tank the
 * stage is unflyable and every downstream number measured on it is noise.
 *
 *   node vtest/budget.js [n]   env: STAGES=0,1,2,3
 */
"use strict";

const V = require("../vehicle.js");
const SC = require("../scenarios.js");
const M = require("../mathx.js");

const N = Number(process.argv[2] || 400);
const STAGES = (process.env.STAGES || "0,1,2,3,4,5,6").split(",").map(Number);
const g = 9.80665;

const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

/* Fall speed at the gate for quadratic drag — the same closed form scenarios.js
 * uses for the time, evaluated for the velocity instead. */
function arrivalSpeed(vt, v0, h) {
    const k = g * h / (vt * vt);
    if (Math.abs(v0 - vt) < 1e-3 * vt) return vt;
    if (v0 < vt) {
        const a = Math.atanh(v0 / vt);
        return vt * Math.tanh(Math.acosh(Math.cosh(a) * Math.exp(k)));
    }
    const b = Math.atanh(vt / v0);
    const th = Math.asinh(Math.sinh(b) * Math.exp(k));
    return vt / Math.tanh(th);
}

console.log(` stage  vehicle    fall     v_arr    v_horiz   dv needed   dv in tank   margin   affordable`);
for (const stage of STAGES) {
    const st = SC.STAGES[stage];
    const ty = st.vehicle === "booster" ? V.BOOSTER : V.SHIP;
    const need = [], have = [], varr = [], vhz = [], ok = [];
    for (let i = 0; i < N; i++) {
        const sc = SC.makeScenario(stage, 660000 + i * 7919);
        const alt = sc.p0[2];
        const h = Math.max(30, alt - (V.TOWER.armZ - ty.catchPinZ));
        const sink = -sc.v0[2];
        const vt = st.flop ? sink : SC.equilibriumSink(ty, alt * 0.5, ty.dryMass + sc.prop);
        const vA = arrivalSpeed(vt, sink, h);
        const vH = Math.hypot(sc.v0[0], sc.v0[1]);

        /* Best case: the biggest engine group, full throttle, thrust straight up. */
        const m0 = ty.dryMass + sc.prop;
        const Tmax = ty.engineLadder[ty.engineLadder.length - 1] * V.RAPTOR.thrust;
        const aNet = Math.max(0.5, Tmax / m0 - g);
        const tBrake = vA / aNet;
        const dv = vA + g * tBrake + vH;

        const ve = V.RAPTOR.isp * V.G0;
        const dvHave = ve * Math.log(m0 / ty.dryMass);

        need.push(dv); have.push(dvHave); varr.push(vA); vhz.push(vH);
        ok.push(dv < dvHave ? 1 : 0);
    }
    const frac = ok.reduce((a, b) => a + b, 0) / N;
    const alt0 = st.alt;
    console.log(`   ${stage}    ${st.vehicle.padEnd(8)} ${String(Math.round(alt0[0] / 100) / 10 + "-" + Math.round(alt0[1] / 100) / 10 + "km").padStart(8)}` +
        ` ${med(varr).toFixed(0).padStart(6)}  ${med(vhz).toFixed(0).padStart(7)}` +
        `   ${med(need).toFixed(0).padStart(7)}     ${med(have).toFixed(0).padStart(7)}` +
        `  ${(med(have) - med(need)).toFixed(0).padStart(7)}   ${(100 * frac).toFixed(0).padStart(4)}%`);
    if (frac < 0.98)
        console.log(`          worst decile: needs ${pct(need, 0.9).toFixed(0)} m/s, has ${pct(have, 0.1).toFixed(0)} m/s`);
}
console.log(`\n  "affordable" is a LOWER BOUND passing: an impulse-efficient burn at full`);
console.log(`  ladder thrust with no margin. A real controller wants roughly 1.5x it.`);
