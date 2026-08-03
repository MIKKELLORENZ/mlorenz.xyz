/* main.js — browser wiring: the evolution loop, the showcase rollout, and the
 * bookkeeping that keeps the two in step.
 *
 * There are two independent clocks running here and it is worth being explicit
 * about why. The EVOLUTION advances in whole generations, each of which is a
 * burst of work sliced across animation frames so the page never blocks. The
 * SHOWCASE advances one tick at a time and exists purely to be looked at: it
 * re-rolls the current champion against a system that is not in the training
 * set, loops when it reaches the horizon, and picks up whatever champion exists
 * at the moment it restarts. Keeping them separate means the picture is never a
 * frozen frame of a half-evaluated population.
 */
"use strict";

/* ---------------------------------------------------------------- state */

const S = {
    evo: null,
    trials: null,
    baselines: null,        // {drift, newton, adams3, sub8} digits on the current trial set
    driftSeries: [],
    level: 0,
    block: -1,
    running: false,
    speed: 4,
    headless: false,
    evalIdx: 0,
    results: [],
    champDigits: null,
    champVsNewton: null,
    genTimes: [],
    lastGenAt: 0,
    frozen: false,
    show: null,             // {sys, pred, state, tick, ax, ay, runner}
    showSeed: 20260731,
    raster: null,
    rasterGrid: 8
};

const log = makeLog("log", 140);
const scene = new SceneRenderer($("scene"));

/* ------------------------------------------------------------- controls */

/* Search settings are CONSTANTS, not sliders.
 *
 * They used to be exposed, and that was a mistake: a page whose primary job is
 * to show a finished result should not offer a rack of knobs that only matter
 * to a training run nobody is going to sit through in a browser tab. Worse, one
 * of them was actively dangerous — the step size. The shipped champion was
 * evolved at 50 steps per orbit and its advantage over Newton *inverts* at finer
 * steps (see the README), so a viewer who nudged that slider would have watched
 * the network lose and concluded it did not work. It is pinned to the value the
 * brain was trained at. */
const RUN = {
    pop: 48,
    trials: 4,
    block: 3,
    grace: 3,
    mutRate: 0.12,
    mutSigma: 0.40,
    ticksPerOrbit: 50      // must match training — see above
};

/* Only offer the scenarios the shipped brain was actually trained through.
 * Watching a champion fail on a rung it has never seen is not an informative
 * demonstration, it is a misleading one; the untrained-rung numbers belong in
 * the README next to the caveat, not in a button someone clicks by accident.
 * `train.js` still uses the full ladder. */
const SHOWN_LEVELS = window.DEFAULT_BRAIN && window.DEFAULT_BRAIN.level != null
    ? Math.min(N_LEVELS, window.DEFAULT_BRAIN.level + 1)
    : N_LEVELS;

const getTrails = bindCheck("chk-trails");
const getShowErr = bindCheck("chk-err");
const getShowPred = bindCheck("chk-pred");
const getShowLabels = bindCheck("chk-labels");
const getHeadless = bindCheck("chk-headless", v => {
    S.headless = v;
    document.body.classList.toggle("headless", v);
});

const LEVEL_BLURB = [
    "Three or four bodies on near-circular orbits — a star with a couple of planets.",
    "Up to five bodies, mildly elliptical orbits and a wider spread of distances.",
    "Up to six bodies on properly eccentric orbits, over twice the rollout.",
    "Up to eight bodies, strongly elliptical, sometimes around a double star. The hardest scenario the shipped network was trained on."
];

const selectLevel = buildChoices("level-buttons", LEVELS.slice(0, SHOWN_LEVELS).map((lv, i) => ({
    title: `${i + 1} · ${lv.label}`,
    sub: `${lv.nMin}–${lv.nMax} bodies · eccentricity ≤ ${lv.eMax} · ${lv.horizon} steps`
})), (i) => {
    S.level = i;
    $("level-desc").textContent = levelBlurb(i);
    setText("stat-level", `${i + 1} · ${LEVELS[i].label}`);
    rebuildTrials(true);
    newShowcase();
    log(`scenario → ${LEVELS[i].label}`, "evt");
});

function levelBlurb(i) {
    const lv = LEVELS[i];
    return (LEVEL_BLURB[i] || `${lv.nMin}–${lv.nMax} bodies, eccentricity up to ${lv.eMax}.`) +
        ` Scored over ${lv.horizon} steps.`;
}

