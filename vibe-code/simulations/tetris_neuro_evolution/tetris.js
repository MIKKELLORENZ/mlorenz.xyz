/* tetris.js — a normal, complete Tetris engine.
 *
 * Deliberately ordinary: SRS rotation with the full kick tables, a 7-bag
 * randomiser, hold, lock delay with move-reset, ghost piece, guideline scoring.
 * Nothing in here knows that a neural network exists.
 *
 * The ONLY way to control it is onKeyDown(code) / onKeyUp(code) — the same two
 * methods a browser keydown/keyup listener calls. DAS, ARR, auto-repeat and
 * press-edge detection all live inside the engine, so a human and a brain are
 * playing exactly the same game through exactly the same wire.
 */
"use strict";

const BW = 10;              // board width
const BH = 20;              // visible height
const BUF = 2;              // hidden spawn rows above the visible field
const TH = BH + BUF;        // total grid rows (0..1 hidden, 2..21 visible)

const PIECE_NAMES = ["I", "J", "L", "O", "S", "T", "Z"];
const PIECE_COLORS = ["#3ad2f0", "#4a7dff", "#ff9d3d", "#ffd447", "#57e08a", "#c07bff", "#ff5f6b"];

/* Cells per rotation state, as [x, y] offsets inside the piece's bounding box.
 * y grows downward. These are the standard SRS orientations. */
const PIECES = [
    {   // I — 4×4 box
        box: 4, spawnX: 3, kicks: "I",
        cells: [
            [[0, 1], [1, 1], [2, 1], [3, 1]],
            [[2, 0], [2, 1], [2, 2], [2, 3]],
            [[0, 2], [1, 2], [2, 2], [3, 2]],
            [[1, 0], [1, 1], [1, 2], [1, 3]],
        ]
    },
    {   // J
        box: 3, spawnX: 3, kicks: "JLSTZ",
        cells: [
            [[0, 0], [0, 1], [1, 1], [2, 1]],
            [[1, 0], [2, 0], [1, 1], [1, 2]],
            [[0, 1], [1, 1], [2, 1], [2, 2]],
            [[1, 0], [1, 1], [0, 2], [1, 2]],
        ]
    },
    {   // L
        box: 3, spawnX: 3, kicks: "JLSTZ",
        cells: [
            [[2, 0], [0, 1], [1, 1], [2, 1]],
            [[1, 0], [1, 1], [1, 2], [2, 2]],
            [[0, 1], [1, 1], [2, 1], [0, 2]],
            [[0, 0], [1, 0], [1, 1], [1, 2]],
        ]
    },
    {   // O — never rotates, never kicks
        box: 2, spawnX: 4, kicks: "none",
        cells: [
            [[0, 0], [1, 0], [0, 1], [1, 1]],
            [[0, 0], [1, 0], [0, 1], [1, 1]],
            [[0, 0], [1, 0], [0, 1], [1, 1]],
            [[0, 0], [1, 0], [0, 1], [1, 1]],
        ]
    },
    {   // S
        box: 3, spawnX: 3, kicks: "JLSTZ",
        cells: [
            [[1, 0], [2, 0], [0, 1], [1, 1]],
            [[1, 0], [1, 1], [2, 1], [2, 2]],
            [[1, 1], [2, 1], [0, 2], [1, 2]],
            [[0, 0], [0, 1], [1, 1], [1, 2]],
        ]
    },
    {   // T
        box: 3, spawnX: 3, kicks: "JLSTZ",
        cells: [
            [[1, 0], [0, 1], [1, 1], [2, 1]],
            [[1, 0], [1, 1], [2, 1], [1, 2]],
            [[0, 1], [1, 1], [2, 1], [1, 2]],
            [[1, 0], [0, 1], [1, 1], [1, 2]],
        ]
    },
    {   // Z
        box: 3, spawnX: 3, kicks: "JLSTZ",
        cells: [
            [[0, 0], [1, 0], [1, 1], [2, 1]],
            [[2, 0], [1, 1], [2, 1], [1, 2]],
            [[0, 1], [1, 1], [1, 2], [2, 2]],
            [[1, 0], [0, 1], [1, 1], [0, 2]],
        ]
    },
];

