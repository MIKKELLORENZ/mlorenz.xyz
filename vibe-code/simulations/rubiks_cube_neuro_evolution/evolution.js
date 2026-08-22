/* evolution.js — the genetic algorithm. No gradients, ever.
 *
 * Every generation, sorted by fitness:
 *   1. a few elites survive byte-for-byte untouched — rank 0 is always an
 *      unmutated copy of the best brain, no matter what else happens
 *   2. a handful of elite copies get mutated, trying to improve on them
 *   3. elites breed with each other (row-wise crossover + light mutation)
 *   4. the rest come from rank-weighted parents across the better half, with
 *      mutation strength growing down the ranks — cautious near the top, wild at
 *      the bottom
 *   5. a few completely fresh random brains keep the gene pool honest early on
 *
 * Three things narrow the search as a run matures: mutation annealing against
 * best-ever fitness, immigrants switching off, and crossover switching off so the
 * population becomes pure hill-climbing. One thing protects progress: the
 * champion keeps an unmutated seat, and with a held-out gate installed it cannot
 * be dethroned except by a challenger that wins twice.
 *
 * This is the same machinery as the other neuroevolution projects in this folder,
 * for a reason: it is the part that is already known to work, so when this
 * project fails it will not be because the GA was rewritten. What is new here is
 * the observation (pixels) and the reward (rewards.js). Those are the experiment;
 * the search is the control.
 *
 * The one structural difference: `spawn` is injected rather than imported, so the
 * architecture search can put a conv stack and an MLP through identical
 * population machinery without this file knowing which it is holding.
 */
"use strict";

class Evolution {
    constructor(popSize, seed, islands, spawn) {
        this.popSize = popSize;
        this.spawn = spawn;
        /* Islands. One panmictic pool converges on whatever lineage leads at
         * generation 30 and then explores only that basin. Semi-isolated demes
         * that each keep their own elites keep several independent attempts alive;
         * occasional migration spreads a genuinely better idea without letting a
         * merely luckier one erase the alternatives. */
        this.islands = Math.max(1, Math.min(islands || 1, Math.floor(popSize / 8) || 1));
        this.bounds = [];
        for (let k = 0; k < this.islands; k++) {
            this.bounds.push([
                Math.round(k * popSize / this.islands),
                Math.round((k + 1) * popSize / this.islands),
            ]);
        }
        this.gen = 1;
        this.rng = mulberry32(seed || 42);
        this.brains = [];
        for (let i = 0; i < popSize; i++) this.brains.push(spawn(this.rng));
        this.history = [];
        this.champion = null;
        this.championFit = -1e18;
        this.championSolve = 0;
        this.stagnant = 0;
        this.grace = null;
        this.graceIdx = -1;
        this.eff = { rate: 0, sigma: 0, anneal: 0, shaken: false };
    }

    /* Mutation annealing. The curve is hyperbolic — half the shrink is spent by
     * the time the champion reaches `annealFit`, wherever the run ends up —
     * rather than linear to a target fitness the run has not reached yet, which
     * barely moves during the whole early phase where annealing would have done
     * something. A stagnation counter can undo the schedule: a stalled hill-climb
     * needs a bigger step, not a smaller one. */
    effective(cfg) {
        const fit = Math.max(0, this.championFit);
        const p = cfg.annealFit > 0 ? fit / (fit + cfg.annealFit) : 0;
        let scale = 1 - (1 - cfg.annealFloor) * p;
        const shaken = cfg.shakeAfter > 0 && this.stagnant >= cfg.shakeAfter;
        if (shaken) scale *= 1.8;
        this.eff = {
            rate: Math.min(0.6, cfg.mutRate * scale),
            sigma: cfg.mutSigma * scale,
            anneal: p, shaken,
        };
        return this.eff;
    }

