/* main.js — boot, generation cycle, rendering. */
"use strict";

let mac, evolution, world, renderer, pidCtrl;
let epIdx = 0, epTasks = [], acc = null;
let lastFrame = 0, lastDom = 0, genRate = 0, lastGenT = 0;

const canvas = document.getElementById("view");

/* ------------------------------------------------------- world / generation */
function currentStage() {
    return stageFor(evolution.gen, evolution.history, { stageLock: CFG.stageLock });
}

/* Which (task, difficulty rung) pair each episode of this generation runs.
 *
 * A locked task overrides the curriculum entirely — useful for watching one
 * behaviour, useless for training, because a population trained on one task
 * forgets the others.
 *
 * CFG.level is the difficulty CAP, not the difficulty. `episodePlan` puts
 * episode 0 on the cap and cycles the rest down through every rung including 0,
 * so raising the rung slider adds a harder machine to the mix instead of
 * replacing the one the population already handles. That is the anti-forgetting
 * rule from evolution.js, and it is the reason the slider is safe to drag
 * upward mid-run. */
function planEpisodes() {
    const stage = currentStage();
    const n = Math.max(1, CFG.episodes);
    if (CFG.taskLock >= 0) {
        const id = TASK_DEFS[CFG.taskLock].id;
        return Array.from({ length: n }, (_, e) => ({ tid: id, level: e === 0 ? CFG.level : e % (CFG.level + 1) }));
    }
    // typeof-guarded: planEpisodes() runs once during boot, before `evolution`
    // has been assigned, and a bare reference would hit the temporal dead zone.
    const g = typeof evolution !== "undefined" && evolution ? evolution.gen : 0;
    return episodePlan(stage, n, g, CFG.level);
}

function newWorld() {
    if (CFG.exhibition) {
        // ONE plasma, plus the baseline. The twenty-four plasmas of a training
        // run are twenty-four different brains being ranked against each other —
        // an artefact of the search, not of the physics. There is exactly one
        // brain worth showing here, and the only other thing on screen that
        // earns its place is the controller it has to beat.
        //
        // Fixed seeds, high enough that no training run ever drew them, so the
        // exhibition is reproducible and both controllers meet the identical
        // shot every time.
        world = new World(mac, [exhibit.brain], {
            taskId: EXHIBIT_TASKS[exhibit.taskIdx],
            missionSeed: 900001 + exhibit.taskIdx * 37 + exhibit.lap * 911,
            noise: true, randomise: true, level: CFG.level,
            withPid: true, pidController: pidCtrl
        });
        // Trails belong to an episode, not to the session.
        if (renderer) renderer.clearTrails();
        return;
    }
    // The draw of task perturbation and machine randomisation is held for a
    // block of two generations, so selection sees the brain rather than the
    // luck of which machine it happened to be handed.
    const block = Math.floor((evolution.gen - 1) / 2);
    const ep = epTasks[epIdx];
    world = new World(mac, evolution.brains, {
        taskId: ep.tid,
        level: ep.level,
        missionSeed: block * 17 + epIdx,
        noise: CFG.noise,
        randomise: CFG.randomise,
        withPid: CFG.comparePid,
        pidController: pidCtrl
    });
}

/* ------------------------------------------------------------- exhibition */
/* The demonstration mode. No evolution, no population, no knobs — one trained
 * controller and one hand-tuned one running the whole task registry side by
 * side, and a scoreboard. */
const EXHIBIT_TASKS = TASK_DEFS.map(d => d.id);   // includes the 1.2 s discharge
const exhibit = {
    brain: null, taskIdx: 0, lap: 0, rows: [], active: false,
    /* Rolling history for the head-to-head chart. Sampled by CONTROL STEPS, not
     * by rendered frames: the speed buttons change how many steps happen per
     * frame by a factor of forty, and a frame-sampled series would silently
     * change what "over time" means every time someone pressed one. */
    trace: [],            // {err, dead} × 2, plus a task-boundary flag
    traceClock: 0
};
const TRACE_EVERY = 40;   // control steps per sample — 4 ms of plasma time
const TRACE_MAX = 620;    // ≈ 2.5 s of plasma time, a little over one full lap

