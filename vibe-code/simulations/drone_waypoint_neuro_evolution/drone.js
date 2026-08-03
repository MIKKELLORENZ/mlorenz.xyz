/* drone.js — 6-DOF quadrotor physics, the sensor suite, and the fitness ledger.
 *
 * SI throughout: metres, seconds, newtons, kilograms, radians. Physics runs at
 * 120 Hz, the control loop at 30 Hz — the cadence an outer navigation loop on
 * a real flight controller would use. The net commands the four rotors
 * directly; there is no attitude controller underneath it. Nothing about
 * "hover", "level" or "up" is scripted. It has to evolve all of that.
 *
 * FRAME. Y-up, right-handed, matching three.js and room.js:
 *   body +x = right     body +y = thrust axis ("up")     body +z = forward
 * Attitude is a unit quaternion [w,x,y,z]; there are no Euler angles anywhere,
 * so nothing gimbal-locks when a drone flips.
 *
 * ROTORS. X layout, arms at 45°. Diagonal pairs spin the same way, so yaw comes
 * from the reaction-torque imbalance between the two pairs:
 *      2 (CW)   0 (CCW)          front (+z)
 *          \   /
 *           \ /                  roll  = rotors on one side of x
 *           / \                  pitch = rotors on one side of z
 *          /   \                 yaw   = (0+1) against (2+3)
 *      1 (CCW)  3 (CW)           rear (-z)
 *
 * TEMPORAL WINDOW. Every channel is fed as several past control ticks, newest
 * first, so the net reads rates and trends with no recurrence. The lag slots are
 * LAGS = [0,1,2,3,4,6,8,10,15,30] — ten slots, dense at the front where a
 * 30 Hz attitude loop lives, thinning out to a full second back where only slow
 * drift matters. Each channel takes the first DEPTH[ch] of those slots, so a
 * gyro trace goes eight slots deep (a quarter second of angular history) while
 * the distance-to-waypoint scalar takes four and the rays take three — position,
 * closing rate and closing acceleration on every obstacle, which is all an
 * avoidance policy needs.
 *
 * THE 55 CHANNELS (→ 226 net inputs after the window):
 *    0-31  32 distance rays, evenly spaced on the sphere in body frame
 *   32-34  gyroscope: body angular rate p (x), q (y), r (z)
 *   35-37  accelerometer: body-frame specific force x, y, z
 *   38-40  unit vector to the current waypoint, in body frame
 *      41  distance to the waypoint
 *   42-44  heading error to the waypoint bearing: sin, cos, and the signed
 *          normalised angle (sin/cos are unambiguous around the wrap; the raw
 *          angle is linear in the error, which is what a P term wants)
 *   45-48  how fast each rotor is actually spinning, after the motor lag
 *   49-51  body-frame gravity ("which way is down") from the AHRS
 *   52-54  body-frame velocity
 *
 * 4 OUTPUTS: rotor 0, 1, 2, 3 throttle, each 0..1.
 */
"use strict";

const G = 9.81;

