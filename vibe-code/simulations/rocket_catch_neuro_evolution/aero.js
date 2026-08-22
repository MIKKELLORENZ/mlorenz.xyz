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
/* aero.js — the forces on a 70-metre steel tube that is falling sideways.
 *
 * There is no lift coefficient in this file, no lookup table of the finished
 * vehicle, and nothing that was fitted to make a landing work. The body is cut
 * into strips and each strip is given the flow that is actually passing it,
 * including the part of that flow which comes from the vehicle's own rotation.
 * Everything the task depends on falls out of that:
 *
 *  · WHY A BOOSTER IS STABLE TAIL-FIRST. Cross-flow drag acts all along the
 *    tube, so its resultant sits near the geometric centre. The centre of mass
 *    sits at 25 m — low, because the engines and the residual methalox are both
 *    down there — and in tail-first flight "low" means "leading". Mass ahead of
 *    the aerodynamic centre is the definition of static stability, and it is the
 *    reason a Super Heavy can fall unpowered from 60 km without tumbling. Burn
 *    the residual propellant off and the centre of mass climbs; the margin
 *    shrinks during the landing burn, which is not a bug.
 *
 *  · WHY PITCH DAMPING EXISTS WITHOUT A DAMPING DERIVATIVE. Each strip's flow is
 *    v + ω × r, so a rotating vehicle sees more cross-flow at the ends than at
 *    the middle and the strip integral produces the damping moment on its own,
 *    with the correct dependence on density, and therefore correctly vanishing
 *    at altitude. A single-point drag model gets none of this, and a vehicle
 *    with no aerodynamic damping is a very different control problem.
 *
 *  · WHY THE BELLY-FLOP HAS A TERMINAL VELOCITY OF ABOUT 70 m/s. At 90° angle of
 *    attack the whole 52 × 9 m flank is in cross-flow. Nothing was tuned to
 *    produce that number; it is 468 m² of plate against 120 tonnes.
 *
 * GRID FINS are modelled as panels in the local flow, hinged about the radius,
 * producing force in the circumferential direction — which is why three of them
 * at 120° give full three-axis control from three scalars. They lose roughly
 * half their authority through the transonic band, which is real, is the reason
 * the descent is flown the way it is, and is a genuinely hard few seconds for a
 * controller that has learned to trust them.
 *
 * FLAPS are modelled as four plates that are edge-on when flush and face-on when
 * extended. They are brakes, not wings. Their only job is to put more drag on
 * one corner of a falling plate than on the other three.
 */
"use strict";

const M = (typeof require !== "undefined") ? require("./mathx.js") : window.MathX;

const NSTRIP = 20;

/* Cross-flow drag coefficient of a circular cylinder against Mach. The rise
 * through the transonic band is close to a factor of 1.5 and it is not
 * cosmetic — a booster passes through it at the moment the fins are also at
 * their weakest. */
const CDC_M = [0.0, 0.4, 0.7, 0.9, 1.1, 1.5, 2.0, 3.0, 5.0];
const CDC_V = [1.20, 1.20, 1.32, 1.55, 1.68, 1.55, 1.38, 1.25, 1.20];

/* Axial drag of the flat base leading (tail-first). Flat faces are draggy and
 * get draggier transonically. */
const CDB_M = [0.0, 0.6, 0.9, 1.2, 2.0, 4.0];
const CDB_V = [0.85, 0.90, 1.15, 1.30, 1.10, 0.95];

/* Grid fin effectiveness against Mach: they choke. */
const FINE_M = [0.0, 0.65, 0.85, 1.00, 1.25, 1.80, 3.0];
const FINE_V = [1.00, 0.97, 0.66, 0.44, 0.58, 0.90, 0.95];

function tableLerp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    const n = xs.length;
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 1;
    while (i < n - 1 && x > xs[i]) i++;
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

/* Finite-length correction on cross-flow drag. A tube of L/D = 8 does not
 * develop the full 2-D cylinder drag because the flow spills round the ends. */
function etaLD(LD) {
    if (LD >= 40) return 0.98;
    return 0.55 + 0.43 * (1 - Math.exp(-LD / 9));
}

