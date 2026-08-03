# Holding the Plasma — tokamak magnetic control by neuroevolution

A ring of ionised gas at 150 kA, held in mid-air by nineteen magnets, and violently
unstable: squash it into an oval and it falls out of the machine in about six
milliseconds. Nineteen coil voltages fight it. The controller sees only what a real
machine sees — seventy-two noisy magnetic probes, one control step stale — and it
learns by mutation and selection, with **no gradients anywhere**.

This is a pedagogical reconstruction of the *control problem* from Degrave et al.,
*Magnetic control of tokamak plasmas through deep reinforcement learning*, Nature
602 (2022), which used TCV. It is not a reproduction of their physics, their
controller architecture, or their results. [PHYSICS.md](PHYSICS.md) is a long,
specific list of everything this model gets wrong, and it is the most important
file here.

Open `index.html`. No build step, no dependencies.

**"Watch the trained champion"** puts it in *exhibition mode*: one trained
controller, the PID baseline flying the identical shot beside it, the whole task
registry once through, and a scoreboard. No population, no training controls,
nothing on screen that exists to steer a search. `L0`–`L5` in the top bar turn
the machine nastier — see *The difficulty ladder* below, and expect the gap to
open up as you climb.

The twenty-four plasmas you see in the lab are **not** physics. They are
twenty-four different brains being ranked against each other, which is an
artefact of the search; there is exactly one controller worth watching once the
search is over.

**Menu** in the top bar reopens the opening screen at any time, which is how you
move between the exhibition, the PID baseline on its own, and a fresh
evolutionary run. The side panels in the exhibition are written for someone who
has never seen a tokamak; the lab's are not.

Beside the animation, *Mikkel's AI vs Generic PID* plots both controllers'
distance from the requested shape as the shot runs, with the gap between them
shaded in the colour of whoever is ahead at that instant. Two overlapping lines
are a puzzle; a band that is amber for most of its length answers "which one
tends to be better" without the viewer reading either axis. Samples where a
plasma has already been lost are excluded from the band, the axis scaling and
the percentage — a dead controller's reported error is the frozen outline of
something already on the wall, and letting it count meant one early disruption
decided a statistic meant to describe the whole window (it read 41% against a
scoreboard saying 4–4). Lost plasmas are counted on the scoreboard instead.

---

## The problem, in one paragraph

A tokamak plasma is a current-carrying ring. Left alone it expands (hoop force), so
it needs a vertical magnetic field to hold it in. To make the plasma *elongated* —
which is what you want, because elongated plasmas confine better — that field has
to have a negative decay index. But a negative decay index is also precisely the
field shape that, once the plasma drifts off the midplane, pulls it further away.
The same number that buys you elongation buys you a vertical instability, and it
grows in milliseconds. A conducting vacuum vessel slows it down by about a factor of
ten, which is the only reason anyone can catch it. One in-vessel coil, running a
hundred times faster than the other eighteen, does the catching.

Meanwhile every coil couples to every sensor through mutual inductance, so there is
no clean pairing of actuator to objective: the coil you use to fix the radial
position changes the elongation, the vertical force, and half the flux loops. That
coupling plus that timescale split is what made this problem resist hand-designed
controllers and reward a learned one.

---

## What is in here

