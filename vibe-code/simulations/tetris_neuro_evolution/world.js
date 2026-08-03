/* world.js — one brain playing one game, and a whole population playing in
 * lockstep so the fleet can be rendered (or raced headlessly).
 *
 * ---- the reward, and why it is shaped the way it is -----------------------
 *
 * Lines cleared alone is far too sparse a signal: a random brain never clears a
 * line, so every member of generation 1 scores exactly zero and selection has
 * nothing to sort on. So each *placed piece* is also scored on what it did to
 * the board — holes opened, surface roughness, stack height, how high it landed.
 *
 * The trap that shaping like this normally walks into is a suicide exploit: if
 * the penalties can make a piece net-negative, the highest-scoring policy is to
 * top out immediately and stop accruing losses. Two rules stop that here:
 *
 *   · every piece placed is worth +PIECE, and the shaping terms are clamped so
 *     they can never take more than PENALTY_CAP away — and PENALTY_CAP is well
 *     below PIECE, so placing a piece is *always* profitable, however clumsy.
 *   · topping out ends the accrual and costs a little extra on top.
 *
 * Living longer is therefore always better than dying, and living longer while
 * keeping the board flat and hole-free is better still. That ordering is what
 * turns "score" into a ladder evolution can actually climb.
 */
"use strict";

/* The clamp has to be generous enough that it almost never binds: if two thirds
 * of placements bottom out at the same clamped value then a brain that buries
 * one cell and a brain that buries five score identically, and selection has
 * nothing to sort them by. PIECE and PENALTY_CAP are therefore both large, with
 * PIECE the larger of the two — dynamic range without breaking the invariant. */
const R = {
    PIECE: 8.0,                              // every piece safely placed
    LINES: [0, 240, 640, 1520, 3600],        // super-linear: tetrises are the prize
    FILL: 6.0,                               // per unit of row-completeness added
    NEW_HOLE: -1.6,                          // per cell buried under the stack
    FIXED_HOLE: 0.8,                         // per cell un-buried (deliberately smaller,
                                             //   so bury/unbury cycles never pay)
    BUMPY: -0.10,                            // per unit of extra surface roughness
    HEIGHT: -0.05,                           // per unit of extra total stack height
    LANDING: -0.03,                          // per row above the floor the piece landed
    WELLS: -0.12,                            // per unit of newly dug unreachable well
    DITHER: -0.4,                            // for burning the whole per-piece tick budget
                                             //   (small: maxTicksPerPiece already caps
                                             //   the cost, and a stiff time penalty just
                                             //   teaches the brain to pin soft drop on
                                             //   and stack wherever the piece spawned)
    PENALTY_CAP: -7.5,                       // most the shaping can ever subtract
    TOPOUT: -48,
};

/* Engine ticks between decisions — the brain's reaction time. Also the main
 * lever on training cost: it is the divisor on how many forward passes a game
 * needs. What matters is that a piece lasts enough *decisions* to be steered
 * anywhere on the board; see the reachability test in test_headless.js. */
const ACT_EVERY = 2;

/* Which of the seven keys are actually wired up. All seven by default — this is a
 * search dimension, not a decision, because the evidence cuts both ways: the
 * champion evolved a compulsive hold habit (32 presses per 40 pieces) and played
 * 15% better with the key unplugged, but that habit was paid for by an engine
 * loophole that has since been closed, so evolution may well find a *good* use
 * for hold now. `nohold` configs measure it instead of arguing about it.
 * The network keeps all seven outputs either way; a masked key is simply never
 * pressed, exactly like a keyboard with a dead key. */
let ACTION_MASK = [1, 1, 1, 1, 1, 1, 1];
function setActionMask(mask) {
    ACTION_MASK = KEY_ORDER.map((c, i) => (mask && mask[i] !== undefined ? (mask[i] ? 1 : 0) : 1));
    return ACTION_MASK;
}

class Agent {
    constructor(brain, seed, cfg) {
        this.brain = brain;
        this.game = new Tetris({ seed, cfg });
        this.input = new Float32Array(IN_SIZE);
        this.fitness = 0;
        this.lines = 0;
        this.pieces = 0;
        this.alive = true;
        this.keys = [0, 0, 0, 0, 0, 0, 0];
        this.act = new Float32Array(7);       // raw sigmoids, for the keyboard readout
        // two metric buffers, swapped every lock — no allocation in the hot loop
        this._mA = { heights: new Int32Array(BW), holes: new Int32Array(BW) };
        this._mB = { heights: new Int32Array(BW), holes: new Int32Array(BW) };
        this.prev = boardMetrics(this.game.grid, this._mA);
        this.prevFill = rowFill(this.game.grid);
        this.actClock = 0;
        this.lastReward = 0;
        this.tickInPiece = 0;
        // behaviour accumulators — what this brain did, for fitness sharing
        this.keyHeld = new Float32Array(7);
        this.decisions = 0;
        this.buried = 0;
        this.placements = 0;
    }

