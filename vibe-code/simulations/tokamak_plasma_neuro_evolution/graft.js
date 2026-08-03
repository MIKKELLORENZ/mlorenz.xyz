/* graft.js — carry a brain across a change of input normalisation, exactly.
 *
 *   node graft.js training/checkpoint.json [out.json]
 *
 * Changing obs_norm.js changes what every neuron in the input layer is fed, so a
 * brain trained before the change is, naively, worthless afterwards. It is not:
 * the change is affine, and an affine change of input can be absorbed exactly
 * into the first layer's weights and biases.
 *
 * The old network computed, for hidden unit o:
 *
 *     pre = Σ_k W[o,k]·x_k + b[o]
 *
 * where x is the old (block-scaled, un-whitened) observation. The new input is
 * x'' = (x − m)/σ, so x = σ·x'' + m, and
 *
 *     pre = Σ_k (W[o,k]·σ_k)·x''_k + ( b[o] + Σ_k W[o,k]·m_k )
 *
 * Therefore W''[o,k] = W[o,k]·σ_k and b''[o] = b[o] + Σ_k W[o,k]·m_k, over the
 * whitened channels only; the rest are untouched. This is an identity, not an
 * approximation, and the script checks it numerically on random inputs before
 * writing anything.
 *
 * The point of grafting rather than retraining is that the whitening is meant to
 * make the *search* better conditioned, not to change the policy. The run that
 * follows starts from exactly the behaviour the previous run ended with.
 *
 * TWO RANGES. The observation now has two whitened segments — the 93 sensor
 * neurons at the front and the temporal block at the back — and a brain may
 * have been trained against one, both, or neither. `obsNormVersion` on the
 * checkpoint records which, and only the missing segments are grafted. Whitening
 * a channel that was already whitened is not a graft but a corruption, and a
 * quiet one, because the result still runs.
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

const inPath = process.argv[2] || "default_brain.js";
const outPath = process.argv[3] || inPath.replace(/\.(json|js)$/, "_grafted.json");

const ck = loadBrainFile(inPath);
setObsMode(ck.mode || "full");
refreshNetSizes();

const oldNet = Net.fromJSON(ck.net);
const nIn = oldNet.sizes[0], nHid = oldNet.sizes[1];
if (nIn !== modeSpec().obs) {
    console.error(`graft needs a brain matching the current interface: checkpoint is ` +
        `${nIn} wide, mode ${ck.mode || "full"} is ${modeSpec().obs}`);
    process.exit(1);
}

/* Which whitened ranges this brain has NOT yet been carried across. */
const had = ck.obsNormVersion || 0;
const SEGMENTS = [];
if (had < 1) SEGMENTS.push({ name: "sensors", from: 0, mean: OBS_NORM.mean, std: OBS_NORM.std });
if (had < 2 && OBS_NORM.ext) {
    SEGMENTS.push({
        name: "temporal", from: OBS_NORM.ext.from,
        mean: OBS_NORM.ext.mean, std: OBS_NORM.ext.std
    });
}
if (!SEGMENTS.length) {
    console.error(`nothing to graft: checkpoint is already at obs_norm v${had}, ` +
        `current file is v${OBS_NORM.version}`);
    process.exit(2);
}
for (const sg of SEGMENTS) {
    if (sg.from + sg.mean.length > nIn) {
        console.error(`obs_norm segment "${sg.name}" at ${sg.from} runs past the ${nIn}-neuron input`);
        process.exit(1);
    }
}
console.log(`grafting v${had} → v${OBS_NORM.version}: ` +
    SEGMENTS.map(sg => `${sg.name} [${sg.from}, ${sg.from + sg.mean.length})`).join(", "));

const newNet = oldNet.clone();
const W = newNet.weights[0];          // nHid × (nIn + 1), bias in the last column
const rowLen = nIn + 1;

for (let o = 0; o < nHid; o++) {
    const base = o * rowLen;
    let db = 0;
    for (const sg of SEGMENTS) {
        for (let j = 0; j < sg.mean.length; j++) {
            const k = sg.from + j;
            db += W[base + k] * sg.mean[j];
            W[base + k] = W[base + k] * sg.std[j];
        }
    }
    W[base + nIn] += db;
}

/* ---- verify: same function, to floating-point precision ---- */
const rng = mulberry32(4242);
let worst = 0;
for (let trial = 0; trial < 400; trial++) {
    // a plausible NEW (whitened) observation, and the OLD vector it came from
    const xNew = new Float32Array(nIn), xOld = new Float32Array(nIn);
    for (let k = 0; k < nIn; k++) {
        const v = gaussRand(rng) * 1.5;
        xNew[k] = v; xOld[k] = v;
    }
    for (const sg of SEGMENTS) {
        for (let j = 0; j < sg.mean.length; j++) {
            xOld[sg.from + j] = xNew[sg.from + j] * sg.std[j] + sg.mean[j];
        }
    }
    const a = oldNet.forward(xOld), b = newNet.forward(xNew);
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
}
console.log(`graft check: worst output difference over 400 random inputs = ${worst.toExponential(3)}`);
if (!(worst < 2e-5)) {
    console.error("GRAFT FAILED — the transform is not function-preserving, refusing to write");
    process.exit(1);
}

const out = Object.assign({}, ck, {
    net: newNet.toJSON(),
    obsNormVersion: OBS_NORM.version,
    graftedFrom: inPath
});
fs.writeFileSync(path.join(__dirname, outPath), JSON.stringify(out));
console.log(`wrote ${outPath} (generation ${ck.gen}, obs_norm v${OBS_NORM.version})`);
