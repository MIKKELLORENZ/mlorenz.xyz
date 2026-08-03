/* pilot.js — the scripted autopilot. It is not the product; it is the ruler.
 *
 * Three jobs, and it is worth being explicit about all three because they pull
 * in different directions:
 *
 *  1. THE BASELINE THAT MAKES SCORES COMPARABLE. A 40 m terminal approach and a
 *     130 km out-of-plane rendezvous produce raw scores that differ by nothing
 *     meaningful and by everything arbitrary. Every scenario is therefore
 *     scored twice before any brain ever sees it — once by a do-nothing policy
 *     and once by this autopilot — and a brain's fitness on that scenario is
 *     reported as where it falls between the two. 0.0 is "no better than
 *     coasting"; 1.0 is "as good as a competent scripted pilot". That single
 *     transformation removes the per-stage fitness-scaling constants that every
 *     other sim in this collection has had to hand-tune, and it removes them in
 *     a way that cannot be gamed by getting very good at the easy stage.
 *
 *  2. THE AUDITION. A scenario is only allowed into the bank if this pilot can
 *     dock it AND the do-nothing policy cannot. Without the first test the
 *     curriculum quietly fills with impossible episodes and the population is
 *     selected on noise; without the second it fills with episodes where the
 *     orbit does all the work, every brain scores the same, and the generation
 *     carries no selection pressure at all.
 *
 *  3. AN OPTIONAL TEACHER. imitate.js can clone this controller into the
 *     network by DAgger and hand the result to the GA as a starting point. That
 *     is a shortcut, it is off by default, and the champion in the box was not
 *     produced that way — but on the far stages it is the difference between
 *     hours and days.
 *
 * WHAT IT KNOWS THAT THE NETWORK DOES NOT. It reads the true state, in LVLH,
 * with no noise, no lag and no field of view, and it plans with Clohessy-
 * Wiltshire — a linearisation the world does not obey. So it is neither a
 * ceiling nor a fair opponent: it has better information and a worse model. A
 * brain scoring above 1.0 has beaten it on its own terms, which several do on
 * the terminal stages, mostly by spending less propellant on attitude.
 */
"use strict";

const PILOT = {
    wpFar: 200,        // m, approach-initiation hold point on the corridor axis
    wpMid: 30,
    wpNear: 2.0,
    vClose: 0.05,      // m/s at contact — mid-envelope, not at the edge
    kVel: 0.30,        // s⁻¹, velocity-error → acceleration
    kLat: 0.16,        // s⁻¹, lateral offset → lateral velocity command
    axisAlign: 45,     // m, inside which the nose tracks the port AXIS not the port
    /* ATTITUDE IS A RATE CASCADE, NOT A PD.
     *
     * A flat proportional-derivative law on attitude has no bound on the slew
     * rate it will command: the terminal rate is where kp·θ meets kd·ω, which
     * for a 180° error is 0.24 rad/s — 13.7°/s, against a 15°/s tumbling
     * limit. Two of the sixteen far scenarios ended with the AUTOPILOT
     * declared out of control four seconds after ignition, having done nothing
     * but obey its own gains. Commanding a rate and then tracking it bounds
     * the slew by construction, which is how every real attitude controller is
     * built and why they all have a rate limit in the requirements. */
    kSlew: 0.12,        // s⁻¹, attitude error → commanded rate
    wMax: 2.0 * Math.PI / 180,   // rad/s, hard slew-rate limit
    kRate: 15,          // rate error → torque; kept below 1/(α·dt) for stability
    replanEvery: 60     // s
};

class Pilot {
    constructor(scenario, station) {
        this.sc = scenario;
        this.station = station;
        this.n = scenario.n;
        this.plan = null;
        this.tNextPlan = -1;
        this.phase = "far";
        this.lastCmd = new Float32Array(6);
        this.want = new Float64Array(6);
        this.acc = new Float64Array(6);     // delta-sigma pulse accumulator
    }

