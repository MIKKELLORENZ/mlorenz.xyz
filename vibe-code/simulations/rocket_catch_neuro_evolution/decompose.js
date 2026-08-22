/* decompose.js — where does the score actually come from?
 *
 *   node decompose.js [champion.json] [--stage 0] [--per 12]
 *
 * A plateau is not informative on its own. "The fleet stopped at 0.42" could be
 * a policy that flies well but never quite catches, or one that has found a
 * shaping term it can farm and has stopped flying at all. The score is a sum of
 * eight named parts and the only way to tell those apart is to print them.
 *
 * The champion is compared TERM BY TERM against the golden pilot on the same
 * bank, because the pilot's 1.747 is the existence proof and the difference
 * between the two columns is, precisely, the list of things the search has not
 * learned yet. A term where the champion already matches the pilot is a term
 * that is finished; one where the pilot earns and the champion does not is the
 * gradient the search is failing to climb.
 */
"use strict";

const fs = require("fs");
const NN = require("./nn.js");
const SC = require("./scenarios.js");
const WM = require("./world.js");
const GT = require("./golden_test.js");

const args = {};
let file = null;
for (let i = 2; i < process.argv.length; i++) {
    const t = process.argv[i];
    if (t.startsWith("--")) args[t.slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) ? process.argv[++i] : "true";
    else if (!file) file = t;
}
const STAGE = Number(args.stage != null ? args.stage : 0);
const PER = Number(args.per || 12);

const bank = SC.examBank(PER).filter(s => s.stage === STAGE);
console.log(`stage ${STAGE} · ${SC.STAGES[STAGE].label} · ${bank.length} held-out scenarios\n`);

function fly(makePolicy) {
    const sums = {}, tally = {};
    let total = 0;
    for (const sc of bank) {
        const w = new WM.World(SC.makeScenario(sc.stage, sc.seed));
        const r = w.runEpisode(makePolicy());
        total += r.total;
        for (const k of Object.keys(r.parts)) sums[k] = (sums[k] || 0) + r.parts[k];
        const nm = WM.OUTCOME_NAME[r.outcome];
        tally[nm] = (tally[nm] || 0) + 1;
    }
    const n = bank.length;
    for (const k of Object.keys(sums)) sums[k] /= n;
    return { parts: sums, total: total / n, tally };
}

/* the existence proof */
const pilot = fly(() => {
    const p = GT.makePilot(GT.GAINS);
    return (w, o) => p(w, o);
});

/* the champion, if one was named */
let champ = null;
if (file) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const brain = NN.Brain.fromJSON(raw.brain || raw);
    console.log(`champion: ${file} · gen ${raw.gen} · ${brain.net.sizes.join("-")}\n`);
    champ = fly(() => {
        const pol = new NN.BrainPolicy(brain);
        pol.reset();
        return (w, o) => pol.act(w, o);
    });
}

const keys = Object.keys(pilot.parts);
console.log(`  ${"term".padEnd(12)}${"pilot".padStart(9)}${champ ? "champion".padStart(11) + "gap".padStart(9) : ""}`);
for (const k of keys) {
    const a = pilot.parts[k];
    let line = `  ${k.padEnd(12)}${a.toFixed(3).padStart(9)}`;
    if (champ) {
        const b = champ.parts[k] || 0;
        line += `${b.toFixed(3).padStart(11)}${(b - a).toFixed(3).padStart(9)}`;
    }
    console.log(line);
}
console.log(`  ${"TOTAL".padEnd(12)}${pilot.total.toFixed(3).padStart(9)}` +
    (champ ? `${champ.total.toFixed(3).padStart(11)}${(champ.total - pilot.total).toFixed(3).padStart(9)}` : ""));
console.log(`\n  pilot   : ${Object.entries(pilot.tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
if (champ) console.log(`  champion: ${Object.entries(champ.tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
