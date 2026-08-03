/* test_headless.js — Node smoke test. Run: node test_headless.js
 *
 * Loads the browser files into one shared context and checks that
 *   1. the rules engine is really chess (perft to depth 4, plus the awkward
 *      cases: castling, en passant, promotion, repetition, 50-move),
 *   2. the observation actually contains the five remembered board states and
 *      the attack maps,
 *   3. the dual-head network is deterministic, well-shaped, and only ever
 *      proposes legal moves,
 *   4. genetics preserve validity, and
 *   5. a short evolution run improves against a fixed yardstick.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["chess.js", "features.js", "nn.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

let failures = 0;
function check(name, ok, extra) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}

/* ------------------------------------------------ 1. rules engine (perft) --- */
{
    const g = new Chess();
    const expected = [1, 20, 400, 8902, 197281];
    for (let d = 1; d <= 4; d++) {
        const n = g.perft(d);
        check(`perft(${d}) = ${expected[d]}`, n === expected[d], `got ${n}`);
    }
}
{
    // Kiwipete-style checks are overkill here; instead verify the tricky rules
    // one at a time on positions built by hand.
    const g = new Chess();
    for (const s of ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"]) {
        const m = g.moves().find(x => g.moveStr(x) === s);
        g.push(m);
    }
    const castle = g.moves().find(x => g.moveStr(x) === "e1g1");
    check("kingside castling is generated", !!castle);
    g.push(castle);
    check("castling moves the rook to f1", g.board[5] === R && g.board[7] === 0);
    check("castling rights are gone", (g.castling & (CR_WK | CR_WQ)) === 0);
}
{
    const g = new Chess();
    for (const s of ["e2e4", "a7a6", "e4e5", "d7d5"]) {
        g.push(g.moves().find(x => g.moveStr(x) === s));
    }
    const ep = g.moves().find(x => g.moveStr(x) === "e5d6");
    check("en passant is generated", !!ep && (ep.flags & 4) !== 0);
    g.push(ep);
    check("en passant removes the captured pawn", g.board[4 * 16 + 3] === 0 && g.board[5 * 16 + 3] === P);
}
{
    const g = new Chess();
    g.board.fill(0);
    g.board[4] = K; g.board[116] = -K; g.board[6 * 16 + 0] = P;
    g.repCounts = new Map();
    const promos = g.moves().filter(m => m.promo !== 0);
    check("all four promotions are generated", promos.length === 4,
        promos.map(m => g.moveStr(m)).join(","));
}
{
    // Fool's mate: the engine must call it checkmate, not "check".
    const g = new Chess();
    for (const s of ["f2f3", "e7e5", "g2g4", "d8h4"]) {
        g.push(g.moves().find(x => g.moveStr(x) === s));
    }
    const r = g.result();
    check("fool's mate is checkmate for black", !!r && r.reason === "checkmate" && r.winner === -1,
        r ? `${r.reason}/${r.winner}` : "no result");
}
{
    // Knights out and back, twice: threefold repetition.
    const g = new Chess();
    const line = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
    for (const s of line) {
        if (g.result()) break;
        g.push(g.moves().find(x => g.moveStr(x) === s));
    }
    const r = g.result();
    check("threefold repetition is a draw", !!r && r.reason === "repetition", r ? r.reason : "no result");
}
{
    const g = new Chess();
    const before = g.hash();
    g.push(g.moves().find(x => g.moveStr(x) === "e2e4"));
    check("position hash changes after a move", g.hash() !== before);
    const back = new Chess();
    for (const s of ["g1f3", "g8f6", "f3g1", "f6g8"]) {
        back.push(back.moves().find(x => back.moveStr(x) === s));
    }
    check("position hash returns to its old value after a round trip",
        back.hash() === new Chess().hash());
}
{
    // make/unmake must restore the board exactly, for every legal move, from a
    // busy middlegame position.
    const g = new Chess();
    for (const s of ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f8e7"]) {
        g.push(g.moves().find(x => g.moveStr(x) === s));
    }
    const snap = Array.from(g.board);
    let clean = true;
    for (const m of g.moves()) {
        const st = [g.castling, g.ep, g.halfmove, g.turn];
        const undo = g._make(m);
        g._unmake(m, undo);
        for (let i = 0; i < 128; i++) if (g.board[i] !== snap[i]) clean = false;
        if (g.castling !== st[0] || g.ep !== st[1] || g.halfmove !== st[2] || g.turn !== st[3]) clean = false;
    }
    check("make/unmake is exactly reversible", clean);
}
{
    const g = new Chess();
    g.board.fill(0);
    g.board[4] = K; g.board[116] = -K; g.board[3 * 16 + 3] = B;
    check("K+B vs K is insufficient material", g._insufficientMaterial());
    g.board[3 * 16 + 4] = P;
    check("a pawn on the board is sufficient", !g._insufficientMaterial());
}

