# PHYSICS.md — what is modelled, what is approximated, what is absent

This is a pedagogical reconstruction of the *control problem* Degrave et al. tackled
on TCV (Nature 602, 2022). It is not a reproduction of their physics codes, their
controller, or their results, and it is not a plasma physics code. It is a fast,
wrong-in-readable-ways stand-in whose only job is to make one control problem feel
like the real one.

If you take a number out of this simulator and use it for anything, you will be
wrong. This file is a list of the specific ways.

---

## 1. What is actually modelled

### Geometry and electromagnetics — mostly honest

* **Perfect axisymmetry.** Every conductor is a circle on the machine axis; every
  field is poloidal. The (R, Z) cross-section is the entire world.
* **Circular-loop Green's functions** (`greens.js`) via complete elliptic integrals
  computed by AGM. Mutual inductances, fields and fluxes all come from the same
  two functions, so the inductance matrix is symmetric to machine precision and
  the circuit solve is conservative. This part is exact for filamentary loops.
* **19 coil circuits** (`machine.js`): 8 outer shaping (F), 8 inner shaping (E), an
  ohmic primary stack and its return pair, and one fast in-vessel anti-series pair.
  Self-inductances from the uniform-current-density ring formula; resistances
  derived from a specified L/R so the two can never drift apart.
* **Voltage command, not current command.** Coils evolve under a full coupled L/R
  circuit model with mutual inductance between every pair, integrated by backward
  Euler at 50 µs. Hard limits on voltage, current and slew rate live inside the
  environment.
* **A conducting vessel** as 16 passive axisymmetric loops with their own L/R
  (6 ms) and full mutual coupling to the coils and to the plasma.
* **72 magnetic diagnostics**: 34 flux loops just outside the wall, 38 poloidal
  field probes just inside it, each reading the tangential component. Plus 19 coil
  currents and a Rogowski plasma current. Gaussian noise and one control step of
  measurement delay on all of them.
* **10 kHz control**, physics integrated at 20 kHz.

### The plasma — a rigid filament ensemble

Seven toroidal current filaments: one at the axis carrying 34% of I_p and six on a
contour at 0.62 a carrying the rest. Their positions encode the current centroid,
the elongation and the triangularity. Each timestep:

* the net Lorentz force on the ensemble is computed from the coils, the vessel and
  its own hoop force;
* the centroid accelerates under that force with an effective mass and a viscous
  drag (both numerical devices — see §3);
* the plasma current evolves under `L_p dI_p/dt = V_loop − R_p I_p`, with the loop
  voltage coming from the rate of change of external flux through the plasma —
  which is how the ohmic transformer actually drives current;
* the minor radius is slaved to I_p and clipped by the vessel (that clipping is
  the limiter model);
* the elongation and triangularity are **slaved to the applied field**, relaxing on
  1.2 ms toward values read off the field decay index and the curvature of B_z.

### The instability — the point of the whole exercise

The field decay index

    n = −(R / B_z) · ∂B_z/∂R

is the hinge. n > 0 is a field that pushes a displaced plasma back toward the
midplane. n < 0 pulls it further away — and n < 0 is *also* exactly the field
shape that elongates the plasma. So "elongated" and "vertically unstable" are the
same statement about the same number, and it falls out of the model rather than
being imposed on it. Measured (`node test_headless.js physics`):

| configuration | vertical growth time |
|---|---|
| κ ≈ 1.05, wall present | stable / neutral |
| κ ≈ 1.75, wall present | **≈ 9 ms** |
| κ ≈ 1.75, vessel loops open-circuited | **≈ 1.3 ms** |

The conducting wall buys the controller roughly a factor of ten. That factor is
the only reason a controller exists for this problem at all, and the test suite
fails if it disappears.

---

## 2. The three fudges you need to know about

These are not simplifications. They are places where the model is *wrong* and has
been bent back toward reality with a fitted constant.

### 2.1 `COIL_SCREEN = 0.01` — passive stabilisation (tokamak.js)

**The problem.** A rigid current ring displaced inside a set of low-resistance
conductors induces enormous opposing currents. In this geometry the shaping coils
alone hold the vertical mode with roughly **250× the stiffness of the instability
driving it**, and an "unstable" elongated plasma sits placidly in the middle of the
machine for ten seconds. Real elongated tokamaks are only *marginally*
wall-stabilised, with growth times of a few milliseconds.

**Why the model is wrong.** The real unstable mode is not a rigid vertical shift.
The plasma deforms as it moves, and a deforming plasma couples to distant
conductors far more weakly than a rigid one. Rigid-displacement filament models
are known to over-estimate passive stabilisation for exactly this reason, and this
is a rigid-displacement filament model.

