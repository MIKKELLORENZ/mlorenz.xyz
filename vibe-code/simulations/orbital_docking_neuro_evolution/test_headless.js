/* test_headless.js — run with `node test_headless.js`.
 *
 * A regression net over the things that were measured the hard way, plus the
 * physics checks that would have caught the two bugs that cost the most time:
 * the Clohessy-Wiltshire sign error (every long-range plan was garbage and the
 * symptom looked like controller tuning) and the minimum-impulse deadband floor
 * (the autopilot reported itself converged while physically unable to point
 * well enough to dock).
 *
 * The physics tests do not compare against remembered numbers. They compare the
 * integrator against closed-form orbital mechanics, and the linearised model
 * against the integrator — so they still mean something after the constants are
 * retuned, which a golden-value test does not.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "orbit.js", "craft.js", "station.js", "sensors.js",
    "scenarios.js", "pilot.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
}
function close(name, a, b, tol, unit) {
    const d = Math.abs(a - b);
    ok(name, d <= tol, `${a} vs ${b}, off by ${d.toPrecision(3)}${unit || ""} (tol ${tol})`);
}
function section(s) { console.log(`\n${s}`); }

/* ------------------------------------------------------------ orbit core */
section("orbital mechanics");
{
    const el = { a: 6791000, e: 0, i: 51.64 * Math.PI / 180, raan: 0.4, argp: 0, M: 0 };
    const k = keplerToCartesian(el);
    close("circular orbit radius", V.len(k.r), el.a, 1, " m");
    close("circular orbit speed", V.len(k.v), Math.sqrt(MU / el.a), 1e-6, " m/s");
    close("position ⊥ velocity on a circle", V.dot(V.unit(k.r), V.unit(k.v)), 0, 1e-12);

    // One period of RK4 with J2 switched off in spirit: J2 makes the orbit
    // precess, so check the RADIUS returns, not the position vector.
    const T = 2 * Math.PI / meanMotion(el.a);
    let y = new Float64Array(12);
    for (let i = 0; i < 3; i++) { y[i] = k.r[i]; y[3 + i] = k.v[i]; }
    const dt = 5, n = Math.round(T / dt);
    for (let s = 0; s < n; s++) y = stepRK4(y, dt, [0, 0, 0]);
    const r2 = Math.hypot(y[0], y[1], y[2]);
    close("radius after one orbit (RK4, dt=5 s)", r2, el.a, 3000, " m");

    const B = lvlhBasis(k.r, k.v);
    close("LVLH is orthonormal (x·y)", V.dot(B.x, B.y), 0, 1e-12);
    close("LVLH is orthonormal (y·z)", V.dot(B.y, B.z), 0, 1e-12);
    const xcy = V.cross(B.x, B.y);
    close("LVLH is right-handed (x×y = z)", V.len(V.sub(xcy, B.z)), 0, 1e-12);
    close("LVLH z is nadir", V.dot(B.z, V.unit(k.r)), -1, 1e-12);
    close("LVLH x is along-track", V.dot(B.x, V.unit(k.v)), 1, 1e-9);
}

section("differential gravity");
{
    // diffGrav must equal the difference of the two absolute accelerations. The
    // whole point of the Battin form is that it computes that difference
    // WITHOUT the catastrophic cancellation, so at 10 m separation the naive
    // subtraction is the one that is wrong — compare at 50 km, where both are
    // accurate, and then check the small-separation limit analytically.
    const rs = [6791000 * 0.6, 6791000 * 0.5, 6791000 * 0.62360956];
    const rho = [12000, -31000, 8000];
    const d = diffGrav(rs, rho);
    const naive = V.sub(gravJ2(V.add(rs, rho)), gravJ2(rs));
    close("Battin form matches the naive difference at 35 km", V.len(V.sub(d, naive)), 0, 1e-9, " m/s²");

    /* A purely radial offset: the point-mass part of the inertial differential
     * gravity is 2μδr/r³. The residual is NOT slop — it is the J2 differential,
     * so assert that too rather than widening the tolerance until the test
     * stops noticing it. At the equator with a 100 m offset the oblateness term
     * contributes about 7e-7 m/s², which is 0.3% of the point-mass tide and was
     * initially mistaken for an integration error. */
    const rmag = 6791000;
    const rs2 = [rmag, 0, 0], drho = [-100, 0, 0];      // 100 m lower
    const d2 = diffGrav(rs2, drho);
    const pm = 2 * MU / (rmag * rmag * rmag) * (-100);
    close("radial tide ≈ 2μδr/r³", d2[0], pm, Math.abs(pm) * 5e-3, " m/s²");
    const j2diff = (gravJ2(V.add(rs2, drho))[0] - pointMass(V.add(rs2, drho))[0]) -
        (gravJ2(rs2)[0] - pointMass(rs2)[0]);
    close("...and the residual is exactly the J2 differential",
        d2[0] - pm, j2diff, Math.abs(pm) * 1e-3, " m/s²");
}

