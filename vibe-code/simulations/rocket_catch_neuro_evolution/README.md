# Learning to be Caught

A 250-tonne stainless steel cylinder with no landing legs falls out of the sky,
and its only acceptable ending is to be plucked out of the air by two steel arms
on a tower, 120 metres up, at walking pace, inside a box 1.8 m wide. A genetic
algorithm is asked to find the controller.

The same genome also has to fly the **Ship** — which falls flat on its back at
78 m/s, has to rotate ninety degrees in the last kilometre, and lands on a header
tank's worth of propellant.

Nothing about flying either vehicle is written by hand. When to light the
engines, how many, when to shed them, how far to gimbal, how to work three grid
fins or four flaps, when to put the legs out, and — every flight — whether to
commit to the tower or give up and go to the water: all ten outputs, at 20 Hz,
come out of the network. There is no gradient descent anywhere in the pipeline.

## Running it

- **The page** (`index.html`) is playback only. It rebuilds a scenario from its
  seed and flies it live with the same physics the trainer used, so the numbers
  in the corner are the real ones. Works from `file://` with no server and no
  network. Query flags: `?nointro`, `&stage=0..6`, `&cam=chase|orbit|tower|pad`.
- **The tests**: `node test_headless.js` — 177 checks, most of which exist
  because something specific went wrong during the build.
- **Training**: `node train.js --workers 88 --pop 448 --episodes 20`. Node only.
- **Fetching champions**: `./pull_champion.sh` (once) or
  `./pull_champion.sh --watch 10` (every ten minutes). A Windows Scheduled Task
  named `RocketCatchChampion` already does this every ten minutes; remove it
  with `schtasks /Delete /TN RocketCatchChampion /F`, and its log is
  `training/watch.log`.

## What the simulation actually models

Six-degree-of-freedom rigid body at 200 Hz, control at 20 Hz.

**Aerodynamics are strip theory, not a coefficient table.** The body is cut into
twenty slices and each is given the flow that is actually passing it, including
the part that comes from the vehicle's own rotation. Three things the task
depends on fall out of that rather than being put in:

- A Super Heavy falling tail-first is **statically stable**, because its engines
  and its residual methalox are both at the leading end. Nobody wrote that down;
  it is what the strip integral says about a tube whose centre of mass is at 29%
  of its length.
- **Pitch damping exists without a damping derivative**, with the correct
  dependence on air density, so it correctly vanishes at altitude.
- The Ship's belly-flop **terminal velocity is 78 m/s**. Nothing was tuned to
  produce that; it is 468 m² of flank against 165 tonnes.

**Grid fins** are three panels in a T at 90°/180°/270°, with no fin on the
tower-facing side — the V3 layout — modelled as plates in the local flow hinged
about the radius. They lose about half their authority through the transonic
band, which is real and is a genuinely hard few seconds for a controller that
has learned to trust them.

**Flaps** are four drag paddles hinged about lines parallel to the long axis,
lying on the hull at 108° off the tiled centreline: tucked they fold back along
the leeward flank edge-on to the belly flow, extended they face it squarely.
They are not wings and generate no useful lift. Pitch is the forward pair
against the aft pair, roll is left against right. Their geometry — hinge
azimuth, chord, span — is written down once, in `vehicle.js`, and both the
aerodynamics and the renderer derive from it, because the version where each
file had its own idea of where the hinge was is what made the flaps appear to
float.

**Weather** is a boundary layer that veers with altitude, an optional low jet,
and frozen turbulence — written as a pure function of (altitude, time) so that
re-flying a scenario gives bit-identical air.

**The hardware fights back.** Raptors cannot throttle below 40%, take 450 ms to
come up, and a landing burn lights thirteen engines and sheds ten through a door
that only opens one way (three ignition credits, and stepping up costs one).
Propellant is finite and moves the centre of mass 5 m as it burns.

### The number that defines the problem

Three Raptors at their 40% floor under a 270-tonne booster is a thrust-to-weight
of **1.25**, and thirteen at full throttle is **13.1**. There is no throttle
setting that descends gently at the top of that range and none that holds
altitude at the bottom. The landing burn is a hoverslam: arrive at zero velocity
at exactly the rail height, or do not arrive.

## Which vehicle this is

**Block 3 / V3, throughout.** The choice matters because SpaceX changed the
booster between versions and mixing the two is itself a bug: 72.3 m, **three**
grid fins in a T at 90°/180°/270° with none on the tower-facing side, 7.5 m ×
3.75 m each, mounted low enough on the tank to work at a steep angle of attack,
with the catch hardpoints just below them. The four-fin 71 m vehicle in the
famous catch footage is a different aircraft and none of its numbers are used
here.

