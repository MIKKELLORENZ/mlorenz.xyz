/* eval_brain.js — how good is this brain REALLY?
 *
 *   node eval_brain.js training/ckpt_main.json
 *
 * Never quote the training log's `best` as a brain's ability. That number is
 * best-of-population on the six missions the population was selected against,
 * and the champion is partly selected for being lucky on exactly those. This
 * flies the champion on HELD-OUT mission seeds — chains it has never seen, with
 * spawn headings it has never started from — and reports the spread across
 * several independent seed banks. Bank-to-bank spread is the luck detector: a
 * brain that wins one bank and loses the next was fitted to a bank.
 *
 * The hand-written autopilot flies the identical seeds as a reference, so the
 * evolved result is quoted against something rather than in a vacuum.
 */
"use strict";
require("./bootstrap.js");
const fs = require("fs");
const { Autopilot4D } = require("./autopilot.js");

const ckPath = process.argv[2] || "training/ckpt_main.json";
const ck = JSON.parse(fs.readFileSync(ckPath, "utf8"));
const brain = Net.fromJSON(ck.champion);
const room = new Room4D();

/* Banks well outside the trainer's 1000 + 137·e range. */
const BANKS = [
    { name: "bank A", base: 60000 },
    { name: "bank B", base: 71000 },
    { name: "bank C", base: 82000 },
    { name: "bank D", base: 93000 }
];
const PER_BANK = 8;

function fly(net, pilot, base, n) {
    let arr = 0, fit = 0, crash = 0, air = 0, took = 0;
    const each = [];
    for (let e = 0; e < n; e++) {
        const opts = {
            missionSeed: base + e * 311, noiseSeed: base + 7 + e * 53,
            turbulence: 0.15, noise: true, hardCap: 120, maxArrivals: 30, minSep: 8
        };
        if (pilot) opts.pilot = pilot;
        const r = runEpisode(room, [pilot ? null : net], opts)[0];
        arr += r.arrivals; fit += r.fitness; crash += r.crashed; air += r.airTime; took += r.tookOff;
        each.push(r.arrivals);
    }
    return { arr: arr / n, fit: fit / n, crash: crash / n, air: air / n, took: took / n, each };
}

console.log(`champion: ${ckPath}, gen ${ck.gen}, training-bank fitness ${ck.championFit.toFixed(0)}`);
console.log(`net ${ck.netSizes.join("-")}\n`);
console.log("  bank      waypoints/ep   fitness   airtime   tookOff   crashed   per-episode");
console.log("  " + "─".repeat(84));

let tot = 0, worst = 1e9;
for (const b of BANKS) {
    const r = fly(brain, null, b.base, PER_BANK);
    tot += r.arr; worst = Math.min(worst, r.arr);
    console.log(`  ${b.name}   ${r.arr.toFixed(2).padStart(11)}   ${r.fit.toFixed(0).padStart(7)}` +
        `   ${r.air.toFixed(1).padStart(6)}s   ${(r.took * 100).toFixed(0).padStart(6)}%` +
        `   ${(r.crash * 100).toFixed(0).padStart(6)}%   [${r.each.join(" ")}]`);
}
const mean = tot / BANKS.length;
console.log("  " + "─".repeat(84));
console.log(`  MEAN over banks: ${mean.toFixed(2)} waypoints/episode   worst bank ${worst.toFixed(2)}`);

console.log("\n  reference — the hand-written PD autopilot on the same seeds:");
let atot = 0;
for (const b of BANKS) {
    const r = fly(null, new Autopilot4D(), b.base, PER_BANK);
    atot += r.arr;
    console.log(`  ${b.name}   ${r.arr.toFixed(2).padStart(11)}   ${r.fit.toFixed(0).padStart(7)}` +
        `   ${r.air.toFixed(1).padStart(6)}s   ${(r.took * 100).toFixed(0).padStart(6)}%` +
        `   ${(r.crash * 100).toFixed(0).padStart(6)}%   [${r.each.join(" ")}]`);
}
console.log(`  autopilot mean: ${(atot / BANKS.length).toFixed(2)} waypoints/episode`);
console.log(`\n  evolved / hand-written = ${(mean / (atot / BANKS.length) * 100).toFixed(0)}%`);
