/* world.js — one episode: a fleet of boats sharing a map, weather, missions,
 * and (in later stages) collisions and gunfire.
 *
 * Fairness rules: every boat gets the identical mission sequence each
 * generation, spawns in the same cluster, and sails the same weather. The only
 * differences between boats are their brains. */
"use strict";

const DT = 1 / 30;              // physics tick
const CONTROL_EVERY = 2;        // 15 Hz control loop, like the real hull
const ARRIVAL_TIME_BONUS = 60;  // seconds added to a boat's own clock per arrival
const EPISODE_HARD_CAP = 480;   // extra seconds past the start budget, total, ever

class World {
    constructor(map, router, brains, opts) {
        this.map = map;
        this.router = router;
        this.opts = opts;
        this.startBudget = opts.startBudget || 110;
        this.time = 0;
        this.tick = 0;
        this.rng = mulberry32(9000 + opts.missionSeed * 131);
        this.projectiles = [];
        this.events = [];

        // weather: Ornstein-Uhlenbeck wander around the map's climate
        this.windSpeed = map.def.wind.speed;
        this.windDir = map.def.wind.dir;
        this.wind = [0, 0];
        this._updWind();

        // Water cells reachable from the spawn (BFS over the routing grid) —
        // GPS points are sampled from these, so every target is guaranteed to
        // be sailable water, never a landlocked pond.
        this._buildReachable();

        // Shared GPS sequence, spawned lazily: the whole fleet chases the same
        // points, and the moment the first boat reaches point N, point N+1 is
        // rolled for everyone. Laggards still finish the older points first.
        this._pointRng = mulberry32(7777 + opts.missionSeed * 97);
        this.points = [];
        this._spawnPoint();

        // spawn the fleet in a loose grid around the spawn anchor
        this.boats = brains.map((b, i) => new Boat(b, i));
        const cols = Math.ceil(Math.sqrt(this.boats.length));
        for (let i = 0; i < this.boats.length; i++) {
            const gx = (i % cols) - (cols - 1) / 2;
            const gy = ((i / cols) | 0) - (cols - 1) / 2;
            let px = map.spawn.x + gx * 1.4, py = map.spawn.y + gy * 1.4;
            [px, py] = map.snapToWater(px, py, 0.9);
            const p0 = this.points[0];
            this.boats[i].reset(px, py, Math.atan2(p0.y - py, p0.x - px));
            this.boats[i].timeLeft = this.startBudget;
            this._assignMission(this.boats[i]);
        }
        this._neighbors = this.boats.map(() => []);
    }

