/* main.js — ties evolution, physics and the view together.
 *
 * A generation is CFG.episodes episodes, each a different instruction drawn
 * from the current stage's pool, and a brain's score is the mean across them.
 * Scoring on a single instruction selects for a brain that is good at that
 * instruction; the next generation asks a different one and the improvement
 * evaporates. The whole point is one policy that reads the sentence.
 */
"use strict";

let evo = null;
let world = null;
let renderer = null;
let acc = null;
let episodeIdx = 0;
let genTasks = [];
let stage = STAGES[0];
let showcase = false;         // one brain drives every bench
let showcaseBrain = null;
let referenceMode = false;
let lastFrame = 0;
let simTime = 0;

/* ------------------------------------------------------------------ tasks */
/* Returns a MISSION — instruction plus the scene and noise seeds that travel
 * with it. Pinning a sentence in the UI keeps the mission's scene, so switching
 * phrasings compares wordings on the same table rather than on a fresh draw. */
function currentMission(episode) {
    const m = genTasks[episode % genTasks.length];
    if (CFG.liveTask) return { task: CFG.liveTask, sceneSeed: m.sceneSeed, noiseSeed: m.noiseSeed };
    if (CFG.pinnedTaskId) {
        const t = TASKS.find(x => x.id === CFG.pinnedTaskId);
        if (t) return { task: t, sceneSeed: m.sceneSeed, noiseSeed: m.noiseSeed };
    }
    return m;
}

function newGeneration() {
    stage = stageFor(evo.gen, evo.history, { stageLock: CFG.stageLock });
    evo.stage = stage.id;
    genTasks = drawMissions(stage, evo.gen, CFG.episodes, CFG.split);
    acc = evo.brains.map(() => ({ fit: 0, del: 0, tgt: 0, mis: 0, comp: 0 }));
    episodeIdx = 0;
}

function startEpisode() {
    const mission = currentMission(episodeIdx);
    const task = mission.task;
    const brains = showcase
        ? new Array(CFG.popSize).fill(0).map(() => showcaseBrain)
        : evo.brains;
    world = new World(brains, {
        task,
        embedding: CFG.liveEmbedding || Embedding.forTask(task),
        // Showcase benches differ only in their noise stream, so a champion
        // shown on twelve benches is twelve honest samples of the same policy
        // rather than twelve identical copies of one lucky run.
        sceneSeed: showcase ? 4000 + episodeIdx * 91 + (CFG.showcaseSpin | 0) : mission.sceneSeed,
        noiseSeed: showcase ? 5000 + episodeIdx * 13 : mission.noiseSeed,
        maxBalls: stage.maxBalls,
        noise: showcase ? 0.3 : stage.noise
    });
    if (referenceMode) world.stations.forEach(s => { s.policy = makeReferencePolicy(); });
    simTime = 0;
    UI.onEpisode(task, stage, world);
}

function endEpisode() {
    if (!showcase) {
        world.results().forEach((r, i) => {
            acc[i].fit += r.fitness; acc[i].del += r.delivered;
            acc[i].tgt += r.target; acc[i].mis += r.mistakes; acc[i].comp += r.completed;
        });
    }
    episodeIdx++;
    if (showcase || episodeIdx < CFG.episodes) { startEpisode(); return; }

    const E = CFG.episodes;
    const results = evo.brains.map((b, i) => ({
        brain: b,
        fitness: acc[i].fit / E,
        delivered: acc[i].del / E,
        rate: acc[i].tgt > 0 ? acc[i].del / acc[i].tgt : 0,
        mistakes: acc[i].mis / E,
        completed: acc[i].comp / E
    }));
    const rec = evo.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.gracePeriod,
        { immZeroFit: CFG.immZeroFit, childZeroFit: CFG.childZeroFit });
    UI.onGeneration(evo, rec, stage);
    newGeneration();
    startEpisode();
}

/* ------------------------------------------------------------------- loop */
function frame(ts) {
    requestAnimationFrame(frame);
    const dtWall = Math.min(0.05, (ts - lastFrame) / 1000 || 1 / 60);
    lastFrame = ts;

    if (!CFG.paused && world) {
        const budget = CFG.speed === 0 ? 0.05 : dtWall * CFG.speed;   // 0 = as fast as a frame allows
        let spent = 0;
        const t0 = performance.now();
        while (spent < budget) {
            world.step();
            simTime += world.dt;
            spent += world.dt;
            if (world.isOver()) break;
            if (CFG.speed === 0 && performance.now() - t0 > 26) break;
        }
        if (world.isOver()) endEpisode();
    }

    if (world) {
        const stations = world.stations;
        let leader = 0;
        for (let i = 1; i < stations.length; i++)
            if (stations[i].fitness > stations[leader].fitness) leader = i;
        renderer.focus = Math.min(CFG.focus, stations.length - 1);
        renderer.draw(stations, {
            maxBenches: CFG.showBenches, leader, soloView: CFG.soloView
        });
        UI.onFrame(world, simTime, leader);
    }
}

