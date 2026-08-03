/* world.js — one episode: one brain, one scenario, from separation to contact.
 *
 * THE VARIABLE CLOCK IS THE HEART OF THIS FILE. A rendezvous is four decades of
 * time — 20 ms thruster pulses inside a 4 hour mission — and simulating it at
 * the resolution the pulses need would make the far stages a hundred times more
 * expensive to evaluate than the near ones, which in a genetic algorithm means
 * they simply never get trained. So the episode runs on three clocks:
 *
 *   control tick   0.25 s inside 300 m, 0.5 s inside 3 km, 1 s beyond
 *                  The fast head, thruster commands, one RK4 step.
 *   guidance tick  every 4 s. The slow head. Emits a velocity setpoint, a
 *                  pointing direction, and a coast request.
 *   coast          1–20 s steps, granted by the network, no thrust, RK4 the
 *                  whole way. Sensors still sample and every abort gate is
 *                  still checked, so a coast is a fast-forward and not a
 *                  blindfold.
 *
 * The cost of an episode is therefore set by how many MANOEUVRES the brain
 * makes, not by how long the mission is. A 130 km rendezvous that phases
 * correctly — one burn, forty minutes of nothing, one burn, then a careful
 * terminal approach — costs about what a 60 m approach costs. A brain that
 * refuses to coast pays for its own indecision in evaluation time, and the
 * early-abort gates below take away the rest of it.
 *
 * FIVE WAYS TO END EARLY, and they exist as much for the compute budget as for
 * realism. Most brains, most of the time, are eliminated in the first minute of
 * simulated flight:
 *
 *   flyby      range exceeds 1.8× where it started — it is leaving
 *   receded    got inside 200 m, then let the range grow 60% off its best —
 *              it went past the station, which is the specific failure worth
 *              killing early because the vessel will now spend an hour not
 *              coming back
 *   overspeed  closing faster than 0.10 + R/50 m/s inside 500 m — the real
 *              approach-corridor rule; this arrival is going to be an impact
 *   collision  the hull touched structure that is not the docking port
 *   tumbling   body rate past 15°/s; nothing is recoverable from there
 *
 * FITNESS IS AN ADVANTAGE, NOT A SCORE. The raw number below is turned into
 * (brain − doNothing) / (autopilot − doNothing) per scenario before anything
 * compares two brains. See pilot.js for why, and calibrate() at the bottom for
 * where it happens.
 */
"use strict";

/* Range is measured centre-of-mass to port, because the interface point swings
 * with attitude and a range that jitters when the vessel rolls is a range no
 * progress term can be built on. The consequence is that a PERFECT docking
 * bottoms out at 2.2 m — the length of the docking probe — and not at zero, so
 * that is where "arrived" has to sit. Leaving it at 1 m capped the progress
 * term at 0.77 for a flawless approach and quietly told every brain that the
 * last stretch was not worth flying. */
const DOCK_ARRIVE = 2.2;        // m — = CRAFT.dockOffset
const GUID_PERIOD = 4.0;        // s between guidance-head decisions
const COAST_MIN = 5, COAST_MAX = 400;

const FIT = {
    progress: 4.0,
    corridor: 1.0,
    dock: 6.0,
    dockAlign: 1.2,
    dockSpeed: 1.2,
    dockFuel: 1.0,
    dockTime: 1.6,
    contact: 1.0,        // base for touching the port outside the envelope
    contactSoft: 2.5,
    fuel: 0.5,           // maximum total propellant penalty — capped on purpose
    collision: -0.5,
    flyby: -0.25,
    tumble: -0.25
};

