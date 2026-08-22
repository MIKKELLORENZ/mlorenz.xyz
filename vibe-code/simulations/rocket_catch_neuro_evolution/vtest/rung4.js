/* rung4.js — DOES THE CAPTURE RUNG DISCRIMINATE?
 *
 * A reward term is only worth anything if the population's own offspring spread
 * out under it by more than the episode bank's noise. Rung 4 did not: it was a
 * bare product of five kernels read off the ground-impact state, worth 2e-4, so
 * p4 was 0.15*p3 to four decimal places and selecting on it was selecting on
 * rung 3.
 *
 * This measures the thing that matters rather than arguing about it. Take a
 * champion, breed the mutants the trainer actually breeds, fly them all over ONE
 * shared bank (common random numbers, so the comparison is between brains and
 * not between banks), and report the spread of rung 4 across them — against the
 * spread the same brain gets from a DIFFERENT bank, which is the noise floor any
 * real signal has to clear.
 *
 *   node vtest/rung4.js vtest/champ/P.json [nMutants] [nEpisodes]
 */
"use strict";

const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const EV = require("../evolution.js");
const GOLD = require("../golden_test.js");
const fs = require("fs");

const file = process.argv[2] || "vtest/champ/P.json";
const NMUT = Number(process.argv[3] || 24);
const NEP = Number(process.argv[4] || 24);
const RATE = 0.12, SIGMA = 0.30;         // the trainer's operating point

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const champ = NN.Brain.fromJSON(raw.brain || raw);
console.log(`${file} · gen ${raw.gen} · shape ${champ.net.sizes.join("-")}` +
    ` · ${NMUT} mutants (rate ${RATE}, sigma ${SIGMA}) · ${NEP} episodes/bank`);

/* Two independent stage-0 banks of the same size. Bank A ranks the mutants;
 * bank B re-scores the unchanged champion so the noise floor is measured on the
 * same axis, in the same units, from the same code path. */
const full = SC.examBank(NEP * 3).filter(s => s.stage === 0);
const bankA = full.slice(0, NEP);
const bankB = full.slice(NEP, NEP * 2);

/* Both formulations, from ONE flight each, so the A/B cannot be a difference in
 * what was flown. The new rung 4 comes back in r.phases; the old one is
 * recomputed here from the terminal snapshot exactly as world.js used to, which
 * is the only way to compare them now that the old code is gone. */
const M = require("../mathx.js");
const V = require("../vehicle.js");
const DEG = Math.PI / 180;
function oldCapture(w) {
    const s = w.termState, c = V.TOWER.capture, soft = M.soft;
    const missN = Math.hypot((s.gateDx || 0) / c.across, (s.gateDy || 0) / c.along);
    let C = soft(missN, 3.0) * soft(Math.max(0, s.vzPin - c.vz), 3.0) * soft(s.vhPin, 2.5)
        * soft(s.tilt, 4 * DEG) * soft(s.rate, 4 * DEG);
    if (WM.OUTCOME_NAME[s.outcome] === "tower strike") C *= 0.3;
    return C;
}

function rungsOf(brain, bank) {
    const pol = new NN.BrainPolicy(brain);
    const out = [0, 0, 0, 0, 0];      // slot 4 = OLD rung 4
    for (const s of bank) {
        const w = new WM.World(SC.makeScenario(s.stage, s.seed));
        pol.reset();
        const r = w.runEpisode((ww, o) => pol.act(ww, o));
        for (let k = 0; k < 4; k++) out[k] += r.phases[k] / bank.length;
        const oldC = oldCapture(w);
        out[4] += (r.phases[2] * (0.15 + 0.85 * oldC)
            + (WM.OUTCOME_NAME[w.termState.outcome] === "caught" ? 1 : 0)) / bank.length;
    }
    return out;
}
const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / Math.max(1, a.length - 1)); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const rngSeed = 987654321;
const rng = NN.mulberry32(rngSeed);
const kids = [];
for (let i = 0; i < NMUT; i++) {
    const c = champ.clone();
    c.mutate(RATE, SIGMA, rng);
    kids.push(c);
}

const base = rungsOf(champ, bankA);
const rows = kids.map(k => rungsOf(k, bankA));

/* THE NOISE FLOOR. The same unchanged genome, re-scored on a different bank of
 * the same size. Anything the operators produce that is smaller than this is
 * not a difference between brains. */
const baseB = rungsOf(champ, bankB);

console.log(`\n  rung          champ(A)  champ(B)   |  mutants: mean      sd     min     max`);
for (let k = 0; k < 5; k++) {
    const col = rows.map(r => r[k]);
    console.log(`  ${k + 1} ${["stability", "braking  ", "targeting", "capture  ", "capture(OLD)"][k]}` +
        `${base[k].toFixed(4).padStart(10)}${baseB[k].toFixed(4).padStart(10)}   |` +
        `${mean(col).toFixed(4).padStart(12)}${sd(col).toFixed(4).padStart(8)}` +
        `${Math.min(...col).toFixed(4).padStart(8)}${Math.max(...col).toFixed(4).padStart(8)}`);
}

/* The number the whole exercise is about: how much of rung 4 is rung 3 wearing
 * a hat? If p4/p3 is constant across every mutant then rung 4 carries no
 * information rung 3 did not already have. */
const ratio = rows.map(r => r[3] / Math.max(1e-9, r[2]));
console.log(`\n  p4/p3 across mutants: mean ${mean(ratio).toFixed(4)} sd ${sd(ratio).toFixed(4)}` +
    ` min ${Math.min(...ratio).toFixed(4)} max ${Math.max(...ratio).toFixed(4)}`);
console.log(`  (a constant ratio means rung 4 IS rung 3; the floor alone gives 0.15)`);

const r3 = rows.map(r => r[2]), r4 = rows.map(r => r[3]);
const m3 = mean(r3), m4 = mean(r4);
let cov = 0;
for (let i = 0; i < r3.length; i++) cov += (r3[i] - m3) * (r4[i] - m4);
const corr = cov / Math.max(1e-12, (sd(r3) * sd(r4) * (r3.length - 1)));
console.log(`  corr(p3, p4) = ${corr.toFixed(4)}   (1.000 means the rungs rank identically)`);

console.log(`\n  SIGNAL-TO-NOISE on rung 4: mutant sd ${sd(r4).toFixed(4)}` +
    ` vs bank-change shift ${Math.abs(base[3] - baseB[3]).toFixed(4)}`);

/* And the reference: what the hand-written pilot scores under the same code. */
const pilot = { phases: [0, 0, 0, 0], caught: 0 };
for (const s of bankA) {
    const w = new WM.World(SC.makeScenario(s.stage, s.seed));
    const r = w.runEpisode(GOLD.makePilot(GOLD.GAINS));
    for (let k = 0; k < 4; k++) pilot.phases[k] += r.phases[k] / bankA.length;
    if (WM.OUTCOME_NAME[r.outcome] === "caught") pilot.caught++;
}
console.log(`\n  golden pilot on bank A: ` + pilot.phases.map((v, i) => `r${i + 1} ${v.toFixed(3)}`).join("  ") +
    `  · caught ${pilot.caught}/${bankA.length}`);
