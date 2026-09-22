/* Neural Architect — core.js
 *
 * The DOM-free half: config, util, anim, theme, the block catalogue, the data
 * model, graph algorithms (topo sort, shape inference), auto-layout and the
 * templates. One namespace (window.NA), one IIFE per module — the same shape as
 * Laser Cutter Studio. Nothing here touches the DOM at load time, so
 * test_headless.js can run it under Node's vm.
 *
 * Load order: core.js → codegen.js → app.js
 */
'use strict';
const NA = (typeof window !== 'undefined') ? (window.NA = window.NA || {}) : (globalThis.NA = globalThis.NA || {});

// ============================================================
// NA.config — geometry, LOD thresholds, colours, limits
// ============================================================
NA.config = {
    APP: 'Neural Architect',
    FORMAT: 'neural-architect-project',
    VERSION: 1,

    // Block geometry in world units (zoom-invariant)
    BLOCK_W: 240,
    HEADER_H: 38,
    PILL_H: 60,
    BODY_PAD: 10,
    BODY_H: { small: 80, medium: 160 },     // grid-layout neuron bodies by size; larger blocks use the strip
    COL_PITCH: 14,                          // one neuron per row in the (default) column layout
    COL_LABEL_SCALE: 0.72,                  // label font as a fraction of the row height
    COLUMN_VIRTUALISE_ABOVE: 256,           // a column taller than this becomes a strip with expandable ranges
    HEADER_BTN: 16,
    COLLAPSED_ROW_H: 16,                    // one region summary row inside a collapsed block
    STRIP_ROW_H: 24,
    STRIP_MAX_ROWS: 8,
    EXPANDED_H: 220,
    PORT_R: 5,
    PORT_GAP: 18,
    GRID: 8,
    LANE_GAP_X: 110,
    LANE_GAP_Y: 56,
    LANES_PER_ROW: 0,          // 0 = never wrap: one left-to-right row, the way people read a network
    ROW_GAP_Y: 140,
    SNAP_Y: 24,                // vertical snap step inside a lane

    LOD: { DOTS_MIN_PX: 5, CIRCLE_PX: 12, INDEX_PX: 30, VIRTUALISE_ABOVE: 1024, CHUNK: 512, MIN_TEXT_PX: 7, TITLE_MIN_PX: 11 },   // titles never render below TITLE_MIN_PX on screen
    ZOOM: { MIN: 0.02, MAX: 40 },
    HISTORY_MAX: 100,
    AUTOSAVE_KEY: 'na.autosave',
    AUTOSAVE_LIMIT: 4 * 1024 * 1024,
    THEME_KEY: 'na.theme',

    // Kind-group colours (header tint). The region palette cycles for annotations.
    COLORS: {
        input: '#22c55e', linear: '#3b82f6', conv: '#8b5cf6', activation: '#f97316',
        norm: '#ec4899', structural: '#64748b', attention: '#a855f7', output: '#f43f5e',
        module: '#6366f1', custom: '#eab308', embedding: '#14b8a6', pool: '#0ea5e9', boundary: '#94a3b8'
    },
    REGION_PALETTE: ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#f43f5e'],
};

// ============================================================
// NA.util — DOM helpers (lazy), math, ids, pub/sub, toast, slug
// ============================================================
(() => {
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const el = (tag, attrs = {}, children = []) => {
        const n = document.createElement(tag);
        for (const k in attrs) {
            const v = attrs[k];
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') n.className = v;
            else if (k === 'style') n.style.cssText = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else if (k === 'text') n.textContent = v;
            else if (k === 'html') n.innerHTML = v;
            else if (k === 'value') n.value = v;
            else if (k === 'checked') n.checked = !!v;
            else n.setAttribute(k, v === true ? '' : v);
        }
        for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        return n;
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    // Ids are sequential (b_1, b_2, …) so a saved file reads like a document and two saves of the
    // same model diff line-for-line. Loading a file seeds the counter past its highest id.
    let idSeq = 0;
    const uid = (p = 'id') => p + '_' + (++idSeq);
    const seedIds = (o) => {
        const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { for (const k in x) { if (k === 'id' && typeof x[k] === 'string') { const m = /_(\d+)$/.exec(x[k]); if (m) idSeq = Math.max(idSeq, +m[1]); } else walk(x[k]); } } };
        walk(o);
    };
    const deepClone = (o) => JSON.parse(JSON.stringify(o));
    const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    const download = (filename, content, type = 'text/plain') => {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    };

    // Tiny pub/sub
    const bus = (() => {
        const map = new Map();
        return {
            on(ev, fn) { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); return () => map.get(ev).delete(fn); },
            emit(ev, data) { map.get(ev)?.forEach(fn => { try { fn(data); } catch (e) { console.error(ev, e && e.stack || e); } }); }
        };
    })();

    let toastRoot;
    function toast(msg, kind = '', ms = 2600) {
        if (typeof document === 'undefined') return;
        if (!toastRoot) { toastRoot = el('div', { class: 'toast-stack' }); document.body.appendChild(toastRoot); }
        const t = el('div', { class: 'toast ' + kind, text: msg });
        toastRoot.appendChild(t);
        requestAnimationFrame(() => t.classList.add('in'));
        setTimeout(() => { t.classList.remove('in'); t.classList.add('out'); }, ms);
        setTimeout(() => t.remove(), ms + 400);
    }

    function modal(id, open) {
        const m = document.getElementById(id);
        if (!m) return;
        m.classList.toggle('visible', open);
        if (open) { const f = m.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30); }
    }

    // Python identifier from a free-text title
    const PY_KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else except ' +
        'finally for from global if import in is lambda nonlocal not or pass raise return try while with yield ' +
        'self torch nn F model print input').split(' '));
    function slug(s, fallback = 'block') {
        let out = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
            .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
        if (!out) out = fallback;
        if (/^[0-9]/.test(out)) out = '_' + out;
        if (PY_KEYWORDS.has(out)) out = out + '_';
        return out;
    }
    function pascal(s, fallback = 'Model') {
        const parts = slug(s, fallback).replace(/^_+/, '').split('_').filter(Boolean);
        const out = parts.map(p => p[0].toUpperCase() + p.slice(1)).join('');
        return out || fallback;
    }

    const fmtNum = (n) => {
        if (n === null || n === undefined || Number.isNaN(n)) return '–';
        if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
        return String(n);
    };
    const fmtShape = (shape) => shape ? '[B, ' + shape.join(', ') + ']' : '?';
    const parseShape = (s) => {
        if (Array.isArray(s)) return s.map(Number).filter(n => Number.isFinite(n) && n > 0);
        return String(s || '').split(/[\s,x×*]+/).map(t => parseInt(t, 10)).filter(n => Number.isFinite(n) && n > 0);
    };
    const prod = (arr) => arr.reduce((a, b) => a * b, 1);

    function hexToRgb(hex) {
        const h = String(hex || '#000000').replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    const rgba = (hex, a) => { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; };
    function mix(hexA, hexB, t) {
        const a = hexToRgb(hexA), b = hexToRgb(hexB);
        const c = [lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t)].map(v => clamp(Math.round(v), 0, 255));
        return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    }

    // Subsequence fuzzy match with a simple score (lower = better); null when no match
    function fuzzy(query, text) {
        const q = query.toLowerCase(), t = text.toLowerCase();
        if (!q) return 0;
        let qi = 0, score = 0, last = -1;
        for (let i = 0; i < t.length && qi < q.length; i++) {
            if (t[i] === q[qi]) {
                if (last >= 0 && i - last > 1) score += (i - last);
                if (i === 0 || /[\s_:\-/]/.test(t[i - 1])) score -= 2;
                last = i; qi++;
            }
        }
        if (qi < q.length) return null;
        return score + (t.length - q.length) * 0.05 + (t.startsWith(q) ? -5 : 0);
    }

    // JSON for people and diffs: top-level keys and their direct children get a line each, so a
    // block or a wire is one line and a change to one shows as one changed line. Deeper structure
    // (a block's params, a module's graph) stays compact. Valid JSON throughout.
    function jsonLines(v, depth = 0) {
        const pad = '  '.repeat(depth), pad1 = '  '.repeat(depth + 1);
        if (Array.isArray(v)) {
            if (!v.length) return '[]';
            if (depth >= 2) return JSON.stringify(v);
            return '[\n' + v.map(x => pad1 + jsonLines(x, depth + 1)).join(',\n') + '\n' + pad + ']';
        }
        if (v && typeof v === 'object') {
            const keys = Object.keys(v); if (!keys.length) return '{}';
            if (depth >= 2) return JSON.stringify(v);
            return '{\n' + keys.map(k => pad1 + JSON.stringify(k) + ': ' + jsonLines(v[k], depth + 1)).join(',\n') + '\n' + pad + '}';
        }
        return JSON.stringify(v);
    }

    NA.util = { $, $$, el, clamp, lerp, debounce, uid, seedIds, deepClone, deepEqual, download, bus, toast, modal,
                slug, pascal, fmtNum, fmtShape, parseShape, prod, hexToRgb, rgba, mix, fuzzy, jsonLines, PY_KEYWORDS };
})();

// ============================================================
// NA.anim — springs and tweens driven by the canvas loop
// ============================================================
(() => {
    const springs = new Map();   // key -> {obj, prop, target, vel, k, c}
    const tweens = [];           // {t0, ms, fn, ease, done}
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const easeOut = t => 1 - Math.pow(1 - t, 3);

    function spring(obj, prop, target, opts = {}) {
        const key = opts.key || (obj.__aid || (obj.__aid = NA.util.uid('a'))) + '.' + prop;
        const s = springs.get(key) || { obj, prop, vel: 0, k: 220, c: 24 };
        s.obj = obj; s.prop = prop; s.target = target; s.k = opts.k || s.k; s.c = opts.c || s.c;
        if (opts.from !== undefined) obj[prop] = opts.from;
        springs.set(key, s);
        NA.canvas && NA.canvas.invalidate(opts.layer || 'overlay');
        return s;
    }
    function tween(ms, fn, opts = {}) {
        const tw = { t0: now(), ms, fn, ease: opts.ease || easeOut, done: opts.done, layer: opts.layer || 'overlay' };
        tweens.push(tw);
        NA.canvas && NA.canvas.invalidate(tw.layer);
        return tw;
    }
    // Advance by dt seconds. Returns true while anything is still moving.
    function tick(dt) {
        dt = Math.min(dt, 1 / 20);
        let active = false;
        for (const [key, s] of springs) {
            const x = s.obj[s.prop], d = s.target - x;
            s.vel += (d * s.k - s.vel * s.c) * dt;
            s.obj[s.prop] = x + s.vel * dt;
            if (Math.abs(s.target - s.obj[s.prop]) < 0.001 && Math.abs(s.vel) < 0.01) { s.obj[s.prop] = s.target; springs.delete(key); }
            else active = true;
        }
        const t = now();
        for (let i = tweens.length - 1; i >= 0; i--) {
            const tw = tweens[i];
            const p = Math.min(1, (t - tw.t0) / tw.ms);
            tw.fn(tw.ease(p), p);
            if (p >= 1) { tweens.splice(i, 1); tw.done && tw.done(); } else active = true;
        }
        return active;
    }
    NA.anim = { spring, tween, tick, get active() { return springs.size > 0 || tweens.length > 0; }, easeOut };
})();

// ============================================================
// NA.theme — dark/light, persisted; canvas-side tokens via getComputedStyle
// ============================================================
(() => {
    let current = 'dark';
    let cache = null;
    function apply(t) {
        current = t === 'light' ? 'light' : 'dark';
        if (typeof document === 'undefined') return;
        document.documentElement.setAttribute('data-theme', current);
        try { localStorage.setItem(NA.config.THEME_KEY, current); } catch (_) {}
        cache = null;
        NA.util.bus.emit('theme:change', current);
        NA.canvas && NA.canvas.invalidate('all');
    }
    function init() {
        let saved = null;
        try { saved = localStorage.getItem(NA.config.THEME_KEY); } catch (_) {}
        if (!saved && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches) saved = 'light';
        const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('theme') : null;
        apply(q || saved || 'dark');
    }
    function toggle() { apply(current === 'dark' ? 'light' : 'dark'); }
    // Read a CSS custom property (cached per theme)
    function token(name) {
        if (!cache) cache = {};
        if (cache[name] === undefined) cache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return cache[name];
    }
    NA.theme = { init, apply, toggle, token, get current() { return current; } };
})();