section("Clohessy-Wiltshire agrees with the integrator");
{
    /* THIS IS THE TEST THAT WOULD HAVE CAUGHT THE SIGN BUG. CW is a
     * linearisation, so it may not match the nonlinear integrator exactly — but
     * over a fraction of an orbit at a few hundred metres it must match to a
     * fraction of a percent, and a sign error in the radial/along-track
     * coupling shows up as a trajectory going the wrong way entirely.
     *
     * The physical statement being checked: a vessel 100 m BELOW the station is
     * in a lower, faster orbit, and it must pull AHEAD. */
    const el = { a: 6791000, e: 0, i: 0.9, raan: 0, argp: 0, M: 0 };
    const k = keplerToCartesian(el);
    const n = meanMotion(el.a);
    const B0 = lvlhBasis(k.r, k.v);

    for (const st0 of [[0, 0, 100, 0, 0, 0], [200, 0, 0, 0, 0, 0], [0, 150, 0, 0, 0, 0],
    [0, 0, 0, 0.05, 0, 0], [0, 0, 0, 0, 0, 0.05]]) {
        const rho = fromLvlh([st0[0], st0[1], st0[2]], B0);
        const w0 = lvlhRate(k.r, k.v);
        const rhoDot = V.add(fromLvlh([st0[3], st0[4], st0[5]], B0), V.cross(w0, rho));
        let y = new Float64Array(12);
        for (let i = 0; i < 3; i++) {
            y[i] = k.r[i]; y[3 + i] = k.v[i]; y[6 + i] = rho[i]; y[9 + i] = rhoDot[i];
        }
        const tof = 900;
        const dt = 1.0;
        for (let s = 0; s < tof / dt; s++) y = stepRK4(y, dt, [0, 0, 0]);
        const rs = [y[0], y[1], y[2]], vs = [y[3], y[4], y[5]];
        const B = lvlhBasis(rs, vs);
        const truth = toLvlh([y[6], y[7], y[8]], B);
        const cw = cwApply(cwState(tof, n), st0);
        const err = Math.hypot(truth[0] - cw[0], truth[1] - cw[1], truth[2] - cw[2]);
        const scale = Math.max(1, Math.hypot(cw[0], cw[1], cw[2]));
        ok(`CW matches integration after 900 s from [${st0.slice(0, 3)}]`,
            err / scale < 0.02, `err ${err.toFixed(2)} m on ${scale.toFixed(1)} m`);
    }

    // The sign statement on its own, stated physically.
    const cw = cwApply(cwState(900, n), [0, 0, 100, 0, 0, 0]);
    ok("a vessel 100 m below pulls AHEAD (+V-bar)", cw[0] > 0, `x = ${cw[0].toFixed(1)} m`);
    ok("...and its radial offset grows, not shrinks", cw[2] > 100, `z = ${cw[2].toFixed(1)} m`);

    // The targeting solver must invert its own propagation.
    const r0 = [500, -200, 120];
    const v0 = cwTargetVelocity(r0, [0, 0, 0], 1200, n);
    const end = cwApply(cwState(1200, n), [r0[0], r0[1], r0[2], v0[0], v0[1], v0[2]]);
    close("two-impulse solver hits its target", Math.hypot(end[0], end[1], end[2]), 0, 1e-6, " m");
}