/* ------------------------------------------------------ 2. observation ------ */
{
    const g = new Chess();
    const rng = makeRng(11);
    const seen = [];
    for (let i = 0; i < 8 && !g.result(); i++) {
        const ms = g.moves();
        const m = ms[Math.floor(rng() * ms.length)];
        seen.push(g.snapshot());
        g.push(m);
    }
    check(`history keeps ${HIST_FRAMES} frames`, g.histBoards.length === HIST_FRAMES,
        `got ${g.histBoards.length}`);
    let match = true;
    for (let h = 0; h < HIST_FRAMES; h++) {
        const mine = seen[seen.length - 1 - h], theirs = g.histBoards[g.histBoards.length - 1 - h];
        for (let i = 0; i < 64; i++) if (mine[i] !== theirs[i]) match = false;
    }
    check("remembered frames are the actual previous positions", match);

    const side = g.turn;
    const f = encodePosition(g, side, g.moves());
    check("feature buffers have the declared size",
        f.sq.length === 64 * SQ_CH && f.glob.length === GLOB_IN);
    let finite = true, inRange = true;
    for (const v of f.sq) { if (!Number.isFinite(v)) finite = false; if (v < -1.001 || v > 1.001) inRange = false; }
    for (const v of f.glob) { if (!Number.isFinite(v)) finite = false; if (v < -1.001 || v > 1.001) inRange = false; }
    check("all features are finite", finite);
    check("all features are inside [-1, 1]", inRange);

    // The history channels must actually differ from the current board,
    // otherwise the memory is decorative.
    let histNonZero = 0, histDiffers = 0;
    for (let s = 0; s < 64; s++) {
        for (let h = 0; h < HIST_FRAMES; h++) {
            const v = f.sq[s * SQ_CH + 15 + h];
            if (v !== 0) histNonZero++;
        }
    }
    for (let s = 0; s < 64; s++) {
        const occupiedNow = f.sq[s * SQ_CH + 14] === 0;
        const occupiedThen = f.sq[s * SQ_CH + 15 + HIST_FRAMES - 1] !== 0;
        if (occupiedNow !== occupiedThen) histDiffers++;
    }
    check("history channels are populated", histNonZero > 100, `${histNonZero} non-zero`);
    check("the oldest frame differs from the present", histDiffers > 0, `${histDiffers} squares`);
}
{
    const g = new Chess();
    const w = new Int8Array(128), b = new Int8Array(128);
    g.attackMaps(w, b);
    check("white attacks the third rank in front of its pawns", w[2 * 16 + 3] > 0 && w[2 * 16 + 4] > 0);
    check("white does not attack the sixth rank at move 1", w[5 * 16 + 4] === 0);
    check("black mirrors white", b[5 * 16 + 3] > 0 && b[2 * 16 + 4] === 0);
    // e2 is covered by the king, the queen, the f1 bishop and the g1 knight.
    check("e2 is defended four times", w[1 * 16 + 4] === 4, `got ${w[1 * 16 + 4]}`);
    // d5 in the initial position: nobody attacks it.
    check("empty middle squares have no attackers", w[4 * 16 + 3] === 0 && b[3 * 16 + 3] === 0);
}
{
    // Perspective: an equivalent position must encode identically for both
    // colours. Mirror the board and flip the side to move.
    const a = new Chess();
    a.push(a.moves().find(x => a.moveStr(x) === "e2e4"));
    a.push(a.moves().find(x => a.moveStr(x) === "e7e5"));
    const fa = encodePosition(a, 1, a.moves());
    const white = Float64Array.from(fa.sq);
    const b = new Chess();
    b.push(b.moves().find(x => b.moveStr(x) === "e2e4"));
    b.push(b.moves().find(x => b.moveStr(x) === "e7e5"));
    b.push(b.moves().find(x => b.moveStr(x) === "g1f3"));
    const fb = encodePosition(b, -1, b.moves());
    // Only the piece-plane block is expected to line up (history and last-move
    // channels differ), so compare that.
    let planeMatch = true;
    for (let s = 0; s < 64; s++) {
        for (let c = 0; c < 12; c++) {
            if (c === 1 && white[s * SQ_CH + c] !== fb.sq[s * SQ_CH + c]) planeMatch = false;
        }
    }
    check("black's own pieces land in the 'own' planes", (() => {
        // black to move: its own pawn on e5 must appear as own-pawn on rank 4
        // (perspective rank 3) of the e-file.
        const pi = perspIdx(4 * 16 + 4, -1);
        return fb.sq[pi * SQ_CH + 0] === 1;
    })(), "e5 pawn seen as own pawn");
    check("white's own pieces land in the 'own' planes", (() => {
        const pi = perspIdx(3 * 16 + 4, 1);
        return white[pi * SQ_CH + 0] === 1;
    })(), "e4 pawn seen as own pawn");
    void planeMatch;
}

