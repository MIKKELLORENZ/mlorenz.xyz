/* probe_fling2.js — the fling, traced.
 *
 *   node probe_fling2.js
 *
 * probe_fling.js killed the first hypothesis: the ground under these events is
 * flat (|dh/dx| ~ 0.0, ny 1.00) and `rolling` produces more of them than
 * `stairs`. What it did show is that the hardest-loaded point is nearly always
 * RHand or RForearm, buried up to 286 mm, at up to 2869x body weight.
 *
 * So the question is how a hand gets a quarter of a metre under flat ground.
 * The candidate: the contact spring is explicit, and stability of an explicit
 * spring needs dt < 2*sqrt(m_eff/k). KN is 120000 N/m, tuned against feet
 * carrying a 65 kg body. A hand at the end of an arm has a fraction of that
 * effective inertia, and the pool poses — crow, quadruped, kneel, sidesit — are
 * the first thing in this project that ever put weight on the hands.
 *
 * Three tests, none of which assume the answer:
 *   1. the arithmetic: link masses and the critical timestep each implies
 *   2. a tick-by-tick trace through one blowup — an unstable spring alternates
 *      sign and grows geometrically; a real force does not
 *   3. a KN sweep — if it is a stiffness/timestep instability the events must
 *      vanish as KN falls, and a real collision would not care
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const M = HUMANOID;
const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
const scratch = new Float64Array(3), s4 = new Float64Array(4);

/* ---- 1. the arithmetic ------------------------------------------------- */
console.log("link masses and what each implies for an explicit contact spring:\n");
console.log("  link          mass     dt_crit = 2*sqrt(m/KN)   vs the actual 2.00 ms");
const seen = new Set();
for (const c of M.contacts) {
    const b = M.bodies[c.body];
    if (seen.has(b.name)) continue;
    seen.add(b.name);
    const dtc = 2 * Math.sqrt(b.mass / CONTACT.KN) * 1000;
    console.log(`  ${b.name.replace(/Link$/, "").padEnd(12)}  ${b.mass.toFixed(2).padStart(5)} kg` +
        `  ${dtc.toFixed(2).padStart(10)} ms          ${dtc > 2 ? "stable" : "UNSTABLE"}`);
}
console.log(`\n  (link mass alone is optimistic — the articulated inertia a contact actually`);
console.log(`   sees at the end of a free-swinging arm is lower still.)\n`);

/* ---- 2. trace one blowup ----------------------------------------------- */
function traceEpisode(terrainId, seed) {
    const world = new World(M, [net], {
        stage: 5, terrainDifficulty: 1, terrainId,
        missionSeed: seed, noiseSeed: seed + 3, noise: true,
        groundFrac: 1, seatFrac: 0, poseFrac: 1
    });
    const w = world.walkers[0];
    const ring = [];
    while (!world.isOver()) {
        world.step();
        // watch every contact point; record the most-penetrated one this tick
        let bi = -1, bd = 0;
        for (let i = 0; i < M.contacts.length; i++) {
            const c = M.contacts[i];
            w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], scratch, 0);
            world.terrain.sample(scratch[0], scratch[2], s4);
            const d = (s4[0] - scratch[1]) * s4[2];
            if (d > bd) { bd = d; bi = i; }
        }
        ring.push({ t: world.time, i: bi, depth: bd,
                    f: bi >= 0 ? w.ptForce[bi] : 0,
                    part: bi >= 0 ? M.bodies[M.contacts[bi].body].name.replace(/Link$/, "") : "-",
                    spd: Math.hypot(w.mb.qd[3], w.mb.qd[4], w.mb.qd[5]) });
        if (ring.length > 4000) ring.shift();
        if (bd > 0.15) return { pose: w.startPose, ring };
    }
    return null;
}

let tr = null;
for (const [terrain, seed] of [["rolling", 4000], ["rolling", 4051], ["stairs", 4068], ["mixed", 4034], ["rolling", 4102]]) {
    tr = traceEpisode(terrain, seed);
    if (tr) { console.log(`traced a blowup on ${terrain}, start pose ${tr.pose}:\n`); break; }
}
if (!tr) console.log("no blowup reproduced in the traced episodes\n");
else {
    const r = tr.ring, n = r.length;
    console.log("      time    part        penetration      contact force     body speed");
    for (let i = Math.max(0, n - 26); i < n; i++) {
        const e = r[i];
        console.log(`   ${e.t.toFixed(3).padStart(7)}s  ${e.part.padEnd(10)}` +
            `  ${(e.depth * 1000).toFixed(2).padStart(9)} mm  ${e.f.toFixed(0).padStart(12)} N` +
            `  ${e.spd.toFixed(2).padStart(8)} m/s`);
    }
}

/* ---- 3. does it depend on the stiffness? -------------------------------- */
function countFlings(kn, episodes) {
    const was = CONTACT.KN;
    CONTACT.KN = kn;
    let big = 0, maxDepth = 0, maxSpd = 0;
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
            maxSpd = Math.max(maxSpd, spd);
            for (let i = 0; i < M.contacts.length; i++) {
                const c = M.contacts[i];
                w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], scratch, 0);
                world.terrain.sample(scratch[0], scratch[2], s4);
                maxDepth = Math.max(maxDepth, (s4[0] - scratch[1]) * s4[2]);
            }
        }
    }
    CONTACT.KN = was;
    return { big, maxDepth, maxSpd };
}

console.log("\nsame 24 episodes, contact stiffness swept (everything else identical):\n");
console.log("      KN        flings (dv > 1 m/s)   deepest penetration   fastest body speed");
for (const kn of [120000, 60000, 30000, 15000]) {
    const r = countFlings(kn, 24);
    console.log(`  ${String(kn).padStart(7)} N/m  ${String(r.big).padStart(14)}` +
        `   ${(r.maxDepth * 1000).toFixed(0).padStart(15)} mm   ${r.maxSpd.toFixed(1).padStart(14)} m/s`);
}
