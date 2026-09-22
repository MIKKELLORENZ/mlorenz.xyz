# What worked — the road to the shipped brain

A post-mortem of how `default_brain.js` came to be, written against the artifacts in
this folder rather than from memory. The README is the project's narrative; this file
answers one narrower question: **what actually caused the individual that ships**, and
what merely looked like it did.

The short answer is uncomfortable and it is the point of the whole project: the
shipped brain is **not** the product of the genetic algorithm this repo is named for.
It is a gradient-trained student of an oracle, reading the observation that five
rounds of evolution discovered. The GA's contribution is real and it is not the
weights.

---

## What ships

| | |
|---|---|
| file | `default_brain.js` (4.6 MB, 1.7 MB gzipped) |
| source artifact | `training/dis_C2.json`, DAgger round **5** |
| contract | `1569-256-8 : relu / linear` — a plain dense MLP |
| parameters | **403,976** |
| observation | 3 × 16 × 32 two-panel isometric render (1,536) + 4 remembered moves × 8 (32) + clock (1) = **1,569** |
| actions | 8 quarter turns, `U U' D D' L L' R R'` |
| how it was trained | **backpropagation** (Adam) against the oracle's optimal moves, then 5 rounds of DAgger on its own rollouts |
| config name | `r5-relu64ep96+distilled` |
| flag in file | `distilled: true` |

Validated by `bake_brain.js` on 200 scrambles per depth it never trained on, 1,400 in
all, against untrained brains played on those same scrambles:

| depth | 1 | 2 | 3 | 4 | 5 | 6 | 7 | score |
|---|---|---|---|---|---|---|---|---|
| **shipped** | 100% | 100% | 100% | 100% | 98.0% | 84.5% | **73.5%** | **0.898** |
| `training/evolved_brain.js` — the GA champion | 100% | 100% | 80.5% | 55.0% | 32.0% | 20.5% | 14.5% | 0.424 |
| untrained | 21.3% | 4.2% | 1.5% | 0.6% | 0.5% | 0.1% | 0.4% | 0.038 |

Both brains read the **same** 1,569 numbers, through the same renderer, and take the
same eight actions. Mean moves used on a solved depth-7 cube: **7.66** against an
optimum of 7 — it is not wandering into the solution.

I confirmed the file on disk really is that artifact: `default_brain.js` and
`training/dis_C2.json` agree to 5 × 10⁻⁷ across all 401,920 first-layer weights (the
difference is the 7-significant-digit rounding `bake_brain.js` applies).

---

## Provenance, and what is missing

Unlike some sims in this folder, the training record **survived** here: `training/`
still holds nineteen checkpoints, eighteen run logs and `RESUME.md`. Almost everything
below is read straight off those files.

Two gaps worth naming:

- **The round-4 and round-5 grids ran on compnode1 and their logs are not in this
  repo.** Their results survive as tables in `README.md`, written at the time. Local
  logs cover rounds 1–3 (`training/logs/`).
- **`distil.js` does not record its own hyperparameters in the artifact it writes.**
  `save()` writes the *GA* config plus the architecture, `distilled: true` and a
  `daggerRound` tag — but not `--states`, `--epochs`, `--lr`, `--maxd`,
  `--dist-weight` or the DAgger round count it was asked for. So the exact recipe
  that produced the shipped weights survives only in prose in `README.md` and
  `training/RESUME.md`. This is the one provenance defect in an otherwise careful
  chain, and it is a one-line fix.

Where I could measure instead of quote, I did; those rows are marked **measured here**.

---

## The runs, in order

