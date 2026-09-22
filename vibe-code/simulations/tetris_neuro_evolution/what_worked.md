# What worked — the road to the shipped Tetris brain

A post-mortem written from the source, the run logs and the checkpoints, not from
memory. Everything numeric below either comes from a file in `training/` or was
measured while writing this; the measurements made here are marked.

The short version: **five rounds of neuroevolution, roughly 16,500 generations
over two days, produced a brain that clears 5.6 lines a game. Two and a quarter
hours of imitation learning, on the identical network and the identical keyboard,
produced one that clears 38.** The genetic algorithm was never short of compute.
It was short of *signal*, and no amount of better GA fixes that.

---

## What ships

`default_brain.js` — written by `node bake_brain.js`, read by the page's
"Showcase" and "Load built-in champion" buttons.

| | |
|---|---|
| contract | `111 → 32 → 48 → 7`, ReLU hidden, sigmoid out |
| parameters | **5,511** (111·32+32 = 3,584, then 1,584, then 343) |
| sensor profile | `compact` — no board picture, no surface window |
| actuator | seven keys. Each sigmoid above 0.5 is a key held down |
| reward config | `LINES_LO` — `[0, 60, 180, 440, 1000]` |
| provenance | Adam on 298,808 oracle-labelled decisions, DAgger-aggregated, then **80 generations** of GA |
| source file | `training/round6/ga/snaps/g80.json` |

Verified while writing this: the baked weights and `g80.json` agree over all
5,511 numbers to **4.4e-6**, which is exactly the 7-significant-digit rounding
`bake_brain.js` applies and asserts (it refuses to write if the rounding moves
any output by more than 1e-6).

At play time there is **no search of any kind**. The oracle that taught it is
scaffolding: it lives in `training/round6/teacher.js`, it never ships, and the
thing in the browser is 5,511 weights and seven sigmoids driving the same
`onKeyDown`/`onKeyUp` a human player drives.

### The one rule that shapes the whole project

Almost every Tetris agent you will find works by *placement search*: enumerate
the ~40 (column, rotation) pairs, score each resulting board, teleport the piece
to the winner. Here the network's only actuator is a keyboard, with **press-edge
semantics** on rotate, hard drop and hold — a held rotate key fires once, not
forever, so to rotate twice the brain must *let go*. It is fed its own held keys
as input and has to learn to release them.

Keep that rule in mind for the whole document. It is what makes the task hard,
it is what the GA never learned, and it is the single clearest thing the oracle
taught.

---

## What it actually does

Measured while writing this: 500 paired held-out games on bank `33300001`, a bank
no run in `training/` used, 400-piece cap. `skill = pieces + 25 × lines`.

| brain | skill | lines/game | pieces/game | best game |
|---|---|---|---|---|
| `round5/best.json` — gen 16,489, **pure GA** | 193.0 ± 3.3 | 5.57 | 53.7 | 19 |
| `imitated_scratch.json` — plain behaviour cloning | 161.4 ± 4.2 | 4.56 | 47.3 | 20 |
| `dagger_r1.json` | 345.8 ± 7.6 | 11.19 | 66.1 | 39 |
| **`dagger_r3.json`** — the distilled brain that got baked | 803.8 ± 19.4 | 27.76 | 109.9 | 104 |
| `dagger_r5.json` | 502.2 ± 13.5 | 16.88 | 80.2 | 68 |
| **`ga/snaps/g80.json` — SHIPPED** | **1092.0 ± 24.3** | **38.21** | **136.7** | **111** |
| `ga/champion.json` — gen 455, the run's own champion file | 958.6 ± 20.9 | 33.36 | 124.7 | 109 |

Paired against the pure-GA champion, every difference clears its error bar by a
wide margin:

```
  -31.6 ±  5.3   behaviour cloning        (t = -5.9)   worse than the GA
 +610.8 ± 19.6   DAgger round 3           (t = 31.2)
 +899.1 ± 24.4   shipped brain            (t = 36.9)
```

So the shipped brain is **5.7× the pure-GA champion** on the same yardstick, and
it never has a scoreless game where the GA champion has 3 in 500.

For scale in the other direction: the oracle itself, run directly (measured here,
6 games, 3,000-piece cap) clears **1,198 lines per game and never tops out** —
that is 99.8% of every cell it is handed, essentially the conservation limit. The
network gets about a thirtieth of its teacher. This is a much better Tetris player
than the project had before; it is not a good one.

---

## The reward function

