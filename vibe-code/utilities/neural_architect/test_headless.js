/* test_headless.js — Node assertion suite for Neural Architect. Run: node test_headless.js
 *
 * Loads core.js + codegen.js (the DOM-free half) into this context and checks the
 * catalogue, the data model round-trip, shape inference on every template, topo
 * sort, auto-layout, the PyTorch / Keras generators and the ONNX reader. If
 * python + torch are installed it also RUNS every generated .py, which is the
 * only real proof that "runnable PyTorch" is runnable.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { spawnSync } = require("child_process");

globalThis.window = globalThis;
for (const f of ["core.js", "codegen.js"]) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) { console.log(`(skipping ${f} — not written yet)`); continue; }
    vm.runInThisContext(fs.readFileSync(p, "utf8"), { filename: f });
}
const NA = globalThis.NA;

let failures = 0, checks = 0;
function check(name, ok, extra) {
    checks++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}
function section(t) { console.log(`\n\x1b[36m── ${t}\x1b[0m`); }
const outDir = process.env.NA_TEST_OUT || path.join(os.tmpdir(), "na_test");
fs.mkdirSync(outDir, { recursive: true });

/* ==================================================== 1. catalogue */
section("catalogue");
{
    const kinds = NA.catalogue.kinds();
    check("catalogue has the planned kinds", ["input", "linear", "conv1d", "conv2d", "activation", "batchnorm", "layernorm", "dropout", "flatten", "reshape", "concat", "add", "embedding", "attention", "transformer", "pool", "output", "custom", "module", "module_in", "module_out"].every(k => kinds.includes(k)), kinds.join(","));
    let bad = [];
    for (const k of kinds) {
        const d = NA.catalogue.get(k);
        if (k === "module") continue;
        if (typeof d.infer !== "function") bad.push(k + ".infer");
        if (!["module_in", "module_out"].includes(k) && (!d.torch || typeof d.torch.forward !== "function")) bad.push(k + ".torch.forward");
        for (const p of d.params) if (p.default === undefined) bad.push(k + ".params." + p.key);
    }
    check("every kind declares infer / torch.forward / param defaults", bad.length === 0, bad.join(" "));
}

/* ==================================================== 2. model round-trip */
section("model");
{
    NA.model.newProject("Round trip");
    const a = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "Obs", params: { shape: [10] }, regions: [{ name: "A", start: 0, end: 4 }, { name: "B", start: 4, end: 10 }] });
    const l = NA.model.addBlock("linear", { x: 300, y: 0 }, { title: "Hidden", size: 8 });
    const o = NA.model.addBlock("output", { x: 600, y: 0 }, { title: "Out" });
    const e1 = NA.model.addEdge({ block: a.id, port: "out:" + a.regions[0].id }, { block: l.id, port: "in" });
    check("edge from a region port connects", !!e1.edge, e1.error);
    check("region port shape is the region length", JSON.stringify(l._inShapes[0]) === "[4]", JSON.stringify(l._inShapes));
    NA.model.addEdge({ block: l.id, port: "out" }, { block: o.id, port: "in" });
    const cyc = NA.model.addEdge({ block: o.id, port: "out" }, { block: l.id, port: "in" });
    check("cycle refused", !!cyc.error, cyc.error);
    const ne = NA.model.addNeuronEdge({ block: a.id, idx: 3 }, { block: l.id, idx: 7 }, 0.25);
    check("neuron edge added", !!ne.edge, ne.error);
    const bad = NA.model.addNeuronEdge({ block: a.id, idx: 10 }, { block: l.id, idx: 0 });
    check("neuron edge out of range refused", !!bad.error);
    NA.model.setNeuron(l.id, 7, { label: "gate" });
    const json = NA.model.serialize();
    check("serialize strips transient keys", !JSON.stringify(json).includes('"_'));
    NA.model.replace(JSON.parse(JSON.stringify(json)));
    const again = NA.model.serialize();
    delete json.savedAt; delete again.savedAt;
    check("serialize → replace → serialize is identity", JSON.stringify(json) === JSON.stringify(again));
    let threw = false; try { NA.model.migrate({ format: "nope" }); } catch (_) { threw = true; }
    check("migrate rejects a foreign format", threw);
    const dangling = NA.model.migrate({ format: NA.config.FORMAT, version: 1, blocks: [{ id: "x", kind: "linear", title: "L" }], edges: [{ from: { block: "x", port: "out" }, to: { block: "missing", port: "in" } }] });
    check("migrate drops dangling edges and fills params", dangling.edges.length === 0 && dangling.blocks[0].params.bias === true && dangling.blocks[0].size > 0);
}

/* ==================================================== 3. geometry */
section("geometry");
{
    NA.model.newProject("Geometry");
    const b = NA.model.addBlock("linear", { x: 0, y: 0 }, { size: 100 });
    const L = NA.model.neuronLayout(b);
    check("neuron layout covers every neuron", L && L.cols * L.rows >= 100 && L.count === 100, JSON.stringify(L));
    let ok = true;
    for (let i = 0; i < 100; i++) { const c = NA.model.neuronCenter(b, i, L); if (NA.model.neuronAt(b, c.x, c.y, L) !== i) { ok = false; break; } }
    check("neuronCenter and neuronAt are inverse", ok);
    const cells = NA.model.regionCells(b, 3, 47, L);
    check("region cells span 1–3 rects", cells.length >= 1 && cells.length <= 3, cells.length);
    const big = NA.model.addBlock("linear", { x: 0, y: 400 }, { size: 4096 });
    check("4096-wide block uses the strip", NA.model.layoutMode(big) === "strip" && NA.model.stripRows(big).length === 8);
    NA.model.updateBlock(big.id, { ui: { expandedRegion: "chunk:512" } });
    const L2 = NA.model.neuronLayout(big);
    check("expanded chunk lays out 512 neurons from 512", L2 && L2.start === 512 && L2.end === 1024);
    check("neuronCenter outside the expanded range is null", NA.model.neuronCenter(big, 5, L2) === null);
    const pill = NA.model.addBlock("flatten", { x: 0, y: 900 });
    check("flatten without input is a pill", NA.model.rect(pill).mode === "pill");
}

