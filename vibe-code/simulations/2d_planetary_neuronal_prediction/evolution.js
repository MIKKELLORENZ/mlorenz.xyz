/* evolution.js — the genetic algorithm. No gradients, ever.
 *
 * Every generation, sorted by fitness:
 *   1. a few elites survive byte-for-byte untouched — rank 0 is always an
 *      unmutated copy of the best genome, no matter what else happens
 *   2. a handful of elite copies get mutated, trying to improve on them
 *   3. elites breed with each other (crossover + light mutation)
 *   4. the rest come from rank-weighted parents across the better half, with
 *      mutation strength growing down the ranks — a gradient of risk
 *   5. a few completely fresh random genomes keep the pool honest early on,
 *      tapering to zero as the best-ever fitness climbs
 *
 * Two fitness gates narrow the search as a run matures:
 *   · past immZeroFit  — no more random immigrants
 *   · past childZeroFit — no more crossover either; pure hill-climbing
 *
 * Fitness here is "correct digits × 100", so the gate defaults (250 / 400) mean
 * "stop diluting once the population reliably gets 2.5 digits" and "stop mixing
 * genes once it gets 4". Those are real accuracy milestones rather than
 * arbitrary numbers, which is why they can be constants at all.
 *
 * The genome is a Predictor — four separate weight bags — but nothing below
 * knows that. It only needs clone / mutate / crossover, so swapping the model
 * architecture never touches this file.
 */
"use strict";

class Evolution {
    constructor(popSize, seed, makeGenome) {
        this.popSize = popSize;
        this.gen = 1;
        this.rng = mulberry32(seed || 42);
        this.make = makeGenome || (rng => new Predictor(rng));
        this.brains = [];
        for (let i = 0; i < popSize; i++) this.brains.push(this.make(this.rng));
        this.history = [];            // {best, avg, bestWorst, blew}
        this.champion = null;
        this.championFit = -1e18;
        this.grace = null;            // {net, left} — the one sheltered champion
        this.graceIdx = -1;
        this.graceEvent = null;
    }

    /* results: [{brain, fitness, digits, worst, blew}] for the generation just
     * finished. gracePeriod: generations the reigning champion survives
     * unmutated after being beaten (0 = off). */
    evolve(results, mutRate, mutSigma, gracePeriod, limits) {
        results.sort((a, b) => b.fitness - a.fitness);
        const lim = limits || {};
        const immZeroFit = lim.immZeroFit != null ? lim.immZeroFit : 250;
        const childZeroFit = lim.childZeroFit != null ? lim.childZeroFit : 400;

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
        const mean = f => results.reduce((s, r) => s + f(r), 0) / results.length;
        const rec = {
            best: best.fitness, avg: mean(r => r.fitness),
            bestDigits: best.digits, avgDigits: mean(r => r.digits),
            bestWorst: best.worst, blew: results.reduce((s, r) => s + (r.blew || 0), 0)
        };
        this.history.push(rec);

        if (best.fitness > this.championFit) {
            this.championFit = best.fitness;
            this.champion = best.brain.clone();
        }

        const rng = this.rng;
        const ELITES = Math.min(4, n);
        const MUT_ELITES = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const ELITE_CROSS = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const FRESH_MAX = n >= 32 ? 2 : 1;
        // Keyed on championFit, which only ever climbs, so the immigrant count
        // never creeps back up after a bad generation.
        const immFrac = immZeroFit > 0
            ? Math.max(0, Math.min(1, 1 - this.championFit / immZeroFit)) : 1;
        const FRESH = Math.round(FRESH_MAX * immFrac);
        const noChildren = childZeroFit > 0 && this.championFit >= childZeroFit;

        const next = [];
        for (let i = 0; i < ELITES; i++) next.push(results[i].brain.clone());
        for (let i = 0; i < MUT_ELITES; i++) {
            next.push(results[(rng() * ELITES) | 0].brain.clone().mutate(mutRate, mutSigma, rng));
        }
        const topPool = Math.min(6, results.length);
        for (let i = 0; i < ELITE_CROSS; i++) {
            if (noChildren) {
                next.push(results[(rng() * topPool) | 0].brain.clone().mutate(mutRate * 0.5, mutSigma * 0.7, rng));
            } else {
                let a = (rng() * topPool) | 0, b = (rng() * topPool) | 0;
                if (b === a) b = (b + 1) % topPool;
                next.push(Predictor.crossover(results[a].brain, results[b].brain, rng)
                    .mutate(mutRate * 0.5, mutSigma * 0.7, rng));
            }
        }
        const pickRank = () => {
            const r = Math.pow(rng(), 2.2);                    // biased toward rank 0
            return Math.min(results.length - 1, (r * results.length * 0.55) | 0);
        };
        while (next.length < n - FRESH) {
            const depth = next.length / n;                     // 0 → 1 down the roster
            const mr = mutRate * (0.8 + depth), ms = mutSigma * (0.8 + depth * 1.6);
            if (noChildren) {
                next.push(results[pickRank()].brain.clone().mutate(mr, ms, rng));
            } else {
                next.push(Predictor.crossover(results[pickRank()].brain, results[pickRank()].brain, rng)
                    .mutate(mr, ms, rng));
            }
        }
        while (next.length < n) next.push(this.make(rng));

        // ---- seat the grace holder ----
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

    /* Re-seed a whole population from one genome. Used on resume and on
     * "inject the built-in champion": the population loses the diversity the
     * original run had built, so the first few generations afterwards always
     * score a little below the checkpoint. That is expected, not a bug. */
    seedFrom(genome, mutRate, mutSigma) {
        for (let i = 0; i < this.brains.length; i++) {
            this.brains[i] = i === 0 ? genome.clone()
                : genome.clone().mutate(mutRate, mutSigma, this.rng);
        }
        this.champion = genome.clone();
        return this;
    }
}

if (typeof module !== "undefined") module.exports = { Evolution };
