/* teacher.js — the golden pilot, made STATELESS and FEASIBILITY-AWARE.
 *
 * A DAgger teacher has to answer, for an arbitrary state the student has
 * wandered into: what should be done HERE? Two properties are required, and
 * golden_test.js's pilot has neither as written.
 *
 * 1. STATELESS. makePilot closes over `lit`, `rung` and `vCap`. Under
 *    cloning that is harmless — the teacher drives, so its latches match the
 *    world. Under DAgger the STUDENT drives, and the teacher's private latches
 *    describe a flight that never happened: it believes it has lit engines that
 *    are cold, or is on an engine group the vehicle never selected. Every label
 *    from that point is advice for a different vehicle. So all three are
 *    re-derived from the world each call — ignition state from act.everLit, the
 *    engine group from act.stage, the descent-rate cap from the scenario's own
 *    initial velocity.
 *
 * 2. FEASIBILITY-AWARE. This is the trap the plateau note spends its longest
 *    paragraph on, and it is worth restating in this project's terms: if the
 *    student has flown somewhere a catch can no longer be reached from, then
 *    "keep steering to the gate" is not merely unhelpful, it is a label for an
 *    action that cannot achieve what it is labelled as achieving. Training on
 *    thousands of those teaches contradictions, and the signature is training
 *    accuracy staying high while on-policy validation collapses.
 *
 *    So the teacher re-plans. It checks, from the current state, whether the
 *    rails are still reachable — enough height to arrest the descent at the
 *    thrust available, enough propellant to do it, enough time to fly out the
 *    across-arm error. If not, it aims at the ground target instead and labels
 *    a divert, which is the correct best-remaining outcome and is a manoeuvre
 *    the vehicle is actually asked to perform in a third of all episodes. If
 *    neither is reachable it reports STRANDED, and the stranded rate is logged
 *    every round; it should be near zero.
 */
"use strict";

/* NODE AND BROWSER, because there must not be two of these.
 *
 * This file is the control law. golden_test.js used to carry a second copy of it
 * for the page, and the two drifted: by the time the fins were being flown here
 * for roll damping and coast steering, the page's reference had never written a
 * fin slot in its life and was showing a vehicle gliding 12 km with its primary
 * aerodynamic surfaces parked. One owner, loaded by both. */
const NODE = (typeof require !== "undefined" && typeof module !== "undefined");
const M = NODE ? require("../mathx.js") : window.MathX;
const V = NODE ? require("../vehicle.js") : window.Vehicle;
const ATM = NODE ? require("../atmosphere.js") : window.Atmosphere;
const GOLD = NODE ? require("../golden_test.js") : window.GoldenPilot;
const SC = NODE ? require("../scenarios.js") : window.Scenarios;   // for equilibriumSink only
const AERO = NODE ? require("../aero.js") : window.Aero;           // for the fin mixer Jacobian
const DEG = Math.PI / 180;
const G = V.G0;

/* THE TEACHER GETS ITS OWN GAINS, TUNED FOR THE DIET IT TEACHES.
 *
 * A distilled policy cannot exceed its teacher, so every point the teacher
 * gains is a point the student can inherit — and the reachability probe says at
 * least 77% of stage 0 admits a catch while the balanced pilot takes 53%. A
 * 2,000-configuration search on its own seed space, with the top four re-flown
 * on the untouched report bank, found a set that takes 65%: +12 points, about
 * 3.5 standard errors on 200 episodes.
 *
 * It is NOT promoted into golden_test.js. Those gains are the page's "Scripted"
 * option and the dashboard's reference line, and they are deliberately balanced
 * across stages; this set is faster and more aggressive and pays for it with a
 * 29% loss rate on stage 1, which is a bad trade for a general reference and a
 * good one for a teacher whose entire job is to demonstrate stage-0 catches.
 * Two different jobs, two different gain sets, both measured. */
/* THE TEACHER IS NOW TWO-PHASE, because the task is. Winner of a 5,000-point
 * joint search over BOTH halves on stages 0 and 1 — 16% and 19% on the search
 * bank against an incumbent J of 0.64. Searching the settle gains alone was
 * searching a moving target: what the settle controller is handed depends
 * entirely on where and how fast the approach hands it over. */
/* RE-TUNED FOR STAGES 2 AND 3 once the roll fix exposed what was actually
 * limiting them. vtest/teachtune.js, 1,200 configs x 140 episodes on base
 * 500000, ten leaders re-flown on the untouched report bank at 960000:
 *
 *              stage 2        stage 3      worst
 *   incumbent  50/200 (25%)   16/200 ( 8%)   8.0%
 *   leader 1   98/200 (49%)   54/200 (27%)  27.0%   <- taken, +19 points on the worst
 *
 * The objective was the WORST stage, not the mean, because a set that takes half
 * of stage 2 and none of stage 3 is not a teacher for stages 2 and 3.
 *
 * The change that carries it is aoaMax, 0.386 -> 0.726 rad — 22 deg to 42 deg of
 * permitted angle of attack — and that lines up exactly with what the across-error
 * trace said was wrong. Episodes that struck the tower arrived at the 554 m
 * handover 69 m off across and were still 31 m off at the slot, because tilting
 * is how this vehicle translates and the tilt was capped at 22 deg. Note the cap
 * only opens where it is safe to: the q-alpha limiter above still overrides it
 * whenever q > 100 Pa, so the extra authority is available in the terminal phase
 * and not in the transonic one. */
const TEACHER_GAINS = {
    kpPos: 0.1096728145970584, kdPos: 0.43553083666429665,
    aLatMax: 4.572466016688985,
    kpAtt: 0.6884705896605164, kdAtt: 2.1923224864623583,
    slope: 0.25667274210462127, kvz: 0.9479643751661255,
    /* FULL-CONTROLLER SEARCH, 2,600 configs x 320 episodes, run once the structure
     * had stopped changing (fins flying roll and the coast, integral trim, the
     * scheduled handover, the q-taper). Every gain those four fixes invalidated was
     * re-searched together; twelve leaders re-flown on bank 888000, 250 eps/stage:
     *
     *                s0    s1    s2    s3    worst
     *   incumbent   59%   77%   64%   48%    48.4%
     *   leader 1    64%   78%   69%   52%    52.4%   <- taken
     *
     * The four gains it moved all say the same thing: the old structure needed a
     * margin the new one does not. Hold the alignment far lower (slotH 37 -> 11.8),
     * because the integral term now trims what the hold used to have to; carry more
     * dynamic pressure (qMargin 0.54 -> 0.72); light earlier (ignMargin 0.59 ->
     * 0.72); and let the fins keep working further down (qFin 150 -> 68 Pa). */
    slotX: 3.384833535614488, slotH: 11.839792363018914,
    vTouch: 1.712227577316066,
    qMargin: 0.7221673755907551, qLook: 15.944139850257958,
    qaMargin: 0.6619847263325938, aoaMax: 1.6616229630443584,
    /* EARNED. Two grids on bank 777000, 120 episodes x 4 stages per cell, catches
     * out of 120 (the PD control is the same harness, same seeds):
     *
     *      kiPos  hInt     s0    s1    s2    s3
     *      0      -        69    85    52    30      <- PD
     *      0.028  25       69    88    70    48
     *      0.018  40       69    88    69    47
     *      0.018  60       69    85    72    46
     *      0.09   85       34    19    12     7      <- integral instability, as expected
     *
     * Stages 2 and 3 gain 18 points each and stages 0 and 1 do not pay for it,
     * which is the signature of removing a bias rather than re-trading authority.
     * hInt is the load-bearing one: integrating from 400 m up wound the term into
     * a travelling error and cost stage 1 half its catches, while integrating over
     * the last 25-40 m trims exactly the station-keeping the arms measure. */
    kiPos: 0.028,     // lateral integral gain (0 = the old PD exactly)
    hInt: 25,         // m above the rails below which the integrator runs
    xInt: 25,         // m of position error above which it is travelling, not trimming
    iMax: 12,         // m*s, anti-windup clamp
    kiYFrac: 1.0      // integral authority on the along axis, relative to across
};
/* The approach half: a hover-slam. Braking distance under quadratic drag has a
 * closed form, so the vertical channel is one expression evaluated every tick —
 * stay cold while it asks for less than the engines can give, light when the
 * height left no longer covers the braking distance PLUS the ignition dead
 * time, then track it. See vtest/slam.js for the derivation and measurements. */
const SLAM = {
    hHand: 553.77, vHand: 40.0, ignMargin: 0.7183566843354627,
    aLatFrac: 0.41205, zemK: 1.22395, aoaMax: 0.27411,
    vHandLo: 24.0,                 // handover speed when the across error is large
    xRef: 45                       // m of across error at which vHandLo is fully applied
};
/* THE LAST TWENTY METRES. Measured over 150 stage-0 episodes with this teacher
 * (vtest/missdiag.js), on the 111 that missed the catch:
 *
 *     across      limit 0.90 m     median 0.25     fails 15%   alone  1%
 *     along       limit 2.50 m     median 0.43     fails  5%   alone  0%
 *     horizontal  limit 1.50 m/s   median 0.20     fails  3%   alone  0%
 *     tilt        limit 3.50 deg   median 0.61     fails  7%   alone  0%
 *     descent     limit 2.50 m/s   median 5.06     fails 51%   alone 14%
 *     BODY RATE   limit 3.50 deg/s median 5.65     fails 84%   alone 43%
 *
 * It arrives in the right place, upright and nearly stationary, and STILL
 * TURNING. Forty-three per cent of every miss fails on that one term and no
 * other. It is invisible in the outcome name — all of them read "missed catch"
 * — and it is the largest single item in the project.
 *
 * The rate is manufactured by the lateral loop: close in, the position error is
 * small, so the commanded tilt swings fast and the attitude loop is still
 * slewing when the pins cross the plane. So below hCalm the lateral command is
 * FADED (not cut — a step is itself a rate) and the attitude damping is
 * multiplied up. The descent is held harder toward whatever the schedule
 * already chose; moving the setpoint as well cancels the alignment hold, which
 * cost the reference half its catches when it was tried. */
