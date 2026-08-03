// The map.
//
// This started as a one-line diagram - the abstract thing power engineers draw,
// boxes and sticks - and that is a fine way to read a network if you already
// know what you are looking at. It is a terrible way to understand what is at
// stake. So the diagram is now drawn as a piece of country: coastline, hills, a
// river, towns whose windows are lit, power stations you can tell apart at a
// glance, and pylons carrying the lines between them.
//
// Nothing decorative is invented per frame. The terrain is generated once from
// the network's own seed and cached to an offscreen canvas, so it costs nothing
// to redraw and it is the same country every time you come back to that network.
//
// Everything the operator is actually judged on still has to be legible on top
// of it, and that constraint wins every time there is a conflict:
//   * a line's colour is its loading, on the same hard thresholds as before
//   * the thermal accumulator fills along the line as a bright core
//   * the worst contingency is a dashed arc from the outage to its victim
//   * and a town whose supply has been shed GOES DARK, which is the entire
//     subject of the simulation and was previously a small red stub
'use strict';

const COL = {
    bg: '#080c13',
    grid: 'rgba(120,150,190,0.07)',
    bus: '#8ba3c4',
    busHot: '#ffbe6b',
    text: '#dbe6f6',
    dim: '#6d7d94',
    ok: '#4ec9a0',
    warn: '#ffd166',
    hot: '#ff8c42',
    over: '#ff5d5d',
    out: '#3b4657',
    n1: '#c084fc',
    shed: '#ff5d5d',
    sea: '#0a1826',
    seaEdge: '#123049',
    land: '#0d141d',
    hill: '#111a25',
    river: '#14304a',
    pylon: 'rgba(150,175,205,0.5)'
};

// Loading -> colour. Deliberately not a smooth gradient: the eye needs to see
// the 90% and 100% thresholds land, because those are the numbers the operator
// is actually working to.
function loadColor(ld) {
    if (ld >= 1.0) return COL.over;
    if (ld >= 0.9) return COL.hot;
    if (ld >= 0.75) return COL.warn;
    return COL.ok;
}

// A tiny deterministic generator so the scenery belongs to the network rather
// than to the frame. Same network, same country, every session.
function scenicRng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
        a ^= a << 13; a >>>= 0;
        a ^= a >> 17;
        a ^= a << 5; a >>>= 0;
        return a / 4294967296;
    };
}

class Renderer {
    constructor(canvas) {
        this.cv = canvas;
        this.g = canvas.getContext('2d');
        this.dpr = 1;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.selected = -1;
        this.showN1 = true;
        this.showLabels = true;
        this.hover = -1;
        this._terrain = null;
        this._terrainKey = '';
    }

    resize() {
        const cv = this.cv;
        const r = cv.getBoundingClientRect();
        // Capped device pixel ratio: on a high-DPI laptop an uncapped one
        // quadruples the fill cost for a diagram made of lines, which was the
        // whole lesson of the moon-lander sim.
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(320, Math.round(r.width * dpr));
        const h = Math.max(240, Math.round(r.height * dpr));
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        this.dpr = dpr;
        this.W = w; this.H = h;
    }

