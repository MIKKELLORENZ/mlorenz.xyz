/* main.js — boot, the generation cycle, the three viewing modes.
 *
 * evolve   a whole generation plays the same piece sequence side by side
 * showcase one brain, one game, full size
 * play     you, on the same engine, through the same onKeyDown/onKeyUp wire
 */
"use strict";

/* The brain's game is exactly tetris.js's DEFAULT_CFG — never a local variant,
 * or the champion would be judged on a game it never trained on. A human needs
 * slower gravity and a longer lock delay to be playing the same difficulty. */
const GAME_CFG = DEFAULT_CFG;
const HUMAN_CFG = { gravity: 34, softFactor: 6, maxTicksPerPiece: 100000, das: 9, arr: 3, lockDelay: 26 };

let evolution, pop, trial = 0, trialScores = null;
let mode = "evolve";
let paused = false;
let tickAccum = 0;
let showcase = null, human = null, humanKeysHeld = null;
let genRate = 0, lastGenTime = 0;

/* ------------------------------------------------------------- stage DOM */
const stageEl = document.getElementById("stage");
const boardsEl = document.getElementById("boards");
let heroCanvas, heroTag, holdCanvas, nextCanvas = [], fleetEl, fleetCells = [];
let rivalWrap, rivalCanvas, rivalTag;
let heroCell = 20, fleetCell = 5;
let rival = null;                 // the untrained control brain, in compare mode
let compareTally = { games: 0, champLines: 0, champPieces: 0, rivalLines: 0, rivalPieces: 0 };

function buildStage() {
    boardsEl.innerHTML = "";

    const hero = document.createElement("div");
    hero.className = "hero";

    const left = document.createElement("div");
    left.className = "side";
    left.innerHTML = '<div class="box"><h3>hold</h3></div>';
    holdCanvas = document.createElement("canvas");
    left.querySelector(".box").appendChild(holdCanvas);

    const mid = document.createElement("div");
    heroCanvas = document.createElement("canvas");
    heroTag = document.createElement("div");
    heroTag.className = "hero-tag";
    mid.appendChild(heroCanvas);
    mid.appendChild(heroTag);

    // second board, only used by the champion-vs-untrained comparison
    rivalWrap = document.createElement("div");
    rivalWrap.style.display = "none";
    rivalCanvas = document.createElement("canvas");
    rivalTag = document.createElement("div");
    rivalTag.className = "hero-tag";
    rivalWrap.appendChild(rivalCanvas);
    rivalWrap.appendChild(rivalTag);

    const right = document.createElement("div");
    right.className = "side";
    const nb = document.createElement("div");
    nb.className = "box";
    nb.innerHTML = "<h3>next</h3>";
    nextCanvas = [];
    for (let i = 0; i < 3; i++) {
        const c = document.createElement("canvas");
        nb.appendChild(c);
        nextCanvas.push(c);
    }
    right.appendChild(nb);

    hero.appendChild(left);
    hero.appendChild(mid);
    hero.appendChild(rivalWrap);
    hero.appendChild(right);
    boardsEl.appendChild(hero);

    fleetEl = document.createElement("div");
    fleetEl.id = "fleet";
    boardsEl.appendChild(fleetEl);
}

/* Sizes the hero board to the window and refills the small-multiples grid. */
function layoutStage() {
    if (!heroCanvas) return;
    const h = stageEl.clientHeight - 56;
    const showFleet = CFG.fleet && mode === "evolve";
    const compare = mode === "compare";
    // 200 px of the hero's budget goes to the hold and next columns; in compare
    // mode two boards have to fit side by side
    const wBudget = showFleet ? stageEl.clientWidth * 0.55 : stageEl.clientWidth - 80;
    heroCell = Math.max(8, Math.min(32,
        Math.floor(Math.min(h / ROWS_SHOWN, (wBudget - 200) / (compare ? BW * 2.2 : BW)))));
    rivalWrap.style.display = compare ? "" : "none";
    fleetEl.style.display = showFleet ? "grid" : "none";

    if (!showFleet) { fleetCells = []; fleetEl.innerHTML = ""; return; }

    const availW = stageEl.clientWidth - (BW * heroCell + 200) - 60;
    const availH = stageEl.clientHeight - 40;
    fleetCell = availW > 620 ? 6 : (availW > 420 ? 5 : 4);
    const cw = BW * fleetCell + 8, ch = ROWS_SHOWN * fleetCell + 8;
    const cols = Math.max(1, Math.floor(availW / cw));
    const rows = Math.max(1, Math.floor(availH / ch));
    const want = Math.max(0, Math.min(cols * rows, (pop ? pop.agents.length : CFG.pop) - 1));
    fleetEl.style.gridTemplateColumns = `repeat(${cols}, ${BW * fleetCell}px)`;
    if (fleetCells.length !== want) {
        fleetEl.innerHTML = "";
        fleetCells = [];
        for (let i = 0; i < want; i++) {
            const cell = document.createElement("div");
            cell.className = "cell";
            const c = document.createElement("canvas");
            const tag = document.createElement("i");
            cell.appendChild(c);
            cell.appendChild(tag);
            fleetEl.appendChild(cell);
            fleetCells.push({ cell, canvas: c, tag });
        }
    }
}
window.addEventListener("resize", layoutStage);

