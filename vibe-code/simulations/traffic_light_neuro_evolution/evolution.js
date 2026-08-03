// Neuroevolution engine.
//
// One genome = one controller = every light in one city. A generation runs the
// whole population over the same city and the same schedule of trips, then also
// runs three classical controllers over exactly the same thing, so the chart on
// screen is a real answer to "is this any good", not a self-referential fitness
// curve that can rise while the network gets worse.
//
// Three things this borrows because they were each the single biggest win in an
// earlier sim:
//   * COMMON RANDOM NUMBERS - identical city, identical trips, identical driver
//     personalities for every genome in a generation. Without it a two-episode
//     fitness measures the draw more than the controller (chess).
//   * A VALIDATED CHAMPION - the challenger has to beat the sitting champion in
//     every episode, not just post a better aggregate (chess, 3D walk).
//   * WORST-EPISODE WEIGHTING - a controller that only handles the easy demand
//     pattern is graded by its bad day (boats).
'use strict';

const GA_DEFAULTS = {
    population: 36,
    elites: 2,
    episodesPerGen: 2,
    episodeLen: 240,
    mutChance: 0.65,
    mutGenes: 60,          // K genes touched per mutation event
    sigma: 0.26,
    immigrantFrac: 0.06,
    eliteMutants: 0.22,
    eliteSigma: 0.18,
    pressure: 2.0,
    eliteGrace: 8,
    stagnationAdapt: true,
    bootstrapPriors: true,
    citiesPerTier: 3,      // layouts rotated within a tier, so a brain cannot
                           // memorise one street plan
    advanceRatio: 0.92,    // median must reach this multiple of the ACTUATED
                           // controller's score to unlock the next tier
    advanceWindow: 3,
    tierPatience: 150,     // generations before a tier unlocks regardless
    tier: 0,               // starting tier; the curriculum moves it up
    lockTier: false,
    demand: 1.0,
    pedDemand: 1.0
};

// A car that gets where it was going is the point. Everything else is a cost,
// priced in units of "cars delivered": one crash costs fourteen completed car
// trips, one person struck costs forty-two. Delay is per second per traveller,
// so shaving two seconds off a hundred journeys is worth about one extra
// arrival - which is roughly the exchange rate real traffic engineers use.
const FIT = {
    CAR: 100,
    PED: 70,
    DELAY: 0.55,
    CRASH: 1400,
    PEDHIT: 4200,
    STOP: 1.2,
    EBRAKE: 5
};

function episodeScore(m) {
    const f = m.carsOut * FIT.CAR
        + m.pedsOut * FIT.PED
        - (m.carDelay + m.pedDelay) * FIT.DELAY
        - m.crashes * FIT.CRASH
        - m.pedHits * FIT.PEDHIT
        - m.stops * FIT.STOP
        - m.ebrakes * FIT.EBRAKE;
    return Number.isFinite(f) ? f : -1e9;
}

class Evolution {
    constructor(settings, runSeed) {
        this.s = Object.assign({}, GA_DEFAULTS, settings || {});
        this.runSeed = (runSeed === undefined ? 12345 : runSeed) >>> 0;
        this.gen = 1;
        this.tier = this.s.tier | 0;
        this.stagnation = 0;
        this.champion = null;
        this.eliteRoster = [];
        this.history = [];
        this.advanceWindow = [];
        this.events = [];
        this.genomes = [];
        this.cityCache = new Map();
        this.worldCache = new Map();
        this.baseline = null;
        this.lastRank = [];
        this.lastAgg = [];
        this.lastMetrics = [];
        this.diversity = 0;
        this.initPopulation();
        this.startGeneration();
    }

    rng() {
        if (!this._rng) this._rng = mulberry32(mixSeed(this.runSeed, 0xC0FFEE));
        return this._rng;
    }

    initPopulation() {
        const rng = mulberry32(mixSeed(this.runSeed, 0x171717));
        this.genomes = [];
        for (let i = 0; i < this.s.population; i++) {
            const boot = this.s.bootstrapPriors && (i % 4 === 1);
            this.genomes.push(boot ? createBootstrapGenome(rng) : randomGenome(rng));
        }
    }

