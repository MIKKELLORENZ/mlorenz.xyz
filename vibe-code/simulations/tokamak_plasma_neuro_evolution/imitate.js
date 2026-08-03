/* imitate.js — start the search from a controller that already works.
 *
 *   node imitate.js --rounds 3 --seeds 8 --epochs 30 --workers 16
 *   node imitate.js --eval training/bc.json
 *
 * WHY. Evolution from random weights spent three runs rediscovering, badly,
 * something this repository already contains: pid.js holds all seven short
 * tasks at 0.8–4.2 cm. The genetic algorithm was scoring −84 on the same exam
 * the PID scores +11 on. Handing the population a brain that already behaves
 * like the baseline turns the whole run from "invent feedback control" into
 * "improve on a known controller", which is the only version of this problem a
 * few hours of CPU can actually win.
 *
 * This is imitation, then evolution — the standard two-stage recipe. It is also
 * the only place in this project where a gradient is used at all: cloning a
 * known teacher is a supervised regression, and pretending otherwise would mean
 * throwing away a hundred-fold speed-up for no reason. Everything after this
 * point is mutation and selection, as before.
 *
 * DAgger, NOT PLAIN CLONING. Train only on the expert's own trajectories and
 * the clone is excellent on states the expert visits and lost everywhere else —
 * and since its own small errors take it off the expert's distribution within a
 * few milliseconds, "everywhere else" is where it spends the episode. So after
 * the first round the ROLLOUTS come from the student and the LABELS come from
 * the teacher: the PID controller is stepped alongside the student's plasma,
 * integrators and all, and asked what it would have done in the state the
 * student actually reached. Each round adds those states to the pool.
 *
 * WHAT THE CLONE CANNOT INHERIT. The PID's three integrators and its 2 kHz
 * outer-loop phase are internal state that no observation carries, so a perfect
 * fit is not available and the loss floor is not zero. The temporal block (see
 * HIST_LAGS in tokamak.js) exists partly to close that gap: leaky integrals and
 * multi-lag differences are precisely the quantities the teacher keeps in its
 * own state and the old memoryless observation had no way to express.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const SIM_FILES = ["nn.js", "greens.js", "machine.js", "tokamak.js", "tasks.js",
    "pid.js", "evolution.js", "world.js", "obs_norm.js"];
function loadSim() {
    for (const f of SIM_FILES) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    }
}

const SUB = 2;              // keep every 2nd control step — consecutive 0.1 ms
                            // samples are near-duplicates and only cost memory
const ACT_WEIGHT = 18;      // the fast coil, weighted up in the loss (see below)

/* ============================================================== worker === */
if (!isMainThread) {
    loadSim();
    setObsMode("full");
    refreshNetSizes();
    const mac = getMachine();
    const pid = new PIDController(mac);      // built once: the observer fit is not cheap
    let shard = null;                        // {X, Y, n} once training starts
    let net = null, grads = null;
    const rng = mulberry32(workerData.seed | 0);

    /* One episode of data. With no brain, the PID drives and we record its own
     * trajectory. With a brain, the BRAIN drives and the PID is stepped on the
     * brain's plasma purely to be asked what it would have done — its
     * integrators wind against the student's states, which is what makes this
     * DAgger and not a relabelling trick. */
    function collect(taskId, seed, netJSON) {
        const brain = netJSON ? Net.fromJSON(netJSON) : null;
        const w = new World(mac, brain ? [brain] : [], {
            taskId, missionSeed: seed, noise: true, randomise: true,
            withPid: !brain, pidController: brain ? null : pid
        });
        const tok = brain ? w.units[0].tok : w.pid.tok;
        const ctrl = brain ? pid : w.pid.ctrl;
        if (brain) ctrl.reset(w.task);
        const nIn = NET_SIZES[0];
        const X = [], Y = [];
        let k = 0;
        while (!w.isOver() && !tok.dead) {
            const keep = (k % SUB) === 0;
            let o = null;
            if (keep) o = Float32Array.from(tok.observe());
            // The label is always the PID's command IN THIS STATE. For the
            // expert rollout that is also the action applied; for a student
            // rollout it is not, and must be read before w.step() advances
            // anything.
            const a = brain ? Float32Array.from(ctrl.step(tok)) : null;
            w.step();
            if (keep) {
                X.push(o);
                Y.push(a || Float32Array.from(w.pid.act));
            }
            k++;
        }
        const n = X.length;
        const xb = new Float32Array(n * nIn), yb = new Float32Array(n * 19);
        for (let i = 0; i < n; i++) { xb.set(X[i], i * nIn); yb.set(Y[i], i * 19); }
        return { xb, yb, n, steps: k, survived: !tok.dead };
    }

    /* Summed gradient of ½·Σ w·(tanh_out − y)² over a random minibatch of this
     * worker's shard. Plain backpropagation through the tanh stack in nn.js;
     * the weight layout (row-major, bias in the last column) is the same one
     * mutate() and crossover() walk. */
    function gradient(batch) {
        const sizes = net.sizes, L = net.weights.length;
        const nIn = sizes[0];
        const a = sizes.map(n => new Float32Array(n));
        const d = sizes.map(n => new Float32Array(n));
        for (const g of grads) g.fill(0);
        let loss = 0;
        for (let b = 0; b < batch; b++) {
            const s = (rng() * shard.n) | 0;
            a[0].set(shard.X.subarray(s * nIn, s * nIn + nIn));
            for (let l = 0; l < L; l++) {
                const w = net.weights[l], ni = sizes[l], no = sizes[l + 1];
                const cur = a[l], nx = a[l + 1];
                for (let o = 0; o < no; o++) {
                    const base = o * (ni + 1);
                    let sum = w[base + ni];
                    for (let i = 0; i < ni; i++) sum += w[base + i] * cur[i];
                    nx[o] = Math.tanh(sum);
                }
            }
            const out = a[L], dl = d[L];
            const yo = s * 19;
            for (let o = 0; o < 19; o++) {
                // The nineteen outputs are NOT equally important. Eighteen of
                // them trim slow shaping currents; output 18 is the fast coil,
                // the one actuator standing between an elongated plasma and the
                // wall, and it is a nineteenth of a uniform loss. Weighting it
                // up is the difference between a clone that survives and one
                // that tracks the shape beautifully for four milliseconds.
                const wgt = o === ACT_WEIGHT ? 4 : 1;
                const e = out[o] - shard.Y[yo + o];
                loss += wgt * e * e;
                dl[o] = wgt * e * (1 - out[o] * out[o]);
            }
            for (let l = L - 1; l >= 0; l--) {
                const w = net.weights[l], g = grads[l], ni = sizes[l], no = sizes[l + 1];
                const cur = a[l], dn = d[l + 1], dp = d[l];
                dp.fill(0);
                for (let o = 0; o < no; o++) {
                    const dv = dn[o];
                    if (dv === 0) continue;
                    const base = o * (ni + 1);
                    for (let i = 0; i < ni; i++) {
                        g[base + i] += dv * cur[i];
                        dp[i] += w[base + i] * dv;
                    }
                    g[base + ni] += dv;
                }
                if (l > 0) for (let i = 0; i < ni; i++) dp[i] *= 1 - cur[i] * cur[i];
            }
        }
        return loss;
    }

    parentPort.on("message", (msg) => {
        if (msg.stop) { process.exit(0); return; }
        if (msg.collect) {
            const out = msg.jobs.map(j => collect(j.taskId, j.seed, msg.net));
            parentPort.postMessage({
                collected: out.map(o => ({ n: o.n, steps: o.steps, survived: o.survived, xb: o.xb, yb: o.yb }))
            }, out.flatMap(o => [o.xb.buffer, o.yb.buffer]));
            return;
        }
        if (msg.shard) {
            shard = { X: new Float32Array(msg.X), Y: new Float32Array(msg.Y), n: msg.n };
            net = Net.fromJSON(msg.net);
            grads = net.weights.map(w => new Float32Array(w.length));
            parentPort.postMessage({ ready: true });
            return;
        }
        if (msg.grad) {
            for (let l = 0; l < net.weights.length; l++) net.weights[l].set(msg.w[l]);
            const loss = gradient(msg.batch);
            parentPort.postMessage({ g: grads.map(g => g), loss, count: msg.batch });
            return;
        }
    });
    return;
}

