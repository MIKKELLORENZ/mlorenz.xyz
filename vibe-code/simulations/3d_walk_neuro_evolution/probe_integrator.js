/* probe_integrator.js — the fault is dt-independent, so look at the two places
 * the integrator stops being physics.
 *
 *   node probe_integrator.js
 *
 * A linear spring-damper instability MUST vanish as dt -> 0. This one does not:
 * 8x smaller steps took the top speed from 37.2 to 25.8 m/s and stopped there.
 * Whatever drives it therefore is not the contact ODE. Two candidates, both of
 * which fire identically at any timestep:
 *
 *   THE JOINT BACKSTOP (integrate)
 *     if (a < lo) { a = lo; if (qd < 0) qd = 0; }
 *   A joint is teleported back inside its limit and its velocity is zeroed. In a
 *   multibody tree, arresting one body requires an impulse propagated through
 *   the whole chain; zeroing one coordinate in isolation conserves nothing. Every
 *   time it fires it silently edits the system's momentum.
 *
 *   THE qdd CLAMP (_aba / dynamics)
 *     if (a > 4000) a = 4000
 *   The solver returns a consistent acceleration vector; this truncates some of
 *   its components and keeps the rest, so what gets integrated is the solution to
 *   no dynamics problem at all.
 *
 * Neither is measured anywhere, so the first job is simply to count them and see
 * whether they coincide with the blowups. Angular momentum is the cleanest
 * witness: with gravity vertical and contact forces the only external torques,
 * a big jump in the body's angular momentum over one tick has to come from
 * somewhere, and these two are the only places it can be invented.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = {};
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    SRC[f] = fs.readFileSync(path.join(__dirname, f), "utf8");
}

/* Count the two events without changing what they do. */
const CLAMP = "            else if (a > 4000) a = 4000; else if (a < -4000) a = -4000;";
const BACKSTOP = `            if (a < lo) { a = lo; if (qd[5 + i] < 0) qd[5 + i] = 0; }
            else if (a > hi) { a = hi; if (qd[5 + i] > 0) qd[5 + i] = 0; }`;
for (const [n, s] of [["qdd clamp", CLAMP], ["backstop", BACKSTOP]]) {
    if (!SRC["physics.js"].includes(s)) { console.error(`${n} has moved — update this probe`); process.exit(1); }
}
let phys = SRC["physics.js"]
    .replace(new RegExp(CLAMP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        "            else if (a > 4000) { a = 4000; globalThis.__nClamp++; } else if (a < -4000) { a = -4000; globalThis.__nClamp++; }")
    .replace(BACKSTOP,
        `            if (a < lo) { a = lo; if (qd[5 + i] < 0) { qd[5 + i] = 0; globalThis.__nStop++; } }
            else if (a > hi) { a = hi; if (qd[5 + i] > 0) { qd[5 + i] = 0; globalThis.__nStop++; } }`);

function run(label, physics, opts) {
    const g = { console, Math, Float64Array, Float32Array, Object, Array, JSON, Number, isNaN };
    const ctx = vm.createContext(g);
    vm.runInContext("globalThis.__nClamp = 0; globalThis.__nStop = 0;", ctx);
    for (const f of Object.keys(SRC)) vm.runInContext(f === "physics.js" ? physics : SRC[f], ctx, { filename: f });
    const R = vm.runInContext(`(${function (episodes, pool) {
        const M = HUMANOID;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        let maxSpin = 0, maxSpd = 0, diverged = 0, wp = 0, fit = 0;
        let clampTicks = 0, stopTicks = 0, ticks = 0, coincide = 0, spinEvents = 0;
        for (let ep = 0; ep < episodes; ep++) {
            const terrainId = ["stairs", "varied", "mixed", "rolling"][ep % 4];
            const o = { stage: 5, terrainDifficulty: 1, terrainId,
                        missionSeed: 4000 + ep * 17, noiseSeed: 900 + ep * 7, noise: true };
            if (pool) { o.groundFrac = 1; o.seatFrac = 0; o.poseFrac = 1; } else { o.groundFrac = 0; }
            const world = new World(M, [net], o);
            const w = world.walkers[0];
            let prevSpin = 0;
            while (!world.isOver()) {
                const c0 = globalThis.__nClamp, s0 = globalThis.__nStop;
                world.step();
                ticks++;
                const dc = globalThis.__nClamp - c0, ds = globalThis.__nStop - s0;
                if (dc) clampTicks++;
                if (ds) stopTicks++;
                const spin = Math.hypot(w.mb.qd[0], w.mb.qd[1], w.mb.qd[2]);
                const spd = Math.hypot(w.mb.qd[3], w.mb.qd[4], w.mb.qd[5]);
                if (spin > maxSpin) maxSpin = spin;
                if (spd > maxSpd) maxSpd = spd;
                // a spin event: angular speed jumping hard in a single tick
                if (spin - prevSpin > 1.0) { spinEvents++; if (ds) coincide++; }
                prevSpin = spin;
            }
            if (w.diverged) diverged++;
            wp += w.arrivals; fit += w.fitness();
        }
        return { maxSpin, maxSpd, diverged, wp, fit: fit / episodes, ticks,
                 clampTicks, stopTicks, spinEvents, coincide,
                 nClamp: globalThis.__nClamp, nStop: globalThis.__nStop };
    }})(24, ${opts.pool})`, ctx);
    console.log(`  ${label.padEnd(30)} ${R.maxSpin.toFixed(1).padStart(7)} ${R.maxSpd.toFixed(1).padStart(8)}` +
        ` ${String(R.diverged).padStart(5)}/24 ${R.wp.toFixed(0).padStart(4)} ${R.fit.toFixed(0).padStart(8)}` +
        ` ${(100 * R.stopTicks / R.ticks).toFixed(1).padStart(7)}% ${(100 * R.clampTicks / R.ticks).toFixed(2).padStart(7)}%` +
        ` ${R.spinEvents ? (100 * R.coincide / R.spinEvents).toFixed(0) : "-"}%`);
    return R;
}

console.log("How often does the integrator stop being physics, and does it coincide with the spins?");
console.log("`stop%` = ticks where a joint backstop zeroed a velocity. `clamp%` = ticks where qdd was truncated.");
console.log("`with` = share of sudden spin-ups (>1 rad/s in one tick) that happened on a backstop tick.\n");
console.log("  variant                          maxSpin  maxSpd    diverged   wp  fitness    stop%   clamp%   with");
for (const pool of [true, false]) {
    console.log(pool ? "POOL POSES" : "CROUCH STARTS");
    run("as shipped (instrumented)", phys, { pool });
}
