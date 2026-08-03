/* ui.js — panel wiring. Every knob lives in CFG; main.js reads it each frame. */
"use strict";

const CFG = {
    popSize: 40,
    episodes: 2,
    mutRate: MUT_DEFAULT.rate,     // measured: at 0.10/0.15 not one child in 24
    mutSigma: MUT_DEFAULT.sigma,   // survives. See the table in evolution.js.
    gracePeriod: 3,
    immZeroFit: 6000,
    childZeroFit: 15000,
    /* ---- rise trials ----
     * Every Nth generation the whole fleet becomes minor variations of the elite,
     * starts on the floor in `risePose`, and is ranked on MEAN COM HEIGHT alone
     * rather than on the fitness ledger. The winners seed the next generation, so
     * the pressure reaches the lineage; but the trial never updates the champion,
     * never advances the stage and never enters the history the plateau detector
     * reads, because its numbers are metres and the ledger's are not.
     *
     * 0 = off. 10 means one trial generation in ten, which is the ratio that
     * keeps it a nudge: one generation of rise-only selection on near-clones of
     * the elite cannot trade away walking, because nothing in the pool is far
     * enough from the elite to trade it for. */
    riseEvery: 0,
    risePose: "prone",
    /* "Watch the champion" starts every episode in one of the fourteen pool
     * poses — quadruped, side plank, kneeling, warrior, side-sit and the rest —
     * instead of the usual crouch. ON, because watching a brain meet them is the
     * reason the poses exist and a console incantation is not a discoverable
     * answer to a button.
     *
     * The cost, stated plainly: the score it reports is then NOT comparable to
     * the headline number, because the held-out exam runs with no floor starts at
     * all. Set false for the old showcase, which matches the exam's conditions. */
    // showcasePoses is GONE. It pinned the spawn to a floor pose while the pose
    // picker separately believed it was in charge, so "Standing" did nothing.
    // watchPose below is now the only control over the watch-mode spawn.
    /* Which pose watch mode starts from. "" = the ordinary standing spawn,
     * "random" = draw one the way training does, anything else = the name of a
     * pose in model.startPoses (or "crouch"/"seat") pinned every episode.
     * Pinning is what makes two attempts at the same problem comparable — with a
     * random draw you are never watching the same question twice. */
    /* "" — the training default, which is M.crouch: a half-squat at 0.764 m hip
     * height against 0.900 standing, with the episode's first phase being to push
     * out of it. This is the spawn the brain was actually bred from, so watching
     * it is watching the thing that was trained rather than a pose it only ever
     * meets in a demo.
     *
     * It is NOT the calm stand and not "random" — random drew from the fourteen
     * floor poses, so the page used to open on the walker lying in a side plank
     * failing to get up, which reads as a broken robot rather than as the
     * unsolved problem it is. Both are still one click away in the picker. */
    watchPose: "",
    /* Which curriculum stage watch mode replays on. 0 = take it from the brain,
     * which records the stage its run had reached. Overridable from the panel
     * because a brain baked before the stage was carried has none to report. */
    watchStage: 0,
    stageLock: 0,          // 0 = let the population decide
    terrainDiff: 0,        // 0 = auto (ramps with generations spent on rough ground)
    // Rolling — long, gentle undulation, up to ~9 deg at full difficulty. The
    // gait is readable on it: the ground moves enough to show the walker coping
    // without a staircase interrupting every few metres.
    terrainId: "rolling",
    headless: false,
    ghosts: 10,
    showWaypoints: true,
    showCom: true,
    showSensors: false,
    record: false,
    noise: true,
    speed: 1,              // physics-time multiplier; 0 = MAX
    paused: false,
    evalMode: false
};

const UI = {};
function $(id) { return document.getElementById(id); }

const STAGE_LABELS = [
    { n: 1, tag: "stand", desc: "Flat ground, no disturbance. Rise out of the squat and hold full height." },
    { n: 2, tag: "balance", desc: "Same ground, but the fleet takes identical shoves at identical instants." },
    { n: 3, tag: "walk", desc: "Waypoint courses that turn. Reaching one buys more time on the clock." },
    { n: 4, tag: "terrain", desc: "The ground starts to tilt and step, ramping to full difficulty over ~150 generations." },
    { n: 5, tag: "wind", desc: "Gusting crosswind on the torso, on top of everything else." }
];

