// The brain. One genome is the complete set of weights and biases of ONE
// control-room operator, and that operator runs every substation, every line and
// every generator of whatever network it is dropped into.
//
// A dense layer over a power system does not work and cannot be made to work.
// The input would have to be a flat vector of a specific network's specific
// buses in a specific order, so a genome evolved on fourteen buses would be
// meaningless on twenty-two, and the weights that learned "watch the loading on
// line 7" would learn nothing about line 8. So the architecture is a GRAPH
// NETWORK with shared weights:
//
//   EDGE ENCODER   applied to every directed branch end, seeing the branch and
//                  both of the substations it joins
//   NODE UPDATE    applied to every substation, seeing itself, the mean and max
//                  of its incident edge messages, and the system context
//   ...twice, so information travels two substations before a decision
//   HEADS          one per action type, each applied to every candidate: every
//                  generator, every line, every substation, every busbar
//
// Permutation invariance and size invariance are exact by construction - mean
// and max are the only aggregations, and no weight is indexed by a bus number.
// A genome evolved on IEEE 14 runs unchanged on a thirty-bus network it has
// never seen, which is the only way to ask whether it learned power flow or
// memorised twenty lines.
//
// No gradients anywhere. Genomes change only through crossover and mutation.
'use strict';

const GLOBAL_CH = 20;
const NODE_CH = 23;
const EDGE_CH = 20;
const GEN_CH = 13;
const ELEM_CH = 10;

const GLOB_H = 12;
const EDGE_H = 12;
const NODE_H = 16;
const CTX_H = 12;

// --- channel maps -----------------------------------------------------------
// Documented as index objects rather than magic numbers because world.js fills
// them, the inspector reads them back, and the bootstrap prior wires specific
// ones straight through to specific outputs.
const GLB = {
    CLK_SIN: 0, CLK_COS: 1, WEEKEND: 2,
    LOAD_REL: 3, RENEW_SHARE: 4,
    RES_UP: 5, RES_DN: 6,
    MAX_LOAD: 7, MEAN_LOAD: 8, FRAC_HOT: 9, FRAC_OUT: 10,
    N1_WORST: 11, N1_FRAC: 12,
    LOSSES: 13, SLACK_P: 14, T_REMAIN: 15,
    VMIN: 16, VMAX: 17, FC_LOAD: 18, FC_RENEW: 19
};

const ND = {
    VM1: 0, VM2: 1, VA_SIN: 2, VA_COS: 3,
    PLOAD: 4, QLOAD: 5, PGEN: 6, QGEN: 7, PINJ: 8,
    HAS_DISP: 9, HAS_RENEW: 10, IS_SLACK: 11,
    DEG: 12, SPLIT: 13, SUB_CD: 14,
    MAX_LOAD: 15, N1_LOCAL: 16,
    HEAD_UP: 17, HEAD_DN: 18, RENEW_NOW: 19,
    IS_HV: 20, SHED: 21, SENS_WORST: 22
};

const ED = {
    IN_SERVICE: 0, LOADING: 1, P_FLOW: 2, Q_FLOW: 3,
    RATE: 4, X: 5, R_OVER_X: 6, IS_XFMR: 7,
    HEAT: 8, COOLDOWN: 9,
    N1_ON_ME: 10, N1_BY_ME: 11,
    VM_OTHER: 12, DANGLE: 13, SPLIT_OTHER: 14,
    LEN: 15, LOSS: 16, WOULD_ISLAND: 17, DEG_OTHER: 18,
    RELIEF: 19
};

const GN = {
    P: 0, PMAX: 1, PMIN_FRAC: 2, COST: 3, RAMP_FRAC: 4,
    IS_RENEW: 5, AVAIL: 6, ON: 7,
    HEAD_UP: 8, HEAD_DN: 9, Q_USE: 10, SENS: 11, RELIEF: 12
};

const EL = {
    IS_BRANCH: 0, IS_GEN: 1, IS_LOAD: 2, ON_BUS2: 3,
    P_FLOW: 4, S_MAG: 5, LOADING: 6, IS_XFMR: 7, OUT: 8, SIZE: 9
};

