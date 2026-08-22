/* netgrad.js — backpropagation and Adam for the `Net` class in nn.js.
 *
 * The header of nn.js says "no gradients anywhere", and for the shipped brain
 * that is still true in the sense that matters: nothing about the architecture,
 * the sensors or the actuator changed. What changed is how the weights are
 * FOUND. Evolution could not find them — 765 generations of the stock trainer
 * on this task sit at 0.5 balls per episode and 0% on held-out phrasings — and
 * the reason is signal, not search: one scalar of fitness per episode against
 * roughly 900 control decisions, over a 539-sentence instruction space. A
 * per-decision teacher turns that into 900 labelled examples per episode.
 *
 * This file is deliberately small and unclever. Two-hidden-layer tanh nets with
 * a few thousand weights need no autodiff, no graph, and no framework.
 *
 * THE OUTPUT LOSSES ARE NOT INTERCHANGEABLE, and picking the lazy one costs a
 * whole training run:
 *
 *   motor head (sigmoid out). The teacher is a saturated proportional
 *     controller — its five outputs sit at exactly 0 or exactly 1 most of the
 *     time, because a servo asked to move further than one tick allows is asked
 *     to move flat out. Under MSE, a sigmoid whose target is 0 or 1 has
 *     gradient y(1-y)(y-t), which vanishes exactly where the error is largest.
 *     BINARY CROSS-ENTROPY cancels that factor: dL/dz = y - t, full gradient at
 *     full error. The targets are real numbers in [0,1] rather than labels,
 *     which is fine — BCE against a soft target is a cross-entropy with a
 *     constant offset and has the same minimiser.
 *
 *   selector heads (linear out, argmax across slots). These are a RANKING, not
 *     a regression: the network is run once per slot with shared weights and
 *     only the ordering of the scores matters. So the loss is a softmax
 *     cross-entropy over the slots, and the gradient is accumulated across
 *     every slot's forward pass into one set of shared weights.
 *
 *     The target is a SET, not an index. When the right answer is "do nothing"
 *     — which the leave-one, count and exclude rules all need — any empty slot
 *     is correct, and there are usually several. Demanding one particular empty
 *     slot would teach the net to distinguish between identical all-zero
 *     inputs, which is not learnable and pollutes everything else. The set loss
 *     -log(sum of p over the acceptable slots) asks only for what is true.
 */
"use strict";

/* ---------------------------------------------------------------- gradients
 *
 * A Grad holds one accumulator per weight matrix, plus the Adam moments. It is
 * kept beside the Net rather than inside it so nn.js stays a pure forward
 * implementation and the GA path is untouched. */
class Grad {
    constructor(net) {
        this.net = net;
        this.g = net.weights.map(w => new Float64Array(w.length));
        this.m = net.weights.map(w => new Float64Array(w.length));
        this.v = net.weights.map(w => new Float64Array(w.length));
        this.t = 0;
        // activation cache: one buffer per layer, holding the POST-activation
        this.a = net.sizes.map(n => new Float64Array(n));
        this.d = net.sizes.map(n => new Float64Array(n));
    }

    zero() { for (const g of this.g) g.fill(0); }