const selectSpeed = buildSpeeds("speed-group", [
    { label: "¼×", value: 0.25 }, { label: "1×", value: 1 },
    { label: "4×", value: 4 }, { label: "16×", value: 16 }, { label: "max", value: 64 }
], v => { S.speed = v; });

bindButton("btn-pause", () => {
    S.running = !S.running;
    $("btn-pause").textContent = S.running ? "Pause" : "Run";
    $("btn-pause").classList.toggle("primary", S.running);
});
bindButton("btn-restart", () => restart("restarted by hand"));
bindButton("btn-newsys", () => { S.showSeed = (S.showSeed * 1103515245 + 12345) >>> 0; newShowcase(); });
bindButton("btn-replay", () => newShowcase());

bindButton("btn-export", () => {
    if (!S.evo || !S.evo.champion) return;
    downloadJSON("planet_champion.json", {
        format: "planet-brain-v1", model: JSON.parse(JSON.stringify(MODEL_CFG)),
        gen: S.evo.gen - 1, level: S.level, exam: S.champDigits, net: S.evo.champion.toJSON()
    });
    log("champion exported", "evt");
});
bindButton("btn-import", () => $("file-import").click());
$("file-import").addEventListener("change", e => readJSONFile(e.target, (err, obj) => {
    if (err) return log("import failed: " + err.message, "warn");
    loadBrain(obj, "imported");
}));
bindButton("btn-default", () => {
    if (!window.DEFAULT_BRAIN) return log("no built-in champion in this build", "warn");
    loadBrain(window.DEFAULT_BRAIN, "built-in champion");
});
/* Loading a stored brain has to reconcile the file's architecture with the
 * page's. Silently loading a mismatched genome produces garbage predictions
 * that look exactly like a training failure, so the model config is adopted
 * from the file and the run restarts around it. */
function adoptBrain(obj) {
    const net = obj.net || obj;
    if (obj.model) {
        const want = JSON.stringify(obj.model), have = JSON.stringify(MODEL_CFG);
        if (want !== have) {
            setModelCfg(obj.model);
            log(`architecture adopted from file → ${specLabel()}`, "evt");
        }
    }
    if (!Predictor.specMatches(net.spec)) {
        log("brain rejected: its network widths do not match this build", "warn");
        return null;
    }
    return Predictor.fromJSON(net);
}

function loadBrain(obj, what) {
    const p = adoptBrain(obj);
    if (!p) return;
    // Rung BEFORE restart. buildChoices' returned setter only moves the
    // highlight — it deliberately does not fire the pick handler, or a
    // programmatic selection would re-enter the very code that called it — so
    // restarting first would build the trial set at the old difficulty and
    // score the loaded champion against systems it was not trained on.
    if (obj.level != null) {
        S.level = Math.max(0, Math.min(SHOWN_LEVELS - 1, obj.level));
        selectLevel(S.level);
        setText("stat-level", `${S.level + 1} · ${LEVELS[S.level].label}`);
        $("level-desc").textContent = levelBlurb(S.level);
    }
    restart(null, p);
    log(`${what} loaded — ${obj.gen ? "gen " + obj.gen + ", " : ""}${obj.exam != null ? obj.exam.toFixed(2) + " digits" : ""}`, "evt");
}

/* -------------------------------------------------------- run management */

function restart(why, seedGenome) {
    const pop = RUN.pop;
    S.evo = new Evolution(pop, (Math.random() * 1e9) | 0, rng => new Predictor(rng));
    if (seedGenome) S.evo.seedFrom(seedGenome.calibrateScales(), 0.1, 0.35);
    S.evalIdx = 0; S.results = [];
    S.champDigits = null; S.champVsNewton = null;
    S.block = -1;
    S.genTimes = [];
    S.driftSeries = [];
    rebuildTrials(true);
    newShowcase();
    updateArchLabel();
    if (why) log(why + " — population " + pop, "evt");
}

function tickFrac() { return 1 / RUN.ticksPerOrbit; }

/* The trial set is rebuilt when the seed block turns over, not every
 * generation. Same systems for several generations running means consecutive
 * generations are comparable to each other; a fresh draw every generation makes
 * the champion whoever got the easiest systems. */
