/* nn.js — the two evolvable building blocks: a plain MLP and a GRU cell.
 * Evolved only. No gradients anywhere, ever.
 *
 * WHY A GRU IS IN A GA SIM. Recurrence is expensive for gradient methods —
 * backpropagation through a 256-tick rollout is the whole reason forward-model
 * papers stay Markovian — and completely free for a genetic algorithm, which
 * only ever runs the network forwards. So the per-body memory here costs us
 * nothing but arithmetic, and it buys something real: a body can accumulate its
 * own orbital context over a rollout instead of re-deriving it from one frame.
 *
 * Both classes expose the same genome surface (`weights`, `scales`, clone,
 * mutate, crossover, toJSON) so the GA never needs to know which it is holding.
 *
 * Outputs are tanh and start near zero. Here that means a fresh brain predicts
 * *zero acceleration* — every body flies in a straight line, which is exactly
 * the constant-velocity baseline. That is a far better place to start than a
 * random force field, which ejects planets on tick one and makes every member
 * of generation 1 score identically badly.
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

/* Box-Muller's spare normal is cached ON THE RNG, never in a module-level
 * variable: with one shared cache a leftover spare from the previous consumer
 * leaks into the next one, and two runs with identical seeds diverge depending
 * on what happened earlier in the process. Every reproducibility claim in this
 * simulator rests on that not happening. */
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

/* ------------------------------------------------------------------------- *
 * WeightBag — everything the GA knows how to breed.
 *
 * A bag of (out × (in+1)) matrices, each with its own mutation scale. Both the
 * MLP and the GRU cell are one of these; the GA calls nothing else.
 * ------------------------------------------------------------------------- */
class WeightBag {
    constructor() {
        this.weights = [];   // Float32Array per matrix, bias in the last column
        this.scales = [];    // the init standard deviation of each matrix
        this.rows = [];      // output rows per matrix
        this.cols = [];      // input columns per matrix (bias NOT counted)
    }

    _add(nOut, nIn, scale, initRng) {
        const w = new Float32Array(nOut * (nIn + 1));
        if (initRng) for (let i = 0; i < w.length; i++) w[i] = gaussRand(initRng) * scale;
        this.weights.push(w); this.scales.push(scale);
        this.rows.push(nOut); this.cols.push(nIn);
        return w;
    }

    nParams() { return this.weights.reduce((a, w) => a + w.length, 0); }

    _copyInto(dst) {
        for (let l = 0; l < this.weights.length; l++) dst.weights[l].set(this.weights[l]);
        dst.scales = this.scales.slice();   // scales travel with the brain
        return dst;
    }

