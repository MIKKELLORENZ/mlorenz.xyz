# Told What To Do

A five-joint robot arm learns to sort coloured balls into buckets **by being
told what to do in English**. The instruction is embedded by
**Qwen3-Embedding-8B**, reduced to 16 numbers, and fed to the network alongside
what its cameras see. There is **no gradient descent anywhere** — every weight
is found by mutation and selection.

Open `index.html`. No build step, no dependencies.

> *"Ensure the balls end up in their respective buckets, but leave one yellow
> left on the table."*

The interesting question is not whether an arm can learn to pick things up. It
is whether one policy, evolved on 392 sentences, does the right thing when a
human phrases the job in words it has never seen. That is what the held-out
split measures, and it is the only number in this project worth arguing about.

## Status — read this before believing anything below

**The simulation, the referee, the language pipeline and the UI are finished and
tested.** The scripted reference controller clears **73/73 balls across all
seven goal kinds**; 47 headless tests and 22 browser checks pass.

**The population is not yet trained to a usable champion.** At the time of
writing the best brain delivers on 2 of its 4 stage-1 training missions and 0 of
8 unseen ones — real pick-and-place, no generalisation yet. There is no baked
`default_brain.js`, so the page offers "evolve from scratch" and "scripted
reference" but not "watch the trained champion".

Everything in the sections below about *architecture and physics* is finished
work. Everything about *training* is a live investigation, and the numbers
quoted are measurements taken along the way, not final results. The five
diagnosed blockers are written up honestly because each one looked exactly like
"the GA needs more time" on a fitness curve, and none of them were.

---

## The task language

**49 goal specifications × 11 phrasings = 539 sentences.** Eight phrasings per
goal are used for training; **three are held out** and never shown during
evolution. Same goals, different words.

| kind | example | the rule |
|---|---|---|
| `SORT` | *"Grab the red orbs and drop them in their respective box."* | named colours → matching bucket |
| `ALTERNATE` | *"Pick up the red and blue balls interchangeably."* | strictly alternating colours, either may start |
| `ORDER` | *"First the red marbles, then the green ones."* | all of A before any B |
| `COUNT` | *"Drop exactly one red orb in the red box."* | exactly N, then stop; nothing else moves |
| `LEAVE_ONE` | *"…but leave one yellow left on the table."* | sort everything bar one named spare |
| `EXCLUDE` | *"Sort by colour, skipping green altogether."* | the skipped colour must not be touched at all |
| `ALL_TO_ONE` | *"Put every marble, whatever colour, into the red bin."* | colour is irrelevant, one destination |

The phrasings vary in syntax, voice, politeness and vocabulary — `ball` /
`sphere` / `orb` / `marble`, `bucket` / `bin` / `container` / `box` — because a
brain that only works when you say "ball" has learned a token, not a task.

`tasks.js` also holds the **referee**: a `GoalEvaluator` that answers, at every
instant, *which balls would be a legal delivery right now, and into which
bucket*. Ordering, counting and exclusion are all enforced there, and the same
object runs the end-of-episode audit that catches "took the spare" and
"overshot the count".

## The embedding pipeline

```
sentence → Qwen3-Embedding-8B (4096-d) → PCA → 16 floats → network input
```

Baked once, offline, by `embed_tasks.js`. Nothing at run time ever talks to a
language model — the network sees a fixed 16-float vector, exactly as a
deployed robot would if its instruction were embedded once at the start of a
job. Raw vectors are cached to disk, so re-running the PCA at a different width
does not pay the 21-minute CPU embedding cost again.

Two things it would be easy to get wrong:

- **The PCA basis is fitted on the training sentences only.** Fitting it on all
  539 lets the held-out phrasings shape the axes the network is scored in.
- **Components are only partially whitened** (`--whiten 0.3`). This is not a
  cosmetic knob. Full whitening makes the 16th component as loud as the 1st, and
  the leading components are the ones carrying *colour* while the tail carries
  *rule type*. Measured on held-out phrasings:

| dims | whiten | rule type | colours (Jaccard) | exact goal |
|---:|---:|---:|---:|---:|
| 12 | 1.0 | 61% | 86% | 54% |
| **16** | **0.3** | **63%** | **86%** | **54%** |
| 24 | 0.5 | 67% | 81% | 51% |
| 32 | 1.0 | 63% | 62% | 35% |
| 48 | 0.4 | 68% | 71% | 42% |
| 64 | 0.3 | 73% | 71% | 46% |

