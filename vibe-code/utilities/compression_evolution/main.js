/* main.js — wires the page: which data, the run loop, saving and resuming, and the
   rendering of whatever run.js reports. No compression logic lives here.

   A run is never thrown away silently. It is autosaved per dataset in localStorage and
   picked up again when you return to that dataset or reopen the page; "Save run" writes
   the same record to a file, "Load run" continues from one. A single-file run with no
   history of its own starts from the generalist's designs, not from nothing. */

(function () {
'use strict';
const CE = window.CE, G = CE.genome, R = CE.render, V = CE.views, el = R.el;
const $ = id => document.getElementById(id);
const SAMPLE_KB = [16, 32, 64, 128, 256, 0], STORE = 'ce2:run:';
const SHORT = { cat: 'Cat photo', alice: 'Alice', guitar: 'Guitar', meow: 'Meow', code: 'Source code' };
const CHAMPS = window.CE_CHAMPIONS || {};
const params = new URLSearchParams(location.search);

const S = { ds: null, run: null, pool: null, poolSize: 0, running: false, starting: false, pv: { armed: false, done: true, base: 0, gen: null }, token: 0, family: null, part: 0, user: null, lastSave: 0, speedT: 0, speedE: 0, speed: 0 };
const chart = new R.Chart($('chart'), $('chart-tip'), $('legend'), pickFamily);
const log = new R.Log($('log'), $('log-more'));
const bits = new V.Bits($('bits-view'), $('bits-sub'), $('bits-scale'), $('bits-probe'));
const preview = new R.Preview($('chart-preview'), chart);
const side = new V.Bits($('side-bits'), $('side-sub'), $('side-scale'), $('side-probe'), { compact: true });
const views = [bits, side];               // the full map below, and the small one beside the chart

// ------------------------------------------------------------- utilities
function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
function toast(msg, ms) { document.querySelectorAll('.toast').forEach(t => t.remove()); const t = el('div', 'toast', msg); t.setAttribute('role', 'status'); document.body.appendChild(t); setTimeout(() => t.remove(), ms || 3600); }
function status(text) { $('status').textContent = text; }
function stored(key) { try { const v = localStorage.getItem(STORE + key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function store(key, rec) { try { if (rec) localStorage.setItem(STORE + key, JSON.stringify(rec)); else localStorage.removeItem(STORE + key); return true; } catch (e) { return false; } }
function settings() { return { workers: +$('sl-workers').value, pop: +$('sl-pop').value, sampleKB: SAMPLE_KB[+$('sl-sample').value], experts: +$('sl-experts').value, seed: (Math.random() * 1e9) | 0 }; }
function syncLabels() {
    const s = settings();
    $('lb-workers').textContent = s.workers; $('lb-pop').textContent = s.pop; $('lb-experts').textContent = s.experts;
    $('lb-sample').textContent = s.sampleKB ? s.sampleKB + ' KB' + (S.ds && S.ds.parts.length > 1 ? ' (half of it per file)' : '') : 'The whole file';
}
function entropyBound(data) {
    const c = new Float64Array(256), n = data.length;
    for (let i = 0; i < n; i++) c[data[i]]++;
    let h = 0;
    for (let i = 0; i < 256; i++) if (c[i]) h -= c[i] / n * Math.log2(c[i] / n);
    return Math.ceil(h * n / 8);
}
async function gzipSize(data) {
    if (typeof CompressionStream === 'undefined') return null;
    try { return (await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()).byteLength; } catch (e) { return null; }
}
function download(bytes, name, type) {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// -------------------------------------------------------------- datasets
function buildSegments() {
    const host = $('datasets');
    host.textContent = '';
    const add = (id, title, hint) => { const b = el('button', 'seg', title); b.type = 'button'; b.dataset.id = id; b.title = hint || ''; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', () => id === 'user' && !S.user ? $('file-input').click() : choose(id, { autostart: S.running })); host.appendChild(b); };
    add('all', 'All files', 'One design, judged on every bundled file at once');
    for (const it of CE.corpus.items) add(it.id, SHORT[it.id] || it.title, it.blurb);
    add('user', 'Your file', 'Up to 8 MB. It never leaves this tab.');
}
function makePart(id, title, data, meta) {
    const info = CE.analyze.analyze(data);
    if (meta && meta.kind) info.kind = meta.kind;
    return { id, title, kind: info.kind, data, info, meta: meta || null };
}
async function loadDataset(id) {
    if (id === 'user') return { id, key: 'user:' + S.user.name + ':' + S.user.data.length, title: S.user.name, parts: [makePart('file', S.user.name, S.user.data, S.user.meta)] };
    const metas = id === 'all' ? CE.corpus.items : [CE.corpus.items.find(m => m.id === id)], parts = [];
    for (const m of metas) parts.push(makePart(m.id, SHORT[m.id] || m.title, await CE.corpus.load(m.id), m));
    return { id, key: id, title: id === 'all' ? 'All files' : parts[0].title, parts };
}

// Switching data never stops evolution: if it was running it keeps running, and the
// designs of the run being left are carried into the next one (they are structure-
// relative, so they mean something there), on top of whatever that dataset had saved.
async function choose(id, opt) {
    opt = Object.assign({}, opt || {});
    const token = ++S.token, prev = S.run;
    if (prev && prev.champion && !opt.replay && !opt.history) { opt.carry = [...prev.species.values()].filter(r => r.best).map(r => r.best.genome); opt.carryFrom = S.ds.title; }
    halt(true);
    document.querySelectorAll('#datasets .seg').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    status('Loading');
    let ds;
    try { ds = await loadDataset(id); } catch (e) { status('Could not load the data'); toast(String(e.message || e)); return; }
    if (token !== S.token) return;
    ds.baselines = CE.Run.baselines(ds.parts);
    S.ds = ds; S.part = 0; S.family = null;
    $('files-section').hidden = ds.parts.length < 2;
    syncLabels(); showPart();
    await restart(opt);
}
function showPart() {
    const p = S.ds.parts[S.part], m = p.meta || {}, many = S.ds.parts.length > 1, sel = $('side-file');
    views.forEach(v => v.setData(m, p.data, p.info));
    $('side-title').textContent = p.title; $('side-title').hidden = many; sel.hidden = !many;
    if (many) {
        if (sel.dataset.key !== S.ds.key) {
            sel.textContent = '';
            S.ds.parts.forEach((q, i) => { const o = el('option', '', q.title); o.value = String(i); sel.appendChild(o); });
            sel.dataset.key = S.ds.key;
        }
        sel.value = String(S.part);
    }
    const cr = $('data-credit');
    cr.textContent = (m.blurb ? m.blurb + ' ' : '') + (m.credit || '');
    if (m.source) { cr.appendChild(document.createTextNode(' ')); const a = el('a', '', 'Source'); a.href = m.source; a.target = '_blank'; a.rel = 'noopener'; cr.appendChild(a); }
    $('h-bits').textContent = S.ds.parts.length > 1 ? 'Where the bits go: ' + p.title : 'Where the bits go';
}

// ------------------------------------------------------------- the run
function halt(save) {
    if (save) autosave(true);
    S.running = false;
    syncPreview();
    if (S.run) S.run.cancel();
    if (S.pool) S.pool.flush();
    $('btn-run').textContent = 'Evolve';
}
function autosave(force) {
    const run = S.run;
    if (!run || !run.champion || !run.evo || (!force && Date.now() - S.lastSave < 20000)) return;
    S.lastSave = Date.now();
    if (!store(S.ds.key, run.record())) $('run-note').textContent = 'This browser does not allow saving here, so a run lasts only as long as the tab. Use “Save run to a file”.';
}

// opt: { autostart, replay, fresh, history, seeds, note }
async function restart(opt) {
    opt = opt || {};
    const token = ++S.token, st = settings(), ds = S.ds;
    halt(false);
    S.run = null;                       // the old run's champion describes other data: nothing below may read it
    if (!ds) return;
    status('Preparing');
    if (!S.pool || S.poolSize !== st.workers) { if (S.pool) S.pool.terminate(); S.pool = new CE.Pool({ workers: st.workers, onError: e => console.error('worker:', e) }); S.poolSize = st.workers; }
    chart.reset(ds.baselines); log.clear(); S.family = null;
    preview.reset(); preview.hide(false);
    $('hero').textContent = '–'; $('hero-note').textContent = '';
    $('hero-sub').textContent = ds.parts.length > 1 ? 'of the original size, averaged over ' + ds.parts.length + ' files' : 'of the original size';
    views.forEach(v => v.setCosts(null)); V.anatomy($('anatomy'), null); $('anatomy-name').textContent = 'Nothing has been evolved yet.'; $('anatomy-actions').hidden = true;
    $('btn-algo').disabled = true; $('bits-mode').hidden = true; S.savedFor = null; drawSavings(null);
    drawProof(null); drawFiles(); drawBoard();

    let history = opt.history || (opt.replay ? CHAMPS[ds.id] : null) || (opt.fresh ? null : stored(ds.key)), seeds = (opt.seeds || []).concat(opt.carry || []), note = opt.note || (opt.carry && opt.carry.length ? 'The designs evolved on “' + opt.carryFrom + '”, carried over to this data.' : '');
    if (history && (history.format !== 'compression-evolution-run' && !history.series)) history = null;
    if (!history && !seeds.length && ds.parts.length === 1 && !opt.fresh) {          // specialise from the shared design
        const gen = stored('all') || CHAMPS.all;
        if (gen && gen.genome) { seeds = Object.values(gen.families || {}).map(f => f.genome).filter(Boolean).concat([gen.genome]); note = 'The design evolved for all files, as the starting point for this one.'; }
    }
    // evolving straight on (a tab switched mid-run): the preview covers the preparation
    // too. A run picked up from a save already has its chart and never needs it.
    S.pv = { armed: !!opt.autostart && !history, done: !!history, base: 0, gen: null };
    S.starting = !!opt.autostart;
    preview.setStage('Preparing the data');
    syncPreview();
    const run = new CE.Run({
        dataset: ds, pool: S.pool, baselines: ds.baselines, settings: st, history, seeds, seedNote: opt.seedNote || (note ? 'carried over: ' + note.charAt(0).toLowerCase() + note.slice(1) : ''),
        on: {
            series: (sp, points) => { chart.setSeries(sp, points); syncPreview(); },
            batch: (n, gen) => { preview.batch(n, gen, run.evo && run.evo.gen === 0 ? (n > 1 ? 'Measuring the carried-over designs' : 'Measuring the starting point') : null); preview.setFoot(previewFoot()); },
            tried: (job, r) => preview.tried(job, r && !r.aborted ? (run.multi ? r.size / 1e4 : 100 * r.size / run.samples[0].sample.length) : Infinity),
            species: () => { drawBoard(); if (S.family) drawShown(); },
            champion: () => drawShown(),
            extinct: (sp, gen) => { chart.setExtinct(sp, gen); drawBoard(); },
            log: e => log.add(e.gen, e.headline, e.text, e.kind === 'champion' ? '' : e.kind),
            generation: onGeneration
        }
    });
    S.run = run;
    if (history) {
        for (const sp of Object.keys(run.series)) chart.setSeries(sp, run.series[sp]);
        for (const sp of Object.keys(run.extinct)) chart.setExtinct(sp, run.extinct[sp]);
        chart.setGen(history.gens || 0);
        for (const e of history.log || []) log.add(e.gen, e.headline, e.text, e.kind === 'champion' ? '' : e.kind);
        log.add(history.gens || 0, opt.replay ? 'Recorded run.' : 'Picked up again.', opt.replay ? 'Everything above was evolved offline with this same code. Evolve continues from its designs.' : 'This run was saved at generation ' + (history.gens || 0).toLocaleString() + ' and continues from its designs.', 'info');
    }
    await run.prepare();
    if (token !== S.token) return;
    S.speedT = Date.now(); S.speedE = 0; S.speed = 0;
    if (history || seeds.length) { status('Measuring the saved designs'); await run.generation(); if (token !== S.token) return; }
    if (note) log.add(run.gen(), '', note, 'info');
    status(history ? 'Ready at generation ' + run.gen().toLocaleString() : 'Ready');
    if (opt.autostart) start();
}

async function start() {
    if (S.running || !S.run || !S.run.evo) return;
    const run = S.run, token = S.token;
    S.running = true; S.starting = false;
    $('btn-run').textContent = 'Pause';
    if (!run.gen()) status('Measuring the starting point');
    if (!S.pv.armed && !S.pv.done) S.pv = { armed: true, done: false, base: pointCount(), gen: run.gen() };
    syncPreview();
    while (S.running && token === S.token) {
        await run.generation();
        await new Promise(r => setTimeout(r, 0));
    }
    if (token === S.token) { status('Paused at generation ' + run.gen().toLocaleString()); autosave(true); syncPreview(); }
}

// The preview stands in for the chart from the moment evolution is asked for (Evolve,
// or a tab switched while evolving) until this run puts something new on it: a fresh
// run's first measured point or, where carried-over designs were measured already, the
// first point after them. Once per run, so pausing and resuming a run that has its
// results never brings it back; and once the chart has points and five generations
// have passed it steps aside even if no design has beaten the carried-over ones yet,
// because the lines then visibly carry on.
function pointCount() { return S.run ? Object.values(S.run.series).reduce((a, s) => a + s.filter(e => !e.f).length, 0) : 0; }
function syncPreview() {
    const pv = S.pv, run = S.run;
    if (pv.armed && !pv.done && run) {
        if (pv.gen === null) pv.gen = run.gen();
        const n = pointCount();
        if (n > pv.base || (n > 0 && run.gen() - pv.gen >= 5)) pv.done = true;
    }
    if (pv.armed && !pv.done && (S.running || S.starting)) { preview.setFoot(previewFoot()); preview.show(); }
    else preview.hide(true);
}
function previewFoot() {
    const run = S.run, n = S.ds.parts.length, whole = n > 1 ? 'all ' + n + ' files in full' : 'the whole file';
    if (!run || !run.samples) return '';
    if (S.pv.base) return 'The carried-over designs are on the chart already. It carries on as soon as evolution beats them on ' + (n > 1 ? 'these files.' : 'this file.');
    if ([...run.species.values()].some(r => r.askedKey && !r.best)) return 'Now compressing ' + whole + ' with the best design. That measurement is the first point on the chart.';
    const full = run.samples.every((s, i) => s.sample.length >= S.ds.parts[i].data.length), kb = Math.round(run.samples[0].sample.length / 1024);
    return (full ? 'Scores so far are on the whole data' : 'Scores so far are on about ' + kb + ' KB of ' + (n > 1 ? 'each file' : 'the file')) + '. The chart starts once the best design has compressed ' + whole + '.';
}

function onGeneration(st) {
    chart.setGen(st.gen);
    const now = Date.now();
    if (now - S.speedT > 1500) { S.speed = (st.evals - S.speedE) / ((now - S.speedT) / 1000); S.speedT = now; S.speedE = st.evals; }
    if (S.running) status('Generation ' + st.gen.toLocaleString() + ' · ' + st.evals.toLocaleString() + (st.evals === 1 ? ' design' : ' designs') + ' tried' + (S.speed ? ' · ' + S.speed.toFixed(S.speed < 10 ? 1 : 0) + ' per second' : ''));
    syncPreview();
    drawBoard(); autosave(false);
}

// ---------------------------------------------------------------- drawing
function shown() {
    const run = S.run;
    if (!run) return null;
    if (S.family) { const r = run.species.get(S.family); if (r && r.best) return r.best; }
    return run.champion;
}
function pickFamily(sp) {
    const run = S.run, r = run && run.species.get(sp);
    if (!r || !r.best) return;
    S.family = run.champion && run.champion.species === sp ? null : sp;
    drawShown();
}
function drawShown() {
    const run = S.run, champ = run && run.champion, c = shown();
    if (!c) return;
    chart.select(c.species);
    $('hero').textContent = champ.pct.toFixed(2) + '%';
    const beaten = S.ds.baselines.filter(b => b.pct > champ.pct).length, next = S.ds.baselines.filter(b => b.pct <= champ.pct).sort((a, b) => b.pct - a.pct)[0];
    $('hero-note').textContent = (S.ds.baselines.length ? 'Ahead of ' + beaten + ' of ' + S.ds.baselines.length + ' reference tools' + (next ? '. Next: ' + next.name + ', ' + next.pct.toFixed(2) + '%.' : '.') : '') + ' A ratio of ' + (100 / champ.pct).toFixed(2) + ' to 1.';
    if (!c.parts[S.part]) return;
    const part = S.ds.parts[S.part], q = c.parts[S.part], ctx = Object.assign({}, run.ctx, { engages: { front8: !part.info.looks16 && !part.info.texty && (part.info.period > 1 || part.info.strides.length > 0), front16: !!part.info.looks16 } });
    $('anatomy-title').textContent = c === champ ? 'The algorithm' : 'The best “' + G.SPECIES[c.species].short + '” design';
    $('anatomy-name').textContent = G.shortName(c.genome) + '. ' + c.pct.toFixed(2) + '%, found in generation ' + c.gen.toLocaleString() + '.';
    V.anatomy($('anatomy'), c.genome, ctx, q.influence, S.ds.parts.length === 1 ? part.info.period : 3);
    $('anatomy-actions').hidden = false; $('btn-algo').disabled = false; $('bits-mode').hidden = !q.costs;
    views.forEach(v => v.setCosts(q.costs, q.costsMapped));
    measureSavings(c);
    drawProof(q); drawFiles(); drawBoard();
}
// ---- where the bits are saved: switch parts of the design off, one after another,
// and score each stripped version on the fitness sample (five cheap evaluations)
function savingsPlan(g) {
    const count = { experts: [{ k: 'ctx', terms: [], limit: 9 }], mixers: [{ sel: { k: 'none' }, lr: 5 }] };
    const shaped = Object.assign({}, count, { pre: g.pre, front8: g.front8, front16: g.front16 });
    const experts = Object.assign({}, shaped, { experts: g.experts.filter(e => e.k === 'ctx'), mixers: [{ sel: { k: 'none' }, lr: g.mixers[0].lr }] });
    const repeats = Object.assign({}, experts, { experts: g.experts });
    const hasMatch = g.experts.some(e => e.k === 'match'), first = g.pre.includes('bwt') ? 'Sorting the file first' : (g.front8 || g.front16) ? 'Numeric prediction' : null;
    return [['Counting byte values', count], first ? [first, shaped] : null, ['Context experts', experts], hasMatch ? ['Repeat-finder', repeats] : null, ['Mixing and correction', g]].filter(Boolean);
}
async function measureSavings(c) {
    const run = S.run, key = CE.codec.genomeKey(c.genome);
    if (!run || !run.evo || S.savedFor === key || S.savingBusy) return;
    S.savingBusy = true;
    const plan = savingsPlan(c.genome), res = await S.pool.evaluate(plan.map(p => ({ genome: CE.codec.normalize(p[1]), caps: null })));
    S.savingBusy = false;
    if (run !== S.run || res.some(r => !r || r.aborted)) return;
    S.savedFor = key;
    const nominal = run.multi ? 1e6 : run.samples[0].sample.length, bits = res.map(r => 8 * r.size / nominal), rows = [];
    let prevBits = 8;
    plan.forEach((p, i) => { rows.push({ name: p[0], bits: Math.max(0, prevBits - bits[i]) }); prevBits = Math.min(prevBits, bits[i]); });
    rows.push({ name: 'Still paid', bits: prevBits, paid: true });
    drawSavings(rows);
    if (shown() && CE.codec.genomeKey(shown().genome) !== key) measureSavings(shown());
}
function drawSavings(rows) {
    const host = $('savings');
    host.textContent = '';
    if (!rows) { host.appendChild(el('p', 'small', 'It appears with the first champion.')); return; }
    for (const r of rows) {
        const row = el('div', 'row' + (r.paid ? ' paid' : '')), track = el('div', 'track'), bar = el('i');
        bar.style.width = Math.max(0.5, r.bits / 8 * 100) + '%';
        track.appendChild(bar);
        row.appendChild(el('span', 'name', r.name)); row.appendChild(track); row.appendChild(el('span', 'val', r.bits.toFixed(2) + ' bits'));
        host.appendChild(row);
    }
}
function downloadAlgorithm() {
    const c = shown();
    if (!c) return;
    const file = { format: 'compression-evolution-algorithm', v: 2, evolvedOn: S.ds.title, family: G.SPECIES[c.species].name, generation: c.gen, percentOfOriginal: +c.pct.toFixed(3), summary: G.shortName(c.genome),
        howToUse: 'Load it on the page (Settings, Load a saved run) to keep evolving from it. In code: CE.codec.compress(bytes, genome, { shape: CE.analyze.shapeOf(CE.analyze.analyze(bytes)) }).bytes and CE.codec.decompress(bytes).', genome: c.genome };
    download(JSON.stringify(file, null, 1), 'compression-algorithm-' + S.ds.id + '-gen' + c.gen + '.json', 'application/json');
    toast('Downloaded the ' + G.SPECIES[c.species].short.toLowerCase() + ' design from generation ' + c.gen.toLocaleString() + '.');
}
function drawProof(q) {
    const set = (id, text, cls) => { const e = $(id); e.textContent = text; e.className = cls || ''; };
    if (!q) { ['pf-size', 'pf-header', 'pf-verified', 'pf-speed'].forEach(id => set(id, '–')); $('btn-download').disabled = true; return; }
    const kb = S.ds.parts[S.part].data.length / 1024;
    set('pf-size', q.size.toLocaleString() + ' B'); set('pf-header', q.headerSize + ' B');
    set('pf-verified', q.verified === true ? 'Identical' : q.verified === false ? 'Mismatch' : 'Checking', q.verified === true ? 'good' : q.verified === false ? 'bad' : '');
    set('pf-speed', Math.round(kb / Math.max(0.001, q.encMs / 1000)) + ' / ' + (q.decMs ? Math.round(kb / (q.decMs / 1000)) : '…') + ' KB/s');
    $('btn-download').disabled = !q.bytes;
}
function drawFiles() {
    const host = $('files'), ds = S.ds;
    if (!ds || ds.parts.length < 2) return;
    host.textContent = '';
    const head = el('div', 'row row-head');
    ['File', 'Original', 'This design', 'gzip -9', 'Best existing tool'].forEach((t, i) => head.appendChild(el('span', (i ? 'val' : 'name') + (i === 1 || i === 3 ? ' opt' : ''), t)));
    host.appendChild(head);
    const c = shown();
    ds.parts.forEach((p, i) => {
        const row = el('button', 'row'), refs = (p.meta ? p.meta.baselines : []).filter(b => b.family !== 'bound').sort((a, b) => a.bytes - b.bytes), gz = refs.find(b => b.id === 'gzip');
        row.type = 'button'; row.setAttribute('aria-pressed', String(i === S.part));
        row.appendChild(el('span', 'name', p.title));
        row.appendChild(el('span', 'val dim opt', fmtBytes(p.data.length)));
        row.appendChild(el('span', 'val', c && c.parts[i] ? R.pctText(100 * c.parts[i].size / p.data.length) : '…'));
        row.appendChild(el('span', 'val dim opt', gz ? R.pctText(100 * gz.bytes / p.data.length) : '–'));
        row.appendChild(el('span', 'val dim', refs.length ? R.pctText(100 * refs[0].bytes / p.data.length) + '  ' + refs[0].name.replace(' lossless', '').replace(' (7-Zip)', '') : '–'));
        row.addEventListener('click', () => pickPart(i));
        host.appendChild(row);
    });
}
function drawBoard() {
    const ds = S.ds;
    if (!ds) return;
    const rows = [{ kind: 'ref', name: 'Uncompressed', pct: 100, how: 'the raw bytes' }], run = S.run, c = shown();
    for (const b of ds.baselines) rows.push({ kind: 'ref', name: b.name, pct: b.pct, how: b.how });
    if (run) for (const sp of G.SPECIES_ORDER) {
        const r = run.species.get(sp), lm = chart.lastMeasured(sp);
        if (!r && !lm) continue;
        rows.push({ kind: 'evo', species: sp, name: 'Evolved: ' + G.SPECIES[sp].short.toLowerCase(), pct: r && r.best ? r.best.pct : lm ? lm.pct : null, how: G.SPECIES[sp].blurb, extinct: !!run.extinct[sp], selected: !!(c && c.species === sp) });
    }
    R.board($('board'), rows, pickFamily);
}

// ------------------------------------------------------ files in and out
$('btn-download').addEventListener('click', () => { const c = shown(), q = c && c.parts[S.part]; if (q && q.bytes) download(q.bytes, S.ds.parts[S.part].id + '.cev'); });
$('btn-open').addEventListener('click', () => $('cev-input').click());
$('cev-input').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!S.pool) { S.pool = new CE.Pool({ workers: settings().workers }); S.poolSize = settings().workers; }
    toast('Restoring ' + f.name, 1500);
    const r = await S.pool.decode(new Uint8Array(await f.arrayBuffer()));
    if (!r || r.error) { toast('That is not a file this page made.'); return; }
    const match = S.ds && S.ds.parts.find(p => p.data.length === r.data.length && p.data.every((v, i) => v === r.data[i]));
    toast('Restored ' + r.data.length.toLocaleString() + ' bytes in ' + (r.ms / 1000).toFixed(1) + ' s' + (match ? '. Identical to “' + match.title + '”.' : '.'), 5200);
    download(r.data, f.name.replace(/\.cev$/i, '') + '.restored');
});
function pickPart(i) { S.part = i; showPart(); if (shown()) drawShown(); else drawFiles(); }
$('side-file').addEventListener('change', e => pickPart(+e.target.value));
$('btn-algo').addEventListener('click', downloadAlgorithm);
$('btn-algo2').addEventListener('click', downloadAlgorithm);
document.querySelectorAll('#bits-mode .seg').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#bits-mode .seg').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    views.forEach(v => v.setMode(b.dataset.mode));
    $('bits-scale').firstElementChild.textContent = b.dataset.mode === 'saved' ? '0 bits saved' : '0 bits';
    $('bits-scale').lastElementChild.textContent = b.dataset.mode === 'saved' ? 'all 8' : '6 or more per byte';
}));
$('btn-copy').addEventListener('click', async () => {
    const c = shown();
    if (!c) return;
    try { await navigator.clipboard.writeText(JSON.stringify(c.genome, null, 1)); toast('The design is on the clipboard.'); } catch (e) { download(JSON.stringify(c.genome, null, 1), 'design.json', 'application/json'); }
});
$('btn-save').addEventListener('click', () => {
    if (!S.run || !S.run.champion) { toast('There is nothing to save yet.'); return; }
    const rec = S.run.record();
    rec.savedAt = new Date().toISOString(); rec.title = S.ds.title;
    download(JSON.stringify(rec), 'compression-evolution-' + S.ds.id + '-gen' + rec.gens + '.json', 'application/json');
});
$('btn-load').addEventListener('click', () => $('run-input').click());
$('run-input').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    let rec;
    try { rec = JSON.parse(await f.text()); } catch (err) { rec = null; }
    if (rec && rec.format === 'compression-evolution-algorithm' && rec.genome) {          // a single design: evolve on from it
        $('settings').close();
        await restart({ seeds: [rec.genome], autostart: S.running, note: 'A downloaded algorithm (' + (rec.summary || 'one design') + ').' });
        toast('The algorithm joined the population.'); return;
    }
    if (!rec || rec.format !== 'compression-evolution-run' || !rec.genome) { toast('That is neither a saved run nor a downloaded algorithm.'); return; }
    $('settings').close();
    const was = S.running, bundled = rec.dataset === 'all' || CE.corpus.items.some(m => m.id === rec.dataset);
    const sameUser = S.ds && S.ds.id === 'user' && rec.files && rec.files.length === 1 && rec.files[0].bytes === S.ds.parts[0].data.length;
    if (bundled) { await choose(rec.dataset, { history: rec, autostart: was }); toast('Continuing from generation ' + rec.gens.toLocaleString() + '.'); }
    else if (sameUser) { await restart({ history: rec, autostart: was }); toast('Continuing from generation ' + rec.gens.toLocaleString() + '.'); }
    else { const seeds = Object.values(rec.families || {}).map(x => x.genome).filter(Boolean).concat(rec.pop || [], [rec.genome]); await restart({ fresh: true, seeds, autostart: was, note: 'Started from the designs of a run saved for other data (“' + (rec.title || rec.dataset) + '”).' }); toast('Its data is not loaded here, so its designs were carried over to the current data.', 5200); }
});

