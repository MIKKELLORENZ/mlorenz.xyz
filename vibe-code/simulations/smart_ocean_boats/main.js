/* main.js — boot, generation cycle, rendering. */
"use strict";

let map, router, evolution, world;
let stageState = { collisions: false, combat: false };
let simAccum = 0, lastFrame = 0, lastDom = 0;
let mapCanvas = null;

const canvas = document.getElementById("sea");
const ctx = canvas.getContext("2d");

/* ---------------------------------------------------------------- helpers */
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpC(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) | 0; h = Math.imul(h, 1274126177);
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------- map pre-render */
function prerenderMap() {
    const { gw, gh, land, distLand, distWater } = map;
    const pal = map.def.palette;
    mapCanvas = document.createElement("canvas");
    mapCanvas.width = gw; mapCanvas.height = gh;
    const mctx = mapCanvas.getContext("2d");
    const img = mctx.createImageData(gw, gh);
    const d = img.data;
    for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
            const i = y * gw + x;
            let c;
            if (!land[i]) {
                const band = pal.shoreBand || 6;
                const t = Math.sqrt(Math.min(1, distLand[i] / band));
                c = lerpC(pal.sand, lerpC(pal.shallow, pal.deep, t), Math.min(1, distLand[i] / 1.1));
                if (distLand[i] < 0.6) c = lerpC([255, 255, 255], c, 0.55); // shore foam
            } else {
                const dw = distWater[i];
                if (dw < 1.2) c = pal.sand;
                else c = lerpC(pal.land, pal.interior, Math.min(1, (dw - 1.2) / 5));
                const ps = pal.peakStart || 7, pw = pal.peakSpan || 6;
                if (pal.peak && dw > ps) c = lerpC(c, pal.peak, Math.min(1, (dw - ps) / pw));
            }
            const n = (hash2(x, y) - 0.5) * 9;
            const o = i * 4;
            d[o] = c[0] + n; d[o + 1] = c[1] + n; d[o + 2] = c[2] + n; d[o + 3] = 255;
        }
    }
    mctx.putImageData(img, 0, 0);
}

/* --------------------------------------------------------- world/gen mgmt */
function currentStage() {
    const s = stageFor(evolution.gen, evolution.history, CFG);
    // latch: once collisions/combat switch on, they stay on
    stageState.collisions = stageState.collisions || s.shipCollisions;
    stageState.combat = stageState.combat || s.combat;
    return { shipCollisions: stageState.collisions, combat: stageState.combat };
}

/* Each generation is scored over TRIALS episodes with different missions and
 * weather — a single lucky route stops looking like skill. */
const TRIALS = 2;
let trial = 0, trialFit = null, trialArr = null;

function newWorld() {
    const stage = currentStage();
    world = new World(map, router, evolution.brains, {
        shipCollisions: stage.shipCollisions,
        combat: stage.combat,
        missionSeed: evolution.gen * TRIALS + trial,
        noise: CFG.noise,
        startBudget: CFG.episodeTime
    });
}

function endGeneration() {
    if (!trialFit) {
        trialFit = new Float64Array(world.boats.length);
        trialArr = new Int32Array(world.boats.length);
    }
    for (const b of world.boats) {
        trialFit[b.idx] += b.fitness();
        trialArr[b.idx] += b.arrivals;
    }
    trial++;
    if (trial < TRIALS) { newWorld(); return; }
    const results = evolution.brains.map((brain, i) => ({
        brain, fitness: trialFit[i], arrivals: trialArr[i]
    }));
    trial = 0; trialFit = null; trialArr = null;
    const sum = evolution.evolve(results, CFG.mutRate, CFG.mutSigma, CFG.gracePeriod);
    const stage = currentStage();
    const stageName = stage.combat ? "3·combat" : stage.shipCollisions ? "2·collide" : "1·navigate";
    uiLog(`<span class="gen">gen ${evolution.gen - 1}</span> best ${Math.round(sum.best)} · mean ${Math.round(sum.avg)} · arrivals ${sum.bestArr}/${sum.avgArr.toFixed(1)} · s${stageName}`);
    if (evolution.graceEvent) uiLog(`<span class="evt">${evolution.graceEvent}</span>`);
    drawChart(evolution.history);
    newWorld();
}

function rebuild(fullRestart) {
    map = buildMap(MAP_DEFS[CFG.mapIndex]);
    router = new Router(map);
    prerenderMap();
    if (fullRestart || !evolution) {
        evolution = new Evolution(CFG.popSize, (Math.random() * 1e9) | 0);
        stageState = { collisions: false, combat: false };
        drawChart(evolution.history);
    }
    newWorld();
}

