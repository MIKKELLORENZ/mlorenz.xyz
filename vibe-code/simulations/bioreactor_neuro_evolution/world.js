/* world.js — one episode: a population of reactors running the same batch,
 * side by side, plus the two baselines running it too.
 *
 * FAIRNESS. Every reactor in a generation gets the same scenario (same
 * product ordered, same cell line, same inoculum, same lots, same failures at
 * the same hours), the same process-noise stream and the same sensor-noise
 * stream. The only thing that differs between two of them is the controller.
 * Ranking then measures the controller, not the luck.
 *
 * SCORE. Terminal, at harvest:
 *
 *     100 × (product cells / cells seeded) × purity² × viability
 *         × functional quality × pluripotent-residual penalty
 *
 * minus what was spent (media, reagents, base, glucose) and minus a small
 * per-hour shaping term for a reactor held outside its physiological bands.
 * A lost culture ends the episode and scores −60 plus whatever shaping had
 * accrued.
 *
 * "Product cells" and "purity" are the lineage's own definitions (lineages.js:
 * the mature stage plus the immature one at whatever an immature one is
 * worth), and "functional quality" is its own assay — beating, spontaneous
 * firing, insulin in answer to glucose, tubules, CYP activity. A vessel full
 * of insulin-positive cells that do not respond to a glucose challenge is not
 * a vessel of β cells, and the score has to know that or the search will make
 * exactly that mistake.
 *
 * Fitness is the ADVANTAGE between the neutral reactor (alive, fed, no cues —
 * what a fresh network commands) and the SOP on the same batch:
 *
 *     advantage = (brain − neutral) / max(30, SOP − neutral)
 *
 * so 0 is "achieved nothing" and 1 is "as good as the protocol", on every
 * batch of every lineage, whatever the batch did to the protocol. Without
 * that normalisation the five protocols could not be trained together at all:
 * a cardiac batch scores in the hundreds and a hepatic one in the tens, and
 * the search would simply stop making hepatocytes. The floor on the
 * denominator stops a scenario that wrecks the SOP from turning one brain's
 * modest result into a fitness of forty.
 */
"use strict";

const FAIL_SCORE = -60;
const ADV_FLOOR = 30;
/* Score units a protocol's own reagents are allowed to cost. Every lineage's
 * published cue schedule is normalised to this (lineages.js `ref.reagent`),
 * because the raw bills are not remotely comparable: two doses of a small
 * molecule against twenty-seven days of growth factors topped up against a
 * ten-hour half-life is a factor of forty-five, and charging that literally
 * put four of the five protocols BELOW the do-nothing reactor. The
 * controller still pays more for using more than its protocol does, which is
 * the pressure that was wanted; it simply is not charged for the lineage it
 * was handed. */
const REAGENT_BUDGET = 8;

function shapingPenalty(r) {
    let p = 0;
    const pH = r.pH;
    if (pH < 7.0) p += Math.min(1, Math.pow((7.0 - pH) / 0.2, 2));
    if (pH > 7.5) p += Math.min(1, Math.pow((pH - 7.5) / 0.2, 2));
    if (r.DO < 15) p += Math.min(1, Math.pow((15 - r.DO) / 10, 2));
    if (r.lac > 25) p += Math.min(1, Math.pow((r.lac - 25) / 10, 2));
    if (r.osm > 370) p += Math.min(1, Math.pow((r.osm - 370) / 20, 2));
    // aggregates: each lineage has a band it wants to be in, and for the
    // kidney organoids the band is high — this term is the only place in the
    // scoring that knows the difference
    const band = r.lin.agg.band;
    if (r.d > band[1] * 1.4) p += Math.min(1, Math.pow((r.d - band[1] * 1.4) / 100, 2));
    return 0.05 * p;
}

/* MEASURED AGAINST WHAT THIS PRODUCT CAN BE, not against cardiomyocytes.
 *
 * The first version of this was absolute: 100 × fold × purity² × viability.
 * That is a fine scale for one protocol and a broken one for five, because
 * purity² is quadratic in a ceiling that differs by a factor of two between
 * them. A kidney organoid with a third of its cells in nephron structures is
 * a SUCCESSFUL batch — that is what the papers report — but 0.30² is a ninth
 * of 0.70², so the terminal value came out in single digits, the reagent bill
 * dwarfed it, and the protocol scored two hundred points below a reactor
 * nobody touched. The fitness zero has to be alive and useless; it must not
 * be better than the protocol.
 *
 * So each lineage names what a good batch of its own product looks like
 * (lineages.js `ref`) and the score is the ratio. A protocol-quality run of
 * any of the five scores about 100, doing nothing scores about 0, and the
 * quadratic still bites: half the reference purity is a quarter of the score.
 * The ratios are capped so that one freak batch cannot buy a generation. */
function terminalScore(r) {
    const Nv = r.Nv;
    if (r.failed || Nv < 1e-6) return { term: FAIL_SCORE, fold: 0, purity: 0, viability: 0, residual: 0, func: 0 };
    const ref = r.lin.ref;
    const prod = r.product;
    const fold = prod / r.scn.seedDensity;
    const purity = prod / Nv;
    const viability = r.viability;
    const residual = r.N[0] / Nv;
    const resPenalty = 1 - hill(residual, 0.03, 2);
    const func = r.funcValue();
    const fq = Math.min(2.5, fold / ref.fold);
    const pq = Math.min(2.0, purity / ref.purity);
    const uq = ref.func > 0.01 ? Math.min(1.5, func / ref.func) : 1;
    return {
        term: 100 * fq * pq * pq * viability * resPenalty * (0.6 + 0.4 * uq),
        fold, purity, viability, residual, func
    };
}

