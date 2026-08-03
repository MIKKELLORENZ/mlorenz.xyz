/* evolution.js — the genetic algorithm. No gradients, ever.
 *
 * Straight port of the scheme that worked in the smart_ocean_boats sim, because
 * every piece of it was paid for there in dead runs:
 *
 *   1. a few elites survive byte-for-byte — rank 0 is always an unmutated copy
 *      of the best walker of the generation, whatever else happens
 *   2. a handful of mutated elite copies try to improve on them
 *   3. elites breed with each other (row-wise crossover + light mutation)
 *   4. the rest come from rank-weighted parents across the better half, with
 *      mutation strength growing down the ranks — a gradient of risk
 *   5. a couple of fresh random brains keep the pool honest early, tapering to
 *      zero as the best-ever fitness climbs past immZeroFit
 *
 * Two fitness gates narrow the search as a run matures:
 *   · past immZeroFit  — no more random immigrants
 *   · past childZeroFit — no more crossover either; pure hill-climbing from here
 *
 * Champion grace: the reigning champion keeps an untouched seat for a few
 * generations even after being beaten. Walking scores are noisy (one lucky
 * non-fall is worth hundreds of points), and without grace a single unlucky
 * episode deletes a genuinely better brain.
 *
 * ------------------------------------------------------------------------
 * STEP SIZE. The single most expensive lesson in this file, and it cost a
 * 350-generation run that learned nothing at all.
 *
 * The mutation defaults were inherited from the boats sim: rate 0.10, sigma
 * 0.15. On this problem they are catastrophic. Measured directly — champion
 * versus 24 of its own offspring, all run on the SAME three missions so the
 * mission cancels out of the comparison:
 *
 *     rate  sigma |  within 5% of parent | better than parent
 *     0.10  0.150 |                   0% |                 0%
 *     0.06  0.080 |                   4% |                 4%
 *     0.04  0.050 |                  33% |                13%
 *     0.03  0.030 |                  54% |                38%
 *     0.02  0.015 |                  75% |                63%
 *
 * At the settings the run was using, not one child in twenty-four landed
 * anywhere near its parent. The hill-climb had no uphill move available: the
 * four unmutated elites survived, every one of their offspring was destroyed,
 * and the population mean fell from 1,182 in generation 1 (random brains with
 * near-zero weights, which simply stand) to ~750 three hundred generations
 * later. Selection was not slow, it was disconnected.
 *
 * The defaults are now 0.035 / 0.04, which sits at roughly a 20% success rate
 * — the classic 1/5th rule. Note that the smaller step also finds BETTER
 * peaks, not just safer ones: the best of 24 children rises from 1,902 at
 * 0.10/0.15 to 2,657 at 0.04/0.05, against a parent at 2,302. There was no
 * exploration being bought with the large step. It was pure damage.
 */
"use strict";

/* One source of truth for the step size, read by the browser sliders, the
 * headless trainer and the regression test that guards it. */
const MUT_DEFAULT = { rate: 0.035, sigma: 0.04 };

/* ---- the elite-mutant fleet -------------------------------------------------
 *
 * Counting one generation of 192 seats found this:
 *
 *     4  elites untouched ........................ 0 weights changed
 *     8  elites mutated (full rate) .............. 708
 *     8  elite x elite (half rate) ................ 354
 *   170  rank-weighted children .................. 547-983
 *     2  fresh random ............................. 0
 *
 * Two things are wrong with that. Only 8 seats in 192 — 4.2% — carry a direct
 * experiment on the champion; everything else is recombination noise around it.
 * And the smallest non-zero move in the entire population is 354 weights, so
 * the population cannot refine, only jump. Every mutated child receives the
 * same size of change to within a standard deviation of 26.
 *
 * The fleet replaces those 8 seats with ~17% of the population, dealt across a
 * 2-D lottery: how MANY weights change, and how HARD each one moves. The two
 * axes are drawn independently and deliberately so — a sparse-and-weak child is
 * a refinement, a sparse-and-strong child is a targeted jump, and those are
 * different experiments that a single rate/sigma pair cannot express.
 *
 * Density is dealt by STRATIFIED BAND, not sampled. Same reasoning as quota()
 * for episodes and for the same reason: 33 independent draws over two decades
 * of k would leave whole generations with no refiner in them by luck, and a
 * band that goes missing looks exactly like a band that does not work.
 *
 * Bands are log-spaced because k spans 25..1100 — uniform sampling would put
 * almost everything at the top end.
 *
 * The sigma clamps TIGHTEN as density rises, and that is not symmetry for its
 * own sake. See the note on the risk gradient further down: sigma at 2.4x
 * across a dense mutation put the whole bottom half of the population past the
 * point where any offspring survives, so half the compute produced corpses.
 * Sparse mutations can afford to be violent because they are only moving 25
 * weights; dense ones cannot. */
const ELITE_MUT_FRAC = 0.17;
const K_BANDS   = [[25, 60], [60, 180], [180, 450], [450, 1100]];
const SIG_CLAMP = [[0.25, 4.0], [0.25, 3.0], [0.35, 2.0], [0.40, 1.5]];
const SIG_SPREAD = 0.55;    // lognormal width: 68% of draws land in 0.58x..1.73x
const ROW_FOCUS_P = 0.5;    // share of the two SPARSE bands spent inside one neuron

/* ------------------------------------------------- parallel search tracks
 *
 * When the run stops improving, the mutation operator is usually why: too timid
 * and every child lands back in the basin it came from, too wild and none of
 * them survive long enough to be measured. Which one is wrong is not knowable
 * in advance — it depends on the stage, the terrain and how converged the pool
 * already is — so the run finds out by experiment rather than by my guess.
 *
 * A plateau splits part of the population into independent TRACKS. Each is
 * seeded from the current leader, breeds under its own hyperparameters, and is
 * left alone for a long stretch of generations to see where it gets to. The
 * point is that a track accumulates its own progress: a different mutation
 * setting may be worse for one generation and better after forty, and only
 * something that is allowed to run can show that. A track that beats the leader
 * takes the crown and its settings become the run's; a track that does not is
 * dissolved and the next set of settings is tried.
 *
 * MULTIPLIERS on whatever the run is currently using, not absolute values, so
 * successive rounds walk somewhere new instead of re-testing the same points
 * forever. The schedule is ordered roughly by how different each recipe is from
 * business as usual: mild variations first, then the disruptive ones, so a
 * plateau that needs only a nudge is not answered with a shakeup. */
const TRACK_RECIPES = [
    { name: "more sites", rm: 2.0, sm: 1.0 },
    { name: "bigger steps", rm: 1.0, sm: 2.0 },
    { name: "gentler", rm: 0.5, sm: 0.6 },
    { name: "many tiny tweaks", rm: 2.5, sm: 0.5 },
    { name: "few big jumps", rm: 0.6, sm: 2.5 },
    { name: "aggressive", rm: 3.5, sm: 1.8 },
    { name: "shakeup", rm: 5.0, sm: 3.0 },
    { name: "mild all-round", rm: 1.4, sm: 1.4 }
];
/* Absolute limits a track may not leave. Measured the hard way: raising
 * mutation to 0.035/0.050 to escape a local minimum collapsed standing from
 * 100% to 22% in a single run. The ceiling stops a recipe repeating that, the
 * floor stops one tuning itself into stasis. */
const TRACK_RATE_LIMITS = [0.004, 0.12];
const TRACK_SIGMA_LIMITS = [0.008, 0.20];
/* How many of a round's final generations decide the verdict. The comparison is
 * paired — every brain alive in a generation ran the same missions — so
 * averaging over this many mission sets is what makes "it beat the leader" mean
 * something other than one lucky draw. */
