/* Neural Architect — codegen.js
 *
 * Still DOM-free. NA.codegen.pytorch turns a project into a runnable nn.Module
 * (with the project embedded in the module docstring so the .py re-imports
 * losslessly), NA.codegen.keras emits a Keras functional-model JSON, and
 * NA.io.onnx reads .onnx protobufs with a hand-written decoder and maps the
 * common ops onto blocks.
 */
'use strict';
NA.codegen = NA.codegen || {};
// Activations along a wire, in application order. A flattened module boundary can carry two
// (the outer wire's and the inner wire's); everywhere else it is one or none.
NA.codegen.actsOf = (e) => Array.isArray(e.acts) ? e.acts : (e.act ? [e.act] : []);
NA.codegen.withActs = (e, list) => { const acts = list.flat().filter(a => a && NA.catalogue.ACT[a]); e.act = acts[0] || null; if (acts.length > 1) e.acts = acts; return e; };
NA.codegen.applyActsTorch = (expr, e) => { for (const a of NA.codegen.actsOf(e)) expr = NA.catalogue.ACT[a].torch(expr); return expr; };
NA.io = NA.io || {};

// ============================================================
// Shared: flatten module instances into one graph (pure; never touches state)
// ============================================================
(() => {
    const { deepClone, uid } = NA.util;
    function flatten(st) {
        const g = deepClone(NA.model.strip({ blocks: st.blocks, edges: st.edges, neuronEdges: st.neuronEdges, groups: st.groups }));
        let guard = 0;
        while (guard++ < 500) {
            const inst = g.blocks.find(b => b.kind === 'module');
            if (!inst) break;
            const def = st.modules[inst.params.def];
            if (!def) { g.blocks = g.blocks.filter(b => b !== inst); g.edges = g.edges.filter(e => e.from.block !== inst.id && e.to.block !== inst.id); continue; }
            const idMap = new Map();
            const clones = def.graph.blocks.map(b => { const c = deepClone(NA.model.strip(b)); c.id = uid('b'); c.title = inst.title + ' · ' + c.title; idMap.set(b.id, c.id); return c; });
            const inner = clones.filter(c => c.kind !== 'module_in' && c.kind !== 'module_out');
            const edges = [];
            for (const e of def.graph.edges) {
                const f = idMap.get(e.from.block), t = idMap.get(e.to.block);
                const fb = clones.find(c => c.id === f), tb = clones.find(c => c.id === t);
                if (fb.kind === 'module_in') {
                    const ext = g.edges.find(x => x.to.block === inst.id && x.to.port === 'in:' + e.from.block);
                    if (ext) edges.push(NA.codegen.withActs(NA.model.makeEdge(ext.from.block, t, ext.from.port, e.to.port), [ext.act, e.act]));
                } else if (tb.kind === 'module_out') {
                    for (const ext of g.edges.filter(x => x.from.block === inst.id && x.from.port === 'out:' + e.to.block)) edges.push(NA.codegen.withActs(NA.model.makeEdge(f, ext.to.block, e.from.port, ext.to.port), [e.act, ext.act]));
                } else edges.push(NA.codegen.withActs(NA.model.makeEdge(f, t, e.from.port, e.to.port), [e.act]));
            }
            g.blocks = g.blocks.filter(b => b.id !== inst.id).concat(inner);
            g.edges = g.edges.filter(e => e.from.block !== inst.id && e.to.block !== inst.id).concat(edges);
            for (const n of def.graph.neuronEdges) g.neuronEdges.push({ id: uid('n'), from: { block: idMap.get(n.from.block), idx: n.from.idx }, to: { block: idMap.get(n.to.block), idx: n.to.idx }, init: n.init, comment: n.comment });
        }
        // Variadic ports stay dense
        for (const b of g.blocks) if (NA.catalogue.isVariadic(b.kind)) { const es = g.edges.filter(e => e.to.block === b.id).sort((a, c) => (+a.to.port.split(':')[1]) - (+c.to.port.split(':')[1])); es.forEach((e, i) => e.to.port = 'in:' + i); }
        return g;
    }
    NA.codegen.flatten = flatten;
})();

