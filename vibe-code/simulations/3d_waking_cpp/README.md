# 3d_waking_cpp — the walking sim's trainer, in C++

A port of the training half of
[`3d_walk_neuro_evolution`](../3d_walk_neuro_evolution). Same body, same physics,
same sensors, same reward ledger, same genetic algorithm — the JS is still the
reference implementation and the browser is still where you watch a brain walk.
This exists for one reason: **it runs the same experiment about five times faster
on the same box**, which buys generations, not correctness.

Nothing here renders. The browser sim reads `champion.json` and the dashboard
reads the same four files it always did, so the JS side needs no changes at all.

```
./build.sh                       # three binaries, no dependencies
./walk3d_verify                  # the checks that make the port trustworthy
./launch.sh 120                  # trainer + held-out selector + dashboard
```

---

## Measured

| | JS (node 22) | C++ (g++ 13, `-O3 -march=native`) | |
|---|---|---|---|
| held-out exam, 90 episodes, 1 thread | 97.7 s | **22.8 s** | 4.29× |
| training generation, pop 192 × 30 ep, 120 threads | 67.7 s | **12.8 s** | **5.29×** |
| cores drawn of 120 requested | 112 | **114.9** | |
| resident memory, whole run | ~9 GB (120 worker heaps) | **44 MB** | |

The generation speedup exceeds the single-threaded one, and that is not a
measurement error. The JS trainer marshals every brain's weights to every worker
and had to be tuned twice to get the job granularity right — chunking by brain
alone left 96 requested workers drawing only 77.6 cores, and splitting the episode
bank on top of that was what recovered it. Here there is no marshalling at all:
threads read one shared population, so the finest possible job — one (brain,
episode) pair, 5,760 of them per generation for 120 threads — costs nothing and
load imbalance stops being a term.

**A faster wrong simulator is worth less than nothing**, so most of the work here
was proving it is the same simulator.

---

## Why you should believe it

`./walk3d_verify` runs every check below, and the whole point is that not one of
them reports "it ran" — each compares against something already known to be right.

**The layout is derived, then checked against the live JS build.** 22 joints, 194
channels, 364 inputs, 33 outputs, 31 frames of history, 23 bodies, 39 ground
contact points, 65 self-collision pairs, 65.000 kg. All match. This matters more
than it looks: every offset after the joint block is computed from the joint
count, and the day the body gained a joint the JS network silently began reading
joint rates where it expected foot load.

`walk3d_verify --inputs` prints the sensor table generated from that layout, and
asserts the groups sum to both totals — so the documentation cannot drift from
what the brain actually reads.

**The fast inertia transform is checked against the slow one.** `X^T·I·X` was 27%
of all runtime, so it is computed in Plücker blocks with an axis-specialised
rotation congruence instead of as a dense 6×6 product (~144 multiplies against
~432, and ~72 for the nine joints whose origin coincides with their parent's).
Agreement with the dense reference over 400 random states, with a deliberately
non-symmetric inertia so the derivation cannot lean on symmetry it does not have:
**9.6e-15 relative**.

**Free fall has a closed-form answer.** With no contact, no torque and zero
velocity, not one joint may accelerate and the base must see exactly `-g` along
world-up expressed in its own frame. Measured: max |joint q̈| **exactly 0**, base
error **8.2e-16**. This is the one check that pins the `a' = a − a_g` substitution,
which is the place a floating-base ABA can be subtly wrong and still look
plausible.

**A recorded JS episode is replayed tick by tick.** `tools/oracle_episode.js`
records the environment draws, the 364 sensor inputs and the 33 actions from the
real JS build; `walk3d_verify --episode` replays them here.

- Every environment draw is **exact**: start yaw, terrain surface, difficulty,
  friction, friction scale, rise grace, start pose, first waypoint. That checks
  the RNG stream and its draw ORDER before a single physics tick is compared —
  a draw-order bug and a dynamics bug are indistinguishable if you only look at
  tick 400, and they need completely different fixes.
- The sensor vector at **control tick 1 is bit-identical**, 0.0e+00 across all
  364 float32 channels. Tick 1 has no integration behind it, so it isolates the
  entire sensing stack: body build, forward kinematics, terrain sampling, the
  foveal patches, the terrain ring, the pendulum block, the lag window.
- After 400 control ticks (8 s of contact-rich walking) the pelvis has diverged
  by 6e-5 m.

## The sensor change of 2026-08-01

Two additions, mirrored in the JS first and then here, with the tick-by-tick
comparison re-run on the new layout: **all 364 inputs bit-identical for 300
consecutive control ticks**, pelvis agreeing to 3.7e-14 m.

**The centre of mass had no height channel, and the rise tier is paid on it.**
`comHeight()` drives `COM_HOLD`, `COM_RISE_PER_M` and `bestComY` — the whole "get
up off the floor" ladder — while the only height the walker could sense was the
PELVIS origin. On the floor those are not the same quantity: the dense term's
stated intent is that "a walker propped on one elbow already outscores one lying
flat", and the pelvis is on the ground in both cases. walker.js states the rule
itself, about heading — *a reward for a quantity that is not in the observation is
a reward for luck*. Rising from the floor has read 0/6 for every champion this
project has produced. The COM velocity channel was not a substitute: it computed
the offset every tick, differenced it, and threw the position away.

Added: COM height above the ground (1), COM position over the midpoint of the feet
(2), and the **capture point** (2) — ξ = com + v·√(h/g), where a foot must land to
stop the fall. The last is not recoverable by selection: it needs a square root of
one channel multiplied by another, the same argument already accepted for foot
attitude.

**The terrain fan looked forward only.** Four distances × five lateral offsets,
±0.5 m wide — and from stage 3 roughly a third of legs double back, so every turn
was onto ground the walker had never seen. Replaced by a 360° ring: three radii out
to 1 m × twelve directions, heading-relative. A uniform 1 m grid at 10 cm would be
~314 cells and would nearly double the genome, because every input costs 48
weights; the ring foveates in angle the way the foot patches foveate in space.

Net: 333 → 364 inputs (+9%). Neither change is A/B'd — terrain sensing only pays at
stage 4+, hundreds of generations away, so these are reasoned rather than measured.

**The port is not bit-identical over a whole episode, and it cannot be.** JS
`Math.hypot` uses a scaling algorithm where this uses plain `sqrt`; V8's `sin` and
libm's `sin` differ in the last ulp. A contact simulation is chaotic, so any
last-bit difference grows.

The honest question is not "does it diverge" but "does it diverge more than the JS
diverges from itself", and that is measurable, because the JS ships a second
dynamics solver. Running the same brain on the same twelve held-out missions with
`WALK3D_ABA=0` — identical physics, different rounding:

```
                     JS/ABA      JS/CRBA      C++
mission 921 upright   17.6 s      67.0 s      54.3 s
mission 962 waypoints    0           1           0
mission 976 waypoints    8           9           8
mission 990 waypoints    6           6          12
mean waypoints        1.67        1.83        2.08
```

Two *JS* runs differing only in rounding swing mission 921 from a 17.6-second
episode to a 67-second one. Short episodes agree to two decimals in all three
columns; only the long ones fork, and they fork the same way for the JS control as
for the port. The scatter is a property of the exam, not of the language.

**That is worth knowing independently of the port**: the held-out ratchet in
`autoselect.sh` picks on mean waypoints over twelve missions, and this says its
noise floor is roughly ±0.2 waypoints. A "new best" inside that band is a coin
toss, not progress.

---

## What is deliberately different

- **One walker per `World`**, where the JS carries a list. Exactly equivalent, not
  an approximation: walkers never interact or collide, and the shared waypoint
  chain is generated by its own RNG in leg order, so a lone walker draws identical
  points at identical times. It also means no thread ever touches another thread's
  episode.
- **Activations live in a caller-supplied buffer.** The JS keeps them on the net,
  which is safe there because each worker deserialises its own copy. Here the
  population is shared memory and many threads evaluate the same brain at once, so
  activations on the net would be a data race — a silent one, producing plausible
  garbage rather than a crash.
- **`std::stable_sort`, never `std::sort`.** JS `Array.prototype.sort` is
  required to be stable, so two brains on identical fitness keep their population
  order — and on a converged pool where several elites are byte-identical clones,
  that ordering decides which is seated as rank 0. `std::sort` would scramble it
  and quietly make the run unreproducible.
- **The reduction runs single-threaded in index order**, so the same `--seed`
  gives the same run at any `--workers`. Summing partial results as they arrive
  would make the floating-point result depend on thread scheduling.
- **The trainer stamps `chart_from.json` itself.** The JS left this to whichever
  shell script started the run; three of them forgot, and the dashboard drew two
  lineages on one axis with the line running to generation 536 and then falling
  back. The process that knows where the run begins should be the one that says so.
- **Selection is inside `walk3d_exam --select`.** The JS autoselect loop parsed
  the exam's own printed summary back out with `sed`, so the ratchet that decides
  which brain the project keeps depended on the spacing of a human-readable line.
  The log format it writes is unchanged, because the dashboard parses it.
- **`raycast` is not ported.** The LiDAR it served was replaced by the foveal
  patches and the lateral fan; carrying dead code across a port is how a second
  source of truth gets started.
- **No `-ffast-math`.** It licenses reassociation and assumes no NaN — and this
  code *tests* for NaN (`MultiBody::blown`) to retire a walker whose dynamics blew
  up rather than let it poison the gene pool. Under `-ffast-math` that test is dead
  code the optimiser may delete, and a blown walker would be scored instead of
  retired.

---

## Layout

```
src/rng.hpp          mulberry32, bit-for-bit with the JS
src/json.hpp         enough JSON to round-trip a champion file
src/nn.hpp           the network. float32 weights, double accumulation
src/physics.hpp      Featherstone ABA + the block-structured inertia transform
src/body.hpp         the humanoid, its poses, contacts and collision spheres
src/terrain.hpp      the analytic height field
src/walker.hpp       sensor layout, reward ledger, walker state
src/walker_impl.hpp  the methods that need a World
src/world.hpp        one episode: stages, missions, weather, shoves
src/episode.hpp      the single definition of "run one episode"
src/evolution.hpp    the GA, the plateau tracks, the curriculum
src/train.cpp  exam.cpp  verify.cpp
tools/oracle_episode.js   records a JS episode for verify --episode
```

Interop is exact in both directions: a champion written here loads in
`Net.fromJSON` with **zero** float32 round-trip error, and the browser sim reads
it unchanged.

---

## Running

```bash
./launch.sh 120                          # deadline 19:30 UTC today
./launch.sh 120 '2026-08-02 08:00:00'    # or name one
```

The dashboard needs a tunnel — only port 11 is NATed on this box:

```
ssh -N -L 8913:localhost:8913 <your-training-host>
```

`--stage-lock` must match the `--stage` given to `autoselect.sh`. A champion
trained at stage 3 and examined at stage 4 meets harder shoves and sharper
courses, so a low score says "harder exam", not "worse walker" — this project lost
an afternoon to exactly that once, and `exam.cpp` says so twice for a reason.

---

## 2026-09-14 — distillation tools

The GA could not learn to get up (signal-limited, see the JS folder's
`what_worked.md`, "Update, 2026-09-14"). These tools built a per-decision
teacher and cloned it; the shipped brain is `dag/f22.json` (seed 22 of five fits on identical data; `dag/s8.json` was the earlier pick).

| | |
|---|---|
| `src/dagger.cpp` → `walk3d_dagger` | labels every control tick with a teacher (walking champion while upright, phase-tracked rise reference while down), records samples, and doubles as the on-policy evaluator. Uses an `ActionHook` on `Walker::control` that is null for every other binary. |
| `src/risesearch.cpp` → `walk3d_risesearch` | open-loop rise search in network output space; `--finisher` scores a gene by what the closed-loop champion ends in after handover (the version that found a standing kneel rise); `--chain`, `--residual`, `--init` variants. **Vary the mission seed**: it drives the pose jitter. |
| `distil.py` | PyTorch (system python3 on the node) fit of 365-48-32-33 leaky-ReLU to the samples; folds input standardisation into layer 1; parity-checks the export against `nn.hpp`'s forward pass (2e-7). |
| `dagger.sh`, `dagger_more.sh` | the rounds (β 1 → 0, refit from scratch on the union each time); `DAGDIR`, `REFS`, `EXTRA`, `DAGGER_ARGS` env vars. |
| `duel.sh`, `duel_final.sh` | the ship/no-ship instrument: every finalist driving itself on one fresh block, same binary. Never compare across binaries — the episode plan changes with the flags. |
| `go_polish.sh`, `go_polish5.sh` | GA from a distilled seed (`--mut-reset 0`, small steps, stage 5 locked). Ten generations keep the rise; fifteen lose it. |
| `dag/rob3_kneel.json` | the kneel rise reference (6 knots, 3 s) that ends standing when the champion finishes it. `dag/fin6_kneel.json` is its parent. |

`nn.hpp` gained `mutResetRef()` (`--mut-reset`, default 0.03 as before).

---

## 2026-09-15 — the two-net brain, rise GAs, and honest counting

The distilled single net topped out at a kneel rise that "rose" 55 % of the
time by the walker's recovery flag and **held** (no fall within 3 s) 8 %. Two
changes made a real getting-up skill and one caught the counting error.

**Count held, not rose.** `walk3d_dagger` now prints `held a/b` per pose, and
`pick_best.py`, the self-label rule and the rise-only trainer's bonus all use
it. The recovery flag fires 0.35 s after "upright enough" — mid-rise for a
searched motion, and immediately for a crouch or seat start (the pose is
already at the flag's thresholds), so "rose" on those poses measures nothing.
`--verbose 1` on the harness prints per-episode `recov / falls / upright`; look
at it before trusting any rate. `src/probe_fall.cpp` runs the trainer's own
episode path on one brain and prints what each episode scored — it is how the
trial and the harness were reconciled three times tonight.

**Two-net brain.** `Walker::riseBrain` drives while `downed` and for
`RISE_HANDOFF` = 1 s after recovery; the walking net otherwise. Crouch starts
and `horse` are routed to the walking net (`crouchStart`) — it starts better
from them than any rise net does. `bake_brain.js walker.json --rise rise.json`
bakes both (`DEFAULT_BRAIN.riseNet`); the harness takes `--student-rise`.
Distilling a 65 % riser into the walking net kept 20 % of it; kept apart, the
brain walks 5.9 wp AND holds 79 % of kneel starts. `stood` is credited on
recovery (both sides), or a walker that rose via the rise net earned no
arrivals: its natural stance is ~0.90 of standing hip height and the stand
milestone's 0.93 was only ever met by the crouch-to-stand overshoot.

**Rise-only GA (`go_riseonly.sh`, `walk3d_train --rise-only`).** From a brain
with an 8 % held kneel rise it reached 65–79 % in ~150 generations at 96
episodes per brain (8–24 episodes rank on the winner's curse). What it needed:
the held bonus (`rose && upright >= T-3 s`), snapshots exported in the
rise-only branch (`--export-every`) and picked by the harness, `--rise-pose
a,b,c` dealt per episode slot so nothing is forgotten, and the `fall:` start
spawning STANDING (the stage's own crouch deal survived the spec lookup and a
"heap" GA was paid for crouch rises). Mutation scale matters: 0.02/0.015
refines a skill and never creates one (seat: 0 in 86 gens); 0.06/0.05 created
a 93 % seat:0.25 hold in 30 gens — and lost kneel. `--rise-rank mean` picks
the specialist, `min` picks the do-nothing generalist, `gate:<thr>` (rank by
mean among brains keeping the seeded pose) is the one to use.

**Start-pose specs** (`Model::poseBySpec`, resolved in `World::init` from
`WorldOpts::riseTrial`, so `--rise-pose` and the harness `--poses` take them):
`crouch:x`, `seat:x`, `rise:x`, `lerp:A:B:t` (blend; the reverse-curriculum
rung), `jit:pose:amp` (mission-seeded joint/pitch/roll noise), `fall:x` (spawn
standing, one hard shove, episode rebased a second after landing — the
walker's own heaps). `go_curric.sh` drives a curriculum (advance on held ≥
49/82 on the rung and on the checks), `go_mix.sh` a fixed mix with per-pose
measurement every 5 min, `go_heap.sh` the fall start. `src/refstate.hpp` holds
the (joints, gravity) descriptor shared by the tracker and `risesearch
--target` (dense pose-target term; still 0/6 beyond kneel).

Where it is stuck (2026-09-15 04:00 UTC): kneel 79 % and crouch 70 % held;
seated / quadruped / prone / supine / side and recovery after a real fall are
0. See `3d_walk_neuro_evolution/what_worked.md` and `dag5/ASSESSMENT.md` on the
node for the numbers and the reasoning.

**Extension 2026-09-15 (01:35–02:40 UTC).** `--student-rise-pose name=file,…` on the
harness and `bake_brain.js --rise-pose name=file` (repeatable) route a per-pose
specialist rise net by start pose (`riseNets` in the baked brain; the general
`--rise` net drives every other down state). Single-pose specialist GAs for the
sitting/lying pool poses reached 0/82 held in 45 min. Kneel on varied terrain is
the shipped brain's weak spot (14/90 held vs 80/90 flat); a varied-terrain
refinement did not move in 71 gens — `go_riseonly.sh` takes `TERRAIN=`, `go_mix.sh`
takes `FLOORFLAT=` for the measurement. Full log: node `dag5/PLAN_7H.md`,
assessment in `dag/ASSESSMENT_20260915.md` here.