const TRACK_JUDGE_GENS = 12;

/* ------------------------------------------------------- activation demes
 *
 * The hidden activation is a per-brain gene (see nn.js for why tanh is the
 * default and why that is an argument rather than evidence). This is the
 * experiment that turns it into evidence.
 *
 * The main line is partitioned into fixed DEMES, one per activation, each bred
 * entirely within itself. Same discipline as the plateau tracks and for the
 * same reason: the question is where a lineage GETS TO under an activation
 * after hundreds of generations, and a deme that imports its neighbours' brains
 * answers a different and easier question. Crossing acts is meaningless anyway
 * — the identical row of weights computes a different function under each — so
 * Net.crossover refuses it.
 *
 * The comparison is PAIRED by construction: every deme is scored on the same
 * stratified mission bank in the same generation, so the mission draw cancels
 * out of "which activation is ahead". That matters more here than usual — this
 * project has an 18.7x mission-luck swing on an unchanged brain, and an
 * unpaired activation comparison would be measuring the calendar again.
 *
 * WHY A ONE-SHOT CULL AND NOT A BANDIT. The obvious design reallocates seats
 * every generation toward whichever deme is ahead. That is a bandit over a
 * categorical arm, and this project has already been bitten by bandit
 * accounting: early leads on a noisy objective are mostly luck, seats follow
 * the luck, and the arm that was starved can never demonstrate otherwise. So
 * the split is FIXED and equal for actCull generations — long enough for a
 * lineage to show what it does rather than how it started — and then decided
 * once, on a smoothed paired margin, after which the whole population goes to
 * the winner and the run is a normal single-activation GA for the rest of its
 * life. One decision, made on the most evidence available, at the point where
 * continuing to pay for the losers stops being worth it. */
const DEME_JUDGE_GENS = 40;   // generations of paired history the cull decides on

/* ------------------------------------------------- per-surface normalisation
 *
 * Measured on the gen-676 champion at stage 4, full difficulty, 24 episodes:
 *
 *     rolling   37% of the bank   3.33 wp   9.92 m   88.8% of all fitness
 *     mixed     29%               0.14 wp   0.59 m    6.2%
 *     stairs    33%               0.00 wp   0.44 m    5.0%
 *
 * A third of every generation is spent on stairs and it decides a twentieth of
 * the score. A mutation that doubled the fleet's stairs distance would earn a
 * few hundred points on the bank mean, while one rolling episode swings by
 * thousands on mission luck alone — so the improvement is indistinguishable
 * from noise and cannot be selected for. Stairs are not being learned slowly;
 * they are invisible to selection.
 *
 * WHAT IS EQUALISED IS SPREAD, NOT MEAN. A constant offset does not change a
 * ranking, so the surface that dominates selection is the one whose scores VARY
 * most, not the one that scores highest. Rolling runs 0 to 9 waypoints; stairs
 * sit flat near zero on every brain. Rescaling each surface to a common spread
 * is therefore the change that makes a rare improvement on stairs worth as much
 * as an equally rare one on rolling.
 *
 * Recentred and rescaled rather than z-scored, so the result stays in fitness
 * units: the immigrant and crossover gates compare the champion against
 * absolute thresholds (6k, 15k), and a z-score would silently disable both.
 *
 * The comparison is paired by construction — the stratified bank gives every
 * brain in a generation the identical surface in the identical slot — which is
 * what makes a population statistic per surface meaningful at all.
 */
function normaliseBySurface(perEp, surfaces, opts) {
    const n = perEp.length;
    if (!n || !surfaces || !surfaces.length) return perEp.map(r => mean(r));
    const groups = new Map();
    for (let e = 0; e < surfaces.length; e++) {
        if (!groups.has(surfaces[e])) groups.set(surfaces[e], []);
        groups.get(surfaces[e]).push(e);
    }
    const keys = [...groups.keys()];
    // One surface in the bank is the old behaviour exactly.
    if (keys.length < 2) return perEp.map(r => mean(r));

    // Each brain's mean on each surface.
    const per = keys.map(k => {
        const slots = groups.get(k);
        return perEp.map(r => {
            let s = 0, c = 0;
            for (const e of slots) if (r[e] != null) { s += r[e]; c++; }
            return c ? s / c : 0;
        });
    });
    const mu = per.map(mean);
    const sd = per.map((col, i) => {
        let s = 0;
        for (const v of col) s += (v - mu[i]) * (v - mu[i]);
        return Math.sqrt(s / Math.max(1, col.length));
    });
    const muAll = mean(mu), sdRef = mean(sd);
    /* A surface on which the whole fleet scores identically carries no
     * information, and dividing by its ~zero spread would amplify pure
     * floating-point noise into the dominant term — the exact failure this
     * function exists to prevent, inverted. Below the floor, pass it through
     * unscaled. */
    const floor = Math.max(1e-6, sdRef * 0.02);
    const out = new Array(n).fill(0);
    for (let i = 0; i < keys.length; i++) {
        const k = sd[i] > floor ? sdRef / sd[i] : 1;
        for (let b = 0; b < n; b++) out[b] += muAll + (per[i][b] - mu[i]) * k;
    }
    for (let b = 0; b < n; b++) out[b] /= keys.length;
    return out;
}
function mean(a) { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : 0; }

