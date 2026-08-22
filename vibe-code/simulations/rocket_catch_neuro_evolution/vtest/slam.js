/* slam.js — A HOVER-SLAM REFERENCE, BECAUSE THE SETTLE CONTROLLER IS THE WRONG
 * SHAPE FOR THIS GEOMETRY.
 *
 * Evidence that it is the shape and not the gains:
 *
 *   - the golden pilot crashes 200/200 on stage 0 and ends every one of them
 *     with an EMPTY TANK, at 170 m/s, 120 m across;
 *   - a 3,000-point gain search over that same structure found nothing that
 *     transfers (0/200 on a fresh bank for all four leaders);
 *   - and budget.js says the propellant is not short: stage 0 needs 282 m/s by
 *     the ideal bound and the tank holds 534.
 *
 * A controller that runs a 1.9x propellant margin dry is not mistuned, it is
 * spending the propellant on the wrong thing. The settle law tracks a sink-rate
 * schedule v = slope*h all the way down, which means it starts braking at four
 * kilometres and then pays gravity for every one of the forty seconds that
 * follow. A booster cannot afford to fly like that and does not: it falls, lets
 * 260 m/s of terminal velocity be produced by drag for free, and lights the
 * engines at the last possible moment.
 *
 * THE LAW. With quadratic drag written as a terminal velocity vt — at v = vt
 * drag exactly balances weight, so drag deceleration is g(v/vt)^2 — a burn at
 * constant specific thrust aT decelerates as
 *
 *     dv/dt = -( aT - g + g v^2/vt^2 )
 *
 * which integrates in closed form to the height a burn needs,
 *
 *     h_brake = (vt^2 / 2g) * ln( 1 + g v^2 / (vt^2 (aT - g)) )
 *
 * and inverts to the thrust a given height demands,
 *
 *     aT = g + g (v^2 - vTouch^2) / ( vt^2 * (exp(2 g h / vt^2) - 1) ).
 *
 * That single expression is the whole vertical channel: evaluate it every tick,
 * stay cold while it asks for less than the engines can give, light when it
 * stops being able to wait, then track it. It is self-correcting — falling
 * behind raises the demand — and it never asks for a hover, so it cannot spend
 * the tank on one. The same integral gives the burn's own duration,
 *
 *     t_burn = vt/sqrt(g(aT-g)) * atan( v sqrt(g/(aT-g)) / vt )
 *
 * which is the time-to-go the lateral channel needs and had no honest source
 * for before.
 *
 * LATERAL is then zero-effort-miss on that time-to-go, executed by tilting the
 * thrust vector inside the q·alpha cone. During the coast there is no thrust to
 * tilt, so the same command goes to the GRID FINS, through a mixing matrix
 * measured at runtime rather than derived: perturb each fin, ask aero.js what
 * moment it produced, and least-squares the three deflections onto the two
 * torques wanted. Three fins in a T at 90/180/270 do not mix symmetrically and
 * writing that matrix out by hand is how a sign error gets into a reference.
 *
 *   node vtest/slam.js [n] [stages]
 */
"use strict";

const M = require("../mathx.js");
const V = require("../vehicle.js");
const WM = require("../world.js");
const SC = require("../scenarios.js");
const ATM = require("../atmosphere.js");
const AERO = require("../aero.js");
const GOLD = require("../golden_test.js");
const G = V.G0;
const DEG = Math.PI / 180;

/* TWO CONTROLLERS, ONE FLIGHT — AND THE HANDOVER IS THE POINT.
 *
 * The braking law alone was traced killing 206 m/s in 300 m on 19 t of the 41 t
 * aboard, which is the hard part of the problem solved. It then flew the
 * vehicle into the sea, because a hover-slam has nothing to say about what
 * happens after the velocity is gone: at h = 12 m and v = 0 the vertical demand
 * collapses to hover, the lateral demand does not, and a zero-effort-miss law
 * on a one-second time-to-go with 300 m of error commands everything the
 * engines have, sideways. It climbed back to 680 m at 89 degrees of tilt with
 * the tank empty.
 *
 * The settle controller in golden_test.js is exactly the missing half and is
 * already tuned, so the slam does not reimplement it: it flies the energy — the
 * fall, the ignition, the braking, and the lateral arrival — and hands a slow
 * vehicle a short way above the rails to the pilot that was always good at the
 * last hundred metres. The failure of the old reference was never the settle,
 * it was asking the settle to fly the approach as well.
 */
