/* reference_policy.js — a hand-written controller that does the job properly.
 *
 * This is NOT part of the evolved system and no brain is ever seeded from it.
 * It exists for two reasons:
 *
 *   1. It proves the environment is solvable. When a GA run goes nowhere, the
 *      first question is always "is this task even possible with this grasp
 *      radius, this clock, this reach?" — and a scripted controller that clears
 *      the bench answers it in seconds instead of after a night of training.
 *      It found the bug where the gripper's collision sphere was wider than its
 *      grasp radius, which made every ball squirt away on contact.
 *   2. It gives the UI an honest reference to run beside the champion, so
 *      "the arm is slow" can be checked against what the physics allows.
 *
 * It cheats in exactly one way and it is worth naming: it reads the ORACLE, so
 * it always knows which ball is legal next. It never sees the instruction text
 * or the embedding. It is a lower bound on motor competence, not a solution to
 * the language problem — the part this project is actually about is the part
 * the reference controller skips.
 */
"use strict";

/* Coordinate descent on the four positional joints. Deliberately dumb: it only
 * has to be good enough to prove reachability, and a dumb solver that is
 * obviously correct beats a clever one that might be flattering the result. */
function solveIK(target, downMin) {
    const a = new Arm({});
    let q = HOME.slice(0, 4);
    const minA3 = downMin === undefined ? Math.PI * 0.72 : downMin;
    const err = (c) => {
        for (let j = 0; j < 4; j++) a.q[j] = c[j];
        a.updateFK();
        const g = a.graspPoint(), f = a.fk();
        return Math.hypot(g.x - target.x, g.y - target.y, g.z - target.z)
            + Math.max(0, minA3 - f.a3) * 0.6
            // also discourage leaning PAST vertical: a3 of 200 degrees satisfies
            // any lower bound but has the jaws coming in from the far side
            + Math.max(0, f.a3 - Math.PI * 1.06) * 0.6;
    };
    let best = err(q), step = 0.5;
    for (let it = 0; it < 3000; it++) {
        let improved = false;
        for (let j = 0; j < 4; j++) {
            for (const d of [step, -step]) {
                const c = q.slice();
                c[j] = Math.max(ARM.limits[j][0], Math.min(ARM.limits[j][1], c[j] + d));
                const e = err(c);
                if (e < best - 1e-9) { best = e; q = c; improved = true; }
            }
        }
        if (!improved) { step *= 0.6; if (step < 1e-5) break; }
    }
    return { q, err: best };
}

/* The four pose joints take INCREMENTS, not absolute angles (see arm.js), so a
 * controller that knows where it wants to be has to close the loop itself. This
 * is a plain proportional term on joint error, saturated at full servo rate —
 * the same shape the evolved motor head has to discover, driven from an IK
 * solution instead of from weights. */
function driveTo(qWant, arm, dt) {
    const step = dt || (1 / 15);
    const o = [];
    for (let j = 0; j < 4; j++) {
        const err = qWant[j] - arm.target[j];
        const full = ARM.rates[j] * step;
        o.push(Math.max(0, Math.min(1, 0.5 + 0.5 * Math.max(-1, Math.min(1, err / full)))));
    }
    return o;
}

/* A LATCHED state machine: hover -> descend -> grip -> lift -> traverse ->
 * release. The latching is the whole trick and it is worth spelling out,
 * because the first version of this file did not have it and looked like a
 * physics bug.
 *
 * A memoryless controller picks its target from the CURRENT error — "if I am
 * more than 3 cm from the ball horizontally, hover; otherwise descend". Those
 * two targets are 10 cm apart vertically, so the arm moves toward the descend
 * target, the horizontal error grows past 3 cm on the way, the controller flips
 * back to hover, the error shrinks, it flips again. The arm oscillates between
 * two setpoints forever and never closes the gripper. That is not a tuning
 * problem: any threshold on an error that the response itself perturbs will do
 * this. The state has to be latched so a transition happens once and stays.
 *
 * Worth noting for the GA: the evolved brain gets a temporal window over its
 * inputs precisely so it can build the same kind of hysteresis out of rate
 * information, rather than being a pure function of the instantaneous error the
 * way this controller originally was. */
