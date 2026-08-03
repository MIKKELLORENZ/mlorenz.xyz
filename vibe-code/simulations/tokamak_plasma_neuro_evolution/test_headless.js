/* test_headless.js — Node smoke test and physics calibration.
 *
 *   node test_headless.js          run everything
 *   node test_headless.js physics  just the physics checks
 *   node test_headless.js tune     sweep the PID gains and print the best set
 *
 * The physics section is not decoration. Three of its claims are the entire
 * premise of the exercise and would silently rot without them:
 *   - a circular plasma left alone is roughly neutral
 *   - an elongated one runs away in milliseconds
 *   - and it is the CONDUCTING WALL, not a numerical fudge, that sets how fast
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "greens.js", "machine.js", "tokamak.js", "tasks.js",
    "pid.js", "evolution.js", "world.js", "obs_norm.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

let failures = 0;
function check(name, ok, extra) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}
const mode = process.argv[2] || "all";

/* ------------------------------------------------------------ 1. Green's */
{
    const fo = [0, 0];
    // K(0) = E(0) = π/2
    const ke = ellipke(0, [0, 0]);
    check("greens: K(0) = E(0) = π/2", Math.abs(ke[0] - Math.PI / 2) < 1e-12 && Math.abs(ke[1] - Math.PI / 2) < 1e-12);
    // K(0.5) = 1.85407468, E(0.5) = 1.35064388
    const ke2 = ellipke(0.5, [0, 0]);
    check("greens: K(0.5), E(0.5) match tables",
        Math.abs(ke2[0] - 1.8540746773) < 1e-9 && Math.abs(ke2[1] - 1.3506438810) < 1e-9,
        `${ke2[0].toFixed(9)}, ${ke2[1].toFixed(9)}`);
    // mutual inductance is symmetric
    const m1 = mutual(0.5, 0.1, 1.2, -0.3, 0.02);
    const m2 = mutual(1.2, -0.3, 0.5, 0.1, 0.02);
    check("greens: mutual inductance symmetric", Math.abs(m1 - m2) < 1e-15 * Math.abs(m1) + 1e-18,
        `${m1.toExponential(6)} vs ${m2.toExponential(6)}`);
    // on-axis field of a loop: B_z = μ0 I /(2a) at the centre
    loopField(1.0, 0, 1e-6, 0, 0, fo);
    check("greens: on-axis field → μ0/2a", Math.abs(fo[1] - MU0 / 2) / (MU0 / 2) < 1e-4,
        `${fo[1].toExponential(5)} vs ${(MU0 / 2).toExponential(5)}`);
}

/* ------------------------------------------------------------ 2. machine */
const mac = getMachine();
{
    console.log(`  machine built in ${mac.buildMs.toFixed(0)} ms — ${mac.nc} circuits, ${mac.nv} vessel loops, ` +
        `${N_FLUX} flux loops, ${N_PROBE} probes`);
    const n = mac.n;
    let sym = true, posdiag = true;
    for (let i = 0; i < n; i++) {
        if (!(mac.M[i * n + i] > 0)) posdiag = false;
        for (let j = 0; j < n; j++) {
            if (Math.abs(mac.M[i * n + j] - mac.M[j * n + i]) > 1e-14) sym = false;
        }
    }
    check("machine: inductance matrix symmetric", sym);
    check("machine: self-inductances positive", posdiag);
    // M · M⁻¹ = I
    let maxOff = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            let s = 0;
            for (let k = 0; k < n; k++) s += mac.M[i * n + k] * mac.Minv[k * n + j];
            maxOff = Math.max(maxOff, Math.abs(s - (i === j ? 1 : 0)));
        }
    }
    check("machine: M·M⁻¹ = I", maxOff < 1e-8, `max residual ${maxOff.toExponential(2)}`);

    const taus = mac.circuits.map((c, i) => mac.M[i * n + i] / mac.res[i]);
    check("machine: fast coil is ~100× faster than the shaping coils",
        taus[18] < taus[0] / 30, `G ${(taus[18] * 1e3).toFixed(2)} ms vs F1 ${(taus[0] * 1e3).toFixed(1)} ms`);
    console.log(`  L/R: F1 ${(taus[0] * 1e3).toFixed(1)} ms · E1 ${(taus[8] * 1e3).toFixed(1)} ms · ` +
        `OH1 ${(taus[16] * 1e3).toFixed(0)} ms · G ${(taus[18] * 1e3).toFixed(2)} ms · ` +
        `vessel ${(mac.vesselTau * 1e3).toFixed(1)} ms`);

    // the grid tables must agree with a direct evaluation
    const fo = [0, 0];
    let worst = 0;
    for (const [R, Z] of [[0.88, 0], [0.80, 0.2], [0.95, -0.3], [0.75, 0.4]]) {
        let dbz = 0;
        for (const e of mac.circuits[0].el) { loopField(e.R, e.Z, R, Z, mac.circuits[0].rc, fo); dbz += e.turns * fo[1]; }
        const gbz = mac.sample(mac.gBZ[0], R, Z);
        worst = Math.max(worst, Math.abs(gbz - dbz) / Math.max(1e-9, Math.abs(dbz)));
    }
    check("machine: field tables within 2% of direct evaluation", worst < 0.02,
        `worst ${(worst * 100).toFixed(2)}%`);
}

