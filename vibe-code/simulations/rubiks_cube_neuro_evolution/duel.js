/* duel.js — score every candidate a run produced on one shared bank, name the best.
 *
 *   node duel.js training/finalA/snaps/*.json
 *   node duel.js --games 200 --depths 1,2,3,4,5,6,7 --out training/finalA/best.json \
 *        training/finalA/snaps/*.json training/finalA/champion.json
 *
 * ─── why a run needs this ──────────────────────────────────────────────────
 *
 * `champion.json` holds whichever brain was wearing the crown when the run stopped,
 * and that is not the best brain the run produced. Elitism is monotone only against a
 * fixed bank; the held-out gate rotates on purpose, so that it cannot slowly become
 * the training set. A challenger that wins one rotation keeps the title for good, and
 * nothing ever re-checks the brain it displaced. Near a plateau, where the gate's
 * noise is larger than the differences being decided, the title performs a slow random
 * walk downhill — and the log shows `best` fitness climbing the whole way, because
 * that number is measured on the moving bank too.
 *
 * Measured, not supposed: two three-hour continuations of the round-three champion
 * finished at 0.308 and 0.279 against their own starting point's 0.328.
 *
 * So the run keeps snapshots and this decides between them, on common random numbers
 * at a sample size a training loop cannot afford. Ranking is on the same yardstick
 * every other comparison in the project uses, and the winner is re-stated with its
 * paired margin over the runner-up so that "best" comes with a standard error.
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

const GAMES = num("games", 200);
const DEPTHS = String(arg("depths", "1,2,3,4,5,6,7")).split(",").map(Number);
/* Deliberately not evaluate.js's default and not report_card.js's either: this bank
 * chooses the winner, so the bank that *reports* it has to be a different one. */
const BANK_SEED = num("bank-seed", 55000091);
const OUTFILE = arg("out", null);

const files = process.argv.slice(2).filter(a => !a.startsWith("--") && /\.json$/.test(a)
    && fs.existsSync(path.resolve(__dirname, a)));
if (!files.length) { console.error("no candidate .json files given"); process.exit(1); }

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

console.log(`duel — ${files.length} candidates on ${total} shared scrambles ` +
    `(depths ${DEPTHS.join(",")}, ${GAMES} each, bank seed ${BANK_SEED})\n`);

const envCache = new Map();
function envFor(cfg) {
    const k = JSON.stringify(cfg.env);
    if (!envCache.has(k)) envCache.set(k, new Env(Object.assign({}, cfg.env, { forceOracle: true })));
    return envCache.get(k);
}

const rows = [];
for (const f of files) {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(path.resolve(__dirname, f), "utf8")); }
    catch (e) { console.log(`  ${f}: unreadable — ${e.message}`); continue; }
    const cfg = resolveConfig(saved.config);
    /* One Env per distinct observation config, not per candidate. Each Env builds its
     * own BFS distance table — about 40 MB — so eighty snapshots from ten runs is
     * three gigabytes of identical lookup tables and the process dies of heap
     * exhaustion partway through the table it was asked to print. Snapshots from a run
     * all share a config, so this collapses to one Env per run. */
    const env = envFor(cfg);
    const net = netFromJSON(saved);
    const r = evaluateBrain(env, net, banks);
    rows.push({ f, saved, env, net, r, gen: saved.gen || 0 });
}
if (!rows.length) { console.error("nothing scored"); process.exit(1); }
rows.sort((a, b) => b.r.score - a.r.score);

/* Snapshots from different runs are all called gen001500.json, so the basename alone
 * makes a cross-run table unreadable — and worse, quietly ambiguous. Keep the run
 * directory in the label. */
const label = f => path.basename(path.dirname(path.dirname(f))) + "/" + path.basename(f);
const pct = x => (x * 100).toFixed(1).padStart(5);
console.log("  candidate".padEnd(34) + "gen".padStart(7) + "score".padStart(8) +
    "   " + DEPTHS.map(d => ("d" + d).padStart(6)).join(""));
console.log("─".repeat(34 + 15 + 6 * DEPTHS.length));
for (const row of rows) {
    const per = DEPTHS.map(d => {
        const e = row.r.byDepth.find(x => x.depth === d);
        return (e ? pct(e.solveRate) : "    —").padStart(6);
    }).join("");
    console.log("  " + label(row.f).padEnd(32) + String(row.gen).padStart(7) +
        row.r.score.toFixed(3).padStart(8) + "   " + per);
}
console.log("─".repeat(34 + 15 + 6 * DEPTHS.length));

const win = rows[0], up = rows[1];
if (up && win.net.contract() === up.net.contract()) {
    const pd = pairedDelta(win.env, win.net, up.net, banks);
    const sig = pd.delta / Math.max(1e-9, pd.se);
    console.log(`\nwinner: ${label(win.f)} (gen ${win.gen}), score ${win.r.score.toFixed(3)}`);
    console.log(`  over the runner-up, paired on the same ${pd.n} scrambles: ` +
        `Δ = +${pd.delta.toFixed(4)} ± ${pd.se.toFixed(4)} (${sig.toFixed(1)} SE)` +
        (sig < 2 ? " — inside the noise, so this pick is a coin toss between the top two" : ""));
} else {
    console.log(`\nwinner: ${label(win.f)} (gen ${win.gen}), score ${win.r.score.toFixed(3)}`);
}
/* How far the crown drifted: the last-crowned brain against the best-ever one. This
 * is the number that says whether the run's own champion.json could be trusted. */
const last = rows.slice().sort((a, b) => b.gen - a.gen)[0];
if (last !== win) {
    console.log(`  the run's latest brain (gen ${last.gen}) scores ${last.r.score.toFixed(3)} — ` +
        `${(win.r.score - last.r.score).toFixed(3)} below the best it ever had. ` +
        `Taking champion.json on faith would have cost that.`);
}

if (OUTFILE) {
    fs.writeFileSync(path.resolve(__dirname, OUTFILE), JSON.stringify(win.saved));
    console.log(`  wrote ${OUTFILE}`);
}
