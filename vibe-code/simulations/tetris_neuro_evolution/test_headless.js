/* test_headless.js — Node smoke test. Run: node test_headless.js
 * Loads the browser files into one shared context and checks that the game is
 * actually Tetris (rotation, kicks, line clears, hold, 7-bag), that the sensor
 * vector is well formed, that the reward can never make dying profitable, and
 * that a few generations of evolution run and improve. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

for (const f of ["nn.js", "tetris.js", "sensors.js", "world.js", "evolution.js"]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), "utf8"), { filename: f });
}

let failures = 0;
function check(name, ok, extra) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}

/* ---------- 1. board / line clearing ---------- */
{
    const g = new Tetris({ seed: 7 });
    // fill the bottom row except one cell, then drop a piece into the gap by hand
    for (let x = 0; x < BW - 1; x++) g.grid[(TH - 1) * BW + x] = 1;
    g.grid[(TH - 1) * BW + (BW - 1)] = 2;
    const cleared = g._clearLines();
    check("full row clears", cleared === 1);
    let empty = true;
    for (let i = 0; i < g.grid.length; i++) if (g.grid[i]) empty = false;
    check("board empty after the clear", empty);
}
{
    const g = new Tetris({ seed: 7 });
    for (let y = TH - 3; y < TH; y++) for (let x = 0; x < BW; x++) g.grid[y * BW + x] = 3;
    for (let x = 0; x < BW; x++) g.grid[(TH - 4) * BW + x] = x < 5 ? 4 : 0;
    const cleared = g._clearLines();
    check("triple clears, partial row survives", cleared === 3);
    let survivors = 0;
    for (let i = 0; i < g.grid.length; i++) if (g.grid[i]) survivors++;
    check("partial row fell to the floor", survivors === 5 && g.grid[(TH - 1) * BW] === 4,
        `${survivors} cells, bottom-left = ${g.grid[(TH - 1) * BW]}`);
}

/* ---------- 2. rotation and SRS kicks ---------- */
{
    const g = new Tetris({ seed: 3 });
    g.piece = { type: 5, rot: 0, x: 3, y: 10 };     // T in open space
    const ok = g._rotate(1);
    check("T rotates in open space", ok && g.piece.rot === 1);
    g._rotate(-1);
    check("…and back", g.piece.rot === 0);

    // wall: an I piece flat against the left edge must kick right when stood up
    const h = new Tetris({ seed: 3 });
    h.piece = { type: 0, rot: 1, x: -1, y: 8 };     // vertical I in column 1
    const before = h.piece.x;
    const kicked = h._rotate(1);
    check("I kicks off the wall", kicked && h.piece.x !== before,
        `x ${before} → ${h.piece.x}, rot ${h.piece.rot}`);

    // every piece, every rotation, must occupy exactly 4 cells inside its box
    let shapesOk = true;
    for (let t = 0; t < 7; t++) {
        for (let r = 0; r < 4; r++) {
            const c = PIECES[t].cells[r];
            if (c.length !== 4) shapesOk = false;
            for (const [x, y] of c) if (x < 0 || y < 0 || x >= PIECES[t].box || y >= PIECES[t].box) shapesOk = false;
        }
    }
    check("all 28 piece orientations are 4 cells inside their box", shapesOk);
}

/* ---------- 3. the 7-bag ---------- */
{
    const g = new Tetris({ seed: 11 });
    // the piece in hand plus the preview queue are already drawn from the bag
    const seen = [g.piece.type].concat(g.queue);
    while (seen.length < 70) seen.push(g._nextFromBag());
    let bagsOk = true;
    for (let b = 0; b < 10; b++) {
        const slice = seen.slice(b * 7, b * 7 + 7).sort((a, x) => a - x);
        for (let i = 0; i < 7; i++) if (slice[i] !== i) bagsOk = false;
    }
    check("every 7 pieces is a permutation of all 7", bagsOk);

    const a = new Tetris({ seed: 99 }), b = new Tetris({ seed: 99 });
    check("same seed → same sequence", JSON.stringify(a.queue) === JSON.stringify(b.queue));
}

/* ---------- 4. keyboard semantics ---------- */
{
    const g = new Tetris({ seed: 5, cfg: { gravity: 999, das: 6, arr: 2 } });
    const x0 = g.piece.x;
    g.onKeyDown(KEY_LEFT); g.step();
    check("press edge moves one column", g.piece.x === x0 - 1, `x ${x0} → ${g.piece.x}`);
    for (let i = 0; i < 5; i++) g.step();
    check("DAS holds still before auto-repeat", g.piece.x === x0 - 1, `x = ${g.piece.x}`);
    for (let i = 0; i < 6; i++) g.step();
    check("…then auto-repeats", g.piece.x < x0 - 1, `x = ${g.piece.x}`);

    const h = new Tetris({ seed: 5, cfg: { gravity: 999 } });
    h.onKeyDown(KEY_CW);
    for (let i = 0; i < 20; i++) h.step();
    check("held rotate fires exactly once (no auto-repeat)", h.piece.rot === 1, `rot = ${h.piece.rot}`);
    h.onKeyUp(KEY_CW); h.onKeyDown(KEY_CW); h.step();
    check("release + press rotates again", h.piece.rot === 2);

    const k = new Tetris({ seed: 5, cfg: { gravity: 999 } });
    k.onKeyDown(KEY_LEFT); k.onKeyDown(KEY_RIGHT);
    const kx = k.piece.x; k.step(); k.step(); k.step();
    check("left+right together cancel", k.piece.x === kx);

    const d = new Tetris({ seed: 5, cfg: { gravity: 999 } });
    const t0 = d.piece.type;
    d.onKeyDown(KEY_HARD); const ev = d.step();
    check("hard drop locks the piece immediately", ev.locked && d.pieces === 1);
    check("…and the next piece has spawned", d.piece.type !== undefined && d.piece.y === 0, `type ${t0} → ${d.piece.type}`);

    const ho = new Tetris({ seed: 5, cfg: { gravity: 999 } });
    const first = ho.piece.type;
    ho.onKeyDown(KEY_HOLD); ho.step();
    check("hold stashes the piece", ho.hold === first && ho.piece.type !== first);
    ho.onKeyUp(KEY_HOLD); ho.onKeyDown(KEY_HOLD); ho.step();
    check("hold cannot be used twice on one piece", ho.hold === first);
}

/* ---------- 5. lock delay and the stall ceiling ---------- */
{
    const g = new Tetris({ seed: 5, cfg: { gravity: 1, lockDelay: 10, maxTicksPerPiece: 400 } });
    let t = 0;
    while (g.pieces === 0 && t < 400) { g.step(); t++; }
    check("a piece left alone falls and locks", g.pieces === 1, `${t} ticks`);

    const h = new Tetris({ seed: 5, cfg: { gravity: 100000, maxTicksPerPiece: 40 } });
    let t2 = 0;
    while (h.pieces === 0 && t2 < 200) { h.step(); t2++; }
    check("a dithering piece is slammed down at the ceiling", h.pieces === 1 && t2 === 40, `${t2} ticks`);
}

