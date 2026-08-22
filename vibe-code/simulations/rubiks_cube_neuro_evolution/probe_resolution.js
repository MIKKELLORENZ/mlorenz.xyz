/* probe_resolution.js — can selection even see the improvement you are hoping for?
 *
 *   node probe_resolution.js                       # uses training/main/champion.json
 *   node probe_resolution.js training/x/champion.json --episodes 48
 *
 * Ten minutes of arithmetic that decides whether a stalled run is *search-limited*
 * (selection can see the gain but has not found it — tune the GA) or
 * *signal-limited* (selection cannot see it — no number of generations will help,
 * and the fix is a bigger bank or a denser reward). The two need opposite responses
 * and look identical from the fitness curve, which is why this exists as a tool
 * rather than as a paragraph of advice.
 *
 * What it measures:
 *
 *  1. **Per-episode standard deviation of the fitness.** The resolution of a
 *     bank of N episodes is sd/√N — that is the smallest true difference between
 *     two brains that the comparison can distinguish from noise. If a plausible
 *     improvement is worth less than that, the GA is choosing at random among its
 *     top candidates and promotions will not accumulate.
 *
 *  2. **The same brain, re-scored on independent banks.** If re-measuring one
 *     unchanged brain swings by as much as the gap between candidates, the run is
 *     ranking luck. This is the symptom that is easiest to check and most often
 *     skipped.
 *
 *  3. **Decisions per episode against scalars per episode.** Twenty moves inside
 *     one episode collapse into one number; that ratio bounds how fine a skill
 *     selection can ever resolve, whatever the bank size.
 *
 *  4. **How much a small mutation actually changes fitness**, measured on a large
 *     common bank. This is the size of the thing selection is trying to detect, so
 *     comparing it against (1) is the whole verdict.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { load } = require("./load.js");
load();

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}

const src = process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2] : "training/main/champion.json";
const file = path.isAbsolute(src) ? src : path.join(__dirname, src);
if (!fs.existsSync(file)) { console.error("no such champion: " + file); process.exit(1); }
const saved = JSON.parse(fs.readFileSync(file, "utf8"));
const cfg = resolveConfig(saved.config || "default");
const env = new Env(Object.assign({}, cfg.env, { forceOracle: true }));
const net = netFromJSON(saved);
const DEPTH = +arg("depth", saved.depth || 2);
const EPISODES = +arg("episodes", cfg.episodes);
const BIG = +arg("big", 600);

console.log(`champion: gen ${saved.gen}, frontier depth ${saved.depth}, ` +
    `${net.paramCount.toLocaleString("en-US")} params, reward "${cfg.env.reward}"`);
console.log(`run's bank: ${EPISODES} episodes per brain, diet up to depth ${DEPTH}\n`);

/* ---- 1. per-episode spread, split by where it comes from -------------------
 *
 * The naive resolution estimate is sd/√N over all episodes, and it is pessimistic
 * here because the banks are *stratified*: every bank has the identical number of
 * episodes at each depth, so the between-depth part of the variance — depth-1 cubes
 * simply pay better than depth-2 cubes — never appears in the bank-to-bank spread.
 * Only the within-depth part does. Reporting both makes the value of stratifying
 * visible instead of assumed, and section 2 checks the prediction. */
const big = env.makeBank(777001, BIG, DEPTH);
const per = [], byDepth = new Map();
for (const scr of big) {
    const r = env.runEpisode(net, scr).reward;
    per.push(r);
    if (!byDepth.has(scr.depth)) byDepth.set(scr.depth, []);
    byDepth.get(scr.depth).push(r);
}
const mean = per.reduce((a, b) => a + b, 0) / per.length;
const sd = Math.sqrt(per.reduce((s, x) => s + (x - mean) ** 2, 0) / (per.length - 1));

/* Within-depth variance, pooled with the stratified bank's own depth weights —
 * which is exactly the variance a stratified draw leaves behind. */
const counts = env.depthCounts(EPISODES, DEPTH);
let stratVar = 0;
for (const [d, xs] of byDepth) {
    const n = counts[d - 1] || 0;
    if (!n || xs.length < 2) continue;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
    /* each depth contributes v/n to the variance of the bank mean, and the bank
     * mean weights that depth by n/N */
    stratVar += (n / EPISODES) ** 2 * (v / n);
}
const naiveRes = sd / Math.sqrt(EPISODES);
const resolution = Math.sqrt(stratVar);
console.log(`1. per-episode fitness: mean ${mean.toFixed(3)}, sd ${sd.toFixed(3)} ` +
    `(over ${BIG} episodes)`);
