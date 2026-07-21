// Neuroevolution engine: shared-world evaluation across episodes, robust
// aggregate fitness, rank-biased selection, copy-paste crossover, slider
// driven K-gene mutation, elites + protected champion + champion variants,
// random immigrants, stagnation adaptation and the spawn curriculum.
'use strict';

const GA_DEFAULTS = {
    population: 64,
    elites: 2,
    mutChance: 0.9,          // probability a crossover child is mutated at all
    mutGenes: 8,             // K genes touched per mutation event (1..genome);
    sigma: 0.30,             // few-but-strong won a 24-cell grid search (K in
                             // {8,32,64,200} x sigma {0.06,0.15,0.30} x 3 seeds:
                             // K=8 sigma=0.30 delivered on 3/3 seeds, old
                             // 64/0.15 on ~1/3)
    immigrantFrac: 0.12,
    eliteMutants: 0.08,      // share of slots for mutated copies of the elite
                             // cars (their unmutated originals always survive
                             // alongside, protected by the grace window).
                             // At 1.0 the whole generation becomes elite
                             // variants: no crossover children, no immigrants
    eliteSigma: 0.18,        // mutation spread applied to those elite variants
    pressure: 2.0,           // rank-selection pressure
    eliteGrace: 4,           // generations an elite survives after earning its
                             // slot (rolling; graced old elites don't breed).
                             // Benchmark note: longer grace slows learning -
                             // 60-gen delivery-gens at grace 4: 24-38, at 10: 2-9
    stagnationAdapt: true,
    episodesPerGen: 2,
    episodeLen: 120,         // seconds of sim time per episode. The 2026-07
                             // parameter sweep's single biggest lever: 90s
                             // physically caps chains at ~2 deliveries, and
                             // defaults+120s was the ONLY config to reach 3
                             // (gen 60/78 on two of four seeds). 60s cannot
                             // even fit pickup + one 500-650px delivery leg
                             // through 11s reds.
    autoChangeEvery: 0,      // generations between town changes (0 = off)
    carContactEvery: 2,      // car-to-car contact in 1 of every N episode
                             // slots (slot 0 always has contact); the other
                             // slots are GHOST episodes - no car collisions,
                             // no car radar - so clean route driving and
                             // traffic survival are both selected for every
                             // generation. 1 = contact in every episode.
    curriculumThreshold: 1,  // median deliveries/episode to advance a spawn
                             // rung (0 carry-spawn -> 1 short jobs -> 2 full pool)
    bootstrapPriors: true
};

const FIT = {
    DELIVERY: 10000, PICKUP: 2000, COVERAGE: 800, DIST: 0.05,
    // APPROACH: up to 250 per leg for the best (closest x slowest) pass at
    // the door - the smooth ladder from "full route coverage at cruise
    // speed" to a registered standstill stop. Without it that step is a
    // reward cliff: probes showed populations pinned at drive-by coverage
    // for 40+ generations with zero deliveries.
    APPROACH: 250,
    // PROGRESS: per px of leg-best remaining-distance reduction on EVERY leg
    // (world.js caps paid progress at 700px/leg -> <=2800/leg). The dense
    // ramp toward each door: door-side shaping alone (~250) sat an order of
    // magnitude below generation-to-generation traffic noise, so the reward
    // cliffs were invisible to selection. Originally carrying-only - that
    // left the empty leg after a delivery economically dead, and probes
    // showed every leader parking there forever (the "one delivery wall").
    PROGRESS: 4,
    CRASH: 300, CARCOLL: 150, PED: 800, WRONGSIDE: 2, REDLIGHT: 400,
    // Missing a stop (replanned right at the door): the first attempt per leg
    // costs little - the learning frontier lives there, and lost time already
    // hurts - but every REPEAT miss on the same stop (circling the block)
    // costs 75+275 = 350.
    MISS: 75, MISS_REPEAT: 275
};

