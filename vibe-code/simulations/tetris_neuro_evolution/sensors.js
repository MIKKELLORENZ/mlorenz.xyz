/* sensors.js — turns a Tetris position into the numbers a brain reads.
 *
 * Design notes, because the encoding is most of why this is learnable at all:
 *
 *  · The surface window is *relative*: eight rows starting two above the highest
 *    block. A shape near the top of a tall stack therefore looks identical to
 *    the same shape near the bottom of an empty board, so a trick learned early
 *    keeps working later instead of having to be re-discovered per height.
 *  · The drop preview (two 10-wide channels) answers "if I slammed it here, how
 *    high would it sit and how many cells would I bury?" for every column at the
 *    current rotation. Without it the brain has to learn collision physics from
 *    scratch before it can learn strategy; with it, the search starts on the
 *    part of the problem we actually care about.
 *  · The board plane is the literal picture: 20×10, 1 for a locked cell and 0.5
 *    for a cell the falling piece covers. Nothing to infer, and it is what the
 *    convolutional architectures in nn.js read.
 *  · The brain's own currently-held keys are fed back in. Rotation and hard drop
 *    only fire on the press edge, so a key must be *released* to be used again —
 *    the brain can only learn that if it can see what it is holding.
 *
 * Which of those blocks are actually present is a *search dimension*, not a
 * decision: every block can be switched off, and the profiles at the bottom of
 * this header are what search.js puts on trial. More inputs is not free — every
 * extra sensor is another dimension the GA has to search and another row of
 * weights per hidden unit — so the encoding is measured like everything else.
 */
"use strict";

const SENSE_WIN_ROWS = 8;                 // rows of relative surface window

/* The input vector's block layout, as data. Every offset the tests and the
 * documentation need is derived from this rather than written down twice —
 * inserting a block used to silently shift hard-coded indices, which made an
 * alignment test pass for entirely the wrong reason. */
const SENSE_BLOCKS = [
    ["heights", BW], ["heightDiffs", BW - 1], ["holes", BW],
    ["window", SENSE_WIN_ROWS * BW],
    ["piece", 7], ["rotation", 4], ["pieceCol", BW],
    ["pieceColScalar", 1], ["pieceRow", 1], ["fallDistance", 1], ["landingHeight", 1],
    ["next", 7], ["next2", 7], ["hold", 7], ["canHold", 1],
    ["heldKeys", 7],
    ["totalHoles", 1], ["bumpiness", 1], ["maxHeight", 1], ["minHeight", 1], ["wells", 1],
    ["pieceTickBudget", 1],
    ["gravityPhase", 1], ["lockPhase", 1],
    ["previewDepth", BW], ["previewBury", BW],
    ["boardPlane", BH * BW],
];
const SENSE_ALL = SENSE_BLOCKS.map(b => b[0]);

/* Named input encodings. `full` is what the shipped brain was trained on; the
 * others drop or keep blocks to answer specific questions —
 *
 *   nogrid        do the compressed features alone beat the literal picture?
 *   nowindow      the relative window is a lossy copy of the plane; is it dead weight?
 *   plane         picture + piece identity + timing only: can it derive the rest?
 *   planeexpert   picture + the two features that are genuinely hard to derive
 *                 (drop preview, holes) — the conv architectures' natural pairing
 *   compact       the smallest thing that could work: no picture, no window
 */
const SENSE_PROFILES = {
    full: SENSE_ALL,
    nogrid: SENSE_ALL.filter(n => n !== "boardPlane"),
    nowindow: SENSE_ALL.filter(n => n !== "window"),
    plane: ["piece", "rotation", "pieceCol", "pieceColScalar", "pieceRow", "fallDistance",
        "landingHeight", "next", "next2", "hold", "canHold", "heldKeys",
        "pieceTickBudget", "gravityPhase", "lockPhase", "boardPlane"],
    planeexpert: ["heights", "holes", "piece", "rotation", "pieceCol", "pieceColScalar",
        "pieceRow", "fallDistance", "landingHeight", "next", "next2", "hold", "canHold",
        "heldKeys", "totalHoles", "bumpiness", "maxHeight", "wells",
        "pieceTickBudget", "gravityPhase", "lockPhase", "previewDepth", "previewBury",
        "boardPlane"],
    compact: SENSE_ALL.filter(n => n !== "boardPlane" && n !== "window"),
};

let SENSE_PROFILE = "full";
let SENSE_RAW_GRID = true;                // convenience mirror of "is boardPlane on?"
const EN = {};                            // block name → enabled
let IN_SIZE = 0;
const SENSE_LAYOUT = {};

/* configureSensors({profile}) or configureSensors({rawGrid}) or both.
 * Recomputes IN_SIZE, the block offsets, and the MLP input width. */