function initUI(handlers) {
    // ---- curriculum track ----
    const track = $("stage-track");
    STAGE_LABELS.forEach(s => {
        const d = document.createElement("div");
        d.className = "stage-pip";
        d.innerHTML = `<b>${s.n}</b>${s.tag}`;
        d.title = s.desc;
        track.appendChild(d);
    });
    UI.setStage = (stage, terrainDiff) => {
        [...track.children].forEach((c, i) => {
            c.classList.toggle("on", i + 1 === stage);
            c.classList.toggle("done", i + 1 < stage);
        });
        const s = STAGE_LABELS[stage - 1];
        $("stage-desc").textContent = s ? s.desc : "";
        $("stat-stage").textContent = `stage ${stage} · ${s ? s.tag : ""}` +
            (stage >= 4 && terrainDiff != null ? ` · ${(terrainDiff * 100) | 0}%` : "");
    };

    // ---- terrain buttons ----
    /* Flat is built but hidden while training, and shown in watch mode. Training
     * on the flat is the mistake this project already made once — a fleet that
     * scored 6.75 waypoints on level ground and 0.83 on terrain — so it must not
     * be one click away from a training run. Watching is a different activity:
     * level ground is the only place a gait can be read without the terrain
     * confounding what you are looking at. */
    const tb = $("terrain-buttons");
    TERRAIN_DEFS.forEach((def, i) => {
        const b = document.createElement("button");
        b.innerHTML = `<b>${def.name}</b><small>${def.desc}</small>`;
        if (def.id === "flat") b.classList.add("watch-only");
        b.onclick = () => {
            CFG.terrainId = def.id;
            [...tb.children].forEach(c => c.classList.remove("on"));
            b.classList.add("on");
            // While training, the new ground waits for the next episode so a
            // generation is never scored across two different worlds. While
            // watching the champion nothing is being scored, and waiting up to
            // twenty seconds to see the stairs you just clicked is only friction.
            if (handlers.onTerrain) handlers.onTerrain();
        };
        if (def.id === CFG.terrainId) b.classList.add("on");
        tb.appendChild(b);
    });

    // ---- speed ----
    const speeds = [[0.25, "¼×"], [1, "1×"], [3, "3×"], [8, "8×"], [0, "MAX"]];
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

    /* Dark environment. The preference outlives the tab, because someone who
     * turned the lights down for a long run does not want them back on at every
     * reload. localStorage can throw outright under a file:// origin with
     * storage disabled, so the whole thing is best-effort and a failure to
     * remember must never stop the button working. */
    const themeBtn = $("btn-theme");
    if (themeBtn) {
        const applyTheme = name => {
            const active = (typeof renderer !== "undefined" && renderer)
                ? renderer.setTheme(name) : name;
            document.body.classList.toggle("theme-dark", active === "dark");
            themeBtn.textContent = active === "dark" ? "Light" : "Dark";
            themeBtn.setAttribute("aria-pressed", active === "dark" ? "true" : "false");
            return active;
        };
        let saved = null;
        try { saved = localStorage.getItem("walk3d.theme"); } catch (e) { /* no storage */ }
        // The renderer may not exist yet on first paint; remember the choice and
        // let main.js apply it once the scene is built.
        window.__walk3dTheme = saved === "dark" ? "dark" : "light";
        if (saved === "dark") applyTheme("dark");
        themeBtn.onclick = () => {
            const next = themeBtn.getAttribute("aria-pressed") === "true" ? "light" : "dark";
            window.__walk3dTheme = applyTheme(next);
            try { localStorage.setItem("walk3d.theme", window.__walk3dTheme); } catch (e) { /* no storage */ }
        };
    }

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
    const kfit = v => v === 0 ? "never" : (v / 1000) + "k";
    bindSlider("sl-imm-zero", "lb-imm-zero", kfit, v => CFG.immZeroFit = v);
    bindSlider("sl-child-zero", "lb-child-zero", kfit, v => CFG.childZeroFit = v);
    bindSlider("sl-stagelock", "lb-stagelock", v => v === 0 ? "auto" : v, v => CFG.stageLock = v);
    bindSlider("sl-terrdiff", "lb-terrdiff", v => v === 0 ? "auto" : v + "%", v => CFG.terrainDiff = v / 100);
    bindSlider("sl-ghosts", "lb-ghosts", v => v, v => CFG.ghosts = v);

    const bindCheck = (id, apply) => {
        const el = $(id);
        el.onchange = () => apply(el.checked);
        apply(el.checked);
    };
    bindCheck("chk-headless", v => CFG.headless = v);
    bindCheck("chk-waypoints", v => CFG.showWaypoints = v);
    bindCheck("chk-com", v => CFG.showCom = v);
    bindCheck("chk-noise", v => CFG.noise = v);
    bindCheck("chk-record", v => { CFG.record = v; recordArm(v); });
    $("btn-incident").onclick = saveIncident;
    bindCheck("chk-sensors", v => {
        CFG.showSensors = v;
        $("sensor-card").hidden = !v;
    });

    $("btn-restart").onclick = handlers.onRestart;
    $("btn-save").onclick = handlers.save;
    $("btn-load").onclick = handlers.load;
    $("btn-export").onclick = handlers.exportFile;
    $("btn-default").onclick = handlers.loadDefault;
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

    const evalBoxes = [$("chk-eval"), $("intro-eval")].filter(Boolean);
    const setEval = v => {
        CFG.evalMode = v;
        evalBoxes.forEach(b => b.checked = v);
        document.body.classList.toggle("eval-on", v);
    };
    evalBoxes.forEach(b => b.onchange = () => setEval(b.checked));
    UI.setEval = setEval;

    /* Rise trials. The checkbox writes CFG, but the Evolution reads riseEvery at
     * CONSTRUCTION, so a mid-run toggle also has to reach the live instance or the
     * box would say "on" while nothing changed — the same two-controls-disagreeing
     * bug that made the watch-mode pose picker do nothing. */
    const riseBox = $("chk-rise");
    if (riseBox) {
        riseBox.onchange = () => {
            CFG.riseEvery = riseBox.checked ? 10 : 0;
            if (typeof evo !== "undefined" && evo) {
                evo.riseEvery = CFG.riseEvery;
                evo.risePose = CFG.risePose;
            }
        };
    }
    /* Watching the champion is a viewing mode. Eval goes on — the whole premise
     * is that the brain on screen is the one you asked for, and without it
     * mutation turns the demo into a fresh evolution run after one generation —
     * and the controls that only matter while breeding get out of the way. */
    UI.setShowcase = on => {
        document.body.classList.toggle("showcase-mode", on);
        if (on) setEval(true);
    };

    /* ---- watch mode: which pose to start from ----
     * Built from the model rather than a written-out list, so a pose added to
     * body.js appears here without a second edit — the same reason the channel
     * table is derived from NJ. */
    const ps = $("pose-select");
    if (ps) {
        /* Named for what they actually are. "Standing" used to mean the training
         * default, which is a half-squat the walker must push out of — it looked
         * unstable and was reported as one. The two are now separate entries and
         * both say so. */
        const opts = [["random", "Random each time"],
                      ["stand", "Standing tall (calm)"],
                      ["", "Half-squat (training default)"],
                      ["crouch", "Deep crouch"], ["seat", "Seated"]];
        for (const p of (HUMANOID.startPoses || [])) opts.push([p.name, p.name]);
        ps.innerHTML = opts.map(([v, l]) =>
            `<option value="${v}"${v === CFG.watchPose ? " selected" : ""}>${l}</option>`).join("");
        ps.onchange = () => {
            CFG.watchPose = ps.value;
            if (handlers.onTerrain) handlers.onTerrain();   // restart so it takes effect now
        };
    }
    /* ---- watch mode: which stage to replay on ----
     * Labelled with what each stage actually does to the walker, because "stage
     * 4" means nothing on its own and the difference between 2 and 4 here is
     * 2.5x the shove plus a wind stage 2 never sees. */
    const ss = $("stage-select");
    if (ss) {
        ss.innerHTML = STAGE_LABELS.map(s =>
            `<option value="${s.n}">${s.n} · ${s.tag}</option>`).join("");
        ss.onchange = () => {
            CFG.watchStage = +ss.value;
            CFG.stageLock = CFG.watchStage;
            CFG.terrainDiff = CFG.watchStage >= 4 ? 1 : 0;
            if (handlers.onTerrain) handlers.onTerrain();
        };
    }
    /* Called by main.js once the brain's own stage is known, so the control shows
     * what is actually being replayed rather than a default nobody chose. */
    UI.setWatchStage = n => { if (ss) ss.value = String(n); };

    const rb = $("btn-respawn");
    if (rb) rb.onclick = () => { if (handlers.onTerrain) handlers.onTerrain(); };
    const rlb = $("btn-reload-brain");
    if (rlb) rlb.onclick = () => { if (handlers.onReloadBrain) handlers.onReloadBrain(); };
    UI.setBrainId = id => { const e = $("stat-brain"); if (e) e.textContent = id || "–"; };

    const intro = $("intro");
    const closeIntro = () => intro && intro.classList.add("hidden");
    // ?nointro skips the modal — handy for screenshots and for linking straight
    // into a running population.
    if (/[?&]nointro/.test(location.search)) closeIntro();
    $("intro-watch").onclick = () => { handlers.showcase(); closeIntro(); };
    $("intro-scratch").onclick = () => { handlers.onRestart(); closeIntro(); };
    $("intro-explore").onclick = closeIntro;
    UI.setGrace = g => { const sl = $("sl-grace"); if (sl) { sl.value = g; sl.dispatchEvent(new Event("input")); } };

    $("brain-shape").textContent =
        `Export gives the raw weight matrices — the same ${NET_SIZES[0]}-in / ${NET_SIZES[NET_SIZES.length - 1]}-out ` +
        `contract a real controller would use (${NC} channels with per-channel history, ` +
        `${NET_SIZES.reduce((a, n, i) => i ? a + NET_SIZES[i - 1] * n + n : 0, 0).toLocaleString()} weights).`;
}

