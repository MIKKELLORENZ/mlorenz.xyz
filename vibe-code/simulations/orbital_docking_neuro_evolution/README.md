# Learning to Dock

A 6.3-tonne capsule teaches itself to rendezvous with a space station and dock,
from up to 150 km away, by evolution alone. No gradients, no reward shaping by
hand-tuned scale factors, no attitude controller underneath, and no scripted
phases.

- **`index.html`** — playback only. Six scenarios, three camera views.
- **`node train.js`** — the headless trainer.
- **`node test_headless.js`** — the regression suite.
- **`PHYSICS.md`** — every simplification, named.
- **`earth.js`** — the planet: procedural textures, a custom day/night/limb
  shader, and the orbit-driven orientation described below.
- **`browser_train.js`** — the same GA running in the page, in slices. A
  demonstration, not the method; see the note at the bottom.

---

## The problem, and why it is not a control problem

The obvious framing — "fly toward the target and slow down" — is wrong here, and
wrong in a way that punishes the policy every naive search finds first.

In orbit, burning toward a station you are chasing raises your orbit, which slows
you down, and you fall *further behind*. From 100 km along-track you are already
closing at 18 m/s for free, supplied by a 10.6 km difference in altitude, and the
correct action for most of an hour is to do **nothing at all** and then brake. A
policy that has learned "thrust at the target", which is exactly what wins the
close-in stages, arrives at 100 km with no propellant and flies straight past.

So the curriculum has to teach two opposite reflexes without either one erasing
the other, and the algorithm has to make *waiting* something a network can choose.

---

## The algorithm

Six things here are not the standard neuroevolution recipe. Each exists because
of something this task does that a normal control problem does not.

### 1. A two-rate, two-head brain, evolved end to end

```
sensors ──▶ TRUNK ──┬──▶ GUIDANCE head   every 4 s   → velocity setpoint, pointing, COAST
                    │            │
                    └──▶ CONTROL head ◀──┘  every 0.25 s → six thruster commands
```

247 inputs → 64 → 48 trunk; a 7-wide guidance head at 4 s; a 6-wide control head
at up to 4 Hz that is fed both the fresh trunk **and** the guidance head's held
output. 23,277 weights, one genome, bred and mutated as one.

There is no supervision telling the control head to track the guidance head's
setpoint and no tracking loop between them. It is a message from one half of the
genome to the other, and the only reason it means anything is that a pair of
heads which agree docks and a pair which argues does not.

The split exists because "burn 6 m/s retrograde and then do nothing for forty
minutes" and "fire the +Y quad for 60 ms to stop this drift" are not the same
kind of decision and are not made at the same rate. A single flat policy asked to
make both makes the slow one sixteen times a second, which is how a network burns
its entire propellant budget in the first two minutes of a two-hour mission.

### 2. Coasting is an action, with a duration

The guidance head's seventh output is a request to stop thinking: *hold
everything, fire nothing, wake me in T seconds*. When it is granted the
integrator switches to 1–20 s steps and the episode fast-forwards — sensors still
sampling, every abort gate still checked.

This is the thing that makes the far stages trainable at all. **Episode cost
becomes the number of manoeuvres, not the mission duration**, so a 150 km
rendezvous costs about what a 40 m approach costs to evaluate. It is also,
not by accident, precisely the skill the task requires. Waiting is not the
absence of a policy here.

### 3. Fitness is an advantage between two baselines, not a score

Every scenario is flown twice before any brain sees it: once by a do-nothing
policy, once by a scripted Clohessy-Wiltshire autopilot. A brain's fitness is
where it falls between them.

```
advantage = (brain − doNothing) / (autopilot − doNothing)
```

0.0 is "no better than coasting". 1.0 is "as good as a competent scripted pilot".
This replaces the hand-tuned per-stage fitness scales that every other sim in
this collection needed, and unlike a scale it cannot be gamed by getting very
good at the cheap stage — the denominator already knows what good is worth there.

The same idea is applied *inside* the shaping term: progress is measured in log
range **from where free drift gets you**, not from where the vehicle started.
See "What went wrong" below; this was the single change that made the search work.

