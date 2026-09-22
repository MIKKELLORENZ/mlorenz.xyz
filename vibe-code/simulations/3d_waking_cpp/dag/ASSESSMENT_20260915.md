# Assessment — seven-hour programme, 2026-09-14 21:05 → 2026-09-15 01:30 UTC (stopped early: experiments exhausted)

Target: the humanoid stands up by itself when fallen or starting on the ground.
**Not met.** Delivered: it stands up and keeps walking from a kneel (79 % held on
the harness, 17/20 in the browser) and from crouch starts (70–100 %), and it
walks 5.9 waypoints per episode. It does not get up from seated, side, curled,
supine, prone, quadruped or any real fall (0 of about 130 falls).

## What was tried tonight

All rise-only GA, 192 brains × 96 episodes; "held" = no fall within 3 s of
recovering, out of 82 starts on the C++ harness.

| bet | setup | result | why it stopped |
|---|---|---|---|
| A blend curriculum kneel→quadruped | lerp rungs 0.10…1.0, mixed with kneel | rungs 0.10, 0.13 passed (60–66); 0.16 stalled at 28 after 40 min | 16 rungs at 40–60 min each; the pitch blend tips the pelvis before the hands are placed |
| B heap GA | start = the walker's own fall (`fall:1.0`) | 0/82 for 70 gens (after fixing a leak that fed it crouch starts) | no gradient from a kneel specialist; falls end prone or on a side |
| C jitter curriculum | `jit:kneel:amp` | amp 0.1 passed (51) | widens the basin locally; heaps are far away |
| D/E seat ramp, small steps | `seat:0.25` mixed with kneel | rose 51, held 0 for 61 gens | small mutations refine, never create |
| E2 same from the distilled net | mix kneel/seat/crouch | kneel 14→41, seat 0–2 | same |
| E3 LARGE steps (0.06 / 0.05) | mean ranking | **seat:0.25 held 76/82 in 30 gens**, kneel 0 | created a skill, sold the old one |
| E4 large steps, min ranking | | kneel 0, seat 0 | the min rewards doing nothing everywhere |
| E5 large steps, gated ranking (keep kneel ≥ 1.0) | | kneel 60–74 kept, seat 0 for 66 gens | inside the gate there is no path to seat |
| reach | mix kneel/supine/prone | 0/82 both, 71 gens | as expected |
| walking-net routing | crouch, horse → walking net | crouch 42/60, horse 11/20 (vs 0 and 5) | shipped |

Also fixed tonight, each of which had been inflating a number: the recovery
flag counted as a rise (55 % → 8 % real); the trial's held bonus paid for
rise-then-fall (upright 5/10 s → 7/10 s); a `fall:` start inheriting the
stage's crouch deal; `stood` never credited after a rise-net rise (no arrivals).

## Where it is stuck and why

1. Mutation search on this net refines an existing contact sequence and does
   not create a new one at step sizes the net tolerates; at larger steps it
   creates one and destroys the other (E3), and no ranking over a pose mix
   avoids one of the two failure modes (E3/E4/E5).
2. Curricula over blended poses have no physical path: each 3 % rung costs
   40–60 min and the rungs are not on the way a body actually gets up.
3. The open-loop search formulation (3 s, 6 knots, one finisher, dense
   target) is 0/6 for every pose but kneel.
4. Real falls end far from the only basin the rise net has.

## What to do next

- Showcase-only fix: per-pose specialist rise nets routed by start pose (the
  walker knows its start pose). E3 shows a seat:0.25 specialist in 30 minutes;
  seated, sidesit, hugknees are the candidates. This does not help real falls.
- General skill: a gradient method on the physics (PPO-style, get-up reward,
  early termination) or reference motions. Scalar-per-episode evolution has now
  been measured signal-limited on this problem in every formulation tried.
- Keep `held`, per-episode traces (`--verbose 1`), `probe_fall`, `test_pool.js`.

Files on the node (/data/walk3d_cpp): dag5/PLAN_7H.md (timeline), dag5/*.log,
dag/risenet_*.json, training_*/. Shipped: 3d_walk_neuro_evolution/default_brain.js
= walk_g95 (AHS4ZC) + risenet_kneel_k5g140 (YENX4Z).

## Extension 01:35-02:40 UTC
Specialist GAs per pool pose (seated, hugknees, sidesit, side, curled; large steps, 25 cores each): 0/82 held after 45 min; their trial score rose 0.27 -> 0.40 m (the sit-up plateau). Specialist routing is built (browser riseNets, bake --rise-pose, harness --student-rise-pose) and verified with kneel through the map (17/20); nothing to route yet.
Kneel on varied terrain: 14/90 held vs 80/90 flat. A small-step refinement on varied terrain (--terrain varied, 75 cores) stayed at 12-13/82 for 71 generations. Open question: the rise-only branch's --rise-terrain flags are overridden by --terrain a few lines later in train.cpp, and whether the trial's terrain draw matches the harness's is untested.
All GAs stopped 02:40 UTC. Browser brain unchanged: walk_g95 (AHS4ZC) + risenet_kneel_k5g140 (YENX4Z).
