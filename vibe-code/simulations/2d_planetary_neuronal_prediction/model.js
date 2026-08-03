/* model.js — the evolved forward model.
 *
 * ============================ WHY NOT ONE BIG MLP ============================
 * A flat network over "all the bodies" has a fixed input width, so it can only
 * ever run on the body count it was born with, and it has to learn the same
 * force law separately for slot 3 and slot 7. This is an INTERACTION NETWORK
 * instead: one shared edge network sees a single ordered pair of bodies, one
 * shared node network sees a single body. A genome trained on four planets runs
 * unmodified on eleven, and the exam in train.js checks exactly that.
 *
 * =========================== HOW A TICK IS COMPUTED ==========================
 * Per body i, with a per-body recurrent latent h_i:
 *
 *   for each message-passing round:
 *     edge_ij  = EdgeNet([ pair invariants, h_i, h_j, ctx ])
 *     msg_i    = Σ_j  ( Σ_k crᵏ·Kᵏ )·r̂_ij  +  ( Σ_k ctᵏ·Kᵏ )·r̂⊥_ij      ← a VECTOR
 *     info_i   = mean_j edge_info_ij   ‖  max_j edge_info_ij            ← invariants
 *     h_i      = GRU(h_i, [ self invariants, info_i, ctx ])
 *
 *   a_i = msg_i  +  |msg_i|·γ·( n₀·m̂sg + n₁·m̂sg⊥ + n₂·v̂ + n₃·v̂⊥ )
 *              +  Σ_k p_k·( msg_i(t−k) − msg_i(t) )              ← the multistep term
 *         with n   = NodeNet([ self invariants, history invariants, info_i, h_i, ctx ])
 *         and p_k  = Schedule_k + adjustment_k(NodeNet)          ← scheme + per-body tweak
 *
 * ...and a second set of coefficients q_k produces a separate effective
 * acceleration for the VELOCITY half of the update. See stepVerlet in physics.js
 * for why those two are not the same vector.
 *
 * Four deliberate design choices, each of which cost something to get right:
 *
 * 1. THE OUTPUT IS A KERNEL MIXTURE, NOT A FORCE. A tanh can express ±1. The
 *    real accelerations in one of these systems span seven decades — a star at
 *    0.4 AU against a Mars-mass body at 6 AU. So the edge network does not emit
 *    a force; it emits dimensionless COEFFICIENTS over a fixed radial basis
 *    m/r, m/r², m/r³, m/r⁴, and the basis carries the dynamic range. Newton is
 *    the single point "coefficient 1 on m/r², zero on the rest", which is
 *    reachable but in no way privileged — the search is free to find anything
 *    else in that four-dimensional space, and at a finite timestep something
 *    else is genuinely better.
 *
 * 2. EVERYTHING IS ROTATION-EQUIVARIANT BY CONSTRUCTION. The edge network only
 *    ever reads rotation-invariant scalars (distances, masses, radial and
 *    tangential velocity components) and only ever emits scalars, which are
 *    then attached to the frame vectors r̂ and r̂⊥. Rotate the whole system and
 *    every prediction rotates with it, exactly. That symmetry is free here and
 *    would otherwise have to be learned from data, badly. The optional image is
 *    the one thing that can break it, which is why the image is canonically
 *    oriented before it is rasterised.
 *
 * 3. THE PAST IS REMEMBERED AS A MULTISTEP SCHEME, NOT AS COORDINATES. Each body
 *    keeps its last few states and its own last few force evaluations. Since the
 *    state is Markovian that adds no information — what it adds is the machinery
 *    of a linear multistep method, which is how a numerical integrator buys
 *    accuracy WITHOUT a second force evaluation, and a second force evaluation is
 *    precisely what the harness forbids. The difference basis makes every
 *    reachable scheme consistent and makes "ignore the history" the zero point.
 *
 *    The coefficients do NOT come from the node network alone, and that took two
 *    failed A/Bs to get right: they are a small directly-evolved genome (see
 *    Schedule) plus a per-body adjustment. And history has to be added to an
 *    ALREADY-ACCURATE force law rather than learned alongside one — a multistep
 *    scheme extrapolating a wrong force compounds error instead of cancelling
 *    truncation. See Predictor.graft and the long notes below.
 *
 * 4. MESSAGES SUM, DESCRIPTIONS AVERAGE. msg_i is a SUM over neighbours because
 *    forces add — that is physics, and it has to keep growing with N. The
 *    information channels feeding the memory and the node network are a MEAN
 *    and a MAX, because those are descriptions, and a description whose
 *    magnitude scales with the body count would push every unit into saturation
 *    the first time the model met a bigger system than it trained on.
 *
 * ============================== THE IMAGE ===================================
 * `image: true` adds the user-facing idea of showing the network a picture of
 * the system: an 8×8 log-mass raster, canonically oriented, encoded to a short
 * context vector that is appended to every edge, node and memory input. Note
 * up front that for pure gravity this is REDUNDANT — the pairwise features
 * already contain every mass and every separation exactly, and the raster only
 * contains them blurred into 64 buckets. It is kept because it is cheap, it is
 * a genuinely scalable way to summarise a crowd, and because whether it helps
 * is a question worth answering with an A/B rather than an opinion. See the
 * README for what the A/B actually said.
 */
"use strict";

/* --------------------------------------------------------------- config */

const MODEL_CFG = {
    mode: "phys",     // "phys" — the 1/r² feature is offered; "raw" — it is not
    image: false,     // append the encoded log-mass raster to every input
    mem: 8,           // per-body GRU latent width (0 disables recurrence)
    /* Remembered past ticks per body; 0 is the memoryless one-step model.
     *
     * DEFAULTS TO 0, which is what ships, and that is a measured decision rather
     * than a shrug. The history machinery is complete, tested and documented —
     * and every A/B run on it came back negative, for a reason that turned out
     * to be more interesting than the feature: a multistep scheme extrapolates
     * past force evaluations, so it AMPLIFIES error in the force it is given,
     * and this model's error in approximating 1/r² is larger than the residual
     * the scheme could win back. Measured: the same learned force law scores
     * 2.592 digits on the calm rung with a one-step update and 2.471 with
     * Adams-Bashforth 3 installed. The scheme helps exact forces (+0.78) and
     * hurts approximate ones. Set `--lags 4` to reproduce that. */
    lags: 0,
    rounds: 2,        // message-passing rounds per tick
    info: 4,          // extra invariant channels each edge may emit
    ctxDim: 6,        // width of the encoded image context
    grid: 8,          // raster resolution the network sees (grid × grid)
    /* Where a grafted brain's integration schedule starts. "zero" is the
     * one-step method, and is the setting that asks the scientifically
     * interesting question — does evolution DISCOVER a multistep scheme once its
     * force law is good enough for one to pay? "ab3" instead hands it the
     * classical answer and asks it to improve on that, which is the honest
     * engineering choice if discovery turns out to be too slow. Which one
     * produced the shipped brain is recorded in the README; the AB3 baseline is
     * reported either way, so a seeded schedule cannot quietly take credit for
     * the scheme it was given. */
    schedInit: "zero"
};

