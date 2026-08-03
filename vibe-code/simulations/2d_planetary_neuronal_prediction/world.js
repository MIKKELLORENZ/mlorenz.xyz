/* world.js — episodes, rollouts and the fitness function.
 *
 * ======================== WHAT AN INDIVIDUAL IS SCORED ON ====================
 * A trial set is a handful of star systems whose true trajectories have already
 * been integrated. Every individual in a generation is rolled out on the SAME
 * systems from the SAME initial states — common random numbers. This is not a
 * nicety: with a fresh draw per individual, the score is dominated by which
 * system you happened to get, two brains differing by one mutation are ranked
 * on luck, and selection stops working. It was the single biggest win in the
 * chess sim on this site and it is the single biggest win here.
 *
 * ============================ THE ERROR METRIC ==============================
 * Raw positional error is the wrong thing to average. An outer planet at 6 AU
 * and an inner one at 0.4 AU would contribute in proportion to their orbital
 * radius, so a model could ignore the inner system entirely and still score
 * well. Each body's error is therefore divided by its own distance from the
 * barycentre — a *relative* error — with a floor so a body passing near the
 * origin cannot divide by almost zero and dominate the average.
 *
 * Errors are then averaged in LOG space, at log-spaced checkpoints (tick 1, 2,
 * 4, 8, … H). This matters more than it looks. Linear averaging over a rollout
 * is entirely dominated by the last few ticks, where the error is largest, so
 * one-step accuracy — the thing that actually has to be right first — carries
 * almost no weight and the search never bothers to fix it. In log space each
 * decade of accuracy counts the same, and the fitness reads directly as
 * "correct digits × 100".
 */
"use strict";

/* Checkpoints: tick 1, 2, 4, … up to the horizon, and always the horizon
 * itself. Log spacing means every timescale from one step to the whole rollout
 * gets equal say in the score. */
function checkTicks(horizon) {
    const out = [];
    for (let t = 1; t < horizon; t *= 2) out.push(t);
    out.push(horizon);
    return out;
}

/* Relative position error of a predicted state against the truth. Returns the
 * RMS over bodies, and fills `per` with each body's own relative error if given. */
function relError(pred, truth, L, per) {
    const n = truth.n;
    let acc = 0;
    for (let i = 0; i < n; i++) {
        const dx = pred.x[i] - truth.x[i], dy = pred.y[i] - truth.y[i];
        const r = Math.hypot(truth.x[i], truth.y[i]);
        // Floor at 15% of the reference length. Without it the star — which sits
        // within a thousandth of the origin — has a denominator near zero and its
        // relative error swamps every planet in the system.
        const den = Math.max(r, 0.15 * L);
        const e = Math.hypot(dx, dy) / den;
        if (per) per[i] = e;
        acc += e * e;
    }
    return Math.sqrt(acc / n);
}

const ERR_FLOOR = 1e-12;   // below this we are measuring the truth integrator, not the brain
const ERR_CEIL = 10;       // 1000% relative error: the body is simply somewhere else

/* ------------------------------------------------------------------ runners */

/* Everything that can produce an acceleration wears the same two-method shape,
 * so the scorer cannot accidentally give one competitor an advantage the others
 * do not have. */
/* `split: true` means this runner fills bx/by itself with a separate effective
 * acceleration for the velocity update. Runners that leave it false get bx = ax,
 * i.e. the classical scheme, without having to know the option exists. */
function predictorRunner(pred) {
    return {
        name: "brain",
        split: true,
        reset(n) { pred.reset(n); },
        accel(st, sys, ax, ay, bx, by) { pred.accel(st, sys, ax, ay, bx, by); }
    };
}
const NEWTON_RUNNER = { name: "newton", reset() { }, accel: newtonAccelFn };
const DRIFT_RUNNER = { name: "drift", reset() { }, accel: zeroAccelFn };

/* Exact Newton, combined by the classical multistep coefficients. The real bar
 * for a learned forward model — see the long note in model.js. */
