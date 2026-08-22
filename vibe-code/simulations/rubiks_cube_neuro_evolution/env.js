/* env.js — the episode. Scramble, look, turn, look, until solved or out of moves.
 *
 * One class runs everything: the headless trainer, the grid search, the
 * validator in bake_brain.js and the animated page all drive `Runner`. That is
 * deliberate. The traffic-light project in this folder lost a day to a trainer
 * that ran 200-second episodes while its own benchmark ran 380-second ones, and
 * the lesson was that two implementations of "one episode" will diverge, quietly,
 * in the direction that flatters the trainer. There is one implementation here.
 *
 * ─── the curriculum ────────────────────────────────────────────────────────
 *
 * Nobody evolves a solver for a fully scrambled cube from random weights, and
 * pretending otherwise produces a run where every brain scores zero forever and
 * selection has nothing to work with. So difficulty is a ladder: depth-1
 * scrambles first (one move from solved, eight possible answers), and the ladder
 * only extends when the champion can actually clear the current rung on scrambles
 * it has never seen.
 *
 * Two things about how the rungs are mixed matter more than they look.
 *
 * First, the bank is **stratified, not sampled**. Each generation's episodes are
 * allocated to depths by exact count with largest-remainder rounding, not by
 * drawing a random depth per episode. Random draws add a variance term that has
 * nothing to do with the brains — the walking project in this folder watched a
 * "the fleet forgot how to stand" collapse that turned out to be three
 * independent random fractions composing into a spawn mix nobody had chosen, and
 * the rocket-catch project measured bank noise of 1.17 sd against breeding
 * operators worth a tenth of that. If the diet can be fixed exactly, fix it.
 *
 * Second, the ladder **never drops the lower rungs**. A mix that trains only at
 * the frontier produces a brain that has forgotten how to finish, which shows up
 * as a champion that gets a depth-5 cube to distance 1 and then cannot take the
 * last step. The default mix weights depth d by d, so the frontier gets the most
 * episodes and depth 1 always gets some.
 *
 * ─── the budget, and a leak that had to be closed ─────────────────────────
 *
 * A depth-2 scramble does not need twenty moves, and giving it twenty means 90%
 * of the compute is spent watching a brain flail after it has already won or
 * lost. So the budget is `min(max, trueDistance + slack)`.
 *
 * That immediately created an information leak. The clock input was `t / budget`,
 * and the budget depends on the true distance — so the network could read its
 * scramble's difficulty off the *scale* of its own clock, which is privileged
 * state it must not have. The clock is therefore normalised by the *constant*
 * maximum budget instead. The episode still ends early; the observation just no
 * longer says why.
 */
"use strict";

const ENV_DEFAULTS = {
    moves: "UDLR",                 // which faces are turnable — see cube.js
    /* vision */
    res: 24, ss: 3, margin: 0.06, gap: 0.14, palette: "clear", center: true, shade: true,
    /* "iso" (default) = the two-panel isometric pair; "unfolded" = the flat cross.
     * See buildUnfoldedPlan in vision.js for why the second one exists. */
    view: "iso",
    /* observation */
    frames: 2, moveHist: 2, clock: true, pixels: true,
    /* episode */
    budget: { max: 20, slack: 6 },
    /* difficulty */
    maxDepth: 1, depthMix: "ramp", oracleRadius: 7,
    /* reward */
    reward: "mixed", rewardParams: {},
};