| File | What it is |
|---|---|
| `greens.js` | Elliptic integrals (AGM) and the circular-loop flux/field Green's functions. Everything else is built from these two functions. |
| `machine.js` | The fixed hardware: vessel, 19 coil circuits, 16 passive wall loops, 34 flux loops, 38 field probes. Precomputes the inductance matrix and the field lookup tables **once**, shared by every plasma in every generation. |
| `tokamak.js` | One discharge: filament plasma, coupled L/R circuits, sensors, the 219-neuron observation, the shared magnetic observer, the reward, the disruption tests. |
| `tasks.js` | The target registry, and the least-squares solver that inverts the machine to find the coil currents for any requested shape. |
| `pid.js` | The conventional baseline: a 10 kHz vertical loop on the fast coil, a 2 kHz outer cascade on everything else, reading the same observer the network reads. |
| `nn.js`, `evolution.js` | The GA. Elitism, row-wise crossover, champion grace, a three-rung curriculum. |
| `world.js` | One episode across a whole population, plus the PID running the same episode for comparison. |
| `render.js`, `ui.js`, `main.js` | The browser app. |
| `calibrate.js` → `obs_norm.js` | Measures the per-channel mean and sd of every measured and temporal neuron and writes the whitening constants. |
| `imitate.js` | **Stage one of training**: clones the PID into the network by DAgger, using gradients. The only gradients in the project. |
| `train.js` | **Stage two**: the headless GA on `worker_threads`. |
| `browser_train.js` | The same GA, driven from a URL with no Node at all — `index.html?train`. Drives `main.js`'s own generation loop rather than reimplementing one. |
| `compare.js` | Three-way scoreboard on held-out seeds: do-nothing floor, PID, learned. |
| `brainfile.js` | Reads a brain from either a training checkpoint or the baked `default_brain.js`, so every tool works in a clean clone. |
| `test_headless.js` | Physics calibration and smoke tests. |

`training/` is scratch space — `imitate.js` and `train.js` recreate it and it is
not committed. The champion that ships is baked into `default_brain.js`, and the
Node tools default to reading that.

---

## The interface contract

The first 149 neurons mirror the published TCV policy, in that order. A second
block of 70 was added afterwards, for a reason worth reading — see *Temporal
inputs* below.

**Observation — 149 specified + 70 temporal = 219 neurons**

| Block | n | Signal |
|---|---|---|
| Poloidal flux loops | 34 | ψ on the outer wall, ±0.3 Wb — slow, and screened by the vessel |
| Magnetic field probes | 38 | B_pol just inside the wall, ±0.1 T — fast, barely screened; vertical stabilisation lives here |
| Shaping + ohmic coil currents | 18 | the agent commands *voltage*, so it cannot infer these |
| Fast coil current | 1 | separate because its dynamics are 100× faster |
| Ohmic current difference | 1 | I(OH1) − I(OH2); sets the stray radial field |
| Plasma current | 1 | Rogowski |
| **measured subtotal** | **93** | all noisy, all one step stale |
| Previous action | 19 | coils lag; without this the agent is blind to its own recent decisions |
| Target boundary points | 32 | 16 (R, Z) on the desired last closed flux surface |
| Target scalars | 4 | I_p, axis R, axis Z, κ — redundant with the boundary by design, so you can ablate either |
| Discharge phase | 1 | lets one policy span form → hold → morph → ramp-down |
| **specified subtotal** | **149** | |

### Temporal inputs — the 70 that were missing

The 149-neuron contract above is **memoryless**. It carries the field now, the
coil currents now and the previous action; it does not contain a single quantity
with a time derivative in it. A controller reading only that vector cannot tell
a plasma sitting 5 mm high and *still* from one sitting 5 mm high and *falling
at 8 m/s* — and on a vertically unstable plasma those two states need opposite
commands. The PID baseline has dz/dt and three integrators. The network had
nothing, and no amount of evolution fixes an observation that does not contain
the answer. Three training runs plateaued at roughly a tenth of the baseline's
score before this was the diagnosis.

Every one of the 70 is something a real tokamak control system computes in real
time from signals it already digitises. No ground truth, no privileged state.

| Block | n | Signal |
|---|---|---|
| Observer output and rates | 8 | estimated Ẑ, R̂, the three tracking errors, one-step rates |
| Multi-lag differences | 17 | Ẑ, R̂ and I_p differenced at 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4 ms |
| Leaky integrals | 3 | ∫e_Z, ∫e_R, ∫e_Ip, τ = 20 ms |
| Fast-coil temporal | 4 | its current, its rate, and the mean of its last 8 and last 32 commands |
| Probe array dB/dt | 38 | all 38 probes differenced against 0.8 ms ago |

