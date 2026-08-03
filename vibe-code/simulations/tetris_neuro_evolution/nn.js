/* nn.js — the genomes. Two architectures, one evolutionary interface.
 *
 * Evolved only. There is no backprop, no optimiser, no loss function and no
 * gradient anywhere in this project: every weight in here got where it is by
 * being copied, mutated or crossed over and then out-scoring its siblings.
 *
 *   Net      — plain feedforward. tanh hidden layers, sigmoid outputs.
 *   ConvNet  — a weight-shared convolutional stack over the 20×10 board plane,
 *              whose feature map is concatenated with the remaining (non-plane)
 *              sensors and fed to a dense head.
 *
 * Both expose exactly what the GA touches: forward(), clone(), mutate(),
 * mutateAdaptive(), the static crossover(), toJSON() and a contract() string.
 * Everything shared lives in Genome, so a new architecture only has to describe
 * its weight blocks and say how to run them forward.
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

/* ------------------------------------------------------------- activations
 *
 * tanh hidden + sigmoid out was the original choice, and it is a *defensible*
 * default for evolution rather than an obviously optimal one:
 *
 *  · tanh is bounded, so a mutation that doubles a weight cannot double the
 *    activations feeding the next layer. ReLU is unbounded and a lineage can
 *    drift into ever-larger activations that saturate the output sigmoid into a
 *    constant key pattern — the failure mode gradient descent controls with
 *    normalisation layers that do not exist here.
 *  · the classic argument *against* ReLU — dead units have zero gradient forever
 *    — does not apply, because there is no gradient. A unit stuck at zero is
 *    revived by any mutation that lifts its bias, so evolution can repair
 *    exactly the damage backprop cannot.
 *
 * Which of those dominates is an empirical question about this problem, so the
 * activation is a config field and the search settles it.
 *
 * The output layer stays a squashing function with an explicit press threshold:
 * seven keys are pressed when their unit clears it. sigmoid → 0.5, tanh → 0.
 * Activation cost is negligible either way; a forward pass does ~14,000
 * multiply-adds and ~100 activation calls. */
const ACTS = {
    tanh: { f: Math.tanh, threshold: 0, gain: 1.0 },
    sigmoid: { f: x => 1 / (1 + Math.exp(-x)), threshold: 0.5, gain: 1.0 },
    relu: { f: x => (x > 0 ? x : 0), threshold: 0, gain: 1.0 },
    // leaky, so a unit that mutates below zero still passes a signal through and
    // selection can see the difference between "slightly off" and "very off"
    lrelu: { f: x => (x > 0 ? x : 0.1 * x), threshold: 0, gain: 1.0 },
    elu: { f: x => (x > 0 ? x : Math.exp(x) - 1), threshold: 0, gain: 1.0 },
    // bounded like tanh but cheaper and flatter near zero
    softsign: { f: x => x / (1 + Math.abs(x)), threshold: 0, gain: 1.0 },
};
function actOf(name, dflt) {
    const a = ACTS[name || dflt];
    if (!a) throw new Error("unknown activation: " + name);
    return a;
}

/* ------------------------------------------------------------------ Genome
 *
 * A genome is a list of weight blocks. Each block is a Float32Array of
 * `rows × rowLen`, where a row is one unit's incoming weights plus its bias in
 * the last column — a neuron for dense layers, a filter for convolutional ones.
 * Mutation walks the flat arrays; crossover swaps whole rows. Neither cares
 * which of the two architectures it is looking at, which is the point: the
 * architecture search below can put a conv stack and an MLP in the same
 * population-level machinery without touching the GA.
 */
class Genome {
    constructor() {
        /* Self-adaptive step size. Each genome carries its own multiplier on the
         * global mutation strength, and that multiplier is itself mutated and
         * inherited. Nobody tunes it: lineages that happen to carry a step size
         * suited to where they are on the landscape out-reproduce the ones that
         * do not, so the population discovers its own annealing schedule —
         * coarse while it is far from anything good, fine once it is close, and
         * different for different lineages at the same time. Pure selection, no
         * gradient. (The global anneal still multiplies this.) */
        this.sigma = 1;
        this.weights = [];      // per block: Float32Array(rows × rowLen)
        this.layout = [];       // per block: {rows, rowLen}
    }

