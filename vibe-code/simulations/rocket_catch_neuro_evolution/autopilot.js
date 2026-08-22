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
/* autopilot.js — a hand-written classical controller, for three jobs.
 *
 * 1. IT PROVES THE ENVIRONMENT IS SOLVABLE. Every flat fitness curve in this
 *    collection has, on inspection, turned out to be an environment that could
 *    not be flown by anything rather than a search that was too slow. Before
 *    spending a core-week on evolution, something that is not a neural network
 *    has to be able to land. If this file cannot catch a booster, no genome
 *    will, and the bug is in the physics.
 *
 * 2. IT IS THE BASELINE. A scenario at 12 km with a 20 m/s jet is not the same
 *    problem as one at 700 m on a calm day, and averaging raw scores over both
 *    mostly measures which one came up more often. Fitness is therefore reported
 *    both raw and as an advantage over this controller flying the identical
 *    scenario, which puts every stage on one scale.
 *
 * 3. IT IS THE FALLBACK IN THE BROWSER. Until a champion is good enough to be
 *    worth watching, the page flies this instead, clearly labelled.
 *
 * WHAT IT IS. Thrust-vector control with an outer guidance loop and an inner
 * RATE CASCADE — the attitude loop commands an angular VELOCITY, which is
 * clamped, and a second loop tracks it. A flat proportional-derivative law on
 * attitude error looks equivalent and is not: its terminal rate for a large
 * error is wherever kp·θ meets kd·ω, which for a 90° flip is far past any
 * sensible rate limit. That mistake cost a week in the docking project in this
 * same collection.
 *
 * THE THING THAT MAKES THIS HARD, and the reason it is worth reading: neither
 * vehicle can hover. Three Raptors at their 40% floor under a 210 tonne Super
 * Heavy is a thrust-to-weight of 1.6, and thirteen at full throttle is 13.8.
 * There is no throttle setting that holds altitude at the top of that range and
 * none that descends slowly at the bottom of it. The landing burn is a
 * hoverslam: the burn has to start at the altitude where maximum braking
 * arrives at zero velocity exactly at the rails, and if it starts late there is
 * no recovering and if it starts early the vehicle runs out of propellant while
 * still in the air. That is what the `requiredAccel` line below is computing,
 * and it is the whole manoeuvre.
 */
"use strict";

const M = (typeof require !== "undefined") ? require("./mathx.js") : window.MathX;
const V = (typeof require !== "undefined") ? require("./vehicle.js") : window.Vehicle;
const W = (typeof require !== "undefined") ? require("./world.js") : window.WorldMod;

const DEG = Math.PI / 180;
const G = 9.80665;

class Autopilot {
    constructor(opts) {
        opts = opts || {};
        this.gain = opts.gain || 1.0;
        this.reset();
        this._a = M.v3(); this._e = M.v3(); this._eb = M.v3();
        this._ax = M.v3(); this._des = M.v3(); this._tmp = M.v3();
    }

    reset() {
        /* The golden pilot is a closure over its own ignition latch, so it has
         * to be rebuilt per episode — reusing one across a bank leaks the latch
         * and produces a string of breakups that look like a physics fault. */
        this.golden = null;
        this.phase = "coast";
        this.tPhase = 0;
        this.shed = false;
        this.burnStarted = false;
        this.lined = false;
    }

    act(world, out) {
        for (let i = 0; i < out.length; i++) out[i] = 0;
        return world.type.key === "booster" ? this.booster(world, out) : this.ship(world, out);
    }

    /* -------------------------------------------------------------- shared */

    /* Where is it going, and what does the body origin have to reach?
     *
     * ONE WAYPOINT, and a continuous descent onto it. The two-waypoint version
     * that came before this — line up over the gate, then descend — reads better
     * and cannot be flown: a Super Heavy on its lowest engine group has a
     * thrust-to-weight of 1.03, so "hold position" means burning 765 kg of
     * methalox a second out of a thirty-tonne reserve, and every extra second
     * spent lining up is a second of braking authority the vehicle will not have
     * at the rails. It ran out of propellant at 160 m, repeatedly, in perfect
     * formation over the gate. The real vehicle does not hover either. The
     * lateral error has to be flown out on the way down, while the engines are
     * doing something useful anyway.
     */
    aimPoint(world, o) {
        const ty = world.type;
        this.holdAlt = false;
        if (world.catchAllowed) {
            o[0] = V.TOWER.gateX;
            o[1] = V.TOWER.gateY;
            o[2] = V.TOWER.armZ - ty.catchPinZ;   // engine plane when the pins are on the rails
        } else {
            const gt = world.sc.groundTarget;
            o[0] = gt.x; o[1] = gt.y; o[2] = 0.4;
        }
        return o;
    }

