/* handoff.js — take a distilled policy and prepare it for (a) the browser and
 * (b) the GA.
 *
 *   node distill/handoff.js distill/tiny139/best.json [armLetter]
 *
 * TWO THINGS HAVE TO BE RIGHT OR THE HAND-OFF QUIETLY FAILS.
 *
 * 1. THE OBSERVATION LAYOUT TRAVELS WITH THE GENOME. A 139-input brain is
 *    unusable without knowing WHICH three lags produced those 139 inputs, and
 *    the publisher will refuse it outright — which is exactly how the two best
 *    arms stayed invisible on the page for hours earlier today. The champion
 *    file written here carries `lags`.
 *
 * 2. THE MUTATION SCALES MUST BE RE-DERIVED. Brain.mutate sizes its Gaussian by
 *    net.scales[l], the RMS of that layer's weights AT CONSTRUCTION. Gradient
 *    descent moves the weights a long way and never touches scales, so evolving
 *    a distilled brain with stale scales applies a step sized for a random
 *    initialisation: large enough to erase the distillation in one generation.
 *    calibrate() fixes it, and Evolution's --warm path does not call it.
 *
 * The output is a best_holdout.json in the shape autosync and train.js --warm
 * both already understand, so nothing downstream needs to learn a new format.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const SENS = require("../sensors.js");

const src = process.argv[2];
const arm = process.argv[3] || "D";
if (!src) { console.error("usage: node distill/handoff.js <best.json> [armLetter]"); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(src, "utf8"));
const brain = NN.Brain.fromJSON(raw.brain);
const lags = raw.lags || null;
const sensors = new SENS.Sensors(lags);
if (sensors.nInput !== brain.spec.nin) {
    console.error(`refusing: brain wants ${brain.spec.nin} inputs, lags ${JSON.stringify(lags)} give ${sensors.nInput}`);
    process.exit(1);
}

/* Re-measure here rather than trusting the number in the file: the distillation
 * run reported on its own confirmation bank, and this is a different one again.
 * A champion that is published should have been re-flown by whatever publishes
 * it — that rule is why the library stopped ranking a gen-20 brain at the top. */
function score(bank) {
    const pol = new NN.BrainPolicy(brain, { lags });
    let caught = 0, sum = 0; const tally = {};
    for (const s of bank) {
        const w = new WM.World(SC.makeScenario(s.stage, s.seed));
        pol.reset();
        const r = w.runEpisode((ww, o) => pol.act(ww, o));
        const nm = WM.OUTCOME_NAME[r.outcome];
        tally[nm] = (tally[nm] || 0) + 1;
        if (nm === "caught") caught++;
        sum += r.total;
    }
    return { caught, n: bank.length, mean: sum / bank.length, tally };
}
const bank = [];
for (let i = 0; i < 300; i++) bank.push({ stage: 0, seed: 9800000 + i * 7919 });
const ev = score(bank);
console.log(`${src}: caught ${ev.caught}/${ev.n}  mean ${ev.mean.toFixed(4)}`);
console.log(`  ` + Object.entries(ev.tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));

brain.calibrate();
const outDir = path.join("night", arm);
fs.mkdirSync(outDir, { recursive: true });
const champ = {
    format: "rocket-champion-v1",
    gen: 0, exam: ev.mean, live: ev.mean, stages: [0],
    phase: 5, rung: ev.mean, ladder: [0, 0, 0, 0],
    tally: ev.tally, caught: ev.caught, safe: 0,
    inputs: brain.spec.nin, outputs: WM.N_OUT, lags: lags || SENS.LAGS,
    arch: raw.arch, act: brain.act,
    distilled: true, source: src,
    brain: brain.toJSON()
};
fs.writeFileSync(path.join(outDir, "best_holdout.json"), JSON.stringify(champ));
fs.writeFileSync(path.join(outDir, "seed.json"), JSON.stringify(champ));
console.log(`wrote ${path.join(outDir, "best_holdout.json")} (calibrated, lags carried)`);
console.log(`  publish : ARMS="${arm}@$PWD/night" node autosync.js`);
console.log(`  evolve  : train.js --warm ${path.join(outDir, "seed.json")} --arch ${raw.arch}` +
    (lags ? ` (with ROCKET_LAGS=${lags.join(",")})` : ""));
