# Tetris Neuroevolution

Neural networks that learn to play Tetris **by pressing the arrow keys**. No
gradients, no backprop, no move planner — a population of brains, elitism,
mutation, and a lot of generations.

Open `index.html`. Nothing to build, no dependencies.

---

## The one rule that shapes everything

The brain's only actuator is a keyboard.

Almost every Tetris-playing agent you will find works by *placement search*:
enumerate the 40-ish (column, rotation) pairs, score each resulting board with a
handcrafted heuristic, teleport the piece to the winner. That is a good way to
play Tetris and a bad way to learn anything, because the hard part — getting the
piece there — has been deleted.

Here the network's seven outputs are seven keys:

| output | key | behaviour |
|---|---|---|
| 0 | `ArrowLeft` | press-edge steps once, then DAS → ARR auto-repeat |
| 1 | `ArrowRight` | same, and holding both cancels out |
| 2 | `ArrowUp` | rotate clockwise — **press edge only** |
| 3 | `KeyZ` | rotate counter-clockwise — **press edge only** |
| 4 | `ArrowDown` | soft drop, 2× gravity while held |
| 5 | `Space` | hard drop — **press edge only** |
| 6 | `KeyC` | hold, once per piece |

Each sigmoid above 0.5 is a key held down. The engine (`tetris.js`) exposes
exactly two entry points — `onKeyDown(code)` and `onKeyUp(code)` — and the
browser's real `keydown`/`keyup` listeners call the same two. When you pick
**Play it yourself**, you are a different key source on an identical game. The
engine has no idea which of you it is talking to.

The press-edge rule is what makes this interesting: a held rotate key fires
once, not forever. To rotate twice the brain has to *let go*. So it is fed its
own currently-held keys as input, and has to learn to release them.

---

## Files

| file | what's in it |
|---|---|
| `tetris.js` | the game. SRS rotation with full kick tables, 7-bag, hold, lock delay with move reset, guideline scoring. Knows nothing about neural networks. |
| `nn.js` | the genomes: a plain MLP and a convolutional stack over the board plane, sharing one mutation / row-wise-crossover / self-adaptive-σ layer. |
| `sensors.js` | board → numbers, in one of six named input profiles (111–391). |
| `configs.js` | the search space as data: 19 named configs (encoding × architecture × reward). One config is what a brain *is*. |
| `world.js` | one brain playing one game, the reward function, and a whole population in lockstep. |
| `evolution.js` | the GA: elites, mutated elites, crossover, grace, annealing, immigrant gates. |
| `render.js` / `ui.js` / `main.js` | drawing, controls, the generation cycle. |
| `train_headless.js` | offline trainer, one worker thread per core. |
| `ab_test.js` | runs GA variants head-to-head, ranked on held-out games. |
| `search.js` | the same, for configs: encodings and architectures on trial. |
| `overnight.js` | unattended pipeline — search → runoff → parallel long runs → bake → test → browser screenshot, every stage on a wall-clock budget. |
| `node_pipeline.js` | the same idea for a shared compute node: the search *is* the first phase of training, winners resume from their own search champions, hard thread cap. |
| `pick_best.js` | replays saved brains on a held-out bank nothing trained or ranked on, and names the winner. |
| `hyper_grid.js` | one good brain, many GA regimes: every cell starts from the same champion and differs only in how the GA treats it. |
| `genius.js` | the search that never finishes — every era it retires the worst cells and starts new ones from the record brain, choosing what to try by Thompson sampling over families of ideas. |
| `net_surgery.js` | moves a trained brain into a different architecture, reusing every weight it can. Widening and layer-insertion are exactly function-preserving. |
| `probe_holdout.js` | replays every live cell's champion on one shared bank every 90s, so the dashboard charts skill rather than population noise. |
| `dashboard.js` | a dependency-free live view: held-out progress per cell, which families are paying, the era history. |
| `probe_vanish.js` / `probe_hold.js` | forensics on champion behaviour — what actually happened on screen, counted. Both engine exploits below were found with these. |
| `bake_brain.js` | champion → `default_brain.js`, with a held-out validation run. |
| `test_headless.js` | `node test_headless.js` — engine, sensors, reward and GA checks. |

---

## What the brain sees

The full sensor vector is 391 numbers. **The shipped champion reads 191 of them** —
which block set a brain gets is a search dimension, not a decision, and the answer
turned out to matter more than anything about the network (see the search section
below).

