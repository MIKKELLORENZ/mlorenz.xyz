// Rendering + UI: world view with camera, GPS route overlay, neural
// activation visualization, fitness/delivery charts, toasts and control
// bindings. All canvas, no libraries.
'use strict';

const $ = id => document.getElementById(id);

const ACCENT = '#9ad6ff', ACCENT2 = '#ffbe6b', DANGER = '#ff7070', GOOD = '#95e58f';
const RAY_COLORS = { wall: '#ff7070', car: '#ffbe6b', person: '#ff8fd0' };

function actColor(v, alpha) {
    const a = Math.min(1, Math.abs(v)) * (alpha === undefined ? 1 : alpha);
    return v >= 0 ? `rgba(154,214,255,${a})` : `rgba(255,190,107,${a})`;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const camera = { follow: false, x: 0, y: 0, vx: 0, vy: 0 };

function worldTransform(canvas, town, selectedCar) {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const fitScale = Math.min(cw / town.W, ch / town.H);
    if (!camera.follow || !selectedCar) {
        return { scale: fitScale, ox: (cw - town.W * fitScale) / 2, oy: (ch - town.H * fitScale) / 2 };
    }
    const scale = fitScale * 2.4;
    // Critically-damped-ish camera easing toward the selected car.
    camera.x += (selectedCar.x - camera.x) * 0.12;
    camera.y += (selectedCar.y - camera.y) * 0.12;
    let ox = cw / 2 - camera.x * scale;
    let oy = ch / 2 - camera.y * scale;
    ox = clamp(ox, cw - town.W * scale, 0);
    oy = clamp(oy, ch - town.H * scale, 0);
    return { scale, ox, oy };
}

function canvasToWorld(canvas, town, selectedCar, px, py) {
    const t = worldTransform(canvas, town, selectedCar);
    return { x: (px - t.ox) / t.scale, y: (py - t.oy) / t.scale };
}

// ---------------------------------------------------------------------------
// World rendering (dynamic layer over the pre-rendered static town)
// ---------------------------------------------------------------------------

function renderWorld(canvas, ctx, world, staticCanvas, opts) {
    const dpr = window.devicePixelRatio || 1;
    const town = world.town;
    const sel = (opts.selectedIdx >= 0 && opts.selectedIdx < world.cars.length) ? world.cars[opts.selectedIdx] : null;
    const t = worldTransform(canvas, town, camera.follow ? sel : null);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#090d14';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.setTransform(dpr * t.scale, 0, 0, dpr * t.scale, dpr * t.ox, dpr * t.oy);
    ctx.drawImage(staticCanvas, 0, 0);

    // Traffic light heads: one dot per axis at opposing corners.
    for (const nid of town.lights) {
        const n = town.nodes[nid];
        const sH = lightStateAt(n, 'h', world.simTime);
        const sV = lightStateAt(n, 'v', world.simTime);
        const col = s => s === 'green' ? '#43d17c' : s === 'yellow' ? '#ffd54a' : '#ff5a5a';
        ctx.fillStyle = 'rgba(20,24,30,0.85)';
        ctx.fillRect(n.x + ROAD_HALF + 2, n.y - ROAD_HALF - 8, 6, 6);
        ctx.fillRect(n.x - ROAD_HALF - 8, n.y + ROAD_HALF + 2, 6, 6);
        ctx.fillStyle = col(sH);
        ctx.beginPath(); ctx.arc(n.x + ROAD_HALF + 5, n.y - ROAD_HALF - 5, 2.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col(sV);
        ctx.beginPath(); ctx.arc(n.x - ROAD_HALF - 5, n.y + ROAD_HALF + 5, 2.1, 0, Math.PI * 2); ctx.fill();
    }

    // Selected car's GPS route + job markers.
    if (sel && sel.route) {
        const pts = sel.route.pts;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(154,214,255,0.28)';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i <= Math.min(sel.routeIdx, pts.length - 1); i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(154,214,255,0.85)';
        ctx.beginPath();
        ctx.moveTo(pts[Math.min(sel.routeIdx, pts.length - 1)].x, pts[Math.min(sel.routeIdx, pts.length - 1)].y);
        for (let i = sel.routeIdx + 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();

        // Markers: pickup (orange ring + dot), delivery (house).
        const rest = town.buildings[sel.job.restIdx], home = town.buildings[sel.job.homeIdx];
        if (sel.leg === 'toPickup') _drawPickupMarker(ctx, rest.lane.x, rest.lane.y, world.simTime);
        _drawHomeMarker(ctx, home.lane.x, home.lane.y, sel.leg === 'toDelivery', world.simTime);
        // Dwell progress ring.
        if (sel.dwell > 0) {
            const target = sel.route.target;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.arc(target.x, target.y, 13, -Math.PI / 2, -Math.PI / 2 + (sel.dwell / 0.4) * Math.PI * 2);
            ctx.stroke();
        }
    }

    // Pedestrians: little walk-oriented bodies (feet, shoulders, head).
    for (let pi = 0; pi < world.peds.length; pi++) {
        const p = world.peds[pi];
        let dx = 0, dy = 1;
        if (p.crossing) { dx = p.crossing.tx - p.crossing.fx; dy = p.crossing.ty - p.crossing.fy; }
        else {
            const lp = world.town.sidewalkLoops[p.loop];
            if (lp) {
                const from = lp.pts[p.seg], to = lp.pts[(p.seg + (p.dir === 1 ? 1 : 3)) % 4];
                dx = to.x - from.x; dy = to.y - from.y;
            }
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(dy, dx));
        const swing = Math.sin((p.x + p.y) * 0.85);      // step cycle from travel
        ctx.fillStyle = 'rgba(20,28,20,0.30)';
        ctx.beginPath(); ctx.ellipse(0.5, 0.7, 3.0, 2.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#343a41';                        // feet
        ctx.beginPath(); ctx.arc(swing * 1.0, -1.2, 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(-swing * 1.0, 1.2, 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PED_SHIRTS[pi % PED_SHIRTS.length];   // shoulders/torso
        ctx.beginPath(); ctx.ellipse(-0.2, 0, 1.9, 2.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.ellipse(-0.6, 0, 1.1, 2.0, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5a4238';                        // hair behind the face
        ctx.beginPath(); ctx.arc(0.3, 0, 1.35, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8c9a0';                        // face, nudged forward
        ctx.beginPath(); ctx.arc(0.85, 0, 1.05, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // Cars.
    const bestIdx = opts.bestIdx;
    for (const car of world.cars) {
        const isSel = sel === car;
        ctx.save();
        ctx.translate(car.x, car.y);
        ctx.rotate(car.theta);
        if (!car.alive) ctx.globalAlpha = 0.3;
        else if (!world.carContact) ctx.globalAlpha = 0.62;   // ghost episode: cars pass through each other
        // Body: the whole fleet is white/silver; the selected car and the
        // current best are marked by colored outlines, not body paint.
        ctx.fillStyle = 'rgba(10,14,18,0.5)';
        ctx.fillRect(-CAR_LEN / 2 + 1, -CAR_W / 2 + 1.5, CAR_LEN, CAR_W);
        ctx.fillStyle = car.retired === 'crash' ? '#6a6f75' : _carColor(car.idx);
        ctx.beginPath();
        _roundRect(ctx, -CAR_LEN / 2, -CAR_W / 2, CAR_LEN, CAR_W, 2.5);
        ctx.fill();
        if (isSel || car.idx === bestIdx) {
            ctx.strokeStyle = isSel ? ACCENT : ACCENT2;
            ctx.lineWidth = 1.6;
            ctx.stroke();
        }
        // Windshield.
        ctx.fillStyle = 'rgba(25,35,48,0.85)';
        ctx.fillRect(CAR_LEN * 0.08, -CAR_W / 2 + 1.4, CAR_LEN * 0.2, CAR_W - 2.8);
        // Food on board.
        if (car.carrying) {
            ctx.fillStyle = '#ff8c42';
            ctx.beginPath(); ctx.arc(-CAR_LEN * 0.2, 0, 2.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // Sensor rays for the selected car.
    if (sel && sel.alive && opts.showSensors) {
        for (let r = 0; r < N_RAYS; r++) {
            const ang = sel.theta + r * (2 * Math.PI / N_RAYS);
            const dists = {
                wall: sel.inp[r] * SENSOR_RANGE, car: sel.inp[14 + r] * SENSOR_RANGE,
                person: sel.inp[28 + r] * SENSOR_RANGE
            };
            let best = 'none', bd = SENSOR_RANGE - 0.5;
            for (const k of ['wall', 'car', 'person']) {
                if (dists[k] < bd) { bd = dists[k]; best = k; }
            }
            ctx.strokeStyle = best === 'none' ? 'rgba(255,255,255,0.10)' : RAY_COLORS[best];
            ctx.lineWidth = best === 'none' ? 0.7 : 1.3;
            ctx.beginPath();
            ctx.moveTo(sel.x, sel.y);
            ctx.lineTo(sel.x + Math.cos(ang) * bd, sel.y + Math.sin(ang) * bd);
            ctx.stroke();
        }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const PED_SHIRTS = ['#c94f4f', '#4f7dc9', '#4fa06a', '#c9a04f', '#8a5fb8', '#d97fa8', '#5fb8b0', '#b86a4f'];

function _carColor(i) {
    // Fleet livery: whites and silvers only.
    const palette = ['#f4f6f8', '#e9edf1', '#dde2e8', '#cfd5dc', '#c2c9d1', '#eef1f4'];
    return palette[i % palette.length];
}

function _roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function _drawPickupMarker(ctx, x, y, t) {
    const pulse = 1 + Math.sin(t * 4) * 0.12;
    ctx.strokeStyle = '#ff8c42';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 10 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill();
}

function _drawHomeMarker(ctx, x, y, active, t) {
    ctx.globalAlpha = active ? 1 : 0.45;
    if (active) {
        const pulse = 1 + Math.sin(t * 4) * 0.12;
        ctx.strokeStyle = GOOD;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 10 * pulse, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = GOOD;
    ctx.fillRect(x - 3.4, y - 2, 6.8, 5);
    ctx.beginPath();
    ctx.moveTo(x - 4.6, y - 1.6); ctx.lineTo(x, y - 6); ctx.lineTo(x + 4.6, y - 1.6);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
}

// Cheap text panel for headless max-speed training.
function renderHeadlessSummary(canvas, ctx, world, ev, simRate) {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#090d14';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(154,214,255,0.85)';
    ctx.font = '600 15px Bahnschrift, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    const alive = world.cars.filter(c => c.alive).length;
    const lines = [
        'HEADLESS TRAINING AT MAXIMUM SPEED',
        '',
        `generation ${ev.gen}   ·   episode ${ev.episodeIdx + 1}/${ev.s.episodesPerGen}`,
        `alive ${alive}/${world.cars.length}   ·   t=${world.simTime.toFixed(0)}s`,
        `sim rate ≈ ${simRate.toFixed(0)}×`,
        '',
        'uncheck Headless to watch the town again'
    ];
    lines.forEach((l, i) => ctx.fillText(l, cw / 2, ch / 2 - 54 + i * 22));
    ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Charts (custom mini canvas line charts with town-change bands)
// ---------------------------------------------------------------------------

function drawHistoryChart(canvas, history, keys, colors, fmt) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (history.length < 2) {
        ctx.fillStyle = 'rgba(235,242,255,0.35)';
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.fillText('waiting for generations…', 8, H / 2);
        return;
    }
    const n = history.length;
    // Town-change background bands (alternating tint per town index).
    let bandStart = 0;
    for (let i = 1; i <= n; i++) {
        if (i === n || history[i].town !== history[bandStart].town) {
            if (history[bandStart].town % 2 === 1) {
                ctx.fillStyle = 'rgba(154,214,255,0.06)';
                ctx.fillRect((bandStart / (n - 1)) * W, 0, ((Math.min(i, n - 1) - bandStart) / (n - 1)) * W, H);
            }
            bandStart = i;
        }
    }
    let max = -Infinity, min = Infinity;
    for (const h of history) for (const k of keys) { max = Math.max(max, h[k]); min = Math.min(min, h[k]); }
    if (max === min) max = min + 1;
    const px = i => (i / (n - 1)) * (W - 6) + 3;
    const py = v => H - 5 - ((v - min) / (max - min)) * (H - 16);
    keys.forEach((k, ki) => {
        ctx.strokeStyle = colors[ki];
        ctx.lineWidth = ki === 0 ? 1.7 : 1.1;
        ctx.beginPath();
        history.forEach((h, i) => { i === 0 ? ctx.moveTo(px(0), py(h[k])) : ctx.lineTo(px(i), py(h[k])); });
        ctx.stroke();
    });
    ctx.fillStyle = 'rgba(235,242,255,0.6)';
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.fillText(fmt(max), 5, 10);
}

// ---------------------------------------------------------------------------
// Neural activation visualization
// ---------------------------------------------------------------------------

const SCALAR_LABELS = [
    'speed', 'sin hErr', 'cos hErr', 'x-track', 'wp dist', 'turn 1', 'turn 2',
    'route left', 'carrying', 'stop dist', 'light', 'glob x', 'glob y',
    'sin θ', 'cos θ', 'prv steer', 'prv gas', 'lane pos', 'dwell'
];

function drawNNViz(canvas, record, genome) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!record || !record[0]) {
        ctx.fillStyle = 'rgba(235,242,255,0.35)';
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.fillText('select a living car to inspect its brain', 8, H / 2);
        return;
    }
    const inp = record[0], h1 = record[1], h2 = record[2], h3 = record[3], out = record[4];

    // Input geometry: 3x14 sensor grid top-left, 18 scalar rows below.
    const gridX = 30, gridY = 16, cellW = 6.6, cellH = 9;
    const rowX = 12, rowY0 = gridY + 3 * cellH + 14, rowH = 11;
    const inputPos = i => {
        if (i < 42) {
            const ch = Math.floor(i / 14), ray = i % 14;
            return { x: gridX + ray * cellW + cellW / 2, y: gridY + ch * cellH + cellH / 2 };
        }
        const r = i - 42;
        return { x: rowX + 52, y: rowY0 + r * rowH + rowH / 2 };
    };
    const h1X = W - 148, h2X = W - 110, h3X = W - 70, outX = W - 28;
    const h1Pos = j => ({ x: h1X, y: 12 + j * ((H - 24) / 31) });
    const h2Pos = j => ({ x: h2X, y: 26 + j * ((H - 52) / 23) });
    const h3Pos = j => ({ x: h3X, y: 40 + j * ((H - 80) / 15) });
    const outPos = j => ({ x: outX, y: H * 0.35 + j * H * 0.22 });

    // Edges (weight x activation), drawn first, strongest only.
    const A = NN_ARCH;
    ctx.lineWidth = 0.7;
    for (let j = 0; j < A[1]; j++) {
        for (let i = 0; i < A[0]; i++) {
            const sig = genome[weightIndex(A, 1, i, j)] * inp[i];
            if (Math.abs(sig) < 0.30) continue;
            const p = inputPos(i), q = h1Pos(j);
            ctx.strokeStyle = actColor(sig, 0.30);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
    }
    for (let j = 0; j < A[2]; j++) {
        for (let i = 0; i < A[1]; i++) {
            const sig = genome[weightIndex(A, 2, i, j)] * h1[i];
            if (Math.abs(sig) < 0.30) continue;
            const p = h1Pos(i), q = h2Pos(j);
            ctx.strokeStyle = actColor(sig, 0.35);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
    }
    for (let j = 0; j < A[3]; j++) {
        for (let i = 0; i < A[2]; i++) {
            const sig = genome[weightIndex(A, 3, i, j)] * h2[i];
            if (Math.abs(sig) < 0.30) continue;
            const p = h2Pos(i), q = h3Pos(j);
            ctx.strokeStyle = actColor(sig, 0.35);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
    }
    for (let j = 0; j < A[4]; j++) {
        for (let i = 0; i < A[3]; i++) {
            const sig = genome[weightIndex(A, 4, i, j)] * h3[i];
            if (Math.abs(sig) < 0.25) continue;
            const p = h3Pos(i), q = outPos(j);
            ctx.strokeStyle = actColor(sig, 0.4);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
    }

    // Sensor grid cells (activation = proximity: 1 - distance).
    const chLabels = ['W', 'C', 'P'];
    ctx.font = '9px "Segoe UI", sans-serif';
    for (let ch = 0; ch < 3; ch++) {
        ctx.fillStyle = 'rgba(235,242,255,0.55)';
        ctx.fillText(chLabels[ch], gridX - 12, gridY + ch * cellH + cellH - 2);
        for (let r = 0; r < 14; r++) {
            const v = 1 - inp[ch * 14 + r];      // closer = hotter
            ctx.fillStyle = v > 0.02 ? actColor(v) : 'rgba(235,242,255,0.07)';
            ctx.fillRect(gridX + r * cellW, gridY + ch * cellH, cellW - 1, cellH - 1);
        }
    }
    ctx.fillStyle = 'rgba(235,242,255,0.45)';
    ctx.fillText('sensors: rays 0-13 ↔', gridX, gridY - 4);

    // Scalar inputs.
    for (let r = 0; r < 19; r++) {
        const v = inp[42 + r];
        ctx.fillStyle = 'rgba(235,242,255,0.5)';
        ctx.fillText(SCALAR_LABELS[r], rowX, rowY0 + r * rowH + 8);
        ctx.fillStyle = actColor(v);
        const p = inputPos(42 + r);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill();
    }

    // Hidden neurons.
    for (let j = 0; j < A[1]; j++) {
        const p = h1Pos(j);
        ctx.fillStyle = actColor(h1[j]);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (let j = 0; j < A[2]; j++) {
        const p = h2Pos(j);
        ctx.fillStyle = actColor(h2[j]);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (let j = 0; j < A[3]; j++) {
        const p = h3Pos(j);
        ctx.fillStyle = actColor(h3[j]);
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Outputs as labeled bars.
    const outLabels = ['steer', 'gas'];
    for (let j = 0; j < A[4]; j++) {
        const p = outPos(j);
        ctx.fillStyle = 'rgba(235,242,255,0.10)';
        ctx.fillRect(p.x - 5, p.y - 34, 10, 68);
        ctx.fillStyle = actColor(out[j]);
        const h = out[j] * 32;
        ctx.fillRect(p.x - 5, h >= 0 ? p.y - h : p.y, 10, Math.abs(h));
        ctx.fillStyle = 'rgba(235,242,255,0.7)';
        ctx.fillText(outLabels[j], p.x - 12, p.y + 46);
        ctx.fillText(out[j].toFixed(2), p.x - 12, p.y - 38);
    }
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

function toast(msg, kind) {
    const host = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 400);
    }, 3600);
}

// ---------------------------------------------------------------------------
// Control binding helpers
// ---------------------------------------------------------------------------

function bindRange(id, labelId, fmt, onChange) {
    const el = $(id), label = $(labelId);
    const update = () => {
        const v = parseFloat(el.value);
        label.textContent = fmt(v);
        onChange(v);
    };
    el.addEventListener('input', update);
    update();
    return el;
}

// Log-scale mapping for the genes-per-mutation slider (1 .. genome length).
function mutGenesFromSlider(v) {
    return Math.max(1, Math.min(NN_GENOME_LEN, Math.round(Math.exp(Math.log(NN_GENOME_LEN) * (v / 100)))));
}

if (typeof module !== 'undefined') {
    module.exports = { drawHistoryChart, mutGenesFromSlider };
}