/* -------------------------------------------------------------- vehicle */
section("vehicle");
{
    close("Δv budget from the full tank", CRAFT.isp * G0 * Math.log((CRAFT.dryMass + CRAFT.propMass) / CRAFT.dryMass), 243, 3, " m/s");

    // The minimum impulse bit is the ONLY deadband. A command that rounds below
    // half a pulse must not fire; one that rounds to a pulse must deliver
    // exactly one pulse's worth.
    ok("a sub-pulse command does not fire", Craft.quantise(0.01, 0.25) === 0);
    close("one pulse in a 0.25 s tick is 8% duty", Craft.quantise(0.09, 0.25), 0.08, 1e-9);
    ok("full command saturates at 1", Math.abs(Craft.quantise(1.4, 0.25) - 1) < 1e-9);
    ok("quantisation is odd in sign", Craft.quantise(-0.5, 0.25) === -Craft.quantise(0.5, 0.25));

    // Propellant accounting: force × time / (Isp g₀).
    const c = new Craft({ prop: 100 });
    const before = c.prop;
    const w = c.commandWrench([1, 0, 0, 0, 0, 0], 1.0);
    close("mass flow is F/(Isp·g₀)", w.used, CRAFT.thrustMain / (CRAFT.isp * G0), 1e-9, " kg");
    close("propellant is actually deducted", before - c.prop, w.used, 1e-12, " kg");
    ok("+X pushes forward", w.f[0] > 0);
    const w2 = new Craft({}).commandWrench([-1, 0, 0, 0, 0, 0], 1.0);
    ok("braking is weaker than accelerating (canted nozzles)",
        Math.abs(w2.f[0]) < w.f[0], `${Math.abs(w2.f[0])} vs ${w.f[0]}`);

    // An empty tank produces no thrust.
    const d = new Craft({ prop: 0.001 });
    d.commandWrench([1, 1, 1, 0, 0, 0], 1.0);
    const dry = d.commandWrench([1, 0, 0, 0, 0, 0], 1.0);
    close("an empty tank produces no thrust", V.len(dry.f), 0, 1e-9, " N");

    // Torque-free rotation conserves angular momentum magnitude.
    let q = [1, 0, 0, 0], wv = [0.02, 0.01, -0.015];
    const I = CRAFT.inertia;
    const L0 = V.len([I[0] * wv[0], I[1] * wv[1], I[2] * wv[2]]);
    for (let s = 0; s < 4000; s++) { const r = stepAttitude(q, wv, I, [0, 0, 0], 0.25); q = r.q; wv = r.w; }
    const L1 = V.len([I[0] * wv[0], I[1] * wv[1], I[2] * wv[2]]);
    close("torque-free motion conserves |L|", L1, L0, L0 * 1e-6);
    close("the quaternion stays normalised", V.len([q[0], q[1], q[2]]) ** 0 * Math.hypot(q[0], q[1], q[2], q[3]), 1, 1e-9);
}

/* --------------------------------------------------------------- station */
section("station and capture");
{
    const st = new Station({ attBias: [0, 0, 0], portIndex: 0 });
    const P = st.portPosLvlh(), N = st.portNormalLvlh(), U = st.portUpLvlh();
    close("port normal is a unit vector", V.len(N), 1, 1e-12);
    close("port up is perpendicular to the normal", V.dot(N, U), 0, 1e-12);
    ok("the corridor axis is clear of structure", st.clearance(V.add(P, V.mul(N, 30))) > 10);
    // The array centre in BODY coordinates, not offset from the port — the
    // arrays sit at the station's waist, 16 m behind the docking ring.
    ok("the solar arrays are solid", !!st.hit([0, 24, 0], 2));
    ok("open space beside the arrays is clear", !st.hit([0, 48, 0], 2));

    // A textbook-perfect arrival passes; each single violation fails, alone.
    const good = () => st.capture(V.add(P, V.mul(N, 0)), V.mul(N, -0.06),
        V.mul(N, -1), U, [0, 0, 0]);
    ok("a perfect arrival docks", good().docked);
    ok("too fast is rejected", !st.capture(P, V.mul(N, -0.3), V.mul(N, -1), U, [0, 0, 0]).docked);
    ok("too slow is rejected", !st.capture(P, V.mul(N, -0.005), V.mul(N, -1), U, [0, 0, 0]).docked);
    ok("off centre is rejected",
        !st.capture(V.add(P, V.mul(U, 0.4)), V.mul(N, -0.06), V.mul(N, -1), U, [0, 0, 0]).docked);
    const tilted = V.unit(V.add(V.mul(N, -1), V.mul(U, 0.15)));    // ~8.5°
    ok("misaligned is rejected", !st.capture(P, V.mul(N, -0.06), tilted, U, [0, 0, 0]).docked);
    ok("spinning is rejected", !st.capture(P, V.mul(N, -0.06), V.mul(N, -1), U, [0.02, 0, 0]).docked);
    ok("still inside the ring when it fails",
        st.capture(P, V.mul(N, -0.3), V.mul(N, -1), U, [0, 0, 0]).inRing);
}

