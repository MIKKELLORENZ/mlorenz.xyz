# What sort of worked

An honest post-mortem of the drone that is currently baked into the page: what
it can actually do, the reward economy and architecture that produced it, the
seeds it was selected on, and the seeds that were used to check whether any of
that selection meant anything.

The title is chosen carefully. One of the three rooms is solved to the point
where the measurement runs out. The other two are not solved at all.

---

## 1. The artifact

| | |
|---|---|
| File | `default_brain.js` |
| Weights SHA-1 | `c7620bf32435` (first 12, weights rounded to 4dp) |
| Shape | `226-40-24-4`, 10,164 weights |
| Generation | 946 of run13 |
| Selected by | 6-mission fixed exam, score 1.913 |
| Confirmed by | 4 held-out seed banks × 3 rooms × 8 episodes |

Verify the page is flying the brain this document describes:

```bash
node -e "const fs=require('fs'),c=require('crypto');const s=fs.readFileSync('default_brain.js','utf8');
const b=JSON.parse(s.slice(s.indexOf('{'),s.lastIndexOf('}')+1));
console.log(c.createHash('sha1').update(JSON.stringify(b.net.weights.map(a=>a.map(v=>+v.toFixed(4))))).digest('hex').slice(0,12))"
# expect c7620bf32435
```

### Provenance, and why this run is not cleanly reproducible

Run13 did not start from scratch. It resumed a lineage carrying **1,930
generations of history** across twelve earlier runs, and those runs did not all
use the same code — `TAKEOFF_H`, `CRASH_PEN`, the sensor model, the waypoint
margins and the fitness normalisation all changed underneath the lineage as
bugs were found. The weights that survived were shaped by rules that no longer
exist.

So 946 generations from a cold start **will not** reproduce this brain, and I
would not expect it to reach the same place in the same time.

The tooling is gone too. This was trained by a Node worker-thread trainer with a
matching set of evaluation harnesses; all of it has since been deleted, along with
the run logs and intermediate checkpoints, in favour of training in the browser.
The GA, physics, curriculum, reward economy, mission-seed scheme and validation
exam described below are unchanged and still live in the files the page loads —
what went away is the second implementation of the loop around them.

What that leaves behind is a record, not a reproduction: the numbers in §2 were
measured before the harness was removed, and the brain they describe is checked
in. The one claim you can still verify directly is the hash above.

---

## 2. What it actually does

Four independent held-out seed banks, 8 episodes each, turbulence on, none of
these seeds used anywhere in training or in champion selection:

| room | waypoints | best | airtime | crashed | capped |
|---|---|---|---|---|---|
| Empty Hall | 35.84 | 40 | 183.2 s | 31% | 22 / 32 |
| Pillar Field | 2.19 | 7 | 12.5 s | 100% | 0 |
| Warehouse | 1.41 | 4 | 7.8 s | 100% | 0 |

Read that table honestly:

**The Empty Hall is solved past the point of measurement.** `MAX_ARRIVALS` is
40 and 22 of 32 episodes hit it — the drone ran out of waypoints to collect
before it ran out of clock. 35.84 is a *floor*, not a score. Whatever the true
ceiling of this brain in an empty room is, this harness can no longer see it.

**Neither obstacle room is solved.** 100% crash in both. It takes off reliably,
reaches one or two waypoints, then hits something at around 8–12 seconds. That
is real progress — the previous champion scored a flat 0.00 in the Warehouse —
but "reaches two waypoints before dying every single time" is not a navigator.

The gap between 183 s of airtime in an empty room and 8 s in a cluttered one is
the whole remaining problem. It is not a flying problem. It is an obstacle
problem, and the sim never got it working.

### It beat every other saved brain, on every bank

Six distinct brains came out of the project (duplicates folded by weight hash —
several files were the same brain re-saved at a later generation, and listing one
brain three times fakes a consensus).
Primary criterion — fixed before any result was seen — is the mean across rooms
of `sqrt(fitness / roomScale)`, the exact generalist objective the GA optimises;
the tiebreak is worst-room score.

