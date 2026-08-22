/* viewer.js — the browser front end. Playback only: training happens offline in
 * train.js and the winning weights are baked into champion.js.
 *
 * The simulation running here is the SAME code the trainer ran — drone4d.js,
 * room4d.js and world4d.js are loaded unmodified by both — so what you are
 * watching is the episode, not an animation of a recording. Change the mission
 * seed and the drone flies a chain of waypoints it has never seen.
 */
"use strict";

const $ = (id) => document.getElementById(id);
const PILOT_NAME = "Mikkels AI";

const state = {
    running: true,
    speed: 1,
    pilotMode: "brain",
    // A mission the champion flies well, so the page opens on something worth
    // watching. It is an ordinary unseen seed, not a special case — but the
    // brain is genuinely inconsistent (median 6 waypoints, best 26 over 60
    // missions), so "New mission" will often go a lot worse. The honest average
    // is in README.md.
    missionSeed: 4395,
    world: null,
    renderer: null,
    room: new Room4D(),
    brain: null,
    autopilot: new Autopilot4D(),
    acc: 0,
    lastT: 0,
    deadFor: 0
};

/* Hand the aircraft over mid-flight, without restarting the episode.
 *
 * Both controllers read the same drone state and write the same eight
 * throttles, so the swap is just a matter of who is holding the stick. The
 * network's temporal input window stays valid across the handover because
 * Drone.control() always runs its full sensor block and only skips the forward
 * pass when `brain` is null — so the lag history is warm the instant the brain
 * takes back over, rather than fed eight ticks of zeros. */
function setPilot(mode) {
    if (mode === "brain" && !state.brain) mode = "auto";
    state.pilotMode = mode;
    $("sel-pilot").value = mode;
    const d = state.world && state.world.drones[0];
    if (d) {
        const useBrain = mode === "brain";
        d.brain = useBrain ? state.brain : null;
        state.world.opts.pilot = useBrain ? null : state.autopilot;
    }
    const el = $("pilot-flag");
    if (el) {
        el.textContent = mode === "brain" ? PILOT_NAME : "Hand-written PD pilot";
        el.className = "pilot-flag " + (mode === "brain" ? "ai" : "pd");
        el.classList.remove("flash");
        void el.offsetWidth;              // restart the CSS flash
        el.classList.add("flash");
    }
}

/* ------------------------------------------------------------------ setup */
function haveChampion() {
    return typeof CHAMPION !== "undefined" && CHAMPION && CHAMPION.weights;
}

function newEpisode(newSeed) {
    if (newSeed) state.missionSeed = 1 + ((Math.random() * 100000) | 0);
    const usingBrain = state.pilotMode === "brain" && state.brain;
    const opts = {
        missionSeed: state.missionSeed,
        noiseSeed: (state.missionSeed * 7) % 9973,
        turbulence: 0.15,
        noise: true,
        hardCap: 100000,
        maxArrivals: 100000,
        minSep: 8,
        startClock: 18
    };
    if (!usingBrain) opts.pilot = state.autopilot;
    state.world = new World4D(state.room, [usingBrain ? state.brain : null], opts);
    state.deadFor = 0;
    state.trail = [];
    $("deadmsg").classList.remove("show");
}

