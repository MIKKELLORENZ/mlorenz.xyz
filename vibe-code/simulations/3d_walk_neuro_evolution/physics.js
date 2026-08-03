/* physics.js — reduced-coordinate rigid-body dynamics for a kinematic tree
 * with a floating base. Everything is SI: metres, seconds, kilograms, newtons.
 *
 * Why reduced coordinates (Featherstone spatial algebra) instead of the usual
 * boxes-and-impulse-solver approach: a doll built from ball joints solved by
 * sequential impulses is always slightly rubbery, and a rubbery skeleton is a
 * moving target for evolution — the same torque gives a different result
 * depending on how well the solver converged that tick. Here the joints are
 * *structurally* exact: the state IS the joint angles, so a knee can never pull
 * apart or drift, and there are no solver iterations to tune. It is also
 * roughly 3x cheaper, which matters when a headless run simulates a hundred
 * thousand walker-seconds.
 *
 * The pipeline each tick is textbook:
 *   fk()        forward kinematics + spatial velocities
 *   (caller fills fext with contact / wind forces)
 *   dynamics()  RNEA for the bias force C, CRBA for the mass matrix H,
 *               then solve  H·qdd = tau - C  by LDL^T
 *   integrate() semi-implicit Euler, quaternion for the base
 *
 * Conventions (Featherstone, RBDA 2008):
 *   · spatial motion vector  = [wx wy wz  vx vy vz]   (angular first)
 *   · spatial force vector   = [nx ny nz  fx fy fz]
 *   · every quantity for body i lives in body i's own frame
 *   · X_i transforms motion vectors parent(i) -> i ; X_i^T transforms force i -> parent(i)
 *
 * World axes: +Y up. The humanoid's own frame is +X forward, +Y up, +Z left.
 */
"use strict";

const GRAVITY = 9.81;
/* Which forward-dynamics solver runs. ABA is O(n) and skips the mass matrix
 * entirely; CRBA+LDL is the original and stays as the reference the ABA path is
 * checked against. Env-switchable so a run, a test or a bisect can pin either
 * one without editing code. Default ABA — see _aba for the profile that
 * motivated it. */
const USE_ABA = !(typeof process !== "undefined" && process.env && process.env.WALK3D_ABA === "0");

/* ------------------------------------------------------------ 3x3 utilities */
/* Row-major 3x3 in a 9-array. */
function m3RotAxis(axis, th, o) {
    const c = Math.cos(th), s = Math.sin(th);
    if (axis === 0) { o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = c; o[5] = -s; o[6] = 0; o[7] = s; o[8] = c; }
    else if (axis === 1) { o[0] = c; o[1] = 0; o[2] = s; o[3] = 0; o[4] = 1; o[5] = 0; o[6] = -s; o[7] = 0; o[8] = c; }
    else { o[0] = c; o[1] = -s; o[2] = 0; o[3] = s; o[4] = c; o[5] = 0; o[6] = 0; o[7] = 0; o[8] = 1; }
}
/* o[oo..] = a[ao..] · b[bo..]  (o must not alias a or b) */
function m3Mul(a, ao, b, bo, o, oo) {
    for (let i = 0; i < 3; i++) {
        const a0 = a[ao + i * 3], a1 = a[ao + i * 3 + 1], a2 = a[ao + i * 3 + 2];
        o[oo + i * 3] = a0 * b[bo] + a1 * b[bo + 3] + a2 * b[bo + 6];
        o[oo + i * 3 + 1] = a0 * b[bo + 1] + a1 * b[bo + 4] + a2 * b[bo + 7];
        o[oo + i * 3 + 2] = a0 * b[bo + 2] + a1 * b[bo + 5] + a2 * b[bo + 8];
    }
}
/* out = M · v, reading v from src[si..], writing to out[oi..] */
function m3Apply(M, src, si, out, oi) {
    const x = src[si], y = src[si + 1], z = src[si + 2];
    out[oi] = M[0] * x + M[1] * y + M[2] * z;
    out[oi + 1] = M[3] * x + M[4] * y + M[5] * z;
    out[oi + 2] = M[6] * x + M[7] * y + M[8] * z;
}
/* out = M^T · v */
function m3ApplyT(M, src, si, out, oi) {
    const x = src[si], y = src[si + 1], z = src[si + 2];
    out[oi] = M[0] * x + M[3] * y + M[6] * z;
    out[oi + 1] = M[1] * x + M[4] * y + M[7] * z;
    out[oi + 2] = M[2] * x + M[5] * y + M[8] * z;
}
function quatToM3(q, o) {
    const w = q[0], x = q[1], y = q[2], z = q[3];
    const xx = x * x, yy = y * y, zz = z * z;
    o[0] = 1 - 2 * (yy + zz); o[1] = 2 * (x * y - w * z); o[2] = 2 * (x * z + w * y);
    o[3] = 2 * (x * y + w * z); o[4] = 1 - 2 * (xx + zz); o[5] = 2 * (y * z - w * x);
    o[6] = 2 * (x * z - w * y); o[7] = 2 * (y * z + w * x); o[8] = 1 - 2 * (xx + yy);
}

