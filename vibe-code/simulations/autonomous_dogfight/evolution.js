// Neuroevolution driver for the dogfight: a whole population of drones fights
// one free-for-all battle per generation, fitness accrues from flying well and
// shooting straight, then the best breed. Children are direct copy-paste
// patchworks of mom + dad genomes (see crossover in nn.js). Both children and
// elites get mutated — but slot 0 is always an exact, un-mutated copy of the
// best individual of the generation. No gradients anywhere.
'use strict';

const GA = {
    elites: 3,               // top-ranked carried over (slot 0 exact, rest mutated)
    crossoverFrac: 0.70,     // fraction of free slots bred from two parents
    immigrantFrac: 0.10,     // fresh random genomes to keep diversity alive
    selectionPressure: 2.0,  // rank-weight exponent for parent picking
    eliteMutationScale: 0.4, // elites mutate gentler than children
    baseMutationRate: 0.05,
    baseMutationStrength: 0.10,
    baseResetProb: 0.001,
    stagnationThreshold: 10, // gens without improvement (informational)
    // Leadership tenure: the reigning leader keeps the protected slot for at
    // least this many generations. A single-generation win can NOT dethrone
    // it — within-generation fitness spread (~±95) dwarfs true skill
    // differences, so the top scorer of one battle is usually just lucky.
    // Instead the hottest challenger takes the CONTENDER seat (also carried
    // un-mutated) and is re-evaluated every generation alongside the leader;
    // only a proven track record takes the crown.
    leaderGraceGens: 5,      // guaranteed reign length
    contenderMargin: 40,     // recent-avg lead needed to crown DURING grace (~1σ of the compared averages)
    contenderSeatMargin: 30  // one-shot score needed to unseat the contender
};

// Every fitness number in one place. One-off events are flat; *PerSec terms
// are multiplied by dt and accrue every simulation tick.
// Balance rationale: airtime must be the dominant signal while the population
// is still learning to fly (a lucky hit from a 3s crasher must NOT outrank a
// stable flier), yet a competent hunter landing several aimed hits per round
// must clearly beat a passive hoverer.
const REWARDS = {
    hit: 18,                  // landed a shot on someone
    kill: 60,
    damaged: -8,              // got hit
    death: -35,               // shot down
    crash: -45,               // flew into floor / wall / ceiling (self-inflicted)
    surviveRound: 15,         // still airborne when a round's clock runs out
    aimedShot: 0.8,           // fired while locked on and in range
    wildShot: -0.5,           // fired at nothing (ammo discipline)
    qualWeight: 2,            // the disarmed flight-qual round counts double
    alivePerSec: 1.0,
    uprightPerSec: 0.5,
    spinPenaltyPerSec: -0.4,
    altitudeBandPerSec: 0.5,  // staying in the fightable altitude band
    wallPenaltyPerSec: -1.5,  // scaled by proximity, per axis
    facingPerSec: 0.9,        // nose pointed at nearest enemy
    rangePerSec: 0.35         // holding a good engagement distance
};

class Evolution {
    constructor(popSize, seed) {
        this.popSize = Math.max(6, popSize);
        this.seed = (seed >>> 0) || 1;
        this.rng = makeRng(this.seed);
        this.gen = 1;
        this.stagnantGens = 0;
        this.bestEverFitness = -Infinity;
        this.champion = null; // best individual ever seen: {genome, fitness, kills, gen}
        // per-generation series for the charts
        this.history = {
            best: [], mean: [], worst: [],
            kills: [], hits: [],
            meanAliveTime: [], survivors: [],
            diversity: [], mutationRate: []
        };
        this.diversity = 0;
        // Reigning leader: occupies slot 0 un-mutated, re-evaluated every
        // generation. fits[] = its fitness across its tenure — the average is
        // a far lower-noise skill estimate than any single battle.
        this.leader = null;    // {genome, tenure, fits: []}
        // Contender: the hottest challenger, occupies slot 1 un-mutated and
        // builds its own track record. Crowned only when its recent average
        // beats the leader's.
        this.contender = null; // {genome, fits: []}
        this.pop = [];
        for (let i = 0; i < this.popSize; i++) {
            this.pop.push(this._newIndividual(randomGenome(this.rng), 'immigrant'));
        }
        this._pendingChampion = null;
    }

    // origin tags drive the drone colors: 'best' | 'elite' | 'child' | 'immigrant'
    _newIndividual(genome, origin) {
        return {
            genome, origin,
            fitness: 0, kills: 0, hits: 0, shots: 0,
            dead: false, crashed: false, aliveTime: 0,
            roundFits: [], _roundMark: 0
        };
    }