| block | size | in the shipped brain? | |
|---|---|---|---|
| column heights | 10 | yes | |
| height differences | 9 | yes | neighbour-to-neighbour, clamped ±4 |
| holes per column | 10 | yes | |
| surface window | 80 | yes | 8 rows × 10 columns, **anchored to the stack top** |
| current piece + rotation | 11 | yes | one-hot |
| piece column | 11 | yes | one-hot + normalised |
| fall distance, landing height | 3 | yes | |
| next two pieces, hold, can-hold | 22 | yes | one-hot |
| **its own held keys** | 7 | yes | |
| board aggregates | 6 | yes | holes, bumpiness, max/min height, wells, tick budget used |
| gravity phase, lock phase | 2 | yes | sub-step clocks — see below |
| **drop preview** | 20 | yes | for every column: how high it would land, how many cells it would bury |
| **board plane** | 200 | **no** | the literal 20×10 picture: 1 locked, 0.5 falling piece, 0 empty |

The named profiles in `sensors.js` are combinations of those blocks: `full` (391),
`nowindow` (311), `planeexpert` (301), `plane` (257), **`nogrid` (191, shipped)**,
`compact` (111).

Four of them are doing most of the work:

* The **surface window** is *relative* — eight rows starting two above the
  highest block. A shape near the top of a tall stack looks identical to the same
  shape near the bottom of an empty board, so a trick learned in generation 20
  still applies in generation 2000 instead of having to be re-discovered per
  height.
* The **drop preview** answers "if I slammed it here, how high would it sit and
  how many cells would I bury?" for every column at the current rotation. Without
  it, evolution has to rediscover collision physics before it can start on
  strategy.
* **Held keys** — see the press-edge rule above.
* The **two timing clocks** are *sub-step*, not whole-descent: gravity phase runs
  0→1 between row-steps, lock phase 0→1 while the piece rests on the stack. At four
  decisions per row, "will the ground move under me on the next tick?" is the
  difference between landing a slide and being a column out.

Output: `191 → 64 → 32 → 7`, 14,599 weights and biases, every one of them evolved.
Both the encoding and the shape were picked by measurement — see the search
section below.

---

## The reward, and the two traps in it

Lines cleared alone is far too sparse: a random brain never clears one, so all of
generation 1 scores zero and selection has nothing to sort. So every *placed
piece* is also scored on what it did to the board.

```
piece placed        +8
lines cleared       +240 / +640 / +1520 / +3600      (super-linear — tetrises are the prize)
row completeness    +6 per unit of  Σ (cells in row / 10)⁴
new hole            −1.6 each      hole removed  +0.8 each
bumpiness, height, landing height, wells, dithering    small negatives
                    ── shaping total clamped at −7.5 ──
topping out         −48
```

**Trap 1 — the suicide exploit.** If shaping can make a placement net-negative,
the optimal policy is to top out immediately and stop accruing losses. That is
where naive shaped rewards usually end up. Two rules prevent it: the shaping
total is clamped, and the clamp (−7.5) is smaller than the piece bonus (+8), so
placing a piece is *always* worth at least +0.5 no matter how badly it is placed.
`test_headless.js` asserts this over several hundred placements by random brains.

**Trap 2 — a clamp that eats its own signal.** The first version of this used
+2 / −1.5, and the clamp fired on **69% of placements**: a brain that buried one
cell and a brain that buried five scored identically, and the entire shaping
gradient was gone. Everything was multiplied up to +8 / −7.5, which keeps the
invariant and drops the clamp rate to ~24%. There is a test for that too — a
guard rail that becomes the road surface is worse than no guard rail.

The **row-completeness** term is the trail of breadcrumbs to the first line
clear. Fourth power, so a row at 9/10 is worth far more than two rows at 5/10.
It is measured *before* the clear, so the piece that finishes a line is credited
for finishing it rather than punished for making the row vanish.

**Trap 3 — a penalty that bought a shortcut.** The time penalty started at −1.6,
which is a fifth of the whole clamp budget. Evolution's cheapest way to avoid it
was to pin soft drop on permanently: pieces then fell in ~29 ticks, giving the
brain about seven decisions per piece, which is not enough to pick a column *and*
rotate *and* get there. It had traded away the ability to play in exchange for a
reliable small bonus, and then plateaued. Probing the champion's key usage is
what surfaced it — soft drop held 90% of the time, hard drop pinned at 100%
(so its press edge never fired again after the first piece). The fix was to make
dithering cheap (−0.4) and the soft drop milder (6× → 2×). There is now a test
asserting a slammed piece can still cross the board and rotate on the way down:
if the action space is not physically usable, no amount of evolution helps.

