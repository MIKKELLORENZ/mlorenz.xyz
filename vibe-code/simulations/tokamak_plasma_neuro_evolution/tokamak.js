/* tokamak.js — the plasma, the circuits, the sensors. One instance = one
 * virtual discharge.
 *
 * WHAT THIS IS
 * ------------
 * A deliberately crude, fast, readable stand-in for magnetic control of a
 * tokamak plasma. It reproduces exactly two things faithfully enough to make
 * the control problem real:
 *
 *   1. EVERY COIL TALKS TO EVERY SENSOR. There is no clean pairing of actuator
 *      to objective. Move one coil to fix the radial position and you have
 *      changed the elongation, the vertical force and half the flux loops.
 *
 *   2. THE TIMESCALE SPLIT. Eighteen coils with 25-100 ms L/R sit alongside one
 *      in-vessel coil at 0.3 ms, because the instability that coil fights grows
 *      on the millisecond timescale, and the slow coils physically cannot.
 *
 * Everything else is a simplification, and PHYSICS.md lists them all. The two
 * biggest: there is no Grad-Shafranov solve anywhere (the plasma is a rigid
 * ensemble of current filaments whose shape is slaved to the applied field),
 * and there is no transport, no heating, no fuelling and no fusion.
 */
"use strict";

/* ------------------------------------------------------------ plasma model */
const PLASMA = {
    NF: 7,                 // current filaments: 1 core + 6 on an inner contour
    li: 0.9,               // internal inductance — held constant (no current diffusion)
    betaP: 0.30,           // poloidal beta — held constant (no transport, no heating)
    IpRef: 150e3,          // reference current the minor radius is scaled against
    aMax: 0.235,           // largest minor radius the vessel will accept
    aMin: 0.055,           // below this the plasma is squashed against the wall → disruption
    // Plasma resistance. τ = L_p/R_p ≈ 1.2 s, the low end of what a hot,
    // fully-ionised discharge manages. It matters more than it looks: I_p decay
    // shrinks the hoop force, which walks the plasma inward, so the ohmic loop
    // is not optional even in a task that only asks you to hold still.
    Rp0: 1.8e-6,
    // Inertia and drag are numerical devices, not physics. They are chosen small
    // enough that the plasma reaches force balance in ~0.2 ms — far faster than
    // the 6 ms vessel time constant — so that the VESSEL, not this drag, is what
    // sets the vertical growth rate. test_headless.js checks that claim by
    // deleting the wall and watching the growth rate jump.
    mass: 5.0e-3,          // kg (effective)
    drag: 30.0,            // N·s/m
    tauShape: 1.2e-3,      // s — how fast κ and δ chase the applied field
    kappaGain: 0.95,       // κ_eq = 1 + kappaGain · max(0, −n)
    kappaMax: 2.45,
    deltaGain: 0.055,      // δ_eq from the curvature of B_z
    deltaMax: 0.65
};

/* How strongly a RIGID vertical displacement of the plasma induces current in
 * the external circuits. 1.0 is the honest rigid-filament answer; anything less
 * is an admission that the rigid filament is the wrong model.
 *
 * It is the wrong model, and this is the single most consequential fudge in the
 * simulator. A rigid current ring displaced inside a set of low-resistance
 * conductors induces enormous opposing currents — in this geometry the shaping
 * coils alone hold the vertical mode with ~250× the stiffness of the
 * instability driving it, and the plasma sits there for ten seconds. Real
 * elongated tokamaks are only MARGINALLY wall-stabilised, with growth times of
 * a few milliseconds, because the real unstable mode is not a rigid shift: the
 * plasma deforms as it moves, and a deforming plasma couples to distant
 * conductors far more weakly than a rigid one. Rigid-displacement models are
 * known to over-estimate passive stabilisation for exactly this reason.
 *
 * The vessel needs no correction: WALL_SCREEN is 1.0, the honest rigid answer.
 * It is the shaping coils that have to be screened, and there is a physical
 * reason as well as a modelling one — the vessel sits between them and the
 * plasma, so it shields them from anything fast. With COIL_SCREEN at 0.01 the
 * calibration (test_headless.js `physics`) comes out at:
 *     elongated plasma, wall present   γ⁻¹ ≈ 6 ms     ← catchable at 10 kHz
 *     elongated plasma, wall removed   γ⁻¹ ≈ 0.6 ms   ← not catchable
 * i.e. the conducting wall buys a factor of ten, and that factor is the only
 * reason a controller exists for this problem at all. */
const COIL_SCREEN = 0.010;
const WALL_SCREEN = 1.0;

const CTRL_HZ = 10000;             // 10 kHz control loop, as specified
const DT_CTRL = 1 / CTRL_HZ;
const SUBSTEPS = 2;                // physics substeps per control tick (50 µs)
const DT_SUB = DT_CTRL / SUBSTEPS;

/* Slew-rate limits live INSIDE the environment, so the agent may command a
 * step change and simply not get one. Real supplies behave this way and it
 * removes an entire class of unlearnable pathology from the action space. */
const SLEW_SHAPE = 3.0e6;          // V/s
const SLEW_FAST = 4.0e6;           // V/s

/* --------------------------------------------------------- sensor scaling */
/* Every block is normalised independently to roughly unit variance. These are
 * the scaling constants; they are LOGGED (Tokamak.NORM) because a mismatch
 * between the constants used at training time and at evaluation time is the
 * most common silent failure in this kind of setup. */
const NORM = {
    flux: 0.15,        // Wb
    probe: 0.045,      // T
    coilI: 5000,       // A
    fastI: 500,        // A
    ohmDiff: 3000,     // A
    ip: 100e3,         // A  (encoded as Ip/ip − 1)
    tgtR: 0.25, tgtZ: 0.50, tgtK: 0.5
};

/* -------------------------------------------------------- interface modes */
/* `full` is the contract from the specification: 149 inputs, 19 outputs.
 * `trim` is the cut-down version — enough to learn vertical stabilisation,
 * nowhere near enough for shape control — kept because it trains ~5× faster
 * and makes a very clear demo of the one thing the fast coil is for. */
/* TEMPORAL FEATURES — the reason the first three training runs plateaued far
 * below the PID baseline.
 *
 * The original 149-neuron contract is MEMORYLESS. It carries the field now, the
 * coil currents now, and the previous action; it does not carry a single
 * quantity with a time derivative in it. A controller reading that vector
 * cannot tell a plasma sitting 5 mm high and still from one sitting 5 mm high
 * and falling at 8 m/s — and on a vertically unstable plasma those two states
 * need opposite commands. The PID baseline has dz/dt and three integrators; the
 * network had nothing, and no amount of evolution fixes an observation that
 * does not contain the answer.
 *
 * So the observation grows a second block of seventy neurons. Every one of them
 * is something a real tokamak control system computes in real time from signals
 * it already digitises — no ground truth, no privileged state:
 *
 *   A (8)   the magnetic observer's own output — estimated Ẑ, R̂, the three
 *           tracking errors, and one-step rates. This is the SAME linear
 *           observer the PID uses, shared code, fitted from machine geometry
 *           alone. Real machines run exactly this inside the control cycle.
 *   B (17)  multi-lag differences of Ẑ, R̂ and I_p at 0.1 → 6.4 ms. One
 *           derivative is a differentiator with one noise bandwidth; a ladder
 *           of lags lets the network pick its own filter for each timescale in
 *           the plant — 0.5 ms fast coil, ~2 ms vessel, ~7 ms instability.
 *   C (3)   leaky integrals of the three errors: steady-state offset rejection,
 *           the one thing proportional control provably cannot do.
 *   D (4)   fast-coil current, its rate, and the mean of the last 8 and 32
 *           commands to it — how hard the stabiliser is already working.
 *   E (38)  the probe array differenced against 0.8 ms ago. This is the block
 *           that can beat the PID rather than match it: the vessel eddy
 *           currents are the hidden state that screens every coil, nothing
 *           measures them, and the PID cannot subtract them. Their signature is
 *           precisely a field pattern that is changing when the coil currents
 *           are not, so it lives in dB/dt. Give the network the raw material
 *           and let selection find the estimator.
 */
