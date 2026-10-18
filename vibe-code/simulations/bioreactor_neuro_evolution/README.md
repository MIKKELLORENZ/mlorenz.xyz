# Tending the Culture — bioreactor control by neuroevolution

Half a million human pluripotent stem cells go into a 100 mL stirred bottle.
Two to four weeks later the bottle should be full of whatever was ordered:
beating heart cells, midbrain dopamine neurons, insulin-producing β cells,
kidney organoids, or hepatocytes. Whether it is depends on signals arriving on
the right day at the right dose *in the right order* for the particular cell
line that was handed over, on the medium being changed before the cells poison
it, on the aggregates being the right size for that product, and on nothing
breaking — or on someone noticing when it does.

One network runs the bottle for all five. It sees what a lab sees: probes every
hour, assays hours after the sample was drawn, flow cytometry every other day,
and nothing at all at the weekend. It commands what a lab commands: the gas
mix, the stirrer, the perfusion pump, a glucose feed, **six dosing pumps** and
which of three media to feed. It is told which product was ordered and how many
days are left, and nothing else. It learns by mutation and selection, with no
gradients anywhere, and it is scored against the published protocol for that
product running the identical batch beside it.

Open `index.html`. No build step, no dependencies.

- **`index.html`** — the built-in network against the published protocol,
  batch after batch, every batch a fresh draw of product, cell line and
  faults. The header picks which of the five products to make, or `Any` to
  draw a different one every batch. `?lab=1` evolves a population in the
  browser instead and `?sop=1` shows the published protocol on its own;
  `?lin=beta` (or `0`–`4`), `?level=N`, `?intro=0` and `?bench=N` pick the
  product, cap the difficulty, skip the intro and run N simulated hours
  synchronously for screenshots.
- **`node train.js`** — the headless trainer. `node train.js --bake
  training/checkpoint.json` writes `default_brain.js`.
- **`node test_headless.js`** — engine, fitness-scale and biology regression
  checks (`engine` / `scale` / `biology` to run one section).
- **`node experiments.js`** — every protocol with one thing broken, the fastest
  way to see whether the plant behaves like a culture.
- **`node calibrate.js`** — the tuning instrument: `--refs` measures what a
  good batch of each product is, `<product> --steps` prints the fate split per
  step, `--sweep <pump>` and `--window <pump>` sweep a dose or a day window,
  and `--brain <file>` runs a trained controller as a lab notebook.
- **`node analyse.js default_brain.js`** — what the champion actually does, per
  product: paired comparison against the protocol, the recipe it runs, and
  whether any of it adapts to the hidden cell line.
- **`node imitate.js`** — DAgger distillation of all five protocols into one
  network, for `train.js --init`.
- **`MODEL.md`** — every simplification, named, and which constants were tuned
  rather than measured.

---

## What is being modelled

Five published directed differentiations, in suspension, in the same vessel:

| product | route | days | reagents |
|---|---|---|---|
| cardiomyocytes | GiWi: CHIR then IWP2, then lactate selection | 15 | 2 |
| midbrain dopamine neurons | dual-SMAD → floor plate → neurons | 25 | 5 |
| pancreatic β cells | six stages, endoderm → PDX1/NKX6.1 → NEUROG3 → β | 27 | 6 |
| kidney organoids | a timed CHIR pulse → intermediate mesoderm → nephrons | 18 | 2 |
| hepatocyte-like cells | a four-cue relay, endoderm → hepatoblast → hepatocyte | 20 | 4 |

The plant knows none of that. It knows cells sit in a chain of stages with
cue-gated transitions, and the five tables live in one file. Every mechanism in
it is generic:

- **Stages with cue-gated transitions.** Cells leave a stage on a clock, and
  the signals decide the *fraction* that arrive where the protocol intended;
  the rest are off-target. A missing cue costs exactly the cells that were
  deciding during the hours it was missing, which is why the ORDER and the
  OVERLAP of the cue windows is the control problem rather than a checklist.
- **Every step needs fuel.** A starving cell does not change fate, it dies.
- **Density and geometry modulate the cue.** The dose that works rises with
  cell density and with how far the molecule has to diffuse into an aggregate,
  and a 25 kDa growth factor suffers far more of both than a 400 Da small
  molecule. The same bottle of reagent means a different thing on day 1 and
  day 12.
- **Some decisions are made on duration, not concentration.** How long the Wnt
  signal had been on when a kidney cell committed is what decides whether its
  intermediate mesoderm is the kind that makes nephrons. Three days and four
  days give different organoids.
