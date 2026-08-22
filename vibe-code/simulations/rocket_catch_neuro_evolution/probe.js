/* probe.js — "is this task learnable at all", asked three ways.
 *
 * Run BEFORE committing a box to an overnight search. Every question here has
 * caught a bug in this collection before, and each one is cheap:
 *
 *   A. THE SCORE SURFACE. Sweep a deliberately dumb two-parameter policy across
 *      a grid and print what the reward pays. A flat or non-monotone surface IS
 *      the bug, and no amount of population size fixes it. Reference rows for
 *      "inert" and "zero output" bracket it.
 *
 *   B. THE SIGNAL IN GENERATION ONE. Score n fresh random brains on a fixed
 *      bank. What matters is sd (what selection has to work with) against the
 *      headroom to a competent policy. sd/headroom around 0.25 is healthy.
 *
 *   C. HERITABILITY — the one that is usually missing. Score a parent, mutate
 *      it, score the child on the SAME bank, and correlate. A genetic algorithm
 *      is a hill-climber whose only claim on the future is that a child
 *      resembles its parent; if corr(parent, child) is near zero the search is
 *      a random restart dressed up as evolution, and no reward fix will help.
 *      Swept over the mutation grid, this is what picks the operator.
 *
 * Nothing here trains. It is a measurement.
 */
"use strict";

const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const NN = require("./nn.js");
const SC = require("./scenarios.js");
const WM = require("./world.js");
const EV = require("./evolution.js");
const M = require("./mathx.js");
const V = require("./vehicle.js");
const AP = require("./autopilot.js");

/* ------------------------------------------------------------------ policies */

/* A constant-deceleration descent, which is the reference this project's own
 * notes say the environment admits. `margin` scales the ignition point;
 * `rungBias` shifts which rung it is willing to settle for. It exists to probe
 * the REWARD, not to fly well, and nothing here touches the search.
 *
 * Three details are not optional, and each one is a trap this project already
 * paid for:
 *   - THE THROTTLE FLOOR IS 40%. Plan a deceleration the smallest lit rung
 *     cannot go below and the throttle pins at minimum, over-brakes, and the
 *     booster climbs. Choose the smallest rung whose FLOOR still fits.
 *   - DEAD TIME IS PART OF THE STOPPING DISTANCE: 0.45 s of ignition delay
 *     plus a 0.16 s spool is a second of free fall before anything happens.
 *   - AIM AT THE ENGINE PLANE, not the centre of mass, and for a catch aim at
 *     the rail height rather than the ground. */
