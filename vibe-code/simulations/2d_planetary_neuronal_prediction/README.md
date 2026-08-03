# Predicting Planets — a learned force law, found by evolution

A genetic algorithm searches for a **forward model** of a 2D gravitational
system: given where every body is and how fast it is moving, predict where they
will all be one tick later, and keep being right for hundreds of ticks.

No gradients anywhere. Nothing is backpropagated, nothing is fitted in closed
form. The only signal is a fitness number.

The opponent is **Newton**, given exactly the same budget: one force evaluation
per tick, through the same integrator — and, once you take that budget
seriously, **Adams–Bashforth**, which spends the same single evaluation far
better than a one-step method does. The learned model beats the first and loses
to the second, and working out why is most of what this README is about.

```
node test_headless.js                 # 63-check assertion suite
node train.js --gens 2000 --pop 128   # train (worker pool)
node train.js --eval training/checkpoint.json    # full report vs every baseline
node train.js --bake training/checkpoint.json    # → default_brain.js
node sweep.js --what lags             # the paired A/B experiments
node watch_schedule.js 150            # watch the integration scheme evolve
```
Open `index.html` for the interactive version; `?selftest=1` runs the page
synchronously and dumps a JSON report (that is how headless Chrome checks it).

---

## The problem, precisely

**Ground truth.** Full n-body Newtonian gravity in 2D. Every body pulls every
other body, *including the star* — nothing is pinned. Integrated with a
**4th-order Yoshida symplectic** scheme (the standard triple jump of three
leapfrog steps with weights w₁, w₀, w₁), 24 substeps per tick. Relative energy
drift over a full rollout is typically ~10⁻¹¹ and is *guaranteed* below 10⁻⁹ —
any draw that fails that is thrown away. Either way it is five to six orders of
magnitude below the errors being scored. That headroom is deliberate: if the
"truth" wandered at the same scale as a good prediction, the fitness function
would be measuring the integrator rather than the brain.

The test suite also checks the integrator is genuinely 4th order by halving the
step and confirming the error falls ~16× (measured: 4.00). A composition mistake
typically leaves a working but 2nd-order scheme, which nothing else would catch.

**The harness.** Every competitor — the evolved brain, exact Newton, and the
do-nothing baseline — is run through one identical update:

```
aₓ, a_v = <competitor's output>     ← ONE force evaluation per tick
x' = x + v·dt + ½·aₓ·dt²
v' = v +         a_v·dt
```

so a difference in score is a difference in the **force**, never in the
integrator. The cost constraint that makes the comparison fair is *one force
evaluation per tick*, and every competitor pays it.

Position and velocity are allowed **different** effective accelerations, and that
is not a loophole — it follows from the same argument that makes this problem
interesting at all. The exact flow map over a finite step does not factor through
a single vector: the acceleration that best *places* a body is a dt²-weighted
average over the step, the one that best sets its new *velocity* is a dt-weighted
average, and forcing them equal discards accuracy for nothing. Newton fills both
with the same value, because its `a` is the true instantaneous force and has
nothing to split.

**The competitors.**

| | force evaluations per tick | what it is |
|---|---|---|
| do-nothing | 0 | straight lines. The floor. |
| Newton | 1 | the true force, used once. The naive competitor. |
| **Adams–Bashforth 3** | **1** | **the true force, combined with the last two evaluations. The real bar.** |
| Newton×8 | ~16 | eight leapfrog substeps. A ruler, not a competitor. |
| the network | 1 | whatever evolution found. |

Adams–Bashforth deserves its bold. A one-evaluation budget does not oblige anyone
to use a one-*step* method — keeping the previous force evaluations and
extrapolating them is ordinary numerical analysis, costs nothing extra, and is
what a competent implementer would write. Measured here it is worth **+0.78
digits** over one-step Newton and it *beats Newton×8*, which spends sixteen times
the compute. Scoring a learned model against plain Newton would therefore hand it
credit for a textbook result it did not find. The network has to beat AB3.

**Units.** G = 1, AU, solar masses; a 1 AU circular orbit round a 1 M☉ star has
period 2π. Planet masses are log-uniform from ~4×10⁻⁷ to ~6×10⁻³ M☉ — Mars to
several Jupiters — so a single system routinely contains mutual pulls four
orders of magnitude apart.

**The tick** is 1/50th of the **fastest orbit in that particular system**, not a
fixed time and not a fraction of the system's mean timescale. Every system is
then equally well resolved regardless of its size, which is what allows one
genome to be scored fairly across all five difficulty rungs.

**The metric.** Each body's position error is divided by *its own* distance from
the barycentre (floored at 15% of the reference length, so a body near the
origin cannot divide by almost zero). Errors are then averaged **in log space**
at log-spaced checkpoints — ticks 1, 2, 4, 8, … H. Both choices matter:

