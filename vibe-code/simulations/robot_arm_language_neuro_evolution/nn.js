/* nn.js — the brain. Three small networks, no gradients anywhere.
 *
 * WHY NOT ONE BIG MLP
 *
 * The obvious design feeds [everything the cameras see] + [task vector] into a
 * single net and reads five joint targets out. It does not work, and the reason
 * is structural rather than a matter of tuning: a flat net has to relearn "how
 * to reach a ball" separately for every slot the ball might occupy in the input
 * vector, and separately again for every task phrasing. Six slots x 49 goals is
 * an enormous amount of redundant behaviour to discover by mutation.
 *
 * So the brain is a POINTER NETWORK, in the same spirit as the chess sim's
 * FROM/TO heads:
 *
 *   ballSel    a small net scored ONCE PER BALL SLOT (shared weights) ->
 *              one number per ball. argmax = "the ball I am going for".
 *   bucketSel  the same trick over the four buckets -> "where it goes".
 *   motor      given the SELECTED ball and bucket in gripper-relative
 *              coordinates, drive five joints. Sees no language at all.
 *
 * Three consequences worth the design:
 *
 *   1. Shared slot weights are permutation invariant. Reaching is learned once
 *      and applies to every ball, in every slot, in every task.
 *   2. Language only has to move a decision boundary in the selectors — which
 *      colour is desirable right now — not to re-specify a motor program. That
 *      is a far smaller thing to ask a handful of embedding dimensions to do.
 *   3. argmax is not differentiable. Under backprop you would need a softmax
 *      relaxation, a temperature schedule, and a straight-through estimator.
 *      A GA does not care: it evaluates behaviour. This is one of the rare
 *      places where evolution is the natural fit rather than the handicap.
 *
 * An invalid (empty) ball slot is all zeros, which makes it the "do nothing"
 * option for free: if argmax lands on an empty slot the arm has decided there
 * is nothing it should be reaching for. Tasks like "leave one yellow" and
 * "don't touch the red ones" need exactly that action, and it costs no
 * parameters.
 */
"use strict";

/* ------------------------------------------------------------------- rng */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Box-Muller. The spare is held ON THE RNG, not in a module-level variable:
 * a shared spare leaks one generator's state into another's stream and makes
 * a seeded run unreproducible the moment two generators interleave. */
function gaussRand(rng) {
    if (rng._spare !== undefined && rng._spare !== null) {
        const s = rng._spare; rng._spare = null; return s;
    }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    rng._spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
}

/* --------------------------------------------------------------------- Net
 * tanh hidden layers; the output activation is per-net because the selectors
 * want a raw score (they get compared against each other) while the motor head
 * wants a bounded servo setpoint.
 *
 * OUT_INIT: the output layer starts near zero so a newborn arm holds its
 * nominal pose instead of slamming every joint to a limit. Small actions mutate
 * into useful ones; saturated ones mutate into other saturated ones. This one
 * constant was the difference between "learns" and "twitches forever" in both
 * the boats and the walker, so it is not up for negotiation here either. */
const OUT_INIT = 0.08;

/* Mutate one head per child rather than all three. See Brain.mutate. */
let BRAIN_MODULAR = true;

class Net {
    constructor(sizes, initRng, outAct) {
        this.sizes = sizes.slice();
        this.outAct = outAct || "sigmoid";
        this.weights = [];
        for (let l = 0; l < sizes.length - 1; l++) {
            const nIn = sizes[l], nOut = sizes[l + 1];
            const w = new Float32Array(nOut * (nIn + 1));
            if (initRng) {
                const isOut = l === sizes.length - 2;
                const scale = (isOut ? OUT_INIT : 1.0) * Math.sqrt(2 / nIn);
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
                const base = o * (nIn + 1);
                let sum = w[base + nIn];
                for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                if (!last) next[o] = Math.tanh(sum);
                else if (this.outAct === "sigmoid") next[o] = 1 / (1 + Math.exp(-sum));
                else if (this.outAct === "tanh") next[o] = Math.tanh(sum);
                else next[o] = sum;                       // linear
            }
            cur = next;
        }
        return cur;
    }

    clone() {
        const n = new Net(this.sizes, null, this.outAct);
        for (let l = 0; l < this.weights.length; l++) n.weights[l].set(this.weights[l]);
        return n;
    }

