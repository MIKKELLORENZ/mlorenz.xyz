/* golden_test.js — CAN A HAND-WRITTEN CONTROLLER BE CAUGHT IN THIS SIMULATION?
 *
 * This is a diagnostic, not part of the search. Nothing in this file is ever
 * loaded by train.js, evolution.js or the page, and the evolved policy neither
 * sees it nor inherits anything from it. It exists to answer the one question
 * that has to be answered before any amount of "the GA is slow" is worth
 * investigating:
 *
 *     Does the ENVIRONMENT admit a catch at all?
 *
 * If a straightforward cascaded PD pilot cannot be caught, then no population
 * ever will be, and the thing to fix is the geometry, the tolerances or the
 * clock — not the mutation rate. `autopilot.js` is the browser comparison and
 * is deliberately asserted on nothing; it currently catches on no stage, which
 * is exactly why this file had to exist separately: an autopilot that fails
 * proves nothing about the environment, only about the autopilot.
 *
 * WHAT THE PILOT DOES, and why it is shaped this way rather than as a hoverslam.
 *
 * 1. A CONTROLLED DESCENT, NOT A SUICIDE BURN. The obvious pilot — the one in
 *    test_headless.js — brakes as late as the hardware allows and arrives dead
 *    on height at 1.5 m/s. Measured over forty stage-0 episodes it also arrives
 *    a hundred and fifty metres off across the arms, because a stage-0 suicide
 *    burn is about four seconds long and four seconds is not enough powered
 *    flight to fly out sixty metres of lateral error. The vehicle can go back UP
 *    the engine ladder at the cost of an ignition credit, so lighting the small
 *    group early and tracking a sink-rate schedule is legal, costs propellant,
 *    and buys the seconds the lateral loop needs.
 *
 * 2. THE SLOT IS ENTERED FROM ABOVE. The arms are solid steel from |x| = 8 m
 *    outward (rails at 12.5 m, hull radius 4.5 m), and some part of a 72 m
 *    booster is level with the arm plane for the last 77 m of its descent. So a
 *    vehicle that translates in WHILE it sinks drags its flank through a rail:
 *    with the vertical loop alone tuned to its optimum the strike rate is 42%,
 *    and it goes UP as the lateral loop is damped, because a gentler approach
 *    spends longer inside the annulus. Aligning across the arms first and
 *    descending second is not a stylistic choice, it is the shape of the
 *    obstacle. This is the manoeuvre the network has to discover.
 *
 * Everything else is textbook: a lateral position/velocity PD produces an
 * acceleration command, that plus the vertical command is a required specific
 * force, its direction is the attitude command, and a gimbal loop tracks it.
 */