    // Network coordinates are in [0,1], but no network actually fills that
    // square - IEEE 14 is a tall narrow thing and the generated ones are roughly
    // circular. Fitting the unit square instead of the network's own bounding
    // box left the diagram sitting in a third of the canvas. Aspect is preserved
    // so a 220 kV corridor does not become a different length depending on the
    // window shape.
    _proj(net) {
        if (this._boundsFor !== net) {
            let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
            for (const b of net.bus) {
                if (b.x < x0) x0 = b.x;
                if (b.x > x1) x1 = b.x;
                if (b.y < y0) y0 = b.y;
                if (b.y > y1) y1 = b.y;
            }
            const w = Math.max(0.08, x1 - x0), h = Math.max(0.08, y1 - y0);
            this._bounds = { x0, y0, w, h, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
            this._boundsFor = net;
        }
        const B = this._bounds;
        // Generous padding: bus names, voltages, load stubs and generator pips
        // all live outside the bounding box of the buses themselves.
        const padX = 78 * this.dpr, padY = 64 * this.dpr;
        const sc = Math.min((this.W - padX * 2) / B.w, (this.H - padY * 2) / B.h) * this.zoom;
        const ox = this.W / 2 - B.cx * sc + this.panX;
        const oy = this.H / 2 + B.cy * sc + this.panY;
        return { ox, oy, sc, px: (x) => ox + x * sc, py: (y) => oy - y * sc };
    }

    pick(world, cssX, cssY) {
        if (!world) return -1;
        const p = this._proj(world.net);
        const x = cssX * this.dpr, y = cssY * this.dpr;
        let best = -1, bd = 26 * this.dpr;
        for (let s = 0; s < world.net.nBus; s++) {
            const b = world.net.bus[s];
            const d = Math.hypot(p.px(b.x) - x, p.py(b.y) - y);
            if (d < bd) { bd = d; best = s; }
        }
        return best;
    }

    // --- the country ---------------------------------------------------------
    // Drawn once per (network, canvas size, view) into an offscreen canvas. It
    // is pure decoration and must never cost anything per frame, because the
    // training tab redraws this at whatever rate the evolution can afford.
    _terrainCanvas(net) {
        // Deliberately NOT keyed on zoom or pan. The coastline and the hills are
        // scenery, not data - nothing is measured against them - so they can sit
        // still in screen space while the network moves over them, and a drag
        // costs nothing instead of regenerating a canvas full of radial
        // gradients on every pixel of mouse movement. The one part that does
        // have to follow the network, the contour rings around each substation,
        // is drawn live below.
        const key = `${net.seed}|${this.W}x${this.H}`;
        if (this._terrainKey === key && this._terrain) return this._terrain;

        const cv = (typeof document !== 'undefined')
            ? document.createElement('canvas') : null;
        if (!cv) return null;
        cv.width = this.W; cv.height = this.H;
        const g = cv.getContext('2d');
        const dpr = this.dpr, W = this.W, H = this.H;
        const rng = scenicRng((net.seed ^ 0x9e3779b9) >>> 0);
        void dpr;

        const landGrad = g.createLinearGradient(0, 0, 0, H);
        landGrad.addColorStop(0, '#0b1119');
        landGrad.addColorStop(0.55, '#0e1620');
        landGrad.addColorStop(1, '#0a1017');
        g.fillStyle = landGrad;
        g.fillRect(0, 0, W, H);

        // A coastline down one side, chosen by the seed. Every one of these
        // networks is notionally a region of some country, and a region with an
        // edge reads as a place in a way a floating cloud of dots does not.
        const side = Math.floor(rng() * 4);
        const coastDepth = (0.12 + rng() * 0.10);
        g.save();
        g.beginPath();
        const cpts = 9;
        const pts = [];
        for (let i = 0; i <= cpts; i++) {
            const t = i / cpts;
            const wob = (rng() - 0.5) * 0.055;
            pts.push({ t, d: coastDepth + wob });
        }
        const toXY = (t, d) => {
            if (side === 0) return [t * W, d * H];               // north
            if (side === 1) return [W - d * W, t * H];            // east
            if (side === 2) return [t * W, H - d * H];            // south
            return [d * W, t * H];                               // west
        };
        g.moveTo(...toXY(0, 0));
        for (const q of pts) g.lineTo(...toXY(q.t, q.d));
        g.lineTo(...toXY(1, 0));
        g.closePath();
        const seaGrad = g.createLinearGradient(0, 0, W, H);
        seaGrad.addColorStop(0, COL.sea);
        seaGrad.addColorStop(1, '#081420');
        g.fillStyle = seaGrad;
        g.fill();
        g.strokeStyle = COL.seaEdge;
        g.lineWidth = 1.2 * dpr;
        g.stroke();
        g.restore();

        // Hills: soft overlapping blobs, darkest at the horizon. They give the
        // land some depth without ever competing with a coloured line.
        const nHill = 7 + Math.floor(rng() * 5);
        for (let i = 0; i < nHill; i++) {
            const hx = rng() * W, hy = rng() * H;
            const hr = (0.10 + rng() * 0.22) * Math.min(W, H);
            const grd = g.createRadialGradient(hx, hy, hr * 0.15, hx, hy, hr);
            grd.addColorStop(0, 'rgba(30,45,64,0.55)');
            grd.addColorStop(1, 'rgba(30,45,64,0)');
            g.fillStyle = grd;
            g.beginPath(); g.arc(hx, hy, hr, 0, Math.PI * 2); g.fill();
        }

        // A river, wandering from one edge to another and thickening as it goes,
        // because a river that does not get wider looks like a crack.
        const rx0 = rng() * W, ry0 = -20 * dpr;
        let rx = rx0, ry = ry0;
        const seg = 26;
        g.lineCap = 'round';
        for (let i = 0; i < seg; i++) {
            const nx = rx + (rng() - 0.5) * W * 0.10;
            const ny = ry + H / seg;
            g.strokeStyle = COL.river;
            g.globalAlpha = 0.55;
            g.lineWidth = (1 + 3.2 * (i / seg)) * dpr;
            g.beginPath(); g.moveTo(rx, ry); g.lineTo(nx, ny); g.stroke();
            rx = nx; ry = ny;
        }
        g.globalAlpha = 1;

        this._terrain = cv;
        this._terrainKey = key;
        return cv;
    }

    // --- a town --------------------------------------------------------------
    // Buildings sized by how much load the substation carries and LIT by how
    // much of it is actually being supplied. When the operator loses control and
    // the relays shed load, the windows go out. That is the one thing on this
    // whole page that needs no explanation at all.
    _drawTown(g, x, y, bus, served, frac, dpr, seedBase) {
        const rng = scenicRng((seedBase * 2654435761) >>> 0);
        const big = Math.min(1, served / 55);
        const n = 4 + Math.round(big * 5);
        const bw = (4.6 + big * 3.0) * dpr;
        const gap = 2.0 * dpr;
        const totalW = n * bw + (n - 1) * gap;
        let bx = x - totalW / 2;
        const baseY = y + 26 * dpr;
        g.strokeStyle = 'rgba(120,150,190,0.22)';
        g.lineWidth = 1 * dpr;
        g.beginPath();
        g.moveTo(x - totalW / 2 - 4 * dpr, baseY + 0.5);
        g.lineTo(x + totalW / 2 + 4 * dpr, baseY + 0.5);
        g.stroke();

        for (let i = 0; i < n; i++) {
            const h = (9 + rng() * (11 + big * 20)) * dpr;
            g.fillStyle = 'rgba(24,34,50,0.97)';
            g.fillRect(bx, baseY - h, bw, h);
            g.strokeStyle = 'rgba(140,170,210,0.30)';
            g.lineWidth = 0.8 * dpr;
            g.strokeRect(bx + 0.4, baseY - h + 0.4, bw - 0.8, h - 0.8);

            // Windows. The number lit is the fraction of demand being served, so
            // a 20% shed really does turn one window in five off.
            const rows = Math.max(1, Math.floor((h - 2 * dpr) / (4.0 * dpr)));
            const cols = Math.max(1, Math.floor((bw - 1.6 * dpr) / (2.8 * dpr)));
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const roll = rng();
                    if (roll > 0.80) continue;               // dark window anyway
                    const lit = roll < frac * 0.80;
                    g.fillStyle = lit ? 'rgba(255,216,140,0.96)' : 'rgba(58,72,92,0.6)';
                    g.fillRect(
                        bx + 1.0 * dpr + c * 2.8 * dpr,
                        baseY - h + 2.0 * dpr + r * 4.0 * dpr,
                        1.5 * dpr, 2.0 * dpr);
                }
            }
            bx += bw + gap;
        }

