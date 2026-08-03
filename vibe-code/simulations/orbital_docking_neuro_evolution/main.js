/* main.js — the browser page. PLAYBACK ONLY.
 *
 * There is no training here and there are no training controls. This sim is
 * evolved headlessly on many cores (train.js) because a single far-stage
 * rendezvous is a two-hour mission and a generation is several hundred of them;
 * a browser tab is the wrong place for that and the sliders would be a lie
 * about what produced the champion. What the page does is fly a scenario and
 * let you watch it properly.
 *
 * RECORD, THEN PLAY. The episode is simulated to completion the moment you pick
 * it — a few thousand steps, well under a second — and the trajectory is
 * recorded. Playback then interpolates that recording. This is not laziness: the
 * simulation runs on a variable clock that jumps twenty seconds at a time
 * through a coast, which is exactly what you cannot do in a real-time render
 * loop, and having the whole trajectory in hand is what makes the scrubber, the
 * ghost track and instant view changes possible.
 *
 * Attitude is SLERPed and position is LERPed between recorded frames. Recorded
 * body axes could be interpolated component-wise and re-orthonormalised, and it
 * would be wrong in a visible way: a vehicle mid-slew would appear to shrink
 * through the interpolation and pop back.
 */
"use strict";

/* Curated scenarios: one per stage, chosen because they show the thing that
 * stage is about. The seeds are fixed so the page opens on the same flight
 * every time and anything you notice is reproducible. */
/* Every seed here is verified: the scripted autopilot docks it. A showcase
 * scenario the ruler itself fails is a page that opens on a failure, and the
 * seeds are fixed precisely so that cannot drift silently. */
const SHOWCASE = [
    { stage: 0, seed: 201, name: "Terminal approach", blurb: "Station-keeping at a hold point on the corridor axis, at rest. Nothing left but the last decade of range — alignment, closing rate and roll, all six capture limits at once." },
    { stage: 1, seed: 200, name: "Proximity operations", blurb: "A few hundred metres out and pointing the wrong way. It has to slew, acquire the laser, fly around to the approach corridor and only then close." },
    { stage: 2, seed: 200, name: "Near rendezvous", blurb: "Kilometres out, where orbital mechanics starts to bite: a burn toward the station is not a burn toward the station." },
    { stage: 3, seed: 200, name: "Far rendezvous", blurb: "Seventy kilometres of along-track separation. One phasing burn, most of an orbit of doing absolutely nothing, then brake and dock. Watch the clock jump." },
    { stage: 4, seed: 200, name: "Out of plane", blurb: "The same, plus an inclination difference. The cross-track offset oscillates at the orbit rate and can only be removed at a node." },
    { stage: 5, seed: 201, name: "Degraded", blurb: "Station attitude biased, navigation four times noisier, less propellant and a tighter clock." }
];

const SPEEDS = [1, 10, 60, 300, 1200];

const App = {
    renderer: null,
    scenario: null,
    station: null,
    frames: [],
    trail: [],
    result: null,
    t: 0,
    speed: 2,
    playing: true,
    flyer: "brain",
    brain: null,
    sunEci: null,
    trainer: null,
    epoch: 0,
    mode: "watch"
};

/* ------------------------------------------------------------------ setup */
/* BOOT IS SLICED. Generating the Earth's maps is roughly four million
 * fractal-noise evaluations and flying the first rendezvous is a few thousand
 * integration steps -- one or two seconds of blocked main thread between them.
 * Done in a single synchronous pass the page shows nothing at all until it is
 * over, which is indistinguishable from a page that failed to load. Yielding to
 * the browser between steps lets the loading screen actually paint, and gates
 * the intro button until there is something behind it to watch. */
function yieldToBrowser() { return new Promise(r => setTimeout(r, 0)); }

