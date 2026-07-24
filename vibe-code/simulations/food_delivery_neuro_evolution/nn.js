// Genome = flat Float64Array of every weight and bias of a feed-forward MLP.
// tanh hidden layers and tanh outputs (steering, throttle in [-1, 1]).
// No gradients anywhere - genomes only change via crossover and mutation.
//
// Crossover is deliberately "copy-paste": offspring genes come DIRECTLY from
// one parent or the other (k-point segment splices or per-gene uniform picks),
// never arithmetic blends.
'use strict';

// 35 base channels: 14 type-blind rays + 21 scalars (see world.js computeInputs).
// Tree rays were removed in v2 (trees only stand on already-fatal grass, so
// that channel was pure noise); v3 added the dwell-progress input so the net
// can see a pickup/delivery registering and learn to pull away when done;
// v4 added a third hidden layer (16 neurons) as a depth experiment; v5
// collapsed the three ray categories (wall / car / person) into ONE channel -
// every obstacle is equally fatal, so each ray now just reports the distance
// to the nearest object of any kind (28 fewer inputs, ~900 fewer genes).
//
// v6 adds a TEMPORAL WINDOW (borrowed from the smart_ocean_boats brain): each
// base channel is fed as its last DEPTH[ch] decision ticks, newest first, so a
// memoryless forward pass can read RATES it otherwise cannot - closing speed on
// an obstacle ray, heading-error rate (the D term of a PD steering loop), yaw
// rate, drift rate, how fast a stop line is approaching. Depth is per channel:
// the sensor rays get a deep 5-tick window (closing speed AND acceleration on
// every bearing), the rate-critical navigation/efference channels get one lag
// (depth 2), and slow or constant channels (lane, position, turn previews) stay
// depth 1 (no history) - deep lags there would be redundant weight the net must
// learn to ignore. The NN input is a full lag-0 block of all NC channels
// (so bootstrap priors and the overlay still index inp[0..32] unchanged), then
// each deeper lag appends only the channels whose depth reaches that far back.
const NC = 35;                        // base per-tick channels
const DEPTH = new Uint8Array([
    // 0-13  rays: a full 5-tick window on EVERY bearing (matching the boats
    // sensor depth). One lag gives closing speed; five give the approach's
    // acceleration and trend, so the net can anticipate a car cutting in or a
    // pedestrian accelerating off a curb before the gap actually closes -
    // not just react once it already has.
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    2,       // 14 speed        -> forward acceleration
    2,       // 15 sin hErr     -> heading-error rate (PD steering)
    1,       // 16 cos hErr
    2,       // 17 x-track       -> lateral drift rate
    2,       // 18 wp dist       -> closing speed on the next waypoint
    1,       // 19 turn 1
    1,       // 20 turn 2
    1,       // 21 route left
    1,       // 22 carrying
    2,       // 23 stop dist     -> closing speed on a red/stop line
    1,       // 24 light state
    1,       // 25 glob x
    1,       // 26 glob y
    2,       // 27 sin theta     -> yaw rate
    2,       // 28 cos theta     -> yaw rate
    2,       // 29 prev steer    -> steer slew (actuator lag)
    2,       // 30 prev gas      -> throttle slew
    1,       // 31 lane pos
    2,       // 32 dwell         -> a stop just started / is finishing
    2,       // 33 sin(route-heading-ahead - car heading) -> look-ahead turn + its rate
    1        // 34 cos(route-heading-ahead - car heading)
]);
const MAXHIST = DEPTH.reduce((m, d) => Math.max(m, d), 0);
const NN_IN = DEPTH.reduce((a, d) => a + d, 0);   // = NC + (# channels with depth > 1)
const NN_ARCH = [NN_IN, 32, 24, 16, 2];
const NN_VERSION = 'food-delivery-ne-v7';
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

// Xavier-style init scaled to fan-in; biases start at zero. The OUTPUT layer
// starts near zero (0.08x) so a fresh random car idles gently - small actions
// that mutate into useful ones far faster than a saturated tanh output that
// slams steer/throttle to the rails from tick one. (The same tiny-output-init
// trick the smart_ocean_boats and dogfight brains rely on; the bootstrap
// priors already do this deliberately, this brings the random immigrants and
// fresh runs in line.)
function randomGenome(rng) {
    const g = new Float64Array(NN_GENOME_LEN);
    let idx = 0;
    for (let l = 1; l < NN_ARCH.length; l++) {
        const fanIn = NN_ARCH[l - 1];
        const isOut = l === NN_ARCH.length - 1;
        const scale = (isOut ? 0.08 : 1) * Math.sqrt(1 / fanIn);
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

// --- Neuron-row-wise crossover --------------------------------------------
// Each child neuron (a full row of incoming weights PLUS its bias) is inherited
// WHOLESALE from one parent or the other. Still pure copy-paste - every child
// gene equals one parent's gene, no blending - but the unit of inheritance is
// the neuron, not the individual weight. Per-gene or arbitrary-cut crossover
// hits the permutation problem: two parents can compute the same function with
// their hidden neurons in a different order, so mixing half of neuron 3's
// weights from A with half from B produces a neuron that computes neither
// parent's feature. Swapping whole neurons keeps each functional unit intact -
// the lesson the smart_ocean_boats brain was built around.
function crossoverGenomes(a, b, rng) {
    const child = new Float64Array(NN_GENOME_LEN);
    const A = NN_ARCH;
    let base = 0;
    for (let l = 1; l < A.length; l++) {
        const nIn = A[l - 1], nOut = A[l];
        const wBase = base, bBase = base + nOut * nIn;
        for (let o = 0; o < nOut; o++) {
            const src = rng() < 0.5 ? a : b;          // whole neuron from one parent
            const row = wBase + o * nIn;
            for (let i = 0; i < nIn; i++) child[row + i] = src[row + i];
            child[bBase + o] = src[bBase + o];
        }
        base = bBase + nOut;
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
        NN_IN, NN_ARCH, NN_VERSION, NN_GENOME_LEN, NC, DEPTH, MAXHIST, genomeLength, weightIndex, biasIndex,
        randomGenome, cloneGenome, validGenome, repairGenome, nnForward,
        crossoverGenomes, mutateGenomeK, serializeGenome, deserializeGenome
    };
}
