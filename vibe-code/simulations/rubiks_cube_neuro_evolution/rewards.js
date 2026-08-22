/* rewards.js — the ten candidate reward functions, and why the obvious one is
 * the worst one.
 *
 * ─── the arithmetic that decides this, done before any long run ────────────
 *
 * A reward function is a measuring instrument, and the question to ask of it is
 * not "does it point the right way" but "can selection *see* the improvement I
 * am hoping for". Two numbers settle it: how many distinguishable values the
 * reward takes on a single episode, and how much of the spread between two
 * brains is signal rather than which scrambles they happened to draw.
 *
 * On this puzzle the count is brutal. A binary solved/not-solved reward is one
 * bit per episode against twenty decisions inside it. At a 5% solve rate, a
 * 48-episode bank resolves the solve rate to ±3 points — so a brain that is
 * genuinely 1.5 points better than the champion is invisible, and the GA spends
 * its generations promoting luck. That is the signal-limited regime, and no
 * amount of population or mutation tuning escapes it.
 *
 * ─── sticker count: the flaw is real, the consequence milder than it looks ──
 *
 * The reflex is "count correctly-placed stickers" — dense, cheap, no oracle. It has
 * a genuine blind spot, and it is worth stating precisely, because the obvious
 * strong version of the claim turns out to be wrong.
 *
 * Turn U once. All nine U stickers are white and they stay on the U face, so
 * they are all still correct. What moves is the top row of F, R, B and L —
 * twelve stickers, all now wrong. Score: 42/54.
 * Turn U again. Those same twelve stickers move to different wrong faces.
 * Score: 42/54.
 * Turn U a third time (= U' from solved). Score: 42/54.
 *
 * So one move from solved, two moves from solved, and one move the *other* way are
 * worth exactly the same. Sticker count cannot distinguish U from U2 from U'.
 *
 * The tempting conclusion — "so it carries no information and the fitness curve is
 * measuring nothing" — is not what happens, and probe_rewards.js was written to
 * settle it. Measured as an *instrument*, by how faithfully it ranks thirty policies
 * of differing quality against held-out ground truth, sticker count scores a
 * Spearman correlation of 0.99 at depth 1 and 0.88 at depth 6. It degrades, in the
 * predicted direction and for the predicted reason, but gradually: the blind spot
 * costs about a tenth of a rank correlation over five rungs, not everything.
 *
 * Two consequences, both of which changed how this project reads its own results.
 *
 *  · At shallow depth the choice of reward barely matters. At depth 1–2 the only
 *    distinction that exists is "did it solve", and every reward below sees that —
 *    which is why the reward grid, whose budget stops around depth 2, reports its
 *    twelve cells inside a narrow band. That is a true statement about a budget, not
 *    a null result about rewards.
 *  · The reward that actually fails is not this one. It is the farmable variant
 *    described below, whose correlation collapses from 0.99 to 0.27 over the same
 *    depths.
 *
 * `stickers`, `bestStickers`, `progress` and `faces` also stay on their merits: they
 * need no oracle, so they are the only options past its radius.
 *
 * ─── what actually carries signal ─────────────────────────────────────────
 *
 * The true distance to solved, from the BFS table in cube.js. It is scaffolding
 * for training and it ships nowhere: the network's input is pixels and only
 * pixels, exactly as the Dellacherie oracle in the Tetris project labels
 * training data and never appears at play time. The reward may read privileged
 * state; the policy may not.
 *
 * One fact about the graph makes the distance rewards clean. These generators
 * flip corner-permutation parity, so the Cayley graph is bipartite and **every
 * move changes the true distance by exactly ±1** — never zero. There is no
 * "sideways" move to hide in, so "how many times did it set a new personal best"
 * and "how much closer did it get" are the same number, and neither can be
 * farmed by oscillating.
 *
 * ─── one variant is deliberately exploitable ──────────────────────────────
 *
 * `optimalFrac` scores the fraction of moves that reduced the distance. It looks
 * like the ideal dense per-decision signal and it is farmable: U then U' is one
 * reducing move in two, so a brain that oscillates forever banks 0.5 without
 * ever going anywhere — the same shape of bug as scoring a rocket for merely
 * existing. It is kept in the table because a reward economy's failure modes
 * should be demonstrated, not asserted, and because it is the variant a person
 * would reach for first.
 *
 * It is also the one variant that measurably breaks, and it breaks worse the deeper
 * the cube gets — rank correlation with ground truth 0.99, 0.95, 0.88, 0.75, 0.51,
 * 0.27 across depths 1 to 6. That gradient is the exploit becoming available: a
 * depth-1 cube has almost no room to oscillate in, and a depth-6 cube has plenty. A
 * reward whose hole opens up exactly as the task gets harder is the worst possible
 * shape for a curriculum, and it would have been invisible at the depth the training
 * grid can afford to reach.
 */