/* ==================================================== 4. templates + inference */
section("templates");
for (const t of NA.templates.list) {
    const p = NA.templates.build(t.id);
    NA.model.replace(p);
    const diags = NA.graph.diagnostics().filter(d => d.level === "error");
    check(`template "${t.id}" infers without errors`, diags.length === 0, diags.map(d => d.message).join("; "));
    const { cyclic } = NA.graph.topoSort(NA.model.get());
    check(`template "${t.id}" is acyclic`, !cyclic);
    const g = NA.model.get();
    const rects = g.blocks.map(b => NA.model.rect(b));
    let overlap = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap++; }
    check(`template "${t.id}" auto-layout has no overlaps`, overlap === 0, overlap + " overlaps");
    const p2 = NA.templates.build(t.id);
    const strip = (q) => JSON.stringify(q.blocks.map(b => [b.title, b.pos]));
    check(`template "${t.id}" layout is deterministic`, strip(p) === strip(p2));
}
{
    NA.model.replace(NA.templates.build("robot_policy"));
    const g = NA.model.get();
    const head = g.blocks.find(b => b.title === "Action head");
    check("robot policy: action head sees 256", JSON.stringify(head._inShapes[0]) === "[256]");
    const fuse = g.blocks.find(b => b.title === "Fuse");
    check("robot policy: concat fuses 32+64+128", JSON.stringify(fuse._shape) === "[224]", JSON.stringify(fuse._shape));
    check("robot policy: param count is plausible", NA.graph.paramCount(g) > 100000 && NA.graph.paramCount(g) < 300000, NA.graph.paramCount(g));
}

/* ==================================================== 5. modules */
section("modules");
{
    NA.model.replace(NA.templates.build("mlp"));
    const g = NA.model.get();
    const ids = ["Hidden 1", "Hidden 2"].map(t => g.blocks.find(b => b.title === t).id);
    const r = NA.model.groupIntoModule(ids, "Stage");
    check("the ReLU wire moved into the module definition", r.def.graph.edges.some(e => e.act === "relu"), JSON.stringify(r.def.graph.edges.map(e => e.act)));
    check("group into module creates an instance", r.instance && r.instance.kind === "module", r.error);
    check("module boundary has one in and one out", NA.model.moduleIO(r.def.id).ins.length === 1 && NA.model.moduleIO(r.def.id).outs.length === 1);
    const diags = NA.graph.diagnostics().filter(d => d.level === "error");
    check("graph with module still infers", diags.length === 0, diags.map(d => d.message).join("; "));
    const lg = g.blocks.find(b => b.title === "Logits");
    check("downstream of module sees [128]", JSON.stringify(lg._inShapes[0]) === "[128]", JSON.stringify(lg._inShapes));
    const u = NA.model.ungroupModule(r.instance.id);
    check("ungroup restores the blocks", u.ids && u.ids.length === 2 && g.blocks.length === 5, u.error + " " + g.blocks.length);
    check("ungroup restores the ReLU on the wire", g.edges.some(e => e.act === "relu"), JSON.stringify(g.edges.map(e => e.act)));
    check("ungrouped graph infers identically", NA.graph.diagnostics().filter(d => d.level === "error").length === 0 && JSON.stringify(g.blocks.find(b => b.title === "Hidden 2")._inShapes[0]) === "[256]");
    check("dropout survived grouping as a block property", g.blocks.find(b => b.title === "Hidden 1").dropout === 0.2);
    // built-ins
    for (const def of NA.templates.modules) {
        NA.model.newProject("m");
        NA.model.ensureModuleDef(def);
        const io = NA.model.moduleIO(def.id);
        const inp = NA.model.addBlock("input", { x: 0, y: 0 }, { params: { shape: NA.util.parseShape(io.ins[0].params.shape) } });
        const inst = NA.model.addBlock("module", { x: 400, y: 0 }, { title: def.name, params: { def: def.id } });
        NA.model.addEdge({ block: inp.id, port: "out" }, { block: inst.id, port: "in:" + io.ins[0].id });
        const out = NA.model.addBlock("output", { x: 800, y: 0 });
        NA.model.addEdge({ block: inst.id, port: "out:" + io.outs[0].id }, { block: out.id, port: "in" });
        const d = NA.graph.diagnostics().filter(x => x.level === "error");
        check(`built-in module "${def.name}" infers`, d.length === 0 && !!out._shape, d.map(x => x.message).join("; "));
    }
}

