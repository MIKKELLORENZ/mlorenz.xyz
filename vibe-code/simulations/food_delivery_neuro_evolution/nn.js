// Genome = flat Float64Array of every weight and bias of a feed-forward MLP.
// tanh hidden layers and tanh outputs (steering, throttle in [-1, 1]).
// No gradients anywhere - genomes only change via crossover and mutation.
//
// Crossover is deliberately "copy-paste": offspring genes come DIRECTLY from
// one parent or the other (k-point segment splices or per-gene uniform picks),
// never arithmetic blends.
'use strict';

// 33 inputs: 14 type-blind rays + 19 scalars.
// Tree rays were removed in v2 (trees only stand on already-fatal grass, so
// that channel was pure noise); v3 added the dwell-progress input so the net
// can see a pickup/delivery registering and learn to pull away when done;
// v4 added a third hidden layer (16 neurons) as a depth experiment; v5
// collapsed the three ray categories (wall / car / person) into ONE channel -
// every obstacle is equally fatal, so each ray now just reports the distance
// to the nearest object of any kind (28 fewer inputs, ~900 fewer genes).
const NN_IN = 33;
const NN_ARCH = [NN_IN, 32, 24, 16, 2];
const NN_VERSION = 'food-delivery-ne-v5';
const GENE_CLAMP = 6;

function genomeLength(arch) {
    let n = 0;
    for (let i = 1; i < arch.length; i++) n += arch[i] * arch[i - 1] + arch[i];
    return n;
}

const NN_GENOME_LEN = genomeLength(NN_ARCH);

// Flat index of weight [from -> to] in a given layer, and of a bias. Used by
// the bootstrap genome builder and the activation visualization.
function weightIndex(arch, layer, from, to) {
    let base = 0;
    for (let l = 1; l < layer; l++) base += arch[l] * arch[l - 1] + arch[l];
    return base + to * arch[layer - 1] + from;
}
function biasIndex(arch, layer, to) {
    let base = 0;
    for (let l = 1; l < layer; l++) base += arch[l] * arch[l - 1] + arch[l];
    return base + arch[layer] * arch[layer - 1] + to;
}

// Xavier-style init scaled to fan-in; biases start at zero.
function randomGenome(rng) {
    const g = new Float64Array(NN_GENOME_LEN);
    let idx = 0;
    for (let l = 1; l < NN_ARCH.length; l++) {
        const fanIn = NN_ARCH[l - 1];
        const scale = Math.sqrt(1 / fanIn);
        const nW = NN_ARCH[l] * fanIn;
        for (let i = 0; i < nW; i++) g[idx++] = gaussian(rng) * scale;
        for (let i = 0; i < NN_ARCH[l]; i++) g[idx++] = 0;
    }
    return g;
}

function cloneGenome(g) { return g.slice(); }

function validGenome(g) {
    if (!g || g.length !== NN_GENOME_LEN) return false;
    for (let i = 0; i < g.length; i++) {
        if (!Number.isFinite(g[i])) return false;
    }
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

// Allocation-free forward pass with reusable scratch buffers. If `record` is
// given, per-layer activations are copied into it (record[0] = inputs) for the
// live brain visualization. Returns the output activation array (scratch - use
// immediately or copy).
const _nnScratch = NN_ARCH.map(n => new Float64Array(n));

function nnForward(g, input, record) {
    let src = input;
    if (record) record[0] = Array.from(input);
    let idx = 0;
    for (let l = 1; l < NN_ARCH.length; l++) {
        const nIn = NN_ARCH[l - 1], nOut = NN_ARCH[l];
        const dst = _nnScratch[l];
        const biasBase = idx + nOut * nIn;
        for (let j = 0; j < nOut; j++) {
            let sum = g[biasBase + j];
            const wBase = idx + j * nIn;
            for (let i = 0; i < nIn; i++) sum += g[wBase + i] * src[i];
            dst[j] = Math.tanh(sum);
        }
        idx = biasBase + nOut;
        src = dst;
        if (record) record[l] = Array.from(dst);
    }
    for (let i = 0; i < src.length; i++) if (!Number.isFinite(src[i])) src[i] = 0;
    return src;
}

// --- Copy-paste crossover -------------------------------------------------
// 70%: k-point segment splice (1-4 random cut points; contiguous slices are
// copied alternately from each parent). 30%: per-gene uniform 50/50 pick.
// The child is always a direct combination of parent genes - no blending.
function crossoverGenomes(a, b, rng) {
    const child = new Float64Array(NN_GENOME_LEN);
    if (rng() < 0.7) {
        const nCuts = 1 + Math.floor(rng() * 4);
        const cuts = [];
        for (let c = 0; c < nCuts; c++) cuts.push(1 + Math.floor(rng() * (NN_GENOME_LEN - 1)));
        cuts.sort((x, y) => x - y);
        let useA = rng() < 0.5;
        let ci = 0;
        for (let i = 0; i < NN_GENOME_LEN; i++) {
            while (ci < cuts.length && i === cuts[ci]) { useA = !useA; ci++; }
            child[i] = useA ? a[i] : b[i];
        }
    } else {
        for (let i = 0; i < NN_GENOME_LEN; i++) child[i] = rng() < 0.5 ? a[i] : b[i];
    }
    return repairGenome(child);
}

// --- Mutation -------------------------------------------------------------
// Exactly K randomly chosen genes receive gaussian noise (K is the UI slider,
// 1 .. genome length). A tiny reset probability replaces a chosen gene with a
// fresh value instead of nudging it.
function mutateGenomeK(g, K, sigma, resetProb, rng) {
    const n = g.length;
    K = Math.max(1, Math.min(n, Math.round(K)));
    if (K >= n * 0.33) {
        // Dense regime: Bernoulli(K/n) per gene is statistically equivalent
        // and avoids building a large index set.
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

function serializeGenome(g, meta) {
    return {
        version: NN_VERSION,
        arch: NN_ARCH,
        genome: Array.from(g),
        meta: meta || {}
    };
}

function deserializeGenome(obj) {
    if (!obj || obj.version !== NN_VERSION) return null;
    if (!Array.isArray(obj.arch) || obj.arch.join(',') !== NN_ARCH.join(',')) return null;
    if (!Array.isArray(obj.genome) || obj.genome.length !== NN_GENOME_LEN) return null;
    const g = Float64Array.from(obj.genome);
    if (!validGenome(g)) return null;
    return { genome: g, meta: obj.meta || {} };
}

if (typeof module !== 'undefined') {
    module.exports = {
        NN_IN, NN_ARCH, NN_VERSION, NN_GENOME_LEN, genomeLength, weightIndex, biasIndex,
        randomGenome, cloneGenome, validGenome, repairGenome, nnForward,
        crossoverGenomes, mutateGenomeK, serializeGenome, deserializeGenome
    };
}
