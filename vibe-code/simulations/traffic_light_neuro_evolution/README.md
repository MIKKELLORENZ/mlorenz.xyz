# Traffic Light Neuroevolution

A genetic algorithm learns to run the traffic signals of a city.

One genome is the complete set of weights and biases of **one signal
controller** — 8 114 numbers, never touched by a gradient. That single
controller runs **every junction in the city at once**, the way a convolution
applies one filter to every pixel. It is scored on how many vehicles and
pedestrians reached their destination, minus the time it cost everybody and
minus the accidents it caused.

Drivers and pedestrians are hard-coded: shortest-path routing, the Intelligent
Driver Model for car-following, and full compliance with the law. Nothing about
their behaviour evolves. So every difference in outcome is attributable to the
signals and to nothing else.

```
index.html         the page
city.js            city generator: road graph, routing, pedestrian graph, road bitmap
nn.js              genome layout, factorised encoders, forward pass, crossover/mutation
signals.js         phase state machine, detectors, input assembly, baseline controllers
traffic.js         the world: vehicles, pedestrians, conflicts, metrics
evolution.js       the GA, the curriculum, the per-generation baseline benchmark
render.js          top-down renderer
main.js            page wiring, charts, junction inspector
harness.js         Node loader (concatenates the bare-global scripts into one vm context)
test_headless.js   165 assertions over city / brain / world / evolution
test_ui.js         boots the real page against a stub DOM and drives frames
train_headless.js  island trainer on worker_threads
bake_brain.js      bakes a trained champion into default_brain.js + held-out benchmark
probe_champion.js  what the controller actually DOES, next to the two baselines
```

```
node test_headless.js
node test_ui.js
node train_headless.js --gens 70 --workers 6 --pop 32 --out training/run1
node bake_brain.js training/run1/champion.json
node probe_champion.js training/run1/champion.json 4
```

`probe_champion.js` is the tool worth reaching for first. A score says a brain is
better; it does not say why, and it hides everything that is obvious in the
behaviour and invisible in the number. It reports mean green length, the amber
and all-red the controller chose, how often the hardware max-out timer had to do
its job for it, whether it ever runs the pedestrian phase, how long an approach
gets starved, and how often neighbouring junctions are in step — each next to
the vehicle-actuated controller on the identical traffic. It caught the first
thing worth catching in this build: a mid-training champion had discovered that
trimming the all-red to 1.25 s buys capacity, and was paying two collisions an
episode for it.

---

## The world

Metres and seconds throughout. A city is a lattice of junctions joined by
streets, with a stub arm out of every perimeter junction ending in a **portal**.
Every trip starts and ends at a portal, so "reached its destination" is a
well-defined count.

**Streets are not necessarily straight.** Junction boxes stay square and
axis-aligned — the phases, the crossings and the stop lines all depend on that —
but the junctions themselves are jittered off the lattice and each street is a
cubic curve that leaves each junction along its arm and bends across the middle.
A bend has to be driven slower than a straight (nobody pulls more than about
3 m/s2 sideways), so a winding street genuinely costs capacity.

Layouts can also carry:

- **Roundabouts** — no signals at all. Everything gives way to whatever is
  already circulating, and a car may only join if nothing coming round will
  reach the give-way line inside 3.2 s. Right-hand traffic, so vehicles bear
  right and circulate N → W → S → E: a right turn is a quarter of the island,
  straight on is a half and a left is three quarters. They are also fast (a
  quarter of the island at 26 km/h beats waiting out a red) and bad for
  pedestrians (a crossing at a roundabout is much longer than one at a signal).
  The evolved controller cannot touch them, so it has to cope with a neighbour
  it cannot command.
- **One-way streets** — half the capacity, and a detour for anything that wanted
  to go the other way.
- **A ring road** — a faster road (80 km/h against 50) that loops the whole city
  and joins it at every perimeter stub. Because routing is by travel *time*, it
  changes what the shortest path actually is: crossing town is sometimes quicker
  the long way round than straight through the middle.

Two invariants are checked at build time and asserted in the test suite: every
portal-to-portal pair is drivable, and the street network is **closed-looped** —
no internal street is a bridge, so nothing is a dead end and every block can be
driven around. Dropping a street to make a T-junction is reverted if it would
break that.