const DRONE = {
    MASS: 1.0,                  // kg — a 250 mm class quad with a battery
    IX: 0.018, IY: 0.030, IZ: 0.018,   // kg·m², yaw axis (Y) heaviest
    ARM: 0.16,                  // m, hub to rotor
    // Geared so that all four rotors at sigmoid(0) = 0.5 is a modest climb:
    // 10.8 N against 9.81 N of weight. Combined with nn.js's near-zero output
    // init, a fresh random brain leaves the pad and drifts upward instead of
    // flipping, which is what gives generation 1 something to select on. It
    // will reach the ceiling in a few seconds and die, but it dies with a
    // positive score and a clear gradient — more airtime, more points — toward
    // throttling back.
    //
    // This is the most sensitive number in the file, and it is far more
    // sensitive than it looks, because what matters is the climb margin against
    // the SPREAD of that margin across fresh brains. Measured, 32 random brains
    // × 6 seeds, fraction that left the ground / that reached the arming height:
    //
    //     TMAX   margin      left ground   armed   mean airtime
    //     5.40   +0.99 N        100%        93%       2.33 s
    //     5.20   +0.59 N         95%        47%       1.27 s
    //     5.00   +0.19 N         19%         4%       0.12 s
    //     4.90   −0.01 N          1%         1%       0.02 s
    //
    // A 0.19 N margin looks like a gentle climb and is in fact a coin flip: the
    // spread across the output layer swamps it and four fifths of the
    // population never leaves the pad. Do not shave this without re-running
    // that sweep. Going the other way is no safer — at 5.5 the default climb is
    // brisk enough that takeoff correlates with hitting the ceiling, and the
    // population evolves to sit still.
    TMAX: 5.4,                  // N per rotor at full throttle (TWR ≈ 2.2)
    MOTOR_TAU: 0.05,            // s, first-order rotor spin-up
    KYAW: 0.022,                // N·m of yaw reaction per N of rotor thrust
    CD_LIN: 0.15, CD_QUAD: 0.12,       // translational drag
    CANG_LIN: 0.03, CANG_QUAD: 0.02,   // rotational damping (blade flapping)
    RADIUS: 0.22,               // collision sphere (prop tip to prop tip / 2)
    SENSOR_N: 32,
    SENSOR_RANGE: 12,           // m
    // Each sensor is a cone sampled with this many rays at this half-angle,
    // and every surface is grown by the collision radius before it is measured,
    // so a reading means "metres until I hit this". See sensorBeams() in
    // room.js for why a pencil-thin ray made stage 1 unlearnable.
    BEAM_SAMPLES: 4,
    BEAM_HALF_ANGLE: 18 * Math.PI / 180,
    // Above this the gear is up and the floor becomes lethal like every other
    // surface. Two failure modes bracket this number and both were measured:
    //
    //  · too high (0.7 m) and a population learns to skim the room just under
    //    it, collecting approach credit and clipping low waypoints while
    //    staying technically "not yet taken off" and immune to the floor
    //  · too low (0.45 m) and the survivable window between arming and dying is
    //    23 cm, so the very first thing evolution has to solve is "never sink
    //    more than a hand's width" — a random policy essentially never does,
    //    and mean airtime sat flat at 1.5 s for 30 generations
    //
    // 1.2 m gives a metre of slack to bob in while learning altitude hold. The
    // skimming route is closed from the other end instead: room.js never places
    // a waypoint below WP_FLOOR, and WP_FLOOR − TAKEOFF_H is wider than the
    // arrival radius, so nothing down there can be reached.
    TAKEOFF_H: 1.2,
    // sensor normalisers: divide, then clamp, so a saturated channel still
    // carries its sign instead of folding back on itself
    GYRO_MAX: 8,                // rad/s
    ACC_MAX: 25,                // m/s²
    VEL_MAX: 8,                 // m/s
    WP_RADIUS: 1.2,             // m — inside this counts as reached

    /* ---- fitness weights (see fitness() for the reasoning) ---- */
    WP_REWARD: 1000,
    WP_SPEED_BONUS: 300, WP_SPEED_DECAY: 15,   // bonus - decay·legSeconds, floored at 0
    PROGRESS_W: 600,
    AIR_W: 10, AIR_CAP: 200,    // controlled-flight seconds, capped well under one waypoint
    TAKEOFF_BONUS: 120,
    // Deliberately small. The real cost of a crash is the forfeited future —
    // every remaining second of clock and every waypoint still to come — and
    // that cost grows by itself as brains get better. A large fixed penalty
    // prices the crash before there is any future to forfeit, and generation 1
    // correctly concludes that the safest move is to never leave the pad. At
    // 300 the population's takeoff rate fell from 70% to 5% over 20 gens.
    CRASH_PEN: 100,
    EFF_W: 5, EFF_SLACK: 1.35, EFF_CAP: 300,
    UPRIGHT_MIN: 0.3            // cos of tilt below which airtime stops accruing
};

/* Rotor positions in the body frame and their yaw-reaction sign. */
const A = DRONE.ARM * Math.SQRT1_2;
const ROTORS = [
    { x: +A, z: +A, yaw: +1 },   // 0 front-right, CCW
    { x: -A, z: -A, yaw: +1 },   // 1 rear-left,   CCW
    { x: -A, z: +A, yaw: -1 },   // 2 front-left,  CW
    { x: +A, z: -A, yaw: -1 }    // 3 rear-right,  CW
];