    /* How this brain played, as SIG_SIZE numbers in roughly [0,1]: its key-press
     * mix, the stack profile it left behind, how much it buried per piece and
     * how long it lasted. Behaviour, not weights — two networks can compute the
     * same policy with their hidden units permuted, so weight distance says
     * nothing about whether they are the same idea. */
    signature(out) {
        const sig = out || new Float32Array(SIG_SIZE);
        const d = Math.max(1, this.decisions);
        for (let i = 0; i < 7; i++) sig[i] = this.keyHeld[i] / d;
        const m = boardMetrics(this.game.grid, this._mA === this.prev ? this._mB : this._mA);
        for (let x = 0; x < BW; x++) sig[7 + x] = m.heights[x] / TH;
        sig[7 + BW] = Math.min(1, this.buried / Math.max(1, this.placements) / 4);
        sig[8 + BW] = Math.min(1, this.pieces / 100);
        return sig;
    }

    /* One engine tick. The brain only gets to touch the keyboard every
     * ACT_EVERY ticks; in between, whatever it is holding stays held — exactly
     * like a player whose fingers are slower than the game's frame rate. */
    step(pieceCap) {
        if (!this.alive) return null;
        const g = this.game;

        if (this.actClock-- <= 0) {
            this.actClock = ACT_EVERY - 1;
            sense(g, this.input);
            const out = this.brain.forward(this.input);
            // --- this is the entire actuator: seven output units become seven keys.
            // The press threshold comes from the brain, because it depends on the
            // output activation the config chose — sigmoid presses above 0.5, tanh
            // above 0. Both start a fresh brain exactly at its own threshold.
            const thr = this.brain.threshold !== undefined ? this.brain.threshold : 0.5;
            for (let i = 0; i < KEY_ORDER.length; i++) {
                this.act[i] = out[i];
                const want = out[i] > thr && ACTION_MASK[i] === 1;
                const code = KEY_ORDER[i];
                if (want && !g.down[code]) g.onKeyDown(code);
                else if (!want && g.down[code]) g.onKeyUp(code);
                this.keys[i] = want ? 1 : 0;
                if (want) this.keyHeld[i]++;
            }
            this.decisions++;
        }

        const ev = g.step();
        this.tickInPiece++;

        if (ev.locked) {
            const cur = boardMetrics(g.grid, this.prev === this._mA ? this._mB : this._mA);
            const p = this.prev;
            let shape = 0;
            const dHoles = cur.totalHoles - p.totalHoles;
            if (dHoles > 0) this.buried += dHoles;
            this.placements++;
            shape += dHoles > 0 ? dHoles * R.NEW_HOLE : -dHoles * R.FIXED_HOLE;
            shape += Math.max(0, cur.bumpy - p.bumpy) * R.BUMPY;
            shape += Math.max(0, cur.agg - p.agg) * R.HEIGHT;
            shape += Math.max(0, cur.wells - p.wells) * R.WELLS;
            shape += (TH - (ev.landingRow || 0)) * R.LANDING;
            // Row-completeness is measured *before* the clear, so the piece that
            // finishes a line is credited for finishing it rather than punished
            // for making the row disappear.
            shape += (ev.fillPre - this.prevFill) * R.FILL;
            // Time cost lives *inside* the shaping so the clamp covers it too.
            // Charged per piece, not per tick: a per-tick drip outside the clamp
            // is exactly how a "place a piece" move turns net-negative, and a
            // net-negative move makes topping out the optimal policy.
            shape += R.DITHER * Math.min(1, this.tickInPiece / g.cfg.maxTicksPerPiece);
            if (shape < R.PENALTY_CAP) shape = R.PENALTY_CAP;   // the anti-suicide clamp

            const gain = R.PIECE + R.LINES[ev.lines] + shape;
            this.fitness += gain;
            this.lastReward = gain;
            this.lines += ev.lines;
            this.pieces++;
            this.tickInPiece = 0;
            this.prev = cur;
            this.prevFill = rowFill(g.grid);           // post-clear baseline
            if (pieceCap && this.pieces >= pieceCap) this.alive = false;
        }
        if (ev.over) { this.fitness += R.TOPOUT; this.alive = false; }
        return ev;
    }
}

