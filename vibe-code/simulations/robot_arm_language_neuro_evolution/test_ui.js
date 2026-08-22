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
        /* A LIST, not a slot. index.html loads shared_assets/mobile.js after
         * main.js and both register a DOMContentLoaded handler; storing one
         * overwrote `boot` with the mobile layer's listener, so the page under
         * test never actually booted. Every assertion downstream then failed
         * for the same invisible reason — eleven of them, blamed on the mobile
         * layer for a while. Fire them all, in registration order. */
        addEventListener(ev, fn) {
            if (ev !== "DOMContentLoaded") return;
            document._readyFns = document._readyFns || [];
            document._readyFns.push(fn);
        },
        _ready() { for (const fn of (document._readyFns || [])) fn(); }
    };

    const window = {
        devicePixelRatio: 1,
        addEventListener() {},
        // shared_assets/mobile.js asks the platform whether this is a phone.
        // Answering "no" is what keeps this suite testing the desktop layout.
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
        innerWidth: 1440, innerHeight: 900,
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
            /* Everything the renderer actually calls has to exist here, or the
             * suite reports a missing stub as an app bug. The scissor/viewport
             * family is what the wrist-camera insets use. */
            ctx.THREE.WebGLRenderer = class {
                constructor() { this.domElement = document.createElement("canvas"); this.autoClear = true; }
                setPixelRatio() {} setSize() {} render() {}
                setViewport() {} setScissor() {} setScissorTest() {}
                setClearColor() {} clear() {}
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

// --- drive the intro -------------------------------------------------------
try {
    document.getElementById("intro-watch").click();
    check("intro → watch it work", true);
} catch (e) {
    check("intro → watch it work", false, e.message);
    console.error(e.stack);
}
check("the intro modal actually hides", document.getElementById("intro").className.includes("hidden"));
check("an instruction is on screen",
    (document.getElementById("instruction").textContent || "").length > 8,
    document.getElementById("instruction").textContent);
check("exactly one bench is simulated",
    G("world.stations.length") === 1, G("world.stations.length") + " stations");
/* The shipped bench should be CROWDED — that is the whole point of the fill
 * knob. Asserting on a single deal would be flaky, because the page seeds from
 * Math.random() and one draw of a thin recipe can legitimately come out small.
 * The claim worth testing is the average. */
(() => {
    let total = 0, n = 12, min = 99;
    for (let i = 0; i < n; i++) {
        document.getElementById("btn-scene").click();
        const k = G("world.stations[0].balls.length");
        total += k; if (k < min) min = k;
    }
    check("a dealt bench is crowded", total / n >= 6 && min >= 3,
        `mean ${(total / n).toFixed(1)} balls over ${n} deals, smallest ${min}`);
})();

// --- run frames ------------------------------------------------------------
G("CFG.speed = 16");
let ran = 0;
try {
    for (let i = 0; i < 260 && frames.length; i++) {
        const fn = frames.shift();
        fn(i * 16.7);
        ran++;
    }
    check(ran + " animation frames ran clean", ran > 200);
} catch (e) {
    check("animation frames run clean", false, "frame " + ran + ": " + e.message);
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
poke("arm-eyes toggle", () => {
    document.getElementById("btn-eyes").click();
    if (G("CFG.showEyes") !== true) throw new Error("showEyes not set");
    for (let i = 0; i < 10 && frames.length; i++) frames.shift()(i * 16.7);
    document.getElementById("btn-eyes").click();
});
poke("goal-type filter repopulates the sentence list", () => {
    const k = document.getElementById("sel-kind");
    k.value = "ALTERNATE";
    k.onchange();
    if (document.getElementById("sel-phrase").children.length < 5)
        throw new Error("phrase list did not fill");
});
poke("picking a sentence changes the instruction", () => {
    const sel = document.getElementById("sel-phrase");
    const opt = sel.children[3];
    const before = document.getElementById("instruction").textContent;
    sel.onchange({ target: { value: opt.value } });
    if (G("CFG.pinnedTaskId") !== opt.value) throw new Error("pin not applied");
    if (document.getElementById("instruction").textContent === before)
        throw new Error("instruction did not re-render");
});
/* Choosing a sentence must re-deal the SAME bench, or "does the wording change
 * what it does?" is being asked on two different tables and cannot be answered. */
poke("picking a sentence keeps the same bench", () => {
    const seedBefore = document.getElementById("stat-seed").textContent;
    const sel = document.getElementById("sel-phrase");
    sel.onchange({ target: { value: sel.children[5].value } });
    const after = document.getElementById("stat-seed").textContent;
    if (after !== seedBefore) throw new Error("seed changed from " + seedBefore + " to " + after);
});
poke("new bench draws a different seed", () => {
    const before = document.getElementById("stat-seed").textContent;
    let changed = false;
    for (let i = 0; i < 20 && !changed; i++) {
        document.getElementById("btn-scene").click();
        changed = document.getElementById("stat-seed").textContent !== before;
    }
    if (!changed) throw new Error("seed never changed across 20 deals");
});
poke("bench sliders apply to CFG", () => {
    const f = document.getElementById("sl-fill");
    f.value = "24"; f.oninput();
    if (Math.abs(G("CFG.fill") - 2.4) > 1e-9) throw new Error("fill = " + G("CFG.fill"));
    const n = document.getElementById("sl-noise");
    n.value = "50"; n.oninput();
    if (Math.abs(G("CFG.noise") - 0.5) > 1e-9) throw new Error("noise = " + G("CFG.noise"));
});
poke("speed buttons switch", () => {
    const g = document.getElementById("speed-group");
    g.children[g.children.length - 1].onclick();
    if (G("CFG.speed") !== 0) throw new Error("speed = " + G("CFG.speed"));
});
poke("scripted reference takes over cleanly", () => {
    document.getElementById("btn-reference").click();
    if (G("referenceMode") !== true) throw new Error("referenceMode not set");
    for (let i = 0; i < 60 && frames.length; i++) frames.shift()(i * 16.7);
    document.getElementById("btn-brain").click();
    if (G("referenceMode") !== false) throw new Error("did not hand back to the brain");
});
poke("replay re-runs the same bench", () => {
    const seed = document.getElementById("stat-seed").textContent;
    document.getElementById("btn-replay").click();
    if (document.getElementById("stat-seed").textContent !== seed) throw new Error("seed moved");
    if (G("world.t") > 0.001) throw new Error("clock did not reset");
});
poke("auto-deal toggle", () => document.getElementById("btn-loop").click());

/* An episode has to actually finish and, with auto-deal on, roll into the next
 * bench. This is the loop the page spends all of its time in. */
G("CFG.speed = 0");
try {
    // the poke above toggled auto-deal OFF; put it back by pressing the button
    // rather than by setting CFG, so the button's own state stays honest
    document.getElementById("btn-loop").click();
    if (G("CFG.autoDeal") !== true) throw new Error("auto-deal did not come back on");
    const seed0 = document.getElementById("stat-seed").textContent;
    let guard = 0, dealt = false;
    while (guard++ < 8000 && frames.length && !dealt) {
        frames.shift()(guard * 40);
        dealt = document.getElementById("stat-seed").textContent !== seed0;
    }
    check("an episode finishes and auto-deals the next bench", dealt,
        "seed " + seed0 + " -> " + document.getElementById("stat-seed").textContent);
} catch (e) {
    check("an episode finishes and auto-deals the next bench", false, e.message);
    console.error(e.stack);
}

/* The ?bench= path is what the thumbnail screenshot uses, and it is easy to
 * break without noticing because nothing in the normal UI exercises it. */
try {
    const B2 = boot("?bench=300&seed=1234&ref=1");
    B2.document._ready();
    const title = B2.document.title || "";
    const stepped = vm.runInContext("world && world.t > 1", B2.ctx);
    check("?bench= steps the sim synchronously at load", stepped === true,
        "world.t = " + vm.runInContext("world ? world.t.toFixed(2) : 'no world'", B2.ctx));
    check("?bench= leaves the sim paused on a drawn frame",
        vm.runInContext("CFG.paused", B2.ctx) === true);
    check("?bench= honours the pinned seed",
        vm.runInContext("sceneSeed", B2.ctx) === 1234,
        "sceneSeed = " + vm.runInContext("sceneSeed", B2.ctx));
    check("?bench= reports to document.title", /bench 300 steps/.test(title), title);
} catch (e) {
    check("?bench= warm-up path", false, e.message);
    console.error(e.stack);
}

/* ?bare=1 hides the panels for the thumbnail. If it throws on a missing id the
 * thumbnail silently becomes a picture of the whole page instead. */
try {
    const B3 = boot("?bare=1&bench=60");
    B3.document._ready();
    check("?bare= strips the chrome without throwing",
        B3.document.getElementById("panel-left").style.display === "none");
} catch (e) {
    check("?bare= strips the chrome without throwing", false, e.message);
    console.error(e.stack);
}

console.log("\n" + (failures ? failures + " FAILED" : "all UI checks passed"));
process.exit(failures ? 1 : 0);
