/* probe_failures.js — when it fails, how does it fail?
 *
 *   node probe_failures.js                          # newest champion
 *   node probe_failures.js training/armA/champion.json --games 300
 *
 * "58% at depth 3" is a number to report, not a number to act on. Two very
 * different champions produce it:
 *
 *   · one that plays the first move well and loses the thread later — a
 *     *horizon* problem, and the fix is memory, or credit that reaches further
 *     back, or simply more search;
 *   · one that gets the first move wrong on 40% of cubes — a *perception or
 *     capacity* problem at the root, and no amount of curriculum will help
 *     because it never gets started.
 *
 * Nothing in the training log distinguishes those. This does, by breaking the
 * failures apart along every axis that would imply a different next move:
 *
 *   1. where the failures end up (distance 1 away, or nowhere near)
 *   2. per-step accuracy against the oracle — does move 1 differ from move 4?
 *   3. first-move accuracy by depth — the cleanest test of "can it read a cube"
 *   4. the move mix, because a policy that has collapsed onto three of its eight
 *      actions is a diagnosis on its own
 *   5. whether failures cluster on particular scramble shapes
 *
 * The oracle is used freely here. This is analysis, not training; the policy still
 * sees only pixels.
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

const src = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : (() => {
    for (const c of ["training/armA/champion.json", "training/main2/champion.json"]) {
        if (fs.existsSync(path.join(__dirname, c))) return c;
    }
    return null;
})();
if (!src) { console.error("no champion found"); process.exit(1); }
const saved = JSON.parse(fs.readFileSync(path.join(__dirname, src), "utf8"));
const cfg = resolveConfig(saved.config || "default");
const env = new Env(Object.assign({}, cfg.env, { forceOracle: true, depthCapOverride: 7 }));
const net = netFromJSON(saved);
const GAMES = +arg("games", 250);
const DEPTHS = String(arg("depths", "2,3,4,5")).split(",").map(Number);

console.log(`${src} — gen ${saved.gen}, frontier depth ${saved.depth}, ` +
    `${net.paramCount.toLocaleString("en-US")} params`);
console.log(`${GAMES} held-out scrambles at each of depths ${DEPTHS.join(", ")}\n`);

/* How many of the 8 actions strictly reduce the distance from this state? A state
 * with only one correct move is harder than one with three, and if failures
 * concentrate on the single-answer states that is a capacity finding rather than a
 * perception one. */
function goodMoves(state) {
    const d = distanceOf(env.oracle, state);
    let n = 0;
    for (const m of env.set) if (distanceOf(env.oracle, applyMove(state, m)) === d - 1) n++;
    return n;
}

const perStepTotal = [], perStepGood = [];
const moveMix = new Float64Array(env.nMoves);
const rows = [];

for (const d of DEPTHS) {
    const bank = env.makeDepthBank(6600001 + d * 104729, GAMES, d);
    const endDist = new Map();
    let solved = 0, firstGood = 0, firstGoodOnSolved = 0, firstGoodOnFailed = 0;
    let failByAnswers = new Map(), allByAnswers = new Map();

    for (const scr of bank) {
        const run = env.newRunner(net, scr);
        const nAnswers = goodMoves(run.state);
        allByAnswers.set(nAnswers, (allByAnswers.get(nAnswers) || 0) + 1);

        let step = 0, first = null;
        while (!run.done) {
            const before = run.d;
            run.step();
            const improved = run.d < before;
            if (first === null) first = improved;
            perStepTotal[step] = (perStepTotal[step] || 0) + 1;
            if (improved) perStepGood[step] = (perStepGood[step] || 0) + 1;
            step++;
        }
        for (let i = 0; i < env.nMoves; i++) moveMix[i] += run.moveMix[i];

        if (first) firstGood++;
        if (run.solvedFlag) { solved++; if (first) firstGoodOnSolved++; }
        else {
            if (first) firstGoodOnFailed++;
            const k = Math.min(6, run.dBest);
            endDist.set(k, (endDist.get(k) || 0) + 1);
            failByAnswers.set(nAnswers, (failByAnswers.get(nAnswers) || 0) + 1);
        }
    }
    rows.push({
        depth: d, n: bank.length, solved, firstGood, firstGoodOnSolved, firstGoodOnFailed,
        endDist, failByAnswers, allByAnswers,
    });
}

