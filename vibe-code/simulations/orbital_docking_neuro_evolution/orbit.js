/* orbit.js — the orbital mechanics. No shortcuts, no fudged "space physics".
 *
 * Two vessels orbit the Earth. The station is propagated as an absolute state
 * in ECI; the chaser is propagated as a RELATIVE state (ρ, ρ̇) with respect to
 * the station, using the exact nonlinear differential gravity — not
 * Clohessy-Wiltshire. CW is in here too, but only as the autopilot's guidance
 * model in pilot.js, which is exactly the role it plays on a real vehicle: the
 * thing that plans the burn, never the thing that decides where you actually
 * end up.
 *
 * WHY RELATIVE, AND WHY THE BATTIN FORM. The naive way to fly two vessels is
 * to integrate both absolute states and subtract. At 6,791 km radius and metre
 * scale separations that subtraction throws away nine significant digits, and
 * worse, the two integrations accumulate independent truncation error along a
 * 7.66 km/s arc — so a "docking" simulator built that way will show the two
 * craft drifting apart at millimetres per second with no thrust and no
 * physical cause. Integrating ρ directly removes the differencing entirely,
 * but the derivative
 *
 *      ρ̈ = −μ(r_s+ρ)/|r_s+ρ|³ + μ r_s/|r_s|³
 *
 * *contains* the same cancellation: for ρ = 10 m the two terms agree to nine
 * digits. Battin's rearrangement fixes it algebraically:
 *
 *      q = ρ·(ρ + 2 r_s) / |r_s|²           (the small quantity, ~2ρ/r)
 *      u = (1+q)^{3/2}
 *      F = q(q² + 3q + 3) / (u(u+1))        ( = 1 − (1+q)^{−3/2}, no cancellation )
 *      ρ̈ = −(μ/|r_s|³)(ρ − F·r_c) + Δa_J2 + a_thrust
 *
 * F is evaluated from q directly, so nothing large is ever subtracted from
 * anything large. This is the standard formulation for close-proximity
 * operations and it is what makes a metre-scale docking inside a 6,791 km
 * orbit numerically honest.
 *
 * J2 IS INCLUDED. The Earth's oblateness is not a rounding error at these
 * baselines: two vessels 100 km apart cross-track precess at measurably
 * different rates, which is precisely the "consequence" that makes an
 * out-of-plane rendezvous cost real fuel. The differential J2 term is computed
 * as a straight difference a_J2(r_c) − a_J2(r_s), which is safe here — J2
 * acceleration is ~1e-2 m/s² and the difference for a 100 m baseline is
 * ~4e-7 m/s², eleven orders above the double-precision cancellation floor. The
 * primary term needed Battin; this one does not.
 */
"use strict";

const MU = 3.986004418e14;      // m³/s²   Earth gravitational parameter (EGM-96)
const R_EARTH = 6378137.0;      // m       equatorial radius (WGS-84)
const J2 = 1.08262668e-3;       //         second zonal harmonic
const G0 = 9.80665;             // m/s²    standard gravity, for Isp → exhaust velocity

/* ------------------------------------------------------------------ vec3 */
/* Plain arrays of three numbers. Everything is allocated by the caller where
 * it matters (the integrator inner loop) and freshly returned where it does
 * not (setup, sensors, rendering). */
const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ],
    len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
    len2: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
    unit: (a) => {
        const n = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
        return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
    },
    copy: (a) => [a[0], a[1], a[2]],
    zero: () => [0, 0, 0]
};

/* --------------------------------------------------------------- gravity */
/* Absolute acceleration at an ECI position: point mass plus J2. */
function gravJ2(r, out) {
    const x = r[0], y = r[1], z = r[2];
    const r2 = x * x + y * y + z * z;
    const rn = Math.sqrt(r2);
    const inv3 = 1 / (r2 * rn);
    const k = -MU * inv3;
    // J2: the standard closed form. The (5 z²/r² − 1) / (5 z²/r² − 3) split is
    // what makes an orbit precess rather than close on itself.
    const zr2 = (z * z) / r2;
    const j = 1.5 * J2 * MU * (R_EARTH * R_EARTH) / (r2 * r2 * rn);
    out = out || [0, 0, 0];
    out[0] = k * x - j * x * (5 * zr2 - 1);
    out[1] = k * y - j * y * (5 * zr2 - 1);
    out[2] = k * z - j * z * (5 * zr2 - 3);
    return out;
}

/* Differential gravity on the chaser relative to the station.
 *
 * `rs` is the station ECI position, `rho` the chaser's offset from it. The
 * point-mass part uses the Battin form described at the top of this file; the
 * J2 part is a direct difference. */