function exhibitReset() {
    exhibit.taskIdx = 0;
    exhibit.lap = 0;
    exhibit.trace = [];
    exhibit.traceClock = 0;
    exhibit.rows = EXHIBIT_TASKS.map(id => ({
        id, label: TASK_DEFS.find(d => d.id === id).label, learn: null, pid: null
    }));
}

/* One sample of both controllers' shape error. `boundary` marks the first
 * sample of a new task so the chart can rule a line there. */
function exhibitSample(boundary) {
    const u = world.units[0], p = world.pid;
    if (!u || !p) return;
    exhibit.trace.push({
        a: u.tok.boundaryError(), aDead: u.tok.dead,
        b: p.tok.boundaryError(), bDead: p.tok.dead,
        boundary: !!boundary
    });
    if (exhibit.trace.length > TRACE_MAX) exhibit.trace.splice(0, exhibit.trace.length - TRACE_MAX);
}

function enterExhibition(net) {
    if (!net) return false;
    exhibit.brain = net;
    exhibit.active = true;
    CFG.exhibition = true;
    CFG.paused = false;
    CFG.headless = false;
    CFG.comparePid = true;
    CFG.focusPid = false;
    CFG.showGhosts = false;          // there is nothing left to be a ghost of
    document.body.classList.add("exhibit");
    exhibitReset();
    newWorld();
    if (UI.syncExhibit) UI.syncExhibit();
    return true;
}

function exitExhibition() {
    exhibit.active = false;
    CFG.exhibition = false;
    CFG.showGhosts = true;
    document.body.classList.remove("exhibit");
    rebuild(false);
    if (UI.syncExhibit) UI.syncExhibit();
    uiLog(`<span class="evt">back in the lab — the champion is seeded into the pool</span>`);
}

/* One task finished: record both controllers and move to the next. */
function exhibitEndEpisode() {
    const r = world.results()[0], p = world.pidResult();
    const row = exhibit.rows[exhibit.taskIdx];
    row.learn = { err: r.boundaryErr, surv: r.survival, dead: r.disrupted, fit: r.fitness };
    row.pid = { err: p.boundaryErr, surv: p.survival, dead: p.disrupted, fit: p.fitness };
    exhibit.taskIdx++;
    if (exhibit.taskIdx >= EXHIBIT_TASKS.length) {
        // Loop forever, but keep the completed board on screen: a display that
        // blanks itself every ninety seconds is useless to walk past.
        exhibit.taskIdx = 0;
        exhibit.lap++;
    }
    newWorld();
    exhibitSample(true);          // rule a divider at the task change
}

function endEpisode() {
    if (CFG.exhibition) { exhibitEndEpisode(); return; }
    const stage = currentStage();
    const so = stageOpts(stage);
    if (!acc) acc = world.units.map(() => ({ fitness: 0, survival: 0, boundaryErr: 0 }));
    const res = world.results();
    for (let i = 0; i < res.length; i++) {
        acc[i].fitness += normalizeFitness(res[i].fitness, so.scale) / epTasks.length;
        acc[i].survival += res[i].survival / epTasks.length;
        acc[i].boundaryErr += res[i].boundaryErr / epTasks.length;
    }
    if (CFG.comparePid) {
        const p = world.pidResult();
        lastPid = p;
        pidHist.push(p);
        if (pidHist.length > 40) pidHist.shift();
    }

    epIdx++;
    if (epIdx < epTasks.length) { newWorld(); return; }

    const results = evolution.brains.map((brain, i) => ({
        brain, fitness: acc[i].fitness, survival: acc[i].survival, boundaryErr: acc[i].boundaryErr
    }));
    // Better half only — see the same computation in train.js and the promotion
    // comment in evolution.js.
    const bySurv = acc.map(a => ({ s: a.survival, f: a.fitness })).sort((x, y) => y.f - x.f);
    const halfN = Math.max(1, bySurv.length >> 1);
    const newSurv = bySurv.slice(0, halfN).reduce((t, a) => t + a.s, 0) / halfN;
    epIdx = 0; acc = null;

    const rec = evolution.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.gracePeriod,
        { immZeroFit: CFG.immZeroFit, childZeroFit: CFG.childZeroFit },
        { stage, newSurv });
    if (CFG.evalMode && evolution.champion) {
        evolution.brains[evolution.brains.length - 1] = evolution.champion.clone();
    }

    const now = performance.now();
    if (lastGenT) {
        const inst = 1000 / Math.max(1, now - lastGenT);
        genRate = genRate ? genRate * 0.7 + inst * 0.3 : inst;
    }
    lastGenT = now;

    uiLog(`<span class="gen">gen ${evolution.gen - 1}</span> best ${rec.best.toFixed(2)} · ` +
        `mean ${rec.avg.toFixed(2)} · survived ${(rec.avgSurv * 100).toFixed(0)}% · ` +
        `boundary ${(rec.avgErr * 100).toFixed(1)} cm · ${stageOpts(stage).label}`);
    if (evolution.graceEvent) uiLog(`<span class="evt">${evolution.graceEvent}</span>`);
    drawChart(evolution.history);
    drawChart2(evolution.history);

    epTasks = planEpisodes();
    newWorld();
}