### 4. Common random scenarios, stratified and auditioned

Every brain in a generation flies the identical bank — identical initial
conditions, identical sensor-noise realisation. Two brains differing by one
mutation are compared on their difference rather than on which drew the 30 km
start. On a task whose scenario-to-scenario spread is larger than its
generation-to-generation improvement, this is worth more than population size.

The bank is **stratified**: one scenario per unlocked stage, a second seat for
the newest, rotating fills. Six i.i.d. draws contain four easy ones often enough
to matter, and then the generation has no pressure on what the curriculum just
unlocked.

And every scenario is **auditioned** before it is used: the autopilot must be
able to dock it *and* the do-nothing policy must not. The second test is the one
that saves runs — a scenario the orbit solves by itself gives every brain the
same score, carries no selection pressure at all, and actively teaches the
population to sit still.

### 5. Successive halving — brains are eliminated between scenarios

Everyone flies scenario 0; the worse half is dropped. The survivors fly scenario
1; the worse half of those is dropped. A full bank of six would cost 6P episodes;
this costs about 2.1P for the same ranking at the top, where ranking is the only
place it matters. Measured in the logs at **60–63% of episodes saved**.

Unflown scenarios are imputed **pessimistically** — a brain is credited with its
own average so far, minus a margin — so a brain eliminated after one scenario can
never leapfrog one that went the distance. The elites and the reigning champion
are exempt and always fly the full bank: the top of the ladder is the one place
the extra noise of a short evaluation must not be allowed in.

On top of that, five within-episode abort gates kill most brains in the first
simulated minute — flew past, backed away, exceeded the approach envelope, hit
the structure, tumbling.

### 6. One-way islands, and a curriculum that never forgets

From stage 2, three demes breed only within themselves under different mutation
recipes, and each generation each deme's best is copied into the **main pool's
bottom seats**. Nothing travels the other way — an island that keeps receiving
the champion stops being an island within three generations.

The stage ratchet reads held-out exam results, never training scores, and
promotes only when the newest stage clears its bar **and** stage 0 has not gone
backwards. It never demotes; an unlocked stage stays in the bank forever.

---

## The curriculum

| stage | | separation | what it teaches |
|---|---|---|---|
| 0 | Terminal | 30–80 m, in the corridor, at rest | the six capture limits |
| 1 | Proximity | 120–500 m, off-axis | slew, acquire the laser, fly round to the corridor |
| 2 | Near rendezvous | 1–5 km | orbital mechanics starts to bite |
| 3 | Far rendezvous | 20–150 km along-track | phase, coast most of an orbit, brake |
| 4 | Out of plane | as 3, plus inclination and eccentricity | cross-track can only be fixed at a node |
| 5 | Degraded | biased station attitude, alternate ports, 4× nav noise, less propellant, tighter clock | everything at once |

The scripted autopilot docks 46–48 of 48 across all six, at 2.4 m/s of Δv on
stage 0 and 35–40 m/s on the far stages. That is the ruler; it is not a ceiling —
it reads true state with no noise, no lag and no field of view, and it plans with
a linearisation the world does not obey.

---

## What went wrong, and what it cost

Five bugs in this project produced the same symptom — a flat fitness curve that
looked like "the GA is slow" — and four of them were in the environment, not the
search.

**The Clohessy-Wiltshire state transition had six sign errors.** This file's LVLH
frame has z pointing *nadir*; the textbook's radial axis points *up*. Flipping it
flips the sign of every term coupling radial to along-track motion. The solver
stayed internally consistent, returned finite plausible velocities, and planned
trajectories that flew the wrong way round the orbit: every long-range plan came
back asking for 60–80 m/s to do a 23 m/s job and the autopilot ran its tank dry
on seven of eight far scenarios. It read exactly like a controller tuning problem.
What caught it was checking the sim's own unpowered drift against the analytic
solution and asking which of the two was physically right — *a vessel 100 m below
the station is in a lower, faster orbit and must pull ahead*.

