/* test_headless.js — Node smoke test. Run: node test_headless.js
 *
 * Loads the browser files into one context and checks the things that were
 * actually wrong at some point during development, which is the only kind of
 * test worth having:
 *
 *   1. the multibody maths (free fall, mass-matrix symmetry, conservation)
 *   2. the body model's geometry and keyframe poses
 *   3. contact behaviour — a standing walker must not skate, chatter or sink
 *   4. the fitness function's incentives, checked as arithmetic rather than hope
 *   5. the curriculum ratchet
 *   6. that evolution runs and serialises
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

let failures = 0;
function check(name, ok, extra) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}
const M = HUMANOID;
const p1 = new Float64Array(3), p2 = new Float64Array(3);   // scratch, for limb-vs-limb

/* Stand a walker up in a given pose, with the network replaced by a fixed
 * command. Returns the walker and its world. */
/* terrainDifficulty 0 pins the ground dead flat. These rigs drop the walker at
 * the origin and compute its resting height assuming y=0 under it, and they are
 * testing contact and fitness arithmetic, not terrain. Stage 1 stopped being
 * flat when terrain moved to the front of the curriculum, at which point every
 * one of them was quietly measuring a walker sliding down a hill — 114 cm of
 * "skating", 37x body weight of "support", 815 mm of "penetration". Any test
 * that wants relief asks for it explicitly. */
function rig(pose, cmd, opts) {
    const net = new Net(NET_SIZES, mulberry32(1));
    const world = new World(M, [net], Object.assign({ stage: 1, missionSeed: 1, noise: false, noiseSeed: 1, terrainDifficulty: 0 }, opts || {}));
    const w = world.walkers[0];
    if (pose) {
        for (let j = 0; j < M.nj; j++) w.mb.q[j + 1] = pose[j];
        w.mb.qd.fill(0);
        w.mb.bp[0] = 0; w.mb.bp[1] = 0; w.mb.bp[2] = 0;
        w.mb.bq.set([1, 0, 0, 0]);
        w.mb.fk();
        let lo = 1e9; const p = new Float64Array(3);
        for (const c of M.contacts) { w.mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], p, 0); lo = Math.min(lo, p[1]); }
        w.mb.bp[1] = -lo; w.mb.fk();
        for (let j = 0; j < M.nj; j++) w.target[j] = pose[j];
    }
    if (cmd) {
        for (let j = 0; j < M.nj; j++) w.cmd[j] = w.base[j] = cmd[j];
        w.control = function () { };
        w.amp.fill(0);
    }
    w.timeLeft = 1e9;
    return { world, w };
}

/* ---- 1. model geometry and keyframe poses ---- */
{
    // 21 links / 20 joints since the shoulder gained its roll axis: a one-axis
    // shoulder is not a humanoid shoulder, and the arm had nowhere to go but
    // through the hip.
    check("model: 23 links, 22 joints, 28 DoF", M.bodies.length === 23 && M.nj === 22 && 6 + M.nj === 28,
        `${M.bodies.length} links, ${M.nj} joints`);
    /* 32 fixed + 3 per joint + 3 centre-of-mass velocity, then whichever of the
     * optional terrain blocks this build was loaded with: the 360-degree ring
     * costs N_FAN over the four probes it supersedes (it replaced the lateral
     * fan, and FAN_ON went with it), and the foot-referenced block is
     * 2 clearance + 4 attitude + 2x25 foveal cells. */
    check("model: the sensor layout tracks the joint count",
        // 36 fixed: gravity 3, gyro 3, base velocity 3, height 1, uprightness 1,
        // foot load 2, foot contact 2, foot position 6, waypoint distance 1 and
        // bearing 2, gait clock 2, wind 2, COM velocity 3, COM height 1, COM over
        // feet 2, capture point 2. Then 3 per joint (angle, rate, efference).
        NC === 36 + 3 * M.nj + N_FAN + (PATCH_CHANNELS ? 6 + 2 * PATCH_CELLS : 0)
        && NOUT === M.nj + 11,
        `NC ${NC}, NOUT ${NOUT}, ring ${N_FAN}, patches ${PATCH_CHANNELS ? "on" : "off"}`);
    /* The input width is the GA's whole budget: a GA pays for every input in
     * weights and every weight in search time, and hidden layer 1 is 48 wide so
     * one channel costs 48 parameters. This is the tripwire for anyone adding a
     * sensor without counting — the LiDAR-era layout was 489, and the point of
     * replacing it was to carry MORE terrain information in FEWER weights. */
    check("model: the input layer is the size the sensor layout implies",
        // 365 is the 194-channel / 36-point-ring layout with the differenced
        // temporal windows. The literal is the whole point: it must be edited
        // deliberately, so that adding a sensor is a decision rather than a side
        // effect. It was 364 under the six raw lag ladders that preceded it.
        NIN === (PATCH_CHANNELS ? 365 : NIN) && NET_SIZES[0] === NIN
        && NIN === NC + TEMPORAL.reduce((a, s) => a + s.length, 0),
        `NIN ${NIN}, layer-1 weights ${NIN * NET_SIZES[1]} (LiDAR era: ${489 * NET_SIZES[1]})`);
    check("model: mass and height are human-scale", Math.abs(M.totalMass - 65) < 0.5 && M.height > 1.6 && M.height < 1.8,
        `${M.totalMass.toFixed(1)} kg, ${M.height.toFixed(2)} m`);
    // both keyframes must put the soles flat, or the whole contact model lies
    for (const [name, pose, hipY] of [["nominal", M.nominal, M.standHipY], ["crouch", M.crouch, M.crouchHipY]]) {
        const { w } = rig(pose, null);
        const o = new Float64Array(3);
        let lo = 1e9, hi = -1e9;
        for (const fb of M.footBody) for (const p of M.contactPts) {
            w.mb.worldPoint(fb, p[0], p[1], p[2], o, 0);
            lo = Math.min(lo, o[1]); hi = Math.max(hi, o[1]);
        }
        check(`pose ${name}: soles flat on the ground`, hi - lo < 1e-9, `corner spread ${(hi - lo).toExponential(1)} m`);
        check(`pose ${name}: hip height matches the leg kinematics`, Math.abs(w.mb.bp[1] - hipY) < 1e-6,
            `${w.mb.bp[1].toFixed(4)} vs ${hipY.toFixed(4)} m`);
    }
    check("pose: the crouch is a real squat, not a knee bend",
        M.crouchHipY < M.standHipY * 0.88 && M.crouchHipY > M.standHipY * 0.7,
        `${(100 * M.crouchHipY / M.standHipY).toFixed(0)}% of standing height`);
}

/* ---- 2. multibody dynamics ---- */
{
    const { w } = rig(M.crouch, null);
    const mb = w.mb;
    mb.clearForces();
    mb.dynamics(new Float64Array(M.nj + 1));
    const R = mb.R, a = mb.qdd;
    const ay = R[3] * a[3] + R[4] * a[4] + R[5] * a[5];
    const ax = R[0] * a[3] + R[1] * a[4] + R[2] * a[5];
    let maxJ = 0;
    for (let j = 0; j < M.nj; j++) maxJ = Math.max(maxJ, Math.abs(a[6 + j]));
    check("dynamics: an unsupported doll falls at exactly g", Math.abs(ay + GRAVITY) < 1e-9 && Math.abs(ax) < 1e-9,
        `${ay.toFixed(6)} m/s²`);
    check("dynamics: uniform gravity excites no joint", maxJ < 1e-9, `max |q̈| ${maxJ.toExponential(1)}`);

    mb._crba();
    const nv = mb.nv;
    let asym = 0;
    for (let i = 0; i < nv; i++) for (let j = 0; j < nv; j++) asym = Math.max(asym, Math.abs(mb.H[i * nv + j] - mb.H[j * nv + i]));
    check("dynamics: mass matrix symmetric", asym < 1e-9, `max |H-Hᵀ| ${asym.toExponential(1)}`);
    const Hc = Float64Array.from(mb.H);
    ldlFactor(Hc, nv);
    let minD = 1e18;
    for (let i = 0; i < nv; i++) minD = Math.min(minD, Hc[i * nv + i]);
    check("dynamics: mass matrix positive definite", minD > 1e-4, `min D ${minD.toExponential(2)}`);

    // energy in free flight, with the joint end-stops removed (a hard stop is
    // inelastic on purpose, so it legitimately eats energy)
    const { w: f } = rig(M.crouch, null);
    f.mb.qmin.fill(-Infinity); f.mb.qmax.fill(Infinity);
    for (let j = 1; j < f.mb.nb; j++) f.mb.qd[5 + j] = Math.sin(j * 2.3) * 1.5;
    f.mb.bp[1] = 40; f.mb.fk();
    const tau = new Float64Array(M.nj + 1);
    const e0 = f.mb.energy();
    for (let i = 0; i < 4000; i++) { f.mb.fk(); f.mb.clearForces(); f.mb.dynamics(tau); f.mb.integrate(1 / 4000); }
    f.mb.fk();
    const e1 = f.mb.energy();
    check("dynamics: energy conserved in free flight", Math.abs(e1 - e0) / Math.abs(e0) < 1e-3,
        `${(100 * (e1 - e0) / Math.abs(e0)).toFixed(4)}% over 1 s`);
}

/* ---- 3. contact: a standing walker must just stand ---- */
{
    const { world, w } = rig(M.nominal, M.nominal);
    let air = 0, peak = 0, lo = 9, hi = -9, n = 0;
    for (let i = 0; i < 8 / DT; i++) {
        world.step();
        if (i * DT < 1) continue;
        n++;
        let f = 0;
        for (let q = 0; q < w.ptForce.length; q++) f += w.ptForce[q];
        if (f <= 0) air++;
        peak = Math.max(peak, f / M.weight);
        lo = Math.min(lo, w.mb.bp[1]); hi = Math.max(hi, w.mb.bp[1]);
    }
    const drift = Math.hypot(w.mb.bp[0], w.mb.bp[2]);
    check("contact: a standing walker does not skate", drift < 0.05, `${(drift * 100).toFixed(1)} cm over 8 s`);
    check("contact: no chatter — never leaves the ground", air === 0, `${(100 * air / n).toFixed(1)}% of ticks airborne`);
    check("contact: supports exactly its own weight", peak > 0.9 && peak < 1.6, `peak ${peak.toFixed(2)}x body weight`);
    check("contact: penetration stays sub-millimetre", (hi - lo) < 0.001, `${((hi - lo) * 1000).toFixed(2)} mm of bounce`);
    check("contact: still upright after 8 s", !w.done && w.uprightness() > 0.95);
}
{
    // Static friction, tested at the primitive rather than through a walker: a
    // steady horizontal pull below the Coulomb limit must move the feet not at
    // all, and one above it must slide them. A viscous-only tangent passes the
    // second and fails the first, which is exactly the bug the stick spring
    // exists to prevent.
    const pull = frac => {
        const { world, w } = rig(M.nominal, M.nominal);
        const F = frac * world.terrain.mu * M.weight * 0.5;   // half the pull per foot
        const q = new Float64Array(3), p0 = new Float64Array(3), p1 = new Float64Array(3);
        w.mb.worldPoint(M.footBody[0], 0, -M.seg.ankleH, 0, p0, 0);
        // Pull at the soles, not the pelvis. A hip-height shove tips the walker
        // over long before it slides, which measures toppling, not friction.
        // _wind() is the injection point: it runs every physics tick, after the
        // force accumulator is cleared and the contacts are in.
        w._wind = function () {
            for (const fb of M.footBody) {
                this.mb.worldPoint(fb, 0, -M.seg.ankleH, 0, q, 0);
                this.mb.addWorldForce(fb, q[0], q[1], q[2], F, 0, 0);
            }
        };
        for (let i = 0; i < 2 / DT; i++) world.step();
        w.mb.worldPoint(M.footBody[0], 0, -M.seg.ankleH, 0, p1, 0);
        return Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    };
    const held = pull(0.35), slid = pull(1.8);
    check("contact: static friction holds a sub-Coulomb pull", held < 0.02,
        `${(held * 1000).toFixed(1)} mm at 35% of the limit`);
    check("contact: friction yields above the Coulomb limit", slid > held * 5,
        `${(slid * 100).toFixed(1)} cm at 180% of the limit`);
}