class Env {
    constructor(cfgIn) {
        const cfg = Object.assign({}, ENV_DEFAULTS, cfgIn || {});
        cfg.budget = Object.assign({}, ENV_DEFAULTS.budget, cfgIn && cfgIn.budget);
        cfg.rewardParams = rewardParams(cfg.rewardParams);
        this.cfg = cfg;

        this.set = moveSet(cfg.moves);
        this.nMoves = this.set.length;

        this.plan = buildRenderPlan(CUBE_GEOM, {
            res: cfg.res, ss: cfg.ss, margin: cfg.margin, gap: cfg.gap,
            palette: cfg.palette, center: cfg.center, shade: cfg.shade,
            view: cfg.view,
        });

        if (cfg.pixels) {
            this.layout = observationLayout(this.plan, {
                frames: cfg.frames, moveHist: cfg.moveHist, clock: cfg.clock, nMoves: this.nMoves,
            });
        } else {
            /* The ablation control: 54 facelets one-hot, no picture at all. Same
             * extras, so the only difference between this and the pixel profile is
             * how the cube is described. */
            const hist = Math.max(0, cfg.moveHist | 0);
            const extras = hist * this.nMoves + (cfg.clock === false ? 0 : 1);
            this.layout = {
                frames: 1, hist, nMoves: this.nMoves, imageSize: 324, extras,
                channels: 0, H: 0, W: 0, planeAt: 0, extrasAt: 324,
                size: 324 + extras,
            };
        }

        /* The oracle. Built only if something needs it: 40 MB and a second per
         * worker is not a price the sticker-based rewards should pay. The
         * curriculum is capped by its radius, because a shaped reward that cannot
         * see past depth R would silently become a sticker reward beyond it. */
        this.wantsOracle = needsOracle(cfg.reward) || !!cfg.forceOracle;
        this.oracle = this.wantsOracle
            ? buildDistanceTable(Math.min(cfg.oracleRadius, 8), this.set) : null;
        /* Training must not go deeper than the oracle can see, or a shaped reward
         * silently degrades into a sticker reward at the frontier and the ratchet
         * keeps promoting into the blind. The page overrides this: it only needs the
         * oracle for a readout, and letting somebody watch the champion attempt a
         * 12-turn scramble is worth more there than an exact distance would be. */
        this.depthCap = cfg.depthCapOverride || (this.oracle ? this.oracle.radius : 24);

        this.reward = rewardOf(cfg.reward).fn;
        this._scratch = new Uint8Array(54);
        this._scratch2 = new Uint8Array(54);
        this._scratch3 = new Uint8Array(54);
    }

    contractInfo(arch) {
        const net = buildNet(arch, this.layout, null);
        return {
            contract: net.contract(),
            params: net.paramCount,
            inputs: this.layout.size,
            image: this.cfg.pixels ? `${this.layout.channels}×${this.layout.H}×${this.layout.W}` : "none",
            extras: this.layout.extras,
            nMoves: this.nMoves,
        };
    }

    /* Which number the move budget should be computed from.
     *
     * `budgetFor` wants a true distance, and beyond the oracle's radius there is not
     * one -- distanceOf returns radius+1 for everything out there. Feeding that in
     * gives a 15-turn scramble the move budget of an 8-turn one, which would make a
     * deep curriculum unsolvable for a reason having nothing to do with the brain. It
     * is the same saturated-sensor trap the planetary project hit, where a value that
     * had quietly hit its ceiling was still being read as a measurement.
     *
     * So: use the true distance whenever it is one, and otherwise fall back to the
     * scramble depth, which is an upper bound on the distance because the scramble
     * sequence is itself a solution. Runs at depth <= radius are bit-for-bit
     * unaffected, which is the point -- every measurement taken so far stays
     * comparable. */
    budgetBasis(d0, depth) {
        if (!this.oracle || d0 <= this.oracle.radius) return d0;
        return Math.max(d0, depth);
    }

    budgetFor(d0) {
        const b = this.cfg.budget;
        return Math.max(1, Math.min(b.max, d0 + b.slack));
    }

    /* -------------------------------------------------------------- the bank */

    /* Exact per-depth counts for `n` episodes at the current frontier. */
    depthCounts(n, maxDepth) {
        const D = Math.max(1, Math.min(maxDepth, this.depthCap));
        const w = [];
        for (let d = 1; d <= D; d++) {
            /* "deep" weights by d², which puts about a third of the bank on the
             * deepest rung instead of a seventh. It exists because raising the deep end
             * of the results table is partly a *measurement* problem, not only a
             * representation one: at a uniform mix and 48 episodes a brain is judged on
             * six depth-7 cubes, so improving that rung from 8% to 12% shifts the
             * expected count by 0.2 solves and selection is blind to it. Steeper than
             * "ramp"; unlike "frontier" it still keeps every shallow rung populated, and
             * the anti-forgetting pass below guarantees none is empty. */
            w.push(this.cfg.depthMix === "uniform" ? 1
                : this.cfg.depthMix === "frontier" ? (d === D ? 1 : 0.001)
                    : this.cfg.depthMix === "deep" ? d * d
                        : d);                               // "ramp"
        }
        const tot = w.reduce((a, b) => a + b, 0);
        const raw = w.map(x => n * x / tot);
        const cnt = raw.map(Math.floor);
        /* largest remainder, so the counts sum to exactly n and the same n always
         * gives the same diet */
        let left = n - cnt.reduce((a, b) => a + b, 0);
        const order = raw.map((x, i) => [x - cnt[i], i]).sort((a, b) => b[0] - a[0]);
        for (let i = 0; left > 0; i++, left--) cnt[order[i % order.length][1]]++;

        /* Anti-forgetting: no rung may be empty, or the shallow cubes vanish from
         * the diet the moment the frontier is a few steps ahead of them and the
         * champion quietly loses the ability to finish. With a ramp mix and a small
         * episode count that is exactly what the rounding above produces — at 12
         * episodes over 7 depths, depth 1 rounds to zero.
         *
         * The fix has to *move* an episode rather than add one. An earlier version
         * simply set the empty bucket to 1, which broke the sum, and a bank that is
         * one episode longer than requested is the kind of quiet drift that makes
         * two runs incomparable for no visible reason. */
        if (n >= D) {
            for (let d = 0; d < D; d++) {
                if (cnt[d] !== 0) continue;
                let fat = 0;
                for (let k = 1; k < D; k++) if (cnt[k] > cnt[fat]) fat = k;
                if (cnt[fat] > 1) { cnt[fat]--; cnt[d]++; }
            }
        }
        return cnt;
    }

