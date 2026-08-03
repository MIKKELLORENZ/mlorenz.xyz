# The recipe

What actually produced the controller the page ships: the pipeline in the order
it runs, every input the network sees and why it is there, every hyperparameter
and why it has the value it has.

This is the working recipe, not a history. The failures are kept in the README
under *Things that were wrong on the way here* — worth reading, because several
of the constants below look arbitrary until you know what they are protecting
against, and the ones that matter are cross-referenced from here.

---

## 1. The champion

| | |
|---|---|
| File | `default_brain.js` (committed; the page loads it directly) |
| Shape | `219 – 64 – 48 – 19`, 18,131 weights, tanh throughout |
| Weights SHA-1 | `a6c48d247ddc` (first 12, weights rounded to 4dp) |
| Generation | 400 |
| Held-out exam | **0.717** (8 seeds/task, spread across all six difficulty rungs) |
| Mutation scales | `[0.166, 0.193, 0.175]` — calibrated from the weights, not the init |

```bash
node -e "const fs=require('fs'),c=require('crypto');const s=fs.readFileSync('default_brain.js','utf8');
const b=JSON.parse(s.slice(s.indexOf('{'),s.lastIndexOf('}')+1));
console.log(c.createHash('sha1').update(JSON.stringify(b.net.weights.map(a=>a.map(v=>+v.toFixed(4))))).digest('hex').slice(0,12))"
# expect a6c48d247ddc
```

`training/` is scratch space and is not committed — the tools recreate it. Every
Node tool here reads `default_brain.js` by default, so a fresh clone works with
no training directory at all.

---

## 2. The pipeline

Four commands. About three hours end to end on a 20-thread i7-12700H.

```bash
# 0. measure the input normalisation from the machine itself     (~1 min)
node calibrate.js                                         # → obs_norm.js

# 1. clone the PID baseline into the network by DAgger          (~20 min)
node imitate.js --rounds 5 --seeds 12 --epochs 40 --workers 18   # → training/bc.json

# 2. evolve it against the actual reward                        (~2.5 h)
node train.js --resume training/bc.json --pop 80 --episodes 6 \
              --workers 14 --stage 2 --mutrate 0.06 --mutsigma 0.12

# 3. bake the champion into the page
node train.js --bake training/checkpoint.json              # → default_brain.js
```

**Why two stages.** Evolution from random weights spent three runs rediscovering,
badly, something this repository already contains: `pid.js` holds all seven short
tasks at 0.8–4.2 cm. The from-scratch GA reached 40% survival and 11.3 cm and was
never close. Stage 1 is a *regression* — cloning a known teacher — so it uses
gradients, and pretending otherwise throws away a hundredfold speed-up for
nothing. Stage 2 optimises the thing actually being asked for, which is where the
tasks the teacher is **bad** at get fixed.

This head start is the single largest reason the project cleared its bar, and it
is the largest asterisk on the result. "Learned" here means *improved on a known
controller*, not *discovered control from nothing*.

**Why DAgger rather than plain cloning.** Train only on the expert's own
trajectories and the clone is excellent where the expert goes and lost
everywhere else — and its own small errors take it off the expert's distribution
within a few milliseconds, so "everywhere else" is where it spends the episode.
After round one the *rollouts* come from the student and the *labels* from the
teacher: the PID is stepped alongside the student's plasma, integrators and all,
and asked what it would have done in the state the student actually reached.

Two limits worth knowing before you tune it:

- The clone cannot inherit everything. The PID's three integrators and its 2 kHz
  outer-loop phase are internal state no observation carries, so the loss floor
  is not zero. That is part of why the temporal block in §3.3 exists.
- **More teacher data is only better where the teacher is good.** Each extra
  DAgger round made the clone *worse* at `vtrack`: 5.96 → 7.76 → 8.75 cm. And
  `vtrack` is exactly where the finished controller's margin is largest — 2.75 cm
  against the PID's 6.31. Do not pick the DAgger round with the lowest overall
  loss without checking the per-task breakdown.

---

## 3. Every input, and why

219 neurons in three groups. The first two are the published TCV-style interface;
the third is the one this project had to add, and adding it is what took the
controller past the baseline.

### 3.1 Measured — 93 neurons

All noisy, all one control step stale. This is everything a real magnetic
diagnostic set gives you.