async function boot() {
    const loader = document.getElementById("loader");
    const fill = document.getElementById("load-fill");
    const what = document.getElementById("load-what");
    const step = async (pct, msg) => {
        fill.style.width = pct + "%";
        what.textContent = msg;
        await yieldToBrowser();
    };

    await step(6, "Generating the planet\u2026");
    const canvas = document.getElementById("view");
    App.renderer = new Renderer(canvas);
    window.addEventListener("resize", () => App.renderer.resize());

    await step(58, "Loading the champion\u2026");
    if (typeof window.DEFAULT_BRAIN !== "undefined" && window.DEFAULT_BRAIN &&
        window.DEFAULT_BRAIN.net && window.DEFAULT_BRAIN.nin === NIN) {
        App.brain = Brain.fromJSON(window.DEFAULT_BRAIN.net).calibrate();
        const d = window.DEFAULT_BRAIN;
        document.getElementById("brain-info").textContent =
            "generation " + (d.gen != null ? d.gen : "?") + " \u00b7 stage " +
            (d.stage != null ? d.stage : "?") + " \u00b7 exam docking " +
            (d.dockRate != null ? (d.dockRate * 100).toFixed(0) + "%" : "?");
    } else {
        document.getElementById("brain-info").textContent =
            "no champion baked in \u2014 showing the scripted autopilot";
        App.flyer = "pilot";
        // Move the highlight too. Leaving "Evolved brain" lit while the
        // autopilot flies is the page telling a small lie about what you are
        // watching, right next to the sentence admitting it.
        document.querySelectorAll("[data-flyer]").forEach(b =>
            b.classList.toggle("on", b.dataset.flyer === "pilot"));
        document.querySelector("[data-flyer=\'brain\']").classList.add("dim");
    }

    await step(70, "Auditioning the first scenario\u2026");
    buildMenu();
    wireControls();
    wireTraining();

    await step(84, "Flying it\u2026");
    load(0);

    await step(100, "Ready.");
    loader.hidden = true;
    document.getElementById("intro").hidden = false;

    applyShotParams();
    requestAnimationFrame(loop);
}

/* Deterministic screenshot hook, e.g.
 *     index.html?shot=3&at=0.42&view=cockpit&dist=40&flyer=pilot
 * Jumps straight to a fixed point in a fixed flight, sets the camera and
 * pauses. Headless Chrome cannot drive the UI, and a screenshot taken at
 * whatever moment the render loop happened to reach is not a regression test.
 * `at` is a fraction of the flight; `dist` only applies to the orbit view. */
function applyShotParams() {
    const q = new URLSearchParams(location.search);
    if (!q.has("shot") && !q.has("at")) return;
    if (q.get("mode")) setMode(q.get("mode"));
    const flyer = q.get("flyer");
    if (flyer === "pilot" || (flyer === "brain" && App.brain)) App.flyer = flyer;
    const i = Math.max(0, Math.min(SHOWCASE.length - 1, parseInt(q.get("shot") || "0", 10)));
    document.getElementById("sel-scenario").value = String(i);
    load(i);
    const v = q.get("view");
    if (v) {
        App.renderer.setView(v);
        document.querySelectorAll("[data-view]").forEach(b =>
            b.classList.toggle("on", b.dataset.view === v));
        document.getElementById("drag-hint").hidden = v !== "orbit";
    }
    if (q.has("dist")) App.renderer.orbit.dist = parseFloat(q.get("dist"));
    if (q.has("yaw")) App.renderer.orbit.yaw = parseFloat(q.get("yaw"));
    if (q.has("pitch")) App.renderer.orbit.pitch = parseFloat(q.get("pitch"));
    const T = App.frames.length ? App.frames[App.frames.length - 1].t : 0;
    App.t = Math.max(0, Math.min(1, parseFloat(q.get("at") || "0.98"))) * T;
    App.playing = false;
    document.getElementById("btn-play").textContent = "Play";
    document.getElementById("intro").hidden = true;
    document.getElementById("loader").hidden = true;
    // Diagnostics for --dump-dom: a screenshot can lie, this cannot.
    /* Paint synchronously rather than waiting for the render loop.
     * requestAnimationFrame barely fires under headless Chrome's virtual
     * clock — a screenshot taken this way came back as the intro over an empty
     * canvas about half the time, which is indistinguishable from a broken
     * page. Drawing here makes the shot deterministic. */
    App.renderer.resize();
    drawFrame(App.t);
    const f = sample(App.t);
    const N = App.station.portNormalLvlh();
    document.title = `dock|out=${App.result.outcome}|t=${f.t.toFixed(1)}|R=${f.R.toFixed(2)}` +
        `|nose·(-N)=${(-(f.ax[0] * N[0] + f.ax[1] * N[1] + f.ax[2] * N[2])).toFixed(3)}` +
        `|lidar=${f.lidar}|frames=${App.frames.length}`;
}