for (const [d, xs] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
    console.log(`     depth ${d}: mean ${m.toFixed(3)}, sd ${v.toFixed(3)}  (${xs.length} episodes)`);
}
console.log(`   → an unstratified ${EPISODES}-episode bank would resolve ±${naiveRes.toFixed(3)}`);
console.log(`   → the stratified bank actually used resolves ±${resolution.toFixed(3)} ` +
    `(${(100 * resolution / Math.max(1e-9, mean)).toFixed(1)}% of the mean) — ` +
    `${(naiveRes / Math.max(1e-9, resolution)).toFixed(2)}× better for free`);

/* ---- 2. the same brain, re-scored on independent banks --------------------- */
const reps = [];
for (let i = 0; i < 12; i++) {
    reps.push(env.scoreBrain(net, env.makeBank(910001 + i * 7919, EPISODES, DEPTH)).fitness);
}
const rMean = reps.reduce((a, b) => a + b, 0) / reps.length;
const rSd = Math.sqrt(reps.reduce((s, x) => s + (x - rMean) ** 2, 0) / (reps.length - 1));
console.log(`\n2. one unchanged brain, re-scored on 12 independent ${EPISODES}-episode banks:`);
console.log(`   ${reps.map(x => x.toFixed(2)).join("  ")}`);
console.log(`   spread: ${Math.min(...reps).toFixed(3)} … ${Math.max(...reps).toFixed(3)}, ` +
    `sd ${rSd.toFixed(3)}  (predicted ${resolution.toFixed(3)})`);

/* ---- 3. information per episode -------------------------------------------- */
const meanMoves = big.reduce((s, scr) => s + env.runEpisode(net, scr).moves, 0) / big.length;
console.log(`\n3. ${meanMoves.toFixed(1)} decisions per episode collapse into 1 fitness scalar.`);
console.log(`   ${EPISODES} episodes → ${(EPISODES * meanMoves).toFixed(0)} decisions ` +
    `judged by ${EPISODES} numbers.`);

/* ---- 4. what a mutation is worth, swept over step size ---------------------
 *
 * Measured on one large common bank, paired: the same scrambles for the parent and
 * every child, so a difference is a difference between brains.
 *
 * Swept over σ rather than measured at one value, because "one value" is the trap.
 * The first version of this probe used `cfg.ga.mutSigma` — 0.22 — and reported that
 * 0 of 20 children were better and the best was 0.78 *worse*, which reads as a
 * champion sitting on a knife edge. It is not what the run does. The trainer
 * multiplies that config number by the annealing scale (~0.12 by this point) and
 * then by the genome's own self-adapted multiplier (~0.19), so the step actually
 * being taken is nearer 0.005 — forty times smaller than what the probe applied.
 * A probe that does not reproduce the operator under test measures a different
 * algorithm and answers confidently about it. */
const parentFit = mean;
const K = +arg("children", 24);
const effSigma = cfg.ga.mutSigma * (+arg("anneal", 0.12)) * (+arg("selfsigma", 0.19));
const SIGMAS = [effSigma * 0.25, effSigma * 0.5, effSigma, effSigma * 2, effSigma * 4, cfg.ga.mutSigma];
console.log(`\n4. mutated children on the same ${BIG} episodes, swept over step size`);
console.log(`   (the run's effective σ right now is about ${effSigma.toFixed(4)}: ` +
    `config ${cfg.ga.mutSigma} × anneal × the genome's own multiplier)`);
let bestOverall = { sigma: 0, delta: -Infinity, better: 0 };
for (const sg of SIGMAS) {
    const deltas = [];
    for (let i = 0; i < K; i++) {
        const child = net.clone().mutate(cfg.ga.mutRate, sg, mulberry32(50001 + i * 131));
        let f = 0;
        for (const scr of big) f += env.runEpisode(child, scr).reward;
        deltas.push(f / big.length - parentFit);
    }
    deltas.sort((a, b) => b - a);
    const better = deltas.filter(d => d > 0).length;
    console.log(`   σ ${sg.toFixed(4)}:  ${String(better).padStart(2)}/${K} better,  ` +
        `best ${deltas[0] >= 0 ? "+" : ""}${deltas[0].toFixed(3)},  ` +
        `median ${deltas[Math.floor(K / 2)].toFixed(3)}`);
    if (deltas[0] > bestOverall.delta) bestOverall = { sigma: sg, delta: deltas[0], better };
}