Two of those deserve a note.

**The observer** is the same ridge-regression magnetic reconstruction the PID
baseline uses — literally the same object, `MagneticObserver` in `tokamak.js`,
shared so the two controllers can never be measured against different notions of
where the plasma is. Handing a controller its output is describing the hardware,
not leaking the answer: every tokamak in the world runs a linear magnetic
reconstruction inside the control cycle. It is built from noisy, one-tick-stale
sensors, it subtracts only the coil field the controller genuinely knows, and it
therefore carries the full vessel-eddy-current error — the same lie the PID is
told.

**The probe dB/dt block** is the one that can *beat* the baseline rather than
match it. The vessel eddy currents are the hidden state that screens every coil;
nothing measures them and the PID cannot subtract them. Their signature is
precisely a field pattern that changes while the coil currents do not — so it
lives in dB/dt, and the network is given the raw material to estimate what the
baseline structurally cannot.

A multi-lag ladder is used rather than one derivative because one derivative is
a differentiator with one noise bandwidth, and this plant has three timescales
that matter: the 0.5 ms fast coil, the ~2 ms vessel, and the ~7 ms instability.
Let selection pick the filter.

Every block is normalised independently; the constants are in `Tokamak.NORM` and
are logged, because mismatched normalisation between training and evaluation is
the most common silent failure in this kind of setup. (It bit this project twice —
see the comments in `pid.js`.) On top of that, `calibrate.js` measures each
channel's actual mean and standard deviation over a mixed population of PID,
random and champion episodes and writes `obs_norm.js`. The temporal block needs
this more than the sensors do: its channels span lags from 0.1 to 6.4 ms, whose
natural amplitudes differ by two orders of magnitude, and the measured sds run
from 0.22 to 30.

**Action — 19 voltages**, each in [−1, 1]:

| idx | actuator | range | L/R | role |
|---|---|---|---|---|
| 0-7 | outer shaping (F) | ±1.4 kV | 40 ms | radial position, elongation, gross shape |
| 8-15 | inner shaping (E) | ±1.4 kV | 25 ms | fine shaping, field curvature |
| 16-17 | ohmic / return | ±1.4 kV | 400 / 300 ms | drives I_p by transformer action |
| 18 | fast in-vessel (G) | ±0.1 kV | **0.5 ms** | vertical stabilisation only |

Slew limits are applied inside the environment, not expected of the agent.

There is also a **trimmed** interface — 8 probes, 8 flux loops, 5 coil currents,
I_p, previous action and a 4-number target, driving 5 coils — which is 31 → 5.
Enough to learn vertical stabilisation, nowhere near enough for shape control, and
about five times faster to train. Switch it in the left panel.

---

## Tasks

A task is a small config in `tasks.js`: how long it lasts, what the plasma should
look like as a function of time, and how far off the initial coil currents are.
Everything else — the starting equilibrium, the boundary control points, the
observation encoding — is derived. Adding one is writing an object, not editing the
environment.

* **Hold circular** — κ ≈ 1.05, nearly neutral. The control group.
* **Hold elongated** — κ ≈ 1.75, unstable in ~9 ms.
* **Track vertical position** — chase a 60 Hz sweep with the same actuator that is
  holding the plasma up.
* **Morph shape** — round to strongly elongated on a schedule; the plasma becomes
  unstable partway through, by the controller's own doing.
* **Negative triangularity** — δ ≈ −0.35, which means inverting the shaping field.
* **Current ramp** — 95 → 165 kA by transformer action while holding the shape.
* **Radial excursion** — walk the axis 6 cm out and back.
* **Full discharge** — 1.2 s: ramp-up → shape formation → hold → morph → controlled
  ramp-down. Too long to train on; it is the scripted demo.

