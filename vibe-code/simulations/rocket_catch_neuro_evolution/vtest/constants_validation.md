# Validation report: physical constants for a 6-DOF Super Heavy descent-and-catch simulator

Date of review: 2026-08-15. Provenance classes used throughout:
**[S]** = SpaceX-stated (post, webcast, flight recap, with date) · **[T]** = derived from webcast telemetry / SpaceX-published flight timelines · **[E]** = enthusiast/engineering estimate (photogrammetry, rocket-equation closure, literature analogy).

## Master block-conflation warning (read first)

**Every booster catch to date (Flights 5, 7, 8; Oct 2024 – Mar 2025) was a Block 1/2 booster: 71.0 m, FOUR grid fins, Raptor 2 (230 tf), hot-stage ring jettisoned.** The vehicle you are modeling (3 fins, Raptor 3, 72.3 m, integrated ring) is **Block 3**, which has flown twice (Flights 12–13, May/Jul 2026), **has never been caught**, and both times failed its water-landing burn (Flight 12: ~1 of 13 engines lit, impact at ~1,450 km/h; Flight 13: only 5 of 13 per Space.com, 8 of 13 per the webcast engine graphic — sources conflict, both agree <13). First Block 3 catch attempt is expected on Flight 14 (NET late Aug 2026). Consequence: **validate your dynamics against Block 1/2 catch telemetry, but your geometry/propulsion against Block 3 data — you need two config files, not one.**

---

## A. Engines and mass

### 1. Raptor 3 thrust and Isp — user values: 2.75 MN, Isp 330 s
**Verdict: thrust CONFIRM (with caveats); Isp 330 s is CORRECT — do not "fix" it to 350.**

