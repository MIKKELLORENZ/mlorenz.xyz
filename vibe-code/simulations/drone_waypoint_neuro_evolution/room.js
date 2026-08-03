/* room.js — the flight volume: an axis-aligned box with axis-aligned obstacles.
 *
 * Everything the drone can hit is an AABB, which buys two things that matter a
 * lot at 30 Hz × 32 rays × 60 drones: ray casts are analytic (slab test, no
 * marching) and the collision test is an exact closest-point query. The boats
 * sim marched a grid because a coastline is not a box; a room is.
 *
 * Coordinates are Y-up, matching three.js:
 *   x: 0 .. W   (across)      y: 0 .. H   (floor to ceiling)      z: 0 .. D
 *
 * Rooms are hand-authored, never regenerated. A drone that has learned to slip
 * through the Warehouse's door gap should still find it next generation.
 */
"use strict";

const INF = 1e9;

/* No waypoint is ever placed below this. It is the other half of the
 * anti-skimming rule in drone.js: a drone that stays under TAKEOFF_H to keep
 * the floor harmless is left with WP_FLOOR − TAKEOFF_H of vertical gap to the
 * lowest possible waypoint, and that gap is deliberately wider than the arrival
 * radius. Reaching anything requires committing to real flight. */
const WP_FLOOR = 3.0;

