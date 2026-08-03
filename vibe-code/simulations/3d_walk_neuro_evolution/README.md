# Learning to Walk — 3D humanoid neuroevolution

A 65 kg, 1.67 m humanoid with 18 servo joints teaches itself to stand up out of a
squat, hold its balance, and walk to waypoints — over slopes, up stairs, into the
wind. There is **no gradient descent anywhere**: brains are mutated, scored, bred,
and the good ones survive. Same lineage as `smart_ocean_boats`, one dimension and
about two orders of magnitude of difficulty up.

Open `index.html`. No build step, no server, no network.

---

## What it is

| | |
|---|---|
| **Body** | 19 rigid links, 18 actuated 1-DoF joints, 6-DoF floating pelvis = **24 DoF** |
| **Mass** | 65 kg, Winter's anthropometric segment fractions for a 1.70 m adult |
| **Actuation** | position servos: the network commands joint *targets*, a 500 Hz PD loop makes torque, clamped to realistic peaks (240 N·m hip, 260 N·m knee) |
| **Physics** | Featherstone reduced coordinates, RNEA + CRBA + LDLᵀ, 500 Hz |
| **Contacts** | Hunt–Crossley normal + Coulomb stick-spring friction, 21 points |
| **Brain** | 133 → 48 → 32 → 29 feedforward, tanh/sigmoid, **8,957 weights** |
| **Control** | 50 Hz, one tick of latency, servo lag, sensor/actuator noise |
| **Evolution** | elitist GA with row-wise crossover, champion grace, tapering immigrants |

## The five stages

The user-visible curriculum, and the order the fitness function unlocks in:

1. **Stand up** — rise out of a half-squat (hip at 85% of standing height) and hold full height
2. **Keep balance** — hold it; from stage 2 the whole fleet takes identical shoves at identical instants
3. **Walk between waypoints** — courses that turn; each waypoint reached buys more time on the clock
4. **Slopes and stairs** — the ground tilts (to ~9°) and steps (6–15 cm rise), ramping in over ~150 generations
5. **Wind** — gusting crosswind on the torso, on top of everything else

**Every episode replays the whole curriculum**, in order:

```
0.0 – 1.6 s   STAND     rise and reach full height
1.6 – 3.2 s   BALANCE   hold it, take a shove
3.2 s – end   WALK      chase waypoints
```

so a walker physically cannot be scored for walking before it has stood.
`stageFor()` in `evolution.js` decides when the *environment* gets harder;
`walker.tick()` decides what *counts*. Both only ever ratchet forwards.

## Progressive scoring

This is the part that took the longest to get right, and it is worth reading the
comment block at the top of `walker.js` for the full account. The short version:

Each stage pays **income** only while it is the frontier, then converts to a
one-off **bonus** once it is banked.

| | worth | when |
|---|---|---|
| posture | 240 / s | stand phase only → caps near 600 |
| stood | 600 | one-off, first time it holds full height for 0.6 s |
| uprightness | 200 / s | balance phase only → caps near 500 |
| balanced | 500 | one-off, held it for 2 s |
| survived a shove | 150 | each |
| alive while walking | 25 / s | a trickle, too thin to live on |
| **each step** | **25** | a foot that genuinely left the ground for ≥ 80 ms, capped at 20 |
| **stride** | **500 / m** | …times how far forward that foot actually landed |
| **metres closed** | **900 / m** | only while upright, only past the closest approach so far |
| waypoint reached | 1200 + speed + terrain + wind bonuses | |

The obvious design — pay a walker for every tick it spends upright — produces a
population that stands perfectly still forever and never takes a step. That is
not a hypothetical: it plateaued at **exactly 5,260 points within 20
generations** and sat there for the next hundred, because 11 seconds of flawless
standing was worth 5,260 and a first tentative step was worth about 50 minus a
fall.

The weights above come from arithmetic, not taste, and `test_headless.js` asserts
the arithmetic still holds:

