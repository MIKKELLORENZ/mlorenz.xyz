/* render.js — the poloidal cross-section.
 *
 * Deliberately toy-like. This is a 2-D slice through the doughnut at one
 * toroidal angle: the machine axis is off to the left, the vessel is the tall
 * rounded box, the coils are the little squares outside it, and the blob in the
 * middle is the plasma. Because the whole simulation is axisymmetric, this
 * picture IS the entire world — there is no other angle to look from.
 *
 * The flux contours are computed the same way the physics is: sum every
 * circuit's precomputed Ψ table plus the plasma filaments' own contribution.
 * They are the real field, not a decoration — when the wall eddy currents
 * bunch up under a falling plasma you can see the contours crowd.
 */
"use strict";

const VIEW = { r0: 0.20, r1: 1.60, z0: -0.98, z1: 0.98 };

/* Flux grid — coarse on purpose. 32×46 is 1472 points, and each one costs seven
 * elliptic integrals for the plasma term, so this is recomputed a few times a
 * second rather than every frame. */
const FLUXG = { nr: 32, nz: 46 };

class Renderer {
    constructor(canvas, machine) {
        this.cv = canvas;
        this.ctx = canvas.getContext("2d");
        this.mac = machine;
        this.psi = new Float32Array(FLUXG.nr * FLUXG.nz);
        this.psiAge = 1e9;
        this.wall = buildWallContour(120);
    }

    resize() {
        const wrap = this.cv.parentElement;
        const dpr = Math.min(1.6, window.devicePixelRatio || 1);
        this.cw = wrap.clientWidth; this.ch = wrap.clientHeight;
        this.cv.width = this.cw * dpr; this.cv.height = this.ch * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const sx = this.cw / (VIEW.r1 - VIEW.r0);
        const sy = this.ch / (VIEW.z1 - VIEW.z0);
        this.s = Math.min(sx, sy) * 0.94;
        this.ox = (this.cw - (VIEW.r1 - VIEW.r0) * this.s) / 2 - VIEW.r0 * this.s;
        this.oy = this.ch / 2;
    }
    X(R) { return this.ox + R * this.s; }
    Y(Z) { return this.oy - Z * this.s; }

    /* ------------------------------------------------------------- flux map */
    computeFlux(tok) {
        const mac = this.mac, { nr, nz } = FLUXG;
        const dr = (VIEW.r1 - VIEW.r0) / (nr - 1), dz = (VIEW.z1 - VIEW.z0) / (nz - 1);
        const psi = this.psi;
        psi.fill(0);
        for (let iz = 0; iz < nz; iz++) {
            const Z = VIEW.z0 + iz * dz;
            for (let ir = 0; ir < nr; ir++) {
                const R = VIEW.r0 + ir * dr;
                let v = 0;
                // circuits: straight out of the machine's own tables where the
                // point is inside them, direct evaluation outside (the coils
                // themselves live outside the plasma-region grid)
                for (let j = 0; j < mac.n; j++) {
                    const I = tok.I[j];
                    if (!I) continue;
                    if (R >= GRID.r0 && R <= GRID.r1 && Z >= GRID.z0 && Z <= GRID.z1) {
                        v += I * mac.sample(mac.gPsi[j], R, Z);
                    } else {
                        for (const e of mac._elements(j)) v += I * e.turns * loopPsi(e.R, e.Z, R, Z, mac._rc(j));
                    }
                }
                // plasma filaments
                for (let k = 0; k < PLASMA.NF; k++) {
                    v += tok.Ip * tok.fil.w[k] * loopPsi(tok.fil.R[k], tok.fil.Z[k], R, Z, 0.03);
                }
                psi[iz * nr + ir] = v;
            }
        }
        this.psiAge = 0;
    }