---

## The GA

Each generation, sorted by fitness:

1. **untouched elites** — rank 0 is always a byte-for-byte copy of the best brain
2. **mutated elite variants** — the same brains, nudged
3. **elite crossover** — row-wise, whole neurons at a time
4. **the rest** — rank-weighted parents, mutation strength growing down the roster
5. **fresh random immigrants** — tapering to zero as the champion improves

**Row-wise crossover.** Whole neurons (a row of incoming weights plus its bias)
swap between parents, never individual weights. Two networks can compute the same
function with hidden units in a different order, so mixing weight-by-weight
scrambles what each neuron does; mixing neuron-by-neuron keeps functional units
intact.

**Annealing.** Mutation rate and strength fade toward a floor (default 22% of
the slider values) as the champion improves — wild exploration while the brain is
bad, fine tuning once it is good. The curve is hyperbolic, `fit / (fit + half)`:
halfway to the floor at the half-anneal fitness, approaching it asymptotically
after. That shape matters more than it sounds. The first version ramped linearly
to a target picked from what a *finished* run scores (24k); with the run sitting
at 300, σ had annealed by 1% and the whole mechanism was decoration. A hyperbolic
curve has no endpoint to mis-guess and starts working immediately — at fitness
124 it has already taken σ from 0.22 to 0.17.

If the champion has not improved for 8 generations the schedule is temporarily
undone and mutation is boosted 1.8×: a stalled hill-climb needs a *bigger* step,
not a smaller one.

**Self-adaptive step size.** Every genome carries its own multiplier on the
global mutation strength, and that multiplier is itself mutated and inherited.
Nobody tunes it: lineages whose step size suits where they are on the landscape
out-reproduce the ones whose does not, so the population discovers its own
schedule — and different lineages can run at different step sizes at the same
time. It won its A/B outright, and the populations consistently choose a σ well
below the slider default, which is a useful thing to be told by the run itself.

**Grace.** A champion that gets beaten keeps an untouched seat for a few
generations instead of being bred out on the strength of one unlucky bag.

**Two mechanisms that lost, and are off by default.** *Islands* — splitting the
population into semi-isolated demes with occasional migration — sounded right and
measured badly: at realistic population sizes (40–72) four islands means ten to
eighteen brains each, too few to sustain selection at all, and it scored well
below a single pool. *Behavioural fitness sharing*, which discounts a brain's
breeding score by how many others already play the same way (measured on
key-press mix, stack profile, cells buried and survival — never on weights, since
two nets can compute the same policy with hidden units permuted), is implemented
and tested but never won a comparison, so it ships switched off rather than
switched on and unproven. Both are one slider away if you want to play with them.

**Honest scoring.** Every generation draws new piece sequences, so "best fitness
ever seen" would be a maximum over noisy measurements — one lucky bag crowns a
champion that can never be dethroned, because nobody is measured against that
easy seed again. Instead the champion is re-injected into the pool every
generation and therefore re-played on the current seeds, and *that* fresh number
is what challengers are compared against. Comparisons only ever happen within a
generation, where everyone faced the same pieces.

Each brain also plays 2 games per generation and is scored `0.6 × mean +
0.4 × worst`, so a brain that only works on a friendly bag does not survive.

---

## How good does it actually get?

On 60 piece sequences it never trained on, against untrained brains played on
those same sequences:

| | untrained | evolved champion |
|---|---|---|
| pieces placed per game | 19.6 | **39.7** |
| lines per game | 0.03 | **1.33** |
| new holes buried per piece | 3.10 | **1.29** |
| guideline score | 192 | **723** |

Generation 4,558. 2× the survival, ~45× the lines, well under half the cells
buried, and a best game of 5 lines. It is still not a good Tetris player — a competent human clears
hundreds of lines — but it is unambiguously *playing*: it keeps the stack flat
because flat stacks survive, and it finishes rows on purpose.

**How it got there is the interesting part, because the obvious route failed.**
The previous champion sat at 25.7 pieces / 0.13 lines and a 3,000-generation run
flatlined after about 150 generations: mean fitness 64 → 70, pieces 23.8 → 24.8
over the following 2,800 generations. More generations bought nothing. What
actually moved it was **taking inputs away** — the same GA, the same reward, the
same 64→32 network, reading 191 numbers instead of 391, was still finding new
champions in its final 400 generations (209 of them) after four hours. The old run
was not short of time; it was searching a space with 200 dimensions in it that it
could not use.