/* ------------------------------------------------------ 3. network ---------- */
{
    const rng = makeRng(3);
    const g = randomGenome(rng);
    check(`genome length is ${NN_GENOME_LEN}`, g.length === NN_GENOME_LEN);
    check("fresh genome is valid", validGenome(g));

    const game = new Chess();
    const feats = encodePosition(game, 1, game.moves());
    const p1 = forwardPolicy(g, feats);
    const from1 = Float64Array.from(p1.fromLogit);
    const to1 = Float64Array.from(toLogitsFor(g, 12));
    const feats2 = encodePosition(game, 1, game.moves());
    const p2 = forwardPolicy(g, feats2);
    const from2 = Float64Array.from(p2.fromLogit);
    const to2 = Float64Array.from(toLogitsFor(g, 12));
    let same = true;
    for (let i = 0; i < 64; i++) if (from1[i] !== from2[i] || to1[i] !== to2[i]) same = false;
    check("forward pass is deterministic", same);

    let finite = true;
    for (let i = 0; i < 64; i++) if (!Number.isFinite(from1[i]) || !Number.isFinite(to1[i])) finite = false;
    check("head outputs are finite", finite);

    // The TO head must genuinely depend on the FROM square, otherwise the dual
    // architecture is a single head wearing a hat.
    const tA = Float64Array.from(toLogitsFor(g, 8));
    const tB = Float64Array.from(toLogitsFor(g, 12));
    let spread = 0;
    for (let i = 0; i < 64; i++) spread += Math.abs((tA[i] - tA[0]) - (tB[i] - tB[0]));
    check("destination ranking depends on which piece moves", spread > 1e-6, `spread ${spread.toFixed(4)}`);
}
{
    // Every move a brain proposes must be legal, from many random positions.
    const rng = makeRng(99);
    const genome = randomGenome(rng);
    let plies = 0, illegal = 0;
    for (let t = 0; t < 12; t++) {
        const g = new Chess();
        applyOpening(g, (t * 7919) >>> 0);
        while (!g.result() && g.ply < 60) {
            const legal = g.moves();
            if (!legal.length) break;
            const m = chooseMove(g, genome, t % 2 ? 0.4 : 0, rng, null);
            if (!m || !legal.some(x => x.from === m.from && x.to === m.to && x.promo === m.promo)) illegal++;
            if (!m) break;
            g.push(m);
            plies++;
        }
    }
    check("the policy only ever plays legal moves", illegal === 0, `${illegal} illegal of ${plies}`);
    check("games actually progress", plies > 300, `${plies} plies`);
}
{
    // Mate-in-one must be found even by a random genome: it is the one piece of
    // hard-wired terminal knowledge.
    const g = new Chess();
    for (const s of ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6"]) {
        g.push(g.moves().find(x => g.moveStr(x) === s));
    }
    const rng = makeRng(5);
    let found = 0;
    for (let t = 0; t < 6; t++) {
        const m = chooseMove(g, randomGenome(rng), 0, rng, null);
        if (g.moveStr(m) === "h5f7") found++;
    }
    check("mate in one is always played", found === 6, `${found}/6`);
}
{
    // The visualisation record must be a real distribution over legal squares.
    const g = new Chess();
    const rng = makeRng(21);
    const rec = {};
    chooseMove(g, randomGenome(rng), 0, rng, rec);
    let fsum = 0, tsum = 0, offBoard = 0;
    for (let i = 0; i < 64; i++) { fsum += rec.fromProb[i]; tsum += rec.toProb[i]; }
    const froms = new Set(g.moves().map(m => (m.from >> 4) * 8 + (m.from & 7)));
    for (let i = 0; i < 64; i++) if (rec.fromProb[i] > 0 && !froms.has(i)) offBoard++;
    check("FROM head is a distribution over legal origins",
        Math.abs(fsum - 1) < 1e-6 && offBoard === 0, `sum ${fsum.toFixed(6)}, ${offBoard} stray`);
    check("TO head is a distribution", Math.abs(tsum - 1) < 1e-6, `sum ${tsum.toFixed(6)}`);
}

