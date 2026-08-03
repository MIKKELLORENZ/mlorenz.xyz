/* bake_brain.js — copy a trained champion into default_brain.js, which is what
 * the page's "Load built-in champion" and "Showcase" buttons read.
 *
 *   node bake_brain.js                          # training/champion.json
 *   node bake_brain.js training/champion_gen400.json
 *
 * Safe to re-run at any point during a training run: train.js rewrites
 * training/champion.json every --save-every generations.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

const src = process.argv[2] || "training/champion.json";
const file = path.isAbsolute(src) ? src : path.join(__dirname, src);
const saved = JSON.parse(fs.readFileSync(file, "utf8"));
const net = saved.net || saved;

if (net.sizes.join() !== NET_SIZES.join()) {
    console.error(`refusing to bake: brain is ${net.sizes.join("-")} but this build expects ${NET_SIZES.join("-")}.`);
    console.error("The saved brain was trained against a different sensor or output contract.");
    process.exit(1);
}
/* Weights are Float32, so serialising the full 17 digits of a double triples the
 * file for nothing. NINE is the number to round to, not seven: 9 significant
 * decimal digits is exactly what IEEE-754 single precision needs to round-trip
 * (FLT_DECIMAL_DIG), and Net.fromJSON loads into Float32Array, so at 9 digits the
 * reloaded weights are bit-for-bit the originals and the check below is an
 * identity rather than a tolerance.
 *
 * It was 7, which is the number of digits float32 *carries* rather than the
 * number it needs to survive a round trip — close enough that it worked for
 * months and drifted out of tolerance as the champion's weights grew. The output
 * error had reached 1.13e-6 against a 1e-6 limit. With ReLU the activations are
 * unbounded, so a fixed relative rounding error becomes a growing absolute one,
 * and any threshold picked here would have been crossed again later. */
const PRECISION = 9;
const before = Net.fromJSON(net);
/* `act` and `slopes` ride along. Dropping them bakes a ReLU champion as a tanh
 * network — the browser would load a brain that is not the one that was trained,
 * and the only symptom would be a walker that falls over. The rounding check
 * below does catch it (the outputs diverge wildly), but it catches it as a
 * confusing "rounding changed the output" error, so carry them properly. */
const trimmed = {
    sizes: net.sizes, act: net.act, slopes: net.slopes || null,
    weights: net.weights.map(w => w.map(v => Number(v.toPrecision(PRECISION))))
};
const after = Net.fromJSON(trimmed);
const probe = new Float32Array(NET_SIZES[0]);
for (let i = 0; i < probe.length; i++) probe[i] = Math.sin(i * 0.7) * 0.6;
const a = before.forward(probe).slice(), b = after.forward(probe);
let worst = 0;
for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
/* At 9 digits this should be exactly zero. The tolerance is kept only so a future
 * precision change cannot silently ship a brain that is not the one that trained;
 * anything above it means the weights did not survive the round trip and the
 * browser would be playing back a different network. */
if (worst > 1e-9) {
    console.error(`refusing to bake: rounding changed the output by ${worst.toExponential(2)} ` +
        `(precision ${PRECISION}) — the baked brain is not the trained one`);
    process.exit(1);
}

const weights = net.weights.length + " layers, " +
    net.weights.reduce((s, w) => s + w.length, 0).toLocaleString() + " weights";
/* The name is taken from the TRIMMED weights — the ones that actually land in
 * the file — so the id printed here is the id the browser will compute when it
 * loads them. Naming the pre-rounding genome instead would give a code that
 * matches nothing anyone can see. */
const id = brainId(Net.fromJSON(trimmed));
/* THE STAGE THE BRAIN WAS TRAINED ON, carried with it.
 *
 * The showcase used to pin stage 4 at full difficulty because the run it was
 * written for had finished at stage 5. Point it at a brain from a younger run
 * and it drops a stage-2 walker into 2.5x the shove and wind it has never met
 * once — it falls over immediately, and the honest reading of that is "the
 * transfer is broken", which is what it looked like. A brain has to carry the
 * conditions it was bred under or the demo is not showing the brain.
 *
 * Taken from the run history the trainer saves alongside the weights; a file
 * with no history keeps null and the showcase falls back to a safe stage. */
const stage = (() => {
    if (typeof saved.stage === "number") return saved.stage;
    const h = saved.history;
    if (Array.isArray(h) && h.length && typeof h[h.length - 1].stage === "number")
        return h[h.length - 1].stage;
    return null;
})();
const body = `/* default_brain.js — the built-in champion.
 *
 * Written by \`node bake_brain.js\`; do not hand-edit. Contract: ${net.sizes.join("-")}
 * (${weights}). Trained to generation ${saved.gen || "?"}, fitness ${(saved.fitness || 0).toFixed(0)}${saved.savedAt ? ", " + saved.savedAt.slice(0, 10) : ""}.
 *
 * Brain id ${id} — a deterministic hash of these weights. The same code appears
 * in the browser's watch mode, so what is on screen can be checked against what
 * was baked without trusting either label.
 */
"use strict";
/* \`var\`, not \`const\`, and deliberately so: the browser's "Reload brain" button
 * re-reads this file by appending a second cache-busted <script> tag, and a
 * second \`const\` declaration at global scope throws. \`var\` reassigns. Node's
 * runInThisContext hoists it to a global either way, so nothing else changes. */
var DEFAULT_BRAIN = ${JSON.stringify({ net: trimmed, fitness: saved.fitness || 0, gen: saved.gen || 0, id, stage })};
`;
fs.writeFileSync(path.join(__dirname, "default_brain.js"), body);
console.log(`baked ${src} -> default_brain.js  (gen ${saved.gen}, fitness ${(saved.fitness || 0).toFixed(0)}, ${net.sizes.join("-")}, id ${id}, stage ${stage == null ? "unknown" : stage})`);