const GAINS = {
    ignMargin: 0.35,    // extra height over the braking distance + dead time at ignition
    /* WHERE TO HAND OVER IS NOT A FREE PARAMETER. The settle controller was
     * grid-searched against the ORIGINAL stage 0 — a spawn at 260-620 m coming
     * down at 45-95 m/s — so handing it a vehicle in exactly that state is
     * handing it the problem it is known to solve. Handing over lower and
     * slower, which was the first guess, puts it outside everything it was ever
     * tuned on and puts the slam in charge of the one regime it has no law for. */
    hHand: 350,         // hand over to the settle controller this far above the rails
    vHand: 50,          // ...aiming to arrive there at this sink rate
    vHandMax: 110,      // and never hand over faster than this, whatever the height
    vTouch: 1.2,        // aim to arrive at the rails at this sink rate
    hBias: 6,           // ...and this far above them, so the pins clear the arms
    kpAtt: 0.55, kdAtt: 1.45,
    kpFin: 0.30, kdFin: 0.95,
    aLatFrac: 0.35,     // share of available thrust the lateral loop may spend
    zemK: 1.0,
    /* 32 degrees, not 12. Measured against aero.js, a booster at 250 m/s gets
     * 13-17 m/s^2 of lateral specific force out of 20-30 degrees of angle of
     * attack at only half the q·alpha limit, so a 12 degree cap was throwing
     * away most of the steering the airframe has. It is the STRUCTURAL limit
     * that has to bind here, not a placeholder. */
    aoaMax: 32 * DEG,
    qaMargin: 0.65,
    qMargin: 0.72,
    qLook: 8,           // seconds of lookahead on the density ahead
    kvz: 0.5,           // how hard the q cap is enforced
    /* THE COAST STEERS BACKWARDS FROM THE INTUITION, which is why the first
     * version of this gain did nothing whichever way it was turned. A tail-first
     * booster at angle of attack is a bluff body in crossflow: the normal force
     * lands on the side the relative wind hits, so tilting the nose TOWARD the
     * gate pushes the vehicle AWAY from it. Turned the correct way the effect is
     * real and large — the handover miss falls 189 m -> 154 m — but it also
     * departs, tumbling 34 of 40, because holding a large angle of attack on an
     * aerodynamically unstable tube is more than three grid fins can do. So the
     * coast is left damping rather than steering, and the aim dispersion is
     * sized to what the burn can retrieve instead. */
    finBias: 0.5,       // how hard the coast steers with lift
    settleGains: null   // overrides for the handover controller; null = its own
};