- *Relative*, because a raw average lets a model ignore the inner system
  entirely and still score well off the outer planets.
- *Log*, because a linear average over a rollout is completely dominated by the
  last few ticks, so one-step accuracy — which has to be right first — would
  carry almost no weight and never get fixed.

Fitness reads directly as **correct decimal digits × 100**. 2.0 digits is 1%
relative error; 3.0 is 0.1%.

---

## The architecture

### Why not one big network

A flat MLP over "all the bodies" has a fixed input width, so it only ever runs
on the body count it was born with, and it has to learn the same force law
separately for slot 3 and slot 7. This is an **interaction network**: one shared
edge network sees a single *pair* of bodies, one shared node network sees a
single body. A genome evolved on four planets runs unmodified on eleven, and the
exam checks exactly that.

Per body *i*, with a per-body recurrent latent *h*:

```
for each message-passing round:
  edge_ij = EdgeNet([ pair invariants, h_i, h_j, ctx ])
  msg_i   = Σ_j ( Σ_k crᵏ·Kᵏ )·r̂_ij + ( Σ_k ctᵏ·Kᵏ )·r̂⊥_ij      ← a VECTOR
  info_i  = mean_j edge_info ‖ max_j edge_info                   ← invariants
  h_i     = GRU(h_i, [ self invariants, info_i, ctx ])

a_i = msg_i + |msg_i|·γ·( n₀·m̂sg + n₁·m̂sg⊥ + n₂·v̂ + n₃·v̂⊥ )     ← one-step part
    + Σ_k p_k·( msg_i(t−k) − msg_i(t) )                        ← multistep part
      with n, p = NodeNet([ self invariants, history invariants, info_i, h_i, ctx ])
```

…and a second coefficient set `q_k` produces the separate effective acceleration
for the velocity half of the update.

### Four choices that carry the design

**1. The output is a kernel mixture, not a force.** A tanh can express ±1. Real
accelerations in one of these systems span seven decades. So the edge network
never emits a force — it emits dimensionless **coefficients over a fixed radial
basis** m/r, m/r², m/r³, m/r⁴, and the basis carries the dynamic range.

Newton is the single point *"coefficient 1 on m/r², zero on the rest"*. It is
reachable, and in no way privileged: the search is free to find anything else in
that four-dimensional space, plus tangential (velocity-coupled) terms, plus the
node correction. **At a finite timestep something else is genuinely better** —
that is the room the whole experiment lives in.

**2. Rotation equivariance and permutation invariance are exact, by
construction.** The edge network reads only rotation-invariant scalars and emits
only scalars, which are then attached to the frame vectors r̂ and r̂⊥. Rotate the
system and every prediction rotates with it, to floating-point precision
(measured: 8×10⁻¹⁶ relative). Shuffle the body order and nothing changes at all.
Both are free here and would otherwise have to be learned from data, badly. The
test suite asserts them because the cheapest way to lose a symmetry is a
one-character mistake that still runs and still trains, just worse.

**3. The past is remembered as a multistep scheme, not as coordinates.** Each
body keeps its last few states and its own last few force evaluations.

Since the state is Markovian this adds no *information* — given exact positions
and velocities the future is already determined. What it adds is a much cheaper
route to it. Under a one-evaluation budget a memoryless predictor is stuck with
the accuracy of a one-step method, and past force evaluations are exactly what a
**linear multistep** method spends to cancel the leading truncation term without
paying for another evaluation. The model already computed those past forces; it
merely has to keep them.

The basis is **differences from the current message**, not the raw past messages,
and that does two jobs. Coefficients then sum to one automatically, so every
reachable scheme is *consistent* — a combination that fails to converge to the
true force as dt → 0 is simply not expressible, which removes a whole family of
ways to score well on short rollouts by being wrong in a self-cancelling way. And
zero means "ignore the history", so a fresh brain begins as the one-step model
and the search only pays for memory once it buys something. Every classical
scheme remains reachable: AB3 is just `p₁ = −5/6, p₂ = 1/4`.

The coefficients come from the node network, so they are **per body** and
conditioned on invariants — how far that body's force has turned since each
remembered tick, how much it has grown, how far its velocity has turned. A body
moving a tenth of the way round its orbit per tick and one moving a thousandth
get different schemes, which is correct and is not something a fixed textbook
rule can do.

**4. Messages sum; descriptions average.** `msg` is a **sum** over neighbours
because forces add — that is physics, and it must keep growing with N. The
information channels feeding the memory and node network are a **mean** and a
**max**, because those are descriptions, and a description whose magnitude
scaled with body count would saturate the first time the model met a bigger
system than it trained on.

### The recurrent latent

Each body carries a GRU hidden state across the rollout, so it can accumulate
its own orbital context instead of re-deriving everything from one frame.