There are two learning signals in this project and they are completely different
animals. This section is about the GA's reward — the one that trained everything
up to round 5 and the final 80 generations. The imitation loss is in the next
section.

### The ledger

`world.js`, `const R`, applied once per **placed piece**:

| term | value | what it is for |
|---|---|---|
| `PIECE` | **+8.0** | every piece safely placed |
| `LINES` | shipped: **[0, 60, 180, 440, 1000]** (code default `[0, 240, 640, 1520, 3600]`) | super-linear — tetrises are the prize |
| `FILL` | +6.0 per unit | row completeness added, `Σ (cells in row / 10)⁴` |
| `NEW_HOLE` | −1.6 each | a cell buried under the stack |
| `FIXED_HOLE` | +0.8 each | a cell un-buried — **deliberately half of `NEW_HOLE`** |
| `BUMPY` | −0.10 | added surface roughness |
| `HEIGHT` | −0.05 | added total stack height |
| `LANDING` | −0.03 | per row above the floor the piece landed |
| `WELLS` | −0.12 | newly dug unreachable well |
| `DITHER` | −0.4 | for burning the whole per-piece tick budget |
| `PENALTY_CAP` | **−7.5** | the most the shaping can ever subtract |
| `TOPOUT` | −48 | once, at the end |

Lines alone is far too sparse: a random brain never clears one, so all of
generation 1 scores exactly zero and selection has nothing to sort. Everything
except `LINES` and `TOPOUT` exists to give the first generation a gradient.

### Trap 1 — the suicide exploit, and the invariant that stops it

If shaping can make a placement net-negative, the optimal policy is to top out
immediately and stop accruing losses. Two rules prevent it:

* the shaping total is **clamped** at `PENALTY_CAP`, and
* `PIECE + PENALTY_CAP = +0.5 > 0`.

Placing a piece is therefore *always* profitable, however clumsy. Living longer
always beats dying; living longer with a flat, hole-free board beats that. That
ordering is the ladder the GA climbs, and `test_headless.js` asserts the
invariant directly (`the reward can never make dying pay`).

The time cost lives **inside** the clamp for exactly this reason. A per-tick drip
outside the clamp is precisely how "place a piece" turns net-negative.

### Trap 2 — a guard rail that became the road surface

The first version used `PIECE = +2` and `PENALTY_CAP = −1.5`. The invariant held,
and the clamp fired on **69% of placements** — a brain that buried one cell and a
brain that buried five scored *identically*, and the whole shaping gradient was
gone. Everything was multiplied up to +8 / −7.5, which keeps the invariant and
drops the clamp rate to ~24%.

There is a test for that too, and it is the more interesting of the pair: it
temporarily sets `PENALTY_CAP` to −1e9, replays hundreds of random-brain
placements, and asserts that the real clamp would have bound on **fewer than 35%**
of them. A guard rail that fires most of the time is worse than no guard rail,
because it silently deletes the signal it was protecting.

### Trap 3 — a penalty that bought a shortcut

The time penalty started at −1.6, a fifth of the whole clamp budget. Evolution's
cheapest way to avoid it was to **pin soft drop on permanently**: pieces then fell
in ~29 ticks, giving about seven decisions per piece, which is not enough to pick
a column *and* rotate *and* get there. The brain had traded away the ability to
play for a reliable small bonus, and then plateaued.

It was found by probing key usage, not by reading the reward. The fix was to make
dithering cheap (−0.4) and soft drop milder (6× → 2×), plus a test asserting that
a slammed piece can still cross the board and rotate on the way down. **If the
action space is not physically usable, no amount of evolution helps.**

### Trap 4 — pay for a clear what a clear is worth

The code default pays 240 for a single, when a piece is worth 8. One single is
therefore worth ~30 placed pieces while removing only 10 cells from the stack, so
one lucky clear swamps every real difference in stacking skill and selection
chases bag luck instead of technique. `LINES_LO` — `[0, 60, 180, 440, 1000]` —
scales that back, and **it is the reward the shipped lineage was trained under**.

This one is genuinely ambiguous in the record. An earlier search round found that
`nogrid_lines_lo` topped the 140-generation field and then *lost* to plain
`nogrid` over four hours (0.95 lines against 1.38) — the project's own "a
short-budget win is a hypothesis" lesson. The shipped config uses `LINES_LO`
anyway, inherited from the round-5 lineage. Nothing in `training/` re-tests it at
round-6 skill levels, and at 38 lines a game the argument is quite different from
the one at 1.4.