    // --- cities -------------------------------------------------------------
    cityFor(tier, slot) {
        const key = tier * 97 + slot;
        let c = this.cityCache.get(key);
        if (!c) {
            c = makeCity(tier, mixSeed(this.runSeed, 0xC17 + tier * 31, slot));
            this.cityCache.set(key, c);
        }
        return c;
    }

    worldFor(city) {
        let w = this.worldCache.get(city);
        if (!w) {
            w = new World(city, {
                episodeLen: this.s.episodeLen,
                demand: this.s.demand, pedDemand: this.s.pedDemand
            });
            this.worldCache.set(city, w);
        }
        // Re-apply the live settings to the cached world. episodeLen has to go
        // through the same timeScale the World constructor applies, or a cached
        // world runs a shorter episode than a fresh one built from identical
        // settings. That mismatch is not cosmetic: the trainer scored a 200s
        // episode on a city the page runs for 380s, so the population was never
        // evaluated on the congested part of the episode - the only part where
        // collisions happen. Safety was free, and evolution priced it that way.
        w.opts.episodeLen = this.s.episodeLen;
        w.episodeLen = this.s.episodeLen * (city.spec.timeScale || 1);
        w.opts.demand = this.s.demand;
        w.opts.pedDemand = this.s.pedDemand;
        return w;
    }

    // Every genome AND every baseline in a generation sees this exact stream.
    epSeed(e) { return mixSeed(this.runSeed, 0xBE7 + e * 131 + this.gen * 7919, this.tier); }

    // --- generation lifecycle ----------------------------------------------
    startGeneration() {
        const slot = this.s.citiesPerTier > 0 ? (this.gen - 1) % this.s.citiesPerTier : 0;
        this.city = this.cityFor(this.tier, slot);
        this.world = this.worldFor(this.city);
        this.epCount = Math.max(1, this.s.episodesPerGen | 0);
        this.epScores = this.genomes.map(() => []);
        this.epMetrics = this.genomes.map(() => []);
        this.baseRuns = { fixed: [], actuated: [], random: [] };
        this.stage = 'baseline';
        this.cursor = { ctrl: 0, gi: 0, ep: 0 };
        this._beginEpisode();
    }

    _controllerNames() { return ['fixed', 'actuated', 'random']; }

    _makeBaseline(name, ep) {
        if (name === 'fixed') return fixedTimeController();
        if (name === 'actuated') return actuatedController();
        return randomController(mixSeed(this.runSeed, 0xAA + ep, this.gen));
    }

    _beginEpisode() {
        const c = this.cursor;
        if (this.stage === 'baseline') {
            const name = this._controllerNames()[c.ctrl];
            this.world.reset(this.epSeed(c.ep), this._makeBaseline(name, c.ep));
            this.evaluating = { kind: 'baseline', name, ep: c.ep };
        } else {
            this.world.reset(this.epSeed(c.ep), brainController(this.genomes[c.gi]));
            this.evaluating = { kind: 'genome', idx: c.gi, ep: c.ep };
        }
    }

    _endEpisode() {
        const m = this.world.finish();
        const sc = episodeScore(m);
        const c = this.cursor;
        if (this.stage === 'baseline') {
            this.baseRuns[this._controllerNames()[c.ctrl]].push({ score: sc, m });
            c.ep++;
            if (c.ep >= this.epCount) { c.ep = 0; c.ctrl++; }
            if (c.ctrl >= 3) { this.stage = 'population'; c.gi = 0; c.ep = 0; }
        } else {
            this.epScores[c.gi].push(sc);
            this.epMetrics[c.gi].push(m);
            c.ep++;
            if (c.ep >= this.epCount) { c.ep = 0; c.gi++; }
            if (c.gi >= this.genomes.length) { this._finishGeneration(); return true; }
        }
        this._beginEpisode();
        return false;
    }

    // Advance the simulation for up to `budgetMs` of wall clock (or a fixed
    // number of steps when headless). Returns true when a generation completed.
    // With neither bound it runs until the generation ends. `maxSteps` is not
    // just a speed knob: under a frozen clock (headless virtual time) the
    // wall-clock check never fires, so a caller that only passes budgetMs would
    // spin forever.
    run(budgetMs, maxSteps) {
        const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        let steps = 0;
        let ended = false;
        for (;;) {
            const alive = this.world.step(SIM.DT);
            steps++;
            if (!alive) { if (this._endEpisode()) { ended = true; break; } }
            if (maxSteps && steps >= maxSteps) break;
            if (budgetMs) {
                const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                if (now - t0 >= budgetMs) break;
            }
        }
        return ended;
    }