This is in here specifically **because it is a GA**. Recurrence is expensive for
gradient methods — backpropagating through a 256-tick rollout is the reason
forward-model work tends to stay Markovian — and completely free for a search
that only ever runs the network forwards. The update-gate bias starts at +1 so a
fresh cell *retains* rather than overwrites; at init the candidate is ≈0 either
way, but it means the first mutation that writes something into memory finds a
cell that will keep it.

### The image

`Feed it an image` adds an 8×8 **log-mass raster** of the whole system,
canonically rotated so the heaviest planet is always to the right, encoded
through its own network to a short context vector appended to every edge, node
and memory input.

The cell value is log mass over nine decades, not linear mass — linearly, a star
is 1.0 and an Earth is 0.000003, so every planet rounds to the same black pixel
and the picture carries exactly one bit ("where is the star"). The canonical
rotation is what stops the image destroying the exact rotation equivariance
described above; without it, the model's symmetry would silently degrade to
approximate.

Stated up front: **for pure gravity this is redundant.** The pairwise features
already contain every mass and every separation exactly, and the raster contains
them blurred into 64 buckets. It is here because it is cheap, because it is a
genuinely scalable way to summarise a crowd, and because "does it help" is worth
an experiment rather than an opinion. It got one — see below.

---

## Difficulty ladder

| rung | bodies | ecc | rollout | notes |
|---|---|---|---|---|
| L0 calm | 3–4 | ≤ 0.05 | 32 ticks | |
| L1 spread | 3–5 | ≤ 0.14 | 64 | |
| L2 eccentric | 4–6 | ≤ 0.24 | 128 | |
| L3 crowded | 5–8 | ≤ 0.34 | 256 | 15% binary companion |
| L4 wild | 6–10 | ≤ 0.45 | 512 | 35% binary companion |

Promotion is set **relative to what coarse Newton scores on the same rung**, not
as an absolute digit count. Achievable accuracy falls as systems get nastier, so
an absolute bar would be unreachable at the top and trivial at the bottom;
"beats the analytic force law it is competing with" means the same thing on
every rung.

### Systems are rejected before they are used

Four rules, each because the alternative is a fitness function measuring
something other than the brain:

- **Resolution** — the fastest body must get ≥ 20 ticks per orbit. Below that it
  is aliased and *nobody* can predict it; that does not make the task harder, it
  makes it impossible, which is different.
- **Escape** and **close approach** — the signature of a chaotic scattering. One
  ejection mid-episode turns that episode's score into a lottery on the draw.
- **Truth quality** — if the reference integrator's own energy drifts past 10⁻⁹,
  the truth is no longer far enough above what is being scored.

Draw acceptance, measured over 200 attempts per rung: **100%** at L0 and L1,
**99%** at L2, **89%** at L3, **51%** at L4 — and at L4 the rejections are
almost entirely close approaches (53) and escapes (18), which is exactly the
population of systems that should be thrown away.

The resolution rule deserves one note. Because the tick is *defined* as
`fastest orbit / N`, that rule is a statement about the configuration rather
than about any particular draw: set N below the floor and it rejects every
system that will ever be generated, and the page silently renders an empty
frame. The UI slider's minimum is pinned to the floor for that reason, and the
test suite asserts the contract from both sides.

---

## What the search does

Standard elitist GA — untouched elites, mutated elites, row-wise crossover
(whole neurons move as a unit; swapping individual weights scrambles what each
neuron computes), a rank-weighted tail with mutation strength growing down the
ranks, and fresh immigrants that taper off as the champion improves.

Two things are load-bearing:

**Common random numbers.** Every individual in a generation is scored on the
*same* systems, held constant for a block of generations. With a fresh draw per
individual, two brains differing by one mutation are ranked on which system each
drew, and selection stops working.

**Held-out exam.** Training scores are measured on the very systems the
population was selected against, so the best line is partly luck. Only a
separate fixed set of never-trained seeds decides who is champion — and the top
*three* brains are examined, not just the training winner, because
`results[0]` under a wide mutation is usually a lucky draw and with one
candidate the champion stops moving while the training score keeps climbing.

---

## Three bugs the tooling caught

Recorded because in each case the search kept running, the loss kept improving,
and nothing looked wrong.

**1. The timestep input was a constant.** The first scaling was
`clamp(dt/T · 25, 0, 3)`. Real systems put `dt/T` between about 0.02 and 0.13,
so that sat pinned at the upper clamp for the entire operating range —
`probe.js` printed byte-identical predictions for 16, 25, 40 and 50 ticks per
orbit. The model could not see the step size at all.

That is not a cosmetic input bug. Step-size dependence **is** the mechanism: a
force law that beats Newton at finite `dt` does so by correcting the
*integrator*, and a correction to an integrator has to know how long the step
is. After switching to log scaling the search reached +0.35 digits over Newton
by generation 60, where the broken version needed ~160 generations to reach
+0.19.