/* --------------------------------------------------------- 6x6 spatial maths */
/* X = [ E, 0 ; -E·S(r), E ]  — motion transform parent -> child.
 * E is read from Ea[eo..eo+8] (row-major 3x3), the result written to X[o..o+35]. */
function x6Build(Ea, eo, X, o, rx, ry, rz) {
    const e0 = Ea[eo], e1 = Ea[eo + 1], e2 = Ea[eo + 2];
    const e3 = Ea[eo + 3], e4 = Ea[eo + 4], e5 = Ea[eo + 5];
    const e6 = Ea[eo + 6], e7 = Ea[eo + 7], e8 = Ea[eo + 8];
    // -E·S(r), with S(r) the skew matrix of r
    const a = -(e1 * rz - e2 * ry), b = -(e2 * rx - e0 * rz), c = -(e0 * ry - e1 * rx);
    const d = -(e4 * rz - e5 * ry), e = -(e5 * rx - e3 * rz), f = -(e3 * ry - e4 * rx);
    const g = -(e7 * rz - e8 * ry), h = -(e8 * rx - e6 * rz), i = -(e6 * ry - e7 * rx);
    X[o + 0] = e0; X[o + 1] = e1; X[o + 2] = e2; X[o + 3] = 0; X[o + 4] = 0; X[o + 5] = 0;
    X[o + 6] = e3; X[o + 7] = e4; X[o + 8] = e5; X[o + 9] = 0; X[o + 10] = 0; X[o + 11] = 0;
    X[o + 12] = e6; X[o + 13] = e7; X[o + 14] = e8; X[o + 15] = 0; X[o + 16] = 0; X[o + 17] = 0;
    X[o + 18] = a; X[o + 19] = b; X[o + 20] = c; X[o + 21] = e0; X[o + 22] = e1; X[o + 23] = e2;
    X[o + 24] = d; X[o + 25] = e; X[o + 26] = f; X[o + 27] = e3; X[o + 28] = e4; X[o + 29] = e5;
    X[o + 30] = g; X[o + 31] = h; X[o + 32] = i; X[o + 33] = e6; X[o + 34] = e7; X[o + 35] = e8;
}
/* out[oo..] = X[xo..] · v[vo..]   (6x6 by 6) */
function x6Vec(X, xo, v, vo, out, oo) {
    for (let i = 0; i < 6; i++) {
        const b = xo + i * 6;
        out[oo + i] = X[b] * v[vo] + X[b + 1] * v[vo + 1] + X[b + 2] * v[vo + 2] +
            X[b + 3] * v[vo + 3] + X[b + 4] * v[vo + 4] + X[b + 5] * v[vo + 5];
    }
}
/* out[oo..] = X[xo..]^T · v[vo..] */
function x6TVec(X, xo, v, vo, out, oo) {
    for (let i = 0; i < 6; i++) out[oo + i] = 0;
    for (let i = 0; i < 6; i++) {
        const vi = v[vo + i];
        if (vi === 0) continue;
        const b = xo + i * 6;
        for (let j = 0; j < 6; j++) out[oo + j] += X[b + j] * vi;
    }
}
/* out[oo..] = A[ao..] · v[vo..] for a generic 6x6 */
const m6Vec = x6Vec;

/* OUT[oo..] = X[xo..]^T · I[io..] · X[xo..]  (composite-inertia transform).
 * `_ixTmp` is private to this routine, so OUT may be any other buffer. */
const _ixTmp = new Float64Array(36);
function x6TransformInertia(X, xo, I, io, OUT, oo) {
    /* OUT = Xᵀ·I·X, the single hottest operation in the simulator: two thirds of
     * all wall clock was spent here, at roughly 13 ns per multiply-add, which is
     * an order of magnitude off what a tight numeric loop costs in this engine.
     *
     * The reason was that it multiplied as though the matrices were dense, and
     * they are emphatically not — a Plücker transform for a single-axis joint is
     * 29% non-zero and a spatial inertia 18%, because both are built from a
     * rotation about ONE axis and a mostly-zero offset. Hoisting the operand out
     * of the inner loop and skipping the zeros does the same arithmetic in a
     * fifth of the iterations. Identical results, verified against the dense
     * form to 1e-15 over random states. */
    for (let i = 0; i < 36; i++) _ixTmp[i] = 0;
    // T = I·X, accumulating by rows of X so a zero in I skips a whole row
    for (let i = 0; i < 6; i++) {
        const ir = io + i * 6, tr = i * 6;
        for (let k = 0; k < 6; k++) {
            const a = I[ir + k];
            if (a === 0) continue;
            const xr = xo + k * 6;
            _ixTmp[tr] += a * X[xr];
            _ixTmp[tr + 1] += a * X[xr + 1];
            _ixTmp[tr + 2] += a * X[xr + 2];
            _ixTmp[tr + 3] += a * X[xr + 3];
            _ixTmp[tr + 4] += a * X[xr + 4];
            _ixTmp[tr + 5] += a * X[xr + 5];
        }
    }
    // OUT = Xᵀ·T, same trick down the columns of X
    for (let i = 0; i < 36; i++) OUT[oo + i] = 0;
    for (let k = 0; k < 6; k++) {
        const xr = xo + k * 6, tr = k * 6;
        for (let i = 0; i < 6; i++) {
            const a = X[xr + i];
            if (a === 0) continue;
            const or = oo + i * 6;
            OUT[or] += a * _ixTmp[tr];
            OUT[or + 1] += a * _ixTmp[tr + 1];
            OUT[or + 2] += a * _ixTmp[tr + 2];
            OUT[or + 3] += a * _ixTmp[tr + 3];
            OUT[or + 4] += a * _ixTmp[tr + 4];
            OUT[or + 5] += a * _ixTmp[tr + 5];
        }
    }
}

