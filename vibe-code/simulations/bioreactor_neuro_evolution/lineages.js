/* lineages.js — the five differentiation protocols the reactor can be asked to run.
 *
 * The plant (bioreactor.js) knows nothing about hearts or kidneys. It knows
 * that cells sit in a chain of stages, that each step has a rate, that the
 * rate depends on the signals the cells feel at that moment and on whether
 * there is fuel to pay for it, and that every stage can leak into a sink of
 * things the culture became by accident. A LINEAGE is the table that fills
 * that in: which stages, which signalling molecules, which media, how long
 * the run is, what the lab can measure, and what the standard protocol does.
 *
 * Adding a lineage is adding a table. Nothing in the plant, the sensors, the
 * scoring or the network changes — which is the point of the exercise: the
 * controller has SIX generic dosing pumps and three medium slots, and which
 * reagent sits in pump 3 is part of the batch it is told about, not part of
 * its wiring.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * HOW A FATE DECISION IS WRITTEN, and why it matters more than any constant
 * in this file.
 *
 * Cells leave a stage on a CLOCK — a rate `k` that depends on fuel and on the
 * environment, and sometimes on a permissive signal, but not on whether the
 * protocol is being run correctly. What the signals decide is the fraction `q`
 * of those departing cells that arrive where the protocol intended. The rest
 * are off-target:
 *
 *     stage i → stage i+1     at  k · q
 *     stage i → off-target    at  k · (1 − q)  + a small unconditional drift
 *
 * The first version of this file made every off-target leak an ADDITIVE rate
 * instead, and every one of the four new protocols died the same way: the
 * neuroepithelium leaked to the sink at 0.056/h while advancing at 0.004/h,
 * because the leak fired on the days before the protocol had dosed the signal
 * that step needs. The chain drained before its cues arrived. Cardiomyocytes
 * were unaffected, and the reason is instructive — their Wnt terms were
 * already a split written out longhand, 0.03·(1 − Wnt) against 0.04·Wnt.
 *
 * With the split, a missing cue costs exactly the cells that were deciding
 * during the hours it was missing. That is what makes the ORDER and the
 * OVERLAP of the cue windows the control problem, rather than a checklist:
 * dose the right molecule two days late and you still get a vessel full of
 * cells, they are simply the wrong ones, and no later correction recovers
 * them.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * WHAT IS REAL AND WHAT IS TUNED. Every dose, every day window and every
 * marker below is from the published protocol it names. Every RATE is tuned:
 * the literature reports what you put in and what you get out, not the
 * transition probability per hour of a cell between two states. The tuning
 * target is always the same and is checked by `experiments.js`: run the
 * standard protocol and the yield, purity and timing land in the band the
 * papers report, and then break one thing and the failure mode is the one the
 * papers describe. MODEL.md names the fudges.
 *
 * The `dyn` function of each lineage is handed everything the cells can feel
 * and returns the rates:
 *
 *   kStep[i]  stage i → stage i+1        (differentiation)
 *   kBack[i]  stage i → stage i−1        (de-differentiation; only β cells)
 *   kOff[i]   stage i → the off-target sink
 *   tox[i]    extra death of stage i     (overdose, or withdrawal of a
 *                                         survival factor)
 */
"use strict";

/* How a dosed molecule behaves in a stirred vessel full of aggregates.
 *
 *   decay   first-order loss /h at 37 °C, on top of dilution by perfusion.
 *           Small molecules are stable for days; a growth factor is eaten by
 *           its own receptors and falls apart (FGF2's half-life in medium at
 *           37 °C is a few hours, which is why protocols re-feed it daily).
 *   dilExp  how strongly the dose the cells feel is diluted by cell density.
 *           A small molecule partitions; a protein is consumed, so more cells
 *           means proportionally less each.  (÷ (1 + Nv/4)^dilExp)
 *   penExp  how badly it penetrates an aggregate. A 400 Da molecule diffuses
 *           through 300 µm of tissue in minutes; a 25 kDa protein does not.
 *           (÷ (1 + (d/500 µm)²)^penExp)
 */
const CUE_KINDS = {
    /* dilExp was 1.0 for small molecules to begin with, which is the same
     * exponent a protein gets, and it made every identity window drift out
     * from under its own protocol: by day 8 a culture at 2.5 M/mL felt
     * 1.4 µM of a 3 µM CHIR dose and the midbrain band had moved off it. A
     * small molecule is not consumed stoichiometrically by receptors the way
     * a growth factor is — 3 µM in the medium is still 3 µM with ten times
     * the cells in it. What is left at 0.35 is the real effect: the dose that
     * WORKS still rises with density, because more cells means more of them
     * deeper inside an aggregate. (TUNED) */
    sm: { decay: 0.02, dilExp: 0.35, penExp: 1.0 },
    /* The protein exponents were 1.5 and 1.8 to begin with, and at 4 M/mL in
     * 315 µm aggregates that delivered the hepatic maturation cue five times
     * weaker than it was dosed — the last step of the chain stalled and the
     * run made hepatoblasts for ever. Protocols DO re-feed growth factors
     * daily at high density, and they do get through: 1.1 and 1.3 keep the
     * penalty real (a protein is still much worse off than a small molecule)
     * without making late-stage dosing pointless. (TUNED) */
    protein: { decay: 0.10, dilExp: 1.1, penExp: 1.3 }
};

/* Clamp a quality to something a fraction can be. The line's own propensity
 * multiplies several of them and a good line would otherwise push a q above
 * one, which would mean more cells arriving at a stage than left the one
 * before. The 0.98 ceiling is also a statement: no step of a real directed
 * differentiation is perfect. */
const qc = (x) => x < 0 ? 0 : x > 0.98 ? 0.98 : x;

const N_CUE = 6;        // dosing pumps the controller has, whatever the lineage uses
const N_MED = 3;        // medium slots: 0 = differentiation basal, 1 = expansion, 2 = the late medium
const MAX_STAGES = 8;   // longest chain (β cells); marker slots are sized from this

/* A stage's defaults. `mu` is the maximum specific growth rate /h, the q's are
 * pmol/cell/h, `ylac` is mol lactate per mol glucose (a glycolytic progenitor
 * makes nearly two, an oxidative mature cell less than one), `vol` is cell
 * volume in µm³, `shear` and `starve` scale the shared death channels, and
 * `fuel` says whether the stage can burn lactate when glucose runs out. */