    /* shapes: [{rows, rowLen, fanIn, out}] — `out` marks the final layer, which
     * starts near zero so a fresh brain rests its hands on the keyboard instead
     * of mashing every key at once. Near-zero actions mutate into useful ones
     * far faster than saturated ones do. */
    _alloc(shapes, initRng) {
        this.weights = [];
        this.layout = [];
        for (const s of shapes) {
            const w = new Float32Array(s.rows * s.rowLen);
            if (initRng) {
                const scale = (s.out ? 0.06 : 1.0) * Math.sqrt(2 / Math.max(1, s.fanIn));
                for (let i = 0; i < w.length; i++) w[i] = gaussRand(initRng) * scale;
            }
            this.weights.push(w);
            this.layout.push({ rows: s.rows, rowLen: s.rowLen });
        }
    }

    get paramCount() { return this.weights.reduce((s, w) => s + w.length, 0); }

    clone() {
        const n = this._blank();
        for (let l = 0; l < this.weights.length; l++) n.weights[l].set(this.weights[l]);
        n.sigma = this.sigma;
        return n;
    }

    /* Mutate the step size first, then the weights with it — the order matters:
     * the child is judged on weights produced by its *own* step size, so the two
     * are selected together. */
    mutateAdaptive(rate, globalSigma, rng, tau) {
        this.sigma = Math.min(6, Math.max(0.12, this.sigma * Math.exp(tau * gaussRand(rng))));
        return this.mutate(rate, globalSigma * this.sigma, rng);
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

    /* Row-wise crossover: whole units (a row of incoming weights + its bias)
     * swap between parents. Swapping individual weights scrambles what each unit
     * computes; swapping units keeps functional pieces intact — a hidden neuron
     * for an MLP, a whole learned filter for a conv stack. */
    static crossover(a, b, rng) {
        const child = a.clone();
        child.sigma = Math.sqrt(a.sigma * b.sigma);       // step size is inherited too
        for (let l = 0; l < child.weights.length; l++) {
            const wc = child.weights[l], wb = b.weights[l];
            const { rows, rowLen } = child.layout[l];
            for (let o = 0; o < rows; o++) {
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
}

/* -------------------------------------------------------------------- MLP */
class Net extends Genome {
    constructor(sizes, initRng, acts) {
        super();
        this.sizes = sizes.slice();
        this.acts = { hidden: (acts && acts.hidden) || "tanh", out: (acts && acts.out) || "sigmoid" };
        this._hid = actOf(this.acts.hidden, "tanh").f;
        const outAct = actOf(this.acts.out, "sigmoid");
        this._out = outAct.f;
        this.threshold = outAct.threshold;       // a key is pressed above this
        const shapes = [];
        for (let l = 0; l < sizes.length - 1; l++) {
            shapes.push({
                rows: sizes[l + 1], rowLen: sizes[l] + 1, fanIn: sizes[l],
                out: l === sizes.length - 2,
            });
        }
        this._alloc(shapes, initRng);
        this._buf = sizes.map(n => new Float32Array(n));
    }

    _blank() { return new Net(this.sizes, null, this.acts); }

    contract() {
        const a = this.acts.hidden === "tanh" && this.acts.out === "sigmoid"
            ? "" : `:${this.acts.hidden}/${this.acts.out}`;
        return this.sizes.join("-") + a;
    }

    forward(input) {
        let cur = this._buf[0];
        cur.set(input);
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const nIn = this.sizes[l], nOut = this.sizes[l + 1];
            const next = this._buf[l + 1];
            const act = l === this.weights.length - 1 ? this._out : this._hid;
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1);
                let sum = w[base + nIn];                       // bias
                for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                next[o] = act(sum);
            }
            cur = next;
        }
        return cur;
    }

    toJSON() {
        return {
            sizes: this.sizes, acts: this.acts, sigma: this.sigma,
            weights: this.weights.map(w => Array.from(w)),
        };
    }

    static fromJSON(o) {
        // brains saved before activations were selectable are tanh/sigmoid
        const n = new Net(o.sizes, null, o.acts);
        for (let l = 0; l < n.weights.length; l++) n.weights[l].set(o.weights[l]);
        if (o.sigma) n.sigma = o.sigma;
        return n;
    }
}

/* ------------------------------------------------------------------ ConvNet
 *
 * Why a convolution here at all: the board plane is a picture, and "there is a
 * one-cell notch to my left" means the same thing in column 2 as in column 8. A
 * dense layer has to learn that fact 10 times over, once per position, from
 * 200 separate weights per hidden unit. A 3×3 filter learns it once, in 9
 * shared weights, and applies it everywhere. For a GA that matters twice over:
 * fewer parameters is a smaller search space, and each mutation is a change to
 * a *concept* ("notch detector") rather than to one pixel of one position.
 *
 * The non-plane sensors (piece identity, queue, drop preview, held keys, the
 * timing clocks) bypass the convolution entirely and join the flattened feature
 * map at the dense head — they are not spatial and there is nothing to share.
 *
 * Resolved spec, stored in the genome so a saved brain rebuilds exactly:
 *   { kind:"conv", in, out, plane:{at,h,w}, conv:[{k,ch,stride,pool}], colmax, hidden:[..] }
 */
class ConvNet extends Genome {
    constructor(spec, initRng) {
        super();
        const sp = ConvNet.normalize(spec);
        this.spec = sp;
        this._hid = actOf(sp.acts.hidden, "tanh").f;
        const outAct = actOf(sp.acts.out, "sigmoid");
        this._out = outAct.f;
        this.threshold = outAct.threshold;

        // ---- work out the shape of every stage before allocating anything
        let h = sp.plane.h, w = sp.plane.w, ch = 1;
        this.stages = [];
        const shapes = [];
        for (const c of sp.conv) {
            const oh = Math.floor((h - c.k) / c.stride) + 1;
            const ow = Math.floor((w - c.k) / c.stride) + 1;
            if (oh < 1 || ow < 1) throw new Error(`conv ${c.k}×${c.k}/${c.stride} does not fit ${h}×${w}`);
            let ph = oh, pw = ow;
            if (c.pool > 1) { ph = Math.floor(oh / c.pool); pw = Math.floor(ow / c.pool); }
            if (ph < 1 || pw < 1) throw new Error(`pool ${c.pool} does not fit ${oh}×${ow}`);
            this.stages.push({ k: c.k, ch: c.ch, stride: c.stride, pool: c.pool, inCh: ch, h, w, oh, ow, ph, pw });
            shapes.push({ rows: c.ch, rowLen: c.k * c.k * ch + 1, fanIn: c.k * c.k * ch, out: false });
            h = ph; w = pw; ch = c.ch;
        }
        this.mapSize = sp.colmax ? w * ch : h * w * ch;
        this.extraSize = sp.in - sp.plane.h * sp.plane.w;
        const denseIn = this.mapSize + this.extraSize;
        this.denseSizes = [denseIn].concat(sp.hidden, [sp.out]);
        for (let l = 0; l < this.denseSizes.length - 1; l++) {
            shapes.push({
                rows: this.denseSizes[l + 1], rowLen: this.denseSizes[l] + 1,
                fanIn: this.denseSizes[l], out: l === this.denseSizes.length - 2,
            });
        }
        this.nConv = sp.conv.length;
        this._alloc(shapes, initRng);

        // ---- scratch buffers; forward() runs millions of times per generation
        this._planeBuf = new Float32Array(sp.plane.h * sp.plane.w);
        this._act = [this._planeBuf];
        for (const s of this.stages) {
            this._act.push(new Float32Array(s.ch * s.oh * s.ow));
            this._act.push(s.pool > 1 ? new Float32Array(s.ch * s.ph * s.pw) : null);
        }
        this._dense = this.denseSizes.map(n => new Float32Array(n));
    }