/* ---- 4. terrain ---- */
{
    for (const def of TERRAIN_DEFS) {
        const t = new Terrain(def.id, 1, mulberry32(4));
        const o = new Float64Array(4);
        let ok = true, maxSlope = 0;
        for (let x = -12; x < 24; x += 0.05) {
            t.sample(x, x * 0.3, o);
            if (!Number.isFinite(o[0]) || !Number.isFinite(o[1])) { ok = false; break; }
            if (Math.abs(Math.hypot(o[1], o[3]) / o[2]) > maxSlope) maxSlope = Math.abs(Math.hypot(o[1], o[3]) / o[2]);
        }
        check(`terrain ${def.id}: finite height and normal everywhere`, ok);
        check(`terrain ${def.id}: normals are unit length`, Math.abs(Math.hypot(o[1], o[2], o[3]) - 1) < 1e-9);
        if (def.id === "flat") check("terrain flat: is actually flat", t.height(9, -4) === 0);
        if (def.id === "stairs") {
            const rise = t.height(t.x0 + t.tread * 2.5, 0) - t.height(t.x0 - 0.5, 0);
            check("terrain stairs: climbs by whole steps", Math.abs(rise - 3 * t.rise) < 1e-9,
                `${rise.toFixed(3)} m after 3 steps of ${t.rise.toFixed(3)} m`);
        }
    }
}

/* ---- 5. the fitness function's incentives, as arithmetic ---- */
{
    // "Stand still and do nothing else" is the strategy a population finds
    // first, and an earlier build of this file plateaued on it for a hundred
    // generations. These are the arithmetic checks that keep it beatable. The
    // baseline is computed rather than measured, because the frozen default
    // controller does not survive the whole clock — the point is what an
    // *evolved* stander would earn, which is the plateau the run has to escape.
    const budget = 17, standPhase = PHASE_STAND, balPhase = PHASE_BALANCE - PHASE_STAND;
    const milestones = FIT.POSTURE * standPhase * 0.9 + FIT.STAND_BONUS
        + FIT.UPRIGHT * balPhase * 0.9 + FIT.BALANCE_BONUS;
    const standScore = milestones + FIT.ALIVE_WALK * (budget - PHASE_BALANCE);
    // Falls are priced by severity now, and the two cases differ precisely in
    // how hard the walker goes down: a walker that runs out of balance mid-step
    // topples at about walking pace, a walker that DIVES is travelling when it
    // lands. Charging both the base penalty was what let the dive back in once
    // the standing block came down.
    const sev = v => Math.min(FIT.FALL_MAX_MULT,
        1 + FIT.FALL_SPEED_W * Math.max(0, v - FIT.FALL_FREE_SPEED));
    const halfStep = milestones + FIT.ALIVE_WALK * 5 + FIT.PROGRESS_PER_M * 0.5 + FIT.FALL * sev(1.2);
    check("fitness: half a metre of walking beats standing forever", halfStep > standScore,
        `walk ${halfStep.toFixed(0)} vs stand ${standScore.toFixed(0)}`);
    // …but a forward dive, which buys distance and ends the episode, must not
    const dive = milestones + FIT.PROGRESS_PER_M * 0.4 + FIT.FALL * sev(2.6);
    check("fitness: diving forward for distance does not pay", dive < standScore,
        `dive ${dive.toFixed(0)} vs stand ${standScore.toFixed(0)}`);
    // no penalty may cost more than the waypoint it might have saved
    check("fitness: penalties stay below the value of one waypoint",
        FIT.ENERGY_CAP + FIT.WANDER_CAP - FIT.FALL < FIT.ARRIVE + FIT.PROGRESS_PER_M,
        `worst case ${(FIT.ENERGY_CAP + FIT.WANDER_CAP - FIT.FALL).toFixed(0)} vs waypoint ${(FIT.ARRIVE + FIT.PROGRESS_PER_M).toFixed(0)}`);
    // the default controller still has to get itself upright, or stage 1 has no
    // foothold at all
    const { world, w } = rig(null, M.nominal);
    let guard = 0;
    while (!world.isOver() && guard++ < 40 / DT) world.step();
    check("fitness: the default trim pose does at least stand up", w.stood,
        `${w.uprightTime.toFixed(1)} s upright before it lost it`);
}
{
    // Progress must be monotone: a walker rocking back and forth over the same
    // metre is paid for it once, not once per swing. Checked on progressM
    // directly — going through fitness() would also drag in the wander penalty
    // and the alive trickle and measure three things at once.
    // started from the standing pose so it is still upright when walking opens —
    // progress is only credited to a walker that has not fallen over
    const { world, w } = rig(M.nominal, M.nominal);
    let guard = 0;
    while (world.phase !== "walk" && guard++ < 40 / DT) world.step();
    const wp = world.waypointFor(w);
    w.stood = true;
    w.beginLeg(world, wp);
    const at = d => {                       // stand d of the way to the waypoint
        w.mb.bp[0] = wp.x * d;
        w.mb.bp[2] = wp.z * d;
        w.mb.fk();
        w.tick(world);
        return w.progressM;
    };
    const out1 = at(0.3), back = at(0.0), out2 = at(0.3), further = at(0.5);
    check("fitness: progress is paid once, not per oscillation",
        out1 > 0.1 && Math.abs(out2 - out1) < 1e-9 && Math.abs(back - out1) < 1e-9,
        `${out1.toFixed(2)} m out, ${back.toFixed(2)} m back, ${out2.toFixed(2)} m out again`);
    check("fitness: genuinely new ground is still paid", further > out2 + 0.1,
        `${further.toFixed(2)} m after going further`);
}

{
    // A walker that shifts its weight from foot to foot WITHOUT lifting either
    // one must earn no step credit. This is the exploit that ate an entire
    // training run: the first version of the detector fired on "load went
    // light", the population learned to rock on the spot for the full bonus at
    // zero risk of falling, and evolution deleted the gait — the champion's leg
    // amplitudes came back at 0.001 rad with both feet welded to the floor.
    const rock = amp => {
        const { world, w } = rig(M.nominal, M.nominal);
        w.control = function (wd) {
            const want = wd.phase === "walk" ? 1 : 0;
            this.gaitGain += (want - this.gaitGain) * (want ? 0.10 : 0.30);
            for (let j = 0; j < M.nj; j++) this.base[j] = M.nominal[j];
            this.amp.fill(0);
            this.amp[CPG_GROUPS.findIndex(g => g.name === "hipRoll")] = amp;
            this.ph.fill(0);
            this.cadence = 1;
            this._composeCmd();
        };
        let lo = 9, hi = -9, air = false, guard = 0;
        while (!world.isOver() && guard++ < 14 / DT) {
            world.step();
            if (world.time <= 5) continue;
            const t = w.footLoad[0] + w.footLoad[1];
            const share = t > 1 ? w.footLoad[0] / t : 0.5;
            lo = Math.min(lo, share); hi = Math.max(hi, share);
            if (w.footContact[0] === 0 || w.footContact[1] === 0) air = true;
        }
        return { w, lo, hi, air };
    };
    const shift = rock(0.026);
    check("fitness: rocking really does swing the load between the feet",
        shift.hi - shift.lo > 0.8 && !shift.air,
        `left foot carried ${(shift.lo * 100).toFixed(0)}%–${(shift.hi * 100).toFixed(0)}% and never left the ground`);
    check("fitness: weight-shifting without lifting a foot is NOT a step",
        shift.w.steps === 0, `${shift.w.steps} steps credited`);
    // …and the same motion, big enough to actually lift a foot, IS one
    const lift = rock(0.05);
    check("fitness: lifting and re-planting a foot IS a step",
        lift.air && lift.w.steps >= 4, `${lift.w.steps} steps, airborne ${lift.air}`);
}

/* ---- 6. the walk-phase window is actually reachable ---- */
{
    // A stage where nobody survives long enough to enter the walk phase makes
    // half the fitness function unreachable dead code. It happened.
    const rng = mulberry32(5);
    const nets = [];
    for (let i = 0; i < 24; i++) nets.push(new Net(NET_SIZES, rng));
    /* poseFrac 0 on purpose. The start pose is drawn once per WORLD, so with the
     * pool at 40% this episode is a coin flip on whether the whole fleet spawns
     * in a side plank — and random brains never rise from one, so the check
     * would pass or fail on the spawn lottery rather than on what it is for.
     * What it is for is the phase SCHEDULE: that the walk window opens early
     * enough for anything to reach it. Pin the spawn, test the schedule. */
    const world = new World(M, nets, { stage: 1, missionSeed: 3, noise: true, noiseSeed: 77, poseFrac: 0 });
    let guard = 0;
    while (!world.isOver() && guard++ < 60 / DT) world.step();
    const reached = world.walkers.filter(w => w.stood && w.walkTime > 0).length;
    check("curriculum: random brains do reach the walk phase", reached >= 3,
        `${reached}/24 got there`);
}

/* ---- 7. curriculum ratchet ---- */
{
    const hist = [];
    let st = stageFor(1, hist, {});
    check("curriculum: starts at stage 1", st.stage === 1);
    for (let i = 0; i < 6; i++) hist.push({ stage: st.stage, balancedFrac: 0.95, avgArr: 0 });
    st = stageFor(10, hist, {});
    check("curriculum: a fleet that reliably balances earns the shoves", st.stage === 2);
    for (let i = 0; i < 6; i++) hist.push({ stage: st.stage, balancedFrac: 0.1, avgArr: 0 });
    const st2 = stageFor(20, hist, {});
    check("curriculum: the ratchet never turns back", st2.stage >= 2, `stage ${st2.stage}`);
    const locked = stageFor(20, hist, { stageLock: 5, terrainDifficulty: 0.5 });
    check("curriculum: stage lock overrides everything", locked.stage === 5 && locked.terrainDifficulty === 0.5);
}