    mutate(rate, sigma, rng) {
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            for (let i = 0; i < w.length; i++) {
                if (rng() < rate) {
                    if (rng() < 0.03) w[i] = gaussRand(rng) * 0.5;   // rare full reset
                    else w[i] += gaussRand(rng) * sigma;
                }
            }
        }
        return this;
    }

    /* Row-wise: a whole neuron (its incoming weights + bias) crosses over as a
     * unit. Swapping individual weights scrambles what a neuron computes;
     * swapping neurons keeps functional units intact. */
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
                    for (let i = 0; i < rowLen; i++)
                        wc[o * rowLen + i] = 0.5 * (wc[o * rowLen + i] + wb[o * rowLen + i]);
                }
            }
        }
        return child;
    }

    toJSON() { return { sizes: this.sizes, outAct: this.outAct, weights: this.weights.map(w => Array.from(w)) }; }

    static fromJSON(o) {
        const n = new Net(o.sizes, null, o.outAct);
        for (let l = 0; l < n.weights.length; l++) n.weights[l].set(o.weights[l]);
        return n;
    }
}

/* ------------------------------------------------------- feature geometry */
const MAX_BALLS = 6;
const NBUCKET_SLOTS = 4;
const BALL_FEATS = 16;
const BUCKET_FEATS = 11;
const CTX_FEATS = 12;
const MOTOR_FEATS = 66;
let EMB_DIMS = 16;                       // fallback only; the real width comes from task_embeddings.js

function netSizes(embDim) {
    return {
        ballSel: [BALL_FEATS + CTX_FEATS + embDim, 20, 10, 1],
        bucketSel: [BUCKET_FEATS + CTX_FEATS + embDim, 16, 8, 1],
        motor: [MOTOR_FEATS, 40, 24, 5]
    };
}

/* ------------------------------------------------------------------- Brain */
class Brain {
    constructor(embDim, rng) {
        this.embDim = embDim || EMB_DIMS;
        const s = netSizes(this.embDim);
        this.ballSel = new Net(s.ballSel, rng, "linear");
        this.bucketSel = new Net(s.bucketSel, rng, "linear");
        this.motor = new Net(s.motor, rng, "sigmoid");
        this._bs = new Float32Array(s.ballSel[0]);
        this._ks = new Float32Array(s.bucketSel[0]);
        this._scores = new Float32Array(MAX_BALLS);
    }

    nets() { return [this.ballSel, this.bucketSel, this.motor]; }

    paramCount() {
        return this.nets().reduce((s, n) => s + n.weights.reduce((a, w) => a + w.length, 0), 0);
    }

    /* Score every ball slot and return {idx, conf}. `slots` is a flat
     * Float32Array of MAX_BALLS * BALL_FEATS. */
    selectBall(slots, ctx, emb) {
        const buf = this._bs, nb = BALL_FEATS, nc = CTX_FEATS;
        let best = -Infinity, bestI = -1;
        for (let s = 0; s < MAX_BALLS; s++) {
            for (let i = 0; i < nb; i++) buf[i] = slots[s * nb + i];
            for (let i = 0; i < nc; i++) buf[nb + i] = ctx[i];
            for (let i = 0; i < emb.length; i++) buf[nb + nc + i] = emb[i];
            const v = this.ballSel.forward(buf)[0];
            this._scores[s] = v;
            if (v > best) { best = v; bestI = s; }
        }
        // softmax confidence — how decided the choice is, fed to the motor head
        let z = 0;
        for (let s = 0; s < MAX_BALLS; s++) z += Math.exp(this._scores[s] - best);
        return { idx: bestI, conf: 1 / z };
    }

    selectBucket(slots, ctx, emb) {
        const buf = this._ks, nb = BUCKET_FEATS, nc = CTX_FEATS;
        let best = -Infinity, bestI = 0, scores = [];
        for (let s = 0; s < NBUCKET_SLOTS; s++) {
            for (let i = 0; i < nb; i++) buf[i] = slots[s * nb + i];
            for (let i = 0; i < nc; i++) buf[nb + i] = ctx[i];
            for (let i = 0; i < emb.length; i++) buf[nb + nc + i] = emb[i];
            const v = this.bucketSel.forward(buf)[0];
            scores.push(v);
            if (v > best) { best = v; bestI = s; }
        }
        let z = 0;
        for (let s = 0; s < NBUCKET_SLOTS; s++) z += Math.exp(scores[s] - best);
        return { idx: bestI, conf: 1 / z };
    }