(1-nearest-neighbour over the training bank, from a held-out phrasing. Chance is
14% for rule type, 25% for colours, 2% for the exact goal.) More dimensions
recover the *rule* better and the *colours* worse; partial whitening buys most
of both. 16 × 0.3 is the chosen operating point — it also gives the GA the
smallest genome.

*Caveat worth stating plainly:* those numbers were used to pick the width, so
the held-out set has informed one hyper-parameter. It has never been used to
train a network, which is the claim that matters, but it is not pristine.

`qwen3-embedding:0.6b` is supported and is a much faster bake (6 min vs 21), but
recovers the exact goal only 26% of the time against 8B's 54%. If no baked
vectors exist at all, the sim falls back to a hashed bag-of-words surrogate and
says so loudly in the UI — it separates different words but knows nothing about
meaning, so held-out numbers from a surrogate run are meaningless by
construction.

## The brain: a dual pointer network

The obvious design feeds everything into one MLP and reads five joint targets
out. It does not work, and the reason is structural: a flat net has to relearn
"how to reach a ball" separately for every slot the ball might occupy in the
input vector, and separately again for every phrasing.

So the brain is three small networks (**5,983 evolved weights total**):

| head | shape | sees | decides |
|---|---|---|---|
| `ballSel` | 44‑20‑10‑1 | one ball slot + context + **the sentence** | scored once per slot, `argmax` = which ball |
| `bucketSel` | 39‑16‑8‑1 | one bucket + context + **the sentence** | where it goes |
| `motor` | 66‑40‑24‑5 | proprioception + the *selected* ball and bucket | five servo setpoints |

Three consequences worth the design:

1. **Shared slot weights are permutation invariant.** Reaching is learned once
   and applies to every ball, in every slot, in every task.
2. **Language only has to move a decision boundary in the selectors** — which
   colour is desirable right now — not to re-specify a motor program. That is a
   far smaller thing to ask 16 dimensions to do. The motor head never sees the
   instruction at all.
3. **`argmax` is not differentiable.** Under backprop you would need a softmax
   relaxation, a temperature schedule and a straight-through estimator. A GA
   does not care; it evaluates behaviour. This is one of the rare places where
   evolution is the natural fit rather than the handicap.

An empty ball slot is all zeros, which makes it the **"do nothing" option for
free**: if `argmax` lands on an empty slot, the arm has decided there is nothing
it should be reaching for. *"Leave one yellow"* and *"don't touch the red ones"*
need exactly that action, and it costs no parameters.

## The arm

A planar 3-link chain (shoulder, elbow, wrist) on a yawing base, plus a gripper.
Everything above the base moves in the vertical plane the base yaw points at, so
the network never has to discover full 3D inverse kinematics — only "swing the
plane onto the target" and "fold the chain to the right radius and height". It
is still real IK, and the elbow-up/elbow-down ambiguity is the net's problem.

Joint limits are **solved, not guessed**: every range is the smallest that still
covers the ball area and a release point over each bucket with the gripper at
least 130° down, centred on a `READY` pose that is the exact midpoint of every
limit. A newborn brain (near-zero output layer → sigmoid 0.5 everywhere) is
therefore *born* hovering 20 cm over the work area facing the right way. Servos
are rate-limited position sources with a first-order lag.

### The action space is the whole ball game

**The four pose joints take increments; the gripper takes an absolute
position.** This is the single most consequential choice in the project, and it
was made the expensive way.

With *absolute* joint targets, "put the gripper on that ball" asks the network
for a full inverse-kinematics solution — four angles as a global function of a
Cartesian target, elbow-up/elbow-down branch included. It has to be right
everywhere at once, and a mutation that improves it near one ball position
generally breaks it near another. Measured: a stage-1 sweep across four mutation
settings, 180 generations each, never got the fleet mean above **0.015 balls per
episode**. Occasional lucky brains delivered; the population learned nothing,
and no mutation rate changed that — which is the tell that the problem is not
the search but what is being searched.

With *increments*, the same behaviour is a local rule: "the ball is that way, so
nudge these joints that way." That is roughly Jacobian-transpose control, it is
smooth in the weights, and — critically — a partial solution is still worth
something. The network still has to discover the kinematics; it just no longer
has to discover all of them before any of it pays.

The gripper stays absolute because open/closed is a *state*, not a motion:
integrating a velocity command would let the hand drift open mid-carry.