    /* One control decision. `st` is the same truth bundle world.js builds for
     * the sensors, minus the noise. Returns { cmd:Float32Array(6), coast, phase,
     * vDes }. */
    act(st, dtTick) {
        const B = st.B;
        const rLvlh = toLvlh(st.rho, B);
        const vLvlh = relVelLvlh(st.rs, st.vs, st.rho, st.rhoDot, B);
        const P = this.station.portPosLvlh();
        const N = this.station.portNormalLvlh();
        const dPort = V.sub(rLvlh, P);
        const range = V.len(dPort);
        const axial = V.dot(dPort, N);
        const lat = V.sub(dPort, V.mul(N, axial));

        let vDes, coast = false;

        /* The approach-initiation point: a hold point out along the port axis
         * that every long-range transfer targets. Aiming at the PORT from
         * 100 km would have the vessel arrive from whatever direction the
         * transfer happened to come in on — which for a V-bar rendezvous is
         * straight at the solar arrays. Aiming at a point 250 m out on the axis
         * makes the last leg a corridor approach by construction. */
        const AIP = V.add(P, V.mul(N, PILOT.wpFar));
        const rRel = V.sub(rLvlh, AIP);
        const dAip = V.len(rRel);
        const inCorridor = range < PILOT.wpFar * 1.15 &&
            V.dot(dPort, N) / Math.max(range, 1e-6) > Math.cos(this.station.port.coneHalfAngle);

        if (dAip > 1500 && !inCorridor) {
            /* ---- TRANSFER: plan once, burn, then WAIT ----
             *
             * The first version of this re-solved the targeting problem on
             * every control tick. That sounds like closed-loop guidance and is
             * actually a machine for burning propellant: the setpoint moves a
             * little every quarter second, so the velocity error never settles,
             * so the coast condition never fires, so the thrusters pulse
             * continuously for two hours. It reached the station on none of the
             * far scenarios and ran the tank dry on seven of eight.
             *
             * A transfer is impulsive. Solve once, burn to the solution, then
             * do nothing at all until either the arrival window opens or the
             * mid-course trim comes due — which is both what a real vehicle
             * does and, not by accident, the behaviour the network's coast
             * output has to discover for itself. */
            if (!this.plan || st.t >= this.plan.tNext) {
                const p = this._planTransfer(rLvlh, vLvlh, AIP, st.t, st.tLimit - st.t);
                const tof = Math.max(120, p.tArrive - st.t);
                const v0 = cwTargetVelocity(rRel, [0, 0, 0], tof, this.n);
                /* A REFERENCE TRAJECTORY, not a velocity to hold.
                 *
                 * Holding the solved v₀ constant was the second machine for
                 * burning propellant in this file. At 73 km the LVLH frame's
                 * own Coriolis term is 2nẋ ≈ 0.02 m/s²; a controller told to
                 * keep the relative velocity constant is therefore commanded to
                 * cancel 0.02 m/s² for the entire seventy minutes of the
                 * transfer, which is 82 m/s of propellant to fly a trajectory
                 * that costs 23 m/s if you simply let go of it. Measured: 58 m/s
                 * spent in the first 800 seconds and the tank dry by t=1190.
                 *
                 * So the plan stores a STATE and propagates it. The reference is
                 * where the vessel would be if the burn had been impulsive and
                 * perfect, and the control law tracks that — which means that
                 * once the burn is in, the reference and the vessel agree, the
                 * commanded correction falls to nothing, and the coast condition
                 * fires on its own. The trajectory does the work. */
                this.plan = {
                    tArrive: p.tArrive, t0: st.t,
                    ref0: [rRel[0], rRel[1], rRel[2],
                    (v0 || V.mul(rRel, -0.002))[0], (v0 || V.mul(rRel, -0.002))[1], (v0 || V.mul(rRel, -0.002))[2]],
                    // Trim a quarter of the way through, or every fifteen
                    // minutes, whichever comes first. Clohessy-Wiltshire is a
                    // linearisation and the world is not; over a whole orbit an
                    // untrimmed arrival misses by kilometres.
                    tNext: st.t + Math.max(150, Math.min(900, (p.tArrive - st.t) * 0.28))
                };
            }
            const ref = cwApply(cwState(st.t - this.plan.t0, this.n), this.plan.ref0);
            const posErr = [ref[0] - rRel[0], ref[1] - rRel[1], ref[2] - rRel[2]];
            // Gentle position feedback — a 500 s time constant. Anything
            // stiffer starts fighting the very dynamics the reference encodes.
            vDes = [ref[3] + 0.002 * posErr[0], ref[4] + 0.002 * posErr[1], ref[5] + 0.002 * posErr[2]];
            const err = V.len(V.sub(vDes, vLvlh));
            const tGo = this.plan.tArrive - st.t;
            if (err < 0.03 && tGo > 120) coast = true;
            this.phase = coast ? "coast" : "transfer";
        } else if (dAip > 25 && !inCorridor) {
            /* ---- APPROACH: glideslope to the hold point ----
             * Speed proportional to distance, capped. Cheap, robust, and the
             * distances are short enough that ignoring the orbital dynamics
             * costs a few centimetres per second rather than a trajectory. */
            this.plan = null;
            /* Capped by the ABORT ENVELOPE as well as by distance to the hold
             * point, at 60% of it. The two are not the same limit: the hold
             * point is 200 m out along the axis, so a vessel closing on it from
             * the side can be 1,400 m from the hold point and 250 m from the
             * station, and a speed chosen from the first number gets the
             * episode killed by a rule written about the second. */
            const vMag = Math.min(3.0,
                Math.max(0.08, 0.022 * dAip),
                0.6 * (0.10 + range / 50));
            vDes = V.mul(rRel, -vMag / Math.max(dAip, 1e-6));
            this.phase = "approach";
        } else {
            /* ---- the corridor: a glideslope straight down the port axis ----
             *
             * Axial speed falls linearly with distance to go and floors at the
             * contact speed, which is the standard approach profile and also
             * the only one the minimum-impulse bit can actually fly: below
             * about 15 mm/s a single 20 ms pulse of a 400 N quad is a larger
             * correction than the error being corrected. */
            const dGo = Math.max(0, axial - 0.0);
            const vAx = Math.min(0.55, Math.max(PILOT.vClose, 0.02 + (dGo - PILOT.wpNear) / 70));
            const vLat = V.mul(lat, -PILOT.kLat);
            const lm = V.len(vLat);
            const vLatC = lm > 0.18 ? V.mul(vLat, 0.18 / lm) : vLat;
            vDes = V.add(V.mul(N, -vAx), vLatC);
            this.phase = dGo < PILOT.wpNear ? "dock" : "corridor";
        }

        /* --------------------------------------------------- translation */
        /* A DELTA-SIGMA PULSE MODULATOR, not a proportional command.
         *
         * The thrusters have an 8% deadband and a 20 ms minimum pulse, so a
         * duty of 0.026 — which is what nulling a 6 mm/s² error asks for —
         * simply does not fire. A proportional controller therefore does
         * NOTHING at all through the entire last thirty metres and the vessel
         * arrives carrying whatever velocity it had when the command last
         * exceeded the deadband. Measured before this was added: every approach
         * contacted at 0.111–0.124 m/s against a 0.120 limit, and half a metre
         * off centre, with the controller apparently working perfectly.
         *
         * The fix is the same one real RCS phase-plane logic uses: integrate
         * the demanded impulse and fire a pulse when enough of it has piled up,
         * then subtract what was actually delivered. Small demands become
         * occasional pulses instead of silence, and the average comes out
         * right. */
        const cmd = this.lastCmd;
        cmd.fill(0);
        if (!coast) {
            const dv = V.sub(vDes, vLvlh);
            const aCmd = V.mul(dv, PILOT.kVel);
            // Into the body frame, then divide by what each group can push.
            const aEci = fromLvlh(aCmd, B);
            const aBody = Q.unrot(st.craft.q, aEci);
            const m = st.craft.mass;
            this.want[0] = aBody[0] * m / (aBody[0] >= 0 ? CRAFT.thrustMain : CRAFT.thrustBrake);
            this.want[1] = aBody[1] * m / CRAFT.thrustLateral;
            this.want[2] = aBody[2] * m / CRAFT.thrustLateral;
        } else { this.want[0] = this.want[1] = this.want[2] = 0; }

        /* ----------------------------------------------------- attitude */
        /* Point the nose at the port and roll to match its reference, always —
         * not only at the end. The laser has a 25° field of view and it is the
         * only sensor that can dock; arriving at 200 m with the nose 90° off
         * means spending the corridor slewing instead of closing. */
        /* Far out, point AT the port. Close in, point along its AXIS.
         *
         * These are not the same direction and the difference is the whole
         * alignment budget: sitting 0.5 m off centre at 2.2 m range, "aimed at
         * the port" is 13° away from "aligned with the port", and the capture
         * limit is 4°. Every approach was failing the angle check for this
         * reason while the controller reported zero pointing error. The blend
         * hands over between 45 m and 20 m, which is far enough out that the
         * slew has time to finish. */
        const axisBlend = Math.max(0, Math.min(1, (PILOT.axisAlign - range) / 25));
        const toPort = range > 1e-3 ? V.mul(dPort, -1 / range) : V.mul(N, -1);
        const aim = V.unit(V.add(V.mul(toPort, 1 - axisBlend), V.mul(N, -axisBlend)));
        const qd = lookAt(fromLvlh(aim, B), fromLvlh(this.station.portUpLvlh(), B));
        const e = attitudeError(st.craft.q, qd);
        /* Damp toward the ORBIT RATE, not toward zero. The desired attitude is
         * fixed with respect to the station, and the station goes round the
         * Earth once every 93 minutes — so holding it means rotating at
         * 0.065°/s inertially. A rate damper that pulls the body rate to zero
         * is fighting the very attitude the proportional term is asking for,
         * and it settles at a permanent few-degree lag with the thrusters
         * gently pulsing forever. */
        const wDes = Q.unrot(st.craft.q, lvlhRate(st.rs, st.vs));
        for (let k = 0; k < 3; k++) {
            const wCmd = Math.max(-PILOT.wMax, Math.min(PILOT.wMax, PILOT.kSlew * e[k]));
            this.want[3 + k] = PILOT.kRate * (wCmd + wDes[k] - st.craft.w[k]);
        }
        /* AN ATTITUDE DEADBAND, because pointing is not free.
         *
         * The pulse modulator will happily chase the last thousandth of a
         * degree forever, and over a two-hour rendezvous "forever" is most of
         * the propellant budget: measured without this, the far stages burned
         * 35 m/s of translation and still ran the tank dry, because attitude
         * had quietly spent the rest. Real RCS logic has a deadband for exactly
         * this reason. It tightens inside 60 m, where the 4° capture limit
         * starts to matter and the mission is nearly over anyway. */
        const attTol = range < 60 ? 0.004 : 0.025;      // rad
        const rateTol = range < 60 ? 5e-5 : 3e-4;       // rad/s
        if (V.len(e) < attTol && V.len(V.sub(st.craft.w, wDes)) < rateTol) {
            this.want[3] = this.want[4] = this.want[5] = 0;
            this.acc[3] = this.acc[4] = this.acc[5] = 0;
        }

        /* All six axes through the pulse modulator together. Attitude needs it
         * more than translation did: with a proportional gain of 0.7 and a
         * minimum pulse worth 4% of full torque, any pointing error under 3.3°
         * commands less than one pulse and produces no torque at all. The
         * capture limit is 4°, so without this the vehicle physically cannot
         * align well enough to dock, and the controller reports itself as
         * converged the whole time. */
        for (let k = 0; k < 6; k++) {
            this.acc[k] += this.want[k] * dtTick;
            const c = clamp1(this.acc[k] / dtTick);
            cmd[k] = c;
            this.acc[k] -= Craft.quantise(c, dtTick) * dtTick;
            // No wind-up past one tick of full authority: a saturated axis would
            // otherwise keep firing long after the error it was chasing is gone.
            this.acc[k] = Math.max(-dtTick, Math.min(dtTick, this.acc[k]));
        }

        // Coasting means coasting: a vessel that keeps trimming its attitude
        // through a forty-minute drift spends more propellant on pointing than
        // it spent on the transfer. If the relative rates are already small,
        // stop firing entirely and let it drift.
        if (coast) {
            const wr = V.len(V.sub(st.craft.w, wDes));
            if (wr < 0.0004 && V.len(e) < 0.25) {
                cmd.fill(0);
                this.acc.fill(0);
            } else coast = false;
        }
        return { cmd, coast, phase: this.phase, vDes };
    }