function adamsRunner(order) {
    const scratch = {};
    const f = makeAdamsFn(order);
    return {
        name: "adams" + order,
        split: true,
        reset() { scratch.raw = null; },
        accel(st, sys, ax, ay, bx, by) { f(st, sys, ax, ay, bx, by, scratch); }
    };
}

function newtonSubRunner(sub) {
    const scratch = {};
    const f = makeNewtonSubFn(sub);
    return {
        name: "newton×" + sub,
        reset() { scratch.tmp = null; },
        accel(st, sys, ax, ay) { f(st, sys, ax, ay, scratch); }
    };
}

/* ----------------------------------------------------------------- rollout */

/* Roll `runner` forward over a system and measure it against the stored truth.
 * `opts.record` collects every predicted state for the renderer; leave it off
 * in training, where it is pure allocation. */
function rollout(sys, runner, opts) {
    const o = opts || {};
    const horizon = o.horizon != null ? Math.min(o.horizon, sys.horizon) : sys.horizon;
    const checks = o.checks || checkTicks(horizon);
    const n = sys.n, L = sys.ref.L;
    const st = sys.state0.clone();
    const ax = new Float64Array(n), ay = new Float64Array(n);
    const bx = new Float64Array(n), by = new Float64Array(n);
    const frames = o.record ? [st.clone()] : null;
    const errSeries = o.record ? [0] : null;

    runner.reset(n);
    const checkSet = new Set(checks);
    const byCheck = [];
    let blew = false;

    for (let t = 1; t <= horizon; t++) {
        runner.accel(st, sys, ax, ay, bx, by);
        if (!runner.split) { bx.set(ax); by.set(ay); }
        stepVerlet(st, sys.dt, ax, ay, bx, by);
        if (!blew) {
            for (let i = 0; i < n; i++) {
                if (!Number.isFinite(st.x[i]) || !Number.isFinite(st.y[i])) { blew = true; break; }
            }
        }
        if (frames) frames.push(st.clone());
        if (errSeries) errSeries.push(blew ? ERR_CEIL : relError(st, sys.truth.frames[t], L, null));
        if (checkSet.has(t)) {
            byCheck.push({ tick: t, err: blew ? ERR_CEIL : relError(st, sys.truth.frames[t], L, null) });
        }
        // A rollout that has already gone non-finite cannot recover and every
        // further tick is wasted time — but the remaining checkpoints still have
        // to be filled in at the ceiling, or a brain that explodes early would
        // be scored on fewer, easier checkpoints than one that survives.
        if (blew && !frames) {
            for (const c of checks) if (c > t) byCheck.push({ tick: c, err: ERR_CEIL });
            break;
        }
    }

    let digits = 0;
    for (const c of byCheck) {
        digits += -Math.log10(Math.min(ERR_CEIL, Math.max(ERR_FLOOR, c.err)));
    }
    digits /= Math.max(1, byCheck.length);
    return { digits, byCheck, blew, frames, errSeries, horizon };
}

/* ---------------------------------------------------------------- trial set */

/* A generation's worth of systems, built once and reused by every individual.
 * Building includes integrating the truth, which is by far the most expensive
 * thing here — and it is done exactly once no matter how large the population,
 * which is what makes a population of 512 cost barely more than a population of
 * 64 in setup time. */
/* The tick length for one system, when training over a RANGE of step sizes.
 *
 * DERIVED from the system's own seed, never drawn fresh. Every worker and every
 * individual has to build the identical system with the identical step, or
 * common random numbers is broken and the population gets ranked on who happened
 * to be handed the easy step size — which is the failure this whole simulator is
 * built to avoid.
 *
 * LOG-uniform, because the step size acts multiplicatively: going from 30 to 40
 * ticks per orbit is the same size of change as going from 75 to 100, and a
 * linear draw would spend most of its samples in the fine-step regime where
 * there is almost no truncation error left to correct and therefore nothing to
 * learn. Log-uniform spends equal effort per octave.
 *
 * Why bother: the previous champion's advantage over Newton *inverted* at fine
 * steps, because it was trained at exactly one tick length and learned a force
 * law tuned to that regime rather than a genuinely step-size-aware correction.
 * The model is handed `dt` as an input; this is what forces it to use it. */
