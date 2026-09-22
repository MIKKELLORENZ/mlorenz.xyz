/* Neural Architect — interact.js
 *
 * NA.selection (what is selected, and the batch operations on it), NA.interact
 * (the pointer state machine: pan, drag, marquee, wiring at block and neuron
 * level, pinch) and NA.history (snapshot undo/redo + autosave).
 */
'use strict';

// ============================================================
// NA.selection
// ============================================================
(() => {
    const { bus } = NA.util;
    const state = { blocks: new Set(), edges: new Set(), neuronEdges: new Set(), neurons: new Map(), groups: new Set() };
    const halo = { v: 1 };
    function emit() { bus.emit('selection:change'); }
    function clear(silent) { state.blocks.clear(); state.edges.clear(); state.neuronEdges.clear(); state.neurons.clear(); state.groups.clear(); if (!silent) emit(); }
    function isEmpty() { return !state.blocks.size && !state.edges.size && !state.neuronEdges.size && !state.neurons.size && !state.groups.size; }
    function selectBlocks(ids, additive = false) {
        if (!additive) clear(true);
        for (const id of ids) state.blocks.add(id);
        NA.anim.spring(halo, 'v', 1, { from: 0, k: 180, c: 18 }); NA.selection.halo = 0;
        emit();
    }
    function toggleBlock(id) { if (state.blocks.has(id)) state.blocks.delete(id); else state.blocks.add(id); emit(); }
    function selectEdge(id, additive = false) { if (!additive) clear(true); state.edges.add(id); emit(); }
    function selectNeuronEdge(id, additive = false) { if (!additive) clear(true); state.neuronEdges.add(id); emit(); }
    function selectGroup(gr, additive = false) { if (!additive) clear(true); state.groups.add(gr.id); for (const id of gr.blocks) state.blocks.add(id); emit(); }
    function selectNeurons(blockId, idxs, additive = false) {
        if (!additive) clear(true);
        const set = state.neurons.get(blockId) || new Set();
        for (const i of idxs) set.add(i);
        if (set.size) state.neurons.set(blockId, set); emit();
    }
    // Replace the neuron selection without touching the selected blocks (the inspector's neuron list)
    function setNeurons(blockId, idxs) { state.neurons.clear(); if (idxs.length) state.neurons.set(blockId, new Set(idxs)); emit(); }
    function toggleNeuron(blockId, idx) { const set = state.neurons.get(blockId) || new Set(); if (set.has(idx)) set.delete(idx); else set.add(idx); if (set.size) state.neurons.set(blockId, set); else state.neurons.delete(blockId); emit(); }
    function selectAll() { clear(true); for (const b of NA.model.graph().blocks) state.blocks.add(b.id); emit(); }
    // Drop ids that no longer exist (after undo, delete, navigation)
    function prune() {
        const g = NA.model.graph(); const ids = new Set(g.blocks.map(b => b.id));
        for (const id of [...state.blocks]) if (!ids.has(id)) state.blocks.delete(id);
        const eids = new Set(g.edges.map(e => e.id)); for (const id of [...state.edges]) if (!eids.has(id)) state.edges.delete(id);
        const nids = new Set(g.neuronEdges.map(e => e.id)); for (const id of [...state.neuronEdges]) if (!nids.has(id)) state.neuronEdges.delete(id);
        for (const id of [...state.neurons.keys()]) if (!ids.has(id)) state.neurons.delete(id);
        const gids = new Set(g.groups.map(x => x.id)); for (const id of [...state.groups]) if (!gids.has(id)) state.groups.delete(id);
        emit();
    }
    function blocks() { const g = NA.model.graph(); return [...state.blocks].map(id => NA.model.block(id, g)).filter(Boolean); }
    // World bounds of everything selected (for the floating toolbar)
    function bounds() {
        const g = NA.model.graph(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const add = (x, y, w = 0, h = 0) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
        for (const b of blocks()) { const r = NA.model.rect(b, g); add(r.x, r.y, r.w, r.h); }
        for (const [id, set] of state.neurons) { const b = NA.model.block(id, g); if (!b) continue; const L = NA.model.neuronLayout(b); for (const i of set) { const c = NA.model.neuronCenter(b, i, L); if (c) add(c.x - L.pitch / 2, c.y - L.pitch / 2, L.pitch, L.pitch); } }
        for (const id of state.edges) { const e = g.edges.find(x => x.id === id); const p = e && NA.model.edgeEndpoints(e, g); if (p) { const m = NA.render.bezPt(NA.render.wire(p.x1, p.y1, p.x2, p.y2), 0.5); add(m.x - 10, m.y - 10, 20, 20); } }
        for (const id of state.neuronEdges) { const e = g.neuronEdges.find(x => x.id === id); if (e && e._geom) { const m = NA.render.bezPt(e._geom, 0.5); add(m.x - 10, m.y - 10, 20, 20); } }
        if (x0 === Infinity) return null;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    // Neuron selection as sorted list per block
    function neuronRanges() { return [...state.neurons].map(([id, set]) => ({ block: NA.model.block(id), idxs: [...set].sort((a, b) => a - b) })).filter(x => x.block); }

    // ---- batch operations ----
    function deleteSelected() {
        if (state.blocks.size) NA.model.removeBlocks([...state.blocks]);
        if (state.edges.size) NA.model.removeEdges([...state.edges]);
        if (state.neuronEdges.size) NA.model.removeNeuronEdges([...state.neuronEdges]);
        for (const id of state.groups) NA.model.removeGroup(id);
        clear();
    }
    function duplicate() {
        const g = NA.model.graph(); const src = blocks(); if (!src.length) return;
        const map = new Map(); const ids = [];
        for (const b of src) { const c = NA.model.makeBlock(b.kind, b.title, Object.assign({}, NA.model.strip(b), { id: undefined, pos: { x: b.pos.x + 40, y: b.pos.y + 40 } })); g.blocks.push(c); map.set(b.id, c.id); ids.push(c.id); }
        for (const e of g.edges.slice()) if (map.has(e.from.block) && map.has(e.to.block)) g.edges.push(NA.model.makeEdge(map.get(e.from.block), map.get(e.to.block), e.from.port, e.to.port));
        for (const n of g.neuronEdges.slice()) if (map.has(n.from.block) && map.has(n.to.block)) g.neuronEdges.push({ id: NA.util.uid('n'), from: { block: map.get(n.from.block), idx: n.from.idx }, to: { block: map.get(n.to.block), idx: n.to.idx }, init: n.init, comment: n.comment });
        NA.graph.refresh(); NA.model.emit('add', { ids });
        selectBlocks(ids);
    }
    // Insert a kind after every selected block that has a plain output (re-routing its outgoing edges)
    function insertAfterSelected(kind, opts = {}) {
        const ids = [];
        for (const b of blocks()) { if (b.kind === 'output' || b.kind === 'module_out') continue; const nb = NA.model.insertAfter(b.id, kind, opts); if (nb) ids.push(nb.id); }
        if (ids.length) { NA.util.toast(`Inserted ${ids.length} × ${NA.catalogue.get(kind).label}`); selectBlocks(ids); }
    }
    // Activation on the selected wires — or on every wire leaving the selected blocks
    function setActivation(act) {
        const g = NA.model.graph(); let ids = [...state.edges];
        if (!ids.length) for (const b of blocks()) ids.push(...NA.model.outgoingEdges(b.id, g).map(e => e.id));
        if (!ids.length) return NA.util.toast('Select a wire, or a block that is wired to something', 'warn');
        const n = NA.model.setActivation(ids, act);
        NA.util.toast(act ? `${NA.catalogue.ACT[act].label} on ${n} wire${n > 1 ? 's' : ''}` : `Activation removed from ${n} wire${n > 1 ? 's' : ''}`);
    }
    // Dropout probability on every selected block's output (training only)
    function setDropout(p) {
        const bs = blocks().filter(b => b.kind !== 'output' && b.kind !== 'module_out' && b.kind !== 'module_in');
        if (!bs.length) return NA.util.toast('Select blocks with an output', 'warn');
        p = Math.min(0.95, Math.max(0, +p || 0));
        for (const b of bs) NA.model.updateBlock(b.id, { dropout: p });
        NA.util.toast(p ? `Dropout ${p} on ${bs.length} block${bs.length > 1 ? 's' : ''} (training only)` : `Dropout removed from ${bs.length} block${bs.length > 1 ? 's' : ''}`);
    }
    // Residual skip: two selected blocks on one path → Add after the later one fed by the earlier
    function addResidual() {
        const bs = blocks(); if (bs.length !== 2) return NA.util.toast('Select exactly two blocks on one path', 'warn');
        const g = NA.model.graph();
        let [a, c] = bs; if (!NA.graph.reaches(g, a.id, c.id)) [a, c] = [c, a];
        if (!NA.graph.reaches(g, a.id, c.id)) return NA.util.toast('The two blocks are not on one path', 'warn');
        const add = NA.model.insertAfter(c.id, 'add', { title: 'Residual' });
        const r = NA.model.addEdge({ block: a.id, port: 'out' }, { block: add.id, port: 'in:1' });
        if (r.error) NA.util.toast(r.error, 'warn');
        NA.layout && selectBlocks([add.id]);
    }
    function groupFrame(name) {
        const ids = [...state.blocks]; if (!ids.length) return;
        const gr = NA.model.addGroup(name || 'Group', ids); selectGroup(gr);
    }
    function groupModule(name) {
        const ids = [...state.blocks]; if (!ids.length) return;
        const r = NA.model.groupIntoModule(ids, name || 'Module');
        if (r.error) return NA.util.toast(r.error, 'warn');
        if (r.droppedNeuronEdges) NA.util.toast(`${r.droppedNeuronEdges} neuron edge(s) crossing the boundary were dropped`, 'warn');
        selectBlocks([r.instance.id]);
    }
    function ungroup() {
        const bs = blocks().filter(b => b.kind === 'module'); if (!bs.length) { for (const id of [...state.groups]) NA.model.removeGroup(id); clear(); return; }
        const ids = []; for (const b of bs) { const r = NA.model.ungroupModule(b.id); if (r.ids) ids.push(...r.ids); else NA.util.toast(r.error, 'warn'); }
        selectBlocks(ids);
    }
    // Turn the selected neuron range into a region
    function annotateRange(name) {
        const rs = neuronRanges(); if (!rs.length) return;
        for (const { block, idxs } of rs) {
            const r = NA.model.addRegion(block.id, { name: name || 'Region', start: idxs[0], end: idxs[idxs.length - 1] + 1 });
            if (r.error) NA.util.toast(r.error, 'warn');
        }
        emit();
    }
    // Fan-out: every selected neuron → target neurons [start, start+n)
    function connectNeurons(targetBlockId, targetStart, mode = 'one-to-one', init = null) {
        const rs = neuronRanges(); if (!rs.length) return 0;
        const list = [];
        for (const { block, idxs } of rs) idxs.forEach((i, j) => {
            if (mode === 'all-to-one') list.push({ from: { block: block.id, idx: i }, to: { block: targetBlockId, idx: targetStart }, init });
            else list.push({ from: { block: block.id, idx: i }, to: { block: targetBlockId, idx: targetStart + j }, init });
        });
        const tb = NA.model.block(targetBlockId); const n = NA.model.effectiveSize(tb) || 0;
        const ok = list.filter(x => x.to.idx < n);
        const added = NA.model.addNeuronEdges(ok);
        NA.util.toast(`${added} neuron edge${added === 1 ? '' : 's'} added`);
        return added;
    }
    function clearNeuronEdges() {
        const g = NA.model.graph(); const ids = [];
        for (const [id, set] of state.neurons) for (const n of g.neuronEdges) if ((n.from.block === id && set.has(n.from.idx)) || (n.to.block === id && set.has(n.to.idx))) ids.push(n.id);
        if (ids.length) { NA.model.removeNeuronEdges(ids); NA.util.toast(`Removed ${ids.length} neuron edges`); }
    }
    // Header buttons / commands: 'collapse' toggles title-only, 'layout' cycles list → grid → rows
    function toggleBlockUi(blockId, what) {
        const b = NA.model.block(blockId); if (!b) return;
        if (what === 'collapse') NA.model.updateBlock(blockId, { ui: { collapsed: !b.ui.collapsed } });
        else { const L = NA.model.LAYOUTS; NA.model.updateBlock(blockId, { ui: { layout: L[(L.indexOf(NA.model.resolvedLayout(b)) + 1) % L.length] } }); }
    }
    function toggleSelectedUi(what) { for (const b of blocks()) toggleBlockUi(b.id, what); }
    function setColor(color) {
        for (const id of state.blocks) NA.model.updateBlock(id, { color });
        for (const id of state.groups) NA.model.updateGroup(id, { color });
        for (const [id, set] of state.neurons) for (const i of set) NA.model.setNeuron(id, i, { color });
    }
    bus.on('model:change', (e) => { if (e.type !== 'transient') prune(); });
    NA.selection = { state, halo: 1, clear, isEmpty, selectBlocks, toggleBlock, selectEdge, selectNeuronEdge, selectGroup, selectNeurons, setNeurons, toggleNeuron, selectAll, prune, blocks, bounds, neuronRanges,
                     deleteSelected, duplicate, insertAfterSelected, setActivation, setDropout, addResidual, groupFrame, groupModule, ungroup, annotateRange, connectNeurons, clearNeuronEdges, setColor, toggleBlockUi, toggleSelectedUi };
    // Halo spring writes to NA.selection.halo via the object above
    Object.defineProperty(NA.selection, 'halo', { get() { return halo.v; }, set(v) { halo.v = v; } });
})();

// ============================================================
// NA.interact — pointer state machine, tools, wheel, touch
// ============================================================
(() => {
    const cfg = NA.config;
    const { clamp, bus, toast } = NA.util;
    let stage; let tool = 'select'; let space = false;
    let hover = null;                    // last hit under the cursor (+ dropTarget when wiring)
    let st = null;                       // current gesture
    const pointers = new Map();          // active pointers (touch)
    let pinch = null;
    let marquee = null, ghost = null;
    // A marquee started on a neuron row, or drawn entirely inside one block's dot area at dot LOD, selects neurons of that block
    function marqueeHost(s, m) {
        if (s.neuronHost && NA.model.neuronLayout(s.neuronHost)) return s.neuronHost;
        const z = NA.canvas.view.z;
        return NA.model.graph().blocks.find(b => { const a = NA.model.dotsRect(b); const L = a && NA.model.neuronLayout(b); return L && L.pitch * z >= cfg.LOD.DOTS_MIN_PX && m.x >= a.x - 4 && m.y >= a.y - 4 && m.x + m.w <= a.x + a.w + 4 && m.y + m.h <= a.y + a.h + 4; }) || null;
    }
    // Neuron indices whose cell intersects the marquee rect
    function rowsIn(host, m) {
        const L = NA.model.neuronLayout(host); const idxs = []; if (!L) return idxs;
        for (let i = 0; i < L.count; i++) {
            const col = i % L.cols, row = Math.floor(i / L.cols); const cx0 = L.x0 + col * L.cellW, cy0 = L.y0 + row * L.pitch;
            if (cx0 < m.x + m.w && cx0 + L.cellW > m.x && cy0 < m.y + m.h && cy0 + L.pitch > m.y) idxs.push(L.start + i);
        }
        return idxs;
    }
    const samples = [];                  // for inertia
    const DRAG_PX = 4;

    function setTool(t) { tool = t; bus.emit('tool:change', t); updateCursor(); }
    function pos(e) { const r = stage.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
    function updateCursor() {
        let c = 'default';
        if (space || tool === 'hand') c = st && st.kind === 'pan' ? 'grabbing' : 'grab';
        else if (tool === 'wire') c = 'crosshair';
        else if (hover) { if (hover.type === 'port' || (hover.type === 'neuron' && (hover.onDot || tool === 'wire'))) c = 'crosshair'; else if (hover.type === 'neuron') c = 'cell'; else if (hover.type === 'block' || hover.type === 'group') c = st && st.kind === 'dragBlocks' ? 'grabbing' : 'default'; else if (hover.type === 'strip-row' || hover.type === 'edge' || hover.type === 'neuronEdge') c = 'pointer'; }
        if (st && st.kind === 'dragBlocks') c = 'grabbing';
        stage.style.cursor = c;
    }
    function setHover(h) { hover = h; NA.canvas.invalidate('overlay'); if (h && (h.type === 'edge' || h.type === 'neuronEdge' || h.type === 'block' || h.type === 'port' || h.type === 'strip-row' || h.type === 'neuron')) NA.canvas.invalidate('scene'); updateCursor(); }

    function init() {
        stage = NA.canvas.stage;
        stage.addEventListener('pointerdown', onDown);
        stage.addEventListener('pointermove', onMove);
        stage.addEventListener('pointerup', onUp);
        stage.addEventListener('pointercancel', onUp);
        stage.addEventListener('pointerleave', () => { if (!st) setHover(null); });
        stage.addEventListener('wheel', onWheel, { passive: false });
        stage.addEventListener('dblclick', onDbl);
        stage.addEventListener('contextmenu', onCtx);
        window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping() && !space) { space = true; updateCursor(); e.preventDefault(); } });
        window.addEventListener('keyup', (e) => { if (e.code === 'Space') { space = false; updateCursor(); } });
        window.addEventListener('blur', () => { space = false; });
        bus.on('model:change', () => { if (hover && !st) refreshHover(); });
    }
    const isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
    let lastSx = 0, lastSy = 0;
    function refreshHover() { setHover(NA.hit.test(lastSx, lastSy)); }

    // ---------- down ----------
    function onDown(e) {
        if (e.target !== NA.canvas.stage && !e.target.matches('#scene, #overlay')) return;
        NA.ui && NA.ui.closePopups();
        const { sx, sy } = pos(e);
        stage.setPointerCapture(e.pointerId);
        NA.canvas.stopInertia();
        if (e.pointerType === 'touch') {
            pointers.set(e.pointerId, { sx, sy });
            if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d0: Math.hypot(a.sx - b.sx, a.sy - b.sy), z0: NA.canvas.view.z, cx: (a.sx + b.sx) / 2, cy: (a.sy + b.sy) / 2, vx: NA.canvas.view.x, vy: NA.canvas.view.y }; st = { kind: 'pinch' }; return; }
        }
        const hit = NA.hit.test(sx, sy);
        const additive = e.shiftKey;
        const world = NA.canvas.toWorld(sx, sy);
        samples.length = 0;
        // Right button: drag pans; a click without movement opens the context menu on pointerup
        if (e.button === 2) { st = { kind: 'pan', sx, sy, moved: false, right: true, cx: e.clientX, cy: e.clientY }; pushSample(sx, sy); updateCursor(); return; }
        if (e.button === 1 || space || tool === 'hand' || (e.pointerType === 'touch' && hit.type === 'empty') || (e.button === 0 && e.altKey && hit.type === 'empty')) { st = { kind: 'pan', sx, sy, moved: false }; pushSample(sx, sy); updateCursor(); return; }
        if (e.button !== 0) return;
        switch (hit.type) {
            case 'port': st = { kind: 'wirePort', from: hit, sx, sy, moved: false }; break;
            case 'neuron':
                if (tool === 'wire') st = { kind: 'wireNeuron', from: hit, sx, sy, moved: true };
                else if (hit.onDot) st = { kind: 'neuronPress', hit, sx, sy, moved: false, additive };
                else st = { kind: 'marquee', sx, sy, wx: world.x, wy: world.y, additive, moved: false, neuronHost: hit.block, neuronHit: hit };
                break;
            case 'strip-row': st = { kind: 'stripPress', hit }; break;
            case 'block': {
                if (hit.button && tool !== 'wire') { st = { kind: 'btnPress', hit }; break; }
                if (tool === 'wire') { st = { kind: 'wirePort', from: { type: 'port', block: hit.block, port: NA.model.portPos(hit.block, 'out') || { id: 'out', dir: 'out', x: world.x, y: world.y } }, sx, sy, moved: false }; break; }
                const sel = NA.selection.state;
                if (!sel.blocks.has(hit.block.id)) { if (additive) NA.selection.toggleBlock(hit.block.id); else NA.selection.selectBlocks([hit.block.id]); }
                else if (additive) { NA.selection.toggleBlock(hit.block.id); st = null; return; }
                NA.model.bringToFront(hit.block.id);
                const ids = [...NA.selection.state.blocks];
                st = { kind: 'dragBlocks', ids, start: new Map(ids.map(id => [id, { ...NA.model.block(id).pos }])), sx, sy, moved: false, alt: e.altKey, wx: world.x, wy: world.y };
                break;
            }
            case 'edge': if (additive) { NA.selection.state.edges.has(hit.edge.id) ? NA.selection.state.edges.delete(hit.edge.id) : NA.selection.state.edges.add(hit.edge.id); bus.emit('selection:change'); } else NA.selection.selectEdge(hit.edge.id); st = { kind: 'click' }; break;
            case 'neuronEdge': NA.selection.selectNeuronEdge(hit.edge.id, additive); st = { kind: 'click' }; break;
            case 'group': {
                NA.selection.selectGroup(hit.group, additive);
                const ids = [...NA.selection.state.blocks];
                st = { kind: 'dragBlocks', ids, start: new Map(ids.map(id => [id, { ...NA.model.block(id).pos }])), sx, sy, moved: false, wx: world.x, wy: world.y };
                break;
            }
            default: st = { kind: 'marquee', sx, sy, wx: world.x, wy: world.y, additive, moved: false };
        }
        updateCursor();
    }
    // A single dragged vector Input overlapping (or nearly touching) another vector Input
    function mergeCandidate(ids) {
        if (ids.length !== 1) return null;
        const g = NA.model.graph(); const b = NA.model.block(ids[0], g);
        if (!b || b.kind !== 'input' || NA.util.parseShape(b.params.shape).length !== 1) return null;
        const r = NA.model.rect(b, g); const pad = 12;
        const other = g.blocks.find(o => o.id !== b.id && o.kind === 'input' && NA.util.parseShape(o.params.shape).length === 1 && (() => { const q = NA.model.rect(o, g); return r.x < q.x + q.w + pad && r.x + r.w > q.x - pad && r.y < q.y + q.h + pad && r.y + r.h > q.y - pad; })());
        return other ? { source: b, target: other } : null;
    }
    function pushSample(sx, sy) { samples.push({ sx, sy, t: performance.now() }); if (samples.length > 6) samples.shift(); }

    // ---------- move ----------
    function onMove(e) {
        const { sx, sy } = pos(e); lastSx = sx; lastSy = sy;
        if (e.pointerType === 'touch' && pointers.has(e.pointerId)) pointers.set(e.pointerId, { sx, sy });
        if (!st) { setHover(NA.hit.test(sx, sy)); return; }
        const dx = sx - st.sx, dy = sy - st.sy;
        if (st.moved === false && Math.hypot(dx, dy) > DRAG_PX) st.moved = true;
        switch (st.kind) {
            case 'pinch': {
                if (pointers.size < 2) return; const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.sx - b.sx, a.sy - b.sy); const cx = (a.sx + b.sx) / 2, cy = (a.sy + b.sy) / 2;
                const v = NA.canvas.view; const nz = clamp(pinch.z0 * d / pinch.d0, cfg.ZOOM.MIN, cfg.ZOOM.MAX);
                v.z = nz; v.x = pinch.vx + pinch.cx / pinch.z0 - cx / nz; v.y = pinch.vy + pinch.cy / pinch.z0 - cy / nz;
                bus.emit('view:change'); NA.canvas.invalidate('all'); return;
            }
            case 'pan': NA.canvas.panBy(sx - (st.lx ?? st.sx), sy - (st.ly ?? st.sy)); st.lx = sx; st.ly = sy; pushSample(sx, sy); return;
            case 'dragBlocks': {
                if (!st.moved) return;
                if (st.alt && !st.duplicated) { st.duplicated = true; NA.selection.duplicate(); st.ids = [...NA.selection.state.blocks]; st.start = new Map(st.ids.map(id => [id, { x: NA.model.block(id).pos.x - 40, y: NA.model.block(id).pos.y - 40 }])); }
                const z = NA.canvas.view.z; const snap = NA.model.get().settings.snap && !e.altKey;
                for (const id of st.ids) { const b = NA.model.block(id); const s = st.start.get(id); if (!b || !s) continue; let nx = s.x + dx / z, ny = s.y + dy / z; if (snap) { const p = NA.model.snapPos(nx, ny); nx = p.x; ny = p.y; } b.pos.x = nx; b.pos.y = ny; }
                st.lanes = snap;
                st.merge = mergeCandidate(st.ids);
                if (NA.ui && NA.ui.mergeHint) NA.ui.mergeHint(st.merge, sx, sy);
                NA.model.emit('transient', { ids: st.ids }); return;
            }
            case 'marquee': {
                if (!st.moved) return;
                const w = NA.canvas.toWorld(sx, sy);
                marquee = { x: Math.min(st.wx, w.x), y: Math.min(st.wy, w.y), w: Math.abs(w.x - st.wx), h: Math.abs(w.y - st.wy) };
                const host = marqueeHost(st, marquee);
                if (host) marquee.rows = { block: host, idxs: rowsIn(host, marquee) };
                NA.canvas.invalidate('overlay'); return;
            }
            case 'neuronPress': if (st.moved) { st = { kind: 'wireNeuron', from: st.hit, sx: st.sx, sy: st.sy, moved: true }; } else return; // fallthrough to wireNeuron on next move
            // eslint-disable-next-line no-fallthrough
            case 'wireNeuron': {
                const w = NA.canvas.toWorld(sx, sy); const h = NA.hit.test(sx, sy);
                const a = NA.model.neuronCenter(st.from.block, st.from.idx);
                let valid = false, x2 = w.x, y2 = w.y, drop = null;
                if (h.type === 'neuron' && h.block.id !== st.from.block.id) { const c = NA.model.neuronCenter(h.block, h.idx); if (c) { x2 = c.x; y2 = c.y; valid = true; } }
                else if ((h.type === 'block' || h.type === 'strip-row') && h.block.id !== st.from.block.id && NA.model.effectiveSize(h.block) !== null) { valid = true; drop = h.block.id; }
                ghost = { kind: 'neuron', x1: a ? a.x : w.x, y1: a ? a.y : w.y, x2, y2, valid };
                h.dropTarget = drop; setHover(h); return;
            }
            case 'wirePort': {
                if (!st.moved) return;
                const w = NA.canvas.toWorld(sx, sy); const h = NA.hit.test(sx, sy);
                const from = st.from; const reverse = from.port.dir === 'in';
                let valid = false, x2 = w.x, y2 = w.y, drop = null;
                if (h.type === 'port' && h.block.id !== from.block.id && h.port.dir !== from.port.dir) { x2 = h.port.x; y2 = h.port.y; valid = true; }
                else if ((h.type === 'block' || h.type === 'neuron' || h.type === 'strip-row') && h.block.id !== from.block.id) {
                    const target = reverse ? NA.model.portPos(h.block, 'out') : freeInput(h.block);
                    if (target) { x2 = target.x; y2 = target.y; valid = true; drop = h.block.id; }
                }
                ghost = { kind: 'port', x1: from.port.x, y1: from.port.y, x2, y2, valid, reverse };
                h.dropTarget = drop; setHover(h); return;
            }
        }
    }
    function freeInput(b) { const g = NA.model.graph(); const ids = NA.model.inputPortIds(b, g); const free = ids.find(id => !g.edges.some(e => e.to.block === b.id && e.to.port === id)) || ids[0]; return free ? NA.model.portPos(b, free, g) : null; }

    // ---------- up ----------
    function onUp(e) {
        const { sx, sy } = pos(e);
        if (e.pointerType === 'touch') { pointers.delete(e.pointerId); if (st && st.kind === 'pinch') { if (pointers.size < 2) { st = null; pinch = null; } return; } }
        if (!st) return;
        const s = st; st = null; ghost = null;
        switch (s.kind) {
            case 'pan': {
                if (s.right) { if (!s.moved) openContext(sx, sy, s.cx, s.cy); break; }
                if (!s.moved) { if (!e.shiftKey && tool !== 'hand') NA.selection.clear(); }
                else { const now = performance.now(); const old = samples.find(p => now - p.t < 120) || samples[0]; if (old && now - old.t > 0) { const dt = (now - old.t) / 1000; NA.canvas.kick((sx - old.sx) / dt, (sy - old.sy) / dt); } }
                break;
            }
            case 'dragBlocks':
                if (NA.ui && NA.ui.mergeHint) NA.ui.mergeHint(null);
                if (s.moved) { NA.model.emit('move', { ids: s.ids }); if (s.merge && NA.ui && NA.ui.mergePopover) NA.ui.mergePopover(s.merge, sx, sy); }
                else if (!s.alt && !e.shiftKey && s.ids.length > 1) { const h = NA.hit.test(sx, sy, { blocksOnly: true }); if (h.type === 'block') NA.selection.selectBlocks([h.block.id]); }
                break;
            case 'marquee': {
                if (!s.moved || !marquee) {
                    if (s.neuronHit) { const h = s.neuronHit; if (s.additive) NA.selection.toggleNeuron(h.block.id, h.idx); else NA.selection.selectNeurons(h.block.id, [h.idx]); }
                    else if (!s.additive) NA.selection.clear();
                    marquee = null; NA.canvas.invalidate('overlay'); break;
                }
                const m = marquee; marquee = null;
                const g = NA.model.graph();
                const host = marqueeHost(s, m);
                if (host) {
                    const idxs = rowsIn(host, m);
                    NA.selection.selectNeurons(host.id, idxs, s.additive);
                    if (idxs.length && s.neuronHost && NA.ui && NA.ui.regionPopover) NA.ui.regionPopover(sx, sy);
                } else {
                    const ids = NA.hit.blocksIn(m).map(b => b.id);
                    NA.selection.selectBlocks(ids, s.additive);
                    for (const ed of g.edges) if (NA.selection.state.blocks.has(ed.from.block) && NA.selection.state.blocks.has(ed.to.block)) NA.selection.state.edges.add(ed.id);
                    bus.emit('selection:change');
                }
                NA.canvas.invalidate('overlay'); break;
            }
            case 'neuronPress': { const h = s.hit; if (s.additive) NA.selection.toggleNeuron(h.block.id, h.idx); else NA.selection.selectNeurons(h.block.id, [h.idx]); break; }
            case 'btnPress': { const h = NA.hit.test(sx, sy); if (h.type === 'block' && h.block.id === s.hit.block.id && h.button === s.hit.button) NA.selection.toggleBlockUi(s.hit.block.id, s.hit.button); break; }
            case 'stripPress': { const b = s.hit.block; NA.model.updateBlock(b.id, { ui: { expandedRegion: b.ui.expandedRegion === s.hit.row.id ? null : s.hit.row.id } }); NA.selection.selectBlocks([b.id]); break; }
            case 'wireNeuron': {
                const h = NA.hit.test(sx, sy);
                if (h.type === 'neuron' && h.block.id !== s.from.block.id) { const r = NA.model.addNeuronEdge({ block: s.from.block.id, idx: s.from.idx }, { block: h.block.id, idx: h.idx }); if (r.error) toast(r.error, 'warn'); else NA.selection.selectNeuronEdge(r.edge.id); }
                else if ((h.type === 'block' || h.type === 'strip-row') && h.block.id !== s.from.block.id && NA.model.effectiveSize(h.block) !== null) NA.ui.neuronTargetPopover(s.from, h.block, sx, sy);
                setHover(NA.hit.test(sx, sy)); break;
            }
            case 'wirePort': {
                if (!s.moved) { NA.selection.selectBlocks([s.from.block.id]); break; }
                const h = NA.hit.test(sx, sy); const from = s.from; const reverse = from.port.dir === 'in';
                let a = null, b = null;
                if (h.type === 'port' && h.block.id !== from.block.id && h.port.dir !== from.port.dir) { a = reverse ? { block: h.block.id, port: h.port.id } : { block: from.block.id, port: from.port.id }; b = reverse ? { block: from.block.id, port: from.port.id } : { block: h.block.id, port: h.port.id }; }
                else if ((h.type === 'block' || h.type === 'neuron' || h.type === 'strip-row') && h.block.id !== from.block.id) {
                    if (reverse) { a = { block: h.block.id, port: 'out' }; b = { block: from.block.id, port: from.port.id }; }
                    else { const t = freeInput(h.block); if (t) { a = { block: from.block.id, port: from.port.id }; b = { block: h.block.id, port: t.id }; } }
                }
                if (a && b) { const r = NA.model.addEdge(a, b); if (r.error) toast(r.error, 'warn'); else NA.selection.selectEdge(r.edge.id); }
                setHover(NA.hit.test(sx, sy)); break;
            }
        }
        updateCursor(); NA.canvas.invalidate('overlay');
    }

    // ---------- wheel ----------
    function onWheel(e) {
        e.preventDefault();
        const { sx, sy } = pos(e);
        const mode = NA.model.get().settings.wheel || 'auto';
        const looksMouse = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && e.deltaX === 0 && Number.isInteger(e.deltaY));
        const zoom = e.ctrlKey || e.metaKey || mode === 'zoom' || (mode === 'auto' && looksMouse);
        if (zoom) { const f = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY) * (e.ctrlKey ? 0.01 : 0.0022)); NA.canvas.zoomAt(sx, sy, f); }
        else if (e.shiftKey && !e.deltaX) NA.canvas.panBy(-e.deltaY, 0);
        else NA.canvas.panBy(-e.deltaX, -e.deltaY);
        NA.canvas.stopInertia();
    }
    function onDbl(e) {
        const { sx, sy } = pos(e); const h = NA.hit.test(sx, sy);
        if (h.type === 'block') { if (h.block.kind === 'module' && !h.header) NA.model.enterModule(h.block.params.def); else NA.ui.inlineRename(h.block); }
        else if (h.type === 'neuron') NA.ui.inlineNeuronLabel(h.block, h.idx);
        else if (h.type === 'group') NA.ui.inlineRename(h.group, true);
        else if (h.type === 'empty' && NA.model.get().view.path.length) NA.model.exitModule();
    }
    // The native contextmenu event is suppressed; the menu opens from a right-click that did not drag (see onUp)
    function onCtx(e) { e.preventDefault(); }
    function openContext(sx, sy, cx, cy) {
        const h = NA.hit.test(sx, sy);
        if (h.type === 'block' && !NA.selection.state.blocks.has(h.block.id)) NA.selection.selectBlocks([h.block.id]);
        if (h.type === 'edge') NA.selection.selectEdge(h.edge.id);
        if (h.type === 'neuron' && !(NA.selection.state.neurons.get(h.block.id) || new Set()).has(h.idx)) NA.selection.selectNeurons(h.block.id, [h.idx]);
        NA.ui.contextMenu(cx, cy, h);
    }

    NA.interact = { init, setTool, get tool() { return tool; }, get hover() { return hover; }, get marquee() { return marquee; }, get ghost() { return ghost; }, get dragging() { return !!st && st.kind !== 'click'; }, get laneDrag() { return !!(st && st.kind === 'dragBlocks' && st.moved && st.lanes); }, refreshHover };
})();