function rebuildTrials(force) {
    const block = force ? (S.block + 1) : Math.floor((S.evo ? S.evo.gen - 1 : 0) / RUN.block);
    S.block = block;
    S.trials = new TrialSet(seedsFor(block, RUN.trials, 0), {
        level: S.level, tickFrac: tickFrac()
    });
    S.baselines = {
        drift: S.trials.evaluate(DRIFT_RUNNER).digits,
        newton: S.trials.evaluate(NEWTON_RUNNER).digits,
        // The real competitor. Exact Newtonian forces, combined across the last
        // three evaluations by the classical coefficients — same one evaluation
        // per step as everyone else, and worth roughly +0.8 digits over one-step
        // Newton for nothing. See the note in model.js.
        adams3: S.trials.evaluate(adamsRunner(3)).digits,
        sub8: S.trials.evaluate(newtonSubRunner(8)).digits
    };
    refreshDrift();
}

/* The drift chart's baselines are recomputed with the trial set; the brain's
 * curve is recomputed when the champion changes. Both are several full rollouts
 * and neither belongs in the animation frame path. */
function refreshDrift() {
    if (!S.trials) return;
    const mk = (runner, color, wide, dash) => ({ points: S.trials.driftCurve(runner), color, wide, dash });
    S.driftSeries = [
        mk(DRIFT_RUNNER, "#ff5f6b", false, [3, 3]),
        mk(newtonSubRunner(8), "#6d84a0", false, [5, 3]),
        mk(NEWTON_RUNNER, "#4fe0a8", false, null),
        mk(adamsRunner(3), "#c792ea", false, null)
    ];
    if (S.evo && S.evo.champion) {
        S.driftSeries.push(mk(predictorRunner(S.evo.champion), "#ffb257", true, null));
    }
    drawDrift($("chart-drift"), S.driftSeries);
}

/* ----------------------------------------------------------- the showcase */

/* A system the population is NOT trained on, rolled forward one tick at a time
 * beside its own ground truth.
 *
 * Always the same system until "New system" changes the seed. That is
 * deliberate: looping the SAME system means what you watch change over a
 * training session is the brain, not the draw, and a champion that has just
 * learned something shows it on ground you were already looking at. */
function newShowcase() {
    const lv = LEVELS[S.level];
    let sys = null;
    for (let bump = 0; bump < 8 && !sys; bump++) {
        sys = makeSystem((S.showSeed + bump * 7919) >>> 0, {
            level: S.level, tickFrac: tickFrac(),
            // A longer rollout than the training horizon, purely so the animation
            // has somewhere to go — the divergence is the interesting part and at
            // 32 ticks it is over before you have looked at it.
            // Deliberately longer than the rung's training horizon, but no longer
            // an arbitrary 220. The divergence IS the interesting part, so the
            // demo has to run past the point the model was scored to — at 32
            // ticks the calm rung would be over before you had looked at it.
            // Twice the trained horizon shows the drift developing without
            // spending most of the animation in a regime the model was never
            // asked about; the HUD says which part is which.
            horizon: Math.max(140, Math.min(300, 2 * lv.horizon))
        });
    }
    if (!sys) { log("could not draw a showcase system", "warn"); return; }
    S.show = {
        sys, state: sys.state0.clone(), tick: 0, runner: null,
        ax: new Float64Array(sys.n), ay: new Float64Array(sys.n),
        bx: new Float64Array(sys.n), by: new Float64Array(sys.n)
    };
    if (S.evo && S.evo.champion) {
        S.show.runner = predictorRunner(S.evo.champion.clone());
        S.show.runner.reset(sys.n);
    }
    scene.resetTrails(sys.n);
    S.rasterGrid = MODEL_CFG.grid;
    S.raster = new Float32Array(S.rasterGrid * S.rasterGrid);
    setText("ep-bodies", sys.n);
    setText("ep-dt", `${sys.dt.toFixed(4)} · ${sys.ticksPerFastestOrbit.toFixed(0)}/orbit`);
    setText("ep-edrift", sys.truth.energyDrift.toExponential(1));
    setText("stat-bodies", sys.n);
}

