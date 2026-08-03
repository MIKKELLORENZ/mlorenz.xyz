/* probe_limits.js — make the joint hard stop a FORCE instead of a position edit.
 *
 *   node probe_limits.js
 *
 * Measured in probe_integrator: the backstop in integrate() fires on 34% of all
 * physics ticks, and 97% of sudden spin-ups land on a tick where it fired.
 *
 *     if (a < lo) { a = lo; if (qd < 0) qd = 0; }
 *
 * That teleports a joint back inside its limit and zeroes its velocity. In a
 * multibody tree, arresting one body takes an impulse that has to propagate to
 * every other body; editing one coordinate on its own conserves neither momentum
 * nor energy. It is also completely dt-independent, which is exactly why 8x
 * smaller timesteps did not help.
 *
 * The physical statement is that a hard stop is a stiff contact between two
 * pieces of the mechanism. Written as a torque it goes into tau, through the
 * same articulated-body solve as every other force, and the reaction reaches the
 * rest of the body the way it must. It also must NOT be limited by tauMax: an
 * actuator has a torque ceiling, a lump of metal does not.
 *
 * The position clamp stays as a last-resort net against numerical escape, but
 * moved out to 0.15 rad so it becomes the rare exception it was meant to be
 * rather than a routine part of the dynamics.
 *
 * Reported: how often the net still fires, the spin and speed extremes, and —
 * the column that decides it — waypoints and fitness on ordinary crouch starts.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = {};
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    SRC[f] = fs.readFileSync(path.join(__dirname, f), "utf8");
}
const BACKSTOP = `            const lo = this.qmin[i] - 0.02, hi = this.qmax[i] + 0.02;`;
const SERVO_END = `            this.tau[j + 1] = t;
            this.energy += Math.abs(t * mb.qd[6 + j]) * dt;`;
for (const [n, s, f] of [["backstop", BACKSTOP, "physics.js"], ["servo tail", SERVO_END, "walker.js"]]) {
    if (!SRC[f].includes(s)) { console.error(`${n} has moved — update this probe`); process.exit(1); }
}

/* The hard stop as a torque. Applied after the actuator's tauMax clamp, because
 * it is structure rather than actuation, and damped only while the joint is
 * still travelling further into the stop so it cannot pull the joint back. */
function limitTorque(k, c) {
    return SERVO_END.replace("            this.tau[j + 1] = t;", `            {
                const q = mb.q[j + 1], v = mb.qd[6 + j], b = M.bodies[j + 1];
                let over = 0;
                if (q > b.qmax) over = q - b.qmax; else if (q < b.qmin) over = q - b.qmin;
                if (over !== 0) {
                    let ts = -${k} * over;
                    if (over * v > 0) ts -= ${c} * v;     // damp only while driving deeper in
                    t += ts;
                }
            }
            this.tau[j + 1] = t;`);
}

function run(label, physics, walker, pool) {
    const ctx = vm.createContext({ console, Math, Float64Array, Float32Array, Object, Array, JSON, Number, isNaN });
    vm.runInContext("globalThis.__nStop = 0;", ctx);
    for (const f of Object.keys(SRC)) {
        vm.runInContext(f === "physics.js" ? physics : f === "walker.js" ? walker : SRC[f], ctx, { filename: f });
    }
    const R = vm.runInContext(`(${function (episodes, pool) {
        const M = HUMANOID;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        let maxSpin = 0, maxSpd = 0, diverged = 0, wp = 0, fit = 0, ticks = 0, stopTicks = 0, stood = 0;
        for (let ep = 0; ep < episodes; ep++) {
            const terrainId = ["stairs", "varied", "mixed", "rolling"][ep % 4];
            const o = { stage: 5, terrainDifficulty: 1, terrainId,
                        missionSeed: 4000 + ep * 17, noiseSeed: 900 + ep * 7, noise: true };
            if (pool) { o.groundFrac = 1; o.seatFrac = 0; o.poseFrac = 1; } else { o.groundFrac = 0; }
            const world = new World(M, [net], o);
            const w = world.walkers[0];
            while (!world.isOver()) {
                const s0 = globalThis.__nStop;
                world.step();
                ticks++;
                if (globalThis.__nStop > s0) stopTicks++;
                const spin = Math.hypot(w.mb.qd[0], w.mb.qd[1], w.mb.qd[2]);
                const spd = Math.hypot(w.mb.qd[3], w.mb.qd[4], w.mb.qd[5]);
                if (spin > maxSpin) maxSpin = spin;
                if (spd > maxSpd) maxSpd = spd;
            }
            if (w.diverged) diverged++;
            if (w.stood) stood++;
            wp += w.arrivals; fit += w.fitness();
        }
        return { maxSpin, maxSpd, diverged, wp, fit: fit / episodes, stood,
                 stopPct: 100 * stopTicks / ticks };
    }})(24, ${pool})`, ctx);
    console.log(`  ${label.padEnd(32)} ${R.maxSpin.toFixed(1).padStart(7)} ${R.maxSpd.toFixed(1).padStart(8)}` +
        ` ${String(R.diverged).padStart(5)}/24 ${String(R.stood).padStart(4)}/24 ${R.wp.toFixed(0).padStart(4)} wp` +
        ` ${R.fit.toFixed(0).padStart(8)} ${R.stopPct.toFixed(2).padStart(7)}%`);
    return R;
}

/* count the net firing in every variant, so the numbers are comparable */
const countStop = s => s.replace(
    `            if (a < lo) { a = lo; if (qd[5 + i] < 0) qd[5 + i] = 0; }
            else if (a > hi) { a = hi; if (qd[5 + i] > 0) qd[5 + i] = 0; }`,
    `            if (a < lo) { a = lo; globalThis.__nStop++; if (qd[5 + i] < 0) qd[5 + i] = 0; }
            else if (a > hi) { a = hi; globalThis.__nStop++; if (qd[5 + i] > 0) qd[5 + i] = 0; }`);
const PHYS0 = countStop(SRC["physics.js"]);
const PHYS_WIDE = countStop(SRC["physics.js"].replace(BACKSTOP,
    "            const lo = this.qmin[i] - 0.15, hi = this.qmax[i] + 0.15;"));

console.log("The hard stop as a torque through the solver, instead of a position edit in the integrator.");
console.log("`net%` = ticks still hitting the position clamp. Lower is better; it should become rare.\n");
console.log("  variant                          maxSpin  maxSpd  diverged stood    wp  fitness     net%");
for (const pool of [true, false]) {
    console.log(pool ? "POOL POSES" : "CROUCH STARTS (the curriculum that matters)");
    run("as shipped", PHYS0, SRC["walker.js"], pool);
    run("limit torque k=2000 c=20", PHYS_WIDE, SRC["walker.js"].replace(SERVO_END, limitTorque(2000, 20)), pool);
    run("limit torque k=6000 c=60", PHYS_WIDE, SRC["walker.js"].replace(SERVO_END, limitTorque(6000, 60)), pool);
    run("limit torque k=15000 c=120", PHYS_WIDE, SRC["walker.js"].replace(SERVO_END, limitTorque(15000, 120)), pool);
}