/* ------------------------------------------------------- incident recorder
 * A ring of the last REC.span seconds of the WHOLE FLEET, dumped on demand.
 *
 * The fleet, not the leader: a walker that gets thrown across the map is very
 * often not the one the camera is following, and by the time you have seen it
 * happen it is over. A ring means the button is pressed AFTER the event, which
 * is the only order a human can actually manage.
 *
 * The dump carries the episode's seeds. That is the point of it — World is
 * deterministic in (missionSeed, noiseSeed, terrainId, stage, difficulty, fleet
 * size), so the seeds alone are enough to replay the incident headlessly and
 * instrument it as heavily as wanted, which no amount of recorded telemetry
 * would allow. The series is here to say WHICH walker and WHEN, not to be the
 * evidence itself.
 *
 * Peak contact force is read out of `ptForce`, which the contact solver already
 * fills every tick, so recording costs a scan and no physics. */
const REC = {
    span: 10,            // seconds retained
    every: 2,            // sample every 2nd physics tick -> 250 Hz
    tick: 0, head: 0, full: false, seq: 0,
    rows: [], metas: []
};

/* Arming drops the samples but KEEPS the episode metas and the sequence number.
 * The recorder is switched on in the middle of an episode — that is what the
 * button is for — and the meta for the episode already in flight was registered
 * before that. Resetting the sequence orphaned exactly the samples the user was
 * trying to capture, so the very first segment came back "seeds unknown". */