function stepShowcase(n) {
    const sh = S.show;
    if (!sh) return;
    for (let k = 0; k < n; k++) {
        if (sh.tick >= sh.sys.horizon) { newShowcase(); return; }
        if (sh.runner) {
            sh.runner.accel(sh.state, sh.sys, sh.ax, sh.ay, sh.bx, sh.by);
            if (!sh.runner.split) { sh.bx.set(sh.ax); sh.by.set(sh.ay); }
            stepVerlet(sh.state, sh.sys.dt, sh.ax, sh.ay, sh.bx, sh.by);
        }
        sh.tick++;
        // Both trails advance together, so the dashed predicted path is always
        // exactly as long as the solid real one and the divergence between them
        // is legible as a shape rather than inferred from two dots.
        if (!S.headless) {
            scene.pushTrail(sh.sys.truth.frames[sh.tick], sh.runner ? sh.state : null, sh.sys.n);
        }
    }
}

/* ------------------------------------------------------- evolution slices */

/* Evaluate as many individuals as fit in `budget` milliseconds. Slicing by TIME
 * rather than by a fixed count matters because one rollout at rung 4 is sixteen
 * times the work of one at rung 0 — a fixed chunk that feels smooth on the easy
 * rung locks the page for half a second on the hard one. */
function evolveSlice(budget) {
    const t0 = performance.now();
    const evo = S.evo;
    while (S.evalIdx < evo.brains.length) {
        const brain = evo.brains[S.evalIdx];
        const ev = S.trials.evaluate(predictorRunner(brain));
        S.results.push({ brain, fitness: fitnessOf(ev), digits: ev.digits, worst: ev.worst, blew: ev.blew });
        S.evalIdx++;
        if (performance.now() - t0 > budget) return;
    }
    finishGeneration();
}

function finishGeneration() {
    const evo = S.evo;
    const prevChampion = evo.champion;
    const rec = evo.evolve(S.results, RUN.mutRate, RUN.mutSigma, RUN.grace, {});
    S.results = []; S.evalIdx = 0;

    const now = performance.now();
    if (S.lastGenAt) S.genTimes.push(now - S.lastGenAt);
    if (S.genTimes.length > 30) S.genTimes.shift();
    S.lastGenAt = now;

    S.champDigits = rec.bestDigits;
    // Measured against Adams-Bashforth 3, not plain Newton. Once a predictor may
    // remember its own past force evaluations, beating one-step Newton is a
    // textbook result available for free, and a headline number that took credit
    // for it would be flattering the network by about 0.8 digits.
    S.champVsNewton = rec.bestDigits - S.baselines.adams3;

    if (evo.gen % 5 === 1 || evo.champion !== prevChampion) {
        log(`gen ${evo.gen - 1}: best ${rec.bestDigits.toFixed(3)} · mean ${rec.avgDigits.toFixed(3)} · ` +
            `Newton ${S.baselines.newton.toFixed(3)} · AB3 ${S.baselines.adams3.toFixed(3)}`, "gen");
    }
    if (evo.champion !== prevChampion) {
        // Re-attach the showcase to the new champion at the next loop, and redraw
        // the drift curve, which is the only place the improvement is legible.
        refreshDrift();
    }
    if (rec.blew > 0 && evo.gen % 20 === 1) {
        log(`${rec.blew} rollout${rec.blew > 1 ? "s" : ""} diverged this generation`, "warn");
    }

    const wantBlock = Math.floor((evo.gen - 1) / RUN.block);
    if (wantBlock !== S.block) rebuildTrials(false);

    drawFitness($("chart-fit"), evo.history);
}

/* ------------------------------------------------------------ presentation */

