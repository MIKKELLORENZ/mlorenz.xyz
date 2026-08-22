/* evolution.js — the search.
 *
 * COMMON RANDOM NUMBERS. Every individual in a generation flies the SAME list of
 * scenarios: same starting states, same wind, same engine failure at the same
 * second. This is the single highest-value decision in the whole trainer and it
 * is worth being precise about why. Episode scores here range over about three
 * units and the difference between a good brain and a mediocre one is often a
 * tenth of that; scenario difficulty ranges over the whole three. Draw fresh
 * scenarios per individual and the ranking is mostly a ranking of who got the
 * calm day. Paired on identical scenarios, the comparison is between policies
 * rather than between weather reports, and the same population size buys several
 * times as much selection pressure.
 *
 * FITNESS IS AN ADVANTAGE, not a raw score. Each generation's scenarios are also
 * flown once by the scripted autopilot — once, not once per individual, because
 * it is deterministic — and what gets ranked is the difference. A 12 km
 * supersonic descent in a jet stream and a 400 m settle onto the rails do not
 * produce comparable numbers, so a raw average over a mixed diet mostly measures
 * which stages came up. Against a per-scenario baseline they contribute equally,
 * and a brain cannot climb the ladder by getting good at the cheap stage.
 *
 * THE AGGREGATE IS 70% MEAN, 30% WORST. A policy that catches beautifully nine
 * times out of ten and puts the tenth booster through the tower is not a good
 * policy, and a plain mean says it is.
 *
 * THE CURRICULUM RUNS BOTH VEHICLES FROM GENERATION ONE. It would be easier to
 * evolve a booster first and then teach it the Ship, and the result would be a
 * genome that unlearns the booster while it learns the flop — the usual
 * catastrophic forgetting, and there is no gradient here to gently re-balance
 * it. So the diet always contains at least one stage of each, and stages are
 * unlocked in pairs as the exam allows.
 *
 * THE CHAMPION IS OWNED BY THE TRAINER, NOT BY THIS FILE. Ranking here is on
 * training fitness, which is measured on scenarios the population has just been
 * selected against; crowning on that number is how a run reports a champion that
 * is really just the individual that got lucky on this generation's draw.
 * train.js re-flies candidates on a fixed held-out bank and only that decides.
 */
"use strict";

const NN = require("./nn.js");
const SC = require("./scenarios.js");
const WM = require("./world.js");
const AP = require("./autopilot.js");

const DEFAULTS = {
    pop: 256,
    elite: 6,
    tournament: 5,
    crossoverRate: 0.65,
    mutRate: 0.11,
    mutSigma: 0.30,
    episodes: 10,
    /* Stratify the diet so each stage gets its exact share every generation
     * instead of a multinomial draw. Off by default: the old path stays
     * bit-identical for anything resuming or reproducing an earlier run. */
    stratify: false,
    /* false keeps the Ship out of the curriculum entirely — see stageMix. */
    ship: true,
    worstWeight: 0.25,
    bankHold: 10,
    advantage: true,
    arch: "std",
    act: "tanh",
    immigrantRate: 0.02,          // legacy; the remainder of the recipe now decides
    /* The breeding recipe. See breed(). Shares are of the whole population;
     * whatever is not allocated becomes immigrants. */
    eliteFrac: 0.015,             // a  1.5% carried over exactly
    fMutElite: 0.30,              // b  mutations of an elite
    fXElite: 0.15,                // c  crossover of two unmutated elites
    fXMutElite: 0.15,             // d  crossover of two mutated elites
    fXEliteSub: 0.10,             // e  elite x sub-optimal
    fXSubSub: 0.10,               // f  sub-optimal x sub-optimal
    variedMutation: true,
    mutSpread: 0.9,
    sparseRate: 0.25,
    sparseMaxGenes: 256
};

/* Weights for the stage mix, given the set of unlocked stages. The newest pair
 * gets the most attention, but nothing that has been unlocked ever drops out —
 * a population that stops seeing stage 0 forgets how to finish a descent, and
 * then nothing on stage 3 works either because stage 3 ENDS in stage 0. */