/* Spatial cross products.  crm: motion x motion.  crf: motion x* force. */
function crm(v, vo, m, mo, out, oo) {
    const wx = v[vo], wy = v[vo + 1], wz = v[vo + 2];
    const lx = v[vo + 3], ly = v[vo + 4], lz = v[vo + 5];
    const ax = m[mo], ay = m[mo + 1], az = m[mo + 2];
    const bx = m[mo + 3], by = m[mo + 4], bz = m[mo + 5];
    out[oo] = wy * az - wz * ay;
    out[oo + 1] = wz * ax - wx * az;
    out[oo + 2] = wx * ay - wy * ax;
    out[oo + 3] = wy * bz - wz * by + ly * az - lz * ay;
    out[oo + 4] = wz * bx - wx * bz + lz * ax - lx * az;
    out[oo + 5] = wx * by - wy * bx + lx * ay - ly * ax;
}
function crf(v, vo, f, fo, out, oo) {
    const wx = v[vo], wy = v[vo + 1], wz = v[vo + 2];
    const lx = v[vo + 3], ly = v[vo + 4], lz = v[vo + 5];
    const nx = f[fo], ny = f[fo + 1], nz = f[fo + 2];
    const fx = f[fo + 3], fy = f[fo + 4], fz = f[fo + 5];
    out[oo] = wy * nz - wz * ny + ly * fz - lz * fy;
    out[oo + 1] = wz * nx - wx * nz + lz * fx - lx * fz;
    out[oo + 2] = wx * ny - wy * nx + lx * fy - ly * fx;
    out[oo + 3] = wy * fz - wz * fy;
    out[oo + 4] = wz * fx - wx * fz;
    out[oo + 5] = wx * fy - wy * fx;
}

/* -------------------------------------------------------------- LDL^T solver */
/* H is symmetric positive definite (n x n, row-major). Factorises in place:
 * strict lower triangle holds L, the diagonal holds D. */
function ldlFactor(H, n) {
    for (let j = 0; j < n; j++) {
        let d = H[j * n + j];
        for (let k = 0; k < j; k++) d -= H[j * n + k] * H[j * n + k] * H[k * n + k];
        if (d < 1e-12) d = 1e-12;                 // ridge: keeps a degenerate model solvable
        H[j * n + j] = d;
        for (let i = j + 1; i < n; i++) {
            let s = H[i * n + j];
            for (let k = 0; k < j; k++) s -= H[i * n + k] * H[j * n + k] * H[k * n + k];
            H[i * n + j] = s / d;
        }
    }
}
function ldlSolve(H, n, b) {
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= H[i * n + k] * b[k]; b[i] = s; }
    for (let i = 0; i < n; i++) b[i] /= H[i * n + i];
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= H[k * n + i] * b[k]; b[i] = s; }
}

/* ================================================================ MultiBody */
/* model.bodies[i] = {
 *     name, parent (-1 for the floating base), axis (0|1|2, ignored for base),
 *     r: [x,y,z]        joint origin in the parent's frame
 *     mass, com: [x,y,z], inertia: [Ixx,Iyy,Izz]  (about the com, body axes)
 *     armature          rotor inertia reflected through the gearbox (kg·m²)
 *     qmin, qmax, kp, kd, tauMax
 * }
 */
