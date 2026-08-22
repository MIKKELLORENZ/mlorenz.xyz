/* report_card.js — the one table, for any number of brains, on one fresh bank.
 *
 *   node report_card.js                                   # the baked champion
 *   node report_card.js default_brain.js training/x/champion.json
 *   node report_card.js --games 600 --bank-seed 4242 a.json b.json
 *
 * Prints solve rate per depth against untrained brains played on the identical
 * scrambles, plus the paired difference between every brain and the first one.
 *
 * ─── why this exists next to evaluate.js ───────────────────────────────────
 *
 * evaluate.js is the library; grid_search.js calls it with a small bank because it
 * is ranking two dozen cells and only needs an ordering. A shipping decision is a
 * different question and needs a different sample size: at 120 games a depth-4
 * solve rate has a standard error of about 4 points, which is the same size as the
 * improvement being argued about. Everything here defaults to 600.
 *
 * The bank seed is a parameter, and the default is deliberately *not*
 * evaluate.js's. Every grid this project has run was ranked on EVAL_SEED_BASE;
 * that makes it, by the end of a night of selection, a set the winner was chosen
 * against. A final claim should be made on scrambles that took no part in choosing
 * the brain making it.
 *
 * Brains are always rebuilt from their own saved config and run in their own Env,
 * because the observation layout is exactly what several of tonight's cells vary.
 * A scramble is a cube, a true distance and a budget — none of which depends on
 * how a brain sees.
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
const num = (n, d) => { const v = arg(n, null); return v === null ? d : +v; };

const GAMES = num("games", 600);
const BANK_SEED = num("bank-seed", 31337077);
const DEPTHS = String(arg("depths", "1,2,3,4,5,6,7")).split(",").map(Number);
const CONTROLS = num("controls", 8);

const files = process.argv.slice(2).filter(a => !a.startsWith("--") &&
    !/^\d/.test(a) && /\.(json|js)$/.test(a));
if (!files.length) files.push("default_brain.js");

/* Both shapes carry `.net` and `.config`: champion.json straight from the trainer,
 * and default_brain.js which assigns one to `window`. */
function loadBrain(f) {
    const p = path.resolve(__dirname, f);
    if (p.endsWith(".js")) {
        const sandbox = {};
        const prev = global.window;
        global.window = sandbox;
        delete require.cache[require.resolve(p)];
        require(p);
        const b = sandbox.DEFAULT_BRAIN;
        global.window = prev;
        if (!b) throw new Error(`${f} did not set window.DEFAULT_BRAIN`);
        return b;
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

/* The reference env only draws scrambles and holds the oracle; brains still run in
 * their own. It matters here for one reason: makeEvalBanks skips any depth past the
 * reference env's depthCap, and the default config caps at the oracle radius of 7. So
 * asking for depths 8-12 against the default reference silently returns nothing at
 * all rather than an error. --ref-config names a config whose depthCapOverride is high
 * enough to draw them. */
const REF_CONFIG = arg("ref-config", "default");
const refEnv = new Env(Object.assign({}, resolveConfig(REF_CONFIG).env, { forceOracle: true }));
const banks = makeEvalBanks(refEnv, DEPTHS, GAMES, BANK_SEED);
const total = banks.reduce((s, b) => s + b.scrambles.length, 0);

console.log(`report card — ${total} held-out scrambles ` +
    `(depths ${DEPTHS.join(",")}, ${GAMES} each, bank seed ${BANK_SEED})\n`);

const rows = [];
for (const f of files) {
    let saved;
    try { saved = loadBrain(f); }
    catch (e) { console.log(`  ${f}: could not load — ${e.message}`); continue; }
    const cfg = resolveConfig(saved.config);
    const env = new Env(Object.assign({}, cfg.env, { forceOracle: true }));
    const net = netFromJSON(saved);
    const r = evaluateBrain(env, net, banks);
    /* How many of the eight turns the brain still actually plays. The plateau in
     * round 2 was three dead output units, and a score alone does not show it. */
    const live = env.scoreBrain(net, banks.flatMap(b => b.scrambles));
    rows.push({
        f, saved, cfg, env, net, r,
        live: live.liveActions, coverage: live.coverage,
        gen: saved.gen, frontier: saved.depth,
        contract: saved.contract || net.contract(),
    });
}
if (!rows.length) { console.log("nothing to report on"); process.exit(1); }

/* The untrained baseline, on the identical scrambles, in each brain's own
 * architecture — random weights in a big network are not the same baseline as
 * random weights in a small one. */
const ctrlByContract = new Map();
for (const row of rows) {
    if (ctrlByContract.has(row.contract)) continue;
    ctrlByContract.set(row.contract, controlScore(row.env, row.cfg.arch, banks, CONTROLS, 4242));
}

for (const row of rows) {
    const ctrl = ctrlByContract.get(row.contract);
    console.log(`── ${row.f}`);
    console.log(`   gen ${row.gen} · frontier depth ${row.frontier} · ${row.contract}` +
        ` · ${row.live}/${row.env.nMoves} live actions`);
    console.log("   depth" + "solved".padStart(10) + "untrained".padStart(12) +
        "descent".padStart(10) + "  moves");
    for (let i = 0; i < row.r.byDepth.length; i++) {
        const d = row.r.byDepth[i], c = ctrl.byDepth[i];
        console.log("   " + String(d.depth).padStart(5) +
            (d.solveRate * 100).toFixed(1).padStart(9) + "%" +
            (c.solveRate * 100).toFixed(1).padStart(11) + "%" +
            d.descent.toFixed(3).padStart(10) +
            d.movesWhenSolved.toFixed(1).padStart(8));
    }
    console.log(`   score ${row.r.score.toFixed(3)} vs ${ctrl.score.toFixed(3)} untrained ` +
        `(${(row.r.score / Math.max(1e-9, ctrl.score)).toFixed(1)}×) · ` +
        `d@50% ${row.r.depthAt50} · undo ${(row.r.undoRate * 100).toFixed(1)}%`);
    console.log("");
}

/* Paired against the first brain listed. Same scrambles for both sides, so the
 * difference has a much smaller standard error than either brain's own number —
 * which is the entire reason the bank is shared. Only meaningful between brains
 * whose observation contract matches; across contracts the two Envs disagree about
 * what the brain is even given, so the comparison falls back to unpaired. */
if (rows.length > 1) {
    const base = rows[0];
    console.log(`paired against ${base.f}, on the same ${total} scrambles:`);
    for (const row of rows.slice(1)) {
        if (row.contract === base.contract) {
            const pd = pairedDelta(base.env, row.net, base.net, banks);
            const sig = Math.abs(pd.delta) / Math.max(1e-9, pd.se);
            console.log(`  ${row.f.padEnd(46)} Δ = ${pd.delta >= 0 ? "+" : ""}${pd.delta.toFixed(4)}` +
                ` ± ${pd.se.toFixed(4)}  (${sig.toFixed(1)} SE)` +
                (sig < 2 ? "  — inside the noise" : pd.delta > 0 ? "  — better" : "  — worse"));
        } else {
            const d = row.r.score - base.r.score;
            console.log(`  ${row.f.padEnd(46)} Δ = ${d >= 0 ? "+" : ""}${d.toFixed(4)}` +
                `  (unpaired — different observation contract)`);
        }
    }
}
