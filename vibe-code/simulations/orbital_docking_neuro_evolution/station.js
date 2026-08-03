/* station.js — the target. Geometry, the docking port, and the capture
 * envelope that decides whether an arrival is a docking or an accident.
 *
 * The station flies LVLH-hold: its body axes track the local vertical / local
 * horizontal frame, so it appears stationary to a co-orbiting observer and its
 * ports keep pointing where the flight rules say they point. Scenarios may
 * bias that attitude by a few degrees (a real station's torque-equilibrium
 * attitude is not exactly LVLH), and the hardest stage biases it by tens.
 *
 * COLLISION is against boxes, in the station's own body frame — cheap, and the
 * shapes that matter are boxes anyway. The one subtlety is that the docking
 * port must NOT be a collision surface: arriving at it is the entire goal. So
 * the port neck is excluded from the box list and handled by the capture test
 * below, which decides between "docked", "damaged both vehicles" and "hit the
 * structure" from the same contact.
 *
 * THE CAPTURE ENVELOPE is the real one, in spirit and roughly in numbers — the
 * NASA Docking System's soft-capture limits are about ±0.1 m lateral, ±4° of
 * misalignment, 0.03–0.12 m/s of closing rate and a few hundredths of a degree
 * per second of relative rate. Every one of those is a separate way to fail
 * while looking, from a distance, like a success.
 */
"use strict";

/* Half-extents in the station body frame:
 *      +X  forward along the velocity vector (where the docking port is)
 *      +Y  out the right-hand side (−orbit normal)
 *      +Z  nadir, down at the Earth
 */
const STATION_BOXES = [
    { c: [0, 0, 0], h: [15, 2.2, 2.2], name: "core" },
    { c: [-6, 0, 5.5], h: [3.5, 2.0, 3.5], name: "node" },
    { c: [0, 24, 0], h: [8, 18, 0.3], name: "array-port" },
    { c: [0, -24, 0], h: [8, 18, 0.3], name: "array-stbd" },
    { c: [-12, 0, -7], h: [4, 0.4, 5], name: "radiator" }
];

/* The docking port: a ring on the nose of the core, facing straight up +X. */
const PORT = {
    pos: [16.4, 0, 0],       // m, station body frame
    normal: [1, 0, 0],       // outward, the direction a chaser arrives FROM
    up: [0, 0, -1],          // roll reference (zenith), what the chaser aligns +Z to
    ringRadius: 0.80,        // m
    // Soft-capture limits. All must hold simultaneously at the instant the
    // chaser's interface point crosses the port plane.
    latOffset: 0.12,         // m
    latRate: 0.030,          // m/s
    axialMin: 0.020,         // m/s   below this you bounce off without latching
    axialMax: 0.120,         // m/s   above this you break something
    angle: 4 * Math.PI / 180,
    roll: 6 * Math.PI / 180,
    rate: 0.30 * Math.PI / 180,  // rad/s
    // Approach corridor: a cone about the port normal that flight rules confine
    // the final approach to. Straying outside it is not instantly fatal, but it
    // is not rewarded, and inside 30 m it is an abort.
    coneHalfAngle: 15 * Math.PI / 180,
    corridorRange: 200        // m
};

/* Retroreflector targets on the docking ring. This is what the laser actually
 * sees: five bright returns and nothing else. Their arrangement — four on a
 * 0.6 m ring plus one recessed 0.18 m at the centre — is what makes relative
 * ATTITUDE recoverable from range-and-bearing alone. Four coplanar points give
 * you the plane; the recessed fifth breaks the front/back ambiguity and gives
 * the roll a sign. A network that learns to read this has learned pose
 * estimation from a five-point cloud, which is the actual job of a docking
 * LIDAR. */
