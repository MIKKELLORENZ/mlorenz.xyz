/* pilot_tune.js — re-tune the golden pilot for the environment as it is NOW.
 *
 * The gains in golden_test.js were grid-searched against an environment that has
 * since changed underneath them: the structural limits were tightened by an
 * order of magnitude on q·alpha, the descent manifold was added and then
 * corrected, and the pilot itself grew a q-limited sink schedule and an
 * angle-of-attack clamp. A gain set found before all that is not a tuned
 * controller, it is a fossil.
 *
 * TUNED ON ITS OWN SEEDS. The search draws from base 500000; golden_test.js
 * reports on 90000 and the trainer's exam bank lives at 2e9. Tuning and
 * reporting on the same episodes is how a controller ends up looking good
 * exactly once, and this project has already paid for that lesson in a different
 * currency (the champion that was crowned on the bank it was bred against).
 *
 *   node vtest/pilot_tune.js [nConfigs] [episodesPerStage]
 */
"use strict";

const path = require("path");
const { fork } = require("child_process");
const WM = require("../world.js");
const SC = require("../scenarios.js");
const GOLD = require("../golden_test.js");
/* TUNE_SLAM=1 searches the settle gains AS FLOWN INSIDE THE HOVER-SLAM, which is
 * the only way the number means anything now: the settle controller no longer
 * flies the approach, it is handed a vehicle at 350 m doing 40 m/s, and gains
 * scored on a spawn it will never see again are gains for a different problem.
 * The last 3,000-point search was run against the old structure and every one of
 * its four leaders measured 0/200 on a fresh bank. */
const SLAM = require("./slam.js");
const USE_SLAM = process.env.TUNE_SLAM === "1";

const STAGES = (process.env.TUNE_STAGES || "0,1,2").split(",").map(Number);
const TUNE_BASE = 500000;

/* ---------------------------------------------------------------- scoring */
function evalConfig(K, nEp) {
    let J = 0;
    const per = [];
    for (const stage of STAGES) {
        let caught = 0, bad = 0, sum = 0;
        for (let i = 0; i < nEp; i++) {
            const sc = SC.makeScenario(stage, TUNE_BASE + stage * 100003 + i * 7919);
            sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
            const w = new WM.World(sc);
            const r = w.runEpisode(USE_SLAM ? SLAM.makeSlam(Object.assign({ settleGains: K }, K._slam)) : GOLD.makePilot(K));
            const nm = WM.OUTCOME_NAME[r.outcome];
            if (nm === "caught") caught++;
            if (nm === "tumble" || nm === "breakup" || nm === "timeout" || nm === "out of bounds") bad++;
            sum += r.total;
        }
        /* A CATCH IS THE POINT AND HAS TO DOMINATE OUTRIGHT. The first weights
         * here were 3/0.35/-0.6 and the search promptly returned a gain set
         * that caught NOTHING on any stage and won on a low failure rate — a
         * controller optimised for not embarrassing itself. The incumbent
         * catches 38% of stage 0, so the search had found something strictly
         * worse at the only thing this reference exists to demonstrate.
         *
         * Not failing is easier than succeeding, so any weighting that lets the
         * two trade will buy the easy one. The score and failure terms are kept
         * only to break ties between gain sets that catch equally often. */
        const c = caught / nEp, b = bad / nEp, s = sum / nEp;
        J += 10 * c + 0.25 * s - 0.25 * b;
        per.push({ stage, c, b, s });
    }
    return { J, per };
}

/* ------------------------------------------------------------- the worker */
if (process.send && process.argv.includes("--worker")) {
    process.on("message", (msg) => {
        if (msg.done) process.exit(0);
        const out = msg.configs.map(c => ({ c, r: evalConfig(c, msg.nEp) }));
        process.send({ out });
    });
    process.send({ ready: true });
    process.on("disconnect", () => process.exit(0));
}
else runSearch();

