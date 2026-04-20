/* Laser Cutter Studio — vanilla JS / Fabric.js
   Namespace: LCS.*  (config, state, util, canvas, rulers, grid, layers,
   objects, shapes, image, importers, align, gcode, preview, history, ui, main) */

const LCS = (window.LCS = {});

// ============================================================
// LCS.config
// ============================================================
(() => {
    const DPI = 96;                 // Fabric canvas uses 96 css-px per logical inch
    const MM_PER_INCH = 25.4;
    const PX_PER_MM = DPI / MM_PER_INCH;
    const MM_PER_PX = MM_PER_INCH / DPI;

    const DEFAULT_LAYERS = [
        { name: 'Cut',     color: '#ef4444', opType: 'cut',     power: 60, speed: 600,  passes: 1, airAssist: true  },
        { name: 'Engrave', color: '#000000', opType: 'engrave', power: 30, speed: 3000, passes: 1, airAssist: false },
        { name: 'Score',   color: '#3b82f6', opType: 'score',   power: 15, speed: 1500, passes: 1, airAssist: false },
    ];

    const PALETTE = [
        '#ef4444','#f97316','#eab308','#22c55e','#06b6d4',
        '#3b82f6','#6366f1','#a855f7','#ec4899','#64748b',
    ];

    LCS.config = { DPI, MM_PER_INCH, PX_PER_MM, MM_PER_PX, DEFAULT_LAYERS, PALETTE };
})();

// ============================================================
// LCS.util — DOM, toast, pub/sub, math, misc
// ============================================================
(() => {
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const el = (tag, attrs = {}, children = []) => {
        const n = document.createElement(tag);
        for (const k in attrs) {
            if (k === 'class') n.className = attrs[k];
            else if (k === 'style') n.style.cssText = attrs[k];
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
            else if (k === 'text') n.textContent = attrs[k];
            else n.setAttribute(k, attrs[k]);
        }
        for (const c of [].concat(children)) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        return n;
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
    const download = (filename, content, type = 'text/plain') => {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    };

    // Tiny pub/sub
    const bus = (() => {
        const map = new Map();
        return {
            on(ev, fn) { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); return () => map.get(ev).delete(fn); },
            emit(ev, data) { map.get(ev)?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }
        };
    })();

    // Toast
    let toastRoot;
    function toast(msg, kind = '') {
        if (!toastRoot) { toastRoot = el('div', { class: 'toast-stack' }); document.body.appendChild(toastRoot); }
        const t = el('div', { class: 'toast ' + kind, text: msg });
        toastRoot.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = 'all .2s'; }, 2400);
        setTimeout(() => t.remove(), 2800);
    }

    function modal(id, open) {
        const m = document.getElementById(id);
        if (!m) return;
        m.classList.toggle('visible', open);
    }

    function progress(title, detail, pct) {
        const m = $('#progress-modal');
        if (pct === null || pct === false || pct === undefined) { m.classList.remove('visible'); return; }
        m.classList.add('visible');
        $('#progress-title').textContent = title || 'Working...';
        $('#progress-detail').textContent = detail || '';
        $('#progress-fill').style.width = clamp(pct * 100, 0, 100).toFixed(1) + '%';
    }

    function hexToRgb(hex) {
        const h = hex.replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
    }
    function colorDist(a, b) {
        const c1 = hexToRgb(a), c2 = hexToRgb(b);
        return Math.sqrt((c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2);
    }

    const mmToPx = mm => mm * LCS.config.PX_PER_MM;
    const pxToMm = px => px * LCS.config.MM_PER_PX;

    LCS.util = { $, $$, el, clamp, debounce, uid, download, bus, toast, modal, progress,
                 hexToRgb, rgbToHex, colorDist, mmToPx, pxToMm };
})();

// ============================================================
// LCS.theme — light/dark toggle, persisted
// ============================================================
(() => {
    const KEY = 'lcs.theme';
    let current = 'dark';

    function apply(t) {
        current = t === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', current);
        try { localStorage.setItem(KEY, current); } catch (_) {}
        // Repaint canvas-side elements only once Fabric has been initialised
        if (LCS.canvas && LCS.canvas.fabric) {
            try { LCS.canvas.drawBedBackground(); } catch (_) {}
            try { LCS.grid && LCS.grid.render(); } catch (_) {}
            try { LCS.rulers && LCS.rulers.render(); } catch (_) {}
            try { LCS.preview && LCS.preview.render && LCS.preview.render(); } catch (_) {}
        }
        LCS.state && LCS.state.emit && LCS.state.emit('theme:change', current);
    }

    function init() {
        let saved = 'dark';
        try { saved = localStorage.getItem(KEY) || 'dark'; } catch (_) {}
        apply(saved);
    }

    function toggle() { apply(current === 'dark' ? 'light' : 'dark'); }

    LCS.theme = { init, apply, toggle, get current() { return current; } };
})();

// ============================================================
// LCS.state — central store
// ============================================================
(() => {
    const { bus } = LCS.util;

    const state = {
        machine: {
            bedWidth: 400, bedHeight: 400, units: 'mm',
            origin: 'bottom-left', dialect: 'grbl',
            dpi: 96, travelFeed: 3000, smax: 1000,
            rasterInterval: 0.1,
            gridSpacing: 10, snapTolerance: 6,
        },
        layers: [],
        activeLayerId: null,
        tool: 'select',
        gridVisible: true,
        snapEnabled: true,
        selection: [],
        gcode: null,           // last generated gcode string
        gcodeStats: null,      // { rasterLines, vectorLines, travelMm, burnMm, durationSec }
        gcodeSegments: [],     // parsed preview segments
    };

    LCS.state = {
        get() { return state; },
        machine() { return state.machine; },
        layers() { return state.layers; },
        activeLayer() { return state.layers.find(l => l.id === state.activeLayerId) || state.layers[0]; },
        setActiveLayer(id) { state.activeLayerId = id; bus.emit('layer:active', id); },
        setTool(t) { state.tool = t; bus.emit('tool:change', t); },
        on: bus.on,
        emit: bus.emit,
    };
})();