// ============================================================
// NA.codegen.pytorch
// ============================================================
(() => {
    const { slug, pascal, fmtShape, fmtNum } = NA.util;
    const MARK_A = '@neural-architect-project', MARK_B = '@end-neural-architect-project';

    const SPARSE_LINEAR = `
class SparseLinear(nn.Module):
    """Hand-drawn neuron-to-neuron connections.

    A full (out, in) weight is kept but multiplied by a fixed 0/1 mask, so only the
    drawn edges carry signal or gradient. Edges whose init is None start small and random.
    """

    def __init__(self, in_features, out_features, edges):
        super().__init__()
        self.weight = nn.Parameter(torch.zeros(out_features, in_features))
        mask = torch.zeros(out_features, in_features)
        with torch.no_grad():
            for src, dst, init in edges:
                mask[dst, src] = 1.0
                self.weight[dst, src] = float(init) if init is not None else torch.randn(()).item() * 0.05
        self.register_buffer("mask", mask)

    def forward(self, x):
        return F.linear(x, self.weight * self.mask)
`;

    // A per-class naming scope: attributes and variables are unique Python identifiers
    function scope() {
        const used = new Set(['self', 'x', 'model']);
        const attrs = new Map(), vars = new Map();
        const unique = (base) => { let n = base, i = 2; while (used.has(n)) n = base + '_' + i++; used.add(n); return n; };
        return {
            attr(b) { if (!attrs.has(b.id)) attrs.set(b.id, unique(slug(b.title, b.kind))); return attrs.get(b.id); },
            var(b, prefix = 'h_') { if (!vars.has(b.id)) vars.set(b.id, unique(prefix + slug(b.title, b.kind))); return vars.get(b.id); },
            unique,
        };
    }
    function fmtInit(v) { return v === null || v === undefined ? 'None' : String(v); }
    function pad(line, comment, col = 60) { if (!comment) return line; return line + ' '.repeat(Math.max(2, col - line.length)) + '# ' + comment; }

    // Emit one nn.Module class for a graph. `io` names the boundary: for the root class the
    // inputs are Input blocks and the outputs are Output blocks; for a module definition
    // they are module_in / module_out pseudo-blocks.
    function emitClass(g, className, st, opts, report) {
        const sc = scope();
        const ctx = {
            attr: (b) => sc.attr(b),
            inputVar: (b) => sc.var(b, ''),
            warn: (m) => report.warnings.push(m),
        };
        const { order, cyclic } = NA.graph.topoSort(g);
        if (cyclic) report.errors.push(`${className}: the graph contains a cycle`);
        const isRoot = !opts.def;
        const inputs = order.filter(b => b.kind === (isRoot ? 'input' : 'module_in'));
        const outputs = order.filter(b => b.kind === (isRoot ? 'output' : 'module_out'));
        if (isRoot) { inputs.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x); outputs.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x); }
        else { const io = NA.model.moduleIO(opts.def.id); inputs.splice(0, inputs.length, ...io.ins); outputs.splice(0, outputs.length, ...io.outs); }
        if (!inputs.length) report.errors.push(`${className}: no ${isRoot ? 'Input' : 'module input'} block`);
        if (!outputs.length) report.errors.push(`${className}: no ${isRoot ? 'Output' : 'module output'} block`);

        // Sparse edges grouped per (from, to)
        const sparse = new Map();
        for (const n of g.neuronEdges) { const key = n.from.block + '>' + n.to.block; if (!sparse.has(key)) sparse.set(key, []); sparse.get(key).push(n); }
        const sparseAttr = new Map();
        for (const [key, list] of sparse) {
            const [f, t] = key.split('>'); const fb = g.blocks.find(b => b.id === f), tb = g.blocks.find(b => b.id === t);
            const inN = NA.model.effectiveSize(fb), outN = NA.model.effectiveSize(tb);
            if (inN === null || outN === null) { report.warnings.push(`Neuron edges ${fb?.title} → ${tb?.title} skipped: both ends must be vectors`); continue; }
            sparseAttr.set(key, { name: sc.unique('sparse_' + slug(fb.title) + '_' + slug(tb.title)), inN, outN, list, fb, tb });
        }

        const init = [], fwd = [];
        const varOf = new Map();       // "blockId:port" -> python expression
        const sliceEmitted = new Set();
        const exprFor = (from) => {
            const key = from.block + ':' + from.port;
            if (varOf.has(key)) return varOf.get(key);
            const b = g.blocks.find(x => x.id === from.block);
            if (!b) return 'None';
            if (from.port.startsWith('out:') && b.kind !== 'module') {
                const r = b.regions.find(x => x.id === from.port.slice(4));
                const base = varOf.get(b.id + ':out');
                if (!r || !base) return 'None';
                const v = sc.unique(base + '_' + slug(r.name, 'region'));
                if (!sliceEmitted.has(key)) { sliceEmitted.add(key); fwd.push(pad(`${v} = ${base}[:, ${r.start}:${r.end}]`, `${r.name} · [B, ${[r.end - r.start, ...(b._shape || []).slice(1)].join(', ')}]`)); }
                varOf.set(key, v); return v;
            }
            return 'None';
        };
        const wireCache = new Map();
        const wireExpr = (e) => {
            const base = exprFor(e.from); const src = g.blocks.find(x => x.id === e.from.block);
            const acts = NA.codegen.actsOf(e); const p = src && src.dropout > 0 ? src.dropout : 0;
            if (!acts.length && !p) return base;
            const key = e.from.block + ':' + e.from.port + ':' + acts.join('>') + ':' + p;
            if (wireCache.has(key)) return wireCache.get(key);
            let expr = base; for (const a of acts) expr = NA.catalogue.ACT[a].torch(expr);
            if (p) expr = `F.dropout(${expr}, p=${p}, training=self.training)`;
            const v = sc.unique(base + '_' + (acts.length ? acts.join('_') : 'drop'));
            const note = [...acts.map(a => NA.catalogue.ACT[a].label), ...(p ? [`dropout ${p} (training only)`] : [])].join(' → ');
            fwd.push(pad(`${v} = ${expr}`, note));
            wireCache.set(key, v); return v;
        };
        // Inputs
        for (const b of inputs) {
            const v = sc.var(b, '');
            varOf.set(b.id + ':out', v);
        }
        // Body in topo order
        for (const b of order) {
            if (inputs.includes(b)) continue;
            const k = NA.catalogue.get(b.kind);
            const inPorts = NA.model.inputPortIds(b, g);
            const ins = [];
            const fanNote = [];
            inPorts.forEach((pid, i) => {
                const es = k.fanIn ? NA.graph.incomingAll(g, b.id, pid) : [NA.graph.incomingOn(g, b.id, pid)].filter(Boolean);
                if (!es.length) { if (k.inputs === 'variadic' && i === inPorts.length - 1) return; report.errors.push(`${b.title}: input "${pid}" is not connected`); ins.push('None'); return; }
                for (const e of es) ins.push(wireExpr(e));
                if (es.length > 1) { const names = es.map(e => { const src = g.blocks.find(x => x.id === e.from.block); return src ? src.title : '?'; }); fanNote.push(k.fanIn === 'tokens' ? `query ${names[0]} · keys/values ${names.slice(1).join(' + ')}` : 'cat ' + names.join(' + ')); }
            });
            // Fan-in ports (other than attention-style ones) hand the kind ONE joined tensor
            if (k.fanIn && k.fanIn !== 'tokens' && ins.length > 1) {
                const joined = k.fanIn === 'flat' ? `torch.cat([${ins.map(x => `torch.flatten(${x}, 1)`).join(', ')}], dim=1)` : `torch.cat([${ins.join(', ')}], dim=${k.fanIn === 'features' ? -1 : 1})`;
                ins.splice(0, ins.length, joined);
            }
            try {
                if (b.kind === 'output' || b.kind === 'module_out') {
                    const v = b.kind === 'output' ? sc.unique(slug(b.title, 'out')) : sc.var(b, 'out_');
                    fwd.push(pad(`${v} = ${ins.length > 1 ? `torch.cat([${ins.join(', ')}], dim=-1)` : (ins[0] || 'None')}`, b.kind === 'output' ? fmtShape(b._shape) + (fanNote.length ? ' · ' + fanNote.join('; ') : '') : ''));
                    varOf.set(b.id + ':out', v); varOf.set(b.id + ':in', v);
                    continue;
                }
                if (b.kind === 'module') {
                    const def = st.modules[b.params.def]; const cls = opts.classFor(def);
                    const a = sc.attr(b);
                    init.push(`self.${a} = ${cls}()`);
                    const io = NA.model.moduleIO(def.id);
                    const v = sc.var(b);
                    if (io.outs.length <= 1) {
                        fwd.push(pad(`${v} = self.${a}(${ins.join(', ')})`, fmtShape(b._shape)));
                        if (io.outs[0]) varOf.set(b.id + ':out:' + io.outs[0].id, v);
                    } else {
                        const names = io.outs.map(o => sc.unique(v + '_' + slug(o.title, 'out')));
                        fwd.push(`${names.join(', ')} = self.${a}(${ins.join(', ')})`);
                        io.outs.forEach((o, i) => varOf.set(b.id + ':out:' + o.id, names[i]));
                    }
                    varOf.set(b.id + ':out', v);
                    continue;
                }
                if (!k.torch) throw new Error('cannot be exported');
                if (!b._inShapes || b._inShapes.some(s => !s)) { if (b.kind !== 'custom') throw new Error(b._error || 'unknown input shape'); }
                const line = k.torch.init(b, ctx);
                if (line) init.push(pad(`self.${sc.attr(b)} = ${line}`, ''));
                let expr = k.torch.forward(b, ins, ctx);
                // Sparse contributions land on this block's output
                const extra = [];
                for (const [key, s] of sparseAttr) if (s.tb.id === b.id) { const src = exprFor({ block: s.fb.id, port: 'out' }); extra.push(`self.${s.name}(${src})`); }
                if (extra.length) expr = `${expr} + ${extra.join(' + ')}`;
                const v = sc.var(b);
                const comment = b._error ? '⚠ ' + b._error : (fmtShape(b._shape) + (fanNote.length ? ' · ' + fanNote.join('; ') : '') + (b.comment ? ' · ' + b.comment.split('\n')[0] : ''));
                fwd.push(pad(`${v} = ${expr}`, comment));
                varOf.set(b.id + ':out', v);
            } catch (e) {
                report.errors.push(`${b.title}: ${e.message}`);
                const v = sc.var(b); fwd.push(`${v} = None  # ERROR: ${e.message}`); varOf.set(b.id + ':out', v);
            }
        }
        for (const [key, s] of sparseAttr) {
            const edges = s.list.map(n => `(${n.from.idx}, ${n.to.idx}, ${fmtInit(n.init)})`);
            init.push(`self.${s.name} = SparseLinear(${s.inN}, ${s.outN}, edges=[${edges.join(', ')}])` + (edges.length <= 2 ? '' : `  # ${edges.length} drawn edges ${s.fb.title} → ${s.tb.title}`));
            // Sparse edges into a block that produced no line (e.g. an input) are impossible; skip silently
        }
        const args = inputs.map(b => varOf.get(b.id + ':out'));
        const rets = outputs.map(b => varOf.get(b.id + ':out') || 'None');
        const lines = [];
        lines.push(`class ${className}(nn.Module):`);
        const doc = opts.def ? (opts.def.comment || `Module "${opts.def.name}"`) : (st.meta.description || st.meta.name);
        lines.push(`    """${doc.replace(/"/g, "'").replace(/\\$/, '')} """`);
        lines.push('');
        lines.push('    def __init__(self):');
        lines.push('        super().__init__()');
        if (!init.length) lines.push('        pass');
        for (const l of init) lines.push('        ' + l);
        lines.push('');
        lines.push(`    def forward(self, ${args.join(', ')}):`);
        for (const b of inputs) lines.push(`        # ${varOf.get(b.id + ':out')}: ${fmtShape(b._shape)}${b.comment ? ' — ' + b.comment.split('\n')[0] : ''}`);
        for (const l of fwd) lines.push('        ' + l);
        lines.push(`        return ${rets.length === 1 ? rets[0] : rets.join(', ')}`);
        return { code: lines.join('\n'), args, rets, inputs, outputs };
    }

    // Which module definitions does a graph use (transitively), dependencies first?
    function usedDefs(st) {
        const seen = new Set(), out = [];
        const visit = (g, depth) => {
            if (depth > 8) return;
            for (const b of g.blocks) if (b.kind === 'module' && st.modules[b.params.def] && !seen.has(b.params.def)) {
                const def = st.modules[b.params.def];
                seen.add(def.id); visit(def.graph, depth + 1); out.push(def);
            }
        };
        visit(st, 0);
        return out;
    }

    function generate(opts = {}) {
        const st = NA.model.get();
        NA.graph.refresh();
        const report = { errors: [], warnings: [] };
        const defs = usedDefs(st);
        const classNames = new Map(); const usedNames = new Set();
        const uniqueClass = (base) => { let n = base, i = 2; while (usedNames.has(n)) n = base + i++; usedNames.add(n); return n; };
        const mainName = uniqueClass(pascal(st.meta.className || st.meta.name, 'Model'));
        for (const d of defs) classNames.set(d.id, uniqueClass(pascal(d.name, 'Module')));
        const classFor = (def) => classNames.get(def.id);
        const hasSparse = st.neuronEdges.length > 0 || defs.some(d => d.graph.neuronEdges.length > 0);
        const parts = [];
        for (const d of defs) parts.push(emitClass(d.graph, classNames.get(d.id), st, { def: d, classFor }, report).code);
        const main = emitClass(st, mainName, st, { classFor }, report);
        parts.push(main.code);

        // Smoke test
        const smoke = [];
        smoke.push('if __name__ == "__main__":');
        smoke.push(`    model = ${mainName}()`);
        smoke.push('    model.eval()');
        const argNames = [];
        for (const b of main.inputs) {
            const v = main.args[main.inputs.indexOf(b)]; argNames.push(v);
            const shape = b._shape || NA.util.parseShape(b.params.shape);
            if (b.params.dtype === 'int64') {
                const emb = st.blocks.find(x => x.kind === 'embedding' && st.edges.some(e => e.from.block === b.id && e.to.block === x.id));
                smoke.push(`    ${v} = torch.randint(0, ${emb ? emb.params.vocab : 100}, (4, ${shape.join(', ')}))`);
            } else smoke.push(`    ${v} = torch.randn(4, ${shape.join(', ')})`);
        }
        smoke.push('    with torch.no_grad():');
        smoke.push(`        ${main.rets.length === 0 ? '_' : (main.rets.length === 1 ? main.rets[0] : main.rets.join(', '))} = model(${argNames.join(', ')})`);   // no Output block yet: still valid Python
        main.outputs.forEach((b, i) => {
            const v = main.rets[i];
            smoke.push(`    print("${v}", tuple(${v}.shape))`);
            if (b._shape) smoke.push(`    assert tuple(${v}.shape) == (4, ${b._shape.join(', ')})`);
        });
        smoke.push('    print("parameters:", sum(p.numel() for p in model.parameters()))');

        // Header + docstring with the embedded project
        // One line per block and wire, so a diff of the .py shows the design change, not a 6 kB blob
        const project = NA.model.serialize();
        const json = NA.util.jsonLines(project);
        const ins = main.inputs.map(b => `${main.args[main.inputs.indexOf(b)]} ${fmtShape(b._shape)}` + (b.regions.length ? `  (regions: ${b.regions.map(r => `${r.name} [${r.start}:${r.end}]`).join(', ')})` : ''));
        const outs = main.outputs.map((b, i) => `${main.rets[i]} ${fmtShape(b._shape)}`);
        const head = [
            'r"""' + st.meta.name + ' — generated by Neural Architect (mlorenz.xyz/vibe-code/utilities/neural_architect)',
            '',
            ...(st.meta.description ? [st.meta.description, ''] : []),
            'Inputs : ' + (ins.join('\n         ') || '—'),
            'Outputs: ' + (outs.join('\n         ') || '—'),
            'Parameters: ~' + fmtNum(NA.graph.paramCount(st)),
            '',
            'Training vs inference: the same module serves both — call model.train() to enable the',
            'training-only parts and model.eval() to switch them off (the smoke test below uses eval()).',
            ...trainingNotes(st),
            '',
            'Open this file in Neural Architect to keep editing — the full design is embedded below.',
            '',
            MARK_A,
            json,
            MARK_B,
            '"""',
            'import torch',
            'import torch.nn as nn',
            'import torch.nn.functional as F',
            '',
        ];
        const code = head.join('\n') + (hasSparse ? '\n' + SPARSE_LINEAR : '') + '\n\n' + parts.join('\n\n\n') + '\n\n\n' + smoke.join('\n') + '\n';
        return { code, errors: report.errors, warnings: report.warnings, className: mainName, filename: slug(st.meta.name, 'model') + '.py' };
    }

    // Pull the embedded project back out of a generated .py
    function extractProject(src) {
        const re = new RegExp(MARK_A.replace(/[@-]/g, '\\$&') + '\\s*\\n([\\s\\S]*?)\\n\\s*' + MARK_B.replace(/[@-]/g, '\\$&'));
        const m = re.exec(src);
        if (!m) return null;
        try { return JSON.parse(m[1].trim()); } catch (_) { return null; }
    }
    // Lines for the docstring: which blocks carry training-only behaviour
    function trainingNotes(st) {
        const all = [st, ...Object.values(st.modules || {}).map(m => m.graph)];
        const drops = [], bns = [], inner = [];
        for (const g of all) for (const b of g.blocks) {
            if (b.dropout > 0) drops.push(`${b.title} (p=${b.dropout})`);
            if (b.kind === 'batchnorm') bns.push(b.title);
            if ((b.kind === 'transformer' || b.kind === 'rnn' || b.kind === 'attention') && b.params.dropout > 0) inner.push(`${b.title} (${b.params.dropout})`);
        }
        const out = [];
        if (drops.length) out.push('  dropout on: ' + drops.join(', '));
        if (inner.length) out.push('  internal dropout in: ' + inner.join(', '));
        if (bns.length) out.push('  batch statistics (train) / running statistics (eval) in: ' + bns.join(', '));
        if (!out.length) out.push('  no training-only behaviour: train() and eval() compute the same function.');
        return out;
    }
    NA.codegen.pytorch = { generate, extractProject, MARK_A, MARK_B, trainingNotes };
})();