| Quantity | Value | Provenance | Block |
|---|---|---|---|
| Raptor 3 SL-variant rated thrust | 280 tf = 2.75 MN | [S] SpaceX X post, 2024-08-03 | Raptor 3 (flies on Block 3 only, Flights 12+) |
| Raptor 3 stated Isp | 350 s | [S] same post — **almost certainly the VACUUM Isp of the sea-level nozzle** (SpaceX listed Raptor 2 as "347 s" in the same format; Raptor 2's true SL Isp is 327 s) | — |
| Raptor 3 sea-level Isp (what a landing burn sees) | **~327–334 s** | [E] scaled from Raptor 2's 327/347 SL/vac split at similar expansion ratio | — |
| Alternative flight rating | 250 tf SL / 275 tf vac | [E/T] Wikipedia (2026) lists these; conflicts with the 280 tf design figure — early flight units may be derated | Block 3 |
| Raptor 2 (the engine on every caught booster) | 230 tf SL, Isp 327 s SL / 347 s vac, mass 1,630 kg | [S] 2024-08-03 comparison post | Blocks 1–2, Flights ≤11 |
| Raptor 3 mass | 1,525 kg (1,720 kg incl. vehicle-side commodities) | [S] 2024-08-03 | Block 3 |

Consensus change in last 18 months: yes — before Aug 2024 the community used ~269 tf guesses; the official 280 tf/350 s post settled it, and the 250/275 tf "as-flown" figures appeared after Block 3 started flying in 2026.

**Action:** keep Isp = 330 s but label it "sea level"; run thrust as 2.6–2.75 MN with a per-engine derate parameter. If you ever validate against Flight 5/7/8 catches, swap in Raptor 2 numbers (2.26 MN / 327 s) or your braking envelope will be ~20% optimistic.

### 2. Minimum stable throttle — user value: 40%
**Verdict: CONFIRM 40%. Reject 20–25%.**
- 40–100% is the consistently documented Raptor throttle range [S/E, stable since ~2021; earlier Musk statements said ~50%].
- 20–25% claims are not supported for any flown Raptor; they trace to aspirational deep-throttle remarks and to confusion with *effective* thrust reduction via engine count (33→13→3 IS the deep throttle).
- **Controller-critical consequence:** at Musk's stated catch mass ≈250 t [S, video, ~2024: "It'll weigh about 250 tons"], 3 engines at 40% give TWR ≈ 1.13 (Raptor 2) to ≈1.3 (Raptor 3). **The booster cannot hover.** The terminal phase is a controlled hoverslam that must null velocity *at* the catch plane; a policy that learns to hover-and-trim is learning a vehicle that doesn't exist. If your 2-engine rung was added to make hovering possible, that is the wrong fix (see item 6).

### 3. Ignition delay and throttle lag — user values: 450 ms, 160 ms lag
**Verdict: NOT PUBLIC. Values plausible but on the fast edge.**
- No SpaceX figures exist. Webcast frame analysis shows visible mainstage plume within ~1 s of scheduled ignition times [T].
- Full-flow staged combustion spin-up from spin-prime to mainstage realistically ~0.5–2.0 s command-to-90% [E, engine-class analogy].
- Suggested: ignition-to-90% = 0.8 ± 0.4 s (randomize per engine per episode); throttle first-order τ = 150–300 ms; gimbal slew 15–30 °/s [all E].
- This is second-order compared to the 13-engine thrust quantization and per-engine ignition reliability (item 6), which you should randomize first.

### 4. Super Heavy dry mass — user value: 230 t (spread 200–275 t)
**Verdict: NOT PUBLIC. Keep 230 t, but anchor to the better observable: catch mass ≈ 250 t.**
- No SpaceX dry-mass figure has ever been published for any block. 200–275 t is the honest enthusiast spread [E].
- The strongest anchor is Musk's statement that the caught booster weighs "about 250 tons" [S, ~2024] — that is dry + residuals + unusables at arm contact, and it constrains the *sum* your braking model actually feels.
- Block 3 deltas vs Block 2: +1.3 m stretch, integrated (non-jettisoned) hot-stage ring (+~5–10 t high on the vehicle), 3 larger fins at ~same total fin mass [S, 2025-08]. Net: Block 3 dry plausibly 220–260 t [E].
- **Action:** keep dry = 230 t as a free parameter but add a hard consistency check: mass-at-catch must land in 245–275 t. That constrains dry+residual jointly, which is what sets your braking envelope.

### 5. Propellant at landing-burn ignition; masses 320 t → 270 t
**Verdict: CONFIRM as self-consistent [E/derived]. Not public.**
Rocket-equation closure: killing ~330–360 m/s of fall plus ~20–28 s of gravity loss ⇒ Δv ≈ 550–620 m/s; at ve ≈ 3,210–3,270 m/s that is 16–17% of ignition mass ≈ 50–55 t of propellant. 320 t ignition → 265–270 t catch, matching the 250 t [S] anchor within its slop. Your episode budget of 58–72 t usable at ignition is the right order (55 t nominal burn + reserve). One refinement: some of that propellant sits in dedicated landing/header tanks (see item 7), so "usable" ≠ "all residuals."

### 6. Landing-burn engine ladder — user model: 0 / 2 / 3 / 13
**Verdict: CORRECT — the 2-engine rung is not real. The flown ladder is 13 → 3 → 0.**
SpaceX's own flight recaps [S]:
- The landing burn commands **the same inner 13 engines used for boostback** (3 center always-running + 10 mid-ring; these 13 are the gimbaling set; the outer 20 are fixed and never used for landing).
- After the initial 13-engine braking phase, **all but the 3 center engines shut down**, and those 3 run to catch, then shut down together at/just after arm contact. No documented 5-engine or 2-engine rung, and no asymmetric final shutdown, on any Block 1/2 catch (Flights 5, 7, 8).
- Timing anchors [S/T, SpaceX-published timelines]: Flight 7 — landing burn start T+6:31 (13/13 lit), catch T+6:55 ⇒ 24 s. Flight 8 — start T+6:34 (12/13 lit — demonstrated one-out tolerance in phase 1), catch T+7:02 ⇒ 28 s. Flight 3 — burn attempt with only 7 engines commanded (6 disabled after boostback failures), 2 reached mainstage, vehicle lost at 462 m.
- Block 3 still plans 13 for phase 1 [T, Flights 12–13 webcasts]; both V3 attempts under-lit (1/13; then 5 or 8 of 13 depending on source) and failed — so **per-engine relight reliability is the dominant real-world failure mode**. Model each of the 13 with an ignition-success Bernoulli (~0.95–0.98 per engine, tunable) and give the controller the actual lit count.
- Fine trimming in the last meters is done by the 3 center engines via **differential throttle + gimbal**, not by shutting down to 2. Delete the 2-engine rung, or keep it only as an explicitly non-flight-accurate controller freedom.
- Also correcting a premise from your item 17: **Super Heavy performs no entry burn.** Boostback ends ~T+3:40–4:06, then the vehicle is unpowered until the landing burn. All deceleration from ~Mach 4 to ~Mach 1 is aerodynamic.

### 7. Center of mass — user: 21.0 m dry from engine plane; residuals at 7.0 m
**Verdict: NOT PUBLIC. Dry CG plausible; residual CG needs a two-lump model.**
- Dry CG: engines + thrust structure (~60–70 t at 0–3 m) pull down; fins/pins/ring hardware (~15–25 t at 63–72 m) pull up; empty tank walls distribute. Closure gives ~20–27 m for a 71–72 m vehicle; 21.0 m is inside the band [E].
- Residuals: subtlety you're missing — Super Heavy carries **dedicated landing propellant tank(s) integrated with the thrust puck** (documented on B5 and B12–B15-era boosters; B15 had at least nine added tanks to increase landing capacity) [E/community-documented]. LOX residuals also pool at the bottom of the lower (LOX) tank. But any CH₄ drawn from the *main* fuel tank comes from that tank's bottom, which sits at roughly mid-vehicle (~38–42 m), via the transfer tube.
- Recommended model: lump 1 (LOX + header, ~75–85% of landing prop) at 4–8 m; lump 2 (main-tank CH₄ fraction, 15–25%) at ~38–42 m; and **let CG travel during the burn** as lumps drain — the gimbal moment arm (engines at ~0 m) changes ~10–15% through the burn, which your attitude loop will feel.

---

## B. Grid fins and aerodynamics

### 8. Fin count, azimuths, size — user: 3 fins at 90/180/270 (none tower-side), 7.5 × 3.75 m, fixed, ±45°, 40 °/s
**Verdict: layout CONFIRM for Block 3; size uncertain; deflection/slew NOT PUBLIC.**
- **Three fins, T-arrangement, on port / starboard / anti-tower faces, none on the tower-facing side: SpaceX-stated (Aug 2025), flown on B19/B20 (May–Jul 2026).** Your 90/180/270-with-0°-toward-tower model is exactly right. Blocks 1–2 had four fins (all catches so far).
- The fins sit **lower on the forward tank** than the old set (shaft, actuator and structure inside the main tank — reduces hot-staging heating) and are **structural catch/lift members with a new catch point**, deliberately aligned with the tower arms [S, Aug 2025]. So on Block 3 the catch loads enter at the 90°/270° fin stations — consistent with your mixing matrix and item 15.
- Size: SpaceX said only "50% larger, same weight, higher strength" [S]. The 7.5 × 3.75 m figure is an enthusiast derivation assuming +50% *linear* on an estimated legacy ~5 × 2.5 m fin; if "50%" meant *area*, linear scale is ×1.22 (~6.1 × 3.05 m). Treat panel dimensions as 7.5 × 3.75 m with −20% possible [E]; better, calibrate total fin authority as one lumped coefficient (item 9).
- Fixed deployed: CONFIRM — all Super Heavy fins have always been non-folding [S/T].
- Max deflection ±45°: NOT PUBLIC. Falcon 9's titanium fins operate in roughly a ±20° class; ±45° is generous. Suggest ±20–35° usable with a sensitivity sweep [E]. Slew 40 °/s: NOT PUBLIC; electric drive makes 20–60 °/s plausible [E].
- Consensus change in last 18 months: **yes, major** — the 4→3 fin redesign was announced Aug 2025 and first flew May 2026. Any pre-2025 source describes the wrong fin set for Block 3.

### 9. Fin center-of-pressure radius — user's internal conflict: 5.7 m vs 6.675 m
**Verdict: NOT PUBLIC. Your two numbers come from assuming different fin dimensions are radial.**
Hull radius 4.5 m; a lattice panel's normal force centroid sits near mid-panel. If the radial extent is ~3.75 m → CP ≈ 4.5 + 1.9 ≈ 6.4 m; if ~2.4–2.5 m → ≈ 5.7 m. Hull carryover/interference pulls the effective CP slightly inboard. Recommended: **6.2 ± 0.5 m** for Block 3 [E]. More useful: don't fix CP radius and C_N independently — the only observable is the moment, so define one calibrated parameter K_fin = C_N·q·S·r and identify it against attitude-response telemetry (or leave it as a domain-randomized gain, ±25%). That dissolves your 17% disagreement into an explicit uncertainty you already train over.

### 10. Transonic authority loss (~50% around Mach 1)
**Verdict: CONFIRM as defensible [literature].**
Grid fins suffer lattice-cell flow choking through the transonic band (~M 0.8–1.3): normal-force effectiveness drops on the order of 30–60% with a drag rise and hinge-moment shifts, recovering supersonic and subsonic. This is documented in grid-fin wind-tunnel/CFD literature (Falcon 9 program experience; NASA/AIAA grid-fin studies, e.g. Kless & Aftosmis-type CFD) [E/literature]. A 50% dip with smooth blending in M 0.8–1.2 is a fair model. Note the operational sting: the booster goes **transonic ~5 s before landing-burn ignition** (Flight 7: transonic T+6:26, ignition T+6:31 [S/T]) — the authority trough coincides with final pre-burn targeting. Your controller should have to live through that.

### 11. Roll damping of a falling cylinder ≈ 0 except fins
**Verdict: CONFIRM — defensible.**
Axial-flow roll damping of a smooth cylinder is skin-friction only, i.e. negligible; real protuberances (raceways, catch hardware, ring) add a tiny amount. Fins provide essentially all roll torque *and* roll damping (C_lp from lattice normal force at radius r as roll rate creates local incidence). Optionally add ~1–3% of fin authority as parasitic damping for numerical hygiene [E]. One 3-fin subtlety: with fins at 90/180/270, pure roll torque comes primarily from antisymmetric deflection of the 90/270 pair; the 180 fin's deflection couples mostly into pitch with a secondary roll component — your mixing matrix should be full 3×3, not diagonal.

### 12. Cross-flow Cd vs Mach; strip-theory adequacy at M 2–3 high-AoA
**Verdict: adequate with a crossflow-Mach correction [literature].**
Use the Allen & Perkins (1951) viscous crossflow analogy with Jorgensen's high-AoA slender-body method (NASA, 1977) — the standard engineering approach. Crossflow drag coefficient of a circular cylinder vs crossflow Mach M_n = M·sin α: ~0.6–0.8 at supercritical Re incompressible; rising through ~1.2–1.8 across M_n ≈ 0.5–1.2 (transonic crossflow drag rise); settling ~1.3–1.4 for M_n > 2 [literature/Hoerner]. At M 2–3 and α ≤ 20°, M_n ≤ 1.0 — you are in the steep part of that curve, so tabulate Cd_c(M_n) rather than using a constant. Expect ±20–30% absolute error vs CFD; fine for control development, and the errors are exactly what your domain randomization should cover. Strip theory misses tip relief, fin-body interference, and base effects — acceptable at this fidelity.

### 13. Structural q and q·α limits — user: 140 kPa and 260 kPa·rad, self-invented
**Verdict: NOT PUBLIC — and both are far above anything the vehicle sees or survived. CORRECT DOWNWARD.**
- Experienced q: on a quasi-terminal ballistic descent, q ≈ mg/(Cd·A) ≈ 320,000·9.81/(1.0·63.6) ≈ **49 kPa plateau**, with a supersonic overshoot peak of ~55–65 kPa in the 10–25 km band [derived from telemetry closure]. Your 140 kPa never binds; as a *constraint* it is useless.
- The one real structural datapoint: **Flight 9 (May 2025) deliberately descended at up to ~17° AoA as a limits experiment, and the booster broke during the landing burn — SpaceX attributed it to higher-than-predicted loads on the fuel transfer tube from the increased AoA** [S, flight recap]. At q ≈ 50–60 kPa and α up to 0.30 rad, that flight reached q·α ≈ 15–18 kPa·rad and exceeded a Block 2 component's capability.
- Recommended sim constraints: q_max ≈ 60–70 kPa; **q·α_max ≈ 10–15 kPa·rad for Block 2-equivalent structure**; Block 3 was explicitly redesigned to "descend at higher angles of attack" [S, Aug 2025], implying an uprated but unquantified limit — maybe 20–25 kPa·rad [E]. Your 260 kPa·rad is ~15–20× too permissive and will let an RL policy learn AoA-gliding maneuvers the real vehicle cannot survive.

---

## C. Tower and catch geometry

### 14. Rail height, arm reach, gap — user: rails 120 m, arms 32 m, open gap 25 m
**Verdict: arm reach ≈ right; rail height too high; gap NOT PUBLIC.**
- Tower: ~143–146 m total (Pad A, Starbase) [E/reporting]. Pad 2 (where Block 3 flies) has a new tower with **shorter chopsticks adapted to V3 geometry** [reported 2026] — dimensions unpublished.
- Arms: ~36 m tip-to-tower each [E, photogrammetry-based reporting, Oct 2021]; arm box-structure ~5.5 m tall [reporting]. Your 32 m is close; use 33–36 m.
- Catch-plane (rail) height: NOT PUBLIC. Footage-based estimate: the arms sit roughly 55–65% up the tower at catch ⇒ **~75–95 m AGL**, with the hanging booster's base ~15–25 m above ground structures [E]. Your 120 m is likely 30–40 m too high; it stretches the terminal timeline by ~2–4 s, which matters to a hoverslam. Best fix: photogrammetry from IFT-5/7/8 footage using the 9.0 m hull as the scale bar.
- Open rail gap: NOT PUBLIC; 15–25 m at the tips is visually plausible [E]. Note the arms are active participants: they close on command (Flight 5's catch was manually authorized by the flight director [reporting]), the rails can extend and have shock absorption, and "aligner" hardware fine-positions the hanging vehicle [E/community]. A sim that treats the arms as static geometry is conservative; a stretch goal is arms with a closing-speed and compliance model.

### 15. Catch hardpoints — user: 61.0 m above engine plane, 4.6 m radius
**Verdict: plausible, NOT PUBLIC.**
Two pins/load points near the top, just below the fin region, protruding just beyond the 4.5 m hull ⇒ radius 4.6–5.0 m: CONFIRM your 4.6 m [E, photogrammetry]. Height: booster 71.0 m (Block 1/2) / 72.3 m (Block 3), fin band at ~63–69 m ⇒ pins ~60–66 m; your 61.0 m is in-band [E]. On Block 3 the load path is through the port/starboard fin structures themselves ("new catch point... aligned with the tower catch arms" [S, Aug 2025]) — so pin azimuth = 90°/270° = your fin stations, and the roll-orientation constraint (no fin toward tower, pins toward arms) is a hard terminal attitude requirement your policy must satisfy.

### 16. Capture tolerances
**Verdict: NONE published; here are defensible engineering gates [all E].**
- Cross-arm lateral (perpendicular to rails): ±0.3–0.5 m (pin must land on rail width).
- Along-arm lateral: ±1.5–3 m (rail length + aligners give slack in this axis).
- Vertical velocity at engagement: < 1–2 m/s (rails have shock absorbers/dampers [reporting]); target 0.5 m/s.
- Horizontal velocity: < 0.5–1 m/s. Tilt: < 1.5–3° from vertical; roll: pins within a few degrees of the rail plane.
- Supporting anecdotes: Musk stated catch mass ~250 t arriving "at more than half the speed of sound" earlier in the approach [S, video]; Flight 5's catch damaged tower arm sensors enough that Flight 6's catch was waved off and the booster diverted to the Gulf [reporting, Nov 2024–Jan 2025] — margins are real and tight. Treat the gate values as the reward's terminal box and do sensitivity sweeps ±50%.

---

## D. Flight telemetry (Flights 5–13 reconstruction)

### 17–18. Descent profile and your training envelope
First, the premise fix: **there is no entry burn** — the profile is boostback burn → unpowered aero descent → landing burn.

Reconstructed profile, Block 1/2 catch flights (5, 7, 8) [S/T]:

| Event | Time | Altitude | Velocity | Notes |
|---|---|---|---|---|
| MECO / hot-stage | T+2:32–2:45 | 60–67 km | 5,000–5,600 km/h | 3 center engines never shut down |
| Boostback burn | T+2:44 → 3:38 (F7); → 4:06 (F8) | 60–100 km | reverses ~1.2–1.5 km/s horizontal | 13 engines commanded (F7: 12/13; F8: 11/13) |
| Apogee | ~T+4:00–4:30 | ~95–110 km | ~0 vertical | gas thrusters for attitude |
| Peak descent speed | ~T+5:30 | 30–45 km | ~Mach 3.5–4.2 (1,150–1,350 m/s) | pure aero deceleration begins to bite |
| Transonic | T+6:26 (F7) | ~3.5–4.5 km [E] | Mach 1 (~330 m/s) | fin authority trough here |
| Landing burn ignition | T+6:31 (F7), 6:34 (F8) | **~1.5–2.8 km** [E, closure] | **~300–340 m/s (1,100–1,250 km/h)** | 13 engines |
| Step-down to 3 engines | ~4–8 s into burn | ~0.5–1 km | ~40–80 m/s | phase 1 pulls ~3–5 g |
| Catch | T+6:55 (F7), 7:02 (F8) | rails ~75–95 m AGL [E] | < ~1–2 m/s vertical | 24–28 s total burn |
| Final 100 m descent rate | — | 100 → 0 m | ~5–10 m/s decaying to <1–2 m/s | [E, video-derived] |

Quasi-terminal velocity curve (the descent manifold your episodes should sit on), for m = 320 t, Cd = 1.0–1.1, A = 63.6 m²: v_term(h) = √(2mg/(ρ(h)·Cd·A)) ⇒ ~330–350 m/s at 3.8 km, ~355–375 at 5 km, ~395–420 at 7 km; above ~8 km the vehicle is still 5–15% above local terminal (decelerating from the supersonic overshoot).

**Assessment of your setup:**
- Your episode starts (3.8–7 km, 280–440 m/s, 58–72 t): the altitude range and prop budget are fine; the **velocity band is too wide on the low side.** 280 m/s at any of those altitudes is off-manifold — the unpowered vehicle cannot be that slow there; only a (nonexistent) earlier burn would produce it. Fix: sample v = v_term(h) × U(0.95, 1.15), plus lateral offset, wind and AoA dispersions.
- Your aero trim (item 18): 289 m/s at 3.5 km for 320 t implies Cd_eff ≈ 1.35–1.4 — about 15% draggier than the telemetry-consistent 1.0–1.1. Lower Cd (or shrink your effective area) so free-fall trim lands at ~330–350 m/s at 3.5 km; otherwise every episode starts with a systematically easier braking problem than the real one.
- Also note the real ignition point is **lower** than your episode floor (~1.5–2.8 km vs your 3.8 km) — good: your episodes span coast + burn decision, which is the right problem. Just make sure the policy is *allowed* to coast to ~2 km before lighting.

---

## E. Prior art

### 19. RL / neuroevolution for 6-DOF powered descent — what actually works

**Core papers (strongest first):**

1. **Gaudet, Linares, Furfaro — "Deep RL for Six Degree-of-Freedom Planetary Powered Descent and Landing"** (arXiv 1810.08719, Oct 2018; journal version Advances in Space Research 65(7):1723–1741, 2020). PPO; policy maps estimated state directly to per-engine thrust (integrated G&C, 6-DOF, Mars). Observation: position, velocity, attitude error, angular rates — **memoryless MLP sufficed with full state observation**. Reward: shaping via tracking a target velocity field (ZEM/ZEV / DR-DV-style) plus attitude/rate penalties, plus a terminal soft-landing bonus; their documented key trick is **different discount factors for shaping vs terminal rewards** (terminal discounted less), which they report significantly improved optimization. Pinpoint-class accuracy (<5–10 m) across dispersions in sim; training on the order of tens of millions of environment steps (read the paper for exact counts — treat any secondhand number as approximate).
2. **Gaudet, Linares, Furfaro — "Adaptive guidance and integrated navigation with reinforcement meta-learning"** (Acta Astronautica 169:180–190, 2020) and the related meta-RL series (asteroid hovering, terminal adaptive guidance). This is the definitive answer to your recurrence question: **recurrence (GRU) is needed when dynamics parameters are unobserved** — mass, Isp, actuator degradation, engine failure — because the hidden state implicitly identifies them; memoryless policies suffice when the state (and parameters) are observable. They demonstrate adaptation to engine failures, which maps directly onto your 13-engine Bernoulli-relight problem.
3. **Sánchez-Sánchez & Izzo — "Real-time optimal control via deep neural networks: study on landing problems"** (J. Guidance, Control, and Dynamics, 2018). Not RL — supervised G&CNets imitating indirect optimal solutions — but the strongest evidence that optimal landing feedback is representable by small nets; a very good warm-start/imitation source before RL fine-tuning.
4. **Scorsoglio, Furfaro et al.** — image-based lunar landing with RL (adds a perception front-end; useful if you ever go vision-in-the-loop).
5. **VTVL-specific RL** (mostly 2021–2025, several Chinese groups): guidance laws for reusable-rocket powered landing from randomized initial states, PPO/SAC/DDPG. Results are real but **most are 3-DOF or attitude-simplified**; success rates of 95–99% in-dispersion are typical claims. Treat "6-DOF end-to-end RL lands a booster" as sim-proven only.
6. **The convex/optimal-control baseline you must build against:** Açıkmeşe & Ploen 2007 (lossless convexification); Blackmore, Açıkmeşe et al. 2010 (G-FOLD; flight-tested on Masten Xombie); **Szmuk, Reynolds & Açıkmeşe** — successive convexification for real-time 6-DOF powered descent **with state-triggered constraints** (JGCD ~2020); **Kamath et al., "Real-Time Sequential Conic Optimization for Multi-Phase Rocket Landing Guidance"** (IFAC World Congress 2023) — multi-phase is exactly your engine-count-ladder structure; Malyuta et al., "Convex optimization for trajectory generation" tutorial (IEEE Control Systems Magazine, 2022). A 2025 preprint, "Ignition Point Reachability for Aerodynamically-Controlled Reusable Launch Vehicles" (arXiv 2503.11862), addresses precisely your question of which (h, v) states the grid-fin phase can deliver to landing-burn ignition — use it to define your episode-start manifold rigorously.

**Known-to-work vs folklore:**
- Works (documented): potential-based shaping toward a reference velocity field + separately-discounted terminal bonus; glideslope/corridor as *soft* penalties (hard constraints strangle exploration); domain randomization over mass/Isp/actuation from the start; recurrence only when parameters are hidden; convex solutions as expert references, curricula seeds, or online safety filters.
- Folklore (plausible, weakly documented): precise curriculum schedules ("start at the pad, expand shells outward") — widely used informally, rarely ablated in the landing literature; specific reward weights transferring between vehicles; claims that end-to-end RL beats SCvx+tracking on fuel — no fair published comparison at 6-DOF booster scale.
- Gap your problem adds beyond all published work: **discrete engine-count ladder + per-engine ignition stochasticity + a no-hover TWR floor + an asymmetric 3-effector fin set.** Nobody has published that combination; expect to be off the map, and lean on the meta-RL failure-adaptation result as the closest prior.

### 20. The annular/slot capture problem
No published work solves your exact "between-the-arms, near-miss-is-worse-than-far-miss" landing geometry (nothing in the open literature models the chopstick catch as of this review). The transferable prior art:
- **State-triggered constraints (Szmuk/Reynolds/Açıkmeşe):** the published tool designed for exactly this shape of requirement — "once below altitude h_gate, lateral error must be inside a shrinking bound" — keeping the problem solvable by successive convexification without a globally non-convex annulus.
- **Spacecraft docking corridors / keep-out zones:** the standard, decades-old answer is **align first, then close** — acquire an approach-corridor axis at standoff, then descend inside a contracting cone, with abort rays defined everywhere. This is also what SpaceX visibly flies: the booster aims **offset (offshore) for the whole descent and translates to the tower only in the final seconds at low speed**, so the "annulus" is never entered with meaningful velocity. Your sim should treat the offset-aim-plus-late-divert as the nominal strategy, not a quirk.
- **Quadrotor narrow-gap traversal** (Falanga et al. 2017; Loianno et al.): two-phase structure — reach an alignment manifold (position and velocity constraints jointly), then execute a committed feasible maneuver — with explicit go/no-go at the manifold. Directly analogous to a catch-commit gate.
- For RL specifically: encode the annulus as a **barrier penalty active only inside a gate region**, expose a commit flag in the observation, and consider a hierarchical split — Policy A delivers the vehicle to a tight "gate box" beside/above the arms (position, velocity, attitude, lit-engine-count all boxed), Policy B (or a classical tracker) executes the capture. "Align first, then descend" is the standard, and everything in the flown evidence says it is also SpaceX's solution.

---

## F. Corrections ranked by impact on the control problem

1. **Delete the 2-engine rung; enforce the 13→3 ladder and the no-hover TWR floor (items 2, 6).** TWR_min ≈ 1.1–1.35 on 3 engines at 40% turns the endgame into a timed hoverslam; a policy trained with a hover option learns a different, easier vehicle. This changes the terminal strategy class itself.
2. **q·α limit from 260 → ~10–15 kPa·rad (Block 2) / ~20–25 (Block 3, uprated, [E]) and q_max from 140 → 60–70 kPa (item 13).** Flight 9 physically broke near 17° AoA. Your current limits permit descent-corridor maneuvers the airframe cannot survive — the constraint set defines what the policy is allowed to learn.
3. **Put episode starts on the descent manifold: v = v_term(h)×U(0.95–1.15), and drop Cd_eff from ~1.35 to 1.0–1.1 (items 17–18).** Right now some episodes begin 15–20% slow, systematically easing the braking problem; sim-to-"real" transfer dies on exactly this kind of bias.
4. **Rail height 120 → ~75–95 m; keep pins at ~61 m/4.6 m (items 14–15).** Shortens the terminal timeline by seconds and moves the zero-zero point; second-order for the mid-descent policy, first-order for the capture gate.
5. **Per-engine ignition stochasticity on the 13 (item 6).** Both Block 3 failures to date were under-lit landing burns. A robust policy must read the lit count and re-plan; this is the highest-value robustness axis, above winds.
6. **Isp bookkeeping (item 1): keep 330 s but label it sea-level; use Raptor 2 numbers (2.26 MN/327 s) whenever validating against the actual catch flights.** A silent "fix" to 350 s shifts the prop budget ~6%; a silent Raptor 3 assumption vs Flight 5/7/8 data shifts braking ~20%.
7. **Fin moment: lump CP radius × C_N into one calibrated gain, 6.2±0.5 m if you must keep them separate (item 9), and mix all three fins for roll (item 11).**
8. **Two-lump residual-propellant CG with burn-time CG travel (item 7).**
9. **Catch-mass anchor: dry + residual must total 245–275 t at contact (items 4–5).**
10. **Ignition/spool transients: widen to ~0.8±0.4 s; keep the throttle lag (item 3).** Real, but dominated by everything above.

## G. Source ledger (dated)

- SpaceX X post, 2024-08-03: Raptor 1/2/3 thrust, Isp, mass table.
- SpaceX X post + statements, Aug 2025: Block 3 grid fins — 3 fins (port/starboard/anti-tower), 50% larger, same weight, lower mounting, shafts in-tank, new catch point aligned to arms, higher-AoA descent.
- SpaceX flight recaps (Flights 3, 4, 8, 9, 2024–2025): boostback/landing-burn engine counts, 13→3 ladder, Flight 9 17° AoA experiment and transfer-tube failure attribution, Flight 3 loss at 462 m.
- SpaceX-published timelines via Wikipedia flight pages (Flights 7, 8): transonic/ignition/catch timestamps.
- Musk video statement (~2024): caught booster "about 250 tons," approaching at "more than half the speed of sound."
- Webcast telemetry, Flights 5–13 (2024-10 through 2026-07): staging/apogee/speed bands; Flight 12 (2026-05-22) 1-of-13 landing-burn ignition, 1,450 km/h impact; Flight 13 (2026-07-24) 5-of-13 (Space.com) or 8-of-13 (webcast graphic) lit.
- Photogrammetry-era reporting (Teslarati, Oct 2021): arms ~36 m, tower ~135–146 m class; community documentation of booster landing header tanks (B5, B15).
- Literature: Allen & Perkins (NACA, 1951); Jorgensen (NASA, 1977); Açıkmeşe & Ploen (2007); Blackmore et al. (2010); Szmuk/Reynolds/Açıkmeşe (JGCD ~2020, state-triggered constraints); Gaudet/Linares/Furfaro (arXiv 1810.08719; ASR 2020; Acta Astronautica 2020); Sánchez-Sánchez & Izzo (JGCD 2018); Kamath et al. (IFAC 2023); Malyuta et al. (IEEE CSM 2022); arXiv 2503.11862 (2025).

All [E] values are reconstructions chosen for internal consistency; none should be represented downstream as SpaceX data.