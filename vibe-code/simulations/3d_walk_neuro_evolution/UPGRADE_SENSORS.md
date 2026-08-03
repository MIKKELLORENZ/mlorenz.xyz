# Sensor upgrade: foot-referenced terrain perception

Implementation brief. Replaces the head LiDAR and the pelvis-forward terrain
probes with foot-referenced height sampling, so that stair and slope information
arrives in the coordinate frame the control answer lives in.

Read this whole file before editing anything. Section 8 lists what must NOT be
touched; section 7 is the only thing that decides whether this worked.

---

## 1. Why

The walker learns rolling terrain (7-9 waypoints, 24-30 m) and cannot learn
stairs or mixed terrain (0-1 waypoints, 0.4-1.8 m, every single run, no
overlap). The failure is not training time. It is that stairs are **not
observable** in a usable frame:

- `C_TERRAIN` is four probes at `PROBE_D = [0.35, 0.70, 1.05, 1.40]` m ahead of
  the **pelvis**, along the heading (`walker.js` ~line 914). The swing foot
  travels ±0.4 m longitudinally and ±0.15 m laterally relative to the pelvis and
  does not travel along the heading. These probes answer a question no foot is
  asking.
- The LiDAR (`C_LIDAR` 64 rays + `C_LIDSEC` 16 sectors) encodes **proximity
  along a ray** (`1 - dist/range`). Recovering "how high is the ground there"
  requires composing the ray *direction* — which is not an input, it is implicit
  in which weight slot the value lands in — with the distance. That is a
  nonlinear reconstruction spread over 80 channels, and a GA will not find it.
- `world.terrain.raycast` casts against the terrain and nothing else. There are
  no walls or objects. So the LiDAR and a height map see **the same surface**;
  the LiDAR just delivers it in a worse frame.

Consequence: two states with identical sensor readings require different actions
depending on where the tread edge sits relative to the swing foot. The task is
not hard to learn, it is **ambiguous**. Generations do not fix an unobservable.

### The budget constraint that shapes every decision below

`NET_SIZES = [NIN, 48, 32, NOUT]`. Hidden layer 1 is 48 wide, so **every input
costs 48 weights**, and the input layer is ~23.5k of the net's ~25k parameters.

Under gradient descent, feeding 1024 raw map cells is free — backprop builds the
representation. Under selection it is fatal: 1024 cells = 49k new weights, twice
the whole current net, and mutation would spend two-thirds of its variance on
pixels. So this design **foveates**: fine resolution under the feet where the
answer is, coarse resolution at range where only route shape matters.

Net effect: `NIN` drops from 489 to ~333 while the stair information goes from
absent to present.

---

## 2. Channel changes

All edits to the channel table are in `walker.js`. The `put(n, lagSet)` sequence
that builds `LAGS` and the `const C_* = ...` offset chain **must be edited in the
same order** — every offset after an insertion point shifts, and they are
already derived from `NJ` rather than literal, so keep that property.

Lag ladders already defined: `L0 = [0]`, `L_FAST = [0,1,2,4]`,
`L_MID = [0,2,4]`, `L_LONG = [0,2,8]`, `L_EVENT = [0,2,4,8]`,
`L_MOMENTUM = [0,1,2,3,4,6,8,10,15,20,30]`.

### 2.1 REMOVE — LiDAR (−80 channels, −80 inputs)

Delete `C_LIDAR` (64, `L0`) and `C_LIDSEC` (16, `L_MOMENTUM`), the `_lidar()`
sweep, `LIDAR_*` constants, the `LIDAR_ON` env gate, and the `LIDAR_CHANNELS`
guard. Remove the LiDAR exports from `module.exports`.

Also remove the LiDAR beam/hit-dot rendering from `render.js` and its UI toggle
from `index.html` / `main.js`. Leave `terrain.raycast()` itself in place — it is
generic terrain code and cheap to keep.

### 2.2 REMOVE — the old pelvis-forward probes (−4 channels, −4 inputs)

`C_TERRAIN` (4, `L0`) is superseded by 2.5. See 2.5 for why its learned weights
can still be carried across.

### 2.3 ADD — foot ground clearance (+2 channels, +6 inputs)

Two channels, one per foot, on `L_MID` (the same ladder `C_FOOTPOS` uses).

For each foot: the height of the foot's sole point above the terrain **directly
beneath it**:

```
solePoint = mb.worldPoint(M.footBody[s], 0, -M.seg.ankleH, 0)   // already computed for C_FOOTPOS
clearance = solePoint.y - world.terrain.height(solePoint.x, solePoint.z)
value     = clamp(clearance / 0.30, -0.5, 1.5)
```

