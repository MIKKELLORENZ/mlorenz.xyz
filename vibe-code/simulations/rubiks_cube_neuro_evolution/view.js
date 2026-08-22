/* view.js — the cube a human watches. Canvas 2D, painter's algorithm, no WebGL.
 *
 * ─── one geometry, two renderers ───────────────────────────────────────────
 *
 * vision.js renders the cube the network sees: 32×16 pixels, analytically
 * average-pooled, precomputed as a sparse matrix because it runs tens of millions
 * of times. This file renders the cube *you* see: a few hundred filled
 * quadrilaterals, sixty times a second, with turns animated.
 *
 * They are deliberately built on the same `buildProjector` and the same face
 * bases from cube.js. That is not code-sharing for its own sake — it means the
 * inset labelled "what the brain sees" on the page is the same view of the same
 * cube through the same lens, only coarser. If the two had separate geometry, the
 * inset would eventually become a drawing of something else and nobody would
 * notice.
 *
 * Two things are deliberately *not* shared:
 *   · shading. The network gets gentle 0.82…1.00 shading because strong shading
 *     collapses the colour×face products it has to tell apart (see vision.js).
 *     Human eyes want the depth cue, so this uses the harder set.
 *   · the camera. The display view can be orbited by dragging; the network's is
 *     fixed at the canonical corner forever. A brain evolved against one
 *     viewpoint has no reason to survive another, and letting the mouse move the
 *     network's camera would be a silent way to make the page disagree with the
 *     trainer.
 *
 * ─── the animation ─────────────────────────────────────────────────────────
 *
 * A turn is drawn by rotating the affected cubies' quads through a real angle
 * about the face axis. Which quads move is the same test cube.js uses to build
 * the permutation — the facelet's cubie position dotted with the face normal
 * equals 1 — so the thing that spins on screen is exactly the thing that permutes
 * in the model. At the end of the sweep the permutation is applied and the angle
 * resets to zero, which lands on an identical picture, so there is no snap.
 *
 * Every cubie is drawn with all six of its faces in plastic, not just the ones
 * carrying stickers. During a turn the layers separate and you can see into the
 * cube; without the inner faces you would see straight through it.
 */
"use strict";

/* Rotation about a unit axis by an arbitrary angle — the float cousin of
 * cube.js's integer rot90, used only for partially completed turns. */
function rotAxis(n, ang, p) {
    const c = Math.cos(ang), s = Math.sin(ang), k = 1 - c;
    const d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
    return [
        p[0] * c + (n[1] * p[2] - n[2] * p[1]) * s + n[0] * d * k,
        p[1] * c + (n[2] * p[0] - n[0] * p[2]) * s + n[1] * d * k,
        p[2] * c + (n[0] * p[1] - n[1] * p[0]) * s + n[2] * d * k,
    ];
}

/* Precompute, once, the flat list of quads that make up a cube: every face of
 * every cubie, tagged with the facelet it shows (or −1 for interior plastic) and
 * with which cubie it sits on, so the layer test can be done per frame.
 *
 * Coordinates match vision.js exactly: the cube spans [-1,1], a face plane sits
 * at distance 1 along its normal, and one facelet is 2/3 of a unit across. */
function buildQuads(geom) {
    const quads = [];
    const AX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let gx = -1; gx <= 1; gx++) {
        for (let gy = -1; gy <= 1; gy++) {
            for (let gz = -1; gz <= 1; gz++) {
                if (gx === 0 && gy === 0 && gz === 0) continue;       // the core
                const cell = [gx, gy, gz];
                for (const n of AX) {
                    /* Which face index is this direction, if any? */
                    const face = geom.FACE_N.findIndex(f => f[0] === n[0] && f[1] === n[1] && f[2] === n[2]);
                    /* Is this cubie face on the cube's outside along n? Exactly the
                     * layer-membership test cube.js uses to build the permutation. */
                    const outer = (cell[0] * n[0] + cell[1] * n[1] + cell[2] * n[2]) === 1;
                    let facelet = -1;
                    if (outer && face >= 0) {
                        /* Locate the cubie in the face's own (u, v) grid. */
                        const u = geom.FACE_U[face], v = geom.FACE_V[face];
                        const c = 1 + (cell[0] * u[0] + cell[1] * u[1] + cell[2] * u[2]);
                        const r = 1 + (cell[0] * v[0] + cell[1] * v[1] + cell[2] * v[2]);
                        facelet = face * 9 + r * 3 + c;
                    }
                    /* The quad's four corners. Its plane is offset one third of a
                     * unit from the cubie centre along n (half a cubie), and it
                     * spans one third of a unit either way in the two tangent
                     * directions. */
                    const t1 = Math.abs(n[0]) ? [0, 1, 0] : [1, 0, 0];
                    const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
                    const H = 1 / 3;
                    const centre = [cell[0] * (2 / 3) + n[0] * H, cell[1] * (2 / 3) + n[1] * H,
                    cell[2] * (2 / 3) + n[2] * H];
                    const corner = (a, b) => [
                        centre[0] + t1[0] * a * H + t2[0] * b * H,
                        centre[1] + t1[1] * a * H + t2[1] * b * H,
                        centre[2] + t1[2] * a * H + t2[2] * b * H,
                    ];
                    quads.push({
                        cell, normal: n, face, facelet,
                        corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
                        centre,
                    });
                }
            }
        }
    }
    return quads;
}