/* A generation's worth of agents, all playing the same seeded piece sequence so
 * nobody wins on bag luck. Stepped in lockstep so the fleet renders as one. */
class Population {
    constructor(brains, opts) {
        this.opts = opts;
        this.agents = brains.map(b => new Agent(b, opts.seed, opts.cfg));
        this.pieceCap = opts.pieceCap || 0;
        this.tick = 0;
        this.maxTicks = opts.maxTicks || 200000;
    }
    get aliveCount() { let n = 0; for (const a of this.agents) if (a.alive) n++; return n; }
    get done() { return this.aliveCount === 0 || this.tick >= this.maxTicks; }

    step() {
        this.tick++;
        for (let i = 0; i < this.agents.length; i++) this.agents[i].step(this.pieceCap);
    }
    /* Run to completion with no rendering. */
    runOut() { while (!this.done) this.step(); return this.results(); }

    results() {
        return this.agents.map(a => ({
            brain: a.brain, fitness: a.fitness, lines: a.lines,
            pieces: a.pieces, score: a.game.score,
        }));
    }
    /* Best agent right now, for the camera to follow. */
    leader() {
        let best = this.agents[0], bi = 0;
        for (let i = 1; i < this.agents.length; i++) {
            const a = this.agents[i];
            const better = (a.alive !== best.alive) ? a.alive : a.fitness > best.fitness;
            if (better) { best = a; bi = i; }
        }
        return { agent: best, index: bi };
    }
    /* Agents sorted for the small-multiples grid: alive first, then by score. */
    ranked() {
        return this.agents.map((a, i) => ({ a, i }))
            .sort((p, q) => (q.a.alive - p.a.alive) || (q.a.fitness - p.a.fitness));
    }
}

/* A compact description of *how* a brain played, as opposed to how well: which
 * keys it leaned on, the shape of the stack it left behind, how much it buried
 * and how long it lasted. Two brains with the same fitness and different
 * signatures are two different ideas, and a GA that cannot tell them apart will
 * quietly discard one of them. Used for fitness sharing in evolution.js. */
const SIG_SIZE = 7 + BW + 2;

/* Score one brain over `trials` differently-seeded games. Two games with two
 * bag orders is the cheapest defence against a brain that only looks good
 * because generation 12 happened to hand it four I-pieces in a row. */
function scoreBrain(brain, seeds, cfg, pieceCap) {
    let sum = 0, lines = 0, pieces = 0;
    const each = [];
    const sig = new Float32Array(SIG_SIZE), one = new Float32Array(SIG_SIZE);
    for (const s of seeds) {
        const a = new Agent(brain, s, cfg);
        while (a.alive) a.step(pieceCap);
        a.signature(one);
        for (let i = 0; i < SIG_SIZE; i++) sig[i] += one[i] / seeds.length;
        sum += a.fitness; lines += a.lines; pieces += a.pieces;
        each.push(a.fitness);
    }
    const n = seeds.length;
    /* Forty percent of the score is "the bad day", so that a brain which is
     * brilliant on average and catastrophic on one bag does not win. With two or
     * three games the bad day is simply the worst of them. With two hundred it
     * cannot be: the single unluckiest bag out of two hundred is nearly a constant
     * of the game rather than a property of the brain, and selecting on it selects
     * for whoever drew the least brutal sequence. So the bad day is the mean of
     * the bottom decile — which *is* the single worst game whenever there are ten
     * or fewer, so every configuration that existed before this scores identically
     * to the last bit. */
    const k = Math.max(1, Math.round(n * 0.1));
    each.sort((a, b) => a - b);
    let low = 0;
    for (let i = 0; i < k; i++) low += each[i];
    low /= k;
    return {
        fitness: 0.6 * (sum / n) + 0.4 * low,
        mean: sum / n, worst: each[0], low, lowOf: k,
        lines: lines / n,
        pieces: pieces / n,
        sig: Array.from(sig),
    };
}

if (typeof module !== "undefined") {
    module.exports = {
        Agent, Population, scoreBrain, R, ACT_EVERY, SIG_SIZE, setActionMask, ACTION_MASK,
    };
}
