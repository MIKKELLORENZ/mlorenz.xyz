/* imitate.js — start the search from a controller that already works.
 *
 *   node imitate.js --rounds 4 --scenarios 40 --epochs 60
 *   node imitate.js --eval training/bc.json
 *
 * WHY. The from-scratch search has to discover a multi-step temporal program
 * before a single product cell appears and any fitness at all is paid — and
 * now it has to discover FIVE of them and read the order form to know which.
 * Nothing in the mutation operator makes that likely: a fresh brain's outputs
 * sit near zero, a 5 µM dose is an output of +0.4, and the reward for a
 * partial program is a fraction of a partial yield. This is the
 * signal-limited case, and the repository already contains five controllers
 * that know their programs.
 *
 * This is imitation, then evolution. The clone is a floor, not a ceiling: the
 * GA that starts from it is what has to learn to adapt each recipe to the
 * line and the failures, which the protocols by construction cannot.
 *
 * ONE STUDENT, FIVE TEACHERS. Every round draws scenarios across all five
 * lineages and every rung, and the label comes from whichever protocol the
 * batch ordered. The student sees which product was ordered in its
 * observation (five inputs of the order block), so this is a conditional
 * clone: one network that runs a cardiac batch and a kidney batch through the
 * same weights. That is the whole point of the exercise and it is also the
 * reason the clone is worth more than five separate clones — the process
 * control is shared even where the biology is not.
 *
 * DAGGER, NOT PLAIN CLONING. Round 0 records the protocols' own runs. From
 * round 1 the STUDENT drives the reactor and the protocol is stepped
 * alongside it — PI integrators and all — and asked what it would do in the
 * state the student actually reached. A clone trained only on the expert's
 * trajectories is lost the moment its own small errors take it somewhere the
 * expert never went, and with a 15-to-27-day horizon that is everywhere.
 *
 * LABELS. The protocol's actuator object is mapped back through the inverse
 * of decodeAction into tanh space; the medium choice becomes three logits
 * (+0.8 for the chosen one, −0.8 for the others), and a dosing channel this
 * lineage does not use is labelled −0.9, i.e. "leave that pump alone". Every
 * label is in [−1, 1] by construction, so a tanh output layer can hit it
 * exactly.
 */
"use strict";
const fs = require("fs");
const path = require("path");
require("./harness.js");
const { loadBrainFile } = require("./brainfile.js");