function boot() {
    if (haveChampion()) state.brain = Net.fromJSON(CHAMPION);
    if (!state.brain) {
        // No baked brain available — fall back to the reference controller so the
        // page is never a blank room, and say so rather than passing it off.
        state.pilotMode = "auto";
        const sel = $("sel-pilot");
        sel.value = "auto";
        sel.querySelector('option[value="brain"]').textContent = PILOT_NAME + " (not baked)";
        sel.querySelector('option[value="brain"]').disabled = true;
    }
    // ?pilot=auto|brain lets a screenshot or a link pick the controller
    const pm = location.search.match(/pilot=(auto|brain)/);
    if (pm && !(pm[1] === "brain" && !state.brain)) state.pilotMode = pm[1];
    const sm = location.search.match(/seed=(\d+)/);
    if (sm) state.missionSeed = +sm[1];

    state.renderer = new Renderer4D($("view"), state.room);
    buildBars();
    newEpisode(false);
    $("sel-pilot").value = state.pilotMode;

    /* ?warm=N advances the episode N physics ticks synchronously at load.
     * Headless Chrome under --virtual-time-budget barely fires rAF, so a
     * screenshot of this page otherwise always catches the drone sitting on the
     * pad at t=0. This runs the same World4D.step() the live loop does. */
    const wm = location.search.match(/warm=(\d+)/);
    if (wm) {
        const n = Math.min(60000, +wm[1]);
        const d = state.world.drones[0];
        for (let i = 0; i < n && !d.done; i++) {
            state.world.step();
            if (state.world.tick % 6 === 0) {
                state.trail.push(Float64Array.from(d.pos));
                if (state.trail.length > 900) state.trail.shift();
            }
        }
        // settle the chase cameras onto the drone instead of easing in from origin
        state.renderer.update({
            pos: d.pos, R: d.R, target: d.target, trail: state.trail,
            spin: d.spin, alive: d.alive && !d.done
        });
        for (const P of state.renderer.views) if (P.focusTarget) P.focus = P.focusTarget.clone();
    }

    wireUI();
    const tm = location.search.match(/theta=(\d+)/);
    if (tm) {
        $("rng-theta").value = tm[1];
        $("rng-theta").dispatchEvent(new Event("input"));
    }
    // Say exactly which brain is on screen. A viewer that shows "the champion"
    // without saying which one is how two different nets end up being discussed
    // as though they were the same result.
    const meta = typeof CHAMPION_META !== "undefined" ? CHAMPION_META : null;
    $("prov").innerHTML = state.brain && meta
        ? `${PILOT_NAME}: generation <b>${meta.gen}</b>, weights sha1 ` +
          `<span class="mono">${meta.sha}</span>, ${NET_SIZES.join("→")}. ` +
          `The PD pilot is hand-written and not evolved.`
        : `No evolved brain is baked into this copy — showing the hand-written ` +
          `PD pilot. Run <span class="mono">node train.js</span> then ` +
          `<span class="mono">node bake.js</span>.`;

    window.addEventListener("resize", () => state.renderer.resize());
    requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------- bars */
const PLANE_NAMES = ["R–U", "R–F", "R–A", "U–F", "U–A", "F–A"];
function buildBars() {
    const rb = $("rotorbars");
    rb.innerHTML = "";
    for (let i = 0; i < N_ROTORS; i++) {
        const s = ROTORS[i].s;
        const nm = `${s[0] > 0 ? "+" : "−"}${s[1] > 0 ? "+" : "−"}${s[2] > 0 ? "+" : "−"}`;
        rb.insertAdjacentHTML("beforeend",
            `<div class="bar"><span class="bname mono">${nm}</span>` +
            `<span class="btrack"><span class="bfill" id="rf${i}" style="left:0;width:0"></span></span>` +
            `<span class="bval" id="rv${i}">0%</span></div>`);
    }
    const pb = $("planebars");
    pb.innerHTML = "";
    for (let k = 0; k < N_PLANES; k++) {
        pb.insertAdjacentHTML("beforeend",
            `<div class="bar ${PLANE_IS_TILT[k] ? "tilt" : ""}">` +
            `<span class="bname mono">${PLANE_NAMES[k]}${PLANE_IS_TILT[k] ? " tilt" : ""}</span>` +
            `<span class="btrack signed"><span class="bfill" id="pf${k}" style="left:50%;width:0"></span></span>` +
            `<span class="bval" id="pv${k}">0</span></div>`);
    }
}

/* --------------------------------------------------------------------- UI */
function wireUI() {
    $("btn-play").onclick = () => {
        state.running = !state.running;
        $("btn-play").textContent = state.running ? "⏸ Pause" : "▶ Play";
    };
    $("btn-reset").onclick = () => newEpisode(false);
    $("btn-mission").onclick = () => newEpisode(true);
    $("sel-pilot").onchange = (e) => setPilot(e.target.value);
    $("rng-speed").oninput = (e) => {
        state.speed = +e.target.value;
        $("val-speed").textContent = state.speed.toFixed(2).replace(/0$/, "") + "×";
    };
    $("rng-theta").oninput = (e) => {
        const deg = +e.target.value;
        $("val-theta").textContent = deg + "°";
        state.renderer.setTheta(deg * Math.PI / 180);
        $("label-l").textContent = state.renderer.views[0].label;
        $("label-r").textContent = state.renderer.views[1].label;
    };
    $("about-toggle").onclick = () => $("about-group").classList.toggle("collapsed");

    // intro
    const close = (mode) => {
        if (mode) setPilot(mode);
        $("intro").classList.add("hidden");
    };
    $("intro-watch").onclick = () => close(state.brain ? "brain" : "auto");
    $("intro-auto").onclick = () => close("auto");
    $("intro-explore").onclick = () => close(null);
    if (location.search.includes("nointro")) $("intro").classList.add("hidden");

    document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
        if (e.key === "1") setPilot("brain");
        else if (e.key === "2") setPilot("auto");
        else if (e.key === " ") { e.preventDefault(); $("btn-play").click(); }
        else if (e.key.toLowerCase() === "n") $("btn-mission").click();
        else return;
    });

    // camera orbit
    const cv = $("view");
    let drag = null;
    cv.addEventListener("pointerdown", (e) => {
        drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const o = state.renderer.orbit;
        o.az -= (e.clientX - drag.x) * 0.006;
        o.el = Math.max(-0.35, Math.min(1.35, o.el + (e.clientY - drag.y) * 0.005));
        drag = { x: e.clientX, y: e.clientY };
    });
    cv.addEventListener("pointerup", () => { drag = null; });
    cv.addEventListener("pointercancel", () => { drag = null; });
    cv.addEventListener("wheel", (e) => {
        e.preventDefault();
        const o = state.renderer.orbit;
        o.dist = Math.max(14, Math.min(110, o.dist * (1 + Math.sign(e.deltaY) * 0.09)));
    }, { passive: false });
}