async function userFile(f) {
    if (!f) return;
    if (/\.cev$/i.test(f.name)) { const dt = new DataTransfer(); dt.items.add(f); $('cev-input').files = dt.files; $('cev-input').dispatchEvent(new Event('change')); return; }
    if (f.size > 8 * 1048576) { toast('That file is ' + fmtBytes(f.size) + '. The limit here is 8 MB.'); return; }
    if (f.size < 2048) { toast('That file is too small to learn anything from.'); return; }
    const data = new Uint8Array(await f.arrayBuffer()), baselines = [{ id: 'entropy', name: 'Huffman-style (byte frequencies only)', bytes: entropyBound(data), how: 'zeroth-order entropy of the byte histogram', family: 'bound' }];
    const gz = await gzipSize(data);
    if (gz) baselines.push({ id: 'gzip', name: 'gzip (this browser)', bytes: gz, how: 'CompressionStream("gzip") in this browser', family: 'general' });
    S.user = { name: f.name, data, meta: { baselines, blurb: f.name + ', ' + fmtBytes(data.length) + '. It never leaves this tab.' } };
    const seg = document.querySelector('#datasets .seg[data-id="user"]'); if (seg) seg.textContent = f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name;
    choose('user', { autostart: false });
}
$('file-input').addEventListener('change', e => { userFile(e.target.files[0]); e.target.value = ''; });
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(n => window.addEventListener(n, e => e.preventDefault()));
window.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) userFile(f); });