    _breed(sorted, size, cfg, mutRate, mutSigma) {
        const rng = this.rng;
        const ELITES = Math.max(1, Math.min(4, (size * 0.09) | 0 || 1));
        const MUT_ELITES = Math.max(2, (size * 0.20) | 0);
        const ELITE_CROSS = Math.max(2, (size * 0.16) | 0);
        const tau = cfg.selfAdapt ? (cfg.tau || 0.25) : 0;

        const FRESH_MAX = size >= 24 ? 2 : 1;
        const immFrac = cfg.immZeroFit > 0
            ? Math.max(0, Math.min(1, 1 - this.championFit / cfg.immZeroFit)) : 1;
        const FRESH = Math.round(FRESH_MAX * immFrac);
        const noChildren = cfg.childZeroFit > 0 && this.championFit >= cfg.childZeroFit;

        /* One knob for all three mutation styles, so the callers below read the
         * same. `perLayer` rescales σ by fan-in — see nn.js; it exists because a
         * 27-weight convolutional filter and a 400-weight dense row do not want
         * the same absolute step, and this architecture has both. */
        const mutate = (net, rate, sigma) => (tau > 0
            ? net.mutateAdaptive(rate, sigma, rng, tau)
            : cfg.perLayerSigma
                ? net.mutateScaled(rate, sigma, rng)
                : net.mutate(rate, sigma, rng));

        const next = [];
        for (let i = 0; i < ELITES && i < sorted.length; i++) next.push(sorted[i].brain.clone());
        for (let i = 0; i < MUT_ELITES; i++) {
            const p = sorted[(rng() * ELITES) | 0].brain.clone();
            next.push(mutate(p, mutRate, mutSigma));
        }
        const topPool = Math.min(6, sorted.length);
        for (let i = 0; i < ELITE_CROSS; i++) {
            if (noChildren) {
                const p = sorted[(rng() * topPool) | 0].brain.clone();
                next.push(mutate(p, mutRate * 0.5, mutSigma * 0.7));
            } else {
                let a = (rng() * topPool) | 0, b = (rng() * topPool) | 0;
                if (b === a) b = (b + 1) % topPool;
                next.push(mutate(Genome.crossover(sorted[a].brain, sorted[b].brain, rng),
                    mutRate * 0.5, mutSigma * 0.7));
            }
        }
        const rankExp = cfg.rankExp || 2.2;
        const pickRank = () => {
            const r = Math.pow(rng(), rankExp);
            return Math.min(sorted.length - 1, (r * sorted.length * 0.55) | 0);
        };
        while (next.length < size - FRESH) {
            const depth = next.length / size;
            const mr = mutRate * (0.8 + depth), ms = mutSigma * (0.8 + depth * 1.6);
            if (noChildren) {
                next.push(mutate(sorted[pickRank()].brain.clone(), mr, ms));
            } else {
                const a = sorted[pickRank()].brain;
                const b = sorted[pickRank()].brain;
                next.push(mutate(Genome.crossover(a, b, rng), mr, ms));
            }
        }
        while (next.length < size) next.push(this.spawn(rng));
        next.length = size;
        return { next, ELITES, FRESH };
    }

    /* Fitness sharing on *behaviour*, not on weights.
     *
     * The failure mode this exists for is specific and visible on this task: by
     * generation 40 the whole population is a family of near-copies that all
     * answer "U" to every cube. The move-mix component of the signature (see
     * Env.scoreBrain) makes that collapse expensive — a brain that uses six of
     * its eight turns keeps its seat even if a dozen one-move brains score
     * slightly higher. Weight distance would not see it: two networks can compute
     * the same policy with hidden units permuted. Selection only; the champion and
     * every reported number are still raw fitness, because a diverse bad brain is
     * still bad. */
    _share(results, cfg) {
        const radius = cfg.shareRadius || 0.55;
        const lambda = cfg.share;
        const n = results.length;
        let minFit = Infinity;
        for (const r of results) if (r.fitness < minFit) minFit = r.fitness;
        for (let i = 0; i < n; i++) {
            const a = results[i].sig;
            let crowd = 0;
            if (a) {
                for (let j = 0; j < n; j++) {
                    if (i === j) continue;
                    const b = results[j].sig;
                    if (!b) continue;
                    let d2 = 0;
                    for (let k = 0; k < a.length; k++) { const d = a[k] - b[k]; d2 += d * d; }
                    const d = Math.sqrt(d2);
                    if (d < radius) crowd += 1 - d / radius;
                }
            }
            results[i].shared = (results[i].fitness - minFit + 1) / (1 + lambda * crowd);
            results[i].crowd = crowd;
        }
        this.meanCrowd = results.reduce((s, r) => s + (r.crowd || 0), 0) / n;
    }

