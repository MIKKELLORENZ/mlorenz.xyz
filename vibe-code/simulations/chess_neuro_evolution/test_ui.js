/* test_ui.js — boots the page's scripts against a stub DOM. Run: node test_ui.js
 *
 * The failure this exists to catch is the one that costs an afternoon: main.js
 * asking for an element id that index.html does not have. In a browser that is
 * a null dereference somewhere inside a render loop, thousands of frames after
 * the mistake; here it throws immediately, by name.
 *
 * It also drives the real training loop, both charts, mode switching and a
 * board click, so anything that throws on a normal interaction shows up too,
 * and it boots a second copy through the ?bench= warm-up path used for
 * screenshots and headless runs.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const IDS = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const CLASSES = new Set([...html.matchAll(/\bclass="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
const SCRIPTS = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

// id -> the classes index.html gives that element, so a stub element starts out
// hidden exactly when the real one does.
const ID_CLASSES = new Map();
for (const tag of html.match(/<[a-zA-Z][^>]*>/g) || []) {
    const id = /\bid="([^"]+)"/.exec(tag);
    if (!id) continue;
    const cls = /\bclass="([^"]+)"/.exec(tag);
    ID_CLASSES.set(id[1], cls ? cls[1] : "");
}

let failures = 0;
function check(name, ok, extra) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}

/* ------------------------------------------------------------- stub DOM ---- */
function noopCtx() {
    return new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : () => {}),
        set: (t, k, v) => { t[k] = v; return true; }
    });
}

// Builds an isolated stub page and runs every script index.html lists.
function boot(search) {
    const listeners = new Map(); // id -> {event: handler}
    const els = new Map();
    const missing = [];
    const frames = [];

    function makeEl(id, extra) {
        const el = Object.assign({
            id, textContent: "", className: "", value: "1",
            checked: false, disabled: false, title: "",
            style: {}, dataset: {}, children: [],
            width: 280, height: 100,
            clientWidth: 520, clientHeight: 430, offsetWidth: 14,
            // A real class set, not a no-op: showing the wrong control dock for
            // the current mode is exactly the kind of bug this file should
            // catch, and a stubbed-out toggle() cannot see it.
            classList: (() => {
                const initial = ID_CLASSES.get(id) || (extra && extra.className) || "";
                const set = new Set(String(initial).split(/\s+/).filter(Boolean));
                return {
                    add: c => set.add(c),
                    remove: c => set.delete(c),
                    contains: c => set.has(c),
                    toggle(c, force) {
                        const on = force === undefined ? !set.has(c) : !!force;
                        on ? set.add(c) : set.delete(c);
                        return on;
                    }
                };
            })(),
            getContext: () => noopCtx(),
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 480 }),
            addEventListener(ev, fn) {
                if (!listeners.has(id)) listeners.set(id, {});
                listeners.get(id)[ev] = fn;
            },
            click() { const h = (listeners.get(id) || {}).click; if (h) h({}); },
            appendChild(c) { this.children.push(c); return c; },
            append(...cs) { this.children.push(...cs); },
            removeChild() {}
        }, extra || {});
        el.parentElement = { title: "", classList: el.classList, appendChild() {} };
        // Clearing textContent removes children in a real DOM, which is exactly
        // how main.js empties a <select> before repopulating it. Without this
        // the stub's option lists grow forever and the test would never notice
        // a select being rebuilt every frame.
        let text = el.textContent;
        Object.defineProperty(el, "textContent", {
            get: () => text,
            set(v) { text = String(v); if (text === "") el.children.length = 0; },
            enumerable: true, configurable: true
        });
        return el;
    }

    els.set("speed", makeEl("speed", { value: "1" }));
    els.set("pop", makeEl("pop", { value: "48" }));

    function getEl(id) {
        if (!IDS.has(id)) { missing.push(id); throw new Error(`getElementById("${id}") — no such id in index.html`); }
        if (!els.has(id)) els.set(id, makeEl(id));
        return els.get(id);
    }

    // Mode tabs are read out of index.html, so a tab added there without being
    // wired up in main.js still gets exercised here.
    const MODES = [...html.matchAll(/class="mode-tab[^"]*"\s+data-mode="([^"]+)"/g)].map(m => m[1]);
    const tabHandlers = {};
    const tabs = MODES.map(mode => {
        const t = makeEl("tab-" + mode, { dataset: { mode } });
        t.addEventListener = (ev, fn) => { if (ev === "click") tabHandlers[mode] = fn; };
        // main.js switches tabs programmatically for the ?mode= deep link, so
        // click() has to actually dispatch rather than look in the id-keyed
        // listener map these elements never register in.
        t.click = () => { if (tabHandlers[mode]) tabHandlers[mode](); };
        return t;
    });

    const sandbox = {
        console, Math, JSON, Date, Number, Object, Array, Map, Set,
        Float64Array, Float32Array, Int8Array, Uint32Array,
        isFinite, parseInt, parseFloat, setTimeout, clearTimeout, URLSearchParams,
        document: {
            getElementById: getEl,
            querySelectorAll: sel => (sel === ".mode-tab" ? tabs : []),
            documentElement: {},
            createElement: tag => makeEl("created:" + tag, { href: "", download: "", click() {} })
        },
        window: { addEventListener() {}, devicePixelRatio: 1 },
        location: { search: search || "" },
        getComputedStyle: () => ({ getPropertyValue: () => "" }),
        performance: { now: () => Date.now() },
        requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
        localStorage: (() => {
            const m = new Map();
            return {
                getItem: k => (m.has(k) ? m.get(k) : null),
                setItem: (k, v) => m.set(k, String(v)),
                removeItem: k => m.delete(k)
            };
        })(),
        confirm: () => true,
        alert: () => {},
        Blob: function () {},
        URL: { createObjectURL: () => "blob:stub", revokeObjectURL() {} }
    };
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    const ctx = vm.createContext(sandbox);

    let error = null;
    try {
        for (const f of SCRIPTS) {
            vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), ctx, { filename: f });
        }
    } catch (e) { error = e; }
    return { ctx, els, getEl, listeners, tabHandlers, tabs, frames, missing, error, MODES };
}