| brain | gen | primary | worst room | bank spread |
|---|---|---|---|---|
| **champion** | **946** | **1.612** | **1.162** | 0.168 |
| champion_v2 | 556 | 0.828 | 0.526 | 0.104 |
| ckpt_stage0 | 556 | 0.814 | 0.721 | 0.141 |
| champion_stage1 | 676 | 0.742 | 0.374 | 0.105 |
| ckpt282 | 281 | 0.402 | 0.307 | 0.072 |
| ckpt_pre_margin | 121 | 0.363 | 0.301 | 0.067 |

Per-bank, to show the win is not one lucky draw:

| brain | A | B | C | D |
|---|---|---|---|---|
| champion | 1.564 | 1.673 | 1.521 | 1.689 |
| champion_v2 | 0.853 | 0.836 | 0.863 | 0.759 |
| ckpt_stage0 | 0.793 | 0.796 | 0.904 | 0.763 |

It wins all four banks by roughly 2×, and wins the worst-room tiebreak too, so
the ranking does not depend on which criterion you prefer. That is as clean as
a result gets here.

---

## 3. Architecture

### Physics — `drone.js`

6-DOF rigid body, unit quaternion attitude (no Euler angles, so no gimbal lock
when it inevitably tumbles), Euler's equation `I·ω̇ = τ − ω × (I·ω)`,
semi-implicit integration at **120 Hz**, control at **30 Hz** (`CONTROL_EVERY = 4`).

```
MASS 1.0 kg          IX 0.018, IY 0.030, IZ 0.018 kg·m²      ARM 0.16 m
TMAX 5.4 N/rotor     MOTOR_TAU 0.05 s      KYAW 0.022 N·m/N
CD_LIN 0.15  CD_QUAD 0.12    CANG_LIN 0.03  CANG_QUAD 0.02
RADIUS 0.22 m (collision sphere)
```

X layout, diagonal pairs counter-rotating; yaw comes only from the reaction
torque differential, so yaw authority is weak and deliberately so.

**`TMAX = 5.4` is the most sensitive constant in the project.** What matters is
not the thrust-to-weight ratio but the climb margin measured against its spread
across *fresh random brains*. 32 random brains × 6 seeds:

| TMAX | margin | left ground | armed | mean airtime |
|---|---|---|---|---|
| 5.40 | +0.99 N | 100% | 93% | 2.33 s |
| 5.20 | +0.59 N | 95% | 47% | 1.27 s |
| 5.00 | +0.19 N | 19% | 4% | 0.12 s |
| 4.90 | −0.01 N | 1% | 1% | 0.02 s |

A 0.19 N margin reads like a gentle climb and is actually a coin flip — output
layer spread swamps it and four fifths of generation 1 never leaves the pad,
which means nothing to select on. I predicted 5.0 would be the better value and
the sweep said 19% vs 100%. Do not shave this without re-running the sweep.

### Sensing

**32 cones, not 32 rays.** Directions come from a Fibonacci sphere lattice, so
they are near-uniform over the full sphere. Each cone is `BEAM_SAMPLES = 4` rays
at `BEAM_HALF_ANGLE = 18°`, and every surface is inflated by the collision
radius before measurement (swept sphere), so a reading means *"metres until I
hit this"* rather than *"metres to a mathematical point"*.

This was not a refinement, it was a bug fix. With pencil rays, **0 of 32
sensors detected a pillar at 6 m range**. The obstacle stages were not hard,
they were invisible, and the GA was being asked to avoid something it had no
channel to perceive.

### Temporal window

No recurrence anywhere. Each of 55 channels keeps a ring buffer and the network
sees a per-channel selection of lags:

```
LAGS = [0, 1, 2, 3, 4, 6, 8, 10, 15, 30]   // control ticks back — 0 to 1.0 s
```

Depth is per-channel, because what a channel is *for* determines how far back it
is worth looking:

| channels | signal | depth | why |
|---|---|---|---|
| 0–31 | range cones | 3 | range, closing rate, closing acceleration |
| 32–34 | gyro | 8 | the D term of the attitude loop — needs to be deep |
| 35–37 | accelerometer | 4 | |
| 38–40 | waypoint direction | 3 | |
| 41 | waypoint distance | 4 | slow, but its rate is closing speed |
| 42–44 | heading error | 3 | |
| 45–48 | rotor spin | 6 | the actuator-lag pipeline |
| 49–51 | gravity vector | 10 | full second — catches slow attitude drift |
| 52–54 | body velocity | 6 | |

Total **226 inputs → 40 → 24 → 4**. The 32 range cones cost 96 of those inputs;
the attitude-critical channels get the deep history instead.

### Weight init

Standard He scaling everywhere except the output layer, which is scaled by
**0.03**. A quadrotor is far more torque-sensitive than a boat hull: at the
inherited 0.08 only 71% of fresh brains got 0.6 m off the ground; at 0.03
essentially all of them do. A fresh brain hovers and drifts rather than
flipping, which is what makes generation 1 selectable.

---

## 4. The reward economy

The single most useful lesson from this project: **almost every "the GA is just
slow" moment was actually a mispriced reward.**

```
WP_REWARD      1000      reaching a waypoint
WP_SPEED_BONUS  300      minus WP_SPEED_DECAY(15)·legSeconds, floored at 0
PROGRESS_W      600      fraction of the current leg closed (best distance)
AIR_W            10/s    controlled flight, capped at AIR_CAP 200
TAKEOFF_BONUS   120      once, on arming
CRASH_PEN       100      see below
EFF_W/SLACK/CAP   5 / 1.35 / 300   throttle above hover, charged per completed leg
UPRIGHT_MIN     0.3      cos tilt below which airtime stops accruing
```

Time is the real currency: a drone is born with **`START_CLOCK` = 18 s** and
each waypoint adds **`WP_TIME_BONUS` = 10 s** (`EPISODE_HARD_CAP` 240 s).
This is requirement 5 from the brief, and it is doing more work than any of the
scalar weights — it makes competence self-financing.

### Four failures worth recording

**`CRASH_PEN` was 300 and the population evolved to never take off.** Takeoff
rate fell 70% → 5% over 20 generations. The real cost of a crash is the
forfeited future — remaining clock, remaining waypoints — and that cost grows on
its own as brains improve. A large fixed penalty prices the crash *before there
is any future to forfeit*, and generation 1 correctly concludes the pad is
safest. Dropping to 100 restored takeoff.

**The efficiency charge was billed continuously,** which meant a drone that died
early paid less than one that flew well. Moved to completed legs only.

**Ground-effect skimming.** With `TAKEOFF_H = 0.7` the population learned to fly
just underneath it, collecting approach credit and clipping low waypoints while
remaining technically "not yet airborne" and immune to the floor. Closed from
the other end: `WP_FLOOR = 3.0` m, with `WP_FLOOR − TAKEOFF_H` wider than the
arrival radius, so nothing down there is reachable.

**Then `TAKEOFF_H = 0.45` left a 23 cm survivable window.** The first thing
evolution had to solve became "never sink more than a hand's width", which a
random policy essentially never does. Mean airtime sat flat at 1.5 s for 30
generations. `1.2` m gives a metre of slack to bob in.

### Per-room normalisation — the fix that made a generalist possible

Raw fitness is not comparable across rooms: the Empty Hall pays ~18,000 and the
Warehouse ~1,500. Summing them means the objective is *almost entirely* the
hall, and the resulting champion scored **0.00 waypoints in the Warehouse** and
still won.

```js
STAGES = [
  { room: "hall",      turbulence: 0,    minSep: 9, scale: 12000 },
  { room: "pillars",   turbulence: 0.35, minSep: 9, scale:  2500 },
  { room: "warehouse", turbulence: 0.6,  minSep: 8, scale:  2000 },
];
normalizeFitness = (f, scale) => { const x = f/scale; return x <= 0 ? x : Math.sqrt(x); };
```

Per-room `scale` alone was **not** enough — my own test caught that 8× par in the
hall still beat competence everywhere. The `sqrt` adds diminishing returns so a
brain cannot buy the mean with one spectacular room. Both halves are load-bearing.