The T is not a cosmetic choice. Three fins put 28 m² of lattice on three sides
and nothing on the fourth, so **their axial drag alone does not balance**: at
zero angle of attack, in still air, with every surface neutral, it sums to
0.8 MN·m of pitching moment. Remove the fins and it is exactly zero. The
booster has to trim that continuously, and the mixing matrix a controller needs
is not the symmetric one a 120° or four-fin layout would give.

## Physics validation

Checked against the published telemetry reconstruction in `info.md`. The
`acceptance suite` sections of the test file assert all of these.

| Checkpoint | Spec | This sim |
|---|---|---|
| Ship belly-flop terminal velocity | 70–90 m/s | **79 m/s** |
| Booster landing mass | 265–320 t | **278 t** |
| Booster pitch inertia | ~1.0 × 10⁸ | **1.3 × 10⁸** |
| Ship mass at flip | ~165–170 t | **165 t** |
| Ship pitch inertia | ~3.8 × 10⁷ | **4.5 × 10⁷** |
| Ship hovers on one engine | ~60–75% throttle | **59%** |
| Booster T/W, 3 engines at the floor | > 1, ~+2–3 m/s² | **1.25, +2.4 m/s²** |
| One Raptor at 100% | 2.75 MN | **2.75 MN** |
| Mass flow per engine at 100% | 650–850 kg/s | **850 kg/s** |
| Booster tail-first stability | passively stable | stable, damped |
| Ship flip, 90° | 3–5 s at 25–40 °/s | **3.2 s at 22 °/s** |

One number is deliberately outside its band. The booster's tail-first
equilibrium at 3.5 km comes out at **289 m/s** against a quoted 330–360, and the
gap is not an error — it is the two things the Cd = 1.0, A = 63.6 m² rule of
thumb leaves out. The bare body measures Cd 1.22 there rather than 1.0, because
Mach 0.9 is inside the transonic drag rise, and the three grid fins add a
further 14%. Both are real, so the test asserts the **decomposition** — bare-body
Cd, and the fraction the fins contribute — rather than the headline number that
depends on a coefficient nobody measured.

## How it is trained

A population of 448 networks (200 → 128 → 96 → 10, tanh, 39 082 weights) on a
128-core machine.

- **Common random numbers.** Every individual in a generation flies the *same*
  twenty scenarios — same wind, same engine failure at the same second. The
  comparison is between policies, not between weather reports.
- **The bank is held for ten generations** before rotating. This is not an
  optimisation. With the bank redrawn every generation the objective itself
  moves faster than the population can climb it, and eighty-five generations
  produced no trend in any statistic.
- **Fitness is an advantage** over a vehicle that does nothing at all on the
  identical flight, weighted 70% mean and 30% worst episode. Inaction is used
  rather than the scripted autopilot deliberately: nothing designed by hand gets
  to touch the search.
- **Champions are crowned only on a held-out bank** drawn from a reserved seed
  block the training set can never touch.
- **Both vehicles from generation one.** Evolving the booster first and adding
  the Ship later produces a genome that unlearns the booster while it learns the
  flop, and there is no gradient here to gently re-balance it.

`autopilot.js` is a hand-written classical controller. It is **not** what flies
the trained vehicle. It exists to prove the environment is flyable at all, and as
something to compare against in the browser.

### Why the acceptance suite refuses to test some things

A reconstruction of a real landing gives two kinds of number, and the test file
treats them differently on purpose.

Terminal velocities, thrust-to-weight, mass flow and geometry are **properties
of the environment**. They are asserted. If any of them moves, something broke.

Burn duration, flip duration, monotone descent, arrival speed are **properties
of a flight**, and there is no hand-written guidance anywhere in the training
loop — not an ignition altitude, not a throttle law, not a flip trigger. So what
is asserted is that the environment *admits* a flight with those properties:
a scripted probe, living only in the test file, flies the constant-deceleration
law and the descent is checked for the things the reconstruction actually cares
about — that altitude never increases after ignition, that the vehicle arrives
at the rail height rather than above it, that it can be taken by the arms. A
trajectory band that no controller could hit is a broken simulation. A
trajectory band a controller could hit and this network does not is an untrained
network, and asserting it would only be a way of failing the test suite every
day until the search finished.

Writing that probe was itself informative. Three versions of it flew into the
ground before one landed, and every failure was a guidance error the doc names:
sizing the ignition point off full thrust instead of the throttle the vehicle
would actually hold; forgetting that 350 ms of dwell plus 450 ms to light plus a
spool is 300 m of altitude at 150 m/s; and planning the descent around a
deceleration below the 40% floor, which pins the throttle at its minimum, over-
brakes, and turns the arrival into a 700 m climb. That last one is exactly the
"the booster ascends when the landing engines light" symptom, and it is not a
thrust bug — the thrust is right, and the vehicle cannot hover.

## Four things that each looked like "the GA is slow"

