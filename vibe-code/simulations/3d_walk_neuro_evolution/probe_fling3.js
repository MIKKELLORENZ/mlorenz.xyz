/* probe_fling3.js — is the fling the Hunt-Crossley velocity term running away?
 *
 *   node probe_fling3.js
 *
 * The trace in probe_fling2 rules out both of the obvious answers. It is not the
 * terrain (flat ground, ny 1.00) and it is not contact stiffness (lowering KN
 * makes it MORE frequent, not less). What the trace does show is that force
 * outruns penetration by a factor that keeps climbing:
 *
 *     depth   5.88 mm -> KN*d =    706 N, actual     2,023 N   (x2.9)
 *     depth  25.41 mm -> KN*d =  3,049 N, actual    27,586 N   (x9.0)
 *     depth 166.45 mm -> KN*d = 19,974 N, actual 1,741,420 N   (x87)
 *
 * That factor is the whole force law's second term: fn = KN*depth*(1 - HC*vn),
 * with HC 2.5 and vn the point's normal velocity. It is UNBOUNDED. x87 means
 * vn = -34 m/s: the point is being driven into the ground at 34 m/s.
 *
 * The proposed loop, which this file tests and does not assume:
 *     fn up -> the Coulomb limit mu*fn up -> the tangential stick spring is
 *     released to push that much harder -> a huge off-centre force spins the
 *     body -> the contact point's own velocity climbs -> |vn| up -> fn up.
 *
 * Two clamps are tested independently, each defensible on its own physics:
 *   HCMAX  the damping multiplier cannot exceed a fixed factor. A real contact
 *          cannot deliver unbounded force because a body approached it fast.
 *   DMAX   penetration entering the force law is capped. 166 mm inside the floor
 *          is not a contact any more, and pricing it as one is fiction.
 *
 * If the runaway is the velocity term, HCMAX alone should end it.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = {};
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    SRC[f] = fs.readFileSync(path.join(__dirname, f), "utf8");
}

const ORIGINAL = "let fn = CONTACT.KN * depth * (1 - CONTACT.HC * vn);";
if (!SRC["walker.js"].includes(ORIGINAL)) {
    console.error("the contact force line has moved — update this probe before trusting it");
    process.exit(1);
}

/* Each variant runs in its own context so the patched walker.js cannot leak. */
function run(label, patched, episodes) {
    const ctx = vm.createContext({ console, Math, Float64Array, Float32Array, Object, Array, JSON, Number, isNaN });
    for (const f of Object.keys(SRC)) {
        vm.runInContext(f === "walker.js" ? patched : SRC[f], ctx, { filename: f });
    }
    const R = vm.runInContext(`(${function (episodes) {
        const M = HUMANOID;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        const scratch = new Float64Array(3), s4 = new Float64Array(4);
        let big = 0, maxDepth = 0, maxSpd = 0, maxForce = 0, diverged = 0;
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
                    if (w.ptForce[i] > maxForce) maxForce = w.ptForce[i];
                    const c = M.contacts[i];
                    w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], scratch, 0);
                    world.terrain.sample(scratch[0], scratch[2], s4);
                    const d = (s4[0] - scratch[1]) * s4[2];
                    if (d > maxDepth) maxDepth = d;
                }
            }
            if (w.diverged) diverged++;
        }
        return { big, maxDepth, maxSpd, maxForce, diverged };
    }})(${episodes})`, ctx);
    console.log(`  ${label.padEnd(34)} ${String(R.big).padStart(6)}` +
        `   ${(R.maxDepth * 1000).toFixed(0).padStart(7)} mm` +
        `   ${R.maxSpd.toFixed(1).padStart(7)} m/s` +
        `   ${(R.maxForce / 638).toFixed(0).padStart(8)}x bw` +
        `   ${String(R.diverged).padStart(3)}`);
    return R;
}

const EPISODES = 24;
console.log(`${EPISODES} episodes, identical seeds, only the contact force law changed.\n`);
console.log("  variant                            flings   deepest pen.    top speed   peak force   diverged");

run("as shipped", SRC["walker.js"], EPISODES);

for (const hcmax of [8, 4, 2]) {
    run(`HC multiplier capped at ${hcmax}`, SRC["walker.js"].replace(ORIGINAL,
        `let fn = CONTACT.KN * depth * Math.min(${hcmax}, 1 - CONTACT.HC * vn);`), EPISODES);
}

run("penetration capped at 30 mm", SRC["walker.js"].replace(ORIGINAL,
    "let fn = CONTACT.KN * Math.min(0.030, depth) * (1 - CONTACT.HC * vn);"), EPISODES);

run("both: HC<=4, pen<=30 mm", SRC["walker.js"].replace(ORIGINAL,
    "let fn = CONTACT.KN * Math.min(0.030, depth) * Math.min(4, 1 - CONTACT.HC * vn);"), EPISODES);
