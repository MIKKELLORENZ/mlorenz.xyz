// Genome = flat Float64Array of every weight and bias of a feed-forward MLP.
// tanh hidden layers, tanh outputs: [roll, pitch, yaw, thrust, fire] in [-1, 1].
// No gradients anywhere — genomes only change via crossover and mutation.
'use strict';

const NN_ARCH = [25, 32, 24, 5];
// v2: yaw actually works and attitude inputs are flip-free — genomes saved
// under v1 were trained against broken physics and must not load.
const NN_VERSION = 'dogfight-ne-v2';
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

// Xavier-style init scaled to fan-in. The OUTPUT layer starts ~40× smaller:
// fresh genomes then emit near-zero commands (≈ calm hover, thanks to the
// hover-trimmed controls) with small state-responsive wiggles for selection
// to amplify. Full-size output init makes every rookie emit ±0.5 commands and
// die vertically in 3s before selection can grab anything.
function randomGenome(rng) {
    const g = new Float64Array(NN_GENOME_LEN);
    let idx = 0;
    for (let l = 1; l < NN_ARCH.length; l++) {
        const fanIn = NN_ARCH[l - 1];
        const isOutput = l === NN_ARCH.length - 1;
        const scale = Math.sqrt(1 / fanIn) * (isOutput ? 0.025 : 1);
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
// loop — called for every drone on every simulation tick.
const _scratch = NN_ARCH.map(n => new Float64Array(n));

function forward(g, input) {
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
    }
    // scrub NaN so one broken genome can't poison the sim
    const out = _scratch[NN_ARCH.length - 1];
    for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = 0;
    return out;
}

// Copy-paste crossover: pick 1-4 random cut points, then copy whole contiguous
// segments of the genome verbatim — alternating between mom and dad. The child
// is a direct patchwork of its parents' genes, no blending or averaging.
function crossover(mom, dad, rng) {
    const child = new Float64Array(NN_GENOME_LEN);
    const nCuts = 1 + Math.floor(rng() * 4);
    const cuts = [];
    for (let i = 0; i < nCuts; i++) cuts.push(1 + Math.floor(rng() * (NN_GENOME_LEN - 1)));
    cuts.sort((a, b) => a - b);
    cuts.push(NN_GENOME_LEN);

    let start = 0;
    let src = rng() < 0.5 ? mom : dad;
    for (const end of cuts) {
        for (let i = start; i < end; i++) child[i] = src[i];
        src = src === mom ? dad : mom;
        start = end;
    }
    return repairGenome(child);
}

// Per-gene mutation scale. Output-layer genes are initialized ~40× smaller
// than hidden-layer genes (see randomGenome) — mutating them with the same
// absolute σ re-randomizes the flight outputs in one hit. Measured before
// this fix: evolved children averaged 6× WORSE fitness than fresh random
// genomes, because mutation kept destroying the calibrated output layer.
const GENE_SCALE = (() => {
    const s = new Float64Array(NN_GENOME_LEN).fill(1);
    let idx = 0;
    for (let l = 1; l < NN_ARCH.length; l++) {
        const n = NN_ARCH[l] * NN_ARCH[l - 1] + NN_ARCH[l];
        if (l === NN_ARCH.length - 1) {
            for (let i = 0; i < n; i++) s[idx + i] = 0.15;
        }
        idx += n;
    }
    return s;
})();

// Gaussian mutation in place + rare gene resets, respecting per-layer scale.
function mutate(g, rate, strength, resetProb, rng) {
    for (let i = 0; i < g.length; i++) {
        if (rng() < rate) g[i] += gaussian(rng) * strength * GENE_SCALE[i];
        if (rng() < resetProb) g[i] = gaussian(rng) * 0.3 * GENE_SCALE[i];
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
        NN_ARCH, NN_VERSION, NN_GENOME_LEN, GENE_SCALE, makeRng, gaussian,
        randomGenome, cloneGenome, validGenome, repairGenome, forward,
        crossover, mutate, serializeGenome, deserializeGenome
    };
}
