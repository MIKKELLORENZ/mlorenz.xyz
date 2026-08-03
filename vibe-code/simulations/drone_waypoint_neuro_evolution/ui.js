/* ui.js — panel wiring. Every knob lives in CFG; main.js reads it each frame. */
"use strict";

/* Defaults are the settings that actually produced the brain baked into this
 * build — 96 drones × 4 episodes, mutation 10% / σ 0.09, grace 3, both search
 * gates at their trained values. Training here is meant to be a faithful
 * re-run of that, not a lighter demo version of it, so the panel opens on the
 * real numbers and you can turn them down rather than having to guess them up.
 * 96 × 4 is 384 episodes a generation, so use Headless + MAX for real runs. */
const CFG = {
    popSize: 96,
    episodes: 4,
    mutRate: 0.10,
    mutSigma: 0.09,
    gracePeriod: 3,
    // Fitness is per-room normalised (STAGES.scale), so these are in units of
    // "competent episodes": 1.0 ≈ a decent run in every room the exam covers.
    immZeroFit: 1.2,
    childZeroFit: 2.5,
    stageLock: 0,          // 0 = let the population decide
    headless: false,       // hide the view and spend the whole frame on physics
    ghosts: 14,
    showRays: true,
    showWaypoints: true,
    showTrail: true,
    showDead: false,
    noise: true,
    speed: 1,              // physics-time multiplier; 0 = MAX
    paused: false
};

const UI = {};
function $(id) { return document.getElementById(id); }

const STAGE_LABELS = [
    { tag: "hall", desc: "An empty 26 × 18 m room in still air. Learn to leave the pad, hold an attitude, and fly to a point in space." },
    { tag: "pillars", desc: "Eight floor-to-ceiling columns and a light draught. The straight line is no longer always free." },
    { tag: "warehouse", desc: "Partition walls with door gaps, shelving at mid height, a low overhang, and real turbulence." }
];

