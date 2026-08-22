/* test_headless.js — run with `node test_headless.js`.
 *
 * These are not unit tests in the usual sense. Almost every check here exists
 * because something specific went wrong during the build and produced a
 * simulation that looked plausible and was not. Where that is the case the test
 * says so, because a test whose failure message explains what it caught is
 * worth three that just say "expected true".
 *
 * The most valuable ones are the ones that check a PHYSICAL sentence rather
 * than a number: a booster falling tail-first must be self-righting; a reward
 * for arriving must be monotone in how hard you arrive; doing nothing must
 * score worse than flying properly. Those are the statements that, when false,
 * make a genetic algorithm sit at the same fitness for a hundred generations
 * while everything appears to be working.
 */
"use strict";

const M = require("./mathx.js");
const ATM = require("./atmosphere.js");
const V = require("./vehicle.js");
const A = require("./aero.js");
const WM = require("./world.js");
const SENS = require("./sensors.js");
const NN = require("./nn.js");
const SC = require("./scenarios.js");
const AP = require("./autopilot.js");
const EV = require("./evolution.js");
const GOLD = require("./golden_test.js");

const DEG = Math.PI / 180;
let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, detail) {
    if (cond) { pass++; }
    else { fail++; fails.push(name + (detail ? "  — " + detail : "")); }
}
function near(name, got, want, tol, detail) {
    const d = Math.abs(got - want);
    ok(name, d <= tol, `got ${got}, wanted ${want} ±${tol}${detail ? " (" + detail + ")" : ""}`);
}
function inRange(name, got, lo, hi, detail) {
    ok(name, got >= lo && got <= hi, `got ${got}, wanted ${lo}..${hi}${detail ? " (" + detail + ")" : ""}`);
}
function section(t) { console.log("\n" + t); }

/* ------------------------------------------------------------- atmosphere */
section("atmosphere");
{
    const a0 = ATM.airAt(0);
    near("ISA sea-level density", a0.rho, 1.225, 0.002);
    near("ISA sea-level speed of sound", a0.a, 340.3, 0.5);
    const a11 = ATM.airAt(11000);
    near("ISA 11 km temperature", a11.T, 216.65, 0.2);
    inRange("ISA 11 km density", a11.rho, 0.35, 0.38);
    ok("density is monotone with altitude",
        ATM.airAt(0).rho > ATM.airAt(3000).rho && ATM.airAt(3000).rho > ATM.airAt(9000).rho);
    ok("below-ground altitude is clamped, not extrapolated", ATM.airAt(-500).rho === ATM.airAt(0).rho);

    /* The wind must be a PURE FUNCTION of (altitude, time). If it carries
     * integrator state then two brains that fly different trajectories through
     * "the same" scenario meet different weather, and every paired comparison
     * in the trainer is measuring the wind instead of the policy. */
    const rng = NN.mulberry32(99);
    const w = new ATM.WindField(rng, 1.0);
    const a = Array.from(w.at(1200, 7.5));
    for (let i = 0; i < 50; i++) w.at(Math.random() * 9000, Math.random() * 60);
    const b = Array.from(w.at(1200, 7.5));
    ok("wind is stateless: re-evaluating gives the identical vector",
        a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
        `${a} vs ${b}`);
}

/* ------------------------------------------------------------------ maths */
section("frames and quaternions");
{
    const q = M.q4(), v = M.v3(), out = M.v3(), back = M.v3();
    M.qFromAxisAngle(q, 0.3, -0.7, 0.5, 1.1);
    M.vset(v, 2, -3, 5);
    M.qrot(out, q, v);
    M.qrotInv(back, q, out);
    ok("qrot then qrotInv is the identity",
        Math.abs(back[0] - 2) < 1e-9 && Math.abs(back[1] + 3) < 1e-9 && Math.abs(back[2] - 5) < 1e-9);
    near("rotation preserves length", M.vlen(out), M.vlen(v), 1e-9);

    /* The exponential-map integrator, against a closed-form rotation. The
     * first-order q += ½ωq that most tutorials use drifts enough at 60°/s that
     * re-normalising silently changes the attitude. */
    const q1 = M.q4(), w = M.v3();
    M.vset(w, 0, 0, 1.0);            // 1 rad/s about body z
    for (let i = 0; i < 1000; i++) M.qIntegrate(q1, w, 0.001);
    const ref = M.q4();
    M.qFromAxisAngle(ref, 0, 0, 1, 1.0);
    near("1 s of integration at 1 rad/s matches the closed form", q1[2], ref[2], 1e-6);
    near("...and stays normalised", Math.hypot(q1[0], q1[1], q1[2], q1[3]), 1, 1e-12);

    const ex = M.v3(), ey = M.v3(), ez = M.v3(), qb = M.q4(), got = M.v3();
    M.vset(ex, 0, 0, -1); M.vset(ez, 1, 0, 0); M.vcross(ey, ez, ex);
    M.qFromBasis(qb, ex, ey, ez);
    M.qrot(got, qb, new Float64Array([0, 0, 1]));
    ok("qFromBasis puts body +Z where it was told",
        Math.abs(got[0] - 1) < 1e-9 && Math.abs(got[2]) < 1e-9, Array.from(got).join(","));
    M.qrot(got, qb, new Float64Array([1, 0, 0]));
    ok("...and body +X (the belly) points down",
        Math.abs(got[2] + 1) < 1e-9, Array.from(got).join(","));
}

section("scoring kernels");
{
    /* THE BUG THIS CATCHES cost a hundred and forty generations. A Gaussian
     * kernel at a 7 m/s scale returns exp(−1255) for a 250 m/s arrival and
     * exp(−47) for a 50 m/s one: both are zero in float, so the entire first
     * half of the task is invisible to selection. */
    const s250 = M.soft(250, 5), s100 = M.soft(100, 5), s40 = M.soft(40, 5), s5 = M.soft(5, 5);
    ok("soft() is strictly monotone across four decades of error",
        s250 < s100 && s100 < s40 && s40 < s5);
    ok("soft() never underflows to zero", s250 > 1e-4, String(s250));
    near("soft() is 1 at zero error", M.soft(0, 5), 1, 1e-12);
    near("soft() is 0.5 at one scale length", M.soft(5, 5), 0.5, 1e-12);
    ok("a Gaussian would be indistinguishable from zero here (why soft exists)",
        M.gauss(250, 7) < 1e-100 && M.gauss(100, 7) < 1e-40,
        `${M.gauss(250, 7)} / ${M.gauss(100, 7)}`);
}

/* --------------------------------------------------------------- vehicles */
section("vehicle hardware");
{
    const o = {};
    for (const key of ["booster", "ship"]) {
        const ty = V.TYPES[key];
        V.massProps(ty, ty.propMax * 0.2, o);
        ok(key + ": centre of mass is inside the vehicle", o.com > 0 && o.com < ty.length, String(o.com));
        ok(key + ": transverse inertia exceeds axial (it is a long thin tube)", o.Ixx > o.Izz * 5);
        V.massProps(ty, 0, o);
        const dry = o.m;
        V.massProps(ty, ty.propMax, o);
        near(key + ": mass accounting closes", o.m - dry, ty.propMax, 1);
    }
    /* Against the published figures in info.md. */
    V.massProps(V.BOOSTER, 48000, o);
    inRange("booster landing mass matches the 265-320 t band", o.m / 1000, 265, 320);
    inRange("booster pitch inertia matches the ~1e8 estimate", o.Ixx, 0.8e8, 1.6e8);
    V.massProps(V.SHIP, 15000, o);
    inRange("ship mass at flip matches the ~165 t estimate", o.m / 1000, 158, 175);
    inRange("ship pitch inertia matches the ~3.8e7 estimate", o.Ixx, 3.0e7, 5.2e7);

    /* The single most consequential number in the project: neither vehicle may
     * be able to hover on its largest engine group, and both must be able to on
     * their smallest. Break either and the task is a different problem. */
    const T1 = V.RAPTOR.thrust;
    V.massProps(V.BOOSTER, 20000, o);
    const bMinTWR = V.BOOSTER.engineLadder[1] * T1 * V.RAPTOR.minThrottle / (o.m * 9.80665);
    const bMaxTWR = V.BOOSTER.engineLadder[3] * T1 / (o.m * 9.80665);
    inRange("booster can just hold altitude on its smallest group", bMinTWR, 0.7, 1.15);
    ok("booster cannot hover on thirteen engines (the burn is a hoverslam)", bMaxTWR > 8, String(bMaxTWR));
    V.massProps(V.SHIP, 12000, o);
    const sMin = 1 * T1 * V.RAPTOR.minThrottle / (o.m * 9.80665);
    const sMax = 1 * T1 / (o.m * 9.80665);
    ok("ship hovers on one engine somewhere inside its throttle range", sMin < 1 && sMax > 1,
        `${sMin.toFixed(2)}..${sMax.toFixed(2)}`);

    ok("booster carries three grid fins in a T, not four at 90°", V.BOOSTER.fins.length === 3);
    const az = V.BOOSTER.fins.map(f => Math.round(f.az / DEG)).sort((a, b) => a - b);
    ok("...at 90/180/270, leaving the tower-facing side clear",
        az[0] === 90 && az[1] === 180 && az[2] === 270, az.join(","));
    ok("ship carries four flaps and the booster none",
        V.SHIP.flaps.length === 4 && V.BOOSTER.flaps.length === 0);
    ok("the capture box is anisotropic (rails run along the arms)",
        V.TOWER.capture.along > V.TOWER.capture.across * 2);
}