const REFLECTORS = (() => {
    const r = 0.60, out = [];
    for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        out.push([PORT.pos[0] + 0.02, PORT.pos[1] + r * Math.cos(a), PORT.pos[2] + r * Math.sin(a)]);
    }
    out.push([PORT.pos[0] - 0.18, PORT.pos[1], PORT.pos[2]]);
    return out;
})();

class Station {
    /* `attBias` is a small rotation applied to the LVLH-hold attitude, given as
     * [yaw, pitch, roll] in radians about the LVLH z, y, x axes. */
    constructor(opts) {
        opts = opts || {};
        this.attBias = opts.attBias ? opts.attBias.slice() : [0, 0, 0];
        this.portIndex = opts.portIndex || 0;   // 0 forward, 1 nadir, 2 zenith
        this._buildPort();
    }

    /* Alternate ports. The forward port is the default because it is the one
     * every rendezvous diagram uses; nadir and zenith exist so the hardest
     * stage can demand an approach that orbital mechanics fights rather than
     * helps (an R-bar approach from below is stable, from above it is not). */
    _buildPort() {
        const p = JSON.parse(JSON.stringify(PORT));
        if (this.portIndex === 1) {            // nadir-facing, on the underside
            p.pos = [-6, 0, 9.2]; p.normal = [0, 0, 1]; p.up = [1, 0, 0];
        } else if (this.portIndex === 2) {     // zenith-facing, on top of the node
            p.pos = [-6, 0, -9.2]; p.normal = [0, 0, -1]; p.up = [1, 0, 0];
        }
        this.port = p;
        this.reflectors = this.portIndex === 0 ? REFLECTORS : REFLECTORS.map(v => {
            // Re-express the ring around whichever port is active.
            const d = [v[0] - PORT.pos[0], v[1] - PORT.pos[1], v[2] - PORT.pos[2]];
            const n = p.normal, u = p.up, s = V.cross(n, u);
            return [
                p.pos[0] + n[0] * d[0] + u[0] * d[2] + s[0] * d[1],
                p.pos[1] + n[1] * d[0] + u[1] * d[2] + s[1] * d[1],
                p.pos[2] + n[2] * d[0] + u[2] * d[2] + s[2] * d[1]
            ];
        });
    }

