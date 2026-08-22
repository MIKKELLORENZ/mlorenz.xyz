/* capture.js — WHY IS RUNG 4 FLAT?
 *
 * Rung 4 is a PRODUCT of five heavy-tailed factors:
 *
 *   C = soft(missN,3) * soft(vzExcess,3) * soft(vhPin,2.5) * soft(tilt,4deg) * soft(rate,4deg)
 *
 * A product is not a gradient in any one of its terms unless the OTHER four are
 * already near one. If each factor sits at 0.5, C = 0.031 and halving the tilt
 * error moves C by 0.010 — well under the 1.17 sd of bank noise this project
 * already measured. That is the same underflow failure the Gaussian kernels had,
 * wearing a different hat: not one kernel that is numerically flat, but five
 * live kernels whose product is.
 *
 * This script does not argue that. It measures it: fly a champion over the
 * held-out exam, print every factor separately, and report what the marginal
 * return on fixing each ONE of them actually is with the others held where they
 * are. If one factor is the binding constraint the fix is to fix that factor; if
 * they are all mid-range the fix is the product.
 *
 *   node capture.js <champ.json|pilot> [stage] [n]
 */
"use strict";


const NN = require("../nn.js");
const SC = require("../scenarios.js");
const WM = require("../world.js");
const V = require("../vehicle.js");
const M = require("../mathx.js");
const GOLD = require("../golden_test.js");
const fs = require("fs");
const DEG = Math.PI / 180;
const soft = M.soft;

const who = process.argv[2];
const STAGE = Number(process.argv[3] || 0);
const N = Number(process.argv[4] || 36);

let mkPolicy;
if (who === "pilot") {
    /* A FRESH PILOT PER EPISODE. makePilot closes over lit/rung/vCap, so one
     * instance reused across a bank carries its ignition state into the next
     * flight: it reported 20 breakups and 1 catch, which is a leaked latch, not
     * a pilot. golden_test.js builds one per episode for exactly this reason. */
    mkPolicy = () => GOLD.makePilot(GOLD.GAINS);
} else {
    const raw = JSON.parse(fs.readFileSync(who, "utf8"));
    const brain = NN.Brain.fromJSON(raw.brain || raw);
    console.log(`${who} · gen ${raw.gen} · shape ${brain.net.sizes.join("-")}`);
    mkPolicy = () => { const pol = new NN.BrainPolicy(brain); pol.reset(); return (w, o) => pol.act(w, o); };
}

const bank = SC.examBank(N).filter(s => s.stage === STAGE);
const c = V.TOWER.capture;

const rows = [];
for (const sc of bank) {
    const w = new WM.World(sc);
    const r = w.runEpisode(mkPolicy());
    const s = w.termState;
    const missN = Math.hypot((s.gateDx || 0) / c.across, (s.gateDy || 0) / c.along);
    const f = {
        miss: soft(missN, 3.0),
        vz: soft(Math.max(0, s.vzPin - c.vz), 3.0),
        vh: soft(s.vhPin, 2.5),
        tilt: soft(s.tilt, 4 * DEG),
        rate: soft(s.rate, 4 * DEG)
    };
    rows.push({
        seed: sc.seed, out: WM.OUTCOME_NAME[r.outcome], f,
        C: f.miss * f.vz * f.vh * f.tilt * f.rate,
        raw: { missN, dx: s.gateDx, dy: s.gateDy, dz: s.gateDz, vz: s.vzPin, vh: s.vhPin,
               tilt: s.tilt / DEG, rate: s.rate / DEG, alt: s.alt, commit: s.commit },
        p: r.phases
    });
}

const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const KEYS = ["miss", "vz", "vh", "tilt", "rate"];

console.log(`\nstage ${STAGE} · ${rows.length} held-out episodes\n`);
console.log("  seed        outcome      missN     vzPin   vhPin    tilt    rate |  f_miss  f_vz  f_vh  f_tlt  f_rat |      C     p3     p4");
for (const r of rows.slice(0, 14)) {
    console.log(`  ${String(r.seed).padStart(10)} ${r.out.padEnd(12)}` +
        `${r.raw.missN.toFixed(1).padStart(7)}${r.raw.vz.toFixed(1).padStart(10)}${r.raw.vh.toFixed(1).padStart(8)}` +
        `${r.raw.tilt.toFixed(1).padStart(8)}${r.raw.rate.toFixed(1).padStart(8)} |` +
        KEYS.map(k => r.f[k].toFixed(2).padStart(6)).join("") +
        ` |${r.C.toFixed(4).padStart(8)}${r.p[2].toFixed(3).padStart(7)}${r.p[3].toFixed(3).padStart(7)}`);
}

console.log(`\n  MEDIAN FACTORS  ` + KEYS.map(k => `${k} ${med(rows.map(r => r.f[k])).toFixed(3)}`).join("  "));
console.log(`  MEDIAN C ${med(rows.map(r => r.C)).toFixed(4)} · mean C ${(rows.reduce((a, r) => a + r.C, 0) / rows.length).toFixed(4)}` +
    ` · mean p3 ${(rows.reduce((a, r) => a + r.p[2], 0) / rows.length).toFixed(3)}` +
    ` · mean p4 ${(rows.reduce((a, r) => a + r.p[3], 0) / rows.length).toFixed(3)}`);

/* THE MARGINAL-RETURN TABLE. For each factor, what would C become if THAT ONE
 * were perfect and the other four stayed exactly where they are? This is the
 * question selection is implicitly asking every generation, and if every answer
 * is small then no single improvement is visible above bank noise. */
console.log(`\n  if this factor alone went to 1.0, mean C would be:`);
const meanC = rows.reduce((a, r) => a + r.C, 0) / rows.length;
for (const k of KEYS) {
    const m = rows.reduce((a, r) => a + r.C / Math.max(1e-9, r.f[k]), 0) / rows.length;
    console.log(`    ${k.padEnd(6)} ${m.toFixed(4)}   (delta ${(m - meanC).toFixed(4)}, x${(m / Math.max(1e-9, meanC)).toFixed(1)})`);
}
const allPerfect = rows.length ? 1 : 1;
console.log(`    ALL    1.0000   (this is a catch)`);

/* And the reverse: how far is each raw quantity from the actual capture gate? */
console.log(`\n  median raw vs capture tolerance:`);
console.log(`    |dx|   ${med(rows.map(r => Math.abs(r.raw.dx))).toFixed(1)} m   gate ${c.across} m`);
console.log(`    |dy|   ${med(rows.map(r => Math.abs(r.raw.dy))).toFixed(1)} m   gate ${c.along} m`);
console.log(`    vzPin  ${med(rows.map(r => r.raw.vz)).toFixed(1)} m/s gate ${c.vz} m/s`);
console.log(`    vhPin  ${med(rows.map(r => r.raw.vh)).toFixed(1)} m/s gate ${c.vh} m/s`);
console.log(`    tilt   ${med(rows.map(r => r.raw.tilt)).toFixed(1)} deg gate ${(c.tilt / DEG).toFixed(1)} deg`);
console.log(`    rate   ${med(rows.map(r => r.raw.rate)).toFixed(1)} deg/s gate ${(c.rate / DEG).toFixed(1)}`);
console.log(`    alt    ${med(rows.map(r => r.raw.alt)).toFixed(1)} m (AGL at termination)`);
console.log(`    commit ${rows.filter(r => r.raw.commit > 0).length}/${rows.length} episodes committed to the catch`);

const t = {};
for (const r of rows) t[r.out] = (t[r.out] || 0) + 1;
console.log(`\n  outcomes: ` + Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