function diffGrav(rs, rho, out) {
    out = out || [0, 0, 0];
    const rs2 = rs[0] * rs[0] + rs[1] * rs[1] + rs[2] * rs[2];
    const rsn = Math.sqrt(rs2);

    // q = ρ·(ρ + 2 r_s) / |r_s|²  — small whenever ρ ≪ r_s, which is always.
    const q = (rho[0] * (rho[0] + 2 * rs[0]) +
        rho[1] * (rho[1] + 2 * rs[1]) +
        rho[2] * (rho[2] + 2 * rs[2])) / rs2;
    const u = Math.pow(1 + q, 1.5);
    const F = q * (q * q + 3 * q + 3) / (u * (u + 1));

    const k = -MU / (rs2 * rsn);
    // ρ − F·r_c , with r_c = r_s + ρ
    out[0] = k * (rho[0] - F * (rs[0] + rho[0]));
    out[1] = k * (rho[1] - F * (rs[1] + rho[1]));
    out[2] = k * (rho[2] - F * (rs[2] + rho[2]));

    // Differential J2. Small, but it is the entire reason an out-of-plane
    // offset is expensive to hold: the two vessels' nodes regress at different
    // rates and the cross-track separation breathes over an orbit.
    const gc = gravJ2([rs[0] + rho[0], rs[1] + rho[1], rs[2] + rho[2]]);
    const gs = gravJ2(rs);
    // Subtract off the point-mass parts (already accounted for above) so that
    // only the oblateness difference is added.
    const pmC = pointMass([rs[0] + rho[0], rs[1] + rho[1], rs[2] + rho[2]]);
    const pmS = pointMass(rs);
    out[0] += (gc[0] - pmC[0]) - (gs[0] - pmS[0]);
    out[1] += (gc[1] - pmC[1]) - (gs[1] - pmS[1]);
    out[2] += (gc[2] - pmC[2]) - (gs[2] - pmS[2]);
    return out;
}

function pointMass(r) {
    const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
    const k = -MU / (r2 * Math.sqrt(r2));
    return [k * r[0], k * r[1], k * r[2]];
}

/* ------------------------------------------------------------ integrator */
/* One RK4 step of the COMBINED state
 *
 *      y = [ r_s(3), v_s(3), ρ(3), ρ̇(3) ]
 *
 * The station and the relative state advance together, in one integrator, at
 * one step size. That is not a convenience: the relative derivative depends on
 * r_s at the intermediate stages, and stepping the two separately (or worse,
 * at different step sizes) silently breaks the RK4 order and shows up as a
 * spurious relative drift that looks exactly like a physics bug in the docking
 * dynamics.
 *
 * `aThrust` is the chaser's thrust acceleration in ECI, held constant across
 * the step. That is the standard zero-order hold every real flight computer
 * uses, and the step sizes here (≤ 0.05 s while thrusting) make it exact to
 * well below the thruster quantisation. */
function stepRK4(y, dt, aThrust) {
    const k1 = deriv(y, aThrust);
    const y2 = axpy(y, k1, dt * 0.5);
    const k2 = deriv(y2, aThrust);
    const y3 = axpy(y, k2, dt * 0.5);
    const k3 = deriv(y3, aThrust);
    const y4 = axpy(y, k3, dt);
    const k4 = deriv(y4, aThrust);
    const out = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
        out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
    return out;
}

function axpy(y, k, s) {
    const o = new Float64Array(12);
    for (let i = 0; i < 12; i++) o[i] = y[i] + k[i] * s;
    return o;
}

const _rs = [0, 0, 0], _rho = [0, 0, 0], _g = [0, 0, 0], _dg = [0, 0, 0];
function deriv(y, aThrust) {
    _rs[0] = y[0]; _rs[1] = y[1]; _rs[2] = y[2];
    _rho[0] = y[6]; _rho[1] = y[7]; _rho[2] = y[8];
    gravJ2(_rs, _g);
    diffGrav(_rs, _rho, _dg);
    const d = new Float64Array(12);
    d[0] = y[3]; d[1] = y[4]; d[2] = y[5];
    d[3] = _g[0]; d[4] = _g[1]; d[5] = _g[2];
    d[6] = y[9]; d[7] = y[10]; d[8] = y[11];
    d[9] = _dg[0] + aThrust[0];
    d[10] = _dg[1] + aThrust[1];
    d[11] = _dg[2] + aThrust[2];
    return d;
}

