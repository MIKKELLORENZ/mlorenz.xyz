# What worked, and what it cost

A post-mortem of the bioreactor sim: five published differentiation protocols —
cardiomyocytes, midbrain dopamine neurons, pancreatic β cells, kidney organoids,
hepatocyte-like cells — run by one evolved controller through one fixed set of
knobs. Written for whoever builds the next one of these, including me.

## The controller that ships

| | |
|---|---|
| file | `default_brain.js` — `window.DEFAULT_BRAIN`, written by `train.js --bake` |
| architecture | `103 → 96 → 48 → 15`, tanh hidden and tanh out, 15,375 parameters |
| action space | six process knobs, six *generic* dosing pumps, three medium slots — the same fifteen channels whichever of the five products was ordered |
| generation | 80, of a run allowed 8,000 |
| rung | 1, of 0–4 |
| gate score | held-out exam advantage 0.915 |
| gate, per product | cardiac 0.88 · dopamine 0.57 · β 1.50 (at the clamp) · kidney 0.49 · hepatic 1.14 |
| shipped on | 120 paired batches against the champion it replaced — 0.983 against 0.969 overall, weakest product 0.65 against 0.59 |
| produced by | re-seeding that champion at `--mutsigma 0.20 --minlin 0.8` |
| sha1 | `5ed1bf2c74b9` (the baked file) |

Two things about that table matter more than the numbers in it.

**The gate and the duel disagree about which product is weakest.** The gate's
per-product line says kidney organoids, at 0.49. The hundred-and-twenty-batch
paired duel says dopamine neurons, at 0.65, with kidney at 0.67. Same brain, two
banks, and they do not even rank the failures in the same order. That is the
concrete form of a rule the rest of this file keeps re-learning: a gate score is
steering a run, never for deciding what ships.

**The run that produced it is gone.** `training/` is git-ignored and the run
lived on a shared training box, so the generation-80 checkpoint cannot be
re-examined — only re-derived. What is left is the baked brain. That is the
intended trade (the checkpoints are megabytes of JSON that say nothing a reader
needs), but it is worth knowing before someone goes looking for run P.

## The decision that made five protocols possible

The plant knows nothing about hearts or kidneys. Cells sit in a chain of stages;
each step has a rate; `lineages.js` is five tables. The controller's wiring never
changes across products: six process knobs, six *generic* dosing pumps, three
medium slots, and five one-hot inputs plus a countdown telling it which product
was ordered. Marker channels are generic `m0…m7`, so the same wires carry a
cardiac batch and a kidney batch.

Adding a sixth product is adding a table. That is the whole architectural payoff,
and it is worth the discipline it costs: every time a lineage wanted a special
case in the plant, the right answer was to widen the *contract* instead — which
is how `dyn()` came to return `kStep`, `kOff`, `kBack`, `tox` and, later,
`prolif`.

## The one idea worth stealing: split the clock from the choice

Cells leave a stage on a clock `k`, gated by fuel, environment and the
*instructive* driver for that step. The signals present decide only the
*fraction* `q` that arrives where intended:

    kStep = k·q        kOff = k·(1−q) + drift

Three wrong versions came first, and each looked like a tuning problem:

1. **Additive off-target leaks** fire on the days *before* the protocol has dosed
   the cue that step needs. Four of five chains drained before their cues
   arrived — neuroepithelium leaking at 0.056/h while advancing at 0.004/h.
2. **Clocks that run without a driver** make cells commit blindly. β cells left
   the gut tube at 2.2 %/h from day 2 while retinoic acid arrives on day 5, so
   most of the pool committed at q = 0.14 *while the protocol was being followed
   exactly*. Gating `k` on its driver is also what makes cue ORDER the control
   problem rather than cue dose.
3. **Mid-chain stages that regrow** make early accuracy free: deleting the
   β-cell Wnt pulse sent 65 % of the endoderm off-target as designed and cost
   only 8 % of the product, because the surviving third divided four times on
   the way down.

## The scoring, which inverted twice