| round | what it was | outcome | artifact |
|---|---|---|---|
| 1 | reward grid, architecture grid, resolution, shading | frontier depth 3, 5,008 weights, gen 2,277 | `training/seed_gen2277.json` |
| 2 | six one-knob arms off one champion, ~1,000 gens each | **nothing separated** (+0.008 ± 0.005) | `training/arm{A..F}/` |
| 3 | seventeen one-factor cells from generation 1, then two follow-up waves | the observation was the bottleneck; gen 700 beat gen 3,321 | `training/best_gen700_f1h4d7.json` |
| 3b | three more hours on the round-3 winner | **worse** — 0.308 and 0.279 against the seed's 0.328 | `training/finalA,finalB/` |
| 4 | eighteen cells on 128 cores: capacity × activation | ReLU-64, 9,208 weights, gen 4,351, d7 13.3% | `training/best_round4_relu64ep96.json` |
| 4b | the `funnel` reward, built to train past depth 7 | **clean null**, 0.021 vs 0.023 | — |
| 5 | `probe_ceiling.js`, then distillation | **d7 13.3% → 73.5%** | `training/dis_C2.json` → ships |

Note the shape of that table. Rounds 1–4 are eleven activations, ten rewards, nine
architectures, two projections, populations from 32 to 256, recurrence, fitness
sharing, racing and four curricula — and they move depth 7 from ~6% to 13.3%. Round 5
is one afternoon and moves it to 73.5%.

---

## What worked, ranked

### 1. Measuring the ceiling before searching harder

`probe_ceiling.js` takes the easiest possible form of the problem — 54 facelets
one-hot, no pixels, no memory — and fits it with plain gradient descent. **One
minute.**

| distance | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| gradient descent, facelets | 100% | 100% | 100% | 99.9% | 97.0% | 92.2% | 79.6% |
| the evolved champion | 71% | 83% | 61% | 46% | 41% | 38% | 49% |

**96.7% against 53.5%.** Two hypotheses had been alive for four rounds — the mapping
is not learnable by a net this size (*representation*), or it is learnable and the GA
cannot find it (*search*) — and they demand opposite responses. No amount of further
evolution distinguishes them, which is why four rounds of evolution didn't.

The tell that should have triggered this earlier: **every approach converged to the
same number, 40–45% per-move accuracy.** Ten rewards, eleven activations, nine
architectures, three population regimes. When everything you try lands on the same
value, that value is answering a different question than the one you are asking.

This is first in the list because nothing else in round 5 happens without it.

### 2. The first-passage arithmetic, which set the target and the instrument

These generators flip corner-permutation parity, so the Cayley graph is bipartite and
**every move changes the true distance by exactly ±1** — verified in the suite over
~10,000 neighbour pairs, not assumed. Self-play is therefore a biased walk and a
depth-*d* solve is a first-passage problem with a closed form:

| per-move accuracy | d5 | d6 | d7 |
|---|---|---|---|
| 0.75 | 74% | 68% | 61% |
| 0.80 | 86% | 81% | 77% |
| **0.85** | 94% | 92% | **89%** |
| 0.90 | 98% | 98% | 97% |

**90% at depth 7 needs 85% per-move accuracy, not 98%.** The earlier assumption — that
seven correct moves in a row were required — ignored that the budget permits mistakes
and recovery, and it made the target look unreachable.

The same arithmetic supplies the instrument. The evolved champion ran at 53.5%
overall and **38–46% at distances 4–6, below the break-even where progress is even
expected**: it reached solved cubes by luck, not policy. Solve rate cannot see that —
it is one bit per episode, saturated at the shallow end and mostly noise at the deep
end. Per-move accuracy is a dozen labelled samples per episode and moves visibly long
before the solve rate does. `burst.js` reports both, and steering by the second column
is what made an 18-minute check meaningful.

One subtlety that is easy to get wrong: accuracy must be measured on the brain's
**own rollout**, not on the oracle's path. On-path accuracy is the flattering version —
the imitation runs reached 0.81 there while solving worse than the champion.

### 3. DAgger, and five rounds of it rather than a bigger net

The first distillation pass fitted its training set to 83% and played its own games at
**56%**. Training states came from *optimal* paths, so the model had never been asked
what to do after its own first mistake — which is where a rollout spends most of its
moves. Rolling out with the model driving, labelling every visited state with the
oracle, adding it to the pool and refitting took self-play accuracy to **93%**.

