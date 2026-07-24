/* boat.js — physics + sensing for one 60 cm hydrofoil boat.
 *
 * Everything is SI: meters, seconds, newtons, kilograms. The control loop runs
 * at 15 Hz (physics at 30 Hz) — the same cadence a microcontroller on the real
 * hull would use, so a trained brain maps 1:1 onto real hardware.
 *
 * The brain sees a TEMPORAL WINDOW: each channel below is fed as its last
 * DEPTH[ch] control ticks (newest first), so the net can read rates and trends —
 * closing speed on an obstacle ray, bearing rate, gust onset, the yaw/steer
 * history that turns a P heading loop into a PD one — without any recurrence.
 * Depth is per channel: fast/rate-critical channels run deep, slow ones (route
 * distance, leg heading) run shallow. The input starts with a full lag-0 block
 * of all NC channels (so the overlay still reads inp[0..27]), then each deeper
 * lag appends only the channels whose depth reaches that far back.
 *
 * The NC per-tick channels (Outputs: 5, all 0..1):
 *   0-13  land rays (14, full circle)          0 engine 1 (port)
 *  14-27  ship rays (14, full circle)          1 engine 2 (starboard)
 *  28     signed surge speed u (+ = ahead)     2 brake flap + reverse
 *  29-30  body accelerometer x (fwd), y        3 rotate left (thruster/rudder)
 *  31     distance left along GPS route        4 rotate right
 *  32     straight-line distance to target
 *  33-34  sin/cos of bearing to target relative to compass heading
 *  35     GPS route heading on current stretch, relative to heading
 *  36-37  sin/cos of ocean-current direction relative to heading, ×strength
 *  38-39  sin/cos of wind direction relative to heading, ×strength
 *  40     yaw rate (gyro Z), + = bow swinging to starboard
 *  41     signed cross-track error from the route leg, + = right of the line
 *  42     body-frame sway velocity, + = sliding to starboard
 *  43     commanded accel (out0+out1)/2 - out2, as issued last tick
 *  44     commanded steer (out4-out3), as issued last tick, + = starboard
 *  45     commanded diff thrust (out1-out0), last tick, + = starboard-yaw
 *
 * Channels 40-45 close a P-only observability gap: without yaw-rate + steering-
 * efference history the net sees heading error but not its rate, so a hull with
 * rotational inertia driven through actuator lag snakes in a limit cycle. Every
 * angular/lateral sign shares one convention: + = starboard. Lag-0 of channels
 * 0-27 stays where it was, so the sensor-ray overlay reads inp[0..27] unchanged.
 */
"use strict";

const BOAT = {
    LOA: 0.60, BEAM: 0.38,        // real dimensions (m)
    MASS: 4.2,                    // kg, foiling RC hull with battery
    IZ: 0.12,                     // yaw inertia (kg·m²)
    ENG_OFF: 0.10,                // engine offset from centerline (m)
    MAX_THRUST: 6.0,              // N per engine
    C1_FWD: 0.8,                  // linear forward drag
    C2_DISP: 2.4,                 // quadratic drag, hull in the water
    C2_FOIL: 0.5,                 // quadratic drag, up on the foils
    FOIL_LO: 1.2, FOIL_HI: 1.9,   // takeoff speed band (m/s)
    LAT_LIN: 6.0, LAT_QUAD: 22.0, // lateral (keel/foil) drag
    WIND_KF: 0.055, WIND_KS: 0.11,// windage, frontal / side (30-40 cm topsides)
    ROT_STATIC: 0.26, ROT_DYN: 0.48, // steering torque: thruster + rudder authority
                                  // (raised for tighter turns in narrow canals)
    YAW_D1: 0.06, YAW_D2: 0.25,   // yaw damping
    YAW_RMAX: 1.0,                // rad/s (~57°/s) yaw-rate normalizer; measured
                                  // peak sustained turn ~1.3 rad/s, fits ±1.5 clamp
    STICTION_F: 0.55,             // N of thrust needed to unstick from rest
    RADIUS: 0.34,                 // collision radius (m)
    SENSOR_N: 14,
    SENSOR_RANGE: 26,             // m
    HP: 3,
    // path-efficiency scoring: a leg only "should" cost as much distance as the
    // progress it earns (×EFF_SLACK head-room for turns/current). Distance sailed
    // beyond that — swaying, circling — is penalised at EFF_W per metre, capped
    // at EFF_CAP so one bad leg can't dominate. This is what stops a boat from
    // farming survival points by covering distance instead of reaching GPS points.
    EFF_W: 6,
    EFF_SLACK: 1.2,
    EFF_CAP: 400
};