function buildMenu() {
    const sel = document.getElementById("sel-scenario");
    SHOWCASE.forEach((s, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = `${s.stage}  ${s.name}`;
        sel.appendChild(o);
    });
}

function wireControls() {
    document.getElementById("sel-scenario").addEventListener("change", (e) => load(+e.target.value));
    document.querySelectorAll("[data-view]").forEach(b => {
        b.addEventListener("click", () => {
            document.querySelectorAll("[data-view]").forEach(x => x.classList.remove("on"));
            b.classList.add("on");
            App.renderer.setView(b.dataset.view);
            document.getElementById("drag-hint").hidden = b.dataset.view !== "orbit";
        });
    });
    // One path for changing who flies, so the button state and App.flyer can
    // never disagree — they did, and the highlight ended up on a brain that
    // was not the one in the air.
    document.querySelectorAll("[data-flyer]").forEach(b => {
        b.addEventListener("click", () => setFlyer(b.dataset.flyer));
    });
    document.getElementById("btn-play").addEventListener("click", () => {
        App.playing = !App.playing;
        document.getElementById("btn-play").textContent = App.playing ? "Pause" : "Play";
    });
    document.getElementById("btn-restart").addEventListener("click", () => { App.t = 0; App.playing = true; });
    const sp = document.getElementById("sl-speed");
    sp.addEventListener("input", () => {
        App.speed = +sp.value;
        document.getElementById("lb-speed").textContent = "×" + SPEEDS[App.speed];
    });
    const sc = document.getElementById("sl-scrub");
    sc.addEventListener("input", () => {
        const T = App.frames.length ? App.frames[App.frames.length - 1].t : 1;
        App.t = (+sc.value / 1000) * T;
    });
    document.querySelectorAll("[data-mode]").forEach(b => {
        b.addEventListener("click", () => setMode(b.dataset.mode));
    });
    document.getElementById("intro-go").addEventListener("click", () => {
        document.getElementById("intro").hidden = true;
        setMode("watch");
        /* Watching the champion means watching the CHAMPION. Opening on the
         * scripted autopilot after the user asked for the evolved brain is the
         * page answering a different question from the one it was asked. */
        // Only reload if it is not already what is loaded — boot has usually
        // done this already and re-flying the episode costs a visible hitch.
        if (App.brain && App.flyer !== "brain") setFlyer("brain");
    });
    document.getElementById("intro-train").addEventListener("click", () => {
        document.getElementById("intro").hidden = true;
        setMode("train");
        startTraining();
    });
}

/* Watch and Evolve are separate panes, not two halves of one long column.
 * The canvas keeps playing whichever flight is loaded in both — what changes is
 * which set of controls is on screen, so no slider is ever visible that does
 * not apply to what you are currently doing. */
function setMode(m) {
    App.mode = m;
    document.querySelectorAll("[data-mode]").forEach(b =>
        b.classList.toggle("on", b.dataset.mode === m));
    document.getElementById("pane-watch").hidden = m !== "watch";
    document.getElementById("pane-watch2").hidden = m !== "watch";
    document.getElementById("pane-train").hidden = m !== "train";
    document.getElementById("panel").scrollTop = 0;
}

