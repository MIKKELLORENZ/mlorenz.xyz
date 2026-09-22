# What worked — the walker that ships

A post-mortem of the brain in `default_brain.js`: what it is, what it can and
cannot do, and the chain of decisions that produced it. Written from the source,
the checkpoints and the training logs — on the laptop and on the training node —
not from memory. Where a number appears without a citation it was measured while
writing this, and the command that produced it is given at the end.

The user asked specifically that the reward functions be covered. They get the
longest section, because on this problem the reward function is most of the
project: five separate rewrites, each forced by a walker that found something
cheaper to do than walking.

---

## What ships

| | |
|---|---|
| file | `default_brain.js` (255 KB), assigned to `DEFAULT_BRAIN` |
| source artifact | `training/champion_gen6951.json` |
| contract | **365 → 48 → 32 → 33**, `relu` hidden with per-unit slopes, sigmoid out |
| size | **20,225 numbers** (weights + biases) |
| brain id | `535WMQ` — a hash of the weights, recomputed by the page |
| recorded | generation 6951, fitness 61372, **stage 5**, 2026-08-02 |
| ledger it trained under | `flat` (the post-fix ladder), `--heading-w 0.5`, `--surface-norm 1` |

**The observation, 365 numbers.** 194 sensor channels at the current control
tick, plus 171 temporal taps. The channels: gravity direction (3), pelvis
angular rate (3) and velocity (3), pelvis height (1), torso uprightness (1), 22
joint angles, 22 joint rates, foot load (2) and contact (2), foot position
relative to the pelvis (6), distance and sin/cos bearing to the waypoint (3),
gait phase sin/cos (2), a 36-cell 360° terrain ring, wind (2), the 22 actions
issued last tick, COM velocity (3), COM height above ground (1), COM over the
foot midpoint (2), the capture point (2), foot clearance (2), foot attitude (4),
and two 25-cell foveal height patches under the feet.

**The action, 33 numbers, all sigmoid.** 22 joint targets mapped onto each
joint's range, one gait cadence (0.55–1.7×), and an amplitude and a phase for
each of five joint groups (hip pitch, knee, ankle pitch, hip roll, arm swing).
The network never commands torque; a 500 Hz PD servo loop does that, and the
network moves at 50 Hz with one tick of latency.

**Verified.** `default_brain.js` and `training/champion_gen6951.json` agree to
**5.0e-9** across all 20,225 numbers — the bake rounds to 9 significant digits,
which is exactly what float32 needs to round-trip, so the browser runs the
network that was trained and not a near copy of it.

---

## What it actually does

Measured today, all on missions no generation ever trained on, stage 5, floor
starts off (the conditions the exam and the showcase both use).

**By surface** — 12 missions each, the shipped brain:

| surface | mean waypoints | mean metres | upright | ≥2 waypoints |
|---|---|---|---|---|
| rolling | **8.50** | 25.35 m | 83.0 s | 8/12 |
| mixed | 2.00 | 6.14 m | 29.4 s | 5/12 |
| stairs | **0.58** | 1.62 m | 10.8 s | 1/12 |

That split is the single most important fact about this walker, and a mean over
"varied" ground (3.7 wp) describes none of the three rows. On rolling terrain it
is a genuine walker: 130 seconds upright, 40–56 metres, twelve to sixteen
waypoints, no falls. On stairs it is not a walker at all.

The failures are not graded, they are **bimodal**: within a surface a mission
either produces 12–16 waypoints or it produces zero. There is almost nothing in
between. Any single-number score for this brain is a report on what fraction of
missions fell on which side.

**Rising.** It stands up out of any crouch (6/6 from every depth) and out of the
shallow half of the seat ramp (3/6 at seat 0.5). From the seat itself, and from
all five floor poses — prone, supine, side, curled, seated — it rises **0/6**,
every pose, peak COM 0.15–0.22 m. Getting up off the floor was never solved; see
the section on what did not work, which covers four separate attempts at it.

---

## The reward function

The physics never reads `FIT`, so the ledger can be changed and the same episode
replayed — which is what made every experiment below cheap and every claim
checkable. That property is worth designing for on purpose.

### The ledger as it ships

| term | value | when |
|---|---|---|
| `POSTURE` | 72 / s | stand phase only |
| `STAND_BONUS` | 180 | one-off, first time it holds full height for 0.6 s |
| `UPRIGHT` | 60 / s | balance phase only, only after standing |
| `BALANCE_BONUS` | 150 | one-off, held it 2 s |
| `PUSH_BONUS` | 45 | per shove survived, **capped at the first two** |
| `ALIVE_WALK` | 8 / s | a trickle through the walk phase |
| `STEP` | 25 | a foot fully off the ground ≥ 80 ms, **capped at 8** |
| `STRIDE_PER_M` | 500 | × how far forward that foot landed, ≤ 0.45 m/step |
| `PROGRESS_PER_M` | 900 | per metre of closure, only past the closest approach so far |
| `ARRIVE` | 1200 | + up to 300 for closure speed, + 250 × terrain, + 250 × wind |
| `FALL` | −180 | base; free below 0.8 m/s, then ×1.5 per m/s, capped at 6× |
| `RECOVER` | 120 | got back up, capped at 4 |
| `COM_RISE_PER_M` | 700 | per metre of *new best* COM height, held 0.2 s |
| `COM_HOLD` | 90 / s | dense, scaled by how high the mass is |
| `COM_RISE_CAP` | 500 | the two rise terms together |
| `RISE_GATE` | 0.45 | floor of the multiplier on a floor-start episode |
| `ENERGY_W` | 0.05 | per unit of effort, capped at 300; **×0.25 while down** |
| `WANDER_W` | 60 | per metre walked beyond 1.4× what the leg needed, capped 400 |
| `HEADING_W` | 0.5 | multiplier on closure income (0 by default; the run used 0.5) |

### Why it is a ladder and not a weighted sum

A weighted sum says every rung is **exchangeable at a fixed rate**, so enough
standing always buys a waypoint's worth of score — and evolution pays that
exchange rate every time, because standing is the cheaper currency to mint.
Measured on a real run's generation-161 champion: standing 2036, walking 1003,
arriving 100. A perfect stander outscoring a walker that reached a waypoint,
which is the intended ordering upside down.

