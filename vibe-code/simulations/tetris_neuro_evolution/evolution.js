/* evolution.js — the genetic algorithm. No gradients, ever.
 *
 * Every generation, sorted by fitness:
 *   1. a few elites survive byte-for-byte untouched — rank 0 is always an
 *      unmutated copy of the best brain, no matter what else happens
 *   2. a handful of elite copies get mutated, trying to improve on them
 *   3. elites breed with each other (row-wise crossover + light mutation)
 *   4. the rest come from rank-weighted parents across the better half, with
 *      mutation strength growing down the ranks — a gradient of risk, cautious
 *      near the top, wild at the bottom
 *   5. a few completely fresh random brains keep the gene pool honest early on
 *
 * Three things narrow the search as the run matures:
 *   · mutation annealing — rate and strength shrink toward a floor as the
 *     best-ever fitness climbs, so early generations explore wildly and later
 *     ones polish. A stagnation counter can shake them back up (see below).
 *   · past immZeroFit  — no more random immigrants
 *   · past childZeroFit — no more crossover either; the population becomes pure
 *     hill-climbing: untouched elites plus mutated copies of the best
 *
 * And one thing protects progress: champion grace. A brain that gets beaten
 * keeps an unmutated seat for a few generations rather than being bred out on
 * the strength of one unlucky bag of pieces.
 */
"use strict";

class Evolution {
    constructor(popSize, seed, islands) {
        this.popSize = popSize;
        /* Islands. One big panmictic population converges on whatever lineage is
         * ahead at generation 30 and then explores only that one basin — with
         * 8.5k weights and rank-weighted selection, everything is a cousin of
         * everything within a few dozen generations. Splitting the population
         * into semi-isolated demes that each keep their own elites, and letting
         * only occasional migrants cross, keeps several independent attempts
         * alive at once. Migration spreads a genuinely better idea; isolation
         * stops a merely luckier one from erasing the alternatives. */
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
        for (let i = 0; i < popSize; i++) this.brains.push(makeNet(this.rng));
        this.history = [];            // {best, avg, bestLines, avgLines}
        this.champion = null;
        this.championFit = -1e18;
        this.championLines = 0;
        this.stagnant = 0;            // generations since the champion last improved
        this.grace = null;            // {net, left} — the one sheltered champion
        this.graceIdx = -1;
        this.graceEvent = null;
        this.eff = { rate: 0, sigma: 0, anneal: 0, shaken: false };
    }

    /* Mutation annealing. Strength and rate fade from full toward `floor` as the
     * champion improves — big swings while the brain is bad, fine tuning once it
     * is good. If the champion has not improved for `shakeAfter` generations the
     * schedule is temporarily undone, because a stalled hill-climb needs a
     * bigger step, not a smaller one.
     *
     * The curve is hyperbolic — halfway to the floor at fitness `annealFit`, and
     * approaching it asymptotically after that — not linear-to-a-target. A
     * linear ramp needs its endpoint set to a fitness the run has not reached
     * yet, so it barely moves during the whole early phase where the annealing
     * would actually have done something: with the target at 24k and the run
     * sitting at 300, σ had shrunk by 1%. Here half the shrink is spent by the
     * time the champion reaches annealFit, wherever the run ends up. */
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

    /* Breed one island (or the whole population, when islands === 1) from its own
     * `sorted` results into `size` new brains. Everything that makes progress
     * durable — untouched elites, mutated elite variants, elite crossover, the
     * rank-weighted risk gradient, fresh immigrants — happens per island, so
     * every island is a full independent run of the GA. */
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

        // one knob for both mutation styles, so the callers below read the same
        const mutate = (net, rate, sigma) => (tau > 0
            ? net.mutateAdaptive(rate, sigma, rng, tau)
            : net.mutate(rate, sigma, rng));