### Two directions this reward is careful about

* **`FIXED_HOLE` is half of `NEW_HOLE` on purpose.** If un-burying paid the same
  as burying cost, a bury/unbury cycle would be a free income stream. Asymmetric
  pricing makes the cycle strictly lossy.
* **Row completeness is measured *before* the clear.** The piece that finishes a
  line is credited for finishing it rather than punished for making the row
  vanish, which is what a naive post-clear measurement would do.

### And the thing the reward could never do

Round 5's champion, after 16,489 generations under this exact ledger, plays like
this (measured here, 40 games, presses counted as rising edges):

| brain | left | right | rot cw | rot ccw | soft | hard | hold |
|---|---|---|---|---|---|---|---|
| `round5/best` — key held, % of decisions | 30.2% | 42.4% | **0.0%** | 42.7% | **99.5%** | **100.0%** | 28.2% |
| `round5/best` — presses per piece | 3.42 | 1.77 | **0.00** | 1.77 | 0.09 | **0.02** | 1.84 |
| **shipped** — key held | 15.0% | 16.8% | 11.7% | 0.6% | 0.0% | 25.4% | 0.0% |
| **shipped** — presses per piece | 0.60 | 0.72 | 1.15 | 0.05 | 0.00 | **0.95** | 0.00 |

The pure-GA champion **had pinned or abandoned four of its seven keys.** Hard drop
is held down 100% of the time, so its press edge fired once at the start of the
game and never again — 0.02 presses per piece, i.e. it essentially never hard
drops and lets gravity place everything. Soft drop is pinned on. Clockwise rotate
is dead at exactly 0.00. And the compulsive hold habit is still there at 1.84
presses per piece.

The shipped brain presses hard drop **0.95 times per piece** — one deliberate slam
per piece, edges firing properly — rotates mostly clockwise, and never touches
soft drop or hold at all.

This is the reward's real limit, and it is not a tuning problem. *Releasing a key
pays nothing on its own.* The credit for a release arrives thousands of ticks
later, folded into one end-of-game scalar along with every other decision. No
weighting of holes and bumpiness can make selection see it.

---

## The learning approach that finally worked

### The diagnosis, in the right order

The champion cleared 5.7 lines; a six-parameter linear evaluator over the same
board clears hundreds of thousands. Before blaming the learner, round 6 ruled out
the two cheaper explanations:

1. **Is the actuator capable?** `probe_reach.js` enumerates every placement a
   search-based player would consider, then breadth-first searches *the real
   engine* over decision sequences under DAS, ARR, gravity, lock delay and the
   per-piece tick cap. Boards are sampled from real champion play, because an
   empty board is the easy case. Measured here: **972 of 972 placements reachable,
   100.0%, every piece type.** The keyboard is not the limit.
2. **Is the encoding capable?** Fit the 111 inputs to the oracle's keystrokes by
   gradient descent and look at *validation* accuracy. If the network cannot
   express the policy even on data it has seen, that is a fact about the sensors
   and the answer is a richer profile, not more compute. It reached **85.4%
   held-out per-decision accuracy**. The encoding is not the limit.

That leaves the search. And the arithmetic is stark: evolution collapses a whole
game into one scalar, so roughly 1,500 keystroke decisions are graded by a single
number — and the two problems tangled inside them, *where should this piece go*
and *how do I steer it there*, can never be separated by selection. A teacher
grades every decision individually and separates them by construction.

### The teacher

`teacher.js` is Dellacherie's evaluator: six features on the board *after* the
candidate piece locks and lines clear — landing height, eroded cells, row
transitions, column transitions, holes, wells — with the published weights and no
learning at all. Using it as a target is not cheating the premise: the premise is
that a neural network plays the game through a keyboard, and it still does.

### Step 1 — behaviour cloning, which failed

`make_dataset.js` plays 70 oracle games and records one labelled decision per
network decision — 89,981 samples, 4.3 per piece, at the real cadence through the
real sensors, so a sample is exactly what the network will see in play. Two design
choices in there matter:

* The driver is **deliberately the simple one a human would use** — rotate first
  while the piece is high, then slide, then hard drop — because the labels must be
  a *deterministic function of the state*. A search returning any one of several
  equally short paths would make the same board teach two different keystrokes,
  and the net would learn their average, which is neither.
* Its failure rate is reported precisely because reachability said a path always
  exists: **21,000 placements driven, 0 driver failures.** A failure here would be
  a bug, not a limit of the game.

