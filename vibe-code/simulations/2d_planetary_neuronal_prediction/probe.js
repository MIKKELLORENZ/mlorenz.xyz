/* probe.js — read the learned force law back out.
 *
 *   node probe.js training/checkpoint.json
 *
 * The training log says a brain beats Newton. This says WHAT it found, which is
 * the only way to tell a real discovery from a lucky exam.
 *
 * METHOD. Build a two-body configuration, put a test planet at radius r, and
 * ask the model for the acceleration on it. Compare against G·M/r². Sweep r,
 * then sweep the timestep. Two things make the numbers mean something:
 *
 *   · The reference scales are PINNED. Every input the model reads is
 *     normalised by the system's own length/mass/time, and in a two-body system
 *     the reference length is the test planet's own radius — so a naive sweep
 *     moves the planet and the ruler together, r/L stays 1.0 forever, and the
 *     "force law" comes out flat regardless of what the network contains.
 *     Overriding sys.ref with fixed values is what turns this into an actual
 *     sweep.
 *   · The acceleration is split into a RADIAL and a TANGENTIAL part. Newton has
 *     no tangential component at all. Anything the model puts there is, by
 *     construction, not a central force — it is a velocity-coupled correction,
 *     and that is exactly the shape a finite-timestep integrator needs.
 *
 * WHAT TO EXPECT. A model that merely rediscovered Newton shows ratio ≈ 1.000
 * flat in r and flat in dt, with no tangential part. A model that beat Newton
 * must differ, and it should differ MORE at coarser timesteps — because the
 * correction it has found is a correction to the integrator, not to gravity.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "physics.js", "model.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

const file = process.argv[2] || "training/checkpoint.json";
const ck = JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(__dirname, file), "utf8"));
if (ck.model) setModelCfg(ck.model);
const brain = Predictor.fromJSON(ck.net || ck);

console.log(`probe — ${ck.label || specLabel()}, generation ${ck.gen}, ` +
    `exam ${ck.exam != null ? ck.exam.toFixed(3) : "?"} digits (Newton ${ck.newton != null ? ck.newton.toFixed(3) : "?"})\n`);

const MSTAR = 1.0, MP = 1e-3;

/* One two-body configuration with the reference scales nailed down. */
function rig(r, ticksPerOrbit) {
    const m = new Float64Array([MSTAR, MP]);
    const st = new State(2);
    st.x[1] = r;
    st.vy[1] = Math.sqrt(G_CONST * (MSTAR + MP) / r);
    toBarycentre(st, m);
    const sys = new PlanetSystem(m, st, 0.02);
    const M = MSTAR + MP;
    // Pinned: L = 1 AU, so r/L on the x-axis below really is r.
    sys.ref = { M, L: 1, V: Math.sqrt(G_CONST * M), A: G_CONST * M, T: 1 / Math.sqrt(G_CONST * M), R0: r };
    const period = 2 * Math.PI * Math.sqrt(r * r * r / (G_CONST * M));
    sys.dt = period / ticksPerOrbit;
    sys._anchor = 1;
    return { sys, st, m };
}

/* Radial and tangential components of the model's acceleration on the planet,
 * in units of the Newtonian magnitude at that radius. */
function measure(r, ticksPerOrbit) {
    const { sys, st } = rig(r, ticksPerOrbit);
    const ax = new Float64Array(2), ay = new Float64Array(2);
    brain.reset(2);
    brain.accel(st, sys, ax, ay);
    const dx = st.x[0] - st.x[1], dy = st.y[0] - st.y[1];
    const rr = Math.hypot(dx, dy);
    const rhx = dx / rr, rhy = dy / rr;                  // unit vector planet → star
    const newton = G_CONST * MSTAR / (rr * rr);
    const rad = (ax[1] * rhx + ay[1] * rhy) / newton;    // +1 would be exactly Newton
    const tan = (-ax[1] * rhy + ay[1] * rhx) / newton;
    return { rad, tan, newton };
}

/* ------------------------------------------------ the law as a function of r */
console.log("Learned central force vs Newton, at 50 ticks per orbit");
console.log("  the model's acceleration on a test planet, divided by G·M/r²\n");
console.log("     r/L     radial     tangential      reading");
for (const r of [0.35, 0.5, 0.7, 1.0, 1.4, 2.0, 2.8]) {
    const m = measure(r, 50);
    const dev = (m.rad - 1) * 100;
    let read;
    if (Math.abs(m.rad - 1) < 0.02 && Math.abs(m.tan) < 0.02) read = "Newton";
    else if (m.rad > 1) read = `${dev.toFixed(1)}% stronger than Newton`;
    else read = `${(-dev).toFixed(1)}% weaker than Newton`;
    console.log(`  ${r.toFixed(2).padStart(6)}   ${m.rad.toFixed(4).padStart(8)}   ` +
        `${m.tan.toFixed(4).padStart(10)}      ${read}`);
}