    /* Planned braking acceleration: the SMALLEST engine group whose 55% braking
     * can still stop the vehicle inside the height it has left.
     *
     * Planning against the largest group instead is the obvious thing to do and
     * it is wrong in both directions. High and fast it is right — thirteen
     * Raptors is what a 12 km, 600 m/s descent needs — but at 500 m and 40 m/s
     * it prescribes a 7 g profile, which says "fall much faster than you are"
     * all the way to the ground and never brakes at all. Choosing the group to
     * fit the situation is what makes one law cover both. The 55% is the
     * control margin: a hoverslam flown at full throttle has no way to correct
     * being one metre low. */
    planAccel(world, dz, sink) {
        const ty = world.type, T1 = V.RAPTOR.thrust, m = world.mp.m;
        const ladder = ty.engineLadder;
        let last = 4;
        for (let i = 1; i < ladder.length; i++) {
            const a = 0.55 * (ladder[i] * T1 / m - G);
            if (a <= 0.5) continue;
            last = a;
            /* The 0.45 is load-bearing and it took a while to see why. This
             * function's answer feeds the ignition trigger, and if the two use
             * the same inequality — "can this group stop inside the height I
             * have left?" — then the trigger is satisfied at the instant the
             * group is selected, and the burn starts the moment the episode
             * begins, on the smallest group, at whatever altitude. Requiring
             * the chosen group to stop inside HALF the remaining height keeps
             * the two decisions independent: the selection happens early and
             * the trigger happens when the height has roughly halved. */
            if ((sink * sink) / (2 * a) <= dz * 0.45) return a;
        }
        return last;
    }