A sum *can* express a hierarchy under one rule: **each tier's maximum total must
be smaller than one unit of the tier above.** Then the argmax of the sum is the
lexicographic order — waypoints, then walking, then standing — while the score
stays a single smooth scalar a hill-climb can follow.

```
rise           ≤  620     COM_RISE_CAP + RECOVER
stand+balance  ≤  741     a perfect statue, for the whole clock
walk, per leg   ~ 900/m   the whole leg's closure, whatever its length
arrive           1200     uncapped in count
```

The standing terms were brought down by a common factor of 0.30 rather than
retuned individually, on purpose: their ratios to each other are what teaches
stage 1, and scaling the tier leaves those ratios alone. Only the exchange rate
with the tiers above changes. `ALIVE_WALK` is counted against the *standing*
budget, not the walking one — being upright during the walk phase is something a
statue does perfectly.

### Five exploits, each of which ate a run

**1. Rocking. (the step bonus)** A step was first detected as *the load on one
foot going light*. The champion that produced: leg amplitudes driven to ~0.001
rad, feet moving 6 cm and 0 cm over eight seconds, load swinging 0.90/0.10 ↔
0.20/0.84, **8 steps credited, 0.00 m travelled.** A foot can be unloaded by
leaning, so selection had deleted the gait and kept the payment. A step now
requires zero contact points for ≥ 80 ms and is paid mostly for how far forward
it landed; re-scored under that rule, the same champion drops from 4.8 "steps"
and 2,894 points to 1.3 steps and 2,306 — the standing baseline, which is what
it was worth all along.

**2. Marching on the spot. (uncapped income for being a rock)** With the search
fixed the fleet climbed properly and immediately produced a walker that stood for
13–17 s, took seven or eight genuine steps and travelled **0.26 m**. Zeroing one
term at a time on the same seven missions found the marginal rate, which is what
biases behaviour — the one-off bonuses are a constant offset and bias nothing.
`PUSH_BONUS` was uncapped and shoves keep arriving every few seconds, so it was
unbounded income *for being hard to topple*, a direct subsidy against walking:
60/s for standing still. And `STEP` capped at twenty was 500 points for lifting a
foot twenty times, out-earning real stride 311 to 145 while carrying the walker
1.5 cm per step. Shoves now stop paying after two; steps stop after eight.

**3. Diving.** A flat `FALL` of −100 made pitching forward profitable: half a
metre of closure bought 450 and the landing cost 355. Every held-out mission
ended in a fall. The fall price is now severity-scaled — free below 0.8 m/s (a
sit-down), then linear, capped at 6× — and the base is deliberately small,
because early walkers fall constantly and a large flat penalty prices exploration
out of the search entirely. There is a test that asserts a dive costs more than
the closure a dive can buy; the earlier version of that test passed *vacuously*
against the tiered model while the flat model trained on the exploit.

**4. The gradient that died at 0.79 m.** Per-leg walking income was bounded at a
flat 960 shared with the step/stride allowance, so closure income stopped after
`(960 − 250)/900 = 0.79 m` — and the first waypoint is 1.3–2.3 m away.
Instrumented on the generation-141 champion: 7 of 12 held-out missions exhausted
the budget with 0.73–1.47 m still to run, and held-out distance sat at 1.01 m
across thirty generations. Past the cap, every further metre toward the waypoint
paid **zero**. A budget is not a truncation: the budget is now sized to the leg
(`900 × legInitDist + 250`) and refills on the next one, so the gradient is
uniform all the way to the waypoint and the *substitution* stays bounded rather
than the skill.

**5. Farming the rise ratchet.** `COM_RISE_PER_M` pays for new best height, which
a flail can touch and lose. It now requires the new height to be **held 0.2 s** —
long enough that a spike cannot collect, short enough that a real rise never
notices, since it passes through each height on the way up and stays.

### Two things that are multipliers, and why

**Heading.** The champion this was written for closed distance by *crab-walking*:
closure-weighted alignment 0.59–0.71, i.e. the pelvis averaging ~44° off the
waypoint. Closure alone cannot see it — a metre gained sideways and a metre
gained forwards are the same metre — and on stairs it is fatal, because a foot
placed across the fall line has no stride to recover with. The fix is a
multiplier on closure income, `k = (1−w) + w·max(0, cos θ)`, not an additive
bonus. It cannot be farmed (a walker pirouetting on the spot earns 0 × k = 0) and
it leaves every tier bound intact, so the lexicographic ordering cannot be
perturbed by tuning it. Verified: same seed, `w = 0` vs `0.5` gives identical
physics and a different ledger (17896 → 15660). It ranks; it does not steer. The
shipped run used `w = 0.5` **from generation 1** — applied to an established
crab-walker it fights the incumbent, applied from scratch it shapes the gait. The
run's own logs show alignment 0.82–0.92 throughout.

**The rise gate.** On an episode that started on the floor, everything earned is
multiplied by `0.45 + 0.55 × (best COM height / standing height)`. As an additive
term the whole rise ladder is 620 against 1200 for one waypoint, so a brain going
from never rising to rising perfectly gained under 1% of its total — correctly
shaped and worth nothing selection could see. Getting up is not paid; it is the
**gate on being paid** for the walking that follows. Floor is 0.45 rather than 0
so that "walked a bit while still down" keeps a gradient, and it is applied to
positive scores only, or a walker that stays down would be rewarded for it.

### Two smaller corrections that mattered

**Effort is metered differently while down.** Over 40 floor starts the busiest
quarter of walkers paid −271 in energy against a rise ladder capped at 500, and
finished *below* the quietest quarter (−6 vs +78) despite lifting the mass 30 cm
higher. The meter is calibrated for a gait, where thrashing is waste; on the
floor thrashing is the behaviour being asked for. `ENERGY_DOWN_W = 0.25`. Not
zero, so flailing in place still buys nothing unless the mass actually rises.

**A fall is priced by how high it fell from.** A dive out of a full stand costs
full price. Toppling out of a 30 cm partial rise is not a dive, and charging it as
one made attempting to stand strictly worse than lying still.

### The rule this ledger keeps proving