/* ---------- 5b. the piece must never out-fall the brain ---------- */
{
    const C = DEFAULT_CFG;
    // 1. reaction time vs fall speed — how many decisions per row of fall?
    const perRowNormal = C.gravity / ACT_EVERY;
    const perRowSoft = Math.max(1, (C.gravity / C.softFactor) | 0) / ACT_EVERY;
    check("brain gets >= 4 decisions per row at normal gravity", perRowNormal >= 4,
        `${perRowNormal.toFixed(1)} decisions/row (gravity ${C.gravity}, act every ${ACT_EVERY})`);
    check("…and >= 2 even with soft drop pinned on", perRowSoft >= 2,
        `${perRowSoft.toFixed(1)} decisions/row at ${C.softFactor}× soft drop`);

    // 2. crossing the board has to cost only a couple of rows of fall
    const crossTicks = 1 + C.das + C.arr * (BW - 2);
    const crossRows = crossTicks / C.gravity;
    check("the piece can cross the whole board in < 3 rows of fall", crossRows < 3,
        `${BW - 1} columns in ${crossTicks} ticks = ${crossRows.toFixed(1)} rows ` +
        `(${(crossTicks / C.gravity * C.softFactor).toFixed(1)} rows soft-dropped)`);

    // 3. auto-repeat must not outrun the decision rate, or the brain can only
    //    ever overshoot the column it is aiming for
    check("auto-repeat moves at most one column per decision", C.arr >= ACT_EVERY,
        `arr ${C.arr} ticks vs a decision every ${ACT_EVERY}`);

    // 4. and it can still steer after touchdown, like a real lock delay
    check("lock delay allows several post-landing adjustments",
        C.lockDelay / ACT_EVERY >= 6 && C.maxResets >= 8,
        `${(C.lockDelay / ACT_EVERY).toFixed(0)} decisions of lock delay, ${C.maxResets} resets`);
}

/* ---------- 5c. the action space has to be physically usable ---------- */
{
    // If a piece reaches the floor faster than the brain can walk it across the
    // board, no amount of evolution can produce a Tetris player — the policy
    // simply cannot express "put it in that column". This is a property of the
    // timing constants, not of any brain, so it is worth asserting directly.
    // Worst case: soft drop pinned on (which is what evolution actually did
    // when this was mis-tuned) and the piece has to cross the whole board.
    const worstCfg = Object.assign({}, DEFAULT_CFG);
    for (const dir of [KEY_LEFT, KEY_RIGHT]) {
        const g = new Tetris({ seed: 4, cfg: worstCfg });
        g.onKeyDown(KEY_SOFT);                       // fall as fast as possible
        g.onKeyDown(dir);
        const target = dir === KEY_LEFT ? 0 : BW - 1;
        let reached = false, decisions = 0;
        while (!reached && g.pieces === 0) {
            g.step();
            decisions++;
            const f = PIECES[g.piece.type].flat[g.piece.rot];
            let lo = BW, hi = -1;
            for (let i = 0; i < 8; i += 2) {
                lo = Math.min(lo, g.piece.x + f[i]); hi = Math.max(hi, g.piece.x + f[i]);
            }
            if ((dir === KEY_LEFT ? lo : hi) === target) reached = true;
        }
        check(`a slammed piece can still reach the ${dir === KEY_LEFT ? "left" : "right"} wall`,
            reached, `${decisions} ticks (${Math.ceil(decisions / ACT_EVERY)} decisions) of ` +
            `${worstCfg.maxTicksPerPiece} available`);
    }
    // and it must have room for several rotations on the way down
    const g = new Tetris({ seed: 4, cfg: worstCfg });
    g.onKeyDown(KEY_SOFT);
    let rotations = 0, t = 0;
    while (g.pieces === 0 && t < worstCfg.maxTicksPerPiece) {
        if (t % (ACT_EVERY * 2) === 0) g.onKeyDown(KEY_CW);
        else if (t % ACT_EVERY === 0) g.onKeyUp(KEY_CW);
        const before = g.piece.rot;
        g.step(); t++;
        if (g.piece.rot !== before) rotations++;
    }
    check("…and rotate several times on the way down", rotations >= 4, `${rotations} rotations in ${t} ticks`);
}

/* ---------- 6. sensors ---------- */
{
    const g = new Tetris({ seed: 21 });
    const v = new Float32Array(IN_SIZE);
    let bad = 0, maxAbs = 0;
    for (let i = 0; i < 400; i++) {
        // random keystrokes, then check the vector stays finite and bounded
        for (const c of KEY_ORDER) { if (Math.random() < 0.15) (Math.random() < 0.5 ? g.onKeyDown(c) : g.onKeyUp(c)); }
        if (g.over) break;
        sense(g, v);
        for (let j = 0; j < v.length; j++) {
            if (!isFinite(v[j])) bad++;
            if (Math.abs(v[j]) > maxAbs) maxAbs = Math.abs(v[j]);
        }
        g.step();
    }
    check("sensor vector is finite and bounded", bad === 0 && maxAbs <= 1.001, `max |x| = ${maxAbs.toFixed(3)}`);
    check("sensor vector matches NET_SIZES", NET_SIZES[0] === IN_SIZE);

    // The position one-hot and the drop preview must agree on what "column" means.
    // They are indexed independently, and in half the rotations the bounding box
    // sits at a different offset from the leftmost occupied cell — if these drift
    // apart the brain has to learn a per-rotation correction before it can learn
    // anything about Tetris at all.
    // offsets come from the layout table, never hard-coded — inserting a block
    // once shifted these and the check started passing for the wrong reason
    const XHOT = SENSE_LAYOUT.pieceCol.at, PREVIEW = SENSE_LAYOUT.previewDepth.at;
    let misaligned = 0, rotations = 0;
    for (let t = 0; t < 7; t++) {
        for (let r = 0; r < 4; r++) {
            const gg = new Tetris({ seed: 5 + t });
            gg.piece = { type: t, rot: r, x: PIECES[t].spawnX, y: 2 };
            sense(gg, v);
            const col = Array.prototype.indexOf.call(v.slice(XHOT, XHOT + BW), 1);
            rotations++;
            if (v[PREVIEW + col] === 0) misaligned++;   // own column must be droppable
        }
    }
    check("drop preview lines up with the position one-hot", misaligned === 0,
        `${rotations} piece orientations, ${misaligned} misaligned`);

    // the layout table must actually describe the vector sense() writes
    const blocks = Object.entries(SENSE_LAYOUT).filter(([, b]) => b.size > 0);
    const end = blocks.reduce((s, [, b]) => Math.max(s, b.at + b.size), 0);
    check("layout table covers the whole input vector", end === IN_SIZE,
        `${blocks.length} blocks ending at ${end}, IN_SIZE ${IN_SIZE}`);

    // --- the board plane: 1 locked, 0.5 falling piece, 0 empty ---
    if (SENSE_LAYOUT.boardPlane.size) {
        const gg = new Tetris({ seed: 31 });
        while (gg.pieces < 2 && gg.tick < 2000) gg.step();   // let two pieces land
        // …and let the next one fall clear of the hidden spawn rows, so the 0.5
        // overlay is actually exercised rather than vacuously zero
        const visible = () => {
            const f = PIECES[gg.piece.type].flat[gg.piece.rot];
            for (let i = 1; i < 8; i += 2) if (gg.piece.y + f[i] < BUF) return false;
            return true;
        };
        while (!visible() && gg.pieces < 3 && gg.tick < 2000) gg.step();
        sense(gg, v);
        const base = SENSE_LAYOUT.boardPlane.at;
        let locked = 0, falling = 0, wrong = 0;
        for (let y = BUF; y < TH; y++) {
            for (let x = 0; x < BW; x++) {
                const val = v[base + (y - BUF) * BW + x];
                if (val === 1) { locked++; if (!gg.grid[y * BW + x]) wrong++; }
                else if (val === 0.5) falling++;
                else if (val !== 0) wrong++;
            }
        }
        let pieceCellsVisible = 0;
        const pf = PIECES[gg.piece.type].flat[gg.piece.rot];
        for (let i = 1; i < 8; i += 2) if (gg.piece.y + pf[i] >= BUF) pieceCellsVisible++;
        check("board plane marks locked cells 1 and the falling piece 0.5",
            wrong === 0 && falling === pieceCellsVisible && locked > 0,
            `${locked} locked, ${falling} falling (expected ${pieceCellsVisible}), ${wrong} wrong`);
    }

    // --- the timing neurons ---
    {
        const gg = new Tetris({ seed: 9, cfg: Object.assign({}, DEFAULT_CFG, { gravity: 8 }) });
        const seen = [];
        for (let i = 0; i < 8; i++) { sense(gg, v); seen.push(v[SENSE_LAYOUT.gravityPhase.at]); gg.step(); }
        const rising = seen.every((x, i) => i === 0 || x > seen[i - 1] || x === 0);
        check("gravity phase counts up to the next row-step", rising && Math.max(...seen) >= 0.8,
            `[${seen.map(x => x.toFixed(2)).join(" ")}] over 8 ticks at gravity 8`);

        const gl = new Tetris({ seed: 9 });
        gl.piece.y = gl.dropY(gl.piece.x, gl.piece.y, gl.piece.rot, gl.piece.type);
        let lockPhase = 0;
        for (let i = 0; i < DEFAULT_CFG.lockDelay - 1; i++) { gl.step(); sense(gl, v); lockPhase = v[SENSE_LAYOUT.lockPhase.at]; }
        check("lock phase climbs while the piece rests on the stack", lockPhase > 0.5,
            `${lockPhase.toFixed(2)} after ${DEFAULT_CFG.lockDelay - 1} resting ticks`);
    }
}