// Temporal window: each of the NC per-tick channels is fed as its last DEPTH[ch]
// control ticks. Fast/rate-critical channels get a deep window; slow ones (route
// distance, leg heading) get a shallow one — deep history there is just redundant
// weight the net has to learn to ignore. The net input size is the sum of DEPTH.
const NC = 46;
const DEPTH = new Uint8Array([
    // 0-27  land + ship rays — closing speed on an obstacle matters
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    3,          // 28 surge speed
    3, 3,       // 29-30 accelerometer x/y
    2, 2,       // 31-32 route-remaining / straight-line distance — slow, shallow
    4, 4,       // 33-34 bearing sin/cos — bearing rate drives pursuit
    2,          // 35 leg heading — constant within a leg, shallow
    3, 3,       // 36-37 ocean current sin/cos — gust/shear onset
    3, 3,       // 38-39 wind sin/cos
    5,          // 40 yaw rate — the D term, deep
    3,          // 41 cross-track error
    3,          // 42 sway velocity
    5, 5, 5     // 43-45 commanded accel / steer / diff — the actuator-lag pipeline
]);
const MAXHIST = DEPTH.reduce((m, d) => Math.max(m, d), 0);
const NIN = DEPTH.reduce((a, d) => a + d, 0);
const NET_SIZES = [NIN, 32, 18, 5];

function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}
function smoothstep(x, lo, hi) {
    const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
}

class Boat {
    constructor(brain, idx) {
        this.brain = brain;
        this.idx = idx;
        this.reset(0, 0, 0);
    }

    reset(x, y, heading) {
        this.x = x; this.y = y;
        this.heading = heading;
        this.vx = 0; this.vy = 0;
        this.omega = 0;
        this.alive = true;
        this.done = false;        // personal clock ran out — frozen, score locked
        this.timeLeft = 0;        // seconds on this boat's clock (set by World)
        this.hp = BOAT.HP;

        this.inputs = new Float32Array(NET_SIZES[0]);
        this.out = new Float32Array(5);          // commanded by the net
        this.act = new Float32Array(5);          // after ESC/servo lag
        // ring buffer of the last MAXHIST channel vectors (all zero = "no past yet")
        this.histBuf = [];
        for (let i = 0; i < MAXHIST; i++) this.histBuf.push(new Float32Array(NC));
        this.histWrite = 0;
        this.lastCmd = [0, 0, 0];                // [accel, steer, diff] issued last tick
        this.ax = 0; this.ay = 0;                // body-frame accelerometer
        this.speed = 0; this.fwdSpeed = 0;
        this.foil = 0;

        // mission / scoring state (managed by World)
        this.tracker = null;
        this.missionIdx = 0;
        this.arrivals = 0;
        this.legStartTime = 0;
        this.legInitStraight = 1;
        this.legDist = 0;         // distance actually sailed on the current leg
        this.bestRemainAlong = 1e9;
        this.bestStraight = 1e9;
        this.fitScore = 0;                       // banked from completed legs
        this.penalty = 0;
        this.landHits = 0;
        this.shipHits = 0;
        this.grindTime = 0;
        this.hitCooldown = 0;
        this.gunCooldown = 0;
        this.combatScore = 0;
        this.hunting = false;
        this.huntTarget = -1;
        this.huntTimer = 0;
        this.trail = [];
    }

