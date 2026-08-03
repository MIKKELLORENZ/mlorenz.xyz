/* probe_guard.js — does the tightened divergence guard cost a legitimate walker
 * anything, and how much compute does it save?
 *
 *   node probe_guard.js
 *
 * This measures the guard rail ALONE. The contact law is untouched: every cap I
 * tried either left flings or made limbs sink, so the force law needs a real
 * fix (a velocity-level constraint solve) rather than another clamp. Until that
 * lands, the guard has to do two jobs and be honest about both:
 *
 *   1. never fire on a walker that is merely falling over. A fall off a 0.9 m
 *      stand honestly reaches 4.2 m/s DOWNWARD, which is why the new speed test
 *      is horizontal-only. If waypoints or fitness move on crouch starts, the
 *      guard is eating real walkers and is wrong.
 *   2. retire a broken episode at the moment it breaks. The saving is reported
 *      as simulated seconds not spent, because that is the compute.
 *
 * Baseline numbers come from re-running the SAME seeds against a pristine copy
 * of walker.js, so the comparison is like for like rather than against a number
 * quoted from an earlier session.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

const SRC = {};
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    SRC[f] = fs.readFileSync(path.join(__dirname, f), "utf8");
}
/* The pre-change walker, recovered from git so the baseline is the real thing
 * and not my recollection of it. */
let OLD = null;
try { OLD = execSync("git show HEAD:vibe-code/simulations/3d_walk_neuro_evolution/walker.js",
                     { cwd: path.join(__dirname, "..", "..", ".."), encoding: "utf8", maxBuffer: 1 << 24 }); }
catch (e) { console.log("(could not read the pre-change walker.js from git — baseline row skipped)\n"); }

function run(label, src, pool) {
    const ctx = vm.createContext({ console, Math, Float64Array, Float32Array, Object, Array, JSON, Number, isNaN });
    for (const f of Object.keys(SRC)) vm.runInContext(f === "walker.js" ? src : SRC[f], ctx, { filename: f });
    const R = vm.runInContext(`(${function (episodes, pool) {
        const M = HUMANOID;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        let wp = 0, fit = 0, diverged = 0, simSec = 0, maxSpd = 0, stood = 0, walked = 0;
        for (let ep = 0; ep < episodes; ep++) {
            const terrainId = ["stairs", "varied", "mixed", "rolling"][ep % 4];
            const o = { stage: 5, terrainDifficulty: 1, terrainId,
                        missionSeed: 4000 + ep * 17, noiseSeed: 900 + ep * 7, noise: true };
            if (pool) { o.groundFrac = 1; o.seatFrac = 0; o.poseFrac = 1; } else { o.groundFrac = 0; }
            const world = new World(M, [net], o);
            const w = world.walkers[0];
            while (!world.isOver()) {
                world.step();
                const s = Math.hypot(w.mb.qd[3], w.mb.qd[4], w.mb.qd[5]);
                if (s > maxSpd) maxSpd = s;
            }
            simSec += world.time;
            if (w.diverged) diverged++;
            if (w.stood) stood++;
            wp += w.arrivals; fit += w.fitness(); walked += w.walked || 0;
        }
        return { wp, fit: fit / episodes, diverged, simSec, maxSpd, stood, walked };
    }})(24, ${pool})`, ctx);
    console.log(`  ${label.padEnd(26)} ${R.wp.toFixed(0).padStart(5)} wp ${R.fit.toFixed(0).padStart(9)}` +
        ` ${String(R.stood).padStart(5)}/24 ${String(R.diverged).padStart(6)}/24` +
        ` ${R.maxSpd.toFixed(1).padStart(8)} m/s ${R.simSec.toFixed(0).padStart(9)} s`);
    return R;
}

for (const [name, pool] of [["POOL POSES", true], ["CROUCH STARTS (the real curriculum)", false]]) {
    console.log(`\n${name}`);
    console.log("  variant                       wp   fitness   stood  diverged  top speed   sim time");
    const a = OLD ? run("before (from git)", OLD, pool) : null;
    const b = run("with the guard rail", SRC["walker.js"], pool);
    if (a) {
        const dw = b.wp - a.wp, df = b.fit - a.fit;
        console.log(`  -> waypoints ${dw >= 0 ? "+" : ""}${dw}, fitness ${df >= 0 ? "+" : ""}${df.toFixed(0)}` +
            ` (${(100 * df / Math.max(1, Math.abs(a.fit))).toFixed(1)}%), ` +
            `simulated time ${(100 * (a.simSec - b.simSec) / a.simSec).toFixed(1)}% saved`);
    }
}
