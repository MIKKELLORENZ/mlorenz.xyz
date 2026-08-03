/* probe_memory.js — is the walker actually USING its long temporal window?
 *
 *   node probe_memory.js [champion.json] [stage]
 *
 * The question on the table is whether to extend the temporal reach of the
 * inputs from 600 ms to ~1200 ms. Reach is not free: hidden layer 1 is 48 wide
 * and the input layer is 86% of the genome, so every tap added is 48 more
 * weights for selection to search. Before buying more of something, find out
 * whether the champion uses what it already has.
 *
 * Only C_COMVEL carries deep history (L_MOMENTUM, 11 taps out to lag 30 = 600
 * ms). Everything else stops at lag 8 = 160 ms. So this asks two things of the
 * momentum ladder specifically:
 *
 *   1. WEIGHT PROFILE. Mean |w| per lag across the 48 hidden units. Weak
 *      evidence on its own — under a GA with no weight decay an unused weight
 *      random-walks and does not shrink — so it is reported next to the
 *      whole-layer mean as a scale, not read as proof.
 *
 *   2. ABLATION, which is the real test. Zero a tap's weights and re-run a
 *      held-out bank. If the deep taps carry signal, losing them costs score.
 *      The control is the SHALLOW taps of the same channel, same count: if deep
 *      and shallow cost the same, reach is being used; if only shallow costs
 *      anything, the tail is decoration and extending it buys nothing.
 *
 * Ablation is destructive on a copy only; nothing here writes a brain.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const DIR = __dirname;
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(DIR, f), "utf8"), { filename: f });
}
const M = HUMANOID;

const file = process.argv[2] || path.join(DIR, "training/champion.json");
/* Stage 2 by default, because that is the stage exam.js measures and therefore
 * the only one whose numbers are comparable to every earlier result in this
 * project. At stage 4 this champion scores a flat zero waypoints and zero
 * metres, which is a real fact about the walker but a useless instrument: an
 * ablation cannot move a score that is already on the floor. */
const STAGE = +(process.argv[3] || 2);
const NMISS = +(process.env.NMISS || 12);
const saved = JSON.parse(fs.readFileSync(file, "utf8"));
const base = Net.fromJSON(saved.net || saved);
if (base.sizes.join() !== NET_SIZES.join())
    { console.error(`${base.sizes.join("-")} brain, this build is ${NET_SIZES.join("-")}`); process.exit(3); }

const NHID = NET_SIZES[1], ROW = NIN + 1;
console.log(`${path.basename(file)} — gen ${saved.gen}, ${NIN} inputs, stage ${STAGE}, ${NMISS} held-out missions\n`);

/* ------------------------------------------------------- 1. weight profile */
const w0 = base.weights[0];
const colMean = i => { let s = 0; for (let o = 0; o < NHID; o++) s += Math.abs(w0[o * ROW + i]); return s / NHID; };
let all = 0; for (let i = 0; i < NIN; i++) all += colMean(i); all /= NIN;

// index of every input, grouped by (channel-block, lag)
const idxOf = new Map();                       // "ch:lag" -> input index
for (let i = 0; i < LAG_PLAN.length; i++) idxOf.set(LAG_PLAN[i].ch + ":" + LAG_PLAN[i].lag, i);
const comvel = [C_COMVEL, C_COMVEL + 1, C_COMVEL + 2];

console.log("COM-velocity ladder, mean |weight| per tap (whole input layer averages " + all.toFixed(4) + "):");
console.log("    lag    ms      mean|w|   vs layer");
for (const lag of LAGS[C_COMVEL]) {
    let s = 0; for (const c of comvel) s += colMean(idxOf.get(c + ":" + lag));
    s /= comvel.length;
    console.log(`  ${String(lag).padStart(5)} ${String(lag * 20).padStart(5)}   ${s.toFixed(4).padStart(10)}   ${(s / all).toFixed(2).padStart(6)}x`);
}
// same profile for every OTHER lag present in the layout, as a baseline shape
console.log("\nwhole layer by lag (all channels that carry that lag):");
const lags = [...new Set(LAGS.flat())].sort((a, b) => a - b);
for (const lag of lags) {
    let s = 0, n = 0;
    for (let ch = 0; ch < NC; ch++) if (LAGS[ch].indexOf(lag) >= 0) { s += colMean(idxOf.get(ch + ":" + lag)); n++; }
    console.log(`  lag ${String(lag).padStart(2)} (${String(lag * 20).padStart(4)} ms)  ${n.toString().padStart(4)} inputs   mean|w| ${(s / n).toFixed(4)}`);
}

