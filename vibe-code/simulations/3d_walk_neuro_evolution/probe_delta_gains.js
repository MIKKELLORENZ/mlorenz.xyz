/* probe_delta_gains.js — how big is (NOW - window mean), per channel, really?
 *
 *   node probe_delta_gains.js [champion.json]
 *
 * The new temporal code feeds differences rather than raw lagged samples, and a
 * difference is much smaller than the value it came from — so each one needs a
 * gain, or it arrives at the network as a near-zero input that mutation has no
 * reason to touch. Picking those gains by eye is how a channel ends up either
 * saturated at the clamp or invisible, and both failures look like "the GA is
 * slow" from the outside.
 *
 * So they are measured. This replays real episodes, records every channel at
 * every control tick, and reports the 95th percentile of |NOW - mean(W)| per
 * channel group per window. The gain that puts that percentile at 1.0 is what
 * the layout should use.
 *
 * Sampled over BOTH walking starts and floor-pose starts: a walker lying on its
 * side moves its channels very differently from one crossing a stair, and a gain
 * tuned on only one of those is tuned for half the curriculum.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const MODEL = HUMANOID;

const file = process.argv[2] || path.join(__dirname, "training/champion_gen2931.json");
const saved = JSON.parse(fs.readFileSync(file, "utf8"));
const brain = Net.fromJSON(saved.net || saved);

/* The windows the proposal defines. Disjoint on purpose: three nested or
 * exponentially-weighted averages are heavily correlated with each other, so
 * each extra input would mostly re-encode what the previous one already said.
 * Disjoint eras are close to independent. */
const WIN = [[1, 3], [4, 15], [16, 60]];
const DEPTH = 61;                       // WIN[2][1] + 1

/* Channel groups, named so the report reads as a layout decision rather than as
 * 194 anonymous numbers. Must stay in step with the C_* offsets in walker.js. */
const GROUPS = [
    ["grav", C_GRAV, 3], ["gyro", C_GYRO, 3], ["pelvisVel", C_VEL, 3],
    ["height", C_HEIGHT, 1], ["upright", C_UPRIGHT, 1],
    ["jointAngle", C_QA, NJ], ["jointRate", C_QD, NJ],
    ["footLoad", C_LOAD, 2], ["contact", C_CONTACT, 2], ["footPos", C_FOOTPOS, 6],
    ["efference", C_EFFERENCE, NJ],
    ["comVel", C_COMVEL, 3], ["comHeight", C_COMH, 1],
    ["comPos", C_COMPOS, 2], ["capture", C_CAPTURE, 2],
    ["footClear", C_FOOTCLR, 2], ["footAtt", C_FOOTATT, 4]
];

/* One reservoir per (group, window). Absolute deltas, kept unsorted until the
 * end; a few hundred thousand doubles is nothing and an exact percentile beats
 * a streaming estimate for a one-off calibration. */
const samples = GROUPS.map(() => WIN.map(() => []));

function collect(opts, ticks) {
    const w = new World(MODEL, [brain], opts);
    const x = w.walkers[0];
    const ring = [];
    let lastWrite = -1, n = 0;
    while (!w.isOver() && n < ticks) {
        w.step();
        if (x.histWrite === lastWrite) continue;         // not a control tick
        lastWrite = x.histWrite;
        const cur = x.histBuf[(x.histWrite - 1 + MAXHIST) % MAXHIST];
        ring.push(Float32Array.from(cur));
        if (ring.length > DEPTH) ring.shift();
        if (ring.length < DEPTH) continue;
        n++;
        const now = ring[ring.length - 1];
        for (let gi = 0; gi < GROUPS.length; gi++) {
            const [, c0, cn] = GROUPS[gi];
            for (let wi = 0; wi < WIN.length; wi++) {
                const [a, b] = WIN[wi];
                for (let c = c0; c < c0 + cn; c++) {
                    let s = 0;
                    for (let L = a; L <= b; L++) s += ring[ring.length - 1 - L][c];
                    samples[gi][wi].push(Math.abs(now[c] - s / (b - a + 1)));
                }
            }
        }
    }
}

console.log(`sampling ${path.basename(file)} — windows ${WIN.map(w => w[0] + "-" + w[1]).join(", ")} ticks\n`);
for (let k = 0; k < 6; k++)
    collect({ stage: 4, terrainId: "varied", missionSeed: 300 + k * 41,
              noiseSeed: 700 + k * 17, noise: true, groundFrac: 0 }, 400);
for (let k = 0; k < 4; k++)
    collect({ stage: 4, terrainId: "varied", missionSeed: 5100 + k * 31,
              noiseSeed: 900 + k * 23, noise: true, groundFrac: 1, seatFrac: 0, poseFrac: 1 }, 400);

const pct = (a, p) => { a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
console.log("  channel group     n ch     W1 (20-60ms)        W2 (80-300ms)       W3 (320-1200ms)");
console.log("                           p95    -> gain      p95    -> gain      p95    -> gain");
const gains = {};
for (let gi = 0; gi < GROUPS.length; gi++) {
    const [name, , cn] = GROUPS[gi];
    const row = [], g = [];
    for (let wi = 0; wi < WIN.length; wi++) {
        const p = pct(samples[gi][wi], 0.95);
        /* Gain rounded to something a human can read in the source. A gain above
         * 200 means the channel barely moves over that window and the difference
         * is noise being amplified — reported so the layout can drop it rather
         * than feed the network an amplified nothing. */
        const raw = p > 1e-9 ? 1 / p : 0;
        const nice = raw === 0 ? 0 : Number(raw.toPrecision(2));
        row.push(p.toFixed(4).padStart(8) + " ->" + String(nice).padStart(7));
        g.push(nice);
    }
    gains[name] = g;
    console.log(`  ${name.padEnd(16)} ${String(cn).padStart(4)}  ${row.join("  ")}`);
}
fs.writeFileSync(path.join(__dirname, "training/delta_gains.json"),
    JSON.stringify({ windows: WIN, source: path.basename(file), gains }, null, 2));
console.log(`
Gain = 1 / p95, so the 95th-percentile excursion lands at 1.0 and the clamp only
catches genuine outliers. Written to training/delta_gains.json.
A gain far above ~200 means that channel hardly moves across that window — the
difference there is amplified sensor noise, and the layout should drop the tap
rather than pay 48 weights to feed it in.`);