/* ---- 7b. plateau detection and the parallel search tracks ---- */
{
    /* Driven with synthetic fitnesses, because the whole mechanism is control
     * flow over hundreds of generations: a bug in it does not crash, it quietly
     * never fires or never stops, and either way the log looks normal while the
     * run does something other than what was asked. */
    const LIM = { plateauGens: 20, trackGens: 15, trackFrac: 0.36, trackCount: 3 };
    const POP = 120;
    const run = (evo, gens, fitness, lim) => {
        for (let g = 0; g < gens; g++) {
            const res = evo.brains.map((b, i) => ({ brain: b, fitness: fitness(b, i, g, evo) }));
            evo.evolve(res, 0.02, 0.03, 0, lim || LIM, { stage: 1 });
            if (evo.probeEvent) evo._log = (evo._log || []).concat(evo.probeEvent);
        }
    };

    /* The literal reading of "no new leader in N generations" is unusable, and
     * this records why so nobody re-implements it. On a fleet with ZERO real
     * improvement the crown still changes hands essentially every generation,
     * because the generation's best is a max over the whole population and the
     * champion's own score is a single noisy sample. */
    {
        const evo = new Evolution(200, 9);
        const rng = mulberry32(5);
        let swaps = 0;
        for (let g = 0; g < 120; g++) {
            const res = evo.brains.map(b => ({ brain: b, fitness: 2000 + (rng() * 2 - 1) * 900 }));
            const before = evo.champion;
            evo.evolve(res, 0.02, 0.03, 0, { plateauGens: 0 }, { stage: 1 });
            if (evo.champion !== before) swaps++;
        }
        check("plateau: the crown changing hands is NOT evidence of progress",
            swaps > 110, `crown passed in ${swaps}/120 generations of a fleet that never improved`);
    }

    // A fleet whose best keeps climbing must never be split.
    {
        const evo = new Evolution(POP, 7);
        run(evo, 90, (b, i, g) => 1000 - i + g * 40);
        check("plateau: a fleet that is still improving is left alone",
            evo.tracks.length === 0 && evo.round === null && !evo._log,
            evo._log ? evo._log[0] : "no rounds opened");
    }

    // A flat fleet must be split, and the split must be bounded.
    {
        const evo = new Evolution(POP, 7);
        let maxTrackShare = 0, sawRound = false;
        for (let g = 0; g < 60; g++) {
            const res = evo.brains.map((b, i) => ({ brain: b, fitness: i < evo.mainCount ? 1000 - i : 10 }));
            evo.evolve(res, 0.02, 0.03, 0, LIM, { stage: 1 });
            if (evo.probeEvent) evo._log = (evo._log || []).concat(evo.probeEvent);
            if (evo.round) {
                sawRound = true;
                const inTracks = evo.tracks.reduce((s, t) => s + t.n, 0);
                maxTrackShare = Math.max(maxTrackShare, inTracks / evo.popSize);
                if (evo.mainCount + inTracks !== evo.brains.length) maxTrackShare = 99;
            }
        }
        check("plateau: a flat fleet gets split into tracks", sawRound,
            (evo._log || []).slice(0, 1).join("") || "no round opened");
        check("plateau: the tracks never take more than half the pool, and the layout always adds up",
            maxTrackShare > 0 && maxTrackShare <= 0.45 + 1e-9,
            `tracks held ${(maxTrackShare * 100).toFixed(0)}% of the population`);
        check("plateau: a losing round dissolves and names the next recipe to try",
            (evo._log || []).some(l => /no track beat the leader/.test(l)),
            (evo._log || []).filter(l => /no track/.test(l))[0] || "no verdict logged");
    }

    /* A track that genuinely outruns the leader has to take the crown AND its
     * settings. Tracks live at indices >= mainCount, so paying those richly is
     * exactly "this lineage got somewhere the main line did not". */
    {
        const evo = new Evolution(POP, 21);
        for (let g = 0; g < 80; g++) {
            const res = evo.brains.map((b, i) => ({ brain: b, fitness: i < evo.mainCount ? 1000 - i : 9000 - i }));
            evo.evolve(res, 0.02, 0.03, 0, LIM, { stage: 1 });
            if (evo.probeEvent) evo._log = (evo._log || []).concat(evo.probeEvent);
            if (evo.tuned) break;
        }
        check("plateau: a track that overtakes the leader is adopted, settings and all",
            evo.tuned !== null && (evo._log || []).some(l => /OVERTOOK/.test(l)),
            (evo._log || []).filter(l => /OVERTOOK/.test(l))[0] || "nothing adopted");
        check("plateau: adopted settings stay inside the measured safe limits",
            evo.tuned === null || (evo.tuned.rate <= 0.12 + 1e-9 && evo.tuned.sigma <= 0.20 + 1e-9),
            evo.tuned ? `${evo.tuned.rate.toFixed(3)}/${evo.tuned.sigma.toFixed(3)}` : "none");
    }

    /* A promotion changes what fitness means, so it must not read as a plateau.
     * Without the stage guard, the drop in scores that follows every promotion
     * would trigger a search for a problem that does not exist. */
    {
        const evo = new Evolution(POP, 5);
        let stage = 1, openedBefore = false, openedAfter = 0;
        for (let g = 0; g < 60; g++) {
            if (g === 30) stage = 2;
            // Climbing steadily inside each stage, so nothing here is a real
            // stall — but the promotion knocks the scores down an order of
            // magnitude, and to a smoothed "has best fitness stopped rising?"
            // test that collapse is indistinguishable from one unless the stage
            // change resets the window.
            const base = stage === 1 ? 5000 + g * 60 : 500 + (g - 30) * 60;
            const res = evo.brains.map((b, i) => ({ brain: b, fitness: base - i }));
            evo.evolve(res, 0.02, 0.03, 0, LIM, { stage });
            if (g < 30 && evo.round) openedBefore = true;
            if (g >= 30 && evo.round) openedAfter++;
        }
        check("plateau: a climbing fleet is not split, before or after a promotion",
            !openedBefore, "a round opened while the fleet was still improving");
        check("plateau: a stage promotion resets the window instead of looking like a stall",
            openedAfter === 0, `${openedAfter} generations spent in a round triggered by the promotion drop`);
    }
}

/* ---- 6b. every rung stops paying ---- */
{
    // A reward for a banked skill must be bounded, or the population optimises
    // it instead of the next skill. PUSH_BONUS was uncapped and became 450
    // points — 13.8% of the champion's score, more than everything it earned by
    // moving — all of it paid for being a rock that a shove cannot topple.
    // Ticking also accrues posture income, so run the identical 12 shoves twice
    // — once with PUSH_BONUS zeroed — and difference them. Everything else about
    // the two runs is bit-identical, so what is left is the shove bonus alone.
    const SHOVES = 12;
    const shoveRun = () => {
        const world = new World(M, [new Net(NET_SIZES, mulberry32(404))],
            { stage: 5, missionSeed: 5, noise: false, noiseSeed: 1 });
        const w = world.walkers[0];
        w.stood = true;                   // the push bonus is gated behind this
        for (let i = 0; i < SHOVES && !w.done; i++) {
            w.pendingPush = CTRL_DT * 0.5;   // a shove that lands on the next tick
            w.tick(world);
        }
        return w.fitScore;
    };
    const withPush = shoveRun();
    const keep = FIT.PUSH_BONUS;
    FIT.PUSH_BONUS = 0;
    const withoutPush = shoveRun();
    FIT.PUSH_BONUS = keep;
    const earned = withPush - withoutPush;
    const ceiling = FIT.PUSH_BONUS * FIT.PUSH_CAP;
    check("reward: the shove bonus stops after its cap",
        earned <= ceiling + 1e-6 && SHOVES > FIT.PUSH_CAP,
        `${earned.toFixed(0)} from ${SHOVES} shoves, ceiling ${ceiling}`);

    // …and the same rule stated as arithmetic, for the terms that pay a walker
    // which never leaves the spot. Each must stay under the value of one metre
    // actually walked, or standing out-earns the thing it is a stepping stone to.
    check("reward: flat step income stays below one metre walked",
        FIT.STEP * FIT.STEP_CAP < FIT.PROGRESS_PER_M,
        `${FIT.STEP * FIT.STEP_CAP} vs ${FIT.PROGRESS_PER_M}/m`);
    check("reward: shove income stays below one metre walked",
        FIT.PUSH_BONUS * FIT.PUSH_CAP < FIT.PROGRESS_PER_M,
        `${FIT.PUSH_BONUS * FIT.PUSH_CAP} vs ${FIT.PROGRESS_PER_M}/m`);
}

/* ---- 1c. the limbs cannot pass through each other ---- */
{
    // The rest pose used to be built self-intersecting: the arms sat 20 mm
    // inside the chest before any joint moved, on every walker, always.
    const t = rig(null, null, {});
    const mb = t.w.mb;
    mb.fk();
    let worstRest = 0;
    for (const [a, b] of M.selfPairs) {
        mb.worldPoint(a.body, a.p[0], a.p[1], a.p[2], p1, 0);
        mb.worldPoint(b.body, b.p[0], b.p[1], b.p[2], p2, 0);
        const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
        worstRest = Math.max(worstRest, a.r + b.r - d);
    }
    check("body: nothing touches anything else in the rest pose",
        worstRest <= 0, `worst overlap ${(worstRest * 1000).toFixed(1)} mm`);

    // Now drive both hips to full adduction and hold it. Joint limits alone
    // cannot stop this — an ankle travels 180 mm inward against 90 mm of air —
    // so if the legs stay apart it is _selfCollide() doing it.
    const cmd = new Float64Array(M.nj);
    for (let j = 0; j < M.nj; j++) cmd[j] = M.nominal[j];
    cmd[J.L_HIP_ROLL] = M.bodies[J.L_HIP_ROLL + 1].qmax;   // left: toward midline
    cmd[J.R_HIP_ROLL] = M.bodies[J.R_HIP_ROLL + 1].qmin;   // right: toward midline
    const t2 = rig(null, cmd, {});
    let worst = 0;
    for (let i = 0; i < 1200; i++) {
        t2.w.stepPhysics(t2.world, DT);
        if (i < 200) continue;                              // let it settle into the stop
        for (const [a, b] of M.selfPairs) {
            t2.w.mb.worldPoint(a.body, a.p[0], a.p[1], a.p[2], p1, 0);
            t2.w.mb.worldPoint(b.body, b.p[0], b.p[1], b.p[2], p2, 0);
            const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
            worst = Math.max(worst, a.r + b.r - d);
        }
    }
    // A contact solver is a spring, so a little penetration is the force being
    // generated. What must not happen is passing THROUGH — the old body managed
    // 176 mm against a 120 mm-wide thigh.
    check("body: the legs cannot be driven through each other",
        worst < 0.015, `worst penetration ${(worst * 1000).toFixed(1)} mm under full adduction`);
}

