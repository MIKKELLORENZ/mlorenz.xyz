#!/usr/bin/env node
/* test_headless.js — `node test_headless.js` (add --fast to skip the slow ones).

   The one property everything else rests on: ANY genome the search can produce must
   decompress to exactly the bytes it was given, on a file of ANY shape. Section 4
   fuzzes that with hundreds of random designs; the rest pins down the parts (suffix
   sorting, BWT, structure-relative offsets, header, analyser, mutation operators, the
   GA, the worker pool, generalist scoring, save-and-resume) and checks that the corpus
   is what corpus_meta.js says it is. */
'use strict';
const zlib = require('zlib');
const CE = require('./codec.js');
require('./analyze.js'); require('./genome.js'); require('./evolution.js'); require('./pool.js'); require('./run.js');
const { loadCorpus, loadDataset, META } = require('./corpus_node.js');
const codec = CE.codec, G = CE.genome, FAST = process.argv.includes('--fast');

let passed = 0, failed = 0;
const fails = [];
function section(name) { console.log('\n' + name); }
function ok(cond, name, detail) {
    if (cond) { passed++; console.log('  ✓ ' + name); }
    else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '   → ' + detail : '')); }
}
const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; CRC[n] = c; }
function crc32(d) { let c = -1; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function same(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function roundTrip(data, genome, shape) { const r = codec.compress(data, genome, { shape }); return { r, good: same(codec.decompress(r.bytes), data) }; }
const drain = async pool => { for (let k = 0; k < 400 && (pool.examBusy || pool.examWaiting.size); k++) await new Promise(r => setTimeout(r, 50)); };

// ---------------------------------------------------------- synthetic data
const rng = G.makeRng(12345);
function textLike(n) { const words = ['the', 'cat', 'sat', 'on', 'a', 'mat', 'and', 'purred', 'loudly', 'while', 'compression', 'evolved', '\n', 'Alice', 'said', '"oh!"']; let s = ''; while (s.length < n) s += rng.pick(words) + ' '; return Uint8Array.from(Buffer.from(s.slice(0, n))); }
function imageLike(w, h) { const d = new Uint8Array(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) d[(y * w + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(128 + 70 * Math.sin(x / 9 + c) + 50 * Math.cos(y / 7) + (rng() - 0.5) * 12))); return d; }
function audioLike(frames, ch) { const d = new Uint8Array(frames * ch * 2); for (let f = 0; f < frames; f++) for (let c = 0; c < ch; c++) { const v = Math.round(9000 * Math.sin(f / 11 + c) + 2500 * Math.sin(f / 3.1) + (rng() - 0.5) * 300) & 0xffff; d[(f * ch + c) * 2] = v & 255; d[(f * ch + c) * 2 + 1] = v >> 8; } return d; }
function randomBytes(n) { const d = new Uint8Array(n); for (let i = 0; i < n; i++) d[i] = rng.int(0, 255); return d; }
function runs(n) { const d = new Uint8Array(n); let v = 0; for (let i = 0; i < n; i++) { if (rng.chance(0.02)) v = rng.int(0, 3); d[i] = v; } return d; }

// ---------------------------------------------------------------- 1. sorting
section('1. suffix sorting and the Burrows–Wheeler transform');
function naiveSA(s) { const n = s.length, idx = Array.from({ length: n }, (_, i) => i); const str = i => Buffer.from(s.subarray(i)).toString('latin1'); return idx.sort((a, b) => (str(a) < str(b) ? -1 : 1)); }
{
    let good = true;
    for (let t = 0; t < 60 && good; t++) {
        const n = rng.int(1, 60), alpha = rng.pick([1, 2, 3, 26, 256]), s = new Uint8Array(n);
        for (let i = 0; i < n; i++) s[i] = rng.int(0, alpha - 1) + (alpha <= 26 ? 97 : 0);
        good = same(Array.from(codec.suffixArray(s, n)), naiveSA(s));
    }
    ok(good, 'suffix array equals a naive sort on 60 random strings (incl. unary and binary alphabets)');
    const cases = { empty: new Uint8Array(0), one: Uint8Array.from([7]), two: Uint8Array.from([1, 1]), banana: Uint8Array.from(Buffer.from('banana')), zeros: new Uint8Array(5000), text: textLike(20000), random: randomBytes(9000), runs: runs(30000) };
    for (const [name, d] of Object.entries(cases)) { const f = codec.bwtForward(d); ok(same(codec.bwtInverse(f.stream, f.primaries), d), 'BWT round trip: ' + name + ' (' + d.length + ' bytes)'); }
    const b = codec.bwtForward(Uint8Array.from(Buffer.from('banana')));
    ok(Buffer.from(b.stream).toString() === 'annbaa' && b.primaries[0] === 4, 'BWT("banana") = "annbaa", end marker in row 4', Buffer.from(b.stream).toString() + ' / ' + b.primaries[0]);
    ok(same(codec.mtfInverse(codec.mtfForward(cases.text)), cases.text) && same(codec.mtfInverse(codec.mtfForward(cases.random)), cases.random), 'move-to-front round trip');
    let threw = false; try { codec.bwtInverse(Uint8Array.from([1, 2, 3]), [9]); } catch (e) { threw = true; }
    ok(threw, 'a corrupt BWT index is rejected instead of walking out of bounds');
    if (!FAST) {
        const big = new Uint8Array((1 << 22) + 70000); for (let i = 0; i < big.length; i++) big[i] = (i * 7 + (i >> 9)) & 63;
        const t0 = Date.now(), f = codec.bwtForward(big), back = codec.bwtInverse(f.stream, f.primaries);
        ok(f.primaries.length === 2 && same(back, big), 'BWT across a block boundary (4.3 MB, two blocks) — ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
    }
}

// ----------------------------------------------------------- 2. genome hygiene
section('2. genomes are always valid, offsets are structure-relative');
const CTX = {
    image: { n8: true, n16: false, hasRows: true, hasUnits: true, texty: false, kind: 'image', engages: { front8: true, front16: false } },
    audio: { n8: false, n16: true, hasRows: false, hasUnits: true, texty: false, kind: 'audio', engages: { front8: false, front16: true } },
    text: { n8: false, n16: false, hasRows: false, hasUnits: false, texty: true, kind: 'text', engages: { front8: false, front16: false } },
    mixed: { n8: true, n16: true, hasRows: true, hasUnits: true, texty: true, kind: 'mixed', engages: { front8: true, front16: true } }
};
{
    const junk = [null, 42, 'x', {}, { experts: 'no' }, { experts: [{ k: 'ctx', terms: [{ t: 'x', o: -5, q: 99 }, { t: 'x', o: [9, 99, -99] }, { t: 'nope' }, { t: 'lin', taps: [[[0, 1, 0], 0]] }] }], mixers: [{ sel: { k: 'term' } }], apms: [{}, {}, {}, {}] }, { front8: { preds: 7 }, front16: 'yes', front: { w: 7 }, pre: ['bwt', 'bwt', 'zip', 'mtf'] }];
    let good = true, detail = '';
    for (const j of junk) { const g = codec.normalize(j); if (!g.experts.length || !g.mixers.length || codec.genomeKey(codec.normalize(g)) !== codec.genomeKey(g)) { good = false; detail = JSON.stringify(j); } }
    ok(good, 'normalize() turns junk into a valid genome and is idempotent', detail);
    ok(codec.normalize({ front8: { preds: [{}, {}, {}] } }).front8 === null, 'an 8-bit predictor with no taps is canonicalised to "no predictor"');
    ok(codec.normalize({ front16: { preds: [{}] } }).front16 !== null, 'a 16-bit predictor with no taps is kept (it still reorders the bytes)');
    ok(JSON.stringify(codec.normalize({ experts: [{ k: 'ctx', terms: [{ t: 'x', o: [0, -2, 0] }] }] }).experts[0].terms[0].o) === '[0,0,1]', 'an offset that could only ever point into the future is repaired');
    const cat = { p: 3, S: 2208 }, wide = { p: 3, S: 12000 }, stereo = { p: 4, S: 0 }, text = { p: 1, S: 0 };
    const R = (o, sh) => codec.resolveOff(o, codec.normShape(sh));
    ok(R([1, 0, 0], cat) === 2208 && R([1, 1, 0], cat) === 2211 && R([1, -1, 0], cat) === 2205 && R([0, 1, 0], cat) === 3 && R([0, 0, 1], cat) === 1, '"above / above-left / above-right / left / previous channel" resolve to 2208 / 2211 / 2205 / 3 / 1 on the cat');
    ok(R([1, 0, 0], wide) === 12000 && R([0, 1, 0], stereo) === 4 && R([0, 2, 0], stereo) === 8, 'the SAME offsets mean 12000 on a 4000-pixel image, and one / two frames back in stereo audio');
    ok(R([1, 0, 0], text) === 0 && R([0, -1, 2], { p: 8, S: 0 }) === 0 && R([0, 1, 0], text) === 1, 'a clue about rows says nothing on a file without rows (and units fall back to bytes)');
    ok(codec.frontFor({ front8: {}, front16: {} }, codec.normShape({ p: 4, s16: 1 })).W === 2 && codec.frontFor({ front8: {}, front16: null }, codec.normShape({ p: 4, s16: 1 })).front === null && codec.frontFor({ front8: {}, front16: {} }, codec.normShape({ texty: 1 })).front === null && codec.frontFor({ front8: {} }, codec.normShape({ p: 3, S: 300 })).W === 1, 'the 16-bit predictor engages only on 16-bit files, the 8-bit one only on other gridded non-text data');
    good = true;
    for (let t = 0; t < 400 && good; t++) {
        const ctx = CTX[['image', 'audio', 'text', 'mixed'][t % 4]];
        let g = G.random(rng, ctx); for (let k = 0; k < 6; k++) { const m = G.mutate(g, rng, ctx); if (m) g = m.genome; }
        const u = codec.unpackGenome(codec.packGenome(g), 0);
        good = codec.genomeKey(u.genome) === codec.genomeKey(g);
        if (!good) detail = JSON.stringify(g);
    }
    ok(good, '400 random genomes: pack → unpack is the identity', detail);
    const big = G.random(rng, CTX.mixed); ok(codec.packGenome(big).length < 400, 'a genome is tens of bytes as a header (' + codec.packGenome(big).length + ')');
}

// ------------------------------------------------------------- 3. round trips
section('3. hand-built designs round-trip on every kind of data');
const IW = 40, IMG = imageLike(IW, 30), AUD = audioLike(3000, 2), TXT = textLike(7000), RND = randomBytes(3000), RUN = runs(6000);
const SH = { image: { p: 3, S: IW * 3 }, audio: { p: 4, s16: 1 }, 'audio, shifted': { p: 4, s16: 1, off16: 1 }, text: { texty: 1 }, none: {} };
const W = [0, 1, 0], N = [1, 0, 0], NW = [1, 1, 0], P1 = [0, 0, 1], med = { taps: [[W, 1], [N, 1], [NW, -1]], shift: 0, clamp: 1 };
const DESIGNS = {
    'order-0': {},
    'PPM-like (orders 1-4 + word + match, 2 mixers, 2 APMs)': { experts: [{ k: 'ctx', terms: [] }, { k: 'ctx', terms: [{ t: 'ord', n: 1 }] }, { k: 'ctx', terms: [{ t: 'ord', n: 2 }] }, { k: 'ctx', terms: [{ t: 'ord', n: 4 }] }, { k: 'ctx', terms: [{ t: 'word', n: 1 }] }, { k: 'ctx', terms: [{ t: 'col' }, { t: 'above' }] }, { k: 'match', minLen: 5 }], mixers: [{ sel: { k: 'c0' }, lr: 5 }, { sel: { k: 'term', term: { t: 'ord', n: 1 } }, lr: 3 }], apms: [{ terms: [], rate: 6, w: 2 }, { terms: [{ t: 'ord', n: 2 }], rate: 7, w: 1 }] },
    'bzip2-like (BWT + MTF + order-0/1 + run)': { pre: ['bwt', 'mtf'], experts: [{ k: 'ctx', terms: [] }, { k: 'ctx', terms: [{ t: 'ord', n: 1 }] }, { k: 'ctx', terms: [{ t: 'run' }, { t: 'x', o: P1, q: 8 }] }] },
    'JPEG-LS-like (MED predictor + residual contexts)': { front8: { preds: [med, med, med] }, experts: [{ k: 'ctx', terms: [{ t: 'phase', u: 1 }] }, { k: 'ctx', terms: [{ t: 'r', o: W, m: 1 }, { t: 'r', o: N, m: 1 }, { t: 'p', q: 4 }] }, { k: 'ctx', terms: [{ t: 'lin', taps: [[W, 1], [NW, -1]], shift: 0, rel: 0, m: 1, q: 6 }, { t: 'lin', taps: [[W, 1], [N, 1]], shift: 1, rel: 1, m: 2, q: 5 }] }, { k: 'match', minLen: 3 }], mixers: [{ sel: { k: 'term', term: { t: 'phase', u: 1 } }, lr: 4 }], apms: [{ terms: [{ t: 'p', q: 6 }], rate: 5, w: 3 }] },
    'FLAC-like (16-bit, 2·a − b per channel)': { front16: { preds: [{ taps: [[W, 2], [[0, 2, 0], -1]] }, { taps: [[W, 2], [[0, 2, 0], -1], [P1, 1], [[0, 1, 1], -1]], shift: 1 }] }, experts: [{ k: 'ctx', terms: [{ t: 'phase', u: 0, P: 2 }] }, { k: 'ctx', terms: [{ t: 'phase', u: 1 }, { t: 'r', o: P1, m: 0 }] }, { k: 'ctx', terms: [{ t: 'r', o: [0, 0, 2], m: 1 }, { t: 'r', o: W, m: 2 }] }, { k: 'match', minLen: 8 }] },
    'generalist (both predictors + text experts + column clue)': { front8: { preds: [med] }, front16: { preds: [{ taps: [[W, 2], [[0, 2, 0], -1]] }] }, experts: [{ k: 'ctx', terms: [] }, { k: 'ctx', terms: [{ t: 'ord', n: 2 }] }, { k: 'ctx', terms: [{ t: 'word', n: 0 }] }, { k: 'ctx', terms: [{ t: 'phase', u: 2 }, { t: 'r', o: N, m: 1 }] }, { k: 'ctx', terms: [{ t: 'phase', u: 1 }, { t: 'r', o: W, m: 1 }, { t: 'x', o: [2, -1, 1], q: 5 }] }, { k: 'match', minLen: 6 }], apms: [{ terms: [], rate: 6, w: 2 }] }
};
const DATA = [['image', IMG, SH.image], ['audio', AUD, SH.audio], ['text', TXT, SH.text], ['random', RND, SH.none], ['runs', RUN, SH.none], ['audio, odd length', AUD.subarray(0, 4999), SH.audio], ['audio, shifted by one byte', AUD.subarray(1, 5000), SH['audio, shifted']], ['image read as if it were audio', IMG, SH.audio], ['text given an image shape', TXT, SH.image], ['empty', new Uint8Array(0), SH.image], ['1 byte', Uint8Array.from([200]), SH.audio], ['3 bytes', Uint8Array.from([1, 2, 3]), SH.audio]];
for (const [dn, genome] of Object.entries(DESIGNS)) {
    let bad = '';
    const sizes = [];
    for (const [name, d, shape] of DATA) { const { r, good } = roundTrip(d, genome, shape); if (!good) bad += name + ' | '; if (d.length > 2000 && sizes.length < 5) sizes.push(name[0] + ':' + Math.round(100 * r.size / d.length) + '%'); }
    ok(!bad, dn + '   [' + sizes.join(' ') + ']', 'failed on: ' + bad);
}
{
    const size = (g, d, sh) => codec.measure(d, DESIGNS[g], { shape: sh }).size, names = Object.keys(DESIGNS), gen = 'generalist (both predictors + text experts + column clue)';
    const best = (d, sh) => Math.min(...names.filter(g => g !== gen).map(g => size(g, d, sh)));
    ok(size('JPEG-LS-like (MED predictor + residual contexts)', IMG, SH.image) === best(IMG, SH.image), 'among the specialists, the image design wins on the image');
    ok(size('FLAC-like (16-bit, 2·a − b per channel)', AUD, SH.audio) === best(AUD, SH.audio), 'among the specialists, the audio design wins on the audio');
    const rank = (d, sh) => names.map(g => size(g, d, sh)).sort((a, b) => a - b).indexOf(size(gen, d, sh));
    ok(rank(IMG, SH.image) <= 1 && rank(AUD, SH.audio) <= 1 && rank(TXT, SH.text) <= 2, 'the ONE generalist design is first or second on image and audio and top three on text');
    ok(size('JPEG-LS-like (MED predictor + residual contexts)', IMG, SH.none) > size('JPEG-LS-like (MED predictor + residual contexts)', IMG, SH.image) * 1.2, 'without the file’s shape the same design is lost (rows and units mean nothing) — the shape matters');
    ok(codec.measure(RND, {}).size < RND.length * 1.02 + 80, 'random bytes cost at most 2% + header (no blow-up)');
    const z = codec.measure(new Uint8Array(100000), {}).size; ok(z < 400, '100 KB of zeros shrinks to ' + z + ' bytes');
}

// ------------------------------------------------------------------- 4. fuzz
section('4. fuzz: every design the search can produce is lossless on every shape');
{
    const cases = [{ data: IMG, shape: SH.image, ctx: CTX.image }, { data: AUD.subarray(0, 5001), shape: SH.audio, ctx: CTX.audio }, { data: TXT.subarray(0, 5000), shape: SH.text, ctx: CTX.text }, { data: AUD.subarray(1, 4000), shape: SH['audio, shifted'], ctx: CTX.mixed }, { data: IMG.subarray(0, 3001), shape: { p: 5, S: 77 }, ctx: CTX.mixed }];
    const N_FUZZ = FAST ? 150 : 450, seenSpecies = new Set(), seenTerms = new Set();
    let bad = null, sizeMismatch = null, both = 0;
    const t0 = Date.now();
    for (let t = 0; t < N_FUZZ && !bad; t++) {
        const c = cases[t % cases.length];
        let g = t % 9 === 0 ? G.founder(G.SPECIES_ORDER[(t / 9 | 0) % 3], rng, c.ctx, { maxExperts: 12 }) : G.random(rng, c.ctx, { maxExperts: 12 });
        for (let k = rng.int(0, 10); k > 0; k--) { const m = G.mutate(g, rng, c.ctx, { maxExperts: 12 }); if (m) g = m.genome; }
        if (t % 7 === 3) g = G.crossover(g, G.random(rng, c.ctx), rng);
        seenSpecies.add(G.species(g)); for (const e of g.experts) for (const tm of e.terms || []) seenTerms.add(tm.t);
        if (g.front8 && g.front16) both++;
        const r = codec.compress(c.data, g, { shape: c.shape });
        if (!same(codec.decompress(r.bytes), c.data)) bad = { g, shape: c.shape };
        if (codec.measure(c.data, g, { shape: c.shape }).size !== r.bytes.length) sizeMismatch = g;
    }
    ok(!bad, N_FUZZ + ' random designs × image / odd-length audio / text / byte-shifted audio / a 5×77 grid all decode exactly (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)', bad && JSON.stringify(bad));
    ok(!sizeMismatch, 'measure() reports exactly the byte count compress() produces');
    ok(seenSpecies.size === 3, 'the fuzz reached all three families (' + [...seenSpecies].join(', ') + ')');
    ok(seenTerms.size >= 9 && both > 5, 'it used ' + seenTerms.size + ' of 10 kinds of clue, and ' + both + ' designs carried both predictors');
    const g = G.random(rng, CTX.image), a = codec.compress(IMG, g, { shape: SH.image }).bytes, b = codec.compress(IMG, g, { shape: SH.image }).bytes;
    ok(same(a, b), 'compression is deterministic (same design + same data → same bytes)');
}

// ---------------------------------------------------------- 5. format details
section('5. container, racing, cost map');
{
    const g = DESIGNS['JPEG-LS-like (MED predictor + residual contexts)'], r = codec.compress(IMG, g, { shape: SH.image, costs: true, stats: true });
    ok(Buffer.from(r.bytes.subarray(0, 4)).toString() === 'CEv2', 'files start with the magic "CEv2"');
    const h = codec.readHeader(r.bytes);
    ok(h.n === IMG.length && h.shape.p === 3 && h.shape.S === IW * 3 && codec.genomeKey(h.genome) === codec.genomeKey(codec.normalize(g)), 'the header alone restores the length, the file’s shape and the whole algorithm');
    let threw = 0; try { codec.decompress(Uint8Array.from([1, 2, 3, 4, 5])); } catch (e) { threw++; } try { codec.decompress(r.bytes.subarray(0, 9)); } catch (e) { threw++; }
    ok(threw === 2, 'foreign and truncated files are refused');
    const small = codec.compress(IMG, g, { shape: SH.image, maxBits: 14 });
    const big14 = codec.compress(TXT, DESIGNS['PPM-like (orders 1-4 + word + match, 2 mixers, 2 APMs)'], { maxBits: 12 });
    ok(codec.readHeader(small.bytes).maxBits === 14 && same(codec.decompress(small.bytes), IMG) && codec.readHeader(big14.bytes).maxBits === 12 && same(codec.decompress(big14.bytes), TXT) && big14.size !== codec.measure(TXT, DESIGNS['PPM-like (orders 1-4 + word + match, 2 mixers, 2 APMs)']).size, 'the table-size limit travels in the header (it changes the output, and the file decodes without being told)');
    let bits = 0; for (const c of r.costs) bits += c / 8;
    ok(r.costs.length === IMG.length && Math.abs(bits / 8 - (r.size - r.headerSize)) / r.size < 0.03, 'the per-byte cost map adds up to the payload (' + Math.round(bits / 8) + ' vs ' + (r.size - r.headerSize) + ' bytes)');
    ok(r.influence.length === 4 && Math.abs(r.influence.reduce((a, b) => a + b, 0) - 1) < 1e-6, 'expert influence shares sum to 1');
    ok(codec.compress(TXT, DESIGNS['bzip2-like (BWT + MTF + order-0/1 + run)'], { costs: true }).costsMapped === false, 'after a BWT the cost map is flagged as not position-true');
    const n = IMG.length, cps = [n >> 2, n >> 1, (n >> 2) * 3], full = codec.measure(IMG, g, { shape: SH.image, checkpoints: cps });
    ok(full.cum.length === 3 && full.cum[0] <= full.cum[1] && full.cum[1] <= full.cum[2] && full.cum[2] <= full.size, 'checkpoints report cumulative bytes at 25/50/75 %');
    const ab = codec.measure(IMG, {}, { checkpoints: cps, abortAbove: full.cum.map(c => c + 8) });
    ok(ab.aborted === true && ab.at === cps[0], 'a clearly worse design is abandoned at the first checkpoint');
    ok(!codec.measure(IMG, g, { shape: SH.image, checkpoints: cps, abortAbove: full.cum.map(c => c + 8) }).aborted, '… and the reference itself is not');
    const pc = new Map(); codec.measure(TXT, { pre: ['bwt'] }, { preCache: pc }); codec.measure(TXT, { pre: ['bwt'], experts: [{ k: 'ctx', terms: [{ t: 'ord', n: 1 }] }] }, { preCache: pc });
    ok(pc.size === 1, 'block transforms are computed once per worker and reused');
}

// ------------------------------------------------------------- 6. the corpus
section('6. the bundled corpus is what corpus_meta.js says');
const corpus = {};
for (const m of META) {
    const c = corpus[m.id] = loadCorpus(m.id);
    ok(crc32(c.data) === m.crc32 && c.data.length === m.bytes, m.id + ': ' + m.bytes + ' bytes, CRC-32 ' + m.crc32.toString(16) + ' — the bytes the references were measured on');
    // Node bundles Chromium's zlib, whose level 9 differs from GNU gzip's by a few per
    // cent in either direction, so this only catches a reference that is wildly off
    const gz = zlib.gzipSync(Buffer.from(c.data), { level: 9 }).length, ref = m.baselines.find(b => b.id === 'gzip').bytes;
    ok(gz > ref * 0.94 && gz < ref * 1.06, m.id + ': recorded gzip -9 (' + ref + ') is plausible next to Node’s own zlib (' + gz + ')');
}
{
    const total = META.reduce((s, m) => s + require('fs').statSync(require('path').join(__dirname, m.file)).size, 0);
    ok(total < 8 * 1048576, 'corpus on disk is ' + (total / 1048576).toFixed(2) + ' MB (budget: 8 MB)');
    const alice = corpus.alice.data, ent = corpus.alice.meta.baselines.find(b => b.id === 'entropy').bytes, o0 = codec.measure(alice, {}).size;
    ok(Math.abs(o0 - ent) / ent < 0.012, 'order-0 on Alice (' + o0 + ') lands on the zeroth-order entropy bound (' + ent + ')');
    if (!FAST) {
        const bz = corpus.alice.meta.baselines.find(b => b.id === 'bzip2').bytes, mine = codec.measure(alice, DESIGNS['bzip2-like (BWT + MTF + order-0/1 + run)']).size;
        ok(mine < bz * 1.04, 'the hand-built bzip2-like design (' + mine + ') is in bzip2’s league on Alice (' + bz + ')');
        const pp = corpus.alice.meta.baselines.find(b => b.id === 'ppmd').bytes, ppm = codec.measure(alice, DESIGNS['PPM-like (orders 1-4 + word + match, 2 mixers, 2 APMs)']).size;
        ok(ppm < pp * 1.06, 'the hand-built PPM-like design (' + ppm + ') is in PPMd’s league (' + pp + ')');
    }
}

// ---------------------------------------------------------------- 7. analyser
section('7. the analyser finds the structure nobody told it about');
{
    const a = {}; for (const id of Object.keys(corpus)) a[id] = CE.analyze.analyze(corpus[id].data);
    const shape = id => CE.analyze.shapeOf(a[id]);
    if (a.cat) { ok(shape('cat').p === 3 && shape('cat').S === 736 * 3 && !shape('cat').s16, 'cat: a unit is 3 bytes (a pixel), a row is 2208 (736 px)', JSON.stringify(shape('cat'))); ok(a.cat.shape && a.cat.shape.w === 736 && a.cat.shape.h === 456, 'cat: it even works out the picture is 736 × 456 × 3'); }
    if (a.guitar) ok(shape('guitar').s16 && shape('guitar').p === 4, 'guitar: 16-bit samples, two channels (4-byte frames)');
    if (a.meow) ok(shape('meow').s16 && shape('meow').p === 2, 'meow: 16-bit samples, ONE channel (2-byte frames) — bytes alone used to say four', JSON.stringify(shape('meow')));
    if (a.alice) ok(shape('alice').texty && shape('alice').p === 1 && shape('alice').S === 0, 'alice: text, no grid');
    ok(Object.keys(corpus).every(id => a[id].kind === corpus[id].kind), 'left to guess, the analyser names every bundled file correctly: ' + Object.keys(corpus).map(id => id + '=' + a[id].kind).join(' '));
    if (a.guitar) {
        const quiet = corpus.guitar.data.subarray(0, 200000), shifted = new Uint8Array(200001); shifted.set(quiet, 1);
        const q = CE.analyze.analyze(quiet), s = CE.analyze.analyze(shifted);
        ok(q.looks16 && q.off16 === 0 && s.looks16 && s.off16 === 1 && !a.cat.looks16 && !a.alice.looks16, 'a QUIET passage still reads as 16-bit, a one-byte header shift is noticed, photo and text are not mistaken for audio');
    }
    if (a.cat) {
        const smp = CE.analyze.buildSample(corpus.cat.data, 65536, a.cat);
        ok(!smp.whole && smp.sample.length <= 65536 && smp.sample.length % 2208 === 0 && smp.chunks.every(c => c[0] % 2208 === 0), 'cat sample: ' + smp.chunks.length + ' slices of whole rows from across the image');
        ok(CE.analyze.buildSample(corpus.cat.data, 0, a.cat).whole && CE.analyze.buildSample(TXT, 1 << 20, null).whole, '"whole file" and oversized samples return the data itself');
    }
    const mixed = CE.analyze.context(Object.values(a)), solo = CE.analyze.context([a.alice]);
    ok(mixed.n8 && mixed.n16 && mixed.hasRows && mixed.texty && mixed.kind === 'mixed' && !solo.n8 && !solo.n16 && !solo.hasRows, 'the mutation context of all five files offers every idea; for a lone text none of the numeric ones');
    let threw = false; try { for (const ctx of Object.values(CTX)) for (let t = 0; t < 120; t++) G.describe(G.random(rng, ctx), ctx); } catch (e) { threw = e; }
    ok(!threw, 'describe() explains 480 random designs in every vocabulary without throwing', String(threw && threw.stack));
}

// ------------------------------------------------------------- 8. evolution
section('8. the genetic algorithm (inline evaluation, no workers)');
(async function () {
    const data = imageLike(48, 40), info = CE.analyze.analyze(data); info.kind = 'image';
    const shape = CE.analyze.shapeOf(info), ctx = CE.analyze.context([info]);
    ok(shape.p === 3 && shape.S === 144, 'the synthetic image is analysed like a real one (unit 3, row 144)', JSON.stringify(shape));
    const n = data.length, cps = [n >> 2, n >> 1, (n >> 2) * 3];
    const evaluate = async jobs => jobs.map(j => { const r = codec.measure(data, j.genome, { shape, checkpoints: cps, abortAbove: j.caps }); return { size: r.size, cum: r.cum, aborted: !!r.aborted, ms: 1 }; });
    const evo = new CE.Evolution({ ctx, seed: 7, popSize: 24, survivors: 8, evaluate });
    await evo.step();
    const start = evo.champion.size;
    ok(evo.pop.length === 1 && codec.genomeKey(evo.champion.genome) === codec.genomeKey(G.minimal()), 'generation 0 is a single design: count the bytes (' + start + ' bytes)');
    for (let g = 0; g < (FAST ? 8 : 14); g++) await evo.step();
    ok(evo.champion.size < start * 0.8, evo.gen + ' generations: ' + start + ' → ' + evo.champion.size + ' bytes on a synthetic image (' + evo.evals + ' designs, ' + evo.aborted + ' raced out)');
    ok(evo.speciesLeaders().length === 3, 'three families alive side by side: ' + evo.speciesLeaders().map(s => s.species + ' ' + s.bestSize).join(', '));
    const again = new CE.Evolution({ ctx, seed: 7, popSize: 24, survivors: 8, evaluate });
    for (let g = 0; g <= evo.gen; g++) await again.step();
    ok(again.champion.key === evo.champion.key, 'the same seed reproduces the same champion');
    ok(evo.pop.every(i => i.genome.experts.length <= 8) && roundTrip(data, evo.champion.genome, shape).good, 'champion respects the expert limit and round-trips');

    // ------------------------------------------------------- 9. workers + run
    section('9. worker pool, run bookkeeping, save and resume (worker_threads)');
    const workerErrors = [];
    const pool = new CE.Pool({ workers: 2, onError: e => workerErrors.push(String(e)) });
    const events = { series: 0, champion: 0, log: 0 }, solo = { id: 'synthetic', parts: [{ id: 'img', data, info }] };
    const run = new CE.Run({ dataset: solo, pool, baselines: [{ id: 'x', name: 'half', pct: 50 }], settings: { sampleKB: 0, pop: 20, experts: 6, seed: 3 }, on: { series: () => events.series++, champion: () => events.champion++, log: () => events.log++ } });
    await run.prepare();
    for (let g = 0; g < 6; g++) await run.generation();
    await drain(pool);
    const c = run.champion;
    ok(c && c.size === codec.compress(data, c.genome, { shape }).bytes.length, 'an exam in a worker gives the same size as the main thread (' + (c && c.size) + ' bytes)');
    ok(c && c.verified === true && c.parts[0].verified === true, 'the champion was decoded in the worker and compared byte for byte');
    ok(c && c.parts[0].costs.length === data.length && c.parts[0].bytes.length === c.size, 'the exam returns the cost map and the downloadable file');
    const rec = run.record(), ser = Object.values(rec.series);
    ok(ser.length >= 1 && ser.every(s => s.some(e => e[2] === 1)) && JSON.parse(JSON.stringify(rec)).genome && rec.format === 'compression-evolution-run' && rec.dataset === 'synthetic' && rec.pop.length > 0, 'record(): every family line carries measured points; the record names its dataset, keeps the survivors and survives JSON');
    ok(events.series > 0 && events.champion > 0 && events.log > 0, 'the page would have been told: ' + JSON.stringify(events));
    const dec = await pool.decode(c.parts[0].bytes);
    ok(dec && same(dec.data, data) && codec.genomeKey(dec.genome) === codec.genomeKey(c.genome) && dec.shape.S === 144, 'a .cev file restores in the worker — algorithm and shape included');
    const bad = await pool.decode(Uint8Array.from([9, 9, 9, 9, 9, 9]));
    ok(bad && bad.error, 'a foreign file comes back as an error, not a crash');
    ok(workerErrors.length === 1 && /not a CEv2 file/.test(workerErrors[0]), 'and that was the only error any worker reported', workerErrors.join(' | '));

    // continuing a saved run (what "Load run", autosave and --resume do)
    const before = JSON.parse(JSON.stringify(rec)), hist = JSON.parse(JSON.stringify(rec));
    const cont = new CE.Run({ dataset: solo, pool, baselines: [{ id: 'x', name: 'nine tenths', pct: 90 }, { id: 'y', name: 'nothing', pct: 0.001 }], history: hist, settings: { sampleKB: 0, pop: 20, experts: 6, seed: 5 } });
    run.cancel();
    await cont.prepare();
    for (let g = 0; g < 3; g++) await cont.generation();
    await drain(pool);
    const after = cont.record();
    ok(Object.keys(before.families).length >= 2 && cont.seeds.length >= Object.keys(before.families).length + before.pop.length, 'a record carries the best design of every family (' + Object.keys(before.families).join(', ') + ') and the survivors; all of them seed the continued run');
    let kept = true, monotone = true;
    for (const sp of Object.keys(before.series)) {
        const a = before.series[sp], b = after.series[sp] || [];
        for (let i = 0; i < a.length; i++) if (!b[i] || b[i][0] !== a[i][0] || Math.abs(b[i][1] - a[i][1]) > 1e-9) kept = false;
        const floor = Math.min(...a.map(e => e[1]));
        for (let i = a.length; i < b.length; i++) if (b[i][1] > floor + 1e-6 || b[i][0] < before.gens) monotone = false;
    }
    ok(kept, 'the recorded lines survive the first generations of the continued run unchanged');
    ok(monotone && cont.gen() === before.gens + cont.evo.gen && after.evals > before.evals, 'new points only extend them — later generations, never above the recorded best; design counts carry on');
    ok(cont.champion && cont.champion.size <= before.size && cont.passed.has('x') && !cont.passed.has('y') && !cont.log.slice(before.log.length).some(l => /Passed nine/.test(l.headline)), 'the champion is at least as good, and milestones already passed are not announced twice');
    const orphan = pool.evaluate([{ genome: G.minimal() }, { genome: G.minimal() }, { genome: G.minimal() }, { genome: G.minimal() }]);
    pool.flush();
    const orphaned = await orphan;
    ok(orphaned.some(r => r.aborted) && orphaned.every(r => r.aborted || r.size > 0), 'flush() drops queued work of a cancelled run (in-flight jobs still answer)');
    cont.cancel();

    // ------------------------------------------------ 10. one design, many files
    section('10. the generalist: one design judged on several files at once');
    const mk = (id, d, kind) => { const inf = CE.analyze.analyze(d); inf.kind = kind; return { id, data: d, info: inf, meta: { baselines: [{ id: 'gzip', name: 'gzip', bytes: zlib.gzipSync(Buffer.from(d), { level: 9 }).length, how: '' }, { id: 'only-' + id, name: 'special', bytes: Math.round(d.length / 3), how: '' }] } }; };
    const multi = { id: 'all', parts: [mk('img', imageLike(60, 40), 'image'), mk('aud', audioLike(5000, 2), 'audio'), mk('txt', textLike(12000), 'text')] };
    const refs = CE.Run.baselines(multi.parts), gz = multi.parts.reduce((s, p) => s + p.meta.baselines[0].bytes / p.data.length, 0) / 3 * 100;
    ok(refs.length === 2 && Math.abs(refs.find(b => b.id === 'gzip').pct - gz) < 1e-9 && refs.find(b => b.id === 'toolbox') && !refs.some(b => /^only-/.test(b.id)), 'reference lines for several files: the mean ratio of tools that handle all of them, plus "best tool per file" — file-specific codecs are not averaged');
    const gen = new CE.Run({ dataset: multi, pool, baselines: refs, settings: { sampleKB: 0, pop: 24, experts: 8, seed: 9 } });
    await gen.prepare();
    ok(gen.multi && gen.nominal === 1e6 && gen.ctx.kind === 'mixed' && gen.ctx.n8 && gen.ctx.n16 && gen.ctx.texty, 'three files of three kinds: the score is a mean ratio on a nominal 1,000,000, and mutation may propose every kind of idea');
    for (let g = 0; g < (FAST ? 10 : 18); g++) await gen.generation();
    await drain(pool);
    const gc = gen.champion, byHand = gc.parts.reduce((s, q, i) => s + q.size / multi.parts[i].data.length, 0) / 3;
    ok(gc && gc.parts.length === 3 && Math.abs(gc.size - Math.round(1e6 * byHand)) <= 1 && Math.abs(gc.pct - 100 * byHand) < 1e-3, 'the champion’s score is the mean of its three per-file ratios (' + gc.parts.map((q, i) => multi.parts[i].id + ' ' + (100 * q.size / multi.parts[i].data.length).toFixed(1) + '%').join(', ') + ' → ' + gc.pct.toFixed(2) + '%)');
    const o0 = multi.parts.reduce((s, p) => s + codec.measure(p.data, {}, { shape: CE.analyze.shapeOf(p.info) }).size / p.data.length, 0) / 3 * 100;
    ok(gc.pct < o0 * 0.85, 'one design improved on ALL of them together: ' + o0.toFixed(1) + '% → ' + gc.pct.toFixed(1) + '% mean');
    ok(gc.parts.every((q, i) => same(codec.decompress(q.bytes), multi.parts[i].data)) && new Set(gc.parts.map(q => JSON.stringify(codec.readHeader(q.bytes).shape))).size === 3 && new Set(gc.parts.map(q => codec.genomeKey(codec.readHeader(q.bytes).genome))).size === 1, 'three .cev files, three different shapes in their headers, ONE algorithm — and each restores exactly');
    const grec = gen.record();
    ok(grec.dataset === 'all' && grec.perFile.length === 3 && grec.files.length === 3, 'the generalist’s record lists its files and the per-file result');
    // a specialist that starts from the generalist instead of from nothing
    const spec = new CE.Run({ dataset: { id: 'img', parts: [multi.parts[0]] }, pool, seeds: [gc.genome], settings: { sampleKB: 0, pop: 20, experts: 8, seed: 2 } });
    gen.cancel();
    await spec.prepare(); await spec.generation(); await drain(pool);
    ok(spec.champion && spec.champion.size <= gc.parts[0].size, 'a single-file run seeded with the generalist starts where the generalist stood on that file (' + gc.parts[0].size + ' → ' + (spec.champion && spec.champion.size) + ' bytes), not from scratch');
    spec.cancel(); pool.terminate();

    if (!FAST) {
        section('11. one design on the whole real corpus');
        const g = DESIGNS['generalist (both predictors + text experts + column clue)'], ds = loadDataset('all', CE.analyze.analyze);
        let mean = 0, good = true;
        const line = [];
        for (const p of ds.parts) { const sh = CE.analyze.shapeOf(p.info), r = codec.compress(p.data, g, { shape: sh }); good = good && same(codec.decompress(r.bytes), p.data); mean += r.size / p.data.length; line.push(p.id + ' ' + (100 * r.size / p.data.length).toFixed(1) + '%'); }
        const xz = CE.Run.baselines(ds.parts).find(b => b.id === 'xz').pct;
        ok(good, 'a hand-built generalist round-trips all five bundled files (' + line.join(', ') + ')');
        ok(100 * mean / ds.parts.length < xz, 'and its mean ratio (' + (100 * mean / ds.parts.length).toFixed(2) + '%) is ahead of xz -9e’s (' + xz.toFixed(2) + '%) — before any evolution');
    }

    console.log('\n' + (failed ? '✗ ' + failed + ' FAILED' : '✓ all passed') + ' — ' + passed + ' checks' + (failed ? ': ' + fails.join(' | ') : ''));
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