/* ------------------------------------------------------------------ loop */
function frame(t) {
    requestAnimationFrame(frame);
    const dtReal = state.lastT ? Math.min(0.1, (t - state.lastT) / 1000) : 0;
    state.lastT = t;

    const w = state.world, d = w.drones[0];
    if (state.running) {
        state.acc += dtReal * state.speed;
        // Cap the catch-up work so a slow frame cannot spiral: at most 0.25 s of
        // simulation per frame, which at 4× speed is still real time.
        let budget = 0.25;
        while (state.acc >= DT && budget > 0) {
            if (!d.done) w.step();
            state.acc -= DT; budget -= DT;
            if (w.tick % 6 === 0 && !d.done) {
                state.trail.push(Float64Array.from(d.pos));
                if (state.trail.length > 900) state.trail.shift();
            }
        }
        // A finished flight restarts itself after a beat, so an unattended page
        // keeps flying rather than sitting on a corpse.
        if (d.done) {
            state.deadFor += dtReal;
            const msg = $("deadmsg");
            if (!msg.classList.contains("show")) {
                msg.textContent = d.crashed
                    ? `crashed after ${d.arrivals} waypoint${d.arrivals === 1 ? "" : "s"}`
                    : `out of time — ${d.arrivals} waypoint${d.arrivals === 1 ? "" : "s"} reached`;
                msg.classList.add("show");
            }
            if (state.deadFor > 2.4) newEpisode(true);
        }
    }

    state.renderer.update({
        pos: d.pos, R: d.R, target: d.target, trail: state.trail,
        spin: d.spin, alive: d.alive && !d.done, dt: dtReal * state.speed
    });
    state.renderer.render();
    updateHUD(d, w);
}

const f1 = (v) => (v >= 0 ? " " : "") + v.toFixed(1);
function updateHUD(d, w) {
    $("stat-wp").textContent = d.arrivals;
    $("stat-air").textContent = d.airTime.toFixed(1) + "s";
    $("stat-clock").textContent = d.timeLeft.toFixed(1) + "s";
    const t = d.target;
    $("stat-dist").textContent = t ? d.distToTarget().toFixed(2) + " m" : "—";
    $("stat-dw").textContent = t ? (t[3] - d.pos[3]).toFixed(2) + " m" : "—";
    for (let k = 0; k < 4; k++) {
        $("p" + k).textContent = f1(d.pos[k]);
        $("t" + k).textContent = t ? f1(t[k]) : "—";
        $("e" + k).textContent = t ? f1(t[k] - d.pos[k]) : "—";
    }
    for (let i = 0; i < N_ROTORS; i++) {
        const v = Math.max(0, Math.min(1, d.spin[i]));
        $("rf" + i).style.width = (v * 100).toFixed(1) + "%";
        $("rv" + i).textContent = (v * 100).toFixed(0) + "%";
    }
    for (let k = 0; k < N_PLANES; k++) {
        const v = Math.max(-1, Math.min(1, d.omega[k] / 6));
        const el = $("pf" + k);
        el.style.left = (v < 0 ? 50 + v * 50 : 50) + "%";
        el.style.width = Math.abs(v) * 50 + "%";
        $("pv" + k).textContent = d.omega[k].toFixed(1);
    }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