/* A NOTE ON THE MID-CHAIN GROWTH RATES, because they were wrong once and the
 * way they were wrong is worth keeping.
 *
 * They started at 0.014-0.024 /h, which is what a progenitor can do, and the
 * consequence was that a ruined fate decision cost almost nothing. Removing
 * the one-day Wnt pulse from the β-cell protocol sent 65 % of the definitive
 * endoderm off-target exactly as designed — 0.16 M/mL of endoderm instead of
 * 0.41 — and the final product came out 8 % lower, because the third of the
 * pool that survived the mistake simply divided four times on its way down the
 * chain and refilled the vessel. Early cue accuracy was free, which is the
 * opposite of the process being modelled.
 *
 * Committed progenitors in these protocols do not expand like that: the
 * published yields are on the order of one usable cell per cell seeded over
 * three to four weeks, and that total is what the model now reproduces STAGE
 * BY STAGE rather than only in aggregate. (TUNED, and the reason the
 * references had to be re-measured afterwards.) */
function stage(id, label, marker, o) {
    return Object.assign({
        id, label, marker,
        mu: 0.02, qGlc: 0.18, qO2: 0.07, qGln: 0.028, ylac: 1.6, vol: 1000,
        shear: 1, starve: 1, att: 1, fuel: "glc"
    }, o || {});
}
function cue(key, label, short, unit, kind, hi, ec50, cost) {
    return { key, label, short, unit, kind, hi, ec50, cost };
}
/* glc/gln/lac in mM, hco3 in mM, osm in mOsm/kg, `pluri` is the fraction of
 * the pluripotency-maintaining growth factors the medium carries, `gmax` marks
 * the RPMI-type feeds whose free glutamine decomposes to ammonia, `cost` is
 * relative per vessel volume exchanged. */
function medium(key, label, o) {
    return Object.assign({ key, label, glc: 11.1, gln: 2.0, lac: 0, hco3: 24, osm: 290, pluri: 0, gmax: true, cost: 0.5 }, o || {});
}

/* The pluripotent starting stage and the off-target sink are the same in every
 * lineage — they are what the cells are before anyone intervenes and what they
 * become when the intervention misses. */
const STAGE_P = stage("P", "pluripotent", "TRA-1-60 / SSEA-4",
    { mu: 0.0267, qGlc: 0.20, qO2: 0.05, qGln: 0.030, ylac: 1.8, vol: 900 });
const STAGE_OFF = stage("O", "off-target", null,
    { mu: 0.012, qGlc: 0.18, qO2: 0.07, qGln: 0.028, ylac: 1.5, vol: 1100 });
/* ...but it does NOT grow at the same rate in every protocol, and over a
 * twenty-seven-day run nothing matters more. The off-target cells of a
 * cardiac run are proliferating mesoderm and fibroblast-like cells; of a
 * dopaminergic run, other neuroectoderm that is itself becoming post-mitotic;
 * of a β-cell run, polyhormonal and enterochromaffin cells that barely
 * divide; of a kidney organoid, stroma, which really does take the vessel
 * over. With one shared rate the sink compounded for three more weeks than it
 * was ever calibrated for and every long protocol came out at 8 % purity.
 * Each lineage names its own. (TUNED per lineage, against the purity its
 * papers report.) */
const MED_EXPANSION = medium("expansion", "expansion (E8-type)",
    { glc: 17.5, gln: 2.5, hco3: 29, osm: 340, pluri: 1, gmax: false, cost: 1.0 });

/* ════════════════════════════════════════════════════════════════════════
   1. CARDIOMYOCYTES — the GiWi protocol (Lian et al. 2012/2013, Burridge
   2014), in suspension with lactate metabolic selection (Tohyama 2013).
   Fifteen days. This is the best-quantified differentiation anyone runs in a
   bioreactor and it is the one the whole model was calibrated against, so its
   rates are left exactly as they were when they were tuned — including the
   longhand Wnt split, which is the same k·q idea written out.
   ════════════════════════════════════════════════════════════════════════ */
const LIN_CARDIAC = {
    key: "cardiac",
    offMu: 0.0120,       // what the cells that miss become, and how fast it grows
    /* WHAT A GOOD BATCH OF THIS PRODUCT LOOKS LIKE — the GiWi protocol in suspension: 1-3 M/mL cTnT+ cells at 60-90 % purity, all of it beating.
     * The score is measured against this, so a successful run of any of
     * the five is worth about the same and the search cannot win by
     * quietly abandoning the hard ones. `reagent` is what the published
     * protocol spends on its own cues, which is how twenty-seven days of
     * growth factors topped up against a ten-hour half-life is made
     * comparable to two doses of a small molecule. */
    ref: { fold: 2.28, purity: 0.70, func: 1.00, reagent: 4 },
    label: "cardiomyocytes",
    short: "Heart",           // the product chooser in the page header
    product: "beating heart cells",
    order: "cardiac muscle for a contractility screen",
    hours: 360,
    seed: 0.5,
    stages: [
        STAGE_P,
        stage("M", "early mesoderm", "Brachyury (T)", { mu: 0.030, qGlc: 0.20, qO2: 0.06, qGln: 0.030, ylac: 1.7, vol: 1000 }),
        stage("CP", "cardiac mesoderm", "KDR⁺ PDGFRα⁺", { mu: 0.024, qGlc: 0.16, qO2: 0.08, qGln: 0.025, ylac: 1.5, vol: 1100 }),
        stage("CMi", "immature cardiomyocyte", "cTnT⁺ (rising)", { mu: 0.006, qGlc: 0.12, qO2: 0.09, qGln: 0.025, ylac: 1.3, vol: 1300 }),
        stage("CM", "cardiomyocyte", "cTnT⁺ SIRPA⁺", { mu: 0.002, qGlc: 0.08, qO2: 0.12, qGln: 0.020, ylac: 0.9, vol: 1600, fuel: "glcLac", starve: 0.5 })
    ],
    cues: [
        cue("chir", "CHIR99021 (GSK3 inhibitor — Wnt ON)", "CHIR", "µM", "sm", 12, 4.0, 0.25),
        cue("iwp2", "IWP2 (porcupine inhibitor — Wnt OFF)", "IWP2", "µM", "sm", 8, 1.5, 0.25)
    ],
    media: [
        medium("basal", "differentiation basal (RPMI/B27)", { glc: 11.1, cost: 0.5 }),
        MED_EXPANSION,
        medium("selection", "lactate selection (glucose-free)", { glc: 0, lac: 4, cost: 0.4 })
    ],
    /* Mature cardiomyocytes burn lactate and survive glucose-free medium;
     * nothing else in the vessel does, including a cardiomyocyte made
     * yesterday. That is what makes metabolic selection work and why it only
     * works from about day 10. */
    agg: { nSeed: 400, band: [180, 350] },
    func: { key: "beating", label: "beating", of: (r, f) => (f.product > 0.15 && r.t > 7 * 24) ? 1 : 0 },
    immW: 1.0,          // a cTnT⁺ immature cardiomyocyte is product
    dyn(x) {
        const c = x.c, ec = x.ec, L = x.line;
        const wntExo = hill(c[0], ec[0], 3);
        // Mesoderm secretes its own Wnt — the reason a porcupine inhibitor is
        // needed at all. Autocrine and paracrine, so it saturates once a modest
        // fraction of the culture is mesoderm, and it fades as cells commit.
        const fMes = (x.N[1] + 0.25 * x.N[2]) / (x.Nv + 0.05);
        const wntEndo = L.endo * hill(fMes, 0.12, 2);
        const block = hill(c[1], ec[1], 2);
        const wnt = 1 - (1 - wntExo) * (1 - wntEndo * (1 - block));
        const over = hill(c[0], 2.2 * ec[0], 4);
        return {
            kStep: [
                0.12 * wntExo * x.envHalf * hill(x.glc, 0.5, 2),
                0.04 * (1 - 0.5 * wnt) * x.envHalf * x.fed,
                0.03 * (1 - wnt) * x.envHalf * L.prop * x.fed,
                0.02 * x.envHalf * x.fed
            ],
            kOff: [
                0.002 + 0.006 * (1 - x.pluriMed) + 0.004 * Math.pow(x.d / 300, 2) + 0.05 * over,
                0.004 * wnt + 0.002,
                0.04 * wnt + 0.002,
                0, 0
            ],
            tox: [0.03 * hill(c[0], 2.5 * ec[0], 4), 0.03 * hill(c[0], 2.5 * ec[0], 4), 0, 0, 0],
            info: { signal: wnt, label: "Wnt activity" }
        };
    },
    /* The standard operating procedure, day by day. `to` is the day the phase
     * ends; `cues` are doses in each channel's own units. */
    sop: {
        glcCap: 2,   // medium 2 IS the glucose-free lactate selection: starving here is the point
        doSet: 40, pHSet: 7.3, glcMin: 6, glcFeed: 1.0,
        phases: [
            { to: 1, medium: 1, perf: 0, rpm: 60, cues: {} },                   // aggregation in expansion medium
            { to: 2, medium: 0, perf: 1.0, rpm: 60, cues: { 0: 7.5 } },          // CHIR, 24 h
            { to: 2.5, medium: 0, perf: 2.0, rpm: 70, cues: {} },                // wash it out
            { to: 3, medium: 0, perf: 1.0, rpm: 70, cues: {} },
            { to: 5, medium: 0, perf: 1.0, rpm: 70, cues: { 1: 5 } },            // IWP2, 48 h
            { to: 10, medium: 0, perf: 1.0, rpm: 70, cues: {} },
            { to: 13, medium: 2, perf: 1.0, rpm: 70, cues: {} },                 // lactate selection
            { to: 99, medium: 0, perf: 1.0, rpm: 70, cues: {} }
        ]
    }
};

