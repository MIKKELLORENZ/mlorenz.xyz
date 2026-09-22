/* main.js — boot, generation cycle, rendering, the three modes.
 *
 *   lab        a population of brains being ranked on the same batch, the
 *              protocol running alongside; what "evolve from scratch" shows
 *   exhibit    one trained brain against the protocol, batch after batch,
 *              with a live head-to-head on product concentration
 *   sop        the published protocols on their own, with the do-nothing
 *              reactor dashed beside them as the cautionary tale
 *
 * EVERY BATCH IS A FRESH DRAW. Which of the five products was ordered, which
 * cell line it has to be made from, how many cells actually went in, which
 * reagent lots arrived and what breaks on the way are all redrawn — there is
 * no list of demo scenarios. The one button that matters says "new batch",
 * and it rolls all of it at once, because that is the situation the controller
 * was bred for and a page that only ever showed one protocol would be
 * advertising a different simulator.
 */
"use strict";

let evolution = null, world = null, renderer = null;
let mode = "lab";
let epIdx = 0, plan = [], acc = null;
let lastDom = 0, lastNet = 0, genRate = 0, lastGenT = 0, tickAcc = 0, lastFrame = 0;
let hist = null;
let viewPrev = null, viewCur = null;     // the focus reactor at the last two ticks, for smooth playback
const canvas = document.getElementById("view");

/* ------------------------------------------------------------ histories */
function newHist() {
    return { t: [], N: [], Nv: [], prod: [], glc: [], lac: [], DO: [], pH: [], d: [], core: [], cue: [], medium: [] };
}
function pushHist(h, r, t) {
    h.t.push(t); h.N.push(Array.from(r.N)); h.Nv.push(r.Nv); h.prod.push(r.product);
    h.glc.push(r.glc); h.lac.push(r.lac); h.DO.push(r.DO); h.pH.push(r.pH);
    h.d.push(r.d); h.core.push(r.fCore);
    h.cue.push(Array.from(r.cue)); h.medium.push(r.act.medium);
}

/* Which reactor the vessel and the solid traces show, and which is dashed. */
function focusUnit() { return mode === "sop" ? world.sop : world.units[0]; }
function dashedUnit() { return mode === "sop" ? world.nothing : world.sop; }

/* ------------------------------------------------- a batch is a fresh draw */
const EXHIBIT_BATCHES = 6;
const exhibit = { brain: null, idx: 0, lap: 0, rows: [], draws: [] };
const sopView = { draw: null };

/* A random order: any of the five products, any rung up to the one the page
 * is set to, a seed nobody has trained on. */
function randomBatch() {
    return {
        seed: 200000 + ((Math.random() * 500000) | 0),
        level: Math.min(N_LEVELS - 1, (Math.random() * (CFG.level + 1)) | 0),
        /* CFG.lin pins the product; null means a fresh draw, which is what
         * the controller was bred for. */
        lin: CFG.lin == null ? (Math.random() * N_LIN) | 0 : CFG.lin
    };
}

/* The generation's episode plan, with the product pinned if one was chosen.
 * The plan normally rotates through all five so a network cannot buy one
 * product by forgetting another; pinning is a viewing choice, and the log
 * says so once. */
function currentPlan() {
    const p = episodePlan(CFG.episodes, currentBlock(), CFG.level);
    return CFG.lin == null ? p : p.map(e => Object.assign({}, e, { lin: CFG.lin }));
}

/* ------------------------------------------------------- lab: generations */
function currentBlock() { return Math.floor((evolution.gen - 1) / 2); }

function newWorld() {
    if (mode === "exhibit") {
        const d = exhibit.draws[exhibit.idx] || (exhibit.draws[exhibit.idx] = randomBatch());
        world = new World([exhibit.brain], {
            seed: d.seed, level: d.level, lin: d.lin, withBaselines: true, withNothing: false
        });
    } else if (mode === "sop") {
        if (!sopView.draw) sopView.draw = randomBatch();
        const d = sopView.draw;
        world = new World([], { seed: d.seed, level: d.level, lin: d.lin, withBaselines: true, withNothing: true });
    } else {
        const ep = plan[epIdx];
        world = new World(evolution.brains, {
            seed: ep.seed, level: ep.level, lin: ep.lin, withBaselines: true, withNothing: false
        });
    }
    hist = { learn: newHist(), sop: newHist() };
    viewPrev = viewCur = viewOf(focusUnit().r);
    renderOrderCard();
}