const N_KERNEL = 4;        // m/r, m/r², m/r³, m/r⁴
const COEF_SCALE = 1.25;   // so a tanh can comfortably reach a coefficient of 1
const NODE_GAIN = 0.35;    // the node correction is capped at 35% of |msg| per term
const EDGE_SOFT = 0.002;   // pair softening, in units of the reference length

/* Multistep coefficients live in [-MULTI_SCALE, +MULTI_SCALE]. Adams-Bashforth 3
 * needs -16/12 ≈ -1.33 on the first lag, so 2.0 leaves real headroom on both
 * sides of every classical scheme without letting a coefficient run away. */
const MULTI_SCALE = 2.0;
/* ...and the summed multistep term is capped at this multiple of |msg|. Four
 * lags each free to reach ±2 could in principle sum to 8·|Δa|, which is harmless
 * in a smooth orbit and catastrophic during a close approach where Δa between
 * consecutive ticks is larger than a itself. Every classical scheme's correction
 * is well under |a|, so this bound costs the search nothing it wants. */
const MULTI_CAP = 1.0;

/* Output-layer init, as a fraction of He (see the long note in nn.js).
 *
 * MEASURED, and it went the opposite way to the obvious argument. The reasoning
 * for a large value is that this is a regression task whose answer sits at a
 * coefficient of 1.0, so starting at 0.02 means random-walking up two orders of
 * magnitude before anything is distinguishable. `node sweep.js --what outscale`
 * says no: 0.02 and 0.10 finish within 0.06–0.09 digits of Newton after sixty
 * generations, while plain He finishes 0.41 behind and is beaten by every
 * smaller value. The reason is the same one that governs a control task — a
 * fresh brain with large random kernel coefficients applies a wrong force
 * field, the rollout diverges, the error saturates at the ceiling, and every
 * individual in generation 1 scores identically badly. Selection needs
 * *differences*, and near zero the population starts spread along the smooth
 * approach to the answer rather than piled against the ceiling.
 *
 * NODE stays smaller still: it emits a bounded correction on top of an already
 * reasonable force, so near-zero there really does mean "change nothing yet". */
let EDGE_OUT_SCALE = 0.10;
let NODE_OUT_SCALE = 0.10;
function setOutScales(edge, node) {
    if (edge != null) EDGE_OUT_SCALE = edge;
    if (node != null) NODE_OUT_SCALE = node;
}
/* So sweep.js can start from whatever is actually shipped rather than carrying
 * its own stale copy of these numbers — an experiment that silently measures a
 * configuration nobody uses is worse than no experiment. */
function getOutScales() { return { edge: EDGE_OUT_SCALE, node: NODE_OUT_SCALE }; }

/* Layer widths, derived from the config. Recomputed by refreshSpec(). */
let SPEC = null;

function setModelCfg(patch) {
    Object.assign(MODEL_CFG, patch || {});
    refreshSpec();
    return MODEL_CFG;
}

/* Invariant history channels per lag, fed to the node network and the memory
 * cell (see HIST_SELF in _fillSelf): how far the force has turned since that
 * tick (cos, sin), how much it has grown, and how far the velocity has turned. */
const HIST_PER_LAG = 4;

function refreshSpec() {
    const c = MODEL_CFG;
    const ctx = c.image ? c.ctxDim : 0;
    const mem = c.mem | 0;
    const lags = Math.max(0, c.lags | 0);
    // Two extra pair invariants per edge once history exists: how far this pair
    // rotated and how much its separation changed over the last tick.
    const edgeBase = (c.mode === "raw" ? 7 : 9) + (lags ? 2 : 0);
    const nodeBase = 10 + (lags ? HIST_PER_LAG * lags + 1 : 0);
    SPEC = {
        ctx, mem, lags,
        edgeBase, nodeBase,
        edgeIn: edgeBase + 2 * mem + ctx,
        edgeOut: 2 * N_KERNEL + c.info,
        nodeIn: nodeBase + 2 * c.info + mem + ctx,
        // 4 one-step correction terms, 2 velocity-split terms, and one multistep
        // coefficient per lag for each of the position and velocity updates.
        nodeOut: 6 + 2 * lags,
        gruIn: nodeBase + 2 * c.info + ctx,
        rasterN: c.grid * c.grid
    };
    SPEC.edgeSizes = [SPEC.edgeIn, 18, 14, SPEC.edgeOut];
    // The node hidden width does NOT depend on `lags`, deliberately. Turning the
    // history on already changes this layer's input width and output count, and
    // those are both edge-of-the-matrix changes that a graft can zero-fill
    // exactly. Resizing the hidden layer as well would mean inventing units in
    // the middle of a trained network, which is the one kind of surgery that
    // cannot be made behaviour-preserving for free. See `--graft` in train.js.
    SPEC.nodeSizes = [SPEC.nodeIn, 24, SPEC.nodeOut];
    SPEC.ctxSizes = [SPEC.rasterN, 16, c.ctxDim];
    return SPEC;
}
refreshSpec();

function specLabel() {
    const c = MODEL_CFG;
    return `${c.mode}${c.image ? "+img" + c.grid : ""}${c.mem ? "+mem" + c.mem : ""}` +
        `${c.lags ? "+lag" + c.lags : ""}×${c.rounds}r`;
}

const cl = (v, a, b) => (v < a ? a : v > b ? b : v);

/* The timestep, as the model sees it. LOGARITHMIC, and that is the fix for a
 * bug that quietly removed the model's most important input.
 *
 * The first version was `clamp(dt/T · 25, 0, 3)`. In a generated system dt/T
 * lands between about 0.02 and 0.13, so that expression sat pinned at the upper
 * clamp for essentially the whole operating range: `probe.js` showed 16, 25, 40
 * and 50 ticks per orbit producing byte-identical predictions. The model could
 * not see the step size at all, and the input degenerated into a constant — an
 * extra bias term.
 *
 * That matters more here than a saturated input usually would, because
 * step-size dependence IS the mechanism. A force law that beats Newton at a
 * finite dt does so by correcting the integrator, and a correction to the
 * integrator has to know how long the step is. Log scaling spans the whole
 * range of the ticks-per-orbit control (16 → 120) inside roughly [-0.6, 1.1],
 * comfortably clear of both clamps. */
function dtFeature(sys) {
    return cl(Math.log10(sys.dt / sys.ref.T + 1e-12) + 1.5, -1.5, 2);
}

/* -------------------------------------------------------------- the image */

/* Which body defines the canonical orientation of the raster: the SECOND most
 * massive one, i.e. the heaviest thing that is not the primary.
 *
 * Defined by mass ranking rather than by array position on purpose. "Body at
 * index 1" would have made the whole model depend on the order the generator
 * happened to fill the arrays in, and the permutation-invariance test in
 * test_headless.js catches exactly that — shuffling the bodies must not change
 * a single prediction, and with a positional anchor it changes all of them.
 *
 * Frozen per system so the frame cannot flip halfway through a rollout; a
 * raster that rotated by π between two ticks would look to the network like the
 * entire system teleporting. */
