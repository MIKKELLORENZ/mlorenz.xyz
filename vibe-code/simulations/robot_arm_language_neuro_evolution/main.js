/* main.js — playback. One bench, one arm, one instruction at a time.
 *
 * This page used to run the whole evolutionary loop in the browser: a
 * population, a curriculum, twelve benches at once. That made sense while the
 * training WAS the story. It is not any more — the arm is trained offline by
 * `distill.js`, the brain is baked into `default_brain.js`, and what a visitor
 * wants from the page is to give the arm an instruction and watch it obey.
 *
 * Twelve simultaneous benches were also actively confusing: every one of them
 * is a different noise draw of the same policy, which is a good way to read a
 * fleet's variance and a terrible way to see whether the arm understood the
 * sentence. So: one bench, one arm, and the controls are all about the
 * instruction and the scene rather than about mutation rates.
 */
"use strict";

let world = null;
let renderer = null;
let brain = null;             // the baked brain, or null if none was baked
let referenceMode = false;
let lastFrame = 0;
let simTime = 0;
let sceneSeed = 1;
let holdUntil = 0;            // wall-clock ms to linger on a finished bench

/* Playback always runs the full task — every goal kind, a crowded bench, and
 * the servo noise the arm was trained under. The curriculum that used to pick
 * these belonged to evolution and went with it. */
const PLAY = { maxBalls: MAX_BALLS, fill: 2.0, noise: 0.3 };

function randomSeed() { return 1 + ((Math.random() * 900000) | 0); }

/* Which instruction is running: whatever the user typed, else whatever they
 * pinned, else the first sentence of the selected pool. */
function currentTask() {
    if (CFG.liveTask) return CFG.liveTask;
    if (CFG.pinnedTaskId) {
        const t = TASKS.find(x => x.id === CFG.pinnedTaskId);
        if (t) return t;
    }
    const pool = TASKS.filter(t => t.split === CFG.split);
    return pool[sceneSeed % pool.length] || TASKS[0];
}

/* Deal a bench. `keepSeed` re-runs the identical scene, which is what makes
 * "does it behave differently if I reword this?" an answerable question. */
function deal(keepSeed) {
    if (!keepSeed) sceneSeed = randomSeed();
    const task = currentTask();
    world = new World([brain || new Brain(Embedding.dim, mulberry32(1))], {
        task,
        embedding: CFG.liveEmbedding || Embedding.forTask(task),
        sceneSeed,
        noiseSeed: sceneSeed ^ 0x5f3a,
        maxBalls: PLAY.maxBalls,
        fill: CFG.fill,
        noise: CFG.noise
    });
    if (referenceMode) world.stations.forEach(s => { s.policy = makeReferencePolicy(); });
    simTime = 0;
    holdUntil = 0;
    UI.onEpisode(task, world, sceneSeed, referenceMode);
}

/* ------------------------------------------------------------------- loop */
function frame(ts) {
    requestAnimationFrame(frame);
    const dtWall = Math.min(0.05, (ts - lastFrame) / 1000 || 1 / 60);
    lastFrame = ts;

    if (world && !CFG.paused) {
        if (world.isOver()) {
            /* Linger on the finished bench before dealing the next one. Cutting
             * instantly to a fresh scene reads as a glitch — you never see the
             * bench the arm actually cleared. */
            if (!holdUntil) holdUntil = ts + 1600;
            else if (CFG.autoDeal && ts > holdUntil) deal(false);
        } else {
            const budget = CFG.speed === 0 ? 0.05 : dtWall * CFG.speed;
            let spent = 0;
            const t0 = performance.now();
            while (spent < budget) {
                world.step();
                simTime += world.dt;
                spent += world.dt;
                if (world.isOver()) break;
                if (CFG.speed === 0 && performance.now() - t0 > 26) break;
            }
        }
    }

    if (world) {
        renderer.focus = 0;
        renderer.showEyes = CFG.showEyes;
        // one bench, always framed as one bench
        renderer.draw(world.stations, { maxBenches: 1, leader: 0, soloView: true });
        UI.onFrame(world, simTime);
    }
}

/* ------------------------------------------------------------------ boot */
function setDriver(useReference) {
    referenceMode = useReference;
    deal(true);
}

function boot() {
    const canvas = document.getElementById("view");
    renderer = new Renderer(canvas, "light");
    window.addEventListener("resize", () => renderer.resize());

    const baked = (typeof DEFAULT_BRAIN !== "undefined" && DEFAULT_BRAIN) ? DEFAULT_BRAIN : null;
    if (baked) brain = Brain.fromJSON(baked.brain);

    initUI({
        deal,
        setDriver,
        setTheme: (t) => renderer.setTheme(t),
        resize: () => renderer.resize()
    });
    UI.setBaked(baked);

    sceneSeed = randomSeed();

    /* ---- headless hook ----------------------------------------------------
     * ?bench=N steps the sim N times SYNCHRONOUSLY at load, then draws one
     * frame. Screenshot tools run Chrome under --virtual-time-budget, where
     * requestAnimationFrame barely fires and performance.now() is frozen during
     * synchronous JS — so a normal rAF loop photographs the arm in its birth
     * pose. Stepping inline is the only way to get a frame with the sim
     * actually doing something.
     *
     * ?task=<id> pins a sentence, ?seed=N pins the bench, ?ref=1 runs the
     * scripted controller, ?eyes=1 shows the wrist stereo pair, ?bare=1 strips
     * the panels for a full-bleed screenshot. */
    const q = new URLSearchParams(location.search);
    if (q.has("seed")) sceneSeed = parseInt(q.get("seed"), 10) || sceneSeed;
    if (q.has("task")) CFG.pinnedTaskId = q.get("task");
    if (q.has("fill")) CFG.fill = parseFloat(q.get("fill")) || CFG.fill;
    if (q.get("eyes") === "1") CFG.showEyes = true;
    if (q.get("theme") === "dark") document.getElementById("btn-theme").onclick();

    if (q.has("bench")) {
        const n = Math.max(1, Math.min(60000, parseInt(q.get("bench"), 10) || 900));
        referenceMode = q.has("ref");
        hideIntro();
        deal(true);
        for (const k of ["dist", "yaw", "pitch"]) {
            const v = parseFloat(q.get(k));
            if (isFinite(v)) renderer.orbit[k] = v;
        }
        for (let i = 0; i < n && world && !world.isOver(); i++) world.step();
        CFG.paused = true;
        renderer.showEyes = CFG.showEyes;
        renderer.draw(world.stations, { maxBenches: 1, leader: 0, soloView: true });
        UI.onFrame(world, world.t);
        const s = world.stations[0];
        document.title = `bench ${n} steps · ${s.delivered}/${s.evalr.target} delivered`;
    } else {
        deal(true);
    }

    if (q.get("bare") === "1") {
        /* Strip the chrome so the canvas fills the window. The thumbnail wants a
         * picture of the BENCH, and cropping a screenshot of the full page to
         * the stage gets the aspect ratio subtly wrong every time. */
        for (const id of ["panel-left", "panel-right", "topbar"]) {
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        }
        const layout = document.getElementById("layout");
        if (layout) { layout.style.gridTemplateColumns = "1fr"; layout.style.padding = "0"; }
        const sw = document.getElementById("stage-wrap");
        if (sw) { sw.style.margin = "0"; sw.style.border = "none"; sw.style.borderRadius = "0"; }
        hideIntro();
        renderer.resize();
    }

    requestAnimationFrame(frame);
}

document.addEventListener("DOMContentLoaded", boot);
