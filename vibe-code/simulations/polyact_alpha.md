# 01 — The Input Neurons (NORMATIVE)

> **Scope:** this document describes **only the input side** of the contract — the 1280
> observation slots that a domain adapter fills and the brain reads. Actions, the brain's
> internal architecture, evolution and fitness are out of scope and live in their own
> documents.
>
> **Status:** normative. Observation layout version **1.4.1**, 1280 slots, `float32`.
>
> **Changed in 1.4.1:** no layout change — declares the **1.5 g dataset ceiling** on
> `gravity_magnitude` (slot 10): no training domain exceeds 14.7 m/s², which reads `0.905`
> after `tanh_scale(9.81)`. The transform's remaining headroom — usable to roughly 3 g — is
> deliberate deployment margin for worlds heavier than any in the dataset. Conformance
> check 12 enforces the ceiling.
>
> **Changed in 1.4.0:** block **J — gravity** claims `[1102 … 1104]` from the front of the
> reserve: the unit direction of gravitational acceleration in body frame — *which way is
> down* — or all-zero where gravity is absent (`gravity_present = 0`). Block H shrinks to
> `[1105 … 1279]`, 175 slots. No existing index moved; a 1.3.0 checkpoint loads into 1.4.0
> by zero-padding and produces bit-identical outputs.
>
> **Changed in 1.3.0:** block **A** claims three slots from its internal reserve —
> `tick_rate_present` (24), `tick_rate_slow` (25), `tick_rate_fast` (26) — carrying the
> control cadence in hertz as a presence bit plus a two-band log encoding. §12 now also
> specifies the directive bank's **on-disk asset pair** and widens the paraphrase draw grain
> to per-episode **or** per-generation. No existing index moved; reserved slots are unwired
> until claimed, so a 1.2.0 checkpoint loads into 1.3.0 by zero-padding the new encoder
> columns and produces bit-identical outputs.
>
> **Changed in 1.2.0:** block **I — directive** claims `[902 … 1101]` from the front of the
> reserve, carrying a 200-dimensional sentence embedding of the domain's objective stated in
> natural language. No existing index moved. A 1.1.0 checkpoint loads into 1.2.0 by
> zero-padding and produces bit-identical outputs.

---

## Summary — the ten blocks at a glance

The 1280 input neurons are partitioned into ten contiguous blocks. Each block is named
after **the question it answers**, not after the sensor that produced it.

| Block | Name | Slots | Range | The question it answers |
|---|---|---|---|---|
| **A** | context | 32 | `0–31` | *what kind of body am I, in what kind of world?* |
| **B** | ego | 86 | `32–117` | *what is my own kinematic state?* |
| **C** | boundary | 256 | `118–373` | *how close is a limit, what kind, how fast am I approaching it?* |
| **D** | objective | 48 | `374–421` | *how far to the target, and am I on plan?* |
| **E** | field | 384 | `422–805` | *what does the 2D space around me look like?* |
| **F** | action_history | 80 | `806–885` | *what did I already command?* |
| **G** | progress | 16 | `886–901` | *how am I scoring?* |
| **I** | directive | 200 | `902–1101` | *what have I been told to do?* |
| **J** | gravity | 3 | `1102–1104` | *which way is down?* |
| **H** | reserved | 175 | `1105–1279` | growth region, zero in 1.4.1 |
| | | **1280** | | |

**Block letters run in claim order, not index order.** `H` is defined as *whatever is left*,
so the reserve shrinks from the front and each new claim — `I`, then `J`, … — lands just
ahead of `H`. Renaming
`H` to keep the alphabet aligned with the indices would invalidate every existing reference to
"block H" for no gain; the letter is a label, and only the **index** is normative.

