/* NOTE ON THE IIFE WRAPPER AROUND THIS FILE.
 *
 * Every module here is a Node CommonJS file AND is loaded by the page as a
 * plain <script> tag, because these simulations are expected to run from a
 * file:// URL with no server, no bundler and no network. Under Node each file
 * gets its own scope; under a script tag they all share one, and nine files
 * that each begin `const M = ...` and `const DEG = Math.PI/180` collide on the
 * first one and take the rest of the page down with them. The wrapper gives
 * each file its own scope in both worlds. `module` is still visible inside it
 * under Node, so the export at the bottom is unaffected.
 */
;(function () {
/* nn.js — the brain, and the small number of decisions about it that actually
 * decide whether a genetic algorithm can get off the ground.
 *
 * SHAPE. A plain feed-forward stack: 209 inputs, two hidden layers, ten outputs.
 * There is no recurrence, and that is a considered choice rather than a
 * simplification — the memory the task needs is already in the observation, as
 * an eight-lag differenced window reaching three seconds back (see sensors.js).
 * An evolved recurrent net has to discover both WHAT to remember and HOW to
 * hold it, through a search that has no gradient; handing it the history
 * outright costs 112 inputs and buys the entire second half of that problem.
 *
 * ACTIVATION. tanh everywhere, and the reason is specific to evolution rather
 * than to this task. A ReLU unit that mutation pushes into the dead half is dead
 * permanently — there is no gradient to revive it, and its whole row of weights
 * becomes inert genetic material that crossover then spreads through the
 * population. Bounded activations also mean a mutation cannot produce a network
 * that outputs 400; the worst it can do is saturate, which is recoverable. The
 * one alternative offered here is softsign, which is bounded in the same way and
 * saturates more gently; it is available behind a flag because it is a fair
 * question and worth a controlled A/B rather than an opinion.
 *
 * THE OUTPUT LAYER STARTS SMALL — BUT NOT AS SMALL AS ELSEWHERE. Every other
 * neuroevolution project in this collection initialises the output layer at 3%
 * of the hidden scale, so a fresh individual does nothing. Here, doing nothing
 * means falling out of the sky at three hundred metres a second, and a whole
 * population of statues arrives at the ground in states so uniformly terrible
 * that generation 1 carries almost no information. So the output scale is 0.35,
 * and on top of it every fresh brain gets a random BIAS JITTER on the three
 * decision outputs — engine count, legs, and whether to commit to the tower.
 * Those three are read through thresholds, and a threshold applied to a
 * distribution centred on zero with a tiny spread gives the same answer for
 * every member of the fleet. The jitter is what makes generation 1 contain
 * boosters that light three engines and boosters that light thirteen, boosters
 * that go for the tower and boosters that head for the water — which is the
 * variation selection needs and cannot manufacture on its own.
 *
 * DECISIONS ARE MADE AT 2 Hz, control at 20 Hz. The same genome produces both;
 * the difference is only that the three decision outputs are latched and held
 * for ten ticks. "How many engines are lit" is not a quantity that should be
 * revisited fifty times a second, and a vehicle whose engine count flickers
 * spends its ignition credits in the first half second.
 */
"use strict";

const S = (typeof require !== "undefined") ? require("./sensors.js") : window.SensorsMod;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Box-Muller with the spare cached ON THE RNG OBJECT. A module-level spare
 * leaks one normal from whoever drew last into whoever draws next, which makes
 * a seeded run depend on evaluation order and quietly destroys every
 * reproducibility guarantee in the trainer. */
function gaussRand(rng) {
    const s = rng._spare;
    if (s != null) { rng._spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    rng._spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
}

/* THE INPUT LAYER IS THE GENOME. At 209 inputs, `small` is still 21,906 weights
 * because 209x80 = 16,720 of them are the first layer — narrowing the hidden
 * layers barely moves the total, and the received wisdom is that direct-encoded
 * GAs degrade badly past a few thousand weights. `tiny` and `mini` exist to test
 * that against this problem, and they are only genuinely small when the input
 * count comes down too (see ROCKET_LAGS in sensors.js): at 139 inputs they are
 * 12,570 and 3,930 weights against std's 40,234. */
const ARCHS = {
    mini: [24, 16],
    tiny: [64, 48],
    small: [80, 56],
    std: [128, 96],
    wide: [192, 128],
    deep: [128, 96, 64]
};

const N_OUT = 10;
/* Output slots that are read through a threshold rather than as a magnitude.
 * These are the ones that need bias jitter to produce a varied first
 * generation, and the ones that get latched.
 *
 * THE LATCH PERIOD IS A CONSTRAINT ON THE POLICY CLASS, AND AT 2 Hz IT EXCLUDED
 * THE ONLY POLICY THAT WORKS.
 *
 * Slot 1 is the engine group, so the latch decides how precisely ignition can be
 * timed — and ignition is not a preference here, it is an event the whole
 * approach is built around: light when the height left no longer covers the
 * braking distance plus the dead time. At 250 m/s a 0.5 s latch period is 125 m
 * of altitude against an ignition margin of about 140 m, so a deployed brain
 * could be a full margin late through no fault of its network.
 *
 * Measured directly, by flying the hand-written teacher under the student's own
 * latch on stage 0 (vtest/latch.js, 100 episodes each):
 *
 *     no latch (how the labels are generated)   23%
 *     every 10 ticks  (0.50 s)                   4%     <- what was deployed
 *     every 5         (0.25 s)                  13%
 *     every 3         (0.15 s)                  22%
 *
 * That is the explanation for five straight rounds of DAgger catching 0/200
 * from a 23% teacher while reproducing its actions to a mean absolute error of
 * 0.02 per channel: the copy was accurate and the target was not executable.
 * A student cannot learn to pull a trigger it is not allowed to reach for.
 *
 * The latch exists so that engine count is not a free continuous knob, and that
 * job is done by the ignition credits — asking for MORE engines than are running
 * spends one of three and costs a 450 ms hole in the thrust, while stepping down
 * is free. Three ticks keeps the anti-chatter intent and returns the timing
 * precision the task actually requires. */
const DECISION_SLOTS = [1, 8, 9];
const DECIDE_EVERY = 3;

function netSpec(nin, arch) {
    const hid = ARCHS[arch || "std"] || ARCHS.std;
    return { nin, layers: [nin].concat(hid, [N_OUT]), arch: arch || "std" };
}

class Stack {
    constructor(sizes, initRng, outScale, act) {
        this.sizes = sizes.slice();
        this.act = act || "tanh";
        this.weights = [];
        this.scales = [];
        for (let l = 0; l < sizes.length - 1; l++) {
            const nIn = sizes[l], nOut = sizes[l + 1];
            const w = new Float32Array(nOut * (nIn + 1));
            const isOut = l === sizes.length - 2;
            const scale = (isOut ? outScale : 1.0) * Math.sqrt(2 / nIn);
            if (initRng) for (let i = 0; i < w.length; i++) w[i] = gaussRand(initRng) * scale;
            this.weights.push(w);
            this.scales.push(scale);
        }
        this.buf = sizes.map(n => new Float32Array(n));
    }

    forward(input) {
        let cur = this.buf[0];
        cur.set(input);
        const soft = this.act === "softsign";
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const nIn = this.sizes[l], nOut = this.sizes[l + 1];
            const next = this.buf[l + 1];
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1);
                let sum = w[base + nIn];
                for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                next[o] = soft ? sum / (1 + (sum < 0 ? -sum : sum)) : Math.tanh(sum);
            }
            cur = next;
        }
        return cur;
    }
}