function rebuild(fullRestart) {
    if (!mac) {
        mac = getMachine();
        renderer = new Renderer(canvas, mac);
        uiLog(`<span class="evt">machine built in ${mac.buildMs.toFixed(0)} ms — ` +
            `${mac.nc} circuits, ${mac.nv} vessel loops, ${N_FLUX} flux loops, ${N_PROBE} probes</span>`);
    }
    if (fullRestart || !evolution) {
        refreshNetSizes();
        evolution = new Evolution(CFG.popSize, (Math.random() * 1e9) | 0, NET_SIZES);
        pidCtrl = new PIDController(mac);
        pidHist.length = 0; lastPid = null;
        drawChart(evolution.history);
        drawChart2(evolution.history);
        const el = document.getElementById("brain-shape");
        if (el) el.textContent = `${modeSpec().label} · network ${NET_SIZES.join(" × ")}`;
    }
    epIdx = 0; acc = null;
    epTasks = planEpisodes();
    newWorld();
}

/* --------------------------------------------------------------- brain I/O */
let pidHist = [], lastPid = null;

function championJSON() {
    const leader = world.units[world.leaderIdx];
    const net = evolution.champion || leader.brain;
    return JSON.stringify({
        format: "tokamak-brain-v1",
        mode: modeSpec().act === 19 ? "full" : "trim",
        sizes: NET_SIZES, gen: evolution.gen,
        net: net.toJSON()
    });
}

