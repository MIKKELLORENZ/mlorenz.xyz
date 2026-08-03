/* pid.js — the conventional controller the learned one is measured against.
 *
 * This is the honest baseline, so it is built the way a real one is built:
 *
 *   1. A MAGNETIC OBSERVER. It never sees the plasma position. It sees the same
 *      noisy probes and flux loops the network sees, subtracts the field it
 *      knows its own coil currents are producing, and estimates R and Z from
 *      what is left by ridge regression against a set of pre-computed plasma
 *      positions. That regression is fitted from the machine geometry alone.
 *      Crucially it CANNOT subtract the vessel eddy currents, because nobody
 *      measures those — which is precisely the screening effect that makes this
 *      problem hard, and the baseline eats it just like the network does.
 *
 *   2. A CASCADE. A 10 kHz inner loop drives the fast in-vessel coil from the
 *      estimated vertical position. A 2 kHz outer loop drives the shaping and
 *      ohmic coils from radial position, plasma current and elongation error,
 *      allocating each demand onto the coils through a minimum-norm basis
 *      obtained from the same pseudo-inverse the task registry uses. (The gain
 *      sweep wanted the outer loop fast: the radial plant relaxes in ~2 ms, so
 *      a 500 Hz outer loop is only four samples per time constant.)
 *
 * WHERE IT LOSES, AND WHY THAT IS THE POINT. Each outer channel is tuned as
 * though it acted alone. It does not: every coil moves every sensor, so the
 * radial loop fights the elongation loop, and both disturb the vertical loop
 * the fast coil is trying to close. Decoupling that by hand is exactly the work
 * a learned controller does not have to be told how to do.
 */
"use strict";

/* `filamentSignature`, `ridge` and the observer itself now live in tokamak.js:
 * the NETWORK reads the same estimate this controller does, and two copies of
 * an observer are two chances for the baseline and the learned policy to be
 * measured against different notions of where the plasma is. Re-exported at the
 * bottom of this file so existing callers are undisturbed. */

/* Minimum-norm coil-current directions that move exactly one field quantity at
 * the plasma: vertical field (radial position), radial field (vertical force),
 * first radial derivative (elongation), second (triangularity). Same
 * pseudo-inverse as the task registry's equilibrium solver, used here as a
 * control allocation matrix. */
/* The four field quantities one ampere in circuit j produces at (R, Z):
 * vertical field, radial field, and the first two radial derivatives of the
 * vertical field. Everything in the control allocation is expressed in these. */
function fieldQuantities(mac, j, R, Z) {
    const h = 0.045;
    const g = mac.gBZ[j];
    const bzm = mac.sample(g, R - h, Z), bz0 = mac.sample(g, R, Z), bzp = mac.sample(g, R + h, Z);
    return [bz0, mac.sample(mac.gBR[j], R, Z), (bzp - bzm) / (2 * h), (bzp - 2 * bz0 + bzm) / (h * h)];
}

function coilBasis(mac, R, Z) {
    const nSolve = 16;
    const rows = [];
    for (let r = 0; r < 4; r++) rows.push(new Float64Array(nSolve));
    for (let j = 0; j < nSolve; j++) {
        const q = fieldQuantities(mac, j, R, Z);
        for (let r = 0; r < 4; r++) rows[r][j] = q[r];
    }
    const sc = [1 / 0.05, 1 / 0.05, 1 / 0.04, 1 / 0.4];
    for (let r = 0; r < 4; r++) for (let j = 0; j < nSolve; j++) rows[r][j] *= sc[r];
    const G = new Float64Array(16);
    let tr = 0;
    for (let r = 0; r < 4; r++) {
        for (let s = 0; s < 4; s++) {
            let v = 0;
            for (let j = 0; j < nSolve; j++) v += rows[r][j] * rows[s][j];
            G[r * 4 + s] = v;
            if (r === s) tr += v;
        }
    }
    for (let r = 0; r < 4; r++) G[r * 4 + r] += 1e-6 * (tr / 4);   // relative, see tasks.js
    const Gi = invert(G, 4);
    const basis = [];
    for (let target = 0; target < 4; target++) {
        const y = new Float64Array(4);
        for (let r = 0; r < 4; r++) y[r] = Gi[r * 4 + target] * sc[target];
        const v = new Float64Array(mac.nc);
        for (let j = 0; j < nSolve; j++) {
            let s = 0;
            for (let r = 0; r < 4; r++) s += rows[r][j] * y[r];
            v[j] = s;
        }
        basis.push(v);
    }
    return basis;   // [dBz, dBr, d(dBz/dR), d(d²Bz/dR²)]
}

