/* Neural Architect — app.js
 *
 * NA.minimap, NA.project (files, links, templates, autosave, drop), NA.ui
 * (top bar, menu, selection bar, context menu, modals, popovers, HUD, empty
 * state) and NA.main (boot).
 */
'use strict';

// ============================================================
// NA.minimap
// ============================================================
(() => {
    let c, ctx, W = 180, H = 110, scale = 1, ox = 0, oy = 0, dragging = false;
    const T = (n) => NA.theme.token(n);
    function draw() {
        if (!c) return;
        const g = NA.model.graph(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
        const b = NA.model.bounds(g.blocks); const vis = NA.canvas.visible();
        if (!b) { c.classList.add('empty'); return; } c.classList.remove('empty');
        const x0 = Math.min(b.x, vis.x) - 40, y0 = Math.min(b.y, vis.y) - 40, x1 = Math.max(b.x + b.w, vis.x + vis.w) + 40, y1 = Math.max(b.y + b.h, vis.y + vis.h) + 40;
        scale = Math.min((W - 8) / (x1 - x0), (H - 8) / (y1 - y0)); ox = 4 - x0 * scale + ((W - 8) - (x1 - x0) * scale) / 2; oy = 4 - y0 * scale + ((H - 8) - (y1 - y0) * scale) / 2;
        ctx.strokeStyle = T('--wire'); ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
        for (const e of g.edges) { const p = NA.model.edgeEndpoints(e, g); if (p) { ctx.beginPath(); ctx.moveTo(p.x1 * scale + ox, p.y1 * scale + oy); ctx.lineTo(p.x2 * scale + ox, p.y2 * scale + oy); ctx.stroke(); } }
        ctx.globalAlpha = 1;
        for (const bl of g.blocks) { const r = NA.model.rect(bl, g); ctx.fillStyle = NA.model.blockColor(bl); ctx.globalAlpha = NA.selection.state.blocks.has(bl.id) ? 1 : 0.7; ctx.fillRect(r.x * scale + ox, r.y * scale + oy, Math.max(2, r.w * scale), Math.max(2, r.h * scale)); }
        ctx.globalAlpha = 1; ctx.strokeStyle = T('--accent'); ctx.lineWidth = 1.5; ctx.fillStyle = NA.util.rgba(T('--accent'), 0.08);
        ctx.fillRect(vis.x * scale + ox, vis.y * scale + oy, vis.w * scale, vis.h * scale); ctx.strokeRect(vis.x * scale + ox, vis.y * scale + oy, vis.w * scale, vis.h * scale);
    }
    function moveTo(e) { const r = c.getBoundingClientRect(); const wx = (e.clientX - r.left - ox) / scale, wy = (e.clientY - r.top - oy) / scale; NA.canvas.centerOn(wx, wy, null, false); }
    function init() {
        c = document.getElementById('minimap'); if (!c) return; ctx = c.getContext('2d'); c.style.width = W + 'px'; c.style.height = H + 'px';
        c.addEventListener('pointerdown', (e) => { dragging = true; c.setPointerCapture(e.pointerId); moveTo(e); });
        c.addEventListener('pointermove', (e) => { if (dragging) moveTo(e); });
        c.addEventListener('pointerup', () => { dragging = false; }); c.addEventListener('pointercancel', () => { dragging = false; });
        NA.util.bus.on('view:change', draw);
    }
    NA.minimap = { init, draw };
})();

// ============================================================
// NA.project — files, links, templates, autosave, drop
//
// A model is a document. It knows the file it came from (File System Access
// handle, where the browser has it), whether it has unsaved edits, and it can
// travel as a link. The saved file is the model alone (see model.serialize):
// two saves of an unchanged model are byte-identical.
// ============================================================
(() => {
    const cfg = NA.config; const { toast, download, slug, jsonLines, bus } = NA.util;
    const PREV_KEY = cfg.AUTOSAVE_KEY + '.prev', DIRTY_KEY = cfg.AUTOSAVE_KEY + '.dirty';
    let handle = null;      // the file this model was opened from / last saved to (null: never saved, or no FS API)
    let dirty = false;      // edited since the last open / save
    const FS = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

    const hasContent = () => { const st = NA.model.get(); return st && (st.blocks.length > 0 || Object.keys(st.modules).length > 0); };
    const fileText = () => jsonLines(NA.model.serialize()) + '\n';
    const fileName = () => slug(NA.model.get().meta.name, 'model') + '.neural.json';
    function setDirty(v) { if (dirty === v) return; dirty = v; try { localStorage.setItem(DIRTY_KEY, v ? '1' : ''); } catch (_) {} bus.emit('project:change'); }
    function confirmDiscard() { return !hasContent() || !dirty || window.confirm('Replace the current model? It has edits that are not in a file yet.'); }
    function afterLoad(msg) { NA.selection.clear(); NA.history.reset(); setDirty(false); NA.ui.refresh(); NA.canvas.fitReadable(false); if (msg) toast(msg, 'ok', 3600); }
    function newProject() { if (!confirmDiscard()) return; handle = null; NA.model.newProject('Untitled model'); afterLoad(); }
    function loadTemplate(id) { if (!confirmDiscard()) return; handle = null; NA.model.replace(NA.templates.build(id)); NA.util.modal('templates-modal', false); afterLoad(); }

    // Take in a project that arrived from outside. When it replaces a model of the same name (a
    // colleague sent your file back), the toast says what changed rather than just "Opened".
    function adopt(json, source, newHandle) {
        const prev = hasContent() ? NA.model.serialize() : null;
        if (!confirmDiscard()) return false;
        NA.model.replace(json); handle = newHandle || null;
        let msg = source ? `Opened ${source}` : 'Opened';
        if (prev && prev.meta.name === NA.model.get().meta.name) { const s = NA.model.diffSummary(NA.model.diff(prev, NA.model.serialize())); msg += s ? ` — ${s}` : ' — identical to what you had'; }
        afterLoad(msg); return true;
    }

    // ---- save: back to the same file when the browser lets us, a download otherwise ----
    const projectTypes = [{ description: 'Neural Architect model', accept: { 'application/json': ['.json'] } }];
    async function writeTo(h) { const w = await h.createWritable(); await w.write(fileText()); await w.close(); }
    async function save() {
        if (!handle) return saveAs();
        try { await writeTo(handle); setDirty(false); toast(`Saved ${handle.name}`, 'ok'); }
        catch (e) { if (e.name === 'NotAllowedError' || e.name === 'NotFoundError') return saveAs(); toast(e.message, 'error', 5000); }
    }
    async function saveAs() {
        if (!FS) { download(fileName(), fileText(), 'application/json'); setDirty(false); toast(`Downloaded ${fileName()}`, 'ok'); return; }
        try { const h = await window.showSaveFilePicker({ suggestedName: fileName(), types: projectTypes }); await writeTo(h); handle = h; setDirty(false); bus.emit('project:change'); toast(`Saved ${h.name}`, 'ok'); }
        catch (e) { if (e.name !== 'AbortError') toast(e.message, 'error', 5000); }
    }

    // ---- open ----
    async function openDialog() {
        if (!FS || typeof window.showOpenFilePicker !== 'function') { document.getElementById('project-input').click(); return; }
        try {
            const [h] = await window.showOpenFilePicker({ types: [{ description: 'Models', accept: { 'application/json': ['.json'], 'text/x-python': ['.py'], 'application/octet-stream': ['.onnx'] } }] });
            await openFile(await h.getFile(), h);
        } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'error', 5000); }
    }
    async function openFile(file, h = null) {
        if (!file) return;
        const name = file.name.toLowerCase();
        try {
            if (name.endsWith('.onnx')) {
                const buf = await file.arrayBuffer(); const m = NA.io.onnx.parse(buf); const p = NA.io.onnx.toProject(m, file.name);
                const warnings = p._warnings || []; delete p._warnings;
                if (!adopt(p, `${file.name} · ${p.blocks.length} blocks`, null)) return;
                if (warnings.length) setTimeout(() => toast(warnings.slice(0, 3).join(' · ') + (warnings.length > 3 ? ` (+${warnings.length - 3})` : ''), 'warn', 6000), 400);
                return;
            }
            const text = await file.text();
            let json = null;
            if (name.endsWith('.py')) { json = NA.codegen.pytorch.extractProject(text); if (!json) throw new Error('This .py has no embedded Neural Architect model — only files exported from here re-open'); }
            else json = JSON.parse(text);
            adopt(json, file.name, name.endsWith('.py') ? null : h);   // a .py is an export; saving goes to a .json
        } catch (e) { console.error(e); toast(e.message, 'error', 5000); }
    }

    // ---- links: the whole model, deflated, in the URL fragment ----
    const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    async function pack(text) {
        const bytes = new TextEncoder().encode(text);
        if (typeof CompressionStream === 'undefined') return 'j' + b64u(bytes);
        const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(bytes); w.close();
        return 'z' + b64u(new Uint8Array(await new Response(cs.readable).arrayBuffer()));
    }
    async function unpack(s) {
        const raw = unb64u(s.slice(1)); if (s[0] === 'j') return new TextDecoder().decode(raw);
        const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(raw); w.close();
        return await new Response(ds.readable).text();
    }
    async function shareLink() {
        const url = location.origin + location.pathname + '#p=' + await pack(JSON.stringify(NA.model.serialize()));
        if (url.length > 60000) { toast('Too large for a link — send the file instead', 'warn', 4000); return; }
        try { await navigator.clipboard.writeText(url); toast('Link copied — it opens this exact model', 'ok', 3200); }
        catch (_) { window.prompt('Copy this link', url); }
    }

    // ---- boot: link › ?template › autosave › blank ----
    async function boot() {
        const q = new URLSearchParams(location.search);
        const t = q.get('template');
        let loaded = false, fromLink = false, restoredDirty = false;
        const hp = /[#&]p=([^&]+)/.exec(location.hash);
        if (hp) {
            try {
                const json = JSON.parse(await unpack(decodeURIComponent(hp[1])));
                // A link must not silently eat unsaved work: park the autosave where the menu can bring it back
                try { const prev = localStorage.getItem(cfg.AUTOSAVE_KEY); if (prev && localStorage.getItem(DIRTY_KEY) === '1') localStorage.setItem(PREV_KEY, prev); } catch (_) {}
                NA.model.replace(json); loaded = fromLink = true;
                history.replaceState(null, '', location.pathname + location.search);
            } catch (e) { console.warn('link unreadable', e); toast('That link could not be read', 'error', 4000); }
        }
        if (!loaded && t && NA.templates.get(t)) { NA.model.replace(NA.templates.build(t)); loaded = true; }
        else if (!loaded && !q.has('blank')) {
            try { const s = localStorage.getItem(cfg.AUTOSAVE_KEY); if (s) { NA.model.replace(JSON.parse(s)); loaded = true; restoredDirty = localStorage.getItem(DIRTY_KEY) === '1'; } } catch (e) { console.warn('autosave unreadable', e); }
        }
        if (!loaded) NA.model.newProject('Untitled model');
        NA.history.reset(); setDirty(restoredDirty); NA.ui.refresh();
        const st = NA.model.get();
        NA.canvas.whenSized(() => {
            if (!loaded || t || fromLink) NA.canvas.fitReadable(false); else NA.canvas.setView(st.view.x, st.view.y, st.view.z, false);
            if (q.get('mode') === 'infer') NA.model.setMode('infer');
            if (q.get('collapse')) for (const b of st.blocks) if (NA.model.effectiveSize(b) !== null && st.blocks.indexOf(b) % 2 === 0) b.ui.collapsed = true;
            const vq = q.get('view');
            if (vq) { const [x, y, z] = vq.split(',').map(Number); if ([x, y, z].every(Number.isFinite)) NA.canvas.setView(x, y, z, false); }
            else if (q.get('thumb') && st.blocks.length) { const b = NA.model.bounds(); NA.canvas.fit({ x: b.x, y: b.y, w: b.w * 0.42, h: b.h }, 40, false, 1.6); }
        });
        if (fromLink) toast(`Opened from link: ${st.meta.name}${hasPrev() ? ' · your previous model is under Menu › Restore' : ''}`, 'ok', 5000);
    }
    const hasPrev = () => { try { return !!localStorage.getItem(PREV_KEY); } catch (_) { return false; } };
    function restorePrev() {
        let s = null; try { s = localStorage.getItem(PREV_KEY); } catch (_) {}
        if (!s) return toast('Nothing to restore', 'warn');
        if (!adopt(JSON.parse(s), 'your previous model', null)) return;
        try { localStorage.removeItem(PREV_KEY); } catch (_) {}
        setDirty(true);
    }
    function autosaveNow() { try { localStorage.setItem(cfg.AUTOSAVE_KEY, JSON.stringify(NA.model.serialize({ session: true }))); } catch (_) {} }

    function initDrop() {
        const stage = NA.canvas.stage; const hint = document.getElementById('drop-hint'); let depth = 0;
        stage.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; hint.classList.add('visible'); });
        stage.addEventListener('dragover', (e) => { e.preventDefault(); });
        stage.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; hint.classList.remove('visible'); } });
        stage.addEventListener('drop', async (e) => {
            e.preventDefault(); depth = 0; hint.classList.remove('visible');
            const item = e.dataTransfer.items && e.dataTransfer.items[0];
            const hp = item && typeof item.getAsFileSystemHandle === 'function' ? item.getAsFileSystemHandle().catch(() => null) : null;   // must be requested during the event
            const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
            const h = hp ? await hp : null;
            openFile(f, h && h.kind === 'file' ? h : null);
        });
        document.getElementById('project-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
        // Any real edit marks the document dirty; replace/navigate are not edits
        bus.on('model:change', (e) => { if (e.type === 'transient' || e.type === 'navigate' || e.type === 'replace') return; setDirty(true); });
        bus.on('history:change', () => { if (NA.history.canUndo) setDirty(true); });   // undo / redo are edits too
    }
    NA.project = { newProject, loadTemplate, save, saveAs, shareLink, openDialog, openFile, boot, initDrop, hasContent, autosaveNow, restorePrev, hasPrev,
                   get dirty() { return dirty; }, get fileName() { return handle ? handle.name : null; }, get canSaveInPlace() { return FS; } };
})();