Result: 85.4% validation accuracy, and **161.4 skill — worse than the 16,489-
generation GA champion at 193.0**, by 31.6 ± 5.3.

Seeding those weights from the evolved champion instead of randomising was worse
still: 83.3% accuracy and **63.3 skill**, with 612 of 1,500 games scoring nothing.
Sixteen thousand generations of commitment to another policy is a worse starting
point than random noise.

### Step 2 — DAgger, which worked

The accuracy was never the problem. The training states came from the *oracle's*
trajectories, and the oracle never visits the boards a slightly-wrong policy
creates — so the first mistake puts the network somewhere it has no data, and the
mistakes compound. DAgger closes that loop: the **network** drives, the oracle
labels the states it actually reaches, each round's states are appended to all the
previous ones, and the net is **retrained from scratch** on the aggregate (fit the
union of the distributions, don't chase the latest).

Three things had to be right, and each of them looked like "cloning doesn't work"
when it was wrong.

**(a) The label must be achievable from where the piece actually is.** The first
version fixed the target at spawn and then labelled every later decision "move
toward it". Under the oracle that is fine — it goes straight there. Under DAgger
the network wanders, the piece falls past the stack, and the spawn-time target
stops being reachable; every remaining decision of that piece then gets labelled
with a keypress that *physically cannot happen*, in bulk, from a dithering policy.
The record of that run is in `dagger.log`:

```
round 1: policy played 3.8 lines, 46 pieces/game, 30/30 topped out
round 2: policy played 1.4 lines, 29 pieces/game, 30/30 topped out
round 3: policy played 0.9 lines, 24 pieces/game, 30/30 topped out
```

Every round worse than the last, while validation accuracy *rose* 30% → 49%. The
network was fitting contradictions. The fix: recompute the target every decision
as the best-scoring placement the driver can **still reach from the current
state**, verified by running the driver on a copy of the game. Drifting off course
stops being an impossible instruction and becomes a *recovery* instruction, which
is the entire point of asking the oracle about states the policy visits.

**(b) Mix in the teacher early.** Pure on-policy rollouts from a weak net spend
most of their states on boards that are already lost, where every label is damage
limitation and none of them teach the good policy. `β` is the chance of executing
the *oracle's* action instead of the network's, decaying 0.50 → 0 across five
rounds, so the last rounds are honest on-policy data. `dagger2.log`:

```
round 1 (β=0.50): 84.5 lines,  22/40 topped out →  53,472 new states
round 2 (β=0.38): 102.1 lines,  8/40 topped out →  75,549 new states
round 3 (β=0.25): 99.8 lines,  11/40 topped out →  79,806 new states
round 4 (β=0.13): 93.0 lines,  18/40 topped out →  95,615 new states
round 5 (β=0.00): 17.2 lines,  40/40 topped out →  53,531 new states
```

**(c) Retrain from He init every round, never from the champion.** Same reason as
step 1.

The rounds, played out on my fresh bank: **346 → 649 → 804 → 625 → 502.** Round 3
is the peak, on 298,808 aggregated decisions, and it is the one that got baked.
Rounds 4 and 5 are a real decline, not noise.

### Step 3 — 80 generations of GA on top

The distilled brain was handed back to `train_headless.js` at pop 32, screening
10 brains cheap and re-measuring the top 8 on 60 games, with a rotating held-out
gate. It ran 456 generations in 65 minutes and snapshotted every 3 minutes.

The GA added **+288 skill (804 → 1092)** and it did it in the first **nine
minutes**. It is the only place in the whole pipeline where skill was *discovered*
rather than copied — and the shipped brain is honestly described as both distilled
and evolved, which `bake_brain.js` goes out of its way to get right (it has two
different provenance sentences and picks based on whether the checkpoint carries
an `imitation` record, so the header cannot claim "no gradients" about a brain
that had them).

**The GA setting that made this possible is a one-line default.** `nn.js` has a 3%
chance, per mutated weight, of throwing the weight away and redrawing it. That is
healthy for a population evolving from random — every brain in such a run was
*selected under that operator*, so the survivors are robust to it by construction.
A network fitted by gradient descent has never faced it and is not. Measured here,
one mutation at the run's own rate and step size (0.12 / 0.030 × 0.20 adaptive),
six children each way:

| | children's skill | mean |
|---|---|---|
| parent, `dagger_r3` | | **716** |
| reset branch **on** (default 3%) | 186, 367, 177, 209, 145, 44 | **188** |
| reset branch **off** | 834, 784, 803, 733, 771, 736 | **777** |

About twenty of 5,511 weights are redrawn, and that alone is the difference
between a child that still plays and wreckage. The additive noise was never the
problem. With resets on, the GA would have had nothing to select: every child four
times worse than the untouched elite.

---

## The architecture

`111 → 32 → 48 → 7`. Every part of it was picked by measurement, and the two
interesting facts are that it is *small* and that it *narrows first*.

**The inputs (111, the `compact` profile).** Full sensors are 391 numbers. The
single biggest finding of the whole architecture search was that **trimming the
input vector beats every architecture change**: every config that cut the 391
inputs beat every config that kept them (`nowindow` 32.9, `nogrid` 32.0,
`compact` 31.6, against 21–25 for the 391-input variants). A 3,000-generation run
on 391 inputs flatlined after ~150 generations — mean fitness 64 → 70 over the
following 2,800 generations — while the same GA, same reward, same network on 191
inputs was still finding new champions in its final 400 generations. *The old run
was not short of time; it was searching a space with 200 dimensions in it that it
could not use.*

`compact` is the smallest profile: no board picture, no surface window. What is
left is column heights and differences, holes per column, the current piece and
its rotation and column, fall distance and landing height, the next two pieces and
hold, board aggregates, the two sub-step timing clocks, the **drop preview** (for
every column: how high it would land and how many cells it would bury), and — the
one that matters for the press-edge rule — **its own currently-held keys**.

**The shape (32 then 48).** Traced through the checkpoints: it came out of
`genius.js`, the meta-search that retires losing cells every era and respawns them
from the record brain. The cell `e0_arch_N-32` is the "narrow the first hidden
layer by 32" operation, transplanted by `net_surgery.js` from the then-record
`111-64-48-7` brain at around generation 15,213. That transplant is *not* exact
(narrowing drops the units with the smallest outgoing L2 norm), but widening and
identity layer-insertion are exact bit-for-bit, and `test_headless.js` asserts it
numerically — `worst |Δ| 0.0e+0` — so a transplanted cell is measured on what the
new shape does next rather than on a hole it has to climb out of.

The narrowing halved the parameter count, from 10,631 to 5,511, and the shape took
the record. It is the same lesson as the input trim, one layer further in.

**The activation.** `tanh` was inherited from habit; ReLU beat it by 25% at
identical shape, and the interaction is the real finding: **with tanh a third
layer hurts, with ReLU it is the best thing in the search.** The standard
objection to ReLU — dead units have zero gradient forever — simply does not apply
under a GA, because there is no gradient: any mutation that lifts a unit's bias
revives it.

---

## Where the shipped brain came from

Timestamps are file mtimes; the whole of round 6 is one evening.

| phase | when | result |
|---|---|---|
| rounds 1–4: encoding + architecture search, `genius.js` meta-search | 30–31 Jul | 391 → 191 → 111 inputs; `64-32` → `32-48`; ReLU over tanh |
| round 5: eight parallel GA cells, racing, rotating held-out gate | 16 Aug, 12:37–20:28 | gen 16,489 at **~196 skill**, and 6,000 games saying the next 54 generations bought **−0.45 ± 1.33** |
| oracle + dataset | 16 Aug, 21:11–21:17 | 89,981 labels, 0 driver failures, 118 lines/game |
| behaviour cloning | 21:22 | 85.4% accuracy, **161 skill — worse than the GA** |
| DAgger, first attempt (spawn-fixed targets) | ~21:30 | each round worse than the last; abandoned |
| DAgger, 5 rounds with reachable targets + β decay | 21:36–21:56 | round 3 peaks at **777 ± 9 skill** on 2,000 games |
| 456 generations of GA from `dagger_r3` | 22:18–23:23 | **gen 80** wins the screen; gen 455 does not |
| final confirmation, 2,500 games | 23:27 | g80 **1043.6** vs dagger_r3 **771.6**, Δ +272 ± 13 |

Round 5 is worth pausing on, because it is the clearest picture of a plateau this
project has. `final_screen.json` is a **6,000-game** paired comparison between two
brains 54 generations apart, and the answer is −0.45 ± 1.33. `confirm.json` says
the same of four other snapshots. `screen_all.json` scores 46 snapshots across two
parallel cells and every single one lands between 187 and 202. That is not a GA
that needs better hyperparameters. That is a GA that has run out of things to
select on.

### Two provenance details worth knowing

**The shipped brain is not the trainer's own champion file.** `bake_brain.js`
defaults to `training/champion.json`; the round-6 GA's `champion.json` is
generation 455 with the run's highest *training* fitness (2,876 against g80's
2,679) and its highest gate score (986). Someone had to point the bake at a
3-minute snapshot instead. Measured here on my fresh bank, that was right:

```
paired against g80 (gen 80):
  -133.4 ± 32.4   gen 455  (t = -4.12)   the run's own champion.json
  -193.6 ± 32.2   gen 26
   -83.6 ± 30.4   gen 247
```

**The GA on top of a distilled brain peaks early and then declines.** Nine minutes
up, fifty-six minutes gently down, while training fitness and the gate score both
kept rising. Two independent screens (500 games over all 21 snapshots, then 1,500
games over the top five) and my own 500-game bank all put gen 80 first, so the
pick survives the winner's-curse objection — but the shape of the curve is the
warning. Once the brain is better than the reward is precise, more generations
optimise the ledger, not the game.

---

## What worked, ranked

1. **Diagnosing signal-limitation instead of tuning the GA.** The arithmetic —
   one scalar for ~1,500 decisions — was decidable in ten minutes and pointed at
   the only fix that mattered. Five rounds of better GA had already been tried.
2. **A teacher, and DAgger over its own play.** 193 → 804 on an unchanged network
   and an unchanged keyboard.
3. **Labels that are achievable from the state the policy is in.** Without this,
   DAgger runs *backwards*: three rounds, each worse, on rising accuracy.
4. **β mixing early.** Otherwise the aggregate is mostly boards that were already
   lost, and none of those labels teach the good policy.
