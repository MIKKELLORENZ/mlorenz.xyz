/* codec.js — the compression engine that the genetic algorithm designs with.

   A genome is a complete, runnable description of a lossless compressor:

       pre      optional block transforms        (Burrows–Wheeler, move-to-front)
       front8   numeric predictor for 8-bit grids  (per-channel linear formula)
       front16  numeric predictor for 16-bit data  (engages only where the file is 16-bit)
       experts  a bank of context models         (each looks at a different slice of the past)
       mixers   how the experts' bets are fused  (gated logistic mixing)
       apms     final probability refinement     (secondary symbol estimation)
       ------>  binary arithmetic coder          (fixed, not evolved)

   Everything here is DOM-free and deterministic: integer arithmetic only on the
   coding path and no Math.exp/log, so a file compressed in one browser decodes in
   any other. The whole engine lives inside ONE function so that its source text
   (CE_CODEC_FACTORY.toString()) can be shipped into a Blob worker — that works
   from file:// as well as http, where `new Worker("x.js")` does not. */

function CE_CODEC_FACTORY() {
'use strict';

// ---------------------------------------------------------------- constants
const MAGIC = [0x43, 0x45, 0x76, 0x32];          // "CEv2"
const MAX_EXPERTS = 12, MAX_TERMS = 4, MAX_TAPS = 6, MAX_APMS = 2, MAX_MIXERS = 2;
const MAX_PERIOD = 8, MAX_OFFSET = 65535, MAX_ORD = 16, MAX_MINLEN = 32;
const LIMITS = [1, 2, 3, 5, 8, 12, 20, 32, 64, 127, 255, 1023];   // counter adaptation limits
const LRS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];                   // mixer learning rates
const BWT_BLOCK = 1 << 22;
const TERM_KINDS = ['x', 'r', 'p', 'lin', 'ord', 'word', 'phase', 'run', 'col', 'above'];
const SEL_KINDS = ['none', 'bit', 'c0', 'term'];

// ------------------------------------------------- deterministic logistics
// squash(d) = 65536 / (1 + e^-d/256), from 65 exact integer knots, linearly
// interpolated in integers. stretch() is its inverse on 12-bit probabilities.
const KNOTS = [22, 28, 36, 47, 60, 77, 98, 126, 162, 208, 267, 342, 439, 562, 720, 922,
    1179, 1506, 1921, 2446, 3108, 3938, 4971, 6249, 7812, 9702, 11955, 14595, 17625,
    21025, 24743, 28693, 32768, 36843, 40793, 44511, 47911, 50941, 53581, 55834, 57724,
    59287, 60565, 61598, 62428, 63090, 63615, 64030, 64357, 64614, 64816, 64974, 65097,
    65194, 65269, 65328, 65374, 65410, 65438, 65459, 65476, 65489, 65500, 65508, 65514];
const SQUASH16 = new Uint16Array(4096);
for (let i = 0; i < 4096; i++) {
    const k = i >> 6, w = i & 63;
    SQUASH16[i] = (KNOTS[k] * (64 - w) + KNOTS[k + 1 > 64 ? 64 : k + 1] * w + 32) >> 6;
}
const STRETCH = new Int16Array(4096);
(function () {
    let pi = 0;
    for (let x = -2047; x <= 2047; x++) {
        const v = SQUASH16[x + 2048] >> 4;
        for (let j = pi; j <= v; j++) STRETCH[j] = x;
        pi = v + 1;
    }
    for (let j = pi; j < 4096; j++) STRETCH[j] = 2047;
})();
const DT = new Int32Array(1024);
for (let i = 0; i < 1024; i++) DT[i] = (16384 / (i + i + 3)) | 0;

// Display only (never steers coding): bits spent on an event of 12-bit probability p.
const COST12 = new Float32Array(4096);
for (let i = 0; i < 4096; i++) COST12[i] = -Math.log2((i + 0.5) / 4096);

// Signed-log and magnitude-log classes of a two's-complement byte.
const SLOG = new Uint8Array(256), MLOG = new Uint8Array(256);
function magClass(a) { return a === 0 ? 0 : a === 1 ? 1 : a === 2 ? 2 : a <= 4 ? 3 : a <= 8 ? 4 : a <= 16 ? 5 : a <= 32 ? 6 : 7; }
for (let b = 0; b < 256; b++) {
    const s = b < 128 ? b : b - 256, c = magClass(s < 0 ? -s : s);
    MLOG[b] = c; SLOG[b] = s >= 0 ? c : 7 + c;
}
function slogInt(v) { const c = magClass(v < 0 ? -v : v); return v >= 0 ? c : 7 + c; }
const RUNQ = new Uint8Array(256);
for (let r = 0; r < 256; r++) RUNQ[r] = r <= 1 ? 0 : r === 2 ? 1 : r === 3 ? 2 : r <= 5 ? 3 : r <= 8 ? 4 : r <= 16 ? 5 : r <= 32 ? 6 : 7;

// Smallest b with 2^b >= v, in exact arithmetic. Table sizes are part of the format
// (they change which contexts collide, hence every prediction), and Math.log2 is not
// promised to be bit-identical between JavaScript engines.
function ceilLog2(v) { let p = 1, b = 0; while (p < v) { p *= 2; b++; } return b; }

// ------------------------------------------------------------------ varints
function VarWriter() { this.a = []; }
VarWriter.prototype.u = function (v) { v = v >>> 0; while (v >= 128) { this.a.push((v & 127) | 128); v >>>= 7; } this.a.push(v); };
VarWriter.prototype.s = function (v) { this.u(v < 0 ? ((-v) << 1) - 1 : v << 1); };
function VarReader(buf, pos) { this.b = buf; this.p = pos || 0; }
VarReader.prototype.u = function () {
    let v = 0, sh = 0, c;
    do {
        if (this.p >= this.b.length) throw new Error('truncated header');
        c = this.b[this.p++]; v += (c & 127) * Math.pow(2, sh); sh += 7;
    } while (c & 128);
    return v;
};
VarReader.prototype.s = function () { const v = this.u(); return (v & 1) ? -((v + 1) / 2) : v / 2; };

