/* render.js — the score chart, its legend and tooltip, the standings and the log.

   Chart rules: one axis (% of original, log — ratios are what compression is about);
   the SELECTED family is the only coloured mark (accent = selection, as everywhere else
   on the page), the other families are neutral ink and are told apart by direct labels
   at their line ends, never by hue; reference tools are hairlines whose labels sit in
   the right margin, pushed apart with leaders instead of overlapping; grid and axes are
   solid hairlines; text never wears a data colour; the crosshair finds the X and one
   tooltip lists every family; the standings list is the table twin, so no value is
   reachable by hover only. All ink comes from the CSS tokens (light and dark). */

(function (root) {
'use strict';
const CE = root.CE = root.CE || {};
const G = CE.genome;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function pctText(p) { return p >= 99.95 ? '100%' : p.toFixed(2) + '%'; }
function niceStep(range, target) {
    const raw = range / Math.max(1, target), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}
// design tokens, for canvases
let INK = null;
function ink() {
    if (INK) return INK;
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    INK = { bg: v('--bg'), bg2: v('--bg-2'), text: v('--text'), text2: v('--text-2'), hair: v('--hairline'), hair2: v('--hairline-2'), accent: v('--accent'), ink1: v('--ink-1'), ink2: v('--ink-2'), ink3: v('--ink-3'), heatLo: v('--heat-lo'), heatHi: v('--heat-hi'), font: v('--font') };
    return INK;
}
const themeListeners = [];
function onTheme(fn) { themeListeners.push(fn); }
if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { INK = null; themeListeners.forEach(f => f()); });

// ------------------------------------------------------------------ chart
function Chart(canvas, tip, legend, onSelect) {
    this.canvas = canvas; this.tip = tip; this.legend = legend; this.onSelect = onSelect || null;
    this.ctx = canvas.getContext('2d');
    this.baselines = [];               // { id, name, pct, how }
    this.series = new Map();           // family -> { points: [{ gen, pct, m }], extinct: gen|0 }
    this.selected = null;              // the family drawn in the accent colour
    this.maxGen = 0;
    this.hoverGen = null;
    new ResizeObserver(() => this.draw()).observe(canvas.parentElement);
    onTheme(() => this.draw());
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.addEventListener('pointermove', e => this._hover(e));
    canvas.addEventListener('pointerleave', () => { this.hoverGen = null; this.tip.hidden = true; this.draw(); });
    canvas.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const g = this.hoverGen === null ? this.maxGen : this.hoverGen;
        this.hoverGen = Math.max(0, Math.min(this.maxGen, g + (e.key === 'ArrowRight' ? 1 : -1) * Math.max(1, Math.round(this.maxGen / 60))));
        this.draw(); this._showTip();
    });
    canvas.addEventListener('blur', () => { this.hoverGen = null; this.tip.hidden = true; this.draw(); });
}
Chart.prototype.reset = function (baselines) { this.baselines = baselines || []; this.series = new Map(); this.maxGen = 0; this.hoverGen = null; this.selected = null; this.tip.hidden = true; this.draw(); this.drawLegend(); };
// points: [{ gen, pct, m }] — m = measured on the whole data (drawn as a dot); the rest
// are estimates from the fitness sample, calibrated by the last measurement
Chart.prototype.setSeries = function (family, points) {
    let s = this.series.get(family);
    if (!s) { s = { points: [], extinct: 0 }; this.series.set(family, s); }
    s.points = points;
    this.draw(); this.drawLegend();
};
Chart.prototype.select = function (family) { if (this.selected !== family) { this.selected = family; this.draw(); this.drawLegend(); } };
Chart.prototype.lastMeasured = function (family) {
    const s = this.series.get(family);
    if (!s) return null;
    for (let i = s.points.length - 1; i >= 0; i--) if (s.points[i].m) return s.points[i];
    return null;
};
Chart.prototype.setExtinct = function (family, gen) { const s = this.series.get(family); if (s) { s.extinct = gen; this.draw(); this.drawLegend(); } };
Chart.prototype.setGen = function (gen) { if (gen !== this.maxGen) { this.maxGen = gen; this.draw(); } };
Chart.prototype.valueAt = function (family, gen) {
    const s = this.series.get(family);
    if (!s) return null;
    let v = null;
    for (const p of s.points) { if (p.gen <= gen) v = p; else break; }
    return v;
};
Chart.prototype.best = function () {                  // measured values only
    let b = null;
    for (const sp of this.series.keys()) { const p = this.lastMeasured(sp); if (p && (!b || p.pct < b.pct)) b = { species: sp, pct: p.pct }; }
    return b;
};
Chart.prototype._scales = function () {
    const c = this.canvas, w = c.clientWidth, h = c.clientHeight, narrow = w < 520;
    const m = { l: 44, r: narrow ? 112 : 176, t: 12, b: 28 };
    let lo = 100;
    for (const b of this.baselines) lo = Math.min(lo, b.pct);
    for (const s of this.series.values()) for (const p of s.points) lo = Math.min(lo, p.pct);
    lo = Math.max(0.5, lo * 0.88);
    const hi = 104, xMax = Math.max(30, Math.ceil(this.maxGen * 1.06));
    const pw = Math.max(10, w - m.l - m.r), ph = Math.max(10, h - m.t - m.b), ll = Math.log(lo), lh = Math.log(hi);
    return { w, h, m, pw, ph, lo, hi, xMax, narrow, x: g => m.l + g / xMax * pw, y: p => m.t + (lh - Math.log(Math.max(lo, Math.min(hi, p)))) / (lh - ll) * ph, gx: px => (px - m.l) / pw * xMax };
};
Chart.prototype._order = function () {                 // selected family last = on top
    const o = G.SPECIES_ORDER.filter(sp => this.series.has(sp) && this.series.get(sp).points.length);
    return o.filter(sp => sp !== this.selected).concat(o.filter(sp => sp === this.selected));
};
Chart.prototype.draw = function () {
    const c = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
    if (w < 20 || h < 20) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = this.ctx, S = this._scales(), m = S.m, K = ink();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '12px ' + K.font; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineCap = 'round';

    // ---- y grid: clean percentages on a log axis
    const ticks = [100, 80, 60, 50, 40, 30, 25, 20, 15, 10, 8, 6, 5, 4, 3, 2, 1.5, 1].filter(t => t >= S.lo && t <= 100);
    let lastY = -99;
    g.textAlign = 'right';
    for (const t of ticks) {
        const y = Math.round(S.y(t)) + 0.5;
        if (Math.abs(y - lastY) < 20) continue;
        lastY = y;
        g.strokeStyle = K.hair; g.lineWidth = 1; g.beginPath(); g.moveTo(m.l, y); g.lineTo(m.l + S.pw, y); g.stroke();
        g.fillStyle = K.text2; g.fillText(t + '%', m.l - 8, y);
    }
    // ---- x axis
    g.strokeStyle = K.hair2; g.beginPath(); g.moveTo(m.l, m.t + S.ph + 0.5); g.lineTo(m.l + S.pw, m.t + S.ph + 0.5); g.stroke();
    const xs = niceStep(S.xMax, Math.max(3, Math.floor(S.pw / 90)));
    g.textAlign = 'center'; g.fillStyle = K.text2;
    for (let t = 0; t <= S.xMax; t += xs) g.fillText(String(Math.round(t)), S.x(t), m.t + S.ph + 14);

    // ---- reference tools: hairlines, labels in the right margin (pushed apart, with leaders)
    const best = this.best(), labels = [];
    for (const b of this.baselines) {
        const y = S.y(b.pct);
        g.strokeStyle = K.hair2; g.lineWidth = 1;
        g.beginPath(); g.moveTo(m.l, Math.round(y) + 0.5); g.lineTo(m.l + S.pw, Math.round(y) + 0.5); g.stroke();
        labels.push({ y, ly: y, b, beaten: !!(best && best.pct < b.pct) });
    }
    labels.sort((a, b2) => a.y - b2.y);
    const gap = 15, top = m.t + 6, bot = m.t + S.ph - 4;
    for (let i = 1; i < labels.length; i++) if (labels[i].ly - labels[i - 1].ly < gap) labels[i].ly = labels[i - 1].ly + gap;
    if (labels.length && labels[labels.length - 1].ly > bot) {
        labels[labels.length - 1].ly = bot;
        for (let i = labels.length - 2; i >= 0; i--) if (labels[i + 1].ly - labels[i].ly < gap) labels[i].ly = labels[i + 1].ly - gap;
    }
    g.textAlign = 'left';
    for (const L of labels) {
        if (L.ly < top) continue;
        const x0 = m.l + S.pw, x1 = x0 + 12;
        g.strokeStyle = K.hair2; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x0, Math.round(L.y) + 0.5); g.lineTo(x1 - 3, Math.round(L.ly) + 0.5); g.stroke();
        g.fillStyle = K.text2;
        let name = L.b.name.replace('Huffman-style (byte frequencies only)', 'Byte frequencies').replace(' lossless', '').replace(' (7-Zip)', '');
        let txt = name + '  ' + L.b.pct.toFixed(1);
        while (g.measureText(txt).width > m.r - 14 && name.length > 5) { name = name.slice(0, -2); txt = name + '…  ' + L.b.pct.toFixed(1); }
        g.fillText(txt, x1, L.ly);
    }

    // ---- families: the selected one in the accent, the others in neutral ink
    const order = this._order(), ends = [];
    for (const sp of order) {
        const s = this.series.get(sp), pts = s.points, sel = sp === this.selected, col = sel ? K.accent : s.extinct ? K.ink3 : K.ink2;
        const endGen = Math.max(s.extinct || this.maxGen, pts[pts.length - 1].gen);
        g.strokeStyle = col; g.lineWidth = sel ? 2 : 1.5;
        g.beginPath(); g.moveTo(S.x(pts[0].gen), S.y(pts[0].pct));
        for (let i = 1; i < pts.length; i++) { g.lineTo(S.x(pts[i].gen), S.y(pts[i - 1].pct)); g.lineTo(S.x(pts[i].gen), S.y(pts[i].pct)); }
        g.lineTo(S.x(endGen), S.y(pts[pts.length - 1].pct));
        g.stroke();
        if (pts.length <= 400) for (const p of pts) if (p.m) {        // measured: small dots ringed in the surface colour
            g.beginPath(); g.arc(S.x(p.gen), S.y(p.pct), 3.5, 0, Math.PI * 2); g.fillStyle = K.bg; g.fill();
            g.beginPath(); g.arc(S.x(p.gen), S.y(p.pct), 2, 0, Math.PI * 2); g.fillStyle = col; g.fill();
        }
        const last = pts[pts.length - 1], ex = S.x(endGen), ey = S.y(last.pct);
        g.beginPath(); g.arc(ex, ey, 6, 0, Math.PI * 2); g.fillStyle = K.bg; g.fill();
        g.beginPath(); g.arc(ex, ey, 4, 0, Math.PI * 2); g.fillStyle = col; g.fill();
        if (!last.m) { g.beginPath(); g.arc(ex, ey, 2, 0, Math.PI * 2); g.fillStyle = K.bg; g.fill(); }      // hollow = not measured yet
        ends.push({ sp, x: ex, y: ey, ly: ey - 14, sel, gone: !!s.extinct });
    }
    // direct labels at the line ends, kept apart
    ends.sort((a, b2) => a.ly - b2.ly);
    for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 15) ends[i].ly = ends[i - 1].ly + 15;
    g.textAlign = 'right';
    for (const e of ends) {
        const ly = Math.max(m.t + 8, Math.min(m.t + S.ph - 8, e.ly)), txt = G.SPECIES[e.sp].short, tw = g.measureText(txt).width, lx = e.x - 10;
        g.fillStyle = K.bg; g.globalAlpha = 0.85; g.fillRect(lx - tw - 3, ly - 8, tw + 6, 16); g.globalAlpha = 1;
        g.fillStyle = e.sel ? K.text : K.text2; g.fillText(txt, lx, ly);
    }
    // ---- crosshair
    if (this.hoverGen !== null) {
        const x = Math.round(S.x(this.hoverGen)) + 0.5;
        g.strokeStyle = K.text2; g.lineWidth = 1; g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, m.t + S.ph); g.stroke();
        for (const sp of order) {
            const v = this.valueAt(sp, this.hoverGen);
            if (v === null) continue;
            g.beginPath(); g.arc(x, S.y(v.pct), 5, 0, Math.PI * 2); g.fillStyle = K.bg; g.fill();
            g.beginPath(); g.arc(x, S.y(v.pct), 3, 0, Math.PI * 2); g.fillStyle = sp === this.selected ? K.accent : K.ink2; g.fill();
        }
    }
    c.setAttribute('aria-label', best ? 'Compressed size by generation. Best so far ' + pctText(best.pct) + ' of the original, with the ' + G.SPECIES[best.species].name + ' family. The standings list has every value.' : 'Compressed size by generation. No results yet.');
};
Chart.prototype._hover = function (e) {
    const r = this.canvas.getBoundingClientRect(), S = this._scales(), gx = S.gx(e.clientX - r.left);
    if (gx < -1 || gx > S.xMax + 1 || !this.series.size) { this.hoverGen = null; this.tip.hidden = true; this.draw(); return; }
    this.hoverGen = Math.max(0, Math.min(this.maxGen, Math.round(gx)));
    this.draw(); this._showTip();
};
Chart.prototype._showTip = function () {
    const tip = this.tip, S = this._scales(), gen = this.hoverGen;
    tip.textContent = '';
    tip.appendChild(el('div', 'tip-h', 'Generation ' + gen));
    let bestV = null, anyEst = false;
    const rows = [];
    for (const sp of G.SPECIES_ORDER) { const v = this.valueAt(sp, gen); if (v !== null) { rows.push([sp, v]); if (bestV === null || v.pct < bestV) bestV = v.pct; } }
    rows.sort((a, b) => a[1].pct - b[1].pct);
    for (const [sp, v] of rows) {
        const row = el('div', 'tip-row');
        if (!v.m) anyEst = true;
        row.appendChild(el('b', '', (v.m ? '' : '≈ ') + pctText(v.pct))); row.appendChild(el('span', '', G.SPECIES[sp].short));
        tip.appendChild(row);
    }
    if (bestV !== null && this.baselines.length) {
        const beaten = this.baselines.filter(b => b.pct > bestV), next = this.baselines.filter(b => b.pct <= bestV).sort((a, b) => b.pct - a.pct)[0];
        tip.appendChild(el('div', 'tip-f', 'Ahead of ' + beaten.length + ' of ' + this.baselines.length + ' tools' + (next ? '. Next: ' + next.name + ', ' + next.pct.toFixed(2) + '%' : '')));
    }
    if (anyEst) tip.appendChild(el('div', 'tip-f', '≈ estimated from the fitness sample'));
    tip.hidden = false;
    const x = S.x(gen), tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(S.w - tw - 4, x + 16 + tw > S.w - S.m.r ? x - tw - 16 : x + 16)) + 'px';
    tip.style.top = Math.max(4, Math.min(S.h - th - 4, S.m.t + 8)) + 'px';
};
Chart.prototype.drawLegend = function () {
    const L = this.legend;
    L.textContent = '';
    for (const sp of G.SPECIES_ORDER) {
        const s = this.series.get(sp);
        if (!s || !s.points.length) continue;
        const it = el('button', s.extinct ? 'gone' : ''), key = el('i'), lm = this.lastMeasured(sp);
        it.type = 'button'; it.setAttribute('aria-pressed', String(sp === this.selected));
        if (sp === this.selected) key.style.borderTopColor = 'var(--accent)';
        it.title = G.SPECIES[sp].blurb + (s.extinct ? ' Went extinct in generation ' + s.extinct + '.' : '');
        it.appendChild(key); it.appendChild(el('span', '', G.SPECIES[sp].name)); it.appendChild(el('span', 'v', lm ? pctText(lm.pct) : '…'));
        it.addEventListener('click', () => { if (this.onSelect) this.onSelect(sp); });
        L.appendChild(it);
    }
    if (this.baselines.length) { const it = el('span', 'ref'); it.style.display = 'inline-flex'; it.style.alignItems = 'center'; it.style.gap = '8px'; it.appendChild(el('i')); it.appendChild(el('span', '', 'Existing tools, measured on the same bytes')); L.appendChild(it); }
};