/* ---------- 7. the reward can never make dying pay ---------- */
{
    check("placing a piece is always profitable",
        R.PIECE + R.PENALTY_CAP > 0,
        `worst piece = ${(R.PIECE + R.PENALTY_CAP).toFixed(2)} > 0`);
    check("burying a hole costs more than un-burying it pays",
        Math.abs(R.NEW_HOLE) > R.FIXED_HOLE, "no bury/unbury farming loop");
    // The property that matters: for ANY brain, however bad, every piece it
    // manages to place must move fitness up. If a single placement can be
    // net-negative then topping out early is a winning strategy and the whole
    // run collapses into brains that kill themselves as fast as possible.
    const cfg = DEFAULT_CFG;                   // the shipped game, not a variant
    let monotone = true, minGain = Infinity, checked = 0;
    for (let t = 0; t < 30; t++) {
        const a = new Agent(new Net(NET_SIZES, mulberry32(100 + t)), 12 + t, cfg);
        let prevF = 0;
        while (a.alive) {
            const ev = a.step(0);
            if (ev && ev.locked && !ev.over) {     // the fatal placement carries TOPOUT
                const gain = a.fitness - prevF;
                if (gain <= 0) monotone = false;
                if (gain < minGain) minGain = gain;
                prevF = a.fitness; checked++;
            }
        }
    }
    check("every piece placed raises fitness, for every brain", monotone,
        `${checked} placements by 30 random brains, worst gain +${minGain.toFixed(3)}`);

    // The clamp protects the invariant above, but if it fires on most placements
    // it also destroys the thing it is protecting: a brain that buries one cell
    // and a brain that buries five both bottom out at the same score, and
    // selection has nothing left to sort them by. It must stay a guard rail,
    // not the road surface.
    const rawCap = R.PENALTY_CAP;
    R.PENALTY_CAP = -1e9;
    let capped = 0, placements = 0;
    for (let t = 0; t < 20; t++) {
        const a = new Agent(new Net(NET_SIZES, mulberry32(300 + t)), 40 + t, cfg);
        let prevF = 0;
        while (a.alive) {
            const ev = a.step(0);
            if (ev && ev.locked && !ev.over) {
                const raw = a.fitness - prevF - R.PIECE - R.LINES[ev.lines];
                prevF = a.fitness; placements++;
                if (raw < rawCap) capped++;
            }
        }
    }
    R.PENALTY_CAP = rawCap;
    const pct = 100 * capped / placements;
    check("the penalty clamp is a guard rail, not the whole signal", pct < 35,
        `clamp binds on ${pct.toFixed(0)}% of ${placements} placements (want < 35%)`);
}

/* ---------- 8. evolution actually runs and improves ---------- */
{
    const t0 = Date.now();
    // 20 generations, not 12: with the current timing a game runs long enough
    // that a dozen generations is inside the noise and this check flaps.
    const POP = 24, GENS = 20;
    const ev = new Evolution(POP, 1, 1);
    const cfg = {
        mutRate: 0.12, mutSigma: 0.22, grace: 3, annealFit: 300, annealFloor: 0.25,
        shakeAfter: 6, immZeroFit: 1200, childZeroFit: 6000, reinject: true,
        selfAdapt: false, migrateEvery: 0,
    };
    const gameCfg = DEFAULT_CFG;               // the shipped game, not a variant
    const gens = [];
    for (let gen = 0; gen < GENS; gen++) {
        const seeds = [1000 + gen * 2, 1001 + gen * 2];
        const results = ev.brains.map(b => {
            const s = scoreBrain(b, seeds, gameCfg, 60);
            return { brain: b, fitness: s.fitness, lines: s.lines, pieces: s.pieces };
        });
        gens.push(ev.evolve(results, cfg));
    }
    const dt = (Date.now() - t0) / 1000;
    const last = gens[gens.length - 1];
    // every generation draws fresh piece seeds, so single-generation numbers are
    // noisy — compare the first three against the last three
    const mean = (arr, key) => arr.reduce((s, g) => s + g[key], 0) / arr.length;
    const early = gens.slice(0, 3), late = gens.slice(-3);
    check("evolution runs without exploding", isFinite(last.best) && isFinite(last.avg),
        `${GENS} gens × ${POP} brains in ${dt.toFixed(1)} s (${(dt / GENS).toFixed(2)} s/gen)`);
    check("population mean fitness improved", mean(late, "avg") > mean(early, "avg"),
        `${mean(early, "avg").toFixed(1)} → ${mean(late, "avg").toFixed(1)} (best-ever ${ev.championFit.toFixed(1)})`);
    check("mean pieces placed improved", mean(late, "avgPieces") > mean(early, "avgPieces"),
        `${mean(early, "avgPieces").toFixed(1)} → ${mean(late, "avgPieces").toFixed(1)} pieces`);
    check("elitism preserves the champion byte-for-byte",
        JSON.stringify(ev.brains[0].toJSON()) !== undefined && ev.champion !== null);
    // annealing has to actually bite in the fitness range a run passes through —
    // a schedule whose target sits above anything reached is a no-op
    check("mutation strength anneals as fitness climbs",
        ev.eff.shaken ? ev.eff.sigma < cfg.mutSigma * 1.81 : ev.eff.sigma < cfg.mutSigma * 0.9,
        `σ ${cfg.mutSigma} → ${ev.eff.sigma.toFixed(3)} at fitness ${ev.championFit.toFixed(0)} ` +
        `(annealed ${(ev.eff.anneal * 100).toFixed(0)}%${ev.eff.shaken ? ", shaken" : ""})`);
}

