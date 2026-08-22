/* nn.js — the genomes. Two architectures, one evolutionary interface.
 *
 * Evolved only. There is no backprop, no optimiser, no loss function and no
 * gradient anywhere in this project: every weight got where it is by being
 * copied, mutated or crossed over and then out-scoring its siblings.
 *
 *   Net      — plain feedforward over the flattened observation.
 *   ConvNet  — a weight-shared convolutional stack over the rendered image,
 *              whose feature map is concatenated with the non-spatial extras
 *              (move history, clock) and fed to a dense head.
 *
 * Conv is not decoration here. The input is a 48×24 picture with three colour
 * channels per remembered frame, so a dense first layer of 32 units is 110k
 * weights — a search space a GA has no business entering. More importantly the
 * input is *translation-structured in a useful way*: "a green sticker sits next
 * to a white one" means the same thing wherever on the face it appears, and the
 * two panels are the same projection, so a filter learned on one is valid on the
 * other. A dense layer has to learn every such fact once per pixel position from
 * scratch. The same argument as the Tetris board plane, with more pixels and
 * fewer excuses.
 *
 * Both classes expose exactly what the GA touches: forward(), clone(), mutate(),
 * mutateAdaptive(), the static crossover(), toJSON() and a contract() string.
 * Everything shared lives in Genome, so a new architecture only has to describe
 * its weight blocks and say how to run them forward.
 */
"use strict";

/* How often a mutated weight is redrawn from scratch rather than nudged.
 *
 * A few percent is healthy for a population evolving from random: genuinely new
 * values keep entering the pool long after the additive noise has annealed down,
 * and every survivor was *selected under this operator*, so the lineages that
 * could not tolerate the occasional reset died early. It is a knob rather than a
 * constant because a network that arrived by any other route has never faced it
 * and is not robust to it — see the Tetris project, where a distilled brain lost
 * 60% of its skill to twenty redrawn weights. */
let MUT_RESET = 0.03;
function setMutReset(p) { MUT_RESET = Math.max(0, Math.min(1, p)); return MUT_RESET; }

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Box–Muller, with the spare kept *per generator* rather than in a module-level
 * variable. A shared spare makes every consumer's stream depend on how many
 * draws every other consumer happened to make, which silently breaks `--seed`
 * reproducibility — a bug this project has already paid for once, in the walking
 * sim's activation demes. */
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

/* ------------------------------------------------------------- activations
 *
 * tanh hidden is the default for the usual evolutionary reason: it is bounded, so
 * a mutation that doubles a weight cannot double the activations feeding the next
 * layer, and a lineage cannot drift into ever-larger activations the way it can
 * under ReLU. The classic argument *against* ReLU — dead units have no gradient
 * — does not apply when there is no gradient: a unit stuck at zero is revived by
 * any mutation that lifts its bias. Which effect dominates is empirical, so the
 * activation is a config field and the grid search settles it.
 *
 * The output activation is very nearly irrelevant here, and it is worth being
 * explicit about why: the action is `argmax` over the outputs, and every
 * activation in this table is monotone, so it cannot change which unit wins. It
 * is kept because it bounds the numbers the page draws as bars, and because
 * `linear` genuinely is the cheapest correct choice. */
const ACTS = {
    tanh: { f: Math.tanh },
    sigmoid: { f: x => 1 / (1 + Math.exp(-x)) },
    relu: { f: x => (x > 0 ? x : 0) },
    lrelu: { f: x => (x > 0 ? x : 0.1 * x) },
    elu: { f: x => (x > 0 ? x : Math.exp(x) - 1) },
    softsign: { f: x => x / (1 + Math.abs(x)) },
    /* Added in round 5. Round 4 measured ReLU beating tanh at the same width by more
     * than the width increase itself was worth, on a project that had inherited "tanh
     * under a GA" as an assumption and never tested it. That makes the activation a
     * first-class search dimension rather than a default, so the obvious family is
     * here to be swept. All are monotone, so the argmax stays meaningful. */
    elu: { f: x => (x > 0 ? x : Math.exp(x) - 1) },
    selu: { f: x => 1.0507 * (x > 0 ? x : 1.67326 * (Math.exp(x) - 1)) },
    softsign: { f: x => x / (1 + Math.abs(x)) },
    swish: { f: x => x / (1 + Math.exp(-x)) },
    gelu: { f: x => 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x))) },
    /* A bounded ReLU: keeps the dead-unit-free gradient-free story of tanh at the top
     * end while staying linear near zero, which is where an evolved weight lands. */
    relu6: { f: x => (x > 0 ? (x < 6 ? x : 6) : 0) },
    linear: { f: x => x },
};
function actOf(name, dflt) {
    const a = ACTS[name || dflt];
    if (!a) throw new Error("unknown activation: " + name);
    return a;
}