// ============================================================
// NA.ui — shell chrome, menu, selection bar, modals, popovers
// ============================================================
(() => {
    const { el, $, $$, bus, toast, modal, download, fmtNum } = NA.util;
    let exportFormat = 'pytorch';

    function icons(root) { if (window.lucide) lucide.createIcons(root ? { nodes: [root] } : undefined); }
    function refresh() { renderCrumbs(); renderZoom(); renderHistory(); renderHud(); renderEmpty(); positionToolbar(); renderMode(); renderTitle(); }
    function renderMode() { const st = NA.model.get(); if (!st) return; const m = st.settings.mode === 'infer' ? 'infer' : 'train'; for (const b of $$('#tb-mode [data-mode]')) b.classList.toggle('active', b.dataset.mode === m); document.body.classList.toggle('infer-mode', m === 'infer'); }
    // The window title carries the document state the way a desktop app does: "• Name" while unsaved
    function renderTitle() {
        if (new URLSearchParams(location.search).has('selftest')) return;   // the suite reports through document.title
        const st = NA.model.get(); if (!st) return;
        document.title = (NA.project.dirty ? '• ' : '') + (st.meta.name || 'Untitled') + ' — Neural Architect';
    }
    function renderCrumbs() {
        const st = NA.model.get(); const root = $('#crumbs'); root.innerHTML = '';
        const atRoot = !st.view.path.length;
        const dirty = NA.project.dirty;
        root.appendChild(el('button', { class: 'crumb' + (atRoot ? ' current editable' : '') + (dirty ? ' dirty' : ''), title: (atRoot ? 'Rename the model' : 'Back to the model') + (dirty ? ' · edited since the last save' : (NA.project.fileName ? ' · ' + NA.project.fileName : '')), onclick: () => atRoot ? renameProject() : NA.model.goToPath(0) }, [st.meta.name || 'Untitled']));
        st.view.path.forEach((id, i) => { const m = st.modules[id]; root.appendChild(el('span', { class: 'crumb-sep', text: '›' })); root.appendChild(el('button', { class: 'crumb' + (i === st.view.path.length - 1 ? ' current' : ''), onclick: () => NA.model.goToPath(i + 1) }, [m ? m.name : '?'])); });
        document.body.classList.toggle('in-module', st.view.path.length > 0);
    }
    // Click the model name in the top bar to rename it (Enter / blur commit, Esc cancels)
    function renameProject() {
        const btn = $('#crumbs .crumb.editable'); if (!btn) return;
        const st = NA.model.get();
        const inp = el('input', { type: 'text', class: 'crumb-input', value: st.meta.name || '', spellcheck: 'false', 'aria-label': 'Model name' });
        btn.replaceWith(inp); inp.focus(); inp.select();
        let done = false;
        const finish = (commit) => { if (done) return; done = true; const v = inp.value.trim(); if (commit && v && v !== st.meta.name) { st.meta.name = v; NA.model.emit('update'); } else renderCrumbs(); };
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); });
        inp.addEventListener('blur', () => finish(true));
    }
    function renderZoom() { const z = NA.canvas.view.z; const l = $('#zoom-label'); if (l) l.textContent = Math.round(z * 100) + '%'; }
    function renderHistory() { $('#tb-undo').disabled = !NA.history.canUndo; $('#tb-redo').disabled = !NA.history.canRedo; }
    function renderHud() {
        const g = NA.model.graph(); const z = NA.canvas.view.z; const hud = $('#hud'); if (!hud) return;
        const diag = NA.graph.diagnostics().filter(d => d.level === 'error').length;
        let lod = 'blocks';
        const anyDots = g.blocks.some(b => { const L = NA.model.neuronLayout(b); return L && L.pitch * z >= NA.config.LOD.DOTS_MIN_PX; });
        if (anyDots) lod = z >= 2.5 ? 'neurons · labels' : 'neurons'; else if (g.blocks.some(b => NA.model.neuronLayout(b))) lod = 'blocks · zoom in for neurons';
        hud.innerHTML = '';
        hud.appendChild(el('span', { text: lod }));
        const pc = NA.graph.paramCount(g);
        hud.appendChild(el('span', { text: `${g.blocks.length} blocks · ${g.edges.length} wires${g.neuronEdges.length ? ' · ' + g.neuronEdges.length + ' neuron edges' : ''}${pc ? ' · ' + fmtNum(pc) + ' params' : ''}` }));
        if (diag) hud.appendChild(el('span', { class: 'hud-err', text: `${diag} issue${diag > 1 ? 's' : ''}` }));
    }
    function renderEmpty() { const hero = $('#empty-hero'); if (!hero) return; hero.hidden = NA.model.graph().blocks.length > 0 || NA.model.get().view.path.length > 0 || document.body.classList.contains('thumb'); }

    // ---- selection bar (docked along the top of the canvas; buttons enable with the selection) ----
    const barButtons = new Map();
    function positionToolbar() {
        const bar = $('#action-bar'); if (!bar) return;
        if (!barButtons.size) {
            bar.appendChild(el('span', { class: 'ab-hint', text: 'Select a block, wire or neuron' }));
            const cmds = NA.commands.list.filter(c => c.toolbar);
            let lastGroup = null;
            for (const c of cmds) {
                if (lastGroup && c.group !== lastGroup) bar.appendChild(el('div', { class: 'ab-sep' }));
                lastGroup = c.group;
                const btn = el('button', { class: 'ft-btn' + (c.id === 'edit.delete' ? ' danger' : ''), title: c.title + (c.shortcut ? ' (' + NA.commands.fmtShortcut([].concat(c.shortcut)[0]) + ')' : ''), onclick: () => NA.commands.run(c.id) }, [el('i', { 'data-lucide': c.icon || 'circle' }), el('span', { text: c.title.replace(/ \(.*\)/, '') })]);
                bar.appendChild(btn); barButtons.set(c.id, btn);
            }
            icons(bar);
        }
        let anyOn = false;
        for (const [id, btn] of barButtons) { const c = NA.commands.byId(id); btn.disabled = !!(c.when && !c.when()); if (!btn.disabled) anyOn = true; }
        bar.classList.toggle('idle', !anyOn);
    }

    // ---- the app menu: everything that is not about the selection, in one list under ≡ ----
    const MENU = ['file.new', 'file.open', 'file.save', 'file.saveAs', 'file.share', 'file.restorePrev', null, 'file.templates', 'view.tidy', 'view.fit', null, 'file.export.pytorch', 'file.export.keras', null, 'view.theme', 'help.shortcuts', 'palette.open'];
    function appMenu(anchor) {
        const m = $('#ctx-menu'); if (!m.hidden && m.dataset.kind === 'app') { closePopups(); return; }
        closePopups(); m.innerHTML = ''; m.dataset.kind = 'app';
        let pendingSep = false;
        for (const id of MENU) {
            if (id === null) { pendingSep = true; continue; }
            const c = NA.commands.byId(id); if (!c || (c.when && !c.when())) continue;
            if (pendingSep && m.children.length) m.appendChild(el('div', { class: 'ctx-sep' })); pendingSep = false;
            m.appendChild(el('button', { class: 'ctx-item', onclick: () => { closePopups(); NA.commands.run(id); } }, [el('i', { 'data-lucide': c.icon || 'circle' }), el('span', { text: c.menuTitle || c.title }), c.shortcut ? el('kbd', { text: NA.commands.fmtShortcut([].concat(c.shortcut)[0]) }) : null]));
        }
        icons(m); m.hidden = false;
        const r = anchor.getBoundingClientRect(); m.style.left = r.left + 'px'; m.style.top = (r.bottom + 6) + 'px';
    }

    // ---- context menu ----
    function contextMenu(cx, cy, hit) {
        closePopups();
        const m = $('#ctx-menu'); m.innerHTML = '';
        const cmds = NA.commands.list.filter(c => c.ctx && (!c.when || c.when()));
        if (hit.type === 'empty') {
            for (const k of ['input', 'linear', 'concat', 'output']) { const d = NA.catalogue.get(k); m.appendChild(el('button', { class: 'ctx-item', onclick: () => { NA.palette.addAt(k, hit.x, hit.y); closePopups(); } }, [el('i', { 'data-lucide': d.icon }), 'Add ' + d.label])); }
            m.appendChild(el('button', { class: 'ctx-item', onclick: () => { closePopups(); NA.cmdk.open('Add block: '); } }, [el('i', { 'data-lucide': 'plus' }), 'Add block…']));
            m.appendChild(el('div', { class: 'ctx-sep' }));
            m.appendChild(el('button', { class: 'ctx-item', onclick: () => { closePopups(); NA.commands.run('view.fit'); } }, [el('i', { 'data-lucide': 'maximize' }), 'Fit all']));
            m.appendChild(el('button', { class: 'ctx-item', onclick: () => { closePopups(); NA.commands.run('view.tidy'); } }, [el('i', { 'data-lucide': 'layout-grid' }), 'Tidy up']));
        } else {
            let lastGroup = null;
            for (const c of cmds) { if (c.group !== lastGroup && lastGroup) m.appendChild(el('div', { class: 'ctx-sep' })); lastGroup = c.group; m.appendChild(el('button', { class: 'ctx-item' + (c.id === 'edit.delete' ? ' danger' : ''), onclick: () => { closePopups(); NA.commands.run(c.id); } }, [el('i', { 'data-lucide': c.icon || 'circle' }), el('span', { text: c.title }), c.shortcut ? el('kbd', { text: NA.commands.fmtShortcut([].concat(c.shortcut)[0]) }) : null])); }
        }
        icons(m); m.hidden = false;
        const w = m.offsetWidth, h = m.offsetHeight;
        m.style.left = Math.min(cx, window.innerWidth - w - 8) + 'px'; m.style.top = Math.min(cy, window.innerHeight - h - 8) + 'px';
    }
    function closePopups() { $('#ctx-menu').hidden = true; const p = $('#popover'); p.hidden = true; p.innerHTML = ''; }

    // ---- popovers ----
    function popoverAt(sx, sy, content) {
        const p = $('#popover'); p.innerHTML = ''; p.appendChild(content); p.hidden = false;
        const { W, H } = NA.canvas.size; const w = p.offsetWidth, h = p.offsetHeight;
        p.style.left = Math.max(8, Math.min(W - w - 8, sx + 12)) + 'px'; p.style.top = Math.max(8, Math.min(H - h - 8, sy + 12)) + 'px';
        const f = p.querySelector('input, select'); if (f) f.focus();
    }
    // Neuron wire dropped on a block that is not at dot LOD: ask for the target neuron
    function neuronTargetPopover(from, target, sx, sy) {
        const n = NA.model.effectiveSize(target); const off = NA.model.neuronOffset(target), fromOff = NA.model.neuronOffset(from.block);
        const idx = el('input', { type: 'number', min: off, max: off + n - 1, value: off, class: 'insp-input' });
        const regSel = target.regions.length ? el('select', { class: 'insp-input', onchange: (e) => { const r = target.regions.find(x => x.id === e.target.value); if (r) idx.value = off + r.start; } }, [el('option', { value: '', text: 'any region' }), ...target.regions.map(r => el('option', { value: r.id, text: `${r.name} (${off + r.start}–${off + r.end - 1})` }))]) : null;
        const go = () => { const r = NA.model.addNeuronEdge({ block: from.block.id, idx: from.idx }, { block: target.id, idx: +idx.value - off }); if (r.error) toast(r.error, 'warn'); else NA.selection.selectNeuronEdge(r.edge.id); closePopups(); };
        idx.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') closePopups(); });
        popoverAt(sx, sy, el('div', { class: 'pop' }, [el('div', { class: 'pop-title', text: `${from.block.title} #${from.idx + fromOff} → ${target.title}` }), regSel, el('label', { class: 'insp-row' }, [el('span', { class: 'insp-label', text: `Target neuron (${off}–${off + n - 1})` }), idx]), el('div', { class: 'btn-row' }, [el('button', { class: 'btn', onclick: go }, ['Connect']), el('button', { class: 'btn ghost', onclick: closePopups }, ['Cancel'])])]));
    }
    // "Connect neurons to…" from the toolbar: pick a block + start index + mode
    function connectPopover() {
        const rs = NA.selection.neuronRanges(); if (!rs.length) return;
        const g = NA.model.graph(); const srcIds = new Set(rs.map(r => r.block.id));
        const targets = g.blocks.filter(b => !srcIds.has(b.id) && NA.model.effectiveSize(b) !== null);
        if (!targets.length) return toast('No other vector block to connect to', 'warn');
        const total = rs.reduce((n, r) => n + r.idxs.length, 0);
        const sel = el('select', { class: 'insp-input', onchange: () => { const b = NA.model.block(sel.value); start.value = NA.model.neuronOffset(b); } }, targets.map(b => { const o = NA.model.neuronOffset(b), n = NA.model.effectiveSize(b); return el('option', { value: b.id, text: `${b.title} (#${o}–${o + n - 1})` }); }));
        const start = el('input', { type: 'number', min: 0, value: NA.model.neuronOffset(targets[0]), class: 'insp-input' });
        const mode = el('select', { class: 'insp-input' }, [el('option', { value: 'one-to-one', text: `one-to-one (${total} edges)` }), el('option', { value: 'all-to-one', text: `all to one neuron (${total} edges)` })]);
        const init = el('input', { type: 'number', step: 0.05, placeholder: 'random', class: 'insp-input' });
        const b = NA.selection.bounds(); const p = NA.canvas.toScreen(b.x + b.w, b.y);
        popoverAt(p.x, p.y, el('div', { class: 'pop' }, [el('div', { class: 'pop-title', text: 'Connect selected neurons' }),
            el('label', { class: 'insp-row' }, [el('span', { class: 'insp-label', text: 'Target block' }), sel]),
            el('label', { class: 'insp-row' }, [el('span', { class: 'insp-label', text: 'First target neuron' }), start]),
            el('label', { class: 'insp-row' }, [el('span', { class: 'insp-label', text: 'Pattern' }), mode]),
            el('label', { class: 'insp-row' }, [el('span', { class: 'insp-label', text: 'Initial weight' }), init]),
            el('div', { class: 'btn-row' }, [el('button', { class: 'btn', onclick: () => { NA.selection.connectNeurons(sel.value, +start.value - NA.model.neuronOffset(NA.model.block(sel.value)), mode.value, init.value === '' ? null : +init.value); closePopups(); } }, ['Connect']), el('button', { class: 'btn ghost', onclick: closePopups }, ['Cancel'])])]));
    }
    // Pick the activation for the selected wires (or the wires leaving the selected blocks)
    function activationPopover() {
        const b = NA.selection.bounds(); const p = b ? NA.canvas.toScreen(b.x + b.w / 2, b.y) : { x: NA.canvas.size.W / 2, y: 80 };
        const ACT = NA.catalogue.ACT;
        const items = [el('button', { class: 'act-item none', onclick: () => { NA.selection.setActivation(null); closePopups(); } }, ['None']),
            ...Object.keys(ACT).map(k => el('button', { class: 'act-item', onclick: () => { NA.selection.setActivation(k); closePopups(); } }, [ACT[k].label]))];
        popoverAt(p.x - 120, p.y - 70, el('div', { class: 'pop' }, [el('div', { class: 'pop-title', text: 'Activation on the wire' }), el('div', { class: 'act-list' }, items)]));
    }
    // After dragging across neurons: name + colour the range as a region, right where the mouse is
    function regionPopover(sx, sy) {
        const rs = NA.selection.neuronRanges(); if (!rs.length) return;
        const total = rs.reduce((n, r) => n + r.idxs.length, 0);
        const pal = NA.config.REGION_PALETTE; let color = pal[rs[0].block.regions.length % pal.length];
        const name = el('input', { type: 'text', class: 'insp-input', placeholder: 'Region name, e.g. Sensors', spellcheck: 'false' });
        const sw = el('div', { class: 'swatches' }, pal.map(c => el('button', { class: 'swatch' + (c === color ? ' active' : ''), style: `background:${c}`, 'data-c': c, onclick: () => { color = c; for (const x of sw.children) x.classList.toggle('active', x.dataset.c === c); name.focus(); } })));
        const create = () => { const n = name.value.trim() || 'Region'; for (const { block, idxs } of rs) { const r = NA.model.addRegion(block.id, { name: n, start: idxs[0], end: idxs[idxs.length - 1] + 1, color }); if (r && r.error) toast(r.error, 'warn'); } closePopups(); };
        name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') create(); if (e.key === 'Escape') closePopups(); });
        const off = NA.model.neuronOffset(rs[0].block); const lo = off + rs[0].idxs[0], hi = off + rs[0].idxs[rs[0].idxs.length - 1];
        popoverAt(sx, sy, el('div', { class: 'pop region-pop' }, [el('div', { class: 'pop-title', text: `${total} neuron${total > 1 ? 's' : ''} selected · #${lo}–${hi}` }), name, sw,
            el('div', { class: 'btn-row' }, [el('button', { class: 'btn', onclick: create }, ['Create region']), el('button', { class: 'btn ghost', onclick: closePopups }, ['Just select'])])]));
    }
    // Shrinking a block below its regions: say which regions are hit and let the user decide per region
    function shrinkPopover(b, n, anchor) {
        const cut = NA.model.regionsCut(b, n); if (!cut.length) return;
        const off = NA.model.neuronOffset(b); const cur = NA.model.effectiveSize(b);
        const choice = new Map(cut.map(c => [c.region.id, c.lost ? 'delete' : 'trim']));
        const rows = cut.map(({ region: r, lost }) => {
            const span = `#${off + r.start}–${off + r.end - 1}`;
            const sel = el('select', { class: 'insp-input', onchange: e => choice.set(r.id, e.target.value) }, lost
                ? [el('option', { value: 'delete', text: 'Delete (entirely past the end)' })]
                : [el('option', { value: 'trim', text: `Trim to #${off + r.start}–${off + n - 1}` }), el('option', { value: 'delete', text: 'Delete' })]);
            sel.value = choice.get(r.id);
            return el('div', { class: 'shrink-row' }, [el('span', { class: 'shrink-name' }, [el('span', { class: 'kind-dot', style: `--kc:${r.color || NA.model.blockColor(b)}` }), el('span', { text: `${r.name} ` }), el('span', { class: 'mono muted', text: span })]), sel]);
        });
        const apply = () => { const del = [...choice].filter(([, v]) => v === 'delete').map(([id]) => id); NA.model.shrinkTo(b.id, n, del); closePopups(); toast(`${b.title}: ${n} neurons · ${del.length ? del.length + ' region' + (del.length > 1 ? 's' : '') + ' deleted' : 'regions trimmed'}`); };
        const cancel = () => { closePopups(); NA.inspector.render(); };
        const box = el('div', { class: 'pop shrink-pop' }, [
            el('div', { class: 'pop-title', text: `Shrink “${b.title}” from ${cur} to ${n} neurons?` }),
            el('p', { class: 'insp-note', text: `${cut.length} region${cut.length > 1 ? 's' : ''} reach${cut.length > 1 ? '' : 'es'} past #${off + n - 1}. Wires from a deleted region are removed; a trimmed region keeps its wires with fewer neurons.` }),
            ...rows,
            el('div', { class: 'btn-row' }, [el('button', { class: 'btn', onclick: apply }, ['Apply']), el('button', { class: 'btn ghost', onclick: cancel }, ['Cancel'])])]);
        box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') apply(); if (e.key === 'Escape') cancel(); });
        // next to the field that asked (the inspector sits right of the stage, so this lands on the stage's right edge at the field's height)
        const sr = NA.canvas.stage.getBoundingClientRect(); const ar = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { top: sr.top + 80 };
        popoverAt(NA.canvas.size.W, ar.top - sr.top - 24, box);
    }
    // While dragging an Input over another Input: a hint that follows the pointer; on release, the question
    function mergeHint(cand, sx, sy) {
        let h = $('#merge-hint'); if (!h) { h = el('div', { id: 'merge-hint', class: 'merge-hint' }); NA.canvas.stage.appendChild(h); }
        if (!cand) { h.hidden = true; return; }
        h.textContent = `Release to merge “${cand.source.title}” into “${cand.target.title}”`; h.hidden = false;
        h.style.left = (sx + 18) + 'px'; h.style.top = (sy + 18) + 'px';
    }
    function mergePopover(cand, sx, sy) {
        mergeHint(null);
        const a = NA.model.effectiveSize(cand.target), n = NA.model.effectiveSize(cand.source);
        popoverAt(sx, sy, el('div', { class: 'pop' }, [el('div', { class: 'pop-title', text: `Merge “${cand.source.title}” into “${cand.target.title}”?` }),
            el('p', { class: 'insp-note', text: `One input of ${a + n} neurons: “${cand.target.title}” keeps #0–${a - 1}, “${cand.source.title}” becomes the region #${a}–${a + n - 1}. Wires, labels and neuron edges follow.` }),
            el('div', { class: 'btn-row' }, [
                el('button', { class: 'btn', onclick: () => { const r = NA.model.mergeInputs(cand.target.id, cand.source.id); closePopups(); if (r.error) toast(r.error, 'warn'); else { NA.selection.selectBlocks([cand.target.id]); toast(`Merged into “${cand.target.title}”`); } } }, ['Merge']),
                el('button', { class: 'btn ghost', onclick: closePopups }, ['Keep separate'])])]));
    }
    function colorPopover() {
        const b = NA.selection.bounds(); if (!b) return; const p = NA.canvas.toScreen(b.x + b.w / 2, b.y);
        const pal = [null, ...NA.config.REGION_PALETTE];
        popoverAt(p.x - 90, p.y - 90, el('div', { class: 'pop' }, [el('div', { class: 'swatches' }, pal.map(c => el('button', { class: 'swatch' + (c ? '' : ' none'), style: c ? `background:${c}` : '', onclick: () => { NA.selection.setColor(c); closePopups(); } })))]));
    }
    function focusInspector(field) { if (window.MobileUI && MobileUI.isPhone && MobileUI.isPhone()) MobileUI.open(1); NA.inspector.focusField(field); }

    // ---- inline rename ----
    function inlineRename(target, isGroup = false) {
        const box = $('#inline-edit'); const inp = box.querySelector('input');
        const g = NA.model.graph();
        const r = isGroup ? target._rect : NA.model.rect(target, g); if (!r) return;
        const z = NA.canvas.view.z; const p = NA.canvas.toScreen(r.x + 14, r.y + (isGroup ? 8 : (r.mode === 'pill' ? r.h / 2 - 8 : 12)));
        box.style.left = p.x + 'px'; box.style.top = p.y + 'px'; box.style.width = Math.max(120, (r.w - 40) * z) + 'px'; box.style.fontSize = Math.max(11, 13 * z) + 'px';
        inp.value = isGroup ? target.name : target.title; box.hidden = false; inp.focus(); inp.select();
        const done = (commit) => { if (box.hidden) return; box.hidden = true; if (commit && inp.value.trim()) { if (isGroup) NA.model.updateGroup(target.id, { name: inp.value.trim() }); else NA.model.updateBlock(target.id, { title: inp.value.trim() }); } };
        inp.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
        inp.onblur = () => done(true);
    }

    // Inline neuron label editor, placed on the neuron's own row (column layout). Enter / Tab
    // commit and step to the next neuron, Shift+Enter steps back, Escape cancels.
    function inlineNeuronLabel(block, idx) {
        const L = NA.model.neuronLayout(block); if (!L || !L.column || idx < L.start || idx >= L.end) { NA.selection.selectNeurons(block.id, [idx]); if (window.MobileUI && MobileUI.isPhone && MobileUI.isPhone()) MobileUI.open(1); NA.inspector.focusNeuron(block.id, idx); return; }
        // Only edit at a zoom where the row text is actually painted; otherwise zoom onto the row first
        const z = NA.canvas.view.z; if (L.pitch * 0.6 * z < NA.config.LOD.MIN_TEXT_PX - 1) { NA.canvas.centerOn(block.pos.x + 120, L.y0 + (idx - L.start + 0.5) * L.pitch, Math.max(z, 1.6)); setTimeout(() => inlineNeuronLabel(block, idx), 400); return; }
        NA.selection.selectNeurons(block.id, [idx]);
        const box = $('#inline-edit'); const inp = box.querySelector('input');
        const c = NA.model.neuronCenter(block, idx, L);
        const x0 = L.x0 + L.pitch + 34, w = L.cellW - L.pitch - 40;
        const p = NA.canvas.toScreen(x0, c.y - L.pitch / 2);
        box.style.left = p.x + 'px'; box.style.top = p.y + 'px'; box.style.width = Math.max(90, w * z) + 'px'; box.style.fontSize = Math.max(11, L.pitch * NA.config.COL_LABEL_SCALE * z) + 'px';
        box.classList.add('neuron'); box.style.setProperty('--row-h', (L.pitch * z) + 'px');
        const cur = block.neurons[idx]; inp.value = cur && cur.label ? cur.label : ''; inp.placeholder = 'label for #' + (idx + NA.model.neuronOffset(block));
        box.hidden = false; inp.focus(); inp.select();
        let closed = false;
        const done = (commit, step = 0) => {
            if (closed) return; closed = true; box.hidden = true; box.classList.remove('neuron'); inp.placeholder = '';
            if (commit) NA.model.setNeuron(block.id, idx, { label: inp.value.trim() });
            const next = idx + step; if (step && next >= L.start && next < L.end) setTimeout(() => inlineNeuronLabel(block, next), 0);
        };
        // Escape keeps what was typed (it only stops the stepping); typed labels are never thrown away
        inp.onkeydown = (e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); done(true, e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); done(true); } else if (e.key === 'ArrowDown') { e.preventDefault(); done(true, 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); done(true, -1); } e.stopPropagation(); };
        inp.onblur = () => done(true);
    }

    // ---- export modal ----
    // One pass over the text with a single alternation, so a token is never re-matched inside a
    // tag that an earlier pass inserted (that is what put `class="c">` into the preview)
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    function tint(code, lang) {
        if (lang === 'json') {
            return code.replace(/("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|[^"\w-]+|[\w-]+/g, (m, str, colon, lit) => {
                if (str) return colon ? `<span class="k">${esc(str)}</span>${colon}` : `<span class="s">${esc(str)}</span>`;
                if (lit) return `<span class="n">${lit}</span>`;
                return esc(m);
            });
        }
        const KW = /^(?:import|from|class|def|return|if|else|elif|with|for|in|as|None|True|False|self|assert|print|not|and|or|lambda|pass)$/;
        return code.replace(/(r?"""[\s\S]*?"""|r?'''[\s\S]*?''')|(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\b((?:nn|torch|F)\.\w+)|\b([A-Za-z_]\w*)\b|\b(\d+(?:\.\d+)?)\b|[^\w"'#]+|./g,
            (m, doc, cm, str, api, word, num) => {
                if (doc || cm) return `<span class="c">${esc(m)}</span>`;
                if (str) return `<span class="s">${esc(m)}</span>`;
                if (api) return `<span class="f">${esc(m)}</span>`;
                if (word) return KW.test(word) ? `<span class="k">${word}</span>` : word;
                if (num) return `<span class="n">${num}</span>`;
                return esc(m);
            });
    }
    let exportCache = null;
    function exportModal(fmt) {
        exportFormat = fmt || exportFormat; modal('export-modal', true);
        $$('#export-modal .tab').forEach(t => t.classList.toggle('active', t.dataset.fmt === exportFormat));
        const pre = $('#code-preview'), notes = $('#export-notes');
        let out;
        if (exportFormat === 'pytorch') { const r = NA.codegen.pytorch.generate(); out = { code: r.code, lang: 'py', filename: r.filename, errors: r.errors, warnings: r.warnings, mime: 'text/x-python' }; }
        else if (exportFormat === 'keras') { const r = NA.codegen.keras.generate(); out = { code: r.json, lang: 'json', filename: r.filename, errors: [], warnings: r.warnings, mime: 'application/json' }; }
        else { const st = NA.model.get(); out = { code: NA.util.jsonLines(NA.model.serialize()) + '\n', lang: 'json', filename: NA.util.slug(st.meta.name, 'model') + '.neural.json', errors: [], warnings: [], mime: 'application/json' }; }
        exportCache = out;
        pre.innerHTML = tint(out.code.length > 200000 ? out.code.slice(0, 200000) + '\n… (truncated preview)' : out.code, out.lang);
        notes.innerHTML = '';
        for (const e of out.errors) notes.appendChild(el('div', { class: 'diag error', text: e }));
        for (const w of out.warnings) notes.appendChild(el('div', { class: 'diag warn', text: w }));
        if (!out.errors.length && !out.warnings.length) notes.appendChild(el('div', { class: 'diag ok', text: exportFormat === 'pytorch' ? 'Runnable: python ' + out.filename + ' does a smoke forward pass and asserts the output shapes.' : 'Ready.' }));
        $('#export-filename').textContent = out.filename;
    }
    function initExport() {
        $$('#export-modal .tab').forEach(t => t.addEventListener('click', () => exportModal(t.dataset.fmt)));
        $('#export-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(exportCache.code); toast('Copied to clipboard', 'ok'); } catch (_) { toast('Clipboard blocked — use Download', 'warn'); } });
        $('#export-download').addEventListener('click', () => { download(exportCache.filename, exportCache.code, exportCache.mime); toast('Downloaded ' + exportCache.filename, 'ok'); });
        $$('.modal').forEach(m => { m.addEventListener('pointerdown', (e) => { if (e.target === m) m.classList.remove('visible'); }); $$('[data-close]', m).forEach(b => b.addEventListener('click', () => m.classList.remove('visible'))); });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal.visible').forEach(m => m.classList.remove('visible')); });
    }
    function initTemplates() {
        const root = $('#template-list'); root.innerHTML = '';
        for (const t of NA.templates.list) root.appendChild(el('button', { class: 'tcard', onclick: () => NA.project.loadTemplate(t.id) }, [el('i', { 'data-lucide': t.icon }), el('b', { text: t.name }), el('span', { text: t.desc })]));
        icons(root);
        const hero = $('#empty-hero');
        if (hero) { $('#hero-templates').addEventListener('click', () => modal('templates-modal', true)); $('#hero-open').addEventListener('click', () => NA.project.openDialog()); $('#hero-robot').addEventListener('click', () => NA.project.loadTemplate('robot_policy')); $('#hero-add').addEventListener('click', () => NA.palette.addAtCentre('input', { title: 'Observation' })); }
    }
    function shortcutsModal() {
        const root = $('#shortcut-list'); root.innerHTML = '';
        const groups = new Map();
        for (const c of NA.commands.list) { if (!c.shortcut || c.hidden) continue; if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); }
        groups.set('Canvas', [{ title: 'Pan', shortcut: 'Space+drag · right button · two fingers' }, { title: 'Zoom', shortcut: 'Ctrl+wheel · pinch · mouse wheel' }, { title: 'Wire blocks', shortcut: 'drag from a port, or W then drag' }, { title: 'Wire neurons', shortcut: 'zoom in, drag dot → dot' }, { title: 'Select neurons', shortcut: 'marquee inside a block' }, { title: 'Duplicate while dragging', shortcut: 'Alt+drag' }, { title: 'Rename', shortcut: 'double-click' }]);
        for (const [g, cs] of groups) root.appendChild(el('div', { class: 'sc-group' }, [el('h4', { text: g }), ...cs.map(c => el('div', { class: 'sc-row' }, [el('span', { text: c.title }), el('kbd', { text: Array.isArray(c.shortcut) ? c.shortcut.map(NA.commands.fmtShortcut).join(' / ') : (c.shortcut.includes(' ') ? c.shortcut : NA.commands.fmtShortcut(c.shortcut)) })]))]));
        modal('shortcuts-modal', true);
    }

    function init() {
        const on = (id, fn) => { const n = $(id); if (n) n.addEventListener('click', fn); };
        on('#tb-menu', (e) => appMenu(e.currentTarget));
        on('#tb-undo', () => NA.commands.run('edit.undo')); on('#tb-redo', () => NA.commands.run('edit.redo')); on('#tb-tidy', () => NA.commands.run('view.tidy'));
        on('#tb-zoom', () => NA.commands.run('view.fit'));
        on('#tb-share', () => NA.commands.run('file.share')); on('#tb-export', () => exportModal('pytorch'));
        for (const b of $$('#tb-mode [data-mode]')) b.addEventListener('click', () => NA.model.setMode(b.dataset.mode));
        $$('.tools .tool').forEach(b => b.addEventListener('click', () => NA.interact.setTool(b.dataset.tool)));
        bus.on('tool:change', (t) => $$('.tools .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t)));
        bus.on('view:change', () => { renderZoom(); positionToolbar(); });
        bus.on('selection:change', () => { positionToolbar(); if (NA.selection.isEmpty()) closePopups(); });
        bus.on('model:change', (e) => { if (e.type === 'transient') { positionToolbar(); return; } refresh(); });
        bus.on('history:change', renderHistory);
        bus.on('project:change', () => { renderCrumbs(); renderTitle(); });
        bus.on('selection:change', () => icons($('#inspector-body'))); bus.on('model:change', (e) => { if (e.type !== 'transient') icons($('#inspector-body')); });
        window.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctx-menu, #popover, #action-bar, #tb-menu')) closePopups(); }, true);
        initExport(); initTemplates();
        refresh();
    }
    NA.ui = { init, refresh, contextMenu, appMenu, closePopups, neuronTargetPopover, connectPopover, colorPopover, activationPopover, renameProject, regionPopover, mergeHint, mergePopover, shrinkPopover, focusInspector, inlineRename, inlineNeuronLabel, exportModal, shortcutsModal, positionToolbar, tint };
})();

// ============================================================
// NA.main — boot
// ============================================================
(() => {
    function init() {
        const q = new URLSearchParams(location.search);
        if (q.get('thumb')) document.body.classList.add('thumb');
        NA.theme.init();
        NA.model.newProject('Untitled model');   // a state exists before any module renders; boot() replaces it
        NA.canvas.init(); NA.interact.init(); NA.history.init();
        NA.inspector.init(); NA.palette.init(); NA.commands.init(); NA.cmdk.init(); NA.minimap.init();
        NA.ui.init(); NA.project.initDrop();
        NA.project.boot();
        if (window.lucide) lucide.createIcons();
        window.addEventListener('beforeunload', () => NA.project.autosaveNow());
        // Self-test hook for headless runs: ?selftest=1 writes a summary into document.title
        if (q.get('selftest')) { const s = document.createElement('script'); s.src = 'selftest.js'; document.body.appendChild(s); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    NA.main = { init };
})();