// ============================================================
// LCS.canvas — Fabric init, zoom, pan, resize
// ============================================================
(() => {
    const { $, mmToPx, pxToMm, clamp } = LCS.util;
    const { PX_PER_MM } = LCS.config;

    let canvas, overlay;
    let zoom = 1;
    let isPanning = false;
    let panStart = null;
    let viewportStart = null;
    let spaceHeld = false;

    function init() {
        const wrap = $('#canvas-wrap');
        const W = wrap.clientWidth;
        const H = wrap.clientHeight - 0;
        canvas = new fabric.Canvas('main-canvas', {
            width: W, height: H,
            backgroundColor: 'transparent',
            preserveObjectStacking: true,
            selection: true,
            stopContextMenu: true,
            fireRightClick: true,
        });
        LCS.canvas.fabric = canvas;

        // overlay for previews and guides
        const ov = $('#overlay-canvas');
        ov.width = W; ov.height = H;
        overlay = ov;
        LCS.canvas.overlay = ov;

        // bed rectangle (group-less, non-selectable)
        drawBedBackground();

        // center on bed
        fitToBed();

        // events
        wireZoom();
        wirePan();
        wireResize();

        // selection pipe to state
        const emitSel = () => LCS.state.emit('selection:change', canvas.getActiveObjects());
        canvas.on('selection:created', emitSel);
        canvas.on('selection:updated', emitSel);
        canvas.on('selection:cleared', () => LCS.state.emit('selection:change', []));
        canvas.on('object:modified', () => LCS.state.emit('object:modified'));
        canvas.on('object:added', () => LCS.state.emit('object:added'));
        canvas.on('object:removed', () => LCS.state.emit('object:removed'));
    }

    function drawBedBackground() {
        const old = canvas.getObjects().filter(o => o._lcsBed);
        old.forEach(o => canvas.remove(o));

        const m = LCS.state.machine();
        const w = mmToPx(m.bedWidth);
        const h = mmToPx(m.bedHeight);
        const cs = getComputedStyle(document.documentElement);
        const fill = (cs.getPropertyValue('--bed-fill') || 'rgba(255,255,255,0.03)').trim();
        const stroke = (cs.getPropertyValue('--bed-stroke') || 'rgba(255,255,255,0.35)').trim();

        const rect = new fabric.Rect({
            left: 0, top: 0, width: w, height: h,
            fill, stroke,
            strokeWidth: 1.5,
            strokeDashArray: [6, 4],
            selectable: false, evented: false, hoverCursor: 'default',
            excludeFromExport: true,
            objectCaching: false,
        });
        rect._lcsBed = true;
        canvas.add(rect);
        canvas.sendToBack(rect);
    }

    function fitToBed() {
        const m = LCS.state.machine();
        const w = mmToPx(m.bedWidth);
        const h = mmToPx(m.bedHeight);
        const margin = 40;
        const zx = (canvas.width - margin * 2) / w;
        const zy = (canvas.height - margin * 2) / h;
        zoom = Math.min(zx, zy);
        const tx = (canvas.width - w * zoom) / 2;
        const ty = (canvas.height - h * zoom) / 2;
        canvas.setViewportTransform([zoom, 0, 0, zoom, tx, ty]);
        updateZoomLabel();
        LCS.rulers && LCS.rulers.render();
        LCS.grid && LCS.grid.render();
    }

    function updateZoomLabel() {
        const el = $('#zoom-label');
        if (el) el.textContent = Math.round(zoom * 100) + '%';
    }

    function setZoomCentered(newZoom) {
        const cx = canvas.width / 2, cy = canvas.height / 2;
        setZoomAt(newZoom, cx, cy);
    }

    function setZoomAt(newZoom, px, py) {
        newZoom = clamp(newZoom, 0.05, 30);
        const vpt = canvas.viewportTransform;
        const pointBefore = { x: (px - vpt[4]) / vpt[0], y: (py - vpt[5]) / vpt[3] };
        zoom = newZoom;
        vpt[0] = newZoom; vpt[3] = newZoom;
        vpt[4] = px - pointBefore.x * newZoom;
        vpt[5] = py - pointBefore.y * newZoom;
        canvas.setViewportTransform(vpt);
        updateZoomLabel();
        LCS.rulers && LCS.rulers.render();
        LCS.grid && LCS.grid.render();
    }

    function wireZoom() {
        canvas.on('mouse:wheel', opt => {
            const e = opt.e;
            e.preventDefault(); e.stopPropagation();
            const factor = 0.999 ** e.deltaY; // smooth exp
            setZoomAt(zoom * factor, e.offsetX, e.offsetY);
        });
    }

    function wirePan() {
        // Space-to-pan: hold space to temporarily enable pan mode
        window.addEventListener('keydown', e => {
            if (e.code === 'Space' && !spaceHeld) {
                const t = e.target;
                if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
                spaceHeld = true;
                canvas.defaultCursor = 'grab';
                canvas.hoverCursor = 'grab';
                canvas.selection = false;
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', e => {
            if (e.code === 'Space') {
                spaceHeld = false;
                const tool = LCS.state.get().tool;
                canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair';
                canvas.hoverCursor = tool === 'select' ? 'move' : 'crosshair';
                canvas.selection = tool === 'select';
            }
        });

        canvas.on('mouse:down', opt => {
            const e = opt.e;
            // Pan if: middle button, right-click, Alt, Ctrl/Cmd, Space-held, or hand tool
            const wantPan = e.button === 1 || e.button === 2 ||
                            e.altKey || e.ctrlKey || e.metaKey ||
                            spaceHeld ||
                            LCS.state.get().tool === 'hand';
            if (wantPan) {
                isPanning = true;
                panStart = { x: e.clientX, y: e.clientY };
                viewportStart = canvas.viewportTransform.slice();
                canvas.setCursor('grabbing');
                canvas.selection = false;
                // prevent Fabric from starting selection box
                if (opt.target) canvas.discardActiveObject();
            }
        });
        canvas.on('mouse:move', opt => {
            if (!isPanning) return;
            const e = opt.e;
            const dx = e.clientX - panStart.x;
            const dy = e.clientY - panStart.y;
            const vpt = canvas.viewportTransform;
            vpt[4] = viewportStart[4] + dx;
            vpt[5] = viewportStart[5] + dy;
            canvas.setViewportTransform(vpt);
            LCS.rulers && LCS.rulers.render();
            LCS.grid && LCS.grid.render();
        });
        canvas.on('mouse:up', () => {
            if (isPanning) {
                isPanning = false;
                const tool = LCS.state.get().tool;
                canvas.selection = !spaceHeld && tool === 'select';
                canvas.setCursor(spaceHeld ? 'grab' : (tool === 'select' ? 'default' : 'crosshair'));
            }
        });
        // cursor readout
        canvas.on('mouse:move', opt => {
            const e = opt.e;
            const p = canvas.getPointer(e);
            const mX = pxToMm(p.x).toFixed(1);
            const mY = (LCS.state.machine().origin === 'bottom-left'
                         ? pxToMm(LCS.state.machine().bedHeight * PX_PER_MM - p.y)
                         : pxToMm(p.y)).toFixed(1);
            const el = document.getElementById('cursor-coords');
            if (el) el.textContent = `${mX}, ${mY} mm`;
        });
    }

    function wireResize() {
        const resize = () => {
            const wrap = $('#canvas-wrap');
            const W = wrap.clientWidth;
            const H = wrap.clientHeight - ($('#preview-strip').classList.contains('visible') ? 56 : 0);
            canvas.setWidth(W);
            canvas.setHeight(H);
            overlay.width = W; overlay.height = H;
            LCS.rulers && LCS.rulers.render();
            LCS.grid && LCS.grid.render();
            canvas.renderAll();
        };
        window.addEventListener('resize', resize);
        LCS.state.on('preview:toggle', resize);
        LCS.canvas.resize = resize;
    }

    LCS.canvas = Object.assign(LCS.canvas || {}, {
        init, fitToBed, setZoomCentered, setZoomAt,
        getZoom: () => zoom,
        drawBedBackground,
        get fabric() { return canvas; },
        get overlay() { return overlay; },
    });
})();

// ============================================================
// LCS.rulers — canvas-drawn mm rulers
// ============================================================
(() => {
    const { $ } = LCS.util;
    const { PX_PER_MM } = LCS.config;

    let rxCanvas, ryCanvas, rxCtx, ryCtx;

    function init() {
        const rxHost = $('#ruler-x');
        const ryHost = $('#ruler-y');
        rxCanvas = document.createElement('canvas');
        ryCanvas = document.createElement('canvas');
        rxHost.appendChild(rxCanvas);
        ryHost.appendChild(ryCanvas);
        rxCtx = rxCanvas.getContext('2d');
        ryCtx = ryCanvas.getContext('2d');
        new ResizeObserver(render).observe(rxHost);
        new ResizeObserver(render).observe(ryHost);
        render();
    }

    function render() {
        if (!rxCtx || !ryCtx) return;
        const fab = LCS.canvas.fabric;
        if (!fab) return;
        const vpt = fab.viewportTransform;
        const zoom = vpt[0];
        const tx = vpt[4], ty = vpt[5];
        const rxHost = rxCanvas.parentElement;
        const ryHost = ryCanvas.parentElement;
        const dpr = window.devicePixelRatio || 1;

        // Size ruler canvases
        const rxW = rxHost.clientWidth, rxH = rxHost.clientHeight;
        const ryW = ryHost.clientWidth, ryH = ryHost.clientHeight;
        rxCanvas.width = rxW * dpr; rxCanvas.height = rxH * dpr;
        rxCanvas.style.width = rxW + 'px'; rxCanvas.style.height = rxH + 'px';
        ryCanvas.width = ryW * dpr; ryCanvas.height = ryH * dpr;
        ryCanvas.style.width = ryW + 'px'; ryCanvas.style.height = ryH + 'px';
        rxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ryCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Determine minor/major step in mm based on zoom
        // px per mm on screen = zoom * PX_PER_MM
        const pxPerMm = zoom * PX_PER_MM;
        const targets = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
        let minorStep = 10;
        for (const t of targets) {
            if (t * pxPerMm >= 6) { minorStep = t; break; }
        }
        const majorStep = minorStep * 5;
        const cs = getComputedStyle(document.documentElement);
        const textCol = (cs.getPropertyValue('--ruler-text') || '#8892a6').trim();
        const tickCol = (cs.getPropertyValue('--ruler-tick') || '#3b4a68').trim();

        // X ruler (at bottom of canvas: ticks point UP from top edge, labels at bottom)
        rxCtx.clearRect(0, 0, rxW, rxH);
        rxCtx.fillStyle = textCol;
        rxCtx.strokeStyle = tickCol;
        rxCtx.font = '9px JetBrains Mono, monospace';
        rxCtx.textAlign = 'left';
        rxCtx.textBaseline = 'bottom';

        const worldPxStart = (0 - tx) / zoom;
        const worldPxEnd = (rxW - tx) / zoom;
        const mmStart = worldPxStart / PX_PER_MM;
        const mmEnd = worldPxEnd / PX_PER_MM;

        let first = Math.floor(mmStart / minorStep) * minorStep;
        for (let mm = first; mm <= mmEnd; mm += minorStep) {
            const screenX = mm * PX_PER_MM * zoom + tx;
            const isMajor = Math.abs(mm % majorStep) < 1e-6;
            const tickH = isMajor ? rxH * 0.55 : rxH * 0.3;
            rxCtx.beginPath();
            rxCtx.moveTo(screenX + 0.5, 0);
            rxCtx.lineTo(screenX + 0.5, tickH);
            rxCtx.stroke();
            if (isMajor) {
                rxCtx.fillText(mm.toFixed(0), screenX + 3, rxH - 2);
            }
        }

        // Y ruler
        ryCtx.clearRect(0, 0, ryW, ryH);
        ryCtx.fillStyle = textCol;
        ryCtx.strokeStyle = tickCol;
        ryCtx.font = '9px JetBrains Mono, monospace';
        ryCtx.textBaseline = 'middle';
        ryCtx.textAlign = 'right';

        const worldPxStartY = (0 - ty) / zoom;
        const worldPxEndY = (ryH - ty) / zoom;
        const mmStartY = worldPxStartY / PX_PER_MM;
        const mmEndY = worldPxEndY / PX_PER_MM;
        const originBL = LCS.state.machine().origin === 'bottom-left';
        const bedH = LCS.state.machine().bedHeight;
        let firstY = Math.floor(mmStartY / minorStep) * minorStep;
        for (let mm = firstY; mm <= mmEndY; mm += minorStep) {
            const screenY = mm * PX_PER_MM * zoom + ty;
            const isMajor = Math.abs(mm % majorStep) < 1e-6;
            const tickW = isMajor ? ryW * 0.55 : ryW * 0.3;
            ryCtx.beginPath();
            ryCtx.moveTo(ryW, screenY + 0.5);
            ryCtx.lineTo(ryW - tickW, screenY + 0.5);
            ryCtx.stroke();
            if (isMajor) {
                const label = originBL ? (bedH - mm).toFixed(0) : mm.toFixed(0);
                ryCtx.save();
                ryCtx.translate(ryW - tickW - 2, screenY);
                ryCtx.rotate(-Math.PI / 2);
                ryCtx.textAlign = 'center';
                ryCtx.fillText(label, 0, 0);
                ryCtx.restore();
            }
        }
    }

    LCS.rulers = { init, render };
})();

// ============================================================
// LCS.grid — grid overlay + snap helpers
// ============================================================
(() => {
    const { PX_PER_MM } = LCS.config;

    function render() {
        const state = LCS.state.get();
        const fab = LCS.canvas.fabric;
        if (!fab) return;

        // Remove old grid
        fab.getObjects().filter(o => o._lcsGrid).forEach(o => fab.remove(o));
        if (!state.gridVisible) { fab.requestRenderAll(); return; }

        const m = state.machine;
        const step = m.gridSpacing * PX_PER_MM;
        const w = m.bedWidth * PX_PER_MM;
        const h = m.bedHeight * PX_PER_MM;
        const cs = getComputedStyle(document.documentElement);
        const majorCol = (cs.getPropertyValue('--grid-major') || 'rgba(255,255,255,0.12)').trim();
        const minorCol = (cs.getPropertyValue('--grid-minor') || 'rgba(255,255,255,0.05)').trim();

        const group = [];
        for (let x = 0; x <= w + 0.01; x += step) {
            const major = Math.abs((x / step) % 5) < 1e-6;
            group.push(new fabric.Line([x, 0, x, h], {
                stroke: major ? majorCol : minorCol,
                strokeWidth: 1 / (fab.viewportTransform[0] || 1),
                selectable: false, evented: false, hoverCursor: 'default',
                excludeFromExport: true, objectCaching: false,
            }));
        }
        for (let y = 0; y <= h + 0.01; y += step) {
            const major = Math.abs((y / step) % 5) < 1e-6;
            group.push(new fabric.Line([0, y, w, y], {
                stroke: major ? majorCol : minorCol,
                strokeWidth: 1 / (fab.viewportTransform[0] || 1),
                selectable: false, evented: false, hoverCursor: 'default',
                excludeFromExport: true, objectCaching: false,
            }));
        }
        group.forEach(line => { line._lcsGrid = true; fab.add(line); fab.sendToBack(line); });
        // ensure bed rect stays at back
        const bed = fab.getObjects().find(o => o._lcsBed);
        if (bed) fab.sendToBack(bed);
        fab.requestRenderAll();
    }

    function snapPoint(p) {
        const state = LCS.state.get();
        if (!state.snapEnabled) return p;
        const step = state.machine.gridSpacing * PX_PER_MM;
        const tol = state.machine.snapTolerance / (LCS.canvas.fabric.viewportTransform[0] || 1);
        const sx = Math.round(p.x / step) * step;
        const sy = Math.round(p.y / step) * step;
        return {
            x: Math.abs(sx - p.x) < tol ? sx : p.x,
            y: Math.abs(sy - p.y) < tol ? sy : p.y,
        };
    }

    LCS.grid = { render, snapPoint };
})();

// ============================================================
// LCS.layers — CRUD + panel rendering
// ============================================================
(() => {
    const { $, el, uid, hexToRgb, colorDist } = LCS.util;

    function init() {
        // Seed default layers
        const state = LCS.state.get();
        LCS.config.DEFAULT_LAYERS.forEach(spec => {
            state.layers.push({ id: uid('layer'), visible: true, locked: false, zOrder: state.layers.length, ...spec });
        });
        state.activeLayerId = state.layers[0].id;
        render();
        wireEditor();

        LCS.state.on('layers:changed', render);
        LCS.state.on('layer:active', render);
    }

    function render() {
        const host = $('#layer-list');
        if (!host) return;
        host.innerHTML = '';
        const state = LCS.state.get();
        state.layers.forEach(layer => {
            const item = el('div', { class: 'layer-item' + (layer.id === state.activeLayerId ? ' active' : '') });
            const swatch = el('div', { class: 'layer-color', style: `background:${layer.color}` });
            const name = el('div', { class: 'layer-name', text: layer.name });
            const meta = el('div', { class: 'layer-meta', text: `${layer.opType} · ${layer.power}% · ${layer.speed}` });
            const vis = el('button', { class: 'layer-toggle' + (layer.visible ? '' : ' off'), title: 'Toggle visibility' });
            vis.innerHTML = `<i data-lucide="${layer.visible ? 'eye' : 'eye-off'}"></i>`;
            vis.onclick = (e) => { e.stopPropagation(); layer.visible = !layer.visible; setObjectsVisibility(layer); LCS.state.emit('layers:changed'); };
            item.appendChild(swatch);
            const col = el('div', { style: 'flex:1; min-width:0' });
            col.appendChild(name); col.appendChild(meta);
            item.appendChild(col);
            item.appendChild(vis);
            item.onclick = () => LCS.state.setActiveLayer(layer.id);
            host.appendChild(item);
        });
        // Populate properties layer picker
        const pLayer = $('#p-layer');
        if (pLayer) {
            pLayer.innerHTML = '';
            state.layers.forEach(l => {
                pLayer.appendChild(el('option', { value: l.id, text: l.name }));
            });
        }
        // Fill active layer editor
        const a = LCS.state.activeLayer();
        if (a) {
            $('#layer-name').value = a.name;
            $('#layer-color').value = a.color;
            $('#layer-optype').value = a.opType;
            $('#layer-power').value = a.power;
            $('#layer-power-val').textContent = a.power;
            $('#layer-speed').value = a.speed;
            $('#layer-passes').value = a.passes;
            $('#layer-airassist').checked = a.airAssist;
        }
        if (window.lucide) lucide.createIcons();
    }

    function setObjectsVisibility(layer) {
        const fab = LCS.canvas.fabric;
        if (!fab) return;
        fab.getObjects().forEach(o => {
            if (o.layerId === layer.id) o.visible = layer.visible;
        });
        fab.requestRenderAll();
    }

    function addLayer() {
        const state = LCS.state.get();
        const color = LCS.config.PALETTE[state.layers.length % LCS.config.PALETTE.length];
        const layer = {
            id: uid('layer'), name: `Layer ${state.layers.length + 1}`,
            color, opType: 'cut', power: 50, speed: 1000, passes: 1,
            airAssist: false, visible: true, locked: false, zOrder: state.layers.length,
        };
        state.layers.push(layer);
        state.activeLayerId = layer.id;
        LCS.state.emit('layers:changed');
    }

    function deleteLayer(id) {
        const state = LCS.state.get();
        if (state.layers.length <= 1) { LCS.util.toast('At least one layer required', 'warn'); return; }
        const idx = state.layers.findIndex(l => l.id === id);
        if (idx < 0) return;
        const newDefault = state.layers[idx === 0 ? 1 : idx - 1];
        // Reassign orphaned objects
        const fab = LCS.canvas.fabric;
        fab.getObjects().forEach(o => {
            if (o.layerId === id) {
                o.layerId = newDefault.id;
                applyLayerToObject(o, newDefault);
            }
        });
        state.layers.splice(idx, 1);
        state.activeLayerId = newDefault.id;
        fab.requestRenderAll();
        LCS.state.emit('layers:changed');
    }

    function wireEditor() {
        const bind = (id, field, cast = v => v) => {
            const elx = $('#' + id);
            elx.addEventListener('input', () => {
                const a = LCS.state.activeLayer(); if (!a) return;
                a[field] = cast(elx.value);
                if (field === 'power') $('#layer-power-val').textContent = a.power;
                // if color changed, recolor objects on canvas
                if (field === 'color') recolorLayer(a);
                LCS.state.emit('layers:changed');
            });
        };
        bind('layer-name', 'name');
        bind('layer-color', 'color');
        bind('layer-optype', 'opType');
        bind('layer-power', 'power', v => +v);
        bind('layer-speed', 'speed', v => +v);
        bind('layer-passes', 'passes', v => +v);
        $('#layer-airassist').addEventListener('change', () => {
            const a = LCS.state.activeLayer(); if (!a) return;
            a.airAssist = $('#layer-airassist').checked;
            LCS.state.emit('layers:changed');
        });
        $('#add-layer-btn').addEventListener('click', addLayer);
        $('#delete-layer-btn').addEventListener('click', () => {
            const a = LCS.state.activeLayer(); if (a) deleteLayer(a.id);
        });
    }

    function recolorLayer(layer) {
        const fab = LCS.canvas.fabric;
        fab.getObjects().forEach(o => {
            if (o.layerId === layer.id) applyLayerToObject(o, layer);
        });
        fab.requestRenderAll();
    }

    function applyLayerToObject(obj, layer) {
        if (obj._lcsBed || obj._lcsGrid) return;
        const isImage = obj.type === 'image' || obj.type === 'Image';
        if (!isImage) {
            // vector: stroke = layer color
            obj.set({ stroke: layer.color });
            if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
                obj.set({ fill: layer.color });
            } else if (obj.fill && obj.fill !== 'transparent') {
                // leave fill, user controls via stroke primarily
            }
        }
        // image raster — badge shown via UI, not changing pixels
    }

    function getLayerByColor(color) {
        const state = LCS.state.get();
        if (!state.layers.length) return null;
        let best = state.layers[0], bestDist = colorDist(color, best.color);
        for (let i = 1; i < state.layers.length; i++) {
            const d = colorDist(color, state.layers[i].color);
            if (d < bestDist) { best = state.layers[i]; bestDist = d; }
        }
        return bestDist < 80 ? best : null;
    }

    LCS.layers = { init, render, addLayer, deleteLayer, applyLayerToObject, getLayerByColor, recolorLayer };
})();

// ============================================================
// LCS.objects — attach layer/opType, serialize extras
// ============================================================
(() => {
    const { uid } = LCS.util;

    function attach(obj, layer) {
        obj.objectId = obj.objectId || uid('obj');
        obj.layerId = layer ? layer.id : LCS.state.activeLayer().id;
        obj.opType = null; // null -> inherit
        LCS.layers.applyLayerToObject(obj, layer || LCS.state.activeLayer());
    }

    function addToCanvas(obj, layer) {
        attach(obj, layer);
        LCS.canvas.fabric.add(obj);
        LCS.canvas.fabric.setActiveObject(obj);
        LCS.canvas.fabric.requestRenderAll();
    }

    // Patch Fabric to persist custom properties in toObject
    const customProps = ['objectId', 'layerId', 'opType', 'sourceType', '_imgParams', '_origSrc', '_origWidth', '_origHeight'];
    const baseToObject = fabric.Object.prototype.toObject;
    fabric.Object.prototype.toObject = function (extra) {
        return baseToObject.call(this, [...(extra || []), ...customProps]);
    };

    LCS.objects = { attach, addToCanvas };
})();