Domain randomisation (one config block, `RANDOMISE` in `tokamak.js`) varies plasma
resistivity, wall time constant, per-coil gains and time constants, sensor noise and
poloidal beta between episodes.

---

## The difficulty ladder

A controller that has mastered the nominal machine is not finished; it has run
out of things to learn from *this* machine. So the trainer ratchets the physics
harder whenever the champion is comfortable, and every knob is a real physical
quantity rather than a score multiplier (`DIFFICULTY` in `tokamak.js`):

| rung | κ above round | wall τ | start error | sensor noise | machine spread |
|---|---|---|---|---|---|
| 0 nominal | ×1.00 | ×1.00 | ×1.00 | ×1.0 | ×1.00 |
| 1 brisk | ×1.06 | ×0.94 | ×1.15 | ×1.1 | ×1.10 |
| 2 stiff | ×1.13 | ×0.88 | ×1.35 | ×1.25 | ×1.20 |
| 3 hostile | ×1.21 | ×0.80 | ×1.60 | ×1.45 | ×1.35 |
| 4 brutal | ×1.30 | ×0.72 | ×1.90 | ×1.70 | ×1.50 |
| 5 savage | ×1.40 | ×0.64 | ×2.20 | ×2.00 | ×1.70 |

The wall column is the cruel one. The conducting vessel is the only reason the
vertical instability is catchable at 10 kHz at all, so shortening its time
constant takes samples away from the fast coil directly. Elongation is applied
*above round* — κ → 1 + (κ−1)(1+g) — so the circular control group stays
circular instead of being quietly deleted by a flat offset.

Measured, the ladder costs the PID baseline this much on `hold elongated`
(`node test_headless.js`, which asserts the monotonicity):

```
L0 nominal   κ 1.75   boundary  4.98 cm
L1 brisk     κ 1.79   boundary 11.22 cm
L2 stiff     κ 1.85   boundary 15.04 cm
L3 hostile   κ 1.91   boundary 18.25 cm
L4 brutal    κ 1.98   boundary 20.08 cm
L5 savage    κ 2.05   boundary 20.87 cm
```

### Not forgetting the easy machine

Escalation without a memory is how a curriculum eats its own work: the only
gradient a policy feels is towards the newest distribution. Three defences, all
of them structural rather than hopeful:

1. **Unlocking a rung adds it to the mix, never replaces it.** With six episodes
   and rungs 0–2 unlocked, a generation runs levels `2, 0, 1, 2, 0, 1` — episode
   0 on the hardest rung because that is where the search pressure needs to
   point, everything after it cycling through *every* rung including 0. Level 0
   is never absent. Every brain in the generation gets the identical plan.
2. **The held-out exam spreads its episodes across all unlocked rungs**, so the
   single number the champion is selected on already answers "is this better at
   everything it is supposed to be able to do". A brain that buys the savage
   machine by giving up the nominal one scores worse, not better.
3. **Promotion requires both.** The champion must clear the bar on the hardest
   rung *and* still hold it on rung 0, for three consecutive checks. The
   per-rung breakdown is printed on every log line for exactly this reason —
   `rung0` is the anchor, and if the ladder is quietly costing the population
   the machine it started on, that column shows it.

Because achievable fitness falls as the machine gets nastier, a fixed threshold
also gives the ladder a natural stopping point: it climbs until the brain cannot
clear the bar any more, and then stops. That is the intended behaviour, not a
failure to promote.

```bash
node train.js --resume training/bc.json --stage 2 \
              --promote 0.85 --anchor 0.85 --promotehold 3 --maxlevel 5
node train.js ... --level 3 --maxlevel 3     # pin one rung, no ratchet
```

---

## The baseline

The learned controller is measured against a hand-tuned PID cascade running the
same task, the same seed, the same noise and the same randomised machine. It is
built honestly:

* it never sees the plasma position — it estimates R and Z from the same noisy
  magnetics by ridge regression fitted from the machine geometry alone;