function anchorIndex(sys) {
    if (sys._anchor != null) return sys._anchor;
    let i1 = 0;
    for (let i = 1; i < sys.n; i++) if (sys.m[i] > sys.m[i1]) i1 = i;
    let i2 = -1;
    for (let i = 0; i < sys.n; i++) {
        if (i === i1) continue;
        if (i2 < 0 || sys.m[i] > sys.m[i2]) i2 = i;
    }
    sys._anchor = i2 < 0 ? i1 : i2;
    return sys._anchor;
}

/* Rasterise the system into `out` (grid × grid, row-major), values in [-1, 1].
 *
 * The cell value is LOG mass over nine decades, not linear mass. Linear, a star
 * is 1.0 and an Earth is 0.000003, so every planet in the picture rounds to the
 * same black pixel and the image carries exactly one bit: where the star is.
 * Bodies outside the frame are clamped onto the border rather than dropped,
 * which is the honest thing for a fixed-field-of-view picture to do. */
function buildRaster(st, m, sys, gridN, out) {
    const L = sys.ref.L, M = sys.ref.M;
    const R = 2.2 * L;
    const ai = anchorIndex(sys);
    const th = Math.atan2(st.y[ai], st.x[ai]);
    const c = Math.cos(-th), s = Math.sin(-th);
    out.fill(0);
    for (let i = 0; i < st.n; i++) {
        const rx = c * st.x[i] - s * st.y[i];
        const ry = s * st.x[i] + c * st.y[i];
        const gx = (rx + R) / (2 * R) * gridN - 0.5;
        const gy = (ry + R) / (2 * R) * gridN - 0.5;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const w = m[i] / M;
        for (let dy = 0; dy <= 1; dy++) {
            const cy = cl(y0 + dy, 0, gridN - 1);
            const wy = dy ? fy : 1 - fy;
            for (let dx = 0; dx <= 1; dx++) {
                const cx = cl(x0 + dx, 0, gridN - 1);
                out[cy * gridN + cx] += w * (dx ? fx : 1 - fx) * wy;
            }
        }
    }
    for (let k = 0; k < out.length; k++) {
        out[k] = 2 * cl((Math.log10(out[k] + 1e-9) + 9) / 9, 0, 1) - 1;
    }
    return out;
}

/* ------------------------------------------------------- the base schedule */

/* The integration scheme's DEFAULT coefficients, evolved directly as a handful
 * of free numbers rather than read off the node network's output layer.
 *
 * This exists because the first version did not have it, and the A/B said so.
 * With the coefficients emitted only by the node MLP, `lags 4` finished BEHIND
 * `lags 0` over eight paired repetitions (+0.064 against +0.191 digits) while
 * carrying 60% more parameters — and every variant sat far below the +0.78 that
 * the hand-coded classical scheme gets for nothing. The search was not finding
 * a multistep method at all. It could not easily: reaching AB3 that way means
 * arranging a specific pattern of activations across a 24-unit hidden layer for
 * every body in every system, so the credit assignment runs through dozens of
 * weights that all do other jobs too.
 *
 * So the scheme gets its own genome. It is 2·lags numbers — eight, for four
 * lags — each mutated directly, and Adams-Bashforth 3 is now roughly four
 * mutations away instead of a coordinated rewrite of a hidden layer. The node
 * network still emits a per-body ADJUSTMENT on top, which is where anything
 * better than a fixed classical rule has to come from.
 *
 * This is the same move as the kernel basis one level up. There the edge network
 * does not emit a force spanning seven decades, it emits dimensionless
 * coefficients over a basis that carries the range. Here the node network does
 * not emit an integration scheme from scratch, it emits a correction to one that
 * the search can reach on its own terms. In both cases the known structure is
 * put where it is cheap and the network is left the part that is genuinely
 * unknown.
 *
 * MUTATION SCALE IS PINNED, and that is the point of the class. WeightBag
 * mutates each matrix in proportion to the spread it was born with, so a genome
 * initialised at zero — which this one must be, so a fresh brain is the one-step
 * model — would be mutated by essentially nothing and never move. The floor in
 * calibrateScales keeps these eight numbers explorable for the whole run. */
const SCHED_STEP = 0.6;      // mutation scale for the scheme's own coefficients
const NODE_ADJ = 0.5;        // how far the per-body adjustment may move them

class Schedule extends WeightBag {
    constructor(nCoef, initRng) {
        super();
        this.nCoef = nCoef;
        // cols = 0: a bias-only matrix, i.e. `nCoef` free numbers. Born at zero
        // (initRng deliberately unused) so a fresh brain is exactly the one-step
        // model and the search pays for history only when it starts helping.
        this._add(nCoef, 0, SCHED_STEP, null);
        void initRng;
    }
    coef(k) { return Math.tanh(this.weights[0][k]); }
    calibrateScales() {
        for (let l = 0; l < this.weights.length; l++) this.scales[l] = SCHED_STEP;
        return this;
    }
    clone() { return this._copyInto(new Schedule(this.nCoef, null)); }
    toJSON() { return { nCoef: this.nCoef, bag: this._weightsJSON() }; }
    static fromJSON(o) {
        const s = new Schedule(o.nCoef, null);
        s._loadJSON(o.bag);
        s.calibrateScales();
        return s;
    }
}

/* ------------------------------------------------------------- Predictor */

class Predictor {
    constructor(initRng) {
        this.spec = {
            edgeSizes: SPEC.edgeSizes.slice(),
            nodeSizes: SPEC.nodeSizes.slice(),
            ctxSizes: SPEC.ctxSizes.slice(),
            gruIn: SPEC.gruIn, mem: SPEC.mem, ctx: SPEC.ctx, lags: SPEC.lags,
            info: MODEL_CFG.info, rounds: MODEL_CFG.rounds,
            mode: MODEL_CFG.mode, image: MODEL_CFG.image, grid: MODEL_CFG.grid
        };
        this.edge = new Net(this.spec.edgeSizes, initRng, EDGE_OUT_SCALE);
        this.node = new Net(this.spec.nodeSizes, initRng, NODE_OUT_SCALE);
        this.ctxNet = this.spec.ctx ? new Net(this.spec.ctxSizes, initRng, 1.0) : null;
        this.gru = this.spec.mem ? new GRUCell(this.spec.gruIn, this.spec.mem, initRng) : null;
        this.sched = this.spec.lags ? new Schedule(2 * this.spec.lags, initRng) : null;
        /* Optionally born holding the classical scheme.
         *
         * This is the configuration that actually works, and the reason is a
         * competition nobody planned for. A force law learned WITHOUT history is
         * not an approximation to Newton — it is a deliberate deviation from
         * 1/r² whose job is to cancel one-step truncation error. A multistep
         * scheme cancels exactly the same error. Put the two together and they
         * double-correct: grafting AB3 onto a finished one-step force law
         * measurably made it WORSE (exam 2.202 → 1.805 on the first generation
         * after the graft), and starting the schedule at zero instead left the
         * search sitting flat, because from that point any small coefficient is
         * a step downhill. It is a saddle, not a slope.
         *
         * So the scheme goes in FIRST, before the force law exists. Then the
         * search never has a reason to build truncation compensation into the
         * force, and what it learns is a correction to what the multistep scheme
         * leaves behind rather than a rival for it. */
        if (this.sched && MODEL_CFG.schedInit === "ab3") Predictor.setSchedule(this, 3);
        this._alloc(0);
    }

