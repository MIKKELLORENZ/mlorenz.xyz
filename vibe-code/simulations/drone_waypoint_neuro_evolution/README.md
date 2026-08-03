# Learning to Fly — Drone Waypoint Neuroevolution

Neuroevolution of a quadrotor in a room, in the browser. Open `index.html` —
no build step, no dependencies beyond the bundled three.js.

A 1 kg quad starts on a pad with four rotors and no idea what they do. It has
to take off, work out which way is up, hold an attitude, and fly to waypoints
scattered through the volume — past pillars, through doorways, under shelving.
**Touching anything is instant elimination.** Nothing is scripted: there is no
attitude controller, no altitude hold and no mixer underneath the network. It
commands the four rotors directly, and everything above that it has to evolve.

There is no gradient descent anywhere in this repository.

## The aircraft

A 250 mm class quad, SI units throughout. Mass 1.0 kg, 0.32 m across the
rotors, four rotors at 5.4 N each (thrust-to-weight ≈ 2.2), inertia 0.018 /
0.030 / 0.018 kg·m². Attitude is a unit quaternion, so nothing gimbal-locks
when a drone flips. Physics runs at 120 Hz, the control loop at 30 Hz — the
cadence an outer navigation loop on a real flight controller would use.

Rotors are an X layout with diagonal pairs spinning the same way, so yaw comes
from the reaction-torque imbalance between the pairs, exactly as on real
hardware. Motors have a 50 ms first-order spin-up lag, blades have flapping
damping, and the airframe has linear + quadratic drag against the local air.

The airframe is deliberately geared so that **all four rotors at 0.5 throttle
is a modest climb** (10.8 N against 9.81 N of weight). Combined with the
near-zero output-layer initialisation in `nn.js`, that means a brand-new random
brain leaves the pad and drifts upward instead of flipping — the difference
between a generation 1 with something to select on and sixty identical piles of
wreckage.

That number is the most sensitive one in the sim, and far more sensitive than
it looks, because what matters is the climb margin against the *spread* of that
margin across fresh brains. Measured over 32 random brains × 6 seeds:

| `TMAX` | climb margin | left the ground | reached arming height | mean airtime |
|---|---|---|---|---|
| 5.40 | +0.99 N | **100%** | 93% | 2.33 s |
| 5.20 | +0.59 N | 95% | 47% | 1.27 s |
| 5.00 | +0.19 N | 19% | 4% | 0.12 s |
| 4.90 | −0.01 N | 1% | 1% | 0.02 s |

A 0.19 N margin reads like a gentle climb and is in fact a coin flip. Going the
other way is no safer: at 5.5 the default climb is brisk enough that taking off
correlates with hitting the ceiling, and the population evolves to sit still.

## Brain contract (what a real controller would implement)

**55 channels fed as a per-channel temporal window = 226 inputs.** Each channel
is fed as its last few control ticks, newest first, so the net reads rates and
trends — closing speed on an obstacle ray, bearing rate, the angular-rate
history that turns a P attitude loop into a PD one — with no recurrence at all.

The lag slots are `[0, 1, 2, 3, 4, 6, 8, 10, 15, 30]` control ticks: ten of
them, dense at the front where a 30 Hz attitude loop lives, thinning out to a
full second back where only slow drift matters. Each channel takes the first
*n* of those slots, so fast, rate-critical channels run deep and slow ones run
shallow — depth where it pays, no redundant weights where it does not.

(Ten slots *including* the current tick, which means the requested `n−20` was
dropped to make room for `n−30`. If you want the literal eleven-slot window
instead, `LAGS` in `drone.js` is a one-line change — but it moves `NIN`, so
every existing champion has to be retrained.)

