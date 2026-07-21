# Smart Ocean Boats

Neuroevolution of 60 cm hydrofoil boats, top-down, in the browser. Open
`index.html` — no build step, no dependencies.

The long-term goal is transferring an evolved brain onto a real hull, so the
sim keeps things physical: SI units throughout, a 15 Hz control loop over a
30 Hz physics tick, ESC/servo response lag, stiction, sensor + actuator noise,
wind on the topsides, and ocean currents the hull drifts with.

## The boat

Real dimensions: 0.60 m LOA, 0.38 m beam, 30–40 cm topsides, hydrofoil.
Mass 4.2 kg, twin engines (5 N each, 10 cm off centerline), a brake flap with
reverse wash, and a steering thruster whose authority grows with speed. Above
~1.2–1.9 m/s the hull rises onto its foils and quadratic drag drops from 2.4
to 0.5 — top speed ≈ 3.6 m/s foiling, ≈ 1.9 m/s displacement.

## Brain contract (what a real controller would implement)

**47 inputs:** 14 land-detecting rays + 14 ship-detecting rays (evenly spaced,
26 m range) · speed · the last three commanded acceleration states · body-frame
accelerometer x/y · distance remaining along the GPS route · straight-line
distance to target · sin/cos of the compass bearing to target · heading of the
current GPS stretch (relative) · sin/cos of the ocean-current direction
relative to the bow (scaled by strength) · sin/cos of the wind direction
relative to the bow (scaled by strength) · the same four flow readings from
the previous control tick, so the net can sense gust onset and current shear
by differencing. A real hull estimates the flow inputs from GPS drift and a
wind vane.

**5 outputs:** engine 1 · engine 2 · brake · rotate left · rotate right.

Export the champion from the UI: the JSON holds raw weight matrices for the
fixed 47→32→18→5 tanh/sigmoid net.

## Evolution (no gradient descent)

Per generation, ranked by fitness: 4 elites copied untouched → 8 mutated elite
copies → 8 elite×elite crossovers → a rank-weighted "gradient" of riskier
children (mutation strength grows down the roster) → 2 fresh random brains.

**Champion grace** (configurable, default 3 gens, 0 = off): the reigning
champion keeps an untouched seat even when beaten — one unlucky episode can't
erase a proven brain. The boat that beat it gets normal elite treatment (kept
and mutated) alongside it. Only one boat holds grace at a time: the title
passes when the holder's grace runs out, and defending the title (winning
again) refreshes it. The grace holder is drawn in green.

Fitness, in priority order: locations reached (1000 + speed bonus each) →
route progress + closest approach → land strikes (penalized per hit and per
second aground) → ship collisions → combat score. Progress is measured as
*best distance achieved along the GPS route*, so oscillating or drifting in
circles earns nothing.

## Training stages

1. **Navigate** — boats are ghosts to each other; learn waypoints, wind, currents.
2. **Avoid** — ship collisions switch on at a generation you pick, at a mean
   arrivals threshold, or from the very start.
3. **Combat (optional)** — bow guns auto-fire inside a ±9° cone; every third
   mission becomes a hunt where the GPS target is the nearest enemy boat.

Time is a resource: each boat starts with its own clock (default 110 s) and
every reached location adds +60 s to it. A boat whose clock empties freezes
where it floats, score locked; the episode ends when every clock has run out.

Missions are an endless shared chain of GPS points spawned at random on
reachable water (never a landlocked pond, always ≥18 m from the previous
point). The moment the first boat reaches point N, point N+1 is rolled — and
every other boat gets the same point once it finishes N. Docks are scenery.

Fairness: every boat in a generation gets the identical point sequence,
spawn cluster, and weather — brains are the only variable. Each generation is
scored over **two episodes** with different missions and weather, so a single
lucky route doesn't pass for skill and generalists win.

## Maps

Three hand-crafted seas (fixed-seed shoreline detail, never regenerated):

- **Skerry Archipelago** — open water, scattered skerries, a slow gyre around
  the main isle, steady SW breeze.
- **Emerald Delta** — a river that forks around a mangrove island into a
  silted bay, with a 0.65 m/s downstream current.
- **Silver Fjord** — two narrow arms in snow-capped rock, gusty channeled
  wind, tidal current breathing on a 70 s cycle.

## Dev

`node test_headless.js` runs the sim logic without a browser: map/dock
routability on all maps, physics sanity (top speed, brake, stiction),
a few generations of evolution, serialization round-trip, and gunnery.