The last hour of that run is worth reading as a warning about what late
generations buy: 1,784 further generations moved pieces 39.4 → 39.7 and lines
1.38 → 1.33 (a tie), and the only real gain was in stacking cleanliness —
1.47 → 1.29 holes buried per piece. Late training polishes; it does not
re-architect.

Worth knowing about the shape of the difficulty: once the stack is tall the
piece has almost no free fall left, so there is barely any time to steer it
sideways. All the room to manoeuvre is in the early, low-stack part of a game —
which means hole avoidance early is what buys the ability to play at all later.

## Two exploits, found by watching it play

Both were spotted the same way: the champion did something odd on screen, and the
odd thing turned out to be paying.

**A piece would vanish mid-fall.** `probe_vanish.js` counted every way that can
happen over 40 champion games — and found 1,280 hold swaps, 32 per game against
40 placed pieces. Hold is legal, but pressing it on four pieces in five is a
compulsion, so the question is what was buying it. `maxTicksPerPiece` is the only
thing stopping a brain dithering forever, it counts `pieceTicks`, and `_spawn()`
reset that counter — so **every hold handed out a fresh anti-dithering budget for
the same placement**. Unplugging the key entirely scored *better* than pressing
it (held-out skill 83.7 against 73.0, 94 ticks per piece against 124): evolution
had found a way to buy time and was then wasting the time it bought. The budget
now belongs to the placement and carries across the swap. Hold stays a legal move.

**And a piece could lock as three blocks.** `_lock()` writes only cells with
`y >= 0`, while `_collides()` allowed `y < 0` — SRS kick tables contain −2 offsets
and there are only two buffer rows above the field. A piece kicked into the
ceiling silently lost the cells above row 0. Rare (0.1 cells per game) but it is
mass disappearing from the game, and a piece that partly deletes itself buries
fewer holes than one that lands honestly. The ceiling is now out of bounds like a
wall. The test that would have caught it is a one-liner nobody had written:

> every lock adds exactly 4 cells to the board, minus 10 per row it clears

## Activations: tanh was inherited, not measured

`tanh` hidden + `sigmoid` out came from habit. Measured on the same encoding,
same shape, same budget, only the nonlinearity differing:

| activation | 64‑32 | 64‑48‑24 |
|---|---|---|
| **ReLU** | **39.8** | **43.3** |
| ELU | 37.8 | |
| leaky ReLU | 35.9 | |
| tanh | 31.9 | 24.8 |
| softsign | 28.4 | |
| tanh + tanh head | 28.2 | |

ReLU beats tanh by 25% at identical shape, and the interaction is the interesting
part: **with tanh a third layer hurts, with ReLU it is the best thing in the
search.** The standard objection to ReLU — dead units have zero gradient forever —
simply does not apply to a GA, because there is no gradient: any mutation that
lifts a unit's bias revives it. What ReLU risked here instead was unbounded
activation drift saturating the output; that never materialised, and both bounded
challengers (softsign, tanh head) lost. The output stays sigmoid, with the press
threshold following the activation (`sigmoid` > 0.5, `tanh` > 0).

## Deciding the encoding and the architecture by measurement — `search.js`

```sh
node search.js --only base,nogrid,convcolmax --gens 140 --pop 44 --out training/s.json
node overnight.js --train-until <epoch-ms>        # the whole pipeline, unattended
```

19 named configs, each a complete answer to "what does a brain look like and what
is it paid for". Every config gets the same generation budget from the same GA
seeds, and the ranking is held-out **skill** (`pieces + 25 × lines` on 24 unseen
sequences) — reward-independent, because configs that redefine the reward cannot
be ranked on fitness.

What one night of this found, at 140 generations (broad) and 300 (runoff):

