/* probe_ledger.js — why does trying to get up score WORSE than giving up?
 *
 *   node probe_ledger.js
 *
 * Reported from watching training: a walker that lands on its stomach and barely
 * moves ends around +40 to +60, while one that lands on its back and works hard
 * ends around -300. If that is real it is the worst kind of reward bug, because
 * the behaviour being punished is exactly the one the curriculum exists to
 * teach, and no amount of search time fixes a gradient that points the wrong way.
 *
 * This prints the ledger term by term for every floor-start episode, sorted by
 * how much the walker actually moved, so the passive and the active ones can be
 * read off against each other. Nothing here changes the reward; the point is to
 * find out which line item is responsible before touching any of them.
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

const rows = [];
for (let ep = 0; ep < 40; ep++) {
    const terrainId = ["stairs", "varied", "mixed", "rolling"][ep % 4];
    const world = new World(M, [net], {
        stage: 5, terrainDifficulty: 1, terrainId,
        missionSeed: 7000 + ep * 13, noiseSeed: 300 + ep * 11, noise: true,
        groundFrac: 1, seatFrac: 0, poseFrac: 1
    });
    const w = world.walkers[0];
    let comMin = 9, comMax = 0, effort = 0, rises = 0, prevCom = null, climbing = false;
    while (!world.isOver()) {
        world.step();
        const c = w.comHeight(world);
        if (c < comMin) comMin = c;
        if (c > comMax) comMax = c;
        // count distinct upward excursions of at least 3 cm — "wiggling up a few times"
        if (prevCom !== null) {
            if (!climbing && c > prevCom + 0.0005) { climbing = true; }
            else if (climbing && c < prevCom - 0.0005) { climbing = false; }
        }
        prevCom = c;
        effort += Math.abs(w.mb.qd[6]) + Math.abs(w.mb.qd[7]);
    }
    // recount excursions properly from the recorded extremes
    rows.push({
        pose: w.startPose, fit: w.fitness(), fitScore: w.fitScore, penalty: w.penalty,
        energyCost: -Math.min(FIT.ENERGY_CAP, FIT.ENERGY_W * w.energy),
        rise: w.riseIncome, falls: w.falls, best: w.bestComY, span: comMax - comMin,
        effort, t: world.time, diverged: w.diverged
    });
}

rows.sort((a, b) => a.effort - b.effort);
console.log("40 floor-start episodes, sorted by how much the walker moved its legs.\n");
console.log("  pose         effort   COM span   best COM   falls   fitScore   penalty   energy    rise    FINAL");
for (const r of rows) {
    console.log(`  ${r.pose.padEnd(11)} ${r.effort.toFixed(0).padStart(7)}` +
        ` ${(r.span * 100).toFixed(1).padStart(8)} cm ${(r.best * 100).toFixed(0).padStart(8)} cm` +
        ` ${String(r.falls).padStart(6)} ${r.fitScore.toFixed(0).padStart(10)} ${r.penalty.toFixed(0).padStart(9)}` +
        ` ${r.energyCost.toFixed(0).padStart(8)} ${r.rise.toFixed(0).padStart(7)} ${r.fit.toFixed(0).padStart(8)}`);
}

const q = rows.length >> 2;
const lazy = rows.slice(0, q), busy = rows.slice(-q);
const mean = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length;
console.log(`\n              quietest quarter      busiest quarter`);
for (const k of ["effort", "span", "best", "falls", "fitScore", "penalty", "energyCost", "rise", "fit"]) {
    console.log(`  ${k.padEnd(12)} ${mean(lazy, k).toFixed(1).padStart(14)} ${mean(busy, k).toFixed(1).padStart(20)}`);
}
console.log(`\nIf the busiest quarter scores below the quietest, the gradient points at "give up".`);