/* ════════════════════════════════════════════════════════════════════════
   2. MIDBRAIN DOPAMINERGIC NEURONS — the floor-plate route (Kriks et al.
   2011; Kirkeby et al. 2012/2017; the GMP protocols behind the current
   Parkinson's trials). Twenty-five days.

   THE INTERESTING PART is that the correct product sits in a narrow window of
   one dose. CHIR sets position along the front-to-back axis of the neural
   tube: too little and the cells are forebrain, too much and they are
   hindbrain, and midbrain — the only place dopaminergic neurons come from —
   is a band in between. Kirkeby's dose series is the reference: a factor of
   two in CHIR walks the identity from forebrain to hindbrain. Nothing the lab
   can measure before the flow panel on day 11 tells you which side you are on,
   and by then the decision has been taken.

   The other thing this lineage teaches the controller is that neurons are
   fragile. They breathe hard, they shear, and they are post-mitotic — a cell
   lost on day 20 is not replaced.
   ════════════════════════════════════════════════════════════════════════ */
const LIN_DOPA = {
    key: "dopa",
    offMu: 0.0015,       // what the cells that miss become, and how fast it grows
    /* WHAT A GOOD BATCH OF THIS PRODUCT LOOKS LIKE — the floor-plate protocols report 30-60 % TH+/FOXA2+ at day 25, after a modest expansion.
     * The score is measured against this, so a successful run of any of
     * the five is worth about the same and the search cannot win by
     * quietly abandoning the hard ones. `reagent` is what the published
     * protocol spends on its own cues, which is how twenty-seven days of
     * growth factors topped up against a ten-hour half-life is made
     * comparable to two doses of a small molecule. */
    ref: { fold: 0.83, purity: 0.39, func: 0.95, reagent: 229 },
    label: "dopaminergic neurons",
    short: "Neurons",           // the product chooser in the page header
    product: "midbrain dopamine neurons",
    order: "midbrain dopamine neurons for a Parkinson's graft",
    hours: 600,
    seed: 0.45,
    stages: [
        STAGE_P,
        stage("NE", "neuroepithelium", "PAX6⁺ SOX1⁺", { mu: 0.014, qGlc: 0.18, qO2: 0.06, vol: 900 }),
        stage("FP", "midbrain floor plate", "FOXA2⁺ LMX1A⁺", { mu: 0.012, qGlc: 0.16, qO2: 0.07, vol: 950 }),
        stage("NP", "dopaminergic progenitor", "EN1⁺ FOXA2⁺", { mu: 0.008, qGlc: 0.14, qO2: 0.08, vol: 1000 }),
        stage("DAi", "immature dopamine neuron", "TH⁺ (young)", { mu: 0.003, qGlc: 0.12, qO2: 0.11, ylac: 1.1, vol: 1200, shear: 1.8, starve: 1.3 }),
        stage("DA", "dopamine neuron", "TH⁺ NURR1⁺ GIRK2⁺", { mu: 0.0005, qGlc: 0.10, qO2: 0.14, ylac: 0.8, vol: 1400, shear: 2.2, starve: 1.6 })
    ],
    cues: [
        cue("smadi", "LDN193189 + SB431542 (dual SMAD inhibition)", "SMADi", "×", "sm", 2.0, 0.35, 0.30),
        cue("shh", "SHH agonist (SAG / purmorphamine)", "SHH-ag", "µM", "sm", 1.2, 0.25, 0.50),
        cue("chir", "CHIR99021 (caudalising Wnt)", "CHIR", "µM", "sm", 6.0, 1.5, 0.25),
        cue("fgf8", "FGF8b", "FGF8", "ng/mL", "protein", 200, 60, 1.20),
        cue("mat", "BDNF + GDNF + AA + dbcAMP + DAPT", "Maturation mix", "×", "protein", 1.5, 0.35, 1.00)
    ],
    media: [
        medium("basal", "neural induction (N2/B27)", { glc: 11.1, gln: 2.0, cost: 0.8 }),
        MED_EXPANSION,
        medium("mature", "neuronal maturation (B27, no vit A)", { glc: 8.0, gln: 1.5, cost: 1.1 })
    ],
    /* Neurons breathe hard and shear easily, so the aggregates have to stay
     * small — the opposite pressure to the kidney organoids below. */
    agg: { nSeed: 700, band: [120, 260] },
    func: {
        key: "firing", label: "spontaneous firing",
        // the fraction of the culture that is electrically active: it needs
        // mature neurons, and it takes about a fortnight to show up on an array
        of: (r, f) => r.t > 16 * 24 ? f.mature * 2.5 : 0
    },
    immW: 0.7,
    dyn(x) {
        const c = x.c, ec = x.ec, L = x.line;
        const smad = hill(c[0], ec[0], 2);
        const shh = hill(c[1], ec[1], 2);
        const wnt = hill(c[2], ec[2], 2);
        // Rostro-caudal position: 0 is forebrain, 1 is hindbrain. Midbrain is
        // the band around 0.66 — which is where the protocol's own 3 µM lands,
        // by construction. Half that dose gives about a tenth of the correct
        // identity and twice it about a third, which is the trade Kirkeby's
        // dose series reports. (TUNED: centre and width both.)
        const mid = Math.exp(-Math.pow((wnt - 0.66) / 0.22, 2));
        const fgf = hill(c[3], ec[3], 2);
        const mat = hill(c[4], ec[4], 2);
        /* DRIVERS. A cell only commits when something is telling it to. The
         * neuroepithelium waits for a ventralising SHH signal — without one it
         * sits there as dorsal neural tissue instead of streaming into the
         * sink — and the progenitors wait for the neurotrophic cocktail before
         * they leave the cell cycle and become neurons. */
        const K = [
            (0.02 + 0.11 * smad) * (0.3 + 0.7 * (1 - x.pluriMed)) * x.envHalf * x.fed,
            0.016 * shh * x.envHalf * x.fed,
            0.035 * x.envHalf * x.fed,
            (0.004 + 0.045 * mat) * x.envHalf * x.fed,
            0.020 * (0.35 + 0.65 * mat) * x.envHalf * x.fed
        ];
        const Q = [
            qc(0.15 + 0.85 * smad),
            qc(mid * (0.65 + 0.35 * fgf) * L.prop),        // CHIR sets WHERE, FGF8 says midbrain
            0.95,
            qc((0.80 + 0.18 * mat) * L.prop),
            0.97
        ];
        /* UNCONDITIONAL DRIFT, and it has to be small. These pools wait: the
         * progenitors sit from day 4 to day 13 with no driver, and at the
         * 0.3 %/h this started out at they lost a third of themselves to the
         * sink while waiting. Real progenitor cultures are stable for weeks.
         * 0.08 %/h is a fortnight's half-life. (TUNED)
         *
         * The exception is the neuroepithelium, which drifts when BMP and
         * Activin signalling are NOT suppressed — and that is why the
         * published protocols hold the dual-SMAD inhibitors for ten days
         * rather than the two it takes to leave pluripotency. Without this
         * term, stopping them on day 3 changed nothing at all, because by
         * then every cell had already left the stage that needed them. */
        const drift = [0.002 + 0.004 * Math.pow(x.d / 300, 2),
            0.0008 + 0.015 * (1 - smad), 0.0008, 0.0008, 0.0005, 0.0005];
        return {
            kStep: K.map((k, i) => k * Q[i]),
            kOff: drift.map((dr, i) => dr + (i < K.length ? K[i] * (1 - Q[i]) : 0)),
            tox: [0.02 * hill(c[2], 3 * ec[2], 4), 0.015 * hill(c[2], 3 * ec[2], 4), 0.01 * hill(c[1], 4 * ec[1], 4), 0, 0, 0],
            info: { signal: mid, label: "midbrain identity" }
        };
    },
    sop: {
        doSet: 35, pHSet: 7.3, glcMin: 5, glcFeed: 0.8,
        phases: [
            { to: 0.5, medium: 1, perf: 0, rpm: 55, cues: {} },
            { to: 1, medium: 0, perf: 0.8, rpm: 55, cues: { 0: 1.0 } },                       // dual SMAD from day 0
            // SHH and CHIR together from day 1: SHH is the DRIVER of the
            // floor-plate step and CHIR decides where along the neural tube
            // the cell thinks it is, so a day of SHH without CHIR commits a
            // third of the neuroepithelium with no positional signal at all.
            { to: 2, medium: 0, perf: 0.8, rpm: 55, cues: { 0: 1.0, 1: 1.0, 2: 3.0 } },
            // FGF8 runs with the other two patterning signals rather than
            // after them: the floor-plate decision is spread over days 2-12,
            // so a factor dosed only from day 9 reaches almost none of it.
            { to: 11, medium: 0, perf: 0.9, rpm: 55, cues: { 0: 1.0, 1: 1.0, 2: 3.0, 3: 100 } },
            { to: 13, medium: 0, perf: 0.9, rpm: 55, cues: { 1: 1.0, 2: 3.0, 3: 100, 4: 0.8 } },
            { to: 99, medium: 2, perf: 1.0, rpm: 50, cues: { 4: 0.8 } }                        // maturation
        ]
    }
};

