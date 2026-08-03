/* tasks.js — the target registry.
 *
 * Adding a target is meant to be writing a small config, not editing the
 * environment, so a task is a plain object: how long it lasts, what the plasma
 * should look like as a function of time, and how far off the initial coil
 * currents are allowed to be.
 *
 * The initial coil currents are not hand-tuned. `solveEquilibriumCoils` inverts
 * the machine: given a wanted vertical field, decay index and field curvature
 * at the plasma, it finds the minimum-norm set of shaping-coil currents that
 * produce them. That is the closest thing here to what a real machine's
 * pre-programmed reference waveforms are, and it means a new task with a new
 * shape starts from a genuine equilibrium instead of a guess.
 */
"use strict";

/* Vertical field required to hold a plasma of current Ip at major radius R
 * against its own hoop force. Straight inversion of the Shafranov radial force
 * balance used in tokamak.js — the two must agree or every task starts by
 * flying apart. */
function equilibriumBz(Ip, R, a, betaP) {
    const li = PLASMA.li;
    return -MU0 * Ip / (4 * Math.PI * R) *
        (Math.log(8 * R / a) + li / 2 + (betaP == null ? PLASMA.betaP : betaP) - 1.5);
}

/* Inverse of the κ(n) and δ(∂²B_z/∂R²) maps in tokamak.js. Kept here, next to
 * their only consumer, so that if those maps change this fails loudly. */
function fieldTargetsFor(shape) {
    const bz = equilibriumBz(shape.Ip, shape.R, shape.a, shape.betaP);
    const nIdx = -(shape.kappa - 1) / PLASMA.kappaGain;
    const dBdR = -nIdx * bz / shape.R;
    const d2BdR2 = shape.delta * bz / (PLASMA.deltaGain * shape.R * shape.R);
    return { bz, br: 0, dBdR, d2BdR2, nIdx };
}

/* Minimum-norm shaping currents that hit four field targets at the plasma.
 *
 * Four equations, sixteen unknowns: hopelessly under-determined, which is the
 * actual situation on a real machine and the reason coil currents are chosen by
 * an optimiser rather than by hand. Solved as x = Aᵀ(AAᵀ + λI)⁻¹b, i.e. the
 * smallest currents that do the job — the regularisation is what stops the
 * solver from finding a beautiful equilibrium made of two 40 kA coils bucking
 * each other.
 *
 * ASSUMPTION: the field is fully characterised at the plasma by its value, its
 * first and its second radial derivative. Real shape control uses dozens of
 * boundary points; this uses a three-term Taylor expansion about the axis. */