/* ---- 6c. the tiers are an ordering, not a set of weights ---- */
{
    setReward("tiered");

    // A statue's ceiling: every standing term, paid for the whole episode, by a
    // walker that never moves a centimetre. START_BUDGET is the right clock to
    // use because only arriving extends it — and a walker that arrives has
    // already reached the tier above, where the ordering no longer binds.
    const standCeiling =
        FIT.POSTURE * PHASE_STAND +
        FIT.STAND_BONUS +
        FIT.UPRIGHT * (PHASE_BALANCE - PHASE_STAND) +
        FIT.BALANCE_BONUS +
        FIT.PUSH_BONUS * FIT.PUSH_CAP +
        FIT.ALIVE_WALK * (START_BUDGET - PHASE_BALANCE);

    // The shortest leg the course generator will ever draw. A statue must be
    // worth less than walking even the cheapest of them.
    const MIN_LEG = 1.3;
    const minLegIncome = FIT.PROGRESS_PER_M * MIN_LEG;
    check("tiers: a perfect statue is worth less than one leg of walking",
        standCeiling < minLegIncome,
        `statue ${standCeiling.toFixed(0)} vs the shortest leg ${minLegIncome.toFixed(0)}`);
    check("tiers: falling is worse than standing still",
        FIT.FALL < 0);

    // The regression this replaced "leg < arrival" with. That invariant was
    // enforced by a flat 960-point budget which, shared with the shape
    // allowance, ran out 0.79 m into a leg 1.3-2.3 m long — so the last ~60% of
    // every leg paid nothing and the search had no gradient to follow. The
    // property that actually matters is that the money lasts the whole way.
    for (const legLen of [1.3, 1.8, 2.3, 4.0]) {
        const t2 = rig(null, null, {});
        t2.w.legInitDist = legLen;
        t2.w.beginLeg({ time: 0 }, { x: t2.w.mb.bp[0] + legLen, z: t2.w.mb.bp[2] });
        const spanned = (t2.w.legBudget - FIT.WALK_SHAPE_CAP) / FIT.PROGRESS_PER_M;
        check(`tiers: the leg budget still pays at the waypoint (${legLen} m leg)`,
            spanned >= t2.w.legInitDist - 1e-9,
            `income dies at ${spanned.toFixed(2)} m of a ${t2.w.legInitDist.toFixed(2)} m leg`);
    }

    // Arriving must remain the single most valuable event, so that closing the
    // last centimetre always beats loitering with the budget unspent.
    check("tiers: one arrival outweighs the whole shape allowance",
        FIT.ARRIVE > FIT.WALK_SHAPE_CAP,
        `arrive ${FIT.ARRIVE} vs shape allowance ${FIT.WALK_SHAPE_CAP}`);

    // The budget is enforced, not merely declared.
    const t = rig(null, null, {});
    t.w.beginLeg({ time: 0 }, { x: t.w.mb.bp[0] + 1.5, z: t.w.mb.bp[2] });
    const budget = t.w.legBudget;
    t.w.legWalkScore = 0;
    t.w.fitScore = 0;
    for (let i = 0; i < 500; i++) t.w._payWalk(100);         // 50 000 offered
    check("tiers: walk income stops dead at the leg budget",
        Math.abs(t.w.legWalkScore - budget) < 1e-9 &&
        Math.abs(t.w.fitScore - budget) < 1e-9,
        `paid ${t.w.fitScore.toFixed(0)} of 50 000 offered, budget ${budget.toFixed(0)}`);

    // …and it refills per leg, so the skill keeps paying — only substitution
    // for the tier above is bounded.
    t.w.beginLeg(t.world, { x: 1, z: 0 });
    check("tiers: the budget refills on the next leg", t.w.legWalkScore === 0);

    // Scaling the standing tier by one common factor is what preserves stage-1
    // learning: the ratios inside the tier must be the ones that taught it.
    const rFlat = FLAT.STAND_BONUS / FLAT.POSTURE, rTier = TIERED.STAND_BONUS / TIERED.POSTURE;
    check("tiers: the standing terms keep their ratios to each other",
        Math.abs(rFlat - rTier) < 1e-9, `flat ${rFlat.toFixed(3)} vs tiered ${rTier.toFixed(3)}`);

    // The ordering stated as two walkers rather than as budgets, which is how
    // it was actually specified: one that stands instantly and holds it for
    // eleven seconds without moving, against one that flounders for seven,
    // gets up, walks badly, and touches a waypoint in the seconds it has left.
    // The second must not lose. It is credited with NOTHING for standing here —
    // no posture, no bonuses, no shoves — so this is the worst case for it.
    const statue11 =
        FIT.POSTURE * PHASE_STAND + FIT.STAND_BONUS +
        FIT.UPRIGHT * (PHASE_BALANCE - PHASE_STAND) + FIT.BALANCE_BONUS +
        FIT.PUSH_BONUS * FIT.PUSH_CAP + FIT.ALIVE_WALK * (11 - PHASE_BALANCE);
    const lateWalker = FIT.ARRIVE;
    check("tiers: a late scramble that reaches a waypoint beats a statue that stood for eleven seconds",
        lateWalker >= statue11,
        `walker ${lateWalker.toFixed(0)} vs statue ${statue11.toFixed(0)}`);

    // A budget spread over the leg, not a truncation of it. The first attempt
    // capped walk income at a flat 700 while progress still paid 900/m, so the
    // gradient died at 0.78 m — and the first waypoint is 1.3-2.3 m away. The
    // last centimetre before a waypoint has to pay the same as the first.
    for (const legLen of [1.3, 4.4]) {
        const g = rig(null, null, {});
        g.w.legWalkScore = 0; g.w.legShapeScore = 0; g.w.fitScore = 0;
        g.w.legInitDist = legLen;
        const N = 100, dx = legLen / N;
        g.w._payProgress(dx);
        const firstPay = g.w.fitScore;
        for (let i = 1; i < N - 1; i++) g.w._payProgress(dx);
        const before = g.w.fitScore;
        g.w._payProgress(dx);
        const lastPay = g.w.fitScore - before;
        check(`tiers: closing a ${legLen} m leg pays the whole progress budget`,
            Math.abs(g.w.fitScore - FIT.WALK_PROGRESS_LEG) < 1,
            `paid ${g.w.fitScore.toFixed(0)} of ${FIT.WALK_PROGRESS_LEG}`);
        check(`tiers: the last centimetre of a ${legLen} m leg pays like the first`,
            Math.abs(firstPay - lastPay) < 1e-6,
            `first ${firstPay.toFixed(2)}, last ${lastPay.toFixed(2)}`);
    }

    // Falling hard has to cost more than falling softly — otherwise two walkers
    // that reached the same waypoint and then went down are indistinguishable,
    // and one of them speared the floor. This is also what prices the DIVE: cut
    // the standing tier without it and the population stops standing still and
    // starts pitching forward to harvest closure, which is what the first tiered
    // run actually did — 0.35 m travelled, 1.0 steps, upright 4.4 s, down in
    // 10 missions out of 10.
    const sev = v => Math.min(FIT.FALL_MAX_MULT,
        1 + FIT.FALL_SPEED_W * Math.max(0, v - FIT.FALL_FREE_SPEED));
    check("falls: a sit-down costs the base and no more",
        sev(0.5) === 1 && sev(FIT.FALL_FREE_SPEED) === 1, `${sev(0.5)}`);
    check("falls: going down harder costs more",
        sev(3.0) > sev(1.5) && sev(1.5) > sev(0.8));
    check("falls: severity is capped",
        sev(1e6) === FIT.FALL_MAX_MULT);

    // A dive can only ever buy the closure it covers before it lands. Half a
    // metre of a short 1.3 m leg is the generous case; the landing must cost
    // more than that.
    // This priced the dive against WALK_PROGRESS_LEG, which is 0 under the flat
    // model — so the guard evaluated 0 > 0 and passed vacuously in the exact
    // configuration that trains. Under the real flat rate a 0.5 m dive earned
    // 450 and cost 355, i.e. diving PAID, which is why all twelve held-out
    // missions ended in a fall. Price it against whichever rate is live.
    const perM = FIT.WALK_PROGRESS_LEG > 0 ? FIT.WALK_PROGRESS_LEG / 1.3 : FIT.PROGRESS_PER_M;
    const diveGain = perM * 0.5;
    const diveCost = -FIT.FALL * sev(2.5);
    check("falls: a dive costs more than the closure a dive can buy",
        diveCost > diveGain, `gain ${diveGain.toFixed(0)} vs cost ${diveCost.toFixed(0)}`);

    // …but exploration must stay affordable, or the population reasons its way
    // back to standing still. An honest 0.7 m and a gentle topple must beat it.
    const walkGain = perM * 0.7 + FIT.FALL * sev(1.0);
    check("falls: an honest walk that ends in a gentle topple still pays",
        walkGain > 0, `net ${walkGain.toFixed(0)}`);

    setReward("flat");
    check("tiers: the ladder model is restored exactly",
        FIT.POSTURE === 72 && FIT.PROGRESS_PER_M === 900 && FIT.model === "flat",
        `POSTURE ${FIT.POSTURE}, rate ${FIT.PROGRESS_PER_M}/m`);
    // The whole order, in one place, so a weight change that breaks it fails here
    const statue = FIT.POSTURE * PHASE_STAND + FIT.STAND_BONUS
        + FIT.UPRIGHT * (PHASE_BALANCE - PHASE_STAND) + FIT.BALANCE_BONUS
        + FIT.PUSH_BONUS * FIT.PUSH_CAP + FIT.ALIVE_WALK * (START_BUDGET - PHASE_BALANCE);
    const rise = FIT.COM_RISE_CAP + FIT.RECOVER;
    // "one leg" is now the shortest leg the course draws, priced at the live
    // per-metre rate, rather than the flat 960 budget that used to run out
    // partway along it.
    const shortestLeg = FIT.PROGRESS_PER_M * 1.3;
    check("ladder: rise < stand < one leg, and arriving outweighs the shape allowance",
        rise < statue && statue < shortestLeg && FIT.ARRIVE > FIT.WALK_SHAPE_CAP,
        `rise ${rise.toFixed(0)} · stand ${statue.toFixed(0)} · shortest leg ${shortestLeg.toFixed(0)} · arrive ${FIT.ARRIVE}`);
}

/* ---- 7b. the generation fallback may not promote an incompetent fleet ---- */
{
    // A real run advanced to stage 3 purely on the generation fallback while
    // only 14% of the fleet could balance, against a gate of 80%. It got
    // 0.7-strength shoves and 112-degree course changes, and the measured
    // effect was immediate: balanced fell to 4-12%, mean distance walked to
    // 0.00-0.02 m. The fallback is anti-stall insurance, not a licence to
    // promote a population that cannot do the stage below.
    const hopeless = [];
    for (let i = 0; i < 8; i++) hopeless.push({ stage: 2, balancedFrac: 0.14, avgArr: 0 });
    const stuck = stageFor(400, hopeless, {});
    check("curriculum: the generation fallback will not promote a fleet that cannot balance",
        stuck.stage === 2, `stage ${stuck.stage} at generation 400 with 14% balancing`);

    // …but it must still fire for a fleet that IS competent and merely short of
    // a threshold set too high, otherwise the run stalls forever. Competent for
    // stage 3 means WALKING: this test used to assert that 60% balancing was
    // enough, which is how the fallback came to promote a fleet that could not
    // take a step and then spent 170 generations unlearning the stride it had.
    const balancers = [];
    for (let i = 0; i < 8; i++) balancers.push({ stage: 2, balancedFrac: 0.85, avgArr: 0, avgProg: 0.55 });
    const heldBack = stageFor(400, balancers, {});
    check("curriculum: balancing well is not a licence to enter the walking stage",
        heldBack.stage === 2, `stage ${heldBack.stage} at generation 400 with 85% balancing but 0.55 m walked`);

    const walkers = [];
    for (let i = 0; i < 8; i++) walkers.push({ stage: 2, balancedFrac: 0.60, avgArr: 0, avgProg: 1.10 });
    const moved = stageFor(400, walkers, {});
    check("curriculum: the fallback still rescues a fleet that walks but is short of the arrival gate",
        moved.stage === 3, `stage ${moved.stage} at generation 400 with 1.10 m walked`);
}

/* ---- 7c. the ratchet turns one way only ---- */
{
    // A fleet on stage 3 sits in the band between floor2 and floor3: good
    // enough to have earned stage 2, not yet good enough to re-earn stage 3.
    // Written as a plain assignment the stage-2 gate demoted it, and it could
    // not climb back — st3 · st3 · st2 · st3 · st3 · st2 across generations
    // 170-250 of a real run, the environment changing under a search that was
    // already fighting a noisy objective.
    const banded = [];
    for (let i = 0; i < 8; i++) banded.push({ stage: 3, balancedFrac: 0.42, avgArr: 0 });
    const held = stageFor(400, banded, {});
    check("curriculum: clearing a lower gate cannot demote a fleet that has banked a higher stage",
        held.stage === 3, `stage ${held.stage} for a stage-3 fleet at 42% balancing`);

    // The general property, over a run whose competence wanders the way a real
    // one does: the stage may stall, but it may never fall.
    const hist = [];
    let prev = 1, fell = null;
    for (let g = 1; g <= 400; g++) {
        const bal = 0.35 + 0.35 * Math.sin(g / 11);      // wanders across every floor
        const st = stageFor(g, hist, {}).stage;
        if (st < prev) fell = `generation ${g}: stage ${prev} -> ${st}`;
        prev = st;
        hist.push({ stage: st, balancedFrac: bal, avgArr: Math.max(0, bal - 0.5) });
    }
    check("curriculum: the stage never falls across a run whose competence wanders",
        fell === null, fell || "");
}

