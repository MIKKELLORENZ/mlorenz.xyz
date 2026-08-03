/* evolution.js — the genetic algorithm. No gradients.
 *
 * Five things here are not the standard recipe, and each of them exists
 * because of something this task does that a normal control problem does not.
 *
 * ─── 1. COMMON RANDOM SCENARIOS ─────────────────────────────────────────────
 * Every brain in a generation flies the identical bank: identical initial
 * conditions, identical sensor-noise realisation. Two brains differing by one
 * mutation are then compared on their difference and not on which of them drew
 * the 30 km start. On a task whose scenario-to-scenario score spread is larger
 * than its generation-to-generation improvement — which is every rendezvous
 * task — this is worth more than any amount of population size.
 *
 * ─── 2. THE BANK IS STRATIFIED AND AUDITIONED ───────────────────────────────
 * One scenario from each unlocked stage, a second seat for the newest one, and
 * every scenario pre-screened by world.js's audition: the scripted autopilot
 * must be able to dock it and a do-nothing policy must not. See the comment on
 * calibrate() for why the second test is the one that saves runs.
 *
 * ─── 3. SUCCESSIVE HALVING — brains are eliminated between scenarios ────────
 * Everyone flies scenario 0. The worse half is dropped. The survivors fly
 * scenario 1; the worse half of those is dropped. And so on. A full bank of six
 * would cost 6P episodes; this costs about 2.1P for the same ranking at the
 * top, where ranking is the only place it matters. Combined with the
 * within-episode abort gates in world.js — a brain that flies past the station
 * is killed in the first simulated minute — the effective speedup on a young
 * population is roughly five-fold.
 *
 * The trap this has to avoid is that a brain eliminated after one scenario has
 * a mean over one scenario, and comparing that against a survivor's mean over
 * six is not a comparison at all. So unflown scenarios are IMPUTED
 * PESSIMISTICALLY: a brain is credited with its own average so far, minus a
 * margin. It can therefore never leapfrog a brain that actually went the
 * distance, and the ordering inside the eliminated group — which still matters,
 * because they are still parents — stays honest.
 *
 * The elites and the reigning champion are exempt and always fly the full bank.
 * The top of the ladder is the one place the noise must not be allowed in.
 *
 * ─── 4. FITNESS IS AN ADVANTAGE OVER TWO BASELINES ──────────────────────────
 * Per scenario: (brain − doNothing) / (autopilot − doNothing). 0 means no
 * better than coasting, 1 means as good as a competent scripted pilot. This
 * replaces the hand-tuned per-stage fitness scales that every other sim in this
 * collection needed, and unlike a scale it cannot be gamed by getting very good
 * at the cheap stage — the denominator already knows what "good" is worth there.
 *
 * Aggregation is worst-weighted: half the mean over the whole bank, half the
 * mean over the two worst scenarios. A brain that is superb close in and
 * hopeless at 100 km does not get to average its way to the top.
 *
 * ─── 5. ISLANDS, ONE-WAY ────────────────────────────────────────────────────
 * From stage 2 on, a slice of the population splits into three demes that breed
 * only within themselves under different mutation recipes. Each generation each
 * deme's best is copied into the MAIN pool's bottom seats, and nothing ever
 * travels the other way. That asymmetry is the point: the islands are a source
 * of variation for the main pool, not a place for the main pool's champion to
 * take over.
 */
"use strict";

const RACE = {
    keep: [0.50, 0.50, 0.60, 1.0, 1.0, 1.0],   // survivor fraction after each round
    minSurvivors: 10,
    pessimism: 0.35                            // imputed penalty per unflown scenario
};

/* The rounds of a race: which scenario each round flies, and what fraction of
 * the field survives it. Round r flies scenario r; any scenarios beyond the cut
 * schedule are flown together by the survivors in one final round. */
function racePlan(bankSize, opts) {
    opts = opts || {};
    if (opts.disabled) return [{ scenarios: Array.from({ length: bankSize }, (_, i) => i), keep: 1 }];
    const plan = [];
    for (let i = 0; i < bankSize; i++) {
        const keep = i < RACE.keep.length ? RACE.keep[i] : 1;
        plan.push({ scenarios: [i], keep });
    }
    return plan;
}

