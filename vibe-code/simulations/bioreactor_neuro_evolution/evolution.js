/* evolution.js — the genetic algorithm. No gradients, ever. Shared with the
 * tokamak sim in this collection; only the curriculum below is specific.
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
 * unlucky draw of the scenario bank — a weak CHIR lot and a dead pump — can
 * kill a genuinely good brain. The reigning champion keeps an untouched
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
     * finished — here `survival` is the fraction of episodes that did not lose
     * the culture and `boundaryErr` is the mean purity shortfall. stats: extra
     * telemetry stored on the history entry. */
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
         * With ~7,500 weights, a single mutation size is a bad bet: one that is
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
/* There is one task — take the batch from seeding to harvest — and a ladder
 * of how much goes wrong on the way (DIFFICULTY in scenarios.js). The plan
 * for a generation is a list of (rung, seed) pairs, every brain runs the
 * identical list, and unlocking a rung ADDS it to the mix rather than
 * replacing what came before.
 *
 * Episode 0 is always the hardest unlocked rung — the frontier, where the
 * search pressure has to point. The rest cycle down through every rung
 * including 0, so a brain that buys skill on a broken lab by giving up the
 * well-run one scores worse, not better. With six episodes and rungs 0–2
 * unlocked:  levels 2 0 1 2 0 1.
 *
 * Seeds rotate with the seed block so consecutive generations share their
 * scenarios (common random numbers across generations) and the bank still
 * turns over.
 */
function episodePlan(episodes, block, maxLevel) {
    const n = Math.max(1, episodes | 0);
    const L = Math.max(0, Math.min(N_LEVELS - 1, maxLevel | 0));
    const out = [];
    for (let e = 0; e < n; e++) {
        out.push({
            level: e === 0 ? L : (e - 1) % (L + 1),
            seed: (block | 0) * 131 + e * 17 + 1,
            /* ...and the PRODUCT rotates too, offset by the block so that over a
             * few generations every protocol is seen on every rung. A brain that
             * learns to make heart cells by forgetting how to make kidneys pays
             * for it inside two generations, which is the same anti-forgetting
             * argument as the rung-0 anchor above, one axis over. */
            lin: (e + (block | 0)) % N_LIN
        });
    }
    return out;
}

/* One episode's contribution to a generation's score. The advantage is
 * already normalised per scenario, so this only clips the tails.
 *
 * AND THE UPPER CLIP IS LOAD-BEARING WITH FIVE PRODUCTS. Fitness is the mean
 * advantage over the generation's episodes, and the advantage denominator is
 * that batch's own (protocol − neutral) gap, which differs between products:
 * the β-cell protocol scores 58 against a neutral of −17, so a point of purity
 * there is worth about four times a point of purity on a cardiac batch. With
 * the clip at 3 the search did the rational thing — it drove β cells to an
 * advantage of 4.0 and hepatocytes to 3.1 while letting cardiomyocytes fall to
 * 0.74 and kidney organoids to 0.23, i.e. it abandoned the two hard products
 * and the mean looked excellent. The weakest-product gate on the difficulty
 * ratchet did not catch it, because "worst product 0.36" is not a failure.
 *
 * At 1.5, beating a protocol by half is the most any single batch can
 * contribute, so the only way to raise the mean is to raise the floor. This is
 * the same lesson as capping the catastrophe in a flat-episode GA, one sign
 * over. */
function normalizeFitness(advantage) {
    return Math.max(-2, Math.min(1.5, advantage));
}

if (typeof module !== "undefined") {
    module.exports = { Evolution, episodePlan, normalizeFitness };
}