/* ------------------------------------------- does the law depend on the step? */
console.log("\nDependence on timestep, at r = 1.0 L");
console.log("  a pure force law cannot depend on dt; an integrator correction must\n");
console.log("  ticks/orbit      dt/T     radial     tangential");
for (const tpo of [16, 25, 40, 50, 80, 120]) {
    const m = measure(1.0, tpo);
    const { sys } = rig(1.0, tpo);
    console.log(`  ${String(tpo).padStart(11)}   ${(sys.dt / sys.ref.T).toFixed(4).padStart(7)}   ` +
        `${m.rad.toFixed(4).padStart(8)}   ${m.tan.toFixed(4).padStart(10)}`);
}

/* --------------------------------------------------- does the memory matter? */
/* The GRU is only useful if what it accumulates changes the answer. Comparing
 * the first tick of a rollout (memory zeroed) against the hundredth (memory
 * warm, same geometry) measures that directly. */
if (brain.gru) {
    const { sys, st } = rig(1.0, 50);
    const ax = new Float64Array(2), ay = new Float64Array(2);
    brain.reset(2);
    brain.accel(st, sys, ax, ay);
    const cold = Math.hypot(ax[1], ay[1]);
    for (let k = 0; k < 100; k++) brain.accel(st, sys, ax, ay);   // same state, memory warms
    const warm = Math.hypot(ax[1], ay[1]);
    console.log(`\nMemory: on an unchanging state, the predicted force moves ` +
        `${(100 * Math.abs(warm - cold) / cold).toFixed(2)}% between the first ` +
        `evaluation and the hundredth (cold ${cold.toExponential(4)} → warm ${warm.toExponential(4)}).`);
    console.log(`  Near zero means the recurrent latent is decorative and the model is effectively Markovian.`);
}

/* ------------------------------------------ what integration scheme is this? */
/* The multistep coefficients are the most directly READABLE thing this model
 * learns. Everything else it does is a force law smeared across two thousand
 * weights, but these few numbers are the same objects that appear in a numerical
 * analysis textbook, so they can be printed next to the classical schemes and
 * compared. Printed in the raw basis — coefficient on aₙ, aₙ₋₁, … — rather than
 * the difference basis the network actually emits, because that is the form the
 * textbook uses. They sum to 1 by construction. */
if (brain.spec.lags) {
    const lags = brain.spec.lags;
    console.log(`\nThe integration scheme it learned, at r = 1.0 L, 50 ticks/orbit`);
    console.log(`  coefficients on the current and past force evaluations; they sum to 1\n`);
    const { sys, st } = rig(1.0, 50);
    const ax = new Float64Array(2), ay = new Float64Array(2);
    const bx = new Float64Array(2), by = new Float64Array(2);
    brain.reset(2);
    brain.trace = true;
    // Roll a real orbit so the lag buffers hold a genuine trajectory. Reading the
    // coefficients off a pinned, unchanging state would report the scheme for a
    // body that is not moving, which is not the case anyone cares about.
    for (let t = 0; t < 3 * lags + 4; t++) {
        brain.accel(st, sys, ax, ay, bx, by);
        stepVerlet(st, sys.dt, ax, ay, bx, by);
    }
    brain.accel(st, sys, ax, ay, bx, by);
    brain.trace = false;

    const raw = (c) => {
        const out = [1 - c.reduce((a, b) => a + b, 0)].concat(c);
        return out.map(v => (v >= 0 ? " " : "") + v.toFixed(4)).join("  ");
    };
    const P = [], Q = [];
    for (let k = 0; k < lags; k++) { P.push(brain._pCoef[1 * lags + k]); Q.push(brain._qCoef[1 * lags + k]); }
    const head = ["aₙ"].concat([...Array(lags).keys()].map(k => `aₙ₋${k + 1}`));
    console.log("                    " + head.map(h => h.padStart(8)).join("  "));
    console.log(`  position update   ${raw(P)}`);
    console.log(`  velocity update   ${raw(Q)}`);
    /* The base schedule alone — the eight evolved numbers shared by every body,
     * before the node network's per-body adjustment. Printing both says which of
     * the two is doing the work: a model whose rows here are nearly identical to
     * the rows above has settled on ONE fixed scheme and is not using the
     * conditioning at all, which is the whole justification for learning this
     * rather than hard-coding Adams-Bashforth. */
    if (brain.sched) {
        const bp = [], bq = [];
        for (let k = 0; k < lags; k++) {
            bp.push(MULTI_SCALE * brain.sched.coef(k));
            bq.push(MULTI_SCALE * brain.sched.coef(lags + k));
        }
        console.log(`\n  the shared base schedule, before any per-body adjustment:`);
        console.log(`  position update   ${raw(bp)}`);
        console.log(`  velocity update   ${raw(bq)}`);
        let spread = 0;
        for (let k = 0; k < lags; k++) {
            spread = Math.max(spread, Math.abs(bp[k] - P[k]), Math.abs(bq[k] - Q[k]));
        }
        console.log(`  the per-body adjustment moves a coefficient by up to ${spread.toFixed(4)} on this body.`);
    }
    const CLASSICAL = {
        "one-step (Euler/Verlet)": [1],
        "Adams-Bashforth 2": [1.5, -0.5],
        "Adams-Bashforth 3": [23 / 12, -16 / 12, 5 / 12],
        "Adams-Bashforth 4": [55 / 24, -59 / 24, 37 / 24, -9 / 24]
    };
    console.log("\n  for comparison, the classical explicit schemes:");
    for (const [name, c] of Object.entries(CLASSICAL)) {
        console.log(`  ${name.padEnd(25)} ${c.map(v => (v >= 0 ? " " : "") + v.toFixed(4)).map(s => s.padStart(8)).join("  ")}`);
    }
    // Distance to the nearest classical scheme, so "did it rediscover AB3 or find
    // something else" is a number rather than an impression.
    const pRaw = [1 - P.reduce((a, b) => a + b, 0)].concat(P);
    let best = null;
    for (const [name, c] of Object.entries(CLASSICAL)) {
        let d = 0;
        for (let k = 0; k < Math.max(c.length, pRaw.length); k++) d += Math.pow((c[k] || 0) - (pRaw[k] || 0), 2);
        d = Math.sqrt(d);
        if (!best || d < best.d) best = { name, d };
    }
    console.log(`\n  nearest classical scheme to the position update: ${best.name} (distance ${best.d.toFixed(3)})`);
    console.log(`  a large distance is not a failure — the coefficients are conditioned on the`);
    console.log(`  body's own state, so a fixed textbook rule is a special case, not the target.`);
}

