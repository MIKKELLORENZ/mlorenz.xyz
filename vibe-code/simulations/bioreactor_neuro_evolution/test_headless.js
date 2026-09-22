/* test_headless.js — Node regression suite.
 *
 *   node test_headless.js            everything
 *   node test_headless.js engine     just the engine
 *   node test_headless.js biology    just the mechanism checks
 *   node test_headless.js scale      just the fitness scale
 *
 * The biology section is not decoration. Every claim in it is a thing a
 * cell-culture lab would recognise, and every one of them would rot silently
 * under a well-meaning constant change.
 *
 * EXPRESSED RELATIVE TO EACH LINEAGE'S OWN REFERENCE, deliberately. Hard
 * numbers in a suite like this go stale the first time a constant moves and
 * then get "fixed" by loosening them until they assert nothing. What does not
 * go stale is the shape: the published protocol lands near what that protocol
 * is supposed to achieve, every reagent it doses is worth having, and doing
 * nothing is worth nothing.
 *
 * THE FITNESS SCALE SECTION exists because of a bug that would have wasted a
 * whole training run. With the score written as 100 × fold × purity² — fine
 * for one protocol — four of the five landed BELOW the do-nothing reactor,
 * because purity² is quadratic in a ceiling that differs between products and
 * because three weeks of growth factors cost more than the batch was worth.
 * A GA would have learned to make nothing at all, and the training curve would
 * have looked healthy while it did. Now it is asserted: for every product, the
 * protocol must beat the neutral reactor by a wide margin.
 */
"use strict";
require("./harness.js");

let failures = 0;
function check(name, ok, extra) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}
const mode = process.argv[2] || "all";
const pct = (x) => (x * 100).toFixed(0) + "%";
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : 0.5 * (b[b.length / 2 - 1] + b[b.length / 2]); };

/* Run one lineage's protocol with `mod` applied to every action, on `n`
 * batches, and hand back the medians. One batch is one draw of a hidden cell
 * line, and a single draw is not evidence. */
function sopRuns(lin, mod, n, level) {
    const out = [];
    for (let k = 0; k < (n || 5); k++) {
        const w = new World([], { seed: 4000 + k * 211, level: level || 0, lin: lin.idx, withNothing: false });
        if (mod) {
            const sop = w.sop.ctrl, orig = sop.step.bind(sop);
            sop.step = (lab, r, t) => { const a = orig(lab, r, t); mod(a, t, r); return a; };
        }
        w.run();
        out.push({ res: w.sop.result, neutral: w.neutral.result, r: w.sop.r });
    }
    return {
        score: med(out.map(o => o.res.score)), fold: med(out.map(o => o.res.fold)),
        purity: med(out.map(o => o.res.purity)), func: med(out.map(o => o.res.func)),
        viability: med(out.map(o => o.res.viability)), aggD: med(out.map(o => o.res.aggD)),
        residual: med(out.map(o => o.res.residual)), product: med(out.map(o => o.res.productPerML)),
        neutral: med(out.map(o => o.neutral.score)), lost: out.filter(o => o.res.failed).length, n: out.length
    };
}

