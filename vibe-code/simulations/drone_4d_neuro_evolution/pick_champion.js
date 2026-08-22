/* pick_champion.js — choose the brain to ship, on evidence it was not selected by.
 *
 *   node pick_champion.js training/ckpt_final.json [topN]
 *
 * The training bank rotates every generation, so the log's `best` column is a
 * score on missions no other generation flew: it is noisy by construction and
 * must not be used to pick anything. Worse, whichever brain happens to top the
 * final generation is partly there because it drew that generation's missions.
 *
 * So: take the top N brains of the saved population plus the saved champion,
 * fold duplicates by weight hash (elitism means several slots are often the
 * same net), and fly every survivor over FOUR independent held-out seed banks
 * that appear nowhere in training. The criterion is fixed here, before any
 * results are seen — mean waypoints across banks, tie-broken by the worst bank,
 * because a brain that wins one bank and loses the next was fitted to a bank
 * and the spread is the luck detector.
 */
"use strict";
require("./bootstrap.js");
const fs = require("fs");
const crypto = require("crypto");

const ckPath = process.argv[2] || "training/ckpt_final.json";
const TOP_N = +(process.argv[3] || 12);
const ck = JSON.parse(fs.readFileSync(ckPath, "utf8"));
const room = new Room4D();

const BANKS = [60000, 71000, 82000, 93000];
const PER_BANK = 6;

function hashOf(net) {
    const h = crypto.createHash("sha1");
    for (const w of net.weights) h.update(Buffer.from(w.buffer, w.byteOffset, w.byteLength));
    return h.digest("hex").slice(0, 12);
}

/* Candidates: the population is stored best-first as of its last ranking. */
const cands = [];
const seen = new Map();
const add = (o, label) => {
    if (!o) return;
    const net = Net.fromJSON(o);
    const h = hashOf(net);
    if (seen.has(h)) { seen.get(h).labels.push(label); return; }
    const rec = { net, hash: h, labels: [label] };
    seen.set(h, rec); cands.push(rec);
};
add(ck.champion, "champion");
(ck.population || []).slice(0, TOP_N).forEach((o, i) => add(o, "pop#" + i));

console.log(`${ckPath} — gen ${ck.gen}`);
console.log(`${cands.length} distinct brains from ${1 + Math.min(TOP_N, (ck.population || []).length)} slots ` +
    `(elitism duplicates folded)`);
console.log(`ranking on ${BANKS.length} held-out banks × ${PER_BANK} episodes, unseen in training\n`);

function score(net) {
    const per = [];
    for (const base of BANKS) {
        let arr = 0, crash = 0, air = 0;
        for (let e = 0; e < PER_BANK; e++) {
            const r = runEpisode(room, [net], {
                missionSeed: base + e * 311, noiseSeed: base + 7 + e * 53,
                turbulence: 0.15, noise: true, hardCap: 120, maxArrivals: 30, minSep: 8
            })[0];
            arr += r.arrivals; crash += r.crashed; air += r.airTime;
        }
        per.push({ arr: arr / PER_BANK, crash: crash / PER_BANK, air: air / PER_BANK });
    }
    const mean = per.reduce((s, p) => s + p.arr, 0) / per.length;
    const worst = Math.min(...per.map(p => p.arr));
    const air = per.reduce((s, p) => s + p.air, 0) / per.length;
    const crash = per.reduce((s, p) => s + p.crash, 0) / per.length;
    return { mean, worst, air, crash, per };
}

const rows = cands.map(c => Object.assign({ c }, score(c.net)));
rows.sort((a, b) => (b.mean - a.mean) || (b.worst - a.worst));

console.log("   brain          sha1           mean wp   worst   airtime   crash   per-bank");
console.log("   " + "─".repeat(82));
for (const r of rows) {
    console.log(`   ${r.c.labels[0].padEnd(12)}   ${r.c.hash}   ` +
        `${r.mean.toFixed(2).padStart(7)}   ${r.worst.toFixed(2).padStart(5)}   ` +
        `${r.air.toFixed(1).padStart(6)}s   ${(r.crash * 100).toFixed(0).padStart(4)}%   ` +
        `[${r.per.map(p => p.arr.toFixed(1)).join(" ")}]`);
}

const win = rows[0];
console.log(`\nWINNER: ${win.c.labels.join(" = ")}  sha1 ${win.c.hash}`);
console.log(`  ${win.mean.toFixed(2)} waypoints/episode across held-out banks (worst bank ${win.worst.toFixed(2)})`);

/* Write it back into the checkpoint's champion slot so bake.js ships this one. */
const outPath = ckPath.replace(/\.json$/, "_picked.json");
fs.writeFileSync(outPath, JSON.stringify(Object.assign({}, ck, {
    champion: win.c.net.toJSON(),
    championFit: win.mean,
    population: undefined,
    pickedFrom: win.c.labels,
    heldOutMeanWaypoints: win.mean,
    heldOutWorstBank: win.worst
})));
console.log(`\nwrote ${outPath} — bake this one:  node bake.js ${outPath}`);
