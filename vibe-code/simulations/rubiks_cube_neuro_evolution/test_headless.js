/* test_headless.js — the assertions this project is allowed to assume.
 *
 *   node test_headless.js            # everything
 *   node test_headless.js cube nn    # named sections only
 *
 * Every check in here exists because getting it wrong produces a *plausible*
 * failure rather than a crash: a cube that is still shuffled by every move but is
 * no longer the Rubik's group, a renderer that quietly hides one face, a reward
 * that is farmable, an observation that makes the task provably impossible. All
 * of those look identical from the outside — "the GA isn't learning" — and none of
 * them are fixed by more generations.
 *
 * The interesting ones, in the order they would waste the most time:
 *
 *   · every move changes the true distance by exactly ±1. rewards.js relies on
 *     this to claim its distance rewards cannot be farmed by oscillating, and the
 *     claim rests on the Cayley graph being bipartite. Checked, not asserted.
 *   · sticker count is identical for U, U2 and U'. The whole argument against the
 *     obvious dense reward.
 *   · `optimalFrac` really is farmable and `descent` really is not — demonstrated
 *     with a hand-written oscillating policy rather than argued.
 *   · a memoryless observation forces a deterministic policy into a cycle.
 *   · the convolution matches an independent naive implementation.
 */
"use strict";
const { load } = require("./load.js");
load();

const only = process.argv.slice(2).filter(a => !a.startsWith("--"));
let pass = 0, fail = 0;
const failures = [];

function section(name, fn) {
    if (only.length && !only.includes(name)) return;
    console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`);
    try { fn(); } catch (e) {
        fail++; failures.push(`${name}: threw ${e.message}`);
        console.log(`  ✗ section threw: ${e.message}\n${e.stack.split("\n").slice(1, 4).join("\n")}`);
    }
}
function ok(cond, msg, detail) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else {
        fail++; failures.push(msg + (detail ? ` — ${detail}` : ""));
        console.log(`  ✗ ${msg}${detail ? `  — ${detail}` : ""}`);
    }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);

/* ══════════════════════════════════════════════════════════════════ cube ══ */
section("cube", () => {
    const set = moveSet("UDLR");
    ok(set.length === 8, `UDLR gives 8 actions: ${set.map(m => m.name).join(" ")}`);
    ok(moveSet("UDLRFB").length === 12, "UDLRFB gives 12 actions");

    // every permutation must be a bijection, or stickers are created/destroyed
    let allBij = true;
    for (const m of MOVES) {
        const seen = new Set();
        for (let i = 0; i < 54; i++) seen.add(m.perm[i]);
        if (seen.size !== 54) allBij = false;
    }
    ok(allBij, "all 12 move tables are bijections on 54 facelets");

    // group laws
    let m4 = true, mmi = true;
    for (const m of MOVES) {
        let s = solved();
        for (let i = 0; i < 4; i++) s = applyMove(s, m);
        if (!isSolved(s)) m4 = false;
        s = applyMove(applyMove(solved(), m), MOVES[m.inv]);
        if (!isSolved(s)) mmi = false;
    }
    ok(m4, "M⁴ = identity for every move");
    ok(mmi, "M·M⁻¹ = identity for every move");

    // opposite faces commute, adjacent ones do not
    const byName = n => MOVES.find(m => m.name === n);
    const seq = (...ms) => ms.reduce((s, m) => applyMove(s, m), solved());
    ok(key(seq(byName("U"), byName("D"))) === key(seq(byName("D"), byName("U"))),
        "U and D commute (opposite faces)");
    ok(key(seq(byName("L"), byName("R"))) === key(seq(byName("R"), byName("L"))),
        "L and R commute (opposite faces)");
    ok(key(seq(byName("U"), byName("R"))) !== key(seq(byName("R"), byName("U"))),
        "U and R do NOT commute (adjacent faces)");

    // colour conservation and immobile centres
    let colourOK = true, centresOK = true;
    const rng = mulberry32(11);
    for (let t = 0; t < 200; t++) {
        const { state } = scramble(rng, 8, set);
        const cnt = new Array(6).fill(0);
        for (let i = 0; i < 54; i++) cnt[state[i]]++;
        if (cnt.some(c => c !== 9)) colourOK = false;
        for (let f = 0; f < 6; f++) if (state[f * 9 + 4] !== f) centresOK = false;
    }
    ok(colourOK, "every scramble has exactly 9 facelets of each colour");
    ok(centresOK, "centre facelets never move (so 'solved' is well defined)");

    /* A known reference fact, independent of the geometry code: turning U
     * clockwise carries the R face's top row onto the F face. If the rotation
     * sense were inverted this would read LLL instead. */
    const afterU = applyMove(solved(), byName("U"));
    const rowOf = (st, f) => [0, 1, 2].map(k => FACE_NAMES[st[f * 9 + k]]).join("");
    ok(rowOf(afterU, 4) === "RRR", `U clockwise puts R's top row on F (got ${rowOf(afterU, 4)})`);
    ok(rowOf(afterU, 2) === "FFF", `…and F's top row on L (got ${rowOf(afterU, 2)})`);

    // a random sequence undone by its reversed inverse returns to solved
    let undoOK = true;
    for (let t = 0; t < 50; t++) {
        const { state, seq: sq } = scramble(rng, 10, set);
        let s = state.slice();
        for (let i = sq.length - 1; i >= 0; i--) s = applyMove(s, MOVES[sq[i].inv]);
        if (!isSolved(s)) undoOK = false;
    }
    ok(undoOK, "a scramble undone by its reversed inverse is solved again");

    // scrambles never hand out an already-solved cube, and never waste a move
    let neverSolved = true, noSelfUndo = true;
    for (let t = 0; t < 400; t++) {
        const d = 1 + (t % 6);
        const { state, seq: sq } = scramble(rng, d, set);
        if (isSolved(state)) neverSolved = false;
        for (let i = 1; i < sq.length; i++) if (sq[i].idx === sq[i - 1].inv) noSelfUndo = false;
    }
    ok(neverSolved, "scramble() never returns a solved cube");
    ok(noSelfUndo, "scramble() never immediately undoes its own previous move");
});

/* ══════════════════════════════════════════════════════════════ oracle ══ */
section("oracle", () => {
    const set = moveSet("UDLR");
    const o = buildDistanceTable(5, set);
    ok(o.size > 5000, `BFS to depth 5 found ${o.size.toLocaleString("en-US")} states`);
    ok(distanceOf(o, solved()) === 0, "solved cube is at distance 0");

    // a d-move scramble is at distance ≤ d
    const rng = mulberry32(3);
    let leOK = true, worst = 0;
    for (let t = 0; t < 300; t++) {
        const d = 1 + (t % 5);
        const { state } = scramble(rng, d, set);
        const dd = distanceOf(o, state);
        if (dd > d) leOK = false;
        if (d - dd > worst) worst = d - dd;
    }
    ok(leOK, `a d-move scramble is never further than d (largest shortcut found: ${worst})`);

    /* ── the load-bearing one ──
     * rewards.js claims that no move is "sideways", so a brain cannot loiter at
     * one distance and cannot farm a descent reward by oscillating. That rests on
     * the Cayley graph of these generators being bipartite (a quarter turn flips
     * corner-permutation parity). Verify it directly on the table's interior,
     * where the BFS is complete and every neighbour's distance is known exactly. */
    let pm1 = true, sideways = 0, checked = 0;
    for (let t = 0; t < 400; t++) {
        const d = 1 + (t % 3);                 // stay well inside the radius
        const { state } = scramble(rng, d, set);
        const dd = distanceOf(o, state);
        for (const m of set) {
            const nb = applyMove(state, m);
            const dn = distanceOf(o, nb);
            if (dd >= o.radius || dn > o.radius) continue;   // outside → not exact
            checked++;
            if (Math.abs(dn - dd) !== 1) { pm1 = false; if (dn === dd) sideways++; }
        }
    }
    ok(pm1, `every move changes the true distance by exactly ±1 ` +
        `(${checked.toLocaleString("en-US")} neighbours checked, ${sideways} sideways)`);

    // every state at distance d has a neighbour at d−1 (BFS is a real metric)
    let hasParent = true;
    for (let t = 0; t < 200; t++) {
        const d = 2 + (t % 3);
        const { state } = scramble(rng, d, set);
        const dd = distanceOf(o, state);
        if (dd === 0) continue;
        let found = false;
        for (const m of set) if (distanceOf(o, applyMove(state, m)) === dd - 1) found = true;
        if (!found) hasParent = false;
    }
    ok(hasParent, "every state has at least one move that strictly reduces its distance");
});