// ============================================================
// NA.history — snapshot undo/redo + autosave
// ============================================================
(() => {
    const cfg = NA.config; const { bus, debounce } = NA.util;
    let stack = [], idx = -1, suppress = false;
    const snap = () => JSON.stringify(NA.model.serialize({ session: true }));
    function commit() {
        if (suppress) return;
        const s = snap(); if (stack[idx] === s) return;
        stack = stack.slice(0, idx + 1); stack.push(s); if (stack.length > cfg.HISTORY_MAX) stack.shift(); idx = stack.length - 1;
        bus.emit('history:change'); autosave();
    }
    const commitDebounced = debounce(commit, 350);
    function restore(i) {
        suppress = true;
        const cur = NA.model.get(); const view = cur ? { ...cur.view, path: cur.view.path.slice() } : null;
        NA.model.replace(JSON.parse(stack[i]));
        if (view) { const v = NA.model.get().view; v.x = view.x; v.y = view.y; v.z = view.z; if (view.path.every(id => NA.model.get().modules[id])) v.path = view.path; }
        NA.graph.refresh(); NA.model.emit('navigate');
        suppress = false; bus.emit('history:change'); NA.selection.prune(); autosave();
    }
    function undo() { if (idx > 0) restore(--idx); }
    function redo() { if (idx < stack.length - 1) restore(++idx); }
    function reset() { stack = []; idx = -1; commit(); }
    const autosave = debounce(() => {
        try { const s = stack[idx] || snap(); if (s.length > cfg.AUTOSAVE_LIMIT) return; localStorage.setItem(cfg.AUTOSAVE_KEY, s); } catch (_) {}
    }, 800);
    function init() {
        bus.on('model:change', (e) => { if (e.type === 'transient' || e.type === 'navigate') return; if (e.type === 'update') commitDebounced(); else commit(); });
        bus.on('view:change', debounce(autosave, 1500));
    }
    NA.history = { init, commit, undo, redo, reset, get canUndo() { return idx > 0; }, get canRedo() { return idx < stack.length - 1; }, get suppressed() { return suppress; } };
})();