class World {
    /* `agent` is a Brain, a Pilot, or null (the do-nothing baseline).
     * `opts.noiseSeed` seeds the sensor noise and is deliberately independent
     * of which brain is flying: every brain in a generation meets the same
     * scenario AND the same noise realisation, so a mutation is judged on the
     * mutation and not on the weather. */
    constructor(scenario, agent, opts) {
        opts = opts || {};
        this.sc = scenario;
        this.agent = agent;
        this.isPilot = !!(agent && agent.act);
        this.station = new Station(scenario.station);
        this.craft = new Craft({ prop: scenario.prop, w: scenario.w0 });
        this.rng = mulberry32((opts.noiseSeed != null ? opts.noiseSeed : scenario.seed) ^ 0x5bf03635);
        this.sensors = new Sensors(opts.noise === false ? 0 : scenario.navNoise, this.rng);

        const k = keplerToCartesian(scenario.el);
        const B0 = lvlhBasis(k.r, k.v);
        // The scenario states the relative position and velocity in LVLH, which
        // is how a rendezvous is specified; the integrator wants ECI. The
        // velocity conversion must add back the frame rotation ω × ρ, or a
        // vessel specified as "station-keeping" starts with 0.23 m/s of drift
        // it was never given.
        const rho = fromLvlh(scenario.rel.p, B0);
        const w0 = lvlhRate(k.r, k.v);
        const rhoDot = V.add(fromLvlh(scenario.rel.v, B0), V.cross(w0, rho));

        this.y = new Float64Array(12);
        for (let i = 0; i < 3; i++) {
            this.y[i] = k.r[i]; this.y[3 + i] = k.v[i];
            this.y[6 + i] = rho[i]; this.y[9 + i] = rhoDot[i];
        }

        /* THE INITIAL ATTITUDE IS SPECIFIED IN LVLH AND MUST BE CONVERTED.
         *
         * scenarios.js builds q₀ by pointing the body +X axis at the station —
         * a statement about LVLH directions, because that is the only frame in
         * which "at the station" means anything. But craft.q is a body→ECI
         * rotation everywhere else in the sim (thrust, sensors, the attitude
         * integrator all depend on that). Installing the LVLH quaternion
         * directly composes it with whatever arbitrary rotation happens to
         * relate ECI to LVLH at t=0, which is to say: it randomises it.
         *
         * The whole attitude ramp in the curriculum was therefore doing
         * nothing. Stage 0 declares a 25° pointing error and was measured
         * starting at 172° — nose pointing directly away from the station, an
         * 85-second slew out of a 480-second mission, on the rung that is
         * supposed to be the gentle one. Stages 1–5 declare 180° and got 180°,
         * which is why this hid: only the easy end of the ramp was wrong, and
         * only the easy end matters for getting a run started. */
        const qB = Q.fromBasis(B0.x, B0.y, B0.z);
        this.craft.q = Q.norm(Q.mul(qB, scenario.q0));
        /* Body rates are body-frame components and need no conversion, but the
         * scenario's figure is a PERTURBATION about holding attitude on the
         * station — and holding attitude on the station means rotating at the
         * orbit rate. Adding it makes rate0 = 0 mean "pointing steadily",
         * rather than "inertially fixed and therefore drifting 0.065°/s off". */
        const wOrb = Q.unrot(this.craft.q, lvlhRate(k.r, k.v));
        this.craft.w = [scenario.w0[0] + wOrb[0], scenario.w0[1] + wOrb[1], scenario.w0[2] + wOrb[2]];

        this.t = 0;
        this.tLimit = scenario.tLimit;
        this.over = false;
        this.outcome = null;
        this.coasting = false;
        this.coastLeft = 0;
        this.tNextGuid = -1;
        this.lastGuid = new Float32Array(7);
        this.lastCtrl = new Float32Array(6);
        this.cmd = new Float32Array(6);

        this.R0 = scenario.R0;
        this.bestRange = Infinity;
        this.corridorTime = 0;
        this.activeTime = 0;
        this.prevAxial = null;
        this.report = null;
        this.dvSetpoint = [0, 0, 0];
        this.pointCmd = null;
        this.trackErr = 0;
        this.burns = 0;
        this.coasts = 0;
        this.coastTotal = 0;

        this.record = opts.record ? [] : null;
        this.recordEvery = opts.recordEvery || 0.25;
        this.tNextRec = 0;
        this.maxFrames = opts.maxFrames || 24000;

        this._refresh();
        this.sensors.sample(this._bundle());
    }

