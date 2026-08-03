/* main.js — the loop that ties evolution, physics and the view together.
 *
 * A generation is CFG.episodes episodes; a drone's score for the generation is
 * the mean of its episodes. Scoring over more than one episode is not a nicety:
 * with a single waypoint chain the top of the ranking is largely luck about
 * where the points fell — one behind a pillar and a good brain looks bad — and
 * selecting on luck goes nowhere.
 */
"use strict";

let evo = null;
let world = null;
let renderer = null;
let room = null;
let acc = null;           // per-brain accumulator across the generation's episodes
let episodeIdx = 0;
let stage = 0;
let showcase = false;     // whole fleet driven by one brain
let showcaseNet = null;
let lastFrame = 0;

/* ------------------------------------------------- fixed validation exam
 * The champion is decided by an exam, never by the training log.
 *
 * A drone's generation score is a mean over CFG.episodes NOISY missions, so the
 * top of the ranking is partly luck about where the waypoints fell. Taking
 * `championFit` as a running MAX over that noise latches onto the luckiest draw
 * ever seen and never lets go: it froze on a generation-1 fluke for 660
 * generations, and every champion saved in that window was that same brain.
 *
 * So each generation's best brain re-flies six FIXED missions that never appear
 * in training, and only that score can crown a champion. Same seed constants,
 * same episode count and same stage mix as the run that produced the built-in
 * brain, so the number here is comparable with the one recorded in
 * WHAT_SORT_OF_WORKED.md.
 *
 * It is a selection set, not a true holdout — six missions can be overfitted
 * given enough generations — which is why the brain shipped in this build was
 * finally ranked on four further unseen seed banks before being baked. */
const VAL_EPISODES = 6;
const VAL_SEEDS = [];
for (let e = 0; e < VAL_EPISODES; e++) {
    VAL_SEEDS.push([900000 + e * 7919, 700000 + e * 6271]);   // never drawn in training
}

let valState = null;      // non-null while the exam is in flight
let bestVal = -1e18;      // best exam score this run
let bestValNet = null;    // and the brain that scored it — this is the champion
let bestValStage = 0;
let lastValFit = NaN;
let stopAfterGen = 0;     // ?gens=N — headless driving; 0 = run forever
let runFinished = false;

/* ------------------------------------------------------------------ helpers */
function currentStage() {
    return stageFor(evo.gen, evo.history, { stageLock: CFG.stageLock });
}

function startEpisode() {
    // Episodes span every unlocked stage, not just the newest — see
    // episodeStages() in evolution.js. Episode 1 of a generation is always the
    // current room; the rest revisit the earlier ones, so a brain only advances
    // by staying good at everything it has already been asked to do.
    const st = stageOpts(episodeStages(stage, CFG.episodes)[episodeIdx] || 0);
    room = new Room(roomById(st.room));
    world = new World(room, evo.brains, {
        turbulence: st.turbulence,
        minSep: st.minSep,
        // Sliding mission window, the scheme that produced the built-in brain:
        // generation g flies missions g..g+episodes-1, so consecutive
        // generations overlap and the objective drifts instead of being
        // replaced wholesale.
        missionSeed: 1 + (evo.gen + episodeIdx) * 37,
        noiseSeed: 5000 + (evo.gen + episodeIdx) * 13,
        noise: CFG.noise
    });
    UI.setStage(stage);
}

function newGeneration() {
    stage = currentStage();
    episodeIdx = 0;
    acc = evo.brains.map(() => ({
        fitness: 0, arrivals: 0, newArrivals: 0, crashed: 0, tookOff: 0, airTime: 0, peakY: 0
    }));
    startEpisode();
}