/* ---- 8. fairness: identical episodes for every walker ---- */
{
    const rng = mulberry32(11);
    const nets = [];
    for (let i = 0; i < 6; i++) nets.push(new Net(NET_SIZES, rng));
    const world = new World(M, nets, { stage: 5, missionSeed: 9, noise: true, noiseSeed: 3 });
    const p0 = world.walkers[0].mb.bp;
    let same = true;
    for (const w of world.walkers) {
        if (Math.abs(w.mb.bp[0] - p0[0]) > 1e-12 || Math.abs(w.mb.bp[2] - p0[2]) > 1e-12) same = false;
        for (let j = 0; j < M.nj; j++) if (Math.abs(w.mb.q[j + 1] - world.walkers[0].mb.q[j + 1]) > 1e-12) same = false;
    }
    check("fairness: every walker spawns in the identical pose at the identical spot", same);
    // …and hears the identical noise stream, so a lucky draw cannot be mistaken
    // for a good brain
    const a = mulberry32(3), b = mulberry32(3);
    check("fairness: noise streams are per-walker but identically seeded", a() === b());
}

/* ---- 9. evolution runs, improves, and round-trips ---- */
{
    const evo = new Evolution(24, 123);
    let first = null, last = null;
    for (let g = 0; g < 3; g++) {
        const world = new World(M, evo.brains, { stage: 1, missionSeed: g + 1, noise: true, noiseSeed: 100 + g });
        let guard = 0;
        while (!world.isOver() && guard++ < 60 / DT) world.step();
        const results = world.boats ? [] : world.walkers.map(w => ({ brain: w.brain, fitness: w.fitness(), arrivals: w.arrivals }));
        const sum = evo.evolve(results, 0.10, 0.15, 3, {}, world.summary());
        if (first === null) first = sum.best;
        last = sum.best;
        check(`evolution gen ${g + 1}: finite fitness`, Number.isFinite(sum.best) && Number.isFinite(sum.avg),
            `best ${sum.best.toFixed(0)}, mean ${sum.avg.toFixed(0)}`);
    }
    check("evolution: population size stable", evo.brains.length === 24);
    check("evolution: champion recorded", evo.champion !== null);
    check("evolution: the best-ever brain is re-injected into the pool",
        evo.brains.some(b => {
            const inp = new Float32Array(NET_SIZES[0]).fill(0.21);
            const o1 = b.forward(inp), o2 = evo.champion.forward(inp);
            for (let i = 0; i < NOUT; i++) if (Math.abs(o1[i] - o2[i]) > 1e-9) return false;
            return true;
        }));

    const json = JSON.stringify(evo.champion.toJSON());
    const back = Net.fromJSON(JSON.parse(json));
    const inp = new Float32Array(NET_SIZES[0]).fill(0.3);
    const o1 = evo.champion.forward(inp), o2 = back.forward(inp);
    let same = true;
    for (let i = 0; i < NOUT; i++) if (Math.abs(o1[i] - o2[i]) > 1e-6) same = false;
    check("nn: JSON round-trip identical", same);
    check("nn: rhythm outputs seeded wider than posture outputs",
        OUT_ROW_SCALE[0] === 1 && OUT_ROW_SCALE[NOUT - 1] > 5);
}

/* ---- 9b. the mutation step has to be survivable ---- */
{
    // The defect that cost a 350-generation run. At the inherited defaults of
    // 0.10 / 0.15, zero of 24 children landed within 5% of their parent and
    // zero improved on it — the hill-climb had no uphill move available and the
    // population mean fell steadily for three hundred generations.
    //
    // This is a cheap proxy for that expensive measurement: mutation must not
    // move the network's OUTPUT much further than the useful command range.
    // Running actual episodes here would cost minutes; the output delta tracks
    // the behavioural damage closely enough to catch a regression.
    const rng = mulberry32(31);
    const parent = new Net(NET_SIZES, rng);
    const inp = new Float32Array(NET_SIZES[0]);
    for (let i = 0; i < inp.length; i++) inp[i] = Math.sin(i * 0.37) * 0.5;
    const base = parent.forward(inp).slice();
    /* MEAN over many children, not the worst of a handful.
     *
     * This was max-of-12, and max-of-12 is an order statistic — the same shape
     * of mistake as trusting the training log's best-of-N, which has
     * contradicted the held-out exam four times in this project. Measured across
     * three seeds, the worst-of-12 ratio wanders between 1.43x and 2.18x purely
     * on luck, so the test could fail for no reason; the mean ratio sits at
     * 2.18x-3.00x and barely moves. The property was real all along and stronger
     * than the old threshold of 1.5x claimed — the measurement was the problem.
     *
     * It surfaced because gaussRand caches a spare deviate in a module global,
     * so any test that mutates shifts the draws every later test receives. A
     * robust statistic is immune to that; a max of twelve is not. */
    const deltaAt = (rate, sigma) => {
        let sum = 0, worst = 0;
        const N = 300;
        for (let k = 0; k < N; k++) {
            const kid = parent.clone().mutate(rate, sigma, rng);
            const o = kid.forward(inp);
            let d = 0;
            for (let i = 0; i < NOUT; i++) d = Math.max(d, Math.abs(o[i] - base[i]));
            sum += d; worst = Math.max(worst, d);
        }
        return { mean: sum / N, worst };
    };
    const dDefault = deltaAt(MUT_DEFAULT.rate, MUT_DEFAULT.sigma);
    const dOld = deltaAt(0.10, 0.15);
    check("mutation: the default step perturbs the command, it does not replace it",
        dDefault.mean < 0.20,
        `typical output move ${dDefault.mean.toFixed(3)} (worst ${dDefault.worst.toFixed(3)}) at ${MUT_DEFAULT.rate}/${MUT_DEFAULT.sigma}`);
    check("mutation: the default step is materially gentler than the old one",
        dOld.mean > dDefault.mean * 1.8,
        `old ${dOld.mean.toFixed(3)} vs default ${dDefault.mean.toFixed(3)} (${(dOld.mean / dDefault.mean).toFixed(2)}x)`);
}

/* ---- 9c. the champion record is a measurement, not a lottery max ---- */
{
    // `championFit` used to be a running maximum. On an objective where one
    // fixed brain scores 1,031 to 2,934 depending only on the mission, a max
    // over thousands of samples lands ~4 sd above the truth and freezes the
    // crown on whichever brain drew the easiest paper. It must instead be the
    // champion's score on THIS generation's missions — a paired comparison —
    // and it must therefore be allowed to fall.
    const evo = new Evolution(16, 77);
    const scoreOf = new Map();
    const fake = () => evo.brains.map(b => ({ brain: b, fitness: scoreOf.get(b) != null ? scoreOf.get(b) : 100, arrivals: 0 }));

    // generation 1: one brain gets a wildly lucky 5000
    scoreOf.set(evo.brains[3], 5000);
    evo.evolve(fake(), 0.03, 0.03, 0, {}, {});
    const crowned = evo.championFit;

    // generation 2: the same brain, re-injected, is honestly worth 1200
    scoreOf.clear();
    if (evo._injected) scoreOf.set(evo._injected, 1200);
    evo.evolve(fake(), 0.03, 0.03, 0, {}, {});

    check("champion: a lucky episode crowns a brain", crowned === 5000);
    check("champion: the record is re-measured and allowed to fall",
        evo.championFit === 1200, `championFit ${evo.championFit}`);
    check("champion: the brain itself is kept while it is still the best",
        evo._injected !== null);
}

/* ---- 10. champion grace ---- */
{
    const evo = new Evolution(16, 55);
    const fake = fitOf => evo.brains.map((b, i) => ({ brain: b, fitness: fitOf(b, i), arrivals: 0 }));
    evo.evolve(fake((b, i) => i === 3 ? 1000 : 100 - i), 0.02, 0.15, 3, {}, {});
    check("grace: winner crowned with full grace", evo.grace && evo.grace.left === 3 && evo.graceIdx >= 0 &&
        evo.brains[evo.graceIdx] === evo.grace.net);
    evo.evolve(fake(b => b === evo.grace.net ? 5 : 200), 0.02, 0.15, 3, {}, {});
    check("grace: a beaten champion is sheltered", evo.grace.left === 2 && evo.brains[evo.graceIdx] === evo.grace.net,
        evo.graceEvent);
    evo.evolve(fake((b, i) => 100 - i), 0.02, 0.15, 0, {}, {});
    check("grace: 0 turns it off", evo.grace === null && evo.graceIdx === -1);
    check("grace: population size stable throughout", evo.brains.length === 16);
}

/* ---- 11. the course actually makes the walker turn round ---- */
{
    // For 280 generations no waypoint was ever behind the walker: stage 2 capped
    // a turn at +/-47 degrees and even stage 5 at +/-112, so the hip-yaw joints
    // were never under selection pressure and "walking" meant "walking forwards".
    const turnStats = stage => {
        let behind = 0, total = 0, sharpest = 0;
        for (let m = 0; m < 120; m++) {
            const w = new World(HUMANOID, [new Net(NET_SIZES, mulberry32(1))],
                { stage, missionSeed: 1 + m * 37, noiseSeed: 5, noise: false, groundFrac: 0 });
            while (w.points.length < 6) w._spawnPoint();
            for (let i = 1; i < w.points.length; i++) {
                const a = w.points[i - 1], b = w.points[i], p = i > 1 ? w.points[i - 2] : w.spawn;
                const hIn = Math.atan2(-(a.z - p.z), a.x - p.x);
                const hOut = Math.atan2(-(b.z - a.z), b.x - a.x);
                const d = Math.abs(Math.atan2(Math.sin(hOut - hIn), Math.cos(hOut - hIn)));
                total++; sharpest = Math.max(sharpest, d);
                if (d > Math.PI / 2) behind++;
            }
        }
        return { frac: behind / total, sharpest };
    };
    const s2 = turnStats(2), s3 = turnStats(3);
    check("course: stage 2 sends the walker behind itself sometimes",
        s2.frac > 0.05 && s2.frac < 0.45,
        `${(s2.frac * 100).toFixed(1)}% of legs turn past 90 deg`);
    check("course: a leg can demand a full about-face",
        s2.sharpest > 2.6, `sharpest turn ${(s2.sharpest * 180 / Math.PI).toFixed(0)} deg`);
    check("course: the walking stage turns more often than the balance stage",
        s3.frac > s2.frac, `stage 2 ${(s2.frac * 100).toFixed(0)}% vs stage 3 ${(s3.frac * 100).toFixed(0)}%`);

    // The first leg must stay reachable by a newborn that can only fall forwards,
    // or the bottom of the ladder stops paying and the curriculum stalls.
    // The invariant is that `spin` never fires on leg 1, so the first bearing
    // stays inside the stage's ordinary turn limit. Note this is NOT the same as
    // "never behind": stage 3's limit is already 112 degrees, so roughly a
    // quarter of its first legs were behind the walker long before turn-around
    // legs existed. Asserting the stronger property would have been asserting
    // something the course has never done.
    const firstLegWidest = stage => {
        let widest = 0;
        for (let m = 0; m < 200; m++) {
            const w = new World(HUMANOID, [new Net(NET_SIZES, mulberry32(1))],
                { stage, missionSeed: 1 + m * 37, noiseSeed: 5, noise: false, groundFrac: 0 });
            w._spawnPoint();
            const p = w.points[0];
            const to = Math.atan2(-(p.z - w.spawn.z), p.x - w.spawn.x);
            widest = Math.max(widest, Math.abs(Math.atan2(Math.sin(to - w.startYaw), Math.cos(to - w.startYaw))));
        }
        return widest;
    };
    for (const stage of [2, 3]) {
        const limit = 0.35 + 1.6 * STAGES[stage - 1].turn;
        const widest = firstLegWidest(stage);
        check(`course: a turn-around is never the first leg (stage ${stage})`,
            widest > 0.15 && widest <= limit + 1e-6,
            `widest first bearing ${(widest * 180 / Math.PI).toFixed(0)} deg against the stage limit ${(limit * 180 / Math.PI).toFixed(0)} deg`);
    }
    // …and at stage 2, where a newborn has to be able to score at all, that
    // limit must itself keep the first waypoint in front.
    check("course: stage 2's first leg is reachable by a walker that only goes forwards",
        0.35 + 1.6 * STAGES[1].turn < Math.PI / 2,
        `stage 2 turn limit ${((0.35 + 1.6 * STAGES[1].turn) * 180 / Math.PI).toFixed(0)} deg`);
}