| finding | evidence |
|---|---|
| **Trimming the input vector beats every architecture change.** | Every config that cut the 391 inputs beat every config that kept them: `nowindow` 32.9, `nogrid` 32.0, `compact` (111 inputs) 31.6 — against 21–25 for the 391-input variants. The relative surface window is a lossy copy of the board plane; it costs search dimensions and earns nothing. |
| **A one-rep win is not a finding.** | `deep` (64‑48‑24) topped the broad round at 35.0 and collapsed to 24.9 in the runoff on a different seed. That is why there is a runoff. |
| **Convolutions only pay when they squeeze.** | `convcolmax` — 12 3×3 filters, column-max pooled to 96 features, **10,975 weights** — scored 30.4, matching the best dense encodings at a third of the size. Every variant that flattened a large feature map into the dense head (`conv3x8`, `convbig` at 45,863) scored 21–23, at or below baseline: the convolution saves parameters and the flatten hands them all back. |
| **Cheaper line clears help early, and then don't.** | `nogrid_lines_lo` (a clear worth ~7 placed pieces instead of ~30) topped the 140-generation field at 33.4 and was still climbing. Over a four-hour run it lost to plain `nogrid` on *both* metrics — 0.95 lines against 1.38, and 1.72 cells buried per piece against 1.47. A short-budget win is a hypothesis. |

Cost, for planning the next one: ~20 minutes per config at 140 generations, pop 44,
3 worker threads. Budget accordingly — the first attempt at this skipped 8 of 17
configs because the estimate was 2.5× optimistic.

## Deciding what to try next, forever — `genius.js`

```sh
node genius.js --cells 6 --spawn 2 --era 30 --workers 5 --seed training/grid_best.json
node dashboard.js --port 8899 --dir training/genius     # live view
```

Every search above has the same shape: pick a set of things to compare, run them
all, read the ranking. That is fine for a question with a fixed answer. It is the
wrong shape for this one, because **the right answer moves**. The mutation step
that improves a 150-skill brain is not the one that improves it at 200, and a
fixed grid spends most of its CPU running settings it already knows are losing —
the 15-cell hyperparameter grid had a 29-point spread between best and worst cell
within the first hour, and then kept paying for the worst one for three more.

`genius.js` makes the experiment itself evolve. Every era (30 minutes):

1. **judge** — every live cell's champion, and the reigning best-ever brain, are
   replayed on one bank of games none of them has seen. The bank is *different
   every era*, so nothing can be fitted to it.
2. **cull** — the worst `--spawn` cells are stopped.
3. **promote** — if a cell beat the record, it is replayed against the incumbent
   on a second, larger bank. Only a brain that wins twice, on two banks it has
   never seen, takes the record. Nothing else can displace it.
4. **spawn** — the same number of new cells, all seeded from the record brain,
   each trying something no cell has tried before.

Two things make this more than a restart loop.

**The record cannot go backwards.** The best brain lives in a file, judged fresh
every era against every challenger. A cell being retired therefore costs nothing:
whatever it discovered is either in the record already or was not worth keeping.

**A new body can inherit an old brain — `net_surgery.js`.** Architecture search
used to mean training each shape from random weights, which answers "how fast does
this shape learn from nothing" when the question is "would the brain I already
have be better with an extra layer". So the surgery transplants instead:

| operation | what happens to the weights | exact? |
|---|---|---|
| widen a hidden layer | new units get random incoming weights and **zero outgoing** ones — they say something, nobody listens yet | **yes**, bit-for-bit |
| insert a layer | inserted as an identity map | **yes** under ReLU (`relu(x) = x` on the non-negative output of the layer it copies) |
| narrow a hidden layer | units ranked by the L2 norm of their outgoing weights; the quietest are dropped | no — but a unit nothing listens to costs nothing |
| drop a layer | the two weight matrices around it are multiplied together | no — exact only if the activation between them were the identity |
| swap the activation | nothing moves at all | no (same weights, different function) |

The exact cases matter more than they look: a transplanted cell that starts at
*precisely* the record's score is measured on what the new shape does next, not on
a hole it has to climb out of first. `test_headless.js` asserts the exactness
numerically — widening and identity-insertion come back with a worst-case output
difference of `0.0e+0` across random inputs, and the approximate operations are
required to *say* they are approximate.

**Which knob to turn next is itself learned.** Variants come from five families —
mutation regime, population size and trials, island structure, behavioural fitness
sharing, and architecture. Each family keeps a record of how often its cells
survived the first cull they faced, and the next family is drawn by Thompson
sampling from those records: a family that has been paying gets more slots, and a
family that has not still gets drawn occasionally, because a Beta posterior never
quite reaches zero. Cells are credited exactly once, at their first cull, so one
long-lived survivor cannot push its family past 100%.

One deliberate exception to pure ranking: a cell in its first era that gained more
than the median may be spared once. Surgery and large population changes both cost
something up front, and judging them on their first era would retire every
one of them before it paid off. At most `--protect` cells per era are spared, and a spared
cell is not credited to its family — otherwise the statistic would be measuring
the protection rule rather than the variant.

