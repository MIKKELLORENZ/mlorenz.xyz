/* calibrate.js — measure the per-channel statistics of the 93 MEASURED
 * observation neurons and write them to obs_norm.js.
 *
 *   node calibrate.js
 *
 * WHY THIS EXISTS. The specification says "normalise every block independently
 * to roughly unit variance before it reaches the network, and log the scaling
 * constants". The hand-picked constants in Tokamak.NORM get the blocks to
 * roughly the right *order of magnitude*, which is not the same thing. Measured
 * across the task registry:
 *
 *     flux loops      mean  0.85 … 1.83     sd 0.086 … 0.27
 *     field probes    mean −2.47 … 0.22     sd 0.102 … 0.55
 *     coil currents   mean −0.45 … 1.20     sd 0.011 … 0.15
 *     ohmic diff      mean  2.74            sd 0.42
 *
 * — a large constant offset with the entire control signal riding on it at a
 * tenth of the amplitude. For a network trained by gradient descent that is
 * merely inefficient. For one searched by mutation it is close to fatal: almost
 * every weight change on those inputs moves the operating point of a tanh unit
 * rather than changing what the unit computes, and units sitting at |pre| ≫ 1
 * are saturated, so the mutation does nothing measurable at all. Whitening turns
 * "3.0 ± 0.05" into "0.0 ± 1.0", which is the difference between searching in
 * the signal and searching in the offset.
 *
 * Only the 93 measured channels are whitened. The previous-action block is
 * already ±1 by construction, and the target blocks are the task specification
 * rather than a measurement — whitening those against a particular task mix
 * would bake that mix into the encoding.
 *
 * The statistics are gathered from a deliberately mixed population: the PID
 * baseline (well-controlled trajectories), fresh random brains (drifting and
 * disrupting ones) and the current champion. Calibrating on PID episodes alone
 * would under-state the range a young population actually visits.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "greens.js", "machine.js", "tokamak.js", "tasks.js",
    "pid.js", "evolution.js", "world.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

const N_MEAS = 93;          // flux 34 + probes 38 + coils 18 + fast 1 + ohmdiff 1 + Ip 1
const EXT_FROM = 149;       // start of the temporal block (see HIST_LAGS in tokamak.js)
const STD_FLOOR = 0.02;     // in post-NORM units; below this a channel is noise, not signal

setObsMode("full");
refreshNetSizes();
const mac = getMachine();

/* Two disjoint ranges are calibrated: the 93 measured sensor neurons at the
 * front, and the whole temporal block at the back. Everything between them is
 * either the previous action (already ±1 by construction) or the requested
 * boundary (the task specification, not a measurement — whitening that against
 * a particular task mix would bake the mix into the encoding).
 *
 * The temporal block needs this MORE than the sensors do, not less. Its
 * channels are differences over lags spanning 0.1 ms to 6.4 ms, so their
 * natural amplitudes differ by two orders of magnitude across the block; a
 * single hand-picked divisor leaves the short lags as invisible dust and the
 * long ones saturating every tanh they touch. */
const N_EXT = N_TEMPORAL;
const N_ALL = N_MEAS + N_EXT;
const cnt = new Float64Array(N_ALL);
const s1 = new Float64Array(N_ALL);
const s2 = new Float64Array(N_ALL);

/* Channel k of the accumulator ← neuron idx(k) of the observation. */
function srcIndex(k) { return k < N_MEAS ? k : EXT_FROM + (k - N_MEAS); }

function accumulate(tok) {
    const o = tok.observe();
    for (let k = 0; k < N_ALL; k++) {
        const v = o[srcIndex(k)];
        cnt[k]++; s1[k] += v; s2[k] += v * v;
    }
}

let episodes = 0;
function runEpisode(tid, seed, controller) {
    const task = makeTask(tid, mac, mulberry32(seed));
    const tok = new Tokamak(mac, { rng: mulberry32(seed + 1), noise: true, randomise: true });
    tok.reset(task, mulberry32(seed + 1));
    const steps = Math.round(task.duration / DT_CTRL);
    let pid = null;
    if (controller === "pid") { pid = new PIDController(mac); pid.reset(task); }
    for (let i = 0; i < steps && !tok.dead; i++) {
        const a = pid ? pid.step(tok) : controller.forward(tok.observe());
        tok.step(a);
        if (!tok.dead && i % 5 === 0) accumulate(tok);
    }
    episodes++;
}

const champPath = path.join(__dirname, "training", "checkpoint.json");
let champ = null;
if (fs.existsSync(champPath)) {
    const ck = JSON.parse(fs.readFileSync(champPath, "utf8"));
    if (JSON.stringify(ck.net.sizes) === JSON.stringify(NET_SIZES)) champ = Net.fromJSON(ck.net);
}

for (const tid of TRAIN_TASKS) {
    for (let s = 0; s < 3; s++) {
        const seed = 31337 + s * 811;
        runEpisode(tid, seed, "pid");
        runEpisode(tid, seed + 7, new Net(NET_SIZES, mulberry32(seed + 3)));
        if (champ) runEpisode(tid, seed + 13, champ);
    }
}