/* Fold a brain's per-scenario advantages into one number.
 *
 * `flown` is the list of advantages it actually achieved, in bank order;
 * `bankSize` is how many there were. Unflown scenarios are imputed at the
 * brain's own mean minus a pessimism margin. */
function foldFitness(flown, bankSize) {
    const k = flown.length;
    if (k === 0) return -99;
    let sum = 0;
    for (const a of flown) sum += a;
    const mean = sum / k;
    const full = flown.slice();
    for (let i = k; i < bankSize; i++) full.push(mean - RACE.pessimism);
    full.sort((a, b) => a - b);
    const worstN = Math.min(2, full.length);
    let worst = 0;
    for (let i = 0; i < worstN; i++) worst += full[i];
    worst /= worstN;
    let all = 0;
    for (const a of full) all += a;
    all /= full.length;
    // Half the average, half the two worst. A generalist objective, and the
    // reason a brain cannot buy the score with the stage it already owns.
    return 0.5 * all + 0.5 * worst;
}

/* --------------------------------------------------------------- islands */
const TRACK_RECIPES = [
    { name: "wide", rate: 1.9, sigma: 1.7 },
    { name: "sparse", rate: 0.35, sigma: 3.0 },
    { name: "fine", rate: 1.0, sigma: 0.45 }
];

class Evolution {
    constructor(popSize, seed, nin) {
        this.popSize = popSize;
        this.nin = nin;
        this.spec = netSpec(nin);
        this.gen = 1;
        this.rng = mulberry32(seed || 42);
        this.brains = [];
        for (let i = 0; i < popSize; i++) this.brains.push(new Brain(this.spec, this.rng));
        this.history = [];
        this.champion = null;
        this.championFit = -1e18;
        this.grace = null;
        this.graceIdx = -1;
        this.graceEvent = null;
        this.lastStage = null;
        this.islands = false;
        this.mainCount = popSize;
    }

    /* Which slice of the population belongs to which island. Main pool first,
     * then three equal demes at the tail. */
    layout(useIslands) {
        const n = this.popSize;
        if (!useIslands || n < 48) return { main: n, demes: [] };
        const per = Math.max(6, Math.floor(n * 0.10));
        const main = n - per * 3;
        return { main, demes: [[main, main + per], [main + per, main + 2 * per], [main + 2 * per, n]] };
    }