    /* Fill in defaults and freeze the spec into its canonical form. */
    static normalize(spec) {
        return {
            kind: "conv",
            in: spec.in,
            out: spec.out || 7,
            plane: { at: spec.plane.at, h: spec.plane.h, w: spec.plane.w },
            conv: spec.conv.map(c => ({
                k: c.k, ch: c.ch, stride: c.stride || 1, pool: c.pool || 1,
            })),
            colmax: !!spec.colmax,
            hidden: spec.hidden.slice(),
            acts: {
                hidden: (spec.acts && spec.acts.hidden) || "tanh",
                out: (spec.acts && spec.acts.out) || "sigmoid",
            },
        };
    }

    _blank() { return new ConvNet(this.spec, null); }

    contract() {
        const conv = this.spec.conv
            .map(c => `c${c.k}x${c.ch}${c.stride > 1 ? "s" + c.stride : ""}${c.pool > 1 ? "p" + c.pool : ""}`)
            .join("+");
        const a = this.spec.acts.hidden === "tanh" && this.spec.acts.out === "sigmoid"
            ? "" : `:${this.spec.acts.hidden}/${this.spec.acts.out}`;
        return `conv[${this.spec.in}:${conv}${this.spec.colmax ? "+colmax" : ""}` +
            `→${this.mapSize}+${this.extraSize}→${this.spec.hidden.join("-")}→${this.spec.out}${a}]`;
    }