    /* A bank of scrambles. Every brain in a generation is handed the *same* bank
     * — common random numbers, which the chess project in this folder measured as
     * the single biggest win available to a GA of this kind: it removes the
     * scramble draw from the comparison entirely, so a difference between two
     * brains is a difference between the brains. */
    makeBank(seed, n, maxDepth) {
        const rng = mulberry32(seed >>> 0);
        const counts = this.depthCounts(n, maxDepth);
        const bank = [];
        for (let d = 1; d <= counts.length; d++) {
            for (let i = 0; i < counts[d - 1]; i++) {
                const { state, seq } = scramble(rng, d, this.set);
                const d0 = this.oracle ? distanceOf(this.oracle, state) : d;
                bank.push({
                    state: state.slice(), depth: d, d0,
                    budget: this.budgetFor(this.budgetBasis(d0, d)),
                    seq: seq.map(m => m.name),
                });
            }
        }
        return bank;
    }

    /* A bank of exactly `n` scrambles all at one depth.
     *
     * The ratchet needs this and cannot use makeBank. Filtering a mixed bank down
     * to the frontier depth looks equivalent and is not: the ramp mix gives depth d
     * a share d/Σd, so a "96-game" probe was really 64 games at depth 2 and would
     * have been 24 at depth 7 — the promotion test quietly losing precision exactly
     * as the decisions it gates get harder and rarer. The gate that guards the
     * curriculum has to keep the same power at every rung. */
    makeDepthBank(seed, n, depth) {
        const rng = mulberry32(seed >>> 0);
        const d = Math.max(1, Math.min(depth, this.depthCap));
        const bank = [];
        for (let i = 0; i < n; i++) {
            const { state, seq } = scramble(rng, d, this.set);
            const d0 = this.oracle ? distanceOf(this.oracle, state) : d;
            bank.push({
                state: state.slice(), depth: d, d0,
                budget: this.budgetFor(this.budgetBasis(d0, d)),
                seq: seq.map(m => m.name),
            });
        }
        return bank;
    }

    /* --------------------------------------------------------------- running */

    newRunner(net, scr) { return new Runner(this, net, scr); }

    runEpisode(net, scr) {
        const r = new Runner(this, net, scr);
        while (!r.done) r.step();
        return r.trace();
    }

    /* ---- imitation: evolve against per-move agreement with the oracle ---------
     *
     * The arithmetic that motivates this. Solving a depth-7 cube needs roughly seven
     * correct decisions in a row, so a 90% solve rate at that depth needs a per-move
     * accuracy near 98.5%. Episode reward measures that quantity with *one bit per
     * episode*, and a 96-episode bank therefore resolves it to a few percent at best —
     * selection cannot see the difference between 95% and 98% per-move accuracy, which
     * is the entire remaining distance to the target.
     *
     * The oracle already knows the answer at every state inside its radius. So instead
     * of paying for outcomes, pay for agreement: roll the cube along an *optimal* path
     * and ask, at each state, whether the brain's argmax is one of the distance-reducing
     * moves. A thirteen-move episode yields thirteen labelled decisions instead of one
     * bit, and the fitness is a classification accuracy with a standard error hundreds
     * of times smaller for the same compute.
     *
     * This is still a genetic algorithm — no gradients, no backpropagation. It is only
     * the *fitness function* that changed, from "did you win" to "do you agree with
     * someone who knows".
     *
     * Three design points that matter:
     *
     * Teacher forcing. The move actually applied is the oracle's, never the brain's, so
     * the state sequence does not depend on the brain at all. That makes the metric
     * completely unfarmable — a brain cannot steer toward states it happens to like,
     * which is precisely the exploit that made `optimalFrac` collapse from 0.99 to 0.27
     * rank correlation as depth grew.
     *
     * Any optimal move counts. These generators make the Cayley graph bipartite, so
     * every move changes the true distance by exactly +/-1 and "optimal" means "reduces
     * it". Usually several moves qualify; marking the brain wrong for picking a
     * different correct answer would be teaching it the teacher's arbitrary tie-break.
     *
     * The teacher's own choice is randomised per scramble, not lowest-index. A teacher
     * that always played the first optimal move would walk a biased subset of the action
     * space, and this project has already lost a round to an action collapse — the
     * training distribution should not build one in.
     *
     * The honest limitation: states come from optimal paths, while at test time the
     * brain walks its own. That mismatch is the standard imitation-learning trap, and
     * this folder has paid for it before (labels must be reachable from the state the
     * policy is actually in). It is mild here because a brain that agrees at 98% *is*
     * walking an optimal path, but it is the reason `imitate` is a phase rather than a
     * replacement — the episode reward stays the final yardstick, and evaluate.js is
     * still what decides anything. */
    optimalSet(state) {
        const d = distanceOf(this.oracle, state);
        const out = [];
        for (let i = 0; i < this.nMoves; i++) {
            this._scratch2.set(state);
            applyMoveInto(this._scratch2, this.set[i], this._scratch3);
            if (distanceOf(this.oracle, this._scratch2) === d - 1) out.push(i);
        }
        return out;
    }

