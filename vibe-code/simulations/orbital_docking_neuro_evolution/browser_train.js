/* browser_train.js — evolution running in the page, in slices.
 *
 * THIS IS A DEMONSTRATION, NOT THE METHOD, and the UI says so. The champion in
 * the box is produced by train.js on many cores over many hours; a single
 * browser thread at a population of twenty-four is three orders of magnitude
 * short of that. What it is good for is watching the machinery work — the bank
 * being auditioned, the race cutting the field in half between scenarios, the
 * advantage numbers moving — which is hard to get a feel for from a log file.
 *
 * IT RUNS IN SLICES, one episode at a time, inside a time budget the caller
 * sets each frame. A generation here is a few hundred episodes and each is a
 * few million floating-point operations; done in one go it would freeze the tab
 * for several seconds per generation and the browser would offer to kill the
 * page. The state machine below can be suspended between any two episodes.
 *
 * It deliberately uses the SAME Evolution, World, scenario bank and audition as
 * the headless trainer — nothing here is a simplified re-implementation, which
 * is the only way a demonstration is worth anything.
 */
"use strict";

class BrowserTrainer {
    constructor(opts) {
        opts = opts || {};
        this.pop = opts.pop || 24;
        this.bankSize = opts.bank || 2;
        this.stage = opts.stage || 0;
        this.race = opts.race !== false;
        this.mutRate = 0.12;
        this.mutSigma = 0.55;

        this.evo = new Evolution(this.pop, (Math.random() * 1e9) | 0, NIN);
        this.gen = 0;
        this.history = [];
        this.best = null;
        this.bestFit = -1e18;

        this.phase = "bank";
        this.bank = [];
        this.bankIdx = 0;
        this.bankTries = 0;
        this.flown = null;
        this.alive = null;
        this.round = 0;
        this.evalIdx = 0;
        this.episodes = 0;
        this.episodesFull = 0;
        this.stats = { docked: 0, contact: 0, n: 0 };
        this.lastOutcome = "—";
        this.status = "building the scenario bank";
    }

    /* Do work for up to `budgetMs` milliseconds, then return. Called once per
     * animation frame by main.js. */
    tick(budgetMs) {
        const t0 = performance.now();
        let did = 0;
        while (performance.now() - t0 < budgetMs) {
            if (!this._step()) break;
            if (++did > 400) break;      // never spin forever on cheap steps
        }
        return did;
    }

    _step() {
        if (this.phase === "bank") return this._stepBank();
        if (this.phase === "eval") return this._stepEval();
        if (this.phase === "evolve") return this._stepEvolve();
        return false;
    }

    /* One scenario auditioned per step. calibrate() is three episodes — the
     * do-nothing probe, the do-nothing score, and the autopilot — so this is
     * comfortably the most expensive single step in the machine. */
    _stepBank() {
        if (this.bankIdx === 0 && this.bank.length === 0) {
            this.wanted = buildBank(this.stage, this.bankSize, this.gen >> 1)
                .map(s => ({ stage: s.stage, seed: s.seed }));
        }
        if (this.bankIdx >= this.wanted.length) {
            this.phase = "eval";
            this.flown = this.evo.brains.map(() => []);
            this.stats = { docked: 0, contact: 0, n: 0 };
            this.alive = this.evo.brains.map((_, i) => i);
            this.round = 0;
            this.evalIdx = 0;
            this.plan = racePlan(this.bank.length, { disabled: !this.race });
            this.status = `generation ${this.gen + 1} — scenario 1 of ${this.bank.length}`;
            return true;
        }
        const w = this.wanted[this.bankIdx];
        const sc = makeScenario(w.stage, w.seed + 7717 * this.bankTries);
        calibrate(sc);
        // Three attempts, then take what we have — a browser demo that stalls
        // hunting for a perfect scenario is worse than one slightly odd episode.
        if (sc.usable || this.bankTries >= 3) {
            this.bank.push(sc);
            this.bankIdx++;
            this.bankTries = 0;
        } else this.bankTries++;
        this.status = `auditioning scenario ${this.bankIdx + 1} of ${this.wanted.length}`;
        return true;
    }

    _stepEval() {
        const round = this.plan[this.round];
        const s = round.scenarios[0];
        if (this.evalIdx >= this.alive.length) {
            // End of a round: make the cut, then move on.
            if (this.round >= this.plan.length - 1) { this.phase = "evolve"; return true; }
            if (round.keep < 1) {
                const ranked = this.alive.slice().sort((a, b) =>
                    foldFitness(this.flown[b], this.bank.length) - foldFitness(this.flown[a], this.bank.length));
                const keepN = Math.max(4, Math.ceil(this.alive.length * round.keep));
                const keep = new Set(ranked.slice(0, keepN));
                for (let i = 0; i < 4 && i < this.evo.brains.length; i++) keep.add(i);
                this.cutFrom = this.alive.length;
                this.alive = this.alive.filter(i => keep.has(i));
                this.cutTo = this.alive.length;
            }
            this.round++;
            this.evalIdx = 0;
            this.status = `generation ${this.gen + 1} — scenario ${this.round + 1} of ${this.bank.length}` +
                (this.cutTo ? ` · ${this.cutTo} of ${this.pop} still in` : "");
            return true;
        }
        const bi = this.alive[this.evalIdx++];
        const r = runEpisode(this.bank[s], this.evo.brains[bi], { noiseSeed: 3000 + this.gen * 31 + s });
        this.flown[bi].push(r.advantage);
        this.stats.docked += r.docked; this.stats.contact += r.contact; this.stats.n++;
        this.lastOutcome = r.outcome;
        this.episodes++;
        return true;
    }

    _stepEvolve() {
        const results = this.evo.brains.map((brain, i) => ({
            brain,
            fitness: foldFitness(this.flown[i], this.bank.length),
            docked: 0
        }));
        const rec = this.evo.evolve(results, this.mutRate, this.mutSigma, 3, {}, { stage: this.stage });
        const top = results.slice().sort((a, b) => b.fitness - a.fitness)[0];
        if (top.fitness > this.bestFit) { this.bestFit = top.fitness; this.best = top.brain.clone(); }
        this.history.push({
            gen: this.gen + 1, best: rec.best, avg: rec.avg,
            dock: this.stats.n ? this.stats.docked / this.stats.n : 0,
            touch: this.stats.n ? (this.stats.docked + this.stats.contact) / this.stats.n : 0
        });
        if (this.history.length > 400) this.history.shift();
        this.episodesFull += this.pop * this.bank.length;
        this.gen++;
        // Fresh bank every other generation — the same seed-block idea the
        // headless trainer uses, so consecutive generations stay comparable.
        this.bank = []; this.bankIdx = 0; this.bankTries = 0;
        this.phase = "bank";
        this.status = `generation ${this.gen + 1} — building the scenario bank`;
        return true;
    }

    get saved() {
        return this.episodesFull > 0 ? 1 - this.episodes / this.episodesFull : 0;
    }
}
