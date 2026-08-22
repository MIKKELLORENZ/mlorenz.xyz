/* duel.js — a paired comparison between two policies, reported as Δ ± SE.
 *
 * Bare scores are not comparable across runs and ranking N candidates is itself
 * selection, so the ship/no-ship call needs its own measurement: both policies
 * flown over the SAME episodes (common random numbers), the difference taken
 * per episode, and the standard error computed on the differences rather than
 * on the two means independently. Pairing removes the episode-difficulty
 * variance that dominates everything else here — the same variance that makes
 * an unpaired 400-episode comparison nearly useless.
 *
 *   node vtest/duel.js A.json B.json [n] [stage]
 */
"use strict";
const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const GOLD = require("../golden_test.js");
const fs = require("fs");

const N = Number(process.argv[4] || 400);
const STAGE = Number(process.argv[5] || 0);

function policyFor(spec) {
    if (spec === "pilot") return { name: "golden pilot", mk: () => GOLD.makePilot(GOLD.GAINS) };
    const raw = JSON.parse(fs.readFileSync(spec, "utf8"));
    const brain = NN.Brain.fromJSON(raw.brain || raw);
    const lags = raw.lags || (brain.spec.nin === 139 ? [2, 10, 35] : null);
    return { name: `${spec} (gen ${raw.gen != null ? raw.gen : "?"}, ${brain.spec.nin} in)`,
             mk: () => { const p = new NN.BrainPolicy(brain, { lags }); p.reset(); return (w, o) => p.act(w, o); } };
}

const A = policyFor(process.argv[2]);
const B = policyFor(process.argv[3]);

const da = [], db = [];
let ca = 0, cb = 0;
const ta = {}, tb = {};
for (let i = 0; i < N; i++) {
    const seed = 9500000 + i * 7919;          // untouched by tuning or DAgger
    for (const [P, arr, tally, which] of [[A, da, ta, "a"], [B, db, tb, "b"]]) {
        const w = new WM.World(SC.makeScenario(STAGE, seed));
        const r = w.runEpisode(P.mk());
        arr.push(r.total);
        const nm = WM.OUTCOME_NAME[r.outcome];
        tally[nm] = (tally[nm] || 0) + 1;
        if (nm === "caught") { which === "a" ? ca++ : cb++; }
    }
}
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const diff = da.map((v, i) => v - db[i]);
const md = mean(diff);
const sd = Math.sqrt(diff.reduce((p, q) => p + (q - md) * (q - md), 0) / (diff.length - 1));
const se = sd / Math.sqrt(diff.length);

console.log(`paired over ${N} identical stage-${STAGE} episodes (seeds 9.5e6+, untouched)\n`);
console.log(`  A  ${A.name}`);
console.log(`     mean ${mean(da).toFixed(4)}   caught ${ca}/${N}   ` + Object.entries(ta).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(", "));
console.log(`  B  ${B.name}`);
console.log(`     mean ${mean(db).toFixed(4)}   caught ${cb}/${N}   ` + Object.entries(tb).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(", "));
console.log(`\n  A - B = ${md >= 0 ? "+" : ""}${md.toFixed(4)} +/- ${se.toFixed(4)}   (t = ${(md / se).toFixed(1)})`);
console.log(`  catches ${ca} vs ${cb}`);
console.log(`  ${Math.abs(md) > 2 * se ? (md > 0 ? "A is better" : "B is better") : "no significant difference"}`);
