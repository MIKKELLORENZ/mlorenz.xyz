/* world.js — table, balls, buckets, sensing, and the reward ledger.
 *
 * Every brain gets its OWN station: an identical table, identical balls in
 * identical places, the identical instruction. Arms never share a workspace, so
 * a slice of the population in one worker thread experiences exactly the
 * episode a slice in another does — the environment is a pure function of
 * (taskIdx, sceneSeed, noiseSeed).
 *
 * COMMON RANDOM NUMBERS. Within a generation every station is the same problem.
 * This is the single cheapest thing you can do to a noisy GA and it was the
 * biggest measured win in the chess sim: if brain A draws "one red ball 10 cm
 * from the gripper" and brain B draws "two blues at the far corner", the
 * ranking is mostly measuring the draw. Comparing brains on identical problems
 * removes that variance entirely instead of averaging it down slowly.
 *
 * ------------------------------------------------------------------ REWARD
 *
 * The ladder pays for each rung of one pick-and-place cycle, and every rung is
 * RATCHETED: the ledger stores the best progress achieved so far and pays only
 * the improvement. An arm that swings toward a ball and away again earns the
 * approach once, not once per swing. Un-ratcheted shaping is an oscillation
 * generator and it is the classic way these projects die.
 *
 *   reach -> near -> close -> grasp -> lift -> carry -> release -> deposit
 *
 * Three of those rungs (near, close, release) exist only to remove FLAT SPOTS.
 * A rung that pays a lump sum for crossing a threshold, with nothing in
 * between, is not shaping at all — it is a lottery, and a hill-climber cannot
 * climb a lottery. See the note on REWARD below for the measurement that
 * forced them in.
 *
 * The rung distances are measured to the ORACLE target — the ball the goal
 * logic says is a legal next pick, nearest to the gripper — never to the ball
 * the network chose. If shaping followed the network's own choice, a brain
 * could point at whatever was closest, collect the full approach bonus, and
 * ignore the instruction completely; the language input would then be free to
 * decay into noise because nothing paid for reading it. Shaping the oracle and
 * driving the motors from the selection is what puts the selector under
 * selection pressure: choose wrong and the arm walks away from the money.
 */
"use strict";

/* --------------------------------------------------------------- geometry */
const TABLE = { x0: -0.55, x1: 0.55, z0: -0.45, z1: 0.45, y: 0 };
const BALL_R = 0.025;
/* Bucket row. `z` is deliberately NOT pushed to the back of the table: at
 * z = -0.24 the outer buckets sat 0.591 m from the shoulder against a planar
 * reach of L1 + L2 = 0.600 m, so every delivery to red or yellow needed the arm
 * dead straight. That is marginal for the IK and it looks it — a manipulator at
 * full stretch reads as a broken one. Pulling the row 3 cm forward and widening
 * the mouth costs nothing and buys 3 cm of margin. */
const BUCKET = { r: 0.060, rim: 0.095, z: -0.21, xs: [-0.24, -0.08, 0.08, 0.24] };
const GRAVITY = 9.81;
const GRASP_R = 0.042;         // jaws capture a ball whose centre is within this
const CLOSE_T = 0.30;          // aperture below this = closing
const OPEN_T = 0.55;           // aperture above this = released
const BALL_AREA = { x0: -0.36, x1: 0.36, z0: -0.10, z1: 0.24 };

/* ----------------------------------------------------------------- tuning */
/* The ladder is a BUDGET, not an income: everything below the delivery line can
 * be earned at most once per ball, and the whole of it (930) deliberately comes
 * to less than a single correct delivery (1400). If shaping could out-earn
 * finishing, the population would optimise the shaping. A test asserts this
 * inequality rather than trusting the arithmetic.
 *
 * `near` and `close` exist because of a measured failure. A stage-1 sweep ran
 * 220 generations across four mutation settings and the best FLEET MEAN was
 * 0.013 balls per episode — the occasional lucky brain delivered, the
 * population learned nothing. The reason was a gap in the ladder, not the
 * mutation rate: closing the gripper pays NOTHING until the aperture crosses
 * 0.30, at which point it pays 250 all at once. Everything between "hovering
 * over the ball with the hand open" and "hand shut on the ball" was flat, so
 * there was no hill for a hill-climber to climb — the grasp had to be found by
 * chance, and chance does not accumulate across generations.
 *
 * `near` back-loads the approach (the plain reach ratchet is linear in
 * distance, so the last 4 cm — the only ones that matter — are worth ~6% of
 * it), and `close` pays for aperture while the hand is actually on the ball.
 * Together they turn a needle in a haystack into a slope. The same argument
 * applies at the other end, which is what `release` is for. */
/* `point` and `aim` pay the two POINTER HEADS directly for agreeing with the
 * referee — the ball head for choosing a ball that is legal right now, the
 * bucket head for choosing the bucket that ball belongs in.
 *
 * They are here for the same reason `close` and `release` are: without them the
 * decision is invisible to selection until much later. The bucket head's choice
 * only changes anything once a ball is already in transit, and early in a run
 * almost nothing gets that far — so the head drifts. Measured on the generation
 * 330 champion: it picked the SAME bucket for every held colour, ignoring the
 * "this bucket matches what I am holding" input entirely, and its
 * rule-agreement sat at 21% against a chance rate of 25%.
 *
 * This is not handing the network the answer. Which bucket is correct depends
 * on the SENTENCE — "into their respective bucket" means match the colour,
 * "everything into the red bin" means ignore it — so the only way to collect
 * these is to read the instruction. They are the language-grounding signal made
 * explicit, and they are ratcheted per ball like every other rung. */
