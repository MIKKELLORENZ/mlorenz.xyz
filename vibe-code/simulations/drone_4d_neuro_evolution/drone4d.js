/* drone4d.js — a 10-DOF rigid body in four spatial dimensions: the airframe,
 * the sensor suite, and the fitness ledger.
 *
 * SI throughout. Physics at 120 Hz, control at 30 Hz. The net commands the
 * eight rotors directly; there is no attitude controller underneath it and
 * nothing about "hover", "level" or "up" is scripted anywhere.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY EIGHT ROTORS, AND WHY AT THE CORNERS OF A CUBE
 * ─────────────────────────────────────────────────────────────────────────
 * A 4D rigid body has 4 translational + C(4,2) = 6 rotational = 10 degrees of
 * freedom. A rotor is a scalar actuator: it produces thrust along the
 * airframe's thrust axis U and, by reaction to its own aerodynamic drag, a
 * torque in its spin plane. So N rotors give N control scalars, and the
 * question is what they can reach.
 *
 * All rotors thrust along body +U, so the force they can make is one number:
 * total thrust, always along U. Translation in the other three directions has
 * to come from tilting the whole airframe — exactly the underactuation that
 * makes a 3D quadrotor interesting, with three horizontal directions to tilt
 * toward instead of two.
 *
 * Put the rotors at the eight vertices of a cube in the 3-space orthogonal to
 * the thrust axis:
 *
 *     p(s) = (ARM/√3)·( s_R·e_R + s_F·e_F + s_A·e_A ),   s ∈ {−1,+1}³
 *
 * and give rotor s the spin plane orthogonal to its own arm (the Hodge dual of
 * p(s) taken inside that 3-space — a genuine single rotation plane, and one
 * that is perpendicular to the thrust axis, as a real propeller disc must be),
 * with spin direction σ(s) = s_R·s_F·s_A. Then the map from the eight rotor
 * thrusts f ∈ ℝ⁸ to (total thrust, 3 tilt torques, 3 heading torques) has rows
 *
 *     1,  s_R,  s_F,  s_A,  s_F·s_A,  s_R·s_A,  s_R·s_F
 *
 * — seven of the eight Walsh functions on {−1,+1}³. Walsh functions are
 * mutually ORTHOGONAL, so the 7×8 control matrix has rank 7 with a condition
 * number of exactly 1: every one of the seven controllable quantities can be
 * commanded independently and none of them is a weak direction. The single
 * unreachable combination is the eighth Walsh function s_R·s_F·s_A, the
 * "checkerboard" pattern, which produces no net force and no net torque at all.
 *
 * That is not a coincidence dressed up after the fact — it is the reason for
 * the cube. Any other rotor placement either loses rank (an octahedron, six
 * rotors on the ±axes, slaves each tilt torque to a heading torque: you cannot
 * lean without spinning) or wastes actuators. Seven controls for a 10-DOF body
 * is precisely the 3D quadrotor's bargain (four controls for a 6-DOF body)
 * carried up a dimension. test_math.js asserts the orthogonality.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE INERTIA IS FOUR NUMBERS, NOT SIX
 * ─────────────────────────────────────────────────────────────────────────
 * The six planes have six moments of inertia, but they are not free: they come
 * from the mass quadrupole J = Σ m x xᵀ as I_(a,b) = J_a + J_b (math4d.js).
 * Choosing six numbers independently would describe no physical body. Here
 *
 *     J = diag(0.015, 0.003, 0.015, 0.015)   kg·m²   over (R, U, F, A)
 *
 * which reproduces, exactly, the 3D reference quadrotor this project is built
 * from: 0.018 kg·m² in each of the three TILT planes (the planes containing
 * the thrust axis) and 0.030 kg·m² in each of the three HEADING planes. Mass
 * spread out in the horizontal 3-space and thin along the thrust axis — a
 * pancake, one dimension up. The 3D drone's IX = IZ = 0.018 / IY = 0.030 drops
 * out of it, so the attitude dynamics run on the same timescales as an airframe
 * already known to be flyable.
 *
 * Gearing follows the same logic. Per-rotor TMAX is set so that all eight
 * rotors at sigmoid(0) = 0.5 gives 10.8 N against 9.81 N of weight — the same
 * +0.99 N climb margin as the 3D drone, where a sweep showed that margin (not
 * its nominal value, but its size against the SPREAD across fresh brains) is
 * the single most sensitive number in the simulation. ARM is set so the tilt
 * torque per newton of thrust matches too: (ARM/√3)·4·TMAX = 1.25 N·m against
 * the 3D drone's 1.22 N·m, into the same 0.018 kg·m².
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE 63 SENSOR CHANNELS (→ 216 net inputs after the temporal window)
 * ─────────────────────────────────────────────────────────────────────────
 *    0-23  24 rangefinders, fixed in the BODY frame: the 8 axis directions
 *          ±e_R ±e_U ±e_F ±e_A and the 16 long diagonals (±1,±1,±1,±1)/2
 *   24-29  gyro — the angular velocity BIVECTOR, one rate per body plane
 *   30-33  accelerometer — body-frame specific force (no gravity term)
 *   34-37  unit 4-vector to the waypoint, body frame
 *      38  distance to the waypoint
 *   39-46  how fast each of the 8 rotors is actually spinning, after motor lag
 *   47-50  body-frame world-up: "which way is down", from the AHRS
 *   51-54  body-frame velocity
 *   55-58  body-frame world +x  ┐ a 4D compass. Gravity pins the thrust axis
 *   59-62  body-frame world +w  ┘ but leaves the 3 heading planes unobservable;
 *          two more world directions fix the remaining orientation completely.
 *
 * 8 OUTPUTS: rotor throttles, each 0..1, in the fixed corner order below.
 */
