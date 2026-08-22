/* autopilot.js — a hand-written 4D flight controller. Nothing here is evolved.
 *
 * WHY THIS EXISTS. When a genetic algorithm fails to learn a task, the failure
 * looks identical whether the task is hard, the reward is broken, or the task
 * is physically impossible. The cheapest way to tell those apart is to write a
 * dumb controller first and see whether IT can fly. If a textbook cascaded PD
 * loop reaches 4D waypoints, then the airframe is controllable, the mixer is
 * right, the arrival test is satisfiable and the room is navigable — and any
 * subsequent trouble is a search problem, not a physics problem.
 *
 * It is also the honest answer to "does the math check out": this controller
 * derives its rotor commands from the closed-form control allocation in
 * drone4d.js, using nothing but the drone's true state, and it flies.
 *
 * THE CASCADE, and where 4D changes it:
 *
 *   position → desired acceleration      unchanged in form; 4 components
 *   desired acceleration → thrust        unchanged; thrust is a scalar
 *   desired acceleration → attitude      THIS is where the dimension shows up
 *   attitude error → torque              a bivector, not a vector
 *   torque → rotor thrusts               the Walsh pseudo-inverse
 *
 * In 3D you extract a desired thrust direction and then need the rotation
 * taking the body's current thrust axis onto it — a rotation about the axis
 * u_cur × u_des. In 4D there is no cross product and no axis, but the object
 * you actually wanted was never the axis: it is the PLANE spanned by u_cur and
 * u_des, and that plane exists in every dimension. Build the orthonormal pair
 * (a, b) spanning it and the correcting angular velocity is the bivector
 * ω·(b aᵀ − a bᵀ), which rotates a toward b and nothing else. That single
 * substitution — axis → plane — is the whole difference.
 *
 * The three heading planes (rotations inside the 3-space orthogonal to the
 * thrust axis) are simply damped to zero. They do not affect where the drone
 * goes, so there is no reference to track; leaving them undamped just lets the
 * airframe spin, which is untidy but not unstable.
 */
"use strict";

const AP = {
    KP_POS: 0.9,          // 1/s² per metre of position error
    KD_POS: 1.9,          // 1/s  per m/s of velocity
    A_MAX: 7.0,           // m/s² horizontal acceleration authority we allow it
    V_MAX: 5.5,           // m/s — position error is clamped to this × KD/KP
    MAX_TILT: 0.62,       // rad, ~35° — beyond this thrust stops holding altitude
    KP_ATT: 9.0,          // rad/s of commanded rate per rad of tilt error
    KD_ATT: 0.85,         // torque per (rad/s of rate error) × plane inertia
    RATE_MAX: 6.0,        // rad/s cap on the commanded tilt rate
    KD_HEAD: 2.2          // heading-plane damping
};

class Autopilot4D {
    constructor(gains) {
        this.g = Object.assign({}, AP, gains || {});
        this._u = v4(); this._ud = v4(); this._fd = v4(); this._e = v4();
        this._b = v4();
        this._Ow = new Float64Array(16);
        this._tmp = new Float64Array(16);
        this._Ob = new Float64Array(16);
        this._tau = new Float64Array(N_PLANES);
        this._wdes = new Float64Array(N_PLANES);
        this._f = new Float64Array(N_ROTORS);
    }

