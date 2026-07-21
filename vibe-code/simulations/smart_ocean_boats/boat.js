/* boat.js — physics + sensing for one 60 cm hydrofoil boat.
 *
 * Everything is SI: meters, seconds, newtons, kilograms. The control loop runs
 * at 15 Hz (physics at 30 Hz) — the same cadence a microcontroller on the real
 * hull would use, so a trained brain maps 1:1 onto real hardware.
 *
 * Inputs (47):                              Outputs (5, all 0..1):
 *   0-13  land rays (14, full circle)         0 engine 1 (port)
 *  14-27  ship rays (14, full circle)         1 engine 2 (starboard)
 *  28     speed                               2 brake flap + reverse
 *  29-31  commanded accel state n, n-1, n-2   3 rotate left  (thruster/rudder)
 *  32-33  body accelerometer x (fwd), y      4 rotate right
 *  34     distance left along GPS route
 *  35     straight-line distance to target
 *  36-37  sin/cos of bearing to target relative to compass heading
 *  38     GPS route heading on current stretch, relative to heading
 *  39-40  sin/cos of ocean-current direction relative to heading, ×strength
 *  41-42  sin/cos of wind direction relative to heading, ×strength
 *  43-46  the same four flow readings from the previous control tick (n−1),
 *         so the net can sense gust onset and current shear by differencing
 */
"use strict";

const BOAT = {
    LOA: 0.60, BEAM: 0.38,        // real dimensions (m)
    MASS: 4.2,                    // kg, foiling RC hull with battery
    IZ: 0.12,                     // yaw inertia (kg·m²)
    ENG_OFF: 0.10,                // engine offset from centerline (m)
    MAX_THRUST: 5.0,              // N per engine
    C1_FWD: 0.8,                  // linear forward drag
    C2_DISP: 2.4,                 // quadratic drag, hull in the water
    C2_FOIL: 0.5,                 // quadratic drag, up on the foils
    FOIL_LO: 1.2, FOIL_HI: 1.9,   // takeoff speed band (m/s)
    LAT_LIN: 6.0, LAT_QUAD: 22.0, // lateral (keel/foil) drag
    WIND_KF: 0.055, WIND_KS: 0.11,// windage, frontal / side (30-40 cm topsides)
    ROT_STATIC: 0.18, ROT_DYN: 0.30, // steering torque: thruster + rudder authority
    YAW_D1: 0.06, YAW_D2: 0.25,   // yaw damping
    STICTION_F: 0.55,             // N of thrust needed to unstick from rest
    RADIUS: 0.34,                 // collision radius (m)
    SENSOR_N: 14,
    SENSOR_RANGE: 26,             // m
    HP: 3
};

