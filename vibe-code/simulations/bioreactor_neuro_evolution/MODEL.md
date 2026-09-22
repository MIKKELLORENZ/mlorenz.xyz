# What this model is, and what it is not

This is a control problem built out of the mechanisms a stem-cell process
engineer actually reasons with — not a validated digital twin of any cell line,
vessel or protocol. Every dose and every day window below is from the published
protocol it names. Every **rate** was either taken from the range the
literature reports or **tuned** so that the standard protocol lands where the
papers say it lands. The tuned ones are marked.

The point of the exercise is the *shape* of the problem: a culture whose state
you can only partly see, hours or days late; cues that must arrive in the right
order at the right dose for the particular line you were handed; a medium the
cells themselves poison; aggregates that grow until their centres suffocate; a
lab that goes home at the weekend — and five different products, ordered one
batch at a time, made in the same vessel with the same six pumps.

## The five processes

| product | route | days | reagents | what it teaches the controller |
|---|---|---|---|---|
| cardiomyocytes | GiWi (Lian 2012/13), lactate selection (Tohyama 2013) | 15 | CHIR99021, IWP2 | a two-cue pulse programme, then a metabolic purification |
| midbrain dopamine neurons | floor plate (Kriks 2011, Kirkeby 2012/17) | 25 | LDN+SB, SHH agonist, CHIR, FGF8, BDNF/GDNF/AA/dbcAMP/DAPT | one dose sets position on an axis, and the window is narrow |
| pancreatic β cells | six stages (Rezania 2014, Pagliuca 2014, Hogrebe 2020) | 33 | Activin A, CHIR, retinoic acid, SANT-1, ALK5i+XXi+T3, LDN | the cue **order**, and a product that de-differentiates in glucose |
| kidney organoids | Takasato/Little, Morizane | 18 | CHIR (its **duration**), FGF9 | self-organisation needs big aggregates, which fights oxygen |
| hepatocyte-like cells | four-cue relay (Si-Tayeb 2010, Hay) | 20 | Activin A, BMP4+FGF2, HGF, OSM+dex | a maturation step that barely works, and oxygen-hungry function |

The plant (`bioreactor.js`) contains none of this. It knows that cells sit in a
chain of stages, that each step has a rate, that the rate depends on the signals
the cells feel at that moment and on whether there is fuel to pay for it, and
that every stage can leak into a sink of things the culture became by accident.
The five tables live in `lineages.js`. Adding a sixth product is adding a table:
nothing in the plant, the sensors, the scoring, the network or the page is
lineage-specific.

## Cells: a chain of stages, cue-gated

Each lineage names its own chain — four steps for cardiomyocytes, seven for β
cells — starting from the same pluripotent stage and draining into the same
off-target sink. Per stage: maximum specific growth rate (0.0005–0.030 /h),
glucose, oxygen and glutamine uptake (0.08–0.20, 0.05–0.16, 0.020–0.030
pmol/cell/h), lactate yield (0.8–1.8 mol/mol, glycolytic progenitors high and
oxidative mature cells low), cell volume (900–1600 µm³), and multipliers on
shear and starvation sensitivity. All within reported ranges for hPSC and their
derivatives; the split between stages is tuned.

### How a fate decision is written, and why it matters more than any constant

Cells leave a stage on a **clock** `k` — gated by fuel, by the environment, and
by whatever *instructive* signal drives that particular step. What the signals
decide is the fraction `q` of departing cells that arrive where the protocol
intended:

```
stage i → stage i+1   at  k · q
stage i → off-target   at  k · (1 − q)  +  a small unconditional drift
```

Three versions of this were wrong before it worked, and all three are recorded
here because they are the kind of error a plausible-looking model hides.

1. **Additive leaks.** Written as an independent off-target rate, the leak
   fired on the days *before* the protocol had dosed the signal that step
   needs. The neuroepithelium drained to the sink at 0.056/h while advancing at
   0.004/h, and four of the five chains emptied before their cues arrived.
   Cardiomyocytes were unaffected — their Wnt terms were already a split
   written longhand, `0.03·(1 − Wnt)` against `0.04·Wnt`.
2. **Clocks that ran without a driver.** With the split in place but `k`
   constant, β cells still left the gut-tube stage at 2.2 %/h from day 2 while
   retinoic acid was not dosed until day 5, so most of the pool committed with
   `q = 0.14` before the window opened. A cell with no instructive signal
   waits; it does not commit blindly. Gating `k` on the driver is also what
   makes cue **order** the control problem, since the modifier has to be in
   place before the driver arrives.
