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
seven goal kinds**; 48 headless tests pass. (`test_ui.js` currently has 11
failures: the shared `shared_assets/mobile.js` layer landed after that file's
stub DOM was written and reparents elements, so its handler-binding assertions
no longer hold. The page itself is fine.)

**What the arm reads, stated plainly, because the demo invites the wrong guess.**
It is handed the position and colour of every ball and bucket by the simulator.
It has **no vision**. The wrist stereo pair (`ARM.eye`, the "Arm eyes" panel) is
a rendering of what such a camera would see and **nothing reads those pixels** —
`probe_eyes.js` exists to measure whether they could ever be enough, and says a
wrist camera sees all the candidate balls at only 28% of the moments the arm has
to choose between them. What IS genuinely learned is the mapping from twelve
numbers of sentence plus that structured state to a target choice and five servo
commands, and it holds up on sentences never trained on. The perception problem
is not solved here; it is not attempted here.

**The arm now follows instructions, and it was not evolution that taught it.**
The headline numbers, on phrasings held out of training entirely:

| | balls delivered | tasks completed |
|---|---|---|
| stock GA, 21,058 generations | 0% | 0% |
| behaviour cloning, PCA-16 projection | 66.6% | 50.4% |
| behaviour cloning, centroid-12 projection | 85.7% | 67.3% |
| \+ 2 DAgger rounds | 89.1% | 68.8% |
| **the same, retrained for the crowded bench** | **82.1%** | **55.7%** |

The first three rows are the old ~4-ball bench. The last is the shipped brain on
the bench the page actually deals — about nine balls, a target of six rather
than three — scored by `node eval_brain.js training/distilled_fullbench.json` on
a bank with a seed base the trainer never touched, ±2.0 SE. It matches the
trainer's own held-out figure (82.5% / 56.0%) almost exactly, so nothing was
inflated by the checkpoint selection. On *trained* phrasings the same brain
reaches 94.5% of balls and 80.2% of tasks.

Do not read the drop from 68.8% to 55.7% as the arm getting worse: a "task" now
means getting **six** balls right instead of three, and an all-or-nothing metric
over twice as many decisions falls even when per-ball accuracy holds. Per-ball
it is 82.1% against 89.1%. By goal kind, held out: SORT 82%, LEAVE_ONE 77%,
COUNT 77%, ALTERNATE 76%, EXCLUDE 75%, ORDER 53%, ALL_TO_ONE 35%. The two weak
kinds lean hardest on the bucket head, the least accurate of the three at ~86%.

And the thing the crowded bench was really for — **0 balls knocked off the bench
in 400 episodes**, 0.02 nudged more than 3 cm, and it leaves 3.2 balls standing
where the scripted controller leaves 3.1. It works the bench down to exactly the
balls the rule says to leave (`node probe_care.js`).

The GA number is not a typo and it is not an early reading: 21,058 generations
never left curriculum stage 1, with the best brain at 0.50 balls per episode the
entire time. This project spent a long while treating that as a search problem.
It is a **signal** problem — an episode makes roughly 900 control decisions and
returns one scalar, spread across 392 sentences and 49 goal specs — and the fix
is a per-decision teacher, not more generations. `distill.js` and
`oracle_policy.js` are that fix, and the write-ups in both files are worth
reading before changing anything there.

**Two measurements that redirected the work, both cheap and both worth
repeating before any long run:**

- `probe_ceiling.js` — the brain completes 74% of tasks worded the way it was
  trained and 54% worded a way it has not seen. Re-running the *same held-out
  goals* re-worded with a training sentence recovers essentially the whole gap.
  So the policy was never the limit; **identifying which goal it had been given
  was**. That is an embedding problem, and no amount of trainer tuning touches it.
- `probe_eyes.js` — the wrist stereo pair can see *all* the candidate balls at
  only 28% of the moments the ball selector has to choose between them. Ample
  for the motor head, not nearly enough for the pointer head.

**One more thing that will bite anyone tuning this.** The supervised losses
saturate long before training ends and then stop distinguishing anything, while
closed-loop behaviour keeps moving underneath them. Five snapshots of a single
round, at 6/10/14/18/24 epochs, scored 52.4/57.9/58.0/54.8/61.1% of held-out
tasks with motor BCE spanning 0.401–0.413 and ball-selector accuracy 98.9–99.2%.
A *separate* 18-epoch fit of byte-identical data, differing only in the order
the shuffler produced minibatches, scored 67.1%. That is not overfitting — the
curve is not monotonic and the two 18-epoch fits are twelve points apart. The
supervised objective simply has many solutions it cannot tell apart and the task
can. So `distill.js` snapshots and picks by playing the game, and `eval_brain.js`
exists because the winner of that pick needs re-scoring on a bank that took no
part in it.

