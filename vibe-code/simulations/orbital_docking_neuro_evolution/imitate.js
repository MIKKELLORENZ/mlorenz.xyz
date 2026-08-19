/* imitate.js — clone the scripted autopilot into the network by DAgger, then
 * hand the result to the genetic algorithm.
 *
 * WHY THIS FILE EXISTS. A well-tuned GA ran 260 generations on this task and
 * produced a champion with a held-out advantage of 0.011 and a docking rate of
 * zero, and the reason is arithmetic rather than tuning. A rendezvous episode
 * returns ONE scalar — where the flight fell between "coasted" and "the
 * autopilot" — after somewhere between two thousand and thirteen thousand
 * control decisions. Selection is being asked to attribute that single number
 * to all of them at once, and the per-episode spread of the number is larger
 * than the improvement any one mutation can produce. No number of generations
 * fixes a signal that thin. What fixes it is a training signal PER DECISION,
 * and there is a controller in pilot.js that will supply one: it docks every
 * auditioned scenario and it answers "what should be done here" instantly, from
 * any state, without waiting to see how the episode ends.
 *
 * THE TEACHER IS NOT A CEILING. It reads the true state with no noise, no lag
 * and no field of view, and it plans with a linearisation the world does not
 * obey; the network reads five noisy retroreflector returns through a 25° cone
 * and has to work out where the port is from them. So cloning does not
 * reproduce the teacher — it produces a policy that knows the SHAPE of the
 * answer, and the GA afterwards is free to exceed it. Expect the clone to score
 * below 1.0, and expect it to dock.
 *
 * THREE THINGS HAD TO BE TRUE BEFORE ANY OF THIS COULD WORK.
 *
 *  1. The label has to be a function of the STATE. The autopilot's `cmd` is
 *     not: it is the output of a delta-sigma pulse modulator, so the same state
 *     yields 0 or 1 depending on a hidden accumulator, and a network regressed
 *     onto that sequence recovers its conditional mean — which is exactly the
 *     sub-deadband duty that fires no thruster at all. The modulator therefore
 *     moved out of the pilot and into craft.js, where it now sits between EVERY
 *     controller and the hardware, and the label became the pre-modulator
 *     demand. That same change is what finally gives the network trim authority
 *     below one minimum impulse bit.
 *
 *  2. The label has to be achievable FROM HERE. The teacher is re-consulted at
 *     every decision from the state the student actually reached, never from a
 *     plan fixed at t = 0. A goal chosen once and then chased through a
 *     wandering student's trajectory becomes physically unreachable, and
 *     thousands of states end up labelled with an action that cannot be
 *     executed — which trains the network on contradictions and makes it worse
 *     every round.
 *
 *  3. The student has to visit its own states. So: beta-mixing. Round 0
 *     executes the teacher's action every time; later rounds hand over; the
 *     last round is beta = 0, which makes its numbers an honest on-policy
 *     measurement rather than a graded exercise.
 *
 * WHAT IS MEASURED EACH ROUND, and why both numbers are needed: loss on the
 * accumulated set, and loss on the states the CURRENT policy just visited, held
 * out of the fit. Training low while on-policy validation collapses is the
 * signature of a labelling bug — not of a method that does not work.
 *
 * HOW IT USES THE BOX. Backprop over a million samples is not something one
 * JavaScript thread finishes this side of tomorrow, so the fit is data-parallel
 * and the DATA NEVER MOVES: each worker keeps the samples it collected itself,
 * and every step ships weights out and summed gradients back — 300 kB each way
 * against a hundred milliseconds of arithmetic. The main thread owns the Adam
 * state and is the only writer.
 *
 *   node imitate.js --rounds 6 --episodes 300 --workers 60 --out training/imit
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const SIM_FILES = ["nn.js", "orbit.js", "craft.js", "station.js", "sensors.js",
    "scenarios.js", "pilot.js", "world.js", "evolution.js"];
function loadSim() {
    for (const f of SIM_FILES) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    }
}

const argv = process.argv.slice(2);
function arg(n, d) { const i = argv.indexOf("--" + n); if (i < 0) return d; const v = argv[i + 1]; return v === undefined || v.startsWith("--") ? true : v; }

const CFG = {
    rounds: parseInt(arg("rounds", 6), 10),
    episodes: parseInt(arg("episodes", 300), 10),
    steps: parseInt(arg("steps", 900), 10),      // optimiser steps per round
    perWorker: parseInt(arg("perworker", 192), 10),  // samples per worker per step
    lr: parseFloat(arg("lr", 0.002)),
    wd: parseFloat(arg("wd", 2e-6)),
    workers: parseInt(arg("workers", Math.max(1, Math.min(8, os.cpus().length - 2))), 10),
    stages: String(arg("stages", "0,1,2,3,4,5")).split(",").map(Number),
    seed: parseInt(arg("seed", 12345), 10),
    out: String(arg("out", "training/imit")),
    trunk: String(arg("trunk", "160,96")).split(",").map(Number),
    guid: String(arg("guid", "96")).split(",").map(Number),
    ctrl: String(arg("ctrl", "96")).split(",").map(Number),
    wGuid: parseFloat(arg("wguid", 0.5)),
    /* THE TEACHER IS DOING NOTHING MOST OF THE TIME, and plain MSE lets a
     * network exploit that. The attitude channel has a deadband, so roughly
     * nine states in ten carry the target "fire nothing"; the mean-squared
     * optimum for a network that cannot tell the acting states apart is to
     * output zero everywhere, which is a policy that scores a low loss and
     * flies into the tumbling limit. Weighting each sample by how much the
     * teacher is asking for lifts the acting states from a tenth of the
     * gradient to about a third, without discarding a single quiet one. */
    actW: parseFloat(arg("actw", 1)),
    /* BALANCE THE SET AT COLLECTION, which is a better lever than reweighting
     * it afterwards. The teacher is idling in about nine states out of ten --
     * it coasts, it has an attitude deadband, and once trimmed it does nothing
     * at all -- so a uniformly collected set has a mean-squared optimum very
     * close to "output zero", and a network that takes it scores a low loss and
     * flies into the tumbling limit. Measured on this task: the control head
     * explained two thirds of the target variance and essentially none of it on
     * the states where the teacher was asking for full authority.
     *
     * Every acting state is kept and the quiet ones are thinned, which leaves
     * the two roughly equal. Thinning rather than discarding matters: a network
     * that has never been shown a quiet state fires continuously and runs the
     * tank dry, which is the same failure from the other side. */
    quietKeep: parseFloat(arg("quietkeep", 0.16)),
    actThresh: parseFloat(arg("actthresh", 0.12)),
    cap: parseInt(arg("cap", 90000), 10),        // samples kept PER WORKER
    lrDecay: parseFloat(arg("lrdecay", 0.82)),
    resume: arg("resume", null),
    tag: String(arg("tag", "imit"))
};