function tickFracFor(seed, range) {
    const rng = mulberry32((seed ^ 0x9E3779B9) >>> 0);
    const lo = Math.log(range[0]), hi = Math.log(range[1]);
    return 1 / Math.exp(lo + rng() * (hi - lo));
}

class TrialSet {
    constructor(seeds, opts) {
        const o = opts || {};
        this.systems = [];
        this.level = o.level || 0;
        for (const s of seeds) {
            let sys = null;
            // With a step-size range, each system gets its own tick length —
            // fixed for that system, so a rollout never changes step midway.
            const so = o.tickRange
                ? Object.assign({}, o, { tickFrac: tickFracFor(s, o.tickRange) })
                : o;
            // makeSystem returns null when twenty draws in a row were degenerate;
            // walking the seed rather than giving up keeps the trial count fixed,
            // so generations stay comparable.
            for (let bump = 0; bump < 8 && !sys; bump++) {
                sys = makeSystem((s + bump * 7919) >>> 0, so);
            }
            if (sys) this.systems.push(sys);
        }
        this.checks = this.systems.map(s => checkTicks(o.horizon != null ? Math.min(o.horizon, s.horizon) : s.horizon));
        this.horizon = o.horizon;
    }

    get size() { return this.systems.length; }

    /* Mean digits across the set. The MINIMUM is reported alongside because a
     * mean hides a brain that is excellent on four systems and diverging on the
     * fifth, and a forward model that diverges on one system in five is not a
     * forward model. */
    evaluate(runner) {
        let sum = 0, worst = Infinity, blew = 0;
        const per = [];
        for (let i = 0; i < this.systems.length; i++) {
            const r = rollout(this.systems[i], runner, { horizon: this.horizon, checks: this.checks[i] });
            sum += r.digits;
            if (r.digits < worst) worst = r.digits;
            if (r.blew) blew++;
            per.push(r.digits);
        }
        const n = Math.max(1, this.systems.length);
        return { digits: sum / n, worst: worst === Infinity ? 0 : worst, blew, per };
    }

    /* Error broken out by checkpoint, averaged over the set — the drift curve
     * the UI plots and the number that says whether a model is good at one step,
     * good at a hundred, or neither. */
    driftCurve(runner) {
        const acc = new Map();
        for (let i = 0; i < this.systems.length; i++) {
            const r = rollout(this.systems[i], runner, { horizon: this.horizon, checks: this.checks[i] });
            for (const c of r.byCheck) {
                const e = Math.min(ERR_CEIL, Math.max(ERR_FLOOR, c.err));
                const a = acc.get(c.tick) || { tick: c.tick, s: 0, n: 0 };
                a.s += Math.log10(e); a.n++;
                acc.set(c.tick, a);
            }
        }
        return [...acc.values()].sort((a, b) => a.tick - b.tick)
            .map(a => ({ tick: a.tick, logErr: a.s / a.n }));
    }
}

/* Fitness is digits × 100, with the worst-system score mixed in. Selecting on
 * the mean alone rewards a brain that wins four systems and loses the fifth;
 * mixing in the worst makes consistency worth something, the same worst-map
 * weighting that broke a long plateau in the boats sim. */
const WORST_WEIGHT = 0.35;
function fitnessOf(ev) {
    return 100 * ((1 - WORST_WEIGHT) * ev.digits + WORST_WEIGHT * ev.worst);
}

/* Seeds for one generation. Held constant across a BLOCK of generations, so
 * consecutive generations are comparable to each other and a champion cannot be
 * crowned for drawing an easy set. */
function seedsFor(block, count, salt) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(((block * 1000003) ^ ((i + 1) * 2654435761) ^ (salt | 0)) >>> 0);
    return out;
}

if (typeof module !== "undefined") {
    module.exports = {
        checkTicks, relError, rollout, TrialSet, fitnessOf, seedsFor, tickFracFor,
        predictorRunner, NEWTON_RUNNER, DRIFT_RUNNER, newtonSubRunner, adamsRunner,
        ERR_FLOOR, ERR_CEIL, WORST_WEIGHT
    };
}