function stageMix(unlockedBooster, unlockedShip) {
    const mix = new Array(SC.N_STAGES).fill(0);
    const boosterStages = [0, 1, 2, 3], shipStages = [4, 5, 6];
    for (let i = 0; i <= unlockedBooster; i++) {
        mix[boosterStages[i]] = (i === unlockedBooster) ? 3.0 : 1.0;
    }
    /* A NEGATIVE unlockedShip MEANS "NO SHIP AT ALL", not "the first ship
     * stage". The loop below is inclusive, so 0 already puts stage 4 — the
     * flip — into the diet at weight 1.2 from the first generation, which is
     * 29% of every generation spent on a different vehicle with a different
     * problem. That is the right default when the goal is both vehicles, and
     * the wrong one while the booster alone is unsolved: the exam, the library
     * and the whole ladder are currently booster-only, so those episodes buy
     * nothing that is being measured. -1 is the way to say so. */
    if (unlockedShip < 0) return mix;
    /* The Ship is weighted lighter than the booster while both are still on
     * their first rung. Its opening problem — falling flat on its back and
     * rotating ninety degrees in the last kilometre — is strictly harder than
     * the booster's, and an even split spends half the population's episodes on
     * the exercise least likely to produce a gradient early on. It catches up
     * as the curriculum advances. */
    const shipW = unlockedShip === 0 ? 1.2 : 2.4;
    for (let i = 0; i <= unlockedShip; i++) {
        mix[shipStages[i]] = (i === unlockedShip) ? shipW : 0.8;
    }
    return mix;
}

class Evolution {
    constructor(opts) {
        this.o = Object.assign({}, DEFAULTS, opts || {});
        this.rng = NN.mulberry32(this.o.seed || 12345);
        this.spec = NN.netSpec(require("./sensors.js").N_INPUT, this.o.arch);
        this.gen = 0;
        this.unlockedBooster = 0;
        this.unlockedShip = this.o.ship === false ? -1 : 0;
        this.holdCount = 0;
        this.champion = null;
        this.pop = [];
        for (let i = 0; i < this.o.pop; i++) {
            this.pop.push(new NN.Brain(this.spec, NN.mulberry32((this.o.seed || 12345) * 7919 + i * 104729), { act: this.o.act }));
        }
        this.fitness = new Float64Array(this.o.pop);
        this.raw = new Float64Array(this.o.pop);
        this.history = [];
    }

    /* Seed the whole population from one brain. NOT USED BY THE SHIPPED RUN —
     * the champion in this project is evolved from random weights and nothing
     * else, because a controller warm-started from a hand-written guidance law
     * has not learned to navigate, it has learned to imitate somebody who did.
     * Kept because resuming a run from its own champion uses the same path.
     *
     * A handful of exact copies, and
     * the rest mutated away from it at a spread that grows down the population.
     *
     * Two details matter. calibrate() FIRST, because mutation is scaled by each
     * layer's measured weight spread and a layer that has been through Adam no
     * longer has the spread it was initialised with — skip it and the first
     * generation is either frozen or destroyed. And the spread is graded rather
     * than uniform, so the population spans "almost exactly the teacher" through
     * to "recognisably something else": a warm start at a single sigma is either
     * too timid to explore or wipes out the behaviour it was supposed to
     * preserve, and there is no way to know which in advance. */
    seedFrom(seedBrain, keep) {
        const rng = this.rng;
        seedBrain.calibrate();
        const n = this.pop.length;
        const nKeep = keep == null ? Math.max(2, Math.round(n * 0.02)) : keep;
        for (let i = 0; i < n; i++) {
            const b = seedBrain.clone();
            if (i >= nKeep) {
                const f = (i - nKeep) / Math.max(1, n - nKeep - 1);
                b.mutate(this.o.mutRate * (0.25 + 0.75 * f), this.o.mutSigma * (0.15 + 0.85 * f), rng);
            }
            this.pop[i] = b;
        }
        return this;
    }

