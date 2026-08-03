/* oracle_episode.js — record a JS episode so the C++ port can be checked against it.
 *
 * The JS build is the reference implementation. It is the thing every measurement
 * in this project was made with, and it is the only description of what the
 * simulator is supposed to do. So the port is not validated by reading it twice;
 * it is validated by replaying a recorded episode and comparing the 333 sensor
 * inputs and 33 actions tick by tick.
 *
 *   node tools/oracle_episode.js --brain ../3d_walk_neuro_evolution/training/champion.json \
 *        --stage 3 --mission 900 --ticks 400 --out oracle/ep900.json
 *
 * WHAT IS RECORDED AND WHY. The sensor vector at control tick 1 is a pure function
 * of the reset pose and the terrain — no integration behind it — so it isolates
 * the whole sensing stack (body build, forward kinematics, terrain sampling, the
 * foveal patches, the lag window) from any accumulated divergence. Later ticks add
 * contacts, servos and the dynamics. If tick 1 matches to float32 precision and
 * tick 20 is still close, everything upstream agreed.
 *
 * The environment block is recorded separately and deliberately: startYaw,
 * difficulty, surface, friction and the first waypoint are all drawn from the
 * mission RNG in a fixed order, so they check the RNG stream itself before a
 * single physics tick is compared. A divergence there is a draw-order bug, which
 * is a completely different fix from a dynamics bug — and the two are
 * indistinguishable if you only look at tick 400.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const arg = (n, d) => {
    const i = process.argv.indexOf("--" + n);
    if (i < 0) return d;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : (isNaN(+v) ? v : +v);
};

const SIM = String(arg("sim", path.join(__dirname, "..", "..", "3d_walk_neuro_evolution")));
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(SIM, f), "utf8"), { filename: f });
}

const brainFile = String(arg("brain", path.join(SIM, "training", "champion.json")));
const saved = JSON.parse(fs.readFileSync(brainFile, "utf8"));
const rawNet = saved.net || saved;
if (rawNet.sizes.join("-") !== NET_SIZES.join("-")) {
    console.error(`brain is ${rawNet.sizes.join("-")} but this build is ${NET_SIZES.join("-")}`);
    process.exit(3);
}
const net = Net.fromJSON(rawNet);

const reward = String(arg("reward", "flat"));
setReward(reward);
const headingW = +arg("heading-w", 0) || 0;
FIT.HEADING_W = headingW;
setTune({ cpgScale: +arg("cpg-scale", 1) || 1, servoScale: +arg("servo-scale", 1) || 1 });

const stage = +arg("stage", 3);
const mission = +arg("mission", 900);
const nTicks = +arg("ticks", 400);
const terrainId = String(arg("terrain", "varied"));
/* Stratification is part of what the world draws, so it has to be part of what is
 * replayed. Left out, the mission RNG takes a different branch and every number
 * after it differs for a reason that has nothing to do with the port. */
const episodeSlot = arg("slot", null);
const episodeCount = arg("count", null);
const groundFrac = arg("ground-frac", null);

const opts = {
    stage, terrainId,
    missionSeed: 1 + mission * 37,
    noiseSeed: 5000 + mission * 13,
    noise: true
};
if (episodeSlot !== null && episodeSlot !== true) opts.episodeSlot = +episodeSlot;
if (episodeCount !== null && episodeCount !== true) opts.episodeCount = +episodeCount;
if (groundFrac !== null && groundFrac !== true) opts.groundFrac = +groundFrac;

const w = new World(HUMANOID, [net], opts);
const x = w.walkers[0];

const env = {
    startYaw: w.startYaw,
    terrainId: w.terrain.id,
    terrainDifficulty: w.terrain.difficulty,
    mu: w.terrain.mu,
    frictionScale: w.frictionScale,
    torqueScale: w.torqueScale,
    gainScale: w.gainScale,
    riseGrace: w.riseGrace,
    startPose: x.startPose,
    windFrac: w.windFrac,
    pushLevel: w.pushLevel,
    points: w.points.map(p => ({ x: p.x, z: p.z, y: p.y }))
};

const ticks = [];
let t = 0;
while (ticks.length < nTicks && !w.isOver() && t < 140 * 500) {
    const wasControl = w.tick % CONTROL_EVERY === 0;
    w.step();
    if (wasControl) {
        ticks.push({
            in: Array.from(x.inputs),
            out: Array.from(x.out),
            bp: [x.mb.bp[0], x.mb.bp[1], x.mb.bp[2]],
            fit: x.fitness()
        });
    }
    t++;
}

const out = String(arg("out", path.join(__dirname, "..", "oracle", `ep${mission}.json`)));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
    brainFile, brain: rawNet, reward, headingW,
    stage, terrainId, mission,
    missionSeed: opts.missionSeed, noiseSeed: opts.noiseSeed, noise: true,
    ...(opts.episodeSlot !== undefined ? { episodeSlot: opts.episodeSlot } : {}),
    ...(opts.episodeCount !== undefined ? { episodeCount: opts.episodeCount } : {}),
    ...(opts.groundFrac !== undefined ? { groundFrac: opts.groundFrac } : {}),
    env, ticks,
    final: {
        fitness: x.fitness(), arrivals: x.arrivals, progressM: x.progressM,
        steps: x.steps, uprightTime: x.uprightTime, falls: x.falls, recoveries: x.recoveries
    }
}));
console.log(`recorded ${ticks.length} control ticks of mission ${mission} (stage ${stage}, ` +
    `${env.terrainId} d=${env.terrainDifficulty.toFixed(3)}, start ${env.startPose}) -> ${out}`);
console.log(`  final: ${x.arrivals} wp, ${x.progressM.toFixed(2)} m, fitness ${x.fitness().toFixed(0)}`);