/* ------------------------------------------------------------ main boot ---- */
check("index.html lists the expected scripts",
    SCRIPTS.join(",") === "chess.js,features.js,nn.js,evolution.js,default_brain.js,main.js",
    SCRIPTS.join(","));

const page = boot("");
check("the page boots", !page.error, page.error ? page.error.message : "");
check("every element id main.js asks for exists in index.html",
    page.missing.length === 0, page.missing.join(", "));

/* ------------------------------------------------------ startup screen ----- */
{
    const s = boot("");
    check("the startup screen is up before anything else",
        !s.error && !s.getEl("startup").classList.contains("hidden"),
        s.error ? s.error.message : "");
    check("it offers exactly two ways in",
        /Play against Mikkel.{0,8}s AI/.test(html) && /Train from scratch/.test(html));
    if (!s.error) {
        // Training must not be burning cores behind an unanswered modal.
        check("training is held until a choice is made",
            s.getEl("btn-pause").textContent === "Resume", s.getEl("btn-pause").textContent);
        s.getEl("speed").value = "6";
        // A few frames first, so the panel has actually written a generation
        // number to compare against - it starts out empty.
        for (let i = 0; i < 20 && s.frames.length; i++) s.frames.shift()();
        const genBefore = s.getEl("stat-gen").textContent;
        for (let i = 0; i < 120 && s.frames.length; i++) s.frames.shift()();
        check("no generations run while the startup screen is up",
            genBefore !== "" && s.getEl("stat-gen").textContent === genBefore,
            `${genBefore || "(blank)"} -> ${s.getEl("stat-gen").textContent}`);

        s.listeners.get("btn-start-play").click({});
        check("'Play against Mikkel's AI' dismisses the startup screen",
            s.getEl("startup").classList.contains("hidden"));
        check("…and lands in play mode",
            !s.getEl("play-controls").classList.contains("hidden") &&
            s.getEl("watch-controls").classList.contains("hidden"));
        for (let i = 0; i < 3 && s.frames.length; i++) s.frames.shift()(); // let the caption redraw
        check("…against Mikkel's AI specifically",
            /Mikkel/.test(s.getEl("caption-main").textContent),
            s.getEl("caption-main").textContent);
        check("…with training left paused",
            s.getEl("btn-pause").textContent === "Resume");

        const t = boot("");
        t.listeners.get("btn-start-train").click({});
        check("'Train from scratch' dismisses the startup screen",
            t.getEl("startup").classList.contains("hidden"));
        check("…and starts training immediately",
            t.getEl("btn-pause").textContent === "Pause", t.getEl("btn-pause").textContent);
        check("…with neither control dock showing",
            t.getEl("play-controls").classList.contains("hidden") &&
            t.getEl("watch-controls").classList.contains("hidden"));
    }
}