// ============================================================
// NA.codegen.keras — functional-model JSON (model_from_json)
// ============================================================
(() => {
    const { slug } = NA.util;
    function generate() {
        const st = NA.model.get();
        NA.graph.refresh();
        const warnings = [];
        const g = NA.codegen.flatten(st);
        NA.graph.inferShapes(g, null, 0);
        const { order } = NA.graph.topoSort(g);
        const used = new Set(); const uniq = (base) => { let n = base, i = 2; while (used.has(n)) n = base + '_' + i++; used.add(n); return n; };
        const names = new Map(); const nameOf = (b) => { if (!names.has(b.id)) names.set(b.id, uniq(slug(b.title, b.kind))); return names.get(b.id); };
        const ctx = { warn: (m) => warnings.push(m), nhwc: g.blocks.some(b => /^conv|^pool$/.test(b.kind)) };
        const layers = [];
        const tensorOf = new Map();   // "block:port" -> {name, shape}
        const tensor = (t) => ({ class_name: '__keras_tensor__', config: { shape: [null, ...(t.shape || [])], dtype: t.dtype || 'float32', keras_history: [t.name, 0, 0] } });
        const add = (name, cls, config, inputs, shape, extra = {}) => {
            const args = Array.isArray(inputs) ? [inputs.map(tensor)] : (inputs ? [tensor(inputs)] : []);
            layers.push(Object.assign({ module: 'keras.layers', class_name: cls, config: Object.assign({ name, trainable: true, dtype: 'float32' }, config), registered_name: null, name, inbound_nodes: inputs ? [{ args, kwargs: extra.kwargs || {} }] : [] }));
            return { name, shape };
        };
        // NHWC helper: channels-first per-sample shape → channels-last
        const toNhwc = (s) => s && s.length >= 2 ? [...s.slice(1), s[0]] : s;
        const srcOf = (from) => {
            const key = from.block + ':' + from.port;
            if (tensorOf.has(key)) return tensorOf.get(key);
            const b = g.blocks.find(x => x.id === from.block);
            if (b && from.port.startsWith('out:')) {
                const r = b.regions.find(x => x.id === from.port.slice(4)); const base = tensorOf.get(b.id + ':out');
                if (r && base) {
                    const name = uniq(base.name + '_' + slug(r.name, 'region'));
                    const shape = [r.end - r.start, ...(b._shape || []).slice(1)];
                    warnings.push(`${b.title} · ${r.name}: region slices are emitted as Lambda layers whose function is a source string — rebuild them with keras.ops.slice or load with safe_mode=False`);
                    const t = add(name, 'Lambda', { function: `lambda x: x[:, ${r.start}:${r.end}]`, output_shape: shape }, base, shape);
                    tensorOf.set(key, t); return t;
                }
            }
            return null;
        };
        // A wire's activation becomes an Activation layer between the two blocks (LeakyReLU has its own class)
        const wireLayers = new Map();
        const activated = (t, e) => {
            if (!t) return t;
            const src = g.blocks.find(x => x.id === e.from.block); const p = src && src.dropout > 0 ? src.dropout : 0;
            const acts = NA.codegen.actsOf(e); if (!acts.length && !p) return t;
            const key = t.name + ':' + acts.join('>') + ':' + p; if (wireLayers.has(key)) return wireLayers.get(key);
            for (const a of acts) {
                const name = uniq(t.name + '_' + a);
                t = a === 'leaky_relu' ? add(name, 'LeakyReLU', { negative_slope: 0.01 }, t, t.shape) : add(name, 'Activation', { activation: NA.catalogue.ACT[a].keras }, t, t.shape);
            }
            if (p) t = add(uniq(t.name + '_dropout'), 'Dropout', { rate: p }, t, t.shape);
            wireLayers.set(key, t); return t;
        };
        const inputLayers = [], outputLayers = [];
        for (const b of order) {
            const k = NA.catalogue.get(b.kind);
            const inPorts = NA.model.inputPortIds(b, g);
            const ins = [];
            inPorts.forEach((pid, i) => {
                const es = k.fanIn ? NA.graph.incomingAll(g, b.id, pid) : [NA.graph.incomingOn(g, b.id, pid)].filter(Boolean);
                if (!es.length) { if (k.inputs === 'variadic' && i === inPorts.length - 1) return; ins.push(null); return; }
                const ts = es.map(e => activated(srcOf(e.from), e));
                if (ts.length > 1 && ts.every(Boolean) && k.fanIn === 'tokens') ins.push(...ts);
                else if (ts.length > 1 && ts.every(Boolean) && k.fanIn === 'flat') {
                    const flat = ts.map(t => add(uniq(t.name + '_flat'), 'Flatten', {}, t, [t.shape.reduce((x, y) => x * y, 1)]));
                    ins.push(add(uniq(nameOf(b) + '_cat'), 'Concatenate', { axis: -1 }, flat, [flat.reduce((n, t) => n + t.shape[0], 0)]));
                } else if (ts.length > 1 && ts.every(Boolean)) {
                    // Keras is channels-last, so 'features' and image 'channels' both join on the last axis; sequences join on axis 1
                    const axis = k.fanIn === 'features' || !/^(rnn|embedding)$/.test(b.kind) ? -1 : 1;
                    const shape = axis === -1 ? [...ts[0].shape.slice(0, -1), ts.reduce((n, t) => n + t.shape[t.shape.length - 1], 0)] : [ts.reduce((n, t) => n + t.shape[0], 0), ...ts[0].shape.slice(1)];
                    ins.push(add(uniq(nameOf(b) + '_cat'), 'Concatenate', { axis }, ts, shape));
                } else ins.push(ts[0] || null);
            });
            if (ins.some(x => !x)) { warnings.push(`${b.title}: skipped (unconnected input)`); continue; }
            const name = nameOf(b);
            if (b.kind === 'input') {
                const shape = b._shape || [];
                const dtype = b.params.dtype || 'float32';
                let t = add(name, 'InputLayer', { batch_shape: [null, ...shape], dtype, sparse: false }, null, shape); t.dtype = dtype;
                inputLayers.push([name, 0, 0]);
                if (ctx.nhwc && shape.length >= 2 && g.edges.some(e => e.from.block === b.id && /^conv|^pool$/.test(g.blocks.find(x => x.id === e.to.block)?.kind))) {
                    const dims = shape.length === 3 ? [2, 3, 1] : [2, 1];
                    t = add(uniq(name + '_nhwc'), 'Permute', { dims }, t, toNhwc(shape));
                    warnings.push(`${b.title}: Keras convolutions are channels-last — a Permute layer was inserted after the input`);
                }
                tensorOf.set(b.id + ':out', t);
                continue;
            }
            if (b.kind === 'output') { const t = ins[0]; outputLayers.push([t.name, 0, 0]); tensorOf.set(b.id + ':out', t); continue; }
            if (!k.keras) { warnings.push(`${b.title}: ${k.label} cannot be exported to Keras — skipped`); tensorOf.set(b.id + ':out', ins[0]); continue; }
            let spec = null;
            try { spec = k.keras(b, ins, ctx); } catch (e) { warnings.push(`${b.title}: ${e.message}`); }
            if (!spec) { tensorOf.set(b.id + ':out', ins[0]); continue; }
            const outShape = ctx.nhwc && b._shape && b._shape.length >= 2 && (/^conv|^pool$|^batchnorm$/.test(b.kind) || b.kind === 'concat' || b.kind === 'add') ? toNhwc(b._shape) : b._shape;
            let t;
            if (spec.selfAttention) {
                let kv = ins[0];
                if (ins.length === 2) kv = ins[1];
                else if (ins.length > 2) kv = add(uniq(name + '_memory'), 'Concatenate', { axis: 1 }, ins.slice(1), [ins.slice(1).reduce((n, t) => n + t.shape[0], 0), ins[1].shape[1]]);
                const kwargs = { value: tensor(kv) }; if (b.params.causal && ins.length === 1) kwargs.use_causal_mask = true;
                t = add(name, spec.class_name, spec.config, ins[0], outShape, { kwargs });
            }
            else if (k.inputs === 'variadic') t = add(name, spec.class_name, spec.config, ins, outShape);
            else t = add(name, spec.class_name, spec.config, ins[0], outShape);
            tensorOf.set(b.id + ':out', t);
        }
        if (g.neuronEdges.length) warnings.push(`${g.neuronEdges.length} neuron-level edges have no Keras equivalent and were omitted (the PyTorch export keeps them)`);
        const model = {
            module: 'keras', class_name: 'Functional', registered_name: 'Functional',
            config: { name: slug(st.meta.name, 'model'), trainable: true, layers, input_layers: inputLayers, output_layers: outputLayers },
            keras_version: '3.0.0', backend: 'tensorflow',
        };
        return { json: JSON.stringify(model, null, 2), warnings, filename: slug(st.meta.name, 'model') + '.keras.json' };
    }
    NA.codegen.keras = { generate };
})();

