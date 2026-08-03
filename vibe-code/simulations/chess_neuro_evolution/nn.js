// The brain: a dual-head pointer network, evolved and never differentiated.
//
// A genome is one flat Float64Array holding every weight and bias. There is no
// gradient, no optimizer and no loss function anywhere in this file - genomes
// only ever change through crossover and Gaussian mutation.
//
// Shape:
//
//   square encoder   30 channels -> 22 -> 16, the SAME weights applied to all
//                    64 squares, plus a learned 64 x 22 bias table (a classic
//                    piece-square table, evolved from scratch) so a shared
//                    encoder can still say "this square is special".
//   trunk            [mean-pool, max-pool, 36 global scalars] -> 40, the
//                    whole-position summary both heads condition on.
//   FROM head        one scalar per square: how much this brain wants to move
//                    the piece standing there.
//   TO head          one scalar per (from, to) pair: how much it wants that
//                    piece to land there. The from/to interaction is a
//                    bilinear (query . key) term, so the destination ranking
//                    genuinely depends on which piece is being moved.
//   PROMO head       4 logits, Q / R / B / N.
//
//   move score = FROM[from] + TO[from][to] (+ PROMO[piece] when promoting)
//
// Sharing the encoder across all 64 squares is what makes this evolvable: a
// dense first layer over a 64-square board would be ~100k genes, this is 6636
// in total, and every one of them gets gradient-free feedback from every
// square on every ply.
'use strict';

const NN_VERSION = 'chess-ne-v3';
const NN_H1 = 22;    // square encoder hidden width
const NN_EMB = 16;   // square embedding width
const NN_TR = 40;    // trunk width
const NN_D = 10;     // bilinear from/to interaction width
const NN_PROMO = 4;  // Q, R, B, N
const GENE_CLAMP = 8;

const NN_GIN = 2 * NN_EMB + GLOB_IN; // trunk input width
const NN_HEAD_IN = NN_EMB + NN_TR;   // head input width (square embedding + trunk)
const INV_SQRT_D = 1 / Math.sqrt(NN_D);

// Genome layout. Each block records where it starts, how big it is, the init
// scale, and how strongly mutation should perturb it - a gene in the tiny
// output heads must not be shaken as hard as one in the wide trunk.
const NN_BLOCKS = (function () {
    const defs = [
        // name,          size,                     init,   mutScale, rowLen
        ['W1', SQ_CH * NN_H1, 'fanin:' + SQ_CH, 1.0, NN_H1],
        ['B1', NN_H1, 'zero', 0.6, NN_H1],
        ['PST', 64 * NN_H1, 'const:0.03', 0.5, NN_H1],
        ['W2', NN_H1 * NN_EMB, 'fanin:' + NN_H1, 1.0, NN_EMB],
        ['B2', NN_EMB, 'zero', 0.6, NN_EMB],
        ['WG', NN_TR * NN_GIN, 'fanin:' + NN_GIN, 1.0, NN_GIN],
        ['BG', NN_TR, 'zero', 0.6, NN_TR],
        ['WF', NN_HEAD_IN, 'const:0.08', 0.35, NN_HEAD_IN],
        ['BF', 1, 'zero', 0.35, 1],
        ['WQ', NN_D * NN_HEAD_IN, 'const:0.15', 0.5, NN_HEAD_IN],
        ['BQ', NN_D, 'zero', 0.5, NN_D],
        ['WK', NN_D * NN_HEAD_IN, 'const:0.15', 0.5, NN_HEAD_IN],
        ['BK', NN_D, 'zero', 0.5, NN_D],
        ['WT', NN_HEAD_IN, 'const:0.08', 0.35, NN_HEAD_IN],
        ['BT', 1, 'zero', 0.35, 1],
        ['WP', NN_PROMO * NN_TR, 'const:0.1', 0.4, NN_TR],
        ['BP', NN_PROMO, 'zero', 0.4, NN_PROMO]
    ];
    const map = {}, list = [];
    let off = 0;
    for (const [name, size, init, mutScale, rowLen] of defs) {
        const blk = { name, off, size, init, mutScale, rowLen };
        map[name] = blk; list.push(blk);
        off += size;
    }
    return { map, list, total: off };
})();