    parts() {
        const p = [this.edge, this.node];
        if (this.ctxNet) p.push(this.ctxNet);
        if (this.gru) p.push(this.gru);
        if (this.sched) p.push(this.sched);
        return p;
    }

    nParams() { return this.parts().reduce((a, p) => a + p.nParams(), 0); }

    _alloc(n) {
        const s = this.spec;
        const lags = s.lags | 0;
        this._n = n;
        this.h = new Float32Array(n * s.mem);
        this._msgX = new Float64Array(n); this._msgY = new Float64Array(n);
        this._infoSum = new Float32Array(n * s.info);
        this._infoMax = new Float32Array(n * s.info);
        this._maxU = new Float64Array(n);
        this._edgeIn = new Float32Array(s.edgeSizes[0]);
        this._nodeIn = new Float32Array(s.nodeSizes[0]);
        this._gruIn = new Float32Array(s.gruIn);
        this._ctx = new Float32Array(s.ctx);
        this._raster = new Float32Array(s.grid * s.grid);
        // Ring buffers, [lag slot][body]. Positions and velocities are the state
        // this model was shown; the message is the force it derived from it.
        this._hx = new Float64Array(lags * n); this._hy = new Float64Array(lags * n);
        this._hvx = new Float64Array(lags * n); this._hvy = new Float64Array(lags * n);
        this._hmx = new Float64Array(lags * n); this._hmy = new Float64Array(lags * n);
        this._head = 0;
        this._depth = 0;
        this._pCoef = new Float64Array(lags * n);
        this._qCoef = new Float64Array(lags * n);
    }

    /* Zero the memory and size the scratch. MUST be called at the start of every
     * rollout: a latent left over from the previous episode is a private channel
     * through which one system's state leaks into another's prediction, and the
     * GA will absolutely find and exploit that if it is left open. The lag
     * buffers are the same hazard with a much wider mouth — a leftover position
     * history is literally another system's trajectory — so `_depth` resets to
     * zero and every lag reads as "not available yet" until it is genuinely
     * refilled from this episode. */
    reset(n) {
        if (n !== this._n) this._alloc(n);
        else {
            if (this.h.length) this.h.fill(0);
            this._head = 0;
            this._depth = 0;
        }
        return this;
    }

    /* Slot holding the state `k` ticks ago (k = 1 is the previous tick). */
    _slot(k) {
        const lags = this.spec.lags | 0;
        return ((this._head - k) % lags + lags) % lags;
    }

    /* Record the tick just computed. Note what is stored: the state the model was
     * SHOWN and the force it ITSELF derived. At deployment there is no oracle
     * trajectory to look back at — a forward model rolling out autonomously has
     * only its own past output, so that is what it is trained on. Storing the
     * true past states here would train a model that cannot exist. */
    _push(st, n) {
        const lags = this.spec.lags | 0;
        if (!lags) return;
        const o = this._head * n;
        for (let i = 0; i < n; i++) {
            this._hx[o + i] = st.x[i]; this._hy[o + i] = st.y[i];
            this._hvx[o + i] = st.vx[i]; this._hvy[o + i] = st.vy[i];
            this._hmx[o + i] = this._msgX[i]; this._hmy[o + i] = this._msgY[i];
        }
        this._head = (this._head + 1) % lags;
        if (this._depth < lags) this._depth++;
    }

    /* Fill ax/ay with the model's effective acceleration for the POSITION update
     * and bx/by with the one for the VELOCITY update. When bx is omitted the two
     * are the same and this is the classical single-acceleration scheme. */
    accel(st, sys, ax, ay, bx, by) {
        const s = this.spec;
        const n = st.n;
        if (n !== this._n) this._alloc(n);
        const m = sys.m, ref = sys.ref;
        const L = ref.L, V = ref.V, A = ref.A, M = ref.M;
        const soft2 = (EDGE_SOFT * L) * (EDGE_SOFT * L);
        const dtn = dtFeature(sys);
        const nFrac = cl(n / 10, 0, 2);

        // ---- global context (the image) --------------------------------
        if (this.ctxNet) {
            buildRaster(st, m, sys, s.grid, this._raster);
            const c = this.ctxNet.forward(this._raster);
            for (let k = 0; k < s.ctx; k++) this._ctx[k] = c[k];
        }

        const ei = this._edgeIn, ni = this._nodeIn, gi = this._gruIn;
        const base = s.mode === "raw" ? 7 : 9;
        const lags = s.lags | 0;
        // Lag-1 slot for the edge features. Only one lag is offered per edge: the
        // edge loop is O(N²) and runs every round, so it is the one place where
        // an extra input has to earn its cost. One lag is enough for what the
        // edge needs to know — how far this particular pair moved during the last
        // step, which is exactly the quantity a step-size-aware correction to
        // this pair's contribution depends on.
        const pslot = (lags && this._depth > 0) ? this._slot(1) * n : -1;

        for (let round = 0; round < s.rounds; round++) {
            this._msgX.fill(0); this._msgY.fill(0);
            this._infoSum.fill(0);
            this._infoMax.fill(-1);
            this._maxU.fill(0);

            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    if (i === j) continue;
                    const dx = st.x[j] - st.x[i], dy = st.y[j] - st.y[i];
                    const r2 = dx * dx + dy * dy + soft2;
                    const r = Math.sqrt(r2);
                    const rhx = dx / r, rhy = dy / r;              // r̂, pointing i → j
                    const u = L / r;                                // inverse distance, in L units
                    const mf = m[j] / M;
                    const dvx = st.vx[j] - st.vx[i], dvy = st.vy[j] - st.vy[i];
                    const vr = (dvx * rhx + dvy * rhy) / V;
                    const vt = (-dvx * rhy + dvy * rhx) / V;

                    let k = 0;
                    ei[k++] = cl(mf, 0, 1) * 2 - 1;
                    ei[k++] = cl(Math.log10(mf + 1e-12) / 6, -1, 0.2);
                    ei[k++] = cl(r / L, 0, 6);
                    if (base === 9) {
                        ei[k++] = cl(u, 0, 8);
                        ei[k++] = cl(mf * u * u, -8, 8);                       // the Newtonian magnitude, served up
                        ei[k++] = cl(Math.log10(mf * u * u + 1e-14) / 7, -2, 2);
                    } else {
                        ei[k++] = cl(Math.log10(r / L + 1e-6) / 2, -3, 2);     // raw mode: no reciprocal offered
                    }
                    ei[k++] = cl(vr, -4, 4);
                    ei[k++] = cl(vt, -4, 4);
                    ei[k++] = dtn;
                    if (lags) {
                        // How the pair's separation vector changed over one tick:
                        // the cosine of the angle it swept, and the log of how
                        // much it stretched. Both rotation-invariant. Before the
                        // first tick there is no previous separation, so they
                        // read as "nothing moved" — the honest encoding of a
                        // history that does not exist yet.
                        if (pslot >= 0) {
                            const pdx = this._hx[pslot + j] - this._hx[pslot + i];
                            const pdy = this._hy[pslot + j] - this._hy[pslot + i];
                            const pr = Math.hypot(pdx, pdy) + 1e-15;
                            ei[k++] = cl((dx * pdx + dy * pdy) / (r * pr), -1, 1);
                            ei[k++] = cl(Math.log10(pr / r) * 4, -2, 2);
                        } else {
                            ei[k++] = 1; ei[k++] = 0;
                        }
                    }
                    if (s.mem) {
                        for (let q = 0; q < s.mem; q++) ei[k++] = this.h[i * s.mem + q];
                        for (let q = 0; q < s.mem; q++) ei[k++] = this.h[j * s.mem + q];
                    }
                    for (let q = 0; q < s.ctx; q++) ei[k++] = this._ctx[q];

                    const out = this.edge.forward(ei);

                    // Radial basis, in units of the reference acceleration. Clamped
                    // because a close pair makes m/r⁴ enormous and one such edge
                    // would otherwise dominate the whole system's message.
                    const K0 = cl(mf * u, -1e3, 1e3);
                    const K1 = cl(K0 * u, -1e3, 1e3);
                    const K2 = cl(K1 * u, -1e3, 1e3);
                    const K3 = cl(K2 * u, -1e3, 1e3);
                    const sr = COEF_SCALE * (out[0] * K0 + out[1] * K1 + out[2] * K2 + out[3] * K3);
                    const stg = COEF_SCALE * (out[4] * K0 + out[5] * K1 + out[6] * K2 + out[7] * K3);

                    // Forces ADD — this is a sum, and it is meant to grow with N.
                    this._msgX[i] += sr * rhx - stg * rhy;
                    this._msgY[i] += sr * rhy + stg * rhx;

                    for (let q = 0; q < s.info; q++) {
                        const v = out[2 * N_KERNEL + q];
                        this._infoSum[i * s.info + q] += v;
                        if (v > this._infoMax[i * s.info + q]) this._infoMax[i * s.info + q] = v;
                    }
                    if (u > this._maxU[i]) this._maxU[i] = u;
                }
            }