The clearest evidence that the input was load-bearing: the champion trained
under the clamped version scores **+0.48 / +0.43 / +0.00** against Newton on
L0/L1/L2 when evaluated under the clamped scaling, and **−0.11 / −0.03 / −0.20**
when the same weights are re-scored under the fixed scaling. It had learned to
use that constant as a bias.

**2. Resuming a run destroyed the checkpoint it resumed from.** `bestExam`
started at −∞, so the first report after a resume always counted as an
improvement and always overwrote `checkpoint.json` — and the first report after
a resume is reliably *worse*, because the population is rebuilt by mutating one
champion outward and has lost the diversity the original run accumulated.
Measured: a 2.129-digit checkpoint replaced by a 1.828-digit one. A resumed run
now inherits its own high-water mark.

**3. The UI offered a timestep at which nothing exists.** Because the tick is
*defined* as `fastest orbit / N`, the resolution rule is a property of the
configuration, not of a draw — below the floor it rejects every system that will
ever be generated and the page renders an empty frame with no error anywhere.

## What the search actually found

`node probe.js training/checkpoint.json` reads the law back out by putting a
test planet at a known radius with the reference scales pinned, and dividing the
model's acceleration by `G·M/r²`. A model that merely rediscovered Newton would
print 1.000 flat, with nothing tangential.

It does not. The learned radial coefficient **varies systematically with
distance**, and there is a substantial **tangential** component — which, since
Newton's force is exactly central, cannot be gravity. It is a velocity-coupled
term, and that is precisely the shape a finite-step integrator correction takes.

Shipped champion, at 50 ticks per fastest orbit:

| r / L | radial (÷ Newton) | tangential | reading |
|---|---|---|---|
| 0.35 | 1.0004 | 0.021 | Newton, essentially exactly |
| 0.50 | 1.0141 | 0.075 | +1.4% |
| 0.70 | 0.9591 | 0.067 | −4.1% |
| 1.00 | 0.8640 | 0.106 | −13.6% |
| 1.40 | 0.7920 | 0.186 | −20.8% |
| 2.00 | 0.7461 | 0.287 | −25.4% |
| 2.80 | 0.6946 | 0.437 | −30.5% |

It **reproduces Newton almost exactly close in**, and progressively weakens the
central pull further out while adding a growing tangential term. In this rig the
step is tied to the test body's own orbital period, so `dt/T` grows with `r` —
the correction grows precisely where the step is relatively coarsest, which is
what an integrator correction should do.

## Can it beat Newton? Yes. Can it beat Adams–Bashforth?

**Beating Newton turned out to be the wrong question**, and the honest version of
this section had to be rewritten once the multistep baseline existed. The table
below therefore carries two comparison columns. The `vs Newton` one is the claim
this project started with; the `vs AB3` one is the claim that actually means
something, because AB3 costs the same single force evaluation and is what any
competent implementation would already be doing.

For calibration, the **old** champion — the one shipped before the model could
remember anything — scored +0.483 / +0.454 / +0.187 against Newton on the first
three rungs. Every one of those is *below* AB3's +0.78. It was beating the naive
baseline and losing to the textbook.

Held-out systems, never trained on. Everything except `Newton×8` gets one force
evaluation per tick.

| rung | do-nothing | Newton | **AB3** | Newton×8 | **BRAIN** | vs Newton | vs AB3 |
|---|---|---|---|---|---|---|---|
| L0 calm | 0.916 | 2.092 | *2.786* | 2.823 | **2.592** | **+0.500** | −0.195 |
| L1 spread | 0.740 | 1.807 | *2.583* | 2.470 | **2.233** | **+0.426** | −0.350 |
| L2 eccentric | 0.524 | 1.577 | *2.336* | 2.160 | **1.782** | **+0.205** | −0.554 |
| L3 crowded | 0.408 | 1.439 | *2.156* | 1.977 | **1.569** | **+0.130** | −0.587 |
| L4 wild | 0.284 | 1.202 | *1.905* | 1.713 | 1.106 | −0.096 | −0.799 ← never trained |

**Against Newton: yes, by about a factor of three in position error on the calm
rungs** (+0.50 digits ≈ 3.2×), holding up through every rung it trained on and
falling to just below parity on the wildest one it never saw.

**Against Adams–Bashforth: no, on every rung.** The gap widens as the systems get
harder, from −0.195 on calm to −0.587 on crowded. The learned force law is a
better one-step scheme than Newton and a worse integrator than AB3.

The **L3 row is worth reading twice** for a different reason. The model reaches
it via the curriculum, and the interaction-network architecture transfers there
without modification — 5–8 bodies against the 4–6 it started on, over a 256-tick
rollout against 128 — which is exactly the job that architecture was chosen for.
It still beats Newton by +0.130 there. It is still half a digit behind a
scheme with no parameters at all.