class Evolution {
    constructor(popSize, seed, acts, opts) {
        this.popSize = popSize;
        this.gen = 1;
        this.rng = mulberry32(seed || 42);

        const names = (acts && acts.length ? acts : ["tanh"]).filter(a => ACT_NAMES.indexOf(a) >= 0);
        const list = names.length ? names : ["tanh"];
        /* INTERBREEDING MODE. One pool, seeded across the listed activations,
         * with no isolation at all — ReLU and leaky ReLU parents cross freely
         * and their children are mixed neuron by neuron (see Net.crossover).
         *
         * This is a different experiment from the demes, and deliberately so.
         * The demes ask "which of these is better" and answer it with a clean
         * paired margin. A single interbreeding pool asks "what proportion does
         * selection settle on", which is a richer question but WEAKER evidence:
         * a GA sweeps whole genomes, so a slope's share can rise by hitchhiking
         * on an unrelated good mutation rather than on its own merit. The share
         * is worth watching and is not worth over-reading — treat a drift from
         * 50% as a hint, not a result. It only mixes rectifiers; tanh is a
         * whole-network activation and Net.crossover still refuses it. */
        this.interbreed = !!(opts && opts.interbreed) && list.length > 1 && list.indexOf("tanh") < 0;
        /* The slope-flip mutation belongs to interbreeding and only to it — in
         * deme mode it would turn each "pure ReLU" deme into a hybrid pool and
         * the A/B would stop measuring what it claims to. */
        setSlopeFlip(this.interbreed ? 0.002 : 0);

        /* Demes partition the MAIN line by POSITION, and position is the only
         * record of which activation a seat belongs to — `brains` carries the
         * gene on each net, but the breeding code has to know the block
         * boundaries before it sorts anything. Sizes are dealt out by remainder
         * so three demes of a population of 289 come out 97/96/96 rather than
         * silently dropping a seat. Interbreeding collapses this to one deme,
         * which is what makes the whole pool a single breeding population. */
        this.demes = this.interbreed
            ? [{ act: "mixed", n: popSize, hist: [] }]
            : list.map(a => ({ act: a, n: 0, hist: [] }));
        if (!this.interbreed) for (let i = 0; i < popSize; i++) this.demes[i % this.demes.length].n++;
        this.demeEvent = null;
        this.culled = false;

        this.brains = [];
        if (this.interbreed) {
            // Alternate so the founding pool is an even mix and neither
            // rectifier starts with a numerical advantage.
            for (let i = 0; i < popSize; i++) this.brains.push(new Net(NET_SIZES, this.rng, list[i % list.length]));
        } else {
            for (const d of this.demes) {
                for (let i = 0; i < d.n; i++) this.brains.push(new Net(NET_SIZES, this.rng, d.act));
            }
        }
        /* ---- rise trials ----
         *
         * Every Nth generation the whole population becomes minor variations of
         * each deme's own elite, every episode spawns on the floor, and ranking
         * switches from the fitness ledger to MEAN COM HEIGHT. For one generation
         * the only question asked is "which of these near-identical brains gets
         * highest and stays there", which is a far cleaner signal than the rise
         * component buried inside a ledger that also pays for walking.
         *
         * The next generation breeds from the winners, so the pressure reaches
         * the lineage — but a rise trial never updates the champion, never
         * advances the stage and is excluded from the charts, because its numbers
         * describe a different exam. Same treatment as a rehearsal generation and
         * for the same reason.
         *
         * The variations are deliberately MINOR. One generation of rise-only
         * selection on near-clones can only nudge the lineage; it cannot trade
         * away walking, because there is nothing far enough from the elite in the
         * pool to trade it for. That bound is what makes an alternating objective
         * safe here — 1 generation in 10, each a small step.
         *
         * 0 disables. Skipped while plateau tracks are open: those are a separate
         * experiment on a shared population and a rise trial would contaminate
         * their measurement. */
        this.riseEvery = (opts && opts.riseEvery) | 0;
        this.risePose = (opts && opts.risePose) || "prone";
        this.riseEvent = null;

        this.history = [];
        this.champion = null;
        this.championFit = -1e18;
        this._injected = null;      // the champion's live seat, for paired scoring
        this.grace = null;
        this.graceIdx = -1;
        this.graceEvent = null;

        /* ---- island immigration ----
         * Migrants admitted from another island, kept alive as BREEDING STOCK
         * for a few generations rather than only as competitors.
         *
         * Dropping a migrant into the pool and leaving it there does almost
         * nothing: a brain from a young island ranks near the bottom, and
         * pickRank() draws parents from the better half only, so it is culled
         * having never once been a parent. The foreign structure arrives and is
         * deleted before anything can recombine with it — which is the entire
         * reason to run a second island.
         *
         * So a migrant gets a guaranteed quota of ELITE x MIGRANT crossings for
         * `life` generations. The hybrids are ordinary children: they take
         * bottom seats, they are scored on this island's missions, and they
         * survive only on merit. Nothing about the champion or the elites
         * changes — this buys the migrant an introduction, not a promotion. */
        this.migrants = [];         // [{net, born, life}]
        this.migrantCross = 0;      // hybrid seats per generation, 0 = off
        this.migrantEvent = null;

        // ---- plateau search tracks ----
        this.tuned = null;          // {rate, sigma} adopted from a track that won
        this.lastStage = null;      // fitness is not comparable across stages
        this.probeHoldUntil = 0;    // no new round before this generation
        this.round = null;          // the live round, if one is running
        this.recipeAt = 0;          // next recipe in TRACK_RECIPES to try
        this.probeEvent = null;     // one-line report for the trainer's log
        this.probeRounds = [];      // every finished round, and the evidence it decided on
        /* Layout of `brains`: the main line first, then each track's slice.
         * Everything downstream indexes into this, so it is the one description
         * of who is who and it is kept in step with `brains` by construction. */
        this.mainCount = popSize;
        this.tracks = [];           // [{n, rate, sigma, recipe, hist:[{best, champ}]}]
    }

    /* results: [{brain, fitness, ...}] for the generation just finished.
     * stats: the population summary that the curriculum reads back.
     * limits: {immZeroFit, childZeroFit, evalMode} */
    /* Is THIS generation a rise trial? The caller has to know before it runs any
     * episodes, because the answer changes how every world is built — floor pose,
     * no scaffold, flat ground. evolve() asks the same question afterwards, and
     * the answer cannot change in between: tracks only open at the end of an
     * evolve, so this.tracks describes the generation that just ran. */
    get isRiseTrial() {
        return this.riseEvery > 0 && this.gen > 1 &&
               this.gen % this.riseEvery === 0 && this.tracks.length === 0;
    }

    /* Fill the population with minor variations of each deme's elite, ready for
     * a rise trial. Called at the END of the generation BEFORE the trial, and the
     * ordering is the entire safety argument.
     *
     * IT WAS THE OTHER WAY ROUND, AND IT DESTROYED A LIVE RUN. The variations
     * were built AFTER the trial ranked, which meant the trial ranked the
     * ORDINARY population — a mix of good and bad walkers — on mean COM height
     * from a prone spawn. But mean COM from prone mostly measures body
     * CONFIGURATION, not skill: a brain that curls up sits higher than one lying
     * flat, whether or not it can walk. So the winner was an arbitrary poor
     * walker, the whole next generation became near-clones of it, and training
     * fitness fell from 21,653 to 781 in one generation.
     *
     * Seeding first fixes it by construction: every candidate in a trial is
     * already a near-clone of the elite, so whichever one rises best is still a
     * competent walker, and the worst case is a lineage nudged by a few hundred
     * weights. "Minor variations" has to bound the CHOICE OF PARENT, not just the
     * size of the mutation — bounding only the mutation was the mistake. */
    _riseSeed() {
        const rng = this.rng;
        const out = [];
        let off = 0;
        for (const d of this.demes) {
            const seats = this.brains.slice(off, off + d.n);
            off += d.n;
            if (!seats.length) continue;
            const elite = seats[0];                      // rank 0 is the untouched elite
            out.push(elite.clone());
            for (let i = 1; i < d.n; i++) {
                /* A spread of small steps rather than one size, same argument as
                 * the elite fleet: the useful step size is not knowable ahead of
                 * time. Capped well below the normal operator so one trial cannot
                 * move the lineage far. */
                const k = [25, 60, 150, 300][i & 3];
                const sig = MUT_DEFAULT.sigma * [0.4, 0.7, 1.0][i % 3];
                out.push(elite.clone().mutateSparse(k, sig, rng, (i & 4) === 0));
            }
        }
        if (out.length === this.brains.length) this.brains = out;
    }

    /* The trial generation itself. The population arriving here is already all
     * minor variations of the elite (see _riseSeed), so ranking on mean COM
     * height is safe: every candidate walks about as well as the elite did, and
     * the only thing being selected between them is who gets up.
     *
     * Breeding afterwards is the NORMAL operator, seeded by that ranking, so the
     * diversity a seeded generation gave up comes straight back. Leaving the
     * population as near-clones would turn one trial in ten into a permanent
     * bottleneck. */
    _riseTrial(allResults, mutRate, mutSigma, limits) {
        const rng = this.rng;
        const lim = limits || {};
        const out = [];
        let off = 0, bestMean = 0, worstMean = Infinity;
        for (const d of this.demes) {
            const seats = allResults.slice(off, off + d.n);
            off += d.n;
            if (!seats.length) continue;
            /* MEAN COM, not best-ever COM. A maximum pays for a spike that
             * collapses — measured on the quadruped rung, a thrashing controller
             * outscored one that simply held the pose, 107 to 95. */
            seats.sort((a, b) => (b.meanCom || 0) - (a.meanCom || 0));
            bestMean = Math.max(bestMean, seats[0].meanCom || 0);
            worstMean = Math.min(worstMean, seats[seats.length - 1].meanCom || 0);
            const made = this._breedDeme(seats, d.n, mutRate, mutSigma, rng,
                { immFrac: 0, noChildren: false, act: d.act });
            for (const b of made.brains) out.push(b);
        }
        this.brains = out;
        this.riseEvent = `rise trial: ${out.length} variations of the elite spawned ${this.risePose}, ` +
            `mean COM ${bestMean.toFixed(3)} m best / ${worstMean.toFixed(3)} m worst`;
        const rec = {
            gen: this.gen, riseTrial: true, risePose: this.risePose,
            best: bestMean, avg: bestMean, stage: this.lastStage || 1,
            riseMeanBest: bestMean, riseMeanWorst: worstMean
        };
        /* NOT pushed to this.history. stageFor() and the plateau detector both
         * read that array as a record of the ledger, and a rise trial's numbers
         * are metres of COM height — feeding them in would make the plateau test
         * compare two different units and the stage gate read a rise score as a
         * collapse. The trial is reported, charted separately, and otherwise
         * invisible to every mechanism that decides promotion. */
        this.gen++;
        return rec;
    }

