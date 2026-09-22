/* views.js — the two explanatory views.

   anatomy()  turns a genome into a readable sequence of steps. Every context expert
              gets a stencil: a small map of the bytes before (and, when the data has
              rows, above) the byte being coded. Solid square: a byte it reads. Hollow
              square: a prediction error it reads. Dot: part of a formula. Accent
              outline: the byte being coded. Shape carries the meaning, not colour.
   Bits       shows a file next to what the champion PAID for each byte of it — a map
              for images, tinted characters for text, a cost strip under the waveform
              for audio, a byte map for anything else. Magnitude is one neutral ramp
              with a scale; this is where "compression is prediction" becomes visible:
              flat background is nearly free, fur is not. */

(function (root) {
'use strict';
const CE = root.CE = root.CE || {};
const G = CE.genome, R = CE.render, el = R.el;

// ------------------------------------------------ neutral ramp from the tokens
const MAX_BITS = 6;                     // bits per byte at which the ramp saturates
let RAMP = null;
function hex(c) { const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); const v = m ? parseInt(m[1], 16) : 0x808080; return [v >> 16, (v >> 8) & 255, v & 255]; }
function ramp() {
    if (RAMP) return RAMP;
    const k = R.ink(), a = hex(k.heatLo), b = hex(k.heatHi);
    RAMP = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) { const t = Math.pow(i / 255, 0.85); for (let c = 0; c < 3; c++) RAMP[i * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * t); }
    return RAMP;
}
// readable ink on a ramp colour: whichever of the two text tokens contrasts more
function lum(r, g, b) { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function inkOn(r, g, b, K) { const L = lum(r, g, b), a = hex(K.text), c = hex(K.bg), ca = (Math.max(L, lum(a[0], a[1], a[2])) + 0.05) / (Math.min(L, lum(a[0], a[1], a[2])) + 0.05), cb = (Math.max(L, lum(c[0], c[1], c[2])) + 0.05) / (Math.min(L, lum(c[0], c[1], c[2])) + 0.05); return ca >= cb ? K.text : K.bg; }
function rampIndex(bitsPerByte) { const v = Math.round(bitsPerByte / MAX_BITS * 255); return v < 0 ? 0 : v > 255 ? 255 : v; }

// ---------------------------------------------------------------- stencil
// Offsets are [rows, units, bytes]; the map draws a unit as `unit` cells wide.
function stencil(terms, ctx, unit) {
    const rowsOn = !!ctx.hasRows && ctx.kind !== 'sorted', U = ctx.hasUnits && ctx.kind !== 'sorted' ? Math.max(1, Math.min(4, unit || 3)) : 1;
    const C = Math.min(10, Math.max(6, 3 * U)), rows = rowsOn ? 3 : 1, cells = new Map();
    const put = (o, kind, neg) => {
        const a = rowsOn ? o[0] : 0, col = -(ctx.hasUnits && ctx.kind !== 'sorted' ? o[1] * U + o[2] : o[1] + o[2]);
        if ((!rowsOn && o[0] > 0) || a >= rows || Math.abs(col) > C || (a === 0 && col >= 0)) return;
        cells.set(a + ':' + col, { kind, neg });
    };
    for (const t of terms) {
        if (t.t === 'x') put(t.o, 'x');
        else if (t.t === 'r') put(t.o, 'r');
        else if (t.t === 'lin') for (const [o, c] of t.taps) put(o, 'lin', c < 0);
        else if (t.t === 'ord') for (let k = 1; k <= t.n; k++) put([0, 0, k], 'x');
    }
    if (!cells.size) return null;
    const K = R.ink(), px = 12, dpr = Math.min(2, window.devicePixelRatio || 1), W = (2 * C + 1) * px, H = rows * px;
    const cv = document.createElement('canvas');
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    for (let r = 0; r < rows; r++) for (let c = -C; c <= C; c++) {
        const a = rows - 1 - r, x = (c + C) * px, y = r * px, future = a === 0 && c > 0, here = a === 0 && c === 0, cell = cells.get(a + ':' + c);
        if (!future) { g.fillStyle = K.hair; g.fillRect(x + 1, y + 1, px - 2, px - 2); if (U > 1 && ((c % U) + U) % U === 0) g.fillRect(x + 1, y + 1, px - 2, px - 2); }
        if (cell) {
            g.fillStyle = K.ink1; g.strokeStyle = K.ink1; g.lineWidth = 1.5;
            if (cell.kind === 'x') g.fillRect(x + 2, y + 2, px - 4, px - 4);
            else if (cell.kind === 'r') g.strokeRect(x + 2.75, y + 2.75, px - 5.5, px - 5.5);
            else { g.beginPath(); g.arc(x + px / 2, y + px / 2, 2.5, 0, Math.PI * 2); if (cell.neg) g.stroke(); else g.fill(); }
        }
        if (here) { g.strokeStyle = K.accent; g.lineWidth = 1.5; g.strokeRect(x + 1.75, y + 1.75, px - 3.5, px - 3.5); }
    }
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Map of the bytes this expert reads');
    cv.title = (rowsOn ? 'Rows of the data, newest at the bottom. ' : 'The bytes just before the one being coded. ') + 'Outlined: the byte being coded. Solid: a byte it reads. Hollow: a prediction error it reads. Dot: part of a formula (ring = subtracted).' + (U > 1 ? ' Stronger columns share the channel of the current byte; a unit is drawn ' + U + ' bytes wide.' : '');
    return cv;
}

// ---------------------------------------------------------------- anatomy
const TAG = { pre: 'Transform', front: 'Predict', mixer: 'Mix', apm: 'Refine', coder: 'Code' };
function anatomy(host, genome, ctx, influence, unit) {
    host.textContent = '';
    if (!genome) return;
    const d = G.describe(genome, ctx), experts = d.blocks.filter(b => b.kind === 'expert'), late = [];
    let expertsDone = false;
    const step = (tag, title, idle) => { const s = el('div', 'step'), body = el('div', idle ? 'idle' : ''); s.appendChild(el('span', 'step-tag', tag)); body.appendChild(el('h3', '', title)); s.appendChild(body); return { s, body }; };
    for (const b of d.blocks) {
        if (b.kind === 'expert') {
            if (expertsDone) continue;
            expertsDone = true;
            const { s, body } = step('Model', experts.length + (experts.length === 1 ? ' expert bets' : ' experts bet') + ' on every next bit'), list = el('div', 'experts');
            for (const e of experts) {
                const item = el('div', 'expert'), share = influence && influence[e.index] !== undefined ? influence[e.index] : null;
                item.appendChild(el('h4', '', (e.index + 1) + '. ' + e.title));
                const sh = el('span', 'share', share === null ? '' : Math.round(share * 100) + '% of the say');
                sh.title = 'Share of the mixer’s attention this expert earned over the whole file';
                item.appendChild(sh);
                if (!e.match) { const cv = stencil(e.terms, e.ctx || ctx, unit); if (cv) item.appendChild(cv); }
                item.appendChild(el('p', '', e.text));
                if (share !== null) { const m = el('div', 'meter'), i = el('i'); i.style.width = Math.max(1, Math.round(share * 100)) + '%'; m.appendChild(i); item.appendChild(m); }
                list.appendChild(item);
            }
            body.appendChild(list); host.appendChild(s);
            continue;
        }
        const { s, body } = step(TAG[b.kind] || '', b.title, b.idle);
        if (b.lines) for (const l of b.lines) { const f = el('div', 'formula'); f.appendChild(el('em', '', l.label + '  ')); f.appendChild(document.createTextNode('x̂ = ' + l.formula)); body.appendChild(f); }
        body.appendChild(el('p', '', b.text));
        if (b.kind === 'pre' || b.kind === 'front') host.appendChild(s); else late.push(s);
    }
    if (late.length) {                                   // how the bets are combined: one disclosure away
        const det = el('details'), sum = el('summary', '', 'How the bets are combined and coded');
        det.appendChild(sum);
        const inner = el('div', 'steps'); inner.style.marginTop = '0';
        late.forEach(s => inner.appendChild(s));
        det.appendChild(inner); host.appendChild(det);
    }
}

// ------------------------------------------------------- where the bits go
function Bits(host, sub, scale, probe) {
    this.host = host; this.sub = sub; this.scale = scale; this.probe = probe;
    this.item = null; this.data = null; this.info = null; this.costs = null; this.mapped = true;
    this.mode = 'spent';                 // or 'saved': 8 bits minus what was paid
    new ResizeObserver(() => { if (this.kind === 'audio') this._drawAudio(); }).observe(host);
    R.onTheme(() => { RAMP = null; this.redraw(); });
}
Bits.prototype.shape = function () {
    const it = this.item || {}, info = this.info;
    if (it.kind === 'image' && it.width) return { kind: 'image', w: it.width, h: it.height, ch: it.channels || 3 };
    if (it.kind === 'audio') return { kind: 'audio', ch: it.channels || 1 };
    if (it.kind === 'text' || (info && info.texty)) return { kind: 'text' };
    if (info && info.shape) return { kind: 'image', w: info.shape.w, h: info.shape.h, ch: info.shape.ch, guessed: true };
    if (info && info.looks16) return { kind: 'audio', ch: info.period === 4 ? 2 : 1, off: info.off16 || 0 };
    return { kind: 'bytes', w: info && info.strides.length && info.strides[0] <= 1024 ? info.strides[0] : 256 };
};
Bits.prototype.setData = function (item, data, info) {
    this.item = item; this.data = data; this.info = info; this.costs = null; this.mapped = true;
    const sh = this.shp = this.shape();
    this.kind = sh.kind;
    this.host.textContent = ''; this.host.className = 'bits' + (sh.kind === 'text' || sh.kind === 'audio' ? ' single' : '');
    this.scale.hidden = true; this.probe.textContent = '';
    const fig = (caption, cls) => { const f = el('figure'), cv = document.createElement('canvas'); if (cls) cv.className = cls; f.appendChild(el('figcaption', '', caption)); f.appendChild(cv); this.host.appendChild(f); return cv; };
    if (sh.kind === 'text') { this.textEl = el('div', 'bits-text'); this.host.appendChild(this.textEl); }
    else if (sh.kind === 'audio') { this.cvA = fig('The waveform, and under it the bits spent at each moment', 'wave'); this.cvB = null; }
    else {
        this.cvA = fig(sh.kind === 'image' ? 'The file' + (sh.guessed ? ' — its shape, ' + sh.w + ' × ' + sh.h + ', was worked out from its periodicity' : '') : 'The bytes, one pixel each, ' + sh.w + ' to a row', sh.kind === 'bytes' ? 'px' : '');
        this.cvB = fig('Bits spent on each ' + (sh.kind === 'image' ? 'pixel' : 'byte'), sh.kind === 'bytes' ? 'px' : '');
        for (const cv of [this.cvA, this.cvB]) { cv.addEventListener('pointermove', e => this._probe(e, cv)); cv.addEventListener('pointerleave', () => { this.probe.textContent = ''; }); }
    }
    this.redraw();
};
Bits.prototype.setMode = function (mode) { this.mode = mode === 'saved' ? 'saved' : 'spent'; this.redraw(); };
// cost of byte i in eighths of a bit, as the current mode sees it
Bits.prototype._v = function (c, i) { return this.mode === 'saved' ? Math.max(0, 64 - c[i]) : c[i]; };
Bits.prototype.setCosts = function (costs, mapped) { this.costs = costs || null; this.mapped = mapped !== false; this.scale.hidden = !costs; this.redraw(); };
Bits.prototype.redraw = function () {
    if (!this.data) return;
    if (this.kind === 'text') this._drawText(); else if (this.kind === 'audio') this._drawAudio(); else { this._drawOriginal(); this._drawCost(); }
    if (!this.costs) { this.sub.textContent = 'What the design pays for every byte. It appears once a first champion has been run on the whole file.'; return; }
    let tot = 0;
    for (let i = 0; i < this.costs.length; i++) tot += this.costs[i];
    this.sub.textContent = 'The champion pays ' + (tot / 8 / Math.max(1, this.costs.length)).toFixed(2) + ' bits for an average byte of this file; 8 would be no compression.' + (this.mapped ? '' : ' This design sorts the file first, so the costs are shown in sorted order rather than file order.');
};
Bits.prototype._size = function (cv, w, h) { if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } return cv.getContext('2d'); };
Bits.prototype._drawOriginal = function () {
    const sh = this.shp, d = this.data;
    if (sh.kind === 'image') {
        const g = this._size(this.cvA, sh.w, sh.h), im = g.createImageData(sh.w, sh.h), px = im.data, ch = sh.ch;
        for (let i = 0, o = 0, q = 0; i < sh.w * sh.h; i++, o += ch, q += 4) { px[q] = d[o]; px[q + 1] = ch > 1 ? d[o + 1] : d[o]; px[q + 2] = ch > 2 ? d[o + 2] : d[o]; px[q + 3] = 255; }
        g.putImageData(im, 0, 0);
    } else {
        const w = sh.w, h = Math.max(1, Math.min(512, Math.ceil(d.length / w))), g = this._size(this.cvA, w, h), im = g.createImageData(w, h), px = im.data;
        for (let i = 0, q = 0; i < w * h; i++, q += 4) { const v = i < d.length ? d[i] : 0; px[q] = px[q + 1] = px[q + 2] = v; px[q + 3] = i < d.length ? 255 : 0; }
        g.putImageData(im, 0, 0);
    }
};
Bits.prototype._drawCost = function () {
    const sh = this.shp, c = this.costs, cv = this.cvB, RP = ramp();
    if (!cv) return;
    const w = sh.w, h = sh.kind === 'image' ? sh.h : Math.max(1, Math.min(512, Math.ceil(this.data.length / w))), g = this._size(cv, w, h);
    const im = g.createImageData(w, h), px = im.data, ch = sh.kind === 'image' ? sh.ch : 1;
    for (let i = 0, o = 0, q = 0; i < w * h; i++, o += ch, q += 4) {
        let s = 0;
        if (c) for (let k = 0; k < ch; k++) s += o + k < c.length ? this._v(c, o + k) : 0;
        const r = rampIndex(s / 8 / ch * (this.mode === 'saved' ? 0.75 : 1)) * 3;
        px[q] = RP[r]; px[q + 1] = RP[r + 1]; px[q + 2] = RP[r + 2]; px[q + 3] = !c || o < c.length ? 255 : 0;
    }
    g.putImageData(im, 0, 0);
};
Bits.prototype._probe = function (e, cv) {
    const sh = this.shp, r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * cv.width), y = Math.floor((e.clientY - r.top) / r.height * cv.height);
    if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) { this.probe.textContent = ''; return; }
    const ch = sh.kind === 'image' ? sh.ch : 1, o = (y * cv.width + x) * ch;
    let txt = sh.kind === 'image' ? 'Pixel ' + x + ', ' + y : 'Byte ' + o.toLocaleString();
    if (this.costs && o < this.costs.length) { let sum = 0; for (let k = 0; k < ch; k++) sum += this.costs[o + k] || 0; txt += ' cost ' + (sum / 8).toFixed(1) + ' of its ' + ch * 8 + ' bits, saving ' + Math.max(0, ch * 8 - sum / 8).toFixed(1); }
    this.probe.textContent = txt;
};
Bits.prototype._drawText = function () {
    const host = this.textEl, d = this.data, c = this.mapped ? this.costs : null, SHOW = 6000, RP = ramp(), K = R.ink();
    // open a quarter of the way in, at the start of a line: by then the model is warm,
    // and what is left is the steady pattern (word beginnings cost, endings are free)
    let from = 0;
    if (d.length > SHOW * 2) { from = Math.floor(d.length / 4); while (from < d.length - SHOW && d[from - 1] !== 10) from++; }
    const N = Math.min(d.length, from + SHOW), frag = document.createDocumentFragment();
    host.textContent = '';
    let run = '', bucket = -1;
    const flush = () => {
        if (!run) return;
        const s = el('span', '', run);
        if (bucket > 0) { const r = Math.round(bucket / 15 * 255) * 3; s.style.background = 'rgb(' + RP[r] + ',' + RP[r + 1] + ',' + RP[r + 2] + ')'; s.style.color = inkOn(RP[r], RP[r + 1], RP[r + 2], K); }
        frag.appendChild(s); run = '';
    };
    for (let i = from; i < N; i++) {
        const b = c ? Math.min(15, Math.round(this._v(c, i) / 8 / (this.mode === 'saved' ? 8 : MAX_BITS) * 15)) : -1, v = d[i];
        if (b !== bucket) { flush(); bucket = b; }
        run += v === 10 ? '\n' : v === 9 ? '\t' : v === 13 ? '' : (v >= 32 && v < 127) ? String.fromCharCode(v) : '·';
    }
    flush();
    host.appendChild(frag);
    if (N - from < d.length) host.appendChild(el('p', 'small', 'Bytes ' + from.toLocaleString() + ' to ' + N.toLocaleString() + ' of ' + d.length.toLocaleString() + '.'));
};
Bits.prototype._drawAudio = function () {
    const cv = this.cvA;
    if (!cv || this.kind !== 'audio') return;
    const K = R.ink(), RP = ramp(), dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.max(50, Math.round(cv.clientWidth * dpr)), H = Math.max(40, Math.round(cv.clientHeight * dpr));
    const base = this.shp.off || 0, d = base ? this.data.subarray(base) : this.data, g = this._size(cv, W, H), ch = this.shp.ch, frame = 2 * ch, frames = Math.floor(d.length / frame);
    const c = this.mapped && this.costs ? (base ? this.costs.subarray(base) : this.costs) : null;
    g.clearRect(0, 0, W, H);
    const waveH = c ? Math.round(H * 0.7) : H, mid = waveH / 2;
    let peak = 1;
    for (let f = 0; f < frames; f += 7) { const v = Math.abs(((d[f * frame + 1] << 8 | d[f * frame]) << 16) >> 16); if (v > peak) peak = v; }
    for (let x = 0; x < W; x++) {
        const f0 = Math.floor(x / W * frames), f1 = Math.max(f0 + 1, Math.floor((x + 1) / W * frames));
        let lo = 32767, hi = -32768;
        for (let f = f0; f < f1; f++) { const v = ((d[f * frame + 1] << 8 | d[f * frame]) << 16) >> 16; if (v < lo) lo = v; if (v > hi) hi = v; }
        const y0 = mid - hi / peak * (mid - 4), y1 = mid - lo / peak * (mid - 4);
        g.fillStyle = K.ink1; g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        if (c) {
            let s = 0;
            for (let i = f0 * frame; i < f1 * frame; i++) s += this._v(c, i);
            const r = rampIndex(s / 8 / Math.max(1, (f1 - f0) * frame) * (this.mode === 'saved' ? 0.75 : 1)) * 3;
            g.fillStyle = 'rgb(' + RP[r] + ',' + RP[r + 1] + ',' + RP[r + 2] + ')';
            g.fillRect(x, waveH + 8 * dpr, 1, H - waveH - 8 * dpr);
        }
    }
};

CE.views = { anatomy, stencil, Bits };
})(typeof self !== 'undefined' ? self : globalThis);
