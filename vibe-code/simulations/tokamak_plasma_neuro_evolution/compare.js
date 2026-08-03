/* compare.js — the honest scoreboard.
 *
 *   node compare.js [brain-file] [--episodes 12] [--level N] [--sweep]
 *
 * The brain file defaults to the committed default_brain.js, and may also be a
 * training checkpoint. Both are accepted — see brainfile.js.
 *
 * Runs three controllers over the whole task registry on seeds none of them
 * trained on, with sensor noise and domain randomisation on, and prints
 * survival, mean boundary error and disruption rate for each:
 *
 *   do nothing   — every coil holds its equilibrium current and nothing else.
 *                  This is the floor. A learned controller that does not beat
 *                  it has learned to make things worse.
 *   PID          — the hand-tuned cascade from pid.js.
 *   learned      — the checkpoint.
 *
 * The "do nothing" row exists because a controller commanding tiny voltages
 * scores *almost* the same as one commanding none, and on a plant that starts
 * from a solved equilibrium that is a very easy local optimum to mistake for
 * competence.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "greens.js", "machine.js", "tokamak.js", "tasks.js",
    "pid.js", "evolution.js", "world.js", "obs_norm.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

const { loadBrainFile } = require("./brainfile.js");

const argv = process.argv.slice(2);
const epArg = argv.indexOf("--episodes");
const EPISODES = epArg >= 0 ? parseInt(argv[epArg + 1], 10) : 12;
const lvArg = argv.indexOf("--level");
const LEVEL = lvArg >= 0 ? parseInt(argv[lvArg + 1], 10) : 0;
const SWEEP = argv.includes("--sweep");

/* The brain to score. Defaults to the committed champion, so this works in a
 * fresh clone with no training directory at all; pass a checkpoint path to
 * score a run in progress.
 *
 * The positional search has to skip the VALUE of every flag that takes one.
 * Picking the first token that does not start with `--` finds the `12` in
 * `--episodes 12` and tries to open a file called "12", which is a confusing
 * way to fail — and it only stayed hidden because every documented invocation
 * happened to put the path first. */
