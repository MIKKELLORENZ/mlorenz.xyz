/* test_headless.js — Node smoke test. Run: node test_headless.js
 *
 * Checks the things that were actually wrong at some point while building this,
 * which is the only kind of test worth keeping:
 *
 *   1. quaternion maths (round trip, norm, the direction a rotation goes)
 *   2. the room: ray casts through gaps, clearance, waypoint placement
 *   3. flight physics — hover holds, free fall falls, and each rotor mix
 *      produces the axis it is supposed to
 *   4. the sensor block: sizes, the lag window, body-frame waypoint vector
 *   5. the pad / armed latch, and that a wall is instant death
 *   6. the fitness function's incentives, as arithmetic rather than hope
 *   7. determinism — two runs of the same seeds must agree exactly
 *   8. that evolution runs, ratchets, and serialises
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "room.js", "drone.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

let failures = 0;
function check(name, ok, extra) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* A stand-in brain that always issues the same four rotor commands, so physics
 * can be tested without a network in the loop. */
class FixedBrain {
    constructor(cmd) { this.cmd = Float32Array.from(cmd); }
    forward() { return this.cmd; }
}
const HOVER = (DRONE.MASS * G) / (4 * DRONE.TMAX);       // throttle that exactly holds

/* Fly one drone with a fixed command for `secs`, no room hazards in the way. */
function rig(cmd, secs, opts) {
    const room = new Room(roomById((opts && opts.room) || "hall"));
    const w = new World(room, [new FixedBrain(cmd)], Object.assign(
        { missionSeed: 3, noiseSeed: 3, noise: false, turbulence: 0 }, opts || {}));
    const d = w.drones[0];
    if (opts && opts.start) { d.pos.set(opts.start); d.armed = true; }
    if (opts && opts.primeSpin) d.spin.fill(cmd[0]);      // skip the spin-up transient
    const n = Math.round(secs / DT);
    for (let i = 0; i < n && d.alive; i++) w.step();
    return { d, w };
}

/* ------------------------------------------------------- 1. quaternions */
{
    const q = new Float64Array([1, 0, 0, 0]);
    const out = new Float64Array(3);
    qRot(q, 1, 2, 3, out);
    check("identity quaternion is a no-op", near(out[0], 1, 1e-12) && near(out[1], 2, 1e-12) && near(out[2], 3, 1e-12));

    // 90° about +y: +z should go to +x  (about y: z→x, x→−z)
    const s = Math.SQRT1_2;
    const qy = new Float64Array([s, 0, s, 0]);
    qRot(qy, 0, 0, 1, out);
    check("yaw 90° about +y sends +z to +x", near(out[0], 1, 1e-9) && near(out[2], 0, 1e-9),
        `got (${out[0].toFixed(3)}, ${out[1].toFixed(3)}, ${out[2].toFixed(3)})`);

    qRotInv(qy, out[0], out[1], out[2], out);
    check("qRotInv undoes qRot", near(out[2], 1, 1e-9) && near(out[0], 0, 1e-9));

    // integrating a constant body rate about +y for a quarter turn
    const qi = new Float64Array([1, 0, 0, 0]);
    const rate = Math.PI / 2, dt = 1e-4;
    for (let i = 0; i < 1 / dt; i++) qIntegrate(qi, 0, rate, 0, dt);
    qRot(qi, 0, 0, 1, out);
    check("integrating ω=(0,π/2,0) for 1 s yaws 90°", near(out[0], 1, 2e-3),
        `+z ended at (${out[0].toFixed(4)}, ${out[1].toFixed(4)}, ${out[2].toFixed(4)})`);
    check("integration keeps the quaternion unit", near(Math.hypot(qi[0], qi[1], qi[2], qi[3]), 1, 1e-9));
}