* it subtracts the field it knows its own coil currents are making, and it **cannot**
  subtract the vessel eddy currents, because nothing measures those. That residual
  is the screening error every magnetic controller lives with;
* its gains were swept (`node test_headless.js tune`), not guessed.

Measured (`node test_headless.js pid`, noise on, domain randomisation on):

| task | boundary error | outcome |
|---|---|---|
| hold circular | 0.82 cm | held |
| hold elongated | 2.36 cm | held |
| track vertical | 3.86 cm | held |
| morph shape | 2.66 cm | held |
| negative triangularity | 3.03 cm | held |
| current ramp | 3.42 cm | held |
| radial excursion | 3.47 cm | held |
| **1.2 s scripted discharge** | 3.0 cm | **0/5 complete — mean 796 ms of 1200** |

Where it loses is structural, and the long discharge is where you can see it:

* each channel is tuned as though it acted alone, and they are not — every coil
  moves every sensor;
* elongation and triangularity run purely **feed-forward**, because nothing here
  estimates κ from the magnetics. It cannot correct a shape error it cannot see;
* the observer is a single least-squares fit at one minor radius and one
  triangularity. Its bias is shape-dependent, and over a second-long shot — where
  a falls with I_p and δ is deliberately morphed — that bias slowly walks the
  plasma off the midplane until the fast coil runs out of room. Widening the fit
  to cover more shapes was tried and made everything worse (2.84 cm → 3.48 cm on
  the short tasks): a least-squares observer spends its accuracy where you give it
  samples.

Decoupling all of that by hand is exactly the work a learned controller does not
have to be told how to do — and the 1.2 s discharge is the clearest open goal in
here.

---

## Training — imitate, then evolve

Evolution from random weights spent three runs rediscovering, badly, something
this repository already contains: `pid.js` holds all seven short tasks at
0.8–4.2 cm. So training is two stages.

**Stage one, `imitate.js`** — clone the baseline into the network by supervised
regression. This is the only place in the project where a gradient is used, and
it is used because cloning a known teacher *is* a regression and pretending
otherwise throws away a hundredfold speed-up for nothing.

It is **DAgger**, not plain cloning. Train only on the expert's own trajectories
and the clone is excellent on states the expert visits and lost everywhere else
— and since its own small errors take it off the expert's distribution within a
few milliseconds, "everywhere else" is where it spends the episode. So after the
first round the *rollouts* come from the student and the *labels* come from the
teacher: the PID is stepped alongside the student's plasma, integrators and all,
and asked what it would have done in the state the student actually reached.

```bash
node calibrate.js                                          # → obs_norm.js
node imitate.js --rounds 5 --seeds 12 --epochs 40 --workers 18
```

The clone cannot inherit everything. The PID's three integrators and its 2 kHz
outer-loop phase are internal state no observation carries, so the loss floor is
not zero — which is part of why the temporal block exists at all.

**Stage two, `train.js`** — the GA, seeded from the clone, optimising the actual
reward rather than agreement with the teacher. This is where the tasks the
teacher is *bad* at get fixed, and it is worth watching `vtrack` in particular:
each extra DAgger round made the clone worse at it (5.96 → 7.76 → 8.75 cm),
because more teacher data is only better where the teacher is good.

```bash
node train.js --resume training/bc.json --pop 80 --episodes 6 \
              --workers 14 --stage 2 --mutrate 0.06 --mutsigma 0.12
node train.js --mode trim --gens 400 --pop 96              # fast demo
node train.js --bake training/checkpoint.json              # → default_brain.js
```

Note `--mutsigma 0.12`, an order of magnitude below the value used from a random
start. Mutation is sized relative to each layer's own weight scale, and a brain
that arrived by gradient descent has an output layer roughly fifty times wider
than its random init — so `Net.calibrateScales()` re-measures that scale from the
weights themselves on load. Without it the GA stage would step by a fraction of
the *initial* spread, which against trained weights is not a mutation but a
rounding error, and the whole stage would be an expensive way to keep the brain
it started with.

