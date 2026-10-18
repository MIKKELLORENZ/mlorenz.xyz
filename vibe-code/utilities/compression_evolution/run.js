/* run.js — one evolution run, without any DOM: the GA, the whole-file exams of
   every family's leader, champion tracking, milestones, the discovery log, and the
   record that lets a run be saved and picked up again later. The page (main.js) and
   the terminal trainer (train_headless.js) both drive this class, so what is recorded
   offline can be replayed on the page one to one.

   A DATASET is one file (a specialist is evolved for it) or several (ONE design is
   judged on all of them — the generalist). With several files the score is the mean
   compression ratio, scaled to a nominal 1,000,000 "bytes", so a 100 KB text counts
   exactly as much as a 1 MB photo.

   Two different numbers exist for every design and they must not be confused:
     sample score   what selection sees — the fitness sample(s): fast, exact
     full score     what is REPORTED — the whole file(s), from an exam
   The leaderboard, the headline and "the champion" use MEASURED full scores only,
   because the reference tools were measured on whole files too. Exams are slow
   (seconds) and generations are fast, so the chart LINE is an estimate between
   exams: the family's sample score times the full/sample ratio of its last
   measured design. Every exam becomes a dot on the line and recalibrates what
   follows it, so the drawing never drifts from what was measured. */

