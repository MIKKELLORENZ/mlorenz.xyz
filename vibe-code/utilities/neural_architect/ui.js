/* Neural Architect — ui.js
 *
 * NA.inspector (schema-driven forms for whatever is selected), NA.palette (the
 * block / module rail with drag-to-canvas), NA.commands (the single registry
 * behind shortcuts, context menu, floating toolbar and ⌘K) and NA.cmdk.
 */
'use strict';

// ============================================================
// NA.inspector
// ============================================================
(() => {
    const { el, $, bus, debounce, fmtShape, parseShape, fmtNum } = NA.util;
    let body; let writing = false; let lastKey = '';
    const sec = (title, children, opts = {}) => el('section', { class: 'insp-sec' + (opts.class ? ' ' + opts.class : '') }, [el('h4', { class: 'insp-h' }, [title, opts.right || null]), ...[].concat(children)]);
    const row = (label, input, hint) => el('label', { class: 'insp-row' }, [el('span', { class: 'insp-label', text: label }), input, hint ? el('span', { class: 'insp-hint', text: hint }) : null]);
    const write = (fn) => { writing = true; try { fn(); } finally { setTimeout(() => { writing = false; }, 0); } };

    function num(value, onChange, o = {}) { return el('input', { type: 'number', value: value ?? '', min: o.min, max: o.max, step: o.step || 1, class: 'insp-input', onchange: e => onChange(e.target.value === '' ? null : Number(e.target.value)) }); }
    function text(value, onInput, o = {}) { return el('input', { type: 'text', value: value ?? '', placeholder: o.placeholder, class: 'insp-input', oninput: e => onInput(e.target.value), 'data-focus': o.focus }); }
    function area(value, onInput, o = {}) { return el('textarea', { class: 'insp-input insp-area' + (o.mono ? ' mono' : ''), rows: o.rows || 2, placeholder: o.placeholder, oninput: e => onInput(e.target.value) }, [value || '']); }
    function toggle(value, onChange, label) { const inp = el('input', { type: 'checkbox', checked: !!value, onchange: e => onChange(e.target.checked) }); return el('label', { class: 'switch' }, [inp, el('span', { class: 'switch-track' }), label ? el('span', { class: 'switch-label', text: label }) : null]); }
    function select(value, options, onChange) { const s = el('select', { class: 'insp-input', onchange: e => onChange(e.target.value) }, options.map(o => el('option', { value: typeof o === 'string' ? o : o.value, text: typeof o === 'string' ? (NA.catalogue.ACT[o]?.label || o) : o.label }))); s.value = value; return s; }
    function colorPicker(value, onChange) {
        const pal = [null, ...NA.config.REGION_PALETTE];
        return el('div', { class: 'swatches' }, pal.map(c => el('button', { class: 'swatch' + ((value || null) === c ? ' active' : '') + (c ? '' : ' none'), style: c ? `background:${c}` : '', title: c || 'Default', onclick: () => onChange(c) })));
    }
    function paramField(b, p) {
        const v = b.params[p.key];
        const set = (val) => write(() => NA.model.updateBlock(b.id, { params: { [p.key]: val } }));
        switch (p.type) {
            case 'int': return row(p.label, num(v, x => set(Math.round(x ?? p.default)), { min: p.min, max: p.max }));
            case 'number': return row(p.label, num(v, x => set(x ?? p.default), { min: p.min, max: p.max, step: p.step }));
            case 'bool': return el('div', { class: 'insp-row inline' }, [toggle(v, set, p.label)]);
            case 'select': return row(p.label, select(v, p.options, set));
            case 'text': return row(p.label, text(v, set, { placeholder: p.placeholder }));
            case 'code': return row(p.label, area(v, set, { mono: true, placeholder: p.placeholder, rows: 2 }));
            case 'shape': { const f = dimsField(v, val => { if (val.length === 1 && b.regions.length && NA.model.regionsCut(b, val[0]).length && NA.ui.shrinkPopover) NA.ui.shrinkPopover(b, val[0], f); else set(val); }); return row(p.label, f); }
        }
        return null;
    }
    // Activation choices for a wire: none (identity) or one of the catalogue's functions
    const actOptions = () => [{ value: '', label: 'None (linear)' }, ...Object.keys(NA.catalogue.ACT).map(k => ({ value: k, label: NA.catalogue.ACT[k].label }))];
    function actSelect(value, onChange) { return select(value || '', actOptions(), v => onChange(v || null)); }
    // A shape is one number spinner per dimension (+ / × to add or drop dimensions)
    function dimsField(value, onChange) {
        const dims = Array.isArray(value) ? value.slice() : parseShape(value); if (!dims.length) dims.push(1);
        const commit = () => onChange(dims.map(x => Math.max(1, Math.round(Number(x) || 1))));
        const box = el('div', { class: 'dims' });
        dims.forEach((d, i) => {
            const inp = num(d, x => { dims[i] = x ?? 1; commit(); }, { min: 1 }); inp.classList.add('dim');
            box.appendChild(el('div', { class: 'dim-cell' }, [inp, dims.length > 1 ? el('button', { class: 'dim-x', title: 'Remove this dimension', tabindex: '-1', onclick: () => { dims.splice(i, 1); commit(); } }, ['−']) : null]));
            if (i < dims.length - 1) box.appendChild(el('span', { class: 'dim-sep', text: '×' }));
        });
        box.appendChild(el('button', { class: 'dim-add', title: 'Add a dimension (e.g. channels × height × width)', onclick: () => { dims.push(1); commit(); } }, ['+']));
        return box;
    }
    function stat(label, value) { return el('div', { class: 'stat' }, [el('div', { class: 'stat-v', text: value }), el('div', { class: 'stat-l', text: label })]); }

    // ---------- sections ----------
    // The block form: what the block IS (title, size, params), then how it trains (dropout,
    // activation), then how it looks (colour), then the note to a collaborator. Canvas-only state
    // (layout, collapsed) lives on the block's own header buttons, not here.
    function blockSection(b) {
        const k = NA.catalogue.get(b.kind); const kids = [];
        kids.push(el('div', { class: 'kind-pill', style: `--kc:${NA.model.blockColor(b)}`, title: k.desc }, [el('span', { class: 'kind-dot' }), el('span', { text: k.label })]));
        kids.push(row('Title', text(b.title, v => write(() => NA.model.updateBlock(b.id, { title: v })), { focus: 'title' })));
        if (k.hasSize) { const sizeInp = num(b.size, v => { const n = Math.max(1, Math.round(v || 1)); if (NA.model.regionsCut(b, n).length && NA.ui.shrinkPopover) NA.ui.shrinkPopover(b, n, sizeInp); else write(() => NA.model.updateBlock(b.id, { size: n })); }, { min: 1 }); kids.push(row(b.kind === 'conv1d' || b.kind === 'conv2d' ? 'Channels (neurons)' : 'Neurons', sizeInp)); }
        const shapeP = k.params.find(p => p.key === 'shape'), dtypeP = k.params.find(p => p.key === 'dtype');
        if (shapeP && dtypeP) kids.push(el('div', { class: 'insp-pair' }, [paramField(b, shapeP), paramField(b, dtypeP)]));
        for (const p of k.params) if (p.type !== 'hidden' && !(shapeP && dtypeP && (p === shapeP || p === dtypeP))) kids.push(paramField(b, p));
        if (k.fanIn === 'tokens') {
            const g0 = NA.model.graph(); const srcs = NA.graph.incomingAll(g0, b.id, 'in').map(e => NA.model.block(e.from.block, g0)).filter(Boolean);
            if (srcs.length >= 2) kids.push(row('Query from (the others are keys / values)', select(srcs[0].id, srcs.map(s => ({ value: s.id, label: s.title })), v => write(() => NA.model.updateBlock(b.id, { params: { query_from: v } }))), 'Cross-attention: the query attends over the other wires, joined along the token axis.'));
            else if (srcs.length === 1) kids.push(el('p', { class: 'insp-note', text: 'Self-attention. Wire a second source into this block for cross-attention (query here, keys / values from the other).' }));
        }
        // Dropout is a training-only property of the block's output, never a block you route through
        if (b.kind !== 'output' && b.kind !== 'module_out' && b.kind !== 'module_in') {
            const infer = NA.model.get().settings.mode === 'infer';
            const dr = num(b.dropout || 0, v => write(() => NA.model.updateBlock(b.id, { dropout: v ?? 0 })), { min: 0, max: 0.95, step: 0.05 });
            if (infer) dr.classList.add('inactive');
            kids.push(row(infer ? 'Dropout (off in inference view)' : 'Dropout (training only)', dr));
        }
        // Activations are properties of the wires leaving a block, not blocks of their own; with
        // no wire out yet there is nothing to set, so the row waits until there is
        const outs = NA.model.outgoingEdges(b.id);
        if (b.kind !== 'output' && b.kind !== 'module_out' && outs.length) {
            const acts = new Set(outs.map(e => e.act || ''));
            const s = actSelect(acts.size === 1 ? [...acts][0] : '', v => NA.model.setActivation(outs.map(e => e.id), v));
            if (acts.size > 1) { s.insertBefore(el('option', { value: '__mixed', text: 'Mixed — set per wire' }), s.firstChild); s.value = '__mixed'; }
            kids.push(row(outs.length > 1 ? `Activation on ${outs.length} outgoing wires` : 'Activation on the outgoing wire', s));
        }
        kids.push(row('Colour', colorPicker(b.color, c => write(() => NA.model.updateBlock(b.id, { color: c })))));
        kids.push(row('Note', area(b.comment, v => write(() => NA.model.updateBlock(b.id, { comment: v })), { placeholder: 'For whoever opens this next — shows on hover', focus: 'comment' })));
        if (b.kind === 'module') {
            const def = NA.model.get().modules[b.params.def];
            kids.push(el('div', { class: 'btn-row' }, [
                el('button', { class: 'btn', onclick: () => NA.model.enterModule(def.id) }, ['Edit definition']),
                el('button', { class: 'btn ghost', onclick: () => NA.selection.ungroup() }, ['Inline (ungroup)']),
            ]));
            if (def) kids.push(el('p', { class: 'insp-note', text: `${def.name}: ${def.comment || 'no description'} · ${countInst(def.id)} instance(s)` }));
        }
        return sec('Block', kids);
    }
    function countInst(defId) { const st = NA.model.get(); let n = st.blocks.filter(b => b.kind === 'module' && b.params.def === defId).length; for (const id in st.modules) n += st.modules[id].graph.blocks.filter(b => b.kind === 'module' && b.params.def === defId).length; return n; }
    function shapeSection(b) {
        const fan = NA.catalogue.get(b.kind).fanIn && (b._inShapes || []).length > 1;
        const ins = (b._inShapes || []).map(fmtShape).join(fan ? (NA.catalogue.get(b.kind).fanIn === 'tokens' ? ' ⇢ ' : ' ⊕ ') : ' · ') || (b.kind === 'input' ? '—' : 'not connected');
        const outs = b._outShapes ? b._outShapes.map(fmtShape).join(' · ') : fmtShape(b._shape);
        const k = NA.catalogue.get(b.kind); const pc = k.paramCount ? (() => { try { return k.paramCount(b); } catch (_) { return 0; } })() : 0;
        return sec('Shape', [
            el('div', { class: 'shape-flow' }, [el('code', { text: ins }), el('span', { class: 'arrow', text: '→' }), el('code', { text: outs })]),
            b._error ? el('div', { class: 'diag ' + (b._level || 'error'), text: b._error }) : null,
        ], { class: 'dynamic', right: pc ? el('span', { class: 'insp-count', text: `${fmtNum(pc)} params` }) : null });
    }
    function regionsSection(b) {
        const n = NA.model.effectiveSize(b); if (n === null) return null;
        const off = NA.model.neuronOffset(b);
        const rows = b.regions.map(r => el('div', { class: 'region-row', style: `--rc:${r.color || NA.model.blockColor(b)}` }, [
            el('div', { class: 'region-head' }, [
                el('button', { class: 'region-swatch', title: 'Cycle colour', onclick: () => { const pal = NA.config.REGION_PALETTE; const i = pal.indexOf(r.color); write(() => NA.model.updateRegion(b.id, r.id, { color: pal[(i + 1) % pal.length] })); render(); } }),
                text(r.name, v => write(() => NA.model.updateRegion(b.id, r.id, { name: v }))),
                el('button', { class: 'icon-btn', title: 'Select these neurons', onclick: () => { NA.selection.selectNeurons(b.id, Array.from({ length: r.end - r.start }, (_, i) => r.start + i)); NA.canvas.centerOn(NA.model.rect(b).x + 120, NA.model.regionPortY(b, r), Math.max(NA.canvas.view.z, 2.2)); } }, ['⌖']),
                el('button', { class: 'icon-btn danger', title: 'Remove region', onclick: () => { NA.model.removeRegion(b.id, r.id); render(); } }, ['✕']),
            ]),
            el('div', { class: 'region-range' }, [
                num(off + r.start, v => { write(() => NA.model.updateRegion(b.id, r.id, { start: (v ?? off + r.start) - off })); render(); }, { min: off, max: off + n - 1 }), el('span', { text: '→' }),
                num(off + r.end - 1, v => { write(() => NA.model.updateRegion(b.id, r.id, { end: (v ?? off + r.end - 1) - off + 1 })); render(); }, { min: off, max: off + n - 1 }),
                el('span', { class: 'region-count', text: `${r.end - r.start} n` }),
                toggle(r.exposed, v => { write(() => NA.model.updateRegion(b.id, r.id, { exposed: v })); render(); }, 'port'),
            ]),
            area(r.comment, v => write(() => NA.model.updateRegion(b.id, r.id, { comment: v })), { placeholder: 'What these neurons carry', rows: 1 }),
        ]));
        const selN = NA.selection.state.neurons.get(b.id);
        const addBtn = el('button', { class: 'btn ghost small', onclick: () => {
            let start = 0, end = Math.min(n, 8);
            if (selN && selN.size) { const s = [...selN].sort((a, c) => a - c); start = s[0]; end = s[s.length - 1] + 1; }
            else { const last = b.regions[b.regions.length - 1]; if (last) { start = last.end; end = Math.min(n, start + Math.max(1, last.end - last.start)); } }
            if (start >= n) return NA.util.toast('No free neurons left', 'warn');
            const r = NA.model.addRegion(b.id, { name: 'Region ' + (b.regions.length + 1), start, end }); if (r.error) NA.util.toast(r.error, 'warn'); render();
        } }, ['+ Add region' + (selN && selN.size ? ' from selection' : '')]);
        return sec('Regions', [...rows, addBtn]);
    }
    // ---- the neuron list ----
    // Every neuron of the focused block, one row each, region headers between them, virtualised
    // so a 4096-wide layer is one scroll. Click selects (shift = range, ctrl = toggle) and the
    // canvas follows; double-click brings the neuron into view; typing labels it. Above it, how the
    // block shows those neurons on the canvas: List · Grid · Rows.
    const ROW_H = 24; const listScroll = new Map(); let listCtl = null, listOwnsSelection = false, lastPick = null;
    function neuronList(b) {
        const n = NA.model.effectiveSize(b); if (n === null) return null;
        const off = NA.model.neuronOffset(b); const col = NA.model.blockColor(b);
        const selN = NA.selection.state.neurons.get(b.id) || new Set();
        const regs = b.regions.slice().sort((a, c) => a.start - c.start);
        const rows = []; const rowOf = new Map(); let ri = 0, cur = null;
        for (let i = 0; i < n; i++) {
            while (ri < regs.length && regs[ri].start <= i) { if (regs[ri].start === i) rows.push({ type: 'region', r: regs[ri] }); cur = regs[ri]; ri++; }
            if (cur && i >= cur.end) cur = null;
            rowOf.set(i, rows.length); rows.push({ type: 'neuron', i, reg: cur });
        }
        const cur0 = NA.model.resolvedLayout(b);
        const seg = el('div', { class: 'seg small', role: 'radiogroup', title: 'How this block shows its neurons on the canvas' }, [['column', 'List'], ['grid', 'Grid'], ['rows', 'Rows']].map(([v, t]) => el('button', { class: 'seg-btn' + (cur0 === v ? ' active' : ''), 'data-layout': v, onclick: () => NA.model.updateBlock(b.id, { ui: { layout: v } }) }, [t])));
        const box = el('div', { class: 'nlist' }); const inner = el('div', { class: 'nlist-inner', style: `height:${rows.length * ROW_H}px` }); box.appendChild(inner);
        const pick = (idxs, mode) => {
            listOwnsSelection = true;
            if (mode === 'toggle') { for (const i of idxs) NA.selection.toggleNeuron(b.id, i); }
            else NA.selection.setNeurons(b.id, idxs);
        };
        const pickOne = (i, e) => {
            const range = e.shiftKey && lastPick !== null ? Array.from({ length: Math.abs(i - lastPick) + 1 }, (_, k) => Math.min(i, lastPick) + k) : [i];
            pick(range, e.ctrlKey || e.metaKey ? 'toggle' : 'set'); lastPick = i;
        };
        // Bring neuron i into view on the canvas: expand its range if the block is a strip, then centre
        const reveal = (i) => {
            if (NA.model.layoutMode(b) === 'strip') { const row = NA.model.stripRows(b).find(r => i >= r.start && i < r.end); if (row && b.ui.expandedRegion !== row.id) NA.model.updateBlock(b.id, { ui: { expandedRegion: row.id } }); }
            const c = NA.model.neuronCenter(b, i); if (c) NA.canvas.centerOn(c.x + 80, c.y, Math.max(NA.canvas.view.z, 2.2));
        };
        let painted = null;
        const paint = () => {
            const top = box.scrollTop, h = box.clientHeight || 320;
            const a = Math.max(0, Math.floor(top / ROW_H) - 8), z = Math.min(rows.length, Math.ceil((top + h) / ROW_H) + 8);
            if (painted && painted.a === a && painted.z === z) return; painted = { a, z };
            inner.innerHTML = '';
            for (let k = a; k < z; k++) {
                const row = rows[k];
                if (row.type === 'region') {
                    const r = row.r;
                    inner.appendChild(el('div', { class: 'nrow region', style: `top:${k * ROW_H}px;--rc:${r.color || col}`, title: 'Select the whole region', onpointerdown: (e) => { e.preventDefault(); pick(Array.from({ length: r.end - r.start }, (_, q) => r.start + q), e.ctrlKey || e.metaKey ? 'toggle' : 'set'); lastPick = r.end - 1; } },
                        [el('span', { class: 'kind-dot', style: `--kc:${r.color || col}` }), el('span', { class: 'nname', text: r.name }), el('span', { class: 'ncount', text: `${off + r.start}–${off + r.end - 1}` })]));
                    continue;
                }
                const i = row.i; const nn = b.neurons[i] || {};
                const inp = el('input', { type: 'text', class: 'nlabel', value: nn.label || '', placeholder: row.reg ? row.reg.name : '', spellcheck: 'false', 'data-i': i,
                    oninput: (e) => write(() => NA.model.setNeuron(b.id, i, { label: e.target.value })),
                    onfocus: () => { if (!selN.has(i)) pickOne(i, {}); },
                    onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusRow(i + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(i - 1); } else if (e.key === 'Escape') e.target.blur(); } });
                inner.appendChild(el('div', { class: 'nrow' + (selN.has(i) ? ' sel' : ''), style: `top:${k * ROW_H}px;--rc:${row.reg ? (row.reg.color || col) : 'transparent'}`, 'data-i': i,
                    onpointerdown: (e) => { if (e.target === inp) return; e.preventDefault(); pickOne(i, e); },
                    ondblclick: (e) => { if (e.target === inp) return; reveal(i); } },
                    [el('span', { class: 'nidx', text: '#' + (i + off) }), inp]));
            }
        };
        const scrollToRow = (k, center = true) => { const h = box.clientHeight || 320; const y = k * ROW_H; if (center) box.scrollTop = Math.max(0, y - h / 2 + ROW_H / 2); else if (y < box.scrollTop) box.scrollTop = y; else if (y + ROW_H > box.scrollTop + h) box.scrollTop = y + ROW_H - h; paint(); };
        const focusRow = (i) => { if (i < 0 || i >= n) return; scrollToRow(rowOf.get(i), false); const f = inner.querySelector(`input[data-i="${i}"]`); if (f) { f.focus(); f.select(); } };
        box.addEventListener('scroll', () => { listScroll.set(b.id, box.scrollTop); paint(); });
        const section = sec('Neurons', [el('div', { class: 'insp-row inline nlist-head' }, [el('span', { class: 'insp-label', text: 'On canvas' }), seg]), box],
            { right: el('span', { class: 'insp-count', text: `${n} neurons · #${off}–${off + n - 1}${selN.size ? ' · ' + selN.size + ' selected' : ''}` }) });
        // after the section is in the DOM: restore the scroll, or follow a selection made on the canvas
        section._mount = () => {
            box.scrollTop = listScroll.get(b.id) || 0;
            if (selN.size && !listOwnsSelection) { const first = Math.min(...selN); const k = rowOf.get(first); const h = box.clientHeight || 320; if (k !== undefined && (k * ROW_H < box.scrollTop || (k + 1) * ROW_H > box.scrollTop + h)) scrollToRow(k); }
            listOwnsSelection = false; paint();
        };
        listCtl = { blockId: b.id, focusRow, reveal };
        return section;
    }
    // Neurons selected across several blocks: the compact per-block form
    function neuronsSection() {
        const rs = NA.selection.neuronRanges(); if (!rs.length) return null;
        const kids = [];
        for (const { block, idxs } of rs) {
            const off = NA.model.neuronOffset(block);
            kids.push(el('div', { class: 'insp-sub', text: `${block.title} · ${idxs.length === 1 ? '#' + (idxs[0] + off) : idxs.length + ' neurons (#' + (idxs[0] + off) + '–' + (idxs[idxs.length - 1] + off) + ')'}` }));
            const shown = idxs.slice(0, 24);
            for (const i of shown) {
                const nn = block.neurons[i] || {}; const reg = block.regions.find(r => i >= r.start && i < r.end);
                kids.push(el('div', { class: 'neuron-row' }, [
                    el('span', { class: 'neuron-idx', text: '#' + (i + off), title: reg ? reg.name : '' }),
                    text(nn.label, v => write(() => NA.model.setNeuron(block.id, i, { label: v })), { placeholder: reg ? reg.name + ' · label' : 'label', focus: shown.length === 1 ? 'neuron-label' : null }),
                    text(nn.comment, v => write(() => NA.model.setNeuron(block.id, i, { comment: v })), { placeholder: 'comment' }),
                ]));
            }
            if (idxs.length > shown.length) kids.push(el('p', { class: 'insp-note', text: `… and ${idxs.length - shown.length} more` }));
        }
        kids.push(el('div', { class: 'btn-row' }, [
            el('button', { class: 'btn small', onclick: () => NA.commands.run('region.annotate') }, ['Annotate range']),
            el('button', { class: 'btn small', onclick: () => NA.commands.run('neurons.connect') }, ['Connect to…']),
            el('button', { class: 'btn ghost small', onclick: () => NA.selection.clearNeuronEdges() }, ['Clear edges']),
        ]));
        return sec('Neurons', kids);
    }
    function edgeSection() {
        const g = NA.model.graph(); const kids = [];
        for (const id of NA.selection.state.edges) {
            const e = g.edges.find(x => x.id === id); if (!e) continue; const a = NA.model.block(e.from.block, g), c = NA.model.block(e.to.block, g);
            kids.push(el('div', { class: 'edge-row' }, [el('code', { text: `${a.title}${NA.model.portLabel(a, e.from.port) ? ' · ' + NA.model.portLabel(a, e.from.port) : ''} → ${c.title}` }), el('span', { class: 'insp-note', text: fmtShape(NA.graph.portShape(a, e.from.port)) }),
                row('Activation on this wire', actSelect(e.act, v => NA.model.updateEdge(e.id, { act: v })))]));
        }
        for (const id of NA.selection.state.neuronEdges) {
            const e = g.neuronEdges.find(x => x.id === id); if (!e) continue; const a = NA.model.block(e.from.block, g), c = NA.model.block(e.to.block, g);
            kids.push(el('div', { class: 'edge-row' }, [el('code', { text: `${a.title} #${e.from.idx} → ${c.title} #${e.to.idx}` }),
                row('Initial weight (blank = random)', num(e.init, v => write(() => NA.model.updateNeuronEdge(e.id, { init: v })), { step: 0.05 })),
                row('Comment', text(e.comment, v => write(() => NA.model.updateNeuronEdge(e.id, { comment: v }))))]));
        }
        if (!kids.length) return null;
        kids.push(el('div', { class: 'btn-row' }, [NA.selection.state.edges.size === 1 ? el('button', { class: 'btn small', onclick: () => NA.cmdk.open('insert on edge: ') }, ['Insert block here…']) : null, el('button', { class: 'btn ghost small danger', onclick: () => NA.selection.deleteSelected() }, ['Delete'])]));
        return sec(NA.selection.state.edges.size ? 'Connection' : 'Neuron edge', kids);
    }
    function groupSection() {
        const g = NA.model.graph(); const kids = [];
        for (const id of NA.selection.state.groups) {
            const gr = g.groups.find(x => x.id === id); if (!gr) continue;
            kids.push(row('Frame name', text(gr.name, v => write(() => NA.model.updateGroup(gr.id, { name: v })))));
            kids.push(row('Comment', area(gr.comment, v => write(() => NA.model.updateGroup(gr.id, { comment: v })))));
            kids.push(row('Colour', colorPicker(gr.color, c => write(() => NA.model.updateGroup(gr.id, { color: c })))));
            kids.push(el('button', { class: 'btn ghost small', onclick: () => { NA.model.removeGroup(gr.id); NA.selection.clear(); } }, ['Remove frame (keep blocks)']));
        }
        return kids.length ? sec('Frame', kids) : null;
    }
    // Several blocks: the things that make sense to do to all of them at once
    function multiSection(bs) {
        const withNeurons = bs.filter(b => NA.model.effectiveSize(b) !== null);
        const layouts = new Set(withNeurons.map(b => NA.model.resolvedLayout(b)));
        const allCollapsed = withNeurons.length && withNeurons.every(b => b.ui.collapsed);
        return sec(`${bs.length} blocks`, [
            el('p', { class: 'insp-note', text: bs.map(b => b.title).slice(0, 8).join(', ') + (bs.length > 8 ? '…' : '') }),
            withNeurons.length ? el('div', { class: 'insp-row inline nlist-head' }, [el('span', { class: 'insp-label', text: 'On canvas' }),
                el('div', { class: 'seg small' }, [...[['column', 'List'], ['grid', 'Grid'], ['rows', 'Rows']].map(([v, t]) => el('button', { class: 'seg-btn' + (layouts.size === 1 && layouts.has(v) && !allCollapsed ? ' active' : ''), 'data-layout': v, onclick: () => { for (const b of withNeurons) NA.model.updateBlock(b.id, { ui: { layout: v, collapsed: false } }); } }, [t])),
                    el('button', { class: 'seg-btn' + (allCollapsed ? ' active' : ''), 'data-layout': 'collapsed', title: 'Title only (C)', onclick: () => { for (const b of withNeurons) NA.model.updateBlock(b.id, { ui: { collapsed: !allCollapsed } }); } }, ['Collapsed'])])]) : null,
            el('div', { class: 'btn-row wrap' }, [
                el('button', { class: 'btn small', onclick: () => NA.commands.run('view.tidy') }, ['Tidy these']),
                el('button', { class: 'btn small', onclick: () => NA.commands.run('insert.batchnorm') }, ['+ BatchNorm']),
                el('button', { class: 'btn small', onclick: () => NA.commands.run('insert.layernorm') }, ['+ LayerNorm']),
                el('button', { class: 'btn small', onclick: () => NA.commands.run('edit.groupModule') }, ['Group into module']),
                el('button', { class: 'btn small', onclick: () => NA.commands.run('edit.groupFrame') }, ['Frame']),
            ]),
            row('Activation on their outgoing wires', actSelect('', v => NA.selection.setActivation(v))),
            row('Dropout on their outputs (training only)', num('', v => { if (v !== null) NA.selection.setDropout(v); }, { min: 0, max: 0.95, step: 0.05 })),
            row('Colour', colorPicker(null, c => NA.selection.setColor(c))),
        ]);
    }
    function projectSection() {
        const st = NA.model.get(); const g = NA.model.graph(); const cur = NA.model.currentModule();
        const diags = NA.graph.diagnostics();
        const kids = [];
        if (cur) {
            kids.push(row('Module name', text(cur.name, v => write(() => NA.model.updateModuleDef(cur.id, { name: v })))));
            kids.push(row('Description', area(cur.comment, v => write(() => NA.model.updateModuleDef(cur.id, { comment: v })))));
            kids.push(el('p', { class: 'insp-note', text: 'Module inputs / outputs are the boundary blocks; their vertical order is the port order.' }));
            kids.push(el('div', { class: 'btn-row' }, [el('button', { class: 'btn small', onclick: () => NA.model.addBlock('module_in', centreish(), { title: 'input' }) }, ['+ Input port']), el('button', { class: 'btn small', onclick: () => NA.model.addBlock('module_out', centreish(), { title: 'output' }) }, ['+ Output port']), el('button', { class: 'btn ghost small', onclick: () => NA.model.exitModule() }, ['← Back'])]));
        } else {
            kids.push(row('Model name', text(st.meta.name, v => write(() => { st.meta.name = v; NA.model.emit('update'); }))));
            kids.push(row('Python class', text(st.meta.className, v => write(() => { st.meta.className = v; NA.model.emit('update'); }), { placeholder: NA.util.pascal(st.meta.name, 'Model') })));
            kids.push(row('Description', area(st.meta.description, v => write(() => { st.meta.description = v; NA.model.emit('update'); }), { placeholder: 'Becomes the module docstring' })));
        }
        const ins = NA.graph.inputs(g), outs = NA.graph.outputs(g);
        if (ins.length || outs.length) kids.push(el('div', { class: 'io-list' }, [...ins.map(b => el('div', { class: 'io in' }, [el('b', { text: b.title }), el('code', { text: fmtShape(b._shape) })])), ...outs.map(b => el('div', { class: 'io out' }, [el('b', { text: b.title }), el('code', { text: fmtShape(b._shape) })]))]));
        const problems = diags.filter(d => d.level !== 'info');
        if (problems.length) kids.push(el('div', { class: 'diag-list' }, problems.slice(0, 12).map(d => { const b = d.block && NA.model.block(d.block, g); return el('button', { class: 'diag ' + d.level, onclick: () => { if (b) { NA.selection.selectBlocks([b.id]); NA.canvas.centerOn(b.pos.x + 120, b.pos.y + 60); } } }, [(b ? b.title + ': ' : '') + d.message]); })));
        else if (g.blocks.length) kids.push(el('div', { class: 'diag ok', text: 'All shapes resolve' }));
        const s = st.settings;
        if (!cur && g.blocks.length) {
            // The top bar owns the Training / Inference switch; here is only what the view means for THIS model
            const tr = [...st.blocks, ...Object.values(st.modules).flatMap(m => m.graph.blocks)];
            const drops = tr.filter(b => b.dropout > 0).length, bns = tr.filter(b => b.kind === 'batchnorm').length, inner = tr.filter(b => /^(transformer|rnn|attention)$/.test(b.kind) && b.params.dropout > 0).length;
            const infer = s.mode === 'infer';
            const bits = []; if (drops) bits.push(`dropout on ${drops} block${drops > 1 ? 's' : ''}`); if (inner) bits.push(`internal dropout in ${inner}`); if (bns) bits.push(`${bns} BatchNorm`);
            kids.push(el('p', { class: 'insp-note', text: bits.length ? (infer ? 'Inference view — off: ' : 'Training view — active: ') + bits.join(', ') : 'Trains and infers identically — nothing here is training-only.' }));
        }
        const det = el('details', { class: 'insp-details' }, [
            el('summary', {}, [el('span', { text: 'Canvas' })]),
            el('div', { class: 'settings' }, [
                toggle(s.grid, v => { s.grid = v; NA.canvas.invalidate('all'); }, 'Grid'), toggle(s.snap, v => { s.snap = v; }, 'Snap to lanes (hold Alt to place freely)'),
                toggle(s.showShapes, v => { s.showShapes = v; NA.canvas.invalidate('all'); }, 'Shapes on wires'), toggle(s.animateWires, v => { s.animateWires = v; }, 'Animate hovered wires'),
                row('Scroll wheel', select(s.wheel || 'auto', [{ value: 'auto', label: 'Auto (mouse zooms, trackpad pans)' }, { value: 'zoom', label: 'Always zoom' }, { value: 'pan', label: 'Always pan' }], v => { s.wheel = v; })),
            ])]);
        det.open = settingsOpen; det.addEventListener('toggle', () => { settingsOpen = det.open; });
        kids.push(det);
        return sec(cur ? 'Module' : 'Model', kids);
    }
    let settingsOpen = false;
    const centreish = () => { const v = NA.canvas.visible(); return { x: v.x + v.w / 2 - 120 + (Math.random() - 0.5) * 80, y: v.y + v.h / 2 - 40 + (Math.random() - 0.5) * 80 }; };

    function render() {
        if (!body || !NA.model.get()) return;
        const sel = NA.selection.state; const bs = NA.selection.blocks();
        const key = JSON.stringify([[...sel.blocks], [...sel.edges], [...sel.neuronEdges], [...sel.neurons].map(([k, v]) => [k, [...v]]), [...sel.groups], NA.model.get().view.path]);
        const focused = document.activeElement && body.contains(document.activeElement) ? { f: document.activeElement.dataset.focus, s: document.activeElement.selectionStart } : null;
        body.innerHTML = '';
        const parts = [];
        // One block in focus — selected itself, or the block whose neurons are selected — gets the
        // full form ending in its neuron list. Neurons across several blocks get the compact form.
        const nb = sel.neurons.size === 1 ? NA.model.block([...sel.neurons.keys()][0]) : null;
        const focus = bs.length === 1 ? bs[0] : (bs.length === 0 && nb ? nb : null);
        listCtl = null;
        if (focus) { parts.push(blockSection(focus)); parts.push(shapeSection(focus)); parts.push(neuronList(focus)); parts.push(regionsSection(focus)); }
        else if (bs.length > 1) parts.push(multiSection(bs));
        if (sel.neurons.size && !focus) parts.push(neuronsSection());
        parts.push(edgeSection()); parts.push(groupSection());
        if (!parts.some(Boolean)) parts.push(projectSection());
        for (const p of parts) if (p) { body.appendChild(p); if (p._mount) p._mount(); }
        lastKey = key;
        if (focused && focused.f) { const n = body.querySelector(`[data-focus="${focused.f}"]`); if (n) { n.focus(); try { n.selectionStart = n.selectionEnd = focused.s; } catch (_) {} } }
    }
    // Light refresh: only the dynamic (shape) section, so typing keeps focus
    function refreshDynamic() {
        const bs = NA.selection.blocks(); if (bs.length !== 1) return;
        const old = body.querySelector('.insp-sec.dynamic'); if (!old) return;
        old.replaceWith(shapeSection(bs[0]));
    }
    function focusField(name) { const n = body && body.querySelector(`[data-focus="${name}"]`); if (n) { n.focus(); n.select && n.select(); } }
    // Put the caret in neuron idx's label row of the list (the block gets selected first if needed)
    function focusNeuron(blockId, idx) {
        if (!listCtl || listCtl.blockId !== blockId) { NA.selection.selectBlocks([blockId]); render(); }
        if (listCtl && listCtl.blockId === blockId) listCtl.focusRow(idx);
    }
    function init() {
        body = $('#inspector-body');
        bus.on('selection:change', render);
        bus.on('model:change', (e) => { if (e.type === 'transient') return; if (writing) refreshDynamic(); else render(); });
        render();
    }
    NA.inspector = { init, render, focusField, focusNeuron };
})();

