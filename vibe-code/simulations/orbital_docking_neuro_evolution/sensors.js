/* sensors.js — what the network is allowed to know, and when.
 *
 * THREE NAVIGATION SOURCES, layered by range, exactly as on a real vehicle:
 *
 *   ephemeris   always      Both vessels' own absolute state vectors in ECI —
 *                           the "reported x, y, z" downlinked from the station
 *                           and the chaser's own GPS solution. Metres of noise
 *                           on numbers of order 6,800,000, which is to say: at
 *                           close range this channel is useless for docking and
 *                           the network has to know that. What it IS good for
 *                           is geometry — where in the orbit both vessels are,
 *                           which way is down, how the two orbit planes differ.
 *
 *   relative nav  always    The differenced relative state, which is what a
 *                           real relative-GPS / ranging link actually outputs.
 *                           This is a SENSOR product, not a subtraction the
 *                           network is expected to perform: differencing two
 *                           7-digit numbers to recover a 1 m offset is a
 *                           floating-point job, not a cognitive one, and
 *                           pretending otherwise would make the task
 *                           unlearnable for reasons that have nothing to do
 *                           with rendezvous. Accuracy degrades with range.
 *
 *   laser        < 250 m    Five retroreflector returns, each as range,
 *                           azimuth and elevation IN THE BODY FRAME, inside a
 *                           25° cone off the nose. No pose, no solution, no
 *                           filtering — five noisy points, the way the hardware
 *                           delivers them. Recovering position AND attitude of
 *                           the port from those five returns is the network's
 *                           problem, and it is the same problem a docking LIDAR
 *                           processor solves. It is also why the vessel has to
 *                           learn to POINT: outside the cone there are no
 *                           returns at all and the flags go to zero.
 *
 *   radar        < 30 km    Range and range rate only. A single scalar pair
 *                           that bridges the gap between "the ephemeris is too
 *                           coarse" and "the laser cannot see you yet".
 *
 * WHAT IS NOT GIVEN. Nothing is pre-resolved into the LVLH frame. The relative
 * vector arrives in ECI and the laser arrives in the body frame, and the
 * network is handed its own attitude as three body axes expressed in ECI — so
 * the rotation between what it sees and what it can act on is a bilinear
 * function it has to build out of hidden units. That is deliberate. Knowing
 * that "+V-bar" means "the direction my +X axis points when my attitude is
 * such-and-such given where in the orbit I am" is most of what an orbital
 * pilot knows, and handing it over as a pre-computed input would remove the
 * part of this problem that is about orbits.
 *
 * A TEMPORAL WINDOW, NOT RECURRENCE. Every channel is presented at several
 * lags, and the lags are in SECONDS, resolved against a time-stamped ring
 * buffer — not in ticks. Ticks are not a fixed unit here: the control rate
 * changes with range and a coast can advance twenty seconds in one step, so a
 * fixed lag of "four samples ago" would mean 1 second during a terminal
 * approach and 80 seconds mid-coast, and any rate the network learned to read
 * at one range would be meaningless at another. The ladder is
 * 0 / 0.5 / 1 / 2 / 4 / 16 / 60 s depending on the channel, because this plant
 * genuinely has that many timescales: thruster pulses at 20 ms, attitude slews
 * at 10 s, the orbit itself at 5,569 s.
 */
"use strict";

/* Lags in seconds, per channel group. Nearest sample at or before the
 * requested time; if the buffer does not reach back that far the oldest sample
 * is used, which is correct behaviour at the very start of an episode. */
const GROUPS = [
    { name: "abs", n: 17, lags: [0, 60] },
    { name: "rel", n: 11, lags: [0, 1, 4, 16, 64] },
    { name: "att", n: 12, lags: [0, 0.5, 2] },
    { name: "port", n: 9, lags: [0] },
    { name: "lidar", n: 22, lags: [0, 0.5, 2] },
    { name: "radar", n: 3, lags: [0, 2, 16] },
    { name: "self", n: 19, lags: [0, 1] }
];

const CH = {};      // group name → { start, n }
let N_CHANNELS = 0;
for (const g of GROUPS) { CH[g.name] = { start: N_CHANNELS, n: g.n, lags: g.lags }; N_CHANNELS += g.n; }

const NIN = GROUPS.reduce((s, g) => s + g.n * g.lags.length, 0);

const LIDAR_RANGE = 250;                 // m
const LIDAR_FOV = 25 * Math.PI / 180;    // half-angle off the nose
const LIDAR_MOUNT = [1.90, 0, 0];        // body frame, beside the docking ring
const RADAR_RANGE = 30000;               // m

/* Ring buffer of time-stamped channel snapshots. */
class Sensors {
    constructor(navNoise, rng) {
        this.noise = navNoise != null ? navNoise : 1;
        this.rng = rng;
        this.cap = 192;
        this.buf = new Float32Array(this.cap * N_CHANNELS);
        this.times = new Float64Array(this.cap);
        this.head = -1;
        this.count = 0;
        this.cur = new Float32Array(N_CHANNELS);
        this.input = new Float32Array(NIN);
        this.stale = null;
        // Diagnostics the UI and the probes read; not part of the input vector.
        this.lidarLock = 0;
        this.lidarSeen = 0;
    }