* standing still for the whole clock ≈ **2,080**
* half a metre of honest walking, then a fall ≈ **2,210** — so break-even is half
  a step, the shortest first step evolution can stumble into
* lifting the feet on the spot ≈ **2,580** — a real rung between the two
* a forward *dive* to farm the metres ≈ **1,990** — below the stander it replaced
* rocking side to side without lifting a foot ≈ **2,080** — exactly nothing extra,
  see below

### The exploit that ate a training run

Worth reading in full, because it is the most instructive failure in the project
and `test_headless.js` now guards against it in three places.

The first version of the stepping reward paid a flat bonus per "clean alternation
of the stance foot", detected as *the load on one foot going light*. It looked
reasonable and it trained for a hundred generations. A forensic probe of the
resulting champion showed:

```
amplitudes  hipPitch=0.001  knee=0.068  anklePitch=0.127  hipRoll=-0.029
footL x: -0.01 -> -0.07 over eight seconds      (6 cm)
footR x: -0.13 -> -0.13 over eight seconds      (pinned)
load L/R: 0.90/0.10 <-> 0.20/0.84               (rocking)
steps credited: 8      distance travelled: 0.00 m
```

It had discovered that a foot can be unloaded by *leaning*, collected the entire
step bonus at zero risk of falling — and so selection had **deleted the gait**,
driving the leg amplitudes to ~0.001 rad. Rocking on the spot strictly dominated
walking. This is the same failure mode as the statue exploit in the
food-delivery sim: a reward that pays for a degenerate proxy instead of the
thing you wanted.

The fix is that a step now requires the foot to leave the ground **completely**
(zero contact points) for at least 80 ms, and is paid mostly for how far forward
it landed. Re-scored under the new rule, that same champion falls from 4.8
"steps" and 2,894 points to 1.3 real steps and 2,306 — straight back down to the
standing baseline, which is exactly what it was worth all along.

## The rhythm layer

A feedforward network reading a mostly-static posture settles to a fixed point,
and a fixed point is a walker standing still. Measured: **120 random brains
produced a best forward progress of 2 cm and a median of exactly zero.** Not
"small" — zero. Selection had nothing to grip.

So the leg joints get a rhythm term the network *modulates* rather than
generates:

```
target = network posture offset  +  A · sin(gait phase + φ)
```

with `A` and `φ` network outputs and five joint groups (hip pitch, knee, ankle
pitch, hip roll, arm swing), left and right phase-locked across the body — four
of the groups in anti-phase, hip roll in phase, for the reason below. This is a
central pattern generator — what real legged robots use — and it is a substrate,
not a script: `A` starts at zero for every newborn, and the network still has to
discover that oscillating pays, choose an amplitude and phase per group, set a
cadence, and layer balance corrections on top. What it buys is that **one
mutation can now produce a step** instead of needing a hundred coordinated ones.

### Hip roll is the one group that is in phase

This one was a mechanics bug, not a learning problem, and it is easy to get
wrong. Hip pitch, knee, ankle and arm swing are all **anti-phase** across the
body — left and right alternate. Hip roll must be **in phase**.

Both hip-roll joints share the +X axis, so rolling them the same way tips the
pelvis sideways and carries the centre of mass over one foot, which is the only
way a biped can unload the other foot enough to swing it. Wired anti-phase, as
the other four groups are, hip roll merely splays both legs symmetrically and
shifts no weight at all: measured, the load stayed pinned at 50/50 no matter how
large the amplitude, and **no foot could ever leave the ground**. Stepping was
mechanically impossible rather than merely hard to learn — which is also why the
population settled for rocking.

With the phase corrected, a pure hip-roll oscillation of 0.05 rad and nothing
else swings the load 0%↔100% and produces twelve genuine steps while staying
upright, from a controller with no other rhythm at all.

Two supporting details, both measured:

* The rhythm outputs are **seeded ~14× wider** than the posture outputs
  (`OUT_ROW_SCALE` in `nn.js`). Widening the whole output layer instead is much
  worse — it topples everyone (99% → 3% able to stand) while progress stays at
  zero. Posture wants trim; rhythm wants variety.

  14 is also a maximum, not a floor. Widening only the rhythm rows further was
  measured across 3 × 40 fresh brains, and it is monotonically worse: the
  newborn hip-pitch amplitude spread grows from −0.31…0.40 to the full
  −0.55…0.55, but the best forward progress in the population *falls* from
  0.53 m to 0.28 m. Bigger amplitudes just topple walkers before the swing
  completes.
* The rhythm is **gated to the walk phase** and ramped in. Letting the legs swing
  during the stand-up toppled the entire population before the walk phase began:
  0 of 40 first-generation walkers were still upright at the old 5.0 s mark, so
  the walking half of the fitness function was unreachable dead code.

## Why reduced coordinates

A doll built from rigid bodies and ball joints solved by sequential impulses is
always slightly rubbery, and a rubbery skeleton is a moving target for evolution:
the same torque gives a different result depending on how well the solver
converged that tick. In reduced coordinates the joints are *structurally* exact —
the state **is** the joint angles, a knee cannot drift apart, and there are no
solver iterations to tune. It is also ~3× cheaper, which matters when a run
simulates a hundred thousand walker-seconds.

The cost is that contacts have to be compliant rather than rigid. That turned out
fine, and the tuning is in the code comments.

### Two numerical facts worth knowing

* **Rotor inertia is not a fudge factor.** Every joint carries an `armature`
  term. Physically it is what a 100:1 harmonic drive feels like from the link
  side (rotor inertia × ratio², order 0.1 kg·m² for a leg joint) and it is a
  large part of why real humanoids move limbs more slowly than people do.
  Numerically it is what makes a stiff servo integrable: an ankle's own subtree
  is just a 0.94 kg foot, so without it the explicit damping term `kd·q̇` goes
  unstable for any `kd` above ~45.
* **The contact damper must vanish at separation.** A linear `KN·d − CN·v` damper
  still pulls while the foot is already lifting, gets clamped to zero, and the
  foot chatters in and out of contact at ~20 Hz. Measured: a walker merely
  holding its pose spent 25% of its time airborne and skated backwards at
  17 cm/s. Hunt–Crossley (`KN·d·(1 + HC·closing speed)`) fixes it — the current
  numbers give 0.16 mm of bounce, 0% airborne, and exactly 1.00× body weight of
  ground reaction.

## Sim-to-real

Kept deliberately mild — the aim is a gait that does not depend on the simulator
being exact, not one that survives a hurricane. Turn it off with the **Sim-to-real
noise** checkbox and watch learning get easier and the result get less
transferable.

* Gaussian noise on every sensor channel (1.5%) and on every action (2%)
* Multiplicative torque jitter (2%) and a 55 ms first-order servo lag
* Per-episode randomisation of friction (±15%), peak torque (±8%), servo gains
  (±10%) and the starting pose (±0.025 rad per joint)
* Realistic torque ceilings and geared-joint rotor inertia, so a gait that needs
  impossible actuators cannot be selected

Note the servo lag is a plain first-order filter and **not** a per-joint slew-rate
cap. A rate cap makes every joint travel at the same speed, so the small-error
joints arrive long before the large-error ones and the rise passes through a
posture with the feet no longer flat. The lag moves every joint proportionally,
i.e. straight from the crouch to the target in joint space, which keeps the soles
down.

## Fairness

Selection only means something if the only difference between two walkers is the
weights in their heads. So every walker spawns at the **same spot** in the **same
pose** on the **same terrain**, gets the **same waypoints**, the **same gusts**,
the **same shoves at the same instants**, and even the **same stream of sensor
noise** (per-walker RNGs, identically seeded — `nn.js`'s `gaussRand` caches a
spare between calls, and walkers interleave, so sharing it would silently cross
their noise streams). Walkers do not collide or perceive each other.