    /* ------------------------------------------------ sensing + control (15 Hz) */
    control(world, noiseOn) {
        const N = BOAT.SENSOR_N, R = BOAT.SENSOR_RANGE;
        const map = world.map;
        // write this tick's channel vector into the ring, then assemble the net
        // input from the last HIST slots (newest first).
        const cur = this.histBuf[this.histWrite];

        // 14 land rays + 14 ship rays, evenly spaced, ray 0 out the bow (0-27)
        for (let i = 0; i < N; i++) {
            const th = this.heading + (i / N) * Math.PI * 2;
            const c = Math.cos(th), s = Math.sin(th);
            // land: fixed-step march on the collision grid
            let dLand = R;
            for (let d = 0.5; d < R; d += 0.35) {
                if (map.isLand(this.x + c * d, this.y + s * d)) { dLand = d; break; }
            }
            cur[i] = 1 - dLand / R;
            // ships: nearest boat close to this ray
            let dShip = R;
            for (const o of world.nearOf(this)) {
                const rx = o.x - this.x, ry = o.y - this.y;
                const along = rx * c + ry * s;
                if (along < 0.3 || along > R) continue;
                const perp = Math.abs(rx * -s + ry * c);
                if (perp < BOAT.RADIUS + 0.25 && along < dShip) dShip = along;
            }
            cur[N + i] = 1 - dShip / R;
        }

        // signed surge (fwd water-relative speed): brake/reverse can make sternway,
        // which a speed magnitude would hide (28); accelerometer x/y (29-30)
        cur[28] = Math.max(-1.2, Math.min(1.2, this.fwdSpeed / 5));
        cur[29] = Math.max(-1.5, Math.min(1.5, this.ax / 8));
        cur[30] = Math.max(-1.5, Math.min(1.5, this.ay / 8));

        // navigation (31-35) + cross-track error (41)
        if (this.tracker) {
            const nav = this.tracker.update(this.x, this.y);
            this._nav = nav;
            if (nav.remainAlong < this.bestRemainAlong) this.bestRemainAlong = nav.remainAlong;
            if (nav.straight < this.bestStraight) this.bestStraight = nav.straight;
            cur[31] = Math.min(1.5, nav.remainAlong / 120);
            cur[32] = Math.min(1.5, nav.straight / 120);
            const rel = wrapPi(nav.bearing - this.heading);
            cur[33] = Math.sin(rel);
            cur[34] = Math.cos(rel);
            cur[35] = wrapPi(nav.legHeading - this.heading) / Math.PI;
            cur[41] = Math.max(-1.5, Math.min(1.5, nav.xte / 15));
        } else {
            cur[31] = cur[32] = cur[33] = cur[35] = cur[41] = 0; cur[34] = 1;
        }

        // ocean current and wind, as sin/cos of their direction relative to the
        // bow, scaled by strength — zero flow reads as (0, 0) instead of an
        // undefined direction (36-39). The temporal window supplies the gust/
        // shear differencing the old explicit prev-tick copies used to give.
        const [cwx, cwy] = map.current(this.x, this.y, world.time);
        const cmag = Math.hypot(cwx, cwy);
        if (cmag > 0.02) {
            const rel = wrapPi(Math.atan2(cwy, cwx) - this.heading);
            const k = Math.min(1, cmag / 1.0);
            cur[36] = Math.sin(rel) * k;
            cur[37] = Math.cos(rel) * k;
        } else { cur[36] = cur[37] = 0; }
        const wmagIn = Math.hypot(world.wind[0], world.wind[1]);
        if (wmagIn > 0.1) {
            const rel = wrapPi(Math.atan2(world.wind[1], world.wind[0]) - this.heading);
            const k = Math.min(1, wmagIn / 6.0);
            cur[38] = Math.sin(rel) * k;
            cur[39] = Math.cos(rel) * k;
        } else { cur[38] = cur[39] = 0; }

        // yaw rate (40, + = starboard) and body-frame sway (42, + = starboard
        // slide). With HIST ticks of these plus the command channels below, the
        // net sees heading-error rate and angular acceleration — the D term.
        cur[40] = Math.max(-1.5, Math.min(1.5, this.omega / BOAT.YAW_RMAX));
        const cs0 = Math.cos(this.heading), sn0 = Math.sin(this.heading);
        const vLat = -this.vx * sn0 + this.vy * cs0;
        cur[42] = Math.max(-1.5, Math.min(1.5, vLat / 2));

        // efference: the commands issued LAST tick (this tick's aren't formed yet),
        // still working through the actuator lag (43-45)
        cur[43] = this.lastCmd[0];
        cur[44] = this.lastCmd[1];
        cur[45] = this.lastCmd[2];

        // assemble the lag window: full lag-0 block first (keeps sensor rays at
        // inp[0..27] for the overlay), then each deeper lag appends only the
        // channels whose per-channel depth reaches that far back.
        const inp = this.inputs;
        let k = 0;
        for (let ch = 0; ch < NC; ch++) inp[k++] = cur[ch];
        for (let lag = 1; lag < MAXHIST; lag++) {
            const s = this.histBuf[(this.histWrite - lag + MAXHIST) % MAXHIST];
            for (let ch = 0; ch < NC; ch++) if (DEPTH[ch] > lag) inp[k++] = s[ch];
        }
        this.histWrite = (this.histWrite + 1) % MAXHIST;

        if (noiseOn) {
            for (let i = 0; i < inp.length; i++) inp[i] += (Math.random() * 2 - 1) * 0.02;
        }

        const o = this.brain.forward(inp);
        for (let i = 0; i < 5; i++) {
            let v = o[i];
            if (noiseOn) v += (Math.random() * 2 - 1) * 0.03;
            this.out[i] = Math.max(0, Math.min(1, v));
        }

        // remember what we just told the actuators, for next tick's efference
        // channels (+ = starboard-yaw: torque ~ (tR-tL), so out1-out0 turns +omega)
        this.lastCmd[0] = (this.out[0] + this.out[1]) * 0.5 - this.out[2];
        this.lastCmd[1] = this.out[4] - this.out[3];
        this.lastCmd[2] = this.out[1] - this.out[0];
    }