/* ------------------------------------------------------------- 2. the room */
{
    const hall = new Room(roomById("hall"));
    check("ray up hits the ceiling", near(hall.rayDist(13, 4, 9, 0, 1, 0, 100), 4, 1e-9));
    check("ray down hits the floor", near(hall.rayDist(13, 4, 9, 0, -1, 0, 100), 4, 1e-9));
    check("ray +x hits the far wall", near(hall.rayDist(13, 4, 9, 1, 0, 0, 100), 13, 1e-9));
    check("rays clamp to sensor range", near(hall.rayDist(13, 4, 9, 1, 0, 0, 5), 5, 1e-9));

    const wh = new Room(roomById("warehouse"));
    // the first partition has a door gap at z 7.4..10.6 — at z=9 the ray flies
    // through it and only stops at the second partition (x=16.7)
    check("ray threads the warehouse door gap",
        near(wh.rayDist(2.8, 1.0, 9, 1, 0, 0, 100), 16.7 - 2.8, 1e-6),
        `got ${wh.rayDist(2.8, 1.0, 9, 1, 0, 0, 100).toFixed(3)}`);
    // off to the side of the gap it stops at the first partition
    check("ray stops at the partition beside the gap",
        near(wh.rayDist(2.8, 1.0, 3, 1, 0, 0, 100), 7.9 - 2.8, 1e-6),
        `got ${wh.rayDist(2.8, 1.0, 3, 1, 0, 0, 100).toFixed(3)}`);

    check("clearance inside a pillar is zero",
        new Room(roomById("pillars")).clearance(5.9, 4, 4.1, true) === 0);
    check("floor clearance is ignored before takeoff",
        hall.clearance(13, 0.05, 9, false) > 0.5 && hall.clearance(13, 0.05, 9, true) < 0.1);
    check("a sphere against a wall registers a hit",
        hall.hits(0.1, 4, 9, DRONE.RADIUS, true) && !hall.hits(13, 4, 9, DRONE.RADIUS, true));

    // waypoints must land in real air, in every room
    const rng = mulberry32(11);
    let bad = 0, far = 0, prev = null;
    for (let i = 0; i < 200; i++) {
        const wp = sampleWaypoint(wh, rng, prev, 8, 1.6);
        if (wh.clearance(wp[0], wp[1], wp[2], true) < 1.6) bad++;
        if (wp[0] < 0 || wp[0] > wh.W || wp[1] < 0 || wp[1] > wh.H || wp[2] < 0 || wp[2] > wh.D) far++;
        prev = wp;
    }
    check("sampled waypoints always have air around them", bad === 0, `${bad}/200 too tight`);
    check("sampled waypoints are inside the room", far === 0, `${far}/200 outside`);

    check("line of sight is blocked by a partition",
        !wh.losClear(2.8, 1, 3, 20, 1, 3) && wh.losClear(2.8, 1, 9, 15, 1, 9));

    // swept-sphere inflation: the reading is where a sphere of that radius
    // makes contact, not where a dimensionless point would arrive
    check("inflation reports the contact distance, not the surface distance",
        near(hall.rayDist(13, 4, 9, 1, 0, 0, 100, 0.22), 13 - 0.22, 1e-9));
    check("inflation grows obstacles as well as walls",
        near(new Room(roomById("pillars")).rayDist(2, 4, 4.1, 1, 0, 0, 100, 0.3),
             5.2 - 2 - 0.3, 1e-9));

    // beam directions: axis first, then a ring, all unit length
    const beams = sensorBeams(8, 4, 0.3);
    check("sensorBeams returns n × samples unit directions", beams.length === 8 * 4 * 3);
    let unit = true, axisFirst = true;
    const axes = fibSphere(8);
    for (let i = 0; i < 8; i++) {
        for (let s = 0; s < 4; s++) {
            const k = (i * 4 + s) * 3;
            if (Math.abs(Math.hypot(beams[k], beams[k + 1], beams[k + 2]) - 1) > 1e-9) unit = false;
        }
        const k = i * 4 * 3;
        if (Math.abs(beams[k] - axes[i * 3]) > 1e-12) axisFirst = false;
    }
    check("every beam direction is a unit vector", unit);
    check("each sensor's first sample is its axis", axisFirst);
    // the ring really is off-axis by the half-angle
    const off = beams[3] * beams[0] + beams[4] * beams[1] + beams[5] * beams[2];
    check("the ring sits at the requested half-angle", near(Math.acos(off), 0.3, 1e-9));
}