const HIST_LAGS = [1, 2, 4, 8, 16, 32, 64];
const IP_LAGS = [4, 16, 64];
const HIST_LEN = 65;               // ring longer than the longest lag
const PROBE_LAG = 8;               // 0.8 ms — the vessel's own timescale
const PROBE_HIST_LEN = PROBE_LAG + 1;
const N_TEMPORAL = 8 + 2 * HIST_LAGS.length + IP_LAGS.length + 3 + 4 + N_PROBE;

const MODES = {
    full: {
        label: "full · 219 → 19",
        obs: 149 + N_TEMPORAL, act: 19,
        actIdx: null,           // all circuits
        trimProbes: null, trimFlux: null, trimCoils: null
    },
    trim: {
        label: "trimmed · 31 → 5",
        obs: 31, act: 5,
        actIdx: [18, 0, 3, 4, 7],                        // G + four outer shaping coils
        trimProbes: [2, 7, 11, 16, 21, 26, 30, 35],
        trimFlux: [1, 5, 9, 13, 18, 22, 26, 30],
        trimCoils: [0, 3, 4, 7]
    }
};
let OBS_MODE = "full";
function setObsMode(m) { OBS_MODE = MODES[m] ? m : "full"; return MODES[OBS_MODE]; }
function modeSpec() { return MODES[OBS_MODE]; }

/* Network shape. Two small hidden layers: the mapping from noisy magnetics to
 * nineteen voltages is not deep, it is just badly conditioned. The hidden
 * layers grew with the temporal block — 48 units was already a tight fit for
 * ninety-three sensors, and the first layer now has to hold both a linear
 * observer and a set of differentiators. */
let NET_SIZES = [MODES.full.obs, 64, 48, 19];
function refreshNetSizes() {
    const s = modeSpec();
    NET_SIZES = [s.obs, s.act === 19 ? 64 : 24, s.act === 19 ? 48 : 16, s.act];
    return NET_SIZES;
}

/* ------------------------------------------------ domain randomisation */
/* One config block, as specified. A policy that survives all of this has some
 * claim to robustness; a policy that only survives the nominal machine has
 * memorised one particular set of time constants. */
const RANDOMISE = {
    enabled: true,
    plasmaRes: [0.6, 1.8],      // × nominal plasma resistivity
    vesselTau: [0.7, 1.4],      // × nominal 6 ms wall time constant
    coilGain: [0.9, 1.1],       // per-circuit voltage gain error
    coilTau: [0.85, 1.2],       // × nominal L/R per circuit
    fluxNoise: [0.5, 2.0],      // × nominal flux-loop noise
    probeNoise: [0.5, 2.0],
    ipNoise: [0.5, 2.0],
    betaP: [0.15, 0.55]
};
const NOISE_BASE = { flux: 1.2e-3, probe: 4.0e-4, coilI: 12.0, ip: 900 };

/* ------------------------------------------------------ difficulty ladder */
/* A controller that has mastered the nominal machine is not finished; it has
 * run out of things to learn from THIS machine. The ladder makes the physics
 * progressively nastier, and the trainer climbs it whenever the champion is
 * comfortable — but only ever ADDS a rung, never removes one, and every
 * generation keeps training on the rungs below (see episodePlan). Catastrophic
 * forgetting is the obvious failure mode of any curriculum that escalates, and
 * the defence is to keep the old distribution in the mix rather than to hope.
 *
 * Each knob is a real physical quantity, not a score multiplier:
 *
 *   kappaGain  amplifies each task's elongation ABOVE ROUND: κ → 1 + (κ−1)(1+g).
 *              Elongation is the instability driver, so this is the difficulty
 *              axis that matters most. Proportional rather than additive so the
 *              circular control group stays circular — adding a flat 0.4 to
 *              κ = 1.05 would quietly delete the one stable task in the set.
 *   wall       scales the vessel time constant DOWN. The conducting wall is the
 *              only reason the instability is catchable at 10 kHz at all; at
 *              wall = 0.5 the growth time roughly halves and the fast coil has
 *              half as many samples to work with. This is the cruellest knob.
 *   kick       the error in the starting coil currents — how far the plasma has
 *              already moved before the controller takes its first sample.
 *   noise      sensor noise, on every probe, flux loop and Rogowski.
 *   spread     widens the whole domain-randomisation box about its midpoint:
 *              more machine-to-machine variation to be robust to.
 */
/* The rungs are GENTLE, and deliberately so. The first draft went straight from
 * κ = 1.75 to κ = 1.86 with a 15% shorter wall, 50% more starting error and 40%
 * more noise all at once, and the PID baseline's boundary error went from
 * 4.65 cm to 12.40 cm on that single step. A ladder whose first rung triples
 * the difficulty is not a curriculum, it is a cliff: the ratchet stalls on rung
 * one and the other four never get used. Six small steps beat four big ones. */
const DIFFICULTY = [
    { label: "nominal", kappaGain: 0.00, wall: 1.00, kick: 1.00, noise: 1.00, spread: 1.00 },
    { label: "brisk",   kappaGain: 0.06, wall: 0.94, kick: 1.15, noise: 1.10, spread: 1.10 },
    { label: "stiff",   kappaGain: 0.13, wall: 0.88, kick: 1.35, noise: 1.25, spread: 1.20 },
    { label: "hostile", kappaGain: 0.21, wall: 0.80, kick: 1.60, noise: 1.45, spread: 1.35 },
    { label: "brutal",  kappaGain: 0.30, wall: 0.72, kick: 1.90, noise: 1.70, spread: 1.50 },
    { label: "savage",  kappaGain: 0.40, wall: 0.64, kick: 2.20, noise: 2.00, spread: 1.70 }
];
const N_LEVELS = DIFFICULTY.length;
function difficultyOf(level) {
    return DIFFICULTY[level < 0 ? 0 : level >= N_LEVELS ? N_LEVELS - 1 : level | 0];
}
/* Widen a randomisation interval about its midpoint, keeping it positive. */
function spreadRange(r, s) {
    if (s === 1) return r;
    const mid = 0.5 * (r[0] + r[1]);
    return [Math.max(0.05, mid - (mid - r[0]) * s), mid + (r[1] - mid) * s];
}

/* ---------------------------------------------------------------- helpers */
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

/* 16 (R, Z) points on a boundary described the Miller way. Used both for the
 * plasma's own last closed flux surface and for the target the controller is
 * asked to hit — same parameterisation on both sides, so the boundary error is
 * a like-for-like comparison. */