> *A reward for a quantity that is not in the observation is a reward for luck.*

It is stated in `walker.js` about heading, and then the project violated it
somewhere else for weeks: `comHeight()` drives `COM_HOLD`, `COM_RISE_PER_M` and
the rise gate — the entire get-up-off-the-floor ladder — while the only height
channel the walker could sense was the **pelvis origin**. On the floor those are
different quantities; the dense term's stated intent is that "a walker propped on
one elbow already outscores one lying flat", and the pelvis is on the ground in
both cases. COM velocity was not a substitute: it computes the offset every tick,
differences it, and throws the position away. Fixed 2026-08-01 by adding COM
height, COM-over-support and the capture point as real channels.

### What guards it

`test_headless.js` has 157 checks, and about twenty of them are the ledger:
*a perfect statue is worth less than one leg of walking*, *walk income stops dead
at the leg budget*, *the budget refills on the next leg*, *the shove bonus stops
after its cap*, *flat step income stays below one metre walked*, *weight-shifting
without lifting a foot is NOT a step*, *a dive costs more than the closure a dive
can buy*, *falling is worse than standing still*, *the standing terms keep their
ratios to each other*. Every one of those is a run that was lost once.

---

## Where the shipped brain came from

The lineage that produced it is only 35 hours long, and it starts from random
weights on 2026-08-01 at 20:12 UTC. Everything before that is a different genome:
the input layer changed from raw lagged samples to differenced window means, and
there is no `(channel, lag)` identity to graft the old weights onto, so the
2,950-generation predecessor was archived and the run restarted from scratch.

The run ran on the C++ port (`../3d_waking_cpp`) at pop 192 × 30 episodes on 120
threads, ~16 s per generation at stage 5. The curriculum ratcheted on its own:
stage 2 at gen 50, stage 3 at 593, stage 4 at 620, **stage 5 at 949**.

| phase | from | held-out best at the end |
|---|---|---|
| from scratch, 12 h deadline | gen 1 | 1.58 wp / 4.03 m |
| continuous, no deadline | 3596 | 1.83 wp / 4.40 m |
| rise ladder (contact-space rungs + sustained-height ratchet) | 4446 | 2.67 wp / 7.03 m |
| elite-mutant fleet (17% of seats, 4 density bands) | 5196 | 3.50 wp / 9.80 m |
| rise scaffolding (searched open-loop reference, handover mid-rise) | 5926 | **5.17 wp / 14.48 m** |
| rise scaffolding again, six minutes | 6951 | **6.17 wp / 17.01 m** at gen 6966 — the run's best |
| rise trials (every 10th gen ranked on mean COM height alone) | 6966 | nothing better in 1,910 generations |

**The shipped brain is the last champion of the scaffolding phase**, and the seed
both later experiments were launched from. It appears on the node under two
names, `champion_gen6951_preScaffold.json` and `champion_gen6951_preRiseTrial.json`,
byte-identical to the copy that was baked.

Two things about that are worth stating plainly.

**The fitness in the header is not a stage-5 fitness.** Generation 6950 was a
*rehearsal* generation (`st5~1` in the log) — every seventh generation runs an
earlier rung as a brush-up. The whole fleet scored roughly three times higher
there (fleet average 45,999 against ~12,000 either side), and the champion crowned
on that generation carries 61,372 into `default_brain.js`. Crowning on a rehearsal
is defensible — it is a paired comparison on identical missions — but the number
is measured on an easier exam than the run was otherwise taking, and nothing in
the file says so.

**It is not the brain the project's own held-out ratchet picked.** That was
generation 6966, fifteen generations later, at 6.17 wp / 17.01 m against 6951's
5.17. Why 6951 was the one baked is not recorded anywhere I can find. So I
measured whether it mattered — see below. It did not.

---

## What worked, ranked

**1. The rhythm layer, without which there is no gradient at all.** A feedforward
network reading a mostly-static posture settles to a fixed point, and a fixed
point is a walker standing still. Measured: **120 random brains produced a best
forward progress of 2 cm and a median of exactly 0.00 m.** Selection had nothing
to grip, which is why the first hundred generations went nowhere. So the leg
joints get `target = network offset + A·sin(phase + φ)` with A and φ as network
outputs — a CPG the network *modulates* rather than generates. A starts at zero
for every newborn, so this is a substrate, not a script. What it buys is that
**one mutation can produce a step** instead of a hundred coordinated ones.

Inside that, one detail was a mechanics bug rather than a learning problem: hip
roll must be wired **in phase** across the body while the other four groups are
anti-phase. Both hip-roll joints share the +X axis, so rolling them together tips
the pelvis and carries the COM over one foot — the only way a biped can unload the
other one. Wired anti-phase it splays both legs and shifts no weight at all:
measured, load stayed pinned at 50/50 at any amplitude and **no foot could ever
leave the ground.** Stepping was mechanically impossible, not merely hard, which
is also why the population settled for rocking.

**2. The ledger, rebuilt as a ladder.** The whole section above.

**3. Fixing the search before touching the reward.** A 350-generation run produced
a population whose mean never again reached its generation-1 value, and whose best
walker took zero steps by generation 251 — worse than random brains, which at
least stand. The cause was step size, inherited from the boats sim. Paired test, a
champion against 24 of its own offspring on the *same* three missions:

| rate | sigma | within 5% of parent | better | best of 24 |
|---|---|---|---|---|
| 0.10 | 0.150 | **0%** | **0%** | 1902 |
| 0.04 | 0.050 | 33% | 13% | 2657 |
| 0.02 | 0.015 | 75% | 63% | 2648 |

Not one child in twenty-four landed near its parent. The hill-climb had no uphill
move available. Note the last column: the smaller step also finds *better* peaks —
the large step was not buying exploration, it was pure damage. Defaults are now
0.035 / 0.04.

**4. Making the objective stationary enough to climb.** One fixed brain scores
1,031 to 2,934 depending only on which missions it draws, and the gap between two
good brains is a few hundred points — well inside the gap between two exam papers.
Three fixes, all necessary: missions **slide** so consecutive generations share
two-thirds of the bank; the bank is **stratified** so slot *e* owns difficulty
band *e* and surface *e* mod 3, with floor starts dealt out by Bresenham and start
headings permuted on a coprime stride; and the champion is **re-measured every
generation** in its own live seat rather than defending a running maximum.