    /* Self-rollout agreement: the brain drives, the oracle grades.
     *
     * `imitationScore` walks the *oracle's* path, which makes it unfarmable but trains
     * the brain only on states an optimal player reaches. At test time the brain walks
     * its own path, and the moment it errs it is somewhere the teacher-forced diet never
     * showed it. That mismatch is the standard imitation-learning failure and this
     * folder has paid for it before — labels have to be reachable from the state the
     * policy is actually in.
     *
     * Here they always are, as long as the brain stays inside the oracle's radius, so
     * the fix is cheap: let the brain move, and score each visited state against what
     * the oracle would have done. Wandering outside the radius scores zero for those
     * steps rather than being skipped, because "I went somewhere nobody can grade" must
     * not be a way to avoid being marked wrong — that is precisely the exploit that
     * made `optimalFrac` collapse as cubes got deeper.
     *
     * Farmability is bounded but not zero, which is why this is offered alongside the
     * teacher-forced version rather than instead of it, and why the grid decides. */
    daggerScore(net, bank) {
        let hits = 0, steps = 0, solvedN = 0;
        const perDepth = new Map();
        const moveMix = new Float64Array(this.nMoves);
        for (const scr of bank) {
            const r = new Runner(this, net, scr);
            let ok = 0, n = 0;
            while (!r.done) {
                const opt = this.optimalSet(r.state);
                const out = r.peek();
                const pick = chooseMove(out);
                moveMix[pick]++;
                if (opt.length && opt.indexOf(pick) >= 0) ok++;
                n++;
                r.step(pick);
            }
            hits += ok; steps += n;
            if (r.solvedFlag) solvedN++;
            let pd = perDepth.get(scr.depth);
            if (!pd) perDepth.set(scr.depth, pd = { n: 0, hits: 0, steps: 0, solved: 0 });
            pd.n++; pd.hits += ok; pd.steps += n; pd.solved += r.solvedFlag ? 1 : 0;
        }
        const acc = steps ? hits / steps : 0;
        let mixTot = 0;
        for (let i = 0; i < this.nMoves; i++) mixTot += moveMix[i];
        const sig = new Float64Array(this.nMoves + 3);
        for (let i = 0; i < this.nMoves; i++) sig[i] = mixTot ? moveMix[i] / mixTot : 0;
        sig[this.nMoves] = acc;
        sig[this.nMoves + 1] = bank.length ? solvedN / bank.length : 0;
        sig[this.nMoves + 2] = 0;
        return {
            fitness: acc, solveRate: bank.length ? solvedN / bank.length : 0,
            descent: acc, movesPerEpisode: bank.length ? steps / bank.length : 0,
            undoRate: 0, coverage: 1, accuracy: acc,
            liveActions: (() => {
                let k = 0;
                for (let i = 0; i < this.nMoves; i++) {
                    if (mixTot && moveMix[i] / mixTot >= 0.25 / this.nMoves) k++;
                }
                return k;
            })(),
            perDepth: [...perDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => ({
                depth: d, n: v.n, solveRate: v.solved / v.n, descent: v.steps ? v.hits / v.steps : 0,
            })),
            sig: Array.from(sig),
        };
    }