const N_BND = 16;
function boundaryPoints(R, Z, a, kappa, delta, out) {
    const o = out || new Float64Array(N_BND * 2);
    const dl = Math.asin(clamp(delta, -0.99, 0.99));
    for (let i = 0; i < N_BND; i++) {
        const th = (i / N_BND) * 2 * Math.PI;
        o[i * 2] = R + a * Math.cos(th + dl * Math.sin(th));
        o[i * 2 + 1] = Z + kappa * a * Math.sin(th);
    }
    return o;
}

function matvec(A, x, y, n) {
    for (let i = 0; i < n; i++) {
        let s = 0;
        const b = i * n;
        for (let j = 0; j < n; j++) s += A[b + j] * x[j];
        y[i] = s;
    }
}

/* ====================================================== magnetic observer ===
 * Estimate where the plasma is from the magnetics alone. This used to live in
 * pid.js; it moved here because the NETWORK now reads it too, and the one thing
 * that must not happen is the baseline and the learned controller running two
 * observers that disagree. One implementation, one fit, both callers.
 *
 * It is not a favour to the agent. Every tokamak in the world runs a real-time
 * linear magnetic reconstruction of this kind inside the control cycle; giving
 * a controller its output is describing the hardware, not leaking the answer.
 * The estimate is built from noisy, one-tick-stale sensors, it subtracts only
 * the coil field the controller genuinely knows, and it therefore carries the
 * full vessel-eddy-current error — the same lie the PID is told.
 */

/* Plasma-only sensor signature of a filament set at (R, Z, a, κ, δ) carrying
 * unit current. Identical filament layout to Tokamak._updateGeometry, which is
 * the only reason the fit transfers. */
function filamentSignature(mac, R, Z, a, kappa, delta, probeOut, fluxOut) {
    const NF = PLASMA.NF;
    const dl = Math.asin(clamp(delta, -0.99, 0.99));
    const rf = 0.62 * a;
    const fR = [R], fZ = [Z], fw = [0.34];
    for (let k = 1; k < NF; k++) {
        const th = ((k - 1) / (NF - 1)) * 2 * Math.PI;
        fR.push(R + rf * Math.cos(th + dl * Math.sin(th)));
        fZ.push(Z + kappa * rf * Math.sin(th));
        fw.push(0.66 / (NF - 1));
    }
    for (let s = 0; s < N_PROBE; s++) {
        let v = 0;
        const g = mac.gProbe[s];
        for (let k = 0; k < NF; k++) v += fw[k] * mac.sample(g, fR[k], fZ[k]);
        probeOut[s] = v;
    }
    for (let s = 0; s < N_FLUX; s++) {
        let v = 0;
        const g = mac.gFlux[s];
        for (let k = 0; k < NF; k++) v += fw[k] * mac.sample(g, fR[k], fZ[k]);
        fluxOut[s] = v;
    }
}

/* Ridge regression, w = (XᵀX + λI)⁻¹Xᵀy. λ is not optional: the probe array is
 * badly collinear (38 probes measuring what is essentially a 3-parameter field)
 * and the unregularised normal equations are numerically singular. */
function ridge(X, y, N, M, lamRel) {
    const A = new Float64Array(M * M), b = new Float64Array(M);
    for (let i = 0; i < N; i++) {
        const row = i * M;
        for (let p = 0; p < M; p++) {
            const xp = X[row + p];
            if (xp === 0) continue;
            b[p] += xp * y[i];
            for (let q = p; q < M; q++) A[p * M + q] += xp * X[row + q];
        }
    }
    // λ RELATIVE to the scale of XᵀX. An absolute λ here is the same trap as in
    // the equilibrium solver: get it wrong by a few orders of magnitude and the
    // regression returns its bias term and nothing else — an "observer" that
    // reports the same position no matter where the plasma is.
    let tr = 0;
    for (let p = 0; p < M; p++) tr += A[p * M + p];
    const lam = lamRel * (tr / M);
    for (let p = 0; p < M; p++) {
        A[p * M + p] += lam;
        for (let q = p + 1; q < M; q++) A[q * M + p] = A[p * M + q];
    }
    const Ai = invert(A, M);
    const w = new Float64Array(M);
    for (let p = 0; p < M; p++) {
        let s = 0;
        for (let q = 0; q < M; q++) s += Ai[p * M + q] * b[q];
        w[p] = s;
    }
    return w;
}

class MagneticObserver {
    constructor(mac) {
        this.mac = mac || getMachine();
        this.M = N_PROBE + N_FLUX + 1;
        this._pb = new Float64Array(N_PROBE);
        this._fb = new Float64Array(N_FLUX);
        this._fit();
    }

    /* Fit R and Z from the plasma-only magnetics over the operating box. 135
     * sample equilibria against 73 sensors — over-determined, but only just,
     * which is why the observer degrades gracefully rather than exploding when
     * the plasma wanders outside the box it was fitted on.
     *
     * Fitted at ONE minor radius and ONE triangularity, deliberately. Widening
     * the fit to span a ∈ [0.15, 0.235] and δ ∈ [−0.3, 0.4] was tried and made
     * things worse across the board — mean boundary error on the seven short
     * tasks went from 2.84 cm to 3.48 cm. A least-squares observer spends its
     * accuracy where you give it samples, and spreading 73 weights over a
     * five-dimensional box buys coverage of shapes the plasma rarely visits at
     * the cost of precision where it actually lives. */
    _fit() {
        const mac = this.mac, M = this.M;
        const Rs = [0.80, 0.84, 0.88, 0.92, 0.96];
        const Zs = [-0.16, -0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12, 0.16];
        const Ks = [1.0, 1.5, 2.0];
        const As = [0.22], Ds = [0.20];
        const N = Rs.length * Zs.length * Ks.length * As.length * Ds.length;
        const X = new Float64Array(N * M);
        const yZ = new Float64Array(N), yR = new Float64Array(N);
        const pb = new Float64Array(N_PROBE), fb = new Float64Array(N_FLUX);
        let i = 0;
        for (const R of Rs) for (const Z of Zs) for (const K of Ks)
        for (const A of As) for (const D of Ds) {
            filamentSignature(mac, R, Z, A, K, D, pb, fb);
            // Scaled to the REFERENCE plasma current, exactly as estimate() does
            // when it divides the live measurement by I_p/I_ref. Fit and use must
            // agree to the factor: mismatched normalisation between the two is
            // the classic silent failure, and here it silently turned the
            // observer into a constant.
            const row = i * M;
            for (let s = 0; s < N_PROBE; s++) X[row + s] = pb[s] * PLASMA.IpRef / NORM.probe;
            for (let s = 0; s < N_FLUX; s++) X[row + N_PROBE + s] = fb[s] * PLASMA.IpRef / NORM.flux;
            X[row + M - 1] = 1;
            yZ[i] = Z; yR[i] = R - VESSEL.R0;
            i++;
        }
        this.wZ = ridge(X, yZ, N, M, 1e-6);
        this.wR = ridge(X, yR, N, M, 1e-6);
    }