One episode of one brain touches nothing but its own state, so this parallelises
almost perfectly: the workers hold a read-only copy of the machine tables and the
main thread ships weights out and four numbers back. On a 128-thread box use a
population in the high hundreds and 5–8 episodes per generation, so every worker
gets several whole brains and the per-generation barrier is amortised:

```bash
node train.js --gens 4000 --pop 512 --episodes 6 --workers 120
```

**On a shared machine, pass `--workers` explicitly.** The default deliberately
leaves cores free; a trainer that saturates a box gets itself killed.

The champion is decided by a **held-out exam** — fixed seeds the population never
trains on — not by the training score, because the training score is measured on
the very episodes the population was selected against and one lucky generation
would otherwise hold the title forever.

### Training in the browser, with no Node at all

```
index.html?train&gens=3000&pop=64&episodes=4
```

Trains in slices so the tab stays responsive, logs progress, and offers a
**download `default_brain.js`** button at the end — drop it over the one in this
directory and the page loads your brain. Headless, for a machine you can leave
alone:

```bash
chrome --headless=new --disable-gpu --dump-dom \
  "index.html?train&sync&intro=0&gens=3000&pop=64&episodes=4" > out.html
```

`sync` matters: `--dump-dom` fires as soon as loading finishes and Chrome's
virtual clock does not advance inside a script task, so a chunked run would be
dumped before it had done anything. The title ends up `DONE gen=… exam=…
bake=ready` and the baked brain is in `<pre id="bake-out">`.

It keeps the two things that make a long run worth anything — the held-out exam
over the top three candidates, and the difficulty ratchet with its rung-0 anchor
— but there is **no imitation stage**, because that needs gradients across a
worker pool. A browser run therefore starts from random weights and is
single-threaded: measured at pop 12 / 2 episodes, about **0.25 generations per
second**, getting slower as brains survive longer. Expect thousands of
generations and a plateau below the shipped brain. To push the shipped
controller further instead of starting from nothing, add
`&resume=default&mutsigma=12&stage=2`.

Full parameter list in [RECIPE.md](RECIPE.md) §8.

---

## Status — what the shipped brain actually is

`default_brain.js` holds a real controller: cloned from the PID baseline, then
evolved for 400 generations up the difficulty ladder to its top rung.

The full working recipe — the pipeline in the order it runs, the rationale for
every one of the 219 inputs, the reward, and every hyperparameter with the
reason it has the value it has — is in [RECIPE.md](RECIPE.md).

**The run.** About three hours on a 20-thread i7-12700H. Twenty minutes of
imitation (5 DAgger rounds, 259k state-action pairs), then ~400 GA generations at
population 80, 6 episodes/generation, 14 workers, ~15 s/generation. The ratchet
climbed all five rungs, reaching *savage* — κ 40% further above round, 36% less
wall stabilisation, 2.2× the starting error and twice the sensor noise — at
generation 310.

**The scoreboard** (`node compare.js --episodes 12` —
96 episodes per controller on seeds none of them trained on, nominal machine,
noise and domain randomisation on):

| task | do nothing | PID baseline | **learned** |
|---|---|---|---|
| hold circular | 8.54 cm, 42% dis | **1.13 cm** | 1.84 cm |
| hold elongated | 18.56 cm, 100% | **2.08 cm** | 2.25 cm |
| track vertical | 15.42 cm, 92% | 6.31 cm | **2.75 cm** |
| morph shape | 13.70 cm, 100% | 2.68 cm | **2.31 cm** |
| negative triangularity | 13.67 cm, 100% | 3.73 cm | **2.83 cm** |
| current ramp | 12.39 cm, 100% | **3.31 cm** | 3.36 cm |
| radial excursion | 14.12 cm, 92% | 3.26 cm | **3.15 cm** |
| **1.2 s discharge** | 6% survived | 64% survived, **100% disrupt** | **76% survived, 33% disrupt** |
| **ALL** | 51% surv, 12.95 cm, 91% dis | 95%, 3.22 cm, 13% | **97%, 3.06 cm, 4%** |

