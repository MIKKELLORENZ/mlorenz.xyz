/* nn.js — plain feedforward network. Sigmoid outputs, and the HIDDEN activation
 * is a per-brain gene (see ACTS below).
 * Evolved only: no gradients anywhere, no optimiser, no loss function.
 * Lifted wholesale from the smart_ocean_boats sim, where the two design choices
 * that matter here were already paid for in failed runs: a near-zero output
 * layer at birth, and row-wise (whole-neuron) crossover. */
"use strict";

/* ------------------------------------------------------------ activations
 *
 * tanh is the default and it is NOT an oversight, so it is worth writing down
 * why, and then testing it anyway rather than arguing about it.
 *
 * ReLU won deep learning on a gradient argument: sigmoid and tanh saturate, the
 * derivative vanishes, and a deep backprop net stops learning. There is no
 * gradient anywhere in this project, so the single strongest reason to prefer
 * ReLU does not apply. What is left runs the other way:
 *
 *   - ReLU is positively homogeneous, so scaling an early weight by k scales
 *     everything downstream by k. Over three layers those factors multiply and
 *     a fixed-sigma mutation produces a heavy-tailed change in behaviour. tanh
 *     saturates, so a large mutation makes a BOUNDED change. A hill-climber
 *     needs the weights -> behaviour map to be locally smooth, and saturation
 *     is what buys that.
 *   - A dead ReLU is permanent here. No gradient revives a unit whose
 *     pre-activation went negative for good; the lineage just carries it.
 *     Leaky ReLU is the direct answer to this one, which is why it is in the
 *     list and why the slope is a generous 0.1 rather than the usual 0.01.
 *   - The output layer is sigmoid and drives PD setpoints. Unbounded hidden
 *     activations pin those sigmoids at 0 or 1 — bang-bang joint targets and
 *     chattering servos. That is a control problem a classifier never has.
 *   - It is two hidden layers. ReLU's advantage scales with depth.
 *   - OUT_INIT = 0.08 is what makes a newborn's sigmoids sit near 0.5, i.e.
 *     "hold the nominal standing pose". Small output weights only imply a small
 *     action if the hidden activations are bounded.
 *
 * That is a sound argument, not evidence, so the trainer runs the three side by
 * side as fixed demes on identical missions and lets selection answer it. The
 * init scale is deliberately IDENTICAL for all three (He, sqrt(2/nIn)) — He is
 * the ReLU-appropriate choice and merely slightly wide for tanh, and using a
 * different init per activation would confound the comparison with the thing
 * being compared. */
const LRELU_SLOPE = 0.1;
const ACTS = {
    tanh: x => Math.tanh(x),
    lrelu: x => (x > 0 ? x : LRELU_SLOPE * x),
    relu: x => (x > 0 ? x : 0)
};
const ACT_NAMES = Object.keys(ACTS);

/* ------------------------------------------------- the slope is PER NEURON
 *
 * ReLU and leaky ReLU are the SAME function with a different negative slope —
 * identical for every positive pre-activation, differing only in what they do
 * below zero. That is why these two can interbreed when tanh cannot: a row of
 * weights moved from a ReLU parent into a leaky child still computes what it
 * computed on the positive side, and is merely scaled by 0.1 rather than
 * flattened on the negative side. Transplanting the same row into a tanh net
 * changes what it computes everywhere, which is why Net.crossover still
 * refuses that pairing.
 *
 * So the slope is stored per HIDDEN UNIT, not per network, and row-wise
 * crossover carries each neuron's slope along with its weights. A child of a
 * ReLU parent and a leaky parent is genuinely mixed at the level of individual
 * neurons — some units rectify hard, some leak — and selection gets to decide
 * the proportion instead of it being declared up front.
 *
 * SLOPE_VALUES is deliberately two-valued rather than a continuous gene. A
 * free-floating slope per unit is a much larger search space, and the question
 * on the table is ReLU versus leaky ReLU, not "find the optimal rectifier". */