/* ================================================================ main === */
loadSim();
const argv = process.argv.slice(2);
function arg(name, dflt) {
    const i = argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
const CFG = {
    rounds: parseInt(arg("rounds", 3), 10),
    seeds: parseInt(arg("seeds", 8), 10),
    epochs: parseInt(arg("epochs", 24), 10),
    batch: parseInt(arg("batch", 2048), 10),
    lr: parseFloat(arg("lr", 3e-3)),
    workers: parseInt(arg("workers", Math.max(2, os.cpus().length - 2)), 10),
    out: String(arg("out", "training/bc.json")),
    seed: parseInt(arg("seed", 12345), 10),
    evalOnly: arg("eval", null)
};

setObsMode("full");
refreshNetSizes();
const mac = getMachine();

/* Held-out evaluation, deliberately the same shape as the trainer's exam so the
 * numbers printed here can be compared with the numbers printed there. The PID
 * runs the identical episode — same task object, same seed, same noise — so the
 * comparison is paired, not two independent averages. */
const EVAL_SEEDS = [660001, 660002, 660003];
function evaluate(net, label) {
    let bf = 0, bs = 0, be = 0, bd = 0, pf = 0, ps = 0, pe = 0, pd = 0, n = 0;
    const rows = [];
    for (const tid of TRAIN_TASKS) {
        let tf = 0, te = 0, ts = 0;
        for (const s of EVAL_SEEDS) {
            const w = new World(mac, [net], { taskId: tid, missionSeed: s, noise: true, randomise: true, withPid: true });
            while (!w.isOver()) w.step();
            const r = w.results()[0], p = w.pidResult();
            bf += normalizeFitness(r.fitness, 40); bs += r.survival; be += r.boundaryErr; if (r.disrupted) bd++;
            pf += normalizeFitness(p.fitness, 40); ps += p.survival; pe += p.boundaryErr; if (p.disrupted) pd++;
            tf += r.fitness; te += r.boundaryErr; ts += r.survival;
            n++;
        }
        rows.push(`    ${tid.padEnd(10)} fit ${(tf / EVAL_SEEDS.length).toFixed(1).padStart(7)}  ` +
            `err ${(100 * te / EVAL_SEEDS.length).toFixed(2).padStart(5)} cm  surv ${(100 * ts / EVAL_SEEDS.length).toFixed(0)}%`);
    }
    console.log(`  ${label}`);
    rows.forEach(r => console.log(r));
    console.log(`    → learned  exam ${(bf / n).toFixed(3)}  surv ${(100 * bs / n).toFixed(0)}%  ` +
        `err ${(100 * be / n).toFixed(2)} cm  disrupt ${(100 * bd / n).toFixed(0)}%`);
    console.log(`      PID      exam ${(pf / n).toFixed(3)}  surv ${(100 * ps / n).toFixed(0)}%  ` +
        `err ${(100 * pe / n).toFixed(2)} cm  disrupt ${(100 * pd / n).toFixed(0)}%`);
    return { fit: bf / n, survival: bs / n, err: be / n, pidFit: pf / n, pidErr: pe / n };
}

if (CFG.evalOnly) {
    const src = JSON.parse(fs.readFileSync(String(CFG.evalOnly), "utf8"));
    const net = Net.fromJSON(src.net || src);
    evaluate(net, `evaluating ${CFG.evalOnly}`);
    process.exit(0);
}

/* ------------------------------------------------------------------ pool */
const workers = [];
for (let i = 0; i < CFG.workers; i++) {
    workers.push(new Worker(__filename, { workerData: { seed: CFG.seed + i * 7919 } }));
}
function ask(w, msg, transfer) {
    return new Promise(res => {
        const on = (m) => { w.off("message", on); res(m); };
        w.on("message", on);
        w.postMessage(msg, transfer);
    });
}

const nIn = NET_SIZES[0];
console.log(`imitation trainer — ${NET_SIZES.join("×")}, ${CFG.workers} workers, ` +
    `${CFG.rounds} rounds × ${CFG.seeds} seeds × ${TRAIN_TASKS.length} tasks`);

/* Pool of (observation, expert action) pairs, grown one DAgger round at a time. */
const pool = { X: [], Y: [], n: 0 };
function absorb(chunks) {
    let kept = 0, steps = 0, alive = 0;
    for (const c of chunks) {
        pool.X.push(c.xb); pool.Y.push(c.yb); pool.n += c.n;
        kept += c.n; steps += c.steps; if (c.survived) alive++;
    }
    return { kept, steps, alive, of: chunks.length };
}

async function collectRound(netJSON, round) {
    const jobs = [];
    for (const tid of TRAIN_TASKS) {
        for (let s = 0; s < CFG.seeds; s++) jobs.push({ taskId: tid, seed: 310000 + round * 4099 + s * 617 });
    }
    const per = Math.ceil(jobs.length / workers.length);
    const parts = await Promise.all(workers.map((w, i) => {
        const mine = jobs.slice(i * per, Math.min(jobs.length, (i + 1) * per));
        if (!mine.length) return Promise.resolve({ collected: [] });
        return ask(w, { collect: true, jobs: mine, net: netJSON });
    }));
    return absorb(parts.flatMap(p => p.collected));
}

/* Adam. Nothing exotic: the point of this stage is to get close to the teacher
 * quickly, not to squeeze the last decimal out of a regression. */
async function train(net, epochs) {
    const flatX = new Float32Array(pool.n * nIn), flatY = new Float32Array(pool.n * 19);
    let at = 0;
    for (let c = 0; c < pool.X.length; c++) {
        const cn = pool.X[c].length / nIn;
        flatX.set(pool.X[c], at * nIn); flatY.set(pool.Y[c], at * 19);
        at += cn;
    }
    const per = Math.floor(pool.n / workers.length);
    await Promise.all(workers.map((w, i) => {
        const from = i * per, to = i === workers.length - 1 ? pool.n : from + per;
        const X = flatX.slice(from * nIn, to * nIn), Y = flatY.slice(from * 19, to * 19);
        return ask(w, { shard: true, X: X.buffer, Y: Y.buffer, n: to - from, net: net.toJSON() },
            [X.buffer, Y.buffer]);
    }));

    const m = net.weights.map(w => new Float32Array(w.length));
    const v = net.weights.map(w => new Float32Array(w.length));
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const stepsPerEpoch = Math.max(4, Math.ceil(pool.n / CFG.batch));
    const perWorker = Math.max(8, Math.round(CFG.batch / workers.length));
    let t = 0;
    for (let e = 0; e < epochs; e++) {
        // Cosine decay: the clone gets most of the way there in the first third
        // and then needs small steps, because the residual is the part of the
        // teacher that depends on state the student cannot see.
        const lr = CFG.lr * 0.5 * (1 + Math.cos(Math.PI * e / epochs));
        let epochLoss = 0, epochN = 0;
        for (let s = 0; s < stepsPerEpoch; s++) {
            const wJSON = net.weights.map(w => w);
            const parts = await Promise.all(workers.map(w =>
                ask(w, { grad: true, w: wJSON, batch: perWorker })));
            t++;
            const bc = b1 ** t, b2c = b2 ** t;
            for (let l = 0; l < net.weights.length; l++) {
                const W = net.weights[l], ml = m[l], vl = v[l];
                let tot = null;
                for (const p of parts) {
                    const g = p.g[l];
                    if (!tot) { tot = new Float32Array(g); }
                    else for (let i = 0; i < g.length; i++) tot[i] += g[i];
                }
                const scale = 1 / (perWorker * workers.length);
                for (let i = 0; i < W.length; i++) {
                    const g = tot[i] * scale;
                    ml[i] = b1 * ml[i] + (1 - b1) * g;
                    vl[i] = b2 * vl[i] + (1 - b2) * g * g;
                    W[i] -= lr * (ml[i] / (1 - bc)) / (Math.sqrt(vl[i] / (1 - b2c)) + eps);
                }
            }
            for (const p of parts) { epochLoss += p.loss; epochN += p.count; }
        }
        if (e % 4 === 0 || e === epochs - 1) {
            console.log(`    epoch ${String(e + 1).padStart(3)}/${epochs}  lr ${lr.toExponential(2)}  ` +
                `loss ${(epochLoss / epochN).toExponential(3)}`);
        }
    }
}

(async function main() {
    const t0 = Date.now();
    const net = new Net(NET_SIZES, mulberry32(CFG.seed));
    let netJSON = null;                      // round 0 rolls out the expert itself
    for (let r = 0; r < CFG.rounds; r++) {
        const c = await collectRound(netJSON, r);
        console.log(`round ${r}  ${netJSON ? "student rollouts (DAgger)" : "expert rollouts"}  ` +
            `+${c.kept} samples (${c.alive}/${c.of} episodes survived)  pool ${pool.n}`);
        await train(net, CFG.epochs);
        const ev = evaluate(net, `after round ${r}`);
        // Hand the GA a mutation step sized to the weights this net actually
        // has, not to the random init it left behind forty epochs ago.
        net.calibrateScales();
        // Every round is kept, not just the last one. More DAgger data is not
        // monotonically better — a round that adds a lot of states from a
        // student that was already competent can move the fit away from the
        // states that matter — and the first version of this file overwrote one
        // output, so the best round of the run was gone before it could be
        // measured. Round 2 scored 0.433 and round 3 scored 0.324; only one of
        // those was still on disk.
        const body = JSON.stringify({
            format: "tokamak-brain-v1", mode: "full", gen: 0, round: r,
            examFit: ev.fit, sizes: NET_SIZES, obsNormVersion: OBS_NORM.version,
            source: "behaviour-cloned from pid.js (DAgger)",
            net: net.toJSON()
        });
        fs.writeFileSync(path.join(__dirname, CFG.out), body);
        fs.writeFileSync(path.join(__dirname, CFG.out.replace(/\.json$/, `_r${r}.json`)), body);
        netJSON = net.toJSON();
        console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] wrote ${CFG.out}`);
    }
    for (const w of workers) w.postMessage({ stop: true });
    console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(0)}s — seed the GA with:`);
    console.log(`  node train.js --resume ${CFG.out} --gens 100000 --pop 128 --workers 18`);
    process.exit(0);
})();
