/* score_brain.js — fly a saved champion over the held-out exam and report it
 * per stage. Single-threaded and deliberately small: this is the number that
 * decides whether a brain is worth seeding a new run from, and it should not
 * depend on the trainer being up.
 *
 *   node score_brain.js training/best_holdout.json [--per 12] [--stages 0,4]
 *
 * Also scores the inert policy over the same bank, because a champion that
 * cannot beat doing nothing is not a champion.
 */
"use strict";

const NN = require("./nn.js");
const SC = require("./scenarios.js");
const WM = require("./world.js");
const EV = require("./evolution.js");
const AP = require("./autopilot.js");
const fs = require("fs");

const file = process.argv[2];
if (!file) { console.error("usage: node score_brain.js <champion.json> [--per N] [--stages a,b]"); process.exit(1); }

const args = {};
for (let i = 3; i < process.argv.length; i++) {
    const t = process.argv[i];
    if (t.startsWith("--")) args[t.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "true";
}
const PER = Number(args.per || 12);
const STAGES = args.stages ? String(args.stages).split(",").map(Number) : null;

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const brain = NN.Brain.fromJSON(raw.brain || raw);
console.log(`${file}\n  gen ${raw.gen} · recorded exam ${raw.exam != null ? Number(raw.exam).toFixed(3) : "?"}` +
    ` · shape ${brain.net.sizes.join("-")} · act ${brain.act}`);

const bank = SC.examBank(PER).map(s => ({ stage: s.stage, seed: s.seed }));
const use = bank.filter(s => !STAGES || STAGES.includes(s.stage));

const r = EV.Evolution.evaluate(brain, use);
const base = EV.Evolution.baseline(use);

const per = {}, perBase = {}, perN = {}, tally = {};
for (let i = 0; i < use.length; i++) {
    const st = use[i].stage;
    per[st] = (per[st] || 0) + r.scores[i];
    perBase[st] = (perBase[st] || 0) + base[i];
    perN[st] = (perN[st] || 0) + 1;
    const nm = WM.OUTCOME_NAME[r.outcomes[i]];
    tally[nm] = (tally[nm] || 0) + 1;
}

console.log(`\n  stage                                   brain    inert     adv`);
let sum = 0, sumB = 0, n = 0;
for (const st of Object.keys(per).map(Number).sort((a, b) => a - b)) {
    const b = per[st] / perN[st], i0 = perBase[st] / perN[st];
    console.log(`  ${st} ${SC.STAGES[st].label.padEnd(36)}` +
        `${b.toFixed(3).padStart(7)}${i0.toFixed(3).padStart(9)}${(b - i0).toFixed(3).padStart(8)}`);
    sum += b; sumB += i0; n++;
}
console.log(`  ${"MEAN".padEnd(38)}${(sum / n).toFixed(3).padStart(7)}${(sumB / n).toFixed(3).padStart(9)}${((sum - sumB) / n).toFixed(3).padStart(8)}`);
console.log(`\n  outcomes: ` + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