On flat ground this is redundant — reconstructible from `C_FOOTPOS` +
`C_HEIGHT`. **On stairs that reconstruction is wrong**, because the terrain under
the foot differs from the terrain under the pelvis. So it carries new information
exactly where we are failing and nowhere else. With `L_MID` it also yields
clearance *rate*, which is the toe-scuff predictor.

### 2.4 ADD — foot attitude relative to the local surface (+4 channels, +12 inputs)

Two channels per foot (pitch, roll), on `L_MID`.

Foot orientation in world is technically recoverable from ankle + knee + hip
angles composed through the kinematic chain with the pelvis gravity vector. Five
joints and a lot of trigonometry — a GA will not discover that composition.

Feed it **relative to the terrain surface under the foot, not to gravity**. On a
20° slope the sole should be flat to the slope; a gravity-referenced angle tells
the brain it is doing the wrong thing.

```
n     = terrain surface normal under the foot   (central difference of terrain.height,
                                                 step 0.05 m — see 6.3)
solar = foot body's local -Y axis in world      (sole normal)
pitch = signed angle between sole normal and n, about the heading-frame lateral axis
roll  = signed angle between sole normal and n, about the heading-frame forward axis
value = clamp(angle / 0.6, -1.5, 1.5)           // 0.6 rad ≈ 34°
```

### 2.5 ADD — foveal height patches, one per foot (+50 channels, +50 inputs)

The core of the upgrade. Two 5×5 grids on `L0`, one centred near each foot, in
the **gravity-levelled heading frame** (the same frame `heading()` defines — see
`walker.js` ~line 803).

```
PATCH_N       = 5       // 5×5 per foot
PATCH_SPACING = 0.09    // m  → 0.36 m span ≈ one 0.34 m stair tread
PATCH_FWD     = 0.12    // m  forward offset of patch centre from the foot's
                        //    ground projection; span runs −0.06 → +0.30 m
```

`PATCH_SPACING × PATCH_N = 0.36 m` is deliberately ≈ one tread, so whenever the
foot is on a stair the riser edge is somewhere inside the patch. `PATCH_FWD`
biases it toward where the foot is going rather than where it has been.

Sample with `world.terrain.height(x, z)` at each cell centre.

Three encoding rules, each of which the design fails without:

**(a) One shared datum, not per-patch.** Reference every cell — both patches and
the coarse fan in 2.6 — to the height of the terrain under the **lower** foot:

```
datum = min(terrain.height(under left foot), terrain.height(under right foot))
value = clamp((cellHeight - datum) / 0.5, -1.0, 1.0)
```

If each patch were self-referenced, the brain could not tell that one foot is a
step above the other — which is the entire state of being mid-stair. Using the
lower foot (rather than the stance foot) keeps the datum defined and continuous
when both feet are airborne, and avoids a discontinuity at every foot swap.

**(b) Height in metres, never normalised brightness.** A 0–1 image auto-scales to
whatever is in view, so a 0.17 m riser reads as a different number depending on
what else is nearby. Dividing by a *fixed* 0.5 m means a riser is always the same
number.

**(c) Point-sample. Never blur, never average.** Bilinear downsampling turns a
0.17 m riser into a ramp and destroys the one discontinuity this whole exercise
exists to capture. If any pooling is ever added, use min-pool (worst case
underfoot), matching the reasoning already in the LiDAR sector code
(`walker.js` ~line 853: "averaging would wash a stair riser into its tread").

### 2.6 ADD — coarse forward fan (+20 channels, +20 inputs)

Replaces `C_TERRAIN`. Heading frame, `L0`, same datum as 2.5:

```
longitudinal: PROBE_D = [0.35, 0.70, 1.05, 1.40]   // unchanged
lateral:      [-0.50, -0.25, 0.0, +0.25, +0.50]
```

Order the channels **lateral-major within each distance**, with lateral offset
0.0 third in each group. That makes the centre column exactly the old four
probes — a strict superset — so the graft in section 4 can map the old
`C_TERRAIN` weights onto the new centre column and keep what they learned,
rather than starting all 20 at zero.

Its job is route shape ("the ground rises ahead and to the left"), not stairs.
Do not increase its resolution to try to make it do stairs; that is what 2.5 is
for.

### 2.7 Budget

| | channels | inputs |
|---|---|---|
| current, LiDAR on | | **489** |
| − LiDAR | −80 | −240 |
| − old terrain probes | −4 | −4 |
| + foot clearance (`L_MID`) | +2 | +6 |
| + foot attitude (`L_MID`) | +4 | +12 |
| + foveal patches ×2 (`L0`) | +50 | +50 |
| + coarse fan (`L0`) | +20 | +20 |
| **new total** | | **~333** |

