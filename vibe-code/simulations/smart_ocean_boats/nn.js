/* nn.js — plain feedforward network. tanh hidden layers, sigmoid outputs.
 * Evolved only: no gradients anywhere. */
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

let _gaussSpare = null;
function gaussRand(rng) {
    if (_gaussSpare !== null) { const s = _gaussSpare; _gaussSpare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    _gaussSpare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
}

class Net {
    constructor(sizes, initRng) {
        this.sizes = sizes.slice();
        this.weights = [];   // per layer: Float32Array (out × (in + 1)), bias last column
        for (let l = 0; l < sizes.length - 1; l++) {
            const nIn = sizes[l], nOut = sizes[l + 1];
            const w = new Float32Array(nOut * (nIn + 1));
            if (initRng) {
                // He-style scale on hidden layers; the output layer starts near zero so
                // fresh boats idle gently instead of thrashing (small actions mutate into
                // useful ones far faster than saturated ones).
                const isOut = l === sizes.length - 2;
                const scale = (isOut ? 0.08 : 1.0) * Math.sqrt(2 / nIn);
                for (let i = 0; i < w.length; i++) w[i] = gaussRand(initRng) * scale;
            }
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
                let sum = w[o * (nIn + 1) + nIn];  // bias
                const base = o * (nIn + 1);
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
        return this;
    }

    /* Row-wise crossover: whole neurons (a row of incoming weights + bias)
     * swap between parents. Swapping individual weights scrambles what each
     * neuron computes; swapping neurons keeps functional units intact. */
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

    toJSON() {
        return { sizes: this.sizes, weights: this.weights.map(w => Array.from(w)) };
    }

    static fromJSON(o) {
        const n = new Net(o.sizes, null);
        for (let l = 0; l < n.weights.length; l++) n.weights[l].set(o.weights[l]);
        return n;
    }
}

if (typeof module !== "undefined") module.exports = { Net, mulberry32, gaussRand };
