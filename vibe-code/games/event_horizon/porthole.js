/* porthole.js — the round window: what the pilot sees.
 *
 * sky.js says where every star's light arrives from, for an observer drifting
 * with the river at the ship's radius. This file adds the ship's own motion
 * (aberration and Doppler shift, exactly as in special relativity), picks a
 * direction to look in, and paints the result through a fisheye lens.
 *
 * Three things to watch for:
 *   • near a hole, the black disc of the shadow, with the star field visibly
 *     squeezed and doubled around its edge (every star behind the hole has a
 *     second, fainter image on the opposite side);
 *   • hovering deep in a well, the whole sky blue-shifts and brightens, because
 *     the outside universe really is running fast as seen from there;
 *   • at high speed, with no gravity at all, the stars crowd towards the
 *     direction of travel and turn blue, and the sky behind empties and reddens.
 */
"use strict";

const PORT_FOV = 100 * Math.PI / 180;       // half-angle of the fisheye: 200° across

class Porthole {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.stars = makeStars(1150, 650);
        this.map = null; this.mapR = 0; this.mapRs = -1;
        this.img = new Float64Array(10);
        this.tmp = [0, 0, 0];
        this.size = 0;
        this.info = { shadowDeg: 0, mode: "" };
    }

    resize() {
        const c = this.canvas, box = c.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const px = Math.max(40, Math.round(Math.min(box.width, box.height)));
        if (px === this.size && c.width === Math.round(px * dpr)) return;
        this.size = px; this.dpr = dpr;
        c.width = c.height = Math.round(px * dpr);
    }

    draw(sim) {
        this.resize();
        const ctx = this.ctx, S = this.size, R = S / 2 - 2, cx = S / 2, cy = S / 2;
        const s = sim.ship, d = sim.d, rs = sim.world.rs, mode = sim.cfg.cockpit;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, S, S);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
        ctx.fillStyle = "#02040a"; ctx.fillRect(0, 0, S, S);

        // the ray table is only rebuilt when the ship has actually moved in radius
        if (!this.map || rs !== this.mapRs || Math.abs(d.r - this.mapR) > 0.003 * d.r) {
            this.map = skyMap(rs, d.r, 150); this.mapR = d.r; this.mapRs = rs;
        }
        const m = this.map;
        const nx = s.x / d.r, ny = s.y / d.r;
        // the ship's velocity through the river
        const vx = s.wx / d.gamma, vy = s.wy / d.gamma;

        /* Where to look. Towards the hole (or planet) the axis is the hole's
         * direction as the moving pilot sees it, so the shadow stays centred;
         * in open space it is simply the way the nose points. */
        let ax, ay;
        if (mode === "heading") { ax = Math.cos(sim.heading); ay = Math.sin(sim.heading); }
        else { aberrate(-nx, -ny, 0, vx, vy, this.tmp); ax = this.tmp[0]; ay = this.tmp[1]; const q = Math.hypot(ax, ay) || 1; ax /= q; ay /= q; }
        const rx = ay, ry = -ax;                                   // screen-right = axis × up

        const proj = (dx, dy, dz, out) => {
            const c = Math.max(-1, Math.min(1, dx * ax + dy * ay));
            const th = Math.acos(c);
            const px = dx * rx + dy * ry, py = dz, q = Math.hypot(px, py) || 1;
            const rad = th / PORT_FOV * R;
            out[0] = cx + rad * px / q; out[1] = cy - rad * py / q; out[2] = th;
        };

        const img = this.img, o = [0, 0, 0], v = this.tmp;
        for (let i = 0; i < this.stars.length; i++) {
            const st = this.stars[i];
            const n = skyImages(m, nx, ny, st.x, st.y, st.z, img);
            for (let k = 0; k < n; k++) {
                const b = 5 * k;
                const dop = aberrate(img[b], img[b + 1], img[b + 2], vx, vy, v);
                proj(v[0], v[1], v[2], o);
                if (o[2] > PORT_FOV) continue;
                const shift = img[b + 4] * dop;
                /* Apparent brightness: lensing magnification, times the usual
                 * relativistic beaming — a blue-shifted source is also a
                 * brighter one. Clamped; this is a window, not a photometer. */
                let lum = st.mag * Math.min(12, img[b + 3]) * Math.min(14, Math.pow(shift, 2.2));
                if (lum < 0.012) continue;
                const t = Math.max(-1, Math.min(1, Math.log2(shift) / 1.6));
                const c0 = st.tint;
                const cr = t > 0 ? c0[0] + (150 - c0[0]) * t : c0[0] + (255 - c0[0]) * -t;
                const cg = t > 0 ? c0[1] + (185 - c0[1]) * t : c0[1] + (110 - c0[1]) * -t;
                const cb = t > 0 ? c0[2] + (255 - c0[2]) * t : c0[2] + (70 - c0[2]) * -t;
                const size = 0.7 + 1.5 * Math.min(1.6, Math.sqrt(lum));
                ctx.globalAlpha = Math.min(1, 0.25 + lum);
                ctx.fillStyle = "rgb(" + (cr | 0) + "," + (cg | 0) + "," + (cb | 0) + ")";
                if (size < 1.5) ctx.fillRect(o[0] - size / 2, o[1] - size / 2, size, size);
                else { ctx.beginPath(); ctx.arc(o[0], o[1], size / 2, 0, 2 * Math.PI); ctx.fill(); }
            }
        }
        ctx.globalAlpha = 1;

        // the shadow — or, around a planet, the planet
        this.info.shadowDeg = 0;
        const blocker = sim.world.R ? Math.asin(Math.min(1, 1 / d.r)) : (m.flat ? 0 : m.shadow);
        if (blocker > 0 && mode !== "heading") {
            ctx.beginPath();
            const N = 72;
            for (let i = 0; i <= N; i++) {
                const chi = 2 * Math.PI * i / N, ca = Math.cos(blocker), sa = Math.sin(blocker);
                // a cone of half-angle `blocker` around the inward direction; (t, z) span the plane across it
                const dx = -ca * nx + sa * Math.cos(chi) * -ny, dy = -ca * ny + sa * Math.cos(chi) * nx, dz = sa * Math.sin(chi);
                aberrate(dx, dy, dz, vx, vy, v);
                proj(v[0], v[1], v[2], o);
                if (i === 0) ctx.moveTo(o[0], o[1]); else ctx.lineTo(o[0], o[1]);
            }
            ctx.closePath();
            if (sim.world.R) {
                const g = ctx.createRadialGradient(cx - R * 0.15, cy - R * 0.15, 2, cx, cy, R);
                g.addColorStop(0, "#3f8ad8"); g.addColorStop(1, "#0d2c5c");
                ctx.fillStyle = g; ctx.fill();
                ctx.strokeStyle = "rgba(140,200,255,0.8)"; ctx.lineWidth = 2; ctx.stroke();
            } else {
                ctx.fillStyle = "#000"; ctx.fill();
                ctx.strokeStyle = "rgba(255,190,120,0.55)"; ctx.lineWidth = 1; ctx.stroke();
            }
            this.info.shadowDeg = 2 * blocker * 180 / Math.PI;
        }
        ctx.restore();

        // the frame
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(143,212,255,0.55)"; ctx.lineWidth = 2; ctx.stroke();
        // a faint cross-hair at 90° from the axis: everything outside it is BEHIND the pilot
        ctx.beginPath(); ctx.arc(cx, cy, R * (Math.PI / 2) / PORT_FOV, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(143,212,255,0.13)"; ctx.lineWidth = 1; ctx.setLineDash([2, 5]); ctx.stroke(); ctx.setLineDash([]);
        this.info.mode = mode;
    }
}

if (typeof module !== "undefined") module.exports = { Porthole, PORT_FOV };