class Brain {
    constructor(spec, initRng, opts) {
        opts = opts || {};
        this.spec = { nin: spec.nin, layers: spec.layers.slice(), arch: spec.arch };
        this.act = opts.act || spec.act || "tanh";
        this.spec.act = this.act;
        this.net = new Stack(spec.layers, initRng, opts.outScale != null ? opts.outScale : 0.35, this.act);
        if (initRng) this._jitterDecisions(initRng);
    }

    /* See the header. Without this the entire first generation makes identical
     * discrete choices and the only thing selection can see is gimbal noise. */
    _jitterDecisions(rng) {
        const w = this.net.weights[this.net.weights.length - 1];
        const nIn = this.net.sizes[this.net.sizes.length - 2];
        for (const o of DECISION_SLOTS) {
            w[o * (nIn + 1) + nIn] += gaussRand(rng) * 0.75;
        }
    }

    forward(x) { return this.net.forward(x); }

    clone() {
        const b = new Brain(this.spec, null, { act: this.act });
        for (let l = 0; l < this.net.weights.length; l++) {
            b.net.weights[l].set(this.net.weights[l]);
            b.net.scales[l] = this.net.scales[l];
        }
        return b;
    }

    /* Mutation is scaled per layer by that layer's own weight spread. The input
     * layer is He-initialised over 209 inputs and the output layer starts at a
     * third of the hidden scale; a single absolute sigma either flattens the
     * output head or never moves the trunk. `scales` is re-measured from the
     * actual weights by calibrate() whenever a brain comes off disk, because a
     * brain that has been evolving for a thousand generations no longer has the
     * spread it was initialised with. */
    mutate(rate, sigma, rng) {
        const st = this.net;
        for (let l = 0; l < st.weights.length; l++) {
            const w = st.weights[l], s = sigma * st.scales[l];
            for (let i = 0; i < w.length; i++) {
                if (rng() < rate) {
                    // A small fraction of mutations are resets rather than
                    // nudges: a Gaussian random walk explores a shrinking ball,
                    // and the occasional full redraw is what lets a lineage
                    // leave a basin it has been polishing for 200 generations.
                    if (rng() < 0.03) w[i] = gaussRand(rng) * st.scales[l] * 3.5;
                    else w[i] += gaussRand(rng) * s;
                }
            }
        }
        return this;
    }

