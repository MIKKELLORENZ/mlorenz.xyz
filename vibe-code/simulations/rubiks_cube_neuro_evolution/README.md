# Rubik's Cube Neuroevolution

A neural network that turns a Rubik's cube **by looking at it**.

Its entire input is a 32×16 pixel rendering of the cube from two opposite corners.
No facelet array, no colour histogram, no "how many stickers are correct", no
search over move sequences. It reads pixels, picks one of eight quarter turns,
gets a fresh rendering, and picks again.

The novelty is the input. Every other neuroevolution project in this folder hands
its brains a hand-designed sensor vector, and the feature engineering is most of
the work. Here the features are whatever a network can find in a picture.

**The brain the page loads is gradient-trained**, and clears seven-turn scrambles 73.5%
of the time. The genetic-algorithm champion the project was built around clears them
14.5% of the time on the same cubes, reading the same pixels through the same eight
actions; it is kept at `training/evolved_brain.js` as the control and is not loaded by
the page. That gap *is* the result, and the round that measured it is
["The one-minute probe"](#the-one-minute-probe-that-should-have-been-run-in-round-one).
The GA line is the bulk of what follows.

---

## The short version of what happened

Five things turned out to matter far more than the genetic algorithm, and all five
are the kind of problem that presents itself as *"evolution is too slow"*:

1. **The action space is a subgroup.** Turning only U, D, L and R reaches about one
   part in two thousand of the cube group. Scramble a cube with F or B in it and no
   policy can solve it — the good policy does not exist. Scrambles have to be built
   from the same generators the solver is given.

2. **A memoryless observation makes the task provably impossible.** If the network
   sees only the current cube, a deterministic policy is a deterministic map on a
   finite state space, so its trajectory must enter a cycle. It will turn U, then
   U', then U forever. This is an *observability* bug wearing a learning bug's
   clothes, and it is fixed by adding a move-history window and a clock, not by
   training longer.

3. **Counting correct stickers — the obvious dense reward — is blind on exactly
   the states that matter.** U, U2 and U' all score 42/54. One move from solved,
   two moves from solved, and one move the *other way* are indistinguishable. The
   reward is dense and flat, which is worse than sparse and honest.

4. **Shading costs more than it buys.** The worry going in was red-versus-orange;
   measuring said the real problem is that a pixel carries colour × face-brightness,
   and strong shading brings yellow-on-a-dim-face within 0.20 of orange-on-a-bright
   one. Gentle shading takes the worst of those 36 combinations from 0.20 to 0.38,
   and loses nothing, because position already tells the network which face it is
   looking at.

5. **How much history the network gets was worth more than everything in points 1–4
   put together, and it was the one thing never measured.** Two rounds of work went
   into the reward, the architecture and the breeding operators while the observation
   sat untouched, because it had been *reasoned about* carefully rather than tested.
   Going from two remembered moves to four is the largest single effect in the
   project; dropping the second image *frame* is larger still. The brain was
   memory-limited, not perception-limited — and from a score those are
   indistinguishable, because a policy that cycles and a policy that is merely bad
   both just fail to solve.

The reward function grid search is where (3) stops being an argument and becomes a
measurement. Point 5 is the one that cost two rounds, and it is written up last
because that is the order it was learned in.

---

## The puzzle

`cube.js`. Standard 3×3×3, 54 facelets, six colours.

**Actions: eight.** `U U' D D' L L' R R'` — quarter turns of the top, bottom, left
and right faces. Front and back never move. `configs.js` has a `sixfaces` config
that switches on all twelve if you want the whole group.

**The subgroup trap.** ⟨U,D,L,R⟩ is a proper subgroup of the cube group. A cube
scrambled with F or B is usually unsolvable with these eight actions, so
`scramble()` draws only from the active generator set. Building an environment
whose optimal policy does not exist, and then blaming the search, is a mistake this
folder has made before in other guises; it is worth stating loudly.

**The model is geometric, not tabulated.** The usual way to write a cube is to
paste six facelet cycles from a reference and trust them. Every one of those ~120
hand-entered indices is silently wrong in a way that still *looks* like a Rubik's
cube: moves still shuffle stickers, solved is still solved, and a scramble is still
undone by its own inverse. So instead the cube is 26 cubies at integer positions in
{−1,0,1}³, a face turn is an honest 90° integer rotation of one layer, and the
facelet permutation tables are read off the geometry at load time. `test_headless.js`
then checks M⁴ = I, M·M⁻¹ = I, opposite faces commuting, adjacent faces not
commuting, colour conservation, immobile centres, and one external reference fact
(U clockwise carries R's top row onto F).

The same geometry drives the renderer, so the picture the network sees and the
puzzle it is solving cannot drift apart. There is one description of the cube.

**One property that the rewards lean on:** these generators flip corner-permutation
parity, so the Cayley graph is bipartite and **every move changes the true distance
to solved by exactly ±1**. There is no sideways move. The test verifies this
directly over ~10,000 neighbour pairs rather than asserting it.

---

## What the network sees

`vision.js`.

**Two panels, because one viewpoint cannot work.** A cube seen from a corner shows
three faces. A policy that can only see three faces is playing a partially
observable game and cannot solve the cube — half the puzzle is behind it. So the
render is two 16×16 panels side by side in one 32×16 image: one looking down the
U/F/R corner, one down the opposite D/B/L corner. Together they show all six faces
exactly once, and being the same projection means a convolutional filter learned on
one panel is valid on the other.

**The renderer is a sparse matrix.** A training run does tens of millions of
renders, so drawing polygons per frame is out. But the geometry never changes; only
the 54 colours do. Under an orthographic camera the projection of a face is affine,
so every output pixel is a fixed convex combination of a few facelet colours plus a
constant body/background term:

```
pixel = base + Σ wₖ · palette[ state[faceletₖ] ]
```

That is precomputed once by supersampling (3×3 exact point-in-face inversions per
output pixel), which makes the result *identical* to rendering at 3× and
average-pooling down. About 540 non-zeros for the whole image, so a render is a few
thousand multiply-adds. Shading and the sticker gaps fold into the weights and cost
nothing.

**Resolution was measured, not chosen.** The question is whether 54 stickers are
still separately readable after downsampling, and the test for it is: does each
facelet *dominate* at least one output pixel?

| panel size | image | non-zeros | dominant pixels for the worst-read facelet |
|---|---|---|---|
| 10 | 20×10 | 196 | 1 |
| 12 | 24×12 | 268 | 2 |
| **16** | **32×16** | **380** | **4** |
| 20 | 40×20 | 512 | 6 |
| 24 | 48×24 | 712 | 10 |

16 is the default: every sticker owns at least four pixels, and the forward pass
stays around 50k multiply-adds. `res` is a grid-search dimension.

**The palette, and a correction.** The original reasoning here was wrong and worth
recording. The plan was "a real cube's red and orange nearly collide, so spread the
colours out" — but measuring the raw RGB distances says a photographic red/orange
pair sits 0.44 apart, which is *better* than the first hand-picked "clear" palette
managed (0.37). Raw colour separability was never the problem.

What a pixel actually carries is colour **times** face brightness, so the quantity
that has to stay separable is the 36 (colour × face) products. There the collisions
are severe: with strong 0.58–1.00 shading, the worst pair comes within **0.20**.
Two changes, both measured:

- spread the six colours in RGB — the three warm ones separated along the green
  channel at 1.00 / 0.50 / 0.00, the only axis they have — taking the worst raw
  pair from 0.37 to **0.50**;
- shade *gently*, 0.82–1.00, taking the worst of the 36 products to **0.38**.

Losing the strong face cue costs nothing, because each face occupies a fixed region
of the panel — *position* already says which face a pixel belongs to. The animated
cube on the page shades harder, because human eyes want the depth cue.

### The observation vector

3089 numbers:

| block | size | why |
|---|---|---|
| 2 rendered frames, RGB, plane-major | 6 × 16 × 32 = 3072 | the cube now, and one move ago |
| last 2 moves, one-hot | 2 × 8 = 16 | so it can avoid undoing itself |
| move clock | 1 | so the observation never repeats |

**The clock is normalised by a constant, and that is not cosmetic.** The move budget
is `min(20, trueDistance + 6)`, so a depth-2 cube is not given twenty moves to flail
in. Normalising the clock by *that* budget let the network read its scramble's
difficulty off the scale of its own clock — privileged state it must not have. It is
normalised by the constant maximum instead. The test asserts that a depth-1 and a
depth-5 cube produce the same clock value after one move, while their budgets
differ.

**Frame history says what changed**, which is how you tell a turn of the top layer
from a turn of the bottom one without memorising absolute sticker positions. On
reset, every remembered frame is filled with the *current* picture rather than
zeroed — zero-filling would tell the network "the cube was black one move ago", a
signal that occurs only on move 0 and that a GA will happily latch onto as a free
move counter.

### The impossibility result

`tm-memoryless` (one frame, no move history, no clock) is kept as a config
specifically so it can be seen failing. With that observation the input is a
function of the cube alone, so a deterministic argmax policy is a deterministic map
on a finite state space and its trajectory must become periodic. The test
demonstrates both halves: that the same cube gives the same observation regardless
of history, and that every unsolved trajectory does in fact close into a cycle when
run past the budget.

That last detail matters. An earlier version of the test asserted a repeat *inside*
the normal move budget and failed on 2 of 23 episodes — "eventually periodic" does
not mean "periodic within ten moves", and the run-up before the cycle closes can be
longer than an episode.

---

## The reward functions

`rewards.js`. Ten of them, and the grid search decides.

### Why sticker count fails

Turn U once. All nine U-face stickers are white and stay on the U face, so they are
all still correct; what moves is the top row of F, R, B and L — twelve stickers, all
now wrong. Score 42/54. Turn U again: those same twelve move to different wrong
faces. Score 42/54. Turn U a third time (= U' from solved): 42/54.

The true distances are 1, 2 and 1. Sticker count is **dense and flat** — dense
enough to make a fitness curve that looks like progress, flat enough that the curve
is measuring nothing about the one decision the brain has to make. `stickers`,
`bestStickers`, `progress` and `faces` are all in the grid so this appears as a
result rather than as a paragraph.

### What carries signal

The true distance to solved, from a breadth-first table built outward from the
solved cube (depth 7 ≈ 200k states, a second to build). This is **scaffolding for
the reward and the metrics, and it ships nowhere**: the network's input is pixels
and only pixels, exactly as the placement oracle in the Tetris project labels
training data and never appears at play time. The reward may read privileged state;
the policy may not.

Because every move changes the distance by exactly ±1, "how many times did it set a
new personal best" and "how much closer did it get" are the same number, and neither
can be farmed by oscillating.

### One variant is deliberately exploitable

`optimalFrac` scores the fraction of moves that reduced the distance. It looks like
the ideal dense per-decision signal, and it is farmable: U then U' is one reducing
move in two, so a brain that oscillates forever banks 0.5 without going anywhere.
It is kept because it is the variant a person reaches for first, and because a
reward economy's holes should be demonstrated rather than asserted. The test drives
a hand-written oscillating policy through a real environment:

```
optimalFrac IS farmable — an oscillating policy banks 0.470
descent is not      — the same policy banks 0.069
```

### The table

| name | oracle? | what it pays for |
|---|---|---|
| `solved` | no | 1 if solved. The sparse control: one bit per episode against twenty decisions inside it. |
| `stickers` | no | final fraction of the 48 movable facelets that are home. |
| `bestStickers` | no | the best value reached at any point. |
| `progress` | no | improvement over the scramble it was handed, so an easy cube is not worth more. |
| `faces` | no | completed faces, with stickers as a tie-break. |
| `descent` | yes | `(d₀ − dBest)/d₀`. Reaches 1 on a solve; d₀+1 levels per episode. |
| `descentFast` | yes | the same, discounted by *when* the progress happened. Continuous, and prefers the brain that got there first. |
| `hover` | yes | descent plus mean closeness — punishes touching a good state and wandering off. |
| `optimalFrac` | yes | fraction of distance-reducing moves. Farmable on purpose. |
| `mixed` | yes | `descentFast` at 0.8 weight, so the solve bonus dominates more decisively — is the shaping a nudge or half the score? |

All ten share the same five shaping knobs (`solveBonus`, `speedBonus`, `stepCost`,
`undoPenalty`, `gamma`) so the grid sweeps one thing at a time instead of comparing
ten differently hand-tuned constants. The step cost and undo penalty default to
zero and get their own cells (`rw-mixed-cost`, `rw-mixed-undo`) rather than being
folded into one of the ten — otherwise a difference could not be attributed to
anything in particular.

---

## The curriculum

Nobody evolves a solver for a fully scrambled cube from random weights, and
pretending otherwise produces a run where every brain scores zero forever. So
difficulty is a ladder — depth-1 scrambles first — and the frontier advances only
when the champion clears the current rung on scrambles it has never seen.

Two details about the diet matter more than they look.

**The bank is stratified, not sampled.** Each generation's episodes are allocated to
depths by exact count with largest-remainder rounding, never by drawing a random
depth per episode. Random draws add a variance term that has nothing to do with the
brains, and this folder has been burned twice: the walking project chased a "the
fleet forgot how to stand" collapse that turned out to be three independent random
fractions composing into a spawn mix nobody had chosen, and the rocket-catch project
measured bank noise of 1.17 sd against breeding operators worth a tenth of that. If
the diet can be fixed exactly, fix it.

**The ladder never drops the lower rungs.** Depth d is weighted by d, so the
frontier gets the most episodes and depth 1 always gets some. A brain trained only
at the frontier gets a depth-5 cube to distance 1 and then cannot take the last
step.

**A bug found by watching the log.** The promotion probe asked for 96 games at the
frontier depth and got them by filtering a mixed bank — which gives depth d only
d/Σd of the request. That was 64 games at depth 2 and would have been 24 at depth 7:
the test guarding the curriculum losing precision exactly as its decisions get
harder and rarer. `makeDepthBank` now returns exactly the requested count at exactly
one depth, and the test pins it.

---

## Evaluation discipline

Every comparison in the project goes through `evaluate.js`, and it deliberately
**cannot** be the training reward. The grid puts ten rewards side by side; scoring
each run on its own reward would rank the rewards by generosity, and a reward with
an exploitable hole would sail through its own examination with top marks.

So: solve rate and distance removed, **per depth**, on scrambles nothing trained on,
with the scrambles built once and handed to every brain (common random numbers — the
chess project in this folder measured shared episodes as the single biggest accuracy
win available to a GA of this kind). Reported per depth rather than pooled, because a
pooled number is a weighted average over whatever depth mix the bank happened to
have, and two runs whose ratchets reached different frontiers do not have the same
mix.

The top of the scale is pinned too: the test builds an oracle-guided policy and
checks it solves every scramble, so a score of 0.6 has a ceiling as well as a floor.
And the bottom is pinned by running untrained brains on the identical cubes — "it
solves 60% of depth-3 cubes" is only interesting once you know that random weights
solve some of them too.

**Two stages, and the second is not optional.** A grid of 12 cells run once each is
12 draws from a noisy distribution, and the maximum of 12 noisy draws is biased
upward by roughly the noise. Stage 1 is a *shortlist*; stage 2 re-runs the top few
on fresh seeds and reports mean ± SE, and says so plainly when two cells have not
been separated. The Tetris project killed three stage-1 "improvements" in a single
day.

---

## Results

### The reward grid, and what it can and cannot tell you

Twelve rewards, identical everything else, 180 generations each at a screening
budget (population 48, 32 episodes per brain), all scored on the same 600 held-out
scrambles. Untrained brains score **0.059** on this scale.

| cell | score | solve | frontier | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|---|---|---|
| `rw-mixed-cost` | **0.395** | 54% | 3 | 100% | 88% | 48% | 20% | 13% |
| `rw-hover` | 0.316 | 46% | 3 | 100% | 70% | 37% | 12% | 9% |
| `rw-mixed-undo` | 0.289 | 42% | 2 | 100% | 59% | 31% | 13% | 9% |
| `rw-progress` | 0.268 | 40% | 2 | 100% | 57% | 28% | 7% | 8% |
| `rw-descent` | 0.260 | 40% | 2 | 100% | 54% | 28% | 11% | 6% |
| `rw-mixed` | 0.260 | 40% | 2 | 100% | 58% | 24% | 12% | 5% |
| `rw-solved` | 0.254 | 38% | 2 | 100% | 56% | 23% | 9% | 4% |
| `rw-stickers` | 0.235 | 36% | 2 | 100% | 50% | 18% | 7% | 6% |
| `rw-bestStickers` | 0.233 | 34% | 2 | 93% | 38% | 25% | 7% | 7% |
| `rw-descentFast` | 0.226 | 34% | 2 | 88% | 47% | 18% | 11% | 5% |
| `rw-optimalFrac` | 0.176 | 26% | 2 | 75% | 31% | 18% | 5% | 3% |
| `rw-faces` | 0.174 | 29% | 2 | 88% | 39% | 10% | 4% | 3% |

**Two honest observations, in the order that matters.**

*The grid did not separate its leaders.* Re-running the top three on a fresh seed:

| cell | runs | mean ± SE | sd | best |
|---|---|---|---|---|
| `rw-mixed-cost` | 2 | 0.339 ± 0.056 | 0.079 | 0.395 |
| `rw-mixed-undo` | 2 | 0.272 ± 0.017 | 0.024 | 0.289 |
| `rw-hover` | 2 | 0.266 ± 0.049 | 0.070 | 0.316 |

`rw-mixed-cost` leads by 0.067 — 1.2 combined standard errors, which is nothing. Its
own two seeds came in at 0.395 and 0.284. That is the winner's curse, caught in the
act by the stage the grid exists to run: the stage-1 leader is partly lucky, and
anybody reporting that table alone would have announced a result that the next seed
overturns.

Note the second, *different* question that does resolve. The best champion from
`rw-mixed-cost` beats the best from `rw-mixed-undo` by **Δ = 0.114 ± 0.016** paired
on the same 600 cubes — seven standard errors. "This brain is better than that
brain" is decisively answerable; "this config produces better brains than that
config" is not, because run-to-run variance dwarfs the gap. Both statements are
true. Only one of them is about the reward function.

*The spread across the whole grid is small, and that is a fact about the budget.*
Every cell reaches only depth 2 or 3, and at those depths the only distinction that
exists is "did it solve" — which every reward here can see. So the grid is not
really testing the thing the reward functions differ about. Which raises the
question the grid cannot afford to answer, and which needed a different instrument.

### Measuring the rewards directly

`probe_rewards.js` skips training entirely. It takes 30 policies of genuinely
different quality (the champion, six untrained brains, and progressively
mutation-damaged copies — the population a real generation contains), ranks them by
held-out ground truth, and then asks how faithfully each candidate reward reproduces
that ranking. Spearman correlation, per depth, 40 held-out scrambles each:

| reward | d1 | d2 | d3 | d4 | d5 | d6 |
|---|---|---|---|---|---|---|
| `solved` | 0.99 | 0.99 | 0.99 | 0.93 | 0.97 | 0.87 |
| `stickers` | 0.99 | 0.97 | 0.98 | 0.94 | 0.95 | 0.79 |
| `bestStickers` | 0.99 | 1.00 | 0.99 | 0.97 | 0.97 | 0.90 |
| `progress` | 0.99 | 1.00 | 0.99 | 0.97 | 0.97 | 0.90 |
| `faces` | 0.99 | 1.00 | 0.99 | 0.97 | 0.98 | 0.91 |
| `descent`\* | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | **1.00** |
| `descentFast`\* | 0.99 | 1.00 | 1.00 | 0.99 | 0.99 | 0.99 |
| `hover`\* | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | 0.99 |
| `optimalFrac`\* | 0.99 | 0.95 | 0.88 | 0.75 | 0.51 | **0.27** |
| `mixed`\* | 0.99 | 1.00 | 1.00 | 0.99 | 1.00 | 0.99 |

\* uses the distance oracle.

This is the clearest result in the project, and **it corrects the strong claim I
started with.**

- The distance-shaped rewards are essentially perfect instruments at every depth:
  0.99 → 1.00.
- The sticker family *does* degrade with depth, in the predicted direction and for
  the predicted reason — but from 0.99 to 0.88, not to nothing. The blind spot is
  real and costs about a tenth of a rank correlation over five rungs. "Dense and
  flat, so the fitness curve is measuring nothing" was wrong, and the numbers say so
  plainly.
- The reward that actually breaks is the one built to be breakable. `optimalFrac`
  collapses 0.99 → 0.27, **monotonically with depth**, because that gradient *is* the
  exploit becoming available: a depth-1 cube has almost no room to oscillate in and a
  depth-6 cube has plenty. A reward whose hole opens up exactly as the task gets
  harder is the worst possible shape for a curriculum — and it is invisible at the
  depth the training grid can afford to reach. It shows up in the grid too, second
  from last, but only the probe explains why.

One caveat the probe prints itself: at depth 6 every policy in the set is bad (truth
spread 0.007–0.094), so a correlation there is measured over a narrow range. That is
why the trend across depths matters more than any single column.

### The architecture grid, and the ablation that wins

Same 180-generation screening budget, same held-out cubes. Nine cells completed;
two of my own specs could not be built at all, which is covered below.

| cell | score | params | frontier | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|---|---|---|
| `ar-facelets` — **no pixels at all** | **0.449** | 17,792 | 3 | 100% | 86% | 61% | 30% | 16% |
| `ar-convTiny` — one conv stage | 0.341 | 6,656 | 3 | 100% | 57% | 42% | 18% | 13% |
| `ar-convWide` — one wide stage | 0.308 | 18,264 | 2 | 100% | 67% | 32% | 16% | 8% |
| `ar-convBig5` — 5×5 filters | 0.264 | 9,070 | 2 | 100% | 48% | 25% | 13% | 7% |
| `ar-convMid` — two stages *(the default)* | 0.260 | 5,008 | 2 | 100% | 58% | 24% | 12% | 5% |
| `ar-relu` — convMid with ReLU | 0.260 | 5,008 | 2 | 73% | 50% | 28% | 13% | 8% |
| `ar-mlp16` — dense on pixels | 0.220 | 99,144 | 2 | 88% | 45% | 19% | 8% | 5% |
| `ar-mlp12` — dense, lower res | 0.186 | 56,136 | 2 | 88% | 32% | 14% | 7% | 4% |
| `ar-res24` — 48×24 image | 0.133 | 16,272 | 2 | 72% | 16% | 9% | 1% | 5% |

Stage 2, on fresh seeds:

| cell | runs | mean ± SE | sd | best |
|---|---|---|---|---|
| `ar-facelets` | 2 | **0.451 ± 0.002** | 0.003 | 0.453 |
| `ar-convTiny` | 2 | 0.312 ± 0.029 | 0.041 | 0.341 |
| `ar-convWide` | 2 | 0.283 ± 0.024 | 0.035 | 0.308 |

**Separated, at 4.8 combined standard errors.** Unlike the reward grid, this one has
a real verdict — and the verdict is the ablation control.

**Pixels cost about a third of the achievable score.** `ar-facelets` is the control
built to answer "is the visual encoding the bottleneck, or is the puzzle just hard?"
Handed the 54 facelets as a one-hot vector, the same GA reaches 0.451 where the best
pixel architecture reaches 0.312 — and does it in 125 seconds against 377, because
there is no render and no convolution in the loop. Note also how *stable* it is: two
seeds landing on 0.449 and 0.453, against 0.341 and 0.283 for convTiny. An easier
learning problem has less run-to-run variance, which is its own signature.

That is the honest price of the premise. Reading the cube from pixels is the point of
this project, not a means to an end, and it works — 6× untrained, 100/78/55% on the
first three rungs. But it is measurably harder than being told the state, and without
this control a plateau could have been blamed on the reward, the GA, or the
curriculum indefinitely.

**Three secondary results, all of which went against my priors:**

- *Convolution beats dense on pixels, decisively.* Best conv 0.312 against best MLP
  0.220 — while the MLP carries **99,144 weights to the conv's 6,656**. Fifteen times
  the parameters for two thirds of the score. This is the one prediction in the
  project that held up cleanly.
- *One conv stage beats two.* The shipped default, `convMid`, came **fifth of nine**
  and is the weakest conv shape measured. Depth did not pay here, which is the same
  answer the Tetris project got to the same question.
- *More pixels are worse.* `ar-res24` doubles the image to 48×24 and finishes **last
  of nine**, at 0.133 — barely twice the untrained control. A bigger image means a
  bigger feature map, 16k parameters instead of 6.6k, and a search space the GA does
  not have the episodes to cover. The resolution study in the vision section says 24
  is the most *legible*; this says legibility was never the binding constraint.

**Two cells could not be built, and that is a finding about me.** `ar-convDeep`
pooled a 5×13 feature map down to 2×6 and then asked for a 3×3 kernel; `ar-res12`
did the same thing at a lower resolution. Both threw, both were correctly reported as
`FAILED` rather than silently doing something else — but only after burning a grid
cell each. A conv spec is a chain of shape constraints and writing an impossible one
is a typo, so `test_headless.js` now instantiates all 38 named configs and checks each
produces one output per action. Both specs are fixed; the resolution sweep now holds
the one-stage architecture fixed, because the two-stage one genuinely cannot exist at
res 12.

### The mutation operator wastes most of its children

`probe_resolution.js` was written to decide whether a stall is *search-limited* or
*signal-limited*, and its first run reported neither, because it was wrong. It
applied `cfg.ga.mutSigma` — 0.22 — while the live trainer multiplies that by the
annealing scale (~0.12) and then by each genome's self-adapted multiplier (~0.19), a
step forty times smaller. It confidently characterised an algorithm nobody was
running. It now sweeps σ and prints the effective value.

What it found once fixed, on the depth-3 champion over 300 common scrambles:

| | children better | best Δ | median Δ |
|---|---|---|---|
| reset 0.03, rate 0.10, σ 0.005 | 0/40 | −0.088 | **−0.492** |
| reset 0.00, rate 0.10, σ 0.005 | 1/40 | +0.001 | **−0.052** |
| reset 0.03, rate 0.02, σ 0.02 | 3/40 | +0.038 | −0.266 |
| reset 0.00, rate 0.02, σ 0.005 | 3/40 | +0.001 | 0.000 |

`mutate` redraws a weight from N(0, 0.5) with probability `MUT_RESET` = 3%. At rate
0.10 over 5,008 weights that is about fifteen weights per child replaced by large
random numbers — and this network's decision is an `argmax` over eight outputs
sitting inside a narrow band, so fifteen wild weights do not nudge the policy, they
replace it. **The reset branch accounts for about 90% of the median child's loss.**

The belief in this codebase, written down after a distilled Tetris brain lost 60% of
its skill to exactly this, was that the reset branch is nonetheless safe for
*evolved* populations, since every survivor was selected under it. This measurement
says that holds early and stops holding once a champion is precise.

**What is not established:** whether turning the reset rate down actually produces a
better run. The mechanism is measured; the end-to-end effect is not. `--mut-reset`
is a knob, the default is unchanged, and an A/B is the obvious next experiment. I
briefly believed the change had earned a curriculum promotion, and it had not — the
promotion to depth 3 happened at generation 620 of the original run, before anything
changed. `ratchetHistory` is now carried across resumes so that particular mistake
is harder to make.

### Racing, which was the resolution probe's actual prescription

Being signal-limited says "measure more carefully", and the naive reading is "give
every brain more episodes". That is wasteful, because the accuracy is only *needed*
where the decisions are: which challenger fights the champion, and what the champion
re-scores at. The other two dozen brains only have to be sorted into "breeds" and
"does not".

With `--screen N` each generation runs two passes — everyone on a small bank, then
the top `--finalists` (plus the re-injected champion, a finalist by right) on the
full one:

| | episode-evaluations / generation | resolution on the decision that matters |
|---|---|---|
| 32 brains × 160 episodes | 10,240 (at 320) | ±0.057 (at 160) |
| 32 × 40, then 9 × 320 | **4,160** | **±0.040** |

Cheaper *and* sharper. Non-finalists keep their screen fitness for breeding order but
are pinned below the worst finalist, so a lucky 40-episode score can never be
mistaken for a challenger. Lifted from the Tetris project, where the same change was
what made a round work.

### The stratified bank buys about 10%

The resolution probe also quantifies the stratification decision. Per-episode
fitness sd is 0.809 overall but 0.277 within depth 1 and 0.869 within depth 2, and
because every bank has identical depth counts, the between-depth part never reaches
the bank mean. An unstratified 48-episode bank would resolve ±0.117; the stratified
one resolves ±0.105. Re-scoring one unchanged brain on twelve independent banks gave
sd 0.084 against the predicted 0.105 — the prediction is conservative, and the
free 10% is real but modest. Worth keeping, not worth the paragraph it would have
got if it had never been measured.

### The champion

> Superseded in round three. The brain described here — generation 3,321 of the
> original config — is kept because most of this document argues about it, and
> because the round-three champion beats it after **700** generations. The current
> numbers are in *The round-three champion* below.

Generation 3,321 of the shipped default config: `mixed` reward, `convMid`, **5,008
weights**, reading nothing but a 32×16 image. Validated on 250 scrambles per depth
that it never trained on, against eight untrained brains played on those same cubes:

| scramble depth | evolved | untrained | distance removed |
|---|---|---|---|
| 1 | **100.0%** | 24.3% | 1.000 |
| 2 | **88.4%** | 4.2% | 0.884 |
| 3 | **57.2%** | 1.6% | 0.636 |
| 4 | 29.2% | 0.5% | 0.362 |
| 5 | 17.2% | 0.3% | 0.253 |
| 6 | 6.8% | 0.0% | 0.151 |
| 7 | 5.6% | 0.5% | 0.126 |

Overall score **0.281 against 0.040** for untrained brains — 7.1×. It solves depth 3
more than half the time, and it undoes its own last move on 2.9% of moves, which is
the number to watch: the failure mode this task hands you for free is a brain
oscillating between two cubes forever, and it has essentially not happened.

**What it cannot do is solve a real cube.** A properly scrambled cube is 15–18
quarter turns deep in this move set, and the curriculum reached depth 3. The tail
past depth 5 is a few percent, which is above the untrained rate but not a solve
rate. Every honest reading of this project should start there.

### Picking what ships, and a trap in doing it

Three champions were in the running: the default config at generation 2,277, an
earlier snapshot of it at 705, and a run on the architecture the grid preferred
(`convTiny`) at 441. `compare_brains.js` puts all three in front of the identical 840
cubes:

| run | config | gen | params | score | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|---|---|---|---|
| main2 | default (`convMid`) | 2277 | 5,008 | **0.288** | 100% | 86% | 65% | 28% | 16% |
| v1 | default (`convMid`) | 705 | 5,008 | 0.227 | 100% | 73% | 49% | 16% | 10% |
| main3 | `ar-convTiny` | 441 | 6,656 | 0.195 | 100% | 74% | 34% | 13% | 6% |

Paired per-episode against the leader: **+0.071 ± 0.010** (7.2 SE) over the earlier
snapshot and **+0.102 ± 0.012** (8.2 SE) over the convTiny run. Decisive, because
pairing on shared cubes removes the bank from the comparison.

This does **not** overturn the architecture grid. The grid says convTiny beats
convMid *at 180 generations with a matched budget*; this table says a convMid run
with five times the generations beats a convTiny run with fewer, under different
population and episode settings. Those are different claims and both are true.
Retraining convTiny to parity is the obvious next run and has not been done.

The trap worth recording: the natural thing to compare is each run's own **held-out
gate score**, which looks exactly like the right number — solve rate and distance
removed, on cubes nothing trained on. But the gate bank is drawn at *each run's own
curriculum frontier*, so a depth-2 run defends an easier bar than a depth-3 one. At
one point this project had 0.809 from a depth-2 run sitting next to 0.767 from a
depth-3 run, two numbers that cannot be ranked at all. `compare_brains.js` prints the
frontier beside every gate score for that reason, and only trusts the shared-bank
number.

### Three of the eight actions were dead

"58% at depth 3" is a number to report, not one to act on, because two very different
champions produce it: one that plays the first move well and loses the thread later (a
horizon problem), and one that gets the first move wrong on 40% of cubes (a perception
or capacity problem). Nothing in the training log distinguishes them.
`probe_failures.js` does, and the answer was neither of the obvious two.

| depth | solved | 1st move right | failures stalling at distance 1 / 2 / 3+ |
|---|---|---|---|
| 2 | 84% | 70% | 6% / 94% / 0% |
| 3 | 59% | 56% | 0% / 33% / 67% |
| 4 | 28% | 41% | 3% / 12% / 85% |
| 5 | 17% | 37% | 0% / 4% / 96% |

At depth 3 the first move was right on **79% of solves and 23% of failures** — a
56-point split, so the episode is largely decided before it starts. Almost no failure
stalls one move short. That rules out a horizon problem.

Then the move mix, pooled over 800 episodes:

```
U 19%   U' 1%   D 15%   D' 0%   L 47%   L' 0%   R 9%   R' 10%
```

**Three of the eight actions are dead.** The policy had collapsed onto mostly
clockwise turns, with `L` alone taking 47% of all moves. The sharp prediction is that
cubes whose *only* distance-reducing first move is a dead action should be nearly
unsolvable, and they are:

| depth | only a dead action works | a live action works |
|---|---|---|
| 2 | **52%** solved (92 cubes) | **97%** solved (208 cubes) |
| 3 | **38%** solved (69 cubes) | **65%** solved (231 cubes) |
| 4 | **8%** solved (87 cubes) | **37%** solved (213 cubes) |

About a third of all cubes need an action the champion will not play. It is not zero
because a dead action is recoverable — `L'` is `L·L·L` — but that costs two extra
moves out of a nine-move budget, which the budget sweep showed there is no slack for.
That also explains the earlier observation that states with only one correct answer
fail 61% of the time against 33% for states with three: with three answers, one of
them is probably live.

This is a diversity collapse, and the machinery to prevent it was already in the
project and switched off. `evolution.js` implements fitness sharing on a *behavioural*
signature whose first eight components are literally the move mix, precisely so that a
brain playing an unusual way keeps its seat — and `share` defaults to 0. Building the
instrument and not turning it on is the mistake, and it was only found by probing the
failures rather than the successes.

#### Turning it on did not work, and the reason is the useful part

Two arms resumed the champion with sharing at λ = 12 and λ = 30, everything else
identical, for ~220 generations. Neither revived a single action:

| arm | U | U' | D | D' | L | L' | R | R' | live | depth-3 |
|---|---|---|---|---|---|---|---|---|---|---|
| seed (gen 2277) | 22% | 1% | 17% | 0% | 40% | 0% | 11% | 9% | 5/8 | 59% |
| A control | 20% | 1% | 20% | 0% | 38% | 0% | 11% | 10% | 5/8 | 59% |
| D share 12 | 18% | 1% | 19% | 0% | 41% | 0% | 11% | 10% | 5/8 | 59% |
| E share 30 | 21% | 0% | 19% | 0% | 39% | 0% | 11% | 10% | 5/8 | 60% |

**Sharing preserves diversity; it cannot create it.** Measured directly: a converged
population (the champion plus its mutated children, which is what a generation
actually contains) has a mean pairwise signature distance of **0.374**, against
**1.012** for a fresh random population — mostly inside the 0.55 sharing radius. When
every pair is equally crowded, dividing by crowding is dividing every brain by the
same number, and the breeding order is unchanged. λ = 30 does nothing that λ = 12
does not, for the same reason.

**And the champion cannot simply be nudged out of it.** Shaking only the output layer
— 264 weights, the cheapest possible intervention — over 40 random perturbations of
increasing size: the best variant reached **7 of 8 live actions**, at a **3% solve
rate** against the champion's 47%. So the dead actions are perfectly expressible by
this body; they are suppressed by weights that also encode the working policy. That
is a genuine local optimum, not a missing capability.

**The collapse is progressive**, which is the last piece:

| | U | U' | D | D' | L | L' | R | R' | live |
|---|---|---|---|---|---|---|---|---|---|
| generation 705 | 12% | **10%** | 16% | 1% | 42% | 0% | 13% | 5% | 6/8 |
| generation 2277 | 22% | **1%** | 17% | 0% | 40% | 0% | 11% | 9% | 5/8 |

`U'` was alive at 10% and starved over the following 1,500 generations. So the
diversity mechanism had to be running *from the start and continuously*, before the
basin closed — which is what `armF` tests (from scratch, `--share 12 --islands 4`,
population 64). Retrofitting it is measurably useless.

The general lesson, which cost most of a day to arrive at: **an intervention that
preserves a property must be enabled before the property is lost**, and a
plausible-sounding fix applied at the wrong time produces a clean null result that
looks like the fix not working.

### A second round that did not work, and what it settled anyway

Six arms, all resumed from the same generation-2,277 champion with the same seed,
differing in exactly one knob each, plus one from scratch. Racing on (screen 40 →
top 8 on 320), ~1,000 generations. Scored on 1,050 shared held-out cubes:

| arm | change | gen | score | d2 | d3 | d4 |
|---|---|---|---|---|---|---|
| A | control | 3209 | 0.289 | 90% | 63% | 29% |
| B | `stepCost 0.01` | 3219 | 0.285 | 89% | 64% | 29% |
| — | the seed itself | 2277 | 0.282 | 87% | 62% | 31% |
| C | `mut-reset 0.03` | 2496 | 0.282 | 87% | 62% | 31% |
| D | `share 12` | 2494 | — | — | 59%\* | — |
| E | `share 30` | 2495 | — | — | 60%\* | — |
| F | from scratch, `share 12 --islands 4` | 257 | 0.122 | 23% | 20% | 5% |

\* D and E were stopped early once the move-mix table showed they had revived nothing.

Paired per-episode against the leader: **+0.004 ± 0.006** over arm B, **+0.008 ±
0.005** over the seed. **Nothing separated.** A thousand generations, a better
measurement scheme and three plausible interventions bought a difference smaller than
two standard errors. Re-baking the leader moved the validated numbers by 0.001.

That is the honest state: **the run has plateaued**, and the dead-action analysis
above says why. A third of cubes need an action the policy will not play, and the
output-layer shake shows escaping costs 44 points of solve rate on the way out.

Three things it did settle:

- **The weight-reset question, end to end.** Arm C's champion is **byte-identical to
  the seed across all 5,008 weights** — at `mut-reset 0.03`, *zero* challengers passed
  the held-out gate in 220 generations. Arm A at 0.005 moved 4,562 weights. The probe
  measured the mechanism; this measures the consequence. It does not show 0.005
  produces a *better* brain (arm A is inside the noise), only that 0.03 produces
  no brain at all at this stage of a run.
- **Racing is worth having** even though it did not break the plateau: 41% of the
  episode-evaluations for better resolution on the decisions that matter.
- **The ratchet was promoting on noise.** Arm A advanced from depth 3 to depth 4 on a
  single 77%-of-96 probe, and the same champion measured **58.2% ± 2.0 on 600 fresh
  cubes** immediately after. The probe fires every 10 generations and promotes on the
  first success — fifty-odd shots at a threshold, with a 5-point standard error. It
  now promotes on `observed − 1.64·SE ≥ threshold` (about 84% observed at 96 games for
  a 75% bar), which is a statement about the brain rather than about one bank. Pinned
  by two tests.

**What to try next, in the order the evidence supports it:** the diversity mechanism
has to run from generation 1 (arm F is that experiment and needs far more time than it
got); failing that, the collapse is an actuator-symmetry problem and the honest fix is
probably structural — the network has no way to know that `U'` is `U` three times, and
nothing in the encoding tells it.

That prediction was wrong, and the next section is what was actually wrong.

## Round three: the plateau was in the observation

Two rounds had been spent on the reward, the architecture and the breeding
operators. The observation was treated as settled from the first week — two image
frames, two remembered moves, a clock — because it had been *reasoned about*
carefully (the impossibility result above) rather than measured. `GRIDS.temporal`
was written in round 1 and never run.

It held the largest single factor in the project.

### Seventeen factors, one at a time, from generation 1

Round 2's clean null established that retrofitting an intervention onto a converged
population measures nothing, so every cell here starts fresh. Each got the same
**wall-clock** rather than the same number of generations — the budget the run is
actually competing for is time, and cells differ by ~50% in what a generation costs.
Ranked on 840 held-out scrambles at depths 1–7, identical for every cell.

| cell | what it changes | score | frontier |
|---|---|---|---|
| **tm-hist4** | **4 remembered moves, not 2** | **0.273** | 3 |
| ar-convBig5 | 5×5 kernels | 0.206 | 2 |
| cu-d7unif | no ratchet cap, uniform depth 1–7 | 0.205 | 7 |
| cov-d7 | coverage term + deep diet | 0.202 | 7 |
| tm-rich | 3 frames *and* 4 moves | 0.191 | 3 |
| tm-frames3 | 3 image frames | 0.190 | 2 |
| ar-convTiny / ar-convWide | one conv stage | 0.169 | 2 |
| cov-08 / cov-03 | action-coverage term | 0.154 / 0.145 | 2 |
| **default** | — | **0.143** | 2 |
| cu-d5ramp | frontier 5 | 0.122 | 5 |
| ga-share | fitness sharing from gen 1 | 0.118 | 2 |
| ep-lean | pop 32 × 128 episodes | 0.095 | 1 |

Two remembered moves to four is **+0.130**, twice the next-largest effect, and it
costs sixteen input numbers. In twenty-two minutes it produced a depth profile
(100 / 86 / 48 / 32 / 18 / 7 / 4) close to what the shipped champion took 3,321
generations to reach.

Note also that `tm-rich` — three image frames *and* four moves — scored **below**
`tm-hist4` alone. Which pointed at the cell that actually won.

### One frame, four moves

| cell | score | frontier |
|---|---|---|
| **frames 1 + moveHist 4 + deep diet** | **0.341** | 7 |
| frames 2 + moveHist 4 (ratchet) | 0.267 | 3 |
| frames 2 + moveHist 4 + deep diet | 0.245 | 7 |
| frames 2 + moveHist 4 + deep diet + coverage | 0.244 | 7 |

Dropping the second image frame — **half the picture the round-1 design considered
essential** — was worth more than anything else tried in three rounds. The
observation went from 3,089 inputs to 1,569.

That cell changed two things at once, so wave 3 re-ran it on a fresh seed and split
it:

| cell | score | frontier |
|---|---|---|
| 1 frame, 4 moves, deep diet | **0.325** | 7 |
| 1 frame, **6** moves, deep diet | 0.305 | 7 |
| 1 frame, 4 moves, **ratchet** | 0.288 | 3 |

The leader replicates (0.341 → 0.325 on a new seed, no winner's-curse collapse).
Both factors are real: at one frame the deep diet is worth **+0.037**, and the frame
itself is the larger part. And six remembered moves is *worse* than four — this is a
sweet spot, not a monotone knob, which is the sort of thing only a sweep tells you.

### What this says about the two previous rounds

**The brain was memory-limited, not perception-limited, and the two are
indistinguishable from a score.** A policy that cycles and a policy that is merely
bad both simply fail to solve. Round 2 read the resulting plateau as an
actuator-symmetry problem — five of eight actions dead — and prescribed a structural
fix. The dead actions were real and the diagnosis of them was correct; the causal
story was backwards. Five live actions is what a policy looks like when it cannot
represent the task, not the reason it can't.

The **action-coverage term** in `Env.scoreBrain` was built for that diagnosis: a
per-brain measure over the whole bank, crediting an action pro rata until it reaches
a quarter of a uniform share and saturating there so that cycling through all eight
turns earns the bonus exactly once and forfeits far more descent than it gains. It is
a clean null — 0.245 against 0.244 on top of the winner, and +0.011/+0.002 against its
own matched controls. It stays in the code, off by default, with the measurement
written next to it. Giving the missing actions a price does not give the policy the
memory it needed to use them.

It also puts a round-1 headline in doubt. `ar-facelets` beat the best pixel
architecture 0.451 to 0.312, and that was read as *pixels cost a third of the score*.
The facelet control had the same two-move history. Some of that gap was very
probably memory rather than pixels, and the experiment that separates them has not
been run.

### Things that were not the answer

- **Fitness sharing from generation 1** — the round-2 "what to try next", and the
  reason arm F was left running. It finished **second from last** at 0.118 against
  0.143. Round 2's conclusion that sharing preserves diversity rather than creating
  it was right; the implied prescription was not.
- **Buying accuracy per brain.** `pop 32 × 128 episodes` came last at 0.095, still
  at frontier depth 1. On equal wall-clock this task wants generations, not precision
  per candidate — the opposite of what the rocket-catch and Tetris projects measured,
  and worth knowing that it does not transfer.
- **More of the winning thing.** Six moves lost to four; three frames lost to two,
  which lost to one.

### Two process failures worth writing down

**The wall-clock flag lost silently to a default.** `grid_search.js` passes
`--gens 120` unless told otherwise, so the first attempt at wave 1 stopped every cell
at 120 generations while `--until` sat there unreached. That is not merely a short
run — it is *equal generations*, which hands the expensive deep-curriculum cells about
50% more wall-clock than the cheap ones, i.e. exactly the bias `--minutes` was written
to remove. Nothing in the log looked wrong. Whichever limit is given now binds.

**A grid cannot pick an architecture in a regime it will not ship in.** Wave 1's
whole architecture column was measured against a control stuck at frontier depth 2,
and wave 1's *own* curriculum result is what invalidated it. Everything promising had
to be re-asked at one frame before it meant anything.

A third, smaller one: re-listing a winning config under a new name at the same seed
reproduces the same champion exactly, because a run is deterministic in its seed. That
looks like a confirmation and is not one — hence `--seed-base`.

### The round-three champion

`frames 1, moveHist 4, uniform depth 1–7`, `convMid`, **5,304 weights**, reading a
16×32 image and 33 extra numbers. Generation **700**. Validated on 400 scrambles per
depth from a bank seed that took no part in selecting it, against eight untrained
brains on those same cubes:

| scramble depth | evolved | previous champion | untrained |
|---|---|---|---|
| 1 | **100.0%** | 100.0% | 30.5% |
| 2 | **91.8%** | 89.3% | 7.8% |
| 3 | **65.5%** | 57.5% | 3.0% |
| 4 | **39.5%** | 27.5% | 1.2% |
| 5 | **19.5%** | 16.8% | 0.7% |
| 6 | **11.5%** | 7.8% | 0.2% |
| 7 | **8.0%** | 7.8% | 0.3% |

Overall **0.325 against 0.286** for the brain it replaces and 0.047 for untrained —
better at every depth, from a run that is **4.7× shorter**. Depth 4 is the largest
gain, up by almost half.

The frontier claim does not change: it solves depth 3 more than half the time, and a
real scramble is 15–18 turns deep.

### Three hours of further training made it worse

Two runs resumed from this champion and continued for three hours — one plain, one
with racing, both at the winning config. Scored afterwards on the bank used to pick
between them:

| brain | generation | score |
|---|---|---|
| **the seed champion** | **700** | **0.328** |
| continuation, plain | 1,995 | 0.308 |
| continuation, racing | 3,063 | 0.279 |
| wave-3 replicate | 515 | 0.295 |

The plain continuation is **2.0 SE worse** than the brain it started from, on 1,750
paired scrambles. Racing bought 1.8× the generations and was worse still.

The mechanism is the one the Tetris project named — *the last champion is not the
best*. Elitism is monotone only against a **fixed** bank, and the held-out gate here
deliberately rotates so that it cannot become the training set. A challenger that
wins on one rotation takes the title permanently, and nothing ever re-checks the
deposed brain. Over thousands of generations near a plateau, where the gate's noise
exceeds the real differences, that is a slow random walk downhill wearing the
costume of progress. The in-run logs looked entirely healthy throughout: `best`
fitness climbing, gate rejecting ~85% of challengers.

What saved the result was keeping every candidate and scoring them all on one bank
at the end, rather than trusting `champion.json` from the longest run. **Whichever
brain a long run ends on is a hypothesis, not a champion.** The fix — retain the
top-k brains ever seen and duel them on a large shared bank before crowning — is not
implemented; it is the first thing to do next.

## Round four: capacity, and the box the oracle drew

Round three ended by saying the observation had been the bottleneck all along. That
was true and it was not the whole story, because the *other* thing never varied in
this project was the network itself. The hidden layer had been 32 units since the
first week — chosen when the task was "undo the last turn" and never revisited after
the task became "descend a radius-7 ball from pixels".

Eighteen cells on 128 cores, one factor each against a control carrying round three's
observation, equal wall-clock:

| cell | what it changes | score | d3 | d4 | d5 | d6 | d7 |
|---|---|---|---|---|---|---|---|
| **r4-relu64** | **64 hidden units, ReLU** | **0.371** | 74 | 49 | 27 | 15 | 8 |
| r4-h96 | 96 hidden units | 0.351 | 75 | 51 | 21 | 11 | 9 |
| r4-h6cap | 6 remembered moves at 64 units | 0.341 | 71 | 42 | 21 | 9 | 9 |
| r4-ep96 | 96 episodes a brain | 0.337 | 69 | 41 | 21 | 13 | 8 |
| r4-isl4 | 4 islands, pop 128 | 0.332 | 71 | 41 | 21 | 11 | 7 |
| r4-h64 | 64 hidden units, tanh | 0.324 | 64 | 39 | 20 | 13 | 7 |
| **r4-base** | control | **0.304** | 64 | 35 | 19 | 10 | 7 |
| r4-big5w | 5×5 kernels, 25k params | 0.286 | 57 | 33 | 14 | 11 | 7 |
| r4-res20 | resolution 20 | 0.267 | 56 | 28 | 13 | 8 | 6 |
| r4-stride2x | stride instead of pooling, 26k params | 0.257 | 51 | 25 | 12 | 7 | 6 |
| r4-res24 | resolution 24 | 0.255 | 55 | 26 | 12 | 5 | 6 |

**Capacity binds, but only over a narrow range.** 32 → 64 units is worth +0.020 with
tanh and **+0.067 with ReLU**; 96 units is already past the peak. The two largest
networks in the grid (25k and 26k weights) finished tenth and seventeenth. The shape
is the usual one for a GA — the search cost of a parameter is paid immediately and its
benefit only if selection can find a use for it — and it is why "make it bigger" is a
hypothesis rather than a plan.

The activation is the surprise: **ReLU at 64 units beat tanh at 64 units by 0.047**,
more than the capacity increase itself bought. The walking project in this folder
argued for tanh under a GA on solid grounds — bounded mutation, no permanently dead
units — and that argument was inherited here without being tested. It does not survive
contact with this task.

Two results that repeat round three's lesson rather than adding to it: **both higher
resolutions finished near the bottom**, and the population/episode/GA-structure axis
produced nothing again (islands, pop 128 and racing all inside the noise of the
control, racing below it).

## The funnel: why deep scrambles were never actually tried

The obvious question about all of the above is why the curriculum tops out at seven
turns when a real scramble is fifteen to eighteen. The answer turned out to be
mechanical rather than principled, and it had been invisible for three rounds.

`distanceOf` returns `radius + 1` for any state not in the oracle's table:

```js
return d === undefined ? oracle.radius + 1 : d;
```

So **every oracle-shaped reward in this project is a constant beyond depth 7.** A
depth-15 cube and a depth-9 cube score identically, and no move between them earns
anything at all. Worse, `depthCap` clamps the curriculum to the oracle radius
regardless of what `maxDepth` is set to, so asking for depth 15 quietly gave you depth
7 with no warning in the log. Training on genuinely scrambled cubes was not rejected on
evidence — it was unreachable by construction, and nothing in the code said so.

The metrics that *do* work out there are blind exactly where the distance reward is
sharpest. `stickerScore` gives U, U2 and U' all 42 of 54; the new `pairScore` — matched
adjacent facelet pairs, 72 on a solved cube — is blind in precisely the same way, and
the test suite asserts that it is, so that nobody later "simplifies" the funnel by
deleting its oracle half. A reward built only from surface tidiness can polish a cube
forever without finishing one.

So `funnel` is two rewards with a verifiable boundary between them:

| where the episode got to | pays |
|---|---|
| never entered the radius-7 ball | 0 … 0.45, from structure only |
| entered it | 0.60 … 1.00, from exact distance |

The ranges cannot overlap. **A perfectly tidy cube that never enters the ball (0.450)
scores below the barest entry into it (0.600)**, which is asserted in the suite, and
that ordering is the whole design: it makes "get within seven moves of solved" the
thing selection pushes on, and denies the population the local optimum that a pure
structure reward would otherwise sit in forever.

Two supporting fixes were needed. The move budget is computed from `budgetBasis`, which
falls back to the scramble depth once the true distance saturates — otherwise a
12-turn cube inherits the 13-move budget of an 8-turn one and the curriculum is
unsolvable for reasons that have nothing to do with the brain. (The same saturated-sensor
trap the planetary project hit.) And the depth ceiling is **12, not 18**: at 12 a ramp
mix still spends about a third of the bank inside the ball, which is what keeps the
endgame trained, whereas at 18 nearly every cube is outside it and the funnel's ordering
has nothing left to order.

**The honest limit on this reward:** `probe_rewards.js` scores a reward by rank
correlation against ground truth, and beyond depth 7 there is no ground truth to
correlate against. The structure half is therefore argued for and unit-tested, but not
*measured* the way every other reward in this project has been.

### The round-four champion

`frames 1, moveHist 4`, uniform depth 1–7, **64 hidden units with ReLU and a linear
output**, 96 episodes a brain. **9,208 weights**, generation 4,351. Validated on 300
scrambles per depth from a bank seed that took no part in selecting it:

| scramble depth | evolved | previous champion | untrained |
|---|---|---|---|
| 1 | **100.0%** | 100.0% | 17.2% |
| 2 | **100.0%** | 92.0% | 4.8% |
| 3 | **82.3%** | 63.7% | 1.3% |
| 4 | **52.7%** | 40.0% | 0.8% |
| 5 | **34.3%** | 20.3% | 0.4% |
| 6 | **19.3%** | 11.7% | 0.0% |
| 7 | **13.3%** | 8.0% | 0.2% |

Overall **0.418 against 0.326** for the brain it replaces and 0.037 untrained — 11.4×.
The first champion in this project to solve **depth 4** more than half the time, and it
undoes its own last move on **0.0%** of moves.

It was picked by `duel.js` out of 357 snapshots from ten concurrent runs, in two stages.
That mattered: the stage-1 leader at 40 games per depth scored 0.465 and fell to 0.424
at 250 games per depth, finishing second. And the longest run of the night reached
generation 13,200 with a final brain **0.080 below its own earlier snapshot** — the
rotating-gate drift, reproduced twice more, and this time caught rather than shipped.

## Round five: the search was the problem all along

Round four raised every rung and left depth 7 at 13%. Rounds one to four had between
them tried ten reward functions, eleven activations, nine architectures, two
projections, populations from 32 to 256, recurrence, fitness sharing, racing, four
curricula and three fitness definitions. Every one of them converged to the same place:
**40-45% per-move accuracy**.

When everything you try lands on the same number, the number is the answer to a
different question than the one you were asking.

### The arithmetic that reframed the target

Every move changes the true distance by exactly +/-1 (bipartite Cayley graph, verified
in the suite over ~10,000 neighbour pairs). So self-play is a walk that steps toward
the solved cube with probability p, and a depth-d cube inside its move budget is a
first-passage problem with a closed form. Solving it says:

| per-move accuracy | d5 | d6 | d7 |
|---|---|---|---|
| 0.75 | 74% | 68% | 61% |
| 0.80 | 86% | 81% | 77% |
| **0.85** | 94% | 92% | **89%** |
| 0.90 | 98% | 98% | 97% |

**90% at depth 7 needs 85% per-move accuracy, not 98%.** The earlier assumption — that
seven correct moves in a row were required — ignored that the budget allows mistakes and
recovery. The shipped champion ran at **53.5%**, and only 38-46% at distances four to
six, which is *below the break-even where progress is even expected*. It reached solved
cubes by luck rather than by policy.

That also explains three interventions that did nothing: a larger move budget (16.0% to
16.5% at depth 7), temperature sampling at every scale, and epsilon-greedy (strictly
worse). None of them help a policy whose drift is negative.

### The ceiling probe

Two explanations remained: the mapping is not learnable by a network of this size
(representation), or it is learnable and evolution cannot find it (search). Those call
for opposite responses, and no further evolution distinguishes them.

`probe_ceiling.js` settles it in about a minute. Take the easiest form of the problem —
54 facelets one-hot, no pixels, no memory — and fit it with plain gradient descent:

| distance | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| gradient descent | 100% | 100% | 100% | 99.9% | 97.0% | 92.2% | 79.6% |
| evolved champion | 71% | 83% | 61% | 46% | 41% | 38% | 49% |

**96.7% against 53.5%**, after six epochs on 24,000 states. The mapping was never the
obstacle. Five rounds of architecture and reward search were fighting a search
limitation, and the honest summary of rounds one to four is that they were exploring
the wrong axis carefully.

### Distillation, and what it is not

`distil.js` fits the same policy by gradient descent **on the rendered picture** — same
sparse-matrix renderer, same move history, same eight actions, only the optimiser
changed. Handing it the facelets instead would produce better numbers and destroy the
point of the project.

It is not this project's method, it is labelled `distilled: true` in the file, and it is
kept separate from the evolved champion rather than substituted for it.

Three things mattered, in descending order:

**Adam, not SGD.** The facelet probe trained fine on one-hot inputs at learning rate
0.05. The same rate on 1,296 centred pixel values collapsed all six runs to 17.4%,
which is exactly the accuracy of always naming the most common optimal move. Per-
parameter step sizes removed the question entirely.

**DAgger.** The first pass fitted its training set to 83% and played its own games at
56%. Training states came from *optimal* paths, so the model had never been asked what
to do after its own first mistake — which is where a rollout spends most of its moves.
Rolling out with the model driving, labelling every visited state with the oracle and
refitting took self-play accuracy from 56% to **93%**.

**Distance 8.** The per-distance breakdown of the best model was the most useful
measurement of the night:

| distance | 1-4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|
| accuracy | 100% | 92.6% | 72.9% | 54.5% | **20.3%** |

Perfect close in, collapsing far out — and near-blind at distance 8, which is precisely
where every mistake at distance 7 lands it. The training pool was capped at distance 7,
so the model had never seen the states its own errors create. Labels are still valid
out there: a radius-7 oracle reports 8 for anything beyond it, so a move that reaches a
genuine distance-7 state is still correctly identified as the reducing one.

This also explains why extra budget and randomisation both did nothing. Neither helps in
a region where the policy has nothing to offer.

### The distilled brain, and the two artifacts this repo now ships

`default_brain.js` — 403,976 weights, gradient-trained, reading the **same two-panel
isometric render at the same resolution** as the evolved champion. Both are validated by
`bake_brain.js` on 200 scrambles per depth they never trained on, 1,400 in all:

| scramble depth | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| **`default_brain.js`** — gradient-trained | **100%** | **100%** | **100%** | **100%** | **98.0%** | **84.5%** | **73.5%** |
| `training/evolved_brain.js` — the GA champion | 100% | 100% | 80.5% | 55.0% | 32.0% | 20.5% | 14.5% |
| untrained | 21.3% | 4.2% | 1.5% | 0.6% | 0.5% | 0.1% | 0.4% |

Overall **0.898 against 0.038** untrained — 24×. It is the first brain here to clear
every rung from 1 to 7 more than half the time, and it is now the page's default.

**One brain ships.** The page briefly carried both with a switch, and the switch was
the wrong answer to the question it was asking: a visitor does not arrive wanting to
audit an optimiser, and a page that opens on a choice between a brain that works and a
brain that does not is a page about the author's ambivalence. The evolved champion is
kept at `training/evolved_brain.js` — baked, validated, loadable — and the comparison
lives here, where the numbers are, instead.

The distilled brain carries `distilled: true` in the file rather than in a filename
anybody could rename, and `bake_brain.js` refuses to let a gradient-trained brain
inherit the "no gradients, no backpropagation" sentence the evolved ones carry. The
page's own copy no longer claims it either.

To rebuild either one:

```bash
node bake_brain.js training/dis_C2.json                        # -> default_brain.js
node bake_brain.js training/best_round4_relu64ep96.json \
     --out training/evolved_brain.js --global EVOLVED_BRAIN    # -> the control
```

One cost worth naming: `default_brain.js` is 4.6 MB (1.7 MB gzipped) against the evolved
brain's 100 KB, because 403,976 weights is what it takes. Rounding the decimals harder
buys little — precision 4 only reaches 3.4 MB — so the real fix is a narrower head, and
128 hidden units already reached 86.8% self-play accuracy during distillation.

### The second view is the network, not the far side of the cube

The box beside the cube used to show the cube from the opposite corner. That was a
duplicate: the observation is already two panels from opposite corners, so the far side
was inside the inset labelled *what the brain sees* the whole time — while the network,
the actual subject of the page, appeared only as eight bars.

It now draws the network from its own activations. The input block is the observation's
1,569 numbers laid out in the render's own row length, so the three colour channels
stack up as three recognisable pairs of panels; the middle block is all 256 hidden units
live; the wires are the largest weight × activation terms feeding the output that won,
red where a unit argued against the move about to be played. `Net.activations()` and
`ConvNet.activations()` exist for this and nothing else reads them.

Two things keep it honest. The forward pass is re-run by the panel rather than trusted
to be fresh, so the picture describes the cube on screen even after a benchmark has
driven the same network over a thousand other cubes — except for a recurrent net, which
is never re-run, because drawing a picture must not change the episode it is a picture
of. And the selftest swaps in an untrained network and asserts the drawn outputs change:
a diagram that survives having its subject replaced is decoration, and decoration is
exactly what a viewer cannot tell apart from evidence.

### What the two numbers together actually say

The evolved brain and the distilled one share the observation exactly — the same
1,569-number render from the same two-panel isometric view, the same four remembered
moves and clock — and the same eight actions, the same argmax policy, the same episode
loop and budget, and the same relu/linear activations.

**Two things differ, not one, and the second is easy to overlook:**

| | evolved | distilled |
|---|---|---|
| optimiser | mutation + selection | Adam + DAgger |
| architecture | conv, **9,208** weights | dense MLP, **403,976** weights |

So the gap between 13.3% and 72.8% at depth 7 **cannot be attributed to the optimiser
alone**, and an earlier draft of this section said it could. The architecture changed
for a mundane reason: `distil.js` has a backward pass only for a plain MLP, because
that is what `nn.js`'s `Net` is and it exports straight into the champion format.

The evidence still points hard at the optimiser as the dominant term, though, and it is
worth laying out because it is indirect:

- Under the GA, **more capacity consistently made things worse**. The two largest
  networks in the round-4 grid (25k and 26k weights) finished 10th and 17th of 18; in
  round 6 a 125k-weight facelet MLP scored 0.203 against 0.264 for a 23k one.
- Under the GA, dense lost to convolutional (round 1: 0.220 against 0.312).

A 404k-weight dense net evolved by the GA would therefore be expected to land *below*
the 9k conv one, not above it. The capacity is only usable because gradients can exploit
it — which is a statement about the optimiser, but an inferred one.

**The experiment that would settle it** is to distil into the identical conv
architecture and compare at matched parameter count. That needs a convolutional
backward pass, which is not written. Until it is, the honest claim is "gradients plus
the capacity they make usable", not "gradients alone".

It is worth being precise about what that does and does not mean. The GA was not badly
implemented — it has common random numbers, a held-out rotating gate, lower-confidence-
bound curriculum promotion, racing, snapshot duelling and stratified banks, and each of
those was added because a measurement demanded it. It is that the task turned out to be
a 1-of-8 classification with a perfect teacher available at every state, which is the
worst possible matchup for a black-box search and the best possible one for gradients.

The honest limit remains unchanged and is worth repeating: **depth 7 is not a solved
cube.** A real scramble is 15–18 turns deep, the oracle's table only reaches radius 7,
and every reward here is flat beyond it. Nothing in this round moved that boundary.

### Limits, and what was not established

- **The frontier is depth 3.** Not a solved cube, and not close. A real scramble is
  15–18 turns deep and this brain solves 8% of seven-turn ones. Round three raised
  every rung without moving the deepest one it clears half the time. (The round-three
  champion's file records depth 7, which means only that it *trained* on cubes that
  deep — its diet has no ratchet in it. Frontier depth is a training setting there,
  not a claim.)
- **Whether lowering the weight-reset rate produces a better brain** is still
  unmeasured. It is now established that 0.03 blocks promotion entirely and 0.005 does
  not, but arm A's advantage over the seed is inside the noise. I also briefly believed
  the change had earned a curriculum promotion and it had not — that one happened
  before the change.
- **Arm F — diversity from generation 1 — did not get enough time.** It reached
  generation 257 and depth 2 against the incumbent's 3,321. It is the experiment the
  dead-action analysis actually calls for and it remains open.
- **The reward grid separated nothing.** Twelve cells, all within a band that one
  fresh seed can cross. `probe_rewards.js` answers the underlying question instead,
  and the two together are the result — not either alone.
- **The temporal grid was not run.** `node grid_search.js temporal` is wired up and
  the configs exist; the key claim it would test (a memoryless observation makes the
  task provably impossible) is instead proved as a theorem and demonstrated in
  `test_headless.js`, which is stronger than a grid cell would have been.
- **`convDeep` and `ar-res12` never ran** as grid cells; both specs were impossible
  and are now fixed, but their cells are unmeasured.
- **Everything here is at a screening budget.** Grid cells are population 48 with 32
  episodes per brain for 180 generations. The shipped champion had population 32,
  160 episodes and 2,277 generations. Cross-reading those two scales is the mistake
  the paragraphs above are trying not to make.

---

## Watching it

`index.html` is a player, not a trainer — a generation is 30,000 episodes and a
browser tab is the wrong place for that. What the page does is the part worth
watching: hand the champion a cube it has never seen and step it one look and one
turn at a time.

- **Play / Step / New cube**, and a speed slider from 0.1 to 8 moves per second
  (default 1.5, which is followable).
- **Scramble depth** 1–12, including well past what the champion was trained on.
- The **true distance to solved** after every move, charted. It can only ever step by
  one — that is the bipartite-graph property above, visible.
- **What the brain sees**: the actual observation `Float32Array`, blown up with
  nearest-neighbour so single input pixels are visible.
- The **eight outputs** as bars, rescaled to the spread actually present. A trained
  brain's outputs often sit inside a band of 0.02, and drawing them on the absolute
  scale would show eight identical bars for a decision that is entirely real.
- **Turn it yourself** — the same eight actions, driven through the same
  `Runner.step`, so the observation window and move history advance identically.
- **Run the test** — `evaluate.js` in the page, on held-out cubes, against untrained
  brains. The same function the grid search and `bake_brain.js` use, so the number on
  screen is the number in this file.

The episode the page drives is `Runner` from `env.js` — the same object, the same
observation assembly, the same argmax — advanced from a timer instead of a
while-loop. There is no second implementation of "one move" anywhere in the project.
The traffic-light project in this folder lost a day to a trainer that ran 200-second
episodes while its own benchmark ran 380-second ones, and the lesson was that two
implementations of one episode will diverge, quietly, in the direction that flatters
the trainer.

---

## Files

| file | what it is |
|---|---|
| `cube.js` | cubie geometry → facelet permutations, scrambles, the BFS distance oracle |
| `vision.js` | isometric projection, the sparse render matrix, observation assembly |
| `nn.js` | the genomes: MLP and multi-channel ConvNet, mutation, crossover |
| `rewards.js` | the ten reward functions |
| `env.js` | `Env`, `Runner`, `Ratchet` — one episode, one implementation |
| `evaluate.js` | the shared yardstick: held-out solve rate and descent by depth |
| `evolution.js` | the genetic algorithm — elites, crossover, annealing, islands, the gate |
| `configs.js` | every named run, and the three grids |
| `load.js` | concatenates the logic files into one scope for Node |
| `train_headless.js` | the trainer |
| `grid_search.js` | screen a grid, confirm the leader |
| `test_headless.js` | 89 assertions |
| `probe_rewards.js` | scores each reward *as an instrument*, per depth — the cheap answer the grid cannot afford |
| `probe_resolution.js` | is a stall search-limited or signal-limited? plus what the mutation operator actually costs |
| `compare_brains.js` | two or more champions on identical cubes, with a paired SE |
| `bake_brain.js` | validate a champion and write `default_brain.js` (`--out`/`--global` for the second brain) |
| `distil.js` | gradient distillation and DAgger — the only file in the project that uses a gradient |
| `probe_ceiling.js` | fit the same mapping by SGD: is this stall search-limited or representation-limited? |
| `view.js` | the animated cube and the pixel inset |
| `main.js`, `index.html`, `style.css` | the page |

## Running it

```bash
node test_headless.js                    # 89 assertions, ~60 s
node test_headless.js cube oracle        # named sections only

node train_headless.js                   # train, forever, writes training/champion.json
node train_headless.js --gens 2000 --workers 8 --out training/nightA
node train_headless.js --config rw-descent --pop 96
node train_headless.js --resume training/champion.json
# racing: screen everyone on 40 episodes, re-measure the top 8 on 320
node train_headless.js --screen 40 --finalists 8 --episodes 320 --pop 32

node grid_search.js reward --gens 180    # the reward grid
node grid_search.js arch                 # architectures and resolutions
node grid_search.js temporal             # how much history is needed
node grid_search.js rw-mixed,rw-descent  # any comma-separated set of configs
node grid_search.js arch --parallel 3 --workers 3   # 3 cells at once, 3 workers each

# instruments — all of these are seconds-to-minutes, not hours
node probe_rewards.js                    # reward-vs-truth correlation, per depth
node probe_resolution.js                 # can selection see the improvement at all?
node compare_brains.js training/a/champion.json training/b/champion.json

node bake_brain.js training/main2/champion.json   # validate, then write default_brain.js
BAKE_GAMES=250 node bake_brain.js …      # bigger validation bank
```

Cells run one at a time by default; `--parallel N` runs N at once, which is strictly
better use of the machine because a generation ends in a barrier that leaves workers
idle. It is safe because worker count cannot change a result — `evaluate` splits the
population by brain and concatenates in order, `evaluateOne` splits a bank by episode
and takes a count-weighted mean, and the GA's own generator is untouched by either.

The page needs no build step and no server; open `index.html`. `?nointro=1`,
`?depth=N`, `?moves=N` and `?selftest=1` are there for headless work.