// --- genome layout ----------------------------------------------------------
// Every section is a (nIn -> nOut) block laid out as all weights (row-major, one
// row per output unit) followed by all biases, so the row-wise crossover below
// can treat a unit as an indivisible thing.
const SECTIONS = [];
function addSection(name, nIn, nOut, opts) {
    const off = SECTIONS.length ? SECTIONS[SECTIONS.length - 1].end : 0;
    const size = nIn * nOut + nOut;
    const sec = {
        name, nIn, nOut, off, wOff: off, bOff: off + nIn * nOut,
        end: off + size, size, isOut: !!(opts && opts.isOut)
    };
    SECTIONS.push(sec);
    return sec;
}

const S_GLOB = addSection('global', GLOBAL_CH, GLOB_H);
const S_E1 = addSection('edge1', EDGE_CH + 2 * NODE_CH, EDGE_H);
const S_N1 = addSection('node1', NODE_CH + 2 * EDGE_H + GLOB_H, NODE_H);
const S_E2 = addSection('edge2', EDGE_CH + EDGE_H + 2 * NODE_H, EDGE_H);
const S_N2 = addSection('node2', NODE_H + 2 * EDGE_H + GLOB_H, NODE_H);
const S_CTX = addSection('context', 2 * NODE_H + GLOB_H, CTX_H);
const S_GEN1 = addSection('genHidden', GEN_CH + NODE_H + CTX_H, 10);
const S_GEN2 = addSection('genOut', 10, 2, { isOut: true });
const S_LINE1 = addSection('lineHidden', EDGE_CH + EDGE_H + 2 * NODE_H + CTX_H, 10);
const S_LINE2 = addSection('lineOut', 10, 1, { isOut: true });
const S_SUB1 = addSection('subHidden', NODE_CH + NODE_H + CTX_H, 10);
const S_SUB2 = addSection('subOut', 10, 1, { isOut: true });
const S_EL1 = addSection('elemHidden', ELEM_CH + 2 * NODE_H + CTX_H, 8);
const S_EL2 = addSection('elemOut', 8, 1, { isOut: true });
const S_NO1 = addSection('noopHidden', CTX_H + 2 * NODE_H, 8);
const S_NO2 = addSection('noopOut', 8, 1, { isOut: true });

const NN_GENOME_LEN = SECTIONS[SECTIONS.length - 1].end;
const NN_VERSION = 'power-grid-ne-v1';
const NN_ARCH_ID = `g${GLOBAL_CH}-${GLOB_H}|n${NODE_CH}-${NODE_H}|e${EDGE_CH}-${EDGE_H}`
    + `|ctx${CTX_H}|gen${GEN_CH}|elem${ELEM_CH}|L${NN_GENOME_LEN}`;
const GENE_CLAMP = 6;