/* ---- 11b. on rough ground the waypoints are ON the rough ground ---- */
{
    // The staircase ran only towards +X from x0 = 3.0 and was invariant in z,
    // while startYaw is uniform over +/-pi — so about half of every stair course
    // walked away from the steps and spent the episode on ground that was flat
    // by construction. From the GUI that looks like "waypoints only spawn on the
    // level", and that is exactly what it was.
    const t = new Terrain("stairs", 1, mulberry32(3));
    check("terrain: the staircase is reachable whichever way the walker faces",
        Math.abs(t.height(-4, 0) - t.height(4, 0)) < 1e-9 && t.height(-4, 0) > 0.1,
        `h(-4) ${t.height(-4, 0).toFixed(2)} m vs h(+4) ${t.height(4, 0).toFixed(2)} m`);
    // The gradient must flip with the mirror, or the normal points the wrong way
    // on one side and the walker is pushed downhill while climbing.
    /* Sample ON a riser, not on a tread — on a tread both gradients are zero and
     * the check passes while comparing nothing, which is what it did for a
     * while. Derive the sample point from the geometry instead of hard-coding
     * it: the first riser spans |x| in [x0, x0 + riserW], and the literal 1.84
     * silently stopped being a riser the moment x0 moved from 1.8 to 0.6. */
    const xr = t.x0 + t.riserW * 0.5;
    const s = new Float64Array(4);
    t.sample(-xr, 0, s); const gLeft = s[1];
    t.sample(xr, 0, s); const gRight = s[1];
    check("terrain: the mirrored slope has a mirrored normal",
        Math.abs(gLeft) > 0.1 && Math.abs(gRight) > 0.1 && gLeft * gRight < 0,
        `normal x-component ${gLeft.toFixed(3)} at x=-${xr.toFixed(3)} vs ${gRight.toFixed(3)} at x=+${xr.toFixed(3)}`);
    /* The pad has to be crossable by the walkers that actually exist. The fleet
     * walks 0.65 m on average; a 1.8 m pad meant the average genome never
     * reached a riser, so stair-climbing could not be selected for at all. */
    check("terrain: the first riser is inside the fleet's walking range",
        t.x0 <= 0.9, `first riser at ${t.x0.toFixed(2)} m from spawn`);

    const offLevel = id => {
        let off = 0, total = 0;
        for (let m = 0; m < 120; m++) {
            const w = new World(HUMANOID, [new Net(NET_SIZES, mulberry32(1))], {
                stage: 4, terrainId: id, terrainDifficulty: 1,
                missionSeed: 1 + m * 37, noiseSeed: 5, noise: false, groundFrac: 0
            });
            while (w.points.length < 5) w._spawnPoint();
            for (const p of w.points) { total++; if (Math.abs(p.y) > 0.05) off++; }
        }
        return off / total;
    };
    for (const id of ["stairs", "rolling", "mixed"]) {
        const frac = offLevel(id);
        check(`terrain: most waypoints on ${id} sit off the level`,
            frac > 0.4, `${(frac * 100).toFixed(0)}% of waypoints have a non-zero ground height`);
    }
    /* THERE IS NO FLAT STAGE ANY MORE. Flat-only training was what produced a
     * fleet scoring 6.75 waypoints on the level and 0.83 on terrain: with the
     * ceiling multiplied by the old competence ramp, the fleet's real setting
     * was 0.018 — 1.8 cm bumps — so the ground it trained on was flat in
     * everything but name. Terrain now starts at stage 1 and grows.
     *
     * Measured on MEAN relief, not the worst waypoint. The worst is a
     * max-of-300 order statistic and swings on a single lucky draw; the same
     * mistake in the training log (best-of-N on a handful of missions) has
     * contradicted the held-out exam four separate times in this project. */
    const reliefStats = stage => {
        let off = 0, total = 0, sum = 0;
        for (let m = 0; m < 60; m++) {
            const w = new World(HUMANOID, [new Net(NET_SIZES, mulberry32(1))],
                { stage, terrainId: "varied", missionSeed: 1 + m * 37, noiseSeed: 5, noise: false, groundFrac: 0 });
            while (w.points.length < 5) w._spawnPoint();
            for (const p of w.points) { total++; if (Math.abs(p.y) > 1e-9) off++; sum += Math.abs(p.y); }
        }
        return { frac: off / total, mean: sum / total };
    };
    const relief = [1, 2, 3, 4, 5].map(reliefStats);
    check("terrain: stage 1 already has real relief to walk on",
        relief[0].frac > 0.5 && relief[0].mean > 0.05,
        `${(relief[0].frac * 100).toFixed(0)}% of stage-1 waypoints off the level, mean ${relief[0].mean.toFixed(3)} m`);
    check("terrain: stage 1 is still the gentlest of them",
        relief[0].mean < relief[4].mean * 0.75,
        `stage 1 mean ${relief[0].mean.toFixed(3)} m vs stage 5 ${relief[4].mean.toFixed(3)} m`);
    check("terrain: the relief grows with every stage",
        relief.every((r, i) => i === 0 || r.mean > relief[i - 1].mean),
        relief.map(r => r.mean.toFixed(3)).join(" -> "));
    /* The per-episode spread is the thing that makes front-loading survivable:
     * one generation has to contain both gentle and rough missions, so a fleet
     * that can only handle gentle ground still has something to be ranked on.
     * If this collapses to a single difficulty, terrain becomes a cliff again. */
    const diffs = new Set();
    for (let m = 0; m < 40; m++) {
        const w = new World(HUMANOID, [new Net(NET_SIZES, mulberry32(1))],
            { stage: 3, terrainId: "mixed", missionSeed: 1 + m * 37, noiseSeed: 5, noise: false, groundFrac: 0 });
        diffs.add(+w.terrain.difficulty.toFixed(3));
    }
    const dv = [...diffs];
    check("terrain: difficulty is drawn per episode, not shared by the fleet",
        dv.length > 20 && Math.min(...dv) < 0.3 && Math.max(...dv) > 0.6,
        `${dv.length} distinct difficulties across 40 missions, ${Math.min(...dv).toFixed(2)}–${Math.max(...dv).toFixed(2)}`);
}

/* ---- 11b-bis. the bank is stratified: same composition, different missions ----
 *
 * The spread across a generation's episodes is deliberate; drawing it
 * independently per episode is what was wrong. Measured on the live champion,
 * an unchanged brain scored 7,786 on one generation's bank and 416 on
 * another's — 18.7x with no weight altered — and that curve is what the trainer
 * was calling "best fitness". These tests pin the property that removes it:
 * every generation must meet the SAME mix, and no generation the same mission.
 */
{
    const E = 7, GENS = 12, BLOCK = 1000000;
    const compose = (g, strat) => {
        const surf = { rolling: 0, stairs: 0, mixed: 0 }, diff = [], yaw = [];
        let ground = 0;
        for (let e = 0; e < E; e++) {
            const m = BLOCK + g * E + e;
            const o = { stage: 2, terrainId: "varied", noise: true, missionSeed: 1 + m * 37, noiseSeed: 5000 + m * 13 };
            if (strat) { o.episodeSlot = e; o.episodeCount = E; }
            const w = new World(HUMANOID, [], o);
            surf[w.terrain.id]++; diff.push(w.terrain.difficulty); yaw.push(w.startYaw);
            if (w.startPose) ground++;
        }
        return { surf, diff, yaw, ground };
    };

    const strat = [], iid = [];
    for (let g = 0; g < GENS; g++) { strat.push(compose(g, true)); iid.push(compose(g, false)); }
    const sig = c => `${c.surf.rolling}/${c.surf.stairs}/${c.surf.mixed}/${c.ground}`;

    const stratSigs = new Set(strat.map(sig)), iidSigs = new Set(iid.map(sig));
    check("bank: every stratified generation meets the same mix of surfaces and floor starts",
        stratSigs.size === 1,
        `${stratSigs.size} distinct compositions over ${GENS} generations — ${[...stratSigs].join(" ")}`);
    /* The control. Without it the test above could pass because the composer is
     * broken and returns the same thing for every input. */
    check("bank: the i.i.d. draw genuinely does not — the test above is measuring something",
        iidSigs.size > 3,
        `${iidSigs.size} distinct compositions over the same ${GENS} generations`);

    // Each slot owns one difficulty band, and the bands tile the range in order.
    let bandOK = true, bandMsg = "";
    for (let e = 0; e < E && bandOK; e++) {
        const ceil = STAGES[1].terrain;                       // stage 2, terrainDifficulty 1
        const lo = ceil * (0.2 + 0.8 * (e / E)), hi = ceil * (0.2 + 0.8 * ((e + 1) / E));
        for (const c of strat) {
            const d = c.diff[e];
            if (d < lo - 1e-9 || d > hi + 1e-9) { bandOK = false; bandMsg = `slot ${e} drew ${d.toFixed(3)} outside [${lo.toFixed(3)}, ${hi.toFixed(3)}]`; break; }
        }
    }
    check("bank: each episode slot stays inside its own difficulty band", bandOK,
        bandMsg || `${E} bands tiling ${(STAGES[1].terrain * 0.2).toFixed(2)}–${STAGES[1].terrain.toFixed(2)}`);

    // Heading is stratified onto a permutation of the bands, not the identity —
    // otherwise the gentlest ground would always be walked on the same bearing.
    const yb = strat[0].yaw.map(y => Math.floor(((y / Math.PI + 1) / 2) * E));
    check("bank: start heading covers every band exactly once, in a different order than difficulty",
        new Set(yb).size === E && yb.some((v, i) => v !== i),
        `slot->heading band ${yb.join(",")}`);

    // Held-out means held out. The old numbering was missionBase = gen, which
    // reaches the exam's 900-990 block around generation 900.
    const EXAM = [900, 907, 913, 921, 934, 947, 955, 962, 969, 976, 983, 990];
    let collide = null;
    for (let g = 0; g < 5000 && !collide; g++)
        for (let e = 0; e < E; e++) if (EXAM.includes(BLOCK + g * E + e)) { collide = g; break; }
    check("bank: no training mission ever collides with the held-out exam", collide === null,
        collide === null ? `5000 generations x ${E} episodes clear of 900–990` : `generation ${collide} trains on an exam mission`);
}

