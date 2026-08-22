/* teachtune.js — joint random search over the teacher, scored where it is weak.
 *
 * The roll fix moved stages 0 and 1 to 59% and 47%, and left 2 and 3 at 25% and
 * 9%. crashdiag.js says those two fail for reasons the capture box never sees:
 *
 *   stage 2   ran the tank dry 29%   flew into the tower 34%
 *   stage 3   ran the tank dry 14%   flew into the tower 26%   structural 10%
 *
 * Both are approach problems, not arrival problems — the vehicle gets down, and
 * arrives at a median 6.8 m/s (stage 2) and 3.2 m/s (stage 3), so it is not
 * failing to brake. It is spending its propellant and its clearance getting to
 * the right PLACE. Every gain that decides that is searched here together: the
 * approach's aim and ignition, the settle's lateral loop, and the align-then-
 * descend hold that is supposed to stop it flying through the arms.
 *
 * PROTOCOL. Search on base 500000, confirm the leaders on 960000. Tuning and
 * reporting on the same episodes is how this project once crowned a champion
 * that measured 0/200 the moment it saw a fresh bank.
 *
 *   node vtest/teachtune.js [nConfigs] [epsPerStage] [stages]
 */
"use strict";

const os = require("os");
const { fork } = require("child_process");

const NCFG = Number(process.argv[2] || 600);
const NEPS = Number(process.argv[3] || 60);
const STAGES = (process.argv[4] || "2,3").split(",").map(Number);
const BASE = Number(process.env.BASE || 500000);
const CONF_BASE = Number(process.env.CONF_BASE || 960000);
const CONF_N = Number(process.env.CONF_N || 200);
const TOPK = Number(process.env.TOPK || 8);
const WORKERS = Number(process.env.WORKERS || Math.max(1, Math.min(56, os.cpus().length - 2)));

/* Each entry: [group, name, relative spread]. The spread is a log-normal width,
 * so 0.5 means "roughly half to double". Wide on the things crashdiag implicates
 * (lateral authority, the alignment hold, ignition timing), narrow on the ones
 * already measured to be at a plateau (kRoll) or doing their job (attitude). */
/* THE WHOLE CONTROLLER, because the structure underneath these numbers has
 * changed four times since any of them was last searched: the fins now fly roll
 * and the coast, the lateral loop has an integral term, the handover speed is
 * scheduled on the across error, and the fin demand tapers with q. Gains tuned
 * against the old structure are gains for a different vehicle. */
const PARAMS = [
    ["SLAM", "hHand", 0.45], ["SLAM", "vHand", 0.35], ["SLAM", "ignMargin", 0.4],
    ["SLAM", "aLatFrac", 0.5], ["SLAM", "zemK", 0.5], ["SLAM", "aoaMax", 0.4],
    ["SLAM", "vHandLo", 0.35], ["SLAM", "xRef", 0.6],
    ["K", "kpPos", 0.6], ["K", "kdPos", 0.6], ["K", "aLatMax", 0.7],
    ["K", "slope", 0.5], ["K", "kvz", 0.4],
    ["K", "slotX", 0.7], ["K", "slotH", 0.7], ["K", "vTouch", 0.4],
    ["K", "qMargin", 0.35], ["K", "qLook", 0.5], ["K", "qaMargin", 0.35],
    ["K", "aoaMax", 0.4], ["K", "kpAtt", 0.3], ["K", "kdAtt", 0.3],
    ["K", "kiPos", 0.5], ["K", "hInt", 0.6], ["K", "iMax", 0.5], ["K", "xInt", 0.5],
    ["ROLL", "kRoll", 0.4], ["ROLL", "finAtt", 0.5], ["ROLL", "qFin", 0.8],
    ["ROLL", "qSoft", 0.6], ["ROLL", "qFadePow", 0.4]
];

