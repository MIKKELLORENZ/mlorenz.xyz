/* evolution.js — the genetic algorithm. No gradients, ever.
 *
 * Every generation, ranked by fitness:
 *   1. a few elites survive byte-for-byte — rank 0 is always an unmutated copy
 *      of the best controller, whatever else happens
 *   2. a handful of mutated elite copies try to improve on them
 *   3. elites breed with each other (row-wise crossover + light mutation)
 *   4. the rest come from rank-weighted parents across the better half, with
 *      mutation strength growing down the ranks — a gradient of risk
 *   5. a few fresh random brains keep the pool honest early, tapering to zero
 *      as the best-ever fitness climbs
 *
 * CHAMPION GRACE. A controller lives or dies on a handful of episodes, and one
 * unlucky draw of the domain randomisation — a slow wall and a weak fast coil —
 * can kill a genuinely good brain. The reigning champion keeps an untouched
 * seat for `gracePeriod` generations after being beaten. This costs one slot
 * and is the difference between a run that converges and one that throws away
 * its best controller on a bad roll of the dice.
 */
"use strict";

class Evolution {
    constructor(popSize, seed, sizes) {
        this.popSize = popSize;
        this.gen = 1;
        this.rng = mulberry32(seed || 42);
        this.sizes = (sizes || NET_SIZES).slice();
        this.brains = [];
        for (let i = 0; i < popSize; i++) this.brains.push(new Net(this.sizes, this.rng));
        this.history = [];
        this.champion = null;
        this.championFit = -1e18;
        this.grace = null;
        this.graceIdx = -1;
        this.graceEvent = null;
        this.lastStage = null;
    }

    /* results: [{brain, fitness, survival, boundaryErr}] for the generation just
     * finished. stats: extra telemetry stored on the history entry (the stage
     * ratchet reads newSurv and stage back out of it). */
    evolve(results, mutRate, mutSigma, gracePeriod, limits, stats) {
        results.sort((a, b) => b.fitness - a.fitness);
        const immZeroFit = limits && limits.immZeroFit != null ? limits.immZeroFit : 1.0;
        const childZeroFit = limits && limits.childZeroFit != null ? limits.childZeroFit : 1.6;

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

        const n = this.popSize;
        const best = results[0];
        const avg = results.reduce((s, r) => s + r.fitness, 0) / results.length;
        const avgSurv = results.reduce((s, r) => s + r.survival, 0) / results.length;
        const rec = Object.assign({
            gen: this.gen, best: best.fitness, avg,
            bestSurv: best.survival, avgSurv,
            bestErr: best.boundaryErr, avgErr: results.reduce((s, r) => s + r.boundaryErr, 0) / results.length
        }, stats || {});
        this.history.push(rec);

        // A stage change is an environment change, and fitness is only comparable
        // within one environment. Carrying the old champion score across the
        // boundary freezes `champion` on the previous stage's brain forever:
        // nothing in the new stage can beat a number earned in an easier one, so
        // every checkpoint written from then on is the OLD net and the search
        // gates sit closed as though the population were already mature. Reset
        // and re-measure — the outgoing champion's elites are still in the pool,
        // so if it really is the best brain here too it reclaims the title on
        // this very generation, having actually earned it.
        const stage = stats && stats.stage != null ? stats.stage : null;
        if (stage !== null && this.lastStage !== null && stage !== this.lastStage) {
            this.championFit = -1e18;
            this.graceEvent = `stage ${this.lastStage} → ${stage}: champion fitness reset ` +
                `(scores are not comparable across stages)`;
        }
        if (stage !== null) this.lastStage = stage;

        if (best.fitness > this.championFit) {
            this.championFit = best.fitness;
            this.champion = best.brain.clone();
        }

        const rng = this.rng;
        const ELITES = Math.min(4, n);
        const MUT_ELITES = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const ELITE_CROSS = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const FRESH_MAX = n >= 32 ? 2 : 1;
        const immFrac = immZeroFit > 0
            ? Math.max(0, Math.min(1, 1 - this.championFit / immZeroFit))
            : 1;
        const FRESH = Math.round(FRESH_MAX * immFrac);
        const noChildren = childZeroFit > 0 && this.championFit >= childZeroFit;

        const next = [];
        for (let i = 0; i < ELITES; i++) next.push(results[i].brain.clone());
        /* Mutated elites, on a LADDER of step sizes rather than all at one.
         *
         * With ~9,300 weights, a single mutation size is a bad bet: one that is
         * large enough to escape a local optimum is far too large to refine a
         * champion, and vice versa. Sampling four scales per generation means
         * some children probe the neighbourhood and some probe the region, and
         * selection decides which was the right question. Measured before this
         * change, the population mean sat flat at −4.5 for 375 generations while
         * the best oscillated: every child of an elite was effectively a fresh
         * draw rather than a refinement. */
        const SIGMA_LADDER = [0.15, 0.35, 0.7, 1.4];
        for (let i = 0; i < MUT_ELITES; i++) {
            const p = results[(rng() * ELITES) | 0].brain.clone();
            const f = SIGMA_LADDER[i % SIGMA_LADDER.length];
            next.push(p.mutate(mutRate, mutSigma * f, rng));
        }
        const topPool = Math.min(6, results.length);
        for (let i = 0; i < ELITE_CROSS; i++) {
            if (noChildren) {
                const p = results[(rng() * topPool) | 0].brain.clone();
                next.push(p.mutate(mutRate * 0.5, mutSigma * 0.7, rng));
            } else {
                let a = (rng() * topPool) | 0, b = (rng() * topPool) | 0;
                if (b === a) b = (b + 1) % topPool;
                next.push(Net.crossover(results[a].brain, results[b].brain, rng)
                    .mutate(mutRate * 0.5, mutSigma * 0.7, rng));
            }
        }
        const pickRank = () => {
            const r = Math.pow(rng(), 2.2);
            return Math.min(results.length - 1, (r * results.length * 0.55) | 0);
        };
        while (next.length < n - FRESH) {
            const depth = next.length / n;
            const mr = mutRate * (0.8 + depth), ms = mutSigma * (0.8 + depth * 1.6);
            if (noChildren) {
                next.push(results[pickRank()].brain.clone().mutate(mr, ms, rng));
            } else {
                next.push(Net.crossover(results[pickRank()].brain, results[pickRank()].brain, rng)
                    .mutate(mr, ms, rng));
            }
        }
        while (next.length < n) next.push(new Net(this.sizes, rng));

        // ---- seat the grace holder, byte-for-byte ----
        this.graceIdx = -1;
        if (gp > 0 && this.grace) {
            if (holderIdx < ELITES) {
                this.grace.net = next[holderIdx];
                this.graceIdx = holderIdx;
            } else {
                const slot = Math.max(ELITES, n - FRESH - 1);
                const clone = this.grace.net.clone();
                next[slot] = clone;
                this.grace.net = clone;
                this.graceIdx = slot;
            }
        }

        this.brains = next;
        this.gen++;
        return rec;
    }
}