const CALM = {
    /* DEFAULTED TO A NO-OP UNTIL A SEARCH EARNS THEM. Hand-set to 22/2.6/0.25/
     * 1.6 these cut body-rate-alone misses from 43% to 28% — the term they were
     * built for — and simultaneously pushed the median across error from 0.25 m
     * to 0.51 m and the along error from 0.43 m to 0.83 m, for a net change in
     * catches of 29/150 -> 25/150, which is nothing. Steering less does arrive
     * calmer and does arrive less accurately, and where that trade lands is not
     * something to guess when there is a search harness. */
    hCalm: 22,        // m above the rails where settling replaces steering
    calmKd: 1.0,      // attitude damping multiplier at the rails (1 = unchanged)
    calmLat: 1.0,     // fraction of the lateral command that survives (1 = unchanged)
    kvzCalm: 0        // descent gain at the rails (0 = inherit kvz)
};

/* SLEW-LIMIT THE COMMAND INSTEAD OF FADING IT.
 *
 * CALM above attacks the same 44%-of-all-misses body-rate term and measured a
 * net zero, and the reason is visible in what it does: multiplying the lateral
 * command toward zero MOVES the commanded thrust direction back toward vertical,
 * which throws away the correction the loop had already built up. Calmer and
 * less accurate — across error went 0.25 m -> 0.51 m — so the term it fixed was
 * paid for by the term next to it.
 *
 * The rate is not caused by the command being LARGE, it is caused by the command
 * MOVING. Close in, the position error is small and noisy, so the commanded tilt
 * swings, and an attitude loop chasing a swinging setpoint is still slewing when
 * the pins cross the plane. So limit how fast the setpoint may rotate, and take
 * that limit to nearly zero at the rails. The command stops moving, the PD (which
 * is overdamped at zeta = 1.3) drives the rate out, and — unlike a fade — the
 * direction it settles at is the one the guidance last asked for, so the
 * accumulated lateral correction is kept rather than discarded.
 *
 * DEFAULTED TO A NO-OP. Earned by search, not by argument; hSlew = 0 disables. */
const SLEW = {
    hSlew: 0,         // m above the rails where the limit starts to bite (0 = off)
    slewHi: 10.0,     // rad/s allowed at hSlew and above (effectively unlimited)
    slewLo: 10.0      // rad/s allowed at the rails
};
const DT_CTRL = 0.05;   // s, world.js: DT_PHYS 0.005 x CTRL_EVERY 10 -> 20 Hz

/* THE BODY RATE AT THE GATE IS ROLL, AND NOTHING WAS FLYING IT.
 *
 * The capture test is on |omega|, the WHOLE angular velocity, and the gate
 * diagnostic reports that term failing 81% of stage-0 misses. Both CALM and
 * SLEW attacked it through the attitude loop and both measured nothing, which
 * is explained by decomposing the rate instead of arguing about it — over 150
 * episodes, on the 121 that missed:
 *
 *     median pitch/yaw |w_xy|    0.44 deg/s      (limit 3.50 — eight times the margin)
 *     median roll      |w_z|     5.48 deg/s      (limit 3.50 — fails)
 *     94 of 121 misses would PASS the rate term if roll were zero.
 *
 * The attitude loop was never the problem: it holds the two axes it commands to
 * half a degree per second. The vehicle arrives spinning about its long axis,
 * and it had no roll control of any kind. Thrust cannot supply one — gimbalCmdX/Y
 * is a single command shared by every engine, so the thrust vector passes through
 * the axis and its roll moment is identically zero. The only roll authority on a
 * booster is the grid fins, and `out.fill(0)` was leaving all three at neutral.
 *
 * Nor is the roll inherited: it leaves the spawn at 0.1-0.3 deg/s and is BUILT
 * during the descent, which is what three fins at 90/180/270 do in sideslip —
 * an odd number in a T cannot cancel its own roll couple.
 *
 * So the fins get flown, for roll alone. Asking for zero X and Y torque from
 * them keeps this out of the gimbal's way: the mixer is free to find the fin
 * combination that roll-damps without disturbing the axes the gimbal owns. */
/* EARNED. vtest/rollsweep.js, 22 configs x 400 episodes on its own seed base:
 *
 *     kRoll  qFin     caught          med gate rate
 *      0      150   74/400 (18.5%)      6.47 deg/s     <- control
 *      1.8     40  197/400 (49.3%)      1.66 deg/s
 *      1.8    150  197/400 (49.3%)      1.75 deg/s     <- taken
 *      1.8    600   88/400 (22.0%)      5.54 deg/s
 *
 * +30.8 points, z = 9.2, and the mechanism shows in the middle column: the rate
 * the fix targets goes under its 3.5 deg/s limit and the catches follow. The
 * gain plateaus above ~1.2 and the qFin row is the interesting one — at 600 Pa
 * the damper is switched off through the whole of the low-q terminal phase,
 * which is exactly where the roll has to be gone, and two thirds of the gain
 * disappears. 40 and 150 measure the same because below that the Jacobian is
 * numerically zero and the ridge already suppresses the command. */
/* THE SHIP: ITS ACTUATORS NOW FLY, ITS LANDING IS NOT SOLVED. Stated plainly
 * because the two are easy to confuse.
 *
 * What is fixed: all four flaps were inert for every Ship episode this project
 * has ever run — out.fill(0) maps to the MIDPOINT of the 5-80 degree travel — so
 * the vehicle flopped 10 km with its only actuators pinned half open. They are
 * now flown, on a measured Jacobian, against a proper belly-flop attitude target
 * (long axis horizontal at the aim, tiled belly into the wind) rather than the
 * booster law, whose angle-of-attack clamp actively commands the wrong thing for
 * a flopping vehicle: it pulls the body toward the relative wind, which is the
 * flop folding into a dive.
 *
 * What is NOT fixed: the Ship still does not land. It flips — tilt goes 93 deg
 * to 24 deg — and it arrives at 50 m still about 19 degrees off vertical against
 * a 3.5 degree capture limit, because it is STILL TRANSLATING when it gets there.
 * That 19 degrees is very close to atan(aLatMax/g) = 25 deg, i.e. it is the lean
 * the lateral loop is commanding, not a failure to control attitude. Flipping
 * earlier does not help and costs propellant: over 40 episodes, moving the
 * trigger from 3 s to 14 s of margin left the tilt at 19-21 deg throughout and
 * pushed impact speed from 12.1 m/s to 30.3 m/s. The Ship needs the align-then-
 * descend structure the booster has (slotX/slotH), sized for a vehicle whose
 * whole translation budget is a few hundred metres. That is the next build.
 *
 * Every number here is a first cut, measured only enough to pick the best of the
 * six trigger settings tried. */
/* WHY THE SHIP STILL DOES NOT LAND, STATED SO THE NEXT ATTEMPT DOES NOT REPEAT
 * THIS ONE. Median distance from the gate at the end, 80 episodes a stage:
 * stage 4 373 m, stage 5 563 m, stage 6 1323 m, catches 0.
 *
 * THE FLAPS ARE SATURATED ESSENTIALLY ALL THE TIME, so the commanded attitude is
 * not a command, it is a wish. The proof is that the gains do not matter: median
 * flop attitude error and tilt at the flip came out IDENTICAL to a tenth of a
 * degree across six configurations spanning zero to sixty degrees of bank and a
 * 4.5x range of stiffness. Once the mixer scales rather than clamps (which it now
 * does, and which is the right fix), the output is by construction invariant to
 * the magnitude of the requested torque whenever it saturates — only the
 * direction survives. The 12.9 degree flop error is the aerodynamic trim the
 * vehicle settles at, not a set point being held.
 *
 * Consequences, all measured rather than argued:
 *   - The flop steers (offset closes 296 -> 131 m) but cannot hold an attitude,
 *     so it arrives at the flip already 15-25 degrees off.
 *   - The flip is torque-limited: 90 degrees takes 6.6 s at one engine on the
 *     throttle floor and 2.9 s at two engines full, against a 3 s budget. More
 *     thrust finishes it sooner but throws the vehicle further sideways while it
 *     is still lying over, and measured, that trade is a loss (373 m at rung 1 /
 *     0.4 throttle against 678 m at rung 2 / full).
 *   - A cross-product attitude error goes to zero at 180 degrees, so once tilt
 *     passes 90 the flip gets WEAKER the worse it gets. Traced: 93 -> 116 -> 153.
 *
 * So the next attempt should not tune these numbers. It should either command an
 * attitude near the aerodynamic trim the flaps can actually bias, or use a
 * quaternion error that does not weaken past 90 degrees, or accept that this
 * airframe needs the engines lit far earlier than a hover-slam wants them. */
