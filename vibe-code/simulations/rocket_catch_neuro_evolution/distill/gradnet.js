/* gradnet.js — backpropagation and Adam for the nn.js network layout.
 *
 * The GA never needed gradients, so nn.js has a forward pass and nothing else.
 * Distillation needs to fit a teacher's per-decision actions, which is ordinary
 * supervised regression, so this adds the missing half — operating on the SAME
 * weight buffers a Brain already owns, in the same layout, so a trained network
 * is handed straight back to the GA afterwards with no conversion step and no
 * chance of a transcription bug between the two representations.
 *
 * Layout, matching Net.forward exactly:
 *   weights[l][o * (nIn + 1) + i]   is the weight from input i to unit o
 *   weights[l][o * (nIn + 1) + nIn] is the bias of unit o
 *   every layer, INCLUDING THE OUTPUT, passes through tanh (or softsign)
 *
 * That last point matters: the outputs are bounded in (-1, 1) and the actions
 * are too, so this is regression through a squashing nonlinearity rather than a
 * linear head, and the gradient has to carry the tanh derivative on the output
 * layer as well. Getting that wrong trains a network that looks converged and
 * saturates in play.
 */
"use strict";

const NN = require("../nn.js");

class Trainer {
    constructor(brain, opts) {
        opts = opts || {};
        this.brain = brain;
        this.net = brain.net;
        this.soft = brain.act === "softsign";
        this.lr = opts.lr != null ? opts.lr : 2e-3;
        this.b1 = 0.9; this.b2 = 0.999; this.eps = 1e-8;
        this.wd = opts.weightDecay != null ? opts.weightDecay : 1e-6;
        this.t = 0;

        const L = this.net.weights.length;
        this.m = []; this.v = [];
        for (let l = 0; l < L; l++) {
            this.m.push(new Float64Array(this.net.weights[l].length));
            this.v.push(new Float64Array(this.net.weights[l].length));
        }
        // activation buffers: a[0] is the input, a[l+1] the output of layer l
        this.a = this.net.sizes.map(n => new Float64Array(n));
        this.d = this.net.sizes.map(n => new Float64Array(n));
        this.grad = this.net.weights.map(w => new Float64Array(w.length));
    }

    _act(s) { return this.soft ? s / (1 + Math.abs(s)) : Math.tanh(s); }
    /* d/ds of the activation, expressed in terms of its OUTPUT y, which is what
     * is already cached — cheaper and numerically better than recomputing. */
    _dact(y) { return this.soft ? (1 - Math.abs(y)) * (1 - Math.abs(y)) : (1 - y * y); }

    forward(x) {
        this.a[0].set(x);
        for (let l = 0; l < this.net.weights.length; l++) {
            const w = this.net.weights[l];
            const nIn = this.net.sizes[l], nOut = this.net.sizes[l + 1];
            const cur = this.a[l], next = this.a[l + 1];
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1);
                let s = w[base + nIn];
                for (let i = 0; i < nIn; i++) s += w[base + i] * cur[i];
                next[o] = this._act(s);
            }
        }
        return this.a[this.a.length - 1];
    }

    /* Accumulate dLoss/dW for one sample. `wgt` is a per-output weight, so the
     * channels that actually fly the vehicle can matter more than the ones that
     * are unused on this airframe. Returns the sample's weighted squared error. */
    accumulate(x, y, wgt) {
        const out = this.forward(x);
        const L = this.net.weights.length;
        const last = this.d[L];
        let loss = 0;
        for (let o = 0; o < out.length; o++) {
            const wq = wgt ? wgt[o] : 1;
            const e = out[o] - y[o];
            loss += wq * e * e;
            // dLoss/dPreActivation = 2*w*(yhat - y) * act'(yhat)
            last[o] = 2 * wq * e * this._dact(out[o]);
        }
        for (let l = L - 1; l >= 0; l--) {
            const w = this.net.weights[l], g = this.grad[l];
            const nIn = this.net.sizes[l], nOut = this.net.sizes[l + 1];
            const cur = this.a[l], dOut = this.d[l + 1], dIn = this.d[l];
            if (l > 0) dIn.fill(0);
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1), go = dOut[o];
                if (go === 0) continue;
                for (let i = 0; i < nIn; i++) {
                    g[base + i] += go * cur[i];
                    if (l > 0) dIn[i] += go * w[base + i];
                }
                g[base + nIn] += go;
            }
            if (l > 0) {
                const yPrev = this.a[l];
                for (let i = 0; i < nIn; i++) dIn[i] *= this._dact(yPrev[i]);
            }
        }
        return loss;
    }

    /* One Adam step over whatever has been accumulated, then zero the grads. */
    apply(batchSize) {
        this.t++;
        const b1t = 1 - Math.pow(this.b1, this.t), b2t = 1 - Math.pow(this.b2, this.t);
        for (let l = 0; l < this.net.weights.length; l++) {
            const w = this.net.weights[l], g = this.grad[l], m = this.m[l], v = this.v[l];
            for (let k = 0; k < w.length; k++) {
                const gk = g[k] / batchSize + this.wd * w[k];
                m[k] = this.b1 * m[k] + (1 - this.b1) * gk;
                v[k] = this.b2 * v[k] + (1 - this.b2) * gk * gk;
                w[k] -= this.lr * (m[k] / b1t) / (Math.sqrt(v[k] / b2t) + this.eps);
                g[k] = 0;
            }
        }
    }

    trainEpoch(X, Y, opts) {
        opts = opts || {};
        const batch = opts.batch || 256;
        const wgt = opts.weights || null;
        const rng = opts.rng || Math.random;
        const n = X.length;
        const idx = new Int32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        for (let i = n - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
        let loss = 0, seen = 0;
        for (let b = 0; b < n; b += batch) {
            const end = Math.min(n, b + batch);
            for (let k = b; k < end; k++) loss += this.accumulate(X[idx[k]], Y[idx[k]], wgt);
            this.apply(end - b);
            seen += end - b;
        }
        return loss / Math.max(1, seen);
    }
}

/* Mean absolute error per output channel on a held-out set — the diagnostic the
 * plateau note calls for. Low training error with poor play means distribution
 * shift; HIGH training error means the observation or the capacity cannot
 * represent the teacher at all, and no amount of further training helps. */
function channelError(brain, X, Y) {
    const n = X.length, nOut = Y[0].length;
    const sum = new Float64Array(nOut);
    for (let i = 0; i < n; i++) {
        const out = brain.forward(X[i]);
        for (let o = 0; o < nOut; o++) sum[o] += Math.abs(out[o] - Y[i][o]);
    }
    for (let o = 0; o < nOut; o++) sum[o] /= n;
    return sum;
}

module.exports = { Trainer, channelError, NN };