section("actuator constraints");
{
    const act = new V.Actuators(V.BOOSTER);
    act.stageCmd = 2; act.throttleCmd = 0.1;
    for (let t = 0; t < 3; t += 0.005) act.step(0.005, t);
    ok("a throttle below the 40% floor is raised to it, not obeyed",
        act.throttle >= V.RAPTOR.minThrottle - 1e-3, String(act.throttle));

    const a2 = new V.Actuators(V.BOOSTER);
    a2.stageCmd = 3; a2.throttleCmd = 1;
    let lit = -1;
    for (let i = 0; i < 400; i++) {
        const t = i * 0.005;
        a2.step(0.005, t);
        if (lit < 0 && a2.thrust() > 0) lit = t;
    }
    inRange("ignition takes the dwell plus the spool, not zero time", lit, 0.7, 1.1);

    const a3 = new V.Actuators(V.SHIP);
    a3.throttleCmd = 1;
    let credits = a3.ignitions;
    for (let cyc = 0; cyc < 6; cyc++) {
        a3.stageCmd = (cyc % 2) ? 0 : 3;
        for (let i = 0; i < 200; i++) a3.step(0.005, cyc * 1.0 + i * 0.005);
    }
    ok("relighting costs ignition credits and they run out",
        a3.ignitions < credits && a3.ignitions >= 0, `${credits} → ${a3.ignitions}`);
}

/* ------------------------------------------------------------------- aero */
section("aerodynamics");
{
    /* THE physical sentence for this project: a Super Heavy falling tail-first
     * is statically stable, because its engines and its residual methalox are
     * both at the leading end. If this test fails the vehicle tumbles out of
     * every scenario and no amount of evolution helps. */
    const aero = new A.AeroModel(V.BOOSTER);
    const mp = {};
    V.massProps(V.BOOSTER, 40000, mp);
    const act = new V.Actuators(V.BOOSTER);
    const air = ATM.airAt(3000);
    const w = new Float64Array(3);
    // tail-first at 8° of angle of attack: body +Z up, velocity mostly −Z
    const sp = 200, al = 8 * DEG;
    const vB = new Float64Array([sp * Math.sin(al), 0, -sp * Math.cos(al)]);
    /* compute() returns a REUSED object — it must, because it is called a
     * quarter of a million times per episode and may not allocate. Holding two
     * of its results and comparing them therefore compares one value with
     * itself, which is exactly what the first version of this test did: three
     * checks that could never fail and never pass meaningfully. Snapshot. */
    const snap = (o) => ({ fx: o.fx, fy: o.fy, fz: o.fz, mx: o.mx, my: o.my, mz: o.mz });

    const r = snap(aero.compute(vB, w, mp.com, air, act));
    ok("tail-first at +α produces a RESTORING pitch moment (statically stable)",
        r.my < 0, `my=${r.my.toExponential(2)} at α=8°`);
    ok("cross-flow drag opposes the cross-flow", r.fx < 0, `fx=${r.fx.toExponential(2)}`);

    const vB2 = new Float64Array([sp * Math.sin(16 * DEG), 0, -sp * Math.cos(16 * DEG)]);
    const r2 = snap(aero.compute(vB2, w, mp.com, air, act));
    ok("...and the restoring moment grows with angle of attack", r2.my < r.my,
        `${r.my.toExponential(2)} → ${r2.my.toExponential(2)}`);

    /* Pitch damping must exist without anybody writing a damping derivative:
     * it falls out of evaluating each strip in the flow it actually sees. */
    const wSpin = new Float64Array([0, 0.25, 0]);
    const vAxial = new Float64Array([0, 0, -sp]);
    const rNo = snap(aero.compute(vAxial, new Float64Array(3), mp.com, air, act));
    const rSpin = snap(aero.compute(vAxial, wSpin, mp.com, air, act));
    ok("a rotating body sees a damping moment that a still one does not",
        rSpin.my < rNo.my - 1e3, `${rNo.my.toExponential(2)} → ${rSpin.my.toExponential(2)}`);

    /* Grid fins must actually steer. */
    act.fin[1] = 20 * DEG;
    const rFin = snap(aero.compute(vAxial, new Float64Array(3), mp.com, air, act));
    ok("deflecting the 180° grid fin produces a pitch moment",
        Math.abs(rFin.my - rNo.my) > 1e5, `Δmy=${(rFin.my - rNo.my).toExponential(2)}`);
    act.fin[1] = 0;

    /* The Ship's whole flank in cross-flow. Validation checkpoint 4 from the
     * specification: 70-90 m/s belly-down near sea level. */
    const sc = SC.makeScenario(4, 777);
    sc.wind = new ATM.WindField(() => 0.5, 0);
    sc.p0[2] = 5000; sc.v0[0] = 0; sc.v0[1] = 0; sc.v0[2] = -60;
    sc.tMax = 180;
    const world = new WM.World(sc);
    let vTerm = 0;
    for (let i = 0; i < 30000 && world.outcome === WM.OUTCOME.FLYING; i++) {
        if (i % WM.CTRL_EVERY === 0) world.applyControl(new Float64Array([-1, -1, 0, 0, 0, 0, 0, 0, -1, -1]));
        world.step(WM.DT_PHYS);
        if (world.p[2] < 1200) { vTerm = -world.v[2]; break; }
    }
    inRange("ship belly-flop terminal velocity (spec: 70-90 m/s)", vTerm, 66, 94);
}

/* ---------------------------------------------------------------- sensors */
section("sensors");
{
    const sc = SC.makeScenario(2, 4242);
    const world = new WM.World(sc);
    const sens = new SENS.Sensors();
    const x = sens.observe(world);
    ok("observation length matches the declared input count", x.length === SENS.N_INPUT);
    let bad = 0, big = 0;
    for (let step = 0; step < 400; step++) {
        const o = sens.observe(world);
        for (let i = 0; i < o.length; i++) {
            if (!Number.isFinite(o[i])) bad++;
            if (Math.abs(o[i]) > 4.001) big++;
        }
        sens.recordAction(new Float64Array(10));
        for (let k = 0; k < WM.CTRL_EVERY; k++) world.step(WM.DT_PHYS);
        if (world.outcome !== WM.OUTCOME.FLYING) break;
    }
    ok("no NaN or Infinity anywhere in the observation", bad === 0, String(bad));
    ok("every input is bounded (nothing escapes the clamps)", big === 0, String(big));

    /* The temporal block is DIFFERENCES. On the very first tick every lag must
     * read exactly zero — if the ring is zero-filled instead of primed, the
     * first observation contains a step the size of the whole state. */
    const s2 = new SENS.Sensors();
    const w2 = new WM.World(SC.makeScenario(0, 5));
    const first = s2.observe(w2);
    // The ring is Float32 and the live channels are Float64, so "zero" here is
    // a float32 rounding residue, not an exact zero. What matters is that there
    // is no STEP: a zero-filled ring would put the whole state in every lag.
    let biggest = 0;
    for (let i = SENS.N_INSTANT; i < SENS.N_INSTANT + SENS.N_TEMPORAL; i++) {
        biggest = Math.max(biggest, Math.abs(first[i]));
    }
    ok("the temporal window is primed, so tick 1 shows no step", biggest < 1e-4, String(biggest));
}

/* --------------------------------------------------------------- networks */
section("networks");
{
    const spec = NN.netSpec(SENS.N_INPUT, "std");
    const b = new NN.Brain(spec, NN.mulberry32(7));
    const x = new Float32Array(SENS.N_INPUT);
    for (let i = 0; i < x.length; i++) x[i] = Math.sin(i);
    const y1 = Array.from(b.forward(x));
    const y2 = Array.from(b.forward(x));
    ok("forward pass is deterministic", y1.every((v, i) => v === y2[i]));
    ok("outputs are bounded by the activation", y1.every(v => v >= -1 && v <= 1));

    const j = JSON.parse(JSON.stringify(b.toJSON()));
    const b2 = NN.Brain.fromJSON(j);
    const y3 = Array.from(b2.forward(x));
    ok("serialise/deserialise round-trips exactly", y1.every((v, i) => v === y3[i]));

    const c = b.clone();
    ok("a clone is bit-identical", c.hash() === b.hash());
    c.mutate(0.2, 0.3, NN.mulberry32(11));
    ok("mutation actually changes the genome", c.hash() !== b.hash());
    ok("a mutated clone does not alias its parent's memory", b.clone().hash() === b.hash());

    /* Fresh brains must DIFFER in the discrete decisions. A threshold applied to
     * a distribution centred on zero gives every member of the fleet the same
     * answer, and generation 1 then contains no information about engine count
     * or whether to go for the tower. */
    const stages = new Set(), commits = new Set();
    for (let k = 0; k < 40; k++) {
        const bb = new NN.Brain(spec, NN.mulberry32(1000 + k * 7919));
        const yy = bb.forward(x);
        stages.add(Math.floor((M.clamp(yy[1], -1, 1) + 1) * 0.5 * 4));
        commits.add(yy[9] > 0);
    }
    ok("a fresh population picks more than one engine count", stages.size >= 2, [...stages].join(","));
    ok("a fresh population disagrees about committing to the tower", commits.size === 2);
}