/* ------------------------------------------------------------- curriculum */
/* Three rungs, and the first one exists because of the physics.
 *
 *   0  Circular      κ ≈ 1.05, nearly neutral. Learn that the coils do
 *                    something and that disrupting is bad.
 *   1  Elongated     κ ≈ 1.75. The vertical instability arrives. Everything a
 *                    brain learned in stage 0 about slow shaping is still true;
 *                    it now also has to close a millisecond loop on the fast coil.
 *   2  Full registry Shape morphs, vertical tracking, negative triangularity,
 *                    current ramps, radial excursions.
 *
 * Starting at stage 2 does not work: a random brain on an elongated plasma is
 * on the wall in ten milliseconds, every member of the population scores the
 * same large negative number, and selection has nothing to rank. The circular
 * rung exists to make generation 1 informative.
 *
 * The ratchet is threshold-driven, never a bare generation count, and never
 * demotes. It promotes on the survival of the BETTER HALF of the population in
 * the NEWEST task — judging on the champion promotes a population that contains
 * one lucky brain, judging on the whole roster never promotes at all because the
 * roster is half deliberate wreckage, and judging across all unlocked tasks lets
 * the easy rung carry the hard one. */
const STAGES = [
    { tasks: ["circular"], scale: 55, label: "Circular hold" },
    { tasks: ["circular", "elongated"], scale: 45, label: "Elongated — unstable" },
    {
        tasks: ["circular", "elongated", "vtrack", "morph", "negd", "ipramp", "outward"],
        scale: 40, label: "Full task registry"
    }
];