    /* EVERY CHILD GETS ITS OWN MUTATION SIZE, drawn log-normally, and a quarter
     * of them mutate only a HANDFUL of weights.
     *
     * One fixed (rate, sigma) is one fixed search radius, and a 40 000-weight
     * genome sitting on a plateau needs both ends of the scale at once: tiny
     * steps to polish a policy that is nearly right, and occasional large ones
     * to leave the basin at all. Measured on this task, heritability stays
     * above 0.92 across the whole grid from (0.02, 0.05) to (0.35, 0.15), so
     * spanning it costs nothing in inheritance — there is no reason to pick one
     * point on a range that is uniformly safe.
     *
     * `spread` is the sigma of the log-normal on both multipliers, so
     * spread = 0.9 gives a middle half of roughly 0.5x to 1.8x and a tail that
     * reaches an order of magnitude either way.
     *
     * THE SPARSE MODE IS THE OTHER HALF OF THE ARGUMENT. At rate 0.11 the
     * smallest possible child differs from its parent in four thousand weights,
     * which is a large jump however small each step is, and a policy that is one
     * coefficient away from working cannot be reached. So a fraction of children
     * mutate a geometrically-distributed count between 1 and a few hundred
     * genes, drawn log-uniformly so single-gene changes are common. */
    mutateVaried(rate, sigma, rng, opts) {
        opts = opts || {};
        const spread = opts.spread != null ? opts.spread : 0.9;
        const pSparse = opts.sparse != null ? opts.sparse : 0.25;
        const maxGenes = opts.maxGenes || 256;
        const st = this.net;

        if (rng() < pSparse) {
            const total = this.weightCount();
            // log-uniform in [1, maxGenes]: single-gene edits are as likely as
            // any other decade, which is what "a few genes at a time" requires.
            const n = Math.max(1, Math.round(Math.exp(rng() * Math.log(maxGenes))));
            const sMul = Math.exp(gaussRand(rng) * spread);
            for (let k = 0; k < n; k++) {
                let idx = Math.floor(rng() * total);
                for (let l = 0; l < st.weights.length; l++) {
                    const w = st.weights[l];
                    if (idx < w.length) {
                        if (rng() < 0.03) w[idx] = gaussRand(rng) * st.scales[l] * 3.5;
                        else w[idx] += gaussRand(rng) * sigma * sMul * st.scales[l];
                        break;
                    }
                    idx -= w.length;
                }
            }
            return this;
        }

        const rMul = Math.exp(gaussRand(rng) * spread);
        const sMul = Math.exp(gaussRand(rng) * spread);
        return this.mutate(Math.min(1, rate * rMul), sigma * sMul, rng);
    }

    calibrate() {
        const st = this.net;
        for (let l = 0; l < st.weights.length; l++) {
            const w = st.weights[l];
            let s = 0;
            for (let i = 0; i < w.length; i++) s += w[i] * w[i];
            const rms = Math.sqrt(s / Math.max(1, w.length));
            if (rms > 1e-9) st.scales[l] = rms;
        }
        return this;
    }

