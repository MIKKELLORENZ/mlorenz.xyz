/* probe_learnability.js — can the motor head learn ONE fixed pick-and-place?
 *
 *   node probe_learnability.js [--iters 4000] [--scenes 1]
 *
 * When a population stalls, there are two completely different diagnoses and
 * the fitness curve cannot tell them apart:
 *
 *   A. the policy is not REPRESENTABLE — the motor head's inputs or shape
 *      cannot express "reach, close, lift, carry, open" at all, in which case
 *      no amount of population, mutation tuning or patience will help;
 *   B. the policy is representable but SELECTION is too noisy to find it —
 *      every generation draws new scenes and new instructions, so a brain that
 *      solved one exam is re-examined on another.
 *
 * This isolates A. It removes everything that makes the real problem hard:
 * the pointer heads are pinned to the oracle's answer, there is exactly one
 * scene, one instruction, no noise, and the search is a plain (1+1) hill climb
 * on the motor head alone. If a few thousand evaluations of that cannot deliver
 * one ball, the architecture is the problem and the curriculum is irrelevant.
 *
 * It is a DIAGNOSTIC, not part of the system: nothing here seeds a champion.
 */
"use strict";

const { loadSim } = require("./simload.js");
loadSim(__dirname);

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const ITERS = parseInt(arg("iters", "4000"), 10);
const SCENES = parseInt(arg("scenes", "1"), 10);
const RATE = parseFloat(arg("rate", "0.15"));
const SIGMA = parseFloat(arg("sigma", "0.2"));

const task = TASKS.find(t => t.kind === "SORT" && t.params.colors.length === 1 && t.split === "train");
const emb = Embedding.forTask(task);
console.log(`instruction: "${task.text}"`);
console.log(`(1+1) hill climb on the MOTOR HEAD only, pointer heads pinned to the oracle`);
console.log(`${SCENES} fixed scene(s), ${ITERS} evaluations, mutation ${RATE}/${SIGMA}\n`);

function evaluate(brain) {
    let fit = 0, del = 0, log = null;
    for (let s = 0; s < SCENES; s++) {
        const w = new World([brain], {
            task, embedding: emb, sceneSeed: 31 + s * 17, noiseSeed: 5, maxBalls: 1, noise: 0
        });
        w.stations[0].selOverride = true;
        let g = 0;
        while (!w.isOver() && g++ < 60 * 60) w.step();
        fit += w.stations[0].fitness;
        del += w.stations[0].delivered;
        if (s === 0) log = w.stations[0].log;
    }
    return { fit: fit / SCENES, del, log };
}

const rng = mulberry32(12345);
let best = new Brain(Embedding.dim, rng);
let bestScore = evaluate(best);
let firstGrasp = null, firstDeliver = null;
const t0 = Date.now();

for (let i = 1; i <= ITERS; i++) {
    const cand = best.clone();
    // only the motor head moves — the selectors are pinned anyway
    cand.motor.mutate(RATE, SIGMA, rng);
    const sc = evaluate(cand);
    if (sc.fit > bestScore.fit) {
        best = cand; bestScore = sc;
        if (!firstGrasp && sc.log.some(e => /grasped/.test(e.s))) firstGrasp = i;
        if (!firstDeliver && sc.del > 0) firstDeliver = i;
    }
    if (i % 250 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`  ${String(i).padStart(5)}  best ${bestScore.fit.toFixed(0).padStart(6)}  ` +
            `delivered ${bestScore.del}  (${el.toFixed(0)}s)`);
    }
}

console.log(`\nfinal: fitness ${bestScore.fit.toFixed(0)}, delivered ${bestScore.del}`);
console.log(`events: ${bestScore.log.map(e => e.t.toFixed(1) + "s " + e.s).join(" | ") || "(none)"}`);
console.log(`first grasp at iteration ${firstGrasp || "never"}, first delivery at ${firstDeliver || "never"}`);

/* Reference points so the number above means something. */
const ladder = REWARD.reach + REWARD.near + REWARD.close + REWARD.grasp + REWARD.point + REWARD.aim
    + REWARD.lift + REWARD.carry + REWARD.release;
console.log(`\nfor scale: the whole shaping ladder for one ball is ${ladder}, ` +
    `a delivery adds ${REWARD.deliver}+, completion ${REWARD.complete}.`);
if (bestScore.del === 0)
    console.log(`VERDICT: the motor head could not deliver even one fixed ball with perfect\n` +
        `         targeting. The architecture or its inputs are the blocker, not the GA.`);
else
    console.log(`VERDICT: the skill is representable and reachable by hill climbing.\n` +
        `         A stalled population is a SELECTION problem, not an architecture one.`);