/* ------------------------------------------------ temporal window definition */
const LAGS = [0, 1, 2, 3, 4, 6, 8, 10, 15, 30];   // control ticks back
const NC = 55;
const DEPTH = new Uint8Array(NC);
(function () {
    const set = (a, b, d) => { for (let i = a; i <= b; i++) DEPTH[i] = d; };
    set(0, 31, 3);     // rays — range, closing rate, closing acceleration
    set(32, 34, 8);    // gyro — the D term of the attitude loop, deep
    set(35, 37, 4);    // accelerometer
    set(38, 40, 3);    // waypoint direction
    set(41, 41, 4);    // waypoint distance — slow, but its rate is closing speed
    set(42, 44, 3);    // heading error
    set(45, 48, 6);    // rotor spin — the actuator-lag pipeline
    set(49, 51, 10);   // gravity vector — full second, catches slow attitude drift
    set(52, 54, 6);    // body velocity
})();
const MAXSLOT = LAGS.length;
const MAXHIST = LAGS[MAXSLOT - 1] + 1;               // ring-buffer length
const NIN = DEPTH.reduce((a, d) => a + d, 0);        // 226
const NET_SIZES = [NIN, 40, 24, 4];

/* Beam directions: SENSOR_N cones × BEAM_SAMPLES rays each, axis first. The
 * renderer draws only the axis of each cone (stride BEAM_SAMPLES). */
const SENSOR_DIRS = sensorBeams(DRONE.SENSOR_N, DRONE.BEAM_SAMPLES, DRONE.BEAM_HALF_ANGLE);
const BEAM_STRIDE = DRONE.BEAM_SAMPLES * 3;

function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/* ------------------------------------------------------------- quaternions */
/* Rotate a vector body → world. q = [w,x,y,z], unit. */
function qRot(q, vx, vy, vz, out) {
    const w = q[0], x = q[1], y = q[2], z = q[3];
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    out[0] = vx + w * tx + (y * tz - z * ty);
    out[1] = vy + w * ty + (z * tx - x * tz);
    out[2] = vz + w * tz + (x * ty - y * tx);
    return out;
}
/* Rotate a vector world → body (the conjugate rotation). */
function qRotInv(q, vx, vy, vz, out) {
    const w = q[0], x = -q[1], y = -q[2], z = -q[3];
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    out[0] = vx + w * tx + (y * tz - z * ty);
    out[1] = vy + w * ty + (z * tx - x * tz);
    out[2] = vz + w * tz + (x * ty - y * tx);
    return out;
}
/* q ← normalize(q + ½ dt · q ⊗ (0, ω_body)) */
function qIntegrate(q, wx, wy, wz, dt) {
    const w = q[0], x = q[1], y = q[2], z = q[3];
    const h = 0.5 * dt;
    let nw = w + h * (-x * wx - y * wy - z * wz);
    let nx = x + h * (w * wx + y * wz - z * wy);
    let ny = y + h * (w * wy - x * wz + z * wx);
    let nz = z + h * (w * wz + x * wy - y * wx);
    const n = Math.hypot(nw, nx, ny, nz) || 1;
    q[0] = nw / n; q[1] = nx / n; q[2] = ny / n; q[3] = nz / n;
}

class Drone {
    constructor(brain, idx) {
        this.brain = brain;
        this.idx = idx;
        this.reset(0, 0, 0, 0);
    }

    reset(x, y, z, yaw) {
        this.pos = new Float64Array([x, y, z]);
        this.vel = new Float64Array([0, 0, 0]);
        this.omega = new Float64Array([0, 0, 0]);       // body angular rate
        const hy = (yaw || 0) * 0.5;
        this.q = new Float64Array([Math.cos(hy), 0, Math.sin(hy), 0]);   // yaw about +y
        this.spin = new Float64Array(4);                // actual rotor state, 0..1
        this.out = new Float64Array(4);                 // commanded by the net
        this.acc = new Float64Array([0, 0, 0]);         // body specific force

        this.alive = true;
        this.done = false;          // clock ran out — frozen, score locked
        this.crashed = false;
        this.armed = false;         // has cleared TAKEOFF_H at least once
        this.grounded = true;
        this.timeLeft = 0;
        this.airTime = 0;           // seconds of *controlled* flight (upright, airborne)
        this.flightTime = 0;        // seconds since takeoff, controlled or not
        this.peakY = 0;

        this.inputs = new Float32Array(NIN);
        this.rays = new Float32Array(DRONE.SENSOR_N);   // normalised, for the overlay
        this.histBuf = [];
        for (let i = 0; i < MAXHIST; i++) this.histBuf.push(new Float32Array(NC));
        this.histWrite = 0;

        // mission / scoring
        this.wpIdx = 0;
        this.arrivals = 0;
        this.target = null;
        this.legStartTime = 0;
        this.legInitDist = 1;
        this.legDist = 0;           // odometer for this leg
        this.bestDist = 1e9;        // closest approach on this leg
        this.fitScore = 0;          // banked from completed legs
        this.trail = [];

        this._v3 = new Float64Array(3);
        this._v3b = new Float64Array(3);
    }

