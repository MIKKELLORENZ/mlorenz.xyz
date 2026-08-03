// Compact 0x88 chess engine. Full legal move generation: castling, en passant,
// all four promotions, check, checkmate, stalemate, 50-move rule, threefold
// repetition, insufficient material.
//
// Beyond plain rules it also provides the three things the neural player needs
// and cannot cheaply recompute itself:
//   * attackMaps()  - per-square attacker counts for both sides
//   * histBoards    - the last HIST_FRAMES complete board states
//   * a legal-move cache so a ply costs one move generation instead of three
'use strict';

const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6; // piece codes; negative = black

// Material values in tenths of a pawn, so equal material cancels to exactly 0.
const MAT_VAL = [0, 10, 31, 33, 50, 90, 0];
// Distinct normalized ids used when a whole board has to fit in one channel
// (the history planes). Every piece type stays separable after the divide.
const PIECE_CODE = [0, 1 / 12, 3 / 12, 4 / 12, 6 / 12, 9 / 12, 1];

// How many complete previous board states every brain remembers.
const HIST_FRAMES = 5;

const KNIGHT_OFF = [31, 33, 14, 18, -31, -33, -14, -18];
const BISHOP_OFF = [15, 17, -15, -17];
const ROOK_OFF = [1, -1, 16, -16];
const KING_OFF = [1, -1, 16, -16, 15, 17, -15, -17];

const CR_WK = 1, CR_WQ = 2, CR_BK = 4, CR_BQ = 8;

function sqName(sq) {
    return String.fromCharCode(97 + (sq & 7)) + (1 + (sq >> 4));
}

// ---------------------------------------------------------------- Zobrist ---
// Position keys for repetition detection. Hashing 64 squares beats building a
// 70-character board string on every ply, and repetition is checked every ply.
const ZOB = (function () {
    let a = 0x9e3779b9;
    const rnd = () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return (t ^ (t >>> 14)) >>> 0;
    };
    const piece = [];
    for (let i = 0; i < 13; i++) {
        const row = new Uint32Array(256);
        for (let s = 0; s < 256; s++) row[s] = rnd();
        piece.push(row);
    }
    const castle = new Uint32Array(32), ep = new Uint32Array(18);
    for (let i = 0; i < 32; i++) castle[i] = rnd();
    for (let i = 0; i < 18; i++) ep[i] = rnd();
    return { piece, castle, ep, turn: rnd(), turn2: rnd() };
})();

class Chess {
    constructor() {
        this.reset();
    }

    reset() {
        this.board = new Int8Array(128);
        const back = [R, N, B, Q, K, B, N, R];
        for (let f = 0; f < 8; f++) {
            this.board[f] = back[f];
            this.board[16 + f] = P;
            this.board[96 + f] = -P;
            this.board[112 + f] = -back[f];
        }
        this.turn = 1; // 1 white, -1 black
        this.castling = CR_WK | CR_WQ | CR_BK | CR_BQ;
        this.ep = -1;
        this.halfmove = 0;
        this.ply = 0;
        this.repCounts = new Map();
        this.repCounts.set(this.hash(), 1);
        this.repNow = 1;      // repetition count of the position on the board
        this.lastMoves = [];  // committed moves, most recent last
        this.histBoards = []; // complete previous board states, most recent last
        this.histMat = [];    // material balance at each of those states
        this._legalCache = null;
        this._result = null;
    }

    clone() {
        const c = Object.create(Chess.prototype);
        c.board = this.board.slice();
        c.turn = this.turn;
        c.castling = this.castling;
        c.ep = this.ep;
        c.halfmove = this.halfmove;
        c.ply = this.ply;
        c.repCounts = new Map(this.repCounts);
        c.repNow = this.repNow;
        c.lastMoves = this.lastMoves.slice(-6);
        c.histBoards = this.histBoards.map(f => f.slice());
        c.histMat = this.histMat.slice();
        c._legalCache = null;
        c._result = this._result;
        return c;
    }

