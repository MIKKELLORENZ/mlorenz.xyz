/* configs.js — every named run in one place, and the three grids.
 *
 * A config is a complete description of an experiment: what the brain can see,
 * what shape it is, what it is paid for, and how the population is bred. Nothing
 * is a global constant, because a brain is a set of weights against one exact
 * input layout and one exact action space — reload it under a different config
 * and it does not degrade gracefully, it reads garbage. Every saved champion
 * carries its config, and bake_brain.js refuses to write one whose architecture
 * contract does not match.
 *
 * ─── the three grids ───────────────────────────────────────────────────────
 *
 * GRIDS.reward     ten reward functions, same brain, same diet. This is the
 *                  interesting one: the reward is the instrument, and the point
 *                  of rewards.js is that the obvious dense choice is flat on
 *                  exactly the states that matter.
 * GRIDS.arch       conv against dense against the no-pixels control, at three
 *                  resolutions. Answers "is the picture the bottleneck, or the
 *                  puzzle" — which a plateau on its own cannot tell you.
 * GRIDS.temporal   how much history the observation needs. Includes the
 *                  memoryless config, which *cannot work* for a reason given at
 *                  length in vision.js, and is kept because a failure you can
 *                  reproduce on demand beats one you remember.
 *
 * grid_search.js screens a grid on one bank and confirms the leader on an
 * untouched one. That two-stage discipline is not ceremony: this project has
 * measured the winner's curse killing three "improvements" in a single day.
 */
"use strict";

/* ------------------------------------------------------------------- pieces */

/* Architectures. Parameter counts in the comments are for the default
 * observation (res 16, 2 frames, 2 remembered moves → 32×16×6 image + 17 extras);
 * grid_search.js prints the real numbers, and the real forward cost, rather than
 * trusting these. */
const ARCHS = {
    /* One convolution, aggressively downsampled, then a small dense head. The
     * cheapest thing that can still see a sticker. */
    convTiny: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }],
        hidden: [32],
    },
    /* Two stages: local colour edges, then a coarser layout feature. */
    convMid: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [32],
    },
    /* Wider first stage — more colour/edge detectors, no second stage. */
    convWide: {
        kind: "conv",
        conv: [{ k: 3, ch: 16, stride: 2, pool: 2 }],
        hidden: [48],
    },
    /* Three stages, narrow. Tests whether depth buys anything a GA can find; the
     * Tetris project's answer to the same question was "distrust one-rep depth
     * wins", so this one is measured with repeats.
     *
     * The pooling sits at the *end* rather than in the middle, and that is not a
     * style choice. The original spec pooled after stage 2, which took a 5×13 map
     * down to 2×6 — and a 3×3 kernel does not fit in a 2-row map, so the whole cell
     * threw "conv 3×3/1 does not fit 2×6" and the architecture grid reported it as
     * FAILED after burning seven minutes on it. Downsample once, last, when there is
     * still something left to convolve. test_headless.js now builds every entry in
     * this table so a spec that cannot exist is caught in 40 seconds rather than by
     * a grid. */
    convDeep: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2 }, { k: 3, ch: 12, stride: 1 },
        { k: 3, ch: 16, stride: 1, pool: 2 }],
        hidden: [32],
    },
    /* Bigger filters, one stage: a 5×5 window covers a whole sticker plus its
     * neighbours at res 16, which is arguably the natural feature size here. */
    convBig5: {
        kind: "conv",
        conv: [{ k: 5, ch: 10, stride: 2, pool: 2 }],
        hidden: [32],
    },
    /* Dense over the raw pixels. Included as the control that makes the case for
     * convolution rather than assuming it — at res 16 this is ~100k weights, and
     * the honest question is whether a GA can search that at all. */
    convH64_tanh: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "tanh", out: "linear" },
    },
    convH64_relu: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "relu", out: "linear" },
    },
    convH64_lrelu: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "lrelu", out: "linear" },
    },
    convH64_elu: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "elu", out: "linear" },
    },
    convH64_selu: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "selu", out: "linear" },
    },
    convH64_swish: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "swish", out: "linear" },
    },
    convH64_gelu: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "gelu", out: "linear" },
    },
    convH64_relu6: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "relu6", out: "linear" },
    },
    convH64_softsign: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "softsign", out: "linear" },
    },
    convH64_relu_touts: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "relu", out: "tanh" },
    },
    convH128_relu: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [128],
        acts: { hidden: "relu", out: "linear" },
    },
    convH64x64_relu: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64, 64],
        acts: { hidden: "relu", out: "linear" },
    },
    mlpFacelet64: { kind: "mlp", hidden: [64], acts: { hidden: "relu", out: "linear" } },
    mlpFacelet256: { kind: "mlp", hidden: [256, 128], acts: { hidden: "relu", out: "linear" } },
    convH64_relu_rec: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64], acts: { hidden: "relu", out: "linear" }, recurrent: true,
    },
    convH64_tanh_rec: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64], acts: { hidden: "tanh", out: "linear" }, recurrent: true,
    },
    convH32_relu_rec: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [32], acts: { hidden: "relu", out: "linear" }, recurrent: true,
    },
    convH64_swish_rec: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64], acts: { hidden: "swish", out: "linear" }, recurrent: true,
    },
    /* Stride-matched readers for the unfolded view: the first convolution's kernel and
     * stride equal the facelet size in pixels, so one filter position covers exactly one
     * facelet and the network is not asked to undo a projection before it can begin. */
    unfConv12: {
        kind: "conv",
        conv: [{ k: 2, ch: 8, stride: 2 }, { k: 3, ch: 16, stride: 3 }],
        hidden: [64], acts: { hidden: "relu", out: "linear" },
    },
    unfConv18: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 3 }, { k: 3, ch: 16, stride: 3 }],
        hidden: [64], acts: { hidden: "relu", out: "linear" },
    },
    unfConv18w: {
        kind: "conv",
        conv: [{ k: 3, ch: 16, stride: 3 }, { k: 3, ch: 32, stride: 3 }],
        hidden: [96], acts: { hidden: "relu", out: "linear" },
    },
    mlp: { kind: "mlp", hidden: [32] },
    mlpDeep: { kind: "mlp", hidden: [48, 24] },

    /* ---- round 4: capacity ----------------------------------------------------
     *
     * Every architecture above was chosen under a two-frame, two-move observation, and
     * round 3 replaced that observation wholesale — the image is now half the size and
     * the brain has twice the memory. The hidden layer has been 32 units since the first
     * week and has never been varied at all.
     *
     * There is a reason to expect it binds now. A reactive policy that solves a
     * depth-7 cube has to compute a distance-reducing turn for an arbitrary state
     * inside a radius-7 ball, from pixels, in one forward pass. That is a much harder
     * function than "undo the last turn", which is what 32 units were enough for. */
    convMid64: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
    },
    convMid96: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [96],
    },
    convMid64x32: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64, 32],
    },
    /* More filters as well as more head — if the bottleneck is what the convolution
     * can see rather than what the head can do with it. */
    convWide16: {
        kind: "conv",
        conv: [{ k: 3, ch: 16, stride: 2, pool: 2 }, { k: 3, ch: 32, stride: 1 }],
        hidden: [64],
    },
    convBig5w: {
        kind: "conv",
        conv: [{ k: 5, ch: 16, stride: 2, pool: 2 }],
        hidden: [64],
    },
    /* Downsample by striding twice instead of pooling: pooling throws away *which*
     * sticker in a 2x2 was which, and at this resolution a sticker is only a few
     * pixels across. */
    convStride2x: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2 }, { k: 3, ch: 16, stride: 2 }],
        hidden: [64],
    },
    convMid96relu: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [96],
        acts: { hidden: "relu", out: "linear" },
    },
    convMid64relu: {
        kind: "conv",
        conv: [{ k: 3, ch: 8, stride: 2, pool: 2 }, { k: 3, ch: 16, stride: 1 }],
        hidden: [64],
        acts: { hidden: "relu", out: "linear" },
    },
};