        // The warm glow of a town that still has power, and a red one for a town
        // that has lost some.
        if (frac > 0.02) {
            const R = (24 + big * 30) * dpr;
            const grd = g.createRadialGradient(x, baseY - 8 * dpr, 1, x, baseY - 8 * dpr, R);
            grd.addColorStop(0, `rgba(255,196,110,${0.16 + 0.22 * frac})`);
            grd.addColorStop(1, 'rgba(255,196,110,0)');
            g.fillStyle = grd;
            g.beginPath(); g.arc(x, baseY - 8 * dpr, R, 0, Math.PI * 2); g.fill();
        }
        if (frac < 0.98) {
            g.strokeStyle = `rgba(255,93,93,${0.25 + 0.5 * (1 - frac)})`;
            g.lineWidth = 1.3 * dpr;
            g.beginPath();
            g.moveTo(x - totalW / 2 - 2 * dpr, baseY + 1.5 * dpr);
            g.lineTo(x + totalW / 2 + 2 * dpr, baseY + 1.5 * dpr);
            g.stroke();
        }
    }

    // --- a power station -----------------------------------------------------
    // Each fuel gets a silhouette you can name without a legend: cooling towers,
    // a chimney with smoke, a turning turbine, a panel array, a dam.
    _drawPlant(g, x, y, gen, on, frac, t, dpr) {
        const col = GEN_KINDS[gen.kind].color;
        g.save();
        g.globalAlpha = on ? 0.68 + 0.32 * frac : 0.30;
        g.strokeStyle = col;
        g.fillStyle = col;
        g.lineWidth = 1.7 * dpr;
        const u = 1.45 * dpr;
        // A halo, so a running station is visible against terrain at a glance.
        if (on && frac > 0.05) {
            const gr = g.createRadialGradient(x, y - 5 * u, 1, x, y - 5 * u, 15 * u);
            gr.addColorStop(0, col.replace('#', 'rgba(').length ? col : col);
            g.save();
            g.globalAlpha = 0.13 + 0.20 * frac;
            g.fillStyle = col;
            g.beginPath(); g.arc(x, y - 5 * u, 13 * u, 0, Math.PI * 2); g.fill();
            g.restore();
            void gr;
        }

        if (gen.kind === 'wind') {
            // The blades turn at a speed set by what the farm is producing, so a
            // becalmed farm is visibly becalmed and a curtailed one visibly slows.
            const hub = { x, y: y - 8 * u };
            g.beginPath(); g.moveTo(x, y); g.lineTo(hub.x, hub.y); g.stroke();
            const spin = t * (0.05 + frac * 0.55) + gen.id;
            for (let i = 0; i < 3; i++) {
                const a = spin + i * Math.PI * 2 / 3;
                g.beginPath();
                g.moveTo(hub.x, hub.y);
                g.lineTo(hub.x + Math.cos(a) * 7 * u, hub.y + Math.sin(a) * 7 * u);
                g.stroke();
            }
        } else if (gen.kind === 'solar') {
            for (let i = 0; i < 3; i++) {
                const px = x - 7 * u + i * 6 * u;
                g.beginPath();
                g.moveTo(px, y);
                g.lineTo(px + 4.6 * u, y - 3.4 * u);
                g.lineTo(px + 4.6 * u, y - 6.4 * u);
                g.lineTo(px, y - 3 * u);
                g.closePath();
                g.globalAlpha = (on ? 0.35 + 0.55 * frac : 0.2);
                g.fill();
            }
        } else if (gen.kind === 'hydro') {
            // A dam wall with water behind it.
            g.beginPath();
            g.moveTo(x - 8 * u, y);
            g.lineTo(x - 5 * u, y - 9 * u);
            g.lineTo(x + 5 * u, y - 9 * u);
            g.lineTo(x + 8 * u, y);
            g.closePath();
            g.fill();
            g.globalAlpha *= 0.5;
            g.fillRect(x - 8 * u, y - 12 * u, 16 * u, 3 * u);
        } else if (gen.kind === 'nuclear' || gen.kind === 'coal') {
            // Hyperboloid cooling towers, with a plume when running hard.
            for (const off of [-5 * u, 5 * u]) {
                g.beginPath();
                g.moveTo(x + off - 3.4 * u, y);
                g.quadraticCurveTo(x + off - 1.4 * u, y - 5 * u, x + off - 2.4 * u, y - 10 * u);
                g.lineTo(x + off + 2.4 * u, y - 10 * u);
                g.quadraticCurveTo(x + off + 1.4 * u, y - 5 * u, x + off + 3.4 * u, y);
                g.closePath();
                g.fill();
            }
            if (on && frac > 0.15) {
                g.globalAlpha *= 0.30;
                g.fillStyle = '#dfe9f7';
                for (const off of [-5 * u, 5 * u]) {
                    g.beginPath();
                    g.arc(x + off, y - 13 * u - (t * 0.5 % 3) * u, (2 + frac * 2.2) * u, 0, Math.PI * 2);
                    g.fill();
                }
            }
        } else {
            // Gas: a block with a chimney.
            g.fillRect(x - 7 * u, y - 6 * u, 11 * u, 6 * u);
            g.fillRect(x + 4 * u, y - 12 * u, 2.6 * u, 12 * u);
            if (on && frac > 0.2) {
                g.globalAlpha *= 0.28;
                g.fillStyle = '#dfe9f7';
                g.beginPath();
                g.arc(x + 5.3 * u, y - 14 * u - (t * 0.4 % 3) * u, (1.6 + frac * 1.8) * u, 0, Math.PI * 2);
                g.fill();
            }
        }
        g.restore();
    }

    // A pylon: two legs and two crossarms. Drawn along a line so a corridor
    // reads as infrastructure rather than as a wire.
    _drawPylon(g, x, y, ang, dpr, col) {
        const u = dpr;
        g.save();
        g.translate(x, y);
        g.rotate(ang + Math.PI / 2);
        g.strokeStyle = col;
        g.lineWidth = 0.9 * u;
        g.beginPath();
        g.moveTo(-2.2 * u, 4 * u); g.lineTo(0, -6 * u);
        g.moveTo(2.2 * u, 4 * u); g.lineTo(0, -6 * u);
        g.moveTo(-4 * u, -1.5 * u); g.lineTo(4 * u, -1.5 * u);
        g.moveTo(-3 * u, -4 * u); g.lineTo(3 * u, -4 * u);
        g.stroke();
        g.restore();
    }

    draw(world) {
        this.resize();
        const g = this.g, net = world.net, st = world.st;
        if (!net) { g.fillStyle = COL.bg; g.fillRect(0, 0, this.W, this.H); return; }

        const terrain = this._terrainCanvas(net);
        if (terrain) g.drawImage(terrain, 0, 0);
        else { g.fillStyle = COL.bg; g.fillRect(0, 0, this.W, this.H); }

        const p = this._proj(net);
        const dpr = this.dpr;
        const S = Math.max(1, world.scaleMW);

        // Contour rings: the suggestion of the ground each substation was built
        // on. Cheap enough to draw every frame, and unlike the coastline these
        // do have to follow the network when it is panned.
        {
            const rng = scenicRng((net.seed ^ 0x51ed2701) >>> 0);
            g.strokeStyle = 'rgba(120,150,190,0.05)';
            g.lineWidth = 1 * dpr;
            for (const b of net.bus) {
                const x = p.px(b.x), y = p.py(b.y);
                const rings = 2 + Math.floor(rng() * 3);
                for (let i = 1; i <= rings; i++) {
                    g.beginPath();
                    g.arc(x, y, (16 + i * 13) * dpr * (0.8 + rng() * 0.5), 0, Math.PI * 2);
                    g.stroke();
                }
            }
        }

        // --- night and day ----------------------------------------------------
        // The whole country dims through the small hours and warms at dawn. It
        // is the cheapest possible way to make the clock in the corner mean
        // something, and the evening peak is the moment most of the trouble in
        // this simulation happens.
        const hour = ((world.wx && world.wx.startHour || 0) + world.t * SIM.DT_H) % 24;
        // Zero at 06:00 and 18:00, one at midday, held at zero overnight.
        const daylight = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
        const night = 1 - daylight;
        if (night > 0.02) {
            g.fillStyle = `rgba(10,14,30,${0.26 * night})`;
            g.fillRect(0, 0, this.W, this.H);
        }
        // ...and a warm wash low in the sky at dawn and dusk, which is when the
        // evening peak lands and most of the trouble here happens.
        const dusk = Math.max(0, 1 - Math.abs(hour - 18.5) / 2.6) + Math.max(0, 1 - Math.abs(hour - 6.5) / 2.2);
        if (dusk > 0.02) {
            const gr = g.createLinearGradient(0, this.H, 0, this.H * 0.45);
            gr.addColorStop(0, `rgba(255,140,80,${0.10 * Math.min(1, dusk)})`);
            gr.addColorStop(1, 'rgba(255,140,80,0)');
            g.fillStyle = gr;
            g.fillRect(0, 0, this.W, this.H);
        }

        // --- storm footprints -------------------------------------------------
        if (world.storms) {
            for (const s of world.storms) {
                if (world.t < s.at - 12) continue;
                const age = world.t - s.at;
                const a = age < 0 ? 0.06 : Math.max(0.04, 0.16 - age * 0.002);
                const cx = p.px(s.x), cy = p.py(s.y), R = s.r * p.sc;
                // A cloud mass rather than a flat disc, plus rain once it lands.
                const rng = scenicRng(((s.at + 1) * 7919) >>> 0);
                for (let i = 0; i < 7; i++) {
                    const ox = (rng() - 0.5) * R * 1.1, oy = (rng() - 0.5) * R * 0.8;
                    const rr = R * (0.35 + rng() * 0.4);
                    const grd = g.createRadialGradient(cx + ox, cy + oy, 1, cx + ox, cy + oy, rr);
                    grd.addColorStop(0, `rgba(150,130,235,${a * 1.5})`);
                    grd.addColorStop(1, 'rgba(150,130,235,0)');
                    g.fillStyle = grd;
                    g.beginPath(); g.arc(cx + ox, cy + oy, rr, 0, Math.PI * 2); g.fill();
                }
                if (age >= 0 && age < 40) {
                    g.strokeStyle = `rgba(170,190,255,${0.10 + 0.05 * Math.sin(world.t * 0.4)})`;
                    g.lineWidth = 0.8 * dpr;
                    for (let i = 0; i < 14; i++) {
                        const rx = cx + (rng() - 0.5) * R * 1.6;
                        const ry = cy + (rng() - 0.5) * R * 1.2 + ((world.t * 3 + i * 7) % 14) * dpr;
                        g.beginPath();
                        g.moveTo(rx, ry); g.lineTo(rx - 1.5 * dpr, ry + 5 * dpr);
                        g.stroke();
                    }
                }
            }
        }

        // --- the dangerous contingency ---------------------------------------
        if (this.showN1 && world.n1 && world.n1.worst > 1 &&
            world.n1.worstOutage >= 0 && world.n1.worstBranch >= 0) {
            const a = net.branch[world.n1.worstOutage], b = net.branch[world.n1.worstBranch];
            const ax = (p.px(net.bus[a.f].x) + p.px(net.bus[a.t].x)) / 2;
            const ay = (p.py(net.bus[a.f].y) + p.py(net.bus[a.t].y)) / 2;
            const bx = (p.px(net.bus[b.f].x) + p.px(net.bus[b.t].x)) / 2;
            const by = (p.py(net.bus[b.f].y) + p.py(net.bus[b.t].y)) / 2;
            g.strokeStyle = COL.n1;
            g.lineWidth = 1.4 * dpr;
            g.setLineDash([5 * dpr, 5 * dpr]);
            g.globalAlpha = 0.65;
            g.beginPath();
            g.moveTo(ax, ay);
            const mx = (ax + bx) / 2 + (by - ay) * 0.22, my = (ay + by) / 2 - (bx - ax) * 0.22;
            g.quadraticCurveTo(mx, my, bx, by);
            g.stroke();
            g.setLineDash([]);
            g.globalAlpha = 1;
        }

        // --- branches ---------------------------------------------------------
        for (let b = 0; b < net.nBranch; b++) {
            const br = net.branch[b];
            const x1 = p.px(net.bus[br.f].x), y1 = p.py(net.bus[br.f].y);
            const x2 = p.px(net.bus[br.t].x), y2 = p.py(net.bus[br.t].y);
            const wid = (1.4 + Math.min(4.2, br.rate / S * 5)) * dpr;
            const live = st.status[b];
            const ang = Math.atan2(y2 - y1, x2 - x1);
            const len = Math.hypot(x2 - x1, y2 - y1);

            if (!live) {
                g.strokeStyle = COL.out;
                g.lineWidth = 1.2 * dpr;
                g.setLineDash([3 * dpr, 4 * dpr]);
                g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
                g.setLineDash([]);
                // A cross at the midpoint: the difference between a line that is
                // out for repair and one the operator opened is a text label, so
                // the colour carries it instead.
                const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, r = 4 * dpr;
                g.strokeStyle = st.repair[b] > 0 ? COL.over : COL.dim;
                g.lineWidth = 1.6 * dpr;
                g.beginPath();
                g.moveTo(cx - r, cy - r); g.lineTo(cx + r, cy + r);
                g.moveTo(cx + r, cy - r); g.lineTo(cx - r, cy + r);
                g.stroke();
                continue;
            }
            const ld = world.flows.load[b];
            const col = loadColor(ld);

            // A soft halo under a stressed line. A red line on a dark map is easy
            // to miss; a red line that is glowing is not.
            if (ld >= 0.9) {
                g.save();
                g.strokeStyle = col;
                g.globalAlpha = Math.min(0.34, (ld - 0.9) * 1.4 + 0.10);
                g.lineWidth = wid * 4.5;
                g.lineCap = 'round';
                g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
                g.restore();
            }

            g.strokeStyle = col;
            g.lineWidth = wid;
            g.lineCap = 'round';
            g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();

            // Pylons along the corridor, spaced so they read at any zoom without
            // ever crowding a short line.
            const nP = Math.max(0, Math.min(6, Math.floor(len / (46 * dpr)) - 1));
            if (nP > 0 && this.zoom > 0.7) {
                for (let i = 1; i <= nP; i++) {
                    const u = i / (nP + 1);
                    this._drawPylon(g, x1 + (x2 - x1) * u, y1 + (y2 - y1) * u, ang, dpr, COL.pylon);
                }
            }

            // Thermal accumulator: a bright core filling from the "from" end.
            if (st.heat[b] > 0.02) {
                const f = Math.min(1, st.heat[b]);
                g.strokeStyle = '#fff1c9';
                g.lineWidth = Math.max(1, wid * 0.42);
                g.beginPath();
                g.moveTo(x1, y1);
                g.lineTo(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f);
                g.stroke();
            }
            // Direction of flow, as a tick that walks along the line.
            if (Math.abs(world.flows.pf[b]) > S * 0.008) {
                const dir = world.flows.pf[b] >= 0 ? 1 : -1;
                const t = ((world.t * 0.06 + b * 0.13) % 1);
                const u = dir > 0 ? t : 1 - t;
                const cx = x1 + (x2 - x1) * u, cy = y1 + (y2 - y1) * u;
                g.fillStyle = 'rgba(255,255,255,0.55)';
                g.beginPath();
                g.arc(cx, cy, Math.max(1.1 * dpr, wid * 0.30), 0, Math.PI * 2);
                g.fill();
            }
        }

        // --- substations, towns and power stations ----------------------------
        for (let s = 0; s < net.nBus; s++) {
            const bus = net.bus[s];
            const x = p.px(bus.x), y = p.py(bus.y);
            const split = world.res && world.res.subNode2[s] >= 0;
            const hv = bus.baseKV >= 150;
            const r = (hv ? 8.5 : 6.5) * dpr;

            // The town this substation feeds, if it feeds one.
            if (bus.pd0 > 0) {
                const want = st.pd[s];
                const served = want * (1 - st.shed[s]);
                const frac = want > 0 ? Math.max(0, 1 - st.shed[s]) : 1;
                this._drawTown(g, x, y, bus, served, world.blackout ? 0 : frac, dpr, s + 1);
            }

            // Power stations sit above the substation they connect to.
            let gi = 0, nGenHere = 0;
            for (const gen of net.gen) if (gen.bus === s) nGenHere++;
            for (const gen of net.gen) {
                if (gen.bus !== s) continue;
                const frac = gen.pmax > 0 ? Math.max(0, st.pg[gen.id]) / gen.pmax : 0;
                const spread = (nGenHere - 1) * 15 * dpr;
                const gx = x - spread / 2 + gi * 15 * dpr;
                this._drawPlant(g, gx, y - r - 6 * dpr, gen, !!st.genOn[gen.id], frac, world.t, dpr);
                gi++;
            }

            // The busbar itself. Split substations are drawn as two bars.
            const hot = st.shed[s] > 0.02 || st.vm[s] < 0.94 || st.vm[s] > 1.06;
            g.fillStyle = split ? COL.n1 : (hot ? COL.busHot : COL.bus);
            if (split) {
                g.fillRect(x - r, y - r * 0.75, r * 2, 2.6 * dpr);
                g.fillRect(x - r, y + r * 0.15, r * 2, 2.6 * dpr);
            } else {
                g.fillRect(x - r, y - 1.6 * dpr, r * 2, 3.2 * dpr);
            }
            if (this.selected === s) {
                g.strokeStyle = '#9ad6ff';
                g.lineWidth = 1.6 * dpr;
                g.strokeRect(x - r - 4 * dpr, y - r - 4 * dpr, (r + 4 * dpr) * 2, (r + 4 * dpr) * 2);
            }
            if (this.showLabels && this.zoom > 0.85) {
                const lift = (gi ? 26 : 9) * dpr;
                g.fillStyle = '#a8bcd6';
                g.font = `${11 * dpr}px Bahnschrift, Segoe UI, sans-serif`;
                g.textAlign = 'center';
                // A dark plate behind the name, because the map underneath is no
                // longer a flat colour and unbacked text on terrain is unreadable.
                const tw = g.measureText(bus.name).width;
                g.fillStyle = 'rgba(8,12,19,0.62)';
                g.fillRect(x - tw / 2 - 3 * dpr, y - r - lift - 9 * dpr, tw + 6 * dpr, 12 * dpr);
                g.fillStyle = '#a8bcd6';
                g.fillText(bus.name, x, y - r - lift);
                if (st.vm[s] > 0.05) {
                    g.fillStyle = (st.vm[s] < 0.94 || st.vm[s] > 1.06) ? COL.busHot : 'rgba(160,180,205,0.5)';
                    g.font = `${10 * dpr}px Bahnschrift, Segoe UI, sans-serif`;
                    g.fillText(st.vm[s].toFixed(2), x + r + 13 * dpr, y + 3 * dpr);
                }
            }
        }
        g.textAlign = 'left';
    }
}

if (typeof module !== 'undefined') {
    module.exports = { Renderer, COL, loadColor };
}
