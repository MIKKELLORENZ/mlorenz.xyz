/* configs.js — the search space, as data.
 *
 * One named config = one complete answer to "what does a brain look like and
 * what is it paid for". search.js puts them on trial, train_headless.js runs the
 * winner for hours, bake_brain.js writes the winner's identity into the built-in
 * champion, and main.js reads it back so the page reconstructs the exact same
 * sensor layout and architecture. Every one of those four has to agree, so the
 * definition lives in exactly one place.
 *
 *   profile   which sensor blocks exist            (sensors.js SENSE_PROFILES)
 *   arch      {kind:"mlp"|"conv", ...}             (nn.js)
 *   reward    overrides on R                       (world.js)
 *   ga        overrides on the GA settings         (evolution.js)
 *
 * The parameter counts in the comments are what you get with the profile named
 * on the same line; they matter because a GA searches a space of that many
 * dimensions with a population of a few dozen. Cheap is not automatically
 * better, but expensive had better be earning it.
 */
"use strict";

const SEARCH_GA = {
    mutRate: 0.12, mutSigma: 0.25, grace: 3,
    annealFit: 2000, annealFloor: 0.22, shakeAfter: 8,
    immZeroFit: 3600, childZeroFit: 48000, reinject: true,
    selfAdapt: true, migrateEvery: 0,
};

/* Line-clear pay that is proportional to what a clear is actually worth. At the
 * shipped values one single is worth ~30 placed pieces while it only removes 10
 * cells from the stack; one lucky clear then swamps every real difference in
 * stacking skill, and selection chases bag luck instead of technique. */
const LINES_LO = { LINES: [0, 60, 180, 440, 1000] };

/* The hold key, unplugged. Worth measuring because the pre-fix champion pressed
 * hold on 32 of every 40 pieces and scored 15% *better* with the key disabled —
 * but it was doing that to farm an engine loophole (a hold used to refresh the
 * anti-dithering budget) which is now closed, so the honest question is open
 * again. Order is [left, right, cw, ccw, soft, hard, hold]. */
const NO_HOLD = [1, 1, 1, 1, 1, 1, 0];