The shipped brain is the **fifth** DAgger round. `training/` still holds the arm that
went the other way, and comparing them on one shared bank settles which axis paid —
**measured here**, 60 cubes at each of depths 5, 6 and 7, all four candidates on the
identical bank:

| candidate | net | gen | acc | acc @ dist 4–6 | d5 | d6 | d7 |
|---|---|---|---|---|---|---|---|
| **`dis_C2` — ships** | 1569-**256**-8, **DAgger 5** | — | **90.4%** | **93.0%** | 98.3 | 88.3 | **70.0** |
| `dis_H7` | 1569-**512-512**-8, DAgger 1 | — | 87.8% | 86.0% | 96.7 | 85.0 | 68.3 |
| `best_round4_relu64ep96` | conv, 9,208 w | 4,351 | 42.3% | 35.6% | 28.3 | 23.3 | 10.0 |
| `best_gen700_f1h4d7` | conv, 5,304 w | 700 | 35.0% | 28.0% | 20.0 | 8.3 | 6.7 |

The shipped brain has **a quarter of H7's hidden capacity** and beats it, by 7 points
in exactly the distance band the arithmetic says decides depth 7 — and its file is
8.4 MB against 22 MB. More rounds of distribution correction beat more parameters.

That the two are comparable at all is itself a design decision: `distil.js`
checkpoints **after every DAgger round**, not once at the end, on the grounds that
each round is a complete usable policy and a run that writes its artifact only on
completion is worth nothing if the deadline arrives first.

### 4. Adam, not SGD — the difference between working and 17.4%

The facelet ceiling probe trained happily on one-hot inputs at learning rate 0.05. The
same rate on 1,296 centred **pixel** values collapsed all six runs to **17.4%**, which
is precisely the accuracy of always naming the most common optimal move. That is the
degenerate solution, not a hard problem.

The cause is mechanical: one-hot means 54 non-zeros of magnitude 1; pixels mean 1,296
non-zeros, so the gradient reaching the first layer is orders of magnitude larger and
the usable learning rate is correspondingly smaller. Per-parameter step sizes remove
the question, and mini-batching (32) cuts the update noise that made the collapse easy
to fall into.

Worth generalising: **a learning rate that worked on a probe's inputs is not
transferable to the real inputs.** The probe and the real thing differed in input
scale by two orders of magnitude and in nothing else that mattered.

### 5. Training on distance 8 — past the frontier the policy actually plays on

The per-distance accuracy of the best model before this fix:

| distance | 1–4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|
| accuracy | 100% | 92.6% | 72.9% | 54.5% | **20.3%** |

Perfect close in, near-blind at distance 8 — which is *exactly where every mistake at
distance 7 lands it*. The training pool was capped at distance 7, so the model had
never seen the states its own errors create.

The labels stay valid out there, and this is the part that is non-obvious: a radius-7
oracle reports 8 for anything beyond it, so a move that reaches a genuine distance-7
state is still correctly identified as the reducing one. The oracle does not have to
know how far away a state is to know that a move got closer.

This also explains why extra move budget and action randomisation both did nothing.
Neither helps in a region where the policy has nothing to offer.

### 6. The observation — which is what four rounds of GA actually produced

The distilled brain reads **`frames 1, moveHist 4`**, and it did not choose that. Round
three did, and it is the largest single factor in the project.

From `training/logs/w1.log`, seventeen one-factor cells from generation 1 at equal
wall-clock, 840 held-out scrambles identical for every cell:

| cell | score | vs control |
|---|---|---|
| `tm-hist4` — 2 → 4 remembered moves | **0.273** | **+0.130** |
| `cu-d7unif` — uniform depth 1–7 diet | 0.205 | +0.062 |
| `ar-convBig5` / `convTiny` / `convWide` | 0.169–0.206 | +0.03–0.06 |
| control | 0.143 | — |
| action-coverage term (0.03 / 0.08) | 0.145 / 0.154 | ~0 |
| `ga-share` — fitness sharing | 0.118 | −0.025 |
| `ep-lean` — pop 32 × 128 episodes | 0.095 | −0.048 |