// -------------------------------------------------------------- standings
// rows: [{ kind: 'ref'|'evo', name, pct, how, species, extinct, selected }]
function board(host, rows, onPick) {
    host.textContent = '';
    const sorted = rows.slice().sort((a, b) => (a.pct === null) - (b.pct === null) || a.pct - b.pct);
    const bestEvo = sorted.find(r => r.kind === 'evo' && r.pct !== null);
    for (const r of sorted) {
        const evo = r.kind === 'evo', row = el(evo ? 'button' : 'div', 'row' + (evo ? ' evolved' : '') + (r.extinct ? ' gone' : '') + (!evo && bestEvo && bestEvo.pct < r.pct ? ' behind' : ''));
        if (evo) { row.type = 'button'; row.setAttribute('aria-pressed', String(!!r.selected)); row.addEventListener('click', () => onPick && onPick(r.species)); }
        row.appendChild(el('span', 'name', r.name));
        row.appendChild(el('span', 'val', r.pct === null ? '…' : pctText(r.pct)));
        row.title = r.how || '';
        host.appendChild(row);
    }
}

// -------------------------------------------------------------------- log
function Log(host, more) {
    this.host = host; this.more = more; this.rows = []; this.open = false;
    if (more) more.addEventListener('click', () => { this.open = !this.open; this.render(); });
    this.render();
}
Log.prototype.clear = function () { this.rows = []; this.open = false; this.render(); };
Log.prototype.add = function (gen, headline, text, cls) { this.rows.unshift({ gen, headline, text, cls }); if (this.rows.length > 160) this.rows.pop(); this.render(); };
Log.prototype.render = function () {
    const h = this.host;
    h.textContent = '';
    if (!this.rows.length) h.appendChild(el('p', 'small', 'Nothing yet.'));
    for (const r of this.rows.slice(0, this.open ? 160 : 6)) {
        const row = el('div', 'log-row' + (r.cls ? ' ' + r.cls : '')), body = el('div');
        row.appendChild(el('span', 'g', 'Gen ' + r.gen));
        if (r.headline) { body.appendChild(el('b', '', r.headline)); body.appendChild(document.createTextNode(' ')); }
        body.appendChild(document.createTextNode(r.text));
        row.appendChild(body); h.appendChild(row);
    }
    if (this.more) { this.more.hidden = this.rows.length <= 6; this.more.textContent = this.open ? 'Show fewer' : 'Show all ' + this.rows.length; }
};

CE.render = { Chart, board, Log, el, pctText, ink, onTheme, resetInk: () => { INK = null; } };
})(typeof self !== 'undefined' ? self : globalThis);