/* ---- 11c. the ground raycast ---- */
{
    const flat = new Terrain("flat", 0, mulberry32(1));
    check("raycast: straight down onto flat ground returns the drop",
        Math.abs(flat.raycast(0, 1.2, 0, 0, -1, 0, 3.5) - 1.2) < 0.02,
        `${flat.raycast(0, 1.2, 0, 0, -1, 0, 3.5).toFixed(3)} m from 1.2 m up`);
    check("raycast: a ray into the sky reports no hit",
        flat.raycast(0, 1.2, 0, 0, 1, 0, 3.5) === 3.5);
    check("raycast: a ray that runs out of range reports no hit, not a wrong hit",
        flat.raycast(0, 3.0, 0, 0, -1, 0, 2.0) === 2.0);

    /* The bug this catches was real and silent: terminating the march on the
     * CAPPED step rather than the true safe distance reported "nothing there"
     * whenever the next stride happened to cross maxD, blinding the sensor to
     * everything in the last stretch of its own range. Against a brute-force
     * march it was 53 cm wrong. So: check against brute force, over rays in
     * every direction, on the roughest ground there is. */
    const st = new Terrain("mixed", 1, mulberry32(9));
    const brute = (ox, oy, oz, dx, dy, dz, maxD) => {
        const N = 20000;
        for (let i = 1; i <= N; i++) {
            const s = i * maxD / N;
            if ((oy + dy * s) - st._hAt(ox + dx * s, oz + dz * s) <= 0) return s;
        }
        return maxD;
    };
    let worst = 0, n = 0;
    const rr = mulberry32(77);
    for (let k = 0; k < 500; k++) {
        const ox = (rr() * 2 - 1) * 5, oz = (rr() * 2 - 1) * 5;
        const oy = st._hAt(ox, oz) + 0.3 + rr() * 1.4;
        const u = rr() * 2 - 1, th = rr() * Math.PI * 2, sn = Math.sqrt(1 - u * u);
        const dx = sn * Math.cos(th), dy = u, dz = sn * Math.sin(th);
        const a = st.raycast(ox, oy, oz, dx, dy, dz, 3.5), b = brute(ox, oy, oz, dx, dy, dz, 3.5);
        // Only count it when the ray is not merely grazing: a near-tangent hit is
        // ambiguous at millimetre scale and is not what this is testing.
        let clr = Infinity;
        for (let i = 0; i <= 300; i++) {
            const s = Math.min(a, b) * i / 300;
            clr = Math.min(clr, (oy + dy * s) - st._hAt(ox + dx * s, oz + dz * s));
        }
        if (clr > 0.03) { n++; worst = Math.max(worst, Math.abs(a - b)); }
    }
    check("raycast: agrees with a brute-force march on rough ground",
        worst < 0.05, `worst ${(worst * 1000).toFixed(0)} mm over ${n} non-grazing rays`);
}

/* ---- 12. speed is a live tie-break, not a dead constant ---- */
{
    // ARRIVE_SPEED decayed over 8 s of absolute leg time while real legs take
    // ~21 s, so max(0, 1 - 21/8) was 0 on every arrival ever scored: the
    // incentive was declared in the ledger and absent from the simulation.
    const speedBonus = (dist, secs) =>
        FIT.ARRIVE_SPEED * Math.min(1, (dist / Math.max(0.25, secs)) / FIT.ARRIVE_SPEED_REF);
    check("speed: a realistic leg earns a real bonus",
        speedBonus(3.0, 20) > 10, `${speedBonus(3.0, 20).toFixed(0)} points for 3 m in 20 s`);
    check("speed: quicker is worth strictly more",
        speedBonus(3.0, 10) > speedBonus(3.0, 20),
        `${speedBonus(3.0, 10).toFixed(0)} vs ${speedBonus(3.0, 20).toFixed(0)}`);
    check("speed: a long leg walked briskly beats a short one dawdled",
        speedBonus(4.0, 12) > speedBonus(1.4, 12),
        `${speedBonus(4.0, 12).toFixed(0)} vs ${speedBonus(1.4, 12).toFixed(0)}`);
    check("speed: it cannot substitute for arriving",
        FIT.ARRIVE_SPEED < FIT.ARRIVE * 0.5,
        `bonus ceiling ${FIT.ARRIVE_SPEED} against arrival ${FIT.ARRIVE}`);
}

/* ---- 13. a fallen walker rests on the floor instead of inside it ---- */
{
    // The chest carried contact points only at z = 0, and z is the chest-width
    // axis, so a walker toppling sideways sank up to 150 mm before anything
    // resisted. Reported as a rendering artefact; it was the physics.
    const iTorso = HUMANOID.bodies.findIndex(b => b.name === "torso");
    const lateral = HUMANOID.contacts.filter(c => c.body === iTorso && Math.abs(c.p[2]) > 0.05);
    check("body: the chest has contact points at its lateral extremes",
        lateral.length >= 2, `${lateral.length} lateral chest points`);
    const armGround = HUMANOID.contacts.filter(c => {
        const n = HUMANOID.bodies[c.body].name;
        return /UpperArm|Forearm/.test(n);
    });
    check("body: the arms can feel the ground",
        armGround.length >= 4, `${armGround.length} arm contact points`);
    // Arms clipped through the ribcage because selfPairs only covered leg vs leg.
    const names = p => [HUMANOID.bodies[p[0].body].name, HUMANOID.bodies[p[1].body].name];
    const armTorso = HUMANOID.selfPairs.filter(p => {
        const [a, b] = names(p);
        return (/UpperArm|Forearm/.test(a) && b === "torso") || (/UpperArm|Forearm/.test(b) && a === "torso");
    });
    check("body: the arms are checked against the chest",
        armTorso.length >= 6, `${armTorso.length} arm-vs-chest sphere pairs`);
}

/* ---- 10. a diverged walker is retired, not believed ---- */
{
    // Finite is not the same as physical. qdd is clamped, so a runaway never
    // goes NaN — a real run reported a walker whose centre of mass reached
    // 7,114 m while it was still "upright" and still being credited with
    // closing on its waypoint, logged as having walked 16.35 m.
    const { world, w } = rig(null, null, {});
    w.timeLeft = 1e9;
    w.mb.bp[1] = 900;                       // put it in orbit
    w.mb.fk();
    let ended = 0;
    for (let i = 0; i < 200 && !w.done; i++) { w.stepPhysics(world, DT); ended = i; }
    check("divergence: a walker flung off the map is retired at once",
        w.done && w.diverged, `done ${w.done} diverged ${w.diverged} after ${ended} ticks`);

    // …and a walker doing something merely athletic is NOT retired
    const { world: w2, w: ok } = rig(M.nominal, M.nominal, {});
    ok.timeLeft = 1e9;
    ok.mb.bp[1] += 0.8;                     // a decent hop
    ok.mb.fk();
    for (let i = 0; i < 400; i++) ok.stepPhysics(w2, DT);
    check("divergence: a hop is not divergence", !ok.diverged);
}