// ============================================================
// LCS.shapes — tool actions (rect, circle, line, text, pen, node)
// ============================================================
(() => {
    const { $, mmToPx } = LCS.util;
    let currentTool = 'select';
    let drawState = null;

    function setTool(t) {
        currentTool = t;
        LCS.state.setTool(t);
        // Update button state
        document.querySelectorAll('.tool[data-tool]').forEach(b => {
            b.classList.toggle('active', b.dataset.tool === t);
        });
        const fab = LCS.canvas.fabric;
        fab.defaultCursor = t === 'select' ? 'default' : 'crosshair';
        fab.hoverCursor = t === 'select' ? 'move' : 'crosshair';
        fab.selection = t === 'select';
        fab.discardActiveObject();
        fab.requestRenderAll();
        // exit pen/node mode
        if (t !== 'pen') { endPen(); }
        if (t !== 'node') { endNodeEdit(); }
    }

    function init() {
        const fab = LCS.canvas.fabric;
        fab.on('mouse:down', onDown);
        fab.on('mouse:move', onMove);
        fab.on('mouse:up', onUp);
        fab.on('mouse:dblclick', onDblClick);
        document.querySelectorAll('.tool[data-tool]').forEach(b => {
            b.addEventListener('click', () => setTool(b.dataset.tool));
        });
    }

    function pointer(opt) { return LCS.canvas.fabric.getPointer(opt.e); }

    function onDown(opt) {
        const e = opt.e;
        // Skip when user is panning (Ctrl/Alt/Space/middle/right)
        if (e && (e.altKey || e.ctrlKey || e.metaKey || e.button === 1 || e.button === 2)) return;
        if (opt.target && !opt.target._lcsBed && !opt.target._lcsGrid && currentTool === 'select') return;
        const p = pointer(opt);
        const layer = LCS.state.activeLayer();
        if (currentTool === 'rect') {
            const r = new fabric.Rect({
                left: p.x, top: p.y, width: 1, height: 1,
                fill: 'transparent', stroke: layer.color, strokeWidth: 1,
                strokeUniform: true,
            });
            LCS.objects.addToCanvas(r, layer);
            drawState = { obj: r, start: p, type: 'rect' };
        } else if (currentTool === 'circle') {
            const e = new fabric.Ellipse({
                left: p.x, top: p.y, rx: 1, ry: 1, originX: 'left', originY: 'top',
                fill: 'transparent', stroke: layer.color, strokeWidth: 1,
                strokeUniform: true,
            });
            LCS.objects.addToCanvas(e, layer);
            drawState = { obj: e, start: p, type: 'circle' };
        } else if (currentTool === 'line') {
            const l = new fabric.Line([p.x, p.y, p.x, p.y], {
                stroke: layer.color, strokeWidth: 1, strokeUniform: true,
            });
            LCS.objects.addToCanvas(l, layer);
            drawState = { obj: l, start: p, type: 'line' };
        } else if (currentTool === 'text') {
            const t = new fabric.IText('Text', {
                left: p.x, top: p.y,
                fontFamily: 'Inter', fontSize: mmToPx(20),
                fill: layer.color, stroke: null,
            });
            LCS.objects.addToCanvas(t, layer);
            t.enterEditing();
            t.selectAll();
            setTool('select');
        } else if (currentTool === 'pen') {
            penAddPoint(p, opt.e);
        } else if (currentTool === 'node') {
            // handled via dedicated path editor
        }
    }

    function onMove(opt) {
        if (!drawState) {
            if (currentTool === 'pen' && penActive) penPreview(pointer(opt));
            return;
        }
        const p = pointer(opt);
        const { obj, start, type } = drawState;
        if (type === 'rect') {
            const l = Math.min(start.x, p.x), t = Math.min(start.y, p.y);
            obj.set({ left: l, top: t, width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) });
        } else if (type === 'circle') {
            const l = Math.min(start.x, p.x), t = Math.min(start.y, p.y);
            obj.set({ left: l, top: t, rx: Math.abs(p.x - start.x) / 2, ry: Math.abs(p.y - start.y) / 2 });
        } else if (type === 'line') {
            obj.set({ x2: p.x, y2: p.y });
        }
        obj.setCoords();
        LCS.canvas.fabric.requestRenderAll();
    }

    function onUp() {
        if (drawState) {
            if (drawState.obj.width < 2 && drawState.obj.height < 2 && drawState.type !== 'line') {
                LCS.canvas.fabric.remove(drawState.obj);
            }
            drawState = null;
            if (currentTool !== 'pen') setTool('select');
        }
    }

    function onDblClick(opt) {
        if (currentTool === 'pen') {
            endPen(true);
            return;
        }
        // enter node edit on path
        if (opt.target && opt.target.type === 'path') {
            setTool('node');
            startNodeEdit(opt.target);
        }
    }

    // ===== PEN TOOL =====
    let penActive = false;
    let penPoints = []; // array of { x, y, h1:{x,y}?, h2:{x,y}? } — simplified, each point has optional forward handle
    let penPreviewLine = null;

    function penAddPoint(p, evt) {
        if (!penActive) {
            penActive = true;
            penPoints = [];
        }
        penPoints.push({ x: p.x, y: p.y });
        redrawPen();
    }

    function penPreview(p) {
        // Draw a ghost line from last to cursor
        const fab = LCS.canvas.fabric;
        if (penPreviewLine) fab.remove(penPreviewLine);
        if (penPoints.length < 1) return;
        const last = penPoints[penPoints.length - 1];
        penPreviewLine = new fabric.Line([last.x, last.y, p.x, p.y], {
            stroke: '#818cf8', strokeWidth: 1, strokeDashArray: [4, 3],
            selectable: false, evented: false, excludeFromExport: true,
            objectCaching: false, strokeUniform: true,
        });
        penPreviewLine._lcsPreview = true;
        fab.add(penPreviewLine);
        fab.requestRenderAll();
    }

    function redrawPen() {
        const fab = LCS.canvas.fabric;
        fab.getObjects().filter(o => o._lcsPenWorking).forEach(o => fab.remove(o));
        if (penPoints.length < 2) return;
        const d = penPathD(penPoints, false);
        const layer = LCS.state.activeLayer();
        const path = new fabric.Path(d, {
            fill: '', stroke: layer.color, strokeWidth: 1, strokeUniform: true,
            selectable: false, evented: false, excludeFromExport: true, objectCaching: false,
        });
        path._lcsPenWorking = true;
        fab.add(path);
        fab.requestRenderAll();
    }

    function penPathD(pts, close) {
        if (pts.length === 0) return '';
        let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
        for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
        if (close) d += ' Z';
        return d;
    }

    function endPen(commit = false) {
        const fab = LCS.canvas.fabric;
        fab.getObjects().filter(o => o._lcsPenWorking || o._lcsPreview).forEach(o => fab.remove(o));
        if (commit && penPoints.length >= 2) {
            const layer = LCS.state.activeLayer();
            const d = penPathD(penPoints, false);
            const path = new fabric.Path(d, {
                fill: '', stroke: layer.color, strokeWidth: 1, strokeUniform: true,
            });
            LCS.objects.addToCanvas(path, layer);
        }
        penActive = false;
        penPoints = [];
        penPreviewLine = null;
        fab.requestRenderAll();
    }

    // ===== NODE EDIT (simple: drag path points via reading/writing path.path) =====
    let nodeEditTarget = null;
    let nodeHandles = [];
    function startNodeEdit(path) {
        nodeEditTarget = path;
        renderNodeHandles();
    }
    function renderNodeHandles() {
        const fab = LCS.canvas.fabric;
        nodeHandles.forEach(h => fab.remove(h));
        nodeHandles = [];
        if (!nodeEditTarget) return;
        const p = nodeEditTarget;
        const mat = p.calcTransformMatrix();
        const pts = [];
        p.path.forEach(cmd => {
            // Fabric stores commands as ['M', x, y], ['L', x, y], ['Q', x1, y1, x, y], ['C', x1, y1, x2, y2, x, y], ['Z']
            if (cmd[0] === 'M' || cmd[0] === 'L') pts.push({ x: cmd[1], y: cmd[2], cmd });
            else if (cmd[0] === 'Q') pts.push({ x: cmd[3], y: cmd[4], cmd });
            else if (cmd[0] === 'C') pts.push({ x: cmd[5], y: cmd[6], cmd });
        });
        // Path local coords are relative; we need to map through pathOffset
        pts.forEach((pt, i) => {
            const local = { x: pt.x - p.pathOffset.x, y: pt.y - p.pathOffset.y };
            const world = fabric.util.transformPoint(local, mat);
            const h = new fabric.Circle({
                left: world.x - 4, top: world.y - 4, radius: 4,
                fill: '#fff', stroke: '#6366f1', strokeWidth: 2,
                hasBorders: false, hasControls: false, originX: 'left', originY: 'top',
                excludeFromExport: true, objectCaching: false,
                lockScalingX: true, lockScalingY: true, lockRotation: true,
            });
            h._lcsNodeHandle = true;
            h._lcsIndex = i;
            h.on('moving', () => {
                const pNew = { x: h.left + 4, y: h.top + 4 };
                const inv = fabric.util.invertTransform(mat);
                const loc = fabric.util.transformPoint(pNew, inv);
                const cmd = pt.cmd;
                if (cmd[0] === 'M' || cmd[0] === 'L') { cmd[1] = loc.x + p.pathOffset.x; cmd[2] = loc.y + p.pathOffset.y; }
                else if (cmd[0] === 'Q') { cmd[3] = loc.x + p.pathOffset.x; cmd[4] = loc.y + p.pathOffset.y; }
                else if (cmd[0] === 'C') { cmd[5] = loc.x + p.pathOffset.x; cmd[6] = loc.y + p.pathOffset.y; }
                p.dirty = true;
                fab.requestRenderAll();
            });
            fab.add(h);
            nodeHandles.push(h);
        });
        fab.requestRenderAll();
    }
    function endNodeEdit() {
        const fab = LCS.canvas.fabric;
        nodeHandles.forEach(h => fab.remove(h));
        nodeHandles = [];
        if (nodeEditTarget) {
            nodeEditTarget.setCoords();
            nodeEditTarget = null;
            fab.requestRenderAll();
        }
    }

    LCS.shapes = { init, setTool, endPen, endNodeEdit, startNodeEdit };
})();