That is why the renderer draws them as an overlapping ghost swarm: it is
literally where they are. The spread of the ghosts is a live read on how much
variance is left in the gene pool.

Generations are scored over **several episodes** with different mission seeds and
weather. On a single episode the top of the ranking is mostly luck about where
the waypoints fell, and selection on luck goes nowhere. The episodes **slide**
across generations rather than being redrawn — see defect 2 below for how much
that mattered.

## The run that learned nothing

The most expensive lesson here, and unlike the two reward exploits above it was
not in the reward function at all — it was in the search. A 350-generation run
produced this, and it is worth reading as a shape:

```
gen   1 st1 best 1962 avg 1182 | stood 100% bal 31% | steps 0.3/5
gen  80 st2 best 2522 avg  683 | stood  60% bal 11% | steps 0.1/2
gen 170 st3 best 1982 avg  792 | stood  83% bal 11% | steps 0.1/3
gen 251 st3 best 2227 avg  684 | stood  62% bal 12% | steps 0.0/0
gen 351 st4 best 2547 avg  777 | stood  69% bal 13% | steps 0.1/2
```

The population mean **never again reached its generation-1 value**, and by
generation 251 the best walker in the fleet took zero steps. Generation 1 is
random brains with near-zero weights, which simply stand there — so 350
generations of selection had produced something worse than doing nothing. That
is not a plateau needing patience. Four separate defects, each measured:

**1. The mutation step destroyed every child.** Paired test — a champion and 24
of its own offspring run on the *same* three missions, so the mission cancels:

| rate | sigma | within 5% of parent | better than parent | best of 24 |
|---|---|---|---|---|
| 0.10 | 0.150 | **0%** | **0%** | 1902 |
| 0.06 | 0.080 | 4% | 4% | 2399 |
| 0.04 | 0.050 | 33% | 13% | 2657 |
| 0.03 | 0.030 | 54% | 38% | 2605 |
| 0.02 | 0.015 | 75% | 63% | 2648 |

Parent scored 2302. At the settings the run was actually using, **not one child
in twenty-four landed anywhere near its parent and none improved on it.** The
hill-climb had no uphill move available: four unmutated elites survived, every
one of their offspring was wrecked, and the mean collapsed. Note the last
column — the smaller step also finds *better* peaks. The big step was not buying
exploration, it was pure damage. The defaults (`MUT_DEFAULT` in `evolution.js`)
are now 0.035 / 0.04, near the classic 1/5th success rule. These came from the
boats sim, where a smaller network and a gentler weights-to-behaviour mapping
made them fine; a 133-48-32-29 net driving PD servos on a biped is far sharper.

**2. Selection was ranking the exam, not the candidate.** One fixed brain scores
**1,031 to 2,934** (sd 471) depending only on which mission it draws. Every
generation drew fresh missions, so a brain that won generation *g* was
re-examined on a completely different paper in *g+1* — and the gap between two
good brains, a few hundred points, is well under the gap between two papers.
Missions now **slide**: generation *g* runs missions *g, g+1, g+2* and *g+1* runs
*g+1, g+2, g+3*, so consecutive generations share two-thirds of the exam. The
objective drifts slowly instead of being replaced, while still moving enough that
nobody overfits one lucky course.

**3. The champion record was a lottery maximum.** `championFit` was a running max
over ~14,000 noisy samples, which on an sd-471 distribution settles about four
standard deviations above the brain's true mean — the recorded 2,998 belonged to
a brain actually worth 2,120. Unbeatable, so the crown froze on whoever drew the
easiest paper. The champion holds a live seat in the population and is therefore
already re-scored every generation, so a **paired** comparison was available all
along. `championFit` is now that measurement, and it is allowed to fall.

