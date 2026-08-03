/* probe_hist_channels.js — which channel's HISTORY is actually doing work?
 *
 *   node probe_hist_channels.js [champion.json]
 *
 * probe_lag_tiers.js tried to answer this by lag band and ran into a floor: the
 * short bands are 68 and 82 inputs, and removing a fifth of a densely-used input
 * layer kills this walker whatever you remove. Tier and null both scored 0.00 m,
 * so the comparison was between two corpses and its verdicts mean nothing. Only
 * the 20-input deep band kept any dynamic range.
 *
 * The fix is smaller lesions. Each channel group's history is 6-30 inputs — the
 * size that demonstrably still leaves a walker to measure — and each targets a
 * specific claim about WHY history is in the design at all:
 *
 *   contact   6   "touchdown vs mid-stance": same boolean now, opposite action
 *   load      6   rising load (weight arriving) vs falling (unloading to swing)
 *   efference 22  dead-time: which commands are still in flight through servo lag
 *   qd        22  joint-rate trend, i.e. is the shin still swinging through
 *   comvel    30  the known-dead control, from probe_memory.js
 *
 * Null draws are cached per lesion SIZE, so a 6-input group is compared against
 * random 6-input lesions and never against a differently-sized null.
 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js", "evolution.js"])
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
const MODEL = HUMANOID;

const file = process.argv[2] || path.join(__dirname, "training/champion_gen2931.json");
const saved = JSON.parse(fs.readFileSync(file, "utf8"));
const baseNet = Net.fromJSON(saved.net || saved);
const NHID = NET_SIZES[1], ROW = NIN + 1;
const BANK = [900, 907, 913, 921, 934, 947, 955, 962, 969, 976,
              983, 990, 1003, 1017, 1031, 1042, 1055, 1068, 1079, 1090];

const idxOf = new Map();
for (let i = 0; i < LAG_PLAN.length; i++) idxOf.set(LAG_PLAN[i].ch + ":" + LAG_PLAN[i].lag, i);
/* Every input belonging to channels [c0, c0+n) at every lag EXCEPT 0 — the
 * present-tense reading always stays, so this measures the memory and not the
 * sensor. */
const histOf = (c0, n) => {
    const out = [];
    for (let c = c0; c < c0 + n; c++)
        for (const L of LAGS[c]) if (L !== 0) out.push(idxOf.get(c + ":" + L));
    return out;
};

function ablate(cols) {
    const net = Net.fromJSON(baseNet.toJSON());
    for (const i of cols) for (let o = 0; o < NHID; o++) net.weights[0][o * ROW + i] = 0;
    return net;
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
const nullCache = new Map();
function nullFor(size) {
    if (!nullCache.has(size)) {
        const runs = [];
        for (let k = 0; k < 3; k++) {
            const s = new Set();
            while (s.size < size) s.add(Math.floor(rng() * NIN));
            runs.push(score(ablate([...s])));
        }
        nullCache.set(size, runs);
    }
    return nullCache.get(size);
}

const GROUPS = [
    ["contact flags  (touchdown vs mid-stance)", histOf(C_CONTACT, 2)],
    ["foot load      (load rising vs falling)", histOf(C_LOAD, 2)],
    ["efference copy (servo dead-time)", histOf(C_EFFERENCE, NJ)],
    ["joint rates    (limb swinging through)", histOf(C_QD, NJ)],
    ["COM velocity   (known-dead control)", histOf(C_COMVEL, 3)]
];

const ref = score(baseNet);
console.log(`${path.basename(file)} — gen ${saved.gen}, ${BANK.length} held-out missions`);
console.log(`intact brain: ${ref.wp.toFixed(2)} wp   ${ref.m.toFixed(2)} m   ${ref.up.toFixed(1)}s upright\n`);
console.log("  history ablated                              n     result                 random lesion, same size");
for (const [name, cols] of GROUPS) {
    const a = score(ablate(cols));
    const nulls = nullFor(cols.length);
    const nm = nulls.map(x => x.m).sort((x, y) => x - y);
    const verdict = a.m > nm[2] ? "cheaper than random"
                  : a.m < nm[0] ? "COSTLIER — load-bearing"
                  : "inside the null";
    console.log(`  ${name.padEnd(43)} ${String(cols.length).padStart(3)}  ` +
        `${a.wp.toFixed(2)} wp ${a.m.toFixed(2)} m ${a.up.toFixed(1)}s   ` +
        `m ${nm[0].toFixed(2)}-${nm[2].toFixed(2)}   ${verdict}`);
}
console.log(`
Each row keeps its channel's PRESENT reading and removes only the past ones, so a
cost here is the cost of forgetting, not of going blind. A row that lands inside
or above its null is history the walker is not using.`);