function finishEpisode() {
    const n = CFG.episodes;
    const epStages = episodeStages(stage, n);
    const sIdx = epStages[episodeIdx] || 0;
    const scale = stageOpts(sIdx).scale;
    const newest = Math.max.apply(null, epStages);
    const nNew = epStages.filter(s => s === newest).length;
    world.drones.forEach((d, i) => {
        // fitness is normalised per room so the easy rooms cannot drown out the
        // hard ones — see STAGES.scale in evolution.js
        acc[i].fitness += normalizeFitness(d.fitness(), scale) / n;
        acc[i].arrivals += d.arrivals / n;
        if (sIdx === newest) acc[i].newArrivals += d.arrivals / nNew;
        acc[i].crashed += (d.crashed ? 1 : 0) / n;
        acc[i].tookOff += (d.armed ? 1 : 0) / n;
        acc[i].airTime += d.airTime / n;
        acc[i].peakY += d.peakY / n;
    });
    episodeIdx++;
    if (episodeIdx < n) { startEpisode(); return; }
    endGeneration();
}

function endGeneration() {
    const N = acc.length;
    const mean = k => acc.reduce((s, a) => s + a[k], 0) / N;
    const stats = {
        stage,
        room: stageOpts(stage).room,
        newArr: mean("newArrivals"),      // arrivals in the newest room only
        crashFrac: mean("crashed"),
        takeoffFrac: mean("tookOff"),
        avgAir: mean("airTime"),
        maxAir: Math.max.apply(null, acc.map(a => a.airTime)),
        avgPeak: mean("peakY")
    };
    const results = evo.brains.map((b, i) => ({
        brain: b, fitness: acc[i].fitness, arrivals: acc[i].arrivals
    }));
    const gen = evo.gen;
    // Grab the generation's best before evolve() reorders `results` — this is
    // the brain that will sit the exam.
    const topBrain = results.slice().sort((a, b) => b.fitness - a.fitness)[0].brain.clone();
    const rec = evo.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.gracePeriod, {
        immZeroFit: CFG.immZeroFit, childZeroFit: CFG.childZeroFit
    }, stats);

    uiLog(`<span class="gen">gen ${gen}</span> · best <b>${rec.best.toFixed(2)}</b> · mean ${rec.avg.toFixed(2)}` +
        ` · airborne ${(stats.takeoffFrac * 100) | 0}% · crashed ${(stats.crashFrac * 100) | 0}%` +
        (rec.avgArr > 0
            ? ` · <span class="evt">waypoints ${rec.avgArr.toFixed(2)}/${rec.bestArr.toFixed(2)}</span>`
            : ""));
    if (evo.graceEvent) uiLog(`<span class="evt">${evo.graceEvent}</span>`);
    const nextStage = currentStage();
    if (nextStage !== stage) uiLog(`<span class="evt">→ stage ${nextStage} unlocked — ${stageOpts(nextStage).label}</span>`);

    drawChart(evo.history);
    drawSkillChart(evo.history);
    $("stat-gen").textContent = evo.gen;
    $("stat-wp").textContent = `${rec.bestArr.toFixed(2)} / ${rec.avgArr.toFixed(2)}`;

    // Showcase runs a fixed brain, so it re-seeds its population every
    // generation — otherwise mutation quietly turns the demo into a fresh
    // evolution run after one generation. It is a demo, not a run: no exam.
    if (showcase) {
        for (let i = 0; i < evo.brains.length; i++) evo.brains[i] = showcaseNet.clone();
        newGeneration();
        return;
    }
    if (CFG.popSize !== evo.popSize) { restart(); return; }
    if (stopAfterGen && evo.gen > stopAfterGen) { finishRun(); return; }

    // The exam decides the champion; the next generation starts when it is done.
    startValidation(topBrain, stage);
}

/* ------------------------------------------------------------------- the exam
 * Six fixed missions, one brain, run flat out. The exam is a measurement rather
 * than a spectacle, so it ignores the speed control and is not rendered —
 * otherwise picking 1x to watch the fleet would stall the run for minutes every
 * generation while a single drone re-flies six courses. */
function startValidation(net, stage) {
    valState = {
        net, stage, stages: episodeStages(stage, VAL_EPISODES),
        idx: 0, fitness: 0, arrivals: 0
    };
    startValEpisode();
}