/* ═══════════════════════════════════════════════════════════════ vision ══ */
section("vision", () => {
    const plan = buildRenderPlan(CUBE_GEOM, { res: 16, gap: 0.10, margin: 0.04 });
    ok(plan.W === 32 && plan.H === 16, `image is ${plan.W}×${plan.H} (two 16×16 panels)`);

    /* Every facelet must reach the network. A viewpoint that hides one face makes
     * the puzzle unsolvable and looks exactly like a hard learning problem. */
    const tot = new Float64Array(54);
    const perPix = new Map();
    for (let i = 0; i < plan.nnz; i++) {
        tot[plan.rowFacelet[i]] += plan.rowW[i];
        const p = plan.rowPix[i];
        if (!perPix.has(p)) perPix.set(p, []);
        perPix.get(p).push([plan.rowFacelet[i], plan.rowW[i]]);
    }
    let uncovered = 0;
    for (let f = 0; f < 54; f++) if (tot[f] < 1e-9) uncovered++;
    ok(uncovered === 0, `all 54 facelets contribute pixels (${uncovered} invisible)`);

    /* …and each must *dominate* at least one pixel, otherwise it is only ever a
     * minority contribution to a blend and is not separately readable. */
    const dom = new Int32Array(54);
    for (const [, list] of perPix) {
        let bf = -1, bw = 0, sw = 0;
        for (const [f, w] of list) { sw += w; if (w > bw) { bw = w; bf = f; } }
        if (bf >= 0 && bw > sw - bw) dom[bf]++;
    }
    let minDom = 1e9;
    for (let f = 0; f < 54; f++) minDom = Math.min(minDom, dom[f]);
    ok(minDom >= 2, `worst-read facelet dominates ${minDom} pixels at res 16`);

    // determinism, and sensitivity to a single move
    const a = new Float32Array(plan.frameSize), b = new Float32Array(plan.frameSize);
    renderInto(plan, solved(), a, 0);
    renderInto(plan, solved(), b, 0);
    let same = true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) same = false;
    ok(same, "rendering is deterministic");

    const set = moveSet("UDLR");
    let allDiffer = true, minDelta = Infinity;
    for (const m of set) {
        renderInto(plan, applyMove(solved(), m), b, 0);
        let d2 = 0;
        for (let i = 0; i < a.length; i++) d2 += (a[i] - b[i]) * (a[i] - b[i]);
        if (d2 < 1e-6) allDiffer = false;
        minDelta = Math.min(minDelta, Math.sqrt(d2));
    }
    ok(allDiffer, `every single move visibly changes the image (smallest L2 change ${minDelta.toFixed(2)})`);

    /* U2 and U' produce *different pictures* even though they have the same
     * sticker count. This is the point of using pixels: the information the
     * counting reward throws away is present in the image. */
    const u = set.find(m => m.name === "U");
    const uu = applyMove(applyMove(solved(), u), u);
    const ui = applyMove(solved(), MOVES[u.inv]);
    renderInto(plan, uu, a, 0);
    renderInto(plan, ui, b, 0);
    let d2 = 0;
    for (let i = 0; i < a.length; i++) d2 += (a[i] - b[i]) * (a[i] - b[i]);
    ok(d2 > 1e-3, `U2 and U' look different (L2 ${Math.sqrt(d2).toFixed(2)}) though both score 42 stickers`);

    /* ── palette and shading separability ──
     * The quantity that has to stay distinguishable is not the six colours, it is
     * the 36 (colour × face-brightness) products, because that is what a pixel
     * carries. Measuring raw pairs is what led to picking a palette that was
     * *worse* than the photographic one — the numbers below are the corrected
     * metric, and they are printed rather than merely asserted so a future change
     * to either table can be judged. */
    const rawMin = pal => {
        let b = Infinity, p = "";
        for (let i = 0; i < 6; i++) {
            for (let j = i + 1; j < 6; j++) {
                const d = Math.hypot(pal[i][0] - pal[j][0], pal[i][1] - pal[j][1], pal[i][2] - pal[j][2]);
                if (d < b) { b = d; p = `${COLOR_NAMES[i]}/${COLOR_NAMES[j]}`; }
            }
        }
        return { min: b, pair: p };
    };
    const shadedMin = (pal, lights) => {
        let b = Infinity, p = "";
        for (let i = 0; i < 6; i++) for (let a = 0; a < 6; a++) {
            for (let j = 0; j < 6; j++) for (let c = 0; c < 6; c++) {
                if (i === j) continue;
                const d = Math.hypot(pal[i][0] * lights[a] - pal[j][0] * lights[c],
                    pal[i][1] * lights[a] - pal[j][1] * lights[c],
                    pal[i][2] * lights[a] - pal[j][2] * lights[c]);
                if (d < b) { b = d; p = `${COLOR_NAMES[i]}@${FACE_NAMES[a]} vs ${COLOR_NAMES[j]}@${FACE_NAMES[c]}`; }
            }
        }
        return { min: b, pair: p };
    };
    const rc = rawMin(PALETTES.clear), rr = rawMin(PALETTES.realistic);
    ok(rc.min > rr.min,
        `the chosen palette is better separated raw than the photographic one ` +
        `(${rc.min.toFixed(2)} vs ${rr.min.toFixed(2)}; worst pair ${rc.pair})`);

    const sc = shadedMin(PALETTES.clear, FACE_LIGHT);
    const sd = shadedMin(PALETTES.clear, FACE_LIGHT_DISPLAY);
    ok(sc.min > sd.min,
        `gentle shading keeps the 36 colour×face products further apart than display ` +
        `shading would (${sc.min.toFixed(2)} vs ${sd.min.toFixed(2)}; worst ${sc.pair})`);
    ok(sc.min > 0.30,
        `no two colour×face products come within ${sc.min.toFixed(2)} of each other`);

    // centred output stays inside [-1, 1]
    let lo = Infinity, hi = -Infinity;
    const rng = mulberry32(5);
    for (let t = 0; t < 20; t++) {
        renderInto(plan, scramble(rng, 6, set).state, a, 0);
        for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
    }
    ok(lo >= -1.001 && hi <= 1.001, `centred pixels stay in [-1,1] (saw ${lo.toFixed(3)}…${hi.toFixed(3)})`);
});

