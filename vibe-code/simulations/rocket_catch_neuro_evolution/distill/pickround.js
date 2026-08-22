/* pickround.js — take the best DAgger round so far, and make it safe to evolve.
 *
 * main.js only writes best.json when every round has finished, and it is the
 * only path that calls calibrate(). Under a deadline the run has to be cut
 * short, and the round checkpoints are RAW: Brain.mutate scales its Gaussian by
 * net.scales[l], the RMS of that layer's weights recorded when the brain was
 * BUILT and never updated by gradient descent. A distilled network's weights
 * have a completely different spread from the random draw it started at, so
 * warm-starting a GA from an uncalibrated round file applies a mutation sized
 * for a distribution that no longer exists — large enough to destroy the
 * distillation in the first generation.
 *
 * So this picks by the measurement main.js already recorded (catches on the
 * rank bank, mean as the tie-break — never by round number, because later is
 * not better), calibrates, and writes a seed the trainer can take.
 *
 *   node distill/pickround.js <dir> <out.json>
 */
"use strict";
const fs = require("fs");
const path = require("path");
const NN = require("../nn.js");

const dir = process.argv[2] || "distill/run2";
const out = process.argv[3] || path.join(dir, "seed.json");

const rounds = fs.readdirSync(dir)
    .filter(f => /^round\d+\.json$/.test(f))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

if (!rounds.length) { console.error(`no round files in ${dir}`); process.exit(1); }

rounds.sort((a, b) => (b.caught - a.caught) || (b.mean - a.mean));
for (const r of rounds) {
    console.log(`  round ${r.round}  caught ${r.caught}/${r.n}  mean ${r.mean.toFixed(3)} +/- ${r.se.toFixed(3)}` +
        (r === rounds[0] ? "   <- picked" : ""));
}
const best = rounds[0];
const brain = NN.Brain.fromJSON(best.brain);
brain.calibrate();
fs.writeFileSync(out, JSON.stringify({
    round: best.round, caught: best.caught, n: best.n, mean: best.mean, se: best.se,
    inputs: best.inputs, lags: best.lags, arch: best.arch, gen: 0, brain: brain.toJSON()
}));
console.log(`wrote ${out} (calibrated, ${best.inputs} inputs, arch ${best.arch})`);