// ============================================================
// NA.io.onnx — protobuf reader + op → block mapping
// ============================================================
(() => {
    // ---- minimal protobuf decoder ----
    const TD = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
    const utf8 = (u8) => TD ? TD.decode(u8) : Buffer.from(u8).toString('utf8');
    function Reader(u8, start = 0, end = u8.length) { this.u8 = u8; this.pos = start; this.end = end; }
    Reader.prototype.varint = function () {
        let lo = 0, shift = 0, big = null;
        while (true) {
            if (this.pos >= this.end) throw new Error('Truncated varint');
            const b = this.u8[this.pos++];
            if (shift < 28) lo += (b & 0x7f) * Math.pow(2, shift);
            else { if (big === null) big = BigInt(lo); big += BigInt(b & 0x7f) << BigInt(shift); }
            shift += 7;
            if (!(b & 0x80)) break;
        }
        if (big === null) return lo;
        const signed = BigInt.asIntN(64, big);
        return Number(signed);
    };
    Reader.prototype.skip = function (wire) {
        if (wire === 0) this.varint();
        else if (wire === 1) this.pos += 8;
        else if (wire === 5) this.pos += 4;
        else if (wire === 2) { const n = this.varint(); this.pos += n; }
        else throw new Error('Unsupported protobuf wire type ' + wire);
    };
    const F32 = new DataView(new ArrayBuffer(8));
    function decode(u8, schema, start = 0, end = u8.length) {
        const r = new Reader(u8, start, end); const out = {};
        while (r.pos < end) {
            const tag = r.varint(); const num = Math.floor(tag / 8), wire = tag & 7;
            const f = schema[num];
            if (!f) { r.skip(wire); continue; }
            const [name, type, mode] = f;
            let val;
            if (type === 'skip') { if (wire === 2) { const n = r.varint(); val = { bytes: n }; r.pos += n; } else { r.skip(wire); continue; } }
            else if (typeof type === 'object') { const n = r.varint(); val = decode(u8, type, r.pos, r.pos + n); r.pos += n; }
            else if (type === 'string' || type === 'bytes') { const n = r.varint(); const sub = u8.subarray(r.pos, r.pos + n); r.pos += n; val = type === 'string' ? utf8(sub) : sub; }
            else if (type === 'int') { if (wire === 2 && mode === 'packed') { const n = r.varint(); const e = r.pos + n; const arr = []; while (r.pos < e) arr.push(r.varint()); val = arr; } else val = r.varint(); }
            else if (type === 'float') { if (wire === 2) { const n = r.varint(); const arr = []; for (let i = 0; i < n; i += 4) { arr.push(new DataView(u8.buffer, u8.byteOffset + r.pos + i, 4).getFloat32(0, true)); } r.pos += n; val = arr; } else { val = new DataView(u8.buffer, u8.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; } }
            else if (type === 'double') { val = new DataView(u8.buffer, u8.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; }
            else { r.skip(wire); continue; }
            if (mode === 'rep' || mode === 'packed') { if (!out[name]) out[name] = []; if (Array.isArray(val) && mode === 'packed') out[name].push(...val); else out[name].push(val); }
            else out[name] = val;
        }
        return out;
    }
    const Dimension = { 1: ['dim_value', 'int'], 2: ['dim_param', 'string'] };
    const Shape = { 1: ['dim', Dimension, 'rep'] };
    const TensorType = { 1: ['elem_type', 'int'], 2: ['shape', Shape] };
    const TypeProto = { 1: ['tensor_type', TensorType] };
    const ValueInfo = { 1: ['name', 'string'], 2: ['type', TypeProto] };
    const TensorProto = { 1: ['dims', 'int', 'packed'], 2: ['data_type', 'int'], 4: ['float_data', 'skip'], 5: ['int32_data', 'int', 'packed'], 7: ['int64_data', 'int', 'packed'], 8: ['name', 'string'], 9: ['raw_data', 'bytes'] };
    const Attribute = { 1: ['name', 'string'], 2: ['f', 'float'], 3: ['i', 'int'], 4: ['s', 'bytes'], 5: ['t', TensorProto], 6: ['g', 'skip'], 7: ['floats', 'float', 'packed'], 8: ['ints', 'int', 'packed'], 9: ['strings', 'bytes', 'rep'], 20: ['type', 'int'] };
    const Node = { 1: ['input', 'string', 'rep'], 2: ['output', 'string', 'rep'], 3: ['name', 'string'], 4: ['op_type', 'string'], 5: ['attribute', Attribute, 'rep'], 7: ['domain', 'string'] };
    const Graph = { 1: ['node', Node, 'rep'], 2: ['name', 'string'], 5: ['initializer', TensorProto, 'rep'], 11: ['input', ValueInfo, 'rep'], 12: ['output', ValueInfo, 'rep'], 13: ['value_info', ValueInfo, 'rep'] };
    const Opset = { 1: ['domain', 'string'], 2: ['version', 'int'] };
    const Model = { 1: ['ir_version', 'int'], 2: ['producer_name', 'string'], 7: ['graph', Graph], 8: ['opset_import', Opset, 'rep'] };

    function parse(buffer) {
        const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const m = decode(u8, Model);
        if (!m.graph) throw new Error('Not an ONNX model (no graph)');
        for (const key of ['node', 'initializer', 'input', 'output', 'value_info']) m.graph[key] = m.graph[key] || [];
        return m;
    }

    // ---- mapping ----
    const ACT_OPS = { Relu: 'relu', Gelu: 'gelu', Sigmoid: 'sigmoid', Tanh: 'tanh', Softmax: 'softmax', LeakyRelu: 'leaky_relu', Elu: 'elu', Softplus: 'softplus', Mish: 'mish', HardSwish: 'silu' };
    function tensorInts(t) {
        if (!t) return null;
        if (t.int64_data && t.int64_data.length) return t.int64_data;
        if (t.int32_data && t.int32_data.length) return t.int32_data;
        if (t.raw_data && t.raw_data.length) {
            const dv = new DataView(t.raw_data.buffer, t.raw_data.byteOffset, t.raw_data.byteLength);
            const out = [];
            if (t.data_type === 7) for (let i = 0; i + 8 <= t.raw_data.byteLength; i += 8) out.push(Number(dv.getBigInt64(i, true)));
            else if (t.data_type === 6) for (let i = 0; i + 4 <= t.raw_data.byteLength; i += 4) out.push(dv.getInt32(i, true));
            return out;
        }
        return null;
    }
    function shapeOf(vi) {
        const dims = vi?.type?.tensor_type?.shape?.dim; if (!dims) return null;
        return dims.map(d => d.dim_value && d.dim_value > 0 ? d.dim_value : null);
    }
    function toProject(model, filename = 'model.onnx') {
        const g = model.graph;
        const p = NA.model.blank((filename || 'ONNX model').replace(/\.onnx$/i, ''));
        p.meta.description = `Imported from ${filename}${model.producer_name ? ' (' + model.producer_name + ')' : ''}.`;
        const warnings = [];
        const inits = new Map(); for (const t of g.initializer) inits.set(t.name, t);
        for (const n of g.node) if (n.op_type === 'Constant') { const a = (n.attribute || []).find(x => x.name === 'value'); if (a && a.t) inits.set(n.output[0], a.t); const ints = (n.attribute || []).find(x => x.name === 'value_ints'); if (ints) inits.set(n.output[0], { dims: [ints.ints.length], int64_data: ints.ints }); }
        const shapes = new Map(); for (const vi of [...g.input, ...g.output, ...g.value_info]) shapes.set(vi.name, shapeOf(vi));
        const producer = new Map();     // tensor name -> {block, port}
        const blocks = p.blocks, edges = p.edges;
        let y = 0;
        const B = (kind, title, o = {}) => { const b = NA.model.makeBlock(kind, title, Object.assign({ pos: { x: 0, y: (y += 100) } }, o)); blocks.push(b); return b; };
        const wire = (tensorName, toBlock, toPort) => {
            const src = producer.get(tensorName);
            if (!src) { warnings.push(`${toBlock.title}: input tensor "${tensorName}" has no producer`); return false; }
            edges.push(NA.model.makeEdge(src.block, toBlock, src.port, toPort)); return true;
        };
        const attr = (n, name, d) => { const a = (n.attribute || []).find(x => x.name === name); if (!a) return d; if (a.i !== undefined) return a.i; if (a.f !== undefined) return a.f; if (a.ints) return a.ints; if (a.floats) return a.floats; if (a.s) return utf8(a.s); return d; };
        const perSample = (s) => s ? s.slice(1).map(v => v || 1) : null;
        // Graph inputs (initializers may be listed as inputs in old files)
        for (const vi of g.input) {
            if (inits.has(vi.name)) continue;
            const s = perSample(shapes.get(vi.name)) || [1];
            const elem = vi.type?.tensor_type?.elem_type;
            const b = B('input', vi.name, { params: { shape: s, dtype: (elem === 7 || elem === 6) ? 'int64' : 'float32' } });
            producer.set(vi.name, { block: b, port: 'out' });
        }
        const consumed = new Set();
        const unmapped = new Map();
        const nodes = g.node;
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (consumed.has(i) || n.op_type === 'Constant') continue;
            const op = n.op_type; const out = n.output[0];
            const dataIns = n.input.filter(t => t && !inits.has(t));
            const title = n.name || op;
            let b = null;
            const passthrough = () => { const src = producer.get(dataIns[0]); if (src) producer.set(out, src); };
            switch (op) {
                case 'Gemm': {
                    const W = inits.get(n.input[1]); if (!W) { break; }
                    const transB = attr(n, 'transB', 0);
                    b = B('linear', title, { size: transB ? W.dims[0] : W.dims[1], params: { bias: !!n.input[2] } });
                    wire(dataIns[0], b, 'in'); break;
                }
                case 'MatMul': {
                    const W = inits.get(n.input[1]); if (!W) break;
                    let bias = false;
                    const next = nodes[i + 1];
                    if (next && next.op_type === 'Add' && next.input.includes(out) && next.input.some(t => inits.has(t)) && nodes.filter(x => x.input.includes(out)).length === 1) { bias = true; consumed.add(i + 1); }
                    b = B('linear', title, { size: W.dims[W.dims.length - 1], params: { bias } });
                    wire(dataIns[0], b, 'in');
                    if (bias) { producer.set(next.output[0], { block: b, port: 'out' }); }
                    break;
                }
                case 'Conv': {
                    const W = inits.get(n.input[1]); if (!W) break;
                    const ks = attr(n, 'kernel_shape', W.dims.slice(2)); const dim = ks.length === 1 ? 1 : 2;
                    const pads = attr(n, 'pads', [0, 0, 0, 0]); if (pads.some(v => v !== pads[0])) warnings.push(`${title}: asymmetric padding ${pads.join(',')} approximated`);
                    b = B('conv' + dim + 'd', title, { size: W.dims[0], params: { kernel: ks[0], stride: attr(n, 'strides', [1])[0], padding: pads[0], dilation: attr(n, 'dilations', [1])[0], groups: attr(n, 'group', 1), bias: !!n.input[2] } });
                    wire(dataIns[0], b, 'in'); break;
                }
                case 'BatchNormalization': b = B('batchnorm', title, { params: { eps: attr(n, 'epsilon', 1e-5), momentum: 1 - attr(n, 'momentum', 0.9) } }); wire(dataIns[0], b, 'in'); break;
                case 'LayerNormalization': b = B('layernorm', title, { params: { eps: attr(n, 'epsilon', 1e-5) } }); wire(dataIns[0], b, 'in'); break;
                case 'Dropout': { const ratio = attr(n, 'ratio', null); b = B('dropout', title, { params: { p: ratio ?? 0.1 } }); wire(dataIns[0], b, 'in'); break; }
                case 'Flatten': b = B('flatten', title); wire(dataIns[0], b, 'in'); break;
                case 'Reshape': {
                    const shp = tensorInts(inits.get(n.input[1])); const outS = perSample(shapes.get(out));
                    let target = shp ? shp.slice(1) : null;
                    if (!target || target.some(v => v <= 0)) target = outS;
                    if (!target) { warnings.push(`${title}: reshape target unknown`); target = [1]; }
                    b = B('reshape', title, { params: { shape: target } }); wire(dataIns[0], b, 'in'); break;
                }
                case 'Concat': { const axis = attr(n, 'axis', 1); b = B('concat', title, { params: { dim: axis < 0 ? -1 : Math.max(0, axis - 1) } }); dataIns.forEach((t, j) => wire(t, b, 'in:' + j)); break; }
                case 'Add': case 'Sum': {
                    if (dataIns.length >= 2) { b = B('add', title); dataIns.forEach((t, j) => wire(t, b, 'in:' + j)); }
                    else { b = B('custom', title + ' (+ constant)', { params: { forward: '{x}', shape: [] }, comment: 'ONNX Add with a constant tensor — supply the constant by hand.' }); wire(dataIns[0], b, 'in:0'); warnings.push(`${title}: Add with a constant operand emitted as a custom block`); }
                    break;
                }
                case 'Sub': case 'Mul': case 'Div': {
                    const sym = { Sub: '-', Mul: '*', Div: '/' }[op];
                    if (dataIns.length >= 2) { b = B('custom', title, { params: { forward: `{x0} ${sym} {x1}`, shape: [] } }); dataIns.forEach((t, j) => wire(t, b, 'in:' + j)); }
                    else { b = B('custom', title + ' (constant)', { params: { forward: '{x}', shape: [] } }); wire(dataIns[0], b, 'in:0'); warnings.push(`${title}: ${op} with a constant operand emitted as a passthrough custom block`); }
                    break;
                }
                case 'MaxPool': case 'AveragePool': { const ks = attr(n, 'kernel_shape', [2]); b = B('pool', title, { params: { mode: op === 'MaxPool' ? 'max' : 'avg', kernel: ks[0], stride: attr(n, 'strides', [ks[0]])[0] } }); wire(dataIns[0], b, 'in'); break; }
                case 'GlobalAveragePool': b = B('pool', title, { params: { mode: 'global_avg' } }); wire(dataIns[0], b, 'in'); break;
                case 'GlobalMaxPool': b = B('pool', title, { params: { mode: 'global_max' } }); wire(dataIns[0], b, 'in'); break;
                case 'Gather': {
                    const table = inits.get(n.input[0]);
                    if (table && table.dims.length === 2) { b = B('embedding', title, { size: table.dims[1], params: { vocab: table.dims[0] } }); wire(dataIns[0], b, 'in'); const src = producer.get(dataIns[0]); if (src && src.block.kind === 'input') src.block.params.dtype = 'int64'; }
                    break;
                }
                case 'Identity': case 'Cast': passthrough(); continue;
                default: break;
            }
            if (!b && ACT_OPS[op]) { b = B('activation', title, { params: { fn: ACT_OPS[op] } }); wire(dataIns[0], b, 'in'); }
            if (!b) {
                unmapped.set(op, (unmapped.get(op) || 0) + 1);
                const outS = perSample(shapes.get(out));
                b = B('custom', title, { params: { forward: '{x}', shape: outS || [] }, comment: `Unmapped ONNX op "${op}" — passthrough placeholder.` });
                b._unmapped = op; b.color = '#f59e0b';
                dataIns.forEach((t, j) => wire(t, b, 'in:' + j));
            }
            producer.set(out, { block: b, port: 'out' });
            for (let j = 1; j < n.output.length; j++) if (n.output[j]) producer.set(n.output[j], { block: b, port: 'out' });
        }
        for (const vi of g.output) { const o = B('output', vi.name); if (!wire(vi.name, o, 'in')) { blocks.pop(); } }
        for (const [op, c] of unmapped) warnings.push(`${c}× ${op}: no block equivalent, imported as a placeholder custom block`);
        NA.graph.inferShapes(p, null, 0);
        NA.model.foldActivations(p); NA.model.foldDropouts(p);
        NA.layout.auto(p);
        const out = NA.model.strip(p);
        // keep the amber colour on placeholders (strip drops only underscore keys)
        return Object.assign(out, { _warnings: warnings });
    }

    // ---- tiny encoder for tests (varint + length-delimited only) ----
    const enc = (() => {
        const bytes = [];
        const varint = (v, out) => { let n = v; while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128); } out.push(n); };
        const field = (num, wire, out) => varint(num * 8 + wire, out);
        const str = (num, s, out) => { const u = new TextEncoder().encode(s); field(num, 2, out); varint(u.length, out); out.push(...u); };
        const int = (num, v, out) => { field(num, 0, out); varint(v, out); };
        const msg = (num, inner, out) => { field(num, 2, out); varint(inner.length, out); out.push(...inner); };
        const packed = (num, arr, out) => { const inner = []; for (const v of arr) varint(v, inner); field(num, 2, out); varint(inner.length, out); out.push(...inner); };
        const tensor = (t) => { const o = []; packed(1, t.dims, o); int(2, 1, o); str(8, t.name, o); return o; };
        const dim = (d) => { const o = []; int(1, d, o); return o; };
        const vi = (v) => { const shape = []; for (const d of v.shape) msg(1, dim(d), shape); const tt = []; int(1, 1, tt); msg(2, shape, tt); const tp = []; msg(1, tt, tp); const o = []; str(1, v.name, o); msg(2, tp, o); return o; };
        const attrM = (a) => { const o = []; str(1, a.name, o); if (a.i !== undefined) int(3, a.i, o); if (a.ints) packed(8, a.ints, o); return o; };
        const node = (n) => { const o = []; for (const s of n.input) str(1, s, o); for (const s of n.output) str(2, s, o); if (n.name) str(3, n.name, o); str(4, n.op_type, o); for (const a of (n.attrs || [])) msg(5, attrM(a), o); return o; };
        const graph = (g) => { const o = []; for (const n of g.node) msg(1, node(n), o); str(2, g.name || 'g', o); for (const t of g.initializer) msg(5, tensor(t), o); for (const v of g.input) msg(11, vi(v), o); for (const v of g.output) msg(12, vi(v), o); return o; };
        const model = (m) => { const o = []; int(1, 8, o); str(2, 'neural-architect-test', o); msg(7, graph(m.graph), o); return new Uint8Array(o); };
        return { model };
    })();

    NA.io.onnx = { parse, toProject, _test: { encode: enc, decode } };
})();
