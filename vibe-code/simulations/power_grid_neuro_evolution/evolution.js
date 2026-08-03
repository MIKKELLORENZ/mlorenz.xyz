// Neuroevolution engine.
//
// One genome = one control-room operator = every substation of one network. A
// generation runs the whole population over the same network and the same
// twenty-four hours of weather, then runs three classical controllers over
// exactly the same thing, so the chart on screen answers "is this any good"
// rather than "is this better than it was".
//
// Four things borrowed because each was the single biggest win in an earlier
// sim on this site:
//   * COMMON RANDOM NUMBERS - identical network, identical weather, identical
//     outage schedule for every genome in a generation. Without it a two-episode
//     fitness measures the day more than the operator (chess).
//   * A VALIDATED CHAMPION - the challenger has to beat the sitting champion on
//     EVERY episode, not just post a better average (chess, 3D walk).
//   * WORST-EPISODE WEIGHTING - an operator that only handles the calm day is
//     graded by its bad one (boats).
//   * A LADDER WITH NO GAPS - a tier the population cannot reach traps the whole
//     run, so a tier also unlocks on patience (chess, tokamak).
//
// And one that is specific to this problem and turned out to matter more than
// all four put together: AUDITIONING THE DAY. See _chooseDays.
'use strict';

const GA_DEFAULTS = {
    population: 32,
    elites: 2,
    episodesPerGen: 3,
    probeDays: 9,          // candidate days auditioned per generation
    minHeadroom: 6000,     // EUR of avoidable loss below which a day teaches nothing
    episodeScale: 1.0,     // multiplier on the tier's step count
    mutChance: 0.65,
    mutGenes: 60,
    sigma: 0.24,
    immigrantFrac: 0.06,
    eliteMutants: 0.22,
    eliteSigma: 0.16,
    pressure: 2.0,
    eliteGrace: 8,
    stagnationAdapt: true,
    bootstrapPriors: true,
    netsPerTier: 3,        // layouts rotated inside a tier, so nothing is memorised
    advanceRatio: 0.97,    // median must reach this multiple of the best classical
    advanceWindow: 10,
    tierPatience: 140,
    tier: 0,
    lockTier: false,
    n1Weight: 0            // N-1 insecurity is reported, not paid for
};

// Fitness is the world's own number: the operating margin of the control room
// in euros over the episode. There is no separate fitness function to get wrong,
// and nothing that appears on the panel as a "constraint violation" is inside
// it - the overload risk charge from the brief is, deliberately and visibly, the
// only security-flavoured term.
function episodeScore(m) {
    return Number.isFinite(m.score) ? m.score : -1e12;
}

const BASELINES = ['donothing', 'redispatch', 'expert'];
// do-nothing is not in this list because the audition already ran it on every
// candidate day; re-running it on the survivors would be the same episode twice.
const AUDITED = ['redispatch', 'expert'];

