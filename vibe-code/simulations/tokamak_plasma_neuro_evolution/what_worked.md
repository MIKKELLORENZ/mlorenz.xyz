# What worked

A post-mortem of the controller the page actually ships: where it came from, what
the reward paid for, which learning approach produced it, and what the
architecture had to contain before any of it was possible.

[RECIPE.md](RECIPE.md) is the working recipe — what to run, in what order, with
which constants. This file is the other half: *why the pipeline has the shape it
has*, which parts of the finished controller were bought by which stage, and
what re-measuring it today says. Everything below was re-run against the
committed files on 2026-09-06; where a number here disagrees with the README or
RECIPE, the disagreement is called out rather than quietly reconciled.

---

## What ships

| | |
|---|---|
| File | `default_brain.js`, committed, loaded directly by the page |
| Shape | `219 – 64 – 48 – 19`, **18,131 weights**, tanh throughout |
| Weights SHA-1 | `a6c48d247ddc` — **verified today** |
| Generation | 400 |
| Held-out exam | 0.717 |
| Provenance | cloned from `pid.js` by DAgger, then evolved 400 generations |
| Cost | ~3 hours on a 20-thread laptop |

Two sentences that between them explain most of this document:

**The controller does not see the plasma.** It sees 34 flux loops, 38 field
probes, 19 coil currents and a Rogowski coil — all noisy, all one control step
stale — and it commands 19 coil *voltages* at 10 kHz. Where the plasma is, is
something it has to work out.

**It was not evolved from nothing.** Three from-scratch GA runs never came close
to the hand-written PID baseline in this same repository. The brain that ships
was fitted to that PID by gradient descent first, and evolved afterwards. What
"learned" means here is *improved on a known controller* — and §"The learning
approach" measures exactly how much of the final result is the improvement.

---

## What it actually does

`node compare.js --episodes 12`, re-run today — 96 held-out episodes per
controller, noise and domain randomisation on, nominal machine:

| task | do nothing | PID baseline | **shipped brain** |
|---|---|---|---|
| hold circular | 8.54 cm, 42% dis | **1.13 cm** | 1.84 cm |
| hold elongated | 18.56 cm, 100% | **2.08 cm** | 2.25 cm |
| track vertical | 15.42 cm, 92% | 6.31 cm | **2.75 cm** |
| morph shape | 13.70 cm, 100% | 2.68 cm | **2.31 cm** |
| negative triangularity | 13.67 cm, 100% | 3.73 cm | **2.83 cm** |
| current ramp | 12.39 cm, 100% | **3.31 cm** | 3.36 cm |
| radial excursion | 14.12 cm, 92% | 3.26 cm | **3.15 cm** |
| 1.2 s discharge | 6% survived | 64% surv, **100% disrupt** | **76% surv, 33% disrupt** |
| **ALL** | 51%, 12.95 cm, 91% | 95%, 3.22 cm, 13% | **97%, 3.06 cm, 4%** |

Mean fitness: do nothing −119.6, PID +13.3, **shipped +29.3**. The README's table
reproduces to the last digit.

And the table the difficulty ladder exists to produce
(`node compare.js --episodes 8 --sweep`, also reproduced exactly):

| rung | PID error | **shipped** | PID disrupts | **shipped** |
|---|---|---|---|---|
| L0 nominal | 3.32 cm | **3.03 cm** | 13% | **3%** |
| L1 brisk | 3.89 cm | **3.13 cm** | 13% | **6%** |
| L2 stiff | 5.56 cm | **3.31 cm** | 14% | **5%** |
| L3 hostile | 7.27 cm | **3.42 cm** | 23% | **8%** |
| L4 brutal | 10.04 cm | **3.66 cm** | 27% | **8%** |
| L5 savage | 12.99 cm | **3.99 cm** | 44% | **11%** |

**The PID degrades 3.91× across the ladder. The shipped brain degrades 1.32×.**
That gap is the entire argument for learning this controller instead of tuning
it — and §"Original measurements" shows, against the project's own written
explanation, that the gap is a product of the *evolution* stage and not of the
observation design.

Two things about that scoreboard that are easy to read past:

- **`discharge` is never trained on.** The task registry the GA selects against
  is seven tasks (`STAGES` in `evolution.js`); `discharge` is flagged `demo: true`
  and is excluded. It is also 1.2 s long against a longest training task of
  0.17 s. The headline result — completing two out of three full discharges where
  the PID completes none — is **zero-shot on an episode 7× longer than anything
  the brain ever saw during selection**.
- **It is also the brain's worst task.** Measured per-task at L0, the champion's
  fitness is `circular 59.8 · elongated 56.3 · morph 50.4 · negd 30.2 ·
  vtrack 27.3 · outward 24.5 · ipramp 7.4 · discharge −51.4`. The discharge is the
  only negative entry, by a distance. Where the remaining headroom is, is not the
  savage rung — it is the long shot.

---

## The reward function