The instrument that settles arguments here is `mission_variance.js`: replay one
unchanged brain on each generation's own bank. It found that a "fitness collapse"
from 7,800 to 1,300 was **7,786 → 416 on an unaltered brain, 18.7×** — the curve
was the calendar, reproduced to the digit. Stratifying took the same spread to
6.7×, and 14 episodes took it to 2.0×. 512×7 and 256×14 cost the identical 3,584
evaluations and the second is 3.4× quieter, so **trade population for episodes
when the failure mode is noise.**

**5. A curriculum where every episode replays the whole thing.** Stand, then
balance, then walk, in that order, every episode — so a walker physically cannot
be scored for walking before it has stood. The environment's difficulty ratchets
separately and **only forwards**; the gates were plain assignments, so a fleet on
stage 3 sitting between two floors was knocked back to stage 2 and could not
re-earn 3 (`st3·st3·st2·st3·st3·st2` from generation 170). `Math.max(s, 2)` was
the whole fix. There was already a test called *the ratchet never turns back*, and
it passed throughout, because it drove the fleet to the one competence band where
the bug cannot fire.

**6. An observation built out of differences, not lagged copies.** Ablation
against a **size-matched random-lesion null** — which is the part that makes it
mean anything — showed the old 600 ms raw-lag ladder was dead weight: zeroing all
30 of COM velocity's history inputs left the walker at 3.17 m against 3.17 m
intact, while random 30-input lesions left 0.09–0.23 m. The diagnosis is not "the
past is uninformative"; a raw lagged sample of a slowly-varying channel is nearly
a *duplicate* of lag 0. Replaced by `clamp((now − mean over window) × gain)` on
three disjoint windows (20–60, 80–300, 320–1200 ms). **Reach 160 ms → 1200 ms for
one extra input.** The gains have to be measured, not chosen: COM height moves
0.016 over 60 ms and 0.253 over 1200 ms, a factor of 16.

**7. Sensors that make the paid quantities observable.** COM height, COM over the
support midpoint, and the capture point ξ = com + v·√(h/g) — where a foot must land
to stop the fall, which is not recoverable by selection because it is a square root
of one channel times another. And a 360° terrain ring replacing a forward-only fan,
because from stage 3 about a third of legs double back and every turn was onto
ground the walker had never seen. Cost model that shaped all of it: hidden layer 1
is 48 wide, so **every input costs 48 weights**; foveate rather than tile.

**8. The C++ port.** 12.8 s per generation against the JS trainer's 67.7 —
**5.29×** — at 44 MB against ~9 GB of worker heaps. The shipped brain is generation
6,951 of a run that started 35 hours earlier; at JS speed that run reaches about
generation 1,300. The port was made trustworthy by comparing against things already
known to be right rather than by testing that it runs: the layout checked against
the live JS build, the fast inertia transform against a dense reference over
deliberately non-symmetric inertias (9.6e-15), free fall against its closed form
(8.2e-16), and a recorded JS episode replayed tick by tick — every environment draw
exact, and **all 364 sensor channels bit-identical at control tick 1**, which
isolates the whole sensing stack from any integration drift.

**9. Plateau tracks instead of guessing.** When smoothed best fitness goes flat over
450 generations, 36% of the pool splits into three isolated lineages seeded from the
leader, each breeding under a different mutation recipe for 50 generations; a track
that leads the paired comparison takes the crown and its settings. In the generations that led to
the shipped brain it fired six times, adopted a track every time, and **"gentler"
(0.018/0.024) won five of the six** — the run kept telling the same story and the
mechanism kept listening.
Note what plateau detection may *not* use: on a fleet with zero real improvement the
champion is replaced in **200 of 200 generations**, because the generation's best is a
max over 192 and the champion's score is one noisy sample.

**10. Selection living where nothing sleeps.** The laptop's autobaker died twice with
the lid, leaving the repo pinned to whatever brain was current. `autoselect.sh` runs
the held-out exam on the node every five minutes and keeps the winner beside its
score, so the laptop only has to fetch. And the bake carries the **stage** with the
brain, because the showcase used to pin stage 4 — point that at a younger champion and
it drops a stage-2 walker into 2.5× the shove and a wind it has never met, and the only
available reading is "the transfer is broken".

---

## The awkward measurement

The held-out ratchet recorded the run climbing 1.83 → 6.17 waypoints over its last
2,500 generations. It scores twelve **fixed** missions (900–990) and only ever moves
up. That is a high-water mark over roughly 1,900 candidate evaluations against an
unchanging bank, which is a shape this project has been bitten by before, so I
re-ran it on missions from outside that block.

Three brains from the run's own phase boundaries, plus the ratchet's winner, all in
the same JS build, paired mission by mission:

| brain | ratchet's 12 missions | fresh block A (24) | fresh block B (24) | ≥2 wp, 48 fresh |
|---|---|---|---|---|
| gen 4446 (pre-rise-ladder) | 1.08 wp | 4.67 wp / 14.85 m | 4.42 wp / 13.57 m | 16/48 |
| gen 5926 (pre-scaffold) | — | 3.46 wp / 11.21 m | — | — |
| **gen 6951 (ships)** | **5.00 wp** | 4.42 wp / 13.73 m | 4.00 wp / 11.85 m | **20/48** |
| gen 6966 (ratchet's pick) | — | 4.79 wp / 15.02 m | 4.46 wp / 13.55 m | 19/48 |

On the twelve missions the ratchet selected against, the shipped brain beats the
brain from 2,500 generations earlier by 4.6×. On forty-eight missions it never saw,
the two are indistinguishable: paired mean difference **−0.29 ± 0.54 waypoints** on
block A, and a single mission (a 12-waypoint coin flip) accounts for the whole of it.
The one statistic that does move is the count of missions where it reaches at least
two waypoints — 20/48 against 16/48 — which is a real but small gain, not a 3.4× one.

Same conclusion for the shipping choice: gen 6951 versus the ratchet's gen 6966 is
4.42 vs 4.79 on block A and 4.00 vs 4.46 on block B, 20/48 vs 19/48 on the robust
statistic. **The one-waypoint gap that separated them on the gate does not survive a
disjoint bank.** Baking 6951 instead of 6966 cost nothing measurable.

Two readings are available and I cannot separate them with what is on disk: either
the late gains are specific to those twelve missions, or those twelve are harder in a
way that discriminates between walkers that a fresh block does not. Both readings say
the same operational thing — **"6.17 waypoints" is not a property of the walker, it is
a property of the walker on that bank** — and both point at the same fix, which is a
gate whose missions rotate, plus a large paired duel before anything is called an
improvement.

---

## What did not work, or actively misled

| | what happened |
|---|---|
| **64-ray head LiDAR** | +240 inputs, genome ×1.79. Same-activation comparison at gen ~150: **with** LiDAR 0.00 wp and 0.41 m walked, **without** 0.50 wp and 2.75 m — roughly 5× further. A handicap while the fleet is still learning to walk. Removed in favour of foot-referenced sensing; the raycaster was not even ported to C++. |
| **Getting up off the floor** | Four programmes — a contact-space rung ladder, a searched open-loop scaffold that hands over mid-rise, rise-trial generations ranked on mean COM height, and the sensor fix that made COM height observable — across roughly 4,400 generations. Measured today on three checkpoints spanning that work: **0/6 from every floor pose, all three, unchanged.** What is ruled out, by measurement: not arm strength (3× shoulder torque moves peak COM by 0.000 m), not hip workspace (2.5× limits, 0.000 m), not search (a scripted open-loop ramp fails too). What blocks it: no curriculum rung ever leaves foot contact, so the fleet has never borne weight on a hand; and commanding the standing posture from a floor pose drives the COM *down* to 0.12–0.15 m, so a reward monotone in COM height scores every prefix of the correct solution below doing nothing. |
| **The last 1,910 generations** | Rise trials from gen 6966 ran 8.5 hours and never beat the incumbent on held-out, on either the rise axis or the walking one. |
| **Seeding a fresh run from a converged champion** | Measured four ways, all backwards: seed 2.08 wp, after 25 generations 1.25–1.67, at equal compute with more episodes 1.33. On the first generation there is no champion seat yet, so the resumed brain must win a 192-way argmax on one bank to keep its own crown. The shipped lineage exists because that run was restarted **from scratch**. |
| **The 600 ms COM-velocity ladder** | 33 inputs, 7.8% of the genome, measured dead against a random-lesion null. |
| **Tiered reward variants** | tiered-v1 dove for the metres (0.35 m, down 10/10); tiered-v2 stood still (0.11 m, 6.7 steps). Bounding progress was the wrong end — the shipped ledger keeps 900/m and scales the standing block to 0.30× instead. |
| **`model.groundPoses`** | A list of five floor poses that was never used to choose a start pose — `world.js` only ever called `seatAt()` and `crouchAt()` and referenced the list as a truthiness guard. Adding poses to it would have done nothing. |
| **Training fitness as a ranking signal** | Rehearsal generations inflate it ~3×, and the shipped file's header carries one such number. Separately, the pick-bank effect: six candidates ranked on one 10-mission bank spread 0.70–1.40 wp with a clear winner; on a second disjoint bank all six scored 0.90–1.00 and the ranking did not survive. |
| **"The crown changed hands" as a plateau signal** | 200 of 200 generations on a fleet with no real improvement. |

---

## What this does not establish

- **Nothing here is an A/B on the shipped brain's own lineage.** The five phases ran
  sequentially on one population, each seeded from the last, so "the elite-mutant fleet
  was worth 0.8 waypoints" is not a claim this record can support — the fleet, the
  scaffold, the rehearsals and ordinary drift all ran together. The ranked list above is
  ordered by the strength of the evidence *behind each mechanism*, not by measured
  contribution to this brain.
- **The stairs failure is not diagnosed.** Heading alignment was the leading hypothesis
  and the shipped run carried the heading multiplier from generation 1, reaching 0.82–0.92
  against the old champion's 0.59–0.71 — and stairs are still 0.58 waypoints. So alignment
  was not the whole of it, or not the cause at all.
- **The C++ and JS builds are not bit-identical over an episode** and cannot be; contact
  simulation is chaotic. The exam has a measured noise floor of about **±0.2 waypoints**,
  established by running two *JS* solvers that differ only in rounding. Every comparison
  in this document is same-build and paired, which is the only way around it.

---

## Reproduce

```bash
cd simulations/3d_walk_neuro_evolution

node exam.js training/champion_gen6951.json 5      # arg 2 is STAGE, not workers
node test_headless.js                              # 157 checks, ~20 of them the ledger
node bake_brain.js training/champion_gen6951.json  # champion -> default_brain.js
node mission_variance.js                           # one fixed brain across the bank calendar
node probe_memory.js                               # ablation against a random-lesion null
```

The three comparisons in this document were run with throwaway scripts built on
`exam.js`'s pattern — load the sim with `vm.runInThisContext`, build a `World` with
one walker, `terrainId` fixed or `varied`, `groundFrac: 0`, and drive it to
`isOver()`. Mission blocks 2000+ and 4000+ are disjoint from both the exam (900–990)
and training (1,000,000+).

Training ran on the node, not here:

```bash
# on the training host, in the C++ port
./launch_temporal.sh 120 12     # the from-scratch run this brain descends from
./autoselect.sh auto 300        # the held-out ratchet
```

---

## In the browser

`index.html` → **"Watch Mikkels AI"** clones the baked brain into every walker in the
fleet, so what is on screen is one gait repeated under different noise — which is also
a fair read on how repeatable it is. The page prints the brain id (`535WMQ`) beside it,
recomputed from the weights it loaded, so the label can be checked rather than trusted.

Two things the showcase does deliberately, both of which used to be wrong:

- **It does not start on the floor.** Training sets `ground: 0.45`, so nearly half of
  ordinary episodes begin seated or crouched — right for training, misleading for a
  demonstration of a walker that cannot get up. The held-out exam passes `groundFrac: 0`,
  so a showcase that did not was showing a 40% worse walker than the number beside it.
- **The stage travels with the brain.** `bake_brain.js` records the stage the run had
  reached and the showcase uses it, falling back to 2 rather than 4 when a brain has none —
  flattering a walker is a far smaller error than making a working one look broken.

`bake_brain.js` refuses to write if the brain's contract does not match the build, and
asserts the 9-digit rounding leaves the outputs identical. The autobake log is mostly
that refusal firing correctly: 40-odd consecutive `refusing to bake: brain is
249-48-32-33 but this build expects 489-48-32-33` while the node ran an older genome.

---

## Loose ends found while writing this

None of these affect the shipped weights.

1. **`README.md`'s headline table is two rewrites stale.** It states the brain as
   `133 → 48 → 32 → 29, tanh/sigmoid, 8,957 weights`; the shipped brain is
   `365 → 48 → 32 → 33, relu/sigmoid, 20,225`.
2. **`README.md`'s scoring table is the pre-fix ledger** — posture 240/s, stood 600,
   uprightness 200/s, balanced 500, shove 150 uncapped, step capped at 20 — i.e. exactly
   the values whose exploits the sections below it describe fixing. The shipped values are
   0.30× those, with shoves capped at two and steps at eight.
3. **The "open defect: the walk gradient dies at 0.79 m" section is fixed but still reads
   as open.** `beginLeg()` now sizes the budget to the leg.
4. **`default_brain.js`'s header carries a rehearsal-generation fitness** (61,372, scored
   on a stage-1 brush-up) with nothing marking it as such. A one-word note, or the held-out
   score instead of the training one, would stop it being read as a stage-5 number.