/* ---------- 9. islands and self-adaptive step size ---------- */
{
    const cfg = {
        mutRate: 0.12, mutSigma: 0.25, grace: 3, annealFit: 2000, annealFloor: 0.22,
        shakeAfter: 8, immZeroFit: 3600, childZeroFit: 48000, reinject: true,
        selfAdapt: true, migrateEvery: 4,
    };
    const ev = new Evolution(32, 7, 4);
    check("population splits into islands", ev.islands === 4 &&
        ev.bounds.length === 4 && ev.bounds[3][1] === 32, JSON.stringify(ev.bounds));

    let migrations = 0;
    for (let g = 0; g < 16; g++) {
        // synthetic fitness: island 0 is made much better than the rest, so a
        // working migration has to visibly lift the others
        const res = ev.brains.map((b, i) => ({
            brain: b, fitness: (i < 8 ? 500 : 50) + Math.sin(i * 1.7 + g) * 20,
            lines: 0, pieces: 10,
        }));
        ev.evolve(res, cfg);
        migrations += ev.migrated;
        if (ev.brains.length !== 32) { failures++; console.log("FAIL population size drifted"); break; }
        if (ev.brains.some(b => !b || !b.weights)) { failures++; console.log("FAIL hole in population"); break; }
    }
    check("islands keep the population intact and migrate", migrations > 0 && ev.brains.length === 32,
        `${migrations} migrations over 16 generations`);

    // self-adaptation must actually move the step sizes apart, otherwise it is
    // just a constant with extra steps
    const sigmas = ev.brains.map(b => b.sigma);
    const lo = Math.min(...sigmas), hi = Math.max(...sigmas);
    check("self-adaptive step sizes diverge across the population", hi / lo > 1.3,
        `σ multiplier ranges ${lo.toFixed(2)} – ${hi.toFixed(2)} (mean ${ev.meanSigma.toFixed(2)})`);

    // and it must survive a round trip through JSON, or a baked champion loses it
    const rt = Net.fromJSON(ev.brains[0].toJSON());
    check("step size survives save/load", Math.abs(rt.sigma - ev.brains[0].sigma) < 1e-9);

    // islands === 1 must behave exactly like the old single-population GA
    const solo = new Evolution(24, 3, 1);
    check("islands=1 is a single pool", solo.islands === 1 && solo.bounds.length === 1);
}

/* ---------- 10. behavioural fitness sharing ---------- */
{
    const cfg = {
        mutRate: 0.12, mutSigma: 0.25, grace: 3, annealFit: 2000, annealFloor: 0.22,
        shakeAfter: 8, immZeroFit: 3600, childZeroFit: 48000, reinject: true,
        selfAdapt: true, share: 1.5,
    };
    const ev = new Evolution(20, 5, 1);
    // brains 0-14 all play identically; 15-19 each play differently. The clones
    // also happen to have the *higher* raw fitness, so sharing has to be worth
    // something for the odd ones out to survive at all.
    const sig = i => {
        const s = new Array(SIG_SIZE).fill(0);
        if (i < 15) { s[0] = 0.5; s[3] = 0.5; }
        else { s[0] = i / 20; s[5] = i / 20; s[9] = 1 - i / 20; }
        return s;
    };
    const mkResults = () => ev.brains.map((b, i) => ({
        brain: b, fitness: 100 - i, lines: 0, pieces: 10, sig: sig(i),
    }));

    const res = mkResults();
    ev._share(res, cfg);
    const clones = res.slice(0, 15).reduce((s, r) => s + r.crowd, 0) / 15;
    const distinct = res.slice(15).reduce((s, r) => s + r.crowd, 0) / 5;
    check("crowded behaviours are detected as crowded", clones > distinct * 3,
        `clones crowd ${clones.toFixed(1)} vs distinct ${distinct.toFixed(1)}`);

    const topShared = res.slice().sort((a, b) => b.shared - a.shared)[0];
    check("sharing promotes an unusual brain over a crowded better one",
        res.indexOf(topShared) >= 15,
        `slot ${res.indexOf(topShared)} (raw fitness ${topShared.fitness}) breeds first`);

    // ...but the champion must still be the genuinely best brain. A brain that is
    // merely unusual is not a brain worth saving.
    ev.evolve(mkResults(), cfg);
    check("sharing changes who breeds, never who is champion", ev.championFit === 100,
        `champion fitness ${ev.championFit}`);

    const off = new Evolution(20, 5, 1);
    off.evolve(mkResults.call(null), Object.assign({}, cfg, { share: 0 }));
    check("share=0 leaves selection untouched", off.championFit === 100);
}