    /* Agreement and outcome together. Agreement is the dense signal that can resolve the
     * last few percent of per-move accuracy; outcome is the thing actually wanted, and
     * the only one of the two that notices when a brain is accurate on-path and lost
     * off it. `blendW` is the weight on agreement. */
    blendScore(net, bank) {
        const a = this.daggerScore(net, bank);
        const w = this.cfg.blendW === undefined ? 0.5 : this.cfg.blendW;
        const saved = this.cfg.fitness;
        this.cfg.fitness = null;
        const b = this.scoreBrain(net, bank);
        this.cfg.fitness = saved;
        const out = Object.assign({}, b);
        out.fitness = w * a.fitness + (1 - w) * b.fitness;
        out.accuracy = a.fitness;
        return out;
    }

    imitationScore(net, bank) {
        let hits = 0, steps = 0, perfect = 0;
        const perDepth = new Map();
        const moveMix = new Float64Array(this.nMoves);
        for (const scr of bank) {
            const rng = mulberry32((scr.d0 * 7919 + scr.state[0] * 131 + scr.state[13] * 17 + 1) >>> 0);
            const r = new Runner(this, net, scr);
            let ok = 0, n = 0;
            while (!r.done) {
                const opt = this.optimalSet(r.state);
                if (!opt.length) break;                       // solved, or outside the ball
                const out = r.peek();
                const pick = chooseMove(out);
                moveMix[pick]++;
                if (opt.indexOf(pick) >= 0) ok++;
                n++;
                r.step(opt[Math.floor(rng() * opt.length) % opt.length]);
            }
            hits += ok; steps += n;
            if (n > 0 && ok === n) perfect++;
            let pd = perDepth.get(scr.depth);
            if (!pd) perDepth.set(scr.depth, pd = { n: 0, hits: 0, steps: 0, perfect: 0 });
            pd.n++; pd.hits += ok; pd.steps += n; pd.perfect += (n > 0 && ok === n) ? 1 : 0;
        }
        const acc = steps ? hits / steps : 0;
        let mixTot = 0;
        for (let i = 0; i < this.nMoves; i++) mixTot += moveMix[i];
        const sig = new Float64Array(this.nMoves + 3);
        for (let i = 0; i < this.nMoves; i++) sig[i] = mixTot ? moveMix[i] / mixTot : 0;
        sig[this.nMoves] = acc;
        sig[this.nMoves + 1] = bank.length ? perfect / bank.length : 0;
        sig[this.nMoves + 2] = 0;
        return {
            fitness: acc,
            /* "Every move on the path was optimal" implies the cube would have been
             * solved had the brain been driving, so this is the honest solve proxy and
             * it costs nothing extra. */
            solveRate: bank.length ? perfect / bank.length : 0,
            descent: acc,
            movesPerEpisode: bank.length ? steps / bank.length : 0,
            undoRate: 0,
            coverage: 1,
            liveActions: (() => {
                let k = 0;
                for (let i = 0; i < this.nMoves; i++) {
                    if (mixTot && moveMix[i] / mixTot >= 0.25 / this.nMoves) k++;
                }
                return k;
            })(),
            accuracy: acc,
            perDepth: [...perDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => ({
                depth: d, n: v.n, solveRate: v.perfect / v.n, descent: v.steps ? v.hits / v.steps : 0,
            })),
            sig: Array.from(sig),
        };
    }