/* Gains. Tuned by the sweep in test_headless.js (`node test_headless.js tune`),
 * not by taste — the write-up claims this baseline was tuned honestly and this
 * is where that claim is cashed. */
const PID_GAINS = {
    zKp: 20000, zKd: 64, zKi: 5.0e4,       // fast coil: volts per metre of Z error
    rKp: 0.20, rKd: 1.2e-3, rKi: 2.0,      // radial position → ΔB_z demand (T per m)
    // Plasma current → ohmic volts. Nearly pure proportional: with the supplies'
    // resistive feed-forward already holding the solenoid current, integral action
    // on top of a 400 ms circuit mostly winds up. Swept on the short tasks AND on
    // the 1.2 s scripted discharge, where a larger ipKi rings by ±60 kA.
    ipKp: 0.006, ipKi: 0.02,
    // Per-coil current loop. No resistive feed-forward term: the supply already
    // applies R̂·I of its own (see Tokamak.step), so this loop only has to
    // supply the inductive voltage that changes the current.
    coilKp: 2.2, coilKff: 0.0,
    outerEvery: 5                           // 2 kHz outer loop (the sweep wanted it fast)
};

class PIDController {
    constructor(mac, gains) {
        this.mac = mac || getMachine();
        this.g = Object.assign({}, PID_GAINS, gains || {});
        this.observer = getObserver(this.mac);
        this.basis = coilBasis(this.mac, VESSEL.R0, 0);
        // The ohmic and fast circuits produce field at the plasma too, and the
        // shaping coils have to make up the difference. The controller measures
        // those currents, so subtracting their contribution is fair game — and
        // omitting it is not a small error: the ohmic stack alone contributes
        // more vertical field than the entire equilibrium needs.
        //
        // The fast coil is deliberately NOT in this list. It is a control
        // actuator, not a disturbance: compensating for its field means the
        // shaping coils are commanded to undo every correction the vertical loop
        // makes, and the two actuators spend the whole discharge cancelling each
        // other while the plasma falls out of the machine. That bug held the
        // G coil at its 1 kA limit from six milliseconds in.
        this.aux = [16, 17];
        this.qAux = this.aux.map(j => fieldQuantities(this.mac, j, VESSEL.R0, 0));
        this.Itar = new Float64Array(this.mac.nc);
        this.act = new Float64Array(19);
        this._est = { R: VESSEL.R0, Z: 0, Ip: 0 };
    }

    /* Where the plasma is, according to the magnetics. Delegated to the shared
     * MagneticObserver — see the note at the top of this file. */
    estimate(tok) { return this.observer.estimate(tok, this._est); }

    reset(task) {
        this.task = task;
        this.k = 0;
        this.zInt = 0; this.zPrev = 0; this.zPrevValid = false;
        this.rInt = 0; this.rPrev = 0; this.rPrevValid = false;
        this.ipInt = 0; this.vOhm = 0;
        this.Itar.set(task.initial.coils);
        this.act.fill(0);
        this.est = { R: VESSEL.R0, Z: 0, Ip: task.initial.Ip };
    }

