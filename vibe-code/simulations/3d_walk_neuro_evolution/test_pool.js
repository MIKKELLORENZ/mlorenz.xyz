/* test_pool.js — the baked (two-net) brain on EVERY start pose the showcase
 * can deal, headless: per pose, rises that HOLD (no fall within 3 s of
 * recovering) and mean waypoints. node test_pool.js [episodes per pose]
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const EP = +(process.argv[2] || 20);
const net = Net.fromJSON(DEFAULT_BRAIN.net); if (process.env.NORISE !== "1" && DEFAULT_BRAIN.riseNet) net.riseNet = Net.fromJSON(DEFAULT_BRAIN.riseNet);
if (process.env.NORISE !== "1" && DEFAULT_BRAIN.riseNets) { net.riseNets = {}; for (const k in DEFAULT_BRAIN.riseNets) net.riseNets[k] = Net.fromJSON(DEFAULT_BRAIN.riseNets[k]); }
const poses = [...HUMANOID.groundPoses.map(p => p.name), ...HUMANOID.startPoses.map(p => p.name)];
console.log(`brain ${DEFAULT_BRAIN.id} rise ${DEFAULT_BRAIN.riseId || "none"}; ${EP} episodes per pose, stage 5, flat`);
for (const pose of poses) {
    let rose = 0, held = 0, wp = 0;
    for (let ep = 0; ep < EP; ep++) {
        const world = new World(HUMANOID, [net], { stage: 5, terrainDifficulty: 0, terrainId: "flat",
            missionSeed: 9000 + ep * 37, noiseSeed: 700 + ep * 13, noise: true, riseTrial: pose, groundFrac: 0, poseFrac: 0, seatFrac: 0 });
        const w = world.walkers[0]; let tRec = -1, fallsAt = 0, ok = false;
        while (!world.isOver()) {
            world.step();
            if (tRec < 0 && w.recoveries > 0) { tRec = world.time; fallsAt = w.falls; }
            if (tRec >= 0 && world.time - tRec >= 3 && w.falls === fallsAt) ok = true;
        }
        if (w.recoveries > 0) rose++; if (ok || (tRec >= 0 && w.falls === fallsAt)) held++; wp += w.arrivals;
    }
    console.log(`${pose.padEnd(12)} rose ${String(rose).padStart(2)}/${EP}  held ${String(held).padStart(2)}/${EP}  waypoints ${(wp / EP).toFixed(1)}`);
}