    /* Score one brain over a bank. Returns the reward mean (what the GA sorts on)
     * plus the reward-independent numbers that are actually interesting, so a
     * change of reward function does not change what "skill" means when configs
     * are compared. */
    scoreBrain(net, bank) {
        if (this.cfg.fitness === "imitate") return this.imitationScore(net, bank);
        if (this.cfg.fitness === "dagger") return this.daggerScore(net, bank);
        if (this.cfg.fitness === "blend") return this.blendScore(net, bank);
        let fit = 0, solved = 0, descent = 0, moves = 0, undos = 0;
        const perDepth = new Map();
        const moveMix = new Float64Array(this.nMoves);
        for (const scr of bank) {
            const tr = this.runEpisode(net, scr);
            fit += tr.reward;
            moves += tr.moves;
            undos += tr.undos;
            for (let i = 0; i < this.nMoves; i++) moveMix[i] += tr.moveMix[i];
            const dsc = tr.d0 > 0 ? (tr.d0 - tr.dBest) / tr.d0 : 1;
            descent += dsc;
            if (tr.solved) solved++;
            let pd = perDepth.get(scr.depth);
            if (!pd) perDepth.set(scr.depth, pd = { n: 0, solved: 0, descent: 0 });
            pd.n++; pd.solved += tr.solved ? 1 : 0; pd.descent += dsc;
        }
        const n = bank.length;
        let mixTot = 0;
        for (let i = 0; i < this.nMoves; i++) mixTot += moveMix[i];

        /* ---- action coverage, an optional term aimed at one measured failure ----
         *
         * probe_failures.js found the plateau's mechanism: three of the eight actions
         * were dead in the champion (U' 1%, D' 0%, L' 0%), and cubes whose only
         * distance-reducing first move is a dead action solve at 38% against 65% at
         * depth 3. The cause is structural rather than a lack of search. The policy
         * is an argmax, so an output unit that is never the maximum is *invisible to
         * selection*: its incoming weights drift neutrally, nothing about the fitness
         * notices, and once it has drifted far enough it can never win a comparison
         * again. Collapse is one-way and progressive — 6/8 live at generation 705,
         * 5/8 by 2277.
         *
         * Fitness sharing was the obvious fix and it measurably is not one: applied
         * to an already-converged population it revived nothing in 220 generations,
         * because sharing preserves diversity and cannot create it. A term that makes
         * an unused action *cost* something is on before the property is lost.
         *
         * The measure is per-brain over the whole bank, not per-episode. Per-episode
         * coverage would be farmable and also wrong: a good policy on a depth-2 cube
         * plays two moves and should not be asked to use eight. Over a bank of forty
         * mixed scrambles, a policy with a working repertoire uses all eight; one with
         * three dead units cannot.
         *
         * An action counts as alive once it reaches `covFloor` of a uniform share
         * (default a quarter of it, so ~3% of moves for eight actions) and is credited
         * pro rata below that, so the term is smooth enough for selection to climb.
         * It saturates at 1: there is nothing to gain from playing uniformly, which is
         * what stops the obvious exploit of cycling through all eight turns — that
         * earns the whole bonus exactly once and forfeits the descent reward, which is
         * an order of magnitude larger. `coverage` is 0 by default; the grid decides
         * whether it is worth anything. */
        const covW = this.cfg.coverage || 0;
        let coverage = 1;
        if (covW > 0 && mixTot > 0) {
            const floor = (this.cfg.covFloor || 0.25) / this.nMoves;
            let c = 0;
            for (let i = 0; i < this.nMoves; i++) {
                c += Math.min(1, (moveMix[i] / mixTot) / floor);
            }
            coverage = c / this.nMoves;
            fit += covW * coverage * n;      // fit is divided by n below
        }
        /* Behaviour signature for fitness sharing: the move mix (does it actually
         * use all eight turns, or has it collapsed onto two?), plus how far it
         * gets and how much it undoes itself. Weight-space distance is useless for
         * this — two networks can compute the same policy with hidden units
         * permuted. */
        const sig = new Float64Array(this.nMoves + 3);
        for (let i = 0; i < this.nMoves; i++) sig[i] = mixTot ? moveMix[i] / mixTot : 0;
        sig[this.nMoves] = descent / n;
        sig[this.nMoves + 1] = solved / n;
        sig[this.nMoves + 2] = undos / Math.max(1, moves);
        return {
            fitness: fit / n,
            solveRate: solved / n,
            descent: descent / n,
            movesPerEpisode: moves / n,
            undoRate: undos / Math.max(1, moves),
            coverage,
            liveActions: (() => {
                let k = 0;
                for (let i = 0; i < this.nMoves; i++) {
                    if (mixTot && moveMix[i] / mixTot >= 0.25 / this.nMoves) k++;
                }
                return k;
            })(),
            perDepth: [...perDepth.entries()].sort((a, b) => a[0] - b[0])
                .map(([d, v]) => ({ depth: d, n: v.n, solveRate: v.solved / v.n, descent: v.descent / v.n })),
            sig: Array.from(sig),
        };
    }
}

/* One live episode. The page steps this from a timer; the trainer spins it to
 * completion. Nothing about the two paths differs. */