/* ------------------------------------------------------------- 1. engine */
if (mode === "all" || mode === "engine") {
    console.log("\n-- engine --");
    const CARD = LIN_BY_KEY.cardiac;
    // pH chemistry: 24 mM bicarbonate under 5 % CO₂ is pH 7.4
    {
        const scn = makeScenario(1, 0, 0);
        const r = new Reactor(scn, mulberry32(1));
        r.hco3 = 24; r.co2 = 0.0307 * 0.05 * 760; r._updateDerived();
        check("pH: 24 mM HCO₃⁻ under 5 % CO₂ → 7.41", Math.abs(r.pH - 7.41) < 0.02, r.pH.toFixed(3));
        r.hco3 = 12; r._updateDerived();
        check("pH: halving the bicarbonate costs 0.30", Math.abs(r.pH - 7.11) < 0.02, r.pH.toFixed(3));
    }
    // DO balance: an empty vessel under air settles at 100 %
    {
        const scn = Object.assign({}, makeScenario(1, 0, 0), { seedDensity: 0 });
        const r = new Reactor(scn, mulberry32(1));
        r.DO = 20;
        const a = neutralAction(); a.o2 = 0.21;
        for (let i = 0; i < 10; i++) r.tick(cloneAction(a));
        check("DO: empty vessel under air → 100 % air saturation", Math.abs(r.DO - 100) < 2, r.DO.toFixed(1));
        a.o2 = 0.42; r.DO = 100;
        for (let i = 0; i < 10; i++) r.tick(cloneAction(a));
        check("DO: 42 % O₂ in the gas → 200 %", Math.abs(r.DO - 200) < 4, r.DO.toFixed(1));
    }
    // Thiele: a bigger aggregate at lower DO has a bigger hypoxic core
    {
        const scn = makeScenario(1, 0, 0);
        const r = new Reactor(scn, mulberry32(1));
        r.N.fill(0); r.N[0] = 3; r.A = 3e3 * 1e3 / 40000 / 1e3;   // 40k cells per aggregate
        r.DO = 40; r._updateDerived();
        const d40 = r.d, c40 = r.fCore;
        r.DO = 10; r._updateDerived();
        check("aggregates: 40k pluripotent cells is a ~500 µm aggregate", d40 > 420 && d40 < 600, d40.toFixed(0) + " µm");
        check("hypoxic core grows as DO falls", r.fCore > c40, `${c40.toFixed(3)} at 40 % → ${r.fCore.toFixed(3)} at 10 %`);
        r.N.fill(0); r.N[CARD.matureIdx] = 3; r.DO = 40; r._updateDerived();
        check("a cardiomyocyte aggregate of the same cell count has the bigger core", r.fCore > c40, r.fCore.toFixed(3));
    }
    // the action space
    {
        const L = LIN_BY_KEY.beta;      // the one that uses all six dosing channels
        const z = new Float32Array(N_OUT);
        const a = decodeAction(z, null, L);
        check("decode: zero output is the neutral setting",
            a.o2 === 0.21 && a.co2 === 0.05 && a.base === 0 && a.rpm === 70 && a.perf === 0.7 &&
            Array.from(a.cue).every(v => v === 0) && a.medium === 0);
        const hi = new Float32Array(N_OUT).fill(1), lo = new Float32Array(N_OUT).fill(-1);
        const ah = decodeAction(hi, null, L), al = decodeAction(lo, null, L);
        check("decode: +1 hits the top of every range",
            ah.o2 === 0.5 && ah.co2 === 0.1 && ah.base === 2 && ah.rpm === 120 && ah.perf === 2 &&
            L.cues.every((c, i) => Math.abs(ah.cue[i] - c.hi) < 1e-9));
        check("decode: −1 hits the bottom",
            al.o2 === 0 && al.co2 === 0 && al.base === 0 && al.rpm === 20 && al.perf === 0 &&
            Array.from(al.cue).every(v => v === 0));
        const slew = decodeAction(hi, { rpm: 60 }, L);
        check("decode: rpm slews 20 per tick", slew.rpm === 80, slew.rpm);
        const m = new Float32Array(N_OUT); m[N_BASE + N_CUE + 2] = 0.5;
        check("decode: medium is the argmax logit", decodeAction(m, null, L).medium === 2);
        // a channel this lineage does not use must stay shut whatever the net says
        const two = LIN_BY_KEY.kidney;
        const ak = decodeAction(hi, null, two);
        check("decode: unused dosing channels stay at zero",
            ak.cue[2] === 0 && ak.cue[3] === 0 && ak.cue[4] === 0 && ak.cue[5] === 0,
            `kidney uses ${two.nCue} of ${N_CUE}`);
    }
    // the observation
    {
        let bad = 0, maxAbs = 0, widths = new Set();
        for (const L of LINEAGES) {
            const w = new World([new Net(NET_SIZES, mulberry32(3))], { seed: 2, level: 4, lin: L.idx, withNothing: false });
            while (!w.isOver()) {
                w.step();
                widths.add(w.units[0].obs.length);
                for (const v of w.units[0].obs) { if (!Number.isFinite(v)) bad++; maxAbs = Math.max(maxAbs, Math.abs(v)); }
            }
        }
        check("observation: finite through a rung-4 episode of every product", bad === 0, `${bad} bad`);
        check("observation: bounded (|x| ≤ 3)", maxAbs <= 3.0001, maxAbs.toFixed(2));
        check("observation: one width for all five products", widths.size === 1 && widths.has(NET_SIZES[0]), `${N_IN}`);
    }
    // the order block: the network is told which product, and nothing else changes shape
    {
        const w0 = new World([], { seed: 7, level: 0, lin: 0 });
        const w1 = new World([], { seed: 7, level: 0, lin: 3 });
        check("the order: the same seed can be asked for a different product",
            w0.lin.key !== w1.lin.key && w0.scn.hours !== w1.scn.hours,
            `${w0.lin.key} ${w0.scn.hours} h vs ${w1.lin.key} ${w1.scn.hours} h`);
    }
    // determinism and common random numbers
    {
        const b = new Net(NET_SIZES, mulberry32(9));
        const w1 = new World([b, b.clone()], { seed: 5, level: 2, lin: 1, withNothing: false }).run();
        const w2 = new World([b.clone()], { seed: 5, level: 2, lin: 1, withNothing: false }).run();
        const r1 = w1.results(), r2 = w2.results();
        check("CRN: identical brains in one world score identically", Math.abs(r1[0].score - r1[1].score) < 1e-9);
        check("determinism: the same seed replays byte for byte", Math.abs(r1[0].score - r2[0].score) < 1e-9,
            `${r1[0].score.toFixed(4)} vs ${r2[0].score.toFixed(4)}`);
        check("determinism: the protocol too", Math.abs(w1.sop.result.score - w2.sop.result.score) < 1e-9);
        const w3 = new World([b.clone()], { seed: 6, level: 2, lin: 1, withNothing: false }).run();
        check("a different seed is a different batch", Math.abs(w3.results()[0].score - r2[0].score) > 1e-6);
    }
    // calendar
    {
        const scn = makeScenario(1, 1, 0); scn.startWeekday = 4; scn.weekendTech = false;   // Friday start
        check("calendar: seeding Friday 09:00 takes the metabolite panel", assaysDueAt(scn, 0).includes("metabolites"));
        check("calendar: Saturday takes nothing", assaysDueAt(scn, 24).length === 0 && assaysDueAt(scn, 32).length === 0);
        check("calendar: Monday's count is 72 h later, the lab reopens at midnight (39 h)",
            assaysDueAt(scn, 72).includes("counts") && hoursToLab(scn, 24) === 39, `${hoursToLab(scn, 24)} h`);
        scn.weekendTech = true;
        check("calendar: a weekend technician runs metabolites at 10:00", assaysDueAt(scn, 25).includes("metabolites"));
    }
    // lab delays, and the generic marker panel
    {
        const scn = makeScenario(1, 0, 2); scn.startWeekday = 0;      // β cells: eight stages
        const r = new Reactor(scn, mulberry32(1));
        const lab = new Lab(scn, mulberry32(2));
        lab.readOnline(r, 0); lab.sample(r, 0);
        check("lab: a sample taken now is not on the bench yet", lab.latest("glc") == null);
        lab.readOnline(r, 1); lab.sample(r, 1);
        check("lab: metabolites arrive after 1 h", lab.latest("glc") != null && Math.abs(lab.latest("glc") - 17.5) < 2, `${lab.latest("glc")}`);
        check("lab: the count takes 3 h", lab.latest("viable") == null);
        for (let t = 2; t <= 5; t++) { lab.readOnline(r, t); lab.sample(r, t); }
        check("lab: count and flow on the bench by 5 h",
            lab.latest("viable") != null && lab.latest("m0") != null && lab.age("glc", 5) === 5);
        check("lab: marker slots past the end of the chain read zero",
            lab.latest("m7") != null && lab.latest("m7") < 0.1, `m7 = ${lab.latest("m7")}`);
    }
    // events reach the plant
    {
        const scn = makeScenario(1, 0, 0);
        scn.events = [{ type: "gasOutage", t0: 10, t1: 20, mag: 1 }, { type: "agitatorFault", t0: 30, t1: 40, mag: 25 }];
        const d1 = disturbancesAt(scn, 15), d2 = disturbancesAt(scn, 35), d3 = disturbancesAt(scn, 50);
        check("events: gas outage and stirrer fault apply in their windows",
            !d1.gasOK && d1.pumpOK && d2.rpmOverride === 25 && d3.gasOK && d3.rpmOverride == null);
        const f = probeFaultsAt({ events: [{ type: "pHDrift", t0: 0, t1: 360, mag: 0.2 }], hours: 360 }, 48);
        check("events: pH drift ramps in over 48 h", Math.abs(f.pHOffset - 0.2) < 1e-9);
    }
    // scenarios are deterministic and the ladder adds trouble
    {
        const a = makeScenario(11, 3, 1), b = makeScenario(11, 3, 1);
        check("scenario: deterministic from its seed", JSON.stringify(a.events) === JSON.stringify(b.events) &&
            a.seedDensity === b.seedDensity && a.linKey === b.linKey);
        let e0 = 0, e4 = 0;
        for (let s = 1; s <= 30; s++) { e0 += makeScenario(s, 0).events.length; e4 += makeScenario(s, 4).events.length; }
        check("scenario: rung 0 has no events, rung 4 has several", e0 === 0 && e4 / 30 >= 2, `${e0} vs ${(e4 / 30).toFixed(1)} per run`);
        // the product rotates independently of the ladder
        const plan = episodePlan(10, 3, 4);
        check("curriculum: a generation's plan covers every product",
            new Set(plan.map(p => p.lin)).size === N_LIN, `${new Set(plan.map(p => p.lin)).size} of ${N_LIN}`);
        check("curriculum: episode 0 is the hardest unlocked rung and rung 0 is always in the mix",
            plan[0].level === 4 && plan.some(p => p.level === 0));
    }
}