"use strict";

const G4 = 9.81;

const DRONE = {
    MASS: 1.0,
    /* mass quadrupole diag(J_R, J_U, J_F, J_A); plane inertias are J_a + J_b */
    J: [0.015, 0.003, 0.015, 0.015],
    ARM: 0.20,                  // m, hub to rotor (cube half-diagonal)
    TMAX: 2.70,                 // N per rotor at full throttle → TWR 2.20
    MOTOR_TAU: 0.05,            // s, first-order rotor spin-up
    KSPIN: 0.030,               // N·m of reaction torque per N of rotor thrust
    CD_LIN: 0.15, CD_QUAD: 0.12,
    /* Rotational damping — blade flapping and the drag of eight discs. Raised
     * from the 3D project's 0.03/0.02 after measuring WHY the population could
     * not stay airborne. Across 60 brains × 3 episodes the median death came at
     * 4.9 s with the airframe at 55° from level (uprightness 0.577), the single
     * commonest cause being the FLOOR at 28% — they took off, tipped over, and
     * fell back through the arming height. That is an attitude-control failure,
     * not a navigation one, and it is what three tilt planes instead of two
     * costs you: a fresh policy has to be lucky in three directions at once.
     *
     * A more docile airframe is a legitimate design choice rather than a thumb
     * on the scale — real multirotors vary enormously in how self-damping they
     * are, and nothing here stabilises the drone FOR it; the network still
     * commands eight rotors with no attitude loop underneath. Measured
     * head-to-head over ~20 generations, three configurations from an identical
     * seed:
     *
     *   baseline                          best 826  avg 330  air 3.8 s  100% off
     *   arming height 1.2 → 2.5 m         best 556  avg 222  air 2.5 s   80% off
     *   arming 2.5 m + this damping       best 918  avg 395  air 4.4 s  100% off
     *
     * The middle row is the informative one: raising the arming height ALONE is
     * a clear loss, because arming is also what starts airtime accruing, so it
     * moves the first rung of the ladder out of reach. The damping more than
     * pays for that, which is how we know it is the damping doing the work. */
    CANG_LIN: 0.08, CANG_QUAD: 0.05,
    RADIUS: 0.26,               // collision 4-ball radius
    /* 32 m, which is longer than the room's 30 m longest axis span ON PURPOSE:
     * it means the eight axis rangefinders ALWAYS return a real distance to a
     * wall, in all four dimensions, so the drone always knows where it is.
     *
     * At the 3D project's 14 m, measured from the spawn point, fourteen of the
     * twenty-four rangefinders read exactly zero — the walls were 15 m away and
     * simply out of range — so 28 of the 216 net inputs were dead, and the
     * drone was blind to the wall it was drifting into until roughly a second
     * before impact. That is a sensible design for a cluttered 3D room where
     * the interesting features are nearby obstacles. Here the only features are
     * the walls, and a policy cannot learn to stay inside a box it cannot
     * perceive. Extending the range is not making the task easier so much as
     * making it observable. */
    SENSOR_RANGE: 32,           // m
    /* Above this the gear is up, `armed` latches, airtime starts accruing and
     * the floor becomes lethal like every other surface. 2.5 m rather than the
     * 3D project's 1.2 m buys 2.2 m of altitude to recover a wobble in before
     * the floor kills — see CANG_LIN for the measurement that motivated it.
     * ROOM.WP_FLOOR rises with it to keep the skimming exploit closed: no
     * waypoint may be reachable from below the arming height, which needs
     * WP_FLOOR − WP_RADIUS > TAKEOFF_H (4.5 − 1.5 = 3.0 > 2.5 ✓). */
    TAKEOFF_H: 2.5,
    GYRO_MAX: 8,                // rad/s
    ACC_MAX: 25,                // m/s²
    VEL_MAX: 8,                 // m/s
    /* A 4-ball of radius r has volume ∝ r⁴, so the same 1.2 m radius that was a
     * fair target in 3D is a markedly harder one here — the drone has to null a
     * fourth error term to enter it. 1.5 m restores roughly the 3D difficulty
     * relative to the room size, and stays well under the 3.0 m WP_FLOOR so a
     * waypoint can never be clipped from the takeoff pad. */
    WP_RADIUS: 1.5,

    /* ---- fitness weights ---- */
    WP_REWARD: 1000,
    WP_SPEED_BONUS: 300, WP_SPEED_DECAY: 15,
    PROGRESS_W: 600,
    /* Controlled-flight seconds. The 3D project used 10/s capped at 200, sized
     * so that "take off and float" was a rung on the ladder rather than a
     * destination. In 4D that pricing left the population stuck: measured over
     * 100 generations, mean airtime sat flat at 4.0 s with a 100% crash rate,
     * because staying alive was worth 40 points against an average score of 250
     * while drifting hopefully toward the waypoint paid up to 600. There were
     * three tilt planes to keep still instead of two and no reason to bother.
     * Survival is now priced comparably to approach — see AIR_W_ALT in
     * train.js's --air flag, which is how these two were compared head to head. */
    AIR_W: 30, AIR_CAP: 540,
    TAKEOFF_BONUS: 120,
    CRASH_PEN: 100,             // small on purpose — the forfeited future is the real cost
    EFF_W: 5, EFF_SLACK: 1.35, EFF_CAP: 300,
    UPRIGHT_MIN: 0.3            // cos of tilt below which airtime stops accruing
};

