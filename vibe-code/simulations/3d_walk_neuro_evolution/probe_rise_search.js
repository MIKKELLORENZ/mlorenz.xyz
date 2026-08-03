/* probe_rise_search.js — does a rise EXIST inside the actuator limits at all?
 *
 *   node probe_rise_search.js [pose] [gens] [seed]
 *   node probe_rise_search.js all 400
 *
 * Every explanation this project has offered for "the humanoid never gets up" is
 * confounded. Sensing, temporal memory, curriculum, reward shaping and the
 * mutation operator all change at once, and any of them could be the wall. This
 * strips all five away and asks the only question underneath: is there ANY
 * sequence of joint commands, inside the real torque and slew limits, that lifts
 * this body off the floor?
 *
 * Two hand-written attempts have already failed. probe_rise_plant.js scripted
 * "plant hands, tuck knees, press" and reached 0.607 m where a walker commanded
 * to do NOTHING reached 0.819 m — the script was worse than inaction. body.js
 * records that interpolating between two statically stable postures face-plants
 * (0.797 -> 0.162). Hand-authoring motion under this contact model does not work,
 * so this searches for the trajectory instead of guessing it.
 *
 * WHY THIS IS A SMALL PROBLEM. The controller is 20,225 weights reading 365
 * inputs. An open-loop rise is 22 joints x K knots — about 130 numbers — with no
 * sensors, no memory and deterministic physics. If a rise is reachable, this
 * finds it in minutes. If a dedicated search over the body's own command space
 * cannot find one, then no reward shaping and no mutation schedule ever could,
 * because the behaviour is not in the reachable set.
 *
 * THE SEARCH IS IN NETWORK OUTPUT SPACE, not in joint angles. Each gene is one
 * output in [0,1], mapped exactly as Walker.control does —
 * base[j] = nominal[j] + (out[j]*2-1) * range[j] — so whatever this finds is
 * something a brain can actually emit. A reference the controller cannot express
 * would be useless as an imitation target.
 *
 * FITNESS IS THE SETTLED HEIGHT, NOT THE PEAK. Rewarding peak COM buys a
 * ballistic lunge that collapses; that is exactly the trap the sustained-height
 * ratchet was built to close in the main run. Here the score is the mean COM
 * over the last 0.5 s, so the body has to still be up when the clock stops.
 *
 * The do-nothing genome is measured first and every result is quoted as a gain
 * over it. A rise search that reports 0.55 m means nothing until you know that
 * lying still scores 0.54.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const M = HUMANOID;

const POSE_ARG = process.argv[2] || "all";
const GENS = +(process.argv[3] || 300);
const SEED = +(process.argv[4] || 20260803);

const T_RISE = 3.0;            // s of episode — your 1.5-3 s window
const SETTLE = 0.5;            // s at the end that the score is taken over
const KNOTS = 6;               // per joint, evenly spaced over T_RISE
const NJ = M.nj;
const NGENE = NJ * KNOTS;
const STEPS = Math.round(T_RISE / DT);
const SETTLE_STEPS = Math.round(SETTLE / DT);

/* World wants something with forward(); the commands are written straight onto
 * the walker afterwards, so whatever this returns is overwritten. 0.5 across the
 * board is the newborn's neutral output. */
const inert = { sizes: NET_SIZES.slice(), forward: () => new Float32Array(NOUT).fill(0.5) };

function poseByName(name) {
    if (name === "prone" || name === "supine")
        return (M.groundPoses || []).find(p => p.name === name) || M.groundPoses[0];
    return M.startPoses.find(p => p.name === name)
        || (M.groundPoses || []).find(p => p.name === name);
}

/* Linear interpolation between knots. Deliberately not a spline: a servo with a
 * 55 ms lag and a 7 rad/s slew ceiling smooths the corners anyway, and a spline
 * would add overshoot the actuator cannot deliver. */
function geneAt(g, j, u) {
    const x = u * (KNOTS - 1);
    const i = Math.min(KNOTS - 2, Math.floor(x));
    const f = x - i;
    const a = g[j * KNOTS + i], b = g[j * KNOTS + i + 1];
    return a + (b - a) * f;
}

const cmdBuf = new Float64Array(NJ);

function evaluate(g, pose) {
    const w = new World(M, [inert], {
        stage: 1, terrainDifficulty: 0, terrainId: "flat",
        missionSeed: 31, noiseSeed: 17, noise: false,
        startPose: pose, groundFrac: 1, seatFrac: 0, poseFrac: 1
    });
    const k = w.walkers[0];
    let acc = 0, n = 0, peak = 0;
    for (let step = 0; step < STEPS; step++) {
        w.step();
        const u = step / (STEPS - 1);
        for (let j = 0; j < NJ; j++) {
            const out = geneAt(g, j, u);
            const b = M.bodies[j + 1];
            let c = M.nominal[j] + (out * 2 - 1) * M.range[j];
            cmdBuf[j] = c < b.qmin ? b.qmin : c > b.qmax ? b.qmax : c;
        }
        for (let j = 0; j < NJ; j++) k.cmd[j] = cmdBuf[j];
        const com = k.comHeight(w);
        if (com > peak) peak = com;
        if (step >= STEPS - SETTLE_STEPS) { acc += com; n++; }
    }
    return { score: acc / n, peak };
}