    /* The hoverslam law. Everything the terminal phase does is downstream of
     * this one number: the acceleration that, held from here, arrives at the
     * target with the target's velocity. */
    requiredAccel(world, aim, out) {
        const p = world.p, v = world.v;
        const sink = Math.max(0, -v[2]);

        /* THE ARM PLANE IS ALL-OR-NOTHING, and it is handled in aimPoint()
         * rather than here. A booster hovering with its engines at 95 m has its
         * midsection at the rail height: there is no altitude between about
         * 40 m and 110 m at which part of a 72 m hull is not level with the
         * chopsticks. Either the whole vehicle is above them, or it is between
         * them with five metres of lateral room. */
        const dzRaw = p[2] - aim[2];
        const dz = Math.max(0.5, dzRaw);

        /* The descent profile: the speed at which the REMAINING height is
         * exactly enough to stop in, at the planned deceleration, arriving at a
         * crawl. Above the profile the vehicle brakes; below it, it coasts.
         *
         * The middle term is the feed-forward and it is the one that matters. A
         * pure tracking law (g plus a gain on the profile error) holds whatever
         * speed it currently has once it is ON the profile, because the profile
         * itself is what is changing — the vehicle floats down at a constant
         * forty metres a second and never brakes. The exact constant-
         * deceleration requirement has to be commanded outright. */
        const hFlare = 5;
        const dEff = Math.max(0.6, dz - hFlare);
        const aDec = this.planAccel(world, dz, sink);
        /* The exact constant-deceleration requirement, signed so that a vehicle
         * which has over-braked and is now RISING gets a negative demand and
         * throttles back. Applied faithfully this law is self-correcting: brake
         * harder than it asks and the requirement falls, brake less and it
         * rises, and the trajectory arrives at vTouch exactly at dz = 0.
         *
         * An earlier version tracked a velocity profile with a proportional
         * gain instead. It floats: on the profile the correction is zero and
         * the command is exactly one gravity, so the vehicle holds forty metres
         * a second all the way to the ground while its controller reports that
         * everything is nominal. */
        const sv = -v[2];
        const aNeed = (sv * Math.abs(sv) - 2.25) / (2 * dEff);
        let az = G + aNeed;
        // A gentle ceiling on sink rate close in, so the last hundred metres are
        // flown rather than fallen through.
        const vTerm = -(1.6 + 0.32 * dz);
        if (v[2] < vTerm) az += 0.9 * (vTerm - v[2]);
        /* STATION KEEPING IS A DIFFERENT LAW FROM LANDING, and forgetting that
         * is subtle because the landing law looks like it should work. It
         * commands "arrive at the waypoint doing 1.5 m/s downward" — and then,
         * having arrived, it goes on commanding exactly that, forever, because
         * 1.5 m/s down is what it asked for and 1.5 m/s down is what it has.
         * The vehicle sinks straight through its own hold point at walking pace
         * and into the tower, with every gauge reading nominal. So when the
         * waypoint is a hold rather than a destination, the law is blended into
         * an altitude hold over the last twenty-five metres. */
        if (this.holdAlt) {
            const w = M.smoothstep(28, 4, dzRaw);
            const azHold = G + 1.35 * (0 - v[2]) - 0.32 * dzRaw;
            az = az * (1 - w) + azHold * w;
        }
        az = M.clamp(az, 0, G + 4.5 * aDec);

        /* HORIZONTAL — and this is where three separate attempts went wrong.
         *
         * The only way to accelerate sideways is to point the thrust sideways,
         * which means the LATERAL AUTHORITY IS WHATEVER THE LEAN LIMIT ALLOWS,
         * and near the tower that limit is four degrees, or 0.7 m/s². Every
         * failure came from a guidance law that did not know this: it commanded
         * an 8 m/s closing speed on a fifty-metre miss, could not arrest it, and
         * settled into a stable circular orbit around the gate at 12 m/s with
         * the gimbals hard over — station-keeping in a twenty-five metre circle
         * until the propellant ran out. Round and round, on the profile, with
         * every gauge nominal.
         *
         * So the approach speed is derived from the authority that will be
         * available, and the loop is tuned against the attitude lag rather than
         * by feel: √(0.7·a·d) far out, a 4.5 s linear law close in, and a
         * velocity gain of 0.8 — which puts the crossover at 0.42 rad/s with
         * damping 0.95, comfortably inside what a one-second attitude response
         * can support. */
        const ex = aim[0] - p[0], ey = aim[1] - p[1];
        const err = Math.hypot(ex, ey);

        /* The lean ceiling. Above the top of the tower there is nothing to hit
         * and the vehicle may lean as hard as it likes; below it, the hull is
         * threading a 25 m gap between the chopsticks and every degree of lean
         * is (110 − base) metres of lever arm at the arm plane. */
        let leanRad;
        if (world.catchAllowed) {
            /* Keyed on ALTITUDE, not on distance-to-waypoint. An earlier version
             * used dz, which is zero whenever the vehicle is sitting on its hold
             * point — so the tightest lean limit in the file was applied at the
             * exact moment the vehicle most needed authority to translate, and
             * it station-kept in a circle it did not have the sideways
             * acceleration to leave. */
            /* The lean ceiling near the tower is pure geometry. The hull point
             * level with the chopsticks sits (110 − base) metres up the body,
             * so a lean of θ puts it (110 − base)·tan θ off the centreline, and
             * the gap between the open arms allows about six metres of that.
             * The limit is therefore atan(6 / (110 − base)) — nearly free while
             * the vehicle is still above the arms, tightening to five degrees
             * by the time the pins are on the rails. A single flat number
             * instead of this curve is either too loose at the bottom, which is
             * a chopstick through the tank, or too tight at the top, where it
             * removes the only phase in which the lateral error can still be
             * flown out. */
            leanRad = Math.min(0.45, Math.atan(6 / Math.max(3, V.TOWER.armZ - p[2])));
        } else {
            leanRad = M.clamp(0.12 + 0.0022 * p[2], 0.12, 0.45);
        }
        const leanMax = Math.tan(leanRad);
        const aLat = Math.max(0.35, Math.max(Math.abs(az), 0.7 * G) * leanMax);

        /* 0.35, not 0.7: the closing speed has to be arrestable with margin,
         * because the authority available at the far end of the approach is
         * three times what is available at the near end. Sized at 0.7 the
         * vehicle closed an eighty-metre miss at 13 m/s, flew through the gate
         * at fifteen, and never came back. */
        const tGoLat = Math.max(3.0, dz / Math.max(6, sink));
        /* NO FLOOR ON THE APPROACH SPEED. A "+0.3" here — meant as a minimum
         * closing rate — is a 0.3 m/s command in the direction ex/|e|, and when
         * |e| is a few times 1e-8 that direction is whatever the floating-point
         * residue happens to be. A vehicle sitting exactly over the gate,
         * perfectly still and perfectly vertical, was therefore told to move at
         * a third of a metre a second in a random direction, and the loop then
         * chased it into a five-second limit cycle that reached 9 m/s. */
        let vApproach = Math.min(40, Math.sqrt(0.35 * aLat * Math.max(0.2, err)), err / tGoLat);
        if (err < 0.35) vApproach = 0;
        let vxWant = 0, vyWant = 0;
        if (err > 1e-6) { vxWant = ex / err * vApproach; vyWant = ey / err * vApproach; }
        let ax = 0.80 * (vxWant - v[0]);
        let ay = 0.80 * (vyWant - v[1]);

        const lim = Math.max(Math.abs(az), 0.7 * G) * leanMax;
        const lh = Math.hypot(ax, ay);
        if (lh > lim && lh > 1e-6) { ax *= lim / lh; ay *= lim / lh; }

        out[0] = ax; out[1] = ay; out[2] = az;
        return out;
    }