function updateArchLabel() {
    const p = new Predictor(mulberry32(1));
    const parts = [`pair net ${p.edge.nParams()}`, `body net ${p.node.nParams()}`];
    if (p.gru) parts.push(`memory ${p.gru.nParams()}`);
    if (p.ctxNet) parts.push(`image ${p.ctxNet.nParams()}`);
    setText("md-arch", specLabel());
    setText("md-params", `${p.nParams()} — ${parts.join(", ")}`);
    setText("md-tick", `1/${RUN.ticksPerOrbit} of the fastest orbit`);
    setText("md-lags", MODEL_CFG.lags
        ? `${MODEL_CFG.lags} past step${MODEL_CFG.lags === 1 ? "" : "s"} per body`
        : "nothing — one step at a time");
    const mem = $("md-memnote");
    if (mem) {
        mem.innerHTML = MODEL_CFG.lags
            ? `Each body also remembers its own last ${MODEL_CFG.lags} force calculations
               and combines them, which is how an integrator buys accuracy <b>without</b>
               computing the forces again.`
            : `The shipped network predicts each step from the current state alone.
               It was also built to remember its last few force calculations — the
               <b>Adams&#8209;Bashforth</b> trick of reusing them is worth a lot on
               <i>exact</i> forces — but measured on this brain it made things
               <b>worse</b>, because extrapolating past forces amplifies whatever error
               is already in them. That comparison is the purple line.`;
    }
    setText("md-trained", `scenario ${SHOWN_LEVELS} · ${LEVELS[SHOWN_LEVELS - 1].label}`);
    const hint = $("raster-hint");
    if (hint) {
        hint.innerHTML = MODEL_CFG.image
            ? `An ${MODEL_CFG.grid}×${MODEL_CFG.grid} log-mass map of the system, canonically rotated so the heaviest planet is always to the right. <b>This brain is using it.</b>`
            : `An ${MODEL_CFG.grid}×${MODEL_CFG.grid} log-mass map of the system, canonically rotated so the heaviest planet is always to the right. Tested and <b>not</b> used by the shipped brain — for pure gravity it is redundant with the pairwise inputs. See the README.`;
    }
}

function paintStats() {
    const evo = S.evo, sh = S.show;
    setText("stat-gen", evo ? evo.gen : 1);
    setText("stat-best", S.champDigits != null ? S.champDigits.toFixed(2) : "–");
    const vs = $("stat-vs");
    if (vs) {
        if (S.champVsNewton == null) { vs.textContent = "–"; vs.className = ""; }
        else {
            vs.textContent = (S.champVsNewton >= 0 ? "+" : "") + S.champVsNewton.toFixed(2);
            vs.className = S.champVsNewton >= 0 ? "win" : "lose";
        }
    }
    const rate = S.genTimes.length ? 1000 / (S.genTimes.reduce((a, b) => a + b, 0) / S.genTimes.length) : 0;
    setText("hl-gen", evo ? evo.gen : 1);
    setText("hl-best", S.champDigits != null ? S.champDigits.toFixed(3) : "–");
    setText("hl-vs", S.champVsNewton != null ? (S.champVsNewton >= 0 ? "+" : "") + S.champVsNewton.toFixed(3) : "–");
    setText("hl-rate", rate ? rate.toFixed(2) : "–");

    if (!sh) return;
    /* Show the trained horizon alongside the current step. Without it the demo
     * reads as "the network drifts badly", when a good part of what is on screen
     * is the model extrapolating well past anything it was ever scored on — the
     * calm rung is trained to 32 steps and the showcase runs to 140. That is
     * worth showing, and worth labelling. */
    const trained = LEVELS[S.level].horizon;
    setText("ep-tick", `${sh.tick} / ${sh.sys.horizon}` +
        (sh.tick > trained ? `  ·  ${(sh.tick / trained).toFixed(1)}× past trained` : `  ·  within trained ${trained}`));
    if (sh.runner && sh.tick > 0) {
        const per = new Float64Array(sh.sys.n);
        const e = relError(sh.state, sh.sys.truth.frames[sh.tick], sh.sys.ref.L, per);
        let wi = 0;
        for (let i = 1; i < per.length; i++) if (per[i] > per[wi]) wi = i;
        setText("ep-err", fmtErr(e));
        setText("ep-worst", `body ${wi} · ${fmtErr(per[wi])}`);
    } else {
        setText("ep-err", "–"); setText("ep-worst", "–");
    }
}

function paintHUD() {
    const sh = S.show;
    if (!sh) return;
    const truth = sh.sys.truth.frames[sh.tick];
    const e = sh.runner && sh.tick > 0 ? relError(sh.state, truth, sh.sys.ref.L, null) : 0;
    // The legend is repeated here, on the picture itself, and not only in the
    // side panel: a screenshot or an embedded iframe crops the panel away, and
    // "which dot is the AI" is the one question this view must never leave open.
    setHTML("hud",
        `<span class="k">step</span> ${sh.tick} / ${sh.sys.horizon}` +
        `&nbsp;&nbsp;<span class="k">bodies</span> ${sh.sys.n}` +
        (sh.runner ? `&nbsp;&nbsp;<span class="k">prediction error</span> ${fmtErr(e)}` : "") +
        `<div class="hud-key">` +
        `<span><i class="hk hk-real"></i>real orbit</span>` +
        `<span><i class="hk hk-pred"></i>network&rsquo;s prediction</span>` +
        `<span><i class="hk hk-err"></i>error</span>` +
        `</div>`);
}