const NN_GENOME_LEN = NN_BLOCKS.total;
const O = (function () { const o = {}; for (const b of NN_BLOCKS.list) o[b.name] = b.off; return o; })();

// Functional units for crossover: a child inherits whole rows, never a
// half-built neuron. Blended crossover across a whole genome scrambles
// co-adapted weights; swapping intact rows does not.
const NN_ROWS = (function () {
    const rows = [];
    for (const b of NN_BLOCKS.list) {
        const len = Math.max(1, b.rowLen);
        for (let s = 0; s < b.size; s += len) {
            rows.push([b.off + s, Math.min(len, b.size - s)]);
        }
    }
    return rows;
})();

// Deterministic RNG (mulberry32) so runs are reproducible from seeds.
function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Box-Muller. Deliberately stateless: a cached spare would leak across calls
// and silently break seeded reproducibility.
function gaussian(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function randomGenome(rng) {
    const g = new Float64Array(NN_GENOME_LEN);
    for (const b of NN_BLOCKS.list) {
        let scale = 0;
        if (b.init.startsWith('fanin:')) scale = Math.sqrt(1 / +b.init.slice(6));
        else if (b.init.startsWith('const:')) scale = +b.init.slice(6);
        if (scale === 0) continue;
        for (let i = 0; i < b.size; i++) g[b.off + i] = gaussian(rng) * scale;
    }
    return g;
}

function cloneGenome(g) { return g.slice(); }

function validGenome(g) {
    if (!g || g.length !== NN_GENOME_LEN) return false;
    for (let i = 0; i < g.length; i++) if (!Number.isFinite(g[i])) return false;
    return true;
}

function repairGenome(g) {
    for (let i = 0; i < g.length; i++) {
        if (!Number.isFinite(g[i])) g[i] = 0;
        else if (g[i] > GENE_CLAMP) g[i] = GENE_CLAMP;
        else if (g[i] < -GENE_CLAMP) g[i] = -GENE_CLAMP;
    }
    return g;
}

// ------------------------------------------------------------- forward pass --
// Shared scratch: one policy evaluation happens at a time, and the hot loop
// must not allocate.
const POL = {
    emb: new Float64Array(64 * NN_EMB),
    h1: new Float64Array(NN_H1),
    h: new Float64Array(NN_TR),
    trunkIn: new Float64Array(NN_GIN),
    fromLogit: new Float64Array(64),
    kvec: new Float64Array(64 * NN_D),
    khOff: new Float64Array(NN_D),
    qhOff: new Float64Array(NN_D),
    q: new Float64Array(NN_D),
    toBase: new Float64Array(64),
    toOut: new Float64Array(64),
    promo: new Float64Array(NN_PROMO)
};

// Encode all 64 squares, build the trunk, and precompute everything that does
// not depend on which piece is being moved.
function forwardPolicy(g, feats) {
    const sq = feats.sq, glob = feats.glob;
    const emb = POL.emb, h1 = POL.h1;

    // --- shared square encoder ---------------------------------------------
    // Layer 1 skips zero channels. Most squares are empty or quiet, so a
    // typical square touches ~10 of the 30 channels; W1 is stored input-major
    // precisely so that skipping a channel skips a contiguous run.
    for (let s = 0; s < 64; s++) {
        const xb = s * SQ_CH;
        const pstb = O.PST + s * NN_H1;
        for (let j = 0; j < NN_H1; j++) h1[j] = g[O.B1 + j] + g[pstb + j];
        for (let c = 0; c < SQ_CH; c++) {
            const x = sq[xb + c];
            if (x === 0) continue;
            const wb = O.W1 + c * NN_H1;
            for (let j = 0; j < NN_H1; j++) h1[j] += g[wb + j] * x;
        }
        for (let j = 0; j < NN_H1; j++) h1[j] = Math.tanh(h1[j]);

        const eb = s * NN_EMB;
        for (let j = 0; j < NN_EMB; j++) emb[eb + j] = g[O.B2 + j];
        for (let i = 0; i < NN_H1; i++) {
            const a = h1[i];
            if (a === 0) continue;
            const wb = O.W2 + i * NN_EMB;
            for (let j = 0; j < NN_EMB; j++) emb[eb + j] += g[wb + j] * a;
        }
        for (let j = 0; j < NN_EMB; j++) emb[eb + j] = Math.tanh(emb[eb + j]);
    }

    // --- pooling + trunk ----------------------------------------------------
    const ti = POL.trunkIn;
    for (let j = 0; j < NN_EMB; j++) { ti[j] = 0; ti[NN_EMB + j] = -1.5; }
    for (let s = 0; s < 64; s++) {
        const eb = s * NN_EMB;
        for (let j = 0; j < NN_EMB; j++) {
            const v = emb[eb + j];
            ti[j] += v;
            if (v > ti[NN_EMB + j]) ti[NN_EMB + j] = v;
        }
    }
    for (let j = 0; j < NN_EMB; j++) ti[j] /= 64;
    for (let j = 0; j < GLOB_IN; j++) ti[2 * NN_EMB + j] = glob[j];

    const h = POL.h;
    for (let t = 0; t < NN_TR; t++) {
        let sum = g[O.BG + t];
        const wb = O.WG + t * NN_GIN;
        for (let i = 0; i < NN_GIN; i++) sum += g[wb + i] * ti[i];
        h[t] = Math.tanh(sum);
    }

    // --- head offsets that only depend on the trunk -------------------------
    let fromOff = g[O.BF], toOff = g[O.BT];
    for (let t = 0; t < NN_TR; t++) {
        fromOff += g[O.WF + NN_EMB + t] * h[t];
        toOff += g[O.WT + NN_EMB + t] * h[t];
    }
    for (let d = 0; d < NN_D; d++) {
        let kh = g[O.BK + d], qh = g[O.BQ + d];
        const kb = O.WK + d * NN_HEAD_IN, qb = O.WQ + d * NN_HEAD_IN;
        for (let t = 0; t < NN_TR; t++) {
            kh += g[kb + NN_EMB + t] * h[t];
            qh += g[qb + NN_EMB + t] * h[t];
        }
        POL.khOff[d] = kh;
        POL.qhOff[d] = qh;
    }

    // --- per-square head terms ---------------------------------------------
    for (let s = 0; s < 64; s++) {
        const eb = s * NN_EMB;
        let fv = fromOff, tv = toOff;
        for (let j = 0; j < NN_EMB; j++) {
            const e = emb[eb + j];
            fv += g[O.WF + j] * e;
            tv += g[O.WT + j] * e;
        }
        POL.fromLogit[s] = fv;
        POL.toBase[s] = tv;
        const kb = s * NN_D;
        for (let d = 0; d < NN_D; d++) {
            let k = POL.khOff[d];
            const wb = O.WK + d * NN_HEAD_IN;
            for (let j = 0; j < NN_EMB; j++) k += g[wb + j] * emb[eb + j];
            POL.kvec[kb + d] = k;
        }
    }

    for (let p = 0; p < NN_PROMO; p++) {
        let sum = g[O.BP + p];
        const wb = O.WP + p * NN_TR;
        for (let t = 0; t < NN_TR; t++) sum += g[wb + t] * h[t];
        POL.promo[p] = sum;
    }
    return POL;
}

// Destination logits for one from-square. Writes into shared scratch, so read
// the result before asking for another from-square.
function toLogitsFor(g, from) {
    const eb = from * NN_EMB, q = POL.q;
    for (let d = 0; d < NN_D; d++) {
        let v = POL.qhOff[d];
        const wb = O.WQ + d * NN_HEAD_IN;
        for (let j = 0; j < NN_EMB; j++) v += g[wb + j] * POL.emb[eb + j];
        q[d] = v;
    }
    const out = POL.toOut;
    for (let s = 0; s < 64; s++) {
        let dot = 0;
        const kb = s * NN_D;
        for (let d = 0; d < NN_D; d++) dot += q[d] * POL.kvec[kb + d];
        out[s] = POL.toBase[s] + dot * INV_SQRT_D;
    }
    return out;
}

// ------------------------------------------------------------- genetics -----
// Row-wise crossover: whole functional units (one input channel's fan-out, one
// trunk neuron's incoming weights, one square's piece-square entry) come from
// one parent or the other. A minority of rows get a blended average instead,
// which keeps a little of the smooth interpolation that helps fine-tuning.
function crossover(a, b, rng) {
    const child = new Float64Array(NN_GENOME_LEN);
    for (let r = 0; r < NN_ROWS.length; r++) {
        const [off, len] = NN_ROWS[r];
        const u = rng();
        if (u < 0.42) {
            for (let i = 0; i < len; i++) child[off + i] = a[off + i];
        } else if (u < 0.84) {
            for (let i = 0; i < len; i++) child[off + i] = b[off + i];
        } else {
            const alpha = -0.15 + rng() * 1.3; // slightly extended blend
            for (let i = 0; i < len; i++) child[off + i] = a[off + i] * alpha + b[off + i] * (1 - alpha);
        }
    }
    return repairGenome(child);
}

// Gaussian mutation in place, scaled per block, plus rare gene resets.
function mutate(g, rate, strength, resetProb, rng) {
    for (const blk of NN_BLOCKS.list) {
        const s = strength * blk.mutScale;
        const end = blk.off + blk.size;
        for (let i = blk.off; i < end; i++) {
            if (rng() < rate) g[i] += gaussian(rng) * s;
            if (rng() < resetProb) g[i] = gaussian(rng) * s;
        }
    }
    return repairGenome(g);
}

// Occasionally rewrite one whole row from scratch. Point mutation drifts;
// this is the operator that can actually invent a new feature detector.
function mutateRows(g, rows, strength, rng) {
    for (let n = 0; n < rows; n++) {
        const [off, len] = NN_ROWS[Math.floor(rng() * NN_ROWS.length)];
        for (let i = 0; i < len; i++) g[off + i] += gaussian(rng) * strength;
    }
    return repairGenome(g);
}

function genomeDistance(a, b, rng, samples) {
    let sum = 0;
    const n = samples || 160;
    for (let i = 0; i < n; i++) {
        const k = Math.floor(rng() * NN_GENOME_LEN);
        sum += Math.abs(a[k] - b[k]);
    }
    return sum / n;
}

const NN_ARCH_ID = `${SQ_CH}-${NN_H1}-${NN_EMB}|${GLOB_IN}+${2 * NN_EMB}-${NN_TR}|d${NN_D}`;

function serializeGenome(g, meta) {
    return JSON.stringify({
        version: NN_VERSION,
        arch: NN_ARCH_ID,
        len: NN_GENOME_LEN,
        genome: Array.from(g, v => +v.toFixed(5)),
        meta: meta || {}
    });
}

function deserializeGenome(json) {
    let obj;
    try { obj = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
    if (!obj || obj.version !== NN_VERSION || obj.arch !== NN_ARCH_ID) return null;
    if (!Array.isArray(obj.genome) || obj.genome.length !== NN_GENOME_LEN) return null;
    const g = Float64Array.from(obj.genome);
    if (!validGenome(g)) return null;
    return { genome: g, meta: obj.meta || {} };
}

if (typeof module !== 'undefined') {
    module.exports = {
        NN_VERSION, NN_ARCH_ID, NN_GENOME_LEN, NN_BLOCKS, NN_ROWS, NN_PROMO,
        makeRng, gaussian, randomGenome, cloneGenome, validGenome, repairGenome,
        forwardPolicy, toLogitsFor, crossover, mutate, mutateRows, genomeDistance,
        serializeGenome, deserializeGenome, POL
    };
}