const REWARD = {
    reach: 60, near: 80, close: 120, grasp: 250, lift: 80, carry: 220, release: 120,
    point: 90, aim: 110,
    deliver: 1400, speed: 250, complete: 1800,
    wrongBucket: -150, wrongOrder: -250, forbidden: -120,
    /* Nearly free on purpose. Every version of this ledger that made letting go
     * expensive taught the fleet never to let go: with the grasp bonus already
     * banked, holding on forever strictly dominated any release that might miss.
     * A fumble now costs 15; four extra seconds of holding costs 28. Letting go
     * badly has to beat not letting go at all. */
    drop: -15, lost: -100, violation: -600,
    // per second of carrying beyond holdGrace seconds; see the note in shape()
    hold: -7, holdGrace: 4,
    effort: -0.02, idle: -0.02
};
const CLOCK = { start: 15, perDeliver: 7, cap: 48 };

/* ------------------------------------------------------------------ scene */
function buildScene(task, spec, rng, opts) {
    const recipe = sceneRecipe(spec, rng);
    let counts = recipe.slice();
    let cap = (opts && opts.maxBalls) || MAX_BALLS;

    /* The stage's ball budget must never make the GOAL vacuous.
     *
     * A curriculum cap is a statement about difficulty, not about the rules, but
     * trimming interacts with them: "leave one red behind" trimmed to a single
     * ball leaves only the spare, so nothing may be moved, the target is zero,
     * and the episode is "complete" before it starts. The arm is then scored on
     * a task with no correct action in it. Same for a two-ball ORDER or a
     * COUNT-2 cut to one.
     *
     * So the cap is raised — never the recipe cut — until the referee agrees
     * there is at least one legal delivery to make. */
    const trialCounts = (c) => {
        const ids = [];
        let id = 0;
        for (let col = 0; col < NCOLORS; col++)
            for (let k = 0; k < c[col]; k++) ids.push({ id: id++, color: col });
        return new GoalEvaluator(spec, ids).target;
    };
    // Trim to the slot budget, dropping distractors before required colours.
    const required = new Set();
    if (spec.kind === "SORT" || spec.kind === "ALTERNATE" || spec.kind === "ORDER")
        spec.params.colors.forEach(c => required.add(c));
    if (spec.kind === "COUNT") required.add(spec.params.color);
    if (spec.kind === "LEAVE_ONE") required.add(spec.params.spare);
    const trim = (c, budget) => {
        const out = c.slice();
        let total = out.reduce((s, k) => s + k, 0);
        while (total > budget) {
            let victim = -1;
            for (let k = 0; k < NCOLORS; k++) if (out[k] > 0 && !required.has(k)) { victim = k; break; }
            if (victim < 0) for (let k = 0; k < NCOLORS; k++) if (out[k] > 1) { victim = k; break; }
            if (victim < 0) for (let k = 0; k < NCOLORS; k++) if (out[k] > 0) { victim = k; break; }
            out[victim]--; total--;
        }
        return out;
    };
    let trimmed = trim(counts, cap);
    while (trialCounts(trimmed) === 0 && cap < MAX_BALLS) {
        cap++;
        trimmed = trim(counts.map((n, i) => Math.max(n, recipe[i])), cap);
        // the recipe itself may simply be too thin for this cap — top it up
        if (trialCounts(trimmed) === 0) {
            const total = trimmed.reduce((s, k) => s + k, 0);
            if (total < cap) {
                for (let k = 0; k < NCOLORS && trimmed.reduce((s, n) => s + n, 0) < cap; k++)
                    if (spec.kind !== "EXCLUDE" || k !== spec.params.skip) trimmed[k]++;
            }
        }
    }
    counts = trimmed;
    let total = counts.reduce((s, k) => s + k, 0);
    if (total === 0) { counts[spec.kind === "ALL_TO_ONE" ? spec.params.bucket : 0] = 1; total = 1; }

    // Poisson-ish placement: reject anything too close to another ball or to a
    // bucket, so a scene is always physically pickable.
    const balls = [];
    let id = 0;
    for (let c = 0; c < NCOLORS; c++) {
        for (let k = 0; k < counts[c]; k++) {
            let x = 0, z = 0, ok = false;
            for (let attempt = 0; attempt < 200 && !ok; attempt++) {
                x = BALL_AREA.x0 + rng() * (BALL_AREA.x1 - BALL_AREA.x0);
                z = BALL_AREA.z0 + rng() * (BALL_AREA.z1 - BALL_AREA.z0);
                ok = true;
                for (const b of balls) if (Math.hypot(b.x - x, b.z - z) < 0.085) { ok = false; break; }
                if (ok) for (const bx of BUCKET.xs)
                    if (Math.hypot(bx - x, BUCKET.z - z) < BUCKET.r + 0.06) { ok = false; break; }
            }
            balls.push({
                id: id++, color: c, x, y: BALL_R, z,
                vx: 0, vy: 0, vz: 0, held: false, inBucket: -1, lost: false, grabbed: false
            });
        }
    }
    return balls;
}

