/* evaluate.js — one yardstick, used by everything that compares two brains.
 *
 * ─── why this cannot be the training reward ────────────────────────────────
 *
 * The grid search puts ten reward functions side by side. Scoring each run on
 * its own reward would rank the rewards by how generous they are, not by how good
 * the brains they produced are — and worse, a reward with an exploitable hole
 * would sail through its own examination with the highest mark in the room. The
 * `optimalFrac` variant in rewards.js exists precisely to be caught doing that,
 * and it can only be caught by a measure it does not control.
 *
 * So every comparison in this project — the grid search, the promotion gate, the
 * validation in bake_brain.js, the page's self-test — comes back here:
 *
 *   solve rate, and how much of the true distance was removed, on scrambles
 *   nothing trained on, at each depth separately.
 *
 * Reported per depth rather than pooled, because a pooled number is a weighted
 * average over whatever depth mix the bank happened to have, and two runs whose
 * ratchets reached different frontiers do not have the same mix. A single scalar
 * is provided for sorting, and it is a weighted sum with the weights written down
 * where they can be argued with.
 *
 * ─── common random numbers ─────────────────────────────────────────────────
 *
 * The scrambles are built once and handed to every brain. On a task where the
 * per-episode outcome is nearly binary, which cubes you drew swamps which brain
 * you are — the chess project in this folder measured shared episodes as the
 * single biggest accuracy win available. `makeEvalBanks` therefore takes a
 * reference Env and the resulting banks are passed to brains whose own Env may
 * have a different observation layout entirely. That is safe because a scramble is
 * a cube, a true distance and a move budget; nothing about it depends on how the
 * brain looking at it sees the world.
 */
"use strict";

/* Fixed, and deliberately far from every seed the trainer, the gate and the
 * ratchet use. A yardstick that has been optimised against is not a yardstick. */
const EVAL_SEED_BASE = 88000001;

function makeEvalBanks(refEnv, depths, gamesPerDepth, seedBase) {
    const base = (seedBase === undefined ? EVAL_SEED_BASE : seedBase) >>> 0;
    const banks = [];
    for (const d of depths) {
        if (d > refEnv.depthCap) continue;
        const rng = mulberry32((base + d * 104729) >>> 0);
        const list = [];
        for (let i = 0; i < gamesPerDepth; i++) {
            const { state } = scramble(rng, d, refEnv.set);
            const d0 = refEnv.oracle ? distanceOf(refEnv.oracle, state) : d;
            list.push({ state: state.slice(), depth: d, d0, budget: refEnv.budgetFor(d0) });
        }
        banks.push({ depth: d, scrambles: list });
    }
    return banks;
}

/* Weights for the single sortable scalar.
 *
 * Solve rate dominates because solving is the task. Descent is kept at 30%
 * because early in a run, and at the deeper rungs late in a run, the solve rate
 * is zero for every candidate and a ranking on zeros is a ranking on nothing —
 * descent is what distinguishes a brain that gets a depth-6 cube to distance 1
 * from one that wanders. Depth weight grows linearly, so clearing a deeper rung
 * is worth more than polishing a shallow one, but not so steeply that a lucky
 * deep solve outweighs competence everywhere else. */
function evalScore(byDepth) {
    let num = 0, den = 0;
    for (const r of byDepth) {
        const w = r.depth;
        num += w * (0.7 * r.solveRate + 0.3 * r.descent);
        den += w;
    }
    return den ? num / den : 0;
}

function evaluateBrain(env, net, banks) {
    const byDepth = [];
    let solved = 0, n = 0, descent = 0, moves = 0, undos = 0, totalMoves = 0;
    for (const b of banks) {
        let s = 0, dsc = 0, mv = 0, ud = 0;
        for (const scr of b.scrambles) {
            const tr = env.runEpisode(net, scr);
            if (tr.solved) s++;
            dsc += tr.d0 > 0 ? (tr.d0 - tr.dBest) / tr.d0 : 1;
            mv += tr.moves;
            ud += tr.undos;
        }
        const k = b.scrambles.length;
        byDepth.push({
            depth: b.depth, n: k, solveRate: s / k, descent: dsc / k,
            movesWhenSolved: mv / k,
        });
        solved += s; n += k; descent += dsc; moves += mv; undos += ud; totalMoves += mv;
    }
    return {
        byDepth,
        solveRate: n ? solved / n : 0,
        descent: n ? descent / n : 0,
        movesPerEpisode: n ? moves / n : 0,
        undoRate: totalMoves ? undos / totalMoves : 0,
        score: evalScore(byDepth),
        /* Deepest rung it clears at least half the time — the most legible single
         * claim that can be made about a cube solver, and the one the README
         * headline uses. */
        depthAt50: byDepth.reduce((best, r) => (r.solveRate >= 0.5 ? r.depth : best), 0),
    };
}

/* Untrained brains on the identical scrambles. Every claim about a champion in
 * this project is a claim relative to this: "it solves 60% of depth-3 cubes" is
 * only interesting once you know that random weights solve 4% of them, and on a
 * puzzle with eight actions and a shallow curriculum that baseline is not zero. */
function controlScore(env, arch, banks, nBrains, seed) {
    const acc = { solveRate: 0, descent: 0, score: 0, byDepth: [] };
    const k = nBrains || 8;
    for (let i = 0; i < k; i++) {
        const net = buildNet(arch, env.layout, mulberry32((seed || 4242) + i * 7919));
        const r = evaluateBrain(env, net, banks);
        acc.solveRate += r.solveRate / k;
        acc.descent += r.descent / k;
        acc.score += r.score / k;
        r.byDepth.forEach((d, j) => {
            if (!acc.byDepth[j]) acc.byDepth[j] = { depth: d.depth, n: d.n, solveRate: 0, descent: 0 };
            acc.byDepth[j].solveRate += d.solveRate / k;
            acc.byDepth[j].descent += d.descent / k;
        });
    }
    return acc;
}

/* Standard error of a per-episode mean, for the Δ ± SE the confirmation stage
 * reports. Paired over the same scrambles, so the difference of two brains has a
 * smaller SE than either brain's own — which is the whole point of reusing the
 * bank. */
function pairedDelta(env, netA, netB, banks) {
    const diffs = [];
    for (const b of banks) {
        for (const scr of b.scrambles) {
            const a = env.runEpisode(netA, scr);
            const c = env.runEpisode(netB, scr);
            const sa = 0.7 * (a.solved ? 1 : 0) + 0.3 * (a.d0 > 0 ? (a.d0 - a.dBest) / a.d0 : 1);
            const sb = 0.7 * (c.solved ? 1 : 0) + 0.3 * (c.d0 > 0 ? (c.d0 - c.dBest) / c.d0 : 1);
            diffs.push(sa - sb);
        }
    }
    const n = diffs.length;
    const mean = diffs.reduce((s, x) => s + x, 0) / n;
    const varr = diffs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, n - 1);
    return { n, delta: mean, se: Math.sqrt(varr / n) };
}