function configureSensors(opts) {
    let names = SENSE_PROFILES[SENSE_PROFILE];
    if (opts && opts.profile) {
        if (!SENSE_PROFILES[opts.profile]) throw new Error("unknown sensor profile: " + opts.profile);
        SENSE_PROFILE = opts.profile;
        names = SENSE_PROFILES[SENSE_PROFILE];
    }
    let set = new Set(names);
    if (opts && opts.rawGrid !== undefined) {
        if (opts.rawGrid) set.add("boardPlane"); else set.delete("boardPlane");
    }
    SENSE_RAW_GRID = set.has("boardPlane");

    let at = 0;
    for (const [name, n] of SENSE_BLOCKS) {
        EN[name] = set.has(name);
        if (!EN[name]) { SENSE_LAYOUT[name] = { at, size: 0 }; continue; }
        SENSE_LAYOUT[name] = { at, size: n };
        at += n;
    }
    IN_SIZE = at;
    if (typeof NET_ARCH === "undefined" || NET_ARCH.kind !== "conv") {
        NET_SIZES = [IN_SIZE].concat(NET_SIZES.slice(1));
    }
    return IN_SIZE;
}

/* 391 senses → 64 → 32 → 7 keys under the `full` profile.
 *
 * The width was chosen by measurement, not taste (ab_test.js, 110 generations,
 * two reps, scored on held-out piece sequences):
 *
 *   64→32   skill 35.2   0.31 lines   2.57 buried/piece   held-out fitness 154
 *   40→20   skill 28.2   0.09 lines   3.05 buried/piece   held-out fitness  83
 *   24→12   skill 27.1   0.06 lines   2.86 buried/piece   held-out fitness  81
 *
 * The interesting part is that the wide net's *training* fitness was the lowest
 * of the three (164 against 239 and 275) while its held-out score was the
 * highest by far. The narrow nets were not learning Tetris faster, they were
 * memorising the two piece sequences they were being scored on.
 *
 * `let`, not `const`, so search.js can keep putting architectures on trial. */
let NET_SIZES = [0, 64, 32, 7];
configureSensors();          // fills IN_SIZE, EN and NET_SIZES[0]

/* Scratch space — sense() is called millions of times per training run. */
const _m = { heights: new Int32Array(BW), holes: new Int32Array(BW) };

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* Fills `out` (Float32Array of IN_SIZE) from the live game. Returns the metrics
 * object, which the reward function reuses so the board is only scanned once. */