/* ------------------------------------------------------------------ world */
section("world, termination and determinism");
{
    /* Determinism is the foundation of every fairness claim in the trainer. */
    const run = () => {
        const sc = SC.makeScenario(2, 31337);
        const w = new WM.World(sc);
        const pol = new NN.BrainPolicy(new NN.Brain(NN.netSpec(SENS.N_INPUT, "std"), NN.mulberry32(3)));
        pol.reset();
        return w.runEpisode((wo, o) => pol.act(wo, o));
    };
    const r1 = run(), r2 = run();
    ok("the same scenario and brain give a bit-identical score",
        r1.total === r2.total && r1.outcome === r2.outcome, `${r1.total} vs ${r2.total}`);

    /* Every episode must END. A silent infinite loop here would show up in the
     * trainer only as "generations got slow". */
    let allTerminated = true;
    for (let st = 0; st < SC.N_STAGES; st++) {
        for (let i = 0; i < 3; i++) {
            const w = new WM.World(SC.makeScenario(st, 90000 + i));
            const r = w.runEpisode((wo, o) => { o.fill(0); });
            if (r.outcome === WM.OUTCOME.FLYING) allTerminated = false;
        }
    }
    ok("every episode terminates", allTerminated);

    /* A booster dropped over the tower must hit it; one dropped in a field must
     * not. Collision geometry that never triggers is worse than none. */
    const scT = SC.makeScenario(0, 11);
    scT.wind = new ATM.WindField(() => 0.5, 0);
    scT.p0[0] = 0; scT.p0[1] = 0; scT.p0[2] = 400;
    scT.v0[0] = 0; scT.v0[1] = 0; scT.v0[2] = -40;
    M.qFromAxisAngle(scT.q0, 1, 0, 0, 0); M.vset(scT.w0, 0, 0, 0);
    const wT = new WM.World(scT);
    const rT = wT.runEpisode((wo, o) => { o.fill(0); o[0] = -1; o[1] = -1; });
    ok("a booster dropped onto the tower registers a tower strike",
        rT.outcome === WM.OUTCOME.TOWER_STRIKE, WM.OUTCOME_NAME[rT.outcome]);

    const scF = SC.makeScenario(0, 11);
    scF.wind = new ATM.WindField(() => 0.5, 0);
    scF.p0[0] = 900; scF.p0[1] = -900; scF.p0[2] = 400;
    scF.v0[0] = 0; scF.v0[1] = 0; scF.v0[2] = -40;
    M.qFromAxisAngle(scF.q0, 1, 0, 0, 0); M.vset(scF.w0, 0, 0, 0);
    const wF = new WM.World(scF);
    const rF = wF.runEpisode((wo, o) => { o.fill(0); o[0] = -1; o[1] = -1; });
    ok("...and one dropped a kilometre away does not",
        rF.outcome !== WM.OUTCOME.TOWER_STRIKE, WM.OUTCOME_NAME[rF.outcome]);
}

section("the capture box is reachable");
{
    /* If this fails, the top of the reward surface does not exist and no amount
     * of evolution can ever reach it. A vertical descent onto the gate, flown
     * by the crudest possible altitude-hold, must be catchable. */
    const sc = SC.makeScenario(0, 4711);
    sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
    sc.wind = new ATM.WindField(() => 0.5, 0);
    sc.p0[0] = V.TOWER.gateX; sc.p0[1] = V.TOWER.gateY;
    sc.p0[2] = (V.TOWER.armZ - V.BOOSTER.catchPinZ) + 25;
    sc.v0[0] = 0; sc.v0[1] = 0; sc.v0[2] = -2;
    M.qFromAxisAngle(sc.q0, 1, 0, 0, 0); M.vset(sc.w0, 0, 0, 0);
    sc.prop = 30000; sc.tMax = 40;
    const w = new WM.World(sc);
    const aim = V.TOWER.armZ - V.BOOSTER.catchPinZ;
    const r = w.runEpisode((wo, o) => {
        o.fill(0);
        const dz = wo.p[2] - aim;
        const vWant = -Math.max(0.6, Math.min(2.5, 0.3 * dz));
        const need = (9.81 + 1.2 * (vWant - wo.v[2])) * wo.mp.m;
        o[1] = (1 + 0.5) / V.BOOSTER.engineLadder.length * 2 - 1;
        o[0] = M.clamp(need / (V.BOOSTER.engineLadder[1] * V.RAPTOR.thrust), 0.4, 1) * 2 - 1;
        o[9] = 1;
    });
    ok("a clean vertical approach onto the gate is CAUGHT",
        r.outcome === WM.OUTCOME.CAUGHT,
        `${WM.OUTCOME_NAME[r.outcome]}, miss ${r.terminal.gateDist.toFixed(2)} m, ` +
        `${r.terminal.vzPin.toFixed(2)} m/s, ${(r.terminal.tilt / DEG).toFixed(2)}°`);
    ok("...and a catch is the highest-scoring outcome there is", r.total > 3.0, r.total.toFixed(2));
}

section("giving up must not pay");
{
    /* The population found this one on its own: if losing control ENDS the
     * episode, the vehicle is scored where it stopped, and stopping at altitude
     * beats arriving at 250 m/s. Tumbles went 17% -> 76% in twenty-five
     * generations. A tumbling booster must keep falling. */
    const sc = SC.makeScenario(1, 606);
    sc.wind = new ATM.WindField(() => 0.5, 0);
    const w = new WM.World(sc);
    // spin it up hard and then do nothing at all
    const r = w.runEpisode((wo, o) => {
        o.fill(0);
        o[0] = 1; o[1] = 1;
        o[2] = 1; o[3] = 1;            // gimbal hard over: guarantees a tumble
        o[9] = -1;
    });
    ok("a vehicle that tumbles is still reported as having tumbled",
        r.outcome === WM.OUTCOME.TUMBLE || r.outcome === WM.OUTCOME.BREAKUP
        || r.outcome === WM.OUTCOME.TOWER_STRIKE || r.outcome === WM.OUTCOME.CRASH,
        WM.OUTCOME_NAME[r.outcome]);
    if (r.outcome === WM.OUTCOME.TUMBLE || r.outcome === WM.OUTCOME.BREAKUP) {
        ok("...and it flew all the way to the ground rather than vanishing",
            r.terminal.alt < 3, `ended at ${r.terminal.alt.toFixed(1)} m`);
        ok("...arriving at the speed a dead vehicle arrives at",
            r.terminal.vzBase > 30, `${r.terminal.vzBase.toFixed(1)} m/s`);
    }

    /* And the score for doing that must be worse than flying badly but alive. */
    const bank = [];
    for (let i = 0; i < 8; i++) bank.push(SC.makeScenario(1, 610000 + i * 97));
    const avg = (pol) => {
        let s2 = 0;
        for (const b2 of bank) s2 += new WM.World(b2).runEpisode(pol).total;
        return s2 / bank.length;
    };
    const spin = avg((wo, o) => { o.fill(0); o[0] = 1; o[1] = 1; o[2] = 1; o[3] = 1; o[9] = -1; });
    const fall = avg(AP.inertPolicy);
    console.log(`   deliberate tumble ${spin.toFixed(3)} vs falling under control ${fall.toFixed(3)}`);
    ok("deliberately losing control scores worse than doing nothing",
        spin < fall, `${spin.toFixed(3)} vs ${fall.toFixed(3)}`);

    /* ...AND A LOST VEHICLE MUST STILL ARRIVE AS A NUMBER.
     *
     * Continuing to fly a disabled vehicle is the whole point of the rule
     * above, but `if (!this.disabled)` also retires the structural limits, so
     * nothing bounded the state afterwards. A booster already past its rate
     * limit went on being integrated at 5 ms through Mach 3 with a quasi-steady
     * strip model, and ran away: terminal speeds of 1e10, 1e19 and 2e21 m/s,
     * reached in a single step. The braking rung reads terminal speed, so those
     * episodes silently reported an arrival no policy could be responsible for.
     *
     * THESE ARE THE CASES THAT ACTUALLY REPRODUCED IT. The first version of
     * this check flew a hard-over gimbal on a spread of seeds, passed, and
     * passed just as happily with the guard deleted — a test that asserts
     * nothing. Divergence needs a specific thing: a vehicle that loses control
     * while still fast and high, so that it goes on accelerating under aero
     * after the controls are cut. The reference pilot at a badly-transferred
     * `slope` does exactly that, and these nine (stage, seed, gain) triples
     * were found by sweeping it. Without the guard they return 6.9e6 to 2.1e20
     * m/s; with it, none exceeds the bound. */
    const RUNAWAY = [
        [0, 5523645, 0.25, 0.9], [0, 5523645, 0.35, 0.9],
        [2, 5733103, 0.25, 0.55], [2, 5209458, 0.25, 0.9],
        [2, 5628374, 0.25, 0.9], [2, 5209458, 0.35, 0.9],
        [2, 5523645, 0.35, 0.9], [2, 5733103, 0.35, 0.9]
    ];
    let worst = 0;
    for (const [st, seed, slope, kvz] of RUNAWAY) {
        const r3 = new WM.World(SC.makeScenario(st, seed))
            .runEpisode(GOLD.makePilot({ slope, kvz }));
        const sp = Math.hypot(r3.terminal.vzBase, r3.terminal.vhBase);
        if (!isFinite(sp)) worst = Infinity; else if (sp > worst) worst = sp;
    }
    console.log(`   worst terminal speed over ${RUNAWAY.length} known-divergent flights: ` +
        `${isFinite(worst) ? worst.toFixed(1) : "Inf"} m/s`);
    ok("a destroyed vehicle still arrives at a physical speed, not a runaway",
        isFinite(worst) && worst < 2500, `${worst.toExponential(3)} m/s`);
}