/* ------------------------------------------------------------------ worker */
if (!isMainThread) {
    loadSim();
    setArch(workerData.arch);
    const NIN_ = NIN;
    const CAP = workerData.cap;
    /* The worker's own slice of the aggregate DAgger set. It is never sent
     * anywhere: gradients are computed here and only the sums travel. */
    const S = {
        n: 0, valFrom: 0,
        X: new Float32Array(CAP * NIN_),
        H: new Float32Array(CAP * 7),
        Y: new Float32Array(CAP * 13)
    };
    let brain = null;
    let tr = null;
    const rng = mulberry32(workerData.wseed);

    function unpackInto(b, o) {
        for (const k of ["trunk", "guid", "ctrl"]) {
            for (let l = 0; l < b[k].weights.length; l++) {
                b[k].weights[l].set(o[k].weights[l]);
                b[k].scales[l] = o[k].scales[l];
            }
        }
        return b;
    }

    /* Forward/backward over a Stack, keeping activations. */
    class Grad {
        constructor(st) {
            this.st = st;
            this.g = st.weights.map(w => new Float32Array(w.length));
            this.a = st.sizes.map(n => new Float64Array(n));
            this.d = st.sizes.map(n => new Float64Array(n));
        }
        zero() { for (const g of this.g) g.fill(0); }
        forward(input) {
            this.a[0].set(input);
            const st = this.st;
            for (let l = 0; l < st.weights.length; l++) {
                const w = st.weights[l], nIn = st.sizes[l], nOut = st.sizes[l + 1];
                const cur = this.a[l], next = this.a[l + 1];
                for (let o = 0; o < nOut; o++) {
                    const base = o * (nIn + 1);
                    let sum = w[base + nIn];
                    for (let i = 0; i < nIn; i++) sum += w[base + i] * cur[i];
                    next[o] = Math.tanh(sum);
                }
            }
            return this.a[st.sizes.length - 1];
        }
        /* `dOut` is dLoss/dActivation at the top; returns dLoss/dActivation at
         * the input, which is how each head reaches back into the trunk. */
        backward(dOut) {
            const st = this.st, L = st.weights.length;
            const top = this.d[L];
            for (let o = 0; o < st.sizes[L]; o++) { const y = this.a[L][o]; top[o] = dOut[o] * (1 - y * y); }
            for (let l = L - 1; l >= 0; l--) {
                const w = st.weights[l], g = this.g[l];
                const nIn = st.sizes[l], nOut = st.sizes[l + 1];
                const cur = this.a[l], dNext = this.d[l + 1], dCur = this.d[l];
                dCur.fill(0);
                for (let o = 0; o < nOut; o++) {
                    const dn = dNext[o];
                    if (dn === 0) continue;
                    const base = o * (nIn + 1);
                    for (let i = 0; i < nIn; i++) { g[base + i] += dn * cur[i]; dCur[i] += dn * w[base + i]; }
                    g[base + nIn] += dn;
                }
                if (l > 0) for (let i = 0; i < nIn; i++) dCur[i] *= (1 - cur[i] * cur[i]);
            }
            return this.d[0];
        }
    }

    function ensure(spec) {
        if (brain) return;
        brain = new Brain(spec, null);
        tr = { trunk: new Grad(brain.trunk), guid: new Grad(brain.guid), ctrl: new Grad(brain.ctrl) };
        tr.nLat = brain.spec.trunk[brain.spec.trunk.length - 1];
        tr.dLat = new Float64Array(tr.nLat);
        tr.dG = new Float64Array(7);
        tr.dC = new Float64Array(6);
        tr.ctrlIn = new Float32Array(tr.nLat + 7);
    }

    /* One sample's contribution to the gradients of all three stacks. */
    function accum(i, wGuid, actW) {
        let amp = 0;
        for (let k = 0; k < 6; k++) { const v = Math.abs(S.Y[i * 13 + k]); if (v > amp) amp = v; }
        const sw = 1 + actW * amp;
        const lat = tr.trunk.forward(S.X.subarray(i * NIN_, (i + 1) * NIN_));
        tr.dLat.fill(0);
        let lc = 0, lg = 0;
        const g = tr.guid.forward(lat);
        for (let k = 0; k < 7; k++) { const e = g[k] - S.Y[i * 13 + 6 + k]; tr.dG[k] = 2 * e * wGuid; lg += e * e; }
        const d1 = tr.guid.backward(tr.dG);
        for (let k = 0; k < tr.nLat; k++) tr.dLat[k] += d1[k];
        tr.ctrlIn.set(lat, 0);
        tr.ctrlIn.set(S.H.subarray(i * 7, i * 7 + 7), tr.nLat);
        const c = tr.ctrl.forward(tr.ctrlIn);
        for (let k = 0; k < 6; k++) { const e = c[k] - S.Y[i * 13 + k]; tr.dC[k] = 2 * e * sw; lc += e * e; }
        const d2 = tr.ctrl.backward(tr.dC);
        /* The control head's input is [latent, held]. Only the latent half
         * reaches the trunk: `held` is what the guidance head said four seconds
         * ago and is treated as a given, not differentiated through. The two
         * heads are two supervised problems that happen to share a trunk, which
         * is what keeps this stable. */
        for (let k = 0; k < tr.nLat; k++) tr.dLat[k] += d2[k];
        tr.trunk.backward(tr.dLat);
        return [lc / 6, lg / 7];
    }

    function lossOnly(i) {
        const lat = brain.trunk.forward(S.X.subarray(i * NIN_, (i + 1) * NIN_));
        const g = brain.guid.forward(lat);
        let lg = 0, lc = 0;
        for (let k = 0; k < 7; k++) { const e = g[k] - S.Y[i * 13 + 6 + k]; lg += e * e; }
        const c = brain.control(lat, S.H.subarray(i * 7, i * 7 + 7));
        for (let k = 0; k < 6; k++) { const e = c[k] - S.Y[i * 13 + k]; lc += e * e; }
        return [lc / 6, lg / 7];
    }

    parentPort.on("message", (m) => {
        if (m.stop) { process.exit(0); return; }

        if (m.cal) {
            const out = m.cal.map(j => {
                const sc = makeScenario(j.stage, j.seed);
                calibrate(sc);
                return { stage: j.stage, seed: j.seed, sNull: sc.sNull, sPilot: sc.sPilot, nullBest: sc.nullBest, usable: sc.usable };
            });
            parentPort.postMessage({ tag: m.tag, out });
            return;
        }

        if (m.setW) {
            ensure(m.setW.spec);
            unpackInto(brain, m.setW);
            parentPort.postMessage({ tag: m.tag, ok: 1 });
            return;
        }

        /* The round's freshly collected block is split: the last slice of it
         * is held out of the fit and becomes the ON-POLICY validation set —
         * states this policy actually reached, labelled by the teacher, never
         * fitted. Next round it folds back into training. */
        if (m.splitVal) {
            const fresh = S.n - m.splitVal.from;
            S.valFrom = S.n - Math.floor(fresh * m.splitVal.frac);
            parentPort.postMessage({ tag: m.tag, out: [{ n: S.n, valFrom: S.valFrom }] });
            return;
        }
        if (m.roundStart) { parentPort.postMessage({ tag: m.tag, out: [{ from: S.n }] }); return; }

        if (m.collect) {
            const j = m.collect;
            const sc = makeScenario(j.stage, j.seed);
            sc.sNull = j.sNull; sc.sPilot = j.sPilot; sc.nullBest = j.nullBest;
            ensure(j.spec || (brain && brain.spec));
            const r = runLabelled(sc, brain, { noiseSeed: j.noiseSeed, beta: j.beta });
            /* SUBSAMPLE BY RANGE, not uniformly. A far rendezvous makes 6,500
             * decisions and 6,000 of them are "hold this attitude and wait";
             * the last two hundred metres are where the docking is decided and
             * where the teacher's advice actually varies. Keeping everything
             * inside 400 m, half of the mid field and a quarter of the cruise
             * keeps the set from being 90% cruise without discarding the coast
             * decisions, which only exist out there. */
            let kept = 0, act = 0;
            const P = r.samples;
            const QK = workerData.quietKeep, AT = workerData.actThresh;
            for (let i = 0; i < P.length; i++) {
                const s = P[i];
                const stride = s.range < 400 ? 1 : (s.range < 5000 ? 2 : 4);
                if (!s.isGuid && (i % stride) !== 0) continue;
                let amp = 0;
                for (let k = 0; k < 6; k++) { const v = Math.abs(s.ctrl[k]); if (v > amp) amp = v; }
                if (amp >= AT) act++; else if (rng() > QK) continue;
                if (S.n >= CAP) {
                    /* Reservoir: once the shard is full a new sample replaces a
                     * uniformly chosen old one, so the set stays a fair mix of
                     * every round rather than freezing on round 0's teacher
                     * trajectories. */
                    const k = Math.floor(rng() * S.n);
                    S.X.set(s.input, k * NIN_); S.H.set(s.held, k * 7);
                    S.Y.set(s.ctrl, k * 13); S.Y.set(s.guid, k * 13 + 6);
                    kept++;
                    continue;
                }
                const k = S.n++;
                S.X.set(s.input, k * NIN_); S.H.set(s.held, k * 7);
                S.Y.set(s.ctrl, k * 13); S.Y.set(s.guid, k * 13 + 6);
                kept++;
            }
            parentPort.postMessage({
                tag: m.tag, kept, act, held: S.n,
                res: { stage: j.stage, adv: r.advantage, docked: r.docked, contact: r.contact, outcome: r.outcome, best: r.bestRange }
            });
            return;
        }

        if (m.grad) {
            const nb = Math.min(m.grad.n, S.valFrom);
            tr.trunk.zero(); tr.guid.zero(); tr.ctrl.zero();
            let lc = 0, lg = 0;
            for (let s = 0; s < nb; s++) {
                const i = Math.floor(rng() * S.valFrom);
                const l = accum(i, m.grad.wGuid, m.grad.actW);
                lc += l[0]; lg += l[1];
            }
            const gs = [];
            const tx = [];
            for (const k of ["trunk", "guid", "ctrl"]) for (const g of tr[k].g) { gs.push(g); tx.push(g.buffer); }
            parentPort.postMessage({ tag: m.tag, nb, lc, lg, gs }, tx);
            // Those buffers just left the thread; the accumulators need new ones.
            for (const k of ["trunk", "guid", "ctrl"]) tr[k].g = tr[k].st.weights.map(w => new Float32Array(w.length));
            return;
        }

        if (m.loss) {
            let tc = 0, tg = 0, tn = 0, vc = 0, vg = 0, vn = 0;
            const stepT = Math.max(1, Math.floor(S.valFrom / 3000));
            for (let i = 0; i < S.valFrom; i += stepT) { const l = lossOnly(i); tc += l[0]; tg += l[1]; tn++; }
            const stepV = Math.max(1, Math.floor((S.n - S.valFrom) / 3000));
            for (let i = S.valFrom; i < S.n; i += stepV) { const l = lossOnly(i); vc += l[0]; vg += l[1]; vn++; }
            parentPort.postMessage({ tag: m.tag, out: [{ tc, tg, tn, vc, vg, vn, n: S.n }] });
            return;
        }

        if (m.evalJobs) {
            const out = m.evalJobs.map(j => {
                const sc = makeScenario(j.stage, j.seed);
                sc.sNull = j.sNull; sc.sPilot = j.sPilot; sc.nullBest = j.nullBest;
                const r = runEpisode(sc, brain, { noiseSeed: j.noiseSeed });
                return { stage: j.stage, adv: r.advantage, docked: r.docked, contact: r.contact, outcome: r.outcome, best: r.bestRange, dv: r.dv };
            });
            parentPort.postMessage({ tag: m.tag, out });
            return;
        }
    });
    return;
}

