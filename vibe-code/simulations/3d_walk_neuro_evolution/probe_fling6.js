/* probe_fling6.js — settle on a guard, and prove it does not cost normal walking.
 *
 *   node probe_fling6.js
 *
 * The mechanism, from the replay of a real captured incident: a contact point
 * lands hard, the Hunt-Crossley velocity term multiplies the force by 7-12x, the
 * resulting force acts at a long lever arm from the COM, the body spins about
 * that point (3.9 -> 33 rad/s), and the rotation drives the SAME point deeper.
 * Deeper means more force, which means more spin. It leaves at 7-37 m/s.
 *
 * The candidate guards, and why each is defensible on its own terms rather than
 * as a fudge:
 *
 *   HC cap    fn = KN*d*(1 - HC*vn) has no upper bound on the second factor. A
 *             real contact cannot deliver unbounded force merely because it was
 *             approached quickly; the material yields. Capping the multiplier
 *             says the damping saturates.
 *   force cap no single point of a 65 kg body can deliver hundreds of kN. This
 *             is the direct statement of what must not happen, and unlike a
 *             DEPTH cap it leaves the restoring spring growing with penetration,
 *             so a limb still cannot sink through the floor.
 *
 * The earlier depth cap is included to show why it is the wrong knob: it stops
 * the explosion by removing the restoring force at depth, so limbs sink further
 * (507 mm) than with no guard at all.
 *
 * The last two columns are the point of the whole exercise: a guard that also
 * flattens ordinary walking is not a fix. Waypoints and fitness are measured on
 * the SAME seeds, so they are directly comparable across rows.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = {};
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    SRC[f] = fs.readFileSync(path.join(__dirname, f), "utf8");
}
const LINE = "let fn = CONTACT.KN * depth * (1 - CONTACT.HC * vn);";
if (!SRC["walker.js"].includes(LINE)) { console.error("contact force line has moved"); process.exit(1); }

function run(label, repl, poolPoses) {
    const patched = repl ? SRC["walker.js"].replace(LINE, repl) : SRC["walker.js"];
    const ctx = vm.createContext({ console, Math, Float64Array, Float32Array, Object, Array, JSON, Number, isNaN });
    for (const f of Object.keys(SRC)) vm.runInContext(f === "walker.js" ? patched : SRC[f], ctx, { filename: f });
    const R = vm.runInContext(`(${function (episodes, pool) {
        const M = HUMANOID;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        const scratch = new Float64Array(3), s4 = new Float64Array(4);
        let maxDepth = 0, maxSpd = 0, maxF = 0, diverged = 0, wp = 0, fit = 0, walked = 0;
        for (let ep = 0; ep < episodes; ep++) {
            const terrainId = ["stairs", "varied", "mixed", "rolling"][ep % 4];
            const o = { stage: 5, terrainDifficulty: 1, terrainId,
                        missionSeed: 4000 + ep * 17, noiseSeed: 900 + ep * 7, noise: true };
            if (pool) { o.groundFrac = 1; o.seatFrac = 0; o.poseFrac = 1; } else { o.groundFrac = 0; }
            const world = new World(M, [net], o);
            const w = world.walkers[0];
            while (!world.isOver()) {
                world.step();
                const spd = Math.hypot(w.mb.qd[3], w.mb.qd[4], w.mb.qd[5]);
                if (spd > maxSpd) maxSpd = spd;
                for (let i = 0; i < M.contacts.length; i++) {
                    if (w.ptForce[i] > maxF) maxF = w.ptForce[i];
                    const c = M.contacts[i];
                    w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], scratch, 0);
                    world.terrain.sample(scratch[0], scratch[2], s4);
                    const d = (s4[0] - scratch[1]) * s4[2];
                    if (d > maxDepth) maxDepth = d;
                }
            }
            if (w.diverged) diverged++;
            wp += w.arrivals; fit += w.fitness(); walked += w.walked || 0;
        }
        return { maxDepth, maxSpd, maxF, diverged, wp, fit: fit / episodes, walked: walked / episodes };
    }})(24, ${poolPoses})`, ctx);
    console.log(`  ${label.padEnd(34)} ${(R.maxDepth * 1000).toFixed(0).padStart(7)} mm` +
        ` ${R.maxSpd.toFixed(1).padStart(7)} m/s ${(R.maxF / 638).toFixed(0).padStart(7)}x bw` +
        ` ${String(R.diverged).padStart(4)}/24 ${R.wp.toFixed(0).padStart(5)} wp ${R.fit.toFixed(0).padStart(8)}`);
    return R;
}

const CAPPED = "let fn = CONTACT.KN * depth * Math.min(CONTACT.HC_MAX, 1 - CONTACT.HC * vn);\n" +
               "            if (fn > CONTACT.F_MAX) fn = CONTACT.F_MAX;";
function withConst(hcmax, fmax) {
    return CAPPED.replace("CONTACT.HC_MAX", hcmax).replace("CONTACT.F_MAX", fmax).replace("CONTACT.F_MAX", fmax);
}

console.log("POOL POSES — 24 episodes, identical seeds.\n");
console.log("  variant                          deepest pen.  top speed   peak force  diverged     wp   fitness");
run("as shipped", null, true);
run("depth cap 30 mm (the wrong knob)", "let fn = CONTACT.KN * Math.min(0.030, depth) * (1 - CONTACT.HC * vn);", true);
run("HC<=4, force<=100x bw", withConst(4, 63800), true);
run("HC<=4, force<=50x bw", withConst(4, 31900), true);
run("HC<=3, force<=30x bw", withConst(3, 19140), true);
run("HC<=2, force<=20x bw", withConst(2, 12760), true);

console.log("\nCROUCH STARTS — the ordinary curriculum, to check the guard costs nothing.\n");
console.log("  variant                          deepest pen.  top speed   peak force  diverged     wp   fitness");
run("as shipped", null, false);
run("HC<=4, force<=50x bw", withConst(4, 31900), false);
run("HC<=3, force<=30x bw", withConst(3, 19140), false);