// ------------------------------------------------------------ suffix sorting
// Prefix doubling with radix passes: O(n log n) on ANY input. A comparison sort
// would be quadratic on exactly the inputs a compressor meets most (long runs).
function suffixArray(s, n) {
    const sa = new Int32Array(n), rank = new Int32Array(n), tmp = new Int32Array(n), nr = new Int32Array(n);
    const cnt = new Int32Array(Math.max(257, n + 1));
    for (let i = 0; i < n; i++) cnt[s[i] + 1]++;
    for (let i = 1; i <= 256; i++) cnt[i] += cnt[i - 1];
    for (let i = 0; i < n; i++) sa[cnt[s[i]]++] = i;
    let classes = 0;
    for (let i = 0; i < n; i++) {
        if (i === 0 || s[sa[i]] !== s[sa[i - 1]]) classes++;
        rank[sa[i]] = classes - 1;
    }
    let cur = rank, nxt = nr;
    for (let k = 1; classes < n; k <<= 1) {
        let p = 0;
        for (let i = Math.max(0, n - k); i < n; i++) tmp[p++] = i;    // empty second key sorts first
        for (let i = 0; i < n; i++) if (sa[i] >= k) tmp[p++] = sa[i] - k;
        cnt.fill(0, 0, classes + 1);
        for (let i = 0; i < n; i++) cnt[cur[tmp[i]] + 1]++;
        for (let i = 1; i <= classes; i++) cnt[i] += cnt[i - 1];
        for (let i = 0; i < n; i++) { const t = tmp[i]; sa[cnt[cur[t]]++] = t; }
        let c = 0;
        nxt[sa[0]] = 0;
        for (let i = 1; i < n; i++) {
            const a = sa[i], b = sa[i - 1];
            if (cur[a] !== cur[b]) c++;
            else {
                const ra = a + k < n ? cur[a + k] : -1, rb = b + k < n ? cur[b + k] : -1;
                if (ra !== rb) c++;
            }
            nxt[a] = c;
        }
        classes = c + 1;
        const t = cur; cur = nxt; nxt = t;
    }
    return sa;
}

// BWT of one block. The virtual end-of-block symbol is not emitted; its row is
// returned as `primary` so the inverse can put it back.
function bwtBlock(src, start, n, out) {
    if (n === 0) return 0;
    const s = src.subarray(start, start + n), sa = suffixArray(s, n);
    let primary = 0, o = start;
    out[o++] = s[n - 1];
    for (let j = 0; j < n; j++) {
        if (sa[j] === 0) primary = j + 1; else out[o++] = s[sa[j] - 1];
    }
    return primary;
}
function ibwtBlock(src, start, n, primary, out) {
    if (n === 0) return;
    const count = new Int32Array(257), lf = new Int32Array(n + 1);
    for (let j = 0; j < n; j++) count[src[start + j] + 1]++;
    count[0] = 1;                                   // the end symbol sorts before everything
    for (let c = 1; c <= 256; c++) count[c] += count[c - 1];
    for (let j = 0; j <= n; j++) {
        if (j === primary) { lf[j] = 0; continue; }
        const c = src[start + (j < primary ? j : j - 1)];
        lf[j] = count[c]++;
    }
    let j = 0;
    for (let k = n - 1; k >= 0; k--) {
        out[start + k] = src[start + (j < primary ? j : j - 1)];
        j = lf[j];
    }
}
function bwtForward(data) {
    const n = data.length, out = new Uint8Array(n), prim = [];
    for (let s = 0; s < n; s += BWT_BLOCK) prim.push(bwtBlock(data, s, Math.min(BWT_BLOCK, n - s), out));
    return { stream: out, primaries: prim };
}
function bwtInverse(data, primaries) {
    const n = data.length, out = new Uint8Array(n);
    for (let s = 0, b = 0; s < n; s += BWT_BLOCK, b++) {
        const len = Math.min(BWT_BLOCK, n - s), pr = primaries[b];
        if (!(pr >= 1 && pr <= len)) throw new Error('bad BWT index');
        ibwtBlock(data, s, len, pr, out);
    }
    return out;
}

// ------------------------------------------------------------ move-to-front
function mtfForward(data) {
    const n = data.length, out = new Uint8Array(n), list = new Uint8Array(256);
    for (let i = 0; i < 256; i++) list[i] = i;
    for (let i = 0; i < n; i++) {
        const c = data[i];
        let j = 0;
        while (list[j] !== c) j++;
        out[i] = j;
        for (; j > 0; j--) list[j] = list[j - 1];
        list[0] = c;
    }
    return out;
}
function mtfInverse(data) {
    const n = data.length, out = new Uint8Array(n), list = new Uint8Array(256);
    for (let i = 0; i < 256; i++) list[i] = i;
    for (let i = 0; i < n; i++) {
        let j = data[i];
        const c = list[j];
        out[i] = c;
        for (; j > 0; j--) list[j] = list[j - 1];
        list[0] = c;
    }
    return out;
}