    /* Writes throttles into drone.out. Called at the control rate. */
    control(d, target) {
        const g = this.g, R = d.R, pos = d.pos, vel = d.vel;

        // ---- 1. position → desired world acceleration -----------------------
        const e = this._e;
        let en = 0;
        for (let k = 0; k < 4; k++) { e[k] = target[k] - pos[k]; en += e[k] * e[k]; }
        en = Math.sqrt(en);
        // Clamp the error so a distant waypoint asks for a cruise speed, not an
        // impossible acceleration — the standard trick that keeps a P term from
        // saturating on long legs.
        const lim = g.V_MAX * g.KD_POS / g.KP_POS;
        const sc = en > lim ? lim / en : 1;

        const fd = this._fd;
        let hmag = 0;
        for (let k = 0; k < 4; k++) {
            let a = g.KP_POS * e[k] * sc - g.KD_POS * vel[k];
            if (k !== 1) { hmag += a * a; }
            fd[k] = a;
        }
        // cap horizontal demand, then add the gravity term
        hmag = Math.sqrt(hmag);
        if (hmag > g.A_MAX) {
            const s = g.A_MAX / hmag;
            fd[0] *= s; fd[2] *= s; fd[3] *= s;
        }
        fd[1] += G4;
        for (let k = 0; k < 4; k++) fd[k] *= DRONE.MASS;

        // ---- 2. desired thrust direction, tilt-limited ----------------------
        const ud = this._ud;
        ud.set(fd);
        let n = v4norm(ud) || 1e-9;
        for (let k = 0; k < 4; k++) ud[k] /= n;
        // Limit the angle from vertical. Beyond ~35° the vertical component of
        // thrust can no longer hold the drone up and the position loop starts
        // trading altitude for horizontal speed.
        const cosT = Math.cos(g.MAX_TILT);
        if (ud[1] < cosT) {
            let h = Math.sqrt(ud[0] * ud[0] + ud[2] * ud[2] + ud[3] * ud[3]) || 1e-9;
            const want = Math.sin(g.MAX_TILT) / h;
            ud[0] *= want; ud[2] *= want; ud[3] *= want;
            ud[1] = cosT;
        }

        // ---- 3. total thrust: project the demand onto where thrust ACTUALLY
        // points, so a tilted drone asks for more, not for the same.
        const u = m4col(R, AX_U, this._u);
        let T = v4dot(fd, u);
        const TMAXTOT = N_ROTORS * DRONE.TMAX;
        if (T < 0) T = 0; else if (T > TMAXTOT) T = TMAXTOT;

        // ---- 4. attitude error as a rotation IN A PLANE ---------------------
        // The plane spanned by (u, ud). No axis, no cross product — those are
        // 3D-only conveniences; the plane is the thing that generalises.
        const wdes = this._wdes; wdes.fill(0);
        const dot = Math.max(-1, Math.min(1, v4dot(u, ud)));
        const b = this._b;
        let bn = 0;
        for (let k = 0; k < 4; k++) { b[k] = ud[k] - dot * u[k]; bn += b[k] * b[k]; }
        bn = Math.sqrt(bn);
        if (bn > 1e-9) {
            for (let k = 0; k < 4; k++) b[k] /= bn;
            const theta = Math.atan2(bn, dot);
            let rate = g.KP_ATT * theta;
            if (rate > g.RATE_MAX) rate = g.RATE_MAX;
            // world bivector ω(b aᵀ − a bᵀ), which sends a → b
            const Ow = this._Ow;
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 4; c++) Ow[r * 4 + c] = rate * (b[r] * u[c] - u[r] * b[c]);
            }
            // → body frame: Ω_body = Rᵀ Ω_world R
            const tmp = this._tmp, Ob = this._Ob;
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 4; c++) {
                    let s = 0;
                    for (let k = 0; k < 4; k++) s += R[k * 4 + r] * Ow[k * 4 + c];
                    tmp[r * 4 + c] = s;
                }
            }
            m4mul(tmp, R, Ob);
            matToBiv(Ob, wdes);
        }

        // ---- 5. rate loop → torque bivector ---------------------------------
        const tau = this._tau;
        for (let k = 0; k < N_PLANES; k++) {
            if (PLANE_IS_TILT[k]) {
                tau[k] = PLANE_I[k] * g.KD_ATT * (wdes[k] - d.omega[k]);
            } else {
                // heading planes: nothing to track, just don't let it spin
                tau[k] = -PLANE_I[k] * g.KD_HEAD * d.omega[k];
            }
        }

        // ---- 6. control allocation, then saturate ---------------------------
        const f = mixerInverse(T, tau, this._f);
        for (let i = 0; i < N_ROTORS; i++) {
            let v = f[i] / DRONE.TMAX;
            d.out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
        }
        return d.out;
    }
}

if (typeof module !== "undefined") module.exports = { Autopilot4D, AP };