/* =================================================================== Station
 * One arm, one table, one instruction, one ledger. */
class Station {
    constructor(brain, task, spec, balls, opts) {
        this.brain = brain;
        this.task = task;
        this.spec = spec;
        this.opts = opts;
        this.rng = mulberry32(opts.noiseSeed || 1);
        this.arm = new Arm({ noise: opts.noise || 0, rng: this.rng });
        this.balls = balls.map(b => Object.assign({}, b));
        this.evalr = new GoalEvaluator(spec, this.balls);
        this.bucketFill = [0, 0, 0, 0];

        this.fitness = 0;
        this.delivered = 0;             // CORRECT deliveries
        this.mistakes = 0;
        this.clock = CLOCK.start;
        this.t = 0;
        this.done = false;
        this.completed = false;
        this.held = -1;                 // ball index held, or -1
        this.lastAction = new Float32Array(5);
        this.lastDeliveredColor = -1;
        this.holdT = 0;              // seconds the current ball has been carried

        /* PER-BALL progress ledger, keyed by ball id, never reset inside an
         * episode. Each ball pays each rung of the ladder exactly once in total.
         *
         * This was originally a per-CYCLE ratchet that reset whenever the arm
         * let go, and the fleet found the hole in 46 generations: grab, release,
         * grab, release. Every re-grasp re-paid the +250 grasp bonus, and the
         * approach ramp reset so it could be earned again on the way back down.
         * The best brain in the population scored 3,715 with ZERO balls
         * delivered — a number that looks like real progress on any chart that
         * does not also plot deliveries.
         *
         * The general rule: if a shaping term can be collected twice for the
         * same physical achievement, a GA will find the loop that collects it,
         * and it will find that loop long before it finds the task. Shaping has
         * to be a budget that depletes, never an income. */
        this.prog = new Map();

        // sensing buffers
        this.ballSlots = new Float32Array(MAX_BALLS * BALL_FEATS);
        this.bucketSlots = new Float32Array(NBUCKET_SLOTS * BUCKET_FEATS);
        this.ctx = new Float32Array(CTX_FEATS);
        this.motorIn = new Float32Array(MOTOR_FEATS);
        this.sel = { ball: -1, conf: 0 };
        this.selBucket = { idx: 0, conf: 0 };
        // temporal window: 15 channels at lags 2 and 5 control ticks
        this.hist = [];
        this.HIST_CH = 15; this.LAGS = [2, 5];
        this.tick = 0;
        this.prevGrasp = null;
        this.graspVel = { x: 0, y: 0, z: 0 };
        this.log = [];                  // human-readable event trace, for the UI
    }

    remainingCounts() {
        const n = [0, 0, 0, 0];
        for (const b of this.balls) if (!b.lost && b.inBucket < 0) n[b.color]++;
        return n;
    }
    onTableCounts() {
        const n = [0, 0, 0, 0];
        for (const b of this.balls) if (!b.lost && b.inBucket < 0 && !b.held) n[b.color]++;
        return n;
    }

    /* ------------------------------------------------------- oracle target
     * What the GOAL says the arm should be doing right now. Reward shaping
     * measures against this and nothing else. */
    oracle() {
        const allowed = this.evalr.allowedColors(this.remainingCounts());
        if (this.held >= 0) {
            const b = this.balls[this.held];
            if (allowed.has(b.color))
                return { phase: "carry", ball: b, bucket: bucketFor(this.spec, b.color) };
            return { phase: "putback", ball: b, bucket: -1 };   // holding something it shouldn't
        }
        const g = this.arm.graspPoint();
        let best = null, bd = Infinity;
        for (const b of this.balls) {
            if (b.lost || b.inBucket >= 0 || b.held) continue;
            if (!allowed.has(b.color)) continue;
            const d = Math.hypot(b.x - g.x, b.y - g.y, b.z - g.z);
            if (d < bd) { bd = d; best = b; }
        }
        if (!best) return { phase: "idle", ball: null, bucket: -1 };
        return { phase: "reach", ball: best, bucket: bucketFor(this.spec, best.color), dist: bd };
    }

