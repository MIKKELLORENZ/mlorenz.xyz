/* main.js — boot, the generation cycle, the viewing modes and the per-frame
 * update.
 *
 *   exhibit  the built-in network against the published protocol on identical
 *            batches (the default)
 *   lab      a population evolving in the browser (?lab=1)
 *   sop      the published protocol on its own, with an untouched reactor
 *            alongside (?sop=1)
 *
 * Every batch is a fresh draw: the product (unless one is pinned), the cell
 * line, the inoculum, the reagent lots and what breaks along the way.
 */
"use strict";

let evolution = null, world = null, renderer = null;
let mode = "lab";
let epIdx = 0, plan = [], acc = null;
let lastDom = 0, lastNet = 0, genRate = 0, lastGenT = 0, tickAcc = 0, lastFrame = 0;
let hist = null;
let chartKey = "";                       // what the lab's fitness chart was last drawn for
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

function setMode(m) {
    mode = m;
    CFG.exhibition = m !== "lab";
    document.body.dataset.mode = m;
}

/* ------------------------------------------------- a batch is a fresh draw */
const EXHIBIT_BATCHES = 6;
const exhibit = { brain: null, idx: 0, draws: [] };
const sopView = { draw: null };

/* Any product (unless one is pinned), any difficulty up to CFG.level, and a
 * seed outside the training range. */
function randomBatch() {
    return {
        seed: 200000 + ((Math.random() * 500000) | 0),
        level: Math.min(N_LEVELS - 1, (Math.random() * (CFG.level + 1)) | 0),
        lin: CFG.lin == null ? (Math.random() * N_LIN) | 0 : CFG.lin
    };
}
function freshDraws() { return Array.from({ length: EXHIBIT_BATCHES }, () => randomBatch()); }

/* The generation's episode plan, with the product pinned if one was chosen. */
function currentPlan() {
    const p = episodePlan(CFG.episodes, currentBlock(), CFG.level);
    return CFG.lin == null ? p : p.map(e => Object.assign({}, e, { lin: CFG.lin }));
}

/* ------------------------------------------------------- lab: generations */
function currentBlock() { return Math.floor((evolution.gen - 1) / 2); }

function newWorld() {
    if (mode === "exhibit") {
        const d = exhibit.draws[exhibit.idx] || (exhibit.draws[exhibit.idx] = randomBatch());
        world = new World([exhibit.brain], { seed: d.seed, level: d.level, lin: d.lin, withBaselines: true, withNothing: false });
    } else if (mode === "sop") {
        if (!sopView.draw) sopView.draw = randomBatch();
        const d = sopView.draw;
        world = new World([], { seed: d.seed, level: d.level, lin: d.lin, withBaselines: true, withNothing: true });
    } else {
        const ep = plan[epIdx];
        world = new World(evolution.brains, { seed: ep.seed, level: ep.level, lin: ep.lin, withBaselines: true, withNothing: false });
    }
    hist = { learn: newHist(), sop: newHist() };
    viewPrev = viewCur = viewOf(focusUnit().r);
    renderOrderCard();
}

function endEpisode() {
    if (mode === "exhibit") {
        if (++exhibit.idx >= EXHIBIT_BATCHES) { exhibit.idx = 0; exhibit.draws = freshDraws(); }
        newWorld();
        return;
    }
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
    uiLog(`<span class="gen">Generation ${evolution.gen - 1}</span> best ${rec.best.toFixed(3)}, mean ${rec.avg.toFixed(3)}, ` +
        `${(rec.avgSurv * 100).toFixed(0)} % alive`);
    if (evolution.graceEvent) uiLog(`<span class="evt">${evolution.graceEvent}</span>`);
    plan = currentPlan();
    newWorld();
}

function rebuild(fullRestart) {
    if (!renderer) renderer = new Renderer(canvas);
    if (fullRestart || !evolution) {
        evolution = new Evolution(CFG.popSize, (Math.random() * 1e9) | 0, NET_SIZES);
        chartKey = "";
    }
    epIdx = 0; acc = null;
    plan = currentPlan();
    newWorld();
}

/* ------------------------------------------------------------ exhibition */
function enterExhibition(net) {
    exhibit.brain = net; exhibit.idx = 0; exhibit.draws = freshDraws();
    setMode("exhibit");
    CFG.paused = false; CFG.headless = false;
    const hc = document.getElementById("chk-headless");
    if (hc) hc.checked = false;
    newWorld();
    syncPause();
}
/* "New batch": throw this batch away and draw another. */
function nextBatch() {
    if (mode === "exhibit") exhibit.draws[exhibit.idx] = randomBatch();
    else if (mode === "sop") sopView.draw = randomBatch();
    else { epIdx = 0; acc = null; plan = currentPlan(); }
    newWorld();
}
function syncPause() { const p = document.getElementById("btn-pause"); if (p) p.textContent = CFG.paused ? "Resume" : "Pause"; }

