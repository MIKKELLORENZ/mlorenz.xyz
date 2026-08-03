// The brain. One genome is the complete set of weights and biases of ONE
// controller, and that single controller runs EVERY light in the city - the
// genome is scored on what the whole network achieves, not what one junction
// does. Weights are shared across lights the way a convolution shares weights
// across pixels, which is also why a brain evolved on a 3x3 grid can be dropped
// straight onto a 5x5 one.
//
// The naive input layout does not fit a genetic algorithm. Each light wants to
// see, per its four arms, a full detector package; per its four road-connected
// neighbours, that neighbour's phase at thirteen points in the last thirty
// seconds; a summary of the whole network at the same thirteen lags; and a
// picture of the road map. Fed into one dense layer that is ~18k weights before
// the trunk even starts - the chess sim's lesson was that a dense first layer
// over a structured input is not GA-searchable.
//
// So the first layer is FACTORISED into small encoders that are themselves
// shared:
//
//   ARM encoder   10 -> 6    applied to each of the 4 arms      (66 genes)
//   ADJ encoder   47 -> 8    applied to each of the 4 neighbours (384 genes)
//   FAR encoder    7 -> 3    applied to each of the 4 far lights  (24 genes)
//   OWN-HISTORY   39 -> 8    this light's own phase, 13 lags     (320 genes)
//   NET-HISTORY   52 -> 8    network-wide phase mix, 13 lags     (424 genes)
//   MAP encoders  conv       16x16 city plan + 12x12 local crop  (642 genes)
//
// Their outputs plus 25 raw scalars form a 127-wide trunk vector, and the trunk
// is an ordinary 127-40-24-6 MLP. 8114 genes in total, and every gene gets
// feedback from all four arms of every light on every decision.
//
// No gradients anywhere: genomes only change through crossover and mutation.
'use strict';

// The lag ladder, in seconds. Decisions are taken once per simulated second,
// so a lag of k seconds is exactly k slots back in the ring buffer. Dense near
// zero (what just happened at the neighbouring junction) and sparse out to 30 s
// (where a platoon released half a minute ago has got to by now).
const LAGS = [1, 2, 3, 4, 5, 10, 13, 15, 18, 20, 25, 30];
const NSAMP = LAGS.length + 1;          // 13 samples: now + 12 lags
const HIST_LEN = LAGS[LAGS.length - 1] + 2;

const N_ARMS = 4, N_ADJ = 4, N_FAR = 4;
const ARM_CH = 10, ARM_OUT = 6;
const ADJ_CH = 8 + 3 * NSAMP, ADJ_OUT = 8;
const FAR_CH = 7, FAR_OUT = 3;
const OWNH_CH = 3 * NSAMP, OWNH_OUT = 8;
const NETH_CH = 4 * NSAMP, NETH_OUT = 8;
const CORE_CH = 25;

// Map encoders: a 4-filter 4x4/stride-2 convolution, tanh, 2x2 mean pool, then
// a linear read-out. The city plan and the light's own neighbourhood are both
// STATIC for a whole episode, so these run once per light per episode - they
// cost nothing per decision.
const MAPG_IN = 16, MAPG_K = 4, MAPG_S = 2, MAPG_F = 4;
const MAPG_CONV = (MAPG_IN - MAPG_K) / MAPG_S + 1;         // 7
const MAPG_POOL = MAPG_CONV >> 1;                          // 3
const MAPG_FLAT = MAPG_POOL * MAPG_POOL * MAPG_F;          // 36
const MAPG_OUT = 10;

const MAPE_IN = 12, MAPE_K = 4, MAPE_S = 2, MAPE_F = 4;
const MAPE_CONV = (MAPE_IN - MAPE_K) / MAPE_S + 1;         // 5
const MAPE_POOL = MAPE_CONV >> 1;                          // 2
const MAPE_FLAT = MAPE_POOL * MAPE_POOL * MAPE_F;          // 16
const MAPE_OUT = 8;
const MAP_OUT = MAPG_OUT + MAPE_OUT;