5. **`walker.js`'s own head comment describes an older sensor layout** (`NC = 32 + 3·NJ = 92`,
   29 outputs). The live layout is 194 channels and 33 outputs, and the offsets below the
   comment are derived correctly — it is the prose that drifted.

---

# Update, 2026-09-14 — the walker that gets up from a kneel

Eight hours, one goal: keep the walking, add getting up. What shipped is not an
evolved brain. It is a brain **distilled by gradient descent** from two teachers
and then touched by the GA for ten generations, and the route matters more
than the weights, so it is written down here. Everything below was measured on
the C++ trainer (`../3d_waking_cpp`) unless it says JS.

## The diagnosis that chose the route

Rising had read 0/6 from every floor pose for the whole project across ~4,400
generations of four programmes (see "What did not work" above). The
signal-versus-search arithmetic says why: one scalar per 130-second episode,
kneel/quadruped/prone starts are a tenth of the bank, and the correct movement
is a multi-second contact sequence whose prefix lowers the reward. Selection
could not see it. The remedy that worked on Tetris and orbital docking is a
**per-decision teacher**, cloned by DAgger, then handed back to the GA — and
this project already had half a teacher: the searched open-loop rise scaffold.

## Building a teacher that actually rises (the expensive part)

`walk3d_dagger` labels every control tick with a teacher: the shipped champion
while the walker is upright, a phase-tracked rise reference while it is
`downed`. Getting the second half to work took most of the night, and every
step was a measurement:

| what looked like the problem | what it was |
|---|---|
| tracker follows the reference but the body collapses at 3.6 s | the 3 s scaffold was only ever scored INSIDE its 3 s; holding its last knot collapses (0.84 m at 2.8 s → 0.24 m), and the champion cannot take over from that bent-forward posture either |
| a phase tracker that "runs away" | at the start of a rise the body is static, frames tie, an argmin over a +15 window jumps to the end; fixed by clock-like advance with a penalised nudge, and by anchoring to the EARLIEST tied frame |
| re-searching for "end standing open-loop" converges to a kneel at 0.59 m | open-loop rises are chaotic; mean-over-seeds prefers the robust low posture. **Score the gene by what the closed-loop champion ends in after handover** (`--finisher`) — that found a standing finish for kneel in one run |
| search says 16/16 seeds stand, harness says 2/17 | `missionSeed` drives the pose jitter and was held fixed, so all 16 "seeds" were ONE start pose; also the `downed` flag clears mid-rise and hands over at full upward velocity; also "standing at 7 s" accepted rises that fall at 6-7 s. Varied jitter + play the gene to its end + 7 s finisher window: **5/6 fresh seeds, 42/48 in the harness on flat ground** |
| recorded reference collapses | the reference frames were recorded from the clean, exactly-symmetric replay — a measure-zero case that fails where every jittered replay stands |

Quadruped (finisher search, 16 seeds) and a quadruped→kneel chain search both
came back 0/6; prone found nothing. So the teacher rises from a **kneel** on
flat ground and from nothing lower. That is the honest scope of this update.

## What DAgger did

Rounds are about a minute each at 30 threads; the whole loop is cheap.

- **Walking distils in one round.** Pure cloning of the champion: 2.42 wp on the
  12-mission exam. After one on-policy round: student-driven **5.44 wp on 120
  fresh varied missions** (the champion measures 4.85–5.2 on such blocks).
- **The kneel rise transfers partially.** 0 → 27–33% over five rounds and it
  plateaus there; rise-weight-8 rounds bought 58% at the price of walking
  (3.0 wp). A chaotic open-loop reference is a hard clone target.
- **The GA improves walking and deletes the rise.** Polishing the round-6
  student (resets off, 0.02/0.015 steps, stage 5 locked): by generation 31 the
  champion walked **6.43 wp against the shipped 5.05** on a second untouched
  block, and rose from kneel **0/97**. Kneel starts are ~9% of episodes and a
  400-weight mutation erases a fragile sequence faster than a 30-episode
  paired comparison can defend it. Later generations drifted back to 4.4–5.1.
- So the order is **GA first, then distil the GA's walker as the teacher**: a
  second DAgger loop with the gen-31 walker labelling upright states and the
  kneel scaffold labelling downed states gave students that walk at the
  teacher's level and rise from kneel 40–50%.
- **A few GA generations are safe, many are not.** Ten generations of polish on
  such a student kept the rise (54/108) and its walking; by generation 15 the
  rise was 10/108 and by 20 it was gone.