function startValEpisode() {
    const v = valState;
    const st = stageOpts(v.stages[v.idx]);
    const seeds = VAL_SEEDS[v.idx];
    room = new Room(roomById(st.room));
    world = new World(room, [v.net], {
        turbulence: st.turbulence, minSep: st.minSep,
        missionSeed: seeds[0], noiseSeed: seeds[1], noise: CFG.noise
    });
}

function finishValEpisode() {
    const v = valState;
    const st = stageOpts(v.stages[v.idx]);
    const d = world.drones[0];
    // per-room normalised, exactly as a training episode is scored, so exam and
    // training numbers are in the same units
    v.fitness += normalizeFitness(d.fitness(), st.scale) / VAL_EPISODES;
    v.arrivals += d.arrivals / VAL_EPISODES;
    v.idx++;
    if (v.idx < VAL_EPISODES) { startValEpisode(); return; }
    finishValidation();
}

function finishValidation() {
    const v = valState;
    valState = null;
    lastValFit = v.fitness;

    // A stage change is an environment change and exam scores are only
    // comparable within one environment — the same reason evolve() resets
    // championFit across a promotion. Without this the run carries a hall score
    // into the pillar field, nothing can ever beat it, and the champion freezes.
    if (v.stage !== bestValStage && bestVal > -1e17) bestVal = -1e18;
    const improved = v.fitness > bestVal;
    if (improved) {
        bestVal = v.fitness;
        bestValNet = v.net;
        bestValStage = v.stage;
    }
    // Save/Export/Showcase must offer the VALIDATED brain. evolve() will have
    // pointed evo.champion at whichever brain got lucky this generation; that is
    // the brain this whole mechanism exists to not trust.
    if (bestValNet) evo.champion = bestValNet;
    // The gates key off the honest number too. Fed the training max they slammed
    // shut on a fluke and the population stopped receiving immigrants far too
    // early in the run.
    evo.championFit = bestVal;

    uiLog(`&nbsp;&nbsp;<span class="dim">exam ${v.fitness.toFixed(2)}` +
        `${improved ? " <b>· new champion</b>" : ` (best ${bestVal.toFixed(2)})`}` +
        ` · ${v.arrivals.toFixed(2)} wp over ${VAL_EPISODES} fixed missions</span>`);
    $("stat-best").textContent = bestVal > -1e17 ? bestVal.toFixed(2) : "—";

    newGeneration();
}

/* ?gens=N ran out. Park the run and leave the result somewhere a headless
 * browser can read it without needing a debugger attached. */
function finishRun() {
    runFinished = true;
    CFG.paused = true;
    const btn = $("btn-pause");
    if (btn) btn.textContent = "Resume";
    uiLog(`<span class="evt">run finished at generation ${evo.gen - 1} — ` +
        `champion scored ${bestVal > -1e17 ? bestVal.toFixed(2) : "—"} on the exam</span>`);
    // Only publish a brain this run actually produced. Falling back to the
    // built-in one here would let a headless pipeline scrape a "result" that is
    // just the brain it started with.
    const pre = $("bake-out");
    if (pre) pre.textContent = bestValNet
        ? defaultBrainSource()
        : "/* this run never completed an exam — nothing to bake */\n";
    document.title = `DONE gen=${evo.gen - 1} val=${bestVal > -1e17 ? bestVal.toFixed(3) : "none"}` +
        ` bake=${bestValNet ? "ready" : "none"}`;
}

/* Every drone in the fleet runs the same brain — the way to actually watch one
 * evolved policy fly, and a fair readout of how repeatable it is under noise
 * and turbulence. If they stay in formation, the policy is stable. */
function runShowcase(net) {
    if (!net) { uiLog("no champion available yet"); return; }
    showcase = true;
    showcaseNet = net.clone();
    evo = new Evolution(Math.max(6, Math.min(CFG.popSize, 16)), 99);
    for (let i = 0; i < evo.brains.length; i++) evo.brains[i] = net.clone();
    evo.champion = net.clone();
    newGeneration();
    uiLog(`<span class="evt">showcase — ${evo.brains.length} copies of one brain</span>`);
}

function restart(seed) {
    showcase = false;
    showcaseNet = null;
    // A fresh run must forget the previous run's exam, or the old champion's
    // score gates the new population's immigrants from generation 1.
    valState = null;
    bestVal = -1e18;
    bestValNet = null;
    bestValStage = 0;
    lastValFit = NaN;
    $("stat-best").textContent = "—";
    evo = new Evolution(CFG.popSize, seed != null ? seed : (Math.random() * 1e9) | 0);
    newGeneration();
    uiLog(`evolution restarted from random brains · ${CFG.popSize} drones × ` +
        `${CFG.episodes} episodes, champion decided by a ${VAL_EPISODES}-mission exam`);
}

/* --------------------------------------------------------------------- HUD */
function updateHud() {
    if (!world) return;
    const d = world.drones[world.leaderIdx] || world.drones[0];
    $("ep-time").textContent = world.time.toFixed(1) + " s";
    $("ep-clock").textContent = d.timeLeft.toFixed(1) + " s";
    $("ep-alt").textContent = d.pos[1].toFixed(2) + " m";
    $("ep-speed").textContent = Math.hypot(d.vel[0], d.vel[1], d.vel[2]).toFixed(2) + " m/s";

    // uprightness: the body +y axis projected onto world up
    const up = qRot(d.q, 0, 1, 0, new Float64Array(3))[1];
    const upEl = $("ep-up");
    upEl.textContent = up.toFixed(2);
    upEl.className = up > 0.85 ? "good" : up > DRONE.UPRIGHT_MIN ? "warn" : "";

    $("ep-rotors").textContent = Array.from(d.spin).map(s => s.toFixed(2)).join(" ");
    $("ep-dist").textContent = d.target ? d.distToTarget().toFixed(1) + " m" : "—";
    $("ep-wp").textContent = d.arrivals;
    $("ep-clear").textContent = world.room.clearance(d.pos[0], d.pos[1], d.pos[2], d.armed).toFixed(2) + " m";
    $("ep-state").textContent = !d.alive ? "crashed" : d.done ? "clock out" : d.armed ? "airborne" : "on the pad";
    $("ep-fit").textContent = d.fitness().toFixed(0);
    $("stat-alive").textContent = `${world.aliveCount}/${world.drones.length}`;

    if (valState) {
        const vs = stageOpts(valState.stages[valState.idx]);
        $("hud").innerHTML =
            `<b>validation exam</b> · mission ${valState.idx + 1}/${VAL_EPISODES} · ${vs.label}<br>` +
            `the generation's best brain re-flying six fixed courses — not rendered, runs flat out`;
        return;
    }
    const epStage = episodeStages(stage, CFG.episodes)[episodeIdx] || 0;
    $("hud").innerHTML =
        `gen ${evo.gen} · episode ${episodeIdx + 1}/${CFG.episodes} · ${stageOpts(epStage).label}` +
        (epStage !== stage ? ` <i>(revisiting stage ${epStage})</i>` : "") + `<br>` +
        `leader #${d.idx} · ${d.fitness().toFixed(0)} pts · ${d.arrivals} waypoints · ${world.aliveCount} still flying`;
}

/* -------------------------------------------------------------------- loop */
function loop(now) {
    requestAnimationFrame(loop);
    const dtWall = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;

    if (!CFG.paused && world) {
        const examining = !!valState;
        const onOver = examining ? finishValEpisode : finishEpisode;
        const budgetMs = CFG.headless ? 26 : 11;
        const t0 = performance.now();
        if (examining || CFG.speed === 0 || CFG.headless) {
            // MAX: spend a fixed slice of wall-clock on physics, checking the
            // clock only every few hundred ticks so a fast machine is not
            // throttled by the timer call itself
            while (performance.now() - t0 < budgetMs) {
                for (let i = 0; i < 250 && !world.isOver(); i++) world.step();
                if (world.isOver()) { onOver(); break; }
            }
        } else {
            let steps = Math.min(20000, Math.round(dtWall * CFG.speed / DT));
            while (steps-- > 0 && !world.isOver()) world.step();
            if (world.isOver()) onOver();
        }
    }

    const wrap = $("canvas-wrap");
    wrap.style.opacity = (CFG.headless || valState) ? "0.12" : "1";
    if (!CFG.headless && !valState && world) {
        if (renderer.canvas.width !== Math.round(renderer.canvas.clientWidth * Math.min(devicePixelRatio, 1.75))) {
            renderer.resize();
        }
        renderer.frame(world, CFG);
    }
    updateHud();
}

