/* cube.js — the puzzle. State, moves, scrambles, and an exact distance oracle.
 *
 * Nothing in here knows about neural networks, pixels or fitness. It is the
 * object under study, and it is built so that its correctness is *derived*
 * rather than typed in.
 *
 * ─── why a geometric model and not a permutation table ─────────────────────
 *
 * The usual way to write a cube in a few hundred lines is to paste the six
 * facelet cycles from a reference and trust them. That is 6 × ~20 hand-entered
 * indices, every one of which is silently wrong in a way that produces a puzzle
 * which still *looks* like a Rubik's cube — moves still shuffle stickers, the
 * solved state is still solved, and a scramble still gets undone by its own
 * inverse. What breaks is subtler: a mis-typed cycle turns the group into some
 * other group, and "the brain can't learn it" becomes indistinguishable from
 * "the GA is slow". This project has been burned by exactly that class of bug
 * enough times to pay for the geometry up front.
 *
 * So the cube is modelled as 26 cubies at integer positions in {-1,0,1}³, a
 * face turn is an honest 90° integer rotation of every cubie in that layer, and
 * the facelet permutation tables are *read off* the geometry at load time. The
 * same geometry is what the renderer draws, so the picture the network sees and
 * the puzzle it is solving cannot drift apart — there is only one description.
 *
 * test_headless.js then checks the group laws (M⁴ = I, M·M' = I, opposite faces
 * commute, every table is a bijection) against this construction.
 *
 * ─── the move set is a subgroup, and that matters ──────────────────────────
 *
 * The actions are quarter turns of four faces: U, D, L, R and their inverses.
 * F and B are never turned, which makes the reachable set ⟨U,D,L,R⟩ — a proper
 * subgroup of the cube group, roughly one part in two thousand of it.
 *
 * The consequence is not cosmetic: **a cube scrambled with F or B in it is
 * usually unsolvable here.** Every scramble therefore has to be generated from
 * the same generators the solver is given, which is what `scramble()` does. Get
 * this wrong and you have built an environment where the good policy does not
 * exist, and no reward function or architecture search will ever tell you so.
 * (FB can be switched on — see MOVES / moveSet — which enlarges both the action
 * space and the reachable set consistently.)
 */
"use strict";

/* Face order is U D L R F B, which is also the colour order and the order the
 * action names come in. Each face carries an outward normal plus the 2-D basis
 * you would use if you were looking straight at it from outside: `u` points
 * screen-right, `v` points screen-down. Facelet (row, col) of face f is then the
 * cubie at  n + u·(col-1) + v·(row-1)  and its sticker faces n. */
const FACE_NAMES = ["U", "D", "L", "R", "F", "B"];
const FACE_N = [[0, 1, 0], [0, -1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, -1]];
const FACE_U = [[1, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
const FACE_V = [[0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0]];

/* Western colour scheme: white up, yellow down, green front, blue back, red
 * right, orange left. The scheme is only a naming convention here — what the
 * network sees is whatever palette vision.js paints these six indices with, and
 * that palette is chosen for *separability in RGB*, not for realism. */
const COLOR_NAMES = ["white", "yellow", "orange", "red", "green", "blue"];

const N_FACELETS = 54;

/* ---------------------------------------------------------- integer vectors */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];

/* Rotate p by a quarter turn about the unit axis n.
 *
 * dir = +1 is *clockwise as seen from outside the face*, which is a rotation of
 * −90° about the outward normal under the right-hand rule: looking down −n with
 * screen-right e₁ and screen-up e₂ so that e₁ × e₂ = n, a positive rotation
 * carries right toward up, i.e. anticlockwise. Rodrigues at cos θ = 0 collapses
 * to two cross products and stays in the integers:
 *
 *     θ = −90°:  p' = −(n × p) + n (n · p)
 *     θ = +90°:  p' = +(n × p) + n (n · p)
 */
function rot90(n, dir, p) {
    const c = cross(n, p), s = dir > 0 ? -1 : 1, k = dot(n, p);
    return [s * c[0] + n[0] * k, s * c[1] + n[1] * k, s * c[2] + n[2] * k];
}

const posKey = p => (p[0] + 1) * 9 + (p[1] + 1) * 3 + (p[2] + 1);
/* Index of a signed unit axis: +x −x +y −y +z −z → 0..5. */
function axisKey(d) {
    if (d[0]) return d[0] > 0 ? 0 : 1;
    if (d[1]) return d[1] > 0 ? 2 : 3;
    return d[2] > 0 ? 4 : 5;
}

/* ------------------------------------------------- facelet ↔ geometry tables */

/* FACELET_POS[i]    the cubie a facelet lives on
 * FACELET_NORM[i]   which way its sticker points
 * STICKER_AT[posKey*6 + axisKey]  the inverse lookup, −1 where no sticker exists
 */
const FACELET_POS = new Array(N_FACELETS);
const FACELET_NORM = new Array(N_FACELETS);
const STICKER_AT = new Int8Array(27 * 6).fill(-1);

for (let f = 0; f < 6; f++) {
    const n = FACE_N[f], u = FACE_U[f], v = FACE_V[f];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const p = [
                n[0] + u[0] * (c - 1) + v[0] * (r - 1),
                n[1] + u[1] * (c - 1) + v[1] * (r - 1),
                n[2] + u[2] * (c - 1) + v[2] * (r - 1),
            ];
            const i = f * 9 + r * 3 + c;
            FACELET_POS[i] = p;
            FACELET_NORM[i] = n;
            STICKER_AT[posKey(p) * 6 + axisKey(n)] = i;
        }
    }
}