    /* Estimate (R, Z) from measurements alone. The coil contribution is removed
     * because the controller measures its own coil currents and knows the
     * machine; the vessel contribution is NOT removed, because nothing measures
     * it. That residual is the screening error every magnetic controller lives
     * with, and it is why block E of the observation exists. */
    estimate(tok, out) {
        const mac = this.mac, n = mac.n, nc = mac.nc;
        const pb = this._pb, fb = this._fb;
        for (let s = 0; s < N_PROBE; s++) {
            let v = tok.probeMeas[s];
            const b = s * n;
            for (let j = 0; j < nc; j++) v -= mac.sProbeC[b + j] * tok.coilMeas[j];
            pb[s] = v;
        }
        for (let s = 0; s < N_FLUX; s++) {
            let v = tok.fluxMeas[s];
            const b = s * n;
            for (let j = 0; j < nc; j++) v -= mac.sFluxC[b + j] * tok.coilMeas[j];
            fb[s] = v;
        }
        const Ip = Math.max(20e3, Math.abs(tok.ipMeas));
        const M = this.M;
        let z = this.wZ[M - 1], r = this.wR[M - 1];
        for (let s = 0; s < N_PROBE; s++) {
            const x = pb[s] / (NORM.probe * (Ip / PLASMA.IpRef));
            z += this.wZ[s] * x; r += this.wR[s] * x;
        }
        for (let s = 0; s < N_FLUX; s++) {
            const x = fb[s] / (NORM.flux * (Ip / PLASMA.IpRef));
            z += this.wZ[N_PROBE + s] * x; r += this.wR[N_PROBE + s] * x;
        }
        out = out || {};
        out.R = VESSEL.R0 + r; out.Z = z; out.Ip = tok.ipMeas;
        return out;
    }
}

/* One observer per machine, built lazily and cached: the fit costs a 73×73
 * inversion and every Tokamak in a 128-brain population wants the same one. */
function getObserver(mac) {
    mac = mac || getMachine();
    if (!mac._observer) mac._observer = new MagneticObserver(mac);
    return mac._observer;
}

/* ============================================================== Tokamak === */
class Tokamak {
    constructor(machine, opts) {
        this.mac = machine || getMachine();
        this.opts = opts || {};
        const n = this.mac.n, nc = this.mac.nc;
        this.n = n; this.nc = nc;

        this.I = new Float64Array(n);          // circuit currents (A): coils then vessel
        this.dIdt = new Float64Array(n);
        this.V = new Float64Array(n);          // applied voltage (only coils are driven)
        this.Vcmd = new Float64Array(nc);      // post-slew commanded voltage
        this._rhs = new Float64Array(n);
        this._tmp = new Float64Array(n);
        this._cpl = new Float64Array(n);
        this._Mj = new Float64Array(n);
        this._Gj = new Float64Array(n);
        this._res = new Float64Array(n);
        this._gain = new Float64Array(nc);

        this.fil = { R: new Float64Array(PLASMA.NF), Z: new Float64Array(PLASMA.NF), w: new Float64Array(PLASMA.NF) };
        this.fil.w[0] = 0.34;
        for (let k = 1; k < PLASMA.NF; k++) this.fil.w[k] = 0.66 / (PLASMA.NF - 1);

        this.bnd = new Float64Array(N_BND * 2);
        this.tgtBnd = new Float64Array(N_BND * 2);

        this.fluxTrue = new Float64Array(N_FLUX);
        this.probeTrue = new Float64Array(N_PROBE);
        this.fluxMeas = new Float64Array(N_FLUX);
        this.probeMeas = new Float64Array(N_PROBE);
        this.coilMeas = new Float64Array(nc);
        this.ipMeas = 0;

        this.prevAct = new Float32Array(19);
        this.obs = new Float32Array(MODES.full.obs);

        // ---- temporal memory (see HIST_LAGS) ------------------------------
        // Ring buffers, written once per control step in _updateEstimate().
        // Four scalars deep in time plus the whole probe array shallow in time;
        // that is the smallest pair of histories from which vertical velocity
        // and the vessel's eddy-current signature are both recoverable.
        this.est = { R: VESSEL.R0, Z: 0, Ip: 0 };
        this.hist = new Float64Array(HIST_LEN * 4);      // Ẑ, R̂, Ip, I_fast
        this.probeHist = new Float64Array(PROBE_HIST_LEN * N_PROBE);
        this.actHist = new Float64Array(32);             // fast-coil command
        this.histK = 0;                                  // monotonic frame counter
        this.eInt = new Float64Array(3);                 // leaky ∫ of eZ, eR, eIp

        this.rng = this.opts.rng || mulberry32(1);
        this._dom = null;
    }

    /* Run the shared magnetic observer and push one frame of history. Called
     * once per control step, from step(), NOT from observe() — observe() is
     * called an unpredictable number of times per tick (the trainer, the UI and
     * the imitation harness all read it) and a history that advanced on reads
     * would sample time at whatever rate the caller happened to poll. */
    _updateEstimate() {
        const obs = this._obsv || (this._obsv = getObserver(this.mac));
        obs.estimate(this, this.est);
        // One monotonic counter drives all three rings. Deriving each index from
        // its own wrapping cursor looks equivalent and is not: with ring lengths
        // that are not multiples of one another the cursors fall out of step at
        // the wrap and the lag lookup silently returns the wrong frame.
        const k = ++this.histK;
        const b = (k % HIST_LEN) * 4;
        this.hist[b] = this.est.Z;
        this.hist[b + 1] = this.est.R;
        this.hist[b + 2] = this.ipMeas;
        this.hist[b + 3] = this.coilMeas[18];
        const pb = (k % PROBE_HIST_LEN) * N_PROBE;
        for (let s = 0; s < N_PROBE; s++) this.probeHist[pb + s] = this.probeMeas[s];
        this.actHist[k % 32] = this.prevAct[18];

        // Leaky integrals. The leak (τ ≈ 20 ms, two instability growth times)
        // is the anti-windup: a pure integrator on a signal this noisy runs
        // away during the one episode in ten where the plasma is lost.
        const tg = this.target;
        const decay = 1 - DT_CTRL / 0.020;
        this.eInt[0] = this.eInt[0] * decay + (tg.Z - this.est.Z) * DT_CTRL;
        this.eInt[1] = this.eInt[1] * decay + (tg.R - this.est.R) * DT_CTRL;
        this.eInt[2] = this.eInt[2] * decay + (tg.Ip - this.ipMeas) * DT_CTRL;
    }

    /* Ring lookup: the frame written `lag` control steps ago. */
    _hist(lag, k) {
        return this.hist[((this.histK - lag) % HIST_LEN) * 4 + k];
    }