section("the reward surface is climbable");
{
    /* THE test that would have saved the most time. Doing nothing must score
     * clearly worse than flying, and the score must improve monotonically as
     * the arrival gets softer — including in the part of the range occupied by
     * craters, because that is where the whole population starts. */
    const bank = [];
    for (let i = 0; i < 10; i++) bank.push(SC.makeScenario(0, 660000 + i * 313));

    const flyAt = (aFrac) => {
        let sum = 0;
        for (const sc of bank) {
            const w = new WM.World(sc);
            const r = w.runEpisode((wo, o) => {
                o.fill(0);
                const dz = Math.max(1, wo.p[2]);
                const sink = Math.max(0, -wo.v[2]);
                const n = V.BOOSTER.engineLadder[2];
                /* AT THE THROTTLE IT ACTUALLY COMMANDS. This computed the
                 * braking distance from FULL ladder thrust and then commanded
                 * half of it, so it lit at half the height it needed and had
                 * already lost the flight by the time the engines came up. On a
                 * 400 m drop the error was affordable; on the 3-4 km run-in
                 * stage 0 is now it cost most of the score — the sweep read
                 * 0.008/0.145/0.043/-0.001 with the bug and 0.238/0.285/0.176/
                 * 0.120 without it, which is the difference between "the reward
                 * surface is flat" and "the reference could not fly". */
                const THR = 0.5;
                const aMax = Math.max(1, n * V.RAPTOR.thrust * THR / wo.mp.m - 9.81);
                const lit = wo.act.stage > 0 || dz < aFrac * (sink * sink) / (2 * aMax) + sink + 25;
                o[1] = lit ? ((2 + 0.5) / 4 * 2 - 1) : -1;
                o[0] = THR * 2 - 1;
                const ax = M.v3(); wo.axis(ax);
                const e = M.v3(); M.vcross(e, ax, UP);
                const eb = M.v3(); M.qrotInv(eb, wo.q, e);
                const T = Math.max(1e3, wo.act.thrust());
                const rz = Math.abs(V.BOOSTER.engines[0].z - wo.mp.com);
                const gm = V.BOOSTER.engines[0].gimbal;
                const mx = wo.mp.Ixx * 1.5 * (M.clamp(1.4 * eb[0], -0.07, 0.07) - wo.w[0]);
                const my = wo.mp.Iyy * 1.5 * (M.clamp(1.4 * eb[1], -0.07, 0.07) - wo.w[1]);
                o[2] = M.clamp(Math.asin(M.clamp(-mx / (rz * T), -1, 1)) / gm, -1, 1);
                o[3] = M.clamp(Math.asin(M.clamp(-my / (rz * T), -1, 1)) / gm, -1, 1);
                o[9] = -1;
            });
            sum += r.total;
        }
        return sum / bank.length;
    };
    const UP = new Float64Array([0, 0, 1]);

    let inert = 0;
    for (const sc of bank) inert += new WM.World(sc).runEpisode(AP.inertPolicy).total;
    inert /= bank.length;

    const flown = [0.6, 1.0, 1.6, 2.4].map(flyAt);
    const best = Math.max(...flown);
    console.log(`   inert ${inert.toFixed(3)} · braking sweep ${flown.map(v => v.toFixed(3)).join(" ")}`);
    /* THE BAR MOVED BECAUSE THE TASK DID, NOT BECAUSE THE TEST WAS INCONVENIENT.
     * 0.35 was calibrated when stage 0 was a drop from 400 m directly over the
     * rails, where a policy that only brakes can very nearly finish the job.
     * Stage 0 is now a run-in from 1-2 km offshore, and a reference with no
     * lateral channel cannot reach the tower however well it brakes — measured,
     * adding one makes it WORSE, because tilting a fixed-throttle policy steals
     * the vertical authority it is living on. What the test exists to catch is a
     * reward surface where flying and not flying score the same, and 0.285
     * against 0.000 is not that. The interior-optimum check below is added so
     * the assertion still has teeth at the new level. */
    ok("flying properly beats doing nothing by a wide margin", best > inert + 0.20,
        `best ${best.toFixed(3)} vs inert ${inert.toFixed(3)}`);
    ok("the braking sweep has an interior optimum (a hill, not a ramp)",
        flown.indexOf(best) > 0 && flown.indexOf(best) < flown.length - 1,
        `peak at index ${flown.indexOf(best)} of ${flown.map(v => v.toFixed(3)).join(" ")}`);
    ok("the braking sweep is not flat (there is a gradient to climb)",
        Math.max(...flown) - Math.min(...flown) > 0.15,
        flown.map(v => v.toFixed(3)).join(" "));

    /* Arrival speed must be priced continuously, all the way down. */
    const scoreAtSpeed = (v) => {
        const sc = SC.makeScenario(0, 202);
        sc.wind = new ATM.WindField(() => 0.5, 0);
        sc.catchAllowed = 0; sc.revokeAt = null; sc.grantAt = null;
        sc.groundTarget = { kind: "safe", x: 0, y: -260, radius: 200 };
        sc.p0[0] = 0; sc.p0[1] = -260; sc.p0[2] = 300;
        sc.v0[0] = 0; sc.v0[1] = 0; sc.v0[2] = -v;
        M.qFromAxisAngle(sc.q0, 1, 0, 0, 0); M.vset(sc.w0, 0, 0, 0);
        sc.prop = 1; sc.tMax = 40;
        const w = new WM.World(sc);
        // freefall from 300 m: whatever it started with, it only gets faster
        return w.runEpisode((wo, o) => { o.fill(0); o[0] = -1; o[1] = -1; o[9] = -1; }).total;
    };
    const a250 = scoreAtSpeed(250), a120 = scoreAtSpeed(120), a40 = scoreAtSpeed(40), a5 = scoreAtSpeed(5);
    console.log(`   arrival scores at 250/120/40/5 m/s: ${a250.toFixed(3)} ${a120.toFixed(3)} ${a40.toFixed(3)} ${a5.toFixed(3)}`);
    ok("score is strictly monotone in arrival speed, even among crashes",
        a250 < a120 && a120 < a40 && a40 < a5,
        `${a250.toFixed(3)} ${a120.toFixed(3)} ${a40.toFixed(3)} ${a5.toFixed(3)}`);
}

/* -------------------------------------------------------------- scenarios */
section("scenario bank");
{
    const seen = new Set();
    for (let st = 0; st < SC.N_STAGES; st++) {
        for (let i = 0; i < 40; i++) {
            const sc = SC.makeScenario(st, 500 + i);
            ok_once(seen, "scenario " + st + " is finite",
                Number.isFinite(sc.p0[2]) && Number.isFinite(sc.v0[2]) && sc.prop > 0);
            ok_once(seen, "scenario " + st + " starts above ground", sc.p0[2] > 100);
            ok_once(seen, "scenario " + st + " starts descending", sc.v0[2] < 0);
            ok_once(seen, "scenario " + st + " has a reachable ground target",
                Math.hypot(sc.groundTarget.x, sc.groundTarget.y) < 4000);
        }
    }
    function ok_once(set, name, cond) { if (!set.has(name)) { set.add(name); ok(name, cond); } }

    /* Training must never be able to draw an exam scenario. */
    const exam = new Set(SC.examBank(6).map(s => s.stage + ":" + s.seed));
    const mix = new Array(SC.N_STAGES).fill(1);
    let collision = 0;
    for (let g = 0; g < 60; g++) {
        for (const s of SC.trainingBank(mix, 24, g)) {
            if (exam.has(s.stage + ":" + s.seed)) collision++;
        }
    }
    ok("training and exam seed spaces are disjoint", collision === 0, String(collision));

    /* Reproducibility: the same seed must rebuild the same weather. */
    const A1 = SC.makeScenario(3, 8080), A2 = SC.makeScenario(3, 8080);
    const w1 = A1.wind.at(2500, 12), w2 = A2.wind.at(2500, 12);
    ok("a seed rebuilds an identical wind field",
        w1[0] === w2[0] && w1[1] === w2[1] && w1[2] === w2[2]);
    ok("...and identical initial conditions",
        A1.p0[2] === A2.p0[2] && A1.v0[0] === A2.v0[0] && A1.prop === A2.prop);

    /* A meaningful share of episodes must actually take the tower away. */
    let divert = 0, total = 0;
    for (let st = 0; st < SC.N_STAGES; st++) for (let i = 0; i < 60; i++) {
        const sc = SC.makeScenario(st, 70000 + i);
        total++;
        if (!sc.catchAllowed || sc.revokeAt != null) divert++;
    }
    inRange("a real fraction of scenarios deny or revoke the catch", divert / total, 0.12, 0.5);
}

/* ------------------------------------------------------------- evaluation */
section("evolution plumbing");
{
    const evo = new EV.Evolution({ pop: 12, episodes: 3, seed: 5 });
    const specs = evo.bank().map(s => ({ stage: s.stage, seed: s.seed }));
    ok("the bank is the requested size", specs.length === 3);
    const base = EV.Evolution.baseline(specs);
    ok("baseline returns one number per scenario", base.length === specs.length);

    const r = EV.Evolution.evaluate(evo.pop[0], specs);
    ok("evaluate returns a score per scenario", r.scores.length === specs.length);
    const r2 = EV.Evolution.evaluate(evo.pop[0], specs);
    ok("evaluation is repeatable (no state leaks between episodes)",
        r.scores.every((v, i) => v === r2.scores[i]));

    const agg = evo.aggregate([1, 1, 1], [0, 0, 0]);
    near("aggregate of a flat advantage is that advantage", agg.fit, 1, 1e-9);
    const agg2 = evo.aggregate([2, 2, -1], [0, 0, 0]);
    ok("the worst episode is weighted, so one disaster costs", agg2.fit < 1.0, String(agg2.fit));

    /* Elitism: the best individual must survive into the next generation
     * unchanged. Losing the champion to mutation is a silent, expensive bug. */
    const fits = evo.pop.map((_, i) => ({ fit: i === 7 ? 99 : i * 0.01, raw: 0 }));
    const before = evo.pop[7].hash();
    evo.breed(fits);
    ok("the elite survives breeding bit-for-bit", evo.pop[0].hash() === before);
    ok("the generation counter advances", evo.gen === 1);

    /* Both vehicles must be in the diet from the very first generation. */
    const mix0 = EV.stageMix(0, 0);
    ok("generation 1 already flies both vehicles", mix0[0] > 0 && mix0[4] > 0, mix0.join(","));
}

/* ------------------------------------------------- the acceptance suite ---
 * A published reconstruction of the vehicle gives a dozen numbers a landing
 * simulation should reproduce. They split into two kinds and the split is the
 * whole point of this section.
 *
 * PROPERTIES OF THE ENVIRONMENT — terminal velocities, thrust-to-weight,
 * mass flow, geometry — are asserted. If any of them moves, something is
 * broken.
 *
 * PROPERTIES OF A FLIGHT — burn duration, flip duration, monotone descent,
 * arrival speed — are NOT asserted against the evolved policy, because there
 * is no hand-written guidance anywhere in the training loop and there is not
 * going to be. What is asserted instead is that the environment ADMITS a
 * flight with those properties: fly a scripted probe, and check the vehicle
 * can do it. A trajectory band that no possible controller could hit is a
 * broken simulation; a trajectory band that a controller could hit and this
 * particular network does not is just an untrained network.
 */
