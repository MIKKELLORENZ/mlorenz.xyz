# What worked — Smart Ocean Boats

A post-mortem of the neuroevolution run that produced the champion bundled in
[default_brain.js](default_brain.js) — the brain the page loads when you click
**"Watch the trained champion"**. Everything below is what the record actually
shows, ranked by how much it contributed to *that* brain, not by how good the
idea sounds.

## The shipped brain

| | |
|---|---|
| Name | `foundation_model_v2` |
| Net | `201 → 32 → 18 → 5`, tanh hidden / sigmoid out — **7,153 weights + biases** |
| Source | generation **20** of the canals-weighted run, itself seeded from `champion_gen160.json` |
| Selected by | a **6-seed × 24-boat held-out evaluation** across all five maps, run against two rival candidates |
| Eval seeds | 1001 / 2002 / 3003 / 4004 / 5005 / 6006 — none of them training seeds |
| Held-out result | Skerry **34,536** (18.7 arr) · Emerald **58,683** (31.3) · Silver **31,490** (17.0) · Canals **11,438** (6.3) · Open Ocean **58,129** (31.0) |
| Balanced score | 38,855 avg all maps · 31,490 worst gate map · no hole on any map |
| Reaches the browser via | `default_brain.js` → `window.DEFAULT_BRAIN` → `Net.fromJSON` in [main.js](main.js#L193) |

It is **not** the highest-scoring brain the project ever trained. A later gate
specialist (gen 216) beat it on all three scored maps and scored **zero
arrivals** in the canals. The shipped brain is the one that is strong
*everywhere*, and that distinction is the single most important thing in this
document.

### Provenance note

The offline trainer and its logs are **not in this repo** — `training/` was
deliberately emptied when the sim was published, since it was not part of the
app. What is reproduced here comes from three surviving sources: the metadata
embedded in `default_brain.js`, the sim source itself, and the build-session
record. Where a number is a measurement, it is quoted with the measurement that
produced it.

## The runs, in order

| Run | Start | Ended at | What it produced |
|---|---|---|---|
| Browser / single-thread | random | ~gen 60 | validated min **5,981** — the train/validation gap was the whole problem |
| Parallel, seeded | gen-60 champion | ~gen 40 | **plateau at 37,728** for 36 generations |
| Parallel + the three fixes | 37.7k champion | — | the plateau broke; used to validate the fixes |
| **Cold start** (user asked for random init) | random | **gen 160** | `champion_gen160.json` — worst gate map **52,414** (28.0 arrivals), still accelerating when stopped |
| Resumed | gen 160 | gen 276 | gen-216 gate champion — stronger on gate maps, **0 canal arrivals** |
| **Canals-weighted** | gen 160 | gen ~69 | **gen 20 → the shipped brain** |

The cold-start run's trajectory on the worst gate map: gen 48 → 10,061 · gen 80
→ 20,497 · gen ~120 → 29,479 · gen 156 → 31,466 · **gen 160 → 52,414**. It was
accelerating, not plateauing, when it was stopped to save the machine state.

## What worked, ranked

### 1. Multi-core domain randomization — judge each brain on many fresh courses per generation

The largest single effect in the project. Going from one episode per brain to
**15 workers = 5 maps × 3 fresh route seeds every generation** took the best
validated min from **~6k to 32k+**. Nothing else moved the number that far.

The mechanism is not "more compute" — it is that a brain scored on one course is
scored on luck. Averaging over many *unseen* courses per generation is what makes
selection pressure point at generalisation instead of at route memorisation.

In the browser the same principle is `TRIALS = 2` in [main.js](main.js#L72):
every generation is scored over two episodes with different missions and weather.

### 2. Re-inject the saved champion into the breeding pool every generation

This is what broke the 37,728 plateau. The trainer was saving the best validated
generalist to disk — and then breeding on without it. Selection noise drifted the
population toward Emerald specialists, and **36 generations failed to beat a
champion from generation 4**.

Saving a brain is not keeping it. The fix clones the champion back into the last
two population slots after every `evolve()`, so it stays a *parent*, not a file.
The gate min doubled (10,061 → 20,497) within 32 generations of the change and
kept climbing to 52,414.

The browser has the same idea in two places: **Eval mode** re-seats the champion
byte-for-byte each generation ([main.js](main.js#L113)), and **Inject** drops the
built-in champion into the pool with a guaranteed 10-generation shelter.

### 3. Weight the *worst* map, not the average

Selection went from `0.5·mean + 0.5·min` to `0.4·mean + 0.6·min`, and finally to
a portfolio: **65% gate maps (min-weighted) + 20% canals + 15% remaining skill
maps**. Without a floor term the population always specialises — Emerald was
"solved" at ~30 arrivals while Silver swung between 5 and 25.

The evidence the fix worked is not the score, it is *which map binds*: after the
change the limiting map kept rotating (Emerald led at gen 48, was the floor by
gen 80 while Skerry and Silver surged past it). A binding constraint that moves
around is the signature of a generalist population.

### 4. Give canals a real share of selection — 12% → 20%

Late in the project the run kept producing occasional canal-capable boats and
losing them. The cause was arithmetic: canals were folded into a shared "skill
bonus" worth about **12%** of selection, which is not enough to pay for a skill
that costs speed everywhere else. Raising it to a dedicated **20%** is what put
canal ability into the shipped brain (11,438 held-out, versus 8,509 for the
gen-160 foundation it was seeded from).

### 5. Pick the champion on held-out seeds, with enough of them

**This is the step that decided which brain shipped.** Three candidates went into
a 6-seed × 24-boat evaluation:

| Candidate | avg all maps | canals | worst gate | verdict |
|---|---|---|---|---|
| **gen 20** (shipped) | **38,855** | **11,438** | **31,490** | strong everywhere, no hole |
| gen 160 (`foundation_v1`) | 37,739 | 8,509 | 26,788 | good, weaker in tight water |
| gen 24 ("the 40k canals star") | 32,982 | **6,517** | 20,070 | mirage + a Skerry hole |

The gen-24 brain had logged **40,589** on canals during 2-seed validation and
looked like the obvious winner. On six seeds it was the *worst* of the three.
Held-out canals ability tops out around **11k** for every brain this project
produced; every 30–50k canals number in the training logs was route luck.

### 6. Time as the resource, and an episode cap that does not cap the goal

Each boat carries its own clock — 110 s to start, **+60 s per GPS point reached**
([world.js](world.js#L10)). A boat that keeps finding points keeps sailing; one
that stalls freezes with its score locked. This prices hesitation without needing
a hover penalty, and it is why the fitness ordering is "points in the least time"
rather than "distance covered".

It also contained a silent bug worth remembering: the episode ended at
`110 + 480 = 590 s` regardless of banked clock, which made the 100k target
*arithmetically impossible* (100k ≈ 50 arrivals ≈ 600+ s of sailing). The wall
backstop went 480 → **1600 s** and a boat now freezes after 80 arrivals. Both are
safety ceilings, not budgets — weak boats still end at ~110 s on their own clocks.

### 7. Price the odometer, so weaving stops being free

Nothing rewarded distance — but nothing punished it either, so a boat that
reached 80% of a leg by swaying scored the same as one that went straight, while
racking up survival time. The fix is a per-leg odometer and an efficiency charge:
**6 points per metre sailed beyond the progress earned** (×1.2 slack for turns
and current), capped at 400 per leg ([boat.js](boat.js#L67-L74)), applied both
live and banked at arrival.

The cap matters as much as the charge. Total collision penalties are likewise
clamped at **−500**, below the value of a single honest leg (1,000 + bonuses) —
so a boat can never improve its score by giving up.

### 8. The temporal window: 46 channels → 201 inputs, depth per channel

The controller was structurally **P-only**: it saw heading error but not its
rate, so a hull with rotational inertia driven through actuator lag snaked in a
limit cycle. The fix was history, not recurrence — each channel is fed as its
last *N* control ticks, with depth chosen per channel
([boat.js](boat.js#L80-L100)):

- **depth 5** — the 28 rays (closing speed on an obstacle), yaw rate, and the
  three commanded outputs (the actuator-lag pipeline). These are the D term.
- **depth 3–4** — accelerometer, bearing sin/cos, wind and current, cross-track, sway.
- **depth 2** — route-remaining, straight-line distance, leg heading. Slow
  channels; deeper history there is just weight the net must learn to ignore.

Lag-0 of channels 0–27 stays in place, so the sensor-ray overlay still reads
`inp[0..27]` unchanged.

### 9. Make the hard corners physically possible before blaming the brain

When tight maps stalled, the question "is this even navigable?" got measured
rather than argued. Across 400+ real GPS routes per map, counting corners by turn
angle × channel clearance:

| Map | corners/route | hard corners (≥60° in <3 m) | worst |
|---|---|---|---|
| Silver Fjord | 1.4 | **16.3%** | 94° in 1.75 m |
| Skerry | 1.8 | 7.3% | 108° in 2.1 m |
| Emerald | 0.7 | 8.2% | 86° in 1.8 m |

A foiling boat at 6 m/s had a **4.6 m** turn radius — wider than the channel at
those corners, so it *had* to drop off the foils and crawl, burning clock it
never got back. Raising `ROT_STATIC 0.18 → 0.26` and `ROT_DYN 0.30 → 0.48` cut
the radius to **~1.8 m** at speed. This also explained the fitness spread that
had been blamed on the GA: Emerald is nearly straight, Silver is the hardest map.

### 10. A map portfolio: gate maps plus training-only skill maps

Three scored maps (Skerry, Emerald, Silver) plus two that are trained on but
never gated: **Lantern Canals** (45.9% hard corners — pure tight-water practice)
and **Open Ocean** (empty water — learn to foil flat-out and hold a line). Adding
a hard map as a fourth *gate* would only have raised the bar; adding it as
practice transfers the skill to the maps that count.

Map connectivity is guaranteed by carving channel polylines into the land grid
*after* blob placement ([maps.js](maps.js#L287-L295)) — hand-placed blobs alone
pinch waterways shut. Canal endpoints are inset from the map edge (verticals
y=6..56, horizontals x=6..94) because routes were grazing the border wall at
0.00 m clearance; that alone took minimum clearance to 1.41 m.

### 11. GA hygiene that is load-bearing but invisible

- **Row-wise crossover** — whole neurons (incoming weights + bias) swap between
  parents, never individual weights ([nn.js](nn.js#L84-L100)). Per-weight
  crossover scrambles what each neuron computes.
- **Near-zero output init** — the output layer starts at 0.08× He scale, so fresh
  boats idle instead of thrashing; small actions mutate into useful ones far
  faster than saturated ones.
- **Rank 0 is always an untouched copy of the best**, no matter what else happens.
- **Champion grace** (3 in the browser, 4 in the trainer) — one unlucky episode
  cannot erase a proven brain, and defending the title refreshes the shelter.
- **Immigrant taper and crossover cutoff** — random immigrants ramp to zero at
  `immZeroFit`, crossover stops at `childZeroFit`, so a mature population is
  refined rather than diluted. Both keyed on the monotonic best-ever fitness so
  the counts never climb back after a dip.
- **Identical exam for everyone** — same point sequence, same spawn cluster, same
  weather for every boat in a generation. Brains are the only variable.

## The reward function, and the mechanics it prices

§6 and §7 above cover the two terms that were *changed* during the run. This is
the whole ledger, read from [boat.js](boat.js#L365-L381) and
[world.js](world.js#L222-L230), with the physical rule each term is priced
against. The physics never reads the score, so the ledger can be swapped and the
same episode replayed.

### The ledger

| term | value | the mechanic it is tied to |
|---|---|---|
| **arrival** | **+1,000** | banked when the boat is within **2.2 m** (straight-line) of the leg's goal — nearly four hull lengths, against a 0.34 m collision radius |
| progress, banked | +600 | the leg's full progress term, paid in whole at arrival |
| closeness, banked | +150 | likewise |
| speed bonus | `max(0, 240 − 6 × legTime)` | zero for any leg slower than **40 s**; a 10 s leg pays 180 |
| efficiency charge | `−min(400, 6 × (legDist − 1.2 × routeLength))` | distance *actually sailed* (world-frame odometer, so current drift counts) beyond 1.2× the planned route |
| clock | **+60 s** | added to the boat's own clock; the only way to keep sailing past 110 s |
| progress, live | `600 × (1 − bestRemainAlong / routeLength)` | remaining distance **along the router's path**, ratcheted on the best value ever reached |
| closeness, live | `150 × (1 − bestStraight / legInitStraight)` | straight-line distance to the goal, ratcheted |
| efficiency, live | same charge, against progress *earned* so far | applied every tick, not just at arrival |
| land strike | −25 each | on entering a land cell; 0.6 s cooldown between strikes |
| grinding | −15 per second | every second spent on land — the hull stops dead (velocity × 0.15) and stays until it backs off |
| ship contact | −30 each | 0.8 s cooldown; only from stage 2 on |
| **penalty cap** | **−500** total | land + grind + ship together can never exceed it |
| hit taken / landed / sink | −120 / +250 / +700 | stage 3 combat only: 3 HP, 22 m gun range, 9° cone, 1.4 s reload |

There is **no per-second income for being alive**. The only ways to earn are to
close distance along the route and to arrive, which is why §7 had to happen: with
no survival term, "sway toward the point" was the cheapest way to move the
progress ratchet, and the odometer is what made it cost more than it paid.

### Why the ordering holds

The comment in `fitness()` states the intended priority — *GPS points reached >
closeness > efficient/clean sailing* — and the numbers enforce it:

- One honest arrival is **1,750 + up to 240**. The penalty cap is 500. A boat that
  hits every rock on the way to a point still nets over 1,000, so no amount of
  collision damage ever makes an arrival not worth taking, and no boat can improve
  its score by stopping.
- Progress is measured **along the planned route, not as the crow flies**. The
  router plans around land ([route.js](route.js#L204-L240)), so a boat on the wrong
  side of a headland is *far* by the 600-point term even when it is *near* by the
  150-point one. The straight-line term is deliberately a quarter of the route term:
  it breaks ties on the final approach and nothing more.
- Both live terms are **ratchets** on the best value reached, so backing out of a
  channel or circling earns nothing — and the efficiency charge makes it lose.
- The speed bonus and the clock are what price **foiling**. The hull lifts onto the
  foils between 1.2 and 1.9 m/s and its drag drops from the displacement to the
  foil coefficient ([boat.js](boat.js#L49-L51)); a boat that stays in displacement
  mode finishes legs slowly, collects no speed bonus and runs out of clock. That is
  also why §9 mattered: at a 4.6 m turn radius the fast boat *had* to come off the
  foils in tight corners, so the physics and the reward were pulling against each
  other until the rotational coefficients were raised.
- Land is priced heaviest **through the grind**, not the strike. A single strike
  (25) is cheaper than a ship contact (30), but the hull stops dead on land, and a
  boat pinned against a beach by wind or current bleeds 15/s until it either
  reverses off — which needs 0.55 N of thrust to overcome stiction — or reaches
  the cap.

### What the trainer did with it

The score above is per boat per episode. The trainer's selection value was a
portfolio *over maps* — 65% gate-map minimum, 20% canals, 15% remaining skill
maps (§3, §4) — so the ledger decides ranking *within* a course and the portfolio
decides which courses count. The combat terms are in the code but off by default
([ui.js](ui.js#L17)); the surviving `ptrain.js` configuration does not record
whether stage 2 or 3 was enabled for the shipped lineage, so the numbers in this
document should be read as stage-1 navigation scores unless stated otherwise.

## What did not work, or actively misled

| Thing | What the record shows |
|---|---|
| Reading the training-score graph | At gen 24 the same brain scored **49,121** on Skerry in training and **5,319** held-out. The graph only ever plots the training number. |
| 2-seed validation | Three consecutive checkpoints on the same lineage: 32,696 → 5,319 → 18,287. A 6× swing that is pure route luck. Six seeds was the minimum that settled anything. |
| Saving only on the gate metric | The trainer wrote a champion only on a new best gate min, so canal-capable brains (logged at gens 149, 179, 203) were **never persisted and are gone**. The best-balanced brain the run produced was not saveable — an instrumentation defect, not a GA defect. |
| The "strong everywhere" auto-save bar | Set at gate ≥40k **and** canals ≥28k held-out. It never fired in 69 generations, because held-out canals caps around 11k. The bar was written from training numbers that were not real. |
| Chasing the gate score alone | The gen-216 champion beat everything on all three gate maps and scored **0 arrivals** in the canals. Specialisation is the default outcome whenever one metric decides what gets kept. |
| The 100k target | Never reached. Best worst-gate-map ever measured was 52,414 (gen 160, 2-seed validation); the shipped brain's worst gate map is 31,490 over six held-out seeds. |

## Rebuilding the trainer

`ptrain.js` was removed with `training/`. Its configuration, for anyone
reconstructing it:

```
POP 48 · K 3 route seeds/gen · 5 maps · GATE 3 (validation only on the first 3)
NWORK min(cores-2, NMAPS*K) = 15 · worker_threads pool
MUT_RATE 0.10 · MUT_SIGMA 0.15 · GRACE 4
LIMITS immZeroFit 70000 · childZeroFit 120000
VALIDATE_EVERY 4 · VAL_SEEDS [1001, 2002] · VAL_FLEET 24
selection = 0.65 * (gate min-weighted) + 0.20 * canals + 0.15 * remaining skill maps
after evolve(): champion.clone() into the last 2 population slots
usage: node ptrain.js [maxGens] [maxMinutes] [outPrefix] [seedFile]   # omit seedFile for a cold start
```

Two lessons to build in from the start, both learned the expensive way:
**validate on ≥6 unseen seeds** (two is noise), and **persist a brain per
criterion you care about** — a single "best" file guarantees you lose the
balanced brains.

## Watching it in the browser

No build step, no dependencies — open [index.html](index.html).

- **"Watch the trained champion"** — fills the fleet with `foundation_model_v2`.
- **Showcase** — the whole fleet becomes the champion at any time.
- **Inject** — drops the champion into an evolving pool with a 10-generation shelter.
- **Eval mode** — keeps a byte-for-byte copy of the elite each generation.
- `node test_headless.js` — map/dock routability, physics sanity, a few
  generations of evolution, serialization round-trip, gunnery.

Browser defaults ([ui.js](ui.js#L4-L25)): pop 48, 110 s clock, mutation 0.10 /
0.15, grace 3, `immZeroFit` 15,000, `childZeroFit` 25,000, two trials per
generation, route seed held for two generations, playback 2×.

---

*One stale doc, noted rather than silently fixed: [README.md](README.md) opens
with "three hand-crafted seas", but [maps.js](maps.js) has had five since Lantern
Canals and Open Ocean were added.*
