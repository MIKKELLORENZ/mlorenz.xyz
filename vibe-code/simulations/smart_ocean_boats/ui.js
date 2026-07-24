/* ui.js — panel wiring. All knobs live in CFG; main.js reads it every frame. */
"use strict";

const CFG = {
    mapIndex: 0,
    popSize: 48,
    episodeTime: 110,
    mutRate: 0.10,
    mutSigma: 0.15,
    gracePeriod: 3,
    immZeroFit: 15000,     // best-ever fitness past which random immigrants stop
    childZeroFit: 25000,   // …and past which crossover children stop too
    headless: false,       // skip all rendering; pour every ms into training
    collideFromStart: false,
    collideGen: 30,
    collideThreshold: 2.0,
    combatEnabled: false,
    combatGen: 80,
    speed: 2,              // steps-per-frame multiplier; 0 = MAX
    paused: false,
    showSensors: false,
    showCurrents: true,
    showRoutes: true,
    showTrails: true,
    noise: true,
    evalMode: false        // keep a frozen copy of the best-ever brain in the pool each gen
};

const UI = {};

function $(id) { return document.getElementById(id); }

function initUI(onMapChange, onRestart, brainIO) {
    // map buttons
    const mb = $("map-buttons");
    MAP_DEFS.forEach((def, i) => {
        const btn = document.createElement("button");
        btn.innerHTML = `<b>${def.name}</b><small>${def.docks.length} docks</small>`;
        btn.onclick = () => {
            CFG.mapIndex = i;
            [...mb.children].forEach((c, j) => c.classList.toggle("on", j === i));
            $("map-desc").textContent = def.desc;
            onMapChange(i);
        };
        mb.appendChild(btn);
    });
    mb.children[0].classList.add("on");
    $("map-desc").textContent = MAP_DEFS[0].desc;

    // speed group
    const speeds = [[1, "1×"], [2, "2×"], [4, "4×"], [8, "8×"], [0, "MAX"]];
    const sg = $("speed-group");
    speeds.forEach(([v, label]) => {
        const b = document.createElement("button");
        b.textContent = label;
        if (v === CFG.speed) b.classList.add("on");
        b.onclick = () => {
            CFG.speed = v;
            [...sg.children].forEach(c => c.classList.remove("on"));
            b.classList.add("on");
        };
        sg.appendChild(b);
    });

    $("btn-pause").onclick = () => {
        CFG.paused = !CFG.paused;
        $("btn-pause").textContent = CFG.paused ? "Resume" : "Pause";
    };

    const bindSlider = (id, lb, fmt, apply) => {
        const el = $(id);
        const upd = () => { $(lb).textContent = fmt(+el.value); apply(+el.value); };
        el.oninput = upd; upd();
    };
    bindSlider("sl-pop", "lb-pop", v => v, v => CFG.popSize = v);
    bindSlider("sl-episode", "lb-episode", v => v + " s", v => CFG.episodeTime = v);
    bindSlider("sl-grace", "lb-grace", v => v === 0 ? "off" : v + " gens", v => CFG.gracePeriod = v);
    bindSlider("sl-mutrate", "lb-mutrate", v => v + "%", v => CFG.mutRate = v / 100);
    bindSlider("sl-mutsig", "lb-mutsig", v => (v / 100).toFixed(2), v => CFG.mutSigma = v / 100);
    const kfit = v => v === 0 ? "never" : (v / 1000) + "k";
    bindSlider("sl-imm-zero", "lb-imm-zero", kfit, v => CFG.immZeroFit = v);
    bindSlider("sl-child-zero", "lb-child-zero", kfit, v => CFG.childZeroFit = v);
    bindSlider("sl-collide-gen", "lb-collide-gen", v => v, v => CFG.collideGen = v);
    bindSlider("sl-collide-thr", "lb-collide-thr", v => (v / 10).toFixed(1), v => CFG.collideThreshold = v / 10);
    bindSlider("sl-combat-gen", "lb-combat-gen", v => v, v => CFG.combatGen = v);

    const bindCheck = (id, apply) => {
        const el = $(id);
        el.onchange = () => apply(el.checked);
        apply(el.checked);
    };
    bindCheck("chk-headless", v => CFG.headless = v);
    bindCheck("chk-collide-start", v => CFG.collideFromStart = v);
    bindCheck("chk-combat", v => CFG.combatEnabled = v);
    bindCheck("chk-sensors", v => CFG.showSensors = v);
    bindCheck("chk-currents", v => CFG.showCurrents = v);
    bindCheck("chk-routes", v => CFG.showRoutes = v);
    bindCheck("chk-trails", v => CFG.showTrails = v);
    bindCheck("chk-noise", v => CFG.noise = v);

    $("btn-restart").onclick = onRestart;

    $("btn-save").onclick = brainIO.save;
    $("btn-load").onclick = brainIO.load;
    $("btn-export").onclick = brainIO.exportFile;
    $("btn-default").onclick = brainIO.loadDefault;
    $("btn-showcase").onclick = brainIO.showcase;
    $("btn-inject").onclick = brainIO.injectBest;
    $("btn-import").onclick = () => $("file-import").click();
    $("file-import").onchange = e => {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => brainIO.importJSON(r.result);
        r.readAsText(f);
        e.target.value = "";
    };

    // eval mode: one source of truth (CFG.evalMode), mirrored on both checkboxes
    // (the panel one and the intro-modal one).
    const evalBoxes = [$("chk-eval"), $("intro-eval")].filter(Boolean);
    const setEval = v => { CFG.evalMode = v; evalBoxes.forEach(b => b.checked = v); };
    evalBoxes.forEach(b => b.onchange = () => setEval(b.checked));

    // intro modal — a one-click launcher over the running scene
    const intro = $("intro");
    const closeIntro = () => intro && intro.classList.add("hidden");
    if ($("intro-watch")) $("intro-watch").onclick = () => { brainIO.showcase(); closeIntro(); };
    if ($("intro-scratch")) $("intro-scratch").onclick = () => { onRestart(); closeIntro(); };
    if ($("intro-explore")) $("intro-explore").onclick = closeIntro;
    // let the caller (main.js) also nudge grace when a brain is injected
    UI.setGrace = g => { const sl = $("sl-grace"); if (sl) { sl.value = g; sl.dispatchEvent(new Event("input")); } };
}

function uiLog(html) {
    const log = $("log");
    const div = document.createElement("div");
    div.innerHTML = html;
    log.prepend(div);
    while (log.children.length > 80) log.lastChild.remove();
}

function drawChart(history) {
    const cv = $("chart"), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (history.length < 2) return;
    const vals = history.flatMap(h => [h.best, h.avg]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = Math.max(1, max - min);
    const px = i => 4 + (i / (history.length - 1)) * (cv.width - 8);
    const py = v => cv.height - 6 - ((v - min) / span) * (cv.height - 14);
    ctx.lineWidth = 1.5;
    for (const [key, color] of [["avg", "#35b6ff"], ["best", "#ffc94d"]]) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        history.forEach((h, i) => i ? ctx.lineTo(px(i), py(h[key])) : ctx.moveTo(px(i), py(h[key])));
        ctx.stroke();
    }
    ctx.fillStyle = "#7d93ab";
    ctx.font = "10px sans-serif";
    ctx.fillText(Math.round(max), 4, 10);
    ctx.fillText(Math.round(min), 4, cv.height - 2);
}