/* -------------------------------------------------- 3. equilibrium & drift */
function openLoop(taskId, steps, opts) {
    opts = opts || {};
    const rng = mulberry32(opts.seed || 4);
    const task = makeTask(taskId, mac, rng, { kick: opts.kick != null ? opts.kick : 0 });
    const tok = new Tokamak(mac, { rng: mulberry32(7), noise: false, randomise: false });
    tok.reset(task, mulberry32(7));
    if (opts.noWall) {
        // Open every vessel loop: raise their resistance so far that no eddy
        // current can flow. This is the control experiment for "does the wall
        // set the growth rate".
        for (let i = tok.nc; i < tok.n; i++) tok._res[i] = mac.res[i] * 1e7;
        tok._buildStepMatrices();
    }
    if (opts.kappaLock) { tok.kappa = opts.kappaLock; tok._updateGeometry(); }
    if (opts.z0) tok.pZ += opts.z0;
    const act = new Float32Array(19);
    const trace = [];
    for (let i = 0; i < steps && !tok.dead; i++) {
        tok.step(act);
        // Every control step: a wall-less plasma is on the limiter in under a
        // millisecond, and a trace sampled any coarser has too few points left
        // in the linear window to fit a growth rate at all.
        trace.push([tok.t, tok.pZ, tok.pR, tok.Ip, tok.kappa]);
    }
    return { tok, trace, task };
}

/* Fit |Z| ∝ exp(t/τ) over the window where the displacement is between 0.5 mm
 * and 3 cm — small enough to still be linear, large enough not to be noise. */
function growthTime(trace, z0) {
    const pts = trace.filter(p => Math.abs(p[1] - 0) > Math.abs(z0) * 1.2 && Math.abs(p[1]) < 0.03);
    if (pts.length < 4) return Infinity;
    const n = pts.length;
    let st = 0, sy = 0, stt = 0, sty = 0;
    for (const p of pts) {
        const t = p[0], y = Math.log(Math.abs(p[1]));
        st += t; sy += y; stt += t * t; sty += t * y;
    }
    const slope = (n * sty - st * sy) / (n * stt - st * st);
    return slope > 0 ? 1 / slope : Infinity;
}