**4. The curriculum fallback promoted a fleet that could not balance.** Stage
advancement is "milestone **or** generation", so a threshold set too high cannot
stall a run. But unguarded, the generation half fired at gen 170 with 14% of the
fleet balancing against a gate of 80%, handing it 0.7-strength shoves and
112-degree course changes. The damage is legible in the log either side of the
boundary: balanced 12–20% → 4–12%, mean distance walked 0.03–0.05 m → 0.00–0.02 m.
Each fallback now also has to clear a floor set well below the real gate — still
anti-stall, no longer a licence to promote incompetence.

All four are guarded by regression tests. The general lesson: when a run goes
flat, the reward function is the *second* place to look. Check first that
offspring survive their own mutation and that the objective is stationary enough
to climb — a perfect reward is worth nothing to a search that cannot move.

### …and then a fifth: every rung has to stop paying

With the search fixed, the population climbed properly for the first time — and
promptly revealed a reward defect the broken search had been hiding. The
generation-141 champion stood for 13–17 s, took seven or eight genuine steps, and
travelled **0.26 m**. It was marching close to on the spot.

Zeroing one reward term at a time and re-running the same seven missions (the
brain is fixed and the physics never reads `FIT`, so the episode is identical and
only the ledger moves) says why:

| | | | | |
|---|---|---|---|---|
| STAND_BONUS | 600 | 18.4% | PROGRESS_PER_M | 399 · 12.2% |
| BALANCE_BONUS | 500 | 15.3% | STEP | 311 · 9.5% |
| **PUSH_BONUS** | **450** | **13.8%** | ALIVE_WALK | 281 · 8.6% |
| POSTURE | 372 | 11.4% | **STRIDE_PER_M** | **145 · 4.4%** |
| UPRIGHT | 314 | 9.6% | | |

The tempting read is "69% of the score comes from not moving", but that is
mostly wrong and worth being careful about: `STAND_BONUS`, `BALANCE_BONUS`,
`POSTURE` and `UPRIGHT` are one-off or phase-limited, and essentially every
surviving walker earns all of them. They are a **constant offset**, and a
constant offset does not bias the choice between marching and walking.

What biases it is the *marginal* rate — what one more second buys. Standing
still paid `ALIVE_WALK` at 25/s **plus** an uncapped `PUSH_BONUS` of 150 every
~4.25 s, or about 35/s. Sixty points a second for staying upright and still. Over
the ~14 s walk phase that is ~840 points, so **fourteen seconds of standing was
worth about as much as walking a full metre** — at none of the risk, since
falling ends the episode and forfeits the rest. Two terms were at fault:

* **`PUSH_BONUS` was uncapped.** Shoves keep arriving every few seconds through
  stages 2–5, so it is unbounded income that scales with episode length, and it
  is paid for being a rock — a walker in motion is far easier to topple, so it
  is precisely a subsidy against walking. Capped at the first two, which is
  enough to teach the skill. Marginal standing income: 60/s → 25/s.
* **`STEP` was capped at twenty**, which sounds bounded but is 500 points for
  lifting a foot twenty times — and the champion's steps carried it about 1.5 cm
  each, so flat `STEP` was out-earning real stride 311 to 145. Lifting a foot is
  the *rung* between standing and walking, so it now pays like a rung, capped at
  eight. Past that, income has to come from how far the foot actually travelled.

Same shape as the two exploits above, and the same shape as the plateau that
motivated progressive scoring in the first place: **a reward for a skill that has
already been banked, still paying, now competing with the skill above it.** The
test suite now asserts that the shove bonus stops at its cap and that neither
flat bonus can out-earn one metre walked.

### A sixth: read the exam before you fail the students

Around generation 150 the log looked like the same story again — mean fitness
off its peak, mean steps down from 3.6 to 1.7, mean stride from 0.13 to 0.03.
It was not. The mission window *slides*, so a fall in the fleet's numbers has
two possible causes, and the log cannot tell them apart.

The way to separate them is to replay **one unchanging brain** over the exact
mission window each generation faced, at that generation's stage. Whatever that
curve does is the exam. Whatever the fleet does on top of it is the fleet.