**A — context `[0…31]`, 32 slots, depth 1.** Twenty-seven binary and fractional descriptors of
the body and the world: is this planar or volumetric, discrete or continuous, does it have
thrusters or wheels or limbs or a cursor, is there gravity, a fall hazard, an adversary, an
energy budget, and — new in 1.3.0 — **at how many hertz is the loop running** (`tick_rate_*`).
Plus the run-level scalars the brain needs to interpret everything else —
`episode_progress`, `curriculum_stage`, `assist_strength`, `dt_scale` — and a constant `1.0`
bias at slot 23. **There is deliberately no domain identity in this block.** A capability
vector transfers to an unseen body; a one-hot domain id cannot. → [§5](#5-block-a--context-0--31)

**B — ego `[32…117]`, 86 slots, depths 5/3/1.** Proprioception in body frame: linear velocity
at three scale bands, three angular rates, attitude as sin/cos pairs, body-frame acceleration,
ground clearance and contact count. The rate-critical channels carry five log-spaced frames —
that history *is* the derivative term, and without it an inertial body oscillates forever.
This is the one block that is deliberately **not** generalised: its slots are specifically
kinematic, and a domain with no pose leaves all 86 at zero. → [§6](#6-block-b--ego-32--117)

**C — boundary `[118…373]`, 256 slots.** The largest structure in the vector: 32 rays × 8
channels, each ray carrying four log-spaced distances, three class bits and a closing rate.
Spatially this is a sphere of rangefinders — 16 equatorial, 16 off-plane, no two closer than
22.5°. Abstractly it answers *how close is a limit, what kind, how fast am I approaching it*,
which is why a non-spatial domain populates it with `(state variable, limit)` margin pairs and
uses the same eight channels unmodified. → [§7](#7-block-c--boundary-118--373)

**D — objective `[374…421]`, 48 slots, depths 3/1.** Where the target is and whether the plan
is being followed: bearing and elevation to the active waypoint, distance at three scale
bands, cross-track error, along-track rate, one waypoint of lookahead, plus goal geometry,
speed targets and the time budget. The three-offset distance history is **the stuck detector**
— a flat distance with non-zero speed means *moving and getting nowhere*. A geometric waypoint
is the spatial special case; a scheduled process milestone uses the same slots.
→ [§8](#8-block-d--objective-374--421)

**E — field `[422…805]`, 384 slots.** A local 2D field with four semantic channels
(`own`/`other`/`blocked`/`focus`) at two scales — a 7×7 foveal patch and a 4×4 whole-field
pool at two time offsets so change is visible — plus three 16-sample marginal profiles and an
8-slot entity code. A game board is the discrete special case; a terrain heightfield and a
navigation chart use the identical slots. The profiles are the strongest shared structure in
the contract: *a jagged surface profile with voids in it* is the same abstraction whether you
are placing a tetromino or a foot. → [§9](#9-block-e--field-422--805)

**F — action_history `[806…885]`, 80 slots, depth 5.** Efference copy: all 16 emitted action
channels at five log-spaced offsets, offset 0 being the previous tick. Actuators lag, and a
controller that cannot see its own outstanding commands oscillates against its own latency.
It also makes hold detection free — a held key is the same value on consecutive frames.
→ [§10](#10-block-f--action_history-806--885)

**G — progress `[886…901]`, 16 slots, depths 5/1.** The brain's view of its own scoring:
shaped reward delta across five frames, running NDS, a stuck meter, ticks since the last
milestone, five per-stage milestone fractions, and a domain-declared termination risk.
Together with `curriculum_stage` in block A, this is what lets **one** frozen set of weights
behave differently at stage 0 and stage 4 — the stage is an input, not a different network.
→ [§11](#11-block-g--progress-886--901)

**I — directive `[902…1101]`, 200 slots, depth 1.** The domain's objective, written as an
English sentence and embedded with `Qwen/Qwen3-Embedding-8B`, truncated from 4096 dimensions
to 200. Every other block tells the brain what is *happening*; this one tells it what it is
*for*. **The objective embeddings are the swappable element of the input structure**: each
domain ships 50 paraphrases of its objective as a paired JSON asset —
`objective_unembedded.json`, the spelled-out sentences, and `objective_embeddedings.json`,
their precomputed embeddings — and one row is drawn per episode or per generation and held
constant within an episode. The rotation is there to generalise: it tells the network what
kind of objective it must achieve, with slight variation so it keys on the shared meaning
rather than one constant vector. → [§12](#12-block-i--directive-902--1101)

**J — gravity `[1102…1104]`, 3 slots, depth 1.** The unit direction of gravitational
acceleration, expressed in body frame — the vestibular sense, the "projected gravity"
observation that learned legged locomotion standardly feeds. `gravity_present` and
`gravity_magnitude` in block A say that gravity exists and how strong it is; this block says
**which way it pulls given how the body is currently tilted**, without asking the brain to
compose it from the pitch and roll pairs. All-zero wherever gravity is absent — a Tetris
board or a chess game has rules, not accelerations.
→ [§13](#13-block-j--gravity-1102--1104)

**H — reserved `[1105…1279]`, 175 slots.** All exactly `0.0`. The only sanctioned way to add a
new sense, and claiming any of it requires an RFC. Unclaimed reserve is not wired into any
encoder, so it costs one float in a buffer and **zero parameters** — which is why the region
is generous rather than rationed. → [§14](#14-block-h--reserved-1105--1279)

---

## The four worked scenarios

**Every slot table in §5–§13 carries four extra columns**, one per scenario, showing what that
slot actually holds in four deliberately dissimilar domains. To keep the numbers comparable
across the whole document, each scenario is shown at **one representative instant**, held fixed
from §5 through §12; raw pre-transform values are given in parentheses wherever the transformed
number alone would be opaque.

| | scenario | dimensionality | tick rate | the instant shown throughout | why it is in this set |
|---|---|---|---|---|---|
| 🚤 | **hydrofoil** — manoeuvring a twin-engine 2D boat through an archipelago to a chain of waypoints | 2D top-down, continuous | 30 Hz | tick 760/1800 on `skerry_archipelago`: foiling at 2.7 m/s, yawing 0.31 rad/s, skerry 6.5 m dead ahead and closing, waypoint 34 m out 18° to port (3 of 12 reached), one vessel 12 m off the starboard bow | differential thrust, a speed-dependent loss of steering authority, wind and current |
| 🧱 | **tetris** — stacking falling blocks through a cursor | 2D top-down, **discrete** | 20 Hz | tick 420/1200 on `standard_10x20`: a T-piece falling at row 17, next piece L, 7 lines cleared, 23 pieces placed, stack 8 of 20 high, assist `a = 0.4` and decaying | irreversible discrete placement with consequences delayed by twenty pieces |
| 🚶 | **humanoid walk** — a simple bipedal figure balancing and walking to waypoints on varied terrain | **3D**, continuous | 50 Hz | tick 900/1500 on `uneven_ground`: mid-stride, pelvis 0.92 m up, `uprightness` 0.94, 1.2 m/s forward, left foot in contact, waypoint 4 m out 5° left (1 of 3 reached), an 18 cm step up 0.7 m ahead | the only domain that drives the full sphere of rays, three-axis velocity, roll/pitch and contact |
| 🧫 | **bioreactor** — supervising a 2 L cell culture for 20 days, holding setpoints while reacting to pH drift and falling viability | **non-spatial**, continuous | 1 tick / 15 min | day 8.0 of 20 on `fedbatch_standard`: VCD 9.2 ×10⁶, viability 0.94, indicated pH 7.12, DO 41%, glucose 3.4 g/L — and **the base pump stuck at 95% duty for two hours** while pH itself has not moved | sensors that lie, irreversible state on a 1000× timescale separation, hidden parameters |

---

## 0. What an "input neuron" is in polyact

An input neuron is **one `float32` slot at one fixed index in the observation vector**.

There are exactly **1280** of them, in every domain, on every tick, forever. The vector is
not a bag of features that varies by task — it is a fixed wiring harness. A hydrofoil, a
lander, a Tetris cursor and a walking figure all speak through the same 1280 wires, and that
is the only reason one set of weights can drive all of them.

Four properties hold for every input neuron without exception:

1. **Its index never changes meaning.** Slot 47 is `omega_roll` at offset 0 in 1.4.1 and it
   will still be that in 2.0. New senses are appended into the reserve (block H), never
   inserted. This is what lets a checkpoint trained today load into a future layout by
   zero-padding and produce **bit-identical** outputs.
2. **It is always finite and always in its declared range.** A NaN in an observation is a
   hard failure, not something to clamp away. There is no sentinel value for "missing."
3. **Unfilled means exactly `0.0`.** A hydrofoil has no board, so all 384 field slots read
   `0.0`. A chess cursor has no velocity, so most of the ego block reads `0.0`. "Absent" and
   "zero" are deliberately the same thing — the brain learns which channels are live from
   the context descriptors, not from a mask.
4. **Its normalisation is fixed and declared here.** Every slot names its transform and its
   constants. **There is no batch norm and no running statistics anywhere in polyact.**
   Running stats would make the same weights score differently in different generations,
   which silently destroys both reproducibility and the "the elite survives unmutated"
   guarantee that elitist selection depends on.

A domain adapter's entire input-side job is:

```
build_observation(world_state, episode_state) -> float32[1280]
    # fill only the slots your domain declares
    # leave every other slot at exactly 0.0
    # never write outside your declared blocks
```

It is a pure function of its declared inputs. No global state, no unseeded RNG.

---

## 1. The frame every input is expressed in

Body frame, right-handed, ROS REP-103:

```
+X  forward        +Y  left        +Z  up
roll about X       pitch about Y   yaw about Z
```

**Egocentric and canonical.** Continuous domains report everything in body frame. Discrete
domains canonicalise perspective — a chess board is flipped so both colours see their own
home rank at the bottom. A brain that has to learn "north" separately from "the way I am
facing," or every chess pattern twice, is spending capacity on the wrong invariant.

**`+X` is always the agent's nominal facing.** For a lander that is its nose, i.e. its thrust
axis — so ray 0 points where the lander points and ray 8 points at the ground when it stands
upright.

### Planar domains: top-down and side-on

A 2D domain is one whose motion is confined to a plane, and **that plane is always the body
XY plane**. Each domain orients its body frame so this holds. The two flavours differ only in
where gravity points:

| flavour | examples | gravity | `+Z` is |
|---|---|---|---|
| **top-down** | hydrofoil, city delivery, board cursors | absent, or perpendicular to the plane | up, out of the ground plane |
| **side-on** | moon lander | **in-plane** | the ignored lateral axis |

So a side-on lander is genuinely 2D: `task_is_2d = 1`, `vel_body_z` zeroed, off-plane rays
zeroed, and its 16 equatorial rays sweep the full circle *in its plane of motion* — exactly
what it needs.

**`uprightness` is the cosine between the body's nominal up axis and the anti-gravity
direction.** Each domain declares which body axis is nominal up. Where there is no in-plane
gravity, `uprightness` is the constant `1.0`.

---

## 2. Temporal encoding: how history becomes input neurons

Many channels appear more than once in the vector, once per **frame offset** — a snapshot
from that many control ticks ago. Offset `0` is the current tick.

Offsets are **log-spaced**, so five frames span eight ticks of history instead of five, at
identical slot cost:

| depth | offsets | used for |
|---|---|---|
| 1 | `[0]` | slow scalars — no history is worth the slots |
| 2 | `[0, 4]` | change detection |
| 3 | `[0, 2, 8]` | medium-rate channels |
| 4 | `[0, 1, 2, 8]` | ray distances |
| 5 | `[0, 1, 2, 4, 8]` | rate-critical channels and action history |

**Depth is per-channel, not per-block.** This is the single biggest slot saving in the
layout. Five frames of "distance remaining along the route" is pure wasted weight; five
frames of yaw rate is the difference between a P controller and a PD controller. A body with
rotational inertia and no rate history will snake in a limit cycle forever.

**Memory layout inside a temporal group is channel-major.** All `depth` frames of channel 0
come first, then all frames of channel 1, and so on:

```
index = group_start + channel_index * depth + frame_index
```

**At episode start, history frames hold the first observation repeated, not zeros.** A
zero-filled history reads to the brain as "I was just teleported into existence," and
populations waste early generations learning to ignore the first eight ticks of every
episode.

---

## 3. Transform vocabulary

Every input neuron uses one of these eight transforms. There are no others.

| transform | formula | range | notes |
|---|---|---|---|
| `binary` | `v ∈ {0,1}` | `[0,1]` | exactly 0.0 or 1.0, never in between |
| `frac` | `clamp(v, 0, 1)` | `[0,1]` | |
| `signed` | `clamp(v, -1, 1)` | `[-1,1]` | |
| `tanh_scale(k)` | `tanh(v/k)` | `[-1,1]` | soft saturation; near-linear for `\|v\| ≪ k` |
| `inv_dist(k)` | `1/(1 + v/k)` | `(0,1]` | requires `v ≥ 0`. **1.0 = touching, 0.0 = infinitely far** |
| `angle_sin` | `sin θ` | `[-1,1]` | |
| `angle_cos` | `cos θ` | `[-1,1]` | |
| `signed_log(k)` | `tanh(sign(v)·ln(1 + \|v\|/k))` | `[-1,1]` | signed quantities spanning orders of magnitude |

Two rules that fall out of this vocabulary and are worth stating explicitly:

**Never feed a raw angle.** `angle_sin` and `angle_cos` are always emitted as a *pair*,
occupying two input neurons. The wrap at ±π is a discontinuity a network cannot represent —
two headings one degree apart would produce inputs a full range apart. The pair is continuous
everywhere on the circle.

**Distances get inverted, not scaled.** `inv_dist` puts the resolution where it matters:
the difference between 0.2 m and 0.5 m from a wall is a large change in the input, while the
difference between 60 m and 90 m is almost none. A linear encoding does the opposite.

### Multi-band velocity encoding

A walking figure moves at 1 m/s; a hydrofoil at 40 m/s. No single `tanh_scale` serves both —
pick `k = 14` and the walker's entire dynamic range compresses into `tanh(0.07) ≈ 0.07`,
indistinguishable from noise after the first weight multiply.

So linear velocity is emitted **three times, at three scales**: `k = 1.4`, `14`, `42` m/s.
Every domain fills all three bands. The brain reads whichever band is not saturated. Three
orders of magnitude of usable resolution, at the cost of duplicated slots that are cheap
because the encoder is shared.

The pattern recurs wherever one quantity spans more range than one transform constant can
hold: waypoint distance is triple-banded in block D (`inv_dist(2/20/200)`, §8) and tick rate
is double-banded in block A (`signed_log(10/300)`, §5).

---

## 4. The block map

The 1280 input neurons are partitioned into ten contiguous blocks. **Each block is named
after the question it answers, not after the sensor that produced it.** The spatial reading
is usually the special case, not the definition — that is what lets a bioreactor populate
`boundary` and a walker populate `field`.

| Block | Name | Slots | Range | The question it answers |
|---|---|---|---|---|
| **A** | context | 32 | `0–31` | *what kind of body am I, in what kind of world?* |
| **B** | ego | 86 | `32–117` | *what is my own kinematic state?* |
| **C** | boundary | 256 | `118–373` | *how close is a limit, what kind, how fast am I approaching it?* |
| **D** | objective | 48 | `374–421` | *how far to the target, and am I on plan?* |
| **E** | field | 384 | `422–805` | *what does the 2D space around me look like?* |
| **F** | action_history | 80 | `806–885` | *what did I already command?* |
| **G** | progress | 16 | `886–901` | *how am I scoring?* |
| **I** | directive | 200 | `902–1101` | *what have I been told to do?* |
| **J** | gravity | 3 | `1102–1104` | *which way is down?* |
| **H** | reserved | 175 | `1105–1279` | growth region, zero in 1.4.1 |
| | | **1280** | | |

**D and I are both "the objective" and they are not redundant.** D is the *state* of the
objective — metres, bearings, a stuck detector — and it changes every tick. I is the objective
*described in words* — one embedding row swapped in from the domain's 50-paraphrase bank per
episode or per generation — and it is constant within an episode.

**Block B does not generalise, and that is deliberate.** "Self state" sounds like the natural
counterpart to the other question-shaped names, but B's slots are specifically *kinematic* —
velocity bands, angular rates, attitude, contact. Widening its name without changing its
content would invite exactly the shape-matching mistake §15 warns against. A domain with no
pose leaves B at zero and loses nothing.

### How much of the vector each scenario actually drives

| Block | slots | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|
| **A** context | 32 | full | full | full | full |
| **B** ego | 86 | **partial** — planar only | **zero** (bar `uprightness`) | **full** — the only one | **zero** (bar `uprightness`) |
| **C** boundary | 256 | **half** — 16 equatorial rays | **zero** | **full** — 32 rays | **full** — as constraint pairs |
| **D** objective | 48 | full | **4 slots** — non-geometric only | full | full — as a process schedule |
| **E** field | 384 | full — a chart | **full** — the whole input | full — a heightfield | **zero** |
| **F** action_history | 80 | full | full | full | full |
| **G** progress | 16 | full | full | full | full |
| **I** directive | 200 | full | full | full | full |
| **J** gravity | 3 | **zero** | **zero** | **full** — the only one | **zero** |
| **H** reserved | 175 | zero | zero | zero | zero |
| | | **≈ 915 slots, 71%** | **≈ 705 slots, 55%** | **≈ 1083 slots, 85%** | **≈ 580 slots, 45%** |

Totals count slots that *can* be non-zero for that domain, not slots that are non-zero at a
given tick. **No scenario drives the whole vector**, and that is the design working rather than
failing: a body carries the wiring for senses it will never use so that **the same weights** can
be dropped into a body that does use them, and it leaves the rest at zero so that it does not
compete for encoder capacity with bodies it shares no structure with. What every scenario *does*
drive is blocks A, F, G and I — context, efference copy, scoring and directive — which is the
irreducible core: what kind of thing am I, what did I just do, is it working, and what was I
asked for.

---

## 5. Block A — context `[0 … 31]`

**The question:** *what kind of body am I, and what kind of world am I in?*

Depth 1 throughout — these are descriptors and slow scalars, and history of them would be
wasted slots. 27 declared channels, 5 reserved.

| idx | name | transform | meaning | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| 0 | `task_is_2d` | binary | world is planar; the Z axis is unused | **1** | **1** | 0 | **0** |
| 1 | `task_is_3d` | binary | world is volumetric | 0 | 0 | **1** | **0** |
| 2 | `world_is_discrete` | binary | turn-based / grid | 0 | **1** | 0 | 0 |
| 3 | `world_is_continuous` | binary | real-time physics | **1** | 0 | **1** | **1** |
| 4 | `agent_may_act` | binary | `0` while it is the opponent's turn or the agent is locked out | 1 | 1 | 1 | 1 |
| 5 | `episode_progress` | frac | `brain_steps_used / brain_steps_budget` | 0.422 | 0.350 | 0.600 | 0.400 (day 8/20) |
| 6 | `dt_scale` | tanh_scale(0.05) | control period in seconds | 0.583 (30 Hz) | 0.762 (20 Hz) | 0.380 (50 Hz) | **1.000 — saturated** (900 s) |
| 7 | `energy_remaining` | frac | fuel / battery; **`1.0` when the domain has no energy budget** | **1.0** — no fuel model | **1.0** — n/a | **1.0** — n/a | **0.62** — feed/base reservoir |
| 8 | `integrity` | frac | health / undamaged fraction; `1.0` when not modelled | 1.0 | 1.0 | 1.0 | **0.94** — culture viability |
| 9 | `gravity_present` | binary | gravity exists as a physical acceleration; its *direction* lives in block J | 0 | **0** — board gravity is not physical | 1 | 0 |
| 10 | `gravity_magnitude` | tanh_scale(9.81) | m/s²; dataset ceiling **1.5 g** | 0.0 | 0.0 | 0.762 (9.81) | 0.0 |
| 11 | `in_contact` | binary | any contact point touching anything | 0 — `1` if aground | 0 | **1** — left foot | 0 |
| 12 | `curriculum_stage` | frac | `active_stage / 4` | 0.50 | 0.25 | 0.00 | 0.75 |
| 13 | `body_has_thrusters` | binary | capability descriptor | **1** | 0 | 0 | 0 |
| 14 | `body_has_wheels` | binary | steered ground vehicle | 0 | 0 | 0 | 0 |
| 15 | `body_has_limbs` | binary | articulated joints under PD control | 0 | 0 | **1** | 0 |
| 16 | `body_is_cursor` | binary | abstract selector over a discrete board | 0 | **1** | 0 | 0 |
| 17 | `world_has_collision` | binary | | 1 | **0** | 1 | 0 |
| 18 | `world_has_other_agents` | binary | | **1** — traffic level | 0 | 0 | 0 |
| 19 | `world_is_adversarial` | binary | another agent actively opposes us | 0 | 0 — `1` on `hostile_sequence` | 0 | 0 |
| 20 | `world_has_fall_hazard` | binary | falling or toppling can end the episode | 0 | 0 | **1** | 0 |
| 21 | `assist_strength` | frac | current decaying-assist level; `0` = training wheels fully off | 0.0 | **0.40** — decaying | 0.0 | 0.0 |
| 22 | `rules_active` | binary | a rule / law penalty regime is in force | 0 | 0 | 0 | 0 |
| 23 | `bias_constant` | binary | **always exactly `1.0`** | **1.0** | **1.0** | **1.0** | **1.0** |
| 24 | `tick_rate_present` | binary | the domain runs against a clock at a declared control cadence | **1** | **1** — pieces fall on a timer | **1** | **1** |
| 25 | `tick_rate_slow` | signed_log(10) | tick rate in Hz, slow band | 0.882 (30 Hz) | 0.800 (20 Hz) | 0.946 (50 Hz) | **0.000** (1/900 Hz) |
| 26 | `tick_rate_fast` | signed_log(300) | tick rate in Hz, fast band | 0.095 | 0.064 | 0.153 | **0.000** |
| 27–31 | *reserved* | — | zero in 1.4.1 | 0.0 | 0.0 | 0.0 | 0.0 |

### Why there is no domain id

**Block A describes the body and the world, never the domain's identity.** There is
deliberately no `is_chess` slot, no `domain_id` one-hot, no name of any kind.

A one-hot domain id is the easiest possible shortcut for evolution to find, and a brain that
takes it has learned six disjoint policies behind a switch — it cannot transfer to an unseen
domain, which is the one thing polyact exists to demonstrate. A new domain instead declares
its *capabilities*, and a brain that has already learned "thrusters + gravity + fall hazard"
arrives with a usable prior for a body it has never driven.

This is not self-enforcing. The descriptor-robustness audit exists precisely to catch a brain
that has reconstructed a domain id out of a rare descriptor combination.

### Notes on individual channels

- **Slot 23, `bias_constant`, is always exactly `1.0`.** It gives every downstream unit a
  learnable bias term through the ordinary weight matrix, with no special-cased bias vector
  anywhere in the encoder path. It is also the cheapest liveness check in the system: an
  observation whose slot 23 is not `1.0` was built wrong.
- **Slot 7, `energy_remaining`, is `1.0` — not `0.0` — when the domain has no energy
  budget.** Zero would read as "out of fuel." The same reasoning gives slot 8 `integrity` a
  default of `1.0`. These are the two places where "unfilled means zero" is deliberately
  overridden by an explicit domain-declared default, and they are worth memorising because
  every other slot follows the zero rule.
- **Slot 6, `dt_scale`, lets one brain run at different control rates.** A policy whose
  damping is tuned for 50 Hz will oscillate at 10 Hz; making the tick length an input means
  the brain can scale its own dynamics rather than needing separate weights per rate.
  **It saturates below about 2 Hz** — `k = 0.05` was chosen for 20–50 Hz control, so any tick
  longer than roughly 0.5 s pins the slot at `1.000`. The channel is not wrong there, it is
  uninformative: it correctly says "very slow" and cannot say *how* slow. A domain in that
  regime **must not rescale `dt_scale` locally**; the constant is frozen, and the fix is a new
  slot from the reserve, not a private convention — which is exactly what 1.3.0 did on the
  fast side with the `tick_rate_*` trio below.
- **Slots 24–26, the `tick_rate_*` trio, are the simulation-speed sense: at how many hertz is
  this loop running.** A 30 Hz boat, a 60 Hz robot and a 1000 Hz tokamak coil controller are
  different *worlds* in a way the brain must know before it can pick its own dynamics, and
  `dt_scale` alone cannot carry it — `dt_scale` is the *period*, with its resolution at
  mid-rate periods, so at 1000 Hz it reads `0.020` and at 2000 Hz `0.010`, a difference lost
  after the first weight multiply. The trio is the *frequency* side, log-encoded where the
  period side has no resolution left.

  **It is one continuous quantity, not a set of rate categories.** A one-hot over "30 Hz /
  60 Hz / 1000 Hz" was considered and rejected for the same reason there is no domain id:
  categories cannot interpolate — a brain trained at 30 and 60 Hz meeting 45 Hz would land
  in a bin it has never seen — and a rare rate bin is a domain id in disguise. Control rate
  is ordered and spans orders of magnitude, which in this vocabulary means `signed_log`,
  emitted at **two scales** exactly as velocity is emitted at three: `tick_rate_slow` =
  `signed_log(10)` resolves roughly 1–60 Hz (30 Hz → 0.882, 50 Hz → 0.946), and
  `tick_rate_fast` = `signed_log(300)` resolves roughly 60 Hz–5 kHz (a 1 kHz loop reads
  0.899 there while every 20–60 Hz body sits below 0.2). The brain reads whichever band is
  not saturated.

  **`tick_rate_present` follows the `gravity_present` pattern and carries the
  "not applicable" case.** A turn-based domain — a chess cursor whose ticks are *turns*, not
  time — sets slot 24 to `0` and both bands to `0.0`: there is no hertz phenomenon to report.
  That is distinct from the bioreactor, which keeps `tick_rate_present = 1` with both bands
  at `0.000` — *it has a cadence, and the cadence is glacial* (1/900 Hz is below either
  band's resolution). Note the axes are independent: Tetris is `world_is_discrete = 1` yet
  `tick_rate_present = 1`, because its pieces fall on a real 20 Hz clock. The sub-hertz
  regime remains unresolved in magnitude — both bands read ≈ 0 there just as `dt_scale`
  reads ≈ 1 — so *how* slow a 15-minute tick is still cannot be said, and the `dt_scale`
  caveat above stands.
- **Slots 9–10 declare the gravity regime, and the dataset has a ceiling: no training
  domain exceeds 1.5 g.** `gravity_magnitude` is `tanh_scale(9.81)`, so Earth reads 0.762
  and the ceiling — 14.7 m/s² — reads **0.905**: every gravity the model ever trains on
  lives in `[0, 0.905]` of the channel's range. The ceiling is declared so that the headroom
  above it is understood to be *deliberate*, not slack: the transform stays informative to
  roughly 3 g (2 g → 0.964, 3 g → 0.995), so a future deployment on a world heavier than
  anything in the dataset — a robot on a foreign planet — feeds the brain a value it has
  never seen that still lies on the same smooth, monotone curve, rather than a clipped or
  privately re-normalised one. The low end needs no ceiling: the transform is near-linear
  below `k`, which is where other worlds mostly live (Moon 1.62 m/s² → 0.164, Mars
  3.71 → 0.361), and exact zero-g is `gravity_present = 0`, not a small magnitude.
  Direction is magnitude-free by construction — block J is unit length on any world.
- **Slot 12, `curriculum_stage`, and slot 21, `assist_strength`, are the brain's view of its
  own training regime.** Because the stage is an input, one frozen set of weights can behave
  differently at stage 0 (don't fall over) and stage 4 (chain waypoints) — the stage selects
  a behaviour, it does not select a network. And because the assist level is visible, the
  brain feels the training wheels coming off gradually instead of being blindsided when they
  vanish.

### Conformance rules specific to block A

- Slot 23 is exactly `1.0`.
- Slots 25 and 26 are exactly `0.0` whenever slot 24 is `0`, and are never negative.
- Slots 2 and 3 are mutually exclusive, and **exactly one of them must be set**.
- Slots 0 and 1 are mutually exclusive, but **may both be zero**. That declares a
  *non-spatial* domain — one whose state is not a position at all, such as a bioreactor
  whose "space" is a set of process variables. The ambiguity with "the adapter forgot to set
  them" is real and acknowledged; the fix is an explicit `task_is_nonspatial` bit claimed
  from block A's reserve, which is an RFC and not part of 1.4.1.

---

## 6. Block B — ego `[32 … 117]`

**The question:** *what is my own kinematic state?*

Proprioception, body frame throughout. Three temporal groups, each channel-major.

### Depth 5 — offsets `[0,1,2,4,8]`, 9 channels × 5 = 45 slots, `[32 … 76]`

Values in the scenario columns are the **offset-0 frame** of each channel; the other four
frames hold the same quantity 1, 2, 4 and 8 ticks earlier.

| slots | channel | transform | meaning | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| 32–36 | `vel_body_x_mid` | tanh_scale(14) | forward velocity, mid band (m/s) | 0.190 (2.7 m/s) | 0.0 | 0.085 (1.2 m/s) | 0.0 |
| 37–41 | `vel_body_y_mid` | tanh_scale(14) | left | −0.011 — slip | 0.0 | 0.004 | 0.0 |
| 42–46 | `vel_body_z_mid` | tanh_scale(14) | up | **0.0** — planar | 0.0 | −0.025 — descending | 0.0 |
| 47–51 | `omega_roll` | tanh_scale(3) | rad/s about body X | 0.0 | 0.0 | 0.091 | 0.0 |
| 52–56 | `omega_pitch` | tanh_scale(3) | rad/s about body Y | 0.0 | 0.0 | 0.261 (0.8 rad/s) | 0.0 |
| 57–61 | `omega_yaw` | tanh_scale(3) | rad/s about body Z | 0.103 (0.31 rad/s) | 0.0 | −0.038 | 0.0 |
| 62–66 | `uprightness` | signed | `world_up · body_up`; `1` upright, `−1` inverted | **1.0** — constant | **1.0** — constant | **0.94** — live | **1.0** — constant |
| 67–71 | `heading_sin` | angle_sin | world heading | 0.939 (1.92 rad) | 0.0 | live | 0.0 |
| 72–76 | `heading_cos` | angle_cos | world heading | −0.344 | 0.0 | live | 0.0 |

These nine get the deepest history in the whole ego block because **this history is the
derivative term.** A rate signal with no past is a P controller; the same signal across five
log-spaced frames lets the brain form both a rate and a rate-of-rate, which is what stops a
rotationally-inert body from hunting around its setpoint forever.

### Depth 3 — offsets `[0,2,8]`, 13 channels × 3 = 39 slots, `[77 … 115]`

Offset-0 frame shown. The boat and the walker are the pair to read across — the three-band
encoding is the whole point of this table.

| slots | channel | transform | meaning | 🚤 hydrofoil (2.7 m/s) | 🧱 tetris | 🚶 humanoid walk (1.2 m/s) | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| 77–79 | `vel_body_x_slow` | tanh_scale(1.4) | walking-speed resolution | **0.959 — saturated** | 0.0 | **0.695 — the live band** | 0.0 |
| 80–82 | `vel_body_y_slow` | tanh_scale(1.4) | | −0.107 | 0.0 | 0.036 | 0.0 |
| 83–85 | `vel_body_z_slow` | tanh_scale(1.4) | | **0.0** — planar | 0.0 | −0.244 | 0.0 |
| 86–88 | `vel_body_x_fast` | tanh_scale(42) | vehicle-speed resolution | 0.064 | 0.0 | 0.029 — near-dead | 0.0 |
| 89–91 | `vel_body_y_fast` | tanh_scale(42) | | −0.004 | 0.0 | 0.001 | 0.0 |
| 92–94 | `vel_body_z_fast` | tanh_scale(42) | | **0.0** | 0.0 | −0.008 | 0.0 |
| 95–97 | `accel_body_x` | tanh_scale(9.81) | body-frame accelerometer | 0.061 | 0.0 | 0.194 | 0.0 |
| 98–100 | `accel_body_y` | tanh_scale(9.81) | | −0.020 | 0.0 | 0.087 | 0.0 |
| 101–103 | `accel_body_z` | tanh_scale(9.81) | | 0.0 | 0.0 | **0.978** — heel strike, 22 m/s² | 0.0 |
| 104–106 | `pitch_sin` | angle_sin | | 0.0 | 0.0 | 0.139 (8° forward) | 0.0 |
| 107–109 | `pitch_cos` | angle_cos | | 0.0 | 0.0 | 0.990 | 0.0 |
| 110–112 | `roll_sin` | angle_sin | | 0.0 | 0.0 | 0.052 (3°) | 0.0 |
| 113–115 | `roll_cos` | angle_cos | | 0.0 | 0.0 | 0.999 | 0.0 |

The slow and fast velocity bands sit here, at depth 3, while the mid band sits at depth 5.
The mid band is the one nearly every domain lives in, so it earns the deeper history; the
outer bands mostly serve to keep resolution available at the extremes and need less.

**Every domain fills all three bands** — slow, mid and fast — from the same underlying
velocity. This is not optional and not "fill the one that fits": the brain's job is to read
whichever band is not saturated, and it can only do that if the unsaturated one is present.
That is a thing it can learn *once* and apply to any body.

Attitude is carried as `uprightness` (depth 5) plus `pitch` and `roll` sin/cos pairs
(depth 3), with `heading` sin/cos also at depth 5. Attitude is never a raw Euler angle in
the vector.

### Depth 1 — 2 slots, `[116 … 117]`

| idx | channel | transform | meaning | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| 116 | `clearance` | inv_dist(5) | distance to the ground / floor below the body origin | **0.435** — nearest shore, 6.5 m | 0.0 | **0.845** — pelvis 0.92 m above terrain | 0.0 |
| 117 | `contact_count` | frac | contact points touching / total contact points | 0.0 — `1.0` if aground | 0.0 | **0.5** — 1 foot of 2 | 0.0 |

Both change slowly relative to the rate channels, and the fast-moving information they would
carry is already in `vel_body_z` and `in_contact`. History here would be redundant slots.

**A domain with no pose leaves the whole block at zero.** A chess cursor has no velocity, no
attitude and no contact; all 86 slots read `0.0`, and the block costs it nothing but a memset.

**A widened reading must be declared.** `clearance` legitimately carries any "how much room do
I have before I run out of navigable surface" reading, not only a literal floor distance — but
the domain spec has to say so. An *undeclared* reinterpretation is the failure mode, not the
reinterpretation itself (§15).

---

## 7. Block C — boundary `[118 … 373]`

**The question:** *how close is a limit, what kind of limit is it, and how fast am I
approaching it?*

The largest single structure in the vector: **32 rays × 8 channels = 256 input neurons**,
addressed as

```
index = 118 + ray*8 + channel
```

### The eight channels of one ray

Each scenario column shows **one ray** — the most interesting one at that scenario's instant —
with its slot range, so the index arithmetic is checkable.

| ch | name | transform | meaning | 🚤 ray 0 `[118–125]` skerry dead ahead | 🧱 *(block zeroed)* | 🚶 ray 31 `[366–373]` nadir, terrain under the pelvis | 🧫 ray 24 `[310–317]` base-pump saturation |
|---|---|---|---|---|---|---|---|
| 0 | `dist_t0` | inv_dist(20) | hit distance, current tick | 0.755 (6.5 m) | 0.0 | 0.956 (0.92 m) | 0.800 (5% margin left) |
| 1 | `dist_t1` | inv_dist(20) | hit distance, 1 tick ago | 0.752 (6.59 m) | 0.0 | 0.955 | 0.798 |
| 2 | `dist_t2` | inv_dist(20) | hit distance, 2 ticks ago | 0.750 (6.68 m) | 0.0 | 0.953 | 0.795 |
| 3 | `dist_t8` | inv_dist(20) | hit distance, 8 ticks ago | 0.735 (7.22 m) | 0.0 | 0.947 | 0.775 |
| 4 | `class_static` | binary | hit a wall / terrain / immovable surface | **1** — land | 0.0 | **1** — terrain | **1** — hard limit |
| 5 | `class_dynamic` | binary | hit another agent or a moving object | 0 | 0.0 | 0 | 0 — `1` for a soft/spec limit |
| 6 | `class_goal` | binary | hit a goal marker or a hazard volume | 0 | 0.0 | 0 | 0 — `1` for a target band edge |
| 7 | `closing_rate` | tanh_scale(5) | `d(dist)/dt`, **negative = approaching** | **−0.493** (−2.7 m/s) | 0.0 | −0.004 | **−0.080** — margin shrinking |

Channels 0–3 are a depth-4 temporal group with offsets `[0,1,2,8]` embedded inside the ray's
own eight channels rather than expressed as a separate group — the ray is the atomic unit
here, which is why the index formula multiplies by 8 and not by a depth.

The three class bits are not one-hot. A ray that hits nothing has all three at `0`; a ray
that hits a moving hazard may legitimately set two. They describe the *hit*, not a category
partition.

`closing_rate` is redundant with the distance history in principle and essential in practice:
it hands the brain the derivative directly instead of requiring it to learn a difference
across two `inv_dist`-compressed values whose spacing depends on the absolute distance.

> **A non-spatial domain must choose its margin unit.** The four distance channels are frozen
> at `inv_dist(20)`, whose useful resolution sits around 1–100 in whatever unit is fed to it.
> A margin expressed in a variable's own small native units — say 0.48 of something — reads
> `1/(1 + 0.48/20) = 0.977`, indistinguishable from *touching the limit*, and every ray would
> sit pinned near 1.0. The adapter must express each margin in a **limit-relative unit that
> spans the transform's usable range**; **percent of that variable's operating band** works
> well — a full band of margin reads 0.167, a 5% margin reads 0.800, zero margin reads 1.000,
> and that is the convention the scenario columns above use.
>
> This is the adapter's responsibility and **not** a licence to change `k`. The transform
> constant is frozen; what is free is the unit the domain reports in — and that unit must be
> declared in the domain spec, like any other widened reading.

### The 32 ray directions

Ray directions are **fixed in body frame**. Maximum range is **20 m**.

The equatorial ring (rays 0–15) lies in the XY plane at azimuth `i × 22.5°` and is the only
part a 2D domain casts. The upper hemisphere (16–23) and the lower (24–31) mirror each other
exactly.

| rays | direction, body frame | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|
| **0–15** | equatorial ring, azimuth `i × 22.5°`, elevation 0°. **Ray 0 dead ahead**, 4 left, 8 astern, 12 right | **live** — land, traffic and shoals at hull level; ray 0 holds the skerry at 6.5 m | 0.0 | **live** — cast from the pelvis; open ground, mostly 0.5 | **primary state limits**, upper/lower pair per variable: pH `0–1`, DO `2–3`, temperature `4–5`, osmolality `6–7`, glucose `8–9`, lactate `10–11`, viability `12`, VCD `13`, working volume `14–15` |
| **16–19** | azimuth 0 / 72 / 144 / 216°, elevation **+30°** | **0.0** | 0.0 | open sky → 0.5, no class bits | **ramp-rate limits** — pH, temperature, osmolality, dilution |
| **20** | azimuth 288°, elevation +30° | **0.0** | 0.0 | open sky → 0.5 | sensor trust — pH probe |
| **21–22** | azimuth 36 / 180°, elevation **+65°** | **0.0** | 0.0 | open sky → 0.5 | sensor trust — DO, capacitance |
| **23** | **+90° — true zenith** | **0.0** | 0.0 | open sky → 0.5 (a ceiling would read here) | sensor trust — off-gas analyser |
| **24–27** | azimuth 0 / 72 / 144 / 216°, elevation **−30°** | **0.0** | 0.0 | **the terrain the swing foot will land on** — ray 24 hits ground at 1.84 m | **actuator saturation** — base pump, O₂ MFC, jacket duty, feed pump |
| **28** | azimuth 288°, elevation −30° | **0.0** | 0.0 | terrain to the right-rear | spare → 0.0 |
| **29–30** | azimuth 36 / 180°, elevation **−65°** | **0.0** | 0.0 | ground close in, fore and aft | spare → 0.0 |
| **31** | **−90° — true nadir** | **0.0** | 0.0 | **ground directly under the pelvis, 0.92 m** | spare → 0.0 |
| | **rays cast** | 16 — equatorial only | **0** | **32** — the full sphere | 28 — as `(variable, limit)` pairs |
| | **origin** | hull centre | — | **the pelvis**, in pelvis-body frame | non-geometric |
| | **rays left at zero** | 16–31 → 128 slots | all → 256 slots | none | 28–31 → 32 slots |
| | `class_static` **=** | land / shore | — | terrain and obstacles | **hard limit** — crossing it kills the culture |
| | `class_dynamic` **=** | another vessel | — | unused | **soft / spec limit** — fails QC, recoverable |
| | `class_goal` **=** | the active waypoint marker | — | the waypoint marker | **target band edge** — where we want to sit |

The pattern is chosen so **no two of the 32 rays are closer together than 22.5°** — the
equatorial ring's own spacing, and therefore the floor for the whole sphere. Including the
true pole rays matters for a legged body: ray 31 is what reads the ground directly beneath
the pelvis, and ray 23 is what will read a ceiling or an overhang when those exist.

### Conventions every adapter must honour

- **A ray that hits nothing within range reports `dist = max_range`**, so `inv_dist(20)`
  gives `0.5`, with all three class bits at `0`. It does **not** report zero — zero means
  "infinitely far," which is a different statement from "nothing within 20 m," and the class
  bits are what disambiguate them.
- **A 2D domain leaves rays 16–31 entirely at `0.0`** — all 128 slots.
- The 3D ray slots exist in every brain whether the domain drives them or not. A boat's brain
  carries the wiring for a sphere of senses it will never use, so that **the same weights**
  can be dropped into a walker. That is capability waiting, not waste, though it is not free:
  unused-but-wired slots do consume encoder parameters.

### Rays generalise beyond geometry

A rangefinder answers a question that is not fundamentally about space: *how close is a
boundary, what kind of boundary, and how fast am I approaching it.*

A non-spatial domain may therefore populate block C with **constraint proximity** — one "ray"
per `(state variable, limit)` pair, `inv_dist` of the margin, class bits distinguishing hard
limits from soft ones, and `closing_rate` as the drift rate toward that limit. A bioreactor
does exactly this: ray 0 becomes "pH margin to the alkalosis limit," ray 24 becomes "margin
to base-pump saturation." The eight channels are used completely unmodified.

This is legitimate because the abstraction genuinely survives the move: *a hull closing on
rocks and a pH closing on lysis are the same signal.* That is the strongest positive-transfer
hypothesis in the project, and §15 is the rule for judging when such a reinterpretation is
honest and when it is shape-matching.

---

## 8. Block D — objective `[374 … 421]`

**The question:** *how far to the target, am I closing on it, and am I on plan?*

Every continuous domain reduces to "reach a sequence of waypoints," and every non-spatial one
to "hit a sequence of scheduled milestones." That shared reduction is what lets a single
fitness ladder span boats, vans, landers, legs and cell cultures. A geometric waypoint is the
spatial special case — `wp0_bearing_*` and `wp0_elevation_*` simply read zero where bearing
has no meaning.

### Depth 3 — offsets `[0,2,8]`, 9 channels × 3 = 27 slots, `[374 … 400]`

Offset-0 frame shown in the scenario columns.

| slots | channel | transform | meaning | 🚤 hydrofoil (wp 34 m, 18° port) | 🧱 tetris | 🚶 humanoid walk (wp 4 m, 5° left) | 🧫 bioreactor (milestone in 2.0 days) |
|---|---|---|---|---|---|---|---|
| 374–376 | `wp0_bearing_sin` | angle_sin | body-frame bearing to the active waypoint | 0.309 | **0.0** | 0.087 | **0.0** |
| 377–379 | `wp0_bearing_cos` | angle_cos | | 0.951 | **0.0** | 0.996 | **0.0** |
| 380–382 | `wp0_elevation_sin` | angle_sin | **0 for 2D domains** | **0.0** — planar | **0.0** | **−0.224** — waypoint is below | **0.0** |
| 383–385 | `wp0_elevation_cos` | angle_cos | **1 for 2D domains** | **1.0** — planar | **0.0** | **0.975** | **0.0** |
| 386–388 | `wp0_dist_near` | inv_dist(2) | terminal-approach resolution | 0.056 — dead | 0.0 | 0.328 | **0.500 — the live band** |
| 389–391 | `wp0_dist_mid` | inv_dist(20) | | **0.370 — the live band** | 0.0 | **0.830 — the live band** | 0.909 — saturating |
| 392–394 | `wp0_dist_far` | inv_dist(200) | | 0.855 | 0.0 | 0.980 — dead | 0.990 — dead |
| 395–397 | `cross_track_error` | signed_log(2) | signed lateral offset from the route leg | 0.734 (3.1 m off the leg) | 0.0 | 0.180 (0.4 m) | **−0.463** — VCD 1.3e6 below plan |
| 398–400 | `along_track_rate` | tanh_scale(5) | rate of progress along the leg (m/s) | 0.478 (2.6 m/s) | 0.0 | 0.232 (1.18 m/s) | 0.192 — 0.97 doublings/day |

Note the 2D convention for elevation: `sin = 0`, `cos = 1`, i.e. elevation angle zero. Not
both zero — `(0,0)` is not a point on the unit circle and would be an out-of-contract
observation.

Distance is triple-banded exactly as velocity is, for the same reason: `inv_dist(200)` is
useful when the target is far away and saturates to near-1 during the final approach, while
`inv_dist(2)` is flat at long range and does all its work in the last few metres.

> **`wp0_dist_*` across three offsets is the stuck detector.** A flat distance history
> combined with non-zero speed means *"I am moving and getting nowhere"* — the single most
> valuable signal in the entire vector, and the reason a brain can learn to back out of a
> dead end rather than grinding into a wall until the episode ends.

### Depth 1 — 16 slots, `[401 … 416]`

| idx | channel | transform | meaning | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| 401 | `wp1_bearing_sin` | angle_sin | the waypoint *after* the active one | 0.62 | 0.0 | −0.21 | 0.0 |
| 402 | `wp1_bearing_cos` | angle_cos | | 0.78 | 0.0 | 0.98 | 0.0 |
| 403 | `wp1_dist_mid` | inv_dist(20) | | 0.24 | 0.0 | 0.71 | 0.0 |
| 404 | `waypoints_reached` | frac | reached / domain anchor for full credit | 0.250 — 3 of 12 | **0.175** — lines cleared, 7 of 40 | 0.333 — 1 of 3 | **0.500** — milestones, 3 of 6 |
| 405 | `route_fraction` | frac | **best-achieved** fraction of the route completed | 0.340 | **0.383** — pieces placed, 23 of 60 | 0.520 | 0.400 — of the 20-day plan |
| 406 | `capture_radius` | inv_dist(20) | how close counts as reached | 0.870 (3 m) | 0.0 | 0.962 (0.8 m) | 0.0 |
| 407 | `corridor_err_lateral` | signed_log(2) | landing / canal corridor offset | 0.0 — open water | 0.0 | 0.180 | 0.0 |
| 408 | `corridor_err_vertical` | signed_log(2) | glide-slope offset; 0 in 2D ground domains | **0.0** — 2D | 0.0 | **0.0** — ground domain | 0.0 |
| 409 | `target_speed` | tanh_scale(14) | domain-declared safe or ideal speed | 0.177 (2.5 m/s) | 0.0 | 0.085 (1.2 m/s) | 0.192 — planned growth |
| 410 | `speed_error` | tanh_scale(14) | current speed minus target speed | 0.014 (+0.2 m/s) | 0.0 | 0.000 — on target | −0.031 — growing slow |
| 411 | `time_budget_remaining` | frac | steps left / steps granted, including milestone refunds | 0.578 | **0.650** | 0.400 | **0.600** — 12 days left |
| 412 | `heading_error` | signed | signed heading error to wp0, normalised by π | 0.100 (18°) | 0.0 | 0.028 (5°) | 0.0 |
| 413 | `goal_width` | inv_dist(20) | pad / berth / lane width | 0.0 — open archipelago | 0.0 | 0.0 | 0.833 — harvest window in VCD |
| 414 | `goal_depth` | inv_dist(20) | pad / berth depth | 0.0 | 0.0 | 0.0 | 0.870 — harvest window in days |
| 415 | `goal_orient_sin` | angle_sin | required arrival heading, body frame | 0.0 | 0.0 | 0.0 | 0.0 |
| 416 | `goal_orient_cos` | angle_cos | | 0.0 | 0.0 | 0.0 | 0.0 |

Two details that adapters get wrong:

- **`route_fraction` (405) is best-achieved, never current.** It ratchets up and never falls.
  A current-progress signal that drops when the agent backtracks teaches it that backtracking
  is failure, when backtracking is often the correct move out of a dead end.
- **`wp1_*` gives one waypoint of lookahead at depth 1.** That is enough to start turning
  early into the next leg; a deeper plan is the brain's problem, not the contract's.

### Reserved — 5 slots, `[417 … 421]`

Zero in 1.4.1.

---

## 9. Block E — field `[422 … 805]`

**The question:** *what does the 2D space around me look like?*

A local 2D field with four semantic channels at two spatial scales, plus three marginal
profiles and an entity code. **A game board is the discrete special case, not the
definition** — a terrain heightfield under a walker and a local occupancy map for a vehicle
use the identical slots. A domain with no spatial field leaves all 384 at zero.

### The four semantic channels

Used identically in both the patch and the coarse tensor:

| channel | meaning | 🚤 hydrofoil — a chart | 🧱 tetris — a board | 🚶 humanoid walk — a heightfield | 🧫 bioreactor |
|---|---|---|---|---|---|
| `own` | claimed by, or belonging to, the agent | own hull footprint and wake | cells of the **active piece** | cells inside the support polygon, or reachable in one step | *(block zeroed)* |
| `other` | occupied by another agent | traffic | **0.0** — no opponent | another body or a moving obstacle | — |
| `blocked` | impassable, forbidden, or hazardous | land, or water shallower than draft | **settled cells** | not steppable: slope > 35°, rise > 25 cm, drop > 30 cm | — |
| `focus` | the currently actionable or goal-relevant overlay | the routed channel toward the active waypoint | the **ghost piece** — where the active piece lands if dropped now | candidate footholds, weighted toward the waypoint bearing | — |

The four channels survive completely different readings without straining, and `focus` is the
one that shows why they were chosen: in every case it means *the thing that is actionable right
now*. A brain that learns "steer toward `focus`" learns something that stays true when the
field underneath it changes meaning entirely.

`blocked` is similarly stable — impassable, forbidden or hazardous — and note that it is
**semantic, not geometric**. A slope threshold is a perfectly good `blocked`, and it would be
invisible to any occupancy grid.

### Layout

| part | slots | range | index formula | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| `patch` 7×7×4, depth 1 | 196 | `422–617` | `422 + (row*7 + col)*4 + ch` | 3.5 × 3.5 m at 0.5 m cells — the close-quarters manoeuvring window | 7×7 centred on the piece's bounding-box centre, zero-padded past the board edge | 0.84 × 0.84 m at 12 cm cells — **the foot-placement window** | **0.0** |
| `coarse` 4×4×4, depth 2 (offsets `0,4`) | 128 | `618–745` | `618 + ((row*4 + col)*4 + ch)*2 + frame` | 60 × 60 m at 15 m cells — traffic movement visible as change | the whole board mean-pooled; a falling piece and a line clear both appear as change | 4 × 4 m around the body — approaching terrain change | **0.0** |
| `height_profile[16]`, frac, depth 1 | 16 | `746–761` | profile along the **primary** axis | water depth per 22.5° bearing sector — the shoal map | **stack height per column** | **terrain elevation ahead**, 16 samples at 12 cm = 1.9 m | **0.0** |
| `void_profile[16]`, frac, depth 1 | 16 | `762–777` | voids in that same profile | navigable gap width per sector | **covered empty cells** — the holes | **drops and gaps** to step over, not up | **0.0** |
| `lateral_profile[16]`, frac, depth 1 | 16 | `778–793` | profile along the **secondary** axis | current strength across the channel | row fill | lateral traversability across the path | **0.0** |
| `entity_active[4]`, signed | 4 | `794–797` | fixed 4-d code, listed per domain | surface descriptor at the hull: depth margin, current vector, foiling feasibility | the **T-piece**: `(0, 0, 1, 0)` | surface under the stance foot: friction, compliance, slope, contact quality | **0.0** |
| `entity_upcoming[4]`, signed | 4 | `798–801` | fixed 4-d code for the next entity | the same for the next chart cell ahead | the **next piece, L**: `(0, 0, 0, 1)` | surface at the projected next foothold | **0.0** |
| *reserved* | 4 | `802–805` | | 0.0 | 0.0 | 0.0 | 0.0 |
| | | | **profile centring** | 16 sectors fill all 16 slots exactly | **10 columns centred**: `746–748` and `759–761` are `0.0`, data in `749–758` | 16 samples fill all 16 | — |

- **`patch` is the fovea.** 7×7 cells centred on the agent or cursor, clamped to the field
  and zero-padded outside it. Seven is not arbitrary: it covers a knight's full reach, any
  tetromino bounding box, and roughly 0.85 m of terrain under a walker at 12 cm resolution.
- **`coarse` is the periphery.** The *whole* field mean-pooled to 4×4, at two time offsets so
  that **change is visible** — a Tetris piece falling, an opponent's reply, a vessel crossing
  ahead. This is the only place in the vector where a spatial map carries history, and two
  frames is all it takes to turn a static map into a motion signal.
- **Fields narrower than 16 are centred in the profile slots**; unused slots read `0`.
- **`entity_active` / `entity_upcoming` are fixed 4-dimensional codes**, not one-hot indices
  and not learned embeddings. Each domain lists its codes in its own spec. Four `signed`
  slots encode which tetromino is falling and which is next, which piece the cursor is over
  and which is under threat.

### Why the profiles are what make this block generalise

| profile | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|
| `height_profile` | water depth per bearing sector | stack height per column | **terrain elevation ahead** | *(zeroed)* |
| `void_profile` | navigable gap width | covered empty cells | **drops and gaps to step over** | *(zeroed)* |
| `lateral_profile` | current strength across the channel | row fill | lateral traversability | *(zeroed)* |

"A height profile with voids in it" is *the same abstraction* whether you are placing a
tetromino on a jagged stack or a foot on a jagged staircase. That is not a pun — it is the
strongest shared structure in the entire input contract, and it is why a 16-sample elevation
profile resolves an 18 cm stair rise that 32 rangefinder rays cannot.

#### How 16 profile slots are actually laid out

Two illustrations of the slot arithmetic, since the index layout is where adapters go wrong.
The profiles are the same structure in every domain; only the units differ.

**Centring a narrower field** — a 10-column surface with heights `[3,4,4,6,8,7,5,2,2,3]`,
normalised by a field extent of 20 and centred in the 16 slots:

```
slot:  746  747  748 | 749  750  751  752  753  754  755  756  757  758 | 759  760  761
value: 0.0  0.0  0.0 | .15  .20  .20  .30  .40  .35  .25  .10  .10  .15 | 0.0  0.0  0.0
                     |  c0   c1   c2   c3   c4   c5   c6   c7   c8   c9 |
       └─ pad ──────┘└──────────── the 10 real columns ────────────────┘└─── pad ───┘
```

Unused slots read `0.0` at both ends. `void_profile` uses the identical layout, carrying the
covered empty cells under that same surface.

**A declared normalisation** — the profile transform is `frac`, so each domain declares what
`0.0` and `1.0` mean. Here, 16 terrain samples at 12 cm covering 1.9 m ahead, with elevation
taken relative to the stance foot over ±1 m, which puts flat ground at `0.50` and an 18 cm
rise at `0.59`:

```
sample:  0    1    2    3    4    5    6    7    8    9   10 …
ground: .00  .00  .00  .00  .00  .18  .18  .18  .18  .18  .18   (metres)
value:  .50  .50  .50  .50  .50 │.59  .59  .59  .59  .59  .59
                                └─ the step edge, resolved across one sample
```

A step is a clean discontinuity between two adjacent samples, where the same geometry spread
across two rays 22.5° apart in block C is effectively invisible. `void_profile` stays at zero
here — this is a step *up*, not a gap, and the distinction between "climb it" and "step over
it" is exactly what the second profile carries.

> Those two illustrations are the same data structure, filled by domains that share no physics,
> no action semantics and no dimensionality — and a policy that has learned *keep the profile
> flat and the voids empty* has learned something true in both. If any pair of polyact domains
> shows positive transfer, this is the pair, and this is the block it will come through.

That last point is worth keeping: "32 rays are too coarse to resolve stairs" is a real
limitation of block C, and the fix costs **no new slots at all** — a walker populates `field`
with a terrain heightfield, using 384 input neurons that were already there and already zero
for that domain.

---

## 10. Block F — action_history `[806 … 885]`

**The question:** *what did I already command?*

16 channels × 5 frames (offsets `[0,1,2,4,8]`), channel-major:

```
index = 806 + channel*5 + frame
```

The channel names are fixed; what each one *drives* is declared per domain. Scenario values are
the offset-0 frame — the action emitted on the previous tick.

| slots | channel | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|
| 806–810 | `prev_AXIS_UP` | common throttle **0.82** | unused, 0.0 | **inert** — 0.90 as scratch | temperature trim ↑ 0.0 |
| 811–815 | `prev_AXIS_DOWN` | brake flap 0.0 | soft drop 0.0 | **inert** 0.0 | temperature trim ↓ 0.0 |
| 816–820 | `prev_AXIS_LEFT` | steering CCW 0.0 | translate left **1.0** | **inert** 0.0 | impeller ↓ 0.0 |
| 821–825 | `prev_AXIS_RIGHT` | steering CW **0.24** | translate right 0.0 | **inert** 0.0 | impeller ↑ 0.15 |
| 826–830 | `prev_BTN_A` | port engine diff **−0.18** | rotate CW 0.0 | waist pitch 0.12 | O₂ sparge **0.62** |
| 831–835 | `prev_BTN_B` | stbd engine diff **+0.18** | rotate CCW 0.0 | waist roll −0.05 | CO₂ sparge 0.0 |
| 836–840 | `prev_BTN_C` | anchor latch 0.0 | hold / swap 0.0 | left hip pitch **0.41** | base addition **0.95** |
| 841–845 | `prev_BTN_D` | unused | unused | left hip roll 0.08 | N₂ sparge 0.0 |
| 846–850 | `prev_BTN_E` | unused | unused | right hip pitch −0.33 | continuous feed 0.40 |
| 851–855 | `prev_BTN_F` | unused | unused | right hip roll −0.06 | glucose bolus 0.0 |
| 856–860 | `prev_BTN_G` | unused | unused | left knee 0.55 | antifoam 0.0 |
| 861–865 | `prev_BTN_H` | unused | unused | right knee 0.19 | bleed rate 0.0 |
| 866–870 | `prev_MOD_FINE` | harbour trim 0.0 | unused | **compliant servos 0.55** | slow-ramp trim 0.30 |
| 871–875 | `prev_MOD_BOOST` | unused | disable rate limit 0.0 | torque boost 0.0 | **override authority 0.0** |
| 876–880 | `prev_COMMIT` | unused | **hard drop 0.0** | unused | gates bolus / antifoam 0.0 |
| 881–885 | `prev_CONFIDENCE` | telemetry only | **0.63** — ranks placements for the assist | telemetry only | telemetry only |

All 16 use the `signed` transform — they are the emitted action values, already in `[-1,1]`,
copied verbatim. **Offset 0 is the action emitted on the previous tick**, not the current one;
the current action does not exist yet when the observation is built.

This is **efference copy**, and it is not optional. Actuator lag is real — an ESC or a servo
is still executing what you commanded three ticks ago — and a controller that cannot see its
own outstanding commands will oscillate against its own latency no matter how good its
sensing is. The offsets are chosen to **cover that lag with margin**: 8 ticks of history spans
a typical actuator time constant several times over, whatever the tick rate happens to be —
and since 1.3.0 the rate itself is visible in block A's `tick_rate_*` trio, so the brain can
also know what those eight ticks span in wall-clock terms.

There is a second reason, unrelated to lag, that matters just as much. **In a well-controlled
loop, information moves out of the controlled variable and into the manipulated variable** —
pump duty tells you more than the level it is holding, jacket duty more than temperature,
throttle history more than speed. Whenever an inner loop is holding a setpoint the controlled
variable goes flat, and this block is where the remaining signal lives.

It also makes **hold detection free**: holding a key appears as the same value on consecutive
frames, so "hold to accelerate" emerges from the data with no dedicated hold flag, no
key-down/key-held distinction, and no extra slots.

All 16 channels are filled in every domain, including channels the domain's action decoder
ignores. The adapter does not get to decide what to record — it records what was emitted.

---

## 11. Block G — progress `[886 … 901]`

**The question:** *how am I scoring?*

### Depth 5 — offsets `[0,1,2,4,8]`, 1 channel × 5 = 5 slots, `[886 … 890]`

| slots | channel | transform | meaning | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| 886–890 | `shaped_reward_delta` | tanh_scale(0.05) | change in shaped reward this tick, at offsets `[0,1,2,4,8]` | `.09 .09 .08 .08 .07` | `.00 .00 .00 .00 .84` | `.11 .04 .12 .03 .10` | `.02 .02 .01 .01 −.31` |
| | | | *reading* | steady closing on the waypoint | **flat, with one large spike 8 ticks ago** — a line cleared | oscillating with the gait cycle | small steady gain, and a **loss two hours ago** |
| | | | *what 8 ticks of history spans* | 0.27 s | 0.4 s | 0.16 s | **2 hours** |

The only channel in this block with history, and it earns depth 5: the *trend* of the reward
delta is what distinguishes "this manoeuvre is working" from "this manoeuvre worked once."

The same five slots carry a quarter-second in a fast domain and two hours in a slow one, and in
both cases they answer the same question: *is what I am doing now working, and did something
just happen?* A delta that rises and falls periodically is a normal consequence of a cyclic
gait rather than a fault — a distinction available only because the history is there.

The `tanh_scale(0.05)` constant is tuned for a per-tick shaped reward on a 20–50 Hz domain. A
slower domain accumulates a much larger delta per tick and will use more of the channel's
range, up to and including saturation on a milestone — acceptable here in a way it is not for
`dt_scale`, because a saturated reward delta still says "something big happened," and that is
the useful part of the signal.

### Depth 1 — 9 slots, `[891 … 899]`

| idx | channel | transform | meaning | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| 891 | `nds_so_far` | frac | running estimate of this episode's normalised domain score | 0.48 | 0.37 | 0.41 | 0.55 |
| 892 | `stuck_meter` | frac | `1 − EMA(\|state change\|)` over a long window; `1` = fully stuck | 0.05 | 0.00 | 0.12 | **0.31** |
| 893 | `ticks_since_milestone` | frac | ticks since last milestone / budget | 0.12 | 0.04 | 0.28 | 0.19 |
| 894 | `milestone_0` | frac | stage 0 achievement — SURVIVE | 1.00 — never grounded | 0.35 — budget survived so far | 0.60 — upright fraction | 0.98 — viability > 70%, no excursion |
| 895 | `milestone_1` | frac | CONTROL | 0.44 — foiling with heading error < 15° | 0.62 — holes × flatness | 0.52 — best displacement, 3.1 m of 6 | 0.71 — ticks with pH/DO/T all in band |
| 896 | `milestone_2` | frac | GOAL-DIRECTED | 0.34 — best route fraction | 0.90 — best row fill | 0.52 — best closed fraction | 0.44 — best-achieved IVCD |
| 897 | `milestone_3` | frac | ACHIEVE | 1.00 — ≥ 1 waypoint | 0.38 — 23 pieces of 60 | 1.00 — 1 waypoint reached | 0.00 — no stable production phase yet |
| 898 | `milestone_4` | frac | SEQUENCE | 0.25 — 3 waypoints of 12 | 0.18 — 7 lines of 40 | 0.33 — 1 of 3 | 0.00 — no titre yet |
| 899 | `termination_risk` | frac | domain-declared danger scalar, e.g. tilt near capsize | **0.18** — closing on land | **0.40** — stack 8 of 20 | **0.06** — `1 − uprightness` | **0.29** — pH margin |

**The brain sees its own scoring, and that is the point.** Together with `curriculum_stage`
in block A, this is what lets **one** policy behave differently at stage 0 (don't fall over)
and stage 4 (chain waypoints) with **no weight change at all** — the stage and the milestone
vector are *inputs*, not a switch between networks.

`stuck_meter` (892) and `termination_risk` (899) are the two channels that let a brain
recognise a failing episode from the inside. `stuck_meter` is a long-window EMA precisely so
that it does not fire on a legitimate pause; `termination_risk` is domain-declared, which
means each domain is responsible for defining what "about to fail" means in its own terms.

**`stuck_meter`'s baseline is domain-dependent, and the brain must learn the baseline rather
than a threshold.** A body whose state genuinely changes slowly sits at a high resting value
with nothing wrong; a fast body sits near zero and any rise is meaningful. That is a real cost
of a fixed transform with no running statistics, and it is the correct trade — a running
normaliser here would make the same weights score differently in different generations.

### Reserved — 2 slots, `[900 … 901]`

Zero in 1.4.1.

---

## 12. Block I — directive `[902 … 1101]`

**The question:** *what have I been told to do?*

200 input neurons carrying **one embedding of the domain's objective, written as an English
sentence**. Depth 1 — one channel per embedding dimension, no history:

```
index = 902 + dim          dim ∈ [0, 200)
```

Every other block reports what is *happening*. This one reports what the agent is *for*.

The embedding comes from `Qwen/Qwen3-Embedding-8B`. Its native output is 4096-dimensional and
is **truncated to the leading 200** — the model is trained with Matryoshka representation
learning, so its leading dimensions are usable on their own — then L2-normalised to unit
length. The transform is `signed`: the components are already inside `[-1,1]` and are copied
verbatim, exactly as block F copies emitted actions.

Embeddings are **precomputed offline and shipped as a static asset**. Nothing here runs at
tick rate; the adapter does a table lookup.

### The shipped asset pair

The bank lives in the domain's directory as **two parallel JSON files with identical keys**,
`"1"` … `"50"`:

```
docs/domains/<domain>/semantic_inputs/
    objective_unembedded.json      # the sentences   — {"1": "The boat's goal is to …", …}
    objective_embeddedings.json    # the embeddings  — {"1": [200 floats, unit L2 norm], …}
```

The hydrofoil's pair is the worked example:
[objective_unembedded.json](domains/1_hydrofoil_boats/semantic_inputs/objective_unembedded.json)
holds the 50 spelled-out objectives, and
[objective_embeddedings.json](domains/1_hydrofoil_boats/semantic_inputs/objective_embeddedings.json)
holds their 200-dimensional embeddings under the same keys.

`objective_unembedded.json` is the **human-auditable source** — what the domain author writes,
reviews and paraphrases. `objective_embeddedings.json` is **what the adapter actually loads**:
row `i` is the finished input, already truncated and unit-normalised, so filling block I is a
table lookup and a memcpy. The embedding model never runs at training time, let alone at tick
rate. Editing a sentence without re-running the offline embedding build leaves the two files
silently disagreeing — which is why conformance (§16) pins block I to the shipped
*embeddings*, not the shipped sentences.

### The swappable element: one row per episode or per generation

Block I is the one part of the observation that is **swapped in between rollouts rather than
computed from world state** — this is how the network is told *what kind of objective it must
achieve* on this run. A row index is drawn from the bank and its embedding is copied into
`[902 … 1101]` verbatim. Two draw grains are sanctioned:

- **per episode** — a fresh draw every episode; maximum variation per unit of training.
- **per generation** — every individual in a generation is evaluated against the same row, so
  paraphrase difficulty cancels out of within-generation fitness comparisons instead of adding
  selection noise; the rotation then happens across generations.

Under either grain the drawn row is **held constant for the whole episode** — the objective
does not change mid-episode, so history here would be 199 slots repeating a constant — and the
row index must be a **deterministic function of the seed tuple**
`(master_seed, gen, domain, level, seed_idx)`, never an unseeded draw, or the bit-identical
replay guarantee of conformance check 8 breaks.

The rotation is there **to generalise**: a single fixed sentence per domain would give
evolution one constant vector to key on, whereas rotating over slight variations of the same
objective pushes the brain toward the meaning the paraphrases share rather than one exact
string.

| slots | channel | transform | meaning | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| 902–1101 | `directive[0…199]` | signed | unit-norm objective embedding | *"reach as many successive locations as possible while avoiding collisions, grounding…"* | *"clear as many lines as possible before the stack grows too high…"* | *"walk to each waypoint without falling, keeping the body upright over uneven ground"* | *"hold the culture at its setpoints while maximising viable cell density over the run"* |
| | | | *bank* | 50 paraphrases | 50 paraphrases | 50 paraphrases | 50 paraphrases |

A domain that declares no directive leaves all 200 slots at `0.0`.

---

## 13. Block J — gravity `[1102 … 1104]`

**The question:** *which way is down?*

Three input neurons carrying the **unit direction of gravitational acceleration, expressed
in body frame** — the vestibular sense. Depth 1, transform `signed` throughout:

| idx | channel | transform | meaning | 🚤 hydrofoil | 🧱 tetris | 🚶 humanoid walk | 🧫 bioreactor |
|---|---|---|---|---|---|---|---|
| 1102 | `gravity_dir_x` | signed | "down", forward component | 0.0 | 0.0 | **0.139** — leaning 8° forward | 0.0 |
| 1103 | `gravity_dir_y` | signed | "down", left component | 0.0 | 0.0 | 0.052 — 3° of roll | 0.0 |
| 1104 | `gravity_dir_z` | signed | "down", up component | 0.0 | 0.0 | **−0.989** | 0.0 |

The vector is **unit length where gravity is present and all-zero where it is not** —
`(0,0,0)` is not a direction, so absence is unambiguous, exactly as block I is either
bit-zero or unit norm. The zeros are mandatory, not stylistic: whenever block A slot 9
(`gravity_present`) is `0`, all three slots are bit-zero (conformance check 11). Tetris and
chess sit at zero by design — board gravity is a *rule*, not an acceleration, and teaching
the model otherwise would poison the one channel a falling body trusts most.

### Why it exists when pitch and roll already determine it

Block B's `pitch` and `roll` sin/cos pairs fix this vector completely — the brain *could*
recover it by composing two rotations. The argument for shipping it anyway is
`closing_rate`'s (§7): redundant in principle, essential in practice — hand the brain the
composed signal instead of asking it to learn spherical trigonometry. The learned
controllers agree: the walker that actually ships in the 3D-walking domain lists **gravity
direction (3)** as the *first* group of its observation, ahead of angular rate — this is the
"projected gravity" input that learned legged locomotion feeds as a matter of course, and it
is the quantity `uprightness` and the fall detector are made of.

The division of labour across the contract, stated once:

| quantity | where it lives |
|---|---|
| does gravity exist, and how strong | block A — `gravity_present` (9), `gravity_magnitude` (10) |
| which way it pulls, in my frame | **block J** — these three slots |
| how upright am I, with history | block B — `uprightness`, depth 5 |
| how fast "down" is moving | derivable — `ḋ = −ω × d`, and `omega_*` carry depth-5 history in block B |

That last row is why this block is depth 1 and three slots rather than nine: the rate of
change of the down-vector is exactly the angular rate the contract already carries at its
deepest history. Claim the state, derive the derivative — the reverse of block C, which
ships `closing_rate` precisely because there the state history is `inv_dist`-compressed.

### Who fills it

- **3D bodies fill it live, every tick.** For the walker it is the difference between
  "I am tilting" (`uprightness` falling) and "I am tilting *forward-left*" — the difference
  between a recoverable step and a fall. The vector is unit length on *any* world: a walker
  on Mars tilted exactly like this one reads an identical block J, and only block A's
  `gravity_magnitude` says the pull is weaker — or stronger, up to the 1.5 g dataset
  ceiling (§5).
- **Side-on 2D domains are the case that pays for the block.** A lander's gravity is
  in-plane: standing on its tail it reads `(−1, 0, 0)` — down is astern, along ray 8.
  Pitched 12° to port it reads `(−0.978, 0.208, 0.0)`, and that second component is the one
  number a landing controller wants: not *how far* off vertical, which `uprightness`
  already says, but *which way to thrust*.
- **Top-down 2D domains leave it at zero.** Their gravity is perpendicular to the plane of
  motion and dynamically irrelevant, which is why the hydrofoil already declares
  `gravity_present = 0` (§1, §5).
- **Discrete and non-spatial domains leave it at zero**, with `gravity_present = 0`.

### The `uprightness` identity

For a domain whose declared nominal-up axis is body `+Z`, `gravity_dir_z = −uprightness`
exactly — a free cross-check, and conformance check 11 enforces it for such domains. The
walker's columns show `−0.989` against an `uprightness` of `0.94` without contradiction:
its declared nominal up is the torso axis, not pelvis `+Z` (§1 — each domain declares the
axis), and mid-stride the torso leans further than the pelvis frame this vector is
expressed in. A domain whose two values differ must be able to point at that declaration.

---

## 14. Block H — reserved `[1105 … 1279]`

175 input neurons, **all exactly `0.0` in layout 1.4.1.**

Claiming slots here is the **only** sanctioned way to add a new sense. It requires an RFC —
because a claim is permanent, and the whole append-only guarantee rests on nobody claiming
casually.

Block-internal reserves — A's `[27…31]`, D's `[417…421]`, E's `[802…805]`, G's `[900…901]` —
are claimed the same way, by RFC and version bump, but only for a channel that answers **that
block's own question**; the 1.3.0 `tick_rate_*` trio in block A is the worked example. A
genuinely new sense lands here, as block J's down-vector did in 1.4.0. Either way the rule
is the same: reserved slots are unwired until claimed, so the claim costs nothing until the
version that makes it.

**Unclaimed reserve is not wired into any encoder.** It costs one float in a buffer and
**zero parameters**. That is why the reserve is generous rather than rationed: extending it
is nearly free, and the real cost only appears when a slot is claimed and an encoder grows to
read it.

### What each scenario would claim first

Block H has no table to fill, but each scenario has a known gap, and what it *would* claim is
a useful measure of how much of that domain the contract already carries.

| | scenario | what it would claim | why it is not claimed yet |
|---|---|---|---|
| 🚤 | hydrofoil | **an ambient flow field** — wind and current as vectors | Nothing in 1.4.1 observes wind or current. The brain must infer drift from the disagreement between commanded heading and actual track, via `cross_track_error`, the velocity bands and the heading history. That is exactly how a real hull estimates set and drift from GPS, so the gap is *survivable* — but it is a gap, and it is the first proposed RFC against the reserve. |
| 🧱 | tetris | **nothing** | The domain is fully expressed by blocks A, E, F and G. It is the only one of the four with no outstanding claim, which is a good sign for block E's design. |
| 🚶 | humanoid walk | **per-joint state** — actual angle and velocity per joint, against the commanded setpoint | There are no per-joint slots in 1.4.1. The brain has the *commanded* setpoints (block F) plus the resulting body state (block B) — proprioception by consequence rather than by encoder. A joint that fails to reach its setpoint because of an obstruction is only visible indirectly, and a poor walking score must be attributed with that in mind. |
| 🧫 | bioreactor | **process state, sensor health, ambient context, and a multi-day view** | The domain runs at roughly 80% fidelity on 1.4.1 with no contract change. What is compressed away is the worst of it: sensor trust is carried as four rays' proximity-to-a-threshold rather than the underlying drift, lag and time-since-calibration — so the brain can be told a probe is *becoming* untrustworthy but not *how* or *why*. |

Three of four scenarios want something, and none of them needs an index to move. That is the
append-only guarantee earning its keep: each of these is a block-H claim behind an RFC, and a
checkpoint trained before the claim loads afterwards by zero-padding and produces bit-identical
outputs.

**Blocks I and J are the claims that have gone through that process** — 200 slots in 1.2.0,
then 3 in 1.4.0, each taken from the front of the reserve, no existing index ever moved, and
every older checkpoint still loading by zero-pad.

---

## 15. The rule for reinterpreting a block

This is the single judgement call a domain author has to get right, and it deserves to be
stated as a rule:

> **Reinterpreting a block is legitimate when the abstraction matches, and illegitimate when
> only the shape matches.**

Chess reading `height_profile` as "material sum per file" is legitimate — both are *an
aggregate statistic per column of a grid*, so the encoder's learned structure genuinely
transfers. A bioreactor reading a boundary ray as "pH margin to lysis" is legitimate — a hull
closing on rocks and a pH closing on lysis really are the same signal.

Reading `vel_body_x_mid` as "glucose consumption rate" would fit the shape and nothing else.
The domain would compete for encoder weights with the boat and the walker **with no shared
structure to exploit**, degrading transfer while appearing free.

**When in doubt, leave the block at zero and open an RFC.** Zero is always a valid, honest
observation. A wrong reinterpretation is a silent tax on every other domain.

---

## 16. Conformance checks for the input side

An implementation must pass all of these, for every domain, on every tick:

1. `len(obs) == 1280` and `dtype == float32`.
2. Every value is **finite** and within its declared transform's range. A NaN anywhere is a
   hard failure, not something to clamp.
3. A domain writes only inside the blocks its spec declares. Every other slot is **bit-zero**.
4. Block A slot 23 is exactly `1.0`. Slots 0 and 1 are mutually exclusive; slots 2 and 3 are
   mutually exclusive and **exactly one** of them is set. Slots 0 and 1 may both be zero
   (a non-spatial domain).
5. Angle pairs are on the unit circle: `sin² + cos² ≈ 1` for every emitted pair. `(0,0)` is
   only valid when the entire containing block is unfilled.
6. History at `t = 0` is the **first observation repeated**, not zeros.
7. `inv_dist` inputs are non-negative before transformation.
8. Two runs with the same `(master_seed, gen, domain, level, seed_idx)` produce
   **bit-identical** observation streams.
9. Block I is either **all bit-zero** or unit L2 norm, is **bit-identical on every tick of
   an episode**, and matches one row of the domain's shipped `objective_embeddedings.json`
   bit-for-bit.
10. Block A slots 25–26 (`tick_rate_slow` / `tick_rate_fast`) are exactly `0.0` whenever
    slot 24 (`tick_rate_present`) is `0`, and are never negative.
11. Block J is either **all bit-zero** or unit L2 norm, and is all bit-zero whenever block A
    slot 9 (`gravity_present`) is `0`. For a domain whose declared nominal-up axis is body
    `+Z`, slot 1104 equals `−uprightness` (slot 62) on every tick.
12. Slot 10 (`gravity_magnitude`) never exceeds `0.905` — `tanh(1.5)`, the declared **1.5 g
    dataset ceiling** (§5) — in any shipped training domain. The transform itself is valid
    above that; a larger value marks an observation as deliberately out-of-dataset (a
    deployment on a heavier world), never an adapter accident.