/* -------------------------------------------- transfer to unseen tick lengths */
/* The sharpest test of what was actually learned.
 *
 * If the model found a genuine INTEGRATOR CORRECTION, its advantage should
 * survive a change of step size — the correction knows how long the step is and
 * scales with it. If it merely found a MODIFIED FORCE LAW tuned to the one tick
 * length it trained at, the advantage should collapse the moment the tick
 * changes, because a force law that is wrong by a fixed amount is only right at
 * one step size.
 *
 * Everything here trained at 50 ticks per fastest orbit. */
(function () {
    console.log(`\nTransfer to tick lengths it never trained at (L1, digits vs Newton):\n`);
    console.log("  ticks/orbit    Newton    BRAIN   vs Newton");
    for (const tpo of [25, 35, 50, 75, 100]) {
        const ts = new TrialSet(seedsFor(38, 5, 0x5EED1), { level: 1, tickFrac: 1 / tpo });
        if (!ts.size) { console.log(`  ${String(tpo).padStart(11)}    (no systems at this step)`); continue; }
        const n = ts.evaluate(NEWTON_RUNNER).digits;
        const b = ts.evaluate(predictorRunner(brain)).digits;
        console.log(`  ${String(tpo).padStart(11)}   ${n.toFixed(3).padStart(6)}   ${b.toFixed(3).padStart(6)}   ` +
            `${(b - n >= 0 ? "+" : "") + (b - n).toFixed(3)}${tpo === 50 ? "   ← trained here" : ""}`);
    }
})();

/* ------------------------------------------------------- head-to-head recap */
(async function () {
    console.log(`\nHead-to-head on held-out systems (digits of relative accuracy):\n`);
    console.log("  rung          do-nothing   Newton   Newton×8    BRAIN   vs Newton");
    for (let L = 0; L < N_LEVELS; L++) {
        const ts = new TrialSet(seedsFor(L * 31 + 7, 4, 0x5EED1), { level: L, tickFrac: 0.02 });
        const d = ts.evaluate(DRIFT_RUNNER).digits;
        const n = ts.evaluate(NEWTON_RUNNER).digits;
        const s8 = ts.evaluate(newtonSubRunner(8)).digits;
        const b = ts.evaluate(predictorRunner(brain)).digits;
        const trained = L <= (ck.level | 0);
        console.log(`  L${L} ${levelOf(L).label.padEnd(10)} ${d.toFixed(3).padStart(9)}   ` +
            `${n.toFixed(3).padStart(6)}   ${s8.toFixed(3).padStart(8)}   ${b.toFixed(3).padStart(6)}   ` +
            `${(b - n >= 0 ? "+" : "") + (b - n).toFixed(3)}${trained ? "" : "   (never trained)"}`);
    }
})();