class Evolution {
    constructor(settings, runSeed) {
        this.s = Object.assign({}, GA_DEFAULTS, settings || {});
        this.runSeed = (runSeed === undefined ? 20260801 : runSeed) >>> 0;
        this.gen = 1;
        this.tier = this.s.tier | 0;
        this.tierAge = 0;
        this.stagnation = 0;
        this.champion = null;
        this.eliteRoster = [];
        this.history = [];
        this.advanceWindow = [];
        this.headroomWindow = [];
        this.bestHeadroom = 0;
        this.dayHeadroom = 0;
        this.flatCandidates = 0;
        this.events = [];
        this.genomes = [];
        this.netCache = new Map();
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

    // --- networks -----------------------------------------------------------
    netFor(tier, slot) {
        const key = tier * 97 + slot;
        let n = this.netCache.get(key);
        if (!n) {
            n = makeNetwork(tier, mixSeed(this.runSeed, 0x671D, tier * 31 + slot));
            this.netCache.set(key, n);
        }
        return n;
    }

    worldFor(net) {
        let w = this.worldCache.get(net);
        if (!w) {
            w = new World(net, {
                steps: Math.max(24, Math.round((net.spec.steps || 144) * this.s.episodeScale)),
                n1Weight: this.s.n1Weight
            });
            this.worldCache.set(net, w);
        }
        w.opts.steps = Math.max(24, Math.round((net.spec.steps || 144) * this.s.episodeScale));
        w.opts.n1Weight = this.s.n1Weight;
        return w;
    }

    // Every genome AND every baseline in a generation sees this exact day.
    epSeed(e) { return mixSeed(this.runSeed, 0xBE7 + e * 131 + this.gen * 7919, this.tier); }

    // --- generation lifecycle ----------------------------------------------
    startGeneration() {
        const slot = this.s.netsPerTier > 0 ? (this.gen - 1) % this.s.netsPerTier : 0;
        this.net = this.netFor(this.tier, slot);
        this.world = this.worldFor(this.net);
        this.epCount = Math.max(1, this.s.episodesPerGen | 0);
        this.probeCount = Math.max(this.epCount, Math.min(16, this.s.probeDays | 0));
        this.probeSeeds = [];
        for (let i = 0; i < this.probeCount; i++) this.probeSeeds.push(this.epSeed(i));
        this.probeRuns = [];
        this.epSeeds = this.probeSeeds.slice(0, this.epCount);
        this.epScores = this.genomes.map(() => []);
        this.epMetrics = this.genomes.map(() => []);
        this.baseRuns = { donothing: [], redispatch: [], expert: [] };
        this.stage = 'probe';
        this.cursor = { ctrl: 0, gi: 0, ep: 0 };
        this._beginEpisode();
    }

    // How much a day has to teach: the part of a do-nothing control room's bill
    // that a better operator could in principle have avoided. Fuel and tariff
    // are not in it - they are the same for everybody and swamp the difference.
    //
    // Lost load is capped on purpose. The biggest number the audition ever sees
    // is a day that collapses whatever anybody does, and such a day is not
    // teachable: every genome and every baseline finishes within a rounding
    // error of minus four million and the generation discriminates nothing.
    // Uncapped it wins the audition every time it appears. What teaches is
    // SUSTAINED, SURVIVABLE stress - a corridor sitting at 115% for an hour with
    // the thermal accumulator visibly filling - so the overload integral is
    // weighted heavily and the catastrophe is allowed in but not allowed to
    // dominate.
    _headroom(m) {
        return (m.riskCost || 0) + Math.min(m.lostLoadCost || 0, 600000) +
            (m.blackoutCost || 0) +
            (m.lineTrips || 0) * 2500 + (m.overloadIntegral || 0) * 4000;
    }

    // AUDITION THE DAY.
    //
    // This is the change that separated a population which learned nothing from
    // one that learned to act, and it is worth stating plainly because the
    // symptom looked exactly like a slow GA.
    //
    // A day on this simulator is nearly always uneventful. Measured with a
    // do-nothing control room over twelve days of the STORM tier, four cost
    // nothing whatsoever - no overload, no trip, no shed load - and on the calm
    // tiers it was ten in twelve. On such a day doing nothing is genuinely
    // optimal, every genome scores the same number to the euro, and the
    // generation carries zero bits of selection: the trainer log was page after
    // page of `adv 0.00 (0k)`. Worse than useless, in fact - the only genomes
    // that differ from the pack on a flat day are the ones that DID something,
    // every action costs a balancing premium, so a flat day actively selects
    // against acting at all. Two thirds of the run was spent teaching the
    // population to sit on its hands.
    //
    // So each generation now auditions several candidate days with the cheapest
    // controller there is and keeps the ones where inaction demonstrably bleeds.
    // The audition is not overhead: do-nothing on a kept day IS the do-nothing
    // baseline, so the only wasted work is the candidates that lose.
    //
    // Note what this does NOT do. It does not touch the reward, the physics or
    // the difficulty of a day - a kept day is an ordinary day drawn from the
    // ordinary distribution. It changes only which days are worth spending
    // thirty-two genome-episodes on. The held-out benchmark still draws days at
    // random, so an operator that only knows how to handle a crisis is still
    // caught there.
    // ...and one slot always goes to the QUIETEST candidate, which is the other
    // half of the lesson and was learned the hard way. Trained on crisis days
    // alone the population came out of the first audition run redispatching
    // eleven hundred megawatt-hours on held-out days where nothing whatsoever
    // was wrong, and lost forty thousand euros a day doing it: it had correctly
    // learned that acting pays, on a diet where acting always paid. Grading
    // every genome on one quiet day as well - and the aggregate is 40% worst
    // episode - prices the churn back in. The operator has to know both that a
    // crisis is worth acting on and that a Tuesday is not.
    _chooseDays() {
        const runs = this.probeRuns.slice().sort((a, b) => b.head - a.head);
        const calm = this.epCount >= 2 ? 1 : 0;
        const keep = runs.slice(0, this.epCount - calm);
        if (calm) keep.push(runs[runs.length - 1]);
        this.epSeeds = keep.map(r => r.seed);
        this.baseRuns.donothing = keep.map(r => ({ score: r.score, m: r.m }));
        this.bestHeadroom = runs.length ? runs[0].head : 0;
        this.dayHeadroom = keep.reduce((a, r) => a + r.head, 0) / Math.max(1, keep.length);
        this.flatCandidates = runs.filter(r => r.head < this.s.minHeadroom).length;
    }

    _beginEpisode() {
        const c = this.cursor;
        if (this.stage === 'probe') {
            this.world.reset(this.probeSeeds[c.ep], makeController('donothing'));
            this.evaluating = { kind: 'baseline', name: 'donothing', ep: c.ep, audition: true };
        } else if (this.stage === 'baseline') {
            const name = AUDITED[c.ctrl];
            this.world.reset(this.epSeeds[c.ep], makeController(name));
            this.evaluating = { kind: 'baseline', name, ep: c.ep };
        } else {
            this.world.reset(this.epSeeds[c.ep], brainController(this.genomes[c.gi]));
            this.evaluating = { kind: 'genome', idx: c.gi, ep: c.ep };
        }
    }

    _endEpisode() {
        const m = this.world.finish();
        const sc = episodeScore(m);
        const c = this.cursor;
        if (this.stage === 'probe') {
            this.probeRuns.push({ seed: this.probeSeeds[c.ep], score: sc, m, head: this._headroom(m) });
            c.ep++;
            if (c.ep >= this.probeCount) {
                this._chooseDays();
                this.stage = 'baseline';
                c.ctrl = 0; c.ep = 0;
            }
        } else if (this.stage === 'baseline') {
            this.baseRuns[AUDITED[c.ctrl]].push({ score: sc, m });
            c.ep++;
            if (c.ep >= this.epCount) { c.ep = 0; c.ctrl++; }
            if (c.ctrl >= AUDITED.length) { this.stage = 'population'; c.gi = 0; c.ep = 0; }
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

    // Advance for up to `budgetMs` of wall clock (or a fixed number of dispatch
    // intervals when headless). Returns true when a generation completed.
    run(budgetMs, maxSteps) {
        const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const t0 = now();
        let steps = 0;
        // A hard step ceiling backs up the time budget, because a time budget is
        // only as good as the clock behind it. Under headless Chrome's virtual
        // time the clock advances when the renderer is idle and NOT while script
        // is running, so `now() - t0` stays at zero and a purely time-bounded
        // loop never returns - the page wedges and the screenshot never happens.
        // A browser frame does a few thousand intervals at most, so this never
        // binds in normal use.
        const cap = maxSteps || (budgetMs ? 4000 : 1);
        for (;;) {
            const alive = this.world.step();
            steps++;
            if (!alive) { if (this._endEpisode()) return true; }
            if (steps >= cap) break;
            if (budgetMs && now() - t0 >= budgetMs) break;
        }
        return false;
    }

    runGeneration() {
        for (;;) {
            const alive = this.world.step();
            if (!alive && this._endEpisode()) return this.history[this.history.length - 1];
        }
    }

    _aggregate(scores) {
        if (!scores.length) return -1e12;
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const worst = Math.min(...scores);
        return mean * 0.6 + worst * 0.4;
    }

    // The best any classical control room managed on episode e. Per episode,
    // not per generation: that is the whole point of what follows.
    _episodeBar(e) {
        let bar = -Infinity;
        for (const k of BASELINES) {
            const r = this.baseRuns[k][e];
            if (r && Number.isFinite(r.score) && r.score > bar) bar = r.score;
        }
        return Number.isFinite(bar) ? bar : 0;
    }

    // FITNESS, as distinct from the euro aggregate above.
    //
    // The euro aggregate is what goes on the chart, because euros are what the
    // control room actually earns. It is a poor thing to SELECT on, and the
    // reason is scale. A quiet day is decided by tens of thousands of euros and
    // a storm day by millions, so in a three-episode mean the storm is worth
    // roughly three hundred quiet days. Selection therefore sees storm-day
    // performance and almost nothing else - which is how a champion emerged
    // that handled a crisis genuinely well (+165k a day across fifteen eventful
    // held-out days, 2.3 points more demand served) while quietly burning four
    // hundred megawatt-hours a day of pointless redispatch on the forty-one days
    // when nothing was wrong. That churn cost 16k a day, every day, and was
    // never once selected against because 16k is three percent of one storm.
    //
    // So each episode's advantage over its OWN baselines is compressed through a
    // symmetric log before the episodes are combined. Small differences stay
    // linear, so the quiet day keeps its full weight; large ones grow
    // logarithmically, so a single freak day - and there was one, worth 4.7
    // million, which on a three-day mean is louder than everything else put
    // together - can still win the generation without being able to buy it
    // outright. This is the standard answer to selecting on a heavy-tailed
    // objective from a three-sample estimate: accept a little bias to remove a
    // great deal of variance.
    //
    // Note what is NOT compressed: the reported benchmark, the chart, and every
    // number quoted about this operator are raw euros. This shapes what
    // evolution optimises for, not what gets claimed for it.
    _fitness(scores) {
        if (!scores || !scores.length) return -1e9;
        const SOFT = 60000;
        const c = scores.map((s, e) => {
            const a = s - this._episodeBar(e);
            return Math.sign(a) * Math.log1p(Math.abs(a) / SOFT);
        });
        const mean = c.reduce((a, b) => a + b, 0) / c.length;
        return mean * 0.6 + Math.min(...c) * 0.4;
    }

    _finishGeneration() {
        const n = this.genomes.length;
        const agg = new Array(n);
        const fit = new Array(n);
        for (let i = 0; i < n; i++) {
            agg[i] = this._aggregate(this.epScores[i]);   // euros, for the chart
            fit[i] = this._fitness(this.epScores[i]);     // what selection sees
        }
        const order = fit.map((_, i) => i).sort((a, b) => fit[b] - fit[a]);
        this.lastRank = order;
        this.lastAgg = agg;
        this.lastFit = fit;
        this.lastMetrics = this.epMetrics;

        const sorted = agg.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(n / 2)];
        const best = agg[order[0]];
        const mean = agg.reduce((a, b) => a + b, 0) / n;

        const baseAgg = {};
        for (const k of BASELINES) baseAgg[k] = this._aggregate(this.baseRuns[k].map(r => r.score));
        this.baseline = { agg: baseAgg, runs: this.baseRuns };
        this.baseMetrics = {};
        for (const k of BASELINES) this.baseMetrics[k] = meanMetrics(this.baseRuns[k].map(r => r.m));

        // ADVANTAGE, not euros, is what carries across generations.
        //
        // Every generation draws a different day, and the days are not remotely
        // comparable: a calm Tuesday is worth +100k and a storm that takes a
        // corridor out at the evening peak is worth -1.7M, for the same
        // controller. Comparing this generation's best raw score against a
        // champion crowned on a different day compares the weather, and the
        // champion then freezes on whichever day happened to be mildest - the
        // 3D-walk sim lost a week to exactly this.
        //
        // So the champion, the elite roster and the curriculum all work in
        // advantage over the best classical control room ON THE SAME DAY, which
        // is a number that means the same thing every generation. Ranking inside
        // a generation is unaffected: subtracting a constant does not reorder
        // anything.
        this.bar = Math.max(baseAgg.donothing, baseAgg.redispatch, baseAgg.expert);
        // ...and NORMALISED advantage is what the champion is judged on, because
        // raw advantage in euros is still not comparable between days.
        //
        // On a storm day where every classical control room loses the grid and
        // scores -2M, a genome that merely survives to -1.5M banks +500 000 of
        // advantage. On a calm day a genuinely better operator banks five
        // thousand. Judged in euros the storm-day genome is a hundred times the
        // champion forever - and it was: the first champion this engine crowned
        // had learned to thrash the topology, won one catastrophic day by
        // accident, and then blacked out every held-out six-bus episode while no
        // later genome could displace it.
        //
        // Dividing by the day's own scale makes "survived a disaster nobody else
        // did" worth about 0.25 and "ran a calm day five thousand euros better"
        // worth about 0.05 - both real, neither able to buy immortality.
        //
        // That per-GENERATION normalisation is still computed here for the chart,
        // but the champion is now judged on _fitness, which does the same job per
        // EPISODE. The generation-level version cannot see inside a generation:
        // it divides one aggregate by one scale, so a genome that wins the storm
        // and loses the quiet day still looks exactly like a genome that won
        // both. That blind spot cost four hundred megawatt-hours a day of
        // needless redispatch - see _fitness.
        this.advScale = Math.max(60000, Math.abs(this.bar));
        const adv = fit.map(v => clamp(v, -4, 4));
        this.lastAdv = adv;
        this.lastAdvEur = agg.map(v => v - this.bar);

        const bm = meanMetrics(this.epMetrics[order[0]]);
        this.history.push({
            gen: this.gen, tier: this.tier,
            best, mean, median, adv: this.lastAdvEur[order[0]], advN: adv[order[0]],
            medAdv: median - this.bar,
            donothing: baseAgg.donothing, redispatch: baseAgg.redispatch, expert: baseAgg.expert,
            served: bm.servedFrac, blackout: bm.blackout,
            overload: bm.overloadFrac, n1: bm.n1SecureFrac,
            maxLoad: bm.maxLoading, redisp: bm.redispatchMWh,
            curtail: bm.curtailedMWh, trips: bm.lineTrips,
            switches: bm.switchActions + bm.subActions,
            head: this.dayHeadroom, headBest: this.bestHeadroom, flat: this.flatCandidates,
            expN1: this.baseMetrics.expert ? this.baseMetrics.expert.n1SecureFrac : 0,
            expOver: this.baseMetrics.expert ? this.baseMetrics.expert.overloadFrac : 0
        });
        if (this.history.length > 600) this.history.shift();

        // Champion: a decayed record plus head-to-head validation on every
        // episode. Without the head-to-head an unlucky day for the incumbent
        // hands the crown to a genome that is simply worse.
        const bestAdv = adv[order[0]];
        if (this.champion && Number.isFinite(this.champion.adv)) this.champion.adv -= 0.02;
        let champBeaten = true;
        if (this.champion && !identical(this.genomes[order[0]], this.champion.genome)) {
            let ci = -1;
            for (let i = 0; i < n; i++) if (identical(this.genomes[i], this.champion.genome)) { ci = i; break; }
            if (ci >= 0) champBeaten = this._beatsAllEpisodes(order[0], ci);
        }
        if (!this.champion || (champBeaten && bestAdv > this.champion.adv + 1e-6)) {
            const isNew = !this.champion || bestAdv > this.champion.adv;
            this.champion = {
                genome: cloneGenome(this.genomes[order[0]]), fitness: best, adv: bestAdv,
                advEur: this.lastAdvEur[order[0]],
                gen: this.gen, idx: order[0], tier: this.tier, metrics: bm
            };
            this.stagnation = 0;
            if (isNew) this.events.push({ type: 'champion', gen: this.gen, adv: bestAdv });
        } else {
            this.stagnation++;
        }

        // Curriculum. The bar is the better of the two controllers a real
        // control room would actually be running, held by the population MEDIAN
        // for three consecutive generations rather than by one lucky genome.
        this.tierAge++;
        // Held in advantage terms: the population median has to come within a
        // whisker of the best classical control room ON THE SAME DAY.
        //
        // The window is deliberately long. On a calm network doing nothing is
        // optimal, so a population that has learned nothing at all ties the
        // baselines exactly and passes this test every generation - with a short
        // window every island climbed the whole ladder in twenty generations and
        // then sat on the hardest network being half a million euros worse than
        // the control room it was standing in for. Ten consecutive generations
        // at least means it has held the tie across ten different days, several
        // network layouts and at least one storm.
        const slack = Math.max(2000, Math.abs(this.bar) * (1 - this.s.advanceRatio));
        this.advanceWindow.push(median - this.bar >= -slack ? 1 : 0);
        if (this.advanceWindow.length > this.s.advanceWindow) this.advanceWindow.shift();
        const earned = this.advanceWindow.length === this.s.advanceWindow &&
            this.advanceWindow.every(v => v === 1);

        // A BARREN TIER IS A WASTED TIER. If the audition cannot find a single
        // day on this network where doing nothing costs anything - which is the
        // literal truth of the two calm tiers, twelve days out of twelve - then
        // there is nothing here to learn and no amount of patience will change
        // that. Move up. Without this the run spends its first twenty
        // generations proving that a quiet Tuesday is quiet.
        this.headroomWindow.push(this.bestHeadroom >= this.s.minHeadroom ? 1 : 0);
        if (this.headroomWindow.length > this.s.advanceWindow) this.headroomWindow.shift();
        const barren = this.headroomWindow.length >= Math.min(4, this.s.advanceWindow) &&
            this.headroomWindow.every(v => v === 0);

        // A barren TOP tier is the same problem pointing the other way, and it
        // is not hypothetical: with every island parked on the thirty-bus
        // network the audition started returning "flat 7" — all seven candidate
        // days uneventful — and the run was back to spending its whole budget on
        // days where every genome scores the same number. The ladder could climb
        // away from the signal and had no way back. So when the top rung goes
        // barren the population steps DOWN a rung, to a network that still has
        // something to teach. The ladder moves toward signal, in whichever
        // direction that happens to be.
        const wantDown = barren && this.tier >= GRID_TIERS.length - 1 && this.tier > 0;

        if (!this.s.lockTier && wantDown) {
            this.tierAge = 0;
            this.tier--;
            this.advanceWindow.length = 0;
            this.headroomWindow.length = 0;
            this.stagnation = 0;
            if (this.champion) { this.champion.fitness = -Infinity; this.champion.adv = -Infinity; }
            for (const e of this.eliteRoster) { e.fitness = null; e.age = 0; }
            this.events.push({ type: 'tier', tier: this.tier, name: GRID_TIERS[this.tier].name, down: true });
        } else if (!this.s.lockTier && this.tier < GRID_TIERS.length - 1 &&
            (earned || barren || this.tierAge >= this.s.tierPatience)) {
            this.tierAge = 0;
            this.tier++;
            this.advanceWindow.length = 0;
            this.headroomWindow.length = 0;
            this.stagnation = 0;
            // Euros on one network mean nothing on another, so records reset.
            if (this.champion) { this.champion.fitness = -Infinity; this.champion.adv = -Infinity; }
            for (const e of this.eliteRoster) { e.fitness = null; e.age = 0; }
            this.events.push({ type: 'tier', tier: this.tier, name: GRID_TIERS[this.tier].name });
        }

        this.diversity = this._estimateDiversity();
        this._updateEliteRoster(order, fit);
        this.genomes = this._buildNextGeneration(order, agg);
        this.gen++;
        this.startGeneration();
    }

    _beatsAllEpisodes(chIdx, incIdx) {
        const a = this.epScores[chIdx], b = this.epScores[incIdx];
        if (!a || !b || !a.length || !b.length) return true;
        const n = Math.min(a.length, b.length);
        for (let e = 0; e < n; e++) if (a[e] <= b[e]) return false;
        return true;
    }

    _updateEliteRoster(order, fit) {
        const GRACE = Math.max(0, this.s.eliteGrace | 0);
        const topK = Math.min(this.s.elites, order.length);
        for (const e of this.eliteRoster) {
            e.age++;
            e._judgedIdx = -1;
            if (e.fitness !== null) e.fitness -= 0.02;
            for (let i = 0; i < this.genomes.length; i++) {
                if (identical(this.genomes[i], e.genome)) {
                    const a2 = clamp(fit[i], -4, 4);
                    if (e.fitness === null || a2 > e.fitness) e.fitness = a2;
                    for (let k = 0; k < topK; k++) if (order[k] === i) e.age = 0;
                    e.idx = i; e._judgedIdx = i;
                    break;
                }
            }
        }
        const newcomers = [];
        for (let k = 0; k < topK; k++) {
            const gi = order[k];
            if (this.eliteRoster.some(e => identical(e.genome, this.genomes[gi]))) continue;
            newcomers.push({
                genome: cloneGenome(this.genomes[gi]),
                fitness: clamp(fit[gi], -4, 4),
                age: 0, gen: this.gen, idx: gi
            });
        }
        let old = this.eliteRoster.filter(e => {
            if (e.age >= GRACE) return false;
            if (e.fitness !== null && newcomers.some(nc => nc.fitness > e.fitness + 0.05 &&
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

    _buildNextGeneration(order) {
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
            for (const g of next) if (g && identical(g, this.champion.genome)) { present = true; break; }
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
            stagnation: this.stagnation, tierAge: this.tierAge,
            champion: this.champion ? serializeGenome(this.champion.genome, {
                fitness: this.champion.fitness, adv: this.champion.adv,
                advEur: this.champion.advEur, gen: this.champion.gen,
                idx: this.champion.idx, tier: this.champion.tier, metrics: this.champion.metrics
            }) : null,
            roster: this.eliteRoster.map(e => ({
                g: Array.from(e.genome), fitness: e.fitness, age: e.age, gen: e.gen, idx: e.idx
            })),
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
        ev.tierAge = obj.tierAge || 0;
        ev.stagnation = obj.stagnation || 0;
        ev.history = Array.isArray(obj.history) ? obj.history : [];
        if (obj.champion) {
            const c = deserializeGenome(obj.champion);
            if (c) {
                ev.champion = {
                    genome: c.genome, fitness: (c.meta && c.meta.fitness) || 0,
                    adv: (c.meta && Number.isFinite(c.meta.adv)) ? c.meta.adv : -Infinity,
                    advEur: (c.meta && Number.isFinite(c.meta.advEur)) ? c.meta.advEur : 0,
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

function identical(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

const METRIC_KEYS = [
    'servedMWh', 'unservedMWh', 'demandMWh', 'servedFrac',
    'fuelCost', 'premiumCost', 'curtailCost', 'riskCost', 'revenue', 'switchCost',
    'lostLoadCost', 'blackoutCost', 'redispatchMWh', 'curtailedMWh', 'lossesMWh',
    'overloadSteps', 'overloadIntegral', 'maxLoading', 'overloadFrac',
    'vViolSteps', 'vMin', 'vMax',
    'n1InsecureSteps', 'n1Worst', 'n1MeanWorst', 'n1SecureFrac',
    'lineTrips', 'switchActions', 'subActions', 'reconnects',
    'solverFallbacks', 'solverFailures', 'emergencyShed', 'steps', 'blackout', 'score'
];

function meanMetrics(list) {
    const out = {};
    for (const k of METRIC_KEYS) out[k] = 0;
    if (!list || !list.length) return out;
    for (const m of list) for (const k of METRIC_KEYS) out[k] += (m[k] || 0);
    for (const k of METRIC_KEYS) out[k] /= list.length;
    return out;
}

// A standalone evaluation of one controller on one network and seed, used by the
// watch tab, the probes and the headless benchmark.
function evaluateController(net, controller, seed, opts) {
    const w = new World(net, opts);
    w.reset(seed, controller);
    const m = w.run();
    return { metrics: m, score: episodeScore(m), world: w };
}

if (typeof module !== 'undefined') {
    module.exports = {
        GA_DEFAULTS, BASELINES, METRIC_KEYS, episodeScore, meanMetrics,
        Evolution, evaluateController, identical
    };
}
