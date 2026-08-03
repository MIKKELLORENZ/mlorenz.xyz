/* evolution.js — the genetic algorithm and the task curriculum. No gradients.
 *
 * Structurally the same ladder that worked in the boats and the walker:
 * untouched elites, mutated elites, elite crossovers, a rank-weighted gradient
 * of riskier children, and a trickle of fresh immigrants that tapers to zero as
 * the run matures. What is different here is what a "generation" measures.
 *
 * A brain is scored on SEVERAL TASKS per generation, not one. That is not a
 * nicety. The whole claim of the project is that one policy obeys many
 * instructions; a generation that examines every brain on a single instruction
 * selects for a brain that is good at that instruction, and the next generation
 * examines it on a different one. Selection would be measuring the exam paper.
 * So each generation draws a small block of tasks, every brain runs all of
 * them, and fitness is the mean.
 */
"use strict";

class Evolution {
    constructor(popSize, seed, embDim) {
        this.popSize = popSize;
        this.embDim = embDim;
        this.gen = 1;
        this.rng = mulberry32(seed || 42);
        this.brains = [];
        for (let i = 0; i < popSize; i++) this.brains.push(new Brain(embDim, this.rng));
        this.history = [];
        this.champion = null;
        this.championFit = -1e18;
        this.championGen = 0;
        this.grace = null;
        this.graceIdx = -1;
        this.graceEvent = null;
        this.stage = 1;
    }