    /* Cached per-step geometry. */
    _refresh() {
        const rs = [this.y[0], this.y[1], this.y[2]];
        const vs = [this.y[3], this.y[4], this.y[5]];
        const rho = [this.y[6], this.y[7], this.y[8]];
        const rhoDot = [this.y[9], this.y[10], this.y[11]];
        const B = lvlhBasis(rs, vs);
        this.rs = rs; this.vs = vs; this.rho = rho; this.rhoDot = rhoDot; this.B = B;
        this.rLvlh = toLvlh(rho, B);
        this.vLvlh = relVelLvlh(rs, vs, rho, rhoDot, B);
        this.portLvlh = this.station.portPosLvlh();
        this.portN = this.station.portNormalLvlh();
        this.dPort = V.sub(this.rLvlh, this.portLvlh);
        this.range = V.len(this.dPort);
        this.closing = this.range > 1e-6 ? -V.dot(this.dPort, this.vLvlh) / this.range : 0;
        if (this.range < this.bestRange) this.bestRange = this.range;
    }

    _bundle() {
        const B = this.B;
        return {
            t: this.t, tLimit: this.tLimit,
            rs: this.rs, vs: this.vs, rho: this.rho, rhoDot: this.rhoDot, B,
            craft: this.craft,
            portOffsetEci: fromLvlh(this.portLvlh, B),
            portNormalEci: fromLvlh(this.portN, B),
            portUpEci: fromLvlh(this.station.portUpLvlh(), B),
            reflectorsEci: this.station.reflectorsLvlh().map(r => fromLvlh(r, B)),
            lastGuid: this.lastGuid, lastCtrl: this.lastCtrl,
            coasting: this.coasting, coastLeft: this.coastLeft
        };
    }

    /* The control tick shrinks as the vessel closes. Nothing subtle: at 40 km
     * a quarter-second decision rate is 160,000 network evaluations of pure
     * waste, and at 4 m a one-second rate is 5 cm of uncommanded drift per
     * decision, which is half the capture envelope. */
    _dtCtl() {
        const R = this.range;
        if (R < 300) return 0.25;
        if (R < 3000) return 0.5;
        if (R < 20000) return 1.0;
        return 2.0;
    }

    /* ------------------------------------------------------------- step */
    step() {
        if (this.over) return;

        /* ---- decide ---- */
        let coastReq = false, coastDur = 0;
        if (this.isPilot) {
            const a = this.agent.act(this._bundle(), this._dtCtl());
            this.cmd.set(a.cmd);
            this.phase = a.phase;
            if (a.vDes) this.dvSetpoint = fromLvlh(a.vDes, this.B);
            coastReq = a.coast;
            coastDur = 60;
        } else if (this.agent) {
            const input = this.sensors.assemble(this.t);
            const latent = this.agent.trunkForward(input);
            if (this.t >= this.tNextGuid) {
                const g = this.agent.guidance(latent);
                this.lastGuid.set(g);
                this.tNextGuid = this.t + GUID_PERIOD;
                /* The slow head's outputs have real semantics — a velocity
                 * setpoint and a pointing direction, both in ECI — but nothing
                 * makes the fast head obey them. There is no tracking loop and
                 * no supervision. They are a message from one half of the
                 * genome to the other, and the only reason they mean anything
                 * at all is that a pair of heads which agree docks and a pair
                 * which argues does not. `trackErr` is recorded so the UI can
                 * show how much the two ended up agreeing; it is not scored. */
                const q = (x) => x * Math.abs(x) * 15;      // quadratic: fine near zero
                this.dvSetpoint = [q(g[0]), q(g[1]), q(g[2])];
                this.pointCmd = V.len([g[3], g[4], g[5]]) > 0.1 ? V.unit([g[3], g[4], g[5]]) : null;
                const c = (g[6] + 1) / 2;
                if (c > 0.5) {
                    coastReq = true;
                    coastDur = Math.max(COAST_MIN, Math.min(COAST_MAX, this.range / 6)) * (c - 0.5) * 2;
                }
            }
            const ctrl = this.agent.control(latent, this.lastGuid);
            this.lastCtrl.set(ctrl);
            this.cmd.set(ctrl);
            this.trackErr = V.len(V.sub(this.dvSetpoint, this.rhoDot));
        } else {
            this.cmd.fill(0);          // the do-nothing baseline
        }

        if (coastReq && this.range > 12 && coastDur > 1) {
            this.coasting = true;
            this.coastLeft = Math.min(coastDur, this.tLimit - this.t);
            this.coasts++;
        }

        if (this.coasting) { this._coastChunk(); return; }

        /* ---- act ---- */
        const dt = Math.min(this._dtCtl(), this.tLimit - this.t);
        if (dt <= 0) { this._end("timeout"); return; }
        const wr = this.craft.commandWrench(this.cmd, dt);
        if (wr.on) this.burns++;
        this.activeTime += dt;
        const fEci = Q.rot(this.craft.q, wr.f);
        const a = V.mul(fEci, 1 / this.craft.mass);
        this.craft.dvUsed += V.len(a) * dt;
        this._advance(dt, a, wr.t);
        this._afterStep(dt);
    }

