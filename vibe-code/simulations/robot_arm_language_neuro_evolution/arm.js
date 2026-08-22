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
    graspOffset: 0.055,

    /* EYE-IN-HAND STEREO RIG.
     *
     * Two cameras on the wrist, looking down the approach vector — the
     * direction the jaws point and close along. Defined here rather than in
     * render.js because this is arm hardware, not decoration: the same geometry
     * has to drive the on-screen preview and any headless pipeline that renders
     * what the arm can actually see.
     *
     * The baseline runs along the JAW-OPENING axis, which puts the disparity on
     * the image's horizontal axis where every stereo method expects it, and
     * keeps both eyes level with each other however the wrist is rotated.
     *
     * The pair sits on a BRACKET, held `mount` clear of the wrist axis, and is
     * TOED IN at a point just past the grasp point rather than aimed straight
     * down the approach vector. Both are forced by what the first version
     * looked like: eyes on the axis and parallel put the gripper housing 26 mm
     * in front of a 74-degree lens, so the entire frame was the back of the
     * arm's own hand. A hand camera does need to see its own jaws — without
     * them there is no way to tell "the ball is between the pads" from "the
     * ball is a centimetre short", which is the one distinction the grasp turns
     * on — but it needs them at the EDGE of the frame, not filling it.
     *
     * FOV is wide because the working distance is centimetres: at a narrow
     * angle the ball fills the frame just as the hand arrives and everything
     * else leaves it. `near` is small for the same reason. */
    eye: {
        back: 0.030,        // how far behind the tip, along -approach
        baseline: 0.044,    // eye separation, along the jaw-opening axis
        mount: 0.052,       // how far OFF the wrist axis the bracket holds them
        lookAhead: 0.020,   // the pair is toed in this far past the grasp point
        fov: 74,
        near: 0.006,
        far: 6
    }
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
        /* Optional world-supplied predicate `solid(fk) -> bool`: "does this pose
         * put any part of the arm inside something solid?" The arm itself knows
         * nothing about benches or buckets, so the world hands it one. Without
         * it the arm is a ghost — see the note on `step`. */
        this.solid = opts.solid || null;
        this.contacts = 0;             // ticks in which a move was blocked
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

    /* One physics substep.
     *
     * SOLIDS ARE ENFORCED HERE, NOT BY A PENALTY. Before this existed the bench
     * and the buckets were scenery: the FK was exact, the renderer drew exactly
     * what the FK said, and what the FK said was that the arm was 97 mm inside
     * the table. A gen-224 GA champion spent 22.6% of its ticks with a link
     * inside the bench, punched through the table top 393 times and through a
     * bucket wall 117 times across 40 episodes. It looked like a rendering bug
     * and was not: the arm really was swinging through the furniture, so the
     * workspace the GA was searching did not exist.
     *
     * The fix is a position constraint rather than a reward, because a reward
     * for not clipping is one more thing to trade off and the fleet would price
     * it. A servo that runs into the bench simply stops, which is what a real
     * one does. Implementation: take the step, and if the new pose penetrates,
     * bisect back along the joint-space segment to the last free pose. Six
     * iterations resolve contact to 1/64 of a tick's motion (<0.6 mm at the
     * fastest observed tip speed).
     *
     * Two invariants make this safe. The start pose is always free (HOME is
     * free and we only ever move to free poses), so the bisection always has a
     * free end to fall back to and the arm can never wedge. And the solid
     * regions are VOLUMES, not shells, so a fast joint cannot tunnel: any pose
     * that ends up on the far side of a bucket wall is still inside the solid.
     *
     * The gripper (joint 4) is excluded — aperture does not enter the FK, and
     * freezing the hand because the elbow touched the bench would make "let go"
     * unreachable at exactly the moment it matters. */
    step(dt) {
        const qPrev = this.solid ? this.q.slice() : null;
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
        if (this.solid && this.solid(this._fk)) {
            const qNew = this.q.slice();
            let free = 0, hit = 1;
            for (let it = 0; it < 6; it++) {
                const m = (free + hit) / 2;
                for (let j = 0; j < 4; j++) this.q[j] = qPrev[j] + (qNew[j] - qPrev[j]) * m;
                this.updateFK();
                if (this.solid(this._fk)) hit = m; else free = m;
            }
            for (let j = 0; j < 4; j++) this.q[j] = qPrev[j] + (qNew[j] - qPrev[j]) * free;
            this.updateFK();
            for (let j = 0; j < 4; j++) this.qd[j] = (this.q[j] - qPrev[j]) / dt;
            this.contacts++;
        }
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

    /* World-space pose of each eye: origin and an orthonormal basis with
     * `forward` down the approach vector and `right` along the baseline.
     *
     * Returned as plain objects rather than three.js types so this stays usable
     * from a headless process, which is the whole reason it lives in arm.js. */
    eyes() {
        const f = this._fk, E = ARM.eye;
        const fwd = f.approach;
        // the jaw-opening axis: horizontal, perpendicular to the reach plane
        const right = { x: -f.radial.z, y: 0, z: f.radial.x };
        // up completes the frame; recomputed rather than assumed vertical so the
        // pair stays rigidly attached to the wrist when the wrist tilts
        const up = {
            x: right.y * fwd.z - right.z * fwd.y,
            y: right.z * fwd.x - right.x * fwd.z,
            z: right.x * fwd.y - right.y * fwd.x
        };
        const un = Math.hypot(up.x, up.y, up.z) || 1;
        up.x /= un; up.y /= un; up.z /= un;
        // the point both eyes are aimed at: just past where a ball gets captured
        const aim = {
            x: f.tip.x + fwd.x * (ARM.graspOffset + E.lookAhead),
            y: f.tip.y + fwd.y * (ARM.graspOffset + E.lookAhead),
            z: f.tip.z + fwd.z * (ARM.graspOffset + E.lookAhead)
        };
        const mk = (side) => {
            const o = {
                x: f.tip.x - fwd.x * E.back + right.x * side * E.baseline / 2 + up.x * E.mount,
                y: f.tip.y - fwd.y * E.back + right.y * side * E.baseline / 2 + up.y * E.mount,
                z: f.tip.z - fwd.z * E.back + right.z * side * E.baseline / 2 + up.z * E.mount
            };
            let fx = aim.x - o.x, fy = aim.y - o.y, fz = aim.z - o.z;
            const fn = Math.hypot(fx, fy, fz) || 1;
            fx /= fn; fy /= fn; fz /= fn;
            // re-orthogonalise the baseline against the toed-in forward axis, so
            // the disparity stays on the image's horizontal axis
            const d = right.x * fx + right.y * fy + right.z * fz;
            let rx = right.x - fx * d, ry = right.y - fy * d, rz = right.z - fz * d;
            const rn = Math.hypot(rx, ry, rz) || 1;
            rx /= rn; ry /= rn; rz /= rn;
            return {
                origin: o,
                forward: { x: fx, y: fy, z: fz },
                right: { x: rx, y: ry, z: rz },
                up: { x: ry * fz - rz * fy, y: rz * fx - rx * fz, z: rx * fy - ry * fx }
            };
        };
        return [mk(-1), mk(+1)];        // left eye, right eye
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
        this.contacts = 0;
        this.updateFK();
    }
}

if (typeof module !== "undefined") module.exports = { Arm, ARM, HOME, DEG, clamp };