/* Per-plane moment of inertia, derived — never hand-entered. */
const PLANE_I = PLANES.map(p => DRONE.J[p[0]] + DRONE.J[p[1]]);

/* ------------------------------------------------------- the eight rotors */
/* Corner order is fixed and load-bearing: output index i has sign bits
 * s_R = bit0, s_F = bit1, s_A = bit2, mapped +1 for a set bit. */
const N_ROTORS = 8;
const ROTORS = (function () {
    const c = DRONE.ARM / Math.sqrt(3);
    const inv3 = 1 / Math.sqrt(3);
    const out = [];
    for (let i = 0; i < 8; i++) {
        const sR = (i & 1) ? 1 : -1, sF = (i & 2) ? 1 : -1, sA = (i & 4) ? 1 : -1;
        const p = v4(0, 0, 0, 0);
        p[AX_R] = c * sR; p[AX_U] = 0; p[AX_F] = c * sF; p[AX_A] = c * sA;
        /* spin plane = Hodge dual of the arm direction n, taken inside
         * span(e_R, e_F, e_A) with orientation e_R∧e_F∧e_A:
         *     n_R ↦ e_F∧e_A     n_F ↦ e_A∧e_R = −e_R∧e_A     n_A ↦ e_R∧e_F
         * The result is a unit simple bivector orthogonal to the thrust axis,
         * i.e. a physically realisable propeller disc. */
        const S = new Float64Array(N_PLANES);
        S[5] = sR * inv3;    // (F,A)
        S[2] = -sF * inv3;   // (R,A)
        S[1] = sA * inv3;    // (R,F)

        /* Two orthonormal body vectors spanning that same spin plane — i.e. the
         * actual propeller disc, as a pair of directions rather than as a
         * bivector. Nothing in the physics needs them; the renderer does, and
         * it should draw the disc the airframe really has instead of inventing
         * a plausible-looking one. Built as the orthogonal complement of the
         * arm direction n inside span(R,F,A), so discA ∧ discB = ±S by
         * construction — test_math.js checks that it actually does. */
        const n = [sR * inv3, sF * inv3, sA * inv3];          // in (R,F,A)
        const h = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const norm = (u) => { const m = Math.hypot(u[0], u[1], u[2]); return [u[0] / m, u[1] / m, u[2] / m]; };
        const a3 = norm(cross(n, h));
        const b3 = cross(n, a3);
        const lift = (u) => { const q = v4(); q[AX_R] = u[0]; q[AX_F] = u[1]; q[AX_A] = u[2]; return q; };
        out.push({
            p, S, sigma: sR * sF * sA, s: [sR, sF, sA],
            discA: lift(a3), discB: lift(b3)
        });
    }
    return out;
})();