    /* Station body → LVLH rotation, as three column vectors. LVLH-hold plus the
     * scenario's bias. */
    bodyToLvlh() {
        const [yaw, pitch, roll] = this.attBias;
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const cr = Math.cos(roll), sr = Math.sin(roll);
        // Rz(yaw) Ry(pitch) Rx(roll), in the LVLH axes.
        return [
            [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
            [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
            [-sp, cp * sr, cp * cr]
        ];
    }

    /* Body-frame vector → LVLH. */
    toLvlhVec(v) {
        const M = this._M || (this._M = this.bodyToLvlh());
        return [
            M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
            M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
            M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
        ];
    }
    /* LVLH vector → station body. */
    fromLvlhVec(v) {
        const M = this._M || (this._M = this.bodyToLvlh());
        return [
            M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2],
            M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2],
            M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]
        ];
    }

    portPosLvlh() { return this.toLvlhVec(this.port.pos); }
    portNormalLvlh() { return this.toLvlhVec(this.port.normal); }
    portUpLvlh() { return this.toLvlhVec(this.port.up); }
    reflectorsLvlh() { return this.reflectors.map(r => this.toLvlhVec(r)); }

    /* Signed penetration of a sphere at LVLH position `p`, radius `rad`, into
     * the station structure. Positive means overlapping. Returns the worst box
     * or null. */
    hit(pLvlh, rad) {
        const b = this.fromLvlhVec(pLvlh);
        let worst = null, depth = 0;
        for (const box of STATION_BOXES) {
            let d2 = 0;
            for (let k = 0; k < 3; k++) {
                const e = Math.abs(b[k] - box.c[k]) - box.h[k];
                if (e > 0) d2 += e * e;
            }
            const d = Math.sqrt(d2);
            if (d < rad && rad - d > depth) { depth = rad - d; worst = box.name; }
        }
        return worst ? { box: worst, depth } : null;
    }

    /* Clearance from the structure, in metres, for the sensor suite and for the
     * fitness function's corridor term. Distance to the nearest box surface;
     * zero inside. */
    clearance(pLvlh) {
        const b = this.fromLvlhVec(pLvlh);
        let best = 1e9;
        for (const box of STATION_BOXES) {
            let d2 = 0;
            for (let k = 0; k < 3; k++) {
                const e = Math.abs(b[k] - box.c[k]) - box.h[k];
                if (e > 0) d2 += e * e;
            }
            best = Math.min(best, Math.sqrt(d2));
        }
        return best;
    }

    /* ---------------------------------------------------------- capture */
    /* Evaluate an arrival. `ip` is the chaser's interface point in LVLH, `vRel`
     * its LVLH-frame velocity, `nose` its body +X in LVLH, `up` its body +Z in
     * LVLH, `w` its body rates.
     *
     * Returns a report whose `axial` is the distance still to go: positive
     * outside the port, negative once the probe has crossed the plane. The
     * world watches for the sign change and calls this the instant it happens.
     *
     * The six limits are reported individually and not just as a pass/fail,
     * because the fitness function needs to know HOW a near-miss missed. A
     * brain that arrives perfectly aligned at 0.3 m/s is one number away from
     * docking; a brain that arrives at the right speed 4 m off to the side is
     * not, and giving them the same score erases the gradient between them. */
    capture(ip, vRel, nose, up, w) {
        const P = this.portPosLvlh(), N = this.portNormalLvlh(), U = this.portUpLvlh();
        const d = V.sub(ip, P);
        const axial = V.dot(d, N);
        const lat = V.sub(d, V.mul(N, axial));
        const latMag = V.len(lat);

        const vAx = -V.dot(vRel, N);                      // positive = closing
        const vLat = V.len(V.sub(vRel, V.mul(N, V.dot(vRel, N))));

        // The chaser's nose must point INTO the port, i.e. against its normal.
        const ang = Math.acos(Math.max(-1, Math.min(1, -V.dot(nose, N))));
        // Roll: the chaser's +Z against the port's up-reference, both projected
        // onto the port plane.
        const zp = V.sub(up, V.mul(N, V.dot(up, N)));
        const upp = V.sub(U, V.mul(N, V.dot(U, N)));
        const roll = (V.len(zp) > 1e-6 && V.len(upp) > 1e-6)
            ? Math.acos(Math.max(-1, Math.min(1, V.dot(V.unit(zp), V.unit(upp)))))
            : Math.PI;
        const rate = V.len(w);

        const p = this.port;
        const ok = {
            lateral: latMag <= p.latOffset,
            latRate: vLat <= p.latRate,
            speed: vAx >= p.axialMin && vAx <= p.axialMax,
            angle: ang <= p.angle,
            roll: roll <= p.roll,
            rate: rate <= p.rate
        };
        const inRing = latMag <= p.ringRadius;
        return {
            axial, lateral: latMag, vAxial: vAx, vLateral: vLat,
            angle: ang, roll, rate, inRing, ok,
            docked: inRing && ok.lateral && ok.latRate && ok.speed && ok.angle && ok.roll && ok.rate
        };
    }

    /* Is the chaser inside the approach corridor cone? Used by the fitness
     * shaping and by the abort rules. */
    inCorridor(pLvlh) {
        const P = this.portPosLvlh(), N = this.portNormalLvlh();
        const d = V.sub(pLvlh, P);
        const r = V.len(d);
        if (r < 1e-6) return true;
        if (r > this.port.corridorRange) return false;
        return Math.acos(Math.max(-1, Math.min(1, V.dot(d, N) / r))) <= this.port.coneHalfAngle;
    }
}

if (typeof module !== "undefined") {
    module.exports = { Station, STATION_BOXES, PORT, REFLECTORS };
}