/* ------------------------------------------------------------------ boot */
function restart(opts) {
    opts = opts || {};
    showcase = !!opts.showcase;
    referenceMode = !!opts.reference;
    evo = new Evolution(CFG.popSize, opts.seed || (Date.now() & 0xffff), Embedding.dim);
    if (showcase) {
        showcaseBrain = opts.brain;
        evo.champion = opts.brain;
        evo.championFit = opts.fitness || 0;
    } else if (opts.seedBrain) {
        // "continue from the trained champion" — rank 0 untouched, the rest
        // mutated copies. Dropping a champion into an otherwise random fleet
        // just gets it out-voted by noise for fifty generations.
        evo.brains[0] = opts.seedBrain.clone();
        for (let i = 1; i < CFG.popSize; i++)
            evo.brains[i] = opts.seedBrain.clone().mutate(CFG.mutRate * (0.5 + i / CFG.popSize), CFG.mutSigma, evo.rng);
    }
    newGeneration();
    startEpisode();
    UI.onRestart(evo, showcase, referenceMode);
}

function boot() {
    const canvas = document.getElementById("view");
    renderer = new Renderer(canvas, "light");
    window.addEventListener("resize", () => renderer.resize());

    initUI({
        restart,
        getEvo: () => evo,
        getWorld: () => world,
        setTheme: (t) => renderer.setTheme(t),
        resize: () => renderer.resize()
    });

    const baked = (typeof DEFAULT_BRAIN !== "undefined" && DEFAULT_BRAIN) ? DEFAULT_BRAIN : null;
    UI.setBaked(baked);

    /* ---- headless warm-up hook -------------------------------------------
     * ?bench=N steps the simulation N times SYNCHRONOUSLY at load, then draws
     * one frame. Screenshot tools run Chrome under --virtual-time-budget, where
     * requestAnimationFrame barely fires and performance.now() is frozen during
     * synchronous JS — so a normal rAF loop produces a picture of the arms
     * standing in their birth pose. Stepping inline is the only way to get a
     * frame that shows the sim actually doing something.
     *
     * ?task=<id> pins a specific instruction, ?ref=1 runs the scripted
     * reference controller (useful when no champion has been baked yet). */
    const q = new URLSearchParams(location.search);
    if (q.has("bench")) {
        const n = Math.max(1, Math.min(60000, parseInt(q.get("bench"), 10) || 900));
        if (q.has("pop")) CFG.popSize = Math.max(1, parseInt(q.get("pop"), 10) || 12);
        if (q.has("task")) CFG.pinnedTaskId = q.get("task");
        // ?stage=N pins the curriculum stage, which is what sets the ball budget.
        // Without it a pinned multi-colour sentence still runs under stage 1's
        // one-ball cap and the bench looks emptier than the instruction reads.
        if (q.has("stage")) CFG.stageLock = Math.max(1, Math.min(STAGES.length, parseInt(q.get("stage"), 10) || 1));
        if (q.has("benches")) CFG.showBenches = Math.max(1, parseInt(q.get("benches"), 10) || 12);
        // ?solo=1&focus=N&dist=&yaw=&pitch= frame one bench for a close-up. The
        // grid view is the honest picture of what is being simulated, but it is
        // useless for checking whether the hand is drawn correctly.
        if (q.get("solo") === "1") CFG.soloView = true;
        if (q.get("theme") === "dark") document.getElementById("btn-theme").onclick();
        if (q.has("focus")) renderer.focus = Math.max(0, parseInt(q.get("focus"), 10) || 0);
        for (const k of ["dist", "yaw", "pitch"]) {
            const v = parseFloat(q.get(k));
            if (isFinite(v)) renderer.orbit[k] = v;
        }
        hideIntro();
        restart(baked && !q.has("ref")
            ? { showcase: true, brain: Brain.fromJSON(baked.brain), fitness: baked.fitness }
            : { reference: q.has("ref") });
        for (let i = 0; i < n && world && !world.isOver(); i++) world.step();
        CFG.paused = true;
        let leader = 0;
        world.stations.forEach((s, i) => { if (s.fitness > world.stations[leader].fitness) leader = i; });
        renderer.draw(world.stations, { maxBenches: CFG.showBenches, leader, soloView: CFG.soloView });
        UI.onFrame(world, world.t, leader);
        document.title = `bench ${n} steps · ${world.stations[0].delivered} delivered`;
    }
    requestAnimationFrame(frame);
}

document.addEventListener("DOMContentLoaded", boot);
