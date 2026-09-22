#!/usr/bin/env node
/* train_headless.js — the same run as the page (run.js), from a terminal.

     node train_headless.js --data all --minutes 40 --workers 5      ONE design for every bundled file
     node train_headless.js --data cat --minutes 20 --workers 5      a specialist
     node train_headless.js --file some.bin --gens 300

   --data     all, or a corpus id (cat, alice, guitar, meow, code)   |   --file  any path (--skip N drops a header)
   --sample   fitness sample in KB (default 64; 0 = whole file)
   --pop / --experts / --seed
   --out      where the record goes (default training/<name>.json) — bake_champions.js
              turns those records into champions.js, which the page can replay
   --resume   continue the run recorded in --out (its lines, its designs, its generation count)
   --from     start from the designs of ANOTHER record, e.g. a specialist from the generalist:
              node train_headless.js --data cat --from training/all.json

   This machine is shared: keep --workers at 4-6. */
'use strict';
const fs = require('fs'), path = require('path');
const CE = require('./codec.js');
require('./analyze.js'); require('./genome.js'); require('./evolution.js'); require('./pool.js'); require('./run.js');
const { loadDataset } = require('./corpus_node.js');

function args() {
    const a = {}, v = process.argv.slice(2);
    for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) { const k = v[i].slice(2); a[k] = (i + 1 < v.length && !v[i + 1].startsWith('--')) ? v[++i] : true; }
    return a;
}
const A = args();

(async function main() {
    let dataset;
    if (A.file) { const data = new Uint8Array(fs.readFileSync(A.file)).subarray(+A.skip || 0), info = CE.analyze.analyze(data); if (A.kind) info.kind = A.kind; dataset = { id: path.basename(A.file).replace(/\W+/g, '_'), parts: [{ id: 'file', data, info }] }; }
    else dataset = loadDataset(A.data || 'all', CE.analyze.analyze);
    const name = dataset.id, baselines = CE.Run.baselines(dataset.parts), info = CE.analyze.context(dataset.parts.map(p => p.info));
    const workers = Math.max(1, +(A.workers || 4)), out = A.out || path.join(__dirname, 'training', name + '.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    for (const p of dataset.parts) console.log(`${p.id.padEnd(8)} ${String(p.data.length).padStart(8)} bytes  ${p.info.kind.padEnd(6)} shape ${JSON.stringify(CE.analyze.shapeOf(p.info))}`);
    console.log(`${dataset.parts.length > 1 ? 'GENERALIST: one design, scored by its mean ratio over ' + dataset.parts.length + ' files' : 'specialist for ' + name}, ${workers} workers`);

    let history = null;
    if (A.resume && fs.existsSync(out)) { const prev = JSON.parse(fs.readFileSync(out, 'utf8')); if (prev.genome) { history = prev; console.log('resuming from', prev.pct + '% at generation', prev.gens); } }
    let seeds = [], seedNote = '';
    if (A.from && !history) { const src = JSON.parse(fs.readFileSync(A.from, 'utf8')); seeds = Object.values(src.families || {}).map(f => f.genome).filter(Boolean).concat(src.pop || [], src.genome ? [src.genome] : []); seedNote = 'carried over: the design evolved for ' + (src.dataset === 'all' ? 'all files' : src.dataset) + ', as the starting point'; console.log('starting from ' + seeds.length + ' designs of ' + A.from); }
    const pool = new CE.Pool({ workers, onError: e => console.error('worker:', e) });
    const run = new CE.Run({
        dataset, pool, baselines, history, seeds, seedNote,
        settings: { sampleKB: A.sample === undefined ? 64 : +A.sample, pop: +(A.pop || 40), experts: +(A.experts || 12), seed: +(A.seed || 1) },
        on: { log: e => { if (e.kind !== 'champion' || A.verbose) console.log(`      · gen ${e.gen}: ${e.headline} ${e.text}`.slice(0, 200)); } }
    });
    await run.prepare();
    console.log(`fitness sample ${run.stats().sampleBytes} bytes → ${path.relative(process.cwd(), out)}`);

    const t0 = Date.now(), maxGens = +(A.gens || 1e9), maxMs = (+(A.minutes || (A.gens ? 1e6 : 5))) * 60000;
    const m0 = history ? history.minutes || 0 : 0;
    const save = () => { const rec = run.record(); rec.minutes = +(m0 + (Date.now() - t0) / 60000).toFixed(1); fs.writeFileSync(out, JSON.stringify(rec)); };
    let lastPrint = 0, lastSave = 0;
    while (run.evo.gen < maxGens && Date.now() - t0 < maxMs) {
        await run.generation();
        const now = Date.now();
        if (now - lastPrint > 5000 || run.evo.gen <= 2) {
            lastPrint = now;
            const st = run.stats(), sp = st.leaders.map(s => { const r = run.species.get(s.species); return `${s.species}${s.extinct ? '†' : ''} ${r && r.best ? r.best.pct.toFixed(2) : '  ?  '}%×${s.count}`; }).join('  ');
            console.log(`gen ${String(st.gen).padStart(5)}  best ${run.champion ? run.champion.pct.toFixed(3) + '%' : '   -   '}  ${st.evals} designs (${st.aborted} raced out) ${st.msPerEval.toFixed(0)}ms each  ${st.seconds.toFixed(0)}s | ${sp} | stagnant ${st.stagnant}`);
        }
        if (now - lastSave > 30000 && run.champion) { lastSave = now; save(); }
    }
    // let the exam queue drain, then make sure the champion is verified
    for (let k = 0; k < 600 && (pool.examBusy || pool.examWaiting.size); k++) await new Promise(r => setTimeout(r, 100));
    const c = run.champion;
    if (c && c.verified !== true) { const v = await pool.exam(c.genome, { slot: 'final', costs: false }); c.verified = v.verified; }
    save();
    console.log(`\nbest: ${c.pct.toFixed(3)}% (generation ${c.gen}), round trip ${c.verified ? 'verified' : 'NOT VERIFIED'}`);
    c.parts.forEach((q, i) => { const p = dataset.parts[i], refs = (p.meta ? p.meta.baselines : []).filter(b => b.family !== 'bound').sort((a, b) => a.bytes - b.bytes); console.log(`  ${p.id.padEnd(8)} ${String(q.size).padStart(8)} bytes ${(100 * q.size / p.data.length).toFixed(2).padStart(6)}%` + (refs.length ? `   (best tool: ${refs[0].name} ${(100 * refs[0].bytes / p.data.length).toFixed(2)}%, gzip ${(100 * refs.find(b => b.id === 'gzip').bytes / p.data.length).toFixed(2)}%)` : '')); });
    console.log(CE.genome.shortName(c.genome));
    for (const b of CE.genome.describe(c.genome, info).blocks) console.log('  [' + b.title + '] ' + (b.lines ? b.lines.map(l => l.label + ': ' + l.formula).join(' | ') + ' — ' : '') + b.text.slice(0, 160));
    pool.terminate();
})().catch(e => { console.error(e); process.exit(1); });