| n | input | why it is there |
|---|---|---|
| 34 | poloidal flux loops, ψ on the outer wall | The slow, global picture of where the current is. Screened by the vessel, so on its own it is always a few milliseconds out of date — fine for shape, useless for the fast mode. |
| 38 | magnetic field probes, B_pol just inside the wall | Barely screened, so this is the only fast position signal. **Vertical stabilisation lives here.** |
| 18 | shaping + ohmic coil currents | The agent commands *voltage*, not current. Without this it cannot know what its own actuators are currently doing, and an L/R of 25–100 ms means the answer is mostly "still catching up with what you asked ten steps ago". |
| 1 | fast in-vessel coil current | Separate from the other 18 because its dynamics are 100× faster; folding it into the same normalisation would bury it. |
| 1 | ohmic current difference, I(OH1) − I(OH2) | Sets the stray radial field. It is a difference of two large, nearly equal numbers, so the network would have to learn to subtract two saturated channels to recover it. Cheaper to hand it over. |
| 1 | plasma current, Rogowski | The one quantity a tokamak always measures. |

### 3.2 Task context — 56 neurons

The plant tells you where you *are*; these say where you are meant to be, and
what you just did about it.

| n | input | why it is there |
|---|---|---|
| 19 | previous action | Coils lag. Without this the agent is blind to its own recent decisions and re-issues corrections that are already in flight — the classic way to build an oscillator out of a stable plant. |
| 32 | target boundary, 16 (R, Z) points | The requested last closed flux surface, in the same coordinates the reward measures error in. The reward is RMS distance between these 16 points and the plasma's own 16, so this is *literally* the objective handed to the network. |
| 4 | target scalars: I_p, axis R, axis Z, κ | Redundant with the boundary by design, so either can be ablated. A scalar target is much easier to learn a proportional response to than 32 coordinates. |
| 1 | discharge phase, t/duration ∈ [0,1] | Lets one policy span form → hold → morph → ramp-down. Without it, a controller cannot know that the current ramp it is fighting is scheduled rather than a disturbance. |

### 3.3 Temporal — 70 neurons

**The published 149-neuron interface contains no quantity with a time
derivative.** A controller reading it cannot distinguish a plasma sitting 5 mm
high and still from one 5 mm high and falling at 8 m/s — and those need opposite
commands. Three complete training runs plateaued at about a tenth of the
baseline's score before this was understood; each time the suspect was the search
(mutation width, curriculum, selector) when the fault was that the answer was not
in the input. The PID it kept losing to has dz/dt and three integrators.

Everything here is computable on a real machine from magnetics alone.

| n | block | input | why it is there |
|---|---|---|---|
| 8 | A | observer Ẑ, R̂; errors e_Z, e_R, e_Ip; one-step rates of Ẑ, R̂, I_p | The minimum PD set. The one-step rates are the D term; without them nothing below matters. |
| 14 | B | Ẑ and R̂ differenced at lags 1, 2, 4, 8, 16, 32, 64 ticks (0.1 → 6.4 ms) | A **filter bank**, not a state estimate. The lag ladder is geometric and deliberately spans the three timescales in the plant — 0.5 ms fast coil, ~6 ms vessel, ~7 ms instability — so the network learns which differences matter instead of being told. A single differencing interval is a single filter, and the right one depends on the machine you drew this shot. |
| 3 | B | I_p differenced at 4, 16, 64 ticks | Plasma current moves two orders of magnitude slower than position, so it gets its own, longer ladder. |
| 3 | C | leaky integrals ∫e_Z, ∫e_R, ∫e_Ip, τ = 20 ms | The I term. Kills the standing offset a pure PD controller leaves against a constant disturbance — and a drifting equilibrium is exactly that. |
| 4 | D | fast-coil current, its rate, and the mean of its last 8 and last 32 commands | The last two are the honest "am I running out of authority" signal. The coil is ±0.1 kV against the shaping coils' ±1.4 kV; a controller that has been holding it near saturation for 3 ms is about to lose the plasma and nothing else in the observation says so. This is how the 1.2 s discharge is survived. |
| 38 | E | all 38 field probes differenced against 0.8 ms ago (dB/dt) | **The single most valuable block, and the reason the controller is robust.** Vessel eddy currents are unmeasured hidden state, and their signature lives in dB/dt. This is what lets the network tell *what kind of machine it is on this shot* — a PID gain cannot, which is why the PID degrades 3.9× across the difficulty ladder and this degrades 1.3×. `PROBE_LAG = 8` is the one hand-placed constant, set on the vessel time constant. |

