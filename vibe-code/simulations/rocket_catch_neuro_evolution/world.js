/* NOTE ON THE IIFE WRAPPER AROUND THIS FILE.
 *
 * Every module here is a Node CommonJS file AND is loaded by the page as a
 * plain <script> tag, because these simulations are expected to run from a
 * file:// URL with no server, no bundler and no network. Under Node each file
 * gets its own scope; under a script tag they all share one, and nine files
 * that each begin `const M = ...` and `const DEG = Math.PI/180` collide on the
 * first one and take the rest of the page down with them. The wrapper gives
 * each file its own scope in both worlds. `module` is still visible inside it
 * under Node, so the export at the bottom is unaffected.
 */
;(function () {
/* world.js — the rigid body, the tower it is trying to land inside, and the
 * number that comes out at the end.
 *
 * WHAT IS INTEGRATED. The state carried forward is the position and velocity of
 * the ENGINE PLANE — the structure — not of the centre of mass. That is a
 * deliberate and slightly awkward choice, and the reason is that the centre of
 * mass of a landing booster walks five and a half metres up the vehicle during
 * the landing burn as the residual methalox in the bottom of the tanks is
 * consumed. If you integrate the centre of mass and then derive the structure
 * from it, the structure appears to slide five metres downward through the
 * course of the burn — into the catch tolerance, which is 1.7 m. So Newton is
 * applied at the centre of mass and the result is transferred to the structure
 * with the rigid-body transport terms, including the one that comes from the
 * centre of mass moving inside the body.
 *
 * WHAT ENDS AN EPISODE. Contact with the ground, a catch attempt at the rails,
 * hitting the tower, structural failure, leaving the box, or the clock. There is
 * no contact solver: the moment the vehicle touches something the episode stops
 * and the state at that instant is what gets scored. That is not a shortcut — it
 * is the honest statement of the problem, because a Super Heavy has no legs and
 * "what happens after it touches the ground" is not a landing, it is an
 * accident.
 *
 * HOW IT IS SCORED, and why the scoring looks the way it does. A falling rocket
 * with no controller always dies, so unlike most of the sims in this collection
 * the risk here is not that episodes are uneventful — it is the opposite. Every
 * brain in generation 1 arrives at the ground at three hundred metres a second,
 * and if the score only distinguished "landed" from "did not" the entire
 * population would tie at zero forever. So almost all of the score is a graded
 * description of HOW it arrived: how far from the target, how fast, how upright,
 * how much it was spinning. That surface has a gradient everywhere, including in
 * the part of it occupied by smoking craters, and it is what lets selection
 * start.
 *
 * The tiers on top of it — a catch is worth 2.0, a legged pad landing 1.4, a
 * soft divert 1.0 — exist so that the ORDER of preference is unambiguous once
 * the population is good enough to reach them. A vehicle that can always divert
 * safely and never catch scores about as well as a vehicle that catches half the
 * time, which is roughly the trade the real programme makes.
 */
"use strict";

const M = (typeof require !== "undefined") ? require("./mathx.js") : window.MathX;
const V = (typeof require !== "undefined") ? require("./vehicle.js") : window.Vehicle;
const A = (typeof require !== "undefined") ? require("./aero.js") : window.Aero;
const ATM = (typeof require !== "undefined") ? require("./atmosphere.js") : window.Atmosphere;

const DEG = Math.PI / 180;

/* ------------------------------------------------------- reward shaping ----
 * Three shaping weights, overridable from the environment for A/B runs only.
 *
 * THE DEFAULTS ARE THE CANONICAL REWARD and an unset environment reproduces it
 * bit for bit, which is the whole point: a trainer launched with
 * ROCKET_W_SLOT=0.45 learns against a different objective, but `score_brain.js`
 * run afterwards WITHOUT the variable scores every arm's champion under the
 * same canonical reward. Comparing reward variants by their own training
 * scores is meaningless — raising a weight raises the number mechanically,
 * which measures the weight and not the policy.
 *
 * Browser side there is no `process`, so these are always the defaults there.
 */
const ENVW = (typeof process !== "undefined" && process.env) ? process.env : {};
const wnum = (k, d) => (ENVW[k] != null && ENVW[k] !== "") ? Number(ENVW[k]) : d;
const W_SLOT = wnum("ROCKET_W_SLOT", 0.16);    // the align-then-descend signal
const W_TIER = wnum("ROCKET_W_TIER", 1.00);    // multiplier on caught/landed/divert
const W_STRIKE = wnum("ROCKET_W_STRIKE", 1.00);  // multiplier on the tower/arm strike penalty
const W_CORRIDOR = wnum("ROCKET_W_CORRIDOR", 0.30);  // the sink-rate envelope, now that it bites
const W_BELLY = wnum("ROCKET_W_BELLY", 0.12);    // Ship only: hold the tiles into the airstream
const DT_PHYS = 0.005;         // 200 Hz
const CTRL_EVERY = 10;         // → 20 Hz control
const DT_CTRL = DT_PHYS * CTRL_EVERY;

const OUTCOME = {
    FLYING: 0,
    CAUGHT: 1,
    LANDED: 2,          // legs, on the pad, upright and soft
    SOFT_DIVERT: 3,     // soft upright touchdown inside the safe zone
    CRASH: 4,
    MISSED_CATCH: 5,    // passed the rails outside tolerance
    TOWER_STRIKE: 6,
    BREAKUP: 7,
    TUMBLE: 8,
    OUT_OF_BOUNDS: 9,
    TIMEOUT: 10
};
const OUTCOME_NAME = ["flying", "caught", "landed", "soft divert", "crash", "missed catch",
    "tower strike", "breakup", "tumble", "out of bounds", "timeout"];

const N_OUT = 10;   // network outputs — see applyControl()

class World {
    constructor(scenario) {
        this.sc = scenario;
        this.type = V.TYPES[scenario.vehicle];
        this.aero = new A.AeroModel(this.type);
        this.act = new V.Actuators(this.type);
        this.wind = scenario.wind;

        // state
        this.p = M.v3();          // engine-plane position, world
        this.v = M.v3();          // its velocity, world
        this.q = M.q4();          // body → world
        this.w = M.v3();          // angular velocity, body
        this.prop = 0;
        this.dry = false;
        this.t = 0;
        this.outcome = OUTCOME.FLYING;

        this.mp = { m: 0, com: 0, Ixx: 0, Iyy: 0, Izz: 0 };
        this.comPrev = 0;
        this.comDot = 0;

        // scratch
        this._vb = M.v3(); this._wb = M.v3(); this._axis = M.v3();
        this._fw = M.v3(); this._tmp = M.v3(); this._tmp2 = M.v3();
        this._vrel = M.v3(); this._pin = M.v3(); this._up = M.v3(); this._bly = M.v3();
        this._acc = M.v3(); this._wdot = M.v3();

        // telemetry the sensors and the score both read
        this.tel = {
            alt: 0, agl: 0, tilt: 0, alpha: 0, mach: 0, q: 0, qAlpha: 0,
            accB: M.v3(), vB: M.v3(), vrel: 0, gLoad: 0,
            toTowerX: 0, toTowerY: 0, toTowerZ: 0,
            toGroundX: 0, toGroundY: 0,
            pinX: 0, pinY: 0, pinZ: 0,
            thrustAcc: 0, lowest: 0
        };

        // score accumulators
        this.acc = {
            uprightNum: 0, uprightDen: 0,
            corridorPen: 0, corridorDen: 0,
            bellyNum: 0, bellyDen: 0,
            chatter: 0, chatterN: 0,
            minTowerDist: 1e9,
            bestTargetDist: 1e9,
            startTargetDist: 0,
            rangeViolation: 0,
            slotEntry: null,
            gate: null, gateBestDz: 1e9,
            maxQAlpha: 0, maxRate: 0,
            fuelUsed: 0,
            ticks: 0,
            commitTicks: 0
        };
        this.prevCmd = new Float64Array(N_OUT);
        this.haveCmd = false;

        this.reset();
    }

    /* ------------------------------------------------------------ setup --- */
    reset() {
        const sc = this.sc, ty = this.type;
        M.vcopy(this.p, sc.p0);
        M.vcopy(this.v, sc.v0);
        this.q[0] = sc.q0[0]; this.q[1] = sc.q0[1]; this.q[2] = sc.q0[2]; this.q[3] = sc.q0[3];
        M.vcopy(this.w, sc.w0);
        this.prop = sc.prop;
        this.dry = false;
        this.t = 0;
        this.outcome = OUTCOME.FLYING;
        this.disabled = 0;
        this.act = new V.Actuators(ty);
        // Scenarios may start the vehicle with its engines already running (a
        // booster that lit its landing burn two seconds ago) — otherwise a
        // network that has to discover ignition from scratch at 400 m/s never
        // gets a first generation.
        if (sc.preLit) {
            this.act.stage = sc.preLit;
            this.act.stageCmd = sc.preLit;
            this.act.everLit = true;
            this.act.igniteAt = -1;
            this.act.lightTime = 0;
            this.act.throttle = sc.preThrottle || 0.6;
            this.act.throttleCmd = this.act.throttle;
        }
        if (sc.preFlap != null) {
            for (let i = 0; i < this.act.nFlap; i++) { this.act.flap[i] = sc.preFlap; this.act.flapCmd[i] = sc.preFlap; }
        }
        V.massProps(ty, this.prop, this.mp);
        this.comPrev = this.mp.com;
        this.comDot = 0;
        this.catchAllowed = sc.catchAllowed ? 1 : 0;
        this.updateTelemetry();
        this.acc.startTargetDist = this.targetDist();
        this.acc.bestTargetDist = this.acc.startTargetDist;
    }

    /* ------------------------------------------------------- geometry ----- */
    axis(out) { return M.qrot(out, this.q, UNIT_Z); }

    /* World position of a point at body height z on the axis. */
    axisPoint(out, z) {
        this.axis(this._axis);
        out[0] = this.p[0] + this._axis[0] * z;
        out[1] = this.p[1] + this._axis[1] * z;
        out[2] = this.p[2] + this._axis[2] * z;
        return out;
    }

    /* The lowest point of the hull: the lower end of the axis, dropped by the
     * radius projected onto the horizontal. */
    lowestPoint() {
        this.axis(this._axis);
        const az = this._axis[2];
        const zBase = this.p[2];
        const zNose = this.p[2] + this.type.length * az;
        const sinTilt = Math.sqrt(Math.max(0, 1 - az * az));
        return Math.min(zBase, zNose) - this.type.radius * sinTilt;
    }

    /* --------------------------------------------------------- control ---- */
    /* The network's ten numbers, all in [-1, 1], become hardware commands.
     *
     *   0 throttle      1 engine ladder    2,3 gimbal      4..7 aero surfaces
     *   8 legs          9 commit to the tower
     *
     * The two vehicles share this vector. A booster uses surfaces 4-6 for its
     * three grid fins and ignores 7; a Ship uses all four for its flaps and
     * ignores nothing. Slot 8 does nothing on a booster, which has no legs and
     * never will. Sharing the vector is what makes a single genome able to fly
     * both — the network is told which vehicle it is in (see sensors.js) and has
     * to work out for itself that the same output means different hardware.
     */
    applyControl(o) {
        const ty = this.type, act = this.act;
        // Nothing the network says matters once it has lost the vehicle.
        if (this.disabled) return;

        act.throttleCmd = M.clamp((o[0] + 1) * 0.5, 0, 1);

        const ladderN = ty.engineLadder.length;
        let idx = Math.floor((o[1] + 1) * 0.5 * ladderN);
        act.stageCmd = M.clamp(idx, 0, ladderN - 1);

        const gmax = ty.engines[0].gimbal;
        act.gimbalCmdX = M.clamp(o[2], -1, 1) * gmax;
        act.gimbalCmdY = M.clamp(o[3], -1, 1) * gmax;

        for (let i = 0; i < ty.fins.length; i++) {
            act.finCmd[i] = M.clamp(o[4 + i], -1, 1) * ty.fins[i].maxDefl;
        }
        for (let i = 0; i < ty.flaps.length; i++) {
            const f = ty.flaps[i];
            act.flapCmd[i] = f.minDefl + (M.clamp(o[4 + i], -1, 1) + 1) * 0.5 * (f.maxDefl - f.minDefl);
        }

        if (ty.hasLegs && o[8] > 0) act.legCmd = 1;
        act.commit = o[9];

        // chatter: how hard the network is working the actuators. A small
        // penalty, because a policy that dithers at 20 Hz can look fine in this
        // simulation and would shake a real vehicle apart.
        if (this.haveCmd) {
            let c = 0;
            for (let i = 0; i < N_OUT; i++) { const d = o[i] - this.prevCmd[i]; c += d * d; }
            this.acc.chatter += Math.sqrt(c / N_OUT);
            this.acc.chatterN++;
        }
        for (let i = 0; i < N_OUT; i++) this.prevCmd[i] = o[i];
        this.haveCmd = true;
    }

    /* ---------------------------------------------------------- physics --- */
    step(dt) {
        if (this.outcome !== OUTCOME.FLYING) return;
        const ty = this.type, act = this.act, tel = this.tel;

        act.step(dt, this.t);
        /* A DRY VEHICLE'S HARDWARE MUST LOOK DRY TOO, every step and not just on
         * the step it ran out. The policy keeps commanding thrust, applyControl
         * keeps restoring the command, and act.step will happily spool engines
         * back up — the force is gated below, but act.thrust() would still
         * report a live burn to the OBSERVATION (thrust-to-weight is an input)
         * and to the renderer, which would draw flames on empty tanks. The gate
         * on the force keeps the physics honest; this keeps everything that
         * reads the actuator honest with it. */
        if (this.dry) {
            act.stageCmd = 0; act.throttleCmd = 0;
            act.stage = 0; act.throttle = 0;
        }

        // mass properties, and the rate at which the centre of mass is walking
        V.massProps(ty, this.prop, this.mp);
        this.comDot = (this.mp.com - this.comPrev) / dt;
        this.comPrev = this.mp.com;
        const m = this.mp.m, com = this.mp.com;

        const h = this.p[2];
        const air = ATM.airAt(h);
        const g = ATM.gravityAt(h);

        // air-relative velocity of the centre of mass, world then body
        const wnd = this.wind.at(h, this.t);
        this.axis(this._axis);
        // v_com = v_origin + w × (Q·(0,0,com))
        const Rw = this._tmp;
        Rw[0] = this._axis[0] * com; Rw[1] = this._axis[1] * com; Rw[2] = this._axis[2] * com;
        const wWorld = this._tmp2;
        M.qrot(wWorld, this.q, this.w);
        const vc = this._vrel;
        M.vcross(vc, wWorld, Rw);
        vc[0] += this.v[0] - wnd[0];
        vc[1] += this.v[1] - wnd[1];
        vc[2] += this.v[2] - wnd[2];
        M.qrotInv(this._vb, this.q, vc);

        const ae = this.aero.compute(this._vb, this.w, com, air, act);

        /* forces, body frame */
        let fbx = ae.fx, fby = ae.fy, fbz = ae.fz;
        let mbx = ae.mx, mby = ae.my, mbz = ae.mz;

        /* THRUST REQUIRES PROPELLANT, AND THE GATE HAS TO BE HERE.
         *
         * The old cutoff set act.stageCmd and act.throttleCmd to zero when the
         * tank emptied. Those are COMMANDS, and applyControl overwrites them
         * from the policy every control tick — so the shutdown was cancelled
         * 50 ms later, before the actuator's 120 ms shutdown dwell could even
         * elapse, and the engines simply kept burning. Measured at full throttle
         * on the top engine group: 3.68 SECONDS of thrust on an empty tank,
         * 63,476 kN.s of impulse, about 276 m/s of free delta-v on a 230 t
         * vehicle. That is most of a landing burn, available to any policy that
         * runs itself dry — and it was available to every policy in every
         * measurement this project has made.
         *
         * A command can be countermanded; a physical gate cannot. `dry` latches
         * once, so a vehicle that has run out stays out: there is no residual to
         * relight on, and letting it recover would just move the exploit. */
        if (this.prop <= 0) this.dry = true;
        const T = this.dry ? 0 : act.thrust();
        if (T > 0) {
            const tx = Math.sin(act.gimbalY);
            const tyy = -Math.sin(act.gimbalX);
            const tz = Math.sqrt(Math.max(0, 1 - tx * tx - tyy * tyy));
            const fx = T * tx, fy = T * tyy, fz = T * tz;
            fbx += fx; fby += fy; fbz += fz;
            const rz = ty.engines[0].z - com;
            // r × F with r = (0,0,rz)
            mbx += -rz * fy;
            mby += rz * fx;
            /* Draw only what is there, and count only what was drawn — the old
             * version clamped the tank at zero but still added the full demand
             * to fuelUsed, so the propellant accounting disagreed with itself on
             * the last step of every burn. */
            const draw = Math.min(this.prop, act.massFlow() * dt);
            this.prop -= draw;
            this.acc.fuelUsed += draw;
            if (this.prop <= 0) {
                this.dry = true;
                act.stageCmd = 0; act.throttleCmd = 0;
                act.stage = 0; act.throttle = 0;   // the hardware, not just the request
            }
        }

        // body force → world, add gravity
        const fw = this._fw;
        fw[0] = fbx; fw[1] = fby; fw[2] = fbz;
        M.qrot(fw, this.q, fw);
        const accCom = this._acc;
        accCom[0] = fw[0] / m;
        accCom[1] = fw[1] / m;
        accCom[2] = fw[2] / m - g;

        /* angular acceleration, body frame (Euler's equations) */
        const Ix = this.mp.Ixx, Iy = this.mp.Iyy, Iz = this.mp.Izz;
        const p = this.w[0], qq = this.w[1], r = this.w[2];
        const wd = this._wdot;
        wd[0] = (mbx - (Iz - Iy) * qq * r) / Ix;
        wd[1] = (mby - (Ix - Iz) * r * p) / Iy;
        wd[2] = (mbz - (Iy - Ix) * p * qq) / Iz;

        /* Transfer the centre-of-mass acceleration back to the engine plane.
         *   a0 = a_com − ω̇×R − ω×(ω×R) − 2ω×Ṙ
         * R is the world vector from the engine plane to the centre of mass and
         * Ṙ is how fast the centre of mass is walking up the body. */
        const wdW = this._tmp2;
        M.qrot(wdW, this.q, wd);
        const t1 = this._tmp;
        M.vcross(t1, wdW, Rw);
        accCom[0] -= t1[0]; accCom[1] -= t1[1]; accCom[2] -= t1[2];
        M.vcross(t1, wWorld, Rw);
        M.vcross(t1, wWorld, t1);
        accCom[0] -= t1[0]; accCom[1] -= t1[1]; accCom[2] -= t1[2];
        if (this.comDot !== 0) {
            const rdot = _rdot;
            rdot[0] = this._axis[0] * this.comDot;
            rdot[1] = this._axis[1] * this.comDot;
            rdot[2] = this._axis[2] * this.comDot;
            M.vcross(t1, wWorld, rdot);
            accCom[0] -= 2 * t1[0]; accCom[1] -= 2 * t1[1]; accCom[2] -= 2 * t1[2];
        }

        /* semi-implicit Euler */
        this.v[0] += accCom[0] * dt; this.v[1] += accCom[1] * dt; this.v[2] += accCom[2] * dt;
        this.p[0] += this.v[0] * dt; this.p[1] += this.v[1] * dt; this.p[2] += this.v[2] * dt;
        this.w[0] += wd[0] * dt; this.w[1] += wd[1] * dt; this.w[2] += wd[2] * dt;
        M.qIntegrate(this.q, this.w, dt);

        /* A NUMERICAL BACKSTOP FOR VEHICLES THAT HAVE ALREADY BEEN LOST.
         *
         * A tumble or a breakup disables the controls but deliberately keeps
         * flying the vehicle to the ground, so that quitting early buys
         * nothing — see checkTermination. The consequence nobody looked for is
         * that `if (!this.disabled)` also stops the structural limits from ever
         * being tested again, so a booster already spinning past its rate limit
         * goes on being integrated with an explicit 5 ms step while the strip
         * model, which is a quasi-steady model, is evaluated far outside the
         * regime it is valid in. It runs away: measured terminal speeds of
         * 1e10, 1e19 and 2e21 m/s, reached in one step from a state that was
         * merely bad.
         *
         * This does not pretend to model a disintegrating booster. It bounds
         * the state so the episode ends with a number a score can read, instead
         * of an arbitrary large one that silently zeroes the braking term and
         * poisons maxRate and the corridor accumulator. The bounds are far
         * outside anything a controlled flight reaches — a Super Heavy hits
         * about 640 m/s on stage 3 and tumbles at 60 deg/s — so this is
         * unreachable while the vehicle is still alive, and it is asserted as
         * such in test_headless.js. Measured: 0 of 720 episodes flown by the
         * live population touch it. */
        if (this.disabled) {
            const VMAX = 1200, WMAX = 12;
            for (let i = 0; i < 3; i++) {
                if (!isFinite(this.v[i])) this.v[i] = 0;
                else if (this.v[i] > VMAX) this.v[i] = VMAX;
                else if (this.v[i] < -VMAX) this.v[i] = -VMAX;
                if (!isFinite(this.w[i])) this.w[i] = 0;
                else if (this.w[i] > WMAX) this.w[i] = WMAX;
                else if (this.w[i] < -WMAX) this.w[i] = -WMAX;
            }
        }

        this.t += dt;

        // specific force (what an accelerometer reads), body frame — the single
        // most informative sensor on the vehicle and the only way it can feel
        // the wind at all.
        _sf[0] = fw[0] / m; _sf[1] = fw[1] / m; _sf[2] = fw[2] / m;
        M.qrotInv(tel.accB, this.q, _sf);
        tel.gLoad = M.vlen(_sf) / 9.80665;
        tel.thrustAcc = T / m;

        this.updateTelemetry();
        this.accumulate(dt, ae);
        this.checkTermination(dt);
    }

    updateTelemetry() {
        const tel = this.tel, ty = this.type, ae = this.aero.out;
        this.axis(this._axis);
        tel.alt = this.p[2];
        tel.lowest = this.lowestPoint();
        tel.agl = tel.lowest;
        tel.tilt = Math.acos(M.clamp(this._axis[2], -1, 1));
        tel.alpha = ae.alpha; tel.mach = ae.mach; tel.q = ae.q; tel.qAlpha = ae.qAlpha;
        tel.vrel = ae.vrel;
        M.vcopy(tel.vB, this._vb);

        const pin = this.axisPoint(this._pin, ty.catchPinZ);
        tel.pinX = pin[0]; tel.pinY = pin[1]; tel.pinZ = pin[2];
        tel.toTowerX = V.TOWER.gateX - pin[0];
        tel.toTowerY = V.TOWER.gateY - pin[1];
        tel.toTowerZ = V.TOWER.armZ - pin[2];
        const gt = this.sc.groundTarget;
        tel.toGroundX = gt.x - this.p[0];
        tel.toGroundY = gt.y - this.p[1];
    }

    /* Distance to whichever target the vehicle is currently working toward. */
    targetDist() {
        const tel = this.tel;
        if (this.wantsCatch()) return Math.hypot(tel.toTowerX, tel.toTowerY);
        return Math.hypot(tel.toGroundX, tel.toGroundY);
    }

    wantsCatch() {
        return this.catchAllowed && this.act.commit > 0;
    }

    /* --------------------------------------------------- score plumbing --- */
    accumulate(dt, ae) {
        const acc = this.acc, tel = this.tel;
        acc.ticks++;

        /* UPRIGHTNESS, WEIGHTED BY PROXIMITY TO THE GROUND. Being vertical at
         * 8 km is worth nothing; being vertical at 80 m is nearly the whole
         * problem. The weight is a Lorentzian in altitude with a 300 m scale, so
         * the last few seconds dominate the integral by a factor of thirty.
         * A Ship is exempt above its flip altitude: a belly-flop is SUPPOSED to
         * be horizontal and rewarding uprightness there would ask it to fly the
         * manoeuvre nose-up, burning the header tank it needs to land. */
        const hh = Math.max(0, tel.agl);
        let wgt = 1 / (1 + (hh / 300) * (hh / 300));
        if (this.type.key === "ship" && hh > 900) wgt = 0;
        const up = Math.cos(tel.tilt);
        acc.uprightNum += wgt * Math.max(0, up) * dt;
        acc.uprightDen += wgt * dt;

        /* THE DESCENT CORRIDOR. Not a trajectory to follow — a ceiling on sink
         * rate that tightens as the ground comes up. Without it the credit
         * assignment gap between "start braking" and "arrive slowly" is fifteen
         * seconds long and nothing in generation 1 ever crosses it.
         *
         * THE CEILING IS A BRAKING ENVELOPE, NOT A STRAIGHT LINE, and that
         * correction is what broke a hard plateau. The line it replaces,
         * `8 + 0.55h`, allowed 63 m/s at 100 m — which needs 200 m to stop —
         * and 8 m/s at touchdown, which is a crash. So a policy could sit
         * inside the corridor the whole way down and still destroy the vehicle,
         * and measurably did: the plateaued champion scored −0.027 here,
         * essentially clean, while crashing 14 of 16 held-out scenarios. A
         * shaping term that a failing policy already satisfies is not shaping
         * anything, and it left `arrival` — a purely terminal quantity — as the
         * only thing separating a crash from a catch.
         *
         * What replaces it is the speed a vehicle pulling `A_BRAKE` could still
         * null by the time it arrives, floored by a landing allowance, and
         * additionally held under a straight line near the ground where the
         * square root alone stays too generous. Tight at both ends:
         *
         *      h = 300 m -> 75 m/s      h = 60 m -> 35 m/s
         *      h =  10 m ->  7.5 m/s    h =  0 m ->  2 m/s
         */
        const A_BRAKE = 9.0, V_TOUCH = 2.0;
        const vSafe = V_TOUCH + Math.min(0.55 * hh, Math.sqrt(2 * A_BRAKE * hh));
        const sink = -this.v[2];
        /* WEIGHTED BY PROXIMITY TO THE GROUND, for the same reason uprightness
         * is. A plain time-average over the episode dilutes the only part that
         * decides anything: a booster that is inside the envelope for fifty
         * seconds and thirty metres per second too fast for the last two pays
         * almost nothing, which is how a policy that crashed 14 of 16 scored
         * −0.027 on a term whose entire job is to prevent exactly that. The
         * same Lorentzian the uprightness term uses puts thirty times the
         * weight on the final seconds. */
        if (sink > vSafe) acc.corridorPen += wgt * Math.min(3, (sink - vSafe) / vSafe) * dt;
        acc.corridorDen += wgt * dt;

        /* THE BELLY-FLOP IS A COMMANDED ATTITUDE, NOT MERELY A PERMITTED ONE.
         * Above its flip altitude the Ship was only EXEMPTED from the
         * uprightness reward — nothing paid it for actually holding the tiled
         * face into the airstream, so "fall however you like, then flip" scored
         * the same as a stable braked descent. It is the one attitude the
         * vehicle must hold for most of its flight and it had no term at all.
         * Rewarded on the body +X axis pointing down, which is what a belly-
         * flop IS, and it stops paying below the flip altitude so it can never
         * argue against the flip itself. */
        if (this.type.key === "ship") {
            if (hh > 900) {
                M.qrot(this._bly, this.q, UNIT_X);
                acc.bellyNum += Math.max(0, -this._bly[2]) * dt;
                acc.bellyDen += dt;
            }
        }

        const d = this.targetDist();
        if (d < acc.bestTargetDist) acc.bestTargetDist = d;

        if (ae.qAlpha > acc.maxQAlpha) acc.maxQAlpha = ae.qAlpha;
        const wr = M.vlen(this.w);
        if (wr > acc.maxRate) acc.maxRate = wr;

        if (this.act.commit > 0) acc.commitTicks++;

        /* THE SLOT IS ENTERED FROM ABOVE, AND UNTIL NOW NOTHING SAID SO.
         *
         * The rails sit at 12.5 m either side of a hull 4.5 m in radius, so the
         * arms are solid steel from 8 m of across-arm error outward — and some
         * part of a seventy-two metre booster is level with the arm plane for
         * the last seventy-seven metres of its descent. A vehicle that flies its
         * lateral error out WHILE it sinks therefore drags its flank through a
         * rail. Measured on the scripted autopilot: sixteen arm strikes to seven
         * tower strikes, median across-arm error 11.7 m, 61% of them inside that
         * annulus. The tell that it is geometric and not a tuning problem is
         * that damping the lateral loop makes it WORSE — a gentler approach
         * spends longer in the annulus.
         *
         * The manoeuvre this demands is align-then-descend, and the terminal
         * score could not ask for it: it only ever looked at where the vehicle
         * ended up, by which time the arm was already hit. So the across-arm
         * error is snapshotted ONCE, at the geometric instant the hull first
         * comes level with the arms, which is the last moment at which being
         * misaligned is still free. Graded in capture boxes like the rest of the
         * gate scoring, and taken once rather than integrated, so there is
         * nothing here to farm by loitering. */
        if (acc.slotEntry === null && this.wantsCatch() && this.p[2] < V.TOWER.armZ + 2) {
            acc.slotEntry = {
                across: Math.abs(tel.pinX - V.TOWER.gateX),
                along: Math.abs(tel.pinY - V.TOWER.gateY)
            };
        }

        /* THE CAPTURE RUNG HAS TO BE MEASURED WHERE CAPTURE HAPPENS.
         *
         * It was not. `phaseScores()` read the capture geometry off the TERMINAL
         * snapshot, and for a vehicle that misses, the terminal snapshot is
         * ground impact — a hundred and twenty metres below the rails and
         * several seconds of free drift past them. Measured on the arm-P
         * champion over the held-out bank: median terminal altitude 0.0 m,
         * median across-arm error 19.8 m against a 0.9 m gate, median pin
         * descent rate 25.9 m/s against a 2.5 m/s gate. The capture factors were
         * being evaluated at a point on the trajectory where capture is not
         * physically possible, so the rung could not see the difference between
         * a good approach that fell through and a bad one.
         *
         * So the whole capture-relevant state is snapshotted at the instant the
         * pins are CLOSEST TO THE RAIL PLANE. For a vehicle that descends past
         * the arms that is the crossing; for one that arrests above them it is
         * its lowest point, and the residual height is carried in `dz` so that
         * stopping fifty metres high is scored as the miss it is. Minimum-|dz|
         * rather than first-crossing because a vehicle that never reaches the
         * plane still has a best approach worth grading, and grading it is the
         * only reason a population that cannot yet get there has any gradient to
         * climb.
         *
         * Taken once, at an extremum, so there is nothing to farm by loitering:
         * hovering at the rails overwrites the snapshot only with a better one. */
        if (this.wantsCatch()) {
            const dz = Math.abs(tel.pinZ - V.TOWER.armZ);
            if (dz < acc.gateBestDz) {
                acc.gateBestDz = dz;
                const vp = this.pointVelocity(_vgate, this.type.catchPinZ);
                acc.gate = {
                    dx: tel.pinX - V.TOWER.gateX,
                    dy: tel.pinY - V.TOWER.gateY,
                    dz: tel.pinZ - V.TOWER.armZ,
                    vz: -vp[2], vh: Math.hypot(vp[0], vp[1]),
                    tilt: tel.tilt, rate: M.vlen(this.w)
                };
            }
        }

        // proximity to the tower, and the range-safety rule: you are not allowed
        // to be near the tower at all unless you have been cleared for a catch.
        const dTow = Math.hypot(tel.pinX - V.TOWER.gateX, tel.pinY - V.TOWER.gateY);
        const dStruct = Math.hypot(this.p[0], this.p[1]);
        if (dStruct < acc.minTowerDist) acc.minTowerDist = dStruct;
        if (!this.catchAllowed && hh < 400 && dStruct < 120) {
            acc.rangeViolation += dt * (1 - dStruct / 120);
        }
        void dTow;
    }

    /* ------------------------------------------------------ termination --- */
    checkTermination(dt) {
        const ty = this.type, tel = this.tel, sc = this.sc;

        // scenario events: the tower can be taken away mid-flight (a fouled pad,
        // a failed health check) or granted late.
        if (sc.revokeAt != null && this.t >= sc.revokeAt) this.catchAllowed = 0;
        if (sc.grantAt != null && this.t >= sc.grantAt) this.catchAllowed = 1;
        if (sc.engineOutAt != null && this.t >= sc.engineOutAt && !this._engineOut) {
            this._engineOut = true;
            // one engine of the live group dies: modelled as a thrust haircut
            // plus a fixed gimbal bias it has to trim out
            this.act.gimbalCmdX += 1.5 * DEG;
        }

        /* LOSING CONTROL DOES NOT END THE EPISODE. IT ENDS THE FLIGHT.
         *
         * Terminating on a tumble scores the vehicle where it stopped, and a
         * vehicle that gives up at 300 m while doing 50 m/s presents a far
         * better terminal state than one that flies all the way down and
         * arrives at 250. So the reward paid for quitting. Measured over
         * twenty-five generations with the bank held steady, the population
         * went from 17% tumbles to 76% while its tower strikes fell to nothing:
         * it had found that the cheapest way to survive the scoring function
         * was to stop flying, early, at altitude.
         *
         * A real tumbling booster does not vanish. It keeps falling, out of
         * control, and hits the ground — so that is what happens here. The
         * controls are cut, the outcome is remembered, and the episode runs to
         * the impact that was always coming. Quitting now buys exactly nothing,
         * which is the honest price. */
        if (!this.disabled) {
            if (tel.qAlpha > ty.qAlphaMax || tel.q > ty.qMax) this.disable(OUTCOME.BREAKUP);
            else if (M.vlen(this.w) > ty.rateMax) this.disable(OUTCOME.TUMBLE);
        }

        // box
        const hd = Math.hypot(this.p[0], this.p[1]);
        if (hd > 14000 || this.p[2] > 30000) { this.terminate(OUTCOME.OUT_OF_BOUNDS); return; }
        if (this.t > sc.tMax) { this.terminate(OUTCOME.TIMEOUT); return; }

        // tower structure and arms
        if (this.hitsTower()) { this.terminate(OUTCOME.TOWER_STRIKE); return; }

        // catch attempt: the pins descending through the rail plane, close enough
        // that the arms are actually there
        const gateDist = Math.hypot(tel.pinX - V.TOWER.gateX, tel.pinY - V.TOWER.gateY);
        if (this._pinAbove == null) this._pinAbove = tel.pinZ > V.TOWER.armZ;
        const nowAbove = tel.pinZ > V.TOWER.armZ;
        if (this._pinAbove && !nowAbove && gateDist < 20) {
            if (!this.disabled && this.catchAllowed && this.isCaught(gateDist)) this.terminate(OUTCOME.CAUGHT);
            else this.terminate(OUTCOME.MISSED_CATCH);
            return;
        }
        this._pinAbove = nowAbove;

        // ground
        if (tel.lowest <= 0) {
            // step back to the contact instant so the touchdown state is the
            // state at contact and not up to 25 cm past it
            const vz = this.v[2];
            if (vz < -0.01) {
                const back = Math.min(dt, -tel.lowest / -vz);
                this.p[0] -= this.v[0] * back; this.p[1] -= this.v[1] * back; this.p[2] -= this.v[2] * back;
                this.t -= back;
                this.updateTelemetry();
            }
            this.terminate(this.classifyTouchdown());
            return;
        }
    }

    hitsTower() {
        const T = V.TOWER, ty = this.type, R = ty.radius;
        this.axis(this._axis);
        // sample the axis; inflate the tower prism by the hull radius
        for (let i = 0; i <= 8; i++) {
            const z = (i / 8) * ty.length;
            const x = this.p[0] + this._axis[0] * z;
            const y = this.p[1] + this._axis[1] * z;
            const zz = this.p[2] + this._axis[2] * z;
            if (zz < 0 || zz > T.height + 6) continue;
            if (Math.abs(x) < T.halfWidth + R && Math.abs(y) < T.halfWidth + R) { this.strikePart = "tower"; return true; }
            /* The arms: two beams at rail height reaching out along armSide.
             * Measured in the arm's own direction so the test follows the
             * geometry instead of assuming +Y — assuming it is what made this
             * the last place the flip would have been noticed. */
            if (zz > T.armZ - 3.0 && zz < T.armZ + 2.0) {
                const ya = y * T.armSide;
                if (ya > T.armInner && ya < T.armInner + T.armReach) {
                    const dx = Math.abs(x) - T.gateHalfGap;
                    if (dx > -R && dx < R + 2.5) { this.strikePart = "arm"; return true; }
                }
            }
        }
        return false;
    }

    /* The capture test. Everything is measured at the pins, because that is the
     * only part of the vehicle the arms ever touch. */
    isCaught(gateDist) {
        const c = V.TOWER.capture, tel = this.tel;
        // Component-wise, not radial: tight across the arms, forgiving along
        // them, because that is the shape of the rails the pins come to rest on.
        if (Math.abs(tel.pinX - V.TOWER.gateX) > c.across) return false;
        if (Math.abs(tel.pinY - V.TOWER.gateY) > c.along) return false;
        // velocity of the pin, not of the centre of mass
        const vpin = this.pointVelocity(_vpin, this.type.catchPinZ);
        if (-vpin[2] > c.vz || vpin[2] > 1.0) return false;
        if (Math.hypot(vpin[0], vpin[1]) > c.vh) return false;
        if (tel.tilt > c.tilt) return false;
        if (M.vlen(this.w) > c.rate) return false;
        return true;
    }

    pointVelocity(out, bodyZ) {
        this.axis(this._axis);
        const rx = this._axis[0] * bodyZ, ry = this._axis[1] * bodyZ, rz = this._axis[2] * bodyZ;
        const wW = _wW;
        M.qrot(wW, this.q, this.w);
        out[0] = this.v[0] + (wW[1] * rz - wW[2] * ry);
        out[1] = this.v[1] + (wW[2] * rx - wW[0] * rz);
        out[2] = this.v[2] + (wW[0] * ry - wW[1] * rx);
        return out;
    }

    classifyTouchdown() {
        const ty = this.type, tel = this.tel, sc = this.sc;
        if (this.disabled) return this.disabled;
        const vb = this.pointVelocity(_vpin, 0);
        const vz = -vb[2], vh = Math.hypot(vb[0], vb[1]);
        const tilt = tel.tilt, rate = M.vlen(this.w);

        const gt = sc.groundTarget;
        const dg = Math.hypot(this.p[0] - gt.x, this.p[1] - gt.y);

        // A legged pad landing: only the Ship, only with the legs actually out,
        // only on the concrete, and only if it would stay standing.
        if (ty.hasLegs && gt.kind === "pad" && dg < gt.radius && this.act.legFrac > 0.95) {
            if (vz < 3.0 && vh < 2.0 && tilt < 6 * DEG && rate < 6 * DEG) return OUTCOME.LANDED;
        }
        // A soft divert: survivable arrival in the safe area. Uprightness still
        // matters (this is what "did not explode on tipping over" means) but the
        // tolerances are the ones a vehicle with no legs can actually meet.
        if (dg < gt.radius && vz < 4.0 && vh < 3.5 && tilt < 12 * DEG && rate < 10 * DEG) {
            return OUTCOME.SOFT_DIVERT;
        }
        return OUTCOME.CRASH;
    }

    /* Cut the controls and let physics finish the job. The vehicle keeps
     * flying — tumbling, out of control, engines dead — until it reaches the
     * ground or the clock. `disabled` is the outcome it will be reported as. */
    disable(outcome) {
        this.disabled = outcome;
        const a = this.act;
        a.stageCmd = 0;
        a.throttleCmd = 0;
        a.gimbalCmdX = 0; a.gimbalCmdY = 0;
        for (let i = 0; i < a.nFin; i++) a.finCmd[i] = 0;
        for (let i = 0; i < a.nFlap; i++) a.flapCmd[i] = this.type.flaps[i].minDefl;
    }

    terminate(outcome) {
        // A vehicle that lost control earlier is reported as having lost
        // control, whatever the ground eventually did to it.
        this.outcome = this.disabled || outcome;
        this.termState = this.snapshotTerminal();
    }

    snapshotTerminal() {
        const tel = this.tel, ty = this.type;
        const vpin = this.pointVelocity(_vpin, ty.catchPinZ);
        const vbase = this.pointVelocity(_vbase, 0);
        return {
            t: this.t,
            outcome: this.outcome,
            tilt: tel.tilt,
            rate: M.vlen(this.w),
            alt: tel.agl,
            gateDist: Math.hypot(tel.pinX - V.TOWER.gateX, tel.pinY - V.TOWER.gateY),
            gateDx: tel.pinX - V.TOWER.gateX,
            gateDy: tel.pinY - V.TOWER.gateY,
            gateDz: tel.pinZ - V.TOWER.armZ,
            groundDist: Math.hypot(this.p[0] - this.sc.groundTarget.x, this.p[1] - this.sc.groundTarget.y),
            vzPin: -vpin[2], vhPin: Math.hypot(vpin[0], vpin[1]),
            vzBase: -vbase[2], vhBase: Math.hypot(vbase[0], vbase[1]),
            prop: this.prop,
            commit: this.act.commit,
            catchAllowed: this.catchAllowed
        };
    }

    /* --------------------------------------------------- the phase ladder --
     *
     * A RIGID CURRICULUM OF SKILLS, not of scenarios. The stage curriculum
     * varies how hard the flight is; this varies WHAT IS BEING ASKED FOR, and
     * it exists because a weighted sum lets a policy opt out of the hard part.
     * Measured on the canonical reward: a champion that never reliably lit an
     * engine still collected uprightness, progress and penalty-avoidance to
     * within a few hundredths of a hand-written pilot, and sat at 0.42 for
     * thousands of generations. Ignition was optional because everything was
     * additive.
     *
     * EVERY RUNG IS A MULTIPLIER ON THE ONE BELOW IT. That is the whole design.
     * An additive ladder lets phase 3 be bought by giving back phase 1; a
     * multiplicative one cannot, because each factor is bounded in [0,1] and
     * losing an earlier skill scales everything after it. Same argument as the
     * attitude-times-speed gating that fixed the "paid a rock to be a rock"
     * bug, and the heading multiplier in the walker project.
     *
     * EACH FACTOR HAS A FLOOR (0.25 or 0.30, not 0). A hard gate would make the
     * next skill invisible until the previous one is perfect, which is the
     * credit-assignment cliff the curriculum is supposed to remove. The floor
     * means a brain that brakes well while still wobbling is rewarded for the
     * braking — just less than one that does both.
     *
     *   1 STABILITY   booster falls tail-first; Ship holds belly above 900 m
     *                 and comes upright below it. Rates bounded, no tumble.
     *   2 BRAKING     arrive at the ground at ~0 m/s. This is the rung that
     *                 makes ignition compulsory instead of optional.
     *   3 TARGETING   arrive slowly AND on the intended spot.
     *   4 CAPTURE     arrive inside the capture box — the actual catch.
     *   5 CONSOLIDATE the canonical reward, which is what the champion is
     *                 finally judged on and what the page replays.
     */
    phaseScores() {
        const s = this.termState || this.snapshotTerminal();
        const acc = this.acc, soft = M.soft;
        const isShip = this.type.key === "ship";

        /* --- 1. stability ------------------------------------------------- */
        const rq = soft(acc.maxRate, 25 * DEG);
        const up = acc.uprightDen > 0 ? acc.uprightNum / acc.uprightDen : 0;
        let att;
        if (isShip) {
            // the two accumulators are complementary at 900 m by construction:
            // belly only integrates above it, uprightness only below.
            const belly = acc.bellyDen > 0 ? acc.bellyNum / acc.bellyDen : 0;
            att = acc.bellyDen > 0 ? 0.5 * belly + 0.5 * up : up;
        } else {
            att = up;
        }
        let S = att * (0.55 + 0.45 * rq);
        // Losing the vehicle is not a small attitude error, and the discount is
        // multiplicative so it survives into every later rung.
        if (s.outcome === OUTCOME.TUMBLE || s.outcome === OUTCOME.BREAKUP) S *= 0.25;
        /* A TOWER STRIKE IS AN EARLY EXIT THAT BANKS A SPEED IT NEVER EARNED.
         * The braking rung reads the speed at the instant the episode ends, and
         * hitting the structure ends it 120 m up — so "fly into the tower
         * slowly" scores almost as well as descending to the ground slowly,
         * while skipping the hard half of the descent. Left alone the fleet
         * found it immediately: strike rates went to 24-30% within thirty
         * generations of reaching this rung. Same family as the bug where
         * terminating on failure paid the population to quit.
         *
         * The discount is 0.45 rather than the 0.25 a tumble gets, and that
         * gap is deliberate. A flat, heavy tower penalty is what once made
         * "always divert, never discover the catch" optimal, and rungs 3 and 4
         * need a population that is still willing to approach the tower. This
         * is enough to stop the exploit being free without making the tower
         * something to run away from. */
        if (s.outcome === OUTCOME.TOWER_STRIKE) S *= 0.45;

        /* --- 2. braking ---------------------------------------------------
         * ARRIVAL SPEED, AS ONE MAGNITUDE, AND NOT A BLEND WITH A TERM THAT
         * INACTION ALREADY WINS. The first version paid a quarter of this rung
         * for low HORIZONTAL speed, which a booster dropped straight down has
         * for free — and inert scored 0.411 here, beating the evolved champion
         * at 0.335. Anything that pays for not moving is paying a rock again.
         *
         * TWO SCALES, because the population starts fifteen scale-lengths out.
         * A single kernel at 6 m/s scores a 93 m/s arrival at 0.004 and a
         * 35 m/s one at 0.031 — the whole first half of the job, from "falls
         * like a stone" to "visibly braking", is worth 0.03 and is buried in
         * noise. That is the underflow bug this project already paid for once
         * with Gaussian kernels, in a gentler disguise. The coarse term pays
         * for getting the speed down at all; the fine one only a real landing
         * can move. */
        const speed = Math.hypot(s.vzBase, s.vhBase);
        const ex = Math.max(0, speed - 1.5);
        const B = 0.5 * soft(ex, 4.0, 1.6) + 0.5 * soft(ex, 35.0, 1.6);

        /* --- 3. targeting -------------------------------------------------- */
        const gt = this.sc.groundTarget;
        const wantsCatch = this.catchAllowed && s.commit > 0;
        /* THE SPOT A CATCH IS AIMED AT IS AT RAIL HEIGHT, so the miss is read
         * from the same rail-plane snapshot rung 4 uses and not from the
         * terminal state. Terminally, a vehicle going for a catch has usually
         * fallen a further hundred and twenty metres past the arms and drifted
         * while doing it, so the old reading was the gate miss plus several
         * seconds of unpowered translation — measurably worse as a target
         * signal, and pointing at a place the vehicle is not trying to reach. */
        const d = wantsCatch ? (acc.gate ? Math.hypot(acc.gate.dx, acc.gate.dy) : s.gateDist)
            : Math.max(0, s.groundDist - gt.radius * 0.4);
        const T = soft(d, 60);

        /* --- 4. capture ----------------------------------------------------
         *
         * TWO DEFECTS, BOTH FATAL, AND THEY MADE THIS RUNG A NO-OP.
         *
         * FIRST, IT WAS MEASURED IN THE WRONG PLACE. The factors came off the
         * terminal snapshot, which for every episode that is not a catch is
         * ground impact — see the note in accumulate(). Fixed by reading
         * `acc.gate`, the state at closest approach to the rail plane.
         *
         * SECOND, IT WAS A BARE PRODUCT OF FIVE KERNELS. Measured on the arm-P
         * champion over the held-out bank, the five factors sat at medians
         * 0.07 / 0.07 / 0.28 / 0.23 / 0.29 and their product was 2e-4. That is
         * not a small score, it is an ABSENT one: p4 = p3*(0.15 + 0.85*C)
         * collapses to p4 = 0.15*p3 exactly, so selection on the capture rung
         * was selection on the targeting rung at fifteen per cent amplitude, and
         * the 0.85*C that was supposed to carry the new skill contributed 1.7e-4
         * against a measured bank noise of 1.17 sd. Both small-genome arms sat
         * on this rung for hundreds of generations learning nothing new, and the
         * advance threshold of 0.22 needed p3 = 1.47 — above the maximum p3 can
         * take — so the ladder could never have left rung 4 at all. It was a
         * deadlock, not a plateau.
         *
         * The marginal-return table is what settles the shape of the fix: with
         * the other four held where they are, driving ANY single factor to
         * perfection moved mean C to at most 0.0036. No individual improvement
         * was visible, which is the definition of no gradient.
         *
         * So this becomes what the canonical `arrival` term already is, and for
         * the same reason spelled out there: A WEIGHTED MEAN over the margins,
         * so a population that is bad at all of them is paid for getting better
         * at any one, PLUS a product bonus that only pays when they are
         * simultaneously good, so the mean cannot be farmed by a brain that
         * nails its position and arrives at 30 m/s. The scales are the loose
         * ones from `arrival`, not the tight ones a finished catch would use,
         * because this rung has to be climbable from where the fleet actually
         * is. Being a rung of a multiplicative ladder is what stops it being
         * farmable: it is already gated by stability, braking and targeting.
         *
         * A vehicle that never came near the rails has no snapshot and scores
         * zero, which is correct and is not a cliff — p3 below it still pays. */
        const c = V.TOWER.capture;
        const g = acc.gate;
        let C = 0;
        if (g) {
            const missN = Math.hypot(g.dx / c.across, g.dy / c.along);
            const posQ = 0.6 * soft(missN, 4.0) + 0.4 * soft(Math.hypot(g.dx, g.dy), 40);
            const vzQ = soft(Math.max(0, g.vz - c.vz), 5.0);
            const vhQ = soft(g.vh, 3.0);
            const tiltQ = soft(g.tilt, 8 * DEG);
            const rateQ = soft(g.rate, 8 * DEG);
            const mean = 0.34 * posQ + 0.26 * vzQ + 0.14 * vhQ + 0.13 * tiltQ + 0.13 * rateQ;
            const prod = posQ * vzQ * vhQ * tiltQ * rateQ;
            /* HEIGHT GATES THE WHOLE RUNG RATHER THAN CONTRIBUTING TO IT.
             *
             * As a term in the mean it was a hover exploit: park three engines
             * lit four hundred metres directly over the rails and the snapshot
             * is taken there, collecting position, descent rate, lateral rate
             * and attitude in full — worth about 0.47 for never approaching the
             * tower at all, and reachable, because the booster CAN hover on the
             * three-engine rung even though it cannot on two. Every earlier
             * reward bug in this file has the same shape: a term that pays for a
             * state the vehicle can reach without doing the task. As a
             * multiplier it cannot be farmed, because none of the other margins
             * are worth anything until the pins are actually at rail height. */
            C = soft(Math.abs(g.dz), 40) * (0.55 * mean + 0.45 * prod);
        }
        if (s.outcome === OUTCOME.TOWER_STRIKE) C *= 0.3;

        /* THE FLOORS ARE SMALL ON PURPOSE. They exist so a brain that brakes
         * well while still wobbling is paid for the braking, but at 0.25 they
         * were large enough that a perfectly stable rock out-scored an evolved
         * brain arriving three times slower — the rung below was worth more
         * than the rung being trained. A tenth keeps the gradient without
         * letting the previous skill buy the current one. */
        const p1 = S;
        const p2 = S * (0.10 + 0.90 * B);
        const p3 = p2 * (0.15 + 0.85 * T);
        const p4 = p3 * (0.15 + 0.85 * C) + (s.outcome === OUTCOME.CAUGHT ? 1.0 : 0);
        return [p1, p2, p3, p4, 0];   // slot 4 filled with the canonical total
    }

    /* ------------------------------------------------------------ score --- */
    score() {
        const s = this.termState || this.snapshotTerminal();
        const acc = this.acc, ty = this.type, sc = this.sc;
        const parts = {};

        /* --- how well did it arrive? -------------------------------------
         *
         * EVERY TERM HERE IS HEAVY-TAILED, and that is the single most
         * important decision in this file. The first version used Gaussian
         * kernels with sensible-looking scales — 7 m/s on the touchdown speed,
         * 9 m on the gate miss — and produced a completely flat fitness curve
         * for a hundred and twenty generations. The reason is that a Gaussian
         * at seven times its scale is 1e-21 and at thirty times its scale is
         * 1e-390, which is to say: a booster arriving at 250 m/s and a booster
         * arriving at 40 m/s scored exactly the same, to the last bit. The
         * whole first half of the task — learning that there is such a thing as
         * a landing burn — was invisible to selection. Measured afterwards: a
         * correctly-flown hoverslam scored 0.33 and doing literally nothing
         * scored 0.19, so the entire reward for flying the vehicle properly was
         * 0.14, buried in noise several times its own size.
         *
         * With a power-law kernel the same comparison is 0.50 against 0.98.
         *
         * THE ATTITUDE MARGINS ARE GATED BY THE SPEED MARGIN, and that is the
         * second half of the same lesson. A Super Heavy falling tail-first is
         * passively stable: it stays within two degrees of vertical and barely
         * rotates, all the way to the ground, with its engines cold. Score
         * uprightness and body rate as free-standing terms and doing absolutely
         * NOTHING collects most of them — measured at 0.61, which was better
         * than the scripted autopilot and better than three quarters of a fresh
         * population. The reward was paying a rock to be a rock. Arriving
         * upright only means anything if you arrive slowly, so the attitude
         * block is multiplied by the speed quality.
         *
         * What survives is: a weighted mean over the graded margins, so that
         * improving any one of them pays — which is what a population that is
         * bad at all of them needs — plus a PRODUCT of all five, negligible
         * until they are simultaneously good, which stops the mean from being
         * farmed by a brain that nails its position and arrives at 90 m/s.
         */
        const goingForCatch = s.catchAllowed && s.commit > 0;
        const soft = M.soft;

        let arrival;
        if (goingForCatch || s.outcome === OUTCOME.CAUGHT || s.outcome === OUTCOME.MISSED_CATCH) {
            const c = V.TOWER.capture;
            // Two scales on the gate miss: a fine one that only a near-capture
            // can move, and a coarse one that pays for getting to the tower at
            // all. Without the coarse term a brain three hundred metres out has
            // no reason to prefer two hundred.
            // The fine term is measured in CAPTURE BOXES rather than metres, so
            // the gradient points along the shape the vehicle has to fit into.
            const missN = Math.hypot((s.gateDx || 0) / c.across, (s.gateDy || 0) / c.along);
            const posQ = 0.55 * soft(missN, 4.0) + 0.45 * soft(s.gateDist, 140);
            const dzQ = soft(Math.abs(s.gateDz), 90);
            const vzQ = soft(Math.max(0, s.vzPin - c.vz), 5.0);
            const vhQ = soft(s.vhPin, 4.0);
            const tiltQ = soft(s.tilt, 9 * DEG);
            const rateQ = soft(s.rate, 8 * DEG);
            const attQ = 0.34 * vhQ + 0.33 * tiltQ + 0.33 * rateQ;
            arrival = 0.26 * posQ + 0.08 * dzQ + 0.36 * vzQ + 0.30 * (vzQ * attQ);
            arrival += 0.55 * (posQ * vzQ * vhQ * tiltQ * rateQ);
        } else {
            const gt = sc.groundTarget;
            const scale = Math.max(70, gt.radius * 1.2);
            const posQ = soft(Math.max(0, s.groundDist - gt.radius * 0.4), scale);
            const vzQ = soft(Math.max(0, s.vzBase - 2.0), 5.0);
            const vhQ = soft(s.vhBase, 5.0);
            const tiltQ = soft(s.tilt, 12 * DEG);
            const rateQ = soft(s.rate, 10 * DEG);
            const attQ = 0.34 * vhQ + 0.33 * tiltQ + 0.33 * rateQ;
            arrival = 0.30 * posQ + 0.40 * vzQ + 0.30 * (vzQ * attQ);
            arrival += 0.55 * (posQ * vzQ * vhQ * tiltQ * rateQ);
        }
        parts.arrival = arrival;

        /* --- the shaping terms ------------------------------------------- */
        const upright = acc.uprightDen > 0 ? acc.uprightNum / acc.uprightDen : 0;
        parts.upright = 0.14 * upright;

        const corridor = acc.corridorDen > 0 ? acc.corridorPen / acc.corridorDen : 0;
        parts.corridor = -W_CORRIDOR * Math.min(1, corridor);

        /* Holding the tiled face into the airstream on the way down. Zero for a
         * booster, and zero for a Ship below its flip altitude, so it can never
         * be traded against the flip. */
        parts.belly = acc.bellyDen > 0 ? W_BELLY * (acc.bellyNum / acc.bellyDen) : 0;

        // Potential-based progress toward the target, on a log range so that
        // closing from 3 km to 300 m is worth the same as 300 m to 30 m.
        const d0 = Math.max(1, acc.startTargetDist), d1 = Math.max(1, acc.bestTargetDist);
        parts.progress = 0.18 * M.clamp(Math.log(d0 / d1) / Math.log(d0 / 12), -0.5, 1);

        const chat = acc.chatterN > 0 ? acc.chatter / acc.chatterN : 0;
        parts.chatter = -0.05 * Math.min(1, chat / 0.45);

        /* How well lined up was it at the instant it committed to the slot? See
         * accumulate(). A vehicle that never came level with the arms scores
         * zero here — the same as one that arrived hopelessly wide — so this
         * pays for approaching the tower well and never for staying away from
         * it, which is the trap the flat tower-strike penalty fell into. */
        const se = acc.slotEntry;
        parts.slot = se ? W_SLOT * (0.7 * soft(se.across / V.TOWER.capture.across, 6.0)
            + 0.3 * soft(se.along / V.TOWER.capture.along, 6.0)) : 0;

        /* --- the tiers ---------------------------------------------------- */
        let tier = 0;
        if (s.outcome === OUTCOME.CAUGHT) tier = 2.0;
        else if (s.outcome === OUTCOME.LANDED) tier = 1.4;
        else if (s.outcome === OUTCOME.SOFT_DIVERT) tier = 1.0;
        parts.tier = tier * W_TIER;

        // Propellant left over is only worth anything if the vehicle actually
        // arrived. Paying for economy on a crash is paying for not trying.
        if (tier > 0) parts.fuel = 0.12 * M.clamp(this.prop / Math.max(1, sc.prop), 0, 1);
        else parts.fuel = 0;

        /* --- the penalties ------------------------------------------------ */
        let pen = 0;
        /* A TOWER STRIKE IS PENALISED BY HOW HARD IT WAS, not by the fact of it.
         *
         * A flat penalty here is realistic — putting a booster through the
         * launch site is a catastrophe whatever the closing speed — and it makes
         * the task unlearnable. Measured on the held-out bank, four of six
         * stage-0 episodes ended as tower strikes for the SCRIPTED autopilot, so
         * for anything less precise than that the expected value of approaching
         * the tower at all is strongly negative, and the population's best
         * available move is to divert every time and never discover the catch.
         * There is no first step: a network cannot go from "misses by thirty
         * metres" to "caught" in one mutation, and everything in between is
         * priced identically to the worst possible outcome.
         *
         * Graded by impact speed, the same event becomes a gradient — brushing
         * the arms at 2 m/s costs 0.28, arriving at 70 m/s costs 1.15 — and
         * "hit it slowly" is the same skill as "be caught". The penalty at the
         * dangerous end is unchanged. */
        if (s.outcome === OUTCOME.TOWER_STRIKE) {
            const hit = Math.hypot(s.vzBase, s.vhBase);
            pen += W_STRIKE * (0.28 + 0.87 * M.clamp(hit / 40, 0, 1));
        }
        else if (s.outcome === OUTCOME.BREAKUP) pen += 0.75;
        else if (s.outcome === OUTCOME.TUMBLE) pen += 0.6;
        else if (s.outcome === OUTCOME.OUT_OF_BOUNDS) pen += 0.5;
        else if (s.outcome === OUTCOME.TIMEOUT) pen += 0.35;
        // Being near the tower without clearance is its own offence, whatever
        // happened afterwards.
        pen += 0.5 * Math.min(1, acc.rangeViolation / 3);
        // Structural margin: not a failure, but flying at the edge of it is not
        // free either.
        pen += 0.10 * Math.min(1, Math.max(0, acc.maxQAlpha / ty.qAlphaMax - 0.75) / 0.25);
        parts.penalty = -pen;

        let total = parts.arrival + parts.upright + parts.corridor + parts.progress
            + parts.chatter + parts.slot + parts.belly + parts.tier + parts.fuel + parts.penalty;

        return { total, parts, terminal: s, outcome: s.outcome };
    }

    /* --------------------------------------------------------- episode ---- */
    /* `policy(world, ctrlTick)` must fill `out` (length N_OUT) with values in
     * [-1,1]. Returning falsy leaves the previous command standing. */
    runEpisode(policy, opts) {
        opts = opts || {};
        const out = new Float64Array(N_OUT);
        const trace = opts.trace ? [] : null;
        let tick = 0;
        const maxSteps = Math.ceil(this.sc.tMax / DT_PHYS) + 4;
        for (let i = 0; i < maxSteps && this.outcome === OUTCOME.FLYING; i++) {
            if (i % CTRL_EVERY === 0) {
                policy(this, out, tick);
                this.applyControl(out);
                if (trace && tick % (opts.traceEvery || 1) === 0) trace.push(this.snapshotFrame());
                tick++;
            }
            this.step(DT_PHYS);
        }
        if (this.outcome === OUTCOME.FLYING) this.terminate(OUTCOME.TIMEOUT);
        if (trace) trace.push(this.snapshotFrame());
        const sc = this.score();
        sc.trace = trace;
        sc.ticks = tick;
        /* The whole ladder is computed every episode, not just the rung being
         * trained. It costs a handful of soft() calls and it is what lets the
         * trainer print where the fleet actually is — a run that is on rung 2
         * and quietly already passing rung 3 should advance, and one whose
         * rung-1 score is collapsing while rung-2 climbs is trading away a
         * skill and needs to be seen doing it. */
        sc.phases = this.phaseScores();
        sc.phases[4] = sc.total;
        return sc;
    }

    snapshotFrame() {
        return {
            t: this.t,
            p: [this.p[0], this.p[1], this.p[2]],
            q: [this.q[0], this.q[1], this.q[2], this.q[3]],
            v: [this.v[0], this.v[1], this.v[2]],
            w: [this.w[0], this.w[1], this.w[2]],
            fin: Array.from(this.act.fin.slice(0, this.act.nFin)),
            flap: Array.from(this.act.flap.slice(0, this.act.nFlap)),
            thr: this.act.throttle,
            eng: this.act.liveEngines(),
            gx: this.act.gimbalX, gy: this.act.gimbalY,
            leg: this.act.legFrac,
            prop: this.prop,
            tilt: this.tel.tilt,
            mach: this.tel.mach,
            q_: this.tel.q,
            commit: this.act.commit,
            catchOk: this.catchAllowed
        };
    }
}

const UNIT_Z = new Float64Array([0, 0, 1]);
const UNIT_X = new Float64Array([1, 0, 0]);   /* body +X is the tiled face */
const _vpin = new Float64Array(3);
const _vgate = new Float64Array(3);
const _vbase = new Float64Array(3);
const _wW = new Float64Array(3);
const _sf = new Float64Array(3);
const _rdot = new Float64Array(3);

if (typeof module !== "undefined") {
    module.exports = { World, OUTCOME, OUTCOME_NAME, DT_PHYS, DT_CTRL, CTRL_EVERY, N_OUT };
} else {
    window.WorldMod = { World, OUTCOME, OUTCOME_NAME, DT_PHYS, DT_CTRL, CTRL_EVERY, N_OUT };
}

})();