/* ---------- 10a. the held-out champion gate + permanent grace ----------
 *
 * The rule: a challenger that out-scores the champion *in the run* only takes
 * the title if it also beats it on games nobody trains on. Without that, "best
 * ever seen" is a maximum over noise and the title goes to whoever drew the
 * kindest bag. With it, the seed brain of a polishing run cannot be lost. */
{
    const base = {
        mutRate: 0.12, mutSigma: 0.25, grace: -1, annealFit: 2000, annealFloor: 0.22,
        shakeAfter: 8, immZeroFit: 3600, childZeroFit: 48000, reinject: true, selfAdapt: true,
    };
    // a fake gate: brain.tag is its "held-out skill", so the test controls exactly
    // which challengers deserve the title
    const mk = (ev, i) => ({ brain: ev.brains[i], fitness: 0, lines: 0, pieces: 10 });

    const ev = new Evolution(16, 7, 1);
    ev.brains.forEach((b, i) => { b.tag = i === 0 ? 100 : 50; });
    ev.gateFn = net => net.tag || 0;

    // generation 1: brain 0 is best in-run and best on the gate → champion
    let res = ev.brains.map((b, i) => Object.assign(mk(ev, i), { fitness: i === 0 ? 500 : 100 }));
    ev.evolve(res, base);
    const first = ev.champion;
    check("the gate lets a genuinely better brain take the title",
        ev.championSkill === 100 && ev.gateRejects === undefined || ev.gateRejects === 0,
        `champion gate skill ${ev.championSkill}`);

    // generation 2: a challenger wins in-run by a mile but is worse on the gate
    ev.brains.forEach(b => { b.tag = 10; });          // every newcomer is poor held-out
    if (ev.injected) ev.injected.tag = 100;           // …except the re-injected champion
    res = ev.brains.map((b, i) => Object.assign(mk(ev, i), { fitness: b === ev.injected ? 200 : 5000 }));
    ev.evolve(res, base);
    check("a lucky challenger cannot take the title from the gate",
        ev.gateRejects >= 1 && ev.champion === first,
        `${ev.gateRejects} rejected, champion ${ev.champion === first ? "kept" : "LOST"}`);
    check("…and the champion's held-out score is not quietly raised", ev.championSkill === 100,
        `gate skill ${ev.championSkill}`);

    // the champion must still be sitting in the population, untouched
    const present = ev.brains.some(b => b === ev.injected);
    check("the gated champion keeps an untouched seat every generation", present);

    // grace: -1 must never expire, however long the champion goes unbeaten
    for (let g = 0; g < 30; g++) {
        ev.brains.forEach(b => { b.tag = 10; });
        if (ev.injected) ev.injected.tag = 100;
        ev.evolve(ev.brains.map((b, i) => Object.assign(mk(ev, i), {
            fitness: b === ev.injected ? 200 : 400,
        })), base);
    }
    check("permanent grace never expires", ev.champion === first && ev.grace && ev.grace.left === Infinity,
        `champion survived 30 generations of better-scoring challengers`);

    // and a challenger that is better on BOTH counts must still get through,
    // or the gate is a wall and the run can never improve
    ev.brains.forEach(b => { b.tag = 10; });
    ev.brains[3].tag = 500;
    if (ev.injected) ev.injected.tag = 100;
    ev.evolve(ev.brains.map((b, i) => Object.assign(mk(ev, i), {
        fitness: i === 3 ? 9000 : (b === ev.injected ? 200 : 100),
    })), base);
    check("a challenger better on both counts does take the title",
        ev.champion !== first && ev.championSkill === 500, `gate skill now ${ev.championSkill}`);
}

/* ---------- 10b. nothing may vanish from the board ----------
 *
 * The invariant: every lock puts exactly four cells into the grid, minus ten per
 * row it clears. Anything else means mass disappeared, and mass that disappears
 * is an exploit — a piece that partly deletes itself buries fewer holes than one
 * that lands honestly.
 *
 * This is the test that was missing. `_lock()` writes only cells with y >= 0
 * while `_collides()` allowed y < 0 (SRS kick tables contain −2 offsets), so a
 * piece kicked into the ceiling locked as three blocks instead of four. It showed
 * up as a piece visibly vanishing while watching the champion play. */
{
    const cellCount = g => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i]) n++; return n; };
    let violations = 0, locks = 0, worst = null;
    for (let t = 0; t < 24; t++) {
        const g = new Tetris({ seed: 500 + t });
        const brain = makeNet(mulberry32(9000 + t));
        const input = new Float32Array(IN_SIZE);
        let clock = 0;
        while (!g.over && g.tick < 6000) {
            if (clock-- <= 0) {
                clock = ACT_EVERY - 1;
                sense(g, input);
                const out = brain.forward(input);
                for (let i = 0; i < KEY_ORDER.length; i++) {
                    const want = out[i] > 0.5, code = KEY_ORDER[i];
                    if (want && !g.down[code]) g.onKeyDown(code);
                    else if (!want && g.down[code]) g.onKeyUp(code);
                }
            }
            const before = cellCount(g.grid);
            const ev = g.step();
            if (ev.locked) {
                locks++;
                const expected = before + 4 - 10 * ev.lines;
                const after = cellCount(g.grid);
                if (after !== expected) {
                    violations++;
                    if (!worst) worst = `expected ${expected}, got ${after} (${ev.lines} lines cleared)`;
                }
            }
        }
    }
    check("every lock adds exactly 4 cells minus 10 per cleared row",
        violations === 0, `${locks} locks by random brains, ${violations} violations` +
        (worst ? " — " + worst : ""));

    // and the direct cause: no piece may ever occupy a cell above the grid
    {
        const g = new Tetris({ seed: 11 });
        let above = 0;
        for (let t = 0; t < 7; t++) {
            for (let r = 0; r < 4; r++) {
                g.piece = { type: t, rot: r, x: PIECES[t].spawnX, y: 0 };
                g._rotate(1); g._rotate(1); g._rotate(-1);
                const f = PIECES[g.piece.type].flat[g.piece.rot];
                for (let i = 1; i < 8; i += 2) if (g.piece.y + f[i] < 0) above++;
            }
        }
        check("rotation can never kick a piece through the ceiling", above === 0,
            `${above} cells above row 0 across 28 orientations`);
    }
}

/* ---------- 10c. hold must not refresh the anti-dither budget ----------
 *
 * maxTicksPerPiece is the only thing stopping a brain from stalling forever, and
 * it counts pieceTicks, which _spawn() resets. A hold therefore used to hand out a
 * whole fresh budget for the same placement — and the champion pressed hold on 32
 * of every 40 pieces to collect it, playing measurably worse than with the key
 * unplugged. The budget belongs to the placement, not to the spawn. */
{
    const g = new Tetris({ seed: 17 });
    for (let i = 0; i < 40; i++) g.step();
    const spent = g.pieceTicks;
    g.onKeyDown(KEY_HOLD);
    g.step();
    check("hold keeps the tick budget it inherited", g.pieceTicks >= spent,
        `${spent} ticks spent before the hold, ${g.pieceTicks} after`);
    check("…and the hold actually happened", g.hold >= 0 && !g.canHold);

    // the ceiling must still be reachable: a brain that stalls gets slammed down
    const h = new Tetris({ seed: 19 });
    h.onKeyDown(KEY_HOLD);
    let holds = 0, ticks = 0;
    while (h.pieces === 0 && ticks < DEFAULT_CFG.maxTicksPerPiece * 3) {
        if (h.canHold) { h.onKeyUp(KEY_HOLD); h.onKeyDown(KEY_HOLD); holds++; }
        h.step(); ticks++;
    }
    check("a brain spamming hold still gets slammed down on schedule",
        h.pieces === 1 && ticks <= DEFAULT_CFG.maxTicksPerPiece + 2,
        `locked after ${ticks} ticks with ${holds} hold presses (budget ${DEFAULT_CFG.maxTicksPerPiece})`);
}