function solveEquilibriumCoils(mac, shape, preset) {
    const nSolve = 16;                        // F1-8 and E1-8
    const h = 0.045;
    const R = shape.R, Z = shape.Z;
    const targ = fieldTargetsFor(shape);

    // Row scaling makes the four residuals comparable in size; without it the
    // solver trades a large curvature error for a tiny field error and the
    // plasma starts with the wrong triangularity but perfect radial balance.
    const rowScale = [1 / 0.05, 1 / 0.05, 1 / 0.04, 1 / 0.4];
    const b = [targ.bz, targ.br, targ.dBdR, targ.d2BdR2];

    // subtract whatever the pre-set circuits (ohmic, fast) already contribute
    const I0 = new Float64Array(mac.n);
    if (preset) for (let i = 0; i < preset.length; i++) I0[i] = preset[i] || 0;
    const quant = (j) => {
        const g = mac.gBZ[j], gr = mac.gBR[j];
        const bzm = mac.sample(g, R - h, Z), bz0 = mac.sample(g, R, Z), bzp = mac.sample(g, R + h, Z);
        return [bz0, mac.sample(gr, R, Z), (bzp - bzm) / (2 * h), (bzp - 2 * bz0 + bzm) / (h * h)];
    };
    for (let j = 0; j < mac.n; j++) {
        if (!I0[j]) continue;
        const q = quant(j);
        for (let r = 0; r < 4; r++) b[r] -= q[r] * I0[j];
    }

    const A = [];
    for (let r = 0; r < 4; r++) A.push(new Float64Array(nSolve));
    for (let j = 0; j < nSolve; j++) {
        const q = quant(j);
        for (let r = 0; r < 4; r++) A[r][j] = q[r] * rowScale[r];
    }
    const bb = b.map((v, r) => v * rowScale[r]);

    // G = A Aᵀ + λI   (4×4). λ is RELATIVE to the scale of G: a coil produces
    // ~1e-5 T per ampere, so an absolute λ of 1e-4 does not regularise the
    // problem, it deletes it — the first version of this returned zero current
    // for every task and every plasma flew into the outboard wall in 300 µs.
    const G = new Float64Array(16);
    let tr = 0;
    for (let r = 0; r < 4; r++) {
        for (let s = 0; s < 4; s++) {
            let v = 0;
            for (let j = 0; j < nSolve; j++) v += A[r][j] * A[s][j];
            G[r * 4 + s] = v;
            if (r === s) tr += v;
        }
    }
    const lam = 1e-6 * (tr / 4);
    for (let r = 0; r < 4; r++) G[r * 4 + r] += lam;
    const Ginv = invert(G, 4);
    const y = new Float64Array(4);
    for (let r = 0; r < 4; r++) {
        let v = 0;
        for (let s = 0; s < 4; s++) v += Ginv[r * 4 + s] * bb[s];
        y[r] = v;
    }
    const out = new Float64Array(mac.nc);
    for (let i = 0; i < mac.nc; i++) out[i] = I0[i];
    for (let j = 0; j < nSolve; j++) {
        let v = 0;
        for (let r = 0; r < 4; r++) v += A[r][j] * y[r];
        out[j] = clamp(v, -mac.imax[j] * 0.85, mac.imax[j] * 0.85);
    }
    return out;
}

/* Minor radius the plasma will settle at for a given current — kept identical
 * to the formula in tokamak.js so a perfectly-controlled plasma scores zero
 * boundary error rather than a constant offset. */
function radiusFor(Ip) {
    return PLASMA.aMax * Math.sqrt(clamp(Ip / PLASMA.IpRef, 0.02, 1.35));
}

/* ------------------------------------------------------------- registry */
/* Each entry is a config. `shape(u)` maps normalised time u ∈ [0,1] to the
 * requested plasma. Everything else — the initial equilibrium, the boundary
 * control points, the observation encoding — is derived. */