const brainIO = {
    save() {
        localStorage.setItem("tokamak_champion", championJSON());
        uiLog(`<span class="evt">champion saved to browser storage</span>`);
    },
    load() {
        const s = localStorage.getItem("tokamak_champion");
        if (!s) { uiLog("no saved champion found"); return; }
        brainIO.importJSON(s);
    },
    exportFile() {
        const blob = new Blob([championJSON()], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `tokamak_brain_gen${evolution.gen}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    },
    importJSON(text, label) {
        try {
            const o = JSON.parse(text);
            const src = o.net || o;
            if (JSON.stringify(src.sizes) !== JSON.stringify(NET_SIZES)) {
                uiLog(`import failed: brain is ${src.sizes ? src.sizes.join("×") : "unknown"}, ` +
                    `this interface expects ${NET_SIZES.join("×")} — switch the interface mode first`);
                return;
            }
            const net = Net.fromJSON(src);
            evolution.brains[evolution.brains.length - 1] = net;
            evolution.champion = net.clone();
            uiLog(`<span class="evt">${label || "brain imported"} — seeded into the population</span>`);
        } catch (e) {
            uiLog(`import failed: ${e.message}`);
        }
    },
    loadDefault() {
        if (!window.DEFAULT_BRAIN) { uiLog("no built-in champion bundled yet"); return; }
        brainIO.importJSON(JSON.stringify(window.DEFAULT_BRAIN), "built-in champion loaded");
    },
    /* EXHIBITION. Not a training session: one champion, the PID baseline flying
     * the identical shot, and a scoreboard.
     *
     * The first version of this filled all twenty-four population slots with the
     * champion instead, which was misleading in a way worth spelling out. The
     * fleet is a search artefact — twenty-four different brains being ranked —
     * so a "showcase" that fills it and then lets the run continue shows you
     * twenty-four MUTATED copies from the next generation onward, most of them
     * worse than the champion and some of them dying on screen. Watching the
     * best controller should not mean watching its worst children. */
    showcase() {
        if (!window.DEFAULT_BRAIN) { uiLog("no built-in champion bundled yet — evolve one"); return; }
        const src = window.DEFAULT_BRAIN.net || window.DEFAULT_BRAIN;
        if (window.DEFAULT_BRAIN.mode && OBS_MODE_CURRENT() !== window.DEFAULT_BRAIN.mode) {
            setObsMode(window.DEFAULT_BRAIN.mode);
            refreshNetSizes();
            rebuild(true);
        }
        if (JSON.stringify(src.sizes) !== JSON.stringify(NET_SIZES)) {
            uiLog(`showcase failed: brain is ${src.sizes ? src.sizes.join("×") : "unknown"}, ` +
                `this interface expects ${NET_SIZES.join("×")}`);
            return;
        }
        const net = Net.fromJSON(src);
        evolution.champion = net.clone();
        enterExhibition(net);
        uiLog(`<span class="evt">exhibition — the built-in champion against the PID, ` +
            `same shot, ${EXHIBIT_TASKS.length} tasks</span>`);
    },
    /* Leave the exhibition if we are in it, otherwise do nothing. Called by the
     * menu choices that are not the exhibition. */
    leaveExhibition() { if (CFG.exhibition) exitExhibition(); },
    /* Watch the conventional controller instead. Same task, same seeds, same
     * noise: this is the number the learned one has to beat. */
    pidOnly() {
        CFG.comparePid = true;
        const box = document.getElementById("chk-pid");
        if (box) box.checked = true;
        CFG.focusPid = true;
        uiLog(`<span class="evt">watching the hand-tuned PID baseline — blue outline is the learned fleet</span>`);
    },
    injectBest() {
        if (!window.DEFAULT_BRAIN) { uiLog("no built-in champion bundled yet"); return; }
        const src = window.DEFAULT_BRAIN.net || window.DEFAULT_BRAIN;
        if (JSON.stringify(src.sizes) !== JSON.stringify(NET_SIZES)) {
            uiLog(`inject failed: brain is ${src.sizes ? src.sizes.join("×") : "unknown"}`);
            return;
        }
        const net = Net.fromJSON(src);
        evolution.brains[evolution.brains.length - 1] = net;
        evolution.champion = net.clone();
        const g = Math.max(10, CFG.gracePeriod | 0);
        CFG.gracePeriod = g;
        evolution.grace = { net, left: g + 1 };
        if (UI.setGrace) UI.setGrace(g);
        uiLog(`<span class="evt">champion injected — sheltered ${g} generations</span>`);
    }
};

/* -------------------------------------------------------------- rendering */
function renderHeadless() {
    const ctx = renderer.ctx, cw = renderer.cw, ch = renderer.ch;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#070e18";
    ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff9f5a";
    ctx.font = "600 20px 'Segoe UI', sans-serif";
    ctx.fillText("⚡ Headless training", cw / 2, ch / 2 - 40);
    ctx.fillStyle = "#9fc4e8";
    ctx.font = "14px 'Segoe UI', sans-serif";
    ctx.fillText("visuals off — every millisecond goes to the evolution", cw / 2, ch / 2 - 12);
    const h = evolution.history;
    const best = h.length ? h[h.length - 1].best.toFixed(2) : "–";
    ctx.fillStyle = "#e7eef7";
    ctx.font = "600 15px 'Segoe UI', sans-serif";
    ctx.fillText(`generation ${evolution.gen}   ·   best ${best}`, cw / 2, ch / 2 + 24);
    ctx.fillStyle = "#7d93ab";
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillText(genRate ? `${genRate.toFixed(2)} generations / sec` : "measuring…", cw / 2, ch / 2 + 48);
}

function focusUnit() {
    if (CFG.focusPid && world.pid) return world.pid.tok;
    return world.units[world.leaderIdx].tok;
}

/* ------------------------------------------------------------- DOM stats */
function fmt(v, d, unit) { return (v == null || !Number.isFinite(v)) ? "—" : v.toFixed(d) + (unit || ""); }

/* The exhibition scoreboard. Lower boundary error wins a task; a controller
 * that disrupted loses it outright however good its shape was while it lived,
 * because a disruption is not a bad score, it is the end of the discharge. */
function updateScoreboard() {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const cm = (v) => (v * 100).toFixed(2);
    const winner = (row) => {
        if (!row.learn || !row.pid) return null;
        if (row.learn.dead !== row.pid.dead) return row.learn.dead ? "pid" : "learn";
        return row.learn.err <= row.pid.err ? "learn" : "pid";
    };
    const cell = (side, r, w) => {
        if (!r) return `<td class="dim">—</td>`;
        const cls = r.dead ? "dead" : (w === side ? side : "dim");
        const txt = r.dead ? `${(r.surv * 100).toFixed(0)}% ✕` : `${cm(r.err)}`;
        return `<td class="${cls}">${txt}</td>`;
    };
    let html = "<tr><th>task</th><th>network</th><th>classic</th></tr>";
    exhibit.rows.forEach((row, i) => {
        const w = winner(row);
        const running = i === exhibit.taskIdx;
        html += `<tr class="${running ? "running" : ""}">` +
            `<td>${running ? "▸ " : ""}${row.label}</td>` +
            cell("learn", row.learn, w) + cell("pid", row.pid, w) + `</tr>`;
    });
    const tbl = document.getElementById("score-table");
    if (tbl) tbl.innerHTML = html;

    const done = exhibit.rows.filter(r => r.learn && r.pid);
    if (done.length) {
        const wins = done.map(winner);
        set("sc-won", `${wins.filter(w => w === "learn").length} · ${wins.filter(w => w === "pid").length}`);
        const mean = (f) => cm(done.reduce((a, r) => a + f(r), 0) / done.length);
        set("sc-err", `${mean(r => r.learn.err)} · ${mean(r => r.pid.err)} cm`);
        set("sc-dis", `${done.filter(r => r.learn.dead).length} · ${done.filter(r => r.pid.dead).length}`
            + ` of ${done.length}`);
    } else {
        set("sc-won", "— · —"); set("sc-err", "— · —"); set("sc-dis", "— · —");
    }
    /* One sentence saying who is winning and by what. A table of sixteen
     * numbers is evidence; a display also needs to state the conclusion. */
    const vd = document.getElementById("score-verdict");
    if (vd) {
        if (done.length < 2) {
            vd.textContent = "…measuring";
            vd.className = "verdict";
        } else {
            const wins = done.map(winner);
            const lw = wins.filter(w => w === "learn").length, pw = wins.filter(w => w === "pid").length;
            const le = done.reduce((a, r) => a + r.learn.err, 0) / done.length;
            const pe = done.reduce((a, r) => a + r.pid.err, 0) / done.length;
            const ld = done.filter(r => r.learn.dead).length, pd = done.filter(r => r.pid.dead).length;
            const ahead = lw > pw || (lw === pw && le < pe);
            let s = `The network is ${ahead ? "ahead" : "behind"}: it won ${lw} of the ` +
                `${done.length} task${done.length === 1 ? "" : "s"} so far, and missed the ` +
                `wanted shape by ${(le * 100).toFixed(1)} cm on average against ` +
                `${(pe * 100).toFixed(1)} cm`;
            if (pd !== ld) s += `. The ${pd > ld ? "classic controller" : "network"} lost ` +
                `${Math.max(pd, ld)} plasma${Math.max(pd, ld) === 1 ? "" : "s"} completely`;
            vd.textContent = s + ".";
            vd.className = "verdict " + (ahead ? "good" : "bad");
        }
    }
    set("score-note", exhibit.lap > 0
        ? `Round ${exhibit.lap + 1}. The board shows the last complete run through all ` +
          `${EXHIBIT_TASKS.length} tasks. Machine setting: ${difficultyOf(CFG.level).label}.`
        : `Working through all ${EXHIBIT_TASKS.length} tasks once. The last one runs a whole ` +
          `1.2-second shot from start to finish, and it is the hardest.`);

    /* The trend chart, and the one number it exists to produce: over the whole
     * visible window, what fraction of the time has the network been closer to
     * the requested shape than the baseline. A sample where a controller is
     * dead counts against it — being on the wall is not a shape error, it is a
     * lost plasma, and it should not be able to win a tie. */
    const cvs = document.getElementById("vschart");
    if (cvs) drawVsChart(cvs, exhibit.trace);
    /* Measured over samples where BOTH plasmas are alive. Once one is lost there
     * is no shape comparison left to make — the reported error is the frozen
     * outline of something already on the wall, and counting it would let a
     * single early disruption decide a statistic that is supposed to describe
     * the whole window. Lost plasmas are counted on the scoreboard, which is
     * where they belong. */
    const tr = exhibit.trace;
    const live = tr.filter(s => !s.aDead && !s.bDead);
    if (live.length > 4) {
        const aWin = live.reduce((c, s) => c + (s.a <= s.b ? 1 : 0), 0);
        const pct = Math.round(100 * aWin / live.length);
        const fill = document.getElementById("lead-fill");
        if (fill) fill.style.width = pct + "%";
        const meanA = live.reduce((x, s) => x + s.a, 0) / live.length;
        const meanB = live.reduce((x, s) => x + s.b, 0) / live.length;
        const lostA = tr.some(s => s.aDead), lostB = tr.some(s => s.bDead);
        const lt2 = document.getElementById("lead-text");
        if (lt2) {
            let txt = `<b>Mikkel's AI</b> holds the shape closer <b>${pct}%</b> of the ` +
                `time, and is off by ${(meanA * 100).toFixed(1)} cm on average against ` +
                `<i>${(meanB * 100).toFixed(1)} cm</i> for the <i>generic PID</i>.`;
            if (lostA !== lostB) {
                txt += lostB
                    ? ` The <i>generic PID</i> lost a plasma in this window; the AI did not.`
                    : ` <b>The AI lost a plasma in this window</b>; the PID did not.`;
            } else if (lostA && lostB) {
                txt += ` Both lost a plasma in this window.`;
            }
            lt2.innerHTML = txt;
        }
    }

    // live head-to-head in the top bar
    const lt = world.units[0].tok, pt = world.pid ? world.pid.tok : null;
    const le = lt.dead ? null : lt.boundaryError(), pe = pt && !pt.dead ? pt.boundaryError() : null;
    set("vs-learn", lt.dead ? "disrupted" : `${cm(le)} cm`);
    set("vs-pid", !pt ? "—" : pt.dead ? "disrupted" : `${cm(pe)} cm`);
    const v = document.getElementById("vs-verdict");
    if (v) {
        let label = world.task.label, cls = "";
        if (lt.dead !== (pt && pt.dead)) {
            label = lt.dead ? "classic ahead" : "network ahead";
            cls = lt.dead ? "lose" : "win";
        }
        else if (le != null && pe != null) {
            const d = pe - le;
            if (Math.abs(d) > 0.002) { label = `${(Math.abs(d) * 100).toFixed(1)} cm ${d > 0 ? "better" : "worse"}`; cls = d > 0 ? "win" : "lose"; }
        }
        v.textContent = label;
        v.className = "vs-mid " + cls;
    }
}

