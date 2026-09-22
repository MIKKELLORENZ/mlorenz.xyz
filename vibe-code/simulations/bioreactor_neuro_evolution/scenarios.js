/* scenarios.js — everything that varies from one run to the next.
 *
 * A scenario is one batch's worth of luck: WHICH PRODUCT was ordered, which
 * cell line it has to be made from, what the inoculum count actually was,
 * which reagent lots arrived, what broke and when, and what day of the week
 * the run started (which decides when the lab is there to take samples). It
 * is built from a seed and a difficulty rung, and every controller in a
 * generation faces the identical one — common random numbers, so two brains
 * are ranked on their difference and not on which of them drew the bad pump.
 *
 * THE LADDER. Rung 0 is a well-behaved line in a well-run lab. Each rung adds
 * a class of trouble and never removes one; the trainer promotes when the
 * champion is comfortable on the top rung AND has not gone backwards on rung
 * 0, and it never comes down. See evolution.js for the anti-forgetting rule.
 *
 * The lineage is NOT part of the ladder. Every rung draws all five protocols,
 * because a controller that can only make heart cells is not the thing being
 * bred here.
 */
"use strict";

const DIFFICULTY = [
    { label: "Nominal", seedCV: 0.10, lineVar: 0.5, lots: false, weekendTech: true, equipment: 0, probes: false, temp: false, mag: 1.0 },
    { label: "Lots & calendar", seedCV: 0.25, lineVar: 1.0, lots: true, weekendTech: false, equipment: 0, probes: false, temp: false, mag: 1.0 },
    { label: "Equipment", seedCV: 0.25, lineVar: 1.0, lots: true, weekendTech: false, equipment: 2, probes: false, temp: true, mag: 1.0 },
    { label: "Probe drift", seedCV: 0.30, lineVar: 1.2, lots: true, weekendTech: false, equipment: 2, probes: true, temp: true, mag: 1.0 },
    { label: "Everything", seedCV: 0.35, lineVar: 1.4, lots: true, weekendTech: false, equipment: 4, probes: true, temp: true, mag: 1.5 }
];
const N_LEVELS = DIFFICULTY.length;
function difficultyOf(L) { return DIFFICULTY[Math.max(0, Math.min(N_LEVELS - 1, L | 0))]; }

/* Event catalogue. Each has a start, a duration and a magnitude; the reactor
 * reads them through `disturbancesAt`, the lab reads the probe faults through
 * `probeFaultsAt`. Reagent lots are not events, they are constants of the run. */
const EVENT_TYPES = {
    gasOutage: { label: "gas supply outage", equipment: true },
    pumpFail: { label: "perfusion pump failure", equipment: true },
    agitatorFault: { label: "agitator fault (stirrer slows)", equipment: true },
    tempFault: { label: "temperature excursion", equipment: true },
    pHDrift: { label: "pH probe drift", probe: true },
    doDrift: { label: "DO probe gain drift", probe: true },
    capDrift: { label: "capacitance probe fouling", probe: true }
};

