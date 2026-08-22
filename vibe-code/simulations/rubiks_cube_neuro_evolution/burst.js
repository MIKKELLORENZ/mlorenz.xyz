/* burst.js — the 18-minute check. Is anything actually moving?
 *
 *   node burst.js training/A/snaps/gen000500.json training/B/snaps/gen000500.json
 *   node burst.js --games 120 --top 12 <list of snapshot files>
 *
 * Prints, for every candidate on one shared bank:
 *
 *   · solve rate at depths 5, 6, 7 — the number that is wanted
 *   · self-play per-move accuracy — the number that *causes* it
 *
 * The second column is the one to steer by, and it took four rounds to work out why.
 * Every move changes the true distance by exactly +/-1 here (bipartite Cayley graph),
 * so self-play is a walk that descends with probability p. Solving depth 7 inside its
 * budget needs p around 0.855; the shipped champion runs at 0.535 overall and only
 * 0.38-0.46 at distances four to six, which is below the break-even where progress is
 * even expected. It reaches the solved cube by luck rather than by policy.
 *
 * Solve rate cannot see that. It is one bit per episode, it saturates at the shallow
 * end, and at the deep end it is mostly noise at any bank size a training loop can
 * afford. Accuracy is measured per decision — a dozen labelled samples per episode —
 * so it moves visibly long before the solve rate does, which is exactly what a
 * short check needs to avoid mistaking "not moving yet" for "not working".
 *
 * Accuracy is measured on the brain's OWN rollout, not on the oracle's path. On-path
 * accuracy is the flattering version: the imitation runs reached 0.81 there while
 * solving worse than the champion, because a brain that is accurate on optimal
 * trajectories has never been asked what to do after its first mistake.
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

const GAMES = num("games", 100);
const DEPTHS = String(arg("depths", "5,6,7")).split(",").map(Number);
const BANK_SEED = num("bank-seed", 55000091);
const TOP = num("top", 99);

const files = process.argv.slice(2).filter(a => !a.startsWith("--") && /\.json$/.test(a)
    && fs.existsSync(path.resolve(__dirname, a)));
if (!files.length) { console.error("no candidates"); process.exit(1); }

const envCache = new Map();
function envFor(cfg) {
    const k = JSON.stringify(cfg.env);
    if (!envCache.has(k)) envCache.set(k, new Env(Object.assign({}, cfg.env, { forceOracle: true })));
    return envCache.get(k);
}

const label = f => path.basename(path.dirname(path.dirname(f))) + "/" +
    path.basename(f).replace(/\.json$/, "").replace(/^gen0*/, "g");

const rows = [];
for (const f of files) {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(path.resolve(__dirname, f), "utf8")); }
    catch (e) { continue; }
    const cfg = resolveConfig(saved.config);
    const env = envFor(cfg);
    const net = netFromJSON(saved);
    const solves = [];
    let hit = 0, dec = 0;
    const byDist = new Map();
    for (const d of DEPTHS) {
        const rng = mulberry32((BANK_SEED + d * 104729) >>> 0);
        let s = 0;
        for (let i = 0; i < GAMES; i++) {
            const { state } = scramble(rng, d, env.set);
            const d0 = distanceOf(env.oracle, state);
            const r = new Runner(env, net, {
                state: state.slice(), depth: d, d0,
                budget: env.budgetFor(env.budgetBasis(d0, d)),
            });
            while (!r.done) {
                const cur = distanceOf(env.oracle, r.state);
                const opt = env.optimalSet(r.state);
                if (!opt.length) break;
                const pick = chooseMove(r.peek());
                let e = byDist.get(cur); if (!e) byDist.set(cur, e = { n: 0, hit: 0 });
                e.n++; dec++;
                if (opt.indexOf(pick) >= 0) { e.hit++; hit++; }
                r.step(pick);
            }
            if (r.solvedFlag) s++;
        }
        solves.push(s / GAMES);
    }
    rows.push({
        f, gen: saved.gen || 0, solves, acc: dec ? hit / dec : 0,
        mid: [4, 5, 6].reduce((a, k) => {
            const e = byDist.get(k); return e ? { n: a.n + e.n, hit: a.hit + e.hit } : a;
        }, { n: 0, hit: 0 }),
    });
}
rows.sort((a, b) => b.acc - a.acc);

console.log(`burst — ${rows.length} candidates, ${GAMES} cubes at each of depths ${DEPTHS.join(",")}\n`);
console.log("  candidate".padEnd(26) + "gen".padStart(7) + "  acc".padStart(7) +
    " acc@4-6".padStart(9) + DEPTHS.map(d => ("d" + d).padStart(7)).join(""));
console.log("─".repeat(26 + 23 + 7 * DEPTHS.length));
for (const r of rows.slice(0, TOP)) {
    console.log("  " + label(r.f).padEnd(24) + String(r.gen).padStart(7) +
        (r.acc * 100).toFixed(1).padStart(6) + "%" +
        (r.mid.n ? (r.mid.hit / r.mid.n * 100).toFixed(1) : "—").padStart(8) + "%" +
        r.solves.map(s => (s * 100).toFixed(1).padStart(7)).join(""));
}
console.log("─".repeat(26 + 23 + 7 * DEPTHS.length));
console.log("  target for 90% at depth 7: accuracy ≈ 85% at every distance.");
