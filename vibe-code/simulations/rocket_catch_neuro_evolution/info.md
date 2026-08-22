# Starship landing simulation specification (Super Heavy booster + Ship)

Purpose: a physics-grade description of SpaceX's Starship system (V3 / Block 3 configuration, mid-2026) sufficient for another LLM or engineer to build a faithful descent-and-landing simulation of both stages — the Super Heavy first stage (tower "chopstick" catch) and the Ship upper stage (belly-flop, flip, and propulsive landing/catch).

## 0. Data confidence conventions

Every number is tagged:

- **[official]** — published by SpaceX (website, X posts, webcasts, users' guide).
- **[telemetry]** — read from live webcast telemetry of Flights 4–13 (approximate, varies flight to flight).
- **[estimate]** — not published; community/engineering estimate or derived value. Treat as a tunable default.

SpaceX does not publish dry masses, aero coefficients, or control gains. Where a value is [estimate], I provide a default that is *internally consistent* with the rocket equation, observed telemetry, and engine specs, so the simulation closes even if individual numbers are imperfect.

Sign/frame conventions recommended: right-handed body frame, +X out the nose, +Z out the heat-shield (windward) belly for the Ship; flat-Earth ENU local frame is adequate for the landing phase (last ~100 km); use full spherical/rotating Earth only if simulating the whole trajectory.

---

## 1. Environment model

| Quantity | Value |
|---|---|
| g0 | 9.80665 m/s² (use g(h) = g0·(R/(R+h))² if desired, R = 6371 km) |
| Atmosphere | US Standard Atmosphere 1976 recommended. Quick approximation: ρ(h) = 1.225·e^(−h/8500 m) kg/m³ |
| Speed of sound | ~340 m/s at sea level, ~295 m/s at 11–20 km (use standard atmosphere table) |
| Winds | Real flights tolerate significant wind; add configurable wind profile (0–20 m/s) for realism |

Propellant properties (both stages, both engines) [official]:

| Property | Value |
|---|---|
| Fuel / oxidizer | Liquid methane (CH₄) / liquid oxygen (LOX), both sub-chilled |
| Mixture ratio (O/F) | ~3.6 by mass |
| Density | LOX ~1,220 kg/m³ sub-chilled; LCH₄ ~440 kg/m³ sub-chilled |

---

## 2. Propulsion: Raptor engine family

Full-flow staged-combustion methalox. All variants share propellants and basic architecture.

| Parameter | Raptor 2 (SL) | Raptor 3 (SL) — current V3 vehicles | Raptor Vacuum (RVac) |
|---|---|---|---|
| Sea-level thrust | 230 tf = 2.26 MN [official] | 280 tf = 2.75 MN design [official]; flight units reported ~250–280 tf [estimate] | n/a (do not fire deep in atmosphere in nominal ops) |
| Vacuum thrust | ~258 tf = 2.53 MN [official] | ~300 tf class [estimate] | ~258–280 tf = 2.5–2.75 MN [official/estimate] |
| Isp sea level | 327 s [official] | ~327–334 s [estimate] | — |
| Isp vacuum | 347–350 s [official] | 350 s [official] | ~372–380 s (380 s is the stated design target) [official] |
| Chamber pressure | ~300 bar | ~330–350 bar [official] | ~300+ bar |
| Throttle range | ~40–100% [official/estimate] | ~40–100% | ~40–100% |
| Gimbal | ±~15° (gimbaled engines only) [estimate] | ±~15° | none (fixed) |
| Engine mass | 1,630 kg [official] | 1,525 kg (1,720 kg incl. vehicle-side hardware) [official] | ~1,800–2,000 kg [estimate] |
| Mass flow at 100% | ~650 kg/s [official] | ~800 kg/s [derived: F/(Isp·g0)] | ~700–750 kg/s [derived] |

Ignition/shutdown transients: treat spool-up to full thrust as ~0.5–1.0 s ramp, shutdown ~0.3–0.5 s [estimate]. Engines can be restarted multiple times in flight (demonstrated on both stages).

---

## 3. Super Heavy booster (Block 3)

### 3.1 Geometry and mass

| Parameter | Value |
|---|---|
| Length | 72.3 m (Block 1/2 was 71.0 m) [official] |
| Diameter | 9.0 m [official] |
| Axial reference area | 63.6 m² (πr²) |
| Structure | 30X-series stainless steel rings, ~4 mm wall class [estimate] |
| Engines | 33× Raptor 3. Layout: 3 center + 10 middle ring (these 13 gimbal) + 20 outer ring (fixed) [official] |
| Liftoff thrust (33 engines) | >18,000,000 lbf ≈ 80–83 MN reported on V3 flights [official]; theoretical max 33×280 tf = 90.6 MN |
| Dry mass | NOT published. Default: **230 t** [estimate] (range 200–275 t; includes ~57 t of engines) |
| Propellant capacity | ~3,400 t (V1/V2 official); V3 slightly higher, unpublished — default 3,500 t [estimate] |
| Liftoff TWR (full stack ~5,000+ t) | ~1.45–1.55 [telemetry/derived] |
| Pitch/yaw moment of inertia (near-empty) | ~(1/12)·m·L² ≈ 1.0×10⁸ kg·m² at 250 t [estimate — slender-rod approximation; refine with CG model] |
| CG near-empty | ~20–30% of length from aft end (engines dominate) [estimate] |

### 3.2 Grid fins (V3) — the booster's only aero control surfaces

| Parameter | Value |
|---|---|
| Count / arrangement | **3 fins**, T-configuration at 90°/90°/180° azimuth — port, starboard, and the face away from the tower; no fin on the tower-facing side [official] |
| Size | ~7.5 m tall × ~3.75 m wide each (50% larger than the old 4-fin set) [official] |
| Mass | ~3 t each [official-ish, from SpaceX statements] |
| Mounting | Lower on the forward tank section than previous versions; shaft/actuator inside the tank; **fixed in deployed position** (they never fold, unlike Falcon 9) [official] |
| Actuation | Electric, rotation about the shaft axis (fin "pitch"); assume slew rate 20–60 °/s, deflection ±~60° usable [estimate] |
| Dual role | Aerodynamic control AND structural: the V3 fins/catch points are what the tower arms engage for lift and catch [official] |
| Aero function | The booster falls engines-first; fins at the top act like fletching on an arrow (aerodynamic center above CG → passively stable-ish). Differential fin rotation produces pitch, yaw, and roll torques; collective bias trims angle of attack. V3 fins allow descending at **higher angles of attack** to glide and extend cross/downrange authority [official statement, magnitude unpublished — allow trim AoA up to ~10–20° in sim] |

Secondary attitude control (exoatmospheric): cold/warm gas thrusters using tank ullage gas for the flip after staging and coast attitude [official concept, thrust levels unpublished — assume tens of kN class, [estimate]].

### 3.3 Booster aerodynamic model (engines-first descent)

- Reference area: 63.6 m² axial.
- Axial drag coefficient Cd(engines-first, fins deployed): default **1.0**, tunable 0.7–1.3 [estimate]. Validation: with mass ~320 t this yields ~340–360 m/s (≈1,200–1,300 km/h) quasi-equilibrium speed at 3–4 km altitude, matching webcast telemetry at landing-burn ignition.
- Normal force / lift: model as C_N ≈ 2·sin(α)cos(α)·(body term) plus grid-fin contribution; for a simple sim, a lift-to-drag ratio of 0.1–0.3 at 10–20° AoA is adequate [estimate].
- Peak descent speed (no burn between boostback and landing burn — **Super Heavy performs NO reentry burn**, unlike Falcon 9): ~1,150–1,350 m/s (Mach ~4) around 35–45 km altitude [telemetry].
- Peak aerodynamic deceleration: ~3–5 g in the 15–30 km band [estimate from telemetry].

### 3.4 Booster mass/Δv budget (self-consistent defaults, [estimate])

| Event | Mass | Notes |
|---|---|---|
| At stage separation | ~480 t | dry 230 t + ~250 t prop reserved for return |
| Boostback burn | Δv ≈ 1.2–1.5 km/s | ~150–160 t propellant |
| Start of landing burn | ~320 t | after ballistic coast + aero descent (no prop used) |
| Landing burn | Δv ≈ 550–650 m/s incl. gravity losses | ~50–55 t propellant |
| At catch | ~265–275 t | includes residuals/reserve |

### 3.5 Booster return timeline (typical of Flights 5–13) [telemetry]

| T+ (min:sec) | Event | Altitude | Speed | Engines |
|---|---|---|---|---|
| 0:00 | Liftoff | 0 | 0 | 33 @ ~100% |
| ~1:00 | Max q | ~11–12 km | ~Mach 1.5–1.8 | 33 |
| 2:30–2:45 | MECO → **hot staging** | 60–67 km | 5,000–5,600 km/h | 30 shut down; 3 center stay lit while Ship ignites its 6 through the vented interstage ring |
| 2:50–3:45 | Flip (~180°) + **boostback burn** | 60–100 km | reverses horizontal velocity | ~12–13 inner engines, partially throttled, ~50–60 s |
| ~4:00–4:30 | Apogee, begin descent | ~95–110 km | ~0 vertical | 0 (gas thrusters for attitude) |
| 4:30–6:25 | Aero descent, grid fins active | 60 → 4 km | peaks Mach ~4, decays to ~Mach 1 | 0 |
| 6:25–6:40 | **Landing burn phase 1** | ~3–4 km | 1,100–1,300 km/h at ignition | **13 engines** ignite for ~8–10 s of hard braking (~3–5 g). Note: nominal plan is 13; on Flight 13 only 8 of them lit, causing a hard water landing — model per-engine ignition reliability if you want realism |
| 6:40–6:55 | **Landing burn phase 2** + divert | 1 km → catch height | ~100 m/s → ~0 | Throttle down to the **3 center gimbaling engines**; vehicle translates laterally from its offshore/offset aim point to the tower ONLY after health checks pass |
| 6:55–7:05 | **Chopstick catch** | ~60–80 m AGL on the ~146 m tower [estimate] | vertical rate < ~1–2 m/s at arm closure | 3 engines, deep throttle, then shutdown once hanging |

### 3.6 Catch mechanics and suggested success criteria

The tower arms ("chopsticks") are two horizontal beams that swing open/closed and can translate vertically on the tower. The booster descends between the open arms; the arms close; the booster settles until its catch points (the reinforced hardware associated with the V3 grid-fin structure, one per side) rest on load rails atop each arm. There are no legs and no touchdown — final velocity attenuation is partly offloaded to the tower's arm compliance/dampers [official concept].

Published tolerances do not exist; suggested sim success gate [estimate]:

- Lateral position error perpendicular to arms: < ±0.5 m; along-arm: < ±2 m (rails give margin in that axis)
- Vertical descent rate at engagement: < 2 m/s (target ~0.5–1 m/s)
- Attitude: tilt < 2–3° from vertical; yaw such that catch points face the rails (remember: no fin on the tower side, so vehicle roll orientation matters)
- Abort logic: booster targets a point offshore/offset from the tower for the entire descent and only diverts to the tower in the final ~20 s if propulsion/health criteria pass; otherwise it soft-ditches in the sea. Implement as a commit gate.

---

## 4. Ship (Starship upper stage, V3)

### 4.1 Geometry and mass

| Parameter | Value |
|---|---|
| Length | ~52.1 m [official] |
| Diameter | 9.0 m; ogive nosecone |
| Broadside (belly) planform area | ~470 m² body + ~60–100 m² of flaps ⇒ use ~500–550 m² total reference [estimate] |
| Engines | 3× Raptor sea-level (center, gimbal ±15°) + 3× RVac (outer, fixed) [official] |
| Dry mass | NOT published. Default **150 t** [estimate] (range 130–170 t for V2/V3-class ships) |
| Propellant capacity | ~1,200 t (V1/V2 official); V3 higher, unpublished |
| Header tanks | Small landing-propellant tanks kept full through entry: LOX header in the nose tip (also serves as ballast keeping CG forward), CH₄ header near the common dome. Combined usable landing prop: default **~20–30 t** [estimate] |
| Landing mass (at flip) | default **~165–170 t** [estimate] = dry + header prop + residuals |
| Pitch moment of inertia at landing mass | ~(1/12)·m·L² ≈ 3.8×10⁷ kg·m² [estimate] |
| Heat shield | ~18,000 black hexagonal ceramic tiles on the windward side only, with an ablative backup layer beneath (tested on recent flights); leeward side bare steel [official] |
| RCS | Gaseous CH₄/O₂ thrusters for vacuum attitude control [official concept; thrust unpublished] |

### 4.2 Flaps — four drag paddles, not wings

| Parameter | Value |
|---|---|
| Forward flaps | 2, near the nose, smaller. Rough size ~4–5 m along body × ~2–2.5 m span each [estimate — never published]. V2/V3 moved them leeward (toward the bare-steel side) and slimmed them to cut reentry heating [official] |
| Aft flaps | 2, at the base, much larger: ~7–8 m along body × ~3.5–4 m span each [estimate] |
| Hinge geometry | Hinge lines run parallel to the vehicle's long axis, at the body tangent, offset leeward. Flaps rotate about these hinges, changing their projected area into the oncoming flow — from tucked (near-flush) to fully extended (near-perpendicular). Model deflection range ~10°–90° from the body surface [estimate] |
| Actuation | Electric motors on battery power; assume slew rate 10–30 °/s, high torque (each aft flap fights multi-hundred-kN aero loads) [estimate] |
| Control principle | **Differential drag, like a skydiver's limbs.** In belly-down flight the airflow hits the belly; each flap modulates drag on its quadrant: pitch = forward pair vs aft pair; roll = left pair vs right pair; yaw = diagonal mixing. There is essentially no conventional lift-based control; the flaps cannot fly the ship like a plane, only orient and steer the falling body |

### 4.3 Ship aerodynamic model

- Hypersonic entry (120 → ~40 km): belly-first at high angle of attack, roughly **60–70°** [estimate; exact schedule unpublished]. Modest lift: L/D ~0.3–0.6 [estimate], used for downrange/cross-range shaping. Ballistic coefficient m/(Cd·A) ≈ 300 kg/m² with defaults — this is why Starship decelerates high and relatively gently (~2–4 g peak).
- Peak heating: tile-face temperature ~1,400 °C, occurring roughly 60–70 km altitude at ~Mach 15–20 [official/telemetry].
- Transonic passage: ~20–30 km altitude [estimate] — much higher than a slender vehicle because of the huge drag area.
- Subsonic terminal descent: near-vertical fall, belly-down (effective AoA ~90°). Cd(broadside) default **1.1** (range 0.9–1.3) on ~500 m² [estimate]. Validation: terminal velocity ≈ √(2mg/(ρ·Cd·A)) ≈ **70–90 m/s (250–320 km/h) near sea level** at 165 t — matches observed descent rates before the flip.

### 4.4 The landing flip and burn (the core maneuver to get right)

Sequence, starting from stable belly-down fall at terminal velocity:

1. **T−20 to −15 s, altitude ~500–1,000 m** [telemetry]: command engine ignition. All **3 center sea-level Raptors** light in quick succession (~0.3 s stagger), fed exclusively from the header tanks (settled propellant is why headers exist — main tanks are near-empty and sloshing).
2. **Flip**: engines gimbal hard toward the belly side while the **aft flaps swing fully back** (removing aft drag) and forward flaps stay extended (keeping nose drag) — aero and thrust torques combine to pitch the vehicle ~90° from horizontal to vertical in **~3–5 s**, peak pitch rate ~25–40 °/s [telemetry/estimate]. During the flip the thrust vector also has to manage the translation the rotation induces.
3. **Downselect**: once vertical, shut down to **1–2 engines** (3 are lit for ignition redundancy and flip torque; observed flights typically finish on fewer). Thrust check: one Raptor at 40% ≈ 1.1 MN vs. ~1.65 MN vehicle weight ⇒ a single engine at ~60–75% throttle can hover the ship — deep throttle is essential and T/W with all 3 at full power would be ~5.
4. **Terminal descent**: classic zero-zero guidance — arrive at ~0 velocity at ~0 altitude. Vertical rate profile ~ 80 m/s at flip → ~10 m/s by 100 m → ~1–2 m/s at contact [telemetry-ish].
5. **Endgame, two variants**:
   - **Ocean soft landing (as flown through Flight 13):** hover briefly, splash vertically, tip over.
   - **Tower catch (first attempt expected Flight 14, late Aug 2026):** identical flight profile but the zero-zero point is between the tower's chopstick arms at ~60–80 m AGL; the ship hangs from catch hardpoints exactly like the booster. Use the same catch tolerances as §3.6. Note the ship's engines must avoid plume impingement on the tower during the final slide-in — approach with a small lateral offset, then translate.

Heritage note: the flip-and-land was first proven at low altitude by prototype SN15 (May 2021) after four predecessors (SN8–SN11) crashed learning it — the historical failure modes are useful for sim fault injection: low header-tank pressure → thrust shortfall (SN8), one engine failing to relight (SN9/SN10 hard landing), CH₄ leak/fire (SN11).

### 4.5 Ship return timeline (suborbital test profile, Flights 10–13; an orbital entry is energetically nearly identical) [telemetry]

| T+ | Event | Altitude | Speed |
|---|---|---|---|
| 8:40–9:20 | Ship engine cutoff (SECO) | ~140–150 km | ~26,500 km/h (~7.35 km/s) |
| ~9 – 46 min | Coast (apogee ~190–230 km); payload deploy, attitude via RCS | | |
| ~47:00 | **Entry interface**, belly-first, AoA ~60–70° | 120 km | ~7.3 km/s |
| ~50–57 | Peak heating, plasma sheath | 60–75 km | Mach 20 → 12 |
| ~57–62 | Max deceleration ~2–4 g; flaps fully active | 45 → 25 km | Mach 10 → 2 |
| ~62–64 | Transonic → subsonic; settle into flat belly-down fall | ~25 → 15 km | → ~Mach 0.5 |
| 64–65:45 | Terminal skydive, flaps trimming | 15 km → 1 km | ~90–70 m/s vertical |
| ~65:45 | **Ignition + flip** (3 engines, header tanks) | ~0.5–1 km | 70–90 m/s → vertical attitude |
| ~66:00–66:15 | Vertical burn, downselect to 1–2 engines, zero-zero | 0 | ~1 m/s at contact/catch |

---

## 5. Guidance & control laws to implement

- **Booster descent attitude**: rate-damped PID (or LQR) on pitch/yaw/roll using 3 grid fins as effectors; mixing matrix maps commanded torques to fin deflections (asymmetric 3-fin geometry — the 180° fin mostly does pitch; the 90° pair does yaw+roll).
- **Booster trajectory**: during aero descent, steer the instantaneous impact point via trim AoA (fin bias); target = offshore abort point with a stored divert vector to the tower.
- **Landing burn guidance**: a suicide-burn/ZEM-ZEV or convex (G-FOLD-style) solution with throttle floor 40%, 13-engine phase treated as fixed-duration brake, 3-engine phase closed-loop. Commit-to-tower gate at burn start + ~5 s.
- **Ship entry**: AoA/bank schedule tracked by flap differential-drag controller; gains must scale with dynamic pressure q (effectiveness ∝ q).
- **Ship flip**: feed-forward gimbal + flap retraction profile, closed-loop pitch-rate tracking; then position/velocity loop (PD on altitude/vertical speed, lateral translation via gimbal tilt) to the zero-zero point.
- Actuator/limit realism: gimbal ±15° at ~15–30 °/s, throttle 40–100% with ~0.3 s lag, per-engine ignition success probability (e.g., 0.97) if you want the observed failure modes.

## 6. Validation checkpoints (your sim should reproduce these)

1. Booster at hot-staging: ~63 km, ~5,300 km/h, T+ ~2:40.
2. Booster landing-burn ignition: ~1,200 km/h at ~3.5 km, T+ ~6:30; catch/zero at T+ ~7:00.
3. Booster never lights engines between boostback shutdown and landing burn (no entry burn).
4. Ship subsonic terminal velocity 70–90 m/s belly-down at low altitude.
5. Ship flip: 90° in ~3–5 s starting ≤1 km AGL, ~15–20 s total burn, ~10–15 t propellant.
6. Full ship timeline: entry interface T+ ~47 min → splashdown/catch T+ ~66 min.
7. Energy sanity: booster boostback Δv ~1.3 km/s; ship landing Δv ~0.25 km/s incl. gravity loss.

## 7. Known unknowns (state these as assumptions in the sim)

Dry masses of both stages; exact V3 propellant loads; flap and fin dimensional drawings, deflection limits, and slew rates; aero coefficient tables (SpaceX's CFD is proprietary); catch tolerances and arm damper characteristics; exact entry AoA schedule; RCS thrust levels. All defaults above are chosen to be mutually consistent and to reproduce webcast telemetry, but they are reconstructions, not SpaceX data.

Sources: SpaceX published engine/vehicle stats (Raptor specs, V3 grid-fin announcement, vehicle dimensions), live webcast telemetry from Flights 4–13 (2024–2026), and reporting on Flights 12–13 and the planned Flight 14 ship-catch attempt (as of Aug 15, 2026).