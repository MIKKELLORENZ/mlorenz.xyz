/* main.js — the loop that ties evolution, physics and the view together.
 *
 * A generation is CFG.episodes episodes; a walker's score for the generation is
 * the mean of its episodes. Scoring over more than one episode is not a nicety:
 * with a single mission seed the top of the ranking is largely luck about where
 * the waypoints fell, and selecting on luck goes nowhere.
 */
"use strict";

const model = HUMANOID;
let evo = null;
let world = null;
let renderer = null;
let acc = null;          // per-brain accumulator across the generation's episodes
let episodeIdx = 0;
let stageInfo = { stage: 1, terrainDifficulty: 0.15 };
let showcase = false;    // whole fleet driven by one brain
let showcaseNet = null;
/* Watch mode counts EPISODES, monotonically, and nothing else.
 *
 * Training draws its mission from `gen + episodeIdx` — a sliding window, so
 * consecutive generations deliberately overlap and the objective drifts instead
 * of being replaced. Replayed one episode at a time that scheme repeats itself:
 * gen 1 episode 2 and gen 2 episode 1 are both mission 2, so watching produced
 * the same world twice in a row for no reason anyone watching could see. A
 * counter that only ever goes up gives a new world every time. */
let watchEp = 0;

/* Which pose watch mode should pin, resolved against the model each episode.
 * Returns null for "let the world draw one", which is what training does. */
function watchStartPose() {
    if (!showcase) return null;
    const p = CFG.watchPose;
    if (p === "random" || p == null) return null;
    /* "" is the TRAINING default spawn, and that is not a calm stance: it is
     * M.crouch, a half-squat at 0.764 m hip height against 0.900 standing, and
     * the episode's first phase exists to rise out of it. Watching it, a walker
     * pushing itself upright reads as unstable rather than as the curriculum
     * working — which is exactly what it was mistaken for. */
    if (p === "") return null;
    /* So a genuinely upright spawn is offered separately, built from the nominal
     * keyframe — the pose the body is defined at, full height, nothing to
     * recover from. depth 0, so it earns no rise grace and the phase clock runs
     * as normal. A ±1.4° per-joint jitter still applies when noise is on; that is
     * the fairness jitter every episode gets and is deliberately kept. */
    /* pitch and roll are NOT optional. The spawn rotates the body by them before
     * dropping it onto the terrain, and leaving them undefined puts NaN through
     * the rotation and out into every joint — the walker spawns with a NaN hip
     * height and the episode is quietly meaningless. Caught by asserting the
     * spawn height in the browser rather than by anything failing loudly. */
    if (p === "stand") return { name: "standing", pitch: 0, roll: 0, q: model.nominal, depth: 0 };
    if (p === "crouch") return model.crouchAt(1.0);
    if (p === "seat") return model.seatAt(1.0);
    return (model.startPoses || []).find(q => q.name === p) || null;
}
let lastFrame = 0;

/* ------------------------------------------------------------------ helpers */
function stageOpts() {
    const s = stageFor(evo.gen, evo.history, {
        stageLock: CFG.stageLock,
        terrainDifficulty: CFG.terrainDiff > 0 ? CFG.terrainDiff : undefined
    });
    if (CFG.terrainDiff > 0) s.terrainDifficulty = CFG.terrainDiff;
    return s;
}

function startEpisode() {
    world = new World(model, evo.brains, {
        stage: stageInfo.stage,
        terrainDifficulty: stageInfo.terrainDifficulty,
        terrainId: CFG.terrainId,
        // Sliding mission window, same scheme as train.js: generation g runs
        // missions g..g+episodes-1, so consecutive generations overlap and the
        // objective drifts instead of being replaced. A fixed brain's score
        // swings by 1,900 points across missions, which is far more than the
        // gap between two good brains — redrawing every generation meant
        // selection was ranking the mission, not the walker.
        // Watch mode has no generations, so its mission comes off a counter that
        // only ever goes up; training keeps the sliding window described above.
        missionSeed: 1 + (showcase ? watchEp : evo.gen + episodeIdx) * 37,
        noiseSeed: 5000 + (showcase ? watchEp : evo.gen + episodeIdx) * 13,
        noise: CFG.noise,
        /* Pinned only in watch mode. null everywhere else, which leaves the three
         * spawn draws to decide exactly as they do in training. */
        startPose: watchStartPose(),
        /* Rise trial: every Nth generation the whole fleet starts on the floor in
         * one pose and is ranked on mean COM height instead of the ledger. Never
         * in watch mode — showcase is a demonstration, not a selection round. */
        riseTrial: (!showcase && evo.isRiseTrial) ? evo.risePose : null,
        /* SHOWCASE DOES NOT START ON THE FLOOR.
         *
         * Every stage sets `ground: 0.45`, so 45% of ordinary training episodes
         * begin the walker seated or in a deep crouch. That is deliberate for
         * TRAINING — getting up is a skill on the ladder — but it makes a
         * demonstration misleading in both directions. Rising from the floor is
         * the one thing this project has measured as effectively unlearned
         * (champions gain under 2 cm from a prone start), so nearly half of a
         * showcase was the walker sitting on the ground failing at a task the
         * headline number never included: the held-out exam passes groundFrac 0.
         *
         * Measured on the gen-676 champion, twelve missions each:
         *     no floor starts   1.58 wp / 5.78 m
         *     45% floor starts  0.92 wp / 3.22 m
         * Same brain. So the showcase now runs the exam's conditions and says so
         * in the log, rather than quietly showing a 40% worse walker than the
         * number it is presented with. Ordinary evolution is untouched. */
        /* …with one exception, added when the start-pose pool went in. The
         * argument above is about the crouch/seat RAMP, whose whole content is
         * "how far down does it start" — showing a walker fail to rise from a
         * seat for half a showcase says nothing the headline number covers.
         *
         * The pool is a different question: it is the reason the poses exist, and
         * watching the champion meet a quadruped or a side plank IS the thing
         * worth looking at. So CFG.showcasePoses turns the ramp off and the pool
         * on — every episode starts in one of the fourteen, none in a crouch or a
         * seat. Off by default, so the plain showcase still reports the same
         * conditions as the held-out exam and stays comparable to its own number. */
        /* ONE control decides the watch-mode spawn, and that is the fix for a bug
         * this exact pattern already caused once. `showcasePoses` pinned
         * groundFrac and poseFrac to 1 — every episode a floor pose — while the
         * pose picker separately returned null for BOTH "random" and "standing",
         * so choosing Standing changed nothing at all and the walker still came
         * up in a quadruped or a side plank. Two controls, neither wrong on its
         * own, disagreeing about the answer. Same shape as the spawn-fraction
         * composition that made stoodFrac look like forgetting.
         *
         * Now watchPose is the only input: "" means stand, everything else means
         * draw or pin from the floor pool. seatFrac stays 0 regardless — the seat
         * branch is tested BEFORE the pool branch, so at groundFrac 1 it claimed
         * most episodes and a "pose showcase" came out three-quarters seat rungs. */
        groundFrac: showcase ? (CFG.watchPose === "" ? 0 : 1) : undefined,
        seatFrac: showcase ? 0 : undefined,
        poseFrac: showcase ? (CFG.watchPose === "" ? 0 : 1) : undefined
    });
    UI.setStage(stageInfo.stage, stageInfo.terrainDifficulty);
    if (showcase) {
        watchEp++;
        const el = document.getElementById("stat-episode");
        if (el) el.textContent = watchEp;
    }
    /* Everything needed to rebuild this exact episode headlessly. World is
     * deterministic in these, so an incident dump carrying them can be replayed
     * and instrumented afterwards — which beats recording more telemetry. */
    recordEpisode({
        gen: evo.gen, episode: episodeIdx + 1, showcase,
        stage: stageInfo.stage, terrainDifficulty: stageInfo.terrainDifficulty,
        terrainId: CFG.terrainId,
        missionSeed: 1 + (showcase ? watchEp : evo.gen + episodeIdx) * 37,
        noiseSeed: 5000 + (showcase ? watchEp : evo.gen + episodeIdx) * 13,
        noise: CFG.noise, fleet: evo.brains.length,
        groundFrac: showcase ? (CFG.watchPose === "" ? 0 : 1) : null,
        seatFrac: showcase ? 0 : null,
        poseFrac: showcase ? (CFG.watchPose === "" ? 0 : 1) : null,
        watchPose: showcase ? CFG.watchPose : null,
        stage2: CFG.stageLock,
        startPoses: world.walkers.map(w => w.startPose),
        netSizes: NET_SIZES.slice(),
        // shape does not identify a brain — every champion here is 364-48-32-33
        brainFP: netFingerprint(evo.brains[0])
    });
}

function newGeneration() {
    stageInfo = stageOpts();
    episodeIdx = 0;
    acc = evo.brains.map(() => ({ fitness: 0, arrivals: 0, stood: 0, balanced: 0, upright: 0, meanCom: 0 }));
    startEpisode();
}

function finishEpisode() {
    const n = CFG.episodes;
    world.walkers.forEach((w, i) => {
        acc[i].fitness += w.fitness() / n;
        acc[i].arrivals += w.arrivals / n;
        acc[i].stood += (w.stood ? 1 : 0) / n;
        acc[i].balanced += (w.balanced ? 1 : 0) / n;
        acc[i].upright += w.uprightTime / n;
        // Averaged across the generation's episodes like everything else here, so
        // a rise trial ranks on how high a brain gets ON AVERAGE and not on its
        // single luckiest episode — max-over-episodes is the order-statistic trap
        // that has inflated every candidate score in this project.
        acc[i].meanCom += w.meanCom() / n;
    });
    episodeIdx++;
    if (episodeIdx < n) { startEpisode(); return; }
    endGeneration();
}

function endGeneration() {
    const N = acc.length;
    const stats = {
        stage: stageInfo.stage,
        terrainDifficulty: stageInfo.terrainDifficulty,
        stoodFrac: acc.reduce((s, a) => s + a.stood, 0) / N,
        balancedFrac: acc.reduce((s, a) => s + a.balanced, 0) / N,
        avgArr: acc.reduce((s, a) => s + a.arrivals, 0) / N,
        bestArr: Math.max.apply(null, acc.map(a => a.arrivals)),
        avgUpright: acc.reduce((s, a) => s + a.upright, 0) / N
    };
    const results = evo.brains.map((b, i) => ({
        brain: b, fitness: acc[i].fitness, arrivals: acc[i].arrivals, meanCom: acc[i].meanCom
    }));
    const gen = evo.gen;
    const rec = evo.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.gracePeriod, {
        immZeroFit: CFG.immZeroFit, childZeroFit: CFG.childZeroFit, evalMode: CFG.evalMode
    }, stats);

    /* Watch mode is replaying one frozen brain, so a generation number beside the
     * result is not just redundant, it is misleading — nothing was bred and the
     * counter would read as progress. Report the episodes instead. */
    uiLog((showcase
            ? `<span class="gen">episodes ${watchEp}</span> · fitness <b>${rec.best.toFixed(0)}</b> · mean ${rec.avg.toFixed(0)}`
            : `<span class="gen">gen ${gen}</span> · best <b>${rec.best.toFixed(0)}</b> · mean ${rec.avg.toFixed(0)}`) +
        ` · stood ${(stats.stoodFrac * 100) | 0}% · balanced ${(stats.balancedFrac * 100) | 0}%` +
        (stats.avgArr > 0 ? ` · <span class="evt">waypoints ${stats.avgArr.toFixed(2)}/${stats.bestArr.toFixed(0)}</span>` : ""));
    if (evo.graceEvent) uiLog(`<span class="evt">${evo.graceEvent}</span>`);
    if (stageInfo.stage !== stageOpts().stage) uiLog(`<span class="evt">→ stage ${stageOpts().stage} unlocked</span>`);

    drawChart(evo.history);
    drawSkillChart(evo.history);
    document.getElementById("stat-gen").textContent = evo.gen;
    document.getElementById("stat-best").textContent = evo.championFit.toFixed(0);
    document.getElementById("stat-wp").textContent = `${stats.bestArr.toFixed(0)} / ${stats.avgArr.toFixed(2)}`;

    // Showcase runs a fixed brain, so it keeps its own (smaller) population and
    // re-seeds it every generation — otherwise mutation quietly turns the demo
    // into a fresh evolution run after one generation.
    if (showcase) {
        for (let i = 0; i < evo.brains.length; i++) evo.brains[i] = showcaseNet.clone();
    } else if (CFG.popSize !== evo.popSize) { restart(); return; }
    newGeneration();
}

/* ------------------------------------------- re-read default_brain.js on demand
 *
 * The bake bridge rewrites default_brain.js while the page is open, and the page
 * has no idea: the file arrived as a <script src>, so it is cached and a plain
 * reload often serves the old one. Clearing the cache to see a new brain is a
 * silly thing to have to do several times an hour.
 *
 * A cache-busted <script> tag rather than fetch(), because this page is usually
 * opened from the filesystem and fetch() on a file:// URL is blocked as a
 * cross-origin request — the obvious implementation works over http and fails
 * exactly where it is most used. Script tags have no such restriction.
 *
 * DEFAULT_BRAIN is a `const` at global scope, so a second declaration would
 * throw; the freshly loaded file is therefore read out of the new script's own
 * evaluation by re-declaring into a window property first. */
function reloadBrainFile(done) {
    const s = document.createElement("script");
    s.src = "default_brain.js?v=" + Date.now();
    s.onload = () => {
        s.remove();
        done(null, typeof DEFAULT_BRAIN !== "undefined" ? DEFAULT_BRAIN : null);
    };
    s.onerror = () => { s.remove(); done(new Error("could not read default_brain.js")); };
    document.head.appendChild(s);
}

/* Every walker in the fleet runs the same brain — the way to actually watch one
 * evolved gait, and a fair readout of how repeatable it is under noise. */
function runShowcase(net) {
    if (!net) { uiLog("no champion available yet"); return; }
    showcase = true;
    showcaseNet = net.clone();
    /* Name what is on screen. brainId is a deterministic hash of the weights, so
     * this code is the same one bake_brain.js printed — which is what turns "the
     * new brain is loaded, probably" into something checkable. */
    const idEl = document.getElementById("stat-brain");
    if (idEl) idEl.textContent = brainId(showcaseNet);
    // Viewing mode: eval on, the breeding controls out of the way, and the
    // fitness/skills/log column gone — it would be plotting one frozen brain
    // against itself. All of it comes back if eval is switched off.
    UI.setShowcase(true);
    /* Show it the ground it was trained on.
     *
     * A fresh page sits at generation 1, so stageFor() returns stage 1 — ceiling
     * 0.35 on relief — and the per-episode draw takes 0.2 to 1.0 of that, so a
     * showcase could be watching a stage-4 champion on ground with 7% of the
     * relief it was bred against. Visually that is a flat white plane, which is
     * why hills and stairs were unreadable; and it also flatters the walker,
     * since it never meets the terrain it actually struggles with.
     *
     * BUT NOT A HARDCODED STAGE. This said `stageLock = 4` because the run it
     * was written for finished at stage 5. Point it at a brain from a younger
     * run and it silently drops a stage-2 walker into 2.5x the shove and a wind
     * it has never met once — stage 2 has wind 0. It falls over instantly, and
     * the only available reading of that is "the transfer is broken".
     *
     * So the stage travels with the brain: bake_brain.js records the stage the
     * run had reached, and that is what gets shown. A brain with no recorded
     * stage falls back to 2 rather than 4 — the conservative end, because
     * flattering a walker is a far smaller error than making a working one look
     * broken. CFG.watchStage lets it be overridden from the panel. */
    const baked = (typeof DEFAULT_BRAIN !== "undefined" && DEFAULT_BRAIN && DEFAULT_BRAIN.stage) || null;
    CFG.watchStage = CFG.watchStage || baked || 2;
    CFG.stageLock = CFG.watchStage;
    /* Difficulty follows the stage rather than being pinned at full. Stage 4 and
     * 5 draw a per-episode spread in training, so pinning 1.0 shows the hardest
     * ground the walker ever saw, every episode — not what it was bred against. */
    CFG.terrainDiff = CFG.watchStage >= 4 ? 1 : 0;
    if (UI.setWatchStage) UI.setWatchStage(CFG.watchStage);
    uiLog(`replaying on <b>stage ${CFG.watchStage}</b>` +
        (baked ? ` — the stage this brain was trained to` : ` — this brain records no stage, so a safe default`));
    evo = new Evolution(Math.max(8, Math.min(CFG.popSize, 24)), 99, null, { riseEvery: CFG.riseEvery, risePose: CFG.risePose });
    for (let i = 0; i < evo.brains.length; i++) evo.brains[i] = net.clone();
    evo.champion = net.clone();
    newGeneration();
    uiLog(`<span class="evt">showcase — ${evo.brains.length} copies of one brain</span>`);
    // Said out loud, because it changes what you are looking at.
    uiLog(`floor starts off for the showcase — same conditions as the held-out exam`);
}

function restart() {
    // Hand the curriculum back to the ratchet — the showcase pinned it to the
    // champion's stage, and a fresh evolution has to start at stage 1 and earn
    // its way up or it is dropped straight onto a cliff.
    if (showcase) { CFG.stageLock = 0; CFG.terrainDiff = 0; }
    showcase = false;
    showcaseNet = null;
    UI.setShowcase(false);
    evo = new Evolution(CFG.popSize, (Math.random() * 1e9) | 0, null, { riseEvery: CFG.riseEvery, risePose: CFG.risePose });
    newGeneration();
    uiLog("evolution restarted from random brains");
}

/* --------------------------------------------------------------------- HUD */
function updateHud() {
    if (!world) return;
    const w = world.walkers[world.leaderIdx] || world.walkers[0];
    const $ = id => document.getElementById(id);
    $("stat-phase").textContent = world.phase;
    $("stat-wind").textContent = world.windOn ? `${Math.hypot(world.wind[0], world.wind[2]).toFixed(1)} m/s` : "calm";
    $("ep-time").textContent = world.time.toFixed(1) + " s";
    $("ep-clock").textContent = w.timeLeft.toFixed(1) + " s";
    const clr = w.groundClearance(world);
    $("ep-hip").textContent = `${clr.toFixed(2)} m (${((clr / model.standHipY) * 100) | 0}%)`;
    const up = w.uprightness();
    const upEl = $("ep-up");
    upEl.textContent = up.toFixed(2);
    upEl.className = up > 0.8 ? "good" : up > 0.5 ? "warn" : "";
    const sp = Math.hypot(w.mb.qd[3], w.mb.qd[5]);
    $("ep-speed").textContent = sp.toFixed(2) + " m/s";
    $("ep-load").textContent = `${(w.footLoad[0] / model.weight).toFixed(2)} / ${(w.footLoad[1] / model.weight).toFixed(2)}`;
    $("ep-wp").textContent = w.arrivals;
    $("ep-mile").textContent = (w.stood ? "stood" : "—") + (w.balanced ? " · balanced" : "");
    $("ep-fit").textContent = w.fitness().toFixed(0);
    if (CFG.showSensors) drawSensors(w);
    document.getElementById("hud").innerHTML =
        `gen ${evo.gen} · episode ${episodeIdx + 1}/${CFG.episodes} · ${world.phase}<br>` +
        `leader #${w.idx} · ${w.fitness().toFixed(0)} pts · ${w.arrivals} waypoints`;
}

/* -------------------------------------------------------------------- loop */
function loop(now) {
    requestAnimationFrame(loop);
    const dtWall = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;

    if (!CFG.paused && world) {
        const budgetMs = CFG.headless ? 26 : 11;
        const t0 = performance.now();
        if (CFG.speed === 0 || CFG.headless) {
            // MAX: spend a fixed slice of wall-clock on physics, check the clock
            // every few hundred ticks so a fast machine is not throttled by the
            // timer call itself
            while (performance.now() - t0 < budgetMs) {
                for (let i = 0; i < 250 && !world.isOver(); i++) { world.step(); if (CFG.record) recordTick(world); }
                if (world.isOver()) { finishEpisode(); break; }
            }
        } else {
            let steps = Math.min(6000, Math.round(dtWall * CFG.speed / DT));
            while (steps-- > 0 && !world.isOver()) { world.step(); if (CFG.record) recordTick(world); }
            if (world.isOver()) finishEpisode();
        }
    }

    const wrap = document.getElementById("canvas-wrap");
    const hidden = CFG.headless;
    wrap.style.opacity = hidden ? "0.12" : "1";
    if (!hidden && world) {
        if (renderer.canvas.width !== renderer.canvas.clientWidth * Math.min(devicePixelRatio, 1.75)) renderer.resize();
        renderer.frame(world, CFG);
    }
    updateHud();
}