| Channels | What | Slots |
|---|---|---|
| 0–31 | 32 distance sensors, evenly spaced on the sphere (Fibonacci lattice), body-frame, 12 m range | 3 |
| 32–34 | gyroscope — body angular rate p, q, r | 8 |
| 35–37 | accelerometer — body-frame specific force | 4 |
| 38–40 | unit vector to the current waypoint, in body frame | 3 |
| 41 | distance to the waypoint | 4 |
| 42–44 | heading error to the waypoint bearing: sin, cos, and the signed normalised angle | 3 |
| 45–48 | how fast each rotor is actually spinning, after the motor lag | 6 |
| 49–51 | body-frame gravity — which way is down, from the AHRS | 10 |
| 52–54 | body-frame velocity | 6 |

The sensor directions are fixed **in the body frame**, so sensor *k* always
means "*k* metres of air off that corner of the airframe" no matter how the
drone is oriented — the net can learn a stable map from sensor index to evasive
action. That is what a rangefinder array bolted to the airframe gives you.

### The sensors are cones, and that is not a detail

Each of the 32 sensors is a **cone** — four rays at an 18° half-angle, reported
as the minimum — and every surface is **grown by the drone's collision radius**
before it is measured, so a reading means *metres until I hit this*: the same
quantity the crash test uses.

Both parts were retrofits, and the sim did not work without them. 32 directions
over a full sphere sit about 40° apart. A 1.4 m pillar seen from 6 m subtends
13°, so it falls clean between two rays. Measured on the original pencil-ray
model, flying straight at a pillar:

```
gap 8.0 m -> 0 of 32 rays see the pillar
gap 6.0 m -> 0 of 32 rays see the pillar
gap 4.0 m -> 1 of 32 rays see the pillar, nearest 4.30 m
gap 0.7 m -> 2 of 32 rays see the pillar, nearest 1.47 m
```

Blind past 4 m, and one flickering ray after that, reporting 1.47 m when the
real gap was 0.7 m because it was clipping a far corner. No policy can learn to
avoid a thing it cannot see, and stage 1 duly stalled — 220 generations moved
the champion from 700 to 3,168 and mean waypoints to 0.27. With cones the beams
tile the sphere with no blind gaps, and the same approach reads 3.79 → 2.79 →
1.79 → 0.78 m at gaps of 4, 3, 2 and 1 m: a smooth, monotone, correctly scaled
signal. A real time-of-flight or ultrasonic rangefinder has a beam several
degrees wide and returns the nearest thing anywhere in it — the pencil ray was
the unphysical model, not this one. `test_headless.js` pins the whole approach
curve so it cannot silently regress.

Channels 49–51 are the one addition beyond a bare IMU, and they earn their
place: an accelerometer measures *specific force*, not gravity, so under thrust
it cannot tell level flight from a coordinated dive. Without an attitude
estimate the policy is blind to which way is up exactly when it is manoeuvring
— which is exactly when that matters.

**4 outputs:** rotor 0, 1, 2, 3 throttle, each 0..1. Nothing else.

Export the champion from the UI: the JSON holds the raw weight matrices for the
fixed 226→40→24→4 tanh/sigmoid net.

## Fitness, and why it is shaped this way

In priority order: **waypoints reached ≫ closest approach on the current leg ≫
controlled airtime.**

- **Waypoints** are worth 1000 plus a bonus that decays with how long the leg
  took, minus a charge for distance flown beyond what the leg needed. Reaching
  one also **adds 10 seconds to that drone's own clock**, so a drone that keeps
  finding waypoints keeps flying.
- **Leg progress** is the *closest approach ever achieved*, never the current
  distance — orbiting the target or drifting back out earns nothing.
- **Controlled airtime** is worth 10/s, capped at 200, and only accrues while
  airborne *and* within ~72° of level. Without that upright gate a tumbling
  drone that happens to stay inside the room farms the same airtime as one that
  is actually flying, and the population learns to spin instead of to hover.
- **A crash** costs only 100 points. That number is small on purpose: the real
  cost of a crash is the forfeited future — every remaining second of clock and
  every waypoint still to come — and that cost grows by itself as brains get
  better. A large fixed penalty prices the crash before there *is* a future to
  forfeit, and generation 1 correctly concludes that the safest thing a drone
  can do is never leave the pad. Measured at 300, the population's takeoff rate
  fell from 70% to 5% over twenty generations.

