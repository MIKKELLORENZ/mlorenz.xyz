/* test_headless.js — Node assertion suite. Run: node test_headless.js
 *
 * Loads the browser files into one shared context (they are plain <script>
 * files with bare globals, no modules) and checks, in order: the truth
 * integrator, the system generator, the symmetries the model claims to have by
 * construction, the baselines, and finally that the GA moves at all.
 *
 * The symmetry tests are the important ones. Permutation invariance and
 * rotation equivariance are properties the architecture is supposed to give for
 * free, and the cheapest way to lose them is a one-character mistake that still
 * runs and still trains — just worse, for reasons nothing else would surface.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "physics.js", "model.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

let failures = 0, checks = 0;
function check(name, ok, extra) {
    checks++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}
function section(t) { console.log(`\n\x1b[36m── ${t}\x1b[0m`); }

/* ==================================================== 1. truth integrator */
section("truth integrator");
{
    // Circular two-body orbit: after exactly one period the body must be back
    // where it started. This is the end-to-end check on Kepler init, the force
    // law and the integrator all at once.
    const m = new Float64Array([1.0, 1e-8]);
    const st = new State(2);
    st.x[1] = 1; st.vy[1] = Math.sqrt(G_CONST * (m[0] + m[1]) / 1);
    toBarycentre(st, m);
    // The exact two-body period for a relative semi-major axis of 1 — NOT 2π.
    // The companion has mass, so μ = G(M+m) and the orbit is very slightly fast.
    // Using 2π leaves a 1.6e-7 AU residual that looks exactly like an integrator
    // bug and is nothing of the kind.
    const period = 2 * Math.PI / Math.sqrt(G_CONST * (m[0] + m[1]));
    const steps = 20000, h = period / steps;
    const work = st.clone();
    const ax = new Float64Array(2), ay = new Float64Array(2);
    const e0 = totalEnergy(work, m), l0 = angularMomentum(work, m);
    for (let i = 0; i < steps; i++) yoshida4(work, m, h, ax, ay);
    const back = Math.hypot(work.x[1] - st.x[1], work.y[1] - st.y[1]);
    // The residual here is SOFTENING, not integration error. A softened
    // potential is a genuinely different potential: at r = 1 the 1e-4 softening
    // weakens gravity by ~1.5e-8, the circular velocity we launched with is
    // therefore very slightly wrong for it, and the orbit closes about 2π·1.5e-8
    // ≈ 1e-7 away from where pure Kepler says. The integrator's own error at
    // 20 000 steps is ~1e-14, and the energy check below is what actually pins
    // that down — it conserves the softened Hamiltonian to 5e-15.
    const softLimit = 10 * Math.PI * SOFT * SOFT;
    check("circular orbit closes after one period (to the softening limit)", back < softLimit,
        `residual ${back.toExponential(2)} AU vs softening limit ${softLimit.toExponential(2)}`);
    const de = Math.abs((totalEnergy(work, m) - e0) / e0);
    const dl = Math.abs((angularMomentum(work, m) - l0) / l0);
    check("energy conserved over one orbit", de < 1e-12, `ΔE/E ${de.toExponential(2)}`);
    check("angular momentum conserved", dl < 1e-12, `ΔL/L ${dl.toExponential(2)}`);
    check("Yoshida weights satisfy 4th-order conditions",
        Math.abs(2 * Y_W1 + Y_W0 - 1) < 1e-15 &&
        Math.abs(2 * Math.pow(Y_W1, 3) + Math.pow(Y_W0, 3)) < 1e-15);
}
{
    // Yoshida must actually be 4th order: halving the step should cut the error
    // by ~16×. A composition bug typically leaves a working but 2nd-order
    // integrator, which this catches and nothing else would.
    const m = new Float64Array([1.0, 3e-6]);
    const mk = () => { const s = new State(2); s.x[1] = 1; s.vy[1] = 1.0; toBarycentre(s, m); return s; };
    const ref = mk();
    const ax = new Float64Array(2), ay = new Float64Array(2);
    const T = 1.0;
    const err = (n) => {
        const s = mk();
        for (let i = 0; i < n; i++) yoshida4(s, m, T / n, ax, ay);
        const g = mk();
        for (let i = 0; i < 40000; i++) yoshida4(g, m, T / 40000, ax, ay);
        return Math.hypot(s.x[1] - g.x[1], s.y[1] - g.y[1]);
    };
    const e1 = err(200), e2 = err(400);
    const order = Math.log2(e1 / e2);
    check("integrator is 4th order", order > 3.5 && order < 4.6, `measured order ${order.toFixed(2)}`);
}