/* ------------------------------------------------------------ 3. flight */
{
    // hover: with the rotors already at speed, the hover throttle holds
    // altitude exactly — thrust and weight cancel and nothing else acts
    const { d } = rig([HOVER, HOVER, HOVER, HOVER], 4, { start: [13, 4, 9], primeSpin: true });
    check("hover throttle holds altitude", d.alive && near(d.pos[1], 4, 0.01),
        `y = ${d.pos[1].toFixed(4)} after 4 s`);
    check("hover stays level", Math.hypot(d.omega[0], d.omega[1], d.omega[2]) < 1e-6,
        `|ω| = ${Math.hypot(d.omega[0], d.omega[1], d.omega[2]).toExponential(2)}`);

    // …and from a standing start it sags, because a fixed throttle cancels the
    // *acceleration* but not the velocity the spin-up transient handed it: the
    // only thing pulling that back out is drag, whose time constant is
    // MASS/CD_LIN ≈ 6.7 s. Holding altitude is a closed-loop job, and this is
    // the residual the evolved policy actually has to learn to null.
    const sag = rig([HOVER, HOVER, HOVER, HOVER], 4, { start: [13, 4, 9] });
    check("open-loop hover sags — altitude hold needs feedback",
        sag.d.pos[1] < 3.9 && sag.d.pos[1] > 2.0,
        `y = ${sag.d.pos[1].toFixed(3)} after 4 s from a standing start`);

    // sigmoid(0) = 0.5 on all four rotors must be a *climb*, or a fresh random
    // brain never gets off the pad and generation 1 has nothing to rank
    check("half throttle is a gentle climb (fresh-brain bootstrap)",
        4 * 0.5 * DRONE.TMAX > DRONE.MASS * G,
        `${(4 * 0.5 * DRONE.TMAX).toFixed(2)} N vs ${(DRONE.MASS * G).toFixed(2)} N of weight`);

    // free fall
    const ff = rig([0, 0, 0, 0], 0.5, { start: [13, 6, 9] });
    check("zero throttle is free fall", near(ff.d.pos[1], 6 - 0.5 * G * 0.25, 0.15),
        `y = ${ff.d.pos[1].toFixed(3)}, expected ≈ ${(6 - 0.5 * G * 0.25).toFixed(3)}`);

    // pitch: front rotors (0 and 2, at +z) harder → nose up
    const pitch = rig([HOVER + 0.1, HOVER - 0.1, HOVER + 0.1, HOVER - 0.1], 0.4, { start: [13, 5, 9] });
    const fwd = new Float64Array(3);
    qRot(pitch.d.q, 0, 0, 1, fwd);
    check("front rotors pitch the nose up", fwd[1] > 0.05, `nose y = ${fwd[1].toFixed(3)}`);

    // roll: right-side rotors (0 and 3, at +x) harder → right side rises
    const roll = rig([HOVER + 0.1, HOVER - 0.1, HOVER - 0.1, HOVER + 0.1], 0.4, { start: [13, 5, 9] });
    const right = new Float64Array(3);
    qRot(roll.d.q, 1, 0, 0, right);
    check("right-side rotors roll the right side up", right[1] > 0.05, `right y = ${right[1].toFixed(3)}`);

    // yaw: the CCW pair (0 and 1) harder → rotation about +y, no tilt
    const yaw = rig([HOVER + 0.1, HOVER + 0.1, HOVER - 0.1, HOVER - 0.1], 0.4, { start: [13, 5, 9] });
    const up = new Float64Array(3);
    qRot(yaw.d.q, 0, 1, 0, up);
    check("the diagonal pair yaws without tilting",
        yaw.d.omega[1] > 0.2 && up[1] > 0.999,
        `ω_y = ${yaw.d.omega[1].toFixed(3)}, up·y = ${up[1].toFixed(5)}`);

    // a drone at rest on the pad with no throttle must simply sit there
    const idle = rig([0, 0, 0, 0], 2);
    check("no throttle leaves the drone on the pad",
        idle.d.alive && !idle.d.armed && near(idle.d.pos[1], DRONE.RADIUS, 1e-6));
}