    /* ------------------------------------------------------- physics (30 Hz) */
    step(dt, world, t) {
        if (!this.alive) return;

        // ESC / servo response lag
        for (let i = 0; i < 5; i++) this.act[i] += (this.out[i] - this.act[i]) * 0.35;

        const cs = Math.cos(this.heading), sn = Math.sin(this.heading);
        const [cwx, cwy] = world.map.current(this.x, this.y, t);

        // velocity relative to the water, in body frame (u fwd, v lat)
        const rvx = this.vx - cwx, rvy = this.vy - cwy;
        const u = rvx * cs + rvy * sn;
        const v = -rvx * sn + rvy * cs;

        this.foil = smoothstep(Math.abs(u), BOAT.FOIL_LO, BOAT.FOIL_HI);
        const c2 = BOAT.C2_DISP + (BOAT.C2_FOIL - BOAT.C2_DISP) * this.foil;

        const tL = this.act[0] * BOAT.MAX_THRUST;
        const tR = this.act[1] * BOAT.MAX_THRUST;
        const brake = this.act[2];

        let Fu = tL + tR;
        // stiction: tiny thrust at rest goes nowhere (real props + wetted hull)
        if (Math.abs(u) < 0.05 && Fu < BOAT.STICTION_F && brake < 0.5) Fu = 0;
        Fu -= BOAT.C1_FWD * u + c2 * u * Math.abs(u);
        if (brake > 0.05) {
            Fu -= 5.0 * brake * u * Math.abs(u);            // drag flap
            if (u > 0.05) Fu -= 1.5 * brake;                // reverse prop wash
        }
        let Fv = -(BOAT.LAT_LIN * v + BOAT.LAT_QUAD * v * Math.abs(v));

        // wind on the topsides (relative wind, anisotropic area)
        const [wx, wy] = world.wind;
        const wrx = wx - this.vx, wry = wy - this.vy;
        const wu = wrx * cs + wry * sn, wv = -wrx * sn + wry * cs;
        const wmag = Math.hypot(wu, wv);
        Fu += BOAT.WIND_KF * wu * wmag;
        Fv += BOAT.WIND_KS * wv * wmag;

        // yaw: differential thrust + steering thruster/rudder + weathervane + damping
        const steer = (this.act[4] - this.act[3]) *
            (BOAT.ROT_STATIC + BOAT.ROT_DYN * Math.min(Math.abs(u), 3) / 3);
        let torque = (tR - tL) * BOAT.ENG_OFF + steer;
        torque += 0.03 * wv * wmag;
        torque -= BOAT.YAW_D1 * this.omega + BOAT.YAW_D2 * this.omega * Math.abs(this.omega);

        // accelerometer readout (specific force in body frame)
        this.ax = Fu / BOAT.MASS;
        this.ay = Fv / BOAT.MASS;

        // integrate (semi-implicit)
        const Fwx = Fu * cs - Fv * sn;
        const Fwy = Fu * sn + Fv * cs;
        this.vx += (Fwx / BOAT.MASS) * dt;
        this.vy += (Fwy / BOAT.MASS) * dt;
        this.omega += (torque / BOAT.IZ) * dt;
        this.heading = wrapPi(this.heading + this.omega * dt);

        const nx = this.x + this.vx * dt;
        const ny = this.y + this.vy * dt;

        const ox = this.x, oy = this.y;
        if (world.map.isLand(nx, ny)) {
            // grounded: stop dead, take the hit
            this.vx *= 0.15; this.vy *= 0.15; this.omega *= 0.4;
            this.grindTime += dt;
            if (this.hitCooldown <= 0) {
                this.landHits++;
                this.hitCooldown = 0.6;
            }
        } else {
            this.x = nx; this.y = ny;
        }
        this.legDist += Math.hypot(this.x - ox, this.y - oy);   // odometer (actual travel)

        this.hitCooldown -= dt;
        this.gunCooldown -= dt;
        this.speed = Math.hypot(this.vx, this.vy);
        this.fwdSpeed = u;
    }