5. **Turning off the weight-reset branch before evolving a distilled brain.**
   716 → 777 with it off, 716 → 188 with it on.
6. **Trimming the inputs. Twice.** 391 → 111 beat every architecture change; then
   narrowing the first hidden layer 64 → 32 took the record.
7. **The clamped, ladder-shaped reward.** `PIECE + PENALTY_CAP > 0` is what stops
   the suicide exploit; a clamp rate under 35% is what stops the guard rail eating
   the signal. Both are asserted by tests, not by comment.
8. **Paired duels with error bars, as the only way to decide anything.** Per-game
   skill has a standard deviation of ~80 against a mean of ~190; on 300 games the
   difference between two brains is ±6.5, which is the whole size of what a few
   hundred generations of polish produce. Pairing on shared seeds cancels seed
   difficulty and buys a factor of two for free.
9. **A held-out gate that rotates.** A fixed bank of N games that only ratchets up
   is not a filter, it is a training set with a slow optimiser attached — measured:
   cells promoting hard on a fixed gate drifted *down* on an independent bank, 5 of
   5 that moved. It rotates on staleness too, after a resumed champion once locked
   a run dead (its observed bar was 200.8 where the same brain scores 191 on a
   large sample, so nothing could ever clear it, so the bank never rotated).
10. **Racing.** Screen the whole population on ~16 games, re-measure only the
    finalists and the re-injected champion on 120. At 2 games per brain the gate
    was rejecting nine in ten in-run winners — i.e. the GA was mostly wrong about
    who had won.
11. **Probing behaviour, not just score.** Both engine exploits and both reward
    traps in this project were found by counting what the champion did on screen.

---

## Original measurements made while writing this

Everything in this list is new, run on the current code, and none of it is in
`training/`.

* **The baked file is `g80.json`** to 4.4e-6 over 5,511 weights.
* **The lineage duel on a fresh bank** (table above) reproduces every recorded
  number and adds gen 455.
* **The GA's own champion file is 133 ± 32 skill worse than what shipped.**
* **The reachability probe: 972/972, 100%.** (The code comment says 971/971 from
  a differently-sized board sample; same conclusion.)
* **The oracle ceiling: 1,198 lines per 3,000 pieces, 0/6 topped out.**
* **The key-discipline table.** The pure-GA champion had pinned hard drop at 100%
  held / 0.02 presses per piece and had a completely dead clockwise-rotate key.
  This is the most concrete statement of what the GA could not learn, and I have
  not seen it written down anywhere in the repo.
* **The weight-reset probe at the run's own hyperparameters:** 716 → 188 (on) vs
  716 → 777 (off).
* **`node test_headless.js` passes today** — every check, including the surgery
  exactness assertions at `worst |Δ| 0.0e+0`.

### The awkward one: supervised accuracy stops predicting play