"use strict";

/* Shared shaping parameters. Every variant gets them so the grid search can
 * sweep the same three knobs across all ten rather than baking a different
 * hand-tuned constant into each. */
const REWARD_DEFAULTS = {
    solveBonus: 1.0,      // paid once, on reaching the solved cube
    speedBonus: 0.5,      // × unused fraction of the move budget, only if solved
    stepCost: 0.0,        // × moves used — pressure toward short solutions
    undoPenalty: 0.0,     // × moves that immediately undid the previous move
    gamma: 0.9,           // discount for the "progress early" variants
    /* funnel only */
    structW: 0.45,        // ceiling for a cube that never entered the oracle's ball
    ballBonus: 0.15,      // paid for entering it at all -- the gap that orders the regimes
};

/* Sticker counts run 6..54 because the six centre facelets never move. Mapping
 * to 0..1 over the 48 that *can* be wrong keeps the scale comparable to the
 * distance variants, which matters when the grid search puts them side by side. */
const stickFrac = s => (s - 6) / 48;
/* Matched adjacent pairs, 72 on a solved cube. See pairScore in cube.js. */
const pairFrac = n => n / 72;

/* Every variant is  base(trace) + the shared terms, so the shared terms are
 * written once. `base` is expected to land in roughly 0..1 for a solve. */
function shell(base) {
    return (tr, p) => {
        let r = base(tr, p);
        if (tr.solved) {
            r += p.solveBonus;
            r += p.speedBonus * (tr.budget - tr.moves) / tr.budget;
        }
        r -= p.stepCost * tr.moves;
        r -= p.undoPenalty * tr.undos;
        return r;
    };
}

