/* main.js — the page. Playback only.
 *
 * The physics in this tab is the SAME physics the trainer ran: identical files,
 * identical 200 Hz integrator, identical scoring. Nothing is replayed from a
 * recording — the scenario is rebuilt from its seed and flown live, which is why
 * the numbers in the corner are the real ones and why changing the pilot
 * drop-down re-flies the identical air.
 *
 * Real time means real time: the simulation advances by however long the last
 * frame took, in 5 ms steps, capped so that a tab returning from the background
 * does not try to catch up on forty seconds of flight in one frame.
 */
"use strict";

(function () {
    const M = window.MathX, V = window.Vehicle, WM = window.WorldMod;
    const SC = window.Scenarios, NN = window.NN, AP = window.AutopilotMod;
    const DEG = Math.PI / 180;

    const el = (id) => document.getElementById(id);
    const canvas = el("view");

    /* ------------------------------------------------------------- state */
    let scene = null;
    let world = null, sc = null;
    let policy = null, policyKind = "brain";
    let brain = null, brainMeta = null;
    let autopilot = new AP.Autopilot();
    let bpolicy = null;
    let randBrain = null, rpolicy = null, randSeed = 0;
    let library = [], libIndex = 0;
    let sensorsOn = false, skipTo = 0, nightOn = false;
    const cmd = new Float64Array(WM.N_OUT);

    let playing = true, speed = 1.0, accum = 0, ctrlPhase = 0;
    let stage = 0, seed = 1;
    let finishedAt = 0;

    const OUT_LABEL = {
        1: ["CAUGHT", "on the rails"],
        2: ["LANDED", "on the legs, on the pad"],
        3: ["SOFT DIVERT", "survivable arrival in the safe area"],
        4: ["CRASH", "arrived, did not survive it"],
        5: ["MISSED", "passed the rails outside the capture box"],
        6: ["TOWER STRIKE", "hit the structure"],
        7: ["BREAKUP", "structural limit exceeded"],
        8: ["TUMBLE", "lost attitude control"],
        9: ["OUT OF BOUNDS", "left the range"],
        10: ["TIMEOUT", "ran the clock out"]
    };

    /* ---------------------------------------------------------- the brain */

    /* The library ships weights as base64 little-endian Float32 — a tenth of
     * the size of the same numbers written as JSON decimals, which matters once
     * there is more than one champion in the file. */
    function decodeWeights(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Float32Array(bytes.buffer);
    }

    function brainFromEntry(e) {
        return NN.Brain.fromJSON({
            spec: e.spec, act: e.act, sizes: e.sizes, scales: e.scales,
            weights: e.w.map(decodeWeights)
        });
    }

    /* Already sorted best-first by sync_champion.js; sorted again here so the
     * page is right even if the file was assembled by something else.
     *
     * RANK ON `live`, NOT ON `exam`. `exam` is the mean over ALL SEVEN stages,
     * and while training is pinned to stage 0 the other six are stages the
     * population has never flown — noise. Sorting on it put the WORST champion
     * (canonical 0.357) at the top of the selector and served it as the page's
     * default, labelled with a number that describes stages it never saw.
     * `live` is the mean over the stages the brain was actually trained on,
     * re-measured under the canonical reward. Fall back to `exam` only for
     * entries archived before that field existed. */
    const rankScore = (e) => (e.live != null ? e.live : e.exam);
    function loadLibrary() {
        const lib = window.BRAIN_LIBRARY;
        if (!lib || !lib.length) return false;
        library = lib.slice().sort((a, b) => rankScore(b) - rankScore(a));
        return selectIndividual(0);
    }

    function selectIndividual(i) {
        const e = library[i];
        if (!e) return false;
        try {
            brain = brainFromEntry(e);
            brainMeta = e;
            libIndex = i;
            // The observation layout travels with the library entry: 139- and
            // 209-input champions coexist on this page and need different
            // sensor vectors built from the same world.
            bpolicy = new NN.BrainPolicy(brain, { lags: e.lags });
            return true;
        } catch (err) { console.warn("brain load failed", err); return false; }
    }

    function describeBrain() {
        const p = el("brain-meta");
        if (!brain) {
            el("fld-indiv").hidden = true;
            p.innerHTML = `<b>None synced yet</b> — flying an untrained network.`;
            return;
        }
        const m = brainMeta || {};
        p.innerHTML =
            (m.id ? `<b>${m.id}</b> · gen ${m.gen != null ? m.gen : "?"}<br>` : "") +
            `${brain.net.sizes.join("·")} ${brain.act} · ` +
            `${(brain.weightCount() / 1000).toFixed(1)}k weights<br>` +
            (rankScore(m) != null ? `held-out <b>${Number(rankScore(m)).toFixed(3)}</b>` +
                (m.stages ? ` <span class="dim">(stage ${m.stages.join(",")})</span>` : "") : "") +
            (m.caught != null ? ` · ${m.caught} caught` : "");
    }

    /* A fresh, never-trained network — generation zero, straight out of the
     * initialiser. Worth watching precisely because it is so bad: it lights
     * engines at the wrong moment, holds one throttle setting all the way down
     * and arrives at whatever speed gravity gives it. Everything the trained
     * champion does had to be found from something like this. */
    function rollRandom() {
        randSeed = 1 + Math.floor(Math.random() * 2000000000);
        const spec = NN.netSpec(window.SensorsMod.N_INPUT, "std");
        randBrain = new NN.Brain(spec, NN.mulberry32(randSeed));
        rpolicy = new NN.BrainPolicy(randBrain);
        return randBrain;
    }

    /* -------------------------------------------------------- the episode */
    function buildScenario() {
        sc = SC.makeScenario(stage, seed);
        world = new WM.World(sc);
        autopilot.reset();
        if (bpolicy) bpolicy.reset();
        if (rpolicy) rpolicy.reset();
        accum = 0; ctrlPhase = 0; finishedAt = 0;
        scene.buildVehicle(sc.vehicle);
        scene.setTargets(sc);
        scene.clearTrail();
        scene.resetEffects();       // re-arm the one-shot splash for the new episode
        el("scen-desc").textContent = SC.describe(sc);
        el("badge-outcome").hidden = true;
        el("verdict").hidden = true;
        updateModeBadge();
        cmd.fill(0);
        /* Run the policy once before the clock starts. Without it the outputs
         * and the net view are blank until the first control tick, so a page
         * that loads paused — or is photographed — shows an empty brain. */
        pilot(world, cmd);
        /* ?t=8 jumps straight to eight seconds of flight. Purely a harness
         * convenience — the screenshot tool cannot photograph a running page
         * (see ?pause) so without this every picture is of a vehicle that has
         * not started falling yet. */
        if (skipTo > 0) {
            let g = 0;
            while (world.outcome === WM.OUTCOME.FLYING && world.t < skipTo && g++ < 200000) {
                if (ctrlPhase === 0) { pilot(world, cmd); world.applyControl(cmd); }
                ctrlPhase = (ctrlPhase + 1) % WM.CTRL_EVERY;
                world.step(WM.DT_PHYS);
            }
        }
        step(0);
    }

    function updateModeBadge() {
        const b = el("badge-mode");
        if (!world) return;
        if (world.catchAllowed) { b.textContent = "TOWER CLEARED"; b.className = "badge ok"; }
        else { b.textContent = "DIVERT"; b.className = "badge warn"; }
        scene.setCatchLight(!!world.catchAllowed);
    }

    function pilot(w, out) {
        if (policyKind === "brain" && bpolicy) bpolicy.act(w, out);
        else if (policyKind === "random" && rpolicy) rpolicy.act(w, out);
        else if (policyKind === "auto") autopilot.act(w, out);
        else AP.inertPolicy(w, out);
    }

    /* One real-time slice. */
    function step(dtReal) {
        if (!world) return;
        if (world.outcome !== WM.OUTCOME.FLYING) return;
        // Cap the catch-up so a backgrounded tab does not simulate a whole
        // episode in one frame and then show only the wreck.
        accum += Math.min(dtReal, 0.12) * speed;
        let guard = 0;
        while (accum >= WM.DT_PHYS && world.outcome === WM.OUTCOME.FLYING && guard++ < 4000) {
            if (ctrlPhase === 0) {
                pilot(world, cmd);
                world.applyControl(cmd);
            }
            ctrlPhase = (ctrlPhase + 1) % WM.CTRL_EVERY;
            world.step(WM.DT_PHYS);
            accum -= WM.DT_PHYS;
        }
        if (world.outcome !== WM.OUTCOME.FLYING && !finishedAt) {
            finishedAt = performance.now();
            showOutcome();
        }
    }

    function showOutcome() {
        const s = world.score();
        const [title, sub] = OUT_LABEL[world.outcome] || ["—", ""];
        const good = world.outcome === WM.OUTCOME.CAUGHT || world.outcome === WM.OUTCOME.LANDED
            || world.outcome === WM.OUTCOME.SOFT_DIVERT;
        const v = el("verdict");
        v.hidden = false;
        v.className = good ? "good" : "bad";
        el("verdict-text").textContent = title;
        const t = s.terminal;
        el("verdict-sub").textContent =
            `${sub} · ${t.vzBase.toFixed(1)} m/s down, ${t.vhBase.toFixed(1)} m/s across, ` +
            `${(t.tilt / DEG).toFixed(1)}° off vertical · score ${s.total.toFixed(2)}`;
        const b = el("badge-outcome");
        b.hidden = false;
        b.textContent = title;
        b.className = "badge outcome " + (good ? "ok" : "warn");
    }

    /* ----------------------------------------------------------------- ui */
    function buildUI() {
        const sel = el("sel-stage");
        SC.STAGES.forEach((s) => {
            const o = document.createElement("option");
            o.value = String(s.id);
            o.textContent = s.label;
            sel.appendChild(o);
        });
        sel.value = "0";
        sel.addEventListener("change", () => { stage = +sel.value; newSeed(); });

        el("btn-new").addEventListener("click", newSeed);
        el("btn-replay").addEventListener("click", buildScenario);

        /* The individual picker. Ordered by held-out score, and the ordering is
         * stated on the label — a list of champions reads as chronological
         * unless you say otherwise, and here a later generation is quite often
         * worse than an earlier one. */
        const si = el("sel-indiv");
        library.forEach((e, i) => {
            const o = document.createElement("option");
            o.value = String(i);
            o.textContent = `#${i + 1} · ${Number(rankScore(e)).toFixed(3)} · gen ${e.gen} · ${e.id}` +
                (e.caught ? ` · ${e.caught}✓` : "");
            si.appendChild(o);
        });
        if (!library.length) {
            const o = document.createElement("option");
            o.textContent = "none synced yet";
            si.appendChild(o);
            si.disabled = true;
        }
        si.addEventListener("change", () => {
            if (selectIndividual(+si.value)) { describeBrain(); describePilot(); buildScenario(); }
        });
        el("fld-indiv").hidden = !library.length;

        const pk = el("sel-pilot");
        rollRandom();
        if (!brain) {
            // Nothing has been synced yet: show the untrained network by
            // default rather than the scripted controller, because the point of
            // the page is the network.
            pk.value = "random";
            policyKind = "random";
            const o = pk.querySelector('option[value="brain"]');
            o.disabled = true;
            o.textContent = "Evolved network (none synced yet)";
        }
        pk.addEventListener("change", () => {
            policyKind = pk.value;
            el("row-reroll").hidden = policyKind !== "random";
            describePilot(); buildScenario();
        });
        el("row-reroll").hidden = policyKind !== "random";
        el("btn-reroll").addEventListener("click", () => { rollRandom(); describePilot(); buildScenario(); });

        el("btn-play").addEventListener("click", () => {
            playing = !playing;
            el("btn-play").textContent = playing ? "⏸ Pause" : "▶ Play";
        });
        const rs = el("rng-speed");
        rs.addEventListener("input", () => {
            speed = Math.pow(2, +rs.value);
            el("lbl-speed").textContent = speed.toFixed(speed < 1 ? 2 : 1) + "×";
        });
        el("sel-cam").addEventListener("change", (e) => { scene.camMode = e.target.value; });
        // keep the drop-down honest when a drag takes the camera into orbit
        scene.onCamModeChange = (m) => { el("sel-cam").value = m; };

        /* Night mode. Purely cosmetic — it changes the sky, the two key lights,
         * the fog and which of the site's lights are switched on, and touches
         * nothing the simulation reads. The viewport's CSS background has to
         * follow it too: it is what shows in the frame before the first WebGL
         * present, and a white flash into a night scene is very visible. */
        const nb = el("btn-night");
        const setNight = (on) => {
            nightOn = on;
            scene.setNight(on);
            nb.textContent = on ? "☀ Day" : "🌙 Night";
            nb.classList.toggle("on", on);
            el("viewport").style.background = on ? "#080b12" : "#9fc4e0";
        };
        nb.addEventListener("click", () => setNight(!nightOn));

        /* The sensor overlay. Worth being precise in the caption about what it
         * is NOT: this vehicle carries no rangefinder and casts no rays. Every
         * one of the two hundred inputs is derived state — where it is pointing,
         * what the air is doing to it, where the two possible destinations are —
         * so the overlay draws frames and vectors. Drawing beams would look
         * better and would misrepresent the model. */
        const sb = el("btn-sensors");
        sb.addEventListener("click", () => {
            sensorsOn = !sensorsOn;
            scene.setSensorsVisible(sensorsOn);
            sb.textContent = sensorsOn ? "👁 Hide what it senses" : "👁 Show what it senses";
            sb.classList.toggle("on", sensorsOn);
            const d = el("sensor-desc");
            d.hidden = !sensorsOn;
            d.innerHTML =
                `<b>No rangefinders.</b> Nothing is cast at the world — every input is
                 derived state, so the overlay draws frames and vectors:<br>
                 <span class="key" style="--k:#63d9ff"></span>nose axis, what <b>tilt</b> is measured from ·
                 <span class="key" style="--k:#ffa657"></span>belly ·
                 <span class="key" style="--k:#b98bff"></span>side ·
                 <span class="key" style="--k:#ff6b6b"></span>airflow, with the
                 <span class="key" style="--k:#ffd166"></span><b>angle of attack</b> between ·
                 <span class="key" style="--k:#ffe66d"></span>velocity ·
                 <span class="key" style="--k:#6ee7a0"></span>to the rails, measured
                 <b>from the catch pins</b> ·
                 <span class="key" style="--k:#8fffcf"></span>body rate.
                 The faint rings are the twenty <b>strip stations</b> the aerodynamics
                 integrates over.`;
        });

        const bars = el("bars");
        const names = ["throttle", "engines", "gimbal ↑", "gimbal →", "surf 1", "surf 2", "surf 3", "surf 4", "legs", "commit"];
        names.forEach((n, i) => {
            const d = document.createElement("div");
            d.className = "bar";
            d.innerHTML = `<span>${n}</span><i><u id="b${i}"></u></i>`;
            bars.appendChild(d);
        });

        el("intro-go").addEventListener("click", () => { el("intro").hidden = true; });
        /* ?nointro skips the splash. Used by the screenshot harness and by the
         * gallery thumbnail, which otherwise photographs a modal. */
        const qs = location.search || "";
        if (/nointro/.test(qs)) el("intro").hidden = true;
        /* ?pause starts held. The screenshot harness needs it: with the
         * simulation running the page never goes idle, and Chrome's
         * --virtual-time-budget waits for idle before it will take the shot. */
        if (/[?&]pause/.test(qs)) { playing = false; el("btn-play").textContent = "▶ Play"; }
        const mT = qs.match(/[?&]t=([\d.]+)/); if (mT) skipTo = +mT[1];
        const mS = qs.match(/[?&]stage=(\d)/); if (mS) { stage = +mS[1]; sel.value = String(stage); }
        const mC = qs.match(/[?&]cam=(\w+)/); if (mC) { scene.camMode = mC[1]; el("sel-cam").value = mC[1]; }
        if (/[?&]sensors/.test(qs)) sb.click();
        if (/[?&]night/.test(qs)) setNight(true);
        describePilot();
    }

    function describePilot() {
        const p = el("pilot-desc");
        if (policyKind === "brain") {
            const e = library[libIndex];
            p.innerHTML = "The evolved network" + (e ? ` <b>${e.id}</b>, ranked #${libIndex + 1} of ${library.length} by held-out score` : "") +
                ". It has never seen this scenario — the exam and training banks are disjoint from these seeds.";
        }
        else if (policyKind === "random") p.innerHTML = "An <b>untrained</b> network, seed " + randSeed +
            ", drawn fresh from the initialiser. This is generation zero: what evolution starts from, and what it has to turn into a landing.";
        else if (policyKind === "auto") p.textContent = "A hand-written thrust-vector controller with a hoverslam guidance law. It is NOT what flies the trained vehicle — it exists only to prove the environment is flyable, and as a reference point.";
        else p.textContent = "No control at all: engines cold, fins centred. A booster is aerodynamically stable tail-first, so it falls straight — and hits the ground at 250 m/s.";
    }

    function newSeed() {
        seed = 1 + Math.floor(Math.random() * 900000000);
        buildScenario();
    }

    /* ---------------------------------------------------------- hud/frame */
    let lastNet = 0;
    function updateHud() {
        if (!world) return;
        const now = performance.now();
        const t = world.tel;
        el("hud-clock").textContent = world.t.toFixed(1) + "s";
        el("hud-alt").textContent = (t.agl > 999 ? (t.agl / 1000).toFixed(2) + " km" : t.agl.toFixed(0) + " m");
        el("hud-vel").textContent = M.vlen(world.v).toFixed(0) + " m/s";
        el("hud-tilt").textContent = (t.tilt / DEG).toFixed(1) + "°";
        el("hud-eng").textContent = world.act.liveEngines() + (world.act.ignitions > 0 ? "" : " ⌀");
        el("hud-prop").textContent = (world.prop / 1000).toFixed(1) + " t";
        el("hud-mach").textContent = t.mach.toFixed(2);
        el("hud-q").textContent = (t.q / 1000).toFixed(1) + " kPa";
        el("hud-aoa").textContent = (t.alpha / DEG).toFixed(0) + "°";
        el("hud-thr").textContent = (world.act.throttle * 100).toFixed(0) + "%";
        const gd = Math.hypot(t.pinX - V.TOWER.gateX, t.pinY - V.TOWER.gateY);
        el("hud-gate").textContent = world.catchAllowed
            ? gd.toFixed(1) + " m / " + (t.pinZ - V.TOWER.armZ).toFixed(0) + " m"
            : Math.hypot(t.toGroundX, t.toGroundY).toFixed(0) + " m to the pad";

        for (let i = 0; i < WM.N_OUT; i++) {
            const b = el("b" + i);
            if (!b) continue;
            const v = M.clamp(cmd[i], -1, 1);
            b.style.left = (50 + Math.min(0, v) * 50) + "%";
            b.style.width = Math.abs(v) * 50 + "%";
            b.style.background = v >= 0 ? "#5ad19a" : "#ef7d6a";
        }

        const s = world.score();
        el("score-live").innerHTML =
            `<b>${s.total.toFixed(2)}</b> <span class="small">` +
            `arr ${s.parts.arrival.toFixed(2)} · up ${s.parts.upright.toFixed(2)} · ` +
            `appr ${s.parts.progress.toFixed(2)}` +
            (s.parts.tier ? ` · <b>+${s.parts.tier.toFixed(1)}</b>` : "") +
            (s.parts.penalty ? ` · pen ${s.parts.penalty.toFixed(2)}` : "") +
            `</span>`;
        updateModeBadge();
        /* THE NET VIEW IS THROTTLED TO THE CONTROL RATE. The network runs at
         * 20 Hz, so redrawing it at 144 Hz shows the same activations three
         * times over while spending three times the canvas work — and this is
         * a few hundred strokes per pass, next to a WebGL scene that wants the
         * frame budget more. */
        const tNow = performance.now();
        if (tNow - lastNet > 48) { lastNet = tNow; drawNet(); }
    }

    /* ------------------------------------------------------ the net view ---
     * The activations are already sitting in the network's own layer buffers
     * after each forward pass, so this costs nothing to read — `buf[0]` is the
     * 200-input observation, `buf[3]` the ten commands, and the two hidden
     * layers in between.
     *
     * Four heat strips rather than four rings of circles: at 128 and 96 units a
     * node-and-edge diagram is 25 000 lines and reads as a grey smear. A strip
     * where every cell is one neuron, red for negative and green for positive,
     * shows the thing that is actually interesting — how much of the layer is
     * saturated, and how that changes through a manoeuvre.
     *
     * The edges drawn are real and are the ones worth seeing: the strongest
     * signed contributions w·a into the ten outputs, recomputed every frame.
     * That is the layer whose wiring has a meaning you can state out loud —
     * "these hidden units are what is holding the throttle down".
     */
    function activeNet() {
        if (policyKind === "brain" && brain) return brain.net;
        if (policyKind === "random" && randBrain) return randBrain.net;
        return null;
    }

    function drawNet() {
        const cv = el("netview");
        if (!cv) return;
        const ctx = cv.getContext("2d");
        const W = cv.width, H = cv.height;
        ctx.clearRect(0, 0, W, H);
        const net = activeNet();
        if (!net) {
            ctx.fillStyle = "#5c6b7d";
            ctx.font = "500 20px ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.fillText("no network in the loop", W / 2, H / 2);
            ctx.font = "400 17px ui-monospace, monospace";
            ctx.fillText(policyKind === "auto" ? "(scripted autopilot)" : "(no control at all)", W / 2, H / 2 + 24);
            return;
        }

        const buf = net.buf, sizes = net.sizes, nL = sizes.length;
        const padT = 20, padB = 16;
        const colW = [26, 20, 20, 26];
        const xs = [10, Math.round(W * 0.36), Math.round(W * 0.64), W - 36];
        const top = padT, botH = H - padT - padB;

        /* edges into the outputs: top-K signed contributions */
        const last = nL - 2;
        const wLast = net.weights[last];
        const nIn = sizes[last], nOut = sizes[last + 1];
        const aIn = buf[last];
        const contrib = [];
        for (let o = 0; o < nOut; o++) {
            const base = o * (nIn + 1);
            for (let i = 0; i < nIn; i++) {
                const c = wLast[base + i] * aIn[i];
                if (c > 0.06 || c < -0.06) contrib.push([i, o, c]);
            }
        }
        contrib.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
        const K = Math.min(110, contrib.length);
        const yOf = (li, idx) => top + (idx + 0.5) / sizes[li] * botH;
        ctx.lineWidth = 1;
        for (let k = 0; k < K; k++) {
            const [i, o, c] = contrib[k];
            const a = Math.min(0.5, Math.abs(c) * 0.5);
            ctx.strokeStyle = c >= 0 ? `rgba(90,209,154,${a})` : `rgba(239,125,106,${a})`;
            ctx.beginPath();
            ctx.moveTo(xs[2] + colW[2], yOf(2, i));
            ctx.lineTo(xs[3], yOf(3, o));
            ctx.stroke();
        }

        /* a faint, fixed sample of the earlier wiring — enough to read as a
         * network, cheap enough to redraw at 60 Hz */
        if (!drawNet.sample) {
            drawNet.sample = [];
            let s = 12345;
            const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
            for (let l = 0; l < 2; l++) {
                const pairs = [];
                for (let n = 0; n < 130; n++) {
                    pairs.push([Math.floor(rnd() * sizes[l]), Math.floor(rnd() * sizes[l + 1])]);
                }
                drawNet.sample.push(pairs);
            }
        }
        for (let l = 0; l < 2; l++) {
            const wl = net.weights[l], ni = sizes[l];
            const ai = buf[l], aj = buf[l + 1];
            for (const [i, o] of drawNet.sample[l]) {
                const c = wl[o * (ni + 1) + i] * ai[i] * aj[o];
                const a = Math.min(0.22, Math.abs(c) * 0.5);
                if (a < 0.012) continue;
                ctx.strokeStyle = c >= 0 ? `rgba(90,209,154,${a})` : `rgba(239,125,106,${a})`;
                ctx.beginPath();
                ctx.moveTo(xs[l] + colW[l], yOf(l, i));
                ctx.lineTo(xs[l + 1], yOf(l + 1, o));
                ctx.stroke();
            }
        }

        /* the layers themselves */
        for (let l = 0; l < nL; l++) {
            const n = sizes[l], a = buf[l];
            const ch = botH / n;
            for (let i = 0; i < n; i++) {
                const v = M.clamp(a[i], -1, 1);
                const m = Math.abs(v);
                /* A quiet neuron still gets a visible cell. Fading it to the
                 * background makes the strip look like it has holes in it, and
                 * "this unit is silent" and "this unit does not exist" are very
                 * different statements to make to someone watching. */
                const g = Math.pow(m, 0.55);
                ctx.fillStyle = v >= 0
                    ? `rgb(${Math.round(52 + 38 * g)},${Math.round(64 + 145 * g)},${Math.round(76 + 62 * g)})`
                    : `rgb(${Math.round(76 + 163 * g)},${Math.round(64 + 61 * g)},${Math.round(76 + 30 * g)})`;
                ctx.fillRect(xs[l], top + i * ch, colW[l], Math.max(1, ch - (ch > 3 ? 1 : 0)));
            }
            ctx.strokeStyle = "rgba(150,175,200,0.30)";
            ctx.strokeRect(xs[l] - 0.5, top - 0.5, colW[l] + 1, botH + 1);
            ctx.fillStyle = "#7d8ea1";
            ctx.font = "500 15px ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.fillText(String(n), xs[l] + colW[l] / 2, top - 6);
        }

        /* the three bands of the observation, marked on the input column:
         * instantaneous state, the differenced three-second window, and the
         * last command the network gave. */
        const S = window.SensorsMod;
        const marks = [[S.N_INSTANT, "now"], [S.N_INSTANT + S.N_TEMPORAL, "3 s"]];
        ctx.textAlign = "left";
        ctx.font = "500 14px ui-monospace, monospace";
        for (const [idx, txt] of marks) {
            const y = top + (idx / sizes[0]) * botH;
            ctx.strokeStyle = "rgba(190,210,235,0.55)";
            ctx.beginPath(); ctx.moveTo(xs[0] - 5, y); ctx.lineTo(xs[0] + colW[0] + 4, y); ctx.stroke();
            ctx.fillStyle = "#93a5b8";
            ctx.fillText(txt, xs[0] + colW[0] + 7, y + 5);
        }
    }

    /* --------------------------------------------------------------- boot */
    function resize() {
        const r = el("viewport").getBoundingClientRect();
        scene.resize(Math.max(1, r.width), Math.max(1, r.height), 1.6);
        /* The net view is drawn at twice CSS resolution: at 128 and 96 units a
         * neuron is barely a pixel tall, and at 1x the strips alias into a
         * grey blur that always looks the same whatever the network does. */
        const cv = el("netview");
        if (cv) {
            const w = Math.max(120, cv.clientWidth || cv.parentElement.clientWidth);
            cv.width = Math.round(w * 2);
            cv.height = Math.round(200 * 2);
            drawNet();
        }
    }

    let last = 0;
    function frame(now) {
        const dt = last ? (now - last) / 1000 : 0;
        last = now;
        if (playing) step(dt);
        scene.update(world, null);
        scene.placeCamera(world, null);
        scene.render();
        updateHud();
        // auto-advance a few seconds after the episode ends
        if (finishedAt && now - finishedAt > 4200) newSeed();
        requestAnimationFrame(frame);
    }

    function boot() {
        scene = new RNDR.Scene(canvas);
        loadLibrary();
        describeBrain();
        buildUI();
        el("net-legend").innerHTML =
            "every cell is one neuron · <b style='color:#5ad19a'>green</b> positive, " +
            "<b style='color:#ef7d6a'>red</b> negative · the edges into the ten outputs are " +
            "the strongest live contributions, redrawn every frame";
        window.addEventListener("resize", resize);
        resize();
        newSeed();
        requestAnimationFrame(frame);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