/* ------------------------------------------------------ 2. fitness scale */
/* The section that exists because of a bug. */
if (mode === "all" || mode === "scale") {
    console.log("\n-- the fitness scale (every product must be worth making) --");
    for (const L of LINEAGES) {
        const s = sopRuns(L, null, 5);
        check(`${L.key}: the protocol beats the neutral reactor by a wide margin`,
            s.score - s.neutral > 40, `${s.score.toFixed(0)} vs ${s.neutral.toFixed(0)}`);
        check(`${L.key}: ...and lands near what this protocol is supposed to achieve`,
            s.score > 35 && s.score < 160, `score ${s.score.toFixed(0)}`);
        check(`${L.key}: the protocol never loses the culture on rung 0`, s.lost === 0, `${s.lost}/${s.n}`);
        // and the plant reproduces its own reference, which is what the
        // reference was measured from — a guard against silent drift
        check(`${L.key}: yield and purity within 40 % of its reference (${L.ref.fold} fold, ${pct(L.ref.purity)})`,
            s.fold > 0.6 * L.ref.fold && s.fold < 1.6 * L.ref.fold &&
            s.purity > 0.6 * L.ref.purity && s.purity < 1.6 * L.ref.purity,
            `fold ${s.fold.toFixed(2)}, purity ${pct(s.purity)}`);
    }
    // the do-nothing reactor is the cautionary tale, on every product
    for (const L of LINEAGES) {
        const w = new World([], { seed: 1, level: 0, lin: L.idx }).run();
        check(`${L.key}: never exchanging the medium goes yellow and dies`,
            w.nothing.r.pH < 6.9 && w.nothing.result.failed,
            `pH ${w.nothing.r.pH.toFixed(2)}, ${w.nothing.result.failReason}`);
        check(`${L.key}: the neutral reactor is alive and useless`,
            !w.neutral.result.failed && w.neutral.result.productPerML < 0.02 * L.ref.fold * w.scn.seedDensity,
            `score ${w.neutral.result.score.toFixed(1)}, product ${w.neutral.result.productPerML.toFixed(3)}`);
    }
}

