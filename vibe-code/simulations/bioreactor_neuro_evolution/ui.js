/* ui.js — panel wiring. All knobs live in CFG; main.js reads it every frame. */
"use strict";

const CFG = {
    popSize: 16,
    episodes: 5,           // one pass of the five products
    mutRate: 0.10,
    mutSigma: 1.0,         // relative to each layer's init scale — see nn.js and train.js:
                           // 0.35 never reaches a working dose; 1.0 finds a recipe
    gracePeriod: 3,
    headless: false,
    speed: 1 / 16,         // control ticks per rendered frame (1/16 = one hour every 16 frames); 0 = MAX
    paused: false,
    compareSop: true,
    exhibition: false,
    sopOnly: false,
    /* Which of the five products to make. null = a fresh draw every batch,
     * which is what the controller was bred for; 0..4 pins one protocol,
     * because someone who came to see β cells should not have to press "new
     * batch" five times to get them. The trainer never sets this. */
    lin: null,
    /* The difficulty rung is not a button. Every new batch draws one along
     * with its cell line and its failures, because that is what walking into
     * a lab on a Monday is like. `level` is the top of the range the page
     * draws from; the trainer still ratchets it. */
    level: 4,
    levelFloor: 0
};

const UI = {};
function $(id) { return document.getElementById(id); }

/* A segmented control: one button per option, the current one filled. */
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
        btns.forEach((b, i) => b.classList.toggle("on", isOn(options[i].value)));
    }
    paint();
    return paint;
}

/* The product chooser, in the header and again in the intro. Both are the
 * same list and both repaint each other, so whichever one was used the other
 * is not left showing a stale selection. */
const linRepaint = [];
function linOptions() {
    const opts = [{ value: null, label: "Any", title: "A fresh draw every batch — any of the five" }];
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

function initUI(onRestart, onPlanChange, brainIO) {
    // ---- playback speed ----
    buildSeg($("speed-group"),
        [[1 / 16, "slow"], [0.25, "¼×"], [1, "1×"], [4, "4×"], [0, "max"]].map(([v, label]) => ({ value: v, label })),
        v => CFG.speed === v,
        v => CFG.speed = v);

    // ---- which product ----
    buildLineageChooser($("lin-group"), () => { if (UI.onLineage) UI.onLineage(); });
    buildLineageChooser($("intro-lin"), null);

    $("btn-pause").onclick = () => {
        CFG.paused = !CFG.paused;
        $("btn-pause").textContent = CFG.paused ? "Resume" : "Pause";
    };

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

    const bindCheck = (id, apply) => {
        const el = $(id);
        if (!el) return;
        el.onchange = () => apply(el.checked);
        apply(el.checked);
    };
    bindCheck("chk-headless", v => CFG.headless = v);

    if ($("rung-desc")) $("rung-desc").innerHTML = rungText(CFG.level);

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
    if ($("btn-next-scn")) $("btn-next-scn").onclick = () => { if (UI.nextScenario) UI.nextScenario(); };

    const intro = $("intro");
    const closeIntro = () => intro && intro.classList.add("hidden");
    if (new URLSearchParams(location.search).get("intro") === "0") closeIntro();
    const openIntro = () => intro && intro.classList.remove("hidden");
    if ($("btn-menu")) $("btn-menu").onclick = openIntro;
    /* One way in. The protocol-alone and evolve-from-scratch modes are still
     * here — `?sop=1`, and the restart button in Evolution settings — they are
     * just not what the front door offers. */
    if ($("intro-watch")) $("intro-watch").onclick = () => { brainIO.showcase(); closeIntro(); };
    if ($("intro-explore")) $("intro-explore").onclick = closeIntro;
    if (intro) intro.onclick = (e) => { if (e.target === intro) closeIntro(); };
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && intro && !intro.classList.contains("hidden")) closeIntro();
    });
}

/* The whole ladder in one paragraph, for the difficulty card. */
function rungText(top) {
    const bits = [];
    for (let L = 0; L <= top && L < N_LEVELS; L++) {
        const d = DIFFICULTY[L];
        const parts = [`inoculum ±${(d.seedCV * 100).toFixed(0)} %`];
        if (d.lots) parts.push("reagent lots vary");
        if (!d.weekendTech) parts.push("nothing at weekends");
        if (d.equipment) parts.push(`up to ${d.equipment} equipment failure${d.equipment > 1 ? "s" : ""}`);
        if (d.probes) parts.push("probes drift");
        if (d.mag > 1) parts.push("everything bigger");
        bits.push(`<b>L${L} ${d.label}</b> — ${parts.join(", ")}`);
    }
    return bits.join("<br>");
}

function uiLog(html) {
    const log = $("log");
    if (!log) return;
    const div = document.createElement("div");
    div.innerHTML = html;
    log.prepend(div);
    while (log.children.length > 80) log.lastChild.remove();
}
