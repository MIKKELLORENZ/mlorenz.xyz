# Event Horizon — a relativity flight school

A game you fly, and a course you take by flying it. Eight short missions, each
built around one idea — why orbits are free fall, why GPS has to correct for
Einstein, why the traveller comes home younger, what a horizon actually is —
plus a free-flight laboratory and an 18-page field guide.

Open `index.html`. No build step, no dependencies, no assets: everything
(including the sound) is generated.

| # | Mission | What it teaches |
|---|---------|-----------------|
| 1 | Falling around the Earth | An orbit is a fall that keeps missing. Free fall reads 0 g. |
| 2 | Relativity in your pocket | Hohmann transfer to the GPS shell; the +45.7 / −7.2 µs-per-day clock terms appear on the instruments, live |
| 3 | Proxima Centauri at one g | The speed limit, γ, the twin paradox. 4.246 ly at a real 1 g: 7.1 years for you, 11.7 for Earth |
| 4 | Borrowed time | Gravitational time dilation by hovering deep in a well — and what hovering costs |
| 5 | The last safe orbit | The ISCO at 3 rs, the energy landscape, orbits that precess into rosettes |
| 6 | Bending light | Fire single photons round a hole: deflection, the two-image rule, the photon sphere, and a shot that comes back to you |
| 7 | Pick your black hole | Tides scale as 1/M²: the small hole kills you at 78 rs, the four-million-Sun one is gentle |
| 8 | Point of no return | The horizon from both sides: the river of space, the light circle, pings that never arrive, and how long you can last inside |
| 9 | Free flight | Everything on, unlimited fuel |

Every mission has a **Show me how** button that flies it with a scripted
pilot; touching any control takes over mid-flight.

## What is real

The ship is not flown through Newtonian gravity with relativistic trim. It is
flown through the Schwarzschild spacetime, in Gullstrand–Painlevé ("rain")
coordinates, where the metric reads

    ds² = −dT² + |dx − V dT|²,     V = −sqrt(rs/r) r̂

