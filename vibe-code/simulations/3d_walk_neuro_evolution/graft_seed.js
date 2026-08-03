/* graft_seed.js — carry a trained brain across an input-layer change.
 *
 *   node graft_seed.js <old-champion.json> <new-seed.json>
 *
 * Adding a sensor changes NIN, and a saved genome is just a flat block of
 * weights, so every trained brain becomes unloadable the moment the input layer
 * grows. Starting from random weights each time throws away every generation
 * ever run — which is what happened at 216 -> 249, and would happen again at
 * 249 -> 489.
 *
 * It does not have to. The hidden layers are untouched by an input change, and
 * the old inputs all still exist; they have merely MOVED. So the graft is:
 *
 *   - layer 0: copy each old weight to wherever its input went, and zero the
 *     weights for inputs that did not exist before
 *   - layers 1+: copy verbatim
 *
 * With the new inputs at zero weight the grafted brain computes bit-for-bit the
 * same function as the original, so generation 1 of the new run starts exactly
 * where the old run stopped rather than below it. Evolution then grows the new
 * pathway from zero, which is also the only honest way to find out whether the
 * new sensor helps: if it does not, mutation simply never finds anything there
 * and nothing is lost.
 *
 * THE PART THAT IS EASY TO GET WRONG. Inputs are not laid out channel by
 * channel. LAG_PLAN puts lag 0 of every channel first and then each remaining
 * lag in ascending order, so appending 80 channels at the end does not append
 * 240 inputs at the end — it interleaves them, and almost every old input
 * moves. Mapping by index would therefore produce a brain that loads, runs,
 * scores plausibly, and is wired to the wrong sensors. The mapping has to be by
 * (channel, lag) identity, and the check at the bottom is what proves it: the
 * grafted net must reproduce the old net's outputs exactly.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "physics.js", "body.js", "terrain.js", "walker.js", "rise_scaffold.js", "world.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

/* ------------------------------------------------------------- channel ids
 *
 * The old graft inferred the previous layout by finding the channel COUNT whose
 * read plan was the right width, and then assumed channel index c meant the
 * same thing in both layouts. That holds only while the layout is APPENDED to.
 * It is not what happened here: the LiDAR was removed from near the end and the
 * terrain block grew from 4 channels to 20 in the middle, so `wind`, `eff` and
 * `comvel` all shifted. Index mapping would have produced a brain that loads,
 * runs, scores plausibly and is wired to the wrong sensors — the exact failure
 * this file's header warns about, one level up.
 *
 * So every channel now gets a stable string id and the mapping is by id. A
 * layout is described once, here, in the same order walker.js's `put()`
 * sequence builds it, and the descriptor for the CURRENT build is checked
 * against the real LAGS table before anything is copied. */
function layoutOf(opt) {
    const ch = [];
    const put = (n, lags, id) => {
        for (let i = 0; i < n; i++)
            ch.push({ id: typeof id === "function" ? id(i) : (n === 1 ? id : id + "." + i), lags });
    };
    put(3, L_FAST, "grav");
    put(3, L_FAST, "gyro");
    put(3, L_MID, "vel");
    put(1, L_LONG, "height");
    put(1, L_LONG, "upright");
    put(NJ, [0, 2], "qa");
    put(NJ, [0, 4], "qd");
    put(2, L_FAST, "load");
    put(2, L_EVENT, "contact");
    put(6, L_MID, "footpos");
    put(1, L0, "wpdist");
    put(2, L0, "wpbear");
    put(2, L0, "gait");
    /* The four legacy probes are given the ids of the fan's CENTRE COLUMN,
     * because that column is bit-identical to them — same pelvis datum, same
     * 0.3 m scale. That one line is what carries their learned weights across
     * instead of restarting them at zero. */
    if (opt.fan) put(PROBE_D.length * FAN_LAT.length, L0,
        i => `fan.d${Math.floor(i / FAN_LAT.length)}.lat${i % FAN_LAT.length}`);
    else put(PROBE_D.length, L0, i => `fan.d${i}.lat${FAN_LAT0}`);
    put(2, L0, "wind");
    put(NJ, [0, 4], "eff");
    put(3, L_MOMENTUM, "comvel");
    if (opt.lidar) {
        put(64, L0, i => `lidar.${i}`);
        put(16, L_MOMENTUM, i => `lidsec.${i}`);
    }
    if (opt.patch) {
        put(2, L_MID, i => `footclr.${i ? "R" : "L"}`);
        put(4, L_MID, i => `footatt.${(i >> 1) ? "R" : "L"}.${(i & 1) ? "roll" : "pitch"}`);
        put(2 * PATCH_CELLS, L0, i => {
            const s = i < PATCH_CELLS ? "L" : "R", c = i % PATCH_CELLS;
            return `patch.${s}.r${Math.floor(c / PATCH_N)}c${c % PATCH_N}`;
        });
    }
    return ch;
}

/* The flattened read plan for a layout: lag 0 of every channel first — which is
 * what makes inputs[c] channel c — then each remaining lag ascending. Mirrors
 * LAG_PLAN in walker.js. */