    /* live fitness: banked legs + progress on the current leg – penalties.
     * Priority order: GPS points reached > closeness > efficient/clean sailing.
     * Progress is measured *along the route toward the goal*, never as raw
     * distance travelled — and any distance sailed beyond that progress is
     * penalised, so weaving to rack up the odometer is a net loss. */
    fitness() {
        // Grounding bleeds points for every second spent stuck, not just the
        // initial strike; land contact is weighted heaviest ("least collisions").
        const pen = Math.max(-500,
            -(25 * this.landHits + 15 * this.grindTime + 30 * this.shipHits));
        let f = this.fitScore + pen + this.combatScore;
        if (this.tracker) {
            const prog = Math.max(0, 1 - this.bestRemainAlong / this.tracker.total);
            f += prog * 600;
            const close = Math.max(0, 1 - this.bestStraight / Math.max(this.legInitStraight, 1));
            f += close * 150;
            // efficiency: penalise distance sailed past what the progress needed
            const useful = this.tracker.total - this.bestRemainAlong;
            const excess = Math.max(0, this.legDist - useful * BOAT.EFF_SLACK);
            f -= Math.min(BOAT.EFF_CAP, BOAT.EFF_W * excess);
        }
        return f;
    }
}

if (typeof module !== "undefined") module.exports = { Boat, BOAT, NET_SIZES, wrapPi };
