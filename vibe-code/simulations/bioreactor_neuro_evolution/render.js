/* render.js — the stage canvas (timeline, reactor, charts), the controller
 * network and the lab-mode fitness chart. Canvas 2D, no dependencies.
 *
 * Nothing here knows which product is being made: names, reagents, media and
 * the functional assay all come from the lineage on the scenario.
 *
 * Playback stays smooth because the renderer never reads a reactor directly.
 * main.js hands it a view blended between the last two control ticks
 * (viewOf / lerpView), the charts end on a point blended the same way
 * (lerpHist), and everything that moves on its own advances by the frame's
 * elapsed time, never by frame count or wall-clock time.
 */
"use strict";

/* The palette matches style.css: Tailwind slate for structure, teal for the
 * network and the cells it makes, one colour per measured quantity. */
const PAL = {
    surface: "#ffffff", subtle: "#f1f5f9", line: "#e2e8f0", lineStrong: "#cbd5e1",
    text: "#0f172a", text2: "#334155", muted: "#64748b", faint: "#94a3b8",
    accent: "#0d9488", accentStrong: "#0f766e", down: "#e11d48", danger: "#dc2626",
    product: "#0d9488", onTheWay: "#99f6e4", other: "#cbd5e1", protocol: "#334155",
    glucose: "#d97706", lactate: "#e11d48", pH: "#059669", DO: "#0284c7",
    weekend: "rgba(15, 23, 42, 0.045)"
};
const MEDIUM_FILLS = ["#f1f5f9", "#e2e8f0", "#ccfbf1"];
const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const font = (size, weight) => `${weight || 400} ${size}px ${FONT_STACK}`;
const CALLOUT_W = 72;          // the label columns either side of the vessel

/* Three groups rather than every compartment: the product, the cells on their
 * way to it, and everything else. */
function groupsOf(L) {
    return [
        { label: L.product, colour: PAL.product, of: (N) => productOf(L, N) },
        { label: "on the way", colour: PAL.onTheWay, of: (N) => { let s = 0; for (let i = 1; i < L.immIdx; i++) s += N[i]; return s; } },
        { label: "other cells", colour: PAL.other, of: (N) => N[0] + N[L.OFF] }
    ];
}

/* Phenol red: yellow once lactate has used up the bicarbonate, through
 * orange, to magenta at the top of the band. */
function phenolRed(c) {
    const y = [226, 188, 61], o = [226, 132, 51], r = [199, 51, 84];
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return c < 0.5 ? mix(y, o, c * 2) : mix(o, r, (c - 0.5) * 2);
}
const rgb = (c, a) => a == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const shade = (c, f) => c.map(v => Math.round(Math.max(0, Math.min(255, v * f))));
const hex2 = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, f) => a + (b - a) * f;
/* Capitalise a label, leaving words like "pH" alone. */
const cap = (s) => !s || /^[a-z][A-Z]/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1);
function formatDose(v, spec) {
    const n = spec.hi >= 20 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1);
    return spec.unit === "×" ? `${n}×` : `${n} ${spec.unit}`;
}

/* Cut `text` down to `maxW` pixels with an ellipsis; "" if nothing fits. */
function ellipsize(ctx, text, maxW) {
    if (!text || maxW <= 0) return "";
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s.length > 1 ? s.trimEnd() + "…" : "";
}

/* Size a small canvas to its CSS box at the device pixel ratio. `heightOf`
 * derives the height from the width; without it the CSS height is used. */
function fitCanvas(cv, heightOf) {
    const w = cv.clientWidth;
    if (!w) return null;                     // hidden (e.g. a closed mobile sheet)
    const h = heightOf ? heightOf(w) : cv.clientHeight;
    if (heightOf && cv.style.height !== h + "px") cv.style.height = h + "px";
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
}

/* The plot area shared by the timeline and the charts, so their day axes line up. */
function plotSpan(x0, w, narrow) {
    const l = narrow ? 30 : 40, r = narrow ? 28 : 40;
    return { gx: x0 + l, gw: w - l - r };
}