- **Deep-crouch rising regressed** (the exam's depth 0.75–1.00 rungs: champion
  6/6, students 0–2/6). No DAgger episode had started in a crouch; adding
  crouch starts labelled by the original champion (18/19 as a teacher) lifted
  the student only to ~26% — the crouch rise, like the kneel rise, does not
  clone cleanly. The showcase never starts in a crouch, so this costs nothing
  on screen, but `exam.js` will show it and it is a real loss.

## Measurement discipline, because every number above is fragile

The 12-mission exam is the inflated instrument this document already warned
about. Every decision here was made with `duel.sh` / `duel_final.sh`: the same
binary, one fresh mission block never used before, every finalist driven
on-policy over ~200 walking missions, ~140 kneel starts and ~60 crouch starts.
Two traps found on the way: a re-fit of the SAME sample files with a different
seed or schedule moves walking by ±1 wp (an 80-epoch, lr 1e-3 fit of data that
gave 5.15 wp at 40 epochs gave 1.17 — pick the student by playing, never by the
loss); and changing the harness's episode plan (adding a crouch fraction)
changed which missions a block contains, so duels across binaries are not on
the same episodes.

## What ships now

`default_brain.js` = `../3d_waking_cpp/dag/f22.json` (brain id `ND8B69`, 365-48-32-33, leaky ReLU 0.1,
`lineage` field carried into the bake). It is a fit of ALL fourteen sample
files of the second loop (walking teacher = the gen-31 GA walker, rise teacher
= the kneel scaffold `dag/rob3_kneel.json`, original champion as the
crouch-start teacher; ~1.2M labelled states), Adam, 40 epochs, seed 22 — the
best of five seeds fitted on identical data, confirmed on a second block. The
seed mattered by 2–4 wp between fits of the same samples; `s8` was the pick
for most of the night and is kept beside it.

Final duel, block 99000, same binary, every brain driving itself: 235 varied
stage-5 walking missions, 108 kneel starts (85% flat), 57 crouch starts.

| brain | walking wp | kneel → standing | crouch → standing |
|---|---|---|---|
| shipped champion, gen 6951 | 4.77 | 0/108 | 53/57 |
| GA walker, polish gen 31 | 6.07 | 0/108 | 6/57 |
| s8 (earlier pick) | 5.69 | 51/108 | 4/57 |
| **f22 — ships** | **6.12** | **68/108** | 3/57 |
| s14 (crouch-teacher rounds) | 5.46 | 52/108 | 5/57 |
| s14b (same data, other seed) | 5.31 | 59/108 | 12/57 |
| s8 + 10 GA generations | 5.43 | 51/108 | 7/57 |

Confirmation on a second block (77000), same binary: f22 **6.07 wp, kneel
56/108, crouch 10/57** against s8's 4.88 / 39/108 / 10/57 and the champion's
4.45–5.05 on that block in earlier duels — a walking gain of roughly +25% that
held on two blocks, with the kneel rise at 52–63%. In the JS build
(`node exam.js ../3d_waking_cpp/dag/f22.json 5`) it scores 4.75 wp on the twelve
fixed exam missions against the champion's 5.00
— that bank is the one this document already showed to be a poor instrument,
and it is quoted here only so nobody is surprised by it.

What it cannot do, stated plainly: rise from prone, supine, side, curled or
seated (unchanged, 0/6), rise from a deep crouch (regressed), or recover after
a real fall on rough ground (0 of ~150 falls across the duel; one recovery in
the whole session, by the polished snapshot). The kneel rise is trained on
flat ground and reads 8/48 for the teacher on varied terrain. "Gets up when
fallen" is therefore not delivered; "can stand up from a kneel" and "walks
better" are.

## Reproduce

```bash
# on the node, in ~/walk3d_cpp (source in ../3d_waking_cpp)
./walk3d_risesearch --pose kneel --finisher training/champion_gen6951_preRiseTrial.json \
    --finish 5 --settle 2 --knots 6 --T 3 --init dag/fin6_kneel.json --seeds 12 --out dag/rob3_kneel.json
REFS=dag/rob3_kneel.json DAGDIR=dag3 DAGGER_ARGS="--poses kneel:1 --floor-frac 0.45 --floor-flat 0.85 \
    --look 0 --lam 5 --d-max 2 --d-reanchor 2 --assume 0" ./dagger.sh dag/polish_g31.json 5 300 30
python3 distil.py --out dag3/f22.json --epochs 40 --rise-w 6 --seed 22 dag3/d[0-9].bin dag3/d1[0-3].bin
./duel_final.sh 99000 60 dag3/f22.json training/champion_gen6951_preRiseTrial.json
node bake_brain.js ../3d_waking_cpp/dag/f22.json         # in this folder
```

The next thing to try, if this is picked up again: a rise reference for
**quadruped** searched with the kneel gene as its chain finisher did not
converge in 300 generations from the old quadruped gene; a search seeded from
the pose itself (all knots = the quadruped posture) rather than from the old
lunge, and a `prone → quadruped` push-up searched the same way, are the two
open experiments. Everything else in the pipeline is in place for them.

---

# Update, 2026-09-15 — the two-net brain, and what "gets up" honestly measures

Written after a further day and a seven-hour night programme on compnode1.
The browser's built-in brain is now **two nets**: the GA walker `walk_g95`
(id AHS4ZC, 5.9 waypoints per episode, fewer falls than f22) and a separately
evolved rise net `risenet_kneel_k5g140` (id YENX4Z) that drives while the
walker is down and for one second after it recovers. Crouch starts and the
`horse` pose go to the walking net.

## The counting error that shaped yesterday

Every kneel-rise number reported on 2026-09-14 (52–63 %) counted the walker's
recovery flag, which fires after 0.35 s of "upright enough". Per-episode
traces (`walk3d_dagger --verbose 1`) showed the distilled brains firing it and
falling again within a second on nearly every kneel start: **rose 55 %, held
(no fall within 3 s) 8 %**. On crouch and seat starts the flag fires
immediately because the pose already meets its thresholds, so "rose" there is
0 information. All picks now use `held`.

## What the night measured (held, 82 starts unless stated; the browser table is 20 per pose)