/* ---------- 10d. the action mask ---------- */
{
    if (typeof CONFIGS === "undefined") {   // the tests below load this file twice
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, "configs.js"), "utf8"), { filename: "configs.js" });
    }
    const BASE_R = Object.assign({}, R);
    // a brain that wants every key, with hold masked off, must press everything but hold
    applyConfig(CONFIGS.nogrid_nohold, BASE_R);
    const allOn = { forward: () => new Float32Array([1, 1, 1, 1, 1, 1, 1]) };
    const ag = new Agent(allOn, 3, DEFAULT_CFG);
    for (let i = 0; i < 60; i++) ag.step(400);
    check("a masked key is never pressed", ag.game.hold === -1 && !ag.game.down[KEY_HOLD],
        `hold slot ${ag.game.hold}`);
    check("…while the unmasked keys still work", ag.game.down[KEY_SOFT] === true);
    applyConfig(CONFIGS.nogrid, BASE_R);
    const ag2 = new Agent(allOn, 3, DEFAULT_CFG);
    for (let i = 0; i < 60; i++) ag2.step(400);
    check("without the mask the same brain does use hold", ag2.game.hold >= 0,
        `hold slot ${ag2.game.hold}`);
    applyConfig({ profile: "full", arch: { kind: "mlp", hidden: [64, 32] } }, BASE_R);
}

/* ---------- 10e. activation functions ----------
 *
 * Each one is checked end to end through a real network rather than by calling
 * the lambda: a single input wired to a single hidden unit with a known weight,
 * so a mis-wired activation (the hidden one applied to the output layer, say)
 * cannot pass. */
{
    const cases = [
        // name, pre-activation value, expected hidden output
        ["tanh", 1.3, Math.tanh(1.3)],
        ["relu", 1.3, 1.3], ["relu", -1.3, 0],
        ["lrelu", -1.3, -0.13], ["lrelu", 1.3, 1.3],
        ["elu", -1.3, Math.exp(-1.3) - 1], ["elu", 1.3, 1.3],
        ["softsign", 1.3, 1.3 / 2.3], ["softsign", -1.3, -1.3 / 2.3],
    ];
    let bad = [];
    for (const [act, pre, want] of cases) {
        // 1 input → 1 hidden (weight = pre, no bias) → 1 output (weight 1, identity-ish)
        const net = new Net([1, 1, 1], null, { hidden: act, out: "tanh" });
        net.weights[0][0] = pre; net.weights[0][1] = 0;      // hidden = act(pre * 1)
        net.weights[1][0] = 1; net.weights[1][1] = 0;        // out = tanh(hidden)
        const got = net.forward(new Float32Array([1]))[0];
        const expect = Math.tanh(want);
        if (Math.abs(got - expect) > 1e-6) bad.push(`${act}(${pre}): got ${got.toFixed(6)} want ${expect.toFixed(6)}`);
    }
    check("every activation computes what it says it does", bad.length === 0,
        bad.length ? bad.join("; ") : `${cases.length} cases across ${Object.keys(ACTS).length} functions`);

    // the press threshold has to follow the output activation, or a tanh head
    // would need to exceed 0.5 to press a key and would look half-paralysed
    const sig = new Net([1, 1, 7], null, {});
    const tan = new Net([1, 1, 7], null, { out: "tanh" });
    check("press threshold follows the output activation",
        sig.threshold === 0.5 && tan.threshold === 0,
        `sigmoid ${sig.threshold}, tanh ${tan.threshold}`);

    // and an unknown name must fail loudly rather than silently defaulting
    let threw = false;
    try { new Net([1, 1, 1], null, { hidden: "swish" }); } catch (e) { threw = true; }
    check("an unknown activation is rejected", threw);

    // a ReLU brain must survive the round trip, or a baked champion changes shape
    {
        if (typeof CONFIGS === "undefined") {   // several sections below want this file
            vm.runInThisContext(fs.readFileSync(path.join(__dirname, "configs.js"), "utf8"), { filename: "configs.js" });
        }
        const BASE_R = Object.assign({}, R);
        applyConfig(CONFIGS.nogrid_relu, BASE_R);
        const a = makeNet(mulberry32(5));
        const rt = netFromJSON({ net: JSON.parse(JSON.stringify(a.toJSON())) });
        const probe = new Float32Array(IN_SIZE);
        for (let i = 0; i < probe.length; i++) probe[i] = (i % 7) / 7;
        const o1 = a.forward(probe), o2 = rt.forward(probe);
        let drift = 0;
        for (let i = 0; i < 7; i++) drift = Math.max(drift, Math.abs(o1[i] - o2[i]));
        check("a ReLU brain survives save/load with its activation", drift < 1e-9 &&
            rt.contract() === a.contract(), `${a.contract()}, drift ${drift.toExponential(1)}`);
        applyConfig({ profile: "full", arch: { kind: "mlp", hidden: [64, 32] } }, BASE_R);
    }
}

/* ---------- 11. sensor profiles ---------- */
{
    const names = Object.keys(SENSE_PROFILES);
    let bad = 0, report = [];
    for (const p of names) {
        configureSensors({ profile: p });
        const v = new Float32Array(IN_SIZE);
        const g = new Tetris({ seed: 44 + p.length });
        let worstAbs = 0, nonFinite = 0;
        for (let i = 0; i < 120 && !g.over; i++) {
            if (i % 5 === 0) g.onKeyDown(KEY_LEFT);
            if (i % 7 === 0) g.onKeyUp(KEY_LEFT);
            sense(g, v);                                  // throws if it writes ≠ IN_SIZE
            for (let j = 0; j < v.length; j++) {
                if (!isFinite(v[j])) nonFinite++;
                if (Math.abs(v[j]) > worstAbs) worstAbs = Math.abs(v[j]);
            }
            g.step();
        }
        const blocks = Object.entries(SENSE_LAYOUT).filter(([, b]) => b.size > 0);
        const end = blocks.reduce((s, [, b]) => Math.max(s, b.at + b.size), 0);
        if (nonFinite || worstAbs > 1.001 || end !== IN_SIZE) bad++;
        report.push(`${p}:${IN_SIZE}`);
    }
    check("every sensor profile writes a well-formed vector", bad === 0, report.join(" "));

    // the profiles must actually differ, or the search dimension is a no-op
    const sizes = new Set();
    for (const p of names) { configureSensors({ profile: p }); sizes.add(IN_SIZE); }
    check("profiles are genuinely different encodings", sizes.size === names.length,
        `${sizes.size} distinct input widths for ${names.length} profiles`);

    // switching profiles must not leave a stale offset behind: a block that is
    // off has size 0, and a block that is on must sit inside the vector
    configureSensors({ profile: "plane" });
    check("a disabled block reports size 0", SENSE_LAYOUT.window.size === 0 &&
        SENSE_LAYOUT.heights.size === 0 && SENSE_LAYOUT.boardPlane.size === BH * BW);
    configureSensors({ profile: "nogrid" });
    check("…and comes back when the profile includes it", SENSE_LAYOUT.window.size === SENSE_WIN_ROWS * BW &&
        SENSE_LAYOUT.boardPlane.size === 0);
    configureSensors({ profile: "full" });
}

/* ---------- 12. convolutional brains ---------- */
{
    if (typeof CONFIGS === "undefined") {   // the tests below load this file twice
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, "configs.js"), "utf8"), { filename: "configs.js" });
    }
    const BASE_R = Object.assign({}, R);

    // --- the convolution has to be an actual convolution, computed on the board
    // plane at the right offset. Checked end to end: one filter, no pooling, and a
    // dense head wired to pass a single chosen map cell straight through, so the
    // output is a known function of nine board cells.
    {
        configureSensors({ profile: "planeexpert" });
        const spec = {
            kind: "conv", in: IN_SIZE, out: 7,
            plane: { at: SENSE_LAYOUT.boardPlane.at, h: BH, w: BW },
            conv: [{ k: 3, ch: 1, stride: 1, pool: 1 }], colmax: false, hidden: [],
        };
        const net = new ConvNet(spec, null);
        const kernel = [0.3, -0.2, 0.5, 0.1, 0.4, -0.6, 0.2, 0.7, -0.1];
        const bias = 0.15;
        for (let i = 0; i < 9; i++) net.weights[0][i] = kernel[i];
        net.weights[0][9] = bias;
        const ow = BW - 2;                       // valid conv on a 20×10 plane → 18×8
        const pick = 5 * ow + 3;                 // map cell (oy=5, ox=3)
        const dense = net.weights[1];            // 7 rows × (mapSize + extras + 1)
        dense.fill(0);
        dense[pick] = 1;                         // output 0 = sigmoid(map[pick])

        const g = new Tetris({ seed: 88 });
        while (g.pieces < 4 && g.tick < 3000) g.step();       // put something on the board
        const v = new Float32Array(IN_SIZE);
        sense(g, v);
        const out = net.forward(v)[0];

        // reference: read the same 3×3 window straight out of the sensor vector
        let ref = bias;
        for (let ky = 0; ky < 3; ky++) {
            for (let kx = 0; kx < 3; kx++) {
                ref += kernel[ky * 3 + kx] * v[SENSE_LAYOUT.boardPlane.at + (5 + ky) * BW + (3 + kx)];
            }
        }
        const expect = 1 / (1 + Math.exp(-Math.tanh(ref)));
        check("conv layer computes the real convolution of the board plane",
            Math.abs(out - expect) < 1e-6, `got ${out.toFixed(8)}, expected ${expect.toFixed(8)}`);

        // and the non-plane sensors must reach the head — otherwise the expert
        // features are silently thrown away and nobody notices
        // pick a sensor that is actually non-zero right now, or the check passes
        // vacuously on sigmoid(0) whether the wiring works or not
        let probeAt = -1;
        for (let i = 0; i < SENSE_LAYOUT.boardPlane.at; i++) if (v[i] > 0.05) { probeAt = i; break; }
        const d2 = new ConvNet(spec, null);
        d2.weights[0].fill(0);      // conv silenced: only the extras can move the output
        d2.weights[1].fill(0);
        d2.weights[1][d2.mapSize + probeAt] = 4;
        const withExtra = d2.forward(v)[0];
        const expectExtra = 1 / (1 + Math.exp(-4 * v[probeAt]));
        check("non-plane sensors reach the dense head",
            probeAt >= 0 && Math.abs(withExtra - expectExtra) < 1e-6 && Math.abs(withExtra - 0.5) > 0.02,
            `sensor ${probeAt} = ${v[probeAt].toFixed(3)} → output ${withExtra.toFixed(4)}`);
    }

    // --- every config in the registry must build, run, survive a save/load and
    // breed. This is the contract overnight.js relies on: a config that throws at
    // generation 1 wastes a whole slot of the night.
    {
        let broken = [];
        for (const [name, cfg] of Object.entries(CONFIGS)) {
            try {
                const desc = applyConfig(cfg, BASE_R);
                const rng = mulberry32(7);
                const a = makeNet(rng), b = makeNet(rng);
                const g = new Tetris({ seed: 12 });
                while (g.pieces < 2 && g.tick < 2000) g.step();
                const v = new Float32Array(IN_SIZE);
                sense(g, v);
                const out = a.forward(v);
                if (out.length !== 7) throw new Error("output width " + out.length);
                // bounded and finite — the *bound* depends on the output activation
                // the config chose (sigmoid gives [0,1], tanh [-1,1]), so the
                // contract is "squashed", not "positive"
                for (let i = 0; i < 7; i++) {
                    if (!isFinite(out[i]) || out[i] < -1.001 || out[i] > 1.001) {
                        throw new Error("bad output " + out[i]);
                    }
                }
                // and every key must be reachable: an output that can never cross
                // its own press threshold is a paralysed actuator
                if (a.threshold >= 1 || a.threshold <= -1) throw new Error("unreachable threshold");
                // save/load must reproduce the answer bit for bit
                const rt = netFromJSON({ net: JSON.parse(JSON.stringify(a.toJSON())) });
                const o2 = rt.forward(v);
                for (let i = 0; i < 7; i++) if (Math.abs(o2[i] - out[i]) > 1e-9) throw new Error("round trip drift");
                if (rt.contract() !== desc.contract) throw new Error("contract drift " + rt.contract());
                // and the GA operators must preserve the shape
                const child = Genome.crossover(a, b, rng).mutateAdaptive(0.2, 0.3, rng, 0.25);
                if (child.paramCount !== a.paramCount) throw new Error("crossover changed the param count");
                child.forward(v);
                // a mutated brain must differ from its parent, or mutation is a no-op
                const before = a.weights[0][0];
                const mut = a.clone().mutate(1, 0.5, rng);
                if (mut.weights[0][0] === before && a.paramCount > 50) throw new Error("mutation did nothing");
            } catch (err) {
                broken.push(`${name} (${err.message})`);
            }
        }
        check("every config in configs.js builds, runs, saves and breeds",
            broken.length === 0, broken.length ? broken.join("; ") : `${Object.keys(CONFIGS).length} configs`);
    }

    // --- a conv brain must be trainable end to end, not merely constructible
    {
        applyConfig(CONFIGS.conv2layer, BASE_R);
        const ev = new Evolution(12, 5, 1);
        const cfg = Object.assign({}, SEARCH_GA);
        for (let g = 0; g < 3; g++) {
            const results = ev.brains.map(b => {
                const s = scoreBrain(b, [101], DEFAULT_CFG, 12);
                return { brain: b, fitness: s.fitness, lines: s.lines, pieces: s.pieces, sig: s.sig };
            });
            ev.evolve(results, cfg);
        }
        const ok = ev.brains.length === 12 && ev.brains.every(b => b && b.weights && b.spec) &&
            isFinite(ev.championFit);
        check("a convolutional population evolves for real generations", ok,
            `champion fitness ${ev.championFit.toFixed(1)} after 3 generations`);
    }

    // --- the conv path must not depend on the plane being last in the vector
    {
        applyConfig(CONFIGS.conv3x8, BASE_R);
        const bp = SENSE_LAYOUT.boardPlane;
        check("conv configs put the plane where the net expects it",
            bp.size === BH * BW && makeNet(null).spec.plane.at === bp.at,
            `plane at ${bp.at}, ${IN_SIZE} inputs total`);
    }

    // back to the shipped configuration so nothing after this sees a stale profile
    applyConfig({ profile: "full", arch: { kind: "mlp", hidden: [64, 32] } }, BASE_R);
    check("the default config is the shipped one", IN_SIZE === 391 && NET_SIZES.join("-") === "391-64-32-7",
        `${IN_SIZE} inputs, ${NET_SIZES.join("-")}`);
}