/* --------------------------------------------------------------- sensors */
section("sensors");
{
    ok("NIN is the sum over the lag plan",
        NIN === GROUPS.reduce((s, g) => s + g.n * g.lags.length, 0), String(NIN));
    const sc = makeScenario(0, 42);
    const w = new World(sc, null, { noise: false });
    const inp = w.sensors.assemble(w.t);
    ok("the input vector is the declared width", inp.length === NIN);
    let finite = true;
    for (let i = 0; i < inp.length; i++) if (!Number.isFinite(inp[i])) finite = false;
    ok("no NaNs or infinities in the input vector", finite);
    let big = 0;
    for (let i = 0; i < inp.length; i++) big = Math.max(big, Math.abs(inp[i]));
    ok("inputs are within a sane range for tanh", big < 12, `max |x| = ${big.toFixed(2)}`);

    // The laser must see the ring when pointed at it from close in, and see
    // nothing at all from beyond its range.
    for (let i = 0; i < 200 && !w.isOver(); i++) w.step();
    ok("the laser reads the ring on a stage-0 approach", w.sensors.lidarSeen > 0,
        `${w.sensors.lidarSeen} returns at ${w.range.toFixed(1)} m`);
    const far = new World(makeScenario(3, 7), null, { noise: false });
    ok("the laser is blind at 70 km", far.sensors.lidarSeen === 0);
}

/* -------------------------------------------------------------- the brain */
section("brain");
{
    const spec = netSpec(NIN);
    const rng = mulberry32(3);
    const b = new Brain(spec, rng);
    const x = new Float32Array(NIN).fill(0.3);
    const lat = b.trunkForward(x);
    const g = b.guidance(lat);
    const c = b.control(lat, g);
    ok("the guidance head is 7 wide", g.length === 7);
    ok("the control head is 6 wide", c.length === 6);
    ok("a fresh brain commands almost no torque",
        Math.max(Math.abs(c[3]), Math.abs(c[4]), Math.abs(c[5])) < 0.04,
        `max |τ| = ${Math.max(Math.abs(c[3]), Math.abs(c[4]), Math.abs(c[5])).toFixed(4)}`);
    ok("a fresh brain does not want to coast", (g[6] + 1) / 2 < 0.5, `coast = ${((g[6] + 1) / 2).toFixed(3)}`);

    const cl = b.clone();
    const c2 = cl.control(cl.trunkForward(x), cl.guidance(cl.trunkForward(x)));
    ok("clone is bit-identical", Array.from(c).every((v, i) => v === c2[i]));
    ok("clone copies mutation scales", cl.trunk.scales.every((s, i) => s === b.trunk.scales[i]));
    const rt = Brain.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    const c3 = rt.control(rt.trunkForward(x), rt.guidance(rt.trunkForward(x)));
    ok("JSON round-trip is exact", Array.from(c).every((v, i) => Math.abs(v - c3[i]) < 1e-6));
    ok("hash distinguishes mutated brains", b.hash() !== b.clone().mutate(1, 1, mulberry32(9)).hash());

    // Calibration must recover the init scales from the weights themselves.
    const before = b.ctrl.scales.slice();
    b.calibrate();
    ok("calibrate() recovers a sane output scale",
        b.ctrl.scales.every((s, i) => s > 0 && s < before[i] * 6 + 1), b.ctrl.scales.join(","));
}

