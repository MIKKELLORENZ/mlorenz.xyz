/* pool.js — worker pool for fitness evaluation, plus one dedicated "exam" worker
   that compresses the WHOLE file with a champion, decompresses it again and
   checks every byte. Same code in the browser (Blob workers — those work from
   file:// too) and under Node (worker_threads), so the headless trainer and the
   page exercise one implementation. */

(function (root) {
'use strict';
const CE = root.CE = root.CE || {};
const IS_NODE = typeof window === 'undefined' && typeof require === 'function' && typeof process !== 'undefined' && !!process.versions && !!process.versions.node;

// Runs INSIDE the worker. Must be self-contained: it is shipped as source text.
//
// A dataset is a list of PARTS (files), each with its own shape. One part: the score
// is its compressed size in bytes. Several parts (the generalist): the score is the
// MEAN RATIO over the parts, scaled to 1,000,000 — every file counts the same whether
// it is 100 KB of text or 1 MB of pixels, and "bytes of a nominal 1 MB file" keeps the
// rest of the code unit-free.
function CE_WORKER_MAIN(codec) {
    const node = typeof self === 'undefined';
    let port = null;
    if (node) port = require('worker_threads').parentPort;
    const post = (m, t) => node ? port.postMessage(m, t || []) : self.postMessage(m, t || []);
    let sample = [], full = [], caches = [], cps = null;
    const score = (parts, sizes) => parts.length === 1 ? sizes[0] : Math.round(1e6 * sizes.reduce((a, v, i) => a + v / Math.max(1, parts[i].data.length), 0) / parts.length);
    function handle(m) {
        try {
            if (m.type === 'sample') {
                sample = m.parts; caches = sample.map(() => new Map());
                const n = sample.length === 1 ? sample[0].data.length : 0;
                cps = n > 4096 ? [n >> 2, n >> 1, (n >> 2) * 3] : null;
                post({ type: 'ready', id: m.id });
            } else if (m.type === 'full') { full = m.parts; post({ type: 'ready', id: m.id }); }
            else if (m.type === 'eval') {
                const t0 = Date.now(), caps = m.caps || null;
                if (sample.length === 1) {
                    const r = codec.measure(sample[0].data, m.genome, { shape: sample[0].shape, preCache: caches[0], checkpoints: cps, abortAbove: caps, maxBits: 20 });
                    post({ type: 'result', id: m.id, size: r.size, cum: r.cum, aborted: !!r.aborted, ms: Date.now() - t0 });
                    return;
                }
                const sizes = [], cum = [];
                let run = 0, aborted = false;
                for (let i = 0; i < sample.length; i++) {           // raced file by file
                    const r = codec.measure(sample[i].data, m.genome, { shape: sample[i].shape, preCache: caches[i], maxBits: 20 });
                    sizes.push(r.size);
                    run += 1e6 * r.size / Math.max(1, sample[i].data.length) / sample.length;
                    if (i < sample.length - 1) { cum.push(Math.round(run)); if (caps && run > caps[i]) { aborted = true; break; } }
                }
                post({ type: 'result', id: m.id, size: aborted ? 0 : score(sample, sizes), cum, aborted, ms: Date.now() - t0 });
            } else if (m.type === 'exam') {
                const parts = [], tr = [];
                let enc = 0, dec = 0, all = m.verify !== false ? true : null;
                for (const part of full) {
                    const t0 = Date.now(), r = codec.compress(part.data, m.genome, { shape: part.shape, costs: !!m.costs, stats: true, maxBits: 22 }), t1 = Date.now();
                    let ok = null, t2 = t1;
                    if (m.verify !== false) {
                        const back = codec.decompress(r.bytes);
                        t2 = Date.now(); ok = back.length === part.data.length;
                        for (let i = 0; ok && i < back.length; i++) if (back[i] !== part.data[i]) ok = false;
                        if (!ok) all = false;
                    }
                    enc += t1 - t0; dec += t2 - t1;
                    const o = { size: r.size, headerSize: r.headerSize, encMs: t1 - t0, decMs: t2 - t1, verified: ok, influence: r.influence, costs: r.costs, costsMapped: r.costsMapped, bytes: m.wantBytes ? r.bytes : null };
                    if (o.costs) tr.push(o.costs.buffer);
                    if (o.bytes) tr.push(o.bytes.buffer);
                    parts.push(o);
                }
                post({ type: 'result', id: m.id, size: score(full, parts.map(q => q.size)), parts, encMs: enc, decMs: dec, verified: all }, tr);
            } else if (m.type === 'decode') {
                const t0 = Date.now(), back = codec.decompress(m.data), head = codec.readHeader(m.data);
                post({ type: 'result', id: m.id, data: back, genome: head.genome, shape: head.shape, ms: Date.now() - t0 }, [back.buffer]);
            }
        } catch (err) { post({ type: 'result', id: m.id, error: String(err && err.stack || err), aborted: true }); }
    }
    if (node) port.on('message', handle); else self.onmessage = e => handle(e.data);
}

function workerSource() {
    return 'var CE_CODEC_FACTORY = ' + CE.codecSource + ';\nvar __codec = CE_CODEC_FACTORY();\n(' + CE_WORKER_MAIN.toString() + ')(__codec);\n';
}

function spawn(src) {
    if (IS_NODE) {
        const { Worker } = require('worker_threads');
        const w = new Worker(src, { eval: true });
        return { post: (m, t) => w.postMessage(m, t || []), on: fn => w.on('message', fn), onError: fn => w.on('error', fn), kill: () => w.terminate() };
    }
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), w = new Worker(url);
    return { post: (m, t) => w.postMessage(m, t || []), on: fn => { w.onmessage = e => fn(e.data); }, onError: fn => { w.onerror = fn; }, kill: () => { w.terminate(); URL.revokeObjectURL(url); } };
}

function Pool(opts) {
    opts = opts || {};
    const src = workerSource();
    this.size = Math.max(1, opts.workers || 2);
    this.workers = [];
    this.nextId = 1;
    this.pending = new Map();          // id -> { resolve, worker }
    this.queue = [];                   // waiting eval jobs
    this.onError = opts.onError || (e => { if (typeof console !== 'undefined') console.error(e); });
    for (let i = 0; i < this.size; i++) this.workers.push(this._wire(spawn(src), false));
    this.examWorker = this._wire(spawn(src), true);
    this.examBusy = false;
    this.examWaiting = new Map();      // slot -> { g, o, res }: only the newest request per slot waits
    this.examServed = new Map(); this.examTick = 0;
}
Pool.prototype._wire = function (h, isExam) {
    const w = { h, busy: false, isExam };
    h.on(m => {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        w.busy = false;
        if (m.error) this.onError(m.error);
        p.resolve(m);
        if (!isExam) this._pump();
    });
    h.onError(e => this.onError(e && e.message || e));
    return w;
};
Pool.prototype._send = function (w, msg, transfer) {
    return new Promise(resolve => { msg.id = this.nextId++; this.pending.set(msg.id, { resolve, worker: w }); w.busy = true; w.h.post(msg, transfer); });
};
Pool.prototype._pump = function () {
    for (const w of this.workers) {
        if (!this.queue.length) return;
        if (w.busy) continue;
        const job = this.queue.shift();
        this._send(w, { type: 'eval', genome: job.genome, caps: job.caps }).then(job.resolve);
    }
};
// parts: [{ data: Uint8Array, shape }]. Every worker gets its own copy of the sample
// parts; the exam worker gets the whole files.
Pool.prototype.setData = async function (sampleParts, fullParts) {
    const waits = this.workers.map(w => this._send(w, { type: 'sample', parts: sampleParts }));
    if (fullParts) waits.push(this._send(this.examWorker, { type: 'full', parts: fullParts }));
    await Promise.all(waits);
};
Pool.prototype.evaluate = function (jobs) {
    const ps = jobs.map(j => new Promise(resolve => this.queue.push({ genome: j.genome, caps: j.caps, resolve })));
    this._pump();
    return Promise.all(ps);
};
// Whole-file exams run one at a time. Requests carry a `slot` (one per species):
// a newer request for the same slot replaces an older one that has not started
// (that one resolves null); slots are then served round-robin.
Pool.prototype._examNext = function () {
    if (this.examBusy || !this.examWaiting.size) return;
    // negative priority = urgent (a user's restore); otherwise the slot that has waited
    // longest since it was last served goes first, so a fast-improving leader cannot
    // starve the other families of their exams
    // and `lazy` requests (the decode-and-compare of a champion) run only when nothing
    // else is waiting. A priority-0 slot (the leading family) is worth three turns.
    let pick = null, pickKey = Infinity;
    for (const [slot, w] of this.examWaiting) {
        const pr = w.o.priority || 0;
        const key = pr < 0 ? -1 : w.o.lazy ? 1e15 : (this.examServed.get(slot) || 0) + (pr === 0 ? -3 : 0) + pr * 1e-3;
        if (key < pickKey) { pick = [slot, w]; pickKey = key; }
    }
    this.examWaiting.delete(pick[0]);
    this.examServed.set(pick[0], ++this.examTick);
    const w = pick[1];
    this.examBusy = true;
    const msg = w.o.decode ? { type: 'decode', data: w.o.decode } : { type: 'exam', genome: w.g, costs: !!w.o.costs, verify: w.o.verify, wantBytes: !!w.o.wantBytes };
    this._send(this.examWorker, msg).then(r => { this.examBusy = false; w.res(r); this._examNext(); });
};
Pool.prototype.exam = function (genome, opts) {
    opts = opts || {};
    return new Promise(resolve => {
        const slot = opts.slot || 'champion', old = this.examWaiting.get(slot);
        if (old) old.res(null);
        this.examWaiting.set(slot, { g: genome, o: opts, res: resolve });
        this._examNext();
    });
};
Pool.prototype.decode = function (bytes) { return this.exam(null, { slot: 'decode', priority: -1, decode: bytes }); };
// a run was cancelled: forget what has not started yet (jobs in flight finish on their own)
Pool.prototype.flush = function () {
    for (const j of this.queue) j.resolve({ aborted: true });
    this.queue.length = 0;
    for (const [slot, w] of this.examWaiting) if (!w.o.decode) { w.res(null); this.examWaiting.delete(slot); }
};
Pool.prototype.terminate = function () {
    for (const w of this.workers) w.h.kill();
    this.examWorker.h.kill();
    for (const p of this.pending.values()) p.resolve({ aborted: true });
    for (const w of this.examWaiting.values()) w.res(null);
    for (const j of this.queue) j.resolve({ aborted: true });
    this.pending.clear(); this.examWaiting.clear(); this.queue.length = 0;
};

CE.Pool = Pool;
CE.workerSource = workerSource;
if (typeof module !== 'undefined' && module.exports) module.exports = CE;
})(typeof self !== 'undefined' ? self : globalThis);
