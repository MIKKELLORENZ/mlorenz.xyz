/* probe_fling5.js — is the fling an integration failure or a modelling error?
 *
 *   node probe_fling5.js
 *
 * Four candidates are now dead: it is not the terrain (flat ground), not contact
 * stiffness (lowering KN makes it worse), not the new start poses (plain crouch
 * starts fling too), not self-collision, and not the tangential/Coulomb loop.
 *
 * That leaves the one test that actually separates the two families of cause.
 * If this is explicit integration going unstable against a stiff contact-plus-
 * servo loop, then SHRINKING THE TIMESTEP must fix it, and nothing else needs to
 * change. If the flings survive a 4x smaller step, no clamp or gain change is a
 * fix and something is wrong in the model itself.
 *
 * The control rate is held at 50 Hz throughout (CONTROL_EVERY is scaled with DT)
 * so the brain sees exactly the same problem and only the physics substepping
 * changes. Servo stiffness is swept separately, because the loop through a
 * propped arm is stiffened by the PD gains, not only by KN.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = {};
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    SRC[f] = fs.readFileSync(path.join(__dirname, f), "utf8");
}
const DT_LINE = "const DT = 1 / 500;";
const CE_LINE = "const CONTROL_EVERY = 10;";
for (const s of [DT_LINE, CE_LINE]) {
    if (!SRC["walker.js"].includes(s)) { console.error(`"${s}" has moved — update this probe`); process.exit(1); }
}

function run(label, patched, servoScale) {
    const ctx = vm.createContext({ console, Math, Float64Array, Float32Array, Object, Array, JSON, Number, isNaN });
    for (const f of Object.keys(SRC)) vm.runInContext(f === "walker.js" ? patched : SRC[f], ctx, { filename: f });
    const t0 = Date.now();
    const R = vm.runInContext(`(${function (episodes, servo) {
        if (servo !== 1) setTune({ servoScale: servo });
        const M = HUMANOID;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        const scratch = new Float64Array(3), s4 = new Float64Array(4);
        let big = 0, maxDepth = 0, maxSpd = 0, diverged = 0, arrivals = 0, fit = 0;
        for (let ep = 0; ep < episodes; ep++) {
            const terrainId = ["stairs", "varied", "mixed", "rolling"][ep % 4];
            const world = new World(M, [net], {
                stage: 5, terrainDifficulty: 1, terrainId,
                missionSeed: 4000 + ep * 17, noiseSeed: 900 + ep * 7, noise: true,
                groundFrac: 1, seatFrac: 0, poseFrac: 1
            });
            const w = world.walkers[0];
            let prev = 0;
            while (!world.isOver()) {
                world.step();
                const spd = Math.hypot(w.mb.qd[3], w.mb.qd[4], w.mb.qd[5]);
                if (spd - prev > 1.0) big++;
                prev = spd;
                if (spd > maxSpd) maxSpd = spd;
                for (let i = 0; i < M.contacts.length; i++) {
                    const c = M.contacts[i];
                    w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], scratch, 0);
                    world.terrain.sample(scratch[0], scratch[2], s4);
                    const d = (s4[0] - scratch[1]) * s4[2];
                    if (d > maxDepth) maxDepth = d;
                }
            }
            if (w.diverged) diverged++;
            arrivals += w.arrivals; fit += w.fitness();
        }
        return { big, maxDepth, maxSpd, diverged, arrivals, fit: fit / episodes };
    }})(24, ${servoScale})`, ctx);
    console.log(`  ${label.padEnd(36)} ${String(R.big).padStart(6)}` +
        `  ${(R.maxDepth * 1000).toFixed(0).padStart(7)} mm  ${R.maxSpd.toFixed(1).padStart(7)} m/s` +
        `  ${String(R.diverged).padStart(4)}/24  ${R.arrivals.toFixed(0).padStart(4)} wp` +
        `  ${R.fit.toFixed(0).padStart(7)}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

console.log("24 episodes, identical seeds. Control stays at 50 Hz in every row.\n");
console.log("  variant                              flings  deepest pen.   top speed   diverged    wp   fitness  wall");

run("as shipped (dt 2.00 ms)", SRC["walker.js"], 1);
run("dt 1.00 ms (2x substeps)",
    SRC["walker.js"].replace(DT_LINE, "const DT = 1 / 1000;").replace(CE_LINE, "const CONTROL_EVERY = 20;"), 1);
run("dt 0.50 ms (4x substeps)",
    SRC["walker.js"].replace(DT_LINE, "const DT = 1 / 2000;").replace(CE_LINE, "const CONTROL_EVERY = 40;"), 1);
run("dt 0.25 ms (8x substeps)",
    SRC["walker.js"].replace(DT_LINE, "const DT = 1 / 4000;").replace(CE_LINE, "const CONTROL_EVERY = 80;"), 1);
run("as shipped, servo gains at 0.5", SRC["walker.js"], 0.5);
run("as shipped, servo gains at 0.25", SRC["walker.js"], 0.25);