/* What the batch cost, in the same units as what it is worth. Media, base and
 * glucose are charged as they are — a volume of medium is a volume of medium —
 * and the cue bill is normalised to the lineage's own published schedule. */
function batchCost(r) {
    const c = r.cost;
    return c.medium + c.base + c.glc + REAGENT_BUDGET * c.cue / r.lin.ref.reagent;
}

class Unit {
    constructor(scn, brain, controller, seed) {
        this.brain = brain;                     // Net, or null when a scripted controller drives
        this.ctrl = controller || null;
        this.r = new Reactor(scn, mulberry32(seed + 1));
        this.lab = new Lab(scn, mulberry32(seed + 2));
        this.obs = new Float32Array(N_IN);
        this.shaping = 0;
        this.act = neutralAction();
        this.act.rpm = 60;
        this.done = false;
        this.result = null;
        if (this.ctrl && this.ctrl.reset) this.ctrl.reset();
    }

    /* One control tick at hour t. */
    step(t) {
        if (this.done) return;
        const r = this.r;
        r.dist = disturbancesAt(r.scn, t);
        this.lab.readOnline(r, t);
        this.lab.sample(r, t);
        let act;
        if (this.brain) {
            observe(this.lab, r, t, this.obs);
            act = decodeAction(this.brain.forward(this.obs), this.act, r.lin);
        } else {
            act = this.ctrl.step(this.lab, r, t);
        }
        this.lab.noteAction(act, t);
        this.act = act;
        r.tick(act);
        this.shaping += shapingPenalty(r);
        if (r.failed || r.t >= r.hours - 1e-6) this.finish();
    }

    finish() {
        this.done = true;
        const r = this.r;
        const ts = terminalScore(r);
        const cost = batchCost(r);
        const score = ts.term - cost - this.shaping;
        this.result = Object.assign({
            score, cost, rawCost: r.cost.total, shaping: this.shaping, failed: r.failed, failReason: r.failReason,
            productPerML: r.product, maturePerML: r.mature, viable: r.Nv, aggD: r.d, t: r.t,
            lin: r.lin.key
        }, ts);
    }
}

class World {
    /* brains: Net[]; opts: {seed, level, lin, withBaselines (default true), trace} */
    constructor(brains, opts) {
        this.opts = opts || {};
        const seed = (this.opts.seed | 0);
        this.level = this.opts.level | 0;
        this.scn = makeScenario(seed, this.level, this.opts.lin != null ? this.opts.lin : null);
        this.lin = this.scn.lin;
        this.hours = this.scn.hours;
        const uSeed = seed * 7919 + 13;
        this.units = brains.map(b => new Unit(this.scn, b, null, uSeed));
        const wb = this.opts.withBaselines !== false;
        this.sop = wb ? new Unit(this.scn, null, new SOPController(this.lin), uSeed) : null;
        this.neutral = wb ? new Unit(this.scn, null, new NeutralController(), uSeed) : null;
        this.nothing = wb && this.opts.withNothing !== false ? new Unit(this.scn, null, new DoNothingController(), uSeed) : null;
        this.t = 0;
        this.trace = this.opts.trace ? [] : null;
    }

    get all() {
        const a = this.units.slice();
        if (this.sop) a.push(this.sop);
        if (this.neutral) a.push(this.neutral);
        if (this.nothing) a.push(this.nothing);
        return a;
    }

    step() {
        for (const u of this.all) u.step(this.t);
        if (this.trace) {
            this.trace.push({
                t: this.t, units: this.units.map(u => u.r.snapshot()),
                sop: this.sop ? this.sop.r.snapshot() : null,
                neutral: this.neutral ? this.neutral.r.snapshot() : null,
                nothing: this.nothing ? this.nothing.r.snapshot() : null
            });
        }
        this.t += TICK;
    }

    isOver() { return this.all.every(u => u.done); }

    run() { while (!this.isOver()) this.step(); return this; }

    /* Per-unit results with the advantage attached. */
    results() {
        const s0 = this.neutral ? this.neutral.result.score : 0;
        const s1 = this.sop ? this.sop.result.score : 100;
        const den = Math.max(ADV_FLOOR, s1 - s0);
        return this.units.map(u => Object.assign({ brain: u.brain, advantage: (u.result.score - s0) / den }, u.result));
    }
    baselineResults() {
        return {
            sop: this.sop ? this.sop.result : null, neutral: this.neutral ? this.neutral.result : null,
            nothing: this.nothing ? this.nothing.result : null
        };
    }

    get leaderIdx() {
        let best = 0, bs = -1e18;
        this.units.forEach((u, i) => {
            const s = u.done ? u.result.score : (u.r.product * 100 - u.shaping);
            if (s > bs) { bs = s; best = i; }
        });
        return best;
    }
}

/* Run one controller through one scenario and hand back the whole trace. */
function runEpisode(brain, opts) {
    const w = new World(brain ? [brain] : [], Object.assign({ trace: true }, opts || {}));
    w.run();
    return { world: w, results: w.results(), baselines: w.baselineResults(), trace: w.trace };
}

if (typeof module !== "undefined") {
    module.exports = { World, Unit, runEpisode, terminalScore, batchCost, shapingPenalty, FAIL_SCORE, ADV_FLOOR, REAGENT_BUDGET };
}