    // ── Fitness accounting (called from the sim loop) ────────────────
    addFitness(i, amount) {
        this.pop[i].fitness += amount;
    }

    registerShot(i, aimed) {
        const ind = this.pop[i];
        ind.shots++;
        ind.fitness += aimed ? REWARDS.aimedShot : REWARDS.wildShot;
    }

    registerHit(shooter, victim) {
        this.pop[shooter].hits++;
        this.pop[shooter].fitness += REWARDS.hit;
        this.pop[victim].fitness += REWARDS.damaged;
    }

    registerKill(shooter) {
        this.pop[shooter].kills++;
        this.pop[shooter].fitness += REWARDS.kill;
    }

    registerDeath(i, timeInRound, wasCrash) {
        const ind = this.pop[i];
        if (ind.dead) return;
        ind.dead = true;
        ind.crashed = wasCrash;
        ind.aliveTime += timeInRound;
        ind.fitness += wasCrash ? REWARDS.crash : REWARDS.death;
    }

    // A generation is evaluated over several rounds — fitness and airtime
    // accumulate, so one lucky or unlucky battle can't decide a genome's fate.
    // Per-round fitness is recorded so endGeneration can weight the qual
    // round and trim the worst armed round. Dead drones revive for the next
    // round.
    endRound(roundTime) {
        this._roundSurvivors = this.pop.filter(p => !p.dead).length;
        for (const ind of this.pop) {
            if (!ind.dead) {
                ind.aliveTime += roundTime;
                ind.fitness += REWARDS.surviveRound;
            }
            ind.dead = false;
            ind.roundFits.push(ind.fitness - ind._roundMark);
            ind._roundMark = ind.fitness;
        }
    }

    // ── Generation turnover ──────────────────────────────────────────
    // Mutation stays at base rate. An earlier version ramped it up on
    // stagnation — but with noisy fitness, one lucky spike set an all-time
    // record nothing could beat, pinning mutation at maximum chaos for the
    // entire run (measured: 300/300 generations at max) and destroying every
    // refinement. Constant gentle mutation beats an adaptive scheme that can
    // wedge itself open.
    effectiveMutation() {
        return {
            rate: GA.baseMutationRate,
            strength: GA.baseMutationStrength,
            resetProb: GA.baseResetProb
        };
    }

    // Call after the final endRound() of the generation.
    endGeneration() {
        // Final fitness = qual round × qualWeight + armed rounds with the
        // single worst one dropped. One unlucky armed round (early stray hit,
        // bad spawn neighborhood) otherwise swings a genome's score by ~±100
        // and drowns real skill differences — measured signal/noise was 0.47
        // on raw sums.
        for (const ind of this.pop) {
            if (ind.roundFits.length === 0) continue; // direct-fitness callers (tests)
            const qual = ind.roundFits[0] * REWARDS.qualWeight;
            let armed = ind.roundFits.slice(1);
            if (armed.length >= 2) {
                armed = armed.slice().sort((a, b) => b - a);
                armed.pop(); // drop the worst armed round
            }
            ind.fitness = qual + armed.reduce((s, v) => s + v, 0);
        }
        const ranked = this.pop.slice().sort((a, b) => b.fitness - a.fitness);
        const best = ranked[0];

        // history for the charts
        const fits = ranked.map(r => r.fitness);
        const h = this.history;
        h.best.push(best.fitness);
        h.mean.push(fits.reduce((s, v) => s + v, 0) / fits.length);
        h.worst.push(fits[fits.length - 1]);
        h.kills.push(this.pop.reduce((s, p) => s + p.kills, 0));
        h.hits.push(this.pop.reduce((s, p) => s + p.hits, 0));
        h.meanAliveTime.push(this.pop.reduce((s, p) => s + p.aliveTime, 0) / this.pop.length);
        h.survivors.push(this._roundSurvivors !== undefined ? this._roundSurvivors : 0);
        h.mutationRate.push(this.effectiveMutation().rate);

        // champion = best individual ever seen (kept for save/load)
        if (!this.champion || best.fitness > this.champion.fitness) {
            this.champion = {
                genome: cloneGenome(best.genome),
                fitness: best.fitness, kills: best.kills, gen: this.gen
            };
        }

        this._updateLeader(ranked);

        // Stagnation gauge (informational, shown in the panel). Compared
        // against the median of recent bests, not the all-time record — a
        // single lucky spike must not read as eternal stagnation.
        const recent = h.best.slice(-12);
        const sortedRecent = recent.slice().sort((a, b) => a - b);
        const recentMedian = sortedRecent[Math.floor(sortedRecent.length / 2)];
        if (best.fitness > recentMedian + 5) {
            this.stagnantGens = 0;
        } else {
            this.stagnantGens++;
        }
        if (best.fitness > this.bestEverFitness) this.bestEverFitness = best.fitness;

        this._breed(ranked);
        this._estimateDiversity();
        h.diversity.push(this.diversity);
        for (const key of Object.keys(h)) {
            if (h[key].length > 300) h[key].shift();
        }
        this.gen++;
        return ranked;
    }

