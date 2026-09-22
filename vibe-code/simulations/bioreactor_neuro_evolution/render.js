/* render.js — the vessel, the charts, the day axis, the network view.
 * Canvas 2D, no dependencies. Tailwind slate palette.
 *
 * NOTHING HERE KNOWS WHICH PRODUCT IS BEING MADE. Colours and labels come from
 * the lineage on the scenario: three groups (the product, the cells on their
 * way to becoming it, everything else), the dosing channels this protocol
 * actually uses, its three media, its own functional assay. A sixth product
 * would draw itself.
 *
 * SMOOTHNESS. The plant advances one hour per control tick; at the slow
 * playback that is one tick every sixteen frames, and a display that redrew
 * the tick's state would step. So the renderer never sees a reactor: it sees a
 * VIEW, a plain object of numbers blended between the last two ticks by `frac`
 * (viewOf / lerpView), and the charts end on a point blended the same way.
 * Everything that moves on its own — impeller, aggregates, drips — advances by
 * the frame's elapsed time (`opts.dt`), never by frame count and never by
 * reading the clock: a phase that is clock × rate jumps whenever the rate
 * changes. The network view eases its own activations towards each forward
 * pass instead of snapping to it.
 */
"use strict";

/* PAPER, NOT A CONTROL ROOM. One accent — teal — for the network and the
 * product it makes; graphite for the published protocol it is measured
 * against; everything else is a shade of the page, so the only saturated
 * things on screen are data. PAPER/INK are shared with main.js. */
const PAPER = "#f5f3ee", CARD = "#fdfcfa", INK = "#1e2226", INK_MUTED = "#6a6f75", INK_FAINT = "#9ca1a6";
const RULE = "#dcd8d0", RULE_2 = "#c3beb4", METAL = "#9aa0a6", METAL_LIGHT = "#c7ccd1";
const SERIF = "Georgia, serif";

/* Three groups, not eight compartments: the story is product / on the way /
 * other, whatever the product happens to be. */
const G_PROD = "#1d7a74", G_MID = "#8fa8bd", G_OTHER = "#cfcac1";   // teal, slate-blue, stone
function groupsOf(L) {
    return [
        { label: L.product, colour: G_PROD, of: (N) => productOf(L, N) },
        { label: "on the way", colour: G_MID, of: (N) => { let s = 0; for (let i = 1; i < L.immIdx; i++) s += N[i]; return s; } },
        { label: "other cells", colour: G_OTHER, of: (N) => N[0] + N[L.OFF] }
    ];
}
const MEDIUM_COLOURS = ["#b6b0a5", "#8b7cb6", "#5a9e7a"];      // stone, violet, green
/* One colour per dosing channel, in the order the pumps are numbered. */
const CUE_COLOURS = ["#1d7a74", "#b9862d", "#7d5ba6", "#2f6f9e", "#a8443a", "#4f7a3a"];
const C_GLC = "#b9862d", C_LAC = "#c25c2a", C_PH = "#2f7a4e", C_DO = "#2f6f9e", C_PROT = "#5c636a";