// ----------------------------------------------------------- genome hygiene
// normalize() turns ANY object into a valid, canonical genome (deep copy). Every
// mutation goes through it, so the search can be sloppy and the codec never sees
// an illegal program. Field order is fixed: JSON.stringify(normalize(g)) is a key.
//
// OFFSETS ARE STRUCTURE-RELATIVE. An offset is [rows, units, bytes] and means
// rows·S + units·p + bytes, where p (one pixel / sample frame / record) and S (one
// row) are properties of the FILE — found by the analyser, stored in the header. So
// [1,0,0] is "directly above" in an image of any width, [0,1,0] is "the same channel,
// one unit earlier" in RGB and in stereo PCM alike, and on a file that has no rows a
// clue about rows simply stays silent. A design is an algorithm, not a description
// of one particular cat — which is what lets ONE design be judged on every file.
function cint(v, lo, hi, d) { v = Number.isFinite(+v) ? Math.round(+v) : d; return v < lo ? lo : v > hi ? hi : v; }
function normOff(o) {
    let a = 0, b = 0, c = 1;
    if (Array.isArray(o)) { a = cint(o[0], 0, 3, 0); b = cint(o[1], -8, 16, 0); c = cint(o[2], -8, 64, 0); }
    else if (Number.isFinite(+o)) c = cint(o, 1, 64, 1);
    if (a === 0 && b <= 0 && c <= 0) { b = 0; c = 1; }                  // that would be the future
    return [a, b, c];
}
function offKey(o) { return o[0] + ',' + o[1] + ',' + o[2]; }
function normShape(s) {
    s = s || {};
    return { p: cint(s.p, 1, 255, 1), S: cint(s.S, 0, MAX_OFFSET, 0), s16: s.s16 ? 1 : 0, off16: s.off16 ? 1 : 0, texty: s.texty ? 1 : 0 };
}
// byte distance an offset means in a file of this shape; 0 = "says nothing here"
function resolveOff(o, sh) {
    if (o[0] > 0 && sh.S === 0) return 0;
    const v = o[0] * sh.S + o[1] * sh.p + o[2];
    return v < 1 || v > MAX_OFFSET ? 0 : v;
}
// Which numeric predictor engages: the 16-bit one on 16-bit data, the 8-bit one on
// other gridded, non-text data, none on text. Returns sample width, byte alignment
// and the number of phases (channels) the file cycles through.
function frontFor(g, sh) {
    const numeric = !sh.texty && (sh.p > 1 || sh.S > 0), front = sh.s16 ? g.front16 : numeric ? g.front8 : null;
    const W = front && sh.s16 ? 2 : 1;
    return { front, W, OFF: W === 2 ? sh.off16 : 0, PH: front && sh.p % W === 0 ? Math.min(64, sh.p / W) : 1 };
}
function normTaps(taps, max) {
    const out = [];
    if (Array.isArray(taps)) for (const t of taps) {
        if (!Array.isArray(t)) continue;
        const o = normOff(t[0]), c = cint(t[1], -16, 16, 1);
        if (c === 0) continue;
        const dup = out.find(u => offKey(u[0]) === offKey(o));
        if (dup) dup[1] = cint(dup[1] + c, -16, 16, 1); else if (out.length < max) out.push([o, c]);
    }
    return out.filter(t => t[1] !== 0);
}
function normTerm(t) {
    if (!t || typeof t !== 'object') return null;
    switch (t.t) {
        case 'x': return { t: 'x', o: normOff(t.o), q: cint(t.q, 1, 8, 8) };
        case 'r': return { t: 'r', o: normOff(t.o), m: cint(t.m, 0, 2, 0) };
        case 'p': return { t: 'p', q: cint(t.q, 1, 8, 8) };
        case 'lin': {
            const taps = normTaps(t.taps, MAX_TAPS);
            if (!taps.length) return null;
            return { t: 'lin', taps, shift: cint(t.shift, 0, 6, 0), rel: t.rel ? 1 : 0, m: cint(t.m, 0, 2, 0), q: cint(t.q, 1, 8, 6) };
        }
        case 'ord': return { t: 'ord', n: cint(t.n, 1, MAX_ORD, 1) };
        case 'word': return { t: 'word', n: cint(t.n, 0, 1, 0) };
        case 'phase': { const u = cint(t.u, 0, 2, 0); return { t: 'phase', u, P: u === 0 ? cint(t.P, 2, 64, 2) : 0 }; }   // u: 0 = literal P, 1 = the file's unit, 2 = its row
        case 'run': return { t: 'run' };
        case 'col': return { t: 'col' };
        case 'above': return { t: 'above' };
    }
    return null;
}
function normTerms(list, max) {
    const out = [], seen = new Set();
    if (Array.isArray(list)) for (const raw of list) {
        const t = normTerm(raw);
        if (!t) continue;
        const k = JSON.stringify(t);
        if (seen.has(k) || out.length >= max) continue;
        seen.add(k); out.push(t);
    }
    return out;
}
function normFront(f) {
    if (!f || typeof f !== 'object') return null;
    const src = Array.isArray(f.preds) && f.preds.length ? f.preds : [{}], preds = [];
    for (let i = 0; i < src.length && i < MAX_PERIOD; i++) { const p = src[i] || {}; preds.push({ taps: normTaps(p.taps, MAX_TAPS), shift: cint(p.shift, 0, 6, 0), clamp: p.clamp ? 1 : 0 }); }
    return { preds };
}
function normalize(g) {
    g = g && typeof g === 'object' ? g : {};
    const out = { pre: [], front8: normFront(g.front8), front16: normFront(g.front16), experts: [], mixers: [], apms: [] };
    if (Array.isArray(g.pre)) for (const p of g.pre) if ((p === 'bwt' || p === 'mtf') && !out.pre.includes(p)) out.pre.push(p);
    // an 8-bit predictor that never guesses anything is "no predictor" in disguise
    // (a 16-bit one without taps still reorders the bytes, so it is kept)
    if (out.front8 && out.front8.preds.every(p => p.taps.length === 0)) out.front8 = null;
    let matches = 0;
    if (Array.isArray(g.experts)) for (const e of g.experts) {
        if (!e || out.experts.length >= MAX_EXPERTS) continue;
        if (e.k === 'match') {
            if (matches++ < 2) out.experts.push({ k: 'match', minLen: cint(e.minLen, 1, MAX_MINLEN, 6), limit: cint(e.limit, 0, LIMITS.length - 1, 11) });
        } else out.experts.push({ k: 'ctx', terms: normTerms(e.terms, MAX_TERMS), limit: cint(e.limit, 0, LIMITS.length - 1, 9) });
    }
    if (!out.experts.some(e => e.k === 'ctx')) out.experts.unshift({ k: 'ctx', terms: [], limit: 9 });
    if (out.experts.length > MAX_EXPERTS) out.experts.length = MAX_EXPERTS;
    if (Array.isArray(g.mixers)) for (const m of g.mixers) {
        if (!m || out.mixers.length >= MAX_MIXERS) continue;
        const s = m.sel || {}, k = SEL_KINDS.includes(s.k) ? s.k : 'none', term = k === 'term' ? normTerm(s.term) : null;
        out.mixers.push({ sel: term ? { k: 'term', term } : { k: k === 'term' ? 'none' : k }, lr: cint(m.lr, 0, LRS.length - 1, 5) });
    }
    if (!out.mixers.length) out.mixers.push({ sel: { k: 'none' }, lr: 5 });
    if (Array.isArray(g.apms)) for (const a of g.apms) {
        if (!a || out.apms.length >= MAX_APMS) continue;
        out.apms.push({ terms: normTerms(a.terms, 2), rate: cint(a.rate, 4, 7, 6), w: cint(a.w, 1, 3, 2) });
    }
    return out;
}
function genomeKey(g) { return JSON.stringify(g); }