/* ----------------------------------------------------------------- loop */

let lastResize = 0;
function frame(t) {
    requestAnimationFrame(frame);

    // Frozen: keep producing frames, but advance nothing. Used by the warm-up
    // screenshot path — see the note where S.frozen is set.
    if (S.frozen) {
        if (t - lastResize > 500) { lastResize = t; scene.resize(); }
        const sh = S.show;
        if (sh) {
            scene.draw({
                sys: sh.sys, truth: sh.sys.truth.frames[sh.tick],
                pred: sh.runner ? sh.state : null,
                showTrails: true, showError: true, showLabels: true
            });
        }
        return;
    }

    if (S.running && S.evo && S.trials) {
        // Headless pours the whole frame into evolution; on screen we leave
        // enough of the budget for a 60 Hz redraw.
        evolveSlice(S.headless ? 55 : Math.min(24, 6 + S.speed * 0.6));
    }

    if (S.headless) { paintStats(); return; }

    // Reattach the showcase to the current champion when it has none yet.
    if (S.show && !S.show.runner && S.evo && S.evo.champion) {
        S.show.runner = predictorRunner(S.evo.champion.clone());
        S.show.runner.reset(S.show.sys.n);
        S.show.state = S.show.sys.state0.clone();
        S.show.tick = 0;
        scene.resetTrails(S.show.sys.n);
    }

    const sub = S.speed >= 1 ? Math.max(1, Math.round(Math.min(S.speed, 12))) : (Math.random() < S.speed ? 1 : 0);
    stepShowcase(sub);

    if (t - lastResize > 500) { lastResize = t; scene.resize(); }
    const sh = S.show;
    if (sh) {
        scene.draw({
            sys: sh.sys,
            truth: sh.sys.truth.frames[sh.tick],
            pred: (sh.runner && getShowPred()) ? sh.state : null,
            showTrails: getTrails(),
            showError: getShowErr() && !!sh.runner,
            showLabels: getShowLabels()
        });
        if (S.raster && (sh.tick & 3) === 0) {
            buildRaster(sh.sys.truth.frames[sh.tick], sh.sys.m, sh.sys, S.rasterGrid, S.raster);
            drawRaster($("chart-raster"), S.raster, S.rasterGrid);
        }
    }
    paintHUD();
    paintStats();
}

/* -------------------------------------------------------------- self-test */

/* `?selftest=1` drives the whole page synchronously and writes a report into a
 * <pre>, which is how the headless-Chrome harness checks this file.
 *
 * Synchronous on purpose. Under Chrome's --virtual-time-budget requestAnimationFrame
 * stops firing as soon as time fast-forwards, so anything that waits for frames
 * silently produces nothing at all — which reads exactly like a broken page. A
 * straight-line function that touches every subsystem and returns is the only
 * shape that reliably reports the truth from a headless run. */
