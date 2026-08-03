# Keeping the Lights On — power grid neuroevolution

A genetic algorithm evolves a control-room operator for a transmission network.
No gradients, no reinforcement learning, no recorded data. One genome is 6 756
weights and biases; its fitness is the operating margin of the system it ran, in
euros.

Open `index.html`. Everything runs in the browser.

The page opens on a choice, because the two things it can do are genuinely
different activities:

* **Watch the trained operator** — a two-minute evaluation. The baked champion
  runs a full day against a classical control-room program on the identical
  weather and the identical faults, and the page says in plain words who won and
  why. Strictly an eval: no population, no sliders, nothing to tune.
* **Train one yourself** — the experiment. Random operators, generation after
  generation, with the charts and dials.

`?mode=watch` or `?mode=train` in the URL skips the choice. The prose on the page
assumes no background at all — it explains what a power grid is and why it can
fall over before it explains anything about evolution.

---

## The problem

A transmission network is planned so that it survives losing any single element.
Then reality happens: demand peaks a third above average, a wind farm goes from
nothing to nameplate in two hours, and a storm takes three lines out of the same
corridor at six in the evening. The operator has five minutes per decision and
two kinds of lever:

* **Redispatch** — continuous, expensive, and it has to sum to zero. Moving a
  megawatt from a cheap unit to an expensive one is the only way to change where
  power flows without changing the copper.
* **Switching** — discrete, free, and dangerous. Open a line, or split a
  substation across its two busbars, and the flow re-routes. It can also start a
  cascade.

The controller is graded on what it delivered minus what it cost, and the thing
it is *not* graded on is the metric everyone in this field optimises.

## What is actually simulated

### Power flow

A full **AC power flow every five minutes**, per island, in per unit on a 100 MVA
base with the MATPOWER branch model. Three solvers, and they are not
interchangeable:

| solver | role | why |
|---|---|---|
| Newton–Raphson, polar | the reference | full Jacobian, dense LU, quadratic convergence, robust to the nose of the PV curve |
| Fast decoupled (XB) | the workhorse | B′ and B″ depend only on the switching state, so they are factorised **once per topology and cached** — each iteration is then two triangular solves |
| DC + LODF | the security screen | linear, lossless, ignores reactive power, and therefore cheap enough to test *every* branch outage *every* interval |

The AC path drives the reward and the protection relays. The DC path drives the
security screen only, and its result is reported as a separate metric precisely
because it is an approximation.

Reactive limits are enforced: a machine that runs out of excitation stops holding
its voltage and the bus it was holding sags, which is how most real voltage
collapses start. Converting a PV node to PQ moves it from B′ to B″, so the
conversion pattern is part of the factorisation cache key — on IEEE 14 a peaker
sits on its reactive limit essentially all day, and caching only the unconverted
pattern meant a full Newton solve every single interval.

### Protection and cascades

Lines do not trip the instant they exceed their rating; they heat up. A thermal
accumulator integrates `loading² − 1` and trips at one, and above 1.55 the
instantaneous overcurrent element goes at once. That difference is the entire
margin an operator has to work in. When a line goes, the flow redistributes and
the next one may follow — the step re-solves until nothing more trips.

If the network separates, each island is balanced on its own: generation is
spread to match load, and if it cannot be, load is shed in blocks the way
under-frequency relays actually shed it. An island with no generation is dark. A
line that has tripped on overload three times is locked out by the recloser and
nobody closes it again.

### Weather and demand

Nothing here is recorded data. Every number in an episode comes from the seed,
which is what makes common random numbers possible and what makes a held-out
benchmark mean something.

* **Solar** — clear-sky irradiance from orbital geometry: Spencer's declination
  and equation of time, Kasten–Young air mass, Hottel beam transmittance. The
  geometry is exact. That is multiplied by a **clearness index** drawn from a beta
  distribution whose parameters set the site's cloudiness, autocorrelated over
  about an hour, with a regional common factor plus per-farm noise.
