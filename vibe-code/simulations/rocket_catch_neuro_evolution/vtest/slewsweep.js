/* slewsweep.js — does slew-limiting the attitude COMMAND buy catches?
 *
 * The gate diagnostic says body rate is the largest single item in the project:
 * on stage 0 it fails 81% of misses and 44% of them ON ITS OWN, and the picture
 * is the same or worse on 1, 2 and 3. CALM already attacked it by fading the
 * lateral command and measured a net zero, because fading discards the lateral
 * correction as it calms the vehicle. SLEW attacks the same term by limiting how
 * fast the commanded direction may ROTATE, which is meant to keep the correction.
 *
 * That is an argument. This is the measurement.
 *
 * TUNED ON ITS OWN SEEDS. The sweep draws from base 500000. The gate diagnostic
 * and the report bank live at 960000, so whatever wins here is re-flown on
 * episodes it never saw — the discipline the rest of this project already pays
 * for, having once crowned a champion on the bank it was bred against.
 *
 *   node vtest/slewsweep.js [episodesPerStage] [stages]
 */
"use strict";

const path = require("path");
const os = require("os");
const { fork } = require("child_process");

const N = Number(process.argv[2] || 200);
const STAGES = (process.argv[3] || "0,1").split(",").map(Number);
const BASE = Number(process.env.BASE || 500000);
const WORKERS = Number(process.env.WORKERS || Math.max(1, Math.min(60, os.cpus().length - 2)));

/* The grid. hSlew is how far above the rails the limit starts to bite; slewLo is
 * what the command is allowed to do AT the rails. slewHi stays unlimited — the
 * approach and the early settle are not what is broken. hSlew 0 is the control,
 * and it is deliberately included rather than assumed: an unchanged run through
 * the same harness on the same seeds is the only honest baseline. */
const GRID = [];
GRID.push({ hSlew: 0, slewHi: 1, slewLo: 1 });                      // control
for (const hSlew of [30, 60, 120, 220]) {
    for (const slewHi of [0.15, 0.4, 1.0]) {
        for (const slewLo of [0.002, 0.008, 0.03, 0.08]) {
            if (slewLo >= slewHi) continue;
            GRID.push({ hSlew, slewHi, slewLo });
        }
    }
}

if (process.env.SLEW_CHILD === "1") {
    const WM = require("../world.js");
    const SC = require("../scenarios.js");
    const TEACH = require("../distill/teacher.js");
    const out = new Float64Array(WM.N_OUT);
    const policy = (w, o) => { TEACH.advise(w, out); o.set(out); return o; };

    process.on("message", (msg) => {
        if (msg === "done") { process.exit(0); return; }
        const { idx, cfg } = msg;
        Object.assign(TEACH.SLEW, cfg);
        let caught = 0, sum = 0, rate = [], across = [];
        for (const stage of STAGES) {
            for (let i = 0; i < N; i++) {
                const sc = SC.makeScenario(stage, BASE + stage * 100003 + i * 7919);
                sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
                const w = new WM.World(sc);
                const r = w.runEpisode(policy);
                sum += r.total;
                if (WM.OUTCOME_NAME[r.outcome] === "caught") caught++;
                else if (w.acc.gate) { rate.push(w.acc.gate.rate); across.push(Math.abs(w.acc.gate.dx)); }
            }
        }
        const med = (a) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
        process.send({ idx, caught, n: N * STAGES.length, mean: sum / (N * STAGES.length),
                       medRate: med(rate), medAcross: med(across) });
    });
    process.send("ready");
} else {
    const DEG = Math.PI / 180;
    console.log(`slew sweep · ${GRID.length} configs x ${N} eps x stages ${STAGES.join(",")} ` +
        `(base ${BASE}) · ${WORKERS} workers`);

    const results = new Array(GRID.length).fill(null);
    let next = 0, done = 0;
    const kids = [];
    for (let k = 0; k < Math.min(WORKERS, GRID.length); k++) {
        const kid = fork(__filename, process.argv.slice(2), { env: Object.assign({}, process.env, { SLEW_CHILD: "1" }) });
        kids.push(kid);
        kid.on("message", (m) => {
            if (m === "ready") { feed(kid); return; }
            results[m.idx] = m; done++;
            if (done % 5 === 0 || done === GRID.length) process.stderr.write(`\r  ${done}/${GRID.length}`);
            feed(kid);
        });
    }
    function feed(kid) {
        if (next >= GRID.length) { kid.send("done"); return; }
        const idx = next++;
        kid.send({ idx, cfg: GRID[idx] });
    }
    process.on("exit", () => {
        if (results.some(r => !r)) return;
        const rows = results.map((r, i) => Object.assign({}, r, GRID[i]));
        const ctrl = rows[0];
        rows.sort((a, b) => b.caught - a.caught);
        console.log(`\n\n  hSlew  slewHi  slewLo   caught          mean    med rate   med across`);
        for (const r of rows) {
            const pct = 100 * r.caught / r.n;
            const se = 100 * Math.sqrt(pct / 100 * (1 - pct / 100) / r.n);
            const tag = (r.hSlew === 0) ? "  <- control" : "";
            console.log(`  ${String(r.hSlew).padStart(5)}  ${r.slewHi.toFixed(2).padStart(5)}  ${r.slewLo.toFixed(3)}   ` +
                `${String(r.caught).padStart(3)}/${r.n} (${pct.toFixed(1).padStart(4)}% +/- ${se.toFixed(1)})  ` +
                `${r.mean.toFixed(3).padStart(6)}   ${(r.medRate / DEG).toFixed(2).padStart(6)} d/s  ` +
                `${r.medAcross.toFixed(2).padStart(6)} m${tag}`);
        }
        const best = rows[0];
        const dp = 100 * (best.caught - ctrl.caught) / best.n;
        const sePool = 100 * Math.sqrt(2 * (best.caught / best.n) * (1 - best.caught / best.n) / best.n);
        console.log(`\n  best vs control: ${dp > 0 ? "+" : ""}${dp.toFixed(1)} points, ` +
            `about ${Math.abs(dp / (sePool || 1)).toFixed(1)} pooled SE ` +
            `(winner's curse applies — re-fly on a fresh bank before believing it)`);
    });
}