/* ════════════════════════════════════════════════════════════════════════
   3. PANCREATIC β CELLS — the six-stage route (Rezania 2014, Pagliuca 2014,
   and the maturation work that followed: Velazco-Cruz 2019, Hogrebe 2020).
   Thirty-three days, six signalling channels, and two famous ways to fail.

   The length is not negotiable and was wrong here at first. Stages 1-5 take
   about nineteen days and then stage 6 runs another seven to twenty-five,
   with every Melton/Millman protocol first assaying a glucose response around
   day 33-35. The twenty-seven days this model used to run is the Nair figure,
   which is only reachable by sorting the cells and re-aggregating them -
   neither of which is modelled here, so it was the wrong number to copy.

   FAILURE ONE: the endocrine cue given before PDX1⁺/NKX6.1⁺ pancreatic
   endoderm is established makes polyhormonal and serotonin⁺ cells instead of
   β cells. The ORDER of the cues is the whole problem, and the cells that go
   wrong are not dead — they are sitting in the vessel diluting the product.

   FAILURE TWO: an immature β cell kept in high glucose de-differentiates and
   loses its glucose response. The controller must starve the culture of the
   very thing it has been feeding it for three weeks, and keep it alive — and
   the score reads the insulin response, not the insulin.
   ════════════════════════════════════════════════════════════════════════ */