— flat space, flowing inward at the escape speed, with special relativity
holding relative to the flow (Hamilton & Lisle's *river model*). The state is
the ship's position and its proper velocity `w` relative to the river; with
γ = sqrt(1 + w²),

    dx/dτ   = w + γV
    dw_i/dτ = −γ w_j ∂_i V_j + A_i        (A = the rocket, boosted from the ship's frame)
    dT/dτ   = γ

Set A = 0 and that is the geodesic equation, exactly. Two things follow that
matter for a game:

- **The horizon is not special.** The river reaches c there and nothing else
  happens, so the ship integrates straight through it and on to the
  singularity, and so do light rays.
- **The map is honest.** The constant-T slices are flat, so a flat top-down
  chart is a true picture of one: on-screen distances are the distances a
  freely falling observer measures.

Nothing relativistic is "put in". The last stable orbit, the precession, the
photon sphere, the hover thrust diverging at the horizon, the finite fall time
inside — all of it is just what those three lines do. The same code flies the
Earth missions with rs = 8.9 mm, which is why the GPS numbers come out right.

Light (the beacon flashes, the laser shots) is integrated as null geodesics in
the same river. The round window is ray-traced from the orbit equation
`u'' = −u + (3/2) rs u²`, tabulated once per radius and inverted per star, with
second images and the ship's own aberration and Doppler shift applied.

### The two far-away times

Rain time `T` is regular at the horizon; it drives the light pulses and the
river. The **far clock** you are scored against is Schwarzschild time `t`,
because that is the convention in which

    dτ/dt = sqrt(1 − rs/r) × sqrt(1 − v²/c²)

holds exactly at every instant (v = speed past a hovering observer), and that
is the rule the instruments display. The two differ by a function of `r`
alone, so they agree about every round trip; they differ only about what "now"
means for someone moving radially, which is a convention. `t` runs away at the
horizon and the far clock shows ∞ — the field guide page *What does "now" mean
far away?* explains why that is bookkeeping and not something you would see.

## What is not real

- **The engine.** Hovering at 2 rs over Sagittarius A* takes ~130,000 g.
- **No spin.** Real holes are Kerr, which moves the ISCO inward and makes
  Interstellar-sized dilation factors possible from a stable orbit.
- Small bodies (stations, tugs) have no gravity. The gas disc is decoration.
- The hover autopilot and the align keys are conveniences, not physics.

## Tests

    node test_headless.js

64 checks, no browser needed. The physics half compares the integrator with
closed forms: E and L conservation, Kepler's law in far time, the orbital clock
rate sqrt(1 − 3M/r), instability inside 3 rs, 6πM/p precession, the rain fall
time (2/3)r^1.5, the π/2·rs/c maximum inside the horizon, hover thrust and hover
clock rate, `T − t` along a powered dive, the hyperbolic-motion formulas, the
GPS microseconds, light deflection to second order, the photon orbit and its
critical impact parameter, the 42° shadow seen by a faller at the horizon — and
an end-to-end check that the window's ray table and the photon integrator, two
independent routes, put both images of a star in the same place.

The second half flies every mission with its scripted pilot, which is the only
real proof that the fuel budgets, engine sizes and time limits add up. It also
flies five strategies through the horizon and checks their ordering against the
known result (Lewis & Kwan 2007): burning inward < coasting < dropping from as
low as you can hover < the same plus a burn outward until E = 0, and burning
outward all the way down is worse than stopping at E = 0. The last mission's
star ratings are set from those flights: 44 % / 70 % / 78 % of the maximum.

## Files

| file | |
|---|---|
| `physics.js` | the river-model integrator, photons, apsides, diagnostics — no DOM |
| `sky.js` | ray table for the window view, star catalogue, aberration — no DOM |
| `sim.js` | one flight: engine, hover autopilot, clocks, beacon pulses, laser range — no DOM |
| `missions.js`, `missions_bh.js` | what each mission sets up, its win test, its text |
| `pilot.js` | scripted pilots (tests, and "Show me how") |
| `guide.js` | the field guide |
| `render.js`, `porthole.js`, `hud.js`, `audio.js`, `main.js` | chart, window, instruments, sound, loop and screens |

URL parameters, for screenshots and testing: `?m=<mission>` `&variant=<id>`
`&demo=1` `&bench=<frames>` `&keys=KeyZ,KeyW` `&perf=<frames>` `&touch=1`
`&screen=menu|guide|brief`.

## Notes from building it

- **Feedback loops need their own clock.** The hover autopilot is a PD loop.
  Under ×4 time-warp one frame is 0.8 time units and gain × interval went past
  2: the ship was slammed between full thrust and none, burned 50 c of fuel in
  seven seconds and fell in. It now re-evaluates its control law often enough
  that gain × interval stays under 0.25, whatever the warp.
- **Step size near the singularity.** A fraction of the orbital time
  sqrt(r³/M) is not enough: with any angular momentum the −3ML²/r⁴ term whips
  the ship in faster than that, and one step jumped clean over r = 0 and came
  out the other side at 10⁶ rs with E = 10⁶. The step is now also limited to a
  few percent of r / |dx/dτ|.
- **Weak fields need cancellation-free arithmetic.** Around the Earth dt/dτ − 1
  is 3e-10; the naive γ − 1 has no digits left. Every small quantity (E − 1,
  γ_loc − 1, the clock lead) is assembled from terms that are themselves small.
- **An engine sized for hovering cannot be flown by hand.** Holding station at
  2 rs and trimming an orbit at 8 rs differ by a factor of a hundred in thrust.
  The hand throttle is sized for the second; the big number belongs to the
  autopilot, which also refuses to descend below where it can still hold.
- **The frame was 16 ms and 11 of it was the background.** A full-screen radial
  gradient repainted every frame. It is now painted once and given to the
  compositor as a CSS background; the chart costs 0.25 ms.
