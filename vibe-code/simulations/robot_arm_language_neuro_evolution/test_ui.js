/* test_ui.js — boots the page's scripts against a stub DOM. Run: node test_ui.js
 *
 * The failure this exists to catch is the one that costs an afternoon: ui.js or
 * main.js asking for an element id that index.html does not have. In a browser
 * that is a null dereference somewhere inside a render loop, thousands of
 * frames after the mistake; here it throws immediately, by name.
 *
 * The REAL three.min.js is loaded, so all the vector and quaternion maths in
 * render.js runs for real and a bad link transform throws here. Only
 * WebGLRenderer is replaced — it is the one part that genuinely needs a GPU.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const IDS = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const SCRIPTS = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

/* Attributes are lifted straight out of index.html, `value` especially. The
 * sliders seed CFG from their DOM value on the very first bindSlider() call, so
 * a stub that defaults them to "" hands the whole config a set of NaNs —
 * population NaN builds an empty fleet, episodes NaN draws zero instructions —
 * and the resulting crashes look like sim bugs rather than harness bugs. */
const ID_TAG = new Map(), ID_CLASS = new Map(), ID_VALUE = new Map(), ID_CHECKED = new Set();
for (const tag of html.match(/<[a-zA-Z][^>]*>/g) || []) {
    const id = /\bid="([^"]+)"/.exec(tag);
    if (!id) continue;
    ID_TAG.set(id[1], /^<([a-zA-Z]+)/.exec(tag)[1]);
    const cls = /\bclass="([^"]+)"/.exec(tag);
    ID_CLASS.set(id[1], cls ? cls[1] : "");
    const val = /\bvalue="([^"]*)"/.exec(tag);
    if (val) ID_VALUE.set(id[1], val[1]);
    if (/\bchecked\b/.test(tag)) ID_CHECKED.add(id[1]);
}

let failures = 0;
function check(name, ok, extra) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}