/* ------------------------------------------------------------------ Genome */
class Genome {
    constructor() {
        /* Self-adaptive step size. Each genome carries its own multiplier on the
         * global mutation strength, itself mutated and inherited, so the
         * population discovers its own annealing schedule instead of being given
         * one — coarse while it is far from anything good, fine once close, and
         * different for different lineages at the same time. */
        this.sigma = 1;
        this.weights = [];
        this.layout = [];
    }

    /* shapes: [{rows, rowLen, fanIn, out}] — one row per unit (or per filter),
     * incoming weights plus the bias in the last column.
     *
     * `out` marks the final layer, which starts near zero. On a thresholded
     * actuator that stops a fresh brain from mashing every key; here, where the
     * action is an argmax, it does something subtler and just as useful — all
     * eight outputs start within a whisker of each other, so which move wins is
     * decided by the smallest weights in the network and a single mutation can
     * change the policy. A saturated output layer, by contrast, votes for the
     * same move on every cube in the universe and needs a large coordinated
     * change before selection can see anything at all. */
    _alloc(shapes, initRng) {
        this.weights = [];
        this.layout = [];
        for (const s of shapes) {
            const w = new Float32Array(s.rows * s.rowLen);
            if (initRng) {
                const scale = (s.out ? 0.05 : 1.0) * Math.sqrt(2 / Math.max(1, s.fanIn));
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

    /* Mutate the step size first, then the weights with it. The order matters:
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
                    if (rng() < MUT_RESET) w[i] = gaussRand(rng) * 0.5;
                    else w[i] += gaussRand(rng) * sigma;
                }
            }
        }
        return this;
    }

    /* Per-layer mutation scale. A convolutional filter has 27–150 weights and a
     * dense head row has hundreds; the same absolute σ is a gentle nudge to one
     * and a rewrite of the other. Scaling by 1/√fanIn keeps the *change in a
     * unit's pre-activation* comparable across layers, which is the quantity
     * selection actually sees. Off by default so the grid search can measure it
     * rather than inherit it. */
    mutateScaled(rate, sigma, rng) {
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const fan = Math.max(1, this.layout[l].rowLen - 1);
            const s = sigma * Math.sqrt(16 / fan);
            for (let i = 0; i < w.length; i++) {
                if (rng() < rate) {
                    if (rng() < MUT_RESET) w[i] = gaussRand(rng) * 0.5;
                    else w[i] += gaussRand(rng) * s;
                }
            }
        }
        return this;
    }

    /* Row-wise crossover: whole units swap between parents. Swapping individual
     * weights scrambles what each unit computes; swapping units keeps functional
     * pieces intact — a hidden neuron, or a whole learned filter. */
    static crossover(a, b, rng) {
        const child = a.clone();
        child.sigma = Math.sqrt(a.sigma * b.sigma);
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
        this.acts = { hidden: (acts && acts.hidden) || "tanh", out: (acts && acts.out) || "tanh" };
        this._hid = actOf(this.acts.hidden, "tanh").f;
        this._out = actOf(this.acts.out, "tanh").f;
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
        const a = this.acts.hidden === "tanh" && this.acts.out === "tanh"
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
                let sum = w[base + nIn];
                for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                next[o] = act(sum);
            }
            cur = next;
        }
        return cur;
    }

    /* The activation of every layer, as left by the most recent forward(). The page
     * draws these; nothing in the trainer reads them, and nothing here copies — a
     * viewer that wants to keep a frame must copy it itself.
     *
     * Exposed deliberately rather than reached into. `_buf` is scratch and its shape
     * is an implementation detail of forward(); this is the shape a reader can rely
     * on, which is the difference between an accessor and a leak. */
    activations() {
        const last = this.sizes.length - 1;
        return this.sizes.map((n, l) => ({
            label: l === 0 ? "input" : l === last ? "output" : `hidden ${l}`,
            values: this._buf[l],
            act: l === 0 ? "identity" : l === last ? this.acts.out : this.acts.hidden,
        }));
    }

    toJSON() {
        return {
            sizes: this.sizes, acts: this.acts, sigma: this.sigma,
            weights: this.weights.map(w => Array.from(w)),
        };
    }

    static fromJSON(o) {
        const n = new Net(o.sizes, null, o.acts);
        for (let l = 0; l < n.weights.length; l++) n.weights[l].set(o.weights[l]);
        if (o.sigma) n.sigma = o.sigma;
        return n;
    }
}

/* ------------------------------------------------------------------ ConvNet
 *
 * Resolved spec, stored in the genome so a saved brain rebuilds exactly:
 *   { kind:"conv", in, out, plane:{at,ch,h,w}, conv:[{k,ch,stride,pool}],
 *     hidden:[..], acts:{hidden,out} }
 *
 * The plane is (ch, h, w) plane-major — `ch` is 3 × the number of remembered
 * frames, so the first convolution sees the whole temporal window at once and a
 * filter can respond to *change* rather than to colour. Everything in the input
 * vector outside the plane block (move history one-hots, the clock) bypasses the
 * convolution entirely and joins the flattened feature map at the dense head:
 * those are not spatial and there is nothing to share.
 */