/* --------------------------------------------------------------- frames */
/* LVLH, the frame every rendezvous is discussed in:
 *
 *      x̂  "V-bar"  — along-track, the direction of motion
 *      ŷ  "H-bar"  — negative orbit normal (out of plane, to the right)
 *      ẑ  "R-bar"  — nadir, straight down at the Earth
 *
 * Right-handed, and the one where the counter-intuitive results live: a burn
 * along +x̂ raises the orbit and the vessel ends up BEHIND where it started. */
function lvlhBasis(rs, vs) {
    const rHat = V.unit(rs);
    const h = V.cross(rs, vs);
    const hHat = V.unit(h);
    const z = V.mul(rHat, -1);              // nadir
    const y = V.mul(hHat, -1);              // −h
    const x = V.cross(y, z);                // completes; ≈ velocity direction
    return { x, y, z, rHat, hHat };
}

function toLvlh(v, B) { return [V.dot(v, B.x), V.dot(v, B.y), V.dot(v, B.z)]; }
function fromLvlh(v, B) {
    return [
        B.x[0] * v[0] + B.y[0] * v[1] + B.z[0] * v[2],
        B.x[1] * v[0] + B.y[1] * v[1] + B.z[1] * v[2],
        B.x[2] * v[0] + B.y[2] * v[1] + B.z[2] * v[2]
    ];
}

/* The LVLH frame rotates at the orbit rate, so a velocity that is constant in
 * ECI is not constant in LVLH. Anything comparing a relative velocity against
 * an approach-corridor limit must use the ROTATING-frame velocity, or a vessel
 * station-keeping 200 m below the port reads 0.23 m/s of closing rate that
 * does not exist. ω = h/r². */
function lvlhRate(rs, vs) {
    const h = V.cross(rs, vs);
    const r2 = V.len2(rs);
    // ω vector in ECI is h/r²; expressed in the LVLH axes it is almost purely
    // about −ŷ (pitch-down as the vessel goes round).
    return V.mul(h, 1 / r2);
}

function relVelLvlh(rs, vs, rho, rhoDot, B) {
    const w = lvlhRate(rs, vs);
    const rot = V.cross(w, rho);
    return toLvlh(V.sub(rhoDot, rot), B);
}

function relPosLvlh(rho, B) { return toLvlh(rho, B); }

/* --------------------------------------------------- elements → cartesian */
/* Classical elements to an ECI state. Only ever used to place the station at
 * t = 0; after that it is integrated. */
function keplerToCartesian(el) {
    const { a, e, i, raan, argp, M } = el;
    // Kepler's equation, Newton. Near-circular here, so it converges in 3-4.
    let E = M;
    for (let k = 0; k < 40; k++) {
        const f = E - e * Math.sin(E) - M;
        const fp = 1 - e * Math.cos(E);
        const d = f / fp;
        E -= d;
        if (Math.abs(d) < 1e-14) break;
    }
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2),
        Math.sqrt(1 - e) * Math.cos(E / 2));
    const r = a * (1 - e * Math.cos(E));
    const p = a * (1 - e * e);
    // Perifocal
    const rP = [r * Math.cos(nu), r * Math.sin(nu), 0];
    const vf = Math.sqrt(MU / p);
    const vP = [-vf * Math.sin(nu), vf * (e + Math.cos(nu)), 0];
    // Rotate: Rz(raan) Rx(i) Rz(argp)
    const cO = Math.cos(raan), sO = Math.sin(raan);
    const ci = Math.cos(i), si = Math.sin(i);
    const cw = Math.cos(argp), sw = Math.sin(argp);
    const R = [
        [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si],
        [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si],
        [sw * si, cw * si, ci]
    ];
    const ap = (v) => [
        R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
        R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
        R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]
    ];
    return { r: ap(rP), v: ap(vP) };
}

function meanMotion(a) { return Math.sqrt(MU / (a * a * a)); }

