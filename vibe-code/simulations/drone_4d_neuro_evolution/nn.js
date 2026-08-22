/* nn.js — plain feedforward network. tanh hidden layers, sigmoid outputs.
 * Evolved only: no gradients anywhere.
 *
 * The near-zero output-layer init matters more here than anywhere else. With a
 * ~0 pre-activation every rotor command starts at sigmoid(0) = 0.5, and the
 * airframe is geared (drone4d.js TMAX) so that 0.5 on all eight rotors is a
 * gentle climb. A brand-new random brain therefore lifts off and floats
 * instead of flipping on the pad, which is the difference between a generation
 * 1 that has something to select on and one that is sixty identical wrecks.
 *
 * OUT_INIT stays at the 3D project's 0.03, and it is worth recording that the
 * obvious argument for lowering it turned out to be wrong. Tilt torque is
 * c·Σ fᵢ·sᵢ over the rotors, so the torque a random output layer makes grows as
 * √N in the rotor count — eight corners instead of four arms is √2 more tumble
 * from the same per-weight spread, into an identical 0.018 kg·m² — and there
 * are three tilt planes to keep still instead of two. That predicts a smaller
 * scale. Measured (probe.js, 40 brains × 3 episodes):
 *
 *     outInit   leftGround   armed   meanAir   meanWP   fitSpread
 *      0.050       100%       81%     2.09 s    0.000       82
 *      0.030       100%       99%     3.53 s    0.008      182
 *      0.020       100%      100%     4.37 s    0.000       98
 *      0.006       100%      100%     6.18 s    0.000      107
 *
 * Arming is saturated everywhere below 0.05, so the prediction had nothing to
 * fix. What separates the rows is the FITNESS SPREAD, and that peaks at 0.03 —
 * which is also the only setting where a random brain ever reaches a waypoint.
 * The spread is the selection signal, so wider wins: a population that all
 * scores the same is a generation the GA cannot rank. Below 0.02 the drones
 * just climb placidly into the ceiling, which is tidy and teaches nothing.
 *
 * Note the pre-activation spread is independent of the input count: the He
 * scale carries a 1/√nIn that exactly cancels the √nIn from summing nIn terms.
 * So this number is comparable across the two projects even though 4D feeds
 * 216 inputs and 3D fed 226.
 *
 * Note the pre-activation spread is independent of the input count: the He
 * scale carries a 1/√nIn that exactly cancels the √nIn from summing nIn terms.
 * So this number is comparable across the two projects even though 4D feeds
 * 216 inputs and 3D fed 226.
 */
"use strict";

const OUT_INIT = 0.03;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Box-Muller makes two normals per pair of uniforms; the spare is cached ON
 * THE RNG, never in a module-level variable. With one shared cache a leftover
 * spare from the previous consumer leaks into the next one, so re-running an
 * episode with identical seeds gives a different turbulence stream depending on
 * what happened earlier in the process — and a worker computes a different
 * episode than the main thread for the same (missionSeed, noiseSeed). Every
 * fairness and reproducibility claim in this project rests on that not
 * happening. */
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
    constructor(sizes, initRng, outInit) {
        this.sizes = sizes.slice();
        this.weights = [];   // per layer: Float32Array (out × (in + 1)), bias last column
        const oi = outInit != null ? outInit : OUT_INIT;
        this.outInit = oi;
        /* Each layer's natural weight scale, kept so that mutation can be
         * proportional to it. Derived from the shape, so clones and
         * deserialised nets get the same numbers without storing them. */
        this.initScales = [];
        for (let l = 0; l < sizes.length - 1; l++) {
            const nIn = sizes[l], nOut = sizes[l + 1];
            const w = new Float32Array(nOut * (nIn + 1));
            const isOut = l === sizes.length - 2;
            const scale = (isOut ? oi : 1.0) * Math.sqrt(2 / nIn);
            this.initScales.push(scale);
            if (initRng) for (let i = 0; i < w.length; i++) w[i] = gaussRand(initRng) * scale;
            this.weights.push(w);
        }
        this._buf = sizes.map(n => new Float32Array(n));
    }

    forward(input) {
        let cur = this._buf[0];
        cur.set(input);
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const nIn = this.sizes[l], nOut = this.sizes[l + 1];
            const next = this._buf[l + 1];
            const last = l === this.weights.length - 1;
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1);
                let sum = w[base + nIn];               // bias
                for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                next[o] = last ? 1 / (1 + Math.exp(-sum)) : Math.tanh(sum);
            }
            cur = next;
        }
        return cur;
    }

    clone() {
        const n = new Net(this.sizes, null);
        for (let l = 0; l < this.weights.length; l++) n.weights[l].set(this.weights[l]);
        return n;
    }

    /* Mutation strength is PROPORTIONAL TO EACH LAYER'S OWN SCALE, and that is
     * not a refinement — without it this network cannot be evolved at all.
     *
     * The output layer is initialised ~0.03× the He scale so that fresh drones
     * idle gently (see the header). Its weights therefore have a natural size
     * of 0.03·√(2/32) ≈ 0.0075, while the first hidden layer's are ≈ 0.096.
     * A single flat sigma of 0.09 is a reasonable step for the hidden layers
     * and TWELVE TIMES the entire scale of the output layer: one mutation event
     * saturates a rotor to hard 0 or hard 1 and the airframe flips.
     *
     * Measured before this fix, on the benchmark run: generation 1 had 99% of
     * the population leaving the ground, and generation 2 — built from gen 1's
     * elites, on the identical fixed episode bank — had 12%. It read exactly
     * like a reward-shaping problem or a crash-penalty problem, and it was
     * neither; the children were simply being lobotomised on the way out of the
     * breeding loop. The rare full reset had the same defect and gets the same
     * treatment.
     *
     * 0.1 is the reference scale the caller's sigma is quoted against, so a
     * sigma near 0.1 means "about one layer-width of step". */
    mutate(rate, sigma, rng) {
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const s = sigma * this.initScales[l] / 0.1;
            const reset = this.initScales[l] * 4;
            for (let i = 0; i < w.length; i++) {
                if (rng() < rate) {
                    if (rng() < 0.03) w[i] = gaussRand(rng) * reset;   // rare full reset
                    else w[i] += gaussRand(rng) * s;
                }
            }
        }
        return this;
    }

    /* Row-wise crossover: whole neurons (a row of incoming weights plus its
     * bias) swap between parents. Swapping individual weights scrambles what
     * each neuron computes; swapping neurons keeps functional units intact. */
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
                    for (let i = 0; i < rowLen; i++) {
                        wc[o * rowLen + i] = 0.5 * (wc[o * rowLen + i] + wb[o * rowLen + i]);
                    }
                }
            }
        }
        return child;
    }

    toJSON() { return { sizes: this.sizes, weights: this.weights.map(w => Array.from(w)) }; }

    static fromJSON(o) {
        const n = new Net(o.sizes, null);
        for (let l = 0; l < n.weights.length; l++) n.weights[l].set(o.weights[l]);
        return n;
    }
}

if (typeof module !== "undefined") module.exports = { Net, mulberry32, gaussRand, OUT_INIT };
