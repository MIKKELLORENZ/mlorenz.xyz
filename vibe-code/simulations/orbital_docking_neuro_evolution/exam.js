/* exam.js — score one or more brain files (or the autopilot) on a fixed,
 * held-out bank of auditioned scenarios, in parallel.
 *
 *   node exam.js --brains default_brain.js,training/best.json --per 8 --workers 48
 *
 * The bank is a pure function of (stage, seed), so the same --seedbase gives
 * the same scenarios in every process and every run: two brains compared here
 * are compared on identical episodes with identical sensor noise (common
 * random numbers), which is the only way a difference of 0.05 advantage means
 * anything at all.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { Worker, isMainThread, parentPort } = require("worker_threads");

const SIM_FILES = ["nn.js", "orbit.js", "craft.js", "station.js", "sensors.js",
    "scenarios.js", "pilot.js", "world.js", "evolution.js"];
function loadSim() {
    for (const f of SIM_FILES) {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
    }
}

function unpack(o) {
    if (o === "PILOT" || o === "NULL") return o;
    const b = new Brain(o.spec, null);
    for (const k of ["trunk", "guid", "ctrl"]) {
        for (let l = 0; l < b[k].weights.length; l++) {
            b[k].weights[l].set(o[k].weights[l]);
            b[k].scales[l] = o[k].scales[l];
        }
    }
    return b;
}
function pack(b) {
    const p = (st) => ({ sizes: st.sizes, scales: st.scales.slice(), weights: st.weights.map(w => new Float32Array(w)) });
    return { spec: b.spec, trunk: p(b.trunk), guid: p(b.guid), ctrl: p(b.ctrl) };
}

if (!isMainThread) {
    loadSim();
    let nets = [];
    parentPort.on("message", (m) => {
        if (m.stop) { process.exit(0); return; }
        if (m.nets) { nets = m.nets.map(unpack); parentPort.postMessage({ tag: m.tag, ok: 1 }); return; }
        if (m.jobs) {
            const out = m.jobs.map(j => {
                const sc = makeScenario(j.stage, j.seed);
                sc.sNull = j.sNull; sc.sPilot = j.sPilot; sc.nullBest = j.nullBest;
                const a = nets[j.n] === "PILOT" ? new Pilot(sc, new Station(sc.station))
                    : (nets[j.n] === "NULL" ? null : nets[j.n]);
                const r = runEpisode(sc, a, { noiseSeed: j.noiseSeed });
                return {
                    n: j.n, stage: j.stage, adv: r.advantage, docked: r.docked, contact: r.contact,
                    outcome: r.outcome, best: r.bestRange, dv: r.dv, t: r.t
                };
            });
            parentPort.postMessage({ tag: m.tag, out });
            return;
        }
        if (m.cal) {
            const out = m.cal.map(j => {
                const sc = makeScenario(j.stage, j.seed);
                calibrate(sc);
                return {
                    stage: j.stage, seed: j.seed, sNull: sc.sNull, sPilot: sc.sPilot,
                    nullBest: sc.nullBest, usable: sc.usable, pilotDocked: sc.pilotDocked
                };
            });
            parentPort.postMessage({ tag: m.tag, out });
            return;
        }
    });
    return;
}

loadSim();
const argv = process.argv.slice(2);
function arg(n, d) { const i = argv.indexOf("--" + n); if (i < 0) return d; const v = argv[i + 1]; return v === undefined || v.startsWith("--") ? true : v; }

const CFG = {
    brains: String(arg("brains", "")).split(",").filter(Boolean),
    per: parseInt(arg("per", 8), 10),
    stages: String(arg("stages", "0,1,2,3,4,5")).split(",").map(Number),
    seedbase: parseInt(arg("seedbase", 90000), 10),
    workers: parseInt(arg("workers", Math.max(1, Math.min(8, os.cpus().length - 2))), 10),
    pilot: arg("pilot", null) !== null,
    json: arg("json", null)
};

const names = [];
const packed = [];
for (const f of CFG.brains) {
    const raw = fs.readFileSync(f, "utf8");
    const txt = raw.indexOf("window.DEFAULT_BRAIN") >= 0
        ? raw.slice(raw.indexOf("=", raw.indexOf("window.DEFAULT_BRAIN")) + 1).trim().replace(/;\s*$/, "")
        : raw;
    const o = JSON.parse(txt);
    const net = o.net || o;
    if (net.spec.nin !== NIN) { console.error(f + ": " + net.spec.nin + " inputs, build is " + NIN); process.exit(1); }
    names.push(path.basename(f)); packed.push(pack(Brain.fromJSON(net).calibrate()));
}
if (CFG.pilot) { names.push("PILOT"); packed.push("PILOT"); }

const workers = [];
for (let i = 0; i < CFG.workers; i++) workers.push(new Worker(__filename));
let tagSeq = 0;
function ask(w, msg) {
    return new Promise(res => {
        const tag = ++tagSeq;
        const on = (m) => { if (m.tag !== tag) return; w.off("message", on); res(m); };
        w.on("message", on); w.postMessage(Object.assign({ tag }, msg));
    });
}

/* A work queue, one job per pull: episode cost varies ~50x here (a stage-0
 * approach against a 13,000 s far rendezvous), so a static split leaves most
 * of the box idle waiting on whichever worker drew the long ones. */