    /* One control step. Returns normalised actions in [−1, 1] for all 19
     * circuits. */
    step(tok) {
        const g = this.g, mac = this.mac;
        const est = this.est = this.estimate(tok);
        const tgt = this.task.targetAt(tok.t);

        // ---- fast inner loop: vertical position on the G coil (10 kHz) -------
        const ez = tgt.Z - est.Z;
        const dz = this.zPrevValid ? (ez - this.zPrev) / DT_CTRL : 0;
        this.zPrev = ez; this.zPrevValid = true;
        // Anti-windup sized in the units the term is used in: zKi · zIntMax must
        // not exceed the coil's 100 V supply, so the integrator can never ask for
        // more than the actuator can give. (Measured, this changes nothing about
        // the current gains — the loop never accumulates that much error. It is
        // here so that a hand-edited zKi cannot silently create a wind-up bug.)
        const zIntMax = mac.circuits[18].vmax / Math.max(1, g.zKi);
        this.zInt = clamp(this.zInt + ez * DT_CTRL, -zIntMax, zIntMax);
        const vG = g.zKp * ez + g.zKd * dz + g.zKi * this.zInt;
        this.act[18] = clamp(vG / mac.circuits[18].vmax, -1, 1);

        // ---- outer loop at 500 Hz -------------------------------------------
        if (this.k % g.outerEvery === 0) {
            const dt = g.outerEvery * DT_CTRL;

            // Radial position: a plasma that needs to move outward needs LESS
            // inward force, i.e. a less negative vertical field.
            //
            // The radial plant relaxes in ~2 ms, which is only one outer-loop
            // period away, so this loop needs real derivative damping or it just
            // oscillates the plasma across the vessel at 500 Hz.
            const er = tgt.R - est.R;
            const der = this.rPrevValid ? (er - this.rPrev) / dt : 0;
            this.rPrev = er; this.rPrevValid = true;
            this.rInt = clamp(this.rInt + er * dt, -0.04, 0.04);
            const dBz = clamp(g.rKp * er + g.rKd * der + g.rKi * this.rInt, -0.03, 0.03);

            // Elongation and triangularity are run FEED-FORWARD from the task.
            // Nothing here estimates κ from the magnetics — that would need a
            // second observer and, on a real machine, a boundary reconstruction
            // running inside the control cycle. It is a genuine weakness of the
            // baseline: it cannot correct a shape error it cannot see, and it is
            // one of the places the learned controller has room to win.
            const ft = fieldTargetsFor(tgt);
            const dem = [ft.bz + dBz, 0, ft.dBdR, ft.d2BdR2];
            for (let k = 0; k < this.aux.length; k++) {
                const I = tok.coilMeas[this.aux[k]], q = this.qAux[k];
                for (let r = 0; r < 4; r++) dem[r] -= q[r] * I;
            }
            const B = this.basis;
            for (let j = 0; j < 16; j++) {
                let v = 0;
                for (let r = 0; r < 4; r++) v += dem[r] * B[r][j];
                this.Itar[j] = clamp(v, -mac.imax[j] * 0.9, mac.imax[j] * 0.9);
            }

            // Ohmic: plasma current error, driven as a differential pair so the
            // stray radial field the pair leaves behind stays bounded.
            //
            // Note the minus sign, which is transformer action and not a typo: a
            // FALLING solenoid current gives a positive loop voltage and drives
            // I_p UP. Getting this backwards produces a controller that runs the
            // plasma current away from its target as fast as the supply allows,
            // which is exactly what the first version did.
            const eip = tgt.Ip - est.Ip;
            this.ipInt = clamp(this.ipInt + eip * dt, -6e4, 6e4);
            this.vOhm = clamp(-(g.ipKp * eip + g.ipKi * this.ipInt), -1400, 1400);
        }

        // ---- per-coil current loop → voltage --------------------------------
        for (let j = 0; j < 16; j++) {
            const err = this.Itar[j] - tok.coilMeas[j];
            const v = g.coilKp * err + g.coilKff * this._res(j) * this.Itar[j];
            this.act[j] = clamp(v / mac.circuits[j].vmax, -1, 1);
        }
        this.act[16] = clamp(this.vOhm / 1400, -1, 1);
        this.act[17] = clamp(-this.vOhm * 0.45 / 1400, -1, 1);

        this.k++;
        return this.act;
    }

    _res(j) { return this.mac.res[j]; }
}

if (typeof module !== "undefined") {
    // filamentSignature/ridge are re-exported from tokamak.js so the old import
    // sites keep working after the observer moved.
    module.exports = { PIDController, PID_GAINS, coilBasis, fieldQuantities, filamentSignature, ridge };
}