/* ------------------------------------------------------------ determinism */
section("determinism");
{
    /* Every fairness claim in the project — common random numbers, paired
     * duels, reproducible exams — rests on an episode being a pure function of
     * (scenario, brain, noise seed). The Box-Muller spare cached on the RNG
     * rather than in a module variable is what makes that true; a shared spare
     * leaks a normal from whoever drew last into whoever draws next. */
    const sc = makeScenario(1, 88);
    calibrate(sc);
    const b = new Brain(netSpec(NIN), mulberry32(5));
    const a1 = runEpisode(sc, b, { noiseSeed: 777 });
    // Draw a pile of randoms from an unrelated stream in between.
    const other = mulberry32(1234);
    for (let i = 0; i < 101; i++) gaussRand(other);
    const a2 = runEpisode(sc, b, { noiseSeed: 777 });
    ok("the same episode replays identically", a1.score === a2.score && a1.outcome === a2.outcome,
        `${a1.score} / ${a1.outcome} vs ${a2.score} / ${a2.outcome}`);
    const a3 = runEpisode(sc, b, { noiseSeed: 778 });
    ok("a different noise seed is a different episode", a3.score !== a1.score);
    const s1 = makeScenario(3, 5), s2 = makeScenario(3, 5);
    ok("makeScenario is pure in (stage, seed)",
        JSON.stringify(s1.rel) === JSON.stringify(s2.rel));
}

/* ------------------------------------------------------------- the ruler */
section("the scripted autopilot docks");
{
    /* If this fails, the advantage denominator is meaningless, the scenario
     * audition rejects everything, and no amount of evolution can be measured.
     * It is the most load-bearing test in the file. */
    for (let st = 0; st < N_STAGES; st++) {
        let dock = 0, dv = 0;
        const N = 6;
        for (let s = 0; s < N; s++) {
            const sc = makeScenario(st, 200 + s);
            const r = runEpisode(sc, new Pilot(sc, new Station(sc.station)), { noise: false });
            dock += r.docked; dv += r.dv;
        }
        ok(`stage ${st} ${STAGES[st].label}: ${dock}/${N} docked, mean Δv ${(dv / N).toFixed(1)} m/s`,
            dock >= N - 1);
    }
}

section("the scenario audition");
{
    for (let st = 0; st < N_STAGES; st++) {
        let usable = 0;
        const N = 8;
        for (let s = 0; s < N; s++) { const sc = makeScenario(st, 3000 + s); calibrate(sc); if (sc.usable) usable++; }
        ok(`stage ${st}: ${usable}/${N} scenarios pass the audition`, usable >= N - 3);
    }
    // The do-nothing policy must score exactly zero on the progress term, which
    // is what makes advantage comparable across five decades of range.
    const sc = makeScenario(3, 11);
    calibrate(sc);
    const n = runEpisode(sc, null, { noise: false });
    close("advantage of doing nothing is 0", advantageOf(sc, n.score), 0, 1e-9);
    const p = runEpisode(sc, new Pilot(sc, new Station(sc.station)), { noise: false });
    close("advantage of the autopilot is 1", advantageOf(sc, p.score), 1, 1e-6);
}

/* ------------------------------------------------------------- evolution */
section("the genetic algorithm");
{
    ok("fitness folding penalises unflown scenarios",
        foldFitness([1.0], 6) < foldFitness([1.0, 1.0, 1.0, 1.0, 1.0, 1.0], 6));
    ok("fitness folding is monotone in the flown scores",
        foldFitness([0.5, 0.5], 6) < foldFitness([0.6, 0.6], 6));
    ok("the worst scenario carries half the weight",
        foldFitness([1, 1, 1, 1, 1, 0], 6) < foldFitness([0.9, 0.9, 0.9, 0.9, 0.9, 0.9], 6),
        `${foldFitness([1, 1, 1, 1, 1, 0], 6).toFixed(3)} vs ${foldFitness([0.9, 0.9, 0.9, 0.9, 0.9, 0.9], 6).toFixed(3)}`);

    const plan = racePlan(6, {});
    ok("the race is one round per scenario", plan.length === 6);
    const survivors = plan.reduce((n, r) => n * (r.keep >= 1 ? 1 : r.keep), 1);
    ok("the race keeps a small survivor fraction", survivors < 0.2, survivors.toFixed(3));
    ok("racing can be switched off", racePlan(6, { disabled: true }).length === 1);

    // Row-wise crossover must produce whole rows from one parent or the other,
    // never a mixture within a row. (The 0.45–0.52 blend band is the exception
    // and is checked by allowing an averaged row.)
    const rng = mulberry32(17);
    const A = new Brain(netSpec(NIN), mulberry32(1));
    const Bn = new Brain(netSpec(NIN), mulberry32(2));
    const ch = Brain.crossover(A, Bn, rng);
    const l = ch.guid.weights.length - 1;
    const rowLen = ch.guid.sizes[l] + 1, nOut = ch.guid.sizes[l + 1];
    let intact = 0;
    for (let o = 0; o < nOut; o++) {
        let fromA = true, fromB = true;
        for (let i = 0; i < rowLen; i++) {
            if (ch.guid.weights[l][o * rowLen + i] !== A.guid.weights[l][o * rowLen + i]) fromA = false;
            if (ch.guid.weights[l][o * rowLen + i] !== Bn.guid.weights[l][o * rowLen + i]) fromB = false;
        }
        if (fromA || fromB) intact++;
    }
    ok("crossover keeps neurons intact", intact >= nOut - 2, `${intact}/${nOut} rows whole`);

    const evo = new Evolution(40, 3, NIN);
    ok("the population is the requested size", evo.brains.length === 40);
    const res = evo.brains.map((brain, i) => ({ brain, fitness: -i * 0.01, docked: 0 }));
    const before = evo.brains[0];
    evo.evolve(res, 0.1, 0.5, 3, {}, { stage: 0 });
    ok("the best brain survives byte for byte", evo.brains[0].hash() === before.hash());
    ok("the generation counter advances", evo.gen === 2);

    // The ratchet needs BOTH bars, and never demotes.
    const s = { stage: 0, run: 0 };
    for (let i = 0; i < 5; i++) ratchet(s, { 0: { docked: 0.9 } }, { promote: 0.5, anchor: 0.75 });
    ok("promotion needs three consecutive checks, then fires", s.stage === 1, `stage ${s.stage}`);
    const s2 = { stage: 1, run: 0 };
    for (let i = 0; i < 6; i++) ratchet(s2, { 0: { docked: 0.2 }, 1: { docked: 0.99 } }, { promote: 0.5, anchor: 0.75 });
    ok("a forgotten stage 0 blocks promotion", s2.stage === 1, `stage ${s2.stage}`);
}