function planOf(ch) {
    const plan = [];
    for (let c = 0; c < ch.length; c++) plan.push({ lag: 0, id: ch[c].id });
    const all = [...new Set(ch.flatMap(e => e.lags))].sort((a, b) => a - b);
    for (const lag of all) {
        if (lag === 0) continue;
        for (let c = 0; c < ch.length; c++) if (ch[c].lags.indexOf(lag) >= 0) plan.push({ lag, id: ch[c].id });
    }
    return plan;
}

/* The descriptor for THIS build, proved against the table walker.js actually
 * assembled. If someone adds a channel to walker.js and forgets to add it here,
 * this throws rather than grafting onto a layout that does not exist. */
const CURRENT = layoutOf({ fan: FAN_ON, lidar: false, patch: PATCH_CHANNELS });
{
    const p = planOf(CURRENT);
    if (CURRENT.length !== NC || p.length !== NIN)
        throw new Error(`layout descriptor disagrees with walker.js: ${CURRENT.length} channels / ${p.length} inputs vs NC ${NC} / NIN ${NIN}`);
    for (let c = 0; c < NC; c++)
        if (CURRENT[c].lags.join() !== LAGS[c].join())
            throw new Error(`channel ${c} (${CURRENT[c].id}) lag set ${CURRENT[c].lags} != LAGS ${LAGS[c]}`);
}

/* Which historical layout has an input width of `n`. Tried explicitly rather
 * than inferred from a count, so an ambiguous match is impossible. */
const KNOWN = [
    { name: "LiDAR era", opt: { fan: false, lidar: true, patch: false } },
    { name: "pre-LiDAR", opt: { fan: false, lidar: false, patch: false } },
    { name: "patches, legacy probes", opt: { fan: false, lidar: false, patch: true } },
    { name: "patches + fan", opt: { fan: true, lidar: false, patch: true } }
];
function layoutForWidth(n) {
    const hits = KNOWN.map(k => ({ ...k, ch: layoutOf(k.opt) }))
        .filter(k => planOf(k.ch).length === n);
    if (hits.length !== 1)
        throw new Error(`${hits.length} known layouts have an input width of ${n}` +
            (hits.length ? ": " + hits.map(h => h.name).join(", ") : ""));
    return hits[0];
}

function graft(oldJson) {
    const oldNet = oldJson.net || oldJson;
    const os_ = oldNet.sizes;
    if (os_.length !== NET_SIZES.length) throw new Error(`layer count differs: ${os_} vs ${NET_SIZES}`);
    for (let l = 1; l < os_.length; l++) {
        if (os_[l] !== NET_SIZES[l]) throw new Error(`hidden/output layer ${l} differs: ${os_[l]} vs ${NET_SIZES[l]} — this graft only handles input-layer growth`);
    }
    const oldNIN = os_[0];

    const src = layoutForWidth(oldNIN);
    const oldPlan = planOf(src.ch);
    const ncOld = src.ch.length;

    // Where each (id, lag) lives in the CURRENT input vector.
    const where = new Map();
    const newPlan = planOf(CURRENT);
    for (let i = 0; i < newPlan.length; i++) where.set(newPlan[i].lag + "@" + newPlan[i].id, i);

    /* The activation travels with the brain. This used to be `new Net(NET_SIZES,
     * null)`, which defaults to tanh — so grafting a ReLU champion silently
     * produced a tanh network wearing its weights, and the identity check below
     * caught it with a 0.74 output difference. The per-unit slopes are copied
     * too: an input-layer change leaves the hidden layers untouched, so every
     * neuron keeps the rectifier it was evolved with. */
    const net = new Net(NET_SIZES, null, oldNet.act === "mixed" ? "relu" : oldNet.act);
    if (net.slopes && oldNet.slopes) {
        for (let l = 0; l < net.slopes.length; l++) net.slopes[l].set(oldNet.slopes[l]);
        net._relabel();
    }
    const w0old = oldNet.weights[0], w0 = net.weights[0];
    const oldRow = oldNIN + 1, newRow = NIN + 1, nHid = NET_SIZES[1];
    let moved = 0, dropped = 0;
    const droppedIds = new Set();
    for (let o = 0; o < nHid; o++) {
        for (let i = 0; i < oldNIN; i++) {
            const e = oldPlan[i];
            const j = where.get(e.lag + "@" + e.id);
            /* A retired sensor is DROPPED, not an error. Removing the LiDAR is
             * the whole point of this graft, and its 240 inputs have nowhere to
             * go. Everything else must land somewhere, and a channel that
             * quietly failed to map would be a silent hole in the brain — so
             * the two cases are counted separately and both are reported. */
            if (j === undefined) {
                if (o === 0) { dropped++; droppedIds.add(e.id.split(".")[0]); }
                continue;
            }
            w0[o * newRow + j] = w0old[o * oldRow + i];
            if (o === 0) moved++;
        }
        w0[o * newRow + NIN] = w0old[o * oldRow + oldNIN];   // bias
    }
    for (let l = 1; l < net.weights.length; l++) net.weights[l].set(oldNet.weights[l]);

    return { net, ncOld, oldNIN, moved, dropped, droppedIds: [...droppedIds], srcName: src.name, oldPlan };
}