* **Wind** — an AR(1) process in Gaussian space (a slow synoptic component and a
  fast gust component) pushed through the normal CDF into a uniform and then
  through the inverse **Weibull** CDF, so the marginal is exactly Weibull and the
  autocorrelation lands where it was asked for. Then a manufacturer power curve
  with cut-in 3.5, rated 12.5, cut-out 25 and restart hysteresis at 21.5 m/s — a
  storm does not ramp a wind farm down, it switches it off, and the whole fleet
  in one weather system goes together.
* **Demand** — base × a diurnal shape per customer class (residential,
  commercial, industrial) × a weekly modulation × an Ornstein–Uhlenbeck deviation
  split into a system-wide common factor and per-bus idiosyncratic noise, plus
  Poisson ramp events.

### Networks

Two are real test systems, four are generated.

| # | network | what it is |
|---|---|---|
| 0 | Sixmile | six buses, mild weather, nothing breaks |
| 1 | IEEE 14, calm day | the standard case, the odd fault |
| 2 | IEEE 14, windy | volatile wind, a line or two goes |
| 3 | IEEE 14, storm | tight limits, a storm front, heavy load |
| 4 | Regional 22-bus | generated: a shape the brain has never seen |
| 5 | Regional 30-bus, storm | generated, tight limits, a storm |

The IEEE 14-bus bus and branch data are the standard case. The generation fleet
is not: the published case has three synchronous condensers and one machine that
swings the whole system, which is not a redispatch problem. Those are replaced
with real units with a merit order and ramp limits, and four renewable plants are
added — enough wind and solar to reverse the flow on the 33 kV side around noon.

**Thermal ratings are computed, not guessed**, because IEEE 14 does not ship with
credible ones. Every network is put through a planner's study sweep: eleven cases
spanning the load and renewable range, with a full N-1 sweep in each, and each
branch is rated from the worst flow it sees anywhere in that envelope. The tier
then applies a security factor: at 1.00 the network is exactly N-1 secure across
the studied envelope and not one megawatt more, and the storm tiers go below it,
so the network is not secure even on paper.

The generated networks also go through **reactive planning**: shunt compensation
is increased until the worst study case solves with every voltage above 0.93 pu.
A network with a heavy load at the end of a long high-reactance path and no local
source of reactive power collapses at 1.1× nominal no matter who is operating it.
A real planner would not build it, so neither does this.

## The brain

A dense layer over a power system does not work and cannot be made to work: the
input would have to be a flat vector of one network's buses in one order, so a
genome evolved on fourteen buses would be meaningless on twenty-two, and the
weights that learned "watch line 7" would learn nothing about line 8.

So the architecture is a **graph network** with shared weights:

```
  edge encoder    every directed branch end, seeing the branch and both substations
  node update     every substation, seeing itself, the mean and max of its
                  incident edge messages, and the system context
  ... twice, so information travels two substations before a decision
  heads           one per action type, applied to every candidate:
                    generator head   -> redispatch, curtailment
                    line head        -> open / reconnect this line
                    substation head  -> reconfigure this site
                    element head     -> which busbar this element goes on
                    do-nothing head  -> the bar every switching action must clear
```

6 756 genes. Mean and max are the only aggregations and no weight is indexed by a
bus number, so **permutation invariance and size invariance are exact by
construction** — the test suite verifies this to 1e-12 on the encoder, not
end-to-end, because end to end it is not exactly true and should not be:
reordering the nodes changes the pivot order inside the LU and the power flow
lands a part in 10⁸ away.

### What it can see

Per substation: voltage on each busbar, angle, real and reactive load and
generation, ramp headroom in each direction, worst local line loading and worst
local contingency, split flag, cooldown. Per line: flow, loading, thermal
accumulator, rating, impedance, cooldown, whether losing it would island the
network. System-wide: clock, reserve, losses, the forecast half an hour out, and
the worst single-contingency loading anywhere.

And two numbers a real control room reads off a screen:

* the **PTDF sensitivity** of the binding line to a megawatt injected at each
  generator, and
* the **LODF** prediction of what opening each line would do to the worst loading.