    evolve(results, mutRate, mutSigma, gracePeriod, limits) {
        results.sort((a, b) => b.fitness - a.fitness);
        const immZeroFit = limits && limits.immZeroFit != null ? limits.immZeroFit : 1800;
        const childZeroFit = limits && limits.childZeroFit != null ? limits.childZeroFit : 6000;

        // ---- champion grace ----
        const gp = gracePeriod | 0;
        this.graceEvent = null;
        let holderIdx = -1;
        if (gp <= 0) this.grace = null;
        else {
            if (this.grace) holderIdx = results.findIndex(r => r.brain === this.grace.net);
            if (!this.grace || holderIdx === -1) {
                this.grace = { net: results[0].brain, left: gp };
                holderIdx = 0;
                this.graceEvent = "grace: champion crowned";
            } else if (holderIdx === 0) this.grace.left = gp;
            else {
                this.grace.left--;
                if (this.grace.left <= 0) {
                    this.grace = { net: results[0].brain, left: gp };
                    holderIdx = 0;
                    this.graceEvent = "grace expired — title passes";
                } else this.graceEvent = `grace: beaten champion sheltered (${this.grace.left} left)`;
            }
        }

        const n = this.popSize;
        const best = results[0];
        const mean = (f) => results.reduce((s, r) => s + f(r), 0) / results.length;
        /* Deliveries by the top quarter of the fleet. The curriculum advances on
         * THIS, not on the fleet mean.
         *
         * Two thirds of any generation are deep-mutated children whose job is to
         * explore, and they fail on purpose. Measured at generation 224 of a
         * stage-1 run: the champion was delivering on half its missions while the
         * fleet mean sat at 0.02, so a mean-based gate would have held the whole
         * run at stage 1 indefinitely while the skill was demonstrably learned.
         * The top quartile says "the good genes have consolidated", which is the
         * actual precondition for making the task harder. It is still smoothed
         * over six generations so one lucky block cannot promote the fleet. */
        const topN = Math.max(1, Math.round(results.length * 0.25));
        const topDel = results.slice(0, topN).reduce((s, r) => s + r.delivered, 0) / topN;
        const rec = {
            best: best.fitness,
            avg: mean(r => r.fitness),
            bestDel: best.delivered,
            avgDel: mean(r => r.delivered),
            topDel,
            bestRate: best.rate,
            avgRate: mean(r => r.rate),
            complete: mean(r => r.completed),
            mistakes: mean(r => r.mistakes),
            stage: this.stage
        };
        this.history.push(rec);

        if (best.fitness > this.championFit) {
            this.championFit = best.fitness;
            this.champion = best.brain.clone();
            this.championGen = this.gen;
        }

        const rng = this.rng;
        const ELITES = Math.min(4, n);
        const MUT_ELITES = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const ELITE_CROSS = Math.min(8, Math.max(2, (n * 0.16) | 0));
        const FRESH_MAX = n >= 32 ? 2 : 1;
        const immFrac = immZeroFit > 0 ? Math.max(0, Math.min(1, 1 - this.championFit / immZeroFit)) : 1;
        const FRESH = Math.round(FRESH_MAX * immFrac);
        const noChildren = childZeroFit > 0 && this.championFit >= childZeroFit;

        const next = [];
        for (let i = 0; i < ELITES; i++) next.push(results[i].brain.clone());
        for (let i = 0; i < MUT_ELITES; i++)
            next.push(results[(rng() * ELITES) | 0].brain.clone().mutate(mutRate, mutSigma, rng));
        const topPool = Math.min(6, results.length);
        for (let i = 0; i < ELITE_CROSS; i++) {
            if (noChildren) {
                next.push(results[(rng() * topPool) | 0].brain.clone().mutate(mutRate * 0.5, mutSigma * 0.7, rng));
            } else {
                let a = (rng() * topPool) | 0, b = (rng() * topPool) | 0;
                if (b === a) b = (b + 1) % topPool;
                next.push(Brain.crossover(results[a].brain, results[b].brain, rng)
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
            if (noChildren) next.push(results[pickRank()].brain.clone().mutate(mr, ms, rng));
            else next.push(Brain.crossover(results[pickRank()].brain, results[pickRank()].brain, rng).mutate(mr, ms, rng));
        }
        while (next.length < n) next.push(new Brain(this.embDim, rng));

        this.graceIdx = -1;
        if (gp > 0 && this.grace) {
            if (holderIdx < ELITES) { this.grace.net = next[holderIdx]; this.graceIdx = holderIdx; }
            else {
                const slot = Math.max(ELITES, n - FRESH - 1);
                const clone = this.grace.net.clone();
                next[slot] = clone; this.grace.net = clone; this.graceIdx = slot;
            }
        }

        this.brains = next;
        this.gen++;
        return rec;
    }
}

/* ======================================================== the task curriculum
 *
 * Stage 1 is deliberately almost trivial — one ball, one legal answer, an empty
 * table. Nothing about the language matters yet; the population is only being
 * paid to discover reach, close, lift, carry, open. Handing a random-weight
 * fleet the full 49-goal bank at generation 1 means the reward for reaching is
 * buried under the noise of 49 different notions of which ball to reach for,
 * and the motor head never gets a clean signal to hill-climb on.
 *
 * The ordering rules (ORDER, ALTERNATE, LEAVE_ONE) come last because they are
 * the only goals where the right action depends on what the arm ALREADY DID.
 * Until deliveries happen reliably, "which ball is next" is a question the
 * population has no data to answer.
 */
const STAGES = [
    {
        id: 1, bank: 4, name: "reach & place",
        desc: "One ball, an empty table, one legal answer. Learn the motor loop.",
        kinds: ["SORT"], maxColors: 1, maxBalls: 1, noise: 0, advance: 0.55
    },
    {
        id: 2, bank: 8, name: "clutter",
        desc: "Distractor colours appear. The selector has to start reading the instruction.",
        kinds: ["SORT"], maxColors: 2, maxBalls: 3, noise: 0, advance: 1.1
    },
    {
        id: 3, bank: 16, name: "sets & exclusions",
        desc: "Counting, 'everything into one bucket', and colours that must not be touched.",
        kinds: ["SORT", "ALL_TO_ONE", "COUNT", "EXCLUDE"], maxColors: 4, maxBalls: 4, noise: 0.2, advance: 1.5
    },
    {
        id: 4, bank: 28, name: "order matters",
        desc: "Alternation, strict ordering, and leaving one behind — the goal now depends on history.",
        kinds: null, maxColors: 4, maxBalls: 5, noise: 0.3, advance: 2.0
    },
    {
        id: 5, bank: 48, name: "full bench",
        desc: "Every goal, up to six balls, sensor and servo noise.",
        kinds: null, maxColors: 4, maxBalls: 6, noise: 0.5, advance: 99
    }
];

/* Which stage the next generation runs in. Advancement is on a SMOOTHED mean
 * of correct deliveries, not the last generation's number: a single lucky
 * generation promoting the fleet into a stage it cannot do wastes far more
 * time than a late promotion costs. */
function stageFor(gen, history, cfg) {
    if (cfg && cfg.stageLock > 0) return STAGES[Math.min(STAGES.length, cfg.stageLock) - 1];
    let stage = 1;
    const W = 6;
    for (let s = 0; s < STAGES.length - 1; s++) {
        const recent = history.filter(h => h.stage === STAGES[s].id).slice(-W);
        if (recent.length < W) break;
        // topDel, not avgDel — see the note where it is computed.
        const m = recent.reduce((a, h) => a + (h.topDel != null ? h.topDel : h.avgDel), 0) / recent.length;
        if (m >= STAGES[s].advance) stage = STAGES[s + 1].id; else break;
    }
    return STAGES[stage - 1];
}

/* ===================================================== THE MISSION BANK
 *
 * A mission is an (instruction, scene, noise) triple, and each stage has a
 * FIXED bank of them that is built once and never redrawn. Generation g runs a
 * sliding window over that bank, so consecutive generations share most of their
 * exam and every mission comes round again within `bank` generations.
 *
 * This is not a detail. The original version drew fresh instructions AND fresh
 * scene seeds every generation, and the population never learned: 180
 * generations of four mutation settings all sat at a fleet mean of ~0.01 balls
 * per episode. The reason was measured directly (probe_learnability.js): with
 * the pointer heads pinned and ONE fixed scene, a plain (1+1) hill climb learns
 * the entire pick-and-place — first grasp at evaluation 74, first delivery at
 * 1,664. The skill is easily representable. It just needs on the order of a
 * thousand evaluations against a STATIONARY objective to be found.
 *
 * A GA that redraws the exam every generation gives it 60. A brain that got
 * better at generation g's scene is re-examined on a different scene at g+1,
 * where the improvement may be worth nothing, so progress cannot compound. The
 * fitness curve looks like a hard search problem; it is actually a
 * non-stationary one, and the two look identical from the outside.
 *
 * The bank widens with the curriculum: stage 1 is four missions (near enough to
 * a fixed objective for the motor loop to be learned at all), the last stage is
 * forty-eight. Overfitting to a fixed bank is a real risk and it is exactly
 * what the held-out exam exists to catch — that runs unseen phrasings on unseen
 * scene seeds. */
const _bankCache = new Map();

function missionBank(stage, split) {
    const key = `${stage.id}:${split || "train"}`;
    if (_bankCache.has(key)) return _bankCache.get(key);
    const pool = TASKS.filter(t => {
        if (t.split !== (split || "train")) return false;
        if (stage.kinds && !stage.kinds.includes(t.kind)) return false;
        if (t.kind === "SORT" && t.params.colors.length > stage.maxColors) return false;
        return true;
    });
    if (!pool.length) throw new Error(`no ${split || "train"} tasks match stage ${stage.id}`);
    const rng = mulberry32(0xB0A7 + stage.id * 104729);
    const bank = [];
    const usedSpec = new Set();
    for (let i = 0; i < stage.bank; i++) {
        // spread across distinct goal specs before repeating any
        let t = null;
        for (let a = 0; a < 60; a++) {
            const c = pool[(rng() * pool.length) | 0];
            if (!usedSpec.has(c.specIdx) || a > 40) { t = c; break; }
        }
        if (!t) t = pool[(rng() * pool.length) | 0];
        usedSpec.add(t.specIdx);
        if (usedSpec.size >= pool.length) usedSpec.clear();
        // The scene travels WITH the instruction. A mission has to be the same
        // problem every time it comes round, or the bank is not stationary in
        // the way the argument above needs.
        bank.push({ task: t, sceneSeed: 1 + i * 977, noiseSeed: 5000 + i * 131 });
    }
    _bankCache.set(key, bank);
    return bank;
}

/* This generation's block of missions. Every brain runs every mission in the
 * block, so the block IS the exam and it is identical for the whole fleet. */
function drawMissions(stage, gen, count, split) {
    const bank = missionBank(stage, split);
    // An episode count of zero (or NaN, from a slider that never initialised)
    // would hand main.js an empty list and surface much later as "task is
    // undefined" inside the embedding lookup.
    count = Math.max(1, count | 0);
    const out = [];
    // Sliding window: gen 1 takes 0..3, gen 2 takes 1..4. Stepping by `count`
    // instead would give neighbouring generations DISJOINT exams, which is the
    // same non-stationarity in a different costume.
    for (let i = 0; i < count; i++) out.push(bank[(gen - 1 + i) % bank.length]);
    return out;
}

/* Back-compat shim: the tests and the UI still ask for plain tasks. */
function drawTasks(stage, gen, count, split) {
    return drawMissions(stage, gen, count, split).map(m => m.task);
}

if (typeof module !== "undefined") module.exports = { Evolution, STAGES, stageFor, drawTasks, drawMissions, missionBank };