section("acceptance suite · environment");
{
    /* Equilibrium fall speed straight out of the strip model: bisect on
     * |aero force along the vertical| = mg, engines cold, attitude held. */
    function termSpeed(ty, mass, h, alphaDeg, flapDeg) {
        const aero = new A.AeroModel(ty), air = ATM.airAt(h), act = new V.Actuators(ty);
        for (let i = 0; i < act.nFlap; i++) act.flap[i] = flapDeg * DEG;
        const mp = V.massProps(ty, Math.max(0, mass - ty.dryMass), {});
        const a = alphaDeg * DEG;
        const lift = (v) => {
            const o = aero.compute([Math.sin(a) * v, 0, -Math.cos(a) * v], [0, 0, 0], mp.com, air, act);
            return o.fz * Math.cos(a) - o.fx * Math.sin(a);
        };
        let lo = 1, hi = 2000;
        for (let i = 0; i < 60; i++) {
            const mid = 0.5 * (lo + hi);
            if (lift(mid) < mass * V.G0) lo = mid; else hi = mid;
        }
        return 0.5 * (lo + hi);
    }

    const vShip = termSpeed(V.SHIP, 165000, 1500, 90, 55);
    inRange("[1] ship belly-flop terminal velocity at 1.5 km", +vShip.toFixed(1), 70, 90);
    ok("...and tucking the flaps makes it fall faster",
        termSpeed(V.SHIP, 165000, 1500, 90, 5) > termSpeed(V.SHIP, 165000, 1500, 90, 80));

    /* The booster's tail-first equilibrium comes out ~15% BELOW the Cd = 1.0,
     * A = 63.6 m² rule of thumb, and the difference is not an error — it is
     * the two things the rule of thumb leaves out. Assert the decomposition
     * rather than the headline number, because that is the part that can
     * actually be wrong. */
    function axialCd(v, h) {
        const aero = new A.AeroModel(V.BOOSTER), air = ATM.airAt(h);
        const mp = V.massProps(V.BOOSTER, 90000, {});
        const o = aero.compute([0, 0, -v], [0, 0, 0], mp.com, air, new V.Actuators(V.BOOSTER));
        return o.fz / (0.5 * air.rho * v * v * Math.PI * V.BOOSTER.radius * V.BOOSTER.radius);
    }
    const cdWith = axialCd(340, 3500);
    const finsWere = V.BOOSTER.fins.splice(0, V.BOOSTER.fins.length);
    const cdBare = axialCd(340, 3500);
    V.BOOSTER.fins.push(...finsWere);
    inRange("[8] bare booster axial Cd, base-first, transonic", +cdBare.toFixed(2), 1.05, 1.35);
    inRange("[8] ...and three grid fins add this fraction of it",
        +((cdWith / cdBare) - 1).toFixed(3), 0.10, 0.30);
    const vB = termSpeed(V.BOOSTER, 320000, 3500, 0, 0);
    console.log(`   booster equilibrium at 3.5 km, 320 t: ${vB.toFixed(0)} m/s ` +
        `(Mach ${(vB / ATM.airAt(3500).a).toFixed(2)}); the Cd=1.0 finless rule of thumb says 347`);
    inRange("[8] booster equilibrium is within 20% of the rule of thumb", +(vB / 347).toFixed(3), 0.80, 1.20);

    /* Units. The classic failure is tf or kN where N was meant, which is wrong
     * by three to six orders of magnitude and looks like a guidance problem. */
    near("[11] one Raptor at 100% adds this many newtons", V.RAPTOR.thrust, 2.75e6, 1);
    const mdot = V.RAPTOR.thrust / (V.RAPTOR.isp * V.G0);
    inRange("[11] ...at this mass flow, kg/s", +mdot.toFixed(0), 650, 850);

    /* Thrust to weight. The single number that defines the problem is that a
     * Super Heavy CANNOT HOVER on its smallest full landing group. */
    const tw = (n, th, m) => (n * V.RAPTOR.thrust * th) / (m * V.G0);
    inRange("[9] booster T/W, 3 engines at the 40% floor, 270 t", +tw(3, .4, 270e3).toFixed(3), 1.15, 1.35);
    inRange("[9] ...so its net vertical acceleration is upward, m/s²",
        +(3 * V.RAPTOR.thrust * .4 / 270e3 - V.G0).toFixed(2), 2.0, 3.0);
    ok("[9] booster T/W at 13 engines full is enormous", tw(13, 1, 270e3) > 10, tw(13, 1, 270e3).toFixed(1));
    ok("[9] ship CAN hover on one engine — it is the only vehicle here that can",
        tw(1, .4, 165e3) < 1 && tw(1, 1, 165e3) > 1,
        `${(165e3 * V.G0 / V.RAPTOR.thrust * 100).toFixed(0)}% throttle`);
    ok("[9] ...but two at the floor already push it upward hard", tw(2, .4, 165e3) > 1.3);

    /* The floor is hardware, not advice. A simulation that allows 0-100%
     * continuous thrust lets the vehicle fake a hover the real one cannot do,
     * and every trajectory downstream of that is the wrong shape. */
    {
        const act = new V.Actuators(V.BOOSTER);
        act.stageCmd = 3; act.throttleCmd = 0.05;
        for (let i = 0; i < 600; i++) act.step(0.005, i * 0.005);
        ok("[3] commanding 5% throttle realises the 40% floor",
            Math.abs(act.throttle - 0.40) < 0.01, act.throttle.toFixed(3));
        const flow = act.massFlow();
        inRange("[4] thirteen engines at the floor burn this many t/s",
            +(flow / 1000).toFixed(2), 3.5, 4.5);
        act.throttleCmd = 1;
        for (let i = 0; i < 400; i++) act.step(0.005, 3 + i * 0.005);
        inRange("[4] ...and at full throttle, t/s", +(act.massFlow() / 1000).toFixed(1), 8, 12);
    }

    /* Mass really is consumed. If it is not, T/W climbs too slowly and every
     * ignition-timing solution in the search is solving the wrong problem. */
    {
        const w = new WM.World(SC.makeScenario(2, 31337));
        const m0 = w.mp.m;
        let burned = 0;
        w.runEpisode((wo, o) => { o.fill(0); o[0] = 1; o[1] = 1; o[9] = -1; });
        burned = (m0 - w.mp.m) / 1000;
        ok("[4] mass decreases while the engines burn", w.mp.m < m0, `${burned.toFixed(1)} t`);
        ok("[12] ...and never below the dry mass", w.mp.m >= V.BOOSTER.dryMass - 1);
    }

    /* [12] Phase masses. */
    {
        let blo = Infinity, bhi = -Infinity, slo = Infinity, shi = -Infinity;
        for (let i = 0; i < 60; i++) {
            for (const st of [0, 1, 2, 3]) {
                const m = V.BOOSTER.dryMass + SC.makeScenario(st, 8000 + i * 13).prop;
                blo = Math.min(blo, m); bhi = Math.max(bhi, m);
            }
            for (const st of [4, 5, 6]) {
                const m = V.SHIP.dryMass + SC.makeScenario(st, 8000 + i * 13).prop;
                slo = Math.min(slo, m); shi = Math.max(shi, m);
            }
        }
        inRange("[12] booster mass across the bank, t (low)", +(blo / 1e3).toFixed(0), 255, 285);
        inRange("[12] booster mass across the bank, t (high)", +(bhi / 1e3).toFixed(0), 300, 325);
        inRange("[12] ship mass across the bank, t", +(slo / 1e3).toFixed(0), 158, 172);
        inRange("[12] ...at the top of the bank, t", +(shi / 1e3).toFixed(0), 168, 182);
    }
}