    /* A granted coast: no thrust, no attitude control, long RK4 steps.
     *
     * The step is capped three ways — by range (never move more than a small
     * fraction of the distance to the target in one step), by rotation rate
     * (never turn more than 0.05 rad in one step, or the quaternion integration
     * stops being accurate and a slowly tumbling vessel arrives pointing
     * somewhere the sim invented), and by the mission clock. */
    _coastChunk() {
        const wmag = V.len(this.craft.w);
        let dt = Math.max(1, Math.min(20, this.range / 300));
        if (wmag > 1e-6) dt = Math.min(dt, 0.05 / wmag);
        dt = Math.min(dt, this.coastLeft, this.tLimit - this.t);
        if (dt <= 1e-6) { this.coasting = false; this.coastLeft = 0; return; }
        this.craft.firing.fill(0);
        this.craft.firingRcs.fill(0);
        this._advance(dt, [0, 0, 0], [0, 0, 0]);
        this.coastLeft -= dt;
        this.coastTotal += dt;
        if (this.coastLeft <= 1e-6) { this.coasting = false; this.coastLeft = 0; }
        this._afterStep(dt);
    }

    _advance(dt, aEci, torqueBody) {
        this.prevAxial = this._axialNow();
        this.y = stepRK4(this.y, dt, aEci);
        const att = stepAttitude(this.craft.q, this.craft.w, this.craft.I, torqueBody, dt);
        this.craft.q = att.q; this.craft.w = att.w;
        this.t += dt;
        this._refresh();
    }

    /* Signed distance from the docking-port plane to the chaser's interface
     * point, positive outside. */
    _axialNow() {
        if (!this.B) return null;
        const ip = V.add(this.rLvlh, toLvlh(this.craft.interfaceOffset(), this.B));
        return V.dot(V.sub(ip, this.portLvlh), this.portN);
    }

    _afterStep(dt) {
        this.sensors.sample(this._bundle());
        /* Corridor credit requires ACTUALLY CLOSING, not merely drifting the
         * right way. At `closing > 0` the do-nothing policy banked 160 s of it
         * on residual millimetre-per-second drift and scored 0.70 for sitting
         * still — which then became 0.70 that any brain leaving the corridor
         * had to make back before it was even level. */
        if (this.station.inCorridor(this.rLvlh) && this.closing > 0.02) this.corridorTime += dt;
        this._recordFrame();
        this._checkEnd(dt);
    }

