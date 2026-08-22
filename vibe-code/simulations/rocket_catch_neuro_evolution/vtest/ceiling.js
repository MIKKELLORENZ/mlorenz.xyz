/* ceiling.js — what fraction of these episodes can be caught by ANYTHING?
 *
 * Before spending more hours pushing a target, the target has to be known to
 * exist. vtest/reachable.js asked this once, but it asks it of golden_test's
 * settle-only pilot, which is now two structural generations behind the teacher
 * — no hover-slam, no roll damping, no fins in the loop — so its answer is an
 * underestimate of the environment and says nothing about the current one.
 *
 * Method, and its two rules, both inherited from reachable.js because they are
 * the right ones:
 *
 *   DRIVE THE REAL SIMULATOR. Every trajectory is flown by world.js. A
 *   reimplementation measures the model rather than the system, and this project
 *   has already been bitten by exactly that.
 *
 *   BIAS TOWARD CLAIMING REACHABILITY. Take the UNION over a spread of gain sets:
 *   an episode counted here is one where a concrete controller was found that
 *   caught it, so a positive is a proof by example. A negative is only evidence
 *   that this spread did not find one, which is why the number is reported as a
 *   LOWER BOUND and the per-episode winner count is printed alongside — if most
 *   caught episodes are caught by exactly one variant, the spread is too coarse
 *   and the true ceiling is higher than this says.
 *
 *   node vtest/ceiling.js [n] [stages] [variants]
 */
"use strict";

const os = require("os");
const { fork } = require("child_process");

const N = Number(process.argv[2] || 120);
const STAGES = (process.argv[3] || "2,3").split(",").map(Number);
const NVAR = Number(process.argv[4] || 24);
const BASE = Number(process.env.BASE || 960000);
const WORKERS = Number(process.env.WORKERS || Math.max(1, Math.min(48, os.cpus().length - 2)));

const PARAMS = [
    ["SLAM", "hHand", 0.5], ["SLAM", "vHand", 0.5], ["SLAM", "ignMargin", 0.5],
    ["SLAM", "aLatFrac", 0.6], ["SLAM", "zemK", 0.6], ["SLAM", "aoaMax", 0.6],
    ["K", "kpPos", 0.7], ["K", "kdPos", 0.7], ["K", "aLatMax", 0.8],
    ["K", "slope", 0.6], ["K", "kvz", 0.5], ["K", "slotX", 0.8], ["K", "slotH", 0.8],
    ["K", "vTouch", 0.5], ["K", "qMargin", 0.4], ["K", "qLook", 0.6],
    ["K", "aoaMax", 0.6], ["ROLL", "kRoll", 0.5], ["ROLL", "finAtt", 0.7]
];

if (process.env.CEIL_CHILD === "1") {
    const WM = require("../world.js");
    const SC = require("../scenarios.js");
    const TEACH = require("../distill/teacher.js");
    const out = new Float64Array(WM.N_OUT);
    const policy = (w, o) => { TEACH.advise(w, out); o.set(out); return o; };
    const GROUPS = { SLAM: TEACH.SLAM, K: TEACH.K, ROLL: TEACH.ROLL };
    const BASELINE = {};
    for (const [g, n] of PARAMS) BASELINE[g + "." + n] = GROUPS[g][n];

    process.on("message", (msg) => {
        if (msg === "done") { process.exit(0); return; }
        const { idx, cfg, stage } = msg;
        for (const [g, nm] of PARAMS) GROUPS[g][nm] = BASELINE[g + "." + nm];
        for (const k in cfg) { const [g, nm] = k.split("."); GROUPS[g][nm] = cfg[k]; }
        const hits = [];
        for (let i = 0; i < N; i++) {
            const sc = SC.makeScenario(stage, BASE + stage * 100003 + i * 7919);
            sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
            const w = new WM.World(sc);
            const r = w.runEpisode(policy);
            if (WM.OUTCOME_NAME[r.outcome] === "caught") hits.push(i);
        }
        process.send({ idx, stage, hits });
    });
    process.send("ready");
} else {
    let seed = Number(process.env.SEED || 424242);
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

    const T0 = require("../distill/teacher.js");
    const G0 = { SLAM: T0.SLAM, K: T0.K, ROLL: T0.ROLL };
    const VARIANTS = [{}];                       // the teacher as it stands
    for (let i = 1; i < NVAR; i++) {
        const c = {};
        const k = 3 + Math.floor(rnd() * 6);
        const picked = new Set();
        while (picked.size < k) picked.add(PARAMS[Math.floor(rnd() * PARAMS.length)]);
        for (const [g, nm, sp] of picked) c[g + "." + nm] = G0[g][nm] * Math.exp(gauss() * sp);
        VARIANTS.push(c);
    }

    const JOBS = [];
    for (const stage of STAGES) for (let v = 0; v < VARIANTS.length; v++) JOBS.push({ stage, v });
    console.log(`ceiling · ${N} episodes x ${VARIANTS.length} variants x stages ${STAGES.join(",")} ` +
        `(bank ${BASE}) · ${WORKERS} workers`);

    const won = {};       // stage -> episode -> how many variants caught it
    for (const s of STAGES) won[s] = new Array(N).fill(0);
    const baseHits = {};
    let next = 0, done = 0;
    const kids = [];
    for (let k = 0; k < Math.min(WORKERS, JOBS.length); k++) {
        const kid = fork(__filename, process.argv.slice(2), { env: Object.assign({}, process.env, { CEIL_CHILD: "1" }) });
        kids.push(kid);
        kid.on("message", (m) => {
            if (m === "ready") { feed(kid); return; }
            for (const i of m.hits) won[m.stage][i]++;
            if (m.idx === 0 || JOBS[m.idx] && JOBS[m.idx].v === 0) baseHits[m.stage] = m.hits.length;
            done++; process.stderr.write(`\r  ${done}/${JOBS.length}`);
            if (done === JOBS.length) report();
            feed(kid);
        });
    }
    function feed(kid) {
        if (next >= JOBS.length) return;
        const idx = next++;
        kid.send({ idx, stage: JOBS[idx].stage, cfg: VARIANTS[JOBS[idx].v] });
    }
    function report() {
        console.log(`\n`);
        for (const s of STAGES) {
            const w = won[s];
            const any = w.filter(c => c > 0).length;
            const only1 = w.filter(c => c === 1).length;
            const robust = w.filter(c => c >= VARIANTS.length * 0.5).length;
            console.log(`  stage ${s}:`);
            console.log(`    caught by the teacher as it stands : ${baseHits[s] === undefined ? "?" : baseHits[s]}/${N}` +
                (baseHits[s] === undefined ? "" : ` (${(100 * baseHits[s] / N).toFixed(0)}%)`));
            console.log(`    caught by AT LEAST ONE variant     : ${any}/${N} (${(100 * any / N).toFixed(0)}%)   <- lower bound on the ceiling`);
            console.log(`    caught by at least half of them    : ${robust}/${N} (${(100 * robust / N).toFixed(0)}%)   <- what a single robust set could hope for`);
            console.log(`    caught by exactly one variant      : ${only1}/${N}   ` +
                (only1 > any * 0.3 ? "(a big share — the spread is coarse, the true ceiling is higher than the bound)"
                                   : "(few — the bound is reasonably tight)"));
        }
        for (const kid of kids) { try { kid.kill(); } catch (e) { void e; } }
        process.exit(0);
    }
}
