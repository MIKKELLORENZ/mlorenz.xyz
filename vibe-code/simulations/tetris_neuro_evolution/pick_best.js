/* pick_best.js — rank saved brains on held-out games and name a winner.
 *
 *   node pick_best.js training/**\/champion.json training/**\/final.json
 *   node pick_best.js --out training/best_holdout.json <files...>
 *
 * Every brain is replayed on the same bank of piece sequences that nothing ever
 * trained on, under its own sensor profile and architecture (which travel with it
 * in the file). Ranking is on reward-independent skill = pieces + 25 × lines, so
 * brains trained under different reward shapes are comparable at all.
 *
 * The winner is copied to --out, which is the only file the laptop needs to
 * fetch. Selection lives on the node deliberately: it is the node that has the
 * cores to replay 80 games per candidate, and the laptop may be asleep.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "tetris.js", "sensors.js", "world.js", "configs.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const BASE_R = Object.assign({}, R);

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    return process.argv[i + 1];
}
const OUT = arg("out", "training/best_holdout.json");
const N = +arg("games", 80);
const files = process.argv.slice(2).filter(a => !a.startsWith("--") &&
    a !== OUT && a !== String(N) && /\.json$/.test(a));

const SEEDS = [];
for (let i = 0; i < N; i++) SEEDS.push(1300001 + i * 7919);   // a bank used for nothing else

function play(net, seeds) {
    let pieces = 0, lines = 0, score = 0, buried = 0, placements = 0, best = 0;
    const m = { heights: new Int32Array(BW), holes: new Int32Array(BW) };
    for (const s of seeds) {
        const ag = new Agent(net, s, DEFAULT_CFG);
        let prev = 0;
        while (ag.alive) {
            const ev = ag.step(500);
            if (ev && ev.locked) {
                const bm = boardMetrics(ag.game.grid, m);
                buried += Math.max(0, bm.totalHoles - prev); prev = bm.totalHoles; placements++;
            }
        }
        pieces += ag.pieces; lines += ag.lines; score += ag.game.score;
        if (ag.lines > best) best = ag.lines;
    }
    const n = seeds.length;
    return {
        pieces: pieces / n, lines: lines / n, score: score / n, bestGame: best,
        buried: buried / Math.max(1, placements),
        skill: pieces / n + 25 * (lines / n),
    };
}

const rows = [];
for (const f of files) {
    const p = path.isAbsolute(f) ? f : path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    let saved;
    try { saved = JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { console.log(`skip ${f}: ${e.message}`); continue; }
    /* A brain without an embedded config is only interpretable if we can recover
     * one. Fall back to its config *name* before assuming the shipped defaults —
     * guessing "full profile, 64-32 MLP" for a 111-input ReLU brain does not
     * mis-score it (the contract check below catches that) but it does silently
     * drop it from the comparison, which is how a candidate disappears without
     * anyone noticing. */
    const cfg = saved.config ||
        (saved.configName && typeof CONFIGS !== "undefined" && CONFIGS[saved.configName]) ||
        { profile: "full", arch: { kind: "mlp", hidden: [64, 32] } };
    let desc, net;
    try {
        desc = applyConfig(cfg, BASE_R);
        net = netFromJSON(saved);
        if (net.contract() !== desc.contract) throw new Error(`contract ${net.contract()} != ${desc.contract}`);
    } catch (e) { console.log(`skip ${f}: ${e.message}`); continue; }
    const r = play(net, SEEDS);
    rows.push({
        file: f, configName: saved.configName || "default", gen: saved.gen || 0,
        contract: desc.contract, params: desc.params, trainFitness: saved.fitness || 0, ...r,
    });
    console.log(`${(saved.configName || "?").padEnd(22)} gen ${String(saved.gen || 0).padStart(5)}  ` +
        `skill ${r.skill.toFixed(1).padStart(6)}  pieces ${r.pieces.toFixed(1).padStart(5)}  ` +
        `lines ${r.lines.toFixed(2).padStart(5)}  buried ${r.buried.toFixed(2)}  ` +
        `best ${String(r.bestGame).padStart(2)}  ${path.basename(path.dirname(f))}`);
}

if (!rows.length) { console.error("no loadable brains"); process.exit(1); }
rows.sort((a, b) => b.skill - a.skill);
const win = rows[0];
console.log(`\nwinner: ${win.configName} gen ${win.gen} — skill ${win.skill.toFixed(1)} ` +
    `(${win.pieces.toFixed(1)} pieces, ${win.lines.toFixed(2)} lines) from ${win.file}`);

const saved = JSON.parse(fs.readFileSync(path.join(__dirname, win.file), "utf8"));
saved.holdout = { games: N, ...win };
fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify(saved));
fs.writeFileSync(path.join(__dirname, OUT.replace(/\.json$/, "_ranking.json")),
    JSON.stringify(rows, null, 1));
console.log(`wrote ${OUT} (validated on ${N} unseen sequences)`);