section("acceptance suite · control-surface authority");
{
    /* The flaps are in the ACTION VECTOR (outputs 4–7), rate-limited by the
     * actuator model — architecture A in the reconstruction's terms. These
     * checks pin the property that makes that meaningful: each surface makes
     * its own force at its own lever arm, so flap state produces TORQUE, it
     * scales with dynamic pressure, and it dies as the vehicle slows. A
     * whole-body drag table cannot pass any of these. */
    const aero = new A.AeroModel(V.SHIP), air = ATM.airAt(1500);
    const mp = V.massProps(V.SHIP, 15000, {});
    const mk = (fl, fr, al, ar) => {
        const act = new V.Actuators(V.SHIP);
        act.flap[0] = fl * DEG; act.flap[1] = fr * DEG;
        act.flap[2] = al * DEG; act.flap[3] = ar * DEG;
        return act;
    };
    const my = (v, act) => aero.compute([v, 0, 0], [0, 0, 0], mp.com, air, act).my;

    /* Tucking the aft pair is the real vehicle's flip-entry trick. */
    const dMy = my(79, mk(45, 45, 5, 5)) - my(79, mk(45, 45, 45, 45));
    inRange("aft flaps mid→tucked at terminal: pitch authority, °/s²",
        +Math.abs(dMy / mp.Iyy / DEG).toFixed(2), 2, 10);

    const d2 = my(158, mk(45, 45, 5, 5)) - my(158, mk(45, 45, 45, 45));
    near("...and doubling airspeed quadruples it (q-scaling)", d2 / dMy, 4.0, 0.05);

    const dSlow = my(20, mk(45, 45, 5, 5)) - my(20, mk(45, 45, 45, 45));
    ok("...and at 20 m/s the same command has gone limp (<10% authority)",
        Math.abs(dSlow / dMy) < 0.10, (Math.abs(dSlow / dMy) * 100).toFixed(1) + "%");

    /* Left-right differential is roll. The torque must appear about the roll
     * axis, not just anywhere. */
    const r = aero.compute([79, 0, 0], [0, 0, 0], mp.com, air, mk(80, 5, 80, 5));
    ok("left/right flap differential produces roll torque",
        Math.abs(r.mz) > 0.5e6, (r.mz / 1e6).toFixed(2) + " MN·m");

    /* Rotational damping is emergent from the strip/paddle model — no damping
     * derivative is coded anywhere — and must land near the 2–5 s the
     * reconstruction quotes. Without it a GA learns bang-bang nonsense. */
    const base = my(79, mk(45, 45, 45, 45));
    const spun = aero.compute([79, 0, 0], [0, 10 * DEG, 0], mp.com, air, mk(45, 45, 45, 45)).my;
    const tau = mp.Iyy * (10 * DEG) / Math.abs(spun - base);
    inRange("pitch-rate damping time constant at terminal velocity, s", +tau.toFixed(1), 2, 6);

    /* Wind pushes through the same vRel pathway as everything else. The
     * magnitude check: 10 m/s of broadside air on a hovering ship is a couple
     * of dozen kilonewtons, not a leaf-blower and not nothing. */
    const wForce = -aero.compute([10, 0, 0], [0, 0, 0], mp.com, ATM.airAt(100), mk(5, 5, 5, 5)).fx;
    inRange("steady 10 m/s broadside on a hovering ship, m/s²",
        +(wForce / mp.m).toFixed(3), 0.08, 0.25);

    /* CdA(θ) must rise monotonically from axial to broadside — the property
     * the whole belly-flop rests on. ~9× axial-to-broadside for this hull. */
    const cdA = (al) => {
        const a = al * DEG;
        const o = aero.compute([Math.sin(a) * 80, 0, -Math.cos(a) * 80], [0, 0, 0], mp.com, air, mk(55, 55, 55, 55));
        return (o.fz * Math.cos(a) - o.fx * Math.sin(a)) / (0.5 * air.rho * 80 * 80);
    };
    const sweep = [0, 15, 30, 45, 60, 75, 90].map(cdA);
    ok("CdA rises monotonically from axial to broadside",
        sweep.every((v, i) => i === 0 || v > sweep[i - 1]), sweep.map(v => v.toFixed(0)).join(" "));
    inRange("...and broadside/axial ratio", +(sweep[6] / sweep[0]).toFixed(1), 6, 12);

    /* The grid-fin mixer of the T layout: the 90/270 pair deflected the SAME
     * way rolls the booster; the 180 fin alone pitches it. Both must exist and
     * both must scale with q. */
    const bAero = new A.AeroModel(V.BOOSTER), bAir = ATM.airAt(3500);
    const bmp = V.massProps(V.BOOSTER, 50000, {});
    const bAct = (f0, f1, f2) => {
        const act = new V.Actuators(V.BOOSTER);
        act.fin[0] = f0 * DEG; act.fin[1] = f1 * DEG; act.fin[2] = f2 * DEG;
        return act;
    };
    const vB = [12, 0, -290];
    const n0 = bAero.compute(vB, [0, 0, 0], bmp.com, bAir, bAct(0, 0, 0));
    const nm = [n0.mx, n0.my, n0.mz];
    const rollPair = bAero.compute(vB, [0, 0, 0], bmp.com, bAir, bAct(30, 0, 30));
    ok("booster 90/270 fins same-sign → roll", Math.abs(rollPair.mz - nm[2]) > 2e6,
        ((rollPair.mz - nm[2]) / 1e6).toFixed(1) + " MN·m");
    const pitchFin = bAero.compute(vB, [0, 0, 0], bmp.com, bAir, bAct(0, 30, 0));
    ok("booster 180 fin alone → pitch", Math.abs(pitchFin.mx - nm[0]) > 5e6,
        ((pitchFin.mx - nm[0]) / 1e6).toFixed(1) + " MN·m");
}

section("acceptance suite · hinge geometry");
{
    /* [10] Every aerodynamic surface must be a PURE ROTATION about a line
     * fixed in the body. For the flaps that is a statement with real content:
     * the hinge lies on the hull, the panel's inboard edge lies on the hinge,
     * and the panel must sweep OUTWARD across its whole travel. The previous
     * geometry hung the panel off the centreline on an arm, so it left the
     * hull at one end of the sweep and passed through it at the other — which
     * is exactly what "the flaps are floating" looks like from outside.
     *
     * The condition is one line of trigonometry: the panel sweeps outward for
     * every deflection iff cos(hingeAz + d) < 0 over the travel, i.e. the
     * hinge azimuth plus the deflection stays in the second and third
     * quadrants. render.js and aero.js both build from these numbers, so
     * checking them here checks both. */
    for (const f of V.SHIP.flaps) {
        const r = V.SHIP.radius;
        let minR = Infinity, maxR = -Infinity;
        for (let d = f.minDefl; d <= f.maxDefl + 1e-9; d += 1 * DEG) {
            const hx = r * Math.cos(f.hingeAz), hy = f.side * r * Math.sin(f.hingeAz);
            const ux = -Math.cos(d), uy = f.side * Math.sin(d);
            for (let t = 0; t <= f.span + 1e-9; t += f.span / 12) {
                const rad = Math.hypot(hx + ux * t, hy + uy * t);
                minR = Math.min(minR, rad); maxR = Math.max(maxR, rad);
            }
        }
        ok(`[10] ${f.name}: no part of the panel enters the hull at any deflection`,
            minR >= r - 1e-6, `closest approach ${minR.toFixed(3)} m to a ${r} m hull`);
        ok(`[10] ${f.name}: the inboard edge stays ON the hull`,
            Math.abs(minR - r) < 1e-6);
        ok(`[10] ${f.name}: full deflection actually puts it out in the flow`,
            maxR > r + 0.8 * f.span, maxR.toFixed(2));
        near(`[10] ${f.name}: area is chord × span, not an independent number`,
            f.area, f.chord * f.span, 1e-9);
    }
    /* And the same for the grid fins, which hinge about their own radius.
     *
     * THE SWEEP CHECK WAS MISSING HERE AND THE FINS WERE BROKEN BECAUSE OF IT.
     * The flaps above have had a no-hull-intersection assertion since the day
     * they were fixed; the fins only ever had "area is chord × span" and "sits
     * high on the vehicle", neither of which can see a hinge turning about the
     * wrong axis. render.js was composing the pivot's two rotations in the
     * default Euler order, which applies the deflection about the parent frame
     * rather than the radius, and two of the three fins swung 2.3 m into the
     * hull at full deflection. It was visible from outside for weeks.
     *
     * A grid fin's panel lies in the plane containing the radius and the body
     * axis, with its inboard edge on the hull, so a pure rotation about that
     * radius can only carry it AROUND the body, never into it: every point
     * keeps its radial offset and gains a tangential one, so the distance from
     * the axis is hypot(r + x, t) and is minimised at x = t = 0. Checking that
     * the measured minimum equals the mount radius is therefore exactly the
     * statement "the hinge axis is the radius". */
    for (const f of V.BOOSTER.fins) {
        near("[10] grid fin area is chord × span", f.area, f.chord * f.span, 1e-6);
        ok("[10] grid fin sits high on the vehicle and below the nose",
            f.z > 0.8 * V.BOOSTER.length && f.z < V.BOOSTER.length - 2);

        const R = V.BOOSTER.radius, mount = R + 0.3;
        let minR = Infinity;
        for (let d = -f.maxDefl; d <= f.maxDefl + 1e-9; d += 2 * DEG) {
            const cd = Math.cos(d), sd = Math.sin(d);
            for (let i = 0; i <= 8; i++) {
                const x = f.span * (i / 8);                    // radial offset along the panel
                for (let j = 0; j <= 8; j++) {
                    const y = f.chord * (j / 8 - 0.5);         // along the body axis
                    // rotation about the RADIUS: the axial extent turns tangential
                    const tangential = y * sd;
                    minR = Math.min(minR, Math.hypot(mount + x, tangential));
                }
            }
        }
        ok(`[10] grid fin at ${(f.az / DEG).toFixed(0)}°: no part enters the hull at any deflection`,
            minR >= R - 1e-6, `closest approach ${minR.toFixed(3)} m to a ${R} m hull`);
        near(`[10] grid fin at ${(f.az / DEG).toFixed(0)}°: the hinge IS the radius`,
            minR, mount, 1e-6);
    }

    /* THE CHECK ABOVE IS ANALYTIC AND WOULD NOT HAVE CAUGHT THE BUG IT DOCUMENTS.
     * It assumes the hinge is the radius and then shows that such a hinge cannot
     * reach the hull — true, and useless against a render that hinges about
     * something else. The defect was in how three.js COMPOSED two rotations, so
     * the only test that sees it is one that builds the same object graph
     * render.js builds and measures the result. Loading three.min.js under Node
     * needs a `self`/`window` shim and is skipped rather than failed if the file
     * is unavailable, because this is a scenery check and must never block the
     * physics suite. */
    let THREE = null;
    try {
        const g = globalThis;
        const hadSelf = "self" in g, hadWindow = "window" in g;
        if (!hadSelf) g.self = g;
        if (!hadWindow) g.window = g;
        THREE = require("./three.min.js");
        if (!hadSelf) delete g.self;
        if (!hadWindow) delete g.window;
    } catch (e) { THREE = null; }

    if (!THREE || !THREE.Object3D) {
        console.log("   (three.js unavailable under Node — grid-fin render sweep skipped)");
    } else {
        const R = V.BOOSTER.radius, mount = R + 0.3;
        for (const f of V.BOOSTER.fins) {
            let minR = Infinity, worstD = 0;
            for (let d = -f.maxDefl; d <= f.maxDefl + 1e-9; d += 3 * DEG) {
                const pivot = new THREE.Object3D();
                // built exactly as render.js builds it, order included
                pivot.rotation.order = "YXZ";
                pivot.position.set(Math.cos(f.az) * mount, f.z, -Math.sin(f.az) * mount);
                pivot.rotation.y = f.az;
                pivot.rotation.x = d;
                pivot.updateMatrixWorld(true);
                for (let i = 0; i <= 6; i++) {
                    for (let j = 0; j <= 6; j++) {
                        for (const t of [-0.275, 0.275]) {
                            const p = new THREE.Vector3(f.span * (i / 6), f.chord * (j / 6 - 0.5), t);
                            p.applyMatrix4(pivot.matrixWorld);
                            const rad = Math.hypot(p.x, p.z);   // scene x,z is the body cross-section
                            if (rad < minR) { minR = rad; worstD = d; }
                        }
                    }
                }
            }
            ok(`[10] grid fin at ${(f.az / DEG).toFixed(0)}°: AS RENDERED, stays out of the hull`,
                minR >= R - 1e-6,
                `closest ${minR.toFixed(3)} m at ${(worstD / DEG).toFixed(0)}° deflection, hull ${R} m` +
                ` — check pivot.rotation.order is YXZ, not the default XYZ`);
        }
    }
    ok("[A2] the booster is the three-fin V3 vehicle, consistently",
        V.BOOSTER.fins.length === 3 && Math.abs(V.BOOSTER.length - 72.3) < 0.01
        && Math.abs(V.BOOSTER.fins[0].area - 28.125) < 0.01);
    ok("[A2] ...with no fin on the tower-facing side (body +X)",
        V.BOOSTER.fins.every(f => Math.abs(Math.cos(f.az)) < 0.999 || Math.cos(f.az) < 0));
    ok("[A2] the catch hardpoints are just below the fins, as on V3",
        V.BOOSTER.catchPinZ < V.BOOSTER.fins[0].z && V.BOOSTER.catchPinZ > V.BOOSTER.fins[0].z - 6);
    ok("[B1] the booster has no legs and never will", !V.BOOSTER.hasLegs);
}