Mean fitness: do nothing −119.6, PID +13.3, **learned +29.3**.

**The 1.2 s discharge was the open goal, and it went in.** The PID disrupts in
every single one of those episodes — its observer's shape-dependent bias walks
the plasma off the midplane over a second-long shot until the fast coil runs out
of room. The learned controller completes two out of three.

### Where it actually wins: robustness

The nominal machine is not the interesting comparison — the PID was *tuned* on
it, and holds its own there. The difficulty ladder asks the better question
(`node compare.js --episodes 8 --sweep`):

| rung | PID error | **learned error** | PID disrupts | **learned disrupts** |
|---|---|---|---|---|
| L0 nominal | 3.32 cm | **3.03 cm** | 13% | **3%** |
| L1 brisk | 3.89 cm | **3.13 cm** | 13% | **6%** |
| L2 stiff | 5.56 cm | **3.31 cm** | 14% | **5%** |
| L3 hostile | 7.27 cm | **3.42 cm** | 23% | **8%** |
| L4 brutal | 10.04 cm | **3.66 cm** | 27% | **8%** |
| L5 savage | 12.99 cm | **3.99 cm** | 44% | **11%** |

**The PID degrades 3.9× across the ladder; the learned controller degrades 1.3×.**
That is the whole argument for learning this controller rather than tuning it.
A PID gain is a number chosen for one wall time constant and one elongation; when
the vessel gets more resistive the loop it belongs to is simply mistuned, and
nothing in the cascade notices. The network reads the probe array's dB/dt, which
is where the vessel eddy currents live, and can therefore tell what kind of
machine it is on this shot.

**Read the caveats honestly.** The PID still wins `circular` and `elongated` on
the nominal machine, which are the two tasks its feed-forward shape terms fit
best. The learned controller had a large head start — it was cloned from that
same PID, so "learned" here means "improved on a known controller", not
"discovered control from nothing"; the from-scratch GA in this repo reached 40%
survival and 11.3 cm and was never close. And every number above comes out of one
model, which is the subject of [PHYSICS.md](PHYSICS.md).

Three hours on a laptop is still not a training run for a 219 → 19 policy on a
10 kHz plant. To push it:

```bash
node imitate.js --rounds 5 --seeds 24 --epochs 60 --workers 120
node train.js --resume training/bc.json --gens 20000 --pop 512 --episodes 7 --workers 120
```

## Things that were wrong on the way here

Kept because the comments in the code explain them and because most of them are
generic traps, not tokamak ones.

* **Ridge/regularisation parameters that were absolute instead of relative.** A
  coil produces ~10⁻⁵ T per ampere, so λ = 10⁻⁴ does not regularise the equilibrium
  solve, it deletes it. Every task started with zero shaping current and every
  plasma hit the outboard wall in 300 µs. The same bug, independently, turned the
  PID's magnetic observer into a constant.
* **Mutation that was absolute instead of relative to each layer's init scale.**
  The output layer starts near zero so a fresh controller commands nothing; an
  absolute σ large enough to matter in the input layer moves an output weight
  twenty times its own size, saturates tanh, and pins a 1.4 kV supply. Generation 1
  survived 88% of its episodes and generation 10 survived 35%. Selection was not
  failing — mutation was destroying brains faster than selection could keep one.
* **A reward with no floor.** A plasma 30 cm off target scored −20 per step, far
  worse than the cost of disrupting, so the best strategy available to a young
  population was to kill the plasma immediately and stop the clock.
* **The control allocation cancelling the fast coil's own field.** The shaping coils
  were commanded to undo every correction the vertical loop made. The two actuators
  spent the whole discharge cancelling each other.
