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
/* sensors.js — what the network is allowed to know, and what it has to remember.
 *
 * THREE BLOCKS, and the second one is the interesting one.
 *
 * 1. INSTANTANEOUS. Attitude, rates, air-relative velocity in the body frame, a
 *    three-axis accelerometer, dynamic pressure, the vectors to the tower gate
 *    and to the ground target, the state of every actuator, the propellant, and
 *    the flags that say which vehicle this is and whether a catch is cleared.
 *    Notably absent: the wind. Nothing on a real vehicle measures the wind. It
 *    is felt through the accelerometer and through the mismatch between where
 *    the vehicle is pointing and where it is going, and working that out is part
 *    of the job.
 *
 * 2. THE TEMPORAL WINDOW, AS DIFFERENCES. Fourteen channels are tapped at eight
 *    lags spanning 50 ms to 3 seconds — and what is fed in is x(t) − x(t−k), not
 *    x(t−k). This is not a stylistic preference, it is a correction of a mistake
 *    made in the walker project in this same collection: a raw lagged sample of
 *    a slowly-varying channel is very nearly a copy of the current sample, so
 *    eight raw taps of altitude buy roughly one input's worth of information and
 *    cost eight. Differencing removes the common part and leaves exactly what
 *    the lag adds. It is also what the vehicle actually needs — the difference
 *    between the sink rate now and the sink rate two seconds ago IS the thing
 *    that tells a network whether its landing burn is working, and there is no
 *    way to compute it from a single frame.
 *
 *    Three seconds is not an arbitrary depth. It is about one full flip, about
 *    the time constant of a gust passing over a 70 m vehicle, and comfortably
 *    longer than the 450 ms it takes a Raptor to come up — so the network can
 *    see, in one observation, that it commanded ignition and nothing has
 *    happened yet.
 *
 * 3. ACTION HISTORY. The last command in full, plus how much it has changed over
 *    the last quarter second. Actuator positions are already in block 1, so this
 *    is not redundant with them: it is the difference between what was ASKED FOR
 *    and what the hardware has managed, which is how a controller discovers that
 *    its fins are rate-limited.
 */
"use strict";

const M = (typeof require !== "undefined") ? require("./mathx.js") : window.MathX;
const V = (typeof require !== "undefined") ? require("./vehicle.js") : window.Vehicle;

/* Lags in control ticks. At 20 Hz the default reaches 3.0 s.
 *
 * OVERRIDABLE, because the temporal block is 112 of the 209 inputs and the
 * input layer is most of the genome. Trimming to three lags takes the network
 * from 40,234 weights to 12,570 at the same hidden width, which is the only way
 * to get a direct-encoded genome down to the size the literature says a GA can
 * actually search. Set ROCKET_LAGS="2,10,35" to do it. Unset, nothing changes:
 * the default list is exactly what it always was, so every archived champion
 * still loads.
 *
 * RING must stay larger than the deepest lag.
 *
 * THE LAG SET IS PER-SENSOR, NOT PER-PROCESS. It began as a module constant
 * driven by an environment variable, which is fine for a trainer where every
 * worker in the run agrees — and wrong everywhere else. The browser has to
 * replay champions from SEVERAL runs at once, and a 139-input genome and a
 * 209-input genome need different observation vectors built from the same
 * world. With one module-wide list, `autosync` simply refused every champion
 * whose input count did not match the process it happened to be running in, so
 * the two BEST arms were silently absent from the page for hours while the two
 * worst were published. The module list is still the default; a Sensors may be
 * constructed with its own. */
const LAGS = (() => {
    const e = (typeof process !== "undefined" && process.env && process.env.ROCKET_LAGS) || "";
    if (!e) return [1, 2, 3, 5, 10, 20, 35, 60];
    const v = e.split(",").map(Number).filter(x => x > 0 && x < 64).sort((a, b) => a - b);
    if (!v.length) throw new Error("ROCKET_LAGS parsed to nothing: " + e);
    return v;
})();
const NCHAN = 14;
const RING = 64;
const N_ACT_OUT = 10;