**DAgger needs more than one round here, and round 1 will talk you out of it.**
Scored on a bank no brain was selected on:

| | trained tasks | held-out balls | held-out tasks |
|---|---|---|---|
| cloning only | 88.4% | 85.7% | 67.3% |
| + 1 DAgger round | 88.5% | 83.8% | 65.6% |
| + 2 DAgger rounds | **96.4%** | **89.1%** | **68.8%** |

Round 1 comes back flat-to-worse and looks like a dead end. Round 2 — the first
one run fully on-policy, with beta at 0 — is where it pays. The temptation after
round 1 is to conclude the teacher is too good for DAgger to add anything, and
that conclusion is wrong; it just needs the student's own state distribution,
undiluted, and one round of beta-mixing is still half the teacher's. Budget for
at least three rounds at 15–30 minutes each before judging it.

**The page is a playback, not a trainer.** It used to run the whole
evolutionary loop in the browser across twelve simultaneous benches. Both halves
of that were wrong once training moved offline: the loop was no longer the
story, and twelve benches actively obscured it — every bench is a different
noise draw of the *same* policy, which is a fine way to read a fleet's variance
and a useless way to see whether the arm understood a sentence. It is now one
bench and one arm, with the controls pointed at the instruction (pick a
sentence, or type your own and have Ollama embed it) and at the bench (fill,
noise, a seed you can re-deal or replay). Picking a new sentence re-deals the
*same* seed on purpose, so "does the wording change what it does?" is asked on
one table rather than on two different draws.

**The bench used to be nearly empty.** Scenes averaged 4.0 balls no matter what
the ball budget said, because `sceneRecipe` capped every colour at 1–2 — so a
"sort the green ones" scene could be two greens and a distractor and the arm was
done in three seconds. `sceneRecipe` now takes a `fill` multiplier and the
selector's slot count went 6 → 12, which costs **nothing in parameters**: the
selector is run once per slot with shared weights, so twelve slots and six slots
are the same network. At the shipped fill of 2.0 a bench holds ~9 balls and the
teacher still clears 99% of them. Two things had to move with it — the context
features were normalised by a hard-coded 6 and would have saturated, and
`distill.js` kept its own copy of the feature geometry, which went stale the
instant the sim changed shape and killed the first run with `offset is out of
bounds`. It died loudly, which was luck; a stale copy that still *fit* would
have trained silently on garbage.

**Knocking balls off the bench now costs.** `lost` was −100 against a +1400
delivery — a ruined ball priced at 7% of a good one, cheap enough that barging
through the clutter paid. It was also a cliff, paying nothing until the ball was
already gone, so there was no gradient to climb away from. `lost` is now −400
and a `shove` ratchet charges for displacing any ball the arm is *not* carrying,
saturating at 12 cm, one-way and payable once per ball so it cannot be farmed by
nudging something back and forth. It is deliberately worth less than a delivery:
an arm that refuses to touch anything scores nothing, so the cost has to be a
reason to be careful, not a reason to be still.

**What is still open:** the GA fine-tune on top of the distilled brain (the
teacher is a ceiling on imitation, not on evolution); a better projection still
(the centroid basis below was a large win and is unlikely to be the last one);
and the pixels-replace-sensors phase, which `probe_eyes.js` says needs a scan
behaviour with spatial memory or a second camera, not just an image encoder.

Everything in the sections below about *architecture and physics* is finished
work. Where a number is quoted from training it is a measurement taken along the
way, not a final result.

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


---

## The bench is solid, and it was not

Worth reading even if you only care about the learning, because the failure mode
is general: **a correct renderer drawing a broken world looks exactly like a
broken renderer.**

The report was "the claw and the arm look poorly rendered". The renderer was
innocent. It draws `f.shoulder / elbow / wrist / tip` straight from the forward
kinematics, and the FK matches an independent recomputation to 0.0 across 2,000
random poses (`audit_physics.js`). What it was faithfully drawing was an arm
halfway through the furniture.

`audit_solid.js`, over 40 episodes each:

| driver | ticks with a link inside the bench | table punch-throughs | bucket-wall punch-throughs |
|---|---|---|---|
| scripted reference | 0.0% | 0 | 0 |
| random brains | 0.0% | 0 | 0 |
| gen-224 GA champion | **22.6%** | **393** | **117** |