It never reaches `Newton×8`, and should not: that spends about sixteen force
evaluations per tick against everyone else's one.

### What it did *not* learn — the honest limit

The correction barely depends on the timestep: holding `r` fixed and sweeping
the step over 7.5×, the radial coefficient moves about 1% (0.855 → 0.848). So
the obvious question is whether the advantage survives a change of tick length.
Mostly it does not:

| ticks / orbit | Newton | BRAIN | vs Newton |
|---|---|---|---|
| 25 (coarser) | 1.024 | 1.519 | +0.495 |
| 35 | 1.421 | 1.938 | +0.517 |
| **50 (trained here)** | 1.792 | 2.210 | **+0.417** |
| 75 | 2.316 | 2.514 | +0.197 |
| 100 (finer) | 2.710 | 2.690 | **−0.020** |

The advantage still decays as the step gets finer, and for a clean reason: at a
fine step plain Newton is already nearly exact, there is no truncation error
left to correct, and the model's learned deviation from 1/r² becomes pure
error. What the search finds is a **modified force law tuned to a step-size
regime** rather than a fully general step-size-aware correction — it is given
`dt` as an input and uses it only weakly.

It is markedly better than the previous champion at this, though. That one
peaked at +0.442 and *inverted* to −0.214 by 100 ticks per orbit; this one is
stronger at every coarse step (+0.495 against +0.284 at 25) and merely reaches
parity at 100 instead of losing. The remaining fix is still the untried one:
randomise the tick length across training rather than fixing it at 50. The
machinery is already there (`--tickfrac`), it was simply held constant.

What the learned force actually looks like: **7–10% weaker than Newton** through
the middle of the system (0.927 of Newtonian at r = L, 0.892 at 2L), stronger
inside 0.5 L, with a tangential component that grows sharply at large radius
(0.406 at 2.8 L). A central force cannot have a tangential component at all, so
that term alone is proof the search is doing integrator correction rather than
fitting a force.

The recurrent memory is doing a little more than it used to but is still close
to decorative — on an unchanging state the predicted force drifts 3.8% between
the first evaluation and the hundredth, up from 0.67% in the previous champion.

## The experiments

All paired: every variant sees the same initial populations and the same
systems, because one run of this environment is noisy enough that an unpaired
comparison mostly measures which seed each arm drew.

### Output-layer initialisation — a clear result, opposite to the argument

`node sweep.js --what outscale` (5 variants × 3 reps × 60 gens, L1):

| init (fraction of He) | vs Newton, per rep | mean |
|---|---|---|
| 0.02 | −0.06 −0.15 −0.06 | −0.092 |
| **0.10** | −0.08 −0.04 −0.05 | **−0.060** |
| 0.35 | −0.57 +0.02 −0.37 | −0.307 |
| 0.70 | −0.32 −0.20 −0.27 | −0.267 |
| 1.00 (plain He) | −0.39 −0.27 −0.57 | −0.410 |

The argument for a large value is that this is regression, the answer sits at a
coefficient of 1.0, and starting at 0.02 means random-walking up two orders of
magnitude. The measurement says the opposite, decisively — plain He finishes
0.35 digits behind 0.10, and loses on every rep.

The reason is the same one that governs a control task. A fresh brain with large
random kernel coefficients applies a wrong force field, the rollout diverges,
the error saturates at the ceiling, and every individual in generation 1 scores
identically badly. Selection needs *differences*; near zero the population
starts spread along the smooth approach to the answer instead of piled against
the ceiling.

### Architecture — no result, and that is the finding

`node sweep.js --what arch` (5 variants × 3 reps × 110 gens, L1):

| variant | params | vs Newton, per rep | mean |
|---|---|---|---|
| baseline (no image, mem 8, 2 rounds) | 2062 | −0.18 +0.00 +0.23 | +0.019 |
| + image | 3552 | +0.13 +0.06 −0.02 | +0.058 |
| − memory | 998 | −0.15 +0.13 −0.13 | −0.051 |
| − 2nd round | 2062 | −0.09 +0.28 +0.24 | +0.143 |
| raw features (no 1/r² offered) | 2026 | +0.15 +0.18 +0.03 | +0.118 |

**Nothing here is significant.** The spread *within* a variant is ±0.2 digits;
the largest difference *between* variants is 0.19. Reading a winner off this
table would be reading noise — and the giveaway is that "hide the 1/r² hint",
which removes information the model demonstrably uses, comes out nominally
*better* than the baseline. Separating a 0.12-digit effect at this spread needs
roughly a dozen repetitions a side, not three.

It is worth recording what the same sweep said before the timestep bug was
fixed: baseline −0.110, **+image −0.382**, raw −0.223 — an apparently decisive
ordering, with the image losing on both reps. It was an artifact. A broken input
made a noise-dominated comparison look conclusive, which is a good argument for
running the A/B again after any change to the inputs.