/* --------------------------------------------------- sensor ray directions */
/* 8 axis directions + 16 long diagonals = 24 unit 4-vectors, fixed in the body
 * frame so that sensor k always means "metres of clear air off THAT corner of
 * the airframe", whatever the drone's attitude. The room is a convex box with
 * flat walls, so a pencil ray is exact here and the cone-sampling that thin
 * obstacles demand is not needed. */
const SENSOR_DIRS = (function () {
    const dirs = [];
    for (let ax = 0; ax < 4; ax++) {
        for (const sgn of [1, -1]) {
            const d = v4(0, 0, 0, 0); d[ax] = sgn; dirs.push(d);
        }
    }
    for (let m = 0; m < 16; m++) {
        const d = v4((m & 1) ? 0.5 : -0.5, (m & 2) ? 0.5 : -0.5,
                     (m & 4) ? 0.5 : -0.5, (m & 8) ? 0.5 : -0.5);
        dirs.push(d);
    }
    return dirs;
})();
const SENSOR_N = SENSOR_DIRS.length;   // 24

/* ------------------------------------------------ temporal window definition */
/* Every channel is fed as several past control ticks, newest first, so the net
 * reads rates and trends with no recurrence. Slots are dense at the front where
 * a 30 Hz attitude loop lives and thin out to a third of a second back. */
const LAGS = [0, 1, 2, 3, 4, 6, 8, 10];
const NC = 63;
const DEPTH = new Uint8Array(NC);
(function () {
    const set = (a, b, d) => { for (let i = a; i <= b; i++) DEPTH[i] = d; };
    set(0, 23, 2);     // rays — range and closing rate
    set(24, 29, 6);    // gyro — the D term of the attitude loop, deep
    set(30, 33, 3);    // accelerometer
    set(34, 37, 3);    // waypoint direction
    set(38, 38, 4);    // waypoint distance — its rate is closing speed
    set(39, 46, 3);    // rotor spin — the actuator-lag pipeline
    set(47, 50, 8);    // gravity vector — catches slow attitude drift
    set(51, 54, 6);    // body velocity
    set(55, 58, 3);    // compass: world +x
    set(59, 62, 3);    // compass: world +w
})();
const MAXSLOT = LAGS.length;
const MAXHIST = LAGS[MAXSLOT - 1] + 1;
const NIN = DEPTH.reduce((a, d) => a + d, 0);       // 216
const NET_SIZES = [NIN, 48, 32, N_ROTORS];