**The minimum impulse bit put a floor under the achievable pointing error.** With
an 8% deadband and a 0.7 proportional gain, any attitude error under
`0.08/0.7` = 6.5° commands less than one 20 ms pulse and produces no torque at
all. The capture limit is 4°. The autopilot was physically incapable of docking
and reported itself converged the whole time; every approach contacted at
0.111–0.124 m/s against a 0.120 limit, half a metre off centre. Fixed by deleting
the invented deadband — the minimum impulse bit is the only real floor — and by
running all six axes through a delta-sigma pulse modulator, which is what real
RCS phase-plane logic does and for exactly this reason.

**A flat attitude PD spun the vehicle up to the tumbling limit.** Terminal slew
rate under a PD is where `kp·θ` meets `kd·ω`, which for a 180° error is 13.7°/s
against a 15°/s abort. Two of sixteen far scenarios ended with the *autopilot*
declared out of control four seconds after ignition, having done nothing but obey
its own gains. Replaced with a rate cascade, which bounds the slew by
construction.

**The initial attitude was built in LVLH and installed as an ECI attitude.**
`scenarios.js` points the body +X axis at the station — necessarily a statement
about LVLH directions — but `craft.q` is body→ECI everywhere else. Installing it
directly composes it with whatever rotation happens to relate the two frames at
t=0, which is to say it randomises it. The entire attitude ramp in the curriculum
was doing nothing: stage 0 declared a 25° pointing error and was measured
starting at **172°**, nose pointing directly away from the station, an 85-second
slew out of a 480-second mission, on the rung that is supposed to be the gentle
one. It hid because stages 1–5 declare 180° and got 180° — only the easy end of
the ramp was wrong, and only the easy end matters for getting a run started.

**And the one that was genuinely about the reward.** Thirty generations produced
mean advantage −0.32, best 0.006, and a champion that spent 0.5 m/s of Δv. The
population had learned to be inert, and it was right to: two things made inaction
the second-best policy available.

- *Free progress.* A vessel handed 0.2 m/s of closing rate at 60 m coasts to
  22 m by itself — 64% of the log-range journey — while a brain that fires toward
  the station accelerates into the approach-envelope abort and dies at 35 m,
  having done worse than the fleet that sat still. Fixed by starting stage 0 at
  rest at a hold point (a genuine equilibrium of the relative dynamics, and what
  a real terminal approach looks like) and by measuring the progress term from
  the do-nothing policy's own best range rather than from R₀, with a floor at
  −0.35 so that a wrong guess is worse than inaction but not so much worse that
  the population stops being willing to try.
- *An inert fleet.* At the 0.03 output-init scale used elsewhere in this
  collection, the median fresh translation command was 0.027 — **below** the
  0.040 that one 20 ms pulse in a 0.25 s tick requires. 241 of 300 random brains
  were physically unable to fire a thruster during a terminal approach, and no
  fresh brain produced any torque whatsoever. Thirty generations of selection on
  a fleet of statues produced exactly the flat curve you would expect. The output
  scale is now set *by* the minimum impulse bit: 0.07, with the torque rows at
  0.45 of that.

The lesson each time: when a genetic algorithm looks slow, check whether the
environment can express the behaviour you are selecting for before touching the
selection.

Two more of the same shape turned up in the renderer, where "it looks wrong" is
the only symptom available:

- **Procedural surface detail sampled from the world normal.** The world normal
  rotates with the mesh, so the detail pattern stayed nailed to the LVLH frame
  while the map moved underneath it — two superimposed surfaces, one gliding
  past and one standing perfectly still, which is far more obviously wrong than
  having no detail at all. Anything painted *on* the planet has to be a function
  of where it is *on* the planet, i.e. object space.
- **A specular mask smuggled into a texture's alpha channel.** Canvas backing
  stores are premultiplied, so alpha 26 with a green of 104 stores a green of
  10, and three.js uploads that as-is. Every land pixel came back at a tenth of
  its brightness and the planet rendered as a blown-out ocean with invisible
  continents.

---

## Running it

```bash
node test_headless.js                      # regression suite
node train.js --pilot                      # what the ruler scores
node train.js --gens 3000 --pop 128 --workers 5
node train.js --stage 0 --gens 300         # lock a rung
node train.js --resume training/checkpoint.json --gens 2000
node train.js --bake training/checkpoint.json     # → default_brain.js
```