const LIN_BETA = {
    key: "beta",
    offMu: 0.0020,       // what the cells that miss become, and how fast it grows
    /* WHAT A GOOD BATCH OF THIS PRODUCT LOOKS LIKE — SC-islets: 33 % (Pagliuca) through ~50 % (Rezania) to 52-73 % in the best maturation work, and ~78 % only after FACS and re-aggregation; with a glucose response well short of primary islets.
     * The score is measured against this, so a successful run of any of
     * the five is worth about the same and the search cannot win by
     * quietly abandoning the hard ones. `reagent` is what the published
     * protocol spends on its own cues, which is how twenty-seven days of
     * growth factors topped up against a ten-hour half-life is made
     * comparable to two doses of a small molecule. */
    ref: { fold: 0.62, purity: 0.30, func: 0.88, reagent: 82 },
    label: "pancreatic β cells",
    short: "β cells",           // the product chooser in the page header
    product: "glucose-responsive β cells",
    order: "islet-like β cells for a diabetes graft",
    hours: 792,
    seed: 0.55,
    stages: [
        STAGE_P,
        stage("DE", "definitive endoderm", "SOX17⁺ FOXA2⁺", { mu: 0.018, qGlc: 0.19, qO2: 0.06, vol: 950 }),
        stage("GT", "primitive gut tube", "HNF1B⁺", { mu: 0.014, qGlc: 0.18, qO2: 0.06, vol: 950 }),
        stage("PF", "posterior foregut", "PDX1⁺", { mu: 0.010, qGlc: 0.17, qO2: 0.07, vol: 1000 }),
        stage("PE", "pancreatic endoderm", "PDX1⁺ NKX6.1⁺", { mu: 0.008, qGlc: 0.16, qO2: 0.07, vol: 1050 }),
        stage("EP", "endocrine precursor", "NEUROG3⁺", { mu: 0.006, qGlc: 0.14, qO2: 0.08, vol: 1100 }),
        stage("Bi", "immature β cell", "INS⁺ (polyhormonal)", { mu: 0.004, qGlc: 0.12, qO2: 0.10, ylac: 1.2, vol: 1200, att: 0.6 }),
        stage("B", "β cell", "INS⁺ NKX6.1⁺ MAFA⁺", { mu: 0.001, qGlc: 0.10, qO2: 0.13, ylac: 0.9, vol: 1300, starve: 0.7, att: 0.35 })   // post-mitotic, and stage 6 holds it for weeks
    ],
    cues: [
        cue("act", "Activin A", "ActA", "ng/mL", "protein", 120, 40, 1.40),
        cue("chir", "CHIR99021 (one-day Wnt pulse)", "CHIR", "µM", "sm", 4.0, 1.2, 0.25),
        cue("ra", "retinoic acid", "RA", "µM", "sm", 2.5, 0.6, 0.30),
        cue("sant", "SANT-1 (SHH inhibitor)", "SANT-1", "µM", "sm", 0.6, 0.10, 0.40),
        cue("endo", "ALK5i + γ-secretase inhibitor + T3", "Endocrine mix", "×", "sm", 1.5, 0.40, 0.90),
        cue("ldn", "LDN193189 (BMP inhibitor)", "LDN", "µM", "sm", 0.5, 0.12, 0.35)
    ],
    media: [
        medium("basal", "stage medium (MCDB131)", { glc: 11.1, gln: 2.0, cost: 0.9 }),
        MED_EXPANSION,
        medium("mature", "maturation (CMRL, low glucose)", { glc: 5.6, gln: 1.5, cost: 1.2 })
    ],
    agg: { nSeed: 450, band: [100, 220] },
    func: {
        key: "gsis", label: "glucose-stimulated insulin",
        // A stimulation index: only mature cells answer a glucose challenge,
        // and only if they have not been sitting in high glucose.
        // TWO withdrawals, not one. Low glucose is the famous half. The other
        // is that the endocrine cocktail itself has to come out: taking ALK5i
        // and T3 away is what raises insulin secretion, and it does so at an
        // unchanged C-peptide+ fraction — so it belongs in the functional
        // readout and NOT in the maturation clock, where it would have shown
        // up as purity the papers do not report. Trailing, so the cocktail
        // cannot be shut off in the last hour for the credit.
        of: (r, f) => f.mature * 3.2 * (1 / (1 + Math.pow(Math.max(0, r.glc - 5.6) / 6, 2)))
            * (0.45 + 0.55 * (1 - r.cueRecent[4]))
    },
    immW: 0.3,          // a polyhormonal cell is worth little
    dyn(x) {
        const c = x.c, ec = x.ec, L = x.line;
        const act = hill(c[0], ec[0], 2);
        const wnt = hill(c[1], ec[1], 2);
        const ra = hill(c[2], ec[2], 2);
        const sant = hill(c[3], ec[3], 2);
        const endo = hill(c[4], ec[4], 2);
        const ldn = hill(c[5], ec[5], 2);
        // Mature β cells de-differentiate under glucotoxicity — the reason the
        // maturation medium is low-glucose, and the reason this lineage fights
        // its own feeding loop.
        /* "Low glucose" means the 5.6 mM of the published maturation medium,
         * and NOT less. A half-max at 8 mM paid more the deeper the culture
         * ran down - 0.67 at 5.6 mM against 0.98 at 1.2 mM - so the model was
         * rewarding a vessel for starving the product it was scored on. Full
         * credit at or below the published concentration, and nothing extra
         * for going lower. */
        const gLow = 1 / (1 + Math.pow(Math.max(0, x.glc - 5.6) / 5, 2));
        // A Wnt pulse of about a day makes endoderm; three days of it makes
        // mesoderm instead. The cell reads the counter as it stands when it
        // commits, so this cannot be corrected afterwards.
        const tooLong = hill(x.hours[1] / 24, 1.4, 4);
        /* ...and whether the pulse HAPPENED AT ALL is also a fact about the
         * past. Definitive endoderm commits over three days of Activin, but
         * the Wnt pulse that makes it posterior is one day long and then gone —
         * so a cell committing on day 3 has to read the counter, not the
         * bottle. Reading the instantaneous concentration instead put two
         * thirds of the endoderm in the wrong place while the protocol was
         * being followed exactly. */
        const pulsed = hill(x.hours[1], 10, 3);
        /* DRIVERS, and this is the lineage where they matter most: seven steps
         * in a row, each waiting for its own molecule. Activin makes endoderm;
         * withdrawing it lets the gut tube form; retinoic acid posteriorises
         * that; the endocrine cocktail switches NEUROG3 on. A cell whose next
         * driver has not arrived waits, which is why a protocol can take
         * twenty-seven days and still work — and why dosing a driver early,
         * before its modifier is in place, is the way to ruin a batch. */
        const K = [
            0.050 * act * x.envHalf * x.fed,       // ~2.5 days, not nine hours
            0.050 * (1 - 0.75 * act) * x.envHalf * x.fed,          // Activin has to come OUT
            0.060 * ra * x.envHalf * x.fed,
            0.040 * (0.3 + 0.7 * ldn) * x.envHalf * x.fed,
            0.040 * endo * x.envHalf * x.fed,
            0.050 * x.envHalf * x.fed,
            0.016 * (0.2 + 0.8 * gLow) * x.envHalf * x.fed
        ];
        const Q = [
            qc((0.35 + 0.65 * Math.max(wnt, pulsed)) * (1 - 0.7 * tooLong)),
            0.93,
            qc(0.30 + 0.68 * sant),                                // hedgehog blocked, or it is stomach
            // THE ORDERING TRAP: inducing the endocrine programme in a cell
            // that is not yet NKX6.1⁺ makes a polyhormonal or serotonin⁺ cell,
            // and it is counted as off-target because that is what it is worth.
            qc((0.35 + 0.60 * sant) * (1 - 0.75 * endo) * L.prop),
            qc(0.95 - 0.45 * hill(c[4], 2.2 * ec[4], 4)),
            0.93,
            0.95
        ];
        /* A pluripotent cell with no pluripotency factors does not sit in the
         * vessel for three weeks. These two protocols drive their cells out of
         * pluripotency over about two days and then have no further use for
         * the stage, and whatever was left was surviving to harvest: 3-6 %
         * residual TRA-1-60+ cells, against a penalty whose half-max is 3 %,
         * which multiplied the terminal score by 0.2-0.5 and was the entire
         * reason these two looked unprofitable to run. Real protocols come in
         * under 1 %, and residual pluripotency is the headline safety problem
         * for exactly these grafts. Half of the exit is death and half is
         * drift to off-target, which is roughly what happens. */
        const strand = 0.012 * (1 - x.pluriMed);
        const drift = [0.002 + strand + 0.004 * Math.pow(x.d / 300, 2),
            0.0008 + 0.035 * wnt * tooLong,     // Wnt held on turns endoderm back into mesoderm
            0.0008, 0.0008, 0.0008, 0.0010, 0.0008, 0.0005];
        /* A progenitor with no instructive signal left does not keep
         * dividing. Once the last cue comes out on day twenty the gut-tube
         * pool that never got its retinoic acid was doubling every fifty
         * hours in factor-free maturation medium, and by harvest it was the
         * biggest population in the vessel - so a CORRECT protocol lost eight
         * points of purity for every extra week it ran. The product itself is
         * post-mitotic anyway (mu 0.004 and 0.001), so it is only the
         * progenitors that quiesce. */
        const quiesce = 0.12 + 0.88 * Math.max(act, wnt, ra, sant, endo, ldn);
        return {
            kStep: K.map((k, i) => k * Q[i]),
            kOff: drift.map((dr, i) => dr + (i < K.length ? K[i] * (1 - Q[i]) : 0)),
            kBack: [0, 0, 0, 0, 0, 0, 0, 0.012 * hill(x.glc, 14, 3)],
            prolif: [1, quiesce, quiesce, quiesce, quiesce, quiesce, 1, 1, 1],
            tox: [strand, 0, 0, 0, 0, 0, 0, 0],
            info: { signal: gLow, label: "low-glucose maturation" }
        };
    },
    sop: {
        doSet: 40, pHSet: 7.35, glcMin: 5, glcFeed: 0.9,
        phases: [
            { to: 0.5, medium: 1, perf: 0, rpm: 65, cues: {} },
            { to: 1.5, medium: 0, perf: 1.0, rpm: 65, cues: { 0: 100, 1: 3.0 } }, // DE: activin + a one-day CHIR pulse
            { to: 3, medium: 0, perf: 1.0, rpm: 65, cues: { 0: 100 } },
            { to: 5, medium: 0, perf: 1.0, rpm: 65, cues: {} },                   // gut tube (KGF)
            { to: 8, medium: 0, perf: 1.0, rpm: 65, cues: { 2: 2.0, 3: 0.25, 5: 0.2 } },  // posterior foregut
            { to: 11, medium: 0, perf: 1.0, rpm: 65, cues: { 3: 0.25, 5: 0.2 } },  // PDX1 / NKX6.1
            { to: 15, medium: 0, perf: 1.0, rpm: 65, cues: { 4: 1.0, 3: 0.25 } },  // endocrine induction
            { to: 20, medium: 0, perf: 0.9, rpm: 60, cues: { 4: 0.6 } },
            { to: 99, medium: 2, perf: 0.8, rpm: 60, cues: {} }                    // low-glucose maturation
        ]
    }
};

