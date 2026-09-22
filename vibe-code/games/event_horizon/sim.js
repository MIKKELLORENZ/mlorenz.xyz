/* sim.js — one flight: the ship, its clocks, its engine, and the light it emits.
 *
 * No DOM in here. The browser drives a Sim from requestAnimationFrame and
 * draws it; test_headless.js drives the same object from a scripted pilot to
 * prove each mission can be finished. Everything that decides whether the
 * player has won lives on this side of that line, so it is tested too.
 *
 * TIME. The simulation is stepped in the pilot's own proper time — a second of
 * play is always the same amount of the pilot's life. Everything else in the
 * universe (the far clock, the station going round, the planets) is advanced
 * by however much far time that corresponds to, so when the pilot's clock runs
 * slow the outside world visibly speeds up. That is the whole lesson, and it
 * falls out of the bookkeeping for free.
 */
"use strict";

const TURN_RATE = 3.2;          // rad per REAL second, so steering feels the same at any time-warp
const PULSE_RAYS = 96;
const PILOT_HEIGHT_M = 2;
const CLIMB_RATE = 0.5;         // hover autopilot's climb/descent speed far from the hole, in c

class Sim {
    constructor(mission, options) {
        this.mission = mission;
        this.options = options || {};
        this.reset();
    }

    reset() {
        const cfg = this.mission.setup(this.options);
        this.cfg = cfg;
        this.world = cfg.world;
        this.ship = cfg.ship;
        this.heading = cfg.heading || 0;
        this.aMax = cfg.aMax;                    // what the hover autopilot may use
        /* What the throttle gives by hand. Holding a ship up near a horizon
         * and trimming an orbit differ by a factor of a hundred in thrust; an
         * engine sized for the first makes the second impossible to do by
         * hand, so the big number is reserved for the autopilot. */
        this.aManual = cfg.aManual || cfg.aMax;
        this.fuelMax = cfg.fuel;                 // Δv budget in units of c; Infinity = unlimited
        this.fuelUsed = 0;
        this.timeScale = cfg.timeScale;          // ship-time units per real second at 1×
        this.unitM = cfg.unitMeters;             // metres per world length unit
        this.unitS = cfg.unitMeters / C_SI;      // seconds per world time unit
        this.rsM = this.world.rs * cfg.unitMeters;
        this.base = cfg.base || { kind: "far", rate1: 0, label: "Far clock" };
        this.station = cfg.station || null;
        this.tideLimit = cfg.tideLimit || 0;     // head-to-toe g that breaks the ship; 0 = never
        this.pingEvery = cfg.pingEvery || 0;
        this.listenR = cfg.listenR || 0;
        this.overlays = Object.assign({}, cfg.overlays);   // the View checkboxes edit this copy

        this.status = "flying";                  // flying | won | lost
        this.reason = "";
        this.thrustX = 0; this.thrustY = 0; this.throttle = 0;
        this.hover = !!cfg.startHover; this.hoverStarved = false; this.hoverFloor = false;
        this.hoverR = Math.hypot(cfg.ship.x, cfg.ship.y);
        this.sweep = 0;                          // signed angle swept round the centre
        this.rMin = Infinity; this.rMax = 0;
        this.maxTide = 0; this.maxG = 0;
        this.tauCross = null;                    // ship time at horizon crossing
        this.TCross = null;
        this.pulses = []; this.pings = []; this.nextPing = 0; this.lastHeard = null;
        this.events = [];                        // {type, ...} drained by the UI each frame
        this.marks = {};                         // mission scratch space
        this._px = this.ship.x; this._py = this.ship.y;
        this.d = diagnose(this.world, this.ship);
        this.laser = cfg.laser
            ? { aim: cfg.laser.aim, beams: [], shots: 0, hits: {}, targets: cfg.laser.targets }
            : null;
        if (this.mission.init) this.mission.init(this);
    }

    /* ---------------------------------------------------------- clocks */

    get tau() { return this.ship.tau; }
    get tFar() { return this.ship.tau + this.ship.dil; }

    /* How far the base clock (ground, station, or a distant observer) is ahead
     * of the ship's. base.rate1 is the base clock's rate minus one, kept as a
     * small number so that microseconds survive being added to hours. */
    get lead() { return this.ship.dil + this.base.rate1 * this.tFar; }
    get baseClock() { return this.ship.tau + this.lead; }