            // ---- memory update, once per round --------------------------
            if (this.gru) {
                const denom = Math.max(1, n - 1);
                for (let i = 0; i < n; i++) {
                    let k = this._fillSelf(gi, st, sys, i, denom, 0);
                    for (let q = 0; q < s.ctx; q++) gi[k++] = this._ctx[q];
                    this.gru.forward(gi, this.h.subarray(i * s.mem, (i + 1) * s.mem));
                }
            }
        }

        // ---- node correction, then out ---------------------------------
        const denom = Math.max(1, n - 1);
        for (let i = 0; i < n; i++) {
            const mx = this._msgX[i], my = this._msgY[i];
            const mm = Math.hypot(mx, my);
            let k = this._fillSelf(ni, st, sys, i, denom, 0);
            if (s.mem) for (let q = 0; q < s.mem; q++) ni[k++] = this.h[i * s.mem + q];
            for (let q = 0; q < s.ctx; q++) ni[k++] = this._ctx[q];

            const o = this.node.forward(ni);
            let cx = mx, cy = my;
            let ux = 0, uy = 0;
            if (mm > 0) {
                ux = mx / mm; uy = my / mm;
                const g = NODE_GAIN * mm;
                cx += g * (o[0] * ux - o[1] * uy);
                cy += g * (o[0] * uy + o[1] * ux);
                const sp = Math.hypot(st.vx[i], st.vy[i]);
                if (sp > 0) {
                    const wx = st.vx[i] / sp, wy = st.vy[i] / sp;
                    cx += g * (o[2] * wx - o[3] * wy);
                    cy += g * (o[2] * wy + o[3] * wx);
                }
            }

            /* ---- the multistep term ------------------------------------
             *
             * This is the whole reason the model remembers past ticks, and it is
             * worth being precise about why it can help at all. The state is
             * Markovian: given exact positions and velocities, history carries no
             * extra INFORMATION about the future. What it carries is a much
             * cheaper route to it. The harness allows one force evaluation per
             * tick, so a memoryless predictor is stuck with the accuracy of a
             * one-step method. Past force evaluations are what a LINEAR MULTISTEP
             * method spends to cancel the leading truncation term without paying
             * for another evaluation — Adams-Bashforth 3 is
             *
             *     a_eff = 23/12·aₙ − 16/12·aₙ₋₁ + 5/12·aₙ₋₂
             *
             * and the same trick is available here for free, because the model
             * already computed those past forces and merely has to keep them.
             *
             * The basis is DIFFERENCES from the current message, not the raw past
             * messages, and that choice is doing two jobs. Coefficients then sum
             * to one automatically, so every reachable scheme is consistent — a
             * combination that does not converge to the true force as dt → 0 is
             * not expressible, which removes a whole family of ways to score well
             * on short rollouts by being wrong in a self-cancelling way. And zero
             * means "ignore the history", so a fresh brain starts as the one-step
             * model and the search only pays for memory once it is buying
             * something. Every classical scheme is still reachable: AB3 above is
             * simply p₁ = −16/12, p₂ = 5/12.
             *
             * The coefficients come from the node network, so they are per-body
             * and conditioned on invariants — a body a tenth of the way around
             * its orbit per tick and one a thousandth of the way get different
             * schemes, which is correct and is not something a fixed AB rule can
             * do. */
            let dx = cx, dy = cy;       // position update
            let ex = cx, ey = cy;       // velocity update
            if (mm > 0) {
                // A velocity-specific correction, available even with no history.
                // The best effective acceleration for placing a body and the one
                // for setting its new velocity are different averages over the
                // step; see the note on stepVerlet in physics.js.
                const g = NODE_GAIN * mm;
                ex += g * (o[4] * ux - o[5] * uy);
                ey += g * (o[4] * uy + o[5] * ux);
            }
            if (lags && this._depth > 0) {
                let px = 0, py = 0, qx = 0, qy = 0;
                for (let L = 1; L <= this._depth; L++) {
                    const sl = this._slot(L) * n + i;
                    const bxk = this._hmx[sl] - mx, byk = this._hmy[sl] - my;
                    // Base scheme (evolved directly, shared by every body) plus a
                    // per-body adjustment from the node network. Zero base is the
                    // one-step model; AB3 is base ≈ (-5/6, 1/4) on the position
                    // coefficients, which the search can now reach on its own.
                    const p = MULTI_SCALE * (this.sched.coef(L - 1) + NODE_ADJ * o[6 + (L - 1)]);
                    const q = MULTI_SCALE * (this.sched.coef(lags + L - 1) + NODE_ADJ * o[6 + lags + (L - 1)]);
                    px += p * bxk; py += p * byk;
                    qx += q * bxk; qy += q * byk;
                    // Diagnostic only — probe.js reads the scheme back out of a
                    // trained brain. Off by default so training pays nothing.
                    if (this.trace) { this._pCoef[i * lags + L - 1] = p; this._qCoef[i * lags + L - 1] = q; }
                }
                // Bound each correction by MULTI_CAP·|msg|. Direction is kept —
                // scaling the vector rather than clipping components would
                // otherwise rotate the correction whenever it saturated.
                const lim = MULTI_CAP * mm;
                const pn = Math.hypot(px, py);
                if (pn > lim && pn > 0) { const f = lim / pn; px *= f; py *= f; }
                const qn = Math.hypot(qx, qy);
                if (qn > lim && qn > 0) { const f = lim / qn; qx *= f; qy *= f; }
                dx += px; dy += py;
                ex += qx; ey += qy;
            }

            ax[i] = A * dx;
            ay[i] = A * dy;
            if (bx) { bx[i] = A * ex; by[i] = A * ey; }
        }

        // Remember this tick for the next one. Deliberately AFTER the node pass,
        // so the stored message is the force evaluated at this state — the
        // quantity a multistep method is defined over — and not a value already
        // containing a multistep correction, which would compound into a
        // feedback loop rather than a scheme.
        this._push(st, n);
    }

    /* The invariant description of body i: identical prefix for the node network
     * and the memory cell, so the two always agree about what they are looking
     * at. Returns the write cursor. */
    _fillSelf(buf, st, sys, i, denom, k) {
        const s = this.spec, ref = sys.ref;
        const L = ref.L, V = ref.V, M = ref.M;
        const mf = sys.m[i] / M;
        const r = Math.hypot(st.x[i], st.y[i]) + 1e-12;
        const rhx = st.x[i] / r, rhy = st.y[i] / r;
        const mm = Math.hypot(this._msgX[i], this._msgY[i]);
        buf[k++] = cl(mf, 0, 1) * 2 - 1;
        buf[k++] = cl(Math.log10(mf + 1e-12) / 6, -1, 0.2);
        buf[k++] = cl(r / L, 0, 6);
        buf[k++] = cl((st.vx[i] * rhx + st.vy[i] * rhy) / V, -4, 4);
        buf[k++] = cl((-st.vx[i] * rhy + st.vy[i] * rhx) / V, -4, 4);
        buf[k++] = cl(mm, 0, 8);
        buf[k++] = cl(Math.log10(mm + 1e-14) / 7, -2, 2);
        buf[k++] = cl(this._maxU[i], 0, 8);
        buf[k++] = cl(st.n / 10, 0, 2);
        buf[k++] = dtFeature(sys);
        /* The history, described in ROTATION-INVARIANT terms.
         *
         * This is where the flat "last x, last y" layout would have gone, and it
         * is the one part of that idea worth changing. Raw past coordinates are
         * not invariant: rotate the system and every one of them changes, so the
         * network would have to learn from data that physics does not care which
         * way north is — a symmetry this architecture otherwise has exactly and
         * for free. The same information, expressed as angles turned and lengths
         * scaled, is invariant by construction. The DIRECTION that the history
         * carries has not been thrown away; it re-enters as the basis vectors in
         * the multistep term above, where it rotates with the system as it
         * should.
         *
         * What the network reads per lag: how far the force has turned since then
         * (cos and the signed sin), how much it has grown, and how far the
         * velocity has turned. Together those say how sharply this body's
         * trajectory is bending per tick, which is exactly what decides how large
         * a multistep correction it needs. */
        const lags = s.lags | 0;
        if (lags) {
            const mx = this._msgX[i], my = this._msgY[i];
            const mmag = Math.hypot(mx, my) + 1e-30;
            const vx = st.vx[i], vy = st.vy[i];
            const vmag = Math.hypot(vx, vy) + 1e-30;
            for (let L = 1; L <= lags; L++) {
                if (L <= this._depth) {
                    const sl = this._slot(L) * this._n + i;
                    const hx = this._hmx[sl], hy = this._hmy[sl];
                    const hmag = Math.hypot(hx, hy) + 1e-30;
                    buf[k++] = cl((mx * hx + my * hy) / (mmag * hmag), -1, 1);
                    buf[k++] = cl((mx * hy - my * hx) / (mmag * hmag), -1, 1);
                    buf[k++] = cl(Math.log10(hmag / mmag) * 2, -2, 2);
                    const wx = this._hvx[sl], wy = this._hvy[sl];
                    const wmag = Math.hypot(wx, wy) + 1e-30;
                    buf[k++] = cl((vx * wy - vy * wx) / (vmag * wmag) * 8, -2, 2);
                } else {
                    // Not yet available. "Unchanged since then" is the reading
                    // that makes the multistep difference for this lag exactly
                    // zero, so a rollout's first few ticks degrade gracefully to
                    // the one-step model instead of reading garbage.
                    buf[k++] = 1; buf[k++] = 0; buf[k++] = 0; buf[k++] = 0;
                }
            }
            buf[k++] = cl(this._depth / Math.max(1, lags), 0, 1) * 2 - 1;
        }
        // Descriptions AVERAGE (and max-pool). A sum here would scale with the
        // body count and saturate the moment the model met a bigger system than
        // it was trained on — which is precisely the generalisation the whole
        // architecture exists to get right.
        for (let q = 0; q < s.info; q++) buf[k++] = this._infoSum[i * s.info + q] / denom;
        for (let q = 0; q < s.info; q++) buf[k++] = this._infoMax[i * s.info + q];
        return k;
    }

    clone() {
        const p = Object.create(Predictor.prototype);
        p.spec = this.spec;
        p.edge = this.edge.clone();
        p.node = this.node.clone();
        p.ctxNet = this.ctxNet ? this.ctxNet.clone() : null;
        p.gru = this.gru ? this.gru.clone() : null;
        p.sched = this.sched ? this.sched.clone() : null;
        p._alloc(0);
        return p;
    }

    mutate(rate, sigma, rng) {
        for (const p of this.parts()) p.mutate(rate, sigma, rng);
        return this;
    }

    calibrateScales() {
        for (const p of this.parts()) p.calibrateScales();
        return this;
    }

    static crossover(a, b, rng) {
        const c = a.clone();
        WeightBag.mix(c.edge, b.edge, rng);
        WeightBag.mix(c.node, b.node, rng);
        if (c.ctxNet && b.ctxNet) WeightBag.mix(c.ctxNet, b.ctxNet, rng);
        if (c.gru && b.gru) WeightBag.mix(c.gru, b.gru, rng);
        if (c.sched && b.sched) WeightBag.mix(c.sched, b.sched, rng);
        return c;
    }

    toJSON() {
        return {
            format: "planet-predictor-v1",
            spec: this.spec,
            edge: this.edge.toJSON(),
            node: this.node.toJSON(),
            ctxNet: this.ctxNet ? this.ctxNet.toJSON() : null,
            gru: this.gru ? this.gru.toJSON() : null,
            sched: this.sched ? this.sched.toJSON() : null
        };
    }

    static fromJSON(o) {
        const p = Object.create(Predictor.prototype);
        p.spec = o.spec;
        p.edge = Net.fromJSON(o.edge);
        p.node = Net.fromJSON(o.node);
        p.ctxNet = o.ctxNet ? Net.fromJSON(o.ctxNet) : null;
        p.gru = o.gru ? GRUCell.fromJSON(o.gru) : null;
        p.sched = o.sched ? Schedule.fromJSON(o.sched) : null;
        p._alloc(0);
        return p;
    }

    /* Write a classical scheme into a brain's schedule, in the difference basis
     * the genome stores. Used by `--schedinit ab3` and by the test that proves
     * Adams-Bashforth is representable at all — the same code path, so the test
     * is testing the thing the trainer actually uses.
     *
     * Coefficients are pushed just inside the tanh's usable range rather than
     * inverted exactly: atanh saturates, and a coefficient parked at ±MULTI_SCALE
     * would sit on a gradient-free shelf that mutation could never move it off. */
    static setSchedule(pred, order) {
        if (!pred.sched) return pred;
        const lags = pred.spec.lags | 0;
        const P = ADAMS_P[order - 1] || [], Q = ADAMS_Q[order - 1] || [];
        const w = pred.sched.weights[0];
        const put = (k, v) => {
            const t = Math.max(-0.999, Math.min(0.999, v / MULTI_SCALE));
            w[k] = Math.atanh(t);
        };
        for (let k = 0; k < lags; k++) { put(k, P[k] || 0); put(lags + k, Q[k] || 0); }
        return pred;
    }

    /* ------------------------------------------------------------- the graft
     *
     * Rebuild a genome trained at one `lags` setting into the currently
     * configured one, PRESERVING EVERY PREDICTION IT MAKES ON ITS FIRST TICK.
     *
     * This exists because of a measured result. Turning the history on from
     * scratch is worse than leaving it off (`lags 4` finished behind `lags 0`
     * over eight paired reps), and watching the schedule evolve says why: at
     * generation 150 the model still scored *below plain Newton*, so its stored
     * past "force evaluations" were wrong, and combining several wrong forces
     * compounds the error rather than cancelling truncation. The search
     * correctly responded by driving the coefficients AWAY from Adams-Bashforth.
     * A multistep scheme is worth +0.78 digits when it combines exact forces and
     * nothing at all when it combines bad ones — so the force law has to be
     * learned first and the history added afterwards.
     *
     * Every new input is a ZERO COLUMN and every new output a ZERO ROW, so the
     * grafted brain is the old brain exactly — the history reads as "nothing has
     * changed since then", the multistep differences are zero, and the velocity
     * split is off. Evolution then starts from a working force law with the new
     * machinery available but idle, which is the only state from which the extra
     * parameters can be judged on what they add. The invariant is asserted in
     * test_headless.js: graft a brain, compare against the original tick for
     * tick, require bit-level agreement.
     *
     * The layout knowledge lives here rather than in the trainer because it is
     * the same knowledge as `_fillSelf`: the history block sits after the ten
     * base self-invariants and before the info channels, and the edge lag pair
     * sits after `dtn` and before the memory. Split those two apart and they
     * will drift. */
    static graft(oldJSON) {
        const oldSpec = oldJSON.spec || {};
        const oldLags = oldSpec.lags | 0, newLags = SPEC.lags | 0;
        const info = MODEL_CFG.info, mem = SPEC.mem, ctx = SPEC.ctx;
        const fresh = new Predictor(mulberry32(12345));

        // Where the new columns go, and how many, for each network.
        const edgeAt = (MODEL_CFG.mode === "raw" ? 7 : 9) + (oldLags ? 2 : 0);
        const edgeAdd = (newLags ? 2 : 0) - (oldLags ? 2 : 0);
        const selfAt = 10 + (oldLags ? HIST_PER_LAG * oldLags + 1 : 0);
        const selfAdd = (newLags ? HIST_PER_LAG * newLags + 1 : 0) -
            (oldLags ? HIST_PER_LAG * oldLags + 1 : 0);

        /* Copy a first-layer matrix, inserting `add` zero columns at `at`.
         * Rows are unchanged, so every hidden unit keeps its identity and every
         * weight keeps the input it was trained on. */
        const spliceIn = (src, dst, at, add) => {
            const rowsN = dst.rows[0], oldCols = src.cols[0], newCols = dst.cols[0];
            if (newCols !== oldCols + add) throw new Error(`graft width ${oldCols}+${add} ≠ ${newCols}`);
            const a = src.weights[0], b = dst.weights[0];
            b.fill(0);
            for (let r = 0; r < rowsN; r++) {
                for (let c = 0; c < at; c++) b[r * (newCols + 1) + c] = a[r * (oldCols + 1) + c];
                for (let c = at; c < oldCols; c++) b[r * (newCols + 1) + c + add] = a[r * (oldCols + 1) + c];
                b[r * (newCols + 1) + newCols] = a[r * (oldCols + 1) + oldCols];   // bias
            }
        };
        // Copy a matrix whose shape is unchanged.
        const copyExact = (src, dst, l) => { dst.weights[l].set(src.weights[l]); };
        /* Copy an output matrix, keeping the first `src.rows` rows and leaving
         * any additional ones at zero. tanh(0) = 0, so a new output contributes
         * nothing until the search gives it a reason to. */
        const copyRows = (src, dst, l) => {
            const w = dst.weights[l];
            w.fill(0);
            w.set(src.weights[l].subarray(0, Math.min(src.weights[l].length, w.length)));
        };

        const oldEdge = Net.fromJSON(oldJSON.edge);
        const oldNode = Net.fromJSON(oldJSON.node);
        spliceIn(oldEdge, fresh.edge, edgeAt, edgeAdd);
        for (let l = 1; l < fresh.edge.weights.length; l++) copyExact(oldEdge, fresh.edge, l);
        spliceIn(oldNode, fresh.node, selfAt, selfAdd);
        for (let l = 1; l < fresh.node.weights.length - 1; l++) copyExact(oldNode, fresh.node, l);
        copyRows(oldNode, fresh.node, fresh.node.weights.length - 1);

        if (fresh.gru && oldJSON.gru) {
            const oldGru = GRUCell.fromJSON(oldJSON.gru);
            for (let l = 0; l < fresh.gru.weights.length; l++) {
                spliceIn({ weights: [oldGru.weights[l]], rows: [oldGru.rows[l]], cols: [oldGru.cols[l]] },
                    { weights: [fresh.gru.weights[l]], rows: [fresh.gru.rows[l]], cols: [fresh.gru.cols[l]] },
                    selfAt, selfAdd);
            }
        }
        if (fresh.ctxNet && oldJSON.ctxNet) {
            const oldCtx = Net.fromJSON(oldJSON.ctxNet);
            for (let l = 0; l < fresh.ctxNet.weights.length; l++) copyExact(oldCtx, fresh.ctxNet, l);
        }
        // The schedule starts at zero — the one-step method — so the grafted
        // brain IS the old brain and the history has to earn its place.
        if (fresh.sched) fresh.sched.weights[0].fill(0);
        if (fresh.sched && MODEL_CFG.schedInit === "ab3") Predictor.setSchedule(fresh, 3);

        fresh.calibrateScales();
        void info; void mem; void ctx;
        return fresh;
    }

    /* Does a stored genome match the widths this process is configured for?
     * Loading a mismatched brain silently produces garbage predictions that look
     * like a training failure, so every load path checks. */
    static specMatches(spec) {
        return spec && spec.edgeSizes && spec.edgeSizes[0] === SPEC.edgeSizes[0] &&
            spec.nodeSizes[0] === SPEC.nodeSizes[0] &&
            spec.nodeSizes[spec.nodeSizes.length - 1] === SPEC.nodeSizes[SPEC.nodeSizes.length - 1] &&
            (spec.mem | 0) === (SPEC.mem | 0) &&
            (spec.lags | 0) === (SPEC.lags | 0) &&
            spec.edgeSizes[spec.edgeSizes.length - 1] === SPEC.edgeSizes[SPEC.edgeSizes.length - 1];
    }
}