    /* This generation's episode list.
     *
     * THE BANK IS HELD FOR SEVERAL GENERATIONS, and that is not a performance
     * optimisation — it is the difference between selection and a random walk.
     *
     * Common random numbers make the comparison WITHIN a generation clean:
     * everybody flies the same weather, so the ranking is about policy. But if
     * the bank is redrawn every generation then the objective itself moves
     * every generation, and an individual bred for being good at generation N's
     * twenty scenarios is immediately re-judged on twenty different ones. When
     * the spread between scenarios is larger than the spread between policies —
     * which it is here, by a factor of several — what accumulates is not skill.
     * Measured: eighty-five generations with the bank redrawn each time produced
     * no trend at all in any statistic.
     *
     * Holding it for `bankHold` generations gives selection a stationary target
     * long enough to climb, and rotating it afterwards stops the population
     * from memorising twenty particular descents. The exam, which is what
     * actually crowns champions, is never drawn from this pool at all. */
    bank() {
        /* `stageSet` pins the diet to an explicit list of stages and switches
         * the curriculum off. It exists for controlled comparisons: when the
         * question is "does this operator learn stage 0 faster", a diet that
         * can change composition underneath the experiment answers a different
         * question every time it does. */
        const mix = this.o.stageSet
            ? SC.STAGES.map((_, i) => this.o.stageSet.includes(i) ? 1 : 0)
            : stageMix(this.unlockedBooster, this.unlockedShip);
        const era = Math.floor(this.gen / Math.max(1, this.o.bankHold));
        return SC.trainingBank(mix, this.o.episodes, ((this.o.seed || 12345) ^ (era * 2654435761)) >>> 0, this.o.stratify);
    }

    /* Fly one brain over one scenario list. Used by workers and by the main
     * thread. `policy` is rebuilt per episode so no sensor history leaks
     * between them — a brain whose observation window still contains the last
     * episode's touchdown is not being evaluated on this one. */
    static evaluate(brain, specs, opts) {
        opts = opts || {};
        // opts.lags lets a caller fly a genome whose observation layout differs
        // from this process's default — the publisher ranks 139- and 209-input
        // champions side by side in one pass.
        const pol = new NN.BrainPolicy(brain, { lags: opts.lags });
        const scores = [], outcomes = [];
        /* The whole phase ladder comes back alongside the canonical total, five
         * numbers per episode, flat. The trainer selects on ONE rung and reports
         * all of them: a fleet that is climbing rung 2 while rung 1 collapses is
         * trading a skill away, and that is only visible if both are carried. */
        const phases = new Float64Array(specs.length * 5);
        for (let i = 0; i < specs.length; i++) {
            const s = specs[i];
            const sc = SC.makeScenario(s.stage, s.seed);
            const world = new WM.World(sc);
            pol.reset();
            const r = world.runEpisode((w, out) => pol.act(w, out));
            scores.push(r.total);
            outcomes.push(r.outcome);
            for (let k = 0; k < 5; k++) phases[i * 5 + k] = r.phases[k];
        }
        return { scores, outcomes, phases };
    }

    /* The baseline: what this scenario is worth to a vehicle that does NOTHING.
     * Engines cold, fins centred, no control of any kind.
     *
     * Its only job is difficulty normalisation. A 12 km supersonic return in a
     * jet stream and a 400 m settle onto the rails do not produce comparable
     * numbers, so a raw average over a mixed diet mostly measures which stages
     * came up; against a per-scenario reference they contribute equally.
     *
     * It is deliberately the INERT policy and not the scripted autopilot. The
     * autopilot is a better difficulty estimator, and using it would put a
     * hand-written guidance law inside the training loop — not as a controller,
     * only as a constant subtracted per scenario, but inside it nonetheless.
     * Nothing that was designed by hand gets to touch the search. Inaction is a
     * policy nobody wrote.
     */
    static baseline(specs) {
        const out = [];
        const phases = new Float64Array(specs.length * 5);
        for (let i = 0; i < specs.length; i++) {
            const s = specs[i];
            const sc = SC.makeScenario(s.stage, s.seed);
            const w = new WM.World(sc);
            const r = w.runEpisode(AP.inertPolicy);
            out.push(r.total);
            for (let k = 0; k < 5; k++) phases[i * 5 + k] = r.phases[k];
        }
        out.phases = phases;
        return out;
    }