/* --------------------------------------------------- 4. the sensor block */
{
    const expect = Array.from(DEPTH).reduce((a, b) => a + b, 0);
    check("NIN matches the sum of the per-channel depths", NIN === expect && NET_SIZES[0] === NIN,
        `NIN = ${NIN}`);
    check("the lag table is ten slots, dense at the front",
        LAGS.length === 10 && LAGS[0] === 0 && LAGS[1] === 1 && LAGS[9] === 30,
        `LAGS = [${LAGS}]`);
    check("no channel asks for more slots than exist",
        Array.from(DEPTH).every(d => d >= 1 && d <= LAGS.length));

    const room = new Room(roomById("hall"));
    const w = new World(room, [new FixedBrain([HOVER, HOVER, HOVER, HOVER])],
        { missionSeed: 5, noiseSeed: 5, noise: false, turbulence: 0 });
    const d = w.drones[0];
    // point the drone at a known target and read the body-frame channels back
    d.pos.set([13, 4, 9]);
    d.q.set([1, 0, 0, 0]);                       // nose along +z
    d.setTarget([13, 4, 15], 0);                 // 6 m straight ahead
    d.control(w);
    const inp = d.inputs;
    check("waypoint vector points straight out the nose",
        near(inp[38], 0, 1e-6) && near(inp[39], 0, 1e-6) && near(inp[40], 1, 1e-6),
        `(${inp[38].toFixed(3)}, ${inp[39].toFixed(3)}, ${inp[40].toFixed(3)})`);
    check("heading error is zero when the nose is on the target",
        near(inp[42], 0, 1e-6) && near(inp[43], 1, 1e-6) && near(inp[44], 0, 1e-6));
    check("distance channel scales as expected", near(inp[41], 6 / 20, 1e-6));
    check("gravity reads straight down the belly when level",
        near(inp[49], 0, 1e-6) && near(inp[50], -1, 1e-6) && near(inp[51], 0, 1e-6));
    check("sensor 0 looks up and reads the ceiling",
        near(inp[0], 1 - (4 - DRONE.RADIUS) / DRONE.SENSOR_RANGE, 0.05),
        `inp[0] = ${inp[0].toFixed(3)}`);

    /* The regression that mattered most. On the old pencil-ray model a drone
     * closing on a pillar saw NOTHING until about 4 m, and even head-on at
     * 0.7 m only two of thirty-two rays clipped it — so no policy could learn
     * to avoid one, and stage 1 never got off the ground. The sensors are cones
     * now: a pillar must be visible from well out, and the reading must fall
     * smoothly as the drone closes, or the avoidance problem is unlearnable
     * again and nothing else in this file will tell you. */
    {
        const pr = new Room(roomById("pillars"));
        const pw = new World(pr, [new FixedBrain([0, 0, 0, 0])],
            { missionSeed: 1, noiseSeed: 1, noise: false, turbulence: 0 });
        const pd = pw.drones[0];
        const readAt = gap => {
            pd.pos.set([10.1 - gap, 4.0, 9.0]);       // middle pillar spans x 10.1–11.5
            pd.q.set([1, 0, 0, 0]);
            pd.target = null;
            pd.control(pw);
            let best = 0;
            for (let i = 0; i < DRONE.SENSOR_N; i++) {
                if (SENSOR_DIRS[i * BEAM_STRIDE] > 0.5 && pd.rays[i] > best) best = pd.rays[i];
            }
            return (1 - best) * DRONE.SENSOR_RANGE;   // metres to contact, forward
        };
        const r4 = readAt(4), r3 = readAt(3), r2 = readAt(2), r1 = readAt(1);
        check("a pillar is visible several metres out", r4 < 4.2,
            `at a 4 m gap the forward beams report ${r4.toFixed(2)} m`);
        check("the reading closes smoothly as the drone approaches",
            r4 > r3 && r3 > r2 && r2 > r1,
            `${r4.toFixed(2)} > ${r3.toFixed(2)} > ${r2.toFixed(2)} > ${r1.toFixed(2)}`);
        check("the reading is the contact distance, one radius short of the face",
            near(r2, 2 - DRONE.RADIUS, 0.06), `${r2.toFixed(2)} m at a 2 m gap`);
    }

    // a target 90° to port must show up on the heading channels, not just the
    // vector — this is the pair that a P-only controller reads
    d.setTarget([7, 4, 9], 0);
    d.control(w);
    check("a target to port reads sin(err) = −1",
        near(d.inputs[42], -1, 1e-6) && near(d.inputs[43], 0, 1e-6),
        `sin ${d.inputs[42].toFixed(3)} cos ${d.inputs[43].toFixed(3)}`);

    // the deep lag slots must actually carry history, not repeats of now
    const w2 = new World(room, [new FixedBrain([0.6, 0.6, 0.6, 0.6])],
        { missionSeed: 9, noiseSeed: 9, noise: false, turbulence: 0 });
    const d2 = w2.drones[0];
    for (let i = 0; i < 120 * 3; i++) w2.step();          // 3 s of climb
    const off0 = NC;                                     // start of lag slot 1
    let lagDiffers = false;
    for (let s = 1; s < LAGS.length; s++) {
        let k = NC;
        for (let sl = 1; sl < s; sl++) for (let ch = 0; ch < NC; ch++) if (DEPTH[ch] > sl) k++;
        // channel 50 (belly gravity) is deep; channel 41 (distance) changes fast
        if (DEPTH[41] > s) {
            let idx = k;
            for (let ch = 0; ch < 41; ch++) if (DEPTH[ch] > s) idx++;
            if (Math.abs(d2.inputs[idx] - d2.inputs[41]) > 1e-4) lagDiffers = true;
        }
    }
    check("deeper lag slots hold older values", lagDiffers && off0 > 0);
}