`--workers` deliberately defaults below the core count. On a shared machine pass
it explicitly; a trainer that saturates a box gets itself killed.

Each brain is shipped to exactly one worker once per generation and stays there —
only the alive list and the scores cross the boundary after that. Dealing each
race round across the pool instead would re-ship 93 KB per brain per round for
episodes that take fifty milliseconds.

## The page

Playback only, deliberately. Training happens headlessly on many cores because a
single far-stage rendezvous is a two-hour mission and a generation is several
hundred of them; sliders on this page would be a lie about what produced the
champion. The episode is simulated to completion the moment you pick it and the
trajectory is recorded — which is what makes the scrubber, the ghost track and
instant view changes possible, and is the only way to show a variable-step
integrator that jumps twenty seconds at a time.

The panel has two modes — **Watch** and **Evolve** — and they share no controls.
Watching a finished brain and breeding new ones want completely different things
on screen, and interleaving them produced a column where half the sliders applied
to the flight you were looking at and half to a population that was not running.

Three views: orbiting the capsule (drag, wheel to zoom), from the capsule looking
down the docking axis, and from the station watching it come in.

Boot is sliced behind a loading screen. Generating the Earth's maps is about four
million fractal-noise evaluations and flying the first rendezvous is a few
thousand integration steps — one or two seconds of blocked main thread. Done
synchronously the page shows nothing until it is over, which is
indistinguishable from a page that failed to load, so the work yields to the
browser between steps and the intro button is gated until there is something
behind it.

### Evolving it in the page

There is a training panel, and it is a **demonstration rather than the method** —
the copy beside it says so. One browser thread at a population of twenty-four is
three orders of magnitude short of what a champion takes. What it is good for is
watching the machinery that a log file hides: scenarios being auditioned and
rejected, the field being cut in half between scenarios, and the advantage figure
moving against a zero line that means "no better than doing nothing".

It runs in slices — one episode at a time inside a 12 ms budget per frame — so
playback stays at 60 fps while it works. A generation is a few hundred episodes
and would otherwise freeze the tab for seconds at a time. It uses the same
`Evolution`, `World`, scenario bank and audition as the headless trainer;
nothing in it is a simplified re-implementation, which is the only way a
demonstration is worth anything. Measured: about 2 s per generation at
population 16, best advantage climbing 0.09 → 0.11 over the first four.

### Training overnight

`run_overnight.ps1` launches the trainer and stops it at a wall-clock deadline:

```powershell
powershell -File run_overnight.ps1 -Until 07:00 -Workers 5 -Pop 128
```

Node has no notion of "train until morning"; the wrapper does, and it kills the
whole worker pool rather than leaving five orphaned threads behind. Detached runs
started with `( ... & )` from a shell get killed when that shell exits — use
`Start-Process`.

`index.html?shot=3&at=0.42&view=cockpit&dist=40&flyer=pilot` jumps to a fixed
point in a fixed flight and pauses, for deterministic screenshots, and writes
diagnostics into `document.title` — a screenshot can lie, that cannot. It also
paints synchronously rather than waiting for `requestAnimationFrame`, which
barely fires under headless Chrome's virtual clock.

### Why the Earth has to be told where it is

The scene is drawn in LVLH, so the Earth's *centre* never moves — it sits
6,791 km below for the whole mission. A static sphere there makes a 93-minute
orbit read as a hover, which is exactly how this looked at first. What moves is
the surface: the LVLH frame turns once per orbit against inertial space, so the
Earth mesh is given the rotation carrying its own Earth-fixed axes into LVLH —
`conj(q_B) ∘ Rz(θ)`, the orbit composed with the planet's own sidereal spin.
The result is a correct ground track at 7.66 km/s, with the terminator and the
coastlines sweeping past underneath.

Textures are generated procedurally at load (fractal noise sampled on the
sphere, so there is no dateline seam and no polar pinch) because the page has to
work from `file://` with no server and no network. The day side gets three
octaves of shader-side detail on top, because from 420 km up the Earth fills the
sky and *any* affordable texture is magnified to mush — a bigger map costs
seconds of load and still loses that fight.