if (!page.error) {
    const { getEl, els, listeners, tabHandlers, frames, ctx } = page;
    let runError = null;
    try {
        listeners.get("btn-start-train").click({});
        // Restart on the smallest population at maximum speed, so a couple of
        // real generations finish inside a test run. At the default 1x speed a
        // frame is six plies and the charts would never be drawn from anything
        // but empty arrays.
        getEl("pop").value = "16";
        getEl("speed").value = "6";
        listeners.get("btn-reset").click({});
        for (let i = 0; i < 300 && frames.length; i++) frames.shift()();
    } catch (e) { runError = e; }
    check("300 render frames run without throwing", !runError, runError ? runError.stack.split("\n")[0] : "");

    const gen = getEl("stat-gen").textContent;
    check("training advanced past the first generation", +gen >= 2, `generation ${gen}`);

    // The ladder readout is generated from LADDER, so the page and the engine
    // cannot disagree about how many rungs there are.
    const rungs = vm.runInContext("LADDER.length", ctx);
    const rows = getEl("ladder-stats").children;
    check("one ladder row per rung", rows.length === rungs, `${rows.length} rows, ${rungs} rungs`);
    const values = rows.map(r => r.children[2].textContent);
    check("every rung shows a measured score", values.every(v => /%$/.test(v)), values.join(" "));
    check("the champion note was written",
        /generation/i.test(getEl("champion-note").textContent),
        getEl("champion-note").textContent.slice(0, 60));

    check("index.html declares train, watch and play tabs",
        page.MODES.join(",") === "train,watch,play", page.MODES.join(","));

    /* ---- watch mode: the champion plays, on its own, in front of you ---- */
    let watchError = null;
    let pliesWatched = 0;
    try {
        page.tabHandlers.watch();
        getEl("watch-pace").value = "0"; // instant, so a game finishes in-test
        const before = getEl("watch-status").textContent;
        void before;
        for (let i = 0; i < 400 && frames.length; i++) {
            frames.shift()();
            const g = vm.runInContext("0", ctx); void g;
        }
        pliesWatched = getEl("watch-status").textContent.length;
    } catch (e) { watchError = e; }
    check("watch mode runs without throwing", !watchError,
        watchError ? watchError.stack.split("\n")[0] : "");
    check("watch mode shows the watch dock and hides the play dock",
        !getEl("watch-controls").classList.contains("hidden") &&
        getEl("play-controls").classList.contains("hidden"));
    const wStatus = getEl("watch-status").textContent;
    check("watch mode reports what it is showing", /plays (white|black) vs/.test(wStatus), wStatus);
    check("the watched game actually progressed",
        /move \d+|wins by|draw by|loses by/.test(wStatus), wStatus);
    check("the brain picker was populated",
        getEl("watch-brain").children.length > 0,
        `${getEl("watch-brain").children.length} options`);
    check("the opponent picker offers every ladder rung plus a mirror",
        getEl("watch-opponent").children.length >= rungs + 1,
        `${getEl("watch-opponent").children.length} options for ${rungs} rungs`);
    check("the pickers are rebuilt only when the choices change",
        getEl("watch-brain").children.length < 40,
        `${getEl("watch-brain").children.length} options after 400 frames`);
    void pliesWatched;

    let uiError = null;
    try {
        for (const id of ["btn-watch-new", "btn-watch-pause"]) listeners.get(id).click({});
        for (let i = 0; i < 10 && frames.length; i++) frames.shift()();
        listeners.get("btn-watch-pause").click({}); // unpause again
        for (const id of ["watch-brain", "watch-opponent", "watch-pace"]) {
            const h = (listeners.get(id) || {}).change;
            if (h) h({});
        }
        for (const id of ["chk-headless", "chk-heat", "chk-warm"]) {
            const h = (listeners.get(id) || {}).change;
            if (h) { getEl(id).checked = true; h({}); getEl(id).checked = false; h({}); }
        }
        (listeners.get("speed") || {}).input?.({});
        (listeners.get("pop") || {}).input?.({});
        for (const id of ["btn-pause", "btn-save-champion", "btn-load-champion",
                          "btn-export-champion"]) {
            listeners.get(id).click({});
        }
        page.tabHandlers.play();
        for (const id of ["btn-play-white", "btn-play-black", "btn-play-resign"]) {
            listeners.get(id).click({});
        }
        (listeners.get("play-brain") || {}).change?.({});
        const boardClick = (listeners.get("board") || {}).click;
        if (boardClick) {
            boardClick({ clientX: 60 * 4 + 30, clientY: 60 * 6 + 30 }); // pick up a pawn
            boardClick({ clientX: 60 * 4 + 30, clientY: 60 * 4 + 30 }); // push it two
        }
        for (let i = 0; i < 20 && frames.length; i++) frames.shift()();
        page.tabHandlers.train();
        for (let i = 0; i < 20 && frames.length; i++) frames.shift()();
    } catch (e) { uiError = e; }
    check("controls, mode switching and board clicks all work", !uiError,
        uiError ? uiError.stack.split("\n")[0] : "");
    check("play mode reported a status", /move|win|Draw|thinking/i.test(els.get("play-status").textContent),
        els.get("play-status").textContent);
    check("the play opponent picker was populated",
        getEl("play-brain").children.length > 0, `${getEl("play-brain").children.length} options`);
    check("returning to Train hides both docks again",
        getEl("watch-controls").classList.contains("hidden") &&
        getEl("play-controls").classList.contains("hidden"));
}