    /* Pick the SMALLEST group that can deliver the demand. The ladder ascends,
     * so the first sufficient rung is the right one — an earlier version of
     * this loop kept overwriting its choice and ended up selecting the largest
     * rung every time, which lit thirteen engines under a booster that needed
     * about one and flew it back up to a kilometre. */
    selectPower(world, need) {
        const ty = world.type, act = world.act;
        const T1 = V.RAPTOR.thrust;
        const ladder = ty.engineLadder;
        let best = ladder.length - 1;
        for (let i = 1; i < ladder.length; i++) {
            if (ladder[i] * T1 >= need * 1.05) { best = i; break; }
        }
        /* Do not shed below the group that can still stop the rotation the
         * vehicle currently has. Thrust is attitude authority here — there are
         * no reaction wheels and no RCS — so "I no longer need this much
         * deceleration" and "I no longer need this many engines" are different
         * statements, and confusing them is how a vehicle sheds its way into an
         * unrecoverable tumble twenty metres from the rails. */
        const rate = Math.hypot(world.w[0], world.w[1]);
        if (rate > 0.05) {
            const rz = Math.abs(ty.engines[0].z - world.mp.com);
            const sg = Math.sin(ty.engines[0].gimbal);
            const needAlpha = (rate * rate) / (2 * 0.18);
            for (let i = 1; i < ladder.length; i++) {
                const alpha = rz * ladder[i] * T1 * 0.7 * sg / world.mp.Ixx;
                if (alpha >= needAlpha) { if (i > best) best = i; break; }
                if (i === ladder.length - 1) best = i;
            }
        }
        // Stepping up costs an ignition credit and a 450 ms hole in the thrust,
        // so it is only worth doing for a demand that is going to persist.
        if (ladder[best] > ladder[act.stage]) {
            if (act.ignitions <= 0) best = act.stage;
        }
        return best;
    }

