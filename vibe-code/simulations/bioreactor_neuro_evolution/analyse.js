/* analyse.js — what did the champion actually learn?
 *
 *   node analyse.js training/checkpoint.json            12 held-out batches per rung per product
 *   node analyse.js default_brain.js --n 24 --maxlevel 4
 *   node analyse.js default_brain.js --lin beta         one product, in detail
 *
 * Three things a scoreboard cannot tell you:
 *
 *   1. The paired comparison. Brain and protocol on the identical batches,
 *      difference ± standard error, per product and per rung — the number that
 *      decides whether the network is better or lucky.
 *
 *   2. Whether it can do all five. A mean advantage of 1.2 is consistent with
 *      beating the protocol on cardiomyocytes and losing the culture every
 *      time someone orders kidney organoids. The per-product table is the
 *      first thing to read, always.
 *
 *   3. The recipe it runs. When it doses each reagent and how much, against
 *      what the published protocol does, and whether any of it moves with the
 *      hidden properties of the cell line. A dosing channel pinned at zero or
 *      at its maximum across every batch is a channel the search never learned
 *      to use.
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
const FLAGV = { n: 1, maxlevel: 1, lin: 1 };
const file = (() => {
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) { if (FLAGV[a.slice(2)]) i++; continue; }
        if (!/^\d+$/.test(a)) return a;
    }
    return "default_brain.js";
})();
const N = parseInt(arg("n", 12), 10), MAXL = parseInt(arg("maxlevel", N_LEVELS - 1), 10);
const onlyLin = arg("lin", null);
const brain = Net.fromJSON(loadBrainFile(file).net);
const lins = onlyLin ? [LIN_BY_KEY[String(onlyLin)]] : LINEAGES;
if (!lins[0]) { console.error(`no such product: ${onlyLin}`); process.exit(1); }
console.log(`${file}: ${brain.sizes.join("×")} — ${N} held-out batches per product per rung, rungs 0–${MAXL}\n`);

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const se = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1) / a.length); };
const pct = x => (x * 100).toFixed(0) + "%";
const sgn = x => (x >= 0 ? "+" : "") + x.toFixed(1);

/* Held-out seeds: the training bank uses block×131 + e×17 + 1, all below 1e6. */
const rows = [];
for (const L of lins) {
    for (let lev = 0; lev <= MAXL; lev++) {
        for (let k = 0; k < N; k++) {
            const w = new World([brain], {
                seed: 500001 + k * 7919 + lev * 101 + L.idx * 13,
                level: lev, lin: L.idx, withNothing: false, trace: true
            });
            w.run();
            const r = w.results()[0], s = w.sop.result;
            const tr = w.trace.map(x => x.units[0]);
            const sp = w.trace.map(x => x.sop);
            // the recipe, per dosing channel: when it went on, when it came
            // off, the peak, and how many hours it was above its own EC50
            const cues = [];
            for (let i = 0; i < L.nCue; i++) {
                const spec = L.cues[i];
                const on = tr.filter(x => x.cue[i] > 0.05 * spec.hi);
                const sopOn = sp.filter(x => x.act.cue[i] > 0.02 * spec.hi);
                cues.push({
                    first: on.length ? on[0].t / 24 : null,
                    last: on.length ? on[on.length - 1].t / 24 : null,
                    peak: Math.max(...tr.map(x => x.cue[i])),
                    hours: tr[tr.length - 1].cueHours[i],
                    sopFirst: sopOn.length ? sopOn[0].t / 24 : null,
                    sopLast: sopOn.length ? sopOn[sopOn.length - 1].t / 24 : null,
                    sopPeak: Math.max(...sp.map(x => x.act.cue[i]))
                });
            }
            rows.push({
                L, lin: L.key, level: lev, seed: w.opts.seed,
                adv: r.advantage, score: r.score, sop: s.score, d: r.score - s.score,
                purity: r.purity, sopPurity: s.purity, fold: r.fold, sopFold: s.fold,
                func: r.func, sopFunc: s.func, failed: r.failed, sopFailed: s.failed,
                cost: r.cost, sopCost: s.cost, cues,
                medDays: [0, 1, 2].map(m => tr.filter(x => x.act.medium === m).length / 24),
                perf: mean(tr.map(x => x.act.perf)), rpm: mean(tr.map(x => x.act.rpm)),
                o2: mean(tr.map(x => x.act.o2)), base: mean(tr.map(x => x.act.base)),
                glcFeed: mean(tr.map(x => x.act.glcFeed)),
                pHmean: mean(tr.map(x => x.pH)), DOmean: mean(tr.map(x => x.DO)),
                lacMax: Math.max(...tr.map(x => x.lac)), dMax: Math.max(...tr.map(x => x.d)),
                coreMax: Math.max(...tr.map(x => x.fCore)),
                line: w.scn.line, lots: w.scn.lots, events: w.scn.events.map(e => e.type)
            });
        }
    }
}