/* Every cubie that carries at least one sticker, with the facelets on it. The
 * renderer walks this: one entry per visible quad, and the cubie position is
 * what gets rotated when a turn is mid-animation. */
const CUBIES = (() => {
    const byPos = new Map();
    for (let i = 0; i < N_FACELETS; i++) {
        const k = posKey(FACELET_POS[i]);
        if (!byPos.has(k)) byPos.set(k, { pos: FACELET_POS[i], stickers: [] });
        byPos.get(k).stickers.push({ normal: FACELET_NORM[i], facelet: i });
    }
    return [...byPos.values()];
})();

/* ------------------------------------------------------------------- moves */

/* All twelve quarter turns, in face order. A run uses a *subset* of these (see
 * moveSet below); the indices here are stable so a brain's output layer always
 * means the same thing, and a saved brain records which subset it was trained
 * on. `inv` is the index of the move that undoes this one — used to keep
 * scrambles non-trivial and to score the "did it just undo itself" penalty. */
const MOVES = [];
for (let f = 0; f < 6; f++) {
    MOVES.push({ name: FACE_NAMES[f], face: f, dir: 1, idx: MOVES.length });
    MOVES.push({ name: FACE_NAMES[f] + "'", face: f, dir: -1, idx: MOVES.length });
}
for (const m of MOVES) m.inv = m.dir > 0 ? m.idx + 1 : m.idx - 1;

/* The facelet permutation of each move, derived from the geometry.
 *
 * Read it backwards, as a gather: after the turn, the sticker sitting at facelet
 * i is whichever sticker *was* at the place that the turn maps onto i. So take
 * i's position and normal, rotate both by the inverse turn to find where they
 * came from, and look that pair up. Facelets outside the moving layer map to
 * themselves. */
for (const m of MOVES) {
    const n = FACE_N[m.face];
    const perm = new Uint8Array(N_FACELETS);
    for (let i = 0; i < N_FACELETS; i++) {
        const p = FACELET_POS[i];
        if (dot(p, n) !== 1) { perm[i] = i; continue; }        // not in this layer
        const p0 = rot90(n, -m.dir, p);
        const n0 = rot90(n, -m.dir, FACELET_NORM[i]);
        const src = STICKER_AT[posKey(p0) * 6 + axisKey(n0)];
        if (src < 0) throw new Error(`move ${m.name}: facelet ${i} came from nowhere`);
        perm[i] = src;
    }
    m.perm = perm;
}

/* Which of the twelve a run is allowed to use. "UDLR" is the four faces this
 * project was built around; "UDLRFB" is the whole cube group. Anything else is
 * a string of face letters. */