function hoverslamPolicy(trigger, lean, commit) {
    const ax = new Float64Array(3);
    /* The ladder is a one-way door — the hardware enforces it with ignition
     * credits — so `lit` and `rung` are per-episode state and this must be a
     * fresh closure for every flight. */
    let lit = false, rung = 0;
    const p = function (world, out) {
        for (let i = 0; i < out.length; i++) out[i] = 0;
        const ty = world.type, tel = world.tel, LAD = ty.engineLadder;
        const goTower = commit > 0 && world.catchAllowed;

        /* Aim at the ENGINE PLANE against the rail height, which is what the
         * acceptance suite's descent probe does. `p[2]` is the engine plane
         * already; catchPinZ is where the pins sit above it. */
        const aim = goTower ? (V.TOWER.armZ - ty.catchPinZ) : 0;
        const h = world.p[2] - aim;
        const v = -world.v[2], m = world.mp.m;

        const aReq = (v * v - 1) / (2 * Math.max(0.5, h));
        const aHi = (k) => (LAD[k] * V.RAPTOR.thrust) / m - V.G0;

        if (!lit) {
            // dead time is part of the stopping distance
            const aAhead = (v * v - 1) / (2 * Math.max(0.5, h - v * 1.2));
            for (let k = LAD.length - 1; k >= 1; k--) if (aAhead >= trigger * aHi(k)) { rung = k; break; }
            if (rung > 0) lit = true;
        }
        if (lit) {
            // shed as soon as a smaller group can still do it; never add back
            for (let k = 1; k < rung; k++) if (aReq < 0.85 * aHi(k)) { rung = k; break; }
            const need = (V.G0 + aReq) * m;
            out[1] = (rung + 0.5) / LAD.length * 2 - 1;
            out[0] = M.clamp(need / (LAD[rung] * V.RAPTOR.thrust), 0.4, 1) * 2 - 1;
        } else { out[0] = -1; out[1] = -1; }

        /* Attitude and translation, which the acceptance-suite probe does not
         * need because it flies a doctored vertical scenario and the real bank
         * is offset, tilted, drifting and windy. Lean the axis toward the
         * target, then hold that lean with a PD through the gimbal.
         *
         * THE TWO GIMBAL AXES ARE CROSS-COUPLED AND IT IS NOT OPTIONAL TO GET
         * THE SIGNS FROM THE ALGEBRA. Written the obvious way — drive out[2]
         * from ax[0] and out[3] from ax[1] — this loop is positive feedback and
         * the booster tips from 1.4° to 23.6° in four seconds while its landing
         * burn works perfectly. Chasing that looks exactly like a thrust bug.
         *
         * Thrust in body frame is (sin gY, −sin gX, T) applied at rz = z_eng −
         * com, which is NEGATIVE because the engines are below the centre of
         * mass. So τx = rz·T·sin gX and τy = rz·T·sin gY, and with rz < 0 both
         * body rates accelerate OPPOSITE to their command. The kinematics cross
         * the axes again: ȧx[0] ≈ +w_y and ȧx[1] ≈ −w_x. Composing the two:
         *
         *     out[3] = +k·ax[0] + d·w[1]     the +X lean, through gimbal Y
         *     out[2] = −k·ax[1] + d·w[0]     the +Y lean, through gimbal X
         */
        world.axis(ax);
        const gmax = ty.engines[0].gimbal;
        const tx = goTower ? tel.toTowerX : tel.toGroundX;
        const tyv = goTower ? tel.toTowerY : tel.toGroundY;
        const wantX = M.clamp(-(tx * 0.010 + world.v[0] * 0.10) * lean, -lean, lean);
        const wantY = M.clamp(-(tyv * 0.010 + world.v[1] * 0.10) * lean, -lean, lean);
        out[2] = M.clamp((-(ax[1] - wantY) * 7.0 + world.w[0] * 3.5) / gmax, -1, 1);
        out[3] = M.clamp(((ax[0] - wantX) * 7.0 + world.w[1] * 3.5) / gmax, -1, 1);

        out[8] = 1;
        out[9] = commit;
    };
    p.fresh = () => hoverslamPolicy(trigger, lean, commit);
    return p;
}

function zeroPolicy(world, out) { for (let i = 0; i < out.length; i++) out[i] = 0; }

/* `policy` may be a plain function or one carrying `.fresh()`. The scripted
 * descent holds per-episode state — whether it has lit, and which rung it is
 * on, because the ladder is a one-way door — and reusing one instance across a
 * bank means every flight after the first starts already committed to the
 * previous flight's engine group. */
function runPolicy(policy, specs) {
    const scores = [], outcomes = [], vzs = [], dists = [];
    for (const s of specs) {
        const sc = SC.makeScenario(s.stage, s.seed);
        const w = new WM.World(sc);
        const r = w.runEpisode(policy.fresh ? policy.fresh() : policy);
        scores.push(r.total);
        outcomes.push(r.outcome);
        vzs.push(r.terminal.vzBase);
        dists.push(r.terminal.gateDist);
    }
    return { scores, outcomes, vzs, dists };
}

/* --------------------------------------------------------------------- stats */
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };
function corr(a, b) {
    const ma = mean(a), mb = mean(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
    }
    return (da > 0 && db > 0) ? num / Math.sqrt(da * db) : 0;
}
function tally(outcomes) {
    const t = {};
    for (const o of outcomes) { const n = WM.OUTCOME_NAME[o]; t[n] = (t[n] || 0) + 1; }
    return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
}

/* -------------------------------------------------------------------- worker */
if (!isMainThread) {
    parentPort.on("message", (msg) => {
        if (msg.type === "brain") {
            const b = NN.Brain.fromJSON(msg.brain);
            const r = EV.Evolution.evaluate(b, msg.specs);
            parentPort.postMessage({ type: "done", index: msg.index, scores: r.scores });
        }
    });
    return;
}