### 3.4 Normalisation, and two implementation traps

Per-channel mean and standard deviation are **measured**, by `calibrate.js`, and
written to `obs_norm.js` — one block for the 93 measured neurons, one (`ext`) for
the 70 temporal ones. The block constants in `tokamak.js` only get channels to
the right order of magnitude; they still leave a large DC offset with the control
signal riding on it at a tenth of the amplitude, which is what a mutation-driven
search is worst at. The useful amplitude of a 0.1 ms difference and a 6.4 ms one
differ by two orders of magnitude, and no hand-picked constant gets both right.

- **One monotonic frame counter, not one cursor per ring.** The 65-slot history
  and the 9-slot probe history have different wrap points, and separate cursors
  desynchronise at the wrap — silently, and only for a few steps at a time.
  `histK` counts up forever and every ring indexes `histK % len`.
- **`reset()` primes every lag with the t = 0 state**, and starts the counter at
  `100 × HIST_LEN` so an index can never go negative. Without the priming the
  first control step reads a 0.88 m radial jump out of an empty buffer and
  commands accordingly; the episode is decided before it starts.

### 3.5 The observer is shared

Both the PID and the network read the same ridge-regression `MagneticObserver`,
fitted from machine geometry. This is a fairness rule, not a convenience: if the
baseline and the challenger estimate position differently, the comparison
measures observers rather than controllers.

---

## 4. The reward

Per control step, on the plasma's own boundary error:

```js
r = 1.0
  - 3.2 · (boundaryErr / 0.08)²      // RMS distance, 16 boundary points — the objective
  - 0.8 · (ΔI_p / 50 kA)²
  - 0.9 · (ΔR  / 0.08 m)²
  - 1.6 · (ΔZ  / 0.06 m)²            // vertical: 1.8× the weight and a tighter normaliser
  - 0.05 · mean(action²)             // effort
  - 0.6 · limitPressure              // proximity to an operational limit
r = max(r, -4)                       // FLOOR — load-bearing, see below
```

Fitness is mean reward per control step × 100, so a clean episode reads near +70
and a disruption a quarter of the way in near −110.

**Vertical is weighted 1.8× radial**, with a tighter normaliser (6 cm vs 8 cm),
because the vertical axis is the unstable one: being off-centre vertically is a
precursor to a disruption, being off-centre radially usually is not.

**The floor at −4 is not cosmetic.** Without it a plasma 30 cm off target scores
−20 per step, which is far worse than the cost of disrupting — so the
highest-scoring strategy available to a young population is to kill the plasma
immediately and stop the clock, and a population finds that within two
generations. Every reward that terminates on failure needs this check.

**`World.DEAD_STEP_COST = 8.0`, not 4.5.** A dead plasma keeps being charged for
every remaining step of the episode, and that charge must be strictly worse than
the worst thing a live plasma can score. At 4.5 the gap between "alive and
hopeless" (−4) and "dead" (−4.5) was half a point, and the first trained brain
came out with *worse* survival than doing nothing — 40% vs 51% — while scoring
better on shape error. It had found the trade the reward was quietly offering:
command more voltage, hold a better boundary while you live, die sooner.
Doubling the gap removes the trade.

**Per-stage normalisation.** Each episode's contribution is
`sqrt(fitness / stageScale)`, scales 55 / 45 / 40. The square root gives
diminishing returns, so going from 0 to 1 on the task you are bad at is worth
more than going from 4 to 5 on the one you already hold perfectly — the
preference a generalist objective should have. Ordering *within* a task is
untouched, and negative scores pass through unchanged rather than being
square-rooted into NaN.

---

## 5. Hyperparameters

### Stage 1 — imitation (`imitate.js`)

| flag | value | why |
|---|---|---|
| `--rounds` | 5 | DAgger rounds. Round 1 is the expert's own trajectories; every round after that relabels the student's. |
| `--seeds` | 12 | Rollout seeds per task per round. 5 × 12 × 7 tasks ≈ 259k state-action pairs. |
| `--epochs` | 40 | Adam passes over the pool per round, cosine-decayed. |
| `--batch` | 2048 | Split across workers; each returns a summed gradient, the main thread does the Adam step. |
| `--lr` | 3e-3 | Cosine to zero within each round. The pool changes between rounds, so the schedule restarts. |
| `ACT_WEIGHT` | output 18, ×4 loss | The fast coil is one output of nineteen and the only one that can lose the plasma in a millisecond. Weighting it equally means it is 5% of the loss. |

