/* world4d.js — one episode: a fleet of drones flying the same hyper-room, the
 * same waypoint chain and the same air, all at once.
 *
 * FAIRNESS. Every drone in a generation spawns on the same pad point, with the
 * same (randomised) starting attitude, gets the identical waypoint sequence and
 * flies the identical turbulence. Drones do not see or collide with each other
 * — they are ghosts sharing a volume purely so a generation costs one episode
 * instead of a hundred. The only variable between two drones is the brain.
 *
 * TIME IS THE RESOURCE. Each drone starts with its own short clock; reaching a
 * waypoint tops it up. A drone that hovers prettily and finds nothing runs its
 * clock down and freezes with its score locked, while one that keeps finding
 * waypoints keeps flying. That is what stops a stable hover from being a
 * winning strategy without having to penalise hovering directly.
 *
 * THE SPAWN ATTITUDE IS RANDOM, AND IN THE HEADING PLANES ONLY. The drone
 * starts level (thrust axis along world up) but rotated by a random element of
 * the SO(3) acting on the horizontal 3-space — the exact 4D generalisation of
 * spawning at a random yaw. Level, because generation 1 must be able to take
 * off at all; random in heading, because the compass channels would otherwise
 * be constant at spawn and the population would be free to bake a fixed
 * world-frame heading into its weights instead of learning to read them.
 */
"use strict";

const DT = 1 / 120;             // physics tick
const CONTROL_EVERY = 4;        // → 30 Hz control loop
const START_CLOCK = 18;         // s of flight time a drone is born with
const WP_TIME_BONUS = 10;       // s added to its own clock per waypoint reached
const EPISODE_HARD_CAP = 150;   // s — backstop so an unbeatable drone can't run forever
const MAX_ARRIVALS = 30;        // freeze a drone after this many waypoints

/* The three planes that leave the thrust axis alone. Rotating in these is the
 * 4D version of yaw: it changes where the airframe points inside the
 * horizontal 3-space without tipping it over. */
const HEADING_PLANES = [1, 2, 5];

function randomHeadingR(rng, out) {
    const R = m4identity(out || new Float64Array(16));
    const tmp = new Float64Array(16), acc = new Float64Array(16);
    for (const k of HEADING_PLANES) {
        rotationInPlane(PLANES[k][0], PLANES[k][1], rng() * Math.PI * 2, tmp);
        m4mul(R, tmp, acc);
        R.set(acc);
    }
    return R;
}

class World4D {
    constructor(room, brains, opts) {
        this.room = room;
        this.opts = opts || {};
        this.time = 0;
        this.tick = 0;

        const mseed = this.opts.missionSeed || 1;
        this._wpRng = mulberry32(7777 + mseed * 97);
        this.airRng = mulberry32(3300 + mseed * 61);
        this.noiseRng = mulberry32(51000 + (this.opts.noiseSeed || 1) * 13);

        // Air: an Ornstein-Uhlenbeck wander around a still room. Even a light
        // draught matters — a multirotor has no keel, so a steady cross-draught
        // is a disturbance the policy has to trim out, and in 4D there are
        // three horizontal directions for it to come from.
        this.turb = this.opts.turbulence || 0;
        this.wind = v4();
        this._windTarget = v4();

        // shared waypoint chain, rolled lazily: the instant the first drone
        // reaches point N, point N+1 exists for everyone. Laggards still fly the
        // earlier points first, in the same order.
        this.minSep = this.opts.minSep || 8;
        this.waypoints = [];
        this._rollWaypoint();

        const spawnR = randomHeadingR(this._wpRng);
        const sp = v4(room.spawn[0], DRONE.RADIUS, room.spawn[2], room.spawn[3]);
        this.spawnPos = sp;
        this.spawnR = spawnR;

        this.drones = brains.map((b, i) => new Drone(b, i));
        const nseed = 51000 + (this.opts.noiseSeed || 1) * 13;
        for (const d of this.drones) {
            d.reset(sp, spawnR);
            d.noiseRng = mulberry32(nseed);   // identical stream per drone — see drone4d.js
            d.timeLeft = this.opts.startClock || START_CLOCK;
            d.setTarget(this.waypoints[0], 0);
        }
    }

    _rollWaypoint() {
        const prev = this.waypoints[this.waypoints.length - 1] || this.room.spawn;
        const wp = this.room.sampleWaypoint(this._wpRng, prev, this.minSep);
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
        for (let k = 0; k < 4; k++) {
            // gusts wander vertically too, but at a third the strength: a room
            // has cross-draughts, not thermals
            const s = k === 1 ? 0.33 : 1;
            this._windTarget[k] += (gaussRand(r) * 0.6 - this._windTarget[k] * 0.25) * dt;
            this.wind[k] = this._windTarget[k] * this.turb * s;
        }
    }

    step() {
        if (this.tick % CONTROL_EVERY === 0) {
            for (const d of this.drones) {
                if (!d.alive || d.done) continue;
                d.control(this);
                // Pilot hook: lets the hand-written autopilot fly the identical
                // episode, through the identical scoring, as a evolved brain.
                if (this.opts.pilot && d.target) this.opts.pilot.control(d, d.target);
                // Arrival tested at control rate: 30 Hz against a 1.5 m 4-ball
                // at ≤ 8 m/s leaves a tunnelling window under 3 cm.
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
        // charge for distance flown beyond what the leg actually needed.
        const useful = d.legInitDist;
        const excess = Math.max(0, d.legDist - useful * DRONE.EFF_SLACK);
        const effPen = Math.min(DRONE.EFF_CAP, DRONE.EFF_W * excess);
        d.fitScore += DRONE.WP_REWARD + DRONE.PROGRESS_W
            + Math.max(0, DRONE.WP_SPEED_BONUS - DRONE.WP_SPEED_DECAY * legTime)
            - effPen;
        d.timeLeft += this.opts.wpTimeBonus || WP_TIME_BONUS;
        d.wpIdx++;
        const cap = this.opts.maxArrivals || MAX_ARRIVALS;
        if (d.arrivals >= cap) { d.done = true; d.target = null; return; }
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
 * headless trainer, the tests and the brain evaluator, so all three score a
 * generation identically. */
function runEpisode(room, nets, opts) {
    const w = new World4D(room, nets, opts);
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
        World4D, runEpisode, randomHeadingR, DT, CONTROL_EVERY, START_CLOCK,
        WP_TIME_BONUS, EPISODE_HARD_CAP, MAX_ARRIVALS, HEADING_PLANES
    };
}
