/* arm.js — a 5-DoF revolute manipulator and its servos.
 *
 * The arm is a planar 3-link chain (shoulder, elbow, wrist) mounted on a yawing
 * base, plus a gripper. Everything above the base moves in the vertical plane
 * that the base yaw points at, which is what makes this tractable for a GA: the
 * network never has to discover a full 3D inverse kinematics, only "swing the
 * plane onto the target" and "fold the chain to the right radius and height".
 * That is still real IK — there is no closed form handed to the net, and the
 * elbow-up/elbow-down ambiguity is the net's problem — but it is IK a few
 * thousand weights can actually find.
 *
 * SI units. Angles in radians. The joint frame is deliberately "from vertical"
 * rather than "from horizontal": a1 = 0 means the upper arm points straight up,
 * which puts the whole reachable workspace at positive a1 and means a newborn
 * brain outputting 0.5 on every servo starts in a sane half-folded pose over
 * the table rather than lying flat inside it.
 *
 *   a1 = q[1]                  upper arm, from +Y toward the reach direction
 *   a2 = a1 + q[2]             forearm, absolute
 *   a3 = a2 + q[3]             gripper, absolute. a3 = PI points straight down.
 *   q[0]                       base yaw about +Y
 *   q[4]                       gripper aperture, 1 = open
 *
 * Servos are rate-limited position sources with a first-order lag, plus
 * optional noise. Not a torque model: a hobby servo really is a position source
 * from the controller's point of view, and modelling contact dynamics on a
 * grasp would add a large amount of simulation for a distinction the reward
 * ledger cannot see.
 */
"use strict";

const DEG = Math.PI / 180;

const ARM = {
    base: { x: 0, y: 0, z: 0.30 },     // where the pedestal meets the table
    pedestal: 0.10,                    // shoulder height above the table
    L1: 0.32, L2: 0.28, L3: 0.10,      // upper arm, forearm, gripper offset
    reach: 0.70,
    /* [min, max] per joint, radians.
     *
     * These are not arbitrary. Every range is centred on the READY pose below,
     * and the half-widths are the smallest that still cover the whole job — the
     * ball area on the table and a release point over each bucket, with the
     * gripper pointing at least 130 degrees down. Tightening them is worth
     * doing deliberately: the servo target is `lo + sigmoid(x) * (hi - lo)`, so
     * a 190-degree range means one unit of network output sweeps 190 degrees
     * and fine positioning has to come out of the last few percent of a
     * sigmoid. Narrow ranges hand the GA a finer instrument for free. */
    limits: [
        [-95 * DEG, 95 * DEG],         // 0 base yaw
        [-70 * DEG, 60 * DEG],         // 1 shoulder (from vertical)
        [48 * DEG, 168 * DEG],         // 2 elbow (relative, folds forward)
        [11 * DEG, 141 * DEG],         // 3 wrist (relative)
        [0, 1]                         // 4 gripper aperture
    ],
    // max change per second, per joint
    rates: [2.6, 2.4, 2.8, 3.2, 4.0],
    lag: 0.35,                         // first-order servo smoothing per control tick
    leak: 0.03,                        // per-tick pull of the commanded pose back toward READY
    jawHalf: 0.045,                    // half the open jaw span, for drawing
    /* How far past the jaw mount the grasp point sits — i.e. how long the jaws
     * are. This has to CLEAR the tip's collision sphere (ball radius + 12 mm =
     * 37 mm in world.js) or the gripper body occupies the very spot the ball is
     * meant to end up in, and nothing can ever be picked up. 55 mm leaves ~2 cm
     * of margin. It is a jaw length, not a tuning constant, and the test suite
     * asserts the relationship rather than the number. */
    graspOffset: 0.055
};

/* READY pose — solved, not guessed: the joint angles that put the grasp point
 * 20 cm above the middle of the ball area with the gripper aimed straight down.
 * It is exactly the midpoint of every limit above, which means a newborn brain
 * (near-zero output layer -> sigmoid 0.5 on every servo) is BORN in the ready
 * pose instead of somewhere random. That is worth a lot of generations: the
 * population starts hovering over the work area facing the right way, so the
 * first mutations that do anything useful are small ones. */
const HOME = [0, -5 * DEG, 108 * DEG, 76 * DEG, 0.5];

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

class Arm {
    constructor(opts) {
        opts = opts || {};
        this.q = HOME.slice();
        this.qd = [0, 0, 0, 0, 0];
        this.target = HOME.slice();
        this.noise = opts.noise || 0;
        this.rng = opts.rng || null;
        this._fk = null;
        this.effort = 0;               // accumulated |commanded change|, for smoothness costs
        this.limitHits = 0;
        this.updateFK();
    }