/* ------------------------------------------------------------- the search */
function runSearch() {
const NCFG = Number(process.argv[2] || 240);
const NEP = Number(process.argv[3] || 14);
/* THE TEACHER SETS THE DISTILLATION CEILING. A cloned policy is a lossy copy of
 * its teacher and cannot exceed it, so every point the teacher gains is a point
 * the student can inherit. Worth a much larger search than the first pass: the
 * reachability probe says at least 77% of stage 0 is catchable and the tuned
 * pilot takes 52%, so there are twenty-five points sitting there. */
const NPROC = Number(process.env.NPROC || 6);

let seed = 20260816;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const logU = (a, b) => Math.exp(Math.log(a) + rnd() * (Math.log(b) - Math.log(a)));
const DEG = Math.PI / 180;

const configs = [Object.assign({ _incumbent: true }, GOLD.GAINS)];   // always competes
for (let i = 1; i < NCFG; i++) {
    configs.push({
        kpPos: logU(0.02, 0.30), kdPos: logU(0.15, 1.30),
        aLatMax: logU(1.5, 9.0),
        kpAtt: logU(0.12, 0.80), kdAtt: logU(0.6, 3.0),
        slope: logU(0.03, 0.30), kvz: logU(0.25, 1.30),
        slotX: logU(1.5, 12.0), slotH: logU(35, 190),
        vTouch: logU(0.5, 3.0),
        qMargin: 0.45 + rnd() * 0.45,
        qLook: logU(3, 30),
        qaMargin: 0.35 + rnd() * 0.55,
        aoaMax: logU(6, 45) * DEG
    });
    /* THE APPROACH HALF HAS NEVER BEEN SEARCHED AT ALL. Its numbers were picked
     * while the law was being derived — where to hand over, how much margin to
     * leave at ignition, how much thrust the lateral loop may take — and the
     * handover state is what the settle gains are then tuned against, so
     * searching one without the other is searching a moving target. */
    if (USE_SLAM) configs[i]._slam = {
        hHand: logU(180, 700), vHand: logU(20, 90),
        ignMargin: logU(0.05, 0.9),
        aLatFrac: 0.15 + rnd() * 0.55,
        zemK: logU(0.5, 1.8),
        aoaMax: logU(10, 38) * DEG,
        finBias: rnd() * 1.2
    };
}

const chunks = Array.from({ length: NPROC }, () => []);
configs.forEach((c, i) => chunks[i % NPROC].push(c));

const results = [];
let live = 0;
console.log(`tuning ${configs.length} gain sets on stages ${STAGES.join(",")} · ` +
    `${NEP} episodes/stage · ${NPROC} processes · seeds from ${TUNE_BASE} (not the report bank)`);

for (let k = 0; k < NPROC; k++) {
    const ch = fork(path.join(__dirname, "pilot_tune.js"), ["--worker"], { stdio: "inherit" });
    live++;
    let sent = false;
    ch.on("message", (m) => {
        if (m.ready && !sent) { sent = true; ch.send({ configs: chunks[k], nEp: NEP }); return; }
        if (m.out) { results.push(...m.out); ch.send({ done: true }); }
    });
    ch.on("exit", () => { if (--live === 0) report(); });
}

function report() {
    results.sort((a, b) => b.r.J - a.r.J);
    /* The incumbent is found by a FLAG CARRIED IN THE CONFIG, not by object
     * identity: fork() serialises the message, so the object the worker scored
     * is never the object the parent sent, and `r.c === GOLD.GAINS` was always
     * false. It printed "incumbent J = ?" and I nearly read a leaderboard with
     * no baseline on it as if it meant something. */
    const base = results.find(r => r.c._incumbent);
    console.log(`\nincumbent J = ${base ? base.r.J.toFixed(3) : "?"}\n`);
    console.log(`     J     per-stage catch / fail            gains`);
    for (const e of results.slice(0, 6)) {
        console.log(`  ${e.r.J.toFixed(3).padStart(6)}  ` +
            e.r.per.map(p => `s${p.stage} ${(100 * p.c).toFixed(0)}/${(100 * p.b).toFixed(0)}`).join(" ") +
            `   kp ${e.c.kpPos.toFixed(3)} kd ${e.c.kdPos.toFixed(2)} aLat ${e.c.aLatMax.toFixed(1)}` +
            ` slope ${e.c.slope.toFixed(3)} kvz ${e.c.kvz.toFixed(2)} slotX ${e.c.slotX.toFixed(1)}` +
            ` slotH ${e.c.slotH.toFixed(0)} qM ${e.c.qMargin.toFixed(2)} qL ${e.c.qLook.toFixed(0)}` +
            ` aoa ${(e.c.aoaMax / DEG).toFixed(0)}` +
            (e.c._slam ? `
           approach: hHand ${e.c._slam.hHand.toFixed(0)} vHand ${e.c._slam.vHand.toFixed(0)}` +
                ` ignMargin ${e.c._slam.ignMargin.toFixed(2)} aLatFrac ${e.c._slam.aLatFrac.toFixed(2)}` +
                ` zemK ${e.c._slam.zemK.toFixed(2)} aoa ${(e.c._slam.aoaMax / DEG).toFixed(0)} finBias ${e.c._slam.finBias.toFixed(2)}` : ""));
    }
    require("fs").writeFileSync("vtest/tune_top.json",
        JSON.stringify(results.slice(0, 4).map(e => ({ J: e.r.J, gains: e.c })), null, 1));
    const best = results[0].c;
    console.log(`\nBEST:\n${JSON.stringify(best, null, 4)}`);
}
}