function episodeFitness(m) {
    // pickupEarned scales each pickup by the route length driven for it
    // (near-spawn freebies pay 0.15x): keeps the stop-learning curriculum
    // rung without letting statue lineages out-score honest driving.
    const f = m.deliveries * FIT.DELIVERY
        + (m.pickupEarned !== undefined ? m.pickupEarned : m.pickups) * FIT.PICKUP
        + (m.legProgress || 0) * FIT.PROGRESS
        + m.coverage * FIT.COVERAGE
        + (m.approach || 0) * FIT.APPROACH
        + m.distance * FIT.DIST
        - m.crash * FIT.CRASH
        - (m.carCollFault !== undefined ? m.carCollFault : m.carColl) * FIT.CARCOLL
        - m.pedColl * FIT.PED
        - m.wrongSideSec * FIT.WRONGSIDE
        - m.redLightRuns * FIT.REDLIGHT
        - (m.misses || 0) * FIT.MISS
        - (m.repeatMisses || 0) * FIT.MISS_REPEAT;
    return Number.isFinite(f) ? f : 0;
}

// A faint physics-informed prior: steer toward the GPS heading, roll when the
// road ahead is clear, ease off for red lights. Deliberately too weak to
// complete a delivery on its own - evolution still has to do the work.
function createBootstrapGenome(rng) {
    const g = new Float64Array(NN_GENOME_LEN);
    const A = NN_ARCH;
    const passthrough = [
        { h: 0, from: 15, w: 2.2 },   // sin(heading error)
        { h: 1, from: 17, w: 2.2 },   // cross-track offset
        { h: 2, from: 0, w: 2.2 },    // forward clearance (ray 0)
        { h: 3, from: 16, w: 2.2 },   // cos(heading error)
        { h: 4, from: 24, w: 2.2 },   // light state ahead
        { h: 5, from: 23, w: 2.2 },   // distance to stop line
        { h: 6, from: 32, w: 2.2 }    // dwell progress (registering a stop)
    ];
    for (const p of passthrough) {
        g[weightIndex(A, 1, p.from, p.h)] = p.w;
        // Carry each prior channel through every hidden layer (gain 1.6
        // roughly cancels tanh compression stage to stage).
        for (let l = 2; l < A.length - 1; l++) g[weightIndex(A, l, p.h, p.h)] = 1.6;
    }
    const OUT = A.length - 1;
    // Steering: chase heading error, correct cross-track drift.
    g[weightIndex(A, OUT, 0, 0)] = 1.4;
    g[weightIndex(A, OUT, 1, 0)] = -1.0;
    // Throttle: clear road + alignment push forward; red light + closeness
    // brake. Alignment outweighs clearance so a target BEHIND the car
    // (cos(headingErr) ~ -1, the GPS overshoot-recovery state) nets a gentle
    // REVERSE instead of driving on - and corners get taken slower for free.
    // Dwell progress brakes hard while a stop is registering; the signal
    // snaps to 0 when the job advances, releasing the brake - the "done,
    // drive on" scaffold.
    g[weightIndex(A, OUT, 2, 1)] = 1.0;
    g[weightIndex(A, OUT, 3, 1)] = 1.2;
    g[weightIndex(A, OUT, 4, 1)] = -0.9;
    g[weightIndex(A, OUT, 5, 1)] = 0.5;
    g[weightIndex(A, OUT, 6, 1)] = -1.1;
    g[biasIndex(A, OUT, 1)] = -0.35;
    // Small noise so bootstrapped genomes are not identical clones.
    for (let i = 0; i < g.length; i++) g[i] += gaussian(rng) * 0.03;
    return repairGenome(g);
}

class Evolution {
    constructor(settings, runSeed) {
        this.s = Object.assign({}, GA_DEFAULTS, settings || {});
        this.runSeed = runSeed >>> 0;
        this.gen = 1;
        this.phase = 0;
        this.evalMode = false;
        this.stagnation = 0;
        this.townCounter = 0;
        this.champion = null;            // {genome, fitness, gen}
        this.eliteRoster = [];           // protected elites: {genome, fitness, age, gen}
        this.history = [];               // {best, mean, dBest, dMean, town}
        this.deliveryWindow = [];        // rolling population-median deliveries
        this.genomes = [];
        this.epFits = [];                // per genome, per episode fitness
        this.epDeliv = [];               // per genome, per episode deliveries
        this.episodeIdx = 0;
        this.world = null;
        this.lastRank = [];              // sorted genome indices of last finished gen
        this.lastAgg = [];
        this.diversity = 0;
        this.events = [];                // UI toast queue
        this.initPopulation();
    }