Then wave 2 (`w2.log`) found the larger one: **dropping the second image frame.**
`x-h4f1d7` scored **0.341** against 0.245 for the same cell with two frames — 1,569
inputs instead of 3,105. Wave 3 replicated it on a fresh seed (0.325) and split the
confound: at one frame the deep diet is still worth +0.037. And `moveHist 6` is
*worse* than 4 (0.305) — four is a sweet spot, not a monotone knob.

The lesson is about which axis a plateau lives on. **The brain was memory-limited, not
perception-limited**, and from a score those are indistinguishable: a policy that
cycles and a policy that is merely bad both just fail to solve. Rounds one and two
spent themselves on rewards, architectures and breeding operators while the
observation sat untouched — because it had been *reasoned about* carefully rather than
tested. Image history was pure search-space cost.

So: the GA rounds were not wasted, but their durable product is the **input
contract**, not any set of weights. Round 4 added the other half the distilled brain
inherited — ReLU with a linear output head, which beat tanh at the same width by 0.047,
more than the width increase itself bought.

### 7. An environment that was correct before anything was trained on it

Four traps, each of which presents as *"evolution is too slow"*, and all four had to be
fixed before a teacher could exist at all:

- **⟨U,D,L,R⟩ is a proper subgroup** — about one part in two thousand of the cube
  group. A cube scrambled with F or B is usually unsolvable with these eight actions,
  so the optimal policy *does not exist*. Scrambles must draw from the solver's own
  generators.
- **A memoryless observation makes the task provably impossible.** A deterministic
  policy on a finite state space is eventually periodic: it plays U, U', U forever.
  This is an observability bug wearing a learning bug's clothes; it is fixed by adding
  a move-history window and a clock, not by training longer. Kept as `tm-memoryless`
  and proved in the suite. Caveat learned the hard way: *eventually* periodic is not
  *within one budget* — test past the budget.
- **The clock leaked difficulty.** It was normalised by an episode-dependent budget
  `min(20, d0 + slack)`, letting the network read the scramble's difficulty off the
  scale of its own clock. Normalise by the constant maximum.
- **The cube is geometric, not tabulated.** 26 cubies at integer positions, a face turn
  is an honest 90° integer rotation, and the facelet permutation tables are read off
  the geometry at load time. Pasting ~120 facelet indices from a reference gives you a
  cube that still looks correct under every casual check — moves shuffle stickers,
  solved is solved, a scramble is undone by its inverse — and is silently wrong.

The same geometry drives the renderer, so the picture the network sees and the puzzle
it is solving cannot drift apart. There is one description of the cube.

### 8. Drawing training states from trajectories, not from isolated cubes

`distil.js` walks an optimal path from a random scramble and records every state on it
*together with the move history the observation carries*. Sampling isolated cubes would
hand the network a history block that never matches what it sees at test time — the
same train/test observation mismatch that cost this project a whole round elsewhere.

Two more details in the same family:

- **Labels are every distance-reducing move**, and a prediction counts correct if it
  names any of them — identical to the GA's fitness rule, which is what makes
  `distil.js`'s printed accuracies directly comparable with `burst.js`'s.
- **States outside the oracle's radius are dropped, not guessed at.** An unlabelled
  state is not the same thing as a hard one, and inventing a target for it is how a
  DAgger round makes a policy worse instead of better.

### 9. Baking as a gate, not a copy

`bake_brain.js` refuses to write anything until four things hold:

- the brain's **contract matches its own config** — a champion is weights against one
  exact input layout, and handed a different one it does not degrade, it reads noise;
- **rounding did not change a decision** — the guard asserts the **argmax** is identical
  over 400 probes, which is the property that actually matters. (Its first version was
  a 10⁻⁶ *absolute* bound on outputs, correct only while the head was tanh; a linear
  head legitimately shifts ~10⁻⁵ at 7 significant digits, so it refused a correct
  brain. Now relative.)