/* ---------------------------------------------------------------- 15. activations
 *
 * The hidden activation is a gene, and the deme machinery is an experiment that
 * only means anything if the demes stay pure. Everything here is about that:
 * the maths of each activation, that the gene survives every way a brain is
 * copied, and that no lrelu brain can ever end up being scored inside the tanh
 * deme. */
{
    // ---- the activations themselves
    {
        const mk = act => {
            const n = new Net([1, 1, 1], null, act);
            // one hidden unit, weight 1 bias 0; output layer weight 1 bias 0
            n.weights[0][0] = 1; n.weights[0][1] = 0;
            n.weights[1][0] = 1; n.weights[1][1] = 0;
            return n;
        };
        // Read the hidden activation back out of the sigmoid: h = logit(out).
        const hidden = (n, x) => { const y = n.forward([x])[0]; return Math.log(y / (1 - y)); };

        const t = mk("tanh"), l = mk("lrelu"), r = mk("relu");
        check("act: tanh squashes a large input", Math.abs(hidden(t, 5) - Math.tanh(5)) < 1e-4,
            `${hidden(t, 5).toFixed(4)} vs ${Math.tanh(5).toFixed(4)}`);
        check("act: relu passes the positive side straight through", Math.abs(hidden(r, 5) - 5) < 1e-3,
            `${hidden(r, 5).toFixed(4)}`);
        check("act: relu zeroes the negative side", Math.abs(hidden(r, -5)) < 1e-3);
        check("act: leaky relu keeps a negative slope — the dead-unit escape",
            Math.abs(hidden(l, -5) - (-5 * LRELU_SLOPE)) < 1e-3,
            `${hidden(l, -5).toFixed(4)} at slope ${LRELU_SLOPE}`);
        /* The point of the whole argument in nn.js: an unbounded activation
         * turns a big weight into a saturated output, i.e. a bang-bang joint
         * setpoint, where a bounded one stays in the graded middle. */
        const bigT = mk("tanh"), bigR = mk("relu");
        bigT.weights[0][0] = 40; bigR.weights[0][0] = 40;
        check("act: relu saturates the output sigmoid where tanh does not",
            bigR.forward([1])[0] > 0.999 && bigT.forward([1])[0] < 0.999,
            `relu ${bigR.forward([1])[0].toFixed(5)} vs tanh ${bigT.forward([1])[0].toFixed(5)}`);
    }

    // ---- the gene survives every way a brain is copied
    {
        const n = new Net(NET_SIZES, mulberry32(3), "lrelu");
        check("act: clone carries the gene", n.clone().act === "lrelu");
        check("act: mutation does not change the gene", n.clone().mutate(0.5, 0.5, mulberry32(1)).act === "lrelu");
        check("act: the gene round-trips through JSON", Net.fromJSON(JSON.parse(JSON.stringify(n.toJSON()))).act === "lrelu");
        /* Every brain saved before the gene existed was evolved under tanh, so
         * reading one back as tanh is a correct reconstruction. If this ever
         * defaulted to something else, every champion file on disk would
         * silently replay as a different network. */
        const legacy = n.toJSON(); delete legacy.act;
        check("act: a brain saved before the gene existed reads back as tanh",
            Net.fromJSON(legacy).act === "tanh");
        const t = new Net(NET_SIZES, mulberry32(4), "tanh");
        check("act: crossing two activations refuses to blend them",
            Net.crossover(n, t, mulberry32(2)).act === "lrelu");
    }

    // ---- the demes stay pure across real generations
    {
        const POP = 36;
        const evo = new Evolution(POP, 11, ["tanh", "lrelu", "relu"]);
        check("demes: the population splits evenly by activation",
            evo.demes.length === 3 && evo.demes.every(d => d.n === 12),
            evo.demes.map(d => `${d.act} x${d.n}`).join(" "));

        const rngF = mulberry32(99);
        // Rig the fitness so lrelu is genuinely and consistently ahead: its
        // block is seats 12..23. Anything else is noise around a lower mean.
        const runGen = () => {
            const res = evo.brains.map((b, i) => ({
                brain: b, fitness: (i >= 12 && i < 24 ? 1000 : 200) + rngF() * 50, arrivals: 0
            }));
            return evo.evolve(res, 0.02, 0.03, 3, { plateauGens: 0, actCull: 20 }, { stage: 1 });
        };
        let pure = true, offsetsOk = true;
        for (let g = 0; g < 12; g++) {
            runGen();
            let off = 0;
            for (const d of evo.demes) {
                for (let i = off; i < off + d.n; i++) if (evo.brains[i].act !== d.act) pure = false;
                off += d.n;
            }
            if (off !== evo.mainCount) offsetsOk = false;
        }
        check("demes: every seat holds a brain of its own deme's activation, generation after generation", pure);
        check("demes: the deme sizes still describe the population layout", offsetsOk);

        const rec = evo.history[evo.history.length - 1];
        check("demes: per-deme scores reach the run log the dashboard reads",
            rec.demes && rec.demes.length === 3 && rec.demes.every(d => typeof d.best === "number"),
            rec.demes ? rec.demes.map(d => `${d.act} ${d.best.toFixed(0)}`).join(" ") : "missing");

        // ---- the cull
        let cullReport = null;
        while (evo.history.length < 20) { runGen(); if (evo.demeEvent) cullReport = evo.demeEvent; }
        runGen();   // the generation that trips it
        if (evo.demeEvent) cullReport = evo.demeEvent;
        check("demes: the cull hands the whole population to the deme that led",
            evo.culled && evo.demes.length === 1 && evo.demes[0].act === "lrelu",
            cullReport || "no cull happened");
        check("demes: after the cull every brain in the population is the winner's activation",
            evo.brains.slice(0, evo.mainCount).every(b => b.act === "lrelu"));
        check("demes: the champion is a brain of the surviving activation",
            evo.champion && evo.champion.act === "lrelu", evo.champion ? evo.champion.act : "none");
        const before = evo.brains.length;
        runGen();
        check("demes: the run keeps its population size through the cull",
            evo.brains.length === before && before === POP, `${before} -> ${evo.brains.length}`);
    }

    /* A single-activation run must be bit-for-bit what the trainer did before
     * demes existed, or every measurement in this project's notes is against a
     * different algorithm than the one now running. */
    {
        const seedRes = (evo, rng) => evo.brains.map(b => ({ brain: b, fitness: rng() * 1000, arrivals: 0 }));
        const runs = [];
        for (let k = 0; k < 2; k++) {
            const evo = new Evolution(24, 1234, ["tanh"]);
            const rng = mulberry32(7);
            for (let g = 0; g < 5; g++) evo.evolve(seedRes(evo, rng), 0.02, 0.03, 3, { plateauGens: 0, actCull: 0 }, { stage: 1 });
            runs.push(evo.brains.map(b => b.weights[0][0]).join(","));
        }
        check("demes: one deme is deterministic and self-consistent", runs[0] === runs[1]);
        check("demes: a single-activation run is all tanh and full size",
            new Evolution(24, 1).brains.every(b => b.act === "tanh"));
    }

    /* ---- interbreeding the two rectifiers ----
     * ReLU and leaky ReLU are the same function on the positive side, so unlike
     * tanh they can genuinely recombine. The slope is per NEURON and rides along
     * with its row, which is what makes a child mixed unit by unit rather than
     * averaged into an activation neither parent had. */
    {
        const r = new Net(NET_SIZES, mulberry32(31), "relu");
        const l = new Net(NET_SIZES, mulberry32(32), "lrelu");
        check("mix: a pure ReLU brain leaks nowhere", r.leakyShare() === 0);
        check("mix: a pure leaky brain leaks everywhere", l.leakyShare() === 1);

        const kid = Net.crossover(r, l, mulberry32(33));
        const share = kid.leakyShare();
        check("mix: crossing the two rectifiers produces a genuinely mixed child",
            share > 0.05 && share < 0.95, `${(share * 100).toFixed(0)}% of hidden units leak`);
        check("mix: a mixed child is labelled as such", kid.act === "mixed", kid.act);
        /* The whole reason this pairing is allowed and tanh's is not. */
        const t = new Net(NET_SIZES, mulberry32(34), "tanh");
        check("mix: tanh still refuses to cross with a rectifier",
            Net.crossover(t, l, mulberry32(35)).leakyShare() === null &&
            Net.crossover(l, t, mulberry32(36)).leakyShare() === 1);

        // The slopes must actually reach forward(), not just be carried around.
        const two = new Net([1, 2, 1], null, "relu");
        two.slopes[0][0] = 0; two.slopes[0][1] = LRELU_SLOPE;
        two.weights[0][0] = 1; two.weights[0][1] = 0;      // unit 0: w=1 b=0
        two.weights[0][2] = 1; two.weights[0][3] = 0;      // unit 1: w=1 b=0
        two.weights[1][0] = 1; two.weights[1][1] = 0; two.weights[1][2] = 0;
        const outA = two.forward([-4])[0];                 // reads unit 0 only (hard)
        two.weights[1][0] = 0; two.weights[1][1] = 1;
        const outB = two.forward([-4])[0];                 // reads unit 1 only (leaky)
        check("mix: two neurons in one net rectify differently",
            Math.abs(outA - 0.5) < 1e-9 && outB < 0.5 - 1e-3,
            `hard ${outA.toFixed(4)} vs leaky ${outB.toFixed(4)}`);

        check("mix: per-neuron slopes round-trip through JSON", (() => {
            const back = Net.fromJSON(JSON.parse(JSON.stringify(kid.toJSON())));
            return back.act === "mixed" && Math.abs(back.leakyShare() - share) < 1e-12;
        })());
        check("mix: clone preserves the exact slope pattern",
            kid.clone().leakyShare() === share && kid.clone().act === "mixed");
        /* A brain saved before slopes existed has to replay identically. */
        const legacy = l.toJSON(); delete legacy.slopes;
        check("mix: a brain saved before slopes existed rebuilds uniform",
            Net.fromJSON(legacy).leakyShare() === 1);
    }

    // ---- the interbreeding pool as the trainer runs it
    {
        const evo = new Evolution(48, 17, ["relu", "lrelu"], { interbreed: true });
        check("mix: interbreeding is one pool, not two demes",
            evo.interbreed && evo.demes.length === 1 && evo.demes[0].n === 48);
        check("mix: the founding pool is an even split of the two rectifiers",
            evo.brains.filter(b => b.act === "relu").length === 24 &&
            evo.brains.filter(b => b.act === "lrelu").length === 24);
        check("mix: tanh cannot be smuggled into an interbreeding pool",
            !new Evolution(12, 1, ["tanh", "relu"], { interbreed: true }).interbreed);

        const rngF = mulberry32(5);
        let rec = null;
        for (let g = 0; g < 15; g++) {
            rec = evo.evolve(evo.brains.map(b => ({ brain: b, fitness: rngF() * 1000, arrivals: 0 })),
                0.02, 0.03, 3, { plateauGens: 0, actCull: 0 }, { stage: 1 });
        }
        check("mix: no tanh brain ever appears in the pool",
            evo.brains.every(b => b.act !== "tanh"),
            evo.brains.filter(b => b.act === "tanh").length + " tanh found");
        check("mix: hybrids actually form under normal breeding",
            evo.brains.some(b => b.act === "mixed"),
            evo.brains.filter(b => b.act === "mixed").length + "/" + evo.brains.length + " mixed");
        check("mix: the leaky share is recorded for the run log",
            rec.leakyShare != null && rec.leakyShare > 0 && rec.leakyShare < 1 && rec.bestLeaky != null,
            `pool ${(rec.leakyShare * 100).toFixed(0)}% best ${(rec.bestLeaky * 100).toFixed(0)}%`);
        check("mix: the pool keeps its size through interbreeding", evo.brains.length === 48);
    }

    /* ---- a pure ReLU run must stay pure ----
     * There are three ways a leaky unit could get in — an immigrant born with
     * the wrong slope, a slope-flip mutation, or crossover importing one — and
     * "no leaky anywhere" is only true if all three are shut. Checked over a
     * long run at a deliberately savage mutation rate, because a rate that high
     * is where a stray flip would show up fastest. */
    {
        const evo = new Evolution(40, 23, ["relu"]);
        check("pure: a relu-only run does not enable the slope flip", slopeFlip() === 0);
        const rng = mulberry32(8);
        for (let g = 0; g < 60; g++) {
            evo.evolve(evo.brains.map(b => ({ brain: b, fitness: rng() * 1000, arrivals: 0 })),
                0.25, 0.30, 3, { plateauGens: 0, actCull: 0 }, { stage: 1 });
        }
        let leaked = 0;
        for (const b of evo.brains) if (b.leakyShare() !== 0) leaked++;
        check("pure: not one leaky unit appears in 60 generations of a relu-only run",
            leaked === 0, `${leaked}/${evo.brains.length} brains carry a leaky unit`);
        check("pure: every brain is still labelled relu", evo.brains.every(b => b.act === "relu"));
    }

}

/* ------------------------------------------------ 16. per-surface normalisation
 *
 * The measured problem: rolling is 37% of the bank and 89% of the fitness, and
 * more importantly it is nearly all of the VARIANCE, so a real improvement on
 * stairs is smaller than the noise on rolling and cannot be selected for. These
 * check that the fix does what it claims and does not break the cases where it
 * should do nothing. */
{
    const SURF = ["rolling", "stairs", "mixed", "rolling", "stairs", "mixed"];
    /* Three brains. A is a rolling specialist, B is identical on rolling but
     * genuinely better on stairs, C is average. Under a plain mean, B's stairs
     * advantage is swamped; that is the whole bug. */
    const A = [9000, 100, 120, 11000, 110, 130];
    const B = [9000, 900, 120, 11000, 950, 130];
    const C = [5000, 100, 120, 6000, 110, 130];
    const plain = [A, B, C].map(r => r.reduce((s, v) => s + v, 0) / r.length);
    const norm = normaliseBySurface([A, B, C], SURF);

    /* The quantity that matters is not the absolute gain but the gain RELATIVE
     * to the spread on rolling — that ratio is what decides whether selection
     * can tell a stairs improvement from rolling's mission luck. A fixed
     * multiplier would have been an arbitrary number to assert; this is the
     * property the function exists to change. */
    const ratio = (a) => (a[1] - a[0]) / Math.abs(a[0] - a[2]);
    check("surface: under a plain mean a big stairs gain is worth far less than rolling noise",
        ratio(plain) < 0.25,
        `stairs gain ${(plain[1] - plain[0]).toFixed(0)} against a rolling spread of ${(plain[0] - plain[2]).toFixed(0)} — ratio ${ratio(plain).toFixed(2)}`);
    check("surface: normalised, the same stairs gain competes with rolling on equal terms",
        ratio(norm) > 0.8 && ratio(norm) / ratio(plain) > 3,
        `ratio ${ratio(plain).toFixed(2)} -> ${ratio(norm).toFixed(2)}, a ${(ratio(norm) / ratio(plain)).toFixed(1)}x reweighting`);
    check("surface: the better walker still ranks above the worse one",
        norm[1] > norm[0] && norm[0] > norm[2]);
    /* Units must survive: the immigrant and crossover gates compare the champion
     * against absolute thresholds, so a z-score would silently disable both. */
    check("surface: the output stays in fitness units, not standard deviations",
        Math.abs(norm.reduce((s, v) => s + v, 0) / 3 - plain.reduce((s, v) => s + v, 0) / 3) < 1e-6,
        `normalised mean ${(norm.reduce((s, v) => s + v, 0) / 3).toFixed(0)} vs raw ${(plain.reduce((s, v) => s + v, 0) / 3).toFixed(0)}`);

    // Cases where it must be a no-op or must not explode.
    const one = ["rolling", "rolling", "rolling"];
    const r1 = [[100, 200, 300], [400, 500, 600]];
    check("surface: a single-surface bank is exactly the plain mean",
        JSON.stringify(normaliseBySurface(r1, one)) === JSON.stringify(r1.map(r => (r[0] + r[1] + r[2]) / 3)));
    // Brains score 10 / 90 / 50 on rolling and tie at 5 on stairs, so the
    // ranking must come from rolling alone: 90 > 50 > 10, and no infinities
    // from dividing by the tied surface's zero spread.
    const flat = normaliseBySurface([[10, 5], [90, 5], [50, 5]], ["rolling", "stairs"]);
    check("surface: a surface every brain ties on cannot be amplified into the ranking",
        flat.every(v => isFinite(v)) && flat[1] > flat[2] && flat[2] > flat[0],
        JSON.stringify(flat.map(v => +v.toFixed(1))));
    check("surface: no surfaces at all falls back to the plain mean",
        normaliseBySurface([[4, 6]], [])[0] === 5);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