**Once in a while, the opposite move — the deep dive.** Six cells is six bets, each
running on a sixth of the machine. Every `--deep-every` generations of progress (and
no more often than `--deep-gap` minutes) the controller stops spreading and starts
concentrating: it picks the cell that is currently leading, suspends every cell with
`SIGSTOP`, and runs that one lineage on *every* thread for `--deep-min` minutes,
using its own hyperparameters, from its own champion.

```sh
node genius.js --cells 6 --spawn 2 --workers 5 --era 30 \
               --deep-every 200 --deep-gap 40 --deep-min 15 --deep-workers 30
```

The suspension is what makes it cheap. `SIGSTOP` takes a trainer off the CPU with
its whole population still in memory and `SIGCONT` puts it back mid-generation, so
the five paused cells lose fifteen minutes and nothing else — killing and restarting
them would reduce each to its champion and throw away the diversity the wide search
exists to maintain. The dive then wins the record the ordinary way or not at all:
on a bank drawn *after* it finished, and then on a second, larger confirmation
against the incumbent. If it loses, everything thaws and the era carries on as if it
had not happened; the era boundary is pushed out by exactly the time taken, so the
paused cells are never judged on training they did not get.

The generation counter alone is not enough to pace this. At roughly twenty
generations a minute per cell, 200 generations arrives every ten minutes, and a
fifteen-minute dive every ten minutes is not an occasional deep search — it is the
whole schedule. Hence the two conditions: enough progress *and* enough clock.

Still a GA and only a GA. The meta-loop chooses which GA runs next; the surgery
only ever copies weights that a GA produced; no gradient touches anything.

## Deciding the GA by measurement — `ab_test.js`

Most of the settings above were chosen by running them against each other rather
than by taste:

```sh
node ab_test.js --gens 110 --pop 40 --reps 2
node ab_test.js --only base,net64x32,share1.5
```

Each variant runs the same generation budget from the same seeds, and then its
champion is replayed on **sixteen held-out piece sequences it never trained on**.
That last part is the whole point: training fitness is the quantity the GA is
optimising, so ranking on it rewards memorising the two sequences the population
happened to be scored against. The gap is not subtle — the 40→20 network reached
a *higher* training fitness than the 64→32 one and less than half its held-out
score.

Variants that change the reward cannot be ranked on fitness at all, since that is
the thing they redefine, so the ranking uses a fixed yardstick instead:
`pieces + 25 × lines` on held-out games.

Two honest caveats. Two reps is not many, and run-to-run variance is real — one
round's baseline scored 83 where the previous round's equivalent scored 117, so
only *within-round* comparisons mean anything and gaps under about 30% are noise.
And every result here is at 110 generations; something that helps early could
still lose over a long run.

## Training offline

The page trains fine on its own (tick **Turbo**), but the built-in champion came
from the multi-core trainer:

```sh
node train_headless.js                          # every core, runs until stopped
node train_headless.js --config nogrid --pop 72 --workers 12
node train_headless.js --until 1785384900459    # hard wall-clock stop (epoch ms)
node train_headless.js --resume training/champion.json
node bake_brain.js                              # champion.json -> default_brain.js
node test_headless.js                           # engine / sensor / reward / GA checks
```

A brain's **sensor profile and architecture travel with it**. Weights against the
wrong input layout do not degrade gracefully, they read garbage — so the config
goes into `champion.json` and on into `default_brain.js`, and the page re-applies
it *before* building its first population. `--resume` refuses a brain whose
contract (`191-64-32-7`, or `conv[301:c3x12+colmax→96+101→48-24→7]`) does not match
the run's.

`training/champion.json` is rewritten every time the champion improves, and
`training/log.csv` gets a row per generation, so a run can be killed and picked
up later. `bake_brain.js` re-plays the brain on seeds training never saw and puts
that validation score — not the training score — in the header of the file it
writes.

---

## Controls worth knowing

* **Evolved vs untrained** — the built-in champion and a brain that never
  evolved, side by side on the *identical* piece sequence. The clearest answer to
  "did it actually learn anything, or does Tetris just look like that?"
* **Turbo** — stops all drawing and pours every millisecond into generations.
* **Games per brain** — 1 is much faster and much more easily fooled.
* **Piece limit** — caps a game so one good brain cannot stall a generation.
* **Showcase** — the champion alone, full size.
* `#evolve`, `#watch`, `#compare`, `#play` in the URL skip the intro.