section("acceptance suite · the environment admits a good flight");
{
    /* [6] A correctly flown landing burn descends monotonically to zero at the
     * rail height. This is NOT a claim about the evolved policy — it is a
     * claim about the vehicle: given a controller that closes the loop on the
     * constant-deceleration law, does the hardware allow the trajectory the
     * reconstruction describes, or is the throttle floor so high that any
     * arrival overshoots upward? The probe below is a four-line scripted
     * descent and lives only in this file. */
    const sc = SC.makeScenario(0, 4711);
    sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
    sc.wind = new ATM.WindField(() => 0.5, 0);
    sc.p0[0] = V.TOWER.gateX; sc.p0[1] = V.TOWER.gateY;
    sc.p0[2] = (V.TOWER.armZ - V.BOOSTER.catchPinZ) + 900;
    sc.v0[0] = 0; sc.v0[1] = 0; sc.v0[2] = -150;
    M.qFromAxisAngle(sc.q0, 1, 0, 0, 0); M.vset(sc.w0, 0, 0, 0);
    sc.prop = 60000; sc.tMax = 60;
    const w = new WM.World(sc);
    const LAD = V.BOOSTER.engineLadder;
    const aim = V.TOWER.armZ - V.BOOSTER.catchPinZ;
    const hs = [];
    let lit = false, tLit = 0, propLit = 0, rung = 0;
    const r = w.runEpisode((wo, o) => {
        o.fill(0);
        const h = wo.p[2] - aim, v = -wo.v[2], m = wo.mp.m;
        /* The exact constant-deceleration law: the single deceleration that
         * takes v to a walking pace exactly at the rails. Nothing here is a
         * schedule — the same expression fires at 900 m on this descent and
         * would fire at 3 km on a faster one. */
        const aReq = (v * v - 1) / (2 * Math.max(0.5, h));
        const aHi = (k) => (LAD[k] * V.RAPTOR.thrust) / m - V.G0;
        const aLo = (k) => (LAD[k] * V.RAPTOR.thrust * V.RAPTOR.minThrottle) / m - V.G0;
        if (!lit) {
            /* Dead time is part of the stopping distance: 350 ms of held
             * command, 450 ms to light, then a spool, and at 150 m/s that
             * second is 150 m of altitude spent falling with cold engines. */
            const aAhead = (v * v - 1) / (2 * Math.max(0.5, h - v * 1.2));
            for (let k = LAD.length - 1; k >= 1; k--) if (aAhead >= 0.55 * aHi(k)) { rung = k; break; }
            if (rung > 0) { lit = true; tLit = wo.t; propLit = wo.prop; }
        }
        if (lit) {
            /* Shed as soon as a smaller group can still do the job, never add:
             * the ladder is a one-way door and the hardware enforces it with
             * ignition credits. Shedding is also the ONLY way to stop
             * decelerating — with a 40% floor the throttle alone cannot. */
            for (let k = 1; k < rung; k++) if (aReq < 0.85 * aHi(k)) { rung = k; break; }
            const need = (V.G0 + aReq) * m;
            o[1] = (rung + 0.5) / LAD.length * 2 - 1;
            o[0] = M.clamp(need / (LAD[rung] * V.RAPTOR.thrust), 0.4, 1) * 2 - 1;
        } else { o[0] = -1; o[1] = -1; }
        o[9] = 1;
        hs.push(wo.p[2]);
    });
    ok("[3] the vehicle can settle without being forced upward",
        aim > 0 && (LAD[1] * V.RAPTOR.thrust * V.RAPTOR.minThrottle) / (270e3 * V.G0) < 1,
        "the smallest rung must be unable to hover, or arrival is impossible");
    ok("[5] the landing burn is a single ignition event", w.act.ignitions >= 2, `${3 - w.act.ignitions} used`);
    let up = 0, lo = Infinity;
    for (const h of hs) { lo = Math.min(lo, h); up = Math.max(up, h - lo); }
    ok("[6] altitude is monotonically decreasing through the burn — no climb",
        up < 3.0, `largest upward excursion ${up.toFixed(2)} m`);
    ok("[6] ...and it arrives at the rail height, not above or below it",
        Math.abs(r.terminal.gateDz) < 10, `${r.terminal.gateDz.toFixed(1)} m off the rails`);
    ok("[4] arrival is slow and upright enough to be taken by the arms",
        r.terminal.vzPin < 2.0 && r.terminal.tilt < 3 * DEG,
        `${r.terminal.vzPin.toFixed(2)} m/s, ${(r.terminal.tilt / DEG).toFixed(2)}°`);
    console.log(`   descent probe: lit at ${tLit.toFixed(1)} s, burn ${(w.t - tLit).toFixed(1)} s, ` +
        `${((propLit - w.prop) / 1000).toFixed(1)} t used, arrived ${r.terminal.vzPin.toFixed(2)} m/s ` +
        `at ${r.terminal.gateDz.toFixed(2)} m off the rails, ${(r.terminal.tilt / DEG).toFixed(2)}° tilt, ` +
        `${r.terminal.gateDx.toFixed(2)} m across`);

    /* THE THREE-FIN LAYOUT IS NOT DRAG-BALANCED, and that is a real property
     * of the V3 vehicle rather than an oversight. Fins at 90°/180°/270° put
     * 28 m² of lattice on three sides and nothing on the fourth, so their
     * axial drag alone — at zero angle of attack, in still air, with every
     * surface at neutral — sums to a pitching moment of nearly a
     * meganewton-metre. The booster has to trim it continuously. The probe
     * above closes no attitude loop at all, which is why it arrives dead on
     * height and speed and still 6 m off across the arms. */
    {
        const aero = new A.AeroModel(V.BOOSTER), air = ATM.airAt(3000);
        const mp = V.massProps(V.BOOSTER, 50000, {});
        const withFins = aero.compute([0, 0, -200], [0, 0, 0], mp.com, air, new V.Actuators(V.BOOSTER));
        const my = withFins.my;
        const kept = V.BOOSTER.fins.splice(0, V.BOOSTER.fins.length);
        const bare = aero.compute([0, 0, -200], [0, 0, 0], mp.com, air, new V.Actuators(V.BOOSTER));
        V.BOOSTER.fins.push(...kept);
        ok("[A2] a bare booster at zero angle of attack has no pitching moment",
            Math.abs(bare.my) < 1e3, (bare.my / 1e6).toFixed(4) + " MN·m");
        ok("[A2] ...and the three-fin T layout does, from its own unbalanced drag",
            Math.abs(my) > 3e5, (my / 1e6).toFixed(3) + " MN·m — a trim task the network has to solve");
    }

    /* [2] Can the Ship rotate ninety degrees in three to five seconds at all?
     * Not "does the evolved policy do it" — does the airframe permit it. The
     * probe is a rate-limited slew: work out the world axis that reduces tilt,
     * ask for a bounded angular velocity about it, and drive the gimbal on the
     * rate error. Bang-bang at full gimbal and full throttle does the rotation
     * in half the time and puts the vehicle straight into a tumble at 78°/s,
     * which is the first thing tried here and is worth knowing: this airframe
     * has roughly twice the authority the manoeuvre needs. */
    const sf = SC.makeScenario(4, 21);
    sf.wind = new ATM.WindField(() => 0.2, 0);
    const wf = new WM.World(sf);
    const ax = M.v3(), rw = M.v3(), omB = M.v3();
    let t90 = null, t10 = null, peak = 0, prevTilt = null;
    wf.runEpisode((wo, o) => {
        o.fill(0);
        o[1] = (3 + 0.5) / V.SHIP.engineLadder.length * 2 - 1;   // three engines
        o[0] = 0.6 * 2 - 1;                                      // 60% throttle
        o[4] = -1; o[5] = -1; o[6] = 1; o[7] = 1;                // fwd in, aft out
        o[9] = -1;
        wo.axis(ax);
        /* ax × ẑ is the world axis whose rotation carries the vehicle's own
         * axis toward vertical; its length is sin(tilt). */
        const s = Math.hypot(ax[0], ax[1]);
        if (s > 1e-6) {
            const omMag = Math.min(0.56, 1.4 * wo.tel.tilt);     // 32 deg/s ceiling
            M.vset(rw, (ax[1] / s) * omMag, (-ax[0] / s) * omMag, 0);
            M.qrotInv(omB, wo.q, rw);
            /* Positive gimbalX makes a NEGATIVE body-X torque and positive
             * gimbalY a negative body-Y torque, hence both signs. */
            o[2] = M.clamp(-2.5 * (omB[0] - wo.w[0]), -1, 1);
            o[3] = M.clamp(-2.5 * (omB[1] - wo.w[1]), -1, 1);
        }
        const tilt = wo.tel.tilt;
        if (prevTilt !== null) peak = Math.max(peak, Math.abs(tilt - prevTilt) / (WM.DT_PHYS * WM.CTRL_EVERY));
        prevTilt = tilt;
        if (t90 === null && tilt < 80 * DEG) t90 = wo.t;
        if (t90 !== null && t10 === null && tilt < 10 * DEG) t10 = wo.t;
    });
    ok("[2] the Ship's flap and gimbal authority can complete the flip",
        t90 !== null && t10 !== null,
        t90 === null ? "never left the flop" : `stalled at ${(wf.tel.tilt / DEG).toFixed(0)}°`);
    if (t90 !== null && t10 !== null) {
        inRange("[2] ...in three to five seconds", +(t10 - t90).toFixed(1), 2.5, 5.5);
        inRange("[2] ...at a peak pitch rate of 25-40 deg/s", +(peak / DEG).toFixed(0), 20, 45);
        console.log(`   flip probe: ${(t10 - t90).toFixed(1)} s, peak ${(peak / DEG).toFixed(0)} deg/s, ` +
            `${WM.OUTCOME_NAME[wf.outcome]}`);
    }
}

