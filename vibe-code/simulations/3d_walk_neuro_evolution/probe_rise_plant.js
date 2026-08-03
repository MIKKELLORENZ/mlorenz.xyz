/* probe_rise_plant.js — is getting up a SEARCH problem or a PLANT problem?
 *
 *   node probe_rise_plant.js
 *
 * Rising from the floor has read 0/6 for every champion this project has
 * produced, and the standing explanation is that it is a multi-phase sequence
 * with no reward gradient leading into it. That explanation is about the SEARCH.
 * It is worth testing, because this file's own notes record that hand-scripted
 * open-loop attempts fail too — 0.60 m from the easiest floor pose, 0.30 m from
 * side-lying, against 0.84 m standing — and a script has no search problem at
 * all. If a script cannot do it either, no reward shaping will help, because the
 * behaviour being rewarded is not in the body's reachable set.
 *
 * So this drives the servos directly, bypassing the network entirely, and asks
 * what the BODY can do. Then it changes one property of the body at a time:
 *
 *   arms x3     shoulder/elbow torque tripled  -> is it strength?
 *   hips open   hip roll and yaw limits opened -> is it reachable workspace?
 *   both        -> is it the two together?
 *
 * Whichever change moves the peak COM height is the wall. If none of them do,
 * the wall is elsewhere and this rules out the two obvious plant explanations.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const M = HUMANOID;

/* A brain that does nothing. The script writes joint commands directly after
 * control() runs, so whatever this returns is overwritten — it exists only
 * because World wants something with a forward(). */
const inert = { sizes: NET_SIZES.slice(), forward: () => new Float32Array(NOUT).fill(0.5) };

/* The command schedule. Open-loop and deliberately generous: it does not have to
 * be a good rise, it only has to be the best a body could be TOLD to do. Each
 * phase is a target posture the servos chase; the walker is given four seconds
 * per phase, far longer than a human takes.
 *
 * Phase 1 plants the hands and tucks the knees — the two things the code's own
 * analysis says the rise needs before any pressing can happen.
 * Phase 2 presses: extend the arms, drive the hips up.
 * Phase 3 commands the full standing posture. */
function schedule(t, q0) {
    const nominal = M.nominal, crouch = M.crouch;
    const lerp = (a, b, u) => a + (b - a) * Math.max(0, Math.min(1, u));
    const out = new Float64Array(M.nj);
    for (let j = 0; j < M.nj; j++) out[j] = q0[j];
    if (t < 2.0) {                       // plant hands, tuck knees
        const u = t / 2.0;
        for (let j = 0; j < M.nj; j++) {
            const n = M.bodies[j + 1].name;
            if (/Shoulder|UpperArm|Forearm/.test(n)) out[j] = lerp(q0[j], M.bodies[j + 1].qmax * 0.85, u);
            else if (/Shank/.test(n)) out[j] = lerp(q0[j], M.bodies[j + 1].qmin * 0.9, u);
            else if (/Thigh/.test(n)) out[j] = lerp(q0[j], M.bodies[j + 1].qmax * 0.9, u);
        }
    } else if (t < 5.0) {                // press
        const u = (t - 2.0) / 3.0;
        for (let j = 0; j < M.nj; j++) out[j] = lerp(q0[j], crouch[j], u);
    } else {                             // stand
        const u = (t - 5.0) / 3.0;
        for (let j = 0; j < M.nj; j++) out[j] = lerp(crouch[j], nominal[j], u);
    }
    return out;
}

function attempt(poseName, mods) {
    /* Body edits are applied to a fresh copy of the limits and restored after, so
     * one variant cannot leak into the next. */
    const saved = M.bodies.map(b => ({ qmin: b.qmin, qmax: b.qmax, tauMax: b.tauMax }));
    if (mods) for (let i = 1; i < M.bodies.length; i++) {
        const b = M.bodies[i];
        if (mods.arm && /Shoulder|UpperArm|Forearm|Hand/.test(b.name)) b.tauMax *= mods.arm;
        if (mods.hip && /HipRoll|HipYaw/.test(b.name)) { b.qmin *= mods.hip; b.qmax *= mods.hip; }
    }
    const pose = poseName === "prone" ? (M.groundPoses || []).find(p => /prone|supine/.test(p.name)) || M.groundPoses[0]
        : poseName === "seated" ? (M.groundPoses || []).find(p => /seat/.test(p.name)) || M.groundPoses[0]
        : M.startPoses.find(p => p.name === poseName);
    if (!pose) { for (let i = 0; i < saved.length; i++) Object.assign(M.bodies[i], saved[i]); return null; }

    const w = new World(M, [inert], { stage: 1, terrainDifficulty: 0, terrainId: "flat",
        missionSeed: 31, noiseSeed: 17, noise: false, startPose: pose, groundFrac: 1, seatFrac: 0, poseFrac: 1 });
    const k = w.walkers[0];
    const q0 = Float64Array.from(k.mb.q.subarray(1, 1 + M.nj));
    let peak = 0, start = 0;
    for (let step = 0; step < 8 * 500; step++) {
        w.step();
        const cmd = schedule(w.time, q0);
        for (let j = 0; j < M.nj; j++) k.cmd[j] = cmd[j];   // overwrite whatever the net said
        const com = k.comHeight(w);
        if (!start) start = com;
        if (com > peak) peak = com;
    }
    for (let i = 0; i < saved.length; i++) Object.assign(M.bodies[i], saved[i]);
    return { start, peak };
}

console.log(`standing COM reference: ${(M.standHipY * 1.07).toFixed(2)} m (hip ${M.standHipY.toFixed(2)} m)\n`);
console.log("  pose        body                      start COM   peak COM   gained");
for (const pose of ["seated", "quadruped", "hugknees", "sidesit"]) {
    for (const [label, mods] of [["as built", null], ["arms x3", { arm: 3 }],
                                 ["hips opened x2.5", { hip: 2.5 }], ["arms x3 + hips x2.5", { arm: 3, hip: 2.5 }]]) {
        const r = attempt(pose, mods);
        if (!r) continue;
        console.log(`  ${pose.padEnd(11)} ${label.padEnd(24)} ${r.start.toFixed(3)} m   ${r.peak.toFixed(3)} m   ` +
            `${(r.peak - r.start >= 0 ? "+" : "")}${(r.peak - r.start).toFixed(3)} m`);
    }
    console.log();
}
console.log(`A variant that reaches near the standing COM found the wall. If every row
stays low, neither arm torque nor hip workspace is what stops it.`);