The classical controllers it is graded against read exactly the same two tables.
The brain is given no private information — in fact it is given *less*, because
the expert baseline is allowed to verify its switching candidates with a real AC
solve and the brain is not.

### What it decides

Continuous, everywhere at once: a redispatch per generator as a fraction of that
unit's five-minute ramp, **projected to sum to zero** over the committed fleet, and
a curtailment per renewable plant.

Discrete, **at most one per interval** — the rule real operators work under: open
or reconnect one line, or reassign the elements of one substation across its two
busbars. Every candidate is scored by a shared head and compared against a
learned do-nothing bar, because a switching action on a healthy network is pure
risk.

## The score

Everything is in euros, so fitness is the operating margin of the control room.

| term | rate |
|---|---|
| energy delivered | +€70 / MWh |
| fuel | each unit's own marginal cost, €8–132 / MWh |
| balancing premium | €19 / MWh up, €13 / MWh down, on redispatch the operator *ordered* |
| curtailment | €42 / MWh paid to a plant told not to generate |
| energy not delivered | −€3 000 / MWh |
| overload risk charge | −€350 000 / h per unit of `Σ max(0, loading − 1)²` |
| system collapse | −€120 000, and the day ends |

A collapse charges the hours it would have run as fully unserved, so switching
the country off is not a way to stop paying for fuel. The risk-charge coefficient
is set so the exchange rate is the one a real control room works to: holding a
line at 115% costs about €9 000 an hour and the redispatch that would clear it
costs about €1 200, so preventive action pays and doing it when nothing is
binding does not.

### What is deliberately not in the score

**N-1 security.** It is screened every interval over every branch, plotted on the
panel, and never paid for. So the chart answers a real question: does an operator
that was only ever paid to deliver energy cheaply and not break anything end up
running the system securely? There is a switch to turn the N-1 charge on and it
is off by default, because a reward that already contains the security metric
cannot be used to ask that question.

Overload duration, maximum loading and voltage excursions are likewise reported
as raw counts, separate from the risk charge that the reward contains.

## The evolution

* **The day is auditioned before it is used.** This turned out to matter more
  than everything else on this list put together, so it goes first. See below.
* **Common random numbers.** Within a generation every genome gets the same
  network, the same day of weather, and the same faults — and so do the three
  classical controllers, so the baseline lines on the chart are measurements, not
  constants.
* **Normalised advantage carries across generations.** A calm Tuesday is worth
  +100k and a storm at the evening peak is worth −1.7M for the same controller.
  Comparing this generation's best raw score against a champion crowned on a
  different day compares the weather, and the champion then freezes on whichever
  day happened to be mildest. So the champion, the elite roster and the
  curriculum all work in **advantage over the best classical control room on the
  same day, divided by that day's own scale** and clamped. Ranking inside a
  generation is unaffected — an affine transform does not reorder anything. The
  division is not optional; see below.
* **A validated champion.** The challenger must beat the sitting champion on
  *every* day, not just post a better average.
* **Worst-day weighting.** The aggregate is 0.6 × mean + 0.4 × worst.
* **Row-wise crossover.** A hidden unit's incoming weights and its bias are
  inherited together, because two parents can compute the same feature with their
  units in a different order.
* **A ladder with no gaps.** A tier unlocks when the population median comes
  within a whisker of the best classical control room for three days running, or
  on patience, so a rung the population cannot reach cannot trap the run — **or
  when the audition can find nothing on it worth learning.**

### Auditioning the day

The first version of this trainer learned nothing, and the trainer log said why
on every line:

```
i0 t3 adv 0.00 (0k)  best 87k med 87k | don 87k red 87k exp 87k
i2 t2 adv 0.00 (0k)  best 80k med 80k | don 80k red 80k exp 80k
i3 t3 adv 0.00 (0k)  best 15k med 13k | don 15k red 15k exp 15k
```

Best equals median equals do-nothing, to the euro, generation after generation.

The cause is not the GA. It is that **a day on a well-planned power system is
almost always uneventful.** Measured with a do-nothing control room over twelve
days of the *storm* tier, four cost nothing whatsoever — no overload, no trip, no
shed load — and on the two calm tiers it was twelve days out of twelve. On such a
day doing nothing is genuinely the optimal policy, every genome scores the
identical number, and the generation carries **zero bits of selection**.

