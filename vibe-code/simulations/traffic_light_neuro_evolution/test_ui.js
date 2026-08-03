// Boots the actual page against a stub DOM and drives real frames, so a
// missing element id, a null dereference in the panel code or a broken chart
// shows up here rather than as a blank canvas in the browser.
//
//   node test_ui.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PAGE_IDS = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const SCRIPTS = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

let fail = 0, pass = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
};

// --- stub DOM ---------------------------------------------------------------
const ctx2d = new Proxy({}, {
    get(t, k) {
        if (k === 'canvas') return { width: 300, height: 120 };
        if (k === 'setLineDash' || k === 'measureText') return () => ({ width: 10 });
        return typeof k === 'string' ? (() => {}) : undefined;
    },
    set() { return true; }
});

const missingIds = new Set();
function makeEl(id, tag) {
    const el = {
        id, tagName: (tag || 'div').toUpperCase(),
        value: '', textContent: '', innerHTML: '', checked: false,
        width: 600, height: 400,
        style: {},
        dataset: {},
        selectedOptions: [{ textContent: 'stub' }],
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
            toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
            contains(c) { return this._s.has(c); }
        },
        _handlers: {},
        addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
        removeEventListener() {},
        fire(t, e) { for (const fn of this._handlers[t] || []) fn(e || { preventDefault() {}, target: this, clientX: 10, clientY: 10, pointerId: 1, deltaY: -1 }); },
        getContext: () => ctx2d,
        getBoundingClientRect: () => ({ width: 600, height: 400, left: 0, top: 0 }),
        setPointerCapture() {},
        click() { this.fire('click'); },
        appendChild() {}, querySelectorAll: () => []
    };
    return el;
}

// Seed the stubs from the page's own markup, so the harness exercises the same
// initial slider and select values a browser would.
const INITIAL = new Map();
for (const m of html.matchAll(/<(input|select|textarea)[^>]*>/g)) {
    const tag = m[0];
    const id = (tag.match(/id="([^"]+)"/) || [])[1];
    if (!id) continue;
    const v = (tag.match(/value="([^"]*)"/) || [])[1];
    INITIAL.set(id, { value: v === undefined ? '' : v, checked: /checked/.test(tag) });
}
// A <select> filled in by JS: take the first <option value="..."> that follows.
for (const m of html.matchAll(/<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const sel = (m[2].match(/<option value="([^"]*)"[^>]*selected/) || m[2].match(/<option value="([^"]*)"/) || [])[1];
    if (sel !== undefined) INITIAL.set(m[1], { value: sel, checked: false });
}

const els = new Map();
const document = {
    readyState: 'complete',
    getElementById(id) {
        if (!PAGE_IDS.has(id)) missingIds.add(id);
        if (!els.has(id)) {
            const e = makeEl(id);
            const init = INITIAL.get(id);
            if (init) { e.value = init.value; e.checked = init.checked; }
            els.set(id, e);
        }
        return els.get(id);
    },
    querySelectorAll(sel) {
        if (sel === '.mode-tab') {
            if (!els.has('__tabs')) {
                const t = ['train', 'watch'].map(m => { const e = makeEl('tab-' + m); e.dataset.mode = m; return e; });
                els.set('__tabs', t);
            }
            return els.get('__tabs');
        }
        return [];
    },
    createElement: tag => makeEl('created', tag),
    addEventListener() {}
};

const frames = [];
const sandbox = {
    console, Math, JSON, Date, Set, Map, Object, Array, Number, String, Boolean, Error,
    Float64Array, Float32Array, Int32Array, Int16Array, Uint8Array, isNaN, isFinite, parseFloat, parseInt,
    document,
    window: { devicePixelRatio: 1, addEventListener() {} },
    performance: { now: () => Date.now() },
    localStorage: {
        _d: {},
        getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
        setItem(k, v) { this._d[k] = String(v); },
        removeItem(k) { delete this._d[k]; }
    },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; }
};
sandbox.globalThis = sandbox;
sandbox.window.document = document;

let src = '';
for (const f of SCRIPTS) src += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n;\n';
src += '\nglobalThis.__S = S; globalThis.__Evolution = Evolution;'
    + '\nglobalThis.__parts = { step: stepTraining, draw: drawCurrent, panel: updatePanel };';

console.log(`\nPage boot (${SCRIPTS.length} scripts, ${PAGE_IDS.size} element ids)`);
vm.createContext(sandbox);
let booted = true;
try {
    vm.runInContext(src, sandbox, { filename: 'page-bundle.js' });
} catch (e) {
    booted = false;
    console.log('  boot threw: ' + e.stack.split('\n').slice(0, 4).join('\n'));
}
ok('the page boots', booted);
ok('every getElementById hits a real element', missingIds.size === 0, [...missingIds].join(', '));
ok('an Evolution run was created', !!(sandbox.__S && sandbox.__S.ev));
ok('a renderer was created', !!(sandbox.__S && sandbox.__S.ren));