/* Select who is flying, and reload so the change is actually on screen. */
function setFlyer(which) {
    if (which === "brain" && !App.brain) return;
    App.flyer = which;
    document.querySelectorAll("[data-flyer]").forEach(b =>
        b.classList.toggle("on", b.dataset.flyer === which));
    load(+document.getElementById("sel-scenario").value);
}

/* ---------------------------------------------------------------- training */
function wireTraining() {
    const bind = (id, lb, fmt) => {
        const el = document.getElementById(id);
        const upd = () => { document.getElementById(lb).textContent = fmt(+el.value); };
        el.addEventListener("input", upd); upd();
        return el;
    };
    bind("sl-pop", "lb-pop", v => String(v));
    bind("sl-bank", "lb-bank", v => String(v));
    bind("sl-stage", "lb-stage", v => v + " \u00b7 " + STAGES[v].label);
    document.getElementById("btn-train").addEventListener("click", () => {
        if (App.trainer) stopTraining(); else startTraining();
    });
    document.getElementById("btn-train-fly").addEventListener("click", () => {
        if (!App.trainer || !App.trainer.best) return;
        App.brain = App.trainer.best.clone();
        document.querySelector("[data-flyer=\'brain\']").classList.remove("dim");
        document.getElementById("brain-info").textContent =
            "your brain \u00b7 generation " + App.trainer.gen + " \u00b7 stage " +
            App.trainer.stage + " \u00b7 bred in this tab";
        // Hand over to Watch: the flight is the thing worth looking at, and the
        // training controls have nothing to say about it.
        setMode("watch");
        setFlyer("brain");
    });
}

function startTraining() {
    App.trainer = new BrowserTrainer({
        pop: +document.getElementById("sl-pop").value,
        bank: +document.getElementById("sl-bank").value,
        stage: +document.getElementById("sl-stage").value
    });
    document.getElementById("btn-train").textContent = "Stop";
    document.getElementById("card-train").classList.add("running");
    ["sl-pop", "sl-bank", "sl-stage"].forEach(i => { document.getElementById(i).disabled = true; });
}

function stopTraining() {
    App.trainer = null;
    document.getElementById("btn-train").textContent = "Start evolving";
    document.getElementById("card-train").classList.remove("running");
    ["sl-pop", "sl-bank", "sl-stage"].forEach(i => { document.getElementById(i).disabled = false; });
    document.getElementById("tr-status").textContent = "stopped";
}

function trainingHud() {
    const T = App.trainer;
    if (!T) return;
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    const h = T.history[T.history.length - 1];
    set("tr-gen", String(T.gen + 1));
    set("tr-best", h ? h.best.toFixed(3) : "\u2014");
    set("tr-avg", h ? h.avg.toFixed(3) : "\u2014");
    set("tr-touch", h ? (h.touch * 100).toFixed(0) + "%" : "\u2014");
    set("tr-saved", T.episodesFull ? (T.saved * 100).toFixed(0) + "% of episodes" : "\u2014");
    set("tr-status", T.status);
    document.getElementById("btn-train-fly").disabled = !T.best;
    drawTrainChart(T.history);
}

/* A sparkline of best and mean advantage. The y-axis is anchored at 0 -- "no
 * better than doing nothing" -- because that is the number the whole scale is
 * built around, and an auto-scaled axis hides whether the population is above
 * it or below it. */