### Stage 2 — evolution (`train.js`)

| flag | value | why |
|---|---|---|
| `--pop` | 80 | With 6 episodes/generation on 14 workers this keeps every worker holding several whole brains, so the per-generation barrier is amortised. |
| `--episodes` | 6 | Enough that the task rotation covers the registry within two generations; fewer and brains are ranked on a sample too small to mean anything. |
| `--stage 2` | full registry | The clone can already fly everything, so the task curriculum has nothing to teach it. **From random weights, leave this off** — see §7. |
| `--mutrate` | 0.06 | Fraction of weights touched per child. |
| `--mutsigma` | **0.12** | An order of magnitude below the 0.35 used from a random start. σ is relative to each layer's own weight scale, and a gradient-trained brain has an output layer ~43× wider than its init — see §6. |
| `--grace` | 3 | Generations a beaten champion keeps an untouched seat. |
| `--seedblock` | 2 | Consecutive generations sharing one draw of task perturbation and machine randomisation. |
| `--workers` | 14 | Deliberately below core count. **On a shared machine always pass this** — a trainer that saturates a box gets itself killed. |
| `--promote` | 0.85 | Exam score on the top rung that earns a difficulty promotion. |
| `--anchor` | 0.85 | Exam score on rung 0 that must *still hold* when it does. |
| `--promotehold` | 3 | Consecutive checks both thresholds must be met. |
| `--maxlevel` | 5 | Top of the difficulty ladder. |

Fixed in code rather than flagged:

| constant | value | where | why |
|---|---|---|---|
| elites | 4 | `evolution.js` | Rank 0 is always an unmutated copy of the best. |
| mutated elites | 8 | | On a σ ladder — see §6. |
| elite crossover | 8 | from a top-6 pool | |
| immigrants | ≤ 2 | | Tapered to zero as fitness climbs. |
| `immZeroFit` | 1.0 | | Past this, fresh random brains are a wasted slot. |
| `childZeroFit` | 1.6 | | Past this, crossover is replaced by mutation of a top-6 parent. |
| exam seeds | 4 (8 for the checkpoint gate) | `train.js` | Per task, fixed, never trained on. |
| `CANDIDATES` | 3 | `train.js` | How many brains per generation get examined. |
| exam scale | 40 | `train.js` | Fixed, so exam numbers are comparable across stages. |

---

## 6. Mutation and breeding

### σ is relative, and the scale is re-measured

The single most consequential GA detail here, and it bit twice for two different
reasons.

```js
mutate(rate, sigma, rng) {
    const s     = sigma * this.scales[l];   // per layer
    const reset = 3     * this.scales[l];
    // per weight, with probability `rate`:
    //   3%  → full reset to N(0, reset)
    //   97% → w += N(0, s)
}
```

The rare full reset is there so a weight that has been driven somewhere useless
can leave in one step rather than random-walking back.

**Trap one — absolute σ.** The output layer starts at `0.02·√(2/n) ≈ 0.004`. An
absolute σ of 0.12, perfectly ordinary elsewhere, moves an output weight ~30×
its own initial size. tanh saturates, the coil sees ±1.4 kV continuously, the
plasma is on the wall inside a millisecond. Measured: generation 1 survived 88%
of its episodes, generation 10 survived 35%, and it never recovered. Selection
was not failing — mutation was destroying brains faster than selection could keep
one.

**Trap two — a scale the weights have long left behind.** Relative σ is right
from a random start and *wrong* for a brain that arrived by gradient descent. The
imitation stage trains the output layer from a 0.004 init spread up to an RMS of
0.175 — **43× wider** — and `mutate` would go on stepping by a fraction of 0.004,
which against those weights is not a mutation but a rounding error. The
population looks converged from generation one and the GA stage becomes an
expensive way to keep the brain it started with.

```js
calibrateScales()   // RMS of the weights actually held, floored at 5% of init
```

The floor stops a nearly-dead layer freezing itself out of the search
permanently. `clone()` had to be taught to carry scales too — invisible while
every net came from the same init, and a hundredfold under-mutation the moment
they didn't.

### A ladder of step sizes, not one