;(function () {
"use strict";

/* Dual-mode, like every other module here: Node require under the trainer, the
 * shared window namespace under a file:// page. The page needs this file because
 * the browser's "Scripted" option must fly the SAME control law the reference
 * does — see the note on autopilot.js below. */
const NODE = (typeof require !== "undefined");
const M = NODE ? require("./mathx.js") : window.MathX;
const V = NODE ? require("./vehicle.js") : window.Vehicle;
const WM = NODE ? require("./world.js") : window.WorldMod;
const SC = NODE ? require("./scenarios.js") : window.Scenarios;
const ATM = NODE ? require("./atmosphere.js") : window.Atmosphere;
const DEG = Math.PI / 180;
const G = V.G0;

/* Gains. Found by grid search, and the two that are load-bearing are marked.
 * The attitude loop is slow because it has to be: full gimbal on three engines
 * at the throttle floor is about 0.17 rad/s² on a 1e8 kg·m² rod, so an attitude
 * time constant under two seconds is not available, and a position loop faster
 * than the attitude loop it commands simply oscillates into the arms. */
/* RE-TUNED after the structural fixes below, on seeds the report bank never
 * sees (base 500000; golden_test reports on 90000, the trainer examines at 2e9).
 * 300 random gain sets, 20 episodes a stage, then the top four re-flown on the
 * report bank — because a leaderboard read off its own tuning seeds is the same
 * mistake as crowning a champion on the bank it was bred against.
 *
 * Held out, against the previous gains: stage-0 catches 50% -> 55%, and vehicles
 * LOST fell from 8% to 0% on stage 0, 25% to 0% on stage 1, and 58% to 10% on
 * stage 3. It gives up 0.19 of canonical mean score doing it, which is the right
 * trade for a reference whose job is to prove the task is doable and to set the
 * bar honestly.
 *
 * Note what moved: the lateral loop got roughly four times its authority
 * (aLatMax 3.0 -> 7.5) with less than half the damping (kdPos 0.45 -> 0.19),
 * which is the opposite of the note that used to sit on this line claiming
 * kdPos 0.7 doubled the strike rate. That was measured before the slot hold had
 * a deadline and before ignition respected the throttle floor — with the
 * vehicle no longer hovering in the annulus waiting to line up, spending less
 * time there is worth more than approaching it gently. */
const GAINS = {
    kpPos: 0.0425, kdPos: 0.1899,
    aLatMax: 7.50,
    kpAtt: 0.3485, kdAtt: 0.8411,
    slope: 0.0744,                 // LOAD-BEARING: sink rate as a fraction of height to go
    kvz: 0.4876,
    slotX: 6.59, slotH: 47.8,      // hold altitude below slotH until |across| < slotX
    vTouch: 0.559,
    /* THE STRUCTURAL ENVELOPE. Added after the limits were tightened on the
     * strength of the validation report — qAlphaMax 2.6e5 -> 2.25e4 and qMax
     * 1.4e5 -> 6.5e4 — which is an order of magnitude on one of them. The gains
     * above were grid-searched under the OLD limits, and a controller that was
     * legal then is not legal now without a line of it changing: measured, the
     * pilot broke up on 73% of stage-2 entries and 78% of stage-3, with peak q
     * over the limit on 30 of 40 stage-3 flights and peak q·alpha over on 20 of
     * 40 stage-2 flights. It was flying a structurally illegal trajectory and
     * the reference had gone stale exactly where the report said it would.
     *
     * Both margins are fractions of the vehicle's own limits rather than
     * absolute speeds or angles, so they follow vehicle.js if it changes again
     * instead of silently going stale a second time. */
    qMargin: 0.739,                // fly to 74% of qMax
    qLook: 7.45,                   // seconds of lookahead on the density ahead
    qaMargin: 0.711,               // and 71% of the q·alpha limit
    aoaMax: 9.7 * DEG,             // never point more than this off the airflow
    tMargin: 9,                    // seconds of slack kept for the final descent
    propReserve: 0.04,             // fraction of tankage kept back to fly it with

    /* ---- THE LAST FEW METRES ARE A DIFFERENT PROBLEM FROM THE DESCENT -----
     *
     * The arms judge SIX things at once, and this pilot was arriving with five
     * of them comfortably inside the box. Measured over 150 stage-0 episodes
     * (vtest/missdiag.js), on the 111 that missed:
     *
     *     across      limit 0.90 m     median 0.25     fails 15%   alone  1%
     *     along       limit 2.50 m     median 0.43     fails  5%   alone  0%
     *     horizontal  limit 1.50 m/s   median 0.20     fails  3%   alone  0%
     *     tilt        limit 3.50 deg   median 0.61     fails  7%   alone  0%
     *     descent     limit 2.50 m/s   median 5.06     fails 51%   alone 14%
     *     BODY RATE   limit 3.50 deg/s median 5.65     fails 84%   alone 43%
     *
     * It gets to the right place, upright and nearly stationary, and is still
     * TURNING when it arrives. Forty-three per cent of all misses fail on that
     * one term and nothing else, which makes it by far the largest single item
     * in the whole project — and it is invisible in the outcome name, because
     * every one of them is reported simply as "missed catch".
     *
     * The rate comes from the lateral loop. Close to the rails the position
     * error is small and the commanded tilt therefore swings quickly, so the
     * attitude loop is still slewing to follow it at the moment the pins cross
     * the plane. The fix is to stop asking: below `hCalm` the lateral command is
     * faded out and the attitude damping is multiplied up, so the vehicle stops
     * chasing the last half metre and arrives still. Fading rather than cutting
     * matters — a step change in the command is itself a rate.
     *
     * The descent term is the same story one step earlier: `vTouch` was 2.27
     * against a 2.50 limit, which is no margin at all for a schedule the vehicle
     * lags. It gets its own terminal gain instead of inheriting kvz. */
    hCalm: 22,                     // m above the rails to stop steering and start settling
    calmKd: 1.0,                   // attitude damping multiplier inside hCalm (1 = unchanged)
    calmLat: 1.0,                  // fraction of the lateral command surviving (1 = unchanged)
    kvzCalm: 0                     // descent gain inside hCalm (0 = inherit kvz)
};

function makePilot(K) {
    K = Object.assign({}, GAINS, K || {});
    const ax = new Float64Array(3), errW = new Float64Array(3), errB = new Float64Array(3);
    const _vw = new Float64Array(3);
    let lit = false, rung = 0, vCap = 0;

    return function (w, o) {
        o.fill(0);
        o[9] = 1;                                   // commit to the tower
        const ty = w.type, LAD = ty.engineLadder, T1 = V.RAPTOR.thrust;
        const m = w.mp.m, tel = w.tel;
        const aimZ = V.TOWER.armZ - ty.catchPinZ;   // engine plane with the pins on the rails
        const h = w.p[2] - aimZ, v = -w.v[2];
        if (vCap === 0) vCap = Math.max(5, v);
        const aHi = (k) => (LAD[k] * T1) / m - G;

        /* ---- vertical: track a sink-rate schedule down to the rails -------- */
        let vWant = Math.max(K.vTouch, Math.min(vCap, K.slope * h));
        /* THE ALIGNMENT HOLD NEEDS A DEADLINE, and not having one was the single
         * largest failure mode left: the pilot timed out on 43% of stage 0 and
         * 40% of stage 1 — more often on the easiest stage than it caught. It
         * stops descending until it is lined up across the arms, which is the
         * right manoeuvre (see the note above on the annulus), but with no
         * clock and no fuel gauge it will hover at 60 m above the rails until
         * either the episode expires or the tanks run dry and it falls.
         *
         * A missed catch is a better outcome than a timeout, and an honest one:
         * it is the vehicle arriving and being slightly wrong, rather than the
         * vehicle refusing to arrive. So the hold is abandoned when there is no
         * longer time to fly the descent, or no longer propellant to fly it
         * with. Both budgets are computed from the schedule the pilot is
         * already tracking rather than being tuned constants. */
        const tLeft = (w.sc.tMax || 60) - w.t;
        const tNeed = h / Math.max(1, K.slope * h) + K.tMargin;
        const propOK = w.prop > K.propReserve * (ty.propMax || 1);
        if (h < K.slotH && Math.abs(tel.pinX - V.TOWER.gateX) > K.slotX
            && tLeft > tNeed && propOK) vWant = 0;

        /* THE SCHEDULE IS CAPPED BY WHAT THE AIRFRAME WILL SURVIVE. A slope of
         * 0.08 asks for 480 m/s at six kilometres, and the atmosphere at six
         * kilometres will not allow it: that is 60 kPa of dynamic pressure
         * against a 65 kPa limit, so the pilot was commanding its own breakup.
         *
         * Air density is not measured directly, but it does not need to be —
         * the vehicle knows q and its own airspeed, and rho = 2q/v² falls out,
         * so the speed that would put it exactly on the limit is
         *
         *     v_limit = v · sqrt(qMax / q)
         *
         * from telemetry alone. That is the same air-data reconstruction a real
         * vehicle does, and it needs no atmosphere model in the controller. */
        /* AND IT HAS TO LOOK AHEAD, which the first version of this did not.
         * Capping against the density the vehicle is in right now is reactive,
         * and reactive is useless here: a descending booster's q rises even at
         * constant speed, so the cap does not bind until the limit is already
         * being reached, and a 3,000-tonne-second deceleration cannot be
         * produced in the second that is left. Measured, the reactive version
         * moved stage-2 breakups 73% -> 68% — inside the noise, which is what a
         * constraint that activates too late looks like.
         *
         * So the limit is evaluated at the altitude the vehicle will be at in
         * `qLook` seconds. A real booster does this from a stored atmosphere
         * table, which is what ATM is, and it is the reason entry burns exist:
         * free-fall terminal velocity near the ground is about 340 m/s, which is
         * roughly 71 kPa against a 65 kPa limit, so an unpowered descent is
         * structurally illegal by construction and no amount of gain tuning was
         * ever going to fix it. */
        const hAhead = Math.max(0, w.p[2] - Math.max(0, v) * K.qLook);
        const rhoAhead = ATM.airAt(hAhead).rho;
        if (rhoAhead > 1e-6) {
            vWant = Math.min(vWant, Math.sqrt(2 * K.qMargin * ty.qMax / rhoAhead));
        }
        /* Inside hCalm the descent is held HARDER, but toward whatever target
         * the schedule already chose. The first version of this also moved the
         * target, and that quietly broke the alignment hold: the hold works by
         * setting vWant = 0 to stop descending until the vehicle is lined up
         * across the arms, and raising it back toward a touchdown rate cancels
         * exactly that. Measured, it took the reference from 13% to 6.7% and
         * pushed the median descent at the rails from 5.1 m/s to 11.8. Gain,
         * not setpoint. */
        const calmV = M.clamp(1 - h / Math.max(1e-6, K.hCalm), 0, 1);
        const kvzEff = K.kvz + (vWant > 0 ? calmV * ((K.kvzCalm || K.kvz) - K.kvz) : 0);
        const aReq = kvzEff * (v - vWant);

        /* IGNITION IS PLANNED AGAINST THE THROTTLE FLOOR, NOT JUST THE CEILING.
         *
         * The old logic lit rung 1 on the first tick unconditionally and then
         * climbed the ladder until a group could deliver aReq. It never asked
         * the other question — whether that group can be throttled DOWN to
         * aReq — and a Raptor group has a 40% floor. Light three engines when
         * you needed one and the vehicle accelerates upward at the floor with
         * the throttle already commanded to its minimum; there is no control
         * input left that stops it.
         *
         * That is exactly what it did. Measured over 40 stage-0 episodes, 17 of
         * them timed out at a median altitude of 860 m — having started at 400 —
         * still climbing at 12 m/s with the tanks empty. The pilot was not
         * failing to land, it was flying away, and the reward called it a
         * timeout so it read as indecision rather than as a sign error in the
         * energy plan.
         *
         * So: stay cold until the deceleration actually required has grown past
         * the floor of the smallest group that could supply it. That is what
         * makes this a hoverslam and not a hover, and it is forced by the
         * hardware rather than chosen — the note at the top of this file about
         * arriving with seconds to spare is the same constraint seen from the
         * other end. */
        const aLo = (k) => (LAD[k] * T1 * V.RAPTOR.minThrottle) / m - G;
        let cand = LAD.length - 1;
        for (let k = 1; k < LAD.length; k++) if (aHi(k) * 0.92 >= aReq) { cand = k; break; }
        if (!lit) {
            if (aReq >= aLo(cand)) { lit = true; rung = cand; }
        } else {
            rung = Math.max(rung, cand);
            // shedding is free and is the only way to stop decelerating; step
            // down to the smallest group that still brackets the requirement.
            for (let k = 1; k < rung; k++) {
                if (aReq < aHi(k) * 0.85 && aReq >= aLo(k)) { rung = k; break; }
            }
        }

        /* ---- lateral: PD on the PIN, because that is what the arms measure - */
        let alx = K.kpPos * (V.TOWER.gateX - tel.pinX) - K.kdPos * w.v[0];
        let aly = K.kpPos * (V.TOWER.gateY - tel.pinY) - K.kdPos * w.v[1];
        const alm = Math.hypot(alx, aly);
        if (alm > K.aLatMax) { alx *= K.aLatMax / alm; aly *= K.aLatMax / alm; }

        /* ...and it is faded out over the last few metres. See hCalm above: the
         * commanded tilt is what drives body rate, and body rate alone was
         * failing 43% of the misses. `calm` runs 0 well above the rails to 1 at
         * them, so the fade is continuous — a step would be a rate of its own. */
        const calm = M.clamp(1 - h / Math.max(1e-6, K.hCalm), 0, 1);
        if (calm > 0) {
            const keep = 1 - calm * (1 - K.calmLat);
            alx *= keep; aly *= keep;
        }

        /* ---- the specific force wanted, and the attitude that delivers it -- */
        const az = G + Math.max(0, aReq);
        const nrm = Math.hypot(alx, aly, az);
        let nx = alx / nrm, ny = aly / nrm, nz = az / nrm;

        /* ---- and the attitude command is limited to the q·alpha envelope ---
         *
         * The lateral loop asks for a tilt, and a tilt in a dense airstream is
         * an angle of attack. q·alpha is a bending moment on a 72 m tube, and
         * exceeding it is a structural failure, not a control error — measured,
         * this is what destroyed 29 of 40 stage-2 flights at a median peak of
         * 28 kPa·rad against a 22.5 kPa·rad limit.
         *
         * So the commanded axis is clamped into a cone about the airflow whose
         * half-angle is whatever q·alpha currently allows. High and fast, that
         * cone is a couple of degrees and the vehicle simply flies retrograde,
         * which is what a real booster does on entry; low and slow, q falls
         * away, the cone opens past aoaMax and stops binding entirely, so none
         * of this touches the landing that was already working.
         *
         * Clamping rather than penalising matters: a soft penalty would trade
         * lateral error against structural margin, and structural margin is not
         * a currency — one exceedance ends the flight. */
        const aoaMax = tel.q > 100
            ? Math.min(K.aoaMax, (K.qaMargin * ty.qAlphaMax) / tel.q)
            : K.aoaMax;
        M.qrot(_vw, w.q, w._vb);                 // air-relative velocity, world frame
        const sp = Math.hypot(_vw[0], _vw[1], _vw[2]);
        if (sp > 20 && tel.q > 100) {
            // the body must point along -vrel for zero angle of attack
            const ux = -_vw[0] / sp, uy = -_vw[1] / sp, uz = -_vw[2] / sp;
            const ang = Math.acos(M.clamp(nx * ux + ny * uy + nz * uz, -1, 1));
            if (ang > aoaMax && ang > 1e-4) {
                // slerp the command toward the airflow until it sits on the cone
                const t = (ang - aoaMax) / ang, s = Math.sin(ang);
                const w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s;
                let cx = nx * w1 + ux * w2, cy = ny * w1 + uy * w2, cz = nz * w1 + uz * w2;
                const cn = Math.hypot(cx, cy, cz) || 1;
                nx = cx / cn; ny = cy / cn; nz = cz / cn;
            }
        }

        w.axis(ax);
        // axis × n is the rotation that carries the body axis onto the command
        errW[0] = ax[1] * nz - ax[2] * ny;
        errW[1] = ax[2] * nx - ax[0] * nz;
        errW[2] = ax[0] * ny - ax[1] * nx;
        M.qrotInv(errB, w.q, errW);

        const I = w.mp.Ixx;
        /* Damping is multiplied up on the same fade. The gimbal has authority to
         * spare down here — thrust is high and the vehicle is slow — so this
         * costs nothing that the descent needs. */
        const kd = K.kdAtt * (1 + calm * (K.calmKd - 1));
        const tauX = I * (K.kpAtt * errB[0] - kd * w.w[0]);
        const tauY = I * (K.kpAtt * errB[1] - kd * w.w[1]);

        if (lit) {
            o[1] = (rung + 0.5) / LAD.length * 2 - 1;
            o[0] = M.clamp(m * nrm / (LAD[rung] * T1), V.RAPTOR.minThrottle, 1) * 2 - 1;
        } else { o[0] = -1; o[1] = -1; }

        /* ---- gimbal. world.js applies m = r × F with r = (0,0,rz), giving
         *      mx = rz·T·sin(gx) and my = rz·T·sin(gy). rz is negative — the
         *      engines are below the centre of mass — and getting that sign
         *      wrong produces a controller that flies itself into the ground
         *      while looking perfectly reasonable in the log. */
        const T = w.act.thrust();
        if (T > 1e3) {
            const rz = ty.engines[0].z - w.mp.com;
            const gmax = ty.engines[0].gimbal;
            o[2] = M.clamp(Math.asin(M.clamp(tauX / (rz * T), -1, 1)) / gmax, -1, 1);
            o[3] = M.clamp(Math.asin(M.clamp(tauY / (rz * T), -1, 1)) / gmax, -1, 1);
        }
        return o;
    };
}


/* ---------------------------------------------------------------------------
 * makeReference — THE TWO-PHASE REFERENCE, AND THE ONE THE PAGE SHOULD FLY.
 *
 * makePilot above is a SETTLE: it tracks a sink-rate schedule v = slope*h from
 * wherever it starts. That was the whole problem when stage 0 was the last four
 * hundred metres, and it is the wrong shape now that stage 0 is a run-in from a
 * kilometre or more offshore — starting the schedule at four kilometres means
 * braking from four kilometres and paying gravity for every second of it.
 * Measured, it crashed 200 of 250 stage-0 episodes with the tank EMPTY, while
 * the ideal bound for the stage is 303 m/s against 532 m/s aboard.
 *
 * So the reference flies the energy first and hands over. The braking law is
 * exact for quadratic drag written as a terminal velocity vt (at v = vt drag
 * balances weight, so drag deceleration is g(v/vt)^2):
 *
 *     h_brake = (vt^2/2g) ln( 1 + g v^2 / (vt^2 (aT - g)) )
 *     aT      = g + g (v^2 - vHand^2) / ( vt^2 (exp(2 g h / vt^2) - 1) )
 *     t_burn  = vt/sqrt(g(aT-g)) * atan( v sqrt(g/(aT-g)) / vt )
 *
 * Evaluate aT every tick, stay cold while it asks for less than the engines can
 * give, light when the height left no longer covers the braking distance plus
 * the ignition dead time — a Raptor takes 450 ms to make thrust and at 250 m/s
 * that is 175 m of altitude spent on nothing — then track it. The burn duration
 * is the time-to-go the lateral channel needs and had no honest source for
 * before, so the lateral law is zero-effort-miss on it rather than a PD with no
 * arrival condition.
 *
 * Below hHand the settle takes over, in the regime it was tuned for. The two
 * gain sets come from a joint 5,000-point search over both halves.
 */
const SLAM = {
    hHand: 553.77, vHand: 34.48, ignMargin: 0.58908,
    aLatFrac: 0.41205, zemK: 1.22395, aoaMax: 0.27411,
    qMargin: 0.5376, qLook: 15.94, kvz: 0.948,
    kpAtt: 0.688, kdAtt: 2.192,
    /* AND THE SETTLE HALF GETS ITS OWN GAINS, not GAINS above. The two were
     * searched together and only make sense together: what the settle is handed
     * is decided entirely by where and how fast the approach hands over, so the
     * old set - tuned when the settle flew the whole descent - is tuned for a
     * vehicle arriving in a different state. Left on the default this reference
     * caught 0 of 50 while the identical approach half feeding the SEARCHED
     * settle caught 23%. */
    settleGains: {
        kpPos: 0.1096728145970584, kdPos: 0.43553083666429665,
        aLatMax: 4.572466016688985,
        kpAtt: 0.6884705896605164, kdAtt: 2.1923224864623583,
        slope: 0.25667274210462127, kvz: 0.9479643751661255,
        slotX: 3.384833535614488, slotH: 54.003752944608024,
        vTouch: 2.270604287514732,
        qMargin: 0.5376359443296679, qLook: 15.944139850257958,
        qaMargin: 0.6619847263325938, aoaMax: 0.3864789326311356
    }
};

function makeReference(K) {
    K = Object.assign({}, SLAM, K || {});
    const ax = new Float64Array(3), errW = new Float64Array(3), errB = new Float64Array(3);
    const _vw2 = new Float64Array(3);
    let lit = false, rung = 0, settle = null;

    return function (w, o) {
        o.fill(0);
        o[9] = 1;
        const ty = w.type, LAD = ty.engineLadder, T1 = V.RAPTOR.thrust;
        const m = w.mp.m, tel = w.tel;
        const aimZ = V.TOWER.armZ - ty.catchPinZ;
        const hRail = w.p[2] - aimZ;
        const v = -w.v[2];
        const aMax = (LAD[LAD.length - 1] * T1) / m;

        /* The handover is one-way, and it needs the SPEED condition as well as
         * the height: a vehicle that is late on its braking is still doing 200
         * m/s at 350 m, and that is not a problem the settle has an answer to. */
        if (!settle && hRail < K.hHand && v < 110) settle = makePilot(K.settleGains);
        if (settle) return settle(w, o);

        const h = Math.max(0, hRail - K.hHand);
        const vt = Math.max(20, SC.equilibriumSink(ty, Math.max(0, w.p[2]), m));
        const L = 2 * G * h / (vt * vt);
        const den = Math.expm1(Math.min(40, L));
        const vv = Math.max(0, v * v - K.vHand * K.vHand);
        let aT = den > 1e-9 ? G + G * vv / (vt * vt * den) : aMax;

        /* The airframe puts a floor under the burn: an unpowered booster reaches
         * about 340 m/s near the ground, which is over the 65 kPa limit, so the
         * unpowered descent is structurally illegal by construction. This is the
         * same air-data reconstruction the settle uses, evaluated ahead. */
        const hA = Math.max(0, w.p[2] - Math.max(0, v) * K.qLook);
        const rhoA = ATM.airAt(hA).rho;
        if (rhoA > 1e-6) {
            const vLim = Math.sqrt(2 * K.qMargin * ty.qMax / rhoA);
            if (v > vLim) aT = Math.max(aT, G + K.kvz * (v - vLim));
        }
        aT = Math.min(aT, aMax);

        if (!lit) {
            const A = aMax - G;
            const hBrake = A > 0.5 ? (vt * vt / (2 * G)) * Math.log(1 + G * vv / (vt * vt * A)) : 1e9;
            const hDead = v * (V.RAPTOR.ignitionDelay + 2 * V.RAPTOR.spoolTau);
            if (h <= (hBrake + hDead) * (1 + K.ignMargin)) { lit = true; rung = LAD.length - 1; }
        }
        if (lit) {
            for (let k = 1; k <= rung; k++) {
                const hi = (LAD[k] * T1) / m, lo = hi * V.RAPTOR.minThrottle;
                if (aT <= hi * 0.97 && aT >= lo) { rung = k; break; }
            }
        }

        let tgo;
        if (aT > G + 0.5) {
            tgo = (vt / Math.sqrt(G * (aT - G))) * Math.atan(v * Math.sqrt(G / (aT - G)) / vt);
        } else tgo = h / Math.max(20, v);
        if (!lit) tgo += h / Math.max(30, v);
        tgo = Math.max(1.0, tgo);

        let alx = K.zemK * (6 * (V.TOWER.gateX - tel.pinX) / (tgo * tgo) - 4 * w.v[0] / tgo);
        let aly = K.zemK * (6 * (V.TOWER.gateY - tel.pinY) / (tgo * tgo) - 4 * w.v[1] / tgo);
        const cap = K.aLatFrac * aMax, lm = Math.hypot(alx, aly);
        if (lm > cap) { alx *= cap / lm; aly *= cap / lm; }

        let nx = alx, ny = aly, nz = Math.max(0.2 * G, aT);
        const nrm = Math.hypot(nx, ny, nz) || 1;
        nx /= nrm; ny /= nrm; nz /= nrm;

        const aoaMax = tel.q > 100
            ? Math.min(K.aoaMax, (0.662 * ty.qAlphaMax) / tel.q) : K.aoaMax;
        M.qrot(_vw2, w.q, w._vb);
        const sp = Math.hypot(_vw2[0], _vw2[1], _vw2[2]);
        if (sp > 20 && tel.q > 100) {
            const ux = -_vw2[0] / sp, uy = -_vw2[1] / sp, uz = -_vw2[2] / sp;
            const ang = Math.acos(M.clamp(nx * ux + ny * uy + nz * uz, -1, 1));
            if (ang > aoaMax && ang > 1e-4) {
                const t = (ang - aoaMax) / ang, s = Math.sin(ang);
                const w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s;
                const cx = nx * w1 + ux * w2, cy = ny * w1 + uy * w2, cz = nz * w1 + uz * w2;
                const cn = Math.hypot(cx, cy, cz) || 1;
                nx = cx / cn; ny = cy / cn; nz = cz / cn;
            }
        }

        w.axis(ax);
        errW[0] = ax[1] * nz - ax[2] * ny;
        errW[1] = ax[2] * nx - ax[0] * nz;
        errW[2] = ax[0] * ny - ax[1] * nx;
        M.qrotInv(errB, w.q, errW);

        if (lit) {
            o[1] = (rung + 0.5) / LAD.length * 2 - 1;
            const need = Math.hypot(alx, aly, aT);
            o[0] = M.clamp(m * need / (LAD[rung] * T1), V.RAPTOR.minThrottle, 1) * 2 - 1;
        } else { o[0] = -1; o[1] = -1; }

        const T = w.act.thrust();
        if (T > 1e3) {
            const I = w.mp.Ixx;
            const tauX = I * (K.kpAtt * errB[0] - K.kdAtt * w.w[0]);
            const tauY = I * (K.kpAtt * errB[1] - K.kdAtt * w.w[1]);
            const rz = ty.engines[0].z - w.mp.com, gm = ty.engines[0].gimbal;
            o[2] = M.clamp(Math.asin(M.clamp(tauX / (rz * T), -1, 1)) / gm, -1, 1);
            o[3] = M.clamp(Math.asin(M.clamp(tauY / (rz * T), -1, 1)) / gm, -1, 1);
        }
        return o;
    };
}

/* ------------------------------------------------------------------- run --- */
function runStage(stage, n, K) {
    const hist = {}, rows = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const sc = SC.makeScenario(stage, 90000 + i * 7919);
        // The golden test asks about the CATCH, so the catch is always cleared.
        sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
        const w = new WM.World(sc);
        const r = w.runEpisode(makePilot(K));
        const nm = WM.OUTCOME_NAME[r.outcome];
        hist[nm] = (hist[nm] || 0) + 1;
        sum += r.total;
        rows.push(r.terminal);
    }
    return { hist, mean: sum / n, rows, n };
}

if (NODE && require.main === module) {
    const n = parseInt(process.argv[2] || "40", 10);
    const stages = (process.argv[3] || "0,1,2,3").split(",").map(Number);
    const c = V.TOWER.capture;
    console.log(`capture box: |across| < ${c.across} m, |along| < ${c.along} m, ` +
        `vz < ${c.vz} m/s, vh < ${c.vh} m/s, tilt < ${(c.tilt / DEG).toFixed(1)}°`);
    console.log(`arm annulus: a hull strike for |across| between ` +
        `${(V.TOWER.gateHalfGap - V.BOOSTER.radius).toFixed(1)} and ` +
        `${(V.TOWER.gateHalfGap + V.BOOSTER.radius + 2.5).toFixed(1)} m, over the last ` +
        `${(V.TOWER.armZ + 2 - (V.TOWER.armZ - 3 - V.BOOSTER.length)).toFixed(0)} m of the descent\n`);

    let anyCatch = false;
    for (const s of stages) {
        if (SC.STAGES[s].vehicle !== "booster") continue;
        const r = runStage(s, n);
        const caught = r.hist.caught || 0;
        if (caught > 0) anyCatch = true;
        const order = Object.entries(r.hist).sort((a, b) => b[1] - a[1]);
        console.log(`stage ${s} · ${SC.STAGES[s].label}`);
        console.log(`   ${order.map(([k, v]) => `${k} ${(100 * v / r.n).toFixed(0)}%`).join("  ")}`);
        console.log(`   caught ${caught}/${r.n}   mean score ${r.mean.toFixed(3)}`);
    }
    console.log(`\n${anyCatch ? "PASS" : "FAIL"} — a hand-written pilot ${anyCatch ? "can" : "CANNOT"} be caught in this environment.`);
    if (!anyCatch) console.log("       Fix the environment before touching the search.");
}

if (NODE) module.exports = { makePilot, makeReference, runStage, GAINS, SLAM };
else window.GoldenPilot = { makePilot, makeReference, GAINS, SLAM };

})();
