/* ui.js — panel wiring. All knobs live in CFG; main.js reads it every frame. */
"use strict";

const CFG = {
    popSize: 24,
    episodes: 2,
    mutRate: 0.10,
    mutSigma: 0.35,        // relative to each layer's init scale — see nn.js
    gracePeriod: 3,
    immZeroFit: 1.0,
    childZeroFit: 1.8,
    stageLock: -1,         // −1 = let the curriculum ratchet decide
    taskLock: -1,          // −1 = follow the stage's task rotation
    headless: false,
    speed: 4,              // control steps per rendered frame multiplier; 0 = MAX
    paused: false,
    noise: true,
    randomise: true,
    comparePid: true,
    showFlux: true,
    showSensors: false,
    showFilaments: false,
    showTarget: true,
    showGhosts: true,
    ghosts: 10,
    evalMode: false,
    exhibition: false,     // display mode: one champion + the PID, no evolution
    level: 0               // difficulty rung (see DIFFICULTY in tokamak.js)
};

const UI = {};
function $(id) { return document.getElementById(id); }

function initUI(onRestart, onTaskChange, brainIO) {
    // ---- task buttons ----
    const tb = $("task-buttons");
    const mk = (label, idx, desc) => {
        const b = document.createElement("button");
        b.innerHTML = `<b>${label}</b><small>${desc}</small>`;
        b.onclick = () => {
            CFG.taskLock = idx;
            [...tb.children].forEach(c => c.classList.remove("on"));
            b.classList.add("on");
            $("task-desc").textContent = idx < 0
                ? "Episodes cycle through every task the curriculum has unlocked."
                : TASK_DEFS[idx].desc;
            onTaskChange();
        };
        tb.appendChild(b);
        return b;
    };
    const auto = mk("Curriculum", -1, "cycle the unlocked tasks");
    auto.classList.add("on");
    TASK_DEFS.forEach((d, i) => mk(d.label, i, `${(d.duration * 1e3) | 0} ms`));
    $("task-desc").textContent = "Episodes cycle through every task the curriculum has unlocked.";

    // ---- speed ----
    const speeds = [[1, "1×"], [4, "4×"], [12, "12×"], [40, "40×"], [0, "MAX"]];
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

    /* ---- difficulty rungs ----
     * The nominal machine is the LEAST interesting comparison: the PID's gains
     * were tuned on it and it holds its own there. Turning the wall thinner and
     * the plasma more elongated is where a controller that reads dB/dt pulls
     * away from one whose gains are constants, so the ladder belongs in the
     * display, not just in the headless sweep.
     *
     * In a training run this is the difficulty CAP, not the difficulty: episode
     * 0 runs here and the rest cycle down through every rung including 0, so
     * dragging it up ADDS a harder machine rather than abandoning the one the
     * population can already fly. See planEpisodes() in main.js. */
    const dg = $("diff-group");
    if (dg) {
        for (let L = 0; L < N_LEVELS; L++) {
            const b = document.createElement("button");
            b.textContent = "L" + L;
            b.title = `${DIFFICULTY[L].label} — elongation ×${(1 + DIFFICULTY[L].kappaGain).toFixed(2)} ` +
                `above round, wall ×${DIFFICULTY[L].wall.toFixed(2)}, noise ×${DIFFICULTY[L].noise.toFixed(1)}`;
            if (L === CFG.level) b.classList.add("on");
            b.onclick = () => {
                CFG.level = L;
                [...dg.children].forEach(c => c.classList.remove("on"));
                b.classList.add("on");
                if (CFG.exhibition) { if (UI.restartExhibit) UI.restartExhibit(); }
                // In the lab the rung is part of the episode plan, so it only
                // takes effect once the plan is rebuilt.
                else onTaskChange();
            };
            dg.appendChild(b);
        }
    }

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
    bindSlider("sl-stagelock", "lb-stagelock", v => v < 0 ? "auto" : "stage " + v, v => CFG.stageLock = v);
    bindSlider("sl-ghosts", "lb-ghosts", v => v, v => CFG.ghosts = v);
    bindSlider("sl-imm-zero", "lb-imm-zero", v => v === 0 ? "never" : (v / 10).toFixed(1),
        v => CFG.immZeroFit = v / 10);
    bindSlider("sl-child-zero", "lb-child-zero", v => v === 0 ? "never" : (v / 10).toFixed(1),
        v => CFG.childZeroFit = v / 10);

    const bindCheck = (id, apply) => {
        const el = $(id);
        if (!el) return;
        el.onchange = () => apply(el.checked);
        apply(el.checked);
    };
    bindCheck("chk-headless", v => CFG.headless = v);
    bindCheck("chk-noise", v => CFG.noise = v);
    bindCheck("chk-random", v => CFG.randomise = v);
    bindCheck("chk-pid", v => CFG.comparePid = v);
    bindCheck("chk-flux", v => CFG.showFlux = v);
    bindCheck("chk-sensors", v => CFG.showSensors = v);
    bindCheck("chk-filaments", v => CFG.showFilaments = v);
    bindCheck("chk-target", v => CFG.showTarget = v);
    bindCheck("chk-ghosts", v => CFG.showGhosts = v);

    // ---- interface mode: changes the network shape, so it restarts ----
    const mb = $("mode-buttons");
    [["full", "Full · 219 → 19", "the TCV contract + temporal inputs"],
     ["trim", "Trimmed · 31 → 5", "vertical stabilisation only"]].forEach(([id, label, desc]) => {
        const b = document.createElement("button");
        b.innerHTML = `<b>${label}</b><small>${desc}</small>`;
        if (id === "full") b.classList.add("on");
        b.onclick = () => {
            if (OBS_MODE_CURRENT() === id) return;
            [...mb.children].forEach(c => c.classList.remove("on"));
            b.classList.add("on");
            setObsMode(id);
            refreshNetSizes();
            onRestart();
            uiLog(`<span class="evt">interface → ${modeSpec().label}, evolution restarted</span>`);
        };
        mb.appendChild(b);
    });

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

    const evalBoxes = [$("chk-eval"), $("intro-eval")].filter(Boolean);
    const setEval = v => { CFG.evalMode = v; evalBoxes.forEach(b => b.checked = v); };
    evalBoxes.forEach(b => b.onchange = () => setEval(b.checked));

    const intro = $("intro");
    const closeIntro = () => intro && intro.classList.add("hidden");
    // ?intro=0 skips the modal — used by the headless screenshot harness, which
    // cannot click anything.
    if (new URLSearchParams(location.search).get("intro") === "0") closeIntro();
    /* The modal is the mode switcher, and it can be reopened. Each choice is a
     * mode, so anything that is not the exhibition has to leave it first —
     * otherwise "evolve from scratch" would start a search whose population is
     * hidden behind the exhibition's own layout. */
    const openIntro = () => intro && intro.classList.remove("hidden");
    if ($("btn-menu")) $("btn-menu").onclick = openIntro;
    if ($("intro-watch")) $("intro-watch").onclick = () => { brainIO.showcase(); closeIntro(); };
    if ($("intro-pid")) $("intro-pid").onclick = () => { brainIO.leaveExhibition(); brainIO.pidOnly(); closeIntro(); };
    if ($("intro-scratch")) $("intro-scratch").onclick = () => { brainIO.leaveExhibition(); onRestart(); closeIntro(); };
    if ($("intro-explore")) $("intro-explore").onclick = closeIntro;
    // Click the backdrop or press Escape to dismiss — a modal you can open from
    // a button needs both.
    if (intro) intro.onclick = (e) => { if (e.target === intro) closeIntro(); };
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && intro && !intro.classList.contains("hidden")) closeIntro();
    });
    UI.setGrace = g => { const sl = $("sl-grace"); if (sl) { sl.value = g; sl.dispatchEvent(new Event("input")); } };
    UI.selectTask = i => {
        const idx = i + 1;   // 0 is the "Curriculum" button
        if (tb.children[idx]) tb.children[idx].click();
    };
}