/* =================================================== 2. system generator */
section("system generator");
for (let lv = 0; lv < N_LEVELS; lv++) {
    const t0 = Date.now();
    let ok = 0, bodies = 0, drift = 0, tries = 0, worstRes = Infinity;
    for (let k = 0; k < 6; k++) {
        const sys = makeSystem(1000 + lv * 97 + k, { level: lv });
        if (!sys) continue;
        ok++; bodies += sys.n; tries += sys.attempts;
        drift = Math.max(drift, sys.truth.energyDrift);
        worstRes = Math.min(worstRes, sys.ticksPerFastestOrbit);
    }
    check(`L${lv} ${levelOf(lv).label}: 6/6 systems generated`, ok === 6,
        `${(bodies / Math.max(1, ok)).toFixed(1)} bodies avg, ${(tries / Math.max(1, ok)).toFixed(1)} draws each, ${Date.now() - t0} ms`);
    // The truth's own error has to be far below anything a brain will reach, or
    // the fitness function is measuring the integrator instead of the model.
    check(`L${lv}: truth energy drift below 1e-9`, drift < 1e-9, `worst ΔE/E ${drift.toExponential(2)}`);
    check(`L${lv}: fastest orbit is resolved`, worstRes >= MIN_TICKS_PER_ORBIT,
        `${worstRes.toFixed(0)} ticks per fastest orbit (floor ${MIN_TICKS_PER_ORBIT})`);
}
{
    const sys = makeSystem(4242, { level: 2 });
    if (!sys) { check("L2 sample system for the frame checks", false, "generator returned null"); }
    else {
    let px = 0, py = 0, cx = 0, cy = 0, M = 0;
    for (let i = 0; i < sys.n; i++) {
        M += sys.m[i];
        px += sys.m[i] * sys.state0.vx[i]; py += sys.m[i] * sys.state0.vy[i];
        cx += sys.m[i] * sys.state0.x[i]; cy += sys.m[i] * sys.state0.y[i];
    }
    check("initial state is barycentric", Math.hypot(px, py) / M < 1e-14 && Math.hypot(cx, cy) / M < 1e-14,
        `|p|/M ${(Math.hypot(px, py) / M).toExponential(1)}`);
    // The star moves. It should move a little — enough to matter, nowhere near
    // as much as a planet — which is the regime the brief asked for.
    const tr = sys.truth.frames;
    let starMove = 0, planetMove = 0;
    for (const f of tr) {
        starMove = Math.max(starMove, Math.hypot(f.x[0] - tr[0].x[0], f.y[0] - tr[0].y[0]));
        planetMove = Math.max(planetMove, Math.hypot(f.x[sys.n - 1] - tr[0].x[sys.n - 1], f.y[sys.n - 1] - tr[0].y[sys.n - 1]));
    }
    check("the star is perturbed but not dominant", starMove > 0 && starMove < 0.1 * planetMove,
        `star ${starMove.toExponential(2)} AU vs outer planet ${planetMove.toFixed(3)} AU`);
    check("determinism: same seed → identical system",
        makeSystem(4242, { level: 2 }).state0.posEquals(sys.state0, 0));
    }
}

/* ================================================== 3. model symmetries */
section("model symmetries (must hold by construction)");

function rotState(st, th) {
    const c = Math.cos(th), s = Math.sin(th), o = new State(st.n);
    for (let i = 0; i < st.n; i++) {
        o.x[i] = c * st.x[i] - s * st.y[i]; o.y[i] = s * st.x[i] + c * st.y[i];
        o.vx[i] = c * st.vx[i] - s * st.vy[i]; o.vy[i] = s * st.vx[i] + c * st.vy[i];
    }
    return o;
}
function permState(st, m, p) {
    const o = new State(st.n), mm = new Float64Array(st.n);
    for (let i = 0; i < st.n; i++) {
        o.x[i] = st.x[p[i]]; o.y[i] = st.y[p[i]];
        o.vx[i] = st.vx[p[i]]; o.vy[i] = st.vy[p[i]];
        mm[i] = m[p[i]];
    }
    return { st: o, m: mm };
}