const SLOPE_VALUES = { relu: 0, lrelu: LRELU_SLOPE };
/* A neuron flips its slope this often per mutation call. Small, and it exists
 * for one reason: crossover can only recombine what the pool still contains, so
 * if drift ever wipes out every leaky unit there would be no way back. Same
 * insurance as the rare full weight reset below.
 *
 * OFF BY DEFAULT, and that is load-bearing. In deme mode the experiment is
 * "pure ReLU versus pure leaky versus pure tanh", and a flip mutation would
 * quietly turn each deme into a hybrid pool — the comparison would stop
 * measuring what its own label says. The trainer switches it on only for an
 * interbreeding run, where mixing is the point. */
let SLOPE_FLIP = 0;
/* A real top-level declaration, not just an entry on module.exports. The sim
 * files are loaded into one shared context with vm.runInThisContext, where only
 * globals are visible across files — evolution.js calls this, and an arrow
 * function hidden inside the exports object is a ReferenceError there. */
function setSlopeFlip(v) { SLOPE_FLIP = +v || 0; }
function slopeFlip() { return SLOPE_FLIP; }

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Output-layer init scale, as a fraction of the He scale used on the hidden
 * layers. Small keeps newborns near their trim pose — but too small and every
 * newborn IS the trim pose, the population is functionally one individual, and
 * selection has nothing to grip.
 *
 * OUT_ROW_SCALE lets that be decided per output rather than for the layer as a
 * whole, which is what this sim needed: the 18 posture outputs stay tiny (so a
 * newborn stands), while the rhythm outputs are seeded wide (so a newborn
 * population contains a spread of attempted gaits). Uniformly widening the
 * layer instead was measured and is much worse — it destroys the posture along
 * with everything else. */
let OUT_INIT = 0.08;
let OUT_ROW_SCALE = null;

/* Box-Muller makes two gaussians at a time and the second was cached in a
 * MODULE-level variable, which quietly made `--seed` a lie: the spare survives
 * across every Net, every mutation and every Evolution in the process, so what
 * a given seed produced depended on how many gaussians anything else had drawn
 * first. Two identical runs in one process diverged — caught by the
 * "one deme is deterministic" test, which builds two Evolutions from the same
 * seed and compares them.
 *
 * The spare now lives on the rng function it was drawn from, so a stream is
 * self-contained and a seed means the same thing wherever it is used. */