Layer-1 weights: 23,472 → ~15,984. A **smaller** network with the stair
information present. Verify `NIN` after the edit and put the real number in the
commit message.

---

## 3. Staging — do not bundle these

This project has repeatedly produced unattributable results by changing several
things at once. Each stage gets its own run and its own held-out exam.

| Stage | Change | `NIN` | Question it answers |
|---|---|---|---|
| **0** | LiDAR removed only | 249 | Re-establish the baseline. Compare to the known 1.42 wp / 4.80 m incumbent. |
| **1** | + 2.3, 2.4, 2.5 | ~313 | **The stair bet.** Does per-surface stair score move off zero? |
| **2** | + 2.6 (replaces `C_TERRAIN`) | ~333 | Does route lookahead add anything on top? |
| **3** | Fitness change (section 5) | ~333 | Does heading alignment help, and does it stay un-exploited? |

Stage 1 is the one that matters. If it does nothing, do not proceed to 2 and 3 —
come back and reconsider the hypothesis instead.

Each stage: graft the previous stage's best brain (section 4), resume, run to at
least 400 generations or a 100-generation plateau, then exam.

---

## 4. Carrying the champion across the input-layer change

`graft_seed.js` maps input weights by **(channel, lag)**, never by index. This is
what makes an input-layer change survivable: retained channels keep their learned
weights, new channels start at **exactly zero** so a newborn is behaviourally
identical to its parent, removed channels are dropped.

Requirements:

1. Give every channel a stable string id in the map (e.g. `"footClear.L"`,
   `"patch.L.r2c3"`, `"fan.d1.lat0"`), so the mapping does not silently depend on
   ordering.
2. New channels: weights **zero**, not small-random. Non-zero means the graft is
   not identity and the comparison is contaminated.
3. Map old `C_TERRAIN[k]` → new `fan.d{k}.lat0` (section 2.6).
4. `graft_seed.js` must build the new net with the source brain's activation:
   `new Net(NET_SIZES, null, oldNet.act === "mixed" ? "relu" : oldNet.act)` plus
   the per-neuron slope copy. It has silently rebuilt nets as tanh before.
5. `bake_brain.js` must carry `act` and `slopes` into the trimmed output. It has
   dropped them before, which would bake a ReLU champion as a tanh brain.

### The graft identity test — mandatory, has already caught one real bug

Removing the LiDAR genuinely changes the output of a brain that used it, so a
naive before/after comparison cannot be an identity check. Isolate the two
effects:

1. Take the source champion. Zero its LiDAR input weights **in place**. Run the
   held-out exam. Record the score. *(This is the information-loss step.)*
2. Graft that same brain onto the new layout. Run the held-out exam again.
3. **The two scores must be bit-identical.** Any difference is a mapping bug, not
   a modelling result.

`graft_seed.js` already refuses to write when its own identity check fails —
do not weaken or bypass that check.

---

## 5. Fitness: heading alignment (stage 3 only)

Reward the pelvis pointing along the direction of travel. Two reasons, and the
second is the bigger one:

1. It suppresses crab-walking.
2. **`heading()` is the frame every terrain sensor above is built in.** A robot
   travelling at 40° to its pelvis is looking sideways at all of them. Alignment
   makes the inputs mean what the weights assume they mean.

Implement as a **multiplier on positive progress, never an additive bonus**:

```
if (progressDelta > 0 && speed > 0.15) {
    theta = angle between pelvis forward and horizontal CoM velocity
    progressDelta *= 0.6 + 0.4 * cos(theta)     // 0.2× … 1.0×
}
```

Three things this shape is protecting against:

- **Additive would be a statue exploit.** A standing walker facing the right way
  would collect it forever without moving — the same failure class as the
  delivery-sim statue. As a multiplier on progress it is self-gating: no
  progress, no bonus.
- **Only positive progress.** Multiplying *negative* progress by a small factor
  would reward facing backwards while retreating.
- **Speed gate.** Below ~0.15 m/s the velocity direction is numerical noise and
  the multiplier would thrash.

Do not use waypoint bearing as the target direction — waypoint approach is
already rewarded, and doing it here would double-count and penalise legitimate
turning.

---

## 6. Implementation notes

**6.1 Env gates for A/B.** Follow the `LIDAR_ON` pattern
(`process.env.WALK3D_LIDAR !== "0"`) — give the new blocks their own gates
(`WALK3D_PATCH`, `WALK3D_FAN`) so a stage can be toggled without an edit. Keep
the `LAGS` table and the `C_*` chain consistent under every combination; that
coupling is what `LIDAR_CHANNELS` was guarding.