const SHIP = {
    on: true,
    flipTime: 7.0,     // s the flip is expected to take (measured: 6.8 s at 1 engine x 0.4)
    flipMargin: 1.35,  // safety factor on (stopping height + flip height)
    qFlap: 60,         // Pa below which the flaps cannot do anything anyway
    kpFlop: 0.55,      // attitude stiffness during the flop
    kdFlop: 1.6,       // attitude damping during the flop
    /* MEASURED, stage 4, 50 episodes, median offset still to fly at ignition:
     *
     *     bankMax   kpBank    residual   sink at ignition
     *      0 deg    0.004      296 m       --
     *     45 deg    0.004      156 m       89 m/s
     *     60 deg    0.004      131 m       89 m/s   <- taken
     *     60 deg    0.010      291 m       82 m/s
     *     85 deg    0.010      313 m       82 m/s
     *
     * The steering is real and monotonic in the cap. The kpBank rows are the
     * interesting failure: a higher gain saturates the pitch early, the plate goes
     * edge-on, its drag collapses, and the vehicle falls faster with less time to
     * translate — so it closes LESS by trying harder. The authority is bounded by
     * having to keep enough plate in the airflow to stay slow.
     *
     * It is still not enough. 131 m of residual arriving at 89 m/s is more than
     * the landing burn can absorb, and stage 4 remains 0/50. */
    noApproach: true,  // the Ship skips the booster hover-slam and goes straight to the settle
    /* THE FLIP IS TORQUE-LIMITED AND THE BUDGET SAYS SO. Ixx is 43.2e6 kg m2 and
     * the gimbal arm is 22.1 m at 15 deg, so a 90 degree flip takes:
     *
     *     1 engine at 0.40   6.6 s   falls 486 m
     *     1 engine at 1.00   4.2 s   falls 307 m
     *     2 engines at 1.00  2.9 s   falls 217 m
     *     3 engines at 1.00  2.4 s   falls 177 m
     *
     * against a flipTime budget of 3 s. At the throttle floor on one engine the
     * rotation simply cannot finish, which is what the traces showed: tilt going
     * 93 -> 149 degrees instead of 93 -> 0. More thrust is the counter-intuitive
     * answer — a faster flip spends LESS total sideways impulse than a slow one,
     * because the vehicle is only mispointed for half as long. */
    flipRung: 1,       // engine group used to drive the flip
    flipThr: 0.4,      // throttle during the flip
    litTilt: 0.44,     // rad of tilt within which the engines may light (25 deg)
    kpFlip: 1.2,       // rad/s of slew rate demanded per rad of attitude error
    wMaxFlip: 0.45,    // rad/s cap on the commanded slew rate (not the binding limit; see note)
    kdFlip: 2.2,       // inner-loop rate gain during the flip
    latAllow: 0,       // fraction of the lateral-closure time bought as flip height (0 = off)
    aLatShip: 5.0,     // m/s2 of lateral authority assumed when sizing that time
    kpBank: 0.06,      // rad of pitch per (m/s) of closing-speed error
    vLatMax: 25,       // m/s cap on the commanded closing speed
    kdBank: 0.06,      // rad per m/s of closing speed
    bankMax: 1.047     // rad (60 deg), cap on the pitch (0 = belly flat, no steering)
};
const _flapBias = new Float64Array(4);

const ROLL = {
    kRoll: 1.4703981832804778,  // 1/s, roll-rate damping: tauZ = -Izz * kRoll * w_z (0 = off)
    qFin: 68.3892706081329,   // Pa, below this the fins do nothing and the Jacobian is noise
    /* EARNED, stage 2, 60 episodes of the report bank: finAtt 0 caught 23/60 with
     * a median across error of 100.1 m at the 554 m handover; finAtt 1 caught
     * 27/60 with 70.0 m. The fins cannot fix the whole error — see the coast AoA
     * cap, which was set when nothing could act on it — but they are the only
     * actuator the vehicle has above the ignition point and they were idle. */
    finAtt: 1.0,      // fraction of the attitude demand the fins fly while COASTING (0 = off)
    /* EARNED. Bank 777000, 120 episodes x 4 stages, catches out of 120 and the
     * combined tumble+breakup count on stages 2 and 3:
     *
     *     qSoft   pow    s0   s1   s2   s3   lost
     *     off (fins parked) 52   86   66   49    15
     *     0 (flat command)  69   88   70   48    23
     *     15000   1.0       70   90   68   54    18   <- taken
     *     3000    1.0       68   90   68   46    16
     *
     * The flat command and the taper catch the same on stages 0-2; the difference
     * is stage 3, where the air is thickest and the flat command was throwing the
     * vehicle away. Note the bottom row: taper too early and stage 3 falls back to
     * the flat number, because then the fins are being switched off exactly where
     * the long supersonic coast needs them. */
    /* SPEED BRAKE: BUILT, MEASURED, NOT WORTH IT. Half of stage 3's failures run
     * the tank dry, so bleeding energy aerodynamically before ignition looked like
     * free propellant. Bank 777000, 90 episodes a stage, catches:
     *
     *     finBrake    s0   s1   s2   s3
     *      0 deg      54   66   49   38
     *      8 deg      55   68   50   38
     *     16 deg      55   64   48   36
     *     28 deg      56   68   49   34
     *
     * Flat, then slightly negative. Three fins is not enough surface to both steer
     * the coast and brake it, and the coast steering is worth more. Kept behind a
     * zero default because the bias plumbing is what exposed the mixer bug. */
    finBrake: 0,      // rad of symmetric fin deflection used as a speed brake (0 = off)
    vBrake: 120,      // m/s below which the brake retracts
    vBrakeRamp: 80,   // m/s over which it comes fully out
    qSoft: 15000,     // Pa, dynamic pressure above which the fin demand tapers (0 = flat)
    qFadePow: 1.0,    // exponent of the taper
    hAoA: 0,          // m above the rails over which the terminal tilt cap tapers (0 = flat cap)
    aoaLo: 1.6616229630443584   // rad, the cap AT the rails (defaults to K.aoaMax = no-op)
};

/* The fin mixer, measured rather than derived: perturb each fin, ask aero.js for
 * the moment it makes, and invert. Three fins in a T do not mix symmetrically, so
 * a hand-written allocation gets the cross-coupling wrong; this cannot, because
 * it asks the same model that will apply the force. Extended to three axes from
 * the two in vtest/slam.js, since roll is the whole point here. */
let _model = null, _mtype = null, _scratch = null;
const _vbF = new Float64Array(3);
function finCommand(w, tauX, tauY, tauZ, out, bias) {
    const ty = w.type;
    if (!ty.fins.length) return;
    if (_mtype !== ty) { _model = new AERO.AeroModel(ty); _scratch = new V.Actuators(ty); _mtype = ty; }
    const air = ATM.airAt(Math.max(0, w.p[2]));
    M.qrotInv(_vbF, w.q, w.v);          // a Jacobian, not a force: wind is irrelevant here
    /* Linearise about the SPEED-BRAKE bias, not about flush. A grid fin is draggy
     * in its own right and its moment slope depends on how far out it already is,
     * so a Jacobian taken at zero describes a surface the vehicle is not flying. */
    const b0 = bias || 0;
    _scratch.fin.fill(b0); _scratch.throttle = 0; _scratch.stage = 0;
    const base = _model.compute(_vbF, w.w, w.mp.com, air, _scratch);
    const m0 = [base.mx, base.my, base.mz];
    const d = 8 * DEG, n = ty.fins.length;
    const A = [[], [], []];             // A[axis][fin] = d(moment)/d(deflection)
    for (let i = 0; i < n; i++) {
        _scratch.fin[i] = b0 + d;
        const r = _model.compute(_vbF, w.w, w.mp.com, air, _scratch);
        A[0][i] = (r.mx - m0[0]) / d; A[1][i] = (r.my - m0[1]) / d; A[2][i] = (r.mz - m0[2]) / d;
        _scratch.fin[i] = b0;
    }
    /* Minimum-norm u with a ridge: u = A^T (A A^T + lambda I)^-1 tau. The ridge is
     * not optional — near the rails q is tiny, every entry of A goes to zero and
     * the unregularised inverse is a division by noise that saturates all three
     * fins. Scaled by the Jacobian's own magnitude so it means the same thing at
     * 50 kPa and at 50 Pa. */
    const G3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let scale = 0;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        let s = 0; for (let i = 0; i < n; i++) s += A[r][i] * A[c][i];
        G3[r][c] = s; if (r === c) scale += s;
    }
    const lam = 1e-4 * scale + 1e-9;
    for (let r = 0; r < 3; r++) G3[r][r] += lam;
    /* CANCEL THE BIAS, NOT THE AIRFRAME.
     *
     * m0 is the WHOLE aerodynamic moment at the linearisation point, and most of
     * it is the airframe's own tail-first stability, which is the vehicle helping.
     * Subtracting all of m0 asks the fins to cancel that too — measured, it takes
     * stage 2 from 49/90 to 23/90 and stage 3 from 38/90 to 13/90. The attitude
     * PD is a control INCREMENT and belongs on top of natural stability.
     *
     * What genuinely has to be cancelled is only the couple the speed-brake bias
     * itself introduces, because that one is self-inflicted: three fins in a T
     * share no symmetry, so a 20 deg symmetric deflection is a large moment, and
     * leaving it uncancelled tumbled every stage-3 episode through 67 deg/s inside
     * eight seconds. So difference the two: the moment at the bias minus the
     * moment at flush is exactly the bias's own contribution, airframe removed. */
    let bx = 0, by = 0, bz = 0;
    if (b0 !== 0) {
        _scratch.fin.fill(0);
        const flush = _model.compute(_vbF, w.w, w.mp.com, air, _scratch);
        bx = m0[0] - flush.mx; by = m0[1] - flush.my; bz = m0[2] - flush.mz;
        _scratch.fin.fill(b0);
    }
    const tau = [tauX - bx, tauY - by, tauZ - bz];
    const s = solve3(G3, tau);
    if (!s) return;
    /* Same proportional scaling as the flap mixer — see the note there. */
    const uf = new Array(n);
    let ovf = 1;
    for (let i = 0; i < n; i++) {
        uf[i] = A[0][i] * s[0] + A[1][i] * s[1] + A[2][i] * s[2];
        const need = Math.abs(b0 + uf[i]) / ty.fins[i].maxDefl;
        if (need > ovf) ovf = need;
    }
    for (let i = 0; i < n; i++) {
        out[4 + i] = M.clamp((b0 + uf[i] / ovf) / ty.fins[i].maxDefl, -1, 1);
    }
}

