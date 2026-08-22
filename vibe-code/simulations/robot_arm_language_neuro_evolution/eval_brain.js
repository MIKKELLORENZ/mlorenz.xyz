/* eval_brain.js — score a brain on a bank it was never selected on.
 *
 *   node eval_brain.js training/distilled_c12_e18.json [episodes] [seedBase]
 *
 * WHY THIS IS A SEPARATE SCRIPT. `distill.js` snapshots each round at several
 * epoch counts and keeps whichever scores best on held-out phrasings. That is
 * the right way to choose, and it makes the winner's own score a biased
 * estimate of it: picking the maximum of five noisy evaluations of the same 784
 * episodes inflates the winner by roughly the spread of the noise, and the
 * spread here is not small — five snapshots of one round covered 52.4% to 61.1%
 * of tasks with training losses that were indistinguishable.
 *
 * So the number that gets quoted anywhere has to come from a bank that took no
 * part in the choosing. Pass a `seedBase` that the trainer never used (it
 * evaluates at 900000; this defaults to 12345000) and report what comes back,
 * whether or not it is lower than the number that won the selection. It usually
 * is lower. That is the point.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadSim } = require("./simload.js");
loadSim(__dirname);

const src = process.argv[2] || path.join("training", "distilled_best.json");
const N = parseInt(process.argv[3] || "784", 10);
const SEED = parseInt(process.argv[4] || "12345000", 10);
/* THE BENCH HAS TO MATCH THE ONE BEING SHIPPED.
 *
 * This script was written when a scene held 3-6 balls and it kept saying so
 * (`maxBalls: 3 + r % 4`, no `fill`) after the page moved to a bench of nine.
 * It ran fine and reported confident numbers for a distribution nobody sees —
 * which is the worst kind of measurement bug, because the output looks healthy.
 * The default here is the page's own playback configuration. */
const FILL = parseFloat(process.argv[5] || "2.0");

const p = path.isAbsolute(src) ? src : path.join(__dirname, src);
const saved = JSON.parse(fs.readFileSync(p, "utf8"));
if (saved.embDim && saved.embDim !== Embedding.dim) {
    console.error(`embedding width mismatch: brain expects ${saved.embDim}, the bank provides ${Embedding.dim}.`);
    process.exit(1);
}
const brain = Brain.fromJSON(saved.brain);

function run(list, label) {
    let del = 0, tgt = 0, comp = 0, n = 0;
    const pk = {};
    for (let i = 0; i < N; i++) {
        const t = list[i % list.length];
        const r = (Math.imul(i + 1, 2654435761)) >>> 0;
        const w = new World([brain], {
            task: t, embedding: Embedding.forTask(t),
            sceneSeed: SEED + (r % 100000), noiseSeed: SEED + ((r >>> 11) % 1000),
            maxBalls: MAX_BALLS, fill: FILL,
            noise: [0, 0.2, 0.35, 0.5][(r >>> 17) % 4]
        });
        const s = w.stations[0];
        let g = 0;
        while (!w.isOver() && g++ < 60 * 140) w.step();
        del += s.delivered; tgt += s.evalr.target; comp += s.completed ? 1 : 0; n++;
        const k = t.kind;
        if (!pk[k]) pk[k] = { d: 0, t: 0, c: 0, n: 0 };
        pk[k].d += s.delivered; pk[k].t += s.evalr.target; pk[k].c += s.completed ? 1 : 0; pk[k].n++;
    }
    const b = del / Math.max(1, tgt), c = comp / Math.max(1, n);
    // binomial standard error on the task rate, so a difference can be judged
    const se = Math.sqrt(Math.max(1e-9, c * (1 - c) / Math.max(1, n)));
    console.log(`  ${label}: ${(100 * b).toFixed(1)}% balls   ${(100 * c).toFixed(1)}% tasks  (+/- ${(100 * se).toFixed(1)} SE, ${n} eps)`);
    for (const k of Object.keys(pk).sort())
        console.log(`      ${k.padEnd(11)} ${(100 * pk[k].d / Math.max(1, pk[k].t)).toFixed(0)}% balls  ${(100 * pk[k].c / Math.max(1, pk[k].n)).toFixed(0)}% tasks`);
    return { balls: b, tasks: c, se };
}

console.log(`\nbrain:   ${src}`);
console.log(`lineage: ${saved.lineage || "unrecorded"}`);
console.log(`bank:    seedBase ${SEED} (the trainer selects on 900000)\n`);
run(TASKS.filter(t => t.split === "train"), "trained phrasings ");
run(TASKS.filter(t => t.split !== "train"), "HELD-OUT phrasings");