function OBS_MODE_CURRENT() { return modeSpec().act === 19 ? "full" : "trim"; }

function uiLog(html) {
    const log = $("log");
    const div = document.createElement("div");
    div.innerHTML = html;
    log.prepend(div);
    while (log.children.length > 80) log.lastChild.remove();
}

/* Two lines, shared axis: normalised fitness of the best and mean controller.
 * Both are training scores — the champion figure in the header is the held-out
 * one, and they are not the same number. */
function drawChart(history) {
    const cv = $("chart"), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (history.length < 2) return;
    const vals = history.flatMap(h => [h.best, h.avg]).filter(Number.isFinite);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (!(max > min)) { max = min + 1; }
    const px = i => 4 + (i / (history.length - 1)) * (cv.width - 8);
    const py = v => cv.height - 6 - ((v - min) / (max - min)) * (cv.height - 16);
    // zero line — above it is "better than doing nothing"
    if (min < 0 && max > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.beginPath(); ctx.moveTo(4, py(0)); ctx.lineTo(cv.width - 4, py(0)); ctx.stroke();
    }
    ctx.lineWidth = 1.5;
    for (const [key, color] of [["avg", "#35b6ff"], ["best", "#ffc94d"]]) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        history.forEach((h, i) => i ? ctx.lineTo(px(i), py(h[key])) : ctx.moveTo(px(i), py(h[key])));
        ctx.stroke();
    }
    ctx.fillStyle = "#7d93ab";
    ctx.font = "10px sans-serif";
    ctx.fillText(max.toFixed(2), 4, 10);
    ctx.fillText(min.toFixed(2), 4, cv.height - 2);
}

/* Survival and mean boundary error — the two numbers a plasma physicist would
 * actually ask about. */
function drawChart2(history) {
    const cv = $("chart2"), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (history.length < 2) return;
    const px = i => 4 + (i / (history.length - 1)) * (cv.width - 8);
    const pyS = v => cv.height - 6 - v * (cv.height - 14);
    const errs = history.map(h => h.avgErr || 0);
    const emax = Math.max(0.02, Math.max(...errs));
    const pyE = v => cv.height - 6 - (v / emax) * (cv.height - 14);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#4fe0a8";
    ctx.beginPath();
    history.forEach((h, i) => i ? ctx.lineTo(px(i), pyS(h.avgSurv)) : ctx.moveTo(px(i), pyS(h.avgSurv)));
    ctx.stroke();
    ctx.strokeStyle = "#ff8f6b";
    ctx.beginPath();
    history.forEach((h, i) => i ? ctx.lineTo(px(i), pyE(h.avgErr || 0)) : ctx.moveTo(px(i), pyE(h.avgErr || 0)));
    ctx.stroke();
    ctx.fillStyle = "#7d93ab";
    ctx.font = "10px sans-serif";
    ctx.fillText(`err max ${(emax * 100).toFixed(1)} cm`, 4, 10);
}