| approach | result | verdict |
|---|---|---|
| distil the rise into the walking net (self-label DAgger, warm starts) | kneel held 8 → 20 %, walking kept | ceiling ~20 % — one net cannot carry both |
| rise-only GA from the distilled net, 8–24 eps/brain | trial "best" 1.1–1.4 but harness 54–66 %: winner's curse | pick snapshots by the harness, never the champion |
| rise-only GA, 96 eps/brain + held bonus | kneel **65 → 79 %** | the rise net that ships |
| two-net brain (walker + rise net) | walking 5.9 wp, kneel 79 %, crouch 70 % (walker) | ships |
| blend curriculum kneel → quadruped (lerp rungs) | rungs 0.10 / 0.13 / 0.16 / 0.19 passed one at a time, then 0/82 from plain kneel: forgetting; with mixed poses rung 0.16 stalled at 28/82 after 40 min | 16 rungs at 40–60 min each: not a night's work; blend path tips the body |
| jitter curriculum around kneel | amp 0.1 passed (51/82) | basin widens locally; heaps are far away |
| heap GA from the walker's own falls (`fall:1.0`) | 0/82 through 70 generations (after fixing a leak that fed it crouch starts) | no gradient from a kneel specialist |
| seat-ramp curriculum, small steps | seat:0.25 rose 51 held 0 for 61 gens | small steps refine, never create |
| same, LARGE steps (0.06 / 0.05) | seat:0.25 **held 76/82 in 30 gens**, kneel 0 | step size was a limiter; mean ranking trades the old skill away |
| large steps, rank by min over poses | kneel 0, seat 0 | the min rewards doing nothing everywhere |
| large steps, gated rank (keep the seeded pose ≥ 1.0) | kneel kept 60–74/82 for 66 gens, seat:0.25 0/82 | the gate stops the takeover; inside it there is no path to seat |
| open-loop search with a dense pose target (quadruped→kneel, seated→kneel) | 0/6, distance to kneel down to 1.06 | the 3 s / 6-knot formulation is the ceiling beyond kneel |
| reach: rise GA on kneel + supine + prone | 0/82 both, 71 gens | as expected |

## The browser's own pool, baked brain (20 episodes per pose, stage 5, flat)

| pose | rose | held | waypoints after |
|---|---|---|---|
| kneel | 20/20 | 17/20 | 10.3 |
| horse (walking net) | 20/20 | 11/20 | 6.9 |
| crouch starts (the stage's ordinary floor start, not a pool pose) | — | 42/60 deepest, 60/60 half depth | — |
| seated, side, curled, supine, prone, quadruped, hugknees, sidesit, bridge, crow, sideplank, warrior2, warrior3 | 0–15 | **0** | 0 |
| recovery after a real fall while walking | — | 0 of ~130 falls | — |

So: the humanoid stands up from a kneel and from a crouch and keeps walking;
it does not get up from any lying or sitting pose, nor after a real fall.

## Why it is stuck, as precisely as I can say it

1. **The GA refines a contact sequence it already has and does not create a
   new one.** Small mutations (the only ones a distilled or evolved net tolerates
   without collapsing) moved kneel 8 → 79 % and moved seat 0 → 0 in the same
   number of generations. Large mutations created a seat rise in 30
   generations and destroyed kneel in the same 30.
2. **Every ranking over a pose mix has a failure mode.** Mean → specialist;
   min → generalist that does nothing; a gate on the seeded pose is the right
   shape and was the last thing tried.
3. **Blended intermediate poses are not a physical path.** A 16 % blend from
   kneel toward all-fours tips the pelvis before the hands are placed; the GA
   climbs it, but at 40–60 min per 3 % rung.
4. **The open-loop search formulation is exhausted beyond kneel** — 3 s, 6
   knots, one finisher; every other pose is 0/6 with or without a dense target.
5. **Heaps have no gradient from here.** The walker's own falls end prone or on
   a side, which shares nothing with the kneel basin.

## What I would do next (not tonight)

- Per-pose specialist rise nets for the *named* pool poses, routed by start
  pose (the walker knows its start pose; a real fall does not, so this is a
  showcase fix, not the general skill). Large-step rise GAs make one specialist
  per pose in ~30 minutes each where the pose is crouch- or seat-like.
- For lying poses and real falls: a gradient method on the physics (PPO or
  similar with a reference-free get-up reward and early termination) or a
  reference motion. Neuroevolution with per-episode scalar fitness has been
  measured signal-limited on this exact problem five separate ways now.
- Keep `held`, per-episode traces and `probe_fall` as the instruments; the
  trial-vs-harness mismatch was found three times by them.

## Reproduce the shipped brain

```bash
# on the node, /data/walk3d_cpp
TRAIN=./walk3d_train_rs3 EPI=96 ./go_riseonly.sh dag/best_s14_1.json kneel 60 training_risek5 8   # rise net; pick snapshot g140 by the harness
./eval_snaps.sh training_risek5/snapshots 20 92000                                                   # (sort by the number after _g)
node bake_brain.js ../3d_waking_cpp/dag/walk_g95.json --rise ../3d_waking_cpp/dag/risenet_kneel_k5g140.json
node test_two_net.js 30 && node test_pool.js 20                                                     # in this folder
```

## Extension, 2026-09-15 01:35–02:40 UTC

- **Per-pose specialist rise nets** are now plumbed: `bake_brain.js … --rise-pose seated=file.json`
  puts `DEFAULT_BRAIN.riseNets[name]`, the walker picks `brain.riseNets[startPose]` at reset and
  falls back to the general rise net (real falls included), the C++ harness takes
  `--student-rise-pose name=file`. Verified (kneel through the map: 17/20). Five single-pose
  specialist GAs (seated, hugknees, sidesit, side, curled; large steps) reached 0/82 held in
  45 min — their trial score rose 0.27 → 0.40 m, the "sit up a little" plateau. Nothing to route yet.
- **Terrain is the shipped brain's real weakness:** kneel held 80/90 on flat ground, **14/90 on
  the varied terrain the showcase draws**. A small-step refinement on varied terrain stayed at
  12–13/82 for 71 generations. Note for whoever picks this up: in `train.cpp` the rise-only
  branch's `--rise-terrain` flags are overridden by `--terrain` a few lines later, so the run
  used `--terrain varied`; whether the trial's terrain draw matches the harness's is untested.