/* ------------------------------------------------------------ 2. ablation */
function ablate(cols) {
    const n = Net.fromJSON(base.toJSON());
    for (const i of cols) for (let o = 0; o < NHID; o++) n.weights[0][o * ROW + i] = 0;
    return n;
}
const taps = (chs, lagSet) => {
    const out = [];
    for (const c of chs) for (const l of lagSet) { const i = idxOf.get(c + ":" + l); if (i !== undefined) out.push(i); }
    return out;
};

/* Held out: the same 12 missions exam.js uses, so the numbers are comparable to
 * every other exam in this project rather than to a bank invented here. */
const WALK = [900, 907, 913, 921, 934, 947, 955, 962, 969, 976, 983, 990].slice(0, NMISS);
const NPOSE = +(process.env.NPOSE || 10);

/* Waypoints are the honest headline but a coarse instrument: this champion
 * scores well under one per mission, so an ablation can move it only by whole
 * arrivals and mostly reads zero either way. Metres walked and time upright are
 * the same behaviour on a continuous scale, and they are what makes a small
 * effect visible at all. All three are reported; none is picked after the fact. */
function walkBank(net) {
    let arr = 0, m = 0, up = 0;
    for (const mi of WALK) {
        const w = new World(M, [net], { stage: STAGE, terrainId: "varied",
            missionSeed: 1 + mi * 37, noiseSeed: 5000 + mi * 13, noise: true, groundFrac: 0 });
        let t = 0;
        while (!w.isOver() && t++ < 140 * 500) w.step();
        const x = w.walkers[0];
        arr += x.arrivals; m += x.progressM; up += x.uprightTime;
    }
    return { wp: arr / WALK.length, m: m / WALK.length, up: up / WALK.length };
}
function riseBank(net) {
    let rec = 0, best = 0, n = 0;
    for (let k = 0; k < NPOSE; k++) {
        const w = new World(M, [net], { stage: STAGE, terrainId: "varied",
            missionSeed: 4400 + k * 29, noiseSeed: 8800 + k * 17, noise: true,
            groundFrac: 1, seatFrac: 0, poseFrac: 1 });
        let t = 0;
        while (!w.isOver() && t++ < 140 * 500) w.step();
        const x = w.walkers[0];
        rec += x.recoveries; best += x.bestComY; n++;
    }
    return { rises: rec / n, bestCom: best / n };
}

/* THE NULL IS THE POINT. A first pass at 12 missions showed every comvel
 * ablation scoring at or ABOVE the intact brain, which cannot be taken at face
 * value: this project has already been burned by reading a mission-draw lottery
 * as a result (an 18.7x fitness swing on an unchanged brain), and the held-out
 * ratchet has a documented +/-0.2-waypoint noise floor. So the comparison is not
 * "ablated vs intact" — it is "this ablation vs lesions of the SAME SIZE placed
 * at random". If knocking out nine comvel taps lands inside the spread of
 * knocking out nine arbitrary inputs, then the deep ladder is not carrying
 * anything a random ninth of the input layer is not. */