    stationPos(out) {
        const st = this.station;
        const a = st.phase + st.omega * this.tFar;
        out[0] = st.r * Math.cos(a); out[1] = st.r * Math.sin(a);
        return out;
    }

    /* ---------------------------------------------------------- engine */

    fuelLeft() { return this.fuelMax === Infinity ? Infinity : Math.max(0, this.fuelMax - this.fuelUsed); }

    /* Unit vector "forwards along the orbit" in the ship's own axes: the
     * direction in which the hovering observers appear to be streaming past,
     * reversed. Boosting the hoverer's four-velocity U into the ship's frame
     * gives U' = U + (U·w) w/(γ+1) − U⁰ w. Inside the horizon nothing hovers,
     * and the direction of motion on the chart is used instead. */
    prograde(out) {
        const s = this.ship, d = this.d;
        const r = d.r, nx = s.x / r, ny = s.y / r;
        let px, py;
        if (!d.inside) {
            const gs = 1 / Math.sqrt(1 - d.beta * d.beta);
            const ux = gs * d.beta * nx, uy = gs * d.beta * ny;
            const uw = ux * s.wx + uy * s.wy;
            px = -(ux + uw * s.wx / (d.gamma + 1) - gs * s.wx);
            py = -(uy + uw * s.wy / (d.gamma + 1) - gs * s.wy);
        } else {
            px = s.wx - d.gamma * d.beta * nx;
            py = s.wy - d.gamma * d.beta * ny;
        }
        const m = Math.hypot(px, py);
        if (m < 1e-14) return false;
        out[0] = px / m; out[1] = py / m;
        return true;
    }

    /* input: { turn, thrust, reverse, fine, align, hover, climb, aim }
     *   turn −1..1, thrust/reverse 0..1, fine = quarter power,
     *   align = "pro" | "retro" | "out" | "in" | null, aim = heading to slew to,
     *   hover = station-keeping autopilot, climb −1..1 changes the held radius. */
    step(dtReal, dtau, input) {
        if (this.status !== "flying") return;
        if (this.laser) { this.stepLaser(dtReal, dtau, input); return; }
        const s = this.ship, w = this.world;

        if (input.hover && !this.hover) { this.hover = true; this.hoverR = this.d.r; }
        if (!input.hover) this.hover = false;

        /* The hover autopilot is a feedback loop, and a feedback loop has to
         * run faster than the thing it is controlling: under time-warp one
         * frame is far too long a gap between corrections, and the ship would
         * be slammed up and down at full throttle. So its control law is
         * re-evaluated often enough that gain × interval stays small. */
        let n = 1;
        if (this.hover && w.rs > 0) n = Math.max(1, Math.ceil(dtau * this.hoverGains(this.d.r).kd / 0.25));
        const T0 = s.T, h = dtau / n, a = [0, 0];
        let hit = null;
        for (let i = 0; i < n && !hit; i++) {
            this.control(input, dtReal / n, a);
            hit = advance(w, s, h, a[0], a[1]);
            this.fuelUsed += Math.hypot(a[0], a[1]) * h;
            this.d = diagnose(w, s);
            if (this.d.inside) this.hover = false;
        }

        const d = this.d;
        this.sweep += Math.atan2(this._px * s.y - this._py * s.x, this._px * s.x + this._py * s.y);
        this._px = s.x; this._py = s.y;
        if (d.r < this.rMin) this.rMin = d.r;
        if (d.r > this.rMax) this.rMax = d.r;
        this.maxG = Math.max(this.maxG, this.feltG());
        const tide = this.tideG();
        if (tide > this.maxTide) this.maxTide = tide;

        if (d.inside && this.tauCross === null) {
            this.tauCross = s.tau; this.TCross = s.T;
            this.events.push({ type: "horizon" });
        }
        this.stepLight(s.T - T0);

        if (hit) this.crash(hit);
        else if (this.tideLimit && tide > this.tideLimit) this.lose("tides", "Torn apart by tides");
        if (this.status === "flying" && this.mission.update) this.mission.update(this, dtau);
    }

