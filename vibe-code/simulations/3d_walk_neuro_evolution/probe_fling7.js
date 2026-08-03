/* probe_fling7.js — a physical cap, not a big one, plus the guard rail.
 *
 *   node probe_fling7.js
 *
 * The earlier sweep tested per-point caps of 20-100x body weight and none of
 * them worked. That was the wrong range, for a reason worth writing down: the
 * cap is PER CONTACT POINT and this body has ~20 of them, so a per-point ceiling
 * of 5x body weight still permits ~100x in total support. It does not constrain
 * standing, walking or landing at all. It only bites when ONE point is doing
 * something no single point should do.
 *
 * For scale: a running human's peak ground reaction is about 3x body weight
 * spread over a whole foot. A single point of a 65 kg walker delivering 19 kN
 * (the 30x cap that still let it reach 25 m/s) is not physics.
 *
 * The damping clamp is fixed at the value the codebase ALREADY uses for limb
 * against limb — _selfCollide caps the closing speed at 2 m/s — rather than a
 * number invented here. The ground path simply never got the same treatment.
 *
 * The last columns are the ones that decide it: waypoints and fitness on plain
 * crouch starts, on identical seeds. A guard that buys stability by flattening
 * the walk is not a fix, and that is exactly how the previous candidate failed.
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
const BW = 638;   // N, the walker's weight

/* vn is the point's velocity along the surface normal, negative when driving in.
 * Clamping it at -2 m/s is the same statement _selfCollide already makes: the
 * damping model is calibrated for ordinary contact speeds and must not be
 * extrapolated past them. */
function guard(capBW) {
    return "let fn = CONTACT.KN * depth * (1 - CONTACT.HC * Math.max(vn, -2));\n" +
           `            if (fn > ${(capBW * BW).toFixed(0)}) fn = ${(capBW * BW).toFixed(0)};`;
}

function run(label, repl, pool) {
    const patched = repl ? SRC["walker.js"].replace(LINE, repl) : SRC["walker.js"];
    const ctx = vm.createContext({ console, Math, Float64Array, Float32Array, Object, Array, JSON, Number, isNaN });
    for (const f of Object.keys(SRC)) vm.runInContext(f === "walker.js" ? patched : SRC[f], ctx, { filename: f });
    const R = vm.runInContext(`(${function (episodes, pool) {
        const M = HUMANOID;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        let maxSpd = 0, maxF = 0, diverged = 0, wp = 0, fit = 0, over6 = 0, sunk = 0;
        for (let ep = 0; ep < episodes; ep++) {
            const terrainId = ["stairs", "varied", "mixed", "rolling"][ep % 4];
            const o = { stage: 5, terrainDifficulty: 1, terrainId,
                        missionSeed: 4000 + ep * 17, noiseSeed: 900 + ep * 7, noise: true };
            if (pool) { o.groundFrac = 1; o.seatFrac = 0; o.poseFrac = 1; } else { o.groundFrac = 0; }
            const world = new World(M, [net], o);
            const w = world.walkers[0];
            let tripped = false, deep = false;
            while (!world.isOver()) {
                world.step();
                const spd = Math.hypot(w.mb.qd[3], w.mb.qd[4], w.mb.qd[5]);
                if (spd > maxSpd) maxSpd = spd;
                if (spd > 6) tripped = true;                 // the proposed guard rail
                for (let i = 0; i < M.contacts.length; i++) if (w.ptForce[i] > maxF) maxF = w.ptForce[i];
                // is any contact point more than a hand's width under the surface?
                const s4 = new Float64Array(4), p = new Float64Array(3);
                for (let i = 0; i < M.contacts.length; i++) {
                    const c = M.contacts[i];
                    w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], p, 0);
                    world.terrain.sample(p[0], p[2], s4);
                    if ((s4[0] - p[1]) * s4[2] > 0.10 && !w.diverged) { deep = true; break; }
                }
            }
            if (w.diverged) diverged++;
            if (tripped) over6++;
            if (deep) sunk++;
            wp += w.arrivals; fit += w.fitness();
        }
        return { maxSpd, maxF, diverged, wp, fit: fit / episodes, over6, sunk };
    }})(24, ${pool})`, ctx);
    console.log(`  ${label.padEnd(30)} ${R.maxSpd.toFixed(1).padStart(7)} m/s ${(R.maxF / 638).toFixed(1).padStart(8)}x bw` +
        ` ${String(R.diverged).padStart(4)}/24 ${String(R.over6).padStart(5)}/24 ${String(R.sunk).padStart(5)}/24` +
        ` ${R.wp.toFixed(0).padStart(5)} wp ${R.fit.toFixed(0).padStart(8)}`);
    return R;
}

console.log("24 episodes, identical seeds. `>6m/s` is how often the proposed guard rail would fire.");
console.log("`sunk` counts episodes where a contact point ever went >10 cm under the surface.\n");
console.log("POOL POSES");
console.log("  variant                        top speed  peak force  diverg  >6m/s   sunk    wp   fitness");
run("as shipped", null, true);
for (const c of [15, 10, 6, 3]) run(`HC<=6, point force <= ${c}x bw`, guard(c), true);

console.log("\nCROUCH STARTS — does the guard cost the ordinary walk anything?");
console.log("  variant                        top speed  peak force  diverg  >6m/s   sunk    wp   fitness");
run("as shipped", null, false);
for (const c of [15, 10, 6, 3]) run(`HC<=6, point force <= ${c}x bw`, guard(c), false);
