/* limited.js — IS THIS GA SEARCH-LIMITED OR SIGNAL-LIMITED?
 *
 * Ten minutes of arithmetic that decides whether more generations can possibly
 * help. The rule: a selector's resolution is SE = sd / sqrt(episodes), where sd
 * is the PER-EPISODE standard deviation of the thing being selected on. If SE
 * is larger than the improvement available over the next few hundred
 * generations, selection is reading noise and no amount of running fixes it.
 *
 * Measured here on the rung the trainer is actually selecting on, with a FIXED
 * policy — the champion — so every bit of the spread is episode variance and
 * none of it is learning.
 *
 * Also reported: the information rate. One scalar per episode has to allocate
 * credit across every control decision in it and fit the whole genome. When
 * that ratio is bad, fine-grained skill is unlearnable by episode-level
 * selection however long it runs.
 *
 *   node vtest/limited.js vtest/champ/P5.json [rung] [episodes]
 */
"use strict";

const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const fs = require("fs");

const file = process.argv[2] || "vtest/champ/P5.json";
const RUNG = Number(process.argv[3] || 4);
const NEP = Number(process.argv[4] || 300);

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const brain = NN.Brain.fromJSON(raw.brain || raw);
const lags = raw.lags || (brain.spec.nin === 139 ? [2, 10, 35] : null);

/* A large pool of stage-0 episodes drawn from the TRAINING seed space, because
 * that is what selection actually sees each generation. */
const bank = [];
for (let i = 0; i < NEP; i++) bank.push({ stage: 0, seed: 4000000 + i * 7919 });

const pol = new NN.BrainPolicy(brain, { lags });
const per = [], canon = [];
let decisions = 0;
for (const s of bank) {
    const w = new WM.World(SC.makeScenario(s.stage, s.seed));
    pol.reset();
    const r = w.runEpisode((ww, o) => pol.act(ww, o));
    per.push(r.phases[RUNG - 1]);
    canon.push(r.total);
    decisions += r.ticks;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };

const m = mean(per), s = sd(per);
console.log(`${file} · gen ${raw.gen} · rung ${RUNG} · ${NEP} episodes, ONE FIXED POLICY\n`);
console.log(`  per-episode  mean ${m.toFixed(4)}   sd ${s.toFixed(4)}   (sd is ${(100 * s / Math.abs(m)).toFixed(0)}% of the mean)`);
console.log(`  canonical    mean ${mean(canon).toFixed(4)}   sd ${sd(canon).toFixed(4)}`);

console.log(`\n  SELECTOR RESOLUTION, SE = sd / sqrt(episodes):`);
for (const n of [12, 24, 40, 64, 128, 256, 512]) {
    console.log(`    ${String(n).padStart(4)} episodes/individual  ->  SE ${(s / Math.sqrt(n)).toFixed(4)}`);
}

/* The improvement actually on offer, taken from the run itself rather than
 * guessed: arm P moved rung 4 by +0.018 across 740 generations. */
const OBSERVED_GAIN = 0.018, OBSERVED_GENS = 740;
console.log(`\n  IMPROVEMENT ON OFFER (measured on arm P): +${OBSERVED_GAIN} over ${OBSERVED_GENS} generations`);
for (const horizon of [100, 250, 500]) {
    const gain = OBSERVED_GAIN * horizon / OBSERVED_GENS;
    const se40 = s / Math.sqrt(40), se64 = s / Math.sqrt(64);
    console.log(`    over ${String(horizon).padStart(3)} gens: gain ${gain.toFixed(4)}` +
        `   vs SE@40 ${se40.toFixed(4)} (${(se40 / gain).toFixed(1)}x)` +
        `   vs SE@64 ${se64.toFixed(4)} (${(se64 / gain).toFixed(1)}x)`);
}

console.log(`\n  INFORMATION RATE:`);
console.log(`    ${(decisions / bank.length).toFixed(0)} control decisions per episode, graded by ONE scalar`);
console.log(`    fitting ${brain.weightCount().toLocaleString()} weights`);
console.log(`    ratio: ${(brain.weightCount() / (decisions / bank.length)).toFixed(0)} weights per scalar-graded decision-sequence`);

const se = s / Math.sqrt(64), gain100 = OBSERVED_GAIN * 100 / OBSERVED_GENS;
console.log(`\n  VERDICT: ${se > gain100
    ? `SIGNAL-LIMITED. At 64 episodes the selector resolves +/-${se.toFixed(4)}, and 100 generations of\n` +
      `           real progress is worth ${gain100.toFixed(4)}. Selection is ${(se / gain100).toFixed(0)}x coarser than the signal it\n` +
      `           is meant to detect. More generations cannot help; a per-decision signal can.`
    : `SEARCH-LIMITED. The selector out-resolves the available gain; tune the GA.`}`);
