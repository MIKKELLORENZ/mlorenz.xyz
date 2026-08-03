/* render.js — the top-down view, the drift chart, the fitness chart and the
 * little picture of what the network sees.
 *
 * ===================== THE ONE THING THIS VIEW MUST DO =====================
 * Never leave any doubt about which body is REAL and which is the network's
 * guess. Everything else is decoration. So the two are separated on four
 * independent visual channels at once, not one:
 *
 *   REAL       lit, shaded, solid body   ·  solid trail   ·  cool palette
 *   PREDICTED  hollow dashed ring        ·  dashed trail  ·  warm orange
 *
 * and a red hairline joins each pair, whose length IS the error being scored.
 * Colour alone would not be enough — it fails for a colour-blind reader and it
 * fails in a screenshot — so shape (filled vs hollow), stroke (solid vs dashed)
 * and a text label all carry the same message redundantly.
 *
 * The bodies are drawn as actual worlds rather than dots because the mass range
 * in one of these systems spans four orders of magnitude, and "the big one is
 * the star, the banded one is a gas giant, the grey lump is a rock" is
 * information the viewer needs and a uniform disc throws away.
 */
"use strict";

const COL = {
    truth: "#8fd4ff",
    pred: "#ffa53d",
    err: "#ff4d5e",
    grid: "rgba(120,160,210,0.09)",
    label: "rgba(174,201,230,0.62)"
};

/* ------------------------------------------------------- body appearance */

/* Classify a body by its share of the system's mass and hand back everything
 * needed to draw it. Thresholds are in units of the system's total mass, which
 * for these systems is dominated by the primary — so they read directly as
 * "fraction of a solar mass" and line up with the real objects they are named
 * after: Jupiter 9.5e-4, Saturn 2.9e-4, Neptune 5.1e-5, Earth 3.0e-6,
 * Mars 3.2e-7. */
function bodyStyle(mFrac, idx) {
    if (mFrac > 0.05) {
        return { kind: "star", name: "star", r: 15, base: "#ffd884", glow: "#ff9d2e" };
    }
    if (mFrac > 1.5e-4) {
        return {
            kind: "gas", name: "gas giant", r: 11.0, base: "#e3b978",
            band: "rgba(150,98,44,0.55)", band2: "rgba(255,226,178,0.35)", bands: 4
        };
    }
    if (mFrac > 1.5e-5) {
        return {
            kind: "ice", name: "ice giant", r: 8.6, base: "#79c6e8",
            band: "rgba(40,110,150,0.45)", band2: "rgba(200,240,255,0.25)", bands: 3
        };
    }
    if (mFrac > 1e-6) {
        // Two flavours of terrestrial world so a system does not read as a row
        // of identical blue dots. Picked from the index, so it is stable for a
        // given body across every frame of a rollout.
        return (idx * 2654435761 >>> 0) % 2
            ? { kind: "ocean", name: "ocean world", r: 6.4, base: "#4f92d8", blotch: "#5fae72" }
            : { kind: "desert", name: "desert world", r: 6.0, base: "#c8724a", blotch: "#8d4a2e" };
    }
    return { kind: "rock", name: "planetoid", r: 4.3, base: "#a09587", blotch: "#6f665c" };
}

/* A deterministic irregular outline for the small rocky bodies — a perfect
 * circle at this size reads as a UI dot, a lumpy one reads as a rock. */
function rockPath(ctx, x, y, r, seed) {
    const n = 9;
    let a = (seed >>> 0) || 1;
    const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const th = (i / n) * 2 * Math.PI;
        const rr = r * (0.74 + 0.42 * rnd());
        const px = x + Math.cos(th) * rr, py = y + Math.sin(th) * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
}

/* Shade a body as a sphere lit from the star: a soft terminator across the
 * disc plus a darkened limb. Cheap, and it is most of what makes these read as
 * worlds rather than stickers. */
function shadeSphere(ctx, x, y, r, lx, ly) {
    const g = ctx.createLinearGradient(x - lx * r, y - ly * r, x + lx * r, y + ly * r);
    g.addColorStop(0, "rgba(255,244,214,0.30)");
    g.addColorStop(0.45, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,2,12,0.52)");
    ctx.fillStyle = g;
    ctx.fill();
    const lg = ctx.createRadialGradient(x, y, r * 0.45, x, y, r);
    lg.addColorStop(0, "rgba(0,0,0,0)");
    lg.addColorStop(1, "rgba(0,4,16,0.34)");
    ctx.fillStyle = lg;
    ctx.fill();
}

/* --------------------------------------------------------------- scene */

class SceneRenderer {
    constructor(canvas) {
        this.cv = canvas;
        this.ctx = canvas.getContext("2d");
        this.dpr = 1;
        this.trails = [];       // ground truth, per body
        this.predTrails = [];   // the network's rollout, per body
        this.trailMax = 300;
    }