/* ------------------------------------------------------------ brain storage */
const KEY = "walk_neuro_champion_v1";
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
        const blob = new Blob([JSON.stringify({
            net: evo.champion.toJSON(), fitness: evo.championFit, gen: evo.gen, netSizes: NET_SIZES
        })], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `walker_champion_gen${evo.gen}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
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
        if (typeof DEFAULT_BRAIN === "undefined" || !DEFAULT_BRAIN) return uiLog("no built-in champion in this build");
        brainIO.importJSON(JSON.stringify(DEFAULT_BRAIN));   // checks the shape itself
    },
    /* The built-in brain is baked against one body. Change the joint count and
     * its weight matrices no longer describe this walker at all — importJSON
     * has always checked that, but these two paths went straight to fromJSON
     * and would have loaded a brain shaped for a body that no longer exists. */
    builtIn() {
        if (typeof DEFAULT_BRAIN === "undefined" || !DEFAULT_BRAIN) return null;
        const net = Net.fromJSON(DEFAULT_BRAIN.net || DEFAULT_BRAIN);
        if (net.sizes.join() !== NET_SIZES.join()) {
            uiLog(`built-in brain is ${net.sizes.join("-")}, this body needs ${NET_SIZES.join("-")} — retrain and re-bake`);
            return null;
        }
        return net;
    },
    showcase() {
        runShowcase(evo && evo.champion ? evo.champion : brainIO.builtIn());
    },
    injectBest() {
        const src = brainIO.builtIn() || evo.champion;
        if (!src) return uiLog("no champion to inject");
        if (showcase) restart();
        evo.brains[0] = src.clone();
        evo.grace = { net: evo.brains[0], left: 10 };
        UI.setGrace(10);
        uiLog("champion injected with a 10-generation grace period");
    }
};

/* --------------------------------------------------------------------- boot */
window.addEventListener("load", () => {
    initUI(Object.assign({
        onRestart: restart,
        // Showcase scores nothing, so re-drawing the world mid-episode costs
        // nothing either. While training it must wait: a generation scored
        // across two different terrains is not a generation.
        onTerrain: () => { if (showcase && world) startEpisode(); },
        /* Re-read default_brain.js from disk and switch the showcase onto it,
         * with no page reload and no cache clear. Reports the brain id both
         * before and after so a no-op is visible as a no-op — "reloaded" next to
         * an unchanged code is the honest outcome when the bake has not landed
         * yet, and is far better than a success message that means nothing. */
        onReloadBrain: () => {
            const was = showcaseNet ? brainId(showcaseNet) : "–";
            reloadBrainFile((err, fresh) => {
                if (err) { uiLog(`<span class="evt">reload failed: ${err.message}</span>`); return; }
                const raw = fresh && (fresh.net || fresh);
                if (!raw) { uiLog(`<span class="evt">reload failed: no brain in that file</span>`); return; }
                if (raw.sizes.join() !== NET_SIZES.join()) {
                    uiLog(`<span class="evt">reload refused: that brain is ${raw.sizes.join("-")}, this build is ${NET_SIZES.join("-")}</span>`);
                    return;
                }
                const net = Net.fromJSON(raw);
                const now = brainId(net);
                if (showcase) { runShowcase(net); newGeneration(); }
                else { showcaseNet = net; }
                uiLog(`<span class="evt">brain reloaded: ${was} → ${now}` +
                    (was === now ? " (unchanged — nothing new has been baked)" : "") + "</span>");
            });
        }
    }, brainIO));
    renderer = new Renderer(document.getElementById("view"), model);
    // initUI runs first and may have restored a saved dark preference, but the
    // scene did not exist yet to receive it.
    if (window.__walk3dTheme === "dark") renderer.setTheme("dark");
    renderer.resize();
    window.addEventListener("resize", () => renderer.resize());
    evo = new Evolution(CFG.popSize, 20260729, null, { riseEvery: CFG.riseEvery, risePose: CFG.risePose });
    newGeneration();
    uiLog(`humanoid: ${model.totalMass.toFixed(0)} kg, ${model.height.toFixed(2)} m, ` +
        `${model.nj} servo joints · brain ${NET_SIZES.join("-")}`);
    requestAnimationFrame(loop);
});