/* An obstacle is a box given as min/max corners. */
function box(x0, y0, z0, x1, y1, z1) {
    return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

const ROOMS = [
    {
        id: "hall",
        name: "Empty Hall",
        blurb: "A bare 26 × 18 m room, 8 m to the ceiling. Nothing to hit but the walls.",
        W: 26, H: 8, D: 18,
        spawn: [13, 0, 9],
        obstacles: []
    },
    {
        id: "pillars",
        name: "Pillar Field",
        blurb: "Eight floor-to-ceiling columns on a staggered grid — the drone has to " +
               "pick a lane instead of flying the straight line.",
        W: 26, H: 8, D: 18,
        spawn: [13, 0, 9],
        obstacles: [
            box(5.2, 0, 3.4, 6.6, 8, 4.8),
            box(5.2, 0, 13.2, 6.6, 8, 14.6),
            box(10.1, 0, 8.3, 11.5, 8, 9.7),
            box(10.1, 0, 1.2, 11.5, 8, 2.6),
            box(10.1, 0, 15.4, 11.5, 8, 16.8),
            box(15.0, 0, 3.4, 16.4, 8, 4.8),
            box(15.0, 0, 13.2, 16.4, 8, 14.6),
            box(19.9, 0, 8.3, 21.3, 8, 9.7)
        ]
    },
    {
        id: "warehouse",
        name: "The Warehouse",
        blurb: "Two partition walls with door gaps, shelving racks at mid height, and a " +
               "low overhang. Some waypoints are only reachable through a hole.",
        W: 26, H: 8, D: 18,
        spawn: [2.8, 0, 9],
        obstacles: [
            // partition wall at x≈8.4 with a floor-level door gap at z 7.4..10.6
            box(7.9, 0, 0, 8.9, 8, 7.4),
            box(7.9, 0, 10.6, 8.9, 8, 18),
            // second partition at x≈17.2, gap high up (z 2..5, above y=4.2)
            box(16.7, 0, 0, 17.7, 8, 2.0),
            box(16.7, 0, 2.0, 17.7, 4.2, 5.0),
            box(16.7, 0, 5.0, 17.7, 8, 18),
            // shelving racks: slabs floating at mid height, fly over or under
            box(10.4, 2.6, 2.0, 15.6, 3.4, 3.6),
            box(10.4, 4.4, 12.4, 15.6, 5.2, 14.0),
            // a low overhang along the far wall
            box(18.5, 5.2, 6.0, 25.4, 8.0, 16.0),
            // one column in the last bay
            box(21.4, 0, 2.2, 22.8, 8, 3.6)
        ]
    }
];

class Room {
    constructor(def) {
        this.def = def;
        this.id = def.id;
        this.W = def.W; this.H = def.H; this.D = def.D;
        this.spawn = def.spawn.slice();
        this.obstacles = def.obstacles;
        // flat Float64Array of [minx,miny,minz,maxx,maxy,maxz] per obstacle —
        // the ray loop runs 32 × (drones × ticks) times a second, and reading a
        // packed array beats chasing six property lookups per box.
        this.ob = new Float64Array(this.obstacles.length * 6);
        this.obstacles.forEach((o, i) => {
            this.ob[i * 6 + 0] = o.min[0]; this.ob[i * 6 + 1] = o.min[1]; this.ob[i * 6 + 2] = o.min[2];
            this.ob[i * 6 + 3] = o.max[0]; this.ob[i * 6 + 4] = o.max[1]; this.ob[i * 6 + 5] = o.max[2];
        });
        this.nOb = this.obstacles.length;
    }

    /* Distance from an interior point along a unit direction to the first
     * surface — a wall of the room, or an obstacle — clamped to maxR.
     * The room is hit from the inside (exit distance), obstacles from the
     * outside (entry distance).
     *
     * `inflate` grows every surface toward the sensor by that much, so what
     * comes back is the distance at which a sphere of that radius would make
     * contact rather than the distance a dimensionless point would travel.
     * Passing the drone's collision radius makes the reading mean "metres until
     * I hit this", which is the quantity the avoidance policy actually needs and
     * the exact quantity the crash test uses. It is the standard swept-sphere
     * reduction from motion planning, and it is conservative: it can report a
     * hit slightly early, never late. */
    rayDist(ox, oy, oz, dx, dy, dz, maxR, inflate) {
        const g = inflate || 0;
        // --- room shell, from the inside: the nearest exit plane ---
        let t = maxR;
        if (dx > 1e-9) t = Math.min(t, (this.W - g - ox) / dx);
        else if (dx < -1e-9) t = Math.min(t, (g - ox) / dx);
        if (dy > 1e-9) t = Math.min(t, (this.H - g - oy) / dy);
        else if (dy < -1e-9) t = Math.min(t, (g - oy) / dy);
        if (dz > 1e-9) t = Math.min(t, (this.D - g - oz) / dz);
        else if (dz < -1e-9) t = Math.min(t, (g - oz) / dz);
        if (t < 0) t = 0;

        // --- obstacles, from the outside: standard slab test ---
        const ob = this.ob;
        const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
        for (let i = 0; i < this.nOb; i++) {
            const b = i * 6;
            let t1 = (ob[b] - g - ox) * ix, t2 = (ob[b + 3] + g - ox) * ix;
            let lo = Math.min(t1, t2), hi = Math.max(t1, t2);
            t1 = (ob[b + 1] - g - oy) * iy; t2 = (ob[b + 4] + g - oy) * iy;
            lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
            t1 = (ob[b + 2] - g - oz) * iz; t2 = (ob[b + 5] + g - oz) * iz;
            lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
            if (hi >= Math.max(lo, 0) && lo < t) t = Math.max(lo, 0);
        }
        return Math.max(0, Math.min(t, maxR));
    }

    /* Signed-ish clearance: distance from a point to the nearest surface, where
     * a point inside an obstacle reports 0. Used for waypoint placement and for
     * the collision test (clearance < radius = contact). `floorCounts` is off
     * while a drone is still sitting on the pad. */
    clearance(x, y, z, floorCounts) {
        let c = Math.min(x, this.W - x, z, this.D - z, this.H - y);
        if (floorCounts) c = Math.min(c, y);
        const ob = this.ob;
        for (let i = 0; i < this.nOb; i++) {
            const b = i * 6;
            const dx = Math.max(ob[b] - x, 0, x - ob[b + 3]);
            const dy = Math.max(ob[b + 1] - y, 0, y - ob[b + 4]);
            const dz = Math.max(ob[b + 2] - z, 0, z - ob[b + 5]);
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < c) c = d;
        }
        return Math.max(0, c);
    }

    /* Is a sphere of this radius in contact with anything? */
    hits(x, y, z, r, floorCounts) {
        return this.clearance(x, y, z, floorCounts) < r;
    }

    /* Nothing solid on the straight segment a→b. Only used for diagnostics and
     * for the renderer's "is the waypoint visible" hint — the drone itself is
     * never told whether it has line of sight. */
    losClear(ax, ay, az, bx, by, bz) {
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-6) return true;
        const d = this.rayDist(ax, ay, az, dx / len, dy / len, dz / len, len + 1);
        return d >= len - 1e-3;
    }
}

/* Roll the next waypoint: inside the room, with real air around it, and a
 * meaningful flight away from the previous one. Rejection sampling with a
 * best-effort fallback, so a tight room can never hang the episode. */