    _g(sigma) { return sigma > 0 ? gaussRand(this.rng) * sigma : 0; }

    /* Build the channel vector for the current instant and push it. */
    sample(st) {
        const c = this.cur;
        c.fill(0);
        const NZ = this.noise;

        const rc = V.add(st.rs, st.rho);
        const vc = V.add(st.vs, st.rhoDot);

        /* ---------------------------------------------------- ephemeris */
        let k = CH.abs.start;
        const ownR = V.len(rc), staR = V.len(st.rs);
        const ownHat = V.mul(rc, 1 / ownR), staHat = V.mul(st.rs, 1 / staR);
        const hHat = V.unit(V.cross(st.rs, st.vs));
        // 30 m of position noise on a 6,800 km radius is 4.4e-6 of the signal —
        // invisible once scaled, which is the point: this channel carries
        // geometry, not proximity.
        for (let i = 0; i < 3; i++) c[k++] = ownHat[i] + this._g(30 / ownR * NZ);
        c[k++] = (ownR - R_EARTH - 400000) / 40000;
        for (let i = 0; i < 3; i++) c[k++] = vc[i] / 8000;
        for (let i = 0; i < 3; i++) c[k++] = staHat[i] + this._g(30 / staR * NZ);
        c[k++] = (staR - R_EARTH - 400000) / 40000;
        for (let i = 0; i < 3; i++) c[k++] = st.vs[i] / 8000;
        for (let i = 0; i < 3; i++) c[k++] = hHat[i];

        /* -------------------------------------------------- relative nav */
        /* Reported ONE TICK LATE. Every real navigation solution is stale by
         * the time it reaches the flight computer, and a controller tuned on
         * fresh truth is a controller that will oscillate on the vehicle. The
         * lag ladder gives the network the material to compensate; this line is
         * what makes compensation necessary. */
        const trueRel = {
            p: V.copy(st.rho), v: V.copy(st.rhoDot),
            r: V.len(st.rho)
        };
        const rel = this.stale || trueRel;
        this.stale = trueRel;
        const R = Math.max(rel.r, 1e-3);
        const sigP = Math.max(0.5, 0.0012 * R) * NZ;
        const sigV = Math.max(0.008, 2.5e-5 * R) * NZ;
        const mp = [rel.p[0] + this._g(sigP), rel.p[1] + this._g(sigP), rel.p[2] + this._g(sigP)];
        const mv = [rel.v[0] + this._g(sigV), rel.v[1] + this._g(sigV), rel.v[2] + this._g(sigV)];
        const mR = Math.max(V.len(mp), 1e-3);
        k = CH.rel.start;
        for (let i = 0; i < 3; i++) c[k++] = mp[i] / mR;
        // Log range across five decades, mapped so that 1 m → 0 and 200 km → 1.
        c[k++] = Math.log10(mR) / 5.3;
        for (let i = 0; i < 3; i++) c[k++] = Math.tanh(mv[i] / 20);
        c[k++] = Math.tanh(V.dot(mp, mv) / mR / 8);
        /* Soft range tiers. Not a one-hot — smooth sigmoidal gates, so the
         * network gets a continuous "how close am I, in orders of magnitude"
         * signal that does not jump. A hard flag at 250 m would put a
         * discontinuity in the policy exactly where the terminal approach
         * begins. */
        c[k++] = 1 / (1 + Math.exp((mR - 100) / 40));
        c[k++] = 1 / (1 + Math.exp((mR - 2000) / 800));
        c[k++] = 1 / (1 + Math.exp((mR - 40000) / 15000));

        /* ------------------------------------------------------ attitude */
        const ax = Q.axes(st.craft.q);
        k = CH.att.start;
        const sigA = 0.01 * Math.PI / 180 * NZ;
        for (const a of [ax.x, ax.y, ax.z]) {
            for (let i = 0; i < 3; i++) c[k++] = a[i] + this._g(sigA);
        }
        for (let i = 0; i < 3; i++) c[k++] = Math.tanh((st.craft.w[i] + this._g(3e-5 * NZ)) / 0.02);

        /* ------------------------------- station's published port geometry */
        /* The station tells the chaser where its port is and which way it
         * faces, in ECI. This is a broadcast, not a measurement — a real
         * station's attitude is known to a small fraction of a degree — but it
         * says nothing about where the CHASER is relative to it. Turning
         * "the port faces this way in ECI" plus "you are over there in ECI"
         * into "you are 40 m off to the side of the corridor" is the network's
         * job, and it is a rotation it has to learn. */
        k = CH.port.start;
        const pOff = st.portOffsetEci, pN = st.portNormalEci, pU = st.portUpEci;
        for (let i = 0; i < 3; i++) c[k++] = pOff[i] / 20;
        for (let i = 0; i < 3; i++) c[k++] = pN[i];
        for (let i = 0; i < 3; i++) c[k++] = pU[i];

        /* --------------------------------------------------------- laser */
        k = CH.lidar.start;
        const sensorEci = Q.rot(st.craft.q, LIDAR_MOUNT);
        let seen = 0;
        for (let j = 0; j < st.reflectorsEci.length; j++) {
            // (station centre + reflector offset) − (chaser CoM + sensor mount),
            // all expressed as offsets from the station centre; ρ is chaser
            // minus station, so the station's own terms cancel out.
            const los = [
                st.reflectorsEci[j][0] - st.rho[0] - sensorEci[0],
                st.reflectorsEci[j][1] - st.rho[1] - sensorEci[1],
                st.reflectorsEci[j][2] - st.rho[2] - sensorEci[2]
            ];
            const d = V.len(los);
            const b = Q.unrot(st.craft.q, los);          // into the body frame
            const off = Math.atan2(Math.sqrt(b[1] * b[1] + b[2] * b[2]), b[0]);
            // A retroreflector is a corner cube: it returns light only from
            // roughly the hemisphere it faces, and grazing incidence kills it.
            const facing = -V.dot(V.unit(los), st.portNormalEci);
            const ok = d <= LIDAR_RANGE && d > 0.05 && off <= LIDAR_FOV && b[0] > 0 && facing > 0.15;
            if (ok) {
                seen++;
                const sr = (0.01 + 0.0012 * d) * NZ;
                const sa = 0.05 * Math.PI / 180 * NZ;
                const dm = d + this._g(sr);
                c[k++] = 1;
                c[k++] = 1 - Math.min(1, dm / LIDAR_RANGE);
                c[k++] = (Math.atan2(b[1], b[0]) + this._g(sa)) / LIDAR_FOV;
                c[k++] = (Math.atan2(b[2], Math.sqrt(b[0] * b[0] + b[1] * b[1])) + this._g(sa)) / LIDAR_FOV;
            } else {
                c[k++] = 0; c[k++] = 0; c[k++] = 0; c[k++] = 0;
            }
        }
        this.lidarSeen = seen;
        this.lidarLock = seen >= 3 ? 1 : 0;
        c[k++] = seen / st.reflectorsEci.length;
        c[k++] = this.lidarLock;

        /* --------------------------------------------------------- radar */
        k = CH.radar.start;
        if (R <= RADAR_RANGE) {
            const sr = (5 + 0.001 * R) * NZ;
            c[k++] = 1;
            c[k++] = Math.log10(Math.max(1, R + this._g(sr))) / 5.3;
            c[k++] = Math.tanh((V.dot(rel.p, rel.v) / R + this._g(0.03 * NZ)) / 20);
        } else { k += 3; }

        /* ---------------------------------------------------------- self */
        k = CH.self.start;
        c[k++] = st.craft.fuelFrac;
        c[k++] = st.craft.mass / 6300;
        c[k++] = st.t / st.tLimit;
        c[k++] = Math.log10(Math.max(1, st.tLimit - st.t)) / 4.5;
        for (let i = 0; i < 7; i++) c[k++] = st.lastGuid ? st.lastGuid[i] : 0;
        for (let i = 0; i < 6; i++) c[k++] = st.lastCtrl ? st.lastCtrl[i] : 0;
        c[k++] = st.coasting ? 1 : 0;
        c[k++] = st.coastLeft ? Math.min(1, st.coastLeft / 300) : 0;

        this._push(st.t);
        return c;
    }