function gaussRand(rng) {
    if (rng._spare !== undefined && rng._spare !== null) { const s = rng._spare; rng._spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    rng._spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
}

class Net {
    constructor(sizes, initRng, act) {
        this.sizes = sizes.slice();
        /* Which hidden activation this brain uses. A GENE, not a global: it is
         * inherited by clone and crossover and written into the JSON, so a
         * saved brain always replays with the activation it was evolved under.
         * An unknown or missing value falls back to tanh, which is what every
         * brain saved before this existed was trained with. */
        this.act = ACTS[act] ? act : "tanh";
        /* Per-hidden-layer, per-unit negative slope. null for tanh, which is a
         * whole-network activation and does not mix with the other two. Every
         * unit starts at the slope its named activation implies; crossover and
         * the flip mutation are what make a net non-uniform after that. */
        this.slopes = null;
        if (this.act !== "tanh") {
            this.slopes = [];
            for (let l = 0; l < sizes.length - 2; l++) {
                const s = new Float32Array(sizes[l + 1]);
                s.fill(SLOPE_VALUES[this.act]);
                this.slopes.push(s);
            }
        }
        this.weights = [];   // per layer: Float32Array (out × (in + 1)), bias last column
        for (let l = 0; l < sizes.length - 1; l++) {
            const nIn = sizes[l], nOut = sizes[l + 1];
            const w = new Float32Array(nOut * (nIn + 1));
            if (initRng) {
                // He-style scale on hidden layers; the output layer starts near zero
                // so a newborn's sigmoids all sit at ~0.5. Downstream that maps to
                // "hold the nominal standing pose" — the walker equivalent of hover
                // trim. Small actions mutate into useful ones far faster than
                // saturated ones do.
                const isOut = l === sizes.length - 2;
                const scale = (isOut ? OUT_INIT : 1.0) * Math.sqrt(2 / nIn);
                const rowLen = nIn + 1;
                for (let o = 0; o < nOut; o++) {
                    const rs = (isOut && OUT_ROW_SCALE) ? OUT_ROW_SCALE[o] : 1;
                    for (let i = 0; i < rowLen; i++) w[o * rowLen + i] = gaussRand(initRng) * scale * rs;
                }
            }
            this.weights.push(w);
        }
        this._buf = sizes.map(n => new Float32Array(n));
    }

    forward(input) {
        let cur = this._buf[0];
        cur.set(input);
        // Hoisted out of the o-loop: this runs 50 times a second per walker,
        // times the population, times the episodes.
        const isTanh = this.act === "tanh";
        const slopes = this.slopes;
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const nIn = this.sizes[l], nOut = this.sizes[l + 1];
            const next = this._buf[l + 1];
            const last = l === this.weights.length - 1;
            const sl = last || isTanh ? null : slopes[l];
            for (let o = 0; o < nOut; o++) {
                let sum = w[o * (nIn + 1) + nIn];  // bias
                const base = o * (nIn + 1);
                for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                // The OUTPUT layer is sigmoid whatever the gene says. It is not
                // a free choice: outputs are joint setpoints in 0..1 and the
                // servo code reads them as such.
                if (last) next[o] = 1 / (1 + Math.exp(-sum));
                else if (isTanh) next[o] = Math.tanh(sum);
                else next[o] = sum > 0 ? sum : sl[o] * sum;
            }
            cur = next;
        }
        return cur;
    }

    /* Fraction of hidden units that leak. 0 = pure ReLU, 1 = pure leaky, and
     * anything between is a hybrid. This is the number the run reports, because
     * once the two interbreed "which activation is winning" is a proportion
     * rather than a label. */
    leakyShare() {
        if (!this.slopes) return null;
        let n = 0, k = 0;
        for (const s of this.slopes) { for (let i = 0; i < s.length; i++) { n++; if (s[i] > 0) k++; } }
        return n ? k / n : 0;
    }

    /* relu / lrelu while every unit agrees, "mixed" once they do not. Purely a
     * label for logs and charts — forward() always reads the slopes. */
    _relabel() {
        if (!this.slopes) return this;
        const share = this.leakyShare();
        this.act = share === 0 ? "relu" : share === 1 ? "lrelu" : "mixed";
        return this;
    }

    clone() {
        const n = new Net(this.sizes, null, this.act === "mixed" ? "relu" : this.act);
        for (let l = 0; l < this.weights.length; l++) n.weights[l].set(this.weights[l]);
        if (this.slopes) { for (let l = 0; l < this.slopes.length; l++) n.slopes[l].set(this.slopes[l]); }
        n.act = this.act;
        return n;
    }

    mutate(rate, sigma, rng) {
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            for (let i = 0; i < w.length; i++) {
                if (rng() < rate) {
                    if (rng() < 0.03) w[i] = gaussRand(rng) * 0.5;          // rare full reset
                    else w[i] += gaussRand(rng) * sigma;
                }
            }
        }
        // A neuron occasionally changes which rectifier it is. Keeps both
        // slopes reachable when crossover alone would have lost one.
        if (this.slopes && SLOPE_FLIP > 0) {
            let touched = false;
            for (const s of this.slopes) {
                for (let i = 0; i < s.length; i++) {
                    if (rng() < SLOPE_FLIP) { s[i] = s[i] > 0 ? 0 : LRELU_SLOPE; touched = true; }
                }
            }
            if (touched) this._relabel();
        }
        return this;
    }

    /* mutateSparse — change exactly k weights, chosen by COUNT and not by a
     * per-weight probability.
     *
     * mutate() above flips a coin on every weight, so the number it changes is
     * Binomial(20225, rate). At the default rate that is 708 +/- 26, and the
     * standard deviation is the whole point: every mutated child in the
     * population receives essentially the same SIZE of change. Counted across a
     * generation of 192, the smallest move anywhere in the population was 354
     * weights — 1.7% of the network — so there was no refinement operator at
     * all, and no rate could produce one reliably. This exists to ask for 25.
     *
     * No full-reset branch here, deliberately. mutate() overwrites a weight
     * outright with gaussRand*0.5 three times in a hundred, which is the
     * opposite of refinement; the rank-weighted children still call mutate(),
     * so that escape path stays in the population.
     *
     * No slope flips either — changing which rectifier a neuron is is a
     * structural edit, not a small step, and it belongs with the children.
     *
     * rowFocus spends the whole budget inside ONE neuron's incoming row. The
     * argument is the one crossover already makes ten lines below: a row is a
     * functional unit. k weights scattered over the net nudge k unrelated
     * things, where k weights inside a row retune what that neuron computes —
     * and since 87% of this net's weights are the input layer, a scattered draw
     * is almost always "how a few hidden units read the world".
     *
     * Indices are drawn WITH replacement. At k=25 collisions are negligible; at
     * k=1100 about 3% of draws land twice, so the effective count is slightly
     * under k. That is accepted in exchange for a draw order simple enough to
     * mirror exactly.
     *
     * DRAW ORDER IS LOAD-BEARING. It must match Net::mutateSparse in nn.hpp
     * instruction for instruction, or the C++ trainer and the JS oracle breed
     * different populations from the same seed. */
    mutateSparse(k, sigma, rng, rowFocus) {
        if (rowFocus) {
            let nRows = 0;
            for (let l = 0; l < this.weights.length; l++) nRows += this.sizes[l + 1];
            let r = (rng() * nRows) | 0;
            let l = 0;
            while (r >= this.sizes[l + 1]) { r -= this.sizes[l + 1]; l++; }
            const rowLen = this.sizes[l] + 1, w = this.weights[l], base = r * rowLen;
            const m = Math.min(k, rowLen);
            for (let i = 0; i < m; i++) w[base + ((rng() * rowLen) | 0)] += gaussRand(rng) * sigma;
        } else {
            let W = 0;
            for (let l = 0; l < this.weights.length; l++) W += this.weights[l].length;
            for (let i = 0; i < k; i++) {
                let j = (rng() * W) | 0, l = 0;
                while (j >= this.weights[l].length) { j -= this.weights[l].length; l++; }
                this.weights[l][j] += gaussRand(rng) * sigma;
            }
        }
        return this;
    }

    /* Row-wise crossover: whole neurons (a row of incoming weights + bias)
     * swap between parents. Swapping individual weights scrambles what each
     * neuron computes; swapping neurons keeps functional units intact. */
    /* Crossing tanh with a rectifier is meaningless — the same row of weights
     * computes a different function everywhere — so that pairing returns a
     * plain copy of the first parent rather than a blend. ReLU and leaky ReLU
     * DO cross: they agree exactly on the positive side and differ only in the
     * negative slope, so a transplanted neuron keeps doing most of its job.
     *
     * When a row is taken from the other parent its SLOPE comes with it. That
     * is what "interbreeding at the connections" means here — the child is
     * mixed neuron by neuron, not averaged into some compromise activation
     * that neither parent had. A row that is blended rather than copied takes
     * the leakier of the two slopes, because averaging weights from a unit that
     * was allowed to go negative into one that was not is the case where
     * flattening the negative side loses the most. */
    static crossover(a, b, rng) {
        const child = a.clone();
        const canMix = a.act !== "tanh" && b.act !== "tanh";
        if (!canMix && a.act !== b.act) return child;
        for (let l = 0; l < child.weights.length; l++) {
            const wc = child.weights[l], wb = b.weights[l];
            const rowLen = a.sizes[l] + 1, nOut = a.sizes[l + 1];
            const isHidden = l < child.weights.length - 1;
            const sc = isHidden && child.slopes ? child.slopes[l] : null;
            const sb = isHidden && b.slopes ? b.slopes[l] : null;
            for (let o = 0; o < nOut; o++) {
                const r = rng();
                if (r < 0.45) {
                    for (let i = 0; i < rowLen; i++) wc[o * rowLen + i] = wb[o * rowLen + i];
                    if (sc && sb) sc[o] = sb[o];
                } else if (r < 0.52) {
                    for (let i = 0; i < rowLen; i++) wc[o * rowLen + i] = 0.5 * (wc[o * rowLen + i] + wb[o * rowLen + i]);
                    if (sc && sb) sc[o] = Math.max(sc[o], sb[o]);
                }
            }
        }
        return child._relabel();
    }

    toJSON() {
        return {
            sizes: this.sizes, act: this.act,
            slopes: this.slopes ? this.slopes.map(s => Array.from(s)) : null,
            weights: this.weights.map(w => Array.from(w))
        };
    }

    /* A file with no `act` is a brain from before the gene existed, and every
     * one of those was evolved under tanh. Defaulting to tanh is therefore a
     * correct reconstruction, not a guess.
     *
     * A file with `act` but no `slopes` predates the per-neuron slope; a uniform
     * fill from its named activation reproduces it exactly. */
    static fromJSON(o) {
        const n = new Net(o.sizes, null, o.act === "mixed" ? "relu" : o.act);
        for (let l = 0; l < n.weights.length; l++) n.weights[l].set(o.weights[l]);
        if (n.slopes && o.slopes) {
            for (let l = 0; l < n.slopes.length; l++) n.slopes[l].set(o.slopes[l]);
            n._relabel();
        }
        return n;
    }
}

