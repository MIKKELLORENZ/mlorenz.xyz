/* bioreactor.js — the plant. A 100 mL stirred suspension bioreactor running a
 * directed differentiation of human pluripotent stem cells.
 *
 * WHICH differentiation is not in this file. The cells are a chain of stages
 * with cue-gated transitions, and the chain, the cues, the media and the run
 * length all come from a LINEAGE (lineages.js) that the batch was ordered
 * with. Everything here is a MECHANISM shared by all of them: mass balances
 * for the metabolites, bicarbonate chemistry for the pH, a kLa for the
 * oxygen, aggregate fusion and breakup, and a Thiele-modulus core that
 * decides how much of each aggregate can breathe. MODEL.md lists every
 * simplification by name.
 *
 * Units, everywhere:
 *   time            hours              cells         M/mL  (1e6 cells per mL)
 *   metabolites     mM                 aggregates    k/mL  (1e3 aggregates per mL)
 *   DO              % air saturation   small molecules µM, proteins ng/mL
 *   specific rates  pmol/cell/h  — and M/mL × pmol/cell/h = mM/h, which is why
 *                   these two units were chosen.
 */
"use strict";

const DT = 0.1;             // physics substep, h
const TICK = 1.0;           // control step, h
const HOURS_MAX = 792;      // the longest protocol (β cells, 33 days)
const V0 = 0.1;             // working volume, L
const O2_SAT = 0.20;        // mM dissolved O2 at 100 % air saturation, 37 °C
const CO2_SOL = 0.0307;     // mM dissolved CO2 per mmHg
const P_ATM = 760;

/* ---------------------------------------------------------------- helpers */
function hill(x, k, n) {
    if (x <= 0) return 0;
    const a = Math.pow(x, n), b = Math.pow(k, n);
    return a / (a + b);
}
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

/* ------------------------------------------------------------- actuators */
/* What the controller can touch, one set per control tick. Six process knobs,
 * six dosing pumps and a choice of three media — the same sixteen numbers
 * whatever the lineage, because a bioreactor does not grow extra pumps when
 * you change the protocol. Which reagent is in pump 3 is part of the batch.
 *
 * Both the neural controller and the scripted protocol produce exactly this
 * object, so the comparison between them is a comparison of decisions, never
 * of plumbing. */
const ACT_BASE = [
    { key: "o2", label: "O₂ in gas", lo: 0, hi: 0.5, neutral: 0.21, unit: "", pct: true },
    { key: "co2", label: "CO₂ in gas", lo: 0, hi: 0.10, neutral: 0.05, unit: "", pct: true },
    { key: "base", label: "base pump", lo: 0, hi: 2.0, neutral: 0, unit: "mM/h" },
    { key: "rpm", label: "agitation", lo: 20, hi: 120, neutral: 70, unit: "rpm" },
    { key: "perf", label: "perfusion", lo: 0, hi: 2.0, neutral: 0.7, unit: "vol/day" },
    { key: "glcFeed", label: "glucose feed", lo: 0, hi: 1.5, neutral: 0, unit: "mM/h" }
];
const N_BASE = ACT_BASE.length;                 // 6
const N_OUT = N_BASE + N_CUE + N_MED;           // 6 + 6 + 3 = 15
const RPM_SLEW = 20;                            // rpm per tick — a stirrer is not a switch

/* The actuator table for one lineage: the six process knobs, then its own
 * reagents in the dosing channels, then the medium selector. Unused channels
 * are still listed (greyed out on the page) because the network still has
 * those outputs and it is worth seeing that it has learned to leave them
 * alone. */
function actSpec(L) {
    const out = ACT_BASE.slice();
    for (let i = 0; i < N_CUE; i++) {
        const c = L.cues[i];
        out.push(c
            ? { key: "cue" + i, cue: i, label: c.short, full: c.label, lo: 0, hi: c.hi, neutral: 0, unit: c.unit }
            : { key: "cue" + i, cue: i, label: "—", full: "not used by this protocol", lo: 0, hi: 1, neutral: 0, unit: "", unused: true });
    }
    out.push({ key: "medium", label: "feed medium", lo: 0, hi: N_MED - 1, neutral: 0, unit: "" });
    return out;
}