    forward(input) {
        const sp = this.spec, pl = sp.plane;

        // ---- lift the board plane out of the flat sensor vector
        const plane = this._planeBuf;
        for (let i = 0; i < plane.length; i++) plane[i] = input[pl.at + i];

        // ---- convolutions: valid padding, tanh, optional max pool
        let cur = plane, curH = pl.h, curW = pl.w, curCh = 1;
        for (let l = 0; l < this.nConv; l++) {
            const s = this.stages[l], w = this.weights[l];
            const outBuf = this._act[1 + l * 2];
            const rowLen = s.k * s.k * curCh + 1;
            for (let f = 0; f < s.ch; f++) {
                const base = f * rowLen, bias = w[base + rowLen - 1];
                const oPlane = f * s.oh * s.ow;
                for (let oy = 0; oy < s.oh; oy++) {
                    const iy0 = oy * s.stride;
                    for (let ox = 0; ox < s.ow; ox++) {
                        const ix0 = ox * s.stride;
                        let sum = bias, wi = base;
                        for (let c = 0; c < curCh; c++) {
                            const cPlane = c * curH * curW;
                            for (let ky = 0; ky < s.k; ky++) {
                                const row = cPlane + (iy0 + ky) * curW + ix0;
                                for (let kx = 0; kx < s.k; kx++) sum += w[wi++] * cur[row + kx];
                            }
                        }
                        outBuf[oPlane + oy * s.ow + ox] = this._hid(sum);
                    }
                }
            }
            cur = outBuf; curH = s.oh; curW = s.ow; curCh = s.ch;

            if (s.pool > 1) {
                const p = s.pool, pooled = this._act[2 + l * 2];
                for (let f = 0; f < s.ch; f++) {
                    const src = f * curH * curW, dst = f * s.ph * s.pw;
                    for (let oy = 0; oy < s.ph; oy++) {
                        for (let ox = 0; ox < s.pw; ox++) {
                            let best = -Infinity;
                            for (let dy = 0; dy < p; dy++) {
                                const row = src + (oy * p + dy) * curW + ox * p;
                                for (let dx = 0; dx < p; dx++) {
                                    const v = cur[row + dx];
                                    if (v > best) best = v;
                                }
                            }
                            pooled[dst + oy * s.pw + ox] = best;
                        }
                    }
                }
                cur = pooled; curH = s.ph; curW = s.pw;
            }
        }

        // ---- head input: feature map (optionally collapsed down each column)
        //      followed by every sensor that is not part of the plane
        const head = this._dense[0];
        let k = 0;
        if (sp.colmax) {
            for (let f = 0; f < curCh; f++) {
                const src = f * curH * curW;
                for (let x = 0; x < curW; x++) {
                    let best = -Infinity;
                    for (let y = 0; y < curH; y++) {
                        const v = cur[src + y * curW + x];
                        if (v > best) best = v;
                    }
                    head[k++] = best;
                }
            }
        } else {
            for (let i = 0; i < curCh * curH * curW; i++) head[k++] = cur[i];
        }
        for (let i = 0; i < pl.at; i++) head[k++] = input[i];
        for (let i = pl.at + pl.h * pl.w; i < sp.in; i++) head[k++] = input[i];

        // ---- dense head
        let act = head;
        for (let l = 0; l < this.denseSizes.length - 1; l++) {
            const w = this.weights[this.nConv + l];
            const nIn = this.denseSizes[l], nOut = this.denseSizes[l + 1];
            const next = this._dense[l + 1];
            const fn = l === this.denseSizes.length - 2 ? this._out : this._hid;
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1);
                let sum = w[base + nIn];
                for (let i = 0; i < nIn; i++) sum += w[base + i] * act[i];
                next[o] = fn(sum);
            }
            act = next;
        }
        return act;
    }

    toJSON() {
        return { arch: this.spec, sigma: this.sigma, weights: this.weights.map(w => Array.from(w)) };
    }

    static fromJSON(o) {
        const n = new ConvNet(o.arch, null);
        for (let l = 0; l < n.weights.length; l++) n.weights[l].set(o.weights[l]);
        if (o.sigma) n.sigma = o.sigma;
        return n;
    }
}

