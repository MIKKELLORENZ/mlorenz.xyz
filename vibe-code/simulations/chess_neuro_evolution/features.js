// Observation encoding.
//
// A brain never sees raw bytes. Every position is turned into
//   * a per-square tensor: 64 squares x SQ_CH channels, and
//   * GLOB_IN whole-position scalars,
// both always written from the side-to-move's point of view with its own home
// rank at the bottom, so white and black perceive an identical position
// identically and one genome serves both colors.
//
// Two things in here matter more than anything else for playing strength:
//
//   1. History. Channels 15..19 of every square hold what stood on that square
//      HIST_FRAMES plies back - one complete board state per channel. Together
//      they are the last five whole positions, not a summary of them, so a
//      brain can see what just moved, what is being repeated, and which side
//      has been making progress.
//
//   2. Attack maps. Channels 12/13 say how many enemy and friendly pieces hit
//      each square. A player with no search cannot discover that a square is
//      poisoned by trying it, so the poison has to be visible in the input.
//      This single pair of channels is what lets an evolved policy stop
//      donating pieces.
'use strict';

const SQ_CH = 30;      // channels per square
const GLOB_IN = 36;    // whole-position scalars
const FEAT_SQ_LEN = 64 * SQ_CH;
const MAX_PLIES = 140; // adjudication horizon, also the "game progress" scale

// Channel map, per square (indices into the 30-wide block).
const CH_OWN = 0;      // 0..5   own piece type one-hot (P,N,B,R,Q,K)
const CH_OPP = 6;      // 6..11  opponent piece type one-hot
const CH_ATK_OPP = 12; // enemy attackers on this square
const CH_DEF_OWN = 13; // friendly defenders of this square
const CH_EMPTY = 14;
const CH_HIST = 15;    // 15..19 board state 1..5 plies ago (signed piece code)
const CH_OWN_FROM = 20;
const CH_OWN_TO = 21;
const CH_OPP_FROM = 22;
const CH_OPP_TO = 23;
const CH_RANK = 24;
const CH_CENTER = 25;
const CH_CAN_MOVE = 26; // a legal move starts here
const CH_N_FROM = 27;   // how many legal moves start here
const CH_N_TO = 28;     // how many legal moves land here
const CH_HANGING = 29;  // own piece, attacked, undefended

// Scratch buffers - the encoder is called once per ply in a hot loop and must
// not allocate.
const _atkW = new Int8Array(128);
const _atkB = new Int8Array(128);
const _sqFeat = new Float64Array(FEAT_SQ_LEN);
const _globFeat = new Float64Array(GLOB_IN);
const _feats = { sq: _sqFeat, glob: _globFeat };

const clamp1 = v => v > 1 ? 1 : v < -1 ? -1 : v;

// Perspective square index: rank-mirrored for black (files are left alone, so
// the king side stays the king side), returns 0..63.
function perspIdx(sq, side) {
    const rank = sq >> 4, file = sq & 7;
    return (side === 1 ? rank : 7 - rank) * 8 + file;
}