function drawTrainChart(hist) {
    const cv = document.getElementById("tr-chart");
    const g = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    if (hist.length < 2) return;
    let lo = 0, hi = 0.05;
    for (const r of hist) { lo = Math.min(lo, r.avg, r.best); hi = Math.max(hi, r.best); }
    const pad = (hi - lo) * 0.12 + 1e-6;
    lo -= pad; hi += pad;
    const X = i => (i / (hist.length - 1)) * (w - 2) + 1;
    const Y = v => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
    g.strokeStyle = "rgba(125,147,171,0.45)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke();
    // 1.0 is the scripted autopilot, if the population ever gets near it.
    if (hi > 0.6) {
        g.strokeStyle = "rgba(79,224,168,0.4)";
        g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(0, Y(1)); g.lineTo(w, Y(1)); g.stroke();
        g.setLineDash([]);
    }
    const line = (key, col) => {
        g.strokeStyle = col; g.lineWidth = 1.6;
        g.beginPath();
        hist.forEach((r, i) => { i ? g.lineTo(X(i), Y(r[key])) : g.moveTo(X(i), Y(r[key])); });
        g.stroke();
    };
    line("avg", "#7d93ab");
    line("best", "#35b6ff");
}

/* ------------------------------------------------------------------- load */
function load(i) {
    const s = SHOWCASE[i];
    document.getElementById("sc-blurb").textContent = s.blurb;
    const sc = makeScenario(s.stage, s.seed);
    App.scenario = sc;
    App.station = new Station(sc.station);

    // Calibrate so the advantage figure means something. Two extra episodes,
    // a couple of hundred milliseconds, and it is the number that says whether
    // what you are about to watch beat a competent scripted pilot.
    calibrate(sc);

    const agent = App.flyer === "pilot" ? new Pilot(sc, new Station(sc.station)) : App.brain;
    const w = new World(sc, agent, { record: true, recordEvery: 0.5, noiseSeed: 4242 });
    let guard = 0;
    while (!w.isOver() && guard++ < 400000) w.step();
    App.result = w.result();
    App.frames = App.result.frames || [];
    App.trail = App.frames.map(f => f.p);
    App.t = 0;
    App.playing = true;
    document.getElementById("btn-play").textContent = "Pause";

    // A fixed inertial Sun direction, chosen off the orbit normal so the
    // terminator actually crosses the scene rather than sitting behind it.
    const k = keplerToCartesian(sc.el);
    const h = V.unit(V.cross(k.r, k.v));
    const a = V.unit(V.cross(h, [0, 0, 1]));
    App.sunEci = V.unit(V.add(V.mul(a, 0.94), V.mul(h, 0.34)));
    // A fixed pseudo-epoch so the Earth's own rotation starts somewhere
    // different for each scenario rather than always at the same meridian.
    App.epoch = (sc.seed % 86400) * 43.0;

    App.renderer.setTrail(App.trail, 2);
    fillSummary();
}

function fillSummary() {
    const r = App.result, sc = App.scenario;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const OUT = {
        docked: "DOCKED", contact: "contact — outside the envelope", collision: "struck the structure",
        flyby: "flew past", receded: "backed away", overspeed: "approach envelope exceeded",
        tumble: "tumbling", dry: "propellant exhausted", timeout: "ran out of clock"
    };
    set("sum-outcome", OUT[r.outcome] || r.outcome);
    document.getElementById("sum-outcome").className = r.outcome === "docked" ? "good" : (r.outcome === "contact" ? "warn" : "bad");
    set("sum-time", fmtClock(r.t));
    set("sum-dv", r.dv.toFixed(2) + " m/s");
    set("sum-fuel", (r.fuelFrac * 100).toFixed(0) + "%");
    set("sum-r0", fmtRange(sc.R0));
    set("sum-adv", r.advantage.toFixed(2) + "×");
    set("sum-pilot", (sc.pilotDocked ? "docks in " + fmtClock(sc.pilotT) + ", " + sc.pilotDv.toFixed(1) + " m/s" : "fails"));
    set("sum-burns", r.burnTime.toFixed(0) + " s thrusting · " + r.coasts + " coasts · " +
        fmtClock(r.coastTotal) + " coasting");

    const cap = document.getElementById("capture-table");
    cap.innerHTML = "";
    if (r.capture) {
        const p = App.station.port;
        const rows = [
            ["lateral offset", r.capture.lateral, p.latOffset, "m", 3],
            ["lateral rate", r.capture.vLateral, p.latRate, "m/s", 3],
            ["closing rate", r.capture.vAxial, p.axialMax, "m/s", 3],
            ["misalignment", r.capture.angle * 57.2958, p.angle * 57.2958, "°", 2],
            ["roll error", r.capture.roll * 57.2958, p.roll * 57.2958, "°", 2],
            ["relative rate", r.capture.rate * 57.2958, p.rate * 57.2958, "°/s", 3]
        ];
        const keys = ["lateral", "latRate", "speed", "angle", "roll", "rate"];
        rows.forEach((row, i) => {
            const ok = r.capture.ok[keys[i]];
            const d = document.createElement("div");
            d.className = "cap-row " + (ok ? "ok" : "no");
            d.innerHTML = `<span>${row[0]}</span><b>${row[1].toFixed(row[4])}</b>` +
                `<i>${keys[i] === "speed" ? p.axialMin.toFixed(2) + "–" : "≤ "}${row[2].toFixed(row[4])} ${row[3]}</i>`;
            cap.appendChild(d);
        });
    } else {
        cap.innerHTML = '<p class="hint">The vehicle never reached the docking ring, so there is nothing to grade.</p>';
    }
}