3. **Mid-chain stages that could regrow a lost pool.** At the 0.014–0.024 /h a
   progenitor can manage, a ruined fate decision cost almost nothing: removing
   the one-day Wnt pulse from the β-cell protocol sent 65 % of the definitive
   endoderm off-target exactly as designed — 0.16 M/mL instead of 0.41 — and
   the final product came out 8 % lower, because the surviving third divided
   four times on the way down the chain and refilled the vessel. Early cue
   accuracy was free, which is the opposite of the process being modelled. The
   published yields are on the order of one usable cell per cell seeded over
   three to four weeks, and the model now reproduces that *stage by stage*
   rather than only in total.

The instrument that found all three is `node calibrate.js <product> --steps`,
which prints `q` per step per hour and the cells-weighted mean that actually
compounds. A step reading 0.5 while the protocol is being followed exactly is a
modelling error, not a hard protocol: five steps at 0.5 is 3 % purity however
good the rest of the plant is.

### Two more mechanisms the calibration forced

- **Pluripotent cells do not linger.** The β-cell and hepatic protocols drive
  their cells out of pluripotency over about two days and then have no further
  use for the stage, and whatever was left was surviving to harvest: 3–6 %
  residual TRA-1-60⁺ cells, against a penalty whose half-max is 3 %. That
  multiplied their terminal score by 0.2–0.5 and was the entire reason those
  two protocols looked unprofitable to run. Real protocols come in under 1 %,
  and residual pluripotency is the headline safety problem for exactly these
  grafts. A cell with no pluripotency factors in its medium now leaves at
  0.024 /h, half by death and half by drifting off-target. (TUNED)
- **Sustained Wnt acts on the endoderm, not only on the decision.** Prolonged
  Wnt signalling after definitive endoderm is specified drives it back towards
  mesendoderm. Written only as a commitment-quality term, extending the
  protocol's one-day CHIR pulse to three days cost 6 % of the batch, because
  most of the endoderm has committed inside the first day and a longer pulse
  could only reach the tail. As a leak on the stage itself it costs what the
  papers say it costs.

### Three more mechanisms, forced by running β cells to their real length

The β-cell protocol ran for thirty-three days here for the first time after a
fact-check said it should, and six extra days of a *correct* protocol took its
purity from 26 % to 17 %. Three separate faults had been hiding behind a run
that stopped too early, and the obvious suspect was not one of them.

- **Proliferation is driven, not only advancement.** A stage whose instructive
  signal has gone stops dividing as well as stopping its clock. Without that,
  the gut-tube pool stranded when retinoic acid came out kept doubling every
  fifty hours in factor-free maturation medium and was the largest population
  in the vessel at harvest — 0.15 → 0.45 M/mL over the last twelve days while
  the product itself fell 0.36 → 0.28. The off-target growth rate looked like
  the culprit and was innocent: sweeping it over a factor of 3.3 moved purity
  not at all. A lineage now returns `prolif` from `dyn()` beside `kStep` and
  `kOff`. (TUNED: quiescent progenitors keep 12 % of their rate.)
- **A per-stage attrition floor.** The 0.002 /h baseline death charged equally
  to every compartment removes four fifths of it over 792 hours, and it fell
  hardest on the cell that should be hardiest — a post-mitotic product sitting
  in its own maintenance medium. The β pool peaked on day 21 and decayed to two
  thirds of that by day 33, so the glucose response fell from 0.78 to 0.66,
  where every stage-6 paper says the C-peptide⁺ fraction *holds* while its
  function improves. `att` (default 1) is what that floor is worth per stage.
- **Starving the culture is opt-in.** `protocol.js` read "medium 2" as the
  glucose-free lactate selection, which is true of cardiomyocytes and of
  nothing else. The β, kidney and hepatic maturation media are fed media at
  5.6–9.0 mM, and all three were being deliberately starved for the last third
  of every run: β ran down to 1.2 mM against a 5.6 mM medium, with 1.03 M/mL of
  starvation deaths. A lineage now names the medium it means, with `glcCap`.

