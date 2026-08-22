/* probe_rewards.js — is this reward a good instrument, and at what depth does it
 * stop being one?
 *
 *   node probe_rewards.js                                 # uses the newest champion
 *   node probe_rewards.js training/main2/champion.json --policies 40 --games 48
 *
 * ─── why this exists ───────────────────────────────────────────────────────
 *
 * The reward grid in grid_search.js trains a full run per reward and ranks the
 * champions. That is the right experiment and it is expensive, which means it can
 * only be run at a budget where every cell's curriculum stops around depth 2 — and
 * at depth 2 the interesting differences between these rewards do not exist yet.
 * At depth 1 and 2 the only distinction that matters is "did it solve", and *every*
 * reward here can see that, sticker-counting included. The grid duly reported all
 * twelve cells inside a narrow band, which is a true statement about a budget rather
 * than about the rewards.
 *
 * This probe answers the underlying question directly and in seconds instead of
 * hours, by measuring each reward as a *measuring instrument* rather than as a
 * training signal:
 *
 *   Take a spread of policies of genuinely different quality. Rank them by ground
 *   truth (held-out solve rate and true distance removed — evaluate.js's yardstick).
 *   Then rank them by each candidate reward. A reward that ranks them the same way
 *   is an instrument that can guide selection; one that does not, cannot, however
 *   many generations it is given.
 *
 * Doing it per depth is the whole point: it shows *where* an instrument goes blind.
 * And it is nearly free, because every reward is computed from the same episode
 * traces — one pass over the bank scores all ten.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { load } = require("./load.js");
load();

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}

const src = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : (() => {
    for (const c of ["training/main2/champion.json", "training/main/champion.json"]) {
        if (fs.existsSync(path.join(__dirname, c))) return c;
    }
    return null;
})();
if (!src) { console.error("no champion found — train one first"); process.exit(1); }
const saved = JSON.parse(fs.readFileSync(path.join(__dirname, src), "utf8"));
const cfg = resolveConfig(saved.config || "default");
const env = new Env(Object.assign({}, cfg.env, { forceOracle: true, depthCapOverride: 7 }));
const champ = netFromJSON(saved);

const NPOL = +arg("policies", 36);
const GAMES = +arg("games", 48);
const DEPTHS = String(arg("depths", "1,2,3,4,5,6")).split(",").map(Number)
    .filter(d => d <= env.oracle.radius);

/* ─── a spread of policies ─────────────────────────────────────────────────
 *
 * A correlation is only meaningful over a range, so the set has to span from
 * useless to as good as we have. Untrained brains at the bottom, the champion at
 * the top, and progressively-damaged copies of the champion in between — damaged by
 * mutation at a range of strengths, which is exactly the population a generation of
 * this GA actually contains, so the correlation measured is the correlation that
 * matters for selection. */
const policies = [{ name: "champion", net: champ }];
const sigmas = [0.002, 0.005, 0.01, 0.02, 0.05, 0.12, 0.3];
for (let i = 0; i < NPOL - 1; i++) {
    if (i < 6) {
        policies.push({
            name: `untrained#${i}`,
            net: buildNet(cfg.arch, env.layout, mulberry32(31337 + i * 7919)),
        });
    } else {
        const sg = sigmas[(i - 6) % sigmas.length];
        policies.push({
            name: `champ+σ${sg}`,
            net: champ.clone().mutate(0.10, sg, mulberry32(777 + i * 331)),
        });
    }
}

/* ─── Spearman rank correlation ───────────────────────────────────────────── */
function ranks(xs) {
    const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(xs.length);
    let i = 0;
    while (i < idx.length) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
        const avg = (i + j) / 2 + 1;                     // average rank for ties
        for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
        i = j + 1;
    }
    return r;
}
function spearman(a, b) {
    const ra = ranks(a), rb = ranks(b);
    const n = a.length;
    const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
        num += (ra[i] - ma) * (rb[i] - mb);
        da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : 0;
}

const REW_NAMES = Object.keys(REWARDS);
const P = rewardParams(cfg.env.rewardParams);

console.log(`champion: ${src} — gen ${saved.gen}, frontier depth ${saved.depth}`);
console.log(`${policies.length} policies (1 champion, 6 untrained, ${policies.length - 7} damaged copies)`);
console.log(`${GAMES} held-out scrambles at each of depths ${DEPTHS.join(", ")}\n`);