function sampleWaypoint(room, rng, prev, minSep, clear) {
    // Keep waypoints well off the walls — 3.2 m, not the 1.8 m this started
    // with. A drone arriving at 5–6 m/s needs roughly 3 m to wash the speed off,
    // so a waypoint 1.8 m from a wall is a trap: it rewards flying fast at the
    // target and then kills whatever does. A forensic probe of an early champion
    // showed exactly that — takeoff, 5.8 m/s straight at the point, arrival at
    // 3.2 s, wall at 3.9 s — and no amount of selection fixes a course whose
    // reward and whose survival point in opposite directions. A waypoint has to
    // be somewhere you can arrive AND leave.
    const mx = 3.2;
    const yLo = WP_FLOOR, yHi = room.H - 1.4;
    let best = null, bestD = -1;
    for (let tries = 0; tries < 300; tries++) {
        const x = mx + rng() * (room.W - 2 * mx);
        const y = yLo + rng() * Math.max(0.1, yHi - yLo);
        const z = mx + rng() * (room.D - 2 * mx);
        if (room.clearance(x, y, z, true) < clear) continue;
        const d = prev ? Math.hypot(x - prev[0], y - prev[1], z - prev[2]) : INF;
        if (d >= minSep) return [x, y, z];
        if (d > bestD) { bestD = d; best = [x, y, z]; }
    }
    return best || [room.W / 2, room.H / 2, room.D / 2];
}

/* n near-uniform directions on the unit sphere (Fibonacci lattice). Body-frame
 * and fixed for the life of the process: the net learns what each index means,
 * so the order must never change between training and playback. */
function fibSphere(n) {
    const dirs = new Float64Array(n * 3);
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const y = 1 - (i + 0.5) * (2 / n);
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const th = ga * i;
        dirs[i * 3] = Math.cos(th) * r;
        dirs[i * 3 + 1] = y;
        dirs[i * 3 + 2] = Math.sin(th) * r;
    }
    return dirs;
}

/* Each of the n sensors is a CONE, not a pencil-thin ray: `samples`
 * directions — the axis plus a ring at `halfAngle` — whose minimum distance is
 * the reading. Returns a flat Float64Array of n × samples × 3 body-frame
 * directions, axis first for each sensor.
 *
 * This is not decoration, it is the difference between a sensor suite that
 * works and one that does not. 32 directions over a full sphere sit about 40°
 * apart; a 1.4 m pillar seen from 6 m subtends 13°, so it falls clean between
 * two rays and the drone is blind to it. Measured on the old pencil-ray model:
 * approaching a pillar head-on, ZERO of the 32 rays touched it at 6 m, and even
 * at 0.7 m only two did, reporting 1.47 m because they clipped a far corner.
 * No policy can learn to avoid a thing it cannot see, and stage 1 duly stalled.
 *
 * A real time-of-flight or ultrasonic rangefinder has a beam several degrees
 * wide and returns the nearest thing anywhere in it; the pencil ray was the
 * unphysical model, not this. With cones the 32 beams tile the sphere with no
 * blind gaps between them. */
function sensorBeams(n, samples, halfAngle) {
    const axes = fibSphere(n);
    const out = new Float64Array(n * samples * 3);
    const ct = Math.cos(halfAngle), st = Math.sin(halfAngle);
    for (let i = 0; i < n; i++) {
        const ax = axes[i * 3], ay = axes[i * 3 + 1], az = axes[i * 3 + 2];
        let k = i * samples * 3;
        out[k] = ax; out[k + 1] = ay; out[k + 2] = az;      // the axis itself
        // an orthonormal basis around the axis, picking the more distant
        // reference vector so the cross product never degenerates
        let rx = 0, ry = 1, rz = 0;
        if (Math.abs(ay) > 0.9) { rx = 1; ry = 0; }
        let ux = ay * rz - az * ry, uy = az * rx - ax * rz, uz = ax * ry - ay * rx;
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
        for (let s = 1; s < samples; s++) {
            const phi = (2 * Math.PI * (s - 1)) / (samples - 1);
            const c = Math.cos(phi) * st, d = Math.sin(phi) * st;
            k = (i * samples + s) * 3;
            out[k] = ax * ct + ux * c + vx * d;
            out[k + 1] = ay * ct + uy * c + vy * d;
            out[k + 2] = az * ct + uz * c + vz * d;
        }
    }
    return out;
}

function roomById(id) {
    return ROOMS.find(r => r.id === id) || ROOMS[0];
}

if (typeof module !== "undefined") {
    module.exports = {
        Room, ROOMS, roomById, sampleWaypoint, fibSphere, sensorBeams, box, WP_FLOOR
    };
}