/* Gaussian elimination with partial pivoting on a 3x3. */
function solve3(Ain, b) {
    const a = [Ain[0].slice(), Ain[1].slice(), Ain[2].slice()], y = b.slice();
    for (let c = 0; c < 3; c++) {
        let p = c;
        for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
        if (Math.abs(a[p][c]) < 1e-18) return null;
        if (p !== c) { const t = a[p]; a[p] = a[c]; a[c] = t; const ty2 = y[p]; y[p] = y[c]; y[c] = ty2; }
        for (let r = c + 1; r < 3; r++) {
            const f = a[r][c] / a[c][c];
            for (let k = c; k < 3; k++) a[r][k] -= f * a[c][k];
            y[r] -= f * y[c];
        }
    }
    const x = [0, 0, 0];
    for (let r = 2; r >= 0; r--) {
        let s = y[r];
        for (let k = r + 1; k < 3; k++) s -= a[r][k] * x[k];
        x[r] = s / a[r][r];
    }
    return x;
}
const K = Object.assign({}, GOLD.GAINS, TEACHER_GAINS);

/* Can the rails still be reached from here? Deliberately OPTIMISTIC — it uses
 * the full engine ladder and ignores the throttle floor — because the cost of
 * wrongly saying "still feasible" is one slightly stale label, while wrongly
 * saying "give up" abandons a catch the vehicle could have made and teaches the
 * student to abandon it too. Bias toward claiming reachability, so that a
 * negative answer is trustworthy. */
function catchFeasible(w) {
    const ty = w.type, LAD = ty.engineLadder, T1 = V.RAPTOR.thrust;
    const aimZ = V.TOWER.armZ - ty.catchPinZ;
    const h = w.p[2] - aimZ;
    const v = -w.v[2];
    if (h < -5) return { ok: false, why: "below the rails" };

    const m = w.mp.m;
    const aMax = (LAD[LAD.length - 1] * T1) / m - G;
    if (aMax <= 0.2) return { ok: false, why: "cannot arrest at any throttle" };

    // stopping distance from the current descent rate, with 15% of margin
    const stop = (v * v) / (2 * aMax);
    if (v > 0 && stop > h * 1.15) return { ok: false, why: "not enough height to stop" };

    // propellant: the burn needs roughly dv = v + g*t_burn worth of impulse
    const tBurn = v / Math.max(0.5, aMax);
    const dv = v + G * tBurn;
    const mdot = LAD[LAD.length - 1] * V.RAPTOR.mdot;
    const need = mdot * tBurn * 0.55;      // optimistic: mid-ladder, not full
    if (w.prop < need) return { ok: false, why: "not enough propellant" };
    void dv;

    // lateral: can the across-arm error be flown out in the time left?
    const across = Math.abs(w.tel.pinX - V.TOWER.gateX);
    const tLeft = h > 0 ? Math.max(0.5, h / Math.max(1, 0.5 * (v + K.vTouch))) : 0.5;
    const closable = 0.5 * K.aLatMax * tLeft * tLeft * 1.5;   // optimistic
    if (across > closable + V.TOWER.capture.across) return { ok: false, why: "cannot close the across-arm error in time" };

    /* ATTITUDE RECOVERABILITY, which the first version of this omitted and
     * which is where the labelling trap actually bites here. A student that has
     * drifted to 36 degrees of tilt with rate on it may be past what a slow
     * attitude loop can null before the rails — and "keep steering to the gate"
     * is then a label for something unachievable, the exact class of
     * contradiction that makes on-policy validation collapse while training
     * accuracy stays high. The attitude loop's closed-loop time constant is
     * roughly kdAtt/kpAtt; if the time left is shorter than the time needed to
     * bring the tilt back inside the capture tolerance, the catch is gone. */
    const tau = K.kdAtt / Math.max(1e-3, K.kpAtt);
    const tiltErr = Math.max(0, w.tel.tilt - V.TOWER.capture.tilt);
    const tSettle = tau * Math.log(1 + tiltErr / Math.max(1e-3, V.TOWER.capture.tilt));
    const tToRails = h > 0 ? h / Math.max(1, 0.5 * (v + K.vTouch)) : 0;
    if (tiltErr > 0 && tSettle > tToRails * 1.2) return { ok: false, why: "cannot null the tilt before the rails" };

    return { ok: true };
}

/* The golden control law, with its aim point supplied rather than assumed, and
 * every latch read from the world. Everything here is a pure function of
 * (world, aim). */
const _vw = new Float64Array(3);
const _ax = new Float64Array(3);
const _errW = new Float64Array(3);
const _errB = new Float64Array(3);

/* ------------------------------------------------------ the Ship's flaps ---
 *
 * FOUR CONTROL SURFACES THAT HAVE NEVER BEEN MOVED. `out.fill(0)` maps, through
 * applyControl, to the MIDPOINT of each flap's 5-80 degree travel, so every Ship
 * episode ever flown by this teacher was a belly-flop with all four flaps pinned
 * half open. It crashes 195 of 200 on stage 4. That is not a tuning result; the
 * vehicle's only actuator above the landing burn was inert.
 *
 * Same measured-Jacobian trick as the fins, with two differences. Four surfaces
 * against three axes is underdetermined rather than square, so the minimum-norm
 * solution is the one that spreads the demand. And the command mapping is not
 * symmetric — a flap runs minDefl..maxDefl, with o = 0 at the middle — so the
 * solution is a DELTA about the current commanded position and has to be mapped
 * back through that affine range rather than divided by a maximum. */
const _vbP = new Float64Array(3);
function flapCommand(w, tauX, tauY, tauZ, out, bias) {
    const ty = w.type, n = ty.flaps.length;
    if (!n) return;
    if (_mtype !== ty) { _model = new AERO.AeroModel(ty); _scratch = new V.Actuators(ty); _mtype = ty; }
    const air = ATM.airAt(Math.max(0, w.p[2]));
    M.qrotInv(_vbP, w.q, w.v);
    _scratch.throttle = 0; _scratch.stage = 0;
    /* Linearise about the trim the flaps are actually being asked to hold, not
     * about zero: the Jacobian of a drag brake depends strongly on how far open
     * it already is. */
    for (let i = 0; i < n; i++) _scratch.flap[i] = bias[i];
    const base = _model.compute(_vbP, w.w, w.mp.com, air, _scratch);
    const m0 = [base.mx, base.my, base.mz];
    const d = 6 * DEG;
    const A = [[], [], []];
    for (let i = 0; i < n; i++) {
        const f = ty.flaps[i];
        const probe = Math.min(f.maxDefl, bias[i] + d);
        const step = probe - bias[i] || 1e-6;
        _scratch.flap[i] = probe;
        const r = _model.compute(_vbP, w.w, w.mp.com, air, _scratch);
        A[0][i] = (r.mx - m0[0]) / step; A[1][i] = (r.my - m0[1]) / step; A[2][i] = (r.mz - m0[2]) / step;
        _scratch.flap[i] = bias[i];
    }
    const G3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let scale = 0;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        let s = 0; for (let i = 0; i < n; i++) s += A[r][i] * A[c][i];
        G3[r][c] = s; if (r === c) scale += s;
    }
    const lam = 1e-4 * scale + 1e-9;
    for (let r = 0; r < 3; r++) G3[r][r] += lam;
    const s = solve3(G3, [tauX, tauY, tauZ]);   // see the note in finCommand: do not cancel the airframe
    if (!s) return;
    /* SCALE THE WHOLE SOLUTION, NEVER CLAMP ITS COMPONENTS.
     *
     * At low dynamic pressure every entry of A goes toward zero, the solution blows
     * up, and clamping each flap independently lands on the SAME saturated pattern
     * whatever torque was requested. The signature is unmistakable and was measured
     * three times before it was believed: median flop attitude error 15.4 deg and
     * tilt at the flip 107 deg, identical to a tenth of a degree across six
     * configurations including zero bank and doubled gains. A controller whose
     * gains do not matter is not a controller.
     *
     * Scaling preserves the DIRECTION of the commanded moment and only gives up
     * magnitude, which is the correct thing to concede when the surfaces cannot
     * deliver what was asked. */
    const u = new Array(n);
    let over = 1;
    for (let i = 0; i < n; i++) {
        const f = ty.flaps[i];
        u[i] = A[0][i] * s[0] + A[1][i] * s[1] + A[2][i] * s[2];
        const room = u[i] >= 0 ? (f.maxDefl - bias[i]) : (bias[i] - f.minDefl);
        const need = Math.abs(u[i]) / Math.max(1e-6, room);
        if (need > over) over = need;
    }
    for (let i = 0; i < n; i++) {
        const f = ty.flaps[i];
        const cmd = M.clamp(bias[i] + u[i] / over, f.minDefl, f.maxDefl);
        out[4 + i] = M.clamp(2 * (cmd - f.minDefl) / (f.maxDefl - f.minDefl) - 1, -1, 1);
    }
}

/* THE BELLY-FLOP IS NOT A DESCENT, IT IS AN ATTITUDE.
 *
 * The booster law asks "where should the thrust point" and drives the body there.
 * A flopping Ship has no thrust and does not want to point anywhere near
 * retrograde — it wants to lie broadside to the airflow, because that is what
 * makes the drag that keeps it at 70 m/s instead of 300. Running the booster's
 * angle-of-attack clamp on it actively commands the wrong thing: the clamp pulls
 * the body TOWARD the relative wind, which is the flop folding into a dive.
 *
 * So the flop gets its own target frame. The long axis lies horizontal, pointed
 * at the aim so what steering the flaps can manage is spent going somewhere; the
 * tiled belly (body +X) faces down into the wind. Both are held by the flaps. */