```js
const SIGMA_LADDER = [0.15, 0.35, 0.7, 1.4];   // multiplies mutSigma
```

With ~18k weights a single mutation size is a bad bet: one large enough to escape
a local optimum is far too large to refine a champion, and vice versa. Each of
the 8 mutated-elite children draws a different rung, so some probe the
neighbourhood and some probe the region, and selection decides which was the
right question. Before this, the population mean sat flat at −4.5 for 375
generations while the best oscillated — every child of an elite was effectively a
fresh draw rather than a refinement.

### Row-wise crossover

Whole neurons swap — a row of incoming weights plus its bias — never individual
scalars.

```
r < 0.45  → take the row from parent B
r < 0.52  → average the two rows
otherwise → keep parent A's row
```

Swapping individual weights scrambles what a neuron computes; swapping neurons
keeps functional units intact. That matters more here than usual: with 93 partly
redundant magnetic inputs, a hidden neuron really is a learned linear combination
of probes — *a moment of the field* — and it is worth keeping whole.

### Generation composition (pop 80)

| slots | who | mutation |
|---|---|---|
| 4 | elites, byte-for-byte; rank 0 always the unmutated best | none |
| 8 | mutated elite copies | σ × SIGMA_LADDER rung |
| 8 | elite × elite crossover, top-6 pool | rate × 0.5, σ × 0.7 |
| rest | rank-weighted parents, crossover + mutation | rate and σ **grow down the ranks** |
| ≤ 2 | fresh random immigrants | — |

Parent rank is drawn as `pow(rng(), 2.2)` over the better 55% of the roster, so
selection is strongly but not absolutely elitist. The `0.8 + depth` and
`0.8 + 1.6·depth` ramps make the bottom of each generation a deliberately wild
fringe — which is also why the population **mean is a useless health metric
here**: it sits near −5 in every run log because half the roster is designed
wreckage. Judge a run by the best line and the exam, never the mean.

### Champion grace

A controller lives or dies on six noisy episodes, and one unlucky draw of the
domain randomisation — a slow wall and a weak fast coil — kills a genuinely good
brain. The reigning champion keeps an untouched seat for 3 generations after
being beaten. It costs one slot and it is the difference between a run that
converges and one that throws away its best controller on a bad roll of the dice.

### Weight init

He scaling everywhere except the output layer, scaled by **0.02**. Outputs are
tanh rather than sigmoid because a coil voltage is bipolar and zero is the
meaningful neutral: the episode starts from a solved equilibrium, so "command
nothing" leaves the currents where they are and the plasma drifts only as fast as
its own instability. A near-zero output layer therefore means a brand-new brain
does not slam nineteen supplies to ±1.4 kV and disrupt in the first millisecond —
every fresh brain survives long enough to be told apart from every other fresh
brain, which is the only thing generation 1 has to achieve.

---

## 7. Selection and curriculum

Three things here stop the GA fooling itself, and each of them was, at some
point, the reason a run went nowhere.

### Common random numbers

Every plasma in a generation gets the same task, the same target trajectory, the
same initial coil currents **including the same random starting error**, the same
domain-randomisation draw and the same sensor-noise stream. All of that follows
from giving every `Tokamak` an RNG with the same seed and making sure they
consume it in the same order. **The only difference between two members of a
generation is their brain.** Without this, ranking measures luck.

`seedBlock = 2` extends the idea across time: two consecutive generations share
one draw of the perturbation and the machine. With a fresh draw every generation
the score is dominated by which machine you happened to get.

### The champion is decided by a held-out exam

Never by the training score, which is measured on the very episodes the
population was selected against. Fixed seeds, every unlocked task, spread across
the unlocked difficulty rungs. The seeds being fixed makes each candidate's exam
a paired comparison — the same trick as the seed block.

Two ways this went wrong, both of which look identical from outside (the title
stops moving):

- *One episode per exam.* Generation 10 posted a lucky score and still held the
  title 45 generations later; every checkpoint the run wrote was that same brain.
  A noisy selector does not slow a search down, it stops it.
- *Examining one brain out of eighty.* `results[0]` is whoever won six noisy
  training episodes, which under a wide mutation is usually a lucky draw rather
  than a real improvement — so it fails the exam and the title never moves.
  Measured: frozen for 50 generations while the training best climbed. Now the
  top **three** are examined, batched into one pool call, so the extra costs
  ~17% rather than 3×.

### Two ratchets, both monotone, both additive