function runSelfTest() {
    const errs = [];
    const rep = { spec: specLabel() };
    const step = (name, fn) => { try { return fn(); } catch (e) { errs.push(`${name}: ${e.message}`); return null; } };

    step("boot", () => {
        rep.params = new Predictor(mulberry32(1)).nParams();
        rep.bodies = S.show.sys.n;
        rep.dt = +S.show.sys.dt.toFixed(5);
        rep.ticksPerOrbit = Math.round(S.show.sys.ticksPerFastestOrbit);
        rep.truthEnergyDrift = S.show.sys.truth.energyDrift.toExponential(1);
        rep.baselines = {
            drift: +S.baselines.drift.toFixed(3),
            newton: +S.baselines.newton.toFixed(3),
            adams3: +S.baselines.adams3.toFixed(3),
            sub8: +S.baselines.sub8.toFixed(3)
        };
    });

    step("evolve", () => {
        // One call with an unbounded budget IS one whole generation: evolveSlice
        // evaluates until the roster is exhausted and then finishes the
        // generation, which resets the cursor to zero. Wrapping it in a
        // `while (evalIdx < length)` loop therefore never terminates.
        for (let g = 0; g < 6; g++) evolveSlice(1e9);
        rep.gen = S.evo.gen;
        rep.bestDigits = +S.champDigits.toFixed(3);
        rep.vsNewton = +S.champVsNewton.toFixed(3);
        rep.historyLen = S.evo.history.length;
    });

    step("showcase", () => {
        S.show.runner = predictorRunner(S.evo.champion.clone());
        S.show.runner.reset(S.show.sys.n);
        S.show.state = S.show.sys.state0.clone();
        S.show.tick = 0;
        stepShowcase(120);
        rep.showTick = S.show.tick;
        rep.showErr = +relError(S.show.state, S.show.sys.truth.frames[S.show.tick], S.show.sys.ref.L, null).toExponential(2);
    });

    step("render", () => {
        scene.resize();
        scene.draw({
            sys: S.show.sys, truth: S.show.sys.truth.frames[S.show.tick], pred: S.show.state,
            showTrails: true, showError: true, showLabels: true
        });
        const cv = $("scene"), cx = cv.getContext("2d");
        const im = cx.getImageData(0, 0, cv.width, cv.height).data;
        let lit = 0;
        for (let i = 0; i < im.length; i += 4 * 37) if (im[i] > 30 || im[i + 1] > 30 || im[i + 2] > 45) lit++;
        rep.litPixels = lit;
        drawFitness($("chart-fit"), S.evo.history);
        drawDrift($("chart-drift"), S.driftSeries);
        buildRaster(S.show.sys.truth.frames[S.show.tick], S.show.sys.m, S.show.sys, S.rasterGrid, S.raster);
        drawRaster($("chart-raster"), S.raster, S.rasterGrid);
        rep.driftSeries = S.driftSeries.map(s => s.points.length);
    });

    step("save/load round trip", () => {
        const json = JSON.parse(JSON.stringify(S.evo.champion.toJSON()));
        const back = Predictor.fromJSON(json);
        const a = S.trials.evaluate(predictorRunner(S.evo.champion)).digits;
        const b = S.trials.evaluate(predictorRunner(back)).digits;
        rep.roundTripExact = Math.abs(a - b) < 1e-12;
    });

    step("architecture switch", () => {
        // Every option must produce a runnable genome, since each one changes
        // the widths of networks the rest of the page holds references to.
        const modes = [];
        for (const cfg of [{ image: true, mem: 8, rounds: 2 }, { image: false, mem: 0, rounds: 1 },
        { image: true, mem: 8, rounds: 2, mode: "raw" }]) {
            setModelCfg(cfg);
            restart(null);
            evolveSlice(1e9);
            modes.push(`${specLabel()}:${new Predictor(mulberry32(1)).nParams()}`);
        }
        rep.architectures = modes;
        setModelCfg({ mode: "phys", image: false, mem: 8, lags: 0, rounds: 2, grid: 8 });
        restart(null);
    });

    rep.errors = errs;
    rep.ok = errs.length === 0;
    const pre = document.createElement("pre");
    pre.id = "selftest";
    pre.textContent = JSON.stringify(rep, null, 1);
    document.body.appendChild(pre);
    document.title = errs.length ? "SELFTEST-FAIL" : "SELFTEST-OK";
}

/* Warm the page up SYNCHRONOUSLY and paint one frame: `?warm=N` runs N
 * generations, advances the showcase, and draws everything once.
 *
 * This exists for headless screenshots. Under Chrome's --virtual-time-budget
 * requestAnimationFrame stops firing as soon as time fast-forwards, so a
 * canvas-driven page screenshots as an empty black rectangle no matter how long
 * the budget is. A straight-line warm-up is the only way to capture a frame
 * that actually has something in it. */