Increments need one safeguard. A newborn's outputs sit ~0.01 off 0.5, and
integrating that bias for 450 control ticks walks every joint into its end stop.
A small leak pulls the commanded pose back toward `READY`, so a constant bias
settles at a bounded offset while a deliberate sustained command still reaches
the limits. Three tests cover it: rate limits under a *sustained* command, a
steady 0.5 holding the ready pose, and a 2% bias staying inside a quarter of
each joint's range.

Perception assumes the two cameras' depth stack is solved: the network gets
object slots (position relative to the gripper, colour, state), not pixels.

## The reward ladder

```
reach → grasp → lift → carry → deposit → (next ball)
```

Every rung is measured against the **oracle target** — the ball the *goal logic*
says is a legal next pick, nearest to the gripper — never the ball the network
chose. If shaping followed the network's own choice, a brain could point at
whatever was closest, collect the approach bonus, and ignore the instruction
completely; the language input would then be free to decay into noise because
nothing paid for reading it. Shaping the oracle while the motors are driven by
the *selection* is what puts the selector under selection pressure: choose
wrong, and the arm walks away from the money.

**Each rung pays at most once per ball, for the whole episode.** This was
originally a per-cycle ratchet that reset on release, and the fleet found the
hole in 46 generations: grab, drop, grab, drop — every re-grasp re-paid the +250
grasp bonus and reset the approach ramp. The best brain in the population scored
**3,715 with zero balls delivered**, a number that looks like real progress on
any chart that does not also plot deliveries. The general rule: *if a shaping
term can be collected twice for the same physical achievement, a GA will find
the loop that collects it, and it will find that loop long before it finds the
task.* Shaping has to be a budget that depletes, never an income.

`test_headless.js` now pins this down directly — a policy that does nothing but
grab and drop scores 293 over 20 cycles, comfortably under the 930 a single ball
can ever earn without being delivered, and an invariant test asserts that whole
ladder is worth less than one delivery (1400).

### Every plateau, and what each one actually was

Every one of these looked like "the GA is just slow" on the fitness curve, and
every one was found by `probe_champion.js` rather than by staring at the chart.
The probe reports which *rung* each episode stops on, plus how much of the time
the gripper was open — aggregates cannot tell "cannot grasp" from "grasps and
never lets go".

1. **Grab-and-drop farming** (above). Symptom: fitness 3,715, deliveries 0.
2. **Never letting go.** Symptom: the champion carried balls to within 6 mm of
   the bucket and held on for the rest of the episode, gripper open 5% of the
   time. The carry ratchet saturated at the rim, so opening paid nothing extra
   while dropping anywhere else cost something. *Fix:* measure carry progress
   from the **ball to the bucket's interior floor**, not from the gripper to the
   mouth — the last few centimetres can then only be earned by letting go.
3. **A saturated aperture servo.** Symptom: after fix 2 the arm reached the
   bucket in 6 of 8 episodes but the gripper was now open **1%** of the time.
   Grasping is worth +250 and is learned first, which drives the aperture
   output's weights hard negative; from there "open the hand" is not a small
   mutation away, it is a large change to a saturated sigmoid that only pays if
   it lands at exactly the right instant. *Fix:* a final rung that pays for
   aperture directly, but only while the grasp point is inside the mouth of the
   **correct** bucket — the one pose that completes the delivery anyway.

And one that was pure physics rather than economics: the gripper's collision
geometry. An **open** gripper is two thin jaws with a gap a ball is meant to
enter; a **closed** one is a solid lump. With the jaws colliding regardless of
aperture, the population was trapped — closing is the only way to grab, but a
closed gripper pushed every ball a few millimetres out of reach first. Six of
eight probe episodes stalled at 4.2–4.8 cm from the ball, right at the grasp
radius. No policy could win, so no mutation could climb toward one. The jaws now
only collide when closed, and the jaw length is required to clear the tip
collider by a margin the test suite asserts.

4. **A pointer head with nothing to learn from.** The bucket selector's choice
   only changes anything once a ball is already in transit, and early in a run
   almost nothing gets that far — so it drifts. Measured on the generation-330
   champion: it picked the *same bucket for every held colour*, ignoring the
   "this bucket matches what I am holding" input entirely, at 21% rule-agreement
   against a 25% chance rate. Yet the same decision is trivially evolvable in
   isolation — a hill climb on that head alone hits 100% accuracy in 40 steps.
   Capacity was never the issue; the signal simply never arrived. *Fix:* `point`
   and `aim`, which pay each head for agreeing with the referee. That is not
   handing over the answer — which bucket is correct depends on the *sentence*
   ("their respective bucket" vs "everything into the red bin"), so the only way
   to collect them is to read the instruction.

