/* calibrate.js — the tool that tunes a new lineage.
 *
 *   node calibrate.js                    every protocol, one summary line each
 *   node calibrate.js dopa               the stage-by-stage table for one
 *   node calibrate.js beta --every 24    coarser table
 *   node calibrate.js kidney --sweep 0   sweep the dose of cue channel 0
 *   node calibrate.js dopa --window 2    sweep the START DAY of channel 2
 *
 * The method, which is the only reason the numbers in lineages.js can be
 * defended: run the published protocol and check the yield, the purity and
 * the timing land in the band the papers report; then move one dose or one
 * day window and check the failure is the failure the papers describe. A
 * lineage is calibrated when both hold, and `experiments.js` freezes the
 * result as regression checks.
 */
"use strict";
require("./harness.js");
const { loadBrainFile } = require("./brainfile.js");

const argv = process.argv.slice(2);
function arg(name, dflt) {
    const i = argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}
/* The positional argument is the lineage key. A flag's value is not a
 * positional argument, which the first version of this got wrong and spent a
 * run insisting that "1" was not a protocol. */
const FLAG_TAKES_VALUE = { seed: 1, level: 1, every: 1, sweep: 1, window: 1, brain: 1, n: 1 };
const which = (() => {
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) { if (FLAG_TAKES_VALUE[a.slice(2)]) i++; continue; }
        return a;
    }
    return null;
})();
const seed = parseInt(arg("seed", 1), 10);
const level = parseInt(arg("level", 0), 10);
const every = parseInt(arg("every", 48), 10);
const pct = (x) => (x * 100).toFixed(0) + "%";

/* --brain runs a trained controller instead of the protocol, and everything
 * below then reads the brain's reactor. This is what probe.js used to do: one
 * run, printed as a lab notebook would see it, which is how you find out what
 * a champion is actually doing rather than what it scores. */
const BRAIN = arg("brain", null) ? Net.fromJSON(loadBrainFile(String(arg("brain"))).net) : null;

function runSOP(L, mod, sd) {
    const w = new World(BRAIN ? [BRAIN] : [], { seed: sd == null ? seed : sd, level, lin: L.idx, withNothing: true, trace: true });
    if (mod) {
        const sop = w.sop.ctrl, orig = sop.step.bind(sop);
        sop.step = (lab, r, t) => { const a = orig(lab, r, t); mod(a, t, r); return a; };
    }
    w.run();
    return w;
}
/* Whose reactor the tables show. */
const driven = (w) => BRAIN ? w.units[0] : w.sop;
const drivenRow = (row) => BRAIN ? row.units[0] : row.sop;

function summary(L, w, label) {
    const r = driven(w).result;
    console.log(`${label.padEnd(26)} score ${r.score.toFixed(1).padStart(7)}  ${L.stages[L.matureIdx].id} ${r.maturePerML.toFixed(2)}` +
        `  product ${r.productPerML.toFixed(2)} M/mL  fold ${r.fold.toFixed(2)}  purity ${pct(r.purity).padStart(4)}` +
        `  ${L.func.label} ${r.func.toFixed(2)}  viab ${pct(r.viability)}  d ${r.aggD.toFixed(0)} µm  resP ${(r.residual * 100).toFixed(2)}%` +
        `  cost ${r.cost.toFixed(0)}${r.failed ? "  FAILED " + r.failReason : ""}`);
    return r;
}

/* ------------------------------------------------- the reference batches */
/* What a good batch of each product IS, measured rather than asserted.
 *
 *   node calibrate.js --refs            15 batches per product, rung 0
 *   node calibrate.js --refs --n 30
 *
 * The score in world.js divides by these (lineages.js `ref`), so that a
 * protocol-quality run of any of the five is worth about the same and the
 * search cannot win by quietly abandoning the hard ones. Setting them by hand
 * was a mistake worth recording: guessing 45 % purity for hepatocytes where
 * the protocol delivers 20 % made that whole lineage score zero, i.e. no
 * better than a reactor nobody touched, and no amount of evolution would ever
 * have made hepatocytes worth making.
 *
 * MEDIAN, not mean: one wrecked batch should not move the yardstick. The
 * output is ready to paste into lineages.js. */
