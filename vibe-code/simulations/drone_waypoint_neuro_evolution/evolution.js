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
 * more random immigrants, past `childZeroFit` no more crossover either — the
 * population becomes pure hill-climbing on the champion.
 *
 * CHAMPION GRACE. A drone lives or dies on one episode, and one unlucky
 * waypoint behind a pillar can wipe out a genuinely good brain. The reigning
 * champion keeps an untouched seat for `gracePeriod` generations after being
 * beaten. Only one drone holds grace at a time; defending the title refreshes
 * it. This costs one slot and has repeatedly been the difference between a run
 * that converges and one that throws away its best brain on a bad draw.
 */
"use strict";

class Evolution {
    constructor(popSize, seed) {
        this.popSize = popSize;
        this.gen = 1;
        this.rng = mulberry32(seed || 42);
        this.brains = [];
        for (let i = 0; i < popSize; i++) this.brains.push(new Net(NET_SIZES, this.rng));
        this.history = [];
        this.champion = null;
        this.championFit = -1e18;
        this.grace = null;
        this.graceIdx = -1;
        this.graceEvent = null;
        this.lastStage = null;
    }

    /* results: [{brain, fitness, arrivals}] for the generation just finished.
     * stats: extra per-generation telemetry stored on the history entry (the
     * stage ratchet reads avgArr and stage back out of it). */
    evolve(results, mutRate, mutSigma, gracePeriod, limits, stats) {
        results.sort((a, b) => b.fitness - a.fitness);
        // Fitness is per-room normalised (see STAGES.scale), so these gates are
        // in units of "competent episodes", not raw points: 1.0 ≈ a decent run
        // in every room the exam covers.
        const immZeroFit = limits && limits.immZeroFit != null ? limits.immZeroFit : 1.2;
        const childZeroFit = limits && limits.childZeroFit != null ? limits.childZeroFit : 2.5;

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
                    this.graceEvent = `grace: beaten champion sheltered (${this.grace.left} gens left)`;
                }
            }
        }

        const n = this.popSize;
        const best = results[0];
        const avg = results.reduce((s, r) => s + r.fitness, 0) / results.length;
        const avgArr = results.reduce((s, r) => s + r.arrivals, 0) / results.length;
        const rec = Object.assign({
            gen: this.gen, best: best.fitness, avg,
            bestArr: best.arrivals, avgArr
        }, stats || {});
        this.history.push(rec);

        // A stage change is an environment change, and fitness is only
        // comparable within one environment. A brain worth 9,600 in the Empty
        // Hall is worth a few hundred in the Pillar Field, so carrying the old
        // number across the boundary freezes `champion` on the stage-0 brain
        // forever: nothing in the new stage can ever beat it, every checkpoint
        // the run writes from then on is the OLD net, and the search gates sit
        // closed as though the population were already mature. Reset and
        // re-measure — the population is still full of the outgoing champion's
        // elites, so if it really is the best brain here too it reclaims the
        // title on this very generation, having actually earned it.
        const stage = stats && stats.stage != null ? stats.stage : null;
        if (stage !== null && this.lastStage !== null && stage !== this.lastStage) {
            this.championFit = -1e18;
            this.graceEvent = `stage ${this.lastStage} → ${stage}: champion fitness reset ` +
                `(scores are not comparable across stages)`;
        }
        if (stage !== null) this.lastStage = stage;

        if (best.fitness > this.championFit) {
            this.championFit = best.fitness;
            this.champion = best.brain.clone();
        }

        const rng = this.rng;
        const ELITES = Math.min(4, n);
        const MUT_ELITES = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const ELITE_CROSS = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const FRESH_MAX = n >= 32 ? 2 : 1;
        const immFrac = immZeroFit > 0
            ? Math.max(0, Math.min(1, 1 - this.championFit / immZeroFit))
            : 1;
        const FRESH = Math.round(FRESH_MAX * immFrac);
        const noChildren = childZeroFit > 0 && this.championFit >= childZeroFit;

        const next = [];
        for (let i = 0; i < ELITES; i++) next.push(results[i].brain.clone());
        for (let i = 0; i < MUT_ELITES; i++) {
            const p = results[(rng() * ELITES) | 0].brain.clone();
            next.push(p.mutate(mutRate, mutSigma, rng));
        }
        const topPool = Math.min(6, results.length);
        for (let i = 0; i < ELITE_CROSS; i++) {
            if (noChildren) {
                const p = results[(rng() * topPool) | 0].brain.clone();
                next.push(p.mutate(mutRate * 0.5, mutSigma * 0.7, rng));
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
        while (next.length < n) next.push(new Net(NET_SIZES, rng));

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

/* ------------------------------------------------------------- curriculum */
/* Three rungs. A drone that cannot hold a hover has no business learning to
 * thread a doorway, and a room full of pillars in generation 1 just kills
 * everything before the fitness function can tell two brains apart.
 *
 *   0  Empty Hall       still air              learn to fly and navigate
 *   1  Pillar Field     light draught          learn that solid things exist
 *   2  The Warehouse    real turbulence        learn gaps, racks, overhangs
 *
 * The ratchet is monotone and threshold-driven, never a bare generation count:
 * it promotes when the *mean* drone (not the champion) reliably reaches
 * waypoints at the current rung, and it never demotes. Promoting on a
 * generation number instead would move the goalposts on a population that
 * hadn't learned the previous rung — the classic way to lose a run. */
/* `scale` divides a room's raw fitness so that every room contributes equally
 * to a generation's score, and it is not cosmetic.
 *
 * Raw scores are wildly different between rooms because they are dominated by
 * waypoints reached, and an empty hall permits thirty in the time a warehouse
 * permits one. Averaging raw fitness across rooms therefore hands ~90% of the
 * selection signal to the easiest room. Measured, a champion trained on the
 * unnormalised three-room mix:
 *
 *     hall 9.90 waypoints (18,053)   pillars 0.90 (1,875)   warehouse 0.00 (347)
 *
 * It had become a superb empty-room flier that could no longer fly the
 * warehouse AT ALL — worse there than the earlier brain that had never seen it.
 * Selection was not asking for a generalist, it was asking for hall points with
 * extra steps.
 *
 * These constants are roughly what a competent brain scores in each room, so a
 * normalised episode lands near 1.0 everywhere. They only need to be the right
 * order of magnitude — what matters is that no room can drown out another. */
const STAGES = [
    { room: "hall", turbulence: 0, minSep: 9, scale: 12000, label: "Empty Hall" },
    { room: "pillars", turbulence: 0.35, minSep: 9, scale: 2500, label: "Pillar Field" },
    { room: "warehouse", turbulence: 0.6, minSep: 8, scale: 2000, label: "The Warehouse" }
];

function stageFor(gen, history, cfg) {
    cfg = cfg || {};
    if (cfg.stageLock) return Math.max(0, Math.min(STAGES.length - 1, cfg.stageLock | 0));
    // 0.8 mean waypoints per episode, not 1.2. The mean is taken over the whole
    // roster including the deliberately high-sigma mutants at the bottom, which
    // mostly score zero by design — so a mean near 1 already means the
    // competent half of the population is flying several waypoints a run.
    // Measured at 1.2: a population whose champion reliably managed 18
    // waypoints sat in stage 0 indefinitely, because the mean bounced around
    // 0.7–1.6 and never cleared the bar three generations running.
    const promote = cfg.promoteArrivals != null ? cfg.promoteArrivals : 0.8;
    const hold = cfg.promoteHold != null ? cfg.promoteHold : 3;   // consecutive gens
    let s = 0, run = 0;
    for (const h of history) {
        if (h.stage !== s) { run = 0; continue; }
        // Judge competence in the NEWEST room only. Once a generation's exam
        // spans several rooms, a mean over all of them is carried by the easy
        // ones — a population that cannot fly the warehouse at all would still
        // promote on its hall arrivals. `newArr` counts only the new room.
        const arr = h.newArr != null ? h.newArr : h.avgArr;
        run = arr >= promote ? run + 1 : 0;
        if (run >= hold && s < STAGES.length - 1) { s++; run = 0; }
    }
    return s;
}

function stageOpts(stage) {
    return STAGES[Math.max(0, Math.min(STAGES.length - 1, stage))];
}

/* Which stage each of a generation's episodes runs in.
 *
 * Unlocking a stage ADDS a room to the exam, it does not replace it. Training
 * only in the newest room is catastrophic forgetting, and it is not a
 * theoretical worry — measured on held-out courses, a champion taken from
 * stage 0 into pillars-only stage 1 went:
 *
 *     hall 3.00 -> 1.00 waypoints     pillars 0.63 -> 0.75
 *     mean fitness across rooms 2,948 -> 2,004
 *
 * It lost more flying the empty room than it gained flying the hard one, and
 * "progress" through the curriculum was a net loss. So every generation is now
 * scored across the current stage AND the ones already unlocked: episode 0
 * always runs the newest room, and the rest cycle through all of them. A brain
 * only advances by being good at everything it has ever been asked to do.
 *
 *   stage 0, 3 episodes -> [0, 0, 0]
 *   stage 1, 3 episodes -> [1, 0, 1]
 *   stage 2, 3 episodes -> [2, 0, 1]
 *   stage 2, 5 episodes -> [2, 0, 1, 2, 0]
 */
/* One episode's contribution to a generation's score: normalised by the room's
 * scale, then passed through a square root.
 *
 * The normalisation alone is not enough. It equalises the *scale* of the rooms
 * but not the ability of one room to dominate by sheer magnitude — an empty
 * hall has no ceiling on waypoints, so a brain scoring eight times par there
 * still out-averages a brain at twice par everywhere, and selection quietly
 * goes back to asking for hall points. The square root gives diminishing
 * returns: going from 0 to 1 in the room you are bad at is worth more than
 * going from 4 to 5 in the room you are already good at, which is exactly the
 * preference a generalist objective should have. Ordering within a room is
 * untouched, so nothing about "better is better" is lost.
 *
 * Negative scores (an early crash) pass through unchanged rather than being
 * square-rooted into NaN, and the transform is continuous at zero. */
function normalizeFitness(fitness, scale) {
    const x = fitness / scale;
    return x <= 0 ? x : Math.sqrt(x);
}

function episodeStages(stage, episodes) {
    const s = Math.max(0, Math.min(STAGES.length - 1, stage | 0));
    const out = [];
    for (let e = 0; e < Math.max(1, episodes | 0); e++) {
        out.push(e === 0 ? s : (e - 1) % (s + 1));
    }
    return out;
}

if (typeof module !== "undefined") {
    module.exports = { Evolution, stageFor, stageOpts, episodeStages, normalizeFitness, STAGES };
}