Measured effect on held-out waypoints:

| | hall | pillars | warehouse |
|---|---|---|---|
| stage-0 only | 3.00 | 0.63 | 0.63 |
| pillars-only | 0.90 | 0.80 | 0.80 |
| raw mix, no normalisation | 9.90 | 0.90 | **0.00** |
| **normalised (this brain)** | **35.84** | **2.19** | **1.41** |

### Curriculum, and catastrophic forgetting

Three stages, promoted on a monotone ratchet (never demoted). Training only on
the newest room made the drone *forget* the previous ones: pillars-only training
took the hall from 3.00 → 1.00 waypoints and mean fitness 2,948 → 2,004.

`episodeStages()` mixes older rooms back into every generation's exam:

```
stage 0, 3 episodes → [0, 0, 0]
stage 1, 3 episodes → [1, 0, 1]
stage 2, 3 episodes → [2, 0, 1]
```

Episode 0 is always the newest room; the rest cycle through everything unlocked.

### GA mechanics — `evolution.js`

Ranked each generation: 4 byte-for-byte elites (rank 0 always unmutated), ~16%
mutated elite copies, ~16% elite×elite row-wise crossover (whole neurons, not
scalars), the remainder rank-weighted parents with mutation strength growing
down the ranks, plus up to 2 fresh immigrants. Two gates narrow the search as a
run matures: past `immZeroFit = 1.2` no more immigrants, past
`childZeroFit = 2.5` no more crossover.

**Champion grace**: a drone lives or dies on one noisy episode, so a beaten
champion keeps an untouched seat for 3 generations. Defending refreshes it.

---

## 5. Seeds and validation

This is the part I got wrong three separate times, so it is worth being precise
about which numbers mean what.

| set | seeds | used for | trustworthy? |
|---|---|---|---|
| training missions | sliding window, mission ≈ generation index | selection | **no** — this is the coaching |
| validation exam | `900000 + e·7919` / `700000 + e·6271`, 6 episodes | crowning the champion | partly — fixed, but it is the quantity being climbed |
| bank A | `1500000 + e·1013` / `2500000 + e·761` | ranking | yes |
| bank B | `3100000 + e·1741` / `4200000 + e·929` | ranking | yes |
| bank C | `5300000 + e·2477` / `6400000 + e·1123` | ranking | yes |
| bank D | `90000 + e·313` / `60000 + e·197` | ranking | yes — the older single-brain eval bank, kept so the new numbers tie back to the previously recorded ones |

**Why the training log is not evidence.** It reports the best of a whole
population on the exact missions that population was selected against. It is by
definition the exam it was coached for. Quoting a best-of-population number
alongside held-out numbers is how I ended up claiming "5 waypoints" for a brain
that scored 1 — the question that caught it uncovered two real bugs.

**Why the exam alone is not enough either.** It is six episodes, and it is the
quantity the GA climbs, so the champion is partly selected for being *lucky on
those six*. Before it existed, `championFit` was a running max over noise and
froze at generation 1 for **660 generations** — the champion was the luckiest
draw, not the best brain.

**Why four banks.** A brain that wins one bank and loses three was lucky. The
bank spread column in §2 is there to make that visible: the winner's spread is
0.168 across banks whose absolute values run 1.52–1.69, so the ordering is
stable under reseeding. That is the claim the four banks buy, and it is the only
reason §2 is stated as fact rather than as a hopeful reading of a log.

### Determinism

Episodes must be bit-reproducible from `(missionSeed, noiseSeed)` or none of the
above means anything. One bug threatened exactly that: Box-Muller generates two
normals per call and the spare was cached in a **module-level** variable, so a
leftover from the previous consumer leaked into the next. Re-running an episode
with identical seeds produced a different turbulence stream depending on what
had happened earlier in the process, and a worker computed a different episode
than the main thread for the same seeds. The spare is now cached **on the RNG
object**. `test_headless.js` asserts episode determinism.

---

## 6. Scoreboard

