/* Neural Architect — render.js
 *
 * The canvases: NA.canvas (viewport, DPR, dirty loop, inertia), NA.render (the
 * scene and overlay passes with zoom-dependent level of detail) and NA.hit
 * (screen point → what is under it). Everything is drawn in world space through
 * one setTransform; constant-screen-size things divide by the zoom.
 */
'use strict';

// ============================================================
// NA.canvas — viewport, resize, dirty-flag render loop, inertia
// ============================================================
(() => {
    const cfg = NA.config;
    const { clamp, bus } = NA.util;
    let stage, scene, overlay, sctx, octx, W = 0, H = 0, dpr = 1;
    const dirty = { scene: true, overlay: true };
    let running = false, lastT = 0;
    const inertia = { vx: 0, vy: 0, active: false };
    const view = () => NA.model.get().view;

    function init() {
        stage = document.getElementById('stage');
        scene = document.getElementById('scene'); overlay = document.getElementById('overlay');
        sctx = scene.getContext('2d'); octx = overlay.getContext('2d');
        new ResizeObserver(resize).observe(stage);
        resize();
        if (document.fonts) document.fonts.ready.then(() => invalidate('all'));
        bus.on('model:change', () => invalidate('all'));
        bus.on('selection:change', () => invalidate('all'));
        bus.on('theme:change', () => invalidate('all'));
    }
    let pendingSized = [];
    function resize() {
        const r = stage.getBoundingClientRect();
        W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
        dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        for (const c of [scene, overlay]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
        invalidate('all');
        // Inside an iframe (the gallery) the stage can still be 0×0 at DOMContentLoaded; anything
        // that depends on the viewport size (the initial fit) waits for the first real size.
        if (W > 60 && H > 60 && pendingSized.length) { const fns = pendingSized; pendingSized = []; fns.forEach(fn => fn()); }
    }
    function whenSized(fn) { if (W > 60 && H > 60) fn(); else pendingSized.push(fn); }
    function invalidate(layer = 'all') {
        if (layer === 'all' || layer === 'scene') dirty.scene = true;
        if (layer === 'all' || layer === 'overlay') dirty.overlay = true;
        if (!running) { running = true; requestAnimationFrame(frame); }
    }
    function frame(t) {
        const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 1 / 60; lastT = t;
        let active = NA.anim.tick(dt);
        if (inertia.active) {
            const v = view(); v.x -= inertia.vx * dt / v.z; v.y -= inertia.vy * dt / v.z;
            const decay = Math.pow(0.03, dt); inertia.vx *= decay; inertia.vy *= decay;
            if (Math.hypot(inertia.vx, inertia.vy) < 10) inertia.active = false;
            dirty.scene = dirty.overlay = true; active = true; bus.emit('view:change');
        }
        if (NA.render.wantsAnimation()) { dirty.scene = true; active = true; }
        if (dirty.scene) { dirty.scene = false; NA.render.scene(sctx, W, H, dpr); NA.minimap && NA.minimap.draw(); }
        if (dirty.overlay) { dirty.overlay = false; NA.render.overlay(octx, W, H, dpr); }
        if (active || dirty.scene || dirty.overlay) requestAnimationFrame(frame); else { running = false; lastT = 0; }
    }
    function toWorld(sx, sy) { const v = view(); return { x: sx / v.z + v.x, y: sy / v.z + v.y }; }
    function toScreen(wx, wy) { const v = view(); return { x: (wx - v.x) * v.z, y: (wy - v.y) * v.z }; }
    function zoomAt(sx, sy, factor) {
        const v = view(); const nz = clamp(v.z * factor, cfg.ZOOM.MIN, cfg.ZOOM.MAX);
        v.x += sx / v.z - sx / nz; v.y += sy / v.z - sy / nz; v.z = nz;
        bus.emit('view:change'); invalidate('all');
    }
    function panBy(dx, dy) { const v = view(); v.x -= dx / v.z; v.y -= dy / v.z; bus.emit('view:change'); invalidate('all'); }
    function setView(x, y, z, animate = true) {
        const v = view(); z = clamp(z, cfg.ZOOM.MIN, cfg.ZOOM.MAX);
        if (!animate) { v.x = x; v.y = y; v.z = z; bus.emit('view:change'); invalidate('all'); return; }
        const x0 = v.x, y0 = v.y, lz0 = Math.log(v.z), lz1 = Math.log(z);
        // Keep the world point at the screen centre fixed while zooming, so the animation reads as a zoom, not a slide
        NA.anim.tween(360, (e) => { const zz = Math.exp(lz0 + (lz1 - lz0) * e); v.z = zz; v.x = x0 + (x - x0) * e; v.y = y0 + (y - y0) * e; bus.emit('view:change'); invalidate('all'); }, { layer: 'scene' });
    }
    function fit(bounds, pad = 80, animate = true, maxZ = 1.25) {
        if (!bounds) { setView(-80, -80, 1, animate); return; }
        const z = clamp(Math.min((W - 2 * pad) / Math.max(1, bounds.w), (H - 2 * pad) / Math.max(1, bounds.h)), cfg.ZOOM.MIN, maxZ);
        setView(bounds.x + bounds.w / 2 - W / (2 * z), bounds.y + bounds.h / 2 - H / (2 * z), z, animate);
    }
    function fitAll(animate = true) { fit(NA.model.bounds(), 80, animate); }
    // The opening view. A network is one long row, so fitting its width lands at a zoom where
    // nothing is legible; below READ_Z we show the start of the network (the inputs) at a readable
    // zoom instead and let the user pan right. F still fits everything.
    const READ_Z = 0.5;
    function fitReadable(animate = false) {
        const b = NA.model.bounds(); if (!b) { fit(null, 80, animate); return; }
        const pad = 80; const zw = (W - 2 * pad) / Math.max(1, b.w), zh = (H - 2 * pad) / Math.max(1, b.h);
        if (Math.min(zw, zh) >= READ_Z || zh < READ_Z) { fit(b, pad, animate); return; }
        const z = Math.min(zh, 0.6);
        setView(b.x - pad / z, b.y + b.h / 2 - H / (2 * z), z, animate);
    }
    function centerOn(wx, wy, z = null, animate = true) { const v = view(); const zz = z || v.z; setView(wx - W / (2 * zz), wy - H / (2 * zz), zz, animate); }
    function kick(vx, vy) { inertia.vx = vx; inertia.vy = vy; inertia.active = Math.hypot(vx, vy) > 40; if (inertia.active) invalidate('scene'); }
    function stopInertia() { inertia.active = false; }
    function visible() { const v = view(); return { x: v.x, y: v.y, w: W / v.z, h: H / v.z }; }
    NA.canvas = { init, resize, whenSized, invalidate, toWorld, toScreen, zoomAt, panBy, setView, fit, fitAll, fitReadable, centerOn, kick, stopInertia, visible,
                  get size() { return { W, H, dpr }; }, get view() { return view(); }, get stage() { return stage; } };
})();

// ============================================================
// NA.render — scene + overlay passes
// ============================================================
(() => {
    const cfg = NA.config;
    const { clamp, rgba, mix } = NA.util;
    const T = (n) => NA.theme.token(n);
    let flowT = 0;                      // dash animation clock
    let tiles = new Map();              // grid pattern cache
    let shadowSprite = null;            // cached soft shadow (screen-space)
    const FONT = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif";
    const MONO = "'JetBrains Mono', Menlo, monospace";

    // ---- wire geometry ----
    function wire(x1, y1, x2, y2) {
        const dx = x2 - x1;
        let d = clamp(Math.abs(dx) * 0.5, 40, 220);
        if (dx < 60) d = clamp(Math.abs(dx) * 0.4 + 100, 120, 320);
        return { x1, y1, c1x: x1 + d, c1y: y1, c2x: x2 - d, c2y: y2, x2, y2 };
    }
    function bezPt(w, t) {
        const mt = 1 - t;
        return { x: mt * mt * mt * w.x1 + 3 * mt * mt * t * w.c1x + 3 * mt * t * t * w.c2x + t * t * t * w.x2,
                 y: mt * mt * mt * w.y1 + 3 * mt * mt * t * w.c1y + 3 * mt * t * t * w.c2y + t * t * t * w.y2 };
    }
    function addWire(path, w) { path.moveTo(w.x1, w.y1); path.bezierCurveTo(w.c1x, w.c1y, w.c2x, w.c2y, w.x2, w.y2); }
    function wireBox(w) { return { x: Math.min(w.x1, w.x2, w.c1x, w.c2x), y: Math.min(w.y1, w.y2), x2: Math.max(w.x1, w.x2, w.c1x, w.c2x), y2: Math.max(w.y1, w.y2) }; }

    function rr(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function rrTop(ctx, x, y, w, h, r) {
        ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h); ctx.closePath();
    }
    function ellipsize(ctx, text, maxW) {
        if (ctx.measureText(text).width <= maxW) return text;
        let lo = 0, hi = text.length;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
        return lo > 0 ? text.slice(0, lo) + '…' : '';
    }
    function chip(ctx, text, x, y, opts = {}) {
        const font = opts.font || `500 10px ${MONO}`; ctx.font = font;
        const w = ctx.measureText(text).width + 12, h = opts.h || 16;
        const xx = opts.align === 'right' ? x - w : (opts.align === 'center' ? x - w / 2 : x);
        rr(ctx, xx, y, w, h, h / 2); ctx.fillStyle = opts.bg || T('--chip-bg'); ctx.fill();
        if (opts.stroke) { ctx.strokeStyle = opts.stroke; ctx.lineWidth = opts.lw || 1; ctx.stroke(); }
        ctx.fillStyle = opts.color || T('--chip-text'); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.fillText(text, xx + w / 2, y + h / 2 + 0.5);
        ctx.textAlign = 'left';
        return { x: xx, y, w, h };
    }

    // Soft shadow sprite: a blurred rounded rect rendered once per zoom bucket (never shadowBlur per block)
    function getShadow(z, hover) {
        const key = Math.round(z * 8) + (hover ? 'h' : 'n') + NA.theme.current;
        if (shadowSprite && shadowSprite.key === key) return shadowSprite;
        const blur = (hover ? 28 : 16) * z, off = (hover ? 10 : 6) * z, pad = Math.ceil(blur * 2 + off);
        const size = 120 * z; const c = document.createElement('canvas'); c.width = Math.ceil(size + pad * 2); c.height = Math.ceil(size + pad * 2);
        const x = c.getContext('2d'); x.shadowColor = T('--shadow-color'); x.shadowBlur = blur; x.shadowOffsetY = off; x.fillStyle = '#000';
        rr(x, pad, pad, size, size, 12 * z); x.fill();
        shadowSprite = { key, c, pad, size, z };
        return shadowSprite;
    }
    function drawShadow(ctx, r, z, hover) {
        const s = getShadow(z, hover); const p = s.pad / z;   // 9-slice in world units
        const sw = s.size, sp = s.pad;
        // Corner slices never reach further into the block than half its own width / height, so
        // the sprite's solid centre stays hidden under blocks shorter than the sprite (collapsed, pills)
        const hx = Math.min(sw / 2, r.w * z / 2), hy = Math.min(sw / 2, r.h * z / 2);   // source half-extent (sprite px)
        const wx = hx / z, wy = hy / z;                                                  // the same in world units
        ctx.save(); ctx.globalAlpha = hover ? 1 : 0.9;
        const drawSlice = (sx, sy, sw2, sh2, dx, dy, dw, dh) => ctx.drawImage(s.c, sx, sy, sw2, sh2, dx, dy, dw, dh);
        const cx = r.x + wx, cy = r.y + wy, ex = r.x + r.w - wx, ey = r.y + r.h - wy;
        const R = sp + sw - hx, B = sp + sw - hy;    // source x / y where the right / bottom slices start
        // corners
        drawSlice(0, 0, sp + hx, sp + hy, r.x - p, r.y - p, p + wx, p + wy);
        drawSlice(R, 0, sp + hx, sp + hy, ex, r.y - p, p + wx, p + wy);
        drawSlice(0, B, sp + hx, sp + hy, r.x - p, ey, p + wx, p + wy);
        drawSlice(R, B, sp + hx, sp + hy, ex, ey, p + wx, p + wy);
        // edges
        if (ex > cx) { drawSlice(sp + hx, 0, 1, sp + hy, cx, r.y - p, ex - cx, p + wy); drawSlice(sp + hx, B, 1, sp + hy, cx, ey, ex - cx, p + wy); }
        if (ey > cy) { drawSlice(0, sp + hy, sp + hx, 1, r.x - p, cy, p + wx, ey - cy); drawSlice(R, sp + hy, sp + hx, 1, ex, cy, p + wx, ey - cy); }
        if (ex > cx && ey > cy) drawSlice(sp + hx, sp + hy, 1, 1, cx, cy, ex - cx, ey - cy);
        ctx.restore();
    }

    // ---- grid ----
    // Drawn in WORLD space so dots stay glued to the model while zooming: the tile is rasterised
    // at the current device size, then a pattern transform gives it an exact period of `s` world
    // units anchored at the world origin. Two levels: the coarse one solid, the finer one fading
    // in as it grows, so nothing pops when the spacing doubles.
    function drawGrid(ctx, v, vis) {
        const st = NA.model.get().settings; if (!st.grid) return;
        const dpr = NA.canvas.size.dpr;
        // One level of dots at ≥ 24 px; the next finer level only appears in the last stretch
        // before it takes over (18 → 24 px) so the switch does not pop, without a second grid
        let s = cfg.GRID; while (s * v.z < 24) s *= 2;
        const fine = s / 2, fineA = clamp((fine * v.z - 18) / (24 - 18), 0, 1);
        const levels = [{ s, a: 1 }]; if (fineA > 0.02 && fine >= cfg.GRID) levels.push({ s: fine, a: fineA * 0.6 });
        for (const lv of levels) {
            const px = lv.s * v.z * dpr;                     // tile size in device pixels
            const N = Math.max(4, Math.round(px));
            const key = N + NA.theme.current;
            let pat = tiles.get(key);
            if (!pat) {
                const c = document.createElement('canvas'); c.width = N; c.height = N;
                const x = c.getContext('2d'); x.fillStyle = T('--grid-dot'); x.beginPath(); x.arc(N / 2, N / 2, Math.min(1.5 * dpr, N / 8), 0, Math.PI * 2); x.fill();
                pat = ctx.createPattern(c, 'repeat'); if (tiles.size > 40) tiles.clear(); tiles.set(key, pat);
            }
            const k = lv.s / N;                              // world units per tile pixel → exact period
            if (pat.setTransform) pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
            ctx.save(); ctx.globalAlpha = lv.a; ctx.fillStyle = pat; ctx.fillRect(vis.x, vis.y, vis.w, vis.h); ctx.restore();
        }
    }

    // ---- scene ----
    let frameCache = null;   // per-frame wire geometry: edgeId -> wire
    function edgeWire(e, g) { const p = NA.model.edgeEndpoints(e, g); return p ? wire(p.x1, p.y1, p.x2, p.y2) : null; }
    function dotLod(b, z) { const L = NA.model.neuronLayout(b); if (!L) return null; const px = L.pitch * z; return px >= cfg.LOD.DOTS_MIN_PX ? { L, px } : null; }

    function scene(ctx, W, H, dpr) {
        const st = NA.model.get(); if (!st) return; const g = NA.model.graph(); const v = st.view; const z = v.z;
        const sel = NA.selection.state; const hover = NA.interact ? NA.interact.hover : null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = T('--canvas-bg'); ctx.fillRect(0, 0, W, H);
        ctx.setTransform(dpr * z, 0, 0, dpr * z, -v.x * dpr * z, -v.y * dpr * z);
        const vis = NA.canvas.visible(); const inView = (r) => r.x < vis.x + vis.w && r.x + r.w > vis.x && r.y < vis.y + vis.h && r.y + r.h > vis.y;
        drawGrid(ctx, v, vis);
        const rects = new Map(); for (const b of g.blocks) rects.set(b.id, NA.model.rect(b, g));
        const k = 1 / z;

        // Group frames. The head band grows with the title font so the frame name and a block's
        // floating title (both enlarged at low zoom) never sit on top of each other.
        const gfs = titleFont(z); const headBand = 9 * z < cfg.LOD.MIN_TEXT_PX ? gfs * 2 + 28 : Math.max(44, gfs + 20);
        for (const gr of g.groups) {
            const rs = gr.blocks.map(id => rects.get(id)).filter(Boolean); if (!rs.length) continue;
            const x = Math.min(...rs.map(r => r.x)) - 24, y = Math.min(...rs.map(r => r.y)) - headBand, x2 = Math.max(...rs.map(r => r.x + r.w)) + 24, y2 = Math.max(...rs.map(r => r.y + r.h)) + 24;
            const fr = { x, y, w: x2 - x, h: y2 - y }; gr._rect = fr; if (!inView(fr)) continue;
            const col = gr.color || T('--accent'); const isSel = sel.groups.has(gr.id);
            rr(ctx, x, y, fr.w, fr.h, 18); ctx.fillStyle = rgba(col, 0.07); ctx.fill();
            ctx.strokeStyle = rgba(col, isSel ? 0.9 : 0.35); ctx.lineWidth = (isSel ? 2 : 1.2) * k; ctx.setLineDash([]); ctx.stroke();
            { const fs = titleFont(z); if (fs * z >= cfg.LOD.MIN_TEXT_PX && fs < 44) { ctx.font = `600 ${fs}px ${FONT}`; ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.fillText(ellipsize(ctx, gr.name, fr.w - 32), x + 16, y + 6 + fs / 2 + 4); } }
        }

        // Dense edges
        frameCache = new Map();
        const paths = { n: new Path2D(), h: new Path2D(), s: new Path2D() }; const labels = [];
        for (const e of g.edges) {
            const w = edgeWire(e, g); if (!w) continue; frameCache.set(e.id, w);
            const bb = wireBox(w); if (bb.x2 < vis.x || bb.x > vis.x + vis.w || bb.y2 < vis.y || bb.y > vis.y + vis.h) continue;
            const state = sel.edges.has(e.id) ? 's' : (hover && hover.type === 'edge' && hover.edge.id === e.id ? 'h' : 'n');
            addWire(paths[state], w);
            e._chip = null;
            const showShape = st.settings.showShapes && z > 0.55;
            if (showShape || e.act) { const src = NA.model.block(e.from.block, g); const s = showShape ? NA.graph.portShape(src, e.from.port) : null; labels.push({ e, w, text: s ? NA.util.fmtShape(s).replace('B, ', '') : '', state, name: showShape ? NA.model.portLabel(src, e.from.port) : '', act: e.act ? NA.catalogue.ACT[e.act] : null }); }
        }
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const lw = Math.max(2, 1.6 * k);
        ctx.setLineDash([]);
        ctx.strokeStyle = T('--wire'); ctx.lineWidth = lw; ctx.stroke(paths.n);
        ctx.strokeStyle = T('--accent'); ctx.lineWidth = lw * 1.6; ctx.globalAlpha = 0.25; ctx.stroke(paths.s); ctx.globalAlpha = 1;
        ctx.lineWidth = lw * 1.1; ctx.stroke(paths.s);
        if (st.settings.animateWires) { ctx.setLineDash([10 * k, 8 * k]); ctx.lineDashOffset = -flowT * 40 * k; }
        ctx.strokeStyle = T('--accent-2'); ctx.lineWidth = lw * 1.3; ctx.stroke(paths.h); ctx.setLineDash([]);
        const actCol = NA.catalogue.get('activation').color;
        // Wires that meet at one port (or leave one) converge, so their pills would stack: spread
        // them along the wire, ordered by the other end's height, so each stays readable
        const spread = (keyOf) => { const groups = new Map(); for (const l of labels) { const kk = keyOf(l.e); if (!groups.has(kk)) groups.set(kk, []); groups.get(kk).push(l); } const off = new Map(); for (const list of groups.values()) { list.sort((a, b) => (a.w.y1 + a.w.y2) - (b.w.y1 + b.w.y2)); list.forEach((l, i) => off.set(l, (i - (list.length - 1) / 2) * 0.14)); } return off; };
        const byTarget = spread(e => e.to.block + ':' + e.to.port), bySource = spread(e => e.from.block + ':' + e.from.port);
        for (const l of labels) {
            const m = bezPt(l.w, clamp(0.5 + (byTarget.get(l) || 0) + (bySource.get(l) || 0), 0.2, 0.8));
            const shapeText = l.text ? (l.name ? `${l.name} ${l.text}` : l.text) : '';
            if (l.act) {
                // The activation is the link itself: a pill on the wire, never smaller than ~10px on screen
                const sc = Math.max(1, 0.95 * k); if (sc * z < 0.04) continue;
                ctx.save(); ctx.translate(m.x, m.y); ctx.scale(sc, sc);
                const on = l.state !== 'n';
                const c = chip(ctx, l.act.label, 0, -9, { align: 'center', h: 18, font: `600 10.5px ${FONT}`, bg: on ? T('--accent') : rgba(actCol, NA.theme.current === 'dark' ? 0.28 : 0.16), color: on ? '#fff' : actCol, stroke: on ? null : rgba(actCol, 0.55), lw: 1 });
                if (shapeText) { ctx.font = `500 9px ${MONO}`; ctx.fillStyle = T('--text-muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(shapeText, 0, 17); ctx.textAlign = 'left'; }
                ctx.restore();
                l.e._chip = { x: m.x + c.x * sc, y: m.y + c.y * sc, w: c.w * sc, h: c.h * sc };
            } else if (shapeText) {
                // Same rule as the pills: never smaller than ~10 px on screen, so a zoomed-out wire
                // carries a readable shape instead of a speck
                const sc = Math.max(1, 0.95 * k);
                ctx.save(); ctx.translate(m.x, m.y); ctx.scale(sc, sc);
                chip(ctx, shapeText, 0, -8, { align: 'center', bg: l.state === 'n' ? T('--chip-bg') : T('--accent'), color: l.state === 'n' ? T('--chip-text') : '#fff' });
                ctx.restore();
            }
        }

        // Neuron edges: per (from, to) pair
        const pairs = new Map();
        for (const n of g.neuronEdges) { const key = n.from.block + '>' + n.to.block; if (!pairs.has(key)) pairs.set(key, []); pairs.get(key).push(n); }
        const lodCache = new Map(); const lod = (b) => { if (!lodCache.has(b.id)) lodCache.set(b.id, dotLod(b, z)); return lodCache.get(b.id); };
        for (const [key, list] of pairs) {
            const [f, t] = key.split('>'); const fb = NA.model.block(f, g), tb = NA.model.block(t, g); if (!fb || !tb) continue;
            const fr = rects.get(f), tr = rects.get(t);
            const union = { x: Math.min(fr.x, tr.x), y: Math.min(fr.y, tr.y), w: Math.max(fr.x + fr.w, tr.x + tr.w) - Math.min(fr.x, tr.x), h: Math.max(fr.y + fr.h, tr.y + tr.h) - Math.min(fr.y, tr.y) };
            if (!inView(union)) continue;
            const lf = lod(fb), lt = lod(tb);
            let drawn = 0;
            if (lf && lt) {
                const pn = new Path2D(), ps = new Path2D(); let ns = 0;
                for (const n of list) {
                    const a = NA.model.neuronCenter(fb, n.from.idx, lf.L), c = NA.model.neuronCenter(tb, n.to.idx, lt.L); if (!a || !c) continue;
                    const isS = sel.neuronEdges.has(n.id) || (hover && hover.type === 'neuronEdge' && hover.edge.id === n.id);
                    const p = isS ? ps : pn; if (isS) ns++;
                    const d = clamp(Math.abs(c.x - a.x) * 0.4, 20, 120);
                    p.moveTo(a.x, a.y); p.bezierCurveTo(a.x + d, a.y, c.x - d, c.y, c.x, c.y); drawn++;
                    n._geom = { x1: a.x, y1: a.y, c1x: a.x + d, c1y: a.y, c2x: c.x - d, c2y: c.y, x2: c.x, y2: c.y };
                }
                ctx.strokeStyle = T('--wire-sparse'); ctx.lineWidth = Math.max(1, 1.2 * k); ctx.stroke(pn);
                if (ns) { ctx.strokeStyle = T('--accent'); ctx.lineWidth = Math.max(2, 2 * k); ctx.stroke(ps); }
            }
            if (!lf || !lt || !drawn) {
                for (const n of list) n._geom = null;
                // bundle: one dashed wire between the blocks with a count badge
                const w = wire(fr.x + fr.w, fr.y + fr.h / 2 + 8, tr.x, tr.y + tr.h / 2 + 8);
                const p = new Path2D(); addWire(p, w);
                ctx.setLineDash([6 * k, 6 * k]); ctx.strokeStyle = T('--wire-sparse'); ctx.lineWidth = Math.max(1.5, 1.5 * k); ctx.stroke(p); ctx.setLineDash([]);
                const m = bezPt(w, 0.5); chip(ctx, `${list.length} neuron edge${list.length > 1 ? 's' : ''}`, m.x, m.y + 4, { align: 'center', bg: T('--chip-bg'), color: T('--text-muted') });
            }
        }

        // Blocks
        floating = [];
        for (const b of g.blocks) { const r = rects.get(b.id); if (inView({ x: r.x - 30, y: r.y - 30, w: r.w + 60, h: r.h + 60 })) drawBlock(ctx, b, r, g, z, sel, hover); }
        // Floating titles (blocks too small for an in-header title) go on top of everything so a
        // label never hides under the block above it
        for (const f of floating) drawFloatingTitle(ctx, f, z, rects);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    let floating = [];
    // How a block's title is shown at this zoom: 'full' (kind line, title, buttons, chips),
    // 'compact' (title only, enlarged so it never drops below TITLE_MIN_PX on screen) or
    // 'float' (the header is too short for that size: the title sits above the block).
    function titleMode(r, z) {
        if (9 * z >= cfg.LOD.MIN_TEXT_PX) return 'full';
        const hh = r.mode === 'pill' ? r.h : cfg.HEADER_H;
        return cfg.LOD.TITLE_MIN_PX / z <= hh - 2 ? 'compact' : 'float';
    }
    function titleFont(z) { return Math.max(13, cfg.LOD.TITLE_MIN_PX / z); }
    // A floating title sits above its block. When another block is there (stacked lanes), it goes
    // below; when that is taken too, inside the body — it never covers a neighbour.
    function drawFloatingTitle(ctx, f, z, rects) {
        const fs = titleFont(z); const k = 1 / z;
        const maxW = cfg.BLOCK_W + cfg.LANE_GAP_X - 14 * k;
        if (maxW * z < 26) return;                       // lanes are a couple of dozen pixels: nothing fits
        ctx.font = `600 ${fs}px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        const text = ellipsize(ctx, f.title, maxW); if (text.length < 2) return;
        const w = ctx.measureText(text).width + 8 * k, h = fs + 5 * k, x = f.r.x - 4 * k;
        const hits = (bx) => { for (const r of rects.values()) { if (r === f.r) continue; if (bx.x < r.x + r.w && bx.x + bx.w > r.x && bx.y < r.y + r.h && bx.y + bx.h > r.y) return true; } return false; };
        let box = { x, y: f.r.y - 7 * k - h, w, h };
        if (hits(box)) { box = { x, y: f.r.y + f.r.h + 7 * k, w, h }; if (hits(box)) box = { x: x + 8 * k, y: f.r.y + (f.r.mode === 'pill' ? 4 * k : cfg.HEADER_H + 4 * k), w, h }; }
        rr(ctx, box.x, box.y, box.w, box.h, 4 * k); ctx.fillStyle = rgba(T('--block-bg'), 0.9); ctx.fill();
        ctx.fillStyle = f.error ? T('--danger') : T('--text'); ctx.fillText(text, box.x + 4 * k, box.y + fs + 1 * k);
        ctx.fillStyle = f.col; ctx.fillRect(box.x, box.y, 2.5 * k, box.h);
    }
    function drawBlock(ctx, b, r, g, z, sel, hover) {
        const k = 1 / z; const col = NA.model.blockColor(b);
        const isSel = sel.blocks.has(b.id); const isHov = hover && hover.type === 'block' && hover.block.id === b.id;
        const isDrop = hover && hover.dropTarget === b.id;
        const kdef = NA.catalogue.get(b.kind);
        drawShadow(ctx, r, z, isHov || isSel);
        // card
        rr(ctx, r.x, r.y, r.w, r.h, 12); ctx.fillStyle = T('--block-bg'); ctx.fill();
        // header tint
        const hh = r.mode === 'pill' ? r.h : cfg.HEADER_H;
        ctx.save(); rr(ctx, r.x, r.y, r.w, r.h, 12); ctx.clip();
        ctx.fillStyle = rgba(col, NA.theme.current === 'dark' ? 0.2 : 0.14); ctx.fillRect(r.x, r.y, r.w, hh);
        if (r.mode === 'collapsed') { ctx.fillStyle = rgba(col, NA.theme.current === 'dark' ? 0.08 : 0.05); ctx.fillRect(r.x, r.y + hh, r.w, r.h - hh); }
        ctx.fillStyle = col; ctx.fillRect(r.x, r.y, 4, r.mode === 'collapsed' ? r.h : hh);
        if (r.mode !== 'pill') { ctx.fillStyle = rgba(col, 0.35); ctx.fillRect(r.x, r.y + hh - 1, r.w, 1); }
        ctx.restore();
        // border
        rr(ctx, r.x, r.y, r.w, r.h, 12);
        ctx.strokeStyle = isDrop ? T('--accent') : (isSel ? T('--accent') : (isHov ? rgba(col, 0.8) : T('--block-border')));
        ctx.lineWidth = (isSel || isDrop ? 2 : 1) * k; ctx.stroke();

        // header text
        const textOk = (px) => px * z >= cfg.LOD.MIN_TEXT_PX;
        const tx = r.x + 14, cy = r.y + hh / 2;
        const tmode = titleMode(r, z);
        const n0 = NA.model.effectiveSize(b);
        const shownTitle = r.mode === 'collapsed' && n0 !== null && !b.regions.length ? `${b.title} ${NA.model.rangeSummary(b, g)}` : b.title;
        if (tmode === 'float') floating.push({ r, title: shownTitle, col, error: !!b._error && b._level !== 'warn' });
        else if (tmode === 'compact') {
            // Title only, enlarged to stay legible; a constant-size error dot keeps problems visible
            const fs = titleFont(z), k2 = 1 / z;
            ctx.font = `600 ${fs}px ${FONT}`; ctx.fillStyle = T('--text'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            const room = r.w - 10 * k2 - (b._error ? 14 * k2 : 0) - 10;
            const text = ellipsize(ctx, shownTitle, room);
            if (text.length >= 2) ctx.fillText(text, r.x + 10 * k2, cy);
            if (b._error) { ctx.beginPath(); ctx.arc(r.x + r.w - 9 * k2, cy, 4 * k2, 0, Math.PI * 2); ctx.fillStyle = b._level === 'warn' ? T('--warn') : T('--danger'); ctx.fill(); }
        }
        if (tmode === 'full') {
            ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            const sub = kdef.subtitle ? kdef.subtitle(b) : null;
            const n = NA.model.effectiveSize(b);
            ctx.font = `700 9px ${FONT}`; ctx.fillStyle = col;
            const infer = NA.model.get().settings.mode === 'infer';
            const kindLine = (kdef.label + (sub ? ' · ' + sub : '') + (r.mode === 'collapsed' && n !== null ? ` · ${n} neurons` : '')).toUpperCase();
            ctx.fillText(kindLine, tx, cy - 9);
            if (b.dropout > 0) {
                const dx = tx + ctx.measureText(kindLine).width + 6; const dt = `DROPOUT ${b.dropout}`;
                ctx.fillStyle = infer ? T('--text-muted') : T('--warn'); ctx.fillText(dt, dx, cy - 9);
                if (infer) { const w = ctx.measureText(dt).width; ctx.fillRect(dx, cy - 9, w, 1); }
            }
            ctx.font = `600 13px ${FONT}`; ctx.fillStyle = T('--text');
            // Collapsed blocks carry their neuron range: "Block A (0–9)" in the title, or one row per region below
            const title = r.mode === 'collapsed' && n !== null && !b.regions.length ? `${b.title} ${NA.model.rangeSummary(b, g)}` : b.title;
            ctx.fillText(ellipsize(ctx, title, r.w - (r.mode === 'collapsed' ? 74 : 90)), tx, cy + 6);
            if (r.mode === 'collapsed' && b.regions.length && textOk(9)) {
                const off = NA.model.neuronOffset(b, g);
                b.regions.slice().sort((a, c) => a.start - c.start).forEach((reg, i) => {
                    const ry = r.y + cfg.HEADER_H + 4 + (i + 0.5) * cfg.COLLAPSED_ROW_H; const rc = reg.color || col;
                    rr(ctx, tx, ry - 4, 8, 8, 2); ctx.fillStyle = rc; ctx.fill();
                    ctx.font = `600 10px ${FONT}`; ctx.fillStyle = T('--text'); ctx.textBaseline = 'middle';
                    ctx.fillText(ellipsize(ctx, `${reg.name} (${off + reg.start}–${off + reg.end - 1})`, r.w - 40), tx + 14, ry);
                });
            }
            // header buttons (collapse, layout) then the size / shape chip to their left
            const btns = NA.model.headerButtons(b, r);
            let right = r.x + r.w - 12;
            for (const bt of btns) {
                const hovB = hover && hover.type === 'block' && hover.block.id === b.id && hover.button === bt.id;
                rr(ctx, bt.x, bt.y, bt.w, bt.h, 4); ctx.fillStyle = hovB ? rgba(col, 0.35) : rgba(col, 0.12); ctx.fill();
                ctx.strokeStyle = T('--text-muted'); ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.fillStyle = T('--text-muted');
                const cx = bt.x + bt.w / 2, cy2 = bt.y + bt.h / 2;
                if (bt.id === 'collapse') { ctx.beginPath(); if (r.mode === 'collapsed') { ctx.moveTo(cx - 2, cy2 - 3.5); ctx.lineTo(cx + 2, cy2); ctx.lineTo(cx - 2, cy2 + 3.5); } else { ctx.moveTo(cx - 3.5, cy2 - 2); ctx.lineTo(cx, cy2 + 2); ctx.lineTo(cx + 3.5, cy2 - 2); } ctx.stroke(); }
                else { const lay = NA.model.resolvedLayout(b);
                    if (lay === 'grid') { for (let i = 0; i < 4; i++) ctx.fillRect(cx - 4 + (i % 2) * 5, cy2 - 4 + Math.floor(i / 2) * 5, 3, 3); }
                    else if (lay === 'rows') { ctx.fillRect(cx - 4, cy2 - 4, 8, 3); ctx.fillRect(cx - 4, cy2 + 1, 8, 3); }
                    else { for (let i = 0; i < 3; i++) ctx.fillRect(cx - 4, cy2 - 4.5 + i * 3.5, 8, 2); } }
                right = Math.min(right, bt.x - 6);
            }
            let chipText = null;
            if (kdef.hasSize) chipText = String(b.size); else if (b._shape) chipText = b._shape.length === 1 ? String(b._shape[0]) : '[' + b._shape.join(',') + ']';
            if (b.kind === 'module' || r.mode === 'collapsed') chipText = null;
            if (b._error) chip(ctx, b._level === 'warn' ? '!' : '✕', right, cy - 8, { align: 'right', bg: b._level === 'warn' ? T('--warn') : T('--danger'), color: '#fff', font: `700 10px ${FONT}` });
            else if (chipText) chip(ctx, chipText, right, cy - 8, { align: 'right' });
            // comment marker
            if (b.comment && !b._error) { ctx.fillStyle = T('--text-muted'); ctx.font = `600 9px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText('✎', right - (chipText ? ctx.measureText(chipText).width + 22 : 0), cy + 6); ctx.textAlign = 'left'; }
        }

        // body
        if (r.mode === 'dots' || r.mode === 'column') drawDots(ctx, b, r, z, sel, hover);
        else if (r.mode === 'strip') drawStrip(ctx, b, r, z, sel, hover);

        // ports
        const ports = NA.model.ports(b, g);
        for (const p of ports) {
            const connected = p.dir === 'in' ? g.edges.some(e => e.to.block === b.id && e.to.port === p.id) : g.edges.some(e => e.from.block === b.id && e.from.port === p.id);
            let pc = col;
            if (p.id.startsWith('out:') && b.kind !== 'module') { const reg = b.regions.find(x => x.id === p.id.slice(4)); if (reg) pc = reg.color || col; }
            const hovP = hover && hover.type === 'port' && hover.block.id === b.id && hover.port.id === p.id;
            const pr = (hovP ? 7 : cfg.PORT_R) * Math.max(1, k * 0.9);
            ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
            ctx.fillStyle = connected || hovP ? pc : T('--block-bg'); ctx.fill();
            ctx.strokeStyle = pc; ctx.lineWidth = 1.6 * Math.max(1, k * 0.9); ctx.stroke();
            // an in-port that sits at header height would print its label over the title: the wire says enough there
            if (p.label && textOk(9) && (p.dir === 'in' || b.kind === 'module') && !(p.dir === 'in' && r.mode !== 'pill' && p.y < r.y + cfg.HEADER_H)) {
                ctx.font = `500 9px ${FONT}`; ctx.fillStyle = T('--text-muted'); ctx.textBaseline = 'middle';
                if (p.dir === 'in') { ctx.textAlign = 'left'; ctx.fillText(ellipsize(ctx, p.label, 90), p.x + 12, p.y); }
                else { ctx.textAlign = 'right'; ctx.fillText(ellipsize(ctx, p.label, 90), p.x - 12, p.y); ctx.textAlign = 'left'; }
            }
        }
    }

    function drawDots(ctx, b, r, z, sel, hover) {
        const L = NA.model.neuronLayout(b); if (!L) return;
        const px = L.pitch * z; const col = NA.model.blockColor(b); const k = 1 / z;
        const off = NA.model.neuronOffset(b);
        const selN = sel.neurons.get(b.id);
        const hovN = hover && hover.type === 'neuron' && hover.block.id === b.id ? hover.idx : -1;
        // region bands
        for (const reg of b.regions) {
            const rc = reg.color || col;
            for (const c of NA.model.regionCells(b, reg.start, reg.end, L)) { rr(ctx, c.x, c.y, c.w, c.h, Math.min(6, L.pitch / 2)); ctx.fillStyle = rgba(rc, 0.16); ctx.fill(); }
        }
        // Selected neurons keep the row highlight the marquee showed: tinted cell, a bar at the left, the dot in accent
        if (selN && selN.size && px >= cfg.LOD.DOTS_MIN_PX) {
            const hp = new Path2D(), bar = new Path2D(); const hrad = Math.min(5, L.pitch / 3);
            for (const idx of selN) { if (idx < L.start || idx >= L.end) continue; const i = idx - L.start; const x = L.x0 + (i % L.cols) * L.cellW, y = L.y0 + Math.floor(i / L.cols) * L.pitch; hp.roundRect(x, y, L.cellW, L.pitch, hrad); if (L.column) bar.rect(x - 3 * k, y + 1, 2.5 * k, L.pitch - 2); }
            ctx.fillStyle = rgba(T('--accent'), 0.22); ctx.fill(hp); ctx.fillStyle = T('--accent'); ctx.fill(bar);
        }
        if (L.column && px >= cfg.LOD.DOTS_MIN_PX) {
            // One neuron per row: dot at the left, index and label beside it
            const base = new Path2D(), ann = new Path2D(), selP = new Path2D(); const rad = L.pitch * 0.3;
            for (let i = 0; i < L.count; i++) { const idx = L.start + i; const cx = L.x0 + L.pitch / 2, cy = L.y0 + (i + 0.5) * L.pitch; const p = selN && selN.has(idx) ? selP : (b.neurons[idx] ? ann : base); p.moveTo(cx + rad, cy); p.arc(cx, cy, rad, 0, Math.PI * 2); }
            ctx.fillStyle = T('--neuron'); ctx.fill(base); ctx.fillStyle = col; ctx.fill(ann); ctx.fillStyle = T('--accent'); ctx.fill(selP);
            const fs = L.pitch * cfg.COL_LABEL_SCALE, fi = L.pitch * 0.6;
            if (fi * z >= cfg.LOD.MIN_TEXT_PX - 1) {
                ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
                for (let i = 0; i < L.count; i++) {
                    const idx = L.start + i; const cy = L.y0 + (i + 0.5) * L.pitch; const n = b.neurons[idx]; const x = L.x0 + L.pitch + 4;
                    ctx.font = `500 ${fi}px ${MONO}`; ctx.fillStyle = T('--text-muted'); ctx.fillText(String(idx + off), x, cy);
                    if (n && n.label) { ctx.font = `600 ${fs}px ${FONT}`; ctx.fillStyle = T('--text'); ctx.fillText(ellipsize(ctx, n.label, L.cellW - L.pitch - 40), x + 30, cy); }
                    else if (hovN === idx) { ctx.font = `italic 500 ${fi}px ${FONT}`; ctx.fillStyle = rgba(T('--text-muted'), 0.7); ctx.fillText('double-click to label', x + 30, cy); }
                }
            }
        } else if (px >= cfg.LOD.DOTS_MIN_PX) {
            const base = new Path2D(), ann = new Path2D(), selP = new Path2D();
            const circles = px >= cfg.LOD.CIRCLE_PX; const rad = px >= cfg.LOD.INDEX_PX ? L.pitch * 0.2 : L.pitch * 0.3;
            const offY = px >= cfg.LOD.INDEX_PX ? -L.pitch * 0.13 : 0;
            for (let i = 0; i < L.count; i++) {
                const idx = L.start + i; const cx = L.x0 + ((i % L.cols) + 0.5) * L.pitch, cy = L.y0 + (Math.floor(i / L.cols) + 0.5) * L.pitch + offY;
                const p = selN && selN.has(idx) ? selP : (b.neurons[idx] ? ann : base);
                if (circles) { p.moveTo(cx + rad, cy); p.arc(cx, cy, rad, 0, Math.PI * 2); } else p.rect(cx - rad, cy - rad, rad * 2, rad * 2);
            }
            ctx.fillStyle = T('--neuron'); ctx.fill(base);
            ctx.fillStyle = col; ctx.fill(ann);
            ctx.fillStyle = T('--accent'); ctx.fill(selP);
            if (px >= cfg.LOD.INDEX_PX) {
                const fs = L.pitch * 0.24; ctx.font = `500 ${fs}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                for (let i = 0; i < L.count; i++) {
                    const idx = L.start + i; const cx = L.x0 + ((i % L.cols) + 0.5) * L.pitch, cy = L.y0 + (Math.floor(i / L.cols) + 0.5) * L.pitch + L.pitch * 0.28;
                    const n = b.neurons[idx];
                    ctx.fillStyle = n ? T('--text') : T('--text-muted'); ctx.font = n ? `600 ${fs}px ${FONT}` : `500 ${fs}px ${MONO}`;
                    ctx.fillText(n && n.label ? ellipsize(ctx, n.label, L.pitch * 0.95) : String(idx + off), cx, cy);
                }
                ctx.textAlign = 'left';
            }
        } else {
            // Too far out for neurons: the body carries the one number that matters and the kind, at constant screen size
            const by = r.y + cfg.HEADER_H, bh = r.h - cfg.HEADER_H;
            if (bh * z >= 13 && r.w * z >= 44) {
                const kd = NA.catalogue.get(b.kind); const n = NA.model.effectiveSize(b);
                const big = n !== null ? String(n) : (b._shape ? b._shape.join('×') : ''); const small = kd.label.toUpperCase() + (b.kind === 'conv1d' || b.kind === 'conv2d' ? ' CH' : '');
                const two = bh * z >= 32; const cx = r.x + r.w / 2, cy = by + bh / 2;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                if (big) { ctx.font = `600 ${(two ? 15 : 12) * k}px ${MONO}`; ctx.fillStyle = b.regions.length ? T('--text') : rgba(T('--text'), 0.75); ctx.fillText(big, cx, two ? cy - 7 * k : cy); }
                if (two && 8.5 * k * z >= cfg.LOD.MIN_TEXT_PX) { ctx.font = `700 ${8.5 * k}px ${FONT}`; ctx.fillStyle = rgba(T('--text-muted'), 0.9); ctx.fillText(ellipsize(ctx, small, r.w - 12 * k), cx, cy + 8 * k); }
                ctx.textAlign = 'left';
            }
        }
        // region labels hang in the left margin next to their band (the body has no input ports, so that space is free)
        if (8 * z >= cfg.LOD.MIN_TEXT_PX) {
            let lastBottom = -Infinity;
            for (const reg of b.regions.slice().sort((a, c) => a.start - c.start)) {
                const cells = NA.model.regionCells(b, reg.start, reg.end, L); if (!cells.length) continue;
                const top = cells[0].y, bot = cells[cells.length - 1].y + cells[cells.length - 1].h; const cy = (top + bot) / 2;
                const y = Math.max(cy - 7, lastBottom + 2); if (y > bot + 4) continue;
                const rc = reg.color || col;
                const c = chip(ctx, `${reg.name} · ${off + reg.start}–${off + reg.end - 1}`, r.x - 6, y, { align: 'right', bg: rc, color: '#fff', font: `600 8.5px ${FONT}`, h: 14 });
                ctx.fillStyle = rc; ctx.fillRect(r.x - 6, y + 6, 6, 2);
                lastBottom = c.y + c.h;
            }
        }
        // hover ring
        if (hovN >= 0) { const c = NA.model.neuronCenter(b, hovN, L); if (c) { ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(L.pitch * 0.42, 6 * k), 0, Math.PI * 2); ctx.strokeStyle = T('--accent'); ctx.lineWidth = 2 * k; ctx.stroke(); } }
    }

    function drawStrip(ctx, b, r, z, sel, hover) {
        const rows = NA.model.stripRows(b); const col = NA.model.blockColor(b); const k = 1 / z; const off = NA.model.neuronOffset(b);
        const x = r.x + cfg.BODY_PAD, y0 = r.y + cfg.HEADER_H + cfg.BODY_PAD, w = r.w - 2 * cfg.BODY_PAD;
        const shown = rows.slice(0, cfg.STRIP_MAX_ROWS);
        // Row text is the block's table of contents, so it stays legible while the row is tall enough
        // to hold it: at least ~9 px on screen, enlarged in world units when zoomed out
        const fs = Math.max(10, 9 / z), fsm = Math.max(9, 8 / z); const textOk = cfg.STRIP_ROW_H * z >= 11;
        shown.forEach((row, i) => {
            const y = y0 + i * cfg.STRIP_ROW_H; const rc = row.color || (row.auto ? T('--text-muted') : col);
            const isExp = b.ui.expandedRegion === row.id; const isHov = hover && hover.type === 'strip-row' && hover.block.id === b.id && hover.row.id === row.id;
            if (isExp || isHov) { rr(ctx, x, y + 2, w, cfg.STRIP_ROW_H - 4, 6); ctx.fillStyle = rgba(rc, isExp ? 0.18 : 0.1); ctx.fill(); }
            rr(ctx, x + 8, y + 7, 10, 10, 3); ctx.fillStyle = rc; ctx.fill();
            if (textOk) {
                ctx.textBaseline = 'middle'; ctx.font = `${row.auto ? 500 : 600} ${fs}px ${FONT}`; ctx.fillStyle = row.auto ? T('--text-muted') : T('--text');
                ctx.font = `500 ${fsm}px ${MONO}`; const rangeText = row.auto ? `${row.end - row.start}` : `${off + row.start}–${off + row.end - 1} · ${row.end - row.start}`; const rw = ctx.measureText(rangeText).width;
                ctx.font = `${row.auto ? 500 : 600} ${fs}px ${FONT}`;
                ctx.fillText(ellipsize(ctx, row.auto ? `neurons ${off + row.start}–${off + row.end - 1}` : row.name, w - 40 - rw - 12), x + 26, y + cfg.STRIP_ROW_H / 2);
                ctx.font = `500 ${fsm}px ${MONO}`; ctx.fillStyle = T('--text-muted'); ctx.textAlign = 'right';
                ctx.fillText(rangeText, x + w - 22, y + cfg.STRIP_ROW_H / 2); ctx.textAlign = 'left';
                ctx.fillText(isExp ? '▾' : '▸', x + w - 14, y + cfg.STRIP_ROW_H / 2);
            }
        });
        if (rows.length > shown.length && textOk) { ctx.font = `500 ${fs}px ${FONT}`; ctx.fillStyle = T('--text-muted'); ctx.fillText(`+ ${rows.length - shown.length} more (see inspector)`, x + 26, y0 + shown.length * cfg.STRIP_ROW_H + cfg.STRIP_ROW_H / 2); }
        if (b.ui.expandedRegion) { const area = NA.model.dotsRect(b); if (area) { rr(ctx, area.x - 4, area.y - 4, area.w + 8, area.h + 8, 8); ctx.fillStyle = T('--panel-2'); ctx.fill(); drawDots(ctx, b, r, z, sel, hover); } }
    }

    // ---- overlay ----
    function overlay(ctx, W, H, dpr) {
        const st = NA.model.get(); if (!st) return; const g = NA.model.graph(); const v = st.view; const z = v.z; const k = 1 / z;
        const sel = NA.selection.state; const it = NA.interact; const hover = it ? it.hover : null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
        ctx.setTransform(dpr * z, 0, 0, dpr * z, -v.x * dpr * z, -v.y * dpr * z);
        // selected block halos
        for (const id of sel.blocks) {
            const b = NA.model.block(id, g); if (!b) continue; const r = NA.model.rect(b, g);
            const s = NA.selection.halo; const grow = 3 + (1 - s) * 10;
            rr(ctx, r.x - grow, r.y - grow, r.w + 2 * grow, r.h + 2 * grow, 15);
            ctx.strokeStyle = rgba(T('--accent'), 0.35 * s); ctx.lineWidth = 3 * k; ctx.stroke();
        }
        // selected neurons rings
        for (const [id, set] of sel.neurons) {
            const b = NA.model.block(id, g); if (!b) continue; const L = NA.model.neuronLayout(b); if (!L || L.pitch * z < cfg.LOD.DOTS_MIN_PX) continue;
            const p = new Path2D();
            for (const idx of set) { const c = NA.model.neuronCenter(b, idx, L); if (c) { p.moveTo(c.x + L.pitch * 0.42, c.y); p.arc(c.x, c.y, Math.max(L.pitch * 0.42, 4 * k), 0, Math.PI * 2); } }
            ctx.strokeStyle = T('--accent'); ctx.lineWidth = 1.5 * k; ctx.stroke(p);
        }
        if (!it) return;
        // lane guides while dragging with snap on: every lane faintly, the target lanes highlighted
        if (it.laneDrag) {
            const vis = NA.canvas.visible(); const lw = NA.model.laneWidth();
            const k0 = Math.floor(vis.x / lw) - 1, k1 = Math.ceil((vis.x + vis.w) / lw) + 1;
            const targets = new Set(NA.selection.blocks().map(b => NA.model.laneOf(b.pos.x)));
            for (let k2 = k0; k2 <= k1; k2++) {
                const x = NA.model.laneX(k2); const hot = targets.has(k2);
                ctx.fillStyle = rgba(T('--accent'), hot ? 0.09 : 0.03); ctx.fillRect(x, vis.y, cfg.BLOCK_W, vis.h);
                if (hot) { ctx.strokeStyle = rgba(T('--accent'), 0.5); ctx.lineWidth = 1.5 * k; ctx.setLineDash([8 * k, 6 * k]); ctx.strokeRect(x, vis.y, cfg.BLOCK_W, vis.h); ctx.setLineDash([]); }
            }
        }
        // marquee — inside a block the rows it touches light up, so you see what you are about to select
        if (it.marquee) {
            const m = it.marquee;
            if (m.rows && m.rows.idxs.length) {
                const b = m.rows.block; const L = NA.model.neuronLayout(b);
                if (L) {
                    const p = new Path2D(), bar = new Path2D(); const rad = Math.min(5, L.pitch / 3);
                    for (const idx of m.rows.idxs) { const i = idx - L.start; const x = L.x0 + (i % L.cols) * L.cellW, y = L.y0 + Math.floor(i / L.cols) * L.pitch; p.roundRect(x, y, L.cellW, L.pitch, rad); if (L.column) bar.rect(x - 3 * k, y + 1, 2.5 * k, L.pitch - 2); }
                    ctx.fillStyle = rgba(T('--accent'), 0.22); ctx.fill(p); ctx.fillStyle = T('--accent'); ctx.fill(bar);
                    const n = m.rows.idxs.length, off = NA.model.neuronOffset(b); const lo = m.rows.idxs[0] + off, hi = m.rows.idxs[n - 1] + off;
                    const label = n === 1 ? `#${lo}` : `${n} neurons · #${lo}–${hi}`;
                    ctx.font = `600 ${11 * k}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
                    const tw = ctx.measureText(label).width; const lx = m.x + m.w + 10 * k, ly = m.y + m.h;
                    rr(ctx, lx - 6 * k, ly - 10 * k, tw + 12 * k, 20 * k, 6 * k); ctx.fillStyle = T('--accent'); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(label, lx, ly);
                }
            }
            ctx.fillStyle = rgba(T('--accent'), m.rows ? 0.04 : 0.08); ctx.fillRect(m.x, m.y, m.w, m.h); ctx.strokeStyle = T('--accent'); ctx.lineWidth = 1.2 * k; ctx.setLineDash([6 * k, 4 * k]); ctx.strokeRect(m.x, m.y, m.w, m.h); ctx.setLineDash([]);
        }
        // wire ghost
        if (it.ghost) {
            const gh = it.ghost; const p = new Path2D();
            if (gh.kind === 'port') { const w = gh.reverse ? wire(gh.x2, gh.y2, gh.x1, gh.y1) : wire(gh.x1, gh.y1, gh.x2, gh.y2); addWire(p, w); }
            else { p.moveTo(gh.x1, gh.y1); p.lineTo(gh.x2, gh.y2); }
            ctx.strokeStyle = gh.valid ? T('--accent') : T('--danger'); ctx.lineWidth = Math.max(2, 2 * k); ctx.setLineDash([8 * k, 6 * k]); ctx.stroke(p); ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(gh.x2, gh.y2, 5 * k, 0, Math.PI * 2); ctx.fillStyle = gh.valid ? T('--accent') : T('--danger'); ctx.fill();
        }
        // tooltip for hovered neuron / port, and a block's comment when its header is hovered
        const blockNote = hover && hover.type === 'block' && hover.header && hover.block.comment;
        if (hover && (hover.type === 'neuron' || hover.type === 'port' || blockNote) && !it.dragging) {
            let text = '', at = null;
            if (blockNote) { const r = NA.model.rect(hover.block, g); const c = hover.block.comment.replace(/\s+/g, ' ').trim(); text = c.length > 90 ? c.slice(0, 88) + '…' : c; at = { x: r.x + r.w / 2, y: r.y }; }
            else if (hover.type === 'neuron') { const n = hover.block.neurons[hover.idx]; const reg = hover.block.regions.find(r => hover.idx >= r.start && hover.idx < r.end); text = `#${hover.idx + NA.model.neuronOffset(hover.block)}` + (n && n.label ? ' · ' + n.label : '') + (reg ? ` · ${reg.name}` : ''); at = NA.model.neuronCenter(hover.block, hover.idx); }
            else { const s = hover.port.dir === 'out' ? NA.graph.portShape(hover.block, hover.port.id) : (hover.block._inShapes || [])[NA.model.inputPortIds(hover.block).indexOf(hover.port.id)]; text = (hover.port.label ? hover.port.label + ' · ' : '') + (hover.port.dir === 'out' ? 'out ' : 'in ') + (s ? NA.util.fmtShape(s) : ''); at = { x: hover.port.x, y: hover.port.y }; }
            if (at) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); const sp = NA.canvas.toScreen(at.x, at.y); chip(ctx, text, sp.x, sp.y - 30, { align: 'center', bg: T('--tip-bg'), color: T('--tip-text'), font: `500 11px ${FONT}`, h: 20 }); }
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function wantsAnimation() {
        const h = NA.interact && NA.interact.hover;
        if (h && h.type === 'edge' && NA.model.get().settings.animateWires) { flowT = performance.now() / 1000; return true; }
        return false;
    }
    NA.render = { scene, overlay, wire, bezPt, wireBox, wantsAnimation, rr, chip, FONT, MONO, get frameCache() { return frameCache; } };
})();

// ============================================================
// NA.hit — what is under a screen point
// ============================================================
(() => {
    const cfg = NA.config;
    function bezDist(w, x, y) {
        let best = Infinity;
        for (let i = 0; i <= 32; i++) { const p = NA.render.bezPt(w, i / 32); const d = Math.hypot(p.x - x, p.y - y); if (d < best) best = d; }
        return best;
    }
    function test(sx, sy, opts = {}) {
        const g = NA.model.graph(); const z = NA.model.get().view.z; const k = 1 / z;
        const { x, y } = NA.canvas.toWorld(sx, sy);
        const blocks = g.blocks;
        // activation pills first: they are painted above everything and are the wire's handle
        for (const e of g.edges) { const c = e._chip; if (c && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return { type: 'edge', edge: e, chip: true, x, y }; }
        // ports next (any block)
        const pr = 11 * k;
        for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i]; const r = NA.model.rect(b, g);
            if (x < r.x - pr || x > r.x + r.w + pr || y < r.y - pr || y > r.y + r.h + pr) continue;
            for (const p of NA.model.ports(b, g)) if (Math.hypot(p.x - x, p.y - y) <= pr) return { type: 'port', block: b, port: p, x, y };
        }
        for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i]; const r = NA.model.rect(b, g);
            if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
            if (!opts.blocksOnly) {
                if (r.mode === 'strip') {
                    const y0 = r.y + cfg.HEADER_H + cfg.BODY_PAD; const rows = NA.model.stripRows(b).slice(0, cfg.STRIP_MAX_ROWS);
                    const ri = Math.floor((y - y0) / cfg.STRIP_ROW_H);
                    if (ri >= 0 && ri < rows.length && x > r.x + cfg.BODY_PAD && x < r.x + r.w - cfg.BODY_PAD) return { type: 'strip-row', block: b, row: rows[ri], x, y };
                }
                const L = NA.model.neuronLayout(b);
                if (L && L.pitch * z >= cfg.LOD.DOTS_MIN_PX) {
                    const idx = NA.model.neuronAt(b, x, y, L);
                    if (idx !== null) { const c = NA.model.neuronCenter(b, idx, L); const onDot = !!c && Math.hypot(c.x - x, c.y - y) <= Math.max(L.pitch * 0.5, 7 * k); return { type: 'neuron', block: b, idx, onDot, x, y }; }
                }
            }
            const btn = (9 * z < cfg.LOD.MIN_TEXT_PX ? [] : NA.model.headerButtons(b, r)).find(bt => x >= bt.x - 2 && x <= bt.x + bt.w + 2 && y >= bt.y - 2 && y <= bt.y + bt.h + 2);
            return { type: 'block', block: b, header: y < r.y + (r.mode === 'pill' ? r.h : cfg.HEADER_H), button: btn ? btn.id : null, x, y };
        }
        // edges
        const tol = 7 * k; const fc = NA.render.frameCache;
        for (const e of g.edges) {
            const w = (fc && fc.get(e.id)) || (() => { const p = NA.model.edgeEndpoints(e, g); return p && NA.render.wire(p.x1, p.y1, p.x2, p.y2); })();
            if (!w) continue; const bb = NA.render.wireBox(w);
            if (x < bb.x - tol || x > bb.x2 + tol || y < bb.y - tol || y > bb.y2 + tol) continue;
            if (bezDist(w, x, y) <= tol) return { type: 'edge', edge: e, x, y };
        }
        for (const n of g.neuronEdges) {
            const w = n._geom; if (!w) continue; const bb = NA.render.wireBox(w);
            if (x < bb.x - tol || x > bb.x2 + tol || y < bb.y - tol || y > bb.y2 + tol) continue;
            if (bezDist(w, x, y) <= tol) return { type: 'neuronEdge', edge: n, x, y };
        }
        for (const gr of g.groups) { const r = gr._rect; if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + Math.max(40, cfg.LOD.TITLE_MIN_PX / z + 16)) return { type: 'group', group: gr, x, y }; }
        return { type: 'empty', x, y };
    }
    // Blocks intersecting a world rect
    function blocksIn(rect) { const g = NA.model.graph(); return g.blocks.filter(b => { const r = NA.model.rect(b, g); return r.x < rect.x + rect.w && r.x + r.w > rect.x && r.y < rect.y + rect.h && r.y + r.h > rect.y; }); }
    NA.hit = { test, blocksIn };
})();