const NRAND = +(process.env.NRAND || 6);
const rnd = mulberry32(20260801);
const randomLesion = n => {
    const pick = new Set();
    while (pick.size < n) pick.add(Math.floor(rnd() * NIN));
    return [...pick];
};
const VARIANTS = [
    ["baseline (nothing zeroed)", []],
    ["COMVEL deep tail  lags 15,20,30      (9 inputs)", taps(comvel, [15, 20, 30])],
    ["COMVEL shallow    lags  1, 2, 3      (9 inputs)", taps(comvel, [1, 2, 3])],
    ["COMVEL all history, lag 0 kept      (30 inputs)", taps(comvel, LAGS[C_COMVEL].filter(l => l !== 0))],
    ["COMVEL entirely, lag 0 too          (33 inputs)", taps(comvel, LAGS[C_COMVEL])]
];
for (let k = 0; k < NRAND; k++)
    VARIANTS.push([`  null: 9 random inputs, draw ${k + 1}`.padEnd(48), randomLesion(9)]);
for (let k = 0; k < 2; k++)
    VARIANTS.push([`  null: 30 random inputs, draw ${k + 1}`.padEnd(48), randomLesion(30)]);

console.log(`\nablation — held-out walking (${WALK.length} missions) and ${NPOSE} floor-pose starts:\n`);
console.log("  variant                                              wp    metres   upright  bestCOM      delta vs baseline");
let ref = null;
const got = [];
for (const [name, cols] of VARIANTS) {
    const net = cols.length ? ablate(cols) : base;
    const a = walkBank(net), b = riseBank(net);
    if (!ref) ref = { wp: a.wp, m: a.m, up: a.up, bestCom: b.bestCom };
    const d = (v, n) => (v >= 0 ? "+" : "") + v.toFixed(n);
    got.push({ name, n: cols.length, wp: a.wp, m: a.m, up: a.up, com: b.bestCom });
    console.log(`  ${name.padEnd(48)} ${a.wp.toFixed(2).padStart(5)} ${a.m.toFixed(2).padStart(8)} ` +
        `${a.up.toFixed(1).padStart(7)}s ${(b.bestCom * 100).toFixed(0).padStart(6)} cm` +
        (cols.length ? `   wp ${d(a.wp - ref.wp, 2)}  m ${d(a.m - ref.m, 2)}  up ${d(a.up - ref.up, 1)}s` : "   —"));
}

/* The verdict, stated as a range rather than a point, because a point estimate
 * off one mission bank is exactly the mistake this null exists to prevent. */
const nul9 = got.filter(g => g.name.includes("9 random"));
const stat = (rows, k) => {
    const v = rows.map(r => r[k]).sort((a, b) => a - b);
    return { lo: v[0], hi: v[v.length - 1], mid: v.reduce((s, x) => s + x, 0) / v.length };
};
console.log("\nnull distribution — lesions of 9 arbitrary inputs:");
for (const [k, lbl, dp] of [["wp", "waypoints", 2], ["m", "metres", 2], ["up", "upright s", 1]]) {
    const s = stat(nul9, k);
    console.log(`  ${lbl.padEnd(11)} ${s.lo.toFixed(dp)} .. ${s.hi.toFixed(dp)}  (median-ish ${s.mid.toFixed(dp)}),  intact brain ${ref[k].toFixed(dp)}`);
}
const deep = got.find(g => g.name.includes("deep tail")), shal = got.find(g => g.name.includes("shallow"));
const inNull = (g, k) => { const s = stat(nul9, k); return g[k] >= s.lo && g[k] <= s.hi; };
console.log(`\n  deep tail (lags 15,20,30) sits ${inNull(deep, "m") ? "INSIDE" : "OUTSIDE"} the null on metres, ` +
    `${inNull(deep, "up") ? "INSIDE" : "OUTSIDE"} on upright time`);
console.log(`  shallow   (lags  1, 2, 3) sits ${inNull(shal, "m") ? "INSIDE" : "OUTSIDE"} the null on metres, ` +
    `${inNull(shal, "up") ? "INSIDE" : "OUTSIDE"} on upright time`);
console.log(`
Inside the null means the taps are not carrying anything a random ninth of the
input layer is not — and there is then no case for spending 48 weights per tap to
push that same ladder out to 1200 ms. Outside, and below baseline, is the only
result that argues FOR more reach.`);