/* ════════════════════════════════════════════════════════════════════════
   4. KIDNEY ORGANOIDS — the Takasato/Little route, with the Morizane
   variant's nephron-progenitor logic. Eighteen days.

   THIS ONE INVERTS EVERY OTHER LINEAGE. A nephron has to build itself, and
   self-organisation needs a BIG aggregate — 300 µm and up, where every other
   protocol in this file is trying to keep them under 250 to stop the middle
   suffocating. So the controller has to grow the aggregates deliberately,
   which means slowing the stirrer, which means it must then hold the oxygen
   up to keep the cores alive. The two knobs it has always used to avoid
   trouble now point in opposite directions.

   And the CHIR pulse is timed in DAYS, not dosed in µM: how long the Wnt
   signal was on when a cell commits is what decides how far back along the
   primitive streak it ended up, and therefore whether its intermediate
   mesoderm is the kind that makes nephrons. Three days and four days give
   different organoids.

   FGF9 is doubly awkward: nephron progenitors die without it and refuse to
   differentiate with it, so there is a day on which it has to come out.
   ════════════════════════════════════════════════════════════════════════ */
const LIN_KIDNEY = {
    key: "kidney",
    offMu: 0.0030,       // what the cells that miss become, and how fast it grows
    /* WHAT A GOOD BATCH OF THIS PRODUCT LOOKS LIKE — organoids are stroma-heavy; a third of the cells inside nephron structures is a good one.
     * The score is measured against this, so a successful run of any of
     * the five is worth about the same and the search cannot win by
     * quietly abandoning the hard ones. `reagent` is what the published
     * protocol spends on its own cues, which is how twenty-seven days of
     * growth factors topped up against a ten-hour half-life is made
     * comparable to two doses of a small molecule. */
    ref: { fold: 2.22, purity: 0.28, func: 0.64, reagent: 338 },
    label: "kidney organoids",
    short: "Kidney",           // the product chooser in the page header
    product: "nephron structures",
    order: "kidney organoids for a nephrotoxicity panel",
    hours: 600,
    seed: 0.4,
    stages: [
        STAGE_P,
        stage("PS", "posterior primitive streak", "BRACHYURY⁺ MIXL1⁺", { mu: 0.028, qGlc: 0.20, qO2: 0.06, ylac: 1.7, vol: 1000 }),
        stage("IM", "intermediate mesoderm", "PAX2⁺ LHX1⁺", { mu: 0.014, qGlc: 0.18, qO2: 0.07, vol: 1000 }),
        stage("NP", "nephron progenitor", "SIX2⁺ WT1⁺", { mu: 0.010, qGlc: 0.16, qO2: 0.08, vol: 1050 }),
        stage("NEi", "forming nephron", "JAG1⁺ CDH1⁺", { mu: 0.011, qGlc: 0.14, qO2: 0.10, ylac: 1.2, vol: 1200 }),
        stage("NE", "segmented nephron", "NPHS1⁺ podocyte + LTL⁺ tubule", { mu: 0.004, qGlc: 0.12, qO2: 0.12, ylac: 1.0, vol: 1300, shear: 1.4 })
    ],
    cues: [
        cue("chir", "CHIR99021 (posteriorising Wnt)", "CHIR", "µM", "sm", 12, 3.5, 0.25),
        cue("fgf9", "FGF9 (+ heparin 1 µg/mL)", "FGF9", "ng/mL", "protein", 250, 20, 1.30)
    ],
    media: [
        medium("basal", "APEL-type basal", { glc: 11.1, gln: 2.0, cost: 0.7 }),
        MED_EXPANSION,
        medium("organoid", "organoid maintenance", { glc: 9.0, gln: 2.0, cost: 0.9 })
    ],
    agg: { nSeed: 1400, band: [300, 550] },
    func: {
        key: "tubules", label: "tubules and glomeruli",
        of: (r, f) => f.mature * 2.6 * hill(r.d, 260, 3)
    },
    immW: 0.6,
    dyn(x) {
        const c = x.c, ec = x.ec, L = x.line;
        const wnt = hill(c[0], ec[0], 2);
        const fgf = hill(c[1], ec[1], 2);
        /* How much SIGNAL-TIME the Wnt pulse had delivered when this cell
         * committed, in days (see cueHours in bioreactor.js: it accumulates in
         * proportion to the strength of the signal, so the protocol's four-day
         * pulse of 7 µM delivers about 2.4 signal-days once density and
         * aggregate size have taken their cut). The protocol lands in the
         * window by construction; two days gives about four tenths of the
         * correct identity and seven days almost none, which is the balance
         * Takasato reports between ureteric epithelium and metanephric
         * mesenchyme. (TUNED: centre 2.4 signal-days, width 1.15.) */
        const win = Math.exp(-Math.pow((x.hours[0] / 24 - 2.92) / 1.15, 2));
        // Self-organisation needs tissue, not cells: a nephron will not form
        // in a 150 µm ball however well it is fed.
        const size = hill(x.d, 260, 3);
        /* FGF9 is the driver of the two middle steps, the SURVIVAL factor of
         * the stage between them, and the thing holding the nephron
         * progenitors back from differentiating. So there is a day on which it
         * has to come out, and taking it out early kills the pool. */
        const K = [
            0.13 * wnt * x.envHalf * x.fed,
            0.030 * (0.15 + 0.85 * fgf) * x.envHalf * x.fed,
            0.045 * (0.20 + 0.80 * fgf) * x.envHalf * x.fed,
            0.030 * (1 - fgf) * x.envHalf * x.fed,
            0.022 * x.envHalf * x.fed
        ];
        const Q = [
            0.95,
            qc(win * 0.97),
            qc(0.92 * L.prop),
            qc(0.45 + 0.50 * size),
            qc(0.40 + 0.55 * size)
        ];
        const drift = [0.002 + 0.004 * Math.pow(x.d / 400, 2), 0.0008, 0.0008,
            0.0008 + 0.005 * fgf,          // a progenitor parked in FGF9 does not wait for ever
            0.0008, 0.0005];
        return {
            kStep: K.map((k, i) => k * Q[i]),
            kOff: drift.map((dr, i) => dr + (i < K.length ? K[i] * (1 - Q[i]) : 0)),
            // nephron progenitors undergo apoptosis without FGF9
            tox: [0, 0, 0.004 + 0.030 * (1 - fgf), 0, 0, 0],
            info: { signal: win, label: "CHIR pulse in window" }
        };
    },
    sop: {
        doSet: 45, pHSet: 7.3, glcMin: 6, glcFeed: 1.0,
        phases: [
            { to: 0.25, medium: 1, perf: 0, rpm: 45, cues: {} },
            { to: 4, medium: 0, perf: 0.8, rpm: 45, cues: { 0: 8.0 } },            // CHIR 8 µM from day 0, four days
            { to: 7, medium: 0, perf: 0.9, rpm: 40, cues: { 1: 200 } },            // FGF9 200 ng/mL + heparin
            // the second CHIR pulse is ONE HOUR at day 7, immediately after
            // aggregation — not the multi-day pulse at day 11 this had first
            { to: 7.05, medium: 0, perf: 0.9, rpm: 40, cues: { 0: 5.0, 1: 200 } },
            { to: 12, medium: 0, perf: 0.9, rpm: 40, cues: { 1: 200 } },           // FGF9 to day 12
            { to: 99, medium: 2, perf: 0.9, rpm: 40, cues: {} }                    // growth factors out to day 25
        ]
    }
};