function moveSet(spec) {
    const letters = String(spec || "UDLR").toUpperCase().split("");
    const faces = letters.map(ch => FACE_NAMES.indexOf(ch));
    if (faces.some(f => f < 0)) throw new Error("bad move set: " + spec);
    const list = MOVES.filter(m => faces.includes(m.face));
    /* Local indices, because the network's output layer is sized to the active
     * set: `local` is the output unit that fires this move, and `localInv`
     * indexes the same array. */
    list.forEach((m, k) => { m.local = k; });
    for (const m of list) m.localInv = list.findIndex(x => x.idx === m.inv);
    return list;
}

/* ------------------------------------------------------------------- state */

/* A cube is 54 bytes: state[i] is the colour index on facelet i. The six centre
 * facelets never change — a centre cubie's only sticker keeps its own colour
 * under every turn — so state[f*9+4] === f always, and "solved" means every
 * facelet matches its own face's centre. */
function solved() {
    const s = new Uint8Array(N_FACELETS);
    for (let f = 0; f < 6; f++) for (let k = 0; k < 9; k++) s[f * 9 + k] = f;
    return s;
}

function applyMove(state, move, out) {
    const perm = move.perm;
    const dst = out || new Uint8Array(N_FACELETS);
    for (let i = 0; i < N_FACELETS; i++) dst[i] = state[perm[i]];
    return dst;
}

/* In-place turn using a caller-supplied scratch buffer — the trainer does tens
 * of millions of these and allocating 54 bytes each time is most of the cost. */
function applyMoveInto(state, move, scratch) {
    const perm = move.perm;
    for (let i = 0; i < N_FACELETS; i++) scratch[i] = state[perm[i]];
    state.set(scratch);
    return state;
}

function isSolved(state) {
    for (let f = 0; f < 6; f++) {
        for (let k = 0; k < 9; k++) if (state[f * 9 + k] !== f) return false;
    }
    return true;
}

/* How many facelets carry their own face's colour, 0..54.
 *
 * Worth knowing before you reach for this as a reward: it is a *bad* distance
 * heuristic on this puzzle, and provably so. A U turn leaves all nine U-face
 * stickers on the U face (they are all white) and displaces the twelve stickers
 * in the top rows of F, R, B, L. U, U2 and U' therefore all score exactly 42 —
 * one move from solved, two moves from solved and one move the other way are
 * indistinguishable. rewards.js measures what that costs. */
function stickerScore(state) {
    let n = 0;
    for (let f = 0; f < 6; f++) {
        for (let k = 0; k < 9; k++) if (state[f * 9 + k] === f) n++;
    }
    return n;
}

/* Fully solved faces, 0..6. A coarser signal than stickers but a monotone-ish
 * one at the very end of a solve, and it is what a human would call progress. */
/* Matched adjacent facelet pairs within each face - 0 on nothing, 72 on a solved
 * cube (each face is a 3x3 grid with 6 horizontal and 6 vertical neighbour pairs).
 *
 * This exists for scrambles *outside* the oracle's radius, where the exact distance
 * table returns a constant and every shaped reward is therefore flat. `stickerScore`
 * still works out there, but it only counts facelets already home, which on a deep
 * scramble is a handful of near-random hits. Pair matching sees partial structure --
 * two stickers correct relative to each other, a formed block, a finished edge -- so
 * it keeps moving while a cube is still far from solved.
 *
 * It is deliberately NOT a substitute for the distance reward near the solved state,
 * where it is just as blind as sticker count: U, U2 and U' leave the same pairs
 * matched on the four side faces. That blindness is why `funnel` in rewards.js hands
 * over to the oracle the moment a cube enters the radius it can see. */
function pairScore(state) {
    let n = 0;
    for (let f = 0; f < 6; f++) {
        const b = f * 9;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const v = state[b + r * 3 + c];
                if (c < 2 && v === state[b + r * 3 + c + 1]) n++;
                if (r < 2 && v === state[b + (r + 1) * 3 + c]) n++;
            }
        }
    }
    return n;
}

function facesSolved(state) {
    let n = 0;
    for (let f = 0; f < 6; f++) {
        let ok = true;
        for (let k = 0; k < 9 && ok; k++) if (state[f * 9 + k] !== f) ok = false;
        if (ok) n++;
    }
    return n;
}

/* Hash key for the distance table. One char per facelet: 54-char strings are
 * ugly but they are what a JS Map hashes fastest, and 3 bits × 54 does not fit
 * in a Number. */