function makeSlam(K) {
    K = Object.assign({}, GAINS, K || {});
    const ax = new Float64Array(3), errW = new Float64Array(3), errB = new Float64Array(3);
    const _vw = new Float64Array(3), _vb = new Float64Array(3), _w0 = new Float64Array(3);
    let lit = false, rung = 0, model = null, scratch = null, settle = null;

    /* ---- fin mixer: measure the moment each fin makes, then invert --------- */
    function finCommand(w, tauX, tauY, out) {
        const ty = w.type;
        if (!ty.fins.length) return;
        if (!model) { model = new AERO.AeroModel(ty); scratch = new V.Actuators(ty); }
        const air = ATM.airAt(Math.max(0, w.p[2]));
        M.qrotInv(_vb, w.q, w.v);                       // body-frame airspeed (wind ignored: this is a Jacobian, not a force)
        scratch.fin.fill(0); scratch.throttle = 0; scratch.stage = 0;
        const base = model.compute(_vb, w.w, w.mp.com, air, scratch);
        const m0x = base.mx, m0y = base.my;
        const d = 8 * DEG;
        const J = [];
        for (let i = 0; i < ty.fins.length; i++) {
            scratch.fin[i] = d;
            const r = model.compute(_vb, w.w, w.mp.com, air, scratch);
            J.push([(r.mx - m0x) / d, (r.my - m0y) / d]);
            scratch.fin[i] = 0;
        }
        /* Minimum-norm solution of J^T u = tau for the 3x2 underdetermined system:
         * u = J (J^T J)^-1 tau, with a ridge term because at low q the Jacobian
         * is numerically zero and the inverse is meaningless. */
        let a = 0, b = 0, c = 0;                        // J^T J = [[a,b],[b,c]]
        for (const j of J) { a += j[0] * j[0]; b += j[0] * j[1]; c += j[1] * j[1]; }
        const ridge = 1e-6 * (a + c) + 1e-3;
        a += ridge; c += ridge;
        const det = a * c - b * b;
        if (!(Math.abs(det) > 1e-12)) return;
        const sx = (c * tauX - b * tauY) / det, sy = (-b * tauX + a * tauY) / det;
        for (let i = 0; i < J.length; i++) {
            const u = J[i][0] * sx + J[i][1] * sy;
            out[4 + i] = M.clamp(u / ty.fins[i].maxDefl, -1, 1);
        }
    }

    const self = function (w, o) {
        o.fill(0);
        o[9] = 1;
        const ty = w.type, LAD = ty.engineLadder, T1 = V.RAPTOR.thrust;
        const m = w.mp.m, tel = w.tel;
        const aimZ = V.TOWER.armZ - ty.catchPinZ;
        const hRail = w.p[2] - aimZ;
        const v = -w.v[2];
        const aMax = (LAD[LAD.length - 1] * T1) / m;

        /* ---- the handover, one way only ----------------------------------- */
        /* THE ALTITUDE ALONE IS NOT THE HANDOVER. A vehicle that is late on its
         * braking is still doing 200 m/s at 350 m, and giving that to a settle
         * controller is giving it a problem it has no answer to — measured, the
         * stage-1 median handover was 192 m/s with the tank untouched. The slam
         * keeps the vehicle until the energy is actually gone. */
        if (!settle && hRail < K.hHand && v < K.vHandMax) {
            settle = GOLD.makePilot(K.settleGains);
            /* Recorded so the two halves can be blamed separately: everything
             * upstream of this point is the slam's, everything after is the
             * settle's, and "it ran dry" means nothing until you know which. */
            self.handover = { v, vh: Math.hypot(w.v[0], w.v[1]), prop: w.prop / (w.sc.prop || 1),
                              err: Math.hypot(V.TOWER.gateX - tel.pinX, V.TOWER.gateY - tel.pinY) };
        }
        if (settle) return settle(w, o);

        const h = Math.max(0, hRail - K.hHand);

        /* ---- vertical: the braking law ------------------------------------ */
        const vt = Math.max(20, SC.equilibriumSink(ty, Math.max(0, w.p[2]), m));
        const L = 2 * G * h / (vt * vt);
        const den = Math.expm1(Math.min(40, L));
        const vv = Math.max(0, v * v - K.vHand * K.vHand);
        let aT = den > 1e-9 ? G + G * vv / (vt * vt * den) : aMax;
        if (v <= K.vTouch && h < 3) aT = G;              // arrived: just hold

        /* ---- and the airframe puts a FLOOR under the burn -------------------
         *
         * A pure hover-slam coasts to terminal velocity, and for this vehicle
         * terminal velocity near the ground is about 340 m/s — roughly 71 kPa
         * against a 65 kPa limit. The unpowered descent is structurally illegal
         * by construction, which is exactly why real boosters fly an entry burn,
         * and it is what tore up 26 of 60 stage-1 flights here.
         *
         * The speed the structure allows is reconstructed from telemetry the
         * same way golden_test.js does it — rho = 2q/v^2, so v_limit =
         * v*sqrt(qMax/q) — evaluated at the altitude the vehicle will be at in
         * qLook seconds, because a reactive cap does not bind until the limit is
         * already being exceeded. The slam then takes whichever demand is
         * larger: the braking law is a floor on how late you may burn, and this
         * is a floor on how fast you may fall. */
        const hAhead = Math.max(0, w.p[2] - Math.max(0, v) * K.qLook);
        const rhoAhead = ATM.airAt(hAhead).rho;
        if (rhoAhead > 1e-6) {
            const vCap = Math.sqrt(2 * K.qMargin * ty.qMax / rhoAhead);
            if (v > vCap) aT = Math.max(aT, G + K.kvz * (v - vCap));
        }
        aT = Math.min(aT, aMax);

        /* ---- ignition: the last moment MINUS THE DEAD TIME ------------------
         *
         * "Light when the demand reaches 72% of full thrust" was the obvious
         * rule and it is wrong, because a Raptor does not produce thrust when
         * asked: there is a 450 ms spark-torch delay and a 160 ms spool on top
         * of it, and at 250 m/s that is 175 m of altitude spent on nothing. The
         * first version lit at h = 341 m needing 241 m to stop, which reads as
         * 100 m of margin and is actually negative once the dead time is paid.
         * Measured, it arrived at the rails at 182 m/s with 84% of the tank
         * still in it — the engines were still coming up when it hit.
         *
         * So the test is on DISTANCE, not on thrust fraction: light when the
         * height left is no more than the braking distance at full ladder
         * thrust, plus what the vehicle falls while the engines light, plus a
         * margin. All three terms are computed from the vehicle's own constants
         * rather than tuned. */
        if (!lit) {
            const A = aMax - G;
            const hBrake = A > 0.5 ? (vt * vt / (2 * G)) * Math.log(1 + G * vv / (vt * vt * A)) : 1e9;
            const hDead = v * (V.RAPTOR.ignitionDelay + 2 * V.RAPTOR.spoolTau);
            if (h <= (hBrake + hDead) * (1 + K.ignMargin)) { lit = true; rung = LAD.length - 1; }
        }
        if (lit) {
            /* Shed engines as the demand falls; a group is usable only if the
             * demand sits between its floor and its ceiling. */
            for (let k = 1; k <= rung; k++) {
                const hi = (LAD[k] * T1) / m, lo = hi * V.RAPTOR.minThrottle;
                if (aT <= hi * 0.97 && aT >= lo) { rung = k; break; }
            }
        }

        /* ---- lateral: zero-effort-miss on the burn's own clock ------------- */
        let tgo;
        if (aT > G + 0.5) {
            const s = Math.sqrt(G / (aT - G));
            tgo = (vt / Math.sqrt(G * (aT - G))) * Math.atan(v * s / vt);
        } else tgo = h / Math.max(20, v);
        if (!lit) tgo += Math.max(0, (h - 0.5 * v * v / Math.max(1, aMax - G))) / Math.max(30, v);
        tgo = Math.max(1.0, tgo);

        const gx = V.TOWER.gateX - tel.pinX, gy = V.TOWER.gateY - tel.pinY;
        let alx = K.zemK * (6 * gx / (tgo * tgo) - 4 * w.v[0] / tgo);
        let aly = K.zemK * (6 * gy / (tgo * tgo) - 4 * w.v[1] / tgo);
        const aLatCap = K.aLatFrac * aMax;
        const alm = Math.hypot(alx, aly);
        if (alm > aLatCap) { alx *= aLatCap / alm; aly *= aLatCap / alm; }

        /* ---- the specific force wanted, clamped into the q·alpha cone ------ */
        let nx = alx, ny = aly, nz = Math.max(0.2 * G, aT);
        let nrm = Math.hypot(nx, ny, nz) || 1;
        nx /= nrm; ny /= nrm; nz /= nrm;

        const aoaMax = tel.q > 100
            ? Math.min(K.aoaMax, (K.qaMargin * ty.qAlphaMax) / tel.q)
            : K.aoaMax;
        M.qrot(_vw, w.q, w._vb);
        const sp = Math.hypot(_vw[0], _vw[1], _vw[2]);
        if (sp > 20 && tel.q > 100) {
            const ux = -_vw[0] / sp, uy = -_vw[1] / sp, uz = -_vw[2] / sp;
            /* During the coast there is no thrust to point, so the axis command
             * is not "where the thrust should go" but "how much lift to make":
             * it is biased off the airflow toward the gate by as much as the
             * cone allows, which is what flies the grid fins. */
            if (!lit) {
                /* BIAS TOWARD THE LATERAL DEMAND, NOT TOWARD THE THRUST VECTOR.
                 * The first version mixed in the full specific-force direction
                 * n, which during the coast is aT ~ g pointing almost straight
                 * up — so "steer harder" tilted the vehicle toward vertical and
                 * did nothing for the miss. Only the horizontal part of the
                 * demand says which way to go. */
                const lm = Math.hypot(alx, aly);
                if (lm > 1e-3) {
                    const bx = ux + K.finBias * alx / lm, by = uy + K.finBias * aly / lm, bz = uz;
                    const bn = Math.hypot(bx, by, bz) || 1;
                    nx = bx / bn; ny = by / bn; nz = bz / bn;
                }
            }
            const ang = Math.acos(M.clamp(nx * ux + ny * uy + nz * uz, -1, 1));
            if (ang > aoaMax && ang > 1e-4) {
                const t = (ang - aoaMax) / ang, s = Math.sin(ang);
                const w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s;
                const cx = nx * w1 + ux * w2, cy = ny * w1 + uy * w2, cz = nz * w1 + uz * w2;
                const cn = Math.hypot(cx, cy, cz) || 1;
                nx = cx / cn; ny = cy / cn; nz = cz / cn;
            }
        }

        /* ---- attitude error, once, shared by gimbal and fins --------------- */
        w.axis(ax);
        errW[0] = ax[1] * nz - ax[2] * ny;
        errW[1] = ax[2] * nx - ax[0] * nz;
        errW[2] = ax[0] * ny - ax[1] * nx;
        M.qrotInv(errB, w.q, errW);
        const I = w.mp.Ixx;

        if (lit) {
            o[1] = (rung + 0.5) / LAD.length * 2 - 1;
            const need = Math.hypot(alx, aly, aT);
            o[0] = M.clamp(m * need / (LAD[rung] * T1), V.RAPTOR.minThrottle, 1) * 2 - 1;
        } else { o[0] = -1; o[1] = -1; }

        const T = w.act.thrust();
        if (T > 1e3) {
            const tauX = I * (K.kpAtt * errB[0] - K.kdAtt * w.w[0]);
            const tauY = I * (K.kpAtt * errB[1] - K.kdAtt * w.w[1]);
            const rz = ty.engines[0].z - w.mp.com, gm = ty.engines[0].gimbal;
            o[2] = M.clamp(Math.asin(M.clamp(tauX / (rz * T), -1, 1)) / gm, -1, 1);
            o[3] = M.clamp(Math.asin(M.clamp(tauY / (rz * T), -1, 1)) / gm, -1, 1);
        }
        /* Fins fly the whole descent, not only the coast: they are the only
         * pitch authority before ignition and they keep helping after it. */
        if (ty.fins.length && tel.q > 200) {
            const tauX = I * (K.kpFin * errB[0] - K.kdFin * w.w[0]);
            const tauY = I * (K.kpFin * errB[1] - K.kdFin * w.w[1]);
            finCommand(w, tauX, tauY, o);
        }
        return o;
    };
    self.handover = null;
    return self;
}