/* ------------------------------------------- 5. the pad and instant death */
{
    // climbing past TAKEOFF_H latches `armed`, after which the floor is lethal
    const { d } = rig([0.75, 0.75, 0.75, 0.75], 1.2);
    check("climbing past the takeoff height arms the drone", d.armed && d.pos[1] > DRONE.TAKEOFF_H,
        `y = ${d.pos[1].toFixed(2)}`);

    const room = new Room(roomById("hall"));
    const w = new World(room, [new FixedBrain([0, 0, 0, 0])],
        { missionSeed: 1, noiseSeed: 1, noise: false, turbulence: 0 });
    const dd = w.drones[0];
    dd.pos.set([13, 3, 9]); dd.armed = true;
    let ticks = 0;
    while (dd.alive && ticks++ < 120 * 5) w.step();
    check("an armed drone dies on the floor", !dd.alive && dd.crashed,
        `after ${(ticks * DT).toFixed(2)} s`);

    // and on a wall
    const w2 = new World(room, [new FixedBrain([0.55, 0.55, 0.55, 0.55])],
        { missionSeed: 1, noiseSeed: 1, noise: false, turbulence: 0 });
    const d2 = w2.drones[0];
    d2.pos.set([0.6, 4, 9]); d2.vel.set([-4, 0, 0]); d2.armed = true;
    ticks = 0;
    while (d2.alive && ticks++ < 120 * 3) w2.step();
    check("a wall is instant elimination", !d2.alive && d2.crashed && d2.done);

    // a pillar counts too
    const pr = new Room(roomById("pillars"));
    const w3 = new World(pr, [new FixedBrain([0.55, 0.55, 0.55, 0.55])],
        { missionSeed: 1, noiseSeed: 1, noise: false, turbulence: 0 });
    const d3 = w3.drones[0];
    d3.pos.set([8.5, 4, 9]); d3.vel.set([3, 0, 0]); d3.armed = true;
    ticks = 0;
    while (d3.alive && ticks++ < 120 * 3) w3.step();
    check("a pillar is instant elimination", !d3.alive && d3.crashed);
}