The scoring had a matching fault in the same place. The glucose-response
readout's half-max sat at 8 mM, so it paid *more* the deeper the culture ran
down — 0.67 at the published 5.6 mM against 0.98 at 1.2 mM. The model was
rewarding a vessel for starving the product it was scored on. There is full
credit at or below the published concentration now, and nothing for going
lower. Fixing the three mechanisms took β to 30 % purity, a yield of 0.62 and
an insulin response of 0.88; the feeding fix alone was worth 1.56 → 2.22 fold
on kidney organoids and 1.37 → 2.02 on hepatocytes.

### Signal transport

The dose in the vessel is not the dose at the cell. Each reagent is diluted by
cell density and by how far it has to diffuse into an aggregate:

```
effective = dose × lot potency ÷ (1 + Nv/4)^dilExp ÷ (1 + (d/500 µm)²)^penExp
```

Small molecules: `dilExp` 0.35, `penExp` 1.0, first-order loss 0.02 /h.
Proteins: 1.1, 1.3, 0.10 /h — a growth factor is consumed by its own receptors
and falls apart, which is why protocols re-feed them daily. Both sets of
exponents are tuned, and both were tuned *after* being wrong: at 1.0 for small
molecules every identity window drifted out from under its own protocol as the
culture grew (a culture at 2.5 M/mL felt 1.4 µM of a 3 µM CHIR dose), and at
1.5/1.8 for proteins the hepatic maturation cue arrived five times weaker than
it was dosed and that chain never finished.

Some decisions depend on how **long** a signal has been on rather than how
strong: the length of the CHIR pulse sets how far back along the primitive
streak a kidney cell ends up, and a Wnt pulse held three days instead of one
turns definitive endoderm into mesoderm. That is accumulated as *signal-hours*,
in proportion to the strength of the signal — not as hours above a threshold,
which was tried and was treacherous: the kidney protocol's effective dose sits
right on top of its line-dependent threshold, so a slightly insensitive line
stopped counting abruptly and the median score of that protocol moved by a
factor of two and a half between two banks of fifteen batches. Hard thresholds
on quantities that sit at the threshold do not belong in a plant model.

### Growth limits

Growth is scaled by the environment (lactate, ammonia, pH, oxygen,
temperature), by aggregate size, and by a **density cap**, `1/(1 + (Nv/6.5)³)`:
real stirred hPSC and progenitor cultures plateau between 2 and 5 M/mL whatever
you feed them. Without that term the off-target sink compounds for
twenty-seven days and no long protocol can be pure at the end; with it the
vessel fills up and the question becomes what it fills up *with*. (TUNED.)

The sink's own growth rate is per lineage (0.0015–0.012 /h), because the
off-target cells of a cardiac run are proliferating mesoderm and those of a
β-cell run are polyhormonal cells that barely divide. One shared rate made
every protocol longer than fifteen days come out at 8 % purity.

## Aggregates

Single cells form aggregates over the first ~12–18 h; how many cells each gets
is the lineage's own number (400 for cardiac at 60 rpm, 1400 for kidney
organoids, 700 for neurospheres), fewer and larger when stirred slower.
Afterwards the count falls by fusion, ∝ A² × (60/rpm)², and rises by breakup
above ~110 rpm. Mean diameter follows from cells per aggregate at 70 % packing.
This is a single mean size, not a distribution; the CV the lab reports is
synthetic.

**Hypoxic core.** The classic zero-order-consumption result for a sphere,
r_crit = √(6·D·C / q), reduced to r_crit = 92 µm × √(DO_fraction / q) with D,
packing and units folded into the constant. K = 92 µm was chosen so a
pluripotent aggregate goes hypoxic in the core above ~520 µm at 40 % DO and a
cardiomyocyte aggregate above ~340 µm. A neuron or a hepatocyte breathes harder
and suffocates smaller, which falls out of its own oxygen demand rather than
being a separate rule. Cells in the core die at 0.06 /h × core volume fraction.

Every lineage wants a different size, and the kidney wants the opposite of the
rest: a nephron will not form in a 150 µm ball, so the controller has to grow
the organoids deliberately, which means slowing the stirrer, which means it
must then hold the oxygen up to keep the cores alive.

## Medium and gas

- Three medium slots per lineage: a differentiation basal, an expansion medium
  that maintains pluripotency, and a late medium (lactate selection for
  cardiac, low-glucose maturation for β cells, neuronal maturation, organoid
  maintenance, hepatocyte maintenance). Glucose, glutamine, lactate,
  bicarbonate and osmolality from the products they stand in for. Perfusion
  retains cells and dilutes everything else.