class ConvNet extends Genome {
    constructor(spec, initRng) {
        super();
        const sp = ConvNet.normalize(spec);
        this.spec = sp;
        this._hid = actOf(sp.acts.hidden, "tanh").f;
        this._out = actOf(sp.acts.out, "tanh").f;

        let h = sp.plane.h, w = sp.plane.w, ch = sp.plane.ch;
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
        this.mapSize = h * w * ch;
        this.extraSize = sp.in - sp.plane.ch * sp.plane.h * sp.plane.w;
        if (this.extraSize < 0) throw new Error("plane is larger than the input vector");
        /* Recurrence widens the *input* to the first dense layer by the size of that
         * layer's own previous activations, and nothing else changes: it is one extra
         * block of weights the GA searches like any other.
         *
         * The reason to try it is that memory is the axis that has already paid twice
         * here — two remembered moves to four was the largest single effect in the
         * project, and removing image history on top of that was larger still. A
         * fixed four-move window is a crude memory: it says *what* was played and
         * nothing about what the brain concluded. A recurrent state can carry the
         * latter, and it costs `hidden[0]` extra inputs rather than a whole image
         * plane. */
        this.recSize = sp.recurrent ? (sp.hidden[0] || 0) : 0;
        this.denseSizes = [this.mapSize + this.extraSize + this.recSize].concat(sp.hidden, [sp.out]);
        for (let l = 0; l < this.denseSizes.length - 1; l++) {
            shapes.push({
                rows: this.denseSizes[l + 1], rowLen: this.denseSizes[l] + 1,
                fanIn: this.denseSizes[l], out: l === this.denseSizes.length - 2,
            });
        }
        this.nConv = sp.conv.length;
        this._alloc(shapes, initRng);

        /* Scratch buffers. forward() runs a few hundred million times per run and
         * must not allocate. */
        this._act = [null];
        for (const s of this.stages) {
            this._act.push(new Float32Array(s.ch * s.oh * s.ow));
            this._act.push(s.pool > 1 ? new Float32Array(s.ch * s.ph * s.pw) : null);
        }
        this._dense = this.denseSizes.map(n => new Float32Array(n));
        this._rec = this.recSize ? new Float32Array(this.recSize) : null;
    }

    /* Zeroed at the start of every episode. Without this a brain's first move would
     * depend on the last cube it was shown, which makes an episode's result depend on
     * bank order — a brain would score differently purely because it was evaluated
     * second. Runner calls this in its constructor. */
    resetState() { if (this._rec) this._rec.fill(0); }

    static normalize(spec) {
        return {
            kind: "conv",
            /* Elman-style recurrence on the first dense layer. See forward(). */
            recurrent: !!spec.recurrent,
            in: spec.in,
            out: spec.out,
            plane: { at: spec.plane.at | 0, ch: spec.plane.ch, h: spec.plane.h, w: spec.plane.w },
            conv: spec.conv.map(c => ({ k: c.k, ch: c.ch, stride: c.stride || 1, pool: c.pool || 1 })),
            hidden: spec.hidden.slice(),
            acts: {
                hidden: (spec.acts && spec.acts.hidden) || "tanh",
                out: (spec.acts && spec.acts.out) || "tanh",
            },
        };
    }

    _blank() { return new ConvNet(this.spec, null); }

    /* Same contract as Net.activations(): every layer as the last forward() left it.
     * Conv stages carry their shape so a viewer can lay a feature map out as a map
     * rather than as a line of numbers. */
    activations() {
        const out = [];
        this.stages.forEach((s, i) => {
            out.push({
                label: `conv ${i + 1}`, values: this._act[1 + i * 2],
                ch: s.ch, h: s.oh, w: s.ow, act: this.spec.acts.hidden,
            });
            if (s.pool > 1) {
                out.push({
                    label: `pool ${i + 1}`, values: this._act[2 + i * 2],
                    ch: s.ch, h: s.ph, w: s.pw, act: "max",
                });
            }
        });
        const last = this.denseSizes.length - 1;
        for (let l = 1; l <= last; l++) {
            out.push({
                label: l === last ? "output" : `hidden ${l}`,
                values: this._dense[l],
                act: l === last ? this.spec.acts.out : this.spec.acts.hidden,
            });
        }
        return out;
    }