for (const cfg of [{ image: false, mem: 8 }, { image: true, mem: 8 }, { image: true, mem: 0 }]) {
    setModelCfg(cfg);
    const tag = specLabel();
    const rng = mulberry32(7);
    const pred = new Predictor(rng);
    // A near-zero output layer would make every symmetry test trivially pass on
    // a wash of zeros. Blow the weights up first so the comparisons are made on
    // a genuinely active network.
    pred.mutate(1.0, 6.0, rng);
    const sys = makeSystem(555, { level: 2 });

    // ---- permutation invariance ----
    {
        const n = sys.n;
        const p = [...Array(n).keys()];
        const r2 = mulberry32(3);
        for (let i = n - 1; i > 0; i--) { const j = (r2() * (i + 1)) | 0;[p[i], p[j]] = [p[j], p[i]]; }
        const ax = new Float64Array(n), ay = new Float64Array(n);
        pred.reset(n); pred.accel(sys.state0, sys, ax, ay);
        const pm = permState(sys.state0, sys.m, p);
        const sys2 = new PlanetSystem(pm.m, pm.st, 0.02);
        const bx = new Float64Array(n), by = new Float64Array(n);
        pred.reset(n); pred.accel(pm.st, sys2, bx, by);
        let worst = 0, scale = 0;
        for (let i = 0; i < n; i++) {
            worst = Math.max(worst, Math.hypot(bx[i] - ax[p[i]], by[i] - ay[p[i]]));
            scale = Math.max(scale, Math.hypot(ax[i], ay[i]));
        }
        check(`${tag}: permutation invariant`, worst / scale < 1e-5,
            `worst ${(worst / scale).toExponential(2)} relative`);
    }

    // ---- rotation equivariance ----
    {
        const n = sys.n, th = 0.9137;
        const ax = new Float64Array(n), ay = new Float64Array(n);
        pred.reset(n); pred.accel(sys.state0, sys, ax, ay);
        const rs = rotState(sys.state0, th);
        const sys2 = new PlanetSystem(sys.m, rs, 0.02);
        const bx = new Float64Array(n), by = new Float64Array(n);
        pred.reset(n); pred.accel(rs, sys2, bx, by);
        const c = Math.cos(th), s = Math.sin(th);
        let worst = 0, scale = 0;
        for (let i = 0; i < n; i++) {
            worst = Math.max(worst, Math.hypot(bx[i] - (c * ax[i] - s * ay[i]), by[i] - (s * ax[i] + c * ay[i])));
            scale = Math.max(scale, Math.hypot(ax[i], ay[i]));
        }
        // With the image on this is only approximate: the raster is canonically
        // oriented, but a rotation still re-samples the bodies into different
        // cells, so the encoded context shifts slightly. Tolerance reflects that.
        const tol = MODEL_CFG.image ? 5e-3 : 1e-5;
        check(`${tag}: rotation equivariant`, worst / scale < tol,
            `worst ${(worst / scale).toExponential(2)} relative (tol ${tol})`);
    }

    // ---- the same two symmetries, with a FULL history ----
    /* The tests above call accel() once on a freshly reset predictor, so every
     * lag reads "not available yet" and not one line of the history code runs.
     * That is precisely where these symmetries are easiest to break — a raw past
     * coordinate anywhere in the node input would sail through the cold test and
     * fail here. So warm the buffers on a real rollout first, then measure.
     *
     * Tolerance is looser than the cold test and has to be. Permuting the bodies
     * reorders the floating-point sum that builds each message, which perturbs
     * the trajectory in the last bits; over a warm-up those perturbations grow at
     * the system's own Lyapunov rate. The cold test measures that noise at 1e-8,
     * so a few ticks of amplification is expected and is not a symmetry break —
     * what a genuine break looks like is O(1), not O(1e-5). */
    {
        const WARM = 4;
        const n = sys.n;
        const warm = (p, s) => {
            const st = s.state0.clone();
            const ax = new Float64Array(s.n), ay = new Float64Array(s.n);
            const bx = new Float64Array(s.n), by = new Float64Array(s.n);
            p.reset(s.n);
            for (let t = 0; t < WARM; t++) {
                p.accel(st, s, ax, ay, bx, by);
                stepVerlet(st, s.dt, ax, ay, bx, by);
            }
            p.accel(st, s, ax, ay, bx, by);   // measured on a full history
            return { ax, ay };
        };

        const p2 = [...Array(n).keys()];
        const r3 = mulberry32(11);
        for (let i = n - 1; i > 0; i--) { const j = (r3() * (i + 1)) | 0;[p2[i], p2[j]] = [p2[j], p2[i]]; }
        const A = warm(pred, sys);
        const pm = permState(sys.state0, sys.m, p2);
        const B = warm(pred, new PlanetSystem(pm.m, pm.st, 0.02));
        let worst = 0, scale = 1e-30;
        for (let i = 0; i < n; i++) {
            worst = Math.max(worst, Math.hypot(B.ax[i] - A.ax[p2[i]], B.ay[i] - A.ay[p2[i]]));
            scale = Math.max(scale, Math.hypot(A.ax[i], A.ay[i]));
        }
        check(`${tag}: permutation invariant with a warm history`, worst / scale < 1e-3,
            `worst ${(worst / scale).toExponential(2)} relative after ${WARM} ticks`);

        const th = 0.9137, c = Math.cos(th), s = Math.sin(th);
        const R = warm(pred, new PlanetSystem(sys.m, rotState(sys.state0, th), 0.02));
        worst = 0; scale = 1e-30;
        for (let i = 0; i < n; i++) {
            worst = Math.max(worst, Math.hypot(R.ax[i] - (c * A.ax[i] - s * A.ay[i]),
                R.ay[i] - (s * A.ax[i] + c * A.ay[i])));
            scale = Math.max(scale, Math.hypot(A.ax[i], A.ay[i]));
        }
        const tol = MODEL_CFG.image ? 5e-2 : 1e-3;
        check(`${tag}: rotation equivariant with a warm history`, worst / scale < tol,
            `worst ${(worst / scale).toExponential(2)} relative after ${WARM} ticks (tol ${tol})`);
    }

    // ---- runs on a body count it never saw ----
    {
        let ok = true, note = "";
        for (const L of [0, 4]) {
            const s2 = makeSystem(9090 + L, { level: L });
            const ax = new Float64Array(s2.n), ay = new Float64Array(s2.n);
            try {
                pred.reset(s2.n); pred.accel(s2.state0, s2, ax, ay);
                for (let i = 0; i < s2.n; i++) if (!Number.isFinite(ax[i]) || !Number.isFinite(ay[i])) ok = false;
                note += `${s2.n}✓ `;
            } catch (e) { ok = false; note += `${s2.n}✗(${e.message}) `; }
        }
        check(`${tag}: one genome runs any body count`, ok, note.trim());
    }
}
setModelCfg({ image: false, mem: 8 });

