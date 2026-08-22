/* evolution.js — the genetic algorithm. No gradients, ever.
 *
 * Every generation, ranked by fitness:
 *   1. a few elites survive byte-for-byte — rank 0 is always an unmutated copy
 *      of the best drone, whatever else happens
 *   2. a handful of mutated elite copies try to improve on them
 *   3. elites breed with each other (row-wise crossover + light mutation)
 *   4. the rest come from rank-weighted parents across the better half, with
 *      mutation strength growing down the ranks — a gradient of risk
 *   5. a few fresh random brains keep the pool honest early, tapering to zero
 *      as the best-ever fitness climbs
 *
 * Two fitness gates narrow the search as a run matures: past `immZeroFit` no
 * more random immigrants, past `childZeroFit` no more crossover either, and the
 * population becomes pure hill-climbing on the champion.
 *
 * CHAMPION GRACE. A drone lives or dies on a handful of episodes, and one
 * unlucky waypoint chain can wipe out a genuinely good brain. The reigning
 * champion keeps an untouched seat for `gracePeriod` generations after being
 * beaten. Only one drone holds grace at a time; defending the title refreshes
 * it. This costs one slot and in the 3D project was repeatedly the difference
 * between a run that converged and one that threw its best brain away on a bad
 * draw.
 *
 * There is no curriculum here. The 3D project needed one because it had three
 * rooms of escalating obstacle density; this one has a single empty hyper-room
 * and exactly one thing to learn, so a stage ratchet would only add a way for
 * the run to go wrong. What varies between generations is the mission seed —
 * see train.js's episode bank.
 */
"use strict";

class Evolution {
    constructor(popSize, seed, netSizes) {
        this.popSize = popSize;
        this.netSizes = netSizes || NET_SIZES;
        this.gen = 1;
        this.rng = mulberry32(seed || 42);
        this.brains = [];
        for (let i = 0; i < popSize; i++) this.brains.push(new Net(this.netSizes, this.rng));
        this.history = [];
        this.champion = null;
        this.championFit = -1e18;
        this.grace = null;
        this.graceIdx = -1;
        this.graceEvent = null;
    }

    /* results: [{brain, fitness, arrivals}] for the generation just finished. */
    evolve(results, mutRate, mutSigma, gracePeriod, limits, stats) {
        results.sort((a, b) => b.fitness - a.fitness);
        const immZeroFit = limits && limits.immZeroFit != null ? limits.immZeroFit : 4000;
        const childZeroFit = limits && limits.childZeroFit != null ? limits.childZeroFit : 12000;

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
                    this.graceEvent = `grace: beaten champion sheltered (${this.grace.left} left)`;
                }
            }
        }

        const n = this.popSize;
        const best = results[0];
        const avg = results.reduce((s, r) => s + r.fitness, 0) / results.length;
        const avgArr = results.reduce((s, r) => s + r.arrivals, 0) / results.length;
        const rec = Object.assign({
            gen: this.gen, best: best.fitness, avg, bestArr: best.arrivals, avgArr
        }, stats || {});
        this.history.push(rec);

        if (best.fitness > this.championFit) {
            this.championFit = best.fitness;
            this.champion = best.brain.clone();
        }

        const rng = this.rng;
        const ELITES = Math.min(4, n);
        const MUT_ELITES = Math.min(10, Math.max(2, (n * 0.16) | 0));
        const ELITE_CROSS = Math.min(10, Math.max(2, (n * 0.16) | 0));
        const FRESH_MAX = n >= 32 ? 2 : 1;
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
                next.push(results[(rng() * topPool) | 0].brain.clone()
                    .mutate(mutRate * 0.5, mutSigma * 0.7, rng));
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
        while (next.length < n) next.push(new Net(this.netSizes, rng));

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

if (typeof module !== "undefined") module.exports = { Evolution };