    /* Decode five sigmoid outputs into joint targets.
     *
     * THE FOUR POSE JOINTS ARE INCREMENTAL; THE GRIPPER IS ABSOLUTE.
     *
     * This is the most consequential choice in the file. With absolute targets,
     * "put the gripper on that ball" requires the network to compute a full
     * inverse-kinematics solution: four joint angles as a global function of a
     * Cartesian target, with the elbow-up/elbow-down branch included. That is a
     * genuinely hard function to approximate, it has to be right everywhere at
     * once, and a mutation that improves it near one ball position usually
     * breaks it near another. A stage-1 sweep across four mutation settings ran
     * 180 generations and never got the fleet mean above 0.015 balls/episode.
     *
     * With increments, the same behaviour becomes a LOCAL rule: "the ball is
     * that way, so nudge these joints that way." That is roughly Jacobian-
     * transpose control, it is smooth in the weights, and a partial solution is
     * still useful — which is exactly what a hill-climber needs. The network is
     * still discovering the kinematics; it just no longer has to discover all
     * of them simultaneously before any of it pays.
     *
     * The gripper stays absolute because open/closed is a STATE, not a motion:
     * integrating a velocity command would let the hand drift open mid-carry.
     *
     * LEAK is what makes increments safe. A newborn's outputs sit ~0.01 away
     * from 0.5, and integrating that bias for 450 control ticks would walk every
     * joint into its end stop. The leak pulls the commanded pose gently back
     * toward READY, so a constant bias b settles at an offset of b/LEAK instead
     * of running away, while a deliberate sustained command still reaches the
     * limits. */
    setCommand(out, dt) {
        const step = dt || (1 / 15);
        for (let j = 0; j < 4; j++) {
            const [lo, hi] = ARM.limits[j];
            const delta = (clamp(out[j], 0, 1) - 0.5) * 2 * ARM.rates[j] * step;
            const relaxed = this.target[j] + (HOME[j] - this.target[j]) * ARM.leak;
            const t = clamp(relaxed + delta, lo, hi);
            this.effort += Math.abs(t - this.target[j]);
            this.target[j] = t;
        }
        const [glo, ghi] = ARM.limits[4];
        const gt = glo + clamp(out[4], 0, 1) * (ghi - glo);
        this.effort += Math.abs(gt - this.target[4]);
        this.target[4] = gt;
    }

    /* One physics substep. */
    step(dt) {
        for (let j = 0; j < 5; j++) {
            const [lo, hi] = ARM.limits[j];
            let want = this.target[j];
            if (this.noise > 0 && this.rng) want += (this.rng() - 0.5) * this.noise * (hi - lo) * 0.02;
            // first-order approach, then hard rate limit — the lag is what makes
            // a bang-bang command produce a smooth joint instead of a step
            let d = (want - this.q[j]) * ARM.lag;
            const maxD = ARM.rates[j] * dt;
            if (d > maxD) d = maxD; else if (d < -maxD) d = -maxD;
            const nq = clamp(this.q[j] + d, lo, hi);
            this.qd[j] = (nq - this.q[j]) / dt;
            if ((nq === lo && d < 0) || (nq === hi && d > 0)) this.limitHits++;
            this.q[j] = nq;
        }
        this.updateFK();
    }

    /* Forward kinematics -> world positions of every joint and the grasp point. */
    updateFK() {
        const q = this.q;
        const yaw = q[0];
        const rx = Math.sin(yaw), rz = -Math.cos(yaw);   // radial unit vector (points away from the operator)
        const sh = { x: ARM.base.x, y: ARM.base.y + ARM.pedestal, z: ARM.base.z };

        const a1 = q[1], a2 = a1 + q[2], a3 = a2 + q[3];
        const seg = (p, ang, L) => ({
            x: p.x + rx * Math.sin(ang) * L,
            y: p.y + Math.cos(ang) * L,
            z: p.z + rz * Math.sin(ang) * L
        });
        const elbow = seg(sh, a1, ARM.L1);
        const wrist = seg(elbow, a2, ARM.L2);
        const tip = seg(wrist, a3, ARM.L3);
        const grasp = seg(tip, a3, ARM.graspOffset);
        // unit vector the jaws close along (the approach direction)
        const app = {
            x: rx * Math.sin(a3), y: Math.cos(a3), z: rz * Math.sin(a3)
        };
        this._fk = { shoulder: sh, elbow, wrist, tip, grasp, approach: app, radial: { x: rx, z: rz }, a1, a2, a3 };
        return this._fk;
    }

    fk() { return this._fk; }
    graspPoint() { return this._fk.grasp; }
    aperture() { return this.q[4]; }

    /* Normalised joint state for the network: angles and rates in [-1, 1]. */
    readJoints(outAng, outVel) {
        for (let j = 0; j < 5; j++) {
            const [lo, hi] = ARM.limits[j];
            outAng[j] = (this.q[j] - lo) / (hi - lo) * 2 - 1;
            outVel[j] = clamp(this.qd[j] / ARM.rates[j], -1, 1);
        }
    }

    /* Is the gripper pointing usefully downward? Used only for diagnostics and
     * the UI — never as a reward, because paying for a pose rather than for a
     * grasp is exactly how you get an arm that poses beautifully and grasps
     * nothing. */
    downness() { return -Math.cos(this._fk.a3); }

    reset() {
        this.q = HOME.slice();
        this.qd = [0, 0, 0, 0, 0];
        this.target = HOME.slice();
        this.effort = 0;
        this.limitHits = 0;
        this.updateFK();
    }
}

if (typeof module !== "undefined") module.exports = { Arm, ARM, HOME, DEG, clamp };