5. **All three heads mutating at once.** The heads learn on wildly different
   timescales — ~40 hill-climb steps for a selector, ~1,700 for the motor head —
   and the selectors decide *which ball* the motor head is aiming at. Mutating
   them together redraws the motor head's input distribution faster than it can
   adapt. *Fix:* one head per child. Top-quartile deliveries went from 0.075 to
   0.125, reached in 120 generations rather than 260.

Worth noting what did **not** help, because both were plausible: mutating *less*
made things strictly worse (0.000 against 0.075), and the selectors were never
short of capacity or depth. Guessing at hyper-parameters cost more time here
than any of the real fixes.

## Fairness, and the mission bank

Within a generation every station gets the identical instruction, the identical
ball layout and the identical clock — **common random numbers**. Arms never
share a workspace; each gets its own copy of the same bench. If brain A drew
"one red ball 10 cm away" and brain B drew "two blues in the far corner", the
ranking would be mostly measuring the draw.

Each brain is scored on **several instructions per generation**, not one. A
generation that examines every brain on a single sentence selects for a brain
good at that sentence.

But fairness *within* a generation is not enough, and this is the thing that
took longest to find. Each stage has a **fixed bank of missions** — an
(instruction, scene, noise) triple, built once and never redrawn — and
generation *g* runs a sliding window over it. Stage 1 is four missions; the last
stage is forty-eight.

The original version drew fresh instructions **and** fresh scene seeds every
generation, and the population simply never learned: 180 generations across four
mutation settings, all sitting at a fleet mean of ~0.01 balls per episode.
Nothing in the curriculum, the reward ladder or the mutation rate moved it.

What settled it was `probe_learnability.js`: pin the pointer heads to the
oracle, fix **one** scene, and run a plain (1+1) hill climb on the motor head
alone. It learns the entire pick-and-place in fourteen seconds — first grasp at
evaluation 74, first delivery at evaluation 1,664. The skill was never hard to
represent or hard to find. It needs on the order of a thousand evaluations
against a **stationary** objective.

A GA that redraws the exam every generation gives it sixty, and then asks a
different question. A brain that got better at generation *g*'s scene is
re-examined at *g+1* on a scene where that improvement may be worth nothing, so
progress cannot compound. From the outside this is indistinguishable from a hard
search problem — the fitness curve looks identical. It is a *non-stationary*
one.

Overfitting to a fixed bank is a real risk, and it is exactly what the held-out
exam exists to catch: that runs unseen phrasings on unseen scene seeds.

Time is a resource: 15 s to start, +7 s per correct delivery, capped at 48 s.

## The curriculum

1. **reach & place** — one ball, empty table, one legal answer. Nothing about the
   language matters yet; the population is only being paid to discover the motor
   loop.
2. **clutter** — distractor colours appear. The selector has to start reading.
3. **sets & exclusions** — counting, "everything into one bucket", colours that
   must not be touched.
4. **order matters** — alternation, strict ordering, leaving one behind. These
   come last because they are the only goals where the right action depends on
   *what the arm already did*; until deliveries happen reliably, "which ball is
   next" is a question the population has no data to answer.
5. **full bench** — every goal, six balls, sensor and servo noise.

Stages advance on a smoothed mean of correct deliveries, never a single lucky
generation.

## Evolution

Per generation, ranked by fitness: 4 elites copied untouched → mutated elite
copies → elite×elite crossovers → a rank-weighted gradient of riskier children
(mutation strength grows down the roster) → a trickle of fresh immigrants that
tapers to zero as the run matures. Crossover is **row-wise**: a whole neuron and
its bias cross as a unit, because swapping individual weights scrambles what a
neuron computes.

The three heads mutate at different strengths. The selectors are tiny and every
weight in them changes a *discrete* decision — one weight can flip which ball
the arm goes for. The motor head drives continuous setpoints through a
rate-limited servo, so a weight change mostly smears. At a single shared rate the
selectors are either frozen or thrashing, and a thrashing selector destroys the
motor head's fitness signal because it never gets to finish a reach.

**Champion grace** (default 3 generations): the reigning champion keeps an
untouched seat even when beaten, so one unlucky episode cannot erase a proven
brain.

## The held-out exam

Every 25 generations the champion runs a matched-pair exam: the same goals, once
in a *training* phrasing and once in a *held-out* one, on identical scenes. The
gap between the two is the measurement. A held-out score on its own confounds
"cannot read new wording" with "cannot do these particular goals".

