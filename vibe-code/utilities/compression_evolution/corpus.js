/* corpus.js — lazy loader for the bundled test files.

   Each file lives in corpus/<id>.js as one base64 string handed to CE_CORPUS_DATA().
   Script injection instead of fetch() so the page also works when opened straight
   from disk (file://), where fetch of a sibling file is blocked. Sizes and the
   reference compressors' results are in corpus_meta.js (generated, measured). */

(function (root) {
'use strict';
const CE = root.CE = root.CE || {};
const cache = new Map(), waiting = new Map();

root.CE_CORPUS_DATA = function (id, b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    cache.set(id, out);
    const w = waiting.get(id);
    if (w) { waiting.delete(id); w.forEach(f => f.resolve(out)); }
};

function load(id) {
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    const meta = CE.corpus.items.find(m => m.id === id);
    if (!meta) return Promise.reject(new Error('unknown corpus item ' + id));
    return new Promise((resolve, reject) => {
        if (waiting.has(id)) { waiting.get(id).push({ resolve, reject }); return; }
        waiting.set(id, [{ resolve, reject }]);
        const attempt = left => {
            const s = document.createElement('script');
            s.src = meta.file + (left < 2 ? '?retry=' + (2 - left) : '');
            s.onerror = () => {
                s.remove();
                if (left > 0) { setTimeout(() => attempt(left - 1), 500); return; }     // a dropped connection deserves a second try
                const w = waiting.get(id) || []; waiting.delete(id);
                w.forEach(f => f.reject(new Error('could not load ' + meta.file)));
            };
            document.head.appendChild(s);
        };
        attempt(2);
    });
}

CE.corpus = { items: typeof CE_CORPUS_META !== 'undefined' ? CE_CORPUS_META : [], load };
})(typeof self !== 'undefined' ? self : globalThis);