/* ------------------------------------------------------------- baselines */

/* Exact Newton, evaluated once per tick — the honest competitor. It runs
 * through the same one-evaluation Verlet update as every brain, so any
 * difference in score is a difference in the FORCE, not in the integrator. */
function newtonAccelFn(st, sys, ax, ay) { sys.newtonAccelInto(st, ax, ay); }

/* No forces at all: straight lines. The floor. Also exactly what an untrained
 * brain does, which makes "did generation 1 learn anything" a one-line check. */
function zeroAccelFn(st, sys, ax, ay) { ax.fill(0); ay.fill(0); }

/* Exact Newtonian forces, combined across the last few evaluations by the
 * classical Adams-Bashforth coefficients — the honest competitor once the
 * harness allows a predictor to remember.
 *
 * THIS IS THE BAR, not plain Newton. A one-evaluation-per-tick budget does not
 * oblige anyone to use a one-step method: keeping the previous force
 * evaluations and extrapolating them is standard numerical analysis, it is what
 * a competent implementer would write, and it costs nothing extra. Measured
 * here it is worth about +0.78 digits over one-step Newton and it beats eight
 * Newton substeps — so a learned model scored only against plain Newton would
 * be taking credit for a textbook result. The model has to beat THIS to have
 * found anything.
 *
 * The coefficients are derived rather than looked up, because the position and
 * velocity updates need DIFFERENT ones and only the velocity set is what a
 * table calls Adams-Bashforth. Writing a(t_n + s) as its backward-difference
 * expansion in τ = s/dt and integrating over the step:
 *
 *   velocity  ∫₀¹ a dτ         = a_n + ∇a_n/2 + 5∇²a_n/12     ← AB2 / AB3
 *   position  2∫₀¹ (1−τ) a dτ  = a_n + ∇a_n/3 +  ∇²a_n/4
 *
 * with ∇a_n = a_n − a_{n−1}. Expressed below in the same difference basis the
 * network emits, so probe.js can print a trained brain's coefficients directly
 * against these. */