function updateDom() {
    const tok = focusUnit();
    const tg = tok.target || world.task.targetAt(tok.t);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

    set("stat-gen", evolution.gen);
    set("stat-stage", stageOpts(currentStage()).label);
    const h = evolution.history;
    set("stat-best", h.length ? h[h.length - 1].best.toFixed(2) : "—");
    set("stat-surv", h.length ? (h[h.length - 1].avgSurv * 100).toFixed(0) + "%" : "—");
    set("stat-task", world.task.label);
    set("stat-alive", `${world.units.filter(u => !u.tok.dead).length}/${world.units.length}`);

    set("ep-time", `${(tok.t * 1e3).toFixed(1)} / ${(world.duration * 1e3).toFixed(0)} ms`);
    set("ep-state", tok.dead ? tok.deadReason
        : (CFG.focusPid ? "classic controller" : "neural network"));
    set("ep-R", `${fmt(tok.pR, 3)} m  (→ ${fmt(tg.R, 2)})`);
    set("ep-Z", `${fmt(tok.pZ * 1e3, 1)} mm  (→ ${fmt(tg.Z * 1e3, 0)})`);
    set("ep-Ip", `${fmt(tok.Ip / 1e3, 1)} kA  (→ ${fmt(tg.Ip / 1e3, 0)})`);
    set("ep-kappa", `${fmt(tok.kappa, 2)}  (→ ${fmt(tg.kappa, 2)})`);
    set("ep-delta", `${fmt(tok.delta, 2)}  (→ ${fmt(tg.delta, 2)})`);
    set("ep-err", `${fmt(tok.boundaryError() * 100, 2)} cm`);
    set("ep-n", fmt(tok.nIndex, 2));
    set("ep-vloop", `${fmt(tok.vLoop, 2)} V`);
    set("ep-fast", `${fmt(tok.I[18], 0)} A`);
    set("ep-a", `${fmt(tok.a * 100, 1)} cm`);

    const lp = document.getElementById("ep-limit");
    if (lp) {
        lp.textContent = tok.limitPressure > 0.001 ? `${(tok.limitPressure * 100).toFixed(0)}%` : "clear";
        lp.style.color = tok.limitPressure > 0.05 ? "var(--danger)" : "";
    }

    if (lastPid) {
        set("pid-err", `${(lastPid.boundaryErr * 100).toFixed(2)} cm`);
        set("pid-state", lastPid.disrupted ? lastPid.reason : "held");
        set("pid-fit", lastPid.fitness.toFixed(1));
        const dr = pidHist.filter(p => p.disrupted).length / Math.max(1, pidHist.length);
        set("pid-disrupt", `${(dr * 100).toFixed(0)}% of last ${pidHist.length}`);
    }
    const bh = evolution.history;
    if (bh.length) {
        set("learn-err", `${(bh[bh.length - 1].bestErr * 100).toFixed(2)} cm`);
        set("learn-disrupt", `${(100 * (1 - bh[bh.length - 1].avgSurv)).toFixed(0)}% mean loss`);
    }

    const cb = document.getElementById("coilbars");
    if (cb && !CFG.headless) drawCoilBars(cb, tok, mac);

    const hud = document.getElementById("hud");
    if (hud) {
        hud.innerHTML = CFG.exhibition
            ? `<b>${world.task.label}</b> &nbsp;·&nbsp; ${(tok.t * 1e3).toFixed(1)} / ` +
              `${(world.duration * 1e3).toFixed(0)} ms &nbsp;·&nbsp; ` +
              `task ${exhibit.taskIdx + 1}/${EXHIBIT_TASKS.length} &nbsp;·&nbsp; ` +
              `<span style="color:#ff9f5a">— network</span> ` +
              `<span style="color:#7ab4ff">— classic</span> ` +
              `<span style="color:#4fe0a8">— wanted shape</span>`
            : `${world.task.label} &nbsp;·&nbsp; ${(tok.t * 1e3).toFixed(1)} ms &nbsp;·&nbsp; ` +
              `episode ${epIdx + 1}/${epTasks.length} &nbsp;·&nbsp; ` +
              `<span style="color:#4fe0a8">— target</span> ` +
              (CFG.comparePid ? `&nbsp; <span style="color:#7ab4ff">— PID baseline</span>` : "");
    }
    if (CFG.exhibition) updateScoreboard();
}