    /* ------------------------------------------------------------- sensing */
    sense() {
        const g = this.arm.graspPoint();
        const S = this.ballSlots; S.fill(0);
        // Slot order is by ball id and therefore stable within an episode. The
        // selector's weights are shared across slots, so the ORDER carries no
        // meaning to the network — only the contents do.
        const held = this.held >= 0 ? this.balls[this.held] : null;
        let n = 0;
        for (const b of this.balls) {
            if (n >= MAX_BALLS) break;
            if (b.lost || b.inBucket >= 0) { n++; continue; }   // slot stays all-zero = "nothing here"
            const o = n * BALL_FEATS;
            const dx = b.x - g.x, dy = b.y - g.y, dz = b.z - g.z;
            const d = Math.hypot(dx, dy, dz);
            S[o + 0] = dx / 0.5; S[o + 1] = dy / 0.5; S[o + 2] = dz / 0.5;
            S[o + 3] = Math.min(d / 0.5, 2);
            S[o + 4 + b.color] = 1;
            S[o + 8] = b.x / 0.6; S[o + 9] = b.y / 0.3; S[o + 10] = (b.z - 0.05) / 0.5;
            S[o + 11] = b.held ? 0 : 1;
            S[o + 12] = b.held ? 1 : 0;
            S[o + 13] = 1;
            const db = Math.hypot(b.x - ARM.base.x, b.z - ARM.base.z);
            S[o + 14] = Math.max(0, 1 - db / ARM.reach);
            S[o + 15] = held && held.color === b.color ? 1 : 0;
            n++;
        }

        const K = this.bucketSlots; K.fill(0);
        for (let i = 0; i < NBUCKET_SLOTS; i++) {
            const o = i * BUCKET_FEATS;
            const bx = BUCKET.xs[i], bz = BUCKET.z, by = BUCKET.rim;
            const dx = bx - g.x, dy = by - g.y, dz = bz - g.z;
            K[o + 0] = dx / 0.7; K[o + 1] = dy / 0.7; K[o + 2] = dz / 0.7;
            K[o + 3] = Math.min(Math.hypot(dx, dy, dz) / 0.7, 2);
            K[o + 4 + i] = 1;
            K[o + 8] = this.bucketFill[i] / 6;
            K[o + 9] = 1;
            K[o + 10] = held && held.color === i ? 1 : 0;
        }

        const C = this.ctx; C.fill(0);
        if (held) { C[held.color] = 1; C[4] = 1; }
        if (this.lastDeliveredColor >= 0) C[5 + this.lastDeliveredColor] = 1;
        C[9] = this.delivered / 6;
        C[10] = Math.min(1, this.t / CLOCK.cap);
        const rem = this.onTableCounts();
        C[11] = rem.reduce((s, k) => s + k, 0) / 6;
    }

    /* Assemble the 66 motor inputs from the current selection. */
    buildMotorInput() {
        const M = this.motorIn; M.fill(0);
        const g = this.arm.graspPoint();
        const ang = [0, 0, 0, 0, 0], vel = [0, 0, 0, 0, 0];
        this.arm.readJoints(ang, vel);
        for (let j = 0; j < 5; j++) { M[j] = ang[j]; M[5 + j] = vel[j]; }
        M[10] = g.x / 0.6; M[11] = (g.y - 0.1) / 0.3; M[12] = (g.z - 0.05) / 0.5;
        M[13] = this.graspVel.x / 1.0; M[14] = this.graspVel.y / 1.0; M[15] = this.graspVel.z / 1.0;

        const si = this.sel.ball;
        let tb = null;
        if (si >= 0 && si < this.balls.length) {
            const b = this.balls[si];
            if (!b.lost && b.inBucket < 0) tb = b;
        }
        if (tb) {
            const dx = tb.x - g.x, dy = tb.y - g.y, dz = tb.z - g.z;
            M[16] = dx / 0.5; M[17] = dy / 0.5; M[18] = dz / 0.5;
            M[19] = Math.min(Math.hypot(dx, dy, dz) / 0.5, 2);
        }
        M[20] = this.sel.conf;
        const ki = this.selBucket.idx;
        const kx = BUCKET.xs[ki], kz = BUCKET.z, ky = BUCKET.rim + 0.06;
        M[21] = (kx - g.x) / 0.7; M[22] = (ky - g.y) / 0.7; M[23] = (kz - g.z) / 0.7;
        M[24] = Math.min(Math.hypot(kx - g.x, ky - g.y, kz - g.z) / 0.7, 2);
        M[25] = this.selBucket.conf;
        const held = this.held >= 0 ? this.balls[this.held] : null;
        M[26] = held ? 1 : 0;
        M[27] = held && held.color === ki ? 1 : 0;
        M[28] = held ? 0 : 1;
        M[29] = held ? 1 : 0;
        M[30] = g.y / 0.3;
        for (let j = 0; j < 5; j++) M[31 + j] = this.lastAction[j] * 2 - 1;

        // --- temporal window ---------------------------------------------
        const ch = new Float32Array(this.HIST_CH);
        ch[0] = M[16]; ch[1] = M[17]; ch[2] = M[18];
        ch[3] = M[21]; ch[4] = M[22]; ch[5] = M[23];
        ch[6] = M[10]; ch[7] = M[11]; ch[8] = M[12];
        ch[9] = M[26];
        for (let j = 0; j < 5; j++) ch[10 + j] = ang[j];
        this.hist.push(ch);
        if (this.hist.length > 8) this.hist.shift();
        let o = 36;
        for (const lag of this.LAGS) {
            const idx = this.hist.length - 1 - lag;
            const src = idx >= 0 ? this.hist[idx] : ch;   // pad with the present at t=0
            for (let i = 0; i < this.HIST_CH; i++) M[o + i] = src[i];
            o += this.HIST_CH;
        }
        return M;
    }