- the header carries the **held-out validation, not the training score** that got the
  brain crowned — different quantities, only one of which is a claim about ability;
- **`distilled: true` travels with the artifact**, not in a filename anybody could
  rename. A distilled net and an evolved one are the same shape and the same file
  format, and the project's entire claim is about how the weights got there. Two bugs
  were caught here: the baker wrote the right file while printing the wrong name, and
  an early baked artifact carried no flag — so it would have inherited the header
  sentence "no gradients, no backpropagation".

Every public claim has to move with the artifact. When the gradient brain became the
default, the intro copy, the brand line and the site description in `js/projects.js`
all still asserted evolution and had to be rewritten.

### 10. Duelling snapshots on a shared bank instead of trusting the last champion

The round-4 champion was picked by `duel.js` out of **357 snapshots from ten
concurrent runs**, in two stages. That mattered twice over: the stage-1 leader at 40
games per depth scored 0.465, fell to **0.424** at 250 games per depth and finished
second — and the longest run of the night reached generation 13,200 with a final brain
**0.080 below its own earlier snapshot**.

The mechanism is worth keeping. Elitism is monotone only against a *fixed* bank, and
the held-out gate deliberately **rotates** so it cannot become the training set. A
challenger that wins one rotation takes the title permanently and the deposed brain is
never re-checked, so near a plateau — where gate noise exceeds real differences — the
title random-walks downhill while every log line looks healthy. **Whichever brain a
long run ends on is a hypothesis, not a champion.**

The same rule applies across runs: **never compare two runs by their gate scores.** The
gate bank is drawn at each run's own curriculum frontier, so 0.809 at depth 2 and 0.767
at depth 3 cannot be ranked against each other. Only shared-bank paired deltas.

---

## The reward function, and the cube mechanics it leans on

The tables above mention "ten rewards" and the `funnel` null without saying what
the GA lineage was actually paid, or why. Both matter, because the shipped brain
was ultimately trained on something that is *not* a reward at all.

### What the evolved lineage was paid