/* ================================ 3c. the history is actually connected ====
 * A silently-dead input is the failure mode this simulator has already been
 * bitten by once: the timestep feature spent an entire training run pinned
 * against a clamp, contributing nothing, and every symmetry test passed the
 * whole time. Nothing above would notice if the multistep term were wired to
 * zero, so these check that it moves the output at all — and that it switches
 * itself off when there is no history to use. */
section("history and the multistep term");
{
    // The shipped default is lags 0, so this whole section has to ask for the
    // history explicitly. Without that it would silently test nothing and pass.
    setModelCfg({ lags: 4 });
    const rng = mulberry32(21);
    const pred = new Predictor(rng);
    pred.mutate(1.0, 6.0, rng);
    const sys = makeSystem(4242, { level: 2 });
    const n = sys.n;
    const A = new Float64Array(n), B = new Float64Array(n);
    const C = new Float64Array(n), D = new Float64Array(n);

    // Same state, cold vs warm. The state is identical, so any difference is the
    // history — which is the point of having it.
    pred.reset(n);
    pred.accel(sys.state0, sys, A, B, C, D);
    const coldX = Array.from(A);
    for (let t = 0; t < 6; t++) pred.accel(sys.state0, sys, A, B, C, D);
    let moved = 0, scale = 1e-30;
    for (let i = 0; i < n; i++) {
        moved = Math.max(moved, Math.abs(A[i] - coldX[i]));
        scale = Math.max(scale, Math.abs(coldX[i]));
    }
    check("a warm history changes the prediction", moved / scale > 1e-6,
        `${(moved / scale).toExponential(2)} relative change on an identical state`);

    // The velocity half of the step gets its own effective acceleration.
    let split = 0;
    for (let i = 0; i < n; i++) split = Math.max(split, Math.abs(C[i] - A[i]));
    check("position and velocity accelerations are separately produced", split / scale > 1e-6,
        `${(split / scale).toExponential(2)} relative separation`);

    // First tick of a rollout: nothing remembered, so every multistep difference
    // is zero and the model must reduce EXACTLY to its one-step self.
    setModelCfg({ lags: 0 });
    const noLag = new Predictor(mulberry32(21));
    setModelCfg({ lags: 4 });
    check("with lags 0 the model still builds and runs", (() => {
        setModelCfg({ lags: 0 });
        const p = new Predictor(mulberry32(5));
        const s2 = makeSystem(77, { level: 1 });
        const ax = new Float64Array(s2.n), ay = new Float64Array(s2.n);
        p.reset(s2.n); p.accel(s2.state0, s2, ax, ay);
        setModelCfg({ lags: 4 });
        return ax.every(Number.isFinite);
    })(), "the memoryless one-step model is still a supported configuration");

    // A brain whose weights are enormous must not be able to drive the multistep
    // term to infinity — MULTI_CAP exists for the close-approach case where the
    // force changes by more than its own size between two ticks.
    const wild = new Predictor(mulberry32(3));
    wild.mutate(1.0, 40.0, mulberry32(4));
    const s3 = makeSystem(31337, { level: 3 }) || makeSystem(999, { level: 2 });
    const ax = new Float64Array(s3.n), ay = new Float64Array(s3.n);
    const bx2 = new Float64Array(s3.n), by2 = new Float64Array(s3.n);
    wild.reset(s3.n);
    let finite = true;
    const stw = s3.state0.clone();
    for (let t = 0; t < 40; t++) {
        wild.accel(stw, s3, ax, ay, bx2, by2);
        for (let i = 0; i < s3.n; i++) if (!Number.isFinite(ax[i]) || !Number.isFinite(bx2[i])) finite = false;
        stepVerlet(stw, s3.dt, ax, ay, bx2, by2);
        if (!finite) break;
    }
    check("a wildly mutated brain cannot produce a non-finite acceleration", finite,
        "40 ticks at mutation sigma 40");

    /* ---- the classical scheme is genuinely inside the search space ----
     *
     * The whole reason the multistep coefficients were given their own small
     * genome is that the search could not reach Adams-Bashforth through the node
     * network's output layer — the first A/B measured `lags 4` finishing BEHIND
     * `lags 0`. A claim like "AB3 is now four mutations away" is worth nothing
     * unless the representation actually contains it, so this sets the schedule
     * to AB3 by hand and checks the model emits exactly those coefficients.
     *
     * The node network's multistep outputs are zeroed first: they are a
     * deliberate per-body ADJUSTMENT on top of the base scheme, so leaving them
     * in would be asking whether base + noise equals base. */
    const exact = new Predictor(mulberry32(9));
    const lg = exact.spec.lags;
    const wOut = exact.node.weights[exact.node.weights.length - 1];
    const rowLen = exact.node.sizes[exact.node.sizes.length - 2] + 1;
    for (let r = 6; r < 6 + 2 * lg; r++) wOut.fill(0, r * rowLen, (r + 1) * rowLen);

    // Pad to `lags` — AB3 uses two lags, so any further ones are set to exactly
    // zero, which is what "this scheme does not use that lag" has to mean.
    const pad = (c) => Array.from({ length: lg }, (_, k) => c[k] || 0);
    const want = pad(ADAMS_P[2]).concat(pad(ADAMS_Q[2]));
    // Through the SAME entry point `--schedinit ab3` uses, so this test covers
    // the trainer's code path rather than a re-implementation of it.
    Predictor.setSchedule(exact, 3);
    const s4 = makeSystem(2468, { level: 1 });
    const eax = new Float64Array(s4.n), eay = new Float64Array(s4.n);
    const ebx = new Float64Array(s4.n), eby = new Float64Array(s4.n);
    exact.reset(s4.n);
    exact.trace = true;
    const est = s4.state0.clone();
    for (let t = 0; t < 3 * lg + 2; t++) {
        exact.accel(est, s4, eax, eay, ebx, eby);
        stepVerlet(est, s4.dt, eax, eay, ebx, eby);
    }
    exact.accel(est, s4, eax, eay, ebx, eby);
    let worstCoef = 0;
    for (let i = 0; i < s4.n; i++) {
        for (let k = 0; k < lg; k++) {
            worstCoef = Math.max(worstCoef, Math.abs(exact._pCoef[i * lg + k] - want[k]));
            worstCoef = Math.max(worstCoef, Math.abs(exact._qCoef[i * lg + k] - want[lg + k]));
        }
    }
    check("Adams-Bashforth 3 is exactly representable by the evolvable schedule",
        worstCoef < 1e-6,
        `set the 8 schedule numbers by hand, every body emits AB3 to ${worstCoef.toExponential(1)}`);

    // ...and the schedule must actually MOVE under mutation. Its weights are born
    // at zero, and WeightBag scales each mutation by the spread a matrix was born
    // with — so a naive init would have pinned these eight numbers at zero for
    // the entire run while every test above still passed.
    const m0 = new Predictor(mulberry32(13));
    const before = Array.from(m0.sched.weights[0]);
    m0.mutate(0.5, 0.4, mulberry32(14));
    let moved2 = 0;
    for (let k = 0; k < before.length; k++) moved2 = Math.max(moved2, Math.abs(m0.sched.weights[0][k] - before[k]));
    check("the schedule is mutable despite being born at zero", moved2 > 0.02,
        `one mutation moves a coefficient by up to ${moved2.toFixed(3)} (step scale ${SCHED_STEP})`);

    /* ---- the graft must not change a single prediction ----
     *
     * Phase 2 of training starts from a phase-1 brain widened to carry history.
     * The whole value of that is the guarantee that it begins as EXACTLY the
     * brain that earned its score — if the surgery perturbs anything, phase 2
     * starts from a damaged genome and the comparison against phase 1 becomes
     * meaningless while still looking plausible. So this rolls both brains
     * forward over a real system and demands bit-level agreement.
     *
     * A first tick would not be enough on its own: the grafted brain also has to
     * keep agreeing while its history buffers fill, since a lag that read as
     * anything other than "unchanged" would kick in on tick 2 and quietly change
     * the trajectory from there. */
    setModelCfg({ lags: 0 });
    const small = new Predictor(mulberry32(77));
    small.mutate(1.0, 3.0, mulberry32(78));
    const smallJSON = JSON.parse(JSON.stringify(small.toJSON()));
    const sysG = makeSystem(13579, { level: 1 });
    const roll = (p) => {
        const n = sysG.n, out = [];
        const ax = new Float64Array(n), ay = new Float64Array(n);
        const bx = new Float64Array(n), by = new Float64Array(n);
        const st = sysG.state0.clone();
        p.reset(n);
        for (let t = 0; t < 12; t++) {
            p.accel(st, sysG, ax, ay, bx, by);
            stepVerlet(st, sysG.dt, ax, ay, bx, by);
            out.push(st.x[n - 1], st.y[n - 1]);
        }
        return out;
    };
    const before1 = roll(small);
    setModelCfg({ lags: 4 });
    const grafted = Predictor.graft(smallJSON);
    const after1 = roll(grafted);
    let worstG = 0;
    for (let i = 0; i < before1.length; i++) worstG = Math.max(worstG, Math.abs(before1[i] - after1[i]));
    check("grafting history onto a trained brain changes nothing it predicts",
        worstG === 0,
        `12 ticks, lags 0 → 4 (${small.nParams()} → ${grafted.nParams()} params), max difference ${worstG}`);

    // ...and the grafted brain must still be a valid, mutable genome afterwards.
    const gm = grafted.clone().mutate(0.2, 0.4, mulberry32(99));
    const after2 = roll(gm);
    check("a grafted brain is still a working genome", after2.every(Number.isFinite) &&
        after2.some((v, i) => v !== after1[i]), "clones, mutates and moves off the grafted point");
}