    /* ---------------------------------------------------------- one control tick */
    control(embedding, dt) {
        if (this.done) return;
        this.sense();
        // The selectors run at a quarter of the control rate. Choosing which ball
        // to fetch is not a 15 Hz decision, and re-running two nets per slot every
        // tick is most of the compute budget for no behavioural gain.
        if (this.tick % 4 === 0 || this.sel.ball < 0) {
            if (this.selOverride) {
                // Diagnostic hook: pin the pointer heads to the oracle's answer so
                // the motor head can be studied on its own. Used by
                // probe_learnability.js to separate "this network cannot express
                // the skill" from "selection is too noisy to select for it".
                const o = this.oracle();
                const bi = o.ball ? this.balls.indexOf(o.ball) : -1;
                this.sel = { ball: bi, conf: 1 };
                this.selBucket = { idx: o.bucket >= 0 ? o.bucket : 0, conf: 1 };
            } else {
                const sb = this.brain.selectBall(this.ballSlots, this.ctx, embedding);
                this.sel = { ball: sb.idx, conf: sb.conf };
                this.selBucket = this.brain.selectBucket(this.bucketSlots, this.ctx, embedding);
            }
        }
        // A scripted policy can stand in for the brain. This exists so the test
        // harness can prove the environment is SOLVABLE — that some controller
        // gets the balls into the buckets and the ledger pays out along the way.
        // Without that check, a population that never learns is ambiguous
        // between "the GA is struggling" and "the grasp radius is 4 mm too
        // small and nothing could ever succeed".
        const out = this.policy ? this.policy(this) : this.brain.act(this.buildMotorInput());
        this.arm.setCommand(out, dt);
        for (let j = 0; j < 5; j++) this.lastAction[j] = out[j];
        this.tick++;
    }

    /* ------------------------------------------------------------- physics */
    physics(dt) {
        if (this.done) return;
        const before = this.arm.graspPoint();
        this.arm.step(dt);
        const g = this.arm.graspPoint();
        this.graspVel = { x: (g.x - before.x) / dt, y: (g.y - before.y) / dt, z: (g.z - before.z) / dt };

        const ap = this.arm.aperture();

        // ---- grasp / release -------------------------------------------------
        if (this.held < 0 && ap < CLOSE_T) {
            let best = -1, bd = GRASP_R;
            for (let i = 0; i < this.balls.length; i++) {
                const b = this.balls[i];
                if (b.lost || b.inBucket >= 0 || b.held) continue;
                const d = Math.hypot(b.x - g.x, b.y - g.y, b.z - g.z);
                if (d < bd) { bd = d; best = i; }
            }
            if (best >= 0) {
                const b = this.balls[best];
                b.held = true; this.held = best;
                // Every scored consequence of a grasp is paid AT MOST ONCE per
                // ball. Re-grasping something already picked up this episode is
                // free — neither rewarded nor punished — which removes the
                // grab/drop loop without punishing an arm that fumbles.
                const first = !b.grabbed; b.grabbed = true;
                const permitted = this.evalr.noteGrasp(b.color);
                if (first) {
                    const allowedNow = this.evalr.allowedColors(this.remainingCounts()).has(b.color);
                    if (!permitted) {
                        this.fitness += REWARD.forbidden;
                        this.mistakes++;
                        this.log.push({ t: this.t, s: `grasped a forbidden ${COLORS[b.color]}` });
                    } else if (allowedNow) {
                        this.fitness += REWARD.grasp;
                        this.log.push({ t: this.t, s: `grasped ${COLORS[b.color]}` });
                    } else {
                        // right colour family, wrong moment (ordering / count tasks)
                        this.fitness += REWARD.grasp * 0.15;
                    }
                }
            }
        } else if (this.held >= 0 && ap > OPEN_T) {
            const b = this.balls[this.held];
            b.held = false;
            b.vx = this.graspVel.x * 0.6; b.vy = this.graspVel.y * 0.6; b.vz = this.graspVel.z * 0.6;
            this.held = -1;
            // Letting go anywhere but over a bucket costs. Without this, "put it
            // down again" is a free action and the arm has no reason to finish a
            // carry it has already been paid for.
            let overBucket = false;
            for (const bx of BUCKET.xs)
                if (Math.hypot(b.x - bx, b.z - BUCKET.z) < BUCKET.r + BALL_R) overBucket = true;
            if (!overBucket) this.fitness += REWARD.drop;
        }

        // held ball rides the gripper
        if (this.held >= 0) {
            const b = this.balls[this.held];
            b.x = g.x; b.y = g.y; b.z = g.z; b.vx = b.vy = b.vz = 0;
        }

        // ---- free balls ------------------------------------------------------
        for (const b of this.balls) {
            if (b.held || b.lost || b.inBucket >= 0) continue;
            b.vy -= GRAVITY * dt;
            b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;

            // bucket capture / rim
            for (let i = 0; i < NBUCKET_SLOTS; i++) {
                const dx = b.x - BUCKET.xs[i], dz = b.z - BUCKET.z;
                const dr = Math.hypot(dx, dz);
                if (dr < BUCKET.r - BALL_R * 0.5 && b.y < BUCKET.rim) {
                    this.deposit(b, i);
                    break;
                }
                // outside wall: bounce off the rim so a near miss lands on the table
                if (dr < BUCKET.r + BALL_R && dr > BUCKET.r - BALL_R * 0.5 && b.y < BUCKET.rim + BALL_R) {
                    const nx = dx / (dr || 1), nz = dz / (dr || 1);
                    const push = BUCKET.r + BALL_R - dr;
                    b.x += nx * push; b.z += nz * push;
                    b.vx *= 0.4; b.vz *= 0.4;
                }
            }
            if (b.inBucket >= 0) continue;

            // table
            const onTable = b.x > TABLE.x0 && b.x < TABLE.x1 && b.z > TABLE.z0 && b.z < TABLE.z1;
            if (onTable && b.y < BALL_R) {
                b.y = BALL_R;
                if (b.vy < 0) b.vy = -b.vy * 0.25;
                if (Math.abs(b.vy) < 0.25) b.vy = 0;
                const fr = Math.pow(0.06, dt);            // rolling drag
                b.vx *= fr; b.vz *= fr;
                if (Math.hypot(b.vx, b.vz) < 0.01) { b.vx = 0; b.vz = 0; }
            }
            if (!onTable && b.y < -0.25) {
                b.lost = true;
                this.fitness += REWARD.lost;
                this.mistakes++;
                this.log.push({ t: this.t, s: `knocked a ${COLORS[b.color]} off the table` });
            }

            /* The gripper shoves balls around — a real failure mode, and the
             * reason a good policy approaches with the jaws OPEN and only closes
             * once it is on the ball.
             *
             * WHAT COLLIDES DEPENDS ON THE APERTURE, and getting this wrong cost
             * two training runs. An OPEN gripper is a pair of thin jaws with a
             * gap between them: a ball is supposed to pass into that gap, which
             * is the whole idea of the grasp point. A CLOSED gripper is a solid
             * lump and shoves whatever it touches.
             *
             * With the jaws colliding unconditionally, the population was
             * trapped: closing is the only way to grab, but a closed gripper
             * pushed every ball away a few millimetres before the grasp point
             * could reach it. Six of eight probe episodes stalled at 4.2–4.8 cm
             * from the ball — right at the grasp radius — with the gripper held
             * closed 93% of the time. There was no policy that could win, so no
             * mutation could climb toward one.
             *
             * The wrist housing above the jaws is solid either way. */
            if (this.held < 0) {
                const f = this.arm.fk();
                const bodies = [{ p: f.wrist, r: BALL_R + 0.020 }];
                if (this.arm.aperture() <= CLOSE_T) bodies.push({ p: f.tip, r: BALL_R + 0.012 });
                for (const body of bodies) {
                    const dx = b.x - body.p.x, dy = b.y - body.p.y, dz = b.z - body.p.z;
                    const d = Math.hypot(dx, dy, dz);
                    if (d < body.r && d > 1e-6) {
                        const p = (body.r - d) / d;
                        b.x += dx * p; b.z += dz * p;
                        b.vx += this.graspVel.x * 0.2; b.vz += this.graspVel.z * 0.2;
                    }
                }
            }
        }

        // ball-ball separation
        for (let i = 0; i < this.balls.length; i++) {
            const a = this.balls[i];
            if (a.held || a.lost || a.inBucket >= 0) continue;
            for (let j = i + 1; j < this.balls.length; j++) {
                const b = this.balls[j];
                if (b.held || b.lost || b.inBucket >= 0) continue;
                const dx = b.x - a.x, dz = b.z - a.z;
                const d = Math.hypot(dx, dz);
                if (d < BALL_R * 2 && d > 1e-6) {
                    const p = (BALL_R * 2 - d) / d * 0.5;
                    a.x -= dx * p; a.z -= dz * p;
                    b.x += dx * p; b.z += dz * p;
                }
            }
        }
    }