- **The line is a hidden parameter.** Doubling time, how readily it takes the
  intended fate, how loud its own endogenous signalling is, and its sensitivity
  to every reagent all vary from line to line, and the controller is told none
  of them — only what the assays show, days late.
- **The cells poison their medium.** Glycolytic progenitors make nearly two
  lactate per glucose; lactate titrates the bicarbonate buffer
  (Henderson–Hasselbalch, one H⁺ per lactate), the pH falls, the phenol red
  goes yellow, and above ~25 mM the culture stops growing.
- **Aggregates suffocate from the inside.** A Thiele-modulus critical radius,
  `r_crit ∝ √(DO / q_O₂)`. Slow stirring fuses aggregates; fast stirring shears
  them. Every product wants a different size — and the kidney organoids want
  the opposite of the rest, because a nephron will not form in a 150 µm ball.
  Growing them means slowing the stirrer, which means holding the oxygen up to
  keep the cores alive.
- **A product can be worthless while being present.** A vessel of
  insulin-positive cells that do not answer a glucose challenge is not a vessel
  of β cells, and an immature β cell kept in high glucose de-differentiates. A
  hepatocyte held short of oxygen loses its drug-metabolising activity. Each
  product carries its own functional assay and the score reads it.

Fifteen to twenty-seven days at one control step an hour is 360 to 648
decisions per batch.

## What the controller sees

**103 inputs → 96 → 48 → 15 outputs**, one network for all five products.

Online every hour, noisy: DO, pH, temperature, a capacitance probe, off-gas
oxygen uptake, and the colour of the medium. Offline, when someone is there and
after the assay has run: glucose, lactate, glutamine, ammonia, osmolality
(twice a day, 1 h turnaround); a cell count, viability and aggregate imaging
(daily, 3 h); a flow panel of eight stage markers plus the product's functional
readout (every second lab day, 5 h). Nothing at weekends — the run starts on a
random weekday. Every offline value comes with its age.

Plus **which product was ordered** (five inputs and a countdown), the actuator
echo, per-pump dosing history, and a temporal block: the online channels
differenced at 1, 3, 6, 12 and 24 h, leaky integrals of pH and DO error, and
the rate of change of the last two metabolite samples. A controller that can
see the pH but not whether it is falling cannot tell a culture that is spent
from one that is about to be.

The marker channels are deliberately generic — `m3` means the fourth stage of
whichever chain is running — so the same wires carry a cardiac batch and a
kidney batch, and the network has to learn what they mean in each.

Outputs: O₂ and CO₂ in the gas, base pump, agitation, perfusion rate, glucose
feed, six dosing pumps, and three logits for which medium to feed. A pump this
protocol does not use stays shut whatever the network says.

## What goes wrong

A difficulty ladder, each rung adding a class of trouble and never removing
one: inoculum count error and cell-line variability (rung 0); reagent lots and
a lab calendar with real weekends (1); gas outages, perfusion pump failures, a
stirrer that slows, temperature excursions (2); pH, DO and capacitance probes
that drift (3); everything, bigger and several at once (4).

The **product is not part of the ladder** — every rung draws all five. A
generation runs every product and the hardest unlocked rung, then cycles down
to rung 0, and the trainer will not promote until the *weakest* product is
respectable. Otherwise the search discovers that ignoring hepatocytes is
cheaper than making them, and the mean advantage looks perfectly healthy while
it does.

## Scoring

Terminal, at harvest, measured against what that product can be:

```
100 × (yield/ref) × (purity/ref)² × viability × residual-pluripotency penalty
    × (0.6 + 0.4 × function/ref)
```

minus media and reagents, minus a small per-hour term for a reactor held
outside its physiological bands. A lost culture scores −60. The reference for
each product is the median of its own published protocol over forty batches.

Fitness is the **advantage** between two baselines run on the identical batch:
a neutral reactor (air, 70 rpm, basal medium, no cues — what a fresh network
commands; alive and useless) and the published protocol. 0 is "achieved
nothing", 1 is "as good as the protocol", on every batch of every product
whatever the batch did to the protocol. Without that normalisation the five
could not be trained together at all.

## The protocols, calibrated

Before any brain sees it, the plant was tuned so that each published protocol
lands where the literature says it lands, and then broken one way at a time to
check the failure modes are the ones the papers describe.

