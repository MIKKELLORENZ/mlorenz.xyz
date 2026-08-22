/* NOTE ON THE IIFE WRAPPER AROUND THIS FILE.
 *
 * Every module here is a Node CommonJS file AND is loaded by the page as a
 * plain <script> tag, because these simulations are expected to run from a
 * file:// URL with no server, no bundler and no network. Under Node each file
 * gets its own scope; under a script tag they all share one, and nine files
 * that each begin `const M = ...` and `const DEG = Math.PI/180` collide on the
 * first one and take the rest of the page down with them. The wrapper gives
 * each file its own scope in both worlds. `module` is still visible inside it
 * under Node, so the export at the bottom is unaffected.
 */
;(function () {
/* mathx.js — the small pile of vector and quaternion arithmetic everything else
 * stands on. Allocation-free by construction: every routine writes into an
 * output array the caller owns. The inner loop of this project runs roughly
 * thirty million of these calls per generation and a `new Array(3)` in the wrong
 * place is worth about 30% of the wall clock. */
"use strict";

const v3 = () => new Float64Array(3);
const q4 = () => { const q = new Float64Array(4); q[3] = 1; return q; };

function vset(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; }
function vcopy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; }
function vadd(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; }
function vsub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; }
function vscale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; }
function vaddScaled(o, a, s) { o[0] += a[0] * s; o[1] += a[1] * s; o[2] += a[2] * s; return o; }
function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vlen(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function vlen2(a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; }
function vcross(o, a, b) {
    const x = a[1] * b[2] - a[2] * b[1];
    const y = a[2] * b[0] - a[0] * b[2];
    const z = a[0] * b[1] - a[1] * b[0];
    o[0] = x; o[1] = y; o[2] = z; return o;
}
function vnorm(o, a) {
    const l = vlen(a);
    if (l < 1e-12) { o[0] = 0; o[1] = 0; o[2] = 0; return o; }
    return vscale(o, a, 1 / l);
}

/* Quaternions are [x, y, z, w] and always mean BODY → WORLD. Every rotation in
 * this project is written in that direction; the inverse shows up only in
 * `qrotInv`, and mixing the two up is the single easiest way to build a
 * simulation that looks plausible and flies backwards. */
function qmul(o, a, b) {
    const ax = a[0], ay = a[1], az = a[2], aw = a[3];
    const bx = b[0], by = b[1], bz = b[2], bw = b[3];
    o[0] = aw * bx + ax * bw + ay * bz - az * by;
    o[1] = aw * by - ax * bz + ay * bw + az * bx;
    o[2] = aw * bz + ax * by - ay * bx + az * bw;
    o[3] = aw * bw - ax * bx - ay * by - az * bz;
    return o;
}
function qnorm(q) {
    const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    if (l > 1e-12) { const s = 1 / l; q[0] *= s; q[1] *= s; q[2] *= s; q[3] *= s; }
    return q;
}
/* body vector → world */
function qrot(o, q, v) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const vx = v[0], vy = v[1], vz = v[2];
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    o[0] = vx + w * tx + (y * tz - z * ty);
    o[1] = vy + w * ty + (z * tx - x * tz);
    o[2] = vz + w * tz + (x * ty - y * tx);
    return o;
}
/* world vector → body */
function qrotInv(o, q, v) {
    const x = -q[0], y = -q[1], z = -q[2], w = q[3];
    const vx = v[0], vy = v[1], vz = v[2];
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    o[0] = vx + w * tx + (y * tz - z * ty);
    o[1] = vy + w * ty + (z * tx - x * tz);
    o[2] = vz + w * tz + (x * ty - y * tx);
    return o;
}
function qFromAxisAngle(o, ax, ay, az, ang) {
    const l = Math.sqrt(ax * ax + ay * ay + az * az);
    if (l < 1e-12) { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 1; return o; }
    const s = Math.sin(ang / 2) / l;
    o[0] = ax * s; o[1] = ay * s; o[2] = az * s; o[3] = Math.cos(ang / 2);
    return o;
}
/* Rotate `q` by body-frame angular velocity w for time dt, exactly (the
 * exponential map), not by the first-order q += 0.5 ω q that every tutorial
 * uses. At 200 Hz with a 60°/s tumble the first-order form loses normalisation
 * fast enough that re-normalising quietly changes the attitude. */