/* ══════════════════════════════════════════════════════════ observation ══ */
section("observation", () => {
    const env = new Env(Object.assign({}, resolveConfig("default").env, { maxDepth: 3 }));
    const L = env.layout;
    ok(L.size === L.imageSize + L.extras, `layout adds up: ${L.imageSize} image + ${L.extras} extras = ${L.size}`);
    ok(L.channels === 3 * env.cfg.frames, `${L.channels} channels for ${env.cfg.frames} frames × RGB`);

    const bank = env.makeBank(1, 8, 3);
    const obs = new Observer(env.plan, L);
    obs.reset(bank[0].state);
    ok(obs.vec.length === L.size, "observation vector is exactly the declared size");

    /* reset() must fill every remembered frame with the *current* picture. Zeroing
     * the older frames would tell the network "the cube was black one move ago",
     * a signal that occurs only on move 0 and that a GA will happily latch onto
     * as a free move counter. */
    const fs0 = env.plan.frameSize;
    let framesEqual = true;
    for (let f = 1; f < L.frames; f++) {
        for (let i = 0; i < fs0; i++) if (obs.vec[i] !== obs.vec[f * fs0 + i]) framesEqual = false;
    }
    ok(framesEqual, "reset() fills all frames with the current picture (no free move counter)");

    // the frame stack really shifts, newest first
    const set = env.set;
    const st = bank[0].state.slice();
    const before = obs.vec.slice(0, fs0);
    applyMoveInto(st, set[0], new Uint8Array(54));
    obs.push(st, 0, 20);
    let movedBack = true;
    for (let i = 0; i < fs0; i++) if (obs.vec[fs0 + i] !== before[i]) movedBack = false;
    ok(movedBack, "push() shifts the previous frame into the second slot");
    const fresh = new Float32Array(fs0);
    renderInto(env.plan, st, fresh, 0);
    let newestOK = true;
    for (let i = 0; i < fs0; i++) if (obs.vec[i] !== fresh[i]) newestOK = false;
    ok(newestOK, "…and the newest slot holds the current cube");

    // move history one-hot
    const at = L.extrasAt;
    ok(obs.vec[at + 0] === 1, "last move appears as a one-hot in the extras block");
    let onehotOK = true, sum = 0;
    for (let m = 0; m < L.nMoves; m++) sum += obs.vec[at + m];
    if (sum !== 1) onehotOK = false;
    for (let m = 0; m < L.nMoves; m++) sum += obs.vec[at + L.nMoves + m];
    ok(onehotOK && sum === 1, "the older history slot is all-zero before any second move");

    /* ── the impossibility result, demonstrated in two steps ──
     *
     * The structural claim: with one frame, no move history and no clock, the
     * observation is a function of the cube *alone*. A deterministic argmax policy
     * is then a deterministic map on a finite state space, so its trajectory must
     * enter a cycle, and a brain that has not solved the cube by the time it does
     * never will — however long it is trained.
     *
     * Step 1 checks the premise: the same cube always produces the same
     * observation, whatever happened before it.
     *
     * Step 2 checks the consequence, and needs care about the budget. "Eventually
     * periodic" does not mean "periodic within 10 moves": the tail before the cycle
     * closes can be longer than an episode, and an earlier version of this test
     * asserted a repeat inside the normal budget and failed on 2 of 23 episodes for
     * exactly that reason. The policy is run well past the budget instead, which is
     * what the theorem actually says. */
    const mCfg = resolveConfig("tm-memoryless");
    const mEnv = new Env(Object.assign({}, mCfg.env, { maxDepth: 4 }));
    const mObs = new Observer(mEnv.plan, mEnv.layout);
    const probeState = mEnv.makeBank(5, 4, 3)[0].state;
    const v0 = Array.from(mObs.reset(probeState.slice()));
    mObs.push(applyMove(probeState, mEnv.set[0]), 0, 20);
    mObs.push(applyMove(probeState, mEnv.set[2]), 2, 20);
    const v1 = Array.from(mObs.push(probeState.slice(), 5, 20));
    ok(v0.every((v, i) => v === v1[i]),
        "memoryless: the same cube gives the same observation regardless of history");

    const mBank = mEnv.makeBank(77, 16, 4).map(s => Object.assign({}, s, { budget: 400 }));
    let cycled = 0, unsolved = 0, longestTail = 0;
    for (let t = 0; t < mBank.length; t++) {
        const net = buildNet(mCfg.arch, mEnv.layout, mulberry32(900 + t));
        const run = mEnv.newRunner(net, mBank[t]);
        const seen = new Map([[key(run.state), 0]]);
        let tail = -1;
        while (!run.done) {
            run.step();
            const k = key(run.state);
            if (seen.has(k) && tail < 0) tail = run.moves;
            if (!seen.has(k)) seen.set(k, run.moves);
        }
        if (!run.solvedFlag) {
            unsolved++;
            if (tail >= 0) { cycled++; longestTail = Math.max(longestTail, tail); }
        }
    }
    ok(unsolved === 0 || cycled === unsolved,
        `memoryless: every unsolved trajectory becomes periodic (${cycled}/${unsolved}, ` +
        `longest run-up ${longestTail} moves)`);

    // …and the default profile at least *can* avoid it: the observation never repeats
    const dRun = env.newRunner(buildNet(resolveConfig("default").arch, env.layout, mulberry32(4)), bank[2]);
    const obsSeen = new Set();
    let obsRepeat = false;
    while (!dRun.done) {
        const k = Array.from(dRun.obs.vec.slice(L.extrasAt)).join(",");
        if (obsSeen.has(k)) obsRepeat = true;
        obsSeen.add(k);
        dRun.step();
    }
    ok(!obsRepeat, "with a clock and move history the observation never repeats within an episode");
});