/* -------------------------------------------------------------- stub DOM */
function boot(search) {
    const els = new Map();
    const missing = [];
    const frames = [];
    const domListeners = new Map();

    function classListFor(el) {
        return {
            add: c => { el.className = (el.className + " " + c).trim(); },
            remove: c => { el.className = el.className.split(/\s+/).filter(x => x && x !== c).join(" "); },
            toggle: (c, on) => {
                const has = el.className.split(/\s+/).includes(c);
                const want = on === undefined ? !has : !!on;
                if (want && !has) el.classList.add(c);
                if (!want && has) el.classList.remove(c);
            },
            contains: c => el.className.split(/\s+/).includes(c)
        };
    }

    function makeEl(id, tag) {
        const el = {
            id: id || "", tagName: (tag || "div").toUpperCase(),
            textContent: "", innerHTML: "", className: ID_CLASS.get(id) || "",
            value: ID_VALUE.has(id) ? ID_VALUE.get(id) : "",
            checked: ID_CHECKED.has(id), disabled: false, title: "",
            style: {}, dataset: {}, children: [], parentNode: null,
            width: 300, height: 100, clientWidth: 620, clientHeight: 420,
            appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
            insertBefore(c, before) { this.children.unshift(c); c.parentNode = this; return c; },
            removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
            querySelector(sel) {
                // only used for `.querySelector("small")` on the intro buttons
                let found = this.children.find(c => c.tagName === sel.toUpperCase());
                if (!found) { found = makeEl("", sel); this.appendChild(found); }
                return found;
            },
            querySelectorAll() { return []; },
            addEventListener(ev, fn) { (domListeners.get(this.id) || domListeners.set(this.id, {}).get(this.id))[ev] = fn; },
            removeEventListener() {},
            setPointerCapture() {},
            getContext() {
                return new Proxy({}, {
                    get: (t, k) => (k in t ? t[k] : () => {}),
                    set: (t, k, v) => { t[k] = v; return true; }
                });
            },
            getBoundingClientRect() { return { left: 0, top: 0, width: 620, height: 420 }; },
            click() { if (this.onclick) this.onclick({ target: this }); },
            focus() {}
        };
        el.classList = classListFor(el);
        domListeners.set(el.id, {});
        return el;
    }

    const document = {
        title: "",
        readyState: "loading",
        body: makeEl("body", "body"),
        documentElement: makeEl("html", "html"),
        getElementById(id) {
            if (!IDS.has(id)) { missing.push(id); return null; }
            if (!els.has(id)) els.set(id, makeEl(id, ID_TAG.get(id)));
            return els.get(id);
        },
        createElement(tag) { return makeEl("", tag); },
        querySelectorAll(sel) {
            // ui.js uses this once, for the split radio group
            if (sel.includes("split")) {
                return ["train", "holdout"].map(v => {
                    const e = makeEl("radio-" + v, "input");
                    e.value = v; e.checked = v === "train";
                    return e;
                });
            }
            return [];
        },
        addEventListener(ev, fn) { if (ev === "DOMContentLoaded") document._ready = fn; }
    };

    const window = {
        devicePixelRatio: 1,
        addEventListener() {},
        requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
        performance: { now: () => Date.now() },
        fetch: () => Promise.reject(new Error("no network in the test harness")),
        Blob: class { constructor() {} },
        URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} }
    };

    const location = { search: search || "", href: "file:///index.html" };
    const ctx = vm.createContext(Object.assign(Object.create(null), {
        document, window, console, location, URLSearchParams,
        requestAnimationFrame: window.requestAnimationFrame,
        performance: window.performance,
        fetch: window.fetch, Blob: window.Blob, URL: window.URL,
        setTimeout, clearTimeout, Math, JSON, Date,
        Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array,
        Int8Array, Int16Array, Int32Array, ArrayBuffer, DataView,
        Object, Array, String, Number, Boolean, Set, Map, Symbol, Error,
        TypeError, RangeError, Promise, isNaN, isFinite, parseInt, parseFloat,
        Infinity, NaN, undefined
    }));
    ctx.globalThis = ctx;
    ctx.self = ctx;
    ctx.window.document = document;

    for (const f of SCRIPTS) {
        const p = path.join(__dirname, f);
        if (!fs.existsSync(p)) throw new Error(`index.html loads ${f}, which does not exist`);
        vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: f });
        if (f === "three.min.js") {
            // The one thing that genuinely needs a GPU.
            ctx.THREE.WebGLRenderer = class {
                constructor() { this.domElement = document.createElement("canvas"); }
                setPixelRatio() {} setSize() {} render() {}
            };
        }
    }
    return { ctx, document, missing, frames, els };
}

/* ------------------------------------------------------------------ run */
let B;
try {
    B = boot();
    check("every script in index.html loads without throwing", true);
} catch (e) {
    check("every script in index.html loads without throwing", false, e.message);
    console.error(e.stack);
    process.exit(1);
}
const { ctx, document, missing, frames } = B;

/* Top-level `const` in a <script> lands in the context's global LEXICAL scope,
 * not on the context object — exactly as it does in a browser, which is why the
 * sim files can see each other's declarations without any exports. It also means
 * `ctx.CFG` is undefined; reaching those names takes an expression evaluated
 * inside the context. */
const G = (expr) => vm.runInContext(expr, ctx);

check("index.html and the sim agree on the embedding width",
    G("Embedding.dim") === G("typeof EMB_DIM !== 'undefined' ? EMB_DIM : Embedding.dim"),
    `Embedding.dim=${G("Embedding.dim")}, mode=${G("Embedding.mode")}`);

// --- boot the page ---------------------------------------------------------
try {
    document._ready();
    check("DOMContentLoaded handler runs", true);
} catch (e) {
    check("DOMContentLoaded handler runs", false, e.message);
    console.error(e.stack);
}
check("no missing element ids", missing.length === 0, missing.length ? [...new Set(missing)].join(", ") : "");

// --- drive the intro into "evolve from scratch" ----------------------------
try {
    document.getElementById("intro-scratch").click();
    check("intro → evolve from scratch", true);
} catch (e) {
    check("intro → evolve from scratch", false, e.message);
    console.error(e.stack);
}
check("the intro modal actually hides", document.getElementById("intro").className.includes("hidden"));
check("an instruction is on screen",
    (document.getElementById("instruction").textContent || "").length > 8,
    document.getElementById("instruction").textContent);

