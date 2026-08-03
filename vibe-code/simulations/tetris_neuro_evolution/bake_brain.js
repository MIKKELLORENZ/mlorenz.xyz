/* bake_brain.js — copy a trained champion into default_brain.js, which is what
 * the page's "Load built-in champion" and "Showcase" buttons read.
 *
 *   node bake_brain.js                            # training/champion.json
 *   node bake_brain.js training/long/final.json
 *
 * Safe to re-run mid-run: train_headless.js rewrites champion.json every time
 * the champion improves. Before writing anything it re-plays the brain on seeds
 * it was never trained on, so the number in the header is a validation score and
 * not the training score that got it crowned.
 *
 * The sensor profile and architecture travel *with* the brain. A brain is a set
 * of weights against one exact input layout; hand it a different one and it does
 * not degrade, it reads garbage. The page reconfigures itself from what is baked
 * in here rather than assuming the current defaults still match.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "tetris.js", "sensors.js", "world.js", "configs.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const BASE_R = Object.assign({}, R);

const src = process.argv[2] || "training/champion.json";
const file = path.isAbsolute(src) ? src : path.join(__dirname, src);
const saved = JSON.parse(fs.readFileSync(file, "utf8"));
const net = saved.net || saved;

/* The brain's own config, if it recorded one — older champions predate this and
 * were all trained on the `full` profile with the 64→32 MLP. */
const runCfg = saved.config || { profile: "full", arch: { kind: "mlp", hidden: [64, 32] } };
const desc = applyConfig(runCfg, BASE_R);

const before = netFromJSON({ net });
if (before.contract() !== desc.contract) {
    console.error(`refusing to bake: brain is ${before.contract()} but its config says ${desc.contract}.`);
    process.exit(1);
}

// Weights are Float32, which carries about 7 significant decimal digits, so
// serialising 17 of them triples the file for nothing. Round to 7 and check
// the network still answers exactly the same.
const trimmed = Object.assign({}, net, {
    weights: net.weights.map(w => w.map(v => Number(v.toPrecision(7)))),
});
const after = netFromJSON({ net: trimmed });
const probe = new Float32Array(IN_SIZE);
for (let i = 0; i < probe.length; i++) probe[i] = Math.abs(Math.sin(i * 0.7)) * 0.6;
const a = before.forward(probe).slice(), b = after.forward(probe);
let worst = 0;
for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
if (worst > 1e-6) {
    console.error(`refusing to bake: rounding changed the output by ${worst.toExponential(2)}`);
    process.exit(1);
}

/* ---- validate on held-out piece sequences, against a random-brain control ----
 *
 * "It plays Tetris" is not something to take on faith from a training curve. The
 * champion and a set of brains that never evolved are played on the *same*
 * unseen piece sequences, and the comparison goes in the file header. If the
 * champion cannot beat untrained noise, that should be visible here and not
 * discovered by a user watching it stack garbage. */
const GAME_CFG = DEFAULT_CFG;      // the page's game, unchanged — never a variant
// 60, not 24: at ~0.13 lines per game, 24 games is three line clears in total,
// and a champion that cleared none looked strictly worse than one that cleared
// three when in fact they were identical. Small samples pick the wrong brain.
const N = 60;

function play(net, seeds) {
    let lines = 0, pieces = 0, fit = 0, score = 0, bestLines = 0, buried = 0, placements = 0;
    const m = { heights: new Int32Array(BW), holes: new Int32Array(BW) };
    for (const s of seeds) {
        const ag = new Agent(net, s, GAME_CFG);
        let prev = 0;
        while (ag.alive) {
            const ev = ag.step(400);
            if (ev && ev.locked) {
                const bm = boardMetrics(ag.game.grid, m);
                buried += Math.max(0, bm.totalHoles - prev); prev = bm.totalHoles; placements++;
            }
        }
        lines += ag.lines; pieces += ag.pieces; fit += ag.fitness; score += ag.game.score;
        if (ag.lines > bestLines) bestLines = ag.lines;
    }
    const n = seeds.length;
    return {
        lines: lines / n, pieces: pieces / n, fitness: fit / n, score: score / n,
        bestLines, buriedPerPiece: buried / Math.max(1, placements),
    };
}