// ============================================================
// NA.catalogue — every block kind: params, shape inference, code emitters.
// One declaration drives the palette, the inspector form, validation and
// both code generators, so a kind cannot drift between them.
// ============================================================
(() => {
    const C = NA.config.COLORS;
    const { fmtShape, prod } = NA.util;
    const K = {};
    const ORDER = [];
    function def(k) {
        K[k.kind] = Object.assign({ inputs: ['in'], hasSize: false, params: [], group: 'structural', desc: '', hidden: false }, k);
        ORDER.push(k.kind);
    }
    // Param schema helpers
    const P = {
        int: (key, label, d, min, max, extra) => Object.assign({ key, label, type: 'int', default: d, min, max }, extra || {}),
        num: (key, label, d, min, max, step) => ({ key, label, type: 'number', default: d, min, max, step }),
        bool: (key, label, d) => ({ key, label, type: 'bool', default: d }),
        select: (key, label, d, options) => ({ key, label, type: 'select', default: d, options }),
        text: (key, label, d, placeholder) => ({ key, label, type: 'text', default: d, placeholder }),
        code: (key, label, d, placeholder) => ({ key, label, type: 'code', default: d, placeholder }),
        shape: (key, label, d, hint) => ({ key, label, type: 'shape', default: d, hint }),
    };
    const need = (ins, n = 1) => { for (let i = 0; i < n; i++) if (!ins[i]) throw new Error('Needs an input'); return ins; };
    // Several wires into one fan-in port: all leading dims must agree, the last dim is the sum
    // Several wires into a channel port: same spatial dims, channels add up
    const fanInChannels = (ins) => {
        if (!ins.length || ins.some(s => !s)) throw new Error('Needs an input');
        if (ins.length === 1) return ins[0];
        const sp = JSON.stringify(ins[0].slice(1));
        for (const s of ins) if (s.length !== ins[0].length || JSON.stringify(s.slice(1)) !== sp) throw new Error(`Cannot join ${ins.map(fmtShape).join(' + ')} on the channel axis`);
        return [ins.reduce((n, s) => n + s[0], 0), ...ins[0].slice(1)];
    };
    // Join several wires into one port. Modes: 'features' (last axis), 'channels' (first axis —
    // channels of an image, tokens of a sequence, ids of a token stream), 'flat' (flatten each,
    // then concatenate), 'tokens' (attention-style: first wire is the query, handled by the kind).
    const fanInJoin = (mode, ins) => {
        if (!ins.length || ins.some(s => !s)) throw new Error('Needs an input');
        if (ins.length === 1 || mode === 'tokens') return ins[0];
        if (mode === 'features') return fanInShape(ins);
        if (mode === 'channels') return fanInChannels(ins);
        if (mode === 'flat') return [ins.reduce((n, s) => n + s.reduce((a, b) => a * b, 1), 0)];
        return ins[0];
    };
    // The single shape a block's kind sees after its wires are joined
    const joinedIn = (b) => { const k = K[b.kind]; const ins = b._inShapes || []; return k && k.fanIn && k.fanIn !== 'tokens' && ins.length > 1 ? fanInJoin(k.fanIn, ins) : ins[0]; };
    const fanInShape = (ins) => {
        if (!ins.length || ins.some(s => !s)) throw new Error('Needs an input');
        if (ins.length === 1) return ins[0];
        const lead = JSON.stringify(ins[0].slice(0, -1));
        for (const s of ins) if (s.length !== ins[0].length || JSON.stringify(s.slice(0, -1)) !== lead) throw new Error(`Cannot join ${ins.map(fmtShape).join(' + ')} on the feature axis`);
        return [...ins[0].slice(0, -1), ins.reduce((n, s) => n + s[s.length - 1], 0)];
    };
    const one = (ins) => need(ins)[0];
    const vec = (ins, what) => { const s = one(ins); if (s.length !== 1) throw new Error(`${what} expects a vector, got ${fmtShape(s)} — insert Flatten`); return s; };
    const convOut = (n, k, s, p, d) => Math.floor((n + 2 * p - d * (k - 1) - 1) / s + 1);
    const py = v => (typeof v === 'boolean') ? (v ? 'True' : 'False') : (typeof v === 'string' ? JSON.stringify(v) : String(v));

    const ACT = {
        relu:       { label: 'ReLU',       torch: x => `F.relu(${x})`,             keras: 'relu' },
        gelu:       { label: 'GELU',       torch: x => `F.gelu(${x})`,             keras: 'gelu' },
        silu:       { label: 'SiLU',       torch: x => `F.silu(${x})`,             keras: 'silu' },
        tanh:       { label: 'Tanh',       torch: x => `torch.tanh(${x})`,         keras: 'tanh' },
        sigmoid:    { label: 'Sigmoid',    torch: x => `torch.sigmoid(${x})`,      keras: 'sigmoid' },
        softmax:    { label: 'Softmax',    torch: x => `F.softmax(${x}, dim=-1)`,  keras: 'softmax' },
        leaky_relu: { label: 'Leaky ReLU', torch: x => `F.leaky_relu(${x}, 0.01)`, keras: 'leaky_relu' },
        elu:        { label: 'ELU',        torch: x => `F.elu(${x})`,              keras: 'elu' },
        softplus:   { label: 'Softplus',   torch: x => `F.softplus(${x})`,         keras: 'softplus' },
        mish:       { label: 'Mish',       torch: x => `F.mish(${x})`,             keras: 'mish' },
    };

    // ---- Inputs / outputs ----
    def({
        kind: 'input', label: 'Input', icon: 'log-in', group: 'io', color: C.input, inputs: [],
        desc: 'A model input. Split it into named regions (e.g. neurons 0–10 physical constraints, 11–110 objective embedding).',
        params: [P.shape('shape', 'Shape (per sample)', [10], 'e.g. 201 or 3, 32, 32'), P.select('dtype', 'Dtype', 'float32', ['float32', 'int64'])],
        infer: (ins, b) => { const s = NA.util.parseShape(b.params.shape); if (!s.length) throw new Error('Set an input shape'); return s; },
        torch: { init: () => null, forward: (b, ins, ctx) => ctx.inputVar(b) },
        keras: (b) => ({ class_name: 'InputLayer', config: { batch_shape: [null, ...NA.util.parseShape(b.params.shape)], dtype: b.params.dtype || 'float32' } }),
    });
    def({
        kind: 'output', label: 'Output', icon: 'log-out', group: 'io', color: C.output, fanIn: 'features',
        desc: 'A named model output. The forward pass returns every Output block (a tuple when there are several). Several wires into one output are concatenated, top to bottom.',
        params: [],
        infer: (ins) => fanInShape(need(ins, ins.length || 1)),
        torch: { init: () => null, forward: (b, ins) => ins.length > 1 ? `torch.cat([${ins.join(', ')}], dim=-1)` : ins[0] },
        keras: null,
    });

    // ---- Dense / conv ----
    def({
        kind: 'linear', label: 'Linear', icon: 'layers', group: 'dense', color: C.linear, hasSize: true, defaultSize: 10, fanIn: 'features',
        desc: 'Fully connected layer over the last dimension. in_features is inferred from whatever feeds it; several wires into the same port are concatenated (top to bottom) before the weights.',
        params: [P.bool('bias', 'Bias', true)],
        infer: (ins, b) => { const s = fanInShape(need(ins, ins.length || 1)); if (s.length > 2) throw new Error(`Linear expects a vector or [T, D], got ${fmtShape(s)} — insert Flatten`); return [...s.slice(0, -1), b.size]; },
        torch: {
            init: (b, ctx) => { const s = fanInShape(b._inShapes); return `nn.Linear(${s[s.length - 1]}, ${b.size}${b.params.bias === false ? ', bias=False' : ''})`; },
            forward: (b, ins, ctx) => `self.${ctx.attr(b)}(${ins.length > 1 ? `torch.cat([${ins.join(', ')}], dim=-1)` : ins[0]})`,
        },
        keras: (b) => ({ class_name: 'Dense', config: { units: b.size, activation: 'linear', use_bias: b.params.bias !== false } }),
        paramCount: (b) => { try { const s = fanInShape(b._inShapes || []); return s[s.length - 1] * b.size + (b.params.bias === false ? 0 : b.size); } catch (_) { return 0; } },
    });
    const convParams = [P.int('kernel', 'Kernel', 3, 1, 31), P.int('stride', 'Stride', 1, 1, 16), P.int('padding', 'Padding', 1, 0, 32),
                        P.int('dilation', 'Dilation', 1, 1, 8), P.int('groups', 'Groups', 1, 1, 1024), P.bool('bias', 'Bias', true)];
    function convTorch(dim) {
        return {
            init: (b, ctx) => {
                const p = b.params, args = [`${fanInChannels(b._inShapes)[0]}`, `${b.size}`, `kernel_size=${p.kernel}`];
                if (p.stride !== 1) args.push(`stride=${p.stride}`);
                if (p.padding !== 0) args.push(`padding=${p.padding}`);
                if (p.dilation !== 1) args.push(`dilation=${p.dilation}`);
                if (p.groups !== 1) args.push(`groups=${p.groups}`);
                if (p.bias === false) args.push('bias=False');
                return `nn.Conv${dim}d(${args.join(', ')})`;
            },
            forward: (b, ins, ctx) => `self.${ctx.attr(b)}(${ins.length > 1 ? `torch.cat([${ins.join(', ')}], dim=1)` : ins[0]})`,
        };
    }
    function convKeras(dim) {
        return (b, ins, ctx) => {
            const p = b.params;
            let padding = 'valid';
            if (p.padding !== 0) { if (p.stride === 1 && p.padding === Math.floor((p.kernel - 1) / 2) * p.dilation) padding = 'same'; else ctx.warn(`${b.title}: Keras has no explicit padding; exported as "same"`), padding = 'same'; }
            return { class_name: `Conv${dim}D`, config: { filters: b.size, kernel_size: dim === 1 ? [p.kernel] : [p.kernel, p.kernel], strides: dim === 1 ? [p.stride] : [p.stride, p.stride], padding, dilation_rate: dim === 1 ? [p.dilation] : [p.dilation, p.dilation], groups: p.groups, use_bias: p.bias !== false, activation: 'linear' } };
        };
    }
    def({
        kind: 'conv1d', label: 'Conv1D', icon: 'scan-line', group: 'conv', color: C.conv, hasSize: true, defaultSize: 32, compact: true, fanIn: 'channels',
        desc: 'Temporal / sequence convolution over [C, L]. Several wires into it are concatenated along the channel axis (skip connections).', params: convParams,
        infer: (ins, b) => { const s = fanInChannels(need(ins, ins.length || 1)); if (s.length !== 2) throw new Error(`Conv1D expects [C, L], got ${fmtShape(s)}`); const p = b.params; const L = convOut(s[1], p.kernel, p.stride, p.padding, p.dilation); if (L < 1) throw new Error('Kernel larger than input'); return [b.size, L]; },
        torch: convTorch(1), keras: convKeras(1),
        paramCount: (b) => { try { return (fanInChannels(b._inShapes || [])[0] / b.params.groups) * b.size * b.params.kernel + b.size; } catch (_) { return 0; } },
    });
    def({
        kind: 'conv2d', label: 'Conv2D', icon: 'scan', group: 'conv', color: C.conv, hasSize: true, defaultSize: 32, compact: true, fanIn: 'channels',
        desc: 'Image convolution over [C, H, W]. Each neuron dot is one feature map. Several wires into it are concatenated along the channel axis (U-Net / DenseNet skips).', params: convParams,
        infer: (ins, b) => { const s = fanInChannels(need(ins, ins.length || 1)); if (s.length !== 3) throw new Error(`Conv2D expects [C, H, W], got ${fmtShape(s)}`); const p = b.params; const H = convOut(s[1], p.kernel, p.stride, p.padding, p.dilation), W = convOut(s[2], p.kernel, p.stride, p.padding, p.dilation); if (H < 1 || W < 1) throw new Error('Kernel larger than input'); return [b.size, H, W]; },
        torch: convTorch(2), keras: convKeras(2),
        paramCount: (b) => { try { return (fanInChannels(b._inShapes || [])[0] / b.params.groups) * b.size * b.params.kernel * b.params.kernel + b.size; } catch (_) { return 0; } },
    });

    // ---- Activations / norms / regularisation ----
    def({
        kind: 'activation', label: 'Activation', icon: 'activity', group: 'activation', color: C.activation, hidden: true,
        desc: 'Element-wise non-linearity. Activations live on the wires between blocks; this block form only exists so old files and ONNX imports load, and is folded onto the wire.',
        params: [P.select('fn', 'Function', 'relu', Object.keys(ACT))],
        infer: (ins) => one(ins),
        torch: { init: () => null, forward: (b, ins) => (ACT[b.params.fn] || ACT.relu).torch(ins[0]) },
        keras: (b) => b.params.fn === 'leaky_relu' ? { class_name: 'LeakyReLU', config: { negative_slope: 0.01 } } : { class_name: 'Activation', config: { activation: (ACT[b.params.fn] || ACT.relu).keras } },
        subtitle: (b) => (ACT[b.params.fn] || ACT.relu).label,
    });
    def({
        kind: 'batchnorm', label: 'BatchNorm', icon: 'align-vertical-justify-center', group: 'norm', color: C.norm, fanIn: 'channels',
        desc: 'Batch normalisation over the channel / feature dimension. Several wires are joined first (features of vectors, channels of images); per-feature statistics make that identical to normalising each input on its own.',
        params: [P.num('eps', 'Epsilon', 1e-5, 0, 1, 1e-6), P.num('momentum', 'Momentum', 0.1, 0, 1, 0.01), P.bool('affine', 'Affine', true)],
        infer: (ins) => { const s = one(ins); if (s.length > 3) throw new Error('BatchNorm supports rank ≤ 3'); return s; },
        torch: {
            init: (b) => { const s = joinedIn(b); const cls = s.length === 3 ? 'BatchNorm2d' : 'BatchNorm1d'; const extra = [];
                if (b.params.eps !== 1e-5) extra.push(`eps=${b.params.eps}`); if (b.params.momentum !== 0.1) extra.push(`momentum=${b.params.momentum}`); if (b.params.affine === false) extra.push('affine=False');
                return `nn.${cls}(${s[0]}${extra.length ? ', ' + extra.join(', ') : ''})`; },
            forward: (b, ins, ctx) => `self.${ctx.attr(b)}(${ins[0]})`,
        },
        keras: (b) => ({ class_name: 'BatchNormalization', config: { axis: -1, momentum: 1 - b.params.momentum, epsilon: b.params.eps, center: b.params.affine !== false, scale: b.params.affine !== false } }),
        paramCount: (b) => { try { return b.params.affine !== false ? 2 * joinedIn(b)[0] : 0; } catch (_) { return 0; } },
    });
    def({
        kind: 'layernorm', label: 'LayerNorm', icon: 'ruler', group: 'norm', color: C.norm, fanIn: 'features',
        desc: 'Layer normalisation over the last dimension.',
        params: [P.num('eps', 'Epsilon', 1e-5, 0, 1, 1e-6)],
        infer: (ins) => one(ins),
        torch: { init: (b) => { const s = joinedIn(b); return `nn.LayerNorm(${s[s.length - 1]}${b.params.eps !== 1e-5 ? ', eps=' + b.params.eps : ''})`; }, forward: (b, ins, ctx) => `self.${ctx.attr(b)}(${ins[0]})` },
        keras: (b) => ({ class_name: 'LayerNormalization', config: { axis: -1, epsilon: b.params.eps } }),
        paramCount: (b) => { try { const s = joinedIn(b); return 2 * s[s.length - 1]; } catch (_) { return 0; } },
    });
    def({
        kind: 'dropout', label: 'Dropout', icon: 'droplets', group: 'norm', color: C.norm, hidden: true,
        desc: 'Legacy block: dropout is a training-only property of a block (see the inspector), not something you route through. Old files and ONNX imports fold it onto the block before it.',
        params: [P.num('p', 'Probability', 0.1, 0, 0.95, 0.05)],
        infer: (ins) => one(ins),
        torch: { init: (b) => `nn.Dropout(${b.params.p})`, forward: (b, ins, ctx) => `self.${ctx.attr(b)}(${ins[0]})` },
        keras: (b) => ({ class_name: 'Dropout', config: { rate: b.params.p } }),
        subtitle: (b) => 'p = ' + b.params.p,
    });

    // ---- Structural ----
    def({
        kind: 'flatten', label: 'Flatten', icon: 'minimize-2', group: 'structural', color: C.structural, fanIn: 'flat',
        desc: 'Collapses [C, H, W] into a vector. Several wires of any shape are each flattened and joined into one vector.', params: [],
        infer: (ins) => [prod(one(ins))],
        torch: { init: () => null, forward: (b, ins) => `torch.flatten(${ins[0]}, 1)` },
        keras: () => ({ class_name: 'Flatten', config: {} }),
    });
    def({
        kind: 'reshape', label: 'Reshape', icon: 'shuffle', group: 'structural', color: C.structural,
        desc: 'Reinterprets a tensor with a new per-sample shape (element count must match).',
        params: [P.shape('shape', 'New shape', [8, 8], 'e.g. 16, 8, 8')],
        infer: (ins, b) => { const s = one(ins); const t = NA.util.parseShape(b.params.shape); if (!t.length) throw new Error('Set a shape'); if (prod(s) !== prod(t)) throw new Error(`Cannot reshape ${prod(s)} elements into ${fmtShape(t)}`); return t; },
        torch: { init: () => null, forward: (b, ins) => `${ins[0]}.reshape(${ins[0]}.shape[0], ${NA.util.parseShape(b.params.shape).join(', ')})` },
        keras: (b) => ({ class_name: 'Reshape', config: { target_shape: NA.util.parseShape(b.params.shape) } }),
    });
    def({
        kind: 'concat', label: 'Concat', icon: 'merge', group: 'structural', color: C.structural, inputs: 'variadic',
        desc: 'Joins several tensors along one dimension (last by default).',
        params: [P.int('dim', 'Dimension (per sample, −1 = last)', -1, -1, 4)],
        infer: (ins, b) => {
            const ss = ins.filter(Boolean); if (ss.length < 2) throw new Error('Concat needs two or more inputs');
            const r = ss[0].length; if (ss.some(s => s.length !== r)) throw new Error('Concat inputs must have the same rank');
            const d = b.params.dim < 0 ? r + b.params.dim : b.params.dim; if (d >= r) throw new Error('Dimension out of range');
            const out = ss[0].slice();
            for (let i = 0; i < r; i++) if (i !== d && ss.some(s => s[i] !== ss[0][i])) throw new Error(`Inputs differ on dim ${i}`);
            out[d] = ss.reduce((a, s) => a + s[d], 0); return out;
        },
        torch: { init: () => null, forward: (b, ins) => `torch.cat([${ins.join(', ')}], dim=${b.params.dim < 0 ? b.params.dim : b.params.dim + 1})` },
        keras: (b, ins, ctx) => { const r = b._inShapes[0].length; const d = b.params.dim < 0 ? r + b.params.dim : b.params.dim; let axis = d + 1; if (r > 1 && ctx.nhwc) axis = d === 0 ? -1 : d; return { class_name: 'Concatenate', config: { axis } }; },
    });
    def({
        kind: 'add', label: 'Combine', icon: 'plus', group: 'structural', color: C.structural, inputs: 'variadic',
        desc: 'Element-wise combination of same-shaped branches: sum (residual / skip), mean, max, or product (gating, e.g. squeeze-excite / GLU).',
        params: [P.select('mode', 'Operation', 'sum', [{ value: 'sum', label: 'Sum (residual)' }, { value: 'mean', label: 'Mean' }, { value: 'max', label: 'Max' }, { value: 'mul', label: 'Multiply (gate)' }])],
        infer: (ins) => { const ss = ins.filter(Boolean); if (ss.length < 2) throw new Error('Combine needs two or more inputs'); const a = JSON.stringify(ss[0]); if (ss.some(s => JSON.stringify(s) !== a)) throw new Error(`Shapes differ: ${ss.map(fmtShape).join(' vs ')}`); return ss[0]; },
        torch: { init: () => null, forward: (b, ins) => { const m = b.params.mode || 'sum'; if (m === 'sum') return ins.join(' + '); if (m === 'mul') return ins.join(' * '); return m === 'mean' ? `torch.stack([${ins.join(', ')}]).mean(0)` : `torch.stack([${ins.join(', ')}]).amax(0)`; } },
        keras: (b) => ({ class_name: { sum: 'Add', mean: 'Average', max: 'Maximum', mul: 'Multiply' }[b.params.mode || 'sum'], config: {} }),
        subtitle: (b) => ({ sum: 'sum', mean: 'mean', max: 'max', mul: 'multiply' })[b.params.mode || 'sum'],
    });

    // ---- Sequence ----
    def({
        kind: 'embedding', label: 'Embedding', icon: 'book-open', group: 'sequence', color: C.embedding, hasSize: true, defaultSize: 128, compact: true, fanIn: 'channels',
        desc: 'Looks up a vector per token id. Feed it an int64 Input of shape [T].',
        params: [P.int('vocab', 'Vocabulary', 10000, 2, 10000000)],
        infer: (ins, b) => { const s = one(ins); if (s.length !== 1) throw new Error('Embedding expects token ids [T]'); return [s[0], b.size]; },
        torch: { init: (b) => `nn.Embedding(${b.params.vocab}, ${b.size})`, forward: (b, ins, ctx) => `self.${ctx.attr(b)}(${ins[0]})` },
        keras: (b) => ({ class_name: 'Embedding', config: { input_dim: b.params.vocab, output_dim: b.size } }),
        paramCount: (b) => b.params.vocab * b.size,
    });
    def({
        kind: 'attention', label: 'Attention', icon: 'eye', group: 'sequence', color: C.attention, hasSize: true, defaultSize: 256, fanIn: 'tokens', compact: true,
        desc: 'Multi-head attention over [T, D] (D = embed size). One wire is self-attention; with more, the first wire is the query and the others are the keys / values (cross-attention), joined along the token axis.',
        params: [P.int('heads', 'Heads', 4, 1, 64), P.num('dropout', 'Attention dropout', 0, 0, 0.9, 0.05), P.bool('causal', 'Causal mask (decoder-style, self-attention only)', false), { key: 'query_from', type: 'hidden', default: '' }],
        infer: (ins, b) => { need(ins, ins.length || 1); for (const s of ins) { if (s.length !== 2) throw new Error(`Attention expects [T, D], got ${fmtShape(s)}`); if (s[1] !== b.size) throw new Error(`Input dim ${s[1]} must equal embed size ${b.size}`); } if (b.size % b.params.heads) throw new Error('Embed size must divide by heads'); return ins[0]; },
        torch: { init: (b) => `nn.MultiheadAttention(${b.size}, ${b.params.heads}${b.params.dropout ? ', dropout=' + b.params.dropout : ''}, batch_first=True)`,
                 forward: (b, ins, ctx) => { const q = ins[0]; const kv = ins.length > 2 ? `torch.cat([${ins.slice(1).join(', ')}], dim=1)` : (ins[1] || q); const mask = b.params.causal && ins.length === 1 ? `, attn_mask=torch.triu(torch.ones(${q}.size(1), ${q}.size(1), dtype=torch.bool, device=${q}.device), 1)` : ''; return `self.${ctx.attr(b)}(${q}, ${kv}, ${kv}${mask}, need_weights=False)[0]`; } },
        keras: (b) => ({ class_name: 'MultiHeadAttention', config: { num_heads: b.params.heads, key_dim: Math.floor(b.size / b.params.heads), dropout: b.params.dropout }, selfAttention: true }),
        paramCount: (b) => 4 * b.size * b.size + 4 * b.size,
        subtitle: (b) => b.params.heads + ' heads',
    });
    def({
        kind: 'transformer', label: 'Transformer', icon: 'sparkles', group: 'sequence', color: C.attention, hasSize: true, defaultSize: 256, compact: true, fanIn: 'tokens',
        desc: 'A stack of transformer layers over [T, D]. One wire = an encoder stack (self-attention + MLP). More wires = a decoder stack: the first wire is the target sequence, the others are the memory it cross-attends to (joined along the token axis).',
        params: [P.int('heads', 'Heads', 8, 1, 64), P.int('ff', 'Feed-forward dim', 1024, 1, 65536), P.int('layers', 'Layers', 4, 1, 128), P.num('dropout', 'Internal dropout', 0.1, 0, 0.9, 0.05), P.bool('norm_first', 'Pre-norm', true), P.bool('causal', 'Causal mask on the first wire (autoregressive)', false), { key: 'query_from', type: 'hidden', default: '' }],
        infer: (ins, b) => { need(ins, ins.length || 1); for (const s of ins) { if (s.length !== 2) throw new Error(`Transformer expects [T, D], got ${fmtShape(s)}`); if (s[1] !== b.size) throw new Error(`Input dim ${s[1]} must equal d_model ${b.size}`); } if (b.size % b.params.heads) throw new Error('d_model must divide by heads'); return ins[0]; },
        torch: {
            init: (b) => { const p = b.params; const common = `d_model=${b.size}, nhead=${p.heads}, dim_feedforward=${p.ff}, dropout=${p.dropout}, batch_first=True${p.norm_first ? ', norm_first=True' : ''}`; return (b._inShapes || []).length > 1 ? `nn.TransformerDecoder(nn.TransformerDecoderLayer(${common}), num_layers=${p.layers})` : `nn.TransformerEncoder(nn.TransformerEncoderLayer(${common}), num_layers=${p.layers})`; },
            forward: (b, ins, ctx) => { const q = ins[0]; const mask = b.params.causal ? `nn.Transformer.generate_square_subsequent_mask(${q}.size(1), device=${q}.device)` : null;
                if (ins.length === 1) return `self.${ctx.attr(b)}(${q}${mask ? `, mask=${mask}, is_causal=True` : ''})`;
                const mem = ins.length > 2 ? `torch.cat([${ins.slice(1).join(', ')}], dim=1)` : ins[1]; return `self.${ctx.attr(b)}(${q}, ${mem}${mask ? `, tgt_mask=${mask}, tgt_is_causal=True` : ''})`; },
        },
        keras: (b, ins, ctx) => { ctx.warn(`${b.title}: Transformer stacks have no single Keras layer — emitted as identity; use the PyTorch export for the real model`); return { class_name: 'Activation', config: { activation: 'linear' } }; },
        paramCount: (b) => b.params.layers * ((b._inShapes || []).length > 1 ? 2 : 1) * (4 * b.size * b.size + 4 * b.size) + b.params.layers * (2 * b.size * b.params.ff + b.params.ff + b.size + 4 * b.size),
        subtitle: (b) => `${(b._inShapes || []).length > 1 ? 'decoder' : 'encoder'} · ${b.params.layers} × ${b.params.heads} heads`,
    });
    // ---- Recurrent ----
    def({
        kind: 'rnn', label: 'Recurrent', icon: 'repeat', group: 'sequence', color: C.embedding, hasSize: true, defaultSize: 128, compact: true, fanIn: 'channels',
        desc: 'LSTM / GRU over [T, D]. Returns the whole sequence [T, H] or only the last step [H]; bidirectional doubles H. Several wires are joined along the token axis (one sequence after the other).',
        params: [P.select('cell', 'Cell', 'lstm', [{ value: 'lstm', label: 'LSTM' }, { value: 'gru', label: 'GRU' }]), P.int('layers', 'Layers', 1, 1, 8), P.bool('bidirectional', 'Bidirectional', false), P.select('output', 'Output', 'sequence', [{ value: 'sequence', label: 'Whole sequence [T, H]' }, { value: 'last', label: 'Last step [H]' }]), P.num('dropout', 'Between-layer dropout', 0, 0, 0.9, 0.05)],
        infer: (ins, b) => { const s = one(ins); if (s.length !== 2) throw new Error(`Recurrent expects [T, D], got ${fmtShape(s)}`); const H = b.size * (b.params.bidirectional ? 2 : 1); return b.params.output === 'last' ? [H] : [s[0], H]; },
        torch: {
            init: (b) => { const p = b.params; return `nn.${p.cell === 'gru' ? 'GRU' : 'LSTM'}(${b._inShapes[0][1]}, ${b.size}, num_layers=${p.layers}, batch_first=True${p.bidirectional ? ', bidirectional=True' : ''}${p.layers > 1 && p.dropout ? ', dropout=' + p.dropout : ''})`; },
            forward: (b, ins, ctx) => `self.${ctx.attr(b)}(${ins[0]})[0]${b.params.output === 'last' ? '[:, -1]' : ''}`,
        },
        keras: (b, ins, ctx) => { const p = b.params; if (p.layers > 1) ctx.warn(`${b.title}: Keras export emits one recurrent layer, not ${p.layers}`); const inner = { module: 'keras.layers', class_name: p.cell === 'gru' ? 'GRU' : 'LSTM', config: { units: b.size, return_sequences: p.output !== 'last' } }; return p.bidirectional ? { class_name: 'Bidirectional', config: { layer: inner, merge_mode: 'concat' } } : { class_name: inner.class_name, config: inner.config }; },
        paramCount: (b) => { const D = b._inShapes?.[0]?.[1] || 0, H = b.size, g = b.params.cell === 'gru' ? 3 : 4, dirs = b.params.bidirectional ? 2 : 1; let n = 0; for (let l = 0; l < b.params.layers; l++) { const inD = l === 0 ? D : H * dirs; n += dirs * g * (inD * H + H * H + 2 * H); } return n; },
        subtitle: (b) => `${b.params.cell.toUpperCase()}${b.params.bidirectional ? ' · bi' : ''}${b.params.layers > 1 ? ' · ' + b.params.layers + ' layers' : ''}`,
    });

    // ---- Upsampling (decoders, U-Net) ----
    def({
        kind: 'upsample', label: 'Upsample', icon: 'expand', group: 'conv', color: C.pool, compact: true, fanIn: 'channels',
        desc: 'Scales the spatial axes of [C, L] or [C, H, W] up — the decoder counterpart of pooling.',
        params: [P.int('scale', 'Scale factor', 2, 2, 16), P.select('mode', 'Mode', 'nearest', [{ value: 'nearest', label: 'Nearest' }, { value: 'linear', label: 'Linear / bilinear' }])],
        infer: (ins, b) => { const s = one(ins); if (s.length < 2 || s.length > 3) throw new Error(`Upsample expects [C, L] or [C, H, W], got ${fmtShape(s)}`); return [s[0], ...s.slice(1).map(n => n * b.params.scale)]; },
        torch: { init: (b) => `nn.Upsample(scale_factor=${b.params.scale}, mode='${b.params.mode === 'linear' ? (b._inShapes[0].length === 3 ? 'bilinear' : 'linear') : 'nearest'}'${b.params.mode === 'linear' ? ', align_corners=False' : ''})`, forward: (b, ins, ctx) => `self.${ctx.attr(b)}(${ins[0]})` },
        keras: (b) => b._inShapes[0].length === 3 ? { class_name: 'UpSampling2D', config: { size: [b.params.scale, b.params.scale], interpolation: b.params.mode === 'linear' ? 'bilinear' : 'nearest' } } : { class_name: 'UpSampling1D', config: { size: b.params.scale } },
        subtitle: (b) => '×' + b.params.scale,
    });
    // ---- Pooling ----
    def({
        kind: 'pool', label: 'Pooling', icon: 'shrink', group: 'conv', color: C.pool, compact: true, fanIn: 'channels',
        desc: 'Max / average pooling, or global pooling down to a vector.',
        params: [P.select('mode', 'Mode', 'max', ['max', 'avg', 'global_avg', 'global_max']), P.int('kernel', 'Kernel', 2, 1, 32), P.int('stride', 'Stride (0 = kernel)', 0, 0, 32)],
        infer: (ins, b) => { const s = one(ins); if (s.length < 2 || s.length > 3) throw new Error(`Pooling expects [C, L] or [C, H, W], got ${fmtShape(s)}`); const p = b.params;
            if (p.mode.startsWith('global')) return [s[0]];
            const st = p.stride || p.kernel; const out = s.slice(1).map(n => Math.floor((n - p.kernel) / st + 1)); if (out.some(n => n < 1)) throw new Error('Kernel larger than input'); return [s[0], ...out]; },
        torch: {
            init: (b) => { const p = b.params, d = b._inShapes[0].length - 1; if (p.mode.startsWith('global')) return null; const st = p.stride || p.kernel; return `nn.${p.mode === 'max' ? 'MaxPool' : 'AvgPool'}${d}d(${p.kernel}${st !== p.kernel ? ', stride=' + st : ''})`; },
            forward: (b, ins, ctx) => { const p = b.params, d = b._inShapes[0].length - 1; if (p.mode === 'global_avg') return `torch.flatten(F.adaptive_avg_pool${d}d(${ins[0]}, 1), 1)`; if (p.mode === 'global_max') return `torch.flatten(F.adaptive_max_pool${d}d(${ins[0]}, 1), 1)`; return `self.${ctx.attr(b)}(${ins[0]})`; },
        },
        keras: (b) => { const p = b.params, d = b._inShapes[0].length - 1; const st = p.stride || p.kernel;
            if (p.mode === 'global_avg') return { class_name: `GlobalAveragePooling${d}D`, config: {} };
            if (p.mode === 'global_max') return { class_name: `GlobalMaxPooling${d}D`, config: {} };
            const ks = d === 1 ? [p.kernel] : [p.kernel, p.kernel], ss = d === 1 ? [st] : [st, st];
            return { class_name: `${p.mode === 'max' ? 'MaxPooling' : 'AveragePooling'}${d}D`, config: { pool_size: ks, strides: ss, padding: 'valid' } }; },
        subtitle: (b) => b.params.mode.replace('_', ' '),
    });

    // ---- Custom / modules ----
    def({
        kind: 'custom', label: 'Custom', icon: 'code', group: 'custom', color: C.custom, inputs: 'variadic',
        desc: 'Verbatim PyTorch. {x} is the first input, {x0} {x1}… all inputs, {self} this block\'s attribute.',
        params: [P.code('init', 'self.<name> = …', '', 'nn.Linear(64, 64)'), P.code('forward', 'Forward expression', '{x}', '{self}({x}) * 2'), P.shape('shape', 'Output shape (blank = same as input)', [], 'e.g. 64')],
        infer: (ins, b) => { const t = NA.util.parseShape(b.params.shape); if (t.length) return t; return one(ins); },
        torch: {
            init: (b) => (b.params.init || '').trim() || null,
            forward: (b, ins, ctx) => { let e = (b.params.forward || '{x}'); e = e.replace(/\{self\}/g, 'self.' + ctx.attr(b)).replace(/\{x(\d+)\}/g, (_, i) => ins[+i] ?? 'None').replace(/\{x\}/g, ins[0] ?? 'None'); return e; },
        },
        keras: (b, ins, ctx) => { ctx.warn(`${b.title}: custom PyTorch blocks cannot be exported to Keras — emitted as identity`); return { class_name: 'Activation', config: { activation: 'linear' } }; },
    });
    def({
        kind: 'module', label: 'Module', icon: 'box', group: 'module', color: C.module, inputs: 'module',
        desc: 'An instance of a reusable module (a nested nn.Module). Edit the definition once; every instance follows.',
        params: [], infer: null, torch: null, keras: null,
    });
    def({
        kind: 'module_in', label: 'Module input', icon: 'arrow-right-to-line', group: 'boundary', color: C.boundary, inputs: [], hidden: true,
        desc: 'An input port of the enclosing module.',
        params: [P.shape('shape', 'Shape (for editing here)', [10], 'e.g. 256')],
        infer: (ins, b) => NA.util.parseShape(b.params.shape), torch: null, keras: null,
    });
    def({
        kind: 'module_out', label: 'Module output', icon: 'arrow-left-to-line', group: 'boundary', color: C.boundary, hidden: true,
        desc: 'An output port of the enclosing module.', params: [],
        infer: (ins) => one(ins), torch: null, keras: null,
    });

    const GROUPS = [
        { id: 'io', label: 'Inputs & outputs' }, { id: 'dense', label: 'Dense' }, { id: 'conv', label: 'Convolution' },
        { id: 'activation', label: 'Activation' }, { id: 'norm', label: 'Normalisation' }, { id: 'structural', label: 'Structure' },
        { id: 'sequence', label: 'Sequence' }, { id: 'custom', label: 'Custom' }, { id: 'module', label: 'Modules' },
    ];
    function get(kind) { return K[kind] || null; }
    function defaults(kind) { const k = K[kind]; const p = {}; if (k) for (const s of k.params) p[s.key] = NA.util.deepClone(s.default); return p; }
    function isVariadic(kind) { return K[kind]?.inputs === 'variadic'; }
    NA.catalogue = { get, defaults, isVariadic, kinds: () => ORDER.slice(), all: K, GROUPS, ACT, P, py, fanInJoin, joinedIn };
})();

