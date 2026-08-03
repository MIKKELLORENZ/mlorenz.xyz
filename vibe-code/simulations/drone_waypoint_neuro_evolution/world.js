/* world.js — one episode: a fleet of drones flying the same room, the same
 * waypoint chain and the same air, all at once.
 *
 * FAIRNESS. Every drone in a generation spawns on the *same* pad square, gets
 * the *identical* waypoint sequence, and flies the *same* turbulence. Drones do
 * not see or collide with each other — they are ghosts, sharing a volume purely
 * so a generation costs one episode instead of sixty. The brief is navigation
 * and rotor control; nothing here is about traffic. The only variable between
 * two drones in an episode is the brain.
 *
 * TIME IS THE RESOURCE. Each drone starts with its own short clock. Reaching a
 * waypoint tops it up. A drone that hovers prettily and finds nothing runs its
 * clock down and freezes with its score locked; a drone that keeps finding
 * waypoints keeps flying. This is what stops a stable hover from being a
 * winning strategy without having to penalise hovering directly.
 */
"use strict";

const DT = 1 / 120;             // physics tick
const CONTROL_EVERY = 4;        // → 30 Hz control loop
const START_CLOCK = 18;         // s of flight time a drone is born with
const WP_TIME_BONUS = 10;       // s added to its own clock per waypoint reached
const EPISODE_HARD_CAP = 240;   // s — backstop so an unbeatable drone can't run forever
const MAX_ARRIVALS = 40;        // freeze a drone after this many waypoints

class World {
    constructor(room, brains, opts) {
        this.room = room;
        this.opts = opts || {};
        this.time = 0;
        this.tick = 0;
        this.events = [];

        const mseed = this.opts.missionSeed || 1;
        this._wpRng = mulberry32(7777 + mseed * 97);
        this.airRng = mulberry32(3300 + mseed * 61);
        this.noiseRng = mulberry32(51000 + (this.opts.noiseSeed || 1) * 13);

        // Air: an Ornstein-Uhlenbeck wander around a still room. Even a light
        // draught matters — a quad has no keel, so a 1 m/s cross-draught is a
        // steady lateral disturbance the policy has to trim out.
        this.turb = this.opts.turbulence || 0;
        this.wind = new Float64Array(3);
        this._windTarget = new Float64Array(3);

        // shared waypoint chain, rolled lazily: the instant the first drone
        // reaches point N, point N+1 exists for everyone. Laggards still fly the
        // older points first, in the same order.
        this.minSep = this.opts.minSep || 9;
        this.waypoints = [];
        this._rollWaypoint();

        const sp = room.spawn;
        this.drones = brains.map((b, i) => new Drone(b, i));
        for (const d of this.drones) {
            // identical spawn for everyone; the renderer draws the overlap as a
            // ghost swarm, which doubles as a live read on gene-pool variance
            const w0 = this.waypoints[0];
            const yaw = Math.atan2(w0[0] - sp[0], w0[2] - sp[2]);
            d.reset(sp[0], DRONE.RADIUS, sp[2], yaw);
            d.timeLeft = this.opts.startClock || START_CLOCK;
            d.setTarget(w0, 0);
        }
    }

    _rollWaypoint() {
        const prev = this.waypoints[this.waypoints.length - 1] || this.room.spawn;
        // 2.2 m of clearance around a waypoint, for the same reason room.js
        // keeps them 3.2 m off the walls: the drone has to be able to overshoot
        // a little and still be alive to fly the next leg.
        const wp = sampleWaypoint(this.room, this._wpRng, prev, this.minSep, 2.2);
        this.waypoints.push(wp);
        return wp;
    }

    _targetFor(d) {
        while (d.wpIdx >= this.waypoints.length) this._rollWaypoint();
        return this.waypoints[d.wpIdx];
    }

    _updateAir(dt) {
        if (this.turb <= 0) return;
        const r = this.airRng;
        for (let i = 0; i < 3; i++) {
            // gusts wander vertically too, but at a third the strength: a real
            // room has cross-draughts, not thermals
            const k = i === 1 ? 0.33 : 1;
            this._windTarget[i] += (gaussRand(r) * 0.6 - this._windTarget[i] * 0.25) * dt;
            this.wind[i] = this._windTarget[i] * this.turb * k;
        }
    }

    step() {
        if (this.tick % CONTROL_EVERY === 0) {
            for (const d of this.drones) {
                if (!d.alive || d.done) continue;
                d.control(this);
                // arrival check at control rate — 30 Hz against a 1.2 m sphere
                // at ≤8 m/s means the tunnelling window is under 4 cm
                if (d.target && d.distToTarget() < DRONE.WP_RADIUS) this._arrive(d);
            }
        }

        this._updateAir(DT);
        for (const d of this.drones) {
            if (d.done) continue;
            d.step(DT, this);
            if (d.alive && !d.done) {
                d.timeLeft -= DT;
                if (d.timeLeft <= 0) { d.timeLeft = 0; d.done = true; }
            }
        }

        this.time += DT;
        this.tick++;
    }

    _arrive(d) {
        const legTime = this.time - d.legStartTime;
        d.arrivals++;
        // Bank the leg now, before the odometer resets: the waypoint itself, a
        // bonus that decays with how long the leg took, and the efficiency
        // charge for any distance flown beyond what the leg actually needed.
        const useful = d.legInitDist;
        const excess = Math.max(0, d.legDist - useful * DRONE.EFF_SLACK);
        const effPen = Math.min(DRONE.EFF_CAP, DRONE.EFF_W * excess);
        d.fitScore += DRONE.WP_REWARD + DRONE.PROGRESS_W
            + Math.max(0, DRONE.WP_SPEED_BONUS - DRONE.WP_SPEED_DECAY * legTime)
            - effPen;
        d.timeLeft += this.opts.wpTimeBonus || WP_TIME_BONUS;
        d.wpIdx++;
        if (d.arrivals >= MAX_ARRIVALS) {
            d.done = true;
            d.target = null;
            return;
        }
        d.setTarget(this._targetFor(d), this.time);
    }

    isOver() {
        const cap = this.opts.hardCap != null ? this.opts.hardCap : EPISODE_HARD_CAP;
        if (this.time >= cap) return true;
        return this.drones.every(d => d.done || !d.alive);
    }

    get aliveCount() {
        let n = 0;
        for (const d of this.drones) if (d.alive && !d.done) n++;
        return n;
    }

    get leaderIdx() {
        let best = 0, bf = -1e18;
        for (const d of this.drones) {
            const f = d.fitness();
            if (f > bf) { bf = f; best = d.idx; }
        }
        return best;
    }
}

/* Run one episode to completion and return the per-drone tallies. Shared by the
 * headless trainer, the tests, and the browser's "skip ahead" button, so all
 * three score a generation identically. */
function runEpisode(room, nets, opts) {
    const w = new World(room, nets, opts);
    let guard = 0;
    const maxTicks = ((opts.hardCap != null ? opts.hardCap : EPISODE_HARD_CAP) / DT) + 10;
    while (!w.isOver() && guard++ < maxTicks) w.step();
    return w.drones.map(d => ({
        fitness: d.fitness(),
        arrivals: d.arrivals,
        crashed: d.crashed ? 1 : 0,
        tookOff: d.armed ? 1 : 0,
        airTime: d.airTime,
        peakY: d.peakY,
        flightTime: d.flightTime
    }));
}

if (typeof module !== "undefined") {
    module.exports = {
        World, runEpisode, DT, CONTROL_EVERY, START_CLOCK, WP_TIME_BONUS,
        EPISODE_HARD_CAP, MAX_ARRIVALS
    };
}