// ============================================================
// LCS.image — drag-drop, grayscale, dithering, threshold
// ============================================================
(() => {
    const { $, mmToPx, pxToMm, toast, progress } = LCS.util;

    function init() {
        const wrap = $('#canvas-wrap');
        const hint = $('#drop-hint');
        let dragDepth = 0;
        wrap.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; hint.classList.add('visible'); });
        wrap.addEventListener('dragleave', e => { e.preventDefault(); dragDepth--; if (dragDepth <= 0) { dragDepth = 0; hint.classList.remove('visible'); } });
        wrap.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        wrap.addEventListener('drop', async e => {
            e.preventDefault();
            dragDepth = 0; hint.classList.remove('visible');
            const files = Array.from(e.dataTransfer.files);
            for (const f of files) await handleFile(f);
        });
        // Also the Import button
        $('#file-input').addEventListener('change', async e => {
            for (const f of Array.from(e.target.files)) await handleFile(f);
            e.target.value = '';
        });
    }

    async function handleFile(file) {
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.svg')) return LCS.importers.importSvgFile(file);
        if (name.endsWith('.pdf')) return LCS.importers.importPdfFile(file);
        if (file.type && file.type.startsWith('image/')) return importImageFile(file);
        toast('Unsupported file: ' + file.name, 'warn');
    }

    function importImageFile(file) {
        const reader = new FileReader();
        reader.onload = () => addImageFromDataUrl(reader.result, file.name);
        reader.readAsDataURL(file);
    }

    function addImageFromDataUrl(dataUrl, name) {
        fabric.Image.fromURL(dataUrl, img => {
            const fab = LCS.canvas.fabric;
            // fit within bed half
            const m = LCS.state.machine();
            const bedW = mmToPx(m.bedWidth);
            const bedH = mmToPx(m.bedHeight);
            const targetW = bedW * 0.5;
            const scale = Math.min(1, targetW / img.width, bedH * 0.5 / img.height);
            img.set({
                left: bedW / 2 - (img.width * scale) / 2,
                top: bedH / 2 - (img.height * scale) / 2,
                scaleX: scale, scaleY: scale,
            });
            img._origSrc = dataUrl;
            img._origWidth = img.width;
            img._origHeight = img.height;
            img._imgParams = { mode: 'grayscale', algo: 'floyd', threshold: 128, contrast: 0, brightness: 0, invert: false };
            img.sourceType = 'image';
            LCS.objects.addToCanvas(img, LCS.state.activeLayer());
            reprocess(img);
        }, { crossOrigin: 'anonymous' });
    }

    function reprocess(img) {
        const params = img._imgParams || {};
        const src = img._origSrc;
        if (!src) return;
        const raw = new Image();
        raw.onload = () => {
            const off = document.createElement('canvas');
            off.width = raw.width; off.height = raw.height;
            const ctx = off.getContext('2d');
            ctx.drawImage(raw, 0, 0);
            const data = ctx.getImageData(0, 0, off.width, off.height);
            applyAdjust(data, params);
            if (params.mode === 'grayscale') grayscaleOnly(data, params);
            else if (params.mode === 'threshold') threshAlpha(data, params);
            else if (params.mode === 'dither') dither(data, params);
            ctx.putImageData(data, 0, 0);
            const url = off.toDataURL('image/png');
            img.setSrc(url, () => LCS.canvas.fabric.requestRenderAll(), { crossOrigin: 'anonymous' });
        };
        raw.src = src;
    }

    function applyAdjust(data, params) {
        const p = data.data;
        const b = (params.brightness || 0) * 2.55;   // -255..255
        const c = (params.contrast || 0) / 100;       // -1..1
        const factor = (c + 1) / (1 - c + 1e-9);
        const invert = !!params.invert;
        for (let i = 0; i < p.length; i += 4) {
            for (let k = 0; k < 3; k++) {
                let v = p[i + k] + b;
                v = factor * (v - 128) + 128;
                if (invert) v = 255 - v;
                p[i + k] = Math.max(0, Math.min(255, v));
            }
        }
    }

    function toLuma(data) {
        const p = data.data;
        const L = new Float32Array(data.width * data.height);
        for (let i = 0, j = 0; i < p.length; i += 4, j++) {
            L[j] = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
        }
        return L;
    }

    function grayscaleOnly(data, params) {
        const p = data.data;
        const w = data.width, h = data.height;
        for (let i = 0; i < p.length; i += 4) {
            const L = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
            p[i] = p[i + 1] = p[i + 2] = L;
        }
    }

    function threshAlpha(data, params) {
        const p = data.data;
        const T = params.threshold ?? 128;
        for (let i = 0; i < p.length; i += 4) {
            const L = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
            if (L >= T) {
                // white -> transparent
                p[i + 3] = 0;
            } else {
                p[i] = p[i + 1] = p[i + 2] = 0;
                p[i + 3] = 255;
            }
        }
    }

    // === DITHERING ===
    const KERNELS = {
        floyd: { div: 16, diff: [[1,0,7],[-1,1,3],[0,1,5],[1,1,1]] },
        atkinson: { div: 8, diff: [[1,0,1],[2,0,1],[-1,1,1],[0,1,1],[1,1,1],[0,2,1]] },
        jarvis: { div: 48, diff: [
            [1,0,7],[2,0,5],
            [-2,1,3],[-1,1,5],[0,1,7],[1,1,5],[2,1,3],
            [-2,2,1],[-1,2,3],[0,2,5],[1,2,3],[2,2,1] ] },
        stucki: { div: 42, diff: [
            [1,0,8],[2,0,4],
            [-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2],
            [-2,2,1],[-1,2,2],[0,2,4],[1,2,2],[2,2,1] ] },
        burkes: { div: 32, diff: [
            [1,0,8],[2,0,4],
            [-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2] ] },
        sierra: { div: 32, diff: [
            [1,0,5],[2,0,3],
            [-2,1,2],[-1,1,4],[0,1,5],[1,1,4],[2,1,2],
            [-1,2,2],[0,2,3],[1,2,2] ] },
    };

    const BAYER4 = [
         [ 0,  8,  2, 10],
         [12,  4, 14,  6],
         [ 3, 11,  1,  9],
         [15,  7, 13,  5]
    ];
    const BAYER8 = (() => {
        // 8x8 Bayer via recursion
        const b2 = [[0,2],[3,1]];
        const expand = (m) => {
            const n = m.length, out = [];
            for (let y = 0; y < n * 2; y++) out[y] = [];
            for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
                out[y][x] = 4 * m[y][x];
                out[y][x + n] = 4 * m[y][x] + 2;
                out[y + n][x] = 4 * m[y][x] + 3;
                out[y + n][x + n] = 4 * m[y][x] + 1;
            }
            return out;
        };
        return expand(expand(b2)); // 8x8
    })();

    function dither(data, params) {
        const w = data.width, h = data.height;
        const L = toLuma(data);
        const T = params.threshold ?? 128;
        const algo = params.algo || 'floyd';
        const p = data.data;

        if (algo === 'bayer4' || algo === 'bayer8') {
            const M = algo === 'bayer4' ? BAYER4 : BAYER8;
            const size = M.length;
            const max = size * size;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    const m = M[y % size][x % size] / max * 255;
                    const v = L[i] > m ? 255 : 0;
                    const pi = i * 4;
                    p[pi] = p[pi+1] = p[pi+2] = v;
                    p[pi+3] = 255;
                }
            }
            return;
        }

        const K = KERNELS[algo] || KERNELS.floyd;
        const div = K.div;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const old = L[i];
                const neu = old >= T ? 255 : 0;
                L[i] = neu;
                const err = old - neu;
                for (const [dx, dy, weight] of K.diff) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                    L[ny * w + nx] += err * weight / div;
                }
                const pi = i * 4;
                p[pi] = p[pi+1] = p[pi+2] = neu;
                p[pi+3] = 255;
            }
        }
    }

    // Segment -> SVG path d (shared with PDF importer)
    function segmentsToPathD(segments) {
        let d = '', first = true;
        for (const s of segments) {
            if (first) { d += `M ${s.x1} ${s.y1} `; first = false; }
            if (s.type === 'L') d += `L ${s.x2} ${s.y2} `;
            else if (s.type === 'Q') d += `Q ${s.x2} ${s.y2} ${s.x3} ${s.y3} `;
        }
        return d + 'Z';
    }

    function loadImagePromise(src) {
        return new Promise((resolve, reject) => {
            const el = new Image();
            el.crossOrigin = 'anonymous';
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('Image load failed'));
            el.src = src;
        });
    }

    // Trace an image into individual vector paths
    async function traceToVector(img) {
        if (!window.ImageTracer) { toast('ImageTracer not loaded', 'danger'); return; }
        progress('Tracing to vector', 'Reading image...', 0.15);
        // Safety: force-close the progress modal after 30s if something hangs
        const safetyTimer = setTimeout(() => {
            progress('', '', false);
            toast('Trace timed out', 'warn');
        }, 30000);
        const done = () => { clearTimeout(safetyTimer); progress('', '', false); };
        try {
            // Always trace the processed (post-threshold / post-dither) image
            const src = (img.getSrc && img.getSrc()) || (img._element && img._element.src);
            if (!src) throw new Error('Image source missing');
            const raw = await loadImagePromise(src);

            const off = document.createElement('canvas');
            off.width = raw.width; off.height = raw.height;
            const ctx = off.getContext('2d');
            // White fill so fully-transparent pixels (threshold mode) don't trace as content
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, off.width, off.height);
            ctx.drawImage(raw, 0, 0);
            const data = ctx.getImageData(0, 0, off.width, off.height);

            progress('Tracing to vector', 'Extracting contours...', 0.45);
            await new Promise(r => setTimeout(r, 10));

            // Threshold-mode: force exact B&W palette so sampling can't drift toward grey.
            // Non-threshold: sample 4 colors, mild path-length filter to drop noise.
            const isThreshold = img._imgParams && img._imgParams.mode === 'threshold';
            const options = {
                ltres: 1,
                qtres: 1,
                pathomit: isThreshold ? 4 : 8,
                rightangleenhance: true,
                linefilter: true,
                strokewidth: 0,
                ...(isThreshold
                    ? { colorsampling: 0, numberofcolors: 2,
                        specpalette: [[0,0,0,255],[255,255,255,255]] }
                    : { colorsampling: 1, numberofcolors: 4 }),
            };
            const td = ImageTracer.imagedataToTracedata(data, options);

            // Drop near-white / transparent layers (background)
            const kept = [];
            for (let i = 0; i < td.layers.length; i++) {
                const c = td.palette[i];
                const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
                if (c[3] < 16 || lum > 235) continue;
                kept.push({ contours: td.layers[i], color: c });
            }
            if (!kept.length) { done(); toast('No shapes to trace (image is empty / all white)', 'warn'); return; }

            // Combine every contour into ONE multi-subpath d string so the result is a single
            // fabric.Path — no group/matrix gymnastics, and gcode generation takes the well-tested
            // path branch. The path renders as one solid silhouette (even-odd handles holes).
            // Fill is forced black: the visible colour on canvas is only for preview; actual
            // engraving power/speed come from the assigned layer, not from this fill.
            let combinedD = '';
            let pathCount = 0;
            const traceColor = '#000000';
            for (const { contours } of kept) {
                for (const contour of contours) {
                    if (!contour.segments || contour.segments.length < 3) continue;
                    const d = segmentsToPathD(contour.segments);
                    if (d) { combinedD += d + ' '; pathCount++; }
                }
            }
            if (!pathCount) { done(); toast('Tracing produced no paths', 'warn'); return; }

            progress('Tracing to vector', `Finalising ${pathCount} contour${pathCount > 1 ? 's' : ''}...`, 0.8);
            await new Promise(r => setTimeout(r, 10));

            const imgLeft = img.left, imgTop = img.top;
            const imgW = img.getScaledWidth(), imgH = img.getScaledHeight();

            try {
                const fab = LCS.canvas.fabric;
                const defaultLayer = LCS.state.layers().find(l => l.opType === 'engrave') || LCS.state.activeLayer();

                // One path, all contours as subpaths
                const path = new fabric.Path(combinedD.trim(), {
                    fill: traceColor,
                    stroke: '',
                    strokeWidth: 0,
                    fillRule: 'evenodd',
                    originX: 'left',
                    originY: 'top',
                });
                // Fit over where the source image was
                const sX = imgW / Math.max(1, path.width);
                const sY = imgH / Math.max(1, path.height);
                path.set({ left: imgLeft, top: imgTop, scaleX: sX, scaleY: sY });
                path.setCoords();
                path.sourceType = 'traced';
                LCS.objects.attach(path, defaultLayer);
                fab.add(path);
                fab.setActiveObject(path);

                // Replace the raster image with the vector
                fab.remove(img);
                fab.requestRenderAll();
                done();
                toast(`Traced — ${pathCount} contour${pathCount > 1 ? 's' : ''} merged into one path`, 'success');
            } catch (innerErr) {
                console.error(innerErr);
                done();
                toast('Trace import failed: ' + innerErr.message, 'danger');
            }
        } catch (e) {
            console.error(e);
            done();
            toast('Trace failed: ' + e.message, 'danger');
        }
    }

    LCS.image = { init, importImageFile, addImageFromDataUrl, reprocess, traceToVector, segmentsToPathD };
})();