**Vehicles.** One lane per direction. Car-following is IDM (comfortable
acceleration 1.7 m/s², comfortable deceleration 2.3, emergency 6.5, desired
headway 1.15 s, standstill gap 2.4 m) against whichever of these is nearest:
the car in front, the stop line, a pedestrian in a crossing it is about to drive
over, oncoming traffic when turning left across it, and the far side of the
junction when there is no room to land (the "do not block the box" rule).
Routes come from an all-pairs shortest-path table computed once per layout and
are never re-planned, so congestion cannot be routed around — the signals are
the only lever.

**Pedestrians.** Sidewalks with four corners per junction, joined around the
junction by marked crossings and along each street by two sidewalks. People take
local trips of a few blocks. They step off only on a walk signal, and only
during the first six seconds of a green; after that the crossing shows a steady
don't-walk and only those already out finish. At an unsignalised crossing they
accept a gap in the traffic.

**Signals.** Three phases — north-south, east-west, and an all-pedestrian phase
that stops every vehicle movement — with amber then all-red between any two.
During a north-south green it is the **east and west** crossings that get a walk
signal, i.e. the ones parallel to the moving traffic, which is what real
junctions do. Minimum green (6 s), minimum pedestrian phase (10 s), maximum
green (75 s) and the clearance limits are hardware and cannot be violated.

**Accidents are never scripted.** They are what falls out when the signals point
two things at the same square metre:

- **The dilemma zone.** The law says stop for an amber *unless you cannot do so
  safely*. A car that would need more than 3 m/s² to stop continues. Make the
  amber too short and more cars are committed when it goes red.
- **The clearance interval.** If the all-red after that is too short, the cross
  street is released while those cars are still in the box.
- **The left-turner.** A permissive left waits *inside* the junction for a gap —
  which is what actually happens, and is why the all-red matters: it has to be
  out before the cross street moves.
- **Somebody halfway across.** A crossing pedestrian who has not finished when
  traffic is released.

Long clearances are safe and throw away several seconds of capacity per cycle
per junction. There is no setting that is good at both, and nothing tells the
controller where the middle is.

Collisions are tested with **oriented bounding boxes**, not centre distance.
This is not fussiness: two cars passing in opposite directions sit 3.6 m apart
and never touch, and a car poking across the opposing lane sits at the same
3.6 m and certainly does. Any distance threshold that separates them wrongly
convicts every lawful signal plan of causing crashes — see *what went wrong*
below.

A collision leaves two wrecks blocking the junction for 25 seconds.

---

## The brain

Each light decides once per simulated second. What it can see:

| | |
|---|---|
| **itself** | position, current phase, whether it is green / amber / all-red, time in phase, whether minimum green has elapsed, time since each phase last ran, its own last decision |
| **its detectors**, per arm | queue length, distance to the nearest vehicle, departures in the last 20 s, pedestrians waiting, pedestrians *in* the crossing, how long they still need, whether the exit road is already full, the signal that arm is showing, time since that arm last had green |
| **its neighbours** | for each of the four road-connected lights: distance, relative position, identity, how much traffic it is currently sending this way, its total queue — and **its phase now and at 1, 2, 3, 4, 5, 10, 13, 15, 18, 20, 25 and 30 seconds ago** |
| **the rest of the network** | the four nearest non-adjacent lights (position, identity, phase, queue), plus a network-wide summary — what fraction of the city is running north-south, east-west or all-pedestrian, and the mean queue — carrying the same thirteen-sample history |
| **the map** | a 64×64 black-and-white road map of the city, pooled to 16×16, plus a 24×24 crop centred on this light |

Thirty seconds is roughly a platoon's travel time over one block, which is
exactly the information a green wave needs.

It outputs four choices — hold, run north-south, run east-west, let everybody
cross — and two continuous numbers: **how long the amber should be** (2.0–5.5 s)
and **how long the all-red after it** (0–3.0 s).

### Why the network is shaped like this

Fed naively into one dense layer, those inputs are about 18 000 weights before
the trunk even starts, which is not searchable by a GA. So the first layer is
**factorised into small encoders that are themselves shared**:

| encoder | shape | applied to | genes |
|---|---|---|---|
| arm | 10 → 6 | each of 4 arms | 66 |
| neighbour | 47 → 8 | each of 4 road-connected lights | 384 |
| distant light | 7 → 3 | each of 4 others | 24 |
| own phase history | 39 → 8 | 13 samples × 3 channels | 320 |
| network history | 52 → 8 | 13 samples × 4 channels | 424 |
| map | conv 4×4/2, 4 filters, + linear | the city plan and the local crop | 642 |
| trunk | 127 → 40 → 24 → 6 | | 6 254 |