    /* `sigma` is RELATIVE to each matrix's own init scale, not an absolute step.
     * An output layer starts twenty times tighter than a hidden one, and an
     * absolute sigma large enough to move a hidden weight usefully would saturate
     * an output weight on its first mutation. Here sigma reads as "fraction of
     * the spread this matrix was born with", so 0.35 is the same relative step
     * everywhere in the genome. */
    mutate(rate, sigma, rng) {
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            const s = sigma * this.scales[l];
            const reset = 3 * this.scales[l];
            for (let i = 0; i < w.length; i++) {
                if (rng() < rate) {
                    if (rng() < 0.03) w[i] = gaussRand(rng) * reset;   // rare full reset
                    else w[i] += gaussRand(rng) * s;
                }
            }
        }
        return this;
    }

    /* Reset each matrix's mutation scale to the RMS of the weights it actually
     * holds rather than the spread it was BORN with. Needed whenever a genome
     * arrives from anywhere other than a fresh random init — a resumed champion
     * whose output matrix has grown twenty times its init spread would otherwise
     * go on being mutated by a rounding error, and the population would look
     * converged from generation one. */
    calibrateScales() {
        for (let l = 0; l < this.weights.length; l++) {
            const w = this.weights[l];
            let s = 0;
            for (let i = 0; i < w.length; i++) s += w[i] * w[i];
            this.scales[l] = Math.max(Math.sqrt(s / w.length), 0.05 * this.scales[l]);
        }
        return this;
    }

    /* Row-wise crossover: a whole output row (its incoming weights plus bias)
     * moves between parents as a unit. Swapping individual weights scrambles
     * what each unit computes; swapping units keeps functional pieces intact —
     * and in this model a hidden unit of the edge network really is one learned
     * feature of a two-body geometry, worth keeping whole. */
    static mix(child, b, rng) {
        for (let l = 0; l < child.weights.length; l++) {
            const wc = child.weights[l], wb = b.weights[l];
            const rowLen = child.cols[l] + 1, nOut = child.rows[l];
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

    _weightsJSON() { return { scales: this.scales.slice(), weights: this.weights.map(w => Array.from(w)) }; }

    _loadJSON(o) {
        for (let l = 0; l < this.weights.length; l++) this.weights[l].set(o.weights[l]);
        if (o.scales && o.scales.length === this.scales.length) this.scales = o.scales.slice();
        else this.calibrateScales();
        return this;
    }
}

/* ------------------------------------------------------------------------- *
 * Net — plain MLP, tanh on every layer including the output.
 * ------------------------------------------------------------------------- */
/* `outScale` multiplies He initialisation on the LAST layer only, and it is the
 * single most consequential hyperparameter in this file.
 *
 * A control task wants it tiny: a fresh brain that commands nothing survives
 * long enough to be told apart from its neighbours, and a fresh brain that
 * slams the actuators is dead before it is measured. A REGRESSION task like
 * this one wants it near the scale of the answer, because a search that starts
 * forty times below the target spends its whole budget random-walking upward
 * through a region where every individual is indistinguishably wrong. The
 * default here stays conservative; model.js overrides it per network, and the
 * value was chosen by measuring, not by taste — see the README. */
class Net extends WeightBag {
    constructor(sizes, initRng, outScale) {
        super();
        this.sizes = sizes.slice();
        this.outScale = outScale != null ? outScale : 0.05;
        for (let l = 0; l < sizes.length - 1; l++) {
            const isOut = l === sizes.length - 2;
            this._add(sizes[l + 1], sizes[l], (isOut ? this.outScale : 1.0) * Math.sqrt(2 / sizes[l]), initRng);
        }
        this._buf = sizes.map(n => new Float32Array(n));
    }

    forward(input) {
        let cur = this._buf[0];
        for (let i = 0; i < cur.length; i++) cur[i] = input[i];
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

    clone() { return this._copyInto(new Net(this.sizes, null, this.outScale)); }
    static crossover(a, b, rng) { return WeightBag.mix(a.clone(), b, rng); }
    toJSON() { return Object.assign({ kind: "mlp", sizes: this.sizes, outScale: this.outScale }, this._weightsJSON()); }
    static fromJSON(o) { return new Net(o.sizes, null, o.outScale)._loadJSON(o); }
}

/* ------------------------------------------------------------------------- *
 * GRUCell — per-body memory carried along a rollout.
 *
 *   z = σ(Wz·[x,h])          update gate
 *   r = σ(Wr·[x,h])          reset gate
 *   n = tanh(Wn·[x, r⊙h])    candidate
 *   h' = z⊙h + (1-z)⊙n
 *
 * The update-gate bias starts at +1 so a fresh cell *retains* rather than
 * overwrites. At init n ≈ 0 either way, so this changes nothing about
 * generation 1's behaviour — but it means the first mutation that writes
 * something into h finds a cell that will actually keep it, instead of one that
 * flushes memory to zero every tick and makes the recurrence unevolvable.
 * ------------------------------------------------------------------------- */
class GRUCell extends WeightBag {
    constructor(nIn, nHid, initRng) {
        super();
        this.nIn = nIn; this.nHid = nHid;
        const nc = nIn + nHid;
        const s = Math.sqrt(2 / nc);
        this._add(nHid, nc, s, initRng);                 // Wz
        this._add(nHid, nc, s, initRng);                 // Wr
        this._add(nHid, nc, 0.05 * s, initRng);          // Wn — near-zero, like an output layer
        if (initRng) for (let o = 0; o < nHid; o++) this.weights[0][o * (nc + 1) + nc] += 1.0;   // retain bias
        this._cat = new Float32Array(nc);
        this._z = new Float32Array(nHid);
        this._r = new Float32Array(nHid);
        this._n = new Float32Array(nHid);
    }

    /* h is read and written in place. */
    forward(x, h) {
        const nIn = this.nIn, nHid = this.nHid, nc = nIn + nHid;
        const cat = this._cat;
        for (let i = 0; i < nIn; i++) cat[i] = x[i];
        for (let i = 0; i < nHid; i++) cat[nIn + i] = h[i];
        const Wz = this.weights[0], Wr = this.weights[1], Wn = this.weights[2];
        for (let o = 0; o < nHid; o++) {
            const base = o * (nc + 1);
            let sz = Wz[base + nc], sr = Wr[base + nc];
            for (let i = 0; i < nc; i++) { sz += Wz[base + i] * cat[i]; sr += Wr[base + i] * cat[i]; }
            this._z[o] = 1 / (1 + Math.exp(-sz));
            this._r[o] = 1 / (1 + Math.exp(-sr));
        }
        for (let i = 0; i < nHid; i++) cat[nIn + i] = this._r[i] * h[i];
        for (let o = 0; o < nHid; o++) {
            const base = o * (nc + 1);
            let sn = Wn[base + nc];
            for (let i = 0; i < nc; i++) sn += Wn[base + i] * cat[i];
            this._n[o] = Math.tanh(sn);
        }
        for (let i = 0; i < nHid; i++) h[i] = this._z[i] * h[i] + (1 - this._z[i]) * this._n[i];
        return h;
    }

    clone() { return this._copyInto(new GRUCell(this.nIn, this.nHid, null)); }
    static crossover(a, b, rng) { return WeightBag.mix(a.clone(), b, rng); }
    toJSON() { return Object.assign({ kind: "gru", nIn: this.nIn, nHid: this.nHid }, this._weightsJSON()); }
    static fromJSON(o) { return new GRUCell(o.nIn, o.nHid, null)._loadJSON(o); }
}

function partFromJSON(o) {
    return o.kind === "gru" ? GRUCell.fromJSON(o) : Net.fromJSON(o);
}

if (typeof module !== "undefined") {
    module.exports = { Net, GRUCell, WeightBag, partFromJSON, mulberry32, gaussRand };
}