    /* Pull one rung out of the flat per-episode phase array. */
    static column(phases, n, phase) {
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = phases[i * 5 + phase];
        return out;
    }

    aggregate(scores, base) {
        const n = scores.length;
        if (!n) return { fit: 0, raw: 0 };
        let sum = 0, worst = Infinity, rawSum = 0;
        for (let i = 0; i < n; i++) {
            const a = this.o.advantage && base ? scores[i] - base[i] : scores[i];
            sum += a;
            rawSum += scores[i];
            if (a < worst) worst = a;
        }
        const mean = sum / n;
        const w = this.o.worstWeight;
        return { fit: (1 - w) * mean + w * worst, raw: rawSum / n };
    }

    /* Build the next generation. `fits` is an array of {fit, raw} in population
     * order; the caller supplies it because the evaluation is distributed. */
    /* Build the next generation from an EXPLICIT RECIPE rather than from three
     * interacting probabilities.
     *
     * The old scheme was "2% immigrants, else 10% crossover of two tournament
     * winners, else a clone — then mutate". That reads as elitist and is not:
     * measured over 200 generations, only 6.5% of children had an elite parent
     * and the median parent sat at rank 59 of 448. The elites survived, but
     * they barely bred. Naming the categories makes the actual breeding
     * structure visible and tunable:
     *
     *   a  eliteFrac      top 1-2%, carried over EXACTLY
     *   b  fMutElite      mutations of an elite (random gene count, random
     *                     strength — see mutateVaried)
     *   c  fXElite        crossover of two UNMUTATED elites
     *   d  fXMutElite     crossover of two elites that were mutated first
     *   e  fXEliteSub     crossover of an elite with a sub-optimal individual
     *   f  fXSubSub       crossover of two sub-optimal individuals
     *      remainder      fresh random immigrants
     *
     * Categories c-f are recombination only: the parents carry the mutation
     * (or not, which is the whole distinction between c and d) and the child is
     * not perturbed again afterwards. Novel material comes from b, from d, and
     * from the immigrants.
     *
     * `explore` in [0,1] is the stall response, set by the trainer. At 0 the
     * recipe is exactly as configured. As it rises, immigrants and elite
     * mutation take share from the pure-elite recombination (c), and the
     * mutation spread widens — because a population that has stopped improving
     * is one whose recombinations are all of the same genome, and shuffling
     * copies of a consensus produces nothing.
     */
    breed(fits) {
        const o = this.o, rng = this.rng, P = o.pop;
        for (let i = 0; i < this.pop.length; i++) {
            this.fitness[i] = fits[i].fit;
            this.raw[i] = fits[i].raw;
        }
        const order = Array.from(this.pop.keys()).sort((a, b) => this.fitness[b] - this.fitness[a]);

        const x = Math.max(0, Math.min(1, this.explore || 0));
        const nElite = Math.max(2, Math.round(P * o.eliteFrac));
        const eliteIdx = order.slice(0, nElite);
        const subIdx = order.slice(nElite);

        /* Shares, shifted by the stall response. Whatever is not allocated
         * becomes immigrants, so the recipe can never over- or under-fill. */
        const share = {
            mutElite: o.fMutElite + 0.10 * x,
            xElite: Math.max(0, o.fXElite - 0.10 * x),
            xMutElite: o.fXMutElite,
            xEliteSub: o.fXEliteSub,
            xSubSub: o.fXSubSub
        };

        const comp = { elite: 0, champion: 0, mutElite: 0, xElite: 0, xMutElite: 0, xEliteSub: 0, xSubSub: 0, immigrant: 0 };
        const next = [];
        for (const i of eliteIdx) { next.push(this.pop[i].clone()); comp.elite++; }

        /* THE BEST BRAIN EVER MEASURED IS RE-INSERTED UNMUTATED, EVERY
         * GENERATION. Elitism only preserves the best of the CURRENT
         * population, which is ranked on this era's training bank — so when the
         * bank rotates the champion can be ranked below the elites that happen
         * to suit the new weather and be gone by the next generation. */
        if (this.champion) { next.push(this.champion.clone()); comp.champion++; }

        const anyElite = () => this.pop[eliteIdx[Math.floor(rng() * eliteIdx.length)]];
        /* Sub-optimal parents are still chosen by tournament, among the
         * non-elites only. "Sub-optimal" is a category, not an excuse to breed
         * uniformly at random from the tail. */
        const anySub = () => {
            if (!subIdx.length) return anyElite();
            let best = -1, bestF = -Infinity;
            for (let t = 0; t < o.tournament; t++) {
                const i = subIdx[Math.floor(rng() * subIdx.length)];
                if (this.fitness[i] > bestF) { bestF = this.fitness[i]; best = i; }
            }
            return this.pop[best];
        };
        const mutated = (b) => {
            const c = b.clone();
            const spread = o.mutSpread * (1 + 0.6 * x);
            if (o.variedMutation) c.mutateVaried(o.mutRate, o.mutSigma, rng,
                { spread, sparse: o.sparseRate, maxGenes: o.sparseMaxGenes });
            else c.mutate(o.mutRate, o.mutSigma, rng);
            return c;
        };

        const room = () => next.length < P;
        const take = (n, make, key) => {
            for (let k = 0; k < n && room(); k++) { next.push(make()); comp[key]++; }
        };

        take(Math.round(P * share.mutElite), () => mutated(anyElite()), "mutElite");
        take(Math.round(P * share.xElite), () => NN.Brain.crossover(anyElite(), anyElite(), rng), "xElite");
        take(Math.round(P * share.xMutElite), () => NN.Brain.crossover(mutated(anyElite()), mutated(anyElite()), rng), "xMutElite");
        take(Math.round(P * share.xEliteSub), () => NN.Brain.crossover(anyElite(), anySub(), rng), "xEliteSub");
        take(Math.round(P * share.xSubSub), () => NN.Brain.crossover(anySub(), anySub(), rng), "xSubSub");

        /* Everything left over is a fresh random genome. Immigrants almost never
         * win; what they do is keep crossover supplied with material that is not
         * already in the consensus. */
        while (next.length < P) {
            next.push(new NN.Brain(this.spec, NN.mulberry32((rng() * 4294967296) >>> 0), { act: o.act }));
            comp.immigrant++;
        }

        next.length = P;
        this.composition = comp;
        this.pop = next;
        this.gen++;
        return order;
    }