    /* ---------------------------------------------------------- a delivery */
    deposit(ball, bucketIdx) {
        /* Snapshot the table BEFORE the ball is booked into the bucket.
         * The referee's question is "is this a legal delivery", and at the
         * instant it is asked the ball in flight is still one of the balls in
         * play. Counting the table after removing it makes a one-ball SORT
         * report that no red balls remain, so the only correct delivery in the
         * episode gets scored as the wrong ball at the wrong time. */
        const remBefore = this.remainingCounts();
        ball.inBucket = bucketIdx;
        ball.held = false;
        ball.y = BALL_R + 0.005 + this.bucketFill[bucketIdx] * 0.008;
        ball.x = BUCKET.xs[bucketIdx] + (this.rng() - 0.5) * 0.03;
        ball.z = BUCKET.z + (this.rng() - 0.5) * 0.03;
        ball.vx = ball.vy = ball.vz = 0;
        this.bucketFill[bucketIdx]++;
        if (this.held >= 0 && this.balls[this.held] === ball) this.held = -1;

        const r = this.evalr.deliver(ball.color, bucketIdx, remBefore);
        if (r.correct) {
            this.delivered++;
            this.lastDeliveredColor = ball.color;
            // speed bonus: what fraction of the clock was still unspent
            const frac = Math.max(0, Math.min(1, this.clock / CLOCK.cap));
            this.fitness += REWARD.deliver + REWARD.speed * frac;
            this.clock = Math.min(CLOCK.cap, this.clock + CLOCK.perDeliver);
            this.log.push({ t: this.t, s: `delivered ${COLORS[ball.color]} -> ${COLORS[bucketIdx]} bucket ✓` });
        } else {
            this.mistakes++;
            if (!r.allowedColor) {
                this.fitness += REWARD.wrongOrder;
                this.log.push({ t: this.t, s: `${COLORS[ball.color]} was not the right ball right now ✗` });
            } else {
                this.fitness += REWARD.wrongBucket;
                this.log.push({ t: this.t, s: `${COLORS[ball.color]} into the ${COLORS[bucketIdx]} bucket ✗` });
            }
        }
    }