Per control step, evaluated on the plasma's own boundary — `Tokamak.reward()` in
[tokamak.js:1082](tokamak.js#L1082):

```js
r = 1.0
  - 3.2 · (boundaryErr / 0.08 m)²    // RMS distance over 16 boundary points
  - 0.8 · (ΔI_p  / 50 kA)²
  - 0.9 · (ΔR    / 0.08 m)²
  - 1.6 · (ΔZ    / 0.06 m)²          // vertical: 1.8× the weight, tighter normaliser
  - 0.05 · mean(action²)             // effort
  - 0.6 · limitPressure              // proximity to an operational limit
r = max(r, −4)                       // the floor
```

Fitness is `100 × mean(r)` per control step, so a clean episode reads near +70 and
a disruption a quarter of the way in near −110.

The shape of that expression matters less than four decisions around it, each of
which was, at some point, the reason a run produced nothing.

### The floor, and the cost of dying

```js
static DEAD_STEP_COST = 8.0;   // world.js
```

A dead plasma keeps being charged `−8.0` for **every remaining step of the
episode**, and the live reward is floored at `−4`. The invariant is
`DEAD_STEP_COST > |floor|`: surviving badly must always beat disrupting early.

Both halves were learned the hard way.

*Without the floor*, a plasma 30 cm off target scores about −20 per step, which is
far worse than dying. The highest-scoring strategy available to a young population
is then to kill the plasma immediately and stop the clock, and a population finds
that inside two generations. **Any reward that terminates on failure needs this
check**, and the check is one line.

*With the floor but a death cost of 4.5*, the gap between "alive and hopeless"
(−4) and "dead" (−4.5) is half a point — so the reward barely preferred survival
at all. The first trained brain duly came back with **worse survival than doing
nothing — 40% against 51% — while scoring better on shape error**. It had found
the trade the reward was quietly offering: command more voltage, hold a better
boundary while you live, die sooner. Doubling the gap removes the trade.

The general form of that bug is worth naming, because it is invisible in the
fitness curve: a reward can be *simultaneously* improving on the metric you are
watching and selecting for the outcome you least want. The only instrument that
catches it is measuring survival separately from score.

### Vertical is weighted 1.8× radial

`1.6 · (ΔZ/0.06)²` against `0.9 · (ΔR/0.08)²` — a heavier weight *and* a tighter
normaliser, so a 6 cm vertical error costs 1.8× what an 8 cm radial one does.
Not because vertical position matters more, but because the vertical axis is the
unstable one: being off-centre vertically is a precursor to a disruption, being
off-centre radially usually is not. The reward is asked to price a *risk*, not
just an error.

### The square root, and per-stage scales

Each episode contributes `sqrt(fitness / stageScale)` (scales 55 / 45 / 40), with
negatives passing through unchanged rather than square-rooting into NaN.

Diminishing returns are the point: going from 0 to 1 on the task you are bad at
is then worth more than going from 4 to 5 on the one you already hold perfectly.
That is the preference a *generalist* objective must have, and it is the only
thing preventing a population from buying its whole score on `circular`. Ordering
*within* a task is untouched, so it costs nothing in selection resolution.

### The anti-forgetting rule is part of the reward, not the curriculum

`episodePlan()` gives every generation six episodes laid out like this:

```
episode  0    1    2    3    4    5
task    new  ← cycles through everything unlocked, from a rotating offset →
level    L    0    1    2    0    1
```

Episode 0 is always the newest task on the **hardest** unlocked rung — where
search pressure should point. Every episode after it cycles through the rungs
*including rung 0*. A brain that buys skill on the savage machine by giving up
the nominal one therefore scores **worse**, structurally, not by luck of the
draw. Rung 0 is never absent from a generation.

Measured across the real climb: rung-0 score went **1.04 → 1.12 → 1.21 → 1.20**
while difficulty rose four rungs. That is the mechanism working, and it is the
number to watch if any of this is changed.

The rotating offset on the task cycle is a second, smaller version of the same
idea. Without it, a generation with fewer episodes than tasks always draws the
same prefix — at stage 2 with five episodes, `negd`, `ipramp` and `morph` were
never selected on at all, and the population quietly specialised on the four
tasks it could see.

### What the reward could not do

Nothing in this ledger addresses the actual difficulty of the problem, which is
that the mapping from 219 noisy numbers to 19 voltages has to contain a state
estimator, a decoupling matrix and a millisecond stabilising loop — and a GA
grades all of it with one scalar per episode. The reward was made correct, and
correct was not sufficient: **three complete training runs sat at roughly a tenth
of the PID's score with this reward already in place.** What fixed that was not a
reward change. It was §"The architecture" and §"The learning approach".

---

## The learning approach that finally worked

### The order the diagnosis had to happen in

The runs that went nowhere all failed the same way — the population plateaued far
below the baseline — and the suspect was, in order, the mutation width, the
curriculum, and the selector. All three were genuinely broken and all three were
fixed, and the plateau did not move. The fault was that **the answer was not in
the input** (§"The architecture"). Only after the observation was fixed was the
remaining problem the search — and then the search was not fixed by tuning it,
but by not asking it to do the work.

The lesson generalises: before tuning a search, check that the observation
contains the answer, and check whether anything you already have can produce
better-than-random behaviour. Both checks are cheap; the tuning is not.

### Stage 0 — the teacher

`pid.js` is a real baseline built the way a real one is built: a magnetic
observer (ridge regression from machine geometry, no privileged state), a 10 kHz
inner loop on the fast in-vessel coil, a 2 kHz outer loop on shaping and ohmic
coils. It holds all seven short tasks at 0.8–4.2 cm.

Two fairness rules matter here more than they look:

- **The observer is shared.** The network reads the same `MagneticObserver`
  object the PID reads. If the baseline and the challenger estimate position
  differently, the comparison measures observers, not controllers.
- **The teacher eats the same lie.** The observer subtracts only the coil field
  the controller genuinely knows; it cannot subtract the vessel eddy currents,
  because nothing measures them. That screening error is the actual hardness of
  the problem, and both controllers carry it.

### Stage 1 — cloning, and why plain cloning fails

I reproduced the whole imitation stage today from the committed files
(`node imitate.js --rounds 5 --seeds 12 --epochs 40 --workers 8`, 1,537 s,
254,704 state–action pairs). The round-by-round result is the clearest single
argument in the project:

| round | rollouts came from | episodes that survived collection | exam | survival | error | disrupts |
|---|---|---|---|---|---|---|
| 0 | the expert itself | 84/84 | **−8.488** | 75% | 13.51 cm | **81%** |
| 1 | the student | **38/84** | −5.790 | 98% | 15.19 cm | 14% |
| 2 | the student | 71/84 | **+0.190** | 100% | 3.80 cm | 0% |
| 3 | the student | 84/84 | +0.186 | 100% | 3.80 cm | 0% |
| 4 | the student | 84/84 | **+0.218** | 100% | 3.59 cm | 0% |
| | *(the teacher, for reference)* | | +0.131 | 100% | 3.86 cm | 0% |

Round 0 **is** plain behaviour cloning: fit the network to the expert's own
trajectories, forty epochs of Adam, loss down two orders of magnitude — and the
result **disrupts 81% of the time**. A controller trained only where the expert
goes is excellent there and lost everywhere else, and its own small errors take
it off the expert's distribution within a few milliseconds, so "everywhere else"
is where it spends the episode.

The `episodes that survived collection` column is the same fact seen from the
other side, and it is the honest progress meter for a DAgger run: the expert
survives 84 of 84 rollouts, the round-1 student survives **38**, and by round 3
the student is back to 84. It is not the loss curve that tells you DAgger is
working.

**What DAgger actually does here**: after round 0 the *rollouts* come from the
student and the *labels* come from the teacher. The PID is stepped alongside the
student's plasma — integrators winding against the student's states, not its own
— and asked what it would have done in the state the student actually reached.
That last clause is the whole trick; relabelling a stored trajectory is not the
same thing and does not work.

**What the clone cannot inherit**: the PID's three integrators and its 2 kHz
outer-loop phase are internal state that no observation carries, so the loss floor
is not zero. That is a large part of why the temporal block exists — leaky
integrals and multi-lag differences are precisely the quantities the teacher keeps
in its own state.

**Where cloning stops.** Scored on the same held-out episodes as the champion,
the reproduced clone is a *copy of its teacher* and not one point better:

| controller | mean fitness | mean error | disrupts | 1.2 s discharge |
|---|---|---|---|---|
| do nothing | −119.6 | 12.95 cm | 91% | 6% surv, 100% disrupt |
| **PID teacher** | **+13.3** | 3.22 cm | 13% | 64% surv, 100% disrupt |
| **clone** (5 DAgger rounds) | **+11.9** | 3.25 cm | 13% | 53% surv, 100% disrupt |
| **shipped** (clone + 400 GA gens) | **+29.3** | 3.06 cm | **4%** | **76% surv, 33% disrupt** |

Imitation buys 131 fitness points, all of them getting *to* the baseline. It buys
zero points beyond it, and it inherits the baseline's total failure on the
discharge.

### Stage 2 — evolution, which is where the margin comes from

```bash
node train.js --resume training/bc.json --pop 80 --episodes 6 \
              --workers 14 --stage 2 --mutrate 0.06 --mutsigma 0.12
```

Every point above the teacher — the 16.0 fitness margin, the drop from 13% to 4%
disruptions, the vertical-tracking win, two discharges in three, and the entire
robustness result — was bought here, in 400 generations and about two and a half
hours.

Four details are load-bearing.

**σ is relative to each layer's own weight scale, and the scale has to be
re-measured.** This one bit twice, for opposite reasons.

- *Absolute σ.* The output layer is initialised at `0.02·√(2/48) ≈ 0.0041`. An
  absolute σ of 0.12 — unremarkable anywhere else — moves an output weight ~30×
  its own size, tanh saturates, the coil sees ±1.4 kV continuously, and the
  plasma is on the wall inside a millisecond. Measured: generation 1 survived 88%
  of its episodes, generation 10 survived 35%, and it never recovered. **Selection
  was not failing — mutation was destroying brains faster than selection could
  keep one.**
- *A scale the weights have left behind.* Relative σ is right from a random start
  and wrong for a brain that arrived by gradient descent. Imitation trains the
  output layer from 0.0041 up to an RMS of 0.175 — **43× wider** — and `mutate`
  would go on stepping by a fraction of 0.0041, which against those weights is a
  rounding error, not a mutation. The population looks converged from generation
  one and the GA becomes an expensive way to keep the brain it started with.
  `Net.calibrateScales()` re-measures from the weights actually held;
  `clone()` had to be taught to carry them, which was invisible while every net
  came from the same init and a hundredfold error the moment they didn't.

  This is also the one place where the shipped brain shows the mechanism's
  own limit — see "the mutation scale is 400 generations stale" in
  §"Original measurements".

**A ladder of step sizes, not one.** `SIGMA_LADDER = [0.15, 0.35, 0.7, 1.4]`
multiplies σ, and each of the 8 mutated-elite children draws a different rung.
With 18k weights, a single mutation size is a bad bet: one large enough to escape
a local optimum is far too large to refine a champion. Before this, the population
mean sat flat for 375 generations while the best oscillated — every child of an
elite was a fresh draw rather than a refinement.

**Common random numbers.** Every plasma in a generation gets the same task, the
same target trajectory, the same initial coil currents *including the same random
starting error*, the same domain-randomisation draw and the same sensor-noise
stream. **The only difference between two members of a generation is their
brain.** `seedBlock = 2` extends it across time. Without this, ranking measures
which machine you happened to draw.

**The champion is decided by a held-out exam, on the top three candidates.**
Never by the training score. Two failures here look identical from outside — the
title stops moving — and both stopped a run dead:

- *One episode per exam*: generation 10 posted a lucky score and still held the
  title 45 generations later. Every checkpoint the run wrote was that same brain.
  A noisy selector does not slow a search down, it stops it.
- *Examining only `results[0]`*: the winner of six noisy training episodes is
  usually a lucky draw rather than a real improvement, so it fails the exam and
  the title never moves — measured frozen for 50 generations while the training
  best climbed. Examining the top **three**, batched into one pool call, costs
  ~17% rather than 3×.

**Two ratchets, both monotone, both additive** — tasks (`circular` →
`+elongated` → full registry) and difficulty (six rungs, nominal → savage).
Promotion needs the exam ≥ 0.85 on the top rung *and* ≥ 0.85 still holding on
rung 0, for three consecutive checks. Starting at the full registry does not
work: a random brain on an elongated plasma is on the wall in ten milliseconds,
every member scores the same large negative number, and selection has nothing to
rank. Promoting on the survival of the **better half** of the population is not a
detail either — judging on the champion promotes a population containing one lucky
brain, and judging on the whole roster never promotes at all, because the roster
is half deliberate wreckage. That second mistake cost 375 generations in which
the curriculum never left stage 0, so the brain it produced had never seen an
unstable plasma.

---

## The architecture

### 219 inputs, and the 70 that decided the project

| block | n | |
|---|---|---|
| flux loops / probes / coil currents / I_p | 93 | measured, noisy, one step stale |
| previous action | 19 | the specified interface |
| target boundary (16 R,Z points) | 32 | |
| target scalars + discharge phase | 5 | |
| *published subtotal* | *149* | mirrors the TCV-style contract |
| **temporal block** | **70** | added by this project |

**The published 149-neuron interface contains no quantity with a time
derivative.** A controller reading it cannot distinguish a plasma sitting 5 mm
high and still from one 5 mm high and falling at 8 m/s — and on a vertically
unstable plasma those need opposite commands. The PID it kept losing to has dz/dt
and three integrators.

The 70 added neurons:

| n | block | what it is |
|---|---|---|
| 8 | A | observer Ẑ, R̂; errors e_Z, e_R, e_Ip; one-step rates — the minimum PD set |
| 14 | B | Ẑ, R̂ differenced at lags 1, 2, 4, 8, 16, 32, 64 ticks (0.1 → 6.4 ms) |
| 3 | B | I_p differenced at 4, 16, 64 ticks — a slower channel gets a longer ladder |
| 3 | C | leaky integrals ∫e_Z, ∫e_R, ∫e_Ip, τ = 20 ms — the I term |
| 4 | D | fast-coil current, its rate, and the mean of its last 8 and last 32 commands |
| 38 | E | all 38 field probes differenced against 0.8 ms ago (dB/dt) |

Everything there is computable on a real machine from magnetics alone. No ground
truth, no privileged state.

The lag *ladder* rather than one derivative is the design decision worth
keeping: one difference is one filter with one noise bandwidth, and this plant has
three timescales that matter — 0.5 ms fast coil, ~6 ms vessel, ~7 ms instability.
Give selection the bank and let it choose.

§"Original measurements" ablates all six blocks with error bars. The short
version: removing all 70 costs **−126.1 ± 9.6 fitness** and turns the champion
into something worse than doing nothing, and the 8-neuron PD set is worth more
than the other 62 combined.

### Normalisation is measured, not chosen

`calibrate.js` measures each channel's mean and standard deviation from the
machine itself and writes `obs_norm.js`. The temporal block needs this far more
than the sensors do: the natural amplitudes of a 0.1 ms difference and a 6.4 ms
one differ by two orders of magnitude, and the measured standard deviations in
the committed file run from **0.27 to 42.6**. A single hand-picked divisor leaves
the short lags as invisible dust and saturates every tanh the long ones touch —
and a mutation-driven search is at its worst on a DC offset with the signal
riding on it at a tenth of the amplitude.

Two implementation traps are recorded in the code and both are the kind that
produce silence rather than errors:

- **One monotonic frame counter, not one cursor per ring.** The 65-slot history
  and the 9-slot probe history wrap at different points; separate cursors
  desynchronise at the wrap, silently, for a few steps at a time. `histK` counts
  up forever and every ring indexes `histK % len`.
- **`reset()` primes every lag with the t = 0 state.** Without it the first
  control step reads a 0.88 m radial jump out of an empty buffer and commands
  accordingly — the episode is decided before it starts.

### 219 → 64 → 48 → 19, tanh throughout

Two small hidden layers. The mapping from noisy magnetics to nineteen voltages
is not deep — it is badly conditioned. The hidden layers grew from 48/32 to 64/48
when the temporal block arrived, because the first layer now has to hold both a
linear observer and a bank of differentiators.

**Outputs are tanh, and the output layer is initialised at 0.02× He.** Both
follow from the same fact: a coil voltage is bipolar and *zero is the meaningful
neutral*. The episode starts from a solved equilibrium, so "command nothing"
leaves the currents where they are and the plasma drifts only as fast as its own
instability. A near-zero output layer therefore means a brand-new brain does not
slam nineteen supplies to ±1.4 kV and disrupt in the first millisecond — every
fresh brain survives long enough to be **told apart from every other fresh
brain**, which is the only thing generation 1 has to achieve.

**Row-wise crossover.** Whole neurons swap — a row of incoming weights plus its
bias — never individual scalars. With 93 partly redundant magnetic inputs a
hidden neuron really is a learned linear combination of probes, *a moment of the
field*, and it is worth keeping whole.

---

## Where the shipped brain came from

| stage | what ran | result |
|---|---|---|
| 0 | `calibrate.js` — measure the input normalisation from the machine | `obs_norm.js`, version 2 |
| 1 | `imitate.js` — 5 DAgger rounds, 12 seeds × 7 tasks, 40 Adam epochs | exam ≈ 0.22, **equal to the PID** |
| 2 | `train.js --resume` — 400 generations, pop 80, 6 episodes/gen | exam **0.717**, reached rung 5 at gen ~310 |
| 3 | `train.js --bake` | `default_brain.js` |

Provenance details worth recording, both found by reading the baked file rather
than the docs:

- **The shipped file's mutation scales are stage-1 scales.** `default_brain.js`
  carries `scales = [0.166, 0.193, 0.175]`, and `0.175 / 0.0041 = 42.9` — exactly
  the output-layer growth the RECIPE attributes to the imitation stage. So the
  numbers in the shipped champion are the ones `imitate.js` measured at the end of
  round 4, carried unchanged through 400 generations of evolution. See the
  measurement below for what that costs.
- **The bake drops metadata the tools want back.** `train.js --bake` writes
  `format, mode, gen, exam, sizes, net` — and not `level`, `stage`, `history` or
  `obsNormVersion`, all of which the checkpoint had. Two consequences: the
  browser's `resume=default` restarts the difficulty ladder at rung 0, and
  `graft.js` cannot tell which normalisation the shipped brain was trained
  against (see §"Loose ends").

---

## What worked, ranked

1. **Adding memory to the observation.** Nothing else mattered until this was
   done. Three complete runs, three correct diagnoses of three real bugs, and a
   plateau that did not move.
2. **Cloning a teacher instead of evolving from nothing.** 131 of the shipped
   brain's 149 fitness points over "do nothing" arrive in 25 minutes of Adam.
3. **DAgger rather than plain cloning.** Same data budget, same network: 81%
   disruptions versus 0%.
4. **Evolving *after* cloning, against the real reward.** The other 16 points —
   and every result the project is actually interesting for.
5. **The difficulty ladder with a rung-0 anchor.** The thing that converts "beats
   the PID on the machine the PID was tuned for" into "degrades 1.32× where the
   PID degrades 3.91×".
6. **σ relative to re-measured per-layer weight scale.** Two separate run-killers,
   one mechanism.
7. **Common random numbers, plus a seed block.** Without them, ranking measures
   luck; with them, six episodes is enough to rank 80 brains.
8. **A held-out exam over the top three candidates, with fixed seeds.** The
   difference between a search and a title that never moves.
9. **A reward floor below a strictly larger death cost.** One line; without it the
   optimum is suicide.
10. **The anti-forgetting episode plan.** Structural, not hopeful — a brain that
    trades the easy machine for the hard one scores worse.
11. **Row-wise crossover and the σ ladder.** Refinement and exploration in the
    same generation.
12. **A shared observer between baseline and challenger.** The reason the
    scoreboard means anything.

---

## Original measurements made while writing this

Everything here was run today against the committed files. Where it contradicts
the README or RECIPE, that is stated.

**1. The verification passes.** Weights SHA-1 `a6c48d247ddc`, 18,131 weights in
`219–64–48–19`. `node test_headless.js` — all ~90 assertions pass. Both
`compare.js` tables in the README reproduce exactly.

**2. Imitation reaches the teacher and stops; evolution supplies the whole
margin.** Reproducing stage 1 from scratch (1,537 s, 8 workers) and scoring it on
the champion's own held-out episodes: clone **+11.9** fitness, 3.25 cm, 13%
disruptions, against the PID's +13.3 / 3.22 cm / 13%. The clone is a copy of its
teacher to within noise and does not exceed it (−1.4). The shipped brain is
+29.3 / 3.06 cm / 4%.

*Whether the clone "beats its teacher" depends on which bank you ask, and the
difference is smaller than it looks.* `imitate.js`'s own end-of-round evaluation
scores the clone 0.218 against the PID's 0.131 (3.59 cm vs 3.86 cm) — a win, and
that is the number the project has recorded. `compare.js`'s independent bank of
96 episodes per task scores it 3.25 cm against 3.22 cm and −1.4 fitness — a
tie or a small loss. Both are honest; the first is measured on the seeds the
imitation stage itself uses. **The safe statement is that cloning takes a
randomly initialised network to the teacher's level and no further**, which is
exactly what it should do, and is why stage 2 exists.

**3. The robustness result is bought by evolution, not by the observation.**
This is the sharpest finding, and it revises the project's own explanation.
Running the difficulty sweep on the reproduced clone — the *same* 219 inputs,
including all 38 dB/dt channels:

| | L0 | L5 | degradation |
|---|---|---|---|
| PID baseline | 3.32 cm | 12.99 cm | **3.91×** |
| clone (all 219 inputs) | 3.35 cm | 12.79 cm | **3.82×** |
| shipped brain | 3.03 cm | 3.99 cm | **1.32×** |

The clone can read the probe array's dB/dt exactly as well as the champion can,
and it degrades like the PID. The README explains the robustness as a consequence
of the input design ("the network reads the probe array's dB/dt … and can
therefore tell what kind of machine it is on"). The inputs make it *possible*;
what makes it *happen* is 400 generations of selection against a difficulty
ladder that keeps rung 0 in every generation. An architecture affords a
capability; only the objective installs it.

**4. Input ablation, paired, with error bars.** 96 paired episodes per row (12
fresh seeds × 8 tasks), the same episode for every variant, zeroing whitened
channels so the network still sees a plausible value carrying no information.
Δ is fitness against the unablated champion:

| ablated | Δ at L0 | Δ at L5 |
|---|---|---|
| **all 70 temporal** | **−126.1 ± 9.6** | −99.9 ± 8.9 |
| A — PD set (8) | **−54.8 ± 7.3** | **−95.7 ± 8.5** |
| B — lag ladder Z,R (14) | −22.0 ± 4.4 | −27.6 ± 5.9 |
| B — lag ladder I_p (3) | +0.5 ± 2.3 | +0.4 ± 2.5 |
| C — leaky integrals (3) | −22.6 ± 4.1 | −25.9 ± 4.7 |
| D — fast-coil block (4) | −0.8 ± 2.5 | −3.9 ± 2.2 |
| E — probe dB/dt (38) | −6.6 ± 3.9 | −12.8 ± 4.6 |
| previous action (19) | +1.9 ± 3.0 | −6.8 ± 2.8 |
| target boundary (32) | −172.9 ± 12.9 | −199.0 ± 12.8 |
| target scalars + phase (5) | −32.9 ± 4.5 | −103.4 ± 7.2 |

Read out of that:

- **Blinding the temporal block does not degrade the controller, it deletes it.**
  Survival 98% → 61%, disruptions 2% → 61%, error 3.11 → 8.22 cm. The brain
  becomes worse than the PID and close to doing nothing. This is the project's
  central claim and it is confirmed with a large margin.
- **The blocks are almost perfectly additive.** The six individual costs at L0
  sum to −126.1; the joint ablation measures −126.1. There is essentially no
  redundancy between them — every block is carrying its own information.
- **The 8-neuron PD set is worth more than the other 62 combined**, at both
  rungs, and its share grows with difficulty. Eight numbers.
- **Block E is not "the single most valuable block."** RECIPE §3.3 says it is;
  measured, it costs −6.6 ± 3.9 at L0 (1.7σ, not significant) and −12.8 ± 4.6 at
  L5 (2.8σ). The *direction* supports the robustness story — E roughly doubles in
  value on the savage machine, and at L5 its cost concentrates in `negd` (−61.2)
  and `ipramp` (−38.8) — but it is nowhere near the top of the ranking. The claim
  as written should be narrowed.
- **The target scalars are not ablatable.** The README says the 4 scalars are
  "redundant with the boundary by design, so you can ablate either". Removing the
  5-neuron scalar+phase block costs −32.9 at L0 and −103.4 at L5. Removing the
  32-neuron boundary block costs more (−172.9 / −199.0), but neither is free. The
  redundancy was designed in; this brain did not use it that way.
- **`prev action` earns nothing on the nominal machine** (+1.9 ± 3.0) and only
  starts paying on the savage one (−6.8 ± 2.8).
- **Block D's documented job is not measurable.** RECIPE says of the fast-coil
  block "this is how the 1.2 s discharge is survived"; ablating it changes the
  discharge by −10.2 fitness at L0 and −1.9 at L5, against a task-level spread of
  hundreds. Whatever survives the discharge, it is not principally those four
  neurons.

**5. How much of the teacher is left after 400 generations.** Stepping the PID
alongside the champion's own plasma (integrators winding on the champion's
states, exactly as DAgger labels) over 71,200 control steps on held-out seeds,
and correlating what each would command:

| output | correlation with the teacher |
|---|---|
| 18 — fast in-vessel coil (vertical stabilisation) | **0.874** |
| 0–15 — the 16 shaping coils | **−0.09 to +0.42** |
| 16–17 — ohmic | 0.06, 0.02 — and the champion drives them **4–7× harder** (RMS 0.191/0.151 vs the teacher's 0.047/0.021) |

Overall `RMS(champion − teacher) = 0.576` against the teacher's own
`RMS = 0.518`: the champion's commands differ from its teacher by more than the
teacher's entire signal amplitude.

So evolution **kept the millisecond vertical loop almost verbatim and rewrote the
whole slow allocation** — including taking up two ohmic circuits the PID leaves
nearly idle. That is a coherent story with the scoreboard: the PID still wins
`circular` and `elongated`, which are the shape tasks its feed-forward terms fit
best, while the learned brain wins everything where allocation has to be traded
against stability. *Caveat*: correlation is measured on the champion's own
trajectory distribution, so the teacher is partly being asked about states it
would not have visited; the fast-coil channel is on that same distribution and
still reads 0.874, which limits how much of the shaping result that can explain.

**6. The mutation scale is 400 generations stale.** `calibrateScales()` is called
in exactly one place — `imitate.js:367`, at the end of each DAgger round. It is
never called during the GA, and `Net.fromJSON` only calls it when a checkpoint has
no scales at all. The shipped champion's layer weights have since drifted well past
the scales mutation is still sized against:

| layer | stored scale | actual RMS today | ratio |
|---|---|---|---|
| 219→64 | 0.1663 | 0.2504 | **1.51×** |
| 64→48 | 0.1933 | 0.2197 | 1.14× |
| 48→19 | 0.1753 | 0.1895 | 1.08× |

Mild — a 1.5× under-mutation on the input layer, not the 43× the mechanism was
built to prevent — but it is the same failure mode in miniature, and it grows
with run length. A long run should re-calibrate periodically, or on resume.

**7. The DAgger degradation documented for `vtrack` did not reproduce.** RECIPE
warns that each extra round made the clone worse at `vtrack` (5.96 → 7.76 → 8.75
cm) and that one should not pick the round with the lowest loss without checking
the per-task breakdown. In today's 5-round run `vtrack` improved monotonically:
17.37 → 17.86 → 10.63 → 10.56 → **9.10 cm**. The underlying warning still holds
from this run's own data — round 3 scored *worse* on the exam than round 2
(0.186 vs 0.190) while its training loss kept falling — but the specific numbers
in RECIPE belong to a different run and should not be read as a general result.

**8. `vtrack` is where cloning is worst and evolution best.** The clone's worst
task by a distance is vertical tracking (9.10 cm, fitness −154 in its own eval;
5.48 cm on the compare bank). That is exactly the task where the shipped brain's
margin over the PID is largest — 2.75 cm against 6.31. The GA's biggest single
gain is on the task its starting point handled worst, which is the behaviour the
`sqrt` reward normalisation was designed to produce.

**9. The GA stage still runs, and the resume dip is real.** `train.js --resume`
on the freshly reproduced clone was run for 80 generations (~18 s/generation at
pop 80 × 6 episodes on 12 workers) purely to confirm the recipe in RECIPE.md
executes end to end from a clean checkout. It does. The held-out exam went
0.056 (gen 2) → **−0.300** (gen 10–20) → 0.142 (gen 30) and sat there, with
survival back to 100% and 0% disruptions but error at 3.32 cm. That is the
documented resume dip — seeding a whole population from one brain throws away the
diversity the original run had built — and 80 generations is far too few to say
anything about the 400-generation endpoint. **No conclusion about the shipped
brain is drawn from this run**; it is recorded only so the next person knows the
first ~30 generations after a resume look like a regression.

---

## What did not work, or actively misled

| what | what actually happened |
|---|---|
| **Evolving from random weights** | Three runs. Reached 40% survival and 11.3 cm; the PID it was losing to holds 0.8–4.2 cm. Never close. |
| **Plain behaviour cloning** | 40 epochs, loss down two orders of magnitude, **81% of episodes disrupt**. Measured again today. |
| **A memoryless 149-neuron observation** | Three complete runs plateaued near a tenth of the baseline. The suspect was the search every time; the fault was the input. |
| **Absolute mutation σ** | Generation 1 survived 88%, generation 10 survived 35%, never recovered. Mutation was outrunning selection. |
| **Relative σ against the *init* scale, post-gradient** | A 43× under-mutation. The population looks converged at generation one and the GA preserves the brain it was handed. |
| **A reward with no floor** | −20/step at 30 cm off target made immediate suicide the best available strategy. |
| **`DEAD_STEP_COST = 4.5`** | A half-point preference for survival. The brain came out with *worse* survival than doing nothing while scoring better on shape error. |
| **A one-episode exam** | Generation 10's lucky score held the title for 45 generations; every checkpoint written was that brain. |
| **Examining only `results[0]`** | Title frozen for 50 generations while the training best climbed. |
| **Promoting the curriculum on whole-population survival** | 375 generations that never left stage 0. The roster is half deliberate wreckage by design, so its mean never clears any bar. |
| **A task cycle with no rotating offset** | `negd`, `ipramp` and `morph` were never selected on; the population silently specialised on the four tasks it could see. |
| **A difficulty ladder whose first rung was a cliff** | One step took the PID from 4.65 cm to 12.40 cm. The ratchet would have stalled on rung 1 with four rungs unused. |
| **Judging a run by population mean fitness** | It sits near −5 in every log because the bottom of each generation is a deliberately wild fringe. Judge by the best line and the exam. |
| **Python patch scripts with no assertion** | Two `s.replace()` edits with slightly wrong search strings matched nothing and reported success. One sent the temporal block **un-whitened** through a whole run (sds 0.27 to 42.6 on channels meant to be unit variance), found an hour later while testing something else. `graft.js` rescued the champion — an affine change of input normalisation absorbs exactly into the first layer, verified to 3×10⁻⁷ before writing. |
| **A scripted discharge the actuators could not follow** | The ramp-down asked 7.6×10⁵ A/s of a transformer good for ~3×10⁵. Every discharge ended in a VDE 85% of the way through. A reference waveform the hardware cannot track is not a hard control problem, it is a badly written scenario. |

Two environment bugs worth keeping because they are not tokamak-specific:

- **Regularisation constants that were absolute instead of relative.** A coil
  produces ~10⁻⁵ T per ampere, so λ = 10⁻⁴ does not regularise the equilibrium
  solve — it deletes it. The same bug independently turned the PID's magnetic
  observer into a constant.
- **Three of sixteen vessel loops sitting on top of each other**, because the wall
  contour was resampled without closing the loop. Two identical rings are one ring
  described twice, and the inductance matrix is exactly singular.

---

## What this does not establish

- **The physics is one crude model.** Read [PHYSICS.md](PHYSICS.md) before
  drawing any conclusion from any number here. Nothing in this project is
  affiliated with TCV, with Degrave et al. (2022), or with anyone who owns a
  tokamak.
- **This is not learning control from nothing.** The controller was cloned from
  a hand-written PID and the clone alone accounts for 131 of its 149 points over
  doing nothing. "Improved on a known controller" is the honest claim.
- **The PID still wins two tasks on the machine it was tuned for** — `circular`
  and `elongated`, on the nominal rung.
- **Three hours on a laptop is not a training run** for a 219 → 19 policy on a
  10 kHz plant. Generation 400's exam held to 450 with no challenger, but a
  plateau at three hours says more about the budget than the method.
- **The discharge result is zero-shot and partial.** Two in three complete; the
  task is never selected on; it remains the champion's worst task by fitness.
- **One ablation on one champion is not an architecture study.** The ablation
  above says what *this trained brain* uses. It does not say what a brain trained
  without those inputs would have become — the clone-versus-champion sweep in
  measurement 3 is the closest thing here to that experiment, and it points the
  other way from the documented explanation.

---

## Reproduce

```bash
node calibrate.js                                          # → obs_norm.js       (~1 min)
node imitate.js --rounds 5 --seeds 12 --epochs 40 --workers 18   # → training/bc.json  (~25 min)
node train.js --resume training/bc.json --pop 80 --episodes 6 \
              --workers 14 --stage 2 --mutrate 0.06 --mutsigma 0.12   #      (~2.5 h)
node train.js --bake training/checkpoint.json              # → default_brain.js

node compare.js --episodes 12          # the scoreboard
node compare.js --episodes 8 --sweep   # the difficulty ladder — the interesting one
node test_headless.js                  # physics calibration + smoke tests
```

On a shared machine always pass `--workers` explicitly. A trainer that saturates
a box gets itself killed.

## In the browser

`index.html` loads `default_brain.js` directly — no build step, no toolchain. The
page also trains itself:

```
index.html?train&gens=3000&pop=64&episodes=4
index.html?train&gens=2000&resume=default&mutsigma=12&stage=2     # push the shipped brain
```

There is **no imitation stage in the browser** — that needs gradients across a
worker pool — so a browser run starts from random weights and has to discover
from scratch what the Node run was handed, single-threaded, at ~0.25
generations/second. Expect a plateau well below the shipped brain. It does keep
the two things that make a long run worth anything: the same held-out exam over
the top three candidates, and the same difficulty ratchet with the rung-0 anchor.
Note `mutsigma=12` on the resume line, for the reason in §"The learning
approach".

---

## Loose ends found while writing this

Recorded, not fixed.

1. **`nn.js` and `evolution.js` both claim there are no gradients.** `nn.js`
   header: "Evolved only: no gradients anywhere." `evolution.js` header: "the
   genetic algorithm. No gradients, ever." Both were true before `imitate.js`
   existed; the shipped brain is a gradient fit that was evolved afterwards, and
   these are the first two files a reader opens.
2. **`graft.js`'s default argument is the one file it will silently corrupt.**
   It reads `ck.obsNormVersion || 0`, and `train.js --bake` does not write
   `obsNormVersion` — so running `node graft.js` with no arguments (default:
   `default_brain.js`) treats the shipped champion as un-whitened and whitens it
   twice. The file's own header names this exact hazard: "whitening a channel
   that was already whitened is not a graft but a corruption, and a quiet one,
   because the result still runs." Either bake `obsNormVersion` or refuse a
   checkpoint that lacks it.
3. **The bake also drops `level` and `stage`.** `compare.js` prints "this brain
   trained up to L*n*" when the field exists; for the shipped brain it never
   does, and the browser's `resume=default` restarts the ladder at rung 0. It
   also means the champion's headline number — exam 0.717 — **cannot be
   recomputed from the shipped file**, because the exam is defined over the
   unlocked stage and rungs and neither is recorded. Three integers would fix it.
4. **`calibrateScales()` is never called during the GA.** Measurement 6 above —
   the shipped brain's input layer sits 1.51× above the scale its mutations were
   sized against.
5. **RECIPE §3.3 calls block E "the single most valuable block, and the reason
   the controller is robust."** Ablation ranks it fifth of six at L0
   (−6.6 ± 3.9, not significant) and third at L5. The robustness claim it
   supports is real; the attribution to E specifically is not what ablation shows,
   and measurement 3 suggests the cause is the ladder rather than any input block.
6. **README: the 4 target scalars are "redundant with the boundary by design, so
   you can ablate either."** Measured, ablating them costs −32.9 at L0 and −103.4
   at L5.
7. **RECIPE §5 vs `nn.js`.** RECIPE gives the output-layer init as ≈0.004;
   `nn.js`'s comment says ≈0.006. `0.02·√(2/48) = 0.0041`.
8. **RECIPE's `vtrack` DAgger degradation numbers are run-specific** (measurement
   7) and read as a general result.