Two exploits were found and closed during development, both recorded in the
tests so they stay closed:

- **Ground-effect skimming.** With the arming height at 0.7 m a population
  learned to skim the room at 0.5 m, collecting approach credit and clipping low
  waypoints while staying technically "not yet taken off" and so immune to the
  floor. Fixed from the other end: no waypoint is ever placed below `WP_FLOOR`,
  and `WP_FLOOR − TAKEOFF_H` is wider than the arrival radius, so nothing down
  there can be reached.
- **The 23 cm window.** Dropping the arming height to 0.45 m instead meant the
  survivable gap between arming and dying was a hand's width, so the first thing
  evolution had to solve was "never sink 23 cm". It never did — mean airtime sat
  flat at 1.5 s for thirty generations. Arming now happens at 1.2 m, leaving a
  metre to bob in while learning altitude hold.

And one that was not an exploit but a **trap in the level design**, found by
flying an early champion and watching the telemetry rather than the score:

```
 t(s)   alt   speed  upright  dist-to-wp   state
  1.5   1.24   5.73    0.94        9.1    airborne
  2.5   2.77   5.81    0.82        3.4    airborne
  3.0   3.59   4.74    1.00        1.1    airborne     <- waypoint reached
  3.5   4.85   4.22    0.86       17.8    airborne
  3.9    —      —       —          —      CRASHED
```

The drone had genuinely learned the job — off the pad, up to 5.8 m/s, straight
at a point 13 m away, arriving in 3.2 seconds. Then it hit a wall. Waypoints
were being placed as close as 1.8 m to a wall, and a drone arriving at 5–6 m/s
needs about 3 m to wash the speed off, so the course rewarded flying fast at the
target and then killed whatever did. No amount of selection fixes a course whose
reward and whose survival point in opposite directions. Waypoints now keep 3.2 m
off the walls and 2.2 m off every obstacle: somewhere you can arrive *and leave*.

Time is the resource that keeps all of this honest: each drone starts with an
18-second clock, every waypoint tops it up, and a drone whose clock empties
freezes with its score locked. A stable hover is a rung on the ladder, not a
destination — the clock runs out while you do it.

## Evolution (no gradient descent)

Per generation, ranked by fitness: 4 elites copied untouched → mutated elite
copies → elite × elite row-wise crossovers → a rank-weighted "gradient" of
riskier children (mutation strength grows down the roster) → a couple of fresh
random brains. Two fitness gates narrow the search as a run matures: past 9k no
more random immigrants, past 20k no more crossover either — the population
becomes pure hill-climbing on the champion.

Crossover swaps **whole neurons** (a row of incoming weights plus its bias)
rather than individual weights: swapping individual weights scrambles what each
neuron computes, swapping neurons keeps functional units intact.

**Champion grace** (default 3 generations, 0 = off): a drone lives or dies on
one episode, and one unlucky waypoint behind a pillar can wipe out a genuinely
good brain. The reigning champion keeps an untouched seat for a few generations
after being beaten. Only one drone holds grace at a time; defending the title
refreshes it.

## Rooms and the curriculum

Three hand-authored rooms, never regenerated — a drone that has learned to slip
through the Warehouse's door gap should still find it next generation.

0. **Empty Hall** — a bare 26 × 18 m room, 8 m to the ceiling, still air.
   Learn to leave the pad, hold an attitude, and fly to a point in space.
1. **Pillar Field** — eight floor-to-ceiling columns on a staggered grid, and a
   light draught. The straight line is no longer always free.
2. **The Warehouse** — two partition walls with door gaps (one at floor level,
   one only passable high up), shelving racks floating at mid height, a low
   overhang, and real turbulence.

The ratchet is monotone and threshold-driven, never a bare generation count: it
promotes when the *mean* drone — not the champion — reaches waypoints reliably
for three generations running, and it never demotes. Promoting on a generation
number instead moves the goalposts on a population that has not learned the
previous rung, which is the classic way to lose a run.