v1's lesson was "the zero must be alive and useless, not dead". v2's is worse.
An absolute score (`100 × fold × purity²`) is fine for one protocol and broken
for five: `purity²` is quadratic in a ceiling that differs threefold between
products, and three weeks of growth factors topped up against a ten-hour
half-life cost more than the batch was worth. **Four of five protocols scored
below a reactor nobody touched.** A GA would have learned to make nothing while
the training curve looked healthy.

Each product is now scored against the median of *its own* published protocol
over 15 batches (`calibrate.js --refs` prints paste-ready lines), and the reagent
bill is normalised the same way. Every protocol-quality run is worth ~90 against
a neutral of ~0. **Assert it in the suite** — "every protocol beats the neutral
reactor by 40 points" is the only reason it was ever caught.

Then normalising per product still was not enough, because each batch's advantage
is divided by *that batch's* protocol-minus-neutral gap. Left unclamped, the
search drove β cells to 4.0 and hepatocytes to 3.1 while letting cardiomyocytes
fall to 0.74 — the mean looked excellent and two products were being quietly
abandoned. Clamping each episode to [−2, 1.5] means the only way to raise the
mean is to raise the floor.

## The faults, and what found each one

No scoreboard would have shown any of these. The instrument is named in each
case, because the instrument is the transferable part.

| fault | what found it |
|---|---|
| Off-target leaks firing before the cue arrives | `--steps`, per-step `q` |
| Clocks running with no driver present | `--steps` under the correct protocol |
| A hard threshold on a quantity sitting *at* the threshold (moved one median 2.5× between seed banks) | measuring the same thing on two banks |
| Residual pluripotency at 3–6 % against a penalty with a 3 % half-max | printing **every factor** of the terminal score, never the total |
| One shared off-target growth rate (every run over 15 days landed at 8 % purity) | per-lineage sinks plus a density cap |
| Protein transport exponents delivering a cue 5× weaker than dosed | `--steps` on the last chain step |
| An absolute score across five products | asserting protocol-beats-neutral in the suite |
| A distillation whose loss curve lied | playing the clone, not reading its loss |
| A stranded progenitor pool dividing for a fortnight | the compartment table, `--every 72` |
| A flat attrition floor eating the post-mitotic product | the same table, read down the column |
| One lineage's medium rule starving three others | the same table, glucose column |

`calibrate.js <product> --steps` is the instrument that found most of them: per
step, the cells-weighted fraction going the right way, and the running product
("chain efficiency"). **A step reading 0.5 while the protocol is followed exactly
is a modelling error, not a hard protocol** — five steps at 0.5 is 3 % purity
however good everything else is.

## Distilling a sparse-action teacher needs the imbalance weighted

Cloning the five published protocols into a network (`imitate.js`) drove the
weighted loss to 0.06 and produced a controller that made **zero** dopamine
neurons and **zero** β cells. The loss curve was not lying about the loss; it
was lying about the policy. A three-week protocol doses any given reagent for
two or three days, so nine labels in ten for a dosing channel are *off*, and the
mean-squared optimum is to leave every pump shut for the entire run.

The fix is per-sample weighting: a channel that is running counts 20, one
deliberately held off counts 2, and a pump the current protocol does not own
counts 1. That one change is the difference between a clone and a placebo. It is
the same failure as a teacher that idles in nine states out of ten, and it is
why the table above lists "playing the clone" rather than "reading its loss" as
the instrument.

Two corollaries, the second of which cost a run. **Judge a clone at DAgger
round 2, never round 0** — advantage went −0.21 → 0.66 across the rounds, so
round 0 reads like a failed experiment. And **a distilled seed is a better GA
seed than a converged champion**: the clone tolerated `--mutsigma 0.35`
throughout, where the same sigma took the converged champion monotonically
downhill for 560 generations. A converged brain sits in a narrow basin and 0.35
of each layer's init scale walks straight out of it; the clone still has room to
move.

## Four lessons that generalise past this project