    /* Row-wise crossover: a whole neuron — its incoming weights and its bias —
     * comes from one parent or the other, never a mixture of individual
     * weights. Two parents' hidden units are in arbitrary and unrelated orders,
     * so per-weight crossover scrambles what each unit computes; swapping whole
     * units keeps functional pieces intact. */
    static crossover(a, b, rng) {
        const child = a.clone();
        const A = child.net, B = b.net;
        for (let l = 0; l < A.weights.length; l++) {
            const wc = A.weights[l], wb = B.weights[l];
            const rowLen = A.sizes[l] + 1, nOut = A.sizes[l + 1];
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

    weightCount() {
        let n = 0;
        for (const w of this.net.weights) n += w.length;
        return n;
    }

    hash() {
        let h = 2166136261 >>> 0;
        const dv = new DataView(new ArrayBuffer(4));
        for (const w of this.net.weights) {
            for (let i = 0; i < w.length; i++) {
                dv.setFloat32(0, w[i]);
                for (let b = 0; b < 4; b++) {
                    h = (h ^ dv.getUint8(b)) >>> 0;
                    h = Math.imul(h, 16777619) >>> 0;
                }
            }
        }
        return h.toString(16).padStart(8, "0");
    }

    toJSON() {
        return {
            format: "rocket-brain-v1",
            spec: this.spec,
            act: this.act,
            sizes: this.net.sizes,
            scales: this.net.scales,
            weights: this.net.weights.map(w => Array.from(w))
        };
    }

    static fromJSON(o) {
        const spec = o.spec || { nin: o.sizes[0], layers: o.sizes, arch: "custom" };
        /* A BRAIN IS ONLY MEANINGFUL AGAINST THE SENSOR VECTOR IT GREW IN.
         *
         * Without this check a brain trained on an older observation layout
         * loads without complaint, is then handed a vector of a different
         * length, and flies — badly, silently, and in a way that looks like a
         * bad champion rather than a stale one. Every input added or removed
         * also shifts the meaning of every index after it, so even a matching
         * length would not be enough on its own; the length is simply the part
         * that can be checked cheaply.
         *
         * THE CHECK BELONGS WHERE THE PAIRING HAPPENS, NOT HERE. It used to
         * compare against the PROCESS-WIDE S.N_INPUT, which made loading a
         * genome depend on an environment variable rather than on anything
         * about the genome — so a 139-input champion could not even be read in
         * a 209-input process, and the publisher dropped the two best arms
         * every sync. A Brain on its own is just weights; it becomes wrong only
         * when it is handed the wrong observation, and that is BrainPolicy's
         * business. Moved there, where the lag set is known. */
        const b = new Brain(spec, null, { act: o.act || "tanh" });
        for (let l = 0; l < b.net.weights.length; l++) {
            b.net.weights[l].set(o.weights[l]);
            if (o.scales && o.scales[l] != null) b.net.scales[l] = o.scales[l];
        }
        return b;
    }
}

/* ------------------------------------------------------------------------- */
/* The thing a World actually calls. Owns the sensor history, so it must be    */
/* reset between episodes — and one of these per worker, not one per brain.    */
/* ------------------------------------------------------------------------- */
class BrainPolicy {
    /* `opts.lags` selects the observation layout. It defaults to the lag set the
     * brain itself was evolved with, which is carried in its JSON, and only then
     * to the process default — so replaying an archived champion never depends
     * on an environment variable being set the same way it was during training. */
    constructor(brain, opts) {
        this.brain = brain;
        const lags = (opts && opts.lags) || (brain && brain.lags) || null;
        this.sensors = new S.Sensors(lags);
        /* The pairing check that used to live in Brain.fromJSON. Here it can be
         * exact: this sensor produces this many inputs, and the genome expects
         * that many, or the two do not belong together. */
        const want = brain && brain.spec ? brain.spec.nin : null;
        if (want != null && want !== this.sensors.nInput) {
            throw new Error("brain expects a " + want + "-input observation; these sensors produce " +
                this.sensors.nInput + " (lags " + this.sensors.lags.join(",") + "). Wrong lag set.");
        }
        this.held = new Float64Array(N_OUT);
        this.tick = 0;
    }
    setBrain(b) { this.brain = b; return this; }
    reset() { this.sensors.reset(); this.held.fill(0); this.tick = 0; }

    act(world, out) {
        const x = this.sensors.observe(world);
        const y = this.brain.forward(x);
        for (let i = 0; i < N_OUT; i++) out[i] = y[i];
        // Latch the slow decisions: they are re-evaluated at 2 Hz and held in
        // between, so a network cannot chatter its engine count.
        if (this.tick % DECIDE_EVERY === 0) {
            for (const s of DECISION_SLOTS) this.held[s] = out[s];
        } else {
            for (const s of DECISION_SLOTS) out[s] = this.held[s];
        }
        this.sensors.recordAction(out);
        this.tick++;
        return out;
    }
}

if (typeof module !== "undefined") {
    module.exports = { Brain, BrainPolicy, Stack, netSpec, mulberry32, gaussRand, ARCHS, N_OUT, DECISION_SLOTS, DECIDE_EVERY };
} else {
    window.NN = { Brain, BrainPolicy, netSpec, mulberry32, gaussRand, ARCHS, N_OUT };
}

})();