/* ---------------------------------------------------------------- baking
 * Produce the exact text of default_brain.js for the current champion, so a run
 * that happens in the browser can be shipped from the browser. This is the last
 * thing the old Node toolchain was still needed for.
 *
 * Weights are rounded to 4 decimals, which is what the shipped brain was baked
 * at: it roughly halves the file and is far finer than the sensor noise the
 * policy already tolerates. */
function download(name, mime, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
}

/* Bake THIS RUN's validated champion whenever the run has produced one, even if
 * the built-in brain still scores higher.
 *
 * brainIO.best() deliberately prefers the built-in brain, which is right for the
 * showcase button and wrong here: baking after a short run would quietly hand
 * back the brain already in the page, and a headless pipeline would report
 * success having changed nothing. When the run is the weaker brain, the caller
 * says so out loud rather than substituting a different one. */
function bakeSource() {
    if (bestValNet) return { net: bestValNet, fit: bestVal, from: "this run" };
    const built = brainIO.builtIn();
    if (built) return { net: built, fit: brainIO.builtInFitness(), from: "the built-in brain" };
    return null;
}

function defaultBrainSource() {
    const src = bakeSource();
    if (!src) return "/* no champion to bake */\n";
    const net = src.net, fit = src.fit;
    const j = net.toJSON();
    const payload = {
        net: { sizes: j.sizes, weights: j.weights.map(a => Array.from(a).map(v => +v.toFixed(4))) },
        fitness: Number.isFinite(fit) && fit > -1e17 ? fit : 0,
        gen: evo ? evo.gen - 1 : 0,
        netSizes: NET_SIZES
    };
    return `/* default_brain.js — a champion baked in so the page has something to fly.\n` +
        ` * Exported from the browser (Brain → Bake default_brain.js).\n` +
        ` *   fitness ${payload.fitness.toFixed(4)} · generation ${payload.gen} · ` +
        `shape ${j.sizes.join("-")}\n` +
        ` * Drop this file next to index.html, replacing the existing one. */\n` +
        `const DEFAULT_BRAIN = ${JSON.stringify(payload)};\n`;
}