|                                | gen 90–150 | gen 160–230 |
| ------------------------------ | ---------- | ----------- |
| fleet mean walked              | 0.16 m     | 0.13 m      |
| **fixed brain**, same missions | 0.53 m     | **0.39 m**  |
| fleet mean fitness             | 1689       | 1555        |
| **fixed brain**, same missions | 2745       | **2471**    |

The brain that could not possibly have got worse dropped further than the fleet
did, and fleet distance tracks fixed-brain distance at r = 0.69. The population
was gaining on a course that was getting harder. Any metric read off a sliding
objective needs this control before it means anything.

Two working notes fell out of it. `train.js` writes `champion.json` in place, so
every save erases the evidence you would want for exactly this comparison —
`training/snapshots/` now keeps one copy per generation. And the probe is only
sound because the physics never reads `FIT`: the episode replays identically, so
zeroing a reward term or swapping the ledger changes the score and nothing else.

### And a seventh, sitting under a comment that described it

`stageFor()` opens by promising that *the ratchet only turns one way*, because a
stage that can fall back produces a sawtooth that trains nothing. The code did
not do that. Each gate was a plain assignment:

```js
if (gen >= c.stage2Gen && bal >= c.floor2) s = 2;      // clobbers stage 3
```

A fleet on stage 3 whose `balancedFrac` sits at 42% is in the band *between*
`floor2` (0.30) and `floor3` (0.45): high enough to fire the stage-2 gate, which
knocks it down to 2, and too low to re-earn 3. It ran that way from generation
170: `st3 · st3 · st2 · st3 · st3 · st2`. `Math.max(s, 2)` is the entire fix.

There was already a test called *the ratchet never turns back*, and it passed
throughout. It drove `balancedFrac` to 0.1 — *below* `floor2`, so the buggy gate
never fired — and asserted `stage >= 2` on a fleet that was on stage 2, where a
demotion to 2 is a no-op. It tested the one configuration in which the bug is
invisible. The replacement walks a run whose competence wanders across every
floor for 400 generations and asserts the stage never falls, once.

## Headless training

```bash
node train.js --gens 800 --pop 56 --episodes 3        # one worker per core
node train.js --resume training/champion.json --gens 400
node train.js --gens 60 --stage-lock 4 --terrain stairs   # drill one stage
node test_headless.js                                  # the whole test suite
node bake_brain.js                                     # champion -> default_brain.js
```

`train.js` rewrites `training/champion.json` every `--save-every` generations, so
`bake_brain.js` can be run at any point during a run to put the current best
brain behind the page's **Load built-in champion** button. It refuses to bake a
brain whose input/output contract does not match the current build.

Splitting the population across worker threads is exactly equivalent to running
it in one process: the environment is a pure function of `(missionSeed,
noiseSeed)` — terrain, waypoints, gusts, shoves, noise, all of it — and walkers
never interact, so a slice of the fleet in worker 3 lives the identical episode
to a slice in worker 0.

Flags: `--pop --gens --episodes --workers --seed --mut-rate --mut-sigma --grace
--stage-lock --terrain --out --resume --save-every --quiet`.

The browser has a **Headless mode** checkbox that does the same thing without the
rendering, roughly 20× faster than the visible 8× setting.

## Files

| | |
|---|---|
| `physics.js` | spatial algebra, RNEA, CRBA, LDLᵀ, floating-base integrator |
| `body.js` | the humanoid: links, joints, masses, limits, gains, keyframe poses |
| `terrain.js` | analytic height fields — flat, rolling, stairs, mixed |
| `walker.js` | sensing, servos, contacts, the rhythm layer, the fitness function |
| `world.js` | one episode: curriculum phases, waypoints, weather, shoves, fairness |
| `evolution.js` | the GA and the curriculum ratchet |
| `nn.js` | the network — shared with `smart_ocean_boats` |
| `render.js` | the three.js view |
| `ui.js`, `main.js`, `index.html`, `style.css` | the page |
| `train.js` | headless multi-core trainer |
| `bake_brain.js` | copies a trained champion into `default_brain.js` |
| `test_headless.js` | 40-odd assertions, all of them things that were once wrong |