// --------------------------------------------- the algorithm, as header bytes
function packOff(w, o) { w.u(o[0]); w.s(o[1]); w.s(o[2]); }
function unpackOff(r) { return [r.u(), r.s(), r.s()]; }
function packTaps(w, taps) { w.u(taps.length); for (const [o, c] of taps) { packOff(w, o); w.s(c); } }
function unpackTaps(r) { const n = r.u(), taps = []; for (let i = 0; i < n && i < 64; i++) taps.push([unpackOff(r), r.s()]); return taps; }
function packTerm(w, t) {
    w.u(TERM_KINDS.indexOf(t.t));
    switch (t.t) {
        case 'x': packOff(w, t.o); w.u(t.q); break;
        case 'r': packOff(w, t.o); w.u(t.m); break;
        case 'p': w.u(t.q); break;
        case 'lin': packTaps(w, t.taps); w.u(t.shift); w.u(t.rel); w.u(t.m); w.u(t.q); break;
        case 'ord': w.u(t.n); break;
        case 'word': w.u(t.n); break;
        case 'phase': w.u(t.u); w.u(t.P); break;
    }
}
function unpackTerm(r) {
    const t = TERM_KINDS[r.u()];
    switch (t) {
        case 'x': return { t, o: unpackOff(r), q: r.u() };
        case 'r': return { t, o: unpackOff(r), m: r.u() };
        case 'p': return { t, q: r.u() };
        case 'lin': return { t, taps: unpackTaps(r), shift: r.u(), rel: r.u(), m: r.u(), q: r.u() };
        case 'ord': return { t, n: r.u() };
        case 'word': return { t, n: r.u() };
        case 'phase': return { t, u: r.u(), P: r.u() };
    }
    return { t };
}
function packFront(w, f) {
    if (!f) { w.u(0); return; }
    w.u(f.preds.length);
    for (const p of f.preds) { packTaps(w, p.taps); w.u(p.shift); w.u(p.clamp); }
}
function unpackFront(r) {
    const n = r.u();
    if (!n) return null;
    const preds = [];
    for (let i = 0; i < n && i < 64; i++) preds.push({ taps: unpackTaps(r), shift: r.u(), clamp: r.u() });
    return { preds };
}
function packGenome(g) {
    const w = new VarWriter();
    w.u(2);
    w.u(g.pre.length); for (const p of g.pre) w.u(p === 'bwt' ? 0 : 1);
    packFront(w, g.front8); packFront(w, g.front16);
    w.u(g.experts.length);
    for (const e of g.experts) {
        if (e.k === 'match') { w.u(1); w.u(e.minLen); w.u(e.limit); }
        else { w.u(0); w.u(e.limit); w.u(e.terms.length); for (const t of e.terms) packTerm(w, t); }
    }
    w.u(g.mixers.length);
    for (const m of g.mixers) { w.u(SEL_KINDS.indexOf(m.sel.k)); if (m.sel.k === 'term') packTerm(w, m.sel.term); w.u(m.lr); }
    w.u(g.apms.length);
    for (const a of g.apms) { w.u(a.terms.length); for (const t of a.terms) packTerm(w, t); w.u(a.rate); w.u(a.w); }
    return Uint8Array.from(w.a);
}
function unpackGenome(buf, pos) {
    const r = new VarReader(buf, pos), g = { pre: [], experts: [], mixers: [], apms: [] };
    if (r.u() !== 2) throw new Error('unknown genome version');
    for (let i = 0, n = r.u(); i < n && i < 8; i++) g.pre.push(r.u() === 0 ? 'bwt' : 'mtf');
    g.front8 = unpackFront(r); g.front16 = unpackFront(r);
    for (let i = 0, n = r.u(); i < n && i < 64; i++) {
        if (r.u() === 1) g.experts.push({ k: 'match', minLen: r.u(), limit: r.u() });
        else { const e = { k: 'ctx', limit: r.u(), terms: [] }; for (let j = 0, m = r.u(); j < m && j < 64; j++) e.terms.push(unpackTerm(r)); g.experts.push(e); }
    }
    for (let i = 0, n = r.u(); i < n && i < 8; i++) {
        const k = SEL_KINDS[r.u()] || 'none', sel = k === 'term' ? { k, term: unpackTerm(r) } : { k };
        g.mixers.push({ sel, lr: r.u() });
    }
    for (let i = 0, n = r.u(); i < n && i < 8; i++) {
        const a = { terms: [] };
        for (let j = 0, m = r.u(); j < m && j < 8; j++) a.terms.push(unpackTerm(r));
        a.rate = r.u(); a.w = r.u(); g.apms.push(a);
    }
    return { genome: normalize(g), end: r.p };
}

// ------------------------------------------------------------- term program
// Terms are flattened into an Int32Array so the hot loop touches no objects, and
// structure-relative offsets are resolved against the file's shape HERE, once.
// A clue that means nothing in this file (rows in a text) compiles to "constant 0".
function termLen(prog, pc) {
    switch (prog[pc]) {
        case 0: case 1: return 3;
        case 3: return 6 + 2 * prog[pc + 1];
        case 7: case 8: case 9: case 10: return 1;
        default: return 2;
    }
}
// appends the term's program to `a` and returns how many context bits it contributes
function compileTerm(t, a, sh) {
    switch (t.t) {
        case 'x': { const o = resolveOff(t.o, sh); if (!o) { a.push(10); return 0; } a.push(0, o, 8 - t.q); return t.q; }
        case 'r': { const o = resolveOff(t.o, sh); if (!o) { a.push(10); return 0; } a.push(1, o, t.m); return t.m === 0 ? 8 : t.m === 1 ? 4 : 3; }
        case 'p': a.push(2, 8 - t.q); return t.q;
        case 'lin': {
            const live = [];
            for (const [o, c] of t.taps) { const v = resolveOff(o, sh); if (v) live.push(v, c); }
            if (!live.length) { a.push(10); return 0; }
            a.push(3, live.length / 2, t.shift, t.rel, t.m, 8 - t.q);
            for (const v of live) a.push(v);
            return t.m === 0 ? t.q : t.m === 1 ? 4 : 3;
        }
        case 'ord': a.push(4, t.n); return 8 * t.n;
        case 'word': a.push(5, t.n); return 32;
        case 'phase': { const P = t.u === 0 ? t.P : t.u === 1 ? sh.p : sh.S; if (P < 2) { a.push(10); return 0; } a.push(6, P); return ceilLog2(P); }
        case 'run': a.push(7); return 3;
        case 'col': a.push(8); return 8;
        case 'above': a.push(9); return 8;
    }
    a.push(10); return 0;
}
// G = [run length, word hash, previous word hash, line start, previous line start]
function termValue(prog, pc, i, pb, X, R, G) {
    switch (prog[pc]) {
        case 0: { const pos = i - prog[pc + 1]; return pos >= 0 ? X[pos] >> prog[pc + 2] : 0; }
        case 1: { const pos = i - prog[pc + 1], rb = pos >= 0 ? R[pos] : 0, m = prog[pc + 2]; return m === 0 ? rb : m === 1 ? SLOG[rb] : MLOG[rb]; }
        case 2: return pb >> prog[pc + 1];
        case 3: {
            const nt = prog[pc + 1], sh = prog[pc + 2], m = prog[pc + 4];
            let sum = 0, q = pc + 6;
            for (let j = 0; j < nt; j++, q += 2) { const pos = i - prog[q]; if (pos >= 0) sum += prog[q + 1] * X[pos]; }
            if (sh) sum = (sum + (1 << (sh - 1))) >> sh;
            if (prog[pc + 3]) sum -= pb;
            if (m === 0) return (sum < 0 ? 0 : sum > 255 ? 255 : sum) >> prog[pc + 5];
            return m === 1 ? slogInt(sum) : magClass(sum < 0 ? -sum : sum);
        }
        case 4: {
            const nn = prog[pc + 1];
            let h = 0;
            for (let j = 1; j <= nn; j++) { const pos = i - j; h = Math.imul(h + (pos >= 0 ? X[pos] : 0) + 1, 0x2F0B4B87); }
            return h;
        }
        case 5: return prog[pc + 1] ? (G[1] + Math.imul(G[2], 0x632BE5AB)) | 0 : G[1];
        case 6: return i % prog[pc + 1];
        case 7: return RUNQ[G[0] > 255 ? 255 : G[0]];
        case 8: { const c = i - G[3]; return c > 255 ? 255 : c; }
        case 9: { const a = G[4] + (i - G[3]); return (G[4] >= 0 && a < G[3]) ? X[a] : 0; }
    }
    return 0;
}
function termsHash(prog, pc, end, i, pb, X, R, G, seed) {
    let h = seed;
    while (pc < end) {
        h = Math.imul((h + termValue(prog, pc, i, pb, X, R, G) + 0x7F4A7C15) | 0, 0x9E3779B1);
        h ^= h >>> 15;
        pc += termLen(prog, pc);
    }
    return h;
}

