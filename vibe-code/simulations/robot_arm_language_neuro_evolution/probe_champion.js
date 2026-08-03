/* probe_champion.js — forensic trace of what the trained brain actually does.
 *
 *   node probe_champion.js                       training/champion.json
 *   node probe_champion.js training/x.json SORT  only SORT tasks
 *
 * A fitness plateau is ambiguous. "480 and flat" could be a fleet that cannot
 * grasp, or one that grasps and never lets go, or one that delivers to the
 * wrong bucket every time. The aggregate number cannot tell those apart, so
 * this walks one episode tick by tick and reports which rung of the ladder the
 * arm stops on, plus a per-phase time budget.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { loadSim } = require("./simload.js");
loadSim(__dirname);

const src = process.argv[2] && !/^[A-Z_]+$/.test(process.argv[2])
    ? process.argv[2] : path.join("training", "champion.json");
const kindFilter = [...process.argv].find(a => /^[A-Z_]+$/.test(a));
const p = path.isAbsolute(src) ? src : path.join(__dirname, src);
if (!fs.existsSync(p)) { console.error("no champion at " + src); process.exit(1); }
const saved = JSON.parse(fs.readFileSync(p, "utf8"));
const brain = Brain.fromJSON(saved.brain);
console.log(`champion gen ${saved.gen} (best from gen ${saved.championGen}), fitness ${Math.round(saved.fitness)}, stage ${saved.stage}`);
console.log(`embedder ${saved.embModel} dim ${saved.embDim}\n`);

/* Probe the champion on the stage it was TRAINED on, not the full bank.
 * Handing a stage-1 brain four-colour ordering tasks measures nothing except
 * that it has never seen one — and the resulting "grasped a forbidden colour"
 * lines read like a defect rather than an out-of-distribution question. */
const stage = STAGES[Math.max(0, Math.min(STAGES.length - 1, (saved.stage || 1) - 1))];
/* Probe the champion on the MISSIONS IT WAS ACTUALLY TRAINED ON — the stage's
 * fixed bank — and then, separately, on missions outside it.
 *
 * Sampling the stage's whole sentence pool instead conflates two very different
 * failures. A champion that scores 1-in-4 might be failing at the task, or it
 * might be perfect on its four training missions and lost on everything else.
 * Those need opposite fixes, and an aggregate cannot tell them apart. */
const bank = kindFilter ? null : missionBank(stage, "train");
const pool = TASKS.filter(t => {
    if (t.split !== "train") return false;
    if (kindFilter) return t.kind === kindFilter;
    if (stage.kinds && !stage.kinds.includes(t.kind)) return false;
    if (t.kind === "SORT" && t.params.colors.length > stage.maxColors) return false;
    return true;
});
console.log(`stage ${stage.id} (${stage.name}) — bank of ${bank ? bank.length : "n/a"} trained missions, ` +
    `${pool.length} sentences in the pool, up to ${stage.maxBalls} balls\n`);
const N = 8;

// how far up the ladder each episode got
const RUNGS = ["nothing", "approached", "grasped", "lifted", "carried", "delivered"];