- **pH is Henderson–Hasselbalch**: 6.1 + log₁₀([HCO₃⁻] / (0.0307 × pCO₂)).
  Lactate titrates bicarbonate one for one; CO₂ from respiration and from the
  gas dissolve; base is sodium bicarbonate. 24 mM under 5 % CO₂ gives 7.41.
- DO from kLa × (DO* − DO) − OUR, with kLa = 1.2 × (rpm/60)^1.4 /h (a
  headspace-aerated small vessel) and DO* set by the O₂ fraction. A gas outage
  leaves surface transfer only (0.15 /h).
- Glutamine decomposes to ammonia at 0.003 /h in the RPMI-type feeds and not in
  the dipeptide-stabilised expansion medium. A vessel full of hepatocytes
  clears its own ammonia, which is the one place where the product improves its
  own environment.
- Osmolality rises with base and glucose concentrate. Temperature is a heater
  loop with a 30-minute time constant; rates scale by Q10 = 2.5 below 37 °C and
  cells die above ~38.5 °C.

## What the lab sees

Online every hour: DO (±1.5 %), pH (±0.01), temperature, capacitance biovolume
(±3 %, reported in pluripotent-cell equivalents — big mature cells read high),
off-gas oxygen uptake (±5 %), and the phenol red colour, which is a pH
indicator and nothing else.

Offline, when someone is there: metabolites at 09:00 and 17:00 (1 h
turnaround), a count with viability and aggregate imaging at 09:00 (3 h), flow
cytometry every second lab day (5 h). Nothing at weekends unless the rung
allows a weekend technician. The controller sees each value with its age.

The flow panel is **generic**: eight marker slots, `m0` for the pluripotency
marker and `m1…m7` for the stages of whichever chain is running, plus the
lineage's functional readout — beating, spontaneous firing, glucose-stimulated
insulin, tubule formation, CYP3A4 activity. Each marker reads mostly its own
stage with a little of the neighbours (0.92 own, 0.10 younger, 0.06 older) and
±3 % absolute noise, because a marker is never clean. Slots past the end of the
chain read zero.

Probe faults: a pH offset ramping in over two days, a DO gain error, a
capacitance gain creeping up as the probe fouls.

## Scoring

Terminal, at harvest, and measured **against what that product can be**:

```
100 × (fold/ref) × (purity/ref)² × viability × residual penalty × (0.6 + 0.4 × function/ref)
```

minus media and reagents, minus a small per-hour term for a reactor held
outside its physiological bands. A lost culture scores −60.

The reference for each product is the median of its own published protocol over
forty batches (`node calibrate.js --refs`), and the reagent bill is normalised
the same way. This is not cosmetic. Written absolutely — `100 × fold ×
purity²`, a perfectly good scale for one protocol — four of the five scored
*below* a reactor nobody touched: purity² is quadratic in a ceiling that
differs by a factor of three between products, and thirty-three days of growth
factors topped up against a ten-hour half-life cost more than the batch was
worth. A genetic algorithm would have learned to make nothing at all, and the
training curve would have looked healthy while it did.

**And normalising per product is still not enough on its own.** Fitness is the
mean advantage over a generation's batches, and each batch's advantage is
divided by *that batch's* own protocol-minus-neutral gap — which differs
between products. The β-cell protocol scored 58 against a neutral of −17 at the
time, so a
point of purity on a β-cell batch is worth about four times a point of purity
on a cardiac batch. Left with the per-episode clip at 3, the search did the
rational thing: it drove β cells to an advantage of 4.0 and hepatocytes to 3.1
while letting cardiomyocytes fall to 0.74 and kidney organoids to 0.23. The
mean looked excellent, the weakest-product gate on the ratchet passed (0.36 is
not a failure), and two of the five products were quietly being abandoned. The
clip is now 1.5: beating a protocol by half is the most any single batch can
contribute, so the only way to raise the mean is to raise the floor.

One consequence of `purity²` is worth naming rather than hiding. It makes
buying purity with yield rational, and the shipped brain does exactly that on
cardiomyocytes: 89 % purity against the protocol's 70 %, at 1.58 fold against
its 2.14. It gets there by holding the Wnt inhibitor for all fifteen days
instead of its 48-hour window, running a 5.5-day lactate selection instead of
three, and keeping CHIR on out to day 9.4 rather than the published two — with a
spread across batches of 3.5 to 12.1 days, which says the exact exit day is not
the thing it is controlling.