    // Leadership succession. Slot 0 = leader, slot 1 = contender, both carried
    // un-mutated and re-evaluated every generation. The contender is crowned
    // when its recent-average fitness beats the leader's by contenderMargin
    // (truly better — allowed even during grace), or merely beats it once the
    // 5-generation grace period has run out. Recent windows keep the
    // comparison fair as the surrounding population evolves.
    _updateLeader(ranked) {
        const recentAvg = arr => {
            const r = arr.slice(-6);
            return r.reduce((s, v) => s + v, 0) / r.length;
        };

        if (!this.leader) {
            this.leader = { genome: cloneGenome(ranked[0].genome), tenure: 1, fits: [ranked[0].fitness] };
            if (ranked.length > 1) {
                this.contender = { genome: cloneGenome(ranked[1].genome), fits: [ranked[1].fitness] };
            }
        } else {
            const leaderCopy = this.pop[0];
            const contenderCopy = this.contender ? this.pop[1] : null;

            this.leader.fits.push(leaderCopy.fitness);
            if (this.leader.fits.length > 20) this.leader.fits.shift();
            if (this.contender && contenderCopy) {
                this.contender.fits.push(contenderCopy.fitness);
                if (this.contender.fits.length > 6) this.contender.fits.shift();
            }

            // Coronation needs evidence on BOTH sides: the contender must have
            // ≥2 evaluations (≥3 for the truly-better fast path) and the
            // leader's own reign record must have ≥2 — otherwise a freshly
            // crowned leader's single noisy re-score triggers an immediate
            // counter-coronation and the throne ping-pongs (measured: mean
            // reign 1.7 gens without these guards).
            let crowned = false;
            if (this.contender && this.contender.fits.length >= 2 && this.leader.fits.length >= 2) {
                const cAvg = recentAvg(this.contender.fits);
                const lAvg = recentAvg(this.leader.fits);
                const trulyBetter = this.contender.fits.length >= 3 &&
                    cAvg > lAvg + GA.contenderMargin;
                const graceOver = this.leader.tenure >= GA.leaderGraceGens;
                if (trulyBetter || (graceOver && cAvg > lAvg)) {
                    // The deposed leader takes the contender seat, keeping its
                    // record — the two best-known genomes hold the two seats,
                    // and a rematch stays possible. The new leader starts a
                    // FRESH record: judging its reign on inflated
                    // contender-era scores would pad it against fair
                    // comparison for several generations.
                    const deposed = { genome: this.leader.genome, fits: this.leader.fits.slice(-6) };
                    this.leader = { genome: this.contender.genome, tenure: 1, fits: [] };
                    this.contender = deposed;
                    crowned = true;
                }
            }
            if (!crowned) this.leader.tenure++;

            // (re)seat the contender: hottest individual outside the two
            // protected seats. An established contender keeps its seat (and
            // its evidence) unless a newcomer decisively outscores its record.
            const candidate = ranked.find(ind => ind !== leaderCopy && ind !== contenderCopy);
            if (candidate) {
                if (!this.contender) {
                    this.contender = { genome: cloneGenome(candidate.genome), fits: [candidate.fitness] };
                } else if (candidate.fitness > recentAvg(this.contender.fits) + GA.contenderSeatMargin) {
                    this.contender = { genome: cloneGenome(candidate.genome), fits: [candidate.fitness] };
                }
            }
        }

        // user-loaded champion takes the throne outright
        if (this._pendingChampion) {
            this.leader = { genome: cloneGenome(this._pendingChampion), tenure: 1, fits: [] };
            this.contender = null;
            this._pendingChampion = null;
        }
    }