**Unlocking a stage adds a room to the exam, it does not replace it.** Episode 1
of every generation runs the newest room and the rest cycle through the ones
already unlocked, so a generation at stage 2 is scored across all three. This is
not tidiness, it is the fix for a measured regression: training a stage-0
champion in pillars *only* gave

| | hall | pillars | mean fitness across rooms |
|---|---|---|---|
| before stage 1 | **3.00** wp | 0.63 | **2,948** |
| after pillars-only stage 1 | 1.00 wp | 0.75 | 2,004 |

It lost more flying the empty room than it gained flying the hard one, and
"progress" through the curriculum was a net loss — textbook catastrophic
forgetting. A brain now only advances by staying good at everything it has ever
been asked to do.

## Fairness

Every drone in a generation launches from the *same* pad square, flies the
*identical* waypoint sequence, and meets the *same* turbulence. Drones do not
see or collide with each other — they are ghosts sharing a volume purely so a
generation costs one episode instead of sixty. The only variable between two
drones in an episode is the brain.

Each generation is scored over several episodes with different waypoint chains,
and the missions **slide** rather than being redrawn: generation *g* flies
missions *g, g+1, g+2*; generation *g+1* flies *g+1, g+2, g+3*. Consecutive
generations share two thirds of their exam, so the objective drifts slowly
instead of being replaced wholesale, while still moving enough that nobody
overfits one lucky course. Selection needs the paper to stay put for the handful
of generations a hill-climb takes to make a move.

## Training

Training happens in the browser. **Evolve from scratch** in the intro modal (or
*Restart from random brains*) begins a run; tick **Headless** to hide the view
and spend the whole frame budget on physics, or pick **MAX** to run flat out
while still watching.

The panel opens on **the settings that produced the brain baked into this
build** — 96 drones × 4 episodes, mutation 10% at σ 0.09, grace 3, immigrants
off past 1.2, crossover off past 2.5 — so a run here is a faithful re-run rather
than a lighter demo. Turn them down to watch, not to train.

