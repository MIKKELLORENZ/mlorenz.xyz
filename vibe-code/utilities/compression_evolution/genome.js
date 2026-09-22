/* genome.js — how compressor designs are created, varied, named and explained.

   DOM-free. `ctx` is what the analyser learned about the file(s) being trained on
   (analyze.js → context()): { n8, n16, hasRows, hasUnits, texty, kind, engages }. It
   only steers which IDEAS mutation proposes ("look one row up" is pointless to suggest
   when no file has rows); whether an idea is good is decided by the byte count alone.

   Offsets are structure-relative triples [rows, units, bytes] (see codec.js), so every
   operator here works in those terms and a design means the same thing on a 736-pixel
   cat, a 4000-pixel panorama and a stereo recording. */

(function (root) {
'use strict';
const CE = root.CE = root.CE || {};
const codec = CE.codec, MAX = codec.MAX;

// ------------------------------------------------------------------ random
function makeRng(seed) {
    let a = (seed >>> 0) || 0x9E3779B9;
    const f = function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
    f.pick = arr => arr[Math.floor(f() * arr.length)];
    f.chance = p => f() < p;
    return f;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function weighted(rng, table) {
    let tot = 0;
    for (const [w] of table) tot += w;
    let r = rng() * tot;
    for (const [w, v] of table) { r -= w; if (r <= 0) return v; }
    return table[table.length - 1][1];
}

// ----------------------------------------------------------------- offsets
function pickOffset(rng, ctx) {
    const r = rng();
    if (ctx.hasRows && r < 0.3) return [rng.chance(0.85) ? 1 : 2, rng.pick([0, 0, 0, 1, -1, 2, -2]), rng.pick([0, 0, 0, 0, 1, -1])];
    if (ctx.hasUnits && r < 0.65) return [0, rng.pick([1, 1, 1, 2, 2, 3, 4]), rng.pick([0, 0, 0, 0, 1, -1])];
    return [0, 0, rng.chance(0.8) ? rng.int(1, 8) : rng.int(1, 32)];
}
function nudgeOffset(rng, o, ctx) {
    if (rng.chance(0.15)) return pickOffset(rng, ctx);
    const v = o.slice(), k = ctx.hasRows ? rng.int(0, 2) : ctx.hasUnits ? rng.int(1, 2) : 2;
    v[k] += rng.chance(0.5) ? 1 : -1;
    return v;
}
function addOff(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sameOff(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

// ------------------------------------------------------------------- terms
function randomLin(rng, ctx) {
    const a = pickOffset(rng, ctx);
    let b = pickOffset(rng, ctx);
    if (sameOff(a, b)) b = addOff(a, [0, ctx.hasUnits ? 1 : 0, ctx.hasUnits ? 0 : 1]);
    const kind = rng.int(0, 3);
    if (kind === 0) return { t: 'lin', taps: [[a, 1], [b, 1]], shift: 1, rel: rng.chance(0.5) ? 1 : 0, m: rng.chance(0.5) ? 1 : 0, q: rng.int(4, 7) };
    if (kind === 1) return { t: 'lin', taps: [[a, 1], [b, 1], [addOff(a, b), -1]], shift: 0, rel: rng.chance(0.6) ? 1 : 0, m: rng.chance(0.6) ? 1 : 0, q: rng.int(4, 7) };
    if (kind === 2) return { t: 'lin', taps: [[a, 1], [b, -1]], shift: 0, rel: 0, m: rng.chance(0.8) ? 1 : 2, q: 6 };
    return { t: 'lin', taps: [[a, 2], [addOff(a, a), -1]], shift: 0, rel: rng.chance(0.5) ? 1 : 0, m: rng.chance(0.5) ? 1 : 0, q: rng.int(4, 7) };
}
function hasFront(g) { return !!(g.front8 || g.front16); }
function randomTerm(rng, ctx, g) {
    const front = hasFront(g), structured = ctx.hasUnits || ctx.hasRows, bwt = g.pre.includes('bwt');
    const kind = weighted(rng, [
        [bwt ? 1.5 : 3, 'x'], [front ? 3 : 0, 'r'], [front ? 0.8 : 0, 'p'], [structured && !bwt ? 1.2 : 0.1, 'lin'],
        [ctx.texty || bwt ? 3 : 1.2, 'ord'], [ctx.texty && !bwt ? 0.8 : 0.05, 'word'], [structured && !bwt ? 1.2 : 0.1, 'phase'],
        [bwt ? 1.5 : 0.4, 'run'], [ctx.texty && !bwt ? 0.4 : 0.03, 'col'], [ctx.texty && !bwt ? 0.4 : 0.03, 'above']
    ]);
    switch (kind) {
        case 'x': return { t: 'x', o: pickOffset(rng, ctx), q: rng.chance(0.5) ? 8 : rng.int(2, 7) };
        case 'r': return { t: 'r', o: pickOffset(rng, ctx), m: weighted(rng, [[1, 0], [2, 1], [1, 2]]) };
        case 'p': return { t: 'p', q: rng.int(2, 8) };
        case 'lin': return randomLin(rng, ctx);
        case 'ord': return { t: 'ord', n: weighted(rng, [[4, 1], [4, 2], [3, 3], [2, 4], [1, 5], [1, 6], [0.5, 8]]) };
        case 'word': return { t: 'word', n: rng.chance(0.7) ? 0 : 1 };
        case 'phase': return weighted(rng, [[ctx.hasUnits ? 4 : 0, { t: 'phase', u: 1 }], [ctx.hasRows ? 1 : 0, { t: 'phase', u: 2 }], [1, { t: 'phase', u: 0, P: rng.pick([2, 3, 4, 6, 8]) }]]);
        default: return { t: kind };
    }
}
function tweakTerm(rng, t, ctx) {
    t = clone(t);
    switch (t.t) {
        case 'x': if (rng.chance(0.6)) t.o = nudgeOffset(rng, t.o, ctx); else t.q += rng.chance(0.5) ? 1 : -1; break;
        case 'r': if (rng.chance(0.6)) t.o = nudgeOffset(rng, t.o, ctx); else t.m = (t.m + rng.int(1, 2)) % 3; break;
        case 'p': t.q += rng.chance(0.5) ? 1 : -1; break;
        case 'lin': {
            const r = rng();
            if (r < 0.3) { const k = rng.int(0, t.taps.length - 1); t.taps[k][0] = nudgeOffset(rng, t.taps[k][0], ctx); }
            else if (r < 0.5) { const k = rng.int(0, t.taps.length - 1); t.taps[k][1] += rng.chance(0.5) ? 1 : -1; }
            else if (r < 0.6) t.taps.push([pickOffset(rng, ctx), rng.chance(0.5) ? 1 : -1]);
            else if (r < 0.7 && t.taps.length > 1) t.taps.splice(rng.int(0, t.taps.length - 1), 1);
            else if (r < 0.8) t.shift += rng.chance(0.5) ? 1 : -1;
            else if (r < 0.87) t.rel = t.rel ? 0 : 1;
            else if (r < 0.94) t.m = (t.m + rng.int(1, 2)) % 3;
            else t.q += rng.chance(0.5) ? 1 : -1;
            break;
        }
        case 'ord': t.n += rng.chance(0.55) ? 1 : -1; break;
        case 'word': t.n = t.n ? 0 : 1; break;
        case 'phase': if (t.u === 0 && rng.chance(0.6)) t.P = rng.chance(0.5) ? t.P * 2 : Math.max(2, t.P + (rng.chance(0.5) ? 1 : -1)); else { t.u = (t.u + rng.int(1, 2)) % 3; t.P = rng.pick([2, 3, 4, 6, 8]); } break;
        default: return null;
    }
    return t;
}

// ------------------------------------------------------------------ genomes
function minimal() { return codec.normalize({ experts: [{ k: 'ctx', terms: [], limit: 9 }], mixers: [{ sel: { k: 'none' }, lr: 5 }] }); }
function shown(t) { const e = codec.normalize({ experts: [{ k: 'ctx', terms: [t] }] }).experts[0]; return e.terms[0] || null; }
const UNIT = [0, 1, 0];
function newFront() { return { preds: [{ taps: [[UNIT, 1]], shift: 0, clamp: 0 }] }; }
function frontKey(g, rng, ctx) {                     // which predictor an operator should work on
    const keys = [];
    if (ctx.n8) keys.push('front8');
    if (ctx.n16) keys.push('front16');
    if (!keys.length) return null;
    const have = keys.filter(k => g[k]);
    return have.length && rng.chance(0.7) ? rng.pick(have) : rng.pick(keys);
}
function frontWhat(key) { return key === 'front16' ? '16-bit predictor' : 'predictor'; }

// Every operator returns a short plain-English note, or null when it does not apply.
function opAddExpert(g, rng, ctx, lim) {
    if (g.experts.length >= lim.maxExperts) return null;
    const n = weighted(rng, [[5, 1], [3, 2], [1, 3]]), terms = [];
    for (let i = 0; i < n; i++) terms.push(randomTerm(rng, ctx, g));
    const e = { k: 'ctx', terms, limit: rng.int(5, 10) };
    g.experts.push(e);
    return 'new expert watching ' + termsText(codec.normalize({ experts: [e] }).experts[0].terms, ctx, g);
}
function opCloneExpert(g, rng, ctx, lim) {
    const ctxs = g.experts.filter(e => e.k === 'ctx' && e.terms.length);
    if (!ctxs.length || g.experts.length >= lim.maxExperts) return null;
    const e = clone(rng.pick(ctxs)), k = rng.int(0, e.terms.length - 1), t = tweakTerm(rng, e.terms[k], ctx);
    if (t) e.terms[k] = t; else e.terms.push(randomTerm(rng, ctx, g));
    g.experts.push(e);
    return 'copied an expert and changed what it watches';
}
function opRemoveExpert(g, rng) {
    if (g.experts.length < 2) return null;
    const k = rng.int(0, g.experts.length - 1), was = g.experts[k];
    g.experts.splice(k, 1);
    return was.k === 'match' ? 'dropped the repeat-finder' : 'dropped expert ' + (k + 1);
}
function opAddMatch(g, rng) {
    if (g.experts.filter(e => e.k === 'match').length >= 2 || g.experts.length >= MAX.experts) return null;
    const minLen = rng.pick([2, 3, 4, 5, 6, 8, 12, 16, 24, 32]);
    g.experts.push({ k: 'match', minLen, limit: 11 });
    return 'new repeat-finder: bets on whatever followed the last ' + minLen + ' bytes the previous time';
}
function opAddTerm(g, rng, ctx) {
    const c = g.experts.filter(e => e.k === 'ctx' && e.terms.length < MAX.terms);
    if (!c.length) return null;
    const e = rng.pick(c), t = randomTerm(rng, ctx, g), s = shown(t);
    e.terms.push(t);
    return 'expert ' + (g.experts.indexOf(e) + 1) + ' now also watches ' + (s ? termText(s, ctx, g) : 'one more clue');
}
function opRemoveTerm(g, rng) {
    const c = g.experts.filter(e => e.k === 'ctx' && e.terms.length > 0);
    if (!c.length) return null;
    const e = rng.pick(c);
    e.terms.splice(rng.int(0, e.terms.length - 1), 1);
    return 'expert ' + (g.experts.indexOf(e) + 1) + ' watches one thing less';
}
function opTweakTerm(g, rng, ctx) {
    const c = g.experts.filter(e => e.k === 'ctx' && e.terms.length > 0);
    if (!c.length) return null;
    const e = rng.pick(c), k = rng.int(0, e.terms.length - 1), t = tweakTerm(rng, e.terms[k], ctx);
    if (!t) return null;
    e.terms[k] = t;
    const s = shown(t);
    return 'expert ' + (g.experts.indexOf(e) + 1) + ' retuned: ' + (s ? termText(s, ctx, g) : 'a clue');
}
function opReplaceTerm(g, rng, ctx) {
    const c = g.experts.filter(e => e.k === 'ctx' && e.terms.length > 0);
    if (!c.length) return null;
    const e = rng.pick(c);
    e.terms[rng.int(0, e.terms.length - 1)] = randomTerm(rng, ctx, g);
    return 'expert ' + (g.experts.indexOf(e) + 1) + ' swapped one of its clues';
}
function opLimit(g, rng) {
    const e = rng.pick(g.experts);
    e.limit += rng.chance(0.5) ? 1 : -1;
    if (e.k === 'match') { e.minLen += rng.chance(0.5) ? rng.int(1, 4) : -rng.int(1, 4); return 'repeat-finder now needs ' + Math.max(1, Math.min(MAX.minLen, e.minLen)) + ' matching bytes'; }
    return 'expert ' + (g.experts.indexOf(e) + 1) + ' changed how fast it forgets';
}
function opFront(g, rng, ctx) {
    if (g.pre.includes('bwt')) return null;                          // numbers mean nothing after a sort
    const key = frontKey(g, rng, ctx);
    if (!key) return null;
    const what = frontWhat(key);
    if (!g[key]) { g[key] = newFront(); return 'invented a ' + what + ': guess each ' + (key === 'front16' ? '16-bit number' : 'byte') + ' from earlier ones and store only the error'; }
    const f = g[key], r = rng();
    if (r < 0.04) { g[key] = null; return 'abandoned the ' + what; }
    const K = f.preds.length, k = rng.int(0, K - 1), p = f.preds[k], which = K > 1 ? ' (formula ' + (k + 1) + ' of ' + K + ')' : '';
    // Compound moves. A good formula is often two edits away with a valley in between
    // (W + N is awful until it is halved; W + N needs − NW to become a gradient), so
    // these propose the whole shape at once. Whether it helps is still up to selection.
    if (r < 0.34 && p.taps.length >= 1) {
        const base = p.taps[0][0];
        let other = pickOffset(rng, ctx);
        if (ctx.hasRows && key === 'front8' && rng.chance(0.6)) other = [1, 0, 0];
        if (sameOff(other, base)) other = addOff(base, UNIT);
        const shapes = [
            [[[base, 1], [other, 1], [addOff(base, other), -1]], 0, 'a gradient: two neighbours minus the one diagonal to both'],
            [[[base, 1], [other, 1]], 1, 'the average of two neighbours'],
            [[[base, 2], [addOff(base, base), -1]], 0, 'the straight line through the last two values, extended'],
            [[[base, 3], [addOff(base, base), -3], [addOff(addOff(base, base), base), 1]], 0, 'the curve through the last three values, extended']
        ], sh = rng.pick(shapes), all = K > 1 && rng.chance(0.5);
        for (let q = 0; q < K; q++) if (all || q === k) { f.preds[q].taps = clone(sh[0]); f.preds[q].shift = sh[1]; }
        return what + (all ? '' : which) + ' became ' + sh[2];
    }
    if (r < 0.46 || !p.taps.length) {
        if (p.taps.length >= MAX.taps) return null;
        p.taps.push([pickOffset(rng, ctx), rng.pick([1, 1, 1, -1, 2])]);
        return what + which + ' uses one more earlier value';
    }
    if (r < 0.6) { const t = rng.pick(p.taps); t[1] += rng.chance(0.5) ? 1 : -1; return what + which + ' changed a weight'; }
    if (r < 0.7) { const t = rng.pick(p.taps); t[0] = nudgeOffset(rng, t[0], ctx); return what + which + ' looks somewhere else'; }
    if (r < 0.76) { p.taps.splice(rng.int(0, p.taps.length - 1), 1); return what + which + ' dropped a value'; }
    if (r < 0.83) { p.shift += rng.chance(0.5) ? 1 : -1; return what + which + ' rescaled'; }
    if (r < 0.89) { p.clamp = p.clamp ? 0 : 1; return what + which + (p.clamp ? ' now never guesses outside its two main neighbours' : ' may overshoot its neighbours again'); }
    if (r < 0.95 && K < MAX.period) { f.preds.push(clone(p)); return what + ' now keeps ' + (K + 1) + ' formulas and cycles through them (one per channel)'; }
    if (K > 1) { f.preds.splice(k, 1); return what + ' is back to ' + (K - 1) + ' formula' + (K - 1 === 1 ? '' : 's'); }
    return null;
}
function opPre(g, rng) {
    const r = rng();
    if (g.pre.includes('bwt')) {
        if (r < 0.45) { g.pre = g.pre.filter(p => p !== 'bwt'); return 'gave up the Burrows–Wheeler sort'; }
        if (g.pre.includes('mtf')) { g.pre = g.pre.filter(p => p !== 'mtf'); return 'dropped move-to-front'; }
        g.pre.push('mtf'); return 'added move-to-front after the sort';
    }
    if (r < 0.8) { g.pre = ['bwt']; g.front8 = null; g.front16 = null; return 'tried a Burrows–Wheeler sort: reorder the whole file so similar contexts sit together'; }
    if (g.pre.includes('mtf')) { g.pre = []; return 'dropped move-to-front'; }
    g.pre = ['mtf']; return 'tried move-to-front recoding';
}
function opMixer(g, rng, ctx) {
    const r = rng();
    if (r < 0.12 && g.mixers.length < MAX.mixers) { g.mixers.push({ sel: { k: rng.pick(['bit', 'c0']) }, lr: rng.int(3, 7) }); return 'added a second mixer with its own view of when to trust whom'; }
    if (r < 0.2 && g.mixers.length > 1) { g.mixers.pop(); return 'back to a single mixer'; }
    const m = rng.pick(g.mixers);
    if (r < 0.6) { m.lr += rng.chance(0.5) ? 1 : -1; return 'mixer learning speed changed'; }
    const k = rng.pick(['none', 'bit', 'c0', 'term', 'term']);
    if (k === 'term') {
        const opts = [{ t: 'run' }, { t: 'ord', n: 1 }];
        if (ctx.hasUnits) opts.push({ t: 'phase', u: 1 }, { t: 'phase', u: 1 });
        if (hasFront(g)) opts.push({ t: 'r', o: pickOffset(rng, ctx), m: 2 }, { t: 'p', q: 3 });
        opts.push({ t: 'x', o: pickOffset(rng, ctx), q: rng.int(2, 5) });
        m.sel = { k: 'term', term: rng.pick(opts) };
    } else m.sel = { k };
    return 'mixer now keeps separate trust weights ' + selText(codec.normalize({ mixers: [m] }).mixers[0].sel, ctx, g);
}
function opApm(g, rng, ctx) {
    const r = rng();
    if ((r < 0.45 && g.apms.length < MAX.apms) || !g.apms.length) {
        if (g.apms.length >= MAX.apms) return null;
        const terms = rng.chance(0.35) ? [] : [rng.chance(0.5) ? { t: 'ord', n: rng.int(1, 2) } : randomTerm(rng, ctx, g)];
        g.apms.push({ terms, rate: rng.int(5, 7), w: rng.int(1, 3) });
        return 'added a final correction stage that learns where the mixed guess is systematically off';
    }
    if (r < 0.6) { g.apms.splice(rng.int(0, g.apms.length - 1), 1); return 'removed a correction stage'; }
    const a = rng.pick(g.apms);
    if (r < 0.75) a.rate += rng.chance(0.5) ? 1 : -1;
    else if (r < 0.9) a.w += rng.chance(0.5) ? 1 : -1;
    else a.terms = [randomTerm(rng, ctx, g)];
    return 'correction stage retuned';
}

const OPS = [
    [3.0, opAddExpert], [1.0, opCloneExpert], [1.3, opRemoveExpert], [0.5, opAddMatch], [2.0, opAddTerm], [1.3, opRemoveTerm],
    [3.2, opTweakTerm], [1.0, opReplaceTerm], [1.3, opLimit], [2.6, opFront], [0.45, opPre], [1.3, opMixer], [0.9, opApm]
];
function mutate(genome, rng, ctx, lim) {
    lim = lim || { maxExperts: MAX.experts };
    const before = codec.genomeKey(genome);
    for (let attempt = 0; attempt < 12; attempt++) {
        let g = clone(genome);
        const notes = [], steps = 1 + (rng.chance(0.3) ? 1 : 0) + (rng.chance(0.1) ? 1 : 0);
        for (let s = 0; s < steps; s++) {
            const op = weighted(rng, OPS), note = op(g, rng, ctx, lim);
            if (note) { notes.push(note); g = codec.normalize(g); }
        }
        g = codec.normalize(g);
        if (g.experts.length > lim.maxExperts) g.experts.length = lim.maxExperts;
        g = codec.normalize(g);
        if (notes.length && codec.genomeKey(g) !== before) return { genome: g, note: notes.join('; ') };
    }
    return null;
}
function crossover(a, b, rng) {
    const g = clone(a), pool = clone(b.experts);
    for (let i = 0; i < g.experts.length; i++) if (pool[i] && rng.chance(0.4)) g.experts[i] = pool[i];
    for (let i = g.experts.length; i < pool.length; i++) if (rng.chance(0.4)) g.experts.push(pool[i]);
    if (rng.chance(0.3)) g.mixers = clone(b.mixers);
    if (rng.chance(0.3)) g.apms = clone(b.apms);
    // The block transform is what the experts are tuned to: keep A's. A predictor the
    // other parent has and this one lacks is worth inheriting — that is how a design that
    // is good on pictures and one that is good on sound become one that does both.
    if (!g.pre.includes('bwt')) for (const k of ['front8', 'front16']) if (!g[k] && b[k] && rng.chance(0.5)) g[k] = clone(b[k]);
    return codec.normalize(g);
}
function random(rng, ctx, lim) {
    let g = minimal();
    for (let k = rng.int(1, 3); k > 0; k--) { const m = mutate(g, rng, ctx, lim); if (m) g = m.genome; }
    return g;
}
function complexity(g) {
    let c = 0;
    for (const e of g.experts) c += e.k === 'match' ? 1.5 : 1 + 0.25 * e.terms.length;
    c += g.pre.length * 1.5 + (g.mixers.length - 1) + g.apms.length * 0.5;
    for (const k of ['front8', 'front16']) if (g[k]) for (const p of g[k].preds) c += 0.1 * p.taps.length;
    return c;
}

// ---------------------------------------------------------------- families
// Three architectural skeletons, kept as separate niches by evolution.js.
function species(g) { return g.pre.includes('bwt') ? 'sort' : hasFront(g) ? 'predict' : 'direct'; }
const SPECIES = {
    'direct': { name: 'Direct modelling', short: 'Direct', blurb: 'Predicts the raw bytes straight from what came before — the PPM / PAQ family.', color: '#3987e5' },
    'predict': { name: 'Predict, then model the error', short: 'Predict', blurb: 'Guesses each number with a formula and codes only how wrong the guess was — the PNG / JPEG-LS / FLAC family. (On text the predictor stays silent.)', color: '#d95926' },
    'sort': { name: 'Sort, then model', short: 'Sort first', blurb: 'Burrows–Wheeler: reorders the whole file so alike contexts become neighbours — the bzip2 family.', color: '#199e70' }
};
const SPECIES_ORDER = ['direct', 'predict', 'sort'];
// a simple member of a given family, so that no family is missing by bad luck
function founder(sp, rng, ctx, lim) {
    const g = minimal();
    if (sp === 'sort') g.pre = rng.chance(0.5) ? ['bwt'] : ['bwt', 'mtf'];
    else if (sp === 'predict') {
        if (ctx.n8) g.front8 = newFront();
        if (ctx.n16) g.front16 = newFront();
        if (!ctx.n8 && !ctx.n16) g.front8 = newFront();
    }
    let out = codec.normalize(g);
    for (let k = 0; k < 2; k++) { const m = mutate(out, rng, ctx, lim); if (m && species(m.genome) === sp) out = m.genome; }
    return out;
}

// ------------------------------------------------------------- explanation
function unitWord(ctx) { return ctx.kind === 'image' ? 'pixel' : ctx.kind === 'audio' ? 'sample' : 'unit'; }
// After a Burrows–Wheeler sort a position is no longer a pixel, a sample or a column:
// designs of that family are described (and drawn) in neutral, one-dimensional words.
function wordCtx(ctx, g) { return g && g.pre && g.pre.includes('bwt') ? Object.assign({}, ctx, { kind: 'sorted', hasRows: false, hasUnits: false }) : ctx; }
// reads naturally after "the byte …" / "the prediction error …"
function whereText(o, ctx) {
    const u = unitWord(ctx), a = o[0], b = o[1], c = o[2], parts = [];
    if (ctx.kind === 'sorted' || (!ctx.hasRows && !ctx.hasUnits)) { const d = b + c; return d === 1 ? 'just before this one' : d + ' bytes back'; }
    if (a === 1 && b === 0) parts.push('directly above'); else if (a === 1) parts.push('one row up'); else if (a > 1) parts.push(a + ' rows up');
    const side = ctx.kind === 'image' || a > 0;
    if (b > 0) parts.push((b === 1 ? 'one ' + u : b + ' ' + u + 's') + (side ? ' to the left' : ' earlier'));
    else if (b < 0) parts.push((b === -1 ? 'one ' + u : -b + ' ' + u + 's') + (side ? ' to the right' : ' later'));
    if (c !== 0 && !parts.length) return c === 1 ? 'one byte back (the previous channel of this ' + u + ', or the ' + u + ' before)' : c + ' bytes back';
    if (c > 0) parts.push(c + ' byte' + (c === 1 ? '' : 's') + ' further back'); else if (c < 0) parts.push(-c + ' byte' + (c === -1 ? '' : 's') + ' nearer');
    return parts.join(', ');
}
const SUB = ['', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
function tapName(o, ctx) {
    const a = o[0], b = o[1], c = o[2], tail = c === 0 ? '' : (c > 0 ? '₋' : '₊') + (SUB[Math.abs(c)] || Math.abs(c));
    if (ctx.kind === 'sorted' || (!ctx.hasRows && !ctx.hasUnits)) return 'x[−' + (b + c) + ']';
    if (a === 0 && b === 0) return c === 1 ? 'prev' : 'x[−' + c + ']';
    if (ctx.kind === 'image') {                          // compass names, as in the image-coding literature
        if (a > 2 || Math.abs(b) > 3) return '[' + o.join(',') + ']';
        return 'N'.repeat(a) + (b > 0 ? 'W'.repeat(b) : 'E'.repeat(-b)) + tail;
    }
    if (ctx.kind === 'audio' && a === 0) return 's[' + (b > 0 ? '−' + b : '+' + -b) + ']' + tail;
    // mixed data: plain words that are right for a pixel, a sample frame and a record alike
    const n = v => v > 1 ? String(v) : '';
    return (a > 0 ? 'up' + n(a) + (b ? '-' : '') : '') + (b > 0 ? 'left' + n(b) : b < 0 ? 'right' + n(-b) : '') + tail;
}
function linFormula(taps, shift, ctx) {
    let s = '';
    taps.forEach(([o, c], i) => {
        const a = Math.abs(c);
        s += (c < 0 ? (i ? ' − ' : '−') : (i ? ' + ' : '')) + (a === 1 ? '' : a + '·') + tapName(o, ctx);
    });
    if (shift) s = '(' + s + ') / ' + (1 << shift);
    return s;
}
function termText(t, ctx, g) {
    ctx = wordCtx(ctx, g);
    switch (t.t) {
        case 'x': return 'the byte ' + whereText(t.o, ctx) + (t.q < 8 ? ' (top ' + t.q + ' bits)' : '');
        case 'r': return 'the prediction error ' + whereText(t.o, ctx) + (t.m === 1 ? ' (sign and rough size)' : t.m === 2 ? ' (rough size)' : '');
        case 'p': return 'the predicted value itself' + (t.q < 8 ? ' (top ' + t.q + ' bits)' : '');
        case 'lin': return linFormula(t.taps, t.shift, ctx) + (t.rel ? ' minus the prediction' : '') + (t.m === 1 ? ' (sign and rough size)' : t.m === 2 ? ' (rough size)' : t.q < 8 ? ' (top ' + t.q + ' bits)' : '');
        case 'ord': return t.n === 1 ? 'the previous byte' : 'the last ' + t.n + ' bytes';
        case 'word': return t.n ? 'the current word so far, and the word before it' : 'the letters of the current word so far';
        case 'phase': return t.u === 1 ? (ctx.kind === 'image' ? 'which colour channel this is' : 'which byte of the ' + unitWord(ctx) + ' this is') : t.u === 2 ? 'the column within the row' : 'position modulo ' + t.P;
        case 'run': return 'how long the current run of identical bytes is';
        case 'col': return 'the column within the text line';
        case 'above': return 'the character directly above, in the previous line';
    }
    return '?';
}
function termsText(terms, ctx, g) {
    if (!terms.length) return 'nothing — it just learns which byte values are common (order-0)';
    return terms.map(t => termText(t, ctx, g)).join(' + ');
}
function selText(sel, ctx, g) {
    if (sel.k === 'none') return 'in one shared set';
    if (sel.k === 'bit') return 'for each of the 8 bit positions';
    if (sel.k === 'c0') return 'for every partially-decoded byte value';
    return 'depending on ' + termText(sel.term, ctx, g);
}
function formulaLabel(k, K, key, ctx) {
    if (K === 1) return 'every value';
    if (ctx.kind === 'image' && K === 3) return ['red', 'green', 'blue'][k];
    if (key === 'front16' && K === 2) return ['left channel', 'right channel'][k];
    return 'channel ' + (k + 1) + ' of ' + K;
}
function limitText(idx) {
    const v = codec.LIMITS[idx];
    return v <= 5 ? 'forgets almost at once (trusts only the last ~' + v + ' sightings)' : v <= 32 ? 'short memory (~' + v + ' sightings)' : v <= 255 ? 'long memory (~' + v + ' sightings)' : 'never forgets (assumes the statistics do not drift)';
}
function describe(g, ctx) {
    const blocks = [];
    for (const p of g.pre) {
        if (p === 'bwt') blocks.push({ kind: 'pre', id: 'bwt', title: 'Burrows–Wheeler sort', text: 'Sorts every rotation of the file and keeps the last column. Bytes that are followed by the same text end up next to each other, so the stream becomes long stretches of few distinct symbols. Fully reversible with one extra number. Everything below works on that sorted stream, where "the byte before" means the previous one in sorted order.' });
        else blocks.push({ kind: 'pre', id: 'mtf', title: 'Move-to-front', text: 'Replaces each byte by its position in a recently-used list. After a sort, that turns "the same few symbols over and over" into "mostly zeros and ones".' });
    }
    for (const key of ['front8', 'front16']) {
        const f = g[key];
        if (!f) continue;
        const wide = key === 'front16', idle = !!(ctx.engages && !ctx.engages[key]), fctx = Object.assign({}, ctx, { hasUnits: true, kind: wide && ctx.kind !== 'image' ? 'audio' : ctx.kind });
        const lines = f.preds.map((p, k) => {
            let s = p.taps.length ? linFormula(p.taps, p.shift, fctx) : '0 (no guess)';
            if (p.clamp && p.taps.length >= 2) s += ', kept between ' + tapName(p.taps[0][0], fctx) + ' and ' + tapName(p.taps[1][0], fctx);
            return { label: formulaLabel(k, f.preds.length, key, ctx), formula: s };
        });
        blocks.push({ kind: 'front', idle, title: wide ? 'Numeric predictor, 16-bit' : 'Numeric predictor', lines,
            text: (wide ? 'Wakes up on files whose bytes pair up into 16-bit numbers (sound). ' : 'Wakes up on 8-bit grids — pixels, tables — and stays silent on text and 16-bit data. ') + 'Guesses each ' + (wide ? 'number' : 'byte') + ' from values already seen and passes on only the error, which is usually small; the decoder makes the same guess and adds the error back.' + (wide ? ' The high byte is coded first.' : '') + (idle ? ' Not used by the file on screen.' : '') });
    }
    g.experts.forEach((e, i) => {
        if (e.k === 'match') blocks.push({ kind: 'expert', index: i, match: true, title: 'Repeat-finder', text: 'Remembers where the last ' + e.minLen + ' bytes occurred before and bets that what followed then follows now — the dictionary idea of gzip and zstd, recast as a prediction. The longer the match, the harder it bets.' });
        else blocks.push({ kind: 'expert', index: i, match: false, terms: e.terms, ctx: wordCtx(ctx, g), title: e.terms.length ? 'Context expert' : 'Order-0 expert', text: 'Watches ' + termsText(e.terms, ctx, g) + '. ' + limitText(e.limit).replace(/^./, c => c.toUpperCase()) + '.' });
    });
    blocks.push({ kind: 'mixer', title: g.mixers.length > 1 ? 'Two mixers, then a judge' : 'Mixer',
        text: g.mixers.map((m, i) => (g.mixers.length > 1 ? 'Mixer ' + (i + 1) + ' keeps' : 'Keeps') + ' trust weights ' + selText(m.sel, ctx, g) + ' and re-learns them after every bit (speed ' + codec.LRS[m.lr] + ').').join(' ') + (g.mixers.length > 1 ? ' A last pair of weights decides between the two.' : '') + ' An expert whose clue means nothing in a given file (rows, in a text) stays at “no idea” and is simply ignored.' });
    g.apms.forEach(a => blocks.push({ kind: 'apm', title: 'Correction stage', text: 'Learns, per ' + (a.terms.length ? termsText(a.terms, ctx, g) : 'partly-decoded byte') + ', how the final probability tends to be wrong and bends it (' + a.w * 25 + '% of the way).' }));
    blocks.push({ kind: 'coder', title: 'Arithmetic coder', text: 'Turns each probability into a fraction of a bit. Not evolved — it is already within 0.01% of the theoretical limit, so every byte saved comes from predicting better.' });
    const sp = species(g);
    return { species: sp, name: SPECIES[sp].name, blocks };
}
function shortName(g) {
    const e = g.experts.filter(x => x.k === 'ctx').length, m = g.experts.length - e, fr = (g.front8 ? 1 : 0) + (g.front16 ? 1 : 0);
    return SPECIES[species(g)].name + (fr === 2 ? ' (8- and 16-bit)' : '') + ' · ' + e + ' expert' + (e === 1 ? '' : 's') + (m ? ' + repeat-finder' : '') + (g.apms.length ? ' + correction' : '');
}

CE.genome = { wordCtx, makeRng, minimal, random, founder, mutate, crossover, complexity, species, SPECIES, SPECIES_ORDER, describe, shortName, termText, termsText, tapName, whereText, unitWord };
if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof self !== 'undefined' ? self : globalThis);