`test_headless.js` is worth a look: every assertion in it corresponds to a bug
that actually happened during development, including the mass-matrix sign error,
the contact chatter, the standing-still plateau, and the walk phase that no
walker ever reached.

## Reading the view

* **Solid green** is the current leader; the translucent ghosts are the rest of
  the fleet, at the same place on the same ground.
* The **red dot** is the ground projection of the leader's centre of mass. While
  it stays inside the feet, the walker is stable; the instant it leaves, the
  walker is falling. It is the most informative thing on the screen.
* The gold ring is the next waypoint; blue ones are the ones after it.
* The **Skills acquired** chart is the curriculum in one picture: the fraction of
  the fleet that can stand, the fraction that can hold it, and the mean waypoints
  reached, with the stage shown as a band along the bottom.

Drag to orbit, scroll to zoom. `index.html?nointro` skips the opening dialog.

## Open defect: the walk gradient dies at 0.79 m (measured 2026-07-29)

Held-out performance plateaued at **0.33 waypoints / ~1.0 m** across generations
111 and 141 — two independent exams on the same twelve unseen missions, no gain
in thirty generations. The cause is in the ledger, not the search.

`_payWalk` bounds cumulative per-leg income at `WALK_LEG_CAP` (960), and
`_payShape` draws from the *same* pot. With the shape allowance full, progress
income stops after `(960 - 250) / 900 = 0.79 m`. The first waypoint is 1.3–2.3 m
away, so past 0.79 m every further metre toward the waypoint pays **zero** and
the only remaining signal is the sparse `ARRIVE`. A hill-climbing GA has nothing
to climb for the last ~60% of every leg.

Instrumented on the generation-141 champion, all twelve held-out missions:

    947 | walked 0.85 m | budget gone at 0.79 m | 1.47 m still to go | wp 0
    955 | walked 1.04 m | budget gone at 0.79 m | 1.03 m still to go | wp 0
    976 | walked 1.32 m | budget gone at 0.79 m | 1.37 m still to go | wp 0
    7/12 exhausted the leg budget; 7 of those still had ground to cover.

The five that never hit the cap fell before reaching it. Distances are bimodal —
either <= 1.04 m and no waypoint, or >= 1.30 m and a waypoint, nothing between —
which is the signature of a plateau at the point income stops.

Note `_payWalk`'s comment claims "under the flat model the cap is Infinity". It
is not: `FLAT` is captured from `FIT`, which sets `WALK_LEG_CAP: 960`. The flat
model was *intended* to be uncapped and never was. This is the same
gradient-truncation defect diagnosed in tiered-v1 (truncated at 0.78 m), fixed
there, and left live in the flat model that actually trains.

Two candidate fixes, both one-line, needing an A/B to choose between:

1. `WALK_PROGRESS_LEG = 710` — the leg-normalised path already implemented in
   `_payProgress`. Spreads the budget over the whole leg so it is exhausted at
   the waypoint, not before. Risk: pays 309–546 per metre depending on leg
   length, and the tiered-v2 A/B showed a spread budget at 306/m made walkers
   stand still. That A/B predates the 70% cut to the standing rewards, so it may
   no longer hold — which is exactly what the A/B must establish.
2. `WALK_LEG_CAP = 2400` — keeps the full 900/m gradient across the longest leg.
   Breaks the documented `leg < ARRIVE` invariant, so `ARRIVE` needs rescaling
   with it, and that moves the whole economy relative to `FALL`.

Argument that the cap is unnecessary for progress at all: progress is paid for
*closure*, so it cannot be farmed. The most a leg can ever pay is its own length,
and a walker cannot collect all of it without arriving. The invariant the cap
protects is close to vacuous; the dead zone it creates is not.