/* ------------------------------------------------------------ per product */
/* TWO ADVANTAGE NUMBERS, and the first is the one that matters. `advantage`
 * is the CLAMPED per-episode value, which is what selection, the ratchet and
 * the weakest-product gate all optimise; `raw` is unbounded above. They come
 * apart badly on the products this plant scores generously - one run showed a
 * raw beta advantage of 7.99 beside a cardiac 0.18, which reads like a brain
 * that has abandoned four of the five products when the objective it was
 * actually trained on had been bounded the whole time. The same trap sat in
 * the trainer's own log. Report the objective, keep the raw one beside it. */
console.log("BY PRODUCT — brain against the protocol on identical batches\n");
for (const L of lins) {
    const mine = rows.filter(r => r.lin === L.key);
    const d = mine.map(r => r.d);
    console.log(`${L.label} (${L.key})   advantage ${mean(mine.map(r => normalizeFitness(r.adv))).toFixed(2)} (raw ${mean(mine.map(r => r.adv)).toFixed(2)})   ` +
        `score ${mean(mine.map(r => r.score)).toFixed(0)} vs ${mean(mine.map(r => r.sop)).toFixed(0)}   ` +
        `Δ ${sgn(mean(d))} ± ${se(d).toFixed(1)}   wins ${mine.filter(r => r.d > 0).length}/${mine.length}   ` +
        `purity ${pct(mean(mine.map(r => r.purity)))} vs ${pct(mean(mine.map(r => r.sopPurity)))}   ` +
        `fold ${mean(mine.map(r => r.fold)).toFixed(2)} vs ${mean(mine.map(r => r.sopFold)).toFixed(2)}   ` +
        `${L.func.label} ${mean(mine.map(r => r.func)).toFixed(2)} vs ${mean(mine.map(r => r.sopFunc)).toFixed(2)}   ` +
        `lost ${mine.filter(r => r.failed).length} vs ${mine.filter(r => r.sopFailed).length}`);
    for (let lev = 0; lev <= MAXL; lev++) {
        const m = mine.filter(r => r.level === lev);
        if (!m.length) continue;
        const dd = m.map(r => r.d);
        console.log(`    rung ${lev} ${difficultyOf(lev).label.padEnd(15)} adv ${mean(m.map(r => r.adv)).toFixed(2).padStart(6)}  ` +
            `Δ ${sgn(mean(dd)).padStart(7)} ± ${se(dd).toFixed(1).padStart(5)}  wins ${m.filter(r => r.d > 0).length}/${m.length}  ` +
            `purity ${pct(mean(m.map(r => r.purity))).padStart(4)} vs ${pct(mean(m.map(r => r.sopPurity))).padStart(4)}  ` +
            `lost ${m.filter(r => r.failed).length}`);
    }
    console.log("");
}