/* tanh outputs → actuator object. Zero output is the NEUTRAL setting: air with
 * 5 % CO₂, 70 rpm, 0.7 vol/day of the differentiation basal, no base, no
 * feeds, no cues. A brand new brain therefore runs a perfectly sensible,
 * perfectly useless reactor, and survives long enough to be told apart from
 * every other new brain. */
function decodeAction(out, prev, L) {
    const a = {
        o2: clamp(0.21 + 0.30 * out[0], 0, 0.5),
        co2: clamp(0.05 + 0.05 * out[1], 0, 0.10),
        base: Math.max(0, out[2]) * 2.0,
        rpm: clamp(70 + 50 * out[3], 20, 120),
        perf: clamp(0.7 + 1.3 * out[4], 0, 2.0),
        glcFeed: Math.max(0, out[5]) * 1.5,
        cue: new Float64Array(N_CUE),
        medium: 0
    };
    for (let i = 0; i < N_CUE; i++) {
        const spec = L.cues[i];
        a.cue[i] = spec ? Math.max(0, out[N_BASE + i]) * spec.hi : 0;
    }
    // medium: argmax of the three logits, ties to the differentiation basal
    let bi = 0;
    const m0 = N_BASE + N_CUE;
    for (let i = 1; i < N_MED; i++) if (out[m0 + i] > out[m0 + bi] + 1e-6) bi = i;
    a.medium = bi;
    if (prev) a.rpm = clamp(a.rpm, prev.rpm - RPM_SLEW, prev.rpm + RPM_SLEW);
    return a;
}
function neutralAction() {
    return { o2: 0.21, co2: 0.05, base: 0, rpm: 70, perf: 0.7, glcFeed: 0, cue: new Float64Array(N_CUE), medium: 0 };
}
function cloneAction(a) {
    const b = Object.assign({}, a);
    b.cue = Float64Array.from(a.cue);
    return b;
}

/* ----------------------------------------------------------- the reactor */
class Reactor {
    /* scn: a scenario from scenarios.js (which lineage, seed density, cell
     * line, lots, events). rng: process-noise stream. Every reactor in a
     * generation gets the same seed, so the only difference between two of
     * them is their controller. */
    constructor(scn, rng) {
        this.scn = scn;
        this.rng = rng || (() => 0.5);
        this.lin = scn.lin;
        this.line = scn.line;
        this.nc = this.lin.nc;
        this.nStage = this.lin.nStage;
        this.OFF = this.lin.OFF;
        this.hours = scn.hours;
        this.reset();
    }