const TASK_DEFS = [
    {
        id: "circular",
        label: "Hold circular",
        desc: "κ ≈ 1.05. Nearly neutral vertical stability — the easy one, and the " +
            "control group that proves the elongated cases are hard for a reason.",
        duration: 0.09, kick: 0.5,
        shape: () => ({ Ip: 110e3, R: 0.88, Z: 0, kappa: 1.05, delta: 0.05 })
    },
    {
        id: "elongated",
        label: "Hold elongated",
        desc: "κ ≈ 1.75. Vertically unstable: without feedback on the fast coil " +
            "this plasma is on the wall in about ten milliseconds.",
        duration: 0.11, kick: 1.0,
        shape: () => ({ Ip: 150e3, R: 0.88, Z: 0, kappa: 1.75, delta: 0.25 })
    },
    {
        id: "vtrack",
        label: "Track vertical position",
        desc: "Elongated, and asked to follow a 60 Hz vertical sweep — chasing a " +
            "moving target with the same actuator that is holding it up.",
        duration: 0.13, kick: 0.6,
        shape: (u, T) => ({
            Ip: 145e3, R: 0.88, Z: 0.055 * Math.sin(2 * Math.PI * (u * T) / 0.055),
            kappa: 1.6, delta: 0.2
        })
    },
    {
        id: "morph",
        label: "Morph shape",
        desc: "Round to strongly elongated on a schedule. The plasma becomes " +
            "unstable partway through the manoeuvre, on the controller's own doing.",
        duration: 0.15, kick: 0.5,
        shape: (u) => {
            const s = clamp((u - 0.25) / 0.45, 0, 1);
            const e = s * s * (3 - 2 * s);
            return { Ip: 130e3 + 25e3 * e, R: 0.88, Z: 0, kappa: 1.15 + 0.8 * e, delta: 0.1 + 0.2 * e };
        }
    },
    {
        id: "negd",
        label: "Negative triangularity",
        desc: "δ ≈ −0.35 at κ ≈ 1.55. The shaping field has to be inverted while " +
            "the vertical instability carries on regardless.",
        duration: 0.11, kick: 0.6,
        shape: () => ({ Ip: 140e3, R: 0.88, Z: 0, kappa: 1.55, delta: -0.35 })
    },
    {
        id: "ipramp",
        label: "Current ramp",
        desc: "Push I_p from 95 to 165 kA by transformer action while holding the " +
            "shape. The ohmic coils are the only way to do it and they move the " +
            "plasma while they do.",
        duration: 0.17, kick: 0.4,
        shape: (u) => {
            const s = clamp((u - 0.15) / 0.6, 0, 1);
            return { Ip: 95e3 + 70e3 * (s * s * (3 - 2 * s)), R: 0.88, Z: 0, kappa: 1.5, delta: 0.2 };
        }
    },
    {
        id: "outward",
        label: "Radial excursion",
        desc: "Walk the magnetic axis 6 cm outward and back at fixed elongation. " +
            "Radial and vertical control share every coil, so this is a stability " +
            "test dressed up as a position test.",
        duration: 0.13, kick: 0.5,
        shape: (u) => ({
            Ip: 140e3, R: 0.88 + 0.06 * Math.sin(Math.PI * clamp((u - 0.15) / 0.7, 0, 1)),
            Z: 0, kappa: 1.55, delta: 0.2
        })
    },
    {
        id: "discharge",
        label: "Full discharge (demo)",
        desc: "Breakdown → current ramp → shape formation → hold → controlled " +
            "ramp-down, 1.2 s. Too long to train on; this is the scripted demo.",
        duration: 1.2, kick: 0.2, demo: true,
        /* Every rate here is inside what the machine can actually deliver, which
         * is not a cosmetic point. The ohmic transformer manages roughly
         * 3×10⁵ A/s of plasma current: the first version of this schedule asked
         * for 7.6×10⁵ A/s on the ramp-down, the current fell behind its
         * reference, the minor radius (which is slaved to I_p) went with it, the
         * equilibrium the shaping coils were holding stopped being an
         * equilibrium, and the discharge ended in a VDE 85% of the way through
         * every single time. A reference waveform the actuators cannot follow is
         * not a hard control problem, it is a badly written scenario. */
        shape: (u) => {
            let Ip, k, d;
            if (u < 0.40) {                       // breakdown, current ramp, shape formation
                const s = clamp(u / 0.40, 0, 1);
                Ip = 45e3 + 110e3 * (s * s * (3 - 2 * s));      // 229 kA/s
                k = 1.05 + 0.50 * s; d = 0.05 + 0.15 * s;
            } else if (u < 0.62) {                // flat-top hold
                Ip = 155e3; k = 1.55; d = 0.20;
            } else if (u < 0.75) {                // shape morph at constant current
                const s = (u - 0.62) / 0.13;
                Ip = 155e3; k = 1.55 + 0.30 * s; d = 0.20 + 0.12 * s;
            } else {                              // controlled ramp-down
                const s = (u - 0.75) / 0.25;
                const e = s * s * (3 - 2 * s);
                Ip = 155e3 - 80e3 * e;                          // 267 kA/s peak
                k = 1.85 - 0.70 * e; d = 0.32 - 0.22 * e;
            }
            return { Ip, R: 0.88, Z: 0, kappa: k, delta: d };
        }
    }
];