**A model calibrated at one run length hides every fault that compounds.** A
literature check said the β protocol is 33 days, not 27. Six extra days of a
*correct* protocol dropped its purity from 26 % to 17 %, and three independent
faults were behind it: proliferation was gated on fuel and environment but never
on the instructive signal, so a pool stranded when its cue was withdrawn kept
doubling every fifty hours and became the largest population in the vessel; a
global 0.002/h death floor removes four fifths of a compartment over 792 hours
and was charged hardest to the post-mitotic product that should be hardiest; and
`protocol.js` read "medium 2" as the glucose-free lactate selection, which is
true of cardiomyocytes and of nothing else, so three lineages were deliberately
starved through the last third of every run.

**Sweep the obvious suspect before you tune it.** Off-target growth looked
certain to be the cause of that purity collapse. Sweeping it over a factor of
3.3 moved purity *not at all*, which is what sent me to the compartment table,
which named the real cause in one read. The wrong fix would have been plausible,
cheap, and would have quietly mis-tuned a calibrated constant.

**Report the objective, not an unbounded proxy of it.** Fitness clamps each
episode, but the trainer and the analyser both *printed* the raw mean. So the
log read `EXAM adv 2.516 | card 0.18 … beta 7.99` beside `worst 0.18` — two
scales on one line — and it looks exactly like a brain farming the one product
the plant scores most generously. It was not: every gate was computed from the
clamped fit and bounded all along. I nearly restarted two healthy runs over it,
and the shipped brain's headline advantage was 1.539 raw against 0.979 clamped —
a 57 % inflation that was one edit away from the README. A per-product figure
that disagrees with the `worst` on its own line is the tell.

**A held-out gate with a bank that never rotates will deadlock, and the log will
call it convergence.** The champion was replaced only on beating a monotone
high-water mark, measured on seeds that were a pure function of index - so the
bank was identical every generation and the mark could only ever rise. One lucky
draw at generation 140 froze one run's champion for the next 380 generations;
because the champion is what the ratchet exams, promotion froze with it and the
run could never record anything again. A second run of the same code showed the
other face: its champion did move, but *downhill*, held-out fit falling 0.918 to
0.840 while the stricter mark kept its checkpoint frozen. The training log was
no help at all - it printed a byte-identical exam line every ten generations,
which reads as a plateau. **The instrument is to hash the network in
`latest.json` against the one in `checkpoint.json`:** identical nets at
different generations means frozen, different nets at falling fitness means
drifting. The bank now rotates on an epoch counter, both marks reset when it
turns over, and every epoch's best is archived - because once the bank rotates,
scores stop being comparable across epochs and shipping has to be decided by a
separate paired duel instead. Which is how the brain below was chosen, so that
half was already right by accident. And the fix put a number on what the lock
had been hiding: afterwards a champion sat at a held-out fit of 1.082 for about
a hundred and ten generations, and the moment its bank rotated the same lineage
measured 0.738, with the weakest product falling from 0.64 to 0.10. A third of
that frozen advantage was the scenario draw rather than the controller, which is
both why the mark was unbeatable and why nothing downstream should ever have
been decided on it.

## Calibration method, unchanged and still the only thing that works

Run the published protocol and break ONE thing, and tune until every failure
mode points the right way with a defensible magnitude. `experiments.js` does it
generically — every reagent removed, every reagent held all run, plus a
per-lineage list from the papers — and `test_headless.js biology` freezes the
answers. Judge a broken reagent on the SCORE, not the cell count: dropping the
cardiac Wnt inhibitor costs 19 % of the yield and collapses purity 72 → 52 %.

Where it landed: chain efficiencies of 51.5 / 27.5 / 19.0 / 29.6 / 27.7 %,
giving realised purities of 70 / 39 / 30 / 28 / 22 % — inside the published
bands, which was the whole target. The β yield of 0.62 cells per cell seeded is
Rezania's "one NKX6.1⁺/insulin⁺ cell from every two hESCs", which nothing was
tuned to hit.

## One more thing worth knowing about baked brains

Behaviour outlives the reward that produced it. The brain shipped before these
corrections still holds CHIR to day 8.8 and the Wnt inhibitor for all fifteen
days, running a 6.1-day lactate selection for 96 % purity at 1.36 fold against
the protocol's 2.51 — a strategy that was rational when purity was cheap
relative to a low `ref.fold`. Re-measured against corrected references it
*loses*, 68 to 85 on identical batches, winning two in twelve. Any champion
baked before a scoring change is executing an argument about the old numbers.