/* ---------------------------------------------------------- the world */
section("episode mechanics");
{
    // Coasting must be an actual fast-forward, and must not skip the gates.
    const sc = makeScenario(3, 21);
    calibrate(sc);
    const w = new World(sc, null, { noise: false });
    w.coasting = true; w.coastLeft = 300;
    const t0 = w.t, n0 = w.sensors.count;
    w.step();
    ok("a coast step advances more than a control tick", w.t - t0 > 1, `${(w.t - t0).toFixed(1)} s`);
    ok("sensors still sample during a coast", w.sensors.count > n0);

    // The abort gates fire.
    const kill = (stage, seed, mut, expect) => {
        const s = makeScenario(stage, seed); calibrate(s);
        const ww = new World(s, null, { noise: false });
        mut(ww);
        for (let i = 0; i < 40000 && !ww.isOver(); i++) ww.step();
        ok(`abort gate: ${expect.join(" or ")}`, expect.includes(ww.outcome), `got ${ww.outcome}`);
    };
    kill(0, 55, ww => { ww.craft.w = [0.5, 0.5, 0.5]; }, ["tumble"]);
    /* Push it AWAY along its own relative position vector. Adding a fixed
     * velocity to every axis points somewhere arbitrary, and about half the
     * time that is toward the station — which trips the overspeed gate first
     * and tests the wrong thing.
     *
     * Close in, "receded" fires before "flyby" and that is correct: the flyby
     * threshold has a floor of R₀ + 2 km, so from a 50 m hold point the vessel
     * would have to travel two kilometres before it counted as leaving, while
     * the recession rule catches it at 300 m. Both are the same outcome as far
     * as scoring is concerned. Far out, the flyby rule is the binding one. */
    kill(0, 55, ww => {
        const u = V.unit(ww.rho);
        for (let i = 0; i < 3; i++) ww.y[9 + i] += u[i] * 40;
    }, ["receded", "flyby"]);
    kill(3, 55, ww => {
        const u = V.unit(ww.rho);
        for (let i = 0; i < 3; i++) ww.y[9 + i] += u[i] * 120;
    }, ["flyby"]);

    // An episode always terminates.
    for (let st = 0; st < N_STAGES; st++) {
        const s = makeScenario(st, 909); calibrate(s);
        const b = new Brain(netSpec(NIN), mulberry32(st + 60));
        let g = 0; const ww = new World(s, b, { noiseSeed: 1 });
        while (!ww.isOver() && g++ < 200000) ww.step();
        ok(`stage ${st} episode terminates (${g} steps, ${ww.outcome})`, ww.isOver());
    }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