// ------------------------------------------------------------- controls
$('btn-run').addEventListener('click', () => { if (S.running) { S.running = false; $('btn-run').textContent = 'Evolve'; syncPreview(); } else start(); });
$('btn-settings').addEventListener('click', () => $('settings').showModal());
$('btn-about').addEventListener('click', () => $('about').showModal());
document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
});
$('btn-reset').addEventListener('click', () => { const was = S.running; store(S.ds.key, null); $('settings').close(); restart({ fresh: true, autostart: was }); });
let debounce = 0;
['sl-workers', 'sl-pop', 'sl-sample', 'sl-experts'].forEach(id => $(id).addEventListener('input', () => {
    syncLabels(); clearTimeout(debounce);
    debounce = setTimeout(() => { const was = S.running, rec = S.run && S.run.champion ? S.run.record() : null; restart({ history: rec, fresh: !rec, autostart: was }); }, 450);
}));
$('about-go').addEventListener('click', () => { $('about').close(); start(); });
$('about-replay').addEventListener('click', () => { $('about').close(); choose(S.ds ? S.ds.id : 'all', { replay: true }); });
window.addEventListener('pagehide', () => autosave(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(true); });

// ------------------------------------------------------------------ boot
const hw = navigator.hardwareConcurrency || 4;
$('sl-workers').max = Math.max(2, Math.min(16, hw));
$('sl-workers').value = Math.max(1, Math.min(8, hw - 2));
syncLabels(); buildSegments();
const want = params.get('data'), firstId = want === 'all' || CE.corpus.items.some(m => m.id === want) ? want : 'all';
if (!CHAMPS[firstId] && !CHAMPS.all) $('about-replay').hidden = true;
choose(firstId, { autostart: params.has('run'), replay: params.has('replay') }).then(() => {
    let seen = false;
    try { seen = !!localStorage.getItem('ce2:seen'); localStorage.setItem('ce2:seen', '1'); } catch (e) { /* private mode */ }
    if (!seen && !params.has('run') && !params.has('replay') && !params.has('quiet')) $('about').showModal();
});
window.CE_APP = S;
})();