/* ---------------------------------------------------------------- views */
const VIEW_NUM = ["Nv", "viability", "d", "fCore", "DO", "pH", "T", "glc", "lac", "dead", "A", "kla", "colourVal", "product", "purity", "func"];
function viewOf(r) {
    return {
        lin: r.lin, N: Array.from(r.N), Nv: r.Nv, viability: r.viability, d: r.d, fCore: r.fCore,
        DO: r.DO, pH: r.pH, T: r.T, glc: r.glc, lac: r.lac, dead: r.dead, A: r.A, kla: r.kla,
        colourVal: r.colour(), product: r.product, purity: r.purity, func: r.funcValue(),
        cue: Array.from(r.cue), info: r.info,
        act: cloneAction(r.act), dist: r.dist, failed: r.failed, failReason: r.failReason
    };
}
function lerpView(a, b, f) {
    if (!a || a.lin !== b.lin) return b;
    const v = Object.assign({}, b);
    for (const k of VIEW_NUM) v[k] = lerp(a[k], b[k], f);
    v.N = b.N.map((x, i) => lerp(a.N[i], x, f));
    v.cue = b.cue.map((x, i) => lerp(a.cue[i], x, f));
    v.act = cloneAction(b.act);
    for (const k of ["o2", "co2", "base", "rpm", "perf", "glcFeed"]) v.act[k] = lerp(a.act[k], b.act[k], f);
    for (let i = 0; i < v.act.cue.length; i++) v.act.cue[i] = lerp(a.act.cue[i], b.act.cue[i], f);
    return v;
}
/* A history clipped to its last-but-one point plus a blended final point. */
function lerpHist(H, f) {
    const n = H.t.length;
    if (n < 2 || f >= 0.999) return H;
    const out = {};
    for (const k of Object.keys(H)) {
        const arr = H[k];
        const head = arr.slice(0, n - 1);
        const a = arr[n - 2], b = arr[n - 1];
        if (k === "medium") head.push(a);
        else if (Array.isArray(a)) head.push(a.map((x, i) => lerp(x, b[i], f)));
        else head.push(lerp(a, b, f));
        out[k] = head;
    }
    return out;
}

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.cw = 0; this.ch = 0;
        this.drips = [];
        this.ripples = [];
        /* Each aggregate has a place on the circulation loop: azimuth and loop
         * phase, how far out its loop sits (k), a speed jitter, a size, a
         * colour lot (u, matched against the group fractions), where it lands
         * when it settles (fl) and how settled it is (s). */
        this.blobs = [];
        const rng = mulberry32(77);
        for (let i = 0; i < 120; i++) this.blobs.push({
            psi: rng() * 6.283, phi: rng() * 6.283, k: 0.3 + 0.7 * Math.sqrt(rng()),
            js: 0.8 + 0.4 * rng(), jl: 0.75 + 0.5 * rng(), sz: 0.7 + 0.6 * rng(),
            ph: rng() * 6.3, u: rng(), fl: 0.9 * Math.sqrt(rng()), s: 0
        });
        /* Integrated phases (radians) and the two lagged angular speeds. */
        this.motion = { omega: 0, bulk: 0, imp: 0, swirl: 0, loop: 0, gas: 0, wob: 0 };
        this.resize();
    }

    resize() {
        const wrap = this.canvas.parentElement;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(200, wrap.clientWidth), h = Math.max(200, wrap.clientHeight);
        this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cw = w; this.ch = h;
    }

    /* Weekend spans (no assays) for a scenario, computed once per batch. */
    closedSpans(scn) {
        if (this._spansFor !== scn) {
            const spans = [];
            let from = -1;
            for (let h = 0; h <= scn.hours; h++) {
                const closed = h < scn.hours && !calendarAt(scn, h).labOpen;
                if (closed && from < 0) from = h;
                if (!closed && from >= 0) { spans.push([from, h]); from = -1; }
            }
            this._spansFor = scn; this._spans = spans;
        }
        return this._spans;
    }

    /* view: a blended view (viewOf / lerpView); hist: {learn, sop};
     * opts: {scn, phase, frac, dt, title, focusLabel, dashLabel, note} */
    frame(view, hist, opts) {
        const ctx = this.ctx, W = this.cw, H = this.ch;
        ctx.fillStyle = PAL.surface; ctx.fillRect(0, 0, W, H);
        const f = opts.frac == null ? 1 : opts.frac;
        const hs = { learn: lerpHist(hist.learn, f), sop: lerpHist(hist.sop, f) };
        const n = hs.learn.t.length;
        const o = Object.assign({}, opts, { t: n ? hs.learn.t[n - 1] : 0 });
        if (W < 720) {
            // Phone: timeline, then the reactor with its readouts beside it, then the charts.
            const pad = 12;
            const tl = this.drawTimeline(o, pad, 8, W - 2 * pad, true);
            const rh = clamp((H - tl) * 0.46, 250, 360);
            this.drawReactor(view, hs, pad, 8 + tl, W - 2 * pad, rh, o, true);
            const cy = 8 + tl + rh + 4;
            this.drawCharts(hs, pad, cy, W - 2 * pad, H - cy - 8, o, true);
        } else {
            const colW = clamp(W * 0.36, 280, 440);
            const tl = this.drawTimeline(o, colW, 14, W - colW - 12, false);
            this.drawReactor(view, hs, 0, 0, colW, H, o, false);
            this.drawCharts(hs, colW, 14 + tl, W - colW - 12, H - tl - 26, o, false);
        }
    }

    /* ---------------------------------------------------------- timeline */
    drawTimeline(o, x0, y0, w, narrow) {
        const ctx = this.ctx, scn = o.scn;
        const hours = scn ? scn.hours : 360, days = hours / 24;
        const { gx, gw } = plotSpan(x0, w, narrow);
        const px = (hr) => gx + (hr / hours) * gw;
        const base = y0 + 15;
        ctx.textAlign = "left";

        ctx.font = font(15, 600); ctx.fillStyle = PAL.text;
        const day = `Day ${(o.t / 24).toFixed(1)}`;
        ctx.fillText(day, gx, base);
        let x = gx + ctx.measureText(day).width + 5;
        ctx.font = font(12); ctx.fillStyle = PAL.faint;
        const of = `of ${Math.round(days)}`;
        ctx.fillText(of, x, base);
        x += ctx.measureText(of).width + 16;

        // On the right, if the status line keeps 340 px: what the shaded bands
        // mean, or the caller's note. A fixed reservation, so the key does not
        // come and go as the status text changes length.
        const [head, body] = o.phase || ["", ""];
        let right = gx + gw;
        if (!narrow) {
            const key = o.note ? null : [["Weekend, no assays", PAL.lineStrong]]
                .concat(scn && scn.events.length ? [["Fault", PAL.danger]] : []);
            right = this.drawKey(key, o.note, right, base, x + 340);
        }
        if (head) {
            ctx.font = font(12, 600); ctx.fillStyle = o.lost ? PAL.danger : PAL.accentStrong;
            const ht = ellipsize(ctx, head, right - x - 12);
            ctx.fillText(ht, x, base);
            x += ctx.measureText(ht).width + 8;
            ctx.font = font(12); ctx.fillStyle = PAL.muted;
            const bt = ellipsize(ctx, body, right - x - 12);
            if (bt) ctx.fillText(bt, x, base);
        }

        // The run as a bar: weekends shaded, faults marked above it, progress in teal.
        const yb = y0 + 31, hb = 6;
        ctx.save();
        ctx.beginPath(); ctx.roundRect(gx, yb, gw, hb, hb / 2); ctx.clip();
        ctx.fillStyle = PAL.subtle; ctx.fillRect(gx, yb, gw, hb);
        if (scn) {
            ctx.fillStyle = PAL.line;
            for (const [a, b] of this.closedSpans(scn)) ctx.fillRect(px(a), yb, px(b) - px(a), hb);
        }
        ctx.fillStyle = PAL.accent; ctx.fillRect(gx, yb, Math.max(0, px(o.t) - gx), hb);
        ctx.restore();
        // Faults: a red tick where each starts, a pale line for as long as it lasts.
        if (scn) for (const e of scn.events) {
            const a = px(e.t0), b = px(Math.min(hours, e.t1));
            ctx.fillStyle = "#fca5a5"; ctx.fillRect(a, yb - 5, Math.max(2, b - a), 2);
            ctx.fillStyle = PAL.danger; ctx.fillRect(Math.round(a), yb - 8, 2, 6);
        }

        // A tick every day, a number every few.
        const perDay = gw / days, minGap = narrow ? 24 : 32;
        const step = [1, 2, 5, 10].find(s => s * perDay >= minGap) || 10;
        ctx.font = font(10); ctx.textAlign = "center";
        const last = Math.floor(days + 1e-6);
        for (let d = 0; d <= last; d++) {
            const X = Math.round(px(d * 24));
            ctx.fillStyle = PAL.lineStrong; ctx.fillRect(X, yb + hb + 2, 1, 3);
            const labelled = d % step === 0 || (d === last && (d % step) * perDay >= minGap);
            if (labelled) { ctx.fillStyle = PAL.faint; ctx.fillText(String(d), X + 0.5, yb + hb + 15); }
        }
        ctx.textAlign = "left";
        return 60;
    }

    /* A right-aligned key of swatches, or a plain note. Returns the x the
     * text to its left must stay clear of; skipped when it would crowd x0. */
    drawKey(items, note, right, base, minLeft) {
        const ctx = this.ctx;
        ctx.font = font(11);
        if (note) {
            const nw = ctx.measureText(note).width;
            if (right - nw < minLeft) return right;
            ctx.fillStyle = PAL.muted; ctx.textAlign = "right";
            ctx.fillText(note, right, base); ctx.textAlign = "left";
            return right - nw - 16;
        }
        const widths = items.map(([label]) => 14 + ctx.measureText(label).width);
        const total = widths.reduce((a, b) => a + b, 0) + 16 * (items.length - 1);
        if (right - total < minLeft) return right;
        let x = right - total;
        items.forEach(([label, colour], i) => {
            ctx.fillStyle = colour; ctx.fillRect(x, base - 7, 8, 8);
            ctx.fillStyle = PAL.muted; ctx.fillText(label, x + 14, base);
            x += widths[i] + 16;
        });
        return right - total - 16;
    }

    /* ------------------------------------------------------------ reactor */
    /* A 100 mL glass vessel in a water jacket, a stainless headplate, an
     * overhead drive and a four-blade 45° pitched-blade turbine. It is
     * headspace-aerated (see MODEL.md), which is how aggregate cultures of
     * stem cells are run because bursting bubbles shred them, so there is no
     * sparger: gas flows over the liquid and out through the exhaust filter.
     *
     * Everything that turns is integrated: the rpm sets an angular speed
     * through a short lag for the motor and a longer one for the liquid, and
     * each angle advances by ω·dt. A down-pumping turbine drives one loop
     * (down the axis, out along the dish, up the wall, back across the
     * surface) with a slower swirl around the shaft, and below ~40 rpm the
     * aggregates settle onto the dish. Drawn to a 55 mm bore; the vortex depth
     * is (ωR)²/2g at that size. The aggregates are drawn about six times
     * larger than life, or they would be a pixel and a half. */
    drawReactor(r, hs, x0, y0, w, h, o, narrow) {
        const ctx = this.ctx;
        const L = r.lin, G = groupsOf(L);
        const dt = o.dt == null ? 1 / 60 : Math.min(0.1, Math.max(0, o.dt));

        /* Desktop: callouts either side, the product summary underneath.
         * Phone: the vessel on the left, every readout listed beside it. */
        const titleH = 30, readH = narrow ? 0 : 128;
        const boxW = narrow ? Math.min(w * 0.5, 210) : w;
        const standX = narrow ? 8 : 22;                // how far the stand overhangs the jacket
        const availH = h - titleH - readH - (narrow ? 8 : 20);
        const vwMax = narrow ? (boxW - 2 * standX - 4) / 1.12 : Math.min((boxW - 2 * (CALLOUT_W + 12)) / 1.12, boxW * 0.5);
        const vw = Math.max(70, Math.min(vwMax, (availH - 36) / 1.7));
        const R = vw / 2;
        const wall = Math.max(2.5, vw * 0.035);
        const ey = vw * 0.09;                          // a circle, seen from a little above
        const jw = Math.max(5, vw * 0.06);             // the water jacket
        const mh = clamp(vw * 0.12, 20, 30), mw = clamp(vw * 0.14, 20, 34);   // the drive
        const hpT = 11, hpE = ey * 0.85;               // headplate thickness and its ellipse
        const above = mh + 8 + hpE + hpT, standH = jw + 18;
        const vh = clamp(availH - above - standH, vw * 1.1, vw * 2.0);
        const groupH = titleH + above + vh + standH + readH;
        const top = y0 + (narrow ? 0 : Math.max(0, (h - groupH) * 0.4));
        const cx = x0 + boxW / 2, vx = cx - R;
        const vy = top + titleH + above;
        const bottom = vy + vh;
        const rb = vw * 0.40;                          // the dish
        const medTop = vy + vh * 0.17;                 // the 100 mL line
        const pxmm = (vw - 2 * wall) / 55;
        const rpm = r.dist.rpmOverride != null ? r.dist.rpmOverride : r.act.rpm;
        const Nv = r.Nv;
        const turb = 1 - Math.exp(-Nv / 3);            // cells make the medium milky
        const milk = [241, 245, 249];
        const col = phenolRed(r.colourVal).map((v, i) => Math.round(lerp(v, milk[i], 0.42 * turb)));
        const deadF = Math.min(0.45, r.dead / 5);
        const colL = col.map(v => Math.round(lerp(v, 150, deadF)));
        const jt = [214, 226, 236].map((v, i) => Math.round(lerp(v, [240, 222, 206][i], clamp((r.T - 33) / 6, 0, 1))));

        ctx.textAlign = "center";
        ctx.fillStyle = PAL.text; ctx.font = font(13, 600);
        ctx.fillText(ellipsize(ctx, o.title || "", boxW - 8), cx, top + 16);

        /* ---- motion: the stirrer lags its setpoint, the liquid lags the stirrer ---- */
        const M = this.motion;
        const wSet = rpm / 60 * 2 * Math.PI;
        M.omega += (wSet - M.omega) * Math.min(1, dt / 0.5);
        M.bulk += (M.omega - M.bulk) * Math.min(1, dt / 2.0);
        M.imp += M.omega * dt;
        M.swirl += M.bulk * 0.35 * dt;                                // the bulk turns slower than the blade
        M.loop += (2 * Math.PI / 4) * (M.bulk / (2 * Math.PI)) * dt;  // one circulation every ~4 s at 60 rpm
        M.gas += dt; M.wob += dt;
        const rpmNow = M.omega / (2 * Math.PI) * 60;
        const dip = 6 * Math.pow(Math.max(0, rpmNow) / 120, 2) * pxmm;   // (ωR)²/2g for a 55 mm vessel, in px

        const body = (inset, topY) => {
            const i = inset || 0, t = topY == null ? vy : topY;
            const bx0 = vx + i, bx1 = vx + vw - i, by = bottom - i, ry = rb + Math.max(0, -i) * 0.6;
            ctx.beginPath();
            ctx.moveTo(bx0, t); ctx.lineTo(bx0, by - ry);
            ctx.bezierCurveTo(bx0, by + ry / 3, bx1, by + ry / 3, bx1, by - ry);
            ctx.lineTo(bx1, t); ctx.closePath();
        };
        const floorY = (rho) => bottom - wall - rb * Math.pow(rho / R, 2);

        /* ---- stand and water jacket, behind the glass ---- */
        const bg0 = ctx.createLinearGradient(0, bottom + jw + 3, 0, bottom + jw + 17);
        bg0.addColorStop(0, "#cbd5e1"); bg0.addColorStop(1, "#94a3b8");
        ctx.fillStyle = bg0; ctx.beginPath(); ctx.roundRect(vx - jw - standX, bottom + jw + 3, vw + 2 * jw + 2 * standX, 14, 4); ctx.fill();
        body(-jw, vy + 8);
        ctx.fillStyle = rgb(jt, 0.55); ctx.fill();
        ctx.strokeStyle = "rgba(15,23,42,0.2)"; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = "#94a3b8";
        for (const fy of [0.24, 0.80]) ctx.fillRect(vx + vw + jw - 1, vy + vh * fy, 10, 6);

        /* ---- inside the glass ---- */
        ctx.save(); body(); ctx.clip();
        ctx.fillStyle = rgb([241, 245, 249].map((v, i) => Math.round(lerp(v, jt[i], 0.3))));
        ctx.fillRect(vx, vy, vw, vh);
        // the liquid, shaded as a cylinder and darker with depth
        const g = ctx.createLinearGradient(vx, 0, vx + vw, 0);
        g.addColorStop(0, rgb(shade(colL, 0.55))); g.addColorStop(0.28, rgb(shade(colL, 0.98)));
        g.addColorStop(0.6, rgb(shade(colL, 1.06))); g.addColorStop(1, rgb(shade(colL, 0.58)));
        ctx.fillStyle = g; ctx.fillRect(vx, medTop, vw, bottom - medTop);
        const gd = ctx.createLinearGradient(0, medTop, 0, bottom);
        gd.addColorStop(0, "rgba(0,0,0,0)"); gd.addColorStop(1, `rgba(0,0,0,${0.22 + 0.18 * turb})`);
        ctx.fillStyle = gd; ctx.fillRect(vx, medTop, vw, bottom - medTop);
        // a soft highlight travelling round the cylinder: the liquid is turning
        for (let k = 0; k < 3; k++) {
            const th = M.swirl * (1 + 0.12 * k) + k * 2.1, s = Math.sin(th);
            if (s <= 0) continue;
            const bx = cx + Math.cos(th) * R * 0.85, hw = R * 0.35;
            const sw = ctx.createLinearGradient(bx - hw, 0, bx + hw, 0);
            sw.addColorStop(0, "rgba(255,255,255,0)"); sw.addColorStop(0.5, `rgba(255,255,255,${0.07 * s})`); sw.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = sw; ctx.fillRect(bx - hw, medTop, 2 * hw, bottom - medTop);
        }

        /* ---- the aggregates, on their circulation loop ---- */
        const A = Math.max(0, r.A);
        const nShow = Math.round(Math.min(this.blobs.length, 8 + A * 40));
        const dmm = r.d / 1000;
        const rBase = pxmm * 6 * (dmm <= 0.4 ? dmm : 0.4 + 0.25 * Math.log(dmm / 0.4));
        const fP = Nv > 1e-9 ? G[0].of(r.N) / Nv : 0, fM = Nv > 1e-9 ? G[1].of(r.N) / Nv : 0;
        const gcol = G.map(gr => hex2(gr.colour));
        const coreR = Math.cbrt(Math.max(0, r.fCore));
        const susp = clamp((rpmNow - 15) / 30, 0, 1);              // below ~40 rpm they sink
        const Ri = R - wall, k3 = ey / R;
        const liqTop = medTop + ey * 0.6, liqBot = bottom - 6, yC = (liqTop + liqBot) / 2;
        const back = [], front = [];
        for (let i = 0; i < nShow; i++) {
            const b = this.blobs[i];
            const want = 1 - susp;
            b.s += (want - b.s) * Math.min(1, dt / (b.s < want ? 5 : 1.5));
            const psi = b.psi + M.swirl * b.js, phi = b.phi + M.loop * b.jl;
            const rr = Math.max(1.5, rBase * b.sz);
            const yA = (liqBot - liqTop) / 2 * 0.86 * b.k, rA = (Ri - rr) * 0.44 * b.k, rC = (Ri - rr) * 0.5;
            let rho = rC - rA * Math.sin(phi);
            let y = yC - yA * Math.cos(phi) + Math.sin(M.wob * 0.9 + b.ph) * 2 * (1 - b.s);
            const rhoF = (Ri - rr) * b.fl;
            rho = lerp(rho, rhoF, b.s); y = lerp(y, floorY(rhoF) - rr - 1, b.s);
            const sn = Math.sin(psi), depth = 0.5 + 0.5 * sn;
            (sn < 0 ? back : front).push({ sx: cx + rho * Math.cos(psi), sy: y + sn * rho * k3, rr: rr * (0.85 + 0.3 * depth), depth, u: b.u });
        }
        back.sort((a, b) => a.depth - b.depth); front.sort((a, b) => a.depth - b.depth);
        const drawBlob = (q) => {
            const edge = 0.04;
            const wP = clamp((fP - q.u) / edge + 0.5, 0, 1);
            const wM = clamp((fP + fM - q.u) / edge + 0.5, 0, 1) * (1 - wP);
            const wO = 1 - wP - wM;
            const base = [0, 1, 2].map(c => Math.round(gcol[0][c] * wP + gcol[1][c] * wM + gcol[2][c] * wO));
            const rg = ctx.createRadialGradient(q.sx - q.rr * 0.35, q.sy - q.rr * 0.35, q.rr * 0.1, q.sx, q.sy, q.rr);
            rg.addColorStop(0, rgb(shade(base, 1.3))); rg.addColorStop(0.65, rgb(base)); rg.addColorStop(1, rgb(shade(base, 0.55)));
            ctx.globalAlpha = (0.5 + 0.5 * q.depth) * (1 - 0.55 * turb * (1 - q.depth));
            ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(q.sx, q.sy, q.rr, 0, 6.283); ctx.fill();
            if (coreR > 0.05 && q.rr > 2.5) { ctx.fillStyle = "rgba(15,23,42,0.5)"; ctx.beginPath(); ctx.arc(q.sx, q.sy, q.rr * coreR, 0, 6.283); ctx.fill(); }
        };
        back.forEach(drawBlob); ctx.globalAlpha = 1;

        /* ---- shaft and a 45° pitched-blade turbine, a third of the way up ---- */
        const iy = vy + vh * 0.72;
        const Rimp = R * 0.45, hubR = R * 0.07, bw = R * 0.16, hubH = bw * 0.9;
        ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = Math.max(2.5, vw * 0.022);
        ctx.beginPath(); ctx.moveTo(cx, vy - 2); ctx.lineTo(cx, iy + hubH * 0.55); ctx.stroke();
        const bladeOf = (a) => {
            const ca = Math.cos(a), sa = Math.sin(a);
            // radial (ca,0,sa); tangential (−sa,0,ca); the plate's short axis is (tangential + up)/√2
            const hx = -sa * 0.707 * bw / 2, hy = 0.707 * bw / 2, hz = ca * 0.707 * bw / 2;
            const P = (rad, sg) => ({ x: rad * ca + sg * hx, y: sg * hy, z: rad * sa + sg * hz });
            const ndl = Math.abs(sa * 0.707 * -0.45 + 0.707 * 0.6 + -ca * 0.707 * 0.66);   // normal · light
            return { pts: [P(hubR * 0.9, 1), P(Rimp, 1), P(Rimp, -1), P(hubR * 0.9, -1)], z: (hubR + Rimp) / 2 * sa, bright: 0.35 + 0.65 * Math.min(1, ndl) };
        };
        const drawBlade = (bl) => {
            ctx.fillStyle = rgb([148, 163, 184].map(v => Math.round(lerp(v * 0.75, 236, bl.bright))));
            ctx.beginPath();
            bl.pts.forEach((p, i) => { const X = cx + p.x, Y = iy - p.y + p.z * k3; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = "rgba(15,23,42,0.28)"; ctx.lineWidth = 0.8; ctx.stroke();
        };
        const blades = [0, 1, 2, 3].map(k => bladeOf(M.imp + k * Math.PI / 2)).sort((a, b) => a.z - b.z);
        blades.filter(b => b.z < 0).forEach(drawBlade);
        const hg0 = ctx.createLinearGradient(cx - hubR, 0, cx + hubR, 0);
        hg0.addColorStop(0, "#7c8a9e"); hg0.addColorStop(0.45, "#e2e8f0"); hg0.addColorStop(1, "#64748b");
        ctx.fillStyle = hg0; ctx.fillRect(cx - hubR, iy - hubH / 2, 2 * hubR, hubH);
        ctx.beginPath(); ctx.ellipse(cx, iy + hubH / 2, hubR, hubR * k3, 0, 0, Math.PI); ctx.fill();
        ctx.fillStyle = "#cbd5e1"; ctx.beginPath(); ctx.ellipse(cx, iy - hubH / 2, hubR, hubR * k3, 0, 0, 6.283); ctx.fill();
        blades.filter(b => b.z >= 0).forEach(drawBlade);

        /* ---- pH and DO probes, well above the turbine ---- */
        const probe = (fx, tint, len, kind) => {
            const x = vx + vw * fx, pw = Math.max(3, vw * 0.028);
            ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = pw;
            ctx.beginPath(); ctx.moveTo(x, vy - 2); ctx.lineTo(x, vy + len - 6); ctx.stroke();
            ctx.fillStyle = tint; ctx.fillRect(x - pw / 2, vy + len - 22, pw, 6);
            if (kind === "glass") { ctx.fillStyle = "rgba(226,238,246,0.95)"; ctx.beginPath(); ctx.ellipse(x, vy + len, pw * 0.7, pw * 0.95, 0, 0, 6.283); ctx.fill(); }
            else { ctx.fillStyle = "#334155"; ctx.beginPath(); ctx.roundRect(x - pw * 0.6, vy + len - 7, pw * 1.2, 9, 2); ctx.fill(); }
        };
        probe(0.24, PAL.pH, vh * 0.50, "glass");
        probe(0.76, PAL.DO, vh * 0.55, "cap");
        front.forEach(drawBlob); ctx.globalAlpha = 1;
        // everything under the surface is seen through the medium
        ctx.fillStyle = rgb(colL, 0.18); ctx.fillRect(vx, medTop, vw, bottom - medTop);

        /* ---- the surface: an ellipse seen from above, with the vortex in it ---- */
        ctx.fillStyle = rgb(shade(colL, 1.15)); ctx.globalAlpha = 0.95;
        ctx.beginPath(); ctx.ellipse(cx, medTop, R - wall * 0.5, ey * 0.95, 0, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
        ctx.save(); ctx.translate(cx, medTop); ctx.scale(1, k3);
        if (dip > 0.4) {
            const fr = Math.min(R * 0.7, R * 0.22 + dip * 1.3);
            const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, fr);
            fg.addColorStop(0, rgb(shade(colL, 0.5), Math.min(0.9, 0.25 + dip / 30)));
            fg.addColorStop(0.5, rgb(shade(colL, 0.85), 0.35)); fg.addColorStop(1, rgb(colL, 0));
            ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, fr, 0, 6.283); ctx.fill();
        }
        ctx.strokeStyle = "rgba(255,255,255,0.32)"; ctx.lineWidth = 1.5;
        for (let k = 0; k < 3; k++) {
            const a0 = M.swirl * (1 + 0.1 * k) + k * 2.2, rad = R * (0.35 + 0.18 * k);
            ctx.beginPath(); ctx.arc(0, 0, rad, a0, a0 + 1.4); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(cx, medTop, R - wall * 0.5, ey * 0.95, 0, 0, Math.PI); ctx.stroke();

        /* ---- the headspace: feed and base drip in, gas flows over the surface ---- */
        const tubeX = { feed: vx + vw * 0.36, base: vx + vw * 0.64, gas: vx + vw * 0.90, exh: vx + vw * 0.10 };
        const tubeEnd = vy + 9;
        const feeding = r.dist.pumpOK && (r.act.perf > 0.05 || r.act.glcFeed > 0.05);
        if (feeding && Math.random() < (r.act.perf * 2.5 + r.act.glcFeed) * dt) this.drips.push({ x: tubeX.feed, y: tubeEnd, v: 20, kind: "feed" });
        if (r.act.base > 0.05 && Math.random() < r.act.base * 2 * dt) this.drips.push({ x: tubeX.base, y: tubeEnd, v: 20, kind: "base" });
        for (let i = this.drips.length - 1; i >= 0; i--) {
            const d = this.drips[i]; d.v += 420 * dt; d.y += d.v * dt;
            if (d.y >= medTop) { this.drips.splice(i, 1); this.ripples.push({ x: d.x, t: 0 }); continue; }
            ctx.fillStyle = d.kind === "feed" ? rgb(phenolRed(0.8)) : "#94a3b8";
            ctx.beginPath(); ctx.ellipse(d.x, d.y, 1.8, 2.8, 0, 0, 6.283); ctx.fill();
        }
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const p = this.ripples[i]; p.t += dt;
            if (p.t > 0.7) { this.ripples.splice(i, 1); continue; }
            const f = p.t / 0.7;
            ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - f)})`; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.ellipse(p.x, medTop, 3 + 14 * f, (3 + 14 * f) * k3, 0, 0, 6.283); ctx.stroke();
        }
        ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.4;
        for (const x of [tubeX.feed, tubeX.base]) { ctx.beginPath(); ctx.moveTo(x, vy - 2); ctx.lineTo(x, tubeEnd); ctx.stroke(); }
        const gasEnd = vy + (medTop - vy) * 0.55;
        ctx.beginPath(); ctx.moveTo(tubeX.gas, vy - 2); ctx.lineTo(tubeX.gas, gasEnd); ctx.stroke();
        if (r.dist.gasOK) {
            ctx.strokeStyle = "rgba(15,23,42,0.3)"; ctx.lineWidth = 1.4; ctx.setLineDash([2.5, 5]); ctx.lineDashOffset = -M.gas * 26;
            ctx.beginPath(); ctx.moveTo(tubeX.gas, vy - 2); ctx.lineTo(tubeX.gas, gasEnd); ctx.stroke();
            ctx.setLineDash([]); ctx.lineDashOffset = 0;
        }
        ctx.restore();   // end of the glass clip

        /* ---- the glass: highlights, the edge, the graduations ---- */
        ctx.save(); body(); ctx.clip();
        const hl = ctx.createLinearGradient(vx, 0, vx + vw, 0);
        hl.addColorStop(0, "rgba(0,0,0,0.12)"); hl.addColorStop(0.06, "rgba(255,255,255,0)"); hl.addColorStop(0.16, "rgba(255,255,255,0.28)");
        hl.addColorStop(0.30, "rgba(255,255,255,0.05)"); hl.addColorStop(0.72, "rgba(255,255,255,0)"); hl.addColorStop(0.83, "rgba(255,255,255,0.22)");
        hl.addColorStop(0.88, "rgba(255,255,255,0)"); hl.addColorStop(0.97, "rgba(0,0,0,0.04)"); hl.addColorStop(1, "rgba(0,0,0,0.16)");
        ctx.fillStyle = hl; ctx.fillRect(vx, vy, vw, vh);
        const yml = (ml) => medTop + (1 - ml / 100) * (bottom - rb * 0.3 - medTop);
        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1; ctx.font = font(9); ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.textAlign = "right";
        for (const ml of [25, 50, 75, 100]) {
            const gy = Math.round(yml(ml)) + 0.5;
            ctx.beginPath(); ctx.moveTo(vx + vw - 20, gy); ctx.lineTo(vx + vw - 9, gy); ctx.stroke();
            if (vw > 120) ctx.fillText(ml === 100 ? "100 mL" : String(ml), vx + vw - 23, gy + 3);
        }
        ctx.restore();
        body(); ctx.strokeStyle = "rgba(15,23,42,0.32)"; ctx.lineWidth = 1.5; ctx.stroke();
        body(wall); ctx.strokeStyle = "rgba(15,23,42,0.1)"; ctx.lineWidth = 1; ctx.stroke();

        /* ---- headplate, ports, exhaust filter and the overhead drive ---- */
        const hpY = vy - hpT, hpR = R + 9;
        const hg = ctx.createLinearGradient(cx - hpR, 0, cx + hpR, 0);
        hg.addColorStop(0, "#7c8a9e"); hg.addColorStop(0.3, "#cbd5e1"); hg.addColorStop(0.6, "#b4bfcd"); hg.addColorStop(1, "#64748b");
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.moveTo(cx - hpR, hpY); ctx.lineTo(cx - hpR, vy); ctx.ellipse(cx, vy, hpR, hpE, 0, Math.PI, 0, true); ctx.lineTo(cx + hpR, hpY); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#e2e8f0"; ctx.beginPath(); ctx.ellipse(cx, hpY, hpR, hpE, 0, 0, 6.283); ctx.fill();
        ctx.strokeStyle = "rgba(15,23,42,0.22)"; ctx.lineWidth = 1; ctx.stroke();
        for (const fx of [0.10, 0.24, 0.36, 0.5, 0.64, 0.76, 0.90]) {
            const px = vx + vw * fx;
            ctx.fillStyle = "#94a3b8"; ctx.fillRect(px - 4, hpY - 8, 8, 8);
            ctx.fillStyle = "#cbd5e1"; ctx.beginPath(); ctx.ellipse(px, hpY - 8, 4, 1.6, 0, 0, 6.283); ctx.fill();
        }
        ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1.6;
        for (const x of [tubeX.feed, tubeX.base, tubeX.gas]) { ctx.beginPath(); ctx.moveTo(x, hpY - 8); ctx.lineTo(x, hpY - 24); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(tubeX.exh, hpY - 8); ctx.lineTo(tubeX.exh, hpY - 20); ctx.stroke();
        if (r.dist.gasOK) {
            ctx.strokeStyle = "rgba(15,23,42,0.3)"; ctx.lineWidth = 1.4; ctx.setLineDash([2.5, 5]); ctx.lineDashOffset = M.gas * 26;
            ctx.beginPath(); ctx.moveTo(tubeX.gas, hpY - 24); ctx.lineTo(tubeX.gas, hpY - 8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(tubeX.exh, hpY - 8); ctx.lineTo(tubeX.exh, hpY - 20); ctx.stroke();
            ctx.setLineDash([]); ctx.lineDashOffset = 0;
        }
        ctx.fillStyle = "#f1f5f9"; ctx.beginPath(); ctx.roundRect(tubeX.exh - 6, hpY - 30, 12, 11, 4); ctx.fill();
        ctx.strokeStyle = "rgba(15,23,42,0.28)"; ctx.lineWidth = 1; ctx.stroke();
        const mTop = hpY - hpE - 6 - mh;
        ctx.fillStyle = "#64748b"; ctx.fillRect(cx - mw * 0.22, hpY - hpE - 6, mw * 0.44, 7);
        const mg = ctx.createLinearGradient(cx - mw / 2, 0, cx + mw / 2, 0);
        mg.addColorStop(0, "#7c8a9e"); mg.addColorStop(0.35, "#cbd5e1"); mg.addColorStop(1, "#94a3b8");
        ctx.fillStyle = mg; ctx.beginPath(); ctx.roundRect(cx - mw / 2, mTop, mw, mh, 3); ctx.fill();
        ctx.fillStyle = "#cbd5e1"; ctx.beginPath(); ctx.ellipse(cx, mTop, mw / 2, mw * 0.12, 0, 0, 6.283); ctx.fill();

        if (r.failed) {
            const bw2 = Math.min(vw + 60, boxW - 8), by = vy + vh / 2 - 26;
            ctx.fillStyle = "rgba(255,255,255,0.94)"; ctx.beginPath(); ctx.roundRect(cx - bw2 / 2, by, bw2, 48, 8); ctx.fill();
            ctx.strokeStyle = PAL.line; ctx.lineWidth = 1; ctx.stroke();
            ctx.textAlign = "center";
            ctx.fillStyle = PAL.danger; ctx.font = font(13, 600); ctx.fillText("Culture lost", cx, by + 20);
            ctx.fillStyle = PAL.muted; ctx.font = font(11); ctx.fillText(ellipsize(ctx, cap(r.failReason || ""), bw2 - 12), cx, by + 36);
        }

        /* ---- readouts ---- */
        const o2 = r.dist.gasOK ? r.act.o2 : 0.21;
        const settings = [
            ["Gas", r.dist.gasOK ? `${(o2 * 100).toFixed(0)} % O₂` : "Supply out", !r.dist.gasOK],
            ["Stirrer", `${rpm.toFixed(0)} rpm`, r.dist.rpmOverride != null],
            ["Feed", r.dist.pumpOK ? `${r.act.perf.toFixed(1)} vol/d` : "Pump out", !r.dist.pumpOK]
        ];
        const probes = [
            ["pH", r.pH.toFixed(2), false],
            ["Dissolved O₂", `${r.DO.toFixed(0)} %`, false],
            ["Temperature", `${r.T.toFixed(1)} °C`, false]
        ];
        const warnings = [];
        if (r.fCore > 0.01) warnings.push(`Oxygen-starved core: ${(r.fCore * 100).toFixed(0)} % of each aggregate`);
        for (const e of (r.dist.active || [])) warnings.push(cap(EVENT_TYPES[e.type].label));
        const S = hs.sop, dashVal = S.prod.length ? S.prod[S.prod.length - 1] : null;
        const summary = {
            what: `${cap(L.product)}, M/mL`,
            mine: [o.focusLabel || "Network", r.product],
            theirs: dashVal == null ? null : [o.dashLabel || "Protocol", dashVal],
            stats: [["Purity", `${(r.purity * 100).toFixed(0)} %`], ["Viable", `${(r.viability * 100).toFixed(0)} %`], ["Function", `${(r.func * 100).toFixed(0)} %`]],
            aggregates: `Aggregates ${r.d.toFixed(0)} µm, target ${L.agg.band[0]}–${L.agg.band[1]}`,
            warnings
        };
        if (narrow) {
            this.drawReadoutList(x0 + boxW + 14, top + 4, w - boxW - 14, summary, settings, probes);
        } else {
            const y1 = vy + Math.max(10, vh * 0.2);
            settings.forEach(([label, value, bad], i) => this.callout(vx - jw - 12, y1 + i * 38, label, value, bad, "right"));
            probes.forEach(([label, value, bad], i) => this.callout(vx + vw + jw + 12, y1 + i * 38, label, value, bad, "left"));
            this.drawSummary(cx, bottom + standH + 26, Math.min(w - 24, 340), summary);
        }
        ctx.textAlign = "left";
    }

    callout(x, y, label, value, bad, align) {
        const ctx = this.ctx;
        ctx.textAlign = align;
        ctx.font = font(11); ctx.fillStyle = PAL.muted;
        ctx.fillText(ellipsize(ctx, label, CALLOUT_W), x, y);
        ctx.font = font(13, 500); ctx.fillStyle = bad ? PAL.danger : PAL.text;
        ctx.fillText(ellipsize(ctx, value, CALLOUT_W), x, y + 17);
    }

    /* Label/value pairs on one line, dropped from the end if they do not fit. */
    pairs(items, x, y, align, maxW) {
        const ctx = this.ctx;
        const parts = items.map(([label, value, bad]) => {
            ctx.font = font(11); const lw = ctx.measureText(label).width;
            ctx.font = font(12, 500); const vw = ctx.measureText(value).width;
            return { label, value, bad, lw, vw, w: lw + 5 + vw };
        });
        while (parts.length > 1 && parts.reduce((s, p) => s + p.w, 0) + 14 * (parts.length - 1) > maxW) parts.pop();
        const total = parts.reduce((s, p) => s + p.w, 0) + 14 * (parts.length - 1);
        let px = align === "center" ? x - total / 2 : x;
        ctx.textAlign = "left";
        for (const p of parts) {
            ctx.font = font(11); ctx.fillStyle = PAL.muted; ctx.fillText(p.label, px, y);
            ctx.font = font(12, 500); ctx.fillStyle = p.bad ? PAL.danger : PAL.text; ctx.fillText(p.value, px + p.lw + 5, y);
            px += p.w + 14;
        }
    }

    /* Desktop: the product, network against protocol, under the stand. */
    drawSummary(cx, y, maxW, s) {
        const ctx = this.ctx;
        ctx.textAlign = "center";
        ctx.font = font(11); ctx.fillStyle = PAL.muted;
        ctx.fillText(ellipsize(ctx, s.what, maxW), cx, y);
        const cols = s.theirs ? [[s.mine, PAL.accent, -1], [s.theirs, PAL.protocol, 1]] : [[s.mine, PAL.accent, 0]];
        const d = Math.min(maxW / 4, 72);
        for (const [[label, value], colour, side] of cols) {
            const x = cx + side * d;
            ctx.font = font(22, 600); ctx.fillStyle = colour; ctx.fillText(value.toFixed(2), x, y + 28);
            ctx.font = font(11); ctx.fillStyle = PAL.muted; ctx.fillText(label, x, y + 44);
        }
        this.pairs(s.stats, cx, y + 70, "center", maxW);
        ctx.textAlign = "center";
        ctx.font = font(11); ctx.fillStyle = PAL.muted;
        ctx.fillText(ellipsize(ctx, s.aggregates, maxW), cx, y + 88);
        ctx.fillStyle = PAL.danger;
        s.warnings.slice(0, 3).forEach((wt, i) => ctx.fillText(ellipsize(ctx, wt, maxW), cx, y + 106 + i * 15));
    }

    /* Phone: everything the desktop spreads around the vessel, as a list beside it. */
    drawReadoutList(x, y, w, s, settings, probes) {
        const ctx = this.ctx;
        ctx.textAlign = "left";
        ctx.font = font(11); ctx.fillStyle = PAL.muted;
        ctx.fillText(ellipsize(ctx, s.what, w), x, y + 12);
        const cols = s.theirs ? [s.mine, s.theirs] : [s.mine];
        cols.forEach(([label, value], i) => {
            const cx = x + i * Math.min(w / 2, 90);
            ctx.font = font(18, 600); ctx.fillStyle = i ? PAL.protocol : PAL.accent; ctx.fillText(value.toFixed(2), cx, y + 36);
            ctx.font = font(11); ctx.fillStyle = PAL.muted; ctx.fillText(label, cx, y + 50);
        });
        let yy = y + 74;
        const rows = [s.stats.slice(0, 2), s.stats.slice(2), probes.slice(0, 2), probes.slice(2), settings.slice(0, 2), settings.slice(2)];
        for (const row of rows) { this.pairs(row, x, yy, "left", w); yy += 19; }
        ctx.textAlign = "left"; ctx.font = font(11); ctx.fillStyle = PAL.danger;
        for (const wt of s.warnings.slice(0, 2)) { yy += 4; ctx.fillText(ellipsize(ctx, wt, w), x, yy); yy += 11; }
    }

    /* ------------------------------------------------------------ charts */
    drawCharts(hs, x0, y0, w, h, o, narrow) {
        const ctx = this.ctx, scn = o.scn;
        const L = scn ? scn.lin : LINEAGES[0], G = groupsOf(L);
        const hours = scn ? scn.hours : 360;
        const A = hs.learn, S = hs.sop, n = A.t.length;
        const { gx, gw } = plotSpan(x0, w, narrow);
        const px = (t) => gx + (t / hours) * gw;
        const rows = [
            { title: "Cells", unit: "M/mL", legend: [[cap(L.product), G[0].colour, "box"], ["On the way", G[1].colour, "box"], ["Other", G[2].colour, "box"], [o.dashLabel || "Protocol", PAL.protocol, "dash"]] },
            { title: "Glucose and lactate", unit: "mM", legend: [["Glucose", PAL.glucose, "line"], ["Lactate", PAL.lactate, "line"]] },
            { title: "pH and dissolved O₂", legend: [["pH", PAL.pH, "line"], ["O₂, % of air saturation", PAL.DO, "line"]] },
            { title: "What the controller did", unit: "each lane on its own scale", legend: [], weight: narrow ? 2.4 : 1.6 }
        ];
        const headH = narrow ? 18 : 22, gap = narrow ? 8 : 14;
        const weights = rows.map(r => r.weight || 1), wSum = weights.reduce((a, b) => a + b, 0);
        const plotH = Math.max(40, h - rows.length * headH - (rows.length - 1) * gap);
        const spans = scn ? this.closedSpans(scn) : [];
        const line = (arr, ts, lo, hi, colour, ry, rh, dashed) => {
            if (!arr || arr.length < 2) return;
            ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.setLineDash(dashed ? [4, 3] : []);
            ctx.beginPath();
            for (let k = 0; k < arr.length; k++) {
                const X = px(ts[k]), Y = ry + rh - clamp((arr[k] - lo) / (hi - lo), 0, 1) * rh;
                k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
            }
            ctx.stroke(); ctx.setLineDash([]);
        };
        const yLabel = (text, y, colour, side) => {
            ctx.font = font(10); ctx.fillStyle = colour || PAL.faint;
            ctx.textAlign = side === "right" ? "left" : "right";
            ctx.fillText(text, side === "right" ? gx + gw + 6 : gx - 6, y);
            ctx.textAlign = "left";
        };
        const smooth = (arr, k) => arr.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - k); j <= i; j++) { s += arr[j]; c++; } return s / c; });

        let y = y0;
        rows.forEach((row, i) => {
            const ry = Math.round(y + headH), rh = plotH * weights[i] / wSum, rb = Math.round(ry + rh);
            y = rb + gap;
            this.rowHeader(row, gx, gw, ry - 7);
            for (const [a, b] of spans) { ctx.fillStyle = PAL.weekend; ctx.fillRect(px(a), ry, px(b) - px(a), rb - ry); }
            ctx.fillStyle = PAL.subtle; ctx.fillRect(gx, ry, gw, 1);
            ctx.fillStyle = PAL.line; ctx.fillRect(gx, rb, gw, 1);
            ctx.fillStyle = PAL.lineStrong;
            for (let d = 0; d * 24 <= hours; d++) ctx.fillRect(Math.round(px(d * 24)), rb - 3, 1, 3);

            switch (i) {
                case 0: {
                    let maxV = 2;
                    for (let k = 0; k < n; k++) maxV = Math.max(maxV, A.Nv[k], S.Nv[k] || 0);
                    maxV = Math.ceil(maxV * 2) / 2;
                    const yv = (v) => rb - clamp(v / maxV, 0, 1) * (rb - ry);
                    ctx.fillStyle = PAL.subtle; ctx.fillRect(gx, Math.round(yv(maxV / 2)), gw, 1);
                    let cum = A.N.map(() => 0);
                    for (const gi of [2, 1, 0]) {
                        const next = A.N.map((N, k) => cum[k] + G[gi].of(N));
                        ctx.fillStyle = G[gi].colour; ctx.beginPath();
                        for (let k = 0; k < n; k++) k ? ctx.lineTo(px(A.t[k]), yv(next[k])) : ctx.moveTo(px(A.t[k]), yv(next[k]));
                        for (let k = n - 1; k >= 0; k--) ctx.lineTo(px(A.t[k]), yv(cum[k]));
                        ctx.closePath(); ctx.fill();
                        cum = next;
                    }
                    line(S.prod, S.t, 0, maxV, PAL.protocol, ry, rb - ry, true);
                    yLabel(maxV.toFixed(1), ry + 8); yLabel("0", rb);
                    break;
                }
                case 1:
                    ctx.fillStyle = PAL.subtle; ctx.fillRect(gx, Math.round((ry + rb) / 2), gw, 1);
                    line(A.glc, A.t, 0, 25, PAL.glucose, ry, rb - ry);
                    line(A.lac, A.t, 0, 25, PAL.lactate, ry, rb - ry);
                    yLabel("25", ry + 8); yLabel("0", rb);
                    break;
                case 2: {
                    const yp = (v) => rb - clamp((v - 6.5) / 1.5, 0, 1) * (rb - ry);
                    ctx.fillStyle = "rgba(5, 150, 105, 0.08)"; ctx.fillRect(gx, yp(7.5), gw, yp(7.1) - yp(7.5));
                    line(smooth(A.DO, 8), A.t, 0, 120, PAL.DO, ry, rb - ry);
                    line(A.pH, A.t, 6.5, 8, PAL.pH, ry, rb - ry);
                    yLabel("8.0", ry + 8, PAL.pH); yLabel("6.5", rb, PAL.pH);
                    yLabel(narrow ? "120" : "120 %", ry + 8, PAL.DO, "right"); yLabel("0", rb, PAL.DO, "right");
                    break;
                }
                case 3:
                    this.drawLanes(A, L, px, gx, gw, ry, rb, narrow);
                    break;
            }
            if (n) {
                const X = Math.round(px(A.t[n - 1]));
                ctx.fillStyle = PAL.lineStrong; ctx.fillRect(X, ry, 1, rb - ry);
            }
        });
    }

    rowHeader(row, gx, gw, base) {
        const ctx = this.ctx;
        ctx.textAlign = "left";
        ctx.font = font(12, 600); ctx.fillStyle = PAL.text;
        ctx.fillText(row.title, gx, base);
        let x = gx + ctx.measureText(row.title).width + 6;
        ctx.font = font(11);
        if (row.unit) {
            const u = ellipsize(ctx, row.unit, gx + gw - x);
            ctx.fillStyle = PAL.faint; ctx.fillText(u, x, base);
            x += ctx.measureText(u).width;
        }
        x += 18;
        for (const [label, colour, kind] of row.legend) {
            const lw = 14 + ctx.measureText(label).width;
            if (x + lw > gx + gw) break;
            if (kind === "box") { ctx.fillStyle = colour; ctx.fillRect(x, base - 8, 9, 9); }
            else if (kind === "dash") {
                ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
                ctx.beginPath(); ctx.moveTo(x, base - 3.5); ctx.lineTo(x + 10, base - 3.5); ctx.stroke(); ctx.setLineDash([]);
            } else { ctx.fillStyle = colour; ctx.fillRect(x, base - 5, 10, 2); }
            ctx.fillStyle = PAL.muted; ctx.fillText(label, x + 14, base);
            x += lw + 16;
        }
    }

    /* One lane per dosing pump, never overlaid: each has its own baseline and
     * its own full scale, and the trace is a square step because that is what
     * a pump does. The medium is a choice rather than a dose, so it gets a
     * strip of named blocks along the bottom. */
    drawLanes(A, L, px, gx, gw, ry, rb, narrow) {
        const ctx = this.ctx;
        const medH = narrow ? 14 : 16;
        const laneH = Math.max(6, (rb - ry - medH - 4) / Math.max(1, L.nCue));
        const labelled = laneH >= 20;
        for (let c = 0; c < L.nCue; c++) {
            const spec = L.cues[c];
            const ly = ry + 2 + c * laneH;
            const base = Math.round(ly + laneH - 2);
            const amp = Math.max(3, laneH - (labelled ? 16 : 5));
            ctx.fillStyle = PAL.subtle; ctx.fillRect(gx, base, gw, 1);
            const vals = A.cue.map(row => row[c]);
            if (vals.length > 1) {
                const yOf = (v) => base - clamp(v / spec.hi, 0, 1) * amp;
                ctx.beginPath(); ctx.moveTo(px(A.t[0]), yOf(vals[0]));
                for (let k = 1; k < vals.length; k++) {
                    const X = px(A.t[k]);
                    ctx.lineTo(X, yOf(vals[k - 1]));   // hold the dose
                    ctx.lineTo(X, yOf(vals[k]));       // then step
                }
                ctx.strokeStyle = PAL.accent; ctx.lineWidth = 1.4; ctx.stroke();
                ctx.lineTo(px(A.t[vals.length - 1]), base);
                ctx.lineTo(px(A.t[0]), base); ctx.closePath();
                ctx.fillStyle = "rgba(13, 148, 136, 0.12)"; ctx.fill();
            }
            if (labelled) {
                ctx.textAlign = "left";
                ctx.font = font(11, 500); ctx.fillStyle = PAL.text2;
                const name = `Adding ${spec.short}`;
                ctx.fillText(name, gx + 4, ly + 10);
                const nw = ctx.measureText(name).width;
                ctx.font = font(10); ctx.fillStyle = PAL.faint;
                ctx.fillText(`0–${formatDose(spec.hi, spec)}`, gx + 10 + nw, ly + 10);
            }
        }
        const my = rb - medH;
        ctx.font = font(10); ctx.textAlign = "center";
        for (let k = 0; k < A.medium.length; k++) {
            let j = k;
            while (j + 1 < A.medium.length && A.medium[j + 1] === A.medium[k]) j++;
            const X0 = px(A.t[k]), X1 = px(A.t[Math.min(j + 1, A.t.length - 1)]);
            ctx.fillStyle = MEDIUM_FILLS[A.medium[k]] || PAL.subtle;
            ctx.fillRect(X0, my, Math.max(1, X1 - X0) + 0.5, medH - 2);
            const name = L.media[A.medium[k]].key;
            if (X1 - X0 > ctx.measureText(name).width + 10) { ctx.fillStyle = PAL.text2; ctx.fillText(name, (X0 + X1) / 2, my + medH - 5); }
            k = j;
        }
        ctx.textAlign = "right"; ctx.fillStyle = PAL.faint;
        ctx.fillText("Feed", gx - 6, my + medH - 5);
        ctx.textAlign = "left";
    }
}

/* ------------------------------------------------------------ network view */
/* What each output is and the value the reactor received, as [name, value, state]. */
function outputLabel(o, act, L) {
    if (o < N_BASE) {
        const names = ["Gas O₂", "Gas CO₂", "Base", "Stirrer", "Perfusion", "Glucose feed"];
        if (!act) return [names[o], ""];
        switch (o) {
            case 0: return [names[0], `${(act.o2 * 100).toFixed(0)} %`];
            case 1: return [names[1], `${(act.co2 * 100).toFixed(1)} %`];
            case 2: return [names[2], act.base > 0.05 ? `${act.base.toFixed(1)} mM/h` : "off"];
            case 3: return [names[3], `${act.rpm.toFixed(0)} rpm`];
            case 4: return [names[4], `${act.perf.toFixed(1)} vol/d`];
            default: return [names[5], act.glcFeed > 0.05 ? `${act.glcFeed.toFixed(1)} mM/h` : "off"];
        }
    }
    const ci = o - N_BASE;
    if (ci < N_CUE) {
        const spec = L.cues[ci];
        if (!spec) return [`Pump ${ci + 1}`, "unused", "unused"];
        if (!act) return [spec.short, ""];
        const v = act.cue[ci];
        return [spec.short, v > 0.02 * spec.hi ? formatDose(v, spec) : "off"];
    }
    const mi = o - N_BASE - N_CUE;
    const chosen = !!act && act.medium === mi;
    return [`Medium: ${L.media[mi].key}`, chosen ? "in use" : "", chosen ? "chosen" : ""];
}

/* The network, live: what it reads on the left (grouped), what it sets on the
 * right. Activations ease towards each forward pass so an hourly decision does
 * not read as a stutter. */
function drawNet(cv, net, note, act, lin) {
    const g = fitCanvas(cv, (w) => Math.round(clamp(w * 0.56, 210, 300)));
    if (!g) return;
    const { ctx, w: W, h: H } = g;
    ctx.clearRect(0, 0, W, H);
    if (!net) {
        ctx.fillStyle = PAL.muted; ctx.font = font(12); ctx.textAlign = "center";
        const words = (note || "No network in the loop.").split(" ");
        let lineText = "", y = H / 2 - 8;
        for (const wd of words) {
            if (ctx.measureText(lineText + " " + wd).width > W - 48) { ctx.fillText(lineText, W / 2, y); y += 17; lineText = wd; }
            else lineText = lineText ? lineText + " " + wd : wd;
        }
        ctx.fillText(lineText, W / 2, y);
        ctx.textAlign = "left";
        return;
    }
    const L = lin || LINEAGES[0];
    const sizes = net.sizes, nL = sizes.length;

    // eased activations, kept on the function so they survive between frames
    if (drawNet.smNet !== net) {
        drawNet.smNet = net;
        drawNet.sm = sizes.map(n => new Float32Array(n));
    }
    const sm = drawNet.sm;
    for (let l = 0; l < nL; l++) {
        const a = net._buf[l], s = sm[l];
        for (let k = 0; k < s.length; k++) s[k] += (a[k] - s[k]) * 0.22;
    }

    // Label columns are measured, so the network gets whatever width is left.
    const groups = inputGroups(L);
    const nIn = sizes[0], nOut = sizes[nL - 1];
    const outs = [];
    for (let o = 0; o < nOut; o++) outs.push(outputLabel(o, act, L));
    ctx.font = font(11);
    const cntW = ctx.measureText("00").width;
    let inW = 0; for (const gr of groups) inW = Math.max(inW, ctx.measureText(cap(gr.label)).width);
    let nameW = 0; for (const [nm] of outs) nameW = Math.max(nameW, ctx.measureText(nm).width);
    ctx.font = font(11, 500);
    let valW = 0; for (const [, v] of outs) valW = Math.max(valW, ctx.measureText(v).width);
    const colW = [8, 6, 6, 8];
    const top = 4, bot = H - 18;
    const LEFT = cntW + 6 + inW + 16;
    let showVals = true;
    let RIGHT = W - (nameW + 12 + valW) - 10 - colW[3];
    if (RIGHT - LEFT < 110) { showVals = false; RIGHT = W - nameW - 10 - colW[3]; }
    const xs = [LEFT, LEFT + (RIGHT - LEFT) * 0.4, LEFT + (RIGHT - LEFT) * 0.75, RIGHT];
    const yOf = (li, idx) => top + (idx + 0.5) / sizes[li] * (bot - top);
    const tint = (c, a) => c >= 0 ? `rgba(13,148,136,${a})` : `rgba(225,29,72,${a})`;

    // the strongest signed contributions into each output
    const last = nL - 2, wLast = net.weights[last], nPrev = sizes[last], aPrev = sm[last];
    const contrib = [];
    for (let o = 0; o < nOut; o++) {
        const base = o * (nPrev + 1);
        for (let i = 0; i < nPrev; i++) {
            const c = wLast[base + i] * aPrev[i];
            if (Math.abs(c) > 0.05) contrib.push([i, o, c]);
        }
    }
    contrib.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
    ctx.lineWidth = 1;
    for (let k = 0; k < Math.min(90, contrib.length); k++) {
        const [i, o, c] = contrib[k];
        ctx.strokeStyle = tint(c, Math.min(0.55, Math.abs(c) * 0.55));
        ctx.beginPath(); ctx.moveTo(xs[last] + colW[last], yOf(last, i)); ctx.lineTo(xs[last + 1], yOf(last + 1, o)); ctx.stroke();
    }
    // a fixed sample of the hidden-layer connections
    if (!drawNet.sample) {
        drawNet.sample = [];
        let s0 = 12345;
        const rnd = () => (s0 = (s0 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (let l = 0; l < 2; l++) {
            const pairs = [];
            for (let k = 0; k < 130; k++) pairs.push([Math.floor(rnd() * sizes[l]), Math.floor(rnd() * sizes[l + 1])]);
            drawNet.sample.push(pairs);
        }
    }
    for (let l = 0; l < 2; l++) {
        const wl = net.weights[l], ni = sizes[l], ai = sm[l], aj = sm[l + 1];
        for (const [i, o] of drawNet.sample[l]) {
            const c = wl[o * (ni + 1) + i] * ai[i] * aj[o], a = Math.min(0.25, Math.abs(c) * 0.5);
            if (a < 0.012) continue;
            ctx.strokeStyle = tint(c, a);
            ctx.beginPath(); ctx.moveTo(xs[l] + colW[l], yOf(l, i)); ctx.lineTo(xs[l + 1], yOf(l + 1, o)); ctx.stroke();
        }
    }
    // the neurons, on a faint column so the layers read even when quiet
    for (let l = 0; l < nL; l++) {
        const nn = sizes[l], a = sm[l], chh = (bot - top) / nn;
        ctx.fillStyle = PAL.subtle; ctx.fillRect(xs[l], top, colW[l], bot - top);
        for (let k = 0; k < nn; k++) {
            const v = Math.max(-1, Math.min(1, a[k]));
            ctx.fillStyle = tint(v, 0.08 + 0.92 * Math.abs(v));
            ctx.fillRect(xs[l], top + k * chh, colW[l], Math.max(1, chh - (chh > 3 ? 1 : 0)));
        }
    }
    // input groups: a bracket each, labels pushed apart where groups are thin
    const spans = [];
    let idx = 0;
    for (const gr of groups) {
        spans.push([top + idx / nIn * (bot - top), top + (idx + gr.n) / nIn * (bot - top)]);
        idx += gr.n;
    }
    const ly = spans.map(([a, b]) => (a + b) / 2);
    for (let i = 1; i < ly.length; i++) ly[i] = Math.max(ly[i], ly[i - 1] + 13);
    ly[ly.length - 1] = Math.min(ly[ly.length - 1], bot - 4);
    for (let i = ly.length - 2; i >= 0; i--) ly[i] = Math.min(ly[i], ly[i + 1] - 13);
    ctx.font = font(11);
    groups.forEach((gr, i) => {
        const [y0, y1] = spans[i], bx = LEFT - 8;
        ctx.strokeStyle = PAL.lineStrong; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + 4, y0 + 1); ctx.lineTo(bx, y0 + 1); ctx.lineTo(bx, y1 - 1); ctx.lineTo(bx + 4, y1 - 1);
        if (Math.abs(ly[i] - (y0 + y1) / 2) > 2) { ctx.moveTo(bx, (y0 + y1) / 2); ctx.lineTo(bx - 5, ly[i]); }
        ctx.stroke();
        ctx.textAlign = "right"; ctx.fillStyle = PAL.faint; ctx.fillText(String(gr.n), cntW, ly[i] + 4);
        ctx.textAlign = "left"; ctx.fillStyle = PAL.text2; ctx.fillText(cap(gr.label), cntW + 6, ly[i] + 4);
    });
    // outputs: name, then the value the reactor received
    const ox = xs[3] + colW[3] + 8;
    outs.forEach(([name, value, state], o) => {
        const y = yOf(nL - 1, o) + 4;
        ctx.textAlign = "left"; ctx.font = font(11);
        ctx.fillStyle = state === "unused" ? PAL.faint : state === "chosen" ? PAL.text : PAL.text2;
        ctx.fillText(name, ox, y);
        if (showVals && value) {
            ctx.textAlign = "right"; ctx.font = font(11, 500);
            ctx.fillStyle = state === "unused" || value === "off" ? PAL.faint : state === "chosen" ? PAL.accentStrong : PAL.text;
            ctx.fillText(value, W - 2, y);
        }
    });
    ctx.textAlign = "left"; ctx.font = font(10); ctx.fillStyle = PAL.faint;
    ctx.fillText("Inputs", 0, H - 4);
    ctx.textAlign = "right"; ctx.fillText("Outputs", W - 2, H - 4);
    ctx.textAlign = "left";
}

/* Lab mode: best and mean fitness per generation. */
function drawChart(cv, history) {
    const g = fitCanvas(cv);
    if (!g) return;
    const { ctx, w, h } = g;
    ctx.clearRect(0, 0, w, h);
    if (history.length < 2) {
        ctx.fillStyle = PAL.faint; ctx.font = font(11);
        ctx.fillText("Appears after the second generation", 0, h / 2);
        return;
    }
    const vals = history.flatMap(p => [p.best, p.avg]).filter(Number.isFinite);
    const min = Math.min(...vals, 0), max = Math.max(...vals, 0.1);
    const x = i => 28 + (i / (history.length - 1)) * (w - 32);
    const y = v => h - 4 - ((v - min) / (max - min)) * (h - 12);
    ctx.fillStyle = PAL.line; ctx.fillRect(28, Math.round(y(0)), w - 28, 1);
    if (max >= 1) {
        ctx.strokeStyle = "rgba(13,148,136,0.5)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(28, y(1)); ctx.lineTo(w, y(1)); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.lineWidth = 1.5;
    for (const [key, colour] of [["avg", PAL.faint], ["best", PAL.accent]]) {
        ctx.strokeStyle = colour; ctx.beginPath();
        history.forEach((p, i) => i ? ctx.lineTo(x(i), y(p[key])) : ctx.moveTo(x(i), y(p[key])));
        ctx.stroke();
    }
    ctx.fillStyle = PAL.faint; ctx.font = font(10); ctx.textAlign = "right";
    ctx.fillText(max.toFixed(2), 24, 10); ctx.fillText(min.toFixed(2), 24, h - 2);
    ctx.textAlign = "left";
}
