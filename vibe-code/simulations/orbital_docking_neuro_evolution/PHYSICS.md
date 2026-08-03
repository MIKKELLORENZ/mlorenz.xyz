# PHYSICS.md — what is real here, and what is a fudge

The point of this file is to name every simplification, so that nobody has to
guess which numbers mean something. Where a value is real, it says so and where
it came from. Where it is invented, it says that too.

---

## The orbit

**Real.** Two-body gravity with the J2 oblateness term, integrated with RK4.

| quantity | value | note |
|---|---|---|
| μ | 3.986004418 × 10¹⁴ m³/s² | EGM-96 |
| R⊕ | 6 378 137 m | WGS-84 equatorial |
| J2 | 1.08262668 × 10⁻³ | |
| station orbit | a = 6 791 km, e ≈ 0.0002, i = 51.64° | the ISS's, near enough |
| period | 5 569 s (92.8 min) | |
| orbital speed | 7 663 m/s | |
| mean motion n | 1.128 × 10⁻³ rad/s | |

Higher zonal harmonics, lunisolar perturbations, solar radiation pressure and
atmospheric drag are **not** modelled. At 413 km drag is the significant omission
— a real ISS loses about 100 m of altitude a day — but it acts on both vehicles
almost identically and the relevant quantity here is the *difference*, which over
a two-hour rendezvous is centimetres. J2 is kept because its differential effect
is not small: two vehicles in slightly different planes have their nodes regress
at different rates, and that is exactly what makes the out-of-plane stage cost
propellant.

### Why the chaser is propagated relatively

The chaser's state is `(ρ, ρ̇)` — its offset from the station — integrated
directly, not differenced from two absolute states. At 6 791 km radius and metre
scale separations, subtracting two absolute positions throws away nine
significant digits, and two independently integrated 7.66 km/s arcs accumulate
uncorrelated truncation error that shows up as vehicles drifting apart at
millimetres per second with no physical cause.

The relative acceleration is evaluated in **Battin's form**:

```
q = ρ·(ρ + 2r_s) / |r_s|²
u = (1+q)^{3/2}
F = q(q² + 3q + 3) / (u(u+1))          ( = 1 − (1+q)^{−3/2} , without cancellation )
ρ̈ = −(μ/|r_s|³)(ρ − F·r_c) + Δa_J2 + a_thrust
```

so nothing large is ever subtracted from anything large. The differential J2 term
*is* a straight difference, which is safe: J2 acceleration is ~10⁻² m/s² and its
difference over 100 m is ~4 × 10⁻⁷ m/s², eleven orders above the double-precision
floor.

The station and the relative state are advanced by **one** RK4 call on a combined
12-element state. Stepping them separately, or at different step sizes, silently
breaks the integration order and produces a spurious relative drift that looks
exactly like a bug in the docking dynamics.

### Clohessy-Wiltshire