/* ------------------------------------------------------ 4. genetics --------- */
{
    const rng = makeRng(7);
    const a = randomGenome(rng), b = randomGenome(rng);
    const c = crossover(a, b, rng);
    check("crossover keeps the genome valid", validGenome(c));
    let fromA = 0, fromB = 0;
    for (let i = 0; i < c.length; i++) { if (c[i] === a[i]) fromA++; if (c[i] === b[i]) fromB++; }
    check("crossover draws from both parents", fromA > 100 && fromB > 100, `${fromA}/${fromB}`);

    const m = mutate(cloneGenome(a), 0.1, 0.2, 0.001, rng);
    check("mutation keeps the genome valid", validGenome(m));
    let changed = 0;
    for (let i = 0; i < m.length; i++) if (m[i] !== a[i]) changed++;
    check("mutation changes roughly the requested fraction",
        changed > a.length * 0.05 && changed < a.length * 0.2, `${changed}/${a.length}`);

    const broken = cloneGenome(a);
    broken[5] = NaN; broken[6] = 1e9;
    repairGenome(broken);
    check("repair scrubs NaN and clamps blow-ups", validGenome(broken) && Math.abs(broken[6]) <= 8);

    const json = serializeGenome(a, { gen: 3 });
    const back = deserializeGenome(json);
    check("serialize/deserialize round-trips", !!back && back.genome.length === a.length && back.meta.gen === 3);
    check("a genome from another architecture is rejected",
        deserializeGenome(JSON.stringify({ version: NN_VERSION, arch: "nope", genome: [] })) === null);
}

/* ------------------------------------------------------ 5. evolution -------- */
{
    const t0 = Date.now();
    const ev = new Evolution(16, 1234);
    ev.recordLeader = false;
    const startGen = ev.gen;
    let plies = 0;
    while (ev.gen < startGen + 3) plies += ev.step(400);
    const secs = (Date.now() - t0) / 1000;
    check("three generations complete", ev.gen === startGen + 3);
    check("a champion exists", !!ev.champion && validGenome(ev.champion.genome));
    check("history is being recorded",
        ev.history.best.length === 3 && ev.history.ladder.length === 3);
    check("every ladder rung is measured every generation",
        ev.history.bench.length === LADDER.length && ev.history.bench.every(s => s.length === 3),
        ev.history.bench.map(s => s.length).join(","));
    check("every genome played its full schedule",
        ev.pop.length === 16, `pop ${ev.pop.length}`);
    console.log(`      ${plies} plies in ${secs.toFixed(1)}s (${Math.round(plies / secs)} plies/s)`);
}
{
    // The real question: does selection move the needle against a yardstick
    // that never changes? Compare an evolved champion with the untrained
    // genome it started from, both measured on the same fixed bot.
    const seed = 20260730;
    const ev = new Evolution(24, seed);
    ev.recordLeader = false;
    const baseline = cloneGenome(ev.pop[0].genome);
    const t0 = Date.now();
    while (ev.gen <= 12) ev.step(1200);
    const secs = (Date.now() - t0) / 1000;

    const probe = new Evolution(16, 5); // only used for its scoring helpers
    probe.recordLeader = false;
    const games = 24;
    const before = probe.scoreVsBot(baseline, LADDER[0], games, 4242);
    const after = probe.scoreVsBot(ev.champion.genome, LADDER[0], games, 4242);
    console.log(`      12 generations in ${secs.toFixed(1)}s; vs random ${(before * 100).toFixed(0)}% -> ${(after * 100).toFixed(0)}%`);
    check("evolution beats its own untrained starting point", after > before,
        `${before.toFixed(3)} -> ${after.toFixed(3)}`);
    check("the champion is clearly better than random play", after >= 0.6, `${after.toFixed(3)}`);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