    _push(t) {
        this.head = (this.head + 1) % this.cap;
        this.times[this.head] = t;
        this.buf.set(this.cur, this.head * N_CHANNELS);
        if (this.count < this.cap) this.count++;
    }

    /* Walk back from the head to the newest sample at or before `t`. The
     * buffer holds at most 192 snapshots, and during an active approach at
     * 4 Hz that is only 48 seconds — deliberately: the 60 s lag on the slow
     * ephemeris channels is then served by whatever the oldest sample is, which
     * during a fast terminal approach is the right answer anyway (nothing about
     * the orbit changed in the last minute that matters at 5 m range). During a
     * coast the samples are 10–20 s apart and the buffer reaches back half an
     * hour, which is when the long lags earn their keep. */
    _at(t) {
        let i = this.head;
        for (let s = 0; s < this.count; s++) {
            if (this.times[i] <= t + 1e-9) return i;
            i = (i - 1 + this.cap) % this.cap;
        }
        return (this.head - this.count + 1 + this.cap * 2) % this.cap;
    }

    /* Gather the lag ladder into the network input vector. */
    assemble(tNow) {
        const out = this.input;
        let o = 0;
        for (const g of GROUPS) {
            const base = CH[g.name].start;
            for (const lag of g.lags) {
                const idx = lag === 0 ? this.head : this._at(tNow - lag);
                const off = idx * N_CHANNELS + base;
                for (let i = 0; i < g.n; i++) out[o++] = this.buf[off + i];
            }
        }
        return out;
    }
}

if (typeof module !== "undefined") {
    module.exports = {
        Sensors, NIN, N_CHANNELS, GROUPS, CH,
        LIDAR_RANGE, LIDAR_FOV, LIDAR_MOUNT, RADAR_RANGE
    };
}
