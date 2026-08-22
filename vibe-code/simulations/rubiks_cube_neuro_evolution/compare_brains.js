/* compare_brains.js — which of these champions should ship?
 *
 *   node compare_brains.js training/main2/champion.json training/main3/champion.json
 *   node compare_brains.js training/a/champion.json training/b/champion.json --games 200
 *
 * ─── why this cannot be done from the training logs ───────────────────────
 *
 * Two temptations, both wrong.
 *
 * Comparing *fitness* is meaningless across runs with different rewards — that is
 * what evaluate.js exists to avoid. But comparing the **held-out gate score** is
 * wrong too, and more insidiously, because it looks like exactly the right number:
 * it is a solve-rate-and-descent measure on cubes nothing trained on, which is the
 * yardstick. The catch is that the gate bank is drawn at *each run's own curriculum
 * frontier*. A run sitting at depth 2 defends a bar built from depth-1-and-2 cubes;
 * a run at depth 3 defends one built from depth-1-to-3 cubes. Two such numbers
 * cannot be ranked at all: this project had 0.809 from a depth-2 run sitting beside
 * 0.767 from a depth-3 run, which says nothing about which brain was better because
 * the two were not answering the same questions.
 *
 * So the frontier depth is printed next to every gate score below, and when two runs
 * happen to share a frontier their gates *are* comparable and usually agree with the
 * honest number. The failure is specifically cross-frontier, not general.
 *
 * Any comparison of two brains has to put them in front of the *same* cubes. That is
 * all this script does, plus a paired standard error so "better" comes with a size.
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

const paths = process.argv.slice(2).filter(a => a.endsWith(".json"));
if (paths.length < 1) {
    console.error("usage: node compare_brains.js <champion.json> [more...] [--games N]");
    process.exit(1);
}

const GAMES = +arg("games", 150);
const DEPTHS = String(arg("depths", "1,2,3,4,5,6,7")).split(",").map(Number);

/* The reference Env only builds the scrambles and holds the oracle. Each brain is
 * then run inside its *own* Env, because the observation layout is exactly what
 * differs between these candidates — and a scramble is a cube, a distance and a
 * budget, none of which depends on how a brain sees. */
const refEnv = new Env(Object.assign({}, resolveConfig("default").env,
    { forceOracle: true, depthCapOverride: 8, oracleRadius: 7 }));
const banks = makeEvalBanks(refEnv, DEPTHS.filter(d => d <= refEnv.oracle.radius), GAMES);
const total = banks.reduce((s, b) => s + b.scrambles.length, 0);

const cands = [];
for (const p of paths) {
    const file = path.isAbsolute(p) ? p : path.join(__dirname, p);
    if (!fs.existsSync(file)) { console.log(`  skipping ${p} — not found`); continue; }
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    const cfg = resolveConfig(saved.config || "default");
    const env = new Env(Object.assign({}, cfg.env, { forceOracle: true, depthCapOverride: 8 }));
    const net = netFromJSON(saved);
    const info = env.contractInfo(cfg.arch);
    if (net.contract() !== info.contract) {
        console.log(`  skipping ${p} — brain is ${net.contract()}, its config says ${info.contract}`);
        continue;
    }
    cands.push({
        name: path.basename(path.dirname(file)), path: p, saved, cfg, env, net,
        params: info.params, contract: info.contract,
    });
}
if (!cands.length) { console.error("nothing loadable"); process.exit(1); }

console.log(`${cands.length} champion(s) on the same ${total} held-out scrambles ` +
    `(depths ${banks.map(b => b.depth).join(",")}, ${GAMES} each)\n`);

for (const c of cands) {
    c.result = evaluateBrain(c.env, c.net, banks);
}
cands.sort((a, b) => b.result.score - a.result.score);

const W = banks.map(b => b.depth);
console.log("  run".padEnd(14) + "config".padEnd(14) + "gen".padStart(6) + "front".padStart(6) +
    "params".padStart(8) + "score".padStart(8) + "  " + W.map(d => ("d" + d).padStart(6)).join(""));
console.log("─".repeat(56 + W.length * 6));
for (const c of cands) {
    console.log("  " + c.name.padEnd(12) + String(c.saved.configName || "?").padEnd(14) +
        String(c.saved.gen).padStart(6) + String(c.saved.depth || "?").padStart(6) +
        c.params.toLocaleString("en-US").padStart(8) +
        c.result.score.toFixed(3).padStart(8) + "  " +
        c.result.byDepth.map(r => `${(r.solveRate * 100).toFixed(0)}%`.padStart(6)).join(""));
}
console.log("─".repeat(56 + W.length * 6));

/* The gate scores from the logs, side by side with the honest number, so the trap
 * described in the header is visible rather than just documented. */
if (cands.some(c => c.saved.gateSkill != null)) {
    console.log(`\n  for comparison, each run's own gate score — NOT comparable across runs,`);
    console.log(`  because each gate bank is drawn at that run's own curriculum frontier:`);
    for (const c of cands) {
        console.log(`    ${c.name.padEnd(12)} gate ${(c.saved.gateSkill || 0).toFixed(3)} ` +
            `at frontier depth ${c.saved.depth}   → honest score ${c.result.score.toFixed(3)}`);
    }
}

/* Paired head-to-head against the leader: same cubes, per-episode differences, so
 * the standard error is the SE of a difference rather than of two independent means.
 * That is the whole reason for reusing the bank. */
if (cands.length > 1) {
    const best = cands[0];
    console.log(`\n  paired against ${best.name}, per-episode, on the identical cubes:`);
    for (const c of cands.slice(1)) {
        /* Both brains must be driven through their own Env; pairedDelta takes one, so
         * do it by hand when the layouts differ. */
        const diffs = [];
        for (const b of banks) {
            for (const scr of b.scrambles) {
                const q = (env, net) => {
                    const tr = env.runEpisode(net, scr);
                    const desc = tr.d0 > 0 ? (tr.d0 - tr.dBest) / tr.d0 : 1;
                    return 0.7 * (tr.solved ? 1 : 0) + 0.3 * desc;
                };
                diffs.push(q(best.env, best.net) - q(c.env, c.net));
            }
        }
        const n = diffs.length;
        const m = diffs.reduce((s, x) => s + x, 0) / n;
        const v = diffs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
        const se = Math.sqrt(v / n);
        const sigmas = se > 0 ? m / se : 0;
        console.log(`    vs ${c.name.padEnd(12)} Δ = ${m >= 0 ? "+" : ""}${m.toFixed(4)} ± ${se.toFixed(4)}  ` +
            `(${Math.abs(sigmas).toFixed(1)} SE)  ` +
            (Math.abs(sigmas) < 2 ? "— not separated" : m > 0 ? "— leader is better" : "— leader is WORSE"));
    }
}

const best = cands[0];
console.log(`\n  ship: ${best.path}  (score ${best.result.score.toFixed(3)}, ` +
    `deepest rung solved ≥50% of the time: ${best.result.depthAt50 || "none"})`);