/* ------------------------------------------------------------- the recipe */
console.log("THE RECIPE IT RUNS (the protocol's own schedule in brackets)\n");
const fmtR = (arr, f) => { const v = arr.filter(x => x != null); return v.length ? `${f(mean(v))} (${f(Math.min(...v))}–${f(Math.max(...v))}, ${v.length}/${arr.length})` : "never"; };
for (const L of lins) {
    const mine = rows.filter(r => r.lin === L.key);
    console.log(`${L.label}:`);
    for (let i = 0; i < L.nCue; i++) {
        const spec = L.cues[i];
        const c = mine.map(r => r.cues[i]);
        const sopF = c[0].sopFirst, sopLa = c[0].sopLast, sopP = c[0].sopPeak;
        console.log(`  ${spec.short.padEnd(8)} on day ${fmtR(c.map(x => x.first), x => x.toFixed(1)).padEnd(26)} ` +
            `off day ${fmtR(c.map(x => x.last), x => x.toFixed(1)).padEnd(26)} ` +
            `peak ${fmtR(c.map(x => x.peak), x => x.toFixed(1)).padEnd(24)} ` +
            `[protocol: ${sopF == null ? "never" : `day ${sopF.toFixed(1)}–${sopLa.toFixed(1)} at ${sopP.toFixed(1)} ${spec.unit}`}]`);
    }
    console.log(`  media: ${L.media.map((m, i) => `${m.key} ${mean(mine.map(r => r.medDays[i])).toFixed(1)} d`).join(" · ")}` +
        `   [protocol: ${L.media.map((m, i) => {
            let days = 0;
            let prev = 0;
            for (const ph of L.sop.phases) { const to = Math.min(ph.to, L.days); if (ph.medium === i) days += Math.max(0, to - prev); prev = Math.max(prev, to); }
            return `${m.key} ${days.toFixed(1)} d`;
        }).join(" · ")}]`);
    console.log(`  perfusion ${mean(mine.map(r => r.perf)).toFixed(2)} vol/day · agitation ${mean(mine.map(r => r.rpm)).toFixed(0)} rpm · ` +
        `O₂ in gas ${pct(mean(mine.map(r => r.o2)))} · glucose feed ${mean(mine.map(r => r.glcFeed)).toFixed(2)} mM/h`);
    console.log(`  held pH ${mean(mine.map(r => r.pHmean)).toFixed(2)}, DO ${mean(mine.map(r => r.DOmean)).toFixed(0)} %, ` +
        `lactate peak ${mean(mine.map(r => r.lacMax)).toFixed(1)} mM, aggregates peak ${mean(mine.map(r => r.dMax)).toFixed(0)} µm ` +
        `(this product wants ${L.agg.band[0]}–${L.agg.band[1]}), hypoxic core peak ${pct(mean(mine.map(r => r.coreMax)))}\n`);
}

/* -------------------------------------------------------- does it adapt? */
/* The open question of the whole project: the cell line's sensitivity to each
 * reagent is hidden and only observable through assays that arrive days late.
 * A controller that reads it would dose against it. Correlation across
 * batches, per channel, of peak dose with that channel's hidden EC50. */
function corr(a, b) {
    const ma = mean(a), mb = mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb + 1e-12);
}
console.log("DOES IT READ THE LINE? (correlation across batches; the protocol scores 0 by construction)\n");
for (const L of lins) {
    const mine = rows.filter(r => r.lin === L.key && !r.failed);
    if (mine.length < 5) continue;
    const bits = [];
    for (let i = 0; i < L.nCue; i++) {
        const peaks = mine.map(r => r.cues[i].peak);
        if (Math.max(...peaks) - Math.min(...peaks) < 1e-6) { bits.push(`${L.cues[i].short} pinned at ${peaks[0].toFixed(1)}`); continue; }
        bits.push(`${L.cues[i].short} vs its EC50 r=${corr(peaks, mine.map(r => r.line.cueEC50[i])).toFixed(2)}` +
            `, vs lot r=${corr(peaks, mine.map(r => r.lots.cuePotency[i])).toFixed(2)}`);
    }
    console.log(`  ${L.key.padEnd(8)} ${bits.join(" · ")}`);
    console.log(`  ${"".padEnd(8)} perfusion vs line growth rate r=${corr(mine.map(r => r.perf), mine.map(r => r.line.muScale)).toFixed(2)} · ` +
        `agitation vs line growth r=${corr(mine.map(r => r.rpm), mine.map(r => r.line.muScale)).toFixed(2)}`);
}

/* ----------------------------------------------------------- by event */
const byEvent = {};
for (const r of rows) for (const e of new Set(r.events)) (byEvent[e] || (byEvent[e] = [])).push(r.d);
const evKeys = Object.keys(byEvent);
if (evKeys.length) {
    console.log(`\nBY EVENT (Δ score, brain − protocol, on batches carrying that failure)\n`);
    for (const e of evKeys) {
        console.log(`  ${EVENT_TYPES[e].label.padEnd(36)} n=${String(byEvent[e].length).padStart(3)}  ` +
            `Δ ${sgn(mean(byEvent[e]))} ± ${byEvent[e].length > 1 ? se(byEvent[e]).toFixed(1) : "?"}`);
    }
}

/* --------------------------------------------------------------- overall */
const d = rows.map(r => r.d);
console.log(`\nOVERALL  advantage ${mean(rows.map(r => normalizeFitness(r.adv))).toFixed(3)} (raw ${mean(rows.map(r => r.adv)).toFixed(3)})  Δ ${sgn(mean(d))} ± ${se(d).toFixed(1)}  ` +
    `wins ${rows.filter(r => r.d > 0).length}/${rows.length}  cultures lost ${rows.filter(r => r.failed).length} vs ${rows.filter(r => r.sopFailed).length}  ` +
    `cost ${mean(rows.map(r => r.cost)).toFixed(0)} vs ${mean(rows.map(r => r.sopCost)).toFixed(0)}`);