    /* Rate-cascade attitude control, with the rate limit derived from the
     * ACTUAL angular authority rather than picked by taste.
     *
     * A 250 tonne, 72 m booster on three gimballed Raptars can manage about
     * 0.4 rad/s² — it takes the better part of a second to build a third of a
     * radian per second of pitch rate, and the same again to take it away. Ask
     * such a vehicle for a rate it cannot stop and the inner loop saturates the
     * gimbal against the stop, the outer loop overshoots, and what comes out is
     * a bang-bang oscillation that grows until the thing is flying backwards.
     * That is exactly what the first version of this controller did.
     *
     * So the rate ceiling is the braking-distance limit, √(2·α·θ): the fastest
     * rotation that can still be arrested inside the remaining angle. The
     * moment demand is then clamped to what the gimbal can actually produce, so
     * the loop never asks for authority it does not have.
     */
    steerTo(world, desAxis, out, rollCmd) {
        const ax = this._ax;
        world.axis(ax);
        const e = this._e;
        M.vcross(e, ax, desAxis);              // sin(error) about the world axis
        const eb = this._eb;
        M.qrotInv(eb, world.q, e);

        const mp = world.mp;
        const T = world.act.thrust();
        const gmax = world.type.engines[0].gimbal;
        const rz = Math.abs(world.type.engines[0].z - mp.com);
        // Angular authority available right now: the gimbal, plus whatever the
        // grid fins can produce at this dynamic pressure. Unpowered, the fins
        // are ALL of it, and clamping the demand to the gimbal's zero would
        // leave the aerodynamic phase with no controller at all.
        const fin = this.finAuthority(world);
        const alphaMax = Math.max(0.02, rz * T * Math.sin(gmax) / mp.Ixx + fin);

        /* THE RATE CEILING IS SET BY THE AUTHORITY THE VEHICLE WILL STILL HAVE
         * AFTER IT SHEDS ENGINES, not by what it has right now. A landing burn
         * runs thirteen Raptors and finishes on two, and the angular authority
         * falls by a factor of four and a half when it does. A rate that was
         * comfortably stoppable a second ago is then unstoppable: the observed
         * failure was a booster that built 24°/s of pitch under thirteen
         * engines, shed to two, and needed 33° of further rotation to arrest a
         * rate it had acquired in a tenth of that. It arrived at the tower
         * lying down. */
        const T1 = V.RAPTOR.thrust;
        const nSmall = world.type.engineLadder[1] || 1;
        const alphaSafe = Math.max(0.02,
            rz * (nSmall * T1 * 0.60) * Math.sin(gmax) / mp.Ixx + fin);

        // signed error angle, using the dot product so errors past 90° do not
        // fold back (asin alone cannot tell 30° from 150°)
        const dot = M.clamp(M.vdot(ax, desAxis), -1, 1);
        const ang = Math.atan2(M.clamp(M.vlen(e), 0, 1), dot);

        /* The rate ceiling must be sized against the authority available NOW as
         * well as the authority that will survive an engine shed. alphaSafe
         * assumes the small group at 60% throttle; when the vehicle is actually
         * flying that group at 42%, the real authority is 30% lower than the
         * ceiling assumes, every rate command overshoots, the inner loop
         * saturates, and the attitude sits in a bang-bang limit cycle between
         * ±10° with the gimbal slamming stop to stop. */
        const alphaUse = Math.min(alphaMax, alphaSafe);
        const rateMax = M.clamp(0.60 * Math.sqrt(2 * alphaUse * Math.max(ang, 0.02)), 0.012, 0.55);
        const kp = 3.0 * this.gain;
        let wdx = kp * eb[0], wdy = kp * eb[1];
        const wm = Math.hypot(wdx, wdy);
        if (wm > rateMax && wm > 1e-9) { wdx *= rateMax / wm; wdy *= rateMax / wm; }

        const kd = 2.6 * this.gain;
        let adx = kd * (wdx - world.w[0]);
        let ady = kd * (wdy - world.w[1]);
        let adz = 1.4 * ((rollCmd || 0) - world.w[2]);
        const am = Math.hypot(adx, ady);
        if (am > alphaMax && am > 1e-9) { adx *= alphaMax / am; ady *= alphaMax / am; }

        const Mx = mp.Ixx * adx, My = mp.Iyy * ady, Mz = mp.Izz * adz;

        let usedX = 0, usedY = 0;
        if (T > 1e3) {
            const denom = rz * T;
            // Mx = −|rz|·T·sin(gx) → gx = asin(−Mx/(|rz|T))
            const gx = M.clamp(Math.asin(M.clamp(-Mx / denom, -1, 1)), -gmax, gmax);
            const gy = M.clamp(Math.asin(M.clamp(-My / denom, -1, 1)), -gmax, gmax);
            out[2] = gx / gmax;
            out[3] = gy / gmax;
            usedX = -Math.sin(gx) * denom;
            usedY = -Math.sin(gy) * denom;
        }
        return { mx: Mx - usedX, my: My - usedY, mz: Mz };
    }

    /* Angular acceleration the grid fins can produce at the current dynamic
     * pressure, deflected to their stops. Zero for the Ship, which has none. */
    finAuthority(world) {
        const ty = world.type;
        if (!ty.fins.length) return 0;
        const fin = ty.fins[0];
        const rz = fin.z - world.mp.com;
        const K = world.tel.q * fin.area * 2.0;
        return Math.max(0, 1.5 * K * rz * fin.maxDefl / world.mp.Ixx);
    }