**Tasks** — `circular` → `+elongated` → `+full registry` (7 tasks). Starting at
the full registry does not work: a random brain on an elongated plasma is on the
wall in ten milliseconds, every member of the population scores the same large
negative number, and selection has nothing to rank. Promotion is on the survival
of the **better half** of the population on the newest task — judging on the
champion promotes a population containing one lucky brain, and judging on the
whole roster never promotes at all because the roster is half deliberate
wreckage. That second mistake cost 375 generations in which the curriculum never
left stage 0, so the brain it produced had never seen an unstable plasma.

**Difficulty** — six rungs, `nominal` → `savage`:

| rung | κ above round | wall τ | start error | noise | machine spread |
|---|---|---|---|---|---|
| 0 nominal | ×1.00 | ×1.00 | ×1.00 | ×1.0 | ×1.00 |
| 1 brisk | ×1.06 | ×0.94 | ×1.15 | ×1.1 | ×1.10 |
| 2 stiff | ×1.13 | ×0.88 | ×1.35 | ×1.25 | ×1.20 |
| 3 hostile | ×1.21 | ×0.80 | ×1.60 | ×1.45 | ×1.35 |
| 4 brutal | ×1.30 | ×0.72 | ×1.90 | ×1.70 | ×1.50 |
| 5 savage | ×1.40 | ×0.64 | ×2.20 | ×2.0 | ×1.70 |

Six small steps, not three big ones. The first draft raised elongation,
shortened the wall and increased both starting error and noise all at once, which
took the PID from 4.65 cm to 12.40 cm in a single step — the ratchet would have
stalled on rung one with four rungs unused.

### The anti-forgetting rule

Both ratchets share one mechanism, and it is structural rather than hopeful.
`episodePlan()` gives every generation a plan like this, for six episodes with
three rungs unlocked:

```
episode  0    1    2    3    4    5
task    new  ← cycles through everything unlocked →
level    L    0    1    2    0    1
```

Episode 0 is always the newest task on the **hardest** unlocked rung — the
frontier, where search pressure needs to point. Everything after it cycles
through every rung *including 0*, so a brain that buys skill on the savage
machine by giving up the nominal one scores **worse**, not better. Rung 0 is
never absent from a generation.

The task cycle also **starts at a rotating offset**. Without it, a generation
with fewer episodes than tasks always draws the same prefix: at stage 2 with five
episodes, `negd`, `ipramp` and `morph` were never selected on at all and the
population quietly specialised on the four tasks it could see. Ranking is
unaffected — every brain in a generation still runs the identical plan, which is
the only comparison ever made between them.

Promotion needs **both**: exam ≥ 0.85 on the top rung *and* ≥ 0.85 still holding
on rung 0, for 3 consecutive checks. Measured across the real climb, rung 0 went
**1.04 → 1.12 → 1.21 → 1.20** while difficulty rose four rungs. That is the
anti-forgetting working, and it is the number to watch if you change anything
here.

Because achievable fitness falls as the machine gets nastier, a *fixed absolute*
threshold also gives the ladder a natural stopping point: it climbs until the
brain can no longer clear the bar, then stops. That is intended, not a failure to
promote.

---

## 8. Training in the browser

No Node, no toolchain — the page trains itself. `browser_train.js` drives
`main.js`'s own generation loop rather than reimplementing one, so what runs is
the same code the animation loop runs.

```
index.html?train&gens=3000&pop=64&episodes=4
```

Open that and it trains in slices, keeping the tab responsive, logging progress
and offering a **download `default_brain.js`** button when it finishes. The file
is drop-in: replace the one in this directory and the page loads your brain.

Headless, for a machine you can leave alone:

```bash
chrome --headless=new --disable-gpu --dump-dom \
  "index.html?train&sync&intro=0&gens=3000&pop=64&episodes=4" > out.html
```

`sync` matters. `--dump-dom` fires as soon as loading finishes and Chrome's
virtual clock does not advance inside a script task, so a chunked run would be
dumped before it had done anything. With `sync` the whole run happens inside the
load handler; the title becomes `DONE gen=… exam=… bake=ready` and the baked
brain is in `<pre id="bake-out">`.

