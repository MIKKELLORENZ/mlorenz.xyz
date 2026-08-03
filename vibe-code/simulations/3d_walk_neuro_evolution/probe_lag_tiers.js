/* probe_lag_tiers.js — does ANY of the temporal window earn its weights?
 *
 *   node probe_lag_tiers.js [champion.json]
 *
 * probe_memory.js answered a narrow question — the 600 ms COM-velocity ladder is
 * not load-bearing — and it is easy to over-read that as "history is useless".
 * It is not the same claim. That ladder is 33 inputs on one channel; history as a
 * whole is 170 of the 364 inputs, and 144 of those sit at 20-80 ms on channels
 * the ladder never touched: contact onset, foot load, the efference copy.
 *
 * So this ablates by LAG TIER, each against a SIZE-MATCHED RANDOM LESION. The
 * null is the whole point and it is what gave probe_memory.js its teeth: knocking
 * out any 9 inputs of a densely-used layer typically halved this walker, so
 * "ablating X did nothing" only means something next to "ablating an arbitrary X
 * of the same size did a lot".
 *
 * Read a tier as load-bearing when it costs clearly MORE than its matched null,
 * and as dead weight when it costs clearly LESS.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const MODEL = HUMANOID;

const file = process.argv[2] || path.join(__dirname, "training/champion_gen2931.json");
const saved = JSON.parse(fs.readFileSync(file, "utf8"));
const baseNet = Net.fromJSON(saved.net || saved);
if (baseNet.sizes.join() !== NET_SIZES.join())
    { console.error(`${baseNet.sizes.join("-")} brain, build is ${NET_SIZES.join("-")}`); process.exit(3); }

const NHID = NET_SIZES[1], ROW = NIN + 1;
/* Both held-out banks pooled. One ten-mission bank disagreed with another by up
 * to 0.8 wp on the SAME brain, so a tier difference measured on ten missions
 * would be unreadable. */
const BANK = [900, 907, 913, 921, 934, 947, 955, 962, 969, 976,
              983, 990, 1003, 1017, 1031, 1042, 1055, 1068, 1079, 1090];

/* Input indices grouped by lag, straight off the read plan the walker uses. */
const byLag = new Map();
for (let i = 0; i < LAG_PLAN.length; i++) {
    const L = LAG_PLAN[i].lag;
    if (!byLag.has(L)) byLag.set(L, []);
    byLag.get(L).push(i);
}
const lagsPresent = [...byLag.keys()].sort((a, b) => a - b);
console.log(`${path.basename(file)} — gen ${saved.gen}, ${NIN} inputs, ${BANK.length} held-out missions\n`);
console.log("input budget by lag:");
for (const L of lagsPresent)
    console.log(`  lag ${String(L).padStart(2)} (${String(L * 20).padStart(4)} ms)  ${String(byLag.get(L).length).padStart(4)} inputs`);
const HIST = lagsPresent.filter(L => L > 0).flatMap(L => byLag.get(L));
console.log(`  ---- lag 0 ${byLag.get(0).length}, history ${HIST.length}, total ${NIN}\n`);

function ablate(cols) {
    const n = Net.fromJSON(baseNet.toJSON());
    for (const i of cols) for (let o = 0; o < NHID; o++) n.weights[0][o * ROW + i] = 0;
    return n;
}
function score(net) {
    let wp = 0, m = 0, up = 0;
    for (const mi of BANK) {
        const w = new World(MODEL, [net], { stage: 2, terrainId: "varied",
            missionSeed: 1 + mi * 37, noiseSeed: 5000 + mi * 13, noise: true, groundFrac: 0 });
        let t = 0;
        while (!w.isOver() && t++ < 140 * 500) w.step();
        const x = w.walkers[0];
        wp += x.arrivals; m += x.progressM; up += x.uprightTime;
    }
    const n = BANK.length;
    return { wp: wp / n, m: m / n, up: up / n };
}

const rng = mulberry32(20260801);
const randomCols = n => { const s = new Set(); while (s.size < n) s.add(Math.floor(rng() * NIN)); return [...s]; };
const tier = (lo, hi) => lagsPresent.filter(L => L >= lo && L <= hi).flatMap(L => byLag.get(L));

const TIERS = [
    ["recent   lags 1-2   (20-40 ms)", tier(1, 2)],
    ["mid      lags 3-6   (60-120 ms)", tier(3, 6)],
    ["deep     lags 8-30  (160-600 ms)", tier(8, 99)],
    ["ALL history (every lag > 0)", HIST]
];

const ref = score(baseNet);
console.log(`intact brain: ${ref.wp.toFixed(2)} wp   ${ref.m.toFixed(2)} m   ${ref.up.toFixed(1)}s upright\n`);
console.log("  tier ablated                        n     result              vs matched random lesion");
for (const [name, cols] of TIERS) {
    const a = score(ablate(cols));
    /* Three independent draws of the same SIZE. Three is thin, but the effect
     * this is separating was a factor of four last time, not a few percent. */
    const nulls = [0, 1, 2].map(() => score(ablate(randomCols(cols.length))));
    const nm = nulls.map(x => x.m).sort((x, y) => x - y);
    const nw = nulls.map(x => x.wp).sort((x, y) => x - y);
    const verdict = a.m > nm[2] ? "CHEAPER than random — dead weight"
                  : a.m < nm[0] ? "COSTLIER than random — load-bearing"
                  : "inside the null — indistinguishable";
    console.log(`  ${name.padEnd(34)} ${String(cols.length).padStart(4)}  ` +
        `${a.wp.toFixed(2)} wp ${a.m.toFixed(2)} m ${a.up.toFixed(1)}s   ` +
        `null m ${nm[0].toFixed(2)}-${nm[2].toFixed(2)}, wp ${nw[0].toFixed(2)}-${nw[2].toFixed(2)}   ${verdict}`);
}
console.log(`
"Cheaper than random" means those inputs carry LESS than an arbitrary set of the
same size — the weights are there and the walker does not miss them. "Costlier"
means the opposite and is the only result that justifies keeping the tier.`);
