/* probe_eyes.js — what can the wrist stereo pair ACTUALLY see?
 *
 * This is the go/no-go measurement for replacing the privileged sensors with
 * pixels. The brain's ball selector is a POINTER head: it scores every ball slot
 * and picks one, and the slots come from `Station.sense()`, which is handed the
 * true position and colour of every ball on the bench. Feeding it pixels instead
 * only works if the pixels contain the balls it has to choose between.
 *
 * An eye-in-hand camera is the interesting case precisely because it moves with
 * the hand, and the question is whether "the instruction says fetch the blue
 * one" is even answerable from a view that is pointed at wherever the hand
 * happens to be. So: over real episodes, what fraction of the balls that exist
 * are inside the frustum, and how often is the ball the oracle wants visible at
 * the moment the decision is made?
 *
 *   node probe_eyes.js [episodes]
 */
"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const { ARM } = require("./arm.js");
const { makeOracleDriver } = require("./oracle_policy.js");
const { labelsFor } = require("./oracle_policy.js");
const W = require("./world.js");
const { BUCKET, BALL_R } = W;

const N = parseInt(process.argv[2] || "200", 10);
const HFOV = ARM.eye.fov * Math.PI / 180;      // vertical fov; horizontal is wider by aspect
const ASPECT = 4 / 3;

/* Is a world point inside this eye's view frustum? */
function visible(eye, p, r) {
    const dx = p.x - eye.origin.x, dy = p.y - eye.origin.y, dz = p.z - eye.origin.z;
    const f = dx * eye.forward.x + dy * eye.forward.y + dz * eye.forward.z;
    if (f < ARM.eye.near || f > ARM.eye.far) return false;
    const rr = dx * eye.right.x + dy * eye.right.y + dz * eye.right.z;
    const uu = dx * eye.up.x + dy * eye.up.y + dz * eye.up.z;
    const tanV = Math.tan(HFOV / 2), tanH = tanV * ASPECT;
    // count it visible if the CENTRE is in frame, generously (the ball has size)
    return Math.abs(uu) <= f * tanV + r && Math.abs(rr) <= f * tanH + r;
}

let ticks = 0, ballsSeenL = 0, ballsTotal = 0, anySeen = 0;
let decisions = 0, targetVisible = 0, allVisible = 0, bucketVisible = 0, bucketTicks = 0;

for (let k = 0; k < N; k++) {
    const task = TASKS[(k * 29) % TASKS.length];
    const brain = new Brain(Embedding.dim, mulberry32(1));
    const w = new World([brain], {
        task, embedding: Embedding.forTask(task),
        sceneSeed: 700 + k * 13, noiseSeed: 5, maxBalls: 3 + (k % 4)
    });
    const s = w.stations[0];
    s.policy = makeOracleDriver();
    let guard = 0;
    while (!w.isOver() && guard++ < 60 * 140) {
        if (w.frame % w.controlEvery === 0 && !s.done) {
            const eyes = s.arm.eyes();
            const live = s.balls.filter(b => !b.lost && b.inBucket < 0 && !b.held);
            let seen = 0;
            for (const b of live) {
                const p = { x: b.x, y: b.y, z: b.z };
                if (visible(eyes[0], p, BALL_R) || visible(eyes[1], p, BALL_R)) seen++;
            }
            ticks++; ballsTotal += live.length; ballsSeenL += seen;
            if (seen > 0) anySeen++;

            // at every SELECTOR decision, is the ball the oracle wants in frame?
            if (s.tick % 4 === 0) {
                const lab = labelsFor(s);
                decisions++;
                if (live.length && seen === live.length) allVisible++;
                if (lab.ball >= 0) {
                    const b = s.balls[lab.ball];
                    const p = { x: b.x, y: b.y, z: b.z };
                    if (visible(eyes[0], p, BALL_R) || visible(eyes[1], p, BALL_R)) targetVisible++;
                }
                if (lab.bucket >= 0) {
                    bucketTicks++;
                    const p = { x: BUCKET.xs[lab.bucket], y: BUCKET.rim, z: BUCKET.z };
                    if (visible(eyes[0], p, BUCKET.r) || visible(eyes[1], p, BUCKET.r)) bucketVisible++;
                }
            }
        }
        w.step();
    }
}

const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + "%";
console.log(`\neye-in-hand visibility over ${N} teacher-driven episodes (${ticks} control ticks)`);
console.log(`  balls on the bench in frame            ${pc(ballsSeenL, ballsTotal)}  (${ballsSeenL}/${ballsTotal})`);
console.log(`  ticks with at least one ball in frame  ${pc(anySeen, ticks)}`);
console.log(`  selector decisions where ALL balls were in frame   ${pc(allVisible, decisions)}`);
console.log(`  selector decisions where the WANTED ball was seen  ${pc(targetVisible, decisions)}`);
console.log(`  decisions where the TARGET BUCKET was in frame     ${pc(bucketVisible, bucketTicks)}`);
console.log(`\nA pointer head must compare candidates. The fraction with ALL balls in`);
console.log(`frame is the ceiling on how often that comparison is even possible from`);
console.log(`this camera alone.`);