/* --------------------------------------------------- 6. fitness incentives */
{
    const mk = () => new Drone(new FixedBrain([0, 0, 0, 0]), 0);

    // a drone that hovers for its whole clock and never approaches anything
    const hoverer = mk();
    hoverer.reset(13, DRONE.RADIUS, 9, 0);
    hoverer.armed = true; hoverer.airTime = 60;            // way past the cap
    hoverer.setTarget([20, 4, 9], 0);
    hoverer.bestDist = hoverer.legInitDist;                 // never got closer
    const fHover = hoverer.fitness();
    check("airtime is capped well below one waypoint",
        fHover <= DRONE.AIR_CAP + DRONE.TAKEOFF_BONUS + 1e-6,
        `hoverer scores ${fHover.toFixed(0)}`);

    // one waypoint reached
    const arriver = mk();
    arriver.reset(13, DRONE.RADIUS, 9, 0);
    arriver.armed = true; arriver.airTime = 8;
    arriver.fitScore = DRONE.WP_REWARD + DRONE.PROGRESS_W;
    arriver.setTarget([20, 4, 9], 0);
    arriver.bestDist = arriver.legInitDist;
    check("one waypoint beats any amount of hovering", arriver.fitness() > fHover * 3,
        `${arriver.fitness().toFixed(0)} vs ${fHover.toFixed(0)}`);

    const idler = mk();
    idler.reset(13, DRONE.RADIUS, 9, 0);
    idler.setTarget([20, 4, 9], 0);
    idler.bestDist = idler.legInitDist;

    // Getting airborne and crashing must beat never leaving the pad. This is
    // deliberate and it is the single most important sign in the ledger: with
    // it inverted, generation 1 learns that the safest thing a drone can do is
    // sit still, and a population that never flies has no gradient to climb.
    const crasher = mk();
    crasher.reset(13, DRONE.RADIUS, 9, 0);
    crasher.armed = true; crasher.crashed = true; crasher.airTime = 0.4;
    crasher.setTarget([20, 4, 9], 0);
    crasher.bestDist = crasher.legInitDist;
    check("taking off and crashing still beats never leaving the pad",
        crasher.fitness() > idler.fitness(),
        `${crasher.fitness().toFixed(0)} vs ${idler.fitness().toFixed(0)}`);

    // …but at equal airtime, surviving must always beat crashing, or the
    // deterrent is gone entirely
    const survivor = mk();
    survivor.reset(13, DRONE.RADIUS, 9, 0);
    survivor.armed = true; survivor.airTime = 0.4;
    survivor.setTarget([20, 4, 9], 0);
    survivor.bestDist = survivor.legInitDist;
    check("at equal airtime, surviving beats crashing",
        near(survivor.fitness() - crasher.fitness(), DRONE.CRASH_PEN, 1e-6));
    check("a full clock of clean hovering beats a quick crash",
        fHover > crasher.fitness() * 3);

    // a crash AFTER real work still beats a clean idle: the deterrent is the
    // forfeited future, not a penalty that dwarfs everything earned
    const veteran = mk();
    veteran.reset(13, DRONE.RADIUS, 9, 0);
    veteran.armed = true; veteran.crashed = true; veteran.airTime = 20;
    veteran.fitScore = 2 * DRONE.WP_REWARD;
    veteran.setTarget([20, 4, 9], 0);
    veteran.bestDist = veteran.legInitDist;
    check("two waypoints then a crash beats a timid idle",
        veteran.fitness() > idler.fitness() && veteran.fitness() > fHover);

    // closest approach, not current distance: drifting back out earns nothing
    const approacher = mk();
    approacher.reset(13, DRONE.RADIUS, 9, 0);
    approacher.armed = true;
    approacher.setTarget([13, 4, 19], 0);
    approacher.bestDist = 2;                                 // got to within 2 m
    const drifted = mk();
    drifted.reset(13, DRONE.RADIUS, 9, 0);
    drifted.armed = true;
    drifted.setTarget([13, 4, 19], 0);
    drifted.bestDist = 2;
    drifted.legDist = 200;                                   // same approach, then wandered
    check("progress is the closest approach, not where the drone ended up",
        near(drifted.fitness(), approacher.fitness(), 1e-9));

    // …and the wandering IS charged for, but only on a leg actually completed
    const room = new Room(roomById("hall"));
    const bank = (legDist) => {
        const w = new World(room, [new FixedBrain([0, 0, 0, 0])],
            { missionSeed: 1, noiseSeed: 1, noise: false, turbulence: 0 });
        const d = w.drones[0];
        d.setTarget([13, 4, 19], 0);          // 10 m leg from the pad
        d.legDist = legDist;
        w.time = 1;
        w._arrive(d);
        return d.fitScore;
    };
    const direct = bank(11), weaving = bank(60), wild = bank(5000);
    check("a completed leg is charged for distance beyond what it needed",
        weaving < direct - 50, `${weaving.toFixed(0)} vs ${direct.toFixed(0)} direct`);
    check("the efficiency charge is capped so one bad leg can't dominate",
        wild > direct - DRONE.EFF_CAP - 1 && wild < weaving);
    check("even the worst leg still nets a positive waypoint reward", wild > 0,
        `${wild.toFixed(0)}`);
    check("reaching a waypoint tops up the clock",
        (() => {
            const w = new World(room, [new FixedBrain([0, 0, 0, 0])],
                { missionSeed: 1, noiseSeed: 1, noise: false, turbulence: 0 });
            const d = w.drones[0];
            const before = d.timeLeft;
            w._arrive(d);
            return d.timeLeft > before && d.arrivals === 1 && d.target !== null;
        })());

    // the design invariant that closed the ground-effect exploit: a drone still
    // inside ground effect physically cannot touch the lowest possible waypoint
    check("no waypoint is reachable from below the arming height",
        WP_FLOOR - DRONE.TAKEOFF_H > DRONE.WP_RADIUS,
        `gap ${(WP_FLOOR - DRONE.TAKEOFF_H).toFixed(2)} m vs ${DRONE.WP_RADIUS} m arrival radius`);
    const wh = new Room(roomById("warehouse"));
    const rng2 = mulberry32(21);
    let low = 0, prev2 = null;
    for (let i = 0; i < 150; i++) {
        const wp = sampleWaypoint(wh, rng2, prev2, 8, 1.6);
        if (wp[1] < WP_FLOOR) low++;
        prev2 = wp;
    }
    check("waypoints are never placed in ground effect", low === 0, `${low}/150 too low`);
}