// --- genome primitives ------------------------------------------------------
function randomGenome(rng) {
    const g = new Float64Array(NN_GENOME_LEN);
    for (const s of SECTIONS) {
        // Output layers start near zero. A fresh operator that immediately
        // slams every generator to a ramp limit and opens a line every five
        // minutes is not a starting point evolution can improve on - it is a
        // blackout. The same tiny-output init the boats and traffic brains
        // needed, for the same reason.
        const scale = (s.isOut ? 0.06 : 1) * Math.sqrt(1 / s.nIn);
        for (let i = s.wOff; i < s.bOff; i++) g[i] = gaussian(rng) * scale;
        for (let i = s.bOff; i < s.end; i++) g[i] = 0;
    }
    // The do-nothing threshold. Switching is expensive and rare, so this starts
    // above zero: a population that begins by thrashing the topology never
    // recovers, and this engine has watched one do it.
    //
    // It used to be 1.2, which was too much of a good thing. The discrete heads
    // are scored against this number, and with output weights initialised at
    // ×0.06 their scores are three orders of magnitude smaller — so 1.2 did not
    // make switching rare, it made switching *impossible* for the entire initial
    // population, and left it reachable only by the mutation that happens to
    // land on one of the sixty genes in this bias or its head. A whole action
    // class, the one the brief calls out as the interesting half of the problem,
    // was effectively not in the search.
    //
    // 0.6 is affordable now in a way it would not have been earlier: the
    // thrashing failure came from a champion crowned on RAW euro advantage, and
    // advantage is now normalised by the day's own scale; and the audition
    // deliberately grades every genome on a quiet day, where a spurious switch
    // is simply a cost with nothing to show for it.
    g[S_NO2.bOff] = 0.6;
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

// Whole rows - a unit's incoming weights AND its bias - are inherited from one
// parent or the other. Per-gene splicing hits the permutation problem: two
// parents can compute the same feature with their hidden units in a different
// order, so half of unit 3 from A plus half from B computes neither parent's
// feature.
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
// One layer, gathering its input from several arrays laid end to end. Every
// layer in this file is a concatenation of embeddings that live in different
// buffers, and copying them into a contiguous scratch first would cost more than
// the multiply-accumulate does.  `parts` is a list of [array, offset, length].
// Scratch for the gathered input row. Sized once to the widest section, reused
// by every call: a generation is hundreds of thousands of forward passes.
const DENSE_X = new Float64Array(256);

function denseFrom(g, sec, parts, dst, dstOff, act) {
    const nIn = sec.nIn, nOut = sec.nOut, wOff = sec.wOff, bOff = sec.bOff;
    const x = DENSE_X;

    // The inputs are GATHERED into one contiguous row before the multiply,
    // rather than walking `parts` inside the output loop. `parts` is an array of
    // [Float64Array, offset, length] triples, so reading a[0]/a[1]/a[2] from
    // inside the loop is a megamorphic element access repeated once per output
    // unit - and this net has four message-passing layers of ~60 inputs each,
    // evaluated for every edge and every node, every five simulated minutes.
    // Gathering costs nIn copies and saves nOut passes over the descriptors; it
    // took the forward pass from 37% of a training episode to about 15%. The
    // accumulation order is unchanged, so results are bit-identical.
    let p = 0;
    for (let k = 0; k < parts.length; k++) {
        const a = parts[k], arr = a[0], off = a[1], len = a[2];
        for (let i = 0; i < len; i++) x[p + i] = arr[off + i];
        p += len;
    }

    for (let o = 0; o < nOut; o++) {
        let sum = g[bOff + o];
        const row = wOff + o * nIn;
        for (let i = 0; i < nIn; i++) sum += g[row + i] * x[i];
        dst[dstOff + o] = act === false ? sum : Math.tanh(sum);
    }
}

// Buffers are sized for one network and reused for every genome and every step
// on that network. A generation is hundreds of thousands of forward passes and
// allocation would dominate.
class Embedding {
    constructor(net) {
        this.net = net;
        const nS = net.nBus, nB = net.nBranch;
        this.nSub = nS; this.nBranch = nB;
        this.glob = new Float64Array(GLOB_H);
        this.e1 = new Float64Array(nB * 2 * EDGE_H);
        this.n1 = new Float64Array(nS * NODE_H);
        this.e2 = new Float64Array(nB * 2 * EDGE_H);
        this.n2 = new Float64Array(nS * NODE_H);
        this.ctx = new Float64Array(CTX_H);
        this.aggMean = new Float64Array(nS * EDGE_H);
        this.aggMax = new Float64Array(nS * EDGE_H);
        this.poolMean = new Float64Array(NODE_H);
        this.poolMax = new Float64Array(NODE_H);
        this.tmpAgg = new Float64Array(2 * EDGE_H);
        this.tmpH = new Float64Array(16);
        this.tmpOut = new Float64Array(4);
        this.lineLogit = new Float64Array(nB);
        this.subLogit = new Float64Array(nS);
        this.genOut = new Float64Array(net.nGen * 2);
        // Incidence: for every substation, the directed edge ends attached to it.
        this.inc = [];
        for (let s = 0; s < nS; s++) this.inc.push([]);
        for (let b = 0; b < nB; b++) {
            this.inc[net.branch[b].f].push(b * 2);
            this.inc[net.branch[b].t].push(b * 2 + 1);
        }
    }
}

// One full pass over the graph. After this the heads are cheap: every action
// candidate reads embeddings that already exist.
function encodeGraph(g, obs, emb) {
    const net = obs.net, nS = net.nBus, nB = net.nBranch;
    denseFrom(g, S_GLOB, [[obs.global, 0, GLOBAL_CH]], emb.glob, 0);

    // Round 1: edge messages, then node update.
    for (let b = 0; b < nB; b++) {
        for (let side = 0; side < 2; side++) {
            const d = b * 2 + side;
            const src = side === 0 ? net.branch[b].f : net.branch[b].t;
            const dst = side === 0 ? net.branch[b].t : net.branch[b].f;
            denseFrom(g, S_E1, [
                [obs.edge, d * EDGE_CH, EDGE_CH],
                [obs.node, src * NODE_CH, NODE_CH],
                [obs.node, dst * NODE_CH, NODE_CH]
            ], emb.e1, d * EDGE_H);
        }
    }
    aggregate(emb, emb.e1, EDGE_H);
    for (let s = 0; s < nS; s++) {
        denseFrom(g, S_N1, [
            [obs.node, s * NODE_CH, NODE_CH],
            [emb.aggMean, s * EDGE_H, EDGE_H],
            [emb.aggMax, s * EDGE_H, EDGE_H],
            [emb.glob, 0, GLOB_H]
        ], emb.n1, s * NODE_H);
    }

    // Round 2: the same again, now on top of round-1 embeddings, so a
    // substation's decision can depend on what is happening two substations
    // away - which is roughly the radius over which a switching action matters.
    for (let b = 0; b < nB; b++) {
        for (let side = 0; side < 2; side++) {
            const d = b * 2 + side;
            const src = side === 0 ? net.branch[b].f : net.branch[b].t;
            const dst = side === 0 ? net.branch[b].t : net.branch[b].f;
            denseFrom(g, S_E2, [
                [obs.edge, d * EDGE_CH, EDGE_CH],
                [emb.e1, d * EDGE_H, EDGE_H],
                [emb.n1, src * NODE_H, NODE_H],
                [emb.n1, dst * NODE_H, NODE_H]
            ], emb.e2, d * EDGE_H);
        }
    }
    aggregate(emb, emb.e2, EDGE_H);
    for (let s = 0; s < nS; s++) {
        denseFrom(g, S_N2, [
            [emb.n1, s * NODE_H, NODE_H],
            [emb.aggMean, s * EDGE_H, EDGE_H],
            [emb.aggMax, s * EDGE_H, EDGE_H],
            [emb.glob, 0, GLOB_H]
        ], emb.n2, s * NODE_H);
    }

    // Whole-system readout. Mean and max over substations - not sum, because a
    // sum would grow with network size and a brain evolved on fourteen buses
    // would saturate on thirty.
    emb.poolMean.fill(0);
    emb.poolMax.fill(-1e9);
    for (let s = 0; s < nS; s++) {
        for (let k = 0; k < NODE_H; k++) {
            const v = emb.n2[s * NODE_H + k];
            emb.poolMean[k] += v;
            if (v > emb.poolMax[k]) emb.poolMax[k] = v;
        }
    }
    for (let k = 0; k < NODE_H; k++) {
        emb.poolMean[k] /= Math.max(1, nS);
        if (emb.poolMax[k] < -1e8) emb.poolMax[k] = 0;
    }
    denseFrom(g, S_CTX, [
        [emb.poolMean, 0, NODE_H],
        [emb.poolMax, 0, NODE_H],
        [emb.glob, 0, GLOB_H]
    ], emb.ctx, 0);
    return emb;
}

function aggregate(emb, msg, H) {
    const nS = emb.nSub;
    emb.aggMean.fill(0);
    emb.aggMax.fill(0);
    for (let s = 0; s < nS; s++) {
        const list = emb.inc[s];
        if (!list.length) continue;
        for (let k = 0; k < H; k++) {
            let sum = 0, mx = -1e9;
            for (let j = 0; j < list.length; j++) {
                const v = msg[list[j] * H + k];
                sum += v;
                if (v > mx) mx = v;
            }
            emb.aggMean[s * H + k] = sum / list.length;
            emb.aggMax[s * H + k] = mx;
        }
    }
}

// --- heads ------------------------------------------------------------------
// out[0] = redispatch, tanh, as a fraction of this unit's five-minute ramp.
// out[1] = curtailment for a renewable, tanh mapped to [0, 1].
function headGen(g, obs, emb, gi, out) {
    const bus = obs.net.gen[gi].bus;
    denseFrom(g, S_GEN1, [
        [obs.gen, gi * GEN_CH, GEN_CH],
        [emb.n2, bus * NODE_H, NODE_H],
        [emb.ctx, 0, CTX_H]
    ], emb.tmpH, 0);
    denseFrom(g, S_GEN2, [[emb.tmpH, 0, 10]], out, 0);
    return out;
}

function headLine(g, obs, emb, b) {
    const br = obs.net.branch[b];
    denseFrom(g, S_LINE1, [
        [obs.edge, (b * 2) * EDGE_CH, EDGE_CH],
        [emb.e2, (b * 2) * EDGE_H, EDGE_H],
        [emb.n2, br.f * NODE_H, NODE_H],
        [emb.n2, br.t * NODE_H, NODE_H],
        [emb.ctx, 0, CTX_H]
    ], emb.tmpH, 0);
    denseFrom(g, S_LINE2, [[emb.tmpH, 0, 10]], emb.tmpOut, 0, false);
    return emb.tmpOut[0];
}

function headSub(g, obs, emb, s) {
    denseFrom(g, S_SUB1, [
        [obs.node, s * NODE_CH, NODE_CH],
        [emb.n2, s * NODE_H, NODE_H],
        [emb.ctx, 0, CTX_H]
    ], emb.tmpH, 0);
    denseFrom(g, S_SUB2, [[emb.tmpH, 0, 10]], emb.tmpOut, 0, false);
    return emb.tmpOut[0];
}

// One busbar decision for one element of one substation. Positive means busbar
// 2. The far-end embedding is what lets "put these two lines on the same busbar"
// mean something: without it the head cannot tell which elements belong together.
function headElem(g, obs, emb, s, i, elemFeat) {
    const e = obs.net.subs[s].elems[i];
    const far = e.kind === 'br' ? e.other : s;
    denseFrom(g, S_EL1, [
        [elemFeat, i * ELEM_CH, ELEM_CH],
        [emb.n2, s * NODE_H, NODE_H],
        [emb.n2, far * NODE_H, NODE_H],
        [emb.ctx, 0, CTX_H]
    ], emb.tmpH, 0);
    denseFrom(g, S_EL2, [[emb.tmpH, 0, 8]], emb.tmpOut, 0, false);
    return emb.tmpOut[0];
}

// The bar every topological action has to clear. Nothing is the default, and it
// should be: a switching action on a healthy network is pure risk.
function headNoop(g, obs, emb) {
    denseFrom(g, S_NO1, [
        [emb.ctx, 0, CTX_H],
        [emb.poolMean, 0, NODE_H],
        [emb.poolMax, 0, NODE_H]
    ], emb.tmpH, 0);
    denseFrom(g, S_NO2, [[emb.tmpH, 0, 8]], emb.tmpOut, 0, false);
    return emb.tmpOut[0];
}

// --- a faint prior ----------------------------------------------------------
// Not a controller - a scaffold. It wires up the one reflex every operator has:
// when a line is over its limit, move the generators whose sensitivity says they
// can relieve it, in the direction that relieves it, in proportion to how bad it
// is. The RELIEF channel is exactly that product, precomputed by world.js from
// the same PTDF table the greedy baseline uses - the brain is given no
// information the baseline does not also have.
//
// Everything else - when to switch, which busbar, how much curtailment costs,
// what to do about N-1, whether to act before a limit is broken rather than
// after - is left to evolution. Roughly a quarter of a fresh population starts
// from this, so the scaffold keeps re-entering the gene pool.
function createBootstrapGenome(rng) {
    const g = randomGenome(rng);
    for (let i = 0; i < g.length; i++) g[i] *= 0.25;

    // Generator hidden unit 0 = "moving me up relieves the binding constraint".
    g[weightIndex(S_GEN1, GN.RELIEF, 0)] = 2.6;
    g[weightIndex(S_GEN1, GN.HEAD_UP, 0)] = 0.7;
    // unit 1 = "moving me down relieves it" (the mirror image).
    g[weightIndex(S_GEN1, GN.RELIEF, 1)] = -2.6;
    g[weightIndex(S_GEN1, GN.HEAD_DN, 1)] = 0.7;
    // unit 2 = "I am expensive", so that when nothing is binding the cheap unit
    // is the one that moves up.
    g[weightIndex(S_GEN1, GN.COST, 2)] = 1.9;
    // unit 3 = "I am a renewable with output to give up".
    g[weightIndex(S_GEN1, GN.IS_RENEW, 3)] = 1.6;
    g[weightIndex(S_GEN1, GN.P, 3)] = 1.1;

    // The OUTPUT gains are deliberately small - a tenth of what the hidden layer
    // wiring above would suggest. This prior is a scaffold, not a controller,
    // and the difference matters more than it looks: measured against a
    // do-nothing control room over six days of the storm tier, the reflex wired
    // at full gain redispatched 240-450 MWh a day and lost 63k a day doing it,
    // because a reflex with no sense of *how much* is needed overshoots on every
    // interval it fires. A quarter of the starting population is bootstrapped,
    // so that lineage's damage is what the rest of the run has to climb out of.
    // Wired small it points in the same direction and costs almost nothing, and
    // evolution is free to turn the gain up wherever it pays. Every other sim on
    // this site landed on the same rule from the other end - tiny output-layer
    // init was the single change that made the dogfight, food-delivery and
    // planetary runs learn at all.
    g[weightIndex(S_GEN2, 0, 0)] = 0.34;     // relief-up  -> ramp up
    g[weightIndex(S_GEN2, 1, 0)] = -0.34;    // relief-down -> ramp down
    g[weightIndex(S_GEN2, 2, 0)] = -0.08;    // expensive  -> back off
    g[biasIndex(S_GEN2, 0)] = 0;
    g[biasIndex(S_GEN2, 1)] = -1.6;          // curtailment starts firmly off

    // The line head gets the same reflex at a much lower gain, because opening a
    // line to fix an overload is a far more dangerous move than nudging a
    // generator and the do-nothing bar below is deliberately set above it.
    g[weightIndex(S_LINE1, ED.RELIEF, 0)] = 1.7;
    g[weightIndex(S_LINE1, ED.LOADING, 1)] = 1.4;
    g[weightIndex(S_LINE1, ED.IN_SERVICE, 2)] = -2.2;    // a line that is OUT
    g[weightIndex(S_LINE1, ED.COOLDOWN, 2)] = -1.5;      //   and free to return
    // The switching heads keep their full gain, and the distinction matters.
    // Shrinking a CONTINUOUS output means acting gently, which is what the rule
    // above is for. Shrinking a DISCRETE one means never acting at all: these
    // scores compete against the no-op score, so a small gain does not produce a
    // cautious switch, it produces no switch ever, and the whole action type
    // drops out of the search until mutation happens to drift it back. Cutting
    // these to a fifth alongside the generator gains took the population from a
    // few switching actions a day to a measured zero for twenty-five straight
    // generations.
    g[weightIndex(S_LINE2, 0, 0)] = 0.9;
    g[weightIndex(S_LINE2, 2, 0)] = 1.3;                 // reconnect what is out
    g[biasIndex(S_LINE2, 0)] = -0.4;

    g[biasIndex(S_SUB2, 0)] = -0.8;
    g[weightIndex(S_SUB1, ND.MAX_LOAD, 0)] = 1.5;
    g[weightIndex(S_SUB2, 0, 0)] = 0.7;

    // Do nothing unless something is actually wrong.
    g[weightIndex(S_NO1, GLB.MAX_LOAD, 0)] = 0;
    g[biasIndex(S_NO2, 0)] = 0.9;

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
        GLOBAL_CH, NODE_CH, EDGE_CH, GEN_CH, ELEM_CH,
        GLOB_H, EDGE_H, NODE_H, CTX_H,
        GLB, ND, ED, GN, EL, SECTIONS,
        S_GLOB, S_E1, S_N1, S_E2, S_N2, S_CTX, S_GEN1, S_GEN2,
        S_LINE1, S_LINE2, S_SUB1, S_SUB2, S_EL1, S_EL2, S_NO1, S_NO2,
        NN_GENOME_LEN, NN_VERSION, NN_ARCH_ID, GENE_CLAMP,
        randomGenome, cloneGenome, validGenome, repairGenome,
        weightIndex, biasIndex, crossoverGenomes, mutateGenomeK,
        Embedding, encodeGraph, headGen, headLine, headSub, headElem, headNoop,
        createBootstrapGenome, serializeGenome, deserializeGenome
    };
}