const argv = process.argv.slice(2);
function arg(name, dflt) {
    const i = argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
const CFG = {
    rounds: parseInt(arg("rounds", 4), 10),
    scenarios: parseInt(arg("scenarios", 40), 10),
    epochs: parseInt(arg("epochs", 60), 10),
    batch: parseInt(arg("batch", 64), 10),
    lr: parseFloat(arg("lr", 0.002)),
    hidden: String(arg("hidden", "")),
    seed: parseInt(arg("seed", 11), 10),
    out: String(arg("out", "training/bc.json")),
    maxLevel: parseInt(arg("maxlevel", 3), 10),
    evalOnly: arg("eval", null)
};
const SIZES = CFG.hidden ? [N_IN].concat(CFG.hidden.split(",").map(Number)).concat([N_OUT]) : NET_SIZES;

/* actuator → tanh-space label, the inverse of decodeAction */
function encodeAction(a, L) {
    const y = new Float32Array(N_OUT);
    y[0] = (a.o2 - 0.21) / 0.30;
    y[1] = (a.co2 - 0.05) / 0.05;
    y[2] = a.base / 2.0;
    y[3] = (a.rpm - 70) / 50;
    y[4] = (a.perf - 0.7) / 1.3;
    y[5] = a.glcFeed / 1.5;
    for (let i = 0; i < N_CUE; i++) {
        const spec = L.cues[i];
        y[N_BASE + i] = spec ? a.cue[i] / spec.hi : -0.9;
    }
    for (let m = 0; m < N_MED; m++) y[N_BASE + N_CUE + m] = a.medium === m ? 0.8 : -0.8;
    for (let i = 0; i < N_OUT; i++) y[i] = Math.max(-0.95, Math.min(0.95, y[i]));
    return y;
}

/* One episode of data. With no student the protocol drives; with a student
 * the STUDENT drives and the protocol is stepped on the student's reactor
 * for the label only. */
function collect(seed, level, lin, student) {
    const scn = makeScenario(seed, level, lin);
    const L = scn.lin;
    const uSeed = seed * 7919 + 13;
    const unit = student ? new Unit(scn, student, null, uSeed) : new Unit(scn, null, new SOPController(L), uSeed);
    const teacher = student ? new SOPController(L) : unit.ctrl;
    if (teacher.reset) teacher.reset();
    const X = [], Y = [];
    for (let t = 0; t < scn.hours && !unit.done; t++) {
        // read the lab exactly as Unit.step will, then ask the teacher
        const r = unit.r;
        r.dist = disturbancesAt(scn, t);
        unit.lab.readOnline(r, t);
        unit.lab.sample(r, t);
        const obs = Float32Array.from(observe(unit.lab, r, t));
        const label = encodeAction(teacher.step(unit.lab, r, t), L);
        X.push(obs); Y.push(label);
        // now act: the student's own action, or the teacher's
        let act;
        if (student) act = decodeAction(student.forward(obs), unit.act, L);
        else act = teacher.prev;
        unit.lab.noteAction(act, t);
        unit.act = act;
        r.tick(act);
        unit.shaping += shapingPenalty(r);
        if (r.failed || r.t >= scn.hours - 1e-6) unit.finish();
    }
    return { X, Y, result: unit.result, lin: L.key };
}

/* ------------------------------------------------------------ training */
/* Plain backprop through the tanh stack in nn.js, Adam on the flat weights. */
function train(net, X, Y, epochs, rng) {
    const L = net.weights.length, sizes = net.sizes;
    const n = X.length;
    const m = net.weights.map(w => new Float64Array(w.length)), v = net.weights.map(w => new Float64Array(w.length));
    const g = net.weights.map(w => new Float64Array(w.length));
    const a = sizes.map(s => new Float64Array(s)), d = sizes.map(s => new Float64Array(s));
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    let step = 0;
    const order = Array.from({ length: n }, (_, i) => i);
    /* THE DOSING CHANNELS ARE MOSTLY OFF, AND THAT IS THE WHOLE DIFFICULTY.
     *
     * A twenty-seven-day protocol doses each reagent for two or three days, so
     * nine labels in ten for a dosing channel are zero and the mean-squared
     * optimum is to leave every pump shut. The first version of this weighted
     * the cue channels four times the gas loops, which was not remotely
     * enough: round 0 of the distillation drove its loss down to 0.06 and
     * produced a clone that made ZERO dopamine neurons and ZERO beta cells —
     * advantage −0.48 and −0.52, purity 0 %, yield 0.00 — while looking, by
     * its own loss curve, like it was learning nicely.
     *
     * So the weight is per SAMPLE as well as per channel: the hours when a
     * pump is actually running count twenty times, the hours when a pump this
     * protocol uses is deliberately off count two, and a pump this protocol
     * does not have at all counts one (there is nothing to learn but "leave it
     * alone"). This is ordinary class-imbalance reweighting, and it is the
     * difference between a clone and a placebo. */
    const WGT = new Float64Array(N_OUT);
    for (let o = 0; o < N_OUT; o++) WGT[o] = o < N_BASE ? 1 : o < N_BASE + N_CUE ? 4 : 2;
    const CUE_LO = N_BASE, CUE_HI = N_BASE + N_CUE;
    const wOf = (o, yv) => {
        if (o < CUE_LO || o >= CUE_HI) return WGT[o];
        if (yv <= -0.85) return 1;          // a pump this protocol does not use
        return yv > 0.02 ? 20 : 2;          // running, or deliberately off
    };
    for (let ep = 0; ep < epochs; ep++) {
        // shuffle
        for (let i = n - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
        let loss = 0;
        for (let s0 = 0; s0 < n; s0 += CFG.batch) {
            for (const gg of g) gg.fill(0);
            const bn = Math.min(CFG.batch, n - s0);
            for (let bi = 0; bi < bn; bi++) {
                const idx = order[s0 + bi];
                a[0].set(X[idx]);
                for (let l = 0; l < L; l++) {
                    const w = net.weights[l], ni = sizes[l], no = sizes[l + 1], cur = a[l], nx = a[l + 1];
                    for (let o = 0; o < no; o++) {
                        const base = o * (ni + 1);
                        let sum = w[base + ni];
                        for (let i = 0; i < ni; i++) sum += w[base + i] * cur[i];
                        nx[o] = Math.tanh(sum);
                    }
                }
                const out = a[L], dl = d[L], y = Y[idx];
                for (let o = 0; o < N_OUT; o++) {
                    const w = wOf(o, y[o]);
                    const e = out[o] - y[o];
                    loss += w * e * e;
                    dl[o] = w * e * (1 - out[o] * out[o]);
                }
                for (let l = L - 1; l >= 0; l--) {
                    const w = net.weights[l], gl = g[l], ni = sizes[l], no = sizes[l + 1];
                    const cur = a[l], dn = d[l + 1], dp = d[l];
                    dp.fill(0);
                    for (let o = 0; o < no; o++) {
                        const dv = dn[o];
                        if (dv === 0) continue;
                        const base = o * (ni + 1);
                        for (let i = 0; i < ni; i++) { gl[base + i] += dv * cur[i]; dp[i] += dv * w[base + i]; }
                        gl[base + ni] += dv;
                    }
                    if (l > 0) for (let i = 0; i < ni; i++) dp[i] *= (1 - cur[i] * cur[i]);
                }
            }
            step++;
            const lrT = CFG.lr * Math.sqrt(1 - Math.pow(b2, step)) / (1 - Math.pow(b1, step));
            for (let l = 0; l < L; l++) {
                const w = net.weights[l], gl = g[l], ml = m[l], vl = v[l];
                for (let i = 0; i < w.length; i++) {
                    const gi = gl[i] / bn;
                    ml[i] = b1 * ml[i] + (1 - b1) * gi;
                    vl[i] = b2 * vl[i] + (1 - b2) * gi * gi;
                    w[i] -= lrT * ml[i] / (Math.sqrt(vl[i]) + eps);
                }
            }
        }
        if (ep % 10 === 0 || ep === epochs - 1) process.stdout.write(`    epoch ${ep} loss ${(loss / n).toFixed(4)}\n`);
    }
}

/* ------------------------------------------------------------ evaluate */
/* Per lineage as well as overall: a clone that has learned four protocols and
 * lost the fifth is a specific, common and invisible failure if you only look
 * at the mean. */
function evaluate(net, label) {
    const rows = [];
    for (let li = 0; li < N_LIN; li++) {
        for (let L = 0; L <= CFG.maxLevel; L++) {
            for (let k = 0; k < 2; k++) {
                const w = new World([net], { seed: 800001 + k * 331 + L * 17 + li * 5, level: L, lin: li, withNothing: false }).run();
                const r = w.results()[0];
                rows.push({ li, L, adv: r.advantage, score: r.score, sop: w.sop.result.score, purity: r.purity, fold: r.fold, func: r.func, failed: r.failed });
            }
        }
    }
    const mean = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    console.log(`  ${label}: advantage ${mean(rows, r => r.adv).toFixed(3)}  ` +
        `score ${mean(rows, r => r.score).toFixed(0)} vs SOP ${mean(rows, r => r.sop).toFixed(0)}  lost ${rows.filter(r => r.failed).length}/${rows.length}`);
    for (let li = 0; li < N_LIN; li++) {
        const mine = rows.filter(r => r.li === li);
        console.log(`      ${LINEAGES[li].key.padEnd(8)} adv ${mean(mine, r => r.adv).toFixed(2).padStart(6)}  ` +
            `purity ${(mean(mine, r => r.purity) * 100).toFixed(0).padStart(3)}%  fold ${mean(mine, r => r.fold).toFixed(2)}  ` +
            `${LINEAGES[li].func.label} ${mean(mine, r => r.func).toFixed(2)}  lost ${mine.filter(r => r.failed).length}/${mine.length}`);
    }
    return mean(rows, r => r.adv);
}

if (CFG.evalOnly) {
    const net = Net.fromJSON(loadBrainFile(String(CFG.evalOnly)).net);
    evaluate(net, path.basename(String(CFG.evalOnly)));
    process.exit(0);
}

/* ------------------------------------------------------------ the loop */
(function main() {
    const rng = mulberry32(CFG.seed);
    let X = [], Y = [];
    let net = null, best = null, bestAdv = -1e9;
    const t0 = Date.now();
    for (let round = 0; round <= CFG.rounds; round++) {
        console.log(`round ${round}: collecting ${CFG.scenarios} scenarios ${round === 0 ? "driven by the protocols" : "driven by the student, labelled by the protocols"}`);
        let survived = 0;
        const perLin = new Array(N_LIN).fill(0);
        for (let k = 0; k < CFG.scenarios; k++) {
            const seed = 100000 + round * 1000 + k;
            const level = k % (CFG.maxLevel + 1);
            const lin = k % N_LIN;                  // every product, every round
            const c = collect(seed, level, lin, round === 0 ? null : net);
            X = X.concat(c.X); Y = Y.concat(c.Y);
            perLin[lin] += c.X.length;
            if (!c.result.failed) survived++;
        }
        console.log(`  pool ${X.length} samples (${survived}/${CFG.scenarios} runs survived; ` +
            `${perLin.map((n, i) => LINEAGES[i].key + " " + n).join(", ")})`);
        // retrain FROM SCRATCH on the union every round — the standard DAgger
        // recipe, and it avoids carrying a bad round forward
        net = new Net(SIZES, mulberry32(CFG.seed + round));
        // the output layer's tiny GA init would take forever to train up;
        // give it an ordinary scale for regression
        const lo = net.weights.length - 1;
        for (let i = 0; i < net.weights[lo].length; i++) net.weights[lo][i] *= 50;
        train(net, X, Y, CFG.epochs, rng);
        net.calibrateScales();
        const adv = evaluate(net, `round ${round} clone`);
        const file = CFG.out.replace(/\.json$/, `_r${round}.json`);
        fs.writeFileSync(path.join(__dirname, file), JSON.stringify({ format: "bioreactor-brain-v1", gen: 0, level: CFG.maxLevel, examFit: adv, round, sizes: SIZES, net: net.toJSON() }));
        if (adv > bestAdv) { bestAdv = adv; best = { net: net.clone(), round }; }
        console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
    }
    fs.writeFileSync(path.join(__dirname, CFG.out), JSON.stringify({ format: "bioreactor-brain-v1", gen: 0, level: CFG.maxLevel, examFit: bestAdv, round: best.round, sizes: SIZES, net: best.net.toJSON() }));
    console.log(`\nbest clone: round ${best.round}, advantage ${bestAdv.toFixed(3)} → ${CFG.out}`);
    console.log(`hand it to the GA:  node train.js --init ${CFG.out} --gens 2000`);
})();