    /* ------------------------------------------------------------- reset */
    /* `task` supplies the target trajectory (see tasks.js) and the initial
     * equilibrium. The initial coil currents are NOT solved for — they are the
     * task's stated starting guess, which is usually a little off, so the very
     * first thing any controller has to do is catch a plasma that is already
     * drifting. That is deliberate. */
    reset(task, rng) {
        if (rng) this.rng = rng;
        const R = this.rng;
        this.task = task;
        this.t = 0;
        this.step_i = 0;
        this.dead = false;
        this.deadReason = null;

        // ---- domain randomisation -----------------------------------------
        // The difficulty rung widens the box and shifts the wall; everything
        // else about the draw is unchanged, so a level-0 episode is bit-for-bit
        // the episode this simulator has always run.
        const dif = this.dif = difficultyOf(this.opts.level || 0);
        const rr = (a) => a[0] + R() * (a[1] - a[0]);
        const rs = (a) => rr(spreadRange(a, dif.spread));
        const on = RANDOMISE.enabled && this.opts.randomise !== false;
        const d = this._dom = {
            plasmaRes: on ? rs(RANDOMISE.plasmaRes) : 1,
            vesselTau: (on ? rs(RANDOMISE.vesselTau) : 1) * dif.wall,
            fluxNoise: (on ? rs(RANDOMISE.fluxNoise) : 1) * dif.noise,
            probeNoise: (on ? rs(RANDOMISE.probeNoise) : 1) * dif.noise,
            ipNoise: (on ? rs(RANDOMISE.ipNoise) : 1) * dif.noise,
            betaP: on ? rs(RANDOMISE.betaP) : PLASMA.betaP
        };
        for (let i = 0; i < this.nc; i++) {
            this._gain[i] = on ? rs(RANDOMISE.coilGain) : 1;
            this._res[i] = this.mac.res[i] * (on ? 1 / rs(RANDOMISE.coilTau) : 1);
        }
        for (let i = this.nc; i < this.n; i++) this._res[i] = this.mac.res[i] / d.vesselTau;
        this.Rp = PLASMA.Rp0 * d.plasmaRes;
        this._buildStepMatrices();

        // ---- initial state --------------------------------------------------
        const s0 = task.initial;
        this.I.fill(0);
        if (s0.coils) for (let i = 0; i < Math.min(this.nc, s0.coils.length); i++) this.I[i] = s0.coils[i];
        this.dIdt.fill(0);
        this.V.fill(0);
        this.Vcmd.fill(0);
        this.Ip = s0.Ip;
        this.pR = s0.R; this.pZ = s0.Z;
        this.vR = 0; this.vZ = 0;
        this.kappa = s0.kappa; this.delta = s0.delta;
        this.a = PLASMA.aMax;
        this.prevAct.fill(0);
        this.nIndex = 0;
        this.vLoop = 0;
        this.limitPressure = 0;
        this._updateGeometry();
        this._sensors();
        this.fluxMeas.set(this.fluxTrue);
        this.probeMeas.set(this.probeTrue);
        for (let i = 0; i < this.nc; i++) this.coilMeas[i] = this.I[i];
        this.ipMeas = this.Ip;
        this.target = task.targetAt(0);

        // Prime the temporal block. Every lag in HIST_LAGS is filled with the
        // state at t = 0, so the first control step sees zero velocity rather
        // than a step change out of an empty buffer — a controller whose first
        // reading is a 0.88 m radial jump commands accordingly and the episode
        // is decided before it starts. The counter starts well past the longest
        // lag so the ring index can never go negative.
        this.histK = 100 * HIST_LEN;
        this.eInt.fill(0);
        this.actHist.fill(0);
        this._obsv = getObserver(this.mac);
        this._obsv.estimate(this, this.est);
        for (let i = 0; i < HIST_LEN; i++) {
            this.hist[i * 4] = this.est.Z;
            this.hist[i * 4 + 1] = this.est.R;
            this.hist[i * 4 + 2] = this.ipMeas;
            this.hist[i * 4 + 3] = this.coilMeas[18];
        }
        for (let i = 0; i < PROBE_HIST_LEN; i++) {
            for (let s = 0; s < N_PROBE; s++) this.probeHist[i * N_PROBE + s] = this.probeMeas[s];
        }
        return this;
    }