What it does not do is pay. That batch scores 64 against the protocol's 73 and
wins nine batches in twenty-four: with `ref.fold` at 2.28, the yield it gives
up still costs more than its nineteen points of purity return. Three
successive champions, two of them trained entirely against corrected
references, have all made the same trade — which says the cardiac yardstick is
simply the hardest of the five to beat rather than that any one brain is
confused. A protocol that already turns one cell into 2.14 leaves very little
room above it. It remains a choice the scoring makes, not one the biology
forces.

## Where the calibration landed

`node calibrate.js --refs --n 15`, rung 0, and `--steps` for the chain:

| product | chain efficiency | yield (per cell seeded) | purity | function | protocol score | neutral |
|---|---|---|---|---|---|---|
| cardiomyocytes | 51.5 % | 2.28 | 70 % | beating 1.00 | 75 | −5 |
| dopamine neurons | 27.5 % | 0.83 | 39 % | firing 0.95 | 59 | −14 |
| β cells | 19.0 % | 0.62 | 30 % | insulin response 0.88 | 53 | −21 |
| kidney organoids | 29.6 % | 2.22 | 28 % | tubules 0.64 | 76 | −12 |
| hepatocytes | 27.7 % | 2.02 | 22 % | CYP3A4 0.17 | 80 | −8 |

Chain efficiency is the product of the per-step `q` values weighted by the
cells actually flowing through each step — an upper bound on purity before
growth and death. The realised purities sit inside the bands the papers report
(60–90 % cTnT⁺; 30–60 % TH⁺; C-peptide⁺ at 33 % in Pagliuca and 31 % in Hogrebe's
planar protocol, rising to ~50 % in Rezania and 52–73 % in the best maturation
work; 16.7–39 % of an organoid in nephron structures depending on whose
single-cell census you take; ALB⁺ easy and CYP3A4 a fraction of primary
hepatocytes),
which is the whole calibration target.

## Checked against the papers, afterwards

The five schedules were tuned first and fact-checked against the primary
literature afterwards, which is the wrong order but a useful one: it shows
which numbers the calibration method got right on its own.

**What the check confirmed.** The cardiac CHIR dose of 7.5 µM is the published
*suspension* optimum (Kempf et al. 2014 report exactly 7.5 µM as optimal, with
10–15 µM reducing both cardiomyocyte content and yield; the original GiWi
monolayer protocol uses 12 µM, and suspension work generally sits lower at
5–7.5 µM). The lactate selection medium — glucose-free with 4 mM lactate — is
exactly what Tohyama and Burridge use. The cardiac yield of ~2.2 cardiomyocytes
per input cell matches the aggregate-suspension norm of about 2 (monolayer and
microcarrier papers quote 40–100, counting from a pre-expansion seeding, which
is an accounting difference rather than a biological one). Cardiac purity of
71 % sits in the 70–90 % modal band for unselected differentiation, agitation
of 60–70 rpm inside the published 33–75, and IWP2 at 5 µM for 48 h is the GiWi
value.

**What it corrected.** The kidney protocol's CHIR is 8 µM, its FGF9 is
200 ng/mL with 1 µg/mL heparin, its second CHIR pulse is 5 µM for **one hour**
at aggregation on day 7 (not a day-long pulse at day 11), FGF9 runs to day 12,
and the whole protocol is 7 + 18 = **25 days**, not 18. The hepatic
specification window is days **5–10**, not 3–8, which shifted HGF to 10–15 and
oncostatin M to 15–20. Lengthening the kidney run immediately broke the
FGF9-withdrawal check, because fourteen extra days let a 3 % residual
differentiation rate convert the whole progenitor pool anyway; withdrawal now
blocks completely and a progenitor parked in FGF9 drifts.

The β-cell protocol is **thirty-three days**, not twenty-seven. Stages 1–5 take
about nineteen days and stage 6 another seven to twenty-five, and every
Melton/Millman protocol first assays a glucose response around day 33–35. The
twenty-seven days used here is Nair's figure, which is only reachable by
sorting the cells and re-aggregating them — neither of which is modelled. The
same check confirmed what was already right: CHIR99021 at 3 µM for the first
twenty-four hours only, Activin A at 100 ng/mL for three to four days, retinoic
acid at 2 µM, SANT-1 at 0.25 µM, and a 5.6 mM maturation medium — which is CMRL
1066's own base glucose rather than anything added to it. The measured yield of
0.62 β cells per cell seeded is Rezania's "one NKX6.1⁺/insulin⁺ cell at S7 from
every two hESCs", which nothing here was tuned to hit. It also named a
mechanism this model lacked: taking ALK5i and T3 out is what raises insulin
secretion, and it does so at an *unchanged* C-peptide⁺ fraction, so it belongs
in the functional readout and not in the maturation clock. It is gated on a
trailing two-day average, so a controller cannot shut the pump in the final
hour and collect the credit.