/* ============================================ 3b. inputs are not saturated */
section("input scaling");
{
    /* Every clamped feature is a chance to accidentally feed the network a
     * constant. The timestep input did exactly that: `clamp(dt/T · 25, 0, 3)`
     * sat pinned at 3 for the whole operating range, so 16 and 50 ticks per
     * orbit produced byte-identical predictions and the model could not see the
     * step size at all — which is fatal, because step-size dependence is the
     * mechanism by which a learned force beats Newton in the first place.
     *
     * The bug trained perfectly happily. Only probe.js found it, and only
     * because it printed the same number four times in a row. */
    const vals = [];
    for (const tpo of [20, 25, 40, 50, 80, 120]) {
        for (const seedK of [0, 1, 2]) {
            const sys = makeSystem(6100 + seedK, { level: 2, tickFrac: 1 / tpo });
            if (sys) vals.push(dtFeature(sys));
        }
    }
    const lo = Math.min(...vals), hi = Math.max(...vals);
    check("timestep input spans a usable range", hi - lo > 0.6,
        `[${lo.toFixed(2)}, ${hi.toFixed(2)}] over 20–120 ticks per orbit`);
    // Because dt is DEFINED as pMin / ticksPerOrbit, the resolution rule is a
    // statement about the configuration, not about a particular draw: below the
    // floor it rejects every system that will ever be generated, and the page
    // silently shows an empty frame. The UI slider's minimum must therefore be
    // the floor itself, and this pins that contract from the other side.
    check("the coarsest offered timestep still produces systems",
        !!makeSystem(6100, { level: 2, tickFrac: 1 / MIN_TICKS_PER_ORBIT }),
        `floor is ${MIN_TICKS_PER_ORBIT} ticks per orbit`);
    check("below the floor, nothing is generated (rule is global, not per-draw)",
        !makeSystem(6100, { level: 2, tickFrac: 1 / (MIN_TICKS_PER_ORBIT - 2) }));
    check("timestep input never sits on a clamp", lo > -1.45 && hi < 1.95,
        `clamps are -1.5 and 2.0`);
    // Distinct step sizes must produce distinct predictions, or the correction
    // terms cannot be step-dependent no matter what the weights say.
    const rng = mulberry32(11);
    const pred = new Predictor(rng); pred.mutate(1.0, 6.0, rng);
    // The tick length feeds the resolution rejection rule, so a seed that is
    // fine at 120 ticks per orbit can be rejected at 16. Walk to a seed that
    // survives every step size, or the comparison is between different systems.
    let probeSeed = 6100;
    const STEPS = [MIN_TICKS_PER_ORBIT, 50, 120];
    const draw = (seed, tpo) => makeSystem(seed, { level: 2, tickFrac: 1 / tpo });
    while (probeSeed < 6200 && !STEPS.every(t => draw(probeSeed, t))) probeSeed++;
    const out = STEPS.map(tpo => {
        const sys = draw(probeSeed, tpo);
        const ax = new Float64Array(sys.n), ay = new Float64Array(sys.n);
        pred.reset(sys.n); pred.accel(sys.state0, sys, ax, ay);
        return ax[1];
    });
    check("different timesteps give different predictions",
        Math.abs(out[0] - out[1]) > 1e-9 && Math.abs(out[1] - out[2]) > 1e-9,
        `a(min)=${out[0].toExponential(3)} a(50)=${out[1].toExponential(3)} a(120)=${out[2].toExponential(3)}`);
}