/* Genetic-algorithm knobs. Fitness here lives on roughly 0..2 (shaped descent up
 * to ~0.8, plus a solve bonus of 1 and a speed bonus up to 0.5), so annealFit and
 * immZeroFit are set on that scale — copying the Tetris numbers, which are on a
 * scale of thousands, would have left annealing switched off for the entire run. */
const GA_BASE = {
    pop: 64,
    islands: 1,
    migrateEvery: 10,
    share: 0,
    shareRadius: 0.55,
    selfAdapt: true,
    tau: 0.22,
    mutRate: 0.10,
    mutSigma: 0.22,
    perLayerSigma: false,
    grace: -1,               // with a held-out gate: the seat is held until beaten twice
    rankExp: 2.2,
    annealFit: 0.8,
    annealFloor: 0.25,
    shakeAfter: 12,
    immZeroFit: 1.0,
    childZeroFit: 0,         // 0 = crossover never switches off
    reinject: true,
};

/* ---------------------------------------------------------------- the base */

const BASE = {
    env: {
        moves: "UDLR",
        res: 16, ss: 3, margin: 0.04, gap: 0.10,
        palette: "clear", center: true, shade: true,
        frames: 2, moveHist: 2, clock: true, pixels: true,
        budget: { max: 20, slack: 6 },
        maxDepth: 1, depthMix: "ramp", oracleRadius: 7,
        reward: "mixed", rewardParams: {},
        /* Off by default. See Env.scoreBrain for what it measures and why an argmax
         * policy loses actions permanently without something like it. */
        coverage: 0, covFloor: 0.25,
    },
    arch: ARCHS.convMid,
    ga: GA_BASE,
    /* Episodes per brain per generation. The trade is population against
     * episodes, and on a task whose per-episode outcome is close to binary the
     * rocket-catch project measured the bank noise as dwarfing every breeding
     * operator — so this is deliberately not small. */
    episodes: 48,
    /* The held-out gate: a challenger that beats the champion in-run must also
     * beat it here before it can take the title. Rotated on staleness as well as
     * on promotion, because a gate that only moves when somebody passes it can
     * deadlock on a lucky bank. */
    /* Racing: screen the whole population on `screen` episodes, then re-measure the
     * top `finalists` (and the champion) on the full `episodes` bank before anyone
     * is crowned. 0 = off. */
    race: { screen: 0, finalists: 8 },
    gate: 96,
    gateRotate: 8,
    gateStale: 40,
    /* The difficulty ladder. maxDepth is capped by the oracle radius elsewhere;
     * `threshold` is the held-out solve rate at the current frontier that buys the
     * next rung. */
    ratchet: { startDepth: 1, threshold: 0.75, games: 96, maxDepth: 7 },
};

/* --------------------------------------------------------------- resolution */