class Runner {
    constructor(env, net, scr) {
        /* A recurrent brain must start every episode with a blank state, or its first
         * move depends on the last cube it happened to be shown and a brain's score
         * starts depending on bank order. Feedforward nets do not define this. */
        if (net && typeof net.resetState === "function") net.resetState();
        this.env = env;
        this.net = net;
        this.scr = scr;
        this.set = env.set;
        this.state = scr.state.slice();
        this.budget = scr.budget !== undefined ? scr.budget : env.budgetFor(scr.d0 || 1);
        this.obs = env.cfg.pixels
            ? new Observer(env.plan, env.layout)
            : new FaceletObserver(env.layout);
        this.obs.reset(this.state);
        this.obs.budget = env.cfg.budget.max;      // constant scale — see the header

        this.t = 0;
        this.moves = 0;
        this.undos = 0;
        this.reducing = 0;
        this.prevLocal = -1;
        this.solvedFlag = false;
        this.done = false;
        this.history = [];                         // move names, for the page
        this.moveMix = new Float64Array(env.nMoves);
        this.out = null;

        this.d0 = scr.d0 !== undefined ? scr.d0 : (env.oracle ? distanceOf(env.oracle, this.state) : scr.depth);
        this.d = this.d0;
        this.dBest = this.d0;
        this.dSum = 0; this.dCount = 0;
        this.descDisc = 0;
        this.gamma = env.cfg.rewardParams.gamma;

        this.s0 = stickerScore(this.state);
        this.sBest = this.s0;
        this.p0 = pairScore(this.state);
        this.pBest = this.p0;
        this.facesBest = facesSolved(this.state);

        if (isSolved(this.state)) { this.solvedFlag = true; this.done = true; }
    }

    /* The network's raw output for the current cube, without acting on it. The
     * page draws these as bars; nothing in training needs it. */
    peek() {
        this.out = this.net.forward(this.obs.vec);
        return this.out;
    }

    /* `forcedLocal` overrides the network's choice for one move. The page uses it
     * for the manual turn buttons — the human acts as the policy for a step and
     * everything else about the episode (the observation window, the move history,
     * the distance trace) advances exactly as it would have. Without it the page
     * would need a second, near-identical stepping path, which is how a page and a
     * trainer start to disagree. */
    step(forcedLocal) {
        if (this.done) return null;
        const out = this.peek();
        const local = forcedLocal === undefined || forcedLocal === null
            ? chooseMove(out) : forcedLocal;
        const move = this.set[local];

        applyMoveInto(this.state, move, this.env._scratch);
        this.moves++;
        this.moveMix[local]++;
        this.history.push(move.name);
        if (this.prevLocal >= 0 && move.localInv === this.prevLocal) this.undos++;
        this.prevLocal = local;

        // ---- measure the new state
        if (this.env.oracle) {
            const dNew = distanceOf(this.env.oracle, this.state);
            if (dNew < this.d) this.reducing++;
            if (dNew < this.dBest) {
                this.dBest = dNew;
                this.descDisc += Math.pow(this.gamma, this.t);
            }
            this.d = dNew;
            this.dSum += dNew; this.dCount++;
        }
        const s = stickerScore(this.state);
        if (s > this.sBest) this.sBest = s;
        const ps = pairScore(this.state);
        if (ps > this.pBest) this.pBest = ps;
        const fs = facesSolved(this.state);
        if (fs > this.facesBest) this.facesBest = fs;

        this.t++;
        if (isSolved(this.state)) { this.solvedFlag = true; this.done = true; }
        else if (this.moves >= this.budget) this.done = true;
        else this.obs.push(this.state, local, this.env.cfg.budget.max);

        return { move: move.name, local, solved: this.solvedFlag, done: this.done, d: this.d, stickers: s };
    }

    trace() {
        const tr = {
            d0: this.d0, dBest: this.dBest, dFinal: this.d,
            dSum: this.dSum, dCount: this.dCount, descDisc: this.descDisc,
            s0: this.s0, sBest: this.sBest, sFinal: stickerScore(this.state),
            p0: this.p0, pBest: this.pBest,
            /* What "outside the oracle" reads as. distanceOf returns radius+1 for any
             * state not in the table, so a reward that needs to know whether a cube is
             * inside the ball at all must compare against this rather than assume 8. */
            dSat: this.env.oracle ? this.env.oracle.radius + 1 : Infinity,
            facesBest: this.facesBest,
            moves: this.moves, budget: this.budget, solved: this.solvedFlag,
            reducing: this.reducing, undos: this.undos, moveMix: this.moveMix,
        };
        tr.reward = this.env.reward(tr, this.env.cfg.rewardParams);
        return tr;
    }
}