The honest footnote is that every champion since has made the same trade. The
one baked after it, trained entirely *on* the corrected references, reached 88 %
purity at 1.57 fold and lost by much the same margin — 18 points against the
outgoing brain's 17. The one shipping now reaches 89 % at 1.58 and loses by 9.
So this is not inertia at all. The cardiac yardstick is simply the hardest of
the five to beat: a protocol that already turns one cell into 2.14 leaves almost
no room above it, and three consecutive champions, measured against three
different reference sets, have all preferred a purer, smaller batch than the
score is willing to pay for. That is the more useful conclusion, and it took
measuring them at matched settings to see it — the first version of this
paragraph compared one at `--maxlevel 0` with another at `--maxlevel 1` and made
the gap look like a regression.

## What shipped

**Run P, generation 80**, baked after winning a hundred-and-twenty-batch paired
duel against the brain it replaced. Measured against the published protocol on
identical batches (`analyse.js --n 12 --maxlevel 1`):

| product | advantage | purity vs protocol | score vs protocol | batches won |
|---|---|---|---|---|
| cardiomyocytes | 0.78 | 89 % vs 70 % | 64 vs 73 | 9/24 |
| dopamine neurons | 0.65 | 40 % vs 34 % | 67 vs 46 | 14/24 |
| β cells | 1.48 | 45 % vs 29 % | 274 vs 40 | 24/24 |
| kidney organoids | 0.67 | 27 % vs 24 % | 57 vs 45 | 12/24 |
| hepatocytes | 1.33 | 42 % vs 25 % | 267 vs 120 | 20/24 |
| **overall** | **0.983** | — | Δ +81.0 ± 12.1 | 79/120 |

**It beats the published protocol on four of the five products.** β cells and
hepatocytes by a wide margin, kidney organoids by 57 to 45, and — new with this
champion — dopamine neurons by 67 to 46, Δ +21.0 ± 12, which no earlier brain
managed at all. Cardiomyocytes remain the one loss, at −9.1 ± 4.2, and even
there the deficit has roughly halved from its predecessor's −15.9.

Against that predecessor, on the same 120 batches: overall 0.983 against 0.969,
and — the number this project actually promotes on — weakest product 0.65
against 0.59. It is better on cardiomyocytes, dopamine neurons and hepatocytes,
a little worse on kidney organoids (0.67 against 0.70), and spends three units
more reagent. It came from seeding the outgoing champion into a fresh run at
`--mutsigma 0.20` with `--minlin 0.8`, after an identical run at 0.35 took the
same seed monotonically *downhill* for 560 generations to negative advantage on
two products.

Cardiomyocytes are the honest remaining gap, and the reason is in the scoring
rather than the search: the protocol already turns one cell into 2.14, and every
brain that has ever been measured here prefers a purer, smaller batch than that
yardstick pays for.

### The duels

Four archived champions have been duelled against the shipped brain so far.
Three lost outright: 0.893, 0.848 and 0.765 overall against its 0.969, each
having abandoned a product (worst 0.42, 0.49 and 0.31).

The most instructive of the three posted the best gate number either run has
produced — a held-out exam fit of 1.082, where the shipped brain's own gate was
0.942 — and still came fourth in the duel, because it is a β-cell specialist:
raw advantage 6.82 on β cells with dopamine neurons collapsed to 0.42. The clamp
and the weakest-product rule exist precisely to refuse that trade, and the
gate's own forty-episode bank could not see it. Which is the third time in one
day that deciding by a large paired duel rather than by the gate changed the
answer.

The fourth, from the exploring run, came back at 0.968 against 0.972 on sixty
batches — a tie — while looking *better* in the places that matter: it beat the
dopamine-neuron protocol 56 to 52 on nine batches in twelve where the shipped
brain only drew, cost less reagent, and won more batches overall.

Doubling the sample to a hundred and twenty killed it. The dopamine win
evaporated — 45 against 46 — and overall it sat at 0.960 against 0.969, still
inside the noise. Nothing was re-baked, which is the right answer for a 0.009
difference and the reason the duel is large and paired rather than a glance at
the gate.