    /* Gains are set from the engine, not from the clock, so the same autopilot
     * is critically damped whatever the mission's scale: an error of a fifth
     * of the radius asks for full power. */
    hoverGains(r) {
        const kp = this.aMax / (0.2 * r);
        return { kp: kp, kd: 2 * Math.sqrt(kp) };
    }

    /* Turn the controls into a proper acceleration, written into out. */
    control(input, dtReal, out) {
        const s = this.ship, w = this.world, d0 = this.d;
        const r = d0.r, nx = s.x / r, ny = s.y / r;
        const dry = this.fuelLeft() <= 0;
        let ax = 0, ay = 0;

        if (this.hover && w.rs > 0 && !d0.inside && !dry) {
            /* Become a hovering observer: hold the radius, and bleed off any
             * sideways motion. Holding still in a gravity well is what costs. */
            const k = this.hoverGains(r);
            let ar;
            /* The autopilot will not take the ship lower than it can hold it.
             * The thrust needed to hover grows without limit towards the
             * horizon, so every engine has a floor; going below it is a
             * decision the pilot has to make by switching the autopilot off. */
            const need = holdThrust(w, s, r, 0, 0, 0);
            /* 1 well above the floor, 0 at it: the descent eases off so the
             * ship arrives at the floor already stopped, with thrust to spare. */
            const margin = Math.max(0, Math.min(1, (0.8 * this.aMax - need) / (0.4 * this.aMax)));
            this.hoverFloor = input.climb < 0 && margin < 0.03;
            if (this.hoverFloor) { input = Object.assign({}, input, { climb: 0 }); this.hoverR = Math.max(this.hoverR, r); }
            else if (input.climb < 0) input = Object.assign({}, input, { climb: input.climb * margin });
            if (input.climb) {
                /* Climb or descend at a steady rate that tapers to nothing at
                 * the horizon, where no engine can hold a ship up. The taper
                 * is steeper than the clock's, so that the engine is never
                 * asked to stop a fast descent in the one place it is weakest. */
                ar = holdThrust(w, s, r, 0, k.kd, input.climb * CLIMB_RATE * Math.pow(1 - d0.beta * d0.beta, 1.5));
                this.hoverR = r;
            } else ar = holdThrust(w, s, this.hoverR, k.kp, k.kd, 0);
            let at = -k.kd * d0.wt;
            const mag = Math.hypot(ar, at);
            this.hoverStarved = mag > this.aMax;
            if (mag > this.aMax) { ar *= this.aMax / mag; at *= this.aMax / mag; }
            ax = ar * nx - at * ny; ay = ar * ny + at * nx;
            if (mag > 1e-9 * this.aMax) this.heading = slew(this.heading, Math.atan2(ay, ax), TURN_RATE * 1.5 * dtReal);
        } else {
            this.hoverStarved = false; this.hoverFloor = false;
            let want = null;
            const p = [0, 0];
            if (input.align === "pro" && this.prograde(p)) want = Math.atan2(p[1], p[0]);
            else if (input.align === "retro" && this.prograde(p)) want = Math.atan2(-p[1], -p[0]);
            else if (input.align === "out") want = Math.atan2(ny, nx);
            else if (input.align === "in") want = Math.atan2(-ny, -nx);
            else if (input.aim !== undefined && input.aim !== null) want = input.aim;
            if (want !== null) this.heading = slew(this.heading, want, TURN_RATE * dtReal);
            else if (input.turn) this.heading += input.turn * TURN_RATE * dtReal;

            let power = (input.thrust || 0) - 0.5 * (input.reverse || 0);
            if (input.fine) power *= 0.25;
            if (dry) power = 0;
            ax = power * this.aManual * Math.cos(this.heading);
            ay = power * this.aManual * Math.sin(this.heading);
        }
        this.thrustX = ax; this.thrustY = ay;
        const full = this.hover ? this.aMax : this.aManual;
        this.throttle = full > 0 ? Math.hypot(ax, ay) / full : 0;
        out[0] = ax; out[1] = ay;
    }

    crash(hit) {
        if (hit === "singularity") {
            if (this.mission.onSingularity) this.mission.onSingularity(this);
            if (this.status === "flying") this.lose("singularity", "Reached the singularity");
        } else if (hit === "surface") this.lose("surface", "Hit the surface");
        else this.lose("body", "Collided");
    }