    act(motorIn) { return this.motor.forward(motorIn); }

    clone() {
        const b = new Brain(this.embDim, null);
        b.ballSel = this.ballSel.clone();
        b.bucketSel = this.bucketSel.clone();
        b.motor = this.motor.clone();
        return b;
    }

    /* The three heads mutate at different strengths.
     *
     * The selectors are tiny and every weight in them changes a DISCRETE
     * decision — one weight can flip which ball the arm goes for, which is a
     * jump in behaviour, not a nudge. The motor head is the opposite: it drives
     * continuous setpoints through a rate-limited servo, so a weight change
     * mostly smears. Mutating both at the same rate means the selectors are
     * either frozen (if you tune for the motor) or thrashing (if you tune for
     * the selectors), and a thrashing selector destroys the motor head's
     * fitness signal because it never gets to finish a reach. */
    mutate(rate, sigma, rng) {
        if (BRAIN_MODULAR) {
            /* ONE HEAD PER CHILD.
             *
             * The three heads have wildly different learning timescales, measured
             * separately: in isolation the bucket selector reaches 90% accuracy
             * in ~40 hill-climb steps, while the motor head needs ~1,700 to
             * learn a single pick-and-place. Mutating all three in the same child
             * means that every time the motor head takes a step, the selectors
             * have also moved — and the selectors decide WHICH BALL the motor
             * head is aiming at. Its input distribution keeps being redrawn
             * underneath it, faster than it can adapt.
             *
             * Perturbing one module at a time keeps the other two as a stable
             * context, which is what makes a child's score attributable to the
             * change it actually carries. The motor head is drawn most often
             * because it is the slowest to learn and has the most weights.
             *
             * Measured on stage 1 (gridsearch.js, 120 generations, 2 reps),
             * top-quartile deliveries per episode:
             *
             *     all-heads 0.20/0.15   0.075      <- the original default
             *     modular   0.30/0.20   0.125
             *     modular   0.20/0.15   0.125
             *     modular   0.12/0.20   0.250      <- 3.3x, now the default
             *
             * The two knobs INTERACT, which is why sweeping them separately was
             * misleading. With all three heads moving, a lower rate was strictly
             * worse (0.06/0.12 scored 0.000) — small changes to everything at
             * once never escape anywhere. Once only one head moves per child, a
             * low rate stops being paralysis and becomes refinement. */
            const r = rng();
            if (r < 0.62) this.motor.mutate(rate, sigma, rng);
            else if (r < 0.81) this.ballSel.mutate(rate, sigma * 0.8, rng);
            else this.bucketSel.mutate(rate, sigma * 0.8, rng);
            return this;
        }
        this.ballSel.mutate(rate * 0.6, sigma * 0.8, rng);
        this.bucketSel.mutate(rate * 0.6, sigma * 0.8, rng);
        this.motor.mutate(rate, sigma, rng);
        return this;
    }

    static crossover(a, b, rng) {
        const c = new Brain(a.embDim, null);
        c.ballSel = Net.crossover(a.ballSel, b.ballSel, rng);
        c.bucketSel = Net.crossover(a.bucketSel, b.bucketSel, rng);
        c.motor = Net.crossover(a.motor, b.motor, rng);
        return c;
    }

    toJSON() {
        return {
            v: 1, embDim: this.embDim,
            ballSel: this.ballSel.toJSON(),
            bucketSel: this.bucketSel.toJSON(),
            motor: this.motor.toJSON()
        };
    }

    static fromJSON(o) {
        const b = new Brain(o.embDim, null);
        b.ballSel = Net.fromJSON(o.ballSel);
        b.bucketSel = Net.fromJSON(o.bucketSel);
        b.motor = Net.fromJSON(o.motor);
        return b;
    }
}

function setModularMutation(on) { BRAIN_MODULAR = !!on; }

if (typeof module !== "undefined") module.exports = {
    Net, Brain, mulberry32, gaussRand, netSizes, setModularMutation,
    MAX_BALLS, NBUCKET_SLOTS, BALL_FEATS, BUCKET_FEATS, CTX_FEATS, MOTOR_FEATS, OUT_INIT
};