function deepMerge(a, b) {
    if (b === undefined) return clone(a);
    if (b === null || typeof b !== "object" || Array.isArray(b)) return clone(b);
    const out = clone(a && typeof a === "object" && !Array.isArray(a) ? a : {});
    for (const k of Object.keys(b)) out[k] = deepMerge(out[k], b[k]);
    return out;
}
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/* Named configs are patches on BASE. Anything not mentioned is the base value,
 * so two configs in the same grid differ in exactly the dimension being tested
 * and nothing else. */
const CONFIGS = {
    default: {},

    /* ---- the reward grid: identical everywhere except the reward name ---- */
    "rw-solved": { env: { reward: "solved" } },
    "rw-stickers": { env: { reward: "stickers" } },
    "rw-bestStickers": { env: { reward: "bestStickers" } },
    "rw-progress": { env: { reward: "progress" } },
    "rw-faces": { env: { reward: "faces" } },
    "rw-descent": { env: { reward: "descent" } },
    "rw-descentFast": { env: { reward: "descentFast" } },
    "rw-hover": { env: { reward: "hover" } },
    "rw-optimalFrac": { env: { reward: "optimalFrac" } },
    "rw-mixed": { env: { reward: "mixed" } },
    /* the two shaping knobs, on the leading reward */
    "rw-mixed-cost": { env: { reward: "mixed", rewardParams: { stepCost: 0.01 } } },
    "rw-mixed-undo": { env: { reward: "mixed", rewardParams: { undoPenalty: 0.05 } } },

    /* ---- the architecture grid ---- */
    "ar-convTiny": { arch: ARCHS.convTiny },
    "ar-convMid": { arch: ARCHS.convMid },
    "ar-convWide": { arch: ARCHS.convWide },
    "ar-convDeep": { arch: ARCHS.convDeep },
    "ar-convBig5": { arch: ARCHS.convBig5 },
    "ar-mlp12": { arch: ARCHS.mlp, env: { res: 12 } },
    "ar-mlp16": { arch: ARCHS.mlp },
    /* The resolution sweep runs on convTiny, not on the default convMid, because
     * convMid *cannot exist* at res 12: one stride-2 conv and a pool take a 12×24
     * image down to 2×5, and the second stage's 3×3 kernel does not fit. Holding a
     * two-stage architecture fixed across resolutions is not an option here, so the
     * sweep holds the one-stage architecture fixed instead and `ar-convTiny` is the
     * res-16 member of the same series. (Found by the config-builds test, after the
     * same mistake in convDeep had already cost the grid a wasted cell.) */
    "ar-res12": { arch: ARCHS.convTiny, env: { res: 12 } },
    "ar-res24": { arch: ARCHS.convTiny, env: { res: 24 } },
    "ar-relu": { arch: Object.assign({}, ARCHS.convMid, { acts: { hidden: "relu", out: "linear" } }) },
    /* The control that says whether pixels are the bottleneck. Not a feature —
     * without it, a plateau cannot be attributed to the encoding or to the task. */
    "ar-facelets": { env: { pixels: false }, arch: ARCHS.mlpDeep },

    /* ---- the temporal grid ---- */
    "tm-frames1": { env: { frames: 1 } },
    "tm-frames2": { env: { frames: 2 } },
    "tm-frames3": { env: { frames: 3 } },
    "tm-hist0": { env: { moveHist: 0 } },
    "tm-hist1": { env: { moveHist: 1 } },
    "tm-hist4": { env: { moveHist: 4 } },
    /* The observation is a function of the cube alone, so a deterministic policy
     * is a deterministic map on a finite state space and its trajectory is
     * eventually periodic: the brain provably cycles. This is here to be seen
     * failing. */
    "tm-memoryless": { env: { frames: 1, moveHist: 0, clock: false } },

    /* ---- odds and ends worth having names for ---- */
    "px-realistic": { env: { palette: "realistic" } },
    "px-noshade": { env: { shade: false } },
    "fixed20": { env: { budget: { max: 20, slack: 20 } } },
    "sixfaces": { env: { moves: "UDLRFB" } },
    "ga-share": { ga: { share: 12 } },
    "ga-islands": { ga: { islands: 4, pop: 64 } },
    "ga-perlayer": { ga: { perLayerSigma: true, selfAdapt: false } },

    /* ================= round 3: what has not actually been tested =============
     *
     * Rounds 1 and 2 measured rewards and architectures and then spent six arms
     * failing to move a converged champion. Three whole dimensions were never run,
     * and one of them is the obvious suspect for the shape of the result table: the
     * ratchet stopped at frontier depth 4, so the champion's numbers at depths 5, 6
     * and 7 are pure extrapolation from cubes it never saw. Every cell below starts
     * from generation 1, because round 2's clean null established that retrofitting
     * an intervention onto a converged population measures nothing. */

    /* ---- the curriculum. Does the ratchet need to exist at all? --------------
     *
     * It was built for the usual reason — a fresh brain on a depth-7 cube solves
     * nothing, so there is no gradient to select on. But probe_rewards.js measured
     * the distance-shaped rewards holding a Spearman of 0.99–1.00 against ground
     * truth at *every* depth, which says the signal is there whether or not anything
     * is being solved. If that is right the ratchet is not protecting the run, it is
     * rationing its diet: `ramp` already weights depth d by d, so starting the
     * frontier at the top simply lets deep cubes into the mix from the first
     * generation with the shallow ones still dominant. */
    "cu-d7ramp": { ratchet: { startDepth: 7 } },
    "cu-d7unif": { env: { depthMix: "uniform" }, ratchet: { startDepth: 7 } },
    "cu-d5ramp": { ratchet: { startDepth: 5 } },
    /* Keep the ratchet, but let it move: at a 0.55 lower bound it advances on
     * competence rather than mastery, which is the middle position between the two
     * above. */
    "cu-thresh55": { ratchet: { threshold: 0.55 } },

    /* ---- action coverage, against the dead-action collapse ---- */
    "cov-03": { env: { coverage: 0.03 } },
    "cov-08": { env: { coverage: 0.08 } },
    /* the coverage term and a deep diet together — the two interventions aimed at
     * the same failure from opposite ends (make unused actions cost something; give
     * the brain cubes that need them) */
    "cov-d7": { env: { coverage: 0.05 }, ratchet: { startDepth: 7 } },

    /* ---- population against episodes -----------------------------------------
     *
     * The rocket-catch and Tetris projects both landed on the same answer — bank
     * noise dwarfs every breeding operator, so buy accuracy rather than candidates —
     * and this project has never tested it. Equal cost per generation either way. */
    "ep-lean": { ga: { pop: 32 }, episodes: 128 },
    "ep-fat": { ga: { pop: 96 }, episodes: 32 },

    /* ---- temporal, the grid that was wired up and never run ---- */
    "tm-rich": { env: { frames: 3, moveHist: 4 } },

    /* ================= round 3, wave 2: on top of the deep diet ===============
     *
     * Wave 1 changed one factor at a time against a control that was stuck at
     * frontier depth 2, and the curriculum cells beat it by 40%. That makes every
     * other wave-1 comparison a measurement in a regime nobody is going to ship: an
     * architecture chosen for how it learns depth-2 cubes has not been asked the
     * question that matters. So the promising factors are re-run here against a
     * control that already has the deep diet, and the ones that survive that are the
     * ones worth three hours. */
    "w2-unif": { env: { depthMix: "uniform" }, ratchet: { startDepth: 7 } },
    "w2-cov": {
        env: { depthMix: "uniform", coverage: 0.05 }, ratchet: { startDepth: 7 },
    },
    "w2-tiny": {
        env: { depthMix: "uniform" }, arch: ARCHS.convTiny, ratchet: { startDepth: 7 },
    },
    "w2-tinycov": {
        env: { depthMix: "uniform", coverage: 0.05 }, arch: ARCHS.convTiny,
        ratchet: { startDepth: 7 },
    },
    /* Racing as a cell rather than a flag. Wave 1's ep-lean result — 128 episodes a
     * brain finished last, at frontier 1 — says this run is paying for accuracy it
     * cannot afford; racing is the way to buy it only where the decisions are. */
    "w2-race": {
        env: { depthMix: "uniform" }, ratchet: { startDepth: 7 },
        race: { screen: 16, finalists: 8 },
    },
    /* The mix itself, held against the same control: ramp weights depth d by d, so
     * it is the *deeper* diet of the two, and it lost to uniform in wave 1. One seed
     * each is not an answer. */
    "w2-ramp": { ratchet: { startDepth: 7 } },

    /* ================= round 3, wave 2: around the move history ===============
     *
     * Wave 1's leader was `tm-hist4` at 0.273 against 0.143 for the control — twice
     * the curriculum effect, from remembering four past moves instead of two. That
     * is the dimension the round-1 grids specified and never ran, and it turns out to
     * have held the largest single factor in the project.
     *
     * It is also the one result here with a mechanism already written down. The
     * observation is a function of the cube alone, so a memoryless policy is a
     * deterministic map on a finite state space and provably cycles; move history is
     * what breaks that. Two moves was enough to stop the trivial U/U'/U loop. Four is
     * evidently enough to stop something longer — and the failure it prevents is
     * invisible in a score, because a brain that cycles and a brain that is merely
     * bad both simply fail to solve.
     *
     * `tm-rich` (three image frames *and* four moves) scored 0.191, well below
     * `tm-hist4` alone. Image history costs three more input planes and buys nothing,
     * which makes "one frame, four moves" — a third smaller than the shipped
     * observation — the interesting cell rather than an ablation. */
    "x-h4": { env: { moveHist: 4 } },
    "x-h4d7": {
        env: { moveHist: 4, depthMix: "uniform" }, ratchet: { startDepth: 7 },
    },
    "x-h4d7cov": {
        env: { moveHist: 4, depthMix: "uniform", coverage: 0.05 },
        ratchet: { startDepth: 7 },
    },
    /* One image frame, four moves: strictly less to look at, strictly more to
     * remember. If this wins, the picture history was pure search-space cost. */
    "x-h4f1d7": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, ratchet: { startDepth: 7 },
    },
    /* Is four the answer, or just more than two? */
    "x-h8d7": {
        env: { moveHist: 8, depthMix: "uniform" }, ratchet: { startDepth: 7 },
    },
    "x-h4big5d7": {
        env: { moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convBig5,
        ratchet: { startDepth: 7 },
    },
    "x-h4tinyd7": {
        env: { moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convTiny,
        ratchet: { startDepth: 7 },
    },
    "x-h4d7race": {
        env: { moveHist: 4, depthMix: "uniform" }, ratchet: { startDepth: 7 },
        race: { screen: 16, finalists: 8 },
    },

    /* ============ round 3, wave 3: one image frame, and what goes with it ======
     *
     * `x-h4f1d7` led wave 2 at 0.341 against 0.267 for the four-move control, but it
     * had changed two things at once — one image frame *and* the depth-7 uniform
     * diet — and the pairing that isolates the diet says the opposite at two frames
     * (0.245 against 0.267, the diet losing). So the leader is a genuine result and
     * an unattributed one, and `x3-f1h4` below is the cell that splits it.
     *
     * Everything else is re-asked in the one-frame regime, because wave 1 already
     * demonstrated what it costs to pick an architecture in a regime you are not
     * going to ship: its whole architecture column was measured against a control
     * stuck at frontier depth 2 and every conclusion from it had to be thrown away. */
    "x3-f1h4d7": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, ratchet: { startDepth: 7 },
    },
    /* the same brain on the ratchet — is the win the frame, or the diet? */
    "x3-f1h4": { env: { frames: 1, moveHist: 4 } },
    "x3-f1h6d7": {
        env: { frames: 1, moveHist: 6, depthMix: "uniform" }, ratchet: { startDepth: 7 },
    },
    "x3-f1h8d7": {
        env: { frames: 1, moveHist: 8, depthMix: "uniform" }, ratchet: { startDepth: 7 },
    },
    "x3-f1big5d7": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convBig5,
        ratchet: { startDepth: 7 },
    },
    "x3-f1tinyd7": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convTiny,
        ratchet: { startDepth: 7 },
    },
    "x3-f1raced7": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, ratchet: { startDepth: 7 },
        race: { screen: 16, finalists: 8 },
    },

    /* ============ round 4: capacity, on the round-three observation ============
     *
     * Base for all of these is round three's winner — one image frame, four remembered
     * moves, uniform depth 1-7 — and each cell changes one thing against `r4-base`.
     * The target is the deep end of the table: depth 7 sits at 8%.
     */
    "r4-base": { env: { frames: 1, moveHist: 4, depthMix: "uniform" }, ratchet: { startDepth: 7 } },
    "r4-h64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convMid64,
        ratchet: { startDepth: 7 },
    },
    "r4-h96": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convMid96,
        ratchet: { startDepth: 7 },
    },
    "r4-h64x32": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convMid64x32,
        ratchet: { startDepth: 7 },
    },
    "r4-wide16": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convWide16,
        ratchet: { startDepth: 7 },
    },
    "r4-big5w": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convBig5w,
        ratchet: { startDepth: 7 },
    },
    "r4-stride2x": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convStride2x,
        ratchet: { startDepth: 7 },
    },
    "r4-relu64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convMid64relu,
        ratchet: { startDepth: 7 },
    },
    /* Resolution, asked again. Round 1 found res 24 last of nine — but that was with
     * six image planes, and one frame costs half as much per extra row. */
    "r4-res20": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", res: 20 }, ratchet: { startDepth: 7 },
    },
    "r4-res24": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", res: 24 }, ratchet: { startDepth: 7 },
    },
    /* Six moves lost to four at 32 hidden units. It may not lose at 64: more history
     * is only useful to a head with room to use it. */
    "r4-h6cap": {
        env: { frames: 1, moveHist: 6, depthMix: "uniform" }, arch: ARCHS.convMid64,
        ratchet: { startDepth: 7 },
    },
    /* Population and islands, which 128 cores make affordable for the first time. */
    "r4-pop128": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, ga: { pop: 128 },
        ratchet: { startDepth: 7 },
    },
    "r4-isl4": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, ga: { pop: 128, islands: 4 },
        ratchet: { startDepth: 7 },
    },
    "r4-ep96": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, episodes: 96,
        ratchet: { startDepth: 7 },
    },
    "r4-race": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, ratchet: { startDepth: 7 },
        race: { screen: 16, finalists: 8 },
    },
    /* Deep-weighted diet: `ramp` weights depth d by d, so depth 7 gets a quarter of
     * the bank instead of a seventh. It lost to uniform at 32 units and two frames. */
    "r4-ramp": { env: { frames: 1, moveHist: 4 }, ratchet: { startDepth: 7 } },
    /* A depth-7 cube gets a budget of min(20, 7+6) = 13 moves for a 7-move solve. The
     * slack sweep that said "slack saturates" was run on shallow cubes, where it does. */
    "r4-slack12": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", budget: { max: 24, slack: 12 } },
        ratchet: { startDepth: 7 },
    },
    /* Pay for shorter solutions. On deep cubes the difference between a policy that
     * descends and one that wanders is most of the score. */
    "r5-relu96": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convMid96relu,
        ratchet: { startDepth: 7 },
    },
    "r5-relu64ep96": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convMid64relu,
        episodes: 96, ratchet: { startDepth: 7 },
    },
    "r4-cost": {
        env: {
            frames: 1, moveHist: 4, depthMix: "uniform",
            reward: "mixed", rewardParams: { stepCost: 0.01 },
        },
        ratchet: { startDepth: 7 },
    },

    /* ========== round 5: actually training on deeply scrambled cubes ==========
     *
     * Everything above trains inside the oracle's radius-7 ball, and that was never a
     * decision backed by a measurement -- it was a constraint nobody had noticed.
     * `distanceOf` returns radius+1 for every state outside the table, so all the
     * oracle-shaped rewards are literally *constant* out there, and `depthCap` clamped
     * the curriculum to the radius regardless of what maxDepth was set to. Asking for
     * depth 15 quietly gave you depth 7.
     *
     * `funnel` (rewards.js) is what makes the deep end learnable: structure credit
     * outside the ball, exact distance inside it, and a bonus for crossing in that no
     * amount of tidiness outside can match.
     *
     * The depth ceiling is 12 rather than 18 on purpose. A ramp mix at ceiling 12 still
     * spends about a third of the bank at depths the oracle can see, which is what
     * keeps the endgame trained -- and the endgame is the half that structure metrics
     * are blind to. Set the ceiling to 18 and 90% of the bank becomes cubes that never
     * enter the ball, so the funnel's ordering has nothing to order and the run
     * optimises surface tidiness. The budget rises to match: a depth-12 scramble gets
     * 30 moves rather than the 13 a saturated distance would have handed it. */
    "deep12": {
        env: {
            frames: 1, moveHist: 4, reward: "funnel", depthMix: "ramp",
            depthCapOverride: 12, budget: { max: 30, slack: 18 },
        },
        ratchet: { startDepth: 12, maxDepth: 12 },
    },
    "deep12cap": {
        env: {
            frames: 1, moveHist: 4, reward: "funnel", depthMix: "ramp",
            depthCapOverride: 12, budget: { max: 30, slack: 18 },
        },
        arch: ARCHS.convMid64relu,
        ratchet: { startDepth: 12, maxDepth: 12 },
    },
    /* The control that says whether the funnel is worth anything: same deep diet, same
     * budget, the old reward. Beyond radius 7 this one is flat, so if it keeps up then
     * the structure term is decoration. */
    "deep12ctl": {
        env: {
            frames: 1, moveHist: 4, reward: "mixed", depthMix: "ramp",
            depthCapOverride: 12, budget: { max: 30, slack: 18 },
        },
        arch: ARCHS.convMid64relu,
        ratchet: { startDepth: 12, maxDepth: 12 },
    },

    /* ============ round 5: activation, width, diet, reward ============ */
    "a-tanh": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_tanh, episodes: 96, ratchet: { startDepth: 7 },
    },
    "a-relu": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "a-lrelu": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_lrelu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "a-elu": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_elu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "a-selu": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_selu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "a-swish": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_swish, episodes: 96, ratchet: { startDepth: 7 },
    },
    "a-gelu": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_gelu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "a-relu6": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_relu6, episodes: 96, ratchet: { startDepth: 7 },
    },
    "a-softsign": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_softsign, episodes: 96, ratchet: { startDepth: 7 },
    },
    "o-tanh": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64_relu_touts, episodes: 96, ratchet: { startDepth: 7 },
    },
    "w-128": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH128_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "w-64x64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" },
        arch: ARCHS.convH64x64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    /* Diet aimed at the deep rungs: d-squared weighting puts about a third of the bank
     * on depth 7 instead of a seventh, which is as much a measurement fix as a training
     * one — at a uniform mix a brain is judged on seven depth-7 cubes and an 8%-to-12%
     * improvement there is invisible to selection. */
    "diet-deep": {
        env: { frames: 1, moveHist: 4, depthMix: "deep" }, arch: ARCHS.convH64_relu,
        episodes: 96, ratchet: { startDepth: 7 },
    },
    "diet-deep192": {
        env: { frames: 1, moveHist: 4, depthMix: "deep" }, arch: ARCHS.convH64_relu,
        episodes: 192, ratchet: { startDepth: 7 },
    },
    "rw-deepsolve": {
        env: { frames: 1, moveHist: 4, depthMix: "deep", reward: "deepsolve" },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "b-slack12": {
        env: {
            frames: 1, moveHist: 4, depthMix: "deep", budget: { max: 24, slack: 12 },
        },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    /* THE DIAGNOSTIC. Perfect state, no pixels, same everything else. If this reaches
     * the deep rungs the bottleneck is perception and the vision is worth working on;
     * if it plateaus where the pixel brains do, the bottleneck is the policy and no
     * amount of observation work will help. Round 1 ran this comparison under the OLD
     * two-move observation and concluded "pixels cost a third of the score" — that
     * control had the same short memory, so the conclusion was confounded. */
    "diag-facelets": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", pixels: false },
        arch: ARCHS.mlpFacelet64, episodes: 96, ratchet: { startDepth: 7 },
    },
    "diag-facelets-big": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", pixels: false },
        arch: ARCHS.mlpFacelet256, episodes: 96, ratchet: { startDepth: 7 },
    },
    "diag-facelets-deep": {
        env: { frames: 1, moveHist: 4, depthMix: "deep", pixels: false },
        arch: ARCHS.mlpFacelet256, episodes: 96, ratchet: { startDepth: 7 },
    },

    /* ---- round 7: recurrence -------------------------------------------------
     *
     * Memory is the one axis that has paid twice — two remembered moves to four was the
     * largest single effect in the project, and dropping image history on top of it was
     * larger still. A four-move window is a crude memory: it records what was played and
     * nothing about what the brain made of it. A recurrent state carries the latter.
     *
     * The tanh variant is not a formality. The state is fed back through the hidden
     * activation, so an unbounded ReLU can compound over a thirteen-move episode in a
     * way a bounded tanh cannot — which makes this a genuine activation x architecture
     * interaction rather than two independent knobs. */
    "rec-relu64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convH64_relu_rec,
        episodes: 96, ratchet: { startDepth: 7 },
    },
    "rec-tanh64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convH64_tanh_rec,
        episodes: 96, ratchet: { startDepth: 7 },
    },
    "rec-relu32": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform" }, arch: ARCHS.convH32_relu_rec,
        episodes: 96, ratchet: { startDepth: 7 },
    },
    "rec-relu64deep": {
        env: { frames: 1, moveHist: 4, depthMix: "deep" }, arch: ARCHS.convH64_relu_rec,
        episodes: 96, ratchet: { startDepth: 7 },
    },
    /* Recurrence should make the move-history window redundant. If it does, that is a
     * free 32 inputs back. */
    "rec-relu64h0": {
        env: { frames: 1, moveHist: 0, depthMix: "uniform" }, arch: ARCHS.convH64_relu_rec,
        episodes: 96, ratchet: { startDepth: 7 },
    },

    /* ---- round 8: imitation, the densest signal available ---------------------
     *
     * See Env.imitationScore. Fitness becomes per-move agreement with the oracle under
     * teacher forcing, which turns a one-bit-per-episode outcome into a dozen labelled
     * decisions and targets exactly the quantity the deep rungs need: a depth-7 solve
     * rate of 90% requires roughly 98.5% per-move accuracy, and episode reward cannot
     * resolve the difference between 95% and 98.5% at any bank size a GA can afford.
     * Still a GA — only the fitness function changed. */
    "imi-relu64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "imitate" },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "imi-relu64deep": {
        env: { frames: 1, moveHist: 4, depthMix: "deep", fitness: "imitate" },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "imi-w128": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "imitate" },
        arch: ARCHS.convH128_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "imi-rec64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "imitate" },
        arch: ARCHS.convH64_relu_rec, episodes: 96, ratchet: { startDepth: 7 },
    },
    "imi-facelets": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", pixels: false, fitness: "imitate" },
        arch: ARCHS.mlpFacelet256, episodes: 96, ratchet: { startDepth: 7 },
    },
    /* More decisions per generation: imitation makes episodes cheap in information
     * terms, so the question is whether to buy more of them. */
    "imi-ep192": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "imitate" },
        arch: ARCHS.convH64_relu, episodes: 192, ratchet: { startDepth: 7 },
    },

    /* Round 6's best activation on pixels was swish, by a margin the grid could not
     * separate from noise on one seed each — so it is carried into the imitation family
     * rather than trusted. */
    "imi-swish64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "imitate" },
        arch: ARCHS.convH64_swish, episodes: 96, ratchet: { startDepth: 7 },
    },
    "imi-swishrec": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "imitate" },
        arch: ARCHS.convH64_swish_rec, episodes: 96, ratchet: { startDepth: 7 },
    },
    "imi-facebig": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", pixels: false, fitness: "imitate" },
        arch: ARCHS.mlpFacelet64, episodes: 96, ratchet: { startDepth: 7 },
    },

    /* ---- round 9: closing the imitation distribution gap ---- */
    "dag-relu64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "dagger" },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "blend-relu64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "blend", blendW: 0.5 },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "blend-relu64-w8": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "blend", blendW: 0.8 },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "dag-swish64": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", fitness: "dagger" },
        arch: ARCHS.convH64_swish, episodes: 96, ratchet: { startDepth: 7 },
    },

    /* ---- round 10: the unfolded view ---- */
    "unf12": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", view: "unfolded", res: 12, gap: 0.1, shade: false },
        arch: ARCHS.unfConv12, episodes: 96, ratchet: { startDepth: 7 },
    },
    "unf18": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", view: "unfolded", res: 18, gap: 0.1, shade: false },
        arch: ARCHS.unfConv18, episodes: 96, ratchet: { startDepth: 7 },
    },
    "unf18w": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", view: "unfolded", res: 18, gap: 0.1, shade: false },
        arch: ARCHS.unfConv18w, episodes: 96, ratchet: { startDepth: 7 },
    },
    "unf18-imi": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", view: "unfolded", res: 18, gap: 0.1, shade: false, fitness: "imitate" },
        arch: ARCHS.unfConv18, episodes: 96, ratchet: { startDepth: 7 },
    },
    "unf12-imi": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", view: "unfolded", res: 12, gap: 0.1, shade: false, fitness: "imitate" },
        arch: ARCHS.unfConv12, episodes: 96, ratchet: { startDepth: 7 },
    },

    /* ---- round 11: resolution, re-asked without a search cost ----------------
     *
     * Round 1 found higher resolutions finishing last and concluded legibility was
     * never the binding constraint. That conclusion was true *for a genetic algorithm*:
     * every extra input is another dimension to search, and the GA paid for it
     * immediately while the benefit needed selection to find a use for it. Gradient
     * descent pays no such cost, and the pixel-vs-facelet gap that remains (96.7% from
     * perfect state, ~87% from the picture) is exactly a reading problem. So the sweep
     * is worth running again in the regime where the trade-off is different. */
    "hi20": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", res: 20 },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "hi24": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", res: 24 },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "hi32": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", res: 32 },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
    "unf24": {
        env: { frames: 1, moveHist: 4, depthMix: "uniform", view: "unfolded", res: 24, gap: 0.1, shade: false },
        arch: ARCHS.unfConv18, episodes: 96, ratchet: { startDepth: 7 },
    },
    /* Move history is provably useless for this target: the distance-reducing move is a
     * function of the cube alone. Dropping it removes 32 inputs of pure noise — and if
     * accuracy is unchanged, that is worth knowing about the observation in general. */
    "hi24-nohist": {
        env: { frames: 1, moveHist: 0, depthMix: "uniform", res: 24 },
        arch: ARCHS.convH64_relu, episodes: 96, ratchet: { startDepth: 7 },
    },
};