if (mode === "all" || mode === "physics") {
    // --- circular: nearly neutral -----------------------------------------
    {
        const r = openLoop("circular", 400, { z0: 0.004 });
        const tg = growthTime(r.trace, 0.004);
        const drift = Math.abs(r.tok.pR - 0.88);
        console.log(`  circular: κ ${r.tok.kappa.toFixed(2)}, n-index ${r.tok.nIndex.toFixed(2)}, ` +
            `Z ${(r.tok.pZ * 1e3).toFixed(2)} mm after 40 ms, R drift ${(drift * 1e3).toFixed(1)} mm`);
        check("physics: circular plasma holds its radial position open-loop", drift < 0.03,
            `${(drift * 1e3).toFixed(1)} mm`);
        check("physics: circular plasma is nearly vertically neutral",
            Math.abs(r.tok.pZ) < 0.02, `|Z| = ${(Math.abs(r.tok.pZ) * 1e3).toFixed(2)} mm after 40 ms (γ⁻¹ ${isFinite(tg) ? (tg * 1e3).toFixed(1) + " ms" : "stable"})`);
    }
    // --- elongated: runs away in milliseconds -------------------------------
    let tauWall = 0;
    {
        const r = openLoop("elongated", 900, { z0: 0.002 });
        tauWall = growthTime(r.trace, 0.002);
        console.log(`  elongated: κ ${r.tok.kappa.toFixed(2)}, n-index ${r.tok.nIndex.toFixed(2)}, ` +
            `dead ${r.tok.dead ? r.tok.deadReason + " @ " + (r.tok.t * 1e3).toFixed(1) + " ms" : "no"}`);
        check("physics: elongated plasma is vertically unstable open-loop",
            r.tok.dead && /vertical|wall/.test(r.tok.deadReason || ""),
            `${r.tok.deadReason} at ${(r.tok.t * 1e3).toFixed(1)} ms`);
        check("physics: growth time is 2-25 ms (catchable, but only just)",
            tauWall > 0.002 && tauWall < 0.025, `γ⁻¹ = ${(tauWall * 1e3).toFixed(2)} ms`);
    }
    // --- and it is the wall doing the slowing -------------------------------
    {
        const r = openLoop("elongated", 900, { z0: 0.002, noWall: true });
        const tauNo = growthTime(r.trace, 0.002);
        check("physics: removing the conducting wall makes it much faster",
            tauNo < tauWall * 0.5,
            `γ⁻¹ ${(tauNo * 1e3).toFixed(3)} ms without wall vs ${(tauWall * 1e3).toFixed(2)} ms with`);
    }
    // --- plasma current decays slowly, ohmic drive can hold it --------------
    {
        const r = openLoop("elongated", 200, {});
        const dIp = (r.tok.Ip - 150e3) / 150e3;
        check("physics: I_p decays only a few % over 20 ms open-loop", Math.abs(dIp) < 0.05,
            `${(dIp * 100).toFixed(2)}%`);
    }
    // --- sensors ------------------------------------------------------------
    {
        const tok = new Tokamak(mac, { rng: mulberry32(3), noise: false, randomise: false });
        tok.reset(makeTask("elongated", mac, mulberry32(3), { kick: 0 }), mulberry32(3));
        const p0 = Float64Array.from(tok.probeTrue);
        const f0 = Float64Array.from(tok.fluxTrue);
        tok.pZ += 0.02; tok._updateGeometry(); tok._sensors();
        let dp = 0, df = 0;
        for (let i = 0; i < N_PROBE; i++) dp = Math.max(dp, Math.abs(tok.probeTrue[i] - p0[i]));
        for (let i = 0; i < N_FLUX; i++) df = Math.max(df, Math.abs(tok.fluxTrue[i] - f0[i]));
        check("sensors: probes respond to a 2 cm vertical shift", dp > NOISE_BASE.probe * 5,
            `Δ ${(dp * 1e3).toFixed(3)} mT vs ${(NOISE_BASE.probe * 1e3).toFixed(3)} mT noise`);
        check("sensors: flux loops respond too, but more weakly", df > NOISE_BASE.flux,
            `Δ ${(df * 1e3).toFixed(3)} mWb vs ${(NOISE_BASE.flux * 1e3).toFixed(3)} mWb noise`);
        let finite = true;
        for (let i = 0; i < N_PROBE; i++) if (!Number.isFinite(tok.probeTrue[i])) finite = false;
        check("sensors: all readings finite", finite);
    }
    // --- observation contract ------------------------------------------------
    {
        setObsMode("full"); refreshNetSizes();
        const tok = new Tokamak(mac, { rng: mulberry32(5), noise: true, randomise: true });
        tok.reset(makeTask("morph", mac, mulberry32(5)), mulberry32(5));
        const act = new Float32Array(19);
        for (let i = 0; i < 50; i++) tok.step(act);
        const o = tok.observe();
        let finite = true, big = 0;
        const W = modeSpec().obs;
        for (let i = 0; i < W; i++) { if (!Number.isFinite(o[i])) finite = false; big = Math.max(big, Math.abs(o[i])); }
        // 149 as specified, plus the temporal block. The first 149 neurons are
        // still exactly the contract, in the same order — the extra ones are
        // appended, never interleaved, so the layout in PHYSICS.md still reads
        // straight off the front of the vector.
        check(`interface: observation is ${149 + N_TEMPORAL} wide (149 spec + ${N_TEMPORAL} temporal)`,
            W === 149 + N_TEMPORAL && NET_SIZES[0] === W);
        check("interface: every observation neuron finite", finite);
        // The two blocks get different bounds, and the reason is worth stating.
        // This probe runs an UNCONTROLLED plasma — zero action for 50 steps — so
        // by the time it is sampled the thing is drifting hard. The sensor
        // neurons barely notice, because a whitened flux loop moves by a
        // fraction of its spread. The temporal neurons are rates and lagged
        // differences of exactly the quantity that is running away, and they are
        // whitened against a mix of PID, champion and random episodes in which
        // nothing runs away this far, so several sd is the correct reading, not
        // a scaling error. tanh saturates and the network is unharmed. A bound
        // of 40 still catches the failure this check exists for: a channel
        // scaled by the wrong power of ten.
        let bigSpec = 0, bigTemp = 0;
        for (let i = 0; i < 149; i++) bigSpec = Math.max(bigSpec, Math.abs(o[i]));
        for (let i = 149; i < W; i++) bigTemp = Math.max(bigTemp, Math.abs(o[i]));
        check("interface: normalisation keeps the specified block O(1)", bigSpec < 12,
            `max |x| = ${bigSpec.toFixed(2)}`);
        check("interface: temporal block stays bounded on a runaway plasma", bigTemp < 40,
            `max |x| = ${bigTemp.toFixed(2)}`);
        setObsMode("trim"); refreshNetSizes();
        const t2 = new Tokamak(mac, { rng: mulberry32(5), noise: true, randomise: true });
        t2.reset(makeTask("elongated", mac, mulberry32(5)), mulberry32(5));
        t2.step(new Float32Array(5));
        const o2 = t2.observe();
        let f2 = true;
        for (let i = 0; i < 31; i++) if (!Number.isFinite(o2[i])) f2 = false;
        check("interface: trimmed mode is 31 → 5 and finite", modeSpec().obs === 31 && modeSpec().act === 5 && f2);
        setObsMode("full"); refreshNetSizes();
    }
    // --- the coupling that makes this hard ----------------------------------
    {
        // Every coil must move a large fraction of the sensors. If any coil were
        // cleanly separable the problem would decompose and the exercise would
        // be hollow.
        const tok = new Tokamak(mac, { rng: mulberry32(9), noise: false, randomise: false });
        tok.reset(makeTask("elongated", mac, mulberry32(9), { kick: 0 }), mulberry32(9));
        let minTouched = 1e9, worstCoil = -1;
        for (let c = 0; c < 19; c++) {
            let touched = 0;
            for (let s = 0; s < N_PROBE; s++) {
                if (Math.abs(mac.sProbeC[s * mac.n + c] * 1000) > NOISE_BASE.probe) touched++;
            }
            if (touched < minTouched) { minTouched = touched; worstCoil = c; }
        }
        check("coupling: the least-connected coil still moves most probes",
            minTouched > N_PROBE * 0.6,
            `${mac.circuits[worstCoil].name} moves ${minTouched}/${N_PROBE} probes at 1 kA`);
    }
    // --- difficulty ladder ---------------------------------------------------
    /* A ladder is only useful if it is MONOTONIC and if rung 0 is untouched.
     * Both are easy to break by editing one number in DIFFICULTY, and neither
     * failure announces itself during a training run — a non-monotonic ladder
     * just looks like a controller that got mysteriously better when promoted,
     * and a rung 0 that has drifted invalidates every "no forgetting" claim the
     * curriculum makes. */
    {
        const errs = [], kaps = [];
        const ctrl = new PIDController(mac);
        for (let L = 0; L < N_LEVELS; L++) {
            const t = makeTask("elongated", mac, mulberry32(11), { level: L });
            kaps.push(t.shapeAt(t.duration * 0.5).kappa);
            let e = 0, n = 0;
            for (const s of [4001, 4002, 4003, 4004]) {
                const w = new World(mac, [], {
                    taskId: "elongated", missionSeed: s, noise: true, randomise: true,
                    level: L, withPid: true, pidController: ctrl
                });
                while (!w.isOver()) w.step();
                e += w.pidResult().boundaryErr; n++;
            }
            errs.push(100 * e / n);
        }
        let monoK = true, monoE = true;
        for (let L = 1; L < N_LEVELS; L++) {
            if (kaps[L] <= kaps[L - 1]) monoK = false;
            if (errs[L] <= errs[L - 1]) monoE = false;
        }
        console.log(`\n  difficulty ladder (PID baseline on "elongated"):`);
        for (let L = 0; L < N_LEVELS; L++) {
            console.log(`    L${L} ${DIFFICULTY[L].label.padEnd(8)} κ ${kaps[L].toFixed(2)}   ` +
                `boundary ${errs[L].toFixed(2)} cm`);
        }
        check("difficulty: elongation rises with every rung", monoK,
            `κ ${kaps.map(k => k.toFixed(2)).join(" → ")}`);
        check("difficulty: each rung really is harder for the baseline", monoE,
            `${errs.map(e => e.toFixed(1)).join(" → ")} cm`);
        // Rung 0 must be the original simulator, bit for bit.
        const d0 = difficultyOf(0);
        check("difficulty: rung 0 is untouched",
            d0.kappaGain === 0 && d0.wall === 1 && d0.kick === 1 && d0.noise === 1 && d0.spread === 1);
        // And the plan must always keep rung 0 in the training mix.
        const plan = episodePlan(2, 6, 0, N_LEVELS - 1);
        check("difficulty: every generation still trains on rung 0",
            plan.some(p => p.level === 0),
            `levels ${plan.map(p => p.level).join(",")}`);
    }
}