| parameter | default | |
|---|---|---|
| `gens` | 500 | generations to run |
| `pop` | 48 | population |
| `episodes` | 4 | episodes per generation |
| `mutrate` | 10 | percent |
| `mutsigma` | 35 | ×100, relative to each layer's scale |
| `grace` | 3 | champion grace generations |
| `examevery` | 10 | generations between held-out exams |
| `examseeds` | 3 | fixed seeds per task in the exam |
| `stage` | auto | lock the task curriculum to one stage |
| `maxlevel` | 5 | difficulty ceiling |
| `resume=default` | off | start from the shipped champion |
| `sync` | off | one blocking run, for `--dump-dom` |

**Set expectations honestly.** There is no imitation stage in the browser — that
needs gradients across a worker pool — so a browser run starts from random
weights and has to discover from scratch what the Node run was handed. It is also
single-threaded. Measured here at pop 12 / 2 episodes: **≈0.25 generations per
second**, and it gets slower as brains survive longer, which is the whole point.
Expect thousands of generations, and expect a plateau below the shipped brain.

Two things it does keep, because without them a long run is wasted: the champion
is chosen by the same **held-out exam** (top 3 candidates, fixed seeds, spread
across rungs), and the same **difficulty ratchet with the rung-0 anchor** runs —
gated to the final task stage, since at stage 0 the exam is a single task and has
no episode on the upper rungs to promote on.

If what you want is to push the shipped controller further rather than watch one
start from nothing:

```
index.html?train&gens=2000&resume=default&mutsigma=12&stage=2
```

That seeds the whole population from the champion and lets mutation spread it
back out — the browser equivalent of `train.js --resume`. Note `mutsigma=12`,
for the reason in §6. The ladder restarts at rung 0 (the baked file does not
record the rung it reached) but a good brain re-climbs it quickly.

---

## 9. What the recipe produces

`node compare.js --episodes 12` — 96 episodes per controller on seeds none of
them trained on, nominal machine, noise and domain randomisation on:

| task | do nothing | PID baseline | **learned** |
|---|---|---|---|
| hold circular | 8.54 cm, 42% dis | **1.13 cm** | 1.84 cm |
| hold elongated | 18.56 cm, 100% | **2.08 cm** | 2.25 cm |
| track vertical | 15.42 cm, 92% | 6.31 cm | **2.75 cm** |
| morph shape | 13.70 cm, 100% | 2.68 cm | **2.31 cm** |
| negative triangularity | 13.67 cm, 100% | 3.73 cm | **2.83 cm** |
| current ramp | 12.39 cm, 100% | **3.31 cm** | 3.36 cm |
| radial excursion | 14.12 cm, 92% | 3.26 cm | **3.15 cm** |
| **1.2 s discharge** | 6% survived | 64% surv, **100% disrupt** | **76% surv, 33% disrupt** |
| **ALL** | 51%, 12.95 cm, 91% dis | 95%, 3.22 cm, 13% | **97%, 3.06 cm, 4%** |

But the nominal machine is the least interesting comparison — the PID was *tuned*
on it. `node compare.js --episodes 8 --sweep`:

| rung | PID error | **learned error** | PID disrupts | **learned disrupts** |
|---|---|---|---|---|
| L0 nominal | 3.32 cm | **3.03 cm** | 13% | **3%** |
| L1 brisk | 3.89 cm | **3.13 cm** | 13% | **6%** |
| L2 stiff | 5.56 cm | **3.31 cm** | 14% | **5%** |
| L3 hostile | 7.27 cm | **3.42 cm** | 23% | **8%** |
| L4 brutal | 10.04 cm | **3.66 cm** | 27% | **8%** |
| L5 savage | 12.99 cm | **3.99 cm** | 44% | **11%** |

**The PID degrades 3.9× across the ladder; the learned controller degrades 1.3×.**
That is what the recipe is for. A PID gain is a number chosen for one wall time
constant and one elongation; when the vessel gets more resistive the loop it
belongs to is simply mistuned and nothing in the cascade notices. The network
reads the probe array's dB/dt and can tell what kind of machine it is on.

Read the caveats with it. The PID still wins `circular` and `elongated` on the
nominal machine. The controller had a large head start (§2). It plateaued —
generation 400's exam held to 450 with no challenger, and its L5 exam is 0.112
against 0.988 on L0, so the savage rung is where the remaining headroom is. And
every number here comes out of one crude model: read
[PHYSICS.md](PHYSICS.md) before drawing any conclusion from it.

```bash
node test_headless.js     # physics calibration + smoke tests, ~90 assertions
```