const CONFIGS = {
    /* ---- the control: exactly what the shipped brain was trained with ---- */
    base: { profile: "full", arch: { kind: "mlp", hidden: [64, 32] } },              // 27,399

    /* ---- input encoding ------------------------------------------------- */
    nogrid: { profile: "nogrid", arch: { kind: "mlp", hidden: [64, 32] } },          // 12,999
    nowindow: { profile: "nowindow", arch: { kind: "mlp", hidden: [64, 32] } },      // 22,279
    compact: { profile: "compact", arch: { kind: "mlp", hidden: [64, 32] } },        //  9,479
    planemlp: { profile: "plane", arch: { kind: "mlp", hidden: [64, 32] } },         // 18,759

    /* ---- MLP shape ------------------------------------------------------ */
    wide: { profile: "full", arch: { kind: "mlp", hidden: [128, 64] } },             // 58,887
    deep: { profile: "full", arch: { kind: "mlp", hidden: [64, 48, 24] } },          // 29,383
    flat: { profile: "full", arch: { kind: "mlp", hidden: [48] } },                  // 19,159

    /* ---- convolutional front ends over the 20×10 plane -----------------
     * The conv layer itself is tiny (a 3×3×8 bank is 80 numbers); nearly all the
     * parameters are in the dense head, so the interesting lever is how hard the
     * feature map is squeezed before the head sees it. */
    conv3x8: {                                                                       // ~19,800
        profile: "planeexpert",
        arch: { kind: "conv", conv: [{ k: 3, ch: 8, pool: 2 }], hidden: [48, 24] },
    },
    conv2layer: {                                                                    // ~14,000
        profile: "planeexpert",
        arch: {
            kind: "conv",
            conv: [{ k: 3, ch: 6, pool: 2 }, { k: 3, ch: 12 }],
            hidden: [48, 24],
        },
    },
    convstride: {                                                                    // ~21,400
        profile: "plane",
        arch: { kind: "conv", conv: [{ k: 4, ch: 10, stride: 2 }], hidden: [48, 24] },
    },
    convcolmax: {                                                                     // ~10,500
        // column-max pooling: each filter reports its strongest response *per
        // column*. Height information is discarded, which the expert features
        // still carry, and what survives is "what kind of surface is over
        // column x" — 10 numbers per filter instead of 144.
        profile: "planeexpert",
        arch: { kind: "conv", conv: [{ k: 3, ch: 12 }], colmax: true, hidden: [48, 24] },
    },
    convbig: {                                                                        // ~34,000
        profile: "planeexpert",
        arch: { kind: "conv", conv: [{ k: 3, ch: 16, pool: 2 }], hidden: [64, 32] },
    },

    /* ---- the synthesis the first search round pointed at -----------------
     * Round one said two things at once: a third hidden layer nearly doubled
     * held-out skill at 391 inputs (deep 35.0 vs base 21.1, and still climbing),
     * and cutting the input vector helped on its own (compact 30.1 on 111 inputs
     * with a third of the weights). Neither config tests both at once, so these
     * do — a deep head on a small encoding, which is also the cheapest thing in
     * the registry per unit of depth. */
    compact_deep: {                                                                  // ~11,700
        profile: "compact", arch: { kind: "mlp", hidden: [64, 48, 24] },
    },
    nogrid_deep: {                                                                   // ~16,800
        profile: "nogrid", arch: { kind: "mlp", hidden: [64, 48, 24] },
    },

    /* ---- the hold key on trial (see NO_HOLD above) ---------------------- */
    nogrid_nohold: { profile: "nogrid", arch: { kind: "mlp", hidden: [64, 32] }, keys: NO_HOLD },
    compact_nohold: { profile: "compact", arch: { kind: "mlp", hidden: [64, 32] }, keys: NO_HOLD },

    /* ---- activation functions on trial ----------------------------------
     * tanh/sigmoid was inherited, not measured. ReLU is the obvious challenger
     * and the usual objection to it (dead units have no gradient) is void here —
     * there is no gradient, and a mutation can revive a dead unit. What ReLU
     * risks instead is unbounded drift: nothing stops activations growing until
     * the output saturates into a fixed key pattern. Leaky ReLU and ELU keep a
     * signal below zero; softsign is bounded like tanh but flatter near zero.
     * All on the same encoding so the only difference is the nonlinearity. */
    nogrid_relu: { profile: "nogrid", arch: { kind: "mlp", hidden: [64, 32], acts: { hidden: "relu" } } },
    nogrid_lrelu: { profile: "nogrid", arch: { kind: "mlp", hidden: [64, 32], acts: { hidden: "lrelu" } } },
    nogrid_elu: { profile: "nogrid", arch: { kind: "mlp", hidden: [64, 32], acts: { hidden: "elu" } } },
    nogrid_softsign: { profile: "nogrid", arch: { kind: "mlp", hidden: [64, 32], acts: { hidden: "softsign" } } },
    // and the output side: a tanh head presses a key above 0 instead of above 0.5
    nogrid_tanhout: {
        profile: "nogrid",
        arch: { kind: "mlp", hidden: [64, 32], acts: { hidden: "tanh", out: "tanh" } },
    },
    nogrid_relu_deep: {
        // depth is where ReLU normally earns its keep, so give it three layers
        profile: "nogrid", arch: { kind: "mlp", hidden: [64, 48, 24], acts: { hidden: "relu" } },
    },
    convcolmax_relu: {
        // conv + ReLU is the pairing everything in vision uses
        profile: "planeexpert",
        arch: {
            kind: "conv", conv: [{ k: 3, ch: 12 }], colmax: true, hidden: [48, 24],
            acts: { hidden: "relu" },
        },
    },

    /* ---- round 2: crosses built on what round 1 measured ------------------
     * ReLU beat tanh at identical shape (39.8 vs 31.9) and, unlike tanh, it made
     * depth pay: three layers scored 43.3 with ReLU and 24.8 with tanh. Trimming
     * the encoding also held up (compact, 111 inputs, 36.5). Nothing had tried
     * both at once, and nothing had combined ReLU with the reward and timing
     * changes that won their own comparisons — so these do. */
    compact_relu: { profile: "compact", arch: { kind: "mlp", hidden: [64, 32], acts: { hidden: "relu" } } },
    compact_relu_deep: {
        profile: "compact", arch: { kind: "mlp", hidden: [64, 48, 24], acts: { hidden: "relu" } },
    },
    nogrid_relu_deeper: {
        // if depth is what ReLU unlocks, find where it stops paying
        profile: "nogrid", arch: { kind: "mlp", hidden: [96, 64, 32, 16], acts: { hidden: "relu" } },
    },
    nogrid_relu_wide_deep: {
        profile: "nogrid", arch: { kind: "mlp", hidden: [128, 64, 32], acts: { hidden: "relu" } },
    },
    nogrid_relu_lines_lo: {
        profile: "nogrid", arch: { kind: "mlp", hidden: [64, 48, 24], acts: { hidden: "relu" } },
        reward: LINES_LO,
    },
    nogrid_relu_dither_hi: {
        profile: "nogrid", arch: { kind: "mlp", hidden: [64, 48, 24], acts: { hidden: "relu" } },
        reward: { DITHER: -1.2 },
    },
    compact_relu_lines_lo: {
        profile: "compact", arch: { kind: "mlp", hidden: [64, 48, 24], acts: { hidden: "relu" } },
        reward: LINES_LO,
    },
    conv3x8_relu_lines_lo: {
        // the best conv so far, given the activation that just won
        profile: "planeexpert",
        arch: {
            kind: "conv", conv: [{ k: 3, ch: 8, pool: 2 }], hidden: [48, 24],
            acts: { hidden: "relu" },
        },
        reward: LINES_LO,
    },

    /* ---- two GA-side ideas that were never actually measured -------------
     * Behavioural fitness sharing was built, tested and shipped switched off
     * because nothing had run it head to head. And now that a hold no longer buys
     * free time, the anti-dithering pressure carries real weight, so what the
     * time penalty should cost is an open question again — the last time it was
     * raised the population answered by pinning soft drop on, which is exactly
     * the kind of thing a measurement catches and an argument does not. */
    nogrid_share: {
        profile: "nogrid", arch: { kind: "mlp", hidden: [64, 32] },
        ga: { share: 1.5, shareRadius: 0.55 },
    },
    nogrid_dither_hi: {
        profile: "nogrid", arch: { kind: "mlp", hidden: [64, 32] },
        reward: { DITHER: -1.2 },
    },

    /* ---- reward shape, crossed with the two most promising encodings ---- */
    lines_lo: { profile: "full", arch: { kind: "mlp", hidden: [64, 32] }, reward: LINES_LO },
    holes_hard: {
        profile: "full", arch: { kind: "mlp", hidden: [64, 32] },
        reward: { NEW_HOLE: -3.0, FIXED_HOLE: 1.5 },
    },
    conv3x8_lines_lo: {
        profile: "planeexpert",
        arch: { kind: "conv", conv: [{ k: 3, ch: 8, pool: 2 }], hidden: [48, 24] },
        reward: LINES_LO,
    },
    nogrid_lines_lo: { profile: "nogrid", arch: { kind: "mlp", hidden: [64, 32] }, reward: LINES_LO },
};

/* Apply a config to the globals the GA reads. Returns a descriptor for logs and
 * for the baked brain's header. */
function applyConfig(cfg, baseR) {
    configureSensors({ profile: cfg.profile || "full" });
    setArch(cfg.arch || { kind: "mlp", hidden: [64, 32] });
    setActionMask(cfg.keys || null);
    if (baseR) Object.assign(R, baseR, cfg.reward || {});
    const probe = makeNet(null);
    return {
        profile: cfg.profile || "full",
        arch: JSON.parse(JSON.stringify(NET_ARCH)),
        keys: ACTION_MASK.slice(),
        reward: cfg.reward || null,
        ga: Object.assign({}, SEARCH_GA, cfg.ga || {}),
        inputs: IN_SIZE,
        params: probe.paramCount,
        contract: probe.contract(),
    };
}

if (typeof module !== "undefined") module.exports = { CONFIGS, SEARCH_GA, applyConfig };