/* ---------------------------------------------------------- quaternions */
/* Body attitude. q = [w, x, y, z], rotating BODY vectors into ECI. */
const Q = {
    identity: () => [1, 0, 0, 0],
    mul: (a, b) => [
        a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
        a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
        a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
        a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
    ],
    norm: (q) => {
        const n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        return n > 0 ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : [1, 0, 0, 0];
    },
    conj: (q) => [q[0], -q[1], -q[2], -q[3]],
    /* Rotate a body-frame vector into ECI. */
    rot: (q, v) => {
        const w = q[0], x = q[1], y = q[2], z = q[3];
        const tx = 2 * (y * v[2] - z * v[1]);
        const ty = 2 * (z * v[0] - x * v[2]);
        const tz = 2 * (x * v[1] - y * v[0]);
        return [
            v[0] + w * tx + (y * tz - z * ty),
            v[1] + w * ty + (z * tx - x * tz),
            v[2] + w * tz + (x * ty - y * tx)
        ];
    },
    /* Rotate an ECI vector into the body frame. */
    unrot: (q, v) => Q.rot(Q.conj(q), v),
    fromAxisAngle: (ax, ang) => {
        const u = V.unit(ax), s = Math.sin(ang / 2);
        return [Math.cos(ang / 2), u[0] * s, u[1] * s, u[2] * s];
    },
    /* Body axes as ECI column vectors — the 9 numbers the network is given as
     * its attitude reading. A rotation matrix has no sign ambiguity and no
     * double cover, which a quaternion does: two quaternions describe the same
     * attitude, and a network fed q has to learn that q and −q mean the same
     * thing before it can learn anything else. */
    axes: (q) => ({
        x: Q.rot(q, [1, 0, 0]),
        y: Q.rot(q, [0, 1, 0]),
        z: Q.rot(q, [0, 0, 1])
    }),
    /* Quaternion from three orthonormal basis vectors given as the COLUMNS of
     * the rotation matrix — i.e. the images of the body axes. Shepperd's
     * branchy form, so no branch ever takes the square root of a negative
     * number near a 180° rotation. */
    fromBasis: (x, y, z) => {
        const m00 = x[0], m10 = x[1], m20 = x[2];
        const m01 = y[0], m11 = y[1], m21 = y[2];
        const m02 = z[0], m12 = z[1], m22 = z[2];
        const tr = m00 + m11 + m22;
        let q;
        if (tr > 0) {
            const s = Math.sqrt(tr + 1) * 2;
            q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
        } else if (m00 > m11 && m00 > m22) {
            const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
            q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s];
        } else if (m11 > m22) {
            const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
            q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s];
        } else {
            const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
            q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s];
        }
        return Q.norm(q);
    },

    /* Smallest angle between two attitudes, radians. */
    angleTo: (a, b) => {
        const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
        return 2 * Math.acos(Math.min(1, d));
    }
};

/* Torque-free / torqued rigid-body attitude step. Euler's equations with a
 * principal-axis inertia, RK4, quaternion renormalised at the end.
 *
 * A vessel that stops firing does NOT stop rotating — it keeps whatever rate
 * it had. This matters more than it sounds: the cheapest way to cross 80 km is
 * a long unpowered coast, and a brain that starts that coast with 0.4°/s of
 * residual rate arrives pointing the wrong way with no LIDAR lock and no time
 * to fix it. Leaving the craft tidy before a coast is a real skill and this is
 * the line of code that makes it one. */
function stepAttitude(q, w, I, torque, dt) {
    const f = (q, w) => {
        // q̇ = ½ q ⊗ [0, ω]
        const qd = Q.mul(q, [0, w[0], w[1], w[2]]).map(v => v * 0.5);
        // ω̇ = I⁻¹ (τ − ω × Iω)
        const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
        const c = V.cross(w, Iw);
        const wd = [
            (torque[0] - c[0]) / I[0],
            (torque[1] - c[1]) / I[1],
            (torque[2] - c[2]) / I[2]
        ];
        return { qd, wd };
    };
    const add = (q, w, d, s) => ({
        q: [q[0] + d.qd[0] * s, q[1] + d.qd[1] * s, q[2] + d.qd[2] * s, q[3] + d.qd[3] * s],
        w: [w[0] + d.wd[0] * s, w[1] + d.wd[1] * s, w[2] + d.wd[2] * s]
    });
    const k1 = f(q, w);
    const s2 = add(q, w, k1, dt / 2); const k2 = f(s2.q, s2.w);
    const s3 = add(q, w, k2, dt / 2); const k3 = f(s3.q, s3.w);
    const s4 = add(q, w, k3, dt); const k4 = f(s4.q, s4.w);
    const qn = [0, 0, 0, 0], wn = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
        qn[i] = q[i] + (dt / 6) * (k1.qd[i] + 2 * k2.qd[i] + 2 * k3.qd[i] + k4.qd[i]);
    }
    for (let i = 0; i < 3; i++) {
        wn[i] = w[i] + (dt / 6) * (k1.wd[i] + 2 * k2.wd[i] + 2 * k3.wd[i] + k4.wd[i]);
    }
    return { q: Q.norm(qn), w: wn };
}