function endEpisode() {
    if (mode === "exhibit") { exhibitEndBatch(); return; }
    if (mode === "sop") { sopView.draw = randomBatch(); newWorld(); return; }
    if (!acc) acc = world.units.map(() => ({ fitness: 0, survival: 0, boundaryErr: 0 }));
    const res = world.results();
    for (let i = 0; i < res.length; i++) {
        acc[i].fitness += normalizeFitness(res[i].advantage) / plan.length;
        acc[i].survival += (res[i].failed ? 0 : 1) / plan.length;
        acc[i].boundaryErr += (1 - res[i].purity) / plan.length;
    }
    epIdx++;
    if (epIdx < plan.length) { newWorld(); return; }

    const results = evolution.brains.map((brain, i) => ({ brain, fitness: acc[i].fitness, survival: acc[i].survival, boundaryErr: acc[i].boundaryErr }));
    epIdx = 0; acc = null;
    const rec = evolution.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.gracePeriod, {}, { stage: CFG.level });
    const now = performance.now();
    if (lastGenT) { const inst = 1000 / Math.max(1, now - lastGenT); genRate = genRate ? genRate * 0.7 + inst * 0.3 : inst; }
    lastGenT = now;
    uiLog(`<span class="gen">gen ${evolution.gen - 1}</span> best ${rec.best.toFixed(3)} · mean ${rec.avg.toFixed(3)} · ` +
        `alive ${(rec.avgSurv * 100).toFixed(0)}%`);
    if (evolution.graceEvent) uiLog(`<span class="evt">${evolution.graceEvent}</span>`);
    drawChart(document.getElementById("chart"), evolution.history);
    plan = currentPlan();
    newWorld();
}

function rebuild(fullRestart) {
    if (!renderer) renderer = new Renderer(canvas);
    if (fullRestart || !evolution) {
        evolution = new Evolution(CFG.popSize, (Math.random() * 1e9) | 0, NET_SIZES);
        drawChart(document.getElementById("chart"), evolution.history);
    }
    epIdx = 0; acc = null;
    plan = currentPlan();
    newWorld();
}

/* ------------------------------------------------------------ exhibition */
function enterExhibition(net) {
    exhibit.brain = net; exhibit.idx = 0; exhibit.lap = 0;
    exhibit.rows = Array.from({ length: EXHIBIT_BATCHES }, () => ({ learn: null, sop: null }));
    exhibit.draws = Array.from({ length: EXHIBIT_BATCHES }, () => randomBatch());
    mode = "exhibit"; CFG.exhibition = true; CFG.paused = false; CFG.headless = false;
    document.body.classList.add("exhibit"); document.body.classList.remove("sopmode");
    newWorld();
    syncPause();
}
function exitExhibition() {
    if (mode !== "exhibit" && mode !== "sop") return;
    mode = "lab"; CFG.exhibition = false;
    document.body.classList.remove("exhibit"); document.body.classList.remove("sopmode");
    rebuild(false);
    syncPause();
}
function exhibitEndBatch() {
    const r = world.results()[0], s = world.sop.result;
    exhibit.rows[exhibit.idx] = { learn: r, sop: s, lin: world.lin, level: world.level };
    exhibit.idx++;
    if (exhibit.idx >= EXHIBIT_BATCHES) {
        // a whole new set of orders rather than the same six again
        exhibit.idx = 0; exhibit.lap++;
        exhibit.draws = Array.from({ length: EXHIBIT_BATCHES }, () => randomBatch());
    }
    newWorld();
}
/* The button: throw this batch away and draw another one. */
function nextBatch() {
    if (mode === "exhibit") {
        exhibit.draws[exhibit.idx] = randomBatch();
        newWorld();
    } else if (mode === "sop") {
        sopView.draw = randomBatch();
        newWorld();
    } else {
        epIdx = 0; acc = null;
        plan = currentPlan();
        newWorld();
    }
}
function syncPause() { const p = document.getElementById("btn-pause"); if (p) p.textContent = CFG.paused ? "Resume" : "Pause"; }

