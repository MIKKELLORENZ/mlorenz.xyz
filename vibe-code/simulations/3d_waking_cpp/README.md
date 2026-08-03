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