const REF_STATES = ["hover", "descend", "grip", "lift", "traverse", "release"];

function makeReferencePolicy() {
    const cache = new Map();
    const ik = (t) => {
        const key = `${t.x.toFixed(3)},${t.y.toFixed(3)},${t.z.toFixed(3)}`;
        if (!cache.has(key)) cache.set(key, solveIK(t));
        return cache.get(key);
    };
    const HOVER_H = 0.10;
    let st = "hover", ballId = -1, anchor = null, timer = 0;

    const goto = (next) => { st = next; timer = 0; };

    return function (s) {
        const o = s.oracle();
        const g = s.arm.graspPoint();
        timer++;

        if (o.phase === "idle" || o.phase === "putback") {
            ballId = -1; st = "hover";
            return [...driveTo(HOME, s.arm), 1];
        }
        // a new target ball restarts the machine
        if (o.ball && o.ball.id !== ballId && st !== "release") {
            ballId = o.ball.id;
            goto(s.held >= 0 ? "lift" : "hover");
        }

        switch (st) {
            case "hover": {
                const t = { x: o.ball.x, y: o.ball.y + HOVER_H, z: o.ball.z };
                const sol = ik(t);
                if (Math.hypot(g.x - t.x, g.y - t.y, g.z - t.z) < 0.025 || timer > 90) goto("descend");
                return [...driveTo(sol.q, s.arm), 1.0];
            }
            case "descend": {
                const t = { x: o.ball.x, y: o.ball.y, z: o.ball.z };
                const sol = ik(t);
                if (Math.hypot(g.x - t.x, g.y - t.y, g.z - t.z) < GRASP_R * 0.6) goto("grip");
                else if (timer > 90) goto("hover");
                return [...driveTo(sol.q, s.arm), 1.0];
            }
            case "grip": {
                const t = { x: o.ball.x, y: o.ball.y, z: o.ball.z };
                const sol = ik(t);
                if (s.held >= 0) { anchor = { x: g.x, z: g.z }; goto("lift"); }
                else if (timer > 30) goto("hover");            // missed — try again
                return [...driveTo(sol.q, s.arm), 0.0];
            }
            case "lift": {
                if (!anchor) anchor = { x: g.x, z: g.z };
                const t = { x: anchor.x, y: BUCKET.rim + 0.14, z: anchor.z };
                const sol = ik(t);
                if (s.held < 0) { goto("hover"); return [...driveTo(HOME, s.arm), 1.0]; }
                if (g.y > BUCKET.rim + 0.11 || timer > 90) goto("traverse");
                return [...driveTo(sol.q, s.arm), 0.0];
            }
            case "traverse": {
                if (s.held < 0) { goto("hover"); return [...driveTo(HOME, s.arm), 1.0]; }
                const t = { x: BUCKET.xs[o.bucket], y: BUCKET.rim + 0.12, z: BUCKET.z };
                const sol = ik(t);
                if (Math.hypot(g.x - t.x, g.z - t.z) < 0.03) goto("release");
                return [...driveTo(sol.q, s.arm), 0.0];
            }
            default: {                                          // release
                const t = { x: BUCKET.xs[o.bucket] !== undefined ? BUCKET.xs[o.bucket] : g.x, y: BUCKET.rim + 0.12, z: BUCKET.z };
                const sol = ik(t);
                if (s.held < 0 && timer > 6) { anchor = null; ballId = -1; goto("hover"); }
                return [...driveTo(sol.q, s.arm), 1.0];
            }
        }
    };
}

if (typeof module !== "undefined") module.exports = { solveIK, makeReferencePolicy, driveTo };