/* ════════════════════════════════════════════════════════════════════════
   5. HEPATOCYTE-LIKE CELLS — the classical four-cue relay (Si-Tayeb 2010,
   Hay/Rashidi, and the organoid variants). Twenty days.

   The honest version of this protocol is that the last step barely works:
   what comes out is closer to a fetal hepatoblast than an adult hepatocyte,
   and the drug-metabolising enzyme activity is a fraction of primary cells.
   That is modelled as it is — a slow maturation step that needs its cue held
   for a week, so a controller that stops early gets a vessel full of AFP⁺
   cells that score almost nothing. It is the one lineage where the protocol
   itself is not very good, which makes it the one where there is most room
   above it.
   ════════════════════════════════════════════════════════════════════════ */
const LIN_HEPATIC = {
    key: "hepatic",
    offMu: 0.0040,       // what the cells that miss become, and how fast it grows
    /* WHAT A GOOD BATCH OF THIS PRODUCT LOOKS LIKE — ALB+ is easy and CYP3A4 is not: the reference function is a fraction of primary hepatocytes.
     * The score is measured against this, so a successful run of any of
     * the five is worth about the same and the search cannot win by
     * quietly abandoning the hard ones. `reagent` is what the published
     * protocol spends on its own cues, which is how twenty-seven days of
     * growth factors topped up against a ten-hour half-life is made
     * comparable to two doses of a small molecule. */
    ref: { fold: 2.02, purity: 0.22, func: 0.17, reagent: 213 },
    label: "hepatocyte-like cells",
    short: "Liver",           // the product chooser in the page header
    product: "hepatocytes",
    order: "hepatocytes for a drug-metabolism assay",
    hours: 480,
    seed: 0.5,
    stages: [
        STAGE_P,
        stage("DE", "definitive endoderm", "SOX17⁺ FOXA2⁺", { mu: 0.018, qGlc: 0.19, qO2: 0.06, vol: 950 }),
        stage("HE", "hepatic endoderm", "HNF4A⁺", { mu: 0.012, qGlc: 0.18, qO2: 0.08, vol: 1000 }),
        stage("HBi", "hepatoblast", "AFP⁺ ALB-low", { mu: 0.008, qGlc: 0.16, qO2: 0.11, ylac: 1.3, vol: 1200 }),
        stage("HEP", "hepatocyte", "ALB⁺ CYP3A4⁺", { mu: 0.002, qGlc: 0.14, qO2: 0.16, ylac: 0.8, vol: 1600, starve: 0.8 })
    ],
    cues: [
        cue("act", "Activin A", "ActA", "ng/mL", "protein", 120, 40, 1.40),
        cue("bmp", "BMP4 + FGF2", "BMP4/FGF2", "×", "protein", 1.5, 0.35, 1.10),
        cue("hgf", "HGF", "HGF", "ng/mL", "protein", 40, 12, 1.30),
        cue("osm", "Oncostatin M + dexamethasone", "OSM/dex", "×", "protein", 2.0, 0.25, 0.80)
    ],
    media: [
        medium("basal", "RPMI/B27 hepatic basal", { glc: 11.1, gln: 2.0, cost: 0.6 }),
        MED_EXPANSION,
        medium("mature", "hepatocyte maintenance (HCM)", { glc: 9.0, gln: 2.5, hco3: 26, cost: 1.0 })
    ],
    agg: { nSeed: 500, band: [150, 300] },
    func: {
        key: "cyp", label: "CYP3A4 activity",
        /* The honest number. Drug-metabolising activity in stem-cell-derived
         * hepatocytes is a small fraction of primary cells, and what it does
         * respond to is oxygen: the liver is the most oxygen-hungry tissue in
         * the body, and a hepatocyte held at 30 % air saturation does not
         * behave like one. So this lineage asks the controller for something
         * none of the others do — run the vessel rich. */
        of: (r, f) => f.mature * 1.4 * (0.4 + 0.6 * hill(r.DO, 45, 2))
    },
    immW: 0.35,         // an AFP⁺ hepatoblast is not a hepatocyte
    /* Hepatocytes run the urea cycle: a vessel full of them clears its own
     * ammonia, which is the one place in this simulator where the product
     * improves its own environment. */
    extra(x) { return { nh4Uptake: x.N[4] * 0.05 * (x.nh4 / (x.nh4 + 1)) }; },
    dyn(x) {
        const c = x.c, ec = x.ec, L = x.line;
        const act = hill(c[0], ec[0], 2);
        const bmp = hill(c[1], ec[1], 2);
        const hgf = hill(c[2], ec[2], 2);
        const osm = hill(c[3], ec[3], 2);
        // A four-cue relay: every step waits for its own factor, and the last
        // one — the week of oncostatin M that is supposed to turn a hepatoblast
        // into a hepatocyte — is the step that barely works in real life.
        const K = [
            0.050 * act * x.envHalf * x.fed,       // ~2.5 days, not nine hours
            0.030 * bmp * x.envHalf * x.fed,
            0.035 * (0.20 + 0.80 * hgf) * x.envHalf * x.fed,
            0.016 * osm * x.envHalf * x.fed
        ];
        const Q = [
            qc(0.15 + 0.83 * act),
            qc(0.95 - 0.50 * act),                       // BMP4/FGF2 only once Activin is gone
            qc(0.90 * L.prop),
            0.93
        ];
        /* A pluripotent cell with no pluripotency factors does not sit in the
         * vessel for three weeks. These two protocols drive their cells out of
         * pluripotency over about two days and then have no further use for
         * the stage, and whatever was left was surviving to harvest: 3-6 %
         * residual TRA-1-60+ cells, against a penalty whose half-max is 3 %,
         * which multiplied the terminal score by 0.2-0.5 and was the entire
         * reason these two looked unprofitable to run. Real protocols come in
         * under 1 %, and residual pluripotency is the headline safety problem
         * for exactly these grafts. Half of the exit is death and half is
         * drift to off-target, which is roughly what happens. */
        const strand = 0.012 * (1 - x.pluriMed);
        const drift = [0.002 + strand + 0.004 * Math.pow(x.d / 300, 2), 0.0008, 0.0008, 0.0008, 0.0005];
        return {
            kStep: K.map((k, i) => k * Q[i]),
            kOff: drift.map((dr, i) => dr + (i < K.length ? K[i] * (1 - Q[i]) : 0)),
            tox: [strand, 0, 0, 0, 0],
            info: { signal: osm, label: "maturation cue" }
        };
    },
    sop: {
        doSet: 50, pHSet: 7.35, glcMin: 6, glcFeed: 1.0,
        phases: [
            { to: 0.5, medium: 1, perf: 0, rpm: 60, cues: {} },
            { to: 5, medium: 0, perf: 1.0, rpm: 60, cues: { 0: 100 } },   // Activin A 100, days 0–5
            { to: 10, medium: 0, perf: 1.0, rpm: 60, cues: { 1: 1.0 } },  // BMP4 20 + FGF2 10, days 5–10
            { to: 15, medium: 0, perf: 1.0, rpm: 60, cues: { 2: 20 } },   // HGF 20, days 10–15
            { to: 99, medium: 2, perf: 1.0, rpm: 60, cues: { 3: 1.3 } }   // OSM 20 + dex, days 15–20
        ]
    }
};