/* The do-nothing genome: hold the spawn posture for the whole episode. This is
 * the baseline every result is quoted against, and it is not a formality — the
 * last hand-written schedule scored BELOW it. */
function holdGenome(pose) {
    const w = new World(M, [inert], {
        stage: 1, terrainDifficulty: 0, terrainId: "flat", missionSeed: 31,
        noiseSeed: 17, noise: false, startPose: pose, groundFrac: 1, seatFrac: 0, poseFrac: 1
    });
    const k = w.walkers[0];
    const q0 = Float64Array.from(k.mb.q.subarray(1, 1 + NJ));
    const g = new Float64Array(NGENE);
    for (let j = 0; j < NJ; j++) {
        const r = M.range[j] || 1e-9;
        let u = ((q0[j] - M.nominal[j]) / r + 1) / 2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        for (let t = 0; t < KNOTS; t++) g[j * KNOTS + t] = u;
    }
    return g;
}

/* A plain (mu + lambda) ES. GA only — no gradients anywhere in this project.
 * The sigma ladder down the ranks is the same idea as the main run's elite
 * fleet: a spread of step sizes beats one tuned step size, because the right
 * step size is not knowable in advance. */
function search(pose, label) {
    const rng = mulberry32(SEED);
    const MU = 12, LAMBDA = 48;
    const hold = holdGenome(pose);
    const base = evaluate(hold, pose);

    let pop = [{ g: hold, f: base.score }];
    for (let i = 1; i < MU; i++) {
        const g = Float64Array.from(hold);
        for (let x = 0; x < NGENE; x++) g[x] = clamp01(g[x] + gaussRand(rng) * 0.15);
        pop.push({ g, f: evaluate(g, pose).score });
    }
    pop.sort((a, b) => b.f - a.f);

    let bestEver = pop[0], stall = 0;
    for (let gen = 1; gen <= GENS; gen++) {
        const kids = [];
        for (let i = 0; i < LAMBDA; i++) {
            const p = pop[(rng() * MU) | 0];
            const g = Float64Array.from(p.g);
            // sigma ladder: a quarter of the fleet refines, a quarter explores hard
            const sigma = [0.02, 0.06, 0.15, 0.35][i & 3];
            // sparse or dense, same lesson as the main run: one density is not enough
            if ((i >> 2) & 1) {
                const nk = 1 + ((rng() * 8) | 0);
                for (let m = 0; m < nk; m++) {
                    const x = (rng() * NGENE) | 0;
                    g[x] = clamp01(g[x] + gaussRand(rng) * sigma);
                }
            } else {
                for (let x = 0; x < NGENE; x++)
                    if (rng() < 0.25) g[x] = clamp01(g[x] + gaussRand(rng) * sigma);
            }
            kids.push({ g, f: evaluate(g, pose).score });
        }
        pop = pop.concat(kids).sort((a, b) => b.f - a.f).slice(0, MU);
        if (pop[0].f > bestEver.f + 1e-6) { bestEver = pop[0]; stall = 0; } else stall++;
        if (gen % 50 === 0 || gen === GENS)
            console.log(`    gen ${String(gen).padStart(4)}  best ${pop[0].f.toFixed(3)} m` +
                `  (+${(pop[0].f - base.score).toFixed(3)} over hold)  stalled ${stall}`);
    }
    const fin = evaluate(bestEver.g, pose);
    return { hold: base.score, holdPeak: base.peak, best: fin.score, peak: fin.peak, g: bestEver.g };
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

const STAND_COM = M.standHipY * 1.07;
console.log(`rise search — ${NJ} joints x ${KNOTS} knots = ${NGENE} genes, ` +
    `${T_RISE}s episodes, score = mean COM over the last ${SETTLE}s`);
console.log(`standing COM reference ${STAND_COM.toFixed(3)} m\n`);

const poses = POSE_ARG === "all" ? ["kneel", "quadruped", "prone"] : [POSE_ARG];
const results = [];
for (const name of poses) {
    const pose = poseByName(name);
    if (!pose) { console.log(`  ${name}: no such pose`); continue; }
    console.log(`  ${name}:`);
    const r = search(pose, name);
    results.push({ name, ...r });
    fs.writeFileSync(path.join(__dirname, `rise_ref_${name}.json`),
        JSON.stringify({ pose: name, knots: KNOTS, T: T_RISE, nj: NJ,
                         score: r.best, hold: r.hold, gene: Array.from(r.g) }));
    console.log();
}

console.log("  pose         hold (do nothing)   searched   gain    % of standing");
for (const r of results)
    console.log(`  ${r.name.padEnd(12)} ${r.hold.toFixed(3)} m` +
        `             ${r.best.toFixed(3)} m   ${(r.best - r.hold >= 0 ? "+" : "")}${(r.best - r.hold).toFixed(3)}` +
        `   ${(100 * r.best / STAND_COM).toFixed(0)}%`);
console.log(`
A row that reaches most of the way to ${STAND_COM.toFixed(2)} m is an existence proof: the body
CAN rise from that pose, the reference is written to rise_ref_<pose>.json, and the
problem is search. A row that barely beats "hold" after this many evaluations is
evidence the rise is not in the reachable set at all — in which case imitation has
nothing to imitate and the morphology is the thing to change.`);