/* ------------------------------------------------ 7. episodes + determinism */
{
    const room = new Room(roomById("hall"));
    const rng = mulberry32(4);
    const nets = [];
    for (let i = 0; i < 6; i++) nets.push(new Net(NET_SIZES, rng));
    const opts = { missionSeed: 12, noiseSeed: 12, noise: true, turbulence: 0.3 };
    const a = runEpisode(room, nets, opts);
    const b = runEpisode(room, nets, opts);
    check("an episode terminates and scores everyone",
        a.length === 6 && a.every(r => Number.isFinite(r.fitness)));
    check("episodes are deterministic given the seeds",
        a.every((r, i) => r.fitness === b[i].fitness && r.arrivals === b[i].arrivals));

    // The bootstrap property the TMAX gearing and the near-zero output init
    // exist to buy: a brand-new random brain must LEAVE THE GROUND. Measured on
    // peak altitude rather than the `armed` flag, because arming is a
    // policy-relevant threshold (1.2 m) that a fresh brain may tumble before
    // reaching — what matters here is only that the default command is a climb.
    const rng2 = mulberry32(77);
    const fresh = [];
    for (let i = 0; i < 24; i++) fresh.push(new Net(NET_SIZES, rng2));
    const r = runEpisode(room, fresh, { missionSeed: 2, noiseSeed: 2, noise: false, turbulence: 0 });
    const flew = r.filter(x => x.peakY > 0.6).length / r.length;
    check("fresh random brains leave the ground", flew > 0.8,
        `${(flew * 100).toFixed(0)}% climbed past 0.6 m`);
    const meanPeak = r.reduce((s, x) => s + x.peakY, 0) / r.length;
    check("the default command is a climb, not a sit", meanPeak > 1.0,
        `mean peak ${meanPeak.toFixed(2)} m`);
    // and a decent share survive long enough to arm, so airtime is on the table
    const offFrac = r.reduce((s, x) => s + x.tookOff, 0) / r.length;
    check("some fresh brains survive long enough to arm", offFrac > 0.25,
        `${(offFrac * 100).toFixed(0)}% reached ${DRONE.TAKEOFF_H} m`);

    // every drone in an episode must fly the identical exam
    const w = new World(room, fresh, { missionSeed: 2, noiseSeed: 2, noise: false, turbulence: 0 });
    check("the fleet shares one spawn and one waypoint chain",
        w.drones.every(d => d.pos[0] === w.drones[0].pos[0] && d.target === w.drones[0].target));
}