    /* Choose the time of flight for the big transfer by scanning, not by a
     * formula.
     *
     * Φ_rv is singular at whole multiples of the orbital period — the transfer
     * that goes all the way round and returns to the same place is not unique —
     * and it is nearly singular near them, which is where a formula-chosen time
     * of flight lands you with a 200 m/s solution to a 6 m/s problem. Scanning
     * the achievable window and taking the cheapest total impulse also finds
     * the genuinely orbital answer on its own: for a vessel already drifting in
     * from 100 km, the cheapest transfer is usually the one that changes almost
     * nothing and simply arrives an orbit later. */
    _planTransfer(r, v, target, tNow, tRemain) {
        const T = 2 * Math.PI / this.n;
        const rRel = V.sub(r, target);
        /* THE CLOCK IS A CONSTRAINT, NOT A PREFERENCE. Left to minimise
         * impulse alone the scan happily returns a 1.8-orbit transfer, and if
         * that is re-planned an hour into a 3.6-hour mission it arrives after
         * the episode has already ended. Measured: the vessel drifted between
         * 20 and 43 km for the last two hours of every far scenario, each trim
         * politely re-planning an arrival it would never live to see. Allow at
         * most 62% of the remaining clock, so there is always time to fly the
         * approach and the corridor afterwards. */
        const tCap = Math.max(240, (tRemain != null ? tRemain : 1e9) * 0.62);
        let best = null;
        const windows = [[240, 0.45 * T], [0.55 * T, 0.95 * T], [1.05 * T, 1.9 * T]];
        for (const [lo, hi] of windows) {
            if (lo > tCap) break;
            const top = Math.min(hi, tCap);
            for (let k = 0; k <= 16; k++) {
                const tof = lo + (top - lo) * k / 16;
                const v0 = cwTargetVelocity(rRel, [0, 0, 0], tof, this.n);
                if (!v0) continue;
                const vf = cwFinalVelocity(rRel, v0, tof, this.n);
                // A gentle preference for arriving sooner — 0.8 mm/s per second
                // of flight, enough to break ties between near-equal transfers
                // without ever outweighing a genuinely cheaper one.
                const cost = V.len(V.sub(v0, v)) + V.len(vf) + tof * 0.0008;
                if (!best || cost < best.cost) best = { cost, tof, v0 };
            }
        }
        if (!best) best = { cost: 0, tof: Math.min(tCap, 0.3 * T), v0: V.mul(rRel, -0.001) };
        return { tArrive: tNow + best.tof, cost: best.cost };
    }
}