## Dev

```bash
node test_headless.js        # 48 tests: referee logic, physics, arm, ledger, GA
node test_ui.js              # 22 checks: boots index.html's scripts on a stub DOM

node embed_tasks.js --model qwen3-embedding:8b --dims 16 --whiten 0.3
node train.js --gens 4000 --pop 60 --episodes 4 --workers 6
node bake_brain.js           # training/champion.json -> default_brain.js
```

### Screenshots

`?bench=N` steps the sim N times synchronously at load and draws one frame — the
only way to get a picture of the arms doing something under Chrome's
`--virtual-time-budget`, where rAF barely fires. It composes with
`pop`, `benches`, `stage`, `task`, `ref=1`, `theme=dark`, and a camera override:
`solo=1&focus=N&dist=&yaw=&pitch=`. The grid is the honest picture of what is
simulated; `solo=1&dist=1.4` is how you check the hand is drawn right.

```bash
chrome --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader \
  --window-size=1920,1200 --force-device-scale-factor=0.5 \
  --virtual-time-budget=30000 --screenshot=thumbnail.png \
  "index.html?bench=340&pop=4&benches=4&ref=1&stage=4&pitch=0.85&dist=1.65"
```

One thing to know before touching `THEMES` in `render.js`: three r128 has no tone
mapping, so a Lambert surface renders as `albedo x sum(light)` and clips. The
first version ran hemi 0.85 + sun 0.75 against a 0xfafbfc table — 1.6x on
near-white — and the table, the floor and the sky all clipped to the same pure
white. The bench looked like objects floating in a void. Albedos and light
intensities are one budget and have to be changed together.

### The four probes

Every plateau in this project looked identical on a fitness curve, and none of
them were diagnosed by staring at one. Each probe answers a question the
aggregate cannot:

| probe | question it answers |
|---|---|
| `probe_reference.js` | *Is the task possible at all?* Runs the scripted IK controller and prints its event log. |
| `probe_learnability.js` | *Is the policy representable and findable?* Pins the pointer heads, fixes one scene, runs a (1+1) hill climb on the motor head alone. |
| `probe_champion.js` | *Where does the arm stop, and is it learning or memorising?* Reports the rung each episode reaches, how often the gripper was open, and whether the pointer heads agree with the referee — split into trained missions vs unseen ones. |
| `gridsearch.js` | *Does this GA setting actually help?* A/Bs hyper-parameters on stage 1, where the language is irrelevant and only the motor loop is being measured. |

Two of those returned useful **negative** results, which is the point of having
them: mutating *less* made the population strictly worse (0.000 vs 0.075), and
the bucket decision turned out to be trivially evolvable in isolation — 100%
accuracy in 40 hill-climb steps at the current depth. Neither capacity nor step
size was the bottleneck, which is what pointed at credit assignment instead.

The **scripted reference controller** (`reference_policy.js`) is not part of the
evolved system and no brain is ever seeded from it. It exists to answer the
question that otherwise poisons every disappointing training run: *is the task
even possible with this grasp radius, this clock, this reach?*

It currently clears **73/73 balls across all seven goal kinds**, at ~1.1 s per
pick-and-place cycle. It earned its keep immediately by exposing two bugs no
unit test had:

- the gripper's collision sphere was **wider than its grasp radius**, so every
  ball squirted away just before it could be picked up — nothing could ever be
  grasped, and a GA run would just have looked mysteriously flat;
- it was itself memoryless at first, and oscillated forever between "hover" and
  "descend" because each setpoint moved the arm across the threshold that chose
  between them. Its state machine had to be *latched*. (The evolved brain gets a
  temporal window over its inputs for the same reason.)

The reference controller cheats in exactly one way, and it is worth naming: it
reads the oracle, so it always knows which ball is legal next. It never sees the
instruction. It is a lower bound on motor competence, not a solution to the
language problem — the part this project is actually about is the part it skips.

`node embed_tasks.js` writes two files: `task_embeddings.js` (80 kB, always
loaded) and `task_embeddings_basis.js` (571 kB, fetched on demand only when
someone uses the "say something new" box).

## Say something new

If you have Ollama running locally with `qwen3-embedding:8b` pulled, the left
panel takes a sentence the arm has never seen, embeds it, and projects it into
exactly the space the brains evolved in. This is the demo the whole pipeline
exists for — and the honest one, because nothing about your sentence was in the
392 the population was paid on.