/* ------------------------------------------------- architecture selection
 *
 * NET_ARCH is the one place that decides what shape of brain the GA breeds.
 * The GA itself only ever calls makeNet(); nothing downstream of here knows
 * whether it is holding an MLP or a conv stack.
 *
 *   {kind:"mlp",  hidden:[64,32]}
 *   {kind:"conv", conv:[{k:3,ch:8,pool:2}], colmax:false, hidden:[48,24]}
 */
let NET_ARCH = { kind: "mlp", hidden: [64, 32] };

function setArch(arch) {
    NET_ARCH = JSON.parse(JSON.stringify(arch));
    if (NET_ARCH.kind !== "conv") NET_SIZES = [IN_SIZE].concat(NET_ARCH.hidden, [7]);
    return NET_ARCH;
}

/* Resolve NET_ARCH against the *current* sensor layout. Conv needs the board
 * plane to be switched on: without it there is no picture to convolve. */
function archSpec() {
    const bp = SENSE_LAYOUT.boardPlane;
    if (!bp || !bp.size) throw new Error("conv architecture needs the boardPlane sensor block");
    return {
        kind: "conv", in: IN_SIZE, out: 7,
        plane: { at: bp.at, h: BH, w: BW },
        conv: NET_ARCH.conv, colmax: NET_ARCH.colmax, hidden: NET_ARCH.hidden,
        acts: NET_ARCH.acts,
    };
}

function makeNet(rng) {
    if (NET_ARCH.kind === "conv") return new ConvNet(archSpec(), rng);
    return new Net([IN_SIZE].concat(NET_ARCH.hidden, [7]), rng, NET_ARCH.acts);
}

function netFromJSON(o) {
    const n = o.net || o;
    return n.arch ? ConvNet.fromJSON(n) : Net.fromJSON(n);
}

/* What a brain must match to be loadable in this build — the sensor count is
 * baked into every first-layer row, so a brain trained against a different
 * input profile is not merely worse, it is unusable. */
function archContract(rng) {
    return makeNet(null).contract();
}

if (typeof module !== "undefined") {
    module.exports = {
        Genome, Net, ConvNet, mulberry32, gaussRand,
        makeNet, netFromJSON, setArch, archSpec, archContract,
    };
}
