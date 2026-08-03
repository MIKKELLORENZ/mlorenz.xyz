/* test_temporal.js — the differenced-window taps are what they claim to be.
 *
 *   node test_temporal.js
 *
 * The rolling sum is an optimisation: instead of averaging 45 frames per channel
 * per tick, it adds the frame entering the window and subtracts the one leaving.
 * That is three lines and every one of them is an off-by-one waiting to happen —
 * and a wrong window is invisible from the outside, because the walker still runs
 * and still scores, it just perceives a different past than the layout says. This
 * project has shipped exactly that failure before with a graft that "loads, runs,
 * scores plausibly, and is wired to the wrong sensors".
 *
 * So the sum is checked against a brute-force recomputation from an independently
 * kept frame history, every channel, every window, every control tick.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const MODEL = HUMANOID;

let fails = 0;
const ok = (name, pass, detail) => {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
    if (!pass) fails++;
};

console.log(`layout: NC ${NC}, NIN ${NIN}, MAXHIST ${MAXHIST}, windows ` +
    WIN.map(w => `${w[0]}-${w[1]} (${w[0] * 20}-${w[1] * 20} ms)`).join(", ") + "\n");

ok("MAXHIST is one deeper than the deepest window", MAXHIST === WIN[NWIN - 1][1] + 2,
    `${MAXHIST} vs ${WIN[NWIN - 1][1]} + 2`);
ok("NIN = channels + history taps", NIN === NC + TEMPORAL.reduce((a, s) => a + s.length, 0));
ok("inputs[c] is channel c for every c",
    TAP_PLAN.slice(0, NC).every((e, c) => e.ch === c && e.win === -1));
ok("windows are disjoint and ascending",
    WIN.every((w, i) => w[0] <= w[1] && (i === 0 || w[0] === WIN[i - 1][1] + 1)));
ok("every history tap carries a positive gain",
    TAP_PLAN.filter(e => e.win >= 0).every(e => e.gain > 0));

/* ---- the real check: rolling sums vs brute force, on a live episode ------- */
const rng = mulberry32(4242);
const brain = new Net(NET_SIZES, null, "tanh");
for (const w of brain.weights) for (let i = 0; i < w.length; i++) w[i] = (rng() * 2 - 1) * 0.5;

const world = new World(MODEL, [brain], { stage: 4, terrainDifficulty: 1, terrainId: "varied",
    missionSeed: 771, noiseSeed: 313, noise: false, groundFrac: 0 });
const wk = world.walkers[0];

const frames = [];                       // our own copy, oldest-first, never rotated
let lastWrite = -1, ticks = 0, worstSum = 0, worstTap = 0, clamped = 0, taps = 0, zeroish = 0;
while (!world.isOver() && ticks < 500) {
    world.step();
    if (wk.histWrite === lastWrite) continue;
    lastWrite = wk.histWrite;
    ticks++;
    /* histWrite has ALREADY advanced past the frame just written, so the current
     * frame is at histWrite - 1. Reading it as histWrite would silently test the
     * wrong tick and pass. */
    frames.push(Float32Array.from(wk.histBuf[(wk.histWrite - 1 + MAXHIST) % MAXHIST]));

    for (let w = 0; w < NWIN; w++) {
        const [a, b] = WIN[w];
        for (let c = 0; c < NC; c++) {
            let brute = 0;
            // lag L means L frames before the newest, which is frames[len-1]
            for (let L = a; L <= b; L++) {
                const idx = frames.length - 1 - L;
                if (idx >= 0) brute += frames[idx][c];
            }
            worstSum = Math.max(worstSum, Math.abs(brute - wk.winSum[w][c]));
        }
    }
    // and the taps themselves, recomputed from scratch
    for (let i = NC; i < TAP_PLAN.length; i++) {
        const e = TAP_PLAN[i], [a, b] = WIN[e.win];
        let s = 0, n = 0;
        for (let L = a; L <= b; L++) {
            const idx = frames.length - 1 - L;
            if (idx >= 0) { s += frames[idx][e.ch]; n++; }
        }
        const now = frames[frames.length - 1][e.ch];
        const want = n === 0 ? 0 : clamp((now - s / n) * e.gain, -1.5, 1.5);
        worstTap = Math.max(worstTap, Math.abs(want - wk.inputs[i]));
        taps++;
        if (Math.abs(wk.inputs[i]) >= 1.4999) clamped++;
        if (Math.abs(wk.inputs[i]) < 0.01) zeroish++;
    }
}

console.log();
ok(`rolling window sums match brute force over ${ticks} ticks`, worstSum < 2e-3,
    `worst absolute difference ${worstSum.toExponential(2)}`);
ok("assembled taps match a from-scratch recomputation", worstTap < 2e-3,
    `worst absolute difference ${worstTap.toExponential(2)}`);

/* Health of the encoding, not correctness — but a layout where most taps sit at
 * the clamp or at zero is one the gains got wrong, and that is worth failing on
 * before it costs a training run rather than after. */
const pc = n => (100 * n / taps).toFixed(1) + "%";
console.log(`\n  tap occupancy over ${taps} samples: ${pc(clamped)} at the clamp, ${pc(zeroish)} within 0.01 of zero`);
ok("under a tenth of taps are pinned at the clamp", clamped / taps < 0.10, pc(clamped));
ok("under half of taps are dead near zero", zeroish / taps < 0.50, pc(zeroish));

console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