/* -------------------------------------------------------------- playback */
function sample(t) {
    const F = App.frames;
    if (!F.length) return null;
    if (t <= F[0].t) return frameAt(F[0], F[0], 0);
    if (t >= F[F.length - 1].t) return frameAt(F[F.length - 1], F[F.length - 1], 0);
    let lo = 0, hi = F.length - 1;
    while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (F[m].t <= t) lo = m; else hi = m;
    }
    const a = F[lo], b = F[hi];
    const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
    return frameAt(a, b, u);
}

function frameAt(a, b, u) {
    const lerp3 = (p, q) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
    const rs = lerp3(a.rs, b.rs), vs = lerp3(a.vsv, b.vsv);
    const q = slerp(a.q, b.q, u);
    const B = lvlhBasis(rs, vs);
    const ax = Q.axes(q);
    return {
        t: a.t + (b.t - a.t) * u,
        p: lerp3(a.p, b.p), v: lerp3(a.v, b.v),
        ax: toLvlh(ax.x, B), ay: toLvlh(ax.y, B), az: toLvlh(ax.z, B),
        // Thruster duties are NOT interpolated. A pulse is a discrete event,
        // and blending between "firing" and "not firing" invents a half-open
        // thruster that the vehicle does not have.
        f: a.f, fr: a.fr,
        R: a.R + (b.R - a.R) * u, cl: a.cl + (b.cl - a.cl) * u,
        fuel: a.fuel + (b.fuel - a.fuel) * u, dv: a.dv + (b.dv - a.dv) * u,
        coast: a.coast, lidar: a.lidar,
        rs, vs, B
    };
}

function slerp(a, b, u) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (d < 0) { bb = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
    if (d > 0.9995) return Q.norm([
        a[0] + (bb[0] - a[0]) * u, a[1] + (bb[1] - a[1]) * u,
        a[2] + (bb[2] - a[2]) * u, a[3] + (bb[3] - a[3]) * u]);
    const th = Math.acos(d), s = Math.sin(th);
    const w1 = Math.sin((1 - u) * th) / s, w2 = Math.sin(u * th) / s;
    return [a[0] * w1 + bb[0] * w2, a[1] * w1 + bb[1] * w2,
    a[2] * w1 + bb[2] * w2, a[3] * w1 + bb[3] * w2];
}