function recordArm(on) {
    REC.rows.length = 0;
    REC.head = 0; REC.tick = 0; REC.full = false;
    const b = $("btn-incident");
    if (b) b.disabled = !on;
}

/* One meta per episode, not one per dump. Ten seconds is longer than a failed
 * episode lasts, so the ring routinely spans two or three of them — and each
 * episode has its own seeds and its own clock restarting at zero. Recording only
 * the newest meta meant an event from an earlier episode came back labelled with
 * the wrong seeds, and the replay landed somewhere else entirely. Found exactly
 * that way, on the first real capture. */
function recordEpisode(meta) {
    REC.metas.push(Object.assign({ seq: ++REC.seq }, meta));
    while (REC.metas.length > 8) REC.metas.shift();
}

/* A cheap fingerprint of the weights, so a dump can never be replayed against
 * the wrong brain. The first real capture was replayed against a champion baked
 * AFTER it was recorded, and came back "MISMATCH" for a reason that had nothing
 * to do with the incident. Shape alone does not identify a brain — every
 * champion this project produces is 364-48-32-33. */
function netFingerprint(net) {
    if (!net || !net.weights) return null;
    let h = 2166136261;
    for (const w of net.weights) {
        for (let i = 0; i < w.length; i += 97) {          // sampled: identity, not integrity
            h ^= Math.round(w[i] * 1e6) | 0;
            h = Math.imul(h, 16777619);
        }
    }
    return (h >>> 0).toString(16);
}

