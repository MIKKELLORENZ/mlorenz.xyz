/* probe_leak.js — how much of the score is the referee whispering?
 *
 * Two of the twelve context features the brain reads are set by the REFEREE,
 * not by anything the arm could see:
 *
 *   ctx[9]       `delivered / MAX_BALLS`  — and `delivered` only increments when
 *                the evaluator judges a delivery CORRECT.
 *   ctx[5..8]    one-hot of `lastDeliveredColor`, which is likewise only set on
 *                a delivery the evaluator accepted.
 *
 * So during an episode the arm is told, for free, which of its drops were
 * scored as right. A real manipulator does not get that: it can see a ball land
 * in a bin, it cannot see the rulebook agree. The features matter most exactly
 * where the rules are hardest — ORDER and ALTERNATE both turn on "what did I
 * deliver last", and the honest version of that is "what did I last put in a
 * bin", not "what did the referee last accept".
 *
 * Three conditions, same brain, same benches:
 *
 *   as shipped   the leaky features, exactly as the page runs today
 *   honest       the same two features recomputed from what the arm could
 *                actually observe: every ball that ended up in ANY bin counts,
 *                right or wrong
 *   blind        both features zeroed, so the arm has no delivery history at all
 *
 * `honest` is the number that says what the arm is really worth. `blind` is a
 * floor, and the gap between blind and honest says how much the arm uses
 * delivery history at all.
 *
 * CAVEAT worth stating loudly: this brain was TRAINED with the leak, so
 * `honest` and `blind` also carry a distribution shift. They are an upper bound
 * on the damage, not a clean measurement of it — the clean one is a retrain.
 *
 *   node probe_leak.js [episodes]
 */
"use strict";
const { loadSim } = require("./simload.js");
loadSim(__dirname);
const fs = require("fs");

const N = parseInt(process.argv[2] || "500", 10);
const saved = JSON.parse(fs.readFileSync("training/distilled_fullbench.json", "utf8"));
const brain = Brain.fromJSON(saved.brain);

/* Track what the arm could HONESTLY know: every ball that reached a bin, and
 * the colour of the most recent one, regardless of the referee's opinion. */
const origDeposit = Station.prototype.deposit;
Station.prototype.deposit = function (ball, bucketIdx) {
    const r = origDeposit.call(this, ball, bucketIdx);
    this._anyCount = (this._anyCount || 0) + 1;
    this._anyLast = ball.color;
    return r;
};

const origSense = Station.prototype.sense;
function patchedSense(mode) {
    return function () {
        origSense.call(this);
        if (mode === "shipped") return;
        const C = this.ctx;
        for (let i = 5; i < 9; i++) C[i] = 0;
        C[9] = 0;
        if (mode === "honest") {
            if (this._anyLast !== undefined) C[5 + this._anyLast] = 1;
            C[9] = (this._anyCount || 0) / MAX_BALLS;
        }
    };
}

function run(mode, list, label) {
    Station.prototype.sense = patchedSense(mode);
    let del = 0, tgt = 0, comp = 0, n = 0;
    const pk = {};
    for (let i = 0; i < N; i++) {
        const t = list[i % list.length];
        const r = (Math.imul(i + 1, 2654435761)) >>> 0;
        const w = new World([brain], {
            task: t, embedding: Embedding.forTask(t),
            sceneSeed: 12345000 + (r % 100000), noiseSeed: 12345000 + ((r >>> 11) % 1000),
            maxBalls: MAX_BALLS, fill: 2.0,
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
    const b = 100 * del / Math.max(1, tgt), c = 100 * comp / Math.max(1, n);
    console.log(`  ${label.padEnd(12)} ${b.toFixed(1).padStart(5)}% balls  ${c.toFixed(1).padStart(5)}% tasks`);
    return { balls: b, tasks: c, pk };
}

for (const [split, list] of [["TRAINED", TASKS.filter(t => t.split === "train")],
["HELD-OUT", TASKS.filter(t => t.split !== "train")]]) {
    console.log(`\n${split} phrasings, ${N} episodes each:`);
    const a = run("shipped", list, "as shipped");
    const b = run("honest", list, "honest");
    const c = run("blind", list, "blind");
    console.log(`  -> the referee's whisper is worth ${(a.tasks - b.tasks).toFixed(1)} points of task completion`);
    const kinds = Object.keys(a.pk).sort();
    console.log(`  by kind, shipped -> honest (tasks%):`);
    for (const k of kinds) {
        const sa = 100 * a.pk[k].c / Math.max(1, a.pk[k].n), sb = 100 * b.pk[k].c / Math.max(1, b.pk[k].n);
        console.log(`     ${k.padEnd(11)} ${sa.toFixed(0).padStart(3)}% -> ${sb.toFixed(0).padStart(3)}%   (${(sb - sa >= 0 ? "+" : "") + (sb - sa).toFixed(0)})`);
    }
}
Station.prototype.sense = origSense;
