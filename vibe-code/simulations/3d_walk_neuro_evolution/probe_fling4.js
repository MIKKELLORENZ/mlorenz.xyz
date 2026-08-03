/* probe_fling4.js — what is actually driving a limb 0.5 m into the ground?
 *
 *   node probe_fling4.js
 *
 * probe_fling3 ruled out the force law itself. Clamping the Hunt-Crossley
 * multiplier cut peak force from 4193x body weight to 181x and the flings got
 * MORE frequent, and penetration got deeper (344 -> 481 mm). A force that big is
 * therefore downstream of the problem, not the problem.
 *
 * Nothing should be able to push a point 0.5 m through a 120 kN/m spring. So the
 * question is what is pushing, and these are the candidates that can:
 *
 *   the start pose       the pool poses are the only new thing, and they are the
 *                        first thing in this project to load hands and knees
 *   self-collision       KN_SELF 30000 with no depth cap either, and the pool
 *                        poses fold limbs against each other
 *   the tangential loop  mu*fn is the Coulomb limit, so a large normal force
 *                        licenses a large sideways force at a long lever arm
 *
 * Each is switched off in isolation against identical seeds. Whichever one takes
 * the flings to near zero is the cause; if none does, none of these is it.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = {};
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    SRC[f] = fs.readFileSync(path.join(__dirname, f), "utf8");
}
const CUT_SELF = "const mb = this.mb, pairs = this.model.selfPairs;";
const CUT_TANG = "mb.addWorldForce(c.body, p[0], p[1], p[2], ftx + fn * nx, fty + fn * ny, ftz + fn * nz);";
for (const [name, s] of [["self-collision hook", CUT_SELF], ["tangential hook", CUT_TANG]]) {
    if (!SRC["walker.js"].includes(s)) { console.error(`${name} has moved — update this probe`); process.exit(1); }
}

function run(label, patched, poolPoses) {
    const ctx = vm.createContext({ console, Math, Float64Array, Float32Array, Object, Array, JSON, Number, isNaN });
    for (const f of Object.keys(SRC)) vm.runInContext(f === "walker.js" ? patched : SRC[f], ctx, { filename: f });
    const R = vm.runInContext(`(${function (episodes, pool) {
        const M = HUMANOID;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        const scratch = new Float64Array(3), s4 = new Float64Array(4);
        let big = 0, maxDepth = 0, maxSpd = 0, diverged = 0, poses = {};
        for (let ep = 0; ep < episodes; ep++) {
            const terrainId = ["stairs", "varied", "mixed", "rolling"][ep % 4];
            const o = { stage: 5, terrainDifficulty: 1, terrainId,
                        missionSeed: 4000 + ep * 17, noiseSeed: 900 + ep * 7, noise: true };
            if (pool) { o.groundFrac = 1; o.seatFrac = 0; o.poseFrac = 1; }
            else { o.groundFrac = 0; }                 // the old showcase: crouch starts only
            const world = new World(M, [net], o);
            const w = world.walkers[0];
            let prev = 0, worst = 0;
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
                    if (d > worst) worst = d;
                }
            }
            if (w.diverged) { diverged++; poses[w.startPose] = (poses[w.startPose] || 0) + 1; }
        }
        return { big, maxDepth, maxSpd, diverged, poses };
    }})(24, ${poolPoses})`, ctx);
    console.log(`  ${label.padEnd(38)} ${String(R.big).padStart(6)}` +
        `  ${(R.maxDepth * 1000).toFixed(0).padStart(7)} mm  ${R.maxSpd.toFixed(1).padStart(7)} m/s` +
        `  ${String(R.diverged).padStart(4)}/24`);
    if (Object.keys(R.poses).length) console.log(`      diverged from: ${JSON.stringify(R.poses)}`);
    return R;
}

console.log("24 episodes, identical seeds.\n");
console.log("  variant                                flings  deepest pen.   top speed   diverged");
run("pool poses (as shipped)", SRC["walker.js"], true);
run("crouch starts only, no pool poses", SRC["walker.js"], false);
run("pool poses, self-collision OFF",
    SRC["walker.js"].replace(CUT_SELF, "if (1) return; " + CUT_SELF), true);
run("pool poses, tangential friction OFF",
    SRC["walker.js"].replace(CUT_TANG, "mb.addWorldForce(c.body, p[0], p[1], p[2], fn * nx, fn * ny, fn * nz);"), true);