// ============================================================
// NA.model — the project state: CRUD, validation, geometry
// ============================================================
(() => {
    const cfg = NA.config;
    const { uid, bus, deepClone, parseShape, clamp } = NA.util;
    let state = null;

    // ---------- construction / (de)serialisation ----------
    // The activation the user picked last is the default for every new wire that wants one
    function rememberedAct() { try { const a = localStorage.getItem('na.defaultAct'); return a && NA.catalogue.ACT[a] ? a : 'relu'; } catch (_) { return 'relu'; } }
    function rememberAct(a) { if (!a || !NA.catalogue.ACT[a] || !state) return; state.settings.defaultAct = a; try { localStorage.setItem('na.defaultAct', a); } catch (_) {} }
    // Which wires get an activation by default: the ones leaving a layer that produces
    // pre-activations, unless they feed a normaliser (norm-then-activate) or a model output (logits)
    const ACT_SOURCES = new Set(['linear', 'conv1d', 'conv2d', 'batchnorm', 'rnn']);
    const ACT_NO_TARGET = new Set(['output', 'module_out', 'batchnorm', 'layernorm']);
    function defaultActFor(fb, tb) { return fb && tb && ACT_SOURCES.has(fb.kind) && !ACT_NO_TARGET.has(tb.kind) ? (state ? state.settings.defaultAct : 'relu') || null : null; }
    function blank(name = 'Untitled model') {
        return {
            format: cfg.FORMAT, version: cfg.VERSION, savedAt: null,
            meta: { name, className: '', description: '' },
            view: { x: -80, y: -80, z: 1, path: [] },
            settings: { grid: true, snap: true, showShapes: true, animateWires: true, wheel: 'auto', defaultAct: rememberedAct(), mode: 'train' },
            blocks: [], edges: [], neuronEdges: [], groups: [], modules: {},
        };
    }
    function makeBlock(kind, title, o = {}) {
        const k = NA.catalogue.get(kind) || NA.catalogue.get('custom');
        const b = {
            id: o.id || uid('b'), kind: k.kind, title: title || k.label, comment: o.comment || '',
            params: Object.assign(NA.catalogue.defaults(k.kind), o.params || {}),
            pos: { x: o.pos?.x || 0, y: o.pos?.y || 0 }, color: o.color || null,
            regions: (o.regions || []).map(r => normRegion(r, k.kind)), neurons: o.neurons || {},
            dropout: Math.min(0.95, Math.max(0, +o.dropout || 0)),   // training-only: F.dropout on this block's output
            ui: Object.assign({ collapsed: false, expandedRegion: null, layout: 'auto' }, o.ui || {}),   // 'auto' | 'column' | 'grid' | 'rows' — see resolvedLayout
        };
        if (k.hasSize) b.size = o.size || k.defaultSize || 10;
        if (kind !== k.kind) b.comment = `Unknown kind "${kind}" — imported as custom. ` + b.comment;
        return b;
    }
    function normRegion(r, kind) {
        return { id: r.id || uid('r'), name: r.name || 'Region', start: r.start | 0, end: r.end | 0, color: r.color || null, comment: r.comment || '',
                 exposed: r.exposed !== undefined ? !!r.exposed : kind === 'input' };
    }
    // An edge carries the activation applied to the value flowing along it (null = identity):
    // activations are the link between blocks, never blocks of their own.
    function makeEdge(fromBlock, toBlock, fromPort = 'out', toPort = 'in', act = null) {
        return { id: uid('e'), from: { block: typeof fromBlock === 'string' ? fromBlock : fromBlock.id, port: fromPort }, to: { block: typeof toBlock === 'string' ? toBlock : toBlock.id, port: toPort }, act: cleanAct(act) };
    }
    function cleanAct(a) { return a && NA.catalogue.ACT[a] ? a : null; }
    // Legacy activation blocks (own kind, or ONNX Relu nodes) become activations on the wires:
    // src → [act] → dst collapses to src →(act)→ dst. Blocks with no source are dropped.
    // Legacy Dropout blocks (own kind, or ONNX Dropout nodes) become the source block's dropout:
    // src → [dropout p] → dst collapses to src(dropout p) → dst, keeping the wire's activation.
    function foldDropouts(g) {
        let folded = 0;
        for (const d of g.blocks.filter(b => b.kind === 'dropout')) {
            const inE = g.edges.find(e => e.to.block === d.id);
            const outs = g.edges.filter(e => e.from.block === d.id);
            const src = inE && g.blocks.find(b => b.id === inE.from.block);
            if (src) { src.dropout = Math.max(src.dropout || 0, +(d.params && d.params.p) || 0.1); for (const o of outs) g.edges.push({ id: uid('e'), from: { block: src.id, port: inE.from.port }, to: { block: o.to.block, port: o.to.port }, act: o.act || inE.act || null }); }
            g.edges = g.edges.filter(e => e.from.block !== d.id && e.to.block !== d.id);
            g.neuronEdges = g.neuronEdges.filter(e => e.from.block !== d.id && e.to.block !== d.id);
            for (const gr of g.groups) gr.blocks = gr.blocks.filter(id => id !== d.id);
            g.blocks = g.blocks.filter(b => b !== d); folded++;
        }
        return folded;
    }
    function foldActivations(g) {
        let folded = 0;
        for (const a of g.blocks.filter(b => b.kind === 'activation')) {
            const fn = cleanAct(a.params && a.params.fn) || 'relu';
            const inE = g.edges.find(e => e.to.block === a.id);
            const outs = g.edges.filter(e => e.from.block === a.id);
            if (inE) for (const o of outs) g.edges.push({ id: uid('e'), from: { block: inE.from.block, port: inE.from.port }, to: { block: o.to.block, port: o.to.port }, act: o.act || fn });
            g.edges = g.edges.filter(e => e.from.block !== a.id && e.to.block !== a.id);
            g.neuronEdges = g.neuronEdges.filter(e => e.from.block !== a.id && e.to.block !== a.id);
            for (const gr of g.groups) gr.blocks = gr.blocks.filter(id => id !== a.id);
            g.blocks = g.blocks.filter(b => b !== a); folded++;
        }
        return folded;
    }
    // Strip transient (underscore) keys
    function strip(o) {
        if (Array.isArray(o)) return o.map(strip);
        if (o && typeof o === 'object') { const r = {}; for (const k in o) if (k[0] !== '_') r[k] = strip(o[k]); return r; }
        return o;
    }
    // The FILE is the model and nothing else: no camera, no canvas preferences, no timestamp, so
    // two saves of an unchanged model are byte-identical and a colleague's copy diffs cleanly.
    // The session form (autosave, undo snapshots) keeps view + settings so a reload lands where
    // you were.
    const SESSION_KEYS = ['view', 'settings'];
    function serialize(opts = {}) {
        const s = strip(state);
        if (opts.session) { s.savedAt = new Date().toISOString(); return s; }
        for (const k of SESSION_KEYS) delete s[k];
        delete s.savedAt;
        return s;
    }
    // What changed between two projects, by block id (titles for people, ids for machines).
    // Position and canvas state do not count as a change; wires are compared by endpoints.
    function diff(a, b) {
        const key = (bl) => { const c = strip(bl); delete c.pos; delete c.ui; return JSON.stringify(c); };
        const A = new Map((a && a.blocks || []).map(bl => [bl.id, bl])), B = new Map((b && b.blocks || []).map(bl => [bl.id, bl]));
        const added = [], removed = [], changed = [];
        for (const [id, bl] of B) { if (!A.has(id)) added.push(bl.title); else if (key(A.get(id)) !== key(bl)) changed.push(bl.title); }
        for (const [id, bl] of A) if (!B.has(id)) removed.push(bl.title);
        const ek = (e) => `${e.from.block}:${e.from.port}>${e.to.block}:${e.to.port}:${e.act || ''}`;
        const EA = new Set((a && a.edges || []).map(ek)), EB = new Set((b && b.edges || []).map(ek));
        let wiresAdded = 0, wiresRemoved = 0; for (const k of EB) if (!EA.has(k)) wiresAdded++; for (const k of EA) if (!EB.has(k)) wiresRemoved++;
        const same = !added.length && !removed.length && !changed.length && !wiresAdded && !wiresRemoved;
        return { added, removed, changed, wiresAdded, wiresRemoved, same };
    }
    function diffSummary(d) {
        if (!d || d.same) return null;
        const parts = [];
        const n = (k, w) => `${k} ${w}${Math.abs(k) === 1 ? '' : 's'}`;
        if (d.added.length) parts.push('+' + n(d.added.length, 'block'));
        if (d.removed.length) parts.push('−' + n(d.removed.length, 'block'));
        if (d.changed.length) parts.push(n(d.changed.length, 'block') + ' changed');
        if (d.wiresAdded) parts.push('+' + n(d.wiresAdded, 'wire'));
        if (d.wiresRemoved) parts.push('−' + n(d.wiresRemoved, 'wire'));
        return parts.join(' · ');
    }

    // Validate + migrate any loaded JSON into a well-formed project. Tolerant: unknown
    // kinds become custom blocks, dangling edges are dropped, missing params get defaults.
    function migrate(json) {
        if (!json || typeof json !== 'object') throw new Error('Not a project');
        if (json.format !== cfg.FORMAT) throw new Error('Not a Neural Architect project (format "' + json.format + '")');
        if ((json.version || 1) > cfg.VERSION) throw new Error('This file was saved by a newer version');
        const p = blank();
        Object.assign(p.meta, json.meta || {});
        Object.assign(p.view, json.view || {}); p.view.path = Array.isArray(p.view.path) ? p.view.path : [];
        Object.assign(p.settings, json.settings || {});
        if (!NA.catalogue.ACT[p.settings.defaultAct]) p.settings.defaultAct = 'relu';
        if (p.settings.mode !== 'infer') p.settings.mode = 'train';
        const fixGraph = (g) => {
            const out = { blocks: [], edges: [], neuronEdges: [], groups: [] };
            const ids = new Set();
            for (const raw of (g.blocks || [])) {
                if (!raw || !raw.id || ids.has(raw.id)) continue;
                const b = makeBlock(raw.kind, raw.title, raw);
                b.id = raw.id; ids.add(b.id);
                if (raw.ui) Object.assign(b.ui, raw.ui);
                out.blocks.push(b);
            }
            for (const e of (g.edges || [])) if (e?.from?.block && e?.to?.block && ids.has(e.from.block) && ids.has(e.to.block)) out.edges.push({ id: e.id || uid('e'), from: { block: e.from.block, port: e.from.port || 'out' }, to: { block: e.to.block, port: e.to.port || 'in' }, act: cleanAct(e.act || e.activation) });
            for (const n of (g.neuronEdges || [])) if (n?.from?.block && n?.to?.block && ids.has(n.from.block) && ids.has(n.to.block)) out.neuronEdges.push({ id: n.id || uid('n'), from: { block: n.from.block, idx: n.from.idx | 0 }, to: { block: n.to.block, idx: n.to.idx | 0 }, init: (typeof n.init === 'number') ? n.init : null, comment: n.comment || '' });
            for (const gr of (g.groups || [])) if (gr && Array.isArray(gr.blocks)) out.groups.push({ id: gr.id || uid('g'), name: gr.name || 'Group', blocks: gr.blocks.filter(id => ids.has(id)), color: gr.color || null, comment: gr.comment || '' });
            foldActivations(out); foldDropouts(out);
            return out;
        };
        Object.assign(p, fixGraph(json));
        for (const id in (json.modules || {})) {
            const m = json.modules[id];
            if (!m || !m.graph) continue;
            p.modules[id] = { id, name: m.name || 'Module', comment: m.comment || '', builtin: !!m.builtin, graph: fixGraph(m.graph) };
        }
        // Drop module instances whose def is missing
        const dropMissing = (g) => { g.blocks = g.blocks.filter(b => b.kind !== 'module' || p.modules[b.params.def]); const ids = new Set(g.blocks.map(b => b.id)); g.edges = g.edges.filter(e => ids.has(e.from.block) && ids.has(e.to.block)); g.neuronEdges = g.neuronEdges.filter(e => ids.has(e.from.block) && ids.has(e.to.block)); };
        dropMissing(p); for (const id in p.modules) dropMissing(p.modules[id].graph);
        if (p.view.path.some(id => !p.modules[id])) p.view.path = [];
        return p;
    }

    function replace(json, opts = {}) {
        state = opts.raw ? json : migrate(json);
        NA.util.seedIds(state);
        NA.graph.refresh();
        emit('replace');
    }
    function newProject(name) { replace(blank(name), { raw: true }); }
    function get() { return state; }
    const EMPTY = { blocks: [], edges: [], neuronEdges: [], groups: [] };
    function graph() { if (!state) return EMPTY; const path = state.view.path; return path.length ? state.modules[path[path.length - 1]].graph : state; }
    function currentModule() { const path = state.view.path; return path.length ? state.modules[path[path.length - 1]] : null; }
    function block(id, g = graph()) { return g.blocks.find(b => b.id === id) || null; }
    let version = 0;
    function emit(type, data = {}) { version++; bus.emit('model:change', Object.assign({ type }, data)); }

    // ---------- blocks ----------
    function addBlock(kind, pos, o = {}) {
        const b = makeBlock(kind, o.title, Object.assign({}, o, { pos }));
        if (kind === 'module' && !o.params?.def) throw new Error('Module needs a def');
        graph().blocks.push(b);
        NA.graph.refresh(); emit('add', { ids: [b.id] });
        return b;
    }
    function removeBlocks(ids) {
        const g = graph(); const set = new Set(ids);
        g.blocks = g.blocks.filter(b => !set.has(b.id));
        g.edges = g.edges.filter(e => !set.has(e.from.block) && !set.has(e.to.block));
        g.neuronEdges = g.neuronEdges.filter(e => !set.has(e.from.block) && !set.has(e.to.block));
        for (const gr of g.groups) gr.blocks = gr.blocks.filter(id => !set.has(id));
        g.groups = g.groups.filter(gr => gr.blocks.length > 0);
        NA.graph.refresh(); emit('remove', { ids });
    }
    function updateBlock(id, patch, opts = {}) {
        const b = block(id); if (!b) return;
        for (const k in patch) {
            if (k === 'params') Object.assign(b.params, patch.params);
            else if (k === 'ui') Object.assign(b.ui, patch.ui);
            else b[k] = patch[k];
        }
        if (b.size !== undefined) b.size = Math.max(1, b.size | 0);
        if ('dropout' in patch) b.dropout = Math.min(0.95, Math.max(0, +patch.dropout || 0));
        clampRegions(b);
        NA.graph.refresh(); emit(opts.transient ? 'transient' : 'update', { ids: [id] });
    }
    function moveBlocks(ids, dx, dy, transient = true) {
        for (const id of ids) { const b = block(id); if (b) { b.pos.x += dx; b.pos.y += dy; } }
        emit(transient ? 'transient' : 'move', { ids });
    }
    function bringToFront(id) { const g = graph(); const i = g.blocks.findIndex(b => b.id === id); if (i >= 0) g.blocks.push(g.blocks.splice(i, 1)[0]); }

    // ---------- ports ----------
    // Input port ids for a block: 'in', 'in:0'…'in:n' (variadic, always one spare) or 'in:<moduleInId>'
    function inputPortIds(b, g = graph()) {
        const k = NA.catalogue.get(b.kind);
        if (b.kind === 'module') return moduleIO(b.params.def).ins.map(x => 'in:' + x.id);
        if (k.inputs === 'variadic') { const n = g.edges.filter(e => e.to.block === b.id).length; return Array.from({ length: n + 1 }, (_, i) => 'in:' + i); }
        return k.inputs.slice();
    }
    function outputPortIds(b) {
        if (b.kind === 'module') return moduleIO(b.params.def).outs.map(x => 'out:' + x.id);
        return ['out', ...b.regions.filter(r => r.exposed).map(r => 'out:' + r.id)];
    }
    function portLabel(b, portId) {
        if (portId === 'in' || portId === 'out') return '';
        const [dir, key] = portId.split(':');
        if (b.kind === 'module') { const io = moduleIO(b.params.def); const p = (dir === 'in' ? io.ins : io.outs).find(x => x.id === key); return p ? p.title : ''; }
        if (dir === 'out') { const r = b.regions.find(r => r.id === key); return r ? r.name : ''; }
        return '#' + key;
    }
    // Sort module_in / module_out boundary blocks by y so port order is stable and editable
    function moduleIO(defId) {
        const def = state && state.modules[defId]; if (!def) return { ins: [], outs: [] };
        const byY = (a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x;
        return { ins: def.graph.blocks.filter(b => b.kind === 'module_in').sort(byY), outs: def.graph.blocks.filter(b => b.kind === 'module_out').sort(byY) };
    }

    // ---------- edges ----------
    function addEdge(from, to, act = undefined) {
        const g = graph();
        const fb = block(from.block), tb = block(to.block);
        if (act === undefined) act = defaultActFor(fb, tb);
        if (!fb || !tb || fb.id === tb.id) return { error: 'Invalid connection' };
        if (!outputPortIds(fb).includes(from.port)) return { error: 'No such output port' };
        const inPorts = inputPortIds(tb);
        if (!inPorts.includes(to.port)) return { error: tb.kind === 'input' ? 'Inputs have no incoming ports' : 'No such input port' };
        if (NA.graph.reaches(g, tb.id, fb.id)) return { error: 'That would create a cycle' };
        if (g.edges.some(e => e.from.block === fb.id && e.from.port === from.port && e.to.block === tb.id && e.to.port === to.port)) return { error: 'Already connected' };
        // Non-variadic inputs hold one edge: replace it — except fan-in ports (Linear), which take several
        if (!NA.catalogue.get(tb.kind).fanIn) g.edges = g.edges.filter(e => !(e.to.block === tb.id && e.to.port === to.port));
        const e = makeEdge(fb, tb, from.port, to.port, act);
        g.edges.push(e);
        NA.graph.refresh(); emit('edge', { ids: [e.id] });
        return { edge: e };
    }
    function updateEdge(id, patch) {
        const e = graph().edges.find(x => x.id === id); if (!e) return;
        if ('act' in patch) { e.act = cleanAct(patch.act); rememberAct(e.act); }
        emit('update', { ids: [id] });
    }
    function setMode(mode) { if (!state) return; state.settings.mode = mode === 'infer' ? 'infer' : 'train'; emit('update'); }
    // Set the activation on a set of edges (by id). null clears it.
    function setActivation(edgeIds, act) {
        const g = graph(); const set = new Set(edgeIds); let n = 0;
        for (const e of g.edges) if (set.has(e.id)) { e.act = cleanAct(act); n++; }
        if (n) { rememberAct(cleanAct(act)); emit('update', { ids: edgeIds }); }
        return n;
    }
    // Every edge leaving a block (main output and region ports)
    function outgoingEdges(id, g = graph()) { return g.edges.filter(e => e.from.block === id); }
    function removeEdges(ids) {
        const g = graph(); const set = new Set(ids);
        g.edges = g.edges.filter(e => !set.has(e.id));
        compactVariadic(g);
        NA.graph.refresh(); emit('edge-remove', { ids });
    }
    // Variadic inputs stay dense (in:0, in:1, …) after a removal
    function compactVariadic(g) {
        for (const b of g.blocks) {
            if (!NA.catalogue.isVariadic(b.kind)) continue;
            const es = g.edges.filter(e => e.to.block === b.id).sort((a, c) => (+a.to.port.split(':')[1]) - (+c.to.port.split(':')[1]));
            es.forEach((e, i) => e.to.port = 'in:' + i);
        }
    }
    // Insert a new block on an existing edge: from → new → to
    function insertOnEdge(edgeId, kind, o = {}) {
        const g = graph(); const e = g.edges.find(x => x.id === edgeId); if (!e) return null;
        const a = block(e.from.block), c = block(e.to.block);
        const pos = o.pos || { x: (a.pos.x + c.pos.x) / 2, y: (a.pos.y + c.pos.y) / 2 };
        const b = makeBlock(kind, o.title, Object.assign({}, o, { pos }));
        g.blocks.push(b);
        g.edges = g.edges.filter(x => x.id !== edgeId);
        g.edges.push(makeEdge(a, b, e.from.port, inputPortIds(b)[0], e.act));
        g.edges.push(makeEdge(b, c, 'out', e.to.port));
        NA.graph.refresh(); emit('add', { ids: [b.id] });
        return b;
    }
    // Insert a block after `id`, re-routing every edge that left its main output
    function insertAfter(id, kind, o = {}) {
        const g = graph(); const a = block(id); if (!a) return null;
        const b = makeBlock(kind, o.title, Object.assign({}, o, { pos: { x: a.pos.x + cfg.BLOCK_W + cfg.LANE_GAP_X, y: a.pos.y } }));
        g.blocks.push(b);
        for (const e of g.edges) if (e.from.block === a.id && e.from.port === 'out') { e.from.block = b.id; }
        g.edges.push(makeEdge(a, b, 'out', 'in'));
        NA.graph.refresh(); emit('add', { ids: [b.id] });
        return b;
    }

    // Merge Input `sourceId` into Input `targetId`: one vector, the source's neurons appended as a
    // named region. Wires, region ports, neuron labels, neuron edges and frames follow.
    function mergeInputs(targetId, sourceId) {
        const g = graph(); const t = block(targetId, g), s = block(sourceId, g);
        if (!t || !s || t === s || t.kind !== 'input' || s.kind !== 'input') return { error: 'Only two Input blocks can be merged' };
        const ts = NA.util.parseShape(t.params.shape), ss = NA.util.parseShape(s.params.shape);
        if (ts.length !== 1 || ss.length !== 1) return { error: 'Only vector inputs can be merged' };
        if ((t.params.dtype || 'float32') !== (s.params.dtype || 'float32')) return { error: 'The two inputs have different dtypes' };
        const a = ts[0], n = ss[0];
        const plainOut = (b) => g.edges.filter(e => e.from.block === b.id && e.from.port === 'out');
        if (t.regions.length && plainOut(t).length) return { error: `“${t.title}” has regions and a wire from its whole output — wire it from a region first` };
        if (s.regions.length && plainOut(s).length) return { error: `“${s.title}” has regions and a wire from its whole output — wire it from a region first` };
        const pal = cfg.REGION_PALETTE; const nextColor = () => pal[t.regions.length % pal.length];
        // Each original whole-block wire keeps its meaning: it moves to a region covering the original block
        let tRegion = null, sRegion = null;
        if (!t.regions.length) { tRegion = normRegion({ name: t.title, start: 0, end: a, color: nextColor(), exposed: true }, 'input'); t.regions.push(tRegion); }
        if (s.regions.length) for (const r of s.regions) t.regions.push(Object.assign({}, r, { start: r.start + a, end: r.end + a, color: r.color || nextColor() }));
        else { sRegion = normRegion({ name: s.title, start: a, end: a + n, color: nextColor(), comment: s.comment, exposed: true }, 'input'); t.regions.push(sRegion); }
        for (const [i, v] of Object.entries(s.neurons)) t.neurons[+i + a] = v;
        t.params.shape = [a + n];
        for (const e of g.edges) {
            if (e.from.block === t.id && e.from.port === 'out' && tRegion) e.from.port = 'out:' + tRegion.id;
            if (e.from.block === s.id) { e.from.block = t.id; if (e.from.port === 'out') e.from.port = 'out:' + sRegion.id; }
        }
        for (const ne of g.neuronEdges) { if (ne.from.block === s.id) { ne.from.block = t.id; ne.from.idx += a; } if (ne.to.block === s.id) { ne.to.block = t.id; ne.to.idx += a; } }
        for (const gr of g.groups) if (gr.blocks.includes(s.id)) { gr.blocks = gr.blocks.filter(id => id !== s.id); if (!gr.blocks.includes(t.id)) gr.blocks.push(t.id); }
        if (s.comment) t.comment = [t.comment, `${s.title}: ${s.comment}`].filter(Boolean).join('\n');
        g.blocks = g.blocks.filter(b => b !== s);
        clampRegions(t);
        NA.graph.refresh(); emit('merge', { ids: [t.id] });
        return { block: t };
    }
    // ---------- neuron edges ----------
    function addNeuronEdge(from, to, init = null) {
        const g = graph();
        const fb = block(from.block), tb = block(to.block);
        if (!fb || !tb) return { error: 'Invalid connection' };
        if (fb.id === tb.id) return { error: 'A neuron cannot connect to its own block' };
        if (effectiveSize(fb) === null || effectiveSize(tb) === null) return { error: 'Both ends must be vector blocks' };
        if (from.idx < 0 || from.idx >= effectiveSize(fb) || to.idx < 0 || to.idx >= effectiveSize(tb)) return { error: 'Neuron index out of range' };
        if (g.neuronEdges.some(e => e.from.block === fb.id && e.from.idx === from.idx && e.to.block === tb.id && e.to.idx === to.idx)) return { error: 'Already connected' };
        const e = { id: uid('n'), from: { block: fb.id, idx: from.idx }, to: { block: tb.id, idx: to.idx }, init, comment: '' };
        g.neuronEdges.push(e);
        emit('neuron-edge', { ids: [e.id] });
        return { edge: e };
    }
    function addNeuronEdges(list) {
        const g = graph(); let n = 0;
        for (const { from, to, init } of list) {
            const fb = block(from.block), tb = block(to.block);
            if (!fb || !tb || fb.id === tb.id) continue;
            if (g.neuronEdges.some(e => e.from.block === fb.id && e.from.idx === from.idx && e.to.block === tb.id && e.to.idx === to.idx)) continue;
            g.neuronEdges.push({ id: uid('n'), from: { block: fb.id, idx: from.idx }, to: { block: tb.id, idx: to.idx }, init: init ?? null, comment: '' }); n++;
        }
        if (n) emit('neuron-edge', {});
        return n;
    }
    function removeNeuronEdges(ids) { const g = graph(); const set = new Set(ids); g.neuronEdges = g.neuronEdges.filter(e => !set.has(e.id)); emit('neuron-edge-remove', { ids }); }
    function updateNeuronEdge(id, patch) { const e = graph().neuronEdges.find(x => x.id === id); if (e) { Object.assign(e, patch); emit('update', {}); } }

    // ---------- regions & neuron annotations ----------
    function clampRegions(b) {
        const n = effectiveSize(b);
        if (n === null) return;
        // A region that lies entirely past the end is gone, not squashed onto the last neuron (the UI asks first: regionsCut / shrinkTo)
        const gone = b.regions.filter(r => (r.start | 0) >= n);
        if (gone.length) { const ids = new Set(gone.map(r => r.id)); b.regions = b.regions.filter(r => !ids.has(r.id)); const g = graph(); g.edges = g.edges.filter(e => !(e.from.block === b.id && e.from.port.startsWith('out:') && ids.has(e.from.port.slice(4)))); if (ids.has(b.ui.expandedRegion)) b.ui.expandedRegion = null; }
        for (const r of b.regions) { r.start = clamp(r.start | 0, 0, Math.max(0, n - 1)); r.end = clamp(r.end | 0, r.start + 1, n); }
        b.regions.sort((a, c) => a.start - c.start);
    }
    // Which regions would a resize to n neurons cut? lost = entirely past the end, otherwise trimmed
    function regionsCut(b, n) {
        return b.regions.filter(r => r.end > n).sort((a, c) => a.start - c.start).map(r => ({ region: r, lost: r.start >= n }));
    }
    // Resize a block to n neurons in one step: delete the named regions, trim the rest
    function shrinkTo(blockId, n, removeIds = []) {
        const b = block(blockId); if (!b) return;
        n = Math.max(1, n | 0);
        const ids = new Set(removeIds);
        b.regions = b.regions.filter(r => !ids.has(r.id));
        const g = graph(); g.edges = g.edges.filter(e => !(e.from.block === b.id && e.from.port.startsWith('out:') && ids.has(e.from.port.slice(4))));
        if (ids.has(b.ui.expandedRegion)) b.ui.expandedRegion = null;
        const k = NA.catalogue.get(b.kind);
        if (k.hasSize) b.size = n; else if (b.kind === 'input' || b.kind === 'module_in' || b.kind === 'reshape') b.params.shape = [n];
        clampRegions(b);
        NA.graph.refresh(); emit('update', { ids: [blockId] });
    }
    function addRegion(blockId, r) {
        const b = block(blockId); if (!b) return null;
        const reg = normRegion(r, b.kind);
        if (!reg.color) reg.color = cfg.REGION_PALETTE[b.regions.length % cfg.REGION_PALETTE.length];
        if (b.regions.some(x => x.start < reg.end && reg.start < x.end)) return { error: 'Regions cannot overlap' };
        b.regions.push(reg); clampRegions(b);
        NA.graph.refresh(); emit('update', { ids: [blockId] });
        return { region: reg };
    }
    function updateRegion(blockId, regionId, patch) {
        const b = block(blockId); const r = b && b.regions.find(x => x.id === regionId); if (!r) return;
        Object.assign(r, patch); clampRegions(b);
        if (b.regions.some(x => x !== r && x.start < r.end && r.start < x.end)) { /* overlap: nudge end back */ const nxt = b.regions.filter(x => x !== r && x.start >= r.start).sort((a, c) => a.start - c.start)[0]; if (nxt) r.end = Math.min(r.end, nxt.start); }
        if (!r.exposed) graph().edges = graph().edges.filter(e => !(e.from.block === b.id && e.from.port === 'out:' + r.id));
        NA.graph.refresh(); emit('update', { ids: [blockId] });
    }
    function removeRegion(blockId, regionId) {
        const b = block(blockId); if (!b) return;
        b.regions = b.regions.filter(x => x.id !== regionId);
        graph().edges = graph().edges.filter(e => !(e.from.block === b.id && e.from.port === 'out:' + regionId));
        if (b.ui.expandedRegion === regionId) b.ui.expandedRegion = null;
        NA.graph.refresh(); emit('update', { ids: [blockId] });
    }
    function setNeuron(blockId, idx, patch) {
        const b = block(blockId); if (!b) return;
        const key = String(idx);
        if (patch === null) delete b.neurons[key];
        else { const cur = b.neurons[key] || { label: '', comment: '', color: null }; Object.assign(cur, patch); if (!cur.label && !cur.comment && !cur.color) delete b.neurons[key]; else b.neurons[key] = cur; }
        emit('update', { ids: [blockId] });
    }

    // ---------- groups (visual frames) ----------
    function addGroup(name, blockIds, color = null) { const g = { id: uid('g'), name: name || 'Group', blocks: blockIds.slice(), color, comment: '' }; graph().groups.push(g); emit('update', {}); return g; }
    function updateGroup(id, patch) { const g = graph().groups.find(x => x.id === id); if (g) { Object.assign(g, patch); emit('update', {}); } }
    function removeGroup(id) { const g = graph(); g.groups = g.groups.filter(x => x.id !== id); emit('update', {}); }

    // ---------- modules ----------
    function ensureModuleDef(def) {
        if (!state.modules[def.id]) state.modules[def.id] = deepClone(def);
        return state.modules[def.id];
    }
    // Turn the selected blocks of the current graph into a module definition + one instance
    function groupIntoModule(blockIds, name = 'Module') {
        const g = graph(); const set = new Set(blockIds);
        const inside = g.blocks.filter(b => set.has(b.id));
        if (!inside.length) return { error: 'Select blocks first' };
        if (inside.some(b => b.kind === 'input' || b.kind === 'output' || b.kind === 'module_in' || b.kind === 'module_out')) return { error: 'Inputs / outputs cannot live inside a module' };
        const def = { id: uid('m'), name, comment: '', builtin: false, graph: { blocks: [], edges: [], neuronEdges: [], groups: [] } };
        const minX = Math.min(...inside.map(b => b.pos.x)), minY = Math.min(...inside.map(b => b.pos.y));
        const maxX = Math.max(...inside.map(b => b.pos.x)), maxY = Math.max(...inside.map(b => b.pos.y));
        def.graph.blocks = inside.map(b => { const c = deepClone(strip(b)); c.pos = { x: b.pos.x - minX + 300, y: b.pos.y - minY }; return c; });
        const inst = makeBlock('module', name, { params: { def: def.id }, pos: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } });
        const newEdges = [];
        const inMap = new Map(); // "srcBlock:srcPort" -> module_in block
        let dropped = 0, inY = 0, outY = 0;
        for (const e of g.edges) {
            const fi = set.has(e.from.block), ti = set.has(e.to.block);
            if (fi && ti) { def.graph.edges.push(deepClone(e)); continue; }
            if (!fi && !ti) { newEdges.push(e); continue; }
            if (!fi && ti) {   // entering the module
                const key = e.from.block + ':' + e.from.port;
                let mi = inMap.get(key);
                if (!mi) {
                    const src = block(e.from.block);
                    const shape = NA.graph.portShape(src, e.from.port) || [64];
                    mi = makeBlock('module_in', portLabel(src, e.from.port) ? `${src.title} · ${portLabel(src, e.from.port)}` : src.title, { params: { shape }, pos: { x: 0, y: inY } });
                    inY += 120; inMap.set(key, mi); def.graph.blocks.push(mi);
                    newEdges.push(makeEdge(e.from.block, inst, e.from.port, 'in:' + mi.id));
                }
                def.graph.edges.push(makeEdge(mi, e.to.block, 'out', e.to.port, e.act));
            } else {           // leaving the module
                const srcInside = inside.find(b => b.id === e.from.block);
                let mo = def.graph.blocks.find(b => b.kind === 'module_out' && b._srcKey === e.from.block + ':' + e.from.port);
                if (!mo) {
                    mo = makeBlock('module_out', srcInside.title, { pos: { x: maxX - minX + 600, y: outY } }); mo._srcKey = e.from.block + ':' + e.from.port; outY += 120;
                    def.graph.blocks.push(mo);
                    def.graph.edges.push(makeEdge(e.from.block, mo, e.from.port, 'in'));
                }
                newEdges.push(makeEdge(inst, e.to.block, 'out:' + mo.id, e.to.port, e.act));
            }
        }
        for (const n of g.neuronEdges) { const fi = set.has(n.from.block), ti = set.has(n.to.block); if (fi && ti) def.graph.neuronEdges.push(deepClone(n)); else if (fi || ti) dropped++; }
        def.graph.blocks.forEach(b => delete b._srcKey);
        state.modules[def.id] = def;
        g.blocks = g.blocks.filter(b => !set.has(b.id)); g.blocks.push(inst);
        g.edges = newEdges;
        g.neuronEdges = g.neuronEdges.filter(n => !set.has(n.from.block) && !set.has(n.to.block));
        for (const gr of g.groups) gr.blocks = gr.blocks.filter(id => !set.has(id));
        g.groups = g.groups.filter(gr => gr.blocks.length);
        compactVariadic(g);
        NA.graph.refresh(); emit('add', { ids: [inst.id] });
        return { instance: inst, def, droppedNeuronEdges: dropped };
    }
    // Inline a module instance back into the current graph
    function ungroupModule(instId) {
        const g = graph(); const inst = block(instId); if (!inst || inst.kind !== 'module') return { error: 'Not a module' };
        const def = state.modules[inst.params.def]; if (!def) return { error: 'Missing definition' };
        const idMap = new Map();
        const clones = def.graph.blocks.map(b => { const c = deepClone(strip(b)); c.id = uid('b'); idMap.set(b.id, c.id); return c; });
        const inner = clones.filter(c => c.kind !== 'module_in' && c.kind !== 'module_out');
        const minX = Math.min(...inner.map(b => b.pos.x), 0), minY = Math.min(...inner.map(b => b.pos.y), 0);
        for (const c of inner) { c.pos.x = inst.pos.x + (c.pos.x - minX) - 150; c.pos.y = inst.pos.y + (c.pos.y - minY); }
        const keep = new Set(inner.map(c => c.id));
        const edges = [];
        // internal edges
        for (const e of def.graph.edges) {
            const f = idMap.get(e.from.block), t = idMap.get(e.to.block);
            const fb = clones.find(c => c.id === f), tb = clones.find(c => c.id === t);
            if (fb.kind === 'module_in') {
                const ext = g.edges.find(x => x.to.block === inst.id && x.to.port === 'in:' + e.from.block);
                if (ext) edges.push(makeEdge(ext.from.block, t, ext.from.port, e.to.port, e.act || ext.act));
            } else if (tb.kind === 'module_out') {
                for (const ext of g.edges.filter(x => x.from.block === inst.id && x.from.port === 'out:' + e.to.block)) edges.push(makeEdge(f, ext.to.block, e.from.port, ext.to.port, ext.act || e.act));
            } else edges.push(makeEdge(f, t, e.from.port, e.to.port, e.act));
        }
        g.blocks = g.blocks.filter(b => b.id !== inst.id).concat(inner);
        g.edges = g.edges.filter(e => e.from.block !== inst.id && e.to.block !== inst.id).concat(edges);
        for (const n of def.graph.neuronEdges) g.neuronEdges.push({ id: uid('n'), from: { block: idMap.get(n.from.block), idx: n.from.idx }, to: { block: idMap.get(n.to.block), idx: n.to.idx }, init: n.init, comment: n.comment });
        for (const gr of def.graph.groups) g.groups.push({ id: uid('g'), name: gr.name, blocks: gr.blocks.map(id => idMap.get(id)).filter(id => keep.has(id)), color: gr.color, comment: gr.comment });
        compactVariadic(g);
        NA.graph.refresh(); emit('add', { ids: inner.map(c => c.id) });
        return { ids: inner.map(c => c.id) };
    }
    function enterModule(defId) { if (!state.modules[defId]) return; state.view.path.push(defId); NA.graph.refresh(); emit('navigate'); }
    function exitModule() { if (!state.view.path.length) return; state.view.path.pop(); NA.graph.refresh(); emit('navigate'); }
    function goToPath(depth) { state.view.path.length = Math.max(0, Math.min(depth, state.view.path.length)); NA.graph.refresh(); emit('navigate'); }
    function updateModuleDef(id, patch) { const d = state.modules[id]; if (d) { Object.assign(d, patch); emit('update', {}); } }
    function removeModuleDef(id) {
        const used = (g) => g.blocks.some(b => b.kind === 'module' && b.params.def === id);
        if (used(state) || Object.values(state.modules).some(m => used(m.graph))) return { error: 'Module is still in use' };
        delete state.modules[id]; emit('update', {}); return {};
    }

    // ---------- geometry ----------
    // Number of neuron dots a block shows: its size for sized kinds, the vector length
    // for rank-1 passthrough kinds, null for pills.
    function effectiveSize(b) {
        const k = NA.catalogue.get(b.kind);
        if (k.hasSize) return b.size;
        if (b.kind === 'input' || b.kind === 'module_in') { const s = parseShape(b.params.shape); return s.length === 1 ? s[0] : null; }
        if (b.kind === 'reshape') { const s = parseShape(b.params.shape); return s.length === 1 ? s[0] : null; }
        if (b._shape && b._shape.length === 1) return b._shape[0];
        return null;
    }
    // Rows of the virtualised strip for large blocks: regions plus auto-chunks for the gaps
    function stripRows(b) {
        const n = effectiveSize(b); const rows = []; let cursor = 0;
        const regs = b.regions.slice().sort((a, c) => a.start - c.start);
        const pushChunks = (from, to) => { for (let s = from; s < to; s += cfg.LOD.CHUNK) rows.push({ id: 'chunk:' + s, name: '', start: s, end: Math.min(to, s + cfg.LOD.CHUNK), color: null, auto: true }); };
        for (const r of regs) { if (r.start > cursor) pushChunks(cursor, r.start); rows.push({ id: r.id, name: r.name, start: r.start, end: r.end, color: r.color, auto: false, region: r }); cursor = r.end; }
        if (cursor < n) pushChunks(cursor, n);
        return rows;
    }
    // How a block shows its neurons — the user's pick, or 'auto': small blocks list one neuron per
    // row; big hidden layers are a dot grid (the picture of the network); big inputs and outputs
    // are ROWS — their regions as a table of contents, one expandable at a time — because ten
    // inputs of 150 neurons as columns would make the canvas two screens tall.
    const LAYOUTS = ['column', 'grid', 'rows'];
    function resolvedLayout(b) {
        if (LAYOUTS.includes(b.ui.layout)) return b.ui.layout;
        const k = NA.catalogue.get(b.kind); const n = effectiveSize(b);
        if (k.compact) return 'grid';
        if (n === null || n <= 32) return 'column';
        return /^(input|output|module_in|module_out)$/.test(b.kind) ? 'rows' : 'grid';
    }
    // Inside a strip, an expanded range of more than 32 neurons is a grid, fewer is a list
    function expandedAsGrid(b) { return expandedCount(b) > 32; }
    // Modes: 'pill' (no neurons) · 'collapsed' (title only) · 'column' (one neuron per row) ·
    // 'dots' (compact grid) · 'strip' (named ranges as rows, expand one) — 'rows' or too many neurons
    function layoutMode(b) {
        const n = effectiveSize(b);
        if (n === null) return 'pill';
        if (b.ui.collapsed) return 'collapsed';
        const l = resolvedLayout(b);
        if (l === 'rows') return 'strip';
        if (n > (l === 'grid' ? cfg.LOD.VIRTUALISE_ABOVE : cfg.COLUMN_VIRTUALISE_ABOVE)) return 'strip';
        return l === 'grid' ? 'dots' : 'column';
    }
    function bodyHeight(b) {
        const mode = layoutMode(b);
        if (mode === 'pill' || mode === 'collapsed') return 0;
        const n = effectiveSize(b);
        if (mode === 'column') return n * cfg.COL_PITCH + 2 * cfg.BODY_PAD;
        if (mode === 'dots') return n <= 64 ? cfg.BODY_H.small : cfg.BODY_H.medium;
        const rows = Math.min(stripRows(b).length, cfg.STRIP_MAX_ROWS + 1);
        const exp = b.ui.expandedRegion ? (expandedAsGrid(b) ? cfg.EXPANDED_H : expandedCount(b) * cfg.COL_PITCH + 2 * cfg.BODY_PAD) : 0;
        return rows * cfg.STRIP_ROW_H + 2 * cfg.BODY_PAD + exp;
    }
    function expandedCount(b) { const row = stripRows(b).find(r => r.id === b.ui.expandedRegion); return row ? row.end - row.start : 0; }
    function rect(b, g = graph()) {
        const mode = layoutMode(b);
        const nIn = inputPortIds(b, g).length, nOut = outputPortIds(b).length;
        const portsH = Math.max(nIn, nOut) * cfg.PORT_GAP + 20;
        if (mode === 'pill') return { x: b.pos.x, y: b.pos.y, w: cfg.BLOCK_W, h: Math.max(cfg.PILL_H, portsH), mode };
        // Collapsed: the header plus one row per region (each region port sits on its row)
        if (mode === 'collapsed') return { x: b.pos.x, y: b.pos.y, w: cfg.BLOCK_W, h: Math.max(cfg.HEADER_H + (b.regions.length ? b.regions.length * cfg.COLLAPSED_ROW_H + 8 : 6), (mode === 'collapsed' && b.regions.length ? 0 : portsH)), mode };
        return { x: b.pos.x, y: b.pos.y, w: cfg.BLOCK_W, h: Math.max(cfg.HEADER_H + bodyHeight(b), portsH), mode };
    }
    function bodyRect(b) { const r = rect(b); if (r.mode === 'pill' || r.mode === 'collapsed') return null; return { x: r.x, y: r.y + cfg.HEADER_H, w: r.w, h: r.h - cfg.HEADER_H }; }
    // The small buttons in a block header (collapse, layout toggle) — world rects, right-aligned
    function headerButtons(b, r = rect(b)) {
        if (r.mode === 'pill') return [];
        const s = cfg.HEADER_BTN, y = r.y + cfg.HEADER_H / 2 - s / 2; const out = [];
        out.push({ id: 'collapse', x: r.x + r.w - 10 - s, y, w: s, h: s });
        if (r.mode !== 'collapsed') out.push({ id: 'layout', x: r.x + r.w - 10 - 2 * s - 6, y, w: s, h: s });
        return out;
    }
    // The area holding neuron dots (column / dots: the body; strip: the expanded area)
    function dotsRect(b) {
        const r = rect(b); const pad = cfg.BODY_PAD;
        if (r.mode === 'dots' || r.mode === 'column') return { x: r.x + pad, y: r.y + cfg.HEADER_H + pad, w: r.w - 2 * pad, h: r.h - cfg.HEADER_H - 2 * pad };
        if (r.mode === 'strip' && b.ui.expandedRegion) { const rows = Math.min(stripRows(b).length, cfg.STRIP_MAX_ROWS + 1); const y = r.y + cfg.HEADER_H + pad + rows * cfg.STRIP_ROW_H + pad; const h = expandedAsGrid(b) ? cfg.EXPANDED_H - 2 * pad : expandedCount(b) * cfg.COL_PITCH; return { x: r.x + pad, y, w: r.w - 2 * pad, h }; }
        return null;
    }
    // Neuron cells: {x0, y0, cols, rows, pitch, cellW, start, end, count}. Column layout is one
    // cell per row spanning the block width (dot at the left, index + label beside it).
    function neuronLayout(b) {
        const area = dotsRect(b); if (!area) return null;
        const r = rect(b);
        let start = 0, end = effectiveSize(b);
        if (r.mode === 'strip') { const row = stripRows(b).find(x => x.id === b.ui.expandedRegion); if (!row) return null; start = row.start; end = row.end; }
        const n = end - start; if (n <= 0) return null;
        const asColumn = r.mode === 'strip' ? !expandedAsGrid(b) : resolvedLayout(b) !== 'grid';
        if (asColumn) return { x0: area.x, y0: area.y, cols: 1, rows: n, pitch: cfg.COL_PITCH, cellW: area.w, start, end, count: n, column: true };
        const cols = Math.max(1, Math.ceil(Math.sqrt(n * area.w / area.h)));
        const rows = Math.ceil(n / cols);
        const pitch = Math.min(area.w / cols, area.h / rows);
        return { x0: area.x + (area.w - cols * pitch) / 2, y0: area.y + (area.h - rows * pitch) / 2, cols, rows, pitch, cellW: pitch, start, end, count: n, column: false };
    }
    function neuronCenter(b, idx, L = neuronLayout(b)) {
        if (!L || idx < L.start || idx >= L.end) return null;
        const i = idx - L.start;
        return { x: L.x0 + ((i % L.cols) + 0.5) * L.pitch, y: L.y0 + (Math.floor(i / L.cols) + 0.5) * L.pitch };
    }
    function neuronAt(b, wx, wy, L = neuronLayout(b)) {
        if (!L) return null;
        const c = Math.floor((wx - L.x0) / L.cellW), r = Math.floor((wy - L.y0) / L.pitch);
        if (c < 0 || c >= L.cols || r < 0 || r >= L.rows) return null;
        const i = r * L.cols + c; if (i >= L.count) return null;
        return L.start + i;
    }
    // Where a region sits inside a block (for bands, ports, marquee): up to three cell rects
    function regionCells(b, start, end, L = neuronLayout(b)) {
        if (!L) return [];
        const s = Math.max(start, L.start), e = Math.min(end, L.end); if (e <= s) return [];
        const i0 = s - L.start, i1 = e - 1 - L.start;
        const r0 = Math.floor(i0 / L.cols), r1 = Math.floor(i1 / L.cols), c0 = i0 % L.cols, c1 = i1 % L.cols;
        const cell = (ra, rb, ca, cb) => ({ x: L.x0 + ca * L.cellW, y: L.y0 + ra * L.pitch, w: (cb - ca + 1) * L.cellW, h: (rb - ra + 1) * L.pitch });
        if (r0 === r1) return [cell(r0, r0, c0, c1)];
        const out = [cell(r0, r0, c0, L.cols - 1)];
        if (r1 - r0 > 1) out.push(cell(r0 + 1, r1 - 1, 0, L.cols - 1));
        out.push(cell(r1, r1, 0, c1));
        return out;
    }
    // Vertical centre of a region on the block's right edge (for its port)
    function regionPortY(b, region) {
        const r = rect(b);
        if (r.mode === 'collapsed') { const i = b.regions.slice().sort((a, c) => a.start - c.start).indexOf(region); return r.y + cfg.HEADER_H + 4 + (i + 0.5) * cfg.COLLAPSED_ROW_H; }
        if (r.mode === 'strip') { const rows = stripRows(b); const i = rows.findIndex(x => x.id === region.id); if (i >= 0 && i < cfg.STRIP_MAX_ROWS) return r.y + cfg.HEADER_H + cfg.BODY_PAD + (i + 0.5) * cfg.STRIP_ROW_H; return r.y + r.h / 2; }
        const cells = regionCells(b, region.start, region.end);
        if (!cells.length) return r.y + r.h / 2;
        const top = cells[0].y, bot = cells[cells.length - 1].y + cells[cells.length - 1].h;
        return (top + bot) / 2;
    }
    function ports(b, g = graph()) {
        const r = rect(b, g); const out = [];
        const ins = inputPortIds(b, g), outs = outputPortIds(b);
        const baseY = r.mode === 'pill' ? r.y + r.h / 2 : r.y + cfg.HEADER_H / 2;
        ins.forEach((id, i) => out.push({ id, dir: 'in', x: r.x, y: baseY + i * cfg.PORT_GAP, label: portLabel(b, id) }));
        outs.forEach((id, i) => {
            let y = baseY + i * cfg.PORT_GAP;
            if (id.startsWith('out:') && b.kind !== 'module' && r.mode !== 'pill') { const reg = b.regions.find(x => x.id === id.slice(4)); if (reg) y = regionPortY(b, reg); }
            out.push({ id, dir: 'out', x: r.x + r.w, y, label: portLabel(b, id) });
        });
        return out;
    }
    function portPos(b, portId, g = graph()) { return ports(b, g).find(p => p.id === portId) || null; }
    function edgeEndpoints(e, g = graph()) {
        const a = block(e.from.block, g), c = block(e.to.block, g); if (!a || !c) return null;
        const p = portPos(a, e.from.port, g), q = portPos(c, e.to.port, g); if (!p || !q) return null;
        return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
    }
    function bounds(blocks = graph().blocks) {
        if (!blocks.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const b of blocks) { const r = rect(b); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    function blockColor(b) { return b.color || NA.catalogue.get(b.kind).color; }
    // Lanes: blocks live in fixed columns (inputs → hidden layers → outputs, left to right),
    // laneWidth apart, the same columns auto-layout uses. Snapping lands a block in a lane.
    const laneWidth = () => cfg.BLOCK_W + cfg.LANE_GAP_X;
    function laneOf(x) { return Math.round(x / laneWidth()); }
    function laneX(k) { return k * laneWidth(); }
    function snapPos(x, y) { return { x: laneX(laneOf(x)), y: Math.round(y / cfg.SNAP_Y) * cfg.SNAP_Y }; }
    // Global neuron numbering: within a lane, blocks count upwards top to bottom, so a second
    // 10-neuron box under "0–9" shows 10–19. The model keeps local indices; only labels change.
    let offCache = { v: -1, g: null, map: null };
    function laneOffsets(g = graph()) {
        if (offCache.v === version && offCache.g === g) return offCache.map;
        const lanes = new Map();
        for (const b of g.blocks) { const n = effectiveSize(b); if (n === null) continue; const k = laneOf(b.pos.x); if (!lanes.has(k)) lanes.set(k, []); lanes.get(k).push(b); }
        const map = new Map();
        for (const bs of lanes.values()) {
            bs.sort((a, c) => a.pos.y - c.pos.y || a.pos.x - c.pos.x || a.id.localeCompare(c.id));
            let off = 0; for (const b of bs) { map.set(b.id, off); off += effectiveSize(b); }
        }
        offCache = { v: version, g, map }; return map;
    }
    function neuronOffset(b, g = graph()) { return laneOffsets(g).get(b.id) || 0; }
    // "Sensors (0–9), Objective (10–19)" or "(0–9)": the range summary shown on a collapsed block
    function rangeSummary(b, g = graph()) {
        const n = effectiveSize(b); if (n === null) return '';
        const off = neuronOffset(b, g);
        if (b.regions.length) return b.regions.slice().sort((a, c) => a.start - c.start).map(r => `${r.name} (${off + r.start}–${off + r.end - 1})`).join(', ');
        return `(${off}–${off + n - 1})`;
    }

    NA.model = {
        blank, makeBlock, makeEdge, strip, serialize, diff, diffSummary, migrate, replace, newProject, get, graph, currentModule, block, emit,
        addBlock, removeBlocks, updateBlock, moveBlocks, bringToFront,
        inputPortIds, outputPortIds, portLabel, moduleIO,
        addEdge, removeEdges, insertOnEdge, insertAfter, updateEdge, setActivation, outgoingEdges, foldActivations, foldDropouts, cleanAct, defaultActFor, rememberAct, setMode, mergeInputs,
        addNeuronEdge, addNeuronEdges, removeNeuronEdges, updateNeuronEdge,
        addRegion, updateRegion, removeRegion, setNeuron, clampRegions, regionsCut, shrinkTo,
        addGroup, updateGroup, removeGroup,
        ensureModuleDef, groupIntoModule, ungroupModule, enterModule, exitModule, goToPath, updateModuleDef, removeModuleDef,
        effectiveSize, stripRows, layoutMode, resolvedLayout, LAYOUTS, rect, bodyRect, headerButtons, dotsRect, neuronLayout, neuronCenter, neuronAt, regionCells, regionPortY,
        ports, portPos, edgeEndpoints, bounds, blockColor, laneWidth, laneOf, laneX, snapPos, laneOffsets, neuronOffset, rangeSummary,
        get version() { return version; },
    };
})();

// ============================================================
// NA.graph — topo sort, reachability, shape inference, diagnostics
// ============================================================
(() => {
    function byId(g) { const m = new Map(); for (const b of g.blocks) m.set(b.id, b); return m; }
    function incoming(g, id) { return g.edges.filter(e => e.to.block === id); }
    function outgoing(g, id) { return g.edges.filter(e => e.from.block === id); }
    function incomingOn(g, id, port) { return g.edges.find(e => e.to.block === id && e.to.port === port) || null; }
    // Every wire into a port, ordered like the canvas (source top to bottom, then left to right):
    // that order is the concatenation order for fan-in ports, so what you see is what you export
    function incomingAll(g, id, port) {
        const map = byId(g); const self = map.get(id); const primary = self && self.params && self.params.query_from;
        // Two wires from the same block follow its region order (top to bottom inside the block)
        const regStart = (e, b) => { if (!b || !e.from.port.startsWith('out:')) return -1; const r = b.regions.find(x => x.id === e.from.port.slice(4)); return r ? r.start : -1; };
        return g.edges.filter(e => e.to.block === id && e.to.port === port)
            .sort((a, c) => { const A = map.get(a.from.block), C = map.get(c.from.block); return (primary ? (c.from.block === primary) - (a.from.block === primary) : 0) || (A?.pos.y ?? 0) - (C?.pos.y ?? 0) || (A?.pos.x ?? 0) - (C?.pos.x ?? 0) || regStart(a, A) - regStart(c, C) || a.id.localeCompare(c.id); });
    }
    // Wires feeding a block's input ports, one list per port (fan-in ports may hold several)
    function incomingLists(g, b) { const k = NA.catalogue.get(b.kind); return NA.model.inputPortIds(b, g).map(pid => k.fanIn ? incomingAll(g, b.id, pid) : (incomingOn(g, b.id, pid) ? [incomingOn(g, b.id, pid)] : [])); }
    // Does a path exist from `from` to `to`?
    function reaches(g, from, to) {
        if (from === to) return true;
        const seen = new Set([from]); const stack = [from];
        while (stack.length) { const id = stack.pop(); for (const e of g.edges) if (e.from.block === id && !seen.has(e.to.block)) { if (e.to.block === to) return true; seen.add(e.to.block); stack.push(e.to.block); } }
        return false;
    }
    // Kahn's algorithm; ties broken left-to-right, top-to-bottom so generated code reads like the canvas
    function topoSort(g) {
        const indeg = new Map(g.blocks.map(b => [b.id, 0]));
        for (const e of g.edges) indeg.set(e.to.block, (indeg.get(e.to.block) || 0) + 1);
        const cmp = (a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y || a.id.localeCompare(b.id);
        let ready = g.blocks.filter(b => indeg.get(b.id) === 0).sort(cmp);
        const order = []; const done = new Set();
        while (ready.length) {
            const b = ready.shift(); order.push(b); done.add(b.id);
            const freed = [];
            for (const e of outgoing(g, b.id)) { indeg.set(e.to.block, indeg.get(e.to.block) - 1); if (indeg.get(e.to.block) === 0) freed.push(g.blocks.find(x => x.id === e.to.block)); }
            if (freed.length) ready = ready.concat(freed).sort(cmp);
        }
        const cyclic = order.length < g.blocks.length;
        if (cyclic) for (const b of g.blocks) if (!done.has(b.id)) order.push(b);
        return { order, cyclic };
    }
    // Shape of what leaves a block through `portId` (null when unknown)
    function portShape(b, portId) {
        if (!b) return null;
        if (b.kind === 'module') { if (!b._outShapes) return null; const io = NA.model.moduleIO(b.params.def); const i = io.outs.findIndex(x => 'out:' + x.id === portId); return i >= 0 ? b._outShapes[i] : null; }
        if (portId === 'out') return b._shape || null;
        if (portId.startsWith('out:')) { const r = b.regions.find(x => x.id === portId.slice(4)); if (!r || !b._shape) return null; return [r.end - r.start, ...b._shape.slice(1)]; }
        return null;
    }
    // Run inference over a graph. `bound` maps module_in ids to shapes when the graph is a
    // module definition evaluated at an instance. Writes b._shape / b._inShapes / b._error.
    function inferShapes(g, bound = null, depth = 0) {
        const diags = [];
        const { order, cyclic } = topoSort(g);
        if (cyclic) diags.push({ block: null, message: 'The graph contains a cycle', level: 'error' });
        const map = byId(g);
        for (const b of order) {
            const k = NA.catalogue.get(b.kind);
            const inPorts = NA.model.inputPortIds(b, g);
            const variadic = k.inputs === 'variadic';
            const inShapes = [];
            let missing = false, waitingOn = null;   // a wired-but-broken upstream is not an "unconnected input"
            inPorts.forEach((pid, i) => {
                const srcs = k.fanIn ? incomingAll(g, b.id, pid) : [incomingOn(g, b.id, pid)].filter(Boolean);
                if (!srcs.length) { if (variadic && i === inPorts.length - 1) return; missing = true; inShapes.push(null); return; }
                for (const src of srcs) { const s = portShape(map.get(src.from.block), src.from.port); inShapes.push(s); if (!s) { missing = true; const up = map.get(src.from.block); if (up && up._error && !waitingOn) waitingOn = up.title; } }
            });
            b._inShapes = inShapes; b._error = null; b._shape = null; b._outShapes = null; b._level = null;
            try {
                if (b.kind === 'module_in') b._shape = (bound && bound[b.id]) || NA.util.parseShape(b.params.shape);
                else if (b.kind === 'module') {
                    const def = NA.model.get().modules[b.params.def]; if (!def) throw new Error('Missing module definition');
                    if (missing) throw Object.assign(new Error(waitingOn ? `Waiting on ${waitingOn}` : 'Unconnected input'), { level: 'warn' });
                    b._outShapes = inferModule(def, inShapes, depth + 1); b._shape = b._outShapes[0] || null;
                } else {
                    if (missing) { throw Object.assign(new Error(waitingOn ? `Waiting on ${waitingOn}` : (inPorts.length === 1 ? 'Unconnected input' : 'Unconnected inputs')), { level: 'warn' }); }
                    // fan-in ports (other than attention-style ones) hand the kind ONE joined shape
                    b._shape = k.infer(k.fanIn && k.fanIn !== 'tokens' && inShapes.length > 1 ? [NA.catalogue.fanInJoin(k.fanIn, inShapes)] : inShapes, b);
                }
                if (b.kind !== 'module' && b.kind !== 'output' && b.kind !== 'module_out' && !outgoing(g, b.id).length && depth === 0 && b.kind !== 'input') { b._level = 'info'; }
            } catch (e) {
                b._error = e.message; b._level = e.level || 'error';
                diags.push({ block: b.id, message: e.message, level: b._level });
            }
        }
        return diags;
    }
    function inferModule(def, inShapes, depth) {
        if (depth > 8) throw new Error('Modules nest too deep (recursive?)');
        const io = NA.model.moduleIO(def.id);
        const bound = {}; io.ins.forEach((mi, i) => { bound[mi.id] = inShapes[i]; });
        const diags = inferShapes(def.graph, bound, depth);
        const err = diags.find(d => d.level === 'error');
        if (err) throw new Error(`Inside ${def.name}: ${err.message}`);
        return io.outs.map(mo => mo._shape);
    }
    let lastDiags = [];
    function refresh() {
        const st = NA.model.get(); if (!st) return [];
        // Definitions first (with their own editing shapes) so instances can be evaluated
        for (const id in st.modules) inferShapes(st.modules[id].graph, null, 1);
        const diags = inferShapes(st, null, 0);
        // If we are editing inside a module, re-run it with editing shapes so its blocks show their own state
        const cur = NA.model.currentModule();
        if (cur) lastDiags = inferShapes(cur.graph, null, 1); else lastDiags = diags;
        return lastDiags;
    }
    function diagnostics() { return lastDiags; }
    function paramCount(g = NA.model.get(), st = NA.model.get()) {
        let n = 0;
        for (const b of g.blocks) {
            const k = NA.catalogue.get(b.kind);
            if (b.kind === 'module') { const d = st.modules[b.params.def]; if (d) n += paramCount(d.graph, st); }
            else if (k.paramCount) { try { n += k.paramCount(b) || 0; } catch (_) {} }
        }
        for (const e of g.neuronEdges) n += 1;
        return n;
    }
    function inputs(g) { return g.blocks.filter(b => b.kind === 'input').sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x); }
    function outputs(g) { return g.blocks.filter(b => b.kind === 'output').sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x); }
    NA.graph = { byId, incoming, outgoing, incomingOn, incomingAll, incomingLists, reaches, topoSort, portShape, inferShapes, inferModule, refresh, diagnostics, paramCount, inputs, outputs };
})();

// ============================================================
// NA.layout — layered auto-layout (longest path + barycenter sweeps)
// ============================================================
(() => {
    function auto(g, onlyIds = null) {
        const cfg = NA.config;
        const blocks = onlyIds ? g.blocks.filter(b => onlyIds.includes(b.id)) : g.blocks;
        if (!blocks.length) return;
        const ids = new Set(blocks.map(b => b.id));
        const edges = g.edges.filter(e => ids.has(e.from.block) && ids.has(e.to.block));
        const preds = new Map(), succs = new Map();
        for (const b of blocks) { preds.set(b.id, []); succs.set(b.id, []); }
        for (const e of edges) { preds.get(e.to.block).push(e.from.block); succs.get(e.from.block).push(e.to.block); }
        // Longest-path layering with cycle protection
        const layer = new Map(); const onStack = new Set();
        const L = (id) => {
            if (layer.has(id)) return layer.get(id);
            if (onStack.has(id)) return 0;
            onStack.add(id);
            let l = 0; for (const p of preds.get(id)) l = Math.max(l, L(p) + 1);
            onStack.delete(id); layer.set(id, l); return l;
        };
        for (const b of blocks) L(b.id);
        const lanes = [];
        for (const b of blocks) { const l = layer.get(b.id); (lanes[l] = lanes[l] || []).push(b); }
        for (const lane of lanes) lane.sort((a, b) => a.pos.y - b.pos.y || a.title.localeCompare(b.title));
        const pos = new Map();
        const index = () => lanes.forEach(lane => lane.forEach((b, i) => pos.set(b.id, i)));
        index();
        const bary = (b, neigh) => { const ns = neigh.get(b.id).filter(id => pos.has(id)); return ns.length ? ns.reduce((s, id) => s + pos.get(id), 0) / ns.length : pos.get(b.id); };
        for (let sweep = 0; sweep < 4; sweep++) {
            const down = sweep % 2 === 0;
            const range = down ? lanes.keys() : [...lanes.keys()].reverse();
            for (const li of range) {
                const lane = lanes[li]; if (!lane) continue;
                const scores = new Map(lane.map(b => [b.id, bary(b, down ? preds : succs)]));
                lane.sort((a, b) => scores.get(a.id) - scores.get(b.id) || pos.get(a.id) - pos.get(b.id));
                lane.forEach((b, i) => pos.set(b.id, i));
            }
        }
        // Coordinates: lanes left→right, blocks stacked and centred per lane. A long chain would
        // become one unreadably wide row, so lanes wrap into rows of LANES_PER_ROW.
        const origin = onlyIds ? NA.model.bounds(blocks) : null;
        const ox = origin ? origin.x : 0, oy = origin ? origin.y + origin.h / 2 : 0;
        const filled = lanes.filter(Boolean);
        const per = cfg.LANES_PER_ROW || Infinity;
        // Wrap points avoid splitting a group frame across rows when a nearby boundary can
        const laneOf = new Map(); filled.forEach((lane, i) => lane.forEach(b => laneOf.set(b.id, i)));
        const groupLanes = (g.groups || []).map(gr => gr.blocks.map(id => laneOf.get(id)).filter(v => v !== undefined)).filter(a => a.length > 1);
        const splits = (k) => groupLanes.some(ls => ls.some(l => l < k) && ls.some(l => l >= k));
        const rows = []; let start = 0;
        while (start < filled.length) {
            let end = Math.min(filled.length, start + per);
            if (end < filled.length) { let k = end; while (k > start + Math.ceil(per / 2) && splits(k)) k--; if (!splits(k)) end = k; }
            rows.push(filled.slice(start, end)); start = end;
        }
        let rowTop = oy;
        for (let r = 0; r < rows.length; r++) {
            const rowLanes = rows[r];
            const laneTotals = rowLanes.map(lane => lane.reduce((a, b) => a + NA.model.rect(b, g).h, 0) + (lane.length - 1) * cfg.LANE_GAP_Y);
            const rowH = Math.max(...laneTotals);
            const cy = r === 0 ? oy : rowTop + rowH / 2;
            let x = ox;
            rowLanes.forEach((lane, li) => {
                const hs = lane.map(b => NA.model.rect(b, g).h);
                let y = cy - laneTotals[li] / 2;
                lane.forEach((b, i) => { b.pos.x = x; b.pos.y = Math.round(y / cfg.GRID) * cfg.GRID; y += hs[i] + cfg.LANE_GAP_Y; });
                x += cfg.BLOCK_W + cfg.LANE_GAP_X;
            });
            rowTop = cy + rowH / 2 + cfg.ROW_GAP_Y;
        }
    }
    NA.layout = { auto };
})();

// ============================================================
// NA.templates — starting points and built-in module definitions
// ============================================================
(() => {
    const { uid } = NA.util;
    // Tiny builder DSL: B(kind, title, opts) adds a block, L(a, b) wires a→b on the next free input
    function builder(g) {
        // Templates show wide layers (> 32 neurons) as compact grids so the canvas stays scannable; the user can toggle any block to a column
        const B = (kind, title, o = {}) => { const b = NA.model.makeBlock(kind, title, o); g.blocks.push(b); return b; };
        const nextIn = (b) => { const k = NA.catalogue.get(b.kind); if (k.inputs === 'variadic') return 'in:' + g.edges.filter(e => e.to.block === b.id).length; return 'in'; };
        const L = (a, b, fromPort = 'out', toPort, act = null) => { const e = NA.model.makeEdge(a, b, fromPort, toPort || nextIn(b), act); g.edges.push(e); return e; };
        // chain(a, 'relu', b, c): a string between two blocks is the activation on that wire
        const chain = (...items) => { let prev = null, act = null; for (const it of items) { if (typeof it === 'string') { act = it; continue; } if (prev) L(prev, it, 'out', undefined, act); prev = it; act = null; } return prev; };
        const N = (a, i, b, j, init = null) => g.neuronEdges.push({ id: uid('n'), from: { block: a.id, idx: i }, to: { block: b.id, idx: j }, init, comment: '' });
        const G = (name, blocks, color = null) => g.groups.push({ id: uid('g'), name, blocks: blocks.map(b => b.id), color, comment: '' });
        return { B, L, chain, N, G };
    }
    function project(name, fn, opts = {}) {
        const p = NA.model.blank(name);
        p.meta.description = opts.description || '';
        fn(builder(p), p);
        return p;
    }

    // ---------- built-in modules ----------
    function moduleDef(id, name, comment, fn) {
        const def = { id, name, comment, builtin: true, graph: { blocks: [], edges: [], neuronEdges: [], groups: [] } };
        fn(builder(def.graph), def.graph);
        return def;
    }
    const modules = [
        moduleDef('m_resmlp', 'Residual MLP block', 'x + W2·relu(W1·x): a two-layer MLP with a skip connection.', ({ B, L, chain }) => {
            const i = B('module_in', 'x', { params: { shape: [256] } });
            const l1 = B('linear', 'Expand', { size: 256 }); const l2 = B('linear', 'Project', { size: 256 });
            const add = B('add', 'Residual'); const o = B('module_out', 'out');
            chain(i, l1, 'relu', l2, add); L(i, add); L(add, o);
        }),
        moduleDef('m_convbnrelu', 'Conv · BN · ReLU', 'The standard convolution unit.', ({ B, chain }) => {
            const i = B('module_in', 'image', { params: { shape: [3, 32, 32] } });
            chain(i, B('conv2d', 'Conv 3×3', { size: 32 }), B('batchnorm', 'BatchNorm'), 'relu', B('module_out', 'features'));
        }),
        moduleDef('m_transformer_block', 'Transformer block', 'Pre-norm attention + MLP with two residual paths.', ({ B, L, chain }) => {
            const i = B('module_in', 'tokens', { params: { shape: [32, 256] } });
            const ln1 = B('layernorm', 'LN 1'); const at = B('attention', 'Self-attention', { size: 256, params: { heads: 8 } }); const add1 = B('add', 'Residual 1');
            const ln2 = B('layernorm', 'LN 2'); const up = B('linear', 'MLP up', { size: 1024 }); const down = B('linear', 'MLP down', { size: 256 }); const add2 = B('add', 'Residual 2');
            const o = B('module_out', 'tokens');
            chain(i, ln1, at, add1); L(i, add1); chain(add1, ln2, up, 'gelu', down, add2); L(add1, add2); L(add2, o);
        }),
        moduleDef('m_se', 'Squeeze-excite', 'Channel attention: global pool → bottleneck MLP → sigmoid gate.', ({ B, L, chain }) => {
            const i = B('module_in', 'features', { params: { shape: [64, 8, 8] } });
            const pool = B('pool', 'Squeeze', { params: { mode: 'global_avg' } }); const d = B('linear', 'Reduce', { size: 4 }); const u = B('linear', 'Expand', { size: 64 });
            const scale = B('custom', 'Scale', { params: { init: '', forward: '{x0} * {x1}[:, :, None, None]', shape: [] } });
            const o = B('module_out', 'features');
            chain(i, pool, d, 'relu', u); L(i, scale); L(u, scale, 'out', undefined, 'sigmoid'); L(scale, o);
        }),
    ];
    // Infer before laying out: block heights depend on the shapes flowing through them
    for (const m of modules) { NA.graph.inferShapes(m.graph, null, 1); NA.layout.auto(m.graph); }

    // ---------- templates ----------
    const list = [
        { id: 'blank', name: 'Blank canvas', icon: 'file', desc: 'Start from nothing.', build: () => project('Untitled model', () => {}) },
        { id: 'robot_policy', name: 'Robot control policy', icon: 'bot', desc: 'One observation vector split into physical constraints, a language objective embedding and sensors; encoders, a residual trunk and a tanh action head, plus two hand-drawn neuron edges.',
          build: () => project('Robot control policy', ({ B, L, chain, N, G }) => {
              const obs = B('input', 'Observation', { params: { shape: [201] }, ui: { layout: 'grid' }, comment: 'Everything the robot knows at one tick, as one vector.',
                  regions: [
                      { name: 'Physical constraints', start: 0, end: 11, color: '#f97316', comment: 'global GPS xyz, gravity vector, temperature, battery, payload' },
                      { name: 'Objective', start: 11, end: 111, color: '#a855f7', comment: 'Qwen-8B embedding of the natural-language task, projected to 100 dims' },
                      { name: 'Sensors', start: 111, end: 201, color: '#22c55e', comment: 'joint angles, IMU, contact switches, range finders' },
                  ],
                  neurons: { 0: { label: 'gps x' }, 1: { label: 'gps y' }, 2: { label: 'gps z' }, 3: { label: 'gravity x' }, 4: { label: 'gravity y' }, 5: { label: 'gravity z' }, 6: { label: 'temperature' }, 7: { label: 'battery' } } });
              const phys = B('linear', 'Physics encoder', { size: 32, comment: 'Small encoder for the constraint channel so it is not drowned by the embedding.' });
              const obj = B('linear', 'Objective encoder', { size: 64 });
              const sen = B('linear', 'Sensor encoder', { size: 128 });
              const cat = B('concat', 'Fuse');
              const t1 = B('linear', 'Trunk 1', { size: 256 });
              const t2 = B('linear', 'Trunk 2', { size: 256 });
              const res = B('add', 'Residual');
              const head = B('linear', 'Action head', { size: 12, neurons: { 0: { label: 'base vx' }, 1: { label: 'base vy' }, 2: { label: 'base yaw' }, 3: { label: 'arm j1' }, 4: { label: 'arm j2' }, 5: { label: 'arm j3' }, 6: { label: 'arm j4' }, 7: { label: 'arm j5' }, 8: { label: 'arm j6' }, 9: { label: 'gripper' }, 10: { label: 'head pan' }, 11: { label: 'head tilt' } } });
              const out = B('output', 'Action', { comment: '12 continuous joint / base commands in [-1, 1].' });
              const [rPhys, rObj, rSen] = obs.regions;
              L(obs, phys, 'out:' + rPhys.id); L(obs, obj, 'out:' + rObj.id); L(obs, sen, 'out:' + rSen.id);
              chain(phys, 'relu', cat); chain(obj, 'relu', cat); chain(sen, 'relu', cat);
              chain(cat, t1, 'relu', t2, 'relu', res); L(t1, res, 'out', undefined, 'relu');
              chain(res, head, 'tanh', out);
              N(obs, 5, head, 2, 0.5); N(obs, 7, head, 9, null);
              G('Encoders', [phys, obj, sen], '#3b82f6');
              G('Residual trunk', [t1, t2, res], '#6366f1');
          }, { description: 'Control foundation model for a mobile manipulator.' }) },
        { id: 'mlp', name: 'MLP classifier', icon: 'layers', desc: 'A plain three-layer perceptron with dropout — the hello world.',
          build: () => project('MLP classifier', ({ B, chain }) => {
              chain(B('input', 'Pixels', { params: { shape: [784] } }), B('linear', 'Hidden 1', { size: 256, dropout: 0.2 }), 'relu',
                    B('linear', 'Hidden 2', { size: 128 }), 'relu', B('linear', 'Logits', { size: 10 }), B('output', 'Class logits'));
          }) },
        { id: 'cnn', name: 'CNN classifier', icon: 'scan', desc: 'Two conv-bn-relu-pool stages, flatten, MLP head.',
          build: () => project('CNN classifier', ({ B, chain, G }) => {
              const i = B('input', 'Image', { params: { shape: [3, 32, 32] } });
              const c1 = B('conv2d', 'Conv 1', { size: 32 }), b1 = B('batchnorm', 'BN 1'), p1 = B('pool', 'Pool 1');
              const c2 = B('conv2d', 'Conv 2', { size: 64 }), b2 = B('batchnorm', 'BN 2'), p2 = B('pool', 'Pool 2');
              const f = B('flatten', 'Flatten'), l1 = B('linear', 'Dense', { size: 256, dropout: 0.5 }), l2 = B('linear', 'Logits', { size: 10 }), o = B('output', 'Class logits');
              chain(i, c1, b1, 'relu', p1, c2, b2, 'relu', p2, f, l1, 'relu', l2, o);
              G('Stage 1', [c1, b1, p1], '#8b5cf6'); G('Stage 2', [c2, b2, p2], '#8b5cf6'); G('Head', [f, l1, l2], '#3b82f6');
          }) },
        { id: 'transformer', name: 'Transformer LM', icon: 'sparkles', desc: 'Token embedding → 4 encoder layers → LayerNorm → vocabulary logits.',
          build: () => project('Transformer language model', ({ B, chain }) => {
              chain(B('input', 'Token ids', { params: { shape: [64], dtype: 'int64' } }), B('embedding', 'Token embedding', { size: 256, params: { vocab: 32000 } }),
                    B('transformer', 'Encoder stack', { size: 256, params: { heads: 8, ff: 1024, layers: 4, dropout: 0.1, norm_first: true } }),
                    B('layernorm', 'Final norm'), B('linear', 'LM head', { size: 32000 }), B('output', 'Next-token logits'));
          }) },
        { id: 'autoencoder', name: 'Autoencoder', icon: 'git-compare-arrows', desc: 'Encoder down to a 32-d latent code and a mirrored decoder.',
          build: () => project('Autoencoder', ({ B, chain, G }) => {
              const i = B('input', 'Pixels', { params: { shape: [784] } });
              const e1 = B('linear', 'Encode 1', { size: 256 }), e2 = B('linear', 'Latent', { size: 32, regions: [{ name: 'Latent code', start: 0, end: 32, color: '#a855f7', comment: 'The bottleneck.' }] });
              const d1 = B('linear', 'Decode 1', { size: 256 }), d2 = B('linear', 'Reconstruct', { size: 784 }), o = B('output', 'Reconstruction');
              chain(i, e1, 'relu', e2, d1, 'relu', d2, 'sigmoid', o);
              G('Encoder', [e1, e2], '#22c55e'); G('Decoder', [d1, d2], '#f43f5e');
          }) },
        { id: 'gnn_hybrid', name: 'Graph-hybrid net', icon: 'waypoints', desc: 'A feed-forward net with hand-drawn neuron-level ring connections — message passing between neighbouring nodes.',
          build: () => project('Graph-hybrid network', ({ B, chain, N }) => {
              const i = B('input', 'Node features', { params: { shape: [16] }, regions: [{ name: 'Ring of 16 nodes', start: 0, end: 16, color: '#14b8a6' }] });
              const s = B('linear', 'Node state', { size: 16 });
              const a = B('linear', 'Aggregate', { size: 16, comment: 'Dense self-update; the drawn edges add each node\'s two ring neighbours (pre-activation).' });
              const r = B('linear', 'Readout', { size: 4 }), o = B('output', 'Graph embedding');
              chain(i, s, 'relu', a, 'relu', r, o);
              for (let k = 0; k < 16; k++) { N(s, k, a, (k + 1) % 16, 0.5); N(s, k, a, (k + 15) % 16, 0.5); }
          }) },
    ];
    function get(id) { return list.find(t => t.id === id) || null; }
    function build(id) {
        const t = get(id) || list[0];
        const p = t.build();
        NA.graph.inferShapes(p, null, 0);
        NA.layout.auto(p);
        return NA.model.strip(p);
    }
    NA.templates = { list, get, build, modules, builder, project };
})();