    evolve(allResults, mutRate, mutSigma, gracePeriod, limits, stats) {
        if (this.isRiseTrial) return this._riseTrial(allResults, mutRate, mutSigma, limits);
        /* Split by POSITION before anything sorts, because position is the only
         * record of which line a brain belongs to. `allResults` arrives aligned
         * with `brains`, and the sort below destroys that alignment — reading
         * the partition afterwards would silently mix the tracks into the main
         * line and the whole experiment would measure nothing. */
        const trackResults = [];
        {
            let off = this.mainCount;
            for (const t of this.tracks) { trackResults.push(allResults.slice(off, off + t.n)); off += t.n; }
        }
        const results = allResults.slice(0, this.mainCount);

        /* Same argument one level down: the demes partition the main line by
         * position, so they have to be cut out before the sort destroys it. */
        const demeResults = [];
        {
            let off = 0;
            for (const d of this.demes) { demeResults.push(allResults.slice(off, off + d.n)); off += d.n; }
        }

        results.sort((a, b) => b.fitness - a.fitness);
        for (const tr of trackResults) tr.sort((a, b) => b.fitness - a.fitness);
        for (const dr of demeResults) dr.sort((a, b) => b.fitness - a.fitness);
        const lim = limits || {};
        const immZeroFit = lim.immZeroFit != null ? lim.immZeroFit : 6000;
        const childZeroFit = lim.childZeroFit != null ? lim.childZeroFit : 15000;

        // ---- champion grace bookkeeping ----
        const gp = gracePeriod | 0;
        this.graceEvent = null;
        let holderIdx = -1;
        if (gp <= 0) {
            this.grace = null;
        } else {
            if (this.grace) holderIdx = results.findIndex(r => r.brain === this.grace.net);
            if (!this.grace || holderIdx === -1) {
                this.grace = { net: results[0].brain, left: gp };
                holderIdx = 0;
                this.graceEvent = "grace: champion crowned";
            } else if (holderIdx === 0) {
                this.grace.left = gp;
            } else {
                this.grace.left--;
                if (this.grace.left <= 0) {
                    this.grace = { net: results[0].brain, left: gp };
                    holderIdx = 0;
                    this.graceEvent = "grace expired — title passes to the new best";
                } else {
                    this.graceEvent = `grace: beaten champion sheltered (${this.grace.left} gens left)`;
                }
            }
        }

        /* History records the MAIN line only. It is what plateau detection reads,
         * and a track breeding at five times the mutation rate produces wild
         * fitness in both directions — folded in, it would either mask a real
         * plateau or invent one, and either way the thing that decides whether
         * to keep searching would be measuring the search instead of the run. */
        const best = results[0];
        const avg = results.reduce((s, r) => s + r.fitness, 0) / results.length;
        const rec = Object.assign({ best: best.fitness, avg }, stats || {});

        /* Per-deme scores, recorded every generation whether or not a cull is
         * ever going to happen. They go into the history record and therefore
         * into runlog.json, which is what the dashboard draws — an activation
         * A/B whose evidence only exists in a variable is not an experiment. */
        for (let i = 0; i < this.demes.length; i++) {
            const dr = demeResults[i];
            const dn = dr.length || 1;
            this.demes[i].hist.push({
                best: dr.length ? dr[0].fitness : -1e18,
                avg: dr.reduce((s, r) => s + r.fitness, 0) / dn
            });
        }
        rec.demes = this.demes.map(d => {
            const h = d.hist[d.hist.length - 1];
            return { act: d.act, n: d.n, best: h.best, avg: h.avg };
        });

        /* Once the rectifiers interbreed, "which activation" stops being a label
         * and becomes a proportion: what fraction of hidden units leak, across
         * the whole pool and in the best individual. Both are recorded — the
         * pool mean is where selection is heading, the best individual is what
         * actually gets baked, and they do not have to agree. */
        if (this.interbreed) {
            let sum = 0, cnt = 0;
            for (const r of results) {
                const s = r.brain.leakyShare();
                if (s != null) { sum += s; cnt++; }
            }
            rec.leakyShare = cnt ? sum / cnt : null;
            rec.bestLeaky = best.brain.leakyShare();
        }
        this.history.push(rec);

        // ---- the champion, measured honestly ----
        // This used to be `if (best.fitness > this.championFit)` against a
        // running maximum, and that is a trap on a noisy objective. The same
        // fixed brain scores 1,031 to 2,934 across missions (sd 471), so a
        // record kept as a max over ~14,000 noisy samples settles ~4 sd above
        // the brain's true mean and can never be beaten honestly. The crown
        // then freezes on whichever brain won the lottery.
        //
        // The champion holds a live seat in the population, so it was already
        // re-scored on this generation's missions alongside everyone else.
        // That makes a PAIRED comparison available, and a paired comparison on
        // identical missions is the only fair one. `championFit` is therefore
        // a current measurement, not a high-water mark, and it is allowed to
        // fall when the missions are hard.
        const champSeat = this._injected ? results.find(r => r.brain === this._injected) : null;
        let newLeader = false;
        if (!this.champion || !champSeat) {
            this.championFit = best.fitness;
            this.champion = best.brain.clone();
            newLeader = true;
        } else if (best.fitness > champSeat.fitness) {
            this.championFit = best.fitness;
            this.champion = best.brain.clone();
            newLeader = true;
        } else {
            this.championFit = champSeat.fitness;
        }
        if (newLeader) this.lastLeaderGen = this.gen;

        /* ---- the activation cull, once ----
         * Deliberately BEFORE the plateau machinery: a cull replaces two thirds
         * of the population, which is exactly the kind of reshuffle the plateau
         * detector is not supposed to read as progress or as a stall. Judging
         * it here means `probeHoldUntil` is set before anything looks. */
        this.demeEvent = null;
        let culledSrc = null;
        if (!this.culled && this.demes.length > 1 &&
            lim.actCull > 0 && this.history.length >= lim.actCull) {
            culledSrc = this._cullDemes(demeResults);
            this.probeHoldUntil = Math.max(this.probeHoldUntil, this.gen + (lim.plateauGens || 100));
        }

        /* ---- plateau detection and the track lifecycle ----
         *
         * NOT "the crown changed hands". That reads as the natural definition and
         * it is useless: the crown passes when the generation's best beats the
         * champion's own re-measured score, and best-of-512 beats one noisy
         * sample of anything nearly always. Measured on a fleet with zero real
         * improvement, the champion was replaced in 200 of 200 generations. A
         * plateau defined that way would never once be detected.
         *
         * So a plateau is what it actually means: the main line's best fitness
         * has stopped going up. Compared as the mean of the last few generations
         * against the mean of the few that ended `plateauGens` ago — smoothed,
         * because a single generation's best is an order statistic and swings
         * hundreds of points on mission luck alone. */
        this.probeEvent = null;
        const pl = lim.plateauGens != null ? lim.plateauGens : 100;
        const tgens = lim.trackGens != null ? lim.trackGens : 50;
        const tfrac = lim.trackFrac != null ? lim.trackFrac : 0.36;
        const nTracks = lim.trackCount != null ? lim.trackCount : 3;

        /* Fitness is not comparable across stages — a promotion changes what the
         * numbers mean — so a stage change restarts the window rather than
         * registering as a jump or a collapse in progress. */
        const W = Math.max(5, Math.floor(pl / 4));
        const stage = stats && stats.stage != null ? stats.stage : null;
        if (stage !== null && stage !== this.lastStage) {
            this.lastStage = stage;
            /* Hold for the FULL span the comparison reaches back over, pl + W,
             * not just pl. At pl alone the window still had one foot on the far
             * side of the promotion, so it compared post-promotion scores against
             * pre-promotion ones, saw the collapse every promotion causes, and
             * called it a stall — a search for a problem that did not exist. */
            this.probeHoldUntil = this.gen + pl + W;
        }

        if (this.round) {
            // Record this generation's paired comparison for every live track.
            const champScore = champSeat ? champSeat.fitness : best.fitness;
            for (let i = 0; i < this.tracks.length; i++) {
                const tr = trackResults[i];
                this.tracks[i].hist.push({ best: tr && tr.length ? tr[0].fitness : -1e18, champ: champScore });
            }
            this.round.gens++;
            if (this.round.gens >= tgens) this._judgeRound(trackResults, results);
        } else if (pl > 0 && this.gen >= this.probeHoldUntil) {
            const h = this.history;
            if (h.length >= pl + W) {
                const mean = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += h[i].best; return s / (b - a); };
                const recent = mean(h.length - W, h.length);
                const older = mean(h.length - pl - W, h.length - pl);
                // 2% of headroom, so ordinary drift is not mistaken for progress.
                if (recent <= older * 1.02) {
                    this._openRound(nTracks, tfrac, tgens, mutRate, mutSigma, recent, older, pl);
                    this.round.settle = W;
                }
            }
        }