function gaussRandOf(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* seed → scenario. Deterministic. `level` picks the rung; `lin` picks the
 * protocol (an index, a key, or null to let the seed decide). */
function makeScenario(seed, level, lin) {
    const L = Math.max(0, Math.min(N_LEVELS - 1, level | 0));
    const cfg = DIFFICULTY[L];
    const rng = mulberry32((seed | 0) * 2654435761 + 97 + L * 7919);
    const g = () => gaussRandOf(rng);
    const lv = cfg.lineVar;

    let li;
    if (lin == null) li = ((seed | 0) % N_LIN + N_LIN) % N_LIN;
    else if (typeof lin === "string") li = LIN_BY_KEY[lin] ? LIN_BY_KEY[lin].idx : 0;
    else li = ((lin | 0) % N_LIN + N_LIN) % N_LIN;
    const LIN = LINEAGES[li];

    /* Per-channel sensitivity of this line: the same reagent is a different
     * dose to a different line, and the controller is told none of it.
     *
     * MOSTLY ONE NUMBER, though. The first version drew all six channels
     * independently, and a six-reagent protocol then compounded six unrelated
     * misses where the two-reagent cardiac protocol compounded two — the
     * β-cell and hepatic protocols swung between a good batch and a failed one
     * while nothing about the lab had changed. That is not how lines differ:
     * a line that signals weakly signals weakly at everything, with quirks on
     * top. So one hidden global factor, and a smaller per-channel term. */
    const gGlobal = g();
    const cueEC50 = new Float64Array(N_CUE);
    const cuePotency = new Float64Array(N_CUE);
    for (let i = 0; i < N_CUE; i++) {
        cueEC50[i] = Math.exp(0.22 * lv * gGlobal + 0.14 * lv * g());
        cuePotency[i] = cfg.lots ? Math.max(0.5, Math.min(1.25, 1 + 0.2 * cfg.mag * g())) : 1;
    }

    const scn = {
        seed, level: L, label: cfg.label,
        lin: LIN, linIdx: li, linKey: LIN.key, hours: LIN.hours,
        // inoculum: the count the operator got is not the count that went in
        seedDensity: Math.max(0.15, Math.min(1.3, LIN.seed * (1 + cfg.seedCV * g()))),
        // the cell line: doubling time, how readily it takes the intended fate,
        // how loud its own endogenous signalling is, how much lactate it takes
        line: {
            muScale: Math.max(0.6, Math.min(1.4, 1 + 0.15 * lv * g())),
            prop: Math.max(0.5, Math.min(1.2, 1 + 0.2 * lv * g())),
            endo: Math.max(0.2, Math.min(0.95, 0.6 + 0.2 * lv * g())),
            lacTol: Math.max(0.7, Math.min(1.3, 1 + 0.12 * lv * g())),
            cueEC50
        },
        lots: {
            cuePotency,
            glcScale: cfg.lots ? Math.max(0.7, Math.min(1.0, 1 - Math.abs(0.12 * cfg.mag * g()))) : 1
        },
        // Monday = 0. Seeding is at 09:00.
        startWeekday: (rng() * 5) | 0,
        weekendTech: cfg.weekendTech,
        events: []
    };

    // equipment failures: a few, spread over the run, never in the first 12 h
    const H = scn.hours;
    const pick = (arr) => arr[(rng() * arr.length) | 0];
    const equipTypes = ["gasOutage", "pumpFail", "agitatorFault"].concat(cfg.temp ? ["tempFault"] : []);
    const nEquip = cfg.equipment > 0 ? 1 + ((rng() * cfg.equipment) | 0) : 0;
    for (let i = 0; i < nEquip; i++) {
        const type = pick(equipTypes);
        const t0 = 12 + rng() * (H - 36);
        let dur, mag;
        switch (type) {
            case "gasOutage": dur = (3 + rng() * 9) * cfg.mag; mag = 1; break;
            case "pumpFail": dur = (10 + rng() * 26) * cfg.mag; mag = 1; break;
            case "agitatorFault": dur = (4 + rng() * 14) * cfg.mag; mag = 20 + rng() * 15; break;   // rpm it drops to
            case "tempFault": dur = (3 + rng() * 6) * cfg.mag; mag = rng() < 0.7 ? 33 - rng() * 2 : 38.8 + rng() * 0.8; break;
        }
        scn.events.push({ type, t0, t1: t0 + dur, mag });
    }
    // probe faults: slow ramps over the whole run
    if (cfg.probes) {
        if (rng() < 0.7) scn.events.push({ type: "pHDrift", t0: 24 + rng() * 120, t1: H, mag: (rng() < 0.5 ? -1 : 1) * (0.08 + 0.12 * rng()) * cfg.mag });
        if (rng() < 0.5) scn.events.push({ type: "doDrift", t0: 0, t1: H, mag: 1 + (rng() < 0.5 ? -1 : 1) * (0.1 + 0.15 * rng()) * cfg.mag });
        if (rng() < 0.5) scn.events.push({ type: "capDrift", t0: 48, t1: H, mag: 1 + 0.25 * rng() * cfg.mag });
    }
    scn.events.sort((a, b) => a.t0 - b.t0);
    return scn;
}

/* What the plant feels at hour t. */
function disturbancesAt(scn, t) {
    const d = { gasOK: true, pumpOK: true, rpmOverride: null, tempSet: 37, active: [] };
    for (const e of scn.events) {
        if (t < e.t0 || t >= e.t1) continue;
        switch (e.type) {
            case "gasOutage": d.gasOK = false; d.active.push(e); break;
            case "pumpFail": d.pumpOK = false; d.active.push(e); break;
            case "agitatorFault": d.rpmOverride = e.mag; d.active.push(e); break;
            case "tempFault": d.tempSet = e.mag; d.active.push(e); break;
        }
    }
    return d;
}

/* What the probes lie about at hour t: an additive pH offset ramping in over
 * two days, a multiplicative DO gain, a capacitance gain creeping up. */
function probeFaultsAt(scn, t) {
    const f = { pHOffset: 0, doGain: 1, capGain: 1 };
    const H = scn.hours || HOURS_MAX;
    for (const e of scn.events) {
        if (t < e.t0) continue;
        const ramp = Math.min(1, (t - e.t0) / 48);
        switch (e.type) {
            case "pHDrift": f.pHOffset += e.mag * ramp; break;
            case "doDrift": f.doGain *= e.mag; break;
            case "capDrift": f.capGain *= 1 + (e.mag - 1) * Math.min(1, (t - e.t0) / Math.max(1, H - e.t0)); break;
        }
    }
    return f;
}

/* ------------------------------------------------------------ the calendar */
/* Seeding is 09:00 on `startWeekday`. Offline assays happen when someone is
 * there to do them: metabolites at 09:00 and 17:00 on lab days, a count and
 * aggregate imaging at 09:00, flow cytometry at 09:00 on every second lab
 * day. At weekends nothing happens — unless the rung allows a weekend
 * technician who runs the metabolite panel once at 10:00.
 *
 * Every assay has a turnaround: the sample is taken at hour t, the number is
 * on the bench at t + delay, and the controller only sees it then. */
const ASSAYS = {
    metabolites: { delay: 1, keys: ["glc", "lac", "gln", "nh4", "osm"] },
    counts: { delay: 3, keys: ["viable", "viability", "aggD", "aggCV"] },
    flow: { delay: 5, keys: ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "func"] }
};