function sense(game, out) {
    const g = game.grid, p = game.piece;
    const m = boardMetrics(g, _m);
    let k = 0;

    // --- column profile ------------------------------------------------- 29
    // normalised by TH, not BH: a stack can legally reach into the two hidden
    // spawn rows, and dividing by the visible height sends these inputs past 1
    if (EN.heights) for (let x = 0; x < BW; x++) out[k++] = m.heights[x] / TH;
    if (EN.heightDiffs) {
        for (let x = 0; x < BW - 1; x++) out[k++] = clamp(m.heights[x] - m.heights[x + 1], -4, 4) / 4;
    }
    if (EN.holes) for (let x = 0; x < BW; x++) out[k++] = Math.min(m.holes[x], 4) / 4;

    // --- surface window, anchored two rows above the stack --------------- 80
    if (EN.window) {
        const top = m.topRow - 2;
        for (let r = 0; r < SENSE_WIN_ROWS; r++) {
            const y = top + r;
            for (let x = 0; x < BW; x++) {
                out[k++] = y < 0 ? 0 : (y >= TH ? 1 : (g[y * BW + x] ? 1 : 0));
            }
        }
    }

    // --- the piece in hand ----------------------------------------------- 25
    if (EN.piece) for (let i = 0; i < 7; i++) out[k++] = p.type === i ? 1 : 0;
    if (EN.rotation) for (let i = 0; i < 4; i++) out[k++] = p.rot === i ? 1 : 0;
    const cells = PIECES[p.type].flat[p.rot];
    let leftCol = BW, pieceTop = TH;
    for (let i = 0; i < 8; i += 2) {
        const cx = p.x + cells[i], cy = p.y + cells[i + 1];
        if (cx < leftCol) leftCol = cx;
        if (cy < pieceTop) pieceTop = cy;
    }
    if (EN.pieceCol) for (let x = 0; x < BW; x++) out[k++] = leftCol === x ? 1 : 0;
    if (EN.pieceColScalar) out[k++] = leftCol / (BW - 1);
    if (EN.pieceRow) out[k++] = clamp(p.y, 0, TH) / TH;
    const gy = game.ghostY();
    if (EN.fallDistance) out[k++] = clamp(gy - p.y, 0, TH) / TH;      // how far it would fall
    // clamped because an SRS wall kick can lift the piece above row 0 (the kick
    // tables contain y offsets of -2), which sends these past 1
    if (EN.landingHeight) out[k++] = clamp((TH - gy) / TH, 0, 1);     // how high it would land

    // --- queue and hold --------------------------------------------------- 22
    if (EN.next) for (let i = 0; i < 7; i++) out[k++] = game.queue[0] === i ? 1 : 0;
    if (EN.next2) for (let i = 0; i < 7; i++) out[k++] = game.queue[1] === i ? 1 : 0;
    if (EN.hold) for (let i = 0; i < 7; i++) out[k++] = game.hold === i ? 1 : 0;
    if (EN.canHold) out[k++] = game.canHold ? 1 : 0;

    // --- proprioception: what am I holding down right now? ----------------- 7
    if (EN.heldKeys) {
        for (let i = 0; i < KEY_ORDER.length; i++) out[k++] = game.down[KEY_ORDER[i]] ? 1 : 0;
    }

    // --- board aggregates --------------------------------------------------- 6
    if (EN.totalHoles) out[k++] = Math.min(m.totalHoles, 24) / 24;
    if (EN.bumpiness) out[k++] = Math.min(m.bumpy, 40) / 40;
    if (EN.maxHeight) out[k++] = m.maxH / TH;
    if (EN.minHeight) out[k++] = m.minH / TH;
    if (EN.wells) out[k++] = Math.min(m.wells, 12) / 12;
    if (EN.pieceTickBudget) out[k++] = Math.min(game.pieceTicks / game.cfg.maxTicksPerPiece, 1);

    // --- the two timing signals ------------------------------------------- 2
    // Gravity phase: how far through the current row-step we are, reaching 1 on
    // the tick the piece drops a row. Without it the brain cannot tell whether it
    // has one tick or seven before the ground moves under it — and at four
    // decisions per row that is the difference between landing a slide and being
    // a column out. A *sub-step* clock, not the whole descent.
    if (EN.gravityPhase) {
        const gravRate = game.down[KEY_SOFT]
            ? Math.max(1, (game.cfg.gravity / game.cfg.softFactor) | 0) : game.cfg.gravity;
        out[k++] = Math.min(1, (game.fallAccum || 0) / gravRate);
    }
    // Lock phase: 0 while falling, climbing to 1 as the piece rests on the stack
    // about to be committed — the last moment it can still be moved.
    if (EN.lockPhase) out[k++] = Math.min(1, (game.lockTimer || 0) / Math.max(1, game.cfg.lockDelay));

    // --- drop preview: land height + cells buried, per column -------------- 20
    // Indexed by the piece's *leftmost occupied column*, the same convention the
    // position one-hot above uses — not by the bounding box, which sits at a
    // different offset in half the rotations. Misaligning these two channels
    // makes the brain learn a per-rotation correction before it can learn
    // anything about Tetris.
    if (EN.previewDepth || EN.previewBury) {
        const kDepth = k, kBury = k + (EN.previewDepth ? BW : 0);
        if (EN.previewDepth) for (let x = 0; x < BW; x++) out[kDepth + x] = 0;
        if (EN.previewBury) for (let x = 0; x < BW; x++) out[kBury + x] = 1;
        const box = PIECES[p.type].box;
        let minCellX = 4;
        for (let i = 0; i < 8; i += 2) if (cells[i] < minCellX) minCellX = cells[i];
        for (let bx = 0; bx <= BW - box; bx++) {
            if (game._collides(bx, p.y, p.rot, p.type)) continue;   // can't slide there anyway
            const dy = game.dropY(bx, p.y, p.rot, p.type);
            let pTop = TH, bury = 0;
            for (let i = 1; i < 8; i += 2) if (dy + cells[i] < pTop) pTop = dy + cells[i];
            // cells that would be sealed in: empty squares under each column of the piece
            for (let cx = bx; cx < bx + box; cx++) {
                let low = -1;
                for (let i = 0; i < 8; i += 2) {
                    if (bx + cells[i] === cx && dy + cells[i + 1] > low) low = dy + cells[i + 1];
                }
                if (low < 0) continue;
                for (let yy = low + 1; yy < TH && !g[yy * BW + cx]; yy++) bury++;
            }
            const slot = bx + minCellX;
            if (EN.previewDepth) out[kDepth + slot] = clamp((TH - pTop) / TH, 0, 1);
            if (EN.previewBury) out[kBury + slot] = Math.min(bury, 8) / 8;
        }
        k += (EN.previewDepth ? BW : 0) + (EN.previewBury ? BW : 0);
    }

    // --- absolute board plane, 20 × 10 ----------------------------- 200 or 0
    // 1 = locked cell, 0.5 = a cell the falling piece is covering right now,
    // 0 = empty. Row-major from the top of the *visible* field.
    if (EN.boardPlane) {
        for (let y = BUF; y < TH; y++) {
            const row = y * BW, o = k + (y - BUF) * BW;
            for (let x = 0; x < BW; x++) out[o + x] = g[row + x] ? 1 : 0;
        }
        for (let i = 0; i < 8; i += 2) {
            const cx = p.x + cells[i], cy = p.y + cells[i + 1];
            if (cy >= BUF) out[k + (cy - BUF) * BW + cx] = 0.5;
        }
        k += BH * BW;
    }

    if (k !== IN_SIZE) throw new Error("sensor size mismatch: " + k + " != " + IN_SIZE);
    return m;
}

if (typeof module !== "undefined") {
    module.exports = {
        sense, IN_SIZE, NET_SIZES, configureSensors, SENSE_LAYOUT,
        SENSE_PROFILES, SENSE_PROFILE,
    };
}
