/* nn.js — plain feedforward network. tanh hidden layers, tanh outputs.
 * Evolved only: no gradients anywhere.
 *
 * Outputs are tanh rather than sigmoid because a coil voltage is bipolar and
 * zero is the meaningful neutral: the episode starts from a solved equilibrium,
 * so "command nothing" leaves the currents where they are and the plasma drifts
 * only as fast as its own instability. The near-zero output-layer init
 * therefore means a brand-new brain does not immediately slam nineteen supplies
 * to ±1.4 kV and disrupt in the first millisecond. Every fresh brain survives
 * long enough to be told apart from every other fresh brain, which is the only
 * thing generation 1 has to achieve.
 */
"use strict";

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Box-Muller produces two normals per pair of uniforms; the spare is cached ON
 * THE RNG, not in a module-level variable. With one shared cache a leftover
 * spare from the previous consumer leaks into the next one, and two runs with
 * identical seeds diverge depending on what happened earlier in the process.
 * Every reproducibility claim in this simulator rests on that not happening. */
function gaussRand(rng) {
    const s = rng._gaussSpare;
    if (s != null) { rng._gaussSpare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    rng._gaussSpare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
}

class Net {
    constructor(sizes, initRng) {
        this.sizes = sizes.slice();
        this.weights = [];   // per layer: Float32Array (out × (in + 1)), bias last column
        this.scales = [];    // per layer: the init standard deviation
        for (let l = 0; l < sizes.length - 1; l++) {
            const nIn = sizes[l], nOut = sizes[l + 1];
            const w = new Float32Array(nOut * (nIn + 1));
            const isOut = l === sizes.length - 2;
            const scale = (isOut ? 0.02 : 1.0) * Math.sqrt(2 / nIn);
            this.scales.push(scale);
            if (initRng) {
                for (let i = 0; i < w.length; i++) w[i] = gaussRand(initRng) * scale;
            }
            this.weights.push(w);
        }
        this._buf = sizes.map(n => new Float32Array(n));
    }

    forward(input) {
        let cur = this._buf[0];
        cur.set(input.length === cur.length ? input : input.subarray(0, cur.length));
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const nIn = this.sizes[l], nOut = this.sizes[l + 1];
            const next = this._buf[l + 1];
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1);
                let sum = w[base + nIn];  // bias
                for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                next[o] = Math.tanh(sum);
            }
            cur = next;
        }
        return cur;
    }

    clone() {
        const n = new Net(this.sizes, null);
        for (let l = 0; l < this.weights.length; l++) n.weights[l].set(this.weights[l]);
        // Scales travel with the brain. They were identical for every net back
        // when every net came from the same random init, so this was invisible;
        // with calibrated scales a clone that reverted to the init values would
        // quietly mutate a hundred times too gently.
        n.scales = this.scales.slice();
        return n;
    }

    /* `sigma` is RELATIVE to each layer's own init scale, not an absolute step.
     *
     * This matters more here than in any other sim on this site. The output
     * layer starts at 0.02·√(2/n) ≈ 0.006, and an absolute sigma of 0.12 — a
     * perfectly ordinary value elsewhere — moves a single output weight twenty
     * times its own initial size. tanh saturates, the coil sees ±1400 V
     * continuously, and the plasma is on the wall inside a millisecond. Measured:
     * generation 1 survived 88% of its episodes and generation 10 survived 35%,
     * and it never recovered. Selection was not failing; mutation was destroying
     * every brain faster than selection could keep one.
     *
     * With the scaling, sigma is "fraction of the init standard deviation", so
     * 0.35 means a typical mutation moves a weight by a third of the spread it
     * was born with — the same relative step in every layer. */
    mutate(rate, sigma, rng) {
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const s = sigma * this.scales[l];
            const reset = 3 * this.scales[l];
            for (let i = 0; i < w.length; i++) {
                if (rng() < rate) {
                    if (rng() < 0.03) w[i] = gaussRand(rng) * reset;        // rare full reset
                    else w[i] += gaussRand(rng) * s;
                }
            }
        }
        return this;
    }

    /* Row-wise crossover: whole neurons (a row of incoming weights + bias) swap
     * between parents. Swapping individual weights scrambles what each neuron
     * computes; swapping neurons keeps functional units intact. With 93 partly
     * redundant magnetic inputs, a hidden neuron here really is a learned linear
     * combination of probes — a moment of the field — and it is worth keeping
     * whole. */
    static crossover(a, b, rng) {
        const child = a.clone();
        for (let l = 0; l < child.weights.length; l++) {
            const wc = child.weights[l], wb = b.weights[l];
            const rowLen = a.sizes[l] + 1, nOut = a.sizes[l + 1];
            for (let o = 0; o < nOut; o++) {
                const r = rng();
                if (r < 0.45) {
                    for (let i = 0; i < rowLen; i++) wc[o * rowLen + i] = wb[o * rowLen + i];
                } else if (r < 0.52) {
                    for (let i = 0; i < rowLen; i++) wc[o * rowLen + i] = 0.5 * (wc[o * rowLen + i] + wb[o * rowLen + i]);
                }
            }
        }
        return child;
    }

    /* Reset each layer's mutation scale to the RMS of the weights it actually
     * holds, instead of the standard deviation it was BORN with.
     *
     * This matters the moment a brain arrives from anywhere other than
     * `new Net(sizes, rng)`. The imitation stage trains the output layer up
     * from its 0.004 init spread to an RMS around 0.2 — fifty times larger —
     * and mutate() would go on stepping by a fraction of 0.004, which against
     * those weights is not a mutation, it is a rounding error. The population
     * would look converged from generation one and the whole GA stage would be
     * an expensive way to keep the brain it started with.
     *
     * The floor stops a layer that happens to be nearly dead from freezing
     * itself out of the search permanently. */
    calibrateScales() {
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            let s = 0;
            for (let i = 0; i < w.length; i++) s += w[i] * w[i];
            const rms = Math.sqrt(s / w.length);
            this.scales[l] = Math.max(rms, 0.05 * this.scales[l]);
        }
        return this;
    }

    toJSON() {
        return { sizes: this.sizes, scales: this.scales.slice(), weights: this.weights.map(w => Array.from(w)) };
    }

    static fromJSON(o) {
        const n = new Net(o.sizes, null);
        for (let l = 0; l < n.weights.length; l++) n.weights[l].set(o.weights[l]);
        // Checkpoints written before scales were persisted simply do not have
        // them; deriving them from the weights is the right answer for those
        // too, and is what the old code should have been doing all along.
        if (o.scales && o.scales.length === n.scales.length) n.scales = o.scales.slice();
        else n.calibrateScales();
        return n;
    }
}

if (typeof module !== "undefined") module.exports = { Net, mulberry32, gaussRand };