class CubeView {
    /* opts: { camDir, orbit (bool), lights, palette, sticker (inset 0..0.5) } */
    constructor(canvas, geom, opts) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.geom = geom;
        this.opts = Object.assign({ orbit: false, sticker: 0.10, zoom: 1 }, opts || {});
        this.quads = buildQuads(geom);
        this.az = 0.785;          // ≈ 45°, the canonical corner
        this.el = 0.615;          // ≈ 35.26°, the isometric elevation
        if (opts && opts.camDir) this._fromDir(opts.camDir);
        this.palette = (opts && opts.palette) || PALETTES.clear;
        this.lights = (opts && opts.lights) || FACE_LIGHT_DISPLAY;
        this._rebuild();
        if (this.opts.orbit) this._wireDrag();
        this.resize();
    }

    _fromDir(d) {
        const L = Math.hypot(d[0], d[1], d[2]);
        this.el = Math.asin(d[1] / L);
        this.az = Math.atan2(d[0], d[2]);
    }
    _dir() {
        const ce = Math.cos(this.el);
        return [Math.sin(this.az) * ce, Math.sin(this.el), Math.cos(this.az) * ce];
    }
    _rebuild() { this.proj = buildProjector(this._dir()); }

    _wireDrag() {
        const c = this.canvas;
        let drag = null;
        const down = e => {
            const p = e.touches ? e.touches[0] : e;
            drag = { x: p.clientX, y: p.clientY, az: this.az, el: this.el };
        };
        const move = e => {
            if (!drag) return;
            const p = e.touches ? e.touches[0] : e;
            this.az = drag.az + (p.clientX - drag.x) * 0.008;
            /* Clamped short of the poles: at ±90° the screen basis is degenerate
             * (the camera direction becomes parallel to world up) and the cube
             * flips inside out. */
            this.el = Math.max(-1.35, Math.min(1.35, drag.el - (p.clientY - drag.y) * 0.008));
            this._rebuild();
            if (this.onOrbit) this.onOrbit();
            if (e.cancelable) e.preventDefault();
        };
        const up = () => { drag = null; };
        c.addEventListener("mousedown", down);
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        c.addEventListener("touchstart", down, { passive: true });
        c.addEventListener("touchmove", move, { passive: false });
        c.addEventListener("touchend", up);
    }

    resetOrbit() { this.az = 0.785; this.el = 0.615; this._rebuild(); }

    resize() {
        const r = this.canvas.getBoundingClientRect();
        /* Capped device pixel ratio. A high-DPI canvas of this size is pure
         * fill-rate for no visible gain, and the moon-lander project in this
         * folder found exactly this to be its whole performance problem. */
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(80, Math.round((r.width || 300) * dpr));
        const h = Math.max(80, Math.round((r.height || 300) * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w; this.canvas.height = h;
        }
        this.dpr = dpr;
    }

    /* state: Uint8Array(54).  anim: null, or {move, progress} where `move` is a
     * move object from cube.js and progress runs 0→1. */
    draw(state, anim) {
        const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
        ctx.clearRect(0, 0, W, H);

        const proj = this.proj;
        /* Scale to fit whatever the orbit is currently showing, with a little
         * slack so a turn sticking out of the silhouette is not clipped. */
        const span = Math.max(proj.halfW, proj.halfH) * 1.30;
        const scale = Math.min(W, H) / (2 * span) * this.opts.zoom;
        const cx = W / 2, cy = H / 2;

        let axis = null, ang = 0;
        if (anim && anim.move) {
            axis = this.geom.FACE_N[anim.move.face];
            /* Same sign convention as cube.js's rot90: dir +1 is clockwise seen
             * from outside, which is −90° about the outward normal. */
            ang = -anim.move.dir * (Math.PI / 2) * Math.max(0, Math.min(1, anim.progress));
        }

        const list = [];
        for (const q of this.quads) {
            const moving = axis
                ? (q.cell[0] * axis[0] + q.cell[1] * axis[1] + q.cell[2] * axis[2]) === 1
                : false;
            const pts = [], depths = [];
            for (const c of q.corners) {
                const p = moving ? rotAxis(axis, ang, c) : c;
                const s = proj.project(p);
                pts.push([cx + s[0] * scale, cy + s[1] * scale]);
                depths.push(proj.depth(p));
            }
            const n = moving ? rotAxis(axis, ang, q.normal) : q.normal;
            /* Back-face cull: a quad facing away from the camera is either hidden
             * or is the far wall of a gap, and drawing it would fight the sort. */
            if (proj.depth(n) <= 0.02) continue;
            list.push({
                q, pts, n,
                z: (depths[0] + depths[1] + depths[2] + depths[3]) / 4,
                lit: 0.35 + 0.65 * Math.max(0, proj.depth(n)),
            });
        }
        /* Painter's algorithm. With convex unit cubies and at most one rotating
         * layer, mean-depth ordering is correct in every configuration this can
         * reach; it is not a general solution and does not have to be. */
        list.sort((a, b) => a.z - b.z);

        const inset = this.opts.sticker;
        for (const item of list) {
            const { q, pts } = item;
            // ---- plastic
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            const body = Math.round(20 * item.lit);
            ctx.fillStyle = `rgb(${body},${body},${body + 3})`;
            ctx.fill();

            if (q.facelet < 0) continue;
            // ---- sticker, inset within the plastic
            const col = this.palette[state[q.facelet]];
            const light = this.lights[q.face];
            const mx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
            const my = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
            ctx.beginPath();
            for (let i = 0; i < 4; i++) {
                const x = mx + (pts[i][0] - mx) * (1 - inset * 2);
                const y = my + (pts[i][1] - my) * (1 - inset * 2);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
            const k = light * (0.72 + 0.28 * Math.max(0, this.proj.depth(item.n)));
            ctx.fillStyle = `rgb(${Math.round(col[0] * 255 * k)},${Math.round(col[1] * 255 * k)},` +
                `${Math.round(col[2] * 255 * k)})`;
            ctx.fill();
        }
    }
}

/* ------------------------------------------------- the network's-eye inset */

/* Draws the actual observation — the same Float32Array the brain is reading —
 * magnified with nearest-neighbour so individual input pixels are visible.
 *
 * `frame` selects which remembered frame to show: 0 is now, 1 is one move ago.
 * Showing the older frames is not decoration; it is how you can see at a glance
 * that the temporal window is populated and shifting, which is a thing that has
 * silently broken in other projects in this folder. */
function drawObservation(canvas, plan, vec, frame, opts) {
    const ctx = canvas.getContext("2d");
    const { W, H, frameSize } = plan;
    const off = (frame || 0) * frameSize;
    const nPix = W * H;
    const scale = Math.max(1, Math.floor(Math.min(canvas.width / W, canvas.height / H)));
    const img = ctx.createImageData(W, H);
    const centered = !opts || opts.centered !== false;
    for (let p = 0; p < nPix; p++) {
        for (let ch = 0; ch < 3; ch++) {
            let v = vec[off + ch * nPix + p];
            if (centered) v = (v + 1) / 2;
            img.data[p * 4 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
        }
        img.data[p * 4 + 3] = 255;
    }
    /* Two-step blit: ImageData cannot be scaled directly, so it goes to an
     * offscreen canvas first and comes back with smoothing switched off. */
    if (!drawObservation._tmp) drawObservation._tmp = document.createElement("canvas");
    const tmp = drawObservation._tmp;
    tmp.width = W; tmp.height = H;
    tmp.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dw = W * scale, dh = H * scale;
    ctx.drawImage(tmp, Math.floor((canvas.width - dw) / 2), Math.floor((canvas.height - dh) / 2), dw, dh);
    return scale;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * NetView — the network itself, drawn from its own activations.
 *
 * This box used to show the far side of the cube, which was redundant: the far
 * side is already in the observation (panel 1 of the render sees D, B and L), so
 * the inset labelled "what the brain sees" was showing it twice while the network
 * — the actual subject of the page — appeared only as eight numbers.
 *
 * Nothing here is a diagram of an architecture. Every cell is one live activation
 * read out of the network after the same forward pass that chose the move on
 * screen, and the wires are the strongest contributions to the output that won:
 * weight × activation, red where the unit argued against the move being played.
 * A picture of a network that is not driven by the network's own numbers is
 * decoration, and decoration is the one thing a viewer cannot tell apart from
 * evidence.
 *
 * The input block is drawn as a grid of its 1,569 numbers rather than as a
 * picture, on purpose. The picture is in the box below it; this is what the first
 * weight matrix actually consumes.
 */
class NetView {
    constructor(canvas, opts) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        /* inputCols: lay the input block out in the observation's own row length, so
         * the block is a picture of the vector rather than a reshuffling of it — at
         * 32 columns the three colour channels of the render stack up as three
         * recognisable panels and the extras land in the last row. */
        this.opts = Object.assign({ names: [], wires: 8, inputCols: 0 }, opts || {});
        this.layers = null;
        this.chosen = -1;
        this.outW = null;
        this.hiddenIdx = -1;
        this.resize();
    }

    resize() {
        const r = this.canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(60, Math.round((r.width || 200) * dpr));
        const h = Math.max(60, Math.round((r.height || 150) * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w; this.canvas.height = h;
        }
        this.dpr = dpr;
    }

    /* Reads the activations the network is holding. For a feedforward net the
     * forward is re-run, so the panel is guaranteed to describe the observation on
     * screen even after a benchmark has driven the same object over other cubes.
     * A recurrent net is never re-run: its forward has a side effect, and drawing a
     * picture must not change the episode it is a picture of. */
    update(net, input) {
        if (!net || typeof net.activations !== "function") { this.layers = null; return; }
        if (input && !net.recSize) net.forward(input);
        const all = net.activations();
        this.layers = all;
        const out = all[all.length - 1].values;
        let bi = 0;
        for (let i = 1; i < out.length; i++) if (out[i] > out[bi]) bi = i;
        this.chosen = bi;
        /* The last weight block, so the wires are the real coefficients. */
        const wts = net.weights;
        this.outW = wts && wts.length ? wts[wts.length - 1] : null;
        this.hiddenIdx = all.length - 2;
    }

    /* Diverging scale: teal positive, red negative, near-transparent at zero.
     * Normalised per layer, because a ReLU layer topping out at 30 and an output
     * layer living at ±65 share no absolute scale worth respecting. */
    static _colour(v, scale) {
        const t = Math.max(-1, Math.min(1, v / (scale || 1)));
        const a = Math.abs(t);
        return t >= 0
            ? `rgba(90,208,160,${(0.06 + 0.94 * a).toFixed(3)})`
            : `rgba(196,84,96,${(0.05 + 0.62 * a).toFixed(3)})`;
    }

    static _scale(values) {
        let m = 1e-6;
        for (let i = 0; i < values.length; i++) {
            const a = Math.abs(values[i]);
            if (a > m) m = a;
        }
        return m;
    }

    /* Geometry for a block of n values with square cells, centred in its box.
     * Square matters: the input block is laid out in the observation's own row
     * length, and a cell stretched to fill the box would smear those rows into
     * stripes that are an artefact of the panel's aspect ratio rather than anything
     * in the data.
     *
     * Measuring is separate from painting so the layout can hand the hidden block the
     * width the input block turns out not to need — a centred square block inside a
     * fixed column otherwise leaves a gutter of dead pixels on both sides. */
    static _fit(x, y, w, h, n, wantCols) {
        const auto = () => Math.max(1, Math.round(Math.sqrt(n * (w / Math.max(1, h)))));
        let cols = wantCols || auto();
        let rows = Math.ceil(n / cols);
        let cell = Math.min(w / cols, h / rows);
        /* A fixed column count that does not fit gives up and re-flows, rather than
         * drawing cells too small to see. */
        if (wantCols && cell < 1.2) {
            cols = auto();
            rows = Math.ceil(n / cols);
            cell = Math.min(w / cols, h / rows);
        }
        const bw = cols * cell, bh = rows * cell;
        return { x: x + (w - bw) / 2, y: y + (h - bh) / 2, w: bw, h: bh, cols, rows, cw: cell, ch: cell, n };
    }

    _paint(geom, values) {
        const ctx = this.ctx, cell = geom.cw;
        const s = NetView._scale(values);
        const pad = cell > 4 ? 0.5 : 0;
        for (let i = 0; i < values.length; i++) {
            ctx.fillStyle = NetView._colour(values[i], s);
            ctx.fillRect(geom.x + (i % geom.cols) * cell, geom.y + Math.floor(i / geom.cols) * cell,
                Math.max(0.7, cell - pad), Math.max(0.7, cell - pad));
        }
        return geom;
    }

    _cell(geom, i) {
        return [
            geom.x + (i % geom.cols) * geom.cw + geom.cw / 2,
            geom.y + Math.floor(i / geom.cols) * geom.ch + geom.ch / 2,
        ];
    }

    draw() {
        const ctx = this.ctx, dpr = this.dpr || 1;
        const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        if (!this.layers) return;

        const layers = this.layers;
        const outLayer = layers[layers.length - 1];
        const hidLayer = this.hiddenIdx > 0 ? layers[this.hiddenIdx] : null;
        const inLayer = layers[0].label === "input" ? layers[0] : null;

        /* The box this panel lives in is tall and narrow beside a desktop cube and
         * short and wide in the phone layout's strip. Laying the layers out along the
         * long axis in both cases is the difference between cells you can see and a
         * band of confetti with two thirds of the box empty. */
        const vertical = H > W * 1.15;
        const roomy = Math.max(W, H) > 190 && Math.min(W, H) > 70;
        const pad = 5, labelH = roomy ? 12 : 0;
        const nOut = outLayer.values.length;

        ctx.font = "9px ui-monospace, Menlo, Consolas, monospace";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        const label = (txt, lx, ly, lw) => {
            if (!roomy) return;
            ctx.fillStyle = "rgba(233,238,246,0.45)";
            while (txt.length > 3 && ctx.measureText(txt).width > lw) txt = txt.slice(0, -1);
            ctx.fillText(txt, lx, ly);
        };

        const inTxt = inLayer ? `${inLayer.values.length.toLocaleString("en-US")} in` : "";
        const hidTxt = hidLayer && hidLayer !== outLayer
            ? `${hidLayer.values.length} ${hidLayer.act}` : "";

        /* Move names are drawn only when they fit. Eight labels crammed into the
         * phone strip overlap into a smear, and an unreadable label is worse than the
         * dot alone — the dots still carry the decision. */
        let inGeom = null, hidGeom = null, outPts = [], dot, namesOk = false;

        if (vertical) {
            /* Stacked: input, hidden, then the eight outputs as a row along the
             * bottom. The bottom strip is left to the HTML tag that labels the box. */
            const tagH = roomy ? 21 : 4;      // the HTML view-tag sits over the bottom edge
            const outH = roomy ? 28 : 14;
            const top = pad, bottom = H - pad - tagH;
            const band = Math.max(20, bottom - top - outH);
            const inH = inLayer ? Math.round(band * 0.52) : 0;
            const hidH = band - inH;
            let y = top;
            if (inLayer) {
                label(inTxt, pad, y, W - 2 * pad);
                inGeom = this._paint(
                    NetView._fit(pad, y + labelH, W - 2 * pad, inH - labelH,
                        inLayer.values.length, this.opts.inputCols),
                    inLayer.values);
                y += inH;
            }
            if (hidLayer && hidLayer !== outLayer) {
                label(hidTxt, pad, y, W - 2 * pad);
                hidGeom = this._paint(
                    NetView._fit(pad, y + labelH, W - 2 * pad, hidH - labelH,
                        hidLayer.values.length, 0),
                    hidLayer.values);
            }
            const cellW = (W - 2 * pad) / nOut;
            dot = Math.max(3, Math.min(cellW - (roomy ? 12 : 3), roomy ? 11 : 7));
            const cy = bottom - outH + dot / 2 + 2;
            namesOk = roomy && cellW >= 15;
            for (let i = 0; i < nOut; i++) outPts.push([pad + cellW * (i + 0.5), cy]);
        } else {
            /* Side by side: input, hidden, then the outputs as a column on the right
             * with their move names beside them. */
            const outW = roomy ? 32 : 16;
            const gap = roomy ? 12 : 7;
            const top = pad + labelH, bot = H - pad - (roomy ? 14 : 4);
            const bandH = Math.max(10, bot - top);
            const avail = Math.max(20, W - 2 * pad - outW - 2 * gap);
            let inW = inLayer ? Math.round(avail * 0.5) : 0;
            if (inLayer) {
                const probe = NetView._fit(0, 0, inW, bandH, inLayer.values.length, this.opts.inputCols);
                inW = Math.min(inW, Math.ceil(probe.w) + 1);
            }
            const hidW = avail - inW;
            let x = pad;
            if (inLayer) {
                inGeom = this._paint(
                    NetView._fit(x, top, inW, bandH, inLayer.values.length, this.opts.inputCols),
                    inLayer.values);
                label(inTxt, x, pad, inW);
                x += inW + gap;
            }
            if (hidLayer && hidLayer !== outLayer) {
                hidGeom = this._paint(NetView._fit(x, top, hidW, bandH, hidLayer.values.length, 0),
                    hidLayer.values);
                label(hidTxt, x, pad, hidW);
            }
            x += hidW + gap;
            const cellH = bandH / nOut;
            dot = Math.max(3, Math.min(cellH - 2, roomy ? 11 : 7));
            label(`${nOut} out`, x, pad, outW);
            namesOk = roomy && cellH >= 11;
            for (let i = 0; i < nOut; i++) outPts.push([x + dot / 2, top + cellH * (i + 0.5)]);
        }

        /* The output column, drawn last of the blocks so the wires can land on it. */
        const oScale = NetView._scale(outLayer.values);
        for (let i = 0; i < nOut; i++) {
            const [cx, cy] = outPts[i];
            ctx.fillStyle = NetView._colour(outLayer.values[i], oScale);
            ctx.beginPath(); ctx.arc(cx, cy, dot / 2, 0, 7); ctx.fill();
            if (i === this.chosen) {
                ctx.strokeStyle = "#ffc94d";
                ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.arc(cx, cy, dot / 2 + 2, 0, 7); ctx.stroke();
            }
            const nm = this.opts.names[i];
            if (namesOk && nm) {
                ctx.fillStyle = i === this.chosen ? "#ffc94d" : "rgba(233,238,246,0.5)";
                if (vertical) {
                    ctx.textAlign = "center";
                    ctx.fillText(nm, cx, cy + dot / 2 + 3);
                    ctx.textAlign = "left";
                } else {
                    ctx.textBaseline = "middle";
                    ctx.fillText(nm, cx + dot / 2 + 3, cy);
                    ctx.textBaseline = "top";
                }
            }
        }

        /* The wires: the strongest weight × activation terms feeding the move that was
         * actually played. A handful out of 256, so this is a sample and not a sum —
         * but every line is a real coefficient, and a red one is a unit that argued
         * against the move the cube is about to make. */
        if (hidGeom && this.outW && this.chosen >= 0) {
            const nIn = hidLayer.values.length;
            const base = this.chosen * (nIn + 1);
            const terms = [];
            for (let i = 0; i < nIn; i++) {
                const c = this.outW[base + i] * hidLayer.values[i];
                if (c !== 0) terms.push([Math.abs(c), c, i]);
            }
            terms.sort((a, b) => b[0] - a[0]);
            const k = Math.min(this.opts.wires, terms.length);
            const top1 = k ? terms[0][0] : 1;
            const [ox, oy] = outPts[this.chosen];
            for (let t = 0; t < k; t++) {
                const c = terms[t][1], i = terms[t][2];
                const [cx, cy] = this._cell(hidGeom, i);
                const a = Math.min(1, Math.abs(c) / top1);
                ctx.strokeStyle = c > 0
                    ? `rgba(90,208,160,${(0.18 + 0.55 * a).toFixed(3)})`
                    : `rgba(255,95,107,${(0.18 + 0.55 * a).toFixed(3)})`;
                ctx.lineWidth = 0.4 + 1.3 * a;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                if (vertical) {
                    const ey = oy - dot / 2;
                    ctx.bezierCurveTo(cx, (cy + ey) / 2, ox, (cy + ey) / 2, ox, ey);
                } else {
                    const ex = ox - dot / 2;
                    ctx.bezierCurveTo((cx + ex) / 2, cy, (cx + ex) / 2, oy, ex, oy);
                }
                ctx.stroke();
            }
        }
    }
}