Every GA config from round 3 on — including `r5-relu64ep96`, the seed of the
distilled brain — inherits the base environment's `reward: "mixed"` with default
parameters ([configs.js](configs.js#L294-L295)). Per episode, from
[rewards.js](rewards.js):

```
r = 0.8 · descDisc / discNorm(d0, γ=0.9)     // discounted descent, 0..1
  + (solved ? 1.0 + 0.5 · (budget − moves) / budget : 0)
  − 0 · moves − 0 · undos                      // stepCost and undoPenalty: off
```

`descDisc` accrues `γ^t` at every move *t* that set a new personal-best true
distance; `discNorm` is the largest value that sum can reach on a *d0*-deep
scramble, so every depth lands on the same 0..1 scale and a bank mixing depths
1–7 is not secretly a weighted average that favours the shallow ones. The solve
bonus dominates the shaping (up to 1.5 against 0.8) on purpose — the shaping is a
nudge, not half the score. `rw-mixed-cost` (`stepCost 0.01`) was swept as a
separate cell and did not separate from this.

The held-out *score* the tables quote is a different quantity, from
[evaluate.js](evaluate.js#L67-L75): per depth, `0.7 × solveRate + 0.3 × descent`,
weighted linearly by depth. It cannot be the training reward, because scoring
each run on its own reward would rank the rewards by generosity, and the
exploitable one below would win.

### Four properties of the cube that decide which rewards are honest

1. **Every quarter turn changes the true distance by exactly ±1.** The
   generators ⟨U, D, L, R⟩ flip corner-permutation parity, so the Cayley graph is
   bipartite — no move is ever "sideways". Verified in the suite over ~10,000
   neighbour pairs, not assumed. Consequence: "how many times did it set a new
   personal best" and "how much closer did it get" are the same number, and the
   descent term **cannot be farmed by oscillating**. The reward is monotone in a
   quantity the move set cannot hold still.
2. **The reward reads privileged state; the policy does not.** True distance
   comes from the BFS table in `cube.js`. It is scaffolding for training and ships
   nowhere — the network's input is pixels and a move history, exactly as the
   Dellacherie oracle labels the Tetris project's data and never appears at play
   time.
3. **Sticker count cannot tell U from U² from U'.** Turn U once: the nine U-face
   stickers stay home, the twelve top-row stickers of F, R, B, L are all wrong —
   42/54. Turn it again, or the other way: still 42/54. One move from solved, two
   moves from solved and one move the *wrong* way score identically. Measured as
   an instrument by `probe_rewards.js` (Spearman rank correlation of thirty
   policies against ground truth), the flaw is real but mild: **0.99 at depth 1,
   0.88 at depth 6**. The oracle-free rewards stay on the table for this reason —
   they are the only ones that work past the oracle's radius.
4. **The oracle stops at radius 7.** `distanceOf` returns `radius + 1` for any
   state it has not enumerated, so every oracle-shaped reward is literally
   *constant* on a depth-9 cube and a depth-15 cube alike. Training on genuinely
   scrambled cubes was never rejected on evidence — it was unreachable by
   construction, and `depthCap` silently clamped inside the ball anyway. `funnel`
   was built to fix exactly this and came back a clean null (table below): the
   flat reward was not the binding constraint out there.

### The reward that fails, and the shape of its failure

`optimalFrac` — the fraction of moves that reduced the distance — is the dense
per-decision signal a person reaches for first, and it is farmable: U then U' is
one reducing move in two, so a brain that oscillates forever banks 0.5. It is kept
in the grid because a reward economy's failure modes should be demonstrated, not
asserted. Its rank correlation with ground truth runs **0.99, 0.95, 0.88, 0.75,
0.51, 0.27** across depths 1 to 6. That gradient *is* the exploit becoming
available — a depth-1 cube has almost no room to oscillate in — and a reward whose
hole opens exactly as the task gets harder is the worst possible shape for a
curriculum, because it is invisible at the depths a training grid can afford.

The corollary for reading the round-1 reward grid: at depths 1–2 the only
distinction that exists is "did it solve", every reward sees that, and all twelve
cells land in a narrow band. That is a statement about a budget, not a null result
about rewards.

### What the shipped brain was trained on instead

Not the reward. `distil.js` fits cross-entropy against the oracle's label set —
**every distance-reducing move** at each visited state, any of which counts as
correct — and property 1 is what makes that set well defined: "reducing" is
exact, never a tie. It is also the GA's own per-move accuracy rule (§8), so the
two training signals agree on what a good move *is* and differ only in
resolution: one scalar per twenty-move episode against one label per move. §1 and
§2 are the measurement of how much that difference was worth, and the honest
summary is that the reward was made correct in round 1 and correctness was not
the constraint.

---

## What did not work, or actively misled

| | what happened |
|---|---|
| **Four rounds of GA search** | Ten rewards, eleven activations, nine architectures, two projections, pop 32–256, recurrence, sharing, racing — all converged to 40–45% per-move accuracy. The convergence *was* the signal and it took four rounds to read. |
| **Six one-knob arms off one champion** (round 2) | ~1,000 generations each: **nothing separated**, +0.008 ± 0.005 over the seed. Re-baking moved validated numbers by 0.001. |
| **Fitness sharing, retrofitted** | Revived nothing in 220 generations at λ=12 or λ=30. Converged population mean pairwise distance was **0.374 against 1.012** fresh — mostly *inside* the sharing radius, so crowding is uniform and dividing by it changes no ranking. Sharing preserves diversity; it cannot create it. An intervention that preserves a property must be switched on before the property is lost, and retrofitting it gives a clean null that looks like the fix failing. |
| **The action-coverage term** | Built specifically for the round-2 diagnosis that three of eight actions were dead. Clean null: 0.245 vs 0.244 against its own matched control. Correct instrument, wrong disease — dead actions are a *symptom* of a policy that cannot represent the task, and pricing the missing actions does not supply the memory it needed to use them. |
| **The 3% weight-reset branch** | At rate 0.10 over 5,008 weights it redraws ~15 weights from N(0, 0.5); with an argmax over outputs in a narrow band, that *replaces* the policy rather than nudging it. `mut-reset 0.03` blocked promotion outright — arm C's champion was **byte-identical to its seed across all 5,008 weights** after 220 generations. At 0.005, 4,562 weights moved. Whether lowering it produces a *better* brain is still unmeasured; I briefly believed it had earned a curriculum promotion and it had not. |
| **The `funnel` reward** (depths 8–12) | Carefully built — structure credit outside the radius-7 ball, exact descent inside, non-overlapping ranges asserted in the suite so nobody deletes the oracle half. **Clean null: 0.021 vs 0.023** for the flat control. The flat reward was not the binding constraint out there. |
| **Higher resolution** | Lost in round 1, round 3 and round 4. res 20 and res 24 finished near the bottom every time. Legibility was never the binding constraint; search space was. |
| **The population / episode / GA-structure axis** | Nothing, three rounds running. Islands, pop 128 and racing all inside the control's noise; racing below it. |
| **Larger move budget** | 16.0% → 16.5% at depth 7 for the evolved brain, and **identical to the decimal** at every setting for the distilled one — which means its failures are deterministic cycles, not slow progress. |
| **Temperature sampling and ε-greedy** | Nothing at any scale, and ε-greedy strictly worse (7.5% at ε=0.25). None of these help a policy whose drift is negative. First temperature sweep was accidentally still argmax: a linear head runs ±65, so T has to be scaled to the logits. |
| **Three more hours on the round-3 champion** | 0.308 and 0.279 against the seed's **0.328** — the plain continuation 2.0 SE down on 1,750 paired scrambles, and the raced one bought 1.8× the generations and was worse still. |
| **More capacity, under the GA** | The two largest nets in the round-4 grid (25k, 26k weights) finished 10th and 17th of 18; a 125k facelet MLP scored 0.203 against 0.264 for a 23k one. Capacity binds only over a narrow range and its search cost is paid immediately. |
| **A second hidden layer, under gradients** | `dis_H7` at 1569-512-512-8 scored below the shipped 1569-256-8 on a shared bank (**measured here**, above) while tripling the page weight. |

---

## What this does *not* establish

The shipped brain differs from the evolved champion in **two** ways, not one:

| | evolved | shipped |
|---|---|---|
| optimiser | mutation + selection | Adam + DAgger |
| architecture | conv, **9,208** weights | dense MLP, **403,976** weights |

So the gap from 14.5% to 73.5% at depth 7 **cannot be attributed to the optimiser
alone.** The architecture changed for a mundane reason: `distil.js` has a backward
pass only for a plain MLP, because that is what `nn.js`'s `Net` is and it exports
straight into the champion format everything else already understands.

The indirect evidence still points hard at the optimiser — under the GA, more capacity
*consistently made things worse*, so a 404k-weight dense net evolved by this GA would
be expected to land below the 9k conv one, not above it. But that is an inference. The
experiment that would settle it is distilling into the identical conv architecture at
matched parameter count, and it needs a convolutional backward pass that is not
written. Until then the honest claim is **"gradients plus the capacity they make
usable"**, not "gradients alone".

And the real limit is unchanged: **depth 7 is not a solved cube.** A real scramble is
15–18 turns deep, the oracle's table only reaches radius 7, and every reward here is
flat beyond it. Nothing in round 5 moved that boundary.

---

## Reproducing the shipped brain

```bash
# the recipe (hyperparameters are prose, not metadata — see Provenance)
node distil.js --config r5-relu64ep96 --hidden 256 --dagger 5   # -> training/dis_*.json

# bake, with the contract check, the argmax-invariance guard and held-out validation
node bake_brain.js training/dis_C2.json                         # -> default_brain.js

# the GA control, which the page does not load
node bake_brain.js training/best_round4_relu64ep96.json \
     --out training/evolved_brain.js --global EVOLVED_BRAIN

# the instruments
node probe_ceiling.js                    # search-limited or representation-limited?
node burst.js --games 60 --depths 5,6,7 training/dis_C2.json ...   # accuracy, not solve rate
node duel.js  ...                        # snapshots on one shared bank
```

The source artifacts for the round-5 distillation grid are on compnode1 at
`/data/rubiks/training/dis_*.json`; `dis_C2.json` and `dis_H7.json` are also here.

---

## In the browser

`index.html` loads `nn → rewards → env → evaluate → evolution → configs →
default_brain → view → main`. `default_brain.js` assigns `window.DEFAULT_BRAIN`;
`main.js` reads it, rebuilds the environment **from the config baked into the brain**
rather than from the current defaults, and refuses to load a brain whose contract
disagrees with the page's layout — a champion under the wrong layout does not degrade,
it reads noise, and the page would present the result as its ability. If the check
fails the page still runs, on an untrained net, and says so.

Two display-only overrides, both deliberate: `oracleRadius 6` instead of the trainer's
7 (the distance table is only a readout on the page, and radius 7 is ~200k states and
60 MB to build on load — a poor trade on a phone; distances past it show as "≥7"), and
`depthCapOverride 12` so a visitor can hand the brain a cube well past what it trained
on and watch what happens.

The second view is the **network**, drawn live from `Net.activations()`: the 1,569
inputs laid out in the render's own row length so the three colour channels stack up as
three recognisable pairs of panels, all 256 hidden units, and the largest
weight × activation terms wired to the output that won. It replaced a view of the far
side of the cube, which was a duplicate — the observation is already two panels from
opposite corners. Two things keep it honest: the panel re-runs the forward pass itself
(but never for a recurrent net — drawing a picture must not change the episode it
depicts), and the selftest swaps in an untrained net and asserts the drawn outputs
change. *A diagram that survives having its subject replaced is decoration, and
decoration is exactly what a viewer cannot tell apart from evidence.*

One brain ships, with no picker. The page briefly carried both behind a switch and it
lasted one message: a visitor does not arrive wanting to audit an optimiser, and a page
that opens on a choice between a brain that works and one that does not is a page about
the author's ambivalence.

---

## Loose ends found while writing this

Small, and none of them affect the shipped weights:

- **`distil.js` does not record its own hyperparameters** in the artifact (above). The
  fix is adding the parsed args to the object `save()` writes.
- **`probe_ceiling.js`'s header still says "the shipped brain is evolved"** (line 5).
  It has not been true since the gradient brain became the default.
- **`README.md`'s "Limits, and what was not established"** opens with *"The frontier is
  depth 3 … this brain solves 8% of seven-turn ones."* That is round-three text sitting
  after the round-five section, where the shipped brain solves 73.5% of them.
- **`undoRate` has quietly inverted its meaning.** It was a pathology metric — a
  cycling policy undoes itself — and the round-4 evolved champion scored 0.0%. The
  shipped brain scores **13.8%** and is five times better. For a competent policy,
  undoing your own mistake *is* the correct recovery, so the metric now measures
  something closer to error rate than to cycling. Worth relabelling before anybody
  reads a low number as a good one.
- **The most likely remaining gain is half-finished.** The distance 8–9 runs
  (`dis_M*`, deep-weighted pool at `--maxd 8`) were launched on compnode1 and never
  completed; M1 reached only DAgger round 1 and was behind because a deep-weighted pool
  starves the shallow rungs early. Raising `oracleRadius` to 8 is already permitted by
  `buildDistanceTable(min(r, 8))` — ~240 MB instead of ~40 MB — and would give exact
  labels at distance 8 and let training reach distance 9.