It is worse than merely wasted, because those days are not neutral. The only
genomes that differ from the pack on a flat day are the ones that *did*
something, every action costs a balancing premium, so a flat day actively selects
**against acting at all**. Two thirds of the compute was being spent teaching the
population to sit on its hands, and the remaining third could not undo it.

So each generation now auditions seven candidate days with the cheapest
controller there is, and keeps the ones where inaction demonstrably bleeds:

```
head 378k/791k flat 4   <- kept days average 378k of avoidable loss,
                           best candidate 791k, 4 of 7 rejected as flat
```

Three details that are not obvious:

* **The audition is nearly free.** Do-nothing on a *kept* day is exactly the
  do-nothing baseline that generation needed anyway. The only wasted work is the
  candidates that lose, and a do-nothing episode costs a fraction of a
  brain episode because it never builds an observation tensor.
* **Lost load is capped at 600k in the headroom measure.** Uncapped, the biggest
  number the audition ever sees is a day that collapses whatever anybody does —
  and it wins the audition every single time it appears, while teaching nothing,
  because every genome and every baseline finishes within a rounding error of
  minus four million. What teaches is *sustained, survivable* stress, so the
  overload integral is weighted heavily and the catastrophe is allowed in but not
  allowed to dominate.
* **One slot always goes to the quietest candidate.** Trained on crises alone,
  the population came out of the first audition run redispatching eleven hundred
  megawatt-hours on held-out days where nothing at all was wrong, and losing
  forty thousand euros a day doing it. It had correctly learned that acting pays
  — on a diet where acting always paid. Since the aggregate is 40% worst-episode,
  grading every genome on one quiet day as well prices the churn straight back
  in. The operator has to learn both halves: that a crisis is worth acting on and
  that a Tuesday is not.

What the audition does **not** do is touch the reward, the physics, or the
difficulty of a day. A kept day is an ordinary day drawn from the ordinary
distribution; the audition only chooses which days are worth spending thirty
genome-episodes on. The held-out benchmark still draws its days at random, so an
operator that has only learned to handle a crisis is still caught there.

The same measurement kills the bottom of the ladder. If the audition cannot find
one day on a tier where doing nothing costs anything — which is the literal truth
of both calm tiers — then there is nothing there to learn and no amount of
patience will change that, so the tier is skipped. It used to take twenty
generations to prove that a quiet Tuesday is quiet.

## The baselines

Three, and none of them is a straw man.

* **Do nothing** — the market's economic dispatch, plus reconnecting what has come
  back from repair. On a calm day with generous ratings this is the *cheapest
  possible operation* and nothing can beat it. That is the point: it is not always
  correct to act.
* **Sensitivity redispatch** — the poor man's security-constrained dispatch that
  every control room runs. It finds the binding constraint, reads the PTDF row for
  it, picks the generator pair with the best relief per euro, and moves as much as
  the ramps allow. Its thresholds are economic rather than doctrinal, because
  under this reward an overload is charged for and an N-1 insecurity is not.
* **Redispatch + topology** — the above, plus switching when redispatch runs out
  of ramp. Candidates are shortlisted with the LODF table and then **verified with
  a real AC power flow**, which is exactly what a control room does before
  executing a switching action.

## Running it

```
node test_headless.js                                  # 144 assertions
node train_headless.js --gens 900 --workers 4 --pop 24 --episodes 3 --eplen 0.85 --tier 3 --out training/run1
node bench_champion.js training/run1/champion.json      # held-out, mid-run is fine
node bake_brain.js training/run1/champion.json         # writes default_brain.js
node probe_champion.js training/run1/champion.json --tier 5 --seed 7
node probe_champion.js --baseline expert --tier 3      # the same, for a baseline
```

`bench_champion.js` splits its report into **quiet days and eventful days**, and
that split is the whole point. A control room has two jobs that pull in opposite
directions — do not churn when nothing is wrong, do act when something is — and
since most days are quiet, a single average is very nearly a measurement of the
first job alone. It will happily report a respectable overall number for an
operator that has learned to sit still and never once helped.