// ============================================================
// LCS.importers — SVG + PDF
// ============================================================
(() => {
    const { mmToPx, toast, progress } = LCS.util;

    function importSvgFile(file) {
        const reader = new FileReader();
        reader.onload = () => importSvgString(reader.result);
        reader.readAsText(file);
    }

    function isNearWhite(c) {
        if (!c || c === 'none' || c === 'transparent') return false;
        const hex = normalizeHex(c);
        const { r, g, b } = LCS.util.hexToRgb(hex);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 235;
    }
    function isEffectivelyInvisible(o) {
        const fill = (o.fill || '').toString();
        const stroke = (o.stroke || '').toString();
        const fillInvisible = !fill || fill === 'none' || fill === 'transparent' || isNearWhite(fill);
        const strokeInvisible = !stroke || stroke === 'none' || stroke === 'transparent' || isNearWhite(stroke) || !(o.strokeWidth > 0);
        return fillInvisible && strokeInvisible;
    }

    function importSvgString(str) {
        fabric.loadSVGFromString(str, (objects, opts) => {
            if (!objects || !objects.length) { toast('No SVG paths found', 'warn'); return; }
            const fab = LCS.canvas.fabric;
            const state = LCS.state.get();

            // Filter out invisible / near-white-background elements
            const kept = objects.filter(o => !isEffectivelyInvisible(o));
            if (!kept.length) { toast('SVG had no visible paths', 'warn'); return; }

            // Compute combined bounding box in SVG-local space
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            kept.forEach(o => {
                const b = o.getBoundingRect(true, true);
                minX = Math.min(minX, b.left);
                minY = Math.min(minY, b.top);
                maxX = Math.max(maxX, b.left + b.width);
                maxY = Math.max(maxY, b.top + b.height);
            });
            const contentW = Math.max(1, maxX - minX);
            const contentH = Math.max(1, maxY - minY);
            const m = LCS.state.machine();
            const bedW = mmToPx(m.bedWidth), bedH = mmToPx(m.bedHeight);
            const scale = Math.min(1, (bedW * 0.8) / contentW, (bedH * 0.8) / contentH);
            const offsetX = bedW / 2 - (contentW * scale) / 2 - minX * scale;
            const offsetY = bedH / 2 - (contentH * scale) / 2 - minY * scale;

            // Per-path: reposition, auto-assign layer, add as individual object
            let newLayers = 0;
            kept.forEach(o => {
                o.set({
                    left: (o.left || 0) * scale + offsetX,
                    top: (o.top || 0) * scale + offsetY,
                    scaleX: (o.scaleX || 1) * scale,
                    scaleY: (o.scaleY || 1) * scale,
                });
                o.setCoords();

                // Choose color key: prefer non-white stroke, then non-white fill
                const stroke = (o.stroke || '').toString();
                const fill = (o.fill || '').toString();
                const strokeUsable = stroke && stroke !== 'none' && stroke !== 'transparent' && !isNearWhite(stroke);
                const fillUsable = fill && fill !== 'none' && fill !== 'transparent' && !isNearWhite(fill);
                const colorKey = strokeUsable ? stroke : (fillUsable ? fill : '#000000');
                const hex = normalizeHex(colorKey);

                let layer = LCS.layers.getLayerByColor(hex);
                if (!layer) {
                    layer = {
                        id: LCS.util.uid('layer'),
                        name: `Imported ${hex}`,
                        color: hex,
                        opType: hex === '#ff0000' || hex === '#f00' ? 'cut' : 'engrave',
                        power: 50, speed: 1000, passes: 1,
                        airAssist: false, visible: true, locked: false, zOrder: state.layers.length,
                    };
                    state.layers.push(layer);
                    newLayers++;
                }
                o.sourceType = 'svg';
                LCS.objects.attach(o, layer);
                fab.add(o);
            });
            LCS.state.emit('layers:changed');
            fab.requestRenderAll();
            toast(`Imported ${kept.length} path${kept.length > 1 ? 's' : ''}${newLayers ? ` (+${newLayers} new layer${newLayers > 1 ? 's' : ''})` : ''}`, 'success');
        });
    }

    function normalizeHex(c) {
        if (!c) return '#000000';
        if (typeof c !== 'string') return '#000000';
        c = c.trim().toLowerCase();
        if (c.startsWith('#')) {
            if (c.length === 4) return '#' + c.slice(1).split('').map(x => x + x).join('');
            return c.slice(0, 7);
        }
        const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/);
        if (m) return LCS.util.rgbToHex(+m[1], +m[2], +m[3]);
        // named colors
        const named = { black: '#000000', red: '#ff0000', blue: '#0000ff', green: '#008000', white: '#ffffff' };
        return named[c] || '#000000';
    }

    async function importPdfFile(file, forceRaster = false) {
        if (!window.pdfjsLib) { toast('PDF.js not loaded', 'danger'); return; }
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        progress('Importing PDF', 'Parsing...', 0.1);
        try {
            const buf = await file.arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data: buf }).promise;
            let vectorPages = 0, rasterPages = 0;
            for (let p = 1; p <= doc.numPages; p++) {
                progress('Importing PDF', `Page ${p}/${doc.numPages}`, p / doc.numPages);
                const page = await doc.getPage(p);
                let imported = false;
                if (!forceRaster) imported = await tryImportPageAsVector(page, file.name, p);
                if (imported) vectorPages++;
                else { await importPageAsRaster(page, file.name, p); rasterPages++; }
                await new Promise(r => setTimeout(r, 20));
            }
            progress('', '', false);
            const parts = [];
            if (vectorPages) parts.push(`${vectorPages} vector page${vectorPages > 1 ? 's' : ''}`);
            if (rasterPages) parts.push(`${rasterPages} raster page${rasterPages > 1 ? 's' : ''}`);
            toast('Imported ' + parts.join(' + '), 'success');
        } catch (e) {
            console.error(e);
            progress('', '', false);
            toast('PDF import failed: ' + e.message, 'danger');
        }
    }

    async function tryImportPageAsVector(page, fileName, pageNum) {
        // Strategy 1: op-list path extractor (clean, true vectors, but misses text glyphs)
        let opSvg = null, opPathCount = 0;
        try {
            opSvg = await pageOpsToSvg(page);
            opPathCount = opSvg ? (opSvg.match(/<path\b/g) || []).length : 0;
        } catch (e) { console.warn('PDF op-list parse failed', e); }

        // Strategy 2: raster-and-trace — catches text and anything op-list missed
        let traceSvg = null, tracePathCount = 0;
        try {
            const res = await rasterTracePage(page);
            traceSvg = res && res.svg;
            tracePathCount = res && res.pathCount || 0;
        } catch (e) { console.warn('PDF trace extraction failed', e); }

        // Decide which result is better — prefer the one with more paths, or combine if both found content
        if (opPathCount === 0 && tracePathCount === 0) return false;
        if (opPathCount >= 3 && tracePathCount < opPathCount * 0.5) {
            LCS.importers.importSvgString(opSvg);
            return true;
        }
        if (tracePathCount > 0) {
            LCS.importers.importSvgString(traceSvg);
            return true;
        }
        if (opPathCount > 0) {
            LCS.importers.importSvgString(opSvg);
            return true;
        }
        return false;
    }

    async function rasterTracePage(page) {
        if (!window.ImageTracer) return null;
        // Render at 200 DPI — high enough for clean trace, fast enough to process
        const viewport = page.getViewport({ scale: 200 / 72 });
        const off = document.createElement('canvas');
        off.width = Math.ceil(viewport.width);
        off.height = Math.ceil(viewport.height);
        const ctx = off.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, off.width, off.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const imgData = ctx.getImageData(0, 0, off.width, off.height);
        const options = {
            numberofcolors: 4,           // background + a couple of color levels
            colorsampling: 1,             // palette picked from the image
            ltres: 1,                     // line threshold (fine)
            qtres: 1,                     // curve threshold (fine)
            pathomit: 8,                  // drop paths shorter than this
            rightangleenhance: true,
            linefilter: true,
            strokewidth: 0,               // we'll stroke per-layer instead
            viewbox: true,
        };
        const tracedata = ImageTracer.imagedataToTracedata(imgData, options);
        // Drop near-white layers (the background) so paths arrive clean
        const kept = tracedata.layers.map((layer, i) => {
            const c = tracedata.palette[i];
            const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            const alpha = c[3];
            if (alpha < 16) return null;
            if (lum > 235) return null;
            return { layer, color: c, index: i };
        }).filter(Boolean);
        if (!kept.length) return null;
        // Build SVG manually — one <path> per contour so each becomes an individual Fabric object
        const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${off.width}" height="${off.height}" viewBox="0 0 ${off.width} ${off.height}">`];
        let pathCount = 0;
        for (const { layer, color } of kept) {
            const [r, g, b] = color;
            const hex = LCS.util.rgbToHex(r, g, b);
            for (const segs of layer) {
                if (!segs.segments || segs.segments.length < 3) continue;
                const d = segmentsToPathD(segs.segments);
                if (!d) continue;
                parts.push(`<path d="${d}" fill="${hex}" stroke="none"/>`);
                pathCount++;
            }
        }
        parts.push('</svg>');
        if (pathCount === 0) return null;
        return { svg: parts.join('\n'), pathCount };
    }

    // Convert imagetracer segment array into SVG path d string
    function segmentsToPathD(segments) {
        let d = '', first = true;
        for (const s of segments) {
            // imagetracer segments: { type:'L', x1, y1, x2, y2 } or { type:'Q', x1, y1, x2, y2, x3, y3 }
            if (first) { d += `M ${s.x1} ${s.y1} `; first = false; }
            if (s.type === 'L') d += `L ${s.x2} ${s.y2} `;
            else if (s.type === 'Q') d += `Q ${s.x2} ${s.y2} ${s.x3} ${s.y3} `;
        }
        d += 'Z';
        return d;
    }

    async function pageOpsToSvg(page) {
        const OPS = pdfjsLib.OPS;
        const viewport = page.getViewport({ scale: 1 });
        const opList = await page.getOperatorList();
        const out = [];
        // Transform stack
        let ctm = [1, 0, 0, 1, 0, 0];
        const stack = [];
        let fill = '#000000', stroke = '#000000';
        let strokeWidth = 1;
        const pushMat = () => stack.push({ ctm: ctm.slice(), fill, stroke, strokeWidth });
        const popMat = () => { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; stroke = s.stroke; strokeWidth = s.strokeWidth; } };
        const mult = (a, b) => [
            a[0]*b[0] + a[2]*b[1],
            a[1]*b[0] + a[3]*b[1],
            a[0]*b[2] + a[2]*b[3],
            a[1]*b[2] + a[3]*b[3],
            a[0]*b[4] + a[2]*b[5] + a[4],
            a[1]*b[4] + a[3]*b[5] + a[5],
        ];
        const emit = (d, isStroke, isFill) => {
            if (!d) return;
            const m = `matrix(${ctm[0]} ${ctm[1]} ${ctm[2]} ${ctm[3]} ${ctm[4]} ${ctm[5]})`;
            const fillAttr = isFill ? fill : 'none';
            const strokeAttr = isStroke ? stroke : 'none';
            const swAttr = isStroke ? ` stroke-width="${strokeWidth}"` : '';
            out.push(`<path d="${d}" fill="${fillAttr}" stroke="${strokeAttr}"${swAttr} transform="${m}"/>`);
        };
        const pathDFromOps = (fnArray, argsArray) => {
            let d = '', i = 0;
            for (const fn of fnArray) {
                if (fn === OPS.moveTo) { d += `M ${argsArray[i]} ${argsArray[i+1]} `; i += 2; }
                else if (fn === OPS.lineTo) { d += `L ${argsArray[i]} ${argsArray[i+1]} `; i += 2; }
                else if (fn === OPS.curveTo) { d += `C ${argsArray[i]} ${argsArray[i+1]} ${argsArray[i+2]} ${argsArray[i+3]} ${argsArray[i+4]} ${argsArray[i+5]} `; i += 6; }
                else if (fn === OPS.curveTo2) {
                    // curveTo2 (v): current point -> (args[0..1], args[2..3] as x3,y3) — 2nd control = endpoint
                    d += `C ${argsArray[i]} ${argsArray[i+1]} ${argsArray[i+2]} ${argsArray[i+3]} ${argsArray[i+2]} ${argsArray[i+3]} `; i += 4;
                }
                else if (fn === OPS.curveTo3) {
                    // curveTo3 (y): args = x1,y1,x3,y3 — 1st control = current (we approximate by using args)
                    d += `C ${argsArray[i]} ${argsArray[i+1]} ${argsArray[i]} ${argsArray[i+1]} ${argsArray[i+2]} ${argsArray[i+3]} `; i += 4;
                }
                else if (fn === OPS.closePath) { d += 'Z '; }
                else if (fn === OPS.rectangle) {
                    const [x, y, w, h] = [argsArray[i], argsArray[i+1], argsArray[i+2], argsArray[i+3]];
                    d += `M ${x} ${y} L ${x+w} ${y} L ${x+w} ${y+h} L ${x} ${y+h} Z `; i += 4;
                }
            }
            return d.trim();
        };
        let pendingPath = '';

        for (let i = 0; i < opList.fnArray.length; i++) {
            const op = opList.fnArray[i];
            const args = opList.argsArray[i];
            if (op === OPS.save) pushMat();
            else if (op === OPS.restore) popMat();
            else if (op === OPS.transform) ctm = mult(ctm, args);
            else if (op === OPS.constructPath) {
                pendingPath = pathDFromOps(args[0], args[1]);
            }
            else if (op === OPS.fill || op === OPS.eoFill) { emit(pendingPath, false, true); pendingPath = ''; }
            else if (op === OPS.stroke || op === OPS.closeStroke) { emit(pendingPath, true, false); pendingPath = ''; }
            else if (op === OPS.fillStroke || op === OPS.eoFillStroke || op === OPS.closeFillStroke || op === OPS.closeEOFillStroke) {
                emit(pendingPath, true, true); pendingPath = '';
            }
            else if (op === OPS.setFillRGBColor) fill = LCS.util.rgbToHex(args[0], args[1], args[2]);
            else if (op === OPS.setStrokeRGBColor) stroke = LCS.util.rgbToHex(args[0], args[1], args[2]);
            else if (op === OPS.setLineWidth) strokeWidth = args[0];
        }

        if (!out.length) return null;
        // PDF y-axis points up; SVG y-axis points down. Apply viewport transform.
        const [vw, vh] = [viewport.width, viewport.height];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}">
            <g transform="matrix(${viewport.transform.join(' ')})">
                ${out.join('\n')}
            </g>
        </svg>`;
        return svg;
    }

    async function importPageAsRaster(page, fileName, pageNum) {
        const viewport = page.getViewport({ scale: 300 / 72 });
        const off = document.createElement('canvas');
        off.width = viewport.width; off.height = viewport.height;
        await page.render({ canvasContext: off.getContext('2d'), viewport }).promise;
        const url = off.toDataURL('image/png');
        LCS.image.addImageFromDataUrl(url, `${fileName}_p${pageNum}.png`);
    }

    LCS.importers = { importSvgFile, importSvgString, importPdfFile };
})();

// ============================================================
// LCS.align — align + distribute
// ============================================================
(() => {
    function getSelected() {
        const fab = LCS.canvas.fabric;
        const objs = fab.getActiveObjects().filter(o => !o._lcsBed && !o._lcsGrid);
        return objs;
    }

    function align(kind) {
        const objs = getSelected();
        if (objs.length < 1) return;
        const boxes = objs.map(o => ({ o, b: o.getBoundingRect(true, true) }));
        const totalL = Math.min(...boxes.map(b => b.b.left));
        const totalR = Math.max(...boxes.map(b => b.b.left + b.b.width));
        const totalT = Math.min(...boxes.map(b => b.b.top));
        const totalB = Math.max(...boxes.map(b => b.b.top + b.b.height));
        const cx = (totalL + totalR) / 2;
        const cy = (totalT + totalB) / 2;

        boxes.forEach(({ o, b }) => {
            let dx = 0, dy = 0;
            if (kind === 'left')   dx = totalL - b.left;
            if (kind === 'right')  dx = totalR - (b.left + b.width);
            if (kind === 'cx')     dx = cx - (b.left + b.width / 2);
            if (kind === 'top')    dy = totalT - b.top;
            if (kind === 'bottom') dy = totalB - (b.top + b.height);
            if (kind === 'cy')     dy = cy - (b.top + b.height / 2);
            o.left += dx; o.top += dy; o.setCoords();
        });
        LCS.canvas.fabric.requestRenderAll();
    }

    function distribute(axis) {
        const objs = getSelected();
        if (objs.length < 3) return;
        const boxes = objs.map(o => ({ o, b: o.getBoundingRect(true, true) }));
        boxes.sort((a, b) => axis === 'h' ? a.b.left - b.b.left : a.b.top - b.b.top);
        const first = boxes[0], last = boxes[boxes.length - 1];
        const totalSize = boxes.reduce((sum, x) => sum + (axis === 'h' ? x.b.width : x.b.height), 0);
        const start = axis === 'h' ? first.b.left : first.b.top;
        const end = axis === 'h' ? last.b.left + last.b.width : last.b.top + last.b.height;
        const gap = (end - start - totalSize) / (boxes.length - 1);

        let cursor = start;
        for (let i = 0; i < boxes.length; i++) {
            const { o, b } = boxes[i];
            if (axis === 'h') {
                const dx = cursor - b.left;
                o.left += dx; cursor += b.width + gap;
            } else {
                const dy = cursor - b.top;
                o.top += dy; cursor += b.height + gap;
            }
            o.setCoords();
        }
        LCS.canvas.fabric.requestRenderAll();
    }

    LCS.align = { align, distribute };
})();

// ============================================================
// LCS.selection — select all / group / ungroup
// ============================================================
(() => {
    function isUserObject(o) {
        return o && !o._lcsBed && !o._lcsGrid && !o._lcsPenWorking
               && !o._lcsPreview && !o._lcsNodeHandle;
    }

    function selectAll() {
        const fab = LCS.canvas.fabric;
        if (!fab) return;
        const objs = fab.getObjects().filter(isUserObject);
        if (!objs.length) return;
        fab.discardActiveObject();
        const sel = new fabric.ActiveSelection(objs, { canvas: fab });
        fab.setActiveObject(sel);
        fab.requestRenderAll();
    }

    function group() {
        const fab = LCS.canvas.fabric;
        const act = fab.getActiveObject();
        if (!act) { LCS.util.toast('Select items first', 'warn'); return; }
        if (act.type !== 'activeSelection') { LCS.util.toast('Select 2+ items to group', 'warn'); return; }
        // Fabric 5: activeSelection.toGroup() merges into a fabric.Group
        const g = act.toGroup();
        g.objectId = LCS.util.uid('grp');
        const layer = LCS.state.activeLayer();
        g.layerId = g.layerId || layer.id;
        g.sourceType = 'group';
        fab.setActiveObject(g);
        fab.requestRenderAll();
        LCS.state.emit('object:modified');
    }

    function ungroup() {
        const fab = LCS.canvas.fabric;
        const act = fab.getActiveObject();
        if (!act || act.type !== 'group') { LCS.util.toast('Select a group to ungroup', 'warn'); return; }
        // Fabric 5: group.toActiveSelection() reverses toGroup()
        const sel = act.toActiveSelection();
        fab.setActiveObject(sel);
        fab.requestRenderAll();
        LCS.state.emit('object:modified');
    }

    LCS.selection = { selectAll, group, ungroup, isUserObject };
})();

// ============================================================
// LCS.gcode — generation (GRBL)
// ============================================================
(() => {
    const { PX_PER_MM, MM_PER_PX } = LCS.config;
    const { pxToMm, progress } = LCS.util;

    // GRBL dialect
    const dialect = {
        header({ machine }) {
            return [
                `; Generated by Laser Cutter Studio`,
                `; Date: ${new Date().toISOString()}`,
                `; Machine: ${machine.bedWidth}x${machine.bedHeight} mm, Dialect: GRBL, Origin: ${machine.origin}`,
                `G90`,          // absolute
                `G21`,          // mm
                `G0 X0 Y0`,     // park
                `M5`,           // laser off
            ];
        },
        footer() {
            return [
                `M5`,
                `G0 X0 Y0`,
                `; End`,
            ];
        },
        laserOn: s => `M4 S${Math.round(s)}`,    // dynamic power
        laserConst: s => `M3 S${Math.round(s)}`, // constant power
        laserOff: () => `M5`,
        rapid: (x, y, f) => `G0 X${x.toFixed(3)} Y${y.toFixed(3)}${f ? ` F${f|0}` : ''}`,
        cut: (x, y, f, s) => `G1 X${x.toFixed(3)} Y${y.toFixed(3)}${f ? ` F${f|0}` : ''}${s != null ? ` S${Math.round(s)}` : ''}`,
    };

    // Convert Fabric px with canvas coords into machine mm.
    // Fabric: (0,0) = top-left; y grows down.
    // Machine origin 'bottom-left': (0,0) machine = (0, bedH) fabric-mm; y flipped.
    function toMachineMm(pxPt) {
        const m = LCS.state.machine();
        const mmX = pxPt.x * MM_PER_PX;
        const mmY = pxPt.y * MM_PER_PX;
        let outX = mmX, outY = mmY;
        if (m.origin === 'bottom-left') outY = m.bedHeight - mmY;
        else if (m.origin === 'center') { outX -= m.bedWidth / 2; outY = (m.bedHeight / 2) - mmY; }
        // top-left: use as-is
        return { x: outX, y: outY };
    }

    function opTypeOf(obj) {
        const layer = LCS.state.layers().find(l => l.id === obj.layerId) || LCS.state.activeLayer();
        return { layer, opType: obj.opType || layer.opType };
    }

    // Append `src` to `dst` without `dst.push(...src)` — a dense raster produces tens of
    // thousands of lines, and spreading them as function arguments overflows the call stack.
    function appendLines(dst, src) {
        if (!src || !src.length) return;
        const CHUNK = 10000;
        for (let i = 0; i < src.length; i += CHUNK) {
            Array.prototype.push.apply(dst, src.slice(i, i + CHUNK));
        }
    }

    async function generate() {
        const fab = LCS.canvas.fabric;
        const state = LCS.state.get();
        const m = state.machine;

        const objects = fab.getObjects().filter(o => !o._lcsBed && !o._lcsGrid && !o._lcsPreview && !o._lcsNodeHandle && !o._lcsPenWorking && o.visible !== false);
        if (!objects.length) { LCS.util.toast('Nothing on canvas', 'warn'); return null; }

        // Group by op order: engrave -> score -> cut
        const buckets = { engrave: [], score: [], cut: [] };
        objects.forEach(o => {
            const { opType } = opTypeOf(o);
            if (buckets[opType]) buckets[opType].push(o);
            else buckets.cut.push(o);
        });

        const lines = [];
        lines.push(...dialect.header({ machine: m }));

        let totalBurnMm = 0, totalTravelMm = 0;
        let lastPt = { x: 0, y: 0 };

        for (const op of ['engrave', 'score', 'cut']) {
            const list = buckets[op];
            if (!list.length) continue;
            lines.push(`; === ${op.toUpperCase()} ===`);
            for (const o of list) {
                const { layer, opType } = opTypeOf(o);
                lines.push(`; Layer: ${layer.name} | Op: ${opType} | Power: ${layer.power}% | Speed: ${layer.speed} mm/min`);
                const S = Math.round(layer.power / 100 * m.smax);
                if (opType === 'engrave' && (o.type === 'image' || o.type === 'Image')) {
                    progress('Generating GCode', `Rasterizing ${layer.name}...`, 0.3);
                    await new Promise(r => setTimeout(r, 10));
                    const r = await rasterizeImage(o, layer, S);
                    appendLines(lines, r.lines);
                    totalBurnMm += r.burnMm; totalTravelMm += r.travelMm;
                    lastPt = r.lastPt;
                } else {
                    const r = vectorizeObject(o, layer, S, opType);
                    appendLines(lines, r.lines);
                    totalBurnMm += r.burnMm; totalTravelMm += r.travelMm;
                    lastPt = r.lastPt;
                }
            }
        }

        lines.push(...dialect.footer());
        const text = lines.join('\n');
        const stats = {
            totalLines: lines.length,
            burnMm: totalBurnMm, travelMm: totalTravelMm,
            durationSec: estimateDuration(totalBurnMm, totalTravelMm, buckets, m),
        };
        state.gcode = text;
        state.gcodeStats = stats;
        state.gcodeSegments = LCS.preview.parse(text);
        progress('', '', false);
        return { gcode: text, stats };
    }

    function estimateDuration(burnMm, travelMm, buckets, m) {
        // rough: use first layer's feed for each op; travel at m.travelFeed
        let burnSec = 0;
        for (const op of Object.keys(buckets)) {
            const obj = buckets[op][0];
            if (!obj) continue;
            const layer = LCS.state.layers().find(l => l.id === obj.layerId) || LCS.state.activeLayer();
            burnSec += (burnMm / Object.keys(buckets).length) / (layer.speed / 60);
        }
        const travelSec = travelMm / (m.travelFeed / 60);
        return burnSec + travelSec;
    }

    // ===== VECTOR =====
    function vectorizeObject(obj, layer, S, opType) {
        const lines = [];
        const m = LCS.state.machine();
        const polylines = flattenToPolylines(obj);
        if (!polylines.length) return { lines, burnMm: 0, travelMm: 0, lastPt: { x: 0, y: 0 } };

        let burnMm = 0, travelMm = 0;
        let lastPt = null;
        const feed = layer.speed;
        const passes = layer.passes || 1;
        const move = opType === 'score' ? dialect.laserConst(S) : dialect.laserOn(S);

        for (let pass = 0; pass < passes; pass++) {
            if (passes > 1) lines.push(`; Pass ${pass + 1}/${passes}`);
            for (const poly of polylines) {
                if (poly.length < 2) continue;
                const startMm = toMachineMm(poly[0]);
                lines.push(dialect.rapid(startMm.x, startMm.y, m.travelFeed));
                if (lastPt) travelMm += dist(lastPt, startMm);
                lines.push(move);
                for (let i = 1; i < poly.length; i++) {
                    const pt = toMachineMm(poly[i]);
                    lines.push(dialect.cut(pt.x, pt.y, feed, S));
                    burnMm += dist(toMachineMm(poly[i - 1]), pt);
                    lastPt = pt;
                }
                lines.push(dialect.laserOff());
            }
        }
        return { lines, burnMm, travelMm, lastPt: lastPt || { x: 0, y: 0 } };
    }

    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    function flattenToPolylines(obj) {
        // Return array of polylines (each is array of {x,y} in Fabric px, world coords)
        const mat = obj.calcTransformMatrix();
        const tol = 0.05 * PX_PER_MM; // chord tol ~0.05mm

        const applyMat = pt => fabric.util.transformPoint({ x: pt.x - (obj.pathOffset?.x || 0), y: pt.y - (obj.pathOffset?.y || 0) }, mat);
        const applyLocal = pt => fabric.util.transformPoint(pt, mat);

        if (obj.type === 'rect') {
            const w = obj.width, h = obj.height;
            // Fabric renders rects centered around local (0,0): (-w/2,-h/2) → (w/2,h/2)
            const pts = [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2],[-w/2,-h/2]]
                .map(([x,y]) => fabric.util.transformPoint({ x, y }, mat));
            return [pts];
        }
        if (obj.type === 'ellipse' || obj.type === 'circle') {
            const rx = obj.rx ?? obj.radius, ry = obj.ry ?? obj.radius;
            const steps = Math.max(24, Math.round(Math.PI * Math.max(rx, ry) / tol / 2));
            const pts = [];
            // Ellipse/circle also drawn centered around local (0,0)
            for (let i = 0; i <= steps; i++) {
                const a = (i / steps) * Math.PI * 2;
                pts.push(fabric.util.transformPoint({ x: Math.cos(a) * rx, y: Math.sin(a) * ry }, mat));
            }
            return [pts];
        }
        if (obj.type === 'line') {
            // Line stored as x1,y1,x2,y2 but left/top/width/height drive transforms
            // Use path of line from its left,top to left+width/height? Use original vertices.
            const p1 = fabric.util.transformPoint({ x: obj.x1 - obj.pathOffset?.x || 0, y: obj.y1 - obj.pathOffset?.y || 0 }, mat);
            const p2 = fabric.util.transformPoint({ x: obj.x2 - obj.pathOffset?.x || 0, y: obj.y2 - obj.pathOffset?.y || 0 }, mat);
            // Fallback: if pathOffset not present use (0,0) and (width,height)
            // Simpler: compute via aCoords
            const c = obj.calcACoords();
            return [[c.tl, c.tr]];
        }
        if (obj.type === 'polyline' || obj.type === 'polygon') {
            const pts = obj.points.map(p => fabric.util.transformPoint({ x: p.x - obj.pathOffset.x, y: p.y - obj.pathOffset.y }, mat));
            if (obj.type === 'polygon') pts.push(pts[0]);
            return [pts];
        }
        if (obj.type === 'path') {
            return pathToPolylines(obj, tol);
        }
        if (obj.type === 'group') {
            // child.calcTransformMatrix() already composes the parent group's transform
            // (Fabric multiplies by this.group.calcTransformMatrix() internally when child.group is set),
            // so recurse directly into each child — no manual matrix multiplication, no property spread
            // (spreading loses prototype-defined props like `type` and drops us into the bbox fallback).
            let all = [];
            obj._objects.forEach(child => {
                const polys = flattenToPolylines(child);
                all = all.concat(polys);
            });
            return all;
        }
        if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
            return textToPolylines(obj, tol);
        }
        // fallback bounding box
        const c = obj.calcACoords();
        return [[c.tl, c.tr, c.br, c.bl, c.tl]];
    }

    function pathToPolylines(pathObj, tol) {
        const segments = pathObj.path;
        const mat = pathObj.calcTransformMatrix();
        const off = pathObj.pathOffset || { x: 0, y: 0 };
        const polylines = [];
        let current = [];
        let cx = 0, cy = 0;   // current point in path-local coords
        let sx = 0, sy = 0;   // subpath start

        const mapPt = (x, y) => fabric.util.transformPoint({ x: x - off.x, y: y - off.y }, mat);
        const pushCurrent = () => { if (current.length) polylines.push(current); current = []; };

        for (const seg of segments) {
            const cmd = seg[0];
            if (cmd === 'M') {
                pushCurrent();
                cx = seg[1]; cy = seg[2]; sx = cx; sy = cy;
                current.push(mapPt(cx, cy));
            } else if (cmd === 'L') {
                cx = seg[1]; cy = seg[2];
                current.push(mapPt(cx, cy));
            } else if (cmd === 'H') { cx = seg[1]; current.push(mapPt(cx, cy)); }
            else if (cmd === 'V') { cy = seg[1]; current.push(mapPt(cx, cy)); }
            else if (cmd === 'Q') {
                const [, x1, y1, x, y] = seg;
                flattenQuad(cx, cy, x1, y1, x, y, tol, (px, py) => current.push(mapPt(px, py)));
                cx = x; cy = y;
            } else if (cmd === 'C') {
                const [, x1, y1, x2, y2, x, y] = seg;
                flattenCubic(cx, cy, x1, y1, x2, y2, x, y, tol, (px, py) => current.push(mapPt(px, py)));
                cx = x; cy = y;
            } else if (cmd === 'Z' || cmd === 'z') {
                if (current.length) current.push(mapPt(sx, sy));
                pushCurrent();
                cx = sx; cy = sy;
            }
        }
        pushCurrent();
        return polylines;
    }

    function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, tol, push, depth = 0) {
        // Check flatness: distance of control points to the line (x0,y0)-(x3,y3)
        const flat = cubicFlatEnough(x0, y0, x1, y1, x2, y2, x3, y3, tol) || depth > 16;
        if (flat) { push(x3, y3); return; }
        // De Casteljau
        const x01 = (x0 + x1) / 2, y01 = (y0 + y1) / 2;
        const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2;
        const x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
        const x012 = (x01 + x12) / 2, y012 = (y01 + y12) / 2;
        const x123 = (x12 + x23) / 2, y123 = (y12 + y23) / 2;
        const x0123 = (x012 + x123) / 2, y0123 = (y012 + y123) / 2;
        flattenCubic(x0, y0, x01, y01, x012, y012, x0123, y0123, tol, push, depth + 1);
        flattenCubic(x0123, y0123, x123, y123, x23, y23, x3, y3, tol, push, depth + 1);
    }
    function cubicFlatEnough(x0, y0, x1, y1, x2, y2, x3, y3, tol) {
        const d1 = pointLineDist(x1, y1, x0, y0, x3, y3);
        const d2 = pointLineDist(x2, y2, x0, y0, x3, y3);
        return Math.max(d1, d2) < tol;
    }
    function flattenQuad(x0, y0, x1, y1, x2, y2, tol, push, depth = 0) {
        const flat = pointLineDist(x1, y1, x0, y0, x2, y2) < tol || depth > 16;
        if (flat) { push(x2, y2); return; }
        const x01 = (x0 + x1) / 2, y01 = (y0 + y1) / 2;
        const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2;
        const x012 = (x01 + x12) / 2, y012 = (y01 + y12) / 2;
        flattenQuad(x0, y0, x01, y01, x012, y012, tol, push, depth + 1);
        flattenQuad(x012, y012, x12, y12, x2, y2, tol, push, depth + 1);
    }
    function pointLineDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const L = Math.hypot(dx, dy);
        if (L < 1e-9) return Math.hypot(px - x1, py - y1);
        return Math.abs((px - x1) * dy - (py - y1) * dx) / L;
    }

    function textToPolylines(obj, tol) {
        // Try to render text to temp canvas, vector-trace outline via marching squares
        // Simpler approach: convert to path via measureText + Path2D is not exposed. We'll approximate with bounding rect segments per char.
        // For proper vectorization, opentype.js is preferred but loading fonts is async and error-prone across browsers.
        // As a pragmatic v1: render text into a crisp bitmap then trace outline using marching-squares (binary).
        try {
            const canvas = document.createElement('canvas');
            const scale = 2;
            const w = Math.ceil(obj.getScaledWidth() * scale);
            const h = Math.ceil(obj.getScaledHeight() * scale);
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = 'black';
            ctx.textBaseline = 'top';
            ctx.font = `${obj.fontWeight || 'normal'} ${obj.fontSize * scale}px ${obj.fontFamily || 'Arial'}`;
            const lines = (obj.text || '').split('\n');
            const lh = obj.fontSize * scale * (obj.lineHeight || 1.16);
            lines.forEach((ln, i) => ctx.fillText(ln, 0, i * lh));
            const img = ctx.getImageData(0, 0, w, h);
            const mask = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) {
                const pi = i * 4;
                const L = 0.2126 * img.data[pi] + 0.7152 * img.data[pi + 1] + 0.0722 * img.data[pi + 2];
                mask[i] = L < 128 ? 1 : 0;
            }
            const contours = marchingSquares(mask, w, h);
            // Scale back to object's local coords, then transform
            const mat = obj.calcTransformMatrix();
            const sX = obj.width / w, sY = obj.height / h;
            const ox = (obj.pathOffset && obj.pathOffset.x) || 0;
            const oy = (obj.pathOffset && obj.pathOffset.y) || 0;
            return contours.map(poly => poly.map(pt => fabric.util.transformPoint({ x: pt.x * sX - ox, y: pt.y * sY - oy }, mat)));
        } catch (e) {
            console.warn('text vectorization failed', e);
            const c = obj.calcACoords();
            return [[c.tl, c.tr, c.br, c.bl, c.tl]];
        }
    }

    // Marching squares on binary mask: returns array of contours
    function marchingSquares(mask, w, h) {
        const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mask[y * w + x];
        const visited = new Uint8Array((w + 1) * (h + 1));
        const contours = [];
        for (let y = 0; y < h - 1; y++) {
            for (let x = 0; x < w - 1; x++) {
                const tl = at(x, y), tr = at(x + 1, y), bl = at(x, y + 1), br = at(x + 1, y + 1);
                const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
                if (code === 0 || code === 15) continue;
                // Only trace once from boundary transitions — simplified: walk contour starting at each unvisited edge pixel
                if (visited[y * (w + 1) + x]) continue;
                const contour = trace(x, y, at, visited, w, h);
                if (contour.length > 4) contours.push(contour);
            }
        }
        return contours;
    }
    function trace(x0, y0, at, visited, w, h) {
        const contour = [];
        let x = x0, y = y0, dir = 0; // 0 right, 1 down, 2 left, 3 up
        let steps = 0;
        while (steps++ < 50000) {
            const idx = y * (w + 1) + x;
            if (visited[idx]) break;
            visited[idx] = 1;
            contour.push({ x, y });
            const tl = at(x, y), tr = at(x + 1, y), bl = at(x, y + 1), br = at(x + 1, y + 1);
            const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
            let newDir;
            switch (code) {
                case 1: newDir = 2; break;   // 0001
                case 2: newDir = 1; break;   // 0010
                case 3: newDir = 2; break;
                case 4: newDir = 3; break;
                case 5: newDir = (dir === 1) ? 2 : 3; break;
                case 6: newDir = 3; break;
                case 7: newDir = 3; break;
                case 8: newDir = 0; break;
                case 9: newDir = 0; break;
                case 10: newDir = (dir === 2) ? 1 : 0; break;
                case 11: newDir = 0; break;
                case 12: newDir = 2; break;
                case 13: newDir = 2; break;
                case 14: newDir = 1; break;
                default: return contour;
            }
            dir = newDir;
            if (dir === 0) x++;
            else if (dir === 1) y++;
            else if (dir === 2) x--;
            else if (dir === 3) y--;
            if (x < 0 || y < 0 || x > w || y > h) break;
            if (x === x0 && y === y0) break;
        }
        return contour;
    }

    // ===== RASTER =====
    async function rasterizeImage(obj, layer, S) {
        const m = LCS.state.machine();
        const interval = m.rasterInterval; // mm between scan lines
        const lines = [];
        let burnMm = 0, travelMm = 0, lastPt = null;

        // Project object to bitmap at the scan resolution
        const widthMm = obj.getScaledWidth() * MM_PER_PX;
        const heightMm = obj.getScaledHeight() * MM_PER_PX;
        if (!isFinite(widthMm) || !isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
            console.warn('Rasterize: invalid image dimensions', { widthMm, heightMm });
            return { lines, burnMm: 0, travelMm: 0, lastPt: { x: 0, y: 0 } };
        }
        // Cap internal bitmap to a browser-safe size; scale interval up if needed.
        const MAX_DIM = 6000;
        let pxPerMm = 1 / interval;
        let bw = Math.max(1, Math.round(widthMm * pxPerMm));
        let bh = Math.max(1, Math.round(heightMm * pxPerMm));
        if (bw > MAX_DIM || bh > MAX_DIM) {
            const shrink = Math.max(bw / MAX_DIM, bh / MAX_DIM);
            pxPerMm = pxPerMm / shrink;
            bw = Math.max(1, Math.round(widthMm * pxPerMm));
            bh = Math.max(1, Math.round(heightMm * pxPerMm));
            LCS.util.toast(`Image too large, scanning at ${(1 / pxPerMm).toFixed(2)} mm/line`, 'warn');
        }

        const off = document.createElement('canvas');
        off.width = bw; off.height = bh;
        const ctx = off.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, bw, bh);
        const src = obj._element || obj._originalElement;
        if (!src || !src.complete && src.naturalWidth === 0) {
            console.warn('Rasterize: image element not ready');
            return { lines, burnMm: 0, travelMm: 0, lastPt: { x: 0, y: 0 } };
        }
        try { ctx.drawImage(src, 0, 0, bw, bh); }
        catch (e) { console.error('drawImage failed', e); return { lines, burnMm: 0, travelMm: 0, lastPt: { x: 0, y: 0 } }; }

        let data;
        try { data = ctx.getImageData(0, 0, bw, bh).data; }
        catch (e) { console.error('getImageData failed (canvas tainted?)', e); return { lines, burnMm: 0, travelMm: 0, lastPt: { x: 0, y: 0 } }; }

        const worldLeft = obj.left;
        let forward = true;
        const feed = layer.speed;
        const yieldEvery = Math.max(1, Math.round(bh / 200)); // ~200 progress ticks over the image
        console.log(`[raster] ${bw}x${bh} px, interval ${(1/pxPerMm).toFixed(3)} mm`);

        for (let row = 0; row < bh; row++) {
            const yMmLocal = (row + 0.5) / pxPerMm;
            const yPx = obj.top + yMmLocal * PX_PER_MM;
            const grp = [];
            let cur = null;
            for (let x = 0; x < bw; x++) {
                const pi = (row * bw + x) * 4;
                const a = data[pi + 3];
                const L = 0.2126 * data[pi] + 0.7152 * data[pi + 1] + 0.0722 * data[pi + 2];
                const burn = a > 16 && L < 250;
                if (burn) {
                    const sv = Math.round(((255 - L) / 255) * S);
                    if (cur && Math.abs(cur.s - sv) < 2 && cur.x1 === x - 1) cur.x1 = x;
                    else { cur = { x0: x, x1: x, s: sv }; grp.push(cur); }
                } else { cur = null; }
            }
            if (grp.length) {
                const emitOrder = forward ? grp : grp.slice().reverse();
                for (const run of emitOrder) {
                    const startXmm = forward ? (run.x0 / pxPerMm) : ((run.x1 + 1) / pxPerMm);
                    const endXmm   = forward ? ((run.x1 + 1) / pxPerMm) : (run.x0 / pxPerMm);
                    const startPx = { x: worldLeft + startXmm * PX_PER_MM, y: yPx };
                    const endPx   = { x: worldLeft + endXmm   * PX_PER_MM, y: yPx };
                    const startMm = toMachineMm(startPx);
                    const endMm   = toMachineMm(endPx);
                    lines.push(dialect.rapid(startMm.x, startMm.y, m.travelFeed));
                    if (lastPt) travelMm += Math.hypot(startMm.x - lastPt.x, startMm.y - lastPt.y);
                    lines.push(`M4 S${run.s}`);
                    lines.push(`G1 X${endMm.x.toFixed(3)} Y${endMm.y.toFixed(3)} F${feed|0}`);
                    burnMm += Math.hypot(endMm.x - startMm.x, endMm.y - startMm.y);
                    lastPt = endMm;
                }
                lines.push(dialect.laserOff());
                forward = !forward;
            }
            // UNCONDITIONAL yield + progress update — don't lock the UI on blank rows
            if (row % yieldEvery === 0) {
                progress('Generating GCode', `Rasterizing ${layer.name} — row ${row}/${bh}`, 0.3 + (row / bh) * 0.5);
                await new Promise(r => setTimeout(r, 0));
            }
        }
        return { lines, burnMm, travelMm, lastPt: lastPt || { x: 0, y: 0 } };
    }

    // Export SVG (useful for LightBurn / Glowforge)
    function exportSvg() {
        const fab = LCS.canvas.fabric;
        // Temporarily remove bed & grid
        const hidden = fab.getObjects().filter(o => o._lcsBed || o._lcsGrid);
        hidden.forEach(o => o.excludeFromExport = true);
        // Recolor per layer opType: engrave => black fill, cut/score => stroke color (keep layer color)
        const originals = new Map();
        fab.getObjects().forEach(o => {
            if (o._lcsBed || o._lcsGrid) return;
            const { layer, opType } = opTypeOf(o);
            const orig = { fill: o.fill, stroke: o.stroke };
            originals.set(o, orig);
            if (opType === 'engrave') {
                o.set({ fill: 'black', stroke: 'black' });
            } else if (opType === 'cut') {
                o.set({ fill: 'transparent', stroke: 'red' });
            } else {
                o.set({ fill: 'transparent', stroke: layer.color });
            }
        });
        const m = LCS.state.machine();
        const svg = fab.toSVG({
            viewBox: { x: 0, y: 0, width: m.bedWidth * PX_PER_MM, height: m.bedHeight * PX_PER_MM },
            width: m.bedWidth + 'mm', height: m.bedHeight + 'mm',
        });
        originals.forEach((o, obj) => obj.set(o));
        fab.requestRenderAll();
        return svg;
    }

    LCS.gcode = { generate, exportSvg };
})();

// ============================================================
// LCS.preview — parse gcode + animate overlay
// ============================================================
(() => {
    const { PX_PER_MM } = LCS.config;

    let segments = [];
    let playing = false;
    let speed = 1;
    let progress = 0;      // mm progressed
    let rafId = null;
    let lastTs = 0;
    let totalMm = 0;
    let durationSec = 0;

    function parse(gcode) {
        const segs = [];
        let cx = 0, cy = 0, cf = 3000, cs = 0, laser = false, lastG = 0;
        const lines = gcode.split('\n');
        for (const raw of lines) {
            const line = raw.replace(/;.*$/, '').trim().toUpperCase();
            if (!line) continue;
            if (line.startsWith('M3') || line.startsWith('M4')) {
                laser = true;
                const mS = line.match(/S([-\d.]+)/);
                if (mS) cs = +mS[1];
                continue;
            }
            if (line.startsWith('M5')) { laser = false; continue; }
            let g = line.match(/^G(\d+)/);
            if (!g && (line.startsWith('X') || line.startsWith('Y'))) g = [null, lastG];
            if (!g) continue;
            const code = +g[1];
            lastG = code;
            const mX = line.match(/X([-\d.]+)/); const mY = line.match(/Y([-\d.]+)/);
            const mF = line.match(/F([-\d.]+)/); const mS = line.match(/S([-\d.]+)/);
            const nx = mX ? +mX[1] : cx, ny = mY ? +mY[1] : cy;
            if (mF) cf = +mF[1];
            if (mS) cs = +mS[1];
            const travel = code === 0 || !laser;
            if (mX || mY) {
                segs.push({ x1: cx, y1: cy, x2: nx, y2: ny, travel, s: cs, f: cf });
                cx = nx; cy = ny;
            }
        }
        return segs;
    }

    function open(gcode) {
        segments = parse(gcode);
        totalMm = segments.reduce((acc, s) => acc + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0);
        // approximate duration at speed 1x as sum(dist/feed)
        durationSec = segments.reduce((acc, s) => acc + Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / ((s.f || 3000) / 60), 0);
        progress = 0;
        document.getElementById('preview-strip').classList.add('visible');
        LCS.state.emit('preview:toggle');
        render();
        updateTimeLabel();
    }

    function close() {
        stop();
        document.getElementById('preview-strip').classList.remove('visible');
        LCS.state.emit('preview:toggle');
        LCS.preview.clearOverlay();
    }

    function play() {
        if (!segments.length) return;
        playing = true;
        document.getElementById('pv-play').style.display = 'none';
        document.getElementById('pv-pause').style.display = '';
        lastTs = performance.now();
        loop();
    }
    function pause() {
        playing = false;
        document.getElementById('pv-play').style.display = '';
        document.getElementById('pv-pause').style.display = 'none';
        if (rafId) cancelAnimationFrame(rafId);
    }
    function stop() {
        pause();
        progress = 0;
        render();
        updateTimeLabel();
    }
    function setSpeed(s) {
        speed = s;
        document.querySelectorAll('.pv-speed').forEach(b => b.classList.toggle('active', +b.dataset.speed === s));
    }

    function loop() {
        if (!playing) return;
        const now = performance.now();
        const dt = (now - lastTs) / 1000;
        lastTs = now;
        // advance mm based on average feed ~ 2000 mm/min; scale by speed multiplier
        const avgFeed = 2000; // mm/min average
        progress += (avgFeed / 60) * dt * speed;
        if (progress >= totalMm) { progress = totalMm; playing = false; document.getElementById('pv-play').style.display = ''; document.getElementById('pv-pause').style.display = 'none'; }
        render();
        updateTimeLabel();
        rafId = requestAnimationFrame(loop);
    }

    function seek(fraction) {
        progress = totalMm * fraction;
        render();
        updateTimeLabel();
    }

    function render() {
        const ov = LCS.canvas.overlay;
        if (!ov || !segments.length) return;
        const ctx = ov.getContext('2d');
        ctx.clearRect(0, 0, ov.width, ov.height);
        const fab = LCS.canvas.fabric;
        const vpt = fab.viewportTransform;
        const m = LCS.state.machine();
        // Map machine mm -> fabric px -> screen px
        const mmToScreen = (mm) => {
            let fabX = mm.x * PX_PER_MM;
            let fabY;
            if (m.origin === 'bottom-left') fabY = (m.bedHeight - mm.y) * PX_PER_MM;
            else if (m.origin === 'center') { fabX = (mm.x + m.bedWidth / 2) * PX_PER_MM; fabY = (m.bedHeight / 2 - mm.y) * PX_PER_MM; }
            else fabY = mm.y * PX_PER_MM;
            return { x: fabX * vpt[0] + vpt[4], y: fabY * vpt[3] + vpt[5] };
        };

        let acc = 0;
        for (const s of segments) {
            const segLen = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
            const after = acc + segLen;
            if (after < progress) {
                // full segment
                const p1 = mmToScreen({ x: s.x1, y: s.y1 });
                const p2 = mmToScreen({ x: s.x2, y: s.y2 });
                drawSeg(ctx, p1, p2, s, 1);
            } else if (acc <= progress && after >= progress) {
                // partial
                const t = (progress - acc) / segLen;
                const p1 = mmToScreen({ x: s.x1, y: s.y1 });
                const p2 = mmToScreen({ x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t });
                drawSeg(ctx, p1, p2, s, t);
            } else break;
            acc = after;
        }
        // laser head marker
        const head = headAt(progress);
        if (head) {
            const hs = mmToScreen(head);
            ctx.fillStyle = '#fef08a';
            ctx.strokeStyle = '#eab308';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(hs.x, hs.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        // seek bar
        const slider = document.getElementById('pv-seek');
        if (slider) slider.value = totalMm > 0 ? Math.round(progress / totalMm * 1000) : 0;
    }

    function drawSeg(ctx, p1, p2, s, t) {
        if (s.travel) {
            ctx.strokeStyle = 'rgba(148,163,184,0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
        } else {
            const intensity = Math.min(1, s.s / 1000);
            const hue = 20 - intensity * 20; // red-ish
            ctx.strokeStyle = `hsla(${hue},90%,${50 + (1 - intensity) * 20}%,0.9)`;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
        }
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }

    function headAt(mmProgress) {
        let acc = 0;
        for (const s of segments) {
            const segLen = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
            if (acc + segLen >= mmProgress) {
                const t = (mmProgress - acc) / (segLen || 1);
                return { x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t };
            }
            acc += segLen;
        }
        return null;
    }

    function updateTimeLabel() {
        const el = document.getElementById('pv-time');
        if (!el) return;
        const elapsed = (progress / totalMm) * durationSec || 0;
        const fmt = s => {
            s = Math.max(0, s | 0);
            return String(s / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
        };
        el.textContent = `${fmt(elapsed)} / ${fmt(durationSec)}`;
    }

    function clearOverlay() {
        const ov = LCS.canvas.overlay;
        if (!ov) return;
        ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
    }

    LCS.preview = { parse, open, close, play, pause, stop, setSpeed, seek, render, clearOverlay };
})();

// ============================================================
// LCS.history — undo/redo (debounced, flush-on-undo)
// ============================================================
(() => {
    const MAX = 30;
    const DELAY = 220;
    let stack = [];
    let idx = -1;
    let suppress = false;
    let pendingTimer = null;
    let pendingDirty = false;

    function init() {
        // Immediate initial snapshot
        snapshotNow();
        LCS.state.on('object:added',    () => scheduleSnapshot());
        LCS.state.on('object:removed',  () => scheduleSnapshot());
        LCS.state.on('object:modified', () => scheduleSnapshot());
        LCS.state.on('layers:changed',  () => scheduleSnapshot());
    }

    function scheduleSnapshot() {
        if (suppress) return;
        pendingDirty = true;
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => { pendingTimer = null; flushPending(); }, DELAY);
    }

    function flushPending() {
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        if (pendingDirty) { pendingDirty = false; snapshotNow(); }
    }

    function snapshotNow() {
        const fab = LCS.canvas.fabric;
        if (!fab) return;
        const data = {
            canvas: fab.toDatalessJSON(['objectId', 'layerId', 'opType', 'sourceType', '_imgParams', '_origSrc', '_origWidth', '_origHeight']),
            layers: JSON.parse(JSON.stringify(LCS.state.layers())),
            activeLayerId: LCS.state.get().activeLayerId,
        };
        // Drop any redo history after current point
        stack = stack.slice(0, idx + 1);
        stack.push(data);
        if (stack.length > MAX) stack.shift();
        idx = stack.length - 1;
    }

    function restore(data) {
        suppress = true;
        const fab = LCS.canvas.fabric;
        const state = LCS.state.get();
        state.layers.length = 0;
        data.layers.forEach(l => state.layers.push(l));
        state.activeLayerId = data.activeLayerId;
        fab.loadFromJSON(data.canvas, () => {
            LCS.canvas.drawBedBackground();
            LCS.grid.render();
            fab.requestRenderAll();
            LCS.state.emit('layers:changed');
            // clear any pending dirty flag caused by the load itself
            pendingDirty = false;
            if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
            suppress = false;
        });
    }

    function undo() {
        // Commit any pending edits first so the current state is recoverable via redo
        flushPending();
        if (idx > 0) { idx--; restore(stack[idx]); }
    }
    function redo() {
        flushPending();
        if (idx < stack.length - 1) { idx++; restore(stack[idx]); }
    }

    LCS.history = { init, snapshot: snapshotNow, flush: flushPending, undo, redo,
                    debug: () => ({ stack: stack.length, idx }) };
})();

// ============================================================
// LCS.ui — toolbar, tabs, properties, modals, shortcuts
// ============================================================
(() => {
    const { $, $$ } = LCS.util;

    function init() {
        wireTabs();
        wireToolbar();
        wireProperties();
        wireMachine();
        wirePreview();
        wireExportModal();
        wireShortcuts();
    }

    function wireTabs() {
        $$('.panel-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.panel-tab').forEach(t => t.classList.remove('active'));
                $$('.panel-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.querySelector(`.panel-pane[data-pane="${tab.dataset.tab}"]`).classList.add('active');
            });
        });
    }

    function wireToolbar() {
        $('#tb-import').addEventListener('click', () => $('#file-input').click());
        $('#tb-export').addEventListener('click', async () => {
            LCS.util.toast('Generating GCode...', '');
            const res = await LCS.gcode.generate();
            if (res) openExportModal(res);
        });
        $('#tb-undo').addEventListener('click', LCS.history.undo);
        $('#tb-redo').addEventListener('click', LCS.history.redo);
        $('#tb-zoom-in').addEventListener('click', () => LCS.canvas.setZoomCentered(LCS.canvas.getZoom() * 1.2));
        $('#tb-zoom-out').addEventListener('click', () => LCS.canvas.setZoomCentered(LCS.canvas.getZoom() / 1.2));
        $('#tb-zoom-fit').addEventListener('click', () => LCS.canvas.fitToBed());
        $('#tb-grid-toggle').addEventListener('click', () => {
            const s = LCS.state.get(); s.gridVisible = !s.gridVisible; LCS.grid.render();
            $('#tb-grid-toggle').classList.toggle('active', s.gridVisible);
        });
        $('#tb-snap-toggle').addEventListener('click', () => {
            const s = LCS.state.get(); s.snapEnabled = !s.snapEnabled;
            $('#tb-snap-toggle').classList.toggle('active', s.snapEnabled);
        });
        $('#tb-theme-toggle').addEventListener('click', () => LCS.theme.toggle());
        // Align & distribute
        $('#tb-align-left').addEventListener('click', () => LCS.align.align('left'));
        $('#tb-align-right').addEventListener('click', () => LCS.align.align('right'));
        $('#tb-align-cx').addEventListener('click', () => LCS.align.align('cx'));
        $('#tb-align-top').addEventListener('click', () => LCS.align.align('top'));
        $('#tb-align-bottom').addEventListener('click', () => LCS.align.align('bottom'));
        $('#tb-align-cy').addEventListener('click', () => LCS.align.align('cy'));
        $('#tb-dist-h').addEventListener('click', () => LCS.align.distribute('h'));
        $('#tb-dist-v').addEventListener('click', () => LCS.align.distribute('v'));

        $('#tool-delete').addEventListener('click', deleteSelection);
        $('#tb-settings').addEventListener('click', () => {
            // Jump to Machine tab
            document.querySelector('.panel-tab[data-tab="machine"]').click();
        });
        $('#tb-generate').addEventListener('click', async () => {
            const res = await LCS.gcode.generate();
            if (res) { LCS.preview.open(res.gcode); LCS.util.toast('Preview ready', 'success'); }
        });

        // Grid/snap toggles initial state
        $('#tb-grid-toggle').classList.toggle('active', LCS.state.get().gridVisible);
        $('#tb-snap-toggle').classList.toggle('active', LCS.state.get().snapEnabled);
    }

    function deleteSelection() {
        const fab = LCS.canvas.fabric;
        fab.getActiveObjects().forEach(o => {
            if (o._lcsBed || o._lcsGrid) return;
            fab.remove(o);
        });
        fab.discardActiveObject();
        fab.requestRenderAll();
    }

    function wireProperties() {
        const { $ } = LCS.util;
        LCS.state.on('selection:change', sel => updateProps(sel));

        const bindCommon = (id, fn) => {
            $(id).addEventListener('input', () => {
                const sel = LCS.canvas.fabric.getActiveObjects().filter(o => !o._lcsBed && !o._lcsGrid);
                if (!sel.length) return;
                sel.forEach(o => fn(o, $(id).value));
                LCS.canvas.fabric.requestRenderAll();
                LCS.state.emit('object:modified');
            });
        };
        bindCommon('#p-x', (o, v) => { o.left = +v * LCS.config.PX_PER_MM; o.setCoords(); });
        bindCommon('#p-y', (o, v) => {
            const m = LCS.state.machine();
            if (m.origin === 'bottom-left') o.top = (m.bedHeight - +v) * LCS.config.PX_PER_MM - o.getScaledHeight();
            else o.top = +v * LCS.config.PX_PER_MM;
            o.setCoords();
        });
        bindCommon('#p-w', (o, v) => { const sf = (+v * LCS.config.PX_PER_MM) / (o.width || 1); o.scaleX = sf; o.setCoords(); });
        bindCommon('#p-h', (o, v) => { const sf = (+v * LCS.config.PX_PER_MM) / (o.height || 1); o.scaleY = sf; o.setCoords(); });
        bindCommon('#p-rot', (o, v) => { o.rotate(+v); o.setCoords(); });
        bindCommon('#p-layer', (o, v) => {
            o.layerId = v;
            const layer = LCS.state.layers().find(l => l.id === v);
            if (layer) LCS.layers.applyLayerToObject(o, layer);
        });
        bindCommon('#p-optype', (o, v) => { o.opType = v || null; });

        // Image params
        const bindImg = (id, field, cast = v => v, valLabel) => {
            $(id).addEventListener('input', () => {
                const sel = LCS.canvas.fabric.getActiveObjects().filter(o => o.type === 'image');
                sel.forEach(o => {
                    if (!o._imgParams) o._imgParams = {};
                    o._imgParams[field] = cast($(id).value);
                    LCS.image.reprocess(o);
                });
                if (valLabel) $(valLabel).textContent = $(id).value;
            });
        };
        bindImg('#img-mode', 'mode');
        bindImg('#img-dither-algo', 'algo');
        bindImg('#img-threshold', 'threshold', v => +v, '#img-threshold-val');
        bindImg('#img-contrast', 'contrast', v => +v, '#img-contrast-val');
        bindImg('#img-brightness', 'brightness', v => +v, '#img-brightness-val');
        $('#img-invert').addEventListener('change', () => {
            const sel = LCS.canvas.fabric.getActiveObjects().filter(o => o.type === 'image');
            sel.forEach(o => {
                if (!o._imgParams) o._imgParams = {};
                o._imgParams.invert = $('#img-invert').checked;
                LCS.image.reprocess(o);
            });
        });
        $('#img-trace-btn').addEventListener('click', () => {
            const sel = LCS.canvas.fabric.getActiveObjects().filter(o => o.type === 'image');
            sel.forEach(o => LCS.image.traceToVector(o));
        });

        // Text
        const bindText = (id, fn) => $(id).addEventListener('input', () => {
            const sel = LCS.canvas.fabric.getActiveObjects().filter(o => o.type === 'i-text' || o.type === 'text' || o.type === 'textbox');
            sel.forEach(o => { fn(o, $(id).value); o.setCoords(); });
            LCS.canvas.fabric.requestRenderAll();
        });
        bindText('#t-content', (o, v) => o.set('text', v));
        bindText('#t-font', (o, v) => o.set('fontFamily', v));
        bindText('#t-size', (o, v) => o.set('fontSize', LCS.util.mmToPx(+v)));
        bindText('#t-weight', (o, v) => o.set('fontWeight', v));
    }

    function updateProps(sel) {
        const { $ } = LCS.util;
        const empty = $('#props-empty');
        const common = $('#props-common');
        const imgGroup = $('#props-image');
        const textGroup = $('#props-text');
        if (!sel.length) {
            empty.style.display = '';
            common.style.display = 'none';
            imgGroup.style.display = 'none';
            textGroup.style.display = 'none';
            return;
        }
        empty.style.display = 'none';
        common.style.display = '';
        const o = sel[0];
        $('#p-x').value = (o.left * LCS.config.MM_PER_PX).toFixed(1);
        const m = LCS.state.machine();
        const yMm = m.origin === 'bottom-left'
            ? (m.bedHeight - (o.top + o.getScaledHeight()) * LCS.config.MM_PER_PX)
            : o.top * LCS.config.MM_PER_PX;
        $('#p-y').value = yMm.toFixed(1);
        $('#p-w').value = (o.getScaledWidth() * LCS.config.MM_PER_PX).toFixed(1);
        $('#p-h').value = (o.getScaledHeight() * LCS.config.MM_PER_PX).toFixed(1);
        $('#p-rot').value = (o.angle || 0).toFixed(0);
        $('#p-layer').value = o.layerId || LCS.state.activeLayer().id;
        $('#p-optype').value = o.opType || '';

        imgGroup.style.display = (o.type === 'image' || o.type === 'Image') ? '' : 'none';
        if (o.type === 'image') {
            const p = o._imgParams || {};
            $('#img-mode').value = p.mode || 'grayscale';
            $('#img-dither-algo').value = p.algo || 'floyd';
            $('#img-threshold').value = p.threshold ?? 128; $('#img-threshold-val').textContent = $('#img-threshold').value;
            $('#img-contrast').value = p.contrast ?? 0; $('#img-contrast-val').textContent = $('#img-contrast').value;
            $('#img-brightness').value = p.brightness ?? 0; $('#img-brightness-val').textContent = $('#img-brightness').value;
            $('#img-invert').checked = !!p.invert;
        }
        textGroup.style.display = (o.type === 'i-text' || o.type === 'text' || o.type === 'textbox') ? '' : 'none';
        if (textGroup.style.display !== 'none') {
            $('#t-content').value = o.text || '';
            $('#t-font').value = o.fontFamily || 'Inter';
            $('#t-size').value = (o.fontSize * LCS.config.MM_PER_PX).toFixed(1);
            $('#t-weight').value = o.fontWeight || 'normal';
        }

        // Switch to Props tab when selecting
        document.querySelector('.panel-tab[data-tab="props"]').click();
    }

    function wireMachine() {
        const bind = (id, field, cast = v => v, update = true) => {
            $(id).addEventListener('input', () => {
                const m = LCS.state.machine();
                m[field] = cast($(id).value);
                if (update) {
                    LCS.canvas.drawBedBackground();
                    LCS.grid.render();
                    LCS.rulers.render();
                }
            });
        };
        bind('#m-bw', 'bedWidth', v => +v);
        bind('#m-bh', 'bedHeight', v => +v);
        bind('#m-origin', 'origin');
        bind('#m-dialect', 'dialect');
        bind('#m-travel', 'travelFeed', v => +v, false);
        bind('#m-interval', 'rasterInterval', v => +v, false);
        bind('#m-smax', 'smax', v => +v, false);
        bind('#m-grid', 'gridSpacing', v => +v);
        bind('#m-snap', 'snapTolerance', v => +v, false);
    }

    function wirePreview() {
        $('#pv-play').addEventListener('click', LCS.preview.play);
        $('#pv-pause').addEventListener('click', LCS.preview.pause);
        $('#pv-stop').addEventListener('click', LCS.preview.stop);
        $('#pv-close').addEventListener('click', LCS.preview.close);
        $('#pv-seek').addEventListener('input', e => LCS.preview.seek(+e.target.value / 1000));
        document.querySelectorAll('.pv-speed').forEach(b => b.addEventListener('click', () => LCS.preview.setSpeed(+b.dataset.speed)));
    }

    function wireExportModal() {
        $('#export-close').addEventListener('click', () => LCS.util.modal('export-modal', false));
        $('#export-download').addEventListener('click', () => {
            const name = ($('#export-name').value || 'job').replace(/\.[^.]+$/, '');
            const ext = $('#export-ext').value;
            const includeComments = $('#export-comments').checked;
            let text = LCS.state.get().gcode || '';
            if (!includeComments) text = text.split('\n').filter(l => !l.trim().startsWith(';')).join('\n');
            LCS.util.download(name + ext, text, 'text/plain');
            LCS.util.modal('export-modal', false);
            LCS.util.toast('GCode downloaded', 'success');
        });
        $('#export-svg-btn').addEventListener('click', () => {
            const svg = LCS.gcode.exportSvg();
            const name = ($('#export-name').value || 'job').replace(/\.[^.]+$/, '');
            LCS.util.download(name + '.svg', svg, 'image/svg+xml');
        });
    }

    function openExportModal(res) {
        const { gcode, stats } = res;
        const preview = gcode.split('\n').slice(0, 40).join('\n');
        $('#export-preview').textContent = preview + (gcode.split('\n').length > 40 ? '\n...' : '');
        $('#export-stats').innerHTML = `
            <div>Lines: ${stats.totalLines}</div>
            <div>Burn: ${stats.burnMm.toFixed(1)} mm</div>
            <div>Travel: ${stats.travelMm.toFixed(1)} mm</div>
            <div>Estimated time: ${formatTime(stats.durationSec)}</div>
        `;
        LCS.util.modal('export-modal', true);
    }

    function formatTime(s) {
        s = Math.max(0, s | 0);
        const h = s / 3600 | 0;
        const m = (s % 3600) / 60 | 0;
        const sec = s % 60;
        return (h ? `${h}h ` : '') + `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    function wireShortcuts() {
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (e.ctrlKey || e.metaKey) {
                const k = e.key.toLowerCase();
                if (k === 'z' && !e.shiftKey) { e.preventDefault(); LCS.history.undo(); }
                else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); LCS.history.redo(); }
                else if (k === 'a') { e.preventDefault(); LCS.selection.selectAll(); }
                else if (k === 'g' && !e.shiftKey) { e.preventDefault(); LCS.selection.group(); }
                else if (k === 'g' &&  e.shiftKey) { e.preventDefault(); LCS.selection.ungroup(); }
                else if (k === 'd') {
                    e.preventDefault();
                    const fab = LCS.canvas.fabric;
                    fab.getActiveObjects().forEach(o => {
                        o.clone(clone => {
                            clone.set({ left: o.left + 10, top: o.top + 10 });
                            LCS.objects.addToCanvas(clone, LCS.state.layers().find(l => l.id === o.layerId) || LCS.state.activeLayer());
                        }, ['objectId', 'layerId', 'opType', 'sourceType', '_imgParams', '_origSrc']);
                    });
                }
                return;
            }
            switch (e.key.toLowerCase()) {
                case 'v': LCS.shapes.setTool('select'); break;
                case 'r': LCS.shapes.setTool('rect'); break;
                case 'c': LCS.shapes.setTool('circle'); break;
                case 'l': LCS.shapes.setTool('line'); break;
                case 't': LCS.shapes.setTool('text'); break;
                case 'p': LCS.shapes.setTool('pen'); break;
                case 'n': LCS.shapes.setTool('node'); break;
                case 'f': LCS.canvas.fitToBed(); break;
                case 'g': $('#tb-grid-toggle').click(); break;
                case 's': $('#tb-snap-toggle').click(); break;
                case 'delete': case 'backspace': deleteSelection(); break;
                case 'escape':
                    if (LCS.shapes.endPen) LCS.shapes.endPen(true);
                    LCS.shapes.setTool('select');
                    break;
            }
        });
    }

    LCS.ui = { init, updateProps, openExportModal };
})();

// ============================================================
// LCS.main — boot
// ============================================================
(() => {
    window.addEventListener('DOMContentLoaded', () => {
        LCS.theme.init();
        LCS.canvas.init();
        LCS.rulers.init();
        LCS.grid.render();
        LCS.layers.init();
        LCS.shapes.init();
        LCS.image.init();
        LCS.ui.init();
        LCS.history.init();
        if (window.lucide) lucide.createIcons();
        LCS.util.toast('Ready', 'success');
    });
})();