/* ------------------------------------------------------------- 4. baseline */
function runPID(taskId, gains, seed, randomise) {
    const rng = mulberry32(seed);
    const task = makeTask(taskId, mac, rng);
    const tok = new Tokamak(mac, { rng: mulberry32(seed + 1), noise: true, randomise: randomise !== false });
    tok.reset(task, mulberry32(seed + 1));
    const ctrl = new PIDController(mac, gains);
    ctrl.reset(task);
    const steps = Math.round(task.duration / DT_CTRL);
    let err = 0, n = 0, score = 0;
    for (let i = 0; i < steps; i++) {
        if (tok.dead) { score -= World.DEAD_STEP_COST; continue; }
        const a = ctrl.step(tok);
        tok.step(a);
        if (tok.dead) { score -= World.DEAD_STEP_COST; continue; }
        score += tok.reward(a);
        err += tok.boundaryError(); n++;
    }
    return {
        fitness: 100 * score / steps, err: n ? err / n : 1,
        dead: tok.dead, reason: tok.deadReason, t: tok.t,
        survival: tok.dead ? tok.t / task.duration : 1
    };
}

if (mode === "tune") {
    // Coordinate sweep over the vertical loop first (nothing else matters if the
    // plasma is on the wall), then the radial loop.
    let best = Object.assign({}, PID_GAINS), bestScore = -1e9;
    const score = (g) => {
        let s = 0;
        for (const t of ["circular", "elongated", "vtrack", "morph", "negd", "outward"]) {
            for (let seed = 1; seed <= 3; seed++) s += runPID(t, g, seed * 31).fitness;
        }
        return s / 18;
    };
    bestScore = score(best);
    console.log(`start ${bestScore.toFixed(2)}`);
    const axes = [
        ["zKp", [400, 800, 1600, 3200, 6400, 12000, 24000]],
        ["zKd", [0.5, 2, 4, 8, 16, 32, 64]],
        ["zKi", [0, 5e4, 2e5, 8e5, 3e6]],
        ["rKp", [0.03, 0.07, 0.14, 0.20, 0.40, 0.80]],
        ["rKd", [0, 1.5e-4, 3e-4, 6e-4, 1.2e-3, 2.5e-3]],
        ["rKi", [0, 0.5, 2.0, 8.0]],
        ["coilKp", [0.3, 0.8, 2.2, 5.0]],
        ["ipKp", [0.001, 0.003, 0.006, 0.02]],
        ["ipKi", [0.03, 0.1, 0.3, 1.0]],
        ["outerEvery", [5, 10, 20, 40]]
    ];
    for (let pass = 0; pass < 3; pass++) {
        for (const [k, vals] of axes) {
            for (const v of vals) {
                const g = Object.assign({}, best); g[k] = v;
                const s = score(g);
                if (s > bestScore) { bestScore = s; best = g; }
            }
            console.log(`  ${k} → ${best[k]}   (${bestScore.toFixed(2)})`);
        }
    }
    console.log("\nbest gains:", JSON.stringify(best, null, 2));
    console.log(`mean fitness ${bestScore.toFixed(2)}`);
    process.exit(0);
}