const _ax2 = new Float64Array(3), _exd = new Float64Array(3), _eyd = new Float64Array(3), _ezd = new Float64Array(3);
const _qd = new Float64Array(4), _qe = new Float64Array(4), _qc = new Float64Array(4);
function flopAttitude(w, out, aim) {
    const ty = w.type;
    /* Desired basis: body Z (long axis) horizontal toward the aim, body X down. */
    let dx = aim.x - w.p[0], dy = aim.y - w.p[1];
    const dl = Math.hypot(dx, dy);
    if (dl > 1e-3) { dx /= dl; dy /= dl; } else { dx = 1; dy = 0; }

    /* A BELLY-DOWN FLOP CANNOT STEER, AND THE FIRST VERSION OF THIS DID NOT.
     *
     * Lying flat with the tiles straight down puts the whole aerodynamic normal
     * force straight up: maximum drag, zero horizontal command. Measured over ten
     * stage-4 episodes, the flop closed a median of 209 m of the offset — but
     * three of the ten moved AWAY from the tower, by up to 234 m, and the
     * remaining offset at ignition ranged from 30 m to 731 m. That is not
     * steering, it is whatever the spawn velocity happened to do.
     *
     * So the plate is PITCHED. Rotating the whole belly-down frame about the
     * horizontal axis perpendicular to the run-in tilts the normal force, and the
     * component that appears along the ground track is the only lateral authority
     * this vehicle has before its engines light. Nose down toward where it wants
     * to go, exactly as a skydiver tracks. The pair stays orthonormal by
     * construction — both basis vectors are rotated by the same angle. */
    /* TRACK A CLOSING SPEED, NOT A POSITION ERROR.
     *
     * Banking on the distance remaining saturates instantly — 0.004 rad/m against
     * 400 m of offset asks for 1.6 rad — so the vehicle banks hard over for the
     * whole descent, accelerates the entire way in, and only reverses when the
     * error finally shrinks. By then it is far too late: it reached the flip
     * doing 53 m/s sideways and ended the episode 586 m past the tower, and the
     * settle's bounded 4.6 m/s^2 has no chance of arresting that in the height
     * left. The flop was steering like something with brakes it does not have.
     *
     * So command the speed it could still stop from — sqrt(2 a e), the same
     * braking profile the booster's vertical channel uses — and bank on the error
     * in THAT. Far out it asks for a lot of closing speed and banks hard; as the
     * offset shrinks the target speed falls and the bank reverses in time. */
    const eAlong = dl;                                     // m still to travel
    const vAlong = w.v[0] * dx + w.v[1] * dy;              // closing speed along it
    const vWantLat = Math.min(SHIP.vLatMax, Math.sqrt(2 * SHIP.aLatShip * Math.max(0, eAlong)));
    const bank = M.clamp(SHIP.kpBank * (vWantLat - vAlong), -SHIP.bankMax, SHIP.bankMax);
    const cb = Math.cos(bank), sb = Math.sin(bank);

    /* BANK ABOUT THE LONG AXIS; DO NOT PITCH IT.
     *
     * Steering by pitching the nose toward the target does aim the normal force
     * correctly — the force is opposite the belly, so the nose must drop — but it
     * leaves the vehicle at 150 degrees of tilt at the end of the flop, and the
     * flip then has to rotate through 150 degrees instead of 90. Traced, that is
     * exactly what went wrong: tilt drifted 93 -> 115 through the flop and the
     * powered flip could not recover it, reaching 138 degrees by impact.
     *
     * So lay the long axis ACROSS the ground track and roll about it instead. The
     * belly still tilts away from the target, so the normal force still drives the
     * translation, but the long axis stays horizontal throughout, the flip is
     * always the same 90 degrees, and the two basis vectors are orthogonal by
     * construction rather than by trigonometric luck. */
    const sx = -dy, sy = dx;                              // horizontal, across the track
    _ezd[0] = sx; _ezd[1] = sy; _ezd[2] = 0;              // long axis, level, across the run-in
    _exd[0] = -dx * sb; _exd[1] = -dy * sb; _exd[2] = -cb; // belly: down, tilted away from the target
    _eyd[0] = _ezd[1] * _exd[2] - _ezd[2] * _exd[1];
    _eyd[1] = _ezd[2] * _exd[0] - _ezd[0] * _exd[2];
    _eyd[2] = _ezd[0] * _exd[1] - _ezd[1] * _exd[0];
    M.qFromBasis(_qd, _exd, _eyd, _ezd);

    /* Attitude error as a rotation, so all three axes are controlled — an axis
     * alignment alone would leave the roll that decides which face is windward. */
    _qc[0] = -w.q[0]; _qc[1] = -w.q[1]; _qc[2] = -w.q[2]; _qc[3] = w.q[3];
    M.qmul(_qe, _qc, _qd);
    const sgn = _qe[3] < 0 ? -1 : 1;
    const ex = 2 * sgn * _qe[0], ey = 2 * sgn * _qe[1], ez = 2 * sgn * _qe[2];   // body-frame error vector

    const I = w.mp, kp = SHIP.kpFlop, kd = SHIP.kdFlop;
    return [I.Ixx * (kp * ex - kd * w.w[0]),
            I.Ixx * (kp * ey - kd * w.w[1]),
            I.Izz * (kp * ez - kd * w.w[2])];
}

/* The flip itself: drive the long axis to vertical, on the flaps, engines cold.
 * The roll about that axis is left free — nothing downstream cares which face is
 * forward once the vehicle is upright, and spending scarce flap authority on it
 * would slow the rotation that is the whole point of the phase. */
function uprightAttitude(w) {
    /* A CROSS-PRODUCT ATTITUDE ERROR IS THE WRONG TOOL FOR A 90 DEGREE FLIP.
     *
     * Its magnitude is sin(theta): it peaks at 90 degrees and falls back to ZERO
     * at 180, so a vehicle that has rolled past broadside is pushed less and less
     * the further it goes, and one that ends up inverted is not pushed at all.
     * Traced on a Ship whose flop delivered it at 116 degrees, that is exactly the
     * divergence observed — 116 -> 131 -> 150 -> 153 while the gimbal saturated
     * and reversed trying to hold it. The booster never meets this because it is
     * always within a few degrees of its target.
     *
     * The quaternion error is monotone over the whole range, so it keeps pushing
     * the right way from any attitude. Same construction the flop uses. */
    /* POINT THE AXIS. DO NOT COMMAND A FRAME.
     *
     * A full attitude target needs a second reference direction to pin roll, and
     * the obvious one — the horizontal projection of the body axis — VANISHES
     * exactly where the flip is trying to arrive. Near vertical it is ill
     * conditioned, the commanded frame spins, and the error becomes noise. Traced,
     * that is precisely the failure: the flip works, tilt 89 -> 57 degrees, and
     * then the gimbal command decays to nothing at the bottom and the vehicle
     * comes back to 64. It was not running out of authority. It was losing its
     * setpoint.
     *
     * It also imposes a roll target a centre-mounted gimbal cannot achieve, and
     * since the rate demand is scaled by the TOTAL error magnitude, that
     * unachievable roll component was stealing authority from the pitch that
     * matters. The flip does not care about roll at all.
     *
     * So command the AXIS: rotate by theta about the unit vector a x z. That is
     * monotone all the way to 180 degrees, is well conditioned everywhere except
     * exactly inverted, and carries no roll term at all. */
    w.axis(_ax2);
    const cx = _ax2[1], cy = -_ax2[0], cz = 0;             // a x zHat
    const sMag = Math.hypot(cx, cy), cDot = M.clamp(_ax2[2], -1, 1);
    const theta = Math.atan2(sMag, cDot);
    if (sMag > 1e-9) {
        _exd[0] = (cx / sMag) * theta; _exd[1] = (cy / sMag) * theta; _exd[2] = cz;
    } else { _exd[0] = 0; _exd[1] = 0; _exd[2] = 0; }
    M.qrotInv(_eyd, w.q, _exd);
    const ex = _eyd[0], ey = _eyd[1], ez = 0;              // roll is not commanded

    /* A PD ON ANGLE CANNOT SLEW NINETY DEGREES. IT BRAKES HARDER THAN IT PUSHES.
     *
     * With Ixx 43.2e6 and kd 2.2, the damping term alone asks for 9.5 MN m at six
     * degrees per second and 28.5 at seventeen — while the gimbal can supply 6.3
     * MN m on one engine at the throttle floor and 31.5 on two at full. So the
     * moment the vehicle starts rotating, its own controller commands maximum
     * counter-torque, and the rotation never develops. That is why every flip
     * configuration tried, across engine groups, throttles and time budgets, left
     * the Ship broadside at impact — terminal tilt 69 to 98 degrees — and why it
     * failed identically from a 10 m spawn offset as from 500 m. The flip was
     * never a translation problem. It was a controller braking against itself.
     *
     * The fix is the standard cascade: turn the attitude error into a RATE demand,
     * limit that rate to something the actuator can also stop, and let the inner
     * loop drive the rate error. Far from the target it asks for the full slew
     * rate and pushes with everything available; near it the demand tapers and the
     * same expression becomes the damping it used to be. */
    const I = w.mp, kp = SHIP.kpFlip, kd = SHIP.kdFlip, wMax = SHIP.wMaxFlip;
    const emag = Math.hypot(ex, ey, ez);
    const scale = (emag > 1e-9 && kp * emag > wMax) ? wMax / (kp * emag) : 1;
    const wx = kp * ex * scale, wy = kp * ey * scale, wz = kp * ez * scale;
    return [I.Ixx * kd * (wx - w.w[0]),
            I.Ixx * kd * (wy - w.w[1]),
            I.Izz * kd * (wz - w.w[2])];
}