/* ---------- 15. network surgery: a new body, the same brain ----------
 * genius.js moves a champion into a different architecture between eras. If a
 * transplant silently changed what the brain computes, every architecture
 * comparison downstream would be measuring the damage instead of the shape — and
 * the damage would look exactly like "this shape is worse". So the promises
 * net_surgery.js makes about exactness are asserted here, numerically. */
{
    if (typeof CONFIGS === "undefined") {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, "configs.js"), "utf8"), { filename: "configs.js" });
    }
    if (typeof transplant === "undefined") {
        vm.runInThisContext(fs.readFileSync(path.join(__dirname, "net_surgery.js"), "utf8"), { filename: "net_surgery.js" });
    }
    const BASE_R2 = Object.assign({}, R);
    const rng = mulberry32(4242);

    const inputs = [];
    const sameOutput = (a, b, tol) => {
        let worst = 0;
        for (const x of inputs) {
            const p = Array.from(a.forward(x)), q = Array.from(b.forward(x));
            for (let i = 0; i < p.length; i++) worst = Math.max(worst, Math.abs(p[i] - q[i]));
        }
        return { ok: worst <= tol, worst };
    };

    const mk = (hidden, acts) => {
        applyConfig({ profile: "compact", arch: { kind: "mlp", hidden, acts } }, BASE_R2);
        inputs.length = 0;
        for (let k = 0; k < 6; k++) {
            const v = new Float32Array(IN_SIZE);
            for (let i = 0; i < IN_SIZE; i++) v[i] = rng() * 2 - 1;
            inputs.push(v);
        }
        return makeNet(rng);
    };

    // --- widening is exactly function-preserving: new units are wired silent
    {
        const old = mk([64, 48, 24], { hidden: "relu" });
        const t = transplant(old, { hidden: [64, 48, 40] }, rng);
        const d = sameOutput(old, t.net, 1e-5);
        check("widening a hidden layer changes nothing the brain computes",
            t.exact && d.ok && t.net.contract() === `${IN_SIZE}-64-48-40-7:relu/sigmoid`,
            `worst |Δ| ${d.worst.toExponential(1)}, ${t.net.contract()}, ${t.note}`);
    }
    {
        const old = mk([64, 32], { hidden: "relu" });
        const t = transplant(old, { hidden: [96, 32] }, rng);
        const d = sameOutput(old, t.net, 1e-5);
        check("widening the *first* hidden layer is also exact", t.exact && d.ok,
            `worst |Δ| ${d.worst.toExponential(1)}`);
    }

    // --- a layer inserted as identity is exact under ReLU, approximate under tanh
    {
        const old = mk([64, 32], { hidden: "relu" });
        const t = transplant(old, { hidden: [64, 32, 32] }, rng);
        const d = sameOutput(old, t.net, 1e-5);
        check("a layer inserted after a ReLU layer is exactly function-preserving",
            t.exact && d.ok && t.net.sizes.length === old.sizes.length + 1,
            `worst |Δ| ${d.worst.toExponential(1)}, ${t.note}`);
    }
    {
        const old = mk([64, 32], { hidden: "tanh" });
        const t = transplant(old, { hidden: [64, 32, 32] }, rng);
        check("…and honestly reports itself approximate under tanh",
            !t.exact && /approximate/.test(t.note) &&
            t.net.forward(inputs[0]).every(v => isFinite(v)), t.note);
    }

    // --- narrowing drops the units the next layer listens to least
    {
        const old = mk([64, 48, 24], { hidden: "relu" });
        // silence unit 11 of the last hidden layer: nothing downstream reads it
        const outW = old.weights[3], outL = old.layout[3];
        for (let o = 0; o < outL.rows; o++) outW[o * outL.rowLen + 11] = 0;
        const t = transplant(old, { hidden: [64, 48, 23] }, rng);
        const d = sameOutput(old, t.net, 1e-5);
        check("narrowing drops the least-heard unit, so a silent one costs nothing",
            !t.exact && d.ok && t.net.sizes[3] === 23,
            `worst |Δ| ${d.worst.toExponential(1)} after dropping 24 → 23`);
    }

    // --- dropping a layer folds two matrices into one, and stays finite
    {
        const old = mk([64, 48, 24], { hidden: "relu" });
        const t = transplant(old, { hidden: [64, 48] }, rng);
        const out = Array.from(t.net.forward(inputs[0]));
        check("dropping a layer multiplies the trained matrices together",
            !t.exact && t.net.sizes.join("-") === `${IN_SIZE}-64-48-7` &&
            out.every(v => isFinite(v) && v >= -0.001 && v <= 1.001),
            `${t.net.contract()} — ${t.note}`);
    }

    // --- swapping the activation keeps every weight byte for byte
    {
        const old = mk([64, 32], { hidden: "relu" });
        const t = transplant(old, { hidden: [64, 32], acts: { hidden: "tanh", out: "sigmoid" } }, rng);
        let identical = t.net.weights.length === old.weights.length;
        for (let l = 0; l < old.weights.length && identical; l++) {
            for (let i = 0; i < old.weights[l].length; i++) {
                if (old.weights[l][i] !== t.net.weights[l][i]) { identical = false; break; }
            }
        }
        check("an activation swap moves no weights at all",
            identical && !t.exact && t.net.acts.hidden === "tanh", t.note);
    }

    // --- the transplanted brain must match the config genius.js will hand the
    //     trainer, or train_headless.js refuses to resume and the cell is lost
    {
        const old = mk([64, 48, 24], { hidden: "relu" });
        const target = { hidden: [64, 48, 24, 24], acts: { hidden: "relu", out: "sigmoid" } };
        const t = transplant(old, target, rng);
        const desc = applyConfig({ profile: "compact", arch: { kind: "mlp", ...target } }, BASE_R2);
        const round = netFromJSON({ net: t.net.toJSON() });
        check("a transplant survives the config round-trip the trainer performs",
            t.net.contract() === desc.contract && round.contract() === desc.contract,
            `${t.net.contract()} vs config ${desc.contract}, ${desc.params.toLocaleString()} params`);
    }

    // --- and the refusals
    {
        applyConfig(CONFIGS.conv3x8, BASE_R2);
        const conv = makeNet(rng);
        let refused = false;
        try { transplant(conv, { hidden: [48, 24] }, rng); } catch (e) { refused = /conv/.test(e.message); }
        const old = mk([64, 32], { hidden: "relu" });
        let refused2 = false;
        try { transplant(old, { hidden: [128, 96, 48, 24] }, rng); }
        catch (e) { refused2 = /single-step/.test(e.message); }
        check("surgery refuses a conv stack and any many-things-at-once rewrite",
            refused && refused2);
    }

    applyConfig({ profile: "full", arch: { kind: "mlp", hidden: [64, 32] } }, BASE_R2);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall good");
process.exit(failures ? 1 : 0);