    reset() {
        const s = this.scn, L = this.lin;
        const fill = L.media[1];              // the vessel is filled with expansion medium
        this.t = 0;
        this.N = new Float64Array(this.nc);
        this.N[0] = s.seedDensity;            // single pluripotent cells, M/mL
        this.dead = 0;                        // dead cells still intact, M/mL
        this.A = 0;                           // aggregates, k/mL — forms over the first hours
        this.aggFormed = false;
        this.glc = fill.glc; this.lac = 0; this.gln = fill.gln; this.nh4 = 0;
        this.hco3 = fill.hco3; this.osm = fill.osm; this.pluriMed = 1; this.gmaxMed = fill.gmax ? 1 : 0;
        this.co2 = CO2_SOL * 0.05 * P_ATM;    // equilibrated with 5 % CO₂
        this.DO = 60;                          // % air sat; a freshly filled vessel
        this.T = 37;
        this.cue = new Float64Array(N_CUE);           // vessel concentration per channel
        this.cueEff = new Float64Array(N_CUE);        // what the cells actually feel
        this.cueExposure = new Float64Array(N_CUE);   // units·h, for the record
        /* SIGNAL-HOURS, per channel. Some decisions depend on how LONG a
         * signal has been on rather than how strong it is — the length of the
         * CHIR pulse is what sets how far back along the primitive streak a
         * kidney cell ends up, and a Wnt pulse held for three days instead of
         * one turns definitive endoderm into mesoderm. A cell committing at
         * hour t reads this counter as it stands at hour t, which is why a
         * protocol cannot fix a fate decision after the fact.
         *
         * Accumulated in PROPORTION to the signal, not above a threshold.
         * Counting whole hours above the line looked simpler and was
         * treacherous: the kidney protocol's 7 µM of CHIR falls to about
         * 3.6 µM of effective dose once the aggregates reach 400 µm, which is
         * right on top of a 3.15–3.85 µM line-dependent EC50, so a slightly
         * insensitive line stopped counting abruptly and the whole batch
         * changed identity. The median score of that protocol moved by a
         * factor of two and a half between two banks of fifteen batches.
         * Hard thresholds on quantities that sit at the threshold do not
         * belong in a plant model. */
        this.cueHours = new Float64Array(N_CUE);
        /* TRAILING PRESENCE, per channel, about a two-day time constant. Two
         * published facts need "has this cue been ABSENT lately", which
         * neither counter above can express because both only ever go up: the
         * beta-cell maturation stage has to be factor-free (taking ALK5i and
         * T3 out is what raises insulin secretion, at an unchanged C-peptide+
         * fraction), and FGF9 has to come out of the kidney run before the
         * nephron progenitors will differentiate. Read instantaneously, a
         * controller could shut the pump in the last hour of the run and
         * collect the credit; read over two days, it cannot. */
        this.cueRecent = new Float64Array(N_CUE);
        this.rocki = 10;                              // ROCK inhibitor at seeding, universal
        this.act = neutralAction();
        this.act.rpm = 60;
        // costs and bookkeeping
        this.cost = { medium: 0, cue: 0, base: 0, glc: 0, total: 0 };
        this.cueCost = new Float64Array(N_CUE);
        this.volumesFed = 0;
        this.failed = false; this.failReason = null;
        // derived, refreshed every substep
        this.d = 0; this.fCore = 0; this.pH = 7.4; this.OUR = 0; this.CER = 0; this.kla = 0;
        /* The last substep's fate decisions, kept for the instruments rather
         * than for the physics: kOut[i] is how fast cells are leaving stage i
         * and qRight[i] is the fraction of them arriving where the protocol
         * intended. Calibrating a lineage is reading this table — a step
         * sitting at q = 0.5 under the correct protocol will never compound to
         * a pure culture, however good every other step is. */
        this.kOut = new Float64Array(this.nc);
        this.qRight = new Float64Array(this.nc);
        this.info = { wnt: 0, label: "" };
        this.dist = { gasOK: true, pumpOK: true, rpmOverride: null, tempSet: 37, active: [] };
        this._deathTally = new Float64Array(8);   // which death channel took the cells: for forensics
        this._ec = new Float64Array(N_CUE);
        for (let i = 0; i < N_CUE; i++) this._ec[i] = L.cues[i] ? L.cues[i].ec50 * this.line.cueEC50[i] : 1;
        this._updateDerived();
    }

    get Nv() { let s = 0; for (let i = 0; i < this.nc; i++) s += this.N[i]; return s; }
    get viability() { const v = this.Nv; return v + this.dead > 1e-9 ? v / (v + this.dead) : 0; }
    fraction(i) { const v = this.Nv; return v > 1e-9 ? this.N[i] / v : 0; }
    /* The product of this batch, per mL, and how pure the vessel is. One
     * definition, used by the score, the page and every analysis. */
    get product() { return productOf(this.lin, this.N); }
    get mature() { return this.N[this.lin.matureIdx]; }
    get purity() { const v = this.Nv; return v > 1e-9 ? this.product / v : 0; }