**6.2 Determinism.** `--seed` reproducibility must survive. Two runs with the
same seed must produce identical generation-1 fitness vectors. A module-level
Box-Muller spare in `gaussRand` broke this once; the spare now lives on the rng
function. Any new RNG use follows that pattern.

**6.3 Terrain normals.** Central difference on `terrain.height` with a 0.05 m
step. Do not analytically differentiate the noise function — the heightfield is
composed and the render mesh has already disagreed with the raycast once.

**6.4 Sampling correctness test.** Assert that every patch and fan sample point,
transformed to world coordinates, returns exactly `terrain.height()` at those
coordinates — 0 mm error, not "close". The equivalent check on the LiDAR raycast
is what proved the raycast was exact and the *render mesh* was at fault.

**6.5 Render the samples.** Draw the patch and fan sample points as dots on the
terrain in `render.js`, behind a UI toggle, reusing the existing grid-drape lift
(`LIFT = 0.012`) and the hit-dot nudge (`NUDGE = 0.03`) so they sit visibly on
the surface. We have already shipped one sensor whose true geometry disagreed
with what was drawn; being able to *look* at where the walker is sampling is
worth the hour.

**6.6 Worker transport.** `train.js` posts `{weights, acts, slopes, sizes, ...}`
to workers. `NET_SIZES` changes with `NIN` — confirm the new size reaches the
workers and that a resumed brain is not silently reshaped.

**6.7 Cost.** The patches and fan are 70 `terrain.height()` calls per control
tick versus 64 raycasts at 25 Hz. Height lookups are far cheaper than raycasts,
so this should be a net speedup. Measure `s/gen` before and after — but derive
the *instantaneous* value as `i*avg[i] - (i-1)*avg[i-1]`, since the trainer
prints a cumulative mean.

---

## 7. Verdict criteria — the only thing that counts

The **held-out exam** decides, nothing else. 12 fixed missions
`WALK = [900, 907, 913, 921, 934, 947, 955, 962, 969, 976, 983, 990]`,
`groundFrac: 0`, scored on **counted behaviours** (waypoints reached, metres
walked), never on ledger fitness. That is why a reward change (stage 3) is still
comparable — the exam is reward-invariant by construction.

- Incumbent to beat: **1.42 waypoints / 4.80 m**.
- The real target, and the point of the whole upgrade: **stairs and mixed
  terrain off zero.** Report the exam **split by surface**. A rise in the
  aggregate driven entirely by rolling terrain is not a success — rolling is 37%
  of the bank but 88.8% of all fitness, and it will mask everything.
- Keep `--surface-norm 1`. Stairs are invisible to selection without it (measured
  5.5× reweighting).
- **Best-of-N is systematically optimistic.** It has contradicted the exam four
  times in this project. Never report a fleet best as a result; the champion must
  be duel-validated against the incumbent on the exam.

---

## 8. Do not touch

Out of scope. Changing any of these makes the result unattributable:

- GA operators — elites, row-wise crossover, rank-weighted parents, immigrant
  tapering, champion grace, paired re-measurement.
- Activation demes and the per-neuron slope genes. Population stays pure ReLU.
- The stratified mission bank, difficulty bands, surface rotation, yaw
  permutation.
- The reward tier structure (beyond the single stage-3 multiplier in section 5).
- `--surface-norm`, `--stage-lock 4`, the work-queue dispatcher (`--chunk 1`).
- Hidden layer widths. Widening layer 1 from 48 is worth considering *because*
  `NIN` drops — but as a separate weight-preserving stage afterwards, never
  alongside a sensor change.

---

## 9. Explicitly not solved by this

**Getting up when fallen.** Two independent gaps, neither addressed here:

- The brain sees **two contact channels, both feet** (`C_CONTACT`). A fallen
  humanoid cannot tell whether it is on its back, its side, or face-down, or
  which surfaces are load-bearing — it is blind in exactly the regime it must act
  in. Fixing that means whole-body contact sensing.
- The arms are a **single shoulder-pitch DOF each** (`CPG_GROUPS`, "armSwing").
  That is a pendulum, not a limb that can push against the ground.
- A population selected on walking distance essentially never *samples* the prone
  state, so even with perfect inputs there is nothing for selection to act on.
  This needs backward chaining from near-standing poses.

Treat get-up as a separate project. Do not expect it to fall out of better
terrain sensing, and do not let it expand the scope of this brief.
