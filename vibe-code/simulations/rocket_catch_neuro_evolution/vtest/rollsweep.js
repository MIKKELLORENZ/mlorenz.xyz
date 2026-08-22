/* rollsweep.js — how hard should the fins damp roll, and does it buy catches?
 *
 * The gate diagnostic decomposed says roll IS the body-rate term: pitch/yaw
 * arrives at 0.44 deg/s against a 3.5 limit while roll arrives at 5.48, and 94
 * of 121 stage-0 misses would pass the rate term with roll zeroed. The fins are
 * the only roll authority a booster has and they were sitting at neutral.
 *
 * kRoll 0 is the control and is measured through this same harness on these same
 * seeds, because "it was 20% yesterday" is not a control.
 *
 * TUNED ON ITS OWN SEEDS (base 500000). The report bank at 960000 is untouched,
 * so the winner gets re-flown somewhere it has never been.
 *
 *   node vtest/rollsweep.js [episodesPerStage] [stages]
 */
"use strict";

const os = require("os");
const { fork } = require("child_process");

const N = Number(process.argv[2] || 200);
const STAGES = (process.argv[3] || "0,1").split(",").map(Number);
const BASE = Number(process.env.BASE || 500000);
const WORKERS = Number(process.env.WORKERS || Math.max(1, Math.min(60, os.cpus().length - 2)));

const GRID = [];
for (const kRoll of [0, 0.2, 0.5, 0.8, 1.2, 1.8, 2.6, 4.0]) {
    for (const qFin of [40, 150, 600]) {
        if (kRoll === 0 && qFin !== 150) continue;     // one control is enough
        GRID.push({ kRoll, qFin });
    }
}

if (process.env.ROLL_CHILD === "1") {
    const WM = require("../world.js");
    const SC = require("../scenarios.js");
    const TEACH = require("../distill/teacher.js");
    const out = new Float64Array(WM.N_OUT);
    const policy = (w, o) => { TEACH.advise(w, out); o.set(out); return o; };

    process.on("message", (msg) => {
        if (msg === "done") { process.exit(0); return; }
        const { idx, cfg } = msg;
        Object.assign(TEACH.ROLL, cfg);
        let caught = 0, sum = 0;
        const rate = [], across = [], vz = [], tally = {};
        for (const stage of STAGES) {
            for (let i = 0; i < N; i++) {
                const sc = SC.makeScenario(stage, BASE + stage * 100003 + i * 7919);
                sc.catchAllowed = 1; sc.revokeAt = null; sc.grantAt = null;
                const w = new WM.World(sc);
                const r = w.runEpisode(policy);
                sum += r.total;
                const nm = WM.OUTCOME_NAME[r.outcome];
                tally[nm] = (tally[nm] || 0) + 1;
                if (nm === "caught") caught++;
                else if (w.acc.gate) {
                    rate.push(w.acc.gate.rate); across.push(Math.abs(w.acc.gate.dx)); vz.push(w.acc.gate.vz);
                }
            }
        }
        const med = (a) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
        process.send({ idx, caught, n: N * STAGES.length, mean: sum / (N * STAGES.length),
                       medRate: med(rate), medAcross: med(across), medVz: med(vz), tally });
    });
    process.send("ready");
} else {
    const DEG = Math.PI / 180;
    console.log(`roll sweep · ${GRID.length} configs x ${N} eps x stages ${STAGES.join(",")} ` +
        `(base ${BASE}) · ${WORKERS} workers`);
    const results = new Array(GRID.length).fill(null);
    let next = 0, done = 0;
    for (let k = 0; k < Math.min(WORKERS, GRID.length); k++) {
        const kid = fork(__filename, process.argv.slice(2), { env: Object.assign({}, process.env, { ROLL_CHILD: "1" }) });
        kid.on("message", (m) => {
            if (m === "ready") { feed(kid); return; }
            results[m.idx] = m; done++;
            process.stderr.write(`\r  ${done}/${GRID.length}`);
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
        const ctrl = rows.find(r => r.kRoll === 0);
        rows.sort((a, b) => b.caught - a.caught);
        console.log(`\n\n  kRoll  qFin    caught           mean   med rate  med across  med vz`);
        for (const r of rows) {
            const pct = 100 * r.caught / r.n;
            const se = 100 * Math.sqrt(pct / 100 * (1 - pct / 100) / r.n);
            console.log(`  ${r.kRoll.toFixed(1).padStart(4)}  ${String(r.qFin).padStart(4)}   ` +
                `${String(r.caught).padStart(3)}/${r.n} (${pct.toFixed(1).padStart(4)}% +/- ${se.toFixed(1)})  ` +
                `${r.mean.toFixed(3).padStart(6)}  ${(r.medRate / DEG).toFixed(2).padStart(6)} d/s  ` +
                `${r.medAcross.toFixed(2).padStart(6)} m  ${r.medVz.toFixed(2).padStart(5)} m/s` +
                (r.kRoll === 0 ? "   <- control" : ""));
        }
        const best = rows[0];
        const p1 = best.caught / best.n, p0 = ctrl.caught / ctrl.n;
        const pp = (best.caught + ctrl.caught) / (best.n + ctrl.n);
        const z = (p1 - p0) / Math.sqrt(pp * (1 - pp) * (2 / best.n) || 1e-9);
        console.log(`\n  best vs control: ${(100 * (p1 - p0)).toFixed(1)} points, z = ${z.toFixed(1)}` +
            `  (winner's curse applies — confirm on the report bank)`);
        console.log(`  control outcomes: ${Object.entries(ctrl.tally).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+" "+v).join(", ")}`);
        console.log(`  best    outcomes: ${Object.entries(best.tally).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+" "+v).join(", ")}`);
    });
}
