// Top-down renderer. Draws whatever World it is handed - the genome currently
// being scored, the champion in the watch tab, or a baseline controller - with
// the same code, so what you see is always the thing that is actually running.
'use strict';

const COL = {
    road: '#232c3c',
    hw: '#2c3950',
    island: '#16202e',
    giveWay: 'rgba(255,255,255,0.28)',
    roadEdge: '#161d29',
    box: '#2b364a',
    centre: '#3c4a63',
    walk: '#8493ab',
    car: '#9ad6ff',
    carSlow: '#ffc978',
    carStop: '#6f7d92',
    wreck: '#ff5f5f',
    ped: '#8ff0b4',
    pedWait: '#ffd98a',
    green: '#3fe08a',
    amber: '#ffbe6b',
    red: '#ff6b6b',
    pedGo: '#eaf4ff',
    pedStop: '#5a2b2b'
};

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.showDetectors = false;
        this.selected = -1;
    }

    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = this.canvas.getBoundingClientRect();
        const w = Math.max(64, Math.round(r.width * dpr));
        const h = Math.max(64, Math.round(r.height * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w; this.canvas.height = h;
        }
        this.dpr = dpr;
    }

    // World metres -> canvas pixels, fitted with a margin and then zoomed.
    fit(city) {
        const W = this.canvas.width, H = this.canvas.height;
        const s = Math.min(W / city.width, H / city.height) * 0.94 * this.zoom;
        this.scale = s;
        this.ox = (W - city.width * s) / 2 + this.panX;
        this.oy = (H - city.height * s) / 2 + this.panY;
    }

    tx(x) { return this.ox + x * this.scale; }
    ty(y) { return this.oy + y * this.scale; }

    // Canvas pixels -> world metres (for click-to-select).
    inv(px, py) {
        return { x: (px * this.dpr - this.ox) / this.scale, y: (py * this.dpr - this.oy) / this.scale };
    }

    // `lead` (seconds, 0 unless the watch tab is running below one step per
    // frame) coasts vehicles and pedestrians forward between physics steps.
    draw(world, lead) {
        const g = this.ctx, city = world.city;
        this.lead = lead || 0;
        this.resize();
        this.fit(city);
        g.fillStyle = '#0a0e15';
        g.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawRoads(world);
        this.drawCrossings(world);
        this.drawPeds(world);
        this.drawCars(world);
        this.drawSignals(world);
        if (this.selected >= 0 && this.selected < world.lights.length) this.drawSelection(world);
    }

    // Trace a polyline in canvas space.
    path(pts) {
        const g = this.ctx;
        g.beginPath();
        g.moveTo(this.tx(pts[0]), this.ty(pts[1]));
        for (let i = 1; i * 2 + 1 < pts.length; i++) g.lineTo(this.tx(pts[i * 2]), this.ty(pts[i * 2 + 1]));
    }

    drawRoads(world) {
        const g = this.ctx, city = world.city, s = this.scale;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        // Carriageway. Streets follow their own centreline, so a winding street
        // is drawn exactly where its traffic actually goes.
        for (const pass of [0, 1]) {
            g.strokeStyle = pass ? COL.hw : COL.road;
            for (const e of city.edges) {
                if (!!e.hw !== !!pass) continue;
                g.lineWidth = Math.max(1.5, 2 * (e.hw ? ROAD.LANE * 1.3 : ROAD.LANE) * s);
                this.path(e.centre.pts);
                g.stroke();
            }
        }
        // Junction boxes, and the island in the middle of a roundabout.
        for (const n of city.nodes) {
            if (n.portal) continue;
            if (n.round) {
                g.fillStyle = COL.box;
                g.beginPath();
                g.arc(this.tx(n.x), this.ty(n.y), (n.ringR + ROAD.LANE) * s, 0, Math.PI * 2);
                g.fill();
                g.fillStyle = COL.island;
                g.beginPath();
                g.arc(this.tx(n.x), this.ty(n.y), (n.ringR - ROAD.LANE * 0.9) * s, 0, Math.PI * 2);
                g.fill();
            } else {
                g.fillStyle = COL.box;
                const r = ROAD.CORNER * s;
                g.fillRect(this.tx(n.x) - r, this.ty(n.y) - r, r * 2, r * 2);
            }
        }
        // Centre line.
        if (s > 0.22) {
            g.strokeStyle = COL.centre;
            g.lineWidth = Math.max(0.5, 0.22 * s);
            g.setLineDash([6 * s, 6 * s]);
            for (const e of city.edges) { this.path(e.centre.pts); g.stroke(); }
            g.setLineDash([]);
        }
    }

    drawCrossings(world) {
        const g = this.ctx, city = world.city, s = this.scale;
        if (s < 0.28) return;
        for (const n of city.nodes) {
            if (n.portal) continue;
            const light = n.signal ? world.lights[n.sigIdx] : null;
            for (let k = 0; k < 4; k++) {
                if (!n.arms[k]) continue;
                const d = DIRV[k];
                const cx = n.x + d[0] * n.cornerR, cy = n.y + d[1] * n.cornerR;
                const px = -d[1], py = d[0];
                const state = light ? pedSignal(light, k) : 'walk';
                g.strokeStyle = state === 'walk' ? COL.pedGo : state === 'clear' ? COL.walk : COL.pedStop;
                g.globalAlpha = state === 'walk' ? 0.85 : 0.4;
                g.lineWidth = Math.max(0.6, 0.5 * s);
                g.beginPath();
                for (let t = -ROAD.LANE; t <= ROAD.LANE; t += 1.5) {
                    const bx = cx + px * t, by = cy + py * t;
                    g.moveTo(this.tx(bx - d[0] * 1.0), this.ty(by - d[1] * 1.0));
                    g.lineTo(this.tx(bx + d[0] * 1.0), this.ty(by + d[1] * 1.0));
                }
                g.stroke();
                g.globalAlpha = 1;
            }
        }
    }

    drawCars(world) {
        const g = this.ctx, s = this.scale;
        const L = ROAD.CAR_LEN * s, W = ROAD.CAR_W * s;
        for (const c of world.cars) {
            if (!c.alive) continue;
            const p = world.carPos(c, c.wreck ? 0 : this.lead);
            g.save();
            g.translate(this.tx(p.x), this.ty(p.y));
            g.rotate(p.a);
            g.fillStyle = c.wreck ? COL.wreck : c.v < 0.4 ? COL.carStop : c.v < 4 ? COL.carSlow : COL.car;
            if (L < 2) g.fillRect(-1, -1, 2.5, 2.5);
            else g.fillRect(-L / 2, -W / 2, L, W);
            g.restore();
        }
    }

    drawPeds(world) {
        const g = this.ctx, s = this.scale;
        const r = Math.max(1, 0.9 * s);
        for (const p of world.peds) {
            if (!p.alive) continue;
            const pos = p.edge ? world.pedPos(p, this.lead) : {
                x: world.city.ped.pos[p.node * 2], y: world.city.ped.pos[p.node * 2 + 1]
            };
            g.fillStyle = p.waiting && !p.edge ? COL.pedWait : COL.ped;
            g.beginPath();
            g.arc(this.tx(pos.x), this.ty(pos.y), r, 0, Math.PI * 2);
            g.fill();
        }
    }

    drawSignals(world) {
        const g = this.ctx, city = world.city, s = this.scale;
        const r = Math.max(1.6, 1.5 * s);
        for (const l of world.lights) {
            const n = city.nodes[l.node];
            for (let k = 0; k < 4; k++) {
                if (!n.arms[k]) continue;
                const d = DIRV[k];
                const px = -d[1], py = d[0];
                // The head faces the approaching traffic, on its right.
                const bx = n.x + d[0] * (n.stopR + 1.6) - px * ROAD.LANE * 0.9;
                const by = n.y + d[1] * (n.stopR + 1.6) - py * ROAD.LANE * 0.9;
                const sg = armSignal(l, k);
                g.fillStyle = sg === 'green' ? COL.green : sg === 'amber' ? COL.amber : COL.red;
                g.beginPath();
                g.arc(this.tx(bx), this.ty(by), r, 0, Math.PI * 2);
                g.fill();
                if (sg === 'green' && s > 0.3) {
                    g.globalAlpha = 0.22;
                    g.beginPath();
                    g.arc(this.tx(bx), this.ty(by), r * 2.6, 0, Math.PI * 2);
                    g.fill();
                    g.globalAlpha = 1;
                }
            }
            if (this.showDetectors && s > 0.35) {
                g.strokeStyle = 'rgba(154,214,255,0.35)';
                g.lineWidth = 1;
                for (let k = 0; k < 4; k++) {
                    const inL = n.in[k];
                    if (!inL) continue;
                    const t = Math.min(SIG.DETECT_LEN, inL.len);
                    g.beginPath();
                    for (let d2 = 0; d2 <= t; d2 += 6) {
                        const p = polyAt(inL, inL.len - d2);
                        if (d2 === 0) g.moveTo(this.tx(p.x), this.ty(p.y));
                        else g.lineTo(this.tx(p.x), this.ty(p.y));
                    }
                    g.stroke();
                }
            }
        }
    }

    drawSelection(world) {
        const g = this.ctx, l = world.lights[this.selected];
        const r = ROAD.CORNER * this.scale * 1.9;
        g.strokeStyle = '#9ad6ff';
        g.lineWidth = 1.5;
        g.setLineDash([4, 4]);
        g.strokeRect(this.tx(l.x) - r, this.ty(l.y) - r, r * 2, r * 2);
        g.setLineDash([]);
    }

    // Nearest signal to a click, or -1 if the click was nowhere near one.
    pick(world, px, py) {
        const w = this.inv(px, py);
        let best = -1, bd = 60 * 60;
        for (const l of world.lights) {
            const d = (l.x - w.x) * (l.x - w.x) + (l.y - w.y) * (l.y - w.y);
            if (d < bd) { bd = d; best = l.sig; }
        }
        return best;
    }
}

if (typeof module !== 'undefined') module.exports = { Renderer, COL };