/* A live task: the config plus the machine-specific initial condition. */
class Task {
    constructor(def, mac, rng, opts) {
        this.def = def;
        this.id = def.id;
        this.label = def.label;
        this.duration = (opts && opts.duration) || def.duration;
        this.mac = mac;
        this._bnd = new Float64Array(N_BND * 2);
        this.level = (opts && opts.level) | 0;
        this.dif = difficultyOf(this.level);

        const s0 = this.shapeAt(0);
        // The ohmic circuits start with flux in the bank so they have swing left
        // in both directions; the fast coil starts at zero because it is a
        // control actuator, not an equilibrium one.
        const preset = new Float64Array(mac.nc);
        preset[16] = 6500; preset[17] = -2600; preset[18] = 0;
        const coils = solveEquilibriumCoils(mac, s0, preset);

        // A small deliberate error in the starting currents. The controller
        // therefore inherits a plasma that is already drifting, which is both
        // more honest and much better training signal than a perfect start.
        const kick = (opts && opts.kick != null ? opts.kick : def.kick) || 0;
        // 45 A against equilibrium currents of ~1-2 kA: a 2-4% field error, which
        // is a plausible shot-to-shot reproducibility error and enough to have
        // the plasma moving measurably within the first millisecond. Larger
        // values (the first version used 120 A) put the plasma past the fast
        // coil's authority before the controller has taken its first sample,
        // which measures the perturbation, not the controller.
        if (kick > 0 && rng) {
            const k = 45 * kick * this.dif.kick;
            for (let i = 0; i < 16; i++) coils[i] += gaussRand(rng) * k;
        }
        this.initial = {
            Ip: s0.Ip, R: s0.R, Z: s0.Z, kappa: s0.kappa, delta: s0.delta,
            coils: Array.from(coils)
        };
    }

    shapeAt(t) {
        const u = clamp(t / this.duration, 0, 1);
        const s = this.def.shape(u, this.duration);
        s.a = radiusFor(s.Ip);
        // Difficulty amplifies elongation ABOVE ROUND, so κ = 1.05 stays
        // essentially κ = 1.05 and κ = 1.75 climbs towards the machine limit.
        // The cap is the same one the plasma model enforces, so the requested
        // shape never asks for something the physics refuses to produce — a
        // target the plant cannot reach is an unbounded error term, not a
        // harder task.
        const g = this.dif.kappaGain;
        if (g > 0) s.kappa = Math.min(1 + (s.kappa - 1) * (1 + g), PLASMA.kappaMax * 0.96);
        return s;
    }

    targetAt(t) { return this.shapeAt(t); }

    targetBoundary(t, out) {
        const s = this.shapeAt(t);
        return boundaryPoints(s.R, s.Z, s.a, s.kappa, s.delta, out || this._bnd);
    }
}

function makeTask(idOrIndex, mac, rng, opts) {
    const def = typeof idOrIndex === "number"
        ? TASK_DEFS[clamp(idOrIndex | 0, 0, TASK_DEFS.length - 1)]
        : TASK_DEFS.find(d => d.id === idOrIndex) || TASK_DEFS[0];
    return new Task(def, mac || getMachine(), rng, opts);
}

/* The tasks a training generation is examined on. The demo discharge is
 * excluded: it is eight times longer than the others and would swamp the
 * generation's wall-clock for one episode's worth of selection signal. */
const TRAIN_TASKS = TASK_DEFS.filter(d => !d.demo).map(d => d.id);

if (typeof module !== "undefined") {
    module.exports = {
        TASK_DEFS, TRAIN_TASKS, Task, makeTask,
        solveEquilibriumCoils, equilibriumBz, fieldTargetsFor, radiusFor
    };
}