/* ------------------------------------------------------------- main loop */
/* ONE control step, plus the exhibition's step-clock. Every caller goes through
 * here — the animation loop, the MAX-speed loop and the `?bench=` warm-up the
 * screenshot harness uses. The first version left the warm-up calling
 * world.step() directly, so it advanced the physics without ever sampling the
 * chart, and every headless screenshot showed an empty graph that was perfectly
 * fine in a real browser. A warm-up path that does not do what the real path
 * does is not a warm-up, it is a second implementation. */
function stepOnce() {
    world.step();
    if (CFG.exhibition && ++exhibit.traceClock >= TRACE_EVERY) {
        exhibit.traceClock = 0;
        exhibitSample(false);
    }
}

function frame(now) {
    requestAnimationFrame(frame);
    lastFrame = now;

    if (!CFG.paused) {
        if (CFG.headless || CFG.speed === 0) {
            const budget = CFG.headless ? 30 : 20;
            const t0 = performance.now();
            while (performance.now() - t0 < budget) {
                stepOnce();
                if (world.isOver()) endEpisode();
            }
        } else {
            let steps = CFG.speed;
            while (steps-- > 0) {
                stepOnce();
                if (world.isOver()) { endEpisode(); break; }
            }
        }
    }

    if (CFG.headless) renderHeadless();
    else {
        renderer.frame(focusUnit(), world.task, CFG, world.units, world.leaderIdx,
            CFG.comparePid && world.pid && !CFG.focusPid ? world.pid.tok : null);
    }
    if (now - lastDom > 150) { lastDom = now; updateDom(); }
}