const TRUNK_IN = CORE_CH + N_ARMS * ARM_OUT + N_ADJ * ADJ_OUT + N_FAR * FAR_OUT
    + OWNH_OUT + NETH_OUT + MAP_OUT;                        // 127
const TRUNK_H1 = 40, TRUNK_H2 = 24;
const N_OUT = 6;      // hold / go-NS / go-EW / go-ped / amber length / all-red length

// --- genome layout ----------------------------------------------------------
// Every section is a (nIn -> nOut) block laid out as all weights (row-major,
// one row per output unit) followed by all biases. Convolutions are the same
// shape with nIn = K*K and one "row" per filter, which is what lets the
// row-wise crossover below treat a filter exactly like a neuron.
const SECTIONS = [];
function addSection(name, nIn, nOut, opts) {
    const off = SECTIONS.length ? SECTIONS[SECTIONS.length - 1].end : 0;
    const size = nIn * nOut + nOut;
    const sec = {
        name, nIn, nOut, off, wOff: off, bOff: off + nIn * nOut,
        end: off + size, size, isOut: !!(opts && opts.isOut), tiny: !!(opts && opts.tiny)
    };
    SECTIONS.push(sec);
    return sec;
}
const S_ARM = addSection('arm', ARM_CH, ARM_OUT);
const S_ADJ = addSection('adj', ADJ_CH, ADJ_OUT);
const S_FAR = addSection('far', FAR_CH, FAR_OUT);
const S_OWNH = addSection('ownHist', OWNH_CH, OWNH_OUT);
const S_NETH = addSection('netHist', NETH_CH, NETH_OUT);
const S_MAPGC = addSection('mapGlobalConv', MAPG_K * MAPG_K, MAPG_F);
const S_MAPGL = addSection('mapGlobalLin', MAPG_FLAT, MAPG_OUT);
const S_MAPEC = addSection('mapEgoConv', MAPE_K * MAPE_K, MAPE_F);
const S_MAPEL = addSection('mapEgoLin', MAPE_FLAT, MAPE_OUT);
const S_T1 = addSection('trunk1', TRUNK_IN, TRUNK_H1);
const S_T2 = addSection('trunk2', TRUNK_H1, TRUNK_H2);
const S_OUT = addSection('out', TRUNK_H2, N_OUT, { isOut: true });

const NN_GENOME_LEN = SECTIONS[SECTIONS.length - 1].end;
const NN_VERSION = 'traffic-light-ne-v1';
const NN_ARCH_ID = `arm${ARM_CH}-${ARM_OUT}|adj${ADJ_CH}-${ADJ_OUT}|far${FAR_CH}-${FAR_OUT}`
    + `|h${OWNH_CH}/${NETH_CH}|map${MAPG_OUT}+${MAPE_OUT}|t${TRUNK_IN}-${TRUNK_H1}-${TRUNK_H2}-${N_OUT}`;
const GENE_CLAMP = 6;

// --- core scalar channel map (documented so the prior and the UI can index) --
const CORE = {
    NX: 0, NY: 1,
    IS_NS: 2, IS_EW: 3, IS_PED: 4, IS_AMBER: 5, IS_ALLRED: 6,
    TIMER: 7, MIN_OK: 8, MAX_PRESS: 9,
    SINCE_NS: 10, SINCE_EW: 11, SINCE_PED: 12,
    WAIT_CARS: 13, WAIT_PEDS: 14, LOCAL_DELAY: 15,
    CLK_SIN: 16, CLK_COS: 17,
    LAST_HOLD: 18, LAST_NS: 19, LAST_EW: 20, LAST_PED: 21,
    LAST_AMBER: 22, LAST_ALLRED: 23,
    ARM_COUNT: 24
};
const ARM = {
    EXISTS: 0, QUEUE: 1, NEAREST: 2, FLOW: 3,
    PED_WAIT: 4, PED_IN: 5, PED_CLEAR: 6, SPILL: 7,
    GREEN: 8, SINCE_GREEN: 9
};