const seeds = [];
for (let i = 0; i < N; i++) seeds.push(900001 + i * 7919);    // seeds training never saw
const val = play(after, seeds);

// control: untrained brains on the identical sequences
const ctrl = { lines: 0, pieces: 0, fitness: 0, score: 0, buriedPerPiece: 0 };
const CTRL_N = 8;
for (let i = 0; i < CTRL_N; i++) {
    const r = play(makeNet(mulberry32(4242 + i * 17)), seeds);
    for (const k of Object.keys(ctrl)) ctrl[k] += r[k] / CTRL_N;
}
val.control = ctrl;

const pct = (a, b) => (b > 0 ? `${(a / b).toFixed(1)}×` : "—");
const deadKeys = desc.keys.map((on, i) => (on ? null : KEY_NAMES[i])).filter(Boolean);
console.log(`config ${saved.configName || "default"} · ${desc.profile} profile · ` +
    `${desc.inputs} inputs · ${desc.contract} · ${desc.params.toLocaleString()} params` +
    (deadKeys.length ? ` · keys disabled: ${deadKeys.join(", ")}` : ""));
console.log(`validated on ${N} unseen piece sequences:`);
console.log(`  evolved champion : ${val.pieces.toFixed(1)} pieces  ${val.lines.toFixed(2)} lines  ` +
    `${val.buriedPerPiece.toFixed(2)} buried/piece  score ${val.score.toFixed(0)}  (best game ${val.bestLines} lines)`);
console.log(`  untrained brains : ${ctrl.pieces.toFixed(1)} pieces  ${ctrl.lines.toFixed(2)} lines  ` +
    `${ctrl.buriedPerPiece.toFixed(2)} buried/piece  score ${ctrl.score.toFixed(0)}`);
console.log(`  ratio            : ${pct(val.pieces, ctrl.pieces)} pieces, ` +
    `${pct(val.lines, ctrl.lines)} lines, ${pct(ctrl.buriedPerPiece, val.buriedPerPiece)} fewer holes buried`);
if (val.pieces <= ctrl.pieces * 1.15 && val.lines <= ctrl.lines) {
    console.log("\nWARNING: this champion is not meaningfully better than untrained noise.");
}

const body = `/* default_brain.js — the built-in champion.
 *
 * Written by \`node bake_brain.js\`; do not hand-edit.
 * Config: ${saved.configName || "default"} — ${desc.profile} sensor profile, ${desc.inputs} inputs.
 * Contract: ${desc.contract} (${desc.params.toLocaleString()} evolved numbers).
 * Evolved to generation ${saved.gen || "?"} by train_headless.js — no gradients.
 *
 * Validated on ${N} piece sequences it never trained on, against untrained brains
 * played on those same sequences:
 *              pieces   lines   buried/piece   score
 *   evolved    ${val.pieces.toFixed(1).padStart(6)}  ${val.lines.toFixed(2).padStart(6)}  ${val.buriedPerPiece.toFixed(2).padStart(12)}  ${val.score.toFixed(0).padStart(6)}
 *   untrained  ${ctrl.pieces.toFixed(1).padStart(6)}  ${ctrl.lines.toFixed(2).padStart(6)}  ${ctrl.buriedPerPiece.toFixed(2).padStart(12)}  ${ctrl.score.toFixed(0).padStart(6)}
 */
"use strict";
window.DEFAULT_BRAIN = ${JSON.stringify({
    net: trimmed,
    gen: saved.gen || 0,
    fitness: saved.fitness || 0,
    configName: saved.configName || "default",
    config: { profile: desc.profile, arch: desc.arch, reward: desc.reward, keys: desc.keys },
    contract: desc.contract,
    validation: val,
})};
`;
fs.writeFileSync(path.join(__dirname, "default_brain.js"), body);
console.log(`baked ${src} → default_brain.js (gen ${saved.gen}, ${desc.contract})`);