/* ------------------------------------------------------- generation loop */
function gaCfg() {
    return {
        grace: CFG.grace, mutRate: CFG.mutRate, mutSigma: CFG.mutSigma,
        annealFit: CFG.annealFit, annealFloor: CFG.annealFloor, shakeAfter: CFG.shakeAfter,
        immZeroFit: CFG.immZeroFit, childZeroFit: CFG.childZeroFit, reinject: CFG.reinject,
        selfAdapt: CFG.selfAdapt, migrateEvery: CFG.migrateEvery,
        share: CFG.share, shareRadius: CFG.shareRadius,
    };
}
/* One seed per (generation, trial). New pieces every generation: re-using a
 * sequence lets the population memorise it and look far better than it is. */
function seedFor(gen, t) { return gen * 977 + t * 31 + 1; }

function startTrial() {
    pop = new Population(evolution.brains, {
        seed: seedFor(evolution.gen, trial), cfg: GAME_CFG, pieceCap: CFG.pieceCap,
    });
}

function finishTrial() {
    const res = pop.results();
    if (!trialScores) {
        trialScores = res.map(() => ({
            sum: 0, worst: Infinity, lines: 0, pieces: 0, sig: new Float32Array(SIG_SIZE),
        }));
    }
    const sigBuf = new Float32Array(SIG_SIZE);
    res.forEach((r, i) => {
        const t = trialScores[i];
        t.sum += r.fitness; t.lines += r.lines; t.pieces += r.pieces;
        if (r.fitness < t.worst) t.worst = r.fitness;
        pop.agents[i].signature(sigBuf);
        for (let k = 0; k < SIG_SIZE; k++) t.sig[k] += sigBuf[k] / CFG.trials;
    });
    trial++;
    if (trial < CFG.trials) { startTrial(); return; }

    const n = CFG.trials;
    const results = evolution.brains.map((b, i) => {
        const t = trialScores[i], mean = t.sum / n;
        // 60% mean, 40% worst game — a brain that only works on a friendly bag
        // is not a brain that works
        return {
            brain: b, fitness: 0.6 * mean + 0.4 * t.worst,
            lines: t.lines / n, pieces: t.pieces / n, sig: t.sig,
        };
    });

    const prevChamp = evolution.championFit;
    const r = evolution.evolve(results, gaCfg());
    const now = performance.now();
    if (lastGenTime) genRate = 0.85 * genRate + 0.15 * (1000 / (now - lastGenTime));
    lastGenTime = now;

    const gen = evolution.gen - 1;
    const crown = evolution.championFit > prevChamp;
    log(`gen ${String(gen).padStart(3)}  best ${r.best.toFixed(0).padStart(5)}  ` +
        `mean ${r.avg.toFixed(0).padStart(4)}  lines ${r.bestLines.toFixed(0)}/${r.avgLines.toFixed(1)}  ` +
        `pieces ${r.avgPieces.toFixed(0)}${crown ? "  ★" : ""}`, crown ? "hi" : null);
    if (evolution.graceEvent) log("  " + evolution.graceEvent, "ev");
    if (evolution.eff.shaken) log(`  mutation shaken up — ${evolution.stagnant} flat gens`, "ev");

    trial = 0; trialScores = null;
    startTrial();
    updateSidebar(r);
}