/* ------------------------------------------------------------ brain storage */
const KEY = "drone_waypoint_champion_v1";
const brainIO = {
    save() {
        if (!evo.champion) return uiLog("nothing to save yet");
        localStorage.setItem(KEY, JSON.stringify({ net: evo.champion.toJSON(), fitness: evo.championFit }));
        uiLog(`champion saved (${evo.championFit.toFixed(0)})`);
    },
    load() {
        const raw = localStorage.getItem(KEY);
        if (!raw) return uiLog("no saved champion");
        brainIO.importJSON(raw);
    },
    exportFile() {
        if (!evo.champion) return uiLog("nothing to export yet");
        download(`drone_champion_gen${evo.gen}.json`, "application/json", JSON.stringify({
            net: evo.champion.toJSON(), fitness: evo.championFit, gen: evo.gen, netSizes: NET_SIZES
        }));
    },
    /* Bake the champion into the page itself: download a default_brain.js that
     * replaces the shipped one, so the brain a visitor sees on load is a brain
     * that was trained in a browser. */
    bakeDefault() {
        const src = bakeSource();
        if (!src) return uiLog("nothing to bake yet");
        download("default_brain.js", "text/javascript", defaultBrainSource());
        const builtFit = brainIO.builtInFitness();
        uiLog(`default_brain.js downloaded — ${src.from}, exam score ${src.fit.toFixed(2)}` +
            ` · drop it next to index.html to ship it`);
        if (src.from === "this run" && builtFit && src.fit < builtFit) {
            uiLog(`<span class="evt">note: that is below the built-in brain's ${builtFit.toFixed(2)}` +
                ` — shipping it makes the page worse, not better</span>`);
        }
    },
    importJSON(text) {
        try {
            const o = JSON.parse(text);
            const net = Net.fromJSON(o.net || o);
            if (net.sizes.join() !== NET_SIZES.join()) {
                return uiLog(`brain shape ${net.sizes.join("-")} does not match this build (${NET_SIZES.join("-")})`);
            }
            evo.champion = net;
            evo.championFit = o.fitness || 0;
            uiLog(`brain loaded (${net.sizes.join("-")})`);
            runShowcase(net);
        } catch (e) { uiLog("could not read that file"); }
    },
    loadDefault() {
        if (typeof DEFAULT_BRAIN === "undefined" || !DEFAULT_BRAIN) {
            return uiLog("no built-in champion in this build — evolve one, then Brain → Bake default_brain.js");
        }
        brainIO.importJSON(JSON.stringify(DEFAULT_BRAIN));
    },
    /* The built-in brain is baked against one sensor suite. Change the channel
     * table and its weight matrices no longer describe this drone at all, so
     * every path that loads it re-checks the shape first. */
    builtIn() {
        if (typeof DEFAULT_BRAIN === "undefined" || !DEFAULT_BRAIN) return null;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        if (net.sizes.join() !== NET_SIZES.join()) {
            uiLog(`built-in brain is ${net.sizes.join("-")}, this build needs ${NET_SIZES.join("-")} — retrain and re-bake`);
            return null;
        }
        return net;
    },
    builtInFitness() {
        return (typeof DEFAULT_BRAIN !== "undefined" && DEFAULT_BRAIN && DEFAULT_BRAIN.fitness) || 0;
    },
    /* The best brain available right now: the one baked into the page, unless
     * this session's own evolution has genuinely beaten its recorded score.
     * Naively preferring `evo.champion` made the "watch the trained champion"
     * button showcase a random brain from generation 2 — technically the live
     * champion, and not at all what the button promises. */
    best() {
        const built = brainIO.builtIn();
        if (!built) return evo && evo.champion ? evo.champion : null;
        if (evo && evo.champion && evo.championFit > brainIO.builtInFitness()) return evo.champion;
        return built;
    },
    showcase() {
        runShowcase(brainIO.best());
    },
    injectBest() {
        const src = brainIO.best();
        if (!src) return uiLog("no champion to inject");
        if (showcase) restart();
        evo.brains[0] = src.clone();
        evo.grace = { net: evo.brains[0], left: 10 };
        UI.setGrace(10);
        uiLog("champion injected with a 10-generation grace period");
    }
};

/* ------------------------------------------------------- headless driving
 * Everything the panel can do, a URL can do, so the sim can be trained by a
 * browser with no one sitting in front of it:
 *
 *   index.html?train&headless&nointro&pop=96&episodes=4&gens=300
 *
 * `?gens=N` parks the run when it is done and puts the bakeable brain in
 * <pre id="bake-out">, with document.title set to "DONE …" so a driver has
 * something to poll that survives without a debugger attached. Chrome's
 * --virtual-time-budget fast-forwards requestAnimationFrame, so headless Chrome
 * runs generations as fast as it can rather than in real time. */
/* Run to completion in one blocking loop, no requestAnimationFrame involved.
 *
 * This exists because `chrome --headless --dump-dom` dumps the DOM as soon as
 * loading finishes: rAF never gets a chance to run, and --virtual-time-budget
 * does not help, because virtual time is frozen for the duration of a script
 * task, so a frame-budget loop measured with performance.now() cannot advance
 * either. Stepping synchronously inside the load handler sidesteps both — the
 * dump then happens after the run rather than before it.
 *
 * The step cap is a backstop, not a limit anyone should hit: it stops a bug in
 * an episode's end condition from wedging a headless browser indefinitely. */