if (mode === "all" || mode === "physics" || mode === "pid") {
    console.log("\n  PID baseline, nominal machine, noise on:");
    let held = 0, total = 0;
    for (const t of ["circular", "elongated", "vtrack", "morph", "negd", "ipramp", "outward"]) {
        const r = runPID(t, null, 101);
        total++;
        if (!r.dead) held++;
        console.log(`    ${t.padEnd(10)} fitness ${r.fitness.toFixed(1).padStart(7)}  ` +
            `boundary ${(r.err * 100).toFixed(2)} cm  ` +
            `${r.dead ? "DISRUPTED (" + r.reason + " @ " + (r.t * 1e3).toFixed(0) + " ms)" : "held"}`);
    }
    // The scripted 1.2 s discharge: breakdown → current ramp → shape formation →
    // hold → morph → controlled ramp-down. The baseline does NOT complete it, and
    // that is a real finding rather than a bug: the loops are tuned per channel on
    // ~100 ms tasks, and over a second the observer's shape-dependent bias walks
    // the plasma off the midplane faster than the fast coil's authority can be
    // re-centred. It is the clearest open goal in here for a learned controller.
    {
        let held = 0, tsum = 0;
        for (const seed of [5, 11, 23, 37, 41]) {
            const r = runPID("discharge", null, seed);
            if (!r.dead) held++;
            tsum += r.t;
        }
        console.log(`    discharge  ${held}/5 complete · mean ${(tsum / 5 * 1e3).toFixed(0)} ms of 1200 survived`);
        check("baseline: PID gets most of the way through the 1.2 s discharge",
            tsum / 5 > 0.6, `${(tsum / 5 * 1e3).toFixed(0)} ms mean`);
    }

    check("baseline: PID holds the circular plasma", !runPID("circular", null, 7).dead);
    check("baseline: PID stabilises the elongated plasma", !runPID("elongated", null, 7).dead,
        "the whole comparison is meaningless if it cannot");
    check("baseline: PID survives most of the registry", held >= 5, `${held}/${total} tasks held`);
}