section("acceptance suite · the reference controller (diagnostic, not asserted)");
{
    /* autopilot.js is a hand-written classical controller that exists to be
     * compared against in the browser. It is NOT in the training loop and its
     * numbers are NOT assertions — printed here because the reconstruction
     * asks for them and because a reference controller that cannot land is
     * worth knowing about. */
    const NAME = WM.OUTCOME_NAME;
    for (const [stage, seed] of [[0, 11], [1, 606], [2, 31337], [4, 21], [5, 77]]) {
        const s = SC.makeScenario(stage, seed);
        s.catchAllowed = 1; s.revokeAt = null;
        const wo = new WM.World(s);
        const pol = AP.autopilotPolicy();
        let lit = wo.act.stage > 0 ? 0 : null, propLit = wo.act.stage > 0 ? wo.prop : null, ign = 0, prev = wo.act.stage;
        const res = wo.runEpisode((ww, o) => {
            pol(ww, o);
            if (ww.act.stage > prev) { ign++; if (lit === null) { lit = ww.t; propLit = ww.prop; } }
            prev = ww.act.stage;
        });
        console.log(`   stage ${stage}: ${NAME[res.outcome].padEnd(12)} ` +
            `burn ${lit === null ? "  -  " : (wo.t - lit).toFixed(1) + " s"}  ` +
            `prop ${propLit === null ? " - " : ((propLit - wo.prop) / 1000).toFixed(1) + " t"}  ` +
            `arrival ${res.terminal.vzPin.toFixed(1)} m/s  score ${res.total.toFixed(2)}`);
    }
}

section("the capture rung is measured where capture happens");
{
    /* THE BUG THIS PINS DOWN. Rung 4 used to read the capture geometry off the
     * TERMINAL snapshot. For every episode that is not a catch, the terminal
     * snapshot is ground impact — a hundred and twenty metres below the rails
     * and several seconds of drift past them. Measured on the arm-P champion
     * over the held-out bank: median terminal altitude 0.0 m, median across-arm
     * error 19.8 m against a 0.9 m gate. The rung was worth 2e-4, so
     * p4 = p3*(0.15 + 0.85*C) collapsed to exactly 0.15*p3 and the advance
     * threshold of 0.22 needed p3 = 1.47, which is above the maximum p3 can
     * take. The ladder could not have left rung 4 in any number of generations.
     *
     * These checks are white-box on purpose. A behavioural pair — "a good gate
     * pass must outscore a bad one" — passes for the wrong reason as soon as the
     * two flights also differ at the ground, which they always do, and this
     * project has already shipped two assertions that passed with the fix
     * reverted. So the assertions below are on the thing that actually broke:
     * WHERE the number is read from, and whether rung 4 moves when it changes.
     */
    const mkFall = (offX) => {
        const sc = SC.makeScenario(0, 20259);
        sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
        sc.wind = new ATM.WindField(() => 0, 0);
        sc.p0[0] = V.TOWER.gateX + offX; sc.p0[1] = V.TOWER.gateY;
        sc.p0[2] = (V.TOWER.armZ - V.BOOSTER.catchPinZ) + 700;
        sc.v0[0] = 0; sc.v0[1] = 0; sc.v0[2] = -120;
        M.qFromAxisAngle(sc.q0, 1, 0, 0, 0); M.vset(sc.w0, 0, 0, 0);
        sc.prop = 60000; sc.tMax = 60;
        const w = new WM.World(sc);
        const LAD = V.BOOSTER.engineLadder, aim = V.TOWER.armZ - V.BOOSTER.catchPinZ;
        let lit = false, rung = 0;
        const r = w.runEpisode((wo, o) => {
            o.fill(0);
            const h = wo.p[2] - aim, v = -wo.v[2], m = wo.mp.m;
            const aReq = (v * v - 1) / (2 * Math.max(0.5, h));
            const aHi = (k) => (LAD[k] * V.RAPTOR.thrust) / m - V.G0;
            if (!lit) {
                const aAhead = (v * v - 1) / (2 * Math.max(0.5, h - v * 1.2));
                for (let k = LAD.length - 1; k >= 1; k--) if (aAhead >= 0.55 * aHi(k)) { rung = k; break; }
                if (rung > 0) lit = true;
            }
            if (lit) {
                for (let k = 1; k < rung; k++) if (aReq < 0.85 * aHi(k)) { rung = k; break; }
                o[1] = (rung + 0.5) / LAD.length * 2 - 1;
                o[0] = M.clamp(((V.G0 + aReq) * m) / (LAD[rung] * V.RAPTOR.thrust), 0.4, 1) * 2 - 1;
            } else { o[0] = -1; o[1] = -1; }
            o[9] = 1;
        });
        return { w, r, gate: w.acc.gate, term: r.terminal };
    };

    /* 40 m across the arms: outside the 20 m window that ends the episode at
     * the plane, so this one flies a clean rail-height pass and then continues
     * to the ground. That is precisely the case the old scoring could not see. */
    const A = mkFall(40);
    ok("[G1] a flight that passes the rails and falls on is scored at the rails",
        A.gate != null && Math.abs(A.gate.dz) < 3.0,
        A.gate ? `snapshot taken ${A.gate.dz.toFixed(2)} m off the rail plane` : "no gate snapshot at all");
    ok("[G1] ...while its terminal state is the ground, far below",
        A.term.alt < 5.0 && Math.abs(A.term.gateDz) > 60,
        `terminal alt ${A.term.alt.toFixed(1)} m, ${A.term.gateDz.toFixed(1)} m below the rails`);
    /* NON-VACUITY. If the two measurement points happened to agree, every
     * assertion here would pass with the bug back in place. They must not. */
    const gateMiss = A.gate ? Math.hypot(A.gate.dx, A.gate.dy) : 0;
    ok("[G1] ...and the two points genuinely disagree, or this test proves nothing",
        Math.abs(A.term.gateDist - gateMiss) > 3.0 || Math.abs(A.term.vzPin - A.gate.vz) > 3.0,
        `gate ${gateMiss.toFixed(1)} m @ ${A.gate.vz.toFixed(1)} m/s vs ` +
        `terminal ${A.term.gateDist.toFixed(1)} m @ ${A.term.vzPin.toFixed(1)} m/s`);

    /* Rung 4 must actually READ the snapshot. Spoiling only the snapshot, with
     * the flight and its terminal state untouched, must move the rung. */
    const before = A.w.phaseScores()[3];
    const keep = A.w.acc.gate;
    A.w.acc.gate = Object.assign({}, keep, { dx: keep.dx + 400, dy: keep.dy + 400 });
    const after = A.w.phaseScores()[3];
    A.w.acc.gate = keep;
    ok("[G2] rung 4 responds to the rail-plane state and not to the terminal state",
        before > after * 1.5 && before - after > 0.01,
        `${before.toFixed(4)} → ${after.toFixed(4)} when only the snapshot is spoiled`);

    /* THE HOVER EXPLOIT. Height gates the rung rather than contributing to it,
     * because as one term among six it paid about 0.47 for parking above the
     * rails and never approaching them — and the booster CAN hover on the
     * three-engine rung. Every reward bug in this project has had this shape. */
    A.w.acc.gate = Object.assign({}, keep, { dz: 400, vz: 0, vh: 0 });
    const hover = A.w.phaseScores()[3];
    A.w.acc.gate = keep;
    ok("[G3] parking 400 m above the rails does not buy the capture rung",
        hover < before * 0.5,
        `hover ${hover.toFixed(4)} vs a real rail pass ${before.toFixed(4)}`);

    console.log(`   gate pass: ${gateMiss.toFixed(1)} m off at ${A.gate.vz.toFixed(1)} m/s, ` +
        `${(A.gate.tilt / DEG).toFixed(1)}° · terminal ${A.term.gateDist.toFixed(1)} m off at ` +
        `${A.term.vzPin.toFixed(1)} m/s · rung4 ${before.toFixed(3)} (spoiled ${after.toFixed(3)}, hover ${hover.toFixed(3)})`);
}

/* -------------------------------------------------------------------- end */
console.log("\n" + "=".repeat(64));
if (fail === 0) {
    console.log(`ALL ${pass} CHECKS PASSED`);
} else {
    console.log(`${pass} passed, ${fail} FAILED:`);
    for (const f of fails) console.log("   ✗ " + f);
}
console.log("=".repeat(64));
process.exit(fail === 0 ? 0 : 1);