    setTarget(t, time) {
        this.target = t;
        this.legStartTime = time;
        this.legInitDist = Math.max(0.5, Math.hypot(
            t[0] - this.pos[0], t[1] - this.pos[1], t[2] - this.pos[2]));
        this.bestDist = this.legInitDist;
        this.legDist = 0;
    }

    distToTarget() {
        if (!this.target) return 0;
        return Math.hypot(this.target[0] - this.pos[0],
                          this.target[1] - this.pos[1],
                          this.target[2] - this.pos[2]);
    }

    /* --------------------------------------------- sensing + control (30 Hz) */
    control(world) {
        const cur = this.histBuf[this.histWrite];
        const p = this.pos, q = this.q, R = DRONE.SENSOR_RANGE;
        const room = world.room;
        const v = this._v3;

        // ---- 0-31: the distance sensors. Beam directions are fixed in the BODY
        // frame, so sensor k always means "k metres of air off that corner of
        // the airframe" no matter how the drone is oriented — the net can learn
        // a stable map from sensor index to evasive action. Rotating them with
        // the hull every tick is the whole point: this is what a rangefinder
        // array bolted to the airframe would see.
        //
        // Each sensor takes the minimum over its cone, and every surface is
        // inflated by the collision radius first, so the reading is the distance
        // at which THIS DRONE would make contact.
        for (let i = 0; i < DRONE.SENSOR_N; i++) {
            let best = R;
            const base = i * BEAM_STRIDE;
            for (let s = 0; s < DRONE.BEAM_SAMPLES; s++) {
                const k = base + s * 3;
                qRot(q, SENSOR_DIRS[k], SENSOR_DIRS[k + 1], SENSOR_DIRS[k + 2], v);
                const d = room.rayDist(p[0], p[1], p[2], v[0], v[1], v[2], best, DRONE.RADIUS);
                if (d < best) best = d;
            }
            const n = 1 - best / R;                    // 0 = clear, 1 = touching
            cur[i] = n;
            this.rays[i] = n;
        }

        // ---- 32-34: gyroscope (body rates)
        cur[32] = clamp(this.omega[0] / DRONE.GYRO_MAX, -1.5, 1.5);
        cur[33] = clamp(this.omega[1] / DRONE.GYRO_MAX, -1.5, 1.5);
        cur[34] = clamp(this.omega[2] / DRONE.GYRO_MAX, -1.5, 1.5);

        // ---- 35-37: accelerometer (body specific force, as an IMU reports it:
        // thrust + drag, no gravity term — free fall reads zero)
        cur[35] = clamp(this.acc[0] / DRONE.ACC_MAX, -1.5, 1.5);
        cur[36] = clamp(this.acc[1] / DRONE.ACC_MAX, -1.5, 1.5);
        cur[37] = clamp(this.acc[2] / DRONE.ACC_MAX, -1.5, 1.5);

        // ---- 38-44: the waypoint, in the body frame
        if (this.target) {
            const dx = this.target[0] - p[0], dy = this.target[1] - p[1], dz = this.target[2] - p[2];
            const dist = Math.hypot(dx, dy, dz) || 1e-6;
            qRotInv(q, dx / dist, dy / dist, dz / dist, v);
            cur[38] = v[0]; cur[39] = v[1]; cur[40] = v[2];
            cur[41] = Math.min(1.5, dist / 20);
            if (dist < this.bestDist) this.bestDist = dist;
            // heading error: the bearing to the target on the horizontal plane
            // against where the nose actually points, both in world terms
            const fwd = qRot(q, 0, 0, 1, this._v3b);
            const err = wrapPi(Math.atan2(dx, dz) - Math.atan2(fwd[0], fwd[2]));
            cur[42] = Math.sin(err);
            cur[43] = Math.cos(err);
            cur[44] = err / Math.PI;
        } else {
            cur[38] = cur[39] = cur[40] = cur[41] = cur[42] = cur[44] = 0;
            cur[43] = 1;
        }

        // ---- 45-48: rotor spin (post-lag), the actuator state the net commanded
        for (let i = 0; i < 4; i++) cur[45 + i] = this.spin[i];

        // ---- 49-51: which way is down, in the body frame. An AHRS gives this;
        // the accelerometer alone cannot, because under thrust it measures
        // specific force, not gravity, and a drone in a coordinated dive reads
        // level. Without it the policy is blind to attitude exactly when it is
        // manoeuvring, which is exactly when attitude matters.
        qRotInv(q, 0, -1, 0, v);
        cur[49] = v[0]; cur[50] = v[1]; cur[51] = v[2];

        // ---- 52-54: body-frame velocity
        qRotInv(q, this.vel[0], this.vel[1], this.vel[2], v);
        cur[52] = clamp(v[0] / DRONE.VEL_MAX, -1.5, 1.5);
        cur[53] = clamp(v[1] / DRONE.VEL_MAX, -1.5, 1.5);
        cur[54] = clamp(v[2] / DRONE.VEL_MAX, -1.5, 1.5);

        // ---- assemble the lag window. Slot 0 is a full block of all NC
        // channels (so the ray overlay can read inp[0..31] directly); each
        // deeper slot appends only the channels whose depth reaches that far.
        const inp = this.inputs;
        let k = 0;
        for (let ch = 0; ch < NC; ch++) inp[k++] = cur[ch];
        for (let s = 1; s < MAXSLOT; s++) {
            const src = this.histBuf[(this.histWrite - LAGS[s] + MAXHIST) % MAXHIST];
            for (let ch = 0; ch < NC; ch++) if (DEPTH[ch] > s) inp[k++] = src[ch];
        }
        this.histWrite = (this.histWrite + 1) % MAXHIST;

        const rng = world.noiseRng;
        if (world.opts.noise) {
            for (let i = 0; i < inp.length; i++) inp[i] += (rng() * 2 - 1) * 0.015;
        }

        const o = this.brain.forward(inp);
        for (let i = 0; i < 4; i++) {
            let val = o[i];
            if (world.opts.noise) val += (rng() * 2 - 1) * 0.02;
            this.out[i] = clamp(val, 0, 1);
        }
    }