function initUI(handlers) {
    // ---- curriculum track ----
    const track = $("stage-track");
    STAGE_LABELS.forEach((s, i) => {
        const d = document.createElement("div");
        d.className = "stage-pip";
        d.innerHTML = `<b>${i}</b>${s.tag}`;
        d.title = s.desc;
        track.appendChild(d);
    });
    UI.setStage = stage => {
        [...track.children].forEach((c, i) => {
            c.classList.toggle("on", i === stage);
            c.classList.toggle("done", i < stage);
        });
        const s = STAGE_LABELS[stage];
        $("stage-desc").textContent = s ? s.desc : "";
        $("stat-stage").textContent = `stage ${stage} · ${s ? s.tag : ""}`;
    };

    // ---- speed ----
    const speeds = [[0.25, "¼×"], [1, "1×"], [3, "3×"], [8, "8×"], [0, "MAX"]];
    const sg = $("speed-group");
    const btnFor = new Map();
    speeds.forEach(([v, label]) => {
        const b = document.createElement("button");
        b.textContent = label;
        if (v === CFG.speed) b.classList.add("on");
        b.onclick = () => {
            CFG.speed = v;
            [...sg.children].forEach(c => c.classList.remove("on"));
            b.classList.add("on");
        };
        btnFor.set(v, b);
        sg.appendChild(b);
    });
    // so ?speed=0 moves the highlight too, rather than silently desyncing it
    UI.setSpeed = v => { const b = btnFor.get(v); if (b) b.onclick(); };

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
    bindSlider("sl-eps", "lb-eps", v => v, v => CFG.episodes = v);
    bindSlider("sl-grace", "lb-grace", v => v === 0 ? "off" : v + " gens", v => CFG.gracePeriod = v);
    bindSlider("sl-mutrate", "lb-mutrate", v => v + "%", v => CFG.mutRate = v / 100);
    bindSlider("sl-mutsig", "lb-mutsig", v => (v / 100).toFixed(2), v => CFG.mutSigma = v / 100);
    const kfit = v => v === 0 ? "never" : (v / 10).toFixed(1);
    bindSlider("sl-imm-zero", "lb-imm-zero", kfit, v => CFG.immZeroFit = v / 10);
    bindSlider("sl-child-zero", "lb-child-zero", kfit, v => CFG.childZeroFit = v / 10);
    bindSlider("sl-stagelock", "lb-stagelock", v => v < 0 ? "auto" : "stage " + v, v => CFG.stageLock = v < 0 ? 0 : v);
    bindSlider("sl-ghosts", "lb-ghosts", v => v, v => CFG.ghosts = v);

    const bindCheck = (id, apply) => {
        const el = $(id);
        el.onchange = () => apply(el.checked);
        apply(el.checked);
    };
    bindCheck("chk-headless", v => CFG.headless = v);
    bindCheck("chk-rays", v => CFG.showRays = v);
    bindCheck("chk-waypoints", v => CFG.showWaypoints = v);
    bindCheck("chk-trail", v => CFG.showTrail = v);
    bindCheck("chk-dead", v => CFG.showDead = v);
    bindCheck("chk-noise", v => CFG.noise = v);
    bindCheck("chk-follow", v => { if (UI.setFollow) UI.setFollow(v); });

    $("btn-restart").onclick = handlers.onRestart;
    $("btn-save").onclick = handlers.save;
    $("btn-load").onclick = handlers.load;
    $("btn-export").onclick = handlers.exportFile;
    $("btn-default").onclick = handlers.loadDefault;
    $("btn-bake").onclick = handlers.bakeDefault;
    $("btn-showcase").onclick = handlers.showcase;
    $("btn-inject").onclick = handlers.injectBest;
    $("btn-import").onclick = () => $("file-import").click();
    $("file-import").onchange = e => {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => handlers.importJSON(r.result);
        r.readAsText(f);
        e.target.value = "";
    };

    const intro = $("intro");
    const closeIntro = () => intro && intro.classList.add("hidden");
    if (/[?&]nointro/.test(location.search)) closeIntro();

    // If nothing has been baked into this build, say so on the button rather
    // than letting someone click "watch the trained champion" and quietly get
    // a fleet of random brains.
    const watch = $("intro-watch");
    if (handlers.hasBuiltIn && handlers.hasBuiltIn()) {
        const fit = handlers.builtInFitness();
        if (fit) watch.querySelector("small").textContent =
            `The best evolved brain flies the whole fleet at once — exam score ${fit.toFixed(2)}`;
    } else {
        watch.classList.remove("primary");
        watch.disabled = true;
        watch.querySelector("small").textContent =
            "no champion baked into this build — evolve one, then Brain → Bake default_brain.js";
        $("intro-scratch").classList.add("primary");
    }
    $("intro-watch").onclick = () => { handlers.showcase(); closeIntro(); };
    $("intro-scratch").onclick = () => { handlers.onRestart(); closeIntro(); };
    $("intro-explore").onclick = closeIntro;
    UI.setGrace = g => { const sl = $("sl-grace"); if (sl) { sl.value = g; sl.dispatchEvent(new Event("input")); } };

    const weights = NET_SIZES.reduce((a, n, i) => i ? a + NET_SIZES[i - 1] * n + n : 0, 0);
    $("brain-shape").textContent =
        `Export gives the raw weight matrices — the same ${NET_SIZES[0]}-in / ` +
        `${NET_SIZES[NET_SIZES.length - 1]}-out contract a real flight controller would ` +
        `implement (${NC} sensor channels with per-channel history, ${weights.toLocaleString()} weights).`;
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

/* The curriculum in one picture: how much of the fleet gets airborne, how much
 * of it crashes, and how many waypoints the mean drone reaches. Early on the
 * first two are the only lines that move — waypoints stay flat at zero for a
 * long time, and watching takeoff climb while crashes fall is the only way to
 * tell a run that is working from one that is stuck. */
function drawSkillChart(history) {
    const cv = $("chart2"), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (history.length < 2) return;
    const maxArr = Math.max(1, ...history.map(h => h.avgArr || 0));
    const px = i => 4 + (i / (history.length - 1)) * (cv.width - 8);
    const py = v => cv.height - 6 - v * (cv.height - 14);
    ctx.lineWidth = 1.5;
    const series = [
        ["takeoffFrac", "#4fe0a8", 1],
        ["crashFrac", "#ff5f6b", 1],
        ["avgArr", "#ffc94d", maxArr]
    ];
    for (const [key, color, scale] of series) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        history.forEach((h, i) => {
            const v = (h[key] || 0) / scale;
            i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v));
        });
        ctx.stroke();
    }
    // stage bands along the bottom
    ctx.globalAlpha = 0.6;
    history.forEach((h, i) => {
        ctx.fillStyle = ["#1f3450", "#2b6a8c", "#8a7a2b"][h.stage || 0];
        ctx.fillRect(px(i), cv.height - 4, Math.max(1, (cv.width - 8) / history.length + 1), 4);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#7d93ab";
    ctx.font = "10px sans-serif";
    ctx.fillText("100% / " + maxArr.toFixed(1) + " wp", 4, 10);
}