// `moves` must be the legal move list for the side to move (the caller already
// has it). Returns the shared scratch object - copy it if you need to keep it.
function encodePosition(game, side, moves) {
    const b = game.board;
    const f = _sqFeat, g = _globFeat;
    f.fill(0);
    g.fill(0);

    game.attackMaps(_atkW, _atkB);
    const ownAtkMap = side === 1 ? _atkW : _atkB;
    const oppAtkMap = side === 1 ? _atkB : _atkW;

    const hist = game.histBoards;
    const nHist = hist.length;

    let ownMat = 0, oppMat = 0, totalMat = 0;
    const ownCount = [0, 0, 0, 0, 0, 0, 0];
    const oppCount = [0, 0, 0, 0, 0, 0, 0];
    let ownAdvNum = 0, ownPawns = 0, oppAdvNum = 0, oppPawns = 0;
    let ownHang = 0, oppHang = 0;

    for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const rank = sq >> 4, file = sq & 7;
        const pi = perspIdx(sq, side);
        const i = pi * SQ_CH;
        const p = b[sq];
        const oppAtk = oppAtkMap[sq], ownAtk = ownAtkMap[sq];

        if (p === 0) {
            f[i + CH_EMPTY] = 1;
        } else {
            const ap = p > 0 ? p : -p;
            const mine = (p > 0 ? 1 : -1) === side;
            f[i + (mine ? CH_OWN : CH_OPP) + ap - 1] = 1;
            const val = MAT_VAL[ap] / 10;
            totalMat += val;
            if (mine) {
                ownMat += val; ownCount[ap]++;
                if (ap === P) {
                    ownPawns++;
                    const adv = side === 1 ? rank - 1 : 6 - rank;
                    ownAdvNum += Math.max(0, adv) / 5;
                }
                if (ap !== K && oppAtk > 0 && ownAtk === 0) { f[i + CH_HANGING] = 1; ownHang += val; }
            } else {
                oppMat += val; oppCount[ap]++;
                if (ap === P) {
                    oppPawns++;
                    const adv = side === 1 ? 6 - rank : rank - 1;
                    oppAdvNum += Math.max(0, adv) / 5;
                }
                if (ap !== K && ownAtk > 0 && oppAtk === 0) oppHang += val;
            }
        }

        f[i + CH_ATK_OPP] = Math.min(1, oppAtk / 3);
        f[i + CH_DEF_OWN] = Math.min(1, ownAtk / 3);

        // The five remembered board states, most recent first.
        const hIdx = rank * 8 + file;
        for (let h = 0; h < HIST_FRAMES; h++) {
            const frame = hist[nHist - 1 - h];
            if (!frame) break;
            const hv = frame[hIdx];
            if (hv === 0) continue;
            const hap = hv > 0 ? hv : -hv;
            f[i + CH_HIST + h] = ((hv > 0 ? 1 : -1) === side ? 1 : -1) * PIECE_CODE[hap];
        }

        f[i + CH_RANK] = (side === 1 ? rank : 7 - rank) / 7;
        f[i + CH_CENTER] = 1 - Math.abs(file - 3.5) / 3.5;
    }

    // Last committed moves, own and opponent's.
    const lm = game.lastMoves;
    const markMove = (m, fromCh, toCh) => {
        if (!m) return;
        f[perspIdx(m.from, side) * SQ_CH + fromCh] = 1;
        f[perspIdx(m.to, side) * SQ_CH + toCh] = 1;
    };
    markMove(lm[lm.length - 1], CH_OPP_FROM, CH_OPP_TO);
    markMove(lm[lm.length - 2], CH_OWN_FROM, CH_OWN_TO);

    // Mobility per square.
    for (let mi = 0; mi < moves.length; mi++) {
        const m = moves[mi];
        const fi = perspIdx(m.from, side) * SQ_CH;
        const ti = perspIdx(m.to, side) * SQ_CH;
        f[fi + CH_CAN_MOVE] = 1;
        f[fi + CH_N_FROM] = Math.min(1, f[fi + CH_N_FROM] + 0.125);
        f[ti + CH_N_TO] = Math.min(1, f[ti + CH_N_TO] + 0.125);
    }

    // ---- whole-position scalars ----
    const bal = ownMat - oppMat;
    g[0] = clamp1(bal / 12);
    for (let t = 1; t <= 5; t++) {
        g[t] = Math.min(1, ownCount[t] / 8);
        g[5 + t] = Math.min(1, oppCount[t] / 8);
    }
    const cr = game.castling;
    const ownK = side === 1 ? CR_WK : CR_BK, ownQ = side === 1 ? CR_WQ : CR_BQ;
    const oppK = side === 1 ? CR_BK : CR_WK, oppQ = side === 1 ? CR_BQ : CR_WQ;
    g[11] = (cr & ownK) ? 1 : 0;
    g[12] = (cr & ownQ) ? 1 : 0;
    g[13] = (cr & oppK) ? 1 : 0;
    g[14] = (cr & oppQ) ? 1 : 0;

    const ownKingSq = game.kingSq(side), oppKingSq = game.kingSq(-side);
    g[15] = (ownKingSq >= 0 && oppAtkMap[ownKingSq] > 0) ? 1 : 0;
    g[16] = (oppKingSq >= 0 && ownAtkMap[oppKingSq] > 0) ? 1 : 0;
    g[17] = Math.min(1, game.ply / MAX_PLIES);
    g[18] = Math.min(1, game.halfmove / 100);
    g[19] = Math.min(1, (game.repNow - 1) / 2);
    g[20] = Math.min(1, moves.length / 40);
    g[21] = Math.min(1, totalMat / 78);

    // Material balance through the remembered states: a falling line means the
    // brain has been losing material over the last few plies.
    const hm = game.histMat;
    for (let h = 0; h < HIST_FRAMES; h++) {
        const v = hm[hm.length - 1 - h];
        g[22 + h] = v === undefined ? g[0] : clamp1((v * side) / 12);
    }

    g[27] = ownPawns ? ownAdvNum / ownPawns : 0;
    g[28] = oppPawns ? oppAdvNum / oppPawns : 0;

    // King pressure: enemy attacks on the ring around each king.
    const ringPressure = (ks, atk) => {
        if (ks < 0) return 0;
        let n = 0;
        for (const o of KING_OFF) {
            const s = ks + o;
            if (!(s & 0x88)) n += atk[s];
        }
        return Math.min(1, n / 6);
    };
    g[29] = ringPressure(ownKingSq, oppAtkMap);
    g[30] = ringPressure(oppKingSq, ownAtkMap);
    g[31] = (ownKingSq >= 0 && (ownKingSq & 7) !== 4) ? 1 : 0; // king left the e-file
    g[32] = (oppKingSq >= 0 && (oppKingSq & 7) !== 4) ? 1 : 0;
    g[33] = Math.min(1, ownHang / 9);
    g[34] = Math.min(1, oppHang / 9);
    g[35] = 1; // constant input, lets the trunk learn a free offset

    for (let i = 0; i < GLOB_IN; i++) {
        const v = g[i];
        g[i] = Number.isFinite(v) ? clamp1(v) : 0;
    }
    return _feats;
}

if (typeof module !== 'undefined') {
    module.exports = { encodePosition, perspIdx, SQ_CH, GLOB_IN, FEAT_SQ_LEN, MAX_PLIES };
}
