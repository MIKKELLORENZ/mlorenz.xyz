/* probe_champion.js — what did the thing actually learn?
 *
 *   node probe_champion.js                        # probes training/champion.json
 *   node probe_champion.js --in default_brain.js --games 40
 *
 * A ladder percentage says whether a brain wins. It does not say why, and the
 * two most common failure modes both hide behind a mediocre percentage: a brain
 * that shuffles to repetition draws, and a brain that hangs a piece every few
 * moves and wins anyway because the opponent is worse. This prints the per-move
 * behaviour - captures, hangs, blunders, castling, development, draw reasons -
 * next to an untrained genome measured the same way, so the numbers have a
 * scale.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["chess.js", "features.js", "nn.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

function arg(name, dflt) {
    const i = process.argv.indexOf("--" + name);
    if (i < 0) return dflt;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith("--") ? true : v;
}

const IN = String(arg("in", path.join(__dirname, "training", "champion.json")));
const GAMES = +arg("games", 30);

function loadGenome(file) {
    const raw = fs.readFileSync(file, "utf8");
    // Accept both a bare champion.json and a baked default_brain.js.
    const m = raw.match(/DEFAULT_BRAIN\s*=\s*(\{[\s\S]*?\});/);
    const loaded = deserializeGenome(m ? m[1] : raw);
    if (!loaded) { console.error(`not a ${NN_VERSION} genome: ${file}`); process.exit(1); }
    return loaded;
}

const target = loadGenome(IN);
const baselineRng = makeRng(0x1BADB002);
const baseline = randomGenome(baselineRng);

const atkW = new Int8Array(128), atkB = new Int8Array(128);

// Is this move putting a piece somewhere the opponent attacks and nobody
// defends, for no compensation? That is the single behaviour a searchless
// policy has to learn to suppress, and the one most visible in play.
function moveIsBlunder(game, m) {
    const side = game.turn;
    const moved = Math.abs(m.piece);
    if (moved === K) return false;
    const gained = m.capture !== 0 ? MAT_VAL[Math.abs(m.capture)] / 10 : 0;
    const undo = game._make(m);
    game.attackMaps(atkW, atkB);
    const opp = side === 1 ? atkB : atkW;
    const own = side === 1 ? atkW : atkB;
    const risked = opp[m.to] > 0 && own[m.to] === 0 ? MAT_VAL[moved] / 10 : 0;
    game._unmake(m, undo);
    return risked - gained > 0.9;
}

function play(genome, opponent, games, seed, tag) {
    const rng = makeRng(seed >>> 0);
    const stats = {
        tag, w: 0, d: 0, l: 0, plies: 0, games: 0, moves: 0,
        captures: 0, blunders: 0, checks: 0, castled: 0, promos: 0,
        firstPieceMoveSum: 0, matSum: 0, reasons: {}
    };
    for (let i = 0; i < games; i++) {
        const g = new Chess();
        applyOpening(g, (seed ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0);
        const meWhite = i % 2 === 0;
        const meSide = meWhite ? 1 : -1;
        let developed = 0;
        while (!g.result() && g.ply < MAX_PLIES) {
            const mine = g.turn === meSide;
            let m;
            if (mine) {
                const legal = g.moves();
                m = chooseMove(g, genome, 0, rng, null);
                if (!m) break;
                stats.moves++;
                if (m.capture !== 0) stats.captures++;
                if (m.flags & (8 | 16)) stats.castled++;
                if (m.promo !== 0) stats.promos++;
                if (Math.abs(m.piece) !== P && Math.abs(m.piece) !== K) developed++;
                if (moveIsBlunder(g, m)) stats.blunders++;
                void legal;
            } else {
                m = opponent(g, rng);
                if (!m) break;
            }
            g.push(m);
            if (mine && g.inCheck(-meSide)) stats.checks++;
        }
        const res = g.result();
        let winner, reason;
        if (res) { winner = res.winner; reason = res.reason; }
        else {
            const mat = g.material();
            winner = mat >= 1.5 ? 1 : mat <= -1.5 ? -1 : 0;
            reason = winner === 0 ? "balanced" : "adjudicated";
        }
        stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
        if (winner === meSide) stats.w++;
        else if (winner === 0) stats.d++;
        else stats.l++;
        stats.plies += g.ply;
        stats.games++;
        stats.matSum += g.material() * meSide;
        stats.firstPieceMoveSum += developed;
    }
    return stats;
}

function report(rows, title) {
    console.log(`\n${title}`);
    console.log("  opponent          score   W/D/L      plies  material  captures  blunders  checks  castles");
    for (const s of rows) {
        const score = (s.w + s.d * 0.5) / s.games;
        const per = n => (n / Math.max(1, s.moves) * 100).toFixed(1) + "%";
        console.log(
            `  ${s.tag.padEnd(16)}` +
            `${(score * 100).toFixed(0).padStart(5)}%  ` +
            `${`${s.w}/${s.d}/${s.l}`.padEnd(9)} ` +
            `${(s.plies / s.games).toFixed(0).padStart(5)}  ` +
            `${(s.matSum / s.games).toFixed(2).padStart(8)}  ` +
            `${per(s.captures).padStart(8)}  ` +
            `${per(s.blunders).padStart(8)}  ` +
            `${per(s.checks).padStart(6)}  ` +
            `${(s.castled / s.games * 100).toFixed(0).padStart(6)}%`);
    }
    const reasons = {};
    for (const s of rows) for (const [k, v] of Object.entries(s.reasons)) reasons[k] = (reasons[k] || 0) + v;
    const total = Object.values(reasons).reduce((a, b) => a + b, 0);
    console.log("  how games ended: " + Object.entries(reasons)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${(v / total * 100).toFixed(0)}%`).join(", "));
}

console.log(`probing ${IN}`);
console.log(`generation ${target.meta.gen ?? "?"}, ${GAMES} games per opponent, no exploration noise`);

const SEED = 0x5EEDCAFE;
const oppList = [
    ...LADDER.map(r => [r.label, r.fn]),
    ["itself", (g, rng) => chooseMove(g, target.genome, 0, rng, null)],
    ["an untrained net", (g, rng) => chooseMove(g, baseline, 0, rng, null)]
];

report(oppList.map(([label, fn], i) =>
    play(target.genome, fn, GAMES, SEED ^ (i * 7919), label)), "EVOLVED CHAMPION");

report(LADDER.map((r, i) =>
    play(baseline, r.fn, GAMES, SEED ^ (i * 7919), r.label)), "UNTRAINED GENOME (same architecture)");

console.log(`
  blunders = moves that put a piece on a square the opponent attacks and
             nobody defends, losing more than a pawn of value for nothing.
  material = average material balance at the end, in pawns, own perspective.
`);