**Worked**
- Time-as-currency (`START_CLOCK` + `WP_TIME_BONUS`) — competence self-finances
- Cone sensors with swept-sphere inflation — made obstacles perceivable at all
- Per-room normalisation *with* sqrt diminishing returns — made a generalist possible
- Mixed-stage exams — stopped catastrophic forgetting
- Fixed validation exam — stopped 660-generation champion freezes
- Small `CRASH_PEN` — kept the population willing to leave the pad
- Per-channel lag depth — deep history where attitude needs it, shallow elsewhere
- Output-layer init at 0.03 — fresh brains hover instead of flipping

**Didn't work**
- Pencil-ray sensors (0/32 saw a pillar at 6 m)
- `CRASH_PEN = 300` (takeoff 70% → 5%)
- Continuous efficiency billing (rewarded dying early)
- Per-room scaling without sqrt (8× par in one room still wins)
- Single-room curriculum stages (forgetting)
- `championFit` as a running max over noise
- Two of my own predictions, disproved by measurement: `TMAX = 5.0`, and
  per-room scaling being sufficient on its own

**Still broken**
- **100% crash in both obstacle rooms.** The headline problem.
- **The hall metric is saturated** — `MAX_ARRIVALS = 40`, hit in 22/32 episodes.
  The objective can no longer reward hall improvement, and the measurement can
  no longer distinguish two good brains.
- **Plateaued.** The champion held its 1.913 exam score for the final 210
  generations without a challenger beating it. Best challenger: 1.83.

### If picking this up again

In the order I would try them:

1. **Raise `MAX_ARRIVALS`** — one constant. The exam has lost resolution in the
   room the drone is best at, so a chunk of the objective is currently flat. This
   is the cheapest way to find out whether the plateau is the drone or the ruler.
2. **Re-weight `episodeStages()` toward pillars/warehouse.** Stage 2 is
   established and the hall is saturated; the mix is spending episodes on a
   solved room.
3. **Widen the sensor cones or extend `SENSOR_RANGE`.** 8–12 s to first
   collision suggests it is seeing obstacles *late* rather than not at all — but
   this is a hypothesis, and given the record above it should be measured with a
   visibility probe before any constant is touched.

---

## 7. What you can still run

The sim core is unchanged, so the assertions that guard it still hold:

```bash
node test_headless.js     # 95+ assertions, quaternions → curriculum ratchet
```

Training now happens in the browser, at the same settings this brain was trained
at (96 × 4, mutation 10% / σ 0.09, grace 3, both gates at their trained values —
the panel opens on them). Headless Chrome can drive it with no driver script:

```bash
chrome --headless=new --disable-gpu --dump-dom \
  "index.html?train&sync&headless&nointro&pop=96&episodes=4&gens=300&seed=11"
```

`sync` matters: `--dump-dom` fires as soon as loading finishes, so
`requestAnimationFrame` never runs, and `--virtual-time-budget` does not help
because virtual time is frozen inside a script task. The run finishes inside the
load handler, sets `document.title` to `DONE gen=… val=… bake=ready`, and leaves
a drop-in `default_brain.js` in `<pre id="bake-out">`.

Measured at those settings in headless Chrome: **≈4.8 s per generation** over the
first ten generations, single-threaded. It will get slower as drones survive
longer — the numbers in §2 are the far end of ~2,900 generations.

The §2 ranking cannot be re-derived from this repository: the four-bank comparison
harness was removed with the rest of the Node toolchain. The bank seed constants
are recorded in §5 and the criterion in §2, so it can be rebuilt, but as it stands
those figures are a record rather than a live check.

Two operational notes worth keeping if you rebuild any of it: run long jobs at
`BelowNormal` priority (this machine is shared with other agents, and a greedy
trainer gets killed with `EXIT 127`), and if you reintroduce worker threads, pull
work in small chunks rather than pushing one fixed slice per worker. Episode cost
varies more than 10× between drones, and static chunking left one worker running
alone at the generation barrier: **35% CPU on 20 cores at 5.3 s/gen, versus 74%
and 2.7 s/gen once work was pulled.**
