/* evolution.js — the genetic algorithm. No gradients, ever.
 *
 * Every generation, sorted by fitness:
 *   1. a few elites survive byte-for-byte untouched
 *   2. a handful of elite copies get mutated, trying to improve on them
 *   3. elites breed with each other (crossover + light mutation)
 *   4. the rest come from rank-weighted parents across the better half,
 *      with mutation strength growing down the ranks (a gradient of risk)
 *   5. a couple of completely fresh random brains keep the gene pool honest
 */
"use strict";

class Evolution {
    constructor(popSize, seed) {
        this.popSize = popSize;
        this.gen = 1;
        this.rng = mulberry32(seed || 42);
        this.brains = [];
        for (let i = 0; i < popSize; i++) this.brains.push(new Net(NET_SIZES, this.rng));
        this.history = [];            // {best, avg, bestArr, avgArr}
        this.champion = null;
        this.championFit = -1e18;
        this.grace = null;            // {net, left} — the one sheltered champion
        this.graceIdx = -1;           // its slot in the current population
        this.graceEvent = null;
    }

    /* results: [{brain, fitness, arrivals}] for the generation just finished.
     * gracePeriod: generations the reigning champion survives unmutated after
     * being beaten (0 = off). Only one boat holds grace at a time. */
    evolve(results, mutRate, mutSigma, gracePeriod) {
        results.sort((a, b) => b.fitness - a.fitness);

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
                this.grace.left = gp;                    // defended the title
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
        const avgArr = results.reduce((s, r) => s + r.arrivals, 0) / results.length;
        this.history.push({ best: best.fitness, avg, bestArr: best.arrivals, avgArr });

        if (best.fitness > this.championFit) {
            this.championFit = best.fitness;
            this.champion = best.brain.clone();
        }

        const rng = this.rng;
        const ELITES = Math.min(4, n);
        const MUT_ELITES = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const ELITE_CROSS = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const FRESH = n >= 32 ? 2 : 1;

        const next = [];
        // 1) untouched elites
        for (let i = 0; i < ELITES; i++) next.push(results[i].brain.clone());
        // 2) mutated elites
        for (let i = 0; i < MUT_ELITES; i++) {
            const p = results[(rng() * ELITES) | 0].brain.clone();
            next.push(p.mutate(mutRate, mutSigma, rng));
        }
        // 3) elites breeding with each other
        const topPool = Math.min(6, results.length);
        for (let i = 0; i < ELITE_CROSS; i++) {
            let a = (rng() * topPool) | 0, b = (rng() * topPool) | 0;
            if (b === a) b = (b + 1) % topPool;
            next.push(Net.crossover(results[a].brain, results[b].brain, rng)
                .mutate(mutRate * 0.5, mutSigma * 0.7, rng));
        }
        // 4) gradient of the rest: rank-weighted parents, riskier the deeper we go
        const pickRank = () => {
            const r = Math.pow(rng(), 2.2);                    // biased toward rank 0
            return Math.min(results.length - 1, (r * results.length * 0.55) | 0);
        };
        while (next.length < n - FRESH) {
            const depth = next.length / n;                     // 0 → 1 down the roster
            const a = results[pickRank()].brain;
            const b = results[pickRank()].brain;
            next.push(Net.crossover(a, b, rng)
                .mutate(mutRate * (0.8 + depth), mutSigma * (0.8 + depth * 1.6), rng));
        }
        // 5) fresh blood
        while (next.length < n) next.push(new Net(NET_SIZES, rng));

        // ---- seat the grace holder ----
        // If it ranked in the elites its untouched clone is already there;
        // otherwise it takes a gradient slot, byte-for-byte intact. The boat
        // that beat it sits at rank 0 with elite treatment (kept + mutated).
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
        return { best: best.fitness, avg, bestArr: best.arrivals, avgArr };
    }
}

/* Decides which training stage the next generation runs in. */
function stageFor(gen, history, cfg) {
    let collisions = cfg.collideFromStart || gen >= cfg.collideGen;
    if (!collisions && cfg.collideThreshold > 0 && history.length) {
        const h = history[history.length - 1];
        if (h.avgArr >= cfg.collideThreshold) collisions = true;
    }
    const combat = cfg.combatEnabled && gen >= cfg.combatGen;
    return { shipCollisions: collisions || combat, combat };
}

if (typeof module !== "undefined") module.exports = { Evolution, stageFor };