    /* Per-ball shaping ledger. Created on first sight of the ball as an oracle
     * target, and never recreated — that is what makes each rung payable once. */
    progressFor(ball, g) {
        let p = this.prog.get(ball.id);
        if (!p) {
            const d = Math.hypot(ball.x - g.x, ball.y - g.y, ball.z - g.z);
            p = { d0: Math.max(d, 0.05), reach: 0, near: 0, close: 0, lift: 0, carry: 0, carryD0: -1, release: 0, point: 0, aim: 0 };
            this.prog.set(ball.id, p);
        }
        return p;
    }

    /* ------------------------------------------------------ shaping ratchets */
    shape(dt) {
        if (this.done) return;
        const o = this.oracle();
        const g = this.arm.graspPoint();

        // Standing costs are charged FIRST and unconditionally. Draining the
        // effort counter only on the shaped phases lets it pile up silently
        // while the arm has nothing legal to do, and then bills the whole
        // accumulation against whatever happens to start next.
        this.fitness += REWARD.idle * dt * 10;
        this.fitness += REWARD.effort * this.arm.effort;
        this.arm.effort = 0;

        if (o.phase !== "carry") this.holdT = 0;

        if (o.phase === "idle" || o.phase === "putback") {
            // Nothing legal to do (or holding contraband). No shaping either way;
            // the audit at the end is what settles "leave one" and "don't touch".
            return;
        }

        const cyc = this.progressFor(o.ball, g);

        /* Pay the pointer heads for agreeing with the referee. Once per ball,
         * and only while that phase is actually live. */
        if (!cyc.point && o.phase === "reach") {
            const si = this.sel.ball;
            if (si >= 0 && si < this.balls.length && this.balls[si] === o.ball) {
                this.fitness += REWARD.point;
                cyc.point = 1;
            }
        }
        if (!cyc.aim && o.phase === "carry" && this.selBucket.idx === o.bucket) {
            this.fitness += REWARD.aim;
            cyc.aim = 1;
        }

        if (o.phase === "reach") {
            const d = Math.hypot(o.ball.x - g.x, o.ball.y - g.y, o.ball.z - g.z);
            const p = Math.max(0, Math.min(1, 1 - d / cyc.d0));
            if (p > cyc.reach) {
                this.fitness += REWARD.reach * (p - cyc.reach);
                cyc.reach = p;
            }
            // fine approach: the coarse ratchet above is linear in distance over
            // the whole swing, so closing the last 4 cm is worth almost nothing.
            // This one only starts paying inside 12 cm.
            const nearP = Math.max(0, Math.min(1, 1 - d / 0.12));
            if (nearP > cyc.near) {
                this.fitness += REWARD.near * (nearP - cyc.near);
                cyc.near = nearP;
            }
            // and the last rung before the grasp: shut the hand while it is on
            // the ball. Inside this radius, closing IS grasping — the reward is
            // the slope leading into the +250 step, not a way around it.
            if (d < GRASP_R * 1.3) {
                const shut = Math.max(0, Math.min(1, 1 - this.arm.aperture()));
                if (shut > cyc.close) {
                    this.fitness += REWARD.close * (shut - cyc.close);
                    cyc.close = shut;
                }
            }
        } else if (o.phase === "carry") {
            // lift: getting the ball clear of the table
            const h = Math.max(0, Math.min(1, (o.ball.y - BALL_R) / 0.12));
            if (h > cyc.lift) {
                this.fitness += REWARD.lift * (h - cyc.lift);
                cyc.lift = h;
            }
            /* Carry progress is measured from the BALL to the bucket's INTERIOR
             * FLOOR — not from the gripper to the bucket mouth.
             *
             * The mouth version created a dead end, and the fleet found it: the
             * ratchet saturated the moment the gripper arrived over the bucket,
             * and from there opening the jaws paid nothing extra while dropping
             * anywhere else was a net loss. So the optimal policy was to grab a ball,
             * carry it to the rim, and hold on for the rest of the episode. The
             * probe caught it exactly — the champion held its gripper open 5% of
             * the time and got within 11 mm of the bucket without ever
             * releasing.
             *
             * Measuring the ball against the floor of the bucket makes the
             * reward continuous THROUGH the release: the last few centimetres
             * can only be earned by letting go, because that is the only way the
             * ball gets below the rim. There is no longer a plateau to sit on. */
            const bx = BUCKET.xs[o.bucket], bz = BUCKET.z, by = BALL_R + 0.01;
            const d = Math.hypot(bx - o.ball.x, by - o.ball.y, bz - o.ball.z);
            if (cyc.carryD0 < 0) cyc.carryD0 = Math.max(d, 0.05);
            const p = Math.max(0, Math.min(1, 1 - d / cyc.carryD0));
            if (p > cyc.carry) {
                this.fitness += REWARD.carry * (p - cyc.carry);
                cyc.carry = p;
            }

            /* OPENING THE HAND NEEDS ITS OWN GRADIENT.
             *
             * Grasping requires the aperture servo to be driven closed, and the
             * population learns that first because it is worth +250. By the time
             * it can carry, the weights feeding that output are large and the
             * sigmoid is saturated — the probe measured the gripper held open 1%
             * of the time. From there, "open the hand" is not a small mutation
             * away; it is a large coordinated change to a saturated unit that
             * only pays off if it happens at exactly the right instant. The
             * fleet carried balls to within 6 mm of the bucket and sat there.
             *
             * So the last rung pays for aperture directly, and only while the
             * grasp point is genuinely inside the mouth of the CORRECT bucket.
             * It cannot be farmed: it is ratcheted per ball like everything
             * else, and the only pose that collects it is the pose that
             * completes the delivery a fraction of a second later. */
            /* The release gradient is TWO-DIMENSIONAL and deliberately wide.
             *
             * A version that only paid inside the bucket's own 5.5 cm mouth was
             * unreachable in practice: getting there requires the carry to be
             * already good, and the carry is only good once releasing has been
             * learned. The probe found the fleet parked in that trap — every
             * episode reached "lifted" or "carried" and the gripper was open
             * 0% of the time, across all twelve probe runs.
             *
             * Paying for (how centred) x (how open) over a 14 cm radius gives a
             * slope that can be climbed from where the arm actually is. Both
             * factors are required, so it cannot be collected by opening the
             * hand somewhere useless. */
            const flat = Math.hypot(bx - g.x, bz - g.z);
            const R = BUCKET.r * 2.6;
            if (flat < R && g.y > BUCKET.rim - 0.02 && g.y < BUCKET.rim + 0.25) {
                const centred = Math.max(0, Math.min(1, 1 - flat / R));
                const open = Math.max(0, Math.min(1, this.arm.aperture() / OPEN_T));
                const v = centred * open;
                if (v > cyc.release) {
                    this.fitness += REWARD.release * (v - cyc.release);
                    cyc.release = v;
                }
            }

            /* HOLDING ON IS NOT FREE.
             *
             * Every previous version of this ledger left "grip the ball and keep
             * it" costing nothing but the standing idle charge, and the fleet
             * took that deal every time — the grasp bonus was already banked and
             * any release risked a miss. A ball held past a few seconds now
             * costs more than a fumbled release does, so letting go badly beats
             * not letting go at all, which is the ordering the task needs. */
            this.holdT += dt;
            if (this.holdT > REWARD.holdGrace) this.fitness += REWARD.hold * dt;
        }
    }