    /* Marching squares, line segments only — no need for closed polygons when
     * all you want is the look of a flux map. */
    drawContours() {
        const { nr, nz } = FLUXG;
        const dr = (VIEW.r1 - VIEW.r0) / (nr - 1), dz = (VIEW.z1 - VIEW.z0) / (nz - 1);
        const psi = this.psi;
        // Contour levels are taken from the range INSIDE the vessel only. Using
        // the whole grid puts them at the mercy of the coils, where Ψ blows up a
        // couple of centimetres from a conductor — every level then lands outside
        // the wall and the plasma sits in a single flat band with no structure.
        let lo = Infinity, hi = -Infinity;
        for (let iz = 0; iz < nz; iz++) {
            const Z = VIEW.z0 + iz * dz;
            for (let ir = 0; ir < nr; ir++) {
                const R = VIEW.r0 + ir * dr;
                if (wallClearance(R, Z) < 0.01) continue;
                const v = psi[iz * nr + ir];
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
        if (!(hi > lo)) return;
        // widen a little so a few contours still show outside the wall
        const pad = (hi - lo) * 0.45;
        lo -= pad; hi += pad;
        const ctx = this.ctx;
        ctx.lineWidth = 1;
        const LEVELS = 22;
        for (let L = 1; L < LEVELS; L++) {
            const lev = lo + (hi - lo) * (L / LEVELS);
            ctx.strokeStyle = `rgba(120,170,230,${0.10 + 0.13 * Math.sin(Math.PI * L / LEVELS)})`;
            ctx.beginPath();
            for (let iz = 0; iz < nz - 1; iz++) {
                for (let ir = 0; ir < nr - 1; ir++) {
                    const k = iz * nr + ir;
                    const a = psi[k], b = psi[k + 1], c = psi[k + nr + 1], d = psi[k + nr];
                    const R0 = VIEW.r0 + ir * dr, Z0 = VIEW.z0 + iz * dz;
                    const pts = [];
                    const edge = (p, q, R1, Z1, R2, Z2) => {
                        if ((p < lev) === (q < lev)) return;
                        const t = (lev - p) / (q - p);
                        pts.push([R1 + (R2 - R1) * t, Z1 + (Z2 - Z1) * t]);
                    };
                    edge(a, b, R0, Z0, R0 + dr, Z0);
                    edge(b, c, R0 + dr, Z0, R0 + dr, Z0 + dz);
                    edge(c, d, R0 + dr, Z0 + dz, R0, Z0 + dz);
                    edge(d, a, R0, Z0 + dz, R0, Z0);
                    for (let p = 0; p + 1 < pts.length; p += 2) {
                        ctx.moveTo(this.X(pts[p][0]), this.Y(pts[p][1]));
                        ctx.lineTo(this.X(pts[p + 1][0]), this.Y(pts[p + 1][1]));
                    }
                }
            }
            ctx.stroke();
        }
    }

    /* ------------------------------------------------------------- machine */
    drawMachine(tok, opts) {
        const ctx = this.ctx, mac = this.mac;

        // machine axis
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.setLineDash([3, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.X(VIEW.r0 + 0.01), this.Y(VIEW.z0)); ctx.lineTo(this.X(VIEW.r0 + 0.01), this.Y(VIEW.z1));
        ctx.stroke();
        ctx.setLineDash([]);

        // vessel wall
        ctx.strokeStyle = "#5d7593";
        ctx.lineWidth = 3;
        ctx.beginPath();
        this.wall.forEach((p, i) => i ? ctx.lineTo(this.X(p.R), this.Y(p.Z)) : ctx.moveTo(this.X(p.R), this.Y(p.Z)));
        ctx.closePath();
        ctx.stroke();

        // passive loops, shaded by the eddy current running in them — this is
        // the wall doing the stabilising, made visible
        for (let v = 0; v < mac.nv; v++) {
            const I = tok.I[mac.nc + v];
            const f = Math.max(-1, Math.min(1, I / 400));
            const L = mac.vloops[v];
            ctx.fillStyle = f >= 0
                ? `rgba(255,140,90,${0.12 + 0.78 * f})`
                : `rgba(90,180,255,${0.12 + 0.78 * -f})`;
            ctx.beginPath();
            ctx.arc(this.X(L.R), this.Y(L.Z), 4.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // sensors
        if (opts.showSensors) {
            ctx.fillStyle = "rgba(120,230,190,0.75)";
            for (const p of mac.probes) {
                ctx.beginPath(); ctx.arc(this.X(p.R), this.Y(p.Z), 1.9, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = "rgba(255,220,120,0.6)";
            for (const p of mac.fluxLoops) {
                ctx.beginPath(); ctx.arc(this.X(p.R), this.Y(p.Z), 1.6, 0, Math.PI * 2); ctx.fill();
            }
        }

        // coils — size fixed, colour and glow by current
        for (let j = 0; j < mac.nc; j++) {
            const cir = mac.circuits[j];
            const I = tok.I[j];
            const f = Math.max(-1, Math.min(1, I / (cir.imax * 0.45)));
            for (const e of cir.el) {
                const x = this.X(e.R), y = this.Y(e.Z);
                const w = cir.kind === "fast" ? 7 : cir.kind === "ohmic" ? 9 : 11;
                const h = cir.kind === "ohmic" ? 16 : 11;
                const sgn = e.turns < 0 ? -f : f;
                ctx.fillStyle = sgn >= 0
                    ? `rgba(255,110,80,${0.20 + 0.75 * Math.abs(sgn)})`
                    : `rgba(80,170,255,${0.20 + 0.75 * Math.abs(sgn)})`;
                ctx.fillRect(x - w / 2, y - h / 2, w, h);
                ctx.strokeStyle = cir.kind === "fast" ? "#ffe08a" : "rgba(255,255,255,0.28)";
                ctx.lineWidth = cir.kind === "fast" ? 1.6 : 1;
                ctx.strokeRect(x - w / 2, y - h / 2, w, h);
            }
        }
    }

    /* -------------------------------------------------------------- plasma */
    drawBoundary(bnd, stroke, fill, width) {
        const ctx = this.ctx;
        ctx.beginPath();
        for (let i = 0; i <= N_BND; i++) {
            const k = (i % N_BND) * 2;
            const x = this.X(bnd[k]), y = this.Y(bnd[k + 1]);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 2; ctx.stroke(); }
    }

    /* The PID's plasma, drawn as a real plasma rather than a wire outline.
     * In the exhibition the two controllers are equals on screen — the whole
     * claim being made is a comparison, and drawing one as a glowing object and
     * the other as a dotted line quietly tilts it. Cool blue against the
     * learned controller's amber, and deliberately dimmer only so that the two
     * can be told apart when they overlap, which for most of a good episode
     * they do. */
    drawRival(tok) {
        const ctx = this.ctx;
        if (tok.dead) {
            this.drawBoundary(tok.bnd, "rgba(255,95,107,0.55)", "rgba(255,95,107,0.07)", 1.6);
            return;
        }
        const g = ctx.createRadialGradient(
            this.X(tok.pR), this.Y(tok.pZ), 1,
            this.X(tok.pR), this.Y(tok.pZ), Math.max(6, tok.a * tok.kappa * this.s));
        g.addColorStop(0, "rgba(200,235,255,0.50)");
        g.addColorStop(0.4, "rgba(90,165,255,0.26)");
        g.addColorStop(1, "rgba(60,110,220,0.02)");
        ctx.fillStyle = g;
        this.drawBoundary(tok.bnd, null, null, 0);
        ctx.fill();
        this.drawBoundary(tok.bnd, "rgba(125,185,255,0.9)", null, 1.8);
    }

    /* A short trail of where the magnetic axis has been. Costs one ring buffer
     * and one polyline per controller, and it shows the thing the numbers take
     * a whole episode to say: which controller is drifting and which is
     * holding. */
    pushTrail(key, tok) {
        const t = this.trails || (this.trails = {});
        const a = t[key] || (t[key] = []);
        a.push(tok.pR, tok.pZ);
        if (a.length > 2 * 220) a.splice(0, a.length - 2 * 220);
    }
    clearTrails() { this.trails = {}; }
    /* Faded in three BANDS, each one polyline, rather than one stroke per
     * segment. A per-segment fade looks marginally smoother and costs eighty
     * beginPath/stroke pairs per frame per controller; at 60 fps that is ten
     * thousand canvas state changes a second to draw two thin lines. Three
     * overlapping polylines are visually indistinguishable and cost six. */
    drawTrail(key, colour) {
        const a = this.trails && this.trails[key];
        if (!a || a.length < 8) return;
        const ctx = this.ctx;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        const n = a.length / 2;
        const BANDS = 3;
        for (let b = 0; b < BANDS; b++) {
            const from = Math.floor(n * b / BANDS);
            const to = Math.min(n - 1, Math.floor(n * (b + 1) / BANDS));
            if (to - from < 1) continue;
            ctx.strokeStyle = colour.replace("$A", (0.09 + 0.34 * (b / (BANDS - 1))).toFixed(3));
            ctx.beginPath();
            ctx.moveTo(this.X(a[2 * from]), this.Y(a[2 * from + 1]));
            for (let i = from + 1; i <= to; i++) ctx.lineTo(this.X(a[2 * i]), this.Y(a[2 * i + 1]));
            ctx.stroke();
        }
    }

    drawPlasma(tok, opts) {
        const ctx = this.ctx;
        if (tok.dead) {
            this.drawBoundary(tok.bnd, "rgba(255,95,107,0.85)", "rgba(255,95,107,0.10)", 2);
            return;
        }
        // Outer halo, then the hot core. Two radial gradients per frame is
        // nothing next to the flux grid, and it is the difference between a
        // filled outline and something that looks like it is radiating.
        const cx = this.X(tok.pR), cy = this.Y(tok.pZ);
        const rOut = Math.max(8, tok.a * tok.kappa * this.s) * 1.9;
        const halo = ctx.createRadialGradient(cx, cy, Math.max(3, rOut * 0.35), cx, cy, rOut);
        halo.addColorStop(0, "rgba(255,150,70,0.16)");
        halo.addColorStop(1, "rgba(255,120,60,0)");
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(cx, cy, rOut, 0, Math.PI * 2); ctx.fill();

        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy,
            Math.max(6, tok.a * tok.kappa * this.s));
        g.addColorStop(0, "rgba(255,244,205,0.97)");
        g.addColorStop(0.28, "rgba(255,186,96,0.72)");
        g.addColorStop(0.62, "rgba(255,132,66,0.42)");
        g.addColorStop(1, "rgba(220,60,140,0.05)");
        ctx.fillStyle = g;
        this.drawBoundary(tok.bnd, null, null, 0);
        ctx.fill();
        this.drawBoundary(tok.bnd, "rgba(255,214,140,0.96)", null, 2);

        if (opts.showFilaments) {
            ctx.fillStyle = "rgba(255,255,255,0.65)";
            for (let k = 0; k < PLASMA.NF; k++) {
                ctx.beginPath();
                ctx.arc(this.X(tok.fil.R[k]), this.Y(tok.fil.Z[k]), 2.2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        // magnetic axis cross
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1.2;
        const x = this.X(tok.pR), y = this.Y(tok.pZ);
        ctx.beginPath();
        ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y);
        ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
        ctx.stroke();
    }

    drawTarget(task, t) {
        const ctx = this.ctx;
        const b = task.targetBoundary(t);
        ctx.setLineDash([5, 5]);
        this.drawBoundary(b, "rgba(80,230,190,0.9)", null, 1.6);
        ctx.setLineDash([]);
    }

    /* Faint outlines of the rest of the population — how much of the gene pool
     * is still doing something different. */
    drawGhosts(units, leaderIdx, limit) {
        const ctx = this.ctx;
        let n = 0;
        for (const u of units) {
            if (u.idx === leaderIdx || n >= limit) continue;
            n++;
            const dead = u.tok.dead;
            this.drawBoundary(u.tok.bnd,
                dead ? "rgba(255,95,107,0.10)" : "rgba(255,205,120,0.16)", null, 1);
        }
    }

    /* -------------------------------------------------------------- frames */
    /* Background. A flat fill is honest but dead; a very slight radial lift
     * behind the vessel plus a vignette gives the view some depth for the cost
     * of two gradient fills a frame. Built once and cached — createRadialGradient
     * every frame is the kind of thing that quietly halves a frame rate. */
    drawBackdrop() {
        const ctx = this.ctx;
        if (!this._bg || this._bgW !== this.cw || this._bgH !== this.ch) {
            const cx = this.X(VESSEL.R0), cy = this.Y(0);
            const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(this.cw, this.ch) * 0.62);
            g.addColorStop(0, "#0b1524");
            g.addColorStop(0.55, "#08111d");
            g.addColorStop(1, "#050a12");
            this._bg = g; this._bgW = this.cw; this._bgH = this.ch;
        }
        ctx.fillStyle = this._bg;
        ctx.fillRect(0, 0, this.cw, this.ch);
    }

    frame(tok, task, opts, units, leaderIdx, pidTok) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.cw, this.ch);
        this.drawBackdrop();

        if (opts.showFlux) {
            this.psiAge++;
            if (this.psiAge > (opts.fluxEvery || 4)) this.computeFlux(tok);
            this.drawContours();
        }
        this.drawMachine(tok, opts);
        if (opts.showGhosts && units) this.drawGhosts(units, leaderIdx, opts.ghosts || 0);
        if (opts.showTarget) this.drawTarget(task, tok.t);

        if (opts.exhibition) {
            // Trails first so both plasmas sit on top of them.
            this.pushTrail("learn", tok);
            if (pidTok) this.pushTrail("pid", pidTok);
            this.drawTrail("pid", "rgba(120,180,255,$A)");
            this.drawTrail("learn", "rgba(255,170,90,$A)");
            if (pidTok) this.drawRival(pidTok);
        } else if (pidTok) {
            this.drawBoundary(pidTok.bnd,
                pidTok.dead ? "rgba(255,95,107,0.5)" : "rgba(120,180,255,0.85)", null, 1.8);
        }
        this.drawPlasma(tok, opts);
        // The rival's outline goes back on top. For most of a good episode the
        // two controllers track within a centimetre of each other, so the PID's
        // plasma sits UNDER the learned one's fill and simply disappears —
        // which on a screen whose entire purpose is a comparison reads as "there
        // is only one controller here". Re-stroking the boundary keeps both
        // legible when they overlap and costs one path.
        if (opts.exhibition && pidTok && !pidTok.dead) {
            this.drawBoundary(pidTok.bnd, "rgba(150,205,255,0.95)", null, 1.5);
        }
    }
}

/* Coil current bars for the side panel — nineteen little meters, which is the
 * quickest way to see the agent discovering that it has nineteen actuators. */
function drawCoilBars(cv, tok, mac) {
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const n = mac.nc;
    const rowH = H / n;
    for (let j = 0; j < n; j++) {
        const cir = mac.circuits[j];
        const f = Math.max(-1, Math.min(1, tok.I[j] / cir.imax));
        const y = j * rowH + 1, h = Math.max(2, rowH - 2);
        const mid = W * 0.52;
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(mid - W * 0.42, y, W * 0.84, h);
        ctx.fillStyle = f >= 0 ? "rgba(255,120,90,0.9)" : "rgba(90,175,255,0.9)";
        ctx.fillRect(f >= 0 ? mid : mid + f * W * 0.42, y, Math.abs(f) * W * 0.42, h);
        // a red tick where the current limit starts to hurt the reward
        ctx.fillStyle = "rgba(255,95,107,0.35)";
        ctx.fillRect(mid + 0.8 * W * 0.42, y, 1, h);
        ctx.fillRect(mid - 0.8 * W * 0.42, y, 1, h);
        ctx.fillStyle = "#7d93ab";
        ctx.font = "9px 'Segoe UI', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(cir.name, 2, y + h - 1);
    }
}

/* The head-to-head time series: both controllers' distance from the shape they
 * were asked to hold, as the shot runs, with the gap between them shaded in the
 * colour of whoever is ahead at that instant.
 *
 * The shading is the point. Two overlapping lines are a puzzle; a band that is
 * amber for most of its length answers "which one tends to be better" without
 * the viewer having to read either axis.
 *
 * The y-axis auto-scales to the visible window but is clamped: one disruption
 * sends an error to 30 cm and, unclamped, would flatten every other task in the
 * window into a single line along the bottom. */
function drawVsChart(cv, trace) {
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    const PAD_L = 26, PAD_B = 14, PAD_T = 8, PAD_R = 4;
    const gw = W - PAD_L - PAD_R, gh = H - PAD_T - PAD_B;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(PAD_L, PAD_T, gw, gh);

    if (!trace || trace.length < 2) {
        ctx.fillStyle = "#7d93ab";
        ctx.font = "11px 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("measuring…", W / 2, H / 2);
        return;
    }

    // Scale to the LIVING samples only, for the same reason the band ignores
    // dead ones: a corpse parked at 25 cm would otherwise squash every real
    // tracking error in the window into the top two pixels.
    let hi = 0;
    for (const s of trace) {
        if (!s.aDead) hi = Math.max(hi, s.a);
        if (!s.bDead) hi = Math.max(hi, s.b);
    }
    hi = Math.min(Math.max(hi * 1.15, 0.05), 0.30);          // 5 cm floor, 30 cm ceiling
    const n = trace.length;
    const X = (i) => PAD_L + gw * (i / (n - 1));
    const Y = (e) => PAD_T + gh * Math.min(1, e / hi);

    // grid + axis labels, in centimetres
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle = "#7d93ab";
    ctx.font = "9px 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.lineWidth = 1;
    const stepCm = hi * 100 <= 6 ? 2 : hi * 100 <= 15 ? 5 : 10;
    for (let c = 0; c <= hi * 100; c += stepCm) {
        const y = Y(c / 100);
        ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
        ctx.fillText(String(c), PAD_L - 4, y + 3);
    }
    ctx.textAlign = "left";
    ctx.fillText("cm", 2, PAD_T + 8);

    // task boundaries
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.setLineDash([2, 3]);
    for (let i = 0; i < n; i++) {
        if (!trace[i].boundary) continue;
        ctx.beginPath(); ctx.moveTo(X(i), PAD_T); ctx.lineTo(X(i), PAD_T + gh); ctx.stroke();
    }
    ctx.setLineDash([]);

    /* The shaded lead band, only where BOTH plasmas are alive.
     *
     * A dead controller's boundary error is not a tracking error — it is the
     * frozen shape of a plasma that is already on the wall, and it keeps being
     * reported for the rest of the episode. Shading against it would say "the
     * other one is winning by 20 cm" for six hundred milliseconds, which is a
     * strange way to describe a plasma that no longer exists. The disruption is
     * marked instead, and the scoreboard is where lost plasmas are counted. */
    let i = 0;
    while (i < n) {
        if (trace[i].aDead || trace[i].bDead) { i++; continue; }
        const aheadA = trace[i].a <= trace[i].b;
        let j = i;
        while (j + 1 < n && !trace[j + 1].aDead && !trace[j + 1].bDead &&
               (trace[j + 1].a <= trace[j + 1].b) === aheadA) j++;
        if (j > i) {
            ctx.fillStyle = aheadA ? "rgba(255,159,90,0.22)" : "rgba(122,180,255,0.22)";
            ctx.beginPath();
            ctx.moveTo(X(i), Y(trace[i].a));
            for (let k = i + 1; k <= j; k++) ctx.lineTo(X(k), Y(trace[k].a));
            for (let k = j; k >= i; k--) ctx.lineTo(X(k), Y(trace[k].b));
            ctx.closePath();
            ctx.fill();
        }
        i = j + 1;
    }

    // The traces, drawn only while the plasma is alive. Where one dies the line
    // simply stops and a cross is drawn — an ending, not a value.
    const line = (get, dead, colour) => {
        ctx.lineWidth = 1.7;
        ctx.lineJoin = "round";
        ctx.strokeStyle = colour;
        let k = 0;
        while (k < n) {
            if (dead(trace[k])) { k++; continue; }
            let m = k;
            while (m + 1 < n && !dead(trace[m + 1])) m++;
            if (m > k) {
                ctx.beginPath();
                ctx.moveTo(X(k), Y(get(trace[k])));
                for (let q = k + 1; q <= m; q++) ctx.lineTo(X(q), Y(get(trace[q])));
                ctx.stroke();
            }
            // a cross where it was lost, if it died rather than the window ending
            if (m + 1 < n && dead(trace[m + 1])) {
                const x = X(m), y = Y(get(trace[m])), r = 3.5;
                ctx.strokeStyle = "rgba(255,95,107,0.95)";
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
                ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
                ctx.stroke();
                ctx.strokeStyle = colour;
                ctx.lineWidth = 1.7;
            }
            k = m + 1;
        }
    };
    line(s => s.b, s => s.bDead, "rgba(122,180,255,0.95)");
    line(s => s.a, s => s.aDead, "rgba(255,159,90,0.98)");
}

if (typeof module !== "undefined") module.exports = { Renderer, drawCoilBars, drawVsChart, VIEW };