    // Headless: run whole generations with no wall-clock budget.
    runGeneration() {
        for (;;) {
            const alive = this.world.step(SIM.DT);
            if (!alive && this._endEpisode()) return this.history[this.history.length - 1];
        }
    }

    _aggregate(scores) {
        if (!scores.length) return -1e9;
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const worst = Math.min(...scores);
        return mean * 0.6 + worst * 0.4;
    }

    _finishGeneration() {
        const n = this.genomes.length;
        const agg = new Array(n);
        for (let i = 0; i < n; i++) agg[i] = this._aggregate(this.epScores[i]);
        const order = agg.map((_, i) => i).sort((a, b) => agg[b] - agg[a]);
        this.lastRank = order;
        this.lastAgg = agg;
        this.lastMetrics = this.epMetrics;

        const sorted = agg.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(n / 2)];
        const best = agg[order[0]];
        const mean = agg.reduce((a, b) => a + b, 0) / n;

        const baseAgg = {};
        for (const k of this._controllerNames()) {
            baseAgg[k] = this._aggregate(this.baseRuns[k].map(r => r.score));
        }
        this.baseline = { agg: baseAgg, runs: this.baseRuns };

        const bm = this._meanMetrics(this.epMetrics[order[0]]);
        this.history.push({
            gen: this.gen, tier: this.tier,
            best, mean, median,
            fixed: baseAgg.fixed, actuated: baseAgg.actuated, random: baseAgg.random,
            thr: bm.carThroughput, pthr: bm.pedThroughput,
            delay: bm.meanCarDelay, crashes: bm.crashes, hits: bm.pedHits
        });
        if (this.history.length > 600) this.history.shift();

        // Champion: decayed record + head-to-head validation on every episode.
        if (this.champion && Number.isFinite(this.champion.fitness)) this.champion.fitness *= 0.99;
        let champBeaten = true;
        if (this.champion && !this._identical(this.genomes[order[0]], this.champion.genome)) {
            let ci = -1;
            for (let i = 0; i < n; i++) if (this._identical(this.genomes[i], this.champion.genome)) { ci = i; break; }
            if (ci >= 0) champBeaten = this._beatsAllEpisodes(order[0], ci);
        }
        if (!this.champion || (champBeaten && best > this.champion.fitness + 1e-6)) {
            const isNew = !this.champion || best > this.champion.fitness + 1;
            this.champion = {
                genome: cloneGenome(this.genomes[order[0]]), fitness: best, gen: this.gen,
                idx: order[0], tier: this.tier,
                metrics: this._meanMetrics(this.epMetrics[order[0]])
            };
            this.stagnation = 0;
            if (isNew) this.events.push({ type: 'champion', gen: this.gen, fitness: best });
        } else {
            this.stagnation++;
        }

        // Curriculum. The bar is not "better than nothing" - it is the better of
        // the two controllers a real city would actually have installed, held
        // for `advanceWindow` consecutive generations by the population MEDIAN
        // rather than by one lucky genome. A tier held far too long unlocks
        // anyway, so a run cannot be trapped forever on one street plan.
        const bar = Math.max(baseAgg.fixed, baseAgg.actuated * this.s.advanceRatio);
        this.tierAge = (this.tierAge || 0) + 1;
        this.advanceWindow.push(median >= bar && Number.isFinite(bar) ? 1 : 0);
        if (this.advanceWindow.length > this.s.advanceWindow) this.advanceWindow.shift();
        const earned = this.advanceWindow.length === this.s.advanceWindow &&
            this.advanceWindow.every(v => v === 1);
        if (!this.s.lockTier && this.tier < CITY_TIERS.length - 1 &&
            (earned || this.tierAge >= this.s.tierPatience)) {
            this.tierAge = 0;
            this.tier++;
            this.advanceWindow.length = 0;
            this.stagnation = 0;
            // Scores are meaningless on a different city, so records reset.
            if (this.champion) this.champion.fitness = -Infinity;
            for (const e of this.eliteRoster) { e.fitness = null; e.age = 0; }
            this.events.push({ type: 'tier', tier: this.tier, name: CITY_TIERS[this.tier].name });
        }