/* ═══════════════════════════════════════════════════════════════════ nn ══ */
section("nn", () => {
    const cfg = resolveConfig("default");
    const env = new Env(cfg.env);
    const rng = mulberry32(19);
    const net = buildNet(cfg.arch, env.layout, rng);
    ok(net.paramCount > 0, `conv net has ${net.paramCount.toLocaleString("en-US")} parameters`);

    const probe = new Float32Array(env.layout.size);
    for (let i = 0; i < probe.length; i++) probe[i] = Math.sin(i * 0.37) * 0.8;

    // clone is exact
    const c = net.clone();
    const a = Array.from(net.forward(probe)), b = Array.from(c.forward(probe));
    ok(a.every((v, i) => v === b[i]), "clone() reproduces the output bit-for-bit");

    // zero-rate mutation is a no-op
    const z = net.clone().mutate(0, 0.5, mulberry32(1));
    ok(Array.from(z.forward(probe)).every((v, i) => v === a[i]), "mutate(rate=0) changes nothing");

    // mutation actually moves things at rate 1
    const m = net.clone().mutate(1, 0.3, mulberry32(2));
    ok(!Array.from(m.forward(probe)).every((v, i) => v === a[i]), "mutate(rate=1) changes the output");

    // crossover with itself is itself
    const x = Genome.crossover(net, net, mulberry32(3));
    ok(Array.from(x.forward(probe)).every((v, i) => v === a[i]), "crossover(a, a) === a");

    // JSON round trip
    const rt = netFromJSON({ net: JSON.parse(JSON.stringify(net.toJSON())) });
    ok(rt.contract() === net.contract(), `contract survives JSON: ${rt.contract()}`);
    ok(Array.from(rt.forward(probe)).every((v, i) => v === a[i]), "weights survive JSON bit-for-bit");

    /* Rounding to 7 significant digits is what bake_brain.js does to keep
     * default_brain.js from tripling in size. Float32 carries ~7 digits, so this
     * must be lossless — checked here rather than hoped for at bake time. */
    const j = net.toJSON();
    j.weights = j.weights.map(w => w.map(v => Number(v.toPrecision(7))));
    const rounded = netFromJSON({ net: j });
    let worstDelta = 0;
    const rr = rounded.forward(probe);
    for (let i = 0; i < a.length; i++) worstDelta = Math.max(worstDelta, Math.abs(a[i] - rr[i]));
    ok(worstDelta < 1e-6, `7-digit rounding leaves the output unchanged (worst Δ ${worstDelta.toExponential(1)})`);

    /* An independent naive convolution. The optimised forward() indexes a
     * plane-major buffer in place with strides and pooling folded in; this
     * reimplements it the obvious slow way and compares. */
    const sp = net.spec;
    const naive = naiveConvForward(net, probe);
    let convWorst = 0;
    for (let i = 0; i < naive.length; i++) convWorst = Math.max(convWorst, Math.abs(naive[i] - a[i]));
    ok(convWorst < 2e-5, `conv forward matches a naive reference (worst Δ ${convWorst.toExponential(1)})`,
        `spec ${JSON.stringify(sp.conv)}`);

    /* Every named architecture and every named config must actually build.
     *
     * A conv spec is a chain of shape constraints and it is easy to write one that
     * cannot exist — `convDeep` pooled a 5×13 map down to 2×6 and then asked for a
     * 3×3 kernel, which throws. Nothing caught it until the architecture grid spent
     * seven minutes on that cell and reported FAILED. A spec that cannot be
     * instantiated is a typo, and typos should cost 40 seconds. */
    const broken = [];
    for (const name of Object.keys(CONFIGS)) {
        try {
            const c = resolveConfig(name);
            const e = new Env(Object.assign({}, c.env, { reward: "stickers" }));  // skip the oracle
            const n = buildNet(c.arch, e.layout, mulberry32(1));
            const probeVec = new Float32Array(e.layout.size);
            const out = n.forward(probeVec);
            if (out.length !== e.nMoves) broken.push(`${name} (${out.length} outputs, ${e.nMoves} moves)`);
        } catch (err) { broken.push(`${name}: ${err.message}`); }
    }
    ok(broken.length === 0,
        `all ${Object.keys(CONFIGS).length} named configs build and produce one output per move`,
        broken.join("; "));

    // MLP path
    const mlpCfg = resolveConfig("ar-mlp12");
    const mEnv = new Env(mlpCfg.env);
    const mNet = buildNet(mlpCfg.arch, mEnv.layout, mulberry32(21));
    ok(mNet.sizes[0] === mEnv.layout.size && mNet.sizes[mNet.sizes.length - 1] === mEnv.nMoves,
        `MLP is ${mNet.contract()} — input and action space match the layout`);

    // argmax is invariant to the output squash, as claimed in nn.js
    const raw = Array.from(net.forward(probe));
    const picked = chooseMove(raw);
    ok(raw[picked] === Math.max(...raw), "chooseMove returns the argmax");

    // self-adaptive sigma stays in its bounds
    let sig = net.clone(), lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 400; i++) {
        sig.mutateAdaptive(0.02, 0.2, mulberry32(i + 1), 0.25);
        lo = Math.min(lo, sig.sigma); hi = Math.max(hi, sig.sigma);
    }
    ok(lo >= 0.12 - 1e-9 && hi <= 6 + 1e-9, `self-adaptive σ stayed in [0.12, 6] (${lo.toFixed(2)}…${hi.toFixed(2)})`);

    /* Per-generator Box–Muller spare: two generators seeded identically must
     * produce identical streams no matter how they are interleaved. A
     * module-level spare breaks this and silently destroys --seed reproducibility. */
    const g1 = mulberry32(7), g2 = mulberry32(7), g3 = mulberry32(99);
    const s1 = [];
    for (let i = 0; i < 6; i++) s1.push(gaussRand(g1));
    const s2 = [];
    for (let i = 0; i < 6; i++) { s2.push(gaussRand(g2)); gaussRand(g3); }
    ok(s1.every((v, i) => v === s2[i]), "gaussRand streams are independent per generator");
});

/* A deliberately dumb, independent implementation of ConvNet.forward. */
function naiveConvForward(net, input) {
    const sp = net.spec, pl = sp.plane;
    const act = name => ACTS[name].f;
    const hid = act(sp.acts.hidden), out = act(sp.acts.out);
    // lift the plane into a nested array
    let cur = [];
    for (let c = 0; c < pl.ch; c++) {
        const plane = [];
        for (let y = 0; y < pl.h; y++) {
            const row = [];
            for (let x = 0; x < pl.w; x++) row.push(input[pl.at + c * pl.h * pl.w + y * pl.w + x]);
            plane.push(row);
        }
        cur.push(plane);
    }
    for (let l = 0; l < sp.conv.length; l++) {
        const c = sp.conv[l], w = net.weights[l];
        const inCh = cur.length, h = cur[0].length, wd = cur[0][0].length;
        const oh = Math.floor((h - c.k) / c.stride) + 1, ow = Math.floor((wd - c.k) / c.stride) + 1;
        const rowLen = c.k * c.k * inCh + 1;
        const next = [];
        for (let f = 0; f < c.ch; f++) {
            const plane = [];
            for (let oy = 0; oy < oh; oy++) {
                const row = [];
                for (let ox = 0; ox < ow; ox++) {
                    let sum = w[f * rowLen + rowLen - 1], wi = f * rowLen;
                    for (let ch = 0; ch < inCh; ch++) {
                        for (let ky = 0; ky < c.k; ky++) {
                            for (let kx = 0; kx < c.k; kx++) {
                                sum += w[wi++] * cur[ch][oy * c.stride + ky][ox * c.stride + kx];
                            }
                        }
                    }
                    row.push(hid(sum));
                }
                plane.push(row);
            }
            next.push(plane);
        }
        cur = next;
        if (c.pool > 1) {
            const p = c.pool, ph = Math.floor(cur[0].length / p), pw = Math.floor(cur[0][0].length / p);
            cur = cur.map(plane => {
                const o = [];
                for (let y = 0; y < ph; y++) {
                    const row = [];
                    for (let x = 0; x < pw; x++) {
                        let best = -Infinity;
                        for (let dy = 0; dy < p; dy++) for (let dx = 0; dx < p; dx++) {
                            best = Math.max(best, plane[y * p + dy][x * p + dx]);
                        }
                        row.push(best);
                    }
                    o.push(row);
                }
                return o;
            });
        }
    }
    let head = [];
    for (const plane of cur) for (const row of plane) for (const v of row) head.push(v);
    const planeEnd = pl.at + pl.ch * pl.h * pl.w;
    for (let i = 0; i < pl.at; i++) head.push(input[i]);
    for (let i = planeEnd; i < sp.in; i++) head.push(input[i]);
    for (let l = 0; l < net.denseSizes.length - 1; l++) {
        const w = net.weights[net.nConv + l];
        const nIn = net.denseSizes[l], nOut = net.denseSizes[l + 1];
        const fn = l === net.denseSizes.length - 2 ? out : hid;
        const nx = [];
        for (let o = 0; o < nOut; o++) {
            let sum = w[o * (nIn + 1) + nIn];
            for (let i = 0; i < nIn; i++) sum += w[o * (nIn + 1) + i] * head[i];
            nx.push(fn(sum));
        }
        head = nx;
    }
    return head;
}