One measurement oddity is worth keeping, because it will mislead someone. On
dopamine neurons the challenger wins **more batches** than the shipped brain (17
of 24 against 11 of 24) while scoring **lower on average** (−0.7 against +7.4).
It wins small and loses big. A win-rate and a mean advantage can point in
opposite directions on the same data, so decide with the one the objective is
actually made of — and report both, because the disagreement is information
about the policy rather than noise.

A fifth candidate, from the run seeded off the shipped brain at low mutation,
made the criterion earn its keep. Overall it came in at 0.982 against 0.972 —
marginally *ahead* — and it did something nothing else has: it beat the
dopamine-neuron protocol outright, 107 to 52, advantage 1.00, nine batches in
twelve, where the shipped brain only draws. It bought that by abandoning the
kidney organoids, 0.74 down to 0.40 (46 against 60, three batches in twelve),
which dropped its weakest product to 0.40 against the shipped brain's 0.62.

So the overall figure said "slightly better" and the weakest-product rule said
"no", and the rule wins, because the whole point of this project is one
controller that does not quietly give up on a product. It is still the most
encouraging result so far: dopamine neurons are not unbeatable, they are just
not yet beatable *at the same time as* kidney organoids. That is a far more
useful thing to know than another tie.

The sixth candidate finally cleared both bars. Screened at sixty batches it came
in at 0.994 overall against 0.972 with its weakest product two hundredths short
— exactly the margin that had reversed once already — so it went to a hundred
and twenty, where it held: 0.983 against 0.969 overall and 0.65 against 0.59 on
the weakest product, better on three of the five and beating the protocol on
four. That one was baked, and the table above is its scorecard.

Six duels for one promotion is the right ratio. Five of the six looked promising
on the gate and lost on the batches.

### Why the runs were stopped, and the one thing to change

Every run eventually walked downhill, and the reason is in the fitness function
rather than in the biology. Three of them, across three different seed and
mutation-rate combinations, peaked early and then declined monotonically until
their champions *lost to the published protocol outright* — on sixty paired
batches, Δ −12.5 ± 13.0 and −13.8 ± 15.6 overall.

What "declined" means per product is worth spelling out. One finished making
cardiomyocytes at 0.11 fold, 9 % purity and a beating score of 0.17; the other
made neurons at 0.10 fold, 13 % purity, 0.21 firing. They had stopped making two
of the five products at all, while pinning β cells against the 1.5 clamp and
holding hepatocytes near 1.0 — which keeps the *mean* comfortably positive.

That is the mechanism, and it is a design error of mine. Fitness is the mean
clamped advantage across the episode plan, so abandoning two hard products and
farming two easy ones is a perfectly good strategy for the search. The
weakest-product floor existed in the promotion gate (`--minlin`) and in the
shipping duels, and **nowhere in breeding** — so selection was never given a
reason to keep a product alive. The per-episode clamp stops one product
dominating the mean; it does nothing about two being dropped from it.

Two things follow. The champion that shipped came from **generation 80 of eight
thousand**, and every later generation of every run was worse, so the lesson is
to harvest early and duel often rather than to trust a long run. And the fix
belongs in the fitness, not the gate: a floor penalty such as `fit = mean −
λ·max(0, floor − worst)`, or simply refusing to breed a brain with any product
below zero. That is untested — the runs were stopped once the duels showed them
below the protocol, rather than left burning a shared machine.

## What did not work, or actively misled