// ============================================================
// NA.palette — left rail: block kinds, modules, drag to canvas
// ============================================================
(() => {
    const { el, $, $$, bus } = NA.util;
    let ghostEl = null;
    function addAt(kind, wx, wy, extra = {}) {
        const cur = NA.model.currentModule();
        if (!cur && (kind === 'module_in' || kind === 'module_out')) return NA.util.toast('Boundary ports only exist inside a module', 'warn');
        if (cur && (kind === 'input' || kind === 'output')) return NA.util.toast('Use module ports inside a module (see the inspector)', 'warn');
        const pos = NA.model.get().settings.snap ? NA.model.snapPos(wx - 120, wy - 30) : { x: Math.round((wx - 120) / 8) * 8, y: Math.round((wy - 30) / 8) * 8 };
        const b = NA.model.addBlock(kind, pos, extra);
        NA.selection.selectBlocks([b.id]);
        return b;
    }
    // A palette click adds the block after the selected one: next lane to the right, same row,
    // wired from its output — so Input → Linear → Linear is three clicks. With nothing selected
    // (or an Input, which has no incoming wire) it lands in the first free row of the viewport.
    function addAtCentre(kind, extra) {
        const g = NA.model.graph(); const sel = NA.selection.blocks();
        const anchor = sel.length === 1 && kind !== 'input' && kind !== 'module_in' ? sel[0] : null;
        const lw = NA.model.laneWidth();
        const overlaps = (r, self) => g.blocks.some(b => { if (b.id === self.id) return false; const q = NA.model.rect(b, g); return r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y; });
        let b;
        if (anchor) {
            const ar = NA.model.rect(anchor, g);
            b = addAt(kind, ar.x + lw + 120, ar.y + 30, extra); if (!b) return b;
            for (let i = 0; i < 40 && overlaps(NA.model.rect(b, g), b); i++) NA.model.moveBlocks([b.id], 0, NA.config.SNAP_Y * 4, false);
            const inPort = NA.model.inputPortIds(b, g)[0];
            if (inPort && NA.model.outputPortIds(anchor).includes('out') && anchor.kind !== 'output' && anchor.kind !== 'module_out') NA.model.addEdge({ block: anchor.id, port: 'out' }, { block: b.id, port: inPort });
        } else {
            const v = NA.canvas.visible();
            b = addAt(kind, v.x + v.w / 2, v.y + v.h / 2, extra); if (!b) return b;
            for (let i = 0; i < 40 && overlaps(NA.model.rect(b, g), b); i++) NA.model.moveBlocks([b.id], 0, NA.config.SNAP_Y * 4, false);
        }
        NA.selection.selectBlocks([b.id]);
        const r = NA.model.rect(b, g), v = NA.canvas.visible();
        if (r.x < v.x || r.x + r.w > v.x + v.w || r.y < v.y || r.y + r.h > v.y + v.h) NA.canvas.centerOn(r.x + r.w / 2, r.y + Math.min(r.h / 2, v.h / 3));
        return b;
    }
    function addModuleAt(def, wx, wy) { NA.model.ensureModuleDef(def); return addAt('module', wx, wy, { title: def.name, params: { def: def.id } }); }
    function addModuleAtCentre(def) { const v = NA.canvas.visible(); return addModuleAt(def, v.x + v.w / 2, v.y + v.h / 2); }

    function card(label, desc, color, onDrop, onClick, extra) {
        const c = el('button', { class: 'pcard', style: `--kc:${color}`, title: desc }, [el('span', { class: 'pcard-dot' }), el('span', { class: 'pcard-label', text: label }), extra || null]);
        let start = null, dragging = false;
        c.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; start = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
        c.addEventListener('pointermove', (e) => {
            if (!start) return;
            if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) { dragging = true; ghostEl = el('div', { class: 'drag-ghost', text: label, style: `--kc:${color}` }); document.body.appendChild(ghostEl); }
            if (dragging) { ghostEl.style.left = e.clientX + 12 + 'px'; ghostEl.style.top = e.clientY + 12 + 'px'; const over = overStage(e); ghostEl.classList.toggle('ok', over); }
        });
        const end = (e) => {
            if (!start) return; start = null;
            if (dragging) { dragging = false; ghostEl.remove(); ghostEl = null; if (overStage(e)) { const r = NA.canvas.stage.getBoundingClientRect(); const w = NA.canvas.toWorld(e.clientX - r.left, e.clientY - r.top); onDrop(w.x, w.y); } }
            else onClick();
        };
        c.addEventListener('pointerup', end); c.addEventListener('pointercancel', () => { start = null; if (dragging) { dragging = false; ghostEl && ghostEl.remove(); ghostEl = null; } });
        return c;
    }
    const overStage = (e) => { const r = NA.canvas.stage.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };

    // One column, groups separated by a hairline, a filter box on top. The kind's description
    // is the card's tooltip; the hint about click-vs-drag lives in the card's title too.
    let filter = '';
    function renderBlocks() {
        const root = $('#palette'); root.innerHTML = '';
        const q = filter.trim().toLowerCase();
        for (const grp of NA.catalogue.GROUPS) {
            const kinds = NA.catalogue.kinds().filter(k => { const d = NA.catalogue.get(k); return d.group === grp.id && !d.hidden && k !== 'module' && (!q || d.label.toLowerCase().includes(q) || (d.desc || '').toLowerCase().includes(q)); });
            if (!kinds.length) continue;
            root.appendChild(el('div', { class: 'pgroup', 'aria-label': grp.label }, [el('div', { class: 'plist' }, kinds.map(k => { const d = NA.catalogue.get(k); return card(d.label, d.desc + ' — click to add after the selection, drag to place', d.color, (x, y) => addAt(k, x, y), () => addAtCentre(k)); }))]));
        }
        if (!root.children.length) root.appendChild(el('p', { class: 'rail-tip', text: 'No block matches' }));
    }
    function renderModules() {
        const root = $('#module-palette'); root.innerHTML = '';
        const st = NA.model.get();
        const mine = Object.values(st.modules).filter(m => !m.builtin);
        const builtins = NA.templates.modules.filter(m => !st.modules[m.id]).concat(Object.values(st.modules).filter(m => m.builtin));
        const color = NA.config.COLORS.module;
        const modCard = (def, own) => card(def.name, def.comment, color, (x, y) => addModuleAt(def, x, y), () => addModuleAtCentre(def),
            own ? el('span', { class: 'pcard-actions' }, [el('span', { class: 'mini', title: 'Edit definition', onclick: (e) => { e.stopPropagation(); NA.model.enterModule(def.id); } }, ['✎']), el('span', { class: 'mini danger', title: 'Delete definition', onclick: (e) => { e.stopPropagation(); const r = NA.model.removeModuleDef(def.id); if (r.error) NA.util.toast(r.error, 'warn'); else renderModules(); } }, ['✕'])]) : null);
        root.appendChild(el('div', { class: 'pgroup' }, [el('div', { class: 'pgroup-h', text: 'This model' }), mine.length ? el('div', { class: 'plist' }, mine.map(m => modCard(m, true))) : el('p', { class: 'rail-tip', text: `Select blocks and press ${NA.commands.fmtShortcut('Mod+G')} to make a module.` })]));
        root.appendChild(el('div', { class: 'pgroup' }, [el('div', { class: 'pgroup-h', text: 'Library' }), el('div', { class: 'plist' }, builtins.map(m => modCard(m, false)))]));
    }
    function init() {
        renderBlocks(); renderModules();
        const search = $('#palette-search');
        if (search) { search.addEventListener('input', () => { filter = search.value; renderBlocks(); }); search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; filter = ''; renderBlocks(); search.blur(); } e.stopPropagation(); }); }
        $$('.rail-tabs button').forEach(btn => btn.addEventListener('click', () => { $$('.rail-tabs button').forEach(b => b.classList.toggle('active', b === btn)); $$('.rail-pane').forEach(p => p.classList.toggle('active', p.id === btn.dataset.rtab)); if (search) search.hidden = btn.dataset.rtab !== 'palette'; }));
        bus.on('model:change', (e) => { if (e.type === 'replace' || e.type === 'add' || e.type === 'update') renderModules(); });
    }
    NA.palette = { init, addAt, addAtCentre, addModuleAt, addModuleAtCentre, renderModules };
})();