function calendarAt(scn, t) {
    const abs = 9 + t;                          // hours since Monday-style midnight of day 0
    const day = Math.floor(abs / 24);
    const hod = abs - day * 24;
    const weekday = (scn.startWeekday + day) % 7;
    const labOpen = weekday < 5;
    return { day, hod, weekday, labOpen };
}

/* Which assays are taken at hour t (t integer). */
function assaysDueAt(scn, t) {
    const c = calendarAt(scn, t);
    const due = [];
    if (c.labOpen) {
        if (c.hod === 9 || c.hod === 17) due.push("metabolites");
        if (c.hod === 9) due.push("counts");
        if (c.hod === 9 && c.day % 2 === 0) due.push("flow");
    } else if (scn.weekendTech && c.hod === 10) {
        due.push("metabolites");
    }
    return due;
}

/* Hours until the lab is next open (0 if open now). */
function hoursToLab(scn, t) {
    for (let h = 0; h < 72; h++) if (calendarAt(scn, t + h).labOpen) return h;
    return 72;
}

if (typeof module !== "undefined") {
    module.exports = {
        DIFFICULTY, N_LEVELS, difficultyOf, EVENT_TYPES, makeScenario, disturbancesAt,
        probeFaultsAt, ASSAYS, calendarAt, assaysDueAt, hoursToLab
    };
}