// --------------------------------------------------------- counter tables
// 16-slot blocks: slot 0 is a verification tag, slots 1..15 the binary tree of
// one nibble. Three-way associative, least-used block is evicted. A context
// never seen before therefore starts at p = 1/2 and contributes stretch() = 0
// to the mixer — "I don't know" costs nothing.
const HALF = -2147483648;          // p = 1/2, count = 0, as an int32 bit pattern
// A mixer skips its weight update when it was already within SKIP/4096 of the truth.
// Costs < 0.01 % in size, saves the update on most bits. Part of the FORMAT: encoder
// and decoder must agree, so it is a constant and not an option.
const SKIP = 24;
const POOL = { tab: [], i32: [], u16: [] };
function pooled(kind, slot, size, Ctor) {
    const list = POOL[kind];
    if (!list[slot] || list[slot].length < size) list[slot] = new Ctor(size);
    return list[slot];
}

// ------------------------------------------------------------------ the model
// One loop for both directions: `enc` only decides whether a bit comes from the
// data or from the arithmetic decoder. Every prediction is computed by the same
// statements either way, so the decoder cannot drift from the encoder.
function runModel(g, n, src, enc, input, ipos, opt) {
    opt = opt || {};
    const sh = normShape(opt.shape), ff = frontFor(g, sh), front = ff.front, W = ff.W, OFF = ff.OFF, PER = ff.PH;
    const X = new Uint8Array(n), R = new Uint8Array(n), G = new Int32Array([0, 0, 0, 0, -1]);
    const maxBits = opt.maxBits || 22;
    const dataBits = Math.min(maxBits, Math.max(12, ceilLog2(Math.max(16, n) * 8)));

    // ---- numeric front
    // (its taps count SAMPLES: a unit is one frame of PER channels, a row is S / W samples;
    // the file cycles through PER phases and formula number phase % NF serves each)
    const FN = [], FO = [], FC = [], FS = [], FK = [], NF = front ? front.preds.length : 1;
    if (front) {
        const row = sh.S % W === 0 ? sh.S / W : 0;
        for (const p of front.preds) {
            const os = [], cs = [];
            for (const [o, c] of p.taps) {
                const v = o[0] > 0 && row === 0 ? 0 : o[0] * row + o[1] * PER + o[2];
                if (v >= 1 && v <= MAX_OFFSET) { os.push(v * W); cs.push(c); }
            }
            FN.push(os.length); FS.push(p.shift); FK.push(p.clamp && os.length >= 2 ? 1 : 0);
            FO.push(Int32Array.from(os)); FC.push(Int32Array.from(cs));
        }
    }

    // ---- experts. Context experts take mixer inputs 0..KC-1, each match expert
    // two more, the bias is last. All counter tables live in ONE Int32Array.
    const K = g.experts.length, progA = [], ctxIdx = [], matIdx = [];
    for (let e = 0; e < K; e++) (g.experts[e].k === 'match' ? matIdx : ctxIdx).push(e);
    const KC = ctxIdx.length, KM = matIdx.length, nIn = KC + 2 * KM + 1, BIAS = nIn - 1;
    const cStart = new Int32Array(KC), cEnd = new Int32Array(KC), cLimit = new Int32Array(KC), cShift = new Int32Array(KC);
    const cOff = new Int32Array(KC), cBase = new Int32Array(KC), cHash = new Int32Array(KC), cSeed = new Int32Array(KC);
    let tabSize = 0;
    for (let q = 0; q < KC; q++) {
        const ex = g.experts[ctxIdx[q]];
        cStart[q] = progA.length;
        let bits = 0;
        for (const t of ex.terms) bits += compileTerm(t, progA, sh);
        cEnd[q] = progA.length; cLimit[q] = LIMITS[ex.limit]; cSeed[q] = Math.imul(ctxIdx[q] + 1, 0x3C6EF372);
        const tb = Math.min(dataBits, Math.max(10, Math.min(32, bits) + 10));
        cShift[q] = 32 - (tb - 4); cOff[q] = tabSize; tabSize += 1 << tb;
    }
    const mMin = new Int32Array(KM), mLen = new Int32Array(KM), mPtr = new Int32Array(KM), mExp = new Int32Array(KM), mOk = new Uint8Array(KM);
    const mSlot = new Int32Array(KM), mOff = new Int32Array(KM), mHB = new Int32Array(KM), mHT = new Array(KM);
    for (let q = 0; q < KM; q++) {
        mMin[q] = g.experts[matIdx[q]].minLen; mOff[q] = tabSize; tabSize += 64;
        mHB[q] = Math.min(20, Math.max(10, ceilLog2(Math.max(16, n))));
        const ht = pooled('i32', q, 1 << mHB[q], Int32Array); ht.fill(0, 0, 1 << mHB[q]); mHT[q] = ht;
    }
    const TAB = pooled('tab', 0, tabSize, Int32Array);
    TAB.fill(0, 0, tabSize);
    for (let q = 0; q < KM; q++) TAB.fill(HALF, mOff[q], mOff[q] + 64);

    // ---- mixers (one flat weight array)
    const NM = g.mixers.length, mixSelKind = new Uint8Array(NM), mixSelPc = new Int32Array(NM), mixLr = new Int32Array(NM);
    const mixOff = new Int32Array(NM), mixSet = new Int32Array(NM), mixSv = new Int32Array(NM), mixD = new Int32Array(NM);
    let wSize = 0;
    for (let m = 0; m < NM; m++) {
        const mx = g.mixers[m], k = SEL_KINDS.indexOf(mx.sel.k);
        mixSelKind[m] = k; mixLr[m] = LRS[mx.lr];
        if (k === 3) { mixSelPc[m] = progA.length; compileTerm(mx.sel.term, progA, sh); }
        mixOff[m] = wSize; wSize += (k === 0 ? 1 : k === 1 ? 8 : k === 2 ? 256 : 512) * nIn;
    }
    const MW = new Int32Array(wSize + 16);
    MW.fill(Math.round(65536 * 0.3), 0, wSize); MW.fill(32768, wSize);
    const W2 = wSize;                                   // final 2-input mixer lives after the others

    // ---- APMs
    const NA = g.apms.length, aStart = new Int32Array(NA), aEnd = new Int32Array(NA), aRate = new Int32Array(NA), aW = new Int32Array(NA);
    const aTab = new Array(NA), aMask = new Int32Array(NA), aHash = new Int32Array(NA), aIdx = new Int32Array(NA);
    const apmBits = Math.min(16, Math.max(8, ceilLog2(Math.max(16, n)) - 4));
    for (let a = 0; a < NA; a++) {
        const ap = g.apms[a];
        aStart[a] = progA.length; for (const t of ap.terms) compileTerm(t, progA, sh); aEnd[a] = progA.length;
        aRate[a] = ap.rate; aW[a] = ap.w;
        const ctxs = ap.terms.length ? 1 << apmBits : 256, T = pooled('u16', a, ctxs * 33, Uint16Array);
        for (let j = 0; j < 33; j++) { const v = SQUASH16[Math.min(4095, Math.max(0, (j - 16) * 128 + 2048))]; for (let c = 0, o = j; c < ctxs; c++, o += 33) T[o] = v; }
        aTab[a] = T; aMask[a] = ctxs - 1;
    }
    const prog = Int32Array.from(progA);

    // ---- bookkeeping
    const ST = new Int32Array(nIn);
    ST[BIAS] = 256;
    const wantCosts = !!opt.costs, costs = wantCosts ? new Uint8Array(n) : null;
    const wantStats = !!opt.stats, infl = wantStats ? new Float64Array(nIn) : null;
    const cps = opt.checkpoints || null, caps = opt.abortAbove || null, cum = [];
    let cpi = 0;

    // ---- arithmetic coder: x1, x2, xd are uint32 BIT PATTERNS held in int32
    let x1 = 0, x2 = -1, xd = 0, ip = ipos | 0, op = 0;
    let out = enc ? new Uint8Array(Math.max(1024, n >> 1)) : null;
    if (!enc) for (let k = 0; k < 4; k++) xd = (xd << 8) | (ip < input.length ? input[ip++] : 0);

    let curPred = 0, curRes = 0, rhi = 0;
    for (let i = 0; i < n; i++) {
        if (cps !== null && cpi < cps.length && i === cps[cpi]) {
            cum.push(op);
            if (caps !== null && op > caps[cpi]) return { aborted: true, at: i, cum };
            cpi++;
        }
        // ---------- numeric front: which byte of which sample is this?
        let pb = 0, sb = -1;
        if (front !== null && i >= OFF) {
            const rel = i - OFF;
            sb = W === 2 ? (rel & 1) : 0;
            if (sb === 0) {
                if (i + W > n) sb = -1;
                else {
                    const ph = ((W === 2 ? rel >> 1 : rel) % PER) % NF, nt = FN[ph], fo = FO[ph], fc = FC[ph];
                    let sum = 0, v0 = 0, v1 = 0;
                    for (let j = 0; j < nt; j++) {
                        const pos = i - fo[j];
                        let v = 0;
                        if (pos >= OFF) v = W === 2 ? ((X[pos] << 8 | X[pos + 1]) << 16) >> 16 : X[pos];
                        if (j === 0) v0 = v; else if (j === 1) v1 = v;
                        sum += fc[j] * v;
                    }
                    const sh = FS[ph];
                    if (sh) sum = (sum + (1 << (sh - 1))) >> sh;
                    if (FK[ph]) { const lo = v0 < v1 ? v0 : v1, hi = v0 < v1 ? v1 : v0; sum = sum < lo ? lo : sum > hi ? hi : sum; }
                    if (W === 2) sum = sum < -32768 ? -32768 : sum > 32767 ? 32767 : sum;
                    else sum = sum < 0 ? 0 : sum > 255 ? 255 : sum;
                    curPred = sum;
                    if (enc) curRes = W === 2 ? ((((src[i] << 8 | src[i + 1]) << 16) >> 16) - sum) & 0xffff : (src[i] - sum) & 255;
                }
            }
            if (sb >= 0) pb = W === 2 ? (sb === 0 ? (curPred >> 8) & 255 : curPred & 255) : curPred;
        }
        const cb = !enc ? 0 : sb < 0 ? src[i] : W === 2 ? (sb === 0 ? curRes >> 8 : curRes & 255) : curRes;

        // ---------- contexts for this byte
        for (let q = 0; q < KC; q++) cHash[q] = termsHash(prog, cStart[q], cEnd[q], i, pb, X, R, G, cSeed[q]);
        for (let q = 0; q < KM; q++) {
            mOk[q] = mLen[q] > 0 ? 1 : 0;
            if (mOk[q]) mExp[q] = W === 1 ? (X[mPtr[q]] - pb) & 255 : R[mPtr[q]];
            else { ST[KC + 2 * q] = 0; ST[KC + 2 * q + 1] = 0; }
        }
        for (let m = 0; m < NM; m++) if (mixSelKind[m] === 3) {
            const v = termValue(prog, mixSelPc[m], i, pb, X, R, G);
            mixSv[m] = (v >= 0 && v < 64) ? v : Math.imul(v, 0x9E3779B1) >>> 26;
        }
        for (let a = 0; a < NA; a++) if (aEnd[a] > aStart[a]) aHash[a] = termsHash(prog, aStart[a], aEnd[a], i, pb, X, R, G, 0x51ED270B);

        // ---------- eight binary decisions
        let c0 = 1, node = 1, cost = 0;
        for (let bit = 7; bit >= 0; bit--) {
            if (bit === 7 || bit === 3) {
                node = 1;
                const salt = Math.imul(c0, 0x3D4D51CB);
                for (let q = 0; q < KC; q++) {
                    let h = Math.imul(cHash[q] ^ salt, 0x2545F491); h ^= h >>> 16;
                    // findBlock, inlined: 16-slot block, tag in slot 0, 3-way associative
                    const off = cOff[q], tag = h | 1, b0 = off + ((h >>> cShift[q]) << 4), b1 = b0 ^ 16, b2 = b0 ^ 32;
                    let b = b0;
                    if (TAB[b0] !== tag) {
                        if (TAB[b1] === tag) b = b1;
                        else if (TAB[b2] === tag) b = b2;
                        else {
                            let pv = TAB[b0 + 1] & 1023;
                            const p1 = TAB[b1 + 1] & 1023; if (p1 < pv) { b = b1; pv = p1; }
                            if ((TAB[b2 + 1] & 1023) < pv) b = b2;
                            TAB[b] = tag;
                            for (let k = 1; k < 16; k++) TAB[b + k] = HALF;
                        }
                    }
                    cBase[q] = b;
                }
            }
            for (let q = 0; q < KC; q++) ST[q] = STRETCH[TAB[cBase[q] + node] >>> 20];
            for (let q = 0; q < KM; q++) if (mOk[q]) {
                const len = mLen[q], eb = (mExp[q] >> bit) & 1;
                const lb = len < 16 ? len : len < 32 ? 16 + ((len - 16) >> 2) : len < 64 ? 20 + ((len - 32) >> 3) : 24 + (len >= 512 ? 7 : (len - 64) >> 6);
                const s = mOff[q] + lb * 2 + eb, k = (len > 32 ? 32 : len) * 63;
                mSlot[q] = s; ST[KC + 2 * q] = STRETCH[TAB[s] >>> 20]; ST[KC + 2 * q + 1] = eb ? k : -k;
            }
            // ---- mix
            const bp = 7 - bit;
            let d = 0;
            for (let m = 0; m < NM; m++) {
                const k = mixSelKind[m], wb = mixOff[m] + (k === 0 ? 0 : k === 1 ? bp : k === 2 ? c0 : mixSv[m] * 8 + bp) * nIn;
                mixSet[m] = wb;
                let dot = 0;
                for (let j = 0; j < nIn; j++) dot = (dot + ((MW[wb + j] * ST[j]) >> 8)) | 0;
                d = dot >> 8;
                d = d < -2047 ? -2047 : d > 2047 ? 2047 : d;
                mixD[m] = d;
                if (wantStats && m === 0) for (let j = 0; j < nIn; j++) { const c = MW[wb + j] * ST[j]; infl[j] += c < 0 ? -c : c; }
            }
            if (NM === 2) {
                d = (((MW[W2 + bp * 2] * mixD[0]) >> 8) + ((MW[W2 + bp * 2 + 1] * mixD[1]) >> 8)) >> 8;
                d = d < -2047 ? -2047 : d > 2047 ? 2047 : d;
            }
            let p16 = SQUASH16[d + 2048];
            const pMix = p16;
            // ---- refine
            for (let a = 0; a < NA; a++) {
                const cx = aEnd[a] > aStart[a] ? (Math.imul(aHash[a] + c0, 0x9E3779B1) >>> 16) & aMask[a] : c0;
                const s = STRETCH[p16 >> 4] + 2048, lo = s >> 7, w = s & 127, idx = cx * 33 + lo, T = aTab[a];
                const pa = (T[idx] * (128 - w) + T[idx + 1] * w) >> 7;
                aIdx[a] = idx + (w >> 6);
                p16 = (p16 * (4 - aW[a]) + pa * aW[a] + 2) >> 2;
            }
            p16 = p16 < 1 ? 1 : p16 > 65535 ? 65535 : p16;

            // ---- code one bit
            const r = (x2 - x1) | 0, xmid = (x1 + Math.imul(r >>> 16, p16) + (Math.imul(r & 0xffff, p16) >>> 16)) | 0;
            const y = enc ? (cb >> bit) & 1 : ((xd ^ HALF) <= (xmid ^ HALF) ? 1 : 0);      // unsigned compare
            if (y) x2 = xmid; else x1 = (xmid + 1) | 0;
            while (((x1 ^ x2) & -16777216) === 0) {
                if (enc) {
                    if (op === out.length) { const bigger = new Uint8Array(out.length * 2); bigger.set(out); out = bigger; }
                    out[op++] = x2 >>> 24;
                } else xd = (xd << 8) | (ip < input.length ? input[ip++] : 0);
                x1 = x1 << 8; x2 = (x2 << 8) | 255;
            }
            if (wantCosts) cost += COST12[(y ? p16 : 65536 - p16) >> 4];

            // ---- learn
            const yy = y << 22;
            for (let q = 0; q < KC; q++) {
                const si = cBase[q] + node, lim = cLimit[q];
                let s = TAB[si];
                const pn = s & 1023;
                s = pn < lim ? (s + 1) | 0 : (s & -1024) | lim;
                TAB[si] = (s + (Math.imul((yy - (s >>> 10)) >> 3, DT[pn]) & -1024)) | 0;
            }
            for (let q = 0; q < KM; q++) if (mOk[q]) {
                if (((mExp[q] >> bit) & 1) !== y) mOk[q] = 0;
                const si = mSlot[q];
                let s = TAB[si];
                const pn = s & 1023;
                s = pn < 1023 ? (s + 1) | 0 : s;
                TAB[si] = (s + (Math.imul((yy - (s >>> 10)) >> 3, DT[pn]) & -1024)) | 0;
            }
            for (let m = 0; m < NM; m++) {
                const e12 = (y << 12) - (SQUASH16[mixD[m] + 2048] >> 4);
                if (e12 > -SKIP && e12 < SKIP) continue;          // already (almost) right: nothing worth learning
                const err = e12 * mixLr[m], wb = mixSet[m];
                for (let j = 0; j < nIn; j++) {
                    const nw = MW[wb + j] + ((ST[j] * err + 8192) >> 14);
                    MW[wb + j] = nw > 524287 ? 524287 : nw < -524287 ? -524287 : nw;
                }
            }
            if (NM === 2) {
                const err = ((y << 12) - (pMix >> 4)) * 2;
                for (let q = 0; q < 2; q++) {
                    const nw = MW[W2 + bp * 2 + q] + ((mixD[q] * err + 8192) >> 14);
                    MW[W2 + bp * 2 + q] = nw > 524287 ? 524287 : nw < -524287 ? -524287 : nw;
                }
            }
            for (let a = 0; a < NA; a++) { const T = aTab[a], k = aIdx[a]; T[k] += ((y ? 65535 : 0) - T[k]) >> aRate[a]; }
            // a match that just mispredicted is silent for the rest of the byte — but only
            // AFTER the mixer has been charged for having listened to it on this bit
            for (let q = 0; q < KM; q++) if (!mOk[q]) { ST[KC + 2 * q] = 0; ST[KC + 2 * q + 1] = 0; }
            c0 = (c0 << 1) | y; node = (node << 1) | y;
        }

        // ---------- the byte is known: rebuild the stream, update histories
        const cbyte = c0 & 255;
        R[i] = cbyte;
        if (sb < 0) X[i] = cbyte;
        else if (W === 1) X[i] = (curPred + cbyte) & 255;
        else if (sb === 0) { rhi = cbyte; X[i] = ((curPred + (cbyte << 8)) & 0xffff) >> 8; }
        else { const x16 = (curPred + ((rhi << 8) | cbyte)) & 0xffff; X[i - 1] = x16 >> 8; X[i] = x16 & 255; }
        if (wantCosts) { const q = Math.round(cost * 8); costs[i] = q > 255 ? 255 : q; }

        const c = X[i];
        G[0] = (i > 0 && c === X[i - 1]) ? G[0] + 1 : 1;
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c >= 128) G[1] = Math.imul(G[1] + (c | 32) + 1, 0x2F0B4B87) | 1;
        else if (G[1] !== 0) { G[2] = G[1]; G[1] = 0; }
        if (c === 10) { G[4] = G[3]; G[3] = i + 1; }

        for (let q = 0; q < KM; q++) {
            const M = W === 1 ? X : R, L = mMin[q];
            if (mLen[q] > 0) { if (M[mPtr[q]] === M[i]) { if (mLen[q] < 65535) mLen[q]++; mPtr[q]++; } else mLen[q] = 0; }
            if (i + 1 >= L) {
                let h = 0;
                for (let k = 0; k < L; k++) h = Math.imul(h + M[i - k] + 1, 0x2F0B4B87);
                h = (h ^ (h >>> 15)) >>> (32 - mHB[q]);
                const HT = mHT[q];
                if (mLen[q] === 0) {
                    const cand = HT[h];
                    if (cand > 0) {
                        let l = 0;
                        while (l < 48 && cand - 1 - l >= 0 && M[cand - 1 - l] === M[i - l]) l++;
                        if (l >= L) { mLen[q] = l; mPtr[q] = cand; }
                    }
                }
                HT[h] = i + 1;
            }
        }
    }
    if (!enc) return { X };
    if (op + 4 > out.length) { const bigger = new Uint8Array(op + 4); bigger.set(out.subarray(0, op)); out = bigger; }
    out[op++] = x1 >>> 24; out[op++] = (x1 >>> 16) & 255; out[op++] = (x1 >>> 8) & 255; out[op++] = x1 & 255;
    let influence = null;
    if (wantStats) {
        let tot = 0;
        for (let j = 0; j < nIn - 1; j++) tot += infl[j];
        influence = new Array(K).fill(0);
        for (let q = 0; q < KC; q++) influence[ctxIdx[q]] = tot > 0 ? infl[q] / tot : 0;
        for (let q = 0; q < KM; q++) influence[matIdx[q]] = tot > 0 ? (infl[KC + 2 * q] + infl[KC + 2 * q + 1]) / tot : 0;
    }
    return { out, outLen: op, costs, influence, cum, X };
}