function restart(popSize) {
    evolution = new Evolution(popSize || CFG.pop, (Math.random() * 1e9) | 0, CFG.islands);
    trial = 0; trialScores = null; genRate = 0; lastGenTime = 0;
    showcase = null; human = null;
    mode = "evolve";
    document.getElementById("stat-mode").textContent = "evolving";
    startTrial();
    layoutStage();
    log(`— restarted: ${evolution.popSize} random brains in ${evolution.islands} island` +
        `${evolution.islands === 1 ? "" : "s"}, ${brainContract()} (${weightCount()} weights) —`, "ev");
}

/* Both read the live architecture rather than assuming an MLP — the built-in
 * champion may be a convolutional brain, in which case NET_SIZES is not the
 * whole story. */
function brainContract() { return makeNet(null).contract(); }
function weightCount() { return makeNet(null).paramCount; }

/* --------------------------------------------------------------- modes */
function startShowcase(brain, label) {
    if (!brain) { log("no champion yet — let it evolve a while first", "ev"); return; }
    mode = "showcase";
    showcase = new Agent(brain.clone(), (Math.random() * 1e6) | 0, GAME_CFG);
    showcase.label = label || "champion";
    document.getElementById("stat-mode").textContent = "showcase";
    layoutStage();
}

/* Champion against a brain that never evolved, on the identical piece sequence.
 * The point of the whole project in one screen: same game, same keyboard, same
 * pieces, one of them has been through selection and the other has not. */
function startCompare(brain, label) {
    if (!brain) { log("no champion yet — let it evolve a while first", "ev"); return; }
    mode = "compare";
    compareTally = { games: 0, champLines: 0, champPieces: 0, rivalLines: 0, rivalPieces: 0 };
    newComparePair(brain, label);
    document.getElementById("stat-mode").textContent = "evolved vs untrained";
    layoutStage();
    log("champion vs an untrained brain — same pieces, same keys", "ev");
}
function newComparePair(brain, label) {
    const seed = (Math.random() * 1e6) | 0;
    showcase = new Agent((brain || showcase.brain).clone(), seed, GAME_CFG);
    showcase.label = label || (showcase.label || "evolved champion");
    rival = new Agent(makeNet(mulberry32(seed ^ 0x5bf03635)), seed, GAME_CFG);
}

function startHuman() {
    mode = "play";
    human = new Tetris({ seed: (Math.random() * 1e6) | 0, cfg: HUMAN_CFG });
    humanKeysHeld = [0, 0, 0, 0, 0, 0, 0];
    document.getElementById("stat-mode").textContent = "you are playing";
    layoutStage();
    log("your turn — ← → move · ↑ / Z rotate · ↓ soft drop · space hard drop · C hold", "ev");
}

function backToEvolving() {
    mode = "evolve";
    showcase = null; human = null; rival = null;
    document.getElementById("stat-mode").textContent = "evolving";
    layoutStage();
}

/* The same two calls the brain makes — a human is just another key source. */
window.addEventListener("keydown", e => {
    if (mode !== "play" || !human) return;
    if (KEY_ORDER.indexOf(e.code) >= 0) { e.preventDefault(); human.onKeyDown(e.code); }
});
window.addEventListener("keyup", e => {
    if (mode !== "play" || !human) return;
    if (KEY_ORDER.indexOf(e.code) >= 0) { e.preventDefault(); human.onKeyUp(e.code); }
});

/* ------------------------------------------------------------- stepping */
function stepSim() {
    if (mode === "evolve") {
        pop.step();
        if (pop.done) finishTrial();
    } else if (mode === "showcase") {
        showcase.step(0);
        if (!showcase.alive) {
            log(`showcase: ${showcase.lines} lines, ${showcase.pieces} pieces, ` +
                `score ${showcase.game.score}`, "hi");
            const next = new Agent(showcase.brain, (Math.random() * 1e6) | 0, GAME_CFG);
            next.label = showcase.label;
            showcase = next;
        }
    } else if (mode === "compare") {
        showcase.step(400);
        rival.step(400);
        if (!showcase.alive && !rival.alive) {
            const t = compareTally;
            t.games++;
            t.champLines += showcase.lines; t.champPieces += showcase.pieces;
            t.rivalLines += rival.lines; t.rivalPieces += rival.pieces;
            log(`game ${t.games}: evolved ${showcase.pieces} pieces / ${showcase.lines} lines · ` +
                `untrained ${rival.pieces} / ${rival.lines}`, "hi");
            newComparePair(null);
        }
    } else if (mode === "play") {
        for (let i = 0; i < KEY_ORDER.length; i++) humanKeysHeld[i] = human.down[KEY_ORDER[i]] ? 1 : 0;
        const ev = human.step();
        if (ev.over) {
            log(`you: ${human.lines} lines, ${human.pieces} pieces, score ${human.score}`, "hi");
            human = new Tetris({ seed: (Math.random() * 1e6) | 0, cfg: HUMAN_CFG });
        }
    }
}