**8 114 genes**, and every one of them gets feedback from all four arms of every
light on every decision. The two map encoders run **once per light per episode**
— the road plan does not change during an episode — so they cost nothing per
decision.

The same genome runs a one-junction crossroads and a twenty-five-junction
downtown without modification. That is the point of sharing the weights.

---

## Scoring

```
+100  per vehicle that reached its destination
 +70  per pedestrian that reached their destination
-0.55 per second of delay, per traveller, measured against the same trip with
      every light green — including everyone still stuck when the episode ends
-1400 per vehicle collision          (about fourteen completed journeys)
-4200 per pedestrian struck
 -1.2 per vehicle stop
   -5 per emergency braking event
```

Counting the delay of travellers who have *not* arrived is what stops a
controller scoring by never letting anyone finish. New trips stop being
generated at 62% of the episode and the rest is a drain period, so a car
released in the last ten seconds is not counted against the controller for
failing to arrive.

### The three baselines

Every generation, three classical controllers are re-measured **on the same
city, the same schedule of trips and the same drivers** the population just
drove:

- **fixed-time** — 34 s each way, 3.8 s amber, 2.4 s all-red. What most
  junctions on earth actually run.
- **vehicle-actuated** — minimum green 8 s, gap-out when nothing is within
  30 m, max-out at 45 s, a queue-imbalance override, and an all-pedestrian phase
  when enough people are waiting. What a good engineer installs.
- **random switching** — the floor.

Those three lines on the chart are the point. A fitness curve that only compares
a population to itself can rise while the thing gets worse.

---

## The curriculum

| tier | city | what is new |
|---|---|---|
| 0 | one crossroads | |
| 1 | 2 × 2 | coordination between junctions |
| 2 | 3 × 3 | an arterial: lopsided demand |
| 3 | 3 × 4 | streets that bend, and heavy foot traffic |
| 4 | 4 × 4 | roundabouts, and a rush-hour surge mid-episode |
| 5 | 4 × 5 | missing streets (T-junctions) and one-way pairs |
| 6 | 3 × 3 + ring | a fast ring road that changes the shortest route |
| 7 | 5 × 5 | everything at once, and vehicles break down and block a street |

A tier unlocks when the population **median** matches the vehicle-actuated
controller for three consecutive generations — not when one lucky genome does.
Three layouts are rotated within each tier so no single street plan can be
memorised. A tier held for 150 generations unlocks anyway, so a run cannot get
stuck.

Episode length scales with the city (×1.0 to ×1.9): a trip across a five-by-five
grid simply takes longer, and without that scaling most of the demand physically
could not arrive before the bell whatever the signals did.

---

## What the GA does

Standard, and deliberately borrowed piece by piece from the earlier sims on this
site, because each of these was the single biggest win in one of them:

- **Common random numbers.** Identical city, identical trips, identical driver
  personalities for every genome in a generation. Without it a two-episode score
  measures the draw as much as the controller. (chess)
- **A validated champion.** A challenger takes the crown only by beating the
  sitting champion in *every* episode, not by posting a better aggregate. With a
  bare ">" the crown changes hands on noise. (chess, 3D walk)
- **Worst-episode weighting.** Aggregate is `0.6 × mean + 0.4 × worst`, so a
  controller that only handles the easy demand pattern is graded by its bad day.
  (boats)
- **Neuron-row-wise crossover.** Whole units — incoming weights plus bias —
  inherited from one parent. Per-gene splicing hits the permutation problem.
  (boats)
- **Near-zero output-layer init**, so a fresh brain holds its phase gently
  instead of thrashing between them from tick one. (boats, food delivery)
- A quarter of the initial population starts from a **faint hand-written
  prior** — "serve whichever axis has the longer queue, and get impatient" —
  which is roughly the first useful thing any actuated controller does. It is a
  scaffold, not a controller: clearance lengths, pedestrians, coordination and
  spillback are all left to evolution.

`train_headless.js` runs several **islands** rather than one shared population,
so every worker runs the unmodified `evolution.js` the browser runs and the two
cannot drift. What crosses between islands is a genome, and it lands in the
population to earn its place — never installed as champion by decree.

---

## What the shipped brain actually does

`default_brain.js` is generation 220 of a five-island run, chosen by
`select_champion.js` on a validation family of cities and then measured on a
third family neither training nor selection ever touched. Against the
vehicle-actuated controller on those 21 held-out cities:

| tier | brain | actuated | brain crashes | actuated |
|---|---|---|---|---|
| 0 One crossroads | 4369 | **4605** | 0.0 | 0.0 |
| 1 Two by two | **6166** | 5662 | 0.0 | 0.0 |
| 2 Nine blocks, one arterial | **3897** | 3258 | 1.3 | 1.3 |
| 3 Winding streets | 4894 | **6690** | 3.3 | 1.0 |
| 4 Roundabouts and rush hour | **5374** | 2873 | 1.0 | 1.7 |
| 5 Missing links and one-ways | **−1415** | −4169 | 1.0 | 1.0 |
| 6 Ring road | **5548** | 4163 | 2.7 | 2.3 |
| **mean** | **4119** | 3297 | 1.33 | 1.04 |

It wins 15 of 21, carries a 25% better mean score, and delivers **lower delay on
six of seven tiers** — 29 s against 40 s on tier 1, 111 s against 124 s on tier
5. It beats the fixed-time plan by roughly 22x.

**It did not learn what it was given the inputs to learn.** `probe_champion.js`
puts neighbouring junctions in the same phase 52% of the time against the
actuated controller's 50%. That is chance. There is no green wave, despite every
light being handed its neighbours' states at thirteen points across the last
thirty seconds precisely so a green wave was expressible.

What it found instead was a clearance arbitrage. Per phase change it spends
**2.20 s amber and 1.34 s all-red**, against the actuated controller's fixed
**3.80 s and 2.40 s** — 3.54 s of lost time per change rather than 6.20 s. Over
sixteen changes that is about 24 seconds of usable green recovered per junction
per episode, and it spends the winnings on switching *more often*: sixteen
changes against thirteen, mean green 19.4 s against 24.5 s. Shorter cycles do
genuinely cut delay at moderate demand, so this is a real strategy and not an
exploit — the clearance intervals it chooses stay inside the legal envelope.

But it is buying green time with safety margin, and tier 3 is where that bill
arrives. Winding streets have longer curved paths across the junction box, so an
all-red that is survivable on a square grid is not survivable there: 3.3
collisions per episode, which cost 4600 points and hand the tier to a controller
the brain beat on both throughput *and* delay.

The honest read is that the easy reward crowded out the interesting one. Trading
clearance for capacity pays immediately at every junction independently;
coordinating with the junction up the street pays later, only in combination,
and only once several lights agree. A GA takes the first one. Removing the
freedom is not the fix either — clamping a trained brain's clearance to a
geometry-derived floor made it *worse*, because its phase choices are
co-adapted with its own timings. Getting a green wave out of this would mean
making clearance non-negotiable *during* training, so the only capacity left to
find is the kind that requires the network.

---

## What went wrong, and what fixed it

Almost all of the work here was in the simulator, not the GA. A world that
punishes lawful behaviour makes evolution look broken when it is not — the same
lesson as the food-delivery sim, where four stacked world bugs hid behind "the
GA isn't learning".

**Point-distance collisions convicted every lawful plan.** The first version
called it a crash when two cars in a junction came within 3.3 m. A fixed-time
plan with a 3.5 s amber and a 1.6 s all-red "caused" eleven collisions on a
*single crossroads*. Three separate false positives were hiding in there: cars
from the same approach fanning out to different exits leave the stop line from
the same point; opposing through movements pass 3.6 m apart forever; and a
left-turner waiting in the box sits near a path it never actually crosses.
Oriented bounding boxes fixed all three at once. Two lawful controllers now run
a whole episode with zero accidents, and the reckless ones still hurt people —
which is what makes the safety half of the score mean anything.

**Left turns were eating the entire network.** With a uniform trip table, a
third of all movements were left turns, and 68% of junction-occupancy time was a
left-turner sitting still. Throughput was 36% on one crossroads. Two fixes, both
of them things real cities do: a **through-dominated trip table** (roughly
70% through / 15% left / 15% right, which is what real urban grids run) and
letting left-turners **pull into the junction and wait there** rather than at the
stop line. The measured yield point matters — `buildYieldPoints` creeps a car
body forward along each left-turn path until it would foul the opposing
straight-ahead path, then backs off a car's length. Guessing a fraction of the
connector puts the car's nose in the opposing lane and the crashes come back.

**A left-turner has to slow on the approach, not on arrival.** Checking for a
gap only once a car is already in the junction means a car doing 12 m/s cannot
stop in the three metres between the stop line and the yield point, so it
arrives at the conflict point at speed. Moving the check onto the approach was
worth most of the remaining accidents.

**Pedestrian throughput was exactly zero** on the bigger tiers. Not a bug in the
code: portal-to-portal on foot is over a kilometre, which no pedestrian could
walk inside an episode. People now take local trips, which is also what people
do.