    /* Grid fin mixer. Three fins at 0/120/240 hinged about the radius produce
     *   Mx = K·rz·Σδcosφ,  My = K·rz·Σδsinφ,  Mz = −K·rr·Σδ
     * which inverts exactly for three fins. */
    mixFins(world, dem, out, authority) {
        const ty = world.type;
        if (!ty.fins.length) return;
        const q = world.tel.q;
        const fin = ty.fins[0];
        const rz = fin.z - world.mp.com;
        const rr = ty.radius + 1.2;
        const K = Math.max(1e-3, q * fin.area * 2.0);
        /* The T layout inverts differently from a symmetric one. With fins at
         * 90 / 180 / 270 degrees:
         *     Mx = -K*rz*d180                 (only the aft fin pitches)
         *     My =  K*rz*(d90 - d270)
         *     Mz = -K*rr*(d90 + d180 + d270)
         * which solves exactly for three deflections. The generic 120-degree
         * formula that was here before silently produced the wrong torque on
         * every axis once the fins moved to the T. */
        const a = (dem.mx * authority) / (K * rz);
        const b = (dem.my * authority) / (K * rz);
        const c = (-dem.mz * authority) / (K * rr);
        const d180 = -a;
        const sum = c - d180;                  // d90 + d270
        const d = [0.5 * (sum + b), d180, 0.5 * (sum - b)];
        for (let j = 0; j < ty.fins.length; j++) {
            out[4 + j] = M.clamp(d[j] / ty.fins[j].maxDefl, -1, 1);
        }
    }

    /* --------------------------------------------------------------- booster
     *
     * WHEN A CATCH IS CLEARED, THIS DELEGATES TO THE GOLDEN PILOT.
     *
     * The two controllers had drifted into being different things. This one is
     * the browser's "Scripted" option and the file header has always said that
     * if it cannot catch a booster no genome will — but it catches on no stage,
     * which a user noticed immediately by switching the dropdown and watching
     * every flight fail. golden_test.js, meanwhile, catches 55% of stage 0.
     *
     * Keeping two hand-written controllers is how the page ends up
     * demonstrating something worse than the reference the training run is
     * measured against, so the booster catch path is now literally the same
     * code. The divert path stays here: the golden pilot only ever flies at the
     * tower, because golden_test forces catchAllowed, and a vehicle that has
     * been waved off still needs somewhere to go. */
    booster(world, out) {
        const GP = (typeof window !== "undefined" ? window.GoldenPilot : null)
            || (typeof GoldenPilot !== "undefined" ? GoldenPilot : null);
        if (world.catchAllowed && GP) {
            /* THE TWO-PHASE REFERENCE IF THE PAGE HAS ONE. makePilot is the
             * settle half alone, which cannot fly a run-in from a kilometre
             * offshore — it brakes from four kilometres and arrives with the
             * tank empty. makeReference flies the energy first and hands over
             * to it. Falls back so an older page still runs. */
            /* PREFER THE TEACHER. It is the same control law the training runs
             * use, and it is several structural fixes ahead of anything that was
             * ever copied into golden_test.js: it damps roll with the grid fins
             * (nothing else can — a shared gimbal makes no roll moment at all),
             * it flies those fins for attitude through the whole unpowered coast
             * instead of gliding unactuated, and it trims the lateral hold with an
             * integral term so a steady wind does not leave a standing offset.
             * Measured against the old reference on 250 episodes a stage:
             *
             *     stage 0   20% -> 62%      stage 2    6% -> 62%
             *     stage 1   27% -> 78%      stage 3    1% -> 43%
             *
             * makeReference is kept as the fallback so an older page still runs. */
            const TE = (typeof window !== "undefined" ? window.Teacher : null)
                || (typeof Teacher !== "undefined" ? Teacher : null);
            if (TE) { TE.advise(world, out); return out; }
            if (!this.golden) this.golden = (GP.makeReference || GP.makePilot)(GP.GAINS);
            this.golden(world, out);
            out[9] = 1;
            return out;
        }
        return this.divert(world, out);
    }

