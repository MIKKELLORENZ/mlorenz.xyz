/* room4d.js — the flight volume: an axis-aligned 4D hyperrectangle, empty.
 *
 * A 4-orthotope 30 × 14 × 30 × 30 m. Eight bounding hyperplanes ("walls"), of
 * which one — y = 0 — doubles as the takeoff pad until the drone arms.
 *
 * WHY EMPTY. The 3D project this is built from spent most of its run on
 * obstacle courses and never solved them; the open hall it did solve is the
 * part that generalises. The question here is whether a network can learn to
 * stabilise and navigate a body with 6 rotational degrees of freedom and 4
 * translational ones, so the room deliberately contributes nothing but its
 * walls. Every rangefinder reading the drone gets is a wall, and the only
 * reason it needs them is to not fly into one.
 *
 * Everything is exact. A ray against an axis-aligned box in any dimension is a
 * slab intersection with a closed form; there is no marching and no sampling,
 * so no obstacle can hide between two rays the way a thin pillar can in a
 * scene built from curved surfaces. Every surface is inflated by the drone's
 * collision radius before it is measured, so a reading is "metres until I make
 * contact", not "metres to the paint".
 */
"use strict";

const ROOM = {
    HX: 15, HY: 14, HZ: 15, HW: 15,   // x,z,w are ±H; y runs 0..HY
    WALL_MARGIN: 2.6,                 // no waypoint closer than this to a wall
    /* No waypoint lower than this. It is tied to DRONE.TAKEOFF_H: the lowest
     * point of any arrival ball is WP_FLOOR − WP_RADIUS = 3.0 m, comfortably
     * above the 2.5 m arming height, so a drone cannot sit under the arming
     * threshold — where the floor is still a landing pad and cannot kill it —
     * and farm waypoints it never actually had to fly to. */
    WP_FLOOR: 4.5
};

class Room4D {
    constructor(opts) {
        opts = opts || {};
        this.HX = opts.HX != null ? opts.HX : ROOM.HX;
        this.HY = opts.HY != null ? opts.HY : ROOM.HY;
        this.HZ = opts.HZ != null ? opts.HZ : ROOM.HZ;
        this.HW = opts.HW != null ? opts.HW : ROOM.HW;
        this.lo = new Float64Array([-this.HX, 0, -this.HZ, -this.HW]);
        this.hi = new Float64Array([this.HX, this.HY, this.HZ, this.HW]);
        this.spawn = v4(0, 0, 0, 0);
    }

    /* Contact test. The floor is excluded until the drone has armed — before
     * that it is a landing pad and drone4d.js resolves it as a support. */
    hits(p, r, armed) {
        for (let k = 0; k < 4; k++) {
            if (p[k] > this.hi[k] - r) return true;
            if (p[k] < this.lo[k] + r) {
                if (k === 1 && !armed) continue;
                return true;
            }
        }
        return false;
    }

    /* Distance along unit direction `d` from `p` until a sphere of radius r
     * centred on the ray touches a wall. Exact slab intersection; the inflated
     * box is [lo+r, hi−r] on every axis. */
    rayDist(p, d, maxD, r) {
        let t = maxD;
        for (let k = 0; k < 4; k++) {
            const dk = d[k];
            if (dk > 1e-12) {
                const tk = (this.hi[k] - r - p[k]) / dk;
                if (tk < t) t = tk;
            } else if (dk < -1e-12) {
                const tk = (this.lo[k] + r - p[k]) / dk;
                if (tk < t) t = tk;
            }
        }
        return t < 0 ? 0 : t > maxD ? maxD : t;
    }

    /* Uniform inside the safe interior, at least `minSep` from the previous
     * point so a chain of waypoints is a flight and not a hover. */
    sampleWaypoint(rng, prev, minSep) {
        const m = ROOM.WALL_MARGIN;
        const wp = v4();
        for (let attempt = 0; attempt < 200; attempt++) {
            wp[0] = (rng() * 2 - 1) * (this.HX - m);
            wp[1] = ROOM.WP_FLOOR + rng() * (this.HY - m - ROOM.WP_FLOOR);
            wp[2] = (rng() * 2 - 1) * (this.HZ - m);
            wp[3] = (rng() * 2 - 1) * (this.HW - m);
            /* Relax the separation requirement rather than loop forever: with a
             * cap this tight against a 4D box the rejection rate is low, but a
             * seed that cannot satisfy it must not hang an episode. */
            const need = minSep * (attempt < 150 ? 1 : 0.5);
            if (!prev || v4dist(wp, prev) >= need) return wp;
        }
        return wp;
    }
}

if (typeof module !== "undefined") module.exports = { Room4D, ROOM };
