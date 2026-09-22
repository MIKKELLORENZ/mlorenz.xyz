/* test_two_net.js — headless check of the two-net brain: kneel starts with and
 * without the rise net, counting rises that HOLD (no fall within 3 s).
 *   node test_two_net.js [episodes]
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js", "default_brain.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const EP = +(process.argv[2] || 30);
const walk = Net.fromJSON(DEFAULT_BRAIN.net);
const two = Net.fromJSON(DEFAULT_BRAIN.net); two.riseNet = Net.fromJSON(DEFAULT_BRAIN.riseNet);
function run(net, label) {
    let rose = 0, held = 0, wp = 0;
    for (let ep = 0; ep < EP; ep++) {
        const world = new World(HUMANOID, [net], { stage: 5, terrainDifficulty: 0, terrainId: "flat",
            missionSeed: 7000 + ep * 37, noiseSeed: 500 + ep * 13, noise: true, riseTrial: "kneel", groundFrac: 0, poseFrac: 0, seatFrac: 0 });
        const w = world.walkers[0];
        let tRec = -1, fallsAt = 0, ok = false;
        while (!world.isOver()) {
            world.step();
            if (tRec < 0 && w.recoveries > 0) { tRec = world.time; fallsAt = w.falls; }
            if (tRec >= 0 && world.time - tRec >= 3 && w.falls === fallsAt) ok = true;
        }
        if (w.recoveries > 0) rose++;
        if (ok || (tRec >= 0 && w.falls === fallsAt)) held++;
        wp += w.arrivals;
    }
    console.log(`${label}: kneel starts ${EP}  rose ${rose}  held ${held}  mean waypoints ${(wp / EP).toFixed(2)}`);
}
console.log(`walking net ${DEFAULT_BRAIN.id}, rise net ${DEFAULT_BRAIN.riseId || "none"}`);
run(walk, "single net ");
run(two, "two-net    ");