/* --------------------------------------------------- Clohessy-Wiltshire */
/* The linearised relative-motion solution, in LVLH with x along-track and z
 * nadir. Used ONLY by pilot.js (the scripted autopilot / imitation teacher)
 * and by the render's ghost-trajectory preview. The world itself never touches
 * it — the truth is the nonlinear integration above, and the gap between the
 * two is exactly the error a real guidance computer has to correct for.
 *
 * State ordering here is [x, y, z, ẋ, ẏ, ż] in the LVLH axes of this file:
 * x along-track, y cross-track, z NADIR. The textbook form is written with the
 * radial axis first and pointing UP, so converting to this convention is not
 * just a row permutation — flipping the radial axis flips the sign of every
 * term that couples radial motion to along-track motion, while leaving the
 * radial-only, along-track-only and cross-track terms alone.
 *
 * Getting that wrong is not a subtle error and it does not announce itself. The
 * first version of this function had the six coupling terms at textbook sign,
 * so the transfer solver was internally consistent, returned finite plausible
 * velocities, and produced trajectories that flew the wrong way round the
 * orbit. Every long-range plan came back asking for 60–80 m/s to do a 23 m/s
 * job, the autopilot ran its tank dry on seven of eight far scenarios, and the
 * symptom looked exactly like a controller tuning problem. What caught it was
 * checking the sim's own unpowered drift against the analytic solution and
 * asking which of the two had the physically right answer: a vessel 100 m below
 * the station is in a lower, faster orbit and must pull AHEAD. */
function cwState(dt, n) {
    const s = Math.sin(n * dt), c = Math.cos(n * dt);
    const M = [
        // x        y         z                  ẋ                        ẏ      ż
        [1, 0, -6 * (s - n * dt), (4 * s - 3 * n * dt) / n, 0, 2 * (1 - c) / n],
        [0, c, 0, 0, s / n, 0],
        [0, 0, 4 - 3 * c, -2 * (1 - c) / n, 0, s / n],
        [0, 0, 6 * n * (1 - c), 4 * c - 3, 0, 2 * s],
        [0, -n * s, 0, 0, c, 0],
        [0, 0, 3 * n * s, -2 * s, 0, c]
    ];
    return M;
}

function cwApply(M, st) {
    const o = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6; i++) {
        let s = 0;
        for (let j = 0; j < 6; j++) s += M[i][j] * st[j];
        o[i] = s;
    }
    return o;
}

/* Two-impulse CW targeting: given a relative state now, find the velocity the
 * vessel must have RIGHT NOW so that after `tof` seconds it arrives at `target`
 * position with zero relative velocity is a second solve. Returns the required
 * initial velocity; the caller differences it against the current one to get
 * the burn. Solves the 3×3 block Φ_rv v0 = target − Φ_rr r0. */
function cwTargetVelocity(r0, target, tof, n) {
    const M = cwState(tof, n);
    // rhs = target − Φ_rr r0
    const rhs = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        let s = 0;
        for (let j = 0; j < 3; j++) s += M[i][j] * r0[j];
        rhs[i] = target[i] - s;
    }
    // A = Φ_rv (top-right 3×3)
    const A = [
        [M[0][3], M[0][4], M[0][5]],
        [M[1][3], M[1][4], M[1][5]],
        [M[2][3], M[2][4], M[2][5]]
    ];
    return solve3(A, rhs);
}

/* Where a CW state ends up after `tof`, given the velocity it starts with. */
function cwFinalVelocity(r0, v0, tof, n) {
    const M = cwState(tof, n);
    const st = cwApply(M, [r0[0], r0[1], r0[2], v0[0], v0[1], v0[2]]);
    return [st[3], st[4], st[5]];
}

function solve3(A, b) {
    // Gaussian elimination with partial pivoting. Φ_rv is singular at
    // tof = k·period (the transfer that goes all the way round and comes back
    // to the same place is not unique), so the caller must keep the time of
    // flight away from an integer number of orbits — pilot.js does.
    const m = [[A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]]];
    for (let c = 0; c < 3; c++) {
        let p = c;
        for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
        if (Math.abs(m[p][c]) < 1e-14) return null;      // singular — caller retries
        const t = m[c]; m[c] = m[p]; m[p] = t;
        for (let r = 0; r < 3; r++) {
            if (r === c) continue;
            const f = m[r][c] / m[c][c];
            for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
        }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

if (typeof module !== "undefined") {
    module.exports = {
        MU, R_EARTH, J2, G0, V, Q,
        gravJ2, diffGrav, stepRK4, stepAttitude,
        lvlhBasis, toLvlh, fromLvlh, lvlhRate, relVelLvlh, relPosLvlh,
        keplerToCartesian, meanMotion,
        cwState, cwApply, cwTargetVelocity, cwFinalVelocity, solve3
    };
}