    /* `results`: [{brain, fitness, ...}] for the generation just finished, in
     * POPULATION ORDER (index i is brains[i]) — the island bookkeeping needs
     * that, so this method sorts its own copies rather than the caller's. */
    evolve(results, mutRate, mutSigma, gracePeriod, limits, stats) {
        const n = this.popSize;
        const lay = this.layout(this.islands);
        this.mainCount = lay.main;

        // Per-slice ranking. The main pool ranks among itself; each deme ranks
        // among itself. Nothing is compared across the boundary — that is what
        // makes them islands rather than a differently-shaped tail.
        const rankSlice = (from, to) => results.slice(from, to).slice().sort((a, b) => b.fitness - a.fitness);
        const main = rankSlice(0, lay.main);
        const demes = lay.demes.map(([a, b]) => rankSlice(a, b));

        const immZeroFit = limits && limits.immZeroFit != null ? limits.immZeroFit : 0.35;
        const childZeroFit = limits && limits.childZeroFit != null ? limits.childZeroFit : 1.10;

        /* ---- champion grace ----
         * One scenario bank is six episodes and the far stages are noisy even
         * so; a genuinely better brain can lose a generation to one badly
         * phased draw. The reigning champion keeps an untouched seat for
         * `gracePeriod` generations after being beaten. Costs one slot, and has
         * repeatedly been the difference between a run that converges and one
         * that throws its best brain away on a bad bank. */
        const gp = gracePeriod | 0;
        this.graceEvent = null;
        let holderIdx = -1;
        if (gp <= 0) {
            this.grace = null;
        } else {
            if (this.grace) holderIdx = main.findIndex(r => r.brain === this.grace.net);
            if (!this.grace || holderIdx === -1) {
                this.grace = { net: main[0].brain, left: gp };
                holderIdx = 0;
                this.graceEvent = "grace: champion crowned";
            } else if (holderIdx === 0) {
                this.grace.left = gp;
            } else {
                this.grace.left--;
                if (this.grace.left <= 0) {
                    this.grace = { net: main[0].brain, left: gp };
                    holderIdx = 0;
                    this.graceEvent = "grace expired — title passes to the new best";
                } else {
                    this.graceEvent = `grace: beaten champion sheltered (${this.grace.left} gens left)`;
                }
            }
        }

        const best = main[0];
        const mainAvg = main.reduce((s, r) => s + r.fitness, 0) / main.length;
        const docked = results.reduce((s, r) => s + (r.docked || 0), 0) / results.length;
        const rec = Object.assign({
            gen: this.gen, best: best.fitness, avg: mainAvg, docked,
            islands: this.islands ? demes.map(d => d.length ? d[0].fitness : 0) : null
        }, stats || {});
        this.history.push(rec);

        /* A stage change is an environment change. Advantage normalisation
         * makes stage scores far more comparable than raw fitness ever was, but
         * "comparable" is not "identical" — the bank composition changes when a
         * stage unlocks, and carrying the old high-water mark across the
         * boundary can still freeze the champion. Reset and re-measure; the
         * population is full of the outgoing champion's elites, so if it really
         * is still the best it reclaims the title on this very generation. */
        const stage = stats && stats.stage != null ? stats.stage : null;
        if (stage !== null && this.lastStage !== null && stage !== this.lastStage) {
            this.championFit = -1e18;
            this.graceEvent = `stage ${this.lastStage} → ${stage}: champion fitness reset`;
        }
        if (stage !== null) this.lastStage = stage;
        if (best.fitness > this.championFit) {
            this.championFit = best.fitness;
            this.champion = best.brain.clone();
        }

        const rng = this.rng;
        const next = new Array(n);

        /* ---------------------------------------------------- main pool */
        const m = lay.main;
        const ELITES = Math.min(4, m);
        const MUT_ELITES = Math.min(10, Math.max(2, (m * 0.16) | 0));
        const ELITE_CROSS = Math.min(10, Math.max(2, (m * 0.16) | 0));
        const immFrac = immZeroFit > 0 ? Math.max(0, Math.min(1, 1 - this.championFit / immZeroFit)) : 1;
        const FRESH = Math.round((m >= 32 ? 2 : 1) * immFrac);
        const noChildren = childZeroFit > 0 && this.championFit >= childZeroFit;
        const IMMIGRANTS = this.islands ? Math.min(3, demes.length) : 0;

        let w = 0;
        for (let i = 0; i < ELITES; i++) next[w++] = main[i].brain.clone();
        for (let i = 0; i < MUT_ELITES; i++) {
            next[w++] = main[(rng() * ELITES) | 0].brain.clone().mutate(mutRate, mutSigma, rng);
        }
        const topPool = Math.min(8, main.length);
        for (let i = 0; i < ELITE_CROSS; i++) {
            if (noChildren) {
                next[w++] = main[(rng() * topPool) | 0].brain.clone().mutate(mutRate * 0.5, mutSigma * 0.7, rng);
            } else {
                let a = (rng() * topPool) | 0, b = (rng() * topPool) | 0;
                if (b === a) b = (b + 1) % topPool;
                next[w++] = Brain.crossover(main[a].brain, main[b].brain, rng)
                    .mutate(mutRate * 0.5, mutSigma * 0.7, rng);
            }
        }
        const pickRank = () => {
            const r = Math.pow(rng(), 2.2);
            return Math.min(main.length - 1, (r * main.length * 0.55) | 0);
        };
        while (w < m - FRESH - IMMIGRANTS) {
            const depth = w / Math.max(1, m);
            const mr = mutRate * (0.8 + depth), ms = mutSigma * (0.8 + depth * 1.6);
            if (noChildren) next[w++] = main[pickRank()].brain.clone().mutate(mr, ms, rng);
            else next[w++] = Brain.crossover(main[pickRank()].brain, main[pickRank()].brain, rng).mutate(mr, ms, rng);
        }
        /* ONE-WAY MIGRATION. The bottom seats of the main pool, and only those,
         * are handed each deme's current best. Nothing goes the other way — an
         * island that keeps receiving the champion stops being an island within
         * about three generations. */
        for (let d = 0; d < IMMIGRANTS && w < m; d++) {
            next[w++] = demes[d][0].brain.clone();
        }
        while (w < m) next[w++] = new Brain(this.spec, rng);

        /* -------------------------------------------------------- demes */
        lay.demes.forEach(([a, b], di) => {
            const pool = demes[di];
            const recipe = TRACK_RECIPES[di % TRACK_RECIPES.length];
            const size = b - a;
            const el = Math.max(1, size >> 2);
            for (let i = 0; i < size; i++) {
                const slot = a + i;
                if (i < el) next[slot] = pool[i].brain.clone();
                else {
                    const p = pool[(rng() * el) | 0].brain;
                    next[slot] = p.clone().mutate(mutRate * recipe.rate, mutSigma * recipe.sigma, rng);
                }
            }
        });

        /* ---- seat the grace holder, byte for byte ---- */
        this.graceIdx = -1;
        if (gp > 0 && this.grace) {
            if (holderIdx >= 0 && holderIdx < ELITES) {
                this.grace.net = next[holderIdx];
                this.graceIdx = holderIdx;
            } else {
                const slot = Math.max(ELITES, m - FRESH - IMMIGRANTS - 1);
                const c = this.grace.net.clone();
                next[slot] = c;
                this.grace.net = c;
                this.graceIdx = slot;
            }
        }

        this.brains = next;
        this.gen++;
        return rec;
    }

