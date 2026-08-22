/* oracle_policy.js — a MEMORYLESS, DIVERSE teacher, for distillation.
 *
 * `reference_policy.js` proves the task is solvable, but it cannot be used as a
 * labelling teacher, and the reason is the thing it is proudest of: it is a
 * LATCHED state machine. Its action is a function of (world, which rung of the
 * machine it happens to be on), and that second argument is history. The
 * student's motor head is a function of the world alone. Labelling states with
 * a latched teacher therefore hands the network two different answers for the
 * same input — "descend" and "hover" at the same pose, depending on what
 * happened thirty ticks ago — and asks it to fit both. That is the non-Markov
 * labelling trap, and it shows up as high training accuracy with a policy that
 * gets worse every DAgger round rather than as an obvious error.
 *
 * So this file re-derives the same behaviour as a pure function of the state.
 *
 * THE PART THAT LOOKED IMPOSSIBLE. The comment at the top of the reference
 * controller says a memoryless version cannot work: "if I am more than 3 cm out
 * horizontally, hover, otherwise descend" puts two setpoints 10 cm apart on
 * either side of a threshold that the arm's own response keeps crossing, so it
 * oscillates forever. That is true, and it is true of any THRESHOLD. It is not
 * true of a FUNNEL. Here the hover height is a continuous function of alignment
 *
 *     y* = ball.y + HOVER * min(1, (flat / ALIGN_R)^2)
 *
 * so there is no mode to flip between: badly aligned means high, well aligned
 * means low, and every pose in between has a target that varies smoothly. The
 * arm spirals down the funnel instead of hunting across a boundary.
 *
 * THE FUNNEL MUST BE QUADRATIC IN THE ERROR, NOT IN THE ALIGNMENT. The first
 * version wrote the same idea as `HOVER * (1 - align^2)` with
 * `align = 1 - flat/ALIGN_R`, which near the ball is LINEAR in the error with a
 * slope of 2*HOVER/ALIGN_R = 2.8. So an 8 mm horizontal miss still held the
 * hand 23 mm up, and the distance to the ball bottomed out at 2.97 * flat —
 * never inside the 25.2 mm the grasp needs unless the arm got within 8.5 mm
 * horizontally, which the servo and the 5 mm IK lattice make a coin flip. It
 * scored 46/73 and took 2.6x as long as the latched controller, and every kind
 * of failure it produced looked like a different bug. Squaring the ERROR makes
 * the residual hover 18.7 * flat^2: at the same 8 mm miss the hand is 1.2 mm
 * up, and the funnel closes. Measured after the change it clears 72/73 and
 * finishes in 4.3 s where the latched controller needs 5.2 s.
 *
 * The other two pieces of the reference machine's memory dissolve on
 * inspection. `anchor` — the point to lift straight up from — is just the grasp
 * point at the moment of the grasp, and the held ball IS at the grasp point, so
 * "lift from the anchor" and "lift from where you are" are the same command.
 * And the hover/lift/traverse/release ordering is recoverable from `held` and
 * the current height, both of which the student can see.
 *
 * ONE TEACHER IS NOT ENOUGH, EVEN A PERFECT ONE.
 *
 * Ball positions are already drawn fresh for every episode and this controller
 * re-solves from the live scene each tick, so spawn variety is free — it is a
 * closed loop, not a replayed trajectory. That is not the problem. The problem
 * is that a single deterministic controller draws a single THREAD through state
 * space: it always approaches from the same relative direction, always cruises
 * at the same height, always lets go at the same radius. A student fitted to
 * that thread has never seen the arm 4 cm off the approach line and has no idea
 * what to do there — which is exactly the situation it creates for itself the
 * first time it is left to drive.
 *
 * Two answers, and both are needed. DAgger supplies the off-thread STATES: the
 * student drives, gets into its own mess, and the teacher says what to do from
 * there. And `makeOraclePolicy({ rng })` supplies off-thread BEHAVIOUR: the
 * approach geometry is re-drawn per episode — how high the funnel starts, how
 * wide it is, the cruise height, how centred it insists on being before it lets
 * go — and noise is added to the servo command. So the student is fitted to a
 * FAMILY of competent policies rather than to one groove, which is both more
 * robust and a far better starting point for the GA that runs afterwards.
 *
 * It cheats exactly where the reference does — it reads `Station.oracle()`, so
 * it always knows which ball is legal next and which bucket it belongs in. That
 * is the point: those two facts are precisely the supervision signal for the
 * two pointer heads, which is the language half of the problem.
 */
"use strict";