/* The no-pixels control's observer, with the same interface as vision.js's. */
class FaceletObserver {
    constructor(layout) {
        this.L = layout;
        this.vec = new Float32Array(layout.size);
        this.hist = new Int8Array(Math.max(1, layout.hist)).fill(-1);
    }
    reset(state) {
        this.vec.fill(0);
        this.hist.fill(-1);
        this.t = 0;
        facelet1Hot(state, this.vec, 0);
        this._extras();
        return this.vec;
    }
    push(state, moveLocal, budget) {
        facelet1Hot(state, this.vec, 0);
        if (this.L.hist > 0) {
            for (let i = this.L.hist - 1; i > 0; i--) this.hist[i] = this.hist[i - 1];
            this.hist[0] = moveLocal;
        }
        this.t++;
        this.budget = budget;
        this._extras();
        return this.vec;
    }
    _extras() {
        const L = this.L;
        let at = L.extrasAt;
        for (let i = 0; i < L.hist; i++) {
            for (let m = 0; m < L.nMoves; m++) this.vec[at + m] = this.hist[i] === m ? 1 : 0;
            at += L.nMoves;
        }
        if (L.extras > L.hist * L.nMoves) {
            this.vec[at] = Math.min(1, this.t / (this.budget || 20)) * 2 - 1;
        }
    }
}

/* ------------------------------------------------------------- the ratchet */

/* Extend the curriculum when — and only when — the champion has actually earned
 * it, measured on scrambles nothing trained on.
 *
 * The promotion test is the champion's solve rate at the *current frontier
 * depth* on a held-out bank, not its fitness and not its solve rate over the
 * whole mixed diet (which a brain can hold up by being excellent at depth 1
 * forever). The gate bank rotates on staleness as well as on promotion: a gate
 * that only moves when somebody passes it can deadlock on a lucky draw, which is
 * a failure this project has already diagnosed once and written down.
 */
class Ratchet {
    constructor(cfg) {
        this.depth = cfg.startDepth || 1;
        this.threshold = cfg.threshold === undefined ? 0.75 : cfg.threshold;
        this.games = cfg.games || 64;
        this.maxDepth = cfg.maxDepth || 8;
        /* One-sided z for the promotion test below. 1.64 ≈ 95%. */
        this.z = cfg.z === undefined ? 1.64 : cfg.z;
        this.epoch = 0;
        this.history = [];
    }

    /* Promote on the *lower confidence bound* of the probe, not on the probe.
     *
     * The naive rule — "promote when the observed rate clears the threshold" — is a
     * multiple-comparisons machine. The probe runs every 10 generations, so a long
     * run takes fifty-odd shots at it, and it promotes on the first success. With 96
     * games a brain at 58% has a probe standard error of 5 points, so a 75% reading
     * is roughly a 3σ event: unlikely once, not unlikely over fifty tries.
     *
     * That is not hypothetical. A run here promoted from depth 3 to depth 4 on a
     * single 77%-of-96 reading, and the same champion measured 58.2% ± 2.0 on 600
     * fresh cubes immediately afterwards. The frontier advanced; the skill had not.
     * A curriculum that ratchets on noise then trains on cubes the brain cannot do,
     * and the rung it supposedly cleared quietly rots.
     *
     * Requiring `observed − z·SE ≥ threshold` fixes it at the right place: it is a
     * statement about the brain rather than about this particular bank, and it costs
     * only a few more probes when the brain really is ready. At 96 games and a 75%
     * threshold it wants about 82% observed.
     */
    passes(rate) {
        const n = Math.max(1, this.games);
        const se = Math.sqrt(Math.max(1e-9, rate * (1 - rate)) / n);
        return rate - this.z * se >= this.threshold;
    }

    /* What the observed rate would have to be, for the log line. */
    needed() {
        for (let p = this.threshold; p <= 1.0001; p += 0.005) {
            if (this.passes(Math.min(1, p))) return Math.min(1, p);
        }
        return 1;
    }
    /* `probe(depth, games, seed)` must run the champion on a fresh bank of that
     * exact depth and return its solve rate. */
    check(probe, gen) {
        if (this.depth >= this.maxDepth) return null;
        const seed = 5000003 + this.epoch * 7919 + this.depth * 131;
        const rate = probe(this.depth, this.games, seed);
        this.epoch++;
        this.lastRate = rate;
        if (this.passes(rate)) {
            this.depth++;
            this.history.push({ gen, depth: this.depth, rate });
            return { promoted: true, depth: this.depth, rate };
        }
        return { promoted: false, depth: this.depth, rate };
    }
}

/* No require() here on purpose. This file names identifiers that cube.js,
 * vision.js, nn.js and rewards.js declare at their top level, which resolves in
 * exactly two situations: the browser, where each file is a plain <script> in one
 * global scope, and Node under load.js, which concatenates the same files into
 * one vm scope. Every Node entry point in this folder goes through load.js, so
 * there is one loading discipline rather than two subtly different ones. */
if (typeof module !== "undefined" && typeof require !== "undefined" && require.main === module) {
    console.error("env.js is not standalone — load it through load.js (see train_headless.js).");
    process.exit(1);
}