let lastMs = 0;
function loop(ms) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (ms - lastMs) / 1000 || 0);
    lastMs = ms;
    App.renderer.resize();
    if (!App.frames.length) return;
    const T = App.frames[App.frames.length - 1].t;
    if (App.playing) {
        App.t += dt * SPEEDS[App.speed];
        if (App.t >= T) { App.t = T; App.playing = false; document.getElementById("btn-play").textContent = "Play"; }
    }
    drawFrame(App.t, T);

    /* Give the trainer whatever is left of this frame. Twelve milliseconds
     * keeps playback at a steady 60 fps while still getting through a few
     * episodes a second -- the point is to watch it work, not to race it. */
    if (App.trainer) { App.trainer.tick(12); trainingHud(); }
}

/* One frame, drawn now. Shared by the render loop and the screenshot hook. */
function drawFrame(t, T) {
    const f = sample(t);
    if (!f) return;
    if (T == null) T = App.frames[App.frames.length - 1].t;

    // How far along the recording we are, for the trail.
    let idx = 0;
    while (idx < App.frames.length - 1 && App.frames[idx].t < t) idx++;
    App.renderer.setTrail(App.trail, Math.max(2, idx));

    App.renderer.draw(f, {
        station: App.station,
        sunDir: toLvlh(App.sunEci, f.B),
        earthDist: V.len(f.rs) / 1000,
        // The LVLH basis and the absolute epoch: render.js needs both to
        // orient the planet, so that the ground streams past at orbital rate
        // instead of the scene looking like a hover. See earth.js.
        B: f.B,
        tAbs: App.epoch + f.t
    });
    hud(f, T);
}

function hud(f, T) {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set("hud-clock", fmtClock(f.t));
    set("hud-range", fmtRange(f.R));
    set("hud-closing", (f.cl >= 0 ? "+" : "") + f.cl.toFixed(f.R < 100 ? 3 : 2) + " m/s");
    set("hud-fuel", (f.fuel * 100).toFixed(0) + "%");
    set("hud-dv", f.dv.toFixed(2) + " m/s");
    set("hud-lidar", f.lidar > 0 ? `${f.lidar}/5 returns` : "no lock");

    // Alignment, computed the way the capture test computes it.
    const N = App.station.portNormalLvlh();
    const ang = Math.acos(Math.max(-1, Math.min(1, -(f.ax[0] * N[0] + f.ax[1] * N[1] + f.ax[2] * N[2]))));
    set("hud-align", (ang * 57.2958).toFixed(1) + "°");

    const P = App.station.portPosLvlh();
    const d = [f.p[0] - P[0], f.p[1] - P[1], f.p[2] - P[2]];
    const axl = d[0] * N[0] + d[1] * N[1] + d[2] * N[2];
    const lat = Math.hypot(d[0] - N[0] * axl, d[1] - N[1] * axl, d[2] - N[2] * axl);
    set("hud-lateral", fmtRange(lat));

    document.getElementById("badge-coast").hidden = !f.coast;
    document.getElementById("badge-burn").hidden = !(f.f.some(x => x > 0) || f.fr.some(x => Math.abs(x) > 0));
    document.getElementById("sl-scrub").value = String(Math.round(1000 * f.t / Math.max(T, 1e-9)));
    set("lb-lvlh", `V-bar ${fmtSigned(f.p[0])} · H-bar ${fmtSigned(f.p[1])} · R-bar ${fmtSigned(f.p[2])}`);
}

/* -------------------------------------------------------------- helpers */
function fmtClock(s) {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), q = Math.floor(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(q).padStart(2, "0")}`
        : `${m}:${String(q).padStart(2, "0")}`;
}
function fmtRange(m) {
    if (m >= 10000) return (m / 1000).toFixed(1) + " km";
    if (m >= 1000) return (m / 1000).toFixed(2) + " km";
    if (m >= 10) return m.toFixed(0) + " m";
    if (m >= 1) return m.toFixed(2) + " m";
    return (m * 100).toFixed(0) + " cm";
}
function fmtSigned(m) {
    const s = m >= 0 ? "+" : "−";
    return s + fmtRange(Math.abs(m));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