    rng() {
        if (!this._rng) this._rng = mulberry32(mixSeed(this.runSeed, 0xC0FFEE));
        return this._rng;
    }

    initPopulation() {
        const rng = mulberry32(mixSeed(this.runSeed, 0x171717));
        this.genomes = [];
        for (let i = 0; i < this.s.population; i++) {
            const useBoot = this.s.bootstrapPriors && (i % 4 === 1);   // ~25%
            this.genomes.push(useBoot ? createBootstrapGenome(rng) : randomGenome(rng));
        }
    }

    attach(world) { this.world = world; }

    // A FRESH scenario every generation: the generation number is mixed into
    // the seed, so spawn slots, job assignments and pedestrian streams
    // reshuffle each generation (and every Reset draws a new runSeed).
    // Leaders must re-prove themselves from new spawns instead of replaying
    // one memorized benchmark. What stays fixed is fairness: every car in a
    // generation drives the same shared scenario (ranking and head-to-head
    // dominance compare like with like), and the whole run remains
    // deterministic per (runSeed, gen, town) so probes replay exactly.
    // In frozen eval this.gen does not advance, so the scenario holds still.
    epSeed(episodeIdx) {
        return mixSeed(this.runSeed, 0xBE7C + episodeIdx * 131 + this.gen * 7919, this.townCounter);
    }

    startGeneration() {
        this.epFits = this.genomes.map(() => []);
        this.epDeliv = this.genomes.map(() => []);
        this.episodeIdx = 0;
        this.world.carContactEvery = this.s.carContactEvery;
        startEpisode(this.world, this.genomes, this.phase, 0, this.epSeed(0));
    }

    // One physics tick. Returns flags for the caller (main loop / UI).
    // In FROZEN EVAL mode there is no episode time limit and no evolution:
    // the current genomes drive the fixed benchmark episode until every car
    // is eliminated (truly stagnant survivors fall to the progress watchdog),
    // then the same episode restarts. Nothing is scored or bred.
    tick() {
        const anyAlive = stepWorld(this.world);
        if (this.evalMode) {
            if (anyAlive) return { generationEnded: false };
            this.world.carContactEvery = this.s.carContactEvery;
            startEpisode(this.world, this.genomes, this.phase, 0, this.epSeed(0));
            return { generationEnded: false, evalRestarted: true };
        }
        const timeUp = this.world.simTime >= this.s.episodeLen;
        if (anyAlive && !timeUp) return { generationEnded: false };
        this._collectEpisode();
        if (this.episodeIdx + 1 < this.s.episodesPerGen) {
            this.episodeIdx++;
            this.world.carContactEvery = this.s.carContactEvery;
            startEpisode(this.world, this.genomes, this.phase, this.episodeIdx, this.epSeed(this.episodeIdx));
            return { generationEnded: false };
        }
        this._finishGeneration();
        return { generationEnded: true };
    }

    // Toggle frozen eval. Leaving eval restarts the generation cleanly so the
    // over-long eval episode never leaks into scored fitness.
    setEvalMode(on) {
        if (!!on === !!this.evalMode) return;
        this.evalMode = !!on;
        this.startGeneration();
    }

    _collectEpisode() {
        for (const car of this.world.cars) {
            this.epFits[car.idx].push(episodeFitness(car.m));
            this.epDeliv[car.idx].push(car.m.deliveries);
        }
    }

    _aggregate(fits) {
        const n = fits.length;
        if (!n) return 0;
        const sorted = fits.slice().sort((a, b) => a - b);
        const mean = fits.reduce((a, b) => a + b, 0) / n;
        const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
        const worst = sorted[0];
        return mean * 0.58 + median * 0.27 + worst * 0.15;
    }