function clamp1(x) { return x > 1 ? 1 : (x < -1 ? -1 : x); }

/* Build the attitude whose +X points along `fwd` and whose +Z is as close to
 * `up` as that allows. Both in ECI. */
function lookAt(fwd, up) {
    const x = V.unit(fwd);
    let u = V.sub(up, V.mul(x, V.dot(up, x)));
    if (V.len(u) < 1e-6) {
        u = V.sub([0, 0, 1], V.mul(x, x[2]));
        if (V.len(u) < 1e-6) u = V.sub([0, 1, 0], V.mul(x, x[1]));
    }
    const z = V.unit(u);
    const y = V.cross(z, x);
    // Rotation matrix (columns x, y, z) → quaternion, Shepperd's branchy form
    // so that no branch ever takes a square root of a negative number.
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
}

/* The body-frame rotation vector that takes the current attitude to the
 * desired one: axis × angle, in radians, expressed in body axes. Feed it
 * straight into a proportional term.
 *
 * The sign flip on a negative scalar part is the quaternion double cover:
 * without it the controller cheerfully slews 350° the long way round rather
 * than 10° back, which on a vehicle with a 14-second 90° slew is most of a
 * minute of propellant and, during a terminal approach, the whole mission. */
function attitudeError(q, qd) {
    let e = Q.mul(Q.conj(q), qd);
    if (e[0] < 0) e = [-e[0], -e[1], -e[2], -e[3]];
    const s = Math.sqrt(Math.max(0, 1 - e[0] * e[0]));
    if (s < 1e-8) return [0, 0, 0];
    const k = 2 * Math.atan2(s, e[0]) / s;
    return [e[1] * k, e[2] * k, e[3] * k];
}

if (typeof module !== "undefined") module.exports = { Pilot, PILOT, lookAt, attitudeError, clamp1 };