function warmUp(gens, level) {
    if (window.DEFAULT_BRAIN) loadBrain(window.DEFAULT_BRAIN, "built-in champion");
    if (level != null) {
        S.level = Math.max(0, Math.min(SHOWN_LEVELS - 1, level));
        selectLevel(S.level);
        setText("stat-level", `${S.level + 1} · ${LEVELS[S.level].label}`);
        $("level-desc").textContent = levelBlurb(S.level);
        rebuildTrials(true);
        newShowcase();
    }
    for (let g = 0; g < gens; g++) evolveSlice(1e9);
    S.show.runner = predictorRunner(S.evo.champion.clone());
    S.show.runner.reset(S.show.sys.n);
    S.show.state = S.show.sys.state0.clone();
    S.show.tick = 0;
    scene.resetTrails(S.show.sys.n);
    /* Stop around 60% of the rollout rather than at the very end. Both trails
     * need to be long enough to read as paths and the prediction has to have
     * visibly separated — that separation is the subject — but a frame captured
     * on the last tick shows the model at its single worst moment, several times
     * past the horizon it was scored to, which is not what it typically does. */
    stepShowcase(Math.max(1, Math.round(0.6 * (S.show.sys.horizon - 1))));
    scene.resize();
    scene.draw({
        sys: S.show.sys, truth: S.show.sys.truth.frames[S.show.tick],
        pred: S.show.state, showTrails: true, showError: true, showLabels: true
    });
    buildRaster(S.show.sys.truth.frames[S.show.tick], S.show.sys.m, S.show.sys, S.rasterGrid, S.raster);
    drawRaster($("chart-raster"), S.raster, S.rasterGrid);
    drawFitness($("chart-fit"), S.evo.history);
    drawDrift($("chart-drift"), S.driftSeries);
    paintHUD();
    paintStats();

    // A screenshot cannot tell "drew nothing" from "drew something black", so
    // the warm-up reports what it actually put on the canvas.
    const cv = $("scene"), cx = cv.getContext("2d");
    let lit = 0;
    try {
        const im = cx.getImageData(0, 0, cv.width, cv.height).data;
        for (let i = 0; i < im.length; i += 4 * 37) if (im[i] > 30 || im[i + 1] > 30 || im[i + 2] > 45) lit++;
    } catch (e) { lit = -1; }
    const sh = S.show;
    const tr = sh.sys.truth.frames[sh.tick];
    let rmax = 0;
    for (let i = 0; i < sh.sys.n; i++) rmax = Math.max(rmax, Math.hypot(tr.x[i], tr.y[i]));
    const pre = document.createElement("pre");
    pre.id = "warmreport";
    pre.textContent = JSON.stringify({
        level: S.level, bodies: sh.sys.n, tick: sh.tick, horizon: sh.sys.horizon,
        canvas: [cv.width, cv.height], cssSize: [scene.w, scene.h],
        viewSpan: +(sh.sys.ref.R0 * 1.25).toFixed(3), truthRmax: +rmax.toFixed(3),
        litPixels: lit
    });
    document.body.appendChild(pre);
}

/* ------------------------------------------------------------------ boot */

function boot() {
    setModelCfg({ mode: "phys", image: false, mem: 8, lags: 0, rounds: 2, grid: 8 });
    selectLevel(0);
    selectSpeed(2);
    $("level-desc").textContent = levelBlurb(0);
    setText("stat-level", `1 · ${LEVELS[0].label}`);
    scene.resize();
    window.addEventListener("resize", () => scene.resize());
    restart(null);
    log("ready — the opponent is Newton with the same one force evaluation per tick");
}

bindButton("intro-watch", () => {
    $("intro").classList.add("hidden");
    if (window.DEFAULT_BRAIN) loadBrain(window.DEFAULT_BRAIN, "built-in champion");
    else log("no built-in champion in this build — evolving from scratch instead", "warn");
    S.running = true;
});
bindButton("intro-scratch", () => {
    $("intro").classList.add("hidden");
    restart("evolving from scratch");
    S.running = true;
});
bindButton("intro-explore", () => { $("intro").classList.add("hidden"); });

boot();
const warm = location.search.match(/[?&]warm=(\d+)/);
if (/[?&]selftest/.test(location.search)) {
    $("intro").classList.add("hidden");
    runSelfTest();
} else if (warm) {
    /* The animation loop keeps running, but frozen.
     *
     * Both halves of that are needed, and each one was learned by getting it
     * wrong. Letting the loop run NORMALLY means the rollout keeps advancing
     * and wraps past its horizon before the shutter fires — a 190-tick warm-up
     * came back captured at tick 40. But stopping the loop ENTIRELY produces a
     * screenshot with an empty black canvas even though the page has drawn to
     * it: with no frames being requested the 2D canvas is never composited into
     * the captured surface, and the in-page pixel count proves the drawing
     * happened. Freezing gives a stable frame that is also a real one. */
    $("intro").classList.add("hidden");
    const lv = location.search.match(/[?&]level=(\d+)/);
    warmUp(parseInt(warm[1], 10), lv ? parseInt(lv[1], 10) : null);
    S.frozen = true;
    requestAnimationFrame(frame);
} else {
    requestAnimationFrame(frame);
}