// --- genome primitives ------------------------------------------------------
function randomGenome(rng) {
    const g = new Float64Array(NN_GENOME_LEN);
    for (const s of SECTIONS) {
        // Output layer starts near zero so a fresh brain holds its phase gently
        // instead of slamming between them from tick one - the same tiny-output
        // init the boats / food-delivery brains needed.
        const scale = (s.isOut ? 0.08 : 1) * Math.sqrt(1 / s.nIn);
        for (let i = s.wOff; i < s.bOff; i++) g[i] = gaussian(rng) * scale;
        for (let i = s.bOff; i < s.end; i++) g[i] = 0;
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

function weightIndex(sec, from, to) { return sec.wOff + to * sec.nIn + from; }
function biasIndex(sec, to) { return sec.bOff + to; }

// Whole rows (a unit's incoming weights AND its bias) are inherited from one
// parent or the other. Per-gene splicing hits the permutation problem: two
// parents can compute the same feature with their units in a different order,
// so half of unit 3 from A plus half from B computes neither parent's feature.
function crossoverGenomes(a, b, rng) {
    const child = new Float64Array(NN_GENOME_LEN);
    for (const s of SECTIONS) {
        for (let o = 0; o < s.nOut; o++) {
            const src = rng() < 0.5 ? a : b;
            const row = s.wOff + o * s.nIn;
            for (let i = 0; i < s.nIn; i++) child[row + i] = src[row + i];
            child[s.bOff + o] = src[s.bOff + o];
        }
    }
    return repairGenome(child);
}

function mutateGenomeK(g, K, sigma, resetProb, rng) {
    const n = g.length;
    K = Math.max(1, Math.min(n, Math.round(K)));
    if (K >= n * 0.33) {
        const p = K / n;
        for (let i = 0; i < n; i++) {
            if (rng() < p) {
                if (rng() < resetProb) g[i] = gaussian(rng) * 0.3;
                else g[i] += gaussian(rng) * sigma;
            }
        }
    } else {
        const seen = new Set();
        while (seen.size < K) {
            const i = Math.floor(rng() * n);
            if (seen.has(i)) continue;
            seen.add(i);
            if (rng() < resetProb) g[i] = gaussian(rng) * 0.3;
            else g[i] += gaussian(rng) * sigma;
        }
    }
    return repairGenome(g);
}

// --- forward pass -----------------------------------------------------------
// Scratch buffers are module level and reused: a generation is millions of
// forward passes and allocation would dominate the cost.
const _trunk = new Float64Array(TRUNK_IN);
const _h1 = new Float64Array(TRUNK_H1);
const _h2 = new Float64Array(TRUNK_H2);
const _out = new Float64Array(N_OUT);
const _convG = new Float64Array(MAPG_CONV * MAPG_CONV * MAPG_F);
const _convE = new Float64Array(MAPE_CONV * MAPE_CONV * MAPE_F);
const _flatG = new Float64Array(MAPG_FLAT);
const _flatE = new Float64Array(MAPE_FLAT);

function denseTanh(g, sec, src, srcOff, dst, dstOff) {
    for (let o = 0; o < sec.nOut; o++) {
        let sum = g[sec.bOff + o];
        const row = sec.wOff + o * sec.nIn;
        for (let i = 0; i < sec.nIn; i++) sum += g[row + i] * src[srcOff + i];
        dst[dstOff + o] = Math.tanh(sum);
    }
}

// Single-channel convolution -> tanh -> 2x2 mean pool -> flat vector.
function convPool(g, sec, img, side, K, stride, F, conv, flat) {
    const O = (side - K) / stride + 1;
    for (let f = 0; f < F; f++) {
        const row = sec.wOff + f * K * K, bias = g[sec.bOff + f];
        for (let oy = 0; oy < O; oy++) {
            for (let ox = 0; ox < O; ox++) {
                let sum = bias;
                for (let ky = 0; ky < K; ky++) {
                    const iy = oy * stride + ky;
                    for (let kx = 0; kx < K; kx++) {
                        sum += g[row + ky * K + kx] * img[iy * side + ox * stride + kx];
                    }
                }
                conv[(f * O + oy) * O + ox] = Math.tanh(sum);
            }
        }
    }
    const P = O >> 1;
    for (let f = 0; f < F; f++) {
        for (let py = 0; py < P; py++) {
            for (let px = 0; px < P; px++) {
                const b = (f * O + py * 2) * O + px * 2;
                flat[(f * P + py) * P + px] =
                    (conv[b] + conv[b + 1] + conv[b + O] + conv[b + O + 1]) * 0.25;
            }
        }
    }
}

// Encode the two static map views. Called once per light per episode; the
// resulting MAP_OUT numbers are then handed to every decision that light takes.
function encodeMaps(g, globalPooled, egoPooled, out) {
    convPool(g, S_MAPGC, globalPooled, MAPG_IN, MAPG_K, MAPG_S, MAPG_F, _convG, _flatG);
    denseTanh(g, S_MAPGL, _flatG, 0, out, 0);
    convPool(g, S_MAPEC, egoPooled, MAPE_IN, MAPE_K, MAPE_S, MAPE_F, _convE, _flatE);
    denseTanh(g, S_MAPEL, _flatE, 0, out, MAPG_OUT);
    return out;
}

// ctx must supply:
//   core  Float64Array(CORE_CH)
//   arms  Float64Array(N_ARMS * ARM_CH)
//   adj   Float64Array(N_ADJ * ADJ_CH)
//   far   Float64Array(N_FAR * FAR_CH)
//   ownH  Float64Array(OWNH_CH)
//   netH  Float64Array(NETH_CH)
//   map   Float64Array(MAP_OUT)   (from encodeMaps)
// Returns the shared output scratch - read it immediately.
function nnForward(g, ctx, record) {
    let p = 0;
    for (let i = 0; i < CORE_CH; i++) _trunk[p++] = ctx.core[i];
    for (let a = 0; a < N_ARMS; a++) { denseTanh(g, S_ARM, ctx.arms, a * ARM_CH, _trunk, p); p += ARM_OUT; }
    for (let a = 0; a < N_ADJ; a++) { denseTanh(g, S_ADJ, ctx.adj, a * ADJ_CH, _trunk, p); p += ADJ_OUT; }
    for (let a = 0; a < N_FAR; a++) { denseTanh(g, S_FAR, ctx.far, a * FAR_CH, _trunk, p); p += FAR_OUT; }
    denseTanh(g, S_OWNH, ctx.ownH, 0, _trunk, p); p += OWNH_OUT;
    denseTanh(g, S_NETH, ctx.netH, 0, _trunk, p); p += NETH_OUT;
    for (let i = 0; i < MAP_OUT; i++) _trunk[p++] = ctx.map[i];

    denseTanh(g, S_T1, _trunk, 0, _h1, 0);
    denseTanh(g, S_T2, _h1, 0, _h2, 0);
    denseTanh(g, S_OUT, _h2, 0, _out, 0);
    for (let i = 0; i < N_OUT; i++) if (!Number.isFinite(_out[i])) _out[i] = 0;
    if (record) { record.trunk = Array.from(_trunk); record.h1 = Array.from(_h1); record.h2 = Array.from(_h2); record.out = Array.from(_out); }
    return _out;
}

// --- a faint prior ----------------------------------------------------------
// Not a controller - a scaffold. It wires up "serve whichever axis has the
// longer queue, and get more impatient the longer the current phase has run",
// which is roughly the first useful thing any actuated controller does, and
// leaves everything else (clearance lengths, pedestrians, coordination with the
// neighbours, spillback) to evolution. Roughly a quarter of a fresh population
// starts from this so the scaffold keeps re-entering the gene pool.
function createBootstrapGenome(rng) {
    const g = randomGenome(rng);
    for (let i = 0; i < g.length; i++) g[i] *= 0.25;

    // Arm encoder unit 0 = "how much traffic is queued on this arm", unit 1 =
    // "how many people are waiting to cross it".
    g[weightIndex(S_ARM, ARM.QUEUE, 0)] = 1.8;
    g[weightIndex(S_ARM, ARM.NEAREST, 0)] = -0.6;
    g[weightIndex(S_ARM, ARM.PED_WAIT, 1)] = 1.6;
    g[weightIndex(S_ARM, ARM.PED_IN, 2)] = 2.0;      // someone is in the crossing

    // Trunk unit 0 = north-south demand minus east-west demand. Arms enter the
    // trunk in compass order, ARM_OUT numbers each, after the core scalars.
    const armBase = k => CORE_CH + k * ARM_OUT;
    const t1 = (from, to, w) => { g[weightIndex(S_T1, from, to)] = w; };
    t1(armBase(0) + 0, 0, 1.5); t1(armBase(2) + 0, 0, 1.5);
    t1(armBase(1) + 0, 0, -1.5); t1(armBase(3) + 0, 0, -1.5);
    // Trunk unit 1 = impatience: how long the current phase has been running.
    t1(CORE.TIMER, 1, 2.4);
    t1(CORE.MIN_OK, 1, 0.8);
    // Trunk unit 2 = a pedestrian is still inside a crossing (do not switch).
    for (let k = 0; k < 4; k++) t1(armBase(k) + 2, 2, 1.4);
    // Trunk unit 3 = people waiting to cross anywhere here.
    for (let k = 0; k < 4; k++) t1(armBase(k) + 1, 3, 1.1);
    // Trunk unit 4 = currently serving north-south.
    t1(CORE.IS_NS, 4, 2.2); t1(CORE.IS_EW, 4, -2.2);

    for (let u = 0; u < 5; u++) g[weightIndex(S_T2, u, u)] = 1.7;

    const o = (from, to, w) => { g[weightIndex(S_OUT, from, to)] = w; };
    o(1, 0, -1.1);                       // impatient  -> stop holding
    o(2, 0, 1.6);                        // ped in the crossing -> hold
    o(0, 1, 1.3); o(0, 2, -1.3);         // demand balance -> pick the axis
    o(1, 1, 0.5); o(1, 2, 0.5);          // impatience raises both switch options
    o(4, 1, -0.6); o(4, 2, 0.6);         // already on NS -> nudge toward EW
    o(3, 3, 0.9);                        // waiting pedestrians -> the ped phase
    g[biasIndex(S_OUT, 0)] = 0.75;       // default is to hold
    g[biasIndex(S_OUT, 3)] = -1.4;       // the all-ped phase is expensive
    g[biasIndex(S_OUT, 4)] = -0.15;      // amber a little under mid-range
    g[biasIndex(S_OUT, 5)] = -0.2;       // all-red a little under mid-range

    for (let i = 0; i < g.length; i++) g[i] += gaussian(rng) * 0.02;
    return repairGenome(g);
}

function serializeGenome(g, meta) {
    return { version: NN_VERSION, arch: NN_ARCH_ID, genome: Array.from(g), meta: meta || {} };
}

function deserializeGenome(obj) {
    if (!obj || obj.version !== NN_VERSION || obj.arch !== NN_ARCH_ID) return null;
    if (!Array.isArray(obj.genome) || obj.genome.length !== NN_GENOME_LEN) return null;
    const g = Float64Array.from(obj.genome);
    if (!validGenome(g)) return null;
    return { genome: g, meta: obj.meta || {} };
}

if (typeof module !== 'undefined') {
    module.exports = {
        LAGS, NSAMP, HIST_LEN, N_ARMS, N_ADJ, N_FAR,
        ARM_CH, ADJ_CH, FAR_CH, OWNH_CH, NETH_CH, CORE_CH, MAP_OUT,
        MAPG_IN, MAPE_IN, TRUNK_IN, TRUNK_H1, TRUNK_H2, N_OUT,
        SECTIONS, S_ARM, S_ADJ, S_FAR, S_OWNH, S_NETH, S_T1, S_T2, S_OUT,
        CORE, ARM, NN_GENOME_LEN, NN_VERSION, NN_ARCH_ID, GENE_CLAMP,
        randomGenome, cloneGenome, validGenome, repairGenome,
        weightIndex, biasIndex, crossoverGenomes, mutateGenomeK,
        encodeMaps, nnForward, createBootstrapGenome,
        serializeGenome, deserializeGenome
    };
}