    /* Mean aggregate diameter (µm) from cells per aggregate and cell volumes at
     * 70 % packing. The number that matters most is not the diameter, it is
     * the fraction of aggregate volume that lies deeper than oxygen reaches.
     *
     * r_crit = sqrt(6·D·C / q_vol) is the classic Thiele result for a sphere
     * with zero-order consumption. With D, the cell packing and the unit
     * conversions folded into one constant it reads r_crit = K·sqrt(DO/q),
     * with DO as a fraction of air saturation and q in pmol/cell/h. K = 92 µm
     * was CHOSEN so that a pluripotent aggregate at 40 % DO goes hypoxic in the
     * core above ~520 µm and a cardiomyocyte aggregate above ~340 µm — the
     * band the literature reports for necrotic cores. A neuron or a hepatocyte
     * breathes harder still, and suffocates smaller; that falls out of its own
     * oxygen demand rather than being a separate rule. */
    _updateDerived() {
        const Nv = this.Nv, S = this.lin.stages;
        if (this.A > 1e-6 && Nv > 1e-9) {
            let vol = 0, q = 0;
            for (let i = 0; i < this.nc; i++) { vol += this.N[i] * S[i].vol; q += this.N[i] * S[i].qO2; }
            const Vagg = 1e3 * vol / this.A / 0.7;            // µm³ per aggregate
            this.d = Math.cbrt(6 * Vagg / Math.PI);
            const qMean = q / Nv;
            const rCrit = 92 * Math.sqrt(Math.max(0.5, this.DO) / 100 / qMean);
            const r = this.d / 2;
            this.fCore = r > rCrit ? Math.pow((r - rCrit) / r, 3) : 0;
        } else { this.d = 12; this.fCore = 0; }
        this.pH = 6.1 + Math.log10(Math.max(1.0, this.hco3) / Math.max(0.05, this.co2));
    }

    /* One control tick: apply the actuators, then TICK/DT substeps. */
    tick(act) {
        const L = this.lin;
        // actuator plumbing: slew on rpm, disturbances override
        act.rpm = clamp(act.rpm, this.act.rpm - RPM_SLEW, this.act.rpm + RPM_SLEW);
        this.act = act;
        // dosing pumps: top up to the target, pay for what was added
        for (let i = 0; i < N_CUE; i++) {
            const spec = L.cues[i];
            if (!spec) continue;
            const target = act.cue[i];
            if (target > this.cue[i] + 0.005 * spec.hi) {
                const add = target - this.cue[i];
                this.cue[i] += add;
                const c = spec.cost * add / spec.ec50;      // cost per EC50-worth of reagent
                this.cueCost[i] += c;
                this.cost.cue += c;
            }
        }
        const n = Math.round(TICK / DT);
        for (let k = 0; k < n && !this.failed; k++) this._sub(DT);
        this.cost.total = this.cost.medium + this.cost.cue + this.cost.base + this.cost.glc;
        return this;
    }