if (arg("refs", null) !== null) {
    const n = parseInt(arg("n", 15), 10);
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : 0.5 * (b[b.length / 2 - 1] + b[b.length / 2]); };
    console.log(`the standard protocol over ${n} batches per product, rung ${level} — medians
`);
    for (const L of LINEAGES) {
        const fold = [], purity = [], func = [], cueBill = [], score = [], term = [], neut = [];
        for (let k = 0; k < n; k++) {
            const w = new World([], { seed: 3000 + k * 97, level, lin: L.idx, withNothing: false }).run();
            const r = driven(w).result;
            if (r.failed) continue;
            fold.push(r.fold); purity.push(r.purity); func.push(r.func);
            cueBill.push(driven(w).r.cost.cue); score.push(r.score); term.push(r.term);
            neut.push(w.neutral.result.score);
        }
        console.log(`  ${L.key.padEnd(8)} n=${fold.length}  fold ${med(fold).toFixed(2)}  purity ${(med(purity) * 100).toFixed(0)}%  ` +
            `${L.func.label} ${med(func).toFixed(2)}  cue bill ${med(cueBill).toFixed(0)}  ` +
            `→ term ${med(term).toFixed(0)} score ${med(score).toFixed(0)} (neutral ${med(neut).toFixed(0)})`);
        console.log(`  ${"".padEnd(8)} ref: { fold: ${med(fold).toFixed(2)}, purity: ${med(purity).toFixed(2)}, ` +
            `func: ${med(func).toFixed(2)}, reagent: ${med(cueBill).toFixed(0)} },`);
    }
    console.log(`
Paste each ref line into its lineage in lineages.js, then re-run this: the`);
    console.log(`protocol should land within a few points of 100 for every product.`);
    process.exit(0);
}

/* ------------------------------------------------------------ all of them */
if (!which) {
    console.log(`the standard protocol for each product, rung ${level}, batch ${seed}\n`);
    for (const L of LINEAGES) {
        const w = runSOP(L);
        const b = w.baselineResults();
        summary(L, w, L.key + " (" + L.days.toFixed(0) + " d)");
        console.log(`${"".padEnd(26)} baselines: neutral ${b.neutral.score.toFixed(1)} (product ${b.neutral.productPerML.toFixed(3)})` +
            `  nothing ${b.nothing.score.toFixed(1)}${b.nothing.failed ? " lost: " + b.nothing.failReason : ""}` +
            `  · advantage denominator ${Math.max(30, b.sop.score - b.neutral.score).toFixed(0)}`);
    }
    process.exit(0);
}

const L = LIN_BY_KEY[which];
if (!L) { console.error(`no such protocol: ${which} (have ${LINEAGES.map(x => x.key).join(", ")})`); process.exit(1); }

/* ------------------------------------------------------------ dose sweep */
if (arg("sweep", null) !== null) {
    const ch = parseInt(arg("sweep"), 10);
    const spec = L.cues[ch];
    if (!spec) { console.error(`${L.key} has no channel ${ch}`); process.exit(1); }
    console.log(`${L.key}: the protocol with channel ${ch} (${spec.short}) scaled — nominal doses are in lineages.js\n`);
    for (const f of [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0]) {
        const w = runSOP(L, (a) => { a.cue[ch] *= f; });
        summary(L, w, `${spec.short} ×${f.toFixed(2)}`);
    }
    process.exit(0);
}

/* ------------------------------------------------- start / stop day sweep */
if (arg("window", null) !== null) {
    const ch = parseInt(arg("window"), 10);
    const spec = L.cues[ch];
    if (!spec) { console.error(`${L.key} has no channel ${ch}`); process.exit(1); }
    // what the protocol itself does with this channel
    const base = runSOP(L);
    const on = base.trace.filter(x => drivenRow(x).act.cue[ch] > 0.02 * spec.hi).map(x => x.t / 24);
    const d0 = on.length ? on[0] : 0, d1 = on.length ? on[on.length - 1] : 0;
    const dose = Math.max(...base.trace.map(x => drivenRow(x).act.cue[ch]));
    console.log(`${L.key}: the protocol runs ${spec.short} at ${dose.toFixed(2)} ${spec.unit} from day ${d0.toFixed(1)} to ${d1.toFixed(1)}.`);
    console.log(`sliding that window while keeping its length:\n`);
    for (const shift of [-4, -2, -1, 0, 1, 2, 4, 8]) {
        const w = runSOP(L, (a, t) => {
            const day = t / 24;
            a.cue[ch] = (day >= d0 + shift && day <= d1 + shift) ? dose : 0;
        });
        summary(L, w, `shift ${shift >= 0 ? "+" : ""}${shift} d`);
    }
    console.log(`\nand stretching it from its start:\n`);
    for (const len of [0.5, 1, 2, 3, 4, 6, 9]) {
        const w = runSOP(L, (a, t) => {
            const day = t / 24;
            a.cue[ch] = (day >= d0 && day <= d0 + len) ? dose : 0;
        });
        summary(L, w, `${len} d long`);
    }
    process.exit(0);
}

/* ------------------------------------------- the fate-split instrument */
/* For each step of the chain, the fraction of the cells LEAVING that stage
 * which arrive at the next one, hour by hour, under the standard protocol.
 *
 * This is the table that calibrates a lineage. A step reading 0.5 while the
 * protocol is being run exactly as published is a modelling error, not a
 * hard protocol: five steps at 0.5 is 3 % purity however good the rest of the
 * plant is, and that is precisely the bug this instrument was written to
 * find. Under a correct protocol every step should read 0.85 or better during
 * the hours when cells are actually committing — and the `flux` column says
 * when those hours are, because a q of 0.2 costs nothing at an hour when
 * nobody is deciding. */