class AeroModel {
    constructor(type) {
        this.type = type;
        const L = type.length, R = type.radius;
        this.eta = etaLD(L / (2 * R));

        // Strip geometry, precomputed once. Radius tapers through the nose
        // fraction so that a nosecone contributes a real area gradient.
        this.z = new Float64Array(NSTRIP);
        this.dz = new Float64Array(NSTRIP);
        this.d = new Float64Array(NSTRIP);
        this.dSdz = new Float64Array(NSTRIP);
        const h = L / NSTRIP;
        const zNose = L * (1 - type.noseFrac);
        const rAt = (z) => {
            if (z <= zNose) return R;
            const t = (z - zNose) / Math.max(1e-6, L - zNose);
            return R * Math.sqrt(Math.max(0, 1 - t * t));   // ogive-ish
        };
        for (let i = 0; i < NSTRIP; i++) {
            const zc = (i + 0.5) * h;
            this.z[i] = zc;
            this.dz[i] = h;
            const r = rAt(zc);
            this.d[i] = 2 * r;
            const r1 = rAt(zc - h / 2), r2 = rAt(zc + h / 2);
            this.dSdz[i] = Math.PI * (r2 * r2 - r1 * r1) / h;
        }
        this.baseArea = Math.PI * R * R;

        // Scratch, reused every call.
        this._vl = M.v3();
        this._r = M.v3();
        this._f = M.v3();
        this._t = M.v3();
        this._n = M.v3();

        /* NOTE: `out` is REUSED between calls. compute() runs a quarter of a
         * million times per episode and must not allocate, so the caller gets a
         * pointer to this object, not a copy. Anything that needs to hold a
         * result across a second call has to snapshot it first. */
        this.out = {
            fx: 0, fy: 0, fz: 0,      // body-frame force
            mx: 0, my: 0, mz: 0,      // body-frame moment about the centre of mass
            q: 0, mach: 0, alpha: 0, qAlpha: 0, vrel: 0
        };
    }