/* ==================================================== 6. codegen */
if (NA.codegen) {
    section("wire activations & fan-in");
    const pyFiles = [];
    {
        for (const t of NA.templates.list) { const p = NA.templates.build(t.id); check(`template "${t.id}" has no activation blocks`, !p.blocks.some(b => b.kind === "activation")); }
        NA.model.replace(NA.templates.build("robot_policy"));
        const g = NA.model.get();
        check("robot policy: ReLU and Tanh live on wires", g.edges.filter(e => e.act === "relu").length === 6 && g.edges.some(e => e.act === "tanh"), JSON.stringify(g.edges.map(e => e.act)));
        const r = NA.codegen.pytorch.generate();
        check("pytorch applies the wire activation to the consumer's input", /F\.relu\(h_trunk_1\)/.test(r.code) && /torch\.tanh\(h_action_head\)/.test(r.code), r.code.split("\n").filter(l => /relu|tanh/.test(l)).slice(0, 4).join(" | "));
        const kj = JSON.parse(NA.codegen.keras.generate().json);
        check("keras emits Activation layers for wires (one per source + activation, shared by consumers)", kj.config.layers.filter(l => l.class_name === "Activation").length === 6, String(kj.config.layers.filter(l => l.class_name === "Activation").length));
        // legacy file with an activation block folds onto the wire on load
        const legacy = { format: NA.config.FORMAT, version: 1, meta: { name: "Old" }, blocks: [
            { id: "i", kind: "input", title: "In", params: { shape: [4] }, pos: { x: 0, y: 0 } },
            { id: "a", kind: "activation", title: "GELU", params: { fn: "gelu" }, pos: { x: 350, y: 0 } },
            { id: "l", kind: "linear", title: "L", size: 3, pos: { x: 700, y: 0 } },
            { id: "o", kind: "output", title: "Out", pos: { x: 1050, y: 0 } }],
            edges: [{ id: "e1", from: { block: "i", port: "out" }, to: { block: "a", port: "in" } }, { id: "e2", from: { block: "a", port: "out" }, to: { block: "l", port: "in" } }, { id: "e3", from: { block: "l", port: "out" }, to: { block: "o", port: "in" } }] };
        NA.model.replace(legacy);
        const lg = NA.model.get();
        check("legacy activation block folds into a wire", lg.blocks.length === 3 && lg.edges.length === 2 && lg.edges.find(e => e.to.block === "l").act === "gelu", JSON.stringify(lg.edges));
        check("loaded model keeps its name", lg.meta.name === "Old");
        const rt = NA.model.migrate(JSON.parse(JSON.stringify(NA.model.serialize())));
        check("act survives save → load", rt.edges.find(e => e.to.block === "l").act === "gelu");
        // fan-in: A and B feed C; B alone also feeds D
        NA.model.newProject("Fan-in");
        const A = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "A", params: { shape: [10] } });
        const B = NA.model.addBlock("input", { x: 0, y: 400 }, { title: "B", params: { shape: [6] } });
        const C = NA.model.addBlock("linear", { x: 350, y: 0 }, { title: "C", size: 8 });
        const Dd = NA.model.addBlock("linear", { x: 350, y: 400 }, { title: "D", size: 4 });
        const oc = NA.model.addBlock("output", { x: 700, y: 0 }, { title: "C out" }), od = NA.model.addBlock("output", { x: 700, y: 400 }, { title: "D out" });
        const e1 = NA.model.addEdge({ block: A.id, port: "out" }, { block: C.id, port: "in" });
        const e2 = NA.model.addEdge({ block: B.id, port: "out" }, { block: C.id, port: "in" }, "relu");
        const e3 = NA.model.addEdge({ block: B.id, port: "out" }, { block: Dd.id, port: "in" });
        NA.model.addEdge({ block: C.id, port: "out" }, { block: oc.id, port: "in" }); NA.model.addEdge({ block: Dd.id, port: "out" }, { block: od.id, port: "in" });
        check("two inputs wire into one Linear", !e1.error && !e2.error && !e3.error && NA.model.get().edges.filter(e => e.to.block === C.id).length === 2, [e1.error, e2.error, e3.error].join(";"));
        check("fan-in Linear sees 10 + 6 = 16 features", JSON.stringify(C._inShapes) === "[[10],[6]]" && JSON.stringify(C._shape) === "[8]" && NA.graph.diagnostics().filter(d => d.level === "error").length === 0, JSON.stringify([C._inShapes, C._shape, C._error]));
        check("D only sees B", JSON.stringify(Dd._inShapes) === "[[6]]");
        const fr = NA.codegen.pytorch.generate();
        check("pytorch concatenates the fan-in in canvas order (A above B)", /nn\.Linear\(16, 8\)/.test(fr.code) && /b_relu = F\.relu\(b\)/.test(fr.code) && /self\.c\(torch\.cat\(\[a, b_relu\], dim=-1\)\)/.test(fr.code) && /self\.d\(b\)/.test(fr.code), fr.code.split("\n").filter(l => /self\.c|self\.d|b_relu/.test(l)).join(" | "));
        NA.model.moveBlocks([B.id], 0, -800, false);
        check("moving B above A flips the concat order", /torch\.cat\(\[b_relu, a\], dim=-1\)/.test(NA.codegen.pytorch.generate().code));
        const file = path.join(outDir, "fan_in.py"); fs.writeFileSync(file, fr.code); pyFiles.push(["fan_in", file]);
        const kf = JSON.parse(NA.codegen.keras.generate().json);
        check("keras fan-in uses a Concatenate layer", kf.config.layers.some(l => l.class_name === "Concatenate" && l.inbound_nodes[0].args[0].length === 2));
        // output fan-in: two heads → one output vector
        NA.model.newProject("Heads");
        const hi = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "Obs", params: { shape: [12] } });
        const h1 = NA.model.addBlock("linear", { x: 350, y: 0 }, { title: "Arm", size: 6 }), h2 = NA.model.addBlock("linear", { x: 350, y: 300 }, { title: "Base", size: 3 });
        const ho = NA.model.addBlock("output", { x: 700, y: 0 }, { title: "Action" });
        NA.model.addEdge({ block: hi.id, port: "out" }, { block: h1.id, port: "in" }); NA.model.addEdge({ block: hi.id, port: "out" }, { block: h2.id, port: "in" });
        NA.model.addEdge({ block: h1.id, port: "out" }, { block: ho.id, port: "in" }, "tanh"); NA.model.addEdge({ block: h2.id, port: "out" }, { block: ho.id, port: "in" });
        check("output takes two wires and is 6 + 3 wide", JSON.stringify(ho._shape) === "[9]" && NA.graph.diagnostics().filter(d => d.level === "error").length === 0, JSON.stringify([ho._shape, ho._error]));
        const hr = NA.codegen.pytorch.generate();
        check("pytorch concatenates the output heads", /action = torch\.cat\(\[h_arm_tanh, h_base\], dim=-1\)/.test(hr.code), hr.code.split("\n").filter(l => /action =/.test(l)).join(" | "));
        const hf = path.join(outDir, "heads.py"); fs.writeFileSync(hf, hr.code); pyFiles.push(["heads", hf]);
        // attention: one wire = self-attention, two = cross-attention (query + memory), three = memory joined on the token axis
        NA.model.newProject("Cross");
        const tq = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "Tokens", params: { shape: [8, 32] } });
        const tm = NA.model.addBlock("input", { x: 0, y: 300 }, { title: "Memory", params: { shape: [5, 32] } });
        const tm2 = NA.model.addBlock("input", { x: 0, y: 600 }, { title: "Memory 2", params: { shape: [3, 32] } });
        const at = NA.model.addBlock("attention", { x: 350, y: 0 }, { title: "Cross attn", size: 32, params: { heads: 4 } });
        const ao = NA.model.addBlock("output", { x: 700, y: 0 }, { title: "Attended" });
        NA.model.addEdge({ block: tq.id, port: "out" }, { block: at.id, port: "in" }); NA.model.addEdge({ block: at.id, port: "out" }, { block: ao.id, port: "in" });
        check("attention with one wire is self-attention", /self\.cross_attn\(tokens, tokens, tokens/.test(NA.codegen.pytorch.generate().code) && JSON.stringify(at._shape) === "[8,32]");
        NA.model.addEdge({ block: tm.id, port: "out" }, { block: at.id, port: "in" });
        check("a second wire makes it cross-attention (query keeps [8, 32])", /self\.cross_attn\(tokens, memory, memory/.test(NA.codegen.pytorch.generate().code) && JSON.stringify(at._shape) === "[8,32]", JSON.stringify([at._shape, at._error]));
        NA.model.addEdge({ block: tm2.id, port: "out" }, { block: at.id, port: "in" });
        const cr = NA.codegen.pytorch.generate();
        check("a third wire joins the memories on the token axis", /torch\.cat\(\[memory, memory_2\], dim=1\)/.test(cr.code), cr.code.split("\n").filter(l => /cross_attn\(/.test(l)).join(" | "));
        NA.model.updateBlock(at.id, { params: { query_from: tm.id } });
        check("'query from' picks which wire is the query", /self\.cross_attn\(memory, torch\.cat\(\[tokens, memory_2\], dim=1\)/.test(NA.codegen.pytorch.generate().code) && JSON.stringify(at._shape) === "[5,32]", JSON.stringify(at._shape));
        NA.model.updateBlock(at.id, { params: { query_from: "" } });
        const cf = path.join(outDir, "cross_attention.py"); fs.writeFileSync(cf, cr.code); pyFiles.push(["cross_attention", cf]);
        const ck = JSON.parse(NA.codegen.keras.generate().json);
        const mha = ck.config.layers.find(l => l.class_name === "MultiHeadAttention");
        check("keras cross-attention feeds query and a joined memory", !!mha && mha.inbound_nodes[0].kwargs.value.config.keras_history[0] !== mha.inbound_nodes[0].args[0].config.keras_history[0] && ck.config.layers.some(l => l.class_name === "Concatenate" && l.config.axis === 1), mha && JSON.stringify(mha.inbound_nodes[0]));
    }
    section("default activation, dropout property, research routings");
    {
        NA.model.newProject("Defaults");
        const i = NA.model.addBlock("input", { x: 0, y: 0 }, { params: { shape: [8] } });
        const l1 = NA.model.addBlock("linear", { x: 350, y: 0 }, { title: "L1", size: 8 }), l2 = NA.model.addBlock("linear", { x: 700, y: 0 }, { title: "L2", size: 8 });
        const bn = NA.model.addBlock("batchnorm", { x: 1050, y: 0 }), o = NA.model.addBlock("output", { x: 1400, y: 0 });
        const e1 = NA.model.addEdge({ block: i.id, port: "out" }, { block: l1.id, port: "in" }).edge;
        const e2 = NA.model.addEdge({ block: l1.id, port: "out" }, { block: l2.id, port: "in" }).edge;
        const e3 = NA.model.addEdge({ block: l2.id, port: "out" }, { block: bn.id, port: "in" }).edge;
        const e4 = NA.model.addEdge({ block: bn.id, port: "out" }, { block: o.id, port: "in" }).edge;
        check("Linear → Linear gets ReLU by default; Input → Linear, Linear → BatchNorm and → Output do not", e1.act === null && e2.act === "relu" && e3.act === null && e4.act === null, JSON.stringify([e1.act, e2.act, e3.act, e4.act]));
        NA.model.updateEdge(e2.id, { act: "gelu" });
        const l3 = NA.model.addBlock("linear", { x: 700, y: 300 }, { title: "L3", size: 4 });
        const e5 = NA.model.addEdge({ block: l1.id, port: "out" }, { block: l3.id, port: "in" }).edge;
        check("the last chosen activation is remembered for the next wire", NA.model.get().settings.defaultAct === "gelu" && e5.act === "gelu", e5.act);
        NA.model.updateBlock(l1.id, { dropout: 0.3 });
        const dc = NA.codegen.pytorch.generate().code;
        check("dropout is a block property applied once after the wire's activation", /h_l1_gelu = F\.dropout\(F\.gelu\(h_l1\), p=0\.3, training=self\.training\)/.test(dc) && (dc.match(/F\.dropout\(/g) || []).length === 1, dc.split("\n").filter(l => /dropout/.test(l)).join(" | "));
        check("docstring lists the training-only behaviour", /dropout on: L1 \(p=0\.3\)/.test(dc) && /batch statistics \(train\)/.test(dc));
        const legacy = { format: NA.config.FORMAT, version: 1, meta: { name: "OldDrop" }, blocks: [
            { id: "i", kind: "input", title: "In", params: { shape: [4] }, pos: { x: 0, y: 0 } }, { id: "l", kind: "linear", title: "L", size: 3, pos: { x: 350, y: 0 } },
            { id: "d", kind: "dropout", title: "Drop", params: { p: 0.4 }, pos: { x: 700, y: 0 } }, { id: "o", kind: "output", title: "Out", pos: { x: 1050, y: 0 } }],
            edges: [{ id: "e1", from: { block: "i", port: "out" }, to: { block: "l", port: "in" } }, { id: "e2", from: { block: "l", port: "out" }, to: { block: "d", port: "in" }, act: "relu" }, { id: "e3", from: { block: "d", port: "out" }, to: { block: "o", port: "in" } }] };
        NA.model.replace(legacy); const lg = NA.model.get();
        check("legacy Dropout block folds onto the block before it", lg.blocks.length === 3 && lg.blocks.find(b => b.id === "l").dropout === 0.4 && lg.edges.find(e => e.to.block === "o").act === "relu", JSON.stringify(lg.edges));
        for (const t of NA.templates.list) { const p = NA.templates.build(t.id); check(`template "${t.id}" has no dropout blocks`, !p.blocks.some(b => b.kind === "dropout")); }
        check("mlp template keeps its dropout as a property", NA.templates.build("mlp").blocks.find(b => b.title === "Hidden 1").dropout === 0.2);
        // research routings: transformer decoder with memory + causal mask, LSTM, conv channel fan-in, upsample, gated combine
        NA.model.newProject("Research"); NA.model.rememberAct("relu");   // the remembered default carries across projects; pin it for the assertions below
        const tok = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "Tokens", params: { shape: [8, 32] } });
        const mem = NA.model.addBlock("input", { x: 0, y: 300 }, { title: "Memory", params: { shape: [5, 32] } });
        const enc = NA.model.addBlock("transformer", { x: 350, y: 300 }, { title: "Encoder", size: 32, params: { heads: 4, ff: 64, layers: 1 } });
        const dec = NA.model.addBlock("transformer", { x: 700, y: 0 }, { title: "Decoder", size: 32, params: { heads: 4, ff: 64, layers: 1, causal: true } });
        const rnn = NA.model.addBlock("rnn", { x: 1050, y: 0 }, { title: "Summary", size: 16, params: { cell: "lstm", output: "last", bidirectional: true } });
        const gate = NA.model.addBlock("linear", { x: 1400, y: 0 }, { title: "Gate", size: 32 });
        const val = NA.model.addBlock("linear", { x: 1400, y: 300 }, { title: "Value", size: 32 });
        const comb = NA.model.addBlock("add", { x: 1750, y: 0 }, { title: "Gated", params: { mode: "mul" } });
        const out = NA.model.addBlock("output", { x: 2100, y: 0 }, { title: "Out" });
        const E = (a, b, act) => NA.model.addEdge({ block: a.id, port: "out" }, { block: b.id, port: "in" }, act);
        E(mem, enc); E(tok, dec); E(enc, dec); E(dec, rnn); E(rnn, gate); E(rnn, val);
        NA.model.addEdge({ block: gate.id, port: "out" }, { block: comb.id, port: "in:0" }, "sigmoid"); NA.model.addEdge({ block: val.id, port: "out" }, { block: comb.id, port: "in:1" }, null); E(comb, out);
        const errs = NA.graph.diagnostics().filter(d => d.level === "error");
        check("decoder + LSTM + gated combine graph infers", errs.length === 0 && JSON.stringify(dec._shape) === "[8,32]" && JSON.stringify(rnn._shape) === "[32]" && JSON.stringify(out._shape) === "[32]", errs.map(d => d.message).join("; ") + JSON.stringify([dec._shape, rnn._shape, out._shape]));
        const rc = NA.codegen.pytorch.generate();
        check("one wire → TransformerEncoder, two → TransformerDecoder with memory and a causal target mask", /self\.encoder = nn\.TransformerEncoder\(/.test(rc.code) && /self\.decoder = nn\.TransformerDecoder\(/.test(rc.code) && /self\.decoder\(tokens, h_encoder, tgt_mask=nn\.Transformer\.generate_square_subsequent_mask\(tokens\.size\(1\), device=tokens\.device\), tgt_is_causal=True\)/.test(rc.code), rc.code.split("\n").filter(l => /decoder|encoder/.test(l)).join(" | "));
        check("LSTM last step, bidirectional", /nn\.LSTM\(32, 16, num_layers=1, batch_first=True, bidirectional=True\)/.test(rc.code) && /self\.summary\(h_decoder\)\[0\]\[:, -1\]/.test(rc.code));
        check("gated combine multiplies (sigmoid gate x raw value; the LSTM -> Linear wires got the default ReLU)", rc.code.includes("h_gated = h_gate_sigmoid * h_value") && rc.code.includes("h_summary_relu = F.relu(h_summary)"), rc.code.split("\n").filter(l => /summary|h_gated/.test(l)).join(" | "));
        const rf = path.join(outDir, "research.py"); fs.writeFileSync(rf, rc.code); pyFiles.push(["research", rf]);
        // U-Net-ish: two conv branches join on the channel axis, then upsample
        NA.model.newProject("Unet");
        const img = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "Image", params: { shape: [3, 8, 8] } });
        const c1 = NA.model.addBlock("conv2d", { x: 350, y: 0 }, { title: "Branch A", size: 4 }), c2 = NA.model.addBlock("conv2d", { x: 350, y: 300 }, { title: "Branch B", size: 6 });
        const c3 = NA.model.addBlock("conv2d", { x: 700, y: 0 }, { title: "Fuse conv", size: 8 });
        const up = NA.model.addBlock("upsample", { x: 1050, y: 0 }, { title: "Up", params: { scale: 2, mode: "linear" } });
        const uo = NA.model.addBlock("output", { x: 1400, y: 0 }, { title: "Map" });
        E(img, c1); E(img, c2); E(c1, c3); E(c2, c3); E(c3, up); E(up, uo);
        const uerr = NA.graph.diagnostics().filter(d => d.level === "error");
        check("conv fan-in joins channels (4 + 6 → 10) and upsample doubles the map", uerr.length === 0 && JSON.stringify(c3._inShapes) === "[[4,8,8],[6,8,8]]" && JSON.stringify(uo._shape) === "[8,16,16]", uerr.map(d => d.message).join("; ") + JSON.stringify([c3._inShapes, uo._shape]));
        const uc = NA.codegen.pytorch.generate();
        check("conv branches got the default ReLU and are concatenated on dim 1", /nn\.Conv2d\(10, 8/.test(uc.code) && /self\.fuse_conv\(torch\.cat\(\[h_branch_a_relu, h_branch_b_relu\], dim=1\)\)/.test(uc.code) && /nn\.Upsample\(scale_factor=2, mode='bilinear', align_corners=False\)/.test(uc.code), uc.code.split("\n").filter(l => /fuse_conv|Upsample/.test(l)).join(" | "));
        const uf = path.join(outDir, "unet.py"); fs.writeFileSync(uf, uc.code); pyFiles.push(["unet", uf]);
        const uk = JSON.parse(NA.codegen.keras.generate().json);
        check("keras: channel fan-in is a Concatenate, upsample is UpSampling2D", uk.config.layers.some(l => l.class_name === "Concatenate") && uk.config.layers.some(l => l.class_name === "UpSampling2D"));
        // causal self-attention
        NA.model.newProject("Causal");
        const ct = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "Tokens", params: { shape: [8, 32] } });
        const ca = NA.model.addBlock("attention", { x: 350, y: 0 }, { title: "Causal attn", size: 32, params: { heads: 4, causal: true } });
        const co = NA.model.addBlock("output", { x: 700, y: 0 }, { title: "Out" });
        E(ct, ca); E(ca, co);
        const cc = NA.codegen.pytorch.generate();
        check("causal self-attention masks the future", /attn_mask=torch\.triu\(torch\.ones\(tokens\.size\(1\), tokens\.size\(1\), dtype=torch\.bool, device=tokens\.device\), 1\)/.test(cc.code), cc.code.split("\n").filter(l => /causal_attn\(/.test(l)).join(" | "));
        const cf = path.join(outDir, "causal.py"); fs.writeFileSync(cf, cc.code); pyFiles.push(["causal", cf]);
        NA.model.setMode("infer");
        check("inference mode is session state (autosave), not part of the file", NA.model.serialize({ session: true }).settings.mode === "infer" && !NA.model.serialize().settings && !NA.model.serialize().view && !("savedAt" in NA.model.serialize()));
        {
            const before = JSON.parse(JSON.stringify(NA.model.serialize()));
            const nb = NA.model.addBlock("linear", { x: 0, y: 900 }, { title: "Extra", size: 3 });
            const d = NA.model.diff(before, NA.model.serialize());
            check("diff reports the added block by title", d.added.length === 1 && d.added[0] === "Extra" && !d.same && NA.model.diffSummary(d) === "+1 block", NA.model.diffSummary(d));
            check("diff ignores a pure move", NA.model.diff(before, before).same && (() => { const moved = JSON.parse(JSON.stringify(before)); moved.blocks[0].pos.x += 500; return NA.model.diff(before, moved).same; })());
            NA.model.removeBlocks([nb.id]);
            check("ids are sequential and human-readable", /^b_\d+$/.test(nb.id));
            const lines = NA.util.jsonLines(NA.model.serialize());
            check("jsonLines is valid JSON with one block per line", JSON.stringify(JSON.parse(lines)) === JSON.stringify(NA.model.serialize()) && lines.split("\n").filter(l => /^    \{"id": ?"b_/.test(l)).length === NA.model.get().blocks.length, lines.split("\n").slice(0, 8).join(" | "));
        }
        NA.model.setMode("train");
    }
    section("fan-in everywhere it is meaningful, and merging inputs");
    {
        NA.model.rememberAct("relu");
        const E = (a, b, act) => NA.model.addEdge({ block: a.id, port: "out" }, { block: b.id, port: "in" }, act);
        NA.model.newProject("Joins");
        const va = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "Va", params: { shape: [6] } }), vb = NA.model.addBlock("input", { x: 0, y: 300 }, { title: "Vb", params: { shape: [4] } });
        const bn = NA.model.addBlock("batchnorm", { x: 350, y: 0 }, { title: "Norm" }), ln = NA.model.addBlock("layernorm", { x: 350, y: 300 }, { title: "LN" });
        const o1 = NA.model.addBlock("output", { x: 700, y: 0 }, { title: "Normed" }), o2 = NA.model.addBlock("output", { x: 700, y: 300 }, { title: "Layered" });
        E(va, bn); E(vb, bn); E(va, ln); E(vb, ln); E(bn, o1); E(ln, o2);
        const ia = NA.model.addBlock("input", { x: 0, y: 600 }, { title: "Ia", params: { shape: [3, 4, 4] } }), ib = NA.model.addBlock("input", { x: 0, y: 900 }, { title: "Ib", params: { shape: [2, 4, 4] } });
        const pool = NA.model.addBlock("pool", { x: 350, y: 600 }, { title: "Pooled", params: { mode: "max", kernel: 2, stride: 0 } }), fl = NA.model.addBlock("flatten", { x: 350, y: 900 }, { title: "Flat" });
        const o3 = NA.model.addBlock("output", { x: 700, y: 600 }, { title: "Pooled out" }), o4 = NA.model.addBlock("output", { x: 700, y: 900 }, { title: "Flat out" });
        E(ia, pool); E(ib, pool); E(pool, o3); E(ia, fl); E(vb, fl); E(fl, o4);
        const ta = NA.model.addBlock("input", { x: 0, y: 1200 }, { title: "Seq a", params: { shape: [4, 8] } }), tb = NA.model.addBlock("input", { x: 0, y: 1500 }, { title: "Seq b", params: { shape: [3, 8] } });
        const rnn = NA.model.addBlock("rnn", { x: 350, y: 1200 }, { title: "Reader", size: 5, params: { cell: "gru" } }), o5 = NA.model.addBlock("output", { x: 700, y: 1200 }, { title: "Read" });
        E(ta, rnn); E(tb, rnn); E(rnn, o5, null);
        const ka = NA.model.addBlock("input", { x: 0, y: 1800 }, { title: "Ids a", params: { shape: [4], dtype: "int64" } }), kb = NA.model.addBlock("input", { x: 0, y: 2100 }, { title: "Ids b", params: { shape: [3], dtype: "int64" } });
        const emb = NA.model.addBlock("embedding", { x: 350, y: 1800 }, { title: "Emb", size: 6, params: { vocab: 50 } }), o6 = NA.model.addBlock("output", { x: 700, y: 1800 }, { title: "Embedded" });
        E(ka, emb); E(kb, emb); E(emb, o6);
        const errs = NA.graph.diagnostics().filter(d => d.level === "error");
        check("norms, pooling, flatten, recurrent and embedding all take several wires", errs.length === 0, errs.map(d => d.message).join("; "));
        check("BatchNorm / LayerNorm join 6 + 4 features", JSON.stringify(bn._shape) === "[10]" && JSON.stringify(ln._shape) === "[10]", JSON.stringify([bn._shape, ln._shape]));
        check("pooling joins channels (3 + 2), flatten joins anything (48 + 4)", JSON.stringify(o3._shape) === "[5,2,2]" && JSON.stringify(o4._shape) === "[52]", JSON.stringify([o3._shape, o4._shape]));
        check("recurrent and embedding join along the token axis", JSON.stringify(o5._shape) === "[7,5]" && JSON.stringify(o6._shape) === "[7,6]", JSON.stringify([o5._shape, o6._shape]));
        const jc = NA.codegen.pytorch.generate();
        check("pytorch joins per kind: dim=1 for norm/pool/tokens, flatten-then-cat", /nn\.BatchNorm1d\(10\)/.test(jc.code) && /nn\.LayerNorm\(10\)/.test(jc.code) && /self\.norm\(torch\.cat\(\[va, vb\], dim=1\)\)/.test(jc.code) && /self\.ln\(torch\.cat\(\[va, vb\], dim=-1\)\)/.test(jc.code) && /self\.pooled\(torch\.cat\(\[ia, ib\], dim=1\)\)/.test(jc.code) && /torch\.cat\(\[torch\.flatten\(vb, 1\), torch\.flatten\(ia, 1\)\], dim=1\)/.test(jc.code) && /self\.reader\(torch\.cat\(\[seq_a, seq_b\], dim=1\)\)/.test(jc.code) && /self\.emb\(torch\.cat\(\[ids_a, ids_b\], dim=1\)\)/.test(jc.code), jc.code.split("\n").filter(l => /torch\.cat/.test(l)).join(" | "));
        const jf = path.join(outDir, "joins.py"); fs.writeFileSync(jf, jc.code); pyFiles.push(["joins", jf]);
        const jk = JSON.parse(NA.codegen.keras.generate().json);
        const cats = jk.config.layers.filter(l => l.class_name === "Concatenate");
        check("keras joins on the last axis for features/channels and axis 1 for sequences", cats.length === 6 && cats.filter(l => l.config.axis === 1).length === 2 && jk.config.layers.filter(l => l.class_name === "Flatten").length >= 2, JSON.stringify(cats.map(l => [l.name, l.config.axis])));
        // merging two inputs
        NA.model.newProject("Merge");
        const A = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "Physical", params: { shape: [10] }, neurons: { 0: { label: "gps x" } } });
        const B = NA.model.addBlock("input", { x: 0, y: 400 }, { title: "Sensors", params: { shape: [6] }, neurons: { 2: { label: "imu" } }, comment: "raw sensor pack" });
        const C = NA.model.addBlock("linear", { x: 350, y: 0 }, { title: "C", size: 8 }), Dd = NA.model.addBlock("linear", { x: 350, y: 400 }, { title: "D", size: 4 });
        E(A, C); E(B, C); E(B, Dd);
        NA.model.addNeuronEdge({ block: B.id, idx: 1 }, { block: Dd.id, idx: 0 }, 0.5);
        const mr = NA.model.mergeInputs(A.id, B.id);
        const g = NA.model.get();
        check("merge produces one 16-neuron input with two regions", !mr.error && g.blocks.filter(b => b.kind === "input").length === 1 && JSON.stringify(A.params.shape) === "[16]" && A.regions.length === 2 && A.regions[0].name === "Physical" && A.regions[1].name === "Sensors" && A.regions[1].start === 10 && A.regions[1].end === 16, mr.error || JSON.stringify(A.regions));
        check("labels, comment and neuron edges shift with the merged neurons", A.neurons[12] && A.neurons[12].label === "imu" && A.neurons[0].label === "gps x" && /Sensors: raw sensor pack/.test(A.comment) && g.neuronEdges[0].from.block === A.id && g.neuronEdges[0].from.idx === 11);
        const eC = g.edges.filter(e => e.to.block === C.id), eD = g.edges.filter(e => e.to.block === Dd.id);
        check("wires move to the region ports so every consumer still sees the same numbers", eC.length === 2 && eC.every(e => e.from.block === A.id && e.from.port.startsWith("out:")) && eD.length === 1 && eD[0].from.port === "out:" + A.regions[1].id && JSON.stringify(C._inShapes) === "[[10],[6]]" && JSON.stringify(Dd._inShapes) === "[[6]]" && NA.graph.diagnostics().filter(d => d.level === "error").length === 0, JSON.stringify([C._inShapes, Dd._inShapes]));
        const mc = NA.codegen.pytorch.generate();
        check("merged model exports with region slices", /physical_physical = physical\[:, 0:10\]/.test(mc.code) && /physical_sensors = physical\[:, 10:16\]/.test(mc.code), mc.code.split("\n").filter(l => /physical\[/.test(l)).join(" | "));
        const mf = path.join(outDir, "merged.py"); fs.writeFileSync(mf, mc.code); pyFiles.push(["merged", mf]);
        const bad = NA.model.mergeInputs(A.id, C.id);
        check("only two vector Inputs can merge", !!bad.error);
        // shrinking below the regions: the model reports what a resize would cut, and applies the user's per-region choice in one step
        NA.model.newProject("Shrink");
        const S = NA.model.addBlock("input", { x: 0, y: 0 }, { title: "Obs", params: { shape: [12] }, regions: [{ name: "Head", start: 0, end: 4 }, { name: "Body", start: 4, end: 9 }, { name: "Tail", start: 9, end: 12 }] });
        const T2 = NA.model.addBlock("linear", { x: 350, y: 0 }, { title: "T", size: 3 });
        NA.model.addEdge({ block: S.id, port: "out:" + S.regions[2].id }, { block: T2.id, port: "in" });
        const cut = NA.model.regionsCut(S, 6);
        check("regionsCut names the trimmed and the lost regions", cut.length === 2 && cut[0].region.name === "Body" && !cut[0].lost && cut[1].region.name === "Tail" && cut[1].lost && NA.model.regionsCut(S, 12).length === 0, JSON.stringify(cut.map(c => [c.region.name, c.lost])));
        NA.model.shrinkTo(S.id, 6, [S.regions[2].id]);
        check("shrinkTo trims the kept region, deletes the chosen one and its wire", JSON.stringify(S.params.shape) === "[6]" && S.regions.length === 2 && S.regions[1].name === "Body" && S.regions[1].end === 6 && NA.model.get().edges.length === 0, JSON.stringify([S.params.shape, S.regions.map(r => [r.name, r.start, r.end]), NA.model.get().edges.length]));
        const L2 = NA.model.addBlock("linear", { x: 0, y: 400 }, { title: "L", size: 10, regions: [{ name: "A", start: 0, end: 5 }, { name: "B", start: 5, end: 10 }] });
        NA.model.updateBlock(L2.id, { size: 4 });
        check("a plain resize never leaves a region stranded past the end", L2.regions.length === 1 && L2.regions[0].name === "A" && L2.regions[0].end === 4, JSON.stringify(L2.regions.map(r => [r.name, r.start, r.end])));
    }
    section("pytorch codegen");
    for (const t of NA.templates.list) {
        NA.model.replace(NA.templates.build(t.id));
        const g = NA.model.get();
        if (!g.blocks.length) continue;
        const r = NA.codegen.pytorch.generate();
        const src = r.code;
        check(`"${t.id}" generates a class`, /class \w+\(nn\.Module\)/.test(src) && !/undefined|NaN|\[object/.test(src), r.errors.join("; "));
        const back = NA.codegen.pytorch.extractProject(src);
        const orig = NA.model.serialize(); delete orig.savedAt; if (back) delete back.savedAt;
        check(`"${t.id}" .py embeds a lossless project`, back && JSON.stringify(NA.model.migrate(back)).replace(/"savedAt":[^,]+,/, "") === JSON.stringify(NA.model.migrate(orig)).replace(/"savedAt":[^,]+,/, ""));
        const file = path.join(outDir, t.id + ".py");
        fs.writeFileSync(file, src);
        pyFiles.push([t.id, file]);
    }
    // A module-bearing graph
    {
        NA.model.replace(NA.templates.build("mlp"));
        const g = NA.model.get();
        const ids = ["Hidden 1", "Hidden 2"].map(t => g.blocks.find(b => b.title === t).id);
        NA.model.groupIntoModule(ids, "Stage one");
        const r = NA.codegen.pytorch.generate();
        check("module instance emits a nested class", /class StageOne\(nn\.Module\)/.test(r.code) && /self\.stage_one = StageOne\(\)/.test(r.code), r.errors.join("; "));
        const file = path.join(outDir, "mlp_module.py"); fs.writeFileSync(file, r.code); pyFiles.push(["mlp_module", file]);
    }
    // Every built-in module, instantiated
    for (const def of NA.templates.modules) {
        NA.model.newProject("m");
        NA.model.ensureModuleDef(def);
        const io = NA.model.moduleIO(def.id);
        const inp = NA.model.addBlock("input", { x: 0, y: 0 }, { params: { shape: NA.util.parseShape(io.ins[0].params.shape) } });
        const inst = NA.model.addBlock("module", { x: 400, y: 0 }, { title: def.name, params: { def: def.id } });
        NA.model.addEdge({ block: inp.id, port: "out" }, { block: inst.id, port: "in:" + io.ins[0].id });
        const out = NA.model.addBlock("output", { x: 800, y: 0 });
        NA.model.addEdge({ block: inst.id, port: "out:" + io.outs[0].id }, { block: out.id, port: "in" });
        const r = NA.codegen.pytorch.generate();
        check(`built-in "${def.name}" generates`, r.errors.length === 0, r.errors.join("; "));
        const file = path.join(outDir, def.id + ".py"); fs.writeFileSync(file, r.code); pyFiles.push([def.id, file]);
    }
    const py = spawnSync("python", ["-c", "import torch; print(torch.__version__)"], { encoding: "utf8" });
    if (py.status === 0) {
        section(`running generated files with torch ${py.stdout.trim()}`);
        for (const [id, file] of pyFiles) {
            const r = spawnSync("python", [file], { encoding: "utf8", timeout: 120000 });
            check(`python ${id}.py runs the smoke forward pass`, r.status === 0 && /parameters:/.test(r.stdout), (r.stderr || "").trim().split("\n").slice(-3).join(" | "));
        }
    } else console.log("(python + torch not available; skipping execution)");

    section("keras codegen");
    for (const t of ["mlp", "cnn", "robot_policy", "autoencoder"]) {
        NA.model.replace(NA.templates.build(t));
        const r = NA.codegen.keras.generate();
        let parsed = null; try { parsed = JSON.parse(r.json); } catch (_) {}
        const names = new Set((parsed?.config?.layers || []).map(l => l.name));
        let dangling = 0;
        for (const l of (parsed?.config?.layers || [])) for (const n of l.inbound_nodes) for (const a of n.args) { const h = a.config?.keras_history?.[0]; if (h && !names.has(h)) dangling++; }
        check(`"${t}" Keras JSON parses with resolvable inbound nodes`, parsed && dangling === 0 && parsed.config.output_layers.length > 0, r.warnings.join("; "));
    }

    section("onnx import");
    {
        // Build a tiny Gemm→Relu→Gemm model with a hand-rolled protobuf encoder
        const enc = NA.io.onnx._test.encode;
        const model = enc.model({
            graph: {
                name: "mlp",
                input: [{ name: "x", shape: [1, 20] }], output: [{ name: "y", shape: [1, 5] }],
                initializer: [{ name: "W1", dims: [32, 20] }, { name: "b1", dims: [32] }, { name: "W2", dims: [5, 32] }, { name: "b2", dims: [5] }],
                node: [
                    { op_type: "Gemm", input: ["x", "W1", "b1"], output: ["h"], attrs: [{ name: "transB", i: 1 }] },
                    { op_type: "Relu", input: ["h"], output: ["a"] },
                    { op_type: "Gemm", input: ["a", "W2", "b2"], output: ["y"], attrs: [{ name: "transB", i: 1 }] },
                ],
            },
        });
        const r = NA.io.onnx.parse(model.buffer);
        check("onnx: decoded 3 nodes", r.graph.node.length === 3, JSON.stringify(r.graph.node.map(n => n.op_type)));
        const proj = NA.io.onnx.toProject(r, "mlp.onnx");
        NA.model.replace(proj);
        const g = NA.model.get();
        const kinds = NA.graph.topoSort(g).order.map(b => b.kind);
        check("onnx: blocks are input → linear → linear → output (Relu folded onto the wire)", kinds.join(",") === "input,linear,linear,output", kinds.join(","));
        check("onnx: the wire between the linears carries relu", g.edges.some(e => e.act === "relu"), JSON.stringify(g.edges.map(e => e.act)));
        check("onnx: linear sizes from weight dims", g.blocks.filter(b => b.kind === "linear").map(b => b.size).join(",") === "32,5");
        check("onnx: graph infers", NA.graph.diagnostics().filter(d => d.level === "error").length === 0);
        const exp = spawnSync("python", ["-c", "import torch, torch.nn as nn, sys; m = nn.Sequential(nn.Linear(20, 32), nn.ReLU(), nn.Linear(32, 5)); torch.onnx.export(m, torch.randn(1, 20), sys.argv[1], dynamo=False); print('ok')", path.join(outDir, "real.onnx")], { encoding: "utf8", timeout: 120000 });
        if (exp.status === 0) {
            const buf = fs.readFileSync(path.join(outDir, "real.onnx"));
            const real = NA.io.onnx.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
            const p2 = NA.io.onnx.toProject(real, "real.onnx");
            NA.model.replace(p2);
            const ks = NA.graph.topoSort(NA.model.get()).order.map(b => b.kind);
            check("onnx: a real torch.onnx.export file imports", ks.includes("linear") && !ks.includes("activation") && NA.model.get().edges.some(e => e.act === "relu") && NA.graph.diagnostics().filter(d => d.level === "error").length === 0, ks.join(","));
        } else console.log("(torch.onnx.export unavailable: " + (exp.stderr || "").trim().split("\n").pop() + ")");
    }
}

console.log(`\n${checks - failures}/${checks} checks passed${failures ? "  ✗ " + failures + " FAILED" : ""}`);
process.exit(failures ? 1 : 0);
