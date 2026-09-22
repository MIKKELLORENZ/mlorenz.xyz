/* selftest.js — in-browser assertion suite, loaded only with ?selftest=1.
 * Exercises the DOM paths the Node suite cannot: palette adds, selection and its
 * floating toolbar, the inspector for every selection type, export modal, ⌘K,
 * context menu, undo/redo through the UI, inline rename, popovers.
 * Writes "NA-SELFTEST pass=N fail=M" into document.title (read with --dump-dom).
 */
(async () => {
    const results = []; let pass = 0, fail = 0;
    const check = (name, ok, extra) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; };
    const $ = (s) => document.querySelector(s);
    const finish = () => { document.title = `NA-SELFTEST pass=${pass} fail=${fail}`; const pre = document.createElement('pre'); pre.id = 'selftest-out'; pre.textContent = results.join('\n'); document.body.appendChild(pre); console.log(results.join('\n')); };
    const watchdog = setTimeout(() => { check('watchdog: suite finished in time', false); finish(); }, 6000);
    try {
        NA.project.loadTemplate = ((orig) => (id) => { NA.model.replace(NA.templates.build(id)); NA.selection.clear(); NA.history.reset(); NA.ui.refresh(); })(NA.project.loadTemplate);
        window.confirm = () => true; window.prompt = (t, d) => d;
        // empty state
        NA.model.newProject('Test'); NA.ui.refresh();
        check('empty hero visible on a blank project', !$('#empty-hero').hidden);
        // palette add
        const inp = NA.palette.addAtCentre('input', { title: 'Obs', params: { shape: [20] } });
        check('palette adds an input and selects it', inp && NA.selection.state.blocks.has(inp.id));
        check('empty hero hides once a block exists', $('#empty-hero').hidden);
        const lin = NA.palette.addAtCentre('linear');
        check('inspector renders a block section', !!$('#inspector-body .kind-pill'));
        check('inspector shows the linear size field', [...document.querySelectorAll('#inspector-body .insp-label')].some(l => l.textContent === 'Neurons'));
        // wiring: a palette click adds after the selected block, already wired
        const auto = NA.model.get().edges.find(e => e.from.block === inp.id && e.to.block === lin.id);
        check('palette add lands in the next lane, wired from the selection', !!auto && lin.pos.x === inp.pos.x + NA.model.laneWidth() && lin.pos.y === inp.pos.y, JSON.stringify([inp.pos, lin.pos, !!auto]));
        const r = { edge: auto };
        const att = NA.palette.addAtCentre('attention');
        check('a fresh Attention block is a compact grid, not a 256-row list', NA.model.resolvedLayout(att) === 'grid' && NA.model.rect(att).h < 400, NA.model.resolvedLayout(att) + ' ' + NA.model.rect(att).h);
        NA.model.removeBlocks([att.id]); NA.selection.selectBlocks([lin.id]);
        const lin2 = NA.palette.addAtCentre('linear');
        const autoAct = NA.model.get().edges.find(e => e.from.block === lin.id && e.to.block === lin2.id);
        check('Linear after Linear is wired with ReLU by default', !!autoAct && autoAct.act === 'relu', autoAct && autoAct.act);
        document.querySelector('#tb-mode [data-mode="infer"]').click();
        check('top-bar switch enters the inference view', NA.model.get().settings.mode === 'infer' && document.body.classList.contains('infer-mode') && document.querySelector('#tb-mode [data-mode="infer"]').classList.contains('active'));
        document.querySelector('#tb-mode [data-mode="train"]').click();
        check('and back to training', NA.model.get().settings.mode === 'train');
        check('palette has no Dropout block', ![...document.querySelectorAll('#palette button')].some(b => /^Dropout$/.test(b.textContent.trim())));
        NA.model.removeBlocks([lin2.id]); NA.selection.selectBlocks([lin.id]);
        NA.selection.selectEdge(r.edge.id);
        check('inspector shows a connection section', /Connection/.test($('#inspector-body').textContent));
        // floating toolbar
        NA.selection.selectBlocks([lin.id]); NA.ui.positionToolbar();
        check('action bar enables block actions', $('#action-bar').querySelectorAll('.ft-btn:not([disabled])').length >= 4 && $('#action-bar').querySelectorAll('.ft-btn[disabled]').length >= 1);
        NA.commands.run('insert.batchnorm');
        check('insert batchnorm after selected block', NA.model.graph().blocks.some(b => b.kind === 'batchnorm') && NA.model.graph().edges.length === 2);
        // neurons
        NA.selection.selectNeurons(inp.id, [1, 2, 3]);
        check('inspector shows the neuron list with the 3 selected rows highlighted', document.querySelectorAll('#inspector-body .nrow.sel').length === 3 && document.querySelectorAll('#inspector-body .nrow').length >= 20 && /20 neurons/.test($('#inspector-body').textContent), document.querySelectorAll('#inspector-body .nrow.sel').length + ' sel / ' + document.querySelectorAll('#inspector-body .nrow').length);
        NA.commands.run('region.annotate');
        check('annotate range creates a region 1–3', inp.regions.length === 1 && inp.regions[0].start === 1 && inp.regions[0].end === 4);
        check('region port exists', NA.model.outputPortIds(inp).length === 2);
        NA.selection.selectNeurons(inp.id, [5, 6]);
        NA.selection.connectNeurons(lin.id, 0, 'one-to-one', 0.3);
        check('connect neurons adds 2 sparse edges', NA.model.graph().neuronEdges.length === 2);
        // undo / redo
        const before = NA.model.graph().neuronEdges.length;
        NA.history.undo();
        check('undo removes the sparse edges', NA.model.graph().neuronEdges.length < before);
        NA.history.redo();
        check('redo restores them', NA.model.graph().neuronEdges.length === before);
        // Ctrl+Z pressed while an inspector field has focus undoes the model edit, not the text box
        NA.selection.selectBlocks([lin.id]); NA.inspector.render();
        const tIn = $('#inspector-body input[data-focus=title]'); const oldTitle = NA.model.block(lin.id).title;
        tIn.focus(); tIn.value = oldTitle + ' edited'; tIn.dispatchEvent(new Event('input', { bubbles: true }));
        check('typing in the inspector edits the model live', NA.model.block(lin.id).title === oldTitle + ' edited');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
        check('Ctrl+Z from the inspector field undoes that edit', NA.model.block(lin.id).title === oldTitle && document.activeElement !== tIn, NA.model.block(lin.id).title);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }));
        check('Ctrl+Y redoes it', NA.model.block(lin.id).title === oldTitle + ' edited', NA.model.block(lin.id).title);
        NA.history.undo();
        check('the top-bar Undo button is enabled and labelled', !$('#tb-undo').disabled && /Undo/.test($('#tb-undo').textContent));
        // group into module + enter + crumbs
        NA.selection.selectBlocks([lin.id, NA.model.graph().blocks.find(b => b.kind === 'batchnorm').id]);
        NA.commands.run('edit.groupModule');
        const inst = NA.model.graph().blocks.find(b => b.kind === 'module');
        check('group into module via command', !!inst);
        NA.model.enterModule(inst.params.def); NA.ui.refresh();
        check('breadcrumb shows the module', document.querySelectorAll('#crumbs .crumb').length === 2 && document.body.classList.contains('in-module'));
        check('inspector shows module section inside', /Module name/.test($('#inspector-body').textContent));
        NA.model.exitModule(); NA.ui.refresh();
        check('leaving the module restores the root crumb', document.querySelectorAll('#crumbs .crumb').length === 1);
        NA.commands.run('edit.selectAll'); NA.commands.run('edit.ungroup');
        check('ungroup inlines the module', !NA.model.graph().blocks.some(b => b.kind === 'module'));
        // context menu + cmdk
        NA.ui.contextMenu(100, 100, { type: 'empty', x: 0, y: 0 });
        check('context menu on empty canvas lists add items', !$('#ctx-menu').hidden && $('#ctx-menu').querySelectorAll('.ctx-item').length >= 5);
        NA.ui.closePopups();
        NA.cmdk.open('linear');
        check('⌘K finds "Add block: Linear"', [...document.querySelectorAll('#cmdk-list .cmdk-item')].some(i => /Add block: Linear/.test(i.textContent)));
        NA.cmdk.close();
        // templates + export modal
        NA.project.loadTemplate('robot_policy');
        check('robot template loads 10 blocks (activations live on wires)', NA.model.graph().blocks.length === 10 && NA.model.graph().edges.filter(e => e.act).length === 7, NA.model.graph().blocks.length + ' blocks');
        NA.ui.exportModal('pytorch');
        check('export modal shows python with the class', $('#export-modal').classList.contains('visible') && /class RobotControlPolicy/.test($('#code-preview').textContent));
        check('export notes say runnable', /Runnable/.test($('#export-notes').textContent));
        NA.ui.exportModal('keras');
        check('keras tab renders JSON', /"class_name": "Functional"/.test($('#code-preview').textContent));
        $('#export-modal').classList.remove('visible');
        // hit testing at a known point
        const obs = NA.model.graph().blocks.find(b => b.title === 'Observation');
        NA.model.updateBlock(obs.id, { ui: { layout: 'grid' } });   // dots on the canvas for the hit tests below
        NA.canvas.setView(obs.pos.x - 50, obs.pos.y - 50, 2, false);
        const p = NA.canvas.toScreen(obs.pos.x + 100, obs.pos.y + 10);
        const h = NA.hit.test(p.x, p.y);
        check('hit test finds the block header', h.type === 'block' && h.block.id === obs.id && h.header, h.type);
        const c = NA.model.neuronCenter(obs, 40); const ps = NA.canvas.toScreen(c.x, c.y);
        const hn = NA.hit.test(ps.x, ps.y);
        check('hit test finds neuron #40 at zoom 2', hn.type === 'neuron' && hn.idx === 40, hn.type + ' ' + hn.idx);
        const port = NA.model.portPos(obs, 'out'); const pp = NA.canvas.toScreen(port.x, port.y);
        check('hit test finds the out port', NA.hit.test(pp.x, pp.y).type === 'port');
        // inline rename
        NA.ui.inlineRename(obs);
        check('inline rename input is positioned and filled', !$('#inline-edit').hidden && $('#inline-edit input').value === 'Observation');
        $('#inline-edit input').value = 'Observation 2'; $('#inline-edit input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        check('rename commits on Enter', obs.title === 'Observation 2');
        // neuron target popover
        NA.ui.neuronTargetPopover({ block: obs, idx: 3 }, NA.model.graph().blocks.find(b => b.title === 'Action head'), 200, 200);
        check('neuron target popover opens with a region select', !$('#popover').hidden && $('#popover input[type=number]'));
        NA.ui.closePopups();
        // theme + shortcuts modal + minimap
        NA.theme.toggle(); check('theme toggles to light', document.documentElement.dataset.theme === 'light'); NA.theme.toggle();
        NA.ui.shortcutsModal(); check('shortcut sheet lists groups', document.querySelectorAll('#shortcut-list .sc-group').length >= 4); $('#shortcuts-modal').classList.remove('visible');
        NA.minimap.draw(); check('minimap has content', !$('#minimap').classList.contains('empty'));
        // render passes run without throwing at several zooms
        let threw = null;
        for (const z of [0.05, 0.3, 1, 3, 12]) { try { NA.canvas.setView(obs.pos.x, obs.pos.y, z, false); NA.render.scene($('#scene').getContext('2d'), 800, 600, 1); NA.render.overlay($('#overlay').getContext('2d'), 800, 600, 1); } catch (e) { threw = z + ': ' + e.message; } }
        check('scene + overlay render at every zoom', !threw, threw);
        // large block strip
        const big = NA.palette.addAtCentre('linear', { size: 4096 });
        NA.model.addEdge({ block: obs.id, port: 'out' }, { block: big.id, port: 'in' });
        NA.model.updateBlock(big.id, { ui: { expandedRegion: 'chunk:0' } });
        try { NA.render.scene($('#scene').getContext('2d'), 800, 600, 1); check('strip block with expanded chunk renders', true); } catch (e) { check('strip block with expanded chunk renders', false, e.message); }
        NA.selection.selectBlocks([big.id]);
        check('inspector shows 4096 neurons', /4096 neurons/.test($('#inspector-body').textContent));
        // column layout, header buttons, collapse
        const ten = NA.palette.addAtCentre('linear');
        check('new linear defaults to 10 neurons in a column', ten.size === 10 && NA.model.layoutMode(ten) === 'column' && NA.model.neuronLayout(ten).cols === 1 && NA.model.neuronLayout(ten).rows === 10);
        const rr0 = NA.model.rect(ten);
        NA.canvas.setView(ten.pos.x - 20, ten.pos.y - 20, 2, false);
        const btn = NA.model.headerButtons(ten).find(x => x.id === 'collapse'); const bp = NA.canvas.toScreen(btn.x + btn.w / 2, btn.y + btn.h / 2);
        const hb = NA.hit.test(bp.x, bp.y);
        check('hit test finds the collapse button', hb.type === 'block' && hb.button === 'collapse', hb.button);
        NA.selection.toggleBlockUi(ten.id, 'collapse');
        check('collapsed block is title-only and shorter', NA.model.layoutMode(ten) === 'collapsed' && NA.model.rect(ten).h < rr0.h);
        NA.selection.toggleBlockUi(ten.id, 'collapse'); NA.selection.toggleBlockUi(ten.id, 'layout');
        check('layout toggles to grid', NA.model.layoutMode(ten) === 'dots');
        NA.selection.selectBlocks([ten.id]); NA.commands.run('block.layout');
        check('L command cycles on to rows (the strip)', NA.model.layoutMode(ten) === 'strip');
        NA.commands.run('block.layout');
        check('and back to column', NA.model.layoutMode(ten) === 'column');
        const c5 = NA.model.neuronCenter(ten, 5); check('column neuron 5 hit-tests by row', NA.model.neuronAt(ten, c5.x + 60, c5.y) === 5);
        // inline neuron labelling on the row, Enter steps to the next neuron
        NA.ui.inlineNeuronLabel(ten, 2);
        const ie = $('#inline-edit input'); const tenOff = NA.model.neuronOffset(ten);
        check('inline neuron editor opens on the row', !$('#inline-edit').hidden && $('#inline-edit').classList.contains('neuron') && ie.placeholder === 'label for #' + (2 + tenOff), ie.placeholder);
        ie.value = 'gravity z'; ie.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        check('Enter commits the label', ten.neurons[2] && ten.neurons[2].label === 'gravity z');
        await new Promise(r => setTimeout(r, 20));
        check('…and steps to neuron #3', !$('#inline-edit').hidden && ie.placeholder === 'label for #' + (3 + tenOff), ie.placeholder);
        ie.value = 'kept'; ie.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        check('Escape closes and keeps the typed label', $('#inline-edit').hidden && ten.neurons[3] && ten.neurons[3].label === 'kept');
        // Real-event reproduction: double-click a row, type, click away on empty canvas
        {
            const stage = $('#stage'); const sr = stage.getBoundingClientRect();
            const c7 = NA.model.neuronCenter(ten, 7); const sp = NA.canvas.toScreen(c7.x + 40, c7.y);
            const ev = (type, x, y, extra = {}) => new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: sr.left + x, clientY: sr.top + y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true }, extra));
            const ov = $('#overlay');
            ov.dispatchEvent(ev('pointerdown', sp.x, sp.y)); ov.dispatchEvent(ev('pointerup', sp.x, sp.y, { buttons: 0 }));
            ov.dispatchEvent(ev('pointerdown', sp.x, sp.y)); ov.dispatchEvent(ev('pointerup', sp.x, sp.y, { buttons: 0 }));
            ov.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: sr.left + sp.x, clientY: sr.top + sp.y }));
            check('real dblclick opens the row editor for #7', !$('#inline-edit').hidden && ie.placeholder === 'label for #' + (7 + tenOff), ie.placeholder);
            ie.value = 'battery';
            const away = NA.canvas.toScreen(ten.pos.x - 400, ten.pos.y - 200);
            ov.dispatchEvent(ev('pointerdown', away.x, away.y)); ie.blur(); ov.dispatchEvent(ev('pointerup', away.x, away.y, { buttons: 0 }));
            await new Promise(r => setTimeout(r, 450));
            check('label survives clicking away (model)', ten.neurons[7] && ten.neurons[7].label === 'battery', JSON.stringify(ten.neurons[7]));
            check('editor closed after clicking away', $('#inline-edit').hidden);
            // and the label is actually painted: sample the row for text-coloured pixels
            NA.canvas.setView(ten.pos.x - 20, ten.pos.y - 20, 2, false);
            const sc = $('#scene'); NA.render.scene(sc.getContext('2d'), NA.canvas.size.W, NA.canvas.size.H, NA.canvas.size.dpr);
            const L = NA.model.neuronLayout(ten); const c = NA.model.neuronCenter(ten, 7, L); const d = NA.canvas.size.dpr;
            const p0 = NA.canvas.toScreen(L.x0 + L.pitch + 34, c.y - L.pitch / 2), p1 = NA.canvas.toScreen(L.x0 + L.pitch + 90, c.y + L.pitch / 2);
            const img = sc.getContext('2d').getImageData(Math.round(p0.x * d), Math.round(p0.y * d), Math.round((p1.x - p0.x) * d), Math.round((p1.y - p0.y) * d)).data;
            let bright = 0; for (let i = 0; i < img.length; i += 4) if (img[i] + img[i + 1] + img[i + 2] > 450) bright++;
            check('label pixels are painted on the row', bright > 20, bright + ' bright px');
        }
        // Activations on wires, fan-in Linear, spinner shapes, editable title
        {
            NA.model.newProject('Wires'); NA.ui.refresh();
            const A = NA.model.addBlock('input', { x: 0, y: 0 }, { title: 'A', params: { shape: [10] } });
            const B = NA.model.addBlock('input', { x: 0, y: 300 }, { title: 'B', params: { shape: [6] } });
            const C = NA.model.addBlock('linear', { x: 350, y: 0 }, { title: 'C', size: 8 });
            const r1 = NA.model.addEdge({ block: A.id, port: 'out' }, { block: C.id, port: 'in' });
            const r2 = NA.model.addEdge({ block: B.id, port: 'out' }, { block: C.id, port: 'in' }, 'relu');
            check('two inputs wire into one Linear', !r1.error && !r2.error && NA.model.graph().edges.length === 2 && JSON.stringify(C._inShapes) === '[[10],[6]]', JSON.stringify([r1.error, r2.error, C._inShapes]));
            check('palette has no Activation block', !document.querySelector('#palette [data-kind="activation"]') && ![...document.querySelectorAll('#palette button')].some(b => /^Activation$/.test(b.textContent.trim())));
            NA.canvas.setView(-100, -100, 1, false);
            const sc = $('#scene'); NA.render.scene(sc.getContext('2d'), NA.canvas.size.W, NA.canvas.size.H, NA.canvas.size.dpr);
            const e2 = NA.model.graph().edges.find(e => e.act === 'relu');
            check('activation pill is drawn on the wire', !!e2._chip && e2._chip.w > 0, JSON.stringify(e2._chip));
            const hp = e2._chip && NA.canvas.toScreen(e2._chip.x + e2._chip.w / 2, e2._chip.y + e2._chip.h / 2);
            const hit = hp && NA.hit.test(hp.x, hp.y);
            check('clicking the pill hits its wire', hit && hit.type === 'edge' && hit.edge.id === e2.id, hit && hit.type);
            NA.selection.selectEdge(e2.id); NA.inspector.render && NA.inspector.render();
            const actSel = [...document.querySelectorAll('#inspector-body select')].find(s => [...s.options].some(o => o.value === 'gelu'));
            check('inspector offers the activation on a selected wire', !!actSel && actSel.value === 'relu', actSel && actSel.value);
            if (actSel) { actSel.value = 'gelu'; actSel.dispatchEvent(new Event('change', { bubbles: true })); }
            check('changing it updates the model', e2.act === 'gelu', e2.act);
            NA.selection.selectBlocks([A.id]); NA.inspector.render && NA.inspector.render();
            const dims = document.querySelectorAll('#inspector-body .dims input[type=number]');
            check('input shape is a number spinner per dimension', dims.length === 1 && +dims[0].value === 10, dims.length + ' spinners');
            const pair = document.querySelector('#inspector-body .insp-pair');
            check('shape and dtype share one row', !!pair && pair.querySelector('.dims') && pair.querySelector('select'));
            // rename from the top bar with real events
            const crumb = $('#crumbs .crumb.editable'); crumb.click();
            const ci = $('#crumbs .crumb-input');
            check('clicking the model name opens an editor', !!ci && ci.value === 'Wires');
            if (ci) { ci.value = 'Wires v2'; ci.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
            check('Enter renames the model', NA.model.get().meta.name === 'Wires v2' && $('#crumbs .crumb').textContent === 'Wires v2', NA.model.get().meta.name);
            const saved = JSON.parse(JSON.stringify(NA.model.serialize()));
            check('the name and the wire activation are in the saved file', saved.meta.name === 'Wires v2' && saved.edges.some(e => e.act === 'gelu'));
            NA.model.replace(saved); NA.ui.refresh();
            check('opening it restores the title in the top bar', $('#crumbs .crumb').textContent === 'Wires v2');
        }
        // Drag across neuron rows → selection + region popover; drag from the dot → wire; drop an Input onto another → merge
        {
            NA.model.newProject('Rows'); NA.selection.clear(); NA.ui.refresh();
            const ten = NA.model.addBlock('input', { x: 0, y: 0 }, { title: 'Ten', params: { shape: [10] } });
            NA.canvas.setView(-60, -60, 1.5, false);
            const ov = $('#overlay'); const sr = ov.getBoundingClientRect();
            const ev = (type, x, y, extra = {}) => new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: sr.left + x, clientY: sr.top + y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true }, extra));
            const L = NA.model.neuronLayout(ten);
            const rowPt = (i, dx) => { const c = NA.model.neuronCenter(ten, i, L); return NA.canvas.toScreen(c.x + dx, c.y); };
            const p2 = rowPt(2, 60), p5 = rowPt(5, 60);
            ov.dispatchEvent(ev('pointerdown', p2.x, p2.y)); ov.dispatchEvent(ev('pointermove', p2.x + 4, p2.y + 12)); ov.dispatchEvent(ev('pointermove', p5.x, p5.y));
            const mq = NA.interact.marquee;
            check('while dragging, the rows about to be selected are known and highlighted', !!(mq && mq.rows && mq.rows.block === ten) && mq.rows.idxs.join(',') === '2,3,4,5', JSON.stringify(mq && mq.rows && mq.rows.idxs));
            { let drew = false; const oc = $('#overlay').getContext('2d'); const orig = oc.fill; oc.fill = function () { drew = true; return orig.apply(this, arguments); }; try { NA.render.overlay(oc, NA.canvas.size.W, NA.canvas.size.H, 1); } catch (e) { console.error('overlay draw threw', e); } oc.fill = orig; check('the overlay paints the row highlight without throwing', drew); }
            ov.dispatchEvent(ev('pointerup', p5.x, p5.y, { buttons: 0 }));
            const selN = NA.selection.state.neurons.get(ten.id);
            check('dragging across rows (away from the dots) selects those neurons', selN && selN.size === 4 && [...selN].sort().join(',') === '2,3,4,5', selN && [...selN].join(','));
            const pop = $('#popover'); const nameInp = pop.querySelector('input[type=text]');
            check('a region popover opens at the mouse', !pop.hidden && !!nameInp && /4 neurons/.test(pop.textContent));
            if (nameInp) { nameInp.value = 'Sensors'; nameInp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
            check('Enter creates the region', ten.regions.length === 1 && ten.regions[0].name === 'Sensors' && ten.regions[0].start === 2 && ten.regions[0].end === 6 && pop.hidden, JSON.stringify(ten.regions));
            // from the dot itself a drag is a wire, not a marquee
            const d7 = (() => { const c = NA.model.neuronCenter(ten, 7, L); return NA.canvas.toScreen(c.x, c.y); })();
            ov.dispatchEvent(ev('pointerdown', d7.x, d7.y)); ov.dispatchEvent(ev('pointermove', d7.x + 30, d7.y + 30)); ov.dispatchEvent(ev('pointermove', d7.x + 80, d7.y + 60));
            check('dragging from the dot starts a wire, not a selection', !!NA.interact.ghost && NA.interact.marquee === null, JSON.stringify([!!NA.interact.ghost, NA.interact.marquee]));
            ov.dispatchEvent(ev('pointerup', d7.x + 80, d7.y + 60, { buttons: 0 }));
            // merge by drag-and-drop
            const six = NA.model.addBlock('input', { x: 0, y: 500 }, { title: 'Six', params: { shape: [6] } });
            NA.canvas.setView(-60, -60, 0.8, false);
            const hs = NA.canvas.toScreen(six.pos.x + 60, six.pos.y + 12), far = NA.canvas.toScreen(1400, 900), over = NA.canvas.toScreen(ten.pos.x + 60, ten.pos.y + 40);
            ov.dispatchEvent(ev('pointerdown', hs.x, hs.y)); ov.dispatchEvent(ev('pointermove', hs.x + 5, hs.y + 12)); ov.dispatchEvent(ev('pointermove', over.x, over.y));
            const hint = $('#merge-hint');
            check('dragging one Input over another proposes a merge', hint && !hint.hidden && /Six/.test(hint.textContent) && /Ten/.test(hint.textContent), hint && hint.textContent);
            ov.dispatchEvent(ev('pointermove', far.x, far.y));
            check('moving away withdraws the proposal', hint.hidden);
            ov.dispatchEvent(ev('pointermove', over.x, over.y)); ov.dispatchEvent(ev('pointerup', over.x, over.y, { buttons: 0 }));
            const mergeBtn = [...$('#popover').querySelectorAll('button')].find(b => b.textContent === 'Merge');
            check('releasing asks whether to merge', !$('#popover').hidden && !!mergeBtn && hint.hidden);
            if (mergeBtn) mergeBtn.click();
            check('Merge makes one 16-neuron input with the Sensors region shifted after it', NA.model.graph().blocks.filter(b => b.kind === 'input').length === 1 && JSON.stringify(ten.params.shape) === '[16]' && ten.regions.some(r => r.name === 'Six' && r.start === 10 && r.end === 16), JSON.stringify([ten.params.shape, ten.regions.map(r => [r.name, r.start, r.end])]));
            // shrinking the merged input below its regions from the inspector asks what to do with each region
            NA.selection.selectBlocks([ten.id]); NA.inspector.render();
            const dimInp = $('#inspector-body .dims input.dim');
            check('the input shape field is there', !!dimInp);
            if (dimInp) { dimInp.value = '4'; dimInp.dispatchEvent(new Event('change', { bubbles: true })); }
            const sp = $('#popover'); const sels = [...sp.querySelectorAll('select')];
            check('a chooser opens instead of silently cutting the regions', !sp.hidden && /Shrink/.test(sp.textContent) && sels.length === 2 && JSON.stringify(ten.params.shape) === '[16]', JSON.stringify([sp.hidden, sels.length, ten.params.shape]));
            check('Sensors can be trimmed or deleted, Six (entirely past the end) only deleted', sels.length === 2 && sels[0].options.length === 2 && sels[0].value === 'trim' && sels[1].options.length === 1 && sels[1].value === 'delete', JSON.stringify(sels.map(s => [s.value, s.options.length])));
            const cancelBtn = [...sp.querySelectorAll('button')].find(b => b.textContent === 'Cancel'); if (cancelBtn) cancelBtn.click();
            check('Cancel keeps the block as it was and resets the field', sp.hidden && JSON.stringify(ten.params.shape) === '[16]' && ten.regions.length === 2 && $('#inspector-body .dims input.dim').value === '16', JSON.stringify([ten.params.shape, $('#inspector-body .dims input.dim').value]));
            const dimInp2 = $('#inspector-body .dims input.dim'); dimInp2.value = '4'; dimInp2.dispatchEvent(new Event('change', { bubbles: true }));
            const applyBtn = [...$('#popover').querySelectorAll('button')].find(b => b.textContent === 'Apply'); if (applyBtn) applyBtn.click();
            check('Apply trims Sensors to #2–3 and deletes Six', JSON.stringify(ten.params.shape) === '[4]' && ten.regions.length === 1 && ten.regions[0].name === 'Sensors' && ten.regions[0].start === 2 && ten.regions[0].end === 4, JSON.stringify([ten.params.shape, ten.regions.map(r => [r.name, r.start, r.end])]));
        }
        // Big inputs default to rows; the neuron list drives the selection and the canvas
        {
            NA.model.newProject('Big'); NA.selection.clear(); NA.history.reset(); NA.ui.refresh();
            const big = NA.model.addBlock('input', { x: 0, y: 0 }, { title: 'Sensors', params: { shape: [150] }, regions: [{ name: 'IMU', start: 0, end: 6 }, { name: 'Joints', start: 6, end: 40 }] });
            const hid = NA.model.addBlock('linear', { x: 350, y: 0 }, { title: 'Hidden', size: 150 });
            check('a 150-neuron input defaults to rows and stays short', NA.model.resolvedLayout(big) === 'rows' && NA.model.layoutMode(big) === 'strip' && NA.model.rect(big).h < 200, NA.model.layoutMode(big) + ' ' + NA.model.rect(big).h);
            check('a 150-neuron hidden layer defaults to a grid', NA.model.resolvedLayout(hid) === 'grid' && NA.model.layoutMode(hid) === 'dots');
            const small = NA.model.addBlock('input', { x: 0, y: 600 }, { title: 'Small', params: { shape: [8] } });
            check('a small input is still a list', NA.model.resolvedLayout(small) === 'column');
            NA.selection.selectBlocks([big.id]); NA.inspector.render();
            const list = $('#inspector-body .nlist');
            check('selecting the block shows its neuron list, virtualised', !!list && list.querySelector('.nlist-inner').style.height === (150 + 2) * 24 + 'px' && document.querySelectorAll('#inspector-body .nrow').length < 150 && document.querySelectorAll('#inspector-body .nrow.region').length >= 1, list && list.querySelector('.nlist-inner').style.height);
            const seg = [...document.querySelectorAll('#inspector-body .seg.small .seg-btn')];
            check('the On-canvas control marks Rows as current', seg.length === 3 && seg.find(x => x.dataset.layout === 'rows').classList.contains('active'));
            seg.find(x => x.dataset.layout === 'grid').click();
            check('choosing Grid changes the block on the canvas', NA.model.layoutMode(big) === 'dots' && big.ui.layout === 'grid');
            seg.find(x => x.dataset.layout === 'rows') && document.querySelector('#inspector-body .seg.small [data-layout=rows]').click();
            const row7 = document.querySelector('#inspector-body .nrow[data-i="7"]');
            row7.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
            check('clicking a row selects that neuron and keeps the block selected', NA.selection.state.neurons.get(big.id) && NA.selection.state.neurons.get(big.id).has(7) && NA.selection.state.blocks.has(big.id));
            const row10 = document.querySelector('#inspector-body .nrow[data-i="10"]');
            row10.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
            check('shift-click extends to a range', NA.selection.state.neurons.get(big.id).size === 4 && document.querySelectorAll('#inspector-body .nrow.sel').length === 4);
            const reg = document.querySelector('#inspector-body .nrow.region');
            reg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
            check('clicking a region header selects the whole region', NA.selection.state.neurons.get(big.id).size === 6);
            const lab = document.querySelector('#inspector-body .nlabel[data-i="3"]'); lab.focus(); lab.value = 'gyro z'; lab.dispatchEvent(new Event('input', { bubbles: true }));
            check('typing in a row labels the neuron', big.neurons[3] && big.neurons[3].label === 'gyro z');
            row7.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            await new Promise(r => setTimeout(r, 450));   // the centring is a tween
            check('double-click expands the range holding the neuron and centres on it', big.ui.expandedRegion === big.regions[1].id && NA.canvas.view.z >= 2.19, big.ui.expandedRegion + ' z=' + NA.canvas.view.z.toFixed(2));
            NA.selection.clear(); NA.selection.selectNeurons(big.id, [20, 21]); NA.inspector.render();
            check('marquee-selecting neurons alone still opens the block form and list', !!$('#inspector-body .kind-pill') && document.querySelectorAll('#inspector-body .nrow.sel').length === 2 && /2 selected/.test($('#inspector-body').textContent));
            // several blocks at once: one layout for all, collapse all, tidy the selection
            NA.selection.selectBlocks([big.id, hid.id, small.id]); NA.inspector.render();
            const mseg = [...document.querySelectorAll('#inspector-body .seg.small .seg-btn')];
            check('multi-selection offers List / Grid / Rows / Collapsed for all', mseg.length === 4 && !mseg.some(x => x.classList.contains('active')));
            mseg.find(x => x.dataset.layout === 'rows').click();
            check('one click puts all three in rows', [big, hid, small].every(b => NA.model.resolvedLayout(b) === 'rows'));
            document.querySelector('#inspector-body .seg.small [data-layout=collapsed]').click();
            check('Collapsed folds all three to their titles', [big, hid, small].every(b => b.ui.collapsed) && NA.model.layoutMode(hid) === 'collapsed');
            document.querySelector('#inspector-body .seg.small [data-layout=collapsed]').click();
            check('and again expands them', [big, hid, small].every(b => !b.ui.collapsed));
            NA.model.moveBlocks([hid.id], 0, 900, false); const yBefore = hid.pos.y;
            check('the Tidy button is back in the top bar', !!$('#tb-tidy') && /Tidy/.test($('#tb-tidy').textContent));
            $('#tb-tidy').click();
            check('Tidy with several blocks selected lays out just those', hid.pos.y !== yBefore, hid.pos.y + ' vs ' + yBefore);
        }
        // Document state, file form, menu, highlighter, palette filter
        {
            NA.model.newProject('Doc'); NA.selection.clear(); NA.history.reset(); NA.ui.refresh();
            const d0 = NA.model.addBlock('input', { x: 0, y: 0 }, { title: 'In', params: { shape: [4] } });
            await new Promise(r => setTimeout(r, 400));   // the update commit is debounced
            check('an edit marks the document dirty and shows the dot on the name', NA.project.dirty === true && !!$('#crumbs .crumb.dirty'));
            const file = NA.model.serialize();
            check('the saved file carries no camera, preferences or timestamp', !('view' in file) && !('settings' in file) && !('savedAt' in file) && Array.isArray(file.blocks));
            check('the session form still does', 'view' in NA.model.serialize({ session: true }) && 'settings' in NA.model.serialize({ session: true }));
            NA.ui.appMenu($('#tb-menu'));
            const items = [...document.querySelectorAll('#ctx-menu .ctx-item')].map(i => i.textContent.trim());
            check('the app menu lists file, view and help commands', !$('#ctx-menu').hidden && items.some(t => /^Save/.test(t)) && items.some(t => /Copy link/.test(t)) && items.some(t => /Templates/.test(t)) && items.some(t => /shortcuts/.test(t)), items.join(' | '));
            NA.ui.closePopups();
            const html = NA.ui.tint('r"""doc"""\nimport torch\nx = "s"  # note\nclass A(nn.Module): pass\n', 'py');
            check('the python highlighter never leaks its own markup', !/class="c">r"""/.test(html.replace(/<span class="c">/g, '')) && /<span class="k">import<\/span>/.test(html) && /<span class="c">r"""doc"""<\/span>/.test(html) && !/&lt;span/.test(html), html.slice(0, 120));
            const search = $('#palette-search'); search.value = 'conv'; search.dispatchEvent(new Event('input', { bubbles: true }));
            const shown = [...document.querySelectorAll('#palette .pcard-label')].map(l => l.textContent);
            check('the rail filter narrows the block list', shown.length >= 2 && shown.every(t => /conv/i.test(t)), shown.join(','));
            search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true }));
            check('clearing it brings every kind back', document.querySelectorAll('#palette .pcard').length >= 16);
            const before = JSON.parse(JSON.stringify(NA.model.serialize()));
            NA.model.updateBlock(d0.id, { title: 'In 2' }); NA.model.addBlock('linear', { x: 350, y: 0 }, { size: 3 });
            check('diff summary reads as a sentence', NA.model.diffSummary(NA.model.diff(before, NA.model.serialize())) === '+1 block · 1 block changed', NA.model.diffSummary(NA.model.diff(before, NA.model.serialize())));
        }
        // Global numbering per lane + collapsed range summary
        {
            NA.model.newProject('Lanes');
            const a = NA.model.addBlock('input', { x: 0, y: 0 }, { title: 'Block A', params: { shape: [10] }, regions: [{ name: 'Sensors', start: 0, end: 10 }] });
            const b2 = NA.model.addBlock('input', { x: 0, y: 400 }, { title: 'Block B', params: { shape: [10] } });
            const c = NA.model.addBlock('linear', { x: 350, y: 0 }, { size: 5 });
            check('second block in the lane starts at 10', NA.model.neuronOffset(a) === 0 && NA.model.neuronOffset(b2) === 10 && NA.model.neuronOffset(c) === 0);
            NA.model.moveBlocks([b2.id], 0, -800, false);
            check('moving it above flips the numbering', NA.model.neuronOffset(b2) === 0 && NA.model.neuronOffset(a) === 10);
            check('collapsed summary reads "Sensors (10–19)"', NA.model.rangeSummary(a) === 'Sensors (10–19)' && NA.model.rangeSummary(b2) === '(0–9)', NA.model.rangeSummary(a));
            NA.model.updateBlock(a.id, { ui: { collapsed: true } });
            const pa = NA.model.portPos(a, 'out:' + a.regions[0].id); const ra = NA.model.rect(a);
            check('collapsed region port sits on its summary row', ra.h === NA.config.HEADER_H + NA.config.COLLAPSED_ROW_H + 8 && pa.y > ra.y + NA.config.HEADER_H && pa.y < ra.y + ra.h, `${ra.h} ${pa.y - ra.y}`);
        }
    } catch (e) { check('suite threw: ' + e.message, false, (e.stack || '').split('\n')[1]); }
    clearTimeout(watchdog); finish();
})();
