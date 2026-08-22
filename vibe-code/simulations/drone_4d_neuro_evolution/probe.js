/* probe.js — what does generation 1 actually do?
 *
 *   node probe.js
 *
 * The 3D project this is built from learned the hard way that the output-layer
 * init scale is not a hyperparameter you tune later. If fresh brains flip on
 * the pad, generation 1 is sixty identical wrecks, every fitness is the same,
 * and the GA has nothing to select on — a run that never starts, which reads
 * exactly like a run that is merely slow. What matters is not the nominal climb
 * margin but its size against the SPREAD across random brains.
 *
 * 4D changes the arithmetic in two ways that both push the same direction:
 * tilt torque from a random output layer grows as √(rotor count), so eight
 * corners is √2 more tumble than four arms, and there are three tilt planes to
 * stay level in instead of two. So the 3D value cannot simply be inherited.
 * This sweeps it and reports the numbers the choice should be made on.
 */
"use strict";
require("./bootstrap.js");

const N_BRAINS = 40, N_EPS = 3;
const room = new Room4D();
const SCALES = process.argv[2] ? [parseFloat(process.argv[2])] : [0.05, 0.03, 0.02, 0.012, 0.006, 0.0];

console.log(`fresh-brain sweep — ${N_BRAINS} random brains × ${N_EPS} episodes, net ${NET_SIZES.join("-")}`);
console.log(`hover throttle ${(DRONE.MASS * G4 / (8 * DRONE.TMAX) * 100).toFixed(1)}%, ` +
    `climb margin at 0.5 throttle ${(8 * 0.5 * DRONE.TMAX - DRONE.MASS * G4).toFixed(2)} N\n`);
console.log("  outInit   leftGround   armed   meanAir   meanPeakY   meanWP   fitSpread");
console.log("  " + "─".repeat(72));

for (const sc of SCALES) {
    const nets = [];
    const rng = mulberry32(4242);
    for (let i = 0; i < N_BRAINS; i++) nets.push(new Net(NET_SIZES, rng, sc));

    let left = 0, armed = 0, air = 0, peak = 0, wp = 0, n = 0;
    const fits = [];
    for (let e = 0; e < N_EPS; e++) {
        const res = runEpisode(room, nets, {
            missionSeed: 1000 + e * 137, noiseSeed: 500 + e * 29,
            turbulence: 0.15, noise: true, hardCap: 60, maxArrivals: 30, minSep: 8
        });
        for (const r of res) {
            if (r.peakY > DRONE.RADIUS + 0.05) left++;
            if (r.tookOff) armed++;
            air += r.airTime; peak += r.peakY; wp += r.arrivals; n++;
            fits.push(r.fitness);
        }
    }
    const mean = fits.reduce((a, b) => a + b, 0) / fits.length;
    const sd = Math.sqrt(fits.reduce((a, b) => a + (b - mean) ** 2, 0) / fits.length);
    console.log(`  ${sc.toFixed(4).padStart(7)}   ${(100 * left / n).toFixed(0).padStart(8)}%` +
        `${(100 * armed / n).toFixed(0).padStart(8)}%` +
        `${(air / n).toFixed(2).padStart(10)}s` +
        `${(peak / n).toFixed(2).padStart(11)}m` +
        `${(wp / n).toFixed(3).padStart(9)}` +
        `${sd.toFixed(0).padStart(11)}`);
}
console.log("\nWanted: ~all brains leave the ground and most arm, with a WIDE fitness");
console.log("spread — the spread is the selection signal. Zero spread means gen 1 is");
console.log("a coin flip and the run has no gradient to climb.");