| brain | validation exact-match | skill |
|---|---|---|
| `imitated_scratch` | **85.4%** | 161 |
| `dagger_r1` | 73.3% | 346 |
| `dagger_r2` | 75.7% | 649 |
| `dagger_r3` | 71.6% | **804** |
| `dagger_r4` | 63.6% | 625 |
| `dagger_r5` | 35.3% | 502 |

The most accurate network in the table is the worst player in it, by a factor of
five. Two caveats keep this honest, and both are real:

* The validation split is the **tail of the aggregate file**, which by
  construction is the newest DAgger round — so each row's accuracy is measured on
  a *different* distribution and the rows are not on a common yardstick. Only the
  first row is measured on the oracle's own states.
* Two of the seven per-key accuracies are free. The oracle's driver never presses
  soft drop and never presses hold (measured in `data.log`: 0.0% and 0.0%), so
  "soft 100.0%, hold 100.0%" in every log line is the network correctly predicting
  "never". The shipped brain inherited that and plays with five keys.

The usable conclusion stands anyway: **the loss stops predicting behaviour, so
snapshot every round and pick by playing.** That is what `dagger_duel.json` does,
and it is the reason round 3 shipped rather than round 5.

---

## What did not work, or actively misled

| thing | what happened |
|---|---|
| More generations at 391 inputs | 3,000 generations, flat after ~150. Mean fitness 64 → 70 over the last 2,800 |
| Plain behaviour cloning | 85.4% accuracy, **worse than the GA champion** it was meant to replace |
| Seeding the gradient fit from the evolved champion | 63.3 skill, 612/1,500 games scoreless — far worse than random init |
| DAgger with spawn-fixed targets | Three rounds, each worse than the last, on *rising* accuracy |
| DAgger rounds 4 and 5 | 804 → 625 → 502. β reaching 0 is not automatically better data |
| GA past ~generation 80 on a distilled brain | Training fitness and gate score up, held-out skill down 133 ± 32 |
| The default 3% weight-reset branch, on a distilled brain | 716 → 188 |
| Islands | At realistic populations (40–72) four islands is 10–18 brains each — too few to sustain selection. Scored well below a single pool; ships off |
| Behavioural fitness sharing | Implemented and tested, never won a comparison; ships off rather than on and unproven |
| A one-rep architecture win | `deep` (64-48-24) topped the broad round at 35.0 and collapsed to 24.9 in the runoff on a different seed. That is why there is a runoff |
| Convolutions that flatten | `convcolmax` (column-max pooled to 96 features, 10,975 weights) matched the best dense encodings at a third of the size; every variant that flattened a large feature map into the dense head scored at or below baseline. The convolution saves parameters and the flatten hands them all back |
| A short-budget reward win | `lines_lo` topped the 140-generation field and lost over four hours |
| A fixed held-out gate | 5 of 5 cells that moved drifted *down* on an independent bank |
| Linear mutation annealing | Ramped toward a target taken from what a *finished* run scores (24k); with the run at 300, σ had annealed by 1% and the mechanism was decoration. The hyperbolic curve `fit/(fit+half)` has no endpoint to mis-guess |

Two engine bugs also belong here, because both were paying:

* **Hold refreshed the anti-dithering budget.** `maxTicksPerPiece` counts
  `pieceTicks` and `_spawn()` reset it, so every hold handed out a fresh budget for
  the same placement. The champion pressed hold on 4 pieces in 5 (32 per game
  against 40 pieces) and scored *better* with the key unplugged — 83.7 against
  73.0. It had found a way to buy time and was wasting the time it bought.
* **A piece could lock as three blocks.** `_lock()` writes only cells with `y ≥ 0`
  while `_collides()` allowed `y < 0`; SRS kick tables contain −2 offsets and there
  are only two buffer rows. Rare (0.1 cells per game) but it is mass disappearing,
  and a piece that partly deletes itself buries fewer holes than one that lands
  honestly. The test that would have caught it is a one-liner nobody had written:
  *every lock adds exactly 4 cells to the board, minus 10 per row it clears.*

---

## What this does not establish

* **That the GA was doomed.** It establishes that *this* GA, on *this* reward,
  with 16,489 generations, plateaued at 5.6 lines — and that an hour of imitation
  beat it sevenfold. A different reward, or a curriculum, might do better. Nobody
  ran that experiment.