    divert(world, out) {
        const aim = this.aimPoint(world, this._tmp);
        const tel = world.tel;
        const dz = world.p[2] - aim[2];
        const sink = Math.max(0, -world.v[2]);
        const mp = world.mp;

        out[9] = world.catchAllowed ? 1 : -1;

        const T1 = V.RAPTOR.thrust;
        /* IGNITION ALTITUDE. Height needed to stop at the planned deceleration,
         * plus the distance fallen during the 450 ms it takes a Raptor to come
         * up, plus a margin. Latched: once the burn has started it does not
         * stop, because relighting costs an ignition credit and there are two. */
        const aPlan = this.planAccel(world, dz, sink);
        const hStop = (sink * sink) / (2 * aPlan);
        if (!this.burnStarted && dz < hStop + sink * (V.RAPTOR.ignitionDelay + 0.55) + 28) {
            this.burnStarted = true;
        }

        if (!this.burnStarted) {
            /* AERODYNAMIC PHASE. Engines cold, fins doing the flying. To
             * accelerate one way you lean the NOSE the other way — a falling
             * cylinder is a shuttlecock and its cross-flow force opposes the
             * component of velocity across the body. */
            const ex = aim[0] - world.p[0], ey = aim[1] - world.p[1];
            const tGo = Math.max(3, dz / Math.max(20, sink));
            const wantVx = M.clamp(ex / tGo, -120, 120);
            const wantVy = M.clamp(ey / tGo, -120, 120);
            const dvx = wantVx - world.v[0], dvy = wantVy - world.v[1];
            const mag = Math.hypot(dvx, dvy);
            /* Full lean for a 10 m/s velocity error, not a 55 m/s one. The
             * larger divisor was sized for the supersonic stages and made the
             * unpowered phase almost inert on the short ones — a 3 m/s
             * correction bought one degree of angle of attack, and the lateral
             * miss that should have been flown out at 400 m altitude was still
             * there at 60 m, where there is no authority left to fix it. */
            const lean = M.clamp(mag / 10, 0, 1) * 22 * DEG;
            const des = this._des;
            if (mag > 0.5) {
                des[0] = -dvx / mag * Math.sin(lean);
                des[1] = -dvy / mag * Math.sin(lean);
            } else { des[0] = 0; des[1] = 0; }
            des[2] = Math.cos(lean);
            M.vnorm(des, des);
            const dem = this.steerTo(world, des, out, 0);
            this.mixFins(world, dem, out, 1.0);
            out[0] = -1;
            out[1] = -1;
            return out;
        }

        /* POWERED PHASE. */
        const a = this.requiredAccel(world, aim, this._a);
        const amag = Math.max(0.5, M.vlen(a));
        const need = amag * mp.m;
        let idx = this.selectPower(world, need);
        // Never step back up mid-burn: the credit is worth more later, and the
        // 450 ms thrust hole in the middle of a hoverslam is fatal. Keyed on
        // "this burn is running", not on "has ever been lit" — the latter is
        // true the instant a pre-lit scenario starts and pins the vehicle at
        // whatever it shut down to.
        if (world.act.stage > 0 && idx > world.act.stage) idx = world.act.stage;
        out[1] = (idx + 0.5) / world.type.engineLadder.length * 2 - 1;

        const nLive = world.type.engineLadder[idx] || 2;
        const thr = M.clamp(need / (nLive * T1), V.RAPTOR.minThrottle, 1);
        out[0] = thr * 2 - 1;

        const des = this._des;
        M.vscale(des, a, 1 / amag);
        const dem = this.steerTo(world, des, out, 0);
        // Below the transonic band the fins still bite; above it they are
        // half-effective and the gimbal is doing the work anyway.
        this.mixFins(world, dem, out, tel.q > 2000 ? 0.5 : 0.15);
        return out;
    }