function recordTick(world) {
    if (REC.tick++ % REC.every) return;
    const ws = world.walkers, n = ws.length;
    const cap = Math.round(REC.span * (1 / DT) / REC.every);
    const width = 2 + n * 4;
    let row = REC.full ? REC.rows[REC.head] : (REC.rows[REC.head] = new Float32Array(width));
    if (row.length !== width) row = REC.rows[REC.head] = new Float32Array(width);
    row[0] = world.time;
    row[1] = REC.seq;                        // which episode this sample belongs to
    for (let i = 0; i < n; i++) {
        const w = ws[i], mb = w.mb;
        let f = 0;
        for (let j = 0; j < w.ptForce.length; j++) if (w.ptForce[j] > f) f = w.ptForce[j];
        row[2 + i * 4] = Math.hypot(mb.qd[3], mb.qd[4], mb.qd[5]);   // linear speed
        row[3 + i * 4] = Math.hypot(mb.qd[0], mb.qd[1], mb.qd[2]);   // spin
        row[4 + i * 4] = f;                                          // peak point force
        row[5 + i * 4] = mb.bp[1];                                   // pelvis height
    }
    REC.head++;
    if (REC.head >= cap) { REC.head = 0; REC.full = true; }
}

function saveIncident() {
    const n = REC.full ? REC.rows.length : REC.head;
    if (!n) return uiLog("nothing recorded yet — tick the recorder on first");
    // unwrap the ring into chronological order
    const out = [];
    for (let k = 0; k < n; k++) {
        const r = REC.rows[REC.full ? (REC.head + k) % n : k];
        out.push(Array.from(r, v => Math.round(v * 1000) / 1000));
    }
    const blob = new Blob([JSON.stringify({
        note: "walk3d incident. cols = [t, episodeSeq, then per walker: speed, spin, peakPointForce, pelvisY]",
        version: 2, metas: REC.metas, hz: (1 / DT) / REC.every,
        walkers: (out[0].length - 2) / 4, rows: out
    })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `walk3d_incident_${Math.round(out[out.length - 1][0] * 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    uiLog(`incident saved — ${out.length} samples, ${(out.length / ((1 / DT) / REC.every)).toFixed(1)} s`);
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

/* ------------------------------------------------------ what the brain sees
 * The terrain channels, read straight out of the leader's own history buffer
 * rather than re-sampled from the terrain. That distinction matters: sense()
 * point-samples on a heading-relative lattice against a specific datum and then
 * clamps, and a recomputation here would drift from it the first time either
 * side changed. What is drawn is the row the net was handed.
 *
 * Two blocks, two reference heights, so they are two plots:
 *   ring    36 points at 0.35 / 0.65 / 1.00 m — (h - ground under the pelvis)/0.3
 *   patch   5x5 per foot — (h - the LOWER of the two soles)/0.5. The shared
 *           datum is the point: it is what lets the pair of patches say "that
 *           foot is up on a step" rather than each reporting itself flat.
 * Both are differences about zero, so the scale is diverging with a neutral
 * midpoint — warm above the reference, cool below, grey at it. The ring is drawn
 * as the 36 discrete points it really is, not as filled wedges: nothing is
 * sampled between them, and a wedge would claim coverage the brain never had. */
const SENSE_LOW = [56, 122, 192], SENSE_MID = [92, 102, 116], SENSE_HIGH = [228, 146, 48];

function senseColor(t) {
    const k = Math.max(-1, Math.min(1, t)), m = Math.abs(k);
    const a = k < 0 ? SENSE_LOW : SENSE_HIGH;
    const mix = i => Math.round(SENSE_MID[i] + (a[i] - SENSE_MID[i]) * m);
    return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

function drawSensors(w) {
    const cv = $("sensors");
    if (!cv || !w || !w.histBuf) return;
    const ctx = cv.getContext("2d"), W = cv.width;
    ctx.clearRect(0, 0, W, cv.height);
    // the row sense() finished last; histWrite has already advanced past it
    const row = w.histBuf[(w.histWrite - 1 + MAXHIST) % MAXHIST];
    if (!row) return;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";

    // ---- the 360-degree ring ----
    const cx = W / 2, cy = 74, SC = 56;              // 1.00 m -> 56 px
    ctx.strokeStyle = "#26374d";
    ctx.lineWidth = 1;
    for (const d of RING_R) { ctx.beginPath(); ctx.arc(cx, cy, d * SC, 0, Math.PI * 2); ctx.stroke(); }
    /* The doll at the centre, facing up the panel. This is a top-down map of the
     * heading frame, so panel-left is the doll's left — which is the sign
     * convention sense() uses for the ring index (0 ahead, increasing to its
     * left) and for the patch's lateral offsets. */
    ctx.fillStyle = "#7d93ab";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 9); ctx.lineTo(cx - 5, cy + 5); ctx.lineTo(cx + 5, cy + 5);
    ctx.closePath(); ctx.fill();
    for (let r = 0; r < RING_R.length; r++) {
        const d = RING_R[r] * SC, b = C_TERRAIN + r * RING_DIRS;
        for (let k = 0; k < RING_DIRS; k++) {
            const a = k * 2 * Math.PI / RING_DIRS;
            ctx.fillStyle = senseColor(row[b + k] / 1.5);
            ctx.beginPath();
            ctx.arc(cx - Math.sin(a) * d, cy - Math.cos(a) * d, 4.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.fillStyle = "#7d93ab";
    ctx.fillText("ring · ±45 cm about the ground under the pelvis", cx, cy + SC + 18);

    // ---- the two foveal foot patches ----
    if (PATCH_CHANNELS) {
        const CELL = 13, SIZE = CELL * PATCH_N, x0 = [cx - 20 - SIZE, cx + 20], y0 = 174;
        ctx.fillText("left foot", x0[0] + SIZE / 2, y0 - 8);
        ctx.fillText("right foot", x0[1] + SIZE / 2, y0 - 8);
        for (let s = 0; s < 2; s++) {
            const b = C_PATCH + s * PATCH_CELLS;
            for (let r = 0; r < PATCH_N; r++) {
                for (let c = 0; c < PATCH_N; c++) {
                    // r indexes the FORWARD offset and c the doll's LEFT, so on a
                    // panel drawn forward-up the last row is the top edge and the
                    // last column is the left one.
                    ctx.fillStyle = senseColor(row[b + r * PATCH_N + c]);
                    ctx.fillRect(x0[s] + (PATCH_N - 1 - c) * CELL + 1,
                                 y0 + (PATCH_N - 1 - r) * CELL + 1, CELL - 2, CELL - 2);
                }
            }
        }
    }

    // ---- the scale, so the colours mean a number ----
    const bw = 110, bx = cx - bw / 2, by = 250;
    for (let i = 0; i < bw; i++) {
        ctx.fillStyle = senseColor((i / (bw - 1)) * 2 - 1);
        ctx.fillRect(bx + i, by, 1, 8);
    }
    ctx.fillStyle = "#7d93ab";
    ctx.textAlign = "right"; ctx.fillText("below", bx - 6, by + 8);
    ctx.textAlign = "left"; ctx.fillText("above", bx + bw + 6, by + 8);
    ctx.textAlign = "center";
}

/* The curriculum in one picture: what fraction of the fleet can stand, what
 * fraction can hold it, and how many waypoints the mean walker reaches. */
function drawSkillChart(history) {
    const cv = $("chart2"), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (history.length < 2) return;
    const maxArr = Math.max(1, ...history.map(h => h.avgArr || 0));
    const px = i => 4 + (i / (history.length - 1)) * (cv.width - 8);
    const py = v => cv.height - 6 - v * (cv.height - 14);
    ctx.lineWidth = 1.5;
    const series = [
        ["stoodFrac", "#4fe0a8", 1],
        ["balancedFrac", "#35b6ff", 1],
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
    ctx.globalAlpha = 0.5;
    history.forEach((h, i) => {
        ctx.fillStyle = ["#1f3450", "#245070", "#2b6a8c", "#3a8a6a", "#8a7a2b"][(h.stage || 1) - 1];
        ctx.fillRect(px(i), cv.height - 4, Math.max(1, (cv.width - 8) / history.length + 1), 4);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#7d93ab";
    ctx.font = "10px sans-serif";
    ctx.fillText("100% / " + maxArr.toFixed(1) + " wp", 4, 10);
}
