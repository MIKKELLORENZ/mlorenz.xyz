/* probe_reference.js — watch the scripted controller work, event by event.
 *
 *   node probe_reference.js                 four tasks of every kind
 *   node probe_reference.js SORT 6          six SORT tasks
 *
 * When the reference controller under-performs, the question is always which
 * rung it falls off: does it fail to grasp, drop on the way, miss the bucket,
 * or simply run out of clock. Aggregate ball counts cannot tell those apart.
 * This prints the ledger's own event log next to the clock.
 */
"use strict";

const { loadSim } = require("./simload.js");
loadSim(__dirname);

const KINDS = ["SORT", "ALTERNATE", "LEAVE_ONE", "COUNT", "ORDER", "EXCLUDE", "ALL_TO_ONE"];
const wantKind = process.argv[2];
const runs = parseInt(process.argv[3] || "4", 10);
const kinds = wantKind ? [wantKind.toUpperCase()] : KINDS;

let totDel = 0, totTgt = 0, totComplete = 0, totRuns = 0;

for (const kind of kinds) {
    const pool = TASKS.filter(t => t.kind === kind && t.split === "train");
    console.log(`\n=== ${kind} ===`);
    for (let k = 0; k < runs; k++) {
        const task = pool[(k * 37) % pool.length];
        const brain = new Brain(Embedding.dim, mulberry32(1));
        const w = new World([brain], {
            task, embedding: Embedding.forTask(task),
            sceneSeed: 100 + k * 13, noiseSeed: 11, maxBalls: 6
        });
        const s = w.stations[0];
        s.policy = makeReferencePolicy();
        let guard = 0;
        while (!w.isOver() && guard++ < 60 * 120) w.step();

        totDel += s.delivered; totTgt += s.evalr.target;
        totComplete += s.completed ? 1 : 0; totRuns++;

        const scene = s.balls.map(b => COLORS[b.color][0]).join("");
        console.log(`  "${task.text}"`);
        console.log(`    scene [${scene}]  target ${s.evalr.target}  delivered ${s.delivered}` +
            `  ${s.completed ? "COMPLETE" : "incomplete"}  t=${s.t.toFixed(1)}s clock=${s.clock.toFixed(1)}s` +
            `  fitness ${s.fitness.toFixed(0)}`);
        for (const e of s.log) console.log(`      ${e.t.toFixed(1)}s  ${e.s}`);
        if (!s.log.length) console.log(`      (no events — never grasped anything)`);
    }
}

console.log(`\ntotal: ${totDel}/${totTgt} balls delivered, ${totComplete}/${totRuns} tasks complete ` +
    `(${(100 * totDel / totTgt).toFixed(0)}% of balls)`);