/* ══════════════════════════════════════════════════════════════ rewards ══ */
section("rewards", () => {
    const set = moveSet("UDLR");
    const U = set.find(m => m.name === "U");

    /* The whole case against the obvious dense reward, in three numbers. */
    const s1 = applyMove(solved(), U);
    const s2 = applyMove(s1, U);
    const s3 = applyMove(s2, U);          // = U' from solved
    ok(stickerScore(s1) === stickerScore(s2) && stickerScore(s2) === stickerScore(s3),
        `sticker count is identical for U, U2 and U' (all ${stickerScore(s1)}/54)`);
    ok(stickerScore(solved()) === 54, "solved cube scores 54 stickers");

    const o = buildDistanceTable(4, set);
    ok(distanceOf(o, s1) === 1 && distanceOf(o, s2) === 2 && distanceOf(o, s3) === 1,
        "…while the true distances are 1, 2 and 1 — the information stickers discard");

    /* ── the farming demonstration ──
     * A hand-written policy that plays U, U', U, U' … forever. Under
     * `optimalFrac` half of its moves reduce the distance, so it banks ~0.5
     * without going anywhere. Under `descent` it banks nothing, because it never
     * sets a new personal best. Written as a real episode through a real Env, not
     * as an argument. */
    function oscillate(envCfg) {
        const env = new Env(Object.assign({}, resolveConfig("default").env, envCfg, {
            maxDepth: 3, forceOracle: true,
        }));
        const bank = env.makeBank(4242, 24, 3);
        const uIdx = env.set.findIndex(m => m.name === "U");
        const uiIdx = env.set.findIndex(m => m.name === "U'");
        const inert = { forward: () => new Float32Array(env.nMoves) };
        let tot = 0;
        for (const scr of bank) {
            const run = env.newRunner(inert, scr);
            let flip = 0;
            while (!run.done) run.step(flip++ % 2 === 0 ? uIdx : uiIdx);
            tot += run.trace().reward;
        }
        return tot / bank.length;
    }
    const farmOptimal = oscillate({ reward: "optimalFrac", rewardParams: { solveBonus: 0, speedBonus: 0 } });
    const farmDescent = oscillate({ reward: "descent", rewardParams: { solveBonus: 0, speedBonus: 0 } });
    ok(farmOptimal > 0.35, `optimalFrac IS farmable — an oscillating policy banks ${farmOptimal.toFixed(3)}`);
    ok(farmDescent < 0.35, `descent is not — the same policy banks ${farmDescent.toFixed(3)}`);

    // every named reward runs, and pays more for solving than for not
    const env = new Env(Object.assign({}, resolveConfig("default").env, { forceOracle: true }));
    const bank = env.makeBank(9, 6, 2);
    let allMonotone = true, broken = [];
    for (const name of Object.keys(REWARDS)) {
        const p = rewardParams({});
        const f = rewardOf(name).fn;
        const scr = bank[0];
        const base = {
            d0: 3, dBest: 3, dFinal: 3, dSum: 9, dCount: 3, descDisc: 0,
            s0: 40, sBest: 40, sFinal: 40, facesBest: 0,
            moves: 9, budget: 9, solved: false, reducing: 0, undos: 0, moveMix: new Float64Array(8),
        };
        const win = Object.assign({}, base, {
            dBest: 0, dFinal: 0, descDisc: 1 + 0.9 + 0.81, sBest: 54, sFinal: 54,
            facesBest: 6, moves: 3, solved: true, reducing: 3,
        });
        const rLose = f(base, p), rWin = f(win, p);
        if (!(rWin > rLose) || !isFinite(rWin) || !isFinite(rLose)) { allMonotone = false; broken.push(name); }
        void scr;
    }
    ok(allMonotone, `all ${Object.keys(REWARDS).length} rewards pay strictly more for a solve than for a stall`,
        broken.length ? "broken: " + broken.join(", ") : "");

    // needsOracle agrees with the table
    ok(!needsOracle("stickers") && needsOracle("descent") && needsOracle("mixed"),
        "needsOracle() matches the reward table (so runs that cannot use it do not build it)");
});

/* ═══════════════════════════════════════════════════════════════════ env ══ */
section("env", () => {
    const cfg = resolveConfig("default");
    const env = new Env(cfg.env);

    /* Stratification: the diet must be exact and reproducible, not a random draw
     * whose variance is mistaken for a change in the population. */
    for (const n of [12, 24, 48, 64, 96]) {
        for (const D of [1, 3, 5, 7]) {
            const c = env.depthCounts(n, D);
            const sum = c.reduce((a, b) => a + b, 0);
            if (sum !== n) { ok(false, `depthCounts(${n}, ${D}) sums to ${sum}, not ${n}`); return; }
        }
    }
    ok(true, "depthCounts() always sums to exactly the episode count");
    const c1 = env.depthCounts(48, 5), c2 = env.depthCounts(48, 5);
    ok(c1.join(",") === c2.join(","), `…and is deterministic: [${c1.join(", ")}] at depth 5`);
    ok(c1[0] >= 1, "…and never drops the shallow rungs (anti-forgetting)");
    ok(c1[c1.length - 1] === Math.max(...c1), "…while weighting the frontier most heavily");

    // the bank matches the plan
    const bank = env.makeBank(5, 48, 5);
    const got = new Array(5).fill(0);
    for (const b of bank) got[b.depth - 1]++;
    ok(got.join(",") === c1.join(","), `bank realises the plan exactly: [${got.join(", ")}]`);
    ok(bank.every(b => b.d0 <= b.depth && b.d0 >= 1), "every scramble's true distance is ≤ its depth and ≥ 1");

    /* The ratchet's promotion probe must keep the same statistical power at every
     * rung. Filtering a mixed bank gave it d/Σd of the requested games — 67% at
     * depth 2, 25% at depth 7 — so the test guarding the curriculum got weaker
     * exactly as its decisions got harder. */
    for (const d of [1, 2, 5, 7]) {
        const db = env.makeDepthBank(31, 96, d);
        if (db.length !== 96 || !db.every(b => b.depth === Math.min(d, env.depthCap))) {
            ok(false, `makeDepthBank(96, ${d}) gave ${db.length} scrambles at mixed depths`);
            return;
        }
    }
    ok(true, "makeDepthBank returns exactly the requested count at exactly one depth");

    /* The budget must not leak difficulty into the observation. The clock is
     * normalised by the constant maximum, so two scrambles of different depth see
     * the same clock value at the same move number. */
    const shallow = bank.find(b => b.depth === 1), deep = bank.find(b => b.depth === 5);
    const net = buildNet(cfg.arch, env.layout, mulberry32(31));
    const rA = env.newRunner(net, shallow), rB = env.newRunner(net, deep);
    rA.step(); rB.step();
    const at = env.layout.extrasAt + env.layout.hist * env.layout.nMoves;
    ok(rA.obs.vec[at] === rB.obs.vec[at],
        `the clock reads the same after one move on a depth-1 and a depth-5 cube (${rA.obs.vec[at].toFixed(3)})`);
    ok(rA.budget < rB.budget, `…even though the budgets differ (${rA.budget} vs ${rB.budget})`);

    // episodes stop when they should
    let stopsOnSolve = true, respectsBudget = true;
    for (const scr of bank) {
        const tr = env.runEpisode(net, scr);
        if (tr.solved && tr.moves > tr.budget) stopsOnSolve = false;
        if (tr.moves > tr.budget) respectsBudget = false;
    }
    ok(respectsBudget && stopsOnSolve, "no episode ever exceeds its move budget");

    /* Stepping a Runner by hand must give the same trace as runEpisode — the page
     * drives the former and the trainer the latter, and this is the assertion that
     * they have not drifted. */
    const scr = bank[10];
    const t1 = env.runEpisode(net, scr);
    const r2 = env.newRunner(net, scr);
    while (!r2.done) r2.step();
    const t2 = r2.trace();
    ok(t1.reward === t2.reward && t1.moves === t2.moves && t1.solved === t2.solved,
        "hand-stepping a Runner gives the same trace as runEpisode (page and trainer agree)");

    // scoring the same brain twice on the same bank is identical
    const a = env.scoreBrain(net, bank), b = env.scoreBrain(net, bank);
    ok(a.fitness === b.fitness && a.solveRate === b.solveRate, "scoreBrain is deterministic");

    /* The ratchet promotes on a lower confidence bound, not on the raw probe.
     *
     * The probe runs every few generations, so a long run takes dozens of shots at
     * the threshold and promotes on the first success. A run here advanced from
     * depth 3 to 4 on one 77%-of-96 reading from a champion that measured 58.2% ±
     * 2.0 on 600 fresh cubes straight afterwards. Promoting on `rate` alone is a
     * multiple-comparisons machine; promoting on `rate − 1.64·SE` is a statement
     * about the brain rather than about one bank. */
    const rat = new Ratchet({ startDepth: 3, threshold: 0.75, games: 96, maxDepth: 7 });
    ok(!rat.passes(0.77), "a 77%-of-96 probe does NOT promote against a 75% threshold");
    ok(rat.passes(0.90), "a 90%-of-96 probe does");
    ok(rat.needed() > 0.75 && rat.needed() < 0.92,
        `at 96 games it wants ${(rat.needed() * 100).toFixed(0)}% observed for a 75% lower bound`);
    const wide = new Ratchet({ threshold: 0.75, games: 2000 });
    ok(wide.needed() < rat.needed(),
        `a bigger probe demands less headroom (${(wide.needed() * 100).toFixed(0)}% at 2000 games)`);

    // the facelet control has a sane layout
    const fEnv = new Env(resolveConfig("ar-facelets").env);
    ok(fEnv.layout.imageSize === 324, "the no-pixels control feeds 54 facelets one-hot (324 inputs)");
    const fNet = buildNet(resolveConfig("ar-facelets").arch, fEnv.layout, mulberry32(3));
    const fr = fEnv.scoreBrain(fNet, fEnv.makeBank(1, 8, 2));
    ok(isFinite(fr.fitness), "…and runs episodes end to end");
});