/* ------------------------------------------------------------- brain I/O */
function bestBrainJSON() {
    const b = world.boats[world.leaderIdx];
    const net = evolution.champion && evolution.championFit > b.fitness() ? evolution.champion : b.brain;
    return JSON.stringify({
        format: "smart-ocean-boats-brain-v3",
        inputs: NET_SIZES[0], outputs: 5, sizes: NET_SIZES,
        map: map.name, gen: evolution.gen,
        net: net.toJSON()
    });
}
const brainIO = {
    save() {
        localStorage.setItem("sob_champion", bestBrainJSON());
        uiLog(`<span class="evt">champion saved to browser storage</span>`);
    },
    load() {
        const s = localStorage.getItem("sob_champion");
        if (!s) { uiLog("no saved champion found"); return; }
        brainIO.importJSON(s);
    },
    exportFile() {
        const blob = new Blob([bestBrainJSON()], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `sob_brain_gen${evolution.gen}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    },
    importJSON(text) {
        try {
            const o = JSON.parse(text);
            const src = o.net || o;
            if (JSON.stringify(src.sizes) !== JSON.stringify(NET_SIZES)) {
                uiLog(`import failed: brain is ${src.sizes ? src.sizes.join("×") : "unknown"}, this build expects ${NET_SIZES.join("×")}`);
                return;
            }
            const net = Net.fromJSON(src);
            // seed it into the population: it replaces the last slot and
            // becomes the reigning champion benchmark
            evolution.brains[evolution.brains.length - 1] = net;
            evolution.champion = net.clone();
            uiLog(`<span class="evt">brain imported — seeded into the population</span>`);
        } catch (e) {
            uiLog(`import failed: ${e.message}`);
        }
    }
};

/* ------------------------------------------------------------- rendering */
let view = { scale: 10, ox: 0, oy: 0 };

function resize() {
    const wrap = canvas.parentElement;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);   // fill-rate cap
    canvas.width = wrap.clientWidth * dpr;
    canvas.height = wrap.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = wrap.clientWidth, chh = wrap.clientHeight;
    view.scale = Math.min(cw / map.w, chh / map.h);
    view.ox = (cw - map.w * view.scale) / 2;
    view.oy = (chh - map.h * view.scale) / 2;
}
function W2SX(x) { return view.ox + x * view.scale; }
function W2SY(y) { return view.oy + y * view.scale; }

function drawBoat(b, isLeader) {
    const s = view.scale;
    const L = BOAT.LOA * 2.2 * s, W = BOAT.BEAM * 2.2 * s;   // drawn oversized for legibility
    ctx.save();
    if (b.done && b.alive) ctx.globalAlpha = 0.3;            // clock ran out
    ctx.translate(W2SX(b.x), W2SY(b.y));
    ctx.rotate(b.heading);
    if (b.foil > 0.4 && b.alive) {                            // foiling glow
        ctx.fillStyle = `rgba(120,230,255,${0.25 * b.foil})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, L * 0.75, W * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    let color = b.alive
        ? (b.idx === evolution.graceIdx ? "#5ee8b5" : b.idx < 4 ? "#ffc94d" : "#9fc4e8")
        : "#5a6675";
    if (b.hp < BOAT.HP && b.alive) color = "#ff9f7a";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(L * 0.55, 0);
    ctx.lineTo(L * 0.1, -W * 0.5);
    ctx.lineTo(-L * 0.45, -W * 0.42);
    ctx.lineTo(-L * 0.45, W * 0.42);
    ctx.lineTo(L * 0.1, W * 0.5);
    ctx.closePath();
    ctx.fill();
    if (isLeader) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.4;
        ctx.stroke();
    }
    // engines
    ctx.fillStyle = "#22303f";
    ctx.fillRect(-L * 0.5, -W * 0.34, L * 0.14, W * 0.2);
    ctx.fillRect(-L * 0.5, W * 0.14, L * 0.14, W * 0.2);
    ctx.restore();
}

function render(t) {
    const cw = canvas.parentElement.clientWidth, chh = canvas.parentElement.clientHeight;
    ctx.clearRect(0, 0, cw, chh);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mapCanvas, view.ox, view.oy, map.w * view.scale, map.h * view.scale);

    // current field
    if (CFG.showCurrents) {
        ctx.strokeStyle = "rgba(200,240,255,0.22)";
        ctx.lineWidth = 1;
        for (let y = 4; y < map.h; y += 6) {
            for (let x = 4; x < map.w; x += 6) {
                if (map.isLand(x, y)) continue;
                const [cx, cy] = map.current(x, y, world.time);
                const m = Math.hypot(cx, cy);
                if (m < 0.06) continue;
                const k = Math.min(3.4, m * 5) * view.scale;
                const ux = cx / m, uy = cy / m;
                const sx = W2SX(x), sy = W2SY(y);
                ctx.beginPath();
                ctx.moveTo(sx - ux * k * 0.5, sy - uy * k * 0.5);
                ctx.lineTo(sx + ux * k * 0.5, sy + uy * k * 0.5);
                ctx.lineTo(sx + ux * k * 0.5 - (ux * 0.35 + uy * 0.25) * k, sy + uy * k * 0.5 - (uy * 0.35 - ux * 0.25) * k);
                ctx.stroke();
            }
        }
    }

    // docks — scenery and landmarks now; GPS points are the real targets
    ctx.font = `${Math.max(9, view.scale * 1.1)}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    for (const d of map.docks) {
        const sx = W2SX(d.x), sy = W2SY(d.y);
        ctx.strokeStyle = "rgba(255,179,71,0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 1.1 * view.scale, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "rgba(255,179,71,0.6)";
        ctx.beginPath(); ctx.arc(sx, sy, 0.3 * view.scale, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillText(d.name, sx, sy - 1.7 * view.scale);
    }

    const leader = world.boats[world.leaderIdx];

    // GPS points still being chased by someone (the fleet shares one sequence,
    // but laggards may be a point or two behind the frontier)
    const activeIdx = new Set();
    for (const b of world.boats) {
        if (b.alive && !b.done && !b.hunting) activeIdx.add(b.missionIdx);
    }
    for (const idx of activeIdx) {
        const p = world.points[idx];
        if (!p) continue;
        const isLeaderTarget = !leader.hunting && leader.missionIdx === idx;
        const sx = W2SX(p.x), sy = W2SY(p.y);
        const pulse = isLeaderTarget ? 1 + 0.12 * Math.sin(t * 4) : 1;
        ctx.strokeStyle = isLeaderTarget ? "#4fe0a8" : "rgba(255,255,255,0.45)";
        ctx.lineWidth = isLeaderTarget ? 2.5 : 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 2.2 * view.scale * pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = isLeaderTarget ? "#4fe0a8" : "rgba(255,255,255,0.6)";
        ctx.beginPath(); ctx.arc(sx, sy, 0.35 * view.scale, 0, Math.PI * 2); ctx.fill();
        ctx.fillText(`GPS ${idx + 1}`, sx, sy - 2.8 * view.scale * pulse);
    }

    // GPS route of the leader
    if (CFG.showRoutes && leader.tracker) {
        const p = leader.tracker.path;
        ctx.strokeStyle = leader.hunting ? "rgba(255,95,107,0.8)" : "rgba(255,255,255,0.55)";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(W2SX(leader.x), W2SY(leader.y));
        for (let i = leader.tracker.idx; i < p.length; i++) ctx.lineTo(W2SX(p[i][0]), W2SY(p[i][1]));
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // sensor rays of the leader
    if (CFG.showSensors) {
        const N = BOAT.SENSOR_N, R = BOAT.SENSOR_RANGE;
        for (let i = 0; i < N; i++) {
            const th = leader.heading + (i / N) * Math.PI * 2;
            const dLand = (1 - leader.inputs[i]) * R;
            const dShip = (1 - leader.inputs[N + i]) * R;
            const d = Math.min(dLand, dShip);
            ctx.strokeStyle = dShip < dLand ? "rgba(255,120,120,0.5)" : "rgba(140,255,190,0.3)";
            ctx.beginPath();
            ctx.moveTo(W2SX(leader.x), W2SY(leader.y));
            ctx.lineTo(W2SX(leader.x + Math.cos(th) * d), W2SY(leader.y + Math.sin(th) * d));
            ctx.stroke();
        }
    }

    // wakes
    if (CFG.showTrails) {
        for (const b of world.boats) {
            if (b.trail.length < 2) continue;
            ctx.strokeStyle = b.idx === leader.idx ? "rgba(255,255,255,0.35)" : "rgba(190,225,255,0.14)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(W2SX(b.trail[0][0]), W2SY(b.trail[0][1]));
            for (const p of b.trail) ctx.lineTo(W2SX(p[0]), W2SY(p[1]));
            ctx.stroke();
        }
    }

    // boats (leader last, on top)
    for (const b of world.boats) if (b.idx !== leader.idx) drawBoat(b, false);
    drawBoat(leader, true);

    // projectiles
    ctx.strokeStyle = "#ffe08a";
    ctx.lineWidth = 2;
    for (const p of world.projectiles) {
        ctx.beginPath();
        ctx.moveTo(W2SX(p.x), W2SY(p.y));
        ctx.lineTo(W2SX(p.x - p.vx * 0.03), W2SY(p.y - p.vy * 0.03));
        ctx.stroke();
    }

    // wind rose (HUD, top-right of the sea)
    const hx = cw - 46, hy = 44;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(hx, hy, 20, 0, Math.PI * 2); ctx.stroke();
    const wd = Math.atan2(world.wind[1], world.wind[0]);
    const wl = Math.min(18, world.windSpeed * 4);
    ctx.strokeStyle = "#9fe3ff"; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(hx - Math.cos(wd) * wl, hy - Math.sin(wd) * wl);
    ctx.lineTo(hx + Math.cos(wd) * wl, hy + Math.sin(wd) * wl);
    ctx.stroke();
    ctx.fillStyle = "#9fe3ff";
    ctx.beginPath();
    ctx.arc(hx + Math.cos(wd) * wl, hy + Math.sin(wd) * wl, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("wind", hx, hy + 32);
}

/* ------------------------------------------------------------- DOM stats */
function updateDom() {
    const leader = world.boats[world.leaderIdx];
    document.getElementById("stat-gen").textContent = evolution.gen;
    const st = world.opts.combat ? "stage 3 · combat" : world.opts.shipCollisions ? "stage 2 · collisions" : "stage 1 · navigate";
    document.getElementById("stat-stage").textContent = st;
    const h = evolution.history;
    document.getElementById("stat-best").textContent = h.length ? Math.round(h[h.length - 1].best) : "–";
    document.getElementById("stat-arr").textContent = h.length ? `${h[h.length - 1].bestArr}/${h[h.length - 1].avgArr.toFixed(1)}` : "–";
    document.getElementById("stat-wind").textContent = `${world.windSpeed.toFixed(1)} m/s`;
    document.getElementById("ep-time").textContent = `${world.time.toFixed(1)} s`;
    const clockEl = document.getElementById("ep-clock");
    clockEl.textContent = `${leader.timeLeft.toFixed(0)} s`;
    clockEl.style.color = leader.timeLeft < 15 && !leader.done ? "var(--danger)" : "";
    document.getElementById("ep-arr").textContent = leader.arrivals;
    document.getElementById("ep-speed").textContent = `${leader.speed.toFixed(1)} m/s${leader.foil > 0.5 ? " ✈ foiling" : ""}`;
    document.getElementById("ep-state").textContent =
        !leader.alive ? "sunk" : leader.done ? "out of time" : leader.hunting ? "hunting" : "delivering";
    const [ccx, ccy] = map.current(leader.x, leader.y, world.time);
    document.getElementById("ep-current").textContent = `${Math.hypot(ccx, ccy).toFixed(2)} m/s`;
    for (const e of world.events) uiLog(`<span class="evt">${e}</span>`);
    world.events.length = 0;
}

/* ------------------------------------------------------------- main loop */
function frame(now) {
    requestAnimationFrame(frame);
    const dtReal = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;

    if (!CFG.paused) {
        if (CFG.speed === 0) {
            const t0 = performance.now();
            while (performance.now() - t0 < 22) {
                world.step();
                if (world.isOver()) endGeneration();
            }
        } else {
            simAccum += dtReal * 30 * CFG.speed;
            let steps = Math.min(240, simAccum | 0);
            simAccum -= steps;
            while (steps-- > 0) {
                world.step();
                if (world.isOver()) endGeneration();
            }
        }
        // wakes (render-rate sampling keeps them smooth and cheap)
        if (CFG.showTrails && CFG.speed !== 0) {
            for (const b of world.boats) {
                if (b.speed > 0.3) {
                    b.trail.push([b.x, b.y]);
                    if (b.trail.length > 40) b.trail.shift();
                }
            }
        }
    }

    render(now / 1000);
    if (now - lastDom > 250) { lastDom = now; updateDom(); }
}

/* ----------------------------------------------------------------- boot */
initUI(
    () => { rebuild(false); resize(); },   // map change keeps the evolved brains
    () => { rebuild(true); resize(); uiLog("evolution restarted"); },
    brainIO
);
const _mq = parseInt(new URLSearchParams(location.search).get("map"), 10);
if (!isNaN(_mq) && _mq >= 0 && _mq < MAP_DEFS.length) {
    CFG.mapIndex = _mq;
    document.querySelectorAll("#map-buttons button").forEach((b, i) => b.classList.toggle("on", i === _mq));
    document.getElementById("map-desc").textContent = MAP_DEFS[_mq].desc;
}
rebuild(true);
resize();
// ?bench=N runs N physics steps synchronously at load — headless-screenshot
// warm-up hook (rAF barely fires under Chrome's virtual time).
const _bench = parseInt(new URLSearchParams(location.search).get("bench"), 10);
if (_bench > 0) {
    for (let i = 0; i < _bench; i++) {
        world.step();
        if (world.isOver()) endGeneration();
    }
}
window.addEventListener("resize", resize);
uiLog(`<span class="evt">fleet launched — ${CFG.popSize} boats, ${map.name}</span>`);
requestAnimationFrame(frame);