    _finishGeneration() {
        const n = this.genomes.length;
        const agg = new Array(n);
        const meanDeliv = new Array(n);
        for (let i = 0; i < n; i++) {
            agg[i] = this._aggregate(this.epFits[i]);
            if (!Number.isFinite(agg[i])) agg[i] = -1e12;
            meanDeliv[i] = this.epDeliv[i].reduce((a, b) => a + b, 0) / Math.max(1, this.epDeliv[i].length);
        }
        const order = agg.map((_, i) => i).sort((a, b) => agg[b] - agg[a]);
        this.lastRank = order;
        this.lastAgg = agg;

        const best = agg[order[0]];
        const mean = agg.reduce((a, b) => a + b, 0) / n;
        const dBest = Math.max(...meanDeliv);
        const dMean = meanDeliv.reduce((a, b) => a + b, 0) / n;
        this.history.push({ best, mean, dBest, dMean, town: this.townCounter });
        if (this.history.length > 400) this.history.shift();

        // Champion update + stagnation tracking. The recorded champion score
        // decays 1% per generation: shared-world evaluation is noisy, and a
        // single lucky score must not freeze improvement detection forever.
        if (this.champion && Number.isFinite(this.champion.fitness)) {
            this.champion.fitness *= 0.99;
        }
        // Dethroning demands head-to-head dominance too: the challenger must
        // beat the reigning champion's copy in EVERY episode this generation.
        // Identical genomes are exempt - that is the champion re-scoring
        // itself, which must still refresh the record.
        let champBeaten = true;
        if (this.champion && !this._identical(this.genomes[order[0]], this.champion.genome)) {
            let ci = -1;
            for (let i = 0; i < n; i++) {
                if (this._identical(this.genomes[i], this.champion.genome)) { ci = i; break; }
            }
            if (ci >= 0) champBeaten = this._beatsAllEpisodes(order[0], ci);
        }
        if (!this.champion || (champBeaten && best > this.champion.fitness + Math.abs(this.champion.fitness) * 1e-4 + 1e-9)) {
            const isNew = !this.champion || best > this.champion.fitness + 1;
            this.champion = { genome: cloneGenome(this.genomes[order[0]]), fitness: best, gen: this.gen, idx: order[0] };
            this.stagnation = 0;
            if (isNew && best > 0) this.events.push({ type: 'champion', gen: this.gen, fitness: best });
        } else {
            this.stagnation++;
        }

        // Curriculum: three spawn rungs. 0 = spawn already CARRYING with a
        // short leg to the door (trains driving + the terminal standstill
        // directly), 1 = spawn empty, nearest short pickup (full chain),
        // 2 = full job pool. Advance one rung when the population MEDIAN
        // holds the delivery bar for 3 straight generations; the window
        // resets so each rung is re-earned at the harder task.
        const medDeliv = meanDeliv.slice().sort((a, b) => a - b)[Math.floor(n / 2)];
        this.deliveryWindow.push(medDeliv);
        if (this.deliveryWindow.length > 3) this.deliveryWindow.shift();
        if (this.phase < 2 && this.deliveryWindow.length === 3 &&
            Math.min(...this.deliveryWindow) >= this.s.curriculumThreshold) {
            this.phase++;
            this.deliveryWindow.length = 0;
            this.events.push({ type: 'phase', phase: this.phase });
        }

        this.diversity = this._estimateDiversity();
        this._updateEliteRoster(order, agg);
        this.genomes = this._buildNextGeneration(order, agg);
        this.gen++;
    }