**The fudge.** The motional EMF that plasma displacement induces in the *coil*
circuits is multiplied by 0.01. The vessel is left alone (`WALL_SCREEN = 1.0`),
partly because it needs no correction to land in the right place and partly
because the vessel physically screens the coils from anything fast anyway.

**What it costs you.** Any question of the form "how much passive stabilisation
does this coil set provide" has a meaningless answer in this simulator.

### 2.2 The κ(n) and δ(∂²B_z/∂R²) maps (tokamak.js `_updateShape`)

There is **no Grad-Shafranov solve anywhere in this project.** The plasma shape is
not solved for; it is read off a three-term Taylor expansion of the applied
vertical field about the magnetic axis and pushed through two fitted monotone
formulas:

    κ_eq = 1 + 0.95 · max(0, −n)                    capped at 2.45
    δ_eq = 0.055 · R² (∂²B_z/∂R²) / B_z             capped at ±0.65

These get the *coupling* and the *signs* right — more quadrupole gives more
elongation, inverted hexapole gives negative triangularity, and both come from the
same coils that set the position — and the magnitudes roughly right. Everything
else about them is invented. There is no separatrix, no X-point, no divertor leg,
and the "boundary" is a Miller-parameterised oval that has never been a flux
surface of anything.

### 2.3 Effective mass and drag (tokamak.js `PLASMA.mass`, `PLASMA.drag`)

The plasma's real inertia is negligible; a real rigid-displacement model is
massless and the timescale comes entirely from the conductors. This one carries
5 g of effective mass and 30 N·s/m of drag, chosen so the plasma reaches force
balance in ~0.2 ms — far faster than the 6 ms vessel time constant, so the vessel
still sets the growth rate — while keeping the explicit integrator stable. Set the
drag to zero and the simulation blows up; set it high and the wall stops mattering.

### 2.4 (bonus) The resistive feed-forward in the power supplies

Each supply adds `R̂·I` on top of whatever the controller commands, so a zero
command *holds* the present current rather than letting it decay at the coil's
L/R. This is the innermost loop of a real power supply, not a favour to the agent:
the action space stays honestly inductive (you can only push on `dI/dt`, and every
slew, voltage and current limit still applies), but eighteen of the nineteen
outputs no longer have to spend their capacity learning a DC bias the machine
already knows. `R̂` is the *nominal* resistance, so a randomised machine with
hotter coils leaves a residual drift the controller has to notice.

---

## 3. What is simplified

| Thing | What is done | What is real |
|---|---|---|
| Plasma current profile | 7 filaments, fixed weights, `l_i = 0.9` constant | continuous, evolves by resistive diffusion, `l_i` changes through a shot |
| Poloidal beta | constant per episode (randomised 0.15–0.55) | set by heating, transport and confinement, evolves continuously |
| Minor radius | formula in `I_p`, clipped by the wall | set by pressure balance and the limiter/separatrix |
| Hoop force | large-aspect-ratio Shafranov expression using the *nominal* minor radius | the full free-boundary force balance |
| Vessel | 16 independent rings | a continuous 3-D shell with ports, bellows and poloidal current paths |
| Coils | filamentary, single point per turn bundle | finite winding packs, ±10-20% on every inductance |
| Sensors | ideal, Gaussian noise, one-step delay | integrator drift, pickup, calibration error, cross-talk |
| Toroidal field | absent entirely | the dominant field in the machine |
| Safety factor q | never computed | limits everything: q₉₅ < 2 disrupts, q = 1 sawteeth, rational surfaces tear |

---

## 4. What is completely absent

Nothing in the list below exists anywhere in this project. Not simplified —
**absent**.

* **Transport.** No energy or particle transport, no confinement time, no
  temperature or density anywhere. The plasma has no thermodynamics.
* **Heating and fuelling.** No ohmic heating power balance, no neutral beams, no
  ECRH, no gas puffing, no pellets, no recycling.
* **Any fusion reaction whatsoever.** There is no D-T, no neutrons, no alpha
  particles, no tritium, no power output. Nothing here has anything to say about
  whether a reactor works.
* **MHD beyond the axisymmetric vertical mode.** No kink modes, no tearing modes,
  no neoclassical tearing modes, no sawteeth, no ELMs, no locked modes, no
  resistive wall modes. All of these are non-axisymmetric and this geometry cannot
  represent them. **Most real disruptions come from what is in this bullet.**
* **Kinetic effects.** No distribution functions, no runaway electrons, no fast
  ions, no bootstrap current.
* **The divertor.** No X-point physics, no strike points, no scrape-off layer, no
  detachment, no heat flux to any surface.