/* ------------------------------------------------ 8. evolution + ratchet */
{
    const evo = new Evolution(12, 7);
    let last = null;
    for (let g = 0; g < 4; g++) {
        const results = evo.brains.map(b => ({
            brain: b, fitness: evo.rng() * 1000, arrivals: evo.rng() * 2
        }));
        const top = results.slice().sort((x, y) => y.fitness - x.fitness)[0];
        last = evo.evolve(results, 0.1, 0.09, 3, {}, { stage: 0 });
        check(`gen ${g + 1}: the best brain survives untouched`,
            evo.brains[0].weights[0].every((v, i) => v === top.brain.weights[0][i]));
    }
    check("evolution keeps the population size", evo.brains.length === 12);
    check("history records every generation", evo.history.length === 4 && last.gen === 4);

    /* Crossing a stage boundary must reset the recorded champion fitness.
     * Scores are not comparable across environments: a brain worth 9,600 in the
     * Empty Hall is worth a few hundred in the Pillar Field, so carrying the old
     * number over freezes `champion` on the stage-0 brain forever and every
     * checkpoint the run writes from then on is the wrong net. */
    {
        const e = new Evolution(8, 3);
        const mk = fit => e.brains.map((b, i) => ({ brain: b, fitness: i === 0 ? fit : 0, arrivals: 0 }));
        e.evolve(mk(9000), 0.1, 0.09, 0, {}, { stage: 0 });
        check("champion is recorded within a stage", near(e.championFit, 9000, 1e-6));
        e.evolve(mk(4000), 0.1, 0.09, 0, {}, { stage: 0 });
        check("a worse generation in the same stage does not take the title",
            near(e.championFit, 9000, 1e-6));
        const before = e.champion;
        e.evolve(mk(400), 0.1, 0.09, 0, {}, { stage: 1 });
        check("a stage change resets the champion fitness and re-measures",
            near(e.championFit, 400, 1e-6) && e.champion !== before,
            `championFit = ${e.championFit}`);
        check("the stage change is announced", /champion fitness reset/.test(e.graceEvent || ""));
        e.evolve(mk(200), 0.1, 0.09, 0, {}, { stage: 1 });
        check("no further reset while the stage holds", near(e.championFit, 400, 1e-6));
    }

    const round = Net.fromJSON(JSON.parse(JSON.stringify(evo.champion.toJSON())));
    const inp = new Float32Array(NIN).fill(0.3);
    const o1 = Array.from(evo.champion.forward(inp));
    const o2 = Array.from(round.forward(inp));
    check("a champion survives a JSON round trip", o1.every((v, i) => near(v, o2[i], 1e-6)));

    // the curriculum ratchet: three good generations promote, and never demote
    const hist = [];
    check("a cold start is stage 0", stageFor(1, hist, {}) === 0);
    for (let i = 0; i < 3; i++) hist.push({ stage: 0, avgArr: 2.0 });
    check("three strong generations promote to stage 1", stageFor(4, hist, {}) === 1);
    hist.push({ stage: 1, avgArr: 0.0 });
    hist.push({ stage: 1, avgArr: 0.0 });
    check("a bad stage-1 generation never demotes", stageFor(6, hist, {}) === 1);
    for (let i = 0; i < 3; i++) hist.push({ stage: 1, avgArr: 3.0 });
    check("three more promote to stage 2", stageFor(9, hist, {}) === 2);
    check("--stage-lock overrides the ratchet", stageFor(1, [], { stageLock: 2 }) === 2);

    /* Unlocking a stage must ADD a room to the exam, never replace it.
     * Measured: a champion taken from stage 0 into pillars-only stage 1 went
     * from 3.00 to 1.00 waypoints in the hall while gaining only 0.63 -> 0.75
     * in pillars — mean fitness across rooms fell from 2,948 to 2,004. The
     * curriculum was a net loss. Every generation now spans every unlocked
     * stage, and these assertions are what stop that regressing. */
    check("stage 0 runs only stage 0", episodeStages(0, 3).join() === "0,0,0");
    check("episode 1 is always the newest room",
        episodeStages(2, 3)[0] === 2 && episodeStages(1, 3)[0] === 1);
    check("later episodes revisit every unlocked stage",
        episodeStages(2, 3).join() === "2,0,1" && episodeStages(2, 5).join() === "2,0,1,2,0");
    for (let s = 0; s < STAGES.length; s++) {
        const seen = new Set(episodeStages(s, s + 1));
        check(`stage ${s} exam covers all ${s + 1} unlocked room(s)`, seen.size === s + 1,
            `got [${episodeStages(s, s + 1)}]`);
    }
    check("episodeStages never returns a stage that is not unlocked",
        episodeStages(1, 9).every(s => s <= 1) && episodeStages(0, 9).every(s => s === 0));

    /* Per-room normalisation. Raw scores differ by an order of magnitude
     * between rooms — an empty hall permits thirty waypoints where a warehouse
     * permits one — so an unnormalised mean hands the selection signal to the
     * easiest room. Measured on the unnormalised mix: hall 9.90 waypoints,
     * warehouse 0.00, i.e. a superb empty-room flier that could not fly the
     * warehouse at all. */
    check("every stage carries a normalising scale",
        STAGES.every(s => typeof s.scale === "number" && s.scale > 0));
    {
        // a brain twice as good as par in every room must beat one that is
        // brilliant in the hall and hopeless in the warehouse
        const par = STAGES.map(s => s.scale);
        const generalist = par.map(p => 2 * p);
        const hallSpecialist = [par[0] * 8, par[1] * 0.5, 0];
        const norm = v => v.reduce((a, x, i) => a + normalizeFitness(x, STAGES[i].scale), 0) / STAGES.length;
        const raw = v => v.reduce((a, x) => a + x, 0) / STAGES.length;
        const flat = v => v.reduce((a, x, i) => a + x / STAGES[i].scale, 0) / STAGES.length;
        check("normalised scoring prefers the generalist",
            norm(generalist) > norm(hallSpecialist),
            `${norm(generalist).toFixed(2)} vs ${norm(hallSpecialist).toFixed(2)}`);
        check("raw scoring would have preferred the hall specialist (the bug)",
            raw(hallSpecialist) > raw(generalist));
        // scaling alone is not enough — an unbounded room still dominates,
        // which is why normalizeFitness applies diminishing returns as well
        check("flat scaling alone would still prefer the specialist",
            flat(hallSpecialist) > flat(generalist),
            `${flat(hallSpecialist).toFixed(2)} vs ${flat(generalist).toFixed(2)}`);
        check("normalisation is monotone within a room",
            normalizeFitness(100, 1000) < normalizeFitness(500, 1000) &&
            normalizeFitness(500, 1000) < normalizeFitness(5000, 1000));
        check("a negative score stays negative (no NaN)",
            normalizeFitness(-300, 2000) < 0 && Number.isFinite(normalizeFitness(-300, 2000)));
    }
    // the ratchet must judge the NEWEST room, not be carried by the easy ones
    {
        const h = [];
        for (let i = 0; i < 4; i++) h.push({ stage: 0, avgArr: 9, newArr: 9 });
        check("the ratchet promotes on newest-room arrivals", stageFor(5, h, {}) === 1);
        const h2 = [];
        for (let i = 0; i < 6; i++) h2.push({ stage: 1, avgArr: 9, newArr: 0.1 });
        check("a population carried by easy rooms does not promote",
            stageFor(7, [{ stage: 0, avgArr: 9, newArr: 9 }, { stage: 0, avgArr: 9, newArr: 9 },
                         { stage: 0, avgArr: 9, newArr: 9 }].concat(h2), {}) === 1);
    }
    check("every stage names a real room",
        STAGES.every(s => roomById(s.room).id === s.room));
}

console.log(`\n${failures === 0 ? "all good" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
