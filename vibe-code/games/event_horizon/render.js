/* render.js — the chart.
 *
 * The big canvas is a MAP, not a photograph: a top-down plot of the ship on an
 * exactly flat slice of the spacetime (see physics.js for why that slice is
 * flat). Things that exist only to be understood are drawn on it as overlays:
 *
 *   rings      horizon, photon sphere, last stable orbit
 *   contours   how fast a hovering clock ticks at each radius
 *   river      space itself falling in, at sqrt(rs/r)·c
 *   cone       everywhere light from the ship can be a moment from now
 *   predict    the free-fall path from here — the true geodesic, not an ellipse
 *   pulses     the ship's beacon flashes, carried as real photons
 *
 * What the pilot would actually SEE is porthole.js.
 *
 * World y points up, so anticlockwise orbits look anticlockwise.
 */
"use strict";

const DPR_CAP = 1.5;          // fill-rate, not geometry, is what costs on a 4K laptop panel
const TRAIL_MAX = 700;
const RIVER_N = 240;

const COL = {
    ship: "#e9f3ff", flame: "#ffb257", flameCore: "#fff3d6",
    cyan: "#8fd4ff", gold: "#ffc94d", good: "#4fe0a8", danger: "#ff5f6b", magenta: "#ff7ad9",
    muted: "rgba(160,184,210,0.75)"
};

class MapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.W = 1; this.H = 1; this.dpr = 1;
        this.viewR = 10; this.userZoom = 1; this.cx = 0; this.cy = 0; this.scale = 1;
        this.trail = new Float32Array(3 * TRAIL_MAX); this.trailN = 0; this.trailHead = 0; this.trailTick = 0;
        this.river = null; this.disc = null; this.bgStars = null; this.land = null;
        this.path = null; this.pathBuf = new Float32Array(2 * 900); this.pathTick = 0;
        this.t = 0;
        this.resize();
    }

    resize() {
        const c = this.canvas, box = c.parentElement.getBoundingClientRect();
        this.dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
        this.W = Math.max(50, Math.round(box.width)); this.H = Math.max(50, Math.round(box.height));
        c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr);
        this.paintBackdrop();
    }

    /* The backdrop never changes, so it is painted once per resize and handed
     * to the compositor as the container's CSS background. Repainting a
     * full-screen gradient sixty times a second was the single biggest cost
     * in the frame. */
    paintBackdrop() {
        const W = this.W, H = this.H, off = document.createElement("canvas");
        off.width = W; off.height = H;
        const ctx = off.getContext("2d"), rnd = skyRng(7);
        const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
        bg.addColorStop(0, "#0a1322"); bg.addColorStop(1, "#03060c");
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        const n = Math.round(W * H / 5200);
        ctx.fillStyle = "#cfe3ff";
        for (let i = 0; i < n; i++) {
            const x = rnd() * W, y = rnd() * H, s = 0.3 + 1.1 * Math.pow(rnd(), 3);
            ctx.globalAlpha = 0.25 + 0.6 * rnd();
            ctx.fillRect(x, y, s, s);
        }
        const wrap = this.canvas.parentElement;
        try { wrap.style.backgroundImage = "url(" + off.toDataURL("image/png") + ")"; wrap.style.backgroundSize = "100% 100%"; }
        catch (e) { wrap.style.background = "#060b14"; }
    }

    /* A new flight: forget the old trail and re-seed everything that depends
     * on the mission's scale. */
    begin(sim) {
        this.trailN = 0; this.trailHead = 0; this.path = null; this.pathTick = 0;
        this.viewR = sim.cfg.viewR; this.userZoom = 1;
        this.cx = 0; this.cy = 0;
        const rnd = skyRng(99), R = sim.cfg.viewR * 1.6;
        this.river = [];
        for (let i = 0; i < RIVER_N; i++) this.river.push([R * Math.pow(rnd(), 2 / 3), 2 * Math.PI * rnd()]);
        this.disc = [];
        for (let i = 0; i < 640; i++) {
            const r = 3 + 9 * Math.pow(rnd(), 1.7);
            this.disc.push([r, 2 * Math.PI * rnd(), 0.6 + 0.6 * rnd(), keplerOmega(sim.world.rs || 1, r * (sim.world.rs || 1))]);
        }
        this.disc.sort(function (a, b) { return a[0] - b[0]; });        // so that neighbours share a colour
        this.land = [];
        for (let i = 0; i < 9; i++) this.land.push([2 * Math.PI * rnd(), 0.15 + 0.7 * rnd(), 0.12 + 0.2 * rnd(), rnd()]);
    }

    sx(x) { return this.W / 2 + (x - this.cx) * this.scale; }
    sy(y) { return this.H / 2 - (y - this.cy) * this.scale; }
    toWorld(px, py, out) {
        out[0] = this.cx + (px - this.W / 2) / this.scale;
        out[1] = this.cy - (py - this.H / 2) / this.scale;
        return out;
    }

    /* ---------------------------------------------------------- per frame */

    update(sim, dtReal, dT) {
        const cfg = sim.cfg, r = sim.d.r;
        /* Camera: pinned to the central mass, zooming so that the ship and a
         * margin around it stay in view — close in near the hole, where the
         * interesting rings are a few pixels apart, and out again as it leaves. */
        let want = cfg.viewR;
        if (cfg.zoomMin) want = Math.min(cfg.viewR, Math.max(cfg.zoomMin, r * 1.7));
        if (r * 1.12 > want) want = Math.min(cfg.viewR * 4, r * 1.12);
        const k = 1 - Math.exp(-dtReal * 2.2);
        this.viewR += (want - this.viewR) * k;
        this.scale = Math.min(this.W, this.H) / 2 / this.viewR * this.userZoom;

        // trail: one sample every few frames, tagged with the clock rate at the time
        if (sim.status === "flying" && ++this.trailTick >= 3) {
            this.trailTick = 0;
            const i = this.trailHead * 3;
            this.trail[i] = sim.ship.x; this.trail[i + 1] = sim.ship.y;
            this.trail[i + 2] = sim.d.inside ? 0 : (isFinite(sim.d.rate) ? sim.d.rate : 1);
            this.trailHead = (this.trailHead + 1) % TRAIL_MAX;
            if (this.trailN < TRAIL_MAX) this.trailN++;
        }

        // the river moves in rain time
        if (this.river && sim.world.rs > 0 && dT > 0) {
            const rs = sim.world.rs, R = this.viewR * 1.6;
            for (let i = 0; i < this.river.length; i++) {
                const p = this.river[i];
                let left = Math.min(dT, 40);
                while (left > 0) {                                  // dr/dT = −sqrt(rs/r), a few substeps is plenty
                    const h = Math.min(left, 0.25 * p[0] / Math.sqrt(rs / p[0]));
                    p[0] -= Math.sqrt(rs / p[0]) * h; left -= h;
                    if (p[0] < 0.12 * rs) { p[0] = R * (0.85 + 0.15 * Math.random()); p[1] = 2 * Math.PI * Math.random(); break; }
                }
                if (p[0] > R * 1.05) p[0] = R * Math.random();
            }
        }

        // free-fall preview, refreshed a few times a second (every frame under thrust)
        if (sim.overlays.predict && sim.status === "flying" && !sim.laser && !sim.hover) {
            if (--this.pathTick <= 0 || sim.throttle > 0) {
                this.pathTick = 4;
                const earth = cfg.units === "earth";
                this.path = predict(sim.world, sim.ship, {
                    buffer: this.pathBuf, maxPts: 900, eta: 0.05,
                    maxSweep: (earth ? 2.05 : 4.2) * Math.PI, rFar: cfg.viewR * 5
                });
            }
        } else this.path = null;
    }

    draw(sim, dtReal) {
        const ctx = this.ctx, W = this.W, H = this.H;
        this.t += dtReal;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        const o = sim.overlays, hole = sim.world.rs > 0 && !sim.world.R;
        if (hole && o.contours) this.drawContours(sim);
        if (hole && o.disc) this.drawDisc(sim);
        if (hole) this.drawHole(sim, o.rings);
        if (sim.world.R) this.drawPlanet(sim);
        if (hole && o.river) this.drawRiver(sim);
        if (sim.cfg.band) this.drawBand(sim.cfg.band);
        if (sim.cfg.places) this.drawPlaces(sim);
        if (sim.cfg.orbiters) this.drawOrbiters(sim);
        if (sim.station) this.drawStation(sim);
        if (o.pulses && sim.pulses.length) this.drawPulses(sim);
        if (sim.laser) this.drawLaser(sim);
        if (sim.cfg.depth) this.drawDepth(sim);
        if (this.path) this.drawPath(sim);
        this.drawTrail();
        if (hole && o.cone && !sim.laser) this.drawCone(sim);
        this.drawShip(sim);
        this.drawScale(sim);
    }

    /* ---------------------------------------------------------- the hole */

    ring(r, color, width, dash) {
        const ctx = this.ctx;
        ctx.beginPath(); ctx.arc(this.sx(0), this.sy(0), r * this.scale, 0, 2 * Math.PI);
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
    }

    ringLabel(r, angle, text, color) {
        const ctx = this.ctx, R = r * this.scale;
        if (R < 42) return;
        const x = this.sx(0) + R * Math.cos(angle), y = this.sy(0) - R * Math.sin(angle);
        ctx.font = "10.5px 'Segoe UI', system-ui, sans-serif";
        const w = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(4,8,14,0.78)"; ctx.fillRect(x - w / 2 - 4, y - 7, w + 8, 14);
        ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + 0.5);
    }

    drawHole(sim, rings) {
        const ctx = this.ctx, x = this.sx(0), y = this.sy(0), R = this.scale * sim.world.rs;
        /* A soft glow so the hole reads as the centre of things even when it
         * is a few pixels across. It is sized in pixels as well as in rs:
         * zoomed right in, a glow 4.5 rs wide is the whole screen, and a
         * screen-filling orange wash just looks like a dirty backdrop. */
        const G = Math.min(R * 4.5, R + 150);
        const gl = ctx.createRadialGradient(x, y, R, x, y, G);
        gl.addColorStop(0, "rgba(255,160,70,0.20)"); gl.addColorStop(1, "rgba(255,160,70,0)");
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, G, 0, 2 * Math.PI); ctx.fill();
        // the horizon: not a surface, so it is drawn as a region, and the ship stays visible inside it
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, "#000"); g.addColorStop(0.8, "#020204"); g.addColorStop(1, "#0b0710");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, R), 0, 2 * Math.PI); ctx.fill();
        ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(255,190,120,0.95)"; ctx.stroke();
        if (sim.d.inside) {
            ctx.fillStyle = COL.magenta; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 2 * Math.PI); ctx.fill();
        }
        if (!rings) return;
        this.ring(1.5 * sim.world.rs, "rgba(255,201,77,0.55)", 1, [3, 4]);
        this.ring(3 * sim.world.rs, "rgba(79,224,168,0.5)", 1, [7, 5]);
        /* Labels are fanned out round the clock so that three rings a few
         * pixels apart do not print on top of each other. */
        this.ringLabel(sim.world.rs, Math.PI / 2, "event horizon", "rgba(255,190,120,0.95)");
        this.ringLabel(1.5 * sim.world.rs, 2.45, "photon sphere · 1.5", COL.gold);
        this.ringLabel(3 * sim.world.rs, 0.7, "last stable orbit · 3", COL.good);
    }

    drawContours(sim) {
        const rates = [0.95, 0.9, 0.8, 0.7, 0.5, 0.3];
        for (let i = 0; i < rates.length; i++) {
            const q = rates[i], r = sim.world.rs / (1 - q * q);
            this.ring(r, "rgba(143,212,255," + (0.13 + 0.22 * (1 - q)) + ")", 1);
            this.ringLabel(r, -0.25 - 0.3 * i, "clocks " + Math.round(q * 100) + "%", "rgba(143,212,255,0.85)");
        }
    }

    /* Gas in circular orbits, driven by far time — so it visibly speeds up as
     * the pilot's clock slows — and with nothing inside 3 rs, because nothing
     * can orbit there. */
    drawDisc(sim) {
        const ctx = this.ctx, t = sim.ship.farLost ? this.t * 40 : sim.tFar, rs = sim.world.rs;
        const x0 = this.sx(0), y0 = this.sy(0), rIn = 3 * rs * this.scale, rOut = Math.min(12 * rs * this.scale, rIn + 260);
        const glow = ctx.createRadialGradient(x0, y0, rIn, x0, y0, rOut);
        glow.addColorStop(0, "rgba(255,190,110,0.15)"); glow.addColorStop(0.1, "rgba(255,150,80,0.07)");
        glow.addColorStop(0.4, "rgba(255,130,60,0.018)"); glow.addColorStop(1, "rgba(255,120,60,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x0, y0, rOut, 0, 2 * Math.PI); ctx.arc(x0, y0, rIn, 0, 2 * Math.PI, true); ctx.fill();
        if (!this.discStyles) {
            this.discStyles = [];
            for (let k = 0; k < 8; k++) {
                const heat = k / 7;
                this.discStyles.push("rgba(255," + Math.round(120 + 110 * heat) + "," + Math.round(60 + 150 * heat * heat) + "," + (0.12 + 0.3 * heat).toFixed(2) + ")");
            }
        }
        let style = -1;
        for (let i = 0; i < this.disc.length; i++) {
            const p = this.disc[i], r = p[0] * rs, a = p[1] + p[3] * t;
            const heat = Math.max(0, 1 - (p[0] - 3) / 9), k = Math.round(7 * heat);
            if (k !== style) { ctx.fillStyle = this.discStyles[k]; style = k; }
            const s = (1.2 + 1.3 * heat) * p[2];
            ctx.fillRect(this.sx(r * Math.cos(a)) - s / 2, this.sy(r * Math.sin(a)) - s / 2, s, s);
        }
    }

    drawRiver(sim) {
        const ctx = this.ctx, rs = sim.world.rs;
        ctx.lineWidth = 1.2; ctx.lineCap = "round";
        for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = pass ? "rgba(255,122,217,0.6)" : "rgba(130,190,255,0.32)";
            ctx.beginPath();
            for (let i = 0; i < this.river.length; i++) {
                const p = this.river[i], inside = p[0] < rs;
                if (inside !== !!pass) continue;
                const beta = Math.sqrt(rs / p[0]);
                const len = Math.min(26, 5 + 14 * beta) / this.scale;
                const c = Math.cos(p[1]), s = Math.sin(p[1]);
                ctx.moveTo(this.sx(p[0] * c), this.sy(p[0] * s));
                ctx.lineTo(this.sx((p[0] + len) * c), this.sy((p[0] + len) * s));
            }
            ctx.stroke();
        }
    }

    /* ---------------------------------------------------------- places */

    drawPlanet(sim) {
        const ctx = this.ctx, x = this.sx(0), y = this.sy(0), R = this.scale;      // planet radius is the length unit
        const atm = ctx.createRadialGradient(x, y, R * 0.98, x, y, R * 1.09);
        atm.addColorStop(0, "rgba(120,190,255,0.55)"); atm.addColorStop(1, "rgba(120,190,255,0)");
        ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(x, y, R * 1.09, 0, 2 * Math.PI); ctx.fill();
        const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.35, R * 0.1, x, y, R);
        g.addColorStop(0, "#3f8ad8"); g.addColorStop(0.7, "#1b4f93"); g.addColorStop(1, "#0b2347");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, 2 * Math.PI); ctx.fill();
        ctx.save(); ctx.clip();
        const spin = 2 * Math.PI * sim.tFar * sim.unitS / 86164;
        for (let i = 0; i < this.land.length; i++) {
            const l = this.land[i], a = l[0] + spin;
            ctx.fillStyle = l[3] > 0.5 ? "rgba(86,150,92,0.85)" : "rgba(134,150,96,0.8)";
            ctx.beginPath();
            ctx.ellipse(x + R * l[1] * Math.cos(a), y - R * l[1] * Math.sin(a), R * l[2], R * l[2] * 0.6, -a, 0, 2 * Math.PI);
            ctx.fill();
        }
        const sh = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
        sh.addColorStop(0.45, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,10,0.62)");
        ctx.fillStyle = sh; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
        ctx.restore();
    }

    drawBand(b) {
        const ctx = this.ctx, x = this.sx(0), y = this.sy(0);
        ctx.beginPath();
        ctx.arc(x, y, b.r1 * this.scale, 0, 2 * Math.PI);
        ctx.arc(x, y, b.r0 * this.scale, 0, 2 * Math.PI, true);
        ctx.fillStyle = "rgba(79,224,168,0.09)"; ctx.fill();
        this.ring(b.r0, "rgba(79,224,168,0.45)", 1, [4, 5]);
        this.ring(b.r1, "rgba(79,224,168,0.45)", 1, [4, 5]);
        this.ringLabel(0.5 * (b.r0 + b.r1), -2.5, b.label, COL.good);
    }

    drawDepth(sim) {
        if (!sim.marks.dropped) this.ring(sim.cfg.depth, "rgba(255,201,77,0.8)", 1.2, [2, 5]);
        else this.ring(sim.cfg.exit, "rgba(79,224,168,0.7)", 1.2, [2, 5]);
        this.ringLabel(sim.marks.dropped ? sim.cfg.exit : sim.cfg.depth, Math.PI, sim.marks.dropped ? "get past here" : "release below here", sim.marks.dropped ? COL.good : COL.gold);
    }

    drawPlaces(sim) {
        const ctx = this.ctx, target = sim.marks.target;
        for (let i = 0; i < sim.cfg.places.length; i++) {
            const p = sim.cfg.places[i], x = this.sx(p.x), y = this.sy(p.y);
            const col = p.kind === "sun" ? "255,226,150" : "255,140,100";
            const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
            g.addColorStop(0, "rgba(" + col + ",0.95)"); g.addColorStop(0.18, "rgba(" + col + ",0.5)"); g.addColorStop(1, "rgba(" + col + ",0)");
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 26, 0, 2 * Math.PI); ctx.fill();
            ctx.beginPath(); ctx.arc(x, y, p.r * this.scale, 0, 2 * Math.PI);
            ctx.strokeStyle = target === p ? "rgba(79,224,168,0.9)" : "rgba(160,184,210,0.35)";
            ctx.lineWidth = target === p ? 1.6 : 1; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = "#d7e3f0"; ctx.font = "12px 'Segoe UI', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
            ctx.fillText(p.name, x, y + p.r * this.scale + 6);
        }
    }

    drawOrbiters(sim) {
        const ctx = this.ctx, t = sim.ship.farLost ? 0 : sim.tFar;
        for (let i = 0; i < sim.cfg.orbiters.length; i++) {
            const ob = sim.cfg.orbiters[i], a = ob.phase + keplerOmega(sim.world.rs, ob.r) * t;
            const x = this.sx(ob.r * Math.cos(a)), y = this.sy(ob.r * Math.sin(a));
            this.ring(ob.r, "rgba(160,184,210,0.10)", 1);
            ctx.fillStyle = "#b9c9dc"; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 2 * Math.PI); ctx.fill();
        }
    }

    drawStation(sim) {
        const ctx = this.ctx, p = [0, 0];
        sim.stationPos(p);
        const x = this.sx(p[0]), y = this.sy(p[1]);
        const clock = sim.ship.farLost ? this.t * 50 : sim.baseClock;
        ctx.beginPath(); ctx.arc(x, y, sim.station.zone * this.scale, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(79,224,168,0.55)"; ctx.lineWidth = 1; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
        ctx.save(); ctx.translate(x, y); ctx.rotate(clock * 0.35);
        ctx.strokeStyle = "#cfe0f2"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, 2 * Math.PI); ctx.stroke();
        for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(2.5, 0); ctx.lineTo(8, 0); ctx.stroke(); }
        ctx.restore();
        // beacon: blinks once per unit of the STATION's own time
        if ((clock % 1 + 1) % 1 < 0.22) { ctx.fillStyle = COL.good; ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill(); }
        ctx.fillStyle = "#d7e3f0"; ctx.font = "11px 'Segoe UI', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(sim.station.name, x, y + 13);
    }

    /* ---------------------------------------------------------- light */

    drawPulses(sim) {
        const ctx = this.ctx, life = sim.cfg.pulseLife || 120;
        ctx.lineWidth = 1.1;
        for (let i = 0; i < sim.pulses.length; i++) {
            const p = sim.pulses[i], rays = p.rays, n = rays.length;
            ctx.strokeStyle = "rgba(255,226,150," + Math.max(0.06, 0.55 * (1 - p.age / life)) + ")";
            ctx.beginPath();
            /* The front is sampled by a ring of photons. Each stretch is drawn
             * as a curve from midpoint to midpoint with the photon between as
             * its control point, which keeps a big front round instead of
             * polygonal. Where neighbours have been torn apart — one went into
             * the hole, or they passed either side of it — the front really is
             * broken there, and no chord is drawn across the gap. */
            const limit = 0.3 * p.age + 0.35;
            let open = false;
            for (let j = 0; j <= n; j++) {
                const a = rays[(j + n - 1) % n], b = rays[j % n], c = rays[(j + 1) % n];
                const ok = a.live && b.live && c.live &&
                    Math.hypot(a.x - b.x, a.y - b.y) < limit && Math.hypot(c.x - b.x, c.y - b.y) < limit;
                if (!ok) { open = false; continue; }
                const mx0 = 0.5 * (a.x + b.x), my0 = 0.5 * (a.y + b.y), mx1 = 0.5 * (b.x + c.x), my1 = 0.5 * (b.y + c.y);
                if (!open) { ctx.moveTo(this.sx(mx0), this.sy(my0)); open = true; }
                ctx.quadraticCurveTo(this.sx(b.x), this.sy(b.y), this.sx(mx1), this.sy(my1));
            }
            ctx.stroke();
        }
    }

    drawLaser(sim) {
        const ctx = this.ctx, L = sim.laser, s = sim.ship;
        for (let i = 0; i < L.targets.length; i++) {
            const t = L.targets[i];
            if (t.self) continue;
            const x = this.sx(t.x), y = this.sy(t.y), hit = !!L.hits[t.id];
            ctx.beginPath(); ctx.arc(x, y, t.r * this.scale, 0, 2 * Math.PI);
            ctx.fillStyle = hit ? "rgba(79,224,168,0.25)" : "rgba(255,201,77,0.10)"; ctx.fill();
            ctx.strokeStyle = hit ? COL.good : COL.gold; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = "#d7e3f0"; ctx.font = "11px 'Segoe UI', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
            ctx.fillText(t.name + (hit ? " ✓" : ""), x, y + t.r * this.scale + 5);
        }
        for (let i = 0; i < L.beams.length; i++) {
            const b = L.beams[i], last = i === L.beams.length - 1, pts = b.pts;
            ctx.beginPath(); ctx.moveTo(this.sx(pts[0]), this.sy(pts[1]));
            for (let j = 2; j < pts.length; j += 2) ctx.lineTo(this.sx(pts[j]), this.sy(pts[j + 1]));
            ctx.strokeStyle = b.fate === "hit" ? "rgba(79,224,168,0.9)" : b.fate === "swallowed" ? "rgba(255,95,107," + (last ? 0.8 : 0.3) + ")"
                : "rgba(255,226,150," + (b.live || last ? 0.95 : 0.28) + ")";
            ctx.lineWidth = b.live || last ? 1.8 : 1; ctx.stroke();
            if (b.live) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(this.sx(b.p.x), this.sy(b.p.y), 2.6, 0, 2 * Math.PI); ctx.fill(); }
        }
        // aim: the first stretch of the ray that WOULD be fired, itself a real photon path
        const q = photonFromHoverer(sim.world.rs, s.x, s.y, L.aim);
        ctx.beginPath(); ctx.moveTo(this.sx(q.x), this.sy(q.y));
        for (let i = 0; i < 12; i++) { advancePhoton(sim.world.rs, q, 0.3); ctx.lineTo(this.sx(q.x), this.sy(q.y)); }
        ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([]);
    }

    /* ---------------------------------------------------------- the ship */

    drawPath(sim) {
        const ctx = this.ctx, p = this.path, pts = p.pts, n = p.n;
        if (n < 2) return;
        const bad = p.status === "plunge" || p.status === "crash";
        ctx.beginPath(); ctx.moveTo(this.sx(pts[0]), this.sy(pts[1]));
        for (let i = 1; i < n; i++) ctx.lineTo(this.sx(pts[2 * i]), this.sy(pts[2 * i + 1]));
        ctx.strokeStyle = bad ? "rgba(255,95,107,0.85)" : "rgba(143,212,255,0.6)";
        ctx.lineWidth = 1.3; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
        const earth = sim.cfg.units === "earth";
        const tag = (i, name, r) => {
            const x = this.sx(pts[2 * i]), y = this.sy(pts[2 * i + 1]);
            ctx.fillStyle = bad ? COL.danger : COL.cyan; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 2 * Math.PI); ctx.fill();
            ctx.font = "10.5px 'Segoe UI', system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
            ctx.fillText(name + " " + (earth ? fmtNum((r - 1) * 6371, 0) + " km" : r.toFixed(2) + " rs"), x + 6, y);
        };
        if (!bad && p.iMin > 2 && p.iMin < n - 2) tag(p.iMin, "low", p.rMin);
        if (p.iMax > 2 && p.iMax < n - 2) tag(p.iMax, "high", p.rMax);
    }

    drawTrail() {
        const ctx = this.ctx, n = this.trailN;
        if (n < 2) return;
        ctx.lineWidth = 1.6; ctx.lineCap = "round";
        const start = (this.trailHead - n + TRAIL_MAX) % TRAIL_MAX;
        /* Colour is the clock rate when that stretch was flown: cool where
         * ship time ran at the far rate, hot where it crawled. Both colour and
         * fade are quantised, so that a long run of similar segments is one
         * path and one stroke rather than seven hundred. */
        let px = 0, py = 0, key = -1, open = false;
        for (let k = 0; k < n; k++) {
            const i = ((start + k) % TRAIL_MAX) * 3;
            const x = this.sx(this.trail[i]), y = this.sy(this.trail[i + 1]);
            if (k > 0) {
                const q = Math.round(12 * this.trail[i + 2]) / 12, a = Math.ceil(10 * k / n) / 10;
                const kk = q * 100 + a;
                if (kk !== key) {
                    if (open) ctx.stroke();
                    const rr = Math.round(143 + (255 - 143) * (1 - q)), gg = Math.round(212 - 100 * (1 - q)), bb = Math.round(255 - 170 * (1 - q));
                    ctx.strokeStyle = "rgba(" + rr + "," + gg + "," + bb + "," + (0.75 * a).toFixed(2) + ")";
                    ctx.beginPath(); ctx.moveTo(px, py); key = kk; open = true;
                }
                ctx.lineTo(x, y);
            }
            px = x; py = y;
        }
        if (open) ctx.stroke();
    }

    /* The spatial cross-section of the ship's future light cone, a moment on:
     * a circle of light expanding at c whose centre has been carried inward by
     * the river. Every possible future position of the ship lies inside it. */
    drawCone(sim) {
        const ctx = this.ctx, s = sim.ship, d = sim.d, rho = 44;
        const x = this.sx(s.x), y = this.sy(s.y);
        const cx = x - d.beta * rho * (s.x / d.r), cy = y + d.beta * rho * (s.y / d.r);
        ctx.beginPath(); ctx.arc(cx, cy, rho, 0, 2 * Math.PI);
        ctx.fillStyle = d.inside ? "rgba(255,122,217,0.10)" : "rgba(255,226,150,0.08)"; ctx.fill();
        ctx.strokeStyle = d.inside ? "rgba(255,122,217,0.8)" : "rgba(255,226,150,0.6)"; ctx.lineWidth = 1.1; ctx.stroke();
    }

    drawShip(sim) {
        const ctx = this.ctx, s = sim.ship, d = sim.d;
        const x = this.sx(s.x), y = this.sy(s.y);
        const off = x < -20 || y < -20 || x > this.W + 20 || y > this.H + 20;
        if (off) { this.drawArrow(x, y); return; }
        ctx.save(); ctx.translate(x, y);
        // tides: stretched along the line to the hole, squeezed across it
        if (sim.tideLimit) {
            const k = Math.min(1.6, 1.3 * sim.tideG() / sim.tideLimit);
            if (k > 0.02) { const a = -Math.atan2(s.y, s.x); ctx.rotate(a); ctx.scale(1 + k, 1 / Math.sqrt(1 + k)); ctx.rotate(-a); }
        }
        if (sim.status === "lost") { ctx.restore(); this.drawWreck(x, y); return; }
        ctx.rotate(-sim.heading);
        const thr = sim.throttle;
        if (thr > 1e-4) {
            const rev = (sim.thrustX * Math.cos(sim.heading) + sim.thrustY * Math.sin(sim.heading)) < 0 && !sim.hover;
            const len = (7 + 24 * Math.sqrt(thr)) * (0.85 + 0.3 * Math.random());
            const dir = rev ? 1 : -1, base = rev ? 9 : -7;
            const g = ctx.createLinearGradient(base, 0, base + dir * len, 0);
            g.addColorStop(0, COL.flameCore); g.addColorStop(0.35, COL.flame); g.addColorStop(1, "rgba(255,120,40,0)");
            ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(base, -3.2); ctx.lineTo(base + dir * len, 0); ctx.lineTo(base, 3.2); ctx.closePath(); ctx.fill();
        }
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, 6.5); ctx.lineTo(-4.5, 0); ctx.lineTo(-8, -6.5); ctx.closePath();
        ctx.fillStyle = COL.ship; ctx.fill(); ctx.strokeStyle = "rgba(10,20,34,0.9)"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#35b6ff"; ctx.beginPath(); ctx.arc(3, 0, 1.9, 0, 2 * Math.PI); ctx.fill();
        ctx.restore();
        // which way is "forwards along the orbit": the thing the Z and X keys point at
        const p = [0, 0];
        if (!sim.laser && sim.prograde(p) && (d.vRiver > 1e-9 || d.beta > 0)) {
            const R = 26;
            ctx.strokeStyle = "rgba(79,224,168,0.8)"; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.arc(x + R * p[0], y - R * p[1], 3, 0, 2 * Math.PI); ctx.stroke();
        }
    }

    drawWreck(x, y) {
        const ctx = this.ctx;
        for (let i = 0; i < 9; i++) {
            const a = i * 0.7 + this.t * 0.4, r = 5 + 3.5 * i * Math.min(1, 0.3 + this.t % 4 / 3);
            ctx.fillStyle = i % 2 ? COL.flame : COL.danger;
            ctx.fillRect(x + r * Math.cos(a), y + r * Math.sin(a), 2, 2);
        }
    }

    drawArrow(x, y) {
        const ctx = this.ctx, m = 22;
        const ex = Math.max(m, Math.min(this.W - m, x)), ey = Math.max(m, Math.min(this.H - m, y));
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(Math.atan2(y - ey, x - ex));
        ctx.fillStyle = COL.cyan; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, 6); ctx.lineTo(-6, -6); ctx.closePath(); ctx.fill();
        ctx.restore();
    }

    drawScale(sim) {
        const ctx = this.ctx, cfg = sim.cfg;
        const px = 90, world = px / this.scale;
        const nice = niceStep(world), len = nice * this.scale;
        const x = 14, y = 52;               // top-left, under the read-out: the bottom corners belong to thumbs on a phone
        ctx.strokeStyle = COL.muted; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 4); ctx.stroke();
        let text;
        if (cfg.units === "earth") text = fmtNum(nice * 6371, 0) + " km";
        else if (cfg.units === "ly") text = nice + " light-year" + (nice === 1 ? "" : "s");
        else text = nice + " rs  =  " + bigLength(nice * sim.unitM);
        ctx.fillStyle = COL.muted; ctx.font = "10.5px 'Segoe UI', system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(text, x + 2, y - 6);
    }
}

function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

function bigLength(m) {
    const km = m / 1000;
    if (km < 1e4) return fmtNum(km, km < 100 ? 1 : 0) + " km";
    if (km < 1e7) return fmtNum(km / 1e6, 2) + " million km";
    const au = m / 1.495978707e11;
    if (au < 2000) return fmtNum(au, au < 10 ? 2 : 0) + " AU";
    return fmtNum(m / 9.4607e15 * 365.25, 1) + " light-days";
}

if (typeof module !== "undefined") module.exports = { MapRenderer, niceStep, bigLength };