const table = [];
for (const d of DEPTHS) {
    const bank = env.makeDepthBank(4400001 + d * 104729, GAMES, d);
    /* One pass per policy; every reward is read off the same traces, so the
     * comparison is not confounded by different brains meeting different cubes. */
    const rewardMeans = REW_NAMES.map(() => []);
    const truth = [];
    for (const pol of policies) {
        const sums = new Array(REW_NAMES.length).fill(0);
        let t = 0;
        for (const scr of bank) {
            const tr = env.runEpisode(pol.net, scr);
            REW_NAMES.forEach((n, k) => { sums[k] += rewardOf(n).fn(tr, P); });
            const desc = tr.d0 > 0 ? (tr.d0 - tr.dBest) / tr.d0 : 1;
            t += 0.7 * (tr.solved ? 1 : 0) + 0.3 * desc;
        }
        REW_NAMES.forEach((n, k) => rewardMeans[k].push(sums[k] / bank.length));
        truth.push(t / bank.length);
    }
    const row = { depth: d, solveSpread: [Math.min(...truth), Math.max(...truth)], corr: {} };
    REW_NAMES.forEach((n, k) => { row.corr[n] = spearman(rewardMeans[k], truth); });
    table.push(row);
    process.stdout.write(`  depth ${d} done\n`);
}

/* ─── report ──────────────────────────────────────────────────────────────── */
console.log(`\nSpearman rank correlation between each reward and ground truth`);
console.log(`(how faithfully the reward orders ${policies.length} policies of differing quality)`);
console.log("─".repeat(20 + DEPTHS.length * 8));
console.log("  reward".padEnd(20) + DEPTHS.map(d => ("d" + d).padStart(8)).join(""));
console.log("─".repeat(20 + DEPTHS.length * 8));
const oracleMark = n => (rewardOf(n).oracle ? "*" : " ");
for (const n of REW_NAMES) {
    console.log("  " + (n + oracleMark(n)).padEnd(18) +
        table.map(r => r.corr[n].toFixed(2).padStart(8)).join(""));
}
console.log("─".repeat(20 + DEPTHS.length * 8));
console.log("  * uses the distance oracle");

/* The headline: does the sticker family lose its grip as the cube gets deeper,
 * while the distance family holds? That is the claim rewards.js makes, and it is
 * either in these numbers or it is not. */
const fam = (names, r) => names.reduce((s, n) => s + r.corr[n], 0) / names.length;
const STICK = ["stickers", "bestStickers", "progress", "faces"];
const DIST = ["descent", "descentFast", "hover", "mixed"];
console.log(`\n  family means:`);
console.log(`    sticker-based (no oracle) : ` +
    table.map(r => fam(STICK, r).toFixed(2).padStart(8)).join(""));
console.log(`    distance-based (oracle)   : ` +
    table.map(r => fam(DIST, r).toFixed(2).padStart(8)).join(""));
console.log(`    solved (binary)           : ` +
    table.map(r => r.corr.solved.toFixed(2).padStart(8)).join(""));

const shallow = table[0], deep = table[table.length - 1];
if (shallow && deep && shallow !== deep) {
    const ds = fam(STICK, deep) - fam(STICK, shallow);
    const dd = fam(DIST, deep) - fam(DIST, shallow);
    console.log(`\n  from depth ${shallow.depth} to depth ${deep.depth}: ` +
        `sticker family ${ds >= 0 ? "+" : ""}${ds.toFixed(2)}, ` +
        `distance family ${dd >= 0 ? "+" : ""}${dd.toFixed(2)}`);
    if (ds < dd - 0.05) {
        console.log(`  The sticker rewards lose their grip faster than the distance rewards,`);
        console.log(`  which is the predicted mechanism: counting stickers cannot tell U from`);
        console.log(`  U2 from U', and that distinction only starts to matter below the surface.`);
    } else if (Math.abs(ds - dd) <= 0.05) {
        console.log(`  Both families degrade about equally. The predicted mechanism is NOT`);
        console.log(`  visible here — either it needs greater depth than the oracle reaches,`);
        console.log(`  or the spread of policies is not the one selection actually sees.`);
    } else {
        console.log(`  The distance rewards degrade faster, which contradicts the prediction`);
        console.log(`  in rewards.js. Take the numbers over the prose.`);
    }
}
console.log(`\n  (truth spread at the deepest rung: ` +
    `${deep.solveSpread[0].toFixed(3)} … ${deep.solveSpread[1].toFixed(3)} — a correlation`);
console.log(`   over a narrow spread is not worth much, so check this before believing a row.)`);
