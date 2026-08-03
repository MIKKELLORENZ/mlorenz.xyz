/* gridsearch.js — sweep training hyper-parameters, then rank the survivors on a
 * held-out battery.
 *
 *   node gridsearch.js --gens 60 --lanes 3 --workers 6
 *
 * Two rules this obeys, both learned the hard way in this project:
 *
 *   1. NEVER rank on training fitness. Every arm sees a different slice of the
 *      sliding mission window, and one fixed brain scores anywhere from 1,031 to
 *      2,934 across missions. Rank on a battery of missions no arm trained on,
 *      and on ledger-independent quantities — metres, waypoints, whether it got
 *      off the floor — so arms with different reward scales stay comparable.
 *
 *   2. Report what was dropped. Arms that crash or produce no champion are
 *      listed, not silently skipped, because an arm that dies is a result.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const vm = require("vm");
const { spawn } = require("child_process");

const DIR = __dirname;
function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    if (v === undefined || v.startsWith("--")) return true;
    return isNaN(+v) ? v : +v;
}
const GENS = arg("gens", 60);
const POP = arg("pop", 48);
const LANES = arg("lanes", 3);
const WORKERS = arg("workers", Math.max(2, Math.floor((os.cpus().length - 2) / LANES)));
const OUTROOT = path.join(DIR, "training", arg("out", "grid"));

/* The sweep. Mutation step dominates everything else here — measured, 0.10/0.15
 * left 0 of 24 children within 5% of their parent — so it gets the most points,
 * and the rest move one factor at a time around a known-workable centre. */
/* Six arms, not twelve. Non-terminal falls quadrupled the cost of a generation
 * — walkers now live out the whole clock instead of dying at five seconds — and
 * a grid that eats the entire budget leaves nothing to train with. These are the
 * levers with the largest measured effect; population size and grace were cut
 * because neither has ever moved a result here by as much as the mutation step
 * does. Dropping them is a real loss of coverage, recorded rather than hidden. */
const ARMS = [
    { id: "base", mutRate: 0.035, mutSigma: 0.04 },
    { id: "mut-tiny", mutRate: 0.020, mutSigma: 0.030 },
    { id: "mut-wide", mutRate: 0.055, mutSigma: 0.060 },
    { id: "mut-sig-hi", mutRate: 0.035, mutSigma: 0.075 },
    { id: "cpg-1.35", mutRate: 0.035, mutSigma: 0.04, cpgScale: 1.35 },
    { id: "servo-1.25", mutRate: 0.035, mutSigma: 0.04, servoScale: 1.25 }
];

function runArm(a) {
    const out = path.join(OUTROOT, a.id);
    fs.mkdirSync(out, { recursive: true });
    const args = [
        "train.js", "--gens", GENS, "--pop", a.pop || POP, "--workers", WORKERS,
        "--seed", 1234, "--mut-rate", a.mutRate, "--mut-sigma", a.mutSigma,
        "--cpg-scale", a.cpgScale || 1, "--servo-scale", a.servoScale || 1,
        "--grace", a.grace || 3, "--save-every", 1e9, "--out", out
    ].map(String);
    const log = fs.createWriteStream(path.join(out, "run.log"));
    return new Promise(resolve => {
        const t0 = Date.now();
        const p = spawn(process.execPath, args, { cwd: DIR });
        p.stdout.pipe(log); p.stderr.pipe(log);
        p.on("close", code => {
            const mins = (Date.now() - t0) / 60000;
            console.log(`  [${a.id}] finished in ${mins.toFixed(1)} min (exit ${code})`);
            resolve({ arm: a, out, code });
        });
        p.on("error", e => { console.log(`  [${a.id}] FAILED to start: ${e.message}`); resolve({ arm: a, out, code: -1 }); });
    });
}

async function pool(items, n, fn) {
    const results = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (i < items.length) {
            const k = i++;
            results[k] = await fn(items[k]);
        }
    }));
    return results;
}