    _breed(ranked) {
        const mut = this.effectiveMutation();
        const next = [];

        // Slot 0: the reigning leader survives EXACTLY as-is — never mutated.
        next.push(this._newIndividual(cloneGenome(this.leader.genome), 'best'));
        // Slot 1: the contender, also exact — it must prove itself over
        // repeated battles to take the crown.
        if (this.contender && next.length < this.popSize) {
            next.push(this._newIndividual(cloneGenome(this.contender.genome), 'contender'));
        }

        // Remaining elites: copied over but mutated (gently)
        for (let i = 1; i < Math.min(GA.elites, ranked.length) && next.length < this.popSize; i++) {
            const g = mutate(cloneGenome(ranked[i].genome),
                mut.rate * GA.eliteMutationScale, mut.strength * GA.eliteMutationScale,
                mut.resetProb, this.rng);
            next.push(this._newIndividual(g, 'elite'));
        }

        // rank-biased parent sampling
        const n = ranked.length;
        const weights = ranked.map((_, r) => Math.pow(n - r, GA.selectionPressure));
        const totalW = weights.reduce((s, v) => s + v, 0);
        const pickParentIdx = () => {
            let t = this.rng() * totalW;
            for (let i = 0; i < n; i++) { t -= weights[i]; if (t <= 0) return i; }
            return n - 1;
        };
        const pickParent = () => ranked[pickParentIdx()];

        const free = this.popSize - next.length;
        const nImmigrant = Math.max(1, Math.round(free * GA.immigrantFrac));
        const nCross = Math.min(free - nImmigrant, Math.round(free * GA.crossoverFrac));

        // crossover children: copy-paste segments of mom + dad, then mutate.
        // Dad comes from a NEARBY fitness rank — related parents share network
        // conventions, so their copied segments actually compose instead of
        // producing an incoherent patchwork of two alien controllers.
        for (let i = 0; i < nCross && next.length < this.popSize; i++) {
            const momIdx = pickParentIdx();
            let dadIdx = momIdx + (1 + Math.floor(this.rng() * 3)) * (this.rng() < 0.5 ? -1 : 1);
            dadIdx = Math.max(0, Math.min(n - 1, dadIdx));
            if (dadIdx === momIdx) dadIdx = (momIdx + 1) % n;
            const g = mutate(crossover(ranked[momIdx].genome, ranked[dadIdx].genome, this.rng),
                mut.rate, mut.strength, mut.resetProb, this.rng);
            next.push(this._newIndividual(g, 'child'));
        }
        // mutated clones of good parents fill the middle
        while (next.length < this.popSize - nImmigrant) {
            const g = mutate(cloneGenome(pickParent().genome),
                mut.rate * 1.4, mut.strength * 1.3, mut.resetProb, this.rng);
            next.push(this._newIndividual(g, 'elite'));
        }
        // fresh random immigrants keep the gene pool from collapsing
        while (next.length < this.popSize) {
            next.push(this._newIndividual(randomGenome(this.rng), 'immigrant'));
        }

        // safety net: repair anything invalid rather than crash mid-run
        for (const ind of next) {
            if (!validGenome(ind.genome)) repairGenome(ind.genome);
        }
        this.pop = next;
    }

    // Cheap genome-diversity estimate: mean |gene difference| over sampled
    // pairs. Near zero means the population has converged.
    _estimateDiversity() {
        const n = this.pop.length;
        let sum = 0, count = 0;
        for (let s = 0; s < 12; s++) {
            const a = this.pop[Math.floor(this.rng() * n)].genome;
            const b = this.pop[Math.floor(this.rng() * n)].genome;
            for (let t = 0; t < 40; t++) {
                const i = Math.floor(this.rng() * a.length);
                sum += Math.abs(a[i] - b[i]);
                count++;
            }
        }
        this.diversity = sum / count;
    }

    // ── Champion save / load ─────────────────────────────────────────
    serializeChampion() {
        if (!this.champion) return null;
        return serializeGenome(this.champion.genome, {
            fitness: this.champion.fitness,
            kills: this.champion.kills,
            gen: this.champion.gen,
            saved: Date.now()
        });
    }

    // Injected genome takes slot 0 (the protected, un-mutated seat) at the
    // next generation turnover.
    loadChampion(json) {
        const parsed = deserializeGenome(json);
        if (!parsed) return false;
        this._pendingChampion = parsed.genome;
        if (!this.champion || (parsed.meta.fitness || 0) > this.champion.fitness) {
            this.champion = {
                genome: cloneGenome(parsed.genome),
                fitness: parsed.meta.fitness || 0,
                kills: parsed.meta.kills || 0,
                gen: parsed.meta.gen || 0
            };
        }
        return true;
    }
}

if (typeof module !== 'undefined') {
    module.exports = { Evolution, GA, REWARDS };
}