/* Turbo: no drawing at all, just generations, in ~12 ms slices so the page
 * still answers clicks. */
function turboSlice() {
    const t0 = performance.now();
    while (performance.now() - t0 < 12) {
        for (let i = 0; i < 8; i++) {
            pop.step();
            if (pop.done) { finishTrial(); break; }
        }
    }
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    set("hl-gen", evolution.gen);
    set("hl-rate", genRate ? genRate.toFixed(2) : "…");
    set("hl-fit", evolution.championFit > -1e17 ? evolution.championFit.toFixed(0) : "–");
    set("hl-lines", evolution.championLines ? evolution.championLines.toFixed(1) : "0");
    set("hl-sigma", evolution.eff.sigma.toFixed(3) + (evolution.eff.shaken ? " ↑" : ""));
}

/* ------------------------------------------------------------- rendering */
const readoutMetrics = { heights: new Int32Array(BW), holes: new Int32Array(BW) };
const ISLAND_COLORS = ["#7c5cff", "#35c8ff", "#4fe0a8", "#ffc94d", "#ff7ba8", "#ff9d3d", "#9be15d", "#5b8cff"];
function islandOf(slot) {
    const b = evolution.bounds;
    for (let k = 0; k < b.length; k++) if (slot >= b[k][0] && slot < b[k][1]) return k;
    return 0;
}

function render() {
    let game = null, agent = null, tag = "";
    if (mode === "play") {
        game = human;
        tag = `you · ${human.lines} lines · score ${human.score}`;
        drawKeyboard(humanKeysHeld, null);
    } else if (mode === "showcase") {
        agent = showcase; game = showcase.game;
        tag = `<b>${showcase.label}</b> · ${showcase.lines} lines · ${showcase.pieces} pieces`;
        drawKeyboard(agent.keys, agent.act);
    } else if (mode === "compare") {
        agent = showcase; game = showcase.game;
        const t = compareTally;
        tag = `<b>evolved</b> · ${showcase.pieces} pieces · ${showcase.lines} lines` +
            (t.games ? ` <span style="color:#7b8fa8">— ${t.games} games avg ` +
                `${(t.champPieces / t.games).toFixed(0)}p / ${(t.champLines / t.games).toFixed(1)}L</span>` : "");
        drawKeyboard(agent.keys, agent.act);
        drawGame(rivalCanvas, rival.game, heroCell, { ghost: CFG.ghost });
        rivalTag.innerHTML = `<b style="color:#7b8fa8">untrained</b> · ${rival.pieces} pieces · ` +
            `${rival.lines} lines` +
            (t.games ? ` <span style="color:#7b8fa8">— avg ${(t.rivalPieces / t.games).toFixed(0)}p / ` +
                `${(t.rivalLines / t.games).toFixed(1)}L</span>` : "");
    } else {
        const ld = pop.leader();
        agent = ld.agent; game = agent.game;
        tag = `<b>brain #${ld.index}</b> · ${pop.aliveCount}/${pop.agents.length} alive` +
            (CFG.trials > 1 ? ` · game ${trial + 1}/${CFG.trials}` : "");
        drawKeyboard(agent.keys, agent.act);
    }

    drawGame(heroCanvas, game, heroCell, { ghost: CFG.ghost });
    heroTag.innerHTML = tag;
    const pc = Math.max(9, Math.round(heroCell * 0.62));
    drawPreview(holdCanvas, game.hold, pc);
    for (let i = 0; i < nextCanvas.length; i++) drawPreview(nextCanvas[i], game.queue[i], pc);

    if (mode !== "evolve" && fleetCells.length) {
        fleetCells = [];
        fleetEl.innerHTML = "";
    }
    if (mode === "evolve" && CFG.fleet && fleetCells.length) {
        const ranked = pop.ranked();
        const leaderIdx = pop.leader().index;
        let k = 0;
        for (const { a, i } of ranked) {
            if (i === leaderIdx) continue;
            if (k >= fleetCells.length) break;
            const fc = fleetCells[k++];
            drawGame(fc.canvas, a.game, fleetCell, { ghost: false, grid: false });
            fc.cell.classList.toggle("dead", !a.alive);
            fc.tag.textContent = a.lines ? a.lines + "L" : "";
            // a coloured edge per island, so the sub-populations are visible
            fc.canvas.style.borderColor = evolution.islands > 1
                ? ISLAND_COLORS[islandOf(i) % ISLAND_COLORS.length] : "";
        }
        for (; k < fleetCells.length; k++) {
            fleetCells[k].canvas.getContext("2d").clearRect(0, 0, 999, 999);
            fleetCells[k].tag.textContent = "";
        }
    }

    // leader / player readout
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    const m = boardMetrics(game.grid, readoutMetrics);
    set("ld-fit", agent ? agent.fitness.toFixed(1) : "–");
    set("ld-lines", agent ? agent.lines : game.lines);
    set("ld-pieces", agent ? agent.pieces : game.pieces);
    set("ld-score", game.score);
    set("ld-holes", m.totalHoles);
    set("ld-height", m.maxH > BH ? BH : m.maxH);
    set("ld-reward", agent ? (agent.lastReward >= 0 ? "+" : "") + agent.lastReward.toFixed(2) : "–");
    set("stat-alive", mode === "evolve" ? `${pop.aliveCount}/${pop.agents.length}` : "–");
}