// --- run frames ------------------------------------------------------------
G("CFG.speed = 16");
let ran = 0;
try {
    for (let i = 0; i < 260 && frames.length; i++) {
        const fn = frames.shift();
        fn(i * 16.7);
        ran++;
    }
    check(`${ran} animation frames ran clean`, ran > 200);
} catch (e) {
    check("animation frames run clean", false, `frame ${ran}: ${e.message}`);
    console.error(e.stack);
}

// --- exercise the controls -------------------------------------------------
function poke(name, fn) {
    try { fn(); check(name, true); }
    catch (e) { check(name, false, e.message); console.error(e.stack); }
}
poke("pause / resume", () => {
    document.getElementById("btn-pause").click();
    document.getElementById("btn-pause").click();
});
poke("dark theme toggle", () => document.getElementById("btn-theme").click());
poke("solo view toggle", () => document.getElementById("btn-solo").click());
poke("goal-type filter repopulates the sentence list", () => {
    const k = document.getElementById("sel-kind");
    k.value = "ALTERNATE";
    k.onchange();
    if (document.getElementById("sel-phrase").children.length < 5)
        throw new Error("phrase list did not fill");
});
poke("pinning a sentence changes the instruction", () => {
    const sel = document.getElementById("sel-phrase");
    const opt = sel.children[3];
    sel.onchange({ target: { value: opt.value } });
    if (G("CFG.pinnedTaskId") !== opt.value) throw new Error("pin not applied");
});
poke("sliders apply to CFG", () => {
    const s = document.getElementById("sl-mut");
    s.value = "35"; s.oninput();
    if (Math.abs(G("CFG.mutRate") - 0.35) > 1e-9) throw new Error("mutRate = " + G("CFG.mutRate"));
});
poke("speed buttons switch", () => {
    const g = document.getElementById("speed-group");
    g.children[g.children.length - 1].onclick();
    if (G("CFG.speed") !== 0) throw new Error("speed = " + G("CFG.speed"));
});
poke("scripted reference mode restarts cleanly", () => {
    document.getElementById("btn-reference").click();
    for (let i = 0; i < 40 && frames.length; i++) frames.shift()(i * 16.7);
});
poke("restart from the panel", () => {
    document.getElementById("btn-restart").click();
    for (let i = 0; i < 40 && frames.length; i++) frames.shift()(i * 16.7);
});

// --- run long enough to finish a generation --------------------------------
G("CFG.speed = 0; CFG.popSize = 8; CFG.episodes = 1");
try {
    document.getElementById("btn-restart").click();
    let guard = 0;
    while (guard++ < 4000 && frames.length && +document.getElementById("stat-gen").textContent < 2)
        frames.shift()(guard * 16.7);
    const genText = document.getElementById("stat-gen").textContent;
    check("a generation completes and the counter moves", +genText >= 2, "stat-gen = " + genText);
} catch (e) {
    check("a generation completes and the counter moves", false, e.message);
    console.error(e.stack);
}

poke("export champion produces a blob", () => document.getElementById("btn-export").click());

/* The ?bench= path is what the thumbnail screenshot uses, and it is easy to
 * break without noticing because nothing in the normal UI exercises it. */
try {
    const B2 = boot("?bench=300&pop=6&ref=1");
    B2.document._ready();
    const title = B2.document.title || "";
    const stepped = vm.runInContext("world && world.t > 1", B2.ctx);
    check("?bench= steps the sim synchronously at load", stepped === true,
        "world.t = " + vm.runInContext("world ? world.t.toFixed(2) : 'no world'", B2.ctx));
    check("?bench= leaves the sim paused on a drawn frame",
        vm.runInContext("CFG.paused", B2.ctx) === true);
    check("?bench= reports to document.title", /bench 300 steps/.test(title), title);
} catch (e) {
    check("?bench= warm-up path", false, e.message);
    console.error(e.stack);
}

console.log(`\n${failures ? failures + " FAILED" : "all UI checks passed"}`);
process.exit(failures ? 1 : 0);
