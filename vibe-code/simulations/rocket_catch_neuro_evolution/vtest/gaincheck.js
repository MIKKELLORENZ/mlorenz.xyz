/* gaincheck.js — DOES A TUNED GAIN SET SURVIVE OFF ITS OWN SEEDS AND ON THE
 * GEOMETRY AS DEPLOYED?
 *
 * pilot_tune.js searches on seed base 500000 and reports the winner's score on
 * those same episodes, which is the winner's curse in its purest form: with
 * 3000 configurations and 40 episodes each, the top of the leaderboard is
 * whichever gain set got the friendliest forty draws. It is also, more quietly,
 * a report about the environment as it stood when the search ran — and this
 * environment has changed under a running search more than once.
 *
 * So: re-fly a handful of named gain sets on a bank they have never seen, on
 * whatever scenarios.js is on disk right now, and print catch fraction with a
 * standard error so the difference between two of them can be read honestly.
 *
 *   node vtest/gaincheck.js [candidates.json] [episodesPerStage]
 *   env: STAGES=0,1,2  NPROC=8  BASE=770000
 *
 * candidates.json is [{name, gains}, ...]; with no file the incumbent from
 * golden_test.js competes against vtest/tune_top.json.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");
const WM = require("../world.js");
const SC = require("../scenarios.js");
const GOLD = require("../golden_test.js");
/* USE_SLAM must match how the gains were searched: they are the SETTLE half of a
 * two-phase reference now, and flying them standalone measures a controller that
 * is not the one being proposed. */
const SLAM = require("./slam.js");
const USE_SLAM = process.env.TUNE_SLAM === "1";

const STAGES = (process.env.STAGES || "0").split(",").map(Number);
const BASE = Number(process.env.BASE || 770000);   /* not 500000 (tune), not 90000 (golden), not 2e9 (exam) */

function evalOne(gains, stage, i) {
    const sc = SC.makeScenario(stage, BASE + stage * 100003 + i * 7919);
    sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
    const w = new WM.World(sc);
    const r = w.runEpisode(USE_SLAM ? SLAM.makeSlam({ settleGains: gains }) : GOLD.makePilot(gains));
    return { name: WM.OUTCOME_NAME[r.outcome], total: r.total };
}

/* ------------------------------------------------------------- the worker */
if (process.send && process.argv.includes("--worker")) {
    process.on("message", (msg) => {
        if (msg.done) process.exit(0);
        const out = msg.jobs.map(j => {
            const r = evalOne(msg.cands[j.c].gains, j.stage, j.i);
            return { c: j.c, stage: j.stage, name: r.name, total: r.total };
        });
        process.send({ out });
    });
    process.send({ ready: true });
    process.on("disconnect", () => process.exit(0));
}
else run();

function run() {
    const file = process.argv[2];
    const NEP = Number(process.argv[3] || 120);
    const NPROC = Number(process.env.NPROC || 6);

    let cands;
    if (file) cands = JSON.parse(fs.readFileSync(file, "utf8"));
    else {
        cands = [{ name: "incumbent", gains: GOLD.GAINS }];
        const top = JSON.parse(fs.readFileSync(path.join(__dirname, "tune_top.json"), "utf8"));
        top.forEach((e, k) => { if (!e.gains._incumbent) cands.push({ name: `tuned#${k}`, gains: e.gains }); });
    }
    /* Missing keys fall back to the incumbent's: a searched set carries only the
     * fourteen dimensions the search varied, and makePilot reads more than that
     * (tMargin, propReserve). Handing it an object without them is how a gain
     * set gets scored with an undefined propellant reserve. */
    cands.forEach(c => { c.gains = Object.assign({}, GOLD.GAINS, c.gains); });

    const jobs = [];
    for (let c = 0; c < cands.length; c++)
        for (const stage of STAGES)
            for (let i = 0; i < NEP; i++) jobs.push({ c, stage, i });

    const chunks = Array.from({ length: NPROC }, () => []);
    jobs.forEach((j, i) => chunks[i % NPROC].push(j));

    console.log(`${cands.length} gain sets · stages ${STAGES.join(",")} · ${NEP} episodes/stage · ` +
        `seed base ${BASE} (fresh) · ${NPROC} processes\n`);

    const results = [];
    let live = 0;
    for (let k = 0; k < NPROC; k++) {
        const ch = fork(__filename, ["--worker"], { stdio: "inherit" });
        live++;
        let sent = false;
        ch.on("message", (m) => {
            if (m.ready && !sent) { sent = true; ch.send({ cands, jobs: chunks[k] }); return; }
            if (m.out) { results.push(...m.out); ch.send({ done: true }); }
        });
        ch.on("exit", () => { if (--live === 0) report(cands, NEP); });
    }

    function report(cands, NEP) {
        console.log(`  gain set        stage   caught          mean score      other outcomes`);
        const catchFrac = [];
        for (let c = 0; c < cands.length; c++) {
            let allCaught = 0, allN = 0;
            for (const stage of STAGES) {
                const rs = results.filter(r => r.c === c && r.stage === stage);
                const caught = rs.filter(r => r.name === "caught").length;
                const p = caught / rs.length, se = Math.sqrt(p * (1 - p) / rs.length);
                const mean = rs.reduce((a, r) => a + r.total, 0) / rs.length;
                const tally = {};
                for (const r of rs) if (r.name !== "caught") tally[r.name] = (tally[r.name] || 0) + 1;
                console.log(`  ${cands[c].name.padEnd(14)} ${String(stage).padStart(4)}  ` +
                    `${String(caught + "/" + rs.length).padStart(8)} ${(100 * p).toFixed(1).padStart(5)}% ` +
                    `+/- ${(100 * se).toFixed(1).padStart(4)}   ${mean.toFixed(3).padStart(6)}   ` +
                    Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3)
                        .map(([k, v]) => `${k} ${v}`).join(", "));
                allCaught += caught; allN += rs.length;
            }
            catchFrac.push({ name: cands[c].name, p: allCaught / allN, n: allN });
            if (STAGES.length > 1) console.log(`  ${"".padEnd(14)}  all   ${String(allCaught + "/" + allN).padStart(8)}\n`);
        }
        /* Paired only in the sense that both flew the same seeds; the two-sample
         * z on independent binomials is the conservative read and is enough to
         * say whether a leaderboard row was real. */
        const a = catchFrac[0];
        for (let i = 1; i < catchFrac.length; i++) {
            const b = catchFrac[i];
            const se = Math.sqrt(a.p * (1 - a.p) / a.n + b.p * (1 - b.p) / b.n);
            const d = b.p - a.p;
            console.log(`\n  ${b.name} - ${a.name}: ${(100 * d).toFixed(1)} pts +/- ${(100 * se).toFixed(1)}` +
                `  (z = ${(d / (se || 1e-9)).toFixed(1)})`);
        }
    }
}