### The map

The result is announced **on the map, in large type**, and the running money bars
sit on it too. A verdict delivered as the last sentence of a paragraph below the
fold is not a verdict, and a scoreboard that lives underneath the thing it is
scoring makes you look away from the thing it is scoring.

The event log is **paced**. A cascade produces six or seven messages inside one
five-minute step, and at anything above the slowest speed they arrived and were
pushed off the top of the list within a few frames — the most interesting thing
that happens all day, and it was unreadable. Events now queue and are released
one at a time on a wall-clock timer regardless of simulation speed, each stamped
with the moment it happened, with a counter for anything still waiting. Nothing
is dropped silently.


The diagram used to be a one-line diagram — the abstract thing power engineers
draw, boxes and sticks. That is a fine way to read a network if you already know
what you are looking at, and a poor way to understand what is at stake. It is now
drawn as a piece of country: a seeded coastline, hills, a river, pylons along
every corridor, and power stations you can tell apart by silhouette — cooling
towers, a chimney with a plume, a dam, a solar array, and turbines whose blades
turn at a speed set by what the farm is actually producing.

The part that matters is the towns. Each substation with load gets a cluster of
buildings, and **the windows are lit in proportion to the demand actually being
served**. When the relays shed load, the lights go out, on the map, in the place
it happened. That is the entire subject of the simulation, and it used to be a
small red stub.

None of it is invented per frame: the terrain comes from the network's own seed
and is cached to an offscreen canvas that is deliberately *not* keyed on zoom or
pan, so dragging the map costs nothing. Everything the operator is judged on —
loading colour on the same hard thresholds, the thermal accumulator filling along
a line, the dashed arc to the worst contingency — still draws on top and wins
every conflict with the scenery.

`probe_champion.js` prints one day interval by interval — demand, renewable
share, worst loading, worst contingency, redispatch, curtailment, lowest voltage,
running margin, and every action and event — then a full cost breakdown and the
separately-reported violation metrics. The fitness curve tells you whether a
controller is winning; it never tells you how, and on this problem an operator
that redispatches constantly, one that waits for the relay, and one that has
quietly learned to do nothing all score similarly on a calm network.

The trainer runs the unmodified `evolution.js` on several independent islands and
migrates the best genome between them, by advantage and only between islands on
the same tier. The final report benchmarks the champion on **networks and days
nobody trained on** — the layout seeds are drawn from a family the training run
never touches.

## Where it got to

The operator that ships with the page is generation 552 of a run that took most
of a day on four islands. On **48 held-out days** — six networks, layouts drawn
from a seed family no training run touches, days no training run has seen — it
comes out like this, in euros of operating margin per day against a do-nothing
control room:

| | quiet days (35) | eventful days (13) | all 48 |
|---|---|---|---|
| vs do-nothing, mean | −6k | **+686k** | **+182k** |
| vs do-nothing, median | −5k | −6k | −5k |
| vs do-nothing, worst day | −22k | −67k | −67k |
| demand served | 100.00% (= do-nothing) | **94.98%** vs 92.57% | **98.64%** vs 97.99% |
| redispatch ordered | 69 MWh | 86 MWh | 73 MWh |
| switching actions | 0.8 | 2.4 | 1.2 |

It is the only controller in the set with a positive mean margin: **+10k a day
against −171k for do-nothing, −188k for sensitivity redispatch and −190k for
redispatch-plus-topology.**

The shape of that table is the whole result, and it is worth reading carefully
rather than as a single number. **This operator is an insurance policy.** It pays
a premium of about five thousand euros a day, every day, and it beats do-nothing
outright on only three days in forty-eight. What it buys is the tail: on the days
that actually cost money it is 686 thousand a day better, it serves two and a
half points more demand, and its own worst day across the whole sample is minus
sixty-seven thousand — while do-nothing's worst days run to millions. On one
held-out day it was nine million euros ahead.