        this.diversity = this._estimateDiversity();
        this._updateEliteRoster(order, agg);
        this.genomes = this._buildNextGeneration(order, agg);
        this.gen++;
        this.startGeneration();
    }

    _meanMetrics(list) {
        const out = {
            carsIn: 0, carsOut: 0, pedsIn: 0, pedsOut: 0, crashes: 0, pedHits: 0,
            carThroughput: 0, pedThroughput: 0, meanCarDelay: 0, meanPedDelay: 0,
            stops: 0, ebrakes: 0, redEntries: 0
        };
        if (!list || !list.length) return out;
        for (const m of list) for (const k of Object.keys(out)) out[k] += (m[k] || 0);
        for (const k of Object.keys(out)) out[k] /= list.length;
        return out;
    }

    _identical(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    _beatsAllEpisodes(chIdx, incIdx) {
        const a = this.epScores[chIdx], b = this.epScores[incIdx];
        if (!a || !b || !a.length || !b.length) return true;
        const n = Math.min(a.length, b.length);
        for (let e = 0; e < n; e++) if (a[e] <= b[e]) return false;
        return true;
    }

    _updateEliteRoster(order, agg) {
        const GRACE = Math.max(0, this.s.eliteGrace | 0);
        const topK = Math.min(this.s.elites, order.length);
        for (const e of this.eliteRoster) {
            e.age++;
            e._judgedIdx = -1;
            if (e.fitness !== null) e.fitness *= 0.99;
            for (let i = 0; i < this.genomes.length; i++) {
                if (this._identical(this.genomes[i], e.genome)) {
                    if (e.fitness === null || agg[i] > e.fitness) e.fitness = agg[i];
                    for (let k = 0; k < topK; k++) if (order[k] === i) e.age = 0;
                    e.idx = i; e._judgedIdx = i;
                    break;
                }
            }
        }
        const newcomers = [];
        for (let k = 0; k < topK; k++) {
            const gi = order[k];
            if (this.eliteRoster.some(e => this._identical(e.genome, this.genomes[gi]))) continue;
            newcomers.push({ genome: cloneGenome(this.genomes[gi]), fitness: agg[gi], age: 0, gen: this.gen, idx: gi });
        }
        let old = this.eliteRoster.filter(e => {
            if (e.age >= GRACE) return false;
            if (e.fitness !== null && newcomers.some(nc => nc.fitness > e.fitness * 1.05 + 1 &&
                this._beatsAllEpisodes(nc.idx, e._judgedIdx))) return false;
            return true;
        });
        if (old.length > 4) { old.sort((a, b) => a.age - b.age); old.length = 4; }
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
                sum += Math.abs(a[i] - b[i]); cnt++;
            }
        }
        return sum / Math.max(1, cnt);
    }

    _rankBiasedPick(order, rng) {
        const n = order.length;
        for (let attempt = 0; attempt < 8; attempt++) {
            const u = Math.pow(rng(), 1 / (this.s.pressure + 1));
            const idx = order[Math.min(n - 1, Math.floor((1 - u) * n))];
            if (!this._noBreed || !this._noBreed.has(idx)) return idx;
        }
        return order[0];
    }

    _mutParams() {
        const s = this.s.stagnationAdapt ? Math.min(this.stagnation / 12, 1) : 0;
        return { K: Math.round(this.s.mutGenes * lerp(1, 2.0, s)), sigma: this.s.sigma * lerp(1, 2.2, s) };
    }

    _buildNextGeneration(order, agg) {
        const rng = this.rng();
        const n = this.s.population;
        const next = new Array(n).fill(null);
        const { K, sigma } = this._mutParams();
        this._noBreed = new Set();

        const place = (genome, pin, noBreed) => {
            let at = (Number.isInteger(pin) && pin >= 0 && pin < n && next[pin] === null) ? pin : -1;
            if (at < 0) at = next.indexOf(null);
            if (at < 0) return -1;
            next[at] = genome;
            if (noBreed) this._noBreed.add(at);
            return at;
        };
        const put = g => place(g, -1, false);

        if (this.eliteRoster.length) {
            for (const e of this.eliteRoster) {
                const at = place(cloneGenome(e.genome), e.idx, e.age > 0);
                if (at >= 0) e.idx = at;
            }
        } else {
            for (let i = 0; i < Math.min(this.s.elites, order.length); i++) {
                place(cloneGenome(this.genomes[order[i]]), order[i], false);
            }
        }
        if (this.champion) {
            let present = false;
            for (const g of next) if (g && this._identical(g, this.champion.genome)) { present = true; break; }
            if (!present) {
                const at = place(cloneGenome(this.champion.genome), this.champion.idx, false);
                if (at >= 0) this.champion.idx = at;
            }
        }
        const sources = [];
        if (this.champion) sources.push(this.champion.genome);
        for (const e of this.eliteRoster) sources.push(e.genome);
        if (!sources.length && order.length) sources.push(this.genomes[order[0]]);
        const nVar = Math.round(n * this.s.eliteMutants);
        for (let i = 0; i < nVar && sources.length; i++) {
            const gv = cloneGenome(sources[i % sources.length]);
            mutateGenomeK(gv, Math.max(1, Math.round(K * 0.4)), this.s.eliteSigma, 0.001, rng);
            if (put(gv) < 0) break;
        }
        const nImm = Math.round(n * this.s.immigrantFrac);
        for (let i = 0; i < nImm; i++) {
            put(this.s.bootstrapPriors && i % 2 === 0 ? createBootstrapGenome(rng) : randomGenome(rng));
        }
        let remaining = 0;
        for (let i = 0; i < n; i++) if (next[i] === null) remaining++;
        const nCross = Math.round(remaining * 0.72);
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

    // --- persistence --------------------------------------------------------
    toJSON() {
        const top = [];
        for (let i = 0; i < Math.min(6, this.lastRank.length); i++) {
            const g = this.genomes[this.lastRank[i]];
            if (g) top.push(Array.from(g));
        }
        return {
            version: NN_VERSION, arch: NN_ARCH_ID,
            gen: this.gen, tier: this.tier, runSeed: this.runSeed,
            stagnation: this.stagnation,
            champion: this.champion
                ? serializeGenome(this.champion.genome, {
                    fitness: this.champion.fitness, gen: this.champion.gen,
                    idx: this.champion.idx, tier: this.champion.tier, metrics: this.champion.metrics
                })
                : null,
            roster: this.eliteRoster.map(e => ({ g: Array.from(e.genome), fitness: e.fitness, age: e.age, gen: e.gen, idx: e.idx })),
            top,
            history: this.history.slice(-600),
            settings: this.s
        };
    }

    static fromJSON(obj, runSeed) {
        if (!obj || obj.version !== NN_VERSION || obj.arch !== NN_ARCH_ID) return null;
        const ev = new Evolution(obj.settings || {}, obj.runSeed !== undefined ? obj.runSeed : runSeed);
        ev.gen = obj.gen || 1;
        ev.tier = obj.tier || 0;
        ev.stagnation = obj.stagnation || 0;
        ev.history = Array.isArray(obj.history) ? obj.history : [];
        if (obj.champion) {
            const c = deserializeGenome(obj.champion);
            if (c) {
                ev.champion = {
                    genome: c.genome, fitness: (c.meta && c.meta.fitness) || 0,
                    gen: (c.meta && c.meta.gen) || 1, idx: (c.meta && c.meta.idx) | 0,
                    tier: (c.meta && c.meta.tier) | 0, metrics: (c.meta && c.meta.metrics) || null
                };
            }
        }
        if (Array.isArray(obj.roster)) {
            for (const r of obj.roster) {
                if (!r || !Array.isArray(r.g) || r.g.length !== NN_GENOME_LEN) continue;
                ev.eliteRoster.push({
                    genome: repairGenome(Float64Array.from(r.g)),
                    fitness: Number.isFinite(r.fitness) ? r.fitness : null,
                    age: r.age | 0, gen: r.gen | 0, idx: Number.isInteger(r.idx) ? r.idx : undefined
                });
            }
        }
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
        ev.startGeneration();
        return ev;
    }
}

// A standalone evaluation of one controller on one city + seed, used by the
// watch tab, the probes and the headless benchmark.
function evaluateController(city, controller, seed, opts) {
    const w = new World(city, opts);
    w.reset(seed, controller);
    const m = w.run();
    return { metrics: m, score: episodeScore(m), world: w };
}

if (typeof module !== 'undefined') {
    module.exports = { GA_DEFAULTS, FIT, episodeScore, Evolution, evaluateController };
}