/* ================================================= 4. raster ("the image") */
section("the image");
{
    setModelCfg({ image: true });
    const sys = makeSystem(31337, { level: 3 });
    const g = MODEL_CFG.grid;
    const buf = new Float32Array(g * g);
    buildRaster(sys.state0, sys.m, sys, g, buf);
    let lo = Infinity, hi = -Infinity, lit = 0;
    for (const v of buf) { lo = Math.min(lo, v); hi = Math.max(hi, v); if (v > -0.99) lit++; }
    check("raster in range and not blank", lo >= -1.0001 && hi <= 1.0001 && lit >= 2 && lit < g * g,
        `${lit}/${g * g} cells lit, range [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
    // The canonical orientation is the whole reason the image does not destroy
    // rotation equivariance, so it gets its own check.
    const b2 = new Float32Array(g * g);
    const rs = rotState(sys.state0, 1.234);
    buildRaster(rs, sys.m, new PlanetSystem(sys.m, rs, 0.02), g, b2);
    let d = 0;
    for (let i = 0; i < buf.length; i++) d = Math.max(d, Math.abs(buf[i] - b2[i]));
    check("raster is canonically oriented (rotating the system barely moves it)", d < 0.35,
        `max cell change ${d.toFixed(3)}`);
    setModelCfg({ image: false });
}

/* ======================================================== 5. baselines */
section("baselines");
{
    const ts = new TrialSet(seedsFor(1, 4, 0), { level: 1 });
    check("trial set built", ts.size === 4, `${ts.size} systems, horizon ${ts.systems[0].horizon}, dt ${ts.systems[0].dt.toFixed(4)}`);
    const drift = ts.evaluate(DRIFT_RUNNER);
    const newton = ts.evaluate(NEWTON_RUNNER);
    const sub8 = ts.evaluate(newtonSubRunner(8));
    const ab2 = ts.evaluate(adamsRunner(2));
    const ab3 = ts.evaluate(adamsRunner(3));
    console.log(`      drift ${drift.digits.toFixed(3)} · newton ${newton.digits.toFixed(3)} · ` +
        `AB2 ${ab2.digits.toFixed(3)} · AB3 ${ab3.digits.toFixed(3)} · newton×8 ${sub8.digits.toFixed(3)} digits`);
    check("Newton beats doing nothing", newton.digits > drift.digits + 1,
        `+${(newton.digits - drift.digits).toFixed(2)} digits`);
    // If substepping bought nothing, the tick would already be fine and there
    // would be no room above coarse Newton for anything to learn — the premise
    // of the whole experiment.
    check("substepping beats one-shot Newton (there is room above it)",
        sub8.digits > newton.digits + 0.3, `+${(sub8.digits - newton.digits).toFixed(2)} digits of headroom`);

    /* The multistep premise, asserted rather than assumed. These are the
     * hand-derived classical coefficients on EXACT Newtonian forces, run through
     * the identical one-evaluation harness — so this measures the scheme and
     * nothing else. If it ever stops holding, the model's whole reason for
     * remembering past ticks has evaporated and the README is lying. */
    check("a multistep scheme beats one-step Newton at the same cost",
        ab3.digits > newton.digits + 0.3,
        `AB3 +${(ab3.digits - newton.digits).toFixed(2)} digits over Newton, at one force evaluation each`);
    check("more lags is better than fewer, for the classical scheme",
        ab3.digits > ab2.digits, `AB3 ${ab3.digits.toFixed(3)} > AB2 ${ab2.digits.toFixed(3)}`);
    // The real bar the evolved model has to clear. Worth printing every run: if
    // AB3 is above Newton×8, "beats sixteen force evaluations with one" is a
    // property of the SCHEME, and the network gets no credit for it.
    check("nothing blew up", drift.blew === 0 && newton.blew === 0 && sub8.blew === 0 && ab3.blew === 0);
}

/* ==================================== 5b. randomised step size in training */
/* The previous champion's advantage over Newton inverted at fine steps because
 * it only ever saw one tick length. `--tickmin/--tickmax` fixes that by drawing
 * a step per system — and the drawing has to satisfy two properties that pull in
 * opposite directions: the steps must genuinely VARY, and they must be identical
 * for every worker and every individual, or common random numbers is broken and
 * the population is ranked on who drew the easy step. */
section("randomised step size");
{
    const RANGE = [28, 110];
    const seeds = seedsFor(5, 6, 0);
    const a = new TrialSet(seeds, { level: 1, tickRange: RANGE });
    const b = new TrialSet(seeds, { level: 1, tickRange: RANGE });

    const tpo = a.systems.map(s => s.ticksPerFastestOrbit);
    const lo = Math.min(...tpo), hi = Math.max(...tpo);
    check("the step size actually varies across systems", a.size > 1 && hi / lo > 1.3,
        `${a.size} systems spanning ${lo.toFixed(0)}–${hi.toFixed(0)} ticks per fastest orbit`);
    check("every drawn step respects the resolution floor", lo >= MIN_TICKS_PER_ORBIT,
        `lowest ${lo.toFixed(0)} vs floor ${MIN_TICKS_PER_ORBIT}`);

    // The one that matters. Same seeds must rebuild the same steps, or two
    // workers scoring the same generation are scoring different problems.
    let same = a.size === b.size && a.size > 0;
    for (let i = 0; same && i < a.size; i++) same = a.systems[i].dt === b.systems[i].dt;
    check("the same seeds rebuild the identical steps (common random numbers holds)", same,
        "two independently built trial sets agree bit for bit");

    // And a fixed-step set must be unaffected by the feature existing.
    const f = new TrialSet(seeds, { level: 1, tickFrac: 0.02 });
    const fixed = f.systems.every(s => Math.abs(s.ticksPerFastestOrbit - 50) < 1e-9);
    check("without a range the step stays exactly where it was", fixed,
        `all ${f.size} systems at 50 ticks per fastest orbit`);
}

/* ============================================== 6. fresh brains and the GA */
section("evolution");
{
    setModelCfg({ mode: "phys", image: false, mem: 8, rounds: 2 });
    const p = new Predictor(mulberry32(1));
    console.log(`      genome: ${p.nParams()} parameters (${specLabel()})`);
    const ts = new TrialSet(seedsFor(2, 3, 0), { level: 0 });
    const fresh = ts.evaluate(predictorRunner(p));
    const drift = ts.evaluate(DRIFT_RUNNER);
    check("a fresh brain is finite and near the do-nothing baseline",
        Number.isFinite(fresh.digits) && fresh.blew === 0 && Math.abs(fresh.digits - drift.digits) < 1.0,
        `fresh ${fresh.digits.toFixed(2)} vs drift ${drift.digits.toFixed(2)}`);

    // Same genome, same trial set, twice — the recurrent latent makes this worth
    // checking explicitly. A latent left over from a previous rollout would make
    // the second evaluation differ, and would be a private channel through which
    // one episode's state leaks into another's prediction.
    const again = ts.evaluate(predictorRunner(p));
    check("evaluation is repeatable (memory is reset per rollout)",
        Math.abs(again.digits - fresh.digits) < 1e-12);
}
{
    const t0 = Date.now();
    const evo = new Evolution(24, 12345, rng => new Predictor(rng));
    let first = null, last = null;
    for (let g = 0; g < 6; g++) {
        const ts = new TrialSet(seedsFor(g, 3, 0), { level: 0 });
        const results = evo.brains.map(brain => {
            const ev = ts.evaluate(predictorRunner(brain));
            return { brain, fitness: fitnessOf(ev), digits: ev.digits, worst: ev.worst, blew: ev.blew };
        });
        const rec = evo.evolve(results, 0.12, 0.4, 3, {});
        if (first === null) first = rec.best;
        last = rec.best;
        console.log(`      gen ${g + 1}: best ${(rec.best / 100).toFixed(3)} mean ${(rec.avg / 100).toFixed(3)} digits`);
    }
    check("6 generations of evolution improve the best genome", last > first,
        `${(first / 100).toFixed(3)} → ${(last / 100).toFixed(3)} digits in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    check("champion was captured", evo.champion !== null && evo.championFit === last || evo.championFit >= last);
}

console.log(`\n${failures ? "\x1b[31m" : "\x1b[32m"}${checks - failures}/${checks} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