    resize() {
        const r = this.cv.getBoundingClientRect();
        // Cap the device pixel ratio. On a high-DPI screen the honest ratio
        // quadruples the fill cost of a scene that is mostly flat colour, and
        // the frame budget here belongs to the physics.
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
        this.cv.width = Math.max(1, Math.round(r.width * this.dpr));
        this.cv.height = Math.max(1, Math.round(r.height * this.dpr));
        this.w = r.width; this.h = r.height;
    }

    resetTrails(n) {
        this.trails = Array.from({ length: n }, () => []);
        this.predTrails = Array.from({ length: n }, () => []);
    }

    pushTrail(truth, pred, n) {
        for (let i = 0; i < n; i++) {
            const tr = this.trails[i] || (this.trails[i] = []);
            tr.push([truth.x[i], truth.y[i]]);
            if (tr.length > this.trailMax) tr.shift();
            if (pred) {
                const pt = this.predTrails[i] || (this.predTrails[i] = []);
                pt.push([pred.x[i], pred.y[i]]);
                if (pt.length > this.trailMax) pt.shift();
            }
        }
    }

    /* view: {sys, truth, pred, showTrails, showError, showLabels} */
    draw(view) {
        const ctx = this.ctx;
        if (!this.w) this.resize();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.w, this.h);
        ctx.fillStyle = "#050a12";
        ctx.fillRect(0, 0, this.w, this.h);
        if (!view || !view.sys) return;

        const sys = view.sys;
        // The view scale is pinned to the system's INITIAL extent, not to
        // whatever the bodies are doing now. A camera that re-fit every frame
        // would zoom out as a diverging prediction flew away, hiding the very
        // failure the picture exists to show.
        const span = sys.ref.R0 * 1.3;
        const s = Math.min(this.w, this.h) / (2 * span);
        const cx = this.w / 2, cy = this.h / 2;
        const X = x => cx + x * s, Y = y => cy - y * s;

        this._grid(ctx, cx, cy, s, span);

        const truth = view.truth, pred = view.pred;
        const Mref = sys.ref.M;
        const styles = [];
        for (let i = 0; i < sys.n; i++) styles.push(bodyStyle(sys.m[i] / Mref, i));

        // Where the light comes from: the most massive body.
        let starIdx = 0;
        for (let i = 1; i < sys.n; i++) if (sys.m[i] > sys.m[starIdx]) starIdx = i;

        // ---- trails: real solid, predicted dashed ----
        if (view.showTrails) {
            ctx.lineWidth = 1.1;
            for (let i = 0; i < sys.n; i++) {
                const tr = this.trails[i];
                if (tr && tr.length > 1) {
                    ctx.setLineDash([]);
                    ctx.strokeStyle = "rgba(130,195,255,0.30)";
                    ctx.beginPath();
                    ctx.moveTo(X(tr[0][0]), Y(tr[0][1]));
                    for (let k = 1; k < tr.length; k++) ctx.lineTo(X(tr[k][0]), Y(tr[k][1]));
                    ctx.stroke();
                }
                const pt = pred ? this.predTrails[i] : null;
                if (pt && pt.length > 1) {
                    ctx.setLineDash([4, 4]);
                    ctx.strokeStyle = "rgba(255,165,61,0.42)";
                    ctx.beginPath();
                    ctx.moveTo(X(pt[0][0]), Y(pt[0][1]));
                    for (let k = 1; k < pt.length; k++) ctx.lineTo(X(pt[k][0]), Y(pt[k][1]));
                    ctx.stroke();
                }
            }
            ctx.setLineDash([]);
        }

        // ---- error hairlines ----
        if (pred && view.showError) {
            ctx.strokeStyle = COL.err;
            ctx.lineWidth = 1.3;
            ctx.setLineDash([]);
            ctx.beginPath();
            for (let i = 0; i < sys.n; i++) {
                ctx.moveTo(X(truth.x[i]), Y(truth.y[i]));
                ctx.lineTo(X(pred.x[i]), Y(pred.y[i]));
            }
            ctx.stroke();
        }

