/* probe_fling.js — chase the "flung 5-12 m while spinning" report.
 *
 *   node probe_fling.js [episodes]
 *
 * Hypothesis under test: the ground is a height field, and a stair riser is
 * modelled as a very steep short ramp (rise/riserW = 2.0 at full difficulty, so
 * a ~63 degree face). Two things follow that the contact law never bounds:
 *
 *   1. the surface normal on that face is mostly HORIZONTAL — nx 0.89, ny 0.45 —
 *      so the ground reaction there is a sideways shove, not support;
 *   2. `depth` in _contacts() is uncapped, and Hunt-Crossley scales it by the
 *      point's own normal velocity, which is ~0 for a point travelling
 *      horizontally into a riser. So the spring loads up with nothing damping it.
 *
 * A point that slides into a riser therefore accumulates penetration and is
 * ejected horizontally, off-centre, which is a fling plus a spin.
 *
 * This does not assume any of that. It runs episodes, records the largest single
 * contact force seen on each tick with the terrain gradient under that point, and
 * reports the ticks where the body's speed jumped hardest — then says whether
 * those two coincide. If the flings are unrelated to steep ground, the gradient
 * column will come back flat and the hypothesis is dead.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

const EPISODES = +(process.argv[2] || 24);
const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
const M = HUMANOID;
const scratch = new Float64Array(3), s4 = new Float64Array(4);

const events = [];
let ticks = 0;

for (let ep = 0; ep < EPISODES; ep++) {
    const terrainId = ["stairs", "varied", "mixed", "rolling"][ep % 4];
    const world = new World(M, [net], {
        stage: 5, terrainDifficulty: 1, terrainId,
        missionSeed: 4000 + ep * 17, noiseSeed: 900 + ep * 7, noise: true,
        // the showcase's conditions: every episode starts in one of the pool poses
        groundFrac: 1, seatFrac: 0, poseFrac: 1
    });
    const w = world.walkers[0];
    const pose = w.startPose;
    let prevSpeed = 0;
    while (!world.isOver()) {
        const x0 = w.mb.bp[0], z0 = w.mb.bp[2];
        world.step();
        ticks++;
        const spd = Math.hypot(w.mb.qd[3], w.mb.qd[4], w.mb.qd[5]);
        const spin = Math.hypot(w.mb.qd[0], w.mb.qd[1], w.mb.qd[2]);
        const dv = spd - prevSpeed;
        prevSpeed = spd;
        if (dv < 0.35) continue;                       // only real accelerations
        // what was the ground doing under the hardest-pressed contact point?
        let worstF = 0, worstGrad = 0, worstNy = 1, worstDepth = 0, worstName = "";
        for (let i = 0; i < M.contacts.length; i++) {
            if (w.ptForce[i] <= worstF) continue;
            const c = M.contacts[i];
            w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], scratch, 0);
            world.terrain.sample(scratch[0], scratch[2], s4);
            worstF = w.ptForce[i];
            worstNy = s4[2];
            worstGrad = Math.hypot(s4[1], s4[3]) / Math.max(1e-6, s4[2]);   // |dh/dx|
            worstDepth = (s4[0] - scratch[1]) * s4[2];
            worstName = M.bodies[c.body].name.replace(/Link$/, "");
        }
        events.push({ ep, terrainId, pose, t: world.time, dv, spd, spin,
                      f: worstF, grad: worstGrad, ny: worstNy, depth: worstDepth, part: worstName,
                      dist: Math.hypot(w.mb.bp[0] - x0, w.mb.bp[2] - z0) / DT });
    }
}

events.sort((a, b) => b.dv - a.dv);
const bw = M.weight;
console.log(`${EPISODES} episodes, ${ticks} ticks, body weight ${bw.toFixed(0)} N\n`);
console.log("hardest single-tick accelerations, with the ground under the hardest-loaded point:");
console.log("  dv/tick   speed   spin   peak pt force      depth     |dh/dx|   ny     part        terrain   pose");
for (const e of events.slice(0, 14)) {
    console.log(`  ${e.dv.toFixed(2)} m/s  ${e.spd.toFixed(1).padStart(5)}  ${e.spin.toFixed(1).padStart(5)}` +
        `  ${e.f.toFixed(0).padStart(7)} N (${(e.f / bw).toFixed(1).padStart(5)}x bw)` +
        `  ${(e.depth * 1000).toFixed(0).padStart(5)} mm  ${e.grad.toFixed(2).padStart(6)}` +
        `  ${e.ny.toFixed(2)}  ${e.part.padEnd(10)}  ${e.terrainId.padEnd(8)}  ${e.pose}`);
}

const big = events.filter(e => e.dv > 1.0);
const steep = big.filter(e => e.grad > 0.8);
console.log(`\n${big.length} ticks with dv > 1.0 m/s; ${steep.length} of them on ground steeper than |dh/dx| 0.8` +
    ` (a riser face is 2.0, ordinary relief is under 0.3).`);
const byTerrain = {};
for (const e of big) byTerrain[e.terrainId] = (byTerrain[e.terrainId] || 0) + 1;
console.log("by terrain:", JSON.stringify(byTerrain));
console.log(`deepest penetration seen at any of these: ${Math.max(0, ...events.map(e => e.depth * 1000)).toFixed(0)} mm`);
console.log(`fastest body speed reached: ${Math.max(0, ...events.map(e => e.spd)).toFixed(1)} m/s` +
    `  (the divergence guard only trips past 25 m/s, so nothing below that is discarded)`);