/* Proof, not hope: feed both nets the same sensor readings and require identical
 * outputs. The new channels are fed deliberate garbage — if any of their weights
 * were non-zero, or if a single old weight landed on the wrong input, the
 * outputs diverge and this throws. */
function verify(oldJson, net, oldPlan) {
    /* Removing a sensor genuinely changes what a brain that used it computes,
     * so a naive before/after comparison cannot be an identity check — it would
     * fail for a correct graft and pass for none. The two effects have to be
     * separated, exactly as section 4 of the brief sets out:
     *
     *   1. take the champion and ZERO the weights of the inputs being dropped,
     *      in place. That is the information-loss step, and it is the only
     *      behaviour change the graft is allowed to cause.
     *   2. compare THAT against the grafted net.
     *   3. they must be identical. Any difference is a mapping bug.
     *
     * Doing it on the forward pass rather than on exam scores is strictly
     * stronger: two brains can score the same on twelve missions by luck, but
     * they cannot agree to 1e-7 on the outputs of twenty random sensor readings
     * unless every weight landed on the input it belongs to. */
    const ref = Net.fromJSON(oldJson.net || oldJson);
    const oldNIN = ref.sizes[0], oldRow = oldNIN + 1, nHid = NET_SIZES[1];
    const newPlan = planOf(CURRENT);
    const live = new Set(newPlan.map(e => e.lag + "@" + e.id));
    let zeroed = 0;
    for (let i = 0; i < oldNIN; i++) {
        const e = oldPlan[i];
        if (live.has(e.lag + "@" + e.id)) continue;
        for (let o = 0; o < nHid; o++) ref.weights[0][o * oldRow + i] = 0;
        zeroed++;
    }

    const rng = mulberry32(20260730);
    let worst = 0;
    for (let trial = 0; trial < 20; trial++) {
        // one random reading per (id, lag), shared by both nets
        const byKey = new Map();
        const oldIn = new Float32Array(oldNIN);
        for (let i = 0; i < oldPlan.length; i++) {
            const v = rng() * 2 - 1;
            byKey.set(oldPlan[i].lag + "@" + oldPlan[i].id, v);
            oldIn[i] = v;
        }
        const newIn = new Float32Array(NIN);
        for (let i = 0; i < newPlan.length; i++) {
            const k = newPlan[i].lag + "@" + newPlan[i].id;
            // deliberate garbage on channels that did not exist before: if any
            // of their weights were non-zero, the outputs diverge
            newIn[i] = byKey.has(k) ? byKey.get(k) : (rng() * 4 - 2);
        }
        const a = ref.forward(oldIn), b = net.forward(newIn);
        for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    }
    return { worst, zeroed };
}

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
    console.error("usage: node graft_seed.js <old-champion.json> <new-seed.json>");
    process.exit(2);
}
const src = JSON.parse(fs.readFileSync(inFile, "utf8"));
const g = graft(src);
const { net, ncOld, oldNIN, moved, dropped, droppedIds, srcName, oldPlan } = g;
const { worst, zeroed } = verify(src, net, oldPlan);
if (!(worst < 1e-6)) {
    console.error(`GRAFT REJECTED — outputs differ by ${worst}. The mapping is wrong; not writing anything.`);
    process.exit(1);
}
if (dropped !== zeroed) {
    console.error(`GRAFT REJECTED — dropped ${dropped} inputs but the check zeroed ${zeroed}; the two disagree about what was retired.`);
    process.exit(1);
}

/* Deliberately NOT carrying `history` or `fitness` forward. The world changed
 * under this brain — terrain now starts at stage 1 — so its old fitness is not
 * comparable to anything the new run will produce, and restoring the history
 * would drop the curriculum back at whatever stage the old run had reached
 * instead of letting it re-earn the promotion under the new rules. */
fs.writeFileSync(outFile, JSON.stringify({
    net: net.toJSON(),
    fitness: 0,
    gen: 0,
    graftedFrom: path.basename(inFile),
    graftedFromGen: src.gen || null,
    note: `grafted ${oldNIN} -> ${NIN} inputs (${ncOld} -> ${NC} channels) from "${srcName}"; ` +
        `${moved} re-homed, ${dropped} dropped (${droppedIds.join(", ") || "none"}), ` +
        `${NIN - moved} new inputs at zero weight`
}));
console.log(`grafted ${path.basename(inFile)} — source layout: ${srcName}`);
console.log(`  ${oldNIN} -> ${NIN} inputs, ${ncOld} -> ${NC} channels`);
console.log(`  ${moved} weights re-homed per hidden neuron, keeping what they learned`);
console.log(`  ${dropped} dropped (${droppedIds.join(", ") || "none"}) — retired sensors have nowhere to go`);
console.log(`  ${NIN - moved} new inputs start at EXACTLY zero, so the graft is behaviourally identity`);
console.log(`  identity check: max output difference ${worst.toExponential(2)} across 20 random readings`);
console.log(`  wrote ${outFile}`);