        // ---- the network's predicted bodies: hollow, dashed, warm ----
        if (pred) {
            ctx.setLineDash([3.5, 3]);
            ctx.strokeStyle = COL.pred;
            ctx.lineWidth = 1.7;
            for (let i = 0; i < sys.n; i++) {
                const r = styles[i].r + 2;
                ctx.beginPath();
                ctx.arc(X(pred.x[i]), Y(pred.y[i]), r, 0, 2 * Math.PI);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // ---- the real bodies ----
        for (let i = 0; i < sys.n; i++) {
            const st = styles[i];
            const x = X(truth.x[i]), y = Y(truth.y[i]);
            let lx = 0, ly = 0;
            if (i !== starIdx) {
                const dx = X(truth.x[starIdx]) - x, dy = Y(truth.y[starIdx]) - y;
                const d = Math.hypot(dx, dy) || 1;
                lx = dx / d; ly = dy / d;
            }
            this._body(ctx, x, y, st, lx, ly, i);
        }

        // ---- labels ----
        if (view.showLabels) {
            ctx.font = "10px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = COL.label;
            for (let i = 0; i < sys.n; i++) {
                ctx.fillText(styles[i].name, X(truth.x[i]), Y(truth.y[i]) + styles[i].r + 13);
            }
            ctx.textAlign = "start";
        }

        this._scaleBar(ctx, s, span);
    }

    _body(ctx, x, y, st, lx, ly, idx) {
        if (st.kind === "star") {
            const g = ctx.createRadialGradient(x, y, 0, x, y, st.r * 4.2);
            g.addColorStop(0, "rgba(255,238,180,0.95)");
            g.addColorStop(0.16, "rgba(255,190,90,0.55)");
            g.addColorStop(0.45, "rgba(255,150,50,0.18)");
            g.addColorStop(1, "rgba(255,140,40,0)");
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, st.r * 4.2, 0, 2 * Math.PI); ctx.fill();

            ctx.beginPath(); ctx.arc(x, y, st.r, 0, 2 * Math.PI);
            const core = ctx.createRadialGradient(x - st.r * 0.25, y - st.r * 0.25, st.r * 0.1, x, y, st.r);
            core.addColorStop(0, "#fffbe8");
            core.addColorStop(0.55, st.base);
            core.addColorStop(1, "#ff9f37");
            ctx.fillStyle = core; ctx.fill();
            return;
        }

        if (st.kind === "rock") {
            rockPath(ctx, x, y, st.r, idx * 7919 + 13);
            ctx.fillStyle = st.base; ctx.fill();
            shadeSphere(ctx, x, y, st.r, lx, ly);
            return;
        }

        // Everything else is a disc with some surface treatment, then shading.
        ctx.beginPath(); ctx.arc(x, y, st.r, 0, 2 * Math.PI);
        ctx.fillStyle = st.base; ctx.fill();
        ctx.save();
        ctx.clip();

        if (st.bands) {
            // Latitude bands, drawn as horizontal slabs across the clipped disc.
            for (let b = 0; b < st.bands; b++) {
                const t = (b + 0.5) / st.bands;
                const yy = y - st.r + 2 * st.r * t;
                ctx.fillStyle = b % 2 ? st.band : st.band2;
                ctx.fillRect(x - st.r, yy - st.r * 0.16, 2 * st.r, st.r * 0.32);
            }
        } else if (st.blotch) {
            // Continents / maria: two deterministic patches so a world has a
            // recognisable surface instead of being a flat swatch.
            let a = (idx * 2246822519 + 374761393) >>> 0;
            const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
            ctx.fillStyle = st.blotch;
            for (let k = 0; k < 3; k++) {
                const px = x + (rnd() - 0.5) * 1.5 * st.r;
                const py = y + (rnd() - 0.5) * 1.5 * st.r;
                ctx.beginPath();
                ctx.ellipse(px, py, st.r * (0.3 + 0.3 * rnd()), st.r * (0.22 + 0.25 * rnd()),
                    rnd() * Math.PI, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
        ctx.restore();

        ctx.beginPath(); ctx.arc(x, y, st.r, 0, 2 * Math.PI);
        shadeSphere(ctx, x, y, st.r, lx, ly);
    }

    _grid(ctx, cx, cy, s, span) {
        ctx.strokeStyle = COL.grid;
        ctx.lineWidth = 1;
        const step = Math.pow(10, Math.round(Math.log10(span / 3)));
        ctx.beginPath();
        for (let r = step; r <= span * 1.05; r += step) {
            ctx.moveTo(cx + r * s, cy);
            ctx.arc(cx, cy, r * s, 0, 2 * Math.PI);
        }
        ctx.stroke();
    }

    _scaleBar(ctx, s, span) {
        const step = Math.pow(10, Math.round(Math.log10(span / 3)));
        const px = step * s;
        if (px < 20 || px > this.w * 0.6) return;
        ctx.strokeStyle = "rgba(180,210,240,0.45)";
        ctx.lineWidth = 1;
        const x0 = 14, y0 = this.h - 18;
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0);
        ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4);
        ctx.moveTo(x0 + px, y0 - 4); ctx.lineTo(x0 + px, y0 + 4);
        ctx.stroke();
        ctx.fillStyle = "rgba(180,210,240,0.7)";
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillText(`${step >= 1 ? step : step.toFixed(2)} AU`, x0 + px + 6, y0 + 3.5);
    }
}

/* --------------------------------------------------------------- charts */

function chartSetup(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    const w = r.width || cv.width, h = r.height || cv.height;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
}

/* Fitness history: best and mean digits per generation. */
function drawFitness(cv, history) {
    const { ctx, w, h } = chartSetup(cv);
    ctx.fillStyle = "#0a1420"; ctx.fillRect(0, 0, w, h);
    if (!history.length) return;
    const pad = { l: 26, r: 4, t: 6, b: 14 };
    const xs = history.length;
    let lo = Infinity, hi = -Infinity;
    for (const p of history) { lo = Math.min(lo, p.avgDigits); hi = Math.max(hi, p.bestDigits); }
    if (!(hi > lo)) { hi = lo + 1; }
    lo = Math.floor(lo * 2) / 2; hi = Math.ceil(hi * 2) / 2;
    const X = i => pad.l + (w - pad.l - pad.r) * (xs < 2 ? 0 : i / (xs - 1));
    const Y = v => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));

    ctx.strokeStyle = "rgba(120,160,210,0.16)"; ctx.lineWidth = 1;
    ctx.fillStyle = "#6d84a0"; ctx.font = "9px system-ui, sans-serif";
    for (let k = 0; k <= 4; k++) {
        const v = lo + (hi - lo) * k / 4;
        ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
        ctx.fillText(v.toFixed(1), 2, Y(v) + 3);
    }
    const line = (key, col) => {
        ctx.strokeStyle = col; ctx.lineWidth = 1.4;
        ctx.beginPath();
        history.forEach((p, i) => { const y = Y(p[key]); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); });
        ctx.stroke();
    };
    line("avgDigits", "#35b6ff");
    line("bestDigits", "#ffc94d");
}