/* -------------------------------------------------------------------- main */
loadSim();
const ARCH = { trunk: CFG.trunk, guidance: CFG.guid.concat([7]), control: CFG.ctrl.concat([6]) };
setArch(ARCH);
const SPEC = netSpec(NIN);
if (!fs.existsSync(path.join(__dirname, path.dirname(CFG.out)))) {
    fs.mkdirSync(path.join(__dirname, path.dirname(CFG.out)), { recursive: true });
}

function packBrain(b) {
    const p = (st) => ({ sizes: st.sizes, scales: st.scales.slice(), weights: st.weights.map(w => new Float32Array(w)) });
    return { spec: b.spec, trunk: p(b.trunk), guid: p(b.guid), ctrl: p(b.ctrl) };
}

const workers = [];
for (let i = 0; i < CFG.workers; i++) {
    workers.push(new Worker(__filename, {
        workerData: {
            arch: ARCH, cap: CFG.cap, quietKeep: CFG.quietKeep, actThresh: CFG.actThresh,
            wseed: (CFG.seed * 7919 + i * 104729) >>> 0
        }
    }));
}
let tagSeq = 0;
function ask(w, msg, transfer) {
    return new Promise(res => {
        const tag = ++tagSeq;
        const on = (m) => { if (m.tag !== tag) return; w.off("message", on); res(m); };
        w.on("message", on); w.postMessage(Object.assign({ tag }, msg), transfer);
    });
}
async function dispatch(jobs, key, onOne) {
    let next = 0;
    const out = [];
    await Promise.all(workers.map(async (w) => {
        for (; ;) {
            const i = next++;
            if (i >= jobs.length) break;
            const m = await ask(w, { [key]: key === "collect" ? jobs[i] : [jobs[i]] });
            if (onOne) onOne(m); else out.push.apply(out, m.out);
        }
    }));
    return out;
}
async function broadcast(msg) { return Promise.all(workers.map(w => ask(w, msg))); }