    /* vB   — air-relative velocity of the centre of mass, BODY frame
     * w    — angular velocity, body frame
     * com  — centre of mass height along body z
     * air  — {rho, a}
     * act  — Actuators
     */
    compute(vB, w, com, air, act) {
        const ty = this.type, o = this.out;
        o.fx = 0; o.fy = 0; o.fz = 0; o.mx = 0; o.my = 0; o.mz = 0;

        const rho = air.rho;
        const V = Math.sqrt(vB[0] * vB[0] + vB[1] * vB[1] + vB[2] * vB[2]);
        const mach = V / air.a;
        o.vrel = V; o.mach = mach;
        o.q = 0.5 * rho * V * V;

        // Angle of attack measured from the body axis, folded into [0, 90°] —
        // the vehicle flies both ends first and only the magnitude matters for
        // the structural limit.
        const vperp = Math.hypot(vB[0], vB[1]);
        o.alpha = Math.atan2(vperp, Math.abs(vB[2]));
        o.qAlpha = o.q * o.alpha;

        if (V < 0.05 || rho < 1e-6) return o;

        const cdc = tableLerp(CDC_M, CDC_V, mach) * this.eta;

        /* ---- body strips ------------------------------------------------- */
        const wx = w[0], wy = w[1], wz = w[2];
        for (let i = 0; i < NSTRIP; i++) {
            const dzc = this.z[i] - com;
            // v_local = vB + w × r, r = (0, 0, dzc)
            const lx = vB[0] + (wy * dzc);
            const ly = vB[1] - (wx * dzc);
            const lz = vB[2];

            const cn = Math.hypot(lx, ly);
            if (cn > 1e-6) {
                // Cross-flow drag: -½ρ·Cdc·d·dz·|vn|·vn
                const k = -0.5 * rho * cdc * this.d[i] * this.dz[i] * cn;
                let fx = k * lx, fy = k * ly;

                // Slender-body (Munk) term, only where the flow is genuinely
                // attached and running nose-first. Behind a flat base there is
                // no potential flow to speak of and this term is switched off
                // rather than allowed to change sign and invent stability.
                const noseOn = lz > 0 ? Math.min(1, lz / V) : 0;
                if (noseOn > 0 && this.dSdz[i] !== 0) {
                    const kk = rho * lz * this.dSdz[i] * this.dz[i] * noseOn;
                    fx += kk * lx * 0.5;
                    fy += kk * ly * 0.5;
                }

                o.fx += fx; o.fy += fy;
                // moment about com from a force at (0,0,dzc)
                o.mx += -dzc * fy;
                o.my += dzc * fx;
            }
        }

        /* ---- axial (base / nose) drag ------------------------------------ */
        {
            const va = vB[2];
            let cd;
            if (va < 0) {
                // travelling tail-first: the flat engine deck leads
                cd = tableLerp(CDB_M, CDB_V, mach);
                // A running engine fills the base with plume and the base drag
                // largely disappears. Real, and worth ~10% of the deceleration.
                const th = act ? act.throttle : 0;
                cd *= (1 - 0.55 * Math.min(1, th * (act ? act.liveEngines() : 0) / 3));
            } else {
                cd = 0.20 + 0.35 * Math.exp(-Math.pow((mach - 1.1) / 0.5, 2));
            }
            const f = -0.5 * rho * cd * this.baseArea * Math.abs(va) * va;
            o.fz += f;
        }

        /* ---- grid fins ---------------------------------------------------- */
        if (ty.fins.length) {
            // The fins sit at the trailing end in tail-first flight, inside the
            // body's separated wake. They still work; they work a bit less.
            const wake = vB[2] < 0 ? 0.86 : 1.0;
            const finEff = tableLerp(FINE_M, FINE_V, mach) * wake;
            for (let j = 0; j < ty.fins.length; j++) {
                const fin = ty.fins[j];
                const c = Math.cos(fin.az), s = Math.sin(fin.az);
                const rr = ty.radius + 1.2;
                const rx = rr * c, ry = rr * s, rz = fin.z - com;

                // local flow
                const lx = vB[0] + (wy * rz - wz * ry);
                const ly = vB[1] + (wz * rx - wx * rz);
                const lz = vB[2] + (wx * ry - wy * rx);

                // circumferential unit vector
                const ex = -s, ey = c;
                const vc = lx * ex + ly * ey;
                const va = lz;
                const vloc2 = lx * lx + ly * ly + lz * lz;
                if (vloc2 < 1e-4) continue;

                // Panel angle to the local flow. atan2 against |va| keeps the
                // fin working when the vehicle is nearly broadside, where the
                // panel becomes a plain drag plate.
                const alpha = Math.atan2(vc, Math.abs(va)) + act.fin[j];
                const sa = Math.sin(alpha), ca = Math.cos(alpha);
                const cn = 2.0 * sa * ca + 1.5 * sa * Math.abs(sa);

                const qloc = 0.5 * rho * vloc2;
                const fmag = -qloc * fin.area * cn * finEff;
                const fx = fmag * ex, fy = fmag * ey;

                // Grid fins are draggy in their own right, along the local flow.
                const vl = Math.sqrt(vloc2);
                const cd0 = 0.55 * (0.6 + 0.4 * Math.abs(sa));
                const kd = -0.5 * rho * fin.area * cd0 * vl * finEff;
                const dx = kd * lx, dy = kd * ly, dz = kd * lz;

                const tfx = fx + dx, tfy = fy + dy, tfz = dz;
                o.fx += tfx; o.fy += tfy; o.fz += tfz;
                o.mx += ry * tfz - rz * tfy;
                o.my += rz * tfx - rx * tfz;
                o.mz += rx * tfy - ry * tfx;
            }
        }

        /* ---- flaps -------------------------------------------------------- */
        if (ty.flaps.length) {
            for (let j = 0; j < ty.flaps.length; j++) {
                const fl = ty.flaps[j];
                const d = act.flap[j];
                /* THE HINGE LINE RUNS ALONG THE BODY AXIS, at the hull tangent,
                 * offset leeward, so the flap rotates about a line parallel to
                 * the long axis and its normal sweeps the plane containing the
                 * belly direction and the lateral direction. Tucked, it lies
                 * against the hull edge-on to the belly flow and contributes
                 * almost nothing; at ninety degrees it faces that flow squarely.
                 * An earlier version had the normal sweeping the AXIAL plane
                 * instead, which invents a force along the vehicle length and
                 * gets the roll coupling backwards. */
                const sy = fl.side;
                const nx = Math.sin(d), ny = Math.cos(d) * sy;

                /* The force acts at the panel's centroid, which is half a span
                 * out from the hinge ALONG THE PANEL — so its lever arm swings
                 * with deflection instead of sitting at a fixed point. That is
                 * not a refinement: at full deflection the aft panel's centroid
                 * is 6.1 m off the axis and at the hinge it is 4.3 m, a 40%
                 * difference in exactly the roll authority the flip depends on.
                 * `u` is the outward direction along the panel, perpendicular to
                 * the normal: leeward-along-the-hull when tucked, straight out
                 * from the flank at ninety degrees. */
                const ux = -Math.cos(d), uy = sy * Math.sin(d);
                const half = 0.5 * fl.span;
                const rx = ty.radius * Math.cos(fl.hingeAz) + ux * half;
                const ry = sy * ty.radius * Math.sin(fl.hingeAz) + uy * half;
                const rz = fl.z - com;
                const lx = vB[0] + (wy * rz - wz * ry);
                const ly = vB[1] + (wz * rx - wx * rz);
                const lz = vB[2] + (wx * ry - wy * rx);

                const vn = lx * nx + ly * ny;
                if (Math.abs(vn) < 1e-4) continue;
                const k = -0.5 * rho * fl.area * 1.75 * Math.abs(vn) * vn;
                const fx = k * nx, fy = k * ny;

                o.fx += fx; o.fy += fy;
                o.mx += -rz * fy;
                o.my += rz * fx;
                o.mz += rx * fy - ry * fx;
            }
        }

        /* ---- deployed landing legs --------------------------------------- */
        if (ty.hasLegs && act.legFrac > 0) {
            const A = 26 * act.legFrac;
            const k = -0.5 * rho * A * 1.1 * Math.abs(vB[2]) * vB[2];
            o.fz += k;
            // legs are at the base, below the com — they add a little stability
            const rz = 1.5 - com;
            const cn = Math.hypot(vB[0], vB[1]);
            if (cn > 1e-6) {
                const kk = -0.5 * rho * A * 0.9 * cn;
                const fx = kk * vB[0], fy = kk * vB[1];
                o.fx += fx; o.fy += fy;
                o.mx += -rz * fy; o.my += rz * fx;
            }
        }

        return o;
    }
}

if (typeof module !== "undefined") {
    module.exports = { AeroModel, NSTRIP, tableLerp, CDC_M, CDC_V };
} else {
    window.Aero = { AeroModel, NSTRIP };
}

})();