const NOMINAL = {
    HOVER: 0.105,       // how high above the ball the funnel starts
    ALIGN_R: 0.075,     // horizontal error at which the funnel is fully up
    CRUISE: 0.215,      // carry height (BUCKET.rim + 0.12)
    LIFT_LO: 0.160,     // below this a carried ball is still in rim country
    LIFT_OK: 0.205,     // above this, a carried ball clears every rim
    DROP_R: 0.030,      // how centred over the bucket before letting go
    GRIP_R: 0.0252,     // close the hand inside this (GRASP_R * 0.6)
    JITTER: 0           // half-width of the noise added to each servo command
};

/* How far each knob may be re-drawn per episode.
 *
 * Deliberately modest, because the point is a family of policies that all still
 * WORK. A teacher that sometimes fails is not diversity, it is mislabelled
 * data — every state it visits still gets labelled "this is what a good
 * controller does here". `probe_oracle.js --diverse` scores a sample of drawn
 * styles so this stays an assertion rather than a hope. */
function drawStyle(rng) {
    if (!rng) return Object.assign({}, NOMINAL);
    const u = (lo, hi) => lo + rng() * (hi - lo);
    return {
        HOVER: u(0.075, 0.135),
        ALIGN_R: u(0.055, 0.100),
        CRUISE: u(0.200, 0.240),
        LIFT_LO: u(0.145, 0.175),
        LIFT_OK: u(0.195, 0.215),
        DROP_R: u(0.020, 0.034),
        GRIP_R: NOMINAL.GRIP_R,
        JITTER: u(0, 0.05)
    };
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/* solveIK is a 3000-iteration coordinate descent, far too slow to call on a
 * continuously moving target. Quantising the target to a 5 mm lattice makes the
 * cache hit almost always; 5 mm of target jitter is nothing against a 42 mm
 * grasp radius and the proportional servo loop smooths it away. */
function makeIK() {
    const cache = new Map();
    return function (x, y, z) {
        const qx = Math.round(x * 200) / 200, qy = Math.round(y * 200) / 200, qz = Math.round(z * 200) / 200;
        const key = qx + "," + qy + "," + qz;
        let v = cache.get(key);
        if (v === undefined) { v = solveIK({ x: qx, y: qy, z: qz }).q; cache.set(key, v); }
        return v;
    };
}

function slotOf(s, ball) {
    if (!ball) return -1;
    for (let i = 0; i < s.balls.length; i++) if (s.balls[i] === ball) return i;
    return -1;
}

/* ------------------------------------------------------------------ labels
 * What the two POINTER heads should have said, taken from the goal evaluator.
 * This is the language supervision and it is exact. A `ball` of -1 means "point
 * at an empty slot" — the do-nothing action the leave-one, count and exclude
 * rules need, and which costs the architecture no parameters. */
function labelsFor(s) {
    const o = s.oracle();
    /* A BUCKET OF -1 MEANS "NO OPINION", AND IT MUST SURVIVE AS -1.
     *
     * `Station.oracle()` returns bucket -1 in two phases: `idle` (nothing legal
     * left to do) and `putback` (holding a ball it should not have). An earlier
     * version coerced that to bucket 0 so the caller always had a number, which
     * quietly fabricated a training label — "the right answer here is the red
     * bin" — for every tick in which there was no right answer.
     *
     * It cost a whole DAgger round to find, because it is invisible while the
     * TEACHER drives: the teacher idles for a handful of ticks per episode, so
     * the fabricated labels are a rounding error. The moment the STUDENT drives,
     * episodes stretch from 66 control ticks to 151 and most of the extra ticks
     * are exactly this dithering, so the bucket head was trained on a flood of
     * "answer: bucket 0". Held-out task completion went 44.6% -> 31.6%, and
     * ALL_TO_ONE — which is decided by the bucket head alone — fell from 38% to
     * 4%. It reads as "DAgger does not work here". It is one coerced -1.
     *
     * Callers that need a bucket to AIM at still need a real index; that is
     * `motorFor`'s business and it takes one explicitly. This function is about
     * what is TRUE, so it says so when nothing is. */
    const bucket = o.bucket >= 0 && o.bucket < BUCKET.xs.length ? o.bucket : -1;
    if (o.phase === "idle" || o.phase === "putback") return { ball: -1, bucket: -1, phase: o.phase };
    return { ball: slotOf(s, o.ball), bucket, phase: o.phase };
}

/* ------------------------------------------------------------------- motor
 * What the MOTOR head should have said, for an EXPLICITLY GIVEN target.
 *
 * The target is passed in rather than read from the oracle, and that is the
 * single most important line in the distillation. The motor head cannot see the
 * instruction, the goal state or the colour rules — all it sees is "there is a
 * target at this offset". Its job is therefore "go to the target you were
 * given", unconditionally. Labelling it with a command toward the ORACLE's ball
 * while its input describes the ball the SELECTOR actually chose asks the
 * network for two different outputs from one input, and that is the DAgger
 * labelling bug that makes every round come out worse than the last.
 *
 * The same reasoning settles what to do when the arm is holding a ball it is
 * not allowed to have. "Set it back down" is the right recovery, but nothing in
 * the motor head's 66 inputs distinguishes a legal ball from an illegal one, so
 * that label would contradict the carry label on identical inputs. Every
 * holding state is therefore "carry to the selected bucket", and not grabbing
 * forbidden balls in the first place is left entirely to `ballSel`, which can
 * see the instruction and is the head that should own the decision. */
function motorFor(s, ball, bucketIdx, ik, st, rng) {
    const g = s.arm.graspPoint();
    let out;

    if (s.held >= 0) {
        /* The threshold trap lives on this side too. "Below the rim clearance,
         * lift straight up; above it, fly to the bucket" oscillates for exactly
         * the reason the reach does — traversing costs height, dropping back
         * under the line flips the target to straight-up, rising flips it back.
         * So the horizontal target is BLENDED by how much rim clearance the
         * hand currently has, while the vertical target is always the cruise
         * height, so the hand is always being told to climb. */
        const kx = BUCKET.xs[bucketIdx], kz = BUCKET.z;
        const w = clamp01((g.y - st.LIFT_LO) / (st.LIFT_OK - st.LIFT_LO));
        const q = ik(g.x + (kx - g.x) * w, st.CRUISE, g.z + (kz - g.z) * w);
        const flat = Math.hypot(g.x - kx, g.z - kz);
        out = [...driveTo(q, s.arm), (flat < st.DROP_R && g.y > st.LIFT_LO) ? 1 : 0];
    } else if (!ball) {
        out = [...driveTo(HOME, s.arm), 1];
    } else {
        const flat = Math.hypot(g.x - ball.x, g.z - ball.z);
        const u = clamp01(flat / st.ALIGN_R);
        const q = ik(ball.x, ball.y + st.HOVER * u * u, ball.z);
        const d3 = Math.hypot(g.x - ball.x, g.y - ball.y, g.z - ball.z);
        // closing is latched by the WORLD, not by the teacher: once the grasp
        // lands, `held` is set and the next tick is a carry
        out = [...driveTo(q, s.arm), d3 < st.GRIP_R ? 0 : 1];
    }

    if (st.JITTER > 0 && rng)
        for (let j = 0; j < 4; j++) out[j] = clamp01(out[j] + (rng() - 0.5) * 2 * st.JITTER);
    return out;
}

/* Full teacher. Returns `{ out, ball, bucket }`: `out` is the motor label,
 * `ball` and `bucket` are the pointer-head labels.
 *
 *   opts.rng      draw a random policy style, and jitter the servo command.
 *                 Omit for the nominal deterministic teacher.
 *   opts.target   (s) => {ball, bucket} — whose target the MOTOR label is
 *                 computed for. Defaults to the oracle's own choice, which is
 *                 what you want while the teacher drives; during DAgger this is
 *                 the STUDENT's current selection. See motorFor. */
function makeOraclePolicy(opts) {
    opts = opts || {};
    const ik = opts.ik || makeIK();
    const rng = opts.rng || null;
    const st = opts.style || drawStyle(rng);
    return function (s) {
        const lab = labelsFor(s);
        /* The bucket to AIM at is not the bucket to LEARN. `lab.bucket` is -1
         * whenever the oracle has no opinion and must be passed on as -1 so the
         * caller can drop the sample; the motor still has to point somewhere, so
         * it falls back to the student's current choice and then to bucket 0. */
        let tb = null, tk = lab.bucket >= 0 ? lab.bucket : 0;
        if (opts.target) {
            const t = opts.target(s);
            tb = (t.ball >= 0 && t.ball < s.balls.length) ? s.balls[t.ball] : null;
            if (tb && (tb.lost || tb.inBucket >= 0)) tb = null;
            if (t.bucket >= 0 && t.bucket < BUCKET.xs.length) tk = t.bucket;
        } else if (lab.ball >= 0) {
            tb = s.balls[lab.ball];
        }
        return { out: motorFor(s, tb, tk, ik, st, rng), ball: lab.ball, bucket: lab.bucket, phase: lab.phase, style: st };
    };
}

/* Drop-in for `Station.policy`, so the teacher can drive an episode itself. */
function makeOracleDriver(opts) {
    const p = makeOraclePolicy(opts);
    return function (s) { return p(s).out; };
}

if (typeof module !== "undefined")
    module.exports = { makeOraclePolicy, makeOracleDriver, makeIK, labelsFor, motorFor, drawStyle, NOMINAL };
