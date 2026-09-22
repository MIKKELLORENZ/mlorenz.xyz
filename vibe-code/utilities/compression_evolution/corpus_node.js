/* corpus_node.js — reads the browser's corpus files (base64 inside JS) under Node,
   for the headless trainer and the test suite. */
'use strict';
const fs = require('fs'), path = require('path');
const META = require('./corpus_meta.js');

function loadCorpus(id) {
    const meta = META.find(m => m.id === id);
    if (!meta) throw new Error('unknown corpus id "' + id + '" — have: ' + META.map(m => m.id).join(', '));
    const src = fs.readFileSync(path.join(__dirname, meta.file), 'utf8');
    const m = /CE_CORPUS_DATA\("([^"]+)",\s*"([^"]*)"\)/.exec(src);
    if (!m || m[1] !== id) throw new Error('malformed corpus file ' + meta.file);
    const data = new Uint8Array(Buffer.from(m[2], 'base64'));
    if (data.length !== meta.bytes) throw new Error(id + ': expected ' + meta.bytes + ' bytes, got ' + data.length);
    return { id, kind: meta.kind, meta, data };
}
// "all" = the generalist's dataset: every bundled file, one design judged on all of them
function loadDataset(id, analyze) {
    const ids = id === 'all' ? META.map(m => m.id) : [id];
    const parts = ids.map(i => { const c = loadCorpus(i), info = analyze(c.data); info.kind = c.kind; return { id: i, title: c.meta.title, data: c.data, info, meta: c.meta }; });
    return { id, parts };
}
module.exports = { loadCorpus, loadDataset, META };