### Does the image help? — a real answer

The one question worth spending the whole repetition budget on, since it is the
architectural idea this project was asked to test.
`node sweep.js --what image --reps 10` (110 gens, L1, paired):

| variant | params | mean vs Newton | reps favouring |
|---|---|---|---|
| **no image** (pairwise features only) | 2062 | **+0.042** | 7 of 10 |
| + 8×8 log-mass raster | 3552 | −0.019 | 3 of 10 |

Paired difference **+0.062 ± 0.060 digits** in favour of dropping the image
(t ≈ 1.0 on 9 df, p ≈ 0.32).

So: **not a statistically significant harm, but no benefit whatsoever, at 72%
more genome** (2062 → 3552 parameters). The recommendation is clear even though
the harm is not proven — you are paying 1490 extra weights for an effect
indistinguishable from zero, and the point estimate is on the wrong side.

This is the expected answer, and it is worth being precise about *why*, because
it is not "images are useless". For **pure gravity the raster is strictly
redundant**: the pairwise edge features already contain every mass and every
separation exactly, and the image contains the same information blurred into 64
buckets. There is nothing in the picture that is not already in the inputs, so
the only thing the extra parameters can do is dilute the search.

The interesting corollary is where it *would* pay: a system whose dynamics
depend on something genuinely non-pairwise — a drag field, a dust distribution,
a potential that is not a sum over bodies — is exactly the case the pairwise
features cannot express and a global raster can. The switch stays in the UI for
that reason.

A follow-up asked whether a **finer** raster rescues it — `--what grid`, 8×8
against 16×16. It does not, and the redundancy argument says why in advance:
more buckets is more resolution on information the edge features already carry
*exactly*. Resolution was never the binding constraint.

### Memory as a multistep scheme — a negative result, then the reason for it

The first attempt at giving each body a memory of its own past force
evaluations was **worse than having none**.
`node sweep.js --what lags --reps 8` (200 gens, L1, paired):

| variant | params | mean vs Newton | per-rep spread |
|---|---|---|---|
| **lags 0 (one-step)** | 2096 | **+0.191** | +0.02 … +0.39 |
| lags 2 | 2928 | +0.020 | −0.32 … +0.29 |
| lags 4 | 3412 | +0.064 | −0.31 … +0.35 |

The paired difference between `lags 0` and `lags 4` is +0.127 ± 0.10 (t ≈ 1.3 on
7 df), so *"history is worse"* is not itself significant. What **is** unambiguous
is the comparison none of them make: hand-coded Adams–Bashforth 3 scores
**+0.78** on these systems for free. Every learned variant sat a full half-digit
below a scheme with no parameters at all. The search was not finding a multistep
method — it was just paying for a bigger genome.

The diagnosis is credit assignment, and it is a design error rather than a fact
about the problem. With the coefficients read off the node network's output
layer, landing on AB3 means arranging a particular pattern of activations across
a 24-unit hidden layer, for every body in every system, through weights that are
all simultaneously doing other jobs. Nothing about that is easy for a GA.

**The fix is the kernel-basis argument applied one level up.** The edge network
does not emit a force spanning seven decades; it emits dimensionless
coefficients over a basis that carries the range. So the integration scheme now
gets its **own small genome** — 2·lags free numbers, mutated directly, shared by
every body — and the node network emits a per-body *adjustment* on top. AB3 went
from "a coordinated rewrite of a hidden layer" to **four mutations**, and the
test suite asserts it is exactly representable (set the eight numbers by hand,
every body emits AB3 to 1.8×10⁻⁸).

The general lesson, which this codebase has now learned twice: when a search
cannot find a structure you know is there, the question to ask first is not *how
many more generations* but *how many mutations away is it*.

### …and it still lost. The order of learning turned out to be the real problem

With the schedule reachable, the A/B was re-run. It got *worse*:

| variant | params | mean vs Newton |
|---|---|---|
| **lags 0 (one-step)** | 2096 | **+0.191** |
| lags 2 | 2932 | +0.052 |
| lags 4 | 3420 | −0.021 |

But this time the mechanism was visible, because the schedule could be watched
directly (`scratchpad/sched_watch.js` prints the champion's coefficients every
ten generations):

```
gen   digits   vs Newton   vs AB3    position schedule        velocity schedule
  1    1.042     -0.760    -1.532    0.000  0.000  …          0.000  0.000  …
 30    1.808     -0.069    -0.824    0.308  0.083  …          1.136  0.666  …
150    1.717     -0.052    -0.820    0.293 -0.790  …          0.920  0.158  …
   AB3 target:                      -0.833  0.250            -1.333  0.417
```