**Most of the demand could not arrive whatever the signals did.** Trips were
generated right up to the final second, and the episode was 240 s regardless of
city size, so throughput was capped near 50% by geometry alone. A 62% demand
window with a drain period, plus per-tier episode scaling, made "how many
arrived" a measurement of the controller again.

**Roundabouts and curves brought their own crashes back.** Two of them.
Circulating traffic is on a different path from everyone else's, so ordinary
in-lane car-following cannot see it — a car joining the island would drive into
one already going round, and the give-way rule had to be a *time* gap rather
than a distance one, because a car coming round at 8 m/s eats twenty metres of
island while you are still pulling away. And nothing capped speed by curvature,
so vehicles took a 13 m island at 50 km/h. Real drivers will not pull more than
about 3 m/s2 sideways; deriving a speed limit from each path's own curvature
(and braking for it on the approach, not on arrival) is both more realistic and
where most of those collisions went.

**Cars from one lane clipped each other inside the junction.** The single-lane
rule stopped a car leaving the stop line while somebody from the same queue was
still in the box — but only while it was still *on* the approach. Once past the
line it could catch a left-turner still swinging across, because their paths
only part company gradually. Following has to continue across the junction, not
stop at the stop line.

**Stops were never counted.** The counter compared speed before and after a
single 0.1 s step; no car can go from cruising to standstill in one step, so it
never fired. It needed a latch. A metric that silently reads zero is worse than
no metric.

**The trainer and the benchmark were not running the same episode, so safety
was free.** A `World` multiplies the requested episode length by the city's
`timeScale`, because a trip across a 5x5 downtown takes longer than a trip
across one crossroads and otherwise most of the demand cannot arrive whatever
the signals do. `Evolution.worldFor` then assigned the raw setting back over it,
so that every benchmark — which builds a fresh `World` — ran tier 7 for 380 s
while the trainer ran it for 200 s.

The symptom was not a length complaint. It was that the trainer reported `cr
0.0` for forty consecutive generations while every independent measurement of
the very same genome, city and seed found two to six collisions. A truncated
episode never saturates, and collisions only happen once it does. The crash
term in the fitness — the largest penalty in it, 1400 points per crash — was
therefore never once exercised. Evolution was not trading safety for capacity;
it was being told safety cost nothing, and it priced it accordingly. The whole
population, all 22 distinct candidates, came out equally unsafe.

Two plausible fixes were tried against this and both failed, which is how the
real cause was eventually cornered. Clamping the champion's clearance intervals
to a geometry-derived floor made it *worse* (2.2 to 2.6 accidents): a longer
amber puts cars into the box later, and the co-adapted phase choices break when
you change one of them underneath a trained policy. Re-crowning the champion on
unseen layouts found nothing better to crown. Both were attempts to repair a
policy at measurement time, when the defect was that the training objective and
the measured objective were different objectives. A metric that disagrees with
an independent measurement of the same thing is worth more attention than any
amount of reasoning about the policy that produced it.

**"Real time" was six times real time.** The watch tab's playback loop took at
least one physics step per frame and threw the remainder away, so the pace
factor could scale it up but never down: the slowest setting still ran a fixed
0.1 s step every 16 ms. Carrying the leftover time to the next frame is what
makes anything below 1× possible, and once a step only happens every few frames
the picture needs the renderer to coast each vehicle forward at its own speed in
between, or slow motion arrives as a slideshow. That extrapolation is
drawing-only — it never reaches a decision or a collision test.

**A control that reads back empty takes the run down four frames later.** The
population came straight from a slider, and an empty value gave a population of
zero — which surfaces as an undefined genome inside a convolution, nowhere near
the cause. Every control read now falls back to the engine default.

---

## What it is not

A microsimulation, not a digital twin.

- Approaches have **one lane**. There is no left-turn pocket, so a car waiting to
  turn left really does hold up everyone behind it. This is true of a real
  single-lane approach, and it is why the trip table is through-dominated.
- Vehicles **do not re-route** around congestion, so the ring road is chosen at
  departure on free-flow times, not because it happens to be clear.
- Pedestrian crossings at a roundabout run corner to corner, which makes them
  long. Roundabouts really are worse for pedestrians than signals, but not
  quite by this much.
- Nobody jumps a red on purpose, nobody blocks the box on purpose.
- No weather, no buses, no cyclists, no parking manoeuvres, no emergency
  vehicles.
- The all-pedestrian phase is a scramble with no diagonal timing distinction.