function phenolRed(c) {
    /* The real indicator: straw yellow once the lactate has titrated the
     * bicarbonate out, through orange, to magenta-red at the top of the
     * band. Kept saturated — it is the one thing in the vessel a
     * technician reads by eye, so it is allowed to be the loudest colour. */
    const y = [226, 188, 61], o = [226, 132, 51], r = [199, 51, 84];
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return c < 0.5 ? mix(y, o, c * 2) : mix(o, r, (c - 0.5) * 2);
}
const rgb = (c, a) => a == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const shade = (c, f) => c.map(v => Math.round(Math.max(0, Math.min(255, v * f))));
const hex2 = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, f) => a + (b - a) * f;

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
        /* Each aggregate owns a place on the circulation loop: an azimuth and
         * a loop phase, how far out its loop sits (k: nested loops, not one
         * ring), its own small speed jitter, a size lot, a colour lot (u,
         * matched against the group fractions), where it lands when it
         * settles (fl), and how settled it is (s). */
        this.blobs = [];
        const rng = mulberry32(77);
        for (let i = 0; i < 120; i++) this.blobs.push({
            psi: rng() * 6.283, phi: rng() * 6.283, k: 0.3 + 0.7 * Math.sqrt(rng()),
            js: 0.8 + 0.4 * rng(), jl: 0.75 + 0.5 * rng(), sz: 0.7 + 0.6 * rng(),
            ph: rng() * 6.3, u: rng(), fl: 0.9 * Math.sqrt(rng()), s: 0
        });
        /* Integrated phases, in radians, and the two lagged angular speeds. */
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

    /* view: a blended view (viewOf/lerpView); hist: {learn, sop}; opts: {scn, phase, t, frac, dt, title, dashLabel} */
    frame(view, hist, opts) {
        const ctx = this.ctx, cw = this.cw, ch = this.ch;
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = PAPER; ctx.fillRect(0, 0, cw, ch);
        const f = opts.frac == null ? 1 : opts.frac;
        const H = { learn: lerpHist(hist.learn, f), sop: lerpHist(hist.sop, f) };
        const tShown = H.learn.t.length ? H.learn.t[H.learn.t.length - 1] : 0;
        /* On a phone the canvas is taller than it is wide, and the two-column
         * desktop layout puts the vessel in a 140 px column — which clips the
         * labels off both of its sides, because they are drawn outside the
         * glass. So below 720 px the vessel takes the full width and the
         * charts stack underneath it. */
        const narrow = cw < 720;
        const o2 = Object.assign({}, opts, { t: tShown, narrow, compact: narrow });
        const axisH = this.drawDayAxis(o2, 0, 0, cw);
        if (narrow) {
            const vesselH = Math.max(300, (ch - axisH) * 0.56);   // leave the charts room for their lanes
            this.drawVessel(view, 0, axisH, cw, vesselH, o2);
            this.drawCharts(H, 0, axisH + vesselH, cw, ch - axisH - vesselH - 10, o2);
        } else {
            const vesselW = Math.min(420, Math.max(240, cw * 0.34));
            this.drawVessel(view, 0, axisH, vesselW, ch - axisH, o2);
            this.drawCharts(H, vesselW + 6, axisH + 8, cw - vesselW - 16, ch - axisH - 18, o2);
        }
    }

    /* ---------------------------------------------------------- day axis */
    drawDayAxis(opts, x0, y0, w) {
        const ctx = this.ctx;
        const scn = opts.scn;
        const hours = scn ? scn.hours : 360;
        const days = hours / 24;
        const t = opts.t || 0;
        const narrow = !!opts.narrow;
        const gx = x0 + 16, gw = w - 32 - (narrow ? 0 : 230);
        const px = (h) => gx + h / hours * gw;
        const y = y0 + 40, hh = 10;
        ctx.fillStyle = RULE; ctx.fillRect(gx, y, gw, hh);
        if (scn) {
            let from = -1;
            for (let h = 0; h <= hours; h++) {
                const closed = h < hours && !calendarAt(scn, h).labOpen;
                if (closed && from < 0) from = h;
                if (!closed && from >= 0) { ctx.fillStyle = RULE_2; ctx.fillRect(px(from), y, px(h) - px(from), hh); from = -1; }
            }
        }
        ctx.fillStyle = G_PROD; ctx.fillRect(gx, y, Math.max(0, px(t) - gx), hh);
        ctx.font = "10.5px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        // a tick every day, a number every few — the run length differs by product
        const step = days > 22 ? 5 : days > 16 ? 4 : 3;
        for (let d = 0; d <= days; d++) {
            ctx.fillStyle = RULE_2; ctx.fillRect(px(d * 24), y - 3, 1, hh + 6);
            if (d % step === 0 || d === Math.round(days)) {
                ctx.fillStyle = INK_MUTED;
                ctx.fillText(d === 0 ? "day 0" : "" + d, px(d * 24), y + hh + 14);
            }
        }
        ctx.textAlign = "left";
        ctx.fillStyle = INK; ctx.font = "500 16px " + SERIF;
        ctx.fillText(`Day ${(t / 24).toFixed(1)}`, gx, y - 12);
        /* THREE THINGS USED TO SHARE THIS BASELINE and the longest of them
         * won: a phase sentence like "CHIR in the vessel — the next fate
         * decision is being made now" ran straight through the right-aligned
         * harvest note. Now the note sits under the bar, and the sentence is
         * measured against the room actually left and dropped if it does not
         * fit rather than overprinting. */
        const noteY = y + hh + 29;
        if (!narrow) {
            ctx.textAlign = "right"; ctx.fillStyle = INK_FAINT; ctx.font = "10.5px 'Segoe UI', sans-serif";
            ctx.fillText(`harvest on day ${days.toFixed(0)} · shaded = weekend, no assays`, gx + gw, noteY);
            ctx.textAlign = "left";
        }
        if (opts.phase) {
            const [head, body] = opts.phase;
            const px0 = gx + 74;
            ctx.fillStyle = G_PROD; ctx.font = "600 13px 'Segoe UI', sans-serif";
            ctx.fillText(head, px0, y - 12);
            const hw = ctx.measureText(head).width;
            if (!narrow) {
                ctx.fillStyle = INK_MUTED; ctx.font = "12px 'Segoe UI', sans-serif";
                const bx = px0 + hw + 8, room = gx + gw - bx;
                let txt = "— " + body;
                if (ctx.measureText(txt).width > room) {
                    while (txt.length > 12 && ctx.measureText(txt + "…").width > room) txt = txt.slice(0, -1);
                    txt = txt.length > 12 ? txt + "…" : "";
                }
                if (txt) ctx.fillText(txt, bx, y - 12);
            }
        }
        return 92;
    }

    /* ------------------------------------------------------------ vessel */
    /* A 100 mL glass vessel in a water jacket, a stainless headplate, an
     * overhead drive and a four-blade 45° pitched-blade turbine. It is
     * HEADSPACE-AERATED (MODEL.md: kLa depends on the stirrer alone), which is
     * how aggregate cultures of pluripotent cells are actually run because
     * bursting bubbles shred them — so there is no sparger and there are no
     * bubbles. Gas goes in over the liquid and out through the exhaust filter,
     * and the tubes show it moving.
     *
     * EVERYTHING THAT TURNS IS INTEGRATED, NOT READ OFF THE CLOCK. The first
     * version set the impeller angle to wallclock × rpm, which is fine until
     * the rpm changes: the angle is then rewound or fast-forwarded by
     * (clock × Δrpm), and with the clock in the thousands of seconds every
     * 20 rpm slew step and every stirrer fault spun the impeller backwards for
     * sixteen frames and snapped it. The angle now advances by ω·dt each
     * frame; the rpm only sets ω, through a short lag for the motor and a
     * longer one for the liquid, which is what a real stirrer looks like when
     * its setpoint moves.
     *
     * WHAT THE AGGREGATES DO. A down-pumping turbine drives one circulation
     * loop — down the axis, out along the dish, up the wall, back in across
     * the surface — with a slower swirl around it, so each aggregate rides a
     * nested loop in the meridional plane while turning about the shaft. When
     * the stirrer drops below ~40 rpm (an agitator fault lands at 20–35) they
     * settle onto the dish in a few seconds and lift off again when it
     * recovers, which is what a 300 µm aggregate at 2–3 mm/s does.
     *
     * SCALE. Drawn to a 55 mm inner diameter with the surface at the 100 mL
     * line, and the vortex depth is (ωR)²/2g at that size: 6 mm at 120 rpm,
     * a millimetre and a half at 60. The aggregates are the one dishonest
     * thing — at true scale a 300 µm aggregate is a pixel and a half, so they
     * are drawn about six times larger than life. */
    drawVessel(r, x0, y0, w, h, opts) {
        const ctx = this.ctx;
        const L = r.lin;
        const G = groupsOf(L);
        const compact = !!opts.compact;
        const dt = opts.dt == null ? 1 / 60 : Math.min(0.1, Math.max(0, opts.dt));
        const reserve = compact ? 128 : 220;
        const tagL = compact ? 88 : 108, tagR = compact ? 76 : 92;
        const vw = Math.min(w * (compact ? 0.40 : 0.46), (h - reserve) * (compact ? 0.5 : 0.42), Math.max(90, w - tagL - tagR));
        const cx = x0 + w / 2, R = vw / 2, vx = cx - R;
        const wall = Math.max(2.5, vw * 0.035);
        const ey = vw * 0.09;                       // what a circle becomes, seen from a little above
        const jw = Math.max(5, vw * 0.06);          // the jacket gap
        const mh = clamp(vw * 0.12, 20, 30), mw = clamp(vw * 0.14, 20, 34);   // the drive
        const hpT = 11, hpE = ey * 0.85;            // headplate thickness and its ellipse
        const vy = y0 + (compact ? 22 : 30) + mh + 8 + hpE + hpT;
        const vh = Math.min(h - reserve - (vy - y0), vw * 2.0);
        const bottom = vy + vh;
        const rb = vw * 0.40;                       // the dish
        const medTop = vy + vh * 0.17;              // the 100 mL line
        const pxmm = (vw - 2 * wall) / 55;
        const rpm = r.dist.rpmOverride != null ? r.dist.rpmOverride : r.act.rpm;
        const Nv = r.Nv;
        const turb = 1 - Math.exp(-Nv / 3);         // cells make the medium milky
        const milk = [236, 233, 226];
        const col = phenolRed(r.colourVal).map((v, i) => Math.round(lerp(v, milk[i], 0.42 * turb)));
        const deadF = Math.min(0.45, r.dead / 5);
        const colL = col.map(v => Math.round(lerp(v, 150, deadF)));
        const jt = [214, 226, 236].map((v, i) => Math.round(lerp(v, [240, 222, 206][i], clamp((r.T - 33) / 6, 0, 1))));

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

        const body = (inset, top) => {
            const i = inset || 0, t = top == null ? vy : top;
            const bx0 = vx + i, bx1 = vx + vw - i, by = bottom - i, ry = rb + Math.max(0, -i) * 0.6;
            ctx.beginPath();
            ctx.moveTo(bx0, t); ctx.lineTo(bx0, by - ry);
            ctx.bezierCurveTo(bx0, by + ry / 3, bx1, by + ry / 3, bx1, by - ry);
            ctx.lineTo(bx1, t); ctx.closePath();
        };
        const floorY = (rho) => bottom - wall - rb * Math.pow(rho / R, 2);

        /* ---- base plate and the jacket, behind the glass ---- */
        const bg0 = ctx.createLinearGradient(0, bottom + jw + 3, 0, bottom + jw + 17);
        bg0.addColorStop(0, "#c2c6ca"); bg0.addColorStop(1, "#9ea3a8");
        ctx.fillStyle = bg0; ctx.beginPath(); ctx.roundRect(vx - jw - 22, bottom + jw + 3, vw + 2 * jw + 44, 14, 4); ctx.fill();
        body(-jw, vy + 8);
        ctx.fillStyle = rgb(jt, 0.55); ctx.fill();
        ctx.strokeStyle = "rgba(30,34,38,0.22)"; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = "#9aa0a6";
        for (const fy of [0.24, 0.80]) ctx.fillRect(vx + vw + jw - 1, vy + vh * fy, 11, 6);

        /* ---- inside the glass ---- */
        ctx.save(); body(); ctx.clip();
        ctx.fillStyle = rgb([239, 237, 231].map((v, i) => Math.round(lerp(v, jt[i], 0.3))));
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
            const bx = cx + Math.cos(th) * R * 0.85, gw = R * 0.35;
            const sw = ctx.createLinearGradient(bx - gw, 0, bx + gw, 0);
            sw.addColorStop(0, "rgba(255,255,255,0)"); sw.addColorStop(0.5, `rgba(255,255,255,${0.07 * s})`); sw.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = sw; ctx.fillRect(bx - gw, medTop, 2 * gw, bottom - medTop);
        }

        /* ---- the aggregates, on their circulation loop ---- */
        const A = Math.max(0, r.A);
        const nShow = Math.round(Math.min(this.blobs.length, 8 + A * 40));
        const dmm = r.d / 1000;
        const rBase = pxmm * 6 * (dmm <= 0.4 ? dmm : 0.4 + 0.25 * Math.log(dmm / 0.4));
        const fP = Nv > 1e-9 ? G[0].of(r.N) / Nv : 0, fM = Nv > 1e-9 ? G[1].of(r.N) / Nv : 0;
        const gcol = [hex2(G_PROD), hex2(G_MID), hex2(G_OTHER)];
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
        const drawBlob = (o) => {
            const edge = 0.04;
            const wP = clamp((fP - o.u) / edge + 0.5, 0, 1);
            const wM = clamp((fP + fM - o.u) / edge + 0.5, 0, 1) * (1 - wP);
            const wO = 1 - wP - wM;
            const base = [0, 1, 2].map(c => Math.round(gcol[0][c] * wP + gcol[1][c] * wM + gcol[2][c] * wO));
            const rg = ctx.createRadialGradient(o.sx - o.rr * 0.35, o.sy - o.rr * 0.35, o.rr * 0.1, o.sx, o.sy, o.rr);
            rg.addColorStop(0, rgb(shade(base, 1.35))); rg.addColorStop(0.65, rgb(base)); rg.addColorStop(1, rgb(shade(base, 0.55)));
            ctx.globalAlpha = (0.5 + 0.5 * o.depth) * (1 - 0.55 * turb * (1 - o.depth));
            ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(o.sx, o.sy, o.rr, 0, 6.283); ctx.fill();
            if (coreR > 0.05 && o.rr > 2.5) { ctx.fillStyle = "rgba(30,34,38,0.5)"; ctx.beginPath(); ctx.arc(o.sx, o.sy, o.rr * coreR, 0, 6.283); ctx.fill(); }
        };
        back.forEach(drawBlob); ctx.globalAlpha = 1;

        /* ---- shaft and a 45° pitched-blade turbine, a third of the way up ---- */
        const iy = vy + vh * 0.72;
        const Rimp = R * 0.45, hubR = R * 0.07, bw = R * 0.16, hubH = bw * 0.9;
        ctx.strokeStyle = METAL_LIGHT; ctx.lineWidth = Math.max(2.5, vw * 0.022);
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
            ctx.fillStyle = rgb([154, 160, 166].map(v => Math.round(lerp(v * 0.75, 236, bl.bright))));
            ctx.beginPath();
            bl.pts.forEach((p, i) => { const X = cx + p.x, Y = iy - p.y + p.z * k3; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = "rgba(30,34,38,0.28)"; ctx.lineWidth = 0.8; ctx.stroke();
        };
        const blades = [0, 1, 2, 3].map(k => bladeOf(M.imp + k * Math.PI / 2)).sort((a, b) => a.z - b.z);
        blades.filter(b => b.z < 0).forEach(drawBlade);
        const hg0 = ctx.createLinearGradient(cx - hubR, 0, cx + hubR, 0);
        hg0.addColorStop(0, "#8e9398"); hg0.addColorStop(0.45, "#d6dade"); hg0.addColorStop(1, "#7e8388");
        ctx.fillStyle = hg0; ctx.fillRect(cx - hubR, iy - hubH / 2, 2 * hubR, hubH);
        ctx.beginPath(); ctx.ellipse(cx, iy + hubH / 2, hubR, hubR * k3, 0, 0, Math.PI); ctx.fill();
        ctx.fillStyle = "#c9ced3"; ctx.beginPath(); ctx.ellipse(cx, iy - hubH / 2, hubR, hubR * k3, 0, 0, 6.283); ctx.fill();
        blades.filter(b => b.z >= 0).forEach(drawBlade);

        /* ---- two probes, well above the turbine, where a headplate puts them ---- */
        const probe = (fx, tint, len, kind) => {
            const x = vx + vw * fx, pw = Math.max(3, vw * 0.028);
            ctx.strokeStyle = METAL_LIGHT; ctx.lineWidth = pw;
            ctx.beginPath(); ctx.moveTo(x, vy - 2); ctx.lineTo(x, vy + len - 6); ctx.stroke();
            ctx.fillStyle = tint; ctx.fillRect(x - pw / 2, vy + len - 22, pw, 6);
            if (kind === "glass") { ctx.fillStyle = "rgba(226,238,246,0.95)"; ctx.beginPath(); ctx.ellipse(x, vy + len, pw * 0.7, pw * 0.95, 0, 0, 6.283); ctx.fill(); }
            else { ctx.fillStyle = "#3d4247"; ctx.beginPath(); ctx.roundRect(x - pw * 0.6, vy + len - 7, pw * 1.2, 9, 2); ctx.fill(); }
        };
        probe(0.24, C_PH, vh * 0.50, "glass");
        probe(0.76, C_DO, vh * 0.55, "cap");
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
            ctx.fillStyle = d.kind === "feed" ? MEDIUM_COLOURS[r.act.medium] : "#f4f2ed";
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
            ctx.strokeStyle = "rgba(30,34,38,0.30)"; ctx.lineWidth = 1.4; ctx.setLineDash([2.5, 5]); ctx.lineDashOffset = -M.gas * 26;
            ctx.beginPath(); ctx.moveTo(tubeX.gas, vy - 2); ctx.lineTo(tubeX.gas, gasEnd); ctx.stroke();
            ctx.setLineDash([]); ctx.lineDashOffset = 0;
        }
        ctx.restore();   // end of the glass clip

        /* ---- the glass itself: highlights, the edge, what is printed on it ---- */
        ctx.save(); body(); ctx.clip();
        const hl = ctx.createLinearGradient(vx, 0, vx + vw, 0);
        hl.addColorStop(0, "rgba(0,0,0,0.12)"); hl.addColorStop(0.06, "rgba(255,255,255,0)"); hl.addColorStop(0.16, "rgba(255,255,255,0.28)");
        hl.addColorStop(0.30, "rgba(255,255,255,0.05)"); hl.addColorStop(0.72, "rgba(255,255,255,0)"); hl.addColorStop(0.83, "rgba(255,255,255,0.22)");
        hl.addColorStop(0.88, "rgba(255,255,255,0)"); hl.addColorStop(0.97, "rgba(0,0,0,0.04)"); hl.addColorStop(1, "rgba(0,0,0,0.16)");
        ctx.fillStyle = hl; ctx.fillRect(vx, vy, vw, vh);
        const yml = (ml) => medTop + (1 - ml / 100) * (bottom - rb * 0.3 - medTop);
        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1; ctx.font = "8.5px 'Segoe UI', sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.textAlign = "right";
        for (const ml of [25, 50, 75, 100]) {
            const gy = Math.round(yml(ml)) + 0.5;
            ctx.beginPath(); ctx.moveTo(vx + vw - 20, gy); ctx.lineTo(vx + vw - 9, gy); ctx.stroke();
            if (vw > 120) ctx.fillText(ml === 100 ? "100 mL" : "" + ml, vx + vw - 23, gy + 3);
        }
        ctx.restore();
        body(); ctx.strokeStyle = "rgba(30,34,38,0.34)"; ctx.lineWidth = 1.5; ctx.stroke();
        body(wall); ctx.strokeStyle = "rgba(30,34,38,0.10)"; ctx.lineWidth = 1; ctx.stroke();

        /* ---- headplate, ports, exhaust filter and the overhead drive ---- */
        const hpY = vy - hpT, hpR = R + 9;
        const hg = ctx.createLinearGradient(cx - hpR, 0, cx + hpR, 0);
        hg.addColorStop(0, "#7e8388"); hg.addColorStop(0.3, "#c9ced3"); hg.addColorStop(0.6, "#b4b9be"); hg.addColorStop(1, "#6f757b");
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.moveTo(cx - hpR, hpY); ctx.lineTo(cx - hpR, vy); ctx.ellipse(cx, vy, hpR, hpE, 0, Math.PI, 0, true); ctx.lineTo(cx + hpR, hpY); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#d3d7db"; ctx.beginPath(); ctx.ellipse(cx, hpY, hpR, hpE, 0, 0, 6.283); ctx.fill();
        ctx.strokeStyle = "rgba(30,34,38,0.25)"; ctx.lineWidth = 1; ctx.stroke();
        const ports = [["exhaust", 0.10], ["pH", 0.24], ["feed", 0.36], ["", 0.5], ["base", 0.64], ["O₂", 0.76], ["gas", 0.90]];
        for (const [, fx] of ports) {
            const px = vx + vw * fx;
            ctx.fillStyle = "#8e9398"; ctx.fillRect(px - 4, hpY - 8, 8, 8);
            ctx.fillStyle = "#b8bdc2"; ctx.beginPath(); ctx.ellipse(px, hpY - 8, 4, 1.6, 0, 0, 6.283); ctx.fill();
        }
        ctx.strokeStyle = "#8e9398"; ctx.lineWidth = 1.6;
        for (const x of [tubeX.feed, tubeX.base, tubeX.gas]) { ctx.beginPath(); ctx.moveTo(x, hpY - 8); ctx.lineTo(x, hpY - 24); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(tubeX.exh, hpY - 8); ctx.lineTo(tubeX.exh, hpY - 20); ctx.stroke();
        if (r.dist.gasOK) {
            ctx.strokeStyle = "rgba(30,34,38,0.30)"; ctx.lineWidth = 1.4; ctx.setLineDash([2.5, 5]); ctx.lineDashOffset = M.gas * 26;
            ctx.beginPath(); ctx.moveTo(tubeX.gas, hpY - 24); ctx.lineTo(tubeX.gas, hpY - 8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(tubeX.exh, hpY - 8); ctx.lineTo(tubeX.exh, hpY - 20); ctx.stroke();
            ctx.setLineDash([]); ctx.lineDashOffset = 0;
        }
        ctx.fillStyle = "#e6e8ea"; ctx.beginPath(); ctx.roundRect(tubeX.exh - 6, hpY - 30, 12, 11, 4); ctx.fill();
        ctx.strokeStyle = "rgba(30,34,38,0.3)"; ctx.lineWidth = 1; ctx.stroke();
        const mTop = hpY - hpE - 6 - mh;
        ctx.fillStyle = "#6f757b"; ctx.fillRect(cx - mw * 0.22, hpY - hpE - 6, mw * 0.44, 7);
        const mg = ctx.createLinearGradient(cx - mw / 2, 0, cx + mw / 2, 0);
        mg.addColorStop(0, "#7e8388"); mg.addColorStop(0.35, "#c4c9ce"); mg.addColorStop(1, "#8e9398");
        ctx.fillStyle = mg; ctx.beginPath(); ctx.roundRect(cx - mw / 2, mTop, mw, mh, 3); ctx.fill();
        ctx.fillStyle = "#b8bdc2"; ctx.beginPath(); ctx.ellipse(cx, mTop, mw / 2, mw * 0.12, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = INK_FAINT; ctx.font = "9px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        if (vw >= 34 * 6) ports.forEach(([l, fx]) => { if (l) ctx.fillText(l, vx + vw * fx, hpY - 34); });

        /* ---- labels around the vessel ---- */
        ctx.fillStyle = INK; ctx.font = "500 14px " + SERIF;
        ctx.fillText(opts.title || "", cx, mTop - 10);
        ctx.font = "11px 'Segoe UI', sans-serif";
        const o2 = r.dist.gasOK ? r.act.o2 : 0.21;
        ctx.textAlign = "left";
        /* The tags step down the sides by a PIXEL step, clamped: spread as a
         * fraction of the vessel height they overprinted each other on a
         * phone, where the vessel is 140 px tall and six cue lines shared
         * 50 of them. */
        const step = clamp(vh * 0.062, 14, 26);
        const lx = vx + vw + jw + 12;
        ctx.fillStyle = C_PH; ctx.fillText(`pH ${r.pH.toFixed(2)}`, lx, vy + vh * 0.5 + 4);
        ctx.fillStyle = C_DO; ctx.fillText(`O₂ ${r.DO.toFixed(0)} %`, lx, vy + vh * 0.5 + 4 + step);
        ctx.fillStyle = INK_MUTED; ctx.fillText(`${r.T.toFixed(1)} °C`, lx, vy + vh * 0.5 + 4 + 2 * step);
        ctx.textAlign = "right";
        const rx0 = vx - jw - 12, ty0 = vy + Math.min(vh * 0.10, 14);
        ctx.fillStyle = r.dist.gasOK ? INK_MUTED : "#b23a2f";
        ctx.fillText(r.dist.gasOK ? `gas ${(o2 * 100).toFixed(0)} % O₂` : "GAS OUT", rx0, ty0);
        ctx.fillStyle = r.dist.rpmOverride != null ? "#b23a2f" : INK_MUTED;
        ctx.fillText(`${rpm.toFixed(0)} rpm`, rx0, ty0 + step);
        ctx.fillStyle = r.dist.pumpOK ? INK_MUTED : "#b23a2f";
        ctx.fillText(r.dist.pumpOK ? `${L.media[r.act.medium].key} ${r.act.perf.toFixed(1)} vol/d` : "PUMP OUT", rx0, ty0 + 2 * step);
        for (let i = 0; i < L.nCue; i++) {
            const spec = L.cues[i], on = r.cue[i] > 0.02 * spec.hi;
            ctx.fillStyle = on ? CUE_COLOURS[i] : INK_FAINT;
            const val = spec.hi >= 20 ? r.cue[i].toFixed(0) : r.cue[i].toFixed(1);
            ctx.fillText(`${spec.short} ${on ? val + " " + spec.unit : "—"}`, rx0, ty0 + (3.7 + i) * step);
        }

        /* Under the stand, INSIDE the vessel column. Two earlier versions of
         * this got it wrong in opposite directions: centring on the glass ran
         * the ends under the charts, and centring on the whole canvas put the
         * text where the charts are drawn -- and they are drawn after the
         * vessel, so they painted straight over it. The column is the only
         * space this block owns, so the text is made to fit the column: the
         * headline splits into a value line and a name line, and `fit` steps
         * any line down until it is inside the width. */
        const ry = bottom + jw + 44;
        const tx = x0 + w / 2;
        ctx.textAlign = "center";
        const room = w - 12;
        const fit = (text, weight, size, family, min) => {
            let px = size;
            for (; px > min; px -= 0.5) {
                ctx.font = `${weight} ${px}px ${family}`;
                if (ctx.measureText(text).width <= room) break;
            }
            return px;
        };
        const headline = `${r.product.toFixed(2)} M / mL`;
        const subject = `${L.product} · ${(r.purity * 100).toFixed(0)} % of the culture`;
        ctx.fillStyle = INK; ctx.font = `500 ${fit(headline, 500, 19, SERIF, 13)}px ${SERIF}`;
        ctx.fillText(headline, tx, ry);
        ctx.fillStyle = INK; ctx.font = `500 ${fit(subject, 500, 12.5, SERIF, 9.5)}px ${SERIF}`;
        ctx.fillText(subject, tx, ry + 17);
        const F1 = "'Segoe UI', sans-serif";
        const cells = `${Nv.toFixed(2)} M cells/mL · ${(r.viability * 100).toFixed(0)} % alive`;
        const aggr = `aggregates ${r.d.toFixed(0)} µm (wants ${L.agg.band[0]}–${L.agg.band[1]})`;
        const funcs = `${L.func.label}: ${(r.func * 100).toFixed(0)} % of a good batch`;
        ctx.fillStyle = INK_MUTED;
        ctx.font = `400 ${fit(cells, 400, 11.5, F1, 9)}px ${F1}`; ctx.fillText(cells, tx, ry + 35);
        ctx.font = `400 ${fit(aggr, 400, 11.5, F1, 9)}px ${F1}`; ctx.fillText(aggr, tx, ry + 50);
        ctx.font = `400 ${fit(funcs, 400, 11.5, F1, 9)}px ${F1}`; ctx.fillText(funcs, tx, ry + 65);
        let yy = ry + 83;
        if (r.fCore > 0.01) {
            const t1 = `${(r.fCore * 100).toFixed(0)} % of each aggregate is starved of oxygen`;
            ctx.fillStyle = "#b23a2f"; ctx.font = `400 ${fit(t1, 400, 11.5, F1, 8.5)}px ${F1}`;
            ctx.fillText(t1, tx, yy); yy += 16;
        }
        const ev = r.dist.active || [];
        if (ev.length) {
            const t2 = "⚠ " + ev.map(e => EVENT_TYPES[e.type].label).join(" · ");
            ctx.fillStyle = "#b23a2f"; ctx.font = `600 ${fit(t2, 600, 12, F1, 8.5)}px ${F1}`;
            ctx.fillText(t2, tx, yy);
        }
        if (r.failed) {
            ctx.fillStyle = "rgba(253,252,250,0.8)"; ctx.fillRect(vx - 6, vy + vh / 2 - 26, vw + 12, 40);
            ctx.fillStyle = "#b23a2f"; ctx.font = `500 ${fit("CULTURE LOST", 500, 17, SERIF, 11)}px ${SERIF}`; ctx.textAlign = "center";
            ctx.fillText("CULTURE LOST", cx, vy + vh / 2 - 6);
            ctx.font = `400 ${fit(r.failReason || "", 400, 11.5, F1, 8.5)}px ${F1}`; ctx.fillText(r.failReason || "", cx, vy + vh / 2 + 9);
        }
    }

    /* ------------------------------------------------------------ charts */
    drawCharts(hist, x0, y0, w, h, opts) {
        const ctx = this.ctx;
        const L = opts.scn ? opts.scn.lin : LINEAGES[0];
        const G = groupsOf(L);
        const hours = opts.scn ? opts.scn.hours : 360;
        const Lh = hist.learn, S = hist.sop, n = Lh.t.length;
        const gx = x0 + 34, gw = w - 40;
        const px = (t) => gx + (t / hours) * gw;
        const smooth = (arr, k) => arr.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - k); j <= i; j++) { s += arr[j]; c++; } return s / c; });
        const dashLabel = opts.dashLabel || "protocol";
        const rows = [
            { title: "Cells in the vessel  (M/mL)", legend: G.map(g => [g.label, g.colour, "area"]).concat([[dashLabel, C_PROT, "dash"]]) },
            { title: "What the cells are eating  (mM)", legend: [["glucose", C_GLC, "line"], ["lactate — their waste", C_LAC, "line"]] },
            { title: "pH and dissolved oxygen", legend: [["pH  (band = 7.1–7.5)", C_PH, "line"], ["oxygen, % air sat.", C_DO, "line"]] },
            /* NO SWATCH LEGEND. Six colour chips reading "CHIR", "RA",
             * "SANT-1" named the colours without saying what any of them
             * were or what being on meant. This row draws one labelled lane
             * per channel instead, and each lane carries its own sentence. */
            /* Taller still on a phone, where the canvas is one column and
             * six lanes in a quarter of it are unreadable. */
            { title: "What the controller did", sub: "one lane per pump · each on its own scale", legend: [], tall: opts.narrow ? 3 : 1.6 }
        ];
        /* The controller row holds one lane per dosing pump plus the
         * medium strip, so it is given half again the height of the rest. */
        const gap = opts.narrow ? 22 : 30;
        const weights = rows.map(r => r.tall || 1);
        const wSum = weights.reduce((a, b) => a + b, 0);
        const avail = h - gap * rows.length;
        let yCur = y0 + 22;
        rows.forEach((row, i) => {
            const rh = avail * weights[i] / wSum;
            const ry = yCur, rb = ry + rh;
            yCur = rb + gap;
            ctx.textAlign = "left"; ctx.fillStyle = INK; ctx.font = "600 11.5px 'Segoe UI', sans-serif";
            ctx.fillText(row.title, gx, ry - 8);
            let lx = gx + ctx.measureText(row.title).width + 14;
            if (row.sub) {
                ctx.font = "10.5px 'Segoe UI', sans-serif";
                ctx.fillStyle = INK_FAINT; ctx.fillText(row.sub, lx, ry - 8);
                lx += ctx.measureText(row.sub).width + 18;
            }
            ctx.font = "10.5px 'Segoe UI', sans-serif";
            for (const [lab, c, kind] of row.legend) {
                if (lx > gx + gw - 70) break;
                ctx.fillStyle = c;
                if (kind === "area") ctx.fillRect(lx, ry - 16, 10, 9);
                else if (kind === "dash") { ctx.strokeStyle = c; ctx.setLineDash([3, 2]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(lx, ry - 12); ctx.lineTo(lx + 12, ry - 12); ctx.stroke(); ctx.setLineDash([]); }
                else ctx.fillRect(lx, ry - 13, 12, 2.5);
                ctx.fillStyle = INK_MUTED; ctx.fillText(lab, lx + 15, ry - 8);
                lx += ctx.measureText(lab).width + 26;
            }
            ctx.fillStyle = CARD; ctx.fillRect(gx, ry, gw, rh);
            if (opts.scn) {
                let from = -1;
                for (let t = 0; t <= hours; t++) {
                    const closed = t < hours && !calendarAt(opts.scn, t).labOpen;
                    if (closed && from < 0) from = t;
                    if (!closed && from >= 0) { ctx.fillStyle = "rgba(30,34,38,0.05)"; ctx.fillRect(px(from), ry, px(t) - px(from), rh); from = -1; }
                }
            }
            ctx.strokeStyle = RULE; ctx.lineWidth = 1; ctx.strokeRect(gx, ry, gw, rh);
            ctx.fillStyle = RULE_2; for (let d = 0; d * 24 <= hours; d++) ctx.fillRect(px(d * 24), rb - 3, 1, 3);
            const py = (v, max, min) => { min = min || 0; return rb - Math.max(0, Math.min(1, (v - min) / (max - min))) * rh; };
            const line = (arr, ts, max, colour, dashed, min, width) => {
                if (!arr || arr.length < 2) return;
                ctx.strokeStyle = colour; ctx.lineWidth = width || 1.6; ctx.setLineDash(dashed ? [3, 3] : []);
                ctx.beginPath();
                for (let k = 0; k < arr.length; k++) { const X = px(ts[k]), Y = py(arr[k], max, min); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
                ctx.stroke(); ctx.setLineDash([]);
            };
            const axis = (top, bottom, colour, dy) => {
                ctx.fillStyle = colour || INK_FAINT; ctx.font = "9.5px 'Segoe UI', sans-serif"; ctx.textAlign = "right";
                ctx.fillText(top, gx - 5, ry + 9 + (dy || 0)); if (bottom != null) ctx.fillText(bottom, gx - 5, rb); ctx.textAlign = "left";
            };
            switch (i) {
                case 0: {
                    let maxV = 2;
                    for (let k = 0; k < n; k++) maxV = Math.max(maxV, Lh.Nv[k], S.Nv[k] || 0);
                    let cum = Lh.N.map(() => 0);
                    for (const gi of [2, 1, 0]) {
                        const next = Lh.N.map((N, k) => cum[k] + G[gi].of(N));
                        ctx.fillStyle = G[gi].colour; ctx.globalAlpha = 0.9; ctx.beginPath();
                        for (let k = 0; k < n; k++) k ? ctx.lineTo(px(Lh.t[k]), py(next[k], maxV)) : ctx.moveTo(px(Lh.t[k]), py(next[k], maxV));
                        for (let k = n - 1; k >= 0; k--) ctx.lineTo(px(Lh.t[k]), py(cum[k], maxV));
                        ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
                        cum = next;
                    }
                    line(S.prod, S.t, maxV, C_PROT, true, 0, 1.6);
                    axis(maxV.toFixed(1), "0");
                    break;
                }
                case 1:
                    line(Lh.glc, Lh.t, 25, C_GLC); line(Lh.lac, Lh.t, 25, C_LAC);
                    axis("25", "0");
                    break;
                case 2:
                    ctx.fillStyle = "rgba(47,122,78,0.11)"; ctx.fillRect(gx, py(7.5, 8, 6.5), gw, py(7.1, 8, 6.5) - py(7.5, 8, 6.5));
                    line(smooth(Lh.DO, 8), Lh.t, 120, C_DO, false, 0, 1.6);
                    line(Lh.pH, Lh.t, 8, C_PH, false, 6.5, 1.8);
                    axis("pH 8", "6.5", C_PH); axis("120 %", null, C_DO, 11);
                    break;
                case 3: {
                    /* ONE LANE PER CHANNEL, NEVER OVERLAID. Six half-opaque
                     * areas stacked in one box could not be read: whichever
                     * pump ran last buried the others, and at a glance there
                     * was no telling which reagent was on. Every pump now
                     * owns a horizontal lane with its own baseline and its
                     * own full scale; the trace is a SQUARE STEP because that
                     * is what a pump does (off, a dose, off) and each lane
                     * names itself. Lanes are spaced so a trace pinned at
                     * full scale still cannot reach the lane above it. */
                    const evH = opts.narrow ? 8 : (opts.scn && opts.scn.events.length) ? 28 : 6;
                    const medH = opts.narrow ? 14 : 16;
                    const lanesTop = ry + evH;
                    const laneArea = Math.max(18, rb - lanesTop - medH - 2);
                    const laneH = laneArea / Math.max(1, L.nCue);
                    const tiny = laneH < 17;
                    /* Lane labels sit inside the plot on a translucent
                     * backdrop, drawn after the trace so it passes behind. */
                    const tag = (text, colour, x, y) => {
                        ctx.font = (tiny ? "8.5px " : "9.5px ") + "'Segoe UI', sans-serif";
                        const wl = ctx.measureText(text).width;
                        ctx.fillStyle = "rgba(253,252,250,0.86)";
                        ctx.fillRect(x - 2, y - 8, wl + 4, 10.5);
                        ctx.fillStyle = colour;
                        ctx.fillText(text, x, y);
                        return wl;
                    };
                    for (let c = 0; c < L.nCue; c++) {
                        const spec = L.cues[c], colour = CUE_COLOURS[c];
                        const ly = lanesTop + c * laneH;
                        const base = ly + laneH - 3;            // this lane's zero
                        const amp = Math.max(4, laneH - 8);     // and its ceiling
                        ctx.strokeStyle = RULE; ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.moveTo(gx, base + 0.5); ctx.lineTo(gx + gw, base + 0.5); ctx.stroke();
                        const vals = Lh.cue.map(rowv => rowv[c]);
                        if (vals.length > 1) {
                            const yOf = (v) => base - Math.max(0, Math.min(1, v / spec.hi)) * amp;
                            ctx.beginPath(); ctx.moveTo(px(Lh.t[0]), yOf(vals[0]));
                            for (let k = 1; k < vals.length; k++) {
                                const X = px(Lh.t[k]);
                                ctx.lineTo(X, yOf(vals[k - 1]));   // hold the dose
                                ctx.lineTo(X, yOf(vals[k]));       // then step
                            }
                            ctx.strokeStyle = colour; ctx.lineWidth = 1.4; ctx.stroke();
                            ctx.lineTo(px(Lh.t[vals.length - 1]), base);
                            ctx.lineTo(px(Lh.t[0]), base); ctx.closePath();
                            ctx.fillStyle = colour; ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1;
                        }
                        const scale = spec.unit === "×" ? `0–${spec.hi}×` : `0–${spec.hi} ${spec.unit}`;
                        /* A LABEL NEEDS A LANE TALL ENOUGH TO HOLD IT. On a
                         * phone six lanes share about 120 px, and shrinking
                         * the font was not enough: the labels stacked on top
                         * of each other and on their own traces. Below 11 px
                         * a lane carries only its short name, and below 8 it
                         * carries nothing at all -- the coloured trace and
                         * the vessel tags still say which reagent is on. */
                        if (laneH >= 8) {
                            const lw = tag(`Adding ${spec.short}`, colour, gx + 4, ly + Math.min(9, laneH - 2));
                            if (!tiny) tag("· " + scale, INK_FAINT, gx + 10 + lw, ly + 9);
                        }
                    }
                    /* The medium is a CHOICE, not a dose, so it is a strip of
                     * NAMED blocks rather than a seventh trace. */
                    const my = rb - medH;
                    for (let k = 0; k < Lh.medium.length; k++) {
                        let j = k;
                        while (j + 1 < Lh.medium.length && Lh.medium[j + 1] === Lh.medium[k]) j++;
                        const X0 = px(Lh.t[k]), X1 = px(Lh.t[Math.min(j + 1, Lh.t.length - 1)]);
                        ctx.fillStyle = MEDIUM_COLOURS[Lh.medium[k]];
                        ctx.globalAlpha = 0.5; ctx.fillRect(X0, my, Math.max(1, X1 - X0) + 0.5, medH - 3); ctx.globalAlpha = 1;
                        const name = L.media[Lh.medium[k]].key;
                        ctx.font = "9px " + "'Segoe UI', sans-serif";
                        const nw = ctx.measureText(name).width;
                        if (X1 - X0 > nw + 12 && (X0 + X1) / 2 - nw / 2 > gx + 62) {
                            ctx.fillStyle = INK; ctx.textAlign = "center";
                            ctx.fillText(name, (X0 + X1) / 2, my + medH - 7); ctx.textAlign = "left";
                        }
                        k = j;
                    }
                    tag("Feeding", INK_MUTED, gx + 4, my + medH - 7);
                    if (opts.scn && opts.scn.events.length) {
                        ctx.font = "9.5px " + "'Segoe UI', sans-serif"; ctx.textAlign = "left";
                        /* Each failure label takes the first of two rows whose
                         * previous label ended before this one starts. */
                        const rowEnds = [];
                        opts.scn.events.forEach((e) => {
                            const X0 = px(e.t0), X1 = px(Math.min(hours, e.t1));
                            ctx.fillStyle = "rgba(178,58,47,0.28)"; ctx.fillRect(X0, ry, Math.max(2, X1 - X0), 6);
                            if (opts.narrow) return;   // on a phone the warning line under the vessel names them
                            const labe = EVENT_TYPES[e.type].label.split(" (")[0];
                            const wl = ctx.measureText(labe).width;
                            if (X0 + wl > gx + gw) return;
                            let r2 = 0;
                            while (r2 < 2 && rowEnds[r2] != null && rowEnds[r2] > X0 - 4) r2++;
                            if (r2 >= 2) return;
                            rowEnds[r2] = X0 + wl + 2;
                            ctx.fillStyle = "#b23a2f"; ctx.fillText(labe, X0 + 2, ry + 15 + r2 * 10);
                        });
                    }
                    break;
                }
            }
            if (n) { const X = px(Lh.t[n - 1]); ctx.strokeStyle = "rgba(30,34,38,0.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, ry); ctx.lineTo(X, rb); ctx.stroke(); }
        });
    }
}

/* ------------------------------------------------------------ network view */
/* Wide enough to name every input as well as every output.
 *
 * The inputs are a hundred-odd numbers in seven blocks, and the blocks are the
 * interesting part: what it can see right now, what it did last hour, what the
 * lab told it and how stale that is, and which of the five products was
 * ordered. The outputs carry the value the reactor actually received, because
 * a red cell on its own says nothing — for a one-way pump it just means off.
 *
 * The activations are EASED towards each forward pass rather than snapped to
 * it: the plant steps once an hour and at the slow playback that is once every
 * sixteen frames, which reads as a stutter however pretty the cells are. */
function outputLabel(o, act, L) {
    if (!act) return ["O₂", "CO₂", "base", "rpm", "perfuse", "glucose"][o] || "out " + o;
    if (o < N_BASE) {
        switch (o) {
            case 0: return `O₂ in gas  ${(act.o2 * 100).toFixed(0)} %`;
            case 1: return `CO₂ in gas  ${(act.co2 * 100).toFixed(1)} %`;
            case 2: return `base pump  ${act.base > 0.05 ? act.base.toFixed(1) + " mM/h" : "off"}`;
            case 3: return `stirrer  ${act.rpm.toFixed(0)} rpm`;
            case 4: return `perfusion  ${act.perf.toFixed(1)} vol/day`;
            case 5: return `glucose feed  ${act.glcFeed > 0.05 ? act.glcFeed.toFixed(1) + " mM/h" : "off"}`;
        }
    }
    const ci = o - N_BASE;
    if (ci < N_CUE) {
        const spec = L.cues[ci];
        if (!spec) return `pump ${ci + 1} — not used`;
        const v = act.cue[ci];
        const on = v > 0.02 * spec.hi;
        return `${spec.short}  ${on ? (spec.hi >= 20 ? v.toFixed(0) : v.toFixed(1)) + " " + spec.unit : "off"}`;
    }
    const mi = o - N_BASE - N_CUE;
    return `feed ${L.media[mi].key}${act.medium === mi ? "  ◀ chosen" : ""}`;
}

function drawNet(cv, net, note, act, lin) {
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#fbfaf7"; ctx.fillRect(0, 0, W, H);
    if (!net) {
        ctx.fillStyle = INK_MUTED; ctx.font = "12.5px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
        const words = (note || "no network in the loop").split(" ");
        let line = "", y = H / 2 - 8;
        for (const wd of words) {
            if (ctx.measureText(line + " " + wd).width > W - 40) { ctx.fillText(line, W / 2, y); y += 16; line = wd; }
            else line = line ? line + " " + wd : wd;
        }
        ctx.fillText(line, W / 2, y);
        return;
    }
    const L = lin || LINEAGES[0];
    const sizes = net.sizes, nL = sizes.length;

    /* eased activations, kept on the function so they survive a brain swap */
    if (!drawNet.sm || drawNet.smNet !== net) {
        drawNet.smNet = net;
        drawNet.sm = sizes.map(n => new Float32Array(n));
    }
    const sm = drawNet.sm;
    for (let l = 0; l < nL; l++) {
        const a = net._buf[l], s = sm[l];
        for (let k = 0; k < s.length; k++) s[k] += (a[k] - s[k]) * 0.22;
    }

    const LEFT = 172, RIGHT = W - 248;
    const top = 16, botH = H - 30;
    const xs = [LEFT, LEFT + (RIGHT - LEFT) * 0.42, LEFT + (RIGHT - LEFT) * 0.78, RIGHT];
    const colW = [13, 11, 11, 13];
    const yOf = (li, idx) => top + (idx + 0.5) / sizes[li] * botH;

    /* the strongest signed contributions into each output */
    const last = nL - 2, wLast = net.weights[last], nIn = sizes[last], nOut = sizes[last + 1], aIn = sm[last];
    const contrib = [];
    for (let o = 0; o < nOut; o++) {
        const base = o * (nIn + 1);
        for (let i = 0; i < nIn; i++) {
            const c = wLast[base + i] * aIn[i];
            if (Math.abs(c) > 0.05) contrib.push([i, o, c]);
        }
    }
    contrib.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
    ctx.lineWidth = 1;
    for (let k = 0; k < Math.min(90, contrib.length); k++) {
        const [i, o, c] = contrib[k];
        ctx.strokeStyle = c >= 0 ? `rgba(29,122,116,${Math.min(0.6, Math.abs(c) * 0.6)})` : `rgba(178,58,47,${Math.min(0.6, Math.abs(c) * 0.6)})`;
        ctx.beginPath(); ctx.moveTo(xs[2] + colW[2], yOf(2, i)); ctx.lineTo(xs[3], yOf(3, o)); ctx.stroke();
    }
    if (!drawNet.sample) {
        drawNet.sample = []; let s0 = 12345;
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
            ctx.strokeStyle = c >= 0 ? `rgba(29,122,116,${a})` : `rgba(178,58,47,${a})`;
            ctx.beginPath(); ctx.moveTo(xs[l] + colW[l], yOf(l, i)); ctx.lineTo(xs[l + 1], yOf(l + 1, o)); ctx.stroke();
        }
    }
    /* the neurons */
    for (let l = 0; l < nL; l++) {
        const nn = sizes[l], a = sm[l], chh = botH / nn;
        for (let k = 0; k < nn; k++) {
            const v = Math.max(-1, Math.min(1, a[k]));
            ctx.fillStyle = v >= 0 ? `rgba(29,122,116,${0.12 + 0.88 * v})` : `rgba(178,58,47,${0.12 - 0.88 * v})`;
            ctx.fillRect(xs[l], top + k * chh, colW[l], Math.max(1, chh - (chh > 3 ? 1 : 0)));
        }
    }
    /* input blocks, named, with a bracket each */
    const groups = inputGroups(L);
    ctx.font = "10px 'Segoe UI', sans-serif"; ctx.textAlign = "right";
    let idx = 0;
    for (const g of groups) {
        const y0 = top + idx / sizes[0] * botH, y1 = top + (idx + g.n) / sizes[0] * botH;
        ctx.strokeStyle = "rgba(30,34,38,0.28)"; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LEFT - 6, y0 + 1); ctx.lineTo(LEFT - 10, y0 + 1);
        ctx.lineTo(LEFT - 10, y1 - 1); ctx.lineTo(LEFT - 6, y1 - 1);
        ctx.stroke();
        const my = (y0 + y1) / 2 + 3.5;
        ctx.fillStyle = INK;
        ctx.fillText(g.label, LEFT - 14, my);
        ctx.fillStyle = INK_FAINT;
        ctx.fillText("" + g.n, LEFT - 20 - ctx.measureText(g.label).width, my);
        idx += g.n;
    }
    /* output labels */
    ctx.textAlign = "left"; ctx.font = "10px 'Segoe UI', sans-serif";
    for (let o = 0; o < nOut; o++) {
        const isMedium = o >= N_BASE + N_CUE;
        const chosen = isMedium && act && act.medium === o - N_BASE - N_CUE;
        const unusedPump = o >= N_BASE && o < N_BASE + N_CUE && !L.cues[o - N_BASE];
        ctx.fillStyle = chosen ? INK : unusedPump ? "#c0bcb4" : INK_MUTED;
        ctx.fillText(outputLabel(o, act, L), xs[3] + colW[3] + 7, yOf(3, o) + 3.5);
    }
    /* column captions */
    ctx.fillStyle = INK_FAINT; ctx.font = "9.5px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
    ["what it sees", "" + sizes[1], "" + sizes[2], "what it does"].forEach((t, l) =>
        ctx.fillText(t, xs[l] + colW[l] / 2, H - 8));
}