const mean = new Float64Array(N_ALL), std = new Float64Array(N_ALL);
let floored = 0;
for (let k = 0; k < N_ALL; k++) {
    mean[k] = s1[k] / cnt[k];
    const v = Math.max(0, s2[k] / cnt[k] - mean[k] * mean[k]);
    std[k] = Math.sqrt(v);
    if (std[k] < STD_FLOOR) { std[k] = STD_FLOOR; floored++; }
}

const round = a => Array.from(a).map(v => +v.toFixed(6));
const slice = (a, from, to) => round(Array.prototype.slice.call(a, from, to));

/* THE SENSOR CONSTANTS ARE FROZEN once they exist.
 *
 * Re-measuring them would change what every already-trained brain sees on those
 * 93 neurons, and carrying a brain across that needs an old-constants →
 * new-constants graft rather than the raw → whitened one graft.js performs.
 * Nothing is gained by it: the sensor statistics are a property of the machine
 * and the task registry, both of which are fixed. So a recalibration ADDS the
 * temporal block and leaves the front of the vector exactly where it was, which
 * makes the graft a single well-defined segment.
 *
 * Delete obs_norm.js to force a full re-measurement — and then graft, or
 * retrain, every brain you intend to keep. */
let sensorMean = slice(mean, 0, N_MEAS), sensorStd = slice(std, 0, N_MEAS);
let frozen = false;
try {
    const prev = require(path.join(__dirname, "obs_norm.js")).OBS_NORM;
    if (prev && prev.mean && prev.mean.length >= N_MEAS) {
        sensorMean = prev.mean.slice(0, N_MEAS);
        sensorStd = prev.std.slice(0, N_MEAS);
        frozen = true;
    }
} catch (e) { /* first run: nothing to preserve */ }

const body =
    "/* obs_norm.js — GENERATED by calibrate.js. Per-channel whitening constants:\n" +
    " * x -> (x - mean)/std, applied on top of the block scaling in Tokamak.NORM.\n" +
    " *\n" +
    " * Two ranges. `mean`/`std` cover the 93 measured sensor neurons at the front\n" +
    " * of the observation; `ext` covers the temporal block (see HIST_LAGS in\n" +
    " * tokamak.js). Everything between them is either the previous action, already\n" +
    " * +/-1 by construction, or the requested boundary, which is the task\n" +
    " * specification rather than a measurement.\n" +
    " *\n" +
    " * The temporal block needs this MORE than the sensors do. Its channels are\n" +
    " * differences over lags from 0.1 ms to 6.4 ms and their natural amplitudes\n" +
    " * differ by two orders of magnitude: measured, the standard deviations run\n" +
    " * from 0.22 to 30. A single hand-picked divisor leaves the short lags as\n" +
    " * invisible dust and the long ones saturating every tanh they touch.\n" +
    " *\n" +
    ` * ${episodes} episodes across ${TRAIN_TASKS.length} tasks, PID + random + champion,\n` +
    ` * noise and domain randomisation on. ${floored} channels hit the ${STD_FLOOR} sd floor.\n` +
    (frozen ? " * Sensor constants carried over unchanged from the previous file.\n" : "") +
    " *\n" +
    " * CHANGING THIS FILE CHANGES WHAT EVERY EXISTING BRAIN SEES. A brain trained\n" +
    " * against one set of constants and evaluated against another is the classic\n" +
    " * silent failure this whole normalisation exists to avoid. Use\n" +
    " * `node graft.js` to carry a brain across a recalibration — the input-layer\n" +
    " * transform is exact, not approximate. */\n" +
    "const OBS_NORM = " + JSON.stringify({
        version: 2, n: N_MEAS, mean: sensorMean, std: sensorStd,
        ext: { from: EXT_FROM, mean: slice(mean, N_MEAS, N_ALL), std: slice(std, N_MEAS, N_ALL) }
    }) + ";\n" +
    "if (typeof window !== \"undefined\") window.OBS_NORM = OBS_NORM;\n" +
    "if (typeof module !== \"undefined\") module.exports = { OBS_NORM };\n";

fs.writeFileSync(path.join(__dirname, "obs_norm.js"), body);

console.log(`calibrated over ${episodes} episodes`);
console.log(`  ${floored}/${N_ALL} channels hit the sd floor of ${STD_FLOOR}`);
const show = (name, a, b) => {
    let mlo = 1e9, mhi = -1e9, slo = 1e9, shi = 0;
    for (let k = a; k < b; k++) {
        mlo = Math.min(mlo, mean[k]); mhi = Math.max(mhi, mean[k]);
        slo = Math.min(slo, std[k]); shi = Math.max(shi, std[k]);
    }
    console.log(`  ${name.padEnd(16)} mean [${mlo.toFixed(2)}, ${mhi.toFixed(2)}]  sd [${slo.toFixed(3)}, ${shi.toFixed(3)}]`);
};
show("flux loops", 0, 34); show("field probes", 34, 72); show("coil currents", 72, 90);
show("fast coil", 90, 91); show("ohmic diff", 91, 92); show("plasma current", 92, 93);
const E = N_MEAS;
show("observer/rates", E, E + 8);
show("lagged diffs", E + 8, E + 8 + 2 * HIST_LAGS.length + IP_LAGS.length);
show("integrals", E + 25, E + 28);
show("fast-coil temporal", E + 28, E + 32);
show("probe dB/dt", E + 32, N_ALL);
console.log("wrote obs_norm.js");
