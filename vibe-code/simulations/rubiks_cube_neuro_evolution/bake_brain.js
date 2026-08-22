/* bake_brain.js — copy a trained champion into default_brain.js, which is what
 * the page loads.
 *
 *   node bake_brain.js                              # training/champion.json
 *   node bake_brain.js training/nightA/final.json
 *
 * Safe to re-run mid-run: train_headless.js rewrites champion.json every time the
 * champion improves.
 *
 * Nothing is written until the brain has been replayed on scrambles it never
 * trained on, alongside brains that never evolved, on those same scrambles. The
 * numbers in the file header are that validation and not the training score that
 * got the brain crowned — those are different quantities, and only one of them is
 * a claim about ability.
 *
 * The observation layout and architecture travel *with* the brain. A champion is a
 * set of weights against one exact input layout; hand it a different one and it
 * does not degrade, it reads garbage. The page reconfigures itself from what is
 * baked in here rather than assuming the current defaults still match, and this
 * script refuses to write a brain whose contract disagrees with its own config.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { load } = require("./load.js");
load();

const src = process.argv[2] || "training/champion.json";

/* Which global the baked file assigns to. Two brains can then be present on the page at
 * once — the evolved champion and the gradient-distilled one — and main.js picks
 * between them, instead of the comparison requiring somebody to overwrite a file and
 * reload. */
const GLOBAL = (() => {
    const i = process.argv.indexOf("--global");
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "DEFAULT_BRAIN";
})();
const OUTFILE = (() => {
    const i = process.argv.indexOf("--out");
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "default_brain.js";
})();
const file = path.isAbsolute(src) ? src : path.join(__dirname, src);
if (!fs.existsSync(file)) {
    console.error(`no such champion: ${file}`);
    process.exit(1);
}
const saved = JSON.parse(fs.readFileSync(file, "utf8"));
const cfg = resolveConfig(saved.config || "default");

/* Validation needs the oracle whatever the run's reward used, because the whole
 * measurement is "how much of the true distance did it remove". */
const env = new Env(Object.assign({}, cfg.env, { forceOracle: true, depthCapOverride: 8 }));
const desc = describeConfig(cfg, env);

const before = netFromJSON(saved);
if (before.contract() !== desc.contract) {
    console.error(`refusing to bake: brain is ${before.contract()} but its config says ${desc.contract}.`);
    process.exit(1);
}

/* Float32 carries about 7 significant decimal digits, so serialising 17 of them
 * triples the file for nothing. Round to 7 and check the network still answers
 * exactly the same — test_headless.js asserts this in general, but a specific
 * champion is worth confirming rather than assuming. */
const netJSON = saved.net || saved;
const trimmed = Object.assign({}, netJSON, {
    weights: netJSON.weights.map(w => w.map(v => Number(v.toPrecision(7)))),
});
const after = netFromJSON({ net: trimmed });
/* What has to survive rounding is the *policy*, not the activations.
 *
 * The original check was a 1e-6 absolute bound on the output vector, which is a
 * sensible size only while the output layer is tanh and therefore lives in [-1,1]. The
 * round-4 grid moved the head to a linear output, where activations run an order of
 * magnitude larger and seven significant digits legitimately shift them by ~1e-5 — so
 * a correct brain was refused for a tolerance that had silently become the wrong scale.
 * That is the same class of mistake as the saturated distance sensor: a constant that
 * encoded an assumption nobody restated when the assumption changed.
 *
 * So the bound is relative to the output magnitude, and the thing actually asserted is
 * that the argmax — the move the brain plays — is identical on every probe. A rounding
 * that moves an activation but never changes a decision cannot change a single
 * episode. */
let worst = 0, flips = 0, probes = 0;
const rng = mulberry32(20260818);
for (let t = 0; t < 400; t++) {
    const probe = new Float32Array(env.layout.size);
    for (let i = 0; i < probe.length; i++) {
        probe[i] = t === 0 ? Math.sin(i * 0.41) * 0.7 : rng() * 1.4 - 0.7;
    }
    const a = Array.from(before.forward(probe)), b = Array.from(after.forward(probe));
    let scale = 1e-9;
    for (let i = 0; i < a.length; i++) scale = Math.max(scale, Math.abs(a[i]));
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]) / scale);
    const am = a.indexOf(Math.max(...a)), bm = b.indexOf(Math.max(...b));
    if (am !== bm) flips++;
    probes++;
}
if (flips > 0 || worst > 1e-5) {
    console.error(`refusing to bake: rounding changed ${flips}/${probes} decisions ` +
        `(worst relative output change ${worst.toExponential(2)})`);
    process.exit(1);
}
console.log(`rounding check: ${probes} probes, 0 changed decisions, ` +
    `worst relative output change ${worst.toExponential(1)}`);

/* ---- validate on held-out scrambles, against untrained brains -------------- */
const DEPTHS = [1, 2, 3, 4, 5, 6, 7];
const GAMES = +(process.env.BAKE_GAMES || 200);
const banks = makeEvalBanks(env, DEPTHS, GAMES);
const val = evaluateBrain(env, after, banks);
const ctrl = controlScore(env, cfg.arch, banks, 8);