/* ---------------------------------------------------------------------- main */
const args = {};
for (let i = 2; i < process.argv.length; i++) {
    const t = process.argv[i];
    if (t.startsWith("--")) args[t.slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) ? process.argv[++i] : "true";
}
const STAGE = Number(args.stage != null ? args.stage : 0);
const NBANK = Number(args.bank || 24);
const NRAND = Number(args.rand || 32);
const NPAIR = Number(args.pairs || 24);
const WORKERS = Number(args.workers || Math.min(24, os.cpus().length - 2));
const ARCH = args.arch || "std";
const ACT = args.act || "tanh";
const OUTSCALE = Number(args.outscale || 0.35);

/* A probe bank that is NOT the exam and NOT any training era: its own seed
 * block, so nothing here can be contaminated by, or contaminate, either. */
const PROBE_BASE = 1500000000;
const BANK = [];
for (let i = 0; i < NBANK; i++) BANK.push({ stage: STAGE, seed: PROBE_BASE + STAGE * 90001 + i * 7013 });

console.log(`\n=== probe · stage ${STAGE} (${SC.STAGES[STAGE].label}) · ${NBANK} scenarios ===`);
console.log(`arch ${ARCH}/${ACT} outscale ${OUTSCALE} · ${WORKERS} workers\n`);

/* ---- A. the score surface -------------------------------------------- */
console.log("--- A. score surface of a dumb 2-parameter descent ---");
const inert = runPolicy(AP.inertPolicy, BANK);
const zero = runPolicy(zeroPolicy, BANK);
console.log(`  ${"inert".padEnd(22)} ${mean(inert.scores).toFixed(3)}  sd ${sd(inert.scores).toFixed(3)}   | ${tally(inert.outcomes)}`);
console.log(`  ${"zero output".padEnd(22)} ${mean(zero.scores).toFixed(3)}  sd ${sd(zero.scores).toFixed(3)}   | ${tally(zero.outcomes)}`);
console.log("");

/* `trigger` is how much of a rung's authority the vehicle insists on having in
 * hand before it lights — small means late and hot, large means early and
 * wasteful. `lean` is how far it will tip to fly out lateral error. */
const TRIGGERS = [0.40, 0.55, 0.70];
const LEANS = [0.04, 0.08, 0.13, 0.20, 0.30];
let bestPolicy = { score: -Infinity };
for (const commit of [1, -1]) {
    console.log(`  commit ${commit > 0 ? "TOWER" : "divert"}:`);
    console.log(`    trigger\\lean ` + LEANS.map(m => String(m).padStart(7)).join(""));
    for (const trigger of TRIGGERS) {
        const row = [];
        for (const lean of LEANS) {
            const r = runPolicy(hoverslamPolicy(trigger, lean, commit), BANK);
            const s = mean(r.scores);
            row.push(s);
            if (s > bestPolicy.score) bestPolicy = { score: s, trigger, lean, commit, r };
        }
        console.log(`    ${String(trigger).padEnd(12)} ` + row.map(v => v.toFixed(3).padStart(7)).join(""));
    }
}
console.log(`\n  best scripted descent: trigger ${bestPolicy.trigger} lean ${bestPolicy.lean} commit ${bestPolicy.commit}` +
    ` → ${bestPolicy.score.toFixed(3)}  (vz ${mean(bestPolicy.r.vzs).toFixed(1)} m/s, gate ${mean(bestPolicy.r.dists).toFixed(0)} m)`);
console.log(`  | ${tally(bestPolicy.r.outcomes)}`);

/* ---- B & C need the pool --------------------------------------------- */
const spec = NN.netSpec(require("./sensors.js").N_INPUT, ARCH);
const workers = [];
for (let i = 0; i < WORKERS; i++) workers.push(new Worker(__filename, { workerData: {} }));

function dispatch(jobs) {
    return new Promise((resolve) => {
        const res = new Array(jobs.length);
        let next = 0, done = 0;
        const pump = (w) => {
            if (next >= jobs.length) return;
            w.postMessage(jobs[next++]);
        };
        for (const w of workers) {
            w.removeAllListeners("message");
            w.on("message", (m) => {
                res[m.index] = m.scores;
                if (++done === jobs.length) resolve(res); else pump(w);
            });
        }
        for (const w of workers) if (next < jobs.length) pump(w);
    });
}