/* THE PROPELLANT MARGIN IS OPT-IN, AND IT LOST ITS OWN A/B.
 *
 * Two DAgger runs, identical rounds, episodes, architecture and seeds, differing
 * only in whether this channel is present:
 *
 *     209 inputs (without)   rounds caught 0,0,0,0,0,1,1,8   best 8/200
 *     210 inputs (with)      rounds caught 0,0,0,0,0,0,0,1   best 1/200
 *
 * The reasoning for adding it was sound and the measurement says no anyway: on a
 * 17,000-weight network an extra input is an extra thing to learn, and the three
 * propellant channels already present apparently carry enough. Kept behind a
 * flag rather than deleted, because the finding it came from is real — the
 * teacher and the reference run dry on 39-44% of their failures while the
 * evolved brains die with a quarter tank — so this may be worth revisiting once
 * a policy is good enough for propellant to be its binding constraint.
 *
 * ROCKET_MARGIN=1 turns it on and takes the observation to 210 inputs, which no
 * existing genome can be flown with. */
const MARGIN = (typeof process !== "undefined" && process.env && process.env.ROCKET_MARGIN === "1");
const N_INSTANT = MARGIN ? 78 : 77;
const N_TEMPORAL = NCHAN * LAGS.length;          // 112
const N_ACTION = N_ACT_OUT * 2;                  // 20
const N_INPUT = N_INSTANT + N_TEMPORAL + N_ACTION;   // 209, or 210 with ROCKET_MARGIN

/* How many inputs a given lag set produces. The inverse is what identifies a
 * champion's observation layout from its genome alone. */
function inputCountFor(lags) { return N_INSTANT + NCHAN * lags.length + N_ACTION; }

/* Parse a lag list from a string, with the same validation the env var gets. */
function parseLags(str) {
    const v = String(str).split(",").map(Number).filter(x => x > 0 && x < RING);
    if (!v.length) throw new Error("lag list parsed to nothing: " + str);
    return v.sort((a, b) => a - b);
}

class Sensors {
    constructor(lags) {
        this.lags = (lags && lags.length) ? lags.slice().sort((a, b) => a - b) : LAGS;
        this.nInput = inputCountFor(this.lags);
        this.x = new Float32Array(this.nInput);
        this.ring = new Float32Array(NCHAN * RING);
        this.head = 0;
        this.filled = 0;
        this.chan = new Float64Array(NCHAN);
        this.lastAct = new Float64Array(N_ACT_OUT);
        this.actRing = new Float64Array(N_ACT_OUT * 16);
        this.actHead = 0;
        this.tick = 0;
    }

    reset() {
        this.ring.fill(0);
        this.head = 0; this.filled = 0; this.tick = 0;
        this.lastAct.fill(0);
        this.actRing.fill(0);
        this.actHead = 0;
    }

