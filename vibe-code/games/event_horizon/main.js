/* main.js — the loop, the controls, and the screens around a flight.
 *
 * URL parameters (for screenshots and testing):
 *   ?m=<mission id>     start that mission directly, no title screen
 *   &variant=<id>       …in that variant
 *   &demo=1             …flown by the scripted pilot
 *   &bench=<frames>     run that many frames synchronously before the first paint
 *   &touch=1            show the touch controls even with a mouse
 *   &keys=KeyZ,KeyW     hold these keys down through the bench run
 *   &perf=<frames>      time that many frames and report in the page title
 *   &screen=menu|guide|brief, &sheet=0|1   open that screen / phone sheet tab
 */
"use strict";

(function () {
    const STORE_KEY = "event_horizon_v1";
    const WARPS = [1, 2, 4, 8, 16];
    const params = new URLSearchParams(location.search);

    let save = { stars: {}, sound: false };
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) save = Object.assign(save, JSON.parse(raw)); } catch (e) { /* private mode: play without saving */ }
    function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

    const map = new MapRenderer($("scene"));
    const port = new Porthole($("porthole"));

    let sim = null, mission = null, variant = null;
    let state = "attract";          // attract | ready | flying | ending | done
    let paused = false, warp = 1, demo = false, demoMem = null, endTimer = 0, portTick = 0, bannerTimer = 0;
    let hoverOn = false, fireQueued = false, finishQueued = false, nudge = 0, pointerAim = null;
    const keys = {};
    const pointers = new Map();
    let pinch = 0;

    /* ------------------------------------------------------------ flights */

    function start(m, opt) {
        mission = m; variant = opt && opt.variant || null;
        sim = new Sim(m, { variant: variant });
        demo = !!(opt && opt.demo); demoMem = {};
        hoverOn = sim.hover; warp = 1; paused = false; endTimer = 0;
        for (const k in keys) keys[k] = false;
        /* A hand-flown mission waits, frozen, for the first touch of a control:
         * time to look at the chart and find the keys before anything starts
         * falling. */
        state = opt && opt.attract ? "attract" : demo ? "flying" : "ready";
        map.begin(sim); Hud.begin(sim);
        $("demo-tag").hidden = !demo;
        $("port-wrap").classList.toggle("off", !sim.cfg.cockpit || !$("chk-port").checked);
        $("port-label").innerHTML = "";
        document.body.classList.toggle("laser", !!sim.laser);
        setKeysLegend(); syncWarp(); syncPause(); syncTouch();
        if (state === "flying") banner(m.title, 2200);
        if (state === "ready") banner("Ready. The clock starts when you touch a control.", 600000);
    }

    function begin() { if (state === "ready") { state = "flying"; bannerTimer = 0.01; } }

    function setKeysLegend() {
        const L = sim.laser;
        $("keys").innerHTML = L
            ? "<span><kbd>←</kbd><kbd>→</kbd> aim</span><span><kbd>Shift</kbd> fine</span><span><kbd>Q</kbd><kbd>E</kbd> 0.01° steps</span><span><kbd>Space</kbd> fire</span><span><kbd>Enter</kbd> finish</span>"
            : "<span><kbd>←</kbd><kbd>→</kbd> turn</span><span><kbd>↑</kbd> thrust</span><span><kbd>↓</kbd> reverse</span><span><kbd>Shift</kbd> fine</span>" +
              "<span><kbd>Z</kbd><kbd>X</kbd> pro / retro</span><span><kbd>C</kbd><kbd>V</kbd> out / in</span>" +
              (sim.world.rs > 0 && !sim.world.R ? "<span><kbd>H</kbd> hover</span>" : "") +
              "<span><kbd>,</kbd><kbd>.</kbd> warp</span><span><kbd>P</kbd> pause</span><span><kbd>R</kbd> restart</span><span>mouse: hold to fly towards it · wheel zooms</span>";
    }

    function readInput() {
        const inp = { turn: (keys.left ? 1 : 0) - (keys.right ? 1 : 0), thrust: 0, reverse: 0, fine: !!keys.shift, align: null, hover: hoverOn, climb: 0 };
        if (sim.laser) {
            if (nudge) { sim.laser.aim += nudge * 0.01 * Math.PI / 180; nudge = 0; }
            if (pointerAim !== null) { inp.aimTo = pointerAim; pointerAim = null; }
            inp.fire = fireQueued; fireQueued = false;
            inp.finish = finishQueued; finishQueued = false;
            return inp;
        }
        if (hoverOn) inp.climb = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
        else { inp.thrust = keys.up || keys.space ? 1 : 0; inp.reverse = keys.down ? 1 : 0; }
        if (keys.pro) inp.align = "pro"; else if (keys.retro) inp.align = "retro";
        else if (keys.out) inp.align = "out"; else if (keys.inw) inp.align = "in";
        if (pointers.size === 1 && !hoverOn) {
            // hold the mouse (or a finger) on the chart: turn towards it, and burn once roughly lined up
            const p = pointers.values().next().value, w = [0, 0];
            map.toWorld(p.x, p.y, w);
            inp.aim = Math.atan2(w[1] - sim.ship.y, w[0] - sim.ship.x);
            const err = Math.abs(Math.atan2(Math.sin(inp.aim - sim.heading), Math.cos(inp.aim - sim.heading)));
            if (err < 0.35) inp.thrust = 1;
        }
        return inp;
    }

    function tick(dtReal) {
        if (!sim) return;
        let dT = 0;
        const running = (state === "flying" || state === "attract") && !paused && sim.status === "flying";
        if (running) {
            let input;
            if (demo) {
                input = PILOTS[mission.pilot](sim, demoMem) || {};
                if (input.hover === undefined) input.hover = false;
                hoverOn = !!input.hover;
                const w = input.warp || 1;
                if (w !== warp) { warp = w; syncWarp(); }
            } else input = state === "attract" ? { hover: false } : readInput();
            let scale = sim.timeScale * warp;
            if (sim.d.inside && sim.cfg.insideTimeScale) scale = sim.cfg.insideTimeScale;
            const T0 = sim.ship.T;
            sim.step(dtReal, dtReal * scale, input);
            dT = sim.ship.T - T0;
            // the sim can drop the autopilot by itself (at the horizon); keep the button honest
            if (hoverOn !== sim.hover) { hoverOn = sim.hover; syncTouch(); }
            events();
        }
        if (state === "flying" && sim.status !== "flying") { state = "ending"; endTimer = sim.status === "won" ? 1.3 : 1.9; }
        if (state === "ending") { endTimer -= dtReal; if (endTimer <= 0) finish(); }
        if (state === "attract" && sim.status !== "flying") start(mission, { attract: true });
        map.update(sim, dtReal, dT);
        const d = sim.d;
        const baseRate = sim.ship.farLost || d.inside ? NaN : (1 + sim.base.rate1) / d.rate;
        Sound.update(dtReal, sim.throttle, baseRate, running && state === "flying");
        if (bannerTimer > 0) { bannerTimer -= dtReal; if (bannerTimer <= 0) $("banner").classList.remove("on"); }
    }

    function events() {
        const ev = sim.events;
        for (let i = 0; i < ev.length; i++) {
            const e = ev[i];
            if (e.type === "horizon") { banner("You have crossed the event horizon. Nothing marked the spot.", 5200); Sound.horizon(); if (warp !== 1) { warp = 1; syncWarp(); } }
            else if (e.type === "leg") banner(e.name, 3000);
            else if (e.type === "ping") Sound.ping(e.stretch);
            else if (e.type === "fire") Sound.fire();
            else if (e.type === "hit") { banner(e.name + " — hit", 2200); Sound.hit(); }
            else if (e.type === "won" && state === "flying") Sound.win();
            else if (e.type === "lost" && state === "flying") Sound.lose();
        }
        ev.length = 0;
    }

    function draw(dtReal) {
        if (!sim) return;
        map.draw(sim, dtReal);
        Hud.update(sim, false);
        if (!$("port-wrap").classList.contains("off") && (++portTick & 1)) {
            port.draw(sim);
            const mode = sim.cfg.cockpit, deg = port.info.shadowDeg;
            const w = "<span class='wide-only'>WINDOW · </span>";
            $("port-label").innerHTML = mode === "heading" ? w + "out of the nose"
                : mode === "body" ? w + "looking down"
                : w + "the hole, <b>" + deg.toFixed(deg < 10 ? 1 : 0) + "°</b> wide";
        }
        warnings();
    }

    function warnings() {
        const el = $("warn");
        let text = "", soft = false;
        if (state === "flying" && sim.status === "flying" && !sim.laser) {
            const p = map.path;
            if (sim.d.inside) { text = "Inside the horizon"; soft = true; }
            else if (sim.hoverStarved) text = "Engine at full power — still sinking";
            else if (sim.hoverFloor) { text = "Autopilot floor — the engine cannot hold you any lower"; soft = true; }
            else if (sim.fuelLeft() <= 0) text = "Out of fuel";
            else if (sim.fuelMax !== Infinity && sim.fuelLeft() < 0.25 * sim.fuelMax) { text = "Fuel low — getting back out costs fuel too"; soft = !sim.hover; }
            else if (sim.tideLimit && sim.tideG() > 0.4 * sim.tideLimit) text = "Tides " + sim.tideG().toFixed(1) + " g — hull fails at " + sim.tideLimit;
            else if (p && !sim.hover && (p.status === "plunge" || p.status === "crash")) {
                text = "Coasting path ends " + (sim.world.R ? "in the atmosphere" : "in the hole"); soft = true;
            }
        }
        if (el.textContent !== text) el.textContent = text;
        el.className = soft ? "soft" : "";
    }

    function banner(text, ms) {
        const b = $("banner");
        b.textContent = text; b.classList.add("on"); bannerTimer = ms / 1000;
    }

    /* ------------------------------------------------------------ screens */

    function show(id) { $(id).classList.remove("hidden"); }
    function hide(id) { $(id).classList.add("hidden"); }
    function anyModal() { return ["intro", "menu", "brief", "debrief", "guide"].some(function (id) { return !$(id).classList.contains("hidden"); }); }

    function openBrief(m) {
        ["intro", "menu", "debrief", "guide"].forEach(hide);
        /* A mission whose whole point is the choice (tides) opens with nothing
         * selected; the others default to their first variant. */
        const keep = m.variants && variant && m.variants.some(function (v) { return v.id === variant; });
        mission = m; variant = m.variants ? (keep ? variant : (m.mustChoose ? null : m.variants[0].id)) : null;
        const needChoice = function () { const off = !!(m.mustChoose && !variant); $("brief-fly").disabled = off; $("brief-demo").disabled = off; };
        $("brief-chapter").textContent = m.chapter + " · " + (MISSIONS.indexOf(m) + 1) + " of " + MISSIONS.length;
        $("brief-title").textContent = m.title;
        $("brief-tag").textContent = m.tag;
        $("brief-text").innerHTML = m.brief;
        $("brief-demo").hidden = !m.pilot;
        const box = $("brief-variants");
        box.innerHTML = "";
        (m.variants || []).forEach(function (v) {
            const b = document.createElement("button");
            b.className = "intro-choice" + (v.id === variant ? " sel" : "");
            b.innerHTML = "<b>" + v.name + "</b><small>" + v.sub + "</small>";
            b.addEventListener("click", function () {
                variant = v.id;
                box.querySelectorAll(".intro-choice").forEach(function (el) { el.classList.remove("sel"); });
                b.classList.add("sel");
                needChoice();
            });
            box.appendChild(b);
        });
        needChoice();
        show("brief");
        paused = true; syncPause();
    }

    function openMenu() {
        const list = $("menu-list");
        list.innerHTML = "";
        let chapter = "";
        MISSIONS.forEach(function (m, i) {
            if (m.chapter !== chapter) {
                chapter = m.chapter;
                const h = document.createElement("div"); h.className = "menu-chapter"; h.textContent = chapter; list.appendChild(h);
            }
            const st = save.stars[m.id] || 0;
            const b = document.createElement("button");
            b.className = "menu-item";
            b.innerHTML = "<span class='num'>" + (i + 1) + "</span><span><b>" + m.title + "</b><small>" + m.tag + "</small></span>" +
                (m.id === "sandbox" ? "<span class='st'></span>" : "<span class='st'>" + "<i>★</i>".repeat(st) + "★".repeat(3 - st) + "</span>");
            b.addEventListener("click", function () { openBrief(m); });
            list.appendChild(b);
        });
        ["intro", "brief", "debrief", "guide"].forEach(hide);
        show("menu");
        paused = true; syncPause();
    }

    function finish() {
        state = "done";
        let deb;
        if (sim.status === "won" || (sim.status === "lost" && sim.failCode === "tides") || mission.id === "sandbox") deb = mission.debrief(sim);
        else deb = { stars: 0, title: sim.reason || "Flight over", lines: [failText(sim)] };
        if (demo) deb.stars = 0;
        if (deb.stars > (save.stars[mission.id] || 0)) { save.stars[mission.id] = deb.stars; persist(); }
        $("deb-stars").innerHTML = mission.id === "sandbox" ? "" : "<span class='lit'>" + "★".repeat(deb.stars) + "</span>" + "★".repeat(3 - deb.stars);
        $("deb-title").textContent = demo && sim.status === "won" ? "That is how it is done" : deb.title;
        $("deb-lines").innerHTML = deb.lines.map(function (l) { return "<p>" + l + "</p>"; }).join("");
        $("deb-fact").innerHTML = "<b>In the real world.</b> " + mission.fact;
        const next = MISSIONS[MISSIONS.indexOf(mission) + 1];
        $("deb-next").hidden = !next || (sim.status !== "won" && !demo);
        $("deb-next").textContent = demo ? "Now you try" : "Next mission";
        $("deb-again").textContent = sim.status === "won" ? "Fly it again" : "Try again";
        show("debrief");
    }

    function failText(s) {
        if (s.failCode === "surface") return "Your path dipped into the atmosphere. Swing the nose prograde (<kbd>Z</kbd>) and burn sooner — and keep an eye on the dashed line: red means it ends on the planet.";
        if (s.failCode === "singularity") return "You crossed the horizon at " + fmtClock(s.tauCross * s.unitS, s.cfg.clock) + " ship time, and that was that — " + fmtDuration((s.tau - s.tauCross) * s.unitS) + " later you reached the centre. When the dashed line turns red, add sideways speed or climb <b>before</b> you get close; below 1.5 r<sub>s</sub> even light cannot hold an orbit.";
        if (s.failCode === "time") return "Life support ran out. Time runs slower the deeper you go, so a deeper hover means a shorter wait — and falling part of the way down is much quicker than riding the autopilot.";
        return "The flight ended early.";
    }

    function openGuide(id) {
        const nav = $("guide-nav"), page = $("guide-page");
        nav.innerHTML = "";
        const showPage = function (g) {
            nav.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.id === g.id); });
            const m = MISSIONS.find(function (x) { return x.id === g.mission; });
            page.innerHTML = "<h3>" + g.title + "</h3><div class='one'>" + g.one + "</div>" +
                g.body.map(function (p) { return "<p>" + p + "</p>"; }).join("") +
                "<div class='formula'>" + g.formula + "</div>" +
                (m ? "<button class='btn try'>Try it: " + m.title + " →</button>" : "");
            const t = page.querySelector(".try");
            if (t) t.addEventListener("click", function () { openBrief(m); });
            page.scrollTop = 0;
        };
        GUIDE.forEach(function (g) {
            const b = document.createElement("button");
            b.textContent = g.title; b.dataset.id = g.id;
            b.addEventListener("click", function () { showPage(g); });
            nav.appendChild(b);
        });
        showPage(GUIDE.find(function (g) { return g.id === id; }) || GUIDE[0]);
        show("guide");
        paused = true; syncPause();
    }

    function closeModal(id) {
        hide(id);
        if (!anyModal()) {
            if (state === "done") openMenu();
            else { paused = false; syncPause(); }
        }
    }

    /* ------------------------------------------------------------ controls */

    function syncWarp() {
        $("warp-group").querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", Number(b.dataset.w) === warp); });
    }
    function syncPause() { $("btn-pause").textContent = paused ? "Resume" : "Pause"; $("btn-pause").classList.toggle("on", paused); }
    function syncTouch() {
        const h = document.querySelector("#touch [data-key=hover]");
        h.classList.toggle("on", hoverOn);
        h.style.display = sim && sim.world.rs > 0 && !sim.world.R && !sim.laser ? "" : "none";
        document.querySelectorAll("#touch [data-key=pro], #touch [data-key=retro], #touch [data-key=down]").forEach(function (b) { b.style.display = sim && sim.laser ? "none" : ""; });
        document.querySelector("#touch [data-key=up]").textContent = sim && sim.laser ? "FIRE" : "▲";
    }
    function takeOver() { begin(); if (demo && state === "flying") { demo = false; $("demo-tag").hidden = true; warp = 1; syncWarp(); banner("You have control", 1500); } }
    function setWarp(w) { if (sim && sim.d.inside) w = 1; warp = w; syncWarp(); }
    function toggleHover() {
        if (!sim || sim.laser || !(sim.world.rs > 0) || sim.world.R || sim.d.inside) return;
        hoverOn = !hoverOn; syncTouch();
        banner(hoverOn ? "Hover autopilot ON — W climbs, S descends" : "Hover OFF — you are falling", 1800);
    }

    const KEYMAP = {
        ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
        Space: "space", ShiftLeft: "shift", ShiftRight: "shift", KeyZ: "pro", KeyX: "retro", KeyC: "out", KeyV: "inw"
    };

    window.addEventListener("keydown", function (e) {
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (e.code === "Escape") {
            const open = ["guide", "menu", "brief"].find(function (id) { return !$(id).classList.contains("hidden"); });
            if (open && state !== "attract") { closeModal(open); return; }
        }
        if (anyModal()) return;
        const k = KEYMAP[e.code];
        if (k) {
            e.preventDefault();
            if (k !== "shift") takeOver();
            if (k === "space" && sim && sim.laser) { if (!e.repeat) fireQueued = true; return; }
            keys[k] = true; return;
        }
        if (e.repeat && e.code !== "KeyQ" && e.code !== "KeyE") return;
        if (e.code === "KeyH") { takeOver(); toggleHover(); }
        else if (e.code === "Enter" && state === "ready") begin();
        else if (e.code === "Period") setWarp(WARPS[Math.min(WARPS.length - 1, WARPS.indexOf(warp) + 1)]);
        else if (e.code === "Comma") setWarp(WARPS[Math.max(0, WARPS.indexOf(warp) - 1)]);
        else if (e.code === "KeyP" || e.code === "Escape") { paused = !paused; syncPause(); }
        else if (e.code === "KeyR") { if (state !== "attract") start(mission, { variant: variant }); }
        else if (e.code === "KeyM") openMenu();
        else if (e.code === "KeyQ") { takeOver(); nudge += 1; }
        else if (e.code === "KeyE") { takeOver(); nudge -= 1; }
        else if (e.code === "Enter") finishQueued = true;
    });
    window.addEventListener("keyup", function (e) { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
    window.addEventListener("blur", function () { for (const k in keys) keys[k] = false; pointers.clear(); });

    // touch buttons
    document.querySelectorAll("#touch .tc").forEach(function (b) {
        const k = b.dataset.key;
        const down = function (e) {
            e.preventDefault(); takeOver();
            if (k === "hover") { toggleHover(); return; }
            if (k === "up" && sim && sim.laser) { fireQueued = true; return; }
            keys[k] = true; b.classList.add("down");
            if (sim && sim.laser && (k === "left" || k === "right")) keys.shift = true;
        };
        const up = function (e) { e.preventDefault(); keys[k] = false; b.classList.remove("down"); if (sim && sim.laser) keys.shift = false; };
        b.addEventListener("pointerdown", down);
        b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up);
        b.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    });

    // the chart itself: hold to fly towards the pointer, wheel or pinch to zoom
    const scene = $("scene");
    const local = function (e) { const r = scene.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    scene.addEventListener("pointerdown", function (e) {
        if ((state !== "flying" && state !== "ready") || e.button === 2) return;
        takeOver();
        scene.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 2) { const p = Array.from(pointers.values()); pinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
        if (sim.laser && pointers.size === 1) {
            const p = local(e), w = [0, 0];
            map.toWorld(p.x, p.y, w);
            pointerAim = Math.atan2(w[1] - sim.ship.y, w[0] - sim.ship.x);
        }
    });
    scene.addEventListener("pointermove", function (e) {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 2) {
            const p = Array.from(pointers.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
            if (pinch > 0) map.userZoom = Math.max(0.3, Math.min(6, map.userZoom * d / pinch));
            pinch = d;
        }
    });
    const release = function (e) { pointers.delete(e.pointerId); pinch = 0; };
    scene.addEventListener("pointerup", release); scene.addEventListener("pointercancel", release);
    scene.addEventListener("wheel", function (e) {
        e.preventDefault();
        map.userZoom = Math.max(0.3, Math.min(6, map.userZoom * Math.pow(1.0015, -e.deltaY)));
    }, { passive: false });
    scene.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    // top bar
    WARPS.forEach(function (w) {
        const b = document.createElement("button");
        b.textContent = w + "×"; b.dataset.w = w;
        b.addEventListener("click", function () { setWarp(w); });
        $("warp-group").appendChild(b);
    });
    $("btn-pause").addEventListener("click", function () { paused = !paused; syncPause(); });
    $("btn-restart").addEventListener("click", function () { if (state !== "attract") start(mission, { variant: variant }); });
    $("btn-menu").addEventListener("click", openMenu);
    $("btn-guide").addEventListener("click", function () { openGuide(); });
    $("btn-demo").addEventListener("click", function () { if (mission.pilot) start(mission, { variant: variant, demo: true }); });
    $("btn-finish").addEventListener("click", function () { finishQueued = true; });
    const syncSound = function () { $("btn-sound").textContent = save.sound ? "Sound on" : "Sound off"; $("btn-sound").classList.toggle("on", save.sound); };
    $("btn-sound").addEventListener("click", function () { save.sound = !save.sound; persist(); Sound.setOn(save.sound); syncSound(); });
    syncSound();
    /* Browsers only let a page make noise after a gesture; the first click
     * anywhere is what actually starts the audio, if it was left switched on. */
    window.addEventListener("pointerdown", function once() { if (save.sound) Sound.setOn(true); window.removeEventListener("pointerdown", once); });

    // view toggles
    document.querySelectorAll("#card-view [data-ov]").forEach(function (el) {
        el.addEventListener("change", function () { if (sim) sim.overlays[el.getAttribute("data-ov")] = el.checked; });
    });
    $("chk-port").addEventListener("change", function () { $("port-wrap").classList.toggle("off", !$("chk-port").checked || !sim.cfg.cockpit); });

    // screens
    $("intro-start").addEventListener("click", function () {
        const next = MISSIONS.find(function (m) { return m.id !== "sandbox" && !save.stars[m.id]; }) || MISSIONS[0];
        openBrief(next);
    });
    $("intro-menu").addEventListener("click", openMenu);
    $("intro-free").addEventListener("click", function () { openBrief(MISSIONS.find(function (m) { return m.id === "sandbox"; })); });
    $("intro-guide").addEventListener("click", function () { openGuide(); });
    $("brief-fly").addEventListener("click", function () { hide("brief"); start(mission, { variant: variant }); });
    $("brief-demo").addEventListener("click", function () { hide("brief"); start(mission, { variant: variant, demo: true }); });
    $("brief-back").addEventListener("click", openMenu);
    $("deb-next").addEventListener("click", function () {
        if (demo) { hide("debrief"); start(mission, { variant: variant }); return; }
        openBrief(MISSIONS[MISSIONS.indexOf(mission) + 1]);
    });
    $("deb-again").addEventListener("click", function () { hide("debrief"); start(mission, { variant: variant }); });
    $("deb-menu").addEventListener("click", openMenu);
    document.querySelectorAll("[data-close]").forEach(function (b) {
        b.addEventListener("click", function () {
            const id = b.getAttribute("data-close");
            hide(id);
            if (state === "attract") { show("intro"); paused = false; syncPause(); }
            else if (state === "done") show("debrief");
            else { paused = false; syncPause(); }
        });
    });
    if (Object.keys(save.stars).length) $("intro-start-sub").textContent = "Carry on where you left off";

    /* ------------------------------------------------------------ go */

    function onResize() { map.resize(); if (sim) { map.scale = Math.min(map.W, map.H) / 2 / map.viewR * map.userZoom; } }
    window.addEventListener("resize", onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe($("canvas-wrap"));
    if (params.get("touch")) document.body.classList.add("force-touch");
    // &sheet=0|1 opens that tab of the phone layout's bottom sheet (screenshots)
    if (params.get("sheet")) window.addEventListener("load", function () { setTimeout(function () { if (window.MobileUI) window.MobileUI.open(Number(params.get("sheet"))); }, 200); });

    const direct = MISSIONS.find(function (m) { return m.id === params.get("m"); });
    if (direct) {
        hide("intro");
        start(direct, { variant: params.get("variant"), demo: params.get("demo") === "1" });
        // &keys=KeyZ,KeyW holds those keys down through the bench run: a test of the real input path
        (params.get("keys") || "").split(",").filter(Boolean).forEach(function (code) {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: code }));
        });
        const n = parseInt(params.get("bench"), 10) || 0;
        if (n) begin();
        for (let i = 0; i < n && (state === "flying" || state === "ending"); i++) tick(1 / 60);
        Hud.update(sim, true);
    } else {
        // something alive behind the title: a ship in a quiet orbit round a hole
        start(MISSIONS.find(function (m) { return m.id === "sandbox"; }), { attract: true });
    }
    if (params.get("screen")) { const s = params.get("screen"); if (s === "menu") openMenu(); else if (s === "guide") openGuide(params.get("page")); else if (s === "brief" && direct) openBrief(direct); }

    let last = 0;
    function frame(now) {
        requestAnimationFrame(frame);
        const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
        last = now;
        tick(dt); draw(dt);
    }
    /* ?perf=N: time N frames of simulation + drawing, flat out, and report in
     * the page title (readable from a headless --dump-dom). */
    const perfN = parseInt(params.get("perf"), 10) || 0;
    if (perfN) {
        const t0 = performance.now();
        for (let i = 0; i < perfN; i++) { tick(1 / 60); draw(1 / 60); }
        const total = (performance.now() - t0) / perfN;
        const part = function (fn) { const t = performance.now(); for (let i = 0; i < perfN; i++) fn(); return ((performance.now() - t) / perfN).toFixed(2); };
        document.title = "PERF " + total.toFixed(2) + " ms/frame: map " + part(function () { map.draw(sim, 1 / 60); }) +
            ", window " + part(function () { port.draw(sim); }) + ", hud " + part(function () { Hud.update(sim, true); }) +
            ", physics " + part(function () { tick(1 / 60); });
    }
    tick(0); draw(1 / 60);          // one synchronous paint, so a headless screenshot is never blank
    requestAnimationFrame(frame);
})();