CW appears **only** in `pilot.js` (the scripted autopilot's guidance model) and in
the tests. The world never uses it. The gap between the linearised plan and the
nonlinear truth is real error the guidance has to correct for, which is the
situation on an actual vehicle.

The state transition is written for this file's LVLH convention — x along-track,
y cross-track, **z nadir** — not the textbook's radial-first, radial-*up*
convention. Flipping the radial axis flips the sign of every term coupling radial
to along-track motion. Getting that wrong produces a solver that is internally
consistent, returns finite plausible velocities, and plans trajectories that fly
the wrong way round the orbit; see the note in `orbit.js`.

---

## The vehicle

A Dragon-class capsule. Masses and thrusts are real-ish; the exact layout is
invented but self-consistent.

| quantity | value | real? |
|---|---|---|
| dry mass | 5 800 kg | representative |
| propellant | 40–240 kg by stage | invented per stage |
| inertia (principal) | 6 000 / 12 000 / 12 000 kg·m² | invented, plausible for the size |
| thruster | Draco-class, 400 N, Isp 300 s | **real** (SpaceX Draco) |
| +X group | 4 × 400 N = 1 600 N → 0.254 m/s² | invented grouping |
| −X group | 4 × 400 N × cos 25° = 1 450 N | canted to keep the plume off the target — a real constraint, this specific angle is invented |
| ±Y, ±Z | 2 × 400 N = 800 N | invented grouping |
| attitude | couples of 2 × 110 N at 1.8 m = 396 N·m | invented |
| slew authority | 0.066 rad/s² roll, 0.033 pitch/yaw | follows from the above |
| minimum impulse bit | 20 ms | **real order of magnitude** for hypergolic RCS |
| Δv budget | 243 m/s at full tank | Tsiolkovsky from the above |

**There is no attitude controller underneath the network.** It commands thruster
groups. If it wants to hold an attitude it has to fire one way and fire back.

**Thrust is tick-averaged.** Within a control tick the commanded on-time is
quantised to whole 20 ms pulses and the resulting impulse is applied as a
constant force over the tick. Because the physics step (≤ 250 ms) is much longer
than a pulse, this is exact for the trajectory and wrong only for the vibration,
which nothing here measures.

**There is no separate thruster deadband.** The minimum impulse bit is the only
floor, and it works out at about 4% of full authority in a 250 ms tick. An extra
hand-picked 8% threshold was in here at one point and put a hard floor of
`deadband / kp` = 6.5° under the achievable pointing error — half a capture
envelope, produced by a constant with no physical meaning.

**Propellant is billed per newton-second at Isp 300 s, including attitude
control.** Mass decreases as it burns. Attitude is not free, and on a two-hour
rendezvous a controller without a pointing deadband spends more propellant on
pointing than on the transfer.

**Rotation is torque-free when nothing is firing.** A vehicle that stops firing
keeps rotating. Euler's equations, RK4, quaternion renormalised each step;
angular momentum is conserved to 1 part in 10⁶ over a 1 000 s coast.

---

## The station

Geometry is a cartoon: five boxes (core, node, two solar wings, a radiator) with
a docking port on the nose of the core. Collision is sphere-vs-box. The port neck
is deliberately absent from the collision list — arriving at it is the goal, and
the capture test owns that contact.

The station holds **LVLH attitude** (body axes tracking local vertical / local
horizontal), optionally biased by a few degrees, or by up to 18° on the hardest
stage. A real station's torque-equilibrium attitude is not exactly LVLH.

### The capture envelope

Modelled on the NASA Docking System's soft-capture limits. All six must hold
simultaneously at the instant the probe crosses the port plane:

| limit | value |
|---|---|
| lateral offset | ≤ 0.12 m |
| lateral rate | ≤ 0.030 m/s |
| axial closing rate | 0.020 – 0.120 m/s |
| misalignment | ≤ 4° |
| roll error | ≤ 6° |
| relative angular rate | ≤ 0.30°/s |

The rate limit is on the **relative** angular velocity. A vehicle holding a fixed
attitude with respect to the station is rotating at the orbit rate — 0.065°/s —
in inertial space, and so is the station; grading the chaser's inertial rate
against a 0.30°/s limit spends a fifth of the budget on something that is not
relative motion, and penalises exactly the attitude a docking vehicle should be
holding.

---

## The sensors

Three layered sources, each gated by range, as on a real vehicle.

| source | range | what it gives | noise (1σ) |
|---|---|---|---|
| ephemeris | always | both absolute ECI state vectors | 30 m position |
| relative nav | always | differenced relative state, in ECI, **one tick stale** | max(0.5 m, 0.12% of range); velocity max(8 mm/s, 2.5e-5 · R) |
| radar | < 30 km | range and range rate only | 5 m + 0.1% |
| laser | < 250 m | five retroreflector returns as range/azimuth/elevation in the **body frame**, inside a 25° cone off the nose | 1 cm + 0.12% range, 0.05° angle |
| star tracker | always | body axes in ECI | 0.01° |

Multiply every figure by 4 on the Degraded stage.

**The relative vector is given already differenced, and that is a deliberate
concession.** Recovering a 1 m offset by subtracting two 7-digit numbers is a
floating-point problem, not a cognitive one, and requiring it would make the task
unlearnable for reasons that have nothing to do with rendezvous. A real
relative-GPS or ranging link outputs exactly this. Everything *else* is left for
the network: nothing is resolved into LVLH, the relative vector arrives in ECI,
the laser arrives in the body frame, and the rotation between what it sees and
what it can act on is a bilinear function it has to build out of hidden units.

**The laser gives five raw points, not a pose.** Four reflectors on a 0.6 m ring
plus one recessed 0.18 m at the centre — the ring gives the plane, the recessed
one breaks the front/back ambiguity and gives roll a sign. Turning that into a
relative position and attitude is the network's problem, and it is the actual job
of a docking LIDAR processor. It also loses lock in the last metre, because from
0.3 m behind the plane a reflector on a 0.6 m ring is 63° off axis — real ones do
this too.

**Temporal window, not recurrence.** Each channel is presented at several lags,
and the lags are in **seconds**, resolved against a time-stamped ring buffer —
never in ticks. The control rate changes with range and a coast advances twenty
seconds in one step, so a lag of "four samples ago" would mean 1 s during a
terminal approach and 80 s mid-coast.

---

## The clock

Three rates, because the problem spans four decades of time:

| | period | what runs |
|---|---|---|
| control tick | 0.25 s inside 300 m, 0.5 s inside 3 km, 1 s inside 20 km, 2 s beyond | fast head, thruster commands, one RK4 step |
| guidance tick | 4 s | slow head: velocity setpoint, pointing, coast request |
| coast | 1–20 s steps | no thrust, no attitude control, RK4 all the way |

A coast is granted when the network asks for it. During one, the step is capped
by range (never move a large fraction of the distance to the target in one step),
by rotation rate (never turn more than 0.05 rad per step, or the quaternion
integration stops being accurate and a slowly tumbling vehicle arrives pointing
somewhere the sim invented), and by the mission clock. **Sensors still sample and
every abort gate is still checked at every coast substep** — a coast is a
fast-forward, not a blindfold.

This is what makes a 150 km rendezvous cost about what a 40 m approach costs to
evaluate: episode cost is set by the number of manoeuvres, not the mission
duration.

---

## Known unrealities, all of them

- No atmospheric drag, no SRP, no lunisolar, no zonal harmonics past J2.
- No plume impingement on the target, no contamination constraints, no thermal or
  power limits, no comms blackouts, no crew.
- The docking mechanism is a pass/fail envelope, not a compliant mechanism with
  latches and springs. There is no soft-capture dynamics, no retraction, no
  hard-dock.
- Sensor noise is white and uncorrelated. Real relative-nav error is strongly
  time-correlated, which makes it *easier* to fly through than white noise of the
  same magnitude.
- Only the relative-nav channel is stale (by one control tick). The others are
  instantaneous. Real avionics delay everything.
- The station is rigid and its attitude is exactly held; no flex modes, no CMG
  desaturation, no reboosts.
- Thruster failures, stuck-on thrusters and degraded Isp are not modelled.
- Mass properties are constant apart from propellant mass; the inertia tensor and
  the centre of mass do not move as the tank drains.
- The Earth in the render is a texture, and the Sun direction is chosen for
  contrast, not from an ephemeris.

## What is validated, and how

`node test_headless.js` checks the integrator against closed-form orbital
mechanics rather than against remembered numbers, so the tests still mean
something after the constants are retuned:

- circular orbit radius and speed from the elements; radius recovered after one
  full period of RK4
- LVLH orthonormal, right-handed, z nadir, x along-track
- Battin differential gravity against the naive difference at 35 km, and against
  the analytic 2μδr/r³ radial tide
- CW state transition against the nonlinear integrator over 900 s from five
  independent initial states, to 2%
- the physical sign statement on its own: *a vessel 100 m below pulls ahead*
- the two-impulse solver inverts its own propagation to 10⁻⁶ m
- Tsiolkovsky mass flow, minimum-impulse quantisation, angular momentum
  conservation over 1 000 s
- each capture limit rejects on its own
- episode determinism under an interleaved unrelated random stream
- and, most load-bearing of all: **the scripted autopilot docks on every stage**,
  because if it does not, the advantage denominator is meaningless and no amount
  of evolution can be measured.