    win(note) { if (this.status === "flying") { this.status = "won"; this.reason = note || ""; this.events.push({ type: "won" }); } }
    lose(code, note) { if (this.status === "flying") { this.status = "lost"; this.failCode = code; this.reason = note || ""; this.events.push({ type: "lost", code: code }); } }

    /* ---------------------------------------------------------- what it feels like */

    /* Accelerometer reading, in Earth gravities. Free fall reads zero —
     * including free fall through a horizon. */
    feltG() {
        const a = Math.hypot(this.thrustX, this.thrustY);          // c² per length unit
        return a * C_SI * C_SI / this.unitM / G0_SI;
    }

    /* Difference in pull between the pilot's head and feet, in gravities. */
    tideG() {
        if (!(this.rsM > 0)) return 0;
        return tidalPerMeter(this.rsM, this.d.r / this.world.rs) * PILOT_HEIGHT_M / G0_SI;
    }

    /* ---------------------------------------------------------- light */

    /* The ship's beacon: a flash in all directions every pingEvery of SHIP
     * time, carried as a ring of real photons and advanced in rain time, which
     * is the time that stays sane at the horizon. Mission control listens at
     * listenR, and the interval it hears is a measurement made by the
     * simulation, not a formula: gravitational redshift, Doppler shift and the
     * ever-longer climb out of the well are all in it. */
    stepLight(dT) {
        if (!this.pingEvery) return;
        const s = this.ship, rs = this.world.rs;
        while (s.tau >= this.nextPing) {
            const rays = [];
            for (let i = 0; i < PULSE_RAYS; i++) {
                const a = 2 * Math.PI * i / PULSE_RAYS;
                rays.push({ x: s.x, y: s.y, kx: Math.cos(a), ky: Math.sin(a), live: true });
            }
            this.pulses.push({ rays: rays, age: 0, heard: false, n: this.pings.length, x0: s.x, y0: s.y, T0: s.T });
            /* tauSent is when the flash actually left, which is up to a frame
             * after it was due; the ratio heard/sent uses the real figure. */
            this.pings.push({ n: this.pings.length + 1, tauSent: s.tau, THeard: null, predicted: this.d.beaconOut });
            this.nextPing += this.pingEvery;
        }
        const lim = this.listenR, at = this.cfg.listenAt;
        for (let i = this.pulses.length - 1; i >= 0; i--) {
            const p = this.pulses[i];
            let alive = 0;
            const Tstart = s.T - dT;
            for (let j = 0; j < p.rays.length; j++) {
                const q = p.rays[j];
                if (!q.live) continue;
                const r0 = Math.hypot(q.x, q.y);
                if (!advancePhoton(rs, q, dT)) { q.live = false; continue; }
                const r1 = Math.hypot(q.x, q.y);
                if (lim && !p.heard && r0 < lim && r1 >= lim) {
                    p.heard = true;
                    this.hear(p.n, Tstart + dT * (lim - r0) / (r1 - r0));
                }
                if (r1 < (this.cfg.viewR || 60) * 1.6) alive++;
            }
            p.age += dT;
            if (at && !p.heard) {
                /* Flat space: the wavefront is an exact circle, so the moment
                 * it reaches the listener needs no ray at all. */
                const dist = Math.hypot(p.x0 - at.x, p.y0 - at.y);
                if (s.T - p.T0 >= dist) { p.heard = true; this.hear(p.n, p.T0 + dist); }
            }
            if (!alive || p.age > (this.cfg.pulseLife || 120)) this.pulses.splice(i, 1);
        }
    }
}

/* Mission control logs a ping. `stretch` is the measured interval between two
 * arrivals over the interval between their departures: 1 means no shift, 2
 * means every second of the pilot's life takes two to arrive. */
Sim.prototype.hear = function (n, Th) {
    const ping = this.pings[n], prev = this.pings[n - 1];
    ping.THeard = Th;
    if (prev && prev.THeard !== null) {
        ping.gap = Th - prev.THeard;
        ping.stretch = ping.gap / (ping.tauSent - prev.tauSent);
        this.lastHeard = ping;
        this.events.push({ type: "ping", n: n, gap: ping.gap, stretch: ping.stretch });
    }
};