That is a real control-room posture and not a fudge: the reason a transmission
system operator exists is the tail. But it means the honest summary needs both
numbers, the mean and the median, because they say opposite things and both are
true.

What it has **not** learned is N-1 security: 49% of intervals against 49% for
do-nothing. It was never paid for it, and it never bought any. Given that the
brief asks whether an operator paid only to deliver energy cheaply ends up
running the system securely, the answer this run gives is a fairly clean **no** —
it learned to survive contingencies that actually happen, not to stand ready for
the ones that might.

Two earlier champions are worth recording as the things that did not work, since
both looked fine from inside the run:

* one that recorded an **8.4M advantage on the training set** and blacked out
  every held-out six-bus episode. It had won a single catastrophic day by
  accident, in euros, and euros are not comparable between days.
* one validating at **+1.14M a day on its validation bank's eventful days and
  minus 260 thousand on its quiet ones** — a gambler, not an operator, and the
  reason the crown now has a hard floor on ordinary days that no amount of
  crisis heroics can buy its way past.

## Things that turned out to matter

Each of these looked like "the GA is slow" and was not.

**Most days had nothing to learn from.** The big one, written up in full under
*Auditioning the day* above. Best equalled median equalled do-nothing, to the
euro, generation after generation, because that is the correct answer on a day
where nothing happens — and four days in twelve on the *storm* tier are days
where nothing happens.

**One line switched the redispatch reflex off during the only window worth
acting in.** Every generator is told its *relief* — how much a megawatt from it
moves the binding constraint — and that channel was gated by an urgency factor
of `max(0, maxLoading − 0.92) × 3`. Reasonable-looking: relief means nothing when
nothing is binding. But the money on this problem is not in clearing an overload,
it is in *preventing* one. A typical costly day sits at 83% loading with its worst
contingency at 130–155% for twenty minutes, and then a storm takes the second
circuit of the corridor and the cascade costs seven hundred thousand euros.
Through that entire window the gate was shut and every generator was told its
relief was zero, so the only genomes that could act at all were reacting to an
overload that had already happened — far too late for a thermal accumulator that
trips in five minutes at 130%. The *branch* was already chosen by its contingency
exposure; only the gate in front of it was blind. The gate now also opens on a
worst contingency above 1.45, and that threshold is calibrated rather than
chosen: the loading gate at 0.92 opens in about the top 15% of intervals, and
1.45 sits at the same rarity for N-1 on that tier. The first attempt used 1.02
and the worst contingency has a *median* of 1.16, so it held the channel
permanently open and turned relief into plain sensitivity. This changes what the
operator can see, not what it is paid for.

**The hand-wired prior was writing 1.5 into an output layer.** Every other
simulation on this site independently landed on the same rule — start the output
layer near zero — and this one had `randomGenome` obeying it (×0.06) while
`createBootstrapGenome` overwrote the same weights with 1.5. A reflex with no
sense of *how much* is needed overshoots on every interval it fires: the
bootstrapped quarter of the starting population redispatched 240–450 MWh a day
and lost 63k a day doing it, and that is the hole the rest of the run has to
climb out of. Wired at a fifth of the gain it points in the same direction, costs
almost nothing on a quiet day, and evolution is free to turn it up where it pays.

**The diurnal load shape was never normalised.** It peaked at 1.64× its own daily
mean, which stacked with the per-episode scale to put 1.7× nominal load on
networks whose ratings had been sized against a 1.34× study case. Every network
above twenty buses collapsed on its opening interval, and it looked exactly like
a solver bug. The shapes are now normalised to a mean of one with a peak around
1.33, and the study cases and the achievable load range are derived from the same
numbers.

**The generated networks had no capacitor banks.** A thirty-bus case sat at
0.89 pu on a good day and collapsed at 1.1× nominal. Not a solver problem — a
missing piece of plant. Reactive planning now sizes compensation until the worst
study case stands up.

**Renewable connections were sized with the whole fleet moving together.** Every
fleet-wide study case pushed all the wind up at once, which oversupplied the
system, which made the dispatch curtail, which meant an individual connection
never saw its own plant at full output. Real weather does not work like that —
one farm sits in the wind while its neighbour twenty kilometres away sits in the
lee. One line ended up at 160% for an entire evening with nobody able to do
anything about it. There is now one study case per plant: that plant at full
output, the rest becalmed.