function runSync(gens, capSteps) {
    stopAfterGen = gens;
    runFinished = false;
    const cap = capSteps || 4e8;
    let steps = 0;
    while (!runFinished) {
        while (!world.isOver()) {
            world.step();
            if (++steps > cap) {
                uiLog(`<span class="evt">sync run hit the ${cap.toLocaleString()}-step cap ` +
                    `at generation ${evo.gen} — stopping</span>`);
                document.title = `CAPPED gen=${evo.gen}`;
                return false;
            }
        }
        if (valState) finishValEpisode(); else finishEpisode();
    }
    return true;
}

function applyUrlParams() {
    const q = new URLSearchParams(location.search);
    const num = k => (q.has(k) && q.get(k) !== "" && !isNaN(+q.get(k))) ? +q.get(k) : null;
    const flag = k => q.has(k) && q.get(k) !== "0" && q.get(k) !== "false";
    const slider = (id, v) => {
        const el = $(id);
        if (!el || v == null) return;
        el.value = v;
        el.dispatchEvent(new Event("input"));
    };
    slider("sl-pop", num("pop"));
    slider("sl-eps", num("episodes"));
    slider("sl-grace", num("grace"));
    slider("sl-stagelock", num("stagelock"));
    if (q.has("headless")) {
        const el = $("chk-headless");
        el.checked = flag("headless");
        el.dispatchEvent(new Event("change"));
    }
    if (q.has("noise")) {
        const el = $("chk-noise");
        el.checked = flag("noise");
        el.dispatchEvent(new Event("change"));
    }
    if (num("speed") != null && UI.setSpeed) UI.setSpeed(num("speed"));
    if (num("gens") != null) stopAfterGen = num("gens");
    return { train: flag("train"), sync: flag("sync"), seed: num("seed") };
}

/* --------------------------------------------------------------------- boot */
window.addEventListener("load", () => {
    initUI(Object.assign({
        onRestart: () => restart(),
        hasBuiltIn: () => !!brainIO.builtIn()
    }, brainIO));
    renderer = new Renderer($("view"));
    renderer.resize();
    UI.setFollow = v => { renderer.followLeader = v; };
    UI.setFollow($("chk-follow").checked);
    window.addEventListener("resize", () => renderer.resize());
    const opt = applyUrlParams();
    evo = new Evolution(CFG.popSize, opt.seed != null ? opt.seed : 20260729);
    newGeneration();
    uiLog(`quadrotor: ${DRONE.MASS.toFixed(1)} kg, ${(DRONE.ARM * 2).toFixed(2)} m across, ` +
        `4 rotors at ${DRONE.TMAX.toFixed(1)} N · brain ${NET_SIZES.join("-")}`);

    // A handle for a headless browser (or the console) to drive and read the
    // run without reaching into module internals.
    window.DRONE_SIM = {
        get gen() { return evo.gen; },
        get stage() { return stage; },
        get bestVal() { return bestVal > -1e17 ? bestVal : null; },
        get lastVal() { return lastValFit; },
        get history() { return evo.history; },
        get finished() { return !!stopAfterGen && evo.gen > stopAfterGen; },
        train: (seed) => restart(seed),
        championJSON: () => evo.champion
            ? JSON.stringify({ net: evo.champion.toJSON(), fitness: bestVal, gen: evo.gen })
            : null,
        defaultBrainSource,
        runSync
    };

    // ?train goes straight to a fresh run; otherwise open on the trained brain.
    // A visitor who lands here should see a drone that can fly, not ninety-six
    // random ones falling over — "evolve from scratch" is right there for the
    // other thing. (The intro modal offers the same choice; this covers
    // ?nointro links, screenshots, and anyone who dismisses it without picking.)
    const built = brainIO.builtIn();
    if (opt.train) {
        restart(opt.seed);
        // ?sync finishes the whole run before this handler returns, so a headless
        // dump of the DOM contains the finished result rather than generation 1.
        if (opt.sync && stopAfterGen) runSync(stopAfterGen);
    } else if (built) {
        uiLog(`built-in champion loaded — exam score ${brainIO.builtInFitness().toFixed(2)}`);
        runShowcase(built);
    }
    requestAnimationFrame(loop);
});