    /* --------------------------------------------------------- outcomes */
    _checkEnd(dt) {
        if (this.over) return;

        /* Contact. Detected on the sign change of the axial coordinate so that
         * a fast arrival cannot tunnel through the port plane between steps —
         * at 0.5 m/s and a 0.25 s tick the vessel moves 12 cm per step, which
         * is the whole capture envelope. */
        const ax = this._axialNow();
        if (this.prevAxial != null && this.prevAxial > 0 && ax <= 0) {
            const ipOff = this.craft.interfaceOffset();
            const ip = V.add(this.rLvlh, toLvlh(ipOff, this.B));
            // Velocity of the interface point, not of the centre of mass: a
            // vessel rotating at 0.5°/s has its probe moving 2 cm/s sideways
            // relative to its hull, which is most of the lateral rate limit.
            const vIp = V.add(this.vLvlh, toLvlh(Q.rot(this.craft.q, V.cross(this.craft.w, [CRAFT.dockOffset, 0, 0])), this.B));
            /* The rate limit is on the RELATIVE angular velocity, not the
             * inertial one. A vessel holding a fixed attitude with respect to
             * the station is rotating at the orbit rate — 0.065°/s — in
             * inertial space, and so is the station; measuring the chaser's
             * inertial rate against a 0.30°/s limit therefore spends a fifth of
             * the docking budget on something that is not relative motion at
             * all, and it punishes exactly the attitude a docking vehicle is
             * supposed to be holding. */
            const wRel = V.sub(Q.rot(this.craft.q, this.craft.w), lvlhRate(this.rs, this.vs));
            const rep = this.station.capture(ip, vIp,
                toLvlh(this.craft.noseAxis(), this.B),
                toLvlh(this.craft.rollAxis(), this.B),
                wRel);
            this.report = rep;
            if (rep.inRing) { this._end(rep.docked ? "docked" : "contact"); return; }
        }

        // Structure. The port neck is deliberately absent from the box list —
        // arriving at it is the goal, and the capture test above owns it.
        if (this.station.hit(this.rLvlh, CRAFT.radius)) { this._end("collision"); return; }
        if (this.craft.tumbling) { this._end("tumble"); return; }
        if (this.range > Math.max(1.8 * this.R0, this.R0 + 2000)) { this._end("flyby"); return; }
        /* "Went in and came back out." The threshold has to sit well below the
         * 200 m approach-initiation point and well above it in ratio, or it
         * fires on a perfectly normal braking manoeuvre: a vessel arriving at
         * the hold point overshoots to 190 m, turns round, and is 400 m out
         * while it does so. At bestRange<200 and a 1.6× ratio that killed a
         * quarter of the autopilot's own far rendezvous. */
        if (this.bestRange < 100 && this.range > Math.max(300, this.bestRange * 3)) { this._end("receded"); return; }
        /* THE APPROACH ENVELOPE, and it has to be a safety rule rather than a
         * flight-quality rule.
         *
         * This was 0.10 + R/50 — roughly the real final-approach limit, and
         * measured, it made the entire task unlearnable. A fixed-duty "push at
         * the station and never brake" policy was scored at every thrust level
         * from 5% to 80%: EVERY ONE of them was aborted for overspeed, and
         * every one scored WORSE than doing nothing, monotonically worse the
         * harder it pushed (advantage −0.032 down to −0.074 against 0.000 for
         * sitting still). The reward landscape had no first step in it. A
         * genetic algorithm cannot discover "close, then brake" in one mutation;
         * it has to be able to discover "close" first and be paid for it.
         *
         * 0.15 + R/12 still kills anything genuinely reckless — 8.5 m/s at
         * 100 m, 20 m/s at 250 m — which is what the gate is for. What it no
         * longer does is punish a vehicle for having any closing rate at all
         * while it is still tens of metres out with plenty of room to stop.
         * Arriving too fast is now punished where it belongs: by the capture
         * envelope, which turns it into a "contact" worth partial credit
         * instead of a docking. */
        if (this.range < 800 && this.closing > 0.15 + this.range / 12) { this._end("overspeed"); return; }
        if (this.craft.prop <= 1e-9 && this.range > 20 && this.closing < 0.01) { this._end("dry"); return; }
        if (this.t >= this.tLimit - 1e-9) { this._end("timeout"); return; }
    }