console.log(`config ${saved.configName || "default"} · ${desc.line}`);
console.log(`trained to generation ${saved.gen}, frontier depth ${saved.depth || "?"}\n`);
console.log(`validated on ${banks.reduce((s, x) => s + x.scrambles.length, 0)} scrambles it never trained on:`);
console.log(`  depth   evolved      untrained     evolved descent`);
val.byDepth.forEach((r, i) => {
    console.log(`    ${String(r.depth).padStart(2)}   ${(r.solveRate * 100).toFixed(1).padStart(6)}%   ` +
        `${(ctrl.byDepth[i].solveRate * 100).toFixed(1).padStart(9)}%   ${r.descent.toFixed(3).padStart(15)}`);
});
console.log(`  overall score ${val.score.toFixed(3)} vs ${ctrl.score.toFixed(3)} untrained ` +
    `(${ctrl.score > 0 ? (val.score / ctrl.score).toFixed(1) + "×" : "—"})`);
console.log(`  deepest rung solved at least half the time: ${val.depthAt50 || "none"}`);
console.log(`  undo rate ${(val.undoRate * 100).toFixed(1)}% of moves`);

if (val.score <= ctrl.score * 1.2) {
    console.log("\nWARNING: this champion is not meaningfully better than untrained noise.");
}

/* The provenance line is a claim about how these weights were found, and it has
 * to be true. Everything in this project is evolved; if a future round distils
 * from a teacher first, `saved.lineage` is where that has to be recorded and this
 * sentence has to change with it. */
const lineage = saved.lineage;
const prov = lineage && lineage.imitation
    ? ` * First fitted by supervised gradient descent to a teacher, then evolved a further\n` +
    ` * ${saved.gen} generations. NOT a purely evolved brain — see training notes.`
    : saved.distilled
        /* The header is the first thing anyone reads about a brain, and the interesting
         * claim in this project has always been *how the weights got there*. A distilled
         * net must not inherit a sentence saying there were no gradients. */
        ? ` * GRADIENT-TRAINED by distil.js: fitted to the oracle’s optimal moves by` +
            ` backpropagation,
 * then refined with DAgger on its own rollouts. This is NOT` +
            ` the project’s evolutionary
 * method — see the README. It reads the same` +
            ` rendered picture as the evolved brains
 * and takes the same eight actions;` +
            ` only the optimiser is different.`
    : ` * Evolved to generation ${saved.gen} by train_headless.js. No gradients, no backpropagation,\n` +
    ` * no move search: the reward function reads a breadth-first distance table, but the\n` +
    ` * network itself sees ${cfg.env.pixels ? "nothing but pixels" : "nothing but the facelet vector"}.`;

const rows = val.byDepth.map((r, i) =>
    ` *   ${String(r.depth).padStart(5)}  ${(r.solveRate * 100).toFixed(1).padStart(7)}%  ` +
    `${(ctrl.byDepth[i].solveRate * 100).toFixed(1).padStart(9)}%  ${r.descent.toFixed(3).padStart(9)}`
).join("\n");

const body = `/* default_brain.js — the built-in champion.
 *
 * Written by \`node bake_brain.js\`; do not hand-edit.
 *
 * Config: ${saved.configName || "default"} — reward "${cfg.env.reward}", ` +
    `${cfg.env.pixels ? `${desc.image} pixel image` : "facelet vector"} + ${desc.extras} extras.
 * Contract: ${desc.contract} (${desc.params.toLocaleString("en-US")} numbers).
 * Curriculum reached scramble depth ${saved.depth || "?"}.
${prov}
 *
 * Validated on ${GAMES} scrambles per depth that it never trained on, against
 * untrained brains played on those same scrambles:
 *
 *   depth   solved   untrained   descent
${rows}
 *
 * Overall score ${val.score.toFixed(3)} against ${ctrl.score.toFixed(3)} for untrained brains.
 * Deepest depth solved at least half the time: ${val.depthAt50 || "none"}.
 */
"use strict";
window.${GLOBAL} = ${JSON.stringify({
        net: trimmed,
        gen: saved.gen || 0,
        fitness: saved.fitness || 0,
        depth: saved.depth || 1,
        /* Provenance travels with the brain. A gradient-distilled net and an evolved
         * one are the same shape and the same file format, and the whole claim this
         * project makes is about how the weights got there — so the distinction has to
         * survive baking, not live only in a filename somebody can rename. */
        distilled: !!saved.distilled,
        configName: saved.configName || "default",
        config: saved.config || null,
        contract: desc.contract,
        validation: {
            games: GAMES, score: val.score, solveRate: val.solveRate, descent: val.descent,
            depthAt50: val.depthAt50, undoRate: val.undoRate, byDepth: val.byDepth,
            control: { score: ctrl.score, solveRate: ctrl.solveRate, byDepth: ctrl.byDepth },
        },
    })};
`;
/* Where to write. Defaults to default_brain.js, which is what the page loads; a
 * gradient-distilled brain is written beside it under its own name instead, so that
 * shipping one is a deliberate act rather than a side effect of baking it. */
fs.writeFileSync(path.join(__dirname, OUTFILE), body);
console.log(`\nbaked ${src} → ${OUTFILE} (gen ${saved.gen}, ${desc.contract})`);