function key(state) {
    let s = "";
    for (let i = 0; i < N_FACELETS; i++) s += String.fromCharCode(48 + state[i]);
    return s;
}

/* ---------------------------------------------------------------- scrambles */

/* A scramble is `depth` random moves from the *active* set, never immediately
 * undoing the previous move (that would silently make a depth-4 scramble a
 * depth-2 one and quietly corrupt the curriculum). The returned cube is
 * guaranteed not to be solved; the *true* distance can still be less than
 * `depth`, which is why episodes label themselves with the oracle's number
 * rather than with the number of moves used to build them. */
function scramble(rng, depth, set, out) {
    const st = out || new Uint8Array(N_FACELETS);
    const scratch = new Uint8Array(N_FACELETS);
    for (let attempt = 0; attempt < 64; attempt++) {
        st.set(solved());
        let last = -1;
        const seq = [];
        for (let i = 0; i < depth; i++) {
            let m;
            do { m = set[(rng() * set.length) | 0]; } while (last >= 0 && m.idx === last);
            applyMoveInto(st, m, scratch);
            seq.push(m);
            last = m.inv;
        }
        if (depth === 0 || !isSolved(st)) return { state: st, seq };
    }
    return { state: st, seq: [] };
}

/* --------------------------------------------------------- distance oracle */

/* Exact God's-number distance for every state within `depth` turns of solved,
 * by breadth-first search outward from the solved cube.
 *
 * This is *scaffolding for the reward function and the metrics*, not something
 * the policy can consult. The network's input is pixels and only pixels; this
 * table exists so that (a) an episode can be labelled with its true difficulty
 * instead of the number of moves used to build it, and (b) a reward can say
 * "that move took you closer" — which, on a puzzle where sticker count cannot
 * tell U from U', is the only honest way to say it. The same distinction as the
 * placement oracle in the Tetris project: it shapes training and ships nowhere.
 *
 * Cost: branching is about 6.5 after the redundant-inverse pruning, so depth 6
 * is ~110k states and under a second. Depth 7 is ~700k and starts to cost real
 * memory in every worker; depth 8 is out of reach. The table's radius is
 * therefore a hard ceiling on how deep the shaped rewards can see, and the
 * curriculum is capped by it on purpose — see env.js.
 */
function buildDistanceTable(depth, set) {
    const table = new Map();
    const start = solved();
    table.set(key(start), 0);
    let frontier = [start];
    const scratch = new Uint8Array(N_FACELETS);
    for (let d = 1; d <= depth; d++) {
        const next = [];
        for (const st of frontier) {
            for (const m of set) {
                const child = applyMove(st, m, new Uint8Array(N_FACELETS));
                const k = key(child);
                if (table.has(k)) continue;
                table.set(k, d);
                next.push(child);
            }
        }
        frontier = next;
        if (!frontier.length) break;
    }
    void scratch;
    return { table, radius: depth, size: table.size };
}

/* Distance to solved, or `beyond` (radius + 1) when the state is outside the
 * table. Outside means *strictly further than the radius*, because the BFS is
 * complete — so the fallback is a true lower bound and never a guess. */
function distanceOf(oracle, state) {
    if (!oracle) return null;
    const d = oracle.table.get(key(state));
    return d === undefined ? oracle.radius + 1 : d;
}

/* The geometry vision.js and view.js need, bundled so they can take it as one
 * argument. Both of those files are used from Node (through load.js, which
 * concatenates every logic file into one scope) and from the browser (where each
 * is a plain <script> sharing the global scope), and passing a namespace object
 * is the one form that reads the same in both. */
const CUBE_GEOM = { FACE_NAMES, FACE_N, FACE_U, FACE_V, CUBIES, N_FACELETS };

if (typeof module !== "undefined") {
    module.exports = {
        CUBE_GEOM,
        FACE_NAMES, FACE_N, FACE_U, FACE_V, COLOR_NAMES, N_FACELETS,
        FACELET_POS, FACELET_NORM, CUBIES, MOVES, moveSet,
        solved, applyMove, applyMoveInto, isSolved, stickerScore, facesSolved,
        key, scramble, buildDistanceTable, distanceOf, rot90, dot, cross,
    };
}