    /* ------------------------------------------------------ physics (120 Hz) */
    step(dt, world) {
        if (!this.alive || this.done) return;
        const p = this.pos, vel = this.vel, w = this.omega, q = this.q;

        // rotor spin-up lag (first order toward the command)
        const kMot = 1 - Math.exp(-dt / DRONE.MOTOR_TAU);
        let thrustSum = 0, tx = 0, ty = 0, tz = 0;
        for (let i = 0; i < 4; i++) {
            this.spin[i] += (this.out[i] - this.spin[i]) * kMot;
            const T = this.spin[i] * DRONE.TMAX;
            thrustSum += T;
            // torque = r × F with F = (0, T, 0)
            tx += -ROTORS[i].z * T;
            tz += ROTORS[i].x * T;
            ty += ROTORS[i].yaw * DRONE.KYAW * T;
        }

        // ---- forces. Thrust acts along body +y; drag opposes airspeed.
        const v = this._v3;
        qRot(q, 0, thrustSum, 0, v);
        let fx = v[0], fy = v[1], fz = v[2];
        const ax = vel[0] - world.wind[0], ay = vel[1] - world.wind[1], az = vel[2] - world.wind[2];
        const sp = Math.hypot(ax, ay, az);
        const kd = DRONE.CD_LIN + DRONE.CD_QUAD * sp;
        const dxF = -kd * ax, dyF = -kd * ay, dzF = -kd * az;
        fx += dxF; fy += dyF; fz += dzF;

        // accelerometer sees specific force — everything except gravity
        qRotInv(q, fx / DRONE.MASS, fy / DRONE.MASS, fz / DRONE.MASS, this.acc);

        fy -= DRONE.MASS * G;

        // ---- torques: rotor differentials, air damping, gyroscopic coupling
        const wsp = Math.hypot(w[0], w[1], w[2]);
        const kr = DRONE.CANG_LIN + DRONE.CANG_QUAD * wsp;
        tx -= kr * w[0]; ty -= kr * w[1]; tz -= kr * w[2];
        const Ix = DRONE.IX, Iy = DRONE.IY, Iz = DRONE.IZ;
        // I·ω̇ = τ − ω × (I·ω)
        const dwx = (tx - (w[1] * (Iz * w[2]) - w[2] * (Iy * w[1]))) / Ix;
        const dwy = (ty - (w[2] * (Ix * w[0]) - w[0] * (Iz * w[2]))) / Iy;
        const dwz = (tz - (w[0] * (Iy * w[1]) - w[1] * (Ix * w[0]))) / Iz;

        // ---- integrate (semi-implicit)
        vel[0] += (fx / DRONE.MASS) * dt;
        vel[1] += (fy / DRONE.MASS) * dt;
        vel[2] += (fz / DRONE.MASS) * dt;
        w[0] += dwx * dt; w[1] += dwy * dt; w[2] += dwz * dt;
        qIntegrate(q, w[0], w[1], w[2], dt);

        const ox = p[0], oy = p[1], oz = p[2];
        p[0] += vel[0] * dt; p[1] += vel[1] * dt; p[2] += vel[2] * dt;

        // ---- the pad. Before the drone has ever cleared TAKEOFF_H the floor is
        // a landing pad: it holds the drone up, bleeds sideways motion through
        // the skids, and damps rotation. Once it has climbed, `armed` latches on
        // and the floor becomes just another lethal surface.
        if (!this.armed) {
            if (p[1] <= DRONE.RADIUS) {
                p[1] = DRONE.RADIUS;
                if (vel[1] < 0) vel[1] = 0;
                vel[0] *= 0.82; vel[2] *= 0.82;          // skid friction
                w[0] *= 0.86; w[1] *= 0.92; w[2] *= 0.86;
                this.grounded = true;
            } else {
                this.grounded = false;
            }
            if (p[1] > DRONE.TAKEOFF_H) { this.armed = true; this.grounded = false; }
        }

        if (p[1] > this.peakY) this.peakY = p[1];
        this.legDist += Math.hypot(p[0] - ox, p[1] - oy, p[2] - oz);

        // ---- collision: instant elimination, per the brief. There is no bump,
        // no HP, no recovery — a wall, the ceiling, a pillar or (once armed) the
        // floor ends the flight where it happened, and every waypoint the drone
        // might still have reached is forfeit. That forfeiture is most of the
        // deterrent; CRASH_PEN only breaks the tie against sitting on the pad.
        if (world.room.hits(p[0], p[1], p[2], DRONE.RADIUS, this.armed)) {
            this.alive = false;
            this.crashed = true;
            this.done = true;
            return;
        }

        if (this.armed) {
            this.flightTime += dt;
            // "controlled flight" only: airborne and within ~72° of level.
            // Without the upright gate a tumbling drone that happens to stay
            // inside the room farms the same airtime as one that is actually
            // flying, and the population learns to spin instead of to hover.
            const up = qRot(q, 0, 1, 0, this._v3b);
            if (up[1] > DRONE.UPRIGHT_MIN) this.airTime += dt;
        }
    }