Deepest point: 97 mm *under* the table top. The reference controller and a fleet
of random brains never leave free space, so nothing in ordinary testing showed
it — but the GA had found the hole and moved in, because a workspace with no
bench in it is easier. Every policy evolved before this fix was a policy for a
world that was not the one being drawn.

The constraint lives in `Arm.step`: take the step, and if the new pose
penetrates a solid, **bisect back along the joint-space segment** to the last
free pose. Four details carry the whole thing:

- It is a **position constraint, not a reward**. A penalty for clipping is one
  more term in the ledger, and the fleet prices every term in the ledger.
- The solid regions are **volumes, not shells**. A joint moves up to 35 mm per
  substep; a 7 mm wall is not an obstacle to that, it is a suggestion. The bench
  is the entire half-space under the top and a bucket is a filled frustum, so
  "the new pose is not inside anything" genuinely means the move was legal.
- The start pose is always free — HOME is free and the arm only ever moves to
  free poses — so the bisection always has a free end and the arm cannot wedge.
- The **gripper joint is excluded**. Aperture is not in the FK, and freezing the
  hand because the elbow touched the bench would make "let go" unreachable at
  exactly the moment it matters.

Buckets are solid only up to `rim − 20 mm`, leaving the mouth open, because the
`release` rung pays from `g.y > rim − 0.02` upward. The check that the
constraint bites only on the degenerate behaviour is that the reference
controller is bit-identical afterwards: same 73/73, same 9,496 ticks.

The gripper was lying too, in a smaller way. The fingers reached 93 mm past the
wrist — 38 mm past the grasp point — so with a ball on the bench (centre 25 mm
up) the fingertips were 13 mm *through the table* on every single pick-up.
Finger length is not a styling choice; it is `graspOffset + BALL_R`. And a real
gripper closing on a ball stalls on the ball, so the drawn jaw span is floored at
the ball's radius while holding, instead of drawing pads 6 mm inside the object
they are supposedly gripping.

---

## Teaching, because evolving did not work

`train.js` ran **21,058 generations** and never left stage 1: best 0.50 balls per
episode, held-out phrasings 0%. That is the end of the argument, not a snapshot
of a bad afternoon.

The diagnosis is signal, not search. An episode makes roughly 900 control
decisions and about 20 selector decisions, and returns **one scalar**, spread
over 392 sentences and 49 goal specs. Selection cannot see which decision was
the good one. When the per-decision count sits three orders of magnitude above
the per-episode signal, the answer is a teacher.

### The teacher has to be memoryless

`reference_policy.js` solves the task and **cannot be the teacher**. It is a
latched state machine, so its action is a function of (world, which rung it
happens to be on) — and that second argument is history. The student's motor
head is a function of the world alone. Labelling with a latched teacher hands
the network two different answers for the same input ("descend" and "hover" at
the same pose, depending on what happened thirty ticks ago) and asks it to fit
both.

`oracle_policy.js` re-derives the same behaviour as a pure function of state.
The reference controller's own header says this is impossible — a memoryless
hover/descend rule oscillates, because the arm's response keeps re-crossing the
threshold that selects the mode. That is true of any **threshold** and false of a
**funnel**:

```
y* = ball.y + HOVER · min(1, (flat / ALIGN_R)²)
```

There is no mode to flip between; badly aligned is high, well aligned is low, and
everything in between varies smoothly.

**The funnel must be quadratic in the ERROR, not in the alignment**, and the
first version got this backwards. Written as `HOVER·(1 − align²)` with
`align = 1 − flat/ALIGN_R`, it is *linear* near the ball with slope 2.8, so the
distance to the ball bottoms out at 2.97 × flat and never enters the 25 mm grasp
radius unless the arm is already within 8.5 mm horizontally. That version scored
46/73 and produced a different-looking failure every time. Squaring the error
makes the residual hover 18.7 × flat²: **72/73, and faster than the latched
controller** (4.3 s against 5.2 s).

The rest of the machine's memory dissolves on inspection. `anchor` — the point to
lift straight up from — is just where the hand already is, because the held ball
*is* at the grasp point. The hover/lift/traverse/release ordering is recoverable
from `held` plus height. The carry needs the same funnel treatment: blend the
horizontal target by how much rim clearance the hand has, rather than switching
on it.

### One teacher is not enough, even a perfect one

Ball positions are drawn fresh every episode and the controller re-solves from
the live scene each tick, so spawn variety is free — it is a closed loop, not a
replayed trajectory. That is not the problem. The problem is that one
deterministic controller draws one *thread* through state space: same approach
direction, same cruise height, same release radius. A student fitted to that
thread has never seen the arm 4 cm off the approach line, which is precisely the
situation it creates for itself the moment it is left to drive.