        const rng = this.rng;
        /* Everything below breeds the MAIN line, at the adopted settings once a
         * track has won some; the values passed in are only the starting point.
         * The tracks are bred separately, at the bottom, each under its own. */
        if (this.tuned) { mutRate = this.tuned.rate; mutSigma = this.tuned.sigma; }
        const n = this.popSize - this.tracks.reduce((s, t) => s + t.n, 0);
        const immFrac = immZeroFit > 0 ? Math.max(0, Math.min(1, 1 - this.championFit / immZeroFit)) : 1;
        const noChildren = childZeroFit > 0 && this.championFit >= childZeroFit;

        /* Deal the main line's seats across the demes. When a plateau round is
         * open the main line shrinks, and it has to shrink EVENLY — handing the
         * whole reduction to one deme would change what the activation
         * comparison is measuring halfway through it. */
        const sources = culledSrc ? [culledSrc] : demeResults;
        const sizes = this.demes.map(() => Math.floor(n / this.demes.length));
        for (let i = 0; i < n - sizes.reduce((s, x) => s + x, 0); i++) sizes[i % sizes.length]++;

        const next = [];
        const blocks = [];               // {off, n, elites} per deme, for seating
        for (let i = 0; i < this.demes.length; i++) {
            const dn = sizes[i];
            this.demes[i].n = dn;
            const src = sources[i] && sources[i].length ? sources[i] : results;
            const off = next.length;
            const made = this._breedDeme(src, dn, mutRate, mutSigma, rng, { noChildren, immFrac, act: this.demes[i].act });
            for (const b of made.brains) next.push(b);
            blocks.push({ off, n: dn, elites: made.elites, fresh: made.fresh });
        }

        /* Seat the grace holder and the champion INSIDE THEIR OWN DEME. Both
         * carry an activation, and dropping a tanh champion into the lrelu
         * block would put a brain in a deme whose result no longer describes
         * that deme — the comparison would quietly start measuring a mixture. */
        const blockOf = act => {
            const i = this.demes.findIndex(d => d.act === act);
            return i >= 0 ? blocks[i] : blocks[0];
        };

        // ---- seat the grace holder ----
        this.graceIdx = -1;
        if (gp > 0 && this.grace) {
            const blk = blockOf(this.grace.net.act);
            // holderIdx indexes the sorted MAIN line; it only tells us the
            // holder is still the overall best, in which case its deme's own
            // rank-0 elite is already an untouched copy of it.
            if (holderIdx === 0 && next[blk.off].act === this.grace.net.act) {
                this.grace.net = next[blk.off];
                this.graceIdx = blk.off;
            } else {
                const slot = blk.off + Math.max(blk.elites, blk.n - blk.fresh - 1);
                const clone = this.grace.net.clone();
                next[slot] = clone;
                this.grace.net = clone;
                this.graceIdx = slot;
            }
        }

        // ---- re-inject the best-ever brain, byte for byte ----
        // Saving the champion to disk is not enough: without a live seat in the
        // breeding pool, selection noise drifts the population away from it and
        // the run silently regresses. This is the single highest-value line in
        // the file. `evalMode` additionally freezes it (never mutated).
        this._injected = null;
        if (this.champion && (lim.evalMode || lim.injectChampion !== false)) {
            const blk = blockOf(this.champion.act);
            const slot = blk.off + (lim.evalMode ? Math.max(0, blk.elites - 1)
                                                 : Math.max(blk.elites, blk.n - blk.fresh - 2));
            next[slot] = this.champion.clone();
            // Remembered by identity so next generation can find this exact
            // seat's score and compare the champion against the new best on
            // equal missions. Without this the crown is decided by luck.
            this._injected = next[slot];
        }

        /* ---- the tracks, each bred entirely within itself ----
         *
         * No brain and no gene crosses between a track and the main line while a
         * round is running. That isolation is the experiment: the question is
         * where a lineage GETS TO under a different mutation setting after tens
         * of generations, and a track that keeps importing the main line's best
         * would answer a different, easier question and always come back saying
         * roughly "the same place you did".
         *
         * The main line above is already complete and untouched by this, so a
         * round can cost the run some of its breeding capacity but never its
         * champion. */
        this.mainCount = next.length;
        for (let i = 0; i < this.tracks.length; i++) {
            const t = this.tracks[i];
            const src = trackResults[i];
            if (!src || !src.length) {
                // First generation of a fresh round: sow the track from the
                // leader, keeping two unmutated so a bad draw cannot wipe out
                // the starting point before the track has run at all.
                const seed = this.champion || results[0].brain;
                for (let k = 0; k < t.n; k++) {
                    next.push(k < 2 ? seed.clone() : seed.clone().mutate(t.rate, t.sigma, rng));
                }
            } else {
                for (const b of this._breedTrack(src, t, rng)) next.push(b);
            }
        }