const NET_SIZES = [47, 32, 18, 5];

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
        this.prevCmd = [0, 0, 0];                // commanded accel state history
        this.prevFlow = new Float32Array(4);     // last tick's current/wind readings
        this.ax = 0; this.ay = 0;                // body-frame accelerometer
        this.speed = 0; this.fwdSpeed = 0;
        this.foil = 0;

        // mission / scoring state (managed by World)
        this.tracker = null;
        this.missionIdx = 0;
        this.arrivals = 0;
        this.legStartTime = 0;
        this.legInitStraight = 1;
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
        const inp = this.inputs;
        const N = BOAT.SENSOR_N, R = BOAT.SENSOR_RANGE;
        const map = world.map;

        // 14 land rays + 14 ship rays, evenly spaced, ray 0 out the bow
        for (let i = 0; i < N; i++) {
            const th = this.heading + (i / N) * Math.PI * 2;
            const c = Math.cos(th), s = Math.sin(th);
            // land: fixed-step march on the collision grid
            let dLand = R;
            for (let d = 0.5; d < R; d += 0.35) {
                if (map.isLand(this.x + c * d, this.y + s * d)) { dLand = d; break; }
            }
            inp[i] = 1 - dLand / R;
            // ships: nearest boat close to this ray
            let dShip = R;
            for (const o of world.nearOf(this)) {
                const rx = o.x - this.x, ry = o.y - this.y;
                const along = rx * c + ry * s;
                if (along < 0.3 || along > R) continue;
                const perp = Math.abs(rx * -s + ry * c);
                if (perp < BOAT.RADIUS + 0.25 && along < dShip) dShip = along;
            }
            inp[N + i] = 1 - dShip / R;
        }

        inp[28] = Math.min(1.2, this.speed / 5);
        inp[29] = this.prevCmd[0];
        inp[30] = this.prevCmd[1];
        inp[31] = this.prevCmd[2];
        inp[32] = Math.max(-1.5, Math.min(1.5, this.ax / 8));
        inp[33] = Math.max(-1.5, Math.min(1.5, this.ay / 8));

        if (this.tracker) {
            const nav = this.tracker.update(this.x, this.y);
            this._nav = nav;
            if (nav.remainAlong < this.bestRemainAlong) this.bestRemainAlong = nav.remainAlong;
            if (nav.straight < this.bestStraight) this.bestStraight = nav.straight;
            inp[34] = Math.min(1.5, nav.remainAlong / 120);
            inp[35] = Math.min(1.5, nav.straight / 120);
            const rel = wrapPi(nav.bearing - this.heading);
            inp[36] = Math.sin(rel);
            inp[37] = Math.cos(rel);
            inp[38] = wrapPi(nav.legHeading - this.heading) / Math.PI;
        } else {
            inp[34] = inp[35] = inp[36] = inp[38] = 0; inp[37] = 1;
        }

        // ocean current and wind, as sin/cos of their direction relative to the
        // bow, scaled by strength — zero flow reads as (0, 0) instead of an
        // undefined direction. A real hull estimates these from GPS drift and
        // a masthead wind vane.
        const [cwx, cwy] = map.current(this.x, this.y, world.time);
        const cmag = Math.hypot(cwx, cwy);
        if (cmag > 0.02) {
            const rel = wrapPi(Math.atan2(cwy, cwx) - this.heading);
            const k = Math.min(1, cmag / 1.0);
            inp[39] = Math.sin(rel) * k;
            inp[40] = Math.cos(rel) * k;
        } else { inp[39] = inp[40] = 0; }
        const wmagIn = Math.hypot(world.wind[0], world.wind[1]);
        if (wmagIn > 0.1) {
            const rel = wrapPi(Math.atan2(world.wind[1], world.wind[0]) - this.heading);
            const k = Math.min(1, wmagIn / 6.0);
            inp[41] = Math.sin(rel) * k;
            inp[42] = Math.cos(rel) * k;
        } else { inp[41] = inp[42] = 0; }

        // previous-tick flow readings, then remember this tick's for next time
        const pf = this.prevFlow;
        inp[43] = pf[0]; inp[44] = pf[1]; inp[45] = pf[2]; inp[46] = pf[3];
        pf[0] = inp[39]; pf[1] = inp[40]; pf[2] = inp[41]; pf[3] = inp[42];

        if (noiseOn) {
            for (let i = 0; i < inp.length; i++) inp[i] += (Math.random() * 2 - 1) * 0.02;
        }

        const o = this.brain.forward(inp);
        for (let i = 0; i < 5; i++) {
            let v = o[i];
            if (noiseOn) v += (Math.random() * 2 - 1) * 0.03;
            this.out[i] = Math.max(0, Math.min(1, v));
        }

        // commanded acceleration state history (what the ESC was just told)
        const cmd = (this.out[0] + this.out[1]) * 0.5 - this.out[2];
        this.prevCmd[2] = this.prevCmd[1];
        this.prevCmd[1] = this.prevCmd[0];
        this.prevCmd[0] = cmd;
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

        this.hitCooldown -= dt;
        this.gunCooldown -= dt;
        this.speed = Math.hypot(this.vx, this.vy);
        this.fwdSpeed = u;
    }

    /* live fitness: banked legs + progress on the current leg – penalties */
    fitness() {
        // Penalties stay below the value of honest progress (priority order:
        // arrivals > closeness > clean sailing > speed) — otherwise boats that
        // never leave the spawn outrank boats that try and clip a rock.
        // Grounding bleeds points for every second spent stuck, not just the
        // initial strike.
        const pen = Math.max(-400,
            -(15 * this.landHits + 10 * this.grindTime + 30 * this.shipHits));
        let f = this.fitScore + pen + this.combatScore;
        if (this.tracker) {
            const prog = Math.max(0, 1 - this.bestRemainAlong / this.tracker.total);
            f += prog * 600;
            const close = Math.max(0, 1 - this.bestStraight / Math.max(this.legInitStraight, 1));
            f += close * 150;
        }
        return f;
    }
}

if (typeof module !== "undefined") module.exports = { Boat, BOAT, NET_SIZES, wrapPi };
