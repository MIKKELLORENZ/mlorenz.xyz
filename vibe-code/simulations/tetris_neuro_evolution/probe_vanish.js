/* probe_vanish.js — "a piece spawned and then just disappeared."
 *
 * Watching the champion play, a piece sometimes vanishes and a new one takes its
 * place with nothing landing on the stack. There are only a few ways that can
 * happen, and one of them would be an outright cheat, so this counts all of them
 * on real champion games instead of reasoning about the code:
 *
 *   1. hold swap        legitimate: the piece goes into the hold box and the next
 *                       one spawns. Looks exactly like a vanishing piece.
 *   2. cells above the grid  _lock() only writes cells with y >= 0, so a piece
 *                       resting partly above row 0 silently loses those cells —
 *                       fewer blocks on the board than were in the piece. That is
 *                       a cheat: mass disappears.
 *   3. lock-out         every cell lands in the two hidden rows: game over. The
 *                       piece is invisible, so it reads as "vanished" too.
 *   4. anything else    a piece changing identity with no lock and no hold, which
 *                       would be a genuine bug.
 *
 *   node probe_vanish.js [games]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "tetris.js", "sensors.js", "world.js", "configs.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}
const BASE_R = Object.assign({}, R);

// the shipped champion, under its own sensor profile and architecture
const raw = fs.readFileSync(path.join(__dirname, "default_brain.js"), "utf8");
const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
applyConfig(json.config, BASE_R);
const champ = netFromJSON(json);
console.log(`champion: ${json.configName} · ${champ.contract()} · gen ${json.gen}`);

const GAMES = +(process.argv[2] || 40);
const stats = {
    pieces: 0, holds: 0, holdsEmpty: 0, lockOut: 0,
    locksWithCellsAbove: 0, cellsDeleted: 0, deletedByPiece: new Array(7).fill(0),
    unexplained: 0, games: 0, topOutRow: [],
};

for (let g = 0; g < GAMES; g++) {
    const ag = new Agent(champ, 900001 + g * 7919, DEFAULT_CFG);
    const game = ag.game;

    // instrument the engine itself: count what each lock actually writes
    const realLock = game._lock.bind(game);
    game._lock = function () {
        const p = this.piece, cells = PIECES[p.type].flat[p.rot];
        let above = 0;
        for (let i = 0; i < 8; i += 2) if (p.y + cells[i + 1] < 0) above++;
        if (above) {
            stats.locksWithCellsAbove++;
            stats.cellsDeleted += above;
            stats.deletedByPiece[p.type] += above;
        }
        const before = this.over;
        const res = realLock();
        if (!before && this.over) { stats.lockOut++; stats.topOutRow.push(p.y); }
        return res;
    };
    const realHold = game._holdSwap.bind(game);
    game._holdSwap = function () {
        const wasEmpty = this.hold < 0;
        const ok = realHold();
        if (ok) { stats.holds++; if (wasEmpty) stats.holdsEmpty++; }
        return ok;
    };

    // and watch from outside: a piece must only ever be replaced by a lock or a hold
    let prev = { type: game.piece.type, id: 0 };
    let locks = 0, holdsSeen = stats.holds;
    while (ag.alive) {
        const pieceBefore = game.piece;
        const ev = ag.step(400);
        if (ev && ev.locked) locks++;
        if (game.piece !== pieceBefore) {
            const explained = (ev && ev.locked) || stats.holds > holdsSeen;
            if (!explained) stats.unexplained++;
            holdsSeen = stats.holds;
        }
    }
    stats.pieces += ag.pieces;
    stats.games++;
}

const per = n => (n / stats.games).toFixed(2);
console.log(`\n${stats.games} games, ${stats.pieces} pieces placed (${per(stats.pieces)}/game)\n`);
console.log(`1. hold swaps                 ${String(stats.holds).padStart(5)}  (${per(stats.holds)}/game, ` +
    `${stats.holdsEmpty} of them into an empty hold box)`);
console.log(`2. locks with cells above row 0 ${String(stats.locksWithCellsAbove).padStart(3)}  ` +
    `→ ${stats.cellsDeleted} cells silently deleted (${per(stats.cellsDeleted)}/game)`);
console.log(`3. lock-outs (all cells hidden) ${String(stats.lockOut).padStart(3)}  ` +
    `(the game ends here)`);
console.log(`4. unexplained piece changes    ${String(stats.unexplained).padStart(3)}`);
if (stats.cellsDeleted) {
    console.log(`\n   deleted cells by piece type: ` + stats.deletedByPiece
        .map((n, i) => n ? `${PIECE_NAMES[i]}=${n}` : null).filter(Boolean).join(" "));
}