The coefficients move freely now — the genome fix worked — and they move to the
**wrong sign**, then stall. The `digits` column says why: at generation 150 the
model scores **1.717 against Newton's 1.769**. It has not yet matched Newton's
*force law*.

That is the whole explanation, and it is not a search failure. Adams–Bashforth
earns its +0.78 by extrapolating **exact** forces; the leading truncation term it
cancels is only the dominant error when everything else is right. Combine four
lagged copies of a force that is still wrong and the errors compound instead —
so the search is *correct* to drive the coefficients away from AB3. A multistep
scheme is worth a great deal on an accurate force and less than nothing on a bad
one.

**So the two things have to be learned in order**, and the fix is a
prediction-preserving graft:

1. **Phase 1** — `--lags 0`. Learn the force law on the smaller genome, with no
   history and nothing to distract the search.
2. **Graft** — `--graft`. Widen the champion to carry history. Every new input is
   a zero column and every new output a zero row, so the history reads as
   "nothing has changed", the multistep differences are exactly zero, and the
   grafted brain **is** the phase-1 brain. The test suite asserts this at
   bit level: 12 ticks, 2360 → 3420 parameters, maximum difference `0`.
3. **Phase 2** — continue at `--lags 4` from a working force law, with the
   machinery present but idle, so the extra parameters are judged only on what
   they add.

The node hidden width is deliberately independent of `lags` for this reason.
Turning history on changes the node network's input width and output count,
which are both edge-of-the-matrix changes a graft can zero-fill exactly;
resizing the hidden layer would mean inventing units in the middle of a trained
network, which is the one kind of surgery that cannot be made free.

### The graft failed too — and *that* is the interesting result

Phase 2 was run twice from the same phase-1 champion (exam 2.202, +0.205 over
Newton on its rung):

| phase-2 variant | exam at the graft | after ~120 generations |
|---|---|---|
| schedule starts at **zero** | 2.202 (unchanged, as designed) | 2.202 — completely flat |
| schedule starts at **AB3** | **1.805** — *worse* | 2.041, still climbing back |

Both are bad, and they are bad in a way that says the same thing.

**A force law learned without history is not an approximation to Newton.** It is
a deliberate deviation from 1/r², and the job of that deviation is to cancel
one-step truncation error — which is precisely the error a multistep scheme
cancels. The two are rival solutions to the same problem, not complementary
ones. This was in fact already documented, one section down, before any of this
work: *"what the search actually found is a modified force law tuned to a
step-size regime"*. That sentence is exactly the reason a multistep scheme
cannot be bolted onto it afterwards.

So installing AB3 on a finished one-step force law double-corrects and the score
*drops*. And starting the schedule at zero leaves the search on a **saddle**:
every small coefficient is a step downhill, because it begins undoing a
compensation the force law is still applying. Neither variant can get anywhere,
for the same reason, from opposite directions.

**The fix is to reverse the order entirely.** Put the scheme in *before the
force law exists* — every brain is born holding AB3 (`--schedinit ab3`) and
learns its force law around it from generation one. The search then never has a
reason to build truncation compensation into the force, and what it learns is a
correction to whatever AB3 *leaves behind*.

That the classical coefficients are handed over rather than discovered is a
deliberate, and declared, choice. The AB3 baseline is reported in every table
and on the page itself, so a seeded schedule cannot quietly take credit for the
scheme it was given: the only number that counts as a result is the margin
*above* AB3. Whether evolution can find the scheme unaided remains open — the
honest summary is that at these budgets it did not, twice, and the reason is
that the search reaches it through a valley rather than down a slope.

### Why beating AB3 is much harder than beating Newton

Scheme-first works — it is the most accurate configuration built here — but it
does **not** clear Adams–Bashforth, and the reason is worth stating plainly
because it is the real answer to *"how much accuracy is available?"*.

Against plain Newton, the error a learned force law has to attack is **one-step
truncation**. That error is large, smooth, and systematic, so a modest deviation
from 1/r² captures a lot of it — which is why every champion in this project
beats Newton comfortably and why the very first one already managed +0.48.

AB3 removes that same error outright, and removes more of it than any learned
force law here has managed. What is left over for the network to correct is a
*higher-order* residual: smaller, less systematic, and — decisively — **smaller
than the model's own error in approximating 1/r² in the first place**. The
network is trying to fix a residual while introducing a larger one.

That is a limit of the approach, not of the search budget, and it reframes the
headline honestly:

- **beating Newton** — comfortable, and a much weaker claim than it sounds,
  because a one-step method is not what a numericist would have written;
- **beating Adams–Bashforth** — not achieved. The multistep scheme is worth
  more (+0.78) than everything the learned force law contributes on top of it.

The practical accuracy answer, then, is that the single biggest win available in
this harness was never a better *force* — it was a better *integrator*, and it
was sitting in a textbook the whole time.

## The page