function updateSidebar(r) {
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    set("stat-gen", evolution.gen);
    set("stat-best", r ? r.best.toFixed(0) : "–");
    set("stat-lines", r ? `${r.bestLines.toFixed(0)}/${r.avgLines.toFixed(1)}` : "–");
    set("stat-sigma", evolution.eff.sigma.toFixed(3) + (evolution.eff.shaken ? " ↑" : ""));
    drawChart(document.getElementById("chart"), evolution.history);
}

/* ------------------------------------------------------------- main loop */
let domClock = 0;
function frame() {
    requestAnimationFrame(frame);
    if (CFG.headless && mode === "evolve") { if (!paused) turboSlice(); return; }
    if (!paused) {
        const per = mode === "play" ? 1 : CFG.speed;
        tickAccum += per;
        let n = Math.min(600, Math.floor(tickAccum));
        tickAccum -= n;
        while (n-- > 0) stepSim();
    }
    render();
    if (performance.now() - domClock > 250) {
        domClock = performance.now();
        document.getElementById("stat-gen").textContent = evolution ? evolution.gen : "–";
    }
}

/* ---------------------------------------------------------------- wiring */
document.getElementById("btn-pause").addEventListener("click", e => {
    paused = !paused;
    e.target.textContent = paused ? "Resume" : "Pause";
    e.target.classList.toggle("primary", !paused);
});
document.getElementById("btn-restart").addEventListener("click", () => restart());
document.getElementById("btn-compare").addEventListener("click", () => {
    if (mode === "compare") backToEvolving();
    else startCompare(evolution.champion || builtInChampion(), "evolved champion");
});
document.getElementById("btn-showcase").addEventListener("click", () => {
    if (mode === "showcase") backToEvolving();
    else startShowcase(evolution.champion, `champion · gen ${evolution.gen}`);
});
document.getElementById("btn-save").addEventListener("click", () => {
    if (!evolution.champion) return log("nothing to save yet", "ev");
    localStorage.setItem("tetris_ne_champion", JSON.stringify({
        fitness: evolution.championFit, gen: evolution.gen, net: evolution.champion.toJSON(),
    }));
    log(`saved champion (fitness ${evolution.championFit.toFixed(0)})`, "ev");
});
document.getElementById("btn-load").addEventListener("click", () => {
    const raw = localStorage.getItem("tetris_ne_champion");
    if (!raw) return log("no saved champion in this browser", "ev");
    adoptBrain(JSON.parse(raw), "saved champion");
});
document.getElementById("btn-export").addEventListener("click", () => {
    if (!evolution.champion) return log("nothing to export yet", "ev");
    const blob = new Blob([JSON.stringify({
        fitness: evolution.championFit, gen: evolution.gen,
        sizes: NET_SIZES, keys: KEY_ORDER, net: evolution.champion.toJSON(),
    }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tetris_brain_gen${evolution.gen}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
});
document.getElementById("btn-import").addEventListener("click", () =>
    document.getElementById("file-import").click());
document.getElementById("file-import").addEventListener("change", e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
        try { adoptBrain(JSON.parse(rd.result), f.name); }
        catch (err) { log("import failed: " + err.message, "ev"); }
    };
    rd.readAsText(f);
    e.target.value = "";
});
document.getElementById("btn-default").addEventListener("click", () => {
    if (window.DEFAULT_BRAIN) adoptBrain(DEFAULT_BRAIN, "built-in champion");
    else log("no built-in champion bundled with this build", "ev");
});
document.getElementById("btn-inject").addEventListener("click", () => {
    if (!window.DEFAULT_BRAIN) return log("no built-in champion bundled with this build", "ev");
    const net = netFromJSON(DEFAULT_BRAIN);
    evolution.brains[0] = net;
    evolution.grace = { net, left: 10 };
    log("built-in champion injected with 10 generations of grace", "ev");
});

function adoptBrain(obj, label) {
    let net;
    try { net = netFromJSON(obj); }
    catch (err) { return log("that file is not a brain this build can read: " + err.message, "ev"); }
    if (net.contract() !== brainContract()) {
        return log(`that brain is ${net.contract()}, this build needs ${brainContract()}`, "ev");
    }
    evolution.champion = net;
    evolution.championFit = obj.fitness || 0;
    startShowcase(net, label);
    log(`loaded ${label}${obj.fitness ? " · fitness " + Math.round(obj.fitness) : ""}`, "hi");
}

/* ------------------------------------------------------------------ boot
 *
 * The built-in champion decides the page's sensor layout and architecture, not
 * the other way round. A set of weights only means anything against the exact
 * input vector it evolved on, so the config that produced the baked brain is
 * applied *before* the first population is built — otherwise "watch the
 * champion" would silently feed it a different encoding, and it would play like
 * a brain that had never been trained at all. */
if (window.DEFAULT_BRAIN && DEFAULT_BRAIN.config && typeof applyConfig === "function") {
    try { applyConfig(DEFAULT_BRAIN.config, R); }
    catch (err) { console.warn("could not apply the built-in brain's config:", err); }
}

buildStage();
restart();
layoutStage();
updateSidebar(null);

const intro = document.getElementById("intro");
const closeIntro = () => intro.classList.add("hidden");
document.getElementById("intro-watch").addEventListener("click", () => {
    closeIntro();
    if (window.DEFAULT_BRAIN) adoptBrain(DEFAULT_BRAIN, "built-in champion");
    else log("no built-in champion in this build — evolving from scratch instead", "ev");
});
document.getElementById("intro-compare").addEventListener("click", () => {
    closeIntro();
    const net = builtInChampion();
    if (net) startCompare(net, "evolved champion");
});

/* The built-in brain, or null with a logged reason. Guarded because a stale
 * default_brain.js from before a contract change would otherwise be loaded and
 * quietly play nonsense. */
function builtInChampion() {
    if (!window.DEFAULT_BRAIN) { log("no built-in champion bundled with this build", "ev"); return null; }
    const net = netFromJSON(DEFAULT_BRAIN);
    if (net.contract() !== brainContract()) {
        log(`built-in brain is ${net.contract()}, this build needs ${brainContract()}`, "ev");
        return null;
    }
    evolution.champion = net;
    evolution.championFit = DEFAULT_BRAIN.fitness || 0;
    return net;
}
document.getElementById("intro-scratch").addEventListener("click", closeIntro);
document.getElementById("intro-play").addEventListener("click", () => { closeIntro(); startHuman(); });
document.getElementById("intro-explore").addEventListener("click", closeIntro);

// #evolve / #watch / #play skip the intro — handy for deep links and screenshots
{
    const h = location.hash.replace("#", "");
    if (h === "evolve") closeIntro();
    else if (h === "play") { closeIntro(); startHuman(); }
    else if (h === "watch") document.getElementById("intro-watch").click();
    else if (h === "compare") document.getElementById("intro-compare").click();

    // ?bench=N runs N ticks synchronously before the first paint. Headless
    // Chrome under --virtual-time-budget barely fires requestAnimationFrame, so
    // a screenshot of a freshly-loaded page catches an empty board; this warms
    // the boards up without needing animation to have run.
    const bench = +(new URLSearchParams(location.search).get("bench") || 0);
    if (bench > 0) {
        for (let i = 0; i < Math.min(bench, 400000); i++) stepSim();
        render();
        updateSidebar(evolution.history.length
            ? evolution.history[evolution.history.length - 1] : null);
    }
}

requestAnimationFrame(frame);