async function makeBank(stages, per, seedbase) {
    const want = [];
    for (const st of stages) for (let i = 0; i < per; i++) want.push({ stage: st, seed: seedbase + st * 7919 + i * 131 });
    const bank = [];
    let pool = want.slice(), attempt = 0;
    while (pool.length && attempt < 7) {
        const got = await dispatch(pool, "cal");
        const retry = [];
        for (const g of got) { if (g.usable) bank.push(g); else retry.push({ stage: g.stage, seed: g.seed + 7717 * (attempt + 1) }); }
        pool = retry; attempt++;
    }
    return bank;
}

/* Adam, on the main thread, over the summed gradients the workers return. */
class Adam {
    constructor(brain, lr, wd) {
        this.ws = [];
        for (const k of ["trunk", "guid", "ctrl"]) for (const w of brain[k].weights) this.ws.push(w);
        this.m = this.ws.map(w => new Float64Array(w.length));
        this.v = this.ws.map(w => new Float64Array(w.length));
        this.lr = lr; this.wd = wd; this.t = 0;
    }
    step(gs, scale) {
        this.t++;
        const b1 = 0.9, b2 = 0.999, eps = 1e-8;
        const bc1 = 1 - Math.pow(b1, this.t), bc2 = 1 - Math.pow(b2, this.t);
        for (let j = 0; j < this.ws.length; j++) {
            const w = this.ws[j], g = gs[j], m = this.m[j], v = this.v[j];
            for (let i = 0; i < w.length; i++) {
                const gi = g[i] * scale + this.wd * w[i];
                m[i] = b1 * m[i] + (1 - b1) * gi;
                v[i] = b2 * v[i] + (1 - b2) * gi * gi;
                w[i] -= this.lr * (m[i] / bc1) / (Math.sqrt(v[i] / bc2) + eps);
            }
        }
    }
}