    _identical(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    // Head-to-head dominance: did the challenger beat the incumbent in EVERY
    // episode of this generation? Both drove the same worlds simultaneously,
    // so this comparison is luck-resistant in a way single aggregates are
    // not - one lucky episode can no longer evict a proven leader. Missing
    // data on either side (e.g. the incumbent's copy did not drive this
    // generation) falls back to the aggregate-margin rule alone.
    _beatsAllEpisodes(chIdx, incIdx) {
        const a = this.epFits && this.epFits[chIdx];
        const b = this.epFits && this.epFits[incIdx];
        if (!a || !b || !a.length || !b.length) return true;
        const n = Math.min(a.length, b.length);
        for (let e = 0; e < n; e++) if (a[e] <= b[e]) return false;
        return true;
    }

    // Elite grace: in a shared world an elite can be eliminated through no
    // fault of its own (another car rams it), so earning elite status grants
    // protection for GRACE generations. Performing at elite level again
    // resets the window (rolling); a newcomer ends an entry's protection
    // early only by CLEARLY beating its record AND beating it head-to-head
    // in every episode of this generation.
    _updateEliteRoster(order, agg) {
        const GRACE = Math.max(0, this.s.eliteGrace | 0);
        const topK = Math.min(this.s.elites, order.length);
        for (const e of this.eliteRoster) {
            e.age++;
            e._judgedIdx = -1;
            // Records decay like the champion's: a stale lucky score must not
            // gatekeep the roster against genuinely current performers.
            if (e.fitness !== null) e.fitness *= 0.99;
            for (let i = 0; i < this.genomes.length; i++) {
                if (this._identical(this.genomes[i], e.genome)) {
                    if (e.fitness === null || agg[i] > e.fitness) e.fitness = agg[i];
                    for (let k = 0; k < topK; k++) if (order[k] === i) e.age = 0;
                    e.idx = i;   // remember the slot it was judged in
                    e._judgedIdx = i;
                    break;
                }
            }
        }
        const newcomers = [];
        for (let k = 0; k < topK; k++) {
            const gi = order[k];
            if (this.eliteRoster.some(e => this._identical(e.genome, this.genomes[gi]))) continue;
            // idx pins the genome to the population slot it EARNED its rank
            // in: spawn point and job assignment derive from the slot, so an
            // unpinned elite would be re-judged on a different scenario every
            // generation - grace would protect it from bad luck while feeding
            // it new luck. Pinned, the fixed benchmark episode really is a
            // repeatable regression test for protected genomes.
            newcomers.push({ genome: cloneGenome(this.genomes[gi]), fitness: agg[gi], age: 0, gen: this.gen, idx: gi });
        }
        let old = this.eliteRoster.filter(e => {
            if (e.age >= GRACE) return false;                        // grace expired un-renewed
            if (e.fitness !== null &&
                newcomers.some(nc => nc.fitness > e.fitness * 1.05 + 1 &&
                    this._beatsAllEpisodes(nc.idx, e._judgedIdx))) return false;   // superseded head-to-head
            return true;
        });
        // The current generation's top-K are ALWAYS protected - the cap only
        // limits how many graced old elites ride along. Old entries are
        // trimmed by RECENCY (youngest protection first): the grace window is
        // about shielding recent elites from unlucky deaths, while long-term
        // quality memory is the global champion's job. (Earlier versions
        // trimmed by record, letting stale lucky scores camp the slots and
        // silently strip recent elites of their grace.)
        const oldSlots = 4;
        if (old.length > oldSlots) {
            old.sort((a, b) => a.age - b.age);
            old.length = oldSlots;
        }
        this.eliteRoster = [...newcomers, ...old];
    }

    _estimateDiversity() {
        const rng = this.rng();
        const n = this.genomes.length;
        if (n < 2) return 0;
        let sum = 0, cnt = 0;
        for (let s = 0; s < 12; s++) {
            const a = this.genomes[Math.floor(rng() * n)];
            const b = this.genomes[Math.floor(rng() * n)];
            for (let k = 0; k < 40; k++) {
                const i = Math.floor(rng() * NN_GENOME_LEN);
                sum += Math.abs(a[i] - b[i]);
                cnt++;
            }
        }
        return sum / Math.max(1, cnt);
    }

    _rankBiasedPick(order, rng) {
        // pow(N - rank, pressure) weighting over the sorted order, sampled via
        // the closed-form inverse CDF. Population slots holding graced old
        // elites are skipped (they survive without breeding rights).
        const n = order.length;
        for (let attempt = 0; attempt < 8; attempt++) {
            const u = Math.pow(rng(), 1 / (this.s.pressure + 1));
            const idx = order[Math.min(n - 1, Math.floor((1 - u) * n))];
            if (!this._noBreedSlots || !this._noBreedSlots.has(idx)) return idx;
        }
        return order[0];
    }

    _mutParams() {
        const s = this.s.stagnationAdapt ? Math.min(this.stagnation / 10, 1) : 0;
        return {
            K: Math.round(this.s.mutGenes * lerp(1, 1.8, s)),
            sigma: this.s.sigma * lerp(1, 2.2, s)
        };
    }

    _buildNextGeneration(order, agg) {
        const rng = this.rng();
        const n = this.s.population;
        const next = new Array(n).fill(null);
        const { K, sigma } = this._mutParams();

        // Protected genomes are PINNED to the population slot they earned
        // their rank in. Spawn point and job assignment derive from the slot,
        // so an unpinned elite would face a new scenario every generation;
        // pinned, the fixed benchmark episode re-tests it on the exact drive
        // that made it an elite. Collisions fall back to the first free slot.
        const place = (genome, pin, noBreed) => {
            let at = (Number.isInteger(pin) && pin >= 0 && pin < n && next[pin] === null) ? pin : -1;
            if (at < 0) at = next.indexOf(null);
            if (at < 0) return -1;
            next[at] = genome;
            if (noBreed) this._noBreedSlots.add(at);
            return at;
        };
        const put = (genome) => place(genome, -1, false);

        // 1) Protected elite roster, byte-identical. The roster was refreshed
        // this generation, so it contains the current top-K plus any earlier
        // elites still inside their grace window. Graced OLD entries (age>0)
        // survive but do NOT breed until they re-earn a top rank: their
        // population slots are excluded from parent selection, so a long
        // grace shields leaders from unlucky deaths without letting stale
        // lineages keep pulling the gene pool backward. (Pinning also makes
        // that exclusion exact: slot numbers now persist across generations.)
        this._noBreedSlots = new Set();
        if (this.eliteRoster.length) {
            for (const e of this.eliteRoster) {
                const at = place(cloneGenome(e.genome), e.idx, e.age > 0);
                if (at >= 0) e.idx = at;
            }
        } else {
            const nElites = Math.min(this.s.elites, order.length);
            for (let i = 0; i < nElites; i++) {
                place(cloneGenome(this.genomes[order[i]]), order[i], false);
            }
        }
        // 2) Protected global champion — inserted unless something already
        // placed is a byte-identical copy. The comparison must be FULL:
        // champion variants can win a generation while differing in only a
        // handful of genes, and a sampled check would silently drop the true
        // champion.
        if (this.champion) {
            let present = false;
            for (const g of next) {
                if (g && this._identical(g, this.champion.genome)) { present = true; break; }
            }
            if (!present) {
                const at = place(cloneGenome(this.champion.genome), this.champion.idx, false);
                if (at >= 0) this.champion.idx = at;
            }
        }
        // 3) Elite variants: mutated copies of the elite cars (champion +
        // roster, round-robin) compete alongside their protected originals.
        // Share of the population and mutation spread are user sliders; a
        // variant only replaces its source by genuinely out-scoring it, since
        // the byte-identical originals above stay for the grace window.
        const sources = [];
        if (this.champion) sources.push(this.champion.genome);
        for (const e of this.eliteRoster) sources.push(e.genome);
        if (!sources.length && order.length) sources.push(this.genomes[order[0]]);
        // At 100% the variants fill every remaining slot; sections 4 and 5
        // then find the population full and contribute nothing - pure
        // hill-climbing on the current leaders.
        const nVariants = Math.round(n * this.s.eliteMutants);
        for (let i = 0; i < nVariants && sources.length; i++) {
            const gv = cloneGenome(sources[i % sources.length]);
            mutateGenomeK(gv, Math.max(1, Math.round(K * 0.3)), this.s.eliteSigma, 0.001, rng);
            if (put(gv) < 0) break;
        }
        // 4) Random immigrants. Half arrive with the faint physics prior so the
        // "steer along the route" scaffold keeps re-entering the gene pool;
        // pure random immigrants almost never survive selection on their own.
        const nImm = Math.round(n * this.s.immigrantFrac);
        for (let i = 0; i < nImm; i++) {
            put(this.s.bootstrapPriors && (i % 2 === 0) ? createBootstrapGenome(rng) : randomGenome(rng));
        }
        // 5) Crossover children + single-parent mutants fill the rest.
        let remaining = 0;
        for (let i = 0; i < n; i++) if (next[i] === null) remaining++;
        const nCross = Math.round(remaining * 0.73);
        for (let i = 0; i < remaining; i++) {
            if (i < nCross) {
                const pa = this._rankBiasedPick(order, rng);
                let pb = this._rankBiasedPick(order, rng);
                if (pb === pa) pb = order[(order.indexOf(pa) + 1) % order.length];
                const child = crossoverGenomes(this.genomes[pa], this.genomes[pb], rng);
                if (rng() < this.s.mutChance) mutateGenomeK(child, K, sigma, 0.002, rng);
                put(child);
            } else {
                const p = this._rankBiasedPick(order, rng);
                const child = cloneGenome(this.genomes[p]);
                mutateGenomeK(child, K, sigma, 0.002, rng);
                put(child);
            }
        }
        for (let i = 0; i < n; i++) if (next[i] === null) next[i] = randomGenome(rng);
        return next;
    }

    // Applied when the town changes: champion and roster genomes survive but
    // their scores are stale on new geography, so re-baseline comparisons and
    // give roster entries a fresh grace window on the new streets.
    onTownChanged(townCounter) {
        this.townCounter = townCounter;
        if (this.champion) this.champion.fitness = -Infinity;
        for (const e of this.eliteRoster) { e.fitness = null; e.age = 0; }
        this.stagnation = 0;
        this.deliveryWindow = [];
    }

    // Resize population (applies on next reset/rebuild).
    setPopulation(p) { this.s.population = p; }

    toJSON() {
        const top = [];
        for (let i = 0; i < Math.min(8, this.lastRank.length); i++) {
            top.push(Array.from(this.genomes[this.lastRank[i]] || this.genomes[i] || []));
        }
        return {
            version: NN_VERSION, arch: NN_ARCH,
            gen: this.gen, phase: this.phase, stagnation: this.stagnation,
            runSeed: this.runSeed,
            townCounter: this.townCounter,
            champion: this.champion ? serializeGenome(this.champion.genome, { fitness: this.champion.fitness, gen: this.champion.gen, idx: this.champion.idx }) : null,
            roster: this.eliteRoster.map(e => ({ g: Array.from(e.genome), fitness: e.fitness, age: e.age, gen: e.gen, idx: e.idx })),
            top,
            history: this.history.slice(-400),
            settings: this.s
        };
    }

    static fromJSON(obj, runSeed) {
        if (!obj || obj.version !== NN_VERSION) return null;
        if (!Array.isArray(obj.arch) || obj.arch.join(',') !== NN_ARCH.join(',')) return null;
        // Saved runs keep their own seed so the scenario stream continues
        // exactly across reloads; the caller's seed is only the fallback.
        const ev = new Evolution(obj.settings || {}, obj.runSeed !== undefined ? obj.runSeed : runSeed);
        ev.gen = obj.gen || 1;
        ev.phase = obj.phase || 0;
        ev.stagnation = obj.stagnation || 0;
        ev.townCounter = obj.townCounter || 0;
        ev.history = Array.isArray(obj.history) ? obj.history : [];
        if (obj.champion) {
            const c = deserializeGenome(obj.champion);
            if (c) ev.champion = { genome: c.genome, fitness: (c.meta && c.meta.fitness) || 0, gen: (c.meta && c.meta.gen) || 1, idx: c.meta && Number.isInteger(c.meta.idx) ? c.meta.idx : 0 };
        }
        if (Array.isArray(obj.roster)) {
            for (const r of obj.roster) {
                if (!r || !Array.isArray(r.g) || r.g.length !== NN_GENOME_LEN) continue;
                ev.eliteRoster.push({
                    genome: repairGenome(Float64Array.from(r.g)),
                    fitness: Number.isFinite(r.fitness) ? r.fitness : null,
                    age: r.age | 0, gen: r.gen | 0,
                    idx: Number.isInteger(r.idx) ? r.idx : undefined
                });
            }
            const maxRoster = ev.s.elites * 2 + 4;
            if (ev.eliteRoster.length > maxRoster) ev.eliteRoster.length = maxRoster;
        }
        // Seed the fresh population with the saved top genomes (mutated copies).
        if (Array.isArray(obj.top)) {
            const rng = ev.rng();
            let slot = 0;
            for (const arr of obj.top) {
                if (!Array.isArray(arr) || arr.length !== NN_GENOME_LEN) continue;
                const g = repairGenome(Float64Array.from(arr));
                if (slot < ev.genomes.length) ev.genomes[slot++] = g;
                if (slot < ev.genomes.length) {
                    const gm = cloneGenome(g);
                    mutateGenomeK(gm, Math.max(1, ev.s.mutGenes), ev.s.sigma, 0.002, rng);
                    ev.genomes[slot++] = gm;
                }
            }
        }
        if (ev.champion && ev.genomes.length) ev.genomes[0] = cloneGenome(ev.champion.genome);
        return ev;
    }
}

if (typeof module !== 'undefined') {
    module.exports = { GA_DEFAULTS, FIT, episodeFitness, createBootstrapGenome, Evolution };
}
