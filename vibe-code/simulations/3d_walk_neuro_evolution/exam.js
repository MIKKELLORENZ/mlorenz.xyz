/* The honest exam: how many waypoints, and how deep a crouch can it leave?
 *
 * The training log reports waypoints as a mean over the three missions in the
 * sliding window, which the fleet has by now seen several times. The number the
 * user asked for — "at least 2 waypoints" — has to come from missions no
 * generation ever trained on, and from the ledger-independent count of arrivals
 * rather than from fitness.
 *
 * Rising is scored on the crouch ramp the curriculum actually uses, AND on the
 * five floor poses, which are reported separately because they are a different
 * problem and lumping them together would flatter the crouch result.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
/* Defaults to this file's own directory so the exam runs wherever the sim is
 * checked out. It used to hardcode the training node's path, which meant the
 * laptop could not re-run the exam that decides which brain gets baked. */
const DIR = process.env.WALK3D_DIR || __dirname;
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(DIR, f), "utf8"), { filename: f });
}
const M = HUMANOID;

/* The stage matters enormously and getting it wrong invites exactly the
 * misdiagnosis I made once already: a champion trained at stage 2 examined at
 * stage 3 faces double-strength shoves and sharper course changes, so a low
 * score says "harder exam", not "worse walker". Default to the stage the fleet
 * is actually on and make the comparison explicit. */
const STAGE = +(process.argv[3] || 2);
const file = process.argv[2] || path.join(DIR, "training/champion.json");
const saved = JSON.parse(fs.readFileSync(file, "utf8"));
/* A brain saved before an input-layer change cannot run against this build, and
 * the failure without this guard is a raw stack trace out of Net.forward that
 * looks like a physics bug rather than a stale file. It happens every time the
 * architecture grows: the previous run leaves its champion.json behind, and the
 * selection loop picks it up before the new run has written its first one. */
const sizes = (saved.net || saved).sizes;
if (!sizes || sizes.length !== NET_SIZES.length || sizes.some((v, i) => v !== NET_SIZES[i])) {
    console.error(`cannot exam ${path.basename(file)}: it is a ${(sizes || []).join("-")} brain and this build is ${NET_SIZES.join("-")}. Stale champion from a previous architecture?`);
    process.exit(3);
}
const net = Net.fromJSON(saved.net || saved);

/* Held out: no training generation draws from this range. */
const WALK = [900, 907, 913, 921, 934, 947, 955, 962, 969, 976, 983, 990];

function walkMission(m) {
    const w = new World(M, [net], {
        stage: STAGE, terrainId: "varied", missionSeed: 1 + m * 37, noiseSeed: 5000 + m * 13, noise: true, groundFrac: 0
    });
    let t = 0;
    while (!w.isOver() && t++ < 140 * 500) w.step();
    const x = w.walkers[0];
    return { arr: x.arrivals, m: x.progressM, up: x.uprightTime, fell: x.falls };
}

console.log(`exam of ${path.relative(DIR, file)} — generation ${saved.gen}, stage ${STAGE}, training fitness ${(saved.fitness || 0).toFixed(0)}\n`);
console.log("walking, 12 held-out missions:");
let arrTot = 0, mTot = 0, two = 0, one = 0;
for (const m of WALK) {
    const r = walkMission(m);
    arrTot += r.arr; mTot += r.m; if (r.arr >= 2) two++; if (r.arr >= 1) one++;
    console.log(`  mission ${m}  waypoints ${r.arr}  walked ${r.m.toFixed(2)} m  upright ${r.up.toFixed(1)} s  falls ${r.fell}`);
}
console.log(`  ---- mean ${(arrTot / WALK.length).toFixed(2)} waypoints, ${(mTot / WALK.length).toFixed(2)} m` +
    ` · reached >=1 on ${one}/${WALK.length} · reached >=2 on ${two}/${WALK.length}\n`);

/* Rising, on the ramp the curriculum uses. A "rise" is the walker's own
 * recovery test, not a height threshold I picked to make the number look good. */
function riseFrom(pose, seed) {
    const w = new World(M, [net], {
        stage: STAGE, terrainId: "varied", missionSeed: 1 + seed * 37, noiseSeed: 5000 + seed * 13, noise: true, groundFrac: 0
    });
    const x = w.walkers[0];
    x.reset(w, w.spawn.x, w.spawn.z, w.startYaw, pose);
    x.timeLeft = 22;
    let t = 0;
    while (!w.isOver() && t++ < 140 * 500) w.step();
    return { rose: x.recoveries > 0, com: x.bestComY, up: x.uprightTime };
}

const SEEDS = [971, 978, 985, 992, 999, 1006];
console.log("rising from a crouch (depth 0 = the ordinary start, 1 = folded squat):");
for (const d of [0.25, 0.5, 0.75, 1.0]) {
    let rose = 0, com = 0;
    for (const s of SEEDS) { const r = riseFrom(M.crouchAt(d), s); rose += r.rose ? 1 : 0; com += r.com; }
    console.log(`  depth ${d.toFixed(2)}   rose ${rose}/${SEEDS.length}   mean peak com ${(com / SEEDS.length).toFixed(2)} m`);
}

/* The rungs between the folded squat and the seat. This is the band the
 * curriculum used to jump over, so it is the band where progress will show up
 * first — before "seated" itself ever reads anything but 0/6. Reported as its
 * own block precisely so a partial win is visible instead of being rounded
 * away by the pass/fail on the full seat. */
console.log("\nrising from the seat ramp (0 = folded squat, 1 = full seated):");
for (const t of [0.25, 0.5, 0.75, 1.0]) {
    let rose = 0, com = 0;
    for (const s of SEEDS) { const r = riseFrom(M.seatAt(t), s); rose += r.rose ? 1 : 0; com += r.com; }
    console.log(`  seat ${t.toFixed(2)}    rose ${rose}/${SEEDS.length}   mean peak com ${(com / SEEDS.length).toFixed(2)} m`);
}

console.log("\nrising from the floor (the deferred problem — reported so it is not hidden):");
for (const pose of M.groundPoses) {
    let rose = 0, com = 0;
    for (const s of SEEDS) { const r = riseFrom(pose, s); rose += r.rose ? 1 : 0; com += r.com; }
    console.log(`  ${pose.name.padEnd(8)}  rose ${rose}/${SEEDS.length}   mean peak com ${(com / SEEDS.length).toFixed(2)} m`);
}