/* Fitness history chart (lab mode). */
function drawChart(cv, history) {
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (history.length < 2) return;
    const vals = history.flatMap(h => [h.best, h.avg]).filter(Number.isFinite);
    let min = Math.min(...vals, 0), max = Math.max(...vals, 0.1);
    const px = i => 4 + (i / (history.length - 1)) * (cv.width - 8);
    const py = v => cv.height - 6 - ((v - min) / (max - min)) * (cv.height - 16);
    ctx.strokeStyle = "rgba(30,34,38,0.20)"; ctx.beginPath(); ctx.moveTo(4, py(0)); ctx.lineTo(cv.width - 4, py(0)); ctx.stroke();
    if (max >= 1) { ctx.strokeStyle = "rgba(29,122,116,0.45)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(4, py(1)); ctx.lineTo(cv.width - 4, py(1)); ctx.stroke(); ctx.setLineDash([]); }
    ctx.lineWidth = 1.5;
    for (const [key, color] of [["avg", "#5c636a"], ["best", "#1d7a74"]]) {
        ctx.strokeStyle = color; ctx.beginPath();
        history.forEach((h, i) => i ? ctx.lineTo(px(i), py(h[key])) : ctx.moveTo(px(i), py(h[key])));
        ctx.stroke();
    }
    ctx.fillStyle = INK_MUTED; ctx.font = "10px sans-serif";
    ctx.fillText(max.toFixed(2), 4, 10); ctx.fillText(min.toFixed(2), 4, cv.height - 2);
}