    _end(outcome) {
        this.over = true;
        this.outcome = outcome;
        this._recordFrame(true);
    }

    isOver() { return this.over; }

    /* ---------------------------------------------------------- scoring */
    score() {
        const sc = this.sc;
        /* Progress in LOG range, so every decade counts the same.
         *
         * A rendezvous covers 100 km to 1 m. On a linear scale, closing the
         * first 90 km is 90% of the journey and the last 10 m is 0.01% of it,
         * so a linear progress term tells a brain that the terminal approach —
         * the only part that is actually hard — is worth nothing. On a log
         * scale, 100 km → 10 km is worth exactly what 10 m → 1 m is worth, and
         * that is the honest accounting: each is one order of magnitude of
         * closure and each takes about the same amount of skill.
         *
         * It is measured on the BEST range ever reached, not on the final one
         * and not summed over steps. Rewarding the per-step change would pay a
         * vessel to oscillate in and out forever; rewarding the final range
         * would erase everything a brain achieved before it made one mistake. */
        /* ...and measured from WHERE DOING NOTHING GETS YOU, not from where the
         * vehicle started.
         *
         * This is the single change that made the search work at all. Orbital
         * drift is free progress: a vessel handed to you at 50 m with 0.2 m/s
         * of closing rate coasts to 15 m on its own, and that is already 38% of
         * the log-range journey. Scored from R₀, a brain that fires its
         * thrusters in a random direction FORFEITS that free progress, so the
         * reward landscape read: +0.04 for closing usefully, −0.30 for pushing
         * the wrong way. Doing nothing was not merely safe, it was the second-
         * best policy available, and forty generations of selection duly
         * converged on it — mean advantage −0.32, best 0.006, champion Δv
         * 0.5 m/s. The population had learned to sit still.
         *
         * Measuring from the do-nothing policy's own best range makes coasting
         * score exactly zero on this term, so acting is compared against
         * inaction rather than credited with it. The floor at −0.35 is the
         * other half: a brain that flies the wrong way should be worse than one
         * that does nothing, but not SO much worse that a population stops
         * being willing to try anything. Reward for closing now outweighs the
         * cost of a wrong guess about two to one instead of losing to it seven
         * to one. */
        const ref = Math.max(this.sc.nullBest != null ? this.sc.nullBest : this.R0, DOCK_ARRIVE * 1.5);
        const den = Math.max(0.2, Math.log10(ref) - Math.log10(DOCK_ARRIVE));
        const prog = Math.max(-0.35, Math.min(1,
            (Math.log10(ref) - Math.log10(Math.max(this.bestRange, DOCK_ARRIVE))) / den));

        let s = FIT.progress * prog;
        s += FIT.corridor * Math.min(1, this.corridorTime / 240);

        // Propellant. A penalty, capped well below the value of one decade of
        // honest progress — an expensive rendezvous that docks must always beat
        // a frugal one that does not.
        const dvBudget = CRAFT.isp * G0 * Math.log((this.craft.dryMass + sc.prop) / this.craft.dryMass);
        s -= Math.min(FIT.fuel, FIT.fuel * this.craft.dvUsed / Math.max(dvBudget, 1e-6));

        const r = this.report;
        if (this.outcome === "docked" && r) {
            const p = this.station.port;
            const qAlign = 0.5 * (1 - r.lateral / p.latOffset) +
                0.3 * (1 - r.angle / p.angle) +
                0.2 * (1 - r.roll / p.roll);
            // Peak reward at 60 mm/s: the middle of the 20–120 mm/s window, not
            // the edge of it. Rewarding "as slow as allowed" trains a vessel to
            // creep in at 21 mm/s, which on the real mechanism does not latch.
            const qSpeed = Math.max(0, 1 - Math.abs(r.vAxial - 0.060) / 0.060);
            s += FIT.dock;
            s += FIT.dockAlign * Math.max(0, qAlign);
            s += FIT.dockSpeed * qSpeed;
            s += FIT.dockFuel * this.craft.fuelFrac;
            s += FIT.dockTime * Math.max(0, 1 - this.t / this.tLimit);
        } else if (this.outcome === "contact" && r) {
            /* Touched the port, broke a limit. This is worth real points and
             * that is deliberate. A brain that arrives on the ring 30% too fast
             * is one number away from docking; a brain that gives up at 40 m is
             * not, and scoring them the same erases the gradient between them.
             * It stays far below a clean docking, so nothing is ever better off
             * bouncing on purpose. */
            const p = this.station.port;
            const sat = (v, lim) => v <= lim ? 1 : Math.max(0, 1 - (v - lim) / (2 * lim));
            const soft = (sat(r.lateral, p.latOffset) + sat(r.vLateral, p.latRate) +
                sat(r.vAxial, p.axialMax) + sat(r.angle, p.angle) +
                sat(r.roll, p.roll) + sat(r.rate, p.rate)) / 6;
            s += FIT.contact + FIT.contactSoft * soft;
        } else if (this.outcome === "collision") {
            s += FIT.collision;
        } else if (this.outcome === "flyby" || this.outcome === "receded" || this.outcome === "overspeed") {
            s += FIT.flyby;
        } else if (this.outcome === "tumble") {
            s += FIT.tumble;
        }
        return s;
    }