const VALUED = new Set(["--episodes", "--level"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
const ckPath = positional[0] || "default_brain.js";

const ck = loadBrainFile(ckPath);
setObsMode(ck.mode || "full");
refreshNetSizes();
const mac = getMachine();
const net = Net.fromJSON(ck.net);
if (JSON.stringify(net.sizes) !== JSON.stringify(NET_SIZES)) {
    console.error(`checkpoint is ${net.sizes.join("×")}, mode ${ck.mode} expects ${NET_SIZES.join("×")}`);
    process.exit(1);
}

/* Seeds none of the training used: training draws are floor((gen−1)/2)·131+ep,
 * which never reaches six figures. */
const SEEDS = [];
for (let i = 0; i < EPISODES; i++) SEEDS.push(500000 + i * 137);

const zeroBrain = { forward: () => new Float32Array(modeSpec().act) };

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d, n) => v.toFixed(d).padStart(n);

function evaluate(kind, level) {
    const rows = {};
    let all = { fit: 0, surv: 0, err: 0, dis: 0, n: 0 };
    for (const tid of TASK_DEFS.map(d => d.id)) {
        let fit = 0, surv = 0, err = 0, dis = 0;
        for (const s of SEEDS) {
            const w = new World(mac, kind === "pid" ? [] : [kind === "net" ? net : zeroBrain], {
                taskId: tid, missionSeed: s, noise: true, randomise: true,
                withPid: kind === "pid", level: level | 0
            });
            while (!w.isOver()) w.step();
            const r = kind === "pid" ? w.pidResult() : w.results()[0];
            fit += r.fitness; surv += r.survival; err += r.boundaryErr;
            if (r.disrupted) dis++;
        }
        const n = SEEDS.length;
        rows[tid] = { fit: fit / n, surv: surv / n, err: err / n, dis: dis / n };
        all.fit += fit; all.surv += surv; all.err += err; all.dis += dis; all.n += n;
    }
    rows._all = { fit: all.fit / all.n, surv: all.surv / all.n, err: all.err / all.n, dis: all.dis / all.n };
    return rows;
}

console.log(`checkpoint: ${ckPath}`);
// Checkpoints call it examFit, the baked file calls it exam. Same number.
const _ex = ck.examFit != null ? ck.examFit : ck.exam;
console.log(`  mode ${ck.mode} · ${net.sizes.join("×")} · generation ${ck.gen} · exam ${_ex != null ? _ex.toFixed(3) : "?"}`);
console.log(`  ${EPISODES} held-out episodes per task, noise on, domain randomisation on\n`);

console.log(`  difficulty rung L${LEVEL} (${difficultyOf(LEVEL).label})` +
    (ck.level != null ? ` · this brain trained up to L${ck.level}` : ""));

/* --sweep: one row per rung of the difficulty ladder instead of one per task.
 *
 * This is the table the ladder exists to produce. A controller that only wins on
 * the nominal machine has fitted the nominal machine; the question worth asking
 * is which controller degrades more gracefully as the wall gets thinner, the
 * plasma more elongated and the sensors noisier. */
if (SWEEP) {
    console.log("");
    console.log(pad("rung", 12) + "│ " + pad("do nothing", 24) + "│ " +
        pad("PID baseline", 24) + "│ learned");
    console.log(pad("", 12) + "│ " + pad("surv   err     disrupt", 24) + "│ " +
        pad("surv   err     disrupt", 24) + "│ surv   err     disrupt");
    console.log("─".repeat(90));
    for (let L = 0; L < N_LEVELS; L++) {
        let line = pad(`L${L} ${difficultyOf(L).label}`, 12) + "│ ";
        for (const k of ["zero", "pid", "net"]) {
            const r = evaluate(k, L)._all;
            line += num(r.surv * 100, 0, 4) + "% " + num(r.err * 100, 2, 6) + "cm " +
                num(r.dis * 100, 0, 4) + "%   " + (k === "net" ? "" : "│ ");
        }
        console.log(line);
    }
    process.exit(0);
}

const res = {
    nothing: evaluate("zero", LEVEL),
    pid: evaluate("pid", LEVEL),
    learned: evaluate("net", LEVEL)
};

console.log(pad("task", 12) + "│ " +
    pad("do nothing", 26) + "│ " + pad("PID baseline", 26) + "│ learned");
console.log(pad("", 12) + "│ " + pad("surv   err     disrupt", 26) + "│ " +
    pad("surv   err     disrupt", 26) + "│ surv   err     disrupt");
console.log("─".repeat(96));
for (const tid of TASK_DEFS.map(d => d.id)) {
    let line = pad(tid, 12) + "│ ";
    for (const k of ["nothing", "pid", "learned"]) {
        const r = res[k][tid];
        line += num(r.surv * 100, 0, 4) + "% " + num(r.err * 100, 2, 6) + "cm " +
            num(r.dis * 100, 0, 4) + "%   " + (k === "learned" ? "" : "│ ");
    }
    console.log(line);
}
console.log("─".repeat(96));
let line = pad("ALL", 12) + "│ ";
for (const k of ["nothing", "pid", "learned"]) {
    const r = res[k]._all;
    line += num(r.surv * 100, 0, 4) + "% " + num(r.err * 100, 2, 6) + "cm " +
        num(r.dis * 100, 0, 4) + "%   " + (k === "learned" ? "" : "│ ");
}
console.log(line);

const L = res.learned._all, Z = res.nothing._all, P = res.pid._all;
console.log(`\nmean fitness   do nothing ${Z.fit.toFixed(1)}   PID ${P.fit.toFixed(1)}   learned ${L.fit.toFixed(1)}`);
const beatsNothing = L.fit > Z.fit;
const beatsPid = L.fit > P.fit;
console.log(beatsNothing
    ? `learned beats doing nothing by ${(L.fit - Z.fit).toFixed(1)} fitness`
    : `learned does NOT beat doing nothing (${(L.fit - Z.fit).toFixed(1)}) — do not ship this brain`);
console.log(beatsPid
    ? `learned beats the PID baseline by ${(L.fit - P.fit).toFixed(1)} fitness`
    : `learned does not beat the PID baseline (${(L.fit - P.fit).toFixed(1)})`);
process.exit(beatsNothing ? 0 : 1);