/* ----------------------------------------------------- ?mode deep link ----- */
{
    const deep = boot("?mode=watch&bench=8000");
    check("?mode=watch boots straight into watch mode", !deep.error &&
        !deep.getEl("watch-controls").classList.contains("hidden"),
        deep.error ? deep.error.message : "");
    if (!deep.error) {
        for (let i = 0; i < 30 && deep.frames.length; i++) deep.frames.shift()();
        const s = deep.getEl("watch-status").textContent;
        check("the deep-linked game is running", /plays (white|black) vs/.test(s), s);
    }
}

/* ----------------------------------------------------- ?bench warm-up ------ */
{
    // Screenshot and headless-assertion runs depend on this path, and it is the
    // one code path that must not use a wall-clock bound: under virtual time
    // performance.now() stops advancing and a clock-bounded loop never exits.
    const t0 = Date.now();
    const warm = boot("?bench=12000&heat=0&paused=1");
    const secs = (Date.now() - t0) / 1000;
    check("?bench boots without throwing", !warm.error, warm.error ? warm.error.message : "");
    check("?bench finishes promptly rather than spinning", secs < 60, `${secs.toFixed(1)}s`);
    if (!warm.error) {
        const evGen = vm.runInContext("0", warm.ctx); // context is alive
        void evGen;
        let frameErr = null;
        try { for (let i = 0; i < 5 && warm.frames.length; i++) warm.frames.shift()(); }
        catch (e) { frameErr = e; }
        check("?bench page renders after warm-up", !frameErr, frameErr ? frameErr.message : "");
        check("?paused=1 flips the pause button",
            warm.els.get("btn-pause").textContent === "Resume",
            warm.els.get("btn-pause").textContent);
        check("?heat=0 unticks the heat toggle", warm.els.get("chk-heat").checked === false);
    }
}

/* ------------------------------------------------ layout: no overlapping --- */
{
    // The control dock used to be absolutely positioned over the bottom of the
    // board area, which meant it covered the last rank on a short window. Both
    // docks and the board now live in one column, so overlap is structurally
    // impossible rather than merely unlikely.
    const css = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
    const dockRule = /#play-controls,\s*#watch-controls\s*\{([^}]*)\}/.exec(css);
    check("the control docks exist as one shared rule", !!dockRule);
    check("the control docks are in normal flow, not floating over the board",
        !!dockRule && !/position:\s*absolute/.test(dockRule[1]),
        dockRule ? dockRule[1].replace(/\s+/g, " ").trim().slice(0, 60) : "");
    const capRule = /#board-caption\s*\{([^}]*)\}/.exec(css);
    check("the caption is in normal flow too",
        !!capRule && !/position:\s*absolute/.test(capRule[1]));
    check("index.html wraps the board and the eval bar in a sizing row",
        IDS.has("board-row") && /#board-row/.test(css));
    check("the viewport stacks its children in a column",
        /#viewport\s*\{[^}]*flex-direction:\s*column/.test(css));

    // And the board really is sized to a square that fits the row.
    const s = boot("");
    s.listeners.get("btn-start-train").click({});
    for (let i = 0; i < 3 && s.frames.length; i++) s.frames.shift()();
    const wrap = s.getEl("board-wrap");
    check("the board is sized to a square by sizeBoard()",
        /^\d+px$/.test(wrap.style.width) && wrap.style.width === wrap.style.height,
        `${wrap.style.width} x ${wrap.style.height}`);
    check("the eval bar is kept level with the board",
        s.getEl("eval-bar-wrap").style.height === wrap.style.width,
        `${s.getEl("eval-bar-wrap").style.height} vs ${wrap.style.width}`);
}

/* --------------------------------------------------------- markup sanity --- */
check("the heatmap legend is declared", IDS.has("heat-legend"));
check("about section uses the styled classes", CLASSES.has("about") && CLASSES.has("note"));
const cssText = fs.readFileSync(path.join(__dirname, "style.css"), "utf8");
check("style.css styles the about sub-headings", /\.about h3/.test(cssText));
check("style.css styles the heat legend", /#heat-legend/.test(cssText));
check("style.css styles the ladder readout", /#ladder-stats/.test(cssText));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