if (process.env.TUNE_CHILD === "1") {
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
        const { idx, cfg, base, n } = msg;
        for (const [g, nm] of PARAMS) GROUPS[g][nm] = BASELINE[g + "." + nm];
        for (const k in cfg) { const [g, nm] = k.split("."); GROUPS[g][nm] = cfg[k]; }

        const per = {};
        let caught = 0, total = 0;
        for (const stage of STAGES) {
            let c = 0;
            for (let i = 0; i < n; i++) {
                const sc = SC.makeScenario(stage, base + stage * 100003 + i * 7919);
                sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
                const w = new WM.World(sc);
                const r = w.runEpisode(policy);
                if (WM.OUTCOME_NAME[r.outcome] === "caught") c++;
            }
            per[stage] = c; caught += c; total += n;
        }
        /* Scored on the WORST stage, not the mean. A set that takes 60% of stage 2
         * and 5% of stage 3 is not a teacher for stages 2 and 3, and averaging
         * hides exactly that; the objective has to want both. */
        const rates = STAGES.map(s => per[s] / n);
        process.send({ idx, per, caught, total, worst: Math.min(...rates), mean: caught / total });
    });
    process.send("ready");
} else {
    let seed = Number(process.env.SEED || 20260817);
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

    const CFGS = [{}];                                   // index 0 is the incumbent
    for (let i = 1; i < NCFG; i++) {
        const c = {};
        /* Perturb a RANDOM SUBSET, not everything. Moving 21 gains at once makes
         * every draw a different controller and the search a lottery; moving a
         * handful keeps most draws near something that already flies. */
        const k = 2 + Math.floor(rnd() * 6);
        const picked = new Set();
        while (picked.size < k) picked.add(PARAMS[Math.floor(rnd() * PARAMS.length)]);
        for (const [g, nm, sp] of picked) c[g + "." + nm] = null;   // filled by the child's baseline * factor
        for (const key in c) {
            const p = PARAMS.find(([g, nm]) => g + "." + nm === key);
            c[key] = { factor: Math.exp(gauss() * p[2]) };
        }
        CFGS.push(c);
    }

    console.log(`teacher tune · ${NCFG} configs x ${NEPS} eps x stages ${STAGES.join(",")} ` +
        `(search base ${BASE}) · ${WORKERS} workers`);

    /* The child needs absolute values, so resolve factors against the incumbent
     * here — one require of the teacher in the parent, purely to read gains. */
    const T0 = require("../distill/teacher.js");
    const G0 = { SLAM: T0.SLAM, K: T0.K, ROLL: T0.ROLL };
    for (const c of CFGS) for (const key in c) {
        const [g, nm] = key.split(".");
        c[key] = G0[g][nm] * c[key].factor;
    }

    const results = new Array(CFGS.length).fill(null);
    let next = 0, done = 0;
    const kids = [];
    for (let k = 0; k < Math.min(WORKERS, CFGS.length); k++) {
        const kid = fork(__filename, process.argv.slice(2), { env: Object.assign({}, process.env, { TUNE_CHILD: "1" }) });
        kids.push(kid);
        kid.on("message", (m) => {
            if (m === "ready") { feed(kid); return; }
            results[m.idx] = m; done++;
            if (done % 20 === 0 || done === CFGS.length) process.stderr.write(`\r  search ${done}/${CFGS.length}`);
            feed(kid);
        });
    }
    function feed(kid) {
        /* Idle, do NOT retire. The confirm phase reuses these same workers, and
         * sending "done" here exits them so the first confirm send hits a closed
         * IPC channel. They are killed once, at the end. */
        if (next >= CFGS.length) return;
        const idx = next++;
        kid.send({ idx, cfg: CFGS[idx], base: BASE, n: NEPS });
    }

    let phase = "search";
    const check = setInterval(() => {
        if (phase !== "search" || results.some(r => !r)) return;
        phase = "confirm";
        clearInterval(check);
        const rows = results.map((r, i) => Object.assign({}, r, { cfg: CFGS[i] }));
        const inc = rows[0];
        rows.sort((a, b) => b.worst - a.worst || b.mean - a.mean);
        console.log(`\n\n  search leaders (objective = worst stage):`);
        for (const r of rows.slice(0, TOPK)) {
            console.log(`   worst ${(100 * r.worst).toFixed(1).padStart(5)}%  mean ${(100 * r.mean).toFixed(1).padStart(5)}%  ` +
                STAGES.map(s => `s${s} ${r.per[s]}/${NEPS}`).join("  "));
        }
        console.log(`   incumbent: worst ${(100 * inc.worst).toFixed(1)}%  mean ${(100 * inc.mean).toFixed(1)}%  ` +
            STAGES.map(s => `s${s} ${inc.per[s]}/${NEPS}`).join("  "));

        /* CONFIRM on a bank none of them was selected against, incumbent included
         * so the comparison is like for like. */
        const finalists = [{ cfg: {}, tag: "incumbent" }].concat(
            rows.slice(0, TOPK).map((r, i) => ({ cfg: r.cfg, tag: `leader ${i + 1}` })));
        console.log(`\n  confirming ${finalists.length} on base ${CONF_BASE}, ${CONF_N} eps/stage ...`);
        const conf = new Array(finalists.length).fill(null);
        let cnext = 0, cdone = 0;
        for (const kid of kids) {
            kid.removeAllListeners("message");
            kid.on("message", (m) => {
                conf[m.idx] = m; cdone++;
                process.stderr.write(`\r  confirm ${cdone}/${finalists.length}`);
                if (cdone === finalists.length) report();
                cfeed(kid);
            });
            cfeed(kid);
        }
        function cfeed(kid) {
            if (cnext >= finalists.length) return;
            const idx = cnext++;
            kid.send({ idx, cfg: finalists[idx].cfg, base: CONF_BASE, n: CONF_N });
        }
        function report() {
            console.log(`\n\n  CONFIRMED on the report bank (${CONF_N} eps/stage):`);
            const scored = conf.map((r, i) => Object.assign({}, r, finalists[i]));
            const base0 = scored[0];
            scored.sort((a, b) => b.worst - a.worst || b.mean - a.mean);
            for (const r of scored) {
                console.log(`   ${r.tag.padEnd(10)} worst ${(100 * r.worst).toFixed(1).padStart(5)}%  ` +
                    `mean ${(100 * r.mean).toFixed(1).padStart(5)}%  ` +
                    STAGES.map(s => `s${s} ${r.per[s]}/${CONF_N} (${(100 * r.per[s] / CONF_N).toFixed(0)}%)`).join("  ") +
                    (r.tag === "incumbent" ? "   <- incumbent" : ""));
            }
            const win = scored[0];
            if (win.tag !== "incumbent") {
                console.log(`\n  winner vs incumbent: worst ${(100 * (win.worst - base0.worst)).toFixed(1)} points`);
                console.log(`  gains:`);
                for (const k in win.cfg) console.log(`    ${k}: ${win.cfg[k]}`);
                console.log(`\n  JSON: ${JSON.stringify(win.cfg)}`);
            } else {
                console.log(`\n  the incumbent held. No change earned.`);
            }
            for (const kid of kids) { try { kid.kill(); } catch (e) { void e; } }
            process.exit(0);
        }
    }, 400);
}
