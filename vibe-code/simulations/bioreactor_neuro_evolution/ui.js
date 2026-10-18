/* ui.js — panel wiring. All knobs live in CFG; main.js reads it every frame. */
"use strict";

const CFG = {
    popSize: 16,
    episodes: 5,           // one pass of the five products
    mutRate: 0.10,
    mutSigma: 1.0,         // relative to each layer's init scale (see nn.js)
    gracePeriod: 3,
    headless: false,
    speed: 1 / 16,         // control ticks per 1/60 s: one simulated hour every 16 frames. 0 = as fast as possible
    paused: false,
    exhibition: false,
    /* Which product to make: null draws a new one every batch (what the
     * controller was trained for), 0..4 pins one. The trainer never sets it. */
    lin: null,
    /* Each batch draws its difficulty from 0..level. */
    level: 4
};

const UI = {};
function $(id) { return document.getElementById(id); }

/* A segmented control: one button per option, the current one highlighted. */
function buildSeg(host, options, isOn, onPick) {
    if (!host) return () => { };
    host.innerHTML = "";
    const btns = options.map((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = opt.label;
        if (opt.title) b.title = opt.title;
        b.onclick = () => { onPick(opt.value); paint(); };
        host.appendChild(b);
        return b;
    });
    function paint() {
        btns.forEach((b, i) => {
            const on = isOn(options[i].value);
            b.classList.toggle("on", on);
            b.setAttribute("aria-pressed", on);
        });
    }
    paint();
    return paint;
}

/* The product chooser appears in the header and in the intro; picking in one
 * repaints both. */
const linRepaint = [];
function linOptions() {
    const opts = [{ value: null, label: "Any", title: "A different product every batch" }];
    LINEAGES.forEach((L, i) => opts.push({ value: i, label: L.short || L.label, title: L.order }));
    return opts;
}
function buildLineageChooser(host, onPick) {
    const paint = buildSeg(host, linOptions(), v => CFG.lin === v, v => {
        CFG.lin = v;
        linRepaint.forEach(p => p());
        if (onPick) onPick(v);
    });
    linRepaint.push(paint);
    return paint;
}

function initUI(onRestart, brainIO) {
    // Playback speed, relative to the default of one simulated hour every 16 frames.
    buildSeg($("speed-group"),
        [[1 / 16, "1×"], [0.25, "4×"], [1, "16×"], [4, "64×"], [0, "Max"]].map(([value, label]) => ({ value, label })),
        v => CFG.speed === v,
        v => CFG.speed = v);

    buildLineageChooser($("lin-group"), () => { if (UI.onLineage) UI.onLineage(); });
    buildLineageChooser($("intro-lin"), () => { if (UI.onLineage) UI.onLineage(); });

    $("btn-pause").onclick = () => {
        CFG.paused = !CFG.paused;
        $("btn-pause").textContent = CFG.paused ? "Resume" : "Pause";
    };
    $("btn-next-scn").onclick = () => { if (UI.nextScenario) UI.nextScenario(); };

    const bindSlider = (id, lb, fmt, apply) => {
        const el = $(id);
        if (!el) return;
        const upd = () => { $(lb).textContent = fmt(+el.value); apply(+el.value); };
        el.oninput = upd; upd();
    };
    bindSlider("sl-pop", "lb-pop", v => v, v => CFG.popSize = v);
    bindSlider("sl-eps", "lb-eps", v => v, v => CFG.episodes = v);
    bindSlider("sl-grace", "lb-grace", v => v === 0 ? "off" : v + " gens", v => CFG.gracePeriod = v);
    bindSlider("sl-mutrate", "lb-mutrate", v => v + "%", v => CFG.mutRate = v / 100);
    bindSlider("sl-mutsig", "lb-mutsig", v => (v / 100).toFixed(2) + "×", v => CFG.mutSigma = v / 100);
    const headless = $("chk-headless");
    if (headless) { headless.onchange = () => { CFG.headless = headless.checked; }; CFG.headless = headless.checked; }

    if ($("rung-desc")) $("rung-desc").innerHTML = rungList(CFG.level);

    $("btn-restart").onclick = onRestart;
    $("btn-save").onclick = brainIO.save;
    $("btn-load").onclick = brainIO.load;
    $("btn-export").onclick = brainIO.exportFile;
    $("btn-default").onclick = brainIO.loadDefault;
    $("btn-showcase").onclick = brainIO.showcase;
    $("btn-import").onclick = () => $("file-import").click();
    $("file-import").onchange = e => {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => brainIO.importJSON(r.result);
        r.readAsText(f);
        e.target.value = "";
    };

    // The intro: pick a product, then start watching. About reopens it.
    const intro = $("intro");
    const closeIntro = () => intro.classList.add("hidden");
    const openIntro = () => intro.classList.remove("hidden");
    if (new URLSearchParams(location.search).get("intro") === "0") closeIntro();
    $("btn-about").onclick = openIntro;
    $("intro-start").onclick = () => { brainIO.showcase(); closeIntro(); };
    intro.onclick = (e) => { if (e.target === intro) closeIntro(); };
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !intro.classList.contains("hidden")) closeIntro();
    });
}

/* The difficulty levels, for the lab's difficulty card. */
function rungList(top) {
    const items = [];
    for (let L = 0; L <= top && L < N_LEVELS; L++) {
        const d = DIFFICULTY[L];
        const parts = [`inoculum ±${(d.seedCV * 100).toFixed(0)} %`];
        if (d.lots) parts.push("reagent lots vary");
        if (!d.weekendTech) parts.push("no assays at weekends");
        if (d.equipment) parts.push(`up to ${d.equipment} equipment fault${d.equipment > 1 ? "s" : ""}`);
        if (d.probes) parts.push("probes drift");
        if (d.mag > 1) parts.push("larger faults");
        items.push(`<li><b>${L}. ${d.label}</b> <span>${parts.join(", ")}</span></li>`);
    }
    return items.join("");
}

function uiLog(html) {
    const log = $("log");
    if (!log) return;
    const div = document.createElement("div");
    div.innerHTML = html;
    log.prepend(div);
    while (log.children.length > 80) log.lastChild.remove();
}