// --- drive frames -----------------------------------------------------------
console.log('\nRunning frames');
let frameErr = null;
let ran = 0;
try {
    for (let i = 0; i < 90 && frames.length; i++) {
        const fn = frames.shift();
        fn(1000 + i * 16);
        ran++;
    }
} catch (e) { frameErr = e; }
ok('frames run without throwing', !frameErr, frameErr && frameErr.stack.split('\n').slice(0, 3).join(' | '));
ok('the loop kept scheduling itself', ran > 80, `ran=${ran}`);
ok('simulated time advanced', sandbox.__S.ev.world.t > 0, `t=${sandbox.__S.ev.world.t}`);

// --- controls ---------------------------------------------------------------
console.log('\nControls');
const el = id => els.get(id);
const tryIt = (name, fn) => { try { fn(); ok(name, true); } catch (e) { ok(name, false, e.message); } };

tryIt('pause button', () => el('btn-pause').fire('click'));
tryIt('resume button', () => el('btn-pause').fire('click'));
tryIt('headless toggle', () => { el('chk-headless').checked = true; el('chk-headless').fire('change'); });
tryIt('detector toggle', () => { el('chk-det').checked = true; el('chk-det').fire('change'); });
tryIt('tier select', () => { el('sel-tier').value = '2'; el('sel-tier').fire('change'); });
tryIt('sliders', () => {
    for (const id of ['sl-budget', 'sl-pop', 'sl-eplen', 'sl-demand', 'sl-sigma', 'sl-K']) {
        el(id).value = '30'; el(id).fire('input');
    }
});
tryIt('canvas click selects a junction', () => el('city').fire('click'));
tryIt('canvas zoom', () => el('city').fire('wheel'));
tryIt('switch to the watch tab', () => {
    const tabs = els.get('__tabs');
    tabs[1].fire('click');
});
ok('watch mode hides the training panel', el('panel').classList.contains('hidden'));
ok('watch mode shows the playback controls', !el('watch-controls').classList.contains('hidden'));
ok('watch mode stops advertising the junction inspector',
    !/inspect/.test(el('map-hint').textContent), el('map-hint').textContent);
tryIt('watch frames run', () => {
    for (let i = 0; i < 40 && frames.length; i++) frames.shift()(3000 + i * 16);
});
tryIt('new watch run', () => el('btn-watch-run').fire('click'));
tryIt('speed slider sweeps', () => {
    for (const v of ['0', '4', '8', '5']) { el('sl-pace').value = v; el('sl-pace').fire('input'); }
});
tryIt('slow-motion button', () => el('btn-watch-slow').fire('click'));
tryIt('step button while paused', () => el('btn-watch-step').fire('click'));

// The point of the speed control: the slowest stop must actually run the world
// slower than the frames arrive. The old fixed-step loop could not - it took at
// least one 0.1s step per frame whatever the pace factor said, so "real time"
// was really six times real time.
const runFrames = (base, n) => {
    const t0 = sandbox.__S.watch.a.t;
    for (let i = 0; i < n && frames.length; i++) frames.shift()(base + i * 16);
    return sandbox.__S.watch.a.t - t0;
};
sandbox.__S.paused = false;
el('sl-pace').value = '0'; el('sl-pace').fire('input');
const slowAdv = runFrames(20000, 30);
el('sl-pace').value = '8'; el('sl-pace').fire('input');
const fastAdv = runFrames(30000, 30);
ok('the slowest speed runs below real time', slowAdv < 0.5,
    `${slowAdv.toFixed(3)}s of world across ~0.6s of frames`);
ok('the fastest speed is far quicker than the slowest', fastAdv > slowAdv * 8 + 1,
    `slow=${slowAdv.toFixed(3)}s fast=${fastAdv.toFixed(2)}s`);
ok('leftover time is carried, not thrown away', sandbox.__S.watch.acc >= 0 && sandbox.__S.watch.acc < 0.6001,
    `acc=${sandbox.__S.watch.acc}`);
tryIt('back to training', () => els.get('__tabs')[0].fire('click'));
ok('the training panel comes back', !el('panel').classList.contains('hidden'));
ok('the playback controls go away again', el('watch-controls').classList.contains('hidden'));
tryIt('save to browser', () => el('btn-save').fire('click'));
tryIt('load from browser', () => el('btn-load').fire('click'));
tryIt('reset the run', () => el('btn-reset').fire('click'));
tryIt('frames still run after a reset', () => {
    for (let i = 0; i < 40 && frames.length; i++) frames.shift()(9000 + i * 16);
});

ok('a save round-tripped through localStorage', !!sandbox.localStorage._d[Object.keys(sandbox.localStorage._d)[0]]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