/* ----------------------------------------------------------- 5. evolution */
if (mode === "all" || mode === "evo") {
    setObsMode("full"); refreshNetSizes();
    const evo = new Evolution(16, 123, NET_SIZES);
    let last = null;
    const t0 = Date.now();
    for (let gen = 0; gen < 3; gen++) {
        const stage = stageFor(evo.gen, evo.history, {});
        const tasks = episodeTasks(stage, 2);
        const acc = evo.brains.map(b => ({ brain: b, fitness: 0, survival: 0, boundaryErr: 0 }));
        tasks.forEach((tid, ep) => {
            const w = new World(mac, evo.brains, { taskId: tid, missionSeed: gen * 10 + ep, noise: true });
            while (!w.isOver()) w.step();
            w.results().forEach((r, i) => {
                acc[i].fitness += normalizeFitness(r.fitness, stageOpts(stage).scale) / tasks.length;
                acc[i].survival += r.survival / tasks.length;
                acc[i].boundaryErr += r.boundaryErr / tasks.length;
            });
        });
        last = evo.evolve(acc, 0.1, 0.12, 3, {}, { stage, newSurv: acc.reduce((s, a) => s + a.survival, 0) / acc.length });
        console.log(`  gen ${gen + 1}: stage ${stage}, best ${last.best.toFixed(3)}, ` +
            `mean ${last.avg.toFixed(3)}, survival ${(last.avgSurv * 100).toFixed(0)}%`);
        check(`evolution gen ${gen + 1}: finite fitness`, Number.isFinite(last.best) && Number.isFinite(last.avg));
    }
    check("evolution: population size stable", evo.brains.length === 16);
    check("evolution: champion recorded", evo.champion !== null);
    const json = JSON.stringify(evo.champion.toJSON());
    const back = Net.fromJSON(JSON.parse(json));
    const inp = new Float32Array(NET_SIZES[0]).fill(0.3);
    const o1 = evo.champion.forward(inp), o2 = back.forward(inp);
    let same = true;
    for (let i = 0; i < 19; i++) if (Math.abs(o1[i] - o2[i]) > 1e-6) same = false;
    check("nn: JSON round-trip identical", same);
    console.log(`  3 generations × 16 brains × 2 episodes in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

/* -------------------------------------------------------- 6. determinism */
if (mode === "all") {
    const run = () => {
        const rng = mulberry32(77);
        const task = makeTask("elongated", mac, rng);
        const tok = new Tokamak(mac, { rng: mulberry32(78), noise: true, randomise: true });
        tok.reset(task, mulberry32(78));
        const net = new Net(NET_SIZES, mulberry32(5));
        for (let i = 0; i < 300 && !tok.dead; i++) tok.step(net.forward(tok.observe()));
        return [tok.pZ, tok.pR, tok.Ip];
    };
    const a = run(), b = run();
    check("determinism: same seeds → identical episode",
        a.every((v, i) => v === b[i]), `Z ${a[0].toExponential(4)}`);
}

/* ------------------------------------------------------------ 7. timing */
if (mode === "all" || mode === "bench") {
    setObsMode("full"); refreshNetSizes();
    const brains = [];
    for (let i = 0; i < 24; i++) brains.push(new Net(NET_SIZES, mulberry32(100 + i)));
    const t0 = Date.now();
    const w = new World(mac, brains, { taskId: "elongated", missionSeed: 1, noise: true });
    let k = 0;
    while (!w.isOver()) { w.step(); k++; }
    const ms = Date.now() - t0;
    console.log(`  24 brains × ${k} control steps (${(k * DT_CTRL * 1e3).toFixed(0)} ms of discharge) ` +
        `in ${ms} ms  →  ${(24 * k / ms).toFixed(0)} plasma-steps/ms`);
    check("bench: a 24-brain episode runs in under 6 s", ms < 6000, `${ms} ms`);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