    result() {
        const s = this.score();
        const r = this.report;
        return {
            score: s,
            advantage: advantageOf(this.sc, s),
            outcome: this.outcome,
            docked: this.outcome === "docked" ? 1 : 0,
            contact: this.outcome === "contact" ? 1 : 0,
            bestRange: this.bestRange,
            t: this.t,
            dv: this.craft.dvUsed,
            fuelFrac: this.craft.fuelFrac,
            burns: this.burns, coasts: this.coasts, coastTotal: this.coastTotal,
            /* Duty-weighted thruster on-time, which is the honest number. The
             * raw count of control ticks with any thruster lit reads "2,497
             * burns" for a single continuous approach, because a pulse-width
             * controller fires on almost every tick by design — and that reads
             * as a wildly erratic vehicle rather than a smoothly trimmed one. */
            burnTime: this.craft.burnTime,
            capture: r ? {
                lateral: r.lateral, vAxial: r.vAxial, vLateral: r.vLateral,
                angle: r.angle, roll: r.roll, rate: r.rate, ok: r.ok
            } : null,
            frames: this.record
        };
    }

    /* ------------------------------------------------------- recording */
    _recordFrame(force) {
        if (!this.record) return;
        if (!force && this.t < this.tNextRec) return;
        if (this.record.length >= this.maxFrames) return;
        this.tNextRec = this.t + (this.coasting ? 0 : this.recordEvery);
        this.record.push({
            t: this.t,
            p: [this.rLvlh[0], this.rLvlh[1], this.rLvlh[2]],
            v: [this.vLvlh[0], this.vLvlh[1], this.vLvlh[2]],
            q: this.craft.q.slice(),
            w: this.craft.w.slice(),
            f: this.craft.firing.slice(),
            fr: this.craft.firingRcs.slice(),
            rs: [this.rs[0], this.rs[1], this.rs[2]],
            vsv: [this.vs[0], this.vs[1], this.vs[2]],
            R: this.range, cl: this.closing,
            fuel: this.craft.fuelFrac, dv: this.craft.dvUsed,
            coast: this.coasting ? 1 : 0,
            lidar: this.sensors.lidarSeen,
            dvc: this.dvSetpoint ? this.dvSetpoint.slice() : [0, 0, 0]
        });
    }
}