* **Radiation.** No bremsstrahlung, no line radiation, no impurities, no radiative
  collapse — which is a leading cause of real current quenches.
* **Breakdown.** The "full discharge" demo starts with 45 kA of plasma already
  flowing. Real breakdown is a Townsend avalanche in neutral gas with strict
  requirements on stray field, and it is a genuinely hard control problem this
  simulator does not contain.
* **Disruption dynamics.** When this model says "disrupted" it stops the episode.
  A real disruption is a thermal quench, a current quench, megaamp halo currents
  through the vessel, kilonewton forces on the structure and possibly a runaway
  electron beam. Nothing here models the *consequences* of failure, which is what
  actually makes disruptions unacceptable.

---

## 5. Where this would mislead someone who took it seriously

1. **It says the vertical instability is the hard part of tokamak control.** In
   this simulator it is, because it is the only instability present. On a real
   machine vertical control is largely a solved problem and the hard, unsolved
   parts — disruption avoidance, ELM control, detachment control, current profile
   control — are all things this model cannot represent at all.

2. **It says a controller that never disrupts here would never disrupt there.** The
   three failure modes implemented (vertical displacement, wall contact, current
   collapse) are the three *easiest* ones. A policy trained here has never seen a
   tearing mode, a radiative collapse or an impurity influx, and would have no
   response to any of them.

3. **It suggests the sensor-to-actuator map is learnable from a few hundred
   thousand episodes.** The observation here is genuinely 219-dimensional and
   genuinely coupled, but the *plant* behind it has about a dozen degrees of
   freedom. A real plasma has a continuous current profile, a continuous pressure
   profile and a boundary that can change topology.

4. **The shipped controller was cloned from the PID before it was evolved.** It is
   an improvement on a known controller, not a discovery of control from nothing.
   The from-scratch genetic algorithm in this repository never came close to the
   baseline. That is worth stating plainly, because "neuroevolution learned to
   control a tokamak" and "neuroevolution improved on a hand-tuned cascade it was
   initialised from" are very different claims, and only the second one is true
   here.

5. **The difficulty ladder is not a robustness proof.** It varies five parameters
   of *this* model. A controller that survives `savage` has some claim to being
   insensitive to wall resistivity and elongation within this simulator; it has no
   claim whatsoever about model error, which is the thing that actually kills
   sim-to-real transfer.

6. **It suggests you can validate a controller in simulation.** Everything here is
   consistent because it all comes out of one model. Sim-to-real transfer on TCV
   required the simulator to be accurate about things this one does not contain,
   and the domain randomisation here (resistivity, wall time constant, coil gains,
   sensor noise, β_p) covers parameter error, not *model* error. Model error is
   what kills you.

7. **The reward function is a weighted sum of squared errors.** On a real machine
   "did the divertor survive" is not in that sum, and nothing here would notice if
   it hadn't.

---

## 6. What would break first at scale

If you tried to take this approach to a machine that mattered:

* **The simulator, immediately.** Everything above. You would need a free-boundary
  Grad-Shafranov solver in the loop, and it would be four orders of magnitude
  slower than this, which is the entire engineering problem the original work
  solved.
* **The reward.** Writing down what a tokamak operator wants as a scalar is much
  harder than writing down what a shape controller wants. Most of what matters is
  a constraint, not an objective.
* **The safety case.** A learned controller that has to be trusted with a hundred
  megajoules of stored magnetic energy needs an argument for what it does outside
  its training distribution, and "we randomised the wall time constant by ±40%"
  is not that argument.
* **The instrumentation.** This model assumes 72 clean magnetic channels with one
  step of delay and no failures. Real machines lose channels mid-shot.
* **The economics.** A million simulated discharges is free. A thousand real ones
  is a year of machine time and a large fraction of the divertor's life.

---

## 7. Reproducing the calibration

```
node test_headless.js          # everything
node test_headless.js physics  # the growth-rate and equilibrium calibration
node test_headless.js tune     # re-sweep the PID baseline gains
```

The physics section asserts, and fails on, all of:

* the inductance matrix is symmetric and invertible;
* the field lookup tables agree with direct elliptic-integral evaluation to 2%;
* the fast coil is at least 30× faster than the shaping coils;
* a circular plasma holds position open-loop;
* an elongated one is unstable with a 2–25 ms growth time;
* **removing the conducting wall makes it at least twice as fast**;
* every observation neuron is finite and O(1) after normalisation;
* the least-connected coil still moves more than 60% of the field probes.

That last one is the "no clean actuator-to-objective pairing" claim, and it is
checked rather than asserted because without it the exercise would be hollow.