const LINEAGES = [LIN_CARDIAC, LIN_DOPA, LIN_BETA, LIN_KIDNEY, LIN_HEPATIC];
const N_LIN = LINEAGES.length;
const LIN_BY_KEY = {};

/* Finish each spec: indices, stage counts, marker slots, and the derived
 * numbers the plant and the page both want. Doing it here rather than by hand
 * means a new lineage cannot get them wrong. */
LINEAGES.forEach((L, li) => {
    L.idx = li;
    L.nStage = L.stages.length;
    L.OFF = L.nStage;                 // the off-target sink is the last compartment
    L.nc = L.nStage + 1;
    L.days = L.hours / 24;
    L.matureIdx = L.nStage - 1;
    L.immIdx = L.nStage - 2;
    L.nCue = L.cues.length;
    if (L.nStage > MAX_STAGES) throw new Error(`${L.key}: ${L.nStage} stages, max ${MAX_STAGES}`);
    if (L.nCue > N_CUE) throw new Error(`${L.key}: ${L.nCue} cues, max ${N_CUE}`);
    if (L.media.length !== N_MED) throw new Error(`${L.key}: ${L.media.length} media, expected ${N_MED}`);
    L.stages = L.stages.concat([Object.assign({}, STAGE_OFF,
        { mu: L.offMu != null ? L.offMu : STAGE_OFF.mu })]);
    LIN_BY_KEY[L.key] = L;
});

/* Product cells per mL: the mature stage plus the immature one at whatever
 * an immature cell is worth in this lineage. Used by the score, the page and
 * every analysis, so there is exactly one definition of "how much did we
 * make". */
function productOf(L, N) { return N[L.matureIdx] + L.immW * N[L.immIdx]; }
function matureOf(L, N) { return N[L.matureIdx]; }

if (typeof module !== "undefined") {
    module.exports = {
        CUE_KINDS, N_CUE, N_MED, MAX_STAGES, LINEAGES, N_LIN, LIN_BY_KEY,
        productOf, matureOf, stage, cue, medium
    };
}