/* ---- scoring: one held-out battery, ledger-independent quantities ---- */
function loadSim() {
    for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"]) {
        vm.runInThisContext(fs.readFileSync(path.join(DIR, f), "utf8"), { filename: f });
    }
}
const WALK_MISSIONS = [900, 907, 913, 921, 934, 947, 955, 962];
const RISE_MISSIONS = [971, 978, 985, 992];

function score(file, arm) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    const net = Net.fromJSON(saved.net);
    setTune({ cpgScale: arm.cpgScale || 1, servoScale: arm.servoScale || 1 });
    let walked = 0, arr = 0, upright = 0;
    for (const m of WALK_MISSIONS) {
        const w = new World(HUMANOID, [net], {
            stage: 3, missionSeed: 1 + m * 37, noiseSeed: 5000 + m * 13, noise: true, groundFrac: 0
        });
        let t = 0;
        while (!w.isOver() && t++ < 140 * 500) w.step();
        walked += w.walkers[0].progressM; arr += w.walkers[0].arrivals;
        upright += w.walkers[0].uprightTime;
    }
    // Rising is scored on its own missions, every one of them a floor start, so
    // an arm that walks well but cannot get up does not hide behind its metres.
    let rose = 0, com = 0;
    for (const m of RISE_MISSIONS) {
        for (const pose of HUMANOID.groundPoses) {
            const w = new World(HUMANOID, [net], {
                stage: 3, missionSeed: 1 + m * 37, noiseSeed: 5000 + m * 13, noise: true, groundFrac: 0
            });
            const x = w.walkers[0];
            x.reset(w, w.spawn.x, w.spawn.z, w.startYaw, pose);
            x.timeLeft = 22;
            let t = 0;
            while (!w.isOver() && t++ < 140 * 500) w.step();
            rose += x.recoveries > 0 ? 1 : 0;
            com += x.bestComY;
        }
    }
    const nR = RISE_MISSIONS.length * HUMANOID.groundPoses.length;
    return {
        walked: walked / WALK_MISSIONS.length,
        arrivals: arr / WALK_MISSIONS.length,
        upright: upright / WALK_MISSIONS.length,
        roseFrac: rose / nR,
        com: com / nR
    };
}

(async () => {
    fs.mkdirSync(OUTROOT, { recursive: true });
    console.log(`grid: ${ARMS.length} arms · ${GENS} gens · ${LANES} lanes x ${WORKERS} workers\n`);
    const done = await pool(ARMS, LANES, runArm);

    loadSim();
    const rows = [], dropped = [];
    for (const d of done) {
        const f = path.join(d.out, "champion.json");
        if (d.code !== 0 || !fs.existsSync(f)) { dropped.push(`${d.arm.id} (exit ${d.code}, champion ${fs.existsSync(f)})`); continue; }
        try { rows.push({ id: d.arm.id, arm: d.arm, ...score(f, d.arm) }); }
        catch (e) { dropped.push(`${d.arm.id} (scoring threw: ${e.message})`); }
    }
    // waypoints first, then metres — the same order the reward is built in
    rows.sort((a, b) => (b.arrivals - a.arrivals) || (b.roseFrac - a.roseFrac) || (b.walked - a.walked));
    console.log("\n  arm          |   wp | walked | upright | rose | peak com");
    for (const r of rows) {
        console.log(`  ${r.id.padEnd(12)} | ${r.arrivals.toFixed(2).padStart(4)} | ${r.walked.toFixed(2).padStart(6)} | ` +
            `${r.upright.toFixed(1).padStart(6)}s | ${(r.roseFrac * 100).toFixed(0).padStart(3)}% | ${r.com.toFixed(2)} m`);
    }
    if (dropped.length) console.log(`\n  dropped: ${dropped.join(", ")}`);
    fs.writeFileSync(path.join(OUTROOT, "results.json"), JSON.stringify(rows, null, 2));
    console.log(`\nwinner: ${rows.length ? rows[0].id : "none"}`);
})();