function runSet(label, missions) {
console.log(`=== ${label} ===`);
const tally = new Array(RUNGS.length).fill(0);
let selAgree = 0, selTotal = 0, bucketAgree = 0, apertureOpenFrac = 0, ticks = 0;
for (let k = 0; k < missions.length; k++) {
    const m = missions[k];
    const task = m.task;
    const w = new World([brain], {
        task, embedding: Embedding.forTask(task),
        sceneSeed: m.sceneSeed, noiseSeed: m.noiseSeed, maxBalls: stage.maxBalls, noise: 0
    });
    const s = w.stations[0];
    let maxLift = 0, minBucketDist = 9, everGrasped = false, minBallDist = 9;
    let guard = 0;
    while (!w.isOver() && guard++ < 60 * 120) {
        w.step();
        const g = s.arm.graspPoint();
        const o = s.oracle();
        if (o.ball) {
            minBallDist = Math.min(minBallDist, Math.hypot(o.ball.x - g.x, o.ball.y - g.y, o.ball.z - g.z));
            if (o.bucket >= 0 && s.held >= 0) {
                minBucketDist = Math.min(minBucketDist,
                    Math.hypot(BUCKET.xs[o.bucket] - g.x, BUCKET.z - g.z));
            }
        }
        if (s.held >= 0) { everGrasped = true; maxLift = Math.max(maxLift, s.balls[s.held].y); }
        // does the pointer head agree with the rule?
        if (guard % 8 === 0 && o.ball) {
            selTotal++;
            const sb = s.sel.ball;
            if (sb >= 0 && sb < s.balls.length && s.balls[sb].id === o.ball.id) selAgree++;
            if (s.selBucket.idx === o.bucket) bucketAgree++;
        }
        apertureOpenFrac += s.arm.aperture() > OPEN_T ? 1 : 0;
        ticks++;
    }

    let rung = 0;
    if (minBallDist < 0.12) rung = 1;
    if (everGrasped) rung = 2;
    if (maxLift > BALL_R + 0.05) rung = 3;
    if (minBucketDist < 0.10) rung = 4;
    if (s.delivered > 0) rung = 5;
    tally[rung]++;

    console.log(`  "${task.text.slice(0, 62)}${task.text.length > 62 ? "…" : ""}"`);
    console.log(`    reached rung ${RUNGS[rung].toUpperCase().padEnd(10)} ` +
        `closest to ball ${minBallDist.toFixed(3)}m · peak lift ${(maxLift - BALL_R).toFixed(3)}m · ` +
        `closest to bucket ${minBucketDist < 9 ? minBucketDist.toFixed(3) + "m" : "never carried"}`);
    console.log(`    delivered ${s.delivered}/${s.evalr.target}  fitness ${s.fitness.toFixed(0)}  ` +
        `t=${s.t.toFixed(1)}s` + (s.log.length ? "  " + s.log.map(e => e.s).join(" | ") : ""));
    }

    const delivered = tally[RUNGS.length - 1];
    console.log(`  --> ${delivered}/${missions.length} delivered.  ` +
        RUNGS.map((r, i) => tally[i] ? `${tally[i]}x ${r}` : null).filter(Boolean).join(" · "));
    console.log(`  pointer heads agree with the rule: ball ${(100 * selAgree / selTotal).toFixed(0)}% · ` +
        `bucket ${(100 * bucketAgree / selTotal).toFixed(0)}%   (bucket chance is 25%)`);
    console.log(`  gripper held open ${(100 * apertureOpenFrac / ticks).toFixed(0)}% of the time\n`);
    return { delivered, of: missions.length };
}

/* In-bank first: this is the champion's TRAINING performance and it is the only
 * number the GA was ever optimising. Out-of-bank second: same stage, sentences
 * and scenes it has never seen. The gap between them is what says whether the
 * bank is being learned or merely memorised. */
const inBank = bank ? runSet(`TRAINED missions — the stage-${stage.id} bank`, bank) : null;

const outOfBank = [];
{
    const seen = new Set(bank ? bank.map(m => m.task.id) : []);
    for (let k = 0; outOfBank.length < N && k < pool.length * 4; k++) {
        const t = pool[(k * 53) % pool.length];
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        outOfBank.push({ task: t, sceneSeed: 700 + k * 29, noiseSeed: 800 + k });
    }
}
const outSet = runSet("UNSEEN missions — same stage, sentences and scenes it never trained on", outOfBank);

if (inBank) {
    console.log(`summary: ${inBank.delivered}/${inBank.of} on trained missions, ` +
        `${outSet.delivered}/${outSet.of} on unseen ones.`);
    if (inBank.delivered / inBank.of > 0.6 && outSet.delivered / outSet.of < 0.3)
        console.log(`  -> memorising the bank. Widen it (STAGES[].bank) rather than training longer.`);
    else if (inBank.delivered / inBank.of < 0.5)
        console.log(`  -> not even the trained missions are solved. The blocker is upstream of generalisation.`);
}