function qIntegrate(q, w, dt) {
    const wx = w[0], wy = w[1], wz = w[2];
    const th = Math.sqrt(wx * wx + wy * wy + wz * wz) * dt;
    if (th < 1e-9) return q;
    const s = Math.sin(th / 2) / (th / dt);
    const dq = _tmpq;
    dq[0] = wx * s; dq[1] = wy * s; dq[2] = wz * s; dq[3] = Math.cos(th / 2);
    qmul(_tmpq2, q, dq);
    q[0] = _tmpq2[0]; q[1] = _tmpq2[1]; q[2] = _tmpq2[2]; q[3] = _tmpq2[3];
    return qnorm(q);
}
const _tmpq = new Float64Array(4);
const _tmpq2 = new Float64Array(4);

/* Shortest rotation taking body +Z onto a world direction, with an arbitrary
 * but continuous roll. Used to build scenario attitudes. */
function qLookAxis(o, dir) {
    const d = _tmpv;
    vnorm(d, dir);
    const dot = d[2];
    if (dot > 0.999999) { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 1; return o; }
    if (dot < -0.999999) { o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; return o; }
    // axis = z_body(0,0,1) × d
    const ax = -d[1], ay = d[0], az = 0;
    return qFromAxisAngle(o, ax, ay, az, Math.acos(Math.max(-1, Math.min(1, dot))));
}
const _tmpv = new Float64Array(3);

/* Quaternion from the world images of the three body basis vectors. Used to
 * build the belly-flop attitude, which is most naturally stated as "the long
 * axis points that way and the tiles face the ground" rather than as an angle
 * about anything. Shepperd's method — pick the largest diagonal term first, so
 * there is no near-degenerate branch. */
function qFromBasis(o, ex, ey, ez) {
    const m00 = ex[0], m10 = ex[1], m20 = ex[2];
    const m01 = ey[0], m11 = ey[1], m21 = ey[2];
    const m02 = ez[0], m12 = ez[1], m22 = ez[2];
    const tr = m00 + m11 + m22;
    let x, y, z, w;
    if (tr > 0) {
        const s = Math.sqrt(tr + 1) * 2;
        w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
    } else if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
    } else {
        const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
        w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
    }
    o[0] = x; o[1] = y; o[2] = z; o[3] = w;
    return qnorm(o);
}

function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}
/* A bounded, monotone "how close is this to zero" kernel used all over the
 * scoring. 1 at zero error, decaying with a Gaussian tail — importantly it is
 * never flat, so there is always a gradient for selection to climb even when
 * every brain in the fleet is terrible. */
function gauss(err, sigma) {
    const t = err / sigma;
    return Math.exp(-t * t);
}

/* THE HEAVY-TAILED VERSION, AND IT IS THE ONE THE SCORING ACTUALLY USES.
 *
 * A Gaussian kernel is the obvious way to write "how close is this to zero" and
 * on this task it is a trap. Ask it how good a touchdown at 250 m/s is against a
 * 7 m/s scale and the answer is exp(−1255): not "bad", but zero to four hundred
 * decimal places, and identical to the answer for 100 m/s and for 40 m/s. Every
 * member of generation 1 arrives somewhere in that range, so every member scores
 * exactly the same, and the entire reward for learning to brake — which is the
 * whole task — is invisible until a brain is already almost landing.
 *
 * This kernel is 1 at zero error and decays as a power law: 0.5 at one scale
 * length, and still meaningfully different between 100 m/s and 250 m/s. It is
 * monotone everywhere and never numerically flat, which is what selection needs
 * from a population that is uniformly terrible.
 */
function soft(err, scale, p) {
    const e = err > 0 ? err : 0;
    return 1 / (1 + Math.pow(e / scale, p == null ? 1.3 : p));
}

if (typeof module !== "undefined") {
    module.exports = {
        v3, q4, vset, vcopy, vadd, vsub, vscale, vaddScaled, vdot, vlen, vlen2, vcross, vnorm,
        qmul, qnorm, qrot, qrotInv, qFromAxisAngle, qIntegrate, qLookAxis, qFromBasis,
        clamp, smoothstep, gauss, soft
    };
}
else {
    window.MathX = {
        v3, q4, vset, vcopy, vadd, vsub, vscale, vaddScaled, vdot, vlen, vlen2, vcross, vnorm,
        qmul, qnorm, qrot, qrotInv, qFromAxisAngle, qIntegrate, qLookAxis, qFromBasis,
        clamp, smoothstep, gauss, soft
    };
}

})();