// ============================================================
// NA.commands — one registry for shortcuts, menus, toolbar, ⌘K
// ============================================================
(() => {
    const list = []; const byId = new Map();
    function register(c) { byId.set(c.id, c); list.push(c); return c; }
    function run(id, arg) { const c = byId.get(id); if (!c) return; if (c.when && !c.when()) return; try { c.run(arg); } catch (e) { console.error(e); NA.util.toast(e.message, 'error'); } }
    function available() { return list.filter(c => !c.when || c.when()); }
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    function fmtShortcut(s) { if (!s) return ''; return s.split('+').map(p => p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : p === 'Shift' ? '⇧' : p === 'Alt' ? (isMac ? '⌥' : 'Alt') : p.replace('Arrow', '')).join(isMac ? '' : '+'); }
    function matches(sc, e) {
        const parts = sc.split('+'); const key = parts.pop();
        const mod = parts.includes('Mod'), shift = parts.includes('Shift'), alt = parts.includes('Alt');
        if (mod !== (e.ctrlKey || e.metaKey)) return false; if (alt !== e.altKey) return false;
        if (shift !== e.shiftKey && !(key.length === 1 && /[?+_]/.test(key))) return false;
        const k = e.key;
        if (key.length === 1) return k.toLowerCase() === key.toLowerCase() || (key === '+' && k === '=') || (key === '?' && k === '?');
        return k === key;
    }
    const isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
    function onKey(e) {
        if (isTyping()) {
            const a = document.activeElement;
            // The inspector mirrors the model live, so Ctrl+Z there means "undo my last edit", not the text box's own history
            if (a.closest && a.closest('.inspector') && (e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) {
                e.preventDefault(); a.blur(); NA.history.commit();
                run(e.key.toLowerCase() === 'y' || e.shiftKey ? 'edit.redo' : 'edit.undo'); return;
            }
            if (e.key === 'Escape') a.blur(); return;
        }
        if (NA.cmdk.isOpen()) return;
        for (const c of list) for (const sc of [].concat(c.shortcut || [])) if (matches(sc, e)) { if (c.when && !c.when()) continue; e.preventDefault(); run(c.id); return; }
    }
    const sel = () => NA.selection.state;
    const hasBlocks = () => sel().blocks.size > 0;
    const hasNeurons = () => sel().neurons.size > 0;
    const notEmpty = () => !NA.selection.isEmpty();
    function ask(title, def) { const v = window.prompt(title, def); return v === null ? null : (v.trim() || def); }

    function init() {
        window.addEventListener('keydown', onKey);
        // tools
        register({ id: 'tool.select', title: 'Select tool', group: 'Tools', shortcut: 'V', icon: 'mouse-pointer-2', run: () => NA.interact.setTool('select') });
        register({ id: 'tool.hand', title: 'Hand tool', group: 'Tools', shortcut: 'H', icon: 'hand', run: () => NA.interact.setTool('hand') });
        register({ id: 'tool.wire', title: 'Wire tool', group: 'Tools', shortcut: 'W', icon: 'spline', run: () => NA.interact.setTool('wire') });
        // file
        register({ id: 'file.new', title: 'New model', group: 'File', icon: 'file-plus', run: () => NA.project.newProject() });
        register({ id: 'file.open', title: 'Open…', group: 'File', shortcut: 'Mod+O', icon: 'folder-open', run: () => NA.project.openDialog() });
        register({ id: 'file.save', title: 'Save', group: 'File', shortcut: 'Mod+S', icon: 'save', run: () => NA.project.save() });
        register({ id: 'file.saveAs', title: 'Save as…', group: 'File', shortcut: 'Mod+Shift+S', icon: 'save-all', run: () => NA.project.saveAs() });
        register({ id: 'file.share', title: 'Copy link to this model', menuTitle: 'Copy link', group: 'File', icon: 'link', run: () => NA.project.shareLink() });
        register({ id: 'file.restorePrev', title: 'Restore the model a link replaced', menuTitle: 'Restore previous model', group: 'File', icon: 'history', when: () => NA.project.hasPrev(), run: () => NA.project.restorePrev() });
        register({ id: 'file.export.pytorch', title: 'Export PyTorch module (.py)', menuTitle: 'Export PyTorch…', group: 'File', shortcut: 'Mod+E', icon: 'download', run: () => NA.ui.exportModal('pytorch') });
        register({ id: 'file.export.keras', title: 'Export Keras JSON', menuTitle: 'Export Keras…', group: 'File', shortcut: 'Mod+Shift+E', icon: 'download', run: () => NA.ui.exportModal('keras') });
        register({ id: 'file.templates', title: 'Templates…', group: 'File', icon: 'layout-template', run: () => NA.util.modal('templates-modal', true) });
        // edit
        register({ id: 'edit.undo', title: 'Undo', group: 'Edit', shortcut: 'Mod+Z', icon: 'undo-2', run: () => NA.history.undo() });
        register({ id: 'edit.redo', title: 'Redo', group: 'Edit', shortcut: ['Mod+Shift+Z', 'Mod+Y'], icon: 'redo-2', run: () => NA.history.redo() });
        register({ id: 'block.collapse', title: 'Collapse / expand', group: 'Block', shortcut: 'C', icon: 'chevrons-down-up', when: hasBlocks, toolbar: true, ctx: true, run: () => NA.selection.toggleSelectedUi('collapse') });
        register({ id: 'block.layout', title: 'List / grid / rows', group: 'Block', shortcut: 'L', icon: 'rows-3', when: hasBlocks, toolbar: true, ctx: true, run: () => NA.selection.toggleSelectedUi('layout') });
        register({ id: 'view.collapseAll', title: 'Collapse all blocks', group: 'View', shortcut: 'Shift+C', icon: 'chevrons-down-up', run: () => { const bs = NA.model.graph().blocks; const all = bs.every(b => b.ui.collapsed || NA.model.effectiveSize(b) === null); for (const b of bs) NA.model.updateBlock(b.id, { ui: { collapsed: !all } }); } });
        register({ id: 'edit.delete', title: 'Delete', group: 'Edit', shortcut: ['Delete', 'Backspace'], icon: 'trash-2', when: notEmpty, toolbar: true, ctx: true, run: () => NA.selection.deleteSelected() });
        register({ id: 'edit.duplicate', title: 'Duplicate', group: 'Edit', shortcut: 'Mod+D', icon: 'copy', when: hasBlocks, toolbar: true, ctx: true, run: () => NA.selection.duplicate() });
        register({ id: 'edit.selectAll', title: 'Select all', group: 'Edit', shortcut: 'Mod+A', icon: 'box-select', run: () => NA.selection.selectAll() });
        register({ id: 'edit.deselect', title: 'Deselect', group: 'Edit', shortcut: 'Escape', run: () => { NA.selection.clear(); NA.ui.closePopups(); } });
        register({ id: 'edit.rename', title: 'Rename', group: 'Edit', shortcut: 'F2', icon: 'pencil', when: () => sel().blocks.size === 1, ctx: true, run: () => NA.ui.inlineRename(NA.selection.blocks()[0]) });
        register({ id: 'edit.groupModule', title: 'Group into module', group: 'Edit', shortcut: 'Mod+G', icon: 'box', when: hasBlocks, toolbar: true, ctx: true, run: () => { const n = ask('Module name', 'Module'); if (n !== null) NA.selection.groupModule(n); } });
        register({ id: 'edit.ungroup', title: 'Ungroup / inline module', group: 'Edit', shortcut: 'Mod+Shift+G', icon: 'ungroup', when: () => NA.selection.blocks().some(b => b.kind === 'module') || sel().groups.size > 0, ctx: true, run: () => NA.selection.ungroup() });
        register({ id: 'edit.groupFrame', title: 'Frame (visual group)', group: 'Edit', shortcut: 'Mod+Shift+F', icon: 'frame', when: hasBlocks, toolbar: true, ctx: true, run: () => { const n = ask('Frame name', 'Group'); if (n !== null) NA.selection.groupFrame(n); } });
        register({ id: 'edit.enterModule', title: 'Edit module definition', group: 'Edit', shortcut: 'Enter', icon: 'log-in', when: () => sel().blocks.size === 1 && NA.selection.blocks()[0].kind === 'module', ctx: true, run: () => NA.model.enterModule(NA.selection.blocks()[0].params.def) });
        register({ id: 'nav.up', title: 'Leave module', group: 'View', shortcut: 'Mod+ArrowUp', icon: 'corner-left-up', when: () => NA.model.get().view.path.length > 0, run: () => NA.model.exitModule() });
        // batch inserts
        register({ id: 'act.set', title: 'Activation…', group: 'Selection', shortcut: 'A', icon: 'activity', when: () => hasBlocks() || sel().edges.size > 0, toolbar: true, ctx: true, run: () => NA.ui.activationPopover() });
        for (const [id, kind, title, extra] of [['insert.batchnorm', 'batchnorm', 'Batch-normalize (insert after)', {}], ['insert.layernorm', 'layernorm', 'Layer-normalize (insert after)', {}]])
            register({ id, title, group: 'Selection', icon: 'plus', when: hasBlocks, toolbar: true, ctx: true, run: () => NA.selection.insertAfterSelected(kind, extra) });
        register({ id: 'block.dropout', title: 'Dropout…', group: 'Selection', icon: 'droplets', when: hasBlocks, toolbar: true, ctx: true, run: () => { const v = ask('Dropout probability on the selected blocks (0 = none, training only)', '0.2'); if (v !== null) NA.selection.setDropout(+v); } });
        register({ id: 'view.mode', title: 'Toggle training / inference view', group: 'View', shortcut: 'Shift+I', icon: 'toggle-left', run: () => NA.model.setMode(NA.model.get().settings.mode === 'infer' ? 'train' : 'infer') });
        register({ id: 'insert.residual', title: 'Add residual skip', group: 'Selection', icon: 'git-merge', when: () => sel().blocks.size === 2, toolbar: true, ctx: true, run: () => NA.selection.addResidual() });
        register({ id: 'region.annotate', title: 'Annotate range as region', group: 'Selection', shortcut: 'R', icon: 'tag', when: hasNeurons, toolbar: true, ctx: true, run: () => { const n = ask('Region name', 'Region'); if (n !== null) NA.selection.annotateRange(n); } });
        register({ id: 'neurons.label', title: 'Label neuron', group: 'Selection', shortcut: 'Enter', icon: 'pencil', when: () => sel().neurons.size === 1 && [...sel().neurons.values()][0].size === 1 && !sel().blocks.size, ctx: true, run: () => { const [[id, set]] = [...sel().neurons]; NA.ui.inlineNeuronLabel(NA.model.block(id), [...set][0]); } });
        register({ id: 'neurons.connect', title: 'Connect neurons to…', group: 'Selection', icon: 'spline', when: hasNeurons, toolbar: true, ctx: true, run: () => NA.ui.connectPopover() });
        register({ id: 'neurons.clear', title: 'Remove their neuron edges', group: 'Selection', icon: 'unlink', when: hasNeurons, ctx: true, run: () => NA.selection.clearNeuronEdges() });
        register({ id: 'edge.insert', title: 'Insert block on connection…', group: 'Selection', icon: 'plus', when: () => sel().edges.size === 1, toolbar: true, ctx: true, run: () => NA.cmdk.open('insert on edge: ') });
        register({ id: 'sel.color', title: 'Colour…', group: 'Selection', icon: 'palette', when: hasBlocks, ctx: true, run: () => NA.ui.colorPopover() });
        register({ id: 'sel.comment', title: 'Comment…', group: 'Selection', icon: 'message-square', when: () => sel().blocks.size === 1, ctx: true, run: () => NA.ui.focusInspector('comment') });
        // view
        register({ id: 'view.fit', title: 'Fit all', group: 'View', shortcut: 'F', icon: 'maximize', run: () => NA.canvas.fitAll() });
        register({ id: 'view.fitSel', title: 'Fit selection', group: 'View', shortcut: 'Shift+F', icon: 'scan', when: notEmpty, run: () => NA.canvas.fit(NA.selection.bounds(), 120, true, 4) });
        register({ id: 'view.zoom100', title: 'Zoom to 100%', group: 'View', shortcut: '0', icon: 'zoom-in', run: () => { const v = NA.canvas.view; const { W, H } = NA.canvas.size; NA.canvas.setView(v.x + W / (2 * v.z) - W / 2, v.y + H / (2 * v.z) - H / 2, 1); } });
        register({ id: 'view.zoomIn', title: 'Zoom in', group: 'View', shortcut: ['+', '='], icon: 'zoom-in', run: () => { const { W, H } = NA.canvas.size; NA.canvas.zoomAt(W / 2, H / 2, 1.25); } });
        register({ id: 'view.zoomOut', title: 'Zoom out', group: 'View', shortcut: '-', icon: 'zoom-out', run: () => { const { W, H } = NA.canvas.size; NA.canvas.zoomAt(W / 2, H / 2, 0.8); } });
        register({ id: 'view.tidy', title: 'Tidy up (the selection, or everything)', menuTitle: 'Tidy up', group: 'View', shortcut: 'Shift+T', icon: 'layout-grid', run: () => { const ids = sel().blocks.size > 1 ? [...sel().blocks] : null; NA.layout.auto(NA.model.graph(), ids); NA.model.emit('move', {}); if (!ids) NA.canvas.fitAll(); } });
        register({ id: 'view.theme', title: 'Toggle theme', get menuTitle() { return NA.theme.current === 'dark' ? 'Light appearance' : 'Dark appearance'; }, group: 'View', shortcut: 'T', icon: 'sun-moon', run: () => NA.theme.toggle() });
        register({ id: 'view.grid', title: 'Toggle grid', group: 'View', shortcut: 'Mod+\'', icon: 'grid-3x3', run: () => { const s = NA.model.get().settings; s.grid = !s.grid; NA.canvas.invalidate('all'); } });
        register({ id: 'view.snap', title: 'Toggle snap to lanes', group: 'View', icon: 'magnet', run: () => { const s = NA.model.get().settings; s.snap = !s.snap; NA.util.toast('Snap to lanes ' + (s.snap ? 'on' : 'off')); } });
        for (const [key, dx, dy] of [['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]]) {
            // Arrows move by one lane / one snap step when snapping, else by fine grid units
            register({ id: 'nudge.' + key, title: 'Nudge ' + key.replace('Arrow', '').toLowerCase(), group: 'Edit', shortcut: key, hidden: true, when: hasBlocks, run: () => { const s = NA.model.get().settings.snap; NA.model.moveBlocks([...sel().blocks], dx * (s ? NA.model.laneWidth() : 8), dy * (s ? NA.config.SNAP_Y : 8), false); } });
            register({ id: 'nudge10.' + key, title: 'Nudge ' + key.replace('Arrow', '').toLowerCase() + ' ×10', group: 'Edit', shortcut: 'Shift+' + key, hidden: true, when: hasBlocks, run: () => NA.model.moveBlocks([...sel().blocks], dx * 80, dy * 80, false) });
        }
        register({ id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', shortcut: '?', icon: 'keyboard', run: () => NA.ui.shortcutsModal() });
        register({ id: 'palette.open', title: 'Command palette', group: 'Help', shortcut: 'Mod+K', icon: 'search', run: () => NA.cmdk.open() });
    }
    NA.commands = { init, register, run, list, available, fmtShortcut, byId: (id) => byId.get(id) };
})();

// ============================================================
// NA.cmdk — command palette
// ============================================================
(() => {
    const { el, $, fuzzy } = NA.util;
    let root, input, listEl, items = [], active = 0, open = false;
    function entries(q) {
        const out = [];
        const onEdge = q.startsWith('insert on edge: ');
        const qq = onEdge ? q.slice(16) : q;
        if (!onEdge) for (const c of NA.commands.available()) if (!c.hidden) out.push({ title: c.title, group: c.group, shortcut: c.shortcut, icon: c.icon, run: () => NA.commands.run(c.id) });
        for (const k of NA.catalogue.kinds()) { const d = NA.catalogue.get(k); if (d.hidden || k === 'module') continue; out.push({ title: (onEdge ? 'Insert ' : 'Add block: ') + d.label, group: onEdge ? 'Insert on connection' : 'Blocks', icon: d.icon, run: () => { if (onEdge) { const id = [...NA.selection.state.edges][0]; const b = NA.model.insertOnEdge(id, k); if (b) NA.selection.selectBlocks([b.id]); } else NA.palette.addAtCentre(k); } }); }
        if (!onEdge) {
            const st = NA.model.get();
            for (const m of [...Object.values(st.modules), ...NA.templates.modules.filter(m => !st.modules[m.id])]) out.push({ title: 'Add module: ' + m.name, group: 'Modules', icon: 'box', run: () => NA.palette.addModuleAtCentre(m) });
            for (const t of NA.templates.list) out.push({ title: 'Template: ' + t.name, group: 'Templates', icon: t.icon, run: () => NA.project.loadTemplate(t.id) });
            for (const b of NA.model.graph().blocks) out.push({ title: 'Go to: ' + b.title, group: 'Blocks on canvas', icon: 'locate', run: () => { NA.selection.selectBlocks([b.id]); const r = NA.model.rect(b); NA.canvas.centerOn(r.x + r.w / 2, r.y + r.h / 2, Math.max(NA.canvas.view.z, 1)); } });
        }
        if (!qq.trim()) return out.slice(0, 40);
        return out.map(e => ({ e, s: fuzzy(qq, e.title) })).filter(x => x.s !== null).sort((a, b) => a.s - b.s).slice(0, 40).map(x => x.e);
    }
    function render() {
        items = entries(input.value); active = Math.min(active, Math.max(0, items.length - 1)); listEl.innerHTML = '';
        let lastGroup = null;
        items.forEach((it, i) => {
            if (it.group !== lastGroup) { listEl.appendChild(el('div', { class: 'cmdk-group', text: it.group })); lastGroup = it.group; }
            listEl.appendChild(el('button', { class: 'cmdk-item' + (i === active ? ' active' : ''), onclick: () => choose(i), onpointerenter: () => { active = i; render(); } }, [el('i', { 'data-lucide': it.icon || 'chevron-right' }), el('span', { class: 'cmdk-title', text: it.title }), it.shortcut ? el('kbd', { text: NA.commands.fmtShortcut([].concat(it.shortcut)[0]) }) : null]));
        });
        if (!items.length) listEl.appendChild(el('div', { class: 'cmdk-empty', text: 'No matches' }));
        if (window.lucide) lucide.createIcons({ nodes: [listEl] });
        const a = listEl.querySelector('.cmdk-item.active'); if (a) a.scrollIntoView({ block: 'nearest' });
    }
    function choose(i) { const it = items[i]; close(); if (it) it.run(); }
    function openPal(prefill = '') { open = true; root.hidden = false; input.value = prefill; active = 0; render(); input.focus(); }
    function close() { open = false; root.hidden = true; }
    function init() {
        root = $('#cmdk'); input = $('#cmdk-input'); listEl = $('#cmdk-list');
        input.addEventListener('input', () => { active = 0; render(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { active = (active + 1) % Math.max(1, items.length); render(); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % Math.max(1, items.length); render(); e.preventDefault(); }
            else if (e.key === 'Enter') { choose(active); e.preventDefault(); }
            else if (e.key === 'Escape') { close(); e.preventDefault(); }
        });
        root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
        window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open ? close() : openPal(); } });
    }
    NA.cmdk = { init, open: openPal, close, isOpen: () => open };
})();