    /* ------------------------------------------------------------------ ship */
    ship(world, out) {
        const aim = this.aimPoint(world, this._tmp);
        const mp = world.mp;
        const dz = world.p[2] - aim[2];
        const sink = Math.max(0, -world.v[2]);
        const tilt = world.tel.tilt;

        out[9] = world.catchAllowed ? 1 : -1;
        // Legs go out early if the plan is the concrete; they cost a little drag
        // and a Ship that decides at 40 m has already decided too late.
        out[8] = (!world.catchAllowed && world.sc.groundTarget.kind === "pad" && dz < 900) ? 1 : -1;

        const T1 = V.RAPTOR.thrust;
        const nMax = 3;
        const aMax = nMax * T1 / mp.m - G;
        // Height for the flip itself plus the braking that follows it.
        const hFlip = (sink * sink) / (2 * Math.max(1, aMax * 0.55)) + 3.4 * sink + 70;

        if (this.phase === "coast" && dz < hFlip) this.phase = "flip";
        if (this.phase === "flip" && tilt < 22 * DEG) this.phase = "land";

        if (this.phase === "coast") {
            /* THE FLOP. Hold the long axis level with the tiles down, pointed
             * along the heading that will still be useful after the flip, and
             * let the body's own 468 m² of flank do the braking. */
            const ex = aim[0] - world.p[0], ey = aim[1] - world.p[1];
            const d = Math.hypot(ex, ey);
            const des = this._des;
            if (d > 3) { des[0] = ex / d; des[1] = ey / d; } else { des[0] = 1; des[1] = 0; }
            des[2] = 0.06;
            M.vnorm(des, des);
            this.flopFlaps(world, des, out);
            out[0] = -1; out[1] = -1;
            return out;
        }

        if (this.phase === "flip") {
            /* THE FLIP. Three engines, hard over, rotate to vertical. Flaps go
             * to the configuration that helps rather than fights: aft flaps out
             * to drag the tail back, forward flaps in. */
            out[1] = 1;                       // three engines
            out[0] = 0.65;
            const des = this._des;
            const a = this.requiredAccel(world, aim, this._a);
            M.vnorm(des, a);
            const dem = this.steerTo(world, des, out, 0);
            void dem;
            out[4] = -0.8; out[5] = -0.8;     // forward flaps in
            out[6] = 0.9; out[7] = 0.9;       // aft flaps out
            return out;
        }

        /* LANDING. Same terminal law as the booster; a different ladder. */
        const a = this.requiredAccel(world, aim, this._a);
        const amag = Math.max(0.5, M.vlen(a));
        const need = amag * mp.m;
        const idx = this.selectPower(world, need);
        out[1] = (idx + 0.5) / world.type.engineLadder.length * 2 - 1;
        const nLive = world.type.engineLadder[Math.max(idx, world.act.stage)] || 1;
        out[0] = M.clamp(need / (nLive * T1), V.RAPTOR.minThrottle, 1) * 2 - 1;

        const des = this._des;
        M.vscale(des, a, 1 / amag);
        this.steerTo(world, des, out, 0);
        for (let i = 4; i < 8; i++) out[i] = -0.6;
        return out;
    }

    /* Flap mixer for the flop: pitch from forward-versus-aft, roll from
     * left-versus-right, both around a mid-travel trim so there is authority in
     * both directions. */
    flopFlaps(world, desAxis, out) {
        const ax = this._ax;
        world.axis(ax);
        const e = this._e;
        M.vcross(e, ax, desAxis);
        const eb = this._eb;
        M.qrotInv(eb, world.q, e);

        // Body +X is the belly; it should point at the ground.
        M.qrotInv(this._des, world.q, DOWN);
        const bellyErr = Math.atan2(this._des[1], -this._des[0]);

        const wantWy = M.clamp(1.6 * eb[1], -0.45, 0.45);
        const wantWz = M.clamp(-1.8 * bellyErr, -0.5, 0.5);
        const uPitch = M.clamp(2.4 * (wantWy - world.w[1]) - 0.5 * world.w[1], -1, 1);
        const uRoll = M.clamp(2.0 * (wantWz - world.w[2]), -1, 1);

        // trim near mid-travel; forward pair positive pitch, left pair positive roll
        const base = 0.10;
        out[4] = M.clamp(base - uPitch + uRoll, -1, 1);   // fwd-left
        out[5] = M.clamp(base - uPitch - uRoll, -1, 1);   // fwd-right
        out[6] = M.clamp(base + uPitch + uRoll, -1, 1);   // aft-left
        out[7] = M.clamp(base + uPitch - uRoll, -1, 1);   // aft-right
    }
}

const DOWN = new Float64Array([0, 0, -1]);

/* Convenience: a policy function for World.runEpisode. */
function autopilotPolicy(opts) {
    const ap = new Autopilot(opts);
    let last = null;
    return function (world, out) {
        if (world !== last) { ap.reset(); last = world; }
        ap.act(world, out);
    };
}

/* The do-nothing policy, for the audition described in evolution.js. */
function inertPolicy(world, out) {
    for (let i = 0; i < out.length; i++) out[i] = 0;
    out[0] = -1; out[1] = -1; out[9] = -1;
}

if (typeof module !== "undefined") {
    module.exports = { Autopilot, autopilotPolicy, inertPolicy };
} else {
    window.AutopilotMod = { Autopilot, autopilotPolicy, inertPolicy };
}

})();