        this.brains = next;
        /* If the NEXT generation is a rise trial, replace the population with
         * minor variations of the elite now. Doing this after the trial instead
         * of before it is what collapsed a live run from 21,653 to 781 — see
         * _riseSeed. */
        /* gen++ is BELOW, so this.gen is still the generation that just ran and
         * the population being built belongs to this.gen + 1. Testing this.gen
         * here silently seeded nothing at all — caught by the ordering test. */
        const nextGen = this.gen + 1;
        if (this.riseEvery > 0 && nextGen > 1 && nextGen % this.riseEvery === 0 && !this.tracks.length)
            this._riseSeed();
        this.gen++;
        return rec;
    }

    /* Breed one activation deme from its own members only.
     *
     * This is the main line's original breeding recipe, lifted verbatim into a
     * function so that a run with a single deme (--acts tanh) produces exactly
     * what it produced before demes existed. The only additions are that
     * immigrants are born with the deme's activation, and that the counts scale
     * off the deme's own size rather than the whole population's. */
    /* Take in a migrant as BREEDING STOCK ONLY. It never takes a seat.
     *
     * An earlier version also seated a few pristine copies so the migrant could
     * be judged as itself. That is exactly what must not happen here: a foreign
     * genome is not allowed to persist on this island unchanged. It has to be
     * recombined with what is already here, and only the children compete.
     *
     * So the migrant lives in `migrants`, outside the population — never
     * evaluated, never ranked, never eligible to become champion — and its only
     * effect is the elite crossings it fathers while its window is open. When
     * the window closes the foreign genome is gone unless it survived inside a
     * child that earned its seat. */
    admitMigrant(net, life) {
        this.migrants.push({ net: net.clone(), born: this.gen, life: Math.max(1, life | 0 || 1) });
        return this.migrants.length;
    }

    /* Migrants still inside their window. Expiry is by generation, not by count,
     * so a burst of arrivals cannot crowd the pool indefinitely. */
    _liveMigrants() {
        this.migrants = this.migrants.filter(m => this.gen - m.born < m.life);
        return this.migrants;
    }

    _breedDeme(sorted, n, mutRate, mutSigma, rng, o) {
        const ELITES = Math.min(4, n);
        const ELITE_MUT = Math.max(4, Math.round(n * ELITE_MUT_FRAC));
        const ELITE_CROSS = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const FRESH_MAX = n >= 32 ? 2 : 1;
        const FRESH = Math.round(FRESH_MAX * o.immFrac);
        const noChildren = o.noChildren;

        const out = [];
        for (let i = 0; i < ELITES && out.length < n; i++) out.push(sorted[Math.min(i, sorted.length - 1)].brain.clone());
        /* The fleet. Band is assigned by position, not drawn, so every generation
         * contains all four densities; only k within the band and the strength
         * are random. Draw order — parent, k, sigma, rowFocus, then the mutation
         * itself — must match breedDeme in evolution.hpp exactly. */
        for (let i = 0; i < ELITE_MUT && out.length < n; i++) {
            const band = i % K_BANDS.length;
            const p = sorted[Math.min((rng() * ELITES) | 0, sorted.length - 1)].brain.clone();
            const kb = K_BANDS[band];
            const k = Math.max(1, Math.round(Math.exp(
                Math.log(kb[0]) + (Math.log(kb[1]) - Math.log(kb[0])) * rng())));
            const sc = SIG_CLAMP[band];
            const sm = Math.min(sc[1], Math.max(sc[0], Math.exp(gaussRand(rng) * SIG_SPREAD)));
            const row = band <= 1 && rng() < ROW_FOCUS_P;
            out.push(p.mutateSparse(k, mutSigma * sm, rng, row));
        }
        const topPool = Math.min(6, sorted.length);
        for (let i = 0; i < ELITE_CROSS && out.length < n; i++) {
            if (noChildren) {
                const p = sorted[(rng() * topPool) | 0].brain.clone();
                out.push(p.mutate(mutRate * 0.5, mutSigma * 0.7, rng));
            } else {
                let a = (rng() * topPool) | 0, b = (rng() * topPool) | 0;
                if (b === a) b = (b + 1) % topPool;
                out.push(Net.crossover(sorted[a].brain, sorted[b].brain, rng)
                    .mutate(mutRate * 0.5, mutSigma * 0.7, rng));
            }
        }
        /* Elite x migrant. A guaranteed quota, because rank-weighted selection
         * will never produce one on its own — that is the whole point.
         *
         * The elite parent is drawn from the top pool and the migrant supplies
         * the other half of the neurons; row-wise crossover means the child
         * keeps whole functional units from each side rather than an average of
         * two unrelated controllers. Mutation is the gentle elite rate: the
         * recombination IS the experiment here, and piling full-strength
         * mutation on top would bury whatever the migrant contributed under
         * noise and make the result unreadable.
         *
         * Half the quota is crossed the other way round (migrant first), since
         * Net.crossover is not symmetric — the first parent supplies the rows
         * that are not swapped, so which one leads changes how much of each
         * survives. */
        /* NOT gated on noChildren, and that exemption is the whole feature.
         *
         * Past childZeroFit (15000) the run switches crossover off entirely and
         * hill-climbs. Island A's champion sits at 15165, so it does no
         * recombination at all — a migrant admitted into that pool can never
         * breed with anything no matter how it ranks, and the second island is
         * decorative. The gate exists to stop UNDIRECTED crossover once the
         * population has converged and two parents are near-copies of each
         * other; a migrant from another island is the opposite case by
         * construction, and mixing with it is the reason it was sent. */
        const live = this._liveMigrants();
        if (live.length && this.migrantCross > 0) {
            const quota = Math.max(1, Math.min(this.migrantCross | 0, Math.floor(n / 8)));
            let made = 0;
            for (let i = 0; i < quota && out.length < n; i++) {
                const m = live[(rng() * live.length) | 0].net;
                const e = sorted[(rng() * topPool) | 0].brain;
                const child = i % 2 === 0 ? Net.crossover(e, m, rng) : Net.crossover(m, e, rng);
                out.push(child.mutate(mutRate * 0.5, mutSigma * 0.7, rng));
                made++;
            }
            if (made) {
                this.migrantEvent = `${made} elite x migrant hybrids bred ` +
                    `(${live.length} migrant${live.length > 1 ? "s" : ""} in the breeding pool)`;
            }
        }
        const pickRank = () => {
            const r = Math.pow(rng(), 2.2);
            return Math.min(sorted.length - 1, (r * sorted.length * 0.55) | 0);
        };
        while (out.length < n - FRESH) {
            // A risk gradient down the ranks, but a narrow one. It used to run
            // 0.8x to 2.4x on sigma, which — see the table at the top — put the
            // whole bottom half of the population past the point where any
            // offspring survives, so half the compute produced nothing but
            // corpses. 0.7x to 1.6x keeps the tail adventurous and alive.
            const depth = out.length / n;
            const mr = mutRate * (0.7 + depth * 0.7), ms = mutSigma * (0.7 + depth * 0.9);
            if (noChildren) {
                out.push(sorted[pickRank()].brain.clone().mutate(mr, ms, rng));
            } else {
                const a = sorted[pickRank()].brain;
                const b = sorted[pickRank()].brain;
                out.push(Net.crossover(a, b, rng).mutate(mr, ms, rng));
            }
        }
        /* Immigrants. "mixed" is a label, not a constructible activation — a
         * newcomer has to be born one rectifier or the other, so it draws one.
         * Passing "mixed" straight to the constructor silently produced TANH
         * immigrants, which would have quietly reintroduced the activation the
         * run was told to drop. */
        while (out.length < n) {
            const a = o.act === "mixed" ? (rng() < 0.5 ? "relu" : "lrelu") : o.act;
            out.push(new Net(NET_SIZES, rng, a));
        }
        return { brains: out, elites: ELITES, fresh: FRESH };
    }

    /* Decide the activation once, on the most evidence the run will ever have.
     *
     * Judged on the SMOOTHED mean of each deme's best over the last
     * DEME_JUDGE_GENS generations, not on the best moment a deme ever had and
     * not on one generation. Every deme ran the identical mission bank in every
     * one of those generations, so this is a paired comparison — the only kind
     * worth making on an objective where the same unchanged brain swings 18.7x
     * on mission luck alone.
     *
     * `best` rather than `avg`: the run's product is its champion, and a deme
     * can carry a wide unproductive tail without that being a fault. */
    _cullDemes(demeResults) {
        const K = Math.min(DEME_JUDGE_GENS, Math.min(...this.demes.map(d => d.hist.length)));
        const judged = this.demes.map((d, i) => {
            const h = d.hist.slice(-K);
            const m = h.reduce((s, x) => s + x.best, 0) / (h.length || 1);
            return { i, d, mean: m, wins: 0 };
        });
        // How often each deme actually led, generation by generation — a mean
        // can be carried by one spike, and "led most weeks" is the claim.
        for (let g = 0; g < K; g++) {
            let bi = 0, bv = -Infinity;
            for (let i = 0; i < this.demes.length; i++) {
                const h = this.demes[i].hist;
                const v = h[h.length - K + g].best;
                if (v > bv) { bv = v; bi = i; }
            }
            judged[bi].wins++;
        }
        const rank = judged.slice().sort((a, b) => b.mean - a.mean);
        const win = rank[0];
        const report = rank.map(j => `${j.d.act} ${j.mean.toFixed(0)} (led ${j.wins}/${K})`).join(", ");

        const survivors = demeResults[win.i];
        const total = this.demes.reduce((s, d) => s + d.n, 0);
        /* The champion may belong to a deme that just lost. It cannot stay: the
         * run is a single-activation GA from here and its incumbent has to be a
         * brain of that activation, or the next generation seats a foreigner in
         * the only deme there is. */
        let championNote = "";
        if (this.champion && this.champion.act !== win.d.act) {
            const old = this.champion.act;
            this.champion = survivors[0].brain.clone();
            this.championFit = survivors[0].fitness;
            this.grace = null;
            championNote = `; the ${old} champion goes with it — ${win.d.act}'s best takes the crown at ${this.championFit.toFixed(0)}`;
        }

        this.demes = [{ act: win.d.act, n: total, hist: win.d.hist }];
        this.culled = true;
        this.demeEvent = `activation cull after ${this.history.length} gens on ${K} paired generations: ` +
            `${win.d.act.toUpperCase()} takes the whole population [${report}]${championNote}`;
        return survivors;
    }

    /* Breed one track from its own members only. Same shape as the main line —
     * elites, mutated elites, then rank-weighted crossover — but no immigrants
     * and no champion seat: a random newcomer would dilute the very thing being
     * measured, and the champion belongs to the main line. */
    _breedTrack(sorted, t, rng) {
        const n = t.n;
        const ELITES = Math.min(3, n);
        const MUT_ELITES = Math.min(6, Math.max(1, (n * 0.16) | 0));
        const out = [];
        for (let i = 0; i < ELITES && out.length < n; i++) out.push(sorted[i].brain.clone());
        for (let i = 0; i < MUT_ELITES && out.length < n; i++) {
            out.push(sorted[(rng() * ELITES) | 0].brain.clone().mutate(t.rate, t.sigma, rng));
        }
        const pick = () => {
            const r = Math.pow(rng(), 2.2);
            return Math.min(sorted.length - 1, (r * sorted.length * 0.55) | 0);
        };
        while (out.length < n) {
            const depth = out.length / n;
            const mr = t.rate * (0.7 + depth * 0.7), ms = t.sigma * (0.7 + depth * 0.9);
            const a = sorted[pick()].brain, b = sorted[pick()].brain;
            out.push(Net.crossover(a, b, rng).mutate(mr, ms, rng));
        }
        return out;
    }

    /* Split part of the population off into independent tracks. */
    _openRound(nTracks, tfrac, tgens, mutRate, mutSigma, recent, older, pl) {
        const base = {
            rate: this.tuned ? this.tuned.rate : mutRate,
            sigma: this.tuned ? this.tuned.sigma : mutSigma
        };
        const per = Math.max(12, Math.floor((this.popSize * tfrac) / nTracks));
        // Never let the tracks crowd the main line below half the population —
        // the main line still has to be a working GA while the search runs.
        const maxTotal = Math.floor(this.popSize * 0.45);
        const count = Math.max(1, Math.min(nTracks, Math.floor(maxTotal / per)));

        this.tracks = [];
        const names = [];
        for (let i = 0; i < count; i++) {
            const rc = TRACK_RECIPES[(this.recipeAt + i) % TRACK_RECIPES.length];
            this.tracks.push({
                n: per, recipe: rc.name,
                rate: Math.max(TRACK_RATE_LIMITS[0], Math.min(TRACK_RATE_LIMITS[1], base.rate * rc.rm)),
                sigma: Math.max(TRACK_SIGMA_LIMITS[0], Math.min(TRACK_SIGMA_LIMITS[1], base.sigma * rc.sm)),
                hist: []
            });
            names.push(`${rc.name} ${(base.rate * rc.rm).toFixed(3)}/${(base.sigma * rc.sm).toFixed(3)}`);
        }
        this.recipeAt = (this.recipeAt + count) % TRACK_RECIPES.length;
        this.round = { gens: 0, startGen: this.gen, base };
        this.probeEvent = `plateau: best fitness flat over ${pl} gens ` +
            `(${older.toFixed(0)} -> ${recent.toFixed(0)}) — splitting off ${count} x ${per} into tracks [${names.join(" | ")}] for ${tgens} gens`;
    }

    /* End a round: did any track's lineage actually overtake the leader?
     *
     * Judged on the mean over the round's last TRACK_JUDGE_GENS generations, not
     * on a single generation and not on the best moment the track ever had.
     * Every brain alive in a given generation ran the same missions, so
     * comparing a track's best against the champion's own re-measured score
     * generation by generation is a paired comparison; averaging a dozen of them
     * is what stops one lucky mission set crowning a track that is not actually
     * better. A track also has to have led in most of those generations, not
     * merely have out-averaged the leader on the strength of one spike. */
    _judgeRound(trackResults, mainResults) {
        const r = this.round;
        const judged = this.tracks.map((t, i) => {
            const h = t.hist.slice(-TRACK_JUDGE_GENS);
            const n = h.length || 1;
            const mt = h.reduce((s, x) => s + x.best, 0) / n;
            const mc = h.reduce((s, x) => s + x.champ, 0) / n;
            const wins = h.filter(x => x.best > x.champ).length;
            return { i, t, mt, mc, wins, of: h.length, margin: mt - mc };
        });
        const beat = judged.filter(j => j.margin > 0 && j.wins > j.of * 0.6)
            .sort((a, b) => b.margin - a.margin);

        const report = judged.map(j =>
            `${j.t.recipe} ${j.mt.toFixed(0)}v${j.mc.toFixed(0)} (${j.wins}/${j.of})`).join(", ");

        if (beat.length) {
            const w = beat[0];
            const src = trackResults[w.i];
            if (src && src.length) {
                this.champion = src[0].brain.clone();
                this.championFit = src[0].fitness;
            }
            this.tuned = { rate: w.t.rate, sigma: w.t.sigma };
            this.probeEvent = `track "${w.t.recipe}" OVERTOOK the leader after ${r.gens} gens ` +
                `(${w.mt.toFixed(0)} vs ${w.mc.toFixed(0)}, led ${w.wins}/${w.of}) — ` +
                `adopting it and mutation ${w.t.rate.toFixed(3)}/${w.t.sigma.toFixed(3)}. [${report}]`;
        } else {
            this.probeEvent = `no track beat the leader in ${r.gens} gens [${report}] — ` +
                `dissolving; next plateau will try ${TRACK_RECIPES[this.recipeAt % TRACK_RECIPES.length].name}`;
        }
        this.probeRounds.push({
            startGen: r.startGen, endGen: this.gen, gens: r.gens, base: r.base,
            adopted: beat.length ? this.tuned : null,
            tracks: judged.map(j => ({ recipe: j.t.recipe, rate: j.t.rate, sigma: j.t.sigma, track: j.mt, leader: j.mc, wins: j.wins, of: j.of }))
        });
        /* Dissolve either way, and let the plateau test speak again shortly. A
         * losing round therefore rolls straight into the next set of recipes —
         * the run is still flat, so the question still answers yes — while a
         * winning one only re-opens if the adoption failed to move anything.
         * That is the whole "try another set until something works" loop, and it
         * needs no separate state because it IS the plateau question re-asked.
         *
         * The short settle first: the population has just had a third of itself
         * replaced, so a handful of generations pass before the fleet's best is
         * a description of the run again rather than of the reshuffle. */
        this.probeHoldUntil = this.gen + (r.settle || 5);
        this.tracks = [];
        this.round = null;
    }

}

