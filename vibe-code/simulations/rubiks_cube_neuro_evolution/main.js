/* main.js — the page. A player, not a trainer.
 *
 * Training happens in Node (train_headless.js), because a generation is 30,000
 * episodes and a browser tab is the wrong place for that. What this page does is
 * the part that is worth watching: hand the evolved champion a cube it has never
 * seen and step it, one look and one turn at a time, slowly enough to follow.
 *
 * The episode it drives is `Runner` from env.js — the same object, the same
 * observation assembly, the same argmax — advanced from a timer instead of a
 * while-loop. There is no second implementation of "one move" anywhere in this
 * project, which is the only reason the number on screen can be trusted to be the
 * number the trainer optimised.
 */
"use strict";
(function () {

    const $ = id => document.getElementById(id);
    const el = (tag, cls, txt) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt !== undefined) e.textContent = txt;
        return e;
    };

    /* ─────────────────────────────────────────────────────── configuration */

    /* The champion carries its own config, and it must: a brain is a set of
     * weights against one exact observation layout and one exact action space.
     * Reading the page's current defaults instead would work right up until the
     * defaults changed, and then the page would feed the champion garbage and
     * present the result as the champion's ability. */
    /* One baked brain: the gradient-trained one, which is the only brain this project
     * produced that solves depth 7 more than half the time. The evolved champion it is
     * named for is kept at training/evolved_brain.js and is not loaded here. */
    const BAKED = window.DEFAULT_BRAIN || null;
    const baseCfg = resolveConfig(BAKED && BAKED.config ? BAKED.config : "default");

    /* Two overrides, both display-only and both deliberate.
     *
     * oracleRadius 6 rather than the trainer's 7: the distance table is only a
     * readout here, and depth 7 is ~200k states and 60 MB to build on load, which
     * is a poor trade for a phone. Distances past the radius show as "≥7".
     *
     * depthCapOverride 12: the trainer must never scramble deeper than the oracle
     * can see, but somebody watching the page should be allowed to hand the
     * champion a cube well past what it was trained on and see what happens. */
    const pageCfg = JSON.parse(JSON.stringify(baseCfg));
    pageCfg.env.oracleRadius = 6;
    pageCfg.env.depthCapOverride = 12;
    pageCfg.env.forceOracle = true;

    const env = new Env(pageCfg.env);
    const geom = CUBE_GEOM;
    const MAX_DEPTH = 12;

    /* ───────────────────────────────────────────────────────────── brains */

    /* The baked brain is held to *its own* declared architecture against this page's
     * input layout. Those are two different obligations: the head may be any shape,
     * but a brain whose observation layout disagrees with the page's is refused rather
     * than fed garbage — a champion under the wrong layout does not degrade, it reads
     * noise, and the page would present the result as its ability. */
    function loadBaked(baked, fallbackLabel) {
        if (!baked) return null;
        try {
            const cfg = resolveConfig(baked.config || "default");
            const n = netFromJSON(baked);
            const want = env.contractInfo(cfg.arch).contract;
            if (n.contract() !== want) {
                return { net: null,
                    info: `${fallbackLabel} is ${n.contract()} but this page builds ${want} — not loaded` };
            }
            const v = baked.validation;
            const origin = baked.distilled
                ? "trained by gradient descent"
                : `evolved to generation ${baked.gen}`;
            return {
                net: n,
                info: `${origin} · ${n.paramCount.toLocaleString("en-US")} weights` +
                    (v && v.depthAt50 ? ` · solves depth ${v.depthAt50} at least half the time` : ""),
            };
        } catch (e) {
            return { net: null, info: `${fallbackLabel} failed to load: ${e.message}` };
        }
    }

    const LOADED = loadBaked(BAKED, "the built-in champion");
    let champion = LOADED && LOADED.net ? LOADED.net : null;
    let championInfo = LOADED ? LOADED.info
        : "no built-in champion in this build — showing an untrained brain";

    /* If the baked brain ever fails its contract check the page still runs, on an
     * untrained net, and says so — a blank page hides the failure, and a page that
     * silently substitutes a random brain misattributes it. */
    let net = champion || buildNet(pageCfg.arch, env.layout, mulberry32(20260817));

    /* ────────────────────────────────────────────────────────────── views */

    const front = new CubeView($("view-front"), geom, { orbit: true, zoom: 1.12 });
    /* Where the far side of the cube used to be. The far side is already inside the
     * observation — panel 1 of the render looks down the opposite corner and sees D, B
     * and L — so that box showed the human something the inset below it was already
     * showing the network, while the network itself appeared only as eight bars. */
    const netView = new NetView($("view-net"), {
        names: env.set.map(m => m.name),
        inputCols: env.cfg.pixels ? env.plan.W : 0,
    });
    const inputCanvas = $("view-input");

    /* ─────────────────────────────────────────────────────────── episode */

    let run = null, scr = null, playing = false, anim = null;
    let distTrace = [], epLog = [];
    let manualState = null;                  // set when the human has taken over

    function newScramble(depth) {
        const d = Math.max(1, Math.min(MAX_DEPTH, depth));
        /* One scramble, drawn fresh. Not from a bank: a bank exists to make two
         * brains comparable, and there is only one brain here. */
        const rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
        const s = scramble(rng, d, env.set);
        const d0 = distanceOf(env.oracle, s.state);
        return {
            state: s.state.slice(), depth: d, d0,
            budget: env.budgetFor(d0),
            seq: s.seq.map(m => m.name),
        };
    }

    function startEpisode(scrambleOverride) {
        scr = scrambleOverride || newScramble(+$("sl-depth").value);
        run = env.newRunner(net, scr);
        run.peek();
        distTrace = [run.d0];
        anim = null;
        manualState = null;
        render();
        refreshStats();
    }

    function startSolved() {
        startEpisode({
            state: solved(), depth: 0, d0: 0, budget: env.cfg.budget.max, seq: [],
        });
    }

    /* One move, then repaint. `forced` is a move index when the human pressed a
     * turn button. */
    function doMove(forced) {
        if (!run || run.done) return;
        const before = run.state.slice();
        const local = forced === undefined
            ? chooseMove(run.peek())
            : forced;
        const move = env.set[local];
        run.step(local);
        distTrace.push(run.d);
        if (forced !== undefined) manualState = true;

        if ($("chk-anim").checked) {
            /* Animate from the pre-move cube: the model has already permuted, so
             * the sweep is drawn on the old state and the new one is only shown
             * once the sweep completes. */
            anim = { move, progress: 0, from: before, t0: performance.now(), dur: animDuration() };
        } else {
            anim = null;
            render();
        }
        if (run.done) finishEpisode();
        refreshStats();
    }

    /* The turn sweep is capped so it never outruns the gap between moves: at 20
     * moves/second a 220 ms animation would still be spinning when the next move
     * lands, and the cube would visibly lag the move list. */
    function animDuration() {
        const mps = movesPerSecond();
        return Math.min(240, Math.max(45, 700 / Math.max(1, mps)));
    }
    function movesPerSecond() { return +$("sl-speed").value / 10; }

    function finishEpisode() {
        const tr = run.trace();
        epLog.unshift({
            depth: scr.depth, d0: run.d0, solved: tr.solved, moves: tr.moves,
            budget: run.budget, best: tr.dBest, manual: !!manualState,
        });
        epLog = epLog.slice(0, 40);
        drawLog();
        if (playing && $("chk-loop").checked) {
            setTimeout(() => { if (playing) startEpisode(); }, 900);
        } else {
            playing = false;
            syncPlayButton();
        }
    }

    /* ──────────────────────────────────────────────────────────── drawing */

    function render() {
        const showState = anim ? anim.from : run.state;
        front.draw(showState, anim);
        drawInput();
        drawNet();
    }

    /* The inset's backing store is an exact integer multiple of the observation,
     * and its CSS size is set to match. Both halves matter: an arbitrary backing
     * store makes nearest-neighbour magnification land between pixels and the
     * sticker grid shimmers, and leaving the element at `width: 100%` lets the
     * browser stretch a 2:1 image into whatever box it is given — which on a phone
     * is a tall one, and produced an inset that looked like a barcode. */
    function sizeInput() {
        const box = inputCanvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const availW = Math.max(32, box.width - 8), availH = Math.max(16, box.height - 8);
        const k = Math.max(1, Math.floor(Math.min(availW / env.plan.W, availH / env.plan.H)));
        const bw = env.plan.W * k, bh = env.plan.H * k;
        inputCanvas.width = Math.round(bw * dpr);
        inputCanvas.height = Math.round(bh * dpr);
        inputCanvas.style.width = bw + "px";
        inputCanvas.style.height = bh + "px";
        return k;
    }

    function drawInput() {
        if (!env.cfg.pixels) return;
        const k = sizeInput();
        drawObservation(inputCanvas, env.plan, run.obs.vec, 0, { centered: env.cfg.center });
        /* The full label wraps to two lines in the phone layout's short inset box
         * and covers a third of the picture it is labelling. */
        const roomy = inputCanvas.parentElement.getBoundingClientRect().width > 300;
        $("input-tag").textContent = roomy
            ? `what the brain sees · ${env.plan.W}×${env.plan.H} px ×${k}`
            : `${env.plan.W}×${env.plan.H} ×${k}`;
    }

    /* Driven by the observation on screen rather than by a schematic: NetView re-runs
     * the forward pass, so every cell drawn is this cube's activation. */
    function drawNet() {
        netView.resize();
        netView.update(net, run ? run.obs.vec : null);
        netView.draw();
        const tag = $("net-tag");
        if (!tag) return;
        const roomy = netView.canvas.getBoundingClientRect().width > 220;
        tag.textContent = roomy
            ? `inside the network · ${net.paramCount.toLocaleString("en-US")} weights`
            : "inside the network";
    }

    front.onOrbit = () => { if (run) front.draw(anim ? anim.from : run.state, anim); };

    let lastFrame = 0, moveAccum = 0;
    function frame(now) {
        requestAnimationFrame(frame);
        const dt = Math.min(0.25, (now - lastFrame) / 1000 || 0);
        lastFrame = now;
        if (!run) return;

        if (anim) {
            anim.progress = (now - anim.t0) / anim.dur;
            if (anim.progress >= 1) { anim = null; render(); }
            else {
                /* ease-in-out, so a quarter turn reads as one deliberate motion
                 * rather than a linear slide */
                const p = anim.progress;
                const e = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
                front.draw(anim.from, { move: anim.move, progress: e });
            }
        }

        if (playing && !run.done) {
            moveAccum += dt * movesPerSecond();
            if (moveAccum >= 1) { moveAccum = 0; doMove(); }
        }
    }

    /* ──────────────────────────────────────────────────────────── readouts */

    function distLabel(d) {
        if (d === null || d === undefined) return "–";
        return d > env.oracle.radius ? `≥${env.oracle.radius + 1}` : String(d);
    }

    function refreshStats() {
        if (!run) return;
        $("stat-move").textContent = `${run.moves}/${run.budget}`;
        $("stat-dist").textContent = distLabel(run.d);
        $("stat-stick").textContent = `${stickerScore(run.state)}/54`;
        const badge = $("stat-state");
        badge.textContent = run.solvedFlag ? "solved"
            : run.done ? "out of moves"
                : playing ? "solving" : "paused";
        badge.className = "tstat badge " + (run.solvedFlag ? "good" : run.done ? "bad" : "");

        $("ep-seq").textContent = scr.seq.length ? scr.seq.join(" ") : "(already solved)";
        $("ep-moves").textContent = run.history.length ? run.history.join(" ") : "–";
        $("ep-dist").textContent = `${distLabel(run.d)} (started at ${distLabel(run.d0)})`;
        $("ep-best").textContent = distLabel(run.dBest);
        $("ep-undo").textContent = `${run.undos} of ${run.moves}`;
        drawOutputs();
        drawDistChart();
    }

    const OUT_ROWS = [];
    function buildOutputs() {
        const host = $("outputs");
        host.innerHTML = "";
        for (const m of env.set) {
            const row = el("div", "obar");
            row.appendChild(el("span", "obar-name", m.name));
            const track = el("div", "obar-track");
            const fill = el("i");
            track.appendChild(fill);
            row.appendChild(track);
            const val = el("b", "obar-val", "–");
            row.appendChild(val);
            host.appendChild(row);
            OUT_ROWS.push({ row, fill, val });
        }
    }

    function drawOutputs() {
        const out = run && !run.done ? run.peek() : (run ? run.out : null);
        if (!out) return;
        let best = -Infinity, bi = 0;
        for (let i = 0; i < out.length; i++) if (out[i] > best) { best = out[i]; bi = i; }
        /* Rescaled to the spread actually present. The raw outputs of a trained
         * brain often sit inside a band of 0.02, and a bar chart drawn on the
         * absolute scale would show eight identical bars and tell you nothing about
         * a decision that is entirely real. */
        let lo = Infinity, hi = -Infinity;
        for (const v of out) { if (v < lo) lo = v; if (v > hi) hi = v; }
        const span = Math.max(1e-6, hi - lo);
        OUT_ROWS.forEach((r, i) => {
            r.fill.style.width = `${((out[i] - lo) / span * 100).toFixed(1)}%`;
            r.val.textContent = out[i].toFixed(3);
            r.row.classList.toggle("win", i === bi);
        });
    }

    /* The distance trace. Sized from its own box each draw rather than from the
     * fixed width/height attributes: the stylesheet stretches it to the panel, so
     * a fixed backing store gets a non-square pixel and every label comes out
     * squashed. */
    function drawDistChart() {
        const c = $("chart-dist"), ctx = c.getContext("2d");
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const boxW = c.clientWidth || 260, boxH = 104;
        c.style.height = boxH + "px";
        const W = Math.round(boxW * dpr), H = Math.round(boxH * dpr);
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, boxW, boxH);
        if (distTrace.length < 1) return;

        const maxD = Math.max(2, ...distTrace);
        const n = Math.max(2, run.budget + 1);
        const L = 20, R = 6, T = 8, B = 16;
        const x = i => L + i * (boxW - L - R) / (n - 1);
        const y = d => boxH - B - (d / maxD) * (boxH - T - B);

        /* One gridline per integer distance while they are far enough apart to
         * read, otherwise only 0 and the top — a 20-move episode past the oracle
         * radius otherwise draws a solid block. */
        const stepD = (boxH - T - B) / maxD < 9 ? Math.ceil(maxD / 5) : 1;
        ctx.strokeStyle = "rgba(255,255,255,0.09)";
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(255,255,255,0.42)";
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (let d = 0; d <= maxD; d += stepD) {
            ctx.beginPath();
            ctx.moveTo(L, Math.round(y(d)) + 0.5); ctx.lineTo(boxW - R, Math.round(y(d)) + 0.5);
            ctx.stroke();
            ctx.fillText(String(d), L - 5, y(d));
        }
        // the budget edge, so "ran out of moves" is visible as a wall
        ctx.strokeStyle = "rgba(255,95,107,0.35)";
        ctx.beginPath();
        ctx.moveTo(x(n - 1), T); ctx.lineTo(x(n - 1), boxH - B);
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillText("moves", (L + boxW - R) / 2, boxH - 5);

        ctx.strokeStyle = "#5ad0a0";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        distTrace.forEach((d, i) => { const px = x(i), py = y(d); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        ctx.stroke();
        distTrace.forEach((d, i) => {
            ctx.fillStyle = d === 0 ? "#ffc94d" : "#5ad0a0";
            ctx.beginPath(); ctx.arc(x(i), y(d), d === 0 ? 3.6 : 2.1, 0, 7); ctx.fill();
        });
    }

    function drawLog() {
        const host = $("log");
        host.innerHTML = "";
        if (!epLog.length) { host.appendChild(el("div", "log-row hint", "nothing yet")); return; }
        const solvedN = epLog.filter(e => e.solved).length;
        host.appendChild(el("div", "log-head",
            `${solvedN}/${epLog.length} solved this session`));
        for (const e of epLog.slice(0, 14)) {
            const row = el("div", "log-row " + (e.solved ? "good" : "bad"));
            row.appendChild(el("span", null, `d${e.depth}${e.d0 !== e.depth ? `(${e.d0})` : ""}`));
            row.appendChild(el("span", null, e.solved ? `solved in ${e.moves}` :
                `gave up at distance ${e.best > env.oracle.radius ? "≥7" : e.best}`));
            if (e.manual) row.appendChild(el("span", "tag", "your turns"));
            host.appendChild(row);
        }
    }

    /* ─────────────────────────────────────────────────────────── benchmark */

    /* Runs the champion and a set of untrained brains over identical held-out
     * scrambles. This is evaluate.js — the same function the grid search and
     * bake_brain.js use — so the number the page reports is the number in the
     * README, not a second opinion. */
    function runBench() {
        const out = $("bench-out");
        out.innerHTML = "";
        out.appendChild(el("div", "hint", "running…"));
        /* Yield first so the "running…" actually paints; a few hundred episodes of
         * conv forward passes will block this thread for a second or two. */
        setTimeout(() => {
            const per = +$("sl-bench").value;
            const depths = [1, 2, 3, 4, 5, 6].filter(d => d <= env.oracle.radius);
            const banks = makeEvalBanks(env, depths, per);
            const t0 = performance.now();
            const mine = evaluateBrain(env, net, banks);
            const ctrl = controlScore(env, pageCfg.arch, banks, 4);
            const ms = performance.now() - t0;

            out.innerHTML = "";
            const tbl = el("table", "bench");
            const head = el("tr");
            head.appendChild(el("th", null, "depth"));
            head.appendChild(el("th", null, "champion"));
            head.appendChild(el("th", null, "untrained"));
            tbl.appendChild(head);
            mine.byDepth.forEach((r, i) => {
                const tr = el("tr");
                tr.appendChild(el("td", null, String(r.depth)));
                const a = el("td", "num", `${(r.solveRate * 100).toFixed(0)}%`);
                if (r.solveRate >= 0.5) a.classList.add("good");
                tr.appendChild(a);
                tr.appendChild(el("td", "num dim", `${(ctrl.byDepth[i].solveRate * 100).toFixed(0)}%`));
                tbl.appendChild(tr);
            });
            out.appendChild(tbl);
            out.appendChild(el("div", "hint",
                `${banks.reduce((s, b) => s + b.scrambles.length, 0)} cubes per brain, none of them trained on. ` +
                `Score ${mine.score.toFixed(3)} against ${ctrl.score.toFixed(3)} untrained; ` +
                `deepest rung solved at least half the time: ${mine.depthAt50 || "none"}. ` +
                `(${(ms / 1000).toFixed(1)} s)`));
        }, 30);
    }

    /* ────────────────────────────────────────────────────────────── wiring */

    function syncPlayButton() {
        $("btn-play").textContent = playing ? "❚❚ Pause" : "▶ Play";
        $("btn-play").classList.toggle("primary", !playing);
        refreshStats();
    }

    $("btn-play").onclick = () => {
        if (run && run.done) startEpisode();
        playing = !playing;
        moveAccum = 0;
        syncPlayButton();
    };
    $("btn-step").onclick = () => {
        if (run && run.done) startEpisode(); else doMove();
    };
    $("btn-new").onclick = () => startEpisode();
    $("btn-reset").onclick = () => startEpisode();
    $("btn-solvedcube").onclick = () => { playing = false; syncPlayButton(); startSolved(); };
    $("btn-bench").onclick = runBench;

    $("sl-speed").oninput = () => {
        const mps = movesPerSecond();
        $("lb-speed").textContent = mps >= 10 ? `${mps.toFixed(0)} moves/s`
            : `${mps.toFixed(1)} moves/s`;
    };
    $("sl-depth").oninput = () => {
        const d = +$("sl-depth").value;
        $("lb-depth").textContent = `${d} turn${d === 1 ? "" : "s"}`;
        const trained = BAKED && BAKED.depth ? BAKED.depth : null;
        $("hint-depth").textContent = d > env.oracle.radius
            ? `Past the distance table's reach — the readout will show ≥${env.oracle.radius + 1}.`
            : trained && d > trained
                ? `Deeper than the champion's training frontier of ${trained}. Fair game, but do not expect much.`
                : "";
    };
    $("sl-bench").oninput = () => { $("lb-bench").textContent = $("sl-bench").value; };

    /* Manual turn buttons — the same eight actions, driven through the same
     * Runner.step so the observation window and move history advance identically. */
    function buildManualKeys() {
        const host = $("manual-keys");
        env.set.forEach((m, i) => {
            const b = el("button", "keybtn", m.name);
            b.title = `${FACE_NAMES[m.face]} face, ${m.dir > 0 ? "clockwise" : "anticlockwise"}`;
            b.onclick = () => {
                playing = false; syncPlayButton();
                if (!run || run.done) startEpisode(scr);
                doMove(i);
            };
            host.appendChild(b);
        });
    }

    /* A compact strip under the cube showing the move sequence so far. */
    function drawMoveBar() {
        const host = $("movebar");
        host.innerHTML = "";
        if (!run) return;
        const chip = (txt, cls) => host.appendChild(el("span", "chip " + (cls || ""), txt));
        chip(`scramble ${scr.seq.length ? scr.seq.join(" ") : "—"}`, "dim");
        chip("→");
        if (!run.history.length) chip("waiting", "dim");
        for (const h of run.history) chip(h);
        if (run.solvedFlag) chip("solved ✓", "good");
        else if (run.done) chip("out of moves", "bad");
    }
    const _refresh = refreshStats;
    refreshStats = function () { _refresh(); drawMoveBar(); };

    function resizeAll() {
        front.resize(); netView.resize();
        if (run) { render(); drawDistChart(); }
    }
    window.addEventListener("resize", resizeAll);
    /* A window resize event is not enough. The shared mobile layer moves the side
     * panels into a bottom sheet without the window changing size at all, so the
     * stage grows and every canvas keeps its old backing store — which is how the
     * phone layout ended up with a stretched inset and a cube parked in a corner.
     * Watching the stage itself catches that, and any other reflow. */
    if (window.ResizeObserver) {
        let pending = false;
        const ro = new ResizeObserver(() => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => { pending = false; resizeAll(); });
        });
        ro.observe($("stage"));
        ro.observe($("views"));
    }

    /* ─────────────────────────────────────────────────────────────── intro */

    /* URL parameters, for headless work: the thumbnail shot and the probe in
     * test_page.js both need the page in a specific state without a mouse.
     *   ?nointro=1   skip the choice modal
     *   ?depth=N     start at scramble depth N
     *   ?moves=N     play N moves synchronously before anything is drawn
     *   ?selftest=1  run the in-page assertions (see the bottom of this file)
     * Nothing here changes how the brain behaves; they only pick a starting view. */
    const Q = new URLSearchParams(location.search);

    const closeIntro = () => { $("intro").style.display = "none"; };
    $("intro-explore").onclick = closeIntro;
    $("intro-watch").onclick = () => {
        closeIntro(); startEpisode(); playing = true; syncPlayButton();
    };
    $("intro-eyes").onclick = () => {
        closeIntro();
        $("sl-speed").value = 8; $("sl-speed").oninput();
        document.getElementById("views").classList.add("emphasise-input");
        startEpisode(); playing = true; syncPlayButton();
    };
    $("intro-bench").onclick = () => {
        closeIntro(); $("sl-bench").value = 80; $("sl-bench").oninput();
        startEpisode(); runBench();
        /* window-qualified: mobile.js is the last script on the page, so a bare
         * `MobileUI` would be a ReferenceError rather than undefined if it ever
         * failed to load, and it would take the click handler with it. */
        if (window.MobileUI && MobileUI.isPhone && MobileUI.isPhone()) MobileUI.open(0);
    };
    $("intro-play").onclick = () => {
        closeIntro(); startSolved();
        if (window.MobileUI && MobileUI.isPhone && MobileUI.isPhone()) MobileUI.open(0);
    };

    /* ──────────────────────────────────────────────────────────────── boot */

    buildOutputs();
    buildManualKeys();
    $("sl-speed").oninput();
    $("sl-depth").oninput();
    $("sl-bench").oninput();
    /* Start the depth slider at the champion's training frontier, so the first
     * thing anybody sees is the task it was actually evolved for rather than an
     * arbitrary one. */
    if (BAKED && BAKED.depth) {
        $("sl-depth").value = Math.min(MAX_DEPTH, BAKED.depth);
        $("sl-depth").oninput();
    }
    if (Q.has("depth")) {
        $("sl-depth").value = Math.max(1, Math.min(MAX_DEPTH, +Q.get("depth")));
        $("sl-depth").oninput();
    }
    if (Q.has("nointro") || Q.has("selftest")) closeIntro();

    startEpisode();
    /* Synchronous warm-up. Under a virtual-time budget rAF barely fires, so a
     * headless screenshot of a mid-solve cube cannot be produced by waiting — the
     * moves have to be played before the first paint. */
    if (Q.has("moves")) {
        const n = Math.max(0, Math.min(40, +Q.get("moves")));
        const wasAnim = $("chk-anim").checked;
        $("chk-anim").checked = false;
        for (let i = 0; i < n && !run.done; i++) doMove();
        $("chk-anim").checked = wasAnim;
        render();
        refreshStats();
    }
    drawLog();
    requestAnimationFrame(frame);

    /* An in-page assertion pass, for headless verification. `?selftest=1` runs a
     * few checks that only make sense in a browser (the views paint, the inset
     * matches the observation) and writes the result where --dump-dom can find it.
     * The same trick as the food-delivery project; it exists because a screenshot
     * of a canvas cannot tell you whether the canvas is right. */
    if (/[?&]selftest=1/.test(location.search)) {
        const res = [];
        const t = (name, cond, extra) => res.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
        t("champion loaded", !!champion, championInfo);
        t("env built", env.layout.size > 0, `${env.layout.size} inputs, ${env.plan.W}×${env.plan.H}`);
        t("oracle built", !!env.oracle, env.oracle ? `${env.oracle.size} states` : "");
        const px = front.canvas.getContext("2d").getImageData(0, 0, front.canvas.width, front.canvas.height).data;
        let lit = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
        t("front view painted", lit > front.canvas.width * front.canvas.height * 0.2, `${lit} opaque px`);
        const ipx = inputCanvas.getContext("2d").getImageData(0, 0, inputCanvas.width, inputCanvas.height).data;
        let inkl = 0;
        for (let i = 3; i < ipx.length; i += 4) if (ipx[i] > 0) inkl++;
        t("input inset painted", inkl > 0, `${inkl} opaque px`);
        const before = run.moves;
        doMove();
        t("stepping advances the episode", run.moves === before + 1, `${before} → ${run.moves}`);
        const netCanvas = $("view-net");
        const npx = netCanvas.getContext("2d").getImageData(0, 0, netCanvas.width, netCanvas.height).data;
        let netl = 0;
        for (let i = 3; i < npx.length; i += 4) if (npx[i] > 0) netl++;
        t("network panel painted", netl > 0, `${netl} opaque px`);
        /* And painted from *this* brain's numbers. A panel whose picture survives the
         * network being swapped for an untrained one is a picture of nothing. */
        const outBefore = Array.from(netView.layers[netView.layers.length - 1].values);
        netView.update(buildNet(pageCfg.arch, env.layout, mulberry32(7)), run.obs.vec);
        const outAfter = Array.from(netView.layers[netView.layers.length - 1].values);
        t("…from the live network", outBefore.some((v, i) => v !== outAfter[i]),
            `${outBefore.length} outputs compared`);
        drawNet();
        const banks = makeEvalBanks(env, [1, 2], 12);
        const r = evaluateBrain(env, net, banks);
        t("evaluateBrain runs in-page", isFinite(r.score), `score ${r.score.toFixed(3)}, solve ${(r.solveRate * 100).toFixed(0)}%`);
        const pre = document.createElement("pre");
        pre.id = "selftest";
        pre.textContent = res.join("\n");
        document.body.appendChild(pre);
        document.title = res.some(x => x.startsWith("FAIL")) ? "SELFTEST FAIL" : "SELFTEST OK";
    }
})();