class MultiBody {
    constructor(model) {
        const bs = model.bodies;
        const n = this.nb = bs.length;
        this.nj = n - 1;                    // 1-DoF joints (body 0 is the base)
        this.nv = 6 + this.nj;              // generalised velocities
        this.model = model;

        this.parent = new Int32Array(n);
        this.axis = new Int32Array(n);
        this.tr = new Float64Array(n * 3);
        this.I = new Float64Array(n * 36);
        this.armature = new Float64Array(n);
        this.qmin = new Float64Array(n);
        this.qmax = new Float64Array(n);

        for (let i = 0; i < n; i++) {
            const b = bs[i];
            this.parent[i] = b.parent;
            this.axis[i] = b.axis == null ? 0 : b.axis;
            this.tr[i * 3] = b.r ? b.r[0] : 0;
            this.tr[i * 3 + 1] = b.r ? b.r[1] : 0;
            this.tr[i * 3 + 2] = b.r ? b.r[2] : 0;
            this.armature[i] = b.armature || 0;
            this.qmin[i] = b.qmin == null ? -Infinity : b.qmin;
            this.qmax[i] = b.qmax == null ? Infinity : b.qmax;
            this._buildInertia(i, b);
        }

        // ---- state ----
        this.q = new Float64Array(n);            // joint angles, index 0 unused
        this.qd = new Float64Array(this.nv);     // [base spatial velocity (6); joint rates]
        this.bp = new Float64Array(3);           // base origin in world
        this.bq = new Float64Array([1, 0, 0, 0]);// base orientation, body -> world

        // ---- workspace (allocation-free hot loop) ----
        this.E = new Float64Array(n * 9);        // parent -> child rotation
        this.X = new Float64Array(n * 36);
        this.R = new Float64Array(n * 9);        // body -> world
        this.P = new Float64Array(n * 3);        // body origin in world
        this.V = new Float64Array(n * 6);        // spatial velocity, body frame
        this.A = new Float64Array(n * 6);
        this.F = new Float64Array(n * 6);
        this.fext = new Float64Array(n * 6);     // external forces, body frame
        this.Ic = new Float64Array(n * 36);
        this.H = new Float64Array(this.nv * this.nv);
        this.rhs = new Float64Array(this.nv);
        this.qdd = new Float64Array(this.nv);
        this.tau = new Float64Array(n);          // joint torques, index 0 unused
        this._t6 = new Float64Array(6);
        this._u6 = new Float64Array(6);
        // ---- ABA workspace ----
        this._IA = new Float64Array(n * 36);     // articulated-body inertia
        this._pA = new Float64Array(n * 6);      // articulated bias force
        this._cv = new Float64Array(n * 6);      // velocity-product acceleration
        this._U = new Float64Array(n * 6);
        this._d = new Float64Array(n);
        this._u = new Float64Array(n);
        this._H6 = new Float64Array(36);
        this._r6 = new Float64Array(6);
        this._acc36b = new Float64Array(36);
        this._rot = new Float64Array(9);
        this._acc36 = new Float64Array(36);
        this._Fc = new Float64Array(6);
        this._Fd = new Float64Array(6);
        this._g = new Float64Array(3);
        this.blown = false;                      // set if the integrator ever sees a NaN
    }