function law(w, out, aim, wantCatch) {
    out.fill(0);
    const ty = w.type, LAD = ty.engineLadder, T1 = V.RAPTOR.thrust;
    const m = w.mp.m, tel = w.tel;

    /* ---- the Ship, while it is still flopping ---------------------------- */
    if (ty.flaps.length && SHIP.on) {
        const hShip = w.p[2] - aim.z;
        const vShip = -w.v[2];
        /* Flip when the height left no longer comfortably covers arresting the
         * fall PLUS the seconds the flip itself eats. Both terms are computed,
         * not guessed: the burn from the full ladder against the current mass,
         * and the ignition dead time the engines actually have. */
        const aShipMax = (LAD[LAD.length - 1] * T1) / m - G;
        const hStop = aShipMax > 0.5 ? (vShip * vShip) / (2 * aShipMax) : 1e9;
        const hFlip = vShip * (SHIP.flipTime + V.RAPTOR.ignitionDelay + 2 * V.RAPTOR.spoolTau);
        /* AND THE HEIGHT TO FLY OUT WHAT IS LEFT SIDEWAYS.
         *
         * A hover-slam lights as late as physically possible, which is right when
         * the only job is to stop. It is wrong here, because the Ship reaches
         * ignition still 131 m off across (the flop steers, but not enough) and a
         * burn that begins with no margin has no seconds to spend closing that.
         * The propellant is there — 269 m/s available on stage 4, 110 to arrest
         * 89 m/s, so 159 spare, against roughly 152 to fly 131 m at 5 m/s^2 and
         * hold itself up while doing it. It is affordable and it is tight, and it
         * only works if the burn STARTS with the budget in hand.
         *
         * So the trigger buys the time as height: how long the lateral closure
         * takes at the authority available, times how fast it is falling. */
        const offNow = Math.hypot(w.p[0] - aim.x, w.p[1] - aim.y);
        const tLat = 2 * Math.sqrt(Math.max(0, offNow) / Math.max(0.5, SHIP.aLatShip));
        const hLat = SHIP.latAllow * vShip * tLat;
        const flopping = hShip > (hStop + hFlip + hLat) * SHIP.flipMargin;
        /* THE FLIP IS A PHASE, NOT AN INSTANT.
         *
         * Ending the flop and starting the burn in the same tick lights three
         * engines while the vehicle is still lying over, and a thrust vector that
         * is mostly horizontal does exactly what it says: traced tick by tick, the
         * Ship left the flop at 579 m doing 30 m/s sideways — the flop having
         * bled that down from 78 — and then, engines lit and body axis still 55
         * degrees off vertical, accelerated to 142 m/s sideways by 64 m. It was
         * not being steered away from the tower, it was being launched.
         *
         * So the rotation gets its own phase, flown on the flaps with the engines
         * cold, and thrust is withheld until the body is within litTilt of upright.
         * The trigger above already pays for the seconds this takes (flipTime). */
        const uprightErr = tel.tilt;
        if (flopping || uprightErr > SHIP.litTilt) {
            const flipping = !flopping;
            const tau = flopping ? uprightAttitude(w) : flopAttitude(w, out, aim);
            if (tel.q > SHIP.qFlap) {
                for (let i = 0; i < ty.flaps.length; i++) _flapBias[i] = w.act.flapCmd[i];
                flapCommand(w, tau[0], tau[1], tau[2], out, _flapBias);
            }
            if (flipping) {
                /* THE FLIP IS POWERED, because it cannot be anything else.
                 *
                 * Withholding thrust until the body is upright sounds safe and is
                 * physically wrong: a belly-flop is the flat plate's STABLE
                 * orientation, and the flaps are being asked to rotate the vehicle
                 * out of the attitude the airflow is actively restoring. Measured,
                 * they cannot — gated on tilt with the engines cold, the Ship
                 * reached the ground with 14.9 t of its 15 t still aboard, having
                 * never lit at all, in every one of 54 configurations.
                 *
                 * A real flip is flown on the engines, and so is this one: light
                 * the smallest group at the throttle floor, which is enough gimbal
                 * authority to rotate and far too little thrust to fling the
                 * vehicle sideways while it is still lying over. The full landing
                 * demand waits until the body is within litTilt of upright. */
                const rung = Math.min(LAD.length - 1, SHIP.flipRung);
                out[1] = (rung + 0.5) / LAD.length * 2 - 1;
                out[0] = M.clamp(SHIP.flipThr, V.RAPTOR.minThrottle, 1) * 2 - 1;
                const Tn = w.act.thrust();
                if (Tn > 1e3) {
                    const rz = ty.engines[0].z - w.mp.com, gm = ty.engines[0].gimbal;
                    out[2] = M.clamp(Math.asin(M.clamp(tau[0] / (rz * Tn), -1, 1)) / gm, -1, 1);
                    out[3] = M.clamp(Math.asin(M.clamp(tau[1] / (rz * Tn), -1, 1)) / gm, -1, 1);
                }
            } else { out[0] = -1; out[1] = -1; }     // cold through the flop
            out[9] = wantCatch ? 1 : -1;
            return out;
        }
    }
    const h = w.p[2] - aim.z, v = -w.v[2];
    const vCap = Math.max(5, Math.abs(w.sc.v0[2]));       // from the scenario, not from memory
    const aHi = (k) => (LAD[k] * T1) / m - G;
    const aLo = (k) => (LAD[k] * T1 * V.RAPTOR.minThrottle) / m - G;

    /* ---- WHICH PHASE IS THIS? -------------------------------------------
     * Above hHand the vehicle still has energy to get rid of and the answer is
     * a braking plan; below it the answer is the settle. The switch is on
     * height alone and is read from the world, so it cannot drift out of step
     * with a student that is driving. */
    const aMaxTop = (LAD[LAD.length - 1] * T1) / m;
    /* THE SHIP MUST NOT ENTER THE BOOSTER APPROACH.
     *
     * The approach is a hover-slam sized for a booster, and two of its numbers are
     * catastrophic on a Ship. It hands over at 553 m, but the Ship lights at a
     * median 653 m — so the Ship arrives in the approach branch, not the settle.
     * And the approach caps lateral demand at aLatFrac * aMaxTop, a FRACTION OF
     * FULL THRUST ACCELERATION: a booster lights at TWR ~1.2, so that expression is
     * a few m/s^2, while the Ship lights three engines against 163 t at TWR 5.2 and
     * the same expression becomes 20.8 m/s^2 of commanded sideways acceleration.
     *
     * It shows exactly as that predicts. The flop delivers the vehicle 139 m from
     * the gate; the episode then ENDS 520 m away doing 58.8 m/s sideways, with 37
     * of 40 finishing beyond 100 m. It was never falling short. It was thrown.
     *
     * The Ship has no use for the approach in any case — the belly-flop is its
     * energy management and it reaches the flip already slow — so it goes straight
     * to the settle, whose lateral loop is a bounded PD with its own aLatMax. */
    const approach = (h > SLAM.hHand) && !(SHIP.noApproach && ty.flaps.length > 0);
    let aReq, forceLight = false, zemLateral = false;

    if (approach) {
        /* Terminal velocity from the same bisection the spawn uses, then the
         * closed-form thrust a given height demands:
         *   aT = g + g (v^2 - vHand^2) / (vt^2 (exp(2 g hb / vt^2) - 1))     */
        const vt = Math.max(20, SC.equilibriumSink(ty, Math.max(0, w.p[2]), m));
        const hb = Math.max(0, h - SLAM.hHand);
        const L = 2 * G * hb / (vt * vt);
        const den = Math.expm1(Math.min(40, L));
        /* HOW FAST TO ARRIVE AT THE HANDOVER DEPENDS ON HOW MUCH IS LEFT TO FIX.
         *
         * A one-at-a-time ablation of the four-stage search winner found that this
         * single number, not the tilt cap, is the stage 0 / stage 2 trade:
         *
         *                       stage 0    stage 2
         *     vHand 26.3        40/90      40/90
         *     vHand 34.5        61/90      29/90
         *
         * Both preferences are correct for the stage that holds them. Arriving
         * slower leaves more seconds below the handover to fly out an across-arm
         * error, which is what stage 2 is short of — its tower strikes reach the
         * handover 69 m off. Arriving faster spends less propellant and less time
         * hovering, which is what stage 0 wants, because its errors are already
         * small by then (23 m at handover on the episodes it catches).
         *
         * So schedule it on the error instead of picking a compromise that is
         * wrong for both: come in slow when there is a lot left to correct, fast
         * when there is not. vHandLo = vHandHi reproduces the fixed number. */
        const acrossNow = Math.abs(tel.pinX - V.TOWER.gateX);
        const fx = M.clamp(acrossNow / Math.max(1e-6, SLAM.xRef), 0, 1);
        const vHandEff = SLAM.vHand + (SLAM.vHandLo - SLAM.vHand) * fx;
        const vv = Math.max(0, v * v - vHandEff * vHandEff);
        let aT = den > 1e-9 ? G + G * vv / (vt * vt * den) : aMaxTop;

        /* An unpowered booster reaches ~340 m/s near the ground, which is over
         * the 65 kPa limit, so the airframe puts a floor under the burn. */
        const hA = Math.max(0, w.p[2] - Math.max(0, v) * K.qLook);
        const rhoA = ATM.airAt(hA).rho;
        if (rhoA > 1e-6) {
            const vLim = Math.sqrt(2 * K.qMargin * ty.qMax / rhoA);
            if (v > vLim) aT = Math.max(aT, G + K.kvz * (v - vLim));
        }
        aT = Math.min(aT, aMaxTop);

        /* Ignition on DISTANCE, including the dead time: a Raptor does not make
         * thrust when asked, and at 250 m/s the 450 ms spark delay plus spool is
         * 175 m of altitude spent on nothing. */
        if (!w.act.everLit) {
            const A = aMaxTop - G;
            const hBrake = A > 0.5 ? (vt * vt / (2 * G)) * Math.log(1 + G * vv / (vt * vt * A)) : 1e9;
            const hDead = v * (V.RAPTOR.ignitionDelay + 2 * V.RAPTOR.spoolTau);
            if (hb <= (hBrake + hDead) * (1 + SLAM.ignMargin)) forceLight = true;
        }
        aReq = aT - G;
        zemLateral = true;
    } else {
        let vWant = Math.max(K.vTouch, Math.min(vCap, K.slope * h));

        const tLeft = (w.sc.tMax || 60) - w.t;
        const tNeed = h / Math.max(1, K.slope * h) + K.tMargin;
        const propOK = w.prop > K.propReserve * (ty.propMax || 1);
        const across = Math.abs(tel.pinX - aim.x);
        if (wantCatch && h < K.slotH && across > K.slotX && tLeft > tNeed && propOK) vWant = 0;

        const hAhead = Math.max(0, w.p[2] - Math.max(0, v) * K.qLook);
        const rhoAhead = ATM.airAt(hAhead).rho;
        if (rhoAhead > 1e-6) vWant = Math.min(vWant, Math.sqrt(2 * K.qMargin * ty.qMax / rhoAhead));

        const calmV = M.clamp(1 - h / Math.max(1e-6, CALM.hCalm), 0, 1);
        const kvzEff = K.kvz + (vWant > 0 ? calmV * ((CALM.kvzCalm || K.kvz) - K.kvz) : 0);
        aReq = kvzEff * (v - vWant);
    }
    const calm = approach ? 0 : M.clamp(1 - h / Math.max(1e-6, CALM.hCalm), 0, 1);

    /* IGNITION AND ENGINE GROUP, DERIVED FROM THE VEHICLE. `everLit` and `stage`
     * are the vehicle's own record of what it has done; the teacher never keeps
     * its own copy, so its advice cannot drift out of step with the student. */
    const lit = !!w.act.everLit;
    const stage = w.act.stage | 0;
    let cand = LAD.length - 1;
    for (let k = 1; k < LAD.length; k++) if (aHi(k) * 0.92 >= aReq) { cand = k; break; }
    let cmd;
    if (!lit) {
        /* IN THE APPROACH THE DISTANCE TEST IS THE ONLY IGNITION RULE. Leaving
         * the settle rule — light once the demand clears the throttle floor —
         * active alongside it lights the engines high up, because the braking
         * law asks for barely more than hover while the vehicle is still high,
         * and barely more than hover clears a floor that is BELOW hover on two
         * engines. That is a hover, and the point of the law is that it never
         * asks for one. */
        cmd = approach ? (forceLight ? LAD.length - 1 : 0)
                       : ((aReq >= aLo(cand)) ? cand : 0);
    } else {
        cmd = Math.max(stage, cand);
        for (let k = 1; k < cmd; k++) if (aReq < aHi(k) * 0.85 && aReq >= aLo(k)) { cmd = k; break; }
        /* AND IF THE DEMAND IS BELOW EVEN THE SMALLEST GROUP'S FLOOR, STEP DOWN
         * ANYWAY — otherwise the vehicle is pinned on a group it cannot throttle
         * under and flies back up.
         *
         * The loop above only steps down to group k when the demand is at least
         * aLo(k), the acceleration that group gives at the throttle floor. When the
         * demand falls BELOW aLo(1) nothing matches, cmd stays wherever `stage`
         * already is, and three engines at 40% is TWR 1.25 on a nearly empty
         * booster — it climbs. Measured on stage 3, the episodes that run the tank
         * dry burn 59.4 s against the catches' 40.3, hover for 19.8 s against 6.0,
         * and CLIMB BACK 203 m after reaching their lowest point. The propellant is
         * not missing, it is being spent flying back up to a place the vehicle had
         * already reached. Below the floor the correct group is the smallest one. */
        if (aReq < aLo(1)) cmd = Math.min(cmd, 1);
    }

    /* LATERAL. During the approach the position error is hundreds of metres and
     * a PD clamped at a few m/s^2 has no arrival condition — it accelerates the
     * whole way in and overshoots. Zero-effort-miss on the burn's OWN duration
     * arrives with the velocity gone, and that duration comes from the same
     * integral as the braking distance. */
    let alx, aly;
    if (zemLateral) {
        const aT = G + Math.max(0, aReq);
        let tgo;
        if (aT > G + 0.5) {
            const vt2 = Math.max(20, SC.equilibriumSink(ty, Math.max(0, w.p[2]), m));
            tgo = (vt2 / Math.sqrt(G * (aT - G))) * Math.atan(v * Math.sqrt(G / (aT - G)) / vt2);
        } else tgo = h / Math.max(20, v);
        if (!lit) tgo += Math.max(0, h - SLAM.hHand) / Math.max(30, v);
        tgo = Math.max(1.0, tgo);
        alx = SLAM.zemK * (6 * (aim.x - tel.pinX) / (tgo * tgo) - 4 * w.v[0] / tgo);
        aly = SLAM.zemK * (6 * (aim.y - tel.pinY) / (tgo * tgo) - 4 * w.v[1] / tgo);
        const cap = SLAM.aLatFrac * aMaxTop, lm = Math.hypot(alx, aly);
        if (lm > cap) { alx *= cap / lm; aly *= cap / lm; }
    } else {
        /* A PD CANNOT HOLD STATION IN WIND, AND THE ARMS MEASURE STATION.
         *
         * With everything else fixed, the across term is now the whole remaining
         * failure: it fails 90% of stage-2 misses and 87% of stage-3 misses, on
         * its own in about 45% of them, at a median of 1.42 m against a 0.90 m
         * limit. It is not a targeting error — tightening the alignment hold from
         * 3.38 m to 0.40 m does drive the median down to 0.69 m, and takes stage 3
         * from 30/120 to 8/120, because holding to that tolerance costs more clock
         * and propellant than the vehicle has. The error is not that it aims badly.
         * It is that it cannot STAY there.
         *
         * Which is what a proportional-derivative loop does in a steady wind: it
         * settles wherever the proportional term generates exactly the tilt needed
         * to balance the drag, and that offset is proportional to the wind. The
         * evidence is in the stage ordering, because the stages are ordered by wind
         * and the catch rate is ordered inversely:
         *
         *     stage 0   wind 0.00-0.25   67%
         *     stage 1   wind 0.15-0.50   75%
         *     stage 2   wind 0.30-0.75   50%
         *     stage 3   wind 0.55-1.00   31%
         *
         * So the loop gets the integral term it always needed. Clamped hard, and
         * only in the settle: an integrator wound up during a 6 km approach would
         * arrive as a bias, which is the opposite of the point. */
        const ex = aim.x - tel.pinX, ey = aim.y - tel.pinY;
        if (K.kiPos > 0) {
            let I = w._tchI;
            if (!I) I = w._tchI = new Float64Array(2);
            /* Only integrate where the loop is actually trying to hold station,
             * and only when the error is small enough that this is trimming rather
             * than travelling — otherwise the approach's own error charges it. */
            if (h < K.hInt && Math.hypot(ex, ey) < K.xInt) {
                I[0] = M.clamp(I[0] + ex * DT_CTRL, -K.iMax, K.iMax);
                I[1] = M.clamp(I[1] + ey * DT_CTRL, -K.iMax, K.iMax);
            }
            /* The two axes are not the same problem: across is judged at 0.90 m
             * and along at 2.50 m, so the axis that needs the trim is the axis
             * that gets it, and the loose one keeps the PD it was stable with. */
            alx = K.kpPos * ex - K.kdPos * w.v[0] + K.kiPos * I[0];
            aly = K.kpPos * ey - K.kdPos * w.v[1] + K.kiPos * K.kiYFrac * I[1];
        } else {
            alx = K.kpPos * ex - K.kdPos * w.v[0];
            aly = K.kpPos * ey - K.kdPos * w.v[1];
        }
        const alm = Math.hypot(alx, aly);
        if (alm > K.aLatMax) { alx *= K.aLatMax / alm; aly *= K.aLatMax / alm; }
        if (calm > 0) {
            const keep = 1 - calm * (1 - CALM.calmLat);
            alx *= keep; aly *= keep;
        }
    }

    const az = G + Math.max(0, aReq);
    const nrm = Math.hypot(alx, aly, az);
    let nx = alx / nrm, ny = aly / nrm, nz = az / nrm;

    /* THE TILT CAP IS TWO DIFFERENT REQUIREMENTS WEARING ONE NUMBER.
     *
     * A four-stage search made the conflict explicit: raising K.aoaMax from 22 to
     * 42 degrees took stage 2 from 25% to 49% and stage 3 from 8% to 27%, and in
     * the same move dropped stage 0 from 59% to 36%. Both directions are right.
     * Far from the rails, tilt is the only way this vehicle translates and more of
     * it converts directly into across-error closed. AT the rails, tilt is the
     * error — the capture box allows 3.5 degrees — and a controller still willing
     * to bank 42 degrees a few metres up arrives leaning.
     *
     * So the cap is scheduled on height instead of arbitrated by a search. Full
     * authority while there is descent left to use it in, tapering to aoaLo at the
     * rails. aoaLo defaults to K.aoaMax, which reproduces the flat cap exactly, so
     * this is a no-op until the numbers below are earned. */
    const aoaTerm = (ROLL.hAoA > 0)
        ? ROLL.aoaLo + (K.aoaMax - ROLL.aoaLo) * M.clamp(h / ROLL.hAoA, 0, 1)
        : K.aoaMax;
    const aoaCap = approach ? SLAM.aoaMax : aoaTerm;
    const aoaMax = tel.q > 100 ? Math.min(aoaCap, (K.qaMargin * ty.qAlphaMax) / tel.q) : aoaCap;
    M.qrot(_vw, w.q, w._vb);
    const sp = Math.hypot(_vw[0], _vw[1], _vw[2]);
    if (sp > 20 && tel.q > 100) {
        const ux = -_vw[0] / sp, uy = -_vw[1] / sp, uz = -_vw[2] / sp;
        const ang = Math.acos(M.clamp(nx * ux + ny * uy + nz * uz, -1, 1));
        if (ang > aoaMax && ang > 1e-4) {
            const t = (ang - aoaMax) / ang, s = Math.sin(ang);
            const w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s;
            let cx = nx * w1 + ux * w2, cy = ny * w1 + uy * w2, cz = nz * w1 + uz * w2;
            const cn = Math.hypot(cx, cy, cz) || 1;
            nx = cx / cn; ny = cy / cn; nz = cz / cn;
        }
    }

    /* The setpoint filter. State lives on the WORLD, not in this module: `law` is
     * called once per control tick for whichever target is live, so a per-world
     * slot resets with the episode and cannot leak between them — and it keeps
     * the teacher's promise that nothing it remembers can drift out of step with
     * a student that is doing the flying. */
    if (!approach && SLEW.hSlew > 0) {
        const f = M.clamp(1 - h / SLEW.hSlew, 0, 1);          // 0 high up, 1 at the rails
        /* GEOMETRIC, not linear. Linear blending from a deliberately-unbinding
         * slewHi leaves the limit at 57 deg/s nine tenths of the way down, so it
         * only bites in the last metre and a 31-config sweep measured the median
         * gate rate identical to the control in every cell — an effect that is
         * exactly zero is a bug report, not a result. The limit spans decades, so
         * it has to be interpolated in the log. */
        const lim = SLEW.slewHi * Math.pow(Math.max(1e-4, SLEW.slewLo) / SLEW.slewHi, f);
        let prev = w._tchN;
        if (!prev) { prev = w._tchN = new Float64Array(3); prev[0] = nx; prev[1] = ny; prev[2] = nz; }
        const dot = M.clamp(prev[0] * nx + prev[1] * ny + prev[2] * nz, -1, 1);
        const ang = Math.acos(dot), maxAng = Math.max(0, lim) * DT_CTRL;
        if (ang > maxAng && ang > 1e-9) {
            const t = maxAng / ang, s = Math.sin(ang);
            const w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s;
            const cx = prev[0] * w1 + nx * w2, cy = prev[1] * w1 + ny * w2, cz = prev[2] * w1 + nz * w2;
            const cn = Math.hypot(cx, cy, cz) || 1;
            nx = cx / cn; ny = cy / cn; nz = cz / cn;
        }
        prev[0] = nx; prev[1] = ny; prev[2] = nz;
    }

    w.axis(_ax);
    _errW[0] = _ax[1] * nz - _ax[2] * ny;
    _errW[1] = _ax[2] * nx - _ax[0] * nz;
    _errW[2] = _ax[0] * ny - _ax[1] * nx;
    M.qrotInv(_errB, w.q, _errW);

    const I = w.mp.Ixx;
    const kdEff = K.kdAtt * (1 + calm * (CALM.calmKd - 1));
    const tauX = I * (K.kpAtt * _errB[0] - kdEff * w.w[0]);
    const tauY = I * (K.kpAtt * _errB[1] - kdEff * w.w[1]);

    if (cmd > 0) {
        out[1] = (cmd + 0.5) / LAD.length * 2 - 1;
        out[0] = M.clamp(m * nrm / (LAD[cmd] * T1), V.RAPTOR.minThrottle, 1) * 2 - 1;
    } else { out[0] = -1; out[1] = -1; }

    const T = w.act.thrust();
    if (T > 1e3) {
        const rz = ty.engines[0].z - w.mp.com;
        const gmax = ty.engines[0].gimbal;
        out[2] = M.clamp(Math.asin(M.clamp(tauX / (rz * T), -1, 1)) / gmax, -1, 1);
        out[3] = M.clamp(Math.asin(M.clamp(tauY / (rz * T), -1, 1)) / gmax, -1, 1);
    }

    /* THE COAST WAS FLOWN WITH NO ATTITUDE CONTROL AT ALL.
     *
     * Above, the gimbal is only written when there is thrust to gimbal — and on
     * the stages that fail worst there is no thrust for most of the descent.
     * Stage 2 lights at a median 1,324 m of a 6 km fall, stage 3 at 1,469 m of
     * 12 km. Everything above that was an unguided glide: `out.fill(0)` on the
     * fins, `T < 1e3` on the gimbal, so the vehicle had no actuator in the loop
     * and simply went wherever it was pointing.
     *
     * It shows in the across error, tracked down the descent by outcome. On the
     * stage-2 episodes that hit the tower, the vehicle reaches the 554 m handover
     * 69 m off across and is still 31 m off at the slot; the ones that miss
     * entirely are 191 m off at handover and 107 m at the slot. The terminal
     * controller is not failing to correct — it is being handed an error that no
     * amount of terminal authority can absorb in the height remaining.
     *
     * Grid fins exist precisely to fly that part of the descent, and the mixer
     * built for roll damping already solves all three axes. So when the engines
     * are cold the fins fly the SAME attitude command the gimbal would have
     * flown — which already contains the lateral guidance demand, and is already
     * q-alpha limited above, so opening this up cannot ask for a structurally
     * illegal angle. Under thrust the gimbal keeps pitch and yaw and the fins
     * fall back to roll alone, so the two never fight for the same axis. */
    if (ty.fins.length && tel.q > ROLL.qFin) {
        const tauZ = ROLL.kRoll > 0 ? -w.mp.Izz * ROLL.kRoll * w.w[2] : 0;
        const coasting = !(T > 1e3);
        /* FIN AUTHORITY IS NOT CONSTANT, SO THE DEMAND MUST NOT BE EITHER.
         *
         * A fin's moment goes with dynamic pressure, so the deflection that trims
         * the vehicle at 5 kPa is a violent input at 60 kPa. Commanding the full
         * attitude demand flat, the mixer saturates — peak fin command 1.00, all
         * travel — and stage 3 paid for it in exactly the way an over-driven
         * surface does, with breakups 5 -> 10 and tumbles 1 -> 3 over 120 episodes
         * while the catch count sat still at 46 -> 47. The steering was real; the
         * gain was wrong where the air is thick.
         *
         * So taper the demand above qSoft. The mixer already scales its solution by
         * the measured Jacobian, which handles the linear part; this handles what
         * that cannot, namely that near the structural limits the right amount of
         * control is less than the amount available. */
        const qFade = (ROLL.qSoft > 0 && tel.q > ROLL.qSoft)
            ? Math.pow(ROLL.qSoft / tel.q, ROLL.qFadePow) : 1;

        /* SPEED BRAKE. Half of what stage 3 loses, it loses to an empty tank: 50%
         * of its failures reach the ground with 0.0 t left, having lit at 1463 m
         * doing 299 m/s and impacted at 95 m/s. Every metre per second the fins
         * take out of the descent is a metre per second the engines do not have to
         * pay for, and grid fins are draggy in their own right — the aero model
         * carries a cd0 term for them along the local flow. The mixer was solving
         * for minimum-norm attitude control, which keeps them nearly flush, so
         * that drag was never being bought.
         *
         * Deployed only while coasting and only while fast: below vBrake there is
         * nothing left to shed and the deflection is just moment noise. */
        const vNow = -w.v[2];
        const brake = (coasting && ROLL.finBrake > 0 && vNow > ROLL.vBrake)
            ? ROLL.finBrake * M.clamp((vNow - ROLL.vBrake) / Math.max(1, ROLL.vBrakeRamp), 0, 1) : 0;
        if (coasting && ROLL.finAtt > 0) {
            const g2 = ROLL.finAtt * qFade;
            finCommand(w, g2 * tauX, g2 * tauY, tauZ * qFade, out, brake);
        } else if (tauZ !== 0 || brake > 0) finCommand(w, 0, 0, tauZ * qFade, out, brake);
    }
    out[9] = wantCatch ? 1 : -1;
    // legs, for the Ship on a pad landing
    if (ty.hasLegs && !wantCatch && h < 300) out[8] = 1;
    return out;
}