    contract() {
        const conv = this.spec.conv
            .map(c => `c${c.k}x${c.ch}${c.stride > 1 ? "s" + c.stride : ""}${c.pool > 1 ? "p" + c.pool : ""}`)
            .join("+");
        const a = this.spec.acts.hidden === "tanh" && this.spec.acts.out === "tanh"
            ? "" : `:${this.spec.acts.hidden}/${this.spec.acts.out}`;
        const p = this.spec.plane;
        return `conv[${p.ch}×${p.h}×${p.w}:${conv}→${this.mapSize}+${this.extraSize}` +
            `${this.recSize ? "+rec" + this.recSize : ""}` +
            `→${this.spec.hidden.join("-")}→${this.spec.out}${a}]`;
    }

    forward(input) {
        const sp = this.spec, pl = sp.plane;

        /* The plane sits at the front of the input vector and is already
         * plane-major, so the first stage reads it in place — no copy. */
        let cur = input, curH = pl.h, curW = pl.w, curCh = pl.ch, curOff = pl.at;

        /* Hoisted out of the innermost loop on purpose: `this._hid` is read once
         * per filter position otherwise, and this is the hottest loop in the
         * project by an order of magnitude — a training run spends about 80% of
         * its wall clock inside it. */
        const hid = this._hid;

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
                            const cPlane = curOff + c * curH * curW;
                            for (let ky = 0; ky < s.k; ky++) {
                                const row = cPlane + (iy0 + ky) * curW + ix0;
                                for (let kx = 0; kx < s.k; kx++) sum += w[wi++] * cur[row + kx];
                            }
                        }
                        outBuf[oPlane + oy * s.ow + ox] = hid(sum);
                    }
                }
            }
            cur = outBuf; curH = s.oh; curW = s.ow; curCh = s.ch; curOff = 0;

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

        // ---- head: feature map, then every input outside the plane block
        const head = this._dense[0];
        let k = 0;
        for (let i = 0; i < this.mapSize; i++) head[k++] = cur[curOff + i];
        const planeEnd = pl.at + pl.ch * pl.h * pl.w;
        for (let i = 0; i < pl.at; i++) head[k++] = input[i];
        for (let i = planeEnd; i < sp.in; i++) head[k++] = input[i];
        if (this.recSize) for (let i = 0; i < this.recSize; i++) head[k++] = this._rec[i];

        let act = head;
        for (let l = 0; l < this.denseSizes.length - 1; l++) {
            const w = this.weights[this.nConv + l];
            const nIn = this.denseSizes[l], nOut = this.denseSizes[l + 1];
            const next = this._dense[l + 1];
            const fn = l === this.denseSizes.length - 2 ? this._out : hid;
            for (let o = 0; o < nOut; o++) {
                const base = o * (nIn + 1);
                let sum = w[base + nIn];
                for (let i = 0; i < nIn; i++) sum += w[base + i] * act[i];
                next[o] = fn(sum);
            }
            act = next;
        }
        /* Carry this step's first-hidden-layer activations into the next step. Captured
         * after the full pass so that the state a move was chosen with is the state the
         * *previous* move produced, never this one's — an off-by-one here would let the
         * network see a function of its own current output. */
        if (this.recSize) this._rec.set(this._dense[1].subarray(0, this.recSize));
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
 * `makeNet` is the only thing the GA calls, and nothing downstream of here knows
 * whether it is holding an MLP or a conv stack. The observation layout is passed
 * in rather than read from a global, because a brain is a set of weights against
 * one exact input layout: hand it a different one and it does not degrade
 * gracefully, it reads garbage.
 */
function buildNet(arch, layout, rng) {
    if (arch.kind === "conv") {
        return new ConvNet({
            kind: "conv", in: layout.size, out: layout.nMoves,
            plane: { at: layout.planeAt, ch: layout.channels, h: layout.H, w: layout.W },
            conv: arch.conv, hidden: arch.hidden, acts: arch.acts,
            recurrent: !!arch.recurrent,
        }, rng);
    }
    return new Net([layout.size].concat(arch.hidden, [layout.nMoves]), rng, arch.acts);
}

function netFromJSON(o) {
    const n = o.net || o;
    return n.arch ? ConvNet.fromJSON(n) : Net.fromJSON(n);
}

/* The action: whichever output unit is largest. Every activation in ACTS is
 * monotone, so this is the argmax of the pre-activations too — the squash is for
 * the benefit of the bar chart on the page, not the decision.
 *
 * `mask` lets a caller forbid moves (the page uses it for "never undo the move
 * you just made", as a demonstration; training does not, because a policy that
 * needs the environment to stop it looping has not learned anything). */
function chooseMove(out, mask) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < out.length; i++) {
        if (mask && mask[i]) continue;
        if (out[i] > best) { best = out[i]; bi = i; }
    }
    return bi;
}

if (typeof module !== "undefined") {
    module.exports = {
        Genome, Net, ConvNet, mulberry32, gaussRand,
        buildNet, netFromJSON, setMutReset, chooseMove, ACTS,
    };
}