    tickClock(dt) {
        if (this.done) return;
        this.t += dt;
        this.clock -= dt;
        const rem = this.remainingCounts();
        const nothingLeft = this.evalr.allowedColors(rem).size === 0 && this.held < 0;
        if (this.clock <= 0 || nothingLeft) this.finish();
    }

    finish() {
        if (this.done) return;
        this.done = true;
        const audit = this.evalr.finish(this.onTableCounts());
        this.completed = audit.complete;
        if (audit.complete) {
            this.fitness += REWARD.complete;
            this.log.push({ t: this.t, s: "task complete ✓" });
        }
        for (const v of audit.violations) {
            this.fitness += REWARD.violation;
            this.mistakes++;
            this.log.push({ t: this.t, s: v + " ✗" });
        }
        this.audit = audit;
    }
}

/* ===================================================================== World */
class World {
    constructor(brains, opts) {
        opts = opts || {};
        this.opts = opts;
        this.dt = opts.dt || 1 / 60;
        this.controlEvery = opts.controlEvery || 4;      // 15 Hz control on a 60 Hz sim
        this.frame = 0;
        this.t = 0;

        const task = opts.task;
        this.task = task;
        this.spec = { kind: task.kind, params: task.params };
        this.embedding = opts.embedding;
        const rng = mulberry32(opts.sceneSeed || 7);
        this.initialBalls = buildScene(task, this.spec, rng, opts);
        this.stations = brains.map((b, i) => new Station(b, task, this.spec, this.initialBalls, {
            noise: opts.noise || 0,
            // Same scene for everyone; only the sensor/actuator noise stream differs
            // per station, and even that is off unless the stage asks for it.
            noiseSeed: (opts.noiseSeed || 99) + i * 7717
        }));
    }

    step() {
        const dt = this.dt;
        const doControl = this.frame % this.controlEvery === 0;
        for (const s of this.stations) {
            if (s.done) continue;
            if (doControl) s.control(this.embedding, dt * this.controlEvery);
            s.physics(dt);
            s.shape(dt);
            s.tickClock(dt);
        }
        this.frame++;
        this.t += dt;
    }

    isOver() {
        for (const s of this.stations) if (!s.done) return false;
        return true;
    }

    results() {
        return this.stations.map(s => ({
            brain: s.brain,
            fitness: s.fitness,
            delivered: s.delivered,
            target: s.evalr.target,
            mistakes: s.mistakes,
            completed: s.completed ? 1 : 0
        }));
    }
}

if (typeof module !== "undefined") module.exports = {
    World, Station, TABLE, BALL_R, BUCKET, BALL_AREA, REWARD, CLOCK, buildScene, GRASP_R, CLOSE_T, OPEN_T
};