/* ----------------------------------------------------------------- boot */
initUI(
    () => {
        // Restarting the search always means leaving the exhibition.
        if (CFG.exhibition) { CFG.exhibition = false; exhibit.active = false; document.body.classList.remove("exhibit"); }
        rebuild(true); renderer.resize(); uiLog("evolution restarted");
    },
    () => { epIdx = 0; acc = null; epTasks = planEpisodes(); newWorld(); },
    brainIO
);
/* Changing the difficulty rung mid-exhibition restarts the board: a scoreboard
 * whose rows were measured on different machines is not a scoreboard. */
UI.restartExhibit = () => {
    if (!CFG.exhibition) return;
    exhibitReset();
    newWorld();
};
UI.syncExhibit = () => {
    const p = document.getElementById("btn-pause");
    if (p) p.textContent = CFG.paused ? "Resume" : "Pause";
};
rebuild(true);
renderer.resize();
window.addEventListener("resize", () => renderer.resize());
/* A window resize is not the only way the canvas changes size. Showing or
 * hiding a panel, or the top bar reflowing, resizes the wrapper without any
 * window event at all — and the canvas then keeps its old backing-store size
 * and renders stretched until something else happens to fire. Watch the element
 * itself. */
if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => renderer.resize()).observe(canvas.parentElement);
}
uiLog(`<span class="evt">${CFG.popSize} plasmas · ${modeSpec().label} · ` +
    `10 kHz control, ${(SUBSTEPS * CTRL_HZ / 1000)} kHz physics</span>`);
if (window.DEFAULT_BRAIN) brainIO.loadDefault();
// ?showcase=1 fills the whole fleet with the built-in champion at load, which is
// what the intro modal's first button does. The headless screenshot harness
// cannot click, and seeding one champion into a pool of random brains means the
// leader on screen is usually not the champion.
// ?level=N picks a difficulty rung before the exhibition starts, so a link can
// point straight at the machine that makes the comparison worth looking at.
const _lvl = parseInt(new URLSearchParams(location.search).get("level"), 10);
if (_lvl >= 0 && _lvl < N_LEVELS) {
    CFG.level = _lvl;
    const dg = document.getElementById("diff-group");
    if (dg) [...dg.children].forEach((c, i) => c.classList.toggle("on", i === _lvl));
}
if (new URLSearchParams(location.search).get("showcase") === "1") brainIO.showcase();

// ?bench=N runs N control steps synchronously at load — the headless-screenshot
// warm-up hook, because rAF barely fires under Chrome's virtual time.
const _bench = parseInt(new URLSearchParams(location.search).get("bench"), 10);
if (_bench > 0) {
    for (let i = 0; i < _bench; i++) {
        stepOnce();
        if (world.isOver()) endEpisode();
    }
}
requestAnimationFrame(frame);