    _sub(dt) {
        const a = this.act, s = this.scn, L = this.lin, line = this.line, dist = this.dist;
        const S = L.stages, nc = this.nc, nS = this.nStage, OFF = this.OFF;
        const rpm = dist.rpmOverride != null ? dist.rpmOverride : a.rpm;
        const perf = dist.pumpOK ? a.perf : 0;
        const D = perf / 24;                                   // /h
        const feed = L.media[a.medium];
        const N = this.N;
        const Nv = this.Nv;

        // ---- temperature: a heater loop with a 30-minute time constant ----
        this.T += (dist.tempSet - this.T) * (1 - Math.exp(-dt / 0.5));
        const tempF = this.T <= 37 ? Math.pow(2.5, (this.T - 37) / 10) : 1;
        const heatDeath = this.T > 37 ? 0.02 * hill(this.T - 37, 1.8, 4) : 0;

        // ---- what the cells feel of each dosed molecule ----
        // The dose in the vessel is not the dose at the cell: it is diluted by
        // how many cells are sharing it and by how far it has to diffuse into
        // an aggregate, and a protein suffers far more of both than a small
        // molecule does. The lot potency is hidden from the controller.
        const cEff = this.cueEff;
        for (let i = 0; i < N_CUE; i++) {
            const spec = L.cues[i];
            if (!spec) { cEff[i] = 0; continue; }
            const k = CUE_KINDS[spec.kind];
            cEff[i] = this.cue[i] * s.lots.cuePotency[i]
                / Math.pow(1 + Nv / 4, k.dilExp)
                / Math.pow(1 + Math.pow(this.d / 500, 2), k.penExp);
        }

        // ---- environment factors ----
        const fLac = 1 / (1 + Math.pow(this.lac / (30 * line.lacTol), 2));
        const fNH4 = 1 / (1 + Math.pow(this.nh4 / 4, 2));
        const fpH = Math.exp(-Math.pow((this.pH - 7.3) / 0.35, 2));
        const fDO = this.DO / (this.DO + 3);
        const fSize = 1 / (1 + Math.pow(this.d / 600, 3));
        /* A suspension culture does not grow for ever. Real stirred hPSC and
         * progenitor cultures plateau somewhere between 2 and 5 M/mL whatever
         * you feed them — the cells run out of room in their aggregates, and
         * what limits them is not any single metabolite in this model. Without
         * this term the OFF-TARGET compartment compounds for thirty-three days
         * and no protocol can be pure at the end of a long run; with it the
         * vessel fills up and the question becomes what it fills up WITH,
         * which is the question the controller is being asked.
         *
         * (TUNED: 6.5 M/mL, cubic. At 5 M/mL it cost the calibrated cardiac
         * run a sixth of its yield and pushed it below the 1 M/mL floor the
         * literature band and the regression suite both use.) */
        const fDens = 1 / (1 + Math.pow(this.Nv / 6.5, 3));
        const env = fLac * fNH4 * fpH * fDO * tempF;
        const envHalf = Math.sqrt(env);
        const fGlc = this.glc / (this.glc + 0.3);
        const fed = hill(this.glc, 0.5, 2);
        // a cell that has learned to burn lactate has a second fuel
        const altFuel = this.glc + 0.5 * this.lac;
        const fFuelAlt = altFuel / (altFuel + 0.3);

        // ---- the lineage's own biology ----
        const ctx = {
            c: cEff, ec: this._ec, exposure: this.cueExposure, hours: this.cueHours,
            N, Nv, nStage: nS, frac: (i) => Nv > 1e-9 ? N[i] / Nv : 0,
            glc: this.glc, lac: this.lac, gln: this.gln, nh4: this.nh4,
            DO: this.DO, pH: this.pH, d: this.d, fCore: this.fCore, T: this.T,
            env, envHalf, fed, fGlc, pluriMed: this.pluriMed,
            t: this.t, day: this.t / 24, line, medium: a.medium, med: feed
        };
        const dyn = L.dyn(ctx);
        this.info = dyn.info || this.info;
        for (let i = 0; i < nS; i++) {
            const fwd = i < nS - 1 ? Math.max(0, dyn.kStep[i] || 0) : 0;
            const off = Math.max(0, dyn.kOff[i] || 0);
            this.kOut[i] = fwd + off;
            this.qRight[i] = fwd + off > 1e-12 ? fwd / (fwd + off) : 0;
        }

        // ---- death channels ----
        // Shared: negligible shear below ~90 rpm and ~4 %/day at 110, worse for
        // big aggregates; a suffocating core; lactate and ammonia; pH; too
        // little or too much oxygen; the dissociation stress of seeding,
        // softened by the ROCK inhibitor. Per stage: how fragile it is to
        // shear, how well it tolerates starvation, and whatever its own cues
        // are doing to it.
        const kShear = 0.015 * hill(rpm, 120, 6) * Math.pow(this.d / 250, 1.5);
        const kCore = 0.06 * this.fCore;
        const kLacTox = 0.006 * hill(this.lac, 40 * line.lacTol, 4);
        const kNH4Tox = 0.004 * hill(this.nh4, 6, 3);
        const kpH = 0.012 * hill(Math.abs(this.pH - 7.3), 0.6, 4);
        const kHypox = this.DO < 5 ? 0.03 * (1 - this.DO / 5) : 0;
        const kHyperox = 0.004 * hill(this.DO, 120, 4);
        const kSeed = 0.04 * Math.exp(-this.t / 12) * (1 - 0.7 * hill(this.rocki, 3, 2));
        /* The 0.002/h attrition floor is the vessel's baseline unkindness,
         * and charging it equally to every stage was wrong over a long run.
         * Across 792 hours it removes four fifths of a compartment, and the
         * compartment it punished hardest was the one that ought to be the
         * HARDIEST thing in the tank: a post-mitotic product cell sitting in
         * its own maintenance medium. The beta-cell pool peaked on day 21 and
         * decayed to two thirds of that by day 33, so the glucose response
         * fell from 0.78 to 0.66 - while every paper on stage 6 says it HOLDS
         * the C-peptide+ fraction and improves its function over two to three
         * weeks. Per-stage `att` (default 1) says what that floor is worth to
         * each cell type. Applied only where a measurement contradicts the
         * literature; the calibrated lineages keep 1. */
        const kFloor = 0.002;
        const kCommon = kCore + kLacTox + kNH4Tox + kpH + kHypox + kHyperox + kSeed + heatDeath;
        const kStarveGlc = 0.03 * (1 - hill(this.glc, 0.3, 2));
        const kStarveAlt = 0.03 * (1 - hill(altFuel, 0.3, 2));

        // ---- growth, transitions, death ----
        const mu = new Float64Array(nc), kd = new Float64Array(nc);
        for (let i = 0; i < nc; i++) {
            const st = S[i];
            let g = st.mu * line.muScale * env * fSize * fDens;
            g *= st.fuel === "glcLac" ? fFuelAlt : fGlc;
            if (i === 0) g *= 0.4 + 0.6 * this.pluriMed;      // no FGF2/TGFβ, slower and drifting
            /* PROGENITOR PROLIFERATION IS DRIVEN TOO, and leaving it out
             * was the worst error in this file. A stage whose instructive
             * signal has gone does not merely stop ADVANCING - it stops
             * dividing. Without this, a mid-chain pool stranded when its
             * driver was withdrawn kept doubling every fifty hours in
             * factor-free maturation medium and became the LARGEST
             * population in the vessel: the beta-cell gut tube ran
             * 0.15 -> 0.45 M/mL over the last twelve days while the product
             * fell 0.36 -> 0.28, so purity lost eight points for every extra
             * week of a CORRECT protocol. The off-target growth rate was
             * innocent - sweeping it 3.3x moved purity not at all - and the
             * same signature is visible in the hepatic run (endoderm doubles
             * after Activin comes out) and the kidney one.
             *
             * The plant stays generic: a lineage returns `prolif` from dyn()
             * alongside kStep/kOff/kBack/tox, and the default is 1. */
            if (dyn.prolif && dyn.prolif[i] !== undefined) g *= dyn.prolif[i];
            mu[i] = g;
            const starve = st.fuel === "glcLac" ? kStarveAlt : kStarveGlc;
            kd[i] = st.att * kFloor + kCommon + st.shear * kShear + st.starve * starve + (dyn.tox && dyn.tox[i] ? dyn.tox[i] : 0);
        }

        const dN = new Float64Array(nc);
        for (let i = 0; i < nS; i++) {
            const fwd = i < nS - 1 ? Math.max(0, dyn.kStep[i] || 0) : 0;
            const back = dyn.kBack && i > 0 ? Math.max(0, dyn.kBack[i] || 0) : 0;
            const off = Math.max(0, dyn.kOff[i] || 0);
            dN[i] += N[i] * (mu[i] - kd[i] - fwd - back - off);
            if (fwd > 0) dN[i + 1] += N[i] * fwd;
            if (back > 0) dN[i - 1] += N[i] * back;
            dN[OFF] += N[i] * off;
        }
        dN[OFF] += N[OFF] * (mu[OFF] - kd[OFF]);
        let died = 0;
        for (let i = 0; i < nc; i++) died += N[i] * kd[i];
        // forensics: which channel is killing cells
        const tal = this._deathTally;
        tal[0] += Nv * kShear * dt; tal[1] += Nv * kCore * dt; tal[2] += Nv * (kLacTox + kNH4Tox) * dt;
        tal[3] += Nv * kpH * dt; tal[4] += Nv * (kHypox + kHyperox) * dt; tal[5] += Nv * kSeed * dt;
        let toxDeaths = 0, starveDeaths = 0;
        for (let i = 0; i < nc; i++) {
            toxDeaths += N[i] * (dyn.tox && dyn.tox[i] ? dyn.tox[i] : 0);
            starveDeaths += N[i] * S[i].starve * (S[i].fuel === "glcLac" ? kStarveAlt : kStarveGlc);
        }
        tal[6] += toxDeaths * dt; tal[7] += starveDeaths * dt;

        // ---- metabolism (M/mL × pmol/cell/h = mM/h) ----
        let rGlc = 0, rLacProd = 0, rGln = 0, OUR = 0, rLacUp = 0;
        const eat = tempF * (0.3 + 0.7 * env);               // stressed cells eat less
        for (let i = 0; i < nc; i++) {
            const st = S[i];
            const g = N[i] * st.qGlc * fGlc * eat;
            rGlc += g; rLacProd += g * st.ylac;
            rGln += N[i] * st.qGln * (this.gln / (this.gln + 0.2)) * eat;
            OUR += N[i] * st.qO2 * fDO * eat;
            // the stages that can burn lactate do so when glucose is short
            if (st.fuel === "glcLac") rLacUp += N[i] * 0.05 * (this.lac / (this.lac + 1)) / (1 + this.glc / 1.0) * tempF;
        }
        OUR += rLacUp * 1.5;
        const rLacNet = rLacProd - rLacUp;
        // glutamine decomposes to ammonia by itself at 37 °C (not the dipeptide)
        const kDecomp = 0.003 * this.gmaxMed + 0.0005 * (1 - this.gmaxMed);
        let rNH4 = 0.7 * rGln + kDecomp * this.gln;
        const extra = L.extra ? L.extra(ctx) : null;
        if (extra && extra.nh4Uptake) rNH4 -= extra.nh4Uptake;
        this.OUR = OUR; this.CER = 0.85 * OUR;

        // ---- gas transfer ----
        const kla = dist.gasOK ? 1.2 * Math.pow(rpm / 60, 1.4) : 0.15;
        this.kla = kla;
        const o2frac = dist.gasOK ? a.o2 : 0.21;
        const co2frac = dist.gasOK ? a.co2 : 0.0004;
        const DOstar = o2frac / 0.21 * 100;
        const dDO = kla * (DOstar - this.DO) - OUR / O2_SAT * 100;
        // carbon dioxide: transfer, respiration, and the acid from lactate
        // titrating bicarbonate (H⁺ + HCO₃⁻ → CO₂ + H₂O)
        const co2star = CO2_SOL * co2frac * P_ATM;
        const rAcid = rLacNet;                                   // mM H⁺/h, one per lactate
        const dCO2 = 0.9 * kla * (co2star - this.co2) + this.CER + rAcid + D * (CO2_SOL * 0.05 * P_ATM - this.co2);
        const dHCO3 = -rAcid + a.base + D * (feed.hco3 - this.hco3);

        // ---- aggregates ----
        if (!this.aggFormed) {
            // Single cells find each other over the first ~12 h and the stirrer
            // sets how many end up together. The target count per aggregate is
            // the lineage's: a kidney organoid is built from thousands of cells
            // and a neurosphere from a few hundred.
            const nSeed = L.agg.nSeed * Math.pow(60 / rpm, 1.5);
            const Atarget = Nv * 1e3 / nSeed;
            this.A += (Atarget - this.A) * Math.min(1, 0.25 * dt);
            if (this.t >= 18) this.aggFormed = true;
        } else {
            // fusion is a two-body process: ∝ A². 0.006 /(k/mL)/h at 60 rpm loses
            // ~15 % of the aggregates on day 2 and takes a cardiac run to ~350 µm
            // by day 10; at 30 rpm it is four times faster (TUNED)
            const fuse = 0.006 * Math.pow(60 / rpm, 2) * this.A * this.A;
            const brk = 0.03 * hill(rpm, 120, 6) * this.A;
            this.A += (-fuse + brk) * dt;
            this.A = Math.max(this.A, Nv * 1e3 / 60000);    // nothing bigger than ~60k cells holds together
        }

        // ---- integrate ----
        for (let i = 0; i < nc; i++) this.N[i] = Math.max(0, this.N[i] + dN[i] * dt);
        this.dead = Math.max(0, this.dead + (died - (0.03 + 0.5 * D) * this.dead) * dt);
        this.glc = Math.max(0, this.glc + (-rGlc + a.glcFeed + D * (feed.glc * s.lots.glcScale - this.glc)) * dt);
        this.lac = Math.max(0, this.lac + (rLacNet + D * (feed.lac - this.lac)) * dt);
        this.gln = Math.max(0, this.gln + (-rGln - kDecomp * this.gln + D * (feed.gln - this.gln)) * dt);
        this.nh4 = Math.max(0, this.nh4 + (rNH4 + D * (0 - this.nh4)) * dt);
        this.hco3 = Math.max(1.0, this.hco3 + dHCO3 * dt);
        this.co2 = Math.max(0.02, this.co2 + dCO2 * dt);
        this.DO = clamp(this.DO + dDO * dt, 0, 250);
        this.osm += (D * (feed.osm - this.osm) + 2 * a.base + a.glcFeed) * dt;
        this.pluriMed += D * (feed.pluri - this.pluriMed) * dt;
        this.gmaxMed += D * ((feed.gmax ? 1 : 0) - this.gmaxMed) * dt;
        for (let i = 0; i < N_CUE; i++) {
            const spec = L.cues[i];
            if (!spec) continue;
            this.cue[i] = Math.max(0, this.cue[i] - (CUE_KINDS[spec.kind].decay + D) * this.cue[i] * dt);
            this.cueExposure[i] += cEff[i] * dt;
            this.cueHours[i] += dt * hill(cEff[i], this._ec[i], 2);
            this.cueRecent[i] += (hill(cEff[i], this._ec[i], 2) - this.cueRecent[i]) * (1 - Math.exp(-dt / 48));
        }
        this.rocki = Math.max(0, this.rocki - (0.03 + D) * this.rocki * dt);
        // costs
        this.cost.medium += D * dt * feed.cost;
        this.volumesFed += D * dt;
        this.cost.base += 0.02 * a.base * dt;
        this.cost.glc += 0.01 * a.glcFeed * dt;
        this.t += dt;
        this._updateDerived();

        // a batch that has lost its cells is over
        const nv = this.Nv;
        if (nv < 0.05 * s.seedDensity || (this.t > 24 && this.viability < 0.25)) {
            this.failed = true;
            this.failReason = nv < 0.05 * s.seedDensity ? "culture lost" : "viability collapse";
        }
    }