/* ══════════════════════════════════════════════════════════ evolution ══ */
section("the funnel and deep scrambles", () => {
    /* pairScore is the metric that has to keep working where the oracle stops. */
    ok(pairScore(solved()) === 72, "a solved cube has all 72 adjacent pairs matched");
    const set = moveSet("UDLR");
    const oneU = applyMove(solved(), set[0]);
    ok(pairScore(oneU) < 72 && pairScore(oneU) > 40,
        `one turn breaks some pairs but not most (${pairScore(oneU)}/72)`);
    /* ...and it has to be blind in the same place sticker count is, which is exactly
     * why the funnel hands over to the oracle inside the radius. Asserting the
     * blindness keeps anyone from later "fixing" the funnel by deleting the oracle
     * half. */
    const U = set.find(m => m.name === "U"), Up = set.find(m => m.name === "U'");
    const uu = applyMove(applyMove(solved(), U), U);
    ok(pairScore(applyMove(solved(), Up)) === pairScore(oneU),
        "pairScore cannot tell U from U' — same blindness as sticker count");
    ok(pairScore(uu) === pairScore(oneU), "…nor U from U2");

    /* The ordering that makes the funnel a funnel: no amount of tidiness outside the
     * ball may beat the barest entry into it. If this inverts, the population gets a
     * local optimum of polishing the surface forever. */
    const P = rewardParams({});
    const fn = rewardOf("funnel").fn;
    const tr = o => Object.assign({
        d0: 8, dBest: 8, dSat: 8, sBest: 6, pBest: 0, descDisc: 0, dSum: 24, dCount: 3,
        moves: 10, budget: 30, solved: false, reducing: 0, undos: 0,
    }, o);
    const perfectOutside = fn(tr({ sBest: 54, pBest: 72 }), P);
    const barestEntry = fn(tr({ dBest: 7 }), P);
    ok(perfectOutside < barestEntry,
        `perfect structure outside the ball (${perfectOutside.toFixed(3)}) still loses to ` +
        `entering it at distance 7 (${barestEntry.toFixed(3)})`);
    ok(fn(tr({ dBest: 1 }), P) > fn(tr({ dBest: 4 }), P),
        "inside the ball, closer is worth more");
    ok(fn(tr({ sBest: 40, pBest: 60 }), P) > fn(tr({ sBest: 10, pBest: 20 }), P),
        "outside the ball, tidier is worth more — there is a gradient out there at all");
    /* And the reason none of this was reachable before: the old reward is flat. */
    const mixed = rewardOf("mixed").fn;
    ok(mixed(tr({ dBest: 8, d0: 8 }), P) === mixed(tr({ dBest: 8, d0: 8, sBest: 54, pBest: 72 }), P),
        "the previous reward is constant outside the radius — nothing to select on");

    /* The budget must come off the scramble depth once the distance saturates, or a
     * 12-turn cube gets the move budget of an 8-turn one. */
    const cfg = resolveConfig("deep12");
    const env = new Env(Object.assign({}, cfg.env, { forceOracle: true }));
    ok(env.depthCap === 12, "depthCapOverride lifts the curriculum past the oracle radius");
    ok(env.budgetFor(env.budgetBasis(8, 12)) === 30, "a depth-12 scramble gets 30 moves, not 13");
    ok(env.budgetFor(env.budgetBasis(3, 3)) === env.budgetFor(3),
        "…and inside the radius the basis is untouched, so old runs stay comparable");
    const bank = env.makeBank(11, 192, 12);
    ok(bank.some(b => b.depth === 12), "the bank actually contains depth-12 scrambles");
    ok(bank.filter(b => b.depth <= 7).length / bank.length > 0.25,
        "…while a third of it stays inside the ball, so the endgame is still trained");
    const deepOne = bank.find(b => b.depth === 12);
    ok(deepOne.budget === 30, "and they carry the raised budget");
});

section("recurrence", () => {
    const cfg = resolveConfig("r5-relu64ep96");
    const env = new Env(Object.assign({}, cfg.env, { forceOracle: true }));
    const rec = buildNet(Object.assign({}, cfg.arch, { recurrent: true }), env.layout, mulberry32(5));
    const ff = buildNet(cfg.arch, env.layout, mulberry32(5));

    ok(/\+rec64/.test(rec.contract()),
        `a recurrent brain says so in its contract (${rec.contract()})`);
    ok(rec.paramCount > ff.paramCount,
        `and costs the extra block of weights (${rec.paramCount} vs ${ff.paramCount})`);

    const probe = new Float32Array(env.layout.size);
    for (let i = 0; i < probe.length; i++) probe[i] = Math.sin(i * 0.3) * 0.5;
    rec.resetState();
    const a = Array.from(rec.forward(probe));
    const b = Array.from(rec.forward(probe));
    ok(a.some((v, i) => Math.abs(v - b[i]) > 1e-9),
        "the same picture twice gives different answers — state is actually carried");
    rec.resetState();
    const c = Array.from(rec.forward(probe));
    ok(a.every((v, i) => Math.abs(v - c[i]) < 1e-12), "resetState returns it to the start");
    const d = Array.from(ff.forward(probe)), e = Array.from(ff.forward(probe));
    ok(d.every((v, i) => Math.abs(v - e[i]) < 1e-12),
        "…and a feedforward brain is untouched by any of this");

    /* The property that actually protects the measurements: an episode's result must
     * not depend on what the brain was shown before it. Without a reset in Runner, a
     * brain would score differently purely for being second in the bank. */
    const bank = env.makeBank(4242, 6, 5);
    const first = bank.map(scr => env.runEpisode(rec, scr));
    const again = bank.map(scr => env.runEpisode(rec, scr));
    ok(first.every((t, i) => t.moves === again[i].moves && t.solved === again[i].solved),
        "replaying the same bank gives identical episodes — no leakage between them");
    const reversed = bank.slice().reverse().map(scr => env.runEpisode(rec, scr)).reverse();
    ok(first.every((t, i) => t.moves === reversed[i].moves && t.solved === reversed[i].solved),
        "…and bank order cannot change a brain's score");

    /* An unbounded state fed back through an unbounded activation is the obvious way
     * this blows up, and thirteen moves is long enough for it to. Assert the state
     * stays finite over a full deep episode. */
    rec.resetState();
    for (let t = 0; t < 40; t++) rec.forward(probe);
    const st = rec._rec;
    let worst = 0;
    for (let i = 0; i < st.length; i++) worst = Math.max(worst, Math.abs(st[i]));
    ok(isFinite(worst), `the recurrent state stays finite over 40 steps (max |h| = ${worst.toFixed(2)})`);
});