// ---------------------------------------------------------- whole pipeline
function applyPre(data, pre) {
    let s = data;
    const aux = [];
    for (const p of pre) {
        if (p === 'bwt') { const r = bwtForward(s); s = r.stream; aux.push(r.primaries); }
        else s = mtfForward(s);
    }
    return { stream: s, aux };
}
function undoPre(stream, pre, aux) {
    let s = stream, ai = aux.length;
    for (let k = pre.length - 1; k >= 0; k--) s = pre[k] === 'bwt' ? bwtInverse(s, aux[--ai]) : mtfInverse(s);
    return s;
}
// 16-bit samples are coded high byte first (coarse before fine). Swapping the
// pairs is its own inverse, so the same function maps both ways.
function swapPairs(stream, W, OFF) {
    if (W !== 2) return stream;
    const out = Uint8Array.from(stream);
    for (let i = OFF; i + 1 < out.length; i += 2) { const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t; }
    return out;
}
// magic · length · table-size limit · the file's shape · the algorithm · BWT rows · coded bits
function buildHeader(g, n, aux, maxBits, sh) {
    const gb = packGenome(g), w = new VarWriter();
    for (const m of MAGIC) w.a.push(m);
    w.u(n); w.u(maxBits); w.u(sh.p); w.u(sh.S); w.u(sh.s16 | sh.off16 << 1 | sh.texty << 2); w.u(gb.length);
    for (const b of gb) w.a.push(b);
    for (const prim of aux) { w.u(prim.length); for (const p of prim) w.u(p); }
    return Uint8Array.from(w.a);
}
function preKey(g) { return g.pre.join('>'); }