function stageFor(gen, history, cfg) {
    cfg = cfg || {};
    if (cfg.stageLock != null && cfg.stageLock >= 0) {
        return Math.max(0, Math.min(STAGES.length - 1, cfg.stageLock | 0));
    }
    // Measured over the BETTER HALF of the population (see the newSurv the
    // trainer feeds in), not the whole roster. The roster deliberately contains
    // high-sigma mutants that mostly disrupt by design, so a whole-population
    // mean can sit at 0.6 forever no matter how good the competent half is —
    // which is exactly what happened: 375 generations and the curriculum never
    // left stage 0, so the brain it produced had never seen an unstable plasma.
    const promote = cfg.promoteSurvival != null ? cfg.promoteSurvival : 0.90;
    const hold = cfg.promoteHold != null ? cfg.promoteHold : 3;
    let s = 0, run = 0;
    for (const h of history) {
        if (h.stage !== s) { run = 0; continue; }
        const sv = h.newSurv != null ? h.newSurv : h.avgSurv;
        run = sv >= promote ? run + 1 : 0;
        if (run >= hold && s < STAGES.length - 1) { s++; run = 0; }
    }
    return s;
}

function stageOpts(stage) {
    return STAGES[Math.max(0, Math.min(STAGES.length - 1, stage))];
}

/* Which task each of a generation's episodes runs. Unlocking a stage ADDS tasks
 * to the exam, it never replaces them — training only on the newest task is
 * catastrophic forgetting, and here it shows up as a controller that can hold a
 * κ = 2.0 plasma beautifully and has forgotten how to keep a circular one on
 * the axis. Episode 0 always runs the newest task; the rest cycle through
 * everything unlocked. */
function episodeTasks(stage, episodes, gen) {
    const s = Math.max(0, Math.min(STAGES.length - 1, stage | 0));
    const list = STAGES[s].tasks;
    const newest = list[list.length - 1];
    const n = Math.max(1, episodes | 0);
    // The cycle STARTS at a different point each generation. Without this, a
    // generation of fewer episodes than there are tasks always draws the same
    // prefix of the list: at stage 2 with five episodes, `negd`, `ipramp` and
    // `morph` were never selected on at all, and the population quietly
    // specialised on the four tasks it could see. Rotating costs nothing and
    // means every task is trained on within two generations, which is what
    // makes it affordable to run fewer episodes per brain and more generations
    // per hour. Ranking is unaffected: every brain in a generation still runs
    // the identical set of episodes, which is the only comparison that is ever
    // made between them.
    const off = ((gen | 0) * (n - 1 > 0 ? n - 1 : 1)) % list.length;
    const out = [];
    for (let e = 0; e < n; e++) {
        out.push(e === 0 ? newest : list[(off + e - 1) % list.length]);
    }
    return out;
}

/* Which (task, difficulty) pair each of a generation's episodes runs.
 *
 * THE ANTI-FORGETTING RULE. Climbing the difficulty ladder is worthless if the
 * population pays for it by forgetting the machine it started on, and a
 * curriculum that simply trains on "the current level" does exactly that: the
 * only gradient it feels is towards the newest distribution. So the levels are
 * treated the same way the task stages are — unlocking a rung ADDS it to the
 * mix and never replaces what came before.
 *
 * Concretely, with six episodes and two rungs unlocked:
 *
 *     episode  0    1    2    3    4    5
 *     level    2    0    1    2    0    1
 *
 * Episode 0 always runs the newest task on the HARDEST unlocked rung — that is
 * the frontier, and it is where the search pressure needs to point. Everything
 * after it cycles through every rung including 0, so a brain that buys skill on
 * the savage machine by giving up the nominal one scores worse, not better.
 * Level 0 is never absent from a generation as long as there are ≥ 2 episodes.
 *
 * Every brain in the generation gets the identical plan, which is the only
 * comparison that is ever made between them. */
function episodePlan(stage, episodes, gen, maxLevel) {
    const tids = episodeTasks(stage, episodes, gen);
    const L = Math.max(0, Math.min(N_LEVELS - 1, maxLevel | 0));
    return tids.map((tid, e) => ({
        tid,
        level: e === 0 ? L : (e - 1) % (L + 1)
    }));
}

/* One episode's contribution to a generation's score: normalised by the stage
 * scale, then square-rooted. The square root gives diminishing returns, so
 * going from 0 to 1 in the task you are bad at is worth more than going from 4
 * to 5 in the one you already hold perfectly — which is the preference a
 * generalist objective should have. Ordering within a task is untouched.
 * Negative scores (an early disruption) pass through unchanged rather than
 * being square-rooted into NaN. */
function normalizeFitness(fitness, scale) {
    const x = fitness / scale;
    return x <= 0 ? x : Math.sqrt(x);
}

if (typeof module !== "undefined") {
    module.exports = {
        Evolution, stageFor, stageOpts, episodeTasks, episodePlan,
        normalizeFitness, STAGES
    };
}