/* The teacher proper. Returns the label plus WHY it chose that goal, so the
 * collector can log how often it re-planned and how often nothing was left. */
function advise(w, out) {
    const cleared = !!w.catchAllowed;
    if (cleared) {
        const f = catchFeasible(w);
        if (f.ok) {
            law(w, out, { x: V.TOWER.gateX, y: V.TOWER.gateY, z: V.TOWER.armZ - w.type.catchPinZ }, true);
            return "catch";
        }
    }
    const gt = w.sc.groundTarget;
    law(w, out, { x: gt.x, y: gt.y, z: 0 }, false);
    /* Stranded: even the divert cannot be flown — no propellant and moving too
     * fast to arrest. The label is still the best available action, but the
     * RATE of this is the health metric the note asks for. */
    const ty = w.type, LAD = ty.engineLadder;
    const aMax = (LAD[LAD.length - 1] * V.RAPTOR.thrust) / w.mp.m - G;
    const stop = (w.v[2] * w.v[2]) / (2 * Math.max(0.2, aMax));
    return (w.prop < 1 || stop > w.p[2] * 1.3) ? "stranded" : "divert";
}

const API = { advise, law, catchFeasible, K, CALM, SLEW, ROLL, SLAM, SHIP };
if (NODE) module.exports = API; else window.Teacher = API;