    /* Forward pass that keeps the activations. Returns the output layer. */
    forward(input) {
        const net = this.net;
        const a = this.a;
        for (let i = 0; i < net.sizes[0]; i++) a[0][i] = input[i];
        for (let l = 0; l < net.weights.length; l++) {
            const w = net.weights[l], nIn = net.sizes[l], nOut = net.sizes[l + 1];
            const cur = a[l], next = a[l + 1];
            const last = l === net.weights.length - 1;
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1);
                let sum = w[base + nIn];
                for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                if (!last) next[o] = Math.tanh(sum);
                else if (net.outAct === "sigmoid") next[o] = 1 / (1 + Math.exp(-sum));
                else if (net.outAct === "tanh") next[o] = Math.tanh(sum);
                else next[o] = sum;
            }
        }
        return a[net.weights.length];
    }

    /* Backward from dL/dz on the OUTPUT PRE-ACTIVATION.
     *
     * Taking dL/dz rather than dL/dy is what lets both output losses share this
     * code: BCE-through-sigmoid and softmax-through-linear both reduce to a
     * clean `y - t` at the pre-activation, and neither caller has to know about
     * the other's activation derivative.
     *
     * Gradients ACCUMULATE — call zero() to start a batch. That is what lets a
     * selector head backprop six slots into one shared weight set. */
    backward(dzOut) {
        const net = this.net, a = this.a, d = this.d;
        const L = net.weights.length;
        for (let o = 0; o < net.sizes[L]; o++) d[L][o] = dzOut[o];
        for (let l = L - 1; l >= 0; l--) {
            const w = net.weights[l], nIn = net.sizes[l], nOut = net.sizes[l + 1];
            const cur = a[l], dz = d[l + 1], g = this.g[l];
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1), e = dz[o];
                if (e === 0) continue;
                for (let i = 0; i < nIn; i++) g[base + i] += e * cur[i];
                g[base + nIn] += e;
            }
            if (l === 0) break;
            const dPrev = d[l];
            dPrev.fill(0);
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1), e = dz[o];
                if (e === 0) continue;
                for (let i = 0; i < nIn; i++) dPrev[i] += e * w[base + i];
            }
            // hidden layers are tanh: d/dz = 1 - a^2
            for (let i = 0; i < nIn; i++) dPrev[i] *= (1 - cur[i] * cur[i]);
        }
    }

    /* Adam. `scale` divides the accumulated gradient by the batch size. */
    step(lr, scale, wd) {
        this.t++;
        const b1 = 0.9, b2 = 0.999, eps = 1e-8;
        const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
        for (let l = 0; l < this.g.length; l++) {
            const g = this.g[l], m = this.m[l], v = this.v[l], w = this.net.weights[l];
            for (let i = 0; i < g.length; i++) {
                const gi = g[i] * scale + (wd ? wd * w[i] : 0);
                m[i] = b1 * m[i] + (1 - b1) * gi;
                v[i] = b2 * v[i] + (1 - b2) * gi * gi;
                w[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps);
            }
        }
    }
}

/* ------------------------------------------------------------------ losses */

/* Sigmoid output, soft targets in [0,1]. Returns the mean BCE and fills dz. */
function bceOut(y, t, dz) {
    let loss = 0;
    for (let i = 0; i < t.length; i++) {
        const p = Math.min(1 - 1e-7, Math.max(1e-7, y[i]));
        loss += -(t[i] * Math.log(p) + (1 - t[i]) * Math.log(1 - p));
        dz[i] = y[i] - t[i];
    }
    return loss / t.length;
}

/* Softmax cross-entropy over a set of acceptable slots.
 *
 * `scores` is one number per slot, `ok` is a boolean per slot. Returns
 * {loss, dz} where dz[i] is dL/d(score_i) — the value to feed back through slot
 * i's own forward pass. */
function setSoftmaxCE(scores, ok) {
    const n = scores.length;
    let max = -Infinity;
    for (let i = 0; i < n; i++) if (scores[i] > max) max = scores[i];
    let z = 0;
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) { p[i] = Math.exp(scores[i] - max); z += p[i]; }
    let pt = 0;
    for (let i = 0; i < n; i++) { p[i] /= z; if (ok[i]) pt += p[i]; }
    pt = Math.max(pt, 1e-9);
    const dz = new Float64Array(n);
    for (let i = 0; i < n; i++) dz[i] = p[i] - (ok[i] ? p[i] / pt : 0);
    return { loss: -Math.log(pt), dz, p };
}

if (typeof module !== "undefined") module.exports = { Grad, bceOut, setSoftmaxCE };