/* Drift curve: log10 relative error against tick, for the brain and each
 * baseline. This is the chart that answers the actual research question, so it
 * gets the analytic competitors drawn on the same axes rather than in a table
 * somewhere else. */
function drawDrift(cv, series) {
    const { ctx, w, h } = chartSetup(cv);
    ctx.fillStyle = "#0a1420"; ctx.fillRect(0, 0, w, h);
    const all = series.filter(s => s.points && s.points.length);
    if (!all.length) return;
    const pad = { l: 26, r: 6, t: 6, b: 16 };
    let tmax = 1, lo = 0, hi = -12;
    for (const s of all) for (const p of s.points) {
        tmax = Math.max(tmax, p.tick);
        lo = Math.max(lo, p.logErr); hi = Math.min(hi, p.logErr);
    }
    lo = Math.min(1, Math.ceil(lo)); hi = Math.max(-9, Math.floor(hi));
    if (lo - hi < 2) hi = lo - 2;
    const X = t => pad.l + (w - pad.l - pad.r) * Math.log2(t) / Math.log2(Math.max(2, tmax));
    const Y = v => pad.t + (h - pad.t - pad.b) * (1 - (v - hi) / (lo - hi));

    ctx.strokeStyle = "rgba(120,160,210,0.16)"; ctx.lineWidth = 1;
    ctx.fillStyle = "#6d84a0"; ctx.font = "9px system-ui, sans-serif";
    for (let v = hi; v <= lo; v++) {
        ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
        ctx.fillText(`1e${v}`, 1, Y(v) + 3);
    }
    for (const s of all) {
        ctx.strokeStyle = s.color; ctx.lineWidth = s.wide ? 2 : 1.2;
        if (s.dash) ctx.setLineDash(s.dash); else ctx.setLineDash([]);
        ctx.beginPath();
        s.points.forEach((p, i) => { const x = X(p.tick), y = Y(p.logErr); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "#6d84a0";
    ctx.fillText("tick →", w - 38, h - 4);
}

/* The image the network is given, drawn at the resolution it actually sees so
 * the coarseness is visible rather than flattered by interpolation. */
function drawRaster(cv, raster, gridN) {
    const { ctx, w, h } = chartSetup(cv);
    ctx.fillStyle = "#050a12"; ctx.fillRect(0, 0, w, h);
    if (!raster) return;
    const cw = w / gridN, ch = h / gridN;
    for (let y = 0; y < gridN; y++) {
        for (let x = 0; x < gridN; x++) {
            const v = (raster[y * gridN + x] + 1) / 2;      // [-1,1] → [0,1]
            const t = Math.max(0, Math.min(1, v));
            const r = Math.round(255 * Math.pow(t, 0.75));
            const g = Math.round(190 * Math.pow(t, 1.1));
            const b = Math.round(120 + 100 * Math.pow(1 - t, 2));
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            // y is flipped: raster row 0 is the bottom of the world frame.
            ctx.fillRect(x * cw, (gridN - 1 - y) * ch, Math.ceil(cw), Math.ceil(ch));
        }
    }
}

if (typeof module !== "undefined") {
    module.exports = { SceneRenderer, drawFitness, drawDrift, drawRaster, bodyStyle, COL };
}