    // 8x8 copy of the current placement, white's point of view, index rank*8+file.
    snapshot() {
        const out = new Int8Array(64);
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) out[r * 8 + f] = this.board[r * 16 + f];
        }
        return out;
    }

    hash() {
        let h1 = 0, h2 = 0;
        const b = this.board;
        for (let sq = 0; sq < 128; sq++) {
            if (sq & 0x88) { sq += 7; continue; }
            const p = b[sq];
            if (p === 0) continue;
            const row = ZOB.piece[p + 6];
            h1 ^= row[sq];
            h2 = (h2 ^ row[sq ^ 0x77]) >>> 0;
        }
        h1 ^= ZOB.castle[this.castling & 15];
        h2 = (h2 ^ ZOB.ep[this.ep < 0 ? 16 : (this.ep & 7)]) >>> 0;
        if (this.turn === 1) { h1 ^= ZOB.turn; h2 = (h2 ^ ZOB.turn2) >>> 0; }
        return ((h1 >>> 0) + ',' + h2);
    }

    repCount() {
        return this.repCounts.get(this.hash()) || 1;
    }

    kingSq(side) {
        const target = K * side;
        for (let sq = 0; sq < 128; sq++) {
            if (sq & 0x88) { sq += 7; continue; }
            if (this.board[sq] === target) return sq;
        }
        return -1;
    }

    isAttacked(sq, bySide) {
        const b = this.board;
        // pawns: a white pawn attacks upward, so it sits below sq
        const pawnDir = bySide === 1 ? -16 : 16;
        for (const df of [pawnDir - 1, pawnDir + 1]) {
            const s = sq + df;
            if (!(s & 0x88) && b[s] === P * bySide) return true;
        }
        for (const o of KNIGHT_OFF) {
            const s = sq + o;
            if (!(s & 0x88) && b[s] === N * bySide) return true;
        }
        for (const o of KING_OFF) {
            const s = sq + o;
            if (!(s & 0x88) && b[s] === K * bySide) return true;
        }
        for (const o of BISHOP_OFF) {
            let s = sq + o;
            while (!(s & 0x88)) {
                const p = b[s];
                if (p !== 0) {
                    if ((p === B * bySide) || (p === Q * bySide)) return true;
                    break;
                }
                s += o;
            }
        }
        for (const o of ROOK_OFF) {
            let s = sq + o;
            while (!(s & 0x88)) {
                const p = b[s];
                if (p !== 0) {
                    if ((p === R * bySide) || (p === Q * bySide)) return true;
                    break;
                }
                s += o;
            }
        }
        return false;
    }

    inCheck(side) {
        side = side || this.turn;
        const ks = this.kingSq(side);
        return ks >= 0 && this.isAttacked(ks, -side);
    }

    // Fill two 0x88-indexed arrays with "how many white / black pieces attack
    // this square". A slider's first blocker counts as attacked (it is either
    // capturable or defended), which is exactly what the brain needs to reason
    // about hanging material without any search.
    attackMaps(outW, outB) {
        outW.fill(0); outB.fill(0);
        const b = this.board;
        for (let sq = 0; sq < 128; sq++) {
            if (sq & 0x88) { sq += 7; continue; }
            const p = b[sq];
            if (p === 0) continue;
            const side = p > 0 ? 1 : -1;
            const out = side === 1 ? outW : outB;
            const ap = p > 0 ? p : -p;
            if (ap === P) {
                const dir = 16 * side;
                for (const d of [dir - 1, dir + 1]) {
                    const t = sq + d;
                    if (!(t & 0x88)) out[t]++;
                }
            } else if (ap === N || ap === K) {
                for (const o of (ap === N ? KNIGHT_OFF : KING_OFF)) {
                    const t = sq + o;
                    if (!(t & 0x88)) out[t]++;
                }
            } else {
                const offs = ap === B ? BISHOP_OFF : ap === R ? ROOK_OFF : KING_OFF;
                for (const o of offs) {
                    let t = sq + o;
                    while (!(t & 0x88)) {
                        out[t]++;
                        if (b[t] !== 0) break;
                        t += o;
                    }
                }
            }
        }
    }

    // Pseudo-legal moves for side to move.
    _pseudoMoves() {
        const b = this.board, side = this.turn, moves = [];
        const add = (from, to, flags, promo) => {
            moves.push({ from, to, piece: b[from], capture: b[to], flags: flags | 0, promo: promo | 0 });
        };
        const addPromos = (from, to) => {
            add(from, to, 0, Q * side); add(from, to, 0, R * side);
            add(from, to, 0, B * side); add(from, to, 0, N * side);
        };
        for (let sq = 0; sq < 128; sq++) {
            if (sq & 0x88) { sq += 7; continue; }
            const p = b[sq];
            if (p === 0 || Math.sign(p) !== side) continue;
            const ap = Math.abs(p);
            if (ap === P) {
                const dir = 16 * side;
                const one = sq + dir;
                const promoRank = side === 1 ? 7 : 0;
                if (!(one & 0x88) && b[one] === 0) {
                    if ((one >> 4) === promoRank) addPromos(sq, one);
                    else {
                        add(sq, one, 0);
                        const startRank = side === 1 ? 1 : 6;
                        const two = sq + 2 * dir;
                        if ((sq >> 4) === startRank && b[two] === 0) add(sq, two, 2); // double push
                    }
                }
                for (const dc of [dir - 1, dir + 1]) {
                    const t = sq + dc;
                    if (t & 0x88) continue;
                    if (b[t] !== 0 && Math.sign(b[t]) === -side) {
                        if ((t >> 4) === promoRank) addPromos(sq, t);
                        else add(sq, t, 0);
                    } else if (t === this.ep && b[t] === 0) {
                        add(sq, t, 4); // en passant
                    }
                }
            } else if (ap === N || ap === K) {
                for (const o of (ap === N ? KNIGHT_OFF : KING_OFF)) {
                    const t = sq + o;
                    if (t & 0x88) continue;
                    if (b[t] === 0 || Math.sign(b[t]) === -side) add(sq, t, 0);
                }
                if (ap === K) {
                    const home = side === 1 ? 4 : 116;
                    if (sq === home && !this.inCheck(side)) {
                        const ksFlag = side === 1 ? CR_WK : CR_BK;
                        const qsFlag = side === 1 ? CR_WQ : CR_BQ;
                        if ((this.castling & ksFlag) && b[home + 1] === 0 && b[home + 2] === 0 &&
                            !this.isAttacked(home + 1, -side) && !this.isAttacked(home + 2, -side) &&
                            b[home + 3] === R * side) add(sq, home + 2, 8);
                        if ((this.castling & qsFlag) && b[home - 1] === 0 && b[home - 2] === 0 && b[home - 3] === 0 &&
                            !this.isAttacked(home - 1, -side) && !this.isAttacked(home - 2, -side) &&
                            b[home - 4] === R * side) add(sq, home - 2, 16);
                    }
                }
            } else {
                const offs = ap === B ? BISHOP_OFF : ap === R ? ROOK_OFF : KING_OFF; // Q uses all 8
                for (const o of offs) {
                    let t = sq + o;
                    while (!(t & 0x88)) {
                        if (b[t] === 0) add(sq, t, 0);
                        else { if (Math.sign(b[t]) === -side) add(sq, t, 0); break; }
                        t += o;
                    }
                }
            }
        }
        return moves;
    }

    // Apply a move without touching repetition tracking. Returns undo record.
    _make(m) {
        this._legalCache = null;
        const b = this.board;
        const undo = {
            castling: this.castling, ep: this.ep, halfmove: this.halfmove,
            captured: b[m.to], epCaptured: 0
        };
        b[m.to] = m.promo !== 0 ? m.promo : b[m.from];
        b[m.from] = 0;
        if (m.flags & 4) { // en passant capture
            const capSq = m.to - 16 * this.turn;
            undo.epCaptured = b[capSq];
            b[capSq] = 0;
        }
        if (m.flags & 8) { b[m.to + 1] = 0; b[m.to - 1] = R * this.turn; }   // O-O
        if (m.flags & 16) { b[m.to - 2] = 0; b[m.to + 1] = R * this.turn; }  // O-O-O
        // castling rights
        let cr = this.castling;
        if (m.piece === K) cr &= ~(CR_WK | CR_WQ);
        if (m.piece === -K) cr &= ~(CR_BK | CR_BQ);
        for (const sq of [m.from, m.to]) {
            if (sq === 0) cr &= ~CR_WQ;
            if (sq === 7) cr &= ~CR_WK;
            if (sq === 112) cr &= ~CR_BQ;
            if (sq === 119) cr &= ~CR_BK;
        }
        this.castling = cr;
        this.ep = (m.flags & 2) ? m.from + 16 * this.turn : -1;
        this.halfmove = (Math.abs(m.piece) === P || undo.captured !== 0) ? 0 : this.halfmove + 1;
        this.turn = -this.turn;
        return undo;
    }

    _unmake(m, undo) {
        this._legalCache = null;
        this.turn = -this.turn;
        const b = this.board;
        b[m.from] = m.promo !== 0 ? P * this.turn : b[m.to];
        b[m.to] = undo.captured;
        if (m.flags & 4) b[m.to - 16 * this.turn] = undo.epCaptured;
        if (m.flags & 8) { b[m.to + 1] = R * this.turn; b[m.to - 1] = 0; }
        if (m.flags & 16) { b[m.to - 2] = R * this.turn; b[m.to + 1] = 0; }
        this.castling = undo.castling;
        this.ep = undo.ep;
        this.halfmove = undo.halfmove;
    }

    // Legal moves, cached. push() already has to generate them for terminal
    // detection, so the player that follows gets the list for free.
    moves() {
        if (this._legalCache) return this._legalCache;
        const side = this.turn;
        const out = [];
        for (const m of this._pseudoMoves()) {
            const undo = this._make(m);
            if (!this.inCheck(side)) out.push(m);
            this._unmake(m, undo);
        }
        this._legalCache = out;
        return out;
    }

    // Commit a move to the game (updates history, repetition map, result).
    push(m) {
        this.histBoards.push(this.snapshot());
        this.histMat.push(this.material());
        if (this.histBoards.length > HIST_FRAMES) { this.histBoards.shift(); this.histMat.shift(); }

        this._make(m);
        this.ply++;
        this.lastMoves.push(m);
        if (this.lastMoves.length > 6) this.lastMoves.shift();

        const k = this.hash();
        const n = (this.repCounts.get(k) || 0) + 1;
        this.repCounts.set(k, n);
        this.repNow = n;

        // Checkmate and stalemate outrank every drawing rule.
        if (this.moves().length === 0) {
            this._result = this.inCheck(this.turn)
                ? { winner: -this.turn, reason: 'checkmate' }
                : { winner: 0, reason: 'stalemate' };
            return;
        }
        if (n >= 3) { this._result = { winner: 0, reason: 'repetition' }; return; }
        if (this.halfmove >= 100) { this._result = { winner: 0, reason: '50-move' }; return; }
        if (this._insufficientMaterial()) { this._result = { winner: 0, reason: 'material' }; return; }
    }

    result() { return this._result; }

    _insufficientMaterial() {
        let minor = 0;
        for (let sq = 0; sq < 128; sq++) {
            if (sq & 0x88) { sq += 7; continue; }
            const ap = Math.abs(this.board[sq]);
            if (ap === 0 || ap === K) continue;
            if (ap === P || ap === R || ap === Q) return false;
            if (++minor > 1) return false; // two+ minors: keep playing
        }
        return true;
    }

    // Material sum from white's perspective, in pawn units.
    material() {
        let m = 0;
        for (let sq = 0; sq < 128; sq++) {
            if (sq & 0x88) { sq += 7; continue; }
            const p = this.board[sq];
            if (p !== 0) m += Math.sign(p) * MAT_VAL[Math.abs(p)];
        }
        return m / 10;
    }

    moveStr(m) {
        const letters = { 2: 'n', 3: 'b', 4: 'r', 5: 'q' };
        return sqName(m.from) + sqName(m.to) + (m.promo ? letters[Math.abs(m.promo)] : '');
    }

    // Perft, for the test harness. Counts leaf nodes at the given depth.
    perft(depth) {
        if (depth === 0) return 1;
        const ms = this._pseudoMoves();
        const side = this.turn;
        let n = 0;
        for (const m of ms) {
            const undo = this._make(m);
            if (!this.inCheck(side)) n += depth === 1 ? 1 : this.perft(depth - 1);
            this._unmake(m, undo);
        }
        return n;
    }
}

if (typeof module !== 'undefined') {
    module.exports = { Chess, sqName, P, N, B, R, Q, K, MAT_VAL, PIECE_CODE, HIST_FRAMES };
}