const GRIDS = {
    reward: ["rw-solved", "rw-stickers", "rw-bestStickers", "rw-progress", "rw-faces",
        "rw-descent", "rw-descentFast", "rw-hover", "rw-optimalFrac", "rw-mixed",
        "rw-mixed-cost", "rw-mixed-undo"],
    arch: ["ar-convTiny", "ar-convMid", "ar-convWide", "ar-convDeep", "ar-convBig5",
        "ar-mlp12", "ar-mlp16", "ar-res12", "ar-res24", "ar-relu", "ar-facelets"],
    temporal: ["tm-frames1", "tm-frames2", "tm-frames3", "tm-hist0", "tm-hist1",
        "tm-hist4", "tm-memoryless"],
    ga: ["default", "ga-share", "ga-islands", "ga-perlayer"],
    /* Round 3's screen: one factor changed per cell against `default`, every cell
     * from generation 1, ranked on the same held-out scrambles at depths 1–7. */
    round3: ["default", "cu-d7ramp", "cu-d7unif", "cu-d5ramp", "cu-thresh55",
        "cov-03", "cov-08", "cov-d7", "ep-lean", "ep-fat",
        "ar-convTiny", "ar-convWide", "ar-convBig5",
        "tm-frames3", "tm-hist4", "tm-rich", "ga-share"],
    round3b: ["w2-unif", "w2-cov", "w2-tiny", "w2-tinycov", "w2-race", "w2-ramp"],
    round3c: ["x-h4", "x-h4d7", "x-h4d7cov", "x-h4f1d7", "x-h8d7",
        "x-h4big5d7", "x-h4tinyd7", "x-h4d7race"],
    round3d: ["x3-f1h4d7", "x3-f1h4", "x3-f1h6d7", "x3-f1h8d7",
        "x3-f1big5d7", "x3-f1tinyd7", "x3-f1raced7"],
    round5: ["deep12", "deep12cap", "deep12ctl"],
    round8: ["imi-relu64", "imi-relu64deep", "imi-w128", "imi-rec64", "imi-facelets", "imi-ep192"],
    round7: ["rec-relu64", "rec-tanh64", "rec-relu32", "rec-relu64deep", "rec-relu64h0"],
    round6: ["a-tanh", "a-relu", "a-lrelu", "a-elu", "a-selu", "a-swish", "a-gelu", "a-relu6", "a-softsign", "o-tanh", "w-128", "w-64x64", "diet-deep", "diet-deep192", "rw-deepsolve", "b-slack12", "diag-facelets", "diag-facelets-big", "diag-facelets-deep"],
    round4: ["r4-base", "r4-h64", "r4-h96", "r4-h64x32", "r4-wide16", "r4-big5w",
        "r4-stride2x", "r4-relu64", "r4-res20", "r4-res24", "r4-h6cap",
        "r4-pop128", "r4-isl4", "r4-ep96", "r4-race", "r4-ramp",
        "r4-slack12", "r4-cost"],
};