/* ------------------------------------------------------------ the laser range */

const BEAM_SUBSTEP = 0.1;
const BEAM_MAX = 14;

/* The light-bending mission: the ship is parked (a hovering observer, held
 * there by an engine the player does not have to think about) and fires
 * single photons, each of which is integrated through the river like any
 * other. */
Sim.prototype.stepLaser = function (dtReal, dtau, input) {
    const s = this.ship, L = this.laser, w = this.world, d = this.d;
    const gs = 1 / Math.sqrt(1 - d.beta * d.beta);
    s.tau += dtau; s.T += gs * dtau; s.dil += (gs - 1) * dtau;
    const a = holdThrust(w, s, d.r, 0, 0, 0);
    this.thrustX = a * s.x / d.r; this.thrustY = a * s.y / d.r; this.throttle = 0;

    if (input.aimTo !== undefined && input.aimTo !== null) L.aim = input.aimTo;
    if (input.turn) L.aim += input.turn * (input.fine ? 0.012 : 0.55) * dtReal;
    this.heading = L.aim;
    if (input.fire) this.fireBeam(L.aim);
    this.stepBeams(gs * dtau);

    if (input.finish && this.mission.canFinish && this.mission.canFinish(this)) this.win();
    if (this.status === "flying" && this.mission.update) this.mission.update(this, dtau);
};

Sim.prototype.fireBeam = function (angle) {
    const s = this.ship, L = this.laser;
    const p = photonFromHoverer(this.world.rs, s.x, s.y, angle);
    L.shots++;
    L.beams.push({ p: p, pts: [s.x, s.y], live: true, len: 0, rMin: Math.hypot(s.x, s.y), bend: 0, dir: null, fate: null, angle: angle, n: L.shots });
    if (L.beams.length > BEAM_MAX) L.beams.shift();
    this.events.push({ type: "fire" });
};

const _bd = [0, 0, 0, 0];

Sim.prototype.stepBeams = function (dT) {
    const L = this.laser, rs = this.world.rs, s = this.ship;
    const far = (this.cfg.viewR || 20) * 1.5;
    for (let i = 0; i < L.beams.length; i++) {
        const b = L.beams[i];
        if (!b.live) continue;
        let left = dT;
        while (left > 0 && b.live) {
            const h = Math.min(left, BEAM_SUBSTEP);
            left -= h;
            if (!advancePhoton(rs, b.p, h)) { b.live = false; b.fate = "swallowed"; break; }
            const q = b.p, r = Math.hypot(q.x, q.y);
            b.pts.push(q.x, q.y);
            b.len += h;
            if (r < b.rMin) b.rMin = r;
            /* Total turning of the ray on the chart, for the debrief. */
            photonDeriv(rs, q.x, q.y, q.kx, q.ky, _bd);
            const dir = Math.atan2(_bd[1], _bd[0]);
            if (b.dir !== null) b.bend += Math.atan2(Math.sin(dir - b.dir), Math.cos(dir - b.dir));
            b.dir = dir;
            for (let j = 0; j < L.targets.length; j++) {
                const t = L.targets[j];
                if (t.self && b.len < 6) continue;
                const tx = t.self ? s.x : t.x, ty = t.self ? s.y : t.y;
                if (Math.hypot(q.x - tx, q.y - ty) < t.r) {
                    b.live = false; b.fate = "hit"; b.hit = t.id;
                    if (!L.hits[t.id]) {
                        L.hits[t.id] = { bend: Math.abs(b.bend), rMin: b.rMin, shot: b.n, angle: b.angle };
                        this.events.push({ type: "hit", id: t.id, name: t.name });
                    }
                    break;
                }
            }
            if (b.live && r > far) { b.live = false; b.fate = "escaped"; }
            if (b.live && b.len > 400) { b.live = false; b.fate = "lost"; }
        }
    }
};

function slew(from, to, maxStep) {
    let d = to - from;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) <= maxStep) return to;
    return from + Math.sign(d) * maxStep;
}

if (typeof module !== "undefined") {
    module.exports = { Sim, slew, TURN_RATE, PULSE_RAYS, PILOT_HEIGHT_M };
}