Deliberately **not** a control panel. Three decisions about what it does and
does not expose:

**No search parameters.** Population, mutation, trial count and grace are
constants in `main.js`. A page whose job is to show a finished result should not
offer a rack of knobs for a training run nobody will sit through in a browser
tab, and every one of them present implies an interactivity that is not really
there.

**The step size is pinned**, and that one is a correctness issue rather than
taste. The champion was evolved at 50 steps per orbit and its advantage over
Newton *inverts* at finer steps (see the table above). A viewer who nudged that
slider would have watched the network lose and reasonably concluded it did not
work.

**Only the scenarios the shipped brain was trained through** appear as buttons —
the first three rungs. Watching a champion fail on a rung it has never seen is
not an informative demonstration, it is a misleading one. The untrained-rung
numbers belong here in the README, next to the caveat. `train.js` still uses the
full five-rung ladder.

What the picture shows is separated on four independent channels at once, so
there is never a question about which body is real and which is the guess:

| | real orbit | network's prediction |
|---|---|---|
| body | lit, shaded, solid world | hollow **dashed** ring |
| trail | solid | **dashed** |
| palette | cool blue | warm orange |

with a red line joining each pair whose length is exactly the quantity being
scored. Shape and stroke carry the same message as colour, so it survives
greyscale and colour-blindness. A perfect prediction hides its ring inside the
real planet and shows no red at all.

Bodies are drawn as actual worlds — star with corona, banded gas and ice giants,
shaded terrestrial worlds, irregular planetoids — classified by their share of
the system mass against the real thresholds (Jupiter 9.5×10⁻⁴, Neptune 5×10⁻⁵,
Earth 3×10⁻⁶, Mars 3×10⁻⁷). The mass range in one system spans four orders of
magnitude and a uniform dot throws that away.

## Reproducing

The shipped champion (`default_brain.js`) comes from a **two-phase** run — the
force law first, the integration scheme second. The section above explains why
that order is not optional.

```
# PHASE 1 — the force law. No history, smaller genome, nothing to distract it.
node train.js --lags 0 --gens 3000 --pop 128 --trials 5 --workers 26 \
              --level 0 --promoteref newton --promote 0.20 --mutsigma 0.35 \
              --out training_p1

# PHASE 2 — widen it to carry history, preserving every prediction it makes.
node train.js --lags 4 --graft training_p1/checkpoint.json \
              --gens 3000 --pop 128 --trials 5 --workers 26 \
              --promoteref adams3 --promote 0.05 --out training

node train.js --eval    training/checkpoint.json   # full table vs every baseline
node probe.js           training/checkpoint.json   # the force law AND the scheme
node watch_schedule.js  150                        # watch the coefficients move
node train.js --bake    training/checkpoint.json   # → default_brain.js
```

Three notes from doing it:

**Grafting is not resuming.** `--resume` refuses a checkpoint whose spec differs;
`--graft` exists precisely to change it, and only ever in the direction of
*adding* lags. It inherits the rung along with the weights — a grafted champion
dropped back to L0 would spend a hundred generations re-earning a promotion it
already held, which is exactly the compute the two-phase split was meant to save.

**The promotion bar can freeze the ladder.** At `--promote 0.35` the L0 search
plateaued at **+0.346** — a real result, and 0.004 short of a bar it could not
clear, so the model would only ever have seen calm 3–4 body systems. Set the bar
to something the search can actually reach or the curriculum never starts.

**Resume rather than restart when you lower it**, and check the printed gate
line: a resumed run inherits its own high-water mark, so `checkpoint.json` is
only replaced by something genuinely better. `latest.json` is written
unconditionally alongside it — one gating bug should never be able to discard a
whole run.

## Files

| file | what |
|---|---|
| `physics.js` | truth integrator, system generator, rejection rules |
| `model.js` | the interaction network, kernel basis, raster |
| `nn.js` | MLP + GRU cell, both as breedable weight bags |
| `world.js` | rollouts, error metric, baselines, trial sets |
| `evolution.js` | the GA |
| `render.js` / `ui.js` / `main.js` | the page |
| `train.js` | worker-pool trainer, exam, ladder, `--bake`, `--eval` |
| `sweep.js` | paired A/B experiments |
| `probe.js` | reads the learned force law *and integration scheme* back out |
| `watch_schedule.js` | prints the multistep coefficients as they evolve |
| `test_headless.js` | assertion suite |
| `training/logs/` | raw logs of the runs quoted above |

Two URL hooks exist for headless tooling, because rAF barely fires under
Chrome's `--virtual-time-budget` and anything frame-driven silently produces
nothing: `?selftest=1` drives every subsystem synchronously and dumps a JSON
report, and `?warm=N&level=L` runs N generations, advances the showcase and
paints one frozen frame for a screenshot (`level` is clamped to the trained
rungs, like the buttons).