/* ------------------------------------------------------------------ curriculum */
/* Decides which stage the NEXT generation runs in. A stage advances on a
 * population-level milestone (what the fleet can actually do) or on a
 * generation fallback, whichever comes first — the same "or" that stopped the
 * boats sim from stalling forever below a threshold that was set too high.
 *
 * The milestones are deliberately population-wide fractions, not the best
 * walker's score: one lucky individual standing up does not mean the gene pool
 * is ready for shoves. */
const CURRICULUM = {
    balancedThr: 0.80,   // fleet fraction that stands and holds it -> shoves
    arrThr1: 0.30,       // mean waypoints per walker -> turning courses
    arrThr2: 1.20,       // -> the ground starts to tilt and step
    arrThr3: 2.20,       // -> the wind comes up
    // The generation fallbacks were set when standing took eighty generations
    // to learn. Under the rebuilt ladder the fleet is at 67% balanced by
    // generation 3, so eighty was spending most of a run drilling a skill it
    // had already banked — and stage 2 is where floor starts begin, so it was
    // also delaying the get-up rung by an hour of wall clock.
    stage2Gen: 50, stage3Gen: 400, stage4Gen: 620, stage5Gen: 800,
    // Floors the generation fallback may not cross. See stageFor().
    // floorProg3 is metres of honest closure by the average walker — the fleet
    // sat at ~0.6 m through its best stage-2 generations, so this floor holds it
    // where the waypoints are until walking is real rather than incidental.
    floor2: 0.30, floorProg3: 0.90, floor4: 0.02, floor5: 0.40,
    terrainProgFull: 2.0  // mean metres walked at which terrain reaches full difficulty
};