const ADAMS_P = [[], [-1 / 3], [-5 / 6, 1 / 4]];          // position update
const ADAMS_Q = [[], [-1 / 2], [-16 / 12, 5 / 12]];       // velocity update

function makeAdamsFn(order) {
    const P = ADAMS_P[order - 1], Q = ADAMS_Q[order - 1];
    const keep = Math.max(0, order - 1);
    return function (st, sys, ax, ay, bx, by, s) {
        const n = st.n;
        if (!s.raw || s.raw.ax.length !== n) {
            s.raw = { ax: new Float64Array(n), ay: new Float64Array(n) };
            s.hist = Array.from({ length: keep }, () => ({ ax: new Float64Array(n), ay: new Float64Array(n) }));
            s.head = 0; s.depth = 0;
        }
        sys.newtonAccelInto(st, s.raw.ax, s.raw.ay);
        for (let i = 0; i < n; i++) {
            let px = s.raw.ax[i], py = s.raw.ay[i], qx = px, qy = py;
            for (let k = 1; k <= Math.min(s.depth, keep); k++) {
                const h = s.hist[((s.head - k) % keep + keep) % keep];
                const dx = h.ax[i] - s.raw.ax[i], dy = h.ay[i] - s.raw.ay[i];
                px += P[k - 1] * dx; py += P[k - 1] * dy;
                qx += Q[k - 1] * dx; qy += Q[k - 1] * dy;
            }
            ax[i] = px; ay[i] = py;
            if (bx) { bx[i] = qx; by[i] = qy; }
        }
        if (keep) {
            s.hist[s.head].ax.set(s.raw.ax); s.hist[s.head].ay.set(s.raw.ay);
            s.head = (s.head + 1) % keep;
            if (s.depth < keep) s.depth++;
        }
    };
}