    /* Curriculum. Driven by the EXAM, never by training fitness — training
     * fitness rises whenever the population overfits this generation's ten
     * scenarios, and unlocking a harder stage on that signal advances the
     * curriculum on noise. */
    maybeUnlock(examMean, threshold) {
        if (this.o.stageSet) return false;   // the diet is pinned; nothing to unlock
        if (examMean >= threshold) this.holdCount++;
        else this.holdCount = 0;
        if (this.holdCount >= 3) {
            let changed = false;
            if (this.unlockedBooster < 3) { this.unlockedBooster++; changed = true; }
            // -1 means the ship is switched off for this run; leave it there.
            if (this.unlockedShip >= 0 && this.unlockedShip < 2) { this.unlockedShip++; changed = true; }
            this.holdCount = 0;
            return changed;
        }
        return false;
    }

    toJSON(extra) {
        return Object.assign({
            format: "rocket-eve-v1",
            gen: this.gen,
            opts: this.o,
            unlockedBooster: this.unlockedBooster,
            unlockedShip: this.unlockedShip,
            holdCount: this.holdCount,
            population: this.pop.map(b => b.toJSON())
        }, extra || {});
    }

    static fromJSON(o) {
        const e = new Evolution(o.opts);
        e.gen = o.gen;
        e.unlockedBooster = o.unlockedBooster || 0;
        e.unlockedShip = o.unlockedShip || 0;
        e.holdCount = o.holdCount || 0;
        e.pop = o.population.map(p => NN.Brain.fromJSON(p).calibrate());
        e.fitness = new Float64Array(e.pop.length);
        e.raw = new Float64Array(e.pop.length);
        return e;
    }
}

module.exports = { Evolution, stageMix, DEFAULTS };
