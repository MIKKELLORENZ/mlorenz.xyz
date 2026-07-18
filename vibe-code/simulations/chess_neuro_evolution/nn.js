// Genome = flat Float64Array of every weight and bias of a feed-forward MLP.
// tanh hidden layers, tanh scalar output (position score in [-1, 1]).
// No gradients anywhere - genomes only change via crossover and mutation.
'use strict';

const NN_ARCH = [401, 32, 24, 1];
const NN_VERSION = 'chess-ne-v2';
const GENE_CLAMP = 6;

function genomeLength(arch) {
    let n = 0;
    for (let i = 1; i < arch.length; i++) n += arch[i] * arch[i - 1] + arch[i];
    return n;
}

const NN_GENOME_LEN = genomeLength(NN_ARCH);

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

function gaussian(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Xavier-style init scaled to fan-in.
function randomGenome(rng) {
    const g = new Float64Array(NN_GENOME_LEN);
    let idx = 0;
    for (let l = 1; l < NN_ARCH.length; l++) {
        const fanIn = NN_ARCH[l - 1];
        const scale = Math.sqrt(1 / fanIn);
        const nW = NN_ARCH[l] * fanIn;
        for (let i = 0; i < nW; i++) g[idx++] = gaussian(rng) * scale;
        for (let i = 0; i < NN_ARCH[l]; i++) g[idx++] = 0; // biases start at zero
    }
    return g;
}

function cloneGenome(g) {
    return g.slice();
}

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

// Forward pass. Reusable scratch buffers keep this allocation-free in the hot
// loop. If `record` is given, layer activations are copied into it for the
// brain visualization.
const _scratch = NN_ARCH.map(n => new Float64Array(n));

function forward(g, input, record) {
    let src = input;
    let idx = 0;
    for (let l = 1; l < NN_ARCH.length; l++) {
        const nIn = NN_ARCH[l - 1], nOut = NN_ARCH[l];
        const dst = _scratch[l];
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
    const out = src[0];
    return Number.isFinite(out) ? out : 0;
}

// Blended (arithmetic) crossover with slightly extended alpha range, plus
// occasional uniform gene picks. Child is always freshly allocated.
function crossover(a, b, rng) {
    const child = new Float64Array(NN_GENOME_LEN);
    const uniform = rng() < 0.2;
    for (let i = 0; i < NN_GENOME_LEN; i++) {
        if (uniform) {
            child[i] = rng() < 0.5 ? a[i] : b[i];
        } else {
            const alpha = -0.1 + rng() * 1.2;
            child[i] = a[i] * alpha + b[i] * (1 - alpha);
        }
    }
    return repairGenome(child);
}

// Gaussian mutation in place + rare gene resets.
function mutate(g, rate, strength, resetProb, rng) {
    for (let i = 0; i < g.length; i++) {
        if (rng() < rate) g[i] += gaussian(rng) * strength;
        if (rng() < resetProb) g[i] = gaussian(rng) * 0.3;
    }
    return repairGenome(g);
}

function serializeGenome(g, meta) {
    return JSON.stringify({
        version: NN_VERSION,
        arch: NN_ARCH,
        genome: Array.from(g),
        meta: meta || {}
    });
}

function deserializeGenome(json) {
    let obj;
    try { obj = JSON.parse(json); } catch (e) { return null; }
    if (!obj || obj.version !== NN_VERSION) return null;
    if (!Array.isArray(obj.arch) || obj.arch.join(',') !== NN_ARCH.join(',')) return null;
    if (!Array.isArray(obj.genome) || obj.genome.length !== NN_GENOME_LEN) return null;
    const g = Float64Array.from(obj.genome);
    if (!validGenome(g)) return null;
    return { genome: g, meta: obj.meta || {} };
}

if (typeof module !== 'undefined') {
    module.exports = {
        NN_ARCH, NN_VERSION, NN_GENOME_LEN, makeRng, gaussian, randomGenome,
        cloneGenome, validGenome, repairGenome, forward, crossover, mutate,
        serializeGenome, deserializeGenome
    };
}