/* A short, stable name for a set of weights.
 *
 * DETERMINISTIC, not random, and that is the whole value of it: the same weights
 * always produce the same code, so when the dashboard says K3F9QZ and the browser
 * says K3F9QZ they are provably the same brain. A random label would name a
 * transfer rather than a brain, and would not survive a re-bake of the same file.
 *
 * Over EVERY weight, not a sample. The incident recorder samples every 97th for
 * speed because it only needs to catch "you replayed against a different
 * champion"; a name that appears in the UI is read as an identity, and two
 * sibling brains differing in a handful of weights must not share one.
 *
 * The alphabet drops I, L, O, U and 0/1 — this gets read aloud and typed into
 * messages, and 0/O is the classic way an identity check quietly passes. */
const ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
function brainId(net) {
    const ws = net && (net.weights || (net.net && net.net.weights));
    if (!ws) return "??????";
    // FNV-1a over the quantised weights. Quantised because a genome that has been
    // through JSON at 6 decimals must name itself the same as the one in memory.
    let h = 2166136261 >>> 0;
    for (const w of ws) {
        for (let i = 0; i < w.length; i++) {
            const q = Math.round(w[i] * 1e6) | 0;
            h = (h ^ (q & 0xff)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
            h = (h ^ ((q >>> 8) & 0xff)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
            h = (h ^ ((q >>> 16) & 0xff)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
            h = (h ^ ((q >>> 24) & 0xff)) >>> 0; h = Math.imul(h, 16777619) >>> 0;
        }
    }
    /* 30^6 is 7.3e8, comfortably more than the few thousand brains this project
     * will ever bake, and the birthday bound on that is still ~27,000 before a
     * collision is likely. Mixed once more before slicing so the low bits, which
     * FNV leaves weakest, do not decide the first character. */
    h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 2246822507) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    let s = "";
    for (let i = 0; i < 6; i++) { s += ID_ALPHABET[h % 30]; h = Math.floor(h / 30) + 1; }
    return s;
}

if (typeof module !== "undefined") module.exports = {
    Net, mulberry32, gaussRand, brainId, ACTS, ACT_NAMES, LRELU_SLOPE, SLOPE_VALUES,
    slopeFlip, setSlopeFlip,
    setOutInit: v => { OUT_INIT = v; },
    setOutRowScale: v => { OUT_ROW_SCALE = v; }
};