function resolveConfig(nameOrObj) {
    if (!nameOrObj) return deepMerge(BASE, {});
    if (typeof nameOrObj === "string") {
        const patch = CONFIGS[nameOrObj];
        if (!patch) throw new Error(`unknown config "${nameOrObj}" — known: ${Object.keys(CONFIGS).join(", ")}`);
        return deepMerge(BASE, patch);
    }
    return deepMerge(BASE, nameOrObj);
}

/* A one-line human summary, used in every log header and in the baked brain. */
function describeConfig(cfg, env) {
    const info = env.contractInfo(cfg.arch);
    const rw = rewardOf(cfg.env.reward);
    /* Shaping parameters that differ from the defaults, spelled out in the header.
     *
     * Without this, `rw-mixed-cost` and the plain default print an identical line —
     * both are reward "mixed", and the only difference between them is a stepCost of
     * 0.01 buried in rewardParams. Two arms of an A/B whose logs are
     * indistinguishable are two runs nobody can attribute a result to six hours
     * later, which is the whole reason a header exists. */
    const P = rewardParams(cfg.env.rewardParams);
    const D = REWARD_DEFAULTS;
    const tweaks = Object.keys(D)
        .filter(k => P[k] !== D[k])
        .map(k => `${k} ${P[k]}`);
    return {
        rewardParams: P,
        rewardTweaks: tweaks,
        contract: info.contract,
        params: info.params,
        inputs: info.inputs,
        image: info.image,
        extras: info.extras,
        nMoves: info.nMoves,
        reward: cfg.env.reward,
        oracle: rw.oracle,
        /* Pinned to en-US, not the machine locale. On a Danish or German machine the
         * default groups with a full stop, so "5008 params" printed as "5.008
         * params" — which reads as five-point-oh-oh-eight in a log header whose
         * whole job is to state the size of the network unambiguously. */
        line: `${info.contract} · ${info.params.toLocaleString("en-US")} params · ` +
            `${info.inputs} inputs (${cfg.env.pixels ? "image " + info.image : "facelets"} + ${info.extras}) · ` +
            `reward "${cfg.env.reward}"${rw.oracle ? " (oracle-shaped)" : ""}` +
            `${tweaks.length ? " [" + tweaks.join(", ") + "]" : ""} · ` +
            `${info.nMoves} moves · budget ${cfg.env.budget.max}`,
    };
}