/* ------------------------------------------------------------ 3. biology */
if (mode === "all" || mode === "biology") {
    console.log("\n-- biology: every reagent each protocol doses is worth having --");
    for (const L of LINEAGES) {
        const base = sopRuns(L, null, 5);
        for (let i = 0; i < L.nCue; i++) {
            const off = sopRuns(L, (a) => { a.cue[i] = 0; }, 5);
            check(`${L.key}: without ${L.cues[i].short} the batch is worth far less`,
                off.score <= 0.65 * base.score,
                `${off.score.toFixed(0)} vs ${base.score.toFixed(0)} (product ${off.product.toFixed(2)} vs ${base.product.toFixed(2)}, purity ${pct(off.purity)} vs ${pct(base.purity)})`);
        }
    }

    console.log("\n-- biology: the failure modes the papers describe --");
    // CARDIAC: the GiWi window and lactate selection
    {
        const L = LIN_BY_KEY.cardiac, base = sopRuns(L, null, 5);
        const noSel = sopRuns(L, (a) => { if (a.medium === 2) a.medium = 0; }, 5);
        check("cardiac: skipping lactate selection collapses purity",
            noSel.purity < 0.6 * base.purity, `${pct(noSel.purity)} vs ${pct(base.purity)}`);
        check("cardiac: ...but most cardiomyocytes survive selection (the immature ones do not)",
            base.product > 0.55 * noSel.product, `${base.product.toFixed(2)} vs ${noSel.product.toFixed(2)} without`);
        const early = sopRuns(L, (a, t) => { a.medium = (t >= 96 && t < 192) ? 2 : (a.medium === 2 ? 0 : a.medium); }, 5);
        check("cardiac: selecting at days 4–8 instead of 10–13 collapses purity",
            early.purity < 0.6 * base.purity, `${pct(early.purity)} vs ${pct(base.purity)}`);
        const weak = sopRuns(L, (a) => { if (a.cue[0] > 0) a.cue[0] = 3; }, 5);
        const over = sopRuns(L, (a) => { if (a.cue[0] > 0) a.cue[0] = 12; }, 5);
        check("cardiac: a weak CHIR dose costs most of the batch", weak.score < 0.6 * base.score, `${weak.score.toFixed(0)} vs ${base.score.toFixed(0)}`);
        // ...though not as much: the optimum is broad above and sharp below,
        // which is what the GiWi dose series reports.
        check("cardiac: so does an overdose, though less", over.score < 0.75 * base.score, `${over.score.toFixed(0)} vs ${base.score.toFixed(0)}`);
        const slow = sopRuns(L, (a) => { a.rpm = 30; }, 5);
        const fast = sopRuns(L, (a) => { a.rpm = 110; }, 5);
        check("cardiac: 30 rpm fuses the aggregates past 300 µm", slow.aggD > 300, `${slow.aggD.toFixed(0)} µm`);
        check("cardiac: 110 rpm shears them small", fast.aggD < 150, `${fast.aggD.toFixed(0)} µm`);
        const expa = sopRuns(L, (a) => { a.medium = 1; }, 5);
        check("cardiac: staying in expansion medium leaves pluripotent cells and a penalty",
            expa.residual > 0.02 && expa.score < 0, `${pct(expa.residual)} TRA-1-60⁺, score ${expa.score.toFixed(0)}`);
    }
    // DOPAMINERGIC: the caudalisation window is the whole problem
    {
        const L = LIN_BY_KEY.dopa, base = sopRuns(L, null, 5);
        const half = sopRuns(L, (a) => { a.cue[2] *= 0.5; }, 5);
        const dbl = sopRuns(L, (a) => { a.cue[2] *= 2; }, 5);
        check("dopaminergic: half the CHIR dose (too rostral) costs most of the batch",
            half.score < 0.6 * base.score, `${half.score.toFixed(0)} vs ${base.score.toFixed(0)}, purity ${pct(half.purity)}`);
        check("dopaminergic: twice the CHIR dose (too caudal) does too",
            dbl.score < 0.6 * base.score, `${dbl.score.toFixed(0)}, purity ${pct(dbl.purity)}`);
        const smadShort = sopRuns(L, (a, t) => { if (t > 72) a.cue[0] = 0; }, 5);
        check("dopaminergic: stopping dual-SMAD inhibition at day 3 loses the neural route",
            smadShort.score < 0.75 * base.score, `${smadShort.score.toFixed(0)}`);
    }
    // β CELLS: the cue ORDER, and glucose during maturation
    {
        const L = LIN_BY_KEY.beta, base = sopRuns(L, null, 5);
        const early = sopRuns(L, (a, t) => { if (t >= 144) a.cue[4] = Math.max(a.cue[4], 1.0); }, 5);
        check("β cells: inducing the endocrine programme early makes polyhormonal cells",
            early.purity < 0.8 * base.purity, `${pct(early.purity)} vs ${pct(base.purity)}`);
        const longPulse = sopRuns(L, (a, t) => { if (t < 72) a.cue[1] = 3.0; }, 5);
        check("β cells: a three-day Wnt pulse makes mesoderm instead of endoderm",
            longPulse.score < 0.75 * base.score, `${longPulse.score.toFixed(0)} vs ${base.score.toFixed(0)}`);
        const fed = sopRuns(L, (a, t) => { if (t > 20 * 24) { a.glcFeed = 1.2; if (a.medium === 2) a.medium = 0; } }, 5);
        check("β cells: glucose through maturation costs the glucose response",
            fed.func < 0.8 * base.func, `${fed.func.toFixed(2)} vs ${base.func.toFixed(2)}`);
    }
    // KIDNEY: the pulse LENGTH, and size is the point
    {
        const L = LIN_BY_KEY.kidney, base = sopRuns(L, null, 5);
        const short = sopRuns(L, (a, t) => { if (t >= 48) a.cue[0] = 0; }, 5);
        const long = sopRuns(L, (a, t) => { if (t < 168) a.cue[0] = 7.0; }, 5);
        check("kidney: a two-day CHIR pulse gives the wrong intermediate mesoderm",
            short.score < 0.7 * base.score, `${short.score.toFixed(0)} vs ${base.score.toFixed(0)}`);
        check("kidney: a seven-day pulse is just as wrong the other way",
            long.score < 0.75 * base.score, `${long.score.toFixed(0)}`);
        const held = sopRuns(L, (a, t) => { if (t > 11 * 24) a.cue[1] = 180; }, 5);
        check("kidney: FGF9 never withdrawn leaves progenitors that never build a nephron",
            held.score < 0.7 * base.score, `${held.score.toFixed(0)}`);
        const stirred = sopRuns(L, (a) => { a.rpm = 90; }, 5);
        check("kidney: stirring hard keeps the organoids too small to self-organise",
            stirred.aggD < base.aggD * 0.75 && stirred.score < 0.8 * base.score,
            `${stirred.aggD.toFixed(0)} µm vs ${base.aggD.toFixed(0)} µm, score ${stirred.score.toFixed(0)}`);
        check("kidney: the protocol itself grows them big, unlike every other product",
            base.aggD > 350, `${base.aggD.toFixed(0)} µm`);
    }
    // HEPATIC: the maturation week, and oxygen
    {
        const L = LIN_BY_KEY.hepatic, base = sopRuns(L, null, 5);
        const cut = sopRuns(L, (a, t) => { if (t > 16 * 24) a.cue[3] = 0; }, 5);
        check("hepatic: cutting the oncostatin M week short leaves hepatoblasts",
            cut.score < 0.85 * base.score, `${cut.score.toFixed(0)} vs ${base.score.toFixed(0)}`);
        /* Force an absolute oxygen fraction rather than subtracting from the
         * controller's: the protocol's DO loop has integral action and simply
         * winds itself back up against a subtraction, so the first version of
         * this check was measuring nothing. */
        const lowO2 = sopRuns(L, (a) => { a.o2 = 0.10; }, 5);
        check("hepatic: a hepatocyte held short of oxygen loses its drug-metabolising activity",
            lowO2.func < 0.85 * base.func, `${lowO2.func.toFixed(2)} vs ${base.func.toFixed(2)}`);
    }

    console.log("\n-- biology: shared to every product --");
    for (const L of LINEAGES) {
        const base = sopRuns(L, null, 3);
        const noPerf = sopRuns(L, (a, t) => { if (t > 120) a.perf = 0; }, 3);
        check(`${L.key}: no medium exchange after day 5 → lactate, acid, death`,
            noPerf.viability < base.viability - 0.03 && noPerf.score < 0.7 * base.score,
            `viability ${pct(noPerf.viability)} vs ${pct(base.viability)}, score ${noPerf.score.toFixed(0)}`);
    }
    // the ladder hurts every protocol but does not kill it
    for (const L of LINEAGES) {
        const s0 = sopRuns(L, null, 6, 0), s4 = sopRuns(L, null, 6, 4);
        check(`${L.key}: rung 4 scores lower than rung 0`, s4.score < s0.score, `${s0.score.toFixed(0)} → ${s4.score.toFixed(0)}`);
        check(`${L.key}: ...without losing the culture`, s4.lost === 0, `${s4.lost} of ${s4.n} lost`);
    }
}

console.log(`\n${failures === 0 ? "all checks passed" : failures + " check(s) FAILED"}`);
process.exit(failures ? 1 : 0);