        const next = [];
        // 1) untouched elites — the whole point of elitism: progress cannot be lost
        for (let i = 0; i < ELITES && i < sorted.length; i++) next.push(sorted[i].brain.clone());
        // 2) mutated elite variants — the same brains, nudged
        for (let i = 0; i < MUT_ELITES; i++) {
            const p = sorted[(rng() * ELITES) | 0].brain.clone();
            next.push(mutate(p, mutRate, mutSigma));
        }
        // 3) elites breeding with each other (or, past childZeroFit, more variants)
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
        // 4) the rest: rank-weighted parents, riskier the deeper we go
        const rankExp = cfg.rankExp || 2.2;                    // higher = greedier
        const pickRank = () => {
            const r = Math.pow(rng(), rankExp);                // biased toward rank 0
            return Math.min(sorted.length - 1, (r * sorted.length * 0.55) | 0);
        };
        while (next.length < size - FRESH) {
            const depth = next.length / size;                  // 0 → 1 down the roster
            const mr = mutRate * (0.8 + depth), ms = mutSigma * (0.8 + depth * 1.6);
            if (noChildren) {
                next.push(mutate(sorted[pickRank()].brain.clone(), mr, ms));
            } else {
                const a = sorted[pickRank()].brain;
                const b = sorted[pickRank()].brain;
                next.push(mutate(Genome.crossover(a, b, rng), mr, ms));
            }
        }
        // 5) fresh blood
        while (next.length < size) next.push(makeNet(rng));
        next.length = size;
        return { next, ELITES, FRESH };
    }

    /* Fitness sharing on *behaviour*, not on weights.
     *
     * The failure mode this exists for: by generation 50 the whole population is
     * a family of near-copies of one lineage, every member scoring within a few
     * points of the others, and the GA is really running a population of one. The
     * usual weight-space distance is useless here — two networks can compute the
     * same policy with hidden units permuted — so the distance is measured on
     * what each brain actually *did*: its key-press mix, the stack profile it
     * left, how much it buried, how long it lasted.
     *
     * Each brain's fitness is then divided by how crowded its neighbourhood is,
     * so a brain playing an unusual way keeps its seat even if a dozen brains
     * playing the common way score slightly higher. This changes *selection*
     * only — the champion, the reported numbers and the saved brain are all
     * still chosen on raw fitness, because a diverse-but-bad brain is still bad.
     *
     * Islands were the first attempt at this and lost the A/B outright: at
     * realistic population sizes the sub-populations are too small to sustain
     * selection. Sharing keeps one full-size pool and pays for diversity
     * directly.
     */
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
                    if (d < radius) crowd += 1 - d / radius;      // triangular sharing kernel
                }
            }
            // shift to positive before dividing, or a negative fitness would be
            // *rewarded* for being crowded
            results[i].shared = (results[i].fitness - minFit + 1) / (1 + lambda * crowd);
            results[i].crowd = crowd;
        }
        this.meanCrowd = results.reduce((s, r) => s + (r.crowd || 0), 0) / n;
    }

    /* results: [{brain, fitness, lines, pieces, sig}] in population order. */
    evolve(resultsIn, cfg) {
        // Sharing reorders who gets to breed, but never who is called champion.
        const sharing = cfg.share > 0 && resultsIn.some(r => r.sig);
        if (sharing) this._share(resultsIn, cfg);
        const rank = sharing
            ? (a, b) => b.shared - a.shared
            : (a, b) => b.fitness - a.fitness;
        this._rank = rank;
        const results = resultsIn.slice().sort((a, b) => b.fitness - a.fitness);
        const n = this.popSize;
        const best = results[0];
        const avg = results.reduce((s, r) => s + r.fitness, 0) / results.length;
        const avgLines = results.reduce((s, r) => s + r.lines, 0) / results.length;
        const avgPieces = results.reduce((s, r) => s + r.pieces, 0) / results.length;
        this.history.push({
            best: best.fitness, avg, bestLines: best.lines, avgLines,
            bestPieces: best.pieces, avgPieces,
        });

        // ---- re-score the reigning champion honestly ----
        // Every generation draws new piece sequences, so "best fitness ever seen"
        // is a maximum over noisy measurements: one lucky bag crowns a champion
        // that can never be dethroned, because nobody is ever measured against
        // the same easy seed again. The champion is re-injected into the pool and
        // therefore re-played on *this* generation's seeds — so use that fresh
        // number instead. Comparisons then only ever happen within a generation,
        // where everyone faced the same pieces.
        if (this.injected) {
            const r = results.find(x => x.brain === this.injected);
            if (r) { this.championFit = r.fitness; this.championLines = r.lines; }
        }

        /* ---- the champion is only dethroned by a brain that is better twice ----
         *
         * Beating the champion on this generation's two piece sequences is not
         * evidence of much: with a few dozen brains drawing fresh bags every
         * generation, somebody wins on luck constantly. So when a gate is
         * installed, a challenger that out-scores the champion in-run is then
         * replayed on a bank of held-out games, and only takes the title if it
         * wins there too. The champion keeps its seat — and its untouched elite
         * copy — indefinitely otherwise. That is what `grace: -1` means here:
         * not "sheltered for a few generations" but "cannot be displaced except
         * by something demonstrably better".
         *
         * The gate bank is deliberately *not* the bank used for the final
         * selection. Thousands of generations of gating on a fixed set of games
         * would eventually fit those games, and then the number that decided
         * everything would be the one number nobody was allowed to check. */
        if (best.fitness > this.championFit) {
            let accept = true;
            if (this.gateFn) {
                if (this.championSkill === null || this.championSkill === undefined) {
                    this.championSkill = this.champion ? this.gateFn(this.champion) : -Infinity;
                }
                const challengerSkill = this.gateFn(best.brain);
                this.gateChecks = (this.gateChecks || 0) + 1;
                if (challengerSkill > this.championSkill) {
                    this.championSkill = challengerSkill;
                    this.gateLastSkill = challengerSkill;
                } else {
                    accept = false;
                    this.gateRejects = (this.gateRejects || 0) + 1;
                }
            }
            if (accept) {
                this.championFit = best.fitness;
                this.championLines = best.lines;
                this.champion = best.brain.clone();
                this.stagnant = 0;
            } else {
                this.stagnant++;      // a rejected challenger is still no progress
            }
        } else {
            this.stagnant++;
        }

        const { rate: mutRate, sigma: mutSigma } = this.effective(cfg);

        // ---- champion grace bookkeeping ----
        const gp = cfg.grace | 0;
        const forever = gp < 0;                 // grace: -1 → the seat never expires
        this.graceEvent = null;
        let holderIdx = -1;        // rank of the grace holder, -1 if it is gone
        let graceSlot = -1;        // which population slot (and so which island) it lived in
        if (gp === 0) {
            this.grace = null;
        } else if (forever) {
            // the champion itself holds the seat, permanently. Combined with the
            // held-out gate above, progress cannot be lost to a lucky generation.
            if (this.champion) {
                if (!this.grace || this.grace.net !== this.champion) {
                    this.grace = { net: this.champion, left: Infinity };
                    this.graceEvent = "grace: champion seated permanently";
                }
                graceSlot = resultsIn.findIndex(r => r.brain === this.grace.net);
            }
        } else {
            if (this.grace) holderIdx = results.findIndex(r => r.brain === this.grace.net);
            if (!this.grace || holderIdx === -1) {
                this.grace = { net: results[0].brain, left: gp };
                holderIdx = 0;
                this.graceEvent = "grace: champion crowned";
            } else if (holderIdx === 0) {
                this.grace.left = gp;                       // defended the title
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
            graceSlot = this.grace ? resultsIn.findIndex(r => r.brain === this.grace.net) : -1;
        }

        // ---- breed every island from its own gene pool ----
        const next = new Array(n);
        const islandBest = [];
        let elites0 = 1;
        for (let k = 0; k < this.islands; k++) {
            const [lo, hi] = this.bounds[k];
            // breeding order uses shared fitness when sharing is on
            const sorted = resultsIn.slice(lo, hi).sort(this._rank);
            const bred = this._breed(sorted, hi - lo, cfg, mutRate, mutSigma);
            for (let i = lo; i < hi; i++) next[i] = bred.next[i - lo];
            islandBest.push({ k, lo, hi, sorted, elites: bred.ELITES });
            if (k === 0) elites0 = bred.ELITES;
        }

        // ---- migration ----
        // Every migrateEvery generations each island sends a copy of its best to
        // the next island round-robin, landing in a slot that island was about to
        // fill with a low-rank child. A genuinely better idea therefore spreads,
        // but only slowly enough that the receiving island gets to test it
        // against its own lineage rather than being overwritten by it.
        this.migrated = 0;
        const every = cfg.migrateEvery | 0;
        if (this.islands > 1 && every > 0 && this.gen % every === 0) {
            const donors = islandBest.map(b => next[b.lo].clone());   // each island's elite 0
            for (let k = 0; k < this.islands; k++) {
                const dst = this.bounds[(k + 1) % this.islands];
                const slot = dst[1] - 1 - (this.migrated % Math.max(1, (dst[1] - dst[0]) >> 2));
                next[Math.max(dst[0], slot)] = donors[k];
                this.migrated++;
            }
        }

        // ---- seat the grace holder in its own island, byte-for-byte intact ----
        // Ranks are island-local: a brain that is 9th overall can still be its own
        // island's best, and elite counts are per island. Comparing a global rank
        // against island 0's elite count would seat a needless second copy.
        this.graceIdx = -1;
        if (gp !== 0 && this.grace) {
            const home = islandBest.find(b => graceSlot >= b.lo && graceSlot < b.hi) || islandBest[0];
            const rank = home.sorted.findIndex(r => r.brain === this.grace.net);
            if (rank >= 0 && rank < home.elites) {
                // already sitting in its island's untouched-elite block
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

        // ---- re-inject the best-ever brain, unchanged ----
        // Keeping the champion in a variable is not enough; if it is not put back
        // into the breeding pool every generation the gene pool drifts away from
        // it under selection noise. It also gives us a fresh, honest score for it
        // next generation (see the re-scoring at the top of this method).
        this.injected = null;
        if (cfg.reinject !== false && this.champion) {
            this.injected = this.champion.clone();
            next[elites0 - 1] = this.injected;
        }

        this.brains = next;
        this.gen++;
        this.meanSigma = next.reduce((s, b) => s + b.sigma, 0) / n;
        return { best: best.fitness, avg, bestLines: best.lines, avgLines, avgPieces };
    }
}

if (typeof module !== "undefined") module.exports = { Evolution };