    /* Re-seed the whole pool from one brain, for --resume and for the
     * imitation warm start. Every copy but the first is mutated, because a pool
     * of identical brains has nothing for selection to act on and spends its
     * first ten generations re-inventing variance. */
    seedFrom(brain, mutRate, mutSigma) {
        for (let i = 0; i < this.brains.length; i++) {
            this.brains[i] = i === 0 ? brain.clone()
                : brain.clone().mutate(mutRate, mutSigma, this.rng);
        }
        this.champion = brain.clone();
        this.championFit = -1e18;
    }
}

/* ------------------------------------------------------------- curriculum */
/* The ratchet. It reads HELD-OUT exam results, never training scores, and it
 * promotes on two conditions at once:
 *
 *   the newest stage's docking rate has cleared the bar, three checks running
 *   AND stage 0's docking rate has not fallen below its anchor
 *
 * The second is the anti-forgetting clause and it is not hypothetical — every
 * neuroevolution sim in this collection that promoted on the new stage alone
 * eventually produced a champion that was worse at everything it used to be
 * able to do. It never demotes: a stage once unlocked stays in the bank
 * forever, which is the other half of the same promise. */
function ratchet(state, examByStage, cfg) {
    cfg = cfg || {};
    const promote = cfg.promote != null ? cfg.promote : 0.50;
    const anchor = cfg.anchor != null ? cfg.anchor : 0.75;
    const hold = cfg.hold != null ? cfg.hold : 3;
    const maxStage = cfg.maxStage != null ? cfg.maxStage : N_STAGES - 1;
    const top = examByStage[state.stage];
    const base = examByStage[0];
    const ready = state.stage < maxStage && top && base &&
        top.docked >= promote && base.docked >= anchor;
    state.run = ready ? (state.run || 0) + 1 : 0;
    if (state.run >= hold) {
        state.stage++;
        state.run = 0;
        return true;
    }
    return false;
}

if (typeof module !== "undefined") {
    module.exports = {
        Evolution, racePlan, foldFitness, ratchet, RACE, TRACK_RECIPES
    };
}