(async () => {
    const proto = new Brain(SPEC, mulberry32(1));
    console.log(`imitate [${CFG.tag}]: ${CFG.rounds} rounds x ${CFG.episodes} episodes, ` +
        `arch trunk ${CFG.trunk} guid ${CFG.guid} ctrl ${CFG.ctrl} ` +
        `(${proto.weightCount()} weights, ${NIN} inputs), ${CFG.workers} workers, ` +
        `${CFG.steps} steps x ${CFG.perWorker * CFG.workers} batch`);

    let brain;
    if (CFG.resume) {
        const o = JSON.parse(fs.readFileSync(String(CFG.resume), "utf8"));
        brain = Brain.fromJSON(o.net || o);
        console.log(`resumed weights from ${CFG.resume}`);
    } else {
        /* FROM FRESH RANDOM WEIGHTS, never from the evolved champion —
         * measured worse elsewhere in this collection both on the loss and, far
         * more, in play. The champion here is a 0.011-advantage statue anyway. */
        brain = new Brain(SPEC, mulberry32(CFG.seed ^ 0x9e3779b9));
    }

    const perStage = Math.max(8, Math.ceil(CFG.episodes / CFG.stages.length / 3));
    const trainBank = await makeBank(CFG.stages, perStage, 41000);
    const testBank = await makeBank(CFG.stages, 6, 90000);
    console.log(`banks: ${trainBank.length} training scenarios, ${testBank.length} held-out`);

    const adam = new Adam(brain, CFG.lr, CFG.wd);
    const history = [];
    let best = null;

    for (let round = 0; round < CFG.rounds; round++) {
        /* BETA DECAYS TO EXACTLY ZERO. The final round must be fully on-policy
         * or its validation number measures a flight the deployed policy will
         * never make. */
        const beta = round === 0 ? 1 : Math.max(0, 1 - round / (CFG.rounds - 1));
        await broadcast({ setW: packBrain(brain) });
        const marks = (await broadcast({ roundStart: 1 })).map(m => m.out[0].from);

        const jobs = [];
        for (let i = 0; i < CFG.episodes; i++) {
            const b = trainBank[(i * 31 + round * 7) % trainBank.length];
            jobs.push(Object.assign({ noiseSeed: 100000 + round * 977 + i * 13, beta, spec: brain.spec }, b));
        }
        const t0 = Date.now();
        const res = [];
        let kept = 0, act = 0;
        await dispatch(jobs, "collect", (m) => { kept += m.kept; act += m.act; res.push(m.res); });
        const splits = await Promise.all(workers.map((w, i) => ask(w, { splitVal: { from: marks[i], frac: 0.12 } })));
        const nTrain = splits.reduce((a, m) => a + m.out[0].valFrom, 0);
        const nAll = splits.reduce((a, m) => a + m.out[0].n, 0);
        const dock = res.reduce((a, r) => a + r.docked, 0) / res.length;
        const cont = res.reduce((a, r) => a + r.contact, 0) / res.length;
        const advR = res.reduce((a, r) => a + r.adv, 0) / res.length;
        console.log(`\n== round ${round}  beta ${beta.toFixed(2)}  +${kept} samples from ${res.length} episodes in ` +
            `${((Date.now() - t0) / 1000).toFixed(0)}s   rollout adv ${advR.toFixed(3)} dock ${(dock * 100).toFixed(0)}% contact ${(cont * 100).toFixed(0)}%`);
        console.log(`   set ${nAll} samples: ${nTrain} fitted, ${nAll - nTrain} held out on-policy` +
            `   (${(100 * act / Math.max(1, kept)).toFixed(0)}% of new samples are acting states)`);

        /* -------------------------------------------------------- fit */
        /* The step budget is small on purpose. Measured on round 0: the control
         * loss reached its floor by step 150 of 1600 and then sat there, so the
         * remaining 90% of the fit bought nothing. What DAgger actually needs is
         * more ROUNDS — the value is in the states the improved policy goes on
         * to visit, not in another decimal place on states already fitted. The
         * learning rate decays per round so late rounds refine rather than
         * thrash a policy that already works. */
        adam.lr = CFG.lr * Math.pow(CFG.lrDecay, round);
        const t1 = Date.now();
        const nStack = brain.trunk.weights.length + brain.guid.weights.length + brain.ctrl.weights.length;
        for (let step = 0; step < CFG.steps; step++) {
            const ms = await Promise.all(workers.map(w => ask(w, { grad: { n: CFG.perWorker, wGuid: CFG.wGuid, actW: CFG.actW } })));
            let tot = 0, lc = 0, lg = 0;
            const sum = [];
            for (let j = 0; j < nStack; j++) sum.push(null);
            for (const m of ms) {
                if (!m.nb) continue;
                tot += m.nb; lc += m.lc; lg += m.lg;
                for (let j = 0; j < nStack; j++) {
                    if (!sum[j]) sum[j] = m.gs[j];
                    else { const a = sum[j], b2 = m.gs[j]; for (let i = 0; i < a.length; i++) a[i] += b2[i]; }
                }
            }
            if (!tot) { console.log("   no samples yet"); break; }
            adam.step(sum, 1 / tot);
            if (step % 150 === 0 || step === CFG.steps - 1)
                console.log(`   step ${step}  ctrl ${(lc / tot).toExponential(2)}  guid ${(lg / tot).toExponential(2)}`);
            await broadcast({ setW: packBrain(brain) });
        }
        const fitMs = Date.now() - t1;

        /* broadcast, not dispatch: every worker owns a different shard and all
         * of them have to be asked exactly once. */
        const ls = (await broadcast({ loss: 1 })).map(m => m.out[0]);
        const L = ls.reduce((a, r) => ({
            tc: a.tc + r.tc, tg: a.tg + r.tg, tn: a.tn + r.tn,
            vc: a.vc + r.vc, vg: a.vg + r.vg, vn: a.vn + r.vn, n: a.n + r.n
        }), { tc: 0, tg: 0, tn: 0, vc: 0, vg: 0, vn: 0, n: 0 });
        const trainLoss = { ctrl: L.tc / Math.max(1, L.tn), guid: L.tg / Math.max(1, L.tn) };
        const valLoss = { ctrl: L.vc / Math.max(1, L.vn), guid: L.vg / Math.max(1, L.vn) };
        console.log(`   fit ${(fitMs / 1000).toFixed(0)}s over ${L.n} samples   ` +
            `train ctrl ${trainLoss.ctrl.toExponential(2)} guid ${trainLoss.guid.toExponential(2)}   ` +
            `ON-POLICY VAL ctrl ${valLoss.ctrl.toExponential(2)} guid ${valLoss.guid.toExponential(2)}`);

        /* -------------------------------------------------- held-out exam */
        const ev = await dispatch(testBank.map((b, i) => Object.assign({ noiseSeed: 5000 + i * 17 }, b)), "evalJobs");
        const eAdv = ev.reduce((a, r) => a + r.adv, 0) / ev.length;
        const eDock = ev.reduce((a, r) => a + r.docked, 0) / ev.length;
        const eCont = ev.reduce((a, r) => a + r.contact, 0) / ev.length;
        const byStage = {};
        for (const st of CFG.stages) {
            const g = ev.filter(r => r.stage === st);
            if (g.length) byStage[st] = {
                adv: g.reduce((a, r) => a + r.adv, 0) / g.length,
                docked: g.reduce((a, r) => a + r.docked, 0) / g.length, n: g.length
            };
        }
        const oc = {};
        for (const r of ev) oc[r.outcome] = (oc[r.outcome] || 0) + 1;
        console.log(`   HELD-OUT adv ${eAdv.toFixed(3)}  dock ${(eDock * 100).toFixed(0)}%  contact ${(eCont * 100).toFixed(0)}%   ` +
            CFG.stages.map(s => byStage[s] ? `${s}:${byStage[s].adv.toFixed(2)}/${Math.round(byStage[s].docked * 100)}%` : "").join(" "));
        console.log("   " + Object.entries(oc).sort((a, b) => b[1] - a[1]).map(kv => kv[0] + ":" + kv[1]).join(" "));

        history.push({ round, beta, trainLoss, valLoss, exam: eAdv, dock: eDock, contact: eCont, byStage, rollout: { adv: advR, dock } });
        const rec = {
            format: "dock-brain-v1", nin: NIN, gen: 0, stage: Math.max.apply(null, CFG.stages),
            exam: eAdv, dockRate: eDock, byStage, round, history,
            lineage: `imitation: DAgger round ${round}/${CFG.rounds - 1} (beta ${beta.toFixed(2)}) from pilot.js`,
            net: brain.toJSON()
        };
        fs.writeFileSync(path.join(__dirname, CFG.out + `_r${round}.json`), JSON.stringify(rec));
        /* SNAPSHOT EVERY ROUND AND KEEP THE BEST: the endpoint is regularly not
         * the best point. */
        if (!best || eAdv > best.exam) {
            best = rec;
            fs.writeFileSync(path.join(__dirname, CFG.out + "_best.json"), JSON.stringify(rec));
            console.log("   new best -> " + CFG.out + "_best.json");
        }
    }
    console.log(`\ndone. best held-out advantage ${best.exam.toFixed(3)}, dock ${(best.dockRate * 100).toFixed(0)}%`);
    for (const w of workers) w.postMessage({ stop: 1 });
})();