    /* Called once per control tick, before the network runs. */
    observe(world) {
        const x = this.x, tel = world.tel, ty = world.type, act = world.act, sc = world.sc;
        let k = 0;
        const cl = M.clamp;

        /* ---------------------------------------------------- instantaneous */
        x[k++] = ty.key === "booster" ? 1 : -1;
        x[k++] = ty.key === "ship" ? 1 : -1;

        const h = Math.max(0, tel.agl);
        x[k++] = cl(h / 3000, 0, 4);
        x[k++] = cl(h / 300, 0, 4);
        x[k++] = Math.exp(-h / 120);
        x[k++] = cl(Math.log10(1 + h) / 4, 0, 1.5);

        x[k++] = cl((tel.pinZ - V.TOWER.armZ) / 200, -4, 4);

        x[k++] = cl(world.v[2] / 100, -4, 4);
        x[k++] = cl(world.v[2] / 15, -4, 4);
        x[k++] = cl(world.v[0] / 60, -4, 4);
        x[k++] = cl(world.v[1] / 60, -4, 4);

        x[k++] = cl(tel.vB[0] / 80, -4, 4);
        x[k++] = cl(tel.vB[1] / 80, -4, 4);
        x[k++] = cl(tel.vB[2] / 150, -4, 4);
        x[k++] = cl(tel.vrel / 200, 0, 4);
        x[k++] = cl(tel.mach / 2.5, 0, 4);

        x[k++] = Math.sin(tel.alpha);
        x[k++] = Math.cos(tel.alpha);

        world.axis(_ax);
        x[k++] = _ax[0];
        x[k++] = _ax[1];
        x[k++] = _ax[2];
        x[k++] = Math.cos(tel.tilt);
        x[k++] = Math.sin(tel.tilt);

        // Which way the vehicle is leaning, expressed against the horizontal
        // direction it is travelling — the cheapest description of "am I
        // pointing where I am going".
        const vh = Math.hypot(world.v[0], world.v[1]);
        if (vh > 0.5) {
            x[k++] = (_ax[0] * world.v[0] + _ax[1] * world.v[1]) / vh;
            x[k++] = (_ax[0] * world.v[1] - _ax[1] * world.v[0]) / vh;
        } else { x[k++] = 0; x[k++] = 0; }

        x[k++] = cl(world.w[0] / 0.5, -4, 4);
        x[k++] = cl(world.w[1] / 0.5, -4, 4);
        x[k++] = cl(world.w[2] / 0.5, -4, 4);

        x[k++] = cl(tel.accB[0] / 20, -4, 4);
        x[k++] = cl(tel.accB[1] / 20, -4, 4);
        x[k++] = cl(tel.accB[2] / 40, -4, 4);
        x[k++] = cl(tel.gLoad / 4, 0, 4);

        x[k++] = cl(tel.q / 50000, 0, 4);
        x[k++] = cl(tel.qAlpha / ty.qAlphaMax, 0, 4);

        /* Vectors to the two possible destinations, each at two scales so that
         * "three kilometres out" and "two metres out" are both readable. The
         * tower offsets are given in the horizontal frame AND rotated into the
         * vehicle's own heading, because a controller that must translate
         * sideways cares which of its fins is pointing at the tower. */
        const tx = tel.toTowerX, tyv = tel.toTowerY;
        x[k++] = cl(tx / 1000, -4, 4);
        x[k++] = cl(tyv / 1000, -4, 4);
        x[k++] = cl(tx / 30, -4, 4);
        x[k++] = cl(tyv / 30, -4, 4);
        x[k++] = cl(tel.toTowerZ / 200, -4, 4);
        const dTow = Math.hypot(tx, tyv);
        x[k++] = cl(Math.log10(1 + dTow) / 3.5, 0, 2);
        M.qrotInv(_bv, world.q, M.vset(_wv, tx, tyv, 0));
        x[k++] = cl(_bv[0] / 60, -4, 4);
        x[k++] = cl(_bv[1] / 60, -4, 4);

        /* THE ENDGAME SCALE, IN CAPTURE BOXES.
         *
         * Everything above this is written for a vehicle three kilometres out,
         * and the finest of those scales is thirty metres. The capture box is
         * 0.9 m across. So the entire difference between being caught and
         * missing occupies 0.03 of one input, and the difference between 0.8 m
         * and 1.0 m — between success and failure — is 0.007 of it, which is
         * below what mutation can steer by. The scoring function was already
         * fixed to measure the gate miss in capture boxes rather than metres;
         * this is the same correction applied to the observation. One unit of
         * input is now one capture box. */
        const cap = V.TOWER.capture;
        x[k++] = cl((V.TOWER.gateX - tel.pinX) / cap.across, -4, 4);
        x[k++] = cl((V.TOWER.gateY - tel.pinY) / cap.along, -4, 4);
        x[k++] = cl(tel.toTowerZ / 10, -4, 4);

        /* ...AND THE VELOCITY THAT IS ACTUALLY BEING SCORED. isCaught() tests
         * the velocity of the PIN, sixty-one metres up the body, and every
         * velocity above is the velocity of the engine plane. Those are not the
         * same number: at the 3.5°/s body-rate tolerance the pin is sweeping
         * sideways at 3.7 m/s while the structure underneath it is stationary,
         * against a lateral capture tolerance of 1.5 m/s. (Which also means the
         * stated rate tolerance never binds — the lateral one does, at an
         * effective 1.4°/s.) It is recoverable from the body rates and the axis
         * as a product of two inputs, but asking a network to discover a product
         * in order to see the quantity it is graded on is not a fair fight. */
        world.pointVelocity(_pv, ty.catchPinZ);
        x[k++] = cl(_pv[0] / cap.vh, -4, 4);
        x[k++] = cl(_pv[1] / cap.vh, -4, 4);
        x[k++] = cl(-_pv[2] / cap.vz, -4, 4);
        x[k++] = cl(Math.hypot(_pv[0], _pv[1]) / cap.vh, 0, 4);

        /* ROLL, WHICH NOTHING ELSE IN THIS VECTOR CARRIES.
         *
         * The body axis gives tilt and the direction of tilt, but says nothing
         * about rotation ABOUT that axis. The only channel that carried any of
         * it was the tower offset resolved into the body frame, two lines up —
         * and that goes to zero exactly where roll starts to matter, because a
         * vehicle sitting over the gate has no offset to resolve. Roll is not a
         * free variable here: the grid fins sit at 90/180/270 with nothing on
         * the fourth side, so which way the vehicle is facing decides what its
         * own controls do, and a slow roll during a sixty-second descent is
         * something a feed-forward net with a three-second window cannot
         * integrate its way out of. World +X resolved into the body frame is the
         * (cos, sin) pair of that angle — which is what an IMU hands you. */
        M.qrotInv(_bv, world.q, M.vset(_wv, 1, 0, 0));
        x[k++] = _bv[0];
        x[k++] = _bv[1];

        const gx = tel.toGroundX, gy = tel.toGroundY;
        x[k++] = cl(gx / 1500, -4, 4);
        x[k++] = cl(gy / 1500, -4, 4);
        x[k++] = cl(gx / 60, -4, 4);
        x[k++] = cl(gy / 60, -4, 4);
        x[k++] = cl(Math.log10(1 + Math.hypot(gx, gy)) / 3.5, 0, 2);
        x[k++] = sc.groundTarget.kind === "pad" ? 1 : -1;

        /* propellant and what it is worth */
        const propFrac = sc.prop > 0 ? world.prop / sc.prop : 0;
        x[k++] = cl(propFrac, 0, 1);
        const mNow = world.mp.m;
        const dv = world.prop > 1 ? 330 * 9.80665 * Math.log(mNow / (mNow - world.prop)) : 0;
        x[k++] = cl(dv / 250, 0, 4);
        x[k++] = cl(world.mp.m / (ty.dryMass + ty.propMax), 0, 2);
        /* AND WHAT IT IS WORTH AGAINST WHAT IS STILL OWED.
         *
         * The three channels above say how much propellant is left, what its
         * delta-v is, and how heavy the vehicle is. None of them says whether
         * that is ENOUGH, and "enough" is the decision: whether there is room to
         * hold off the descent and line up across the arms, or whether the
         * vehicle has to commit now. Measured (vtest/fuelbind.js, stages 0-1),
         * this is not a hypothetical constraint — it binds exactly for the
         * policies that are good enough to reach the tower:
         *
         *     arm X (best evolved)   ran dry on 19% of failures, 25% left in the rest
         *     arm W                             0%              53%
         *     scripted reference               44%              16%
         *     DAgger teacher                   39%              18%
         *
         * The evolved brains die with a quarter to half a tank, for control
         * reasons. The good controllers die empty. So a policy only discovers
         * this constraint after it has solved everything else, which is the
         * worst possible order to learn something in.
         *
         * The requirement is the same lower bound budget.js scores stages with —
         * kill the descent, pay gravity for the length of the burn, null the
         * ground track — computed from quantities the vehicle already knows. */
        if (MARGIN) {
            const aNetMax = Math.max(0.5,
                (ty.engineLadder[ty.engineLadder.length - 1] * V.RAPTOR.thrust) / mNow - 9.80665);
            const vDown = Math.max(0, -world.v[2]);
            const dvNeed = vDown + 9.80665 * (vDown / aNetMax) + Math.hypot(world.v[0], world.v[1]);
            x[k++] = cl((dv - dvNeed) / 250, -4, 4);
        }

        /* actuators */
        x[k++] = act.throttle * 2 - 1;
        x[k++] = act.liveEngines() / 13;
        x[k++] = act.stage / Math.max(1, ty.engineLadder.length - 1) * 2 - 1;
        x[k++] = act.gimbalX / ty.engines[0].gimbal;
        x[k++] = act.gimbalY / ty.engines[0].gimbal;
        for (let i = 0; i < 4; i++) {
            if (i < ty.fins.length) x[k++] = act.fin[i] / ty.fins[i].maxDefl;
            else if (i < ty.flaps.length) x[k++] = (act.flap[i] - ty.flaps[i].minDefl) / (ty.flaps[i].maxDefl - ty.flaps[i].minDefl) * 2 - 1;
            else x[k++] = 0;
        }
        x[k++] = ty.hasLegs ? (act.legFrac * 2 - 1) : -1;
        x[k++] = ty.hasLegs ? 1 : -1;

        /* mission flags and clocks */
        x[k++] = world.catchAllowed ? 1 : -1;
        x[k++] = cl(act.commit, -1, 1);
        x[k++] = cl(world.t / 60, 0, 4);
        const sink = Math.max(0.5, -world.v[2]);
        x[k++] = cl(h / sink / 20, 0, 4);
        x[k++] = cl(act.thrust() / (mNow * 9.80665) / 2, 0, 3);
        x[k++] = act.everLit ? 1 : -1;

        if (k !== N_INSTANT) throw new Error("sensors: instantaneous block is " + k + ", expected " + N_INSTANT);

        /* -------------------------------------------------------- temporal */
        const c = this.chan;
        c[0] = Math.cos(tel.tilt);
        c[1] = _ax[0];
        c[2] = _ax[1];
        c[3] = world.w[0];
        c[4] = world.w[1];
        c[5] = world.w[2];
        c[6] = world.v[2] / 100;
        c[7] = tel.vB[0] / 100;
        c[8] = tel.vB[1] / 100;
        c[9] = h / 1000;
        c[10] = tel.accB[0] / 20;
        c[11] = tel.accB[1] / 20;
        c[12] = tel.accB[2] / 40;
        c[13] = tel.q / 50000;

        // Prime the ring on the first tick so that every difference is exactly
        // zero rather than a step against a zero-filled history.
        if (this.filled === 0) {
            for (let s = 0; s < RING; s++) for (let ch = 0; ch < NCHAN; ch++) this.ring[s * NCHAN + ch] = c[ch];
            this.filled = RING;
        }
        this.head = (this.head + 1) % RING;
        const base = this.head * NCHAN;
        for (let ch = 0; ch < NCHAN; ch++) this.ring[base + ch] = c[ch];

        const myLags = this.lags;
        for (let li = 0; li < myLags.length; li++) {
            const lag = myLags[li];
            const idx = ((this.head - lag) % RING + RING) % RING;
            const off = idx * NCHAN;
            // Balance the lags: a 60-tick difference is naturally ~8x a 1-tick
            // one on a smooth channel, and without this the short lags land in
            // the numerical basement where mutation cannot reach them.
            const g = 3.0 / Math.sqrt(lag);
            for (let ch = 0; ch < NCHAN; ch++) {
                x[k++] = cl((c[ch] - this.ring[off + ch]) * g, -4, 4);
            }
        }

        /* -------------------------------------------------------- actions  */
        const ah = this.actHead;
        for (let i = 0; i < N_ACT_OUT; i++) x[k++] = this.actRing[ah * N_ACT_OUT + i];
        const old = ((ah - 5) % 16 + 16) % 16;
        for (let i = 0; i < N_ACT_OUT; i++) {
            x[k++] = cl((this.actRing[ah * N_ACT_OUT + i] - this.actRing[old * N_ACT_OUT + i]) * 1.5, -4, 4);
        }

        this.tick++;
        return x;
    }

    /* Called after the network produces its command. */
    recordAction(out) {
        this.actHead = (this.actHead + 1) % 16;
        const b = this.actHead * N_ACT_OUT;
        for (let i = 0; i < N_ACT_OUT; i++) this.actRing[b + i] = out[i];
    }
}

const _ax = new Float64Array(3);
const _bv = new Float64Array(3);
const _wv = new Float64Array(3);
const _pv = new Float64Array(3);

if (typeof module !== "undefined") {
    module.exports = { Sensors, N_INPUT, N_INSTANT, N_TEMPORAL, N_ACTION, LAGS, NCHAN, inputCountFor, parseLags };
} else {
    window.SensorsMod = { Sensors, N_INPUT, N_INSTANT, N_TEMPORAL, N_ACTION, LAGS, NCHAN, inputCountFor, parseLags };
}

})();