    /* results: [{brain, fitness, solveRate, descent, sig}] in population order. */
    evolve(resultsIn, cfg) {
        const sharing = cfg.share > 0 && resultsIn.some(r => r.sig);
        if (sharing) this._share(resultsIn, cfg);
        this._rank = sharing ? (a, b) => b.shared - a.shared : (a, b) => b.fitness - a.fitness;
        const results = resultsIn.slice().sort((a, b) => b.fitness - a.fitness);
        const n = this.popSize;
        const best = results[0];
        const avg = results.reduce((s, r) => s + r.fitness, 0) / results.length;
        const avgSolve = results.reduce((s, r) => s + r.solveRate, 0) / results.length;
        const avgDescent = results.reduce((s, r) => s + r.descent, 0) / results.length;
        this.history.push({ best: best.fitness, avg, bestSolve: best.solveRate, avgSolve, avgDescent });

        /* Re-score the reigning champion honestly. Every generation draws a fresh
         * bank, so "best fitness ever seen" is a maximum over noisy measurements
         * and one lucky bank crowns a champion nobody can dethrone. The champion is
         * re-injected into the pool and therefore replayed on *this* generation's
         * scrambles, so use that number. All comparisons then happen inside one
         * generation, where everyone faced the same cubes. */
        if (this.injected) {
            const r = results.find(x => x.brain === this.injected);
            if (r) { this.championFit = r.fitness; this.championSolve = r.solveRate; }
        }

        if (best.fitness > this.championFit) {
            let accept = true;
            if (this.gateFn) {
                if (this.championSkill === null || this.championSkill === undefined) {
                    this.championSkill = this.champion ? this.gateFn(this.champion) : -Infinity;
                }
                const challenger = this.gateFn(best.brain);
                this.gateChecks = (this.gateChecks || 0) + 1;
                if (challenger > this.championSkill) this.championSkill = challenger;
                else { accept = false; this.gateRejects = (this.gateRejects || 0) + 1; }
            }
            if (accept) {
                this.championFit = best.fitness;
                this.championSolve = best.solveRate;
                this.champion = best.brain.clone();
                this.stagnant = 0;
            } else this.stagnant++;
        } else this.stagnant++;

        const { rate: mutRate, sigma: mutSigma } = this.effective(cfg);

        // ---- champion grace ----
        const gp = cfg.grace | 0;
        const forever = gp < 0;
        let graceSlot = -1;
        if (gp === 0) {
            this.grace = null;
        } else if (forever) {
            if (this.champion) {
                if (!this.grace || this.grace.net !== this.champion) {
                    this.grace = { net: this.champion, left: Infinity };
                }
                graceSlot = resultsIn.findIndex(r => r.brain === this.grace.net);
            }
        } else {
            let holderIdx = this.grace ? results.findIndex(r => r.brain === this.grace.net) : -1;
            if (!this.grace || holderIdx === -1) this.grace = { net: results[0].brain, left: gp };
            else if (holderIdx === 0) this.grace.left = gp;
            else if (--this.grace.left <= 0) this.grace = { net: results[0].brain, left: gp };
            graceSlot = this.grace ? resultsIn.findIndex(r => r.brain === this.grace.net) : -1;
        }

        // ---- breed every island from its own gene pool ----
        const next = new Array(n);
        const islandBest = [];
        let elites0 = 1;
        for (let k = 0; k < this.islands; k++) {
            const [lo, hi] = this.bounds[k];
            const sorted = resultsIn.slice(lo, hi).sort(this._rank);
            const bred = this._breed(sorted, hi - lo, cfg, mutRate, mutSigma);
            for (let i = lo; i < hi; i++) next[i] = bred.next[i - lo];
            islandBest.push({ k, lo, hi, sorted, elites: bred.ELITES });
            if (k === 0) elites0 = bred.ELITES;
        }

        // ---- migration ----
        this.migrated = 0;
        const every = cfg.migrateEvery | 0;
        if (this.islands > 1 && every > 0 && this.gen % every === 0) {
            const donors = islandBest.map(b => next[b.lo].clone());
            for (let k = 0; k < this.islands; k++) {
                const dst = this.bounds[(k + 1) % this.islands];
                const slot = dst[1] - 1 - (this.migrated % Math.max(1, (dst[1] - dst[0]) >> 2));
                next[Math.max(dst[0], slot)] = donors[k];
                this.migrated++;
            }
        }

        /* Seat the grace holder in its own island, byte-for-byte intact. Ranks are
         * island-local: a brain that is 9th overall can still be its island's
         * best, so comparing a global rank against island 0's elite count would
         * seat a needless second copy. */
        this.graceIdx = -1;
        if (gp !== 0 && this.grace) {
            const home = islandBest.find(b => graceSlot >= b.lo && graceSlot < b.hi) || islandBest[0];
            const rank = home.sorted.findIndex(r => r.brain === this.grace.net);
            if (rank >= 0 && rank < home.elites) {
                this.grace.net = next[home.lo + rank];
                this.graceIdx = home.lo + rank;
            } else {
                const slot = Math.max(home.lo + home.elites, home.hi - 2);
                const clone = this.grace.net.clone();
                next[slot] = clone;
                this.grace.net = clone;
                this.graceIdx = slot;
            }
        }

        /* Re-inject the best-ever brain unchanged. Keeping the champion in a
         * variable is not enough: if it is not in the breeding pool the pool
         * drifts away from it under selection noise, and we also lose the honest
         * re-score at the top of the next generation. */
        this.injected = null;
        if (cfg.reinject !== false && this.champion) {
            this.injected = this.champion.clone();
            next[elites0 - 1] = this.injected;
        }

        this.brains = next;
        this.gen++;
        this.meanSigma = next.reduce((s, b) => s + b.sigma, 0) / n;
        return { best: best.fitness, avg, bestSolve: best.solveRate, avgSolve, avgDescent };
    }
}