function clamp4(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

class Drone {
    constructor(brain, idx) {
        this.brain = brain;
        this.idx = idx;
        this.pos = v4(); this.vel = v4();
        this.R = m4identity(new Float64Array(16));
        this.omega = new Float64Array(N_PLANES);    // body angular velocity bivector
        this.L = new Float64Array(N_PLANES);        // body angular momentum bivector
        this.acc = v4();
        this.spin = new Float64Array(N_ROTORS);
        this.out = new Float64Array(N_ROTORS);
        this.inputs = new Float32Array(NIN);
        this.rays = new Float32Array(SENSOR_N);
        this.histBuf = [];
        for (let i = 0; i < MAXHIST; i++) this.histBuf.push(new Float32Array(NC));
        /* scratch — allocated once, never in the hot loop */
        this._a = v4(); this._b = v4(); this._c = v4();
        this._tq = new Float64Array(N_PLANES);
        this._dL = new Float64Array(N_PLANES);
        this._cm = new Float64Array(N_PLANES);
        this._k = [0, 1, 2, 3].map(() => new Float64Array(N_PLANES));
        this._Ltmp = new Float64Array(N_PLANES);
        this._wtmp = new Float64Array(N_PLANES);
        this._wprev = new Float64Array(N_PLANES);
        this.reset(v4(), null);
    }

    reset(spawn, R0) {
        this.pos.set(spawn);
        this.vel.fill(0);
        if (R0) this.R.set(R0); else m4identity(this.R);
        this.omega.fill(0); this.L.fill(0);
        this.spin.fill(0); this.out.fill(0); this.acc.fill(0);

        this.alive = true;
        this.done = false;
        this.crashed = false;
        this.armed = false;
        this.grounded = true;
        this.timeLeft = 0;
        this.airTime = 0;
        this.flightTime = 0;
        this.peakY = 0;

        for (const h of this.histBuf) h.fill(0);
        this.histWrite = 0;

        this.wpIdx = 0;
        this.arrivals = 0;
        this.target = null;
        this.legStartTime = 0;
        this.legInitDist = 1;
        this.legDist = 0;
        this.bestDist = 1e9;
        this.fitScore = 0;
        this.trail = [];
    }

    setTarget(t, time) {
        this.target = t;
        this.legStartTime = time;
        this.legInitDist = Math.max(0.5, v4dist(t, this.pos));
        this.bestDist = this.legInitDist;
        this.legDist = 0;
    }

    distToTarget() { return this.target ? v4dist(this.target, this.pos) : 0; }

    /* --------------------------------------------- sensing + control (30 Hz) */
    control(world) {
        const cur = this.histBuf[this.histWrite];
        const p = this.pos, R = this.R, room = world.room, rng4 = DRONE.SENSOR_RANGE;
        const v = this._a;

        // ---- 0-23: rangefinders, body-fixed
        for (let i = 0; i < SENSOR_N; i++) {
            m4apply(R, SENSOR_DIRS[i], v);
            const d = room.rayDist(p, v, rng4, DRONE.RADIUS);
            const n = 1 - d / rng4;               // 0 = clear, 1 = touching
            cur[i] = n;
            this.rays[i] = n;
        }

        // ---- 24-29: gyro (body-plane rates)
        for (let k = 0; k < N_PLANES; k++) {
            cur[24 + k] = clamp4(this.omega[k] / DRONE.GYRO_MAX, -1.5, 1.5);
        }

        // ---- 30-33: accelerometer. Specific force, as a real IMU reports it:
        // thrust + drag, no gravity term, so free fall reads zero.
        for (let k = 0; k < 4; k++) cur[30 + k] = clamp4(this.acc[k] / DRONE.ACC_MAX, -1.5, 1.5);

        // ---- 34-38: the waypoint, in the body frame
        if (this.target) {
            const t = this.target, d = this._b;
            for (let k = 0; k < 4; k++) d[k] = t[k] - p[k];
            const dist = v4norm(d) || 1e-9;
            for (let k = 0; k < 4; k++) d[k] /= dist;
            m4applyT(R, d, v);
            cur[34] = v[0]; cur[35] = v[1]; cur[36] = v[2]; cur[37] = v[3];
            cur[38] = Math.min(1.5, dist / 20);
            if (dist < this.bestDist) this.bestDist = dist;
        } else {
            cur[34] = cur[35] = cur[36] = cur[37] = cur[38] = 0;
        }

        // ---- 39-46: rotor spin (post-lag), the actuator state actually reached
        for (let i = 0; i < N_ROTORS; i++) cur[39 + i] = this.spin[i];

        // ---- 47-50: which way is down, in the body frame. The accelerometer
        // alone cannot supply this — under thrust it measures specific force,
        // and a drone in a coordinated dive reads level.
        const dn = this._c; dn[0] = 0; dn[1] = -1; dn[2] = 0; dn[3] = 0;
        m4applyT(R, dn, v);
        cur[47] = v[0]; cur[48] = v[1]; cur[49] = v[2]; cur[50] = v[3];

        // ---- 51-54: body-frame velocity
        m4applyT(R, this.vel, v);
        for (let k = 0; k < 4; k++) cur[51 + k] = clamp4(v[k] / DRONE.VEL_MAX, -1.5, 1.5);

        // ---- 55-62: the 4D compass. World up (above) fixes the thrust axis but
        // says nothing about rotation WITHIN the 3-space orthogonal to it —
        // three whole degrees of freedom, the 4D generalisation of yaw. Two more
        // world directions in body coordinates close that gap; the fourth is
        // then determined, so there is no point spending channels on it.
        dn[0] = 1; dn[1] = 0; dn[2] = 0; dn[3] = 0;
        m4applyT(R, dn, v);
        cur[55] = v[0]; cur[56] = v[1]; cur[57] = v[2]; cur[58] = v[3];
        dn[0] = 0; dn[3] = 1;
        m4applyT(R, dn, v);
        cur[59] = v[0]; cur[60] = v[1]; cur[61] = v[2]; cur[62] = v[3];

        // ---- assemble the lag window. Slot 0 is a full block of all NC
        // channels (so the ray overlay can read inputs[0..23] directly); each
        // deeper slot appends only the channels whose depth reaches that far.
        const inp = this.inputs;
        let k = 0;
        for (let ch = 0; ch < NC; ch++) inp[k++] = cur[ch];
        for (let s = 1; s < MAXSLOT; s++) {
            const src = this.histBuf[(this.histWrite - LAGS[s] + MAXHIST) % MAXHIST];
            for (let ch = 0; ch < NC; ch++) if (DEPTH[ch] > s) inp[k++] = src[ch];
        }
        this.histWrite = (this.histWrite + 1) % MAXHIST;

        // Per-drone noise stream, seeded identically for every drone in the
        // episode: COMMON RANDOM NUMBERS. A single shared stream would advance
        // once per living drone per tick, so the noise an individual saw would
        // depend on how many rivals were still alive — two brains could not be
        // compared, and an elite could not reproduce its own score from one
        // generation to the next. Same seed for all means the whole fleet is
        // perturbed identically and the only difference left is the brain.
        const rng = this.noiseRng || world.noiseRng;
        if (world.opts.noise) {
            for (let i = 0; i < inp.length; i++) inp[i] += (rng() * 2 - 1) * 0.015;
        }

        // A null brain means something else is flying this airframe (the
        // hand-written autopilot, via World4D's pilot hook). The sensor block
        // above still runs, so the bookkeeping and the ray overlay are
        // identical either way and the two pilots are scored the same.
        if (!this.brain) return;
        const o = this.brain.forward(inp);
        for (let i = 0; i < N_ROTORS; i++) {
            let val = o[i];
            if (world.opts.noise) val += (rng() * 2 - 1) * 0.02;
            this.out[i] = clamp4(val, 0, 1);
        }
    }

    /* L̇ for a given angular momentum, with the rotor torque `tq` held fixed.
     * Air damping is a function of the current rate, so it is evaluated here
     * rather than folded into tq — otherwise the RK4 stages would all see the
     * damping of the step's starting state and the method would drop to
     * second order for no reason. */
    _dLdt(L, tq, out) {
        const w = this._wtmp;
        let wsp = 0;
        for (let j = 0; j < N_PLANES; j++) { w[j] = L[j] / PLANE_I[j]; wsp += w[j] * w[j]; }
        const kr = DRONE.CANG_LIN + DRONE.CANG_QUAD * Math.sqrt(wsp);
        commutatorBiv(w, L, out);
        for (let j = 0; j < N_PLANES; j++) out[j] = tq[j] - kr * w[j] - out[j];
        return out;
    }

    /* ------------------------------------------------------ physics (120 Hz) */
    step(dt, world) {
        if (!this.alive || this.done) return;
        const p = this.pos, vel = this.vel, R = this.R;

        // ---- rotors: first-order spin-up lag toward the command
        const kMot = 1 - Math.exp(-dt / DRONE.MOTOR_TAU);
        const tq = this._tq; tq.fill(0);
        let thrustSum = 0;
        const Fb = this._a;
        for (let i = 0; i < N_ROTORS; i++) {
            this.spin[i] += (this.out[i] - this.spin[i]) * kMot;
            const T = this.spin[i] * DRONE.TMAX;
            thrustSum += T;
            const rot = ROTORS[i];
            // lever torque, τ = F xᵀ − x Fᵀ with F = T·e_U at the rotor hub
            Fb[0] = 0; Fb[AX_U] = T; Fb[2] = 0; Fb[3] = 0;
            const lt = torqueBiv(rot.p, Fb, this._dL);
            for (let k = 0; k < N_PLANES; k++) tq[k] += lt[k];
            // reaction to the rotor's own aerodynamic drag, in its spin plane
            const rt = -rot.sigma * DRONE.KSPIN * T;
            for (let k = 0; k < N_PLANES; k++) tq[k] += rt * rot.S[k];
        }

        // ---- forces. Thrust along body +U; drag opposes airspeed.
        const fb = this._b;
        fb[0] = 0; fb[AX_U] = thrustSum; fb[2] = 0; fb[3] = 0;
        const fw = this._c;
        m4apply(R, fb, fw);
        const wind = world.wind;
        let a0 = vel[0] - wind[0], a1 = vel[1] - wind[1],
            a2 = vel[2] - wind[2], a3 = vel[3] - wind[3];
        const sp = Math.sqrt(a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3);
        const kd = DRONE.CD_LIN + DRONE.CD_QUAD * sp;
        fw[0] -= kd * a0; fw[1] -= kd * a1; fw[2] -= kd * a2; fw[3] -= kd * a3;

        // accelerometer sees specific force — everything except gravity
        const sf = this._a;
        for (let k = 0; k < 4; k++) sf[k] = fw[k] / DRONE.MASS;
        m4applyT(R, sf, this.acc);

        fw[1] -= DRONE.MASS * G4;      // gravity, world −y

        // ---- Euler's equation in 4D:  L̇ = τ − [Ω, L],  Ω_k = L_k / I_k,
        // integrated with RK4. The choice is not fussiness. The exact flow
        // conserves both Casimir invariants of so(4) — ‖L‖² and the Pfaffian —
        // because the commutator term is a coadjoint action, and an explicit
        // Euler step does not: measured on this airframe at 120 Hz it bled 8.6%
        // of ‖L‖² over a 30 s free-tumble, drift that halved cleanly with dt
        // (so: truncation error, not an algebra mistake). A drone whose angular
        // momentum quietly decays is a drone that is easier to fly than the one
        // being advertised, and the whole point of this project is that the
        // physics is real. RK4 puts the same 30 s drift below 1e-11.
        // Rotor torque is held constant across the step (it is only updated at
        // 30 Hz anyway); the velocity-dependent air damping is evaluated inside
        // the derivative, where it belongs.
        const k = this._k, Lt = this._Ltmp, wPrev = this._wprev;
        wPrev.set(this.omega);
        this._dLdt(this.L, tq, k[0]);
        for (let j = 0; j < N_PLANES; j++) Lt[j] = this.L[j] + 0.5 * dt * k[0][j];
        this._dLdt(Lt, tq, k[1]);
        for (let j = 0; j < N_PLANES; j++) Lt[j] = this.L[j] + 0.5 * dt * k[1][j];
        this._dLdt(Lt, tq, k[2]);
        for (let j = 0; j < N_PLANES; j++) Lt[j] = this.L[j] + dt * k[2][j];
        this._dLdt(Lt, tq, k[3]);
        for (let j = 0; j < N_PLANES; j++) {
            this.L[j] += (dt / 6) * (k[0][j] + 2 * k[1][j] + 2 * k[2][j] + k[3][j]);
            this.omega[j] = this.L[j] / PLANE_I[j];
        }
        // Advance the orientation on the MIDPOINT rate, ½(ω_before + ω_after),
        // not on ω_after. Cayley is a second-order step, but feeding it the
        // end-of-step rate is a first-order treatment of the coupling and drags
        // the whole rotational update down with it — measured, the space-frame
        // angular momentum error then fell only as dt instead of dt², which is
        // exactly the signature test_math.js checks for. Trapezoidal costs one
        // add per plane and restores second order.
        for (let j = 0; j < N_PLANES; j++) wPrev[j] = 0.5 * (wPrev[j] + this.omega[j]);
        integrateR(R, wPrev, dt);

        // ---- translate (semi-implicit)
        let moved = 0;
        for (let k = 0; k < 4; k++) {
            vel[k] += (fw[k] / DRONE.MASS) * dt;
            const d = vel[k] * dt;
            p[k] += d;
            moved += d * d;
        }
        this.legDist += Math.sqrt(moved);

        // ---- the pad. Until the drone has cleared TAKEOFF_H once, the floor
        // holds it up, bleeds sideways motion through the skids and damps
        // rotation. After that `armed` latches and the floor is lethal like
        // every other surface.
        if (!this.armed) {
            if (p[1] <= DRONE.RADIUS) {
                p[1] = DRONE.RADIUS;
                if (vel[1] < 0) vel[1] = 0;
                vel[0] *= 0.82; vel[2] *= 0.82; vel[3] *= 0.82;
                for (let k = 0; k < N_PLANES; k++) {
                    this.L[k] *= PLANE_IS_TILT[k] ? 0.86 : 0.92;
                    this.omega[k] = this.L[k] / PLANE_I[k];
                }
                this.grounded = true;
            } else {
                this.grounded = false;
            }
            if (p[1] > DRONE.TAKEOFF_H) { this.armed = true; this.grounded = false; }
        }

        if (p[1] > this.peakY) this.peakY = p[1];

        // ---- collision: instant elimination. No bump, no HP, no recovery.
        if (world.room.hits(p, DRONE.RADIUS, this.armed)) {
            this.alive = false; this.crashed = true; this.done = true;
            return;
        }

        if (this.armed) {
            this.flightTime += dt;
            // "controlled flight" only: airborne and within ~72° of level.
            // Without this gate a tumbling drone that happens to stay inside the
            // room farms the same airtime as one that is actually flying, and
            // the population learns to spin instead of to hover.
            if (R[4 + AX_U] > DRONE.UPRIGHT_MIN) this.airTime += dt;
        }
    }

    /* Live fitness. Waypoints reached ≫ closest approach on the current leg ≫
     * controlled airtime, with airtime capped well under one waypoint so
     * "take off and float" is a rung on the ladder and not a destination.
     * Leg progress uses the CLOSEST APPROACH ever achieved, never the current
     * distance, so orbiting the target or drifting back out earns nothing. The
     * path-efficiency charge is banked in World._arrive against legs actually
     * completed — charging it on the leg in progress would tax exactly the
     * exploratory flailing early generations need in order to find flight. */
    fitness() {
        let f = this.fitScore;
        f += Math.min(DRONE.AIR_CAP, DRONE.AIR_W * this.airTime);
        if (this.armed) f += DRONE.TAKEOFF_BONUS;
        if (this.crashed) f -= DRONE.CRASH_PEN;
        if (this.target) {
            f += clamp4(1 - this.bestDist / this.legInitDist, 0, 1) * DRONE.PROGRESS_W;
        }
        return f;
    }

    /* Body-frame up-vector tilt, for the HUD. */
    uprightness() { return this.R[4 + AX_U]; }
}

/* ─────────────────────────────────────────────────────── control allocation
 * The map from the eight rotor thrusts to (total thrust, torque bivector),
 * written out. With c = ARM/√3 and k = KSPIN/√3, and sᵢ the corner sign bits:
 *
 *     T      =  Σ fᵢ                     τ₁(R,F) = −k Σ fᵢ s_R s_F
 *     τ₀(R,U)=  c Σ fᵢ s_R               τ₂(R,A) = +k Σ fᵢ s_R s_A
 *     τ₃(U,F)= −c Σ fᵢ s_F               τ₅(F,A) = −k Σ fᵢ s_F s_A
 *     τ₄(U,A)= −c Σ fᵢ s_A
 *
 * The seven coefficient vectors are Walsh functions on {−1,+1}³ and are
 * mutually orthogonal with ⟨w,w⟩ = 8, so the pseudo-inverse is not a matrix
 * decomposition but a one-line projection — divide each by 8. The eighth Walsh
 * function s_R·s_F·s_A spans the null space: adding any multiple of the
 * checkerboard pattern to a rotor command changes neither the force nor the
 * torque. mixerInverse therefore returns the minimum-norm solution.
 *
 * Nothing in the simulation loop calls these — the network commands the eight
 * rotors directly and has to discover this structure for itself. They exist so
 * the claim can be tested (test_math.js) and so a hand-written autopilot can
 * establish that the environment is flyable at all (autopilot.js). */
const MIX_C = DRONE.ARM / Math.sqrt(3);
const MIX_K = DRONE.KSPIN / Math.sqrt(3);

function mixerForward(f, out) {
    const r = out || { T: 0, tau: new Float64Array(N_PLANES) };
    r.T = 0; r.tau.fill(0);
    for (let i = 0; i < N_ROTORS; i++) {
        const s = ROTORS[i].s, fi = f[i];
        r.T += fi;
        r.tau[0] += MIX_C * fi * s[0];
        r.tau[3] -= MIX_C * fi * s[1];
        r.tau[4] -= MIX_C * fi * s[2];
        r.tau[1] -= MIX_K * fi * s[0] * s[1];
        r.tau[2] += MIX_K * fi * s[0] * s[2];
        r.tau[5] -= MIX_K * fi * s[1] * s[2];
    }
    return r;
}

function mixerInverse(T, tau, out) {
    const f = out || new Float64Array(N_ROTORS);
    const a0 = tau[0] / MIX_C, a3 = -tau[3] / MIX_C, a4 = -tau[4] / MIX_C;
    const b1 = -tau[1] / MIX_K, b2 = tau[2] / MIX_K, b5 = -tau[5] / MIX_K;
    for (let i = 0; i < N_ROTORS; i++) {
        const s = ROTORS[i].s;
        f[i] = (T + a0 * s[0] + a3 * s[1] + a4 * s[2]
                  + b1 * s[0] * s[1] + b2 * s[0] * s[2] + b5 * s[1] * s[2]) / 8;
    }
    return f;
}

if (typeof module !== "undefined") {
    module.exports = {
        Drone, DRONE, PLANE_I, ROTORS, N_ROTORS, SENSOR_DIRS, SENSOR_N,
        NET_SIZES, NIN, NC, LAGS, DEPTH, G4,
        mixerForward, mixerInverse, MIX_C, MIX_K
    };
}