/* --------------------------------------------------------------- brain I/O */
function championJSON() {
    const net = evolution && evolution.champion ? evolution.champion : (world.units[0] ? world.units[0].brain : null);
    return JSON.stringify({ format: "bioreactor-brain-v2", sizes: NET_SIZES, gen: evolution ? evolution.gen : 0, net: net.toJSON() });
}
const brainIO = {
    save() {
        try { localStorage.setItem("bioreactor_champion", championJSON()); uiLog(`<span class="evt">Saved to this browser</span>`); }
        catch (e) { uiLog(`Save failed: ${e.message}`); }
    },
    load() {
        let s = null;
        try { s = localStorage.getItem("bioreactor_champion"); } catch (e) { /* storage blocked */ }
        if (!s) { uiLog("Nothing saved in this browser"); return; }
        brainIO.importJSON(s, "Saved network loaded");
    },
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
                uiLog(`Import failed: the network is ${src.sizes ? src.sizes.join("×") : "unknown"}, this page expects ${NET_SIZES.join("×")}`);
                return;
            }
            const net = Net.fromJSON(src);
            if (mode !== "lab") { setMode("lab"); rebuild(false); syncPause(); }
            evolution.brains[evolution.brains.length - 1] = net;
            evolution.champion = net.clone();
            uiLog(`<span class="evt">${label || "Network imported"}, seeded into the population</span>`);
        } catch (e) { uiLog(`Import failed: ${e.message}`); }
    },
    loadDefault() {
        if (!window.DEFAULT_BRAIN) { uiLog("No built-in network is bundled"); return; }
        brainIO.importJSON(JSON.stringify(window.DEFAULT_BRAIN), "Built-in network loaded");
    },
    showcase() {
        if (!window.DEFAULT_BRAIN) { uiLog("No built-in network is bundled; evolve one"); return; }
        const src = window.DEFAULT_BRAIN.net || window.DEFAULT_BRAIN;
        if (JSON.stringify(src.sizes) !== JSON.stringify(NET_SIZES)) { uiLog("The built-in network does not match this page"); return; }
        const net = Net.fromJSON(src);
        if (evolution) evolution.champion = net.clone();
        enterExhibition(net);
    },
    sopOnly() {
        setMode("sop");
        CFG.paused = false; CFG.headless = false;
        sopView.draw = randomBatch();
        newWorld(); syncPause();
    }
};

/* -------------------------------------------------------------- DOM */
function fmt(v, d, unit) { return (v == null || !Number.isFinite(v)) ? "—" : v.toFixed(d) + (unit || ""); }
function set(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }

/* What was ordered, and what this particular batch is like. */
function renderOrderCard() {
    const scn = world.scn, L = scn.lin;
    const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const ec50 = Array.from(scn.line.cueEC50).slice(0, L.nCue).map(x => 1 / x);
    set("ord-name", L.label);
    set("ord-days", `${L.days.toFixed(0)} days · difficulty ${scn.level}`);
    set("ord-why", `${cap(L.order)}, scored on yield, purity and ${L.func.label}.`);
    const reagents = L.cues.map((c, i) =>
        `<span class="chip" id="cue-chip-${i}" title="${c.label}"><b>${c.short}</b><span>off</span></span>`).join("");
    const faults = scn.events.length
        ? scn.events.map((e, i) => `<span class="chip" id="ev-${i}"><b>${cap(EVENT_TYPES[e.type].label)}</b><span>day ${(e.t0 / 24).toFixed(1)}</span></span>`).join("")
        : `<span class="hidden-note">None at this difficulty</span>`;
    const rows = [
        ["Seeded", `${scn.seedDensity.toFixed(2)} M/mL, ${weekdays[scn.startWeekday]} 09:00`],
        ["Cell line", `Doubling ×${(1 / scn.line.muScale).toFixed(2)}, differentiation ×${scn.line.prop.toFixed(2)}, ` +
            `sensitivity ×${Math.min(...ec50).toFixed(2)}–${Math.max(...ec50).toFixed(2)} ` +
            `<span class="hidden-note">(hidden from the controller)</span>`],
        ["Reagents", `<div class="chips">${reagents}</div>`],
        ["Faults", `<div class="chips">${faults}</div>`]
    ];
    document.getElementById("ord-facts").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

/* A notebook value, with how old the sample is when it came from the lab. */
function reading(id, value, age) {
    const e = document.getElementById(id);
    if (!e) return;
    if (value == null) { e.className = "none"; e.textContent = "not sampled yet"; return; }
    e.className = "";
    e.innerHTML = age == null ? value : `${value}<span class="age${age > 30 ? " old" : ""}">${age} h ago</span>`;
}

function updateNotebook(u) {
    const lab = u.lab, on = lab.online || {}, t = world.t, L = world.lin;
    reading("nb-DO", on.DO == null ? null : fmt(on.DO, 0, " %"));
    reading("nb-pH", on.pH == null ? null : on.pH.toFixed(2));
    const c = on.colour;
    reading("nb-colour", c == null ? null : c > 0.8 ? "Red" : c > 0.55 ? "Orange-red" : c > 0.3 ? "Orange" : "Yellow");
    reading("nb-cap", on.cap == null ? null : fmt(on.cap, 2, " M/mL"));
    const offline = (id, key, f) => {
        const v = lab.latest(key);
        reading(id, v == null ? null : f(v), v == null ? null : lab.age(key, t));
    };
    offline("nb-glc", "glc", v => v.toFixed(1) + " mM");
    offline("nb-lac", "lac", v => v.toFixed(1) + " mM");
    offline("nb-viable", "viable", v => v.toFixed(2) + " M/mL");
    offline("nb-aggD", "aggD", v => v.toFixed(0) + " µm");
    set("nb-prod-label", L.stages[L.matureIdx].marker);
    offline("nb-prod", "m" + L.matureIdx, v => (v * 100).toFixed(0) + " %");
    set("nb-func-label", cap(L.func.label));
    offline("nb-func", "func", v => (v * 100).toFixed(0) + " %");
}

function updateDom() {
    const u = focusUnit(), r = u.r, L = world.lin;
    if (mode === "lab") {
        const h = evolution.history;
        set("stat-gen", evolution.gen);
        set("stat-best", h.length ? h[h.length - 1].best.toFixed(3) : "—");
        set("stat-alive", `${world.units.filter(x => !x.r.failed).length} of ${world.units.length}`);
        set("stat-rate", genRate ? `${genRate.toFixed(2)} gen/s` : "");
        const cv = document.getElementById("chart"), key = `${h.length}:${cv.clientWidth}`;
        if (key !== chartKey) { chartKey = key; drawChart(cv, h); }
    }
    updateNotebook(u);
    // reagent chips light up with what is in the vessel
    for (let i = 0; i < L.nCue; i++) {
        const c = document.getElementById("cue-chip-" + i);
        if (!c) continue;
        const spec = L.cues[i], on = r.cue[i] > 0.02 * spec.hi;
        c.classList.toggle("on", on);
        c.lastChild.textContent = on ? formatDose(r.cue[i], spec) : "off";
    }
    const active = new Set((r.dist.active || []).map(e => world.scn.events.indexOf(e)));
    world.scn.events.forEach((e, i) => { const c = document.getElementById("ev-" + i); if (c) c.classList.toggle("alert", active.has(i)); });
}

/* What is happening in the vessel, read off the cues and the stage
 * populations: [headline, detail]. */
function phaseOf(r, t) {
    const L = r.lin;
    if (r.failed) return ["Culture lost", cap(r.failReason || "")];
    if (t >= r.hours - 1) return ["Harvest", `scored on yield, purity and ${L.func.label}`];
    if (t < 20) return ["Seeding", "single cells are forming aggregates"];
    let bi = 0;
    for (let i = 1; i < L.nStage; i++) if (r.N[i] > r.N[bi]) bi = i;
    const head = bi === L.matureIdx ? `${cap(L.product)} maturing`
        : bi === L.immIdx ? `${cap(L.product)} appearing`
            : bi === 0 ? "Still pluripotent"
                : `Mostly ${L.stages[bi].label}`;
    const on = [];
    for (let i = 0; i < L.nCue; i++) if (r.cue[i] > 0.05 * L.cues[i].hi) on.push(L.cues[i].short);
    const body = on.length ? `${on.join(", ")} in the medium` : `no reagents, ${L.media[r.act.medium].key} medium`;
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
    const ctx = renderer.ctx, W = renderer.cw, H = renderer.ch;
    ctx.fillStyle = PAL.surface; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = PAL.text; ctx.font = font(15, 600);
    ctx.fillText("Training without drawing", W / 2, H / 2 - 10);
    const h = evolution.history, best = h.length ? h[h.length - 1].best.toFixed(3) : "—";
    ctx.fillStyle = PAL.muted; ctx.font = font(12);
    ctx.fillText(`Generation ${evolution.gen} · best ${best}` + (genRate ? ` · ${genRate.toFixed(2)} gen/s` : ""), W / 2, H / 2 + 14);
    ctx.textAlign = "left";
}

function frame(now) {
    requestAnimationFrame(frame);
    // Elapsed wall time, capped so a tab that was hidden does not try to catch up.
    const dt = lastFrame ? Math.min(0.1, Math.max(0, now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;
    if (!CFG.paused) {
        if (CFG.headless || CFG.speed === 0) {
            const budget = CFG.headless ? 30 : 20;
            const t0 = performance.now();
            while (performance.now() - t0 < budget) { stepOnce(); if (world.isOver()) { endEpisode(); break; } }
        } else {
            // CFG.speed is control ticks per 1/60 s, accumulated by elapsed time so
            // playback runs at the same rate on any refresh rate.
            tickAcc += CFG.speed * dt * 60;
            let n = 0;
            while (tickAcc >= 1 && n++ < 60) { tickAcc -= 1; stepOnce(); if (world.isOver()) { endEpisode(); tickAcc = 0; break; } }
            if (tickAcc >= 1) tickAcc %= 1;
        }
    }
    if (CFG.headless && mode === "lab") renderHeadless();
    else {
        const u = focusUnit();
        // Between ticks the display blends the last two states; at 16× and up
        // there is at least one tick per frame and the latest is shown as is.
        const frac = (CFG.headless || CFG.speed === 0 || CFG.speed >= 1) ? 1 : Math.min(1, tickAcc);
        renderer.frame(lerpView(viewPrev, viewCur, frac), hist, {
            scn: world.scn, phase: phaseOf(u.r, world.t), lost: u.r.failed, frac, dt,
            title: mode === "sop" ? "Protocol's reactor" : mode === "exhibit" ? "Network's reactor" : `Reactor 1 of ${world.units.length}, best so far`,
            focusLabel: mode === "sop" ? "Protocol" : "Network",
            dashLabel: mode === "sop" ? "Untouched" : "Protocol",
            note: mode === "lab" ? `Generation ${evolution.gen}, batch ${epIdx + 1} of ${plan.length}` : null
        });
    }
    if (now - lastDom > 150) { lastDom = now; updateDom(); }
    if (now - lastNet > 45) {
        lastNet = now;
        drawNet(document.getElementById("netview"),
            mode === "sop" ? null : focusUnit().brain,
            mode === "sop" ? "The published protocol is a fixed recipe, so there is no network in the loop." : null,
            focusUnit().r.act, world.lin);
    }
}

/* ----------------------------------------------------------------- boot */
initUI(() => {
    setMode("lab");
    rebuild(true); renderer.resize();
    uiLog("Evolution restarted from random networks");
}, brainIO);
UI.nextScenario = nextBatch;
/* Choosing a product throws the current batch away and draws one of that kind. */
UI.onLineage = () => {
    if (mode === "exhibit") { exhibit.idx = 0; exhibit.draws = freshDraws(); newWorld(); }
    else nextBatch();
};
set("net-shape", NET_SIZES.join(" → "));
rebuild(true);
renderer.resize();
window.addEventListener("resize", () => renderer.resize());
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => renderer.resize()).observe(canvas.parentElement);

const query = new URLSearchParams(location.search);
const linParam = query.get("lin");
if (linParam != null) {
    const li = /^\d+$/.test(linParam) ? parseInt(linParam, 10) : LINEAGES.findIndex(L => L.key === linParam);
    if (li >= 0 && li < N_LIN) { CFG.lin = li; linRepaint.forEach(p => p()); }
}
const levelParam = parseInt(query.get("level"), 10);
if (levelParam >= 0 && levelParam < N_LEVELS) CFG.level = levelParam;
if (window.DEFAULT_BRAIN) brainIO.loadDefault();
if (query.get("lab") === "1") {
    setMode("lab");
    uiLog(`<span class="evt">${CFG.popSize} reactors, network ${NET_SIZES.join(" × ")}, one decision an hour</span>`);
} else if (query.get("sop") === "1") {
    brainIO.sopOnly();
} else {
    brainIO.showcase();
}
// The training panel only exists in the lab; keep it out of the phone sheet otherwise.
if (mode !== "lab") document.getElementById("panel-right").setAttribute("data-mob-skip", "");
const bench = parseInt(query.get("bench"), 10);
if (bench > 0) { for (let i = 0; i < bench; i++) { stepOnce(); if (world.isOver()) endEpisode(); } }
requestAnimationFrame(frame);