/* Flattened cell tables: [x0,y0,x1,y1,x2,y2,x3,y3] per rotation. The collision
 * test runs tens of millions of times per generation, and walking nested JS
 * arrays there costs more than everything else in the engine combined. */
for (const p of PIECES) {
    p.flat = p.cells.map(c => Int8Array.from([
        c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1],
    ]));
}

/* SRS wall kicks, already converted to this file's y-down coordinates
 * (the published tables are y-up, so every y here is negated). */
const KICKS_JLSTZ = {
    "01": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "10": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "12": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "21": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "23": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "32": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "30": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "03": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};
const KICKS_I = {
    "01": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    "10": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    "12": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    "21": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    "23": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    "32": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    "30": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    "03": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

/* Key codes — real DOM KeyboardEvent.code values. The emulator "presses" these. */
const KEY_LEFT = "ArrowLeft";
const KEY_RIGHT = "ArrowRight";
const KEY_CW = "ArrowUp";
const KEY_CCW = "KeyZ";
const KEY_SOFT = "ArrowDown";
const KEY_HARD = "Space";
const KEY_HOLD = "KeyC";
/* Output order of the network. One sigmoid per key, in this order. */
const KEY_ORDER = [KEY_LEFT, KEY_RIGHT, KEY_CW, KEY_CCW, KEY_SOFT, KEY_HARD, KEY_HOLD];
const KEY_LABELS = ["◀", "▶", "↻", "↺", "▼", "⎵", "H"];
const KEY_NAMES = ["left", "right", "rot cw", "rot ccw", "soft", "hard drop", "hold"];

/* Engine ticks are a unit of game time, not of wall time: training runs them as
 * fast as the CPU allows and the viewer runs them at a watchable rate, but the
 * game a brain sees is identical either way. Every timing below is in ticks. */
/* ---- the timing contract, and why every number here is what it is ----
 *
 * A human playing Tetris can slide a piece most of the way across the board
 * within a row or two of fall, and keeps steering after it lands during the lock
 * delay. If the agent cannot do the same, the policy "put it in that column" is
 * not expressible and no amount of evolution will find it — the search will
 * instead find some degenerate shortcut. That is not hypothetical: an earlier
 * version ran soft drop at 6×, which gave the brain about one decision per row
 * of fall, and evolution simply pinned soft drop on permanently and stacked
 * pieces wherever they happened to spawn.
 *
 * So the numbers below are chosen against three invariants, all asserted in
 * test_headless.js so they cannot quietly regress:
 *
 *   1. gravity ≥ ACT_EVERY × 4     — at normal fall speed the brain gets at
 *      least 4 decisions per row, and never fewer than 2 even with soft drop
 *      pinned on. The piece can never out-fall the brain's reaction time.
 *   2. crossing the full board width costs less than ~3 rows of normal fall,
 *      so "move it to the far side" is a move that actually exists.
 *   3. arr ≥ ACT_EVERY             — auto-repeat never moves more than one
 *      column per decision, so the brain can stop on the column it wants
 *      instead of permanently overshooting by one.
 *
 * This is also the single source of truth for the game a brain is evolved
 * against: the page, the offline trainer, the bake-time validator and the tests
 * all use it unchanged. If any of them re-specified even one of these numbers a
 * brain would be scored on a game it had not trained on. */
const DEFAULT_CFG = {
    gravity: 8,             // ticks per row of free fall (4 decisions per row)
    softFactor: 2,          // soft drop is 2× — still 2 decisions per row
    das: 2,                 // ticks a direction is held before auto-repeat starts
    arr: 2,                 // ticks between auto-repeat steps — one column per decision
    lockDelay: 18,          // ticks resting on the stack before the piece locks
    maxResets: 15,          // move/rotate resets of the lock timer per piece
    maxTicksPerPiece: 170,  // hard ceiling — the piece is slammed down after this
};

class Tetris {
    constructor(opts) {
        opts = opts || {};
        this.cfg = Object.assign({}, DEFAULT_CFG, opts.cfg || {});
        this.rng = mulberry32((opts.seed | 0) || 1);
        this.grid = new Uint8Array(TH * BW);
        this.bag = [];
        this.queue = [];
        for (let i = 0; i < 3; i++) this.queue.push(this._nextFromBag());

        this.hold = -1;
        this.canHold = true;
        this.over = false;
        this.score = 0;
        this.lines = 0;
        this.pieces = 0;
        this.tick = 0;

        // keyboard state — all input arrives through onKeyDown / onKeyUp
        this.down = Object.create(null);      // code -> true while physically held
        this.edge = Object.create(null);      // code -> true for the tick it went down
        this.heldFor = Object.create(null);   // code -> ticks held (for DAS/ARR)

        this.piece = null;
        this._spawn();
    }

    /* ------------------------------------------------------------ keyboard */
    onKeyDown(code) {
        if (this.down[code]) return;          // real keyboards repeat; the engine ignores it
        this.down[code] = true;
        this.edge[code] = true;
        this.heldFor[code] = 0;
    }
    onKeyUp(code) {
        this.down[code] = false;
        this.edge[code] = false;
        this.heldFor[code] = 0;
    }
    keyState() { return KEY_ORDER.map(c => (this.down[c] ? 1 : 0)); }

    /* ------------------------------------------------------------- pieces */
    _nextFromBag() {
        if (this.bag.length === 0) {
            this.bag = [0, 1, 2, 3, 4, 5, 6];
            for (let i = this.bag.length - 1; i > 0; i--) {   // seeded Fisher-Yates
                const j = (this.rng() * (i + 1)) | 0;
                const t = this.bag[i]; this.bag[i] = this.bag[j]; this.bag[j] = t;
            }
        }
        return this.bag.pop();
    }

    _spawn(type) {
        if (type === undefined) {
            type = this.queue.shift();
            this.queue.push(this._nextFromBag());
        }
        const def = PIECES[type];
        this.piece = { type, rot: 0, x: def.spawnX, y: 0 };
        this.lockTimer = 0;
        this.resets = 0;
        this.pieceTicks = 0;
        this.fallAccum = 0;
        if (this._collides(this.piece.x, this.piece.y, this.piece.rot, type)) this.over = true;
    }

    cellsOf(type, rot) { return PIECES[type].cells[rot]; }

    /* The grid is the whole world: a cell above row 0 is out of bounds exactly
     * like one below the floor.
     *
     * This used to allow y < 0, because SRS kick tables contain y offsets of −2
     * and the two buffer rows are not enough room for them. The consequence was
     * that `_lock()` — which can only write cells inside the grid — silently
     * *deleted* any cell sitting above row 0. Mass disappeared from the game: an
     * I piece kicked into the ceiling locked as three blocks instead of four.
     * Measured on champion play it was rare (0.1 cells per game), but it is a
     * cheat available to evolution, and the whole point of the reward design is
     * that no exploit is left lying around. A kick that would push the piece
     * through the ceiling now simply fails, the same as one into a wall. */
    _collides(px, py, rot, type) {
        const f = PIECES[type].flat[rot], g = this.grid;
        for (let i = 0; i < 8; i += 2) {
            const x = px + f[i], y = py + f[i + 1];
            if (x < 0 || x >= BW || y < 0 || y >= TH) return true;
            if (g[y * BW + x]) return true;
        }
        return false;
    }

    /* Lowest y the current piece can reach straight down from (x, y). */
    dropY(px, py, rot, type) {
        let y = py;
        while (!this._collides(px, y + 1, rot, type)) y++;
        return y;
    }
    ghostY() { const p = this.piece; return this.dropY(p.x, p.y, p.rot, p.type); }

    _move(dx, dy) {
        const p = this.piece;
        if (this._collides(p.x + dx, p.y + dy, p.rot, p.type)) return false;
        p.x += dx; p.y += dy;
        this._resetLock();
        return true;
    }

    _rotate(dir) {
        const p = this.piece, def = PIECES[p.type];
        if (def.kicks === "none") return false;
        const to = (p.rot + (dir > 0 ? 1 : 3)) % 4;
        const table = def.kicks === "I" ? KICKS_I : KICKS_JLSTZ;
        const kicks = table["" + p.rot + to];
        for (let k = 0; k < kicks.length; k++) {
            const nx = p.x + kicks[k][0], ny = p.y + kicks[k][1];
            if (!this._collides(nx, ny, to, p.type)) {
                p.x = nx; p.y = ny; p.rot = to;
                this._resetLock();
                return true;
            }
        }
        return false;
    }

    _resetLock() {
        if (this.lockTimer > 0 && this.resets < this.cfg.maxResets) {
            this.lockTimer = 0; this.resets++;
        }
    }

    /* Hold swaps the piece in hand for the one in the box. The tick budget is
     * *not* refreshed by that.
     *
     * `maxTicksPerPiece` exists to stop a brain dithering forever, and it counts
     * `pieceTicks`, which `_spawn()` resets. So a hold used to hand out a whole
     * fresh budget for the same placement, and evolution found it: the champion
     * pressed hold on 32 of every 40 pieces, buying 124 ticks per piece where 94
     * sufficed. Unplugging the key scored *better* than pressing it (skill 83.7
     * against 73.0) — a habit that survived selection because it bought time,
     * while the time it bought was making it play worse. The budget is per
     * placement, so it carries across the swap. */
    _holdSwap() {
        if (!this.canHold) return false;
        const cur = this.piece.type;
        const spent = this.pieceTicks;
        if (this.hold < 0) { this.hold = cur; this._spawn(); }
        else { const h = this.hold; this.hold = cur; this._spawn(h); }
        this.pieceTicks = spent;
        this.canHold = false;
        return true;
    }

    /* Freeze the piece into the grid, clear lines, spawn the next one. */
    _lock() {
        const p = this.piece, cells = PIECES[p.type].flat[p.rot];
        let top = TH, allHidden = true;
        for (let i = 0; i < 8; i += 2) {
            const x = p.x + cells[i], y = p.y + cells[i + 1];
            if (y >= 0) { this.grid[y * BW + x] = p.type + 1; if (y >= BUF) allHidden = false; }
            if (y < top) top = y;
        }
        this.pieces++;
        const fillPre = rowFill(this.grid);       // measured before the rows vanish
        const cleared = this._clearLines();
        this.lines += cleared;
        this.score += [0, 100, 300, 500, 800][cleared];
        if (allHidden) this.over = true;                 // lock out above the field
        const landingRow = top;
        if (!this.over) { this.canHold = true; this._spawn(); }
        return { locked: true, lines: cleared, landingRow, fillPre };
    }

    _clearLines() {
        let write = TH - 1, cleared = 0;
        for (let y = TH - 1; y >= 0; y--) {
            let full = true;
            for (let x = 0; x < BW; x++) if (!this.grid[y * BW + x]) { full = false; break; }
            if (full) { cleared++; continue; }
            if (write !== y) this.grid.copyWithin(write * BW, y * BW, y * BW + BW);
            write--;
        }
        for (let y = write; y >= 0; y--) this.grid.fill(0, y * BW, y * BW + BW);
        return cleared;
    }

    /* ---------------------------------------------------------------- tick */
    /* One engine frame. Reads only the keyboard state set by onKeyDown/Up. */
    step() {
        if (this.over) return { locked: false, lines: 0, over: true };
        const c = this.cfg;
        this.tick++;
        this.pieceTicks++;

        // --- horizontal: press-edge steps once, then DAS -> ARR auto-repeat
        const l = !!this.down[KEY_LEFT], r = !!this.down[KEY_RIGHT];
        if (l !== r) {                                    // both held cancels out
            const code = l ? KEY_LEFT : KEY_RIGHT, dx = l ? -1 : 1;
            const held = this.heldFor[code] | 0;
            if (this.edge[code]) this._move(dx, 0);
            else if (held >= c.das && (held - c.das) % Math.max(1, c.arr) === 0) this._move(dx, 0);
        }

        // --- rotation and one-shot keys fire only on the press edge
        if (this.edge[KEY_CW]) this._rotate(1);
        if (this.edge[KEY_CCW]) this._rotate(-1);
        if (this.edge[KEY_HOLD]) this._holdSwap();

        let ev = { locked: false, lines: 0, over: false, hard: 0 };

        if (this.edge[KEY_HARD] && !this.over) {
            const p = this.piece;
            const gy = this.dropY(p.x, p.y, p.rot, p.type);
            ev.hard = gy - p.y;
            this.score += 2 * ev.hard;
            p.y = gy;
            const res = this._lock();
            ev.locked = true; ev.lines = res.lines;
            ev.landingRow = res.landingRow; ev.fillPre = res.fillPre;
        } else {
            // --- gravity, accelerated while soft drop is held
            const rate = this.down[KEY_SOFT] ? Math.max(1, (c.gravity / c.softFactor) | 0) : c.gravity;
            this.fallAccum = (this.fallAccum || 0) + 1;
            if (this.fallAccum >= rate) {
                this.fallAccum = 0;
                if (this._collides(this.piece.x, this.piece.y + 1, this.piece.rot, this.piece.type)) {
                    this.lockTimer++;                     // resting on the stack
                } else {
                    this.piece.y++;
                    if (this.down[KEY_SOFT]) this.score += 1;
                    this.lockTimer = 0;
                }
            } else if (this._collides(this.piece.x, this.piece.y + 1, this.piece.rot, this.piece.type)) {
                this.lockTimer++;
            }

            const stalled = this.pieceTicks >= c.maxTicksPerPiece;
            if (this.lockTimer >= c.lockDelay || stalled) {
                if (stalled) {                            // dithering forever counts as a slam
                    const p = this.piece;
                    p.y = this.dropY(p.x, p.y, p.rot, p.type);
                }
                const res = this._lock();
                ev.locked = true; ev.lines = res.lines;
                ev.landingRow = res.landingRow; ev.fillPre = res.fillPre;
            }
        }

        // --- age the held keys and consume the press edges
        for (let i = 0; i < KEY_ORDER.length; i++) {
            const code = KEY_ORDER[i];
            if (this.down[code]) this.heldFor[code] = (this.heldFor[code] | 0) + 1;
            this.edge[code] = false;
        }
        ev.over = this.over;
        return ev;
    }
}

/* ------------------------------------------------------------- board stats */
/* How close the board is to having complete rows, as Σ (cells in row / 10)⁴.
 * The fourth power means a row at 9/10 is worth far more than two rows at 5/10,
 * so "nearly finished a line" is a measurably better board than "spread four
 * cells around". Clearing a line is a rare event a random brain never stumbles
 * into; this is the continuous trail of breadcrumbs leading to it. */
function rowFill(grid) {
    let sum = 0;
    for (let y = 0; y < TH; y++) {
        let n = 0;
        for (let x = 0; x < BW; x++) if (grid[y * BW + x]) n++;
        const f = n / BW;
        sum += f * f * f * f;
    }
    return sum;
}

/* Column heights, holes and bumpiness — the numbers both the sensors and the
 * reward function are built from. Reused buffers, this runs millions of times. */
function boardMetrics(grid, out) {
    out = out || { heights: new Int32Array(BW), holes: new Int32Array(BW) };
    const h = out.heights, ho = out.holes;
    let totalHoles = 0, agg = 0, bumpy = 0, maxH = 0, minH = TH, topRow = TH, wells = 0;
    for (let x = 0; x < BW; x++) {
        let y = 0;
        while (y < TH && !grid[y * BW + x]) y++;
        const height = TH - y;
        h[x] = height;
        let holes = 0;
        for (let yy = y + 1; yy < TH; yy++) if (!grid[yy * BW + x]) holes++;
        ho[x] = holes;
        totalHoles += holes; agg += height;
        if (height > maxH) maxH = height;
        if (height < minH) minH = height;
        if (y < topRow) topRow = y;
    }
    for (let x = 0; x < BW - 1; x++) bumpy += Math.abs(h[x] - h[x + 1]);
    for (let x = 0; x < BW; x++) {   // deep wells: a column much lower than both sides
        const left = x === 0 ? TH : h[x - 1], right = x === BW - 1 ? TH : h[x + 1];
        const d = Math.min(left, right) - h[x];
        if (d >= 3) wells += d - 2;
    }
    out.totalHoles = totalHoles; out.agg = agg; out.bumpy = bumpy;
    out.maxH = maxH; out.minH = minH; out.topRow = topRow; out.wells = wells;
    return out;
}

if (typeof module !== "undefined") {
    module.exports = {
        Tetris, boardMetrics, rowFill, PIECES, PIECE_NAMES, PIECE_COLORS, DEFAULT_CFG,
        BW, BH, BUF, TH, KEY_ORDER, KEY_LABELS, KEY_NAMES,
        KEY_LEFT, KEY_RIGHT, KEY_CW, KEY_CCW, KEY_SOFT, KEY_HARD, KEY_HOLD,
    };
}
