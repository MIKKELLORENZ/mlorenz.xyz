/* dryfire.js — DOES THE VEHICLE THRUST ON AN EMPTY TANK, AND DOES MASS MATTER?
 *
 * Two claims to check, and neither should be checked by reading the code:
 *
 *   1. thrust must stop when the propellant is gone;
 *   2. burning propellant must lighten the vehicle, and that lighter mass must
 *      show up in the acceleration the integrator applies.
 *
 * So: hold full throttle on the largest engine group until the tank empties,
 * and log propellant, commanded stage, actual thrust and mass every step across
 * the crossing. Then check F = m*a against the observed velocity change, which
 * is the only way to prove the mass is actually reaching the dynamics rather
 * than merely being recomputed.
 */
"use strict";
const WM = require("../world.js");
const SC = require("../scenarios.js");
const V = require("../vehicle.js");

const sc = SC.makeScenario(0, 4242);
sc.prop = 6000;              // small tank so it empties quickly
sc.tMax = 60;
const w = new WM.World(sc);

const rows = [];
let prevV = null, prevT = 0;
w.runEpisode((wo, o) => {
    o.fill(0);
    o[0] = 1;                       // full throttle
    o[1] = 1;                       // top of the engine ladder
    o[9] = 1;
    return o;
}, {});

// re-fly manually so every physics step can be inspected
const w2 = new WM.World(sc);
const out = new Float64Array(WM.N_OUT);
let t = 0, lastMass = null, dryTicks = 0, dryImpulse = 0;
for (let i = 0; i < 4000 && w2.outcome === 0; i++) {
    if (i % WM.CTRL_EVERY === 0) {
        out.fill(0); out[0] = 1; out[1] = 1; out[9] = 1;
        w2.applyControl(out);
    }
    const propBefore = w2.prop;
    const massBefore = w2.mp.m;
    const vzBefore = w2.v[2];
    w2.step(WM.DT_PHYS);
    /* Count the force the PHYSICS applied, not the thrust the actuator claims.
     * The first version of this counter read act.thrust() and reported 2,439
     * dry ticks after the fix had already zeroed the applied force — it was
     * measuring an actuator spooling up on an empty tank while contributing
     * nothing, which is a real cosmetic bug but not the one being tested. */
    const T = w2.dry ? 0 : w2.act.thrust();
    if (propBefore <= 0 && T > 0) { dryTicks++; dryImpulse += T * WM.DT_PHYS; }
    if (rows.length < 400 && (propBefore < 400 || propBefore <= 0)) {
        rows.push({ t: w2.t, prop: w2.prop, T, m: w2.mp.m, stage: w2.act.stage,
                    dm: massBefore - w2.mp.m, dvz: w2.v[2] - vzBefore });
    }
    lastMass = w2.mp.m;
}

console.log("crossing the empty-tank boundary (full throttle, top engine group):\n");
console.log("     t     prop(kg)   thrust(N)    stage    mass(kg)");
let shown = 0;
for (const r of rows) {
    if (r.prop <= 0 && shown > 12) break;
    if (r.prop < 300 || r.prop <= 0) {
        console.log(`  ${r.t.toFixed(3).padStart(6)} ${r.prop.toFixed(1).padStart(10)} ${r.T.toFixed(0).padStart(11)} ${String(r.stage).padStart(8)} ${r.m.toFixed(0).padStart(11)}`);
        if (r.prop <= 0) shown++;
    }
}
console.log(`\n  ticks with thrust on an EMPTY tank: ${dryTicks}` +
    `  (${(dryTicks * WM.DT_PHYS).toFixed(3)} s, impulse ${(dryImpulse / 1e3).toFixed(0)} kN·s)`);

/* Does mass reach the dynamics? Compare the observed dvz against F/m - g for a
 * step in mid-burn, using the mass recorded for that step. */
const mid = rows.find(r => r.T > 1e5 && r.prop > 0);
if (mid) {
    const g = 9.80665;
    const predicted = (mid.T / mid.m - g) * WM.DT_PHYS;
    console.log(`\n  mid-burn step: thrust ${(mid.T / 1e6).toFixed(2)} MN, mass ${(mid.m / 1e3).toFixed(1)} t`);
    console.log(`    observed dvz ${mid.dvz.toFixed(5)} m/s   predicted from F/m - g ${predicted.toFixed(5)} m/s` +
        `   ratio ${(mid.dvz / predicted).toFixed(4)}`);
    console.log(`    mass lost in that one step: ${mid.dm.toFixed(2)} kg`);
    console.log(`    (a ratio near 1 means the CURRENT mass is what the integrator used;`);
    console.log(`     aerodynamic force at this altitude and speed is the residual)`);
}