* **Three of sixteen vessel loops sitting on top of each other**, because the wall
  contour was resampled without closing the loop. Two identical rings are one ring
  described twice, and the inductance matrix is exactly singular.
* **The limiter creating a runaway.** Feeding the wall-clipped minor radius into the
  hoop force gives: plasma drifts out → limiter clips a → ln(8R/a) grows → hoop
  force grows → drifts further out.
* **A fast coil with too many turns.** Force per amp scales with N; the current a
  100 V supply can push scales with 1/N². Adding turns makes the coil *weaker*.
* **A champion selector that scored one episode.** One episode of this environment
  is dominated by which perturbation and which randomised machine it drew, so
  generation 10 posted a lucky score and still held the title forty-five
  generations later — every checkpoint the run wrote was that same brain. A noisy
  selector does not slow a search down, it stops it. It now averages four held-out
  seeds, and the checkpoint gate uses eight.
* **An observation with no memory in it, for three whole training runs.** The
  published 149-neuron vector contains no quantity with a time derivative, so a
  controller reading it cannot distinguish a plasma sitting 5 mm high and still
  from one 5 mm high and falling at 8 m/s — and those need opposite commands. The
  PID baseline it was losing to has dz/dt and three integrators. Every run
  plateaued at about a tenth of the baseline's score, and each time the suspect
  was the search — mutation width, curriculum, selector — when the fault was that
  the answer was not in the input. Adding derivatives, multi-lag differences and
  integrals took it past the baseline in one training session.
* **Mutation sized against an init the weights had long left behind.** `mutate`
  scales σ by each layer's *initial* spread, which is right from a random start
  and wrong for a brain that arrived by gradient descent with an output layer
  fifty times wider. The GA would have stepped by a rounding error and looked
  converged from generation one. `Net.calibrateScales()` re-measures from the
  weights; `clone()` had to be taught to carry them, which was invisible while
  every net came from the same init.
* **A champion selector that examined one brain out of eighty.** `results[0]` is
  whoever won six noisy training episodes, which under a wide mutation is usually
  a lucky draw rather than a real improvement, so it fails the held-out exam and
  the title never moves. Measured: frozen for fifty generations while the
  training best kept climbing. It now examines the top three, batched into one
  call so the extra costs about 17% rather than 3×.
* **A difficulty ladder whose first rung was a cliff.** The first draft raised
  elongation, shortened the wall, and increased both starting error and noise all
  at once, and took the PID from 4.65 cm to 12.40 cm in a single step. The
  ratchet would have stalled on rung one with four rungs unused. Six small steps.
* **Python patch scripts that silently do nothing.** Two separate `s.replace(old,
  new)` edits had slightly wrong search strings and no assertion, so they matched
  nothing and reported success. One of them meant the temporal block went
  *un-whitened* through an entire training run — sds from 0.27 to 42.6 on
  channels that were supposed to be unit variance — and it was only found an hour
  later while testing an unrelated tool. `graft.js` rescued it: an affine change
  of input normalisation absorbs exactly into the first layer, verified to 3×10⁻⁷
  before writing, so the champion carried across without retraining.
* **A scripted discharge the actuators could not follow.** The ramp-down asked for
  7.6×10⁵ A/s from a transformer good for about 3×10⁵. The current fell behind its
  reference, the minor radius went with it, and the discharge ended in a VDE 85% of
  the way through every time. A reference waveform the hardware cannot track is not
  a hard control problem, it is a badly written scenario.

---

## Credits and caveats

Physics model, control problem framing and every number in it: mine, and crude.
The problem statement, the interface sizes and the ambition are from Degrave et al.
(2022). Nothing here is affiliated with that work, with TCV, or with anyone who
owns a tokamak.

**Read [PHYSICS.md](PHYSICS.md) before drawing any conclusion from anything this
program prints.**