* **That the network is anywhere near its ceiling.** It reaches about 1/30 of its
  teacher. The distillation was stopped at five rounds because round 3 was clearly
  the peak of *that* schedule, not because more rounds cannot help — rounds 4 and 5
  declined under a β schedule that hit zero, which is a fact about the schedule.
* **That `LINES_LO` is the right reward at this skill level.** It was inherited.
* **That gen 80 is the best brain the round-6 GA passed through.** Snapshots are
  every 3 minutes, ~26 generations apart. Nothing between them was ever measured.
* **Anything about play beyond 400 pieces.** Every duel in this project caps there.
  The shipped brain averages 137 pieces, so the cap almost never binds for it — but
  it does bind for the oracle, and the two are therefore not measured on the same
  game.

---

## Reproduce

```sh
# the oracle, on its own
node training/round6/teacher.js --games 6

# can the keyboard express every placement?
node training/round6/probe_reach.js --boards 6

# labels from oracle play  →  clone  →  DAgger
node training/round6/make_dataset.js --games 70 --out training/round6/data
node training/round6/imitate.js --data training/round6/data --scratch 1 \
     --epochs 60 --out training/round6/imitated_scratch.json
node training/round6/dagger.js --rounds 5 --games 40 --pieces 300 --epochs 60

# pick the round that plays best, not the one that fits best
node training/round5/duel.js --games 2000 --bank 21300001 \
     training/round5/best.json training/round6/dagger_r3.json

# then evolve it — with the reset branch turned down
node train_headless.js --resume training/round6/dagger_r3.json \
     --pop 32 --screen 10 --finalists 8 --trials 60 --mut-reset 0 \
     --gate 300 --gate-rotate 5 --gate-stale 40 --workers 12

node bake_brain.js training/round6/ga/snaps/g80.json
node test_headless.js
```

## In the browser

Open `index.html`. Nothing to build, no dependencies.

* **Showcase** — the champion alone, full size.
* **Evolved vs untrained** — the built-in champion and a never-evolved brain side
  by side on the *identical* piece sequence. This is the honest answer to "did it
  learn anything, or does Tetris just look like that?"
* **Play it yourself** — you become a different key source on an identical game.
  The engine has no idea which of you it is talking to.

The page reads `default_brain.js`, applies **the brain's own config** before
building its first population (weights against the wrong input layout do not
degrade, they read garbage), and the header's validation numbers are from 60
sequences the brain never trained on.

---

## Loose ends found while writing this

Recorded, not fixed.

1. **`README.md` documents a brain that has not shipped for a month.** It states
   the shipped profile is `nogrid` (191 inputs), the shape `191 → 64 → 32 → 7`
   with 14,599 weights, and the results table reads 39.7 pieces / 1.33 lines at
   generation 4,558. The actual shipped brain is `compact` (111), `111-32-48-7`,
   5,511 weights, 133 pieces / 37 lines. The README also has no round-5 or round-6
   section at all, so the single largest result in the project — the imitation
   detour — is undocumented in the file a reader opens first.
2. **`README.md`'s reward table shows the code default, not the shipped values.**
   It lists `+240 / +640 / +1520 / +3600` for line clears; the shipped config uses
   `LINES_LO`, a quarter of that. Given that the same README elsewhere argues
   `lines_lo` *lost* over a long run, a reader has no way to tell which reward the
   champion was trained under.
3. **`test_headless.js` asserts "the default config is the shipped one — 391
   inputs".** The code default really is `full`/391, and the page re-applies the
   brain's own config, so nothing is broken — but the test's *name* is a false
   claim, and it is the kind of claim that stops being checked because a green
   test is sitting next to it.
4. **The trainer does not log `--mut-reset`.** `training/round6/ga/run.log` records
   pop, islands, self-adaptation, screening, piece cap, workers and the stop time —
   but not the one setting `nn.js` says is decisive when fine-tuning a brain the GA
   did not build, and which I measured above as a 4× effect. The run's behaviour
   (generation 1 already averaging 15.5 lines) says it must have been turned down;
   the record does not say so.
5. **Nothing records why generation 80 was chosen over the gate's own champion.**
   The screens are in `ga_screen.json` and `ga_stage2.json` and they justify it
   completely, but no note ties them to the bake, and `bake_brain.js`'s default
   argument still points at the file that lost.
6. **`training/round6/dagger.js` contains a dead function.** `planReaches` is
   defined, is 20 lines long, and is never called — `reachesFrom` superseded it.
   It also ends with `return sim.piece && true`, which is the shape of an
   abandoned edit.