/* ------------------------------------------------------------ advantage */
function advantageOf(sc, s) {
    if (sc.sNull == null || sc.sPilot == null) return s;
    const span = Math.max(0.75, sc.sPilot - sc.sNull);
    return (s - sc.sNull) / span;
}

/* Run a scenario once with a given agent. */
function runEpisode(sc, agent, opts) {
    const w = new World(sc, agent, opts);
    let guard = 0;
    while (!w.isOver() && guard++ < 400000) w.step();
    if (!w.isOver()) w._end("timeout");
    return w.result();
}

/* ------------------------------------------------------------ audition */
/* Score a scenario with the do-nothing policy and with the autopilot, and
 * decide whether it is fit to train on.
 *
 * BOTH TESTS MATTER. A scenario the autopilot cannot dock is a scenario where
 * the population is being selected on noise — and at the far stages, where a
 * badly chosen phasing puts the station a whole orbit out of reach with the
 * propellant available, those are common. A scenario the do-nothing policy
 * already nearly solves is worse: every brain scores about the same, the
 * generation carries no selection pressure at all, and — because doing nothing
 * is also free — it actively teaches the population that the answer is to sit
 * still. A bank with a few of those in it looks like a plateau and is really an
 * absence of an objective. */
function calibrate(sc, opts) {
    opts = opts || {};
    /* The do-nothing policy is flown TWICE. The first run establishes how close
     * free orbital drift gets, which is the reference the progress term is
     * measured from (see score()); the second is identical dynamics re-scored
     * against that reference, and comes out at exactly zero progress by
     * construction. Scoring the first run directly would grade the baseline on
     * a different scale from everything it is the baseline for. One extra
     * episode per scenario, paid once when the bank is built. */
    const probe = runEpisode(sc, null, { noise: false });
    sc.nullBest = probe.bestRange;
    const nullRes = runEpisode(sc, null, { noise: false });
    sc.sNull = nullRes.score;
    const pilotRes = runEpisode(sc, new Pilot(sc, new Station(sc.station)), { noise: false });
    sc.sPilot = pilotRes.score;
    sc.pilotDocked = pilotRes.docked;
    sc.pilotDv = pilotRes.dv;
    sc.pilotT = pilotRes.t;
    /* The do-nothing bar is measured against the DOCKING distance, not against
     * where the vessel started. An absolute 25 m floor rejected almost every
     * terminal-approach scenario, because a vessel handed to you at 40 m with
     * 0.2 m/s of closing rate will of course drift to 20 m on its own — that is
     * what "terminal approach" means. What must not happen is that it drifts
     * into the capture envelope, and 8 m is comfortably outside it. */
    sc.usable = pilotRes.docked === 1 &&
        nullRes.docked === 0 &&
        nullRes.bestRange > Math.max(8, sc.R0 * 0.02) &&
        (sc.sPilot - sc.sNull) > 2.0;
    return sc;
}

/* A calibrated bank: keep drawing scenarios for each slot until one passes the
 * audition, up to a retry limit. Returns the bank plus how many draws it took,
 * which the trainer logs — a stage whose rejection rate climbs is a stage whose
 * difficulty settings have drifted past what the vehicle can actually fly. */
function calibratedBank(topStage, size, block, maxTries) {
    const bank = buildBank(topStage, size, block);
    const tries = maxTries || 6;
    let draws = 0;
    for (let i = 0; i < bank.length; i++) {
        let sc = bank[i], k = 0;
        calibrate(sc); draws++;
        while (!sc.usable && k < tries) {
            k++; draws++;
            sc = makeScenario(bank[i].stage, bank[i].seed + 7717 * k);
            calibrate(sc);
        }
        bank[i] = sc;
    }
    return { bank, draws };
}

if (typeof module !== "undefined") {
    module.exports = {
        World, runEpisode, calibrate, calibratedBank, advantageOf,
        FIT, DOCK_ARRIVE, GUID_PERIOD
    };
}