    _buildInertia(i, b) {
        const m = b.mass || 0;
        const cx = b.com ? b.com[0] : 0, cy = b.com ? b.com[1] : 0, cz = b.com ? b.com[2] : 0;
        const ix = b.inertia ? b.inertia[0] : 0, iy = b.inertia ? b.inertia[1] : 0, iz = b.inertia ? b.inertia[2] : 0;
        const o = i * 36;
        for (let k = 0; k < 36; k++) this.I[o + k] = 0;
        // Ibar = Ic + m·S(c)·S(c)^T  (parallel axis)
        const Ibar = [
            ix + m * (cy * cy + cz * cz), -m * cx * cy, -m * cx * cz,
            -m * cx * cy, iy + m * (cx * cx + cz * cz), -m * cy * cz,
            -m * cx * cz, -m * cy * cz, iz + m * (cx * cx + cy * cy)
        ];
        // m·S(c)
        const mS = [0, -m * cz, m * cy, m * cz, 0, -m * cx, -m * cy, m * cx, 0];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            this.I[o + r * 6 + c] = Ibar[r * 3 + c];
            this.I[o + r * 6 + 3 + c] = mS[r * 3 + c];
            this.I[o + (r + 3) * 6 + c] = mS[c * 3 + r];    // the (m·S(c))^T block
            this.I[o + (r + 3) * 6 + 3 + c] = (r === c) ? m : 0;
        }
    }

    /* Forward kinematics + spatial velocity propagation. Must run before
     * contacts are gathered (they need world points) and before dynamics(). */
    fk() {
        const n = this.nb, E = this.E, X = this.X, R = this.R, P = this.P, V = this.V;
        const rot = this._rot;
        // base: E0 = R^T (world -> base), r = base position in world
        quatToM3(this.bq, R);
        E[0] = R[0]; E[1] = R[3]; E[2] = R[6];
        E[3] = R[1]; E[4] = R[4]; E[5] = R[7];
        E[6] = R[2]; E[7] = R[5]; E[8] = R[8];
        P[0] = this.bp[0]; P[1] = this.bp[1]; P[2] = this.bp[2];
        x6Build(E, 0, X, 0, this.bp[0], this.bp[1], this.bp[2]);
        for (let k = 0; k < 6; k++) V[k] = this.qd[k];

        for (let i = 1; i < n; i++) {
            const p = this.parent[i], ax = this.axis[i];
            m3RotAxis(ax, this.q[i], rot);               // child orientation relative to parent
            const eo = i * 9;
            E[eo] = rot[0]; E[eo + 1] = rot[3]; E[eo + 2] = rot[6];
            E[eo + 3] = rot[1]; E[eo + 4] = rot[4]; E[eo + 5] = rot[7];
            E[eo + 6] = rot[2]; E[eo + 7] = rot[5]; E[eo + 8] = rot[8];
            const rx = this.tr[i * 3], ry = this.tr[i * 3 + 1], rz = this.tr[i * 3 + 2];
            x6Build(E, eo, X, i * 36, rx, ry, rz);
            // world pose
            m3Mul(R, p * 9, rot, 0, R, i * 9);
            const po = p * 3, pr = p * 9;
            P[i * 3] = P[po] + R[pr] * rx + R[pr + 1] * ry + R[pr + 2] * rz;
            P[i * 3 + 1] = P[po + 1] + R[pr + 3] * rx + R[pr + 4] * ry + R[pr + 5] * rz;
            P[i * 3 + 2] = P[po + 2] + R[pr + 6] * rx + R[pr + 7] * ry + R[pr + 8] * rz;
            // velocity: v_i = X_i·v_parent + S_i·qd_i
            x6Vec(X, i * 36, V, p * 6, V, i * 6);
            V[i * 6 + ax] += this.qd[5 + i];
        }
    }

    /* World position of a body-local point. */
    worldPoint(i, lx, ly, lz, out, oo) {
        const r = i * 9, p = i * 3;
        out[oo] = this.P[p] + this.R[r] * lx + this.R[r + 1] * ly + this.R[r + 2] * lz;
        out[oo + 1] = this.P[p + 1] + this.R[r + 3] * lx + this.R[r + 4] * ly + this.R[r + 5] * lz;
        out[oo + 2] = this.P[p + 2] + this.R[r + 6] * lx + this.R[r + 7] * ly + this.R[r + 8] * lz;
    }

    /* World velocity of a body-fixed point (local offset lx,ly,lz). */
    worldPointVel(i, lx, ly, lz, out, oo) {
        const v = i * 6;
        const wx = this.V[v], wy = this.V[v + 1], wz = this.V[v + 2];
        // spatial linear part is the velocity of the body point at the frame origin
        const bx = this.V[v + 3] + wy * lz - wz * ly;
        const by = this.V[v + 4] + wz * lx - wx * lz;
        const bz = this.V[v + 5] + wx * ly - wy * lx;
        const r = i * 9;
        out[oo] = this.R[r] * bx + this.R[r + 1] * by + this.R[r + 2] * bz;
        out[oo + 1] = this.R[r + 3] * bx + this.R[r + 4] * by + this.R[r + 5] * bz;
        out[oo + 2] = this.R[r + 6] * bx + this.R[r + 7] * by + this.R[r + 8] * bz;
    }

    /* Apply a world-frame force at a world point on body i (accumulates in fext). */
    addWorldForce(i, wx, wy, wz, fx, fy, fz) {
        const r = i * 9, p = i * 3, o = i * 6;
        // force into body coords
        const dx = wx - this.P[p], dy = wy - this.P[p + 1], dz = wz - this.P[p + 2];
        const lx = this.R[r] * dx + this.R[r + 3] * dy + this.R[r + 6] * dz;
        const ly = this.R[r + 1] * dx + this.R[r + 4] * dy + this.R[r + 7] * dz;
        const lz = this.R[r + 2] * dx + this.R[r + 5] * dy + this.R[r + 8] * dz;
        const bx = this.R[r] * fx + this.R[r + 3] * fy + this.R[r + 6] * fz;
        const by = this.R[r + 1] * fx + this.R[r + 4] * fy + this.R[r + 7] * fz;
        const bz = this.R[r + 2] * fx + this.R[r + 5] * fy + this.R[r + 8] * fz;
        this.fext[o] += ly * bz - lz * by;
        this.fext[o + 1] += lz * bx - lx * bz;
        this.fext[o + 2] += lx * by - ly * bx;
        this.fext[o + 3] += bx;
        this.fext[o + 4] += by;
        this.fext[o + 5] += bz;
    }

    clearForces() { this.fext.fill(0); }

    /* Total mass, world centre of mass and its world velocity. */
    comState(out) {
        let m = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
        const t = this._g, t2 = this._t6;
        for (let i = 0; i < this.nb; i++) {
            const b = this.model.bodies[i];
            if (!b.mass) continue;
            const c = b.com || [0, 0, 0];
            this.worldPoint(i, c[0], c[1], c[2], t, 0);
            this.worldPointVel(i, c[0], c[1], c[2], t2, 0);
            m += b.mass;
            cx += b.mass * t[0]; cy += b.mass * t[1]; cz += b.mass * t[2];
            vx += b.mass * t2[0]; vy += b.mass * t2[1]; vz += b.mass * t2[2];
        }
        out[0] = cx / m; out[1] = cy / m; out[2] = cz / m;
        out[3] = vx / m; out[4] = vy / m; out[5] = vz / m;
        return m;
    }

    /* --------------------------------------------------------------- dynamics */
    /* RNEA with qdd = 0 gives the bias force C (gravity + Coriolis + fext). */
    _rnea() {
        const n = this.nb, V = this.V, A = this.A, F = this.F, X = this.X, t6 = this._t6, u6 = this._u6;
        // a_0 = X_{0<-world}·(-a_gravity):  angular 0, linear = E0·(0, g, 0)
        A[0] = 0; A[1] = 0; A[2] = 0;
        A[3] = this.E[1] * GRAVITY; A[4] = this.E[4] * GRAVITY; A[5] = this.E[7] * GRAVITY;
        for (let i = 1; i < n; i++) {
            const p = this.parent[i], ax = this.axis[i], o = i * 6;
            x6Vec(X, i * 36, A, p * 6, A, o);
            // + crm(v_i)·(S_i·qd_i)
            for (let k = 0; k < 6; k++) t6[k] = 0;
            t6[ax] = this.qd[5 + i];
            crm(V, o, t6, 0, u6, 0);
            for (let k = 0; k < 6; k++) A[o + k] += u6[k];
        }
        for (let i = 0; i < n; i++) {
            const o = i * 6, io = i * 36;
            m6Vec(this.I, io, A, o, F, o);              // I·a
            m6Vec(this.I, io, V, o, t6, 0);             // I·v
            crf(V, o, t6, 0, u6, 0);                    // v x* (I·v)
            for (let k = 0; k < 6; k++) F[o + k] += u6[k] - this.fext[o + k];
        }
        for (let i = n - 1; i >= 1; i--) {
            const p = this.parent[i], o = i * 6;
            this.tau[i] = F[o + this.axis[i]];          // generalised bias for this joint
            x6TVec(X, i * 36, F, o, t6, 0);
            for (let k = 0; k < 6; k++) F[p * 6 + k] += t6[k];
        }
    }

    /* CRBA: the joint-space mass matrix H. */
    _crba() {
        const n = this.nb, nv = this.nv, H = this.H, Ic = this.Ic, X = this.X;
        Ic.set(this.I);
        H.fill(0);
        const Fc = this._Fc, Fd = this._Fd, acc = this._acc36;
        for (let i = n - 1; i >= 1; i--) {
            const p = this.parent[i];
            x6TransformInertia(X, i * 36, Ic, i * 36, acc, 0);
            for (let k = 0; k < 36; k++) Ic[p * 36 + k] += acc[k];
        }
        // base block
        for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) H[r * nv + c] = Ic[r * 6 + c];
        for (let i = 1; i < n; i++) {
            const ax = this.axis[i], di = 5 + i;
            // F = Ic_i · S_i  == column `ax` of Ic_i
            for (let k = 0; k < 6; k++) Fc[k] = Ic[i * 36 + k * 6 + ax];
            H[di * nv + di] = Fc[ax] + this.armature[i];
            let j = i, src = Fc, dst = Fd;
            while (true) {
                x6TVec(X, j * 36, src, 0, dst, 0);
                j = this.parent[j];
                if (j === 0) {
                    for (let k = 0; k < 6; k++) { H[di * nv + k] = dst[k]; H[k * nv + di] = dst[k]; }
                    break;
                }
                const dj = 5 + j;
                H[di * nv + dj] = H[dj * nv + di] = dst[this.axis[j]];
                const sw = src; src = dst; dst = sw;
            }
        }
    }

    /* ------------------------------------------------------------------- ABA
     * Featherstone's Articulated Body Algorithm: forward dynamics in O(n),
     * without ever forming or factorising the joint-space mass matrix.
     *
     * Why it is worth having a second solver. Profiling the real workload put
     * 47.5% of ALL runtime in three functions — _crba (14.1%), ldlFactor
     * (14.0%) and x6TransformInertia (19.4%) — i.e. in building a 28x28 mass
     * matrix 500 times a second and then factorising it. ABA needs neither: it
     * propagates an articulated-body inertia inward, solves a 6x6 for the
     * floating base, and propagates accelerations outward.
     *
     * GRAVITY. The CRBA path fakes gravity by giving the base a fictitious
     * acceleration of -a_g and letting RNEA turn it into a bias force. That
     * trick needs a KNOWN base acceleration, which a floating base does not
     * have. So this path uses the equivalent substitution instead: work in
     * a' = a - a_g, the acceleration relative to free fall. Gravity then
     * disappears from the force balance entirely (the I·a_g term cancels the
     * weight), a' propagates exactly as a does because a_g is a uniform field
     * with X_i·a_g,p = a_g,i, and the only place gravity reappears is the last
     * line, where the true base acceleration is recovered as a_0 = a'_0 + a_g.
     * Joint accelerations are identical under either variable, which is why the
     * two solvers agree to rounding.
     *
     * Results are NOT bit-identical to the CRBA path — the operation order
     * differs, so the last couple of digits move. Agreement is checked to a
     * relative tolerance in test_headless.js. */
    _aba(jointTau) {
        const n = this.nb, V = this.V, X = this.X, I = this.I;
        const IA = this._IA, pA = this._pA, cv = this._cv, U = this._U;
        const d = this._d, u = this._u, t6 = this._t6, u6 = this._u6, acc = this._acc36;

        // ---- pass 1: bias forces and velocity-product accelerations
        IA.set(I);
        for (let i = 0; i < n; i++) {
            const o = i * 6;
            m6Vec(I, i * 36, V, o, t6, 0);              // I·v
            crf(V, o, t6, 0, u6, 0);                    // v x* (I·v)
            for (let k = 0; k < 6; k++) pA[o + k] = u6[k] - this.fext[o + k];
            if (i === 0) { for (let k = 0; k < 6; k++) cv[k] = 0; continue; }
            // c_i = v_i x (S_i·qd_i)
            for (let k = 0; k < 6; k++) t6[k] = 0;
            t6[this.axis[i]] = this.qd[5 + i];
            crm(V, o, t6, 0, cv, o);
        }

        // ---- pass 2: articulated inertia and bias, inward
        for (let i = n - 1; i >= 1; i--) {
            const p = this.parent[i], ax = this.axis[i], o = i * 6, io = i * 36;
            // U = IA_i·S_i is column `ax` of IA_i; d = S^T·U + rotor inertia
            for (let k = 0; k < 6; k++) U[o + k] = IA[io + k * 6 + ax];
            let di = U[o + ax] + this.armature[i];
            if (!(di > 1e-12)) di = 1e-12;              // same ridge the LDL path uses
            d[i] = di;
            u[i] = jointTau[i] - pA[o + ax];

            // Ia = IA - U·U^T/d   (into acc, reused as the transform input)
            const inv = 1 / di;
            for (let r = 0; r < 6; r++) {
                const ur = U[o + r] * inv;
                for (let c = 0; c < 6; c++) acc[r * 6 + c] = IA[io + r * 6 + c] - ur * U[o + c];
            }
            // pa = pA + Ia·c + U·(u/d)
            m6Vec(acc, 0, cv, o, t6, 0);
            const uk = u[i] * inv;
            for (let k = 0; k < 6; k++) t6[k] += pA[o + k] + U[o + k] * uk;

            // fold into the parent: IA_p += X^T·Ia·X,  pA_p += X^T·pa
            x6TransformInertia(X, i * 36, acc, 0, this._acc36b, 0);
            const po = p * 36;
            for (let k = 0; k < 36; k++) IA[po + k] += this._acc36b[k];
            x6TVec(X, i * 36, t6, 0, u6, 0);
            for (let k = 0; k < 6; k++) pA[p * 6 + k] += u6[k];
        }

        // ---- base: IA_0·a'_0 = -pA_0, a 6x6 solve instead of a 28x28 one
        const H6 = this._H6, r6 = this._r6, A = this.A;
        for (let k = 0; k < 36; k++) H6[k] = IA[k];
        for (let k = 0; k < 6; k++) r6[k] = -pA[k];
        ldlFactor(H6, 6);
        ldlSolve(H6, 6, r6);
        for (let k = 0; k < 6; k++) A[k] = r6[k];

        // ---- pass 3: accelerations outward
        for (let i = 1; i < n; i++) {
            const p = this.parent[i], ax = this.axis[i], o = i * 6;
            x6Vec(X, i * 36, A, p * 6, t6, 0);          // X_i·a'_parent
            for (let k = 0; k < 6; k++) t6[k] += cv[o + k];
            let s = 0;
            for (let k = 0; k < 6; k++) s += U[o + k] * t6[k];
            const qddi = (u[i] - s) / d[i];
            this.qdd[5 + i] = qddi;
            for (let k = 0; k < 6; k++) A[o + k] = t6[k];
            A[o + ax] += qddi;
        }

        /* Back to true acceleration: a_0 = a'_0 + a_g, with gravity in the base
         * frame. The CRBA path writes E0·(0,+g,0) as the FICTITIOUS acceleration
         * -a_g, so the field itself is the negative of that. */
        this.qdd[0] = A[0]; this.qdd[1] = A[1]; this.qdd[2] = A[2];
        this.qdd[3] = A[3] - this.E[1] * GRAVITY;
        this.qdd[4] = A[4] - this.E[4] * GRAVITY;
        this.qdd[5] = A[5] - this.E[7] * GRAVITY;

        for (let k = 0; k < this.nv; k++) {
            let a = this.qdd[k];
            if (!Number.isFinite(a)) { a = 0; this.blown = true; }
            else if (a > 4000) a = 4000; else if (a < -4000) a = -4000;
            this.qdd[k] = a;
        }
    }

    /* Solve for accelerations given joint torques (this.tau is overwritten). */
    dynamics(jointTau) {
        if (USE_ABA) return this._aba(jointTau);
        this._rnea();                       // this.tau now holds the joint bias, F[0..5] the base bias
        this._crba();
        const nv = this.nv;
        for (let k = 0; k < 6; k++) this.rhs[k] = -this.F[k];
        for (let i = 1; i < this.nb; i++) this.rhs[5 + i] = jointTau[i] - this.tau[i];
        ldlFactor(this.H, nv);
        ldlSolve(this.H, nv, this.rhs);
        for (let k = 0; k < nv; k++) {
            let a = this.rhs[k];
            if (!Number.isFinite(a)) { a = 0; this.blown = true; }
            else if (a > 4000) a = 4000; else if (a < -4000) a = -4000;
            this.qdd[k] = a;
        }
    }

    /* Semi-implicit Euler; the base orientation goes through a quaternion. */
    integrate(dt) {
        const qd = this.qd, qdd = this.qdd;
        for (let k = 0; k < this.nv; k++) qd[k] += qdd[k] * dt;
        // base position: spatial linear velocity is body-frame, rotate to world
        const R = this.R;
        this.bp[0] += (R[0] * qd[3] + R[1] * qd[4] + R[2] * qd[5]) * dt;
        this.bp[1] += (R[3] * qd[3] + R[4] * qd[4] + R[5] * qd[5]) * dt;
        this.bp[2] += (R[6] * qd[3] + R[7] * qd[4] + R[8] * qd[5]) * dt;
        // base orientation: q <- q ⊗ exp(½·ω·dt), body-frame ω
        const hx = qd[0] * dt * 0.5, hy = qd[1] * dt * 0.5, hz = qd[2] * dt * 0.5;
        const th2 = hx * hx + hy * hy + hz * hz;
        const cw = 1 - th2 * 0.5, sc = 1 - th2 / 6;      // 2nd-order exp, cheap and stable
        const dw = cw, dx = hx * sc, dy = hy * sc, dz = hz * sc;
        const w = this.bq[0], x = this.bq[1], y = this.bq[2], z = this.bq[3];
        let nw = w * dw - x * dx - y * dy - z * dz;
        let nx = w * dx + x * dw + y * dz - z * dy;
        let ny = w * dy - x * dz + y * dw + z * dx;
        let nz = w * dz + x * dy - y * dx + z * dw;
        const len = Math.hypot(nw, nx, ny, nz) || 1;
        this.bq[0] = nw / len; this.bq[1] = nx / len; this.bq[2] = ny / len; this.bq[3] = nz / len;
        // joints, with a hard backstop just past the soft limit
        for (let i = 1; i < this.nb; i++) {
            let a = this.q[i] + qd[5 + i] * dt;
            /* A LAST-RESORT NUMERICAL NET, not the joint limit. The limit
             * itself is now a torque in _servos, which goes through the solve
             * and conserves momentum. This margin used to be 0.02 rad, which
             * made the clamp fire on 21-34% of ticks and turned a momentum
             * violation into a routine part of the dynamics. At 0.15 it fires
             * on 0.00% of ticks in normal operation and exists only so a
             * genuinely broken state cannot walk a joint to infinity. */
            const lo = this.qmin[i] - 0.15, hi = this.qmax[i] + 0.15;
            if (a < lo) { a = lo; if (qd[5 + i] < 0) qd[5 + i] = 0; }
            else if (a > hi) { a = hi; if (qd[5 + i] > 0) qd[5 + i] = 0; }
            this.q[i] = a;
        }
        if (!Number.isFinite(this.bp[0] + this.bp[1] + this.bp[2])) this.blown = true;
    }

    /* Mechanical energy — the cheapest honest check that the maths is right. */
    energy() {
        let ke = 0, pe = 0;
        const t = this._t6;
        for (let i = 1; i < this.nb; i++) ke += 0.5 * this.armature[i] * this.qd[5 + i] * this.qd[5 + i];
        for (let i = 0; i < this.nb; i++) {
            const o = i * 6, io = i * 36;
            m6Vec(this.I, io, this.V, o, t, 0);
            let s = 0;
            for (let k = 0; k < 6; k++) s += this.V[o + k] * t[k];
            ke += 0.5 * s;
            const b = this.model.bodies[i];
            if (b.mass) {
                const c = b.com || [0, 0, 0];
                this.worldPoint(i, c[0], c[1], c[2], this._g, 0);
                pe += b.mass * GRAVITY * this._g[1];
            }
        }
        return ke + pe;
    }
}

if (typeof module !== "undefined") {
    module.exports = { MultiBody, GRAVITY, m3RotAxis, m3Mul, quatToM3, ldlFactor, ldlSolve };
}