Every generation, the best brain re-flies a **fixed six-mission exam** that never
appears in training, and only that score can crown a champion. It is the same
seed constants and stage mix the shipped brain was selected on, so the
`champion` figure in the header is directly comparable with the numbers recorded
in [WHAT_SORT_OF_WORKED.md](WHAT_SORT_OF_WORKED.md). See
[Why the champion is chosen this way](#why-the-champion-is-chosen-this-way) —
without the exam a single lucky generation holds the title forever, and that is
not a hypothetical.

### Driving it headlessly

Everything the panel does, a URL does:

| parameter | effect |
|---|---|
| `train` | start a fresh run instead of showcasing the built-in brain |
| `sync` | run to completion in one blocking loop, no animation frames |
| `gens=N` | stop after N generations, then publish the result |
| `pop=N`, `episodes=N`, `grace=N`, `stagelock=N` | the population knobs |
| `headless`, `noise`, `speed=0` | view and physics switches |
| `seed=N` | fixed population seed, for a reproducible run |
| `nointro` | skip the intro modal |

Chrome's own headless mode is enough — no driver script, no dependencies:

```
chrome --headless=new --disable-gpu --dump-dom \
  "index.html?train&sync&headless&nointro&pop=96&episodes=4&gens=300&seed=11"
```

When the run finishes, the page sets `document.title` to
`DONE gen=… val=… bake=ready` and puts a complete, drop-in `default_brain.js`
in `<pre id="bake-out">` — so a shell one-liner can train a brain and scrape it
out. `window.DRONE_SIM` exposes the same thing (`.bestVal`, `.history`,
`.defaultBrainSource()`, `.runSync()`) for the console.

**`sync` is not a convenience flag.** `--dump-dom` dumps as soon as loading
finishes, so `requestAnimationFrame` never runs and a dump without it captures
generation 1. `--virtual-time-budget` does not rescue it either: virtual time is
frozen for the duration of a script task, so a frame-budget loop measured with
`performance.now()` cannot advance. `sync` steps the whole run inside the load
handler, and the dump then happens afterwards.

### What this costs

The browser is single-threaded. Measured in headless Chrome at the faithful
96 × 4 settings: **≈4.8 s per generation** over the first ten generations. The
Node trainer this replaced spread the population over 15 worker threads and did
2.7 s, so the gap is smaller than it sounds — but it will widen, because early
generations are cheap. A generation where drones die in two seconds is nothing
like one where they fly for ninety, and the shipped brain's lineage ran roughly
**2,900 generations**. That is hours of wall-clock, not minutes.

Splitting a population across threads was exactly equivalent to running it in one
process, because the environment is a pure function of `(missionSeed, noiseSeed)`
— room, waypoint chain, turbulence, sensor noise, the lot — and drones never
interact. That property still holds and is what makes `seed=N` reproducible. It
is only true because the Gaussian sampler caches its Box-Muller spare *on the
RNG* rather than in a module-level variable: with one shared cache, a leftover
spare leaks between consumers and the same seeds produce different turbulence
depending on what happened earlier in the process.

**Fitness is only comparable within one stage.** A brain worth 22,771 in the
Empty Hall is worth about 2,700 in the Pillar Field, so a promotion resets the
champion score and re-measures — both for the training max and for the exam.
Carry the old figure across that boundary and nothing can ever beat it: the
champion freezes and the progress curve stops meaning anything. The population is
still full of the outgoing champion's elites, so if it really is the best brain
in the new room it reclaims the title immediately, having earned it.

## Saving and shipping a trained brain

Three ways in and out, all of the same JSON (raw weight matrices plus the shape):

- **Save / Load** — the champion to and from `localStorage`.
- **Export / Import** — the same JSON as a file, for moving a brain between
  machines or comparing runs.
- **Bake `default_brain.js`** — downloads a drop-in replacement for the file
  `index.html` loads as `DEFAULT_BRAIN`. Put it next to `index.html` and your
  brain is what the page opens on. **When a champion is baked in, opening the
  page flies it immediately** — the whole fleet runs that one brain, so a visitor
  sees a drone that can fly rather than ninety-six random ones falling over.
  With nothing baked, the page says so on the button instead of silently
  showcasing random brains.

Bake always emits **this run's** validated champion, even when the built-in brain
scores higher. That is deliberate and it differs from *Showcase*: baking after a
short run would otherwise quietly hand back the brain already in the page, and a
headless pipeline would report success having changed nothing. If your run is the
weaker brain, the log says so rather than substituting a different one.

**Showcase** runs the best brain available in every drone at once, which is both
the way to actually watch one evolved policy fly and a fair readout of how
repeatable it is: under sensor noise and turbulence, a stable policy keeps the
fleet in formation and a brittle one scatters it. Here "best available" *does*
mean the baked champion unless this session's run has beaten its exam score —
preferring the live champion unconditionally meant the button showcased a random
brain from generation 2, which is technically the champion and not at all what
the button promises.

Every load path re-checks the shape against the current channel table. The weight
matrices only mean anything against the exact sensor suite they evolved against,
and a silently mismatched brain is worse than none.

## Where the baked champion actually got to

The brain in this build was ranked on **four independent seed banks** — 3 rooms ×
8 episodes each, turbulence on, none of those seeds used in training or in the
exam that crowned it. It won all four banks by roughly 2×, against every other
brain the project produced. Full method and per-bank figures are in
[WHAT_SORT_OF_WORKED.md](WHAT_SORT_OF_WORKED.md).

| room | waypoints | best | airtime | crashed | capped |
|---|---|---|---|---|---|
| Empty Hall | 35.84 | 40 | 183.2 s | 31% | 22 / 32 |
| Pillar Field | 2.19 | 7 | 12.5 s | 100% | 0 |
| Warehouse | 1.41 | 4 | 7.8 s | 100% | 0 |

Read that honestly, because the hall number flatters it:

**The Empty Hall is solved past the point of measurement.** `MAX_ARRIVALS` is 40
and 22 of 32 episodes hit it — the drone ran out of waypoints to collect before it
ran out of clock. 35.84 is a *floor*, not a score.

**Neither obstacle room is solved.** 100% crash in both, dying at 8–12 s after
one or two waypoints. Real progress — the previous champion scored a flat 0.00 in
the Warehouse — but not a navigator.

Getting there went through three scoring bugs, and the same measurement shows all
of them:

```
                       hall     pillars   warehouse
stage-0 only            3.00     0.63      0.63
+ pillars only          0.90     0.80      0.80     <- catastrophic forgetting
+ all three, raw        9.90     0.90      0.00     <- room domination
+ per-room normalised  35.84     2.19      1.41     <- shipped
```

The second row is training the new room *instead of* the old ones. The third is
the easy room drowning out the hard one: superb in the empty hall, and it had lost
the warehouse **completely** — worse there than the brain that had never seen it.

This is a *mid-training* sim, not a finished agent, and it has plateaued: the
champion held its exam score for its final 210 generations. The cheapest next
lever is raising `MAX_ARRIVALS`, because the objective has gone flat in the room
the drone is best at.

## Reading the log

`waypoints 0.66/8.67` is mean/best, and both are **means over the generation's
episodes**, so they are fractional — `0.33` means the best drone reached a
waypoint in one episode of three. Waypoints stay flat at zero for a long time;
before they move, takeoff rate rising while crash rate falls is what a working
run looks like. That is what the Skills chart is for.

**Do not quote `best` as a brain's ability.** It is the best of the whole
population *on the exact missions that population was selected against* —
in-sample, and the maximum of 96 samples. A generation logging `waypoints
0.77/5.00` had a champion that scored **3.00 on held-out courses**.

The quieter `exam …` line underneath each generation is the number that means
something: this generation's top brain on the **fixed** six-mission exam, against
the best any generation has managed on it. Only that promotes a brain to
champion, and the header's `champion` figure is its running best.

### Why the champion is chosen this way

Selecting on the training score does not work, and the failure is silent. A
training score is a maximum over a noisy measurement: missions are redrawn every
generation, one fixed brain's score swings by thousands of points depending on
where the waypoints fell, and `best > championFit` therefore ratchets to the
luckiest draw anybody ever got. Measured — a run seeded from a known champion:

```
gen   1  best 8527  avg 2479  air 7.8/28.2s     <- a lucky mission draw
gen  61  best 2377  avg  783
gen 601  best 1910  avg  893
```

Nothing beat 8,527 in 660 generations, so the saved champion stayed frozen at
generation 1 the whole time and the progress curve meant nothing. The fixed
validation exam fixes both: scores are comparable generation to generation, and
a lucky training draw cannot promote anything.

It is a *selection* set rather than a true holdout — six missions can be
overfitted given enough generations — which is why the brain shipped here was
ranked on four further unseen seed banks before being baked, and why you should
treat your own run's exam score as a guide rather than a verdict.

## Dev

`node test_headless.js` runs the sim without a browser: quaternion maths, ray
casts through the Warehouse door gap, hover / free fall / per-axis rotor mixes,
the sensor block and its lag window, the pad and instant death, the fitness
ledger's incentives as arithmetic, episode determinism under fixed seeds, and
the evolution loop plus the curriculum ratchet. It is the regression net over a
set of constants that were tuned the hard way — run it before trusting an edit to
`drone.js` or `room.js`.

`node shot.js [ticks] [room]` writes `shot.html`, which flies the baked champion
for a fixed number of ticks and renders exactly one frame. Nothing animates, so a
screenshot taken any time after load is the same deterministic picture — that is
what makes the thumbnail reproducible rather than a lucky grab:

```
node shot.js 900 pillars
chrome --headless=new --disable-gpu --window-size=960,600 \
       --screenshot=thumbnail.png shot.html
```

There is no Node trainer. Training, validation and baking all happen in the
browser — see [Training](#training).