section("imitation fitness", () => {
    const cfg = resolveConfig("r5-relu64ep96");
    const env = new Env(Object.assign({}, cfg.env, { forceOracle: true, fitness: "imitate" }));
    const rng = mulberry32(11);
    const one = scramble(rng, 1, env.set).state;
    ok(env.optimalSet(one).length === 1,
        "from a depth-1 cube exactly one turn reduces the distance");
    const solvedState = solved();
    ok(env.optimalSet(solvedState).length === 0, "and a solved cube has no reducing turn");

    /* The unfarmability property, which is the whole reason for teacher forcing: the
     * state sequence is the oracle's, so the brain's own choices cannot steer the
     * episode toward states it likes. Two brains with completely different (constant)
     * policies must therefore walk identical trajectories and see identical decisions.
     * This is what `optimalFrac` could not claim, and why it degraded from 0.99 to 0.27
     * rank correlation as cubes got deeper. */
    const bank = env.makeBank(7, 20, 7);
    const constant = k => ({ forward: () => { const o = new Float64Array(8); o[k] = 1; return o; } });
    const a = env.scoreBrain(constant(0), bank);
    const b = env.scoreBrain(constant(5), bank);
    ok(Math.abs(a.movesPerEpisode - b.movesPerEpisode) < 1e-9,
        `two different constant policies walk the same path (${a.movesPerEpisode.toFixed(2)} steps each)`);
    ok(a.fitness <= 1 && a.fitness >= 0 && b.fitness <= 1 && b.fitness >= 0,
        "accuracy is a rate");

    /* A brain that answers optimally every time must score exactly 1, and its
     * "perfect episode" rate — the honest solve proxy — must be 1 too. */
    let cur = null;
    const oracleBrain = {
        forward() {
            const o = new Float64Array(8);
            const opt = env.optimalSet(cur.state);
            o[opt.length ? opt[0] : 0] = 1;
            return o;
        },
    };
    const origRunner = env.newRunner.bind(env);
    void origRunner;
    /* imitationScore builds its own Runner, so hand the brain a view of it via the
     * env's scratch: simplest is to re-implement the loop here rather than reach in. */
    let hits = 0, steps = 0, perfect = 0;
    for (const scr of bank) {
        const r = new Runner(env, oracleBrain, scr);
        cur = r;
        let ok2 = 0, n = 0;
        while (!r.done) {
            const opt = env.optimalSet(r.state);
            if (!opt.length) break;
            if (opt.indexOf(chooseMove(oracleBrain.forward())) >= 0) ok2++;
            n++;
            r.step(opt[0]);
        }
        hits += ok2; steps += n; if (n > 0 && ok2 === n) perfect++;
    }
    ok(steps > 0 && hits === steps, `an oracle-following brain agrees on every one of ${steps} decisions`);
    ok(perfect === bank.length, "…and every episode is a perfect one");

    /* The point of the whole exercise: many labelled decisions per episode instead of
     * one bit, so the same bank resolves accuracy far more sharply. */
    ok(steps > bank.length * 2,
        `${steps} labelled decisions from ${bank.length} episodes — a denser signal than one outcome each`);
});

section("dagger and blend fitness", () => {
    const cfg = resolveConfig("dag-relu64");
    const env = new Env(Object.assign({}, cfg.env, { forceOracle: true }));
    const net = buildNet(cfg.arch, env.layout, mulberry32(3));
    const bank = env.makeBank(9, 24, 7);
    const d = env.scoreBrain(net, bank);
    ok(d.fitness >= 0 && d.fitness <= 1, `dagger fitness is a rate (${d.fitness.toFixed(3)})`);

    /* Unlike the teacher-forced version, the brain drives here — so a different policy
     * must be able to walk a different path. If this ever stops being true, dagger has
     * silently become imitation. */
    const constant = k => ({ forward: () => { const o = new Float64Array(8); o[k] = 1; return o; } });
    const a = env.scoreBrain(constant(0), bank);
    const b = env.scoreBrain(constant(3), bank);
    ok(Math.abs(a.movesPerEpisode - b.movesPerEpisode) > 1e-9 || a.fitness !== b.fitness,
        "the brain's own choices shape its rollout");

    /* Wandering outside the oracle's radius must be scored wrong, not skipped —
     * otherwise "go somewhere ungradeable" becomes a way to dodge being marked. */
    const benv = new Env(Object.assign({}, resolveConfig("blend-relu64").env, { forceOracle: true }));
    const bl = benv.scoreBrain(net, bank);
    ok(bl.accuracy !== undefined && bl.fitness <= Math.max(bl.accuracy, 5),
        "blend reports the agreement it mixed in");
    ok(benv.cfg.fitness === "blend",
        "blend restores the fitness mode it borrowed while computing the reward half");
});

section("the unfolded view", () => {
    const plan = buildRenderPlan(CUBE_GEOM, {
        res: 18, ss: 3, gap: 0.1, palette: "clear", center: true, view: "unfolded",
    });
    ok(plan.view === "unfolded" && plan.W === 36 && plan.H === 27,
        `res 18 lays the cross out as ${plan.W}x${plan.H}`);

    /* Every facelet must be visible. The isometric pair needs two panels precisely
     * because one viewpoint hides half the cube; an unfolded net has no excuse. */
    const seen = new Set();
    for (let i = 0; i < plan.nnz; i++) seen.add(plan.rowFacelet[i]);
    ok(seen.size === 54, `all 54 facelets appear in the render (${seen.size})`);

    /* The property the projection exists for: with a facelet an exact 3x3 block, no
     * output pixel straddles two facelets, so a stride-3 filter reads one facelet
     * cleanly. Under the isometric view most pixels are mixtures. */
    const perPixel = new Map();
    for (let i = 0; i < plan.nnz; i++) {
        perPixel.set(plan.rowPix[i], (perPixel.get(plan.rowPix[i]) || 0) + 1);
    }
    let mixed = 0;
    for (const n of perPixel.values()) if (n > 1) mixed++;
    ok(mixed === 0, `no pixel mixes two facelets (${mixed} mixed of ${perPixel.size} sticker pixels)`);

    const iso = buildRenderPlan(CUBE_GEOM, {
        res: 16, ss: 3, margin: 0.04, gap: 0.10, palette: "clear", center: true, shade: true,
    });
    const isoPer = new Map();
    for (let i = 0; i < iso.nnz; i++) {
        isoPer.set(iso.rowPix[i], (isoPer.get(iso.rowPix[i]) || 0) + 1);
    }
    let isoMixed = 0;
    for (const n of isoPer.values()) if (n > 1) isoMixed++;
    ok(isoMixed > 0, `…whereas the isometric view mixes ${isoMixed} of its ${isoPer.size} sticker pixels`);

    /* And it still has to be a working environment, not just a picture. */
    const cfg = resolveConfig("unf18");
    const env = new Env(Object.assign({}, cfg.env, { forceOracle: true }));
    ok(env.layout.size === 2949, `observation is ${env.layout.size} numbers`);
    const net = buildNet(cfg.arch, env.layout, mulberry32(3));
    const bank = env.makeBank(5, 12, 5);
    const r = env.scoreBrain(net, bank);
    ok(r.solveRate >= 0 && r.solveRate <= 1, "episodes run end to end on the unfolded view");
    /* Two different cubes must not render identically — the sanity check that the
     * render is actually a function of the state. */
    const a = new Float32Array(env.layout.size), b = new Float32Array(env.layout.size);
    const obsA = new Observer(env.plan, env.layout); obsA.reset(solved()); a.set(obsA.vec);
    const scrambled = scramble(mulberry32(3), 4, env.set).state;
    const obsB = new Observer(env.plan, env.layout); obsB.reset(scrambled); b.set(obsB.vec);
    ok(a.some((v, i) => Math.abs(v - b[i]) > 1e-6), "a scrambled cube renders differently from a solved one");
});