Both halves of the answer are needed. **DAgger** supplies off-thread *states* —
the student drives, gets into its own mess, and the teacher says what to do from
there. **`makeOraclePolicy({rng})`** supplies off-thread *behaviour* — the
approach geometry is re-drawn per episode and the servo command is jittered, so
the student is fitted to a family of competent policies rather than one groove.
Diversity has to stay inside the box where the teacher still *works*: a teacher
that sometimes fails is not diversity, it is mislabelled data.

### Three heads, three kinds of supervision

- **`ballSel` and `bucketSel` get exact labels** from `Station.oracle()`, which
  knows the legal next ball and its bucket. The language half of the project
  stops being something inferred from a delivery count and becomes labelled
  classification.
- **`motor` is imitation** of the teacher's five servo commands.

Two rules that are easy to get backwards, and both are the difference between
DAgger working and DAgger going downhill:

- **Label the motor against the SELECTED ball, never the oracle's.** The motor
  head cannot see the instruction; all it sees is "there is a target at this
  offset", so its job is "go to the target you were given", unconditionally. If
  the selector points at the wrong ball and the motor is labelled toward a
  different one, the network is being asked for two outputs from one input.
- **A selector target is a SET.** When the right answer is "do nothing" — which
  leave-one, count and exclude all need — *any* empty slot is correct, and there
  are usually several. Demanding one particular empty slot asks the network to
  tell identical all-zero inputs apart.

And one that cost a whole round: **a teacher's "no opinion" must survive as no
opinion.** `Station.oracle()` returns `bucket: -1` when idle or holding a ball it
should not have. Coercing that to bucket 0 so the caller always has a number
fabricates a label — "the right answer here is the red bin" — for every tick
where there is no right answer. It is invisible while the teacher drives, which
barely idles; the moment the student drives, episodes stretch from 66 control
ticks to 151 and most of the extra ticks are exactly that dithering. Held-out
task completion went 44.6% → 31.6% in one round and ALL_TO_ONE, decided by that
head alone, fell 38% → 4%. It reads as "DAgger does not work here". It is one
coerced `−1`.

Relatedly: **episode length correlates with failure, so an uncapped buffer is
biased toward it.** A confident policy finishes fast and contributes few samples;
a confused one runs the clock out and contributes hundreds. Those states are
worth learning — that is the point — but not at nine times the weight of a state
on a successful delivery.

---

## The projection was the ceiling

`probe_ceiling.js` asks a question worth asking of any conditioned policy: when
it fails on an unseen instruction, did it not *understand* the instruction, or
not *execute* it? Run the held-out sentences, then run the same held-out **goals**
re-worded with a phrasing from the training split. Same scenes, same seeds, same
brain; only the vector changes.

```
trained sentences, own vector                  83.5% balls   71.6% tasks
HELD-OUT sentences, own vector                 74.7% balls   53.8% tasks
HELD-OUT goals, worded from the train split    83.9% balls   74.0% tasks
```

Re-wording recovers the entire gap. **The policy was never the limit; telling the
goals apart was.** And 53.8% sits right on the embedding's own held-out
exact-spec recovery of 54%, which is the corroboration rather than a coincidence.

Sweeping dims and whitening did not help — 16 dims was already the best PCA
operating point available, and wider projections just trade colour recovery for
rule-kind recovery. The problem is not the width, it is what the basis is fitted
to. **PCA is unsupervised**: it keeps the directions along which *sentences* vary
most, and most of the variance between two sentences is wording — the exact
thing the arm is supposed to ignore.

`--proj centroid` fits the basis to the **49 spec centroids** instead: the mean
vector of each goal's training phrasings. Directions along which the centroids
spread are directions that separate goals, and directions along which phrasings
of one goal disagree get averaged away before the basis is fitted rather than
competing for components. It is the between-class half of a linear discriminant —
and the half that can be estimated honestly here, since a full LDA also wants a
4096-dimensional within-class scatter out of 392 points, which is not a
measurement but a wish.

| projection | exact spec | rule kind | colours |
|---|---|---|---|
| PCA, 16 dims (the old default) | 53.7% | 63.3% | 86.2% |
| **centroid, 12 dims** | **73.5%** | **81.6%** | **95.2%** |

Every metric improves at once, which is unusual enough to be worth stating
plainly — the dims/whiten sweep only ever bought one at another's expense. The
held-out split is untouched by the change: centroids are built from training
phrasings only, so recovering a held-out sentence is still a real generalisation
test.

---

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