/* ------------------------------------------------------------------- run --- */
if (require.main === module) {
    const N = Number(process.argv[2] || 60);
    const STAGES = (process.argv[3] || "0").split(",").map(Number);
    const BASE = Number(process.env.BASE || 810000);
    for (const stage of STAGES) {
        let caught = 0, dry = 0; const tally = {}; const miss = [], vzs = [], propLeft = [];
        const hv = [], hvh = [], hp = [], he = [];
        for (let i = 0; i < N; i++) {
            const sc = SC.makeScenario(stage, BASE + stage * 100003 + i * 7919);
            sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
            const w = new WM.World(sc);
            const pil = makeSlam();
            const r = w.runEpisode(pil);
            if (pil.handover) { hv.push(pil.handover.v); hvh.push(pil.handover.vh);
                                hp.push(pil.handover.prop); he.push(pil.handover.err); }
            const nm = WM.OUTCOME_NAME[r.outcome];
            tally[nm] = (tally[nm] || 0) + 1;
            if (nm === "caught") caught++;
            if (w.dry) dry++;
            if (w.acc.gate) { miss.push(Math.hypot(w.acc.gate.dx, w.acc.gate.dy)); vzs.push(w.acc.gate.vz); }
            propLeft.push(w.prop / (sc.prop || 1));
        }
        const md = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
        const p = caught / N, se = Math.sqrt(p * (1 - p) / N);
        console.log(`stage ${stage} · ${SC.STAGES[stage].label}`);
        console.log(`   caught ${caught}/${N} (${(100 * p).toFixed(1)}% +/- ${(100 * se).toFixed(1)})   ran dry ${dry}/${N}` +
            `   median gate miss ${md(miss).toFixed(1)} m   vz ${md(vzs).toFixed(1)}   prop left ${(100 * md(propLeft)).toFixed(0)}%`);
        console.log(`   at handover (${hv.length}/${N} reached it): sink ${md(hv).toFixed(0)} m/s   ground speed ${md(hvh).toFixed(0)} m/s` +
            `   lateral error ${md(he).toFixed(0)} m   propellant left ${(100 * md(hp)).toFixed(0)}%`);
        console.log(`   ` + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
    }
}

module.exports = { makeSlam, GAINS };