**What is knowingly left wrong.**

- **Cardiac day numbering.** CHIR goes in on day 1 here, after a day of
  aggregation in expansion medium. Monolayer protocols call that differentiation
  day 0. The offset is real in suspension — you aggregate before you induce —
  but a reader comparing day numbers to Lian et al. will find them shifted by
  one.
- **Dopaminergic purity at day 25.** The floor-plate protocols report ~25 %
  TH⁺ at day 25 and ~50 % by day 40. This model gets 39 % at day 25, which is
  closer to a day-30 culture. Extending the run to 40 days would be more
  faithful and cost 60 % more compute per episode for no change to the control
  problem.
- **Dopaminergic FGF8 window.** There are two protocol families and this model
  mixes them. Its CHIR (3 µM from day 1) is the Studer/Kriks dose and window;
  its FGF8b at 100 ng/mL from day 2 to 13 is neither Kriks (days 1–7, early)
  nor Lund/Nolbrant (days 9–16, late, where early FGF8b is *actively harmful*
  and contaminates the culture with non-midbrain fates). Kriks describes FGF8
  as having "only marginal effects" beside CHIR, which is roughly the weight it
  carries here, so the consequence is small — but the window is wrong for
  either lineage.

  What the same check **confirmed** is the part that matters most for the
  control problem: the caudalisation cliff is real and sharper than modelled.
  Kirkeby used 0.4 against 0.8 µM as the deliberate switch between ventral
  diencephalon and ventral mesencephalon, the usable window is about 0.6–1.0 µM
  (a factor of 1.7, not 2), and practitioners resolve steps as small as 0.2 µM.
  Absolute doses are not portable between labs — 0.7 µM, 2.5 µM and 3 µM are
  all "optimal" in their own medium and matrix, and every line and every
  inhibitor lot needs re-titrating. That is exactly why the dose here is scaled
  by a hidden per-line EC50 the controller is never told.
- **The β-cell gut-tube stage.** Stage 2 of the published protocols carries
  KGF/FGF7 at ~50 ng/mL. All six dosing channels are already spoken for, so the
  step is driven by *Activin withdrawal* instead — the same timing, one fewer
  reagent. It is the one place where a real reagent is missing rather than
  simplified.
- **Hepatic oxygen.** Published protocols run hepatic *specification* at 4 % O₂
  and maturation at ambient. Here the functional readout rewards oxygen
  throughout, which is right for the maturation week and wrong for the five days
  before it.
- **"Mature hepatocytes" is not a published quantity.** The literature reports
  70–90 % ALB⁺ and then says plainly that the cells are fetal-like: CYP3A4
  activity is 50–70× below freshly isolated primary hepatocytes and albumin
  secretion about 8× below. This model's 25 % "hepatocytes" with a functional
  score of 0.21 is a stand-in for that gap, not a measured fraction — which is
  why the hepatic protocol is the one with the most room above it.
- **Kidney nephron fraction.** Single-cell censuses of these organoids
  disagree by more than a factor of two: ~39 % nephron (Wu 2018) against 16.7 %
  (Subramanian 2019), with stroma 40–70 % and off-target 1.6–43.7 % depending
  on the line. This model's 21 % is inside that spread, which is about as much
  as anyone can claim.

## What is deliberately missing

- No spatial structure inside the vessel, no CFD, no mixing time.
- No size distribution — one mean diameter.
- No contamination, no mycoplasma, no operator error beyond the inoculum count.
- No cell cycle, no apoptosis-vs-necrosis, no secreted-factor accumulation
  beyond the one endogenous Wnt term the cardiac protocol needs.
- No harvest decision: the run ends on the protocol's own day whatever the state.
- Markers map to stages one-to-one and approximately; in reality a stage is a
  distribution over several markers.
- The five protocols are the published ones, not the best possible ones. They
  are the yardstick, not the ceiling — and `experiments.js` already shows one
  of them is beatable by a single change (double the perfusion after day 5).