(async function () {
    /* ---- B. what does generation one look like? ----------------------- */
    console.log("\n--- B. spread of a fresh random population ---");
    const fresh = [];
    for (let i = 0; i < NRAND; i++) {
        fresh.push(new NN.Brain(spec, NN.mulberry32(918273 + i * 104729), { act: ACT, outScale: OUTSCALE }));
    }
    const fscores = (await dispatch(fresh.map((b, i) => ({ type: "brain", index: i, brain: b.toJSON(), specs: BANK }))))
        .map(s => mean(s));
    const fm = mean(fscores), fsd = sd(fscores), fmax = Math.max(...fscores);
    const headroom = bestPolicy.score - fm;
    console.log(`  n=${NRAND}  mean ${fm.toFixed(3)}  sd ${fsd.toFixed(3)}  min ${Math.min(...fscores).toFixed(3)}  max ${fmax.toFixed(3)}`);
    console.log(`  inert ${mean(inert.scores).toFixed(3)} · best dumb policy ${bestPolicy.score.toFixed(3)}`);
    console.log(`  headroom (dumb − random mean) ${headroom.toFixed(3)}   sd/headroom ${(fsd / headroom).toFixed(3)}` +
        (headroom <= 0 ? "   ** NEGATIVE: the reference policy is worse than random; this number is meaningless **" : ""));

    /* ---- C. heritability over the mutation grid ----------------------- */
    console.log("\n--- C. heritability: does a child resemble its parent? ---");
    console.log("  (corr over the same bank; delta = mean child − mean parent, in score units)");
    const parents = [];
    for (let i = 0; i < NPAIR; i++) {
        parents.push(new NN.Brain(spec, NN.mulberry32(5551212 + i * 40503), { act: ACT, outScale: OUTSCALE }));
    }
    const pscores = (await dispatch(parents.map((b, i) => ({ type: "brain", index: i, brain: b.toJSON(), specs: BANK }))))
        .map(s => mean(s));

    const GRID = [
        [0.02, 0.05], [0.02, 0.15], [0.05, 0.05], [0.05, 0.10], [0.05, 0.20],
        [0.11, 0.10], [0.11, 0.30], [0.20, 0.10], [0.20, 0.30], [0.35, 0.15]
    ];
    console.log(`    ${"rate".padStart(6)}${"sigma".padStart(7)}${"corr".padStart(8)}${"delta".padStart(8)}${"sd(child)".padStart(11)}`);
    for (const [rate, sigma] of GRID) {
        const kids = parents.map((p, i) => {
            const c = p.clone();
            c.mutate(rate, sigma, NN.mulberry32(77000 + i * 7919 + Math.round(rate * 1000) * 31 + Math.round(sigma * 1000)));
            return c;
        });
        const ks = (await dispatch(kids.map((b, i) => ({ type: "brain", index: i, brain: b.toJSON(), specs: BANK }))))
            .map(s => mean(s));
        console.log(`    ${String(rate).padStart(6)}${String(sigma).padStart(7)}` +
            `${corr(pscores, ks).toFixed(3).padStart(8)}${(mean(ks) - mean(pscores)).toFixed(3).padStart(8)}${sd(ks).toFixed(3).padStart(11)}`);
    }

    /* Crossover, measured the same way: a child of two unrelated parents,
     * correlated against the better parent. Row-wise crossover is supposed to
     * keep functional units intact; this says whether it does. */
    const xs = parents.map((p, i) => NN.Brain.crossover(p, parents[(i + 1) % parents.length], NN.mulberry32(31337 + i)));
    const xscores = (await dispatch(xs.map((b, i) => ({ type: "brain", index: i, brain: b.toJSON(), specs: BANK }))))
        .map(s => mean(s));
    const better = pscores.map((p, i) => Math.max(p, pscores[(i + 1) % pscores.length]));
    console.log(`    ${"crossover".padStart(13)}${corr(better, xscores).toFixed(3).padStart(8)}` +
        `${(mean(xscores) - mean(better)).toFixed(3).padStart(8)}${sd(xscores).toFixed(3).padStart(11)}   (vs better parent)`);

    for (const w of workers) await w.terminate();
    console.log("");
})();