function stageFor(gen, history, cfg) {
    const c = Object.assign({}, CURRICULUM, cfg || {});
    if (c.stageLock) return { stage: c.stageLock, terrainDifficulty: c.terrainDifficulty != null ? c.terrainDifficulty : 1 };
    const recent = history.slice(-5);
    const mean = k => recent.length ? recent.reduce((a, h) => a + (h[k] || 0), 0) / recent.length : 0;
    // The ratchet only turns one way. An advanced stage makes life harder, so
    // the metric that triggered it dips right after — letting the stage fall
    // back produces a sawtooth that trains nothing.
    let s = history.length ? (history[history.length - 1].stage || 1) : 1;
    // Note the gate for stage 2 is "balanced", not "stood". Reaching full height
    // is nearly free (the newborn's trim pose IS standing), so gating on it
    // promoted the fleet into shove-testing at generation 2, before a single
    // walker could hold still. Every gate has to be something the stage below
    // it actually teaches.
    // The generation fallback exists so a threshold set too high cannot stall a
    // run forever. It is NOT licence to promote a fleet that cannot do the
    // stage below, and used unguarded that is exactly what it did: generation
    // 170 moved a population with 14% balancing (against a 80% gate) onto
    // 0.7-strength shoves and 112-degree course changes, and the log shows the
    // damage immediately — balanced 12-20% before, 4-12% after; mean distance
    // walked 0.03-0.05 m before, 0.00-0.02 m after. So each fallback now also
    // has to clear a floor, set far below the real gate: still anti-stall,
    // but no longer able to promote an incompetent fleet.
    // Each gate PROMOTES; none of them may demote. Written as a plain
    // assignment the stage-2 gate clobbers a fleet already on stage 3 — its
    // balancedFrac sits above floor2 but below floor3, so it drops to 2 and
    // cannot climb back, which is the sawtooth this function opens by
    // promising not to produce. It ran that way from generation 170 to 250:
    // st3 · st3 · st2 · st3 · st3 · st2. Math.max is the whole ratchet.
    const bal = mean("balancedFrac"), arr = mean("avgArr"), prog = mean("avgProg");
    if ((gen >= c.stage2Gen && bal >= c.floor2) || bal >= c.balancedThr) s = Math.max(s, 2);
    // The stage-3 fallback used to read balancedFrac, and that is the very
    // mistake this function's own preamble warns against: balance is what stage
    // ONE teaches, banked by generation 3, so the floor was satisfied before the
    // fleet could take a step. It fired at generation 110 on a fleet peaking at
    // 3,920 fitness and 2.4 m walked; 170 generations later that fleet scored
    // 1,161 with a 0.02 m stride, and on identical held-out missions the gen-281
    // brain reached 0.00 waypoints against gen-81's 0.17. Stage 3 is the walking
    // stage, so its gate has to be metres walked.
    if (s >= 2 && ((gen >= c.stage3Gen && prog >= c.floorProg3) || arr >= c.arrThr1)) s = Math.max(s, 3);
    if (s >= 3 && ((gen >= c.stage4Gen && arr >= c.floor4) || arr >= c.arrThr2)) s = Math.max(s, 4);
    if (s >= 4 && ((gen >= c.stage5Gen && arr >= c.floor5) || arr >= c.arrThr3)) s = Math.max(s, 5);
    if (c.maxStage) s = Math.min(s, c.maxStage);
    /* THE GLOBAL TERRAIN RAMP IS GONE. It used to scale difficulty by the
     * fleet's recent metres walked, which reads as prudent and was in fact a
     * trap: terrain difficulty was gated on walking competence, and walking
     * competence on terrain was the thing being trained. A fleet that cannot
     * walk on rough ground keeps avgProg low, which keeps difficulty pinned at
     * the 0.15 floor, which means it never trains on rough ground — so it never
     * learns to walk on it. Chicken and egg, and it held: multiplied by a stage
     * ceiling of 0.12 the fleet's real setting was 0.018, i.e. 1.8 cm bumps.
     *
     * The job that ramp was doing — never present the whole fleet with a cliff —
     * is now done properly by drawing a per-episode difficulty spread in World,
     * which supplies easy and hard ground in the SAME generation instead of
     * making every episode equally easy. The stage ceiling still bounds it, and
     * an explicit cfg.terrainDifficulty still overrides for grid searches. */
    const terrainDifficulty = c.terrainDifficulty != null ? c.terrainDifficulty : 1;
    return { stage: s, terrainDifficulty };
}

if (typeof module !== "undefined") module.exports = { Evolution, stageFor, CURRICULUM, MUT_DEFAULT };