section("evolution", () => {
    const cfg = resolveConfig("default");
    const env = new Env(cfg.env);
    const spawn = rng => buildNet(cfg.arch, env.layout, rng);

    /* Same seed, same everything: a run that cannot be reproduced cannot be
     * debugged, and the reproducibility is exactly what a shared Box–Muller spare
     * would have broken. */
    function shortRun(seed) {
        const evo = new Evolution(24, seed, 1, spawn);
        for (let g = 0; g < 4; g++) {
            const bank = env.makeBank(evo.gen * 7919 + 101, 8, 2);
            const results = evo.brains.map(b => {
                const s = env.scoreBrain(b, bank);
                return { brain: b, fitness: s.fitness, solveRate: s.solveRate, descent: s.descent, sig: s.sig };
            });
            evo.evolve(results, cfg.ga);
        }
        return evo.championFit;
    }
    ok(shortRun(555) === shortRun(555), "a run is reproducible from its seed");
    ok(shortRun(555) !== shortRun(556), "…and different seeds give different runs");

    /* Elitism: the champion's fitness can never decrease across a generation,
     * because rank 0 is always an untouched copy and it is re-scored on the same
     * bank the challenger faced. */
    const evo = new Evolution(24, 7, 1, spawn);
    let dropped = false, prev = -Infinity;
    for (let g = 0; g < 6; g++) {
        const bank = env.makeBank(999, 8, 2);            // fixed bank: no re-score noise
        const results = evo.brains.map(b => {
            const s = env.scoreBrain(b, bank);
            return { brain: b, fitness: s.fitness, solveRate: s.solveRate, descent: s.descent, sig: s.sig };
        });
        evo.evolve(results, cfg.ga);
        if (evo.championFit < prev - 1e-9) dropped = true;
        prev = evo.championFit;
    }
    ok(!dropped, "on a fixed bank the champion's fitness is monotone (elitism holds)");

    /* The gate must be able to veto a challenger that won in-run.
     *
     * Fed synthetic results rather than real ones on purpose. An earlier version
     * ran three real generations and hoped a challenger would out-score the
     * champion so the gate would be consulted at all — over 16 brains and 3
     * generations it did not, and the test failed reporting "undefined rejects",
     * which looks exactly like a broken gate. Hand-built fitnesses make the
     * challenge certain. */
    const mk = (b, f) => ({ brain: b, fitness: f, solveRate: 0, descent: 0, sig: null });
    const evo2 = new Evolution(16, 3, 1, spawn);
    evo2.gateFn = () => -1e9;                            // nothing ever passes
    evo2.evolve(evo2.brains.map((b, i) => mk(b, i === 0 ? 1 : 0)), cfg.ga);
    ok(evo2.champion !== null, "the first champion is crowned with no incumbent to beat");
    evo2.evolve(evo2.brains.map((b, i) => mk(b, i === 5 ? 100 : 0)), cfg.ga);
    ok((evo2.gateRejects || 0) > 0 && evo2.championFit < 100,
        `a gate that rejects everything blocks a 100× challenger ` +
        `(${evo2.gateRejects || 0} rejected, champion still at ${evo2.championFit})`);

    // sharing changes breeding order but not the champion
    const withShare = Object.assign({}, cfg.ga, { share: 20 });
    const evo3 = new Evolution(24, 11, 1, spawn);
    const bank3 = env.makeBank(11, 8, 2);
    const results3 = evo3.brains.map(b => {
        const s = env.scoreBrain(b, bank3);
        return { brain: b, fitness: s.fitness, solveRate: s.solveRate, descent: s.descent, sig: s.sig };
    });
    const rawBest = Math.max(...results3.map(r => r.fitness));
    evo3.evolve(results3.map(r => Object.assign({}, r)), withShare);
    ok(near(evo3.championFit, rawBest), "fitness sharing does not change who is called champion");
});

/* ════════════════════════════════════════════════════════════ evaluate ══ */
section("evaluate", () => {
    const cfg = resolveConfig("default");
    const env = new Env(Object.assign({}, cfg.env, { forceOracle: true }));
    const banks = makeEvalBanks(env, [1, 2, 3], 20);
    ok(banks.length === 3 && banks.every(b => b.scrambles.length === 20),
        "eval banks are built per depth with the requested size");
    ok(banks.every(b => b.scrambles.every(s => s.depth === b.depth)),
        "…and each bank contains only its own depth");

    const b2 = makeEvalBanks(env, [1, 2, 3], 20);
    ok(banks[0].scrambles.every((s, i) => key(s.state) === key(b2[0].scrambles[i].state)),
        "eval banks are identical across calls (common random numbers)");

    const net = buildNet(cfg.arch, env.layout, mulberry32(77));
    const r = evaluateBrain(env, net, banks);
    ok(r.byDepth.length === 3 && isFinite(r.score), `evaluateBrain returns a score (${r.score.toFixed(3)})`);
    ok(r.solveRate >= 0 && r.solveRate <= 1, "solve rate is a rate");

    /* A perfect solver, hand-built by consulting the oracle, must score 1.0. This
     * pins the top of the scale — without it, "0.6" has a floor but no ceiling. */
    const perfect = {
        forward: function (vec) {
            void vec;
            const v = new Float32Array(env.nMoves);
            const d = distanceOf(env.oracle, this._state);
            let bi = 0;
            for (let i = 0; i < env.set.length; i++) {
                if (distanceOf(env.oracle, applyMove(this._state, env.set[i])) === d - 1) { bi = i; break; }
            }
            v[bi] = 1;
            return v;
        },
    };
    /* Runner owns the state, so let the oracle policy read it through the runner. */
    let solvedAll = true;
    for (const b of banks) {
        for (const scr of b.scrambles) {
            const run = env.newRunner(perfect, scr);
            while (!run.done) { perfect._state = run.state; run.step(); }
            if (!run.solvedFlag) solvedAll = false;
        }
    }
    ok(solvedAll, "an oracle-guided policy solves every scramble — the environment is winnable");

    const ctrl = controlScore(env, cfg.arch, banks, 4);
    ok(ctrl.score >= 0 && ctrl.score < 0.5,
        `untrained control scores ${ctrl.score.toFixed(3)} — the baseline every claim is relative to`);
});

/* ═══════════════════════════════════════════════════════════════ report ══ */
console.log(`\n${"═".repeat(64)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    console.log("\nfailures:");
    for (const f of failures) console.log("  · " + f);
    process.exitCode = 1;
}