| product | yield (per cell seeded) | purity | function | score | neutral |
|---|---|---|---|---|---|
| cardiomyocytes | 2.28 | 70 % cTnT⁺ | beating 1.00 | 75 | −5 |
| dopamine neurons | 0.83 | 39 % TH⁺ | firing 0.95 | 59 | −14 |
| β cells | 0.62 | 30 % | insulin response 0.88 | 53 | −21 |
| kidney organoids | 2.22 | 28 % nephron | tubules 0.64 | 76 | −12 |
| hepatocytes | 2.02 | 22 % | CYP3A4 0.17 | 80 | −8 |

`node experiments.js` breaks each of them. A sample, on cardiomyocytes:

| change to the protocol | product | purity | score |
|---|---|---|---|
| as published | 1.21 M/mL | 67 % | 91 |
| no CHIR | 0.00 | — | −14 |
| CHIR 3 µM (weak) | 0.78 | 52 % | 23 |
| CHIR 12 µM (overdose) | 0.90 | 66 % | 62 |
| no IWP2 | 0.79 | 59 % | 46 |
| IWP2 held all run instead of 48 h | 1.40 | 73 % | 103 |
| no lactate selection | 1.52 | 35 % | 21 |
| selection at days 4–8 instead of 10–13 | 1.41 | 34 % | 17 |
| 30 rpm throughout (aggregates fuse to 365 µm) | 0.86 | 74 % | 77 |
| 110 rpm throughout (sheared to 98 µm) | 0.95 | 64 % | 60 |
| no medium exchange after day 5 (67 % viable) | 0.40 | 66 % | 2 |
| stay in expansion medium | 1.46 | 30 % | −21 |
| **double the perfusion after day 5** | **1.20** | **73 %** | **112** |

Three of those rows are worth dwelling on. An **underdose of CHIR is far worse
than an overdose** (23 against 62), which is the asymmetry the GiWi dose series
reports — the optimum is broad above and sharp below. **Holding the Wnt
inhibitor for the whole run** instead of its 48-hour window scores *better*
than the protocol, which is exactly what the evolved champion of the
single-lineage version of this simulator discovered on its own. And doubling
the perfusion after day 5 is worth twenty points for nothing but medium.

The published protocol is a good recipe. It is not the best one, and that is
the point of the whole exercise.

And one per product, from `test_headless.js biology`:

- **dopamine neurons** — half the CHIR dose makes forebrain, twice makes
  hindbrain, and both cost most of the batch; stopping dual-SMAD inhibition on
  day 3 instead of day 11 loses the neural route.
- **β cells** — inducing the endocrine programme on day 6 instead of day 11
  halves the purity (polyhormonal cells, not β cells); a three-day Wnt pulse
  instead of one turns endoderm into mesoderm; feeding glucose through the
  maturation window destroys the glucose response while leaving the cells
  exactly where they were.
- **kidney organoids** — a two-day CHIR pulse and a seven-day pulse are wrong
  in opposite directions; FGF9 never withdrawn leaves progenitors that never
  build a nephron; stirring at 90 rpm keeps the organoids too small to
  self-organise at all.
- **hepatocytes** — cutting the oncostatin M week short leaves hepatoblasts;
  holding the vessel short of oxygen costs the drug-metabolising activity
  without costing a single cell.

## What the controller learned

The shipped brain is run P, generation 80, baked after winning a 120-batch
paired duel against the champion before it. Measured against the published
protocol on identical draws (`node analyse.js default_brain.js --n 12
--maxlevel 1`):

| product | advantage | purity vs protocol | score vs protocol | batches won |
|---|---|---|---|---|
| cardiomyocytes | 0.78 | 89 % vs 70 % | 64 vs 73 | 9/24 |
| dopamine neurons | 0.65 | 40 % vs 34 % | 67 vs 46 | 14/24 |
| β cells | 1.48 | 45 % vs 29 % | 274 vs 40 | 24/24 |
| kidney organoids | 0.67 | 27 % vs 24 % | 57 vs 45 | 12/24 |
| hepatocytes | 1.33 | 42 % vs 25 % | 267 vs 120 | 20/24 |
| **overall** | **0.983** | — | Δ +81.0 ± 12.1 | 79/120 |

Advantage is the *clamped* per-episode figure the search actually optimises, and
1.5 is the per-batch ceiling — so β cells sit against it.

**It beats the published protocol on four of the five.** β cells and
hepatocytes by a wide margin, kidney organoids 57 to 45, and dopamine neurons 67
to 46 (Δ +21.0 ± 12), which no earlier champion managed at all. Cardiomyocytes
is the single loss, −9.1 ± 4.2, and even there the deficit has roughly halved
from the previous champion's −15.9.