/* ---- 5. how much of the damage is the weight-reset branch? -----------------
 *
 * `mutate` throws a mutated weight away and redraws it from N(0, 0.5) with
 * probability MUT_RESET (3% by default). At rate 0.10 over 5,008 weights that is
 * about fifteen weights per child replaced by large random numbers — and this
 * network's decision is an argmax over eight outputs that sit inside a narrow
 * band, so fifteen wild weights do not nudge the policy, they replace it.
 *
 * The received wisdom in this codebase, written down after a distilled Tetris brain
 * lost 60% of its skill to exactly this, was that the reset branch is nonetheless
 * *safe for evolved populations* because every survivor was selected under it. This
 * measurement says that holds early and stops holding once a champion is precise:
 * late in a run the reset branch becomes the dominant destructive force and most of
 * the population's children are wasted on it. Worth re-measuring per project rather
 * than inheriting either belief. */
const RESET_DEFAULT = 0.03;
console.log(`\n5. the same children with the weight-reset branch on and off ` +
    `(rate ${cfg.ga.mutRate}, σ ${effSigma.toFixed(4)}):`);
const resetRows = [];
for (const reset of [RESET_DEFAULT, 0]) {
    setMutReset(reset);
    const ds = [];
    for (let i = 0; i < K * 2; i++) {
        const child = net.clone().mutate(cfg.ga.mutRate, effSigma, mulberry32(9000 + i * 331));
        let f = 0;
        for (const scr of big) f += env.runEpisode(child, scr).reward;
        ds.push(f / big.length - parentFit);
    }
    ds.sort((a, b) => b - a);
    const row = {
        reset, better: ds.filter(d => d > 1e-9).length, n: ds.length,
        best: ds[0], median: ds[Math.floor(ds.length / 2)],
    };
    resetRows.push(row);
    console.log(`   reset ${reset.toFixed(2)}:  ${String(row.better).padStart(2)}/${row.n} better,  ` +
        `best ${row.best >= 0 ? "+" : ""}${row.best.toFixed(3)},  median ${row.median.toFixed(3)}`);
}
setMutReset(RESET_DEFAULT);
const [withR, withoutR] = resetRows;
if (withR.median < withoutR.median - 1e-6) {
    const factor = withR.median / Math.min(-1e-9, withoutR.median);
    console.log(`   → the reset branch accounts for ${(100 * (1 - withoutR.median / withR.median)).toFixed(0)}% ` +
        `of the median child's loss (${factor.toFixed(1)}× more destructive with it on).`);
    console.log(`     Run with --mut-reset 0.005 or lower once the champion is this precise.`);
}
if (withoutR.best > bestOverall.delta) {
    bestOverall = { sigma: effSigma, delta: withoutR.best, better: withoutR.better };
}

/* ---- the verdict ----------------------------------------------------------- */
const prize = bestOverall.delta;
console.log(`\n${"═".repeat(72)}`);
if (prize <= 0) {
    console.log(`No step size tried produced a single child better than the parent.`);
    console.log(`That is not a measurement problem — it is the operator. Either this`);
    console.log(`champion is at a local optimum that mutation alone cannot leave, or the`);
    console.log(`step sizes swept are all wrong for it. Widen the sweep before concluding`);
    console.log(`anything about the bank size.`);
} else {
    const ratio = prize / resolution;
    console.log(`the best available improvement is worth +${prize.toFixed(3)} ` +
        `(at σ ${bestOverall.sigma.toFixed(4)}, ${bestOverall.better}/${K} children better);`);
    console.log(`the ${EPISODES}-episode stratified bank resolves ±${resolution.toFixed(3)}.  ` +
        `ratio ${ratio.toFixed(2)}×`);
    if (ratio < 1) {
        console.log(`\nSIGNAL-LIMITED. The prize is smaller than the noise, so the generation's`);
        console.log(`winner is mostly whoever drew the easier cubes, and more generations will`);
        console.log(`not help. Raise episodes per brain — resolution improves as √N, and`);
        console.log(`trading population for episodes keeps the compute constant — or find a`);
        console.log(`denser per-decision reward.`);
        console.log(`\nTo resolve this prize at 1σ: about ` +
            `${Math.ceil(EPISODES * (resolution / prize) ** 2)} episodes per brain.`);
    } else if (ratio < 2.5) {
        console.log(`\nMARGINAL. Selection can just about see the best child, so it is right`);
        console.log(`somewhat more often than chance and progress will be slow and noisy.`);
        console.log(`About ${Math.ceil(EPISODES * (2.5 * resolution / prize) ** 2)} episodes ` +
            `per brain would put it on comfortable ground.`);
    } else {
        console.log(`\nSEARCH-LIMITED. Selection can see the improvement clearly, so a stall is`);
        console.log(`the search failing to find it — tune the GA, not the measurement.`);
    }
}