(function (root) {
'use strict';
const CE = root.CE = root.CE || {};
const G = CE.genome;

// o.dataset = { id, parts: [{ id, data: Uint8Array, info (from analyze) }] }
function Run(o) {
    this.dataset = o.dataset; this.parts = o.dataset.parts; this.pool = o.pool;
    this.multi = this.parts.length > 1;
    this.nominal = this.multi ? 1e6 : this.parts[0].data.length;
    this.ctx = CE.analyze.context(this.parts.map(p => p.info));
    this.baselines = (o.baselines || []).slice().sort((a, b) => b.pct - a.pct);
    this.settings = Object.assign({ sampleKB: 64, pop: 40, experts: 8, seed: 1 }, o.settings || {});
    this.seeds = (o.seeds || []).slice();
    this.seedNote = o.seedNote || '';     // how the log describes a design that was carried in
    this.on = o.on || {};
    this.alive = true;
    this.species = new Map();          // family -> { askedKey, best: { size, pct, genome, gen, note, verified, parts, … } }
    this.champion = null;
    this.passed = new Set();
    this.series = {};                  // family -> [{ gen, pct, m (measured?), s (sample score), f (fixed history?) }]
    this.cal = {};                     // family -> full/sample ratio of its last measured design
    this.extinct = {};
    this.log = [];
    this.genOffset = o.startGen || 0;
    this.evo = null; this.samples = null;
    this.t0 = 0;
    // Continuing a saved run: its lines become fixed history (`f`) that new points may
    // only extend downwards; its designs (every family's best + the last survivors)
    // seed the population, so evolution resumes instead of starting over.
    if (o.history) {
        const h = o.history;
        for (const sp of Object.keys(h.series || {})) if (G.SPECIES[sp]) this.series[sp] = h.series[sp].map(e => ({ gen: e[0], pct: e[1], m: e[2], s: Infinity, f: 1 }));
        for (const sp of Object.keys(h.extinct || {})) if (G.SPECIES[sp]) this.extinct[sp] = h.extinct[sp];
        this.genOffset = h.gens || this.genOffset; this.evals0 = h.evals || 0;
        for (const sp of Object.keys(h.families || {})) if (h.families[sp].genome) this.seeds.push(h.families[sp].genome);
        for (const g of h.pop || []) this.seeds.push(g);
        if (h.genome) this.seeds.push(h.genome);
        this.log = (h.log || []).slice();
        if (h.pct) for (const b of this.baselines) if (h.pct < b.pct) this.passed.add(b.id);     // announced back then
    }
}
function floorOf(ser) { let v = Infinity; for (const e of ser) if (e.f && e.pct < v) v = e.pct; return v; }

Run.prototype.gen = function () { return this.genOffset + (this.evo ? this.evo.gen : 0); };
Run.prototype._emit = function (name, a, b, c) { if (this.alive && this.on[name]) this.on[name](a, b, c); };
Run.prototype._log = function (kind, headline, text, gen) {
    const e = { gen: gen === undefined ? this.gen() : gen, kind, headline, text };
    this.log.push(e); if (this.log.length > 400) this.log.shift();
    this._emit('log', e);
};

Run.prototype.prepare = async function () {
    const s = this.settings, per = s.sampleKB * 1024 * (this.multi ? 0.5 : 1);
    this.samples = this.parts.map(p => CE.analyze.buildSample(p.data, per, p.info));
    const shapes = this.parts.map(p => CE.analyze.shapeOf(p.info));
    await this.pool.setData(this.samples.map((sm, i) => ({ data: sm.sample, shape: shapes[i] })), this.parts.map((p, i) => ({ data: p.data, shape: shapes[i] })));
    if (!this.alive) return;
    this.evo = new CE.Evolution({
        ctx: this.ctx, seed: s.seed, popSize: s.pop, maxExperts: s.experts, seedNote: this.seedNote,
        evaluate: jobs => this._evaluate(jobs),
        onExtinct: (sp) => { this.extinct[sp] = this.gen(); this._emit('extinct', sp, this.gen()); this._log('dead', G.SPECIES[sp].short + ' went extinct', '— far behind the leader and no longer improving, so it stops getting breeding slots.'); }
    });
    if (this.seeds.length) this.evo.seed(this.seeds);
    this.t0 = Date.now();
};

// A page that listens for `tried` sees every design the moment its sample score comes
// back (the preview over the empty chart); `batch` says how many a generation holds.
// Queuing the jobs one by one hands them to the workers in exactly the order a batch
// would, and each result is still matched to its own design, so nothing evolves
// differently. Without a listener (the headless trainer) it is the plain batch call.
Run.prototype._evaluate = function (jobs) {
    if (!this.on.tried) return this.pool.evaluate(jobs);
    this._emit('batch', jobs.length, this.gen());
    return Promise.all(jobs.map(job => this.pool.evaluate([job]).then(res => {
        this._emit('tried', job, res[0]);
        return res[0];
    })));
};

// one generation of evolution, then ask for exams of every family leader that changed
Run.prototype.generation = async function () {
    if (!this.alive || !this.evo) return;
    await this.evo.step();
    if (!this.alive) return;
    const leaders = this.evo.speciesLeaders(), lead = this.evo.champion ? this.evo.champion.species : null;
    leaders.forEach((L, rank) => {
        if (!L.best || L.extinct) return;
        let rec = this.species.get(L.species);
        if (!rec) { rec = { askedKey: null, best: null }; this.species.set(L.species, rec); }
        if (rec.askedKey === L.best.key) return;
        rec.askedKey = L.best.key;
        this._exam(L.species, L.best, L.species === lead ? 0 : 1 + rank);
    });
    // one estimated point per family per improvement (see the header comment)
    for (const L of leaders) {
        if (!L.best || L.extinct || !(L.best.size < Infinity)) continue;
        const ser = this.series[L.species] = this.series[L.species] || [], last = ser[ser.length - 1];
        if (last && L.best.size >= last.s) continue;
        const ratio = this.cal[L.species] || (this.champion ? this.cal[this.champion.species] : 0);
        if (!ratio) continue;
        const est = 100 * ratio * L.best.size / this.nominal;
        if (est >= floorOf(ser)) continue;                  // recorded history is only ever extended downwards
        ser.push({ gen: this.gen(), pct: est, m: 0, s: L.best.size });
        this._emit('series', L.species, ser);
    }
    this._emit('generation', this.stats());
};

Run.prototype._exam = function (sp, ind, priority) {
    const gen = this.gen();
    this.pool.exam(ind.genome, { slot: 'sp:' + sp, priority, costs: true, verify: false, wantBytes: true }).then(r => {
        if (!this.alive || !r || r.error || r.aborted) return;
        this._examined(sp, ind, r, gen);
    });
};

Run.prototype._examined = function (sp, ind, r, gen) {
    const rec = this.species.get(sp), pct = 100 * r.size / this.nominal;
    if (rec.best && r.size >= rec.best.size) return;
    rec.best = { species: sp, size: r.size, pct, genome: ind.genome, gen, note: ind.note, sampleSize: ind.size, verified: r.verified, encMs: r.encMs, decMs: r.decMs, parts: r.parts };
    // the measurement becomes a dot at the generation that design appeared in, and
    // every later estimate of this family is re-scaled with the fresh ratio
    const ser = this.series[sp] = this.series[sp] || [], ratio = this.cal[sp] = r.size / ind.size;
    if (pct > floorOf(ser) + 1e-9) { this._emit('species', sp, rec.best); this._championCheck(sp, ind, rec, pct, gen); return; }
    let k = ser.findIndex(e => e.gen >= gen && !e.f);
    if (k < 0) { ser.push({ gen, pct, m: 1, s: ind.size }); k = ser.length - 1; }
    else if (ser[k].gen === gen) { ser[k].pct = pct; ser[k].m = 1; ser[k].s = ind.size; }
    else ser.splice(k, 0, { gen, pct, m: 1, s: ind.size });
    for (let j = k + 1; j < ser.length; j++) if (!ser[j].m && !ser[j].f) ser[j].pct = 100 * ratio * ser[j].s / this.nominal;
    // estimates BEFORE this dot were made with an older (or a borrowed) ratio: blend them
    // from the previous measurement's ratio to this one, so no step appears at either end
    let kp = k - 1;
    while (kp >= 0 && !ser[kp].m && !ser[kp].f) kp--;
    const r0 = kp >= 0 && !ser[kp].f ? ser[kp].pct / 100 * this.nominal / ser[kp].s : ratio;
    for (let j = kp + 1; j < k; j++) ser[j].pct = 100 * (r0 + (ratio - r0) * (j - kp) / (k - kp)) * ser[j].s / this.nominal;
    this._emit('series', sp, ser);
    this._emit('species', sp, rec.best);
    this._championCheck(sp, ind, rec, pct, gen);
};

Run.prototype._championCheck = function (sp, ind, rec, pct, gen) {
    const prev = this.champion, r = rec.best;
    if (prev && r.size >= prev.size) return;
    this.champion = r;
    const delta = prev ? prev.pct - pct : 0;
    this._log('champion', pct.toFixed(2) + '%' + (prev ? ' (−' + delta.toFixed(2) + ')' : ''), (prev && prev.species !== sp ? 'The “' + G.SPECIES[sp].short + '” family takes the lead: ' : '') + (ind.note || 'first design'), gen);
    const fresh = this.baselines.filter(b => pct < b.pct && !this.passed.has(b.id));       // hardest first
    fresh.forEach(b => this.passed.add(b.id));
    fresh.sort((a, b) => a.pct - b.pct);
    if (fresh.length) this._log('mile', 'Passed ' + fresh[0].name, '(' + fresh[0].pct.toFixed(2) + '%)' + (fresh.length > 1 ? ', and with it ' + fresh.slice(1).map(b => b.name).join(', ') + '.' : ''), gen);
    this._emit('champion', r, prev);
    // Decode-and-compare costs as much as the exam itself, so it waits until the exam
    // worker has nothing else to do (`lazy`) — but not for ever: while champions keep
    // coming, one is verified every ~10 s anyway. A newer champion replaces the request.
    const target = r, lazy = Date.now() - (this.lastVerify || 0) < 10000;
    if (!lazy) this.lastVerify = Date.now();
    this.pool.exam(target.genome, { slot: 'verify', priority: 0, lazy, costs: false, wantBytes: false }).then(v => {
        if (!this.alive || !v || v.error) return;
        this.lastVerify = Date.now();
        if (v.verified === false) this._log('dead', 'ROUND TRIP FAILED', 'the decoder did not reproduce the file: a bug in the codec, please report it.', gen);
        target.verified = v.verified; target.decMs = v.decMs;
        v.parts.forEach((q, i) => { if (target.parts[i]) { target.parts[i].verified = q.verified; target.parts[i].decMs = q.decMs; } });
        if (this.champion === target) this._emit('champion', target, target);
    });
};

Run.prototype.stats = function () {
    const e = this.evo;
    return { gen: this.gen(), evals: e.evals, aborted: e.aborted, msPerEval: e.evals ? e.evalMs / e.evals : 0, seconds: (Date.now() - this.t0) / 1000, stagnant: e.stagnant, sampleBytes: this.samples.reduce((a, s) => a + s.sample.length, 0), leaders: e.speciesLeaders() };
};

// [gen, pct, measured] triples, thinned to what a chart can show
Run.prototype._compactSeries = function () {
    const out = {};
    for (const sp of Object.keys(this.series)) {
        const ser = this.series[sp], keep = [];
        let lastPct = Infinity;
        ser.forEach((e, i) => { if (e.m || i === ser.length - 1 || lastPct - e.pct > 0.02) { keep.push([e.gen, +e.pct.toFixed(3), e.m ? 1 : 0]); lastPct = e.pct; } });
        out[sp] = keep;
    }
    return out;
};

// Everything needed to replay this run and to CONTINUE it: the champion, every
// family's best design, the last survivors, the chart lines and the log.
Run.prototype.record = function () {
    const c = this.champion, families = {}, pop = [];
    for (const [sp, rec] of this.species) if (rec.best) families[sp] = { size: rec.best.size, pct: +rec.best.pct.toFixed(3), gen: rec.best.gen, genome: rec.best.genome };
    if (this.evo) for (const ind of this.evo.pop.filter(i => i.fit < Infinity).sort((a, b) => a.fit - b.fit).slice(0, 12)) pop.push(ind.genome);
    return {
        format: 'compression-evolution-run', v: 2, dataset: this.dataset.id, files: this.parts.map(p => ({ id: p.id, bytes: p.data.length })), settings: this.settings,
        size: c ? c.size : null, pct: c ? +c.pct.toFixed(3) : null, verified: c ? c.verified : null, perFile: c ? c.parts.map((q, i) => ({ id: this.parts[i].id, size: q.size, pct: +(100 * q.size / this.parts[i].data.length).toFixed(3) })) : [],
        gens: this.gen(), evals: (this.evals0 || 0) + (this.evo ? this.evo.evals : 0), genome: c ? c.genome : null, families, pop, series: this._compactSeries(), extinct: this.extinct, log: this.log.filter(l => l.kind !== 'info').slice(-160)
    };
};
Run.prototype.cancel = function () { this.alive = false; };

// Reference lines for a dataset. parts: [{ id, data, meta: { baselines: [{ id, name, bytes, how, family }] } }]
// One file: every tool as measured. Several files: the MEAN RATIO of every tool that can
// handle all of them (an image codec cannot compress a novel), plus "best tool per file" —
// a toolbox of specialists with the right one picked by hand each time.
Run.baselines = function (parts) {
    const withMeta = parts.filter(p => p.meta && p.meta.baselines);
    if (!withMeta.length) return [];
    if (parts.length === 1) return parts[0].meta.baselines.map(b => ({ id: b.id, name: b.name, pct: 100 * b.bytes / parts[0].data.length, how: b.how + ' — ' + b.bytes.toLocaleString() + ' bytes' }));
    const out = [];
    for (const b of parts[0].meta.baselines) {
        if (!parts.every(p => p.meta.baselines.some(x => x.id === b.id))) continue;
        let mean = 0;
        for (const p of parts) mean += p.meta.baselines.find(x => x.id === b.id).bytes / p.data.length;
        out.push({ id: b.id, name: b.name, pct: 100 * mean / parts.length, how: 'mean ratio over the ' + parts.length + ' files — ' + b.how });
    }
    let best = 0;
    const who = [];
    for (const p of parts) { const top = p.meta.baselines.filter(b => b.family !== 'bound').sort((a, b) => a.bytes - b.bytes)[0]; best += top.bytes / p.data.length; who.push(p.id + ' → ' + top.name); }
    out.push({ id: 'toolbox', name: 'Best tool per file', pct: 100 * best / parts.length, how: 'a toolbox of specialists with the best one picked by hand for every file: ' + who.join(', ') });
    return out;
};

CE.Run = Run;
if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof self !== 'undefined' ? self : globalThis);
