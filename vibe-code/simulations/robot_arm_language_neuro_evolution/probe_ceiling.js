/* probe_ceiling.js — is the held-out gap the POLICY or the EMBEDDING?
 *
 *   node probe_ceiling.js training_distill/distilled_best.json [episodes]
 *
 * The distilled brain completes ~75% of tasks worded the way it was trained and
 * ~50% worded a way it has never seen. That gap has two completely different
 * explanations and they call for opposite work.
 *
 * If the POLICY is the limit, the brain understands the goal and fumbles the
 * execution, and the fix is more training. If the EMBEDDING is the limit, the
 * brain executes fine and simply cannot tell from the vector WHICH goal it has
 * been given, and no amount of training helps — the fix is a wider or better
 * projection, which is a different project entirely.
 *
 * The measurement separates them cleanly. Run the held-out SENTENCES, then run
 * the same held-out SPECS re-worded with a phrasing from the training split.
 * The scene, the seed, the rules and the brain are identical; only the vector
 * differs. Whatever the second number recovers was never a policy problem.
 *
 * The project notes put held-out 1-NN exact-spec recovery at 54% for the
 * chosen operating point (dims 16, whiten 0.3), so a held-out task rate landing
 * near that is the hypothesis worth testing rather than a coincidence.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadSim } = require("./simload.js");
loadSim(__dirname);

const src = process.argv[2] || path.join("training", "distilled_best.json");
const N = parseInt(process.argv[3] || "600", 10);
const saved = JSON.parse(fs.readFileSync(path.isAbsolute(src) ? src : path.join(__dirname, src), "utf8"));
const brain = Brain.fromJSON(saved.brain);

const TRAIN = TASKS.filter(t => t.split === "train");
const HELD = TASKS.filter(t => t.split !== "train");

/* A training-split phrasing of the same underlying goal. `specIdx` is what
 * makes two sentences the same goal; the whole point of the corpus is that 11
 * wordings share one. */
function twinOf(t) {
    const twins = TRAIN.filter(o => o.specIdx === t.specIdx);
    return twins.length ? twins[0] : null;
}

function run(list, embedFrom, label) {
    let del = 0, tgt = 0, comp = 0, n = 0, skipped = 0;
    for (let i = 0; i < N; i++) {
        const t = list[i % list.length];
        const src = embedFrom ? twinOf(t) : t;
        if (!src) { skipped++; continue; }
        const r = (Math.imul(i + 1, 2654435761)) >>> 0;
        const w = new World([brain], {
            task: t, embedding: Embedding.forTask(src),
            sceneSeed: 900000 + (r % 100000), noiseSeed: 900000 + ((r >>> 11) % 1000),
            maxBalls: MAX_BALLS, fill: 2.0,
            noise: [0, 0.2, 0.35, 0.5][(r >>> 17) % 4]
        });
        const s = w.stations[0];
        let g = 0;
        while (!w.isOver() && g++ < 60 * 140) w.step();
        del += s.delivered; tgt += s.evalr.target; comp += s.completed ? 1 : 0; n++;
    }
    const b = 100 * del / Math.max(1, tgt), c = 100 * comp / Math.max(1, n);
    console.log(`  ${label.padEnd(46)} ${b.toFixed(1).padStart(5)}% balls   ${c.toFixed(1).padStart(5)}% tasks   (${n} eps${skipped ? ", " + skipped + " skipped" : ""})`);
    return { balls: b, tasks: c };
}

console.log(`\nbrain: ${src}`);
console.log(`lineage: ${saved.lineage || "unrecorded"}\n`);
const a = run(TRAIN, false, "trained sentences, own vector");
const b = run(HELD, false, "HELD-OUT sentences, own vector");
const c = run(HELD, true, "HELD-OUT goals, worded from the train split");

console.log(`\n  held-out sentences lose ${(a.tasks - b.tasks).toFixed(1)} points of task completion.`);
console.log(`  re-wording the SAME goals with a seen sentence recovers ${(c.tasks - b.tasks).toFixed(1)} of them.`);
const share = (c.tasks - b.tasks) / Math.max(1e-9, a.tasks - b.tasks);
console.log(`  => ${(100 * share).toFixed(0)}% of the held-out gap is the EMBEDDING failing to identify`);
console.log(`     the goal, not the policy failing to carry it out.`);