if (arg("steps", null) !== null) {
    const w = runSOP(L);
    const ids = L.stages.map(s => s.id);
    console.log(`${L.key} — the fate split under the standard protocol
`);
    console.log(`each column: q = fraction going the right way (and the flux out of that stage, %/h)
`);
    console.log(`${"day".padStart(5)} ` + ids.slice(0, L.nStage - 1).map((id, i) => `${id}→${ids[i + 1]}`.padStart(16)).join(""));
    for (const row of w.trace) {
        if (Math.round(row.t) % every !== 0) continue;
        const s = drivenRow(row);
        let line = `${(s.t / 24).toFixed(1).padStart(5)} `;
        for (let i = 0; i < L.nStage - 1; i++) {
            const flux = s.kOut[i] * 100, q = s.qRight[i];
            line += `${q.toFixed(2)} (${flux.toFixed(1)}%)`.padStart(16);
        }
        console.log(line);
    }
    console.log("");
    /* ...and the same thing weighted by how many cells were actually flowing:
     * the number that decides the purity of the batch. */
    console.log("cells-weighted mean q per step (the one that compounds):");
    let compound = 1;
    for (let i = 0; i < L.nStage - 1; i++) {
        let num = 0, den = 0;
        for (const row of w.trace) {
            const s = drivenRow(row);
            const flow = s.N[i] * s.kOut[i];
            num += flow * s.qRight[i]; den += flow;
        }
        const q = den > 0 ? num / den : 0;
        compound *= q;
        console.log(`  ${ids[i]}→${ids[i + 1]}  q = ${q.toFixed(3)}   running product ${compound.toFixed(3)}`);
    }
    console.log(`
chain efficiency ${(compound * 100).toFixed(1)} % — an upper bound on purity before growth and death`);
    process.exit(0);
}

/* ------------------------------------------------------- the run, in full */
const w = runSOP(L);
console.log(`${L.key} — ${L.label}: ${L.days.toFixed(0)} days, ${L.nStage} stages, ${L.nCue} reagents`);
console.log(`driven by ${BRAIN ? "a trained network" : "the standard protocol"}`);
console.log(`batch ${seed} rung ${level}: seeded ${w.scn.seedDensity.toFixed(2)} M/mL, line mu×${w.scn.line.muScale.toFixed(2)} prop ${w.scn.line.prop.toFixed(2)}`);
for (const e of w.scn.events) console.log(`  event: ${EVENT_TYPES[e.type].label} at day ${(e.t0 / 24).toFixed(1)} for ${(e.t1 - e.t0).toFixed(0)} h`);
console.log("");
const ids = L.stages.map(s => s.id);
console.log(`${"day".padStart(5)} ${ids.map(s => s.padStart(6)).join("")} ${"viab".padStart(6)}${"d µm".padStart(6)}${"core".padStart(6)}` +
    `${"glc".padStart(6)}${"lac".padStart(6)}${"DO".padStart(5)}${"pH".padStart(6)}` +
    L.cues.map(c => c.short.slice(0, 6).padStart(7)).join("") + `${"med".padStart(7)}${"func".padStart(6)}`);
for (const row of w.trace) {
    if (Math.round(row.t) % every !== 0) continue;
    const s = drivenRow(row);
    console.log(`${(s.t / 24).toFixed(1).padStart(5)} ${s.N.map(x => x.toFixed(2).padStart(6)).join("")} ${s.viability.toFixed(2).padStart(6)}` +
        `${s.d.toFixed(0).padStart(6)}${s.fCore.toFixed(2).padStart(6)}${s.glc.toFixed(1).padStart(6)}${s.lac.toFixed(1).padStart(6)}` +
        `${s.DO.toFixed(0).padStart(5)}${s.pH.toFixed(2).padStart(6)}` +
        L.cues.map((c, i) => s.cue[i].toFixed(c.hi > 20 ? 0 : 2).padStart(7)).join("") +
        `${L.media[s.act.medium].key.slice(0, 6).padStart(7)}${s.func.toFixed(2).padStart(6)}`);
}
console.log("");
summary(L, w, "at harvest");
const b = w.baselineResults();
console.log(`baselines: neutral ${b.neutral.score.toFixed(1)}  nothing ${b.nothing.score.toFixed(1)}${b.nothing.failed ? " (lost: " + b.nothing.failReason + ")" : ""}`);
const tal = driven(w).r._deathTally;
console.log(`deaths (M/mL): shear ${tal[0].toFixed(2)} core ${tal[1].toFixed(2)} lac/nh4 ${tal[2].toFixed(2)} pH ${tal[3].toFixed(2)} ` +
    `O2 ${tal[4].toFixed(2)} seeding ${tal[5].toFixed(2)} cue-tox ${tal[6].toFixed(2)} starve ${tal[7].toFixed(2)}`);