    /* Live fitness. Priority order: waypoints reached ≫ closest approach on the
     * current leg ≫ controlled airtime. Everything above the airtime floor has
     * to be *earned by getting somewhere*:
     *
     *   · airtime is capped at AIR_CAP (20 s of hovering = a fifth of one
     *     waypoint), so "take off and float" is a rung on the ladder, not a
     *     destination — and the drone's own clock runs out while it does it
     *   · leg progress is the CLOSEST APPROACH ever achieved, never the current
     *     distance, so orbiting the target or drifting back out earns nothing
     *   · a crash costs CRASH_PEN *and* every future waypoint
     *
     * The path-efficiency charge lives in World._arrive, not here: it is banked
     * against legs the drone actually COMPLETED. Charging it on the leg in
     * progress taxes exactly the exploratory flailing that early generations
     * have to do to discover flight at all, and there is no distance reward
     * here for it to be guarding against anyway.
     */
    fitness() {
        let f = this.fitScore;
        f += Math.min(DRONE.AIR_CAP, DRONE.AIR_W * this.airTime);
        if (this.armed) f += DRONE.TAKEOFF_BONUS;
        if (this.crashed) f -= DRONE.CRASH_PEN;
        if (this.target) {
            f += clamp(1 - this.bestDist / this.legInitDist, 0, 1) * DRONE.PROGRESS_W;
        }
        return f;
    }
}

if (typeof module !== "undefined") {
    module.exports = {
        Drone, DRONE, NET_SIZES, NIN, NC, LAGS, DEPTH, ROTORS, SENSOR_DIRS, BEAM_STRIDE,
        qRot, qRotInv, qIntegrate, wrapPi, G
    };
}