**Redispatch was billed on the wrong quantity.** Charging the premium on the gap
between each machine and the market schedule charged the operator for the
market's own ramping between intervals and for frequency response — two thousand
MWh of redispatch that a do-nothing controller never ordered, which was most of
the margin. It is now billed on what the operator actually asked for.

**Uncommitted units were silently redispatched.** The deviation clip runs against
`[pmin − base, pmax − base]`, and for a unit the market left off bar `base` is
zero, so the clip pinned its deviation at its own minimum stable output. A unit
that is off is now not movable at all, which is also true.

**The zero-sum projection needed to be iterated.** Subtracting the mean and then
clipping to each machine's limits re-introduces exactly as much imbalance as the
clipping removed, so a controller that asked every unit to go up at once was left
with fifteen megawatts of genuine surplus that the slack machine absorbed for
free. Four passes take it under a kilowatt, and the test suite asks for it
directly.

**Storms were spatially uniform, and mostly landed in empty space.** A network
occupies a fraction of its bounding box, so uniformly-placed fronts hit nothing
and the storm tiers were quieter than the calm ones. Fronts are now centred on a
randomly chosen corridor — still uniform over corridors, nothing picks the
critical line — and their timing is drawn in proportion to the fourth power of
demand, because a corridor lost at four in the morning is an inconvenience and
the same corridor lost at the evening peak is the scenario every control room
drills. They are also capped at three lines: two from one front is a contingency
an operator can work with, five is a system separation nobody can control, and an
episode that ends in one measures the weather.

**The expert baseline was actively harmful until it verified its own switching.**
Acting on the DC screen alone, it cheerfully opened lines that the DC model said
were fine and the AC model said were the start of a voltage collapse — it blacked
out a six-bus network doing it. It now studies its top three candidates with a
real power flow.

**Advantage in euros crowns a champion that cannot be dislodged.** This one cost
a whole training run. On a storm day where every classical control room lost the
grid and scored −2M, a genome that merely survived to −1.5M banked +500 000 of
advantage. Judged in euros that is a hundred times any calm-day improvement, so
the genome it crowned — one that had learned to *thrash the topology*, twelve
switching actions an episode and no redispatch at all — became permanent. It
blacked out 100% of held-out six-bus episodes, scored a mean of −819k against
do-nothing's +115k, and beat do-nothing on 0 of 24 held-out days, while the
training log showed it winning by 8.4M. Dividing the advantage by the day's own
scale makes "survived a disaster nobody else did" worth about 0.25 and "ran a
calm day five thousand euros better" worth about 0.05 — both real, neither able
to buy immortality.

The lesson generalises past the fix: **the training-set advantage is not
evidence**. A default brain only ships here if it beats do-nothing on the
held-out benchmark, on networks and days no run has touched.

**A quarter of the runtime was one inverse CDF.** The clearness index needs an
inverse incomplete beta, which has no closed form; called once per solar farm per
interval it dominated the profile. It is now tabulated by inverting the forward
CDF on a grid once per parameter pair and cached for the process — built about
six times in a whole training run.

**The admittance matrix is 90% zeros.** Walking the sparse rows instead of the
full row, in the mismatch calculation that is the innermost loop of every
iteration of every solve, was the other large factor.

## What it is not

Five-minute steady state, not dynamics: no rotor angle, no governor response
inside the interval, no protection mis-operation, no under-frequency dynamics
beyond block shedding. Transformer taps are fixed, there is no switched reactive
compensation and no HVDC. Loads are constant-power, which is pessimistic at low
voltage and is why voltage collapse here is a little more eager than in a model
with ZIP loads. The N-1 screen is DC, so it under-reads on a feeder with a poor
power factor — that is deliberate, it is what real screening does, and learning
where the screen lies is part of the problem. And the operator cannot shed load
deliberately: shedding here is what the relays do when it has already gone wrong.