const REWARDS = {
    /* ---------------------------------------------------- no oracle needed */

    solved: {
        oracle: false,
        note: "1 if solved, 0 otherwise. The sparse control: correct, unfarmable, " +
            "and one bit per episode against twenty decisions inside it.",
        fn: shell(() => 0),
    },

    stickers: {
        oracle: false,
        note: "fraction of the 48 movable facelets that are home, at the end. Dense " +
            "and flat — cannot tell U from U2 from U'.",
        fn: shell(tr => stickFrac(tr.sFinal)),
    },

    bestStickers: {
        oracle: false,
        note: "the same, but the best value reached at any point. Removes the " +
            "'found it then wandered off' noise; keeps the blindness.",
        fn: shell(tr => stickFrac(tr.sBest)),
    },

    progress: {
        oracle: false,
        note: "improvement in sticker count over the scramble it was handed, so an " +
            "easy scramble is not worth more than a hard one. Can go negative.",
        fn: shell(tr => stickFrac(tr.sBest) - stickFrac(tr.s0)),
    },

    faces: {
        oracle: false,
        note: "completed faces (the human's idea of progress), with stickers as a " +
            "tie-break.",
        fn: shell(tr => 0.6 * (tr.facesBest / 6) + 0.4 * stickFrac(tr.sBest)),
    },

    /* Pay more for solving a hard cube than an easy one.
     *
     * Every reward above pays the same solve bonus at depth 1 and depth 7, so a bank
     * that contains both is dominated by the easy end simply because it is solved more
     * often. If the objective is the deep rungs specifically, the objective function
     * should say so. Scaling by d0/radius makes a depth-7 solve worth roughly seven
     * times a depth-1 one — but the shaping term underneath is unchanged, so a brain
     * still cannot profit by ignoring the shallow cubes it also has to finish. */
    deepsolve: {
        oracle: true,
        note: "mixed shaping, with the solve bonus scaled by the cube's true depth so " +
            "the deep rungs actually drive selection.",
        fn: (tr, p) => {
            let r = 0.8 * tr.descDisc / Math.max(1e-9, discNorm(tr.d0, p.gamma));
            if (tr.solved) {
                r += p.solveBonus * (0.4 + 1.2 * tr.d0 / 7);
                r += p.speedBonus * (tr.budget - tr.moves) / tr.budget;
            }
            r -= p.stepCost * tr.moves;
            r -= p.undoPenalty * tr.undos;
            return r;
        },
    },

    /* --------------------------------------- the funnel: works at any depth --- */

    funnel: {
        oracle: true,
        note: "structure credit outside the oracle's radius, exact descent inside it, " +
            "and a bonus for crossing in. The only reward here that is not flat on a " +
            "deeply scrambled cube.",
        /* Why this shape.
         *
         * Every oracle-shaped reward below is *constant* beyond the table's radius,
         * because distanceOf returns radius+1 for anything it has not enumerated. A
         * depth-15 cube and a depth-9 cube score identically and no move between them
         * earns anything, so a curriculum could never usefully leave the ball -- and,
         * silently, depthCap clamped it inside anyway. Training on genuinely scrambled
         * cubes was not rejected on evidence here; it was unreachable by construction.
         *
         * The metrics that do work out there -- sticker count, matched pairs -- are
         * blind exactly where the distance reward is sharpest: U, U2 and U' all leave
         * 42 of 54 facelets home. A reward built only from those can tidy a cube
         * forever without finishing one. Neither half is sufficient, the two are
         * complementary, and the boundary between them is a radius the oracle can
         * actually verify.
         *
         * So an episode's score is decided by which regime it reached:
         *
         *   never entered the ball  ->  0 .. structW              (structure only)
         *   entered the ball        ->  structW+ballBonus .. 1    (exact distance)
         *
         * The ranges cannot overlap, so any episode reaching the ball beats every
         * episode that does not, however tidy the latter left the cube. That ordering
         * is the design: it makes "get within seven moves of solved" the thing
         * selection pushes on, rather than an aesthetic property of the surface, and it
         * denies the population the local optimum a pure structure reward would sit in.
         *
         * Inside, credit is measured from the radius rather than from d0, so a cube
         * that entered at distance 7 and one that started at 7 are paid the same for
         * reaching distance 2.
         *
         * Farmability: structure is read at its best-ever value, so oscillation cannot
         * accumulate it; the ball term is monotone in a distance this project has
         * verified changes by exactly +/-1 per move; neither half pays for spending
         * moves. The honest limit is that probe_rewards.js cannot validate it beyond
         * depth 7, because no ground truth exists out there to correlate against. */
        fn: shell((tr, p) => {
            /* `dSat` says where the oracle's knowledge stops. A trace without it is not
             * an error — the page and the older tests build traces by hand — but the
             * fallback has to be a finite radius. An infinite one made
             * (radius − dBest)/radius evaluate to Infinity/Infinity = NaN, and the
             * suite's "every reward pays more for a solve than for a stall" check is
             * what caught it. Falling back to d0 makes this behave like `descent` on
             * such a trace, which is the right degenerate case. */
            const radius = (tr.dSat !== undefined && isFinite(tr.dSat))
                ? tr.dSat - 1 : Math.max(1, tr.d0);
            const pBest = tr.pBest === undefined ? 0 : tr.pBest;
            const struct = 0.5 * stickFrac(tr.sBest) + 0.5 * pairFrac(pBest);
            if (!(tr.dBest <= radius)) return p.structW * struct;
            const inside = radius > 0 ? (radius - tr.dBest) / radius : 1;
            const head = Math.max(0, 1 - p.structW - p.ballBonus);
            return p.structW + p.ballBonus + head * inside;
        }),
    },

    /* ------------------------------------------- oracle-shaped (radius-bound) */

    descent: {
        oracle: true,
        note: "how much of the true distance it removed: (d0 − dBest)/d0. Reaches 1 " +
            "exactly on a solve, cannot be farmed by oscillating, and gives d0+1 " +
            "distinguishable levels per episode instead of two.",
        fn: shell(tr => (tr.d0 - tr.dBest) / Math.max(1, tr.d0)),
    },

    descentFast: {
        oracle: true,
        note: "the same descent, but each step of progress is discounted by when it " +
            "happened — γ^t at the move that set a new personal best. Continuous " +
            "rather than d0+1 levels, and it prefers the brain that got there first.",
        fn: shell((tr, p) => tr.descDisc / Math.max(1e-9, discNorm(tr.d0, p.gamma))),
    },

    hover: {
        oracle: true,
        note: "descent, plus credit for the mean closeness over the whole trajectory. " +
            "Punishes a brain that touches a good state and then wanders away from it.",
        fn: shell(tr => {
            const desc = (tr.d0 - tr.dBest) / Math.max(1, tr.d0);
            const mean = tr.dSum / Math.max(1, tr.dCount);
            return 0.7 * desc + 0.3 * Math.max(0, (tr.d0 - mean) / Math.max(1, tr.d0));
        }),
    },

    optimalFrac: {
        oracle: true,
        note: "fraction of moves that reduced the true distance. DELIBERATELY " +
            "EXPLOITABLE — U then U' scores 0.5 forever. Kept so the exploit is a " +
            "measurement.",
        fn: shell(tr => tr.reducing / Math.max(1, tr.moves)),
    },

    mixed: {
        oracle: true,
        note: "descentFast shaping at 0.8 weight, so the solve bonus dominates it more " +
            "decisively. Tests whether the shaping should be a nudge rather than half " +
            "the score. The step cost and undo penalty stay at their defaults of zero " +
            "here and are swept separately by rw-mixed-cost and rw-mixed-undo — one " +
            "knob per cell, or the grid cannot attribute a difference to anything.",
        fn: shell((tr, p) => 0.8 * tr.descDisc / Math.max(1e-9, discNorm(tr.d0, p.gamma))),
    },
};

/* The largest discounted-descent sum achievable on a d0-deep scramble: progress
 * on every one of the first d0 moves. Dividing by it puts every scramble depth
 * on the same 0..1 scale, so a bank mixing depths 1..6 is not secretly a
 * weighted average that favours the shallow ones. */
function discNorm(d0, gamma) {
    let s = 0;
    for (let t = 0; t < Math.max(1, d0); t++) s += Math.pow(gamma, t);
    return s;
}

function rewardOf(name) {
    const r = REWARDS[name];
    if (!r) throw new Error("unknown reward: " + name);
    return r;
}

/* Does this reward need the distance oracle built? Building it costs a second
 * and 40 MB per worker, so the runs that cannot use it should not pay for it. */
function needsOracle(name) { return rewardOf(name).oracle; }

function rewardParams(over) {
    return Object.assign({}, REWARD_DEFAULTS, over || {});
}

if (typeof module !== "undefined") {
    module.exports = { REWARDS, REWARD_DEFAULTS, rewardOf, needsOracle, rewardParams, discNorm, stickFrac };
}