    _buildReachable() {
        const { rgw, rgh, rcell, walk } = this.map;
        const seen = new Uint8Array(rgw * rgh);
        const sx = Math.max(0, Math.min(rgw - 1, (this.map.spawn.x / rcell) | 0));
        const sy = Math.max(0, Math.min(rgh - 1, (this.map.spawn.y / rcell) | 0));
        // find a walkable start near the spawn
        let start = -1;
        outer:
        for (let r = 0; r < 30; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                const nx = sx + dx, ny = sy + dy;
                if (nx < 0 || ny < 0 || nx >= rgw || ny >= rgh) continue;
                if (walk[ny * rgw + nx]) { start = ny * rgw + nx; break outer; }
            }
        }
        const cells = [];
        if (start >= 0) {
            const q = [start];
            seen[start] = 1;
            while (q.length) {
                const c = q.pop();
                cells.push(c);
                const cx = c % rgw, cy = (c / rgw) | 0;
                if (cx > 0 && walk[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; q.push(c - 1); }
                if (cx < rgw - 1 && walk[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; q.push(c + 1); }
                if (cy > 0 && walk[c - rgw] && !seen[c - rgw]) { seen[c - rgw] = 1; q.push(c - rgw); }
                if (cy < rgh - 1 && walk[c + rgw] && !seen[c + rgw]) { seen[c + rgw] = 1; q.push(c + rgw); }
            }
        }
        this._reachCells = cells;
    }

    /* Roll the next shared GPS point: reachable water, a meaningful sail away
     * from the previous point. */
    _spawnPoint() {
        const { rgw, rcell } = this.map;
        const prev = this.points[this.points.length - 1] || this.map.spawn;
        let best = null;
        for (let tries = 0; tries < 200; tries++) {
            const c = this._reachCells[(this._pointRng() * this._reachCells.length) | 0];
            const x = ((c % rgw) + 0.5) * rcell;
            const y = (((c / rgw) | 0) + 0.5) * rcell;
            const d = Math.hypot(x - prev.x, y - prev.y);
            if (d > 18) { best = { x, y }; break; }
            if (!best || d > Math.hypot(best.x - prev.x, best.y - prev.y)) best = { x, y };
        }
        this.points.push(best);
        return best;
    }

    _updWind() {
        const base = this.map.def.wind;
        this.windSpeed += (base.speed - this.windSpeed) * 0.015 + gaussRand(this.rng) * base.gust * 0.03;
        this.windSpeed = Math.max(0, Math.min(base.speed + base.gust, this.windSpeed));
        this.windDir += (Math.sin(base.dir - this.windDir)) * 0.008 + gaussRand(this.rng) * 0.03;
        this.wind[0] = Math.cos(this.windDir) * this.windSpeed;
        this.wind[1] = Math.sin(this.windDir) * this.windSpeed;
    }

    _assignMission(boat) {
        // Stage 3 flavor: every third task is a hunt — the "GPS target" becomes
        // the nearest enemy boat instead of a dock.
        if (this.opts.combat && boat.missionIdx > 0 && boat.missionIdx % 3 === 2) {
            const prey = this._nearestEnemy(boat);
            if (prey) {
                boat.hunting = true;
                boat.huntTarget = prey.idx;
                boat.huntTimer = 25;
                this._routeTo(boat, prey.x, prey.y);
                return;
            }
        }
        boat.hunting = false;
        while (boat.missionIdx >= this.points.length) this._spawnPoint();
        const p = this.points[boat.missionIdx];
        this._routeTo(boat, p.x, p.y);
    }

    _routeTo(boat, tx, ty) {
        const path = this.router.findPath(boat.x, boat.y, tx, ty);
        boat.tracker = new RouteTracker(path);
        boat.legStartTime = this.time;
        boat.legInitStraight = Math.max(1, Math.hypot(tx - boat.x, ty - boat.y));
        boat.bestRemainAlong = boat.tracker.total;
        boat.bestStraight = boat.legInitStraight;
    }

    _nearestEnemy(boat) {
        let best = null, bd = 1e9;
        for (const o of this.boats) {
            if (o === boat || !o.alive || o.done) continue;
            const d = Math.hypot(o.x - boat.x, o.y - boat.y);
            if (d < bd) { bd = d; best = o; }
        }
        return best;
    }

    nearOf(boat) { return this._neighbors[boat.idx]; }

    _refreshNeighbors() {
        const R = BOAT.SENSOR_RANGE + 2;
        for (let i = 0; i < this.boats.length; i++) this._neighbors[i].length = 0;
        for (let i = 0; i < this.boats.length; i++) {
            const a = this.boats[i];
            if (!a.alive || a.done) continue;
            for (let j = i + 1; j < this.boats.length; j++) {
                const b = this.boats[j];
                if (!b.alive || b.done) continue;
                const dx = b.x - a.x, dy = b.y - a.y;
                if (dx * dx + dy * dy < R * R) {
                    this._neighbors[i].push(b);
                    this._neighbors[j].push(a);
                }
            }
        }
    }

    _losClear(ax, ay, bx, by) {
        const d = Math.hypot(bx - ax, by - ay);
        const steps = Math.ceil(d / 0.6);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            if (this.map.isLand(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
        }
        return true;
    }

    step() {
        const controlTick = this.tick % CONTROL_EVERY === 0;
        if (controlTick) {
            this._updWind();
            this._refreshNeighbors();
            for (const b of this.boats) {
                if (!b.alive || b.done) continue;
                b.control(this, this.opts.noise);
                // arrivals + hunt bookkeeping (15 Hz is plenty)
                if (b.hunting) {
                    b.huntTimer -= DT * CONTROL_EVERY;
                    const prey = this.boats[b.huntTarget];
                    if (!prey || !prey.alive || prey.done || b.huntTimer <= 0) {
                        b.missionIdx++;
                        this._assignMission(b);
                    } else if (this.tick % 30 === 0) {
                        this._routeTo(b, prey.x, prey.y);   // re-acquire every second
                    }
                } else if (b._nav && b._nav.straight < 2.2) {
                    const legTime = this.time - b.legStartTime;
                    b.arrivals++;
                    b.fitScore += 1000 + 600 + 150 + Math.max(0, 240 - 6 * legTime);
                    b.timeLeft += ARRIVAL_TIME_BONUS;   // earn more sailing time
                    b.missionIdx++;
                    this._assignMission(b);
                    if (b.idx === this.leaderIdx) {
                        this.events.push(`boat ${b.idx} reached GPS #${b.missionIdx} @ ${legTime.toFixed(1)}s`);
                    }
                }
            }
            if (this.opts.combat) this._guns();
        }

        for (const b of this.boats) {
            if (b.done) continue;
            b.step(DT, this, this.time);
            if (b.alive) {
                b.timeLeft -= DT;
                if (b.timeLeft <= 0) { b.timeLeft = 0; b.done = true; }
            }
        }
        if (this.opts.shipCollisions) this._shipCollisions();
        if (this.projectiles.length) this._stepProjectiles();

        this.time += DT;
        this.tick++;
    }

    /* The episode ends when every boat has run out its personal clock (or
     * been sunk), or at a hard wall-time cap so champions can't run forever. */
    isOver() {
        if (this.time >= this.startBudget + EPISODE_HARD_CAP) return true;
        return this.boats.every(b => b.done || !b.alive);
    }

    _shipCollisions() {
        const minD = BOAT.RADIUS * 2;
        for (let i = 0; i < this.boats.length; i++) {
            const a = this.boats[i];
            if (!a.alive) continue;
            for (const b of this._neighbors[i]) {
                if (b.idx <= i || !b.alive) continue;
                const dx = b.x - a.x, dy = b.y - a.y;
                const d = Math.hypot(dx, dy);
                if (d < minD && d > 1e-6) {
                    const push = (minD - d) / 2 + 0.01;
                    const nx = dx / d, ny = dy / d;
                    a.x -= nx * push; a.y -= ny * push;
                    b.x += nx * push; b.y += ny * push;
                    a.vx *= 0.5; a.vy *= 0.5; b.vx *= 0.5; b.vy *= 0.5;
                    if (a.hitCooldown <= 0) { a.shipHits++; a.hitCooldown = 0.8; }
                    if (b.hitCooldown <= 0) { b.shipHits++; b.hitCooldown = 0.8; }
                }
            }
        }
    }

    _guns() {
        const RANGE = 22, CONE = 9 * Math.PI / 180;
        for (const b of this.boats) {
            if (!b.alive || b.done || b.gunCooldown > 0) continue;
            for (const o of this._neighbors[b.idx]) {
                if (!o.alive) continue;
                const dx = o.x - b.x, dy = o.y - b.y;
                const d = Math.hypot(dx, dy);
                if (d > RANGE) continue;
                if (Math.abs(wrapPi(Math.atan2(dy, dx) - b.heading)) > CONE) continue;
                if (!this._losClear(b.x, b.y, o.x, o.y)) continue;
                const c = Math.cos(b.heading), s = Math.sin(b.heading);
                this.projectiles.push({
                    x: b.x + c * 0.4, y: b.y + s * 0.4,
                    vx: c * 14 + b.vx, vy: s * 14 + b.vy,
                    life: 2.0, owner: b.idx
                });
                b.gunCooldown = 1.4;
                break;
            }
        }
    }

    _stepProjectiles() {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.x += p.vx * DT; p.y += p.vy * DT; p.life -= DT;
            let dead = p.life <= 0 || this.map.isLand(p.x, p.y);
            if (!dead) {
                for (const b of this.boats) {
                    if (!b.alive || b.done || b.idx === p.owner) continue;
                    if (Math.hypot(b.x - p.x, b.y - p.y) < 0.5) {
                        b.hp--;
                        b.combatScore -= 120;
                        const owner = this.boats[p.owner];
                        owner.combatScore += 250;
                        if (b.hp <= 0) {
                            b.alive = false;
                            owner.combatScore += 700;
                            this.events.push(`boat ${p.owner} sank boat ${b.idx}`);
                        }
                        dead = true;
                        break;
                    }
                }
            }
            if (dead) this.projectiles.splice(i, 1);
        }
    }

    get leaderIdx() {
        let best = 0, bf = -1e18;
        for (const b of this.boats) {
            const f = b.fitness();
            if (f > bf) { bf = f; best = b.idx; }
        }
        return best;
    }
}

if (typeof module !== "undefined") module.exports = { World, DT, CONTROL_EVERY };