// opt: { shape, costs, stats, maxBits, checkpoints, abortAbove, preCache: Map, sizeOnly }
// `shape` is what analyze.js found out about THIS file ({ p, S, s16, off16, texty });
// without it every structure-relative clue falls back to plain byte distances.
function compress(data, genome, opt) {
    opt = opt || {};
    const g = normalize(genome), n = data.length, key = preKey(g);
    let pre = opt.preCache ? opt.preCache.get(key) : null;
    if (!pre) { pre = applyPre(data, g.pre); if (opt.preCache) opt.preCache.set(key, pre); }
    const maxBits = Math.min(24, Math.max(12, opt.maxBits || 22)), sh = normShape(opt.shape), ff = frontFor(g, sh);
    const coded = swapPairs(pre.stream, ff.W, ff.OFF), res = runModel(g, n, coded, true, null, 0, Object.assign({}, opt, { maxBits, shape: sh }));
    if (res.aborted) return res;
    const header = buildHeader(g, n, pre.aux, maxBits, sh), size = header.length + res.outLen;
    const ret = { size, headerSize: header.length, cum: res.cum, influence: res.influence, genome: g, costs: null, costsMapped: false };
    if (res.costs) {
        ret.costs = swapPairs(res.costs, ff.W, ff.OFF);
        ret.costsMapped = !g.pre.includes('bwt');      // after a BWT, position i is no longer byte i of the file
    }
    if (!opt.sizeOnly) {
        const bytes = new Uint8Array(size);
        bytes.set(header); bytes.set(res.out.subarray(0, res.outLen), header.length);
        ret.bytes = bytes;
    }
    return ret;
}
function measure(data, genome, opt) {
    const o = Object.assign({}, opt || {}, { sizeOnly: true });
    return compress(data, genome, o);
}
function readHeader(bytes) {
    for (let k = 0; k < 4; k++) if (bytes[k] !== MAGIC[k]) throw new Error('not a CEv2 file');
    const r = new VarReader(bytes, 4), n = r.u(), maxBits = r.u(), p = r.u(), S = r.u(), fl = r.u(), glen = r.u(), u = unpackGenome(bytes, r.p);
    if (maxBits < 12 || maxBits > 24 || p < 1 || p > 255 || S > MAX_OFFSET || fl > 7) throw new Error('corrupt header');
    const shape = { p, S, s16: fl & 1, off16: (fl >> 1) & 1, texty: (fl >> 2) & 1 };
    if (u.end !== r.p + glen) throw new Error('corrupt genome block');
    r.p = u.end;
    const aux = [];
    for (const p of u.genome.pre) if (p === 'bwt') { const cnt = r.u(), prim = []; for (let k = 0; k < cnt; k++) prim.push(r.u()); aux.push(prim); }
    return { n, maxBits, shape, genome: u.genome, aux, payload: r.p };
}
function decompress(bytes) {
    const h = readHeader(bytes), ff = frontFor(h.genome, h.shape), res = runModel(h.genome, h.n, null, false, bytes, h.payload, { maxBits: h.maxBits, shape: h.shape });
    return undoPre(swapPairs(res.X, ff.W, ff.OFF), h.genome.pre, h.aux);
}

return {
    compress, measure, decompress, readHeader, normalize, genomeKey, packGenome, unpackGenome, applyPre, undoPre,
    suffixArray, bwtForward, bwtInverse, mtfForward, mtfInverse, normShape, resolveOff, frontFor,
    LIMITS, LRS, TERM_KINDS, SEL_KINDS,
    MAX: { experts: MAX_EXPERTS, terms: MAX_TERMS, taps: MAX_TAPS, apms: MAX_APMS, mixers: MAX_MIXERS, period: MAX_PERIOD, offset: MAX_OFFSET, ord: MAX_ORD, minLen: MAX_MINLEN }
};
}

(function (root) {
    const api = CE_CODEC_FACTORY();
    root.CE = root.CE || {};
    root.CE.codec = api;
    root.CE.codecSource = CE_CODEC_FACTORY.toString();
    if (typeof module !== 'undefined' && module.exports) module.exports = root.CE;
})(typeof self !== 'undefined' ? self : globalThis);