    /* Backward-Euler circuit propagator, precomputed per episode because the
     * resistances change with the domain randomisation.
     *
     *   I(t+dt) = A·I(t) + B·(V − plasma coupling)
     *
     * Backward Euler because the fast coil's 0.3 ms L/R against a 50 µs substep
     * is right on the edge for forward Euler, and the mutual coupling between
     * the G coil and the vessel loops next to it produces eigenvalues faster
     * still. Unconditional stability is worth the slight over-damping. */
    _buildStepMatrices() {
        const n = this.n, Minv = this.mac.Minv, dt = DT_SUB;
        const C = new Float64Array(n * n);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) C[i * n + j] = (i === j ? 1 : 0) + dt * Minv[i * n + j] * this._res[j];
        }
        const A = invert(C, n);
        const B = new Float64Array(n * n);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                let s = 0;
                for (let k = 0; k < n; k++) s += A[i * n + k] * Minv[k * n + j];
                B[i * n + j] = s * dt;
            }
        }
        this.A = A; this.B = B;
    }

    /* ----------------------------------------------------- plasma geometry */
    /* Minor radius is slaved to the plasma current and then clipped by the
     * vessel: a plasma pushed against the wall shrinks rather than passing
     * through it. That clipping IS the limiter model, and running out of room
     * is one of the three ways to disrupt.
     *
     * ASSUMPTION: no pressure-driven equilibrium. In a real machine a is set by
     * the balance of the plasma pressure, the current profile and the applied
     * field. Here it is a formula. */
    _updateGeometry() {
        const want = PLASMA.aMax * Math.sqrt(clamp(this.Ip / PLASMA.IpRef, 0.02, 1.35));
        const clearR = Math.min(this.pR - VESSEL.Rin, VESSEL.Rout - this.pR) - 0.025;
        const clearZ = Math.min(VESSEL.Ztop - this.pZ, this.pZ - VESSEL.Zbot) - 0.025;
        const lim = Math.min(clearR, clearZ / Math.max(1, this.kappa));
        this.a = Math.max(0.01, Math.min(want, lim));
        this.aWanted = want;

        const dl = Math.asin(clamp(this.delta, -0.99, 0.99));
        const rf = 0.62 * this.a;
        this.fil.R[0] = this.pR; this.fil.Z[0] = this.pZ;
        for (let k = 1; k < PLASMA.NF; k++) {
            const th = ((k - 1) / (PLASMA.NF - 1)) * 2 * Math.PI;
            this.fil.R[k] = this.pR + rf * Math.cos(th + dl * Math.sin(th));
            this.fil.Z[k] = this.pZ + this.kappa * rf * Math.sin(th);
        }
        boundaryPoints(this.pR, this.pZ, this.a, this.kappa, this.delta, this.bnd);
    }

    /* ------------------------------------------------------------ physics */
    _physics(dt) {
        const mac = this.mac, n = this.n, NF = PLASMA.NF;
        const I = this.I, fil = this.fil;
        const Mj = this._Mj, Gj = this._Gj, cpl = this._cpl;
        Mj.fill(0); Gj.fill(0);

        // Field at every filament, and simultaneously each circuit's coupling to
        // the plasma and the rate at which the plasma's MOTION changes that
        // coupling. The motional term is what makes the vessel react to a
        // vertical displacement at all — drop it and the passive structure stops
        // stabilising anything.
        let FR = 0, FZ = 0, psiExt = 0;
        const bR = this._bR || (this._bR = new Float64Array(NF));
        const bZ = this._bZ || (this._bZ = new Float64Array(NF));
        bR.fill(0); bZ.fill(0);

        const nc = this.nc;
        for (let j = 0; j < n; j++) {
            const Ij = I[j];
            const screen = j < nc ? COIL_SCREEN : WALL_SCREEN;
            const gp = mac.gPsi[j], gr = mac.gBR[j], gz = mac.gBZ[j];
            let mj = 0, gj = 0;
            for (let k = 0; k < NF; k++) {
                const Rk = fil.R[k], Zk = fil.Z[k], wk = fil.w[k];
                const ps = mac.sample(gp, Rk, Zk);
                const br = mac.sample(gr, Rk, Zk);
                const bz = mac.sample(gz, Rk, Zk);
                bR[k] += Ij * br; bZ[k] += Ij * bz;
                mj += wk * ps;
                gj += screen * wk * 2 * Math.PI * Rk * (bz * this.vR - br * this.vZ);
            }
            Mj[j] = mj; Gj[j] = gj;
            psiExt += Ij * mj;
        }

        for (let k = 0; k < NF; k++) {
            const Ik = this.Ip * fil.w[k];
            const c = 2 * Math.PI * fil.R[k] * Ik;
            FR += c * bZ[k];
            FZ -= c * bR[k];
        }

        // Hoop force. A current ring wants to expand; this is the outward push
        // the vertical field has to balance.
        //
        // ASSUMPTION: the large-aspect-ratio Shafranov expression, with li and
        // βp held fixed. There is no transport model, so βp cannot evolve.
        //
        // It uses the NOMINAL minor radius, not the one clipped by the vessel.
        // Feeding the clipped radius in here creates a runaway that has nothing
        // to do with real physics: plasma drifts outward → limiter clips a →
        // ln(8R/a) grows → hoop force grows → drifts further out. Every task
        // ended in "wall contact (radial)" until this line changed. The clipped
        // radius still decides the visible boundary and still triggers the
        // squashed-against-the-wall disruption.
        const aa = Math.max(0.02, this.aWanted || this.a);
        FR += 0.5 * MU0 * this.Ip * this.Ip *
            (Math.log(8 * this.pR / aa) + PLASMA.li / 2 + this._dom.betaP - 1.5);

        // ---- plasma current circuit --------------------------------------
        // L_p dIp/dt + d/dt(external flux through the plasma) + R_p·Ip = 0.
        // The external-flux derivative uses the previous substep's dI/dt: with
        // a 50 µs substep against a 300 µs fastest circuit the lag is small, and
        // it avoids solving a 36×36 coupled system every substep.
        const Lp = MU0 * this.pR * (Math.log(8 * this.pR / aa) + PLASMA.li / 2 - 2);
        let dPsi = 0;
        for (let j = 0; j < n; j++) dPsi += Mj[j] * this.dIdt[j] + I[j] * Gj[j];
        const Ipdot = (-dPsi - this.Rp * this.Ip) / Math.max(1e-7, Lp);
        this.vLoop = -dPsi;
        this.psiExt = psiExt;

        // ---- coil + vessel circuits ---------------------------------------
        for (let j = 0; j < n; j++) cpl[j] = Mj[j] * Ipdot + this.Ip * Gj[j];
        const rhs = this._rhs;
        for (let j = 0; j < n; j++) rhs[j] = this.V[j] - cpl[j];
        const t1 = this._tmp;
        matvec(this.B, rhs, t1, n);
        const t2 = this._cplTmp || (this._cplTmp = new Float64Array(n));
        matvec(this.A, I, t2, n);
        for (let j = 0; j < n; j++) {
            const prev = I[j];
            let v = t2[j] + t1[j];
            if (j < this.nc) {
                const lim = mac.imax[j];
                if (v > lim) v = lim; else if (v < -lim) v = -lim;
            }
            this.dIdt[j] = (v - prev) / dt;
            I[j] = v;
        }

        // ---- rigid displacement -------------------------------------------
        const m = PLASMA.mass, c = PLASMA.drag;
        this.vR += ((FR - c * this.vR) / m) * dt;
        this.vZ += ((FZ - c * this.vZ) / m) * dt;
        this.pR += this.vR * dt;
        this.pZ += this.vZ * dt;
        this.Ip += Ipdot * dt;
        this.FR = FR; this.FZ = FZ;

        // ---- shape, slaved to the applied field ----------------------------
        this._updateShape(dt);
        this._updateGeometry();
    }

    /* Elongation and triangularity are not solved for; they are read off the
     * structure of the applied vertical field at the plasma and relaxed toward
     * it on a 1.2 ms timescale.
     *
     * The field DECAY INDEX  n = −(R/B_z)·∂B_z/∂R  is the hinge of the whole
     * exercise. n > 0 is a field that pushes a displaced plasma back; n < 0 is a
     * field that pulls it further away — and n < 0 is also exactly the field
     * shape that elongates the plasma. So "elongated" and "vertically unstable"
     * are the same statement about the same number, which is why a circular
     * plasma here sits still and a κ ≈ 1.8 one runs away in milliseconds.
     *
     * ASSUMPTION: the κ(n) and δ(∂²B_z/∂R²) maps are fitted-looking formulas,
     * not equilibrium solutions. They get the coupling and the sign right and
     * the magnitudes roughly right. They are the single crudest thing in here. */
    _updateShape(dt) {
        const mac = this.mac, n = this.n, I = this.I;
        const h = 0.045;
        let bzm = 0, bzp = 0, bz0 = 0;
        for (let j = 0; j < n; j++) {
            const g = mac.gBZ[j], Ij = I[j];
            if (Ij === 0) continue;
            bzm += Ij * mac.sample(g, this.pR - h, this.pZ);
            bz0 += Ij * mac.sample(g, this.pR, this.pZ);
            bzp += Ij * mac.sample(g, this.pR + h, this.pZ);
        }
        const bzRef = Math.abs(bz0) < 5e-3 ? (bz0 < 0 ? -5e-3 : 5e-3) : bz0;
        const dBdR = (bzp - bzm) / (2 * h);
        const d2BdR2 = (bzp - 2 * bz0 + bzm) / (h * h);
        const nIdx = clamp(-(this.pR / bzRef) * dBdR, -4, 4);
        this.nIndex = nIdx;
        this.bz0 = bz0;

        const kEq = clamp(1 + PLASMA.kappaGain * Math.max(0, -nIdx), 1, PLASMA.kappaMax);
        const dEq = clamp(PLASMA.deltaGain * (this.pR * this.pR * d2BdR2) / bzRef, -PLASMA.deltaMax, PLASMA.deltaMax);
        const al = 1 - Math.exp(-dt / PLASMA.tauShape);
        this.kappa += (kEq - this.kappa) * al;
        this.delta += (dEq - this.delta) * al;
        this.kappaEq = kEq; this.deltaEq = dEq;
    }

    /* --------------------------------------------------------- diagnostics */
    /* Flux loops and field probes see the coils, the vessel eddy currents AND
     * the plasma. That is the whole difficulty: the controller cannot separate
     * "the plasma moved" from "a coil current changed" without knowing the
     * machine, and it is never told the machine. */
    _sensors() {
        const mac = this.mac, n = this.n, NF = PLASMA.NF, I = this.I, fil = this.fil;
        for (let s = 0; s < N_FLUX; s++) {
            let v = 0;
            const b = s * n;
            for (let j = 0; j < n; j++) v += mac.sFluxC[b + j] * I[j];
            const g = mac.gFlux[s];
            for (let k = 0; k < NF; k++) v += this.Ip * fil.w[k] * mac.sample(g, fil.R[k], fil.Z[k]);
            this.fluxTrue[s] = v;
        }
        for (let s = 0; s < N_PROBE; s++) {
            let v = 0;
            const b = s * n;
            for (let j = 0; j < n; j++) v += mac.sProbeC[b + j] * I[j];
            const g = mac.gProbe[s];
            for (let k = 0; k < NF; k++) v += this.Ip * fil.w[k] * mac.sample(g, fil.R[k], fil.Z[k]);
            this.probeTrue[s] = v;
        }
    }

    /* --------------------------------------------------------------- step */
    /* `action` is normalised to [−1, 1] per circuit. In trimmed mode it is
     * shorter and maps onto a subset of circuits; the rest hold whatever
     * voltage they had, which is zero. */
    step(action) {
        if (this.dead) return;
        const spec = modeSpec();
        const mac = this.mac;

        // ---- action → voltage, with slew, gain and resistive feed-forward ---
        //
        // The supply adds R̂·I on top of whatever the controller asks for, so a
        // zero command HOLDS the present current instead of letting it decay at
        // the coil's L/R. This is the innermost loop of a real power supply, not
        // a favour to the agent: it is a property of the hardware, and it means
        // the action space is honestly inductive — the agent still cannot set a
        // current, only push on its rate, and still eats every slew, voltage and
        // current limit. Without it, eighteen of the nineteen outputs would have
        // to spend their capacity learning a DC bias that the machine already
        // knows.
        //
        // R̂ is the NOMINAL resistance, not the randomised one, so a machine with
        // 15% hotter coils than the model leaves a residual drift the controller
        // has to notice and correct. That is the point of the randomisation.
        const applyOne = (ci, u) => {
            const cir = mac.circuits[ci];
            const want = clamp(u, -1, 1) * cir.vmax;
            const slew = (cir.kind === "fast" ? SLEW_FAST : SLEW_SHAPE) * DT_CTRL;
            let v = this.Vcmd[ci];
            v += clamp(want - v, -slew, slew);
            this.Vcmd[ci] = v;
            const vff = mac.res[ci] * this.I[ci];
            let vt = clamp(v * this._gain[ci] + vff, -cir.vmax, cir.vmax);
            // Hard current limit: a supply pushing into a coil already at its
            // ceiling does nothing but heat the room.
            if (this.I[ci] >= mac.imax[ci] && vt > vff) vt = vff;
            if (this.I[ci] <= -mac.imax[ci] && vt < vff) vt = vff;
            this.V[ci] = vt;
        };
        // EVERY circuit is driven every step, including the ones this mode does
        // not expose to the controller — they get a zero command, which with the
        // resistive feed-forward means "hold present current". Skipping them
        // entirely leaves their supply at zero volts and they decay at their own
        // L/R, so in trimmed mode fourteen of the nineteen coils quietly emptied
        // themselves over an episode and no controller could have held anything.
        if (spec.actIdx) {
            const cmd = this._cmdBuf || (this._cmdBuf = new Float64Array(this.nc));
            cmd.fill(0);
            for (let i = 0; i < spec.actIdx.length; i++) cmd[spec.actIdx[i]] = action[i];
            for (let i = 0; i < this.nc; i++) applyOne(i, cmd[i]);
        } else {
            for (let i = 0; i < this.nc; i++) applyOne(i, action[i]);
        }
        // previous-action neuron always carries all 19, zero where not commanded
        this.prevAct.fill(0);
        if (spec.actIdx) {
            for (let i = 0; i < spec.actIdx.length; i++) this.prevAct[spec.actIdx[i]] = clamp(action[i], -1, 1);
        } else {
            for (let i = 0; i < 19; i++) this.prevAct[i] = clamp(action[i], -1, 1);
        }

        for (let s = 0; s < SUBSTEPS; s++) this._physics(DT_SUB);

        this.t += DT_CTRL;
        this.step_i++;
        this.target = this.task.targetAt(this.t);
        this._checkDisruption();

        // ---- measurement: noisy, and one control step stale ----------------
        // The observation the network reads is written AFTER this, from the
        // buffers we are about to fill — so what it sees is always one tick old,
        // exactly like a real digital control system.
        this._sensors();
        const noise = this.opts.noise !== false;
        const R = this.rng, d = this._dom;
        const g = () => gaussRand(R);
        for (let s = 0; s < N_FLUX; s++) {
            this.fluxMeas[s] = this.fluxTrue[s] + (noise ? g() * NOISE_BASE.flux * d.fluxNoise : 0);
        }
        for (let s = 0; s < N_PROBE; s++) {
            this.probeMeas[s] = this.probeTrue[s] + (noise ? g() * NOISE_BASE.probe * d.probeNoise : 0);
        }
        for (let i = 0; i < this.nc; i++) {
            this.coilMeas[i] = this.I[i] + (noise ? g() * NOISE_BASE.coilI : 0);
        }
        this.ipMeas = this.Ip + (noise ? g() * NOISE_BASE.ip * d.ipNoise : 0);

        // how hard the supplies are pressed against their limits (used by the
        // reward, and shown in the UI as a red bar)
        let lp = 0;
        for (let i = 0; i < this.nc; i++) {
            const f = Math.abs(this.I[i]) / mac.imax[i];
            if (f > 0.8) lp += (f - 0.8) * (f - 0.8);
        }
        this.limitPressure = lp;

        // Observer + history, from the measurements just written. Last, so the
        // temporal block is exactly as stale as the sensors it is built from.
        this._updateEstimate();
    }

    _checkDisruption() {
        if (this.dead) return;
        if (!(this.Ip > 0) || !Number.isFinite(this.pZ) || !Number.isFinite(this.pR)) {
            this.dead = true; this.deadReason = "numerical"; return;
        }
        if (this.Ip < 30e3) { this.dead = true; this.deadReason = "current quench"; return; }
        if (Math.abs(this.pZ) > 0.46) { this.dead = true; this.deadReason = "vertical displacement event"; return; }
        if (this.pR < VESSEL.Rin + 0.08 || this.pR > VESSEL.Rout - 0.08) {
            this.dead = true; this.deadReason = "wall contact (radial)"; return;
        }
        if (this.a < PLASMA.aMin) { this.dead = true; this.deadReason = "wall contact (squashed)"; return; }
    }

    /* ------------------------------------------------------- observation */
    observe() {
        const spec = modeSpec();
        const o = this.obs;
        const tg = this.target;
        let p = 0;
        if (spec.trimFlux) {
            for (const s of spec.trimFlux) o[p++] = this.fluxMeas[s] / NORM.flux;
            for (const s of spec.trimProbes) o[p++] = this.probeMeas[s] / NORM.probe;
            for (const c of spec.trimCoils) o[p++] = this.coilMeas[c] / NORM.coilI;
            o[p++] = this.coilMeas[18] / NORM.fastI;
            o[p++] = this.ipMeas / NORM.ip - 1;
            for (const c of spec.actIdx) o[p++] = this.prevAct[c];
            o[p++] = tg.Ip / NORM.ip - 1;
            o[p++] = (tg.R - VESSEL.R0) / NORM.tgtR;
            o[p++] = tg.Z / NORM.tgtZ;
            o[p++] = (tg.kappa - 1.4) / NORM.tgtK;
            return o;
        }
        for (let s = 0; s < N_FLUX; s++) o[p++] = this.fluxMeas[s] / NORM.flux;          // 34
        for (let s = 0; s < N_PROBE; s++) o[p++] = this.probeMeas[s] / NORM.probe;       // 38
        for (let i = 0; i < 18; i++) o[p++] = this.coilMeas[i] / NORM.coilI;             // 18
        o[p++] = this.coilMeas[18] / NORM.fastI;                                          // 1
        o[p++] = (this.coilMeas[16] - this.coilMeas[17]) / NORM.ohmDiff;                  // 1
        o[p++] = this.ipMeas / NORM.ip - 1;                                               // 1
        // Per-channel whitening of the 93 MEASURED neurons (calibrate.js). The
        // block constants above only get these to the right order of magnitude;
        // they still carry a large DC offset with the control signal riding on
        // it at a tenth of the amplitude, which is what a mutation-driven search
        // is worst at. Skipped silently if obs_norm.js has not been generated.
        if (typeof OBS_NORM !== "undefined" && OBS_NORM && OBS_NORM.n === p) {
            const m = OBS_NORM.mean, sd = OBS_NORM.std;
            for (let k = 0; k < p; k++) o[k] = (o[k] - m[k]) / sd[k];
        }
        for (let i = 0; i < 19; i++) o[p++] = this.prevAct[i];                            // 19
        const tb = this.task.targetBoundary(this.t, this.tgtBnd);                          // 32
        for (let i = 0; i < N_BND; i++) {
            o[p++] = (tb[i * 2] - VESSEL.R0) / NORM.tgtR;
            o[p++] = tb[i * 2 + 1] / NORM.tgtZ;
        }
        o[p++] = tg.Ip / NORM.ip - 1;                                                     // 4
        o[p++] = (tg.R - VESSEL.R0) / NORM.tgtR;
        o[p++] = tg.Z / NORM.tgtZ;
        o[p++] = (tg.kappa - 1.4) / NORM.tgtK;
        o[p++] = clamp(this.t / this.task.duration, 0, 1);                                // 1

        /* ---- temporal block (see HIST_LAGS) --------------------------------
         * Scaled only coarsely here. The per-channel whitening that matters is
         * applied at the end from OBS_NORM.ext, because the useful amplitude of
         * a 0.1 ms difference and a 6.4 ms one differ by two orders of magnitude
         * and no hand-picked constant gets both right. */
        const est = this.est, tg2 = this.target;
        const eZ = tg2.Z - est.Z, eR = tg2.R - est.R, eIp = tg2.Ip - this.ipMeas;
        const q = p;                                                                      // A: 8
        o[p++] = est.Z / 0.20;
        o[p++] = (est.R - VESSEL.R0) / 0.10;
        o[p++] = eZ / 0.05;
        o[p++] = eR / 0.05;
        o[p++] = eIp / 50e3;
        o[p++] = (est.Z - this._hist(1, 0)) / DT_CTRL / 20;
        o[p++] = (est.R - this._hist(1, 1)) / DT_CTRL / 20;
        o[p++] = (this.ipMeas - this._hist(1, 2)) / DT_CTRL / 5e5;
        for (let i = 0; i < HIST_LAGS.length; i++) {                                      // B: 17
            const L = HIST_LAGS[i];
            o[p++] = (est.Z - this._hist(L, 0)) / 0.004;
            o[p++] = (est.R - this._hist(L, 1)) / 0.004;
        }
        for (let i = 0; i < IP_LAGS.length; i++) {
            o[p++] = (this.ipMeas - this._hist(IP_LAGS[i], 2)) / 2e3;
        }
        o[p++] = this.eInt[0] / 2e-4;                                                     // C: 3
        o[p++] = this.eInt[1] / 2e-4;
        o[p++] = this.eInt[2] / 200;
        o[p++] = this.coilMeas[18] / NORM.fastI;                                          // D: 4
        o[p++] = (this.coilMeas[18] - this._hist(1, 3)) / DT_CTRL / 2e6;
        let m8 = 0, m32 = 0;
        for (let i = 0; i < 32; i++) {
            const v = this.actHist[(this.histK - i) % 32];
            m32 += v;
            if (i < 8) m8 += v;
        }
        o[p++] = m8 / 8;
        o[p++] = m32 / 32;
        const ph = ((this.histK - PROBE_LAG) % PROBE_HIST_LEN) * N_PROBE;                 // E: 38
        for (let s = 0; s < N_PROBE; s++) {
            o[p++] = (this.probeMeas[s] - this.probeHist[ph + s]) / 2e-3;
        }
        const ext = typeof OBS_NORM !== "undefined" && OBS_NORM && OBS_NORM.ext;
        if (ext && ext.from === q && ext.mean.length === p - q) {
            for (let k = q; k < p; k++) o[k] = (o[k] - ext.mean[k - q]) / ext.std[k - q];
        }
        return o;
    }

    /* -------------------------------------------------------------- score */
    /* Boundary error: RMS distance between the 16 control points on the plasma
     * boundary and the 16 on the requested one. This is the number the whole
     * exercise is judged on, so it is deliberately the plainest thing here. */
    boundaryError() {
        const tb = this.task.targetBoundary(this.t, this.tgtBnd);
        let s = 0;
        for (let i = 0; i < N_BND; i++) {
            const dr = this.bnd[i * 2] - tb[i * 2];
            const dz = this.bnd[i * 2 + 1] - tb[i * 2 + 1];
            s += dr * dr + dz * dz;
        }
        return Math.sqrt(s / N_BND);
    }

    /* Instantaneous reward, per control step.
     * ASSUMPTION: everything the operator cares about reduces to a weighted sum
     * of squared errors. On a real machine "did the divertor survive" is not in
     * this list, and nothing here would notice if it hadn't. */
    reward(action) {
        const tg = this.target;
        const be = this.boundaryError();
        const dIp = (this.Ip - tg.Ip) / 50e3;
        const dR = (this.pR - tg.R) / 0.08;
        const dZ = (this.pZ - tg.Z) / 0.06;
        let eff = 0;
        const nAct = modeSpec().act;
        for (let i = 0; i < nAct; i++) eff += action[i] * action[i];
        eff /= nAct;
        const r = 1.0
            - 3.2 * (be / 0.08) * (be / 0.08)
            - 0.8 * dIp * dIp
            - 0.9 * dR * dR
            - 1.6 * dZ * dZ
            - 0.05 * eff
            - 0.6 * this.limitPressure;
        // Floored at −4, and World.DEAD_STEP_COST is larger than 4. Without a
        // floor, a plasma 30 cm off target scores −20 per step, which is far
        // worse than the cost of disrupting — so the highest-scoring strategy a
        // young population can find is to kill the plasma immediately and stop
        // the clock. Every reward that terminates on failure needs this check.
        return r < -4 ? -4 : r;
    }

    /* Ground truth, for the debug panel and for the tests. Never fed to a
     * controller: the whole point is that a controller sees only magnetics. */
    state() {
        return {
            t: this.t, R: this.pR, Z: this.pZ, Ip: this.Ip, a: this.a,
            kappa: this.kappa, delta: this.delta, vR: this.vR, vZ: this.vZ,
            nIndex: this.nIndex, vLoop: this.vLoop, FR: this.FR, FZ: this.FZ,
            dead: this.dead, reason: this.deadReason,
            coils: Array.from(this.I.subarray(0, this.nc)),
            vessel: Array.from(this.I.subarray(this.nc))
        };
    }
}

Tokamak.NORM = NORM;
Tokamak.PLASMA = PLASMA;
Tokamak.NOISE_BASE = NOISE_BASE;

if (typeof module !== "undefined") {
    module.exports = {
        Tokamak, PLASMA, NORM, RANDOMISE, NOISE_BASE, MODES, N_BND,
        CTRL_HZ, DT_CTRL, SUBSTEPS, DT_SUB,
        HIST_LAGS, IP_LAGS, PROBE_LAG, N_TEMPORAL,
        DIFFICULTY, N_LEVELS, difficultyOf, spreadRange,
        MagneticObserver, getObserver, filamentSignature, ridge,
        setObsMode, modeSpec, refreshNetSizes, boundaryPoints, clamp,
        get NET_SIZES() { return NET_SIZES; }
    };
}