/* Newton with `sub` LEAPFROG SUBSTEPS per tick — deliberately spends far more
 * compute than anyone else is allowed. Note that each kick-drift-kick substep
 * evaluates the force twice, so `sub = 8` costs about sixteen force
 * evaluations per tick against everyone else's one; the label "Newton×8" refers
 * to the substeps, not the evaluations.
 *
 * This is not a competitor, it is a ruler. It shows how much of coarse Newton's
 * error is the timestep rather than the force law, and therefore how much room
 * a smarter effective force could possibly claim. */
function makeNewtonSubFn(sub) {
    return function (st, sys, ax, ay, scratch) {
        const tmp = scratch.tmp || (scratch.tmp = st.clone());
        tmp.copyFrom(st);
        const h = sys.dt / sub;
        for (let s = 0; s < sub; s++) leapfrogKDK(tmp, sys.m, h, ax, ay);
        // Report the constant acceleration that would have produced this
        // substepped outcome, so it plugs into the same Verlet harness.
        const inv = 2 / (sys.dt * sys.dt);
        for (let i = 0; i < st.n; i++) {
            ax[i] = inv * (tmp.x[i] - st.x[i] - st.vx[i] * sys.dt);
            ay[i] = inv * (tmp.y[i] - st.y[i] - st.vy[i] * sys.dt);
        }
    };
}

if (typeof module !== "undefined") {
    module.exports = {
        // SPEC is rebuilt by refreshSpec(), so it must be exported as a getter —
        // a by-value export would freeze requiring code at the widths that
        // happened to be current when this file was first loaded.
        MODEL_CFG, getSpec: () => SPEC, setModelCfg, refreshSpec, specLabel, Predictor,
        buildRaster, anchorIndex, newtonAccelFn, zeroAccelFn, makeNewtonSubFn,
        makeAdamsFn, ADAMS_P, ADAMS_Q,
        setOutScales, getOutScales, dtFeature, N_KERNEL, COEF_SCALE, NODE_GAIN,
        MULTI_SCALE, MULTI_CAP, HIST_PER_LAG, Schedule, SCHED_STEP, NODE_ADJ
    };
}