async function dispatch(jobs, key) {
    const out = [];
    let next = 0;
    await Promise.all(workers.map(async (w) => {
        for (; ;) {
            const i = next++;
            if (i >= jobs.length) break;
            const m = await ask(w, { [key]: [jobs[i]] });
            out.push.apply(out, m.out);
        }
    }));
    return out;
}

(async () => {
    /* Audition the bank exactly as training does, so a brain is examined only
     * on scenarios the autopilot can fly and coasting cannot solve. */
    const want = [];
    for (const st of CFG.stages) for (let i = 0; i < CFG.per; i++) want.push({ stage: st, seed: CFG.seedbase + st * 1013 + i * 71 });
    const bank = [];
    let pool = want.slice(), attempt = 0;
    while (pool.length && attempt < 7) {
        const got = await dispatch(pool, "cal");
        const retry = [];
        for (const g of got) { if (g.usable) bank.push(g); else retry.push({ stage: g.stage, seed: g.seed + 7717 * (attempt + 1) }); }
        pool = retry; attempt++;
    }
    console.log("bank " + bank.length + " scenarios (" + want.length + " wanted, " + attempt + " audition rounds)");

    await Promise.all(workers.map(w => ask(w, { nets: packed })));
    const jobs = [];
    for (let n = 0; n < packed.length; n++) for (let s = 0; s < bank.length; s++)
        jobs.push(Object.assign({ n: n, noiseSeed: 5000 + s * 17 }, bank[s]));
    const res = await dispatch(jobs, "jobs");

    const rows = [];
    for (let n = 0; n < packed.length; n++) {
        const mine = res.filter(r => r.n === n);
        const byStage = {};
        for (const st of CFG.stages) {
            const g = mine.filter(r => r.stage === st);
            if (!g.length) continue;
            byStage[st] = {
                adv: g.reduce((a, r) => a + r.adv, 0) / g.length,
                dock: g.reduce((a, r) => a + r.docked, 0) / g.length,
                contact: g.reduce((a, r) => a + r.contact, 0) / g.length, n: g.length
            };
        }
        const adv = mine.reduce((a, r) => a + r.adv, 0) / mine.length;
        const sd = Math.sqrt(mine.reduce((a, r) => a + (r.adv - adv) * (r.adv - adv), 0) / Math.max(1, mine.length - 1));
        const dock = mine.reduce((a, r) => a + r.docked, 0) / mine.length;
        const contact = mine.reduce((a, r) => a + r.contact, 0) / mine.length;
        const oc = {};
        for (const r of mine) oc[r.outcome] = (oc[r.outcome] || 0) + 1;
        rows.push({ name: names[n], adv, se: sd / Math.sqrt(mine.length), dock, contact, byStage, outcomes: oc, n: mine.length });
        console.log("\n" + names[n] + "  adv " + adv.toFixed(3) + " +/-" + (sd / Math.sqrt(mine.length)).toFixed(3) +
            "  dock " + (dock * 100).toFixed(0) + "%  contact " + (contact * 100).toFixed(0) + "%  (n=" + mine.length + ")");
        for (const st of CFG.stages) if (byStage[st]) console.log(
            "   stage " + st + " " + STAGES[st].short.padEnd(10) + " adv " + byStage[st].adv.toFixed(3) +
            "  dock " + (byStage[st].dock * 100).toFixed(0) + "%  contact " + (byStage[st].contact * 100).toFixed(0) + "%");
        console.log("   " + Object.entries(oc).sort((a, b) => b[1] - a[1]).map(kv => kv[0] + ":" + kv[1]).join(" "));
    }
    if (CFG.json) fs.writeFileSync(String(CFG.json), JSON.stringify({ bank: bank.length, rows }, null, 1));
    for (const w of workers) w.postMessage({ stop: 1 });
})();