/* --------------------------------------------------------------- brain I/O */
function championJSON() {
    const net = evolution && evolution.champion ? evolution.champion : (world.units[0] ? world.units[0].brain : null);
    return JSON.stringify({ format: "bioreactor-brain-v2", sizes: NET_SIZES, gen: evolution ? evolution.gen : 0, net: net.toJSON() });
}
const brainIO = {
    save() { localStorage.setItem("bioreactor_champion", championJSON()); uiLog(`<span class="evt">champion saved to browser storage</span>`); },
    load() { const s = localStorage.getItem("bioreactor_champion"); if (!s) { uiLog("no saved champion found"); return; } brainIO.importJSON(s); },
    exportFile() {
        const blob = new Blob([championJSON()], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `bioreactor_brain_gen${evolution ? evolution.gen : 0}.json`; a.click();
        URL.revokeObjectURL(a.href);
    },
    importJSON(text, label) {
        try {
            const o = JSON.parse(text);
            const src = o.net || o;
            if (JSON.stringify(src.sizes) !== JSON.stringify(NET_SIZES)) {
                uiLog(`import failed: brain is ${src.sizes ? src.sizes.join("×") : "unknown"}, this page expects ${NET_SIZES.join("×")}`);
                return;
            }
            const net = Net.fromJSON(src);
            if (mode !== "lab") exitExhibition();
            evolution.brains[evolution.brains.length - 1] = net;
            evolution.champion = net.clone();
            uiLog(`<span class="evt">${label || "brain imported"} — seeded into the population</span>`);
        } catch (e) { uiLog(`import failed: ${e.message}`); }
    },
    loadDefault() {
        if (!window.DEFAULT_BRAIN) { uiLog("no built-in champion bundled yet"); return; }
        brainIO.importJSON(JSON.stringify(window.DEFAULT_BRAIN), "built-in champion loaded");
    },
    showcase() {
        if (!window.DEFAULT_BRAIN) { uiLog("no built-in champion bundled yet — evolve one"); return; }
        const src = window.DEFAULT_BRAIN.net || window.DEFAULT_BRAIN;
        if (JSON.stringify(src.sizes) !== JSON.stringify(NET_SIZES)) { uiLog("showcase failed: brain shape mismatch"); return; }
        const net = Net.fromJSON(src);
        if (evolution) evolution.champion = net.clone();
        enterExhibition(net);
        uiLog(`<span class="evt">exhibition — the built-in champion against the protocol, same batches</span>`);
    },
    sopOnly() {
        mode = "sop"; CFG.exhibition = true; CFG.paused = false; CFG.headless = false;
        document.body.classList.add("exhibit"); document.body.classList.add("sopmode");
        sopView.draw = randomBatch();
        newWorld(); syncPause();
        uiLog(`<span class="evt">watching the published protocols — dashed is the reactor nobody touches</span>`);
    },
    leaveExhibition() { exitExhibition(); }
};

/* -------------------------------------------------------------- DOM */
function fmt(v, d, unit) { return (v == null || !Number.isFinite(v)) ? "—" : v.toFixed(d) + (unit || ""); }
function set(id, v, cls) { const e = document.getElementById(id); if (e) { e.textContent = v; if (cls !== undefined) e.className = cls; } }

/* What was ordered, why, and what is in the cupboard for it. */
function renderOrderCard() {
    const scn = world.scn, L = scn.lin;
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    set("ord-name", L.label);
    set("ord-days", `${L.days.toFixed(0)} days · rung ${scn.level} (${scn.label})`);
    const why = document.getElementById("ord-why");
    if (why) why.innerHTML = `Wanted: <b>${L.order}</b>. The protocol for it runs ` +
        `${L.nCue} reagent${L.nCue === 1 ? "" : "s"} through ${L.nStage - 1} stages, and the batch is ` +
        `scored on how many ${L.product} come out, how pure they are, and whether they work ` +
        `(<b>${L.func.label}</b>).`;
    const cues = document.getElementById("ord-cues");
    if (cues) cues.innerHTML = L.cues.map((c, i) =>
        `<span class="cue-chip" id="cue-chip-${i}" title="${c.label}">${c.short} <i>${c.unit || ""}</i></span>`).join("");
    const el = document.getElementById("scn-desc");
    if (el) el.innerHTML = `Batch <b>#${scn.seed}</b>, seeded <b>${scn.seedDensity.toFixed(2)} M/mL</b> ` +
        `on a ${days[scn.startWeekday]} at 09:00. The line: doubling ×${(1 / scn.line.muScale).toFixed(2)}, ` +
        `takes the intended fate ×${scn.line.prop.toFixed(2)}, reagent sensitivity ` +
        `×${(scn.line.cueEC50[0]).toFixed(2)}–${(Math.max(...Array.from(scn.line.cueEC50))).toFixed(2)}. ` +
        `<i>The controller is told none of this.</i>`;
    const ev = document.getElementById("scn-events");
    if (ev) ev.innerHTML = scn.events.length
        ? scn.events.map((e, i) => `<span class="ev-chip" id="ev-${i}">${EVENT_TYPES[e.type].label} · day ${(e.t0 / 24).toFixed(1)}</span>`).join("")
        : `<span class="ev-chip">nothing breaks on this rung</span>`;
}

function updateNotebook(u) {
    const lab = u.lab, on = lab.online || {}, t = world.t, L = world.lin;
    set("nb-DO", fmt(on.DO, 0, " %"));
    const col = on.colour;
    set("nb-pH", on.pH == null ? "—" : `${on.pH.toFixed(2)} · ${col > 0.8 ? "red" : col > 0.55 ? "orange-red" : col > 0.3 ? "orange" : "yellow"}`);
    set("nb-cap", fmt(on.cap, 2, " M/mL eq."));
    const off = (id, key, f) => {
        const v = lab.latest(key), age = lab.age(key, t);
        const e = document.getElementById(id);
        if (!e) return;
        if (v == null) { e.textContent = "not yet sampled"; e.className = "stale"; return; }
        e.textContent = `${f(v)}  (${age} h old)`;
        e.className = age > 30 ? "old" : age > 12 ? "stale" : "";
    };
    off("nb-glc", "glc", v => v.toFixed(1) + " mM");
    off("nb-lac", "lac", v => v.toFixed(1) + " mM");
    off("nb-viable", "viable", v => v.toFixed(2) + " M/mL");
    off("nb-aggD", "aggD", v => v.toFixed(0) + " µm");
    // the product marker and the functional assay are named by the lineage
    set("nb-prod-label", L.stages[L.matureIdx].marker);
    off("nb-prod", "m" + L.matureIdx, v => (v * 100).toFixed(0) + " %");
    set("nb-func-label", L.func.label);
    off("nb-func", "func", v => (v * 100).toFixed(0) + " %");
}

function updateVersus() {
    // live head-to-head, in this product's own units
    const lr = world.units[0].r, sr = world.sop.r, L = world.lin;
    set("vs-learn", `${lr.product.toFixed(2)} M/mL`);
    set("vs-sop", `${sr.product.toFixed(2)} M/mL`);
    const d = lr.product - sr.product;
    const vd = document.getElementById("vs-verdict");
    if (vd) {
        if (lr.failed !== sr.failed) {
            const short = document.body.classList.contains("mob");
            vd.textContent = lr.failed
                ? (short ? "network lost it" : "network lost the culture")
                : (short ? "protocol lost it" : "protocol lost the culture");
            vd.className = "vs-mid " + (lr.failed ? "lose" : "win");
        }
        else if (Math.abs(d) > 0.02) {
            const short = document.body.classList.contains("mob");
            vd.textContent = short
                ? `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(2)} M/mL`
                : `${Math.abs(d).toFixed(2)} M/mL ${d > 0 ? "more" : "fewer"} ${L.product}`;
            vd.className = "vs-mid " + (d > 0 ? "win" : "lose");
        }
        else { vd.textContent = `batch ${exhibit.idx + 1} of ${EXHIBIT_BATCHES} · day ${(world.t / 24).toFixed(1)}`; vd.className = "vs-mid"; }
    }
}

function updateDom() {
    const u = focusUnit();
    if (evolution && mode === "lab") {
        set("stat-gen", evolution.gen);
        const h = evolution.history;
        set("stat-best", h.length ? h[h.length - 1].best.toFixed(3) : "—");
        set("stat-alive", `${world.units.filter(x => !x.r.failed).length}/${world.units.length}`);
    }
    updateNotebook(u);
    // the dosing chips light up with what is in the vessel
    const L = world.lin, r = u.r;
    for (let i = 0; i < L.nCue; i++) {
        const c = document.getElementById("cue-chip-" + i);
        if (!c) continue;
        const spec = L.cues[i], on = r.cue[i] > 0.02 * spec.hi;
        c.classList.toggle("on", on);
        const val = spec.hi >= 20 ? r.cue[i].toFixed(0) : r.cue[i].toFixed(1);
        c.innerHTML = `${spec.short} <i>${on ? val + " " + spec.unit : "off"}</i>`;
    }
    const active = new Set((r.dist.active || []).map(e => world.scn.events.indexOf(e)));
    world.scn.events.forEach((e, i) => { const c = document.getElementById("ev-" + i); if (c) c.classList.toggle("active", active.has(i)); });
    if (mode === "exhibit") updateVersus();
    const hud = document.getElementById("hud");
    if (hud) {
        const ep = mode === "lab" ? `generation ${evolution.gen}, batch ${epIdx + 1} of ${plan.length}`
            : mode === "exhibit" ? `batch ${exhibit.idx + 1} of ${EXHIBIT_BATCHES}` : "the protocol on its own";
        hud.innerHTML = `${ep}<br>${world.lin.label} · rung ${world.level}` +
            (genRate && mode === "lab" ? `<br>${genRate.toFixed(2)} gen/s` : "");
    }
}

/* What is happening in the vessel, in one line — read off the cues and the
 * stage populations rather than off any hidden variable, so it is the same
 * sentence a technician would say, whichever product is being made. */
function phaseOf(r, t) {
    const L = r.lin;
    if (r.failed) return ["Culture lost", r.failReason];
    if (t >= r.hours - 1) return ["Harvest", `scored on how many ${L.product} there are, how pure, and whether they work`];
    if (t < 20) return ["Seeding", "single cells with a ROCK inhibitor are finding each other and forming aggregates"];
    let bi = 0;
    for (let i = 1; i < L.nStage; i++) if (r.N[i] > r.N[bi]) bi = i;
    const on = [];
    for (let i = 0; i < L.nCue; i++) if (r.cue[i] > 0.05 * L.cues[i].hi) on.push(L.cues[i].short);
    const head = bi === L.matureIdx ? `${L.product} maturing`
        : bi === L.immIdx ? `${L.product} appearing`
            : bi === 0 ? "Still pluripotent"
                : `Mostly ${L.stages[bi].label}`;
    let body;
    if (on.length) body = `${on.join(" + ")} in the vessel — the next fate decision is being made now`;
    else if (r.act.medium === 2) body = `no cue: ${L.media[2].label}, ${r.act.perf.toFixed(1)} volumes a day`;
    else body = `no cue on: being fed ${L.media[r.act.medium].key} at ${r.act.perf.toFixed(1)} volumes a day`;
    return [head, body];
}

/* ------------------------------------------------------------- main loop */
function stepOnce() {
    world.step();
    const u = focusUnit(), s = dashedUnit();
    pushHist(hist.learn, u.r, world.t);
    if (s) pushHist(hist.sop, s.r, world.t);
    viewPrev = viewCur; viewCur = viewOf(u.r);
}

function renderHeadless() {
    const ctx = renderer.ctx, cw = renderer.cw, ch = renderer.ch;
    ctx.clearRect(0, 0, cw, ch); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = "center";
    ctx.fillStyle = INK_FAINT; ctx.font = "11px 'Segoe UI', sans-serif";
    ctx.fillText("HEADLESS", cw / 2, ch / 2 - 46);
    ctx.fillStyle = INK; ctx.font = "500 21px Georgia, serif";
    ctx.fillText("Training without drawing", cw / 2, ch / 2 - 18);
    ctx.fillStyle = INK_MUTED; ctx.font = "13px 'Segoe UI', sans-serif";
    ctx.fillText("every millisecond goes to the evolution", cw / 2, ch / 2 + 6);
    const h = evolution.history, best = h.length ? h[h.length - 1].best.toFixed(3) : "–";
    ctx.fillStyle = INK; ctx.font = "500 15px 'Segoe UI', sans-serif";
    ctx.fillText(`generation ${evolution.gen}   ·   best ${best}`, cw / 2, ch / 2 + 38);
    ctx.fillStyle = INK_FAINT; ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillText(genRate ? `${genRate.toFixed(2)} generations / sec` : "measuring…", cw / 2, ch / 2 + 60);
}

function frame(now) {
    requestAnimationFrame(frame);
    /* Elapsed wall time, capped: a tab that was hidden for a minute gets one
     * long-ish frame, not a minute of catching up. */
    const dt = lastFrame ? Math.min(0.1, Math.max(0, now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;
    if (!CFG.paused) {
        if (CFG.headless || CFG.speed === 0) {
            const budget = CFG.headless ? 30 : 20;
            const t0 = performance.now();
            while (performance.now() - t0 < budget) { stepOnce(); if (world.isOver()) { endEpisode(); break; } }
        } else {
            /* Fractional speeds accumulate BY TIME, not by frame: CFG.speed is
             * control ticks per sixtieth of a second, so "slow" is one hour
             * every 16/60 s on a 60 Hz screen and on a 120 Hz one alike.
             * Counting frames made a fast monitor run the plant twice as
             * fast and every dropped frame a stutter in the playback. */
            tickAcc += CFG.speed * dt * 60;
            let n = 0;
            while (tickAcc >= 1 && n++ < 60) { tickAcc -= 1; stepOnce(); if (world.isOver()) { endEpisode(); tickAcc = 0; break; } }
            if (tickAcc >= 1) tickAcc %= 1;
        }
    }
    if (CFG.headless && mode === "lab") renderHeadless();
    else {
        const u = focusUnit();
        // between ticks the display blends the last two states; at MAX speed
        // there are many ticks per frame and the latest is simply shown
        const frac = (CFG.headless || CFG.speed === 0 || CFG.speed >= 1) ? 1 : Math.min(1, tickAcc);
        const view = lerpView(viewPrev, viewCur, frac);
        renderer.frame(view, hist, {
            scn: world.scn, phase: phaseOf(u.r, world.t), t: world.t, frac, dt,
            title: mode === "sop" ? "the protocol's reactor" : mode === "exhibit" ? "the network's reactor" : `reactor 1 of ${world.units.length} — the unmutated best`,
            dashLabel: mode === "sop" ? "nobody touches it" : "the protocol"
        });
    }
    if (now - lastDom > 150) { lastDom = now; updateDom(); }
    if (now - lastNet > 45) {
        lastNet = now;
        drawNet(document.getElementById("netview"),
            mode === "sop" ? null : focusUnit().brain,
            mode === "sop" ? "the published protocol is a fixed recipe — there is no network in the loop" : null,
            focusUnit().r.act, world.lin);
    }
}

/* ----------------------------------------------------------------- boot */
initUI(
    () => { if (mode !== "lab") { mode = "lab"; CFG.exhibition = false; document.body.classList.remove("exhibit"); } rebuild(true); renderer.resize(); uiLog("evolution restarted"); },
    () => { if (mode === "lab") nextBatch(); },
    brainIO
);
UI.nextScenario = nextBatch;
/* Choosing a product throws the current batch away and draws one of the
 * chosen kind, in whichever mode the page is in. */
UI.onLineage = () => {
    if (mode === "exhibit") { exhibit.idx = 0; exhibit.draws = Array.from({ length: EXHIBIT_BATCHES }, () => randomBatch()); exhibit.rows = Array.from({ length: EXHIBIT_BATCHES }, () => ({ learn: null, sop: null })); newWorld(); }
    else nextBatch();
    uiLog(CFG.lin == null
        ? `<span class="evt">every batch now draws one of the five products at random</span>`
        : `<span class="evt">making ${LINEAGES[CFG.lin].label} — ${LINEAGES[CFG.lin].order}</span>`);
};
rebuild(true);
renderer.resize();
window.addEventListener("resize", () => renderer.resize());
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => renderer.resize()).observe(canvas.parentElement);
uiLog(`<span class="evt">${CFG.popSize} reactors · net ${NET_SIZES.join(" × ")} · ${N_IN} inputs · ` +
    `${N_LIN} products, one decision an hour</span>`);
if (window.DEFAULT_BRAIN) brainIO.loadDefault();
const _q = new URLSearchParams(location.search);
const _linq = _q.get("lin");
if (_linq != null) {
    const _li = /^\d+$/.test(_linq) ? parseInt(_linq, 10) : LINEAGES.findIndex(L => L.key === _linq);
    if (_li >= 0 && _li < N_LIN) { CFG.lin = _li; linRepaint.forEach(p => p()); }
}
const _lvl = parseInt(_q.get("level"), 10);
if (_lvl >= 0 && _lvl < N_LEVELS) CFG.level = _lvl;
if (_q.get("showcase") === "1") brainIO.showcase();
if (_q.get("sop") === "1") brainIO.sopOnly();
const _bench = parseInt(_q.get("bench"), 10);
if (_bench > 0) { for (let i = 0; i < _bench; i++) { stepOnce(); if (world.isOver()) endEpisode(); } }
requestAnimationFrame(frame);