| tried | what happened |
|---|---|
| An absolute score, `100 × fold × purity²`, across five products | four of the five scored *below* a reactor nobody touched |
| Fitness as the mean clamped advantage | every run eventually abandoned two products and farmed two easy ones |
| The weakest-product floor in the promotion gate only | selection was never given a reason to keep a product alive |
| A held-out bank that was a pure function of index | one champion froze for 380 generations and the log printed it as a plateau |
| Deciding what to ship on the gate score | the best gate number either run ever posted, 1.082, lost its duel 0.893 against 0.969 |
| Promoting on a sixty-batch margin | a 56–52 dopamine win on nine batches in twelve became 45–46 when the sample doubled |
| Seeding a converged champion at `--mutsigma 0.35` | 560 generations downhill, to negative advantage on two products |
| Cloning the protocols without class weighting | weighted loss 0.06, two products never made at all |
| Tuning off-target growth to explain a purity collapse | a 3.3× sweep moved purity *not at all*; the cause was three other faults |
| Calibrating the β protocol at 27 days | six more days of a *correct* protocol exposed three compounding faults |
| Printing the raw mean advantage beside a clamped `worst` | two scales on one line; it nearly cost two healthy runs |

The tooling had its own two. Two here-documents sharing a delimiter in one shell
command truncate silently, and a patch anchored on a line containing an em dash
or a µ fails while `cat -A` insists the bytes are correct. Anchor on ASCII,
insert after the line end, and assert every anchor before writing — a patch
script that asserts leaves the file untouched when it is wrong, which is the
behaviour you want.

## What this does not establish

**The winning dopamine policy is a caution about the plant, not a recipe.** It
switches all five cues on in the first hours and never takes them off: SMAD
inhibition to day 20 where the protocol stops at 11, and the SHH agonist, CHIR
and FGF8 all running to day 25 at 4.8 µM and 153 ng/mL against a published 3 µM
and 100 ng/mL, for a reagent bill of 48 against 28. Published schedules withdraw
factors *because holding them on has consequences*, and this plant models those
consequences only partly, which makes "leave every pump running" a policy a
model rewards more easily than a lab could run. `experiments.js` shows
independently that holding the cardiac Wnt inhibitor for the whole run beats the
protocol, so the effect is not invented — but its magnitude across five channels
at once is the least validated claim in the project.

**The yardstick is a model of a protocol, not a lab.** Every advantage in this
file is measured against this plant's rendering of a published schedule, through
this plant's sensors, with its delays and its failure modes. Chain efficiencies
and purities were tuned to land inside published bands; the β yield of 0.62
cells per cell seeded matches Rezania's "one from every two hESCs" without
having been tuned to it, which is encouraging and is not validation.

**One run length, and no purification step.** The β protocol is modelled at 33
days *without* the FACS sort and re-aggregation that the 27-day figure depends
on. Nothing here says what any of these controllers would do with a purification
step in the middle of the run.

**Cardiomyocytes were never beaten.** Three consecutive champions, measured
against three different reference sets, all preferred a purer, smaller batch
than the score is willing to pay for. That is a consistent finding, not a solved
problem — and the protocol it is measured against already turns one cell into
2.14, which leaves very little room above it.

## Reproducing it

    node test_headless.js                 # engine, scale, biology
    node test_headless.js biology         # frozen reagent answers

    node calibrate.js --refs              # per-product reference medians
    node calibrate.js beta --steps        # chain efficiency, step by step
    node calibrate.js beta --every 72     # the compartment table
    node experiments.js beta --seed 7     # break one reagent at a time

    node imitate.js --rounds 4 --scenarios 40 --epochs 60  # -> bc.json
    node train.js --init training/bc.json --gens 2000 --pop 96 \
                  --episodes 10 --workers 6 --minlin 0.8
    node train.js --bake training/checkpoint.json          # -> default_brain.js

    node analyse.js default_brain.js --n 24 --maxlevel 4   # paired vs protocol
    node analyse.js default_brain.js --lin beta            # one product only

**There is no duel command.** A "duel" in this file means `analyse.js` run on
two brains at the same `--n` and `--maxlevel`: the held-out seeds are a function
of index, so both brains meet identical batches and both are scored against the
same protocol yardstick, and what is compared is their advantages. Sixty batches
screens a candidate; a hundred and twenty decides, because sixty has reversed
the answer twice.

Pass `--workers` explicitly on a shared machine.

## One loose end found while writing this

`nn.js` still describes itself in the language of the project it was copied
from: "a coil voltage is bipolar", "the coil sees ±1400 V". The code is correct
for this one — tanh hidden, tanh out, output layer initialised at 0.02 of the
hidden scale — and only the comments are about a tokamak.