What it does with the knobs is more interesting than the scores, and not
entirely comfortable. On cardiomyocytes it holds CHIR well past the published
48-hour window — out to day 9.4, with a wide spread across batches, 3.5 to 12.1
— keeps the Wnt inhibitor on for all fifteen days, and runs a 5.5-day lactate
selection instead of three, reaching 89 % purity against 70 % at 1.58 fold
against 2.14. On dopamine neurons, the product it wins, the policy is blunter
still: it switches all five cues on in the first hours and never takes them
off. SMAD inhibition runs to day 20 where the protocol stops at 11; the SHH
agonist, CHIR and FGF8 all run to day 25, at 4.8 µM and 153 ng/mL against the
published 3 µM and 100 ng/mL.

That is a real result inside this model and a caution about it in the same
breath. The reagent bill is 48 against the protocol's 28. The published
schedules withdraw factors because holding them on has consequences — and this
plant models those consequences only partly, which makes "leave every pump
running" a policy a model can reward more easily than a lab could run.
`experiments.js` shows independently that holding the Wnt inhibitor for the
whole cardiac run beats the protocol, so the effect is not invented; its
magnitude across five channels at once is the least validated claim in here.

## How the model was debugged

The interesting part of building this was not the biology, it was that a
plausible-looking plant can be wrong in ways no scoreboard shows. Eight of them below,
each found by a different instrument, all documented in `MODEL.md`:

1. **Off-target leaks written as additive rates** drained four of the five
   chains before their cues arrived — the neuroepithelium leaked to the sink at
   0.056/h while advancing at 0.004/h. Found by printing the stage trajectory.
2. **Clocks that ran without a driver** made cells commit blindly in the days
   before the protocol dosed the signal that step needs. Found by the
   fate-split instrument (`calibrate.js --steps`), which showed steps sitting
   at `q = 0.14` while the protocol was being followed exactly.
3. **Mid-chain growth** let a ruined fate decision refill itself: losing 65 % of
   the definitive endoderm cost 8 % of the product, because the surviving third
   divided four times on the way down the chain. Found by removing a reagent
   and being surprised the batch survived.
4. **A hard threshold on a quantity sitting at the threshold** — hours above
   the EC50, where the kidney protocol's effective dose sits — moved that
   protocol's median score by 2.5× between two banks of batches. Found by
   measuring the same thing twice on different seeds.
5. **Residual pluripotency** at 3–6 %, against a penalty with a 3 % half-max,
   was silently multiplying two protocols' scores by 0.2–0.5. Found by printing
   every factor of the terminal score instead of the total.
6. **An absolute score across five products** put four of them *below* a
   reactor nobody touched, because `purity²` is quadratic in a ceiling that
   differs threefold between products and because three weeks of growth factors
   cost more than the batch was worth. A GA would have learned to make nothing
   at all, and the training curve would have looked healthy while it did. Found
   by asserting in the suite that every protocol must beat the neutral reactor.
7. **A distillation whose loss curve lied.** Cloning the five protocols drove
   its weighted loss to 0.06 and produced a network that made zero dopamine
   neurons and zero β cells. A 33-day protocol doses each reagent for two or
   three days, so nine labels in ten for a dosing channel are *off* and the
   mean-squared optimum is to leave every pump shut. Fixed by weighting the
   hours a pump is running twenty times the hours it is off.
8. **A protocol that stopped before the papers say it ends.** Running β cells
   to their real thirty-three days instead of twenty-seven took purity from
   26 % to 17 %, and three faults sat behind that, each hidden by a run which
   stopped too early: a progenitor pool stranded by a withdrawn cue kept
   dividing for a fortnight and became the largest population in the vessel, a
   flat attrition floor ate four fifths of the post-mitotic product, and
   cardiac's glucose-free selection rule was silently starving three other
   lineages. The obvious suspect — off-target growth — was innocent, and a
   3.3× sweep of it is what proved so before anything got tuned.

Every one of those is now a regression check or a named instrument.

## Files

`bioreactor.js` the plant · `lineages.js` the five protocols · `scenarios.js`
lines, lots, failures, the lab calendar, the ladder · `sensors.js` probes,
assays, the observation · `protocol.js` the SOP engine, the neutral and the
do-nothing reactors · `world.js` one batch for a whole population, scoring ·
`evolution.js` the GA (shared with the tokamak sim) · `nn.js` the network ·
`train.js` · `imitate.js` · `calibrate.js` · `analyse.js` · `experiments.js` ·
`test_headless.js` · `render.js` `ui.js` `main.js` the page ·
`what_worked.md` the post-mortem — what shipped, what did not work, how to
reproduce it.