/* ---- 1 & 3: solve rate, first-move accuracy, and where failures stall -------- */
console.log("1. first move, and where the failures get stuck");
console.log("   (closest reached, as a share of the failures at that depth)");
console.log("─".repeat(78));
console.log("  depth  solved  1st move right   |  failures stalling at distance 1 / 2 / 3+");
console.log("─".repeat(78));
for (const r of rows) {
    const fails = r.n - r.solved;
    const at = k => (fails ? (100 * (r.endDist.get(k) || 0) / fails).toFixed(0) + "%" : "—");
    const three = fails
        ? (100 * [...r.endDist.entries()].filter(([k]) => k >= 3).reduce((s, [, v]) => s + v, 0) / fails).toFixed(0) + "%"
        : "—";
    console.log(`   ${String(r.depth).padStart(2)}    ${(100 * r.solved / r.n).toFixed(0).padStart(4)}%   ` +
        `${(100 * r.firstGood / r.n).toFixed(0).padStart(11)}%   |  ` +
        `${at(1).padStart(4)} / ${at(2).padStart(4)} / ${three.padStart(4)}`);
}
console.log("─".repeat(78));

console.log("\n   first move split by outcome — if these two are far apart, the first move");
console.log("   decides the episode; if they are close, the failure happens later:");
for (const r of rows) {
    const fails = r.n - r.solved;
    console.log(`     depth ${r.depth}: right on ` +
        `${r.solved ? (100 * r.firstGoodOnSolved / r.solved).toFixed(0) : "—"}% of solves, ` +
        `${fails ? (100 * r.firstGoodOnFailed / fails).toFixed(0) : "—"}% of failures`);
}

/* ---- 2: per-step accuracy --------------------------------------------------- */
console.log("\n2. share of moves that reduced the true distance, by move number");
console.log("   (pooled over all depths; a flat line means no horizon problem)");
const maxStep = Math.min(12, perStepTotal.length);
let line = "   ", pct = "   ";
for (let i = 0; i < maxStep; i++) {
    line += String(i + 1).padStart(6);
    pct += ((100 * (perStepGood[i] || 0) / perStepTotal[i]).toFixed(0) + "%").padStart(6);
}
console.log("   move:" + line.slice(3));
console.log("   good:" + pct.slice(3));

/* ---- 4: move mix ----------------------------------------------------------- */
console.log("\n3. move mix — a policy collapsed onto a few actions is its own diagnosis");
let tot = 0;
for (let i = 0; i < env.nMoves; i++) tot += moveMix[i];
console.log("   " + env.set.map((m, i) =>
    `${m.name} ${(100 * moveMix[i] / tot).toFixed(0)}%`).join("   "));
const used = Array.from(moveMix).filter(v => v / tot > 0.02).length;
console.log(`   ${used} of ${env.nMoves} actions used more than 2% of the time` +
    (used < env.nMoves ? " — the rest are effectively dead" : ""));

/* ---- 5: does difficulty explain the failures? ------------------------------- */
console.log("\n4. failure rate against how many of the 8 moves were correct at the start");
console.log("   (a state with one right answer is harder than one with three)");
console.log("   answers   scrambles   failed");
const answerKeys = new Set();
for (const r of rows) for (const k of r.allByAnswers.keys()) answerKeys.add(k);
for (const k of [...answerKeys].sort((a, b) => a - b)) {
    let all = 0, bad = 0;
    for (const r of rows) { all += r.allByAnswers.get(k) || 0; bad += r.failByAnswers.get(k) || 0; }
    if (!all) continue;
    console.log(`      ${String(k).padStart(2)}     ${String(all).padStart(8)}   ` +
        `${(100 * bad / all).toFixed(0).padStart(5)}%`);
}

/* ---- the read ------------------------------------------------------------- */
const mid = rows.find(r => r.depth === 3) || rows[0];
const fails = mid.n - mid.solved;
const nearMiss = fails ? (mid.endDist.get(1) || 0) / fails : 0;
const firstSplit = mid.solved && fails
    ? (mid.firstGoodOnSolved / mid.solved) - (mid.firstGoodOnFailed / fails) : 0;
console.log(`\n${"═".repeat(72)}`);
console.log(`at depth ${mid.depth}: ${(100 * nearMiss).toFixed(0)}% of failures got to within one move ` +
    `of solved,`);
console.log(`and the first move was right ${(100 * firstSplit).toFixed(0)} points more often on ` +
    `solves than on failures.`);
if (nearMiss > 0.5) {
    console.log(`\nMostly LAST-STEP failures. It finds its way to the doorstep and cannot`);
    console.log(`take the final turn — look at what distinguishes a distance-1 cube, and at`);
    console.log(`whether the reward pays for the last step as much as for the first.`);
} else if (firstSplit > 0.3) {
    console.log(`\nMostly FIRST-MOVE failures. The episode is largely decided before it`);
    console.log(`starts, which points at perception or capacity rather than horizon — more`);
    console.log(`generations will not fix a cube it cannot read.`);
} else {
    console.log(`\nFailures are spread through the episode rather than concentrated at`);
    console.log(`either end: it degrades gradually rather than falling off a specific cliff.`);
}