Every one produced a flat fitness curve, and only the last was about the search.

1. **Gaussian scoring kernels.** A 7 m/s scale returns exp(−1275) for a 250 m/s
   arrival and exp(−204) for a 100 m/s one: both are zero in double precision, so
   the entire first half of the task — learning that there is such a thing as a
   landing burn — was invisible to selection. Measured: a correctly flown
   hoverslam scored 0.33 and doing literally nothing scored 0.19, so the whole
   reward for flying the vehicle properly was 0.14, buried in noise several times
   its own size. Heavy-tailed kernels turned the same comparison into 0.08
   against 0.59.

2. **Uprightness was free.** A booster falling tail-first stays within two
   degrees of vertical all the way to the ground with its engines cold, so
   scoring attitude as a free-standing term paid a rock to be a rock: doing
   nothing scored **0.61**, better than the scripted autopilot and better than
   three quarters of a fresh population. The attitude margins are now gated by
   the speed margin — arriving upright means nothing if you arrive at 250 m/s.

3. **A flat tower-strike penalty.** Four of six held-out stage-0 episodes ended
   as tower strikes *for the scripted controller*, so for anything less precise
   the expected value of approaching the tower at all was strongly negative and
   the best available move was to divert every time and never discover the catch.
   There was no first step. The penalty is now graded by impact speed, so
   brushing the arms at 2 m/s costs 0.28 and arriving at 70 m/s costs 1.15 —
   "hit it slowly" is the same skill as "be caught".

4. **Quitting paid.** With the bank held steady the population found, in
   twenty-five generations, that losing control at altitude scored better than
   flying all the way down: tumbles went from 17% to 76% while tower strikes fell
   to nothing. Terminating on a tumble scores the vehicle where it *stopped*, and
   a vehicle that gives up at 300 m doing 50 m/s presents a much better terminal
   state than one that arrives at 250. A tumbling booster now keeps falling, out
   of control, to the ground that was always coming.

## Status

The environment is validated and the top of the reward surface is reachable — a
clean vertical approach onto the gate is caught, and scores 3.5 against 0.08 for
doing nothing. The test suite asserts all of that so it cannot quietly rot.

Training is **stuck**, which is a different thing from early. The run reached
generation 947 with fitness flat at 0.284 for hundreds of generations, still on
curriculum rung 0 for both vehicles, and with zero catches, zero landings and
zero diverts across the whole population — the best individual on the held-out
bank is still the one crowned at generation 75. Within-era fitness climbs and
the exam does not follow, so selection is finding something that does not
generalise. That is the open problem, and it is not any of the four bugs above:
those all produced a flat curve, and this one produces a curve that rises onto
a plateau the exam cannot see.

## The champion library

Champions are never overwritten. Each one is archived under
`training/champions/<id>.json` and identified by an **8-hex FNV hash of its own
weights** rather than by a counter, which buys two things: pulling the same
champion twice is a no-op instead of a duplicate, and an individual in the
browser can be matched against a file on the training box by eye. Generation
numbers cannot do either — runs restart, and the same generation number means
different things in different runs.

`brain_library.js` carries the best ten into the page, **sorted by held-out
score, best first**, which is what the picker in the sidebar says on its label.
That ordering is worth stating explicitly: a list of champions reads as
chronological unless you are told otherwise, and here a later generation is
quite often worse than an earlier one — the exam is the only thing that decides.

Weights ship as base64 little-endian Float32 rather than JSON decimals: 204 kB
per genome instead of 786 kB, which is the difference between a page that loads
ten of them and one that does not.

## Files

| | |
|---|---|
| `mathx.js` | vectors, quaternions, the scoring kernels |
| `atmosphere.js` | ISA, and a stateless wind field |
| `vehicle.js` | both vehicles, the engines, the tower, the capture box |
| `aero.js` | strip theory, grid fins, flaps |
| `world.js` | rigid body, termination, scoring |
| `sensors.js` | the 200 inputs, including the differenced temporal window |
| `nn.js` | the network, mutation, crossover |
| `scenarios.js` | the episode bank and the curriculum |
| `evolution.js` | selection, breeding, the curriculum ladder |
| `train.js` | headless trainer, worker pool, the held-out exam |
| `autopilot.js` | the hand-written reference controller (not used in training) |
| `test_headless.js` | 177 checks, including the acceptance suite |
| `render.js`, `main.js`, `index.html`, `style.css` | the playback page |
| `sync_champion.js` | archive a champion, rebuild `brain_library.js` |
| `pull_champion.sh`, `pull_champion.cmd` | fetch from the training box; the `.cmd` is what the Scheduled Task runs |
| `brain_library.js` | GENERATED — the champions the page loads |
| `training/champions/` | every champion ever produced, by weight hash |
| `info.md` | the vehicle specification this was built against |