    /* Phenol red: red-pink above pH 7.6, orange around 7.1, yellow below 6.8.
     * 0 = yellow, 1 = red. It is a pH indicator, not a glucose sensor — but a
     * flask that has gone yellow has usually gone yellow because the cells
     * turned its glucose into lactate, which is why every lab reads it that way. */
    colour() { return hill(Math.max(0, this.pH - 6.4), 0.75, 6); }

    /* The lineage's functional readout: beating, spontaneous firing, insulin
     * in response to glucose, tubules, CYP activity. A separate axis from
     * purity — a vessel can be full of insulin-positive cells that do not
     * answer a glucose challenge, and that vessel is worth much less. */
    funcValue() {
        const Nv = this.Nv;
        const f = {
            product: Nv > 1e-9 ? this.product / Nv : 0,
            mature: Nv > 1e-9 ? this.N[this.lin.matureIdx] / Nv : 0,
            imm: Nv > 1e-9 ? this.N[this.lin.immIdx] / Nv : 0
        };
        return clamp(this.lin.func.of(this, f), 0, 1);
    }

    /* Snapshot for traces and rendering. */
    snapshot() {
        return {
            t: this.t, N: Array.from(this.N), dead: this.dead, Nv: this.Nv, viability: this.viability,
            d: this.d, A: this.A, fCore: this.fCore,
            glc: this.glc, lac: this.lac, gln: this.gln, nh4: this.nh4,
            DO: this.DO, pH: this.pH, T: this.T, osm: this.osm, hco3: this.hco3,
            cue: Array.from(this.cue), cueEff: Array.from(this.cueEff), cueHours: Array.from(this.cueHours), cueRecent: Array.from(this.cueRecent),
            kOut: Array.from(this.kOut), qRight: Array.from(this.qRight), rocki: this.rocki,
            info: this.info, product: this.product, purity: this.purity, func: this.funcValue(),
            OUR: this.OUR, colour: this.colour(), pluriMed: this.pluriMed,
            act: cloneAction(this.act), dist: Object.assign({}, this.dist),
            cost: this.cost.total, failed: this.failed
        };
    }
}

if (typeof module !== "undefined") {
    module.exports = {
        DT, TICK, HOURS_MAX, V0, O2_SAT, hill, clamp, ACT_BASE, N_BASE, N_OUT, RPM_SLEW,
        actSpec, decodeAction, neutralAction, cloneAction, Reactor
    };
}
