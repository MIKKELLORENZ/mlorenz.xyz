/* walker.js — one humanoid: what it feels, what it commands, what it scores.
 *
 * Control loop is 50 Hz (the network) over a 500 Hz physics tick, which is the
 * split a real humanoid runs: a slow policy issuing joint *targets*, and a fast
 * servo loop turning those into torque. The network never commands torque
 * directly. That single choice is what makes this learnable by mutation alone —
 * a random network commands "stand roughly still", not "fire every actuator
 * flat out", and small mutations move the posture rather than the thrash.
 *
 * The brain sees a TEMPORAL WINDOW: each channel is fed as its last DEPTH[ch]
 * control ticks, newest first, so rates and trends (loading rate under a heel,
 * the swing of a bearing, gust onset) are readable without any recurrence.
 * Lag-0 of every channel comes first, so channel c is always inputs[c].
 *
 * Channels (NC = 32 + 3·NJ = 92)              Outputs (NJ + 11 = 31, sigmoid 0..1)
 *   C_GRAV      3   gravity direction            0..NJ-1  target angle per joint,
 *   C_GYRO      3   pelvis angular rate                   mapped to nominal ± range
 *   C_VEL       3   pelvis velocity              C_CADENCE  gait clock, 0.55–1.7x
 *   C_HEIGHT    1   pelvis height / standing     O_AMP    5 rhythm amplitude, per group
 *   C_UPRIGHT   1   torso uprightness            O_PHASE  5 rhythm phase, per group
 *   C_QA       NJ   joint angles, normalised
 *   C_QD       NJ   joint rates
 *   C_LOAD      2   L/R foot load, fraction of weight
 *   C_CONTACT   2   L/R foot contact flag
 *   C_FOOTPOS   6   L/R foot position rel. pelvis
 *   C_WPDIST    1   distance to the waypoint
 *   C_WPBEAR    2   sin/cos of the waypoint bearing
 *   C_GAIT      2   gait phase sin/cos
 *   C_TERRAIN   4   terrain height 0.35–1.4 m ahead
 *   C_WIND      2   wind direction x strength
 *   C_EFFERENCE NJ  the action issued last tick
 *
 * Every offset after C_QA is DERIVED from NJ. They used to be literals, and the
 * day the body gained a joint the network began reading joint rates where it
 * expected foot load, silently, with no error anywhere.
 *
 * WHY THERE IS A RHYTHM LAYER AT ALL. A feedforward network reading a mostly
 * static posture settles to a fixed point, and a fixed point is a walker
 * standing still. Measured, and this is the single most important number in the
 * file: 120 random brains produced a best forward progress of 2 cm and a median
 * of exactly 0.00 m. Not "small" — zero. Selection had literally nothing to
 * grip, which is why the first hundred generations went nowhere. Widening the
 * output-layer init to add posture variety did not help either; it just toppled
 * everyone (99% -> 3% able to stand) while progress stayed at zero.
 *
 * So the leg joints get a rhythm term the network *modulates* rather than
 * generates: target = network offset + A·sin(gait phase + φ), with A and φ
 * network outputs and left/right locked in anti-phase. This is a central pattern
 * generator, the arrangement real legged robots use, and it is a substrate not a
 * script — A starts at zero for every newborn (so they still just stand), and
 * the network has to discover that oscillating pays, pick an amplitude and a
 * phase offset for each joint group, choose a cadence, and layer balance
 * corrections on top. What it buys is that ONE mutation can now produce a step,
 * instead of needing a hundred coordinated ones.
 *
 * Signs follow the body frame throughout: +X forward, +Y up, +Z left.
 */
"use strict";

const DT = 1 / 500;                 // physics tick
const CONTROL_EVERY = 10;           // -> 50 Hz control
const CTRL_DT = DT * CONTROL_EVERY;

/* Ground contact, per point.
 *
 * Normal: Hunt-Crossley, fn = KN·d·(1 + HC·closing speed), not the more obvious
 * KN·d - CN·v. A linear damper is discontinuous at the moment of separation — it
 * still pulls while the foot is already lifting, gets clamped to zero, and the
 * foot chatters in and out of contact at ~20 Hz. Measured: a walker just holding
 * its nominal pose spent 25% of its time airborne and skated backwards at
 * 17 cm/s. Scaling the damping by penetration makes the force vanish smoothly as
 * the foot leaves, and the chatter goes with it.
 *
 * Tangential: a stick spring anchored where the point first landed, yielding at
 * the Coulomb limit. This is what gives honest *static* friction — a purely
 * viscous tangent lets a standing walker creep, and creeping is a free ride the
 * fitness function would happily pay for. */
const CONTACT = {
    KN: 120000,     // N/m per point
    KN_SELF: 30000, // N/m, limb against limb — a limit stop, not a floor
    HC: 2.5,        // s/m — Hunt-Crossley damping, scaled by penetration
    KT: 40000,      // N/m tangential stick spring
    CT: 300,
    // Bounds on the normal law. See the long note at the force itself for the
    // measured justification; both are statements about what a contact can
    // physically do, not tuned thresholds.
    VN_MAX: 2.0,    // m/s — approach speed the damping term is extrapolated to
    F_MAX_BW: 15    // x body weight, at a SINGLE point
};

/* Perturbations and sim-to-real. Deliberately mild: the point is a gait that
 * does not depend on the simulator being exact, not a gait that can survive a
 * hurricane. Too much noise and nothing is selectable at all. */
const SIM2REAL = {
    sensorNoise: 0.015,     // gaussian, on the normalised channels
    actionNoise: 0.020,
    torqueJitter: 0.02,
    servoLag: 0.055,        // s, first-order on the commanded target
    // rad/s ceiling on the fastest joint's setpoint travel. A real actuator has
    // a finite no-load speed; without one the servos could walk the whole body
    // from a folded squat to standing inside 0.1 s and launch it off the floor.
    // Generous enough for a brisk stride (a swing leg needs ~4 rad/s), tight
    // enough that standing up has to be driven rather than sprung.
    setpointSlewMax: 7.0
};

/* Divergence guard rails. Each is a bound on what this body can physically do,
 * not a tuned threshold — see the comment at the check itself for why these
 * three and not others. DIVERGE_FORCE is expressed in body weights and resolved
 * against the model's own weight where it is used. */
const DIVERGE_VH = 5.0;             // m/s of HORIZONTAL travel; the champion does under 1
const DIVERGE_SPIN = 25.0;          // rad/s, four revolutions a second
const DIVERGE_FORCE_BW = 20;        // x body weight; a tripwire ABOVE the contact cap

/* The mechanical end stop, as a stiff spring-damper in torque. See the long note
 * at the point of use. Swept over k = 2000/6000/15000: 2000 lets joints ride
 * 0.05 rad past the limit, 15000 starts costing fitness, 6000 is the best of the
 * three on waypoints and fitness alike. */
const JOINT_STOP_K = 6000;          // N·m/rad
const JOINT_STOP_C = 60;            // N·m·s/rad, only while driving further in

const GAIT_HZ = 1.05;               // base cadence of the internal clock

/* Knobs the grid search is allowed to move. They live in one object so a sweep
 * can set them without editing the file, and so what was swept is recoverable
 * from the run that used it. */
const TUNE = {
    cpgScale: 1.0,      // multiplier on every rhythm amplitude ceiling
    servoScale: 1.0     // multiplier on every joint stiffness
};
function setTune(o) { Object.assign(TUNE, o || {}); }

/* Fitness weights.
 *
 * The shape here matters far more than the numbers, and it is the thing that
 * took longest to get right. The obvious design — pay a walker for every tick it
 * spends upright — produces a population that stands perfectly still forever and
 * never takes a step. Measured: it plateaued at 5,260 points inside 20
 * generations and sat there for the next hundred, because 11 seconds of flawless
 * standing was worth exactly 5,260 and a first tentative step was worth about 50
 * points minus a fall.
 *
 * So each stage pays *income* only while it is the frontier, and converts to a
 * one-off *bonus* once it is banked:
 *
 *   POSTURE       paid only during the 2.5 s stand phase      -> caps near 600
 *   STAND_BONUS   one-off, the first time it holds full height
 *   UPRIGHT       paid only during the 2.5 s balance phase    -> caps near 500
 *   BALANCE_BONUS one-off
 *   ALIVE_WALK    a thin trickle during the walk phase: enough that being
 *                 careful is not punished, too thin to live on
 *   PROGRESS_PER_M the real income from there on — metres of closure toward the
 *                 waypoint, credited only while upright and only when it beats
 *                 the closest approach so far, so it cannot be farmed by rocking
 *                 back and forth over the same metre
 *
 * The weights are then set from one arithmetic check, not by taste. Standing
 * still for the whole 17 s clock scores ~2,150. Half a metre of honest walking
 * followed by a fall scores ~2,220. Break-even therefore sits at HALF A STEP,
 * which is the shortest first step evolution can plausibly stumble into. At the
 * earlier PROGRESS_PER_M of 500 the break-even was a full metre and the
 * population correctly refused to try. Diving forward to farm the metres does
 * not pay either: a dive buys ~0.4 m and ends the episode, scoring below the
 * stander it replaced.
 *
 * Scale reference: a waypoint is worth ~1,200 plus its metres, so no penalty may
 * total more than that. A walker must never profit from giving up on a leg.
 *
 * ------------------------------------------------------------------------
 * EVERY RUNG HAS TO STOP PAYING. The rule above is easy to state and easy to
 * violate by omission — two terms were added later without a cap and quietly
 * became the thing the population optimised.
 *
 * Measured on a champion at generation 141, by zeroing one term at a time and
 * re-running the same seven missions (the brain is fixed and the physics never
 * reads FIT, so the episode is identical and only the ledger moves):
 *
 *     STAND_BONUS    600  18.4%      PROGRESS_PER_M  399  12.2%
 *     BALANCE_BONUS  500  15.3%      STEP            311   9.5%
 *     PUSH_BONUS     450  13.8%      ALIVE_WALK      281   8.6%
 *     POSTURE        372  11.4%      STRIDE_PER_M    145   4.4%
 *     UPRIGHT        314   9.6%
 *
 * Sixty-nine percent of the score came from terms that do not require the
 * walker to move, and the single term that pays for distance covered per step
 * was the smallest line on the sheet. The walker this produced stands for
 * 13-17 s, takes seven or eight genuine steps, and travels 0.26 m. It marches
 * on the spot, because on this sheet marching on the spot is what pays.
 *
 * Two terms were at fault, and both for the same reason:
 *
 *   PUSH_BONUS was uncapped. Shoves keep arriving every few seconds through
 *   stages 2-5, so it is unbounded income that scales with episode length, and
 *   it is paid for being a rock — a walker in motion is far easier to topple,
 *   so it is precisely a subsidy against walking. Now capped at the first two,
 *   which is enough to teach the skill.
 *
 *   STEP was capped at twenty, which sounds bounded but is not: twenty flat
 *   bonuses is 500 points for lifting a foot twenty times, and the champion's
 *   steps carried it about 1.5 cm each. Flat STEP was out-earning real stride
 *   311 to 145. Lifting a foot is the RUNG between standing and walking, so it
 *   should pay like a rung — capped at eight — and everything past that has to
 *   come from how far the foot actually travelled.
 */
/* ---------------------------------------------------------------- THE LADDER
 * What the flat-vs-tiered A/B actually settled, measured on held-out missions:
 *
 *   flat      0.20 m walked, 12.5 steps, 0.45 m stride  — marched on the spot
 *   tiered-v1 0.35 m, 1.0 steps, upright 4.4 s, down 10/10 — dove for the metres
 *   tiered-v2 0.11 m, 6.7 steps, upright 15.9 s, down 1/10 — stood still
 *
 * Bounding PROGRESS was the wrong end. Spread over a 1.3-2.3 m leg it pays
 * 306 points a metre where flat pays 900, and the population lives on its first
 * twenty centimetres, where the local gradient is the only thing that exists.
 * Progress was never too strong — STANDING was. So the rate stays at 900/m and
 * the STANDING block comes down by 0.30 instead, with a per-leg ceiling just
 * under one arrival to keep the top of the order intact.
 *
 *   rise      ≤  620   COM_RISE_CAP + RECOVER
 *   stand     ≤  741   a perfect statue, whole clock
 *   walk/leg  ≤  960   full gradient the entire way, then it stops
 *   arrive      1200   uncapped in count
 *
 * Each rung is worth less than the whole of the one above, which is the only
 * property that makes the sum express an order rather than an exchange rate.
 */
const FIT = {
    POSTURE: 72,         // per second, stand phase only
    STAND_BONUS: 180,    // one-off, first time it holds full height upright
    UPRIGHT: 60,         // per second, balance phase only, only after standing
    BALANCE_BONUS: 150,  // one-off, held the stand for BALANCE_HOLD seconds
    PUSH_BONUS: 45, PUSH_CAP: 2,   // survived a shove — the first two only
    ALIVE_WALK: 8,       // per second during the walk phase
    STEP: 25, STEP_CAP: 8,    // a foot genuinely lifted, swung and re-planted
    STRIDE_PER_M: 500,        // …times how far forward it actually landed
    STRIDE_MAX: 0.45,         // m, per step — beyond this it is a lunge, not a stride
    PROGRESS_PER_M: 900,      // metres of closure toward the current waypoint
    ARRIVE: 1200,
    /* Speed is the tie-break between two walkers that both arrive: worth a
     * quarter of an arrival, so it can separate equals without ever tempting a
     * walker to trade a waypoint for haste.
     *
     * It used to decay over 8 s of absolute leg time and was therefore dead:
     * measured legs take ~21 s (the best champion covered 19 m in 130 s), so
     * every arrival scored max(0, negative) = 0 and the incentive never existed.
     * Two changes. The reference is now a CLOSURE SPEED, not a time, because
     * legs run 1.3-4.4 m and a fixed deadline makes a short leg trivially fast
     * and a long one impossible. And the scale sits near what a good walker
     * actually manages, so the gradient is live rather than saturated. */
    ARRIVE_SPEED: 300,        // full bonus at ARRIVE_SPEED_REF m/s of closure
    ARRIVE_SPEED_REF: 0.55,   // m/s — roughly 3x the current champion's 0.15
    TERRAIN_BONUS: 250,  // per arrival, x terrain difficulty
    WIND_BONUS: 250,     // per arrival, x wind fraction
    /* A flat fall penalty cannot tell a controlled sit-down from going
     * head-first into the floor, and those are not the same event — not to
     * hardware, and not to a reward that has to rank two walkers who reached
     * the same waypoint and then both went down. Severity is the torso's speed
     * at the moment of collapse: free below FALL_FREE_SPEED, then linear.
     *
     * The base has to stay SMALL and the multiplier do the work. Early walkers
     * fall constantly, and a large flat penalty prices exploration out of the
     * search entirely — which is how a population talks itself back into
     * standing still. A gentle topple should cost about a step; a dive should
     * cost more than the closure a dive can possibly buy. */
    // -100 made diving profitable under the flat rate: 0.5 m of closure bought
    // 450 and the landing cost 355, so pitching forward beat walking and every
    // held-out mission ended in a fall. The landing must outprice the closure it
    // can buy — see the dive test, which priced this against the tiered rate and
    // so passed vacuously while the flat model trained on the exploit.
    FALL: -180,
    FALL_FREE_SPEED: 0.8,     // m/s — at or below this it is a sit-down
    FALL_SPEED_W: 1.5,        // extra multiples of the base, per m/s above free
    FALL_MAX_MULT: 6,
    /* Getting up. A fall is no longer the end of the episode: the walker stays
     * in it and has to recover, which is the rung below standing and the one
     * that decides whether any of this could survive contact with a real floor.
     *
     * RECOVER must be worth less than a typical fall costs, or falling on
     * purpose becomes a way to farm it. Base fall is 100 and a real topple runs
     * 150-350 with severity, so 120 leaves the round trip firmly negative while
     * still making "get up" strictly better than "lie there", which is the
     * ordering that matters. The cap is what stops a rocking walker banking it
     * five times in one episode. */
    RECOVER: 120, RECOVER_CAP: 4,
    COM_RISE_PER_M: 700,      // directional: per metre of NEW best height
    COM_HOLD: 90,             // dense: per second, scaled by how high the mass is
    COM_RISE_CAP: 500,        // …both together, capped per episode
    /* Floor of the rise GATE, in fitness()'s multiplier. A walker that never
     * lifts its mass keeps this share of what it earned on a floor start; one
     * that reaches standing height keeps all of it. 0.45 rather than 0 on
     * purpose — at zero, an episode that fails to rise scores nothing at all and
     * the gradient along "walked a bit while still down" disappears with it,
     * which is the gradient a fresh brain has to climb first. */
    RISE_GATE: 0.45,
    ENERGY_W: 0.05, ENERGY_CAP: 300,
    /* Effort spent while DOWN is metered at a fraction of the walking rate.
     * Measured over 40 floor starts: the busiest quarter of walkers paid -271 in
     * energy against a rise ladder capped at 500, the quietest paid -85, and the
     * busiest quarter finished BELOW the quietest (-6 against +78) despite
     * earning 2.5x the ledger and lifting the mass 30 cm higher. The meter is
     * calibrated for a gait, where thrashing is waste; on the floor thrashing is
     * the behaviour being asked for, and pricing it as waste points the gradient
     * at "give up". Not zero, so a walker still cannot buy anything by flailing
     * in place — flailing earns nothing unless the mass actually rises. */
    ENERGY_DOWN_W: 0.25,
    WANDER_W: 60, WANDER_SLACK: 1.4, WANDER_CAP: 400,
    WALK_LEG_CAP: 960,        // just under one arrival, so arriving always wins
    WALK_SHAPE_CAP: 250,      // steps and stride are the rung below closure
    WALK_PROGRESS_LEG: 0,     // 0 = pay PROGRESS_PER_M per metre — full gradient
    /* Heading alignment: does the pelvis POINT at the waypoint while closing on
     * it? 0 disables, which is the default so every earlier run reproduces.
     *
     * The champion this was written for closes distance by crab-walking — it
     * translates sideways with the pelvis square to the path. Closure alone
     * cannot see the difference, because a metre gained sideways and a metre
     * gained forwards are the same metre. On flat ground that is merely ugly;
     * on stairs and slopes it is fatal, because a foot placed across the fall
     * line has no stride to recover with and the swing leg clips the riser.
     *
     * Deliberately a MULTIPLIER IN [1-w, 1] on closure income, not an additive
     * bonus, for two reasons. It cannot be farmed — a walker standing still and
     * pirouetting to face the waypoint earns exactly nothing, because zero
     * closure times any multiplier is zero. And it leaves every tier bound in
     * the table above untouched: the maximum any walker can earn is unchanged,
     * so the lexicographic ordering (waypoints > walking > standing) that the
     * whole ledger rests on cannot be perturbed by tuning this.
     *
     * It is therefore exactly a tie-break: of two walkers that close the same
     * distance, the one facing where it is going banks more of it. */
    HEADING_W: 0
};

/* ---------------------------------------------------------------- the tiers
 * A weighted sum cannot express a hierarchy. It says every rung is
 * EXCHANGEABLE at a fixed rate, so enough standing always buys a waypoint's
 * worth of score, and evolution pays that exchange rate every time because
 * standing is the cheaper currency to mint. Measured on the gen-161 champion
 * of a real run: standing 2036, walking 1003, arriving 100 — a perfect stander
 * outscoring a walker that reaches a waypoint, which is the intended ordering
 * upside down.
 *
 * A sum CAN express a hierarchy under one rule: each tier's maximum total must
 * be smaller than one unit of the tier above. Then the argmax of the sum is the
 * lexicographic order — waypoints, then walking, then standing — while the
 * score stays a single smooth scalar a hill-climb can follow.
 *
 *   tier            budget    one unit of the tier above
 *   ------------------------------------------------------
 *   stand+balance   ≤  636    0.78 m walked = 700
 *   walk, per leg   ≤  700    one arrival   = 1200
 *   arrive          uncapped
 *
 * The standing terms are scaled by one common factor rather than retuned
 * individually, on purpose: their ratios to each other are what teaches stage 1,
 * and scaling the whole tier leaves those ratios untouched. All that changes is
 * the exchange rate with the tiers above.
 *
 * ALIVE_WALK is counted against the STANDING budget, not the walking one. It
 * pays for being upright during the walk phase, which is a thing a statue does
 * perfectly; only closure, stride and steps are walking.
 */
/* A budget is not a truncation. The first version of this capped walk income at
 * a flat 700 while progress still paid 900 per metre, so the gradient died at
 * 0.78 m — and the first waypoint is 1.3-2.3 m away. A walker that had closed
 * half the distance was paid nothing for closing the rest, which is the exact
 * moment it most needs to be pulled forward. Measured: 100 generations reached
 * best-walked 0.53 m against the flat model's 1.24 m.
 *
 * So the budget is SPREAD over the leg instead. Progress pays
 * WALK_PROGRESS_LEG × (closure / legInitDist), so closing the whole leg is worth
 * the whole budget whatever its length, and the gradient is uniform right up to
 * the waypoint. The ordering is preserved because the TOTAL is still bounded —
 * which was the only thing the cap was ever for.
 */
const TIERED = {
    POSTURE: 36, STAND_BONUS: 90, UPRIGHT: 30, BALANCE_BONUS: 75,
    PUSH_BONUS: 22,           // ×2 shoves
    ALIVE_WALK: 5,            // standing-tier income, ~69 over a full walk phase
    WALK_PROGRESS_LEG: 550,   // the whole leg's closure, however long the leg
    WALK_SHAPE_CAP: 150,      // STEP + STRIDE, the rung below closure
    WALK_LEG_CAP: 700         // backstop on the two together
};
const FLAT = {};              // the pre-tier values, captured below for the A/B
for (const k of Object.keys(TIERED)) FLAT[k] = FIT[k];

/* Swap reward models. Called by the trainer and the browser before a run; the
 * physics never reads FIT, so this changes the ledger and nothing else. */
function setReward(model) {
    Object.assign(FIT, model === "tiered" ? TIERED : FLAT);
    FIT.model = model === "tiered" ? "tiered" : "flat";
}
FIT.model = "flat";

const STAND_HOLD = 0.6;             // s at full height before "stood" is credited
const BALANCE_HOLD = 2.0;           // s upright after standing before walking scores
/* How long a new maximum COM height must be SUSTAINED before the rise ratchet
 * pays for it. Short enough that a real rise never notices — it passes through
 * each height on the way up and stays — and long enough that a flail cannot
 * collect on a height it merely touched. */
const RISE_CREDIT_HOLD = 0.20;   // s
const RISE_HOLD = 0.35;             // s upright at height before a recovery counts
const COM_PEAK_DECAY = 0.6;         // m/s — how fast the "fell from" height forgets
const DOWN_TIMEOUT = 6.0;           // s face-down with no progress before we stop simulating it

/* Sensor channel layout and per-channel history depth. */
/* Built from HUMANOID.nj rather than written out, because it was written out:
 * three blocks of eighteen literals, and adding a joint to the body silently
 * left the network reading the wrong channel for everything after it. The
 * layout is the same, the joint count is now derived. */
const NJ = HUMANOID.nj;

/* ================= DIFFERENCED WINDOWS, replacing six ad-hoc lag ladders ====
 *
 * WHAT WAS HERE. Six hand-assigned sets — L0, L_FAST [0,1,2,4], L_MID [0,2,4],
 * L_LONG [0,2,8], L_EVENT [0,2,4,8] and an eleven-tap L_MOMENTUM reaching 600 ms
 * on one channel — with no principle connecting them. Joint angles got 40 ms and
 * joint rates 80 ms, and nothing recorded why those differ. Everything except
 * COM velocity stopped at 160 ms.
 *
 * WHY IT WAS REPLACED, and this is the part that matters: those were RAW LAGGED
 * SAMPLES. For a channel that varies slowly, the reading at lag 30 is nearly the
 * reading at lag 0 — so the input is close to a duplicate of one the network
 * already has, and a GA has no reason to spend weights on a duplicate. Ablation
 * agreed and was blunt about it: zeroing all 30 of COM velocity's history inputs
 * left the walker at 3.17 m against 3.17 m intact, while a random 30-input
 * lesion left 0.09-0.23 m. The whole 160-600 ms band measured the same way. The
 * information was not useless; the ENCODING carried no marginal information.
 *
 * So every tap is now a DIFFERENCE against a window mean:
 *
 *     tap = clamp((now - mean(channel over window W)) * gain, -1.5, 1.5)
 *
 * which is a contrast, which is what control actually needs — "am I higher than
 * I was", not "what was I". It is centred near zero, suiting tanh units and the
 * small output init. Its correlation with lag 0 is subtracted out, so the input's
 * dynamic range carries novelty instead of re-encoding the present. And a boxcar
 * over N samples has roughly sqrt(N) less noise than the single 20 ms snapshot it
 * replaces. On the contact booleans it falls out for free: now - mean(W) is the
 * fraction of that window the foot was NOT down, i.e. touchdown recency.
 *
 * The windows are DISJOINT. Three nested or exponentially-weighted averages are
 * heavily correlated with one another, so each extra input would mostly repeat
 * the previous one; disjoint eras are close to independent, which is what makes
 * three inputs worth three inputs. */
const WIN = [[1, 3], [4, 15], [16, 60]];    // control ticks at 50 Hz
const NWIN = WIN.length;
const WIN_MS = WIN.map(w => `${w[0] * 20}-${w[1] * 20} ms`);
/* One deeper than the deepest window: the rolling sum shifts by adding the frame
 * entering at lag WIN[i][0] and removing the one leaving at lag WIN[i][1] + 1, so
 * that departing frame has to still be in the ring when it is read. */
const MAXHIST = WIN[NWIN - 1][1] + 2;       // 62

/* Which windows a channel gets. T_STD is the full three, reaching 1200 ms.
 * T_LITE is the middle window alone and exists purely for budget: the joint
 * angle, joint rate and efference blocks are 66 channels between them, and three
 * windows each would be 198 inputs — more than half the vector for one third of
 * the sensors. One window still takes them from 40-80 ms to 300 ms of reach. */
const T_STD = [0, 1, 2];
const T_LITE = [1];
const T_NONE = [];


/* ------------------------------------- foot-referenced terrain perception
 *
 * The walker learns rolling terrain and cannot learn stairs — 7-9 waypoints on
 * one, 0-1 on the other, every run, no overlap. That is not a training-time
 * problem, it is an OBSERVABILITY problem: a stair was never in the inputs in a
 * frame the answer lives in.
 *
 *   · The old four probes sample a line ahead of the PELVIS. The swing foot
 *     travels +/-0.4 m longitudinally and +/-0.15 m laterally relative to the
 *     pelvis and does not travel along the heading. Those probes answer a
 *     question no foot is asking.
 *   · The LiDAR encoded proximity ALONG A RAY. Recovering "how high is the
 *     ground there" means composing the ray direction — which is not an input,
 *     it is implicit in which weight slot the value lands in — with the
 *     distance, a nonlinear reconstruction spread over 80 channels. A GA will
 *     not find that.
 *
 * So two states with identical readings needed different actions depending on
 * where the tread edge sat relative to the swing foot. Ambiguous, not hard.
 * Generations do not fix an unobservable.
 *
 * THE BUDGET IS WHAT SHAPES THIS. Hidden layer 1 is 48 wide, so every input
 * costs 48 weights and the input layer is most of the genome. Under gradient
 * descent, feeding 1024 raw map cells is free — backprop builds the
 * representation. Under selection it is fatal. So this foveates: fine
 * resolution under the feet where the answer is, coarse at range where only
 * route shape matters.
 */
const PATCH_N = 5;                  // 5x5 cells per foot
const PATCH_SPACING = 0.09;         // m — 5 x 0.09 = 0.36 m, about one 0.34 m tread,
                                    // so a riser is always somewhere inside the patch
const PATCH_FWD = 0.12;             // m — bias the patch toward where the foot is going
const PATCH_CELLS = PATCH_N * PATCH_N;
const PATCH_OFF = (() => {
    const a = new Float64Array(PATCH_N);
    for (let i = 0; i < PATCH_N; i++) a[i] = (i - (PATCH_N - 1) / 2) * PATCH_SPACING;
    return a;                       // -0.18 .. +0.18; with PATCH_FWD, -0.06 .. +0.30 ahead
})();
/* Heights are referenced to a SHARED datum — the ground under the LOWER foot —
 * and divided by a FIXED 0.5 m, never auto-scaled to what is in view.
 *
 * Shared, because a self-referenced patch cannot tell that one foot is a step
 * above the other, which is the entire state of being mid-stair. The lower foot
 * rather than the stance foot keeps the datum defined and continuous when both
 * feet are airborne, and puts no discontinuity at a foot swap.
 *
 * Fixed scale, because a 0-1 normalised image makes a 0.17 m riser read as a
 * different number depending on what else is nearby. Divided by a constant, a
 * riser is always the same number. */
const DATUM_SCALE = 0.5;
const CLEAR_SCALE = 0.30;           // foot ground clearance
const ATT_SCALE = 0.6;              // ~34 deg of sole-vs-surface angle
/* Central difference, 0.05 m. NOT an analytic derivative of the noise function:
 * the height field is composed from several terms and the render mesh has
 * already disagreed with a sampler once in this project. */
const NORMAL_STEP = 0.05;
/* ------------------------------------------------- the terrain ring
 *
 * This replaces a forward-only fan of 4 distances x 5 lateral offsets. The fan
 * looked ahead and nowhere else, +/-0.5 m wide, and from stage 3 roughly a third
 * of the legs double back — so whenever the course asked the walker to turn, it
 * turned onto ground it had never seen. The gap was coverage, not resolution.
 *
 * A uniform 1 m grid is not affordable. Hidden layer 1 is 48 wide, so every input
 * costs 48 weights and the input layer is already most of the genome; a 10 cm
 * grid over a 1 m disc is ~314 cells and would roughly double it. Under gradient
 * descent that would be free — backprop builds the representation — but under
 * selection every weight is search space.
 *
 * So it foveates in ANGLE the way the foot patches foveate in space: three rings
 * out to 1 m, twelve compass directions, 36 samples for full surround at 30
 * degrees. Referenced to the ground under the pelvis, like the fan it replaces,
 * because its job is route shape — "the ground rises ahead and to the left".
 * Stairs remain the foot patches' job. */
const RING_R = [0.35, 0.65, 1.00];
const RING_DIRS = 12;
const N_FAN = RING_R.length * RING_DIRS;
// Direction cosines precomputed: 36 samples a tick is 72 trig calls otherwise.
const RING_C = [], RING_S = [];
for (let k = 0; k < RING_DIRS; k++) {
    const a = k * 2 * Math.PI / RING_DIRS;   // 0 = straight ahead, positive = to the doll's left
    RING_C.push(Math.cos(a));
    RING_S.push(Math.sin(a));
}

/* Same polarity as the LiDAR gate this replaces: on everywhere by default,
 * switched OFF with "0" so a stage can be A/B'd without an edit. NIN and
 * NET_SIZES are consts computed at load time, so it has to be the environment —
 * by the time any argument parser runs the network shape is already fixed. */
const sensorOff = k => typeof process !== "undefined" && process.env && process.env[k] === "0";
const PATCH_ON = !sensorOff("WALK3D_PATCH");
/* WALK3D_FAN is gone with the fan it gated. The ring that replaced it has no
 * "off" state worth having: the four legacy probes it could fall back to were a
 * strict subset of the fan, and nothing is a subset of a 360-degree ring. A dead
 * gate is worse than no gate — it reads as a supported configuration. */

/* Per-window GAINS, one per channel group per window.
 *
 * MEASURED, not chosen. A difference is far smaller than the value it came from,
 * so an ungained tap arrives as a near-zero input that mutation has no reason to
 * touch, and an over-gained one sits pinned at the clamp; both failures look like
 * "the GA is slow" from outside. probe_delta_gains.js replays real episodes —
 * walking starts AND floor poses, because a walker on its side moves its channels
 * quite differently from one crossing a stair — and reports the 95th percentile
 * of |now - mean(W)| per group. Gain is 1/p95, so a typical large excursion lands
 * at 1.0 and the clamp only catches genuine outliers.
 *
 * Two of these would not have been guessed. comHeight moves 0.016 across 60 ms
 * and 0.253 across 1200 ms — a factor of sixteen, which is exactly why "wiggling
 * raises the COM in oscillations" was invisible to a layout that stopped at
 * 160 ms. And footAtt's long-window excursions are already 1.5-1.66, so it needs
 * gains BELOW one; every hand-picked constant would have amplified it into the
 * clamp. Re-run the probe after any change to the windows. */
const TEMPORAL = [], TGAIN = [];
{
    const put = (n, set, gains) => {
        for (let i = 0; i < n; i++) { TEMPORAL.push(set); TGAIN.push(set.map(w => gains[w])); }
    };
    put(3, T_STD, [16, 4.8, 2.4]);          // gravity direction
    put(3, T_STD, [4.8, 2.4, 2.7]);         // gyro
    put(3, T_STD, [13, 4.8, 4.6]);          // pelvis velocity
    put(1, T_STD, [41, 11, 3.5]);           // height
    put(1, T_STD, [25, 6.3, 2.5]);          // uprightness
    put(NJ, T_LITE, [9.2, 2.9, 2.1]);       // joint angles
    put(NJ, T_LITE, [6, 3.3, 4]);           // joint rates
    put(2, T_STD, [2.3, 1.4, 1.8]);         // foot load
    put(2, T_STD, [1.5, 1.1, 1.2]);         // contact flags
    put(6, T_STD, [11, 3.5, 2.4]);          // foot positions
    put(1, T_NONE, []);                     // waypoint distance
    put(2, T_NONE, []);                     // waypoint bearing
    put(2, T_NONE, []);                     // gait phase — a clock, not a measurement
    /* The terrain ring and the foot patches get NO history, and that is a budget
     * decision with a reason behind it. They are 86 of the 194 channels, so one
     * window each would cost 86 inputs — a quarter of the vector, against 0.24%
     * for this entire redesign. What it would encode is optical flow, which is
     * mostly the walker's own velocity, already sensed directly three ways. And
     * both maps are referenced to a datum that MOVES (the ground under the pelvis,
     * the ground under the lower foot), so a difference there mixes "the ground
     * changed" with "my reference point moved" — a confound that does not exist on
     * a body-frame scalar. The aggregated version of the same signal is already
     * here and does get all three windows: foot clearance and foot attitude. */
    put(N_FAN, T_NONE, []);                 // terrain ring, 360 degrees out to 1 m
    put(2, T_NONE, []);                     // wind
    put(NJ, T_LITE, [1.4, 1.1, 1.2]);       // efference copy
    /* Centre-of-mass velocity in the pelvis frame.
     *
     * The pelvis velocity channel misses the momentum stored in the limbs: a
     * swinging leg or a thrown arm moves the centre of mass while the pelvis
     * reads almost unchanged, so without this the walker cannot sense the one
     * quantity that decides whether a recovery step will arrive in time.
     *
     * Realisable on hardware, which was the condition: a real humanoid computes
     * its centre of mass from joint encoders and known link masses through
     * forward kinematics, and differentiates it for velocity. Expressed in the
     * pelvis frame on purpose — the world-frame horizontal component needs
     * contact odometry and drifts, whereas this is pure kinematics.
     *
     * This carried the eleven-tap L_MOMENTUM ladder, the only channel that ever
     * reached past 160 ms. Two independent ablations found all thirty of those
     * history inputs free to delete — 3.17 m with them gone against 3.17 m
     * intact, where a random thirty-input lesion left 0.09-0.23 m. It gets the
     * ordinary three windows now, which is both cheaper and the cleanest test
     * available of whether the old encoding was the problem: this is the one
     * channel where we KNOW raw lagged samples failed. */
    put(3, T_STD, [17, 8, 9.3]);

    /* ------------------------------------------------ the inverted pendulum
     *
     * COM HEIGHT WAS NOT AN INPUT, and the rise tier is PAID ON IT. comHeight()
     * drives COM_HOLD, COM_RISE_PER_M and bestComY — the whole "get up off the
     * floor" ladder — while the only height the walker could sense was
     * C_HEIGHT, which is the PELVIS origin. On the floor those are not the same
     * quantity at all: the stated design intent of the dense term is that "a
     * walker propped on one elbow already outscores one lying flat", and the
     * pelvis is on the ground in both cases. This file states the rule itself,
     * about heading: a reward for a quantity that is not in the observation is a
     * reward for luck. Rising from the floor has read 0/6 for every champion
     * this project has produced.
     *
     * The velocity channel is not a substitute. It computes the COM offset in
     * the pelvis frame every tick, differences it, and throws the POSITION away.
     *
     * CAPTURE POINT is the other half, and it is not recoverable from the above
     * by any amount of selection. xi = com + v_com * sqrt(h_com / g) is where the
     * mass would come to rest if it were stopped — i.e. WHERE A FOOT MUST LAND
     * not to fall. It needs a square root of one channel multiplied by another,
     * which is the same argument this file already accepts for foot attitude:
     * recoverable in principle, and a GA will not discover it. Both are given
     * relative to the midpoint of the feet, so "outside my support" is a sign
     * change rather than a subtraction the network has to learn. */
    /* COM height's long window is the single most valuable tap in this table.
     * The rise tier is PAID on this quantity, and it moves 0.016 across 60 ms
     * against 0.253 across 1200 ms — so "my wiggling is raising me" existed only
     * on a timescale the old 160 ms layout could not see, while the ledger paid
     * for it the whole time. A reward for something outside the observation is a
     * reward for luck, and this file already says so about heading. */
    put(1, T_STD, [62, 17, 4]);         // COM height above the ground beneath it
    put(2, T_STD, [4.3, 1.3, 0.93]);    // COM offset from the support, heading frame
    put(2, T_STD, [5.5, 1.6, 1.2]);     // capture point offset from the support

    /* Appended last, so every offset above keeps its value.
     *
     * Clearance rate is the toe-scuff predictor, which is the failure that ends
     * most stair attempts, and it is the terrain signal the raw maps would have
     * given at twenty times the price. Attitude needs gains below one on the long
     * windows — its excursions there already exceed the clamp. */
    if (PATCH_ON) {
        put(2, T_STD, [12, 3.6, 2.2]);          // foot ground clearance
        put(4, T_STD, [3.7, 0.67, 0.6]);        // foot attitude vs the local surface
        put(2 * PATCH_CELLS, T_NONE, []);       // foveal height patches, one per foot
    }
}
const NC = TEMPORAL.length;                         // 32 + 3·NJ
/* Channel base offsets, derived for the same reason. Everything from the joint
 * block onward shifts when NJ changes, and these were literals scattered
 * through sense(). At NJ=18 they evaluate to the old numbers exactly. */
const C_GRAV = 0, C_GYRO = 3, C_VEL = 6, C_HEIGHT = 9, C_UPRIGHT = 10;
const C_QA = 11;                                    // joint angles
const C_QD = C_QA + NJ;                             // joint rates
const C_LOAD = C_QD + NJ;                           // foot load
const C_CONTACT = C_LOAD + 2;
const C_FOOTPOS = C_CONTACT + 2;
const C_WPDIST = C_FOOTPOS + 6;
const C_WPBEAR = C_WPDIST + 1;
const C_GAIT = C_WPBEAR + 2;
const C_TERRAIN = C_GAIT + 2;                       // the 360-degree ring
const C_WIND = C_TERRAIN + N_FAN;
const C_EFFERENCE = C_WIND + 2;
// Appended last so every offset above keeps its value.
const C_COMVEL = C_EFFERENCE + NJ;
const C_COMH = C_COMVEL + 3;                        // 1: COM height above ground
const C_COMPOS = C_COMH + 1;                        // 2: COM vs support, heading frame
const C_CAPTURE = C_COMPOS + 2;                     // 2: capture point vs support
const C_FOOTCLR = C_CAPTURE + 2;                    // 2, one per foot
const C_FOOTATT = C_FOOTCLR + 2;                    // 4: pitch+roll per foot
const C_PATCH = C_FOOTATT + 4;                      // 2 x 25 foveal cells
/* Whether the foot-referenced block is part of the layout this build loaded.
 * Derived from the layout rather than re-reading the environment, so there is
 * exactly one source of truth and the two can never disagree. */
const PATCH_CHANNELS = TEMPORAL.length > C_PATCH;
const NIN = NC + TEMPORAL.reduce((a, s) => a + s.length, 0);
/* Flattened read plan: the PRESENT reading of every channel first — so inputs[c]
 * is still channel c, which every comment in this file relies on — then each
 * window in order, each covering the channels that carry it. Built once, walked
 * linearly at 50 Hz. `win` is -1 for the present-tense taps. */
const TAP_PLAN = (() => {
    const plan = [];
    for (let ch = 0; ch < NC; ch++) plan.push({ win: -1, ch, gain: 1 });
    for (let w = 0; w < NWIN; w++)
        for (let ch = 0; ch < NC; ch++) {
            const k = TEMPORAL[ch].indexOf(w);
            if (k >= 0) plan.push({ win: w, ch, gain: TGAIN[ch][k] });
        }
    return plan;
})();
/* Rhythm groups. Each gets one amplitude output and one phase output; the two
 * sides of a pair are locked in anti-phase, which is both correct for walking
 * and halves what evolution has to find. Amplitudes are signed and map to zero
 * at the newborn's 0.5, so a fresh brain oscillates not at all. */
const CPG_GROUPS = [
    { name: "hipPitch", amax: 0.55, sides: [[J.L_HIP_PITCH, 0], [J.R_HIP_PITCH, Math.PI]] },
    { name: "knee", amax: 0.75, sides: [[J.L_KNEE, 0], [J.R_KNEE, Math.PI]] },
    { name: "anklePitch", amax: 0.35, sides: [[J.L_ANK_PITCH, 0], [J.R_ANK_PITCH, Math.PI]] },
    // Hip roll is the one group that is IN phase, and it matters more than it
    // looks. Both hip-roll joints share the +X axis, so rolling them the same
    // way tips the pelvis sideways and moves the centre of mass over one foot —
    // which is the only way a biped can unload the other foot enough to swing
    // it. Anti-phase, as the other groups are, just splays both legs
    // symmetrically and shifts no weight whatsoever; with that wiring the load
    // stayed pinned at 50/50 no matter how large the amplitude, and stepping was
    // mechanically impossible rather than merely hard to learn.
    { name: "hipRoll", amax: 0.20, sides: [[J.L_HIP_ROLL, 0], [J.R_HIP_ROLL, 0]] },
    { name: "armSwing", amax: 0.50, sides: [[J.L_SHOULDER, Math.PI], [J.R_SHOULDER, 0]] }
];
const NJOINT_OUT = NJ;
const O_CADENCE = NJOINT_OUT;
const O_AMP = O_CADENCE + 1;                        // 19..23
const O_PHASE = O_AMP + CPG_GROUPS.length;          // 24..28
const NOUT = O_PHASE + CPG_GROUPS.length;           // 29
const NET_SIZES = [NIN, 48, 32, NOUT];

/* Seed the rhythm outputs ~14x wider than the posture outputs. A fresh
 * population then contains a real spread of attempted gaits — amplitudes and
 * phase offsets that actually differ — while every one of them still holds a
 * sane standing posture. Without this the entire first generation is one
 * individual wearing 48 hats, and the run never leaves the plateau. */
OUT_ROW_SCALE = (() => {
    const a = new Float64Array(NOUT).fill(1);
    for (let i = O_AMP; i < NOUT; i++) a[i] = 14;
    return a;
})();

/* Signed angle from u to v measured about axis `a` (a must be unit).
 * Both vectors are projected onto the plane perpendicular to `a` first, so this
 * is the rotation about that one axis and nothing else — which is what makes
 * "pitch" and "roll" separable rather than two readings of the same tilt. */
function signedAngleAbout(ux, uy, uz, vx, vy, vz, ax, ay, az) {
    const du = ux * ax + uy * ay + uz * az, dv = vx * ax + vy * ay + vz * az;
    const px = ux - du * ax, py = uy - du * ay, pz = uz - du * az;
    const qx = vx - dv * ax, qy = vy - dv * ay, qz = vz - dv * az;
    const cx = py * qz - pz * qy, cy = pz * qx - px * qz, cz = px * qy - py * qx;
    return Math.atan2(cx * ax + cy * ay + cz * az, px * qx + py * qy + pz * qz);
}

function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
/* Bounded, stateless approximate gaussian (unit variance). Stateless matters:
 * nn.js's gaussRand caches a spare between calls, and walkers interleave, so
 * sharing it would cross their noise streams and quietly break the fairness
 * rule that every walker hears the identical disturbance. */
function nrand(rng) { return (rng() + rng() + rng() - 1.5) * 1.1547; }

class Walker {
    constructor(brain, idx, model) {
        this.brain = brain;
        this.idx = idx;
        this.model = model;
        this.mb = new MultiBody(model);
        this.nj = model.nj;

        this.inputs = new Float32Array(NIN);
        this.out = new Float32Array(NOUT);
        this.target = new Float64Array(this.nj);     // servo setpoint after lag
        this.cmd = new Float64Array(this.nj);        // base posture + rhythm
        this.base = new Float64Array(this.nj);       // the posture the net asked for
        this.amp = new Float64Array(CPG_GROUPS.length);
        this.ph = new Float64Array(CPG_GROUPS.length);
        this.tau = new Float64Array(this.nj + 1);    // physics.js indexes joints from 1

        const np = model.contacts.length;
        this.anchor = new Float64Array(np * 3);
        this.anchored = new Uint8Array(np);
        this.ptForce = new Float64Array(np);         // last normal force per point

        this.histBuf = [];
        for (let i = 0; i < MAXHIST; i++) this.histBuf.push(new Float32Array(NC));
        this.histWrite = 0;
        /* Rolling sum per window, so a mean over 45 frames costs one add and one
         * subtract rather than 45 reads. Float64 on purpose: this accumulator is
         * updated every control tick for the whole episode, and in Float32 the
         * add/subtract pair would drift. */
        this.winSum = [];
        for (let w = 0; w < NWIN; w++) this.winSum.push(new Float64Array(NC));
        this.nTicks = 0;                             // control ticks since reset

        this._p = new Float64Array(3);
        this._v = new Float64Array(3);
        this._sp = new Float64Array(3);      // second point, for limb-vs-limb
        this._sv = new Float64Array(3);
        this._s4 = new Float64Array(4);
        this.reset(null, 0, 0, 0);
    }

    /* ------------------------------------------------------------------ reset */
    reset(world, x, z, yaw, pose) {
        const M = this.model, mb = this.mb;
        mb.q.fill(0); mb.qd.fill(0); mb.blown = false;
        const jit = world ? world.jitterPose : null;
        // A walker that starts on the floor starts DOWN, so the rise rung is
        // live from the first tick rather than only after a fall.
        this.startedDown = !!pose;
        this.startPose = pose ? pose.name : "crouch";
        const q0 = pose ? pose.q : M.crouch;
        for (let j = 0; j < this.nj; j++) {
            let a = q0[j];
            if (jit) a += jit[j];
            mb.q[j + 1] = clamp(a, M.bodies[j + 1].qmin, M.bodies[j + 1].qmax);
            // The servo setpoint powers on at the *measured* joint angle, as a
            // real one does. Starting it at the standing pose instead makes the
            // very first tick a full-scale step command, and the walker leaves
            // the ground at 27x its own weight before the network gets a say.
            this.target[j] = mb.q[j + 1];
            this.cmd[j] = this.base[j] = M.nominal[j];
        }
        // Drop the assembled pose onto the ground: run FK with the pelvis at the
        // origin, find the lowest contact point, and lift by exactly that much.
        // Pelvis attitude: yaw about +Y, then pitch about +Z, then roll about +X.
        // Standing poses only ever set yaw; a ground pose tips the body over.
        const qy = [Math.cos(yaw * 0.5), 0, Math.sin(yaw * 0.5), 0];
        const pitch = pose ? pose.pitch : 0, roll = pose ? pose.roll : 0;
        const qp = [Math.cos(pitch * 0.5), 0, 0, Math.sin(pitch * 0.5)];
        const qr = [Math.cos(roll * 0.5), Math.sin(roll * 0.5), 0, 0];
        const qmul = (a, b) => [
            a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
            a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
            a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
            a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
        ];
        const q = qmul(qmul(qy, qp), qr);
        mb.bq[0] = q[0]; mb.bq[1] = q[1]; mb.bq[2] = q[2]; mb.bq[3] = q[3];
        mb.bp[0] = x; mb.bp[1] = 0; mb.bp[2] = z;
        mb.fk();
        let lowest = 1e9;
        for (const c of M.contacts) {
            mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], this._p, 0);
            const g = world ? world.terrain.height(this._p[0], this._p[2]) : 0;
            lowest = Math.min(lowest, this._p[1] - g);
        }
        mb.bp[1] = -lowest + 0.003;
        mb.fk();

        // COM-velocity differencing state: no history on the first control tick,
        // so the channel reads zero rather than a spike off a stale pose.
        this._comPrev = this._comPrev || new Float64Array(3);
        this._comHave = false;
        this._comPrevW = this._comPrevW || new Float64Array(3);
        this._comHaveW = false;

        /* Allocated once and reused — a walker is reset thousands of times per
         * generation. `_sole` is the two sole points every terrain sensor is
         * referenced to; `patchXZ` is where the 50 foveal cells were actually
         * sampled, kept so the renderer and the sampling test read the same
         * points the brain read rather than a recomputation of them. */
        this._sole = this._sole || new Float64Array(6);
        this.patchXZ = this.patchXZ || new Float64Array(2 * PATCH_CELLS * 2);
        this.patchDatum = 0;

        this.anchored.fill(0);
        this.ptForce.fill(0);
        this.peakPtForce = 0;
        for (const h2 of this.histBuf) h2.fill(0);
        this.histWrite = 0;
        for (const s of this.winSum) s.fill(0);
        this.nTicks = 0;
        this.out.fill(0.5);
        this.amp.fill(0);
        this.ph.fill(0);
        this.phase = 0;
        this.cadence = 1;
        this.gaitGain = 0;

        this.done = false;
        this.timeLeft = 0;
        this.fallTimer = 0;
        this.fallSeverity = 0;
        this.diverged = false;      // flung off the map, as distinct from fallen over
        this.downed = false;        // on the ground, and has to get itself up
        this.downTimer = 0;
        this.riseTimer = 0;
        this.falls = 0;
        this.recoveries = 0;
        this.riseIncome = 0;
        this.riseCand = 0;      // candidate new-best height, awaiting the hold
        this.riseCandT = 0;
        this.comPeak = 0;
        this.comSum = 0;            // time-weighted COM height, for rise-trial ranking
        this.comTime = 0;
        this.riseRefSet = false;    // the settled reference height is taken after 0.5 s
        this.bestComY = 0;
        /* True only while a searched reference is driving the joints. Set in
         * control(); the falling edge is the handover, where the rise ratchet is
         * re-baselined so scaffolded height is never paid for. */
        this.scaffolded = false;
        this.standTimer = 0;
        this.stood = false;
        this.balanced = false;
        this.footLoad = [0, 0];
        this.footContact = [0, 0];
        this.steps = 0;
        this.strideSum = 0;
        this.footAir = [0, 0];
        this.footAirborne = [false, false];
        this.footOff = new Float64Array(4);   // takeoff x,z per foot

        if (this.startedDown) {
            this.downed = true;
            this.bestComY = this.comHeight(world);
        }

        this.fitScore = 0;          // banked: milestones + completed legs
        this.penalty = 0;
        this.energy = 0;
        this.arrivals = 0;
        this.progressM = 0;       // metres of honest closure — the learning signal
        this.alignSum = 0;        // closure-weighted heading alignment, /progressM
        this.legIdx = 0;
        this.legStartTime = 0;
        this.legInitDist = 1;
        this.bestDist = 1e9;
        this.pathLen = 0;
        this.usefulLen = 0;
        this.pendingPush = 0;
        this.pushesSurvived = 0;
        this.legWalkScore = 0;
        this.legShapeScore = 0;
        // beginLeg() resizes this per leg; the reset value covers the window
        // before the first leg starts so _payWalk never reads undefined.
        this.legBudget = FIT.PROGRESS_PER_M * this.legInitDist + FIT.WALK_SHAPE_CAP;
        this.pushLeft = 0; this.pushX = 0; this.pushZ = 0;
        this.uprightTime = 0;
        this.walkTime = 0;
        this._lastPx = mb.bp[0]; this._lastPz = mb.bp[2];
    }

    /* --------------------------------------------------------------- geometry */
    /* Height of the pelvis above the ground directly below it. */
    groundClearance(world) {
        return this.mb.bp[1] - world.terrain.height(this.mb.bp[0], this.mb.bp[2]);
    }
    /* 1 when the torso is vertical, 0 once it is past ~60° off. */
    uprightness() {
        const R = this.mb.R, o = 2 * 9;              // body 2 is the torso
        return clamp((R[o + 4] - 0.5) / 0.5, 0, 1);  // torso +Y axis, world Y component
    }
    /* Heading: the pelvis' forward axis, flattened onto the ground plane. */
    heading() {
        const R = this.mb.R;
        return Math.atan2(-R[6], R[0]);              // yaw about +Y, +Z is left
    }

    /* --------------------------------------------------- sensing + control (50 Hz) */
    control(world) {
        const M = this.model, mb = this.mb, cur = this.histBuf[this.histWrite];
        const want = world.phase === "walk" ? 1 : 0;
        this.gaitGain += (want - this.gaitGain) * (want ? 0.10 : 0.30);
        const R = mb.R;

        // 0-2  gravity in pelvis coordinates: R^T·(0,-1,0)
        cur[0] = -R[3]; cur[1] = -R[4]; cur[2] = -R[5];
        // 3-5  gyro, 6-8 velocity — both already body-frame in the spatial state
        cur[3] = clamp(mb.qd[0] / 5, -1.5, 1.5);
        cur[4] = clamp(mb.qd[1] / 5, -1.5, 1.5);
        cur[5] = clamp(mb.qd[2] / 5, -1.5, 1.5);
        cur[6] = clamp(mb.qd[3] / 3, -1.5, 1.5);
        cur[7] = clamp(mb.qd[4] / 3, -1.5, 1.5);
        cur[8] = clamp(mb.qd[5] / 3, -1.5, 1.5);
        // 9-10 posture
        const clr = this.groundClearance(world);
        cur[C_HEIGHT] = clamp(clr / M.standHipY, 0, 1.5);
        cur[C_UPRIGHT] = this.uprightness();
        // 11-46 joint state
        for (let j = 0; j < this.nj; j++) {
            const b = M.bodies[j + 1];
            cur[C_QA + j] = clamp((2 * (mb.q[j + 1] - b.qmin) / M.span[j]) - 1, -1.2, 1.2);
            cur[C_QD + j] = clamp(mb.qd[6 + j] / 12, -1.5, 1.5);
        }
        // 47-56 feet
        const invW = 1 / M.weight;
        cur[C_LOAD] = clamp(this.footLoad[0] * invW, 0, 2);
        cur[C_LOAD + 1] = clamp(this.footLoad[1] * invW, 0, 2);
        cur[C_CONTACT] = this.footContact[0];
        cur[C_CONTACT + 1] = this.footContact[1];
        for (let s = 0; s < 2; s++) {
            const fb = M.footBody[s];
            // Stashed, not just used: every terrain sensor below is referenced
            // to these two points, and recomputing them there would be a second
            // definition of "where the foot is" that could drift from this one.
            mb.worldPoint(fb, 0, -M.seg.ankleH, 0, this._sole, s * 3);
            this._p[0] = this._sole[s * 3]; this._p[1] = this._sole[s * 3 + 1]; this._p[2] = this._sole[s * 3 + 2];
            const dx = this._p[0] - mb.bp[0], dy = this._p[1] - mb.bp[1], dz = this._p[2] - mb.bp[2];
            cur[C_FOOTPOS + s * 3] = clamp((R[0] * dx + R[3] * dy + R[6] * dz) / 0.6, -1.5, 1.5);
            cur[C_FOOTPOS + 1 + s * 3] = clamp((R[1] * dx + R[4] * dy + R[7] * dz) / 0.6, -1.5, 1.5);
            cur[C_FOOTPOS + 2 + s * 3] = clamp((R[2] * dx + R[5] * dy + R[8] * dz) / 0.6, -1.5, 1.5);
        }
        // 57-59 waypoint
        const wp = world.waypointFor(this);
        const hd = this.heading();
        if (wp) {
            const dx = wp.x - mb.bp[0], dz = wp.z - mb.bp[2];
            const dist = Math.hypot(dx, dz);
            const rel = wrapPi(Math.atan2(-dz, dx) - hd);
            cur[C_WPDIST] = clamp(dist / 6, 0, 1.5);
            cur[C_WPBEAR] = Math.sin(rel);
            cur[C_WPBEAR + 1] = Math.cos(rel);
        } else { cur[C_WPDIST] = 0; cur[C_WPBEAR] = 0; cur[C_WPBEAR + 1] = 1; }
        // 60-61 gait clock
        cur[C_GAIT] = Math.sin(this.phase);
        cur[C_GAIT + 1] = Math.cos(this.phase);
        /* Terrain ahead, relative to the ground under the pelvis.
         *
         * With the fan on this is 4 distances x 5 lateral offsets, ordered
         * lateral-major with the 0.0 column third. That centre column is
         * BIT-IDENTICAL to the four probes it replaces — same pelvis datum,
         * same 0.3 m scale — which is what makes the fan a strict superset and
         * lets a graft carry those weights across meaning exactly what they
         * meant before. (The brief specified the shared foot datum here; on
         * stairs that would have shifted every one of those channels by the
         * pelvis-to-foot offset, so the grafted weights would have been
         * preserved in name only. The foveal patches below, where the shared
         * datum is the whole point, do use it.)
         *
         * Its job is route shape — "the ground rises ahead and to the left" —
         * not stairs. Stairs are the patches' job. */
        const fx = Math.cos(hd), fz = -Math.sin(hd);
        // the doll's left, in the gravity-levelled heading frame: up x forward
        const sideX = -fz, sideZ = fx;
        const base = world.terrain.height(mb.bp[0], mb.bp[2]);
        for (let r = 0; r < RING_R.length; r++) {
            const d = RING_R[r], b = C_TERRAIN + r * RING_DIRS;
            for (let k = 0; k < RING_DIRS; k++) {
                // Heading-relative, so the ring means the same thing whichever way
                // the walker is facing: index 0 is always straight ahead.
                const ux = fx * RING_C[k] + sideX * RING_S[k];
                const uz = fz * RING_C[k] + sideZ * RING_S[k];
                const hgt = world.terrain.height(mb.bp[0] + ux * d, mb.bp[2] + uz * d);
                cur[b + k] = clamp((hgt - base) / 0.3, -1.5, 1.5);
            }
        }
        // 66-67 wind, relative to facing
        const wmag = Math.hypot(world.wind[0], world.wind[2]);
        if (wmag > 0.1) {
            const rel = wrapPi(Math.atan2(-world.wind[2], world.wind[0]) - hd);
            const k = Math.min(1, wmag / 12);
            cur[C_WIND] = Math.sin(rel) * k; cur[C_WIND + 1] = Math.cos(rel) * k;
        } else { cur[C_WIND] = 0; cur[C_WIND + 1] = 0; }
        // 68-85 efference copy of the action issued last tick
        for (let j = 0; j < this.nj; j++) cur[C_EFFERENCE + j] = this.out[j] * 2 - 1;

        /* Centre-of-mass velocity in the pelvis frame. Built exactly the way a
         * real robot would: sum the link masses through forward kinematics to get
         * the COM, express it relative to the pelvis, and difference it over the
         * control interval. No world-frame odometry is used, so nothing here
         * depends on knowing where the robot is. */
        {
            const M = this.model, mb = this.mb;
            let m = 0, cx = 0, cy = 0, cz = 0;
            for (let i = 0; i < M.bodies.length; i++) {
                const b = M.bodies[i];
                if (b.mass <= 0) continue;
                mb.worldPoint(i, b.com[0], b.com[1], b.com[2], this._p, 0);
                cx += b.mass * this._p[0]; cy += b.mass * this._p[1]; cz += b.mass * this._p[2];
                m += b.mass;
            }
            if (m > 0) { cx /= m; cy /= m; cz /= m; }
            // Offset from the pelvis, rotated into the pelvis frame (R is
            // body->world, so the transpose maps world->body).
            const dx = cx - mb.bp[0], dy = cy - mb.bp[1], dz = cz - mb.bp[2];
            const R = mb.R;
            const lx = R[0] * dx + R[3] * dy + R[6] * dz;
            const ly = R[1] * dx + R[4] * dy + R[7] * dz;
            const lz = R[2] * dx + R[5] * dy + R[8] * dz;
            if (this._comHave) {
                const idt = 1 / (DT * CONTROL_EVERY);
                // Scaled to roughly +/-1 over the speeds a walker actually
                // reaches; the network sees a bounded signal like every other
                // channel rather than one that saturates its first layer.
                cur[C_COMVEL] = clamp((lx - this._comPrev[0]) * idt / 2.5, -1.5, 1.5);
                cur[C_COMVEL + 1] = clamp((ly - this._comPrev[1]) * idt / 2.5, -1.5, 1.5);
                cur[C_COMVEL + 2] = clamp((lz - this._comPrev[2]) * idt / 2.5, -1.5, 1.5);
            } else {
                cur[C_COMVEL] = 0; cur[C_COMVEL + 1] = 0; cur[C_COMVEL + 2] = 0;
                this._comHave = true;
            }
            this._comPrev[0] = lx; this._comPrev[1] = ly; this._comPrev[2] = lz;

            /* ---- the inverted pendulum, which the ledger already pays for ----
             * See the TEMPORAL block for why these exist. Everything below is derived
             * from the world-frame COM just computed, so it costs one terrain
             * sample and a square root. */
            const hcom = cy - world.terrain.height(cx, cz);
            cur[C_COMH] = clamp(hcom / M.standHipY, 0, 1.5);

            // World-frame COM velocity. The pelvis-frame one above cannot be
            // reused: the capture point is a point ON THE GROUND, and a velocity
            // expressed in a frame that is itself rotating does not locate it.
            this._comPrevW = this._comPrevW || new Float64Array(3);
            let vwx = 0, vwz = 0;
            if (this._comHaveW) {
                const idtw = 1 / (DT * CONTROL_EVERY);
                vwx = (cx - this._comPrevW[0]) * idtw;
                vwz = (cz - this._comPrevW[2]) * idtw;
            } else this._comHaveW = true;
            this._comPrevW[0] = cx; this._comPrevW[1] = cy; this._comPrevW[2] = cz;

            /* xi = com + v * sqrt(h/g). Floored at 5 cm of height so a walker
             * flat on the floor does not divide the pendulum by nothing. */
            const omega = Math.sqrt(Math.max(0.05, hcom) / 9.81);
            const capX = cx + vwx * omega, capZ = cz + vwz * omega;

            /* Both relative to the midpoint of the two soles, in the heading
             * frame, so "my mass is outside my feet" is a sign change rather than
             * a subtraction the network has to learn. */
            const supX = 0.5 * (this._sole[0] + this._sole[3]);
            const supZ = 0.5 * (this._sole[2] + this._sole[5]);
            const cdx = cx - supX, cdz = cz - supZ;
            cur[C_COMPOS] = clamp((cdx * fx + cdz * fz) / 0.30, -1.5, 1.5);
            cur[C_COMPOS + 1] = clamp((cdx * sideX + cdz * sideZ) / 0.30, -1.5, 1.5);
            const kdx = capX - supX, kdz = capZ - supZ;
            cur[C_CAPTURE] = clamp((kdx * fx + kdz * fz) / 0.50, -1.5, 1.5);
            cur[C_CAPTURE + 1] = clamp((kdx * sideX + kdz * sideZ) / 0.50, -1.5, 1.5);
        }

        /* ---------------------------------- foot-referenced terrain sensing
         * Skipped entirely when the block is not in the layout — C_FOOTCLR and
         * friends are computed from the channel table and point past the end of
         * a shorter sensor row, so writing them would run off the end of it. */
        if (PATCH_CHANNELS) {
            const T = world.terrain;
            const hL = T.height(this._sole[0], this._sole[2]);
            const hR = T.height(this._sole[3], this._sole[5]);
            const datum = hL < hR ? hL : hR;
            const px = this.patchXZ;
            for (let s = 0; s < 2; s++) {
                const ax = this._sole[s * 3], ay = this._sole[s * 3 + 1], az = this._sole[s * 3 + 2];
                const gh = s === 0 ? hL : hR;

                /* Height of the sole above the terrain DIRECTLY BENEATH IT. On
                 * flat ground this is redundant — reconstructible from
                 * C_FOOTPOS and C_HEIGHT. On stairs that reconstruction is
                 * wrong, because the ground under the foot is not the ground
                 * under the pelvis. So it carries new information exactly where
                 * we are failing, and nowhere else. */
                cur[C_FOOTCLR + s] = clamp((ay - gh) / CLEAR_SCALE, -0.5, 1.5);

                /* Sole attitude relative to the LOCAL SURFACE, not to gravity.
                 * On a 20 deg slope the sole should be flat to the slope, and a
                 * gravity-referenced angle would tell the brain it is doing the
                 * wrong thing. Recoverable in principle from ankle+knee+hip
                 * through the chain plus the pelvis gravity vector — five joints
                 * and a lot of trigonometry, which a GA will not discover. */
                const dhx = (T.height(ax + NORMAL_STEP, az) - T.height(ax - NORMAL_STEP, az)) / (2 * NORMAL_STEP);
                const dhz = (T.height(ax, az + NORMAL_STEP) - T.height(ax, az - NORMAL_STEP)) / (2 * NORMAL_STEP);
                const nl = Math.sqrt(dhx * dhx + 1 + dhz * dhz);
                const Nx = -dhx / nl, Ny = 1 / nl, Nz = -dhz / nl;
                /* The foot's local +Y, NOT the sole's outward normal (local -Y).
                 * The brief specified -Y, and -Y is genuinely the normal of the
                 * sole surface — but it points DOWN, while a terrain normal
                 * points UP, so a foot lying perfectly flat on flat ground came
                 * out at 180 degrees and pinned all twelve of these inputs to
                 * the clamp. Measured on flat ground: [1.5, 1.5, 1.5, 1.5].
                 * What the channel has to mean is DEVIATION FROM FLAT, which is
                 * zero when the foot's up-axis agrees with the surface's. */
                const fr = M.footBody[s] * 9;                 // foot body -> world
                const Sx = R[fr + 1], Sy = R[fr + 4], Sz = R[fr + 7];
                cur[C_FOOTATT + s * 2] = clamp(
                    signedAngleAbout(Nx, Ny, Nz, Sx, Sy, Sz, sideX, 0, sideZ) / ATT_SCALE, -1.5, 1.5);
                cur[C_FOOTATT + s * 2 + 1] = clamp(
                    signedAngleAbout(Nx, Ny, Nz, Sx, Sy, Sz, fx, 0, fz) / ATT_SCALE, -1.5, 1.5);

                /* The foveal patch. POINT-SAMPLED, never blurred: bilinear
                 * downsampling turns a 0.17 m riser into a ramp and destroys
                 * the one discontinuity this whole exercise exists to capture.
                 * If pooling is ever added it must be MIN-pool — worst case
                 * underfoot — for the same reason the old LiDAR sectors pooled
                 * by nearest hit rather than by mean. */
                const cx = ax + fx * PATCH_FWD, cz = az + fz * PATCH_FWD;
                const b = C_PATCH + s * PATCH_CELLS, xb = s * PATCH_CELLS * 2;
                for (let r = 0; r < PATCH_N; r++) {
                    const df = PATCH_OFF[r];
                    for (let c = 0; c < PATCH_N; c++) {
                        const dl = PATCH_OFF[c], i = r * PATCH_N + c;
                        const qx = cx + fx * df + sideX * dl, qz = cz + fz * df + sideZ * dl;
                        // recorded so the renderer and the sampling test read the
                        // points the brain actually used, not a recomputation
                        px[xb + i * 2] = qx; px[xb + i * 2 + 1] = qz;
                        cur[b + i] = clamp((T.height(qx, qz) - datum) / DATUM_SCALE, -1, 1);
                    }
                }
            }
            this.patchDatum = datum;
        }

        /* ---- roll the window sums forward ----
         * `cur` is already written at histWrite, so lag L sits at histWrite - L.
         * Advancing one tick shifts window [a,b]: the frame now at lag a has just
         * entered it and the one at lag b+1 has just left. That is why MAXHIST is
         * one deeper than the deepest window — the departing frame has to still be
         * readable when it is subtracted. */
        this.nTicks++;
        for (let w = 0; w < NWIN; w++) {
            const a = WIN[w][0], b = WIN[w][1], s = this.winSum[w];
            const fin = this.histBuf[(this.histWrite - a + MAXHIST) % MAXHIST];
            const fout = this.histBuf[(this.histWrite - b - 1 + MAXHIST) % MAXHIST];
            for (let c = 0; c < NC; c++) s[c] += fin[c] - fout[c];
        }
        /* How many frames of each window actually exist yet. The ring is zeroed on
         * reset, so an unwritten frame contributes nothing to the sum and dividing
         * by the COUNT rather than the window length gives the exact mean of what
         * is there. Dividing by the length instead would scale the mean toward
         * zero for the first 1.2 s of every episode, and with a gain of 62 on COM
         * height that lands the tap hard against the clamp — a garbage input over
         * exactly the stand phase the curriculum opens with. */
        const winCnt = [];
        for (let w = 0; w < NWIN; w++)
            winCnt.push(Math.max(0, Math.min(WIN[w][1], this.nTicks - 1) - WIN[w][0] + 1));

        // assemble: present-tense readings, then one differenced tap per window
        const inp = this.inputs;
        for (let i = 0; i < TAP_PLAN.length; i++) {
            const e = TAP_PLAN[i];
            if (e.win < 0) { inp[i] = cur[e.ch]; continue; }
            const n = winCnt[e.win];
            // No past yet means no change yet — 0, not a spurious excursion.
            inp[i] = n === 0 ? 0
                : clamp((cur[e.ch] - this.winSum[e.win][e.ch] / n) * e.gain, -1.5, 1.5);
        }
        this.histWrite = (this.histWrite + 1) % MAXHIST;

        if (world.noise) {
            const s = SIM2REAL.sensorNoise;
            for (let i = 0; i < inp.length; i++) inp[i] += nrand(this.rng) * s;
        }

        const o = this.brain.forward(inp);
        for (let i = 0; i < NOUT; i++) {
            let v = o[i];
            if (world.noise) v += nrand(this.rng) * SIM2REAL.actionNoise;
            this.out[i] = clamp(v, 0, 1);
        }
        /* ---- rise scaffolding -------------------------------------------
         *
         * For the first `scaffoldUntil` seconds of a scaffolded rise episode a
         * SEARCHED reference trajectory drives the joints instead of the brain,
         * and the brain takes over mid-motion.
         *
         * This exists because the rise has never had a reward gradient leading
         * into it: commanding the standing posture from any floor pose drives
         * the COM DOWN to 0.12-0.15 m first, so the correct behaviour is punished
         * for its whole prefix and evolution never gets a first step to climb.
         * probe_rise_search.js showed the rise IS reachable — an open-loop search
         * lifted this body from 0.158 m to 0.811 m from prone, inside the real
         * torque, lag and slew limits — so what was missing was the gradient, not
         * the capability.
         *
         * HANDING OVER MID-MOTION IS THE WHOLE POINT, and it is why this is not
         * done by spawning at a mid-rise posture instead. A posture sampled from
         * the middle of a rise has velocity; spawning freezes it to zero, and a
         * frozen snapshot of a dynamic motion falls over. That is exactly how the
         * riseAt interpolations failed (0.797 -> 0.162 held frozen). Handing over
         * from a live rollout keeps the velocities the physics actually produced.
         *
         * The override lands AFTER the network has been read and after the action
         * noise has been drawn, so the rng stream is identical whether or not an
         * episode is scaffolded. Scaffolded and unscaffolded episodes must stay
         * comparable, and a different number of draws would break that.
         *
         * The scaffold is written in OUTPUT space, not joint angles, for the same
         * reason the search was: a reference the controller could not itself emit
         * would be teaching something unreachable. */
        if (world && world.scaffoldGene && world.time < world.scaffoldUntil) {
            const g = world.scaffoldGene, K = world.scaffoldKnots;
            const u = clamp(world.time / world.scaffoldT, 0, 1) * (K - 1);
            const i0 = Math.min(K - 2, Math.floor(u)), f = u - i0;
            for (let j = 0; j < this.nj; j++) {
                const a = g[j * K + i0], b = g[j * K + i0 + 1];
                this.out[j] = a + (b - a) * f;
            }
            this.scaffolded = true;
        } else if (this.scaffolded) {
            /* Handover. Re-baseline the rise ratchet to where the scaffold left
             * the body, so none of the height it was GIVEN is paid for. Without
             * this a 90%-scaffolded episode banks most of a rise for free and
             * outscores an unscaffolded one that actually did the work — the
             * same free-credit problem the sustained-height ratchet was built to
             * close. Mirrors the down-start baseline in reset(). */
            this.scaffolded = false;
            this.bestComY = this.comHeight(world);
            this.riseCand = this.bestComY;
            this.riseCandT = 0;
        }
        // joint setpoints: nominal ± range. A newborn's 0.5s land exactly on the
        // nominal standing pose, so evolution starts from "try to stand", not
        // from "flail". Held between control ticks, like a real servo bus.
        for (let j = 0; j < this.nj; j++) {
            this.base[j] = M.nominal[j] + (this.out[j] * 2 - 1) * M.range[j];
        }
        this.cadence = 0.55 + this.out[O_CADENCE] * 1.15;
        // rhythm layer: amplitude and phase per group, anti-phase across the body
        for (let g = 0; g < CPG_GROUPS.length; g++) {
            this.amp[g] = (this.out[O_AMP + g] * 2 - 1) * CPG_GROUPS[g].amax * TUNE.cpgScale;
            this.ph[g] = (this.out[O_PHASE + g] * 2 - 1) * Math.PI;
        }
        this._composeCmd();
    }

    /* base posture + rhythm -> the setpoint the servos chase. Recomputed every
     * control tick; the gait clock has already advanced by then.
     *
     * `gaitGain` ramps the rhythm in over half a second once walking is the job
     * and holds it at zero before that. Letting the legs swing during the
     * stand-up was measured to topple the entire population before the walk
     * phase even began — a walker cannot rise out of a squat and pedal at the
     * same time, and neither can this one. */
    _composeCmd() {
        const M = this.model;
        for (let j = 0; j < this.nj; j++) this.cmd[j] = this.base[j];
        for (let g = 0; g < CPG_GROUPS.length; g++) {
            const grp = CPG_GROUPS[g], a = this.amp[g] * this.gaitGain;
            if (a === 0) continue;
            for (const [j, off] of grp.sides) this.cmd[j] += a * Math.sin(this.phase + this.ph[g] + off);
        }
        for (let j = 0; j < this.nj; j++) {
            const b = M.bodies[j + 1];
            this.cmd[j] = clamp(this.cmd[j], b.qmin, b.qmax);
        }
    }

    /* ------------------------------------------------------------ physics tick */
    stepPhysics(world, dt) {
        const M = this.model, mb = this.mb;
        mb.fk();
        mb.clearForces();
        this._contacts(world, dt);
        this._selfCollide();
        this._wind(world);
        this._push(world, dt);
        this._servos(world, dt);
        mb.dynamics(this.tau);
        mb.integrate(dt);
        if (mb.blown) this.done = true;      // NaN somewhere — retire it rather than poison the pool
        /* A clamped acceleration prevents NaN; it does not prevent RUNAWAY.
         * qdd is limited to ±4000 rad/s², which is finite the whole way while a
         * walker is flung kilometres in a few seconds — and such a walker never
         * trips the fall detector, because it is high and upright rather than
         * low and collapsed. Measured in a real run: centre of mass at 688 m,
         * then 1,783 m, then 7,114 m, credited with closing on its waypoint the
         * entire way and reported as "walked 16.35 m". The per-leg cap kept it
         * from distorting selection much, but every best-of statistic it
         * touched was meaningless. Finite is not the same as physical. */
        /* The 25 m/s ceiling above was set against walkers flung KILOMETRES. It
         * passes the ordinary version of the same fault: a captured incident had
         * the walker leave at 7.3 m/s, sail straight through the guard, and be
         * scored as a real episode. Three tighter tests, each stated as a thing
         * a 65 kg humanoid cannot do rather than as a tuned threshold:
         *
         *   HORIZONTAL speed. Vertical is left alone — falling off a 0.9 m
         *   stand reaches 4.2 m/s honestly, and that must not be flagged. But
         *   nothing in this body can push itself sideways at 5 m/s; the
         *   champion manages under 1, and a world-record sprinter is 12.
         *
         *   Spin. The fling reached 33 rad/s, better than five revolutions a
         *   second. 25 is already absurd for a walker.
         *
         *   Single-point contact force. The most direct statement of all: one
         *   point of one limb cannot push with 50x the whole body's weight.
         *   This is what fires FIRST — inside the 16 ms it takes the runaway to
         *   go from touchdown to launch — so a broken episode is retired at the
         *   moment it breaks instead of running its remaining seconds. That is
         *   the compute saving; the rest is just honesty about the score. */
        if (!this.done) {
            const hgt = mb.bp[1] - (world.terrain ? world.terrain.height(mb.bp[0], mb.bp[2]) : 0);
            const vh = Math.hypot(mb.qd[3], mb.qd[5]);
            const spd = Math.hypot(mb.qd[3], mb.qd[4], mb.qd[5]);
            const spin = Math.hypot(mb.qd[0], mb.qd[1], mb.qd[2]);
            if (!(hgt < 4 && hgt > -2 && spd < 25 && vh < DIVERGE_VH && spin < DIVERGE_SPIN &&
                  this.peakPtForce < DIVERGE_FORCE_BW * M.weight)) {
                this.done = true; this.diverged = true;
            }
        }
    }

    /* Ground reaction at every contact point. */
    _contacts(world, dt) {
        const M = this.model, mb = this.mb, T = world.terrain;
        const p = this._p, v = this._v, s4 = this._s4;
        const mu = T.mu * world.frictionScale;
        this.footLoad[0] = 0; this.footLoad[1] = 0;
        this.footContact[0] = 0; this.footContact[1] = 0;
        this.peakPtForce = 0;       // this tick's largest single-point normal force
        for (let i = 0; i < M.contacts.length; i++) {
            const c = M.contacts[i];
            mb.worldPoint(c.body, c.p[0], c.p[1], c.p[2], p, 0);
            T.sample(p[0], p[2], s4);
            // perpendicular depth: the vertical gap projected onto the normal
            const depth = (s4[0] - p[1]) * s4[2];
            if (depth <= 0) { this.anchored[i] = 0; this.ptForce[i] = 0; continue; }
            mb.worldPointVel(c.body, c.p[0], c.p[1], c.p[2], v, 0);
            const nx = s4[1], ny = s4[2], nz = s4[3];
            const vn = v[0] * nx + v[1] * ny + v[2] * nz;
            /* Two bounds, because the shipped law had neither and a hand landing
             * at 3 m/s was answered with 7.5 kN — eleven times what its
             * penetration justified. That force acted at a long lever arm, spun
             * the body about the contact (3.9 -> 33 rad/s), and the spin drove
             * the same point deeper, which raised the force again. Sixteen
             * milliseconds from touchdown to airborne at 7.3 m/s.
             *
             * vn clamp: the damping model is calibrated for ordinary contact
             * speeds and must not be extrapolated past them. -2 m/s is not a new
             * number — it is exactly what _selfCollide already does to `closing`.
             * The ground path simply never got the same treatment.
             *
             * Force cap: no SINGLE point of a 65 kg body pushes with 15x its
             * whole weight. This barely constrains real support — the body has
             * ~20 contact points, so 15x each still permits 300x in total, and a
             * running human peaks near 3x spread over a whole foot. It only
             * bites when one point is doing something no point should.
             *
             * Measured, 24 episodes per condition on identical seeds:
             *   crouch starts   5/24 diverged -> 0/24, top speed 29.0 -> 7.0 m/s,
             *                   all 13 waypoints kept, fitness 2718 -> 2742
             *   pool poses      6/24 diverged -> 0/24, top speed 37.2 -> 16.2 m/s
             * An earlier candidate clamped the damping much harder (to 3x) and
             * cost 20% of fitness; that cost was the clamp, not the cap. */
            let fn = CONTACT.KN * depth * (1 - CONTACT.HC * Math.max(vn, -CONTACT.VN_MAX));
            if (fn > CONTACT.F_MAX_BW * M.weight) fn = CONTACT.F_MAX_BW * M.weight;
            if (fn <= 0) { this.anchored[i] = 0; this.ptForce[i] = 0; continue; }
            this.ptForce[i] = fn;
            if (fn > this.peakPtForce) this.peakPtForce = fn;
            if (c.foot >= 0) { this.footLoad[c.foot] += fn; this.footContact[c.foot] = 1; }

            // tangential: a stick spring anchored where the point first landed
            const a = i * 3;
            if (!this.anchored[i]) { this.anchored[i] = 1; this.anchor[a] = p[0]; this.anchor[a + 1] = p[1]; this.anchor[a + 2] = p[2]; }
            let dx = p[0] - this.anchor[a], dy = p[1] - this.anchor[a + 1], dz = p[2] - this.anchor[a + 2];
            const dn = dx * nx + dy * ny + dz * nz;
            dx -= dn * nx; dy -= dn * ny; dz -= dn * nz;
            const tvx = v[0] - vn * nx, tvy = v[1] - vn * ny, tvz = v[2] - vn * nz;
            let ftx = -CONTACT.KT * dx - CONTACT.CT * tvx;
            let fty = -CONTACT.KT * dy - CONTACT.CT * tvy;
            let ftz = -CONTACT.KT * dz - CONTACT.CT * tvz;
            const mag = Math.hypot(ftx, fty, ftz), lim = mu * fn;
            if (mag > lim) {
                const k = lim / (mag || 1);
                ftx *= k; fty *= k; ftz *= k;
                // slide the anchor so the spring sits exactly at the Coulomb limit
                this.anchor[a] = p[0] + ftx / CONTACT.KT;
                this.anchor[a + 1] = p[1] + fty / CONTACT.KT;
                this.anchor[a + 2] = p[2] + ftz / CONTACT.KT;
            }
            mb.addWorldForce(c.body, p[0], p[1], p[2], ftx + fn * nx, fty + fn * ny, ftz + fn * nz);
        }
    }

    /* Limb against limb. Same Hunt-Crossley normal law as the ground, so the
     * force vanishes smoothly on separation instead of pulling the limbs back
     * together as they part — a linear damper here chatters exactly the way it
     * did underfoot. Softer than the ground (KN_SELF) because this is a limit
     * stop, not a floor: it has to make crossing impossible, not make contact
     * feel rigid. No friction term — limbs sliding past each other is fine,
     * passing through each other is not. */
    _selfCollide() {
        const mb = this.mb, pairs = this.model.selfPairs;
        if (!pairs) return;
        const pa = this._p, pb = this._sp, va = this._v, vb = this._sv;
        for (let i = 0; i < pairs.length; i++) {
            const a = pairs[i][0], b = pairs[i][1];
            mb.worldPoint(a.body, a.p[0], a.p[1], a.p[2], pa, 0);
            mb.worldPoint(b.body, b.p[0], b.p[1], b.p[2], pb, 0);
            let dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2];
            const d = Math.hypot(dx, dy, dz);
            const pen = a.r + b.r - d;
            if (pen <= 0 || d < 1e-9) continue;
            dx /= d; dy /= d; dz /= d;                       // a -> b
            mb.worldPointVel(a.body, a.p[0], a.p[1], a.p[2], va, 0);
            mb.worldPointVel(b.body, b.p[0], b.p[1], b.p[2], vb, 0);
            // closing speed along the axis, positive when they are converging
            const closing = -((vb[0] - va[0]) * dx + (vb[1] - va[1]) * dy + (vb[2] - va[2]) * dz);
            let fn = CONTACT.KN_SELF * pen * (1 + CONTACT.HC * Math.max(-2, closing));
            if (fn < 0) fn = 0;
            mb.addWorldForce(a.body, pa[0], pa[1], pa[2], -fn * dx, -fn * dy, -fn * dz);
            mb.addWorldForce(b.body, pb[0], pb[1], pb[2], fn * dx, fn * dy, fn * dz);
        }
    }

    /* Aerodynamic drag on the torso from the ambient wind. */
    _wind(world) {
        if (!world.windOn) return;
        const mb = this.mb, b = this.model.bodies[2];
        mb.worldPoint(2, b.com[0], b.com[1], b.com[2], this._p, 0);
        mb.worldPointVel(2, b.com[0], b.com[1], b.com[2], this._v, 0);
        const rx = world.wind[0] - this._v[0], rz = world.wind[2] - this._v[2];
        const m = Math.hypot(rx, rz);
        if (m < 0.05) return;
        const k = 0.5 * 1.225 * 1.1 * 0.35;      // ½·ρ·Cd·A for a human torso
        mb.addWorldForce(2, this._p[0], this._p[1], this._p[2], k * rx * m, 0, k * rz * m);
    }

    /* A scripted shove at the pelvis — the stage-2 balance exam. */
    _push(world, dt) {
        if (this.pushLeft > 0) {
            this.mb.addWorldForce(0, this.mb.bp[0], this.mb.bp[1], this.mb.bp[2], this.pushX, 0, this.pushZ);
            this.pushLeft -= dt;
        }
    }

    /* PD servo per joint: first-order lag on the setpoint, then torque clamped
     * to the joint's real peak. */
    _servos(world, dt) {
        const M = this.model, mb = this.mb;
        let lag = 1 - Math.exp(-dt / SIM2REAL.servoLag);
        const kScale = world.gainScale, tScale = world.torqueScale;

        /* Bound how fast the setpoint may travel — but bound the WHOLE move, not
         * each joint separately.
         *
         * A neutral network output maps to the standing trim (base = nominal +
         * (out*2-1)*range), so the default command from any pose is "stand up".
         * From a deep crouch that is a full-scale step, and the lag alone let the
         * body reach 1.24 m of centre-of-mass height against a standing 0.84 m —
         * it left the floor. That is the "popping out of the ground" seen in the
         * viewer, and it also meant rising from a crouch cost the network nothing:
         * the servos did it, so "rose 6/6" measured the transient, not a skill.
         *
         * The per-joint rate cap this function's comment rejects is still the
         * wrong tool, for the reason given there: equal speeds make small-error
         * joints arrive first and the soles come off the ground. Scaling the
         * single proportional step keeps every joint on the same straight line in
         * joint space — soles stay down — while capping how quickly it is walked. */
        // effort on the floor is the behaviour being asked for, not waste
        const eScale = this.downed ? FIT.ENERGY_DOWN_W : 1;
        let maxErr = 0;
        for (let j = 0; j < this.nj; j++) {
            const e = Math.abs(this.cmd[j] - this.target[j]);
            if (e > maxErr) maxErr = e;
        }
        const step = maxErr * lag;
        const cap = SIM2REAL.setpointSlewMax * dt;
        if (step > cap && maxErr > 1e-9) lag *= cap / step;

        for (let j = 0; j < this.nj; j++) {
            // A plain first-order lag, deliberately NOT a per-joint slew-rate
            // cap: a rate cap makes every joint travel at the same speed, so the
            // small-error joints arrive long before the large-error ones and the
            // rise passes through a posture with the feet no longer flat. The
            // lag moves every joint proportionally, i.e. straight from the
            // crouch to the target in joint space, which keeps the soles down.
            this.target[j] += (this.cmd[j] - this.target[j]) * lag;
            const e = this.target[j] - mb.q[j + 1];
            let t = M.kp[j] * kScale * TUNE.servoScale * e - M.kd[j] * mb.qd[6 + j];
            if (world.noise) t *= 1 + nrand(this.rng) * SIM2REAL.torqueJitter;
            const lim = M.tauMax[j] * tScale;
            if (t > lim) t = lim; else if (t < -lim) t = -lim;
            // The actuator's own work, metered BEFORE the mechanical stop is
            // added below: a limb resting against its end stop is not spending
            // battery, and charging it for that would put a fictitious cost on
            // exactly the postures the floor poses live in.
            this.energy += Math.abs(t * mb.qd[6 + j]) * dt * eScale;

            /* THE MECHANICAL HARD STOP, as a torque.
             *
             * It used to live in integrate() as a position edit: a joint past
             * its limit was teleported back and its velocity set to zero. In a
             * multibody tree, arresting one body takes an impulse that has to
             * propagate to every other body — the shoulder stopping is something
             * the torso must feel. Zeroing one coordinate on its own conserves
             * neither momentum nor energy, and it fired on 21% of ticks in
             * ordinary walking and 34% in the floor poses. Measured: 97% of
             * sudden spin-ups landed on a tick where it fired. That is where the
             * 2.8-revolutions-per-second spin on the stomach came from, and it
             * is why an 8x smaller timestep never helped — a position edit does
             * not care how small dt is.
             *
             * Written as a torque it goes into tau, through the same articulated
             * -body solve as gravity and contact, and the reaction reaches the
             * rest of the body the way physics requires. It is deliberately NOT
             * subject to tauMax: an actuator has a torque ceiling, a lump of
             * metal does not. Damped only while the joint is still travelling
             * further in, so the stop can never pull a joint back out.
             *
             * Measured over 24 episodes on identical seeds, crouch starts:
             *   backstop firings   21.0% of ticks -> 0.00%
             *   peak spin          24.5 -> 8.2 rad/s
             *   peak speed          9.3 -> 3.7 m/s
             *   waypoints             9 -> 19,  fitness 2113 -> 4649
             * The walker got dramatically BETTER, because it was being robbed. */
            const qj = mb.q[j + 1], vj = mb.qd[6 + j], bd = M.bodies[j + 1];
            let over = 0;
            if (qj > bd.qmax) over = qj - bd.qmax; else if (qj < bd.qmin) over = qj - bd.qmin;
            if (over !== 0) {
                t -= JOINT_STOP_K * over;
                if (over * vj > 0) t -= JOINT_STOP_C * vj;
            }
            this.tau[j + 1] = t;
        }
    }

    /* ------------------------------------------------------------ bookkeeping */
    /* Called once per control tick, after control() and the physics that follows. */
    tick(world) {
        const M = this.model, mb = this.mb, dtc = CTRL_DT;
        this.phase += 2 * Math.PI * GAIT_HZ * this.cadence * dtc;
        if (this.phase > 1e6) this.phase -= 1e6;
        const up = this.uprightness();
        const clr = this.groundClearance(world);
        const heightFrac = clamp((clr - 0.45 * M.standHipY) / (0.95 * M.standHipY - 0.45 * M.standHipY), 0, 1);

        // ---- stage 1: posture. Income, but only while standing up is the job.
        if (world.phase === "stand") this.fitScore += FIT.POSTURE * up * heightFrac * dtc;
        if (up > 0.6) this.uprightTime += dtc;

        // ---- milestone: actually stood up. Held, not brushed past: a walker
        // toppling forwards clips full height for one tick on the way over, and
        // paying it the stand bonus for that made the milestone meaningless.
        if (!this.stood) {
            if (up > 0.80 && clr > 0.93 * M.standHipY) this.standTimer += dtc; else this.standTimer = 0;
            if (this.standTimer >= STAND_HOLD) {
                this.stood = true;
                this.stoodAt = world.time;
                this.fitScore += FIT.STAND_BONUS;
            }
        }

        // ---- stage 2: holding it. Only counts once it has stood, and only
        // while holding still is the job.
        if (this.stood) {
            if (world.phase === "balance") this.fitScore += FIT.UPRIGHT * up * dtc;
            if (!this.balanced && up > 0.6 && world.time - this.stoodAt >= BALANCE_HOLD) {
                this.balanced = true;
                this.fitScore += FIT.BALANCE_BONUS;
            }
            // Capped, for the same reason POSTURE stops paying once the stand
            // phase ends. Uncapped, this was the third-largest line in the
            // champion's ledger — 450 points, more than everything it earned by
            // moving forward — and every one of those points is paid for being
            // a stationary rock that a shove cannot topple. A walker in motion
            // is far easier to knock over, so an unbounded shove bonus is a
            // standing subsidy that grows with episode length. Two is enough to
            // teach the skill; after that, staying up has to pay for itself
            // through the walking terms.
            if (this.pendingPush > 0) {
                this.pendingPush -= dtc;
                if (this.pendingPush <= 0 && up > 0.6 && this.pushesSurvived < FIT.PUSH_CAP) {
                    this.pushesSurvived++;
                    this.fitScore += FIT.PUSH_BONUS;
                }
            }
        }

        // ---- odometer, for the wander penalty
        const dx = mb.bp[0] - this._lastPx, dz = mb.bp[2] - this._lastPz;
        this._lastPx = mb.bp[0]; this._lastPz = mb.bp[2];
        if (this.stood) this.pathLen += Math.hypot(dx, dz);

        // ---- stage 3: walking. Only counts once it has proved it can stand
        // still. Progress is banked per metre as it is earned, and only when it
        // improves on the closest approach so far, so a walker rocking back and
        // forth across the same metre is paid for it exactly once.
        if (world.phase === "walk" && up > 0.4) this.fitScore += FIT.ALIVE_WALK * dtc;

        // ---- stepping: the rung between standing and walking.
        // A step is a foot that leaves the ground COMPLETELY for at least 80 ms
        // and comes back down somewhere else. "Load went light" is not enough —
        // a walker can unload a foot by leaning, and when that counted, the
        // population learned to rock on the spot and evolution deleted the gait.
        // The pay is mostly for how far forward the foot actually landed.
        if (world.phase === "walk" && up > 0.6) {
            const wp = world.waypointFor(this);
            let ux = 1, uz = 0;
            if (wp) {
                const dx = wp.x - mb.bp[0], dz = wp.z - mb.bp[2], L = Math.hypot(dx, dz) || 1;
                ux = dx / L; uz = dz / L;
            }
            for (let s = 0; s < 2; s++) {
                const airborne = this.footContact[s] === 0;
                if (airborne) {
                    if (!this.footAirborne[s]) {
                        this.footAirborne[s] = true;
                        this.footAir[s] = 0;
                        mb.worldPoint(M.footBody[s], 0, -M.seg.ankleH, 0, this._p, 0);
                        this.footOff[s * 2] = this._p[0];
                        this.footOff[s * 2 + 1] = this._p[2];
                    }
                    this.footAir[s] += dtc;
                } else if (this.footAirborne[s]) {
                    this.footAirborne[s] = false;
                    if (this.footAir[s] >= 0.08) {
                        mb.worldPoint(M.footBody[s], 0, -M.seg.ankleH, 0, this._p, 0);
                        const fwd = (this._p[0] - this.footOff[s * 2]) * ux +
                            (this._p[2] - this.footOff[s * 2 + 1]) * uz;
                        this.steps++;
                        this.strideSum += Math.max(0, fwd);
                        if (this.steps <= FIT.STEP_CAP) this._payShape(FIT.STEP);
                        this._payShape(FIT.STRIDE_PER_M * clamp(fwd, 0, FIT.STRIDE_MAX));
                    }
                }
            }
        } else {
            // Outside the gate, forget any swing in progress. Otherwise a walker
            // that stumbles mid-swing, drops below the uprightness threshold and
            // recovers gets its landing credited against a stale, long-since
            // abandoned take-off point.
            this.footAirborne[0] = this.footAirborne[1] = false;
        }
        // Gated on `stood`, not on `balanced`. Gating it on the harder milestone
        // looked tidier but starved 85% of the fleet of any walking signal at
        // all, and a gradient nobody can feel is not a gradient.
        if (this.stood && world.phase === "walk") {
            this.walkTime += dtc;
            const wp = world.waypointFor(this);
            if (wp) {
                const d = Math.hypot(wp.x - mb.bp[0], wp.z - mb.bp[2]);
                if (up > 0.5 && d < this.bestDist) {
                    const closed = this.bestDist - d;
                    const align = this.headingAlign(wp);
                    this.progressM += closed;
                    this._payProgress(closed, align);
                    // Closure-weighted, so it reports how the metres that
                    // COUNTED were walked rather than how the walker was facing
                    // while stationary. Reported whether or not HEADING_W is on:
                    // the control run has to measure the same thing or there is
                    // nothing to compare the experiment against.
                    this.alignSum += align * closed;
                    this.bestDist = d;
                }
                if (d < world.arriveRadius && up > 0.6) this._arrive(world, d);
            }
        }

        // ---- fall detection: a sustained collapse ends the episode
        /* A decaying running maximum of centre-of-mass height, used to price the
         * fall below. It has to decay: the plain maximum over the episode would
         * charge a walker that stood once and fell an hour later at full rate
         * for every subsequent collapse. 0.6 m/s empties it in about 1.5 s,
         * which is long enough to still be holding the pre-collapse height when
         * the fall is confirmed 0.15 s after it starts. */
        this.comPeak = Math.max(this.comHeight(world), this.comPeak - COM_PEAK_DECAY * dtc);
        /* Time-weighted mean COM height. This is the ranking signal for rise-trial
         * generations, and it is a MEAN rather than a maximum on purpose: the
         * whole lesson of the thrash-farming ratchet is that any max-over-episode
         * statistic pays for a spike that collapses. A walker that flails 8 cm
         * higher for a tenth of a second barely moves a mean, while one that gets
         * up and stays up moves it a great deal. dtc-weighted so a variable
         * control step cannot change the ranking. */
        this.comSum += this.comHeight(world) * dtc;
        this.comTime += dtc;
        const down = up < 0.35 || clr < 0.40 * M.standHipY;
        this.fallTimer = down ? this.fallTimer + dtc : 0;
        if (!this.downed && this.fallTimer > 0.15) {
            this.downed = true;
            this.falls++;
            this.downTimer = 0;
            this.bestComY = this.comHeight(world);   // rising is measured from where it landed
            this.fallSeverity = this._fallSeverity();
            /* Scaled by how high it fell FROM. A dive out of a full stand still
             * costs full price — comPeak is at standing height, the factor is 1,
             * and the anti-dive pricing the FALL constant exists for is
             * untouched. But toppling back out of a 30 cm partial rise is not a
             * dive, and charging it as one made attempting to stand strictly
             * worse than lying still: measured, one walker lifted its mass 90 cm,
             * earned 713 of ledger and 306 of rise income, and finished at -643
             * because the topple cost -982. That is a gradient pointing at
             * "never try", on the exact rung the curriculum is trying to teach. */
            const fromFrac = clamp(this.comPeak / M.standHipY, 0, 1);
            this.penalty += FIT.FALL * this.fallSeverity * fromFrac;
        }
        if (this.downed) {
            this.downTimer += dtc;
            // The reference height has to be taken AFTER the body settles, not
            // at the instant it went down. Measured: every ground pose loses
            // 15-25 cm of centre-of-mass height in the first half second just
            // collapsing onto the floor, so a reference taken at t=0 sits above
            // anything the walker can reach and the rise rung pays exactly zero
            // to everybody — the same "nothing to select on" failure the CPG was
            // introduced to fix, in a new place.
            if (!this.riseRefSet && this.downTimer > 0.5) {
                this.bestComY = this.comHeight(world);
                this.riseRefSet = true;
            }
            if (!this.riseRefSet) { this.timeLeft -= dtc; return; }
            // Income for lifting the centre of mass, paid on the best height
            // reached so far so it cannot be farmed by bouncing, and capped
            // across the episode so falling on purpose to re-earn it does not
            // become a strategy. This is the rung BELOW standing: lying still
            // pays nothing, getting the mass up pays, standing pays more.
            const com = this.comHeight(world);
            const room = FIT.COM_RISE_CAP - this.riseIncome;
            if (room > 0) {
                // Two terms, and both are needed. The first is DENSE — paid every
                // tick for how high the mass is right now — so a walker propped
                // on one elbow already outscores one lying flat, and selection
                // has a gradient from the very first generation that meets a
                // floor start. The second is DIRECTIONAL, paid only on beating
                // the best height so far, so the way to earn more is to keep
                // going up rather than to hover.
                let pay = FIT.COM_HOLD * clamp(com / M.standHipY, 0, 1) * dtc;
                /* THE RATCHET PAYS FOR SUSTAINED HEIGHT, NOT FOR SPIKES.
                 *
                 * It used to credit any instantaneous new maximum, and that made
                 * thrashing strictly better than competence. Measured on the
                 * quadruped rung, over three seconds: a controller frozen at the
                 * spawn posture holds the pose and earns 95; the champion flails,
                 * drops the COM from 0.376 to about 0.21 — and earns 107. A
                 * thrash that spikes 8 cm above the settle height collects 700 x
                 * 0.08 = 56, which is worth more than seconds of holding still.
                 * The reward was paying for VARIANCE, which is the same
                 * order-statistic trap that inflates a champion picked on its
                 * best single mission.
                 *
                 * `riseCand` is the height a rise has to hold for RISE_CREDIT_HOLD
                 * before it counts. A genuine rise passes through every height on
                 * its way up and stays there, so it loses nothing; a flail
                 * arrives and leaves before the timer completes and earns
                 * nothing. The credit is still paid on the full gain, so the
                 * gradient a real rise sees is unchanged. */
                if (com > this.bestComY) {
                    if (com >= this.riseCand) {
                        this.riseCandT += dtc;              // still at least this high
                    } else {
                        this.riseCand = com; this.riseCandT = 0;   // sank back, restart
                    }
                    if (this.riseCandT >= RISE_CREDIT_HOLD) {
                        pay += (this.riseCand - this.bestComY) * FIT.COM_RISE_PER_M;
                        this.bestComY = this.riseCand;
                        this.riseCandT = 0;
                    }
                } else { this.riseCand = com; this.riseCandT = 0; }
                pay = Math.min(pay, room);
                this.riseIncome += pay;
                this.fitScore += pay;
            } else if (com > this.bestComY) this.bestComY = com;
            if (up > 0.75 && clr > 0.78 * M.standHipY) {
                this.riseTimer += dtc;
                if (this.riseTimer > RISE_HOLD) {
                    this.downed = false;
                    this.riseTimer = 0; this.fallTimer = 0; this.downTimer = 0;
                    if (this.recoveries < FIT.RECOVER_CAP) {
                        this.recoveries++;
                        this.fitScore += FIT.RECOVER;
                    }
                }
            } else {
                this.riseTimer = 0;
                // A walker that has been down this long is not getting up, and
                // simulating it lying there is the single largest waste of
                // wall-clock in a generation.
                /* …but a walker that STARTED on the floor has not "been down this
                 * long" in the sense meant above — it has been down since tick
                 * one, through no failure of its own, and the clock was already
                 * running before it could act.
                 *
                 * The world already knows this and slides both phase boundaries
                 * by riseGrace for a floor start. This deadline was simply never
                 * told, so a pose start got six seconds to solve the hardest task
                 * in the project and was then retired with 16 of its 17 seconds
                 * unspent. Measured on the gen-1276 champion: EVERY pool pose —
                 * side plank, kneel, crow, side-sit — ended at exactly 6.00 s with
                 * the centre of mass around 0.20 m, against a crouch start that
                 * ran the full 20 s and scored 5588.
                 *
                 * So roughly one episode in ten was structurally unwinnable, and
                 * the rise reward had almost no episode left to pay on. */
                const downLimit = DOWN_TIMEOUT + (world.riseGrace || 0);
                if (this.downTimer > downLimit) this.done = true;
            }
        }
        this.timeLeft -= dtc;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.done = true; }
    }

    _arrive(world, d) {
        const legTime = world.time - this.legStartTime;
        let gain = FIT.ARRIVE;
        // Closure speed over the leg, so a long leg walked briskly beats a short
        // one dawdled. Guarded against a zero-length interval.
        const closureSpeed = this.legInitDist / Math.max(0.25, legTime);
        gain += FIT.ARRIVE_SPEED * Math.min(1, closureSpeed / FIT.ARRIVE_SPEED_REF);
        gain += FIT.TERRAIN_BONUS * world.terrain.difficulty * (world.terrain.id === "flat" ? 0 : 1);
        gain += FIT.WIND_BONUS * world.windFrac;
        // wander: distance walked beyond what this leg actually needed
        const excess = Math.max(0, this.pathLen - this.usefulLen - this.legInitDist * FIT.WANDER_SLACK);
        gain -= Math.min(FIT.WANDER_CAP, FIT.WANDER_W * excess);
        this.fitScore += gain;
        this.usefulLen = this.pathLen;
        this.arrivals++;
        this.timeLeft += world.arrivalTime;
        this.legIdx++;
        world.onArrival(this);
    }

    /* Walking income, against this leg's budget. The budget is sized to the leg
     * in beginLeg() so that it is exhausted AT the waypoint and never before.
     *
     * It used to be the flat constant WALK_LEG_CAP (960) shared with _payShape,
     * which meant income stopped after (960-250)/900 = 0.79 m of a leg 1.3-2.3 m
     * long. Measured on the generation-141 champion: 7 of 12 held-out missions
     * exhausted the budget with 0.73-1.47 m still to run, and held-out distance
     * sat at 1.01 m across thirty generations without moving. Past the cap every
     * further metre toward the waypoint paid nothing, so a hill-climbing GA had
     * a flat surface for the last ~60% of every leg and no way across it.
     *
     * The budget refills per leg, so a walker that keeps reaching waypoints
     * keeps being paid to walk — it is the *substitution* that is bounded, not
     * the skill. Closure cannot be farmed: the most a leg can ever pay is its
     * own length, and that total is only collectable by arriving. */
    _payWalk(pts) {
        const room = this.legBudget - this.legWalkScore;
        if (!(room > 0)) return;
        const p = Math.min(pts, room);
        this.legWalkScore += p;
        this.fitScore += p;
    }

    /* Steps and stride are the rung BELOW closure, so they get their own, much
     * smaller allowance. Sharing one pot would let a walker spend the leg's
     * whole budget shuffling on the spot — which is the shape of every exploit
     * this reward has produced so far. */
    _payShape(pts) {
        const room = FIT.WALK_SHAPE_CAP - this.legShapeScore;
        if (!(room > 0)) return;
        this.legShapeScore += Math.min(pts, room);
        this._payWalk(Math.min(pts, room));
    }

    /* Height of the whole body's centre of mass above the ground beneath it.
     * The one measurement that is meaningful in every pose a walker can be in —
     * prone, seated, half-risen or standing — which is exactly what the bottom
     * rung of the ladder needs. */
    /* Mean COM height over the episode so far — the rise-trial ranking signal.
     * Zero before the first tick so an unstarted walker cannot outrank a real
     * attempt by dividing by nothing. */
    meanCom() { return this.comTime > 0 ? this.comSum / this.comTime : 0; }

    comHeight(world) {
        const M = this.model, mb = this.mb;
        let m = 0, y = 0;
        for (let i = 0; i < M.bodies.length; i++) {
            const b = M.bodies[i];
            if (b.mass <= 0) continue;
            mb.worldPoint(i, b.com[0], b.com[1], b.com[2], this._p, 0);
            m += b.mass; y += b.mass * this._p[1];
        }
        if (m <= 0) return 0;
        const g = world ? world.terrain.height(mb.bp[0], mb.bp[2]) : 0;
        return y / m - g;
    }

    /* How hard did it go down? Torso speed at the moment of collapse, in
     * multiples of the base penalty. Floored at 1 so even a gentle sit-down
     * costs something, capped so a freak number cannot swamp the ledger. */
    _fallSeverity() {
        const b = this.model.bodies[2];
        this.mb.worldPointVel(2, b.com[0], b.com[1], b.com[2], this._v, 0);
        const s = Math.hypot(this._v[0], this._v[1], this._v[2]);
        return Math.min(FIT.FALL_MAX_MULT,
            1 + FIT.FALL_SPEED_W * Math.max(0, s - FIT.FALL_FREE_SPEED));
    }

    /* How squarely the pelvis points at the waypoint: 1 facing it, 0 at ninety
     * degrees or anywhere behind. Same relative bearing the brain already
     * senses on C_WPBEAR, so the reward is asking for something the walker can
     * actually perceive — a reward for a quantity that is not in the
     * observation is a reward for luck. */
    /* Mean alignment over the metres that counted. 1.0 = walked straight at the
     * waypoint throughout; ~0.0 = crab-walked the whole way. Returns 1 when
     * nothing was closed so an episode with no progress cannot drag the fleet
     * average toward "sideways" for a walker that simply never moved. */
    meanAlign() { return this.progressM > 1e-6 ? this.alignSum / this.progressM : 1; }

    headingAlign(wp) {
        const rel = wrapPi(Math.atan2(-(wp.z - this.mb.bp[2]), wp.x - this.mb.bp[0]) - this.heading());
        return Math.max(0, Math.cos(rel));
    }

    /* Closure toward the waypoint, paid as a fraction of THIS leg. `align` is
     * the heading multiplier; undefined means "unweighted", which is what every
     * caller outside the walk phase wants. */
    _payProgress(closed, align) {
        const w = FIT.HEADING_W;
        const k = w > 0 && align !== undefined ? (1 - w) + w * align : 1;
        if (FIT.WALK_PROGRESS_LEG > 0) {
            this._payWalk(FIT.WALK_PROGRESS_LEG * (closed / this.legInitDist) * k);
        } else {
            this._payWalk(closed * FIT.PROGRESS_PER_M * k);
        }
    }

    /* Called by World when a new leg starts. */
    beginLeg(world, wp) {
        this.legStartTime = world.time;
        this.legInitDist = Math.max(0.5, Math.hypot(wp.x - this.mb.bp[0], wp.z - this.mb.bp[2]));
        this.bestDist = this.legInitDist;
        this.legWalkScore = 0;
        this.legShapeScore = 0;
        // Size the budget to THIS leg: full closure at the full per-metre rate,
        // plus the shape allowance that shares the pot. Exhausted at the
        // waypoint, never short of it.
        this.legBudget = FIT.PROGRESS_PER_M * this.legInitDist + FIT.WALK_SHAPE_CAP;
    }

    /* Live fitness. Progress is banked as it is earned, so this is only the
     * ledger minus the capped penalties. */
    fitness() {
        let f = this.fitScore + this.penalty;
        f -= Math.min(FIT.ENERGY_CAP, FIT.ENERGY_W * this.energy);
        const excess = Math.max(0, this.pathLen - this.usefulLen - this.legInitDist * FIT.WANDER_SLACK);
        f -= Math.min(FIT.WANDER_CAP, FIT.WANDER_W * excess);
        /* On an episode that STARTED on the floor, everything earned is scaled by
         * how high the walker ever got its mass. Not another additive term: the
         * whole rise ladder is capped at 620 against 1200 for a single waypoint,
         * so a brain going from never rising to rising perfectly gained under 1%
         * of its total — shaped correctly and worth nothing selection could see.
         *
         * A multiplier fixes that without touching the tier bounds, which is the
         * same reason heading is a multiplier here and not a bonus: an additive
         * heading term got farmed, a closure multiplier could not be. Getting up
         * is not paid, it is the GATE on being paid for the walking that follows,
         * so it cannot be traded against waypoints — it gates them.
         *
         * Applied to positive scores only. Scaling a negative total by less than
         * one would shrink the penalty, and a walker that stays down would be
         * rewarded for failing to rise. */
        if (this.startedDown && f > 0) {
            const riseFrac = clamp(this.bestComY / this.model.standHipY, 0, 1);
            f *= FIT.RISE_GATE + (1 - FIT.RISE_GATE) * riseFrac;
        }
        return f;
    }
}

if (typeof module !== "undefined") {
    module.exports = { Walker, nrand, CPG_GROUPS, DT, CONTROL_EVERY, CTRL_DT, NET_SIZES, NC, NIN, NOUT, TEMPORAL, TGAIN, TAP_PLAN, WIN, NWIN, MAXHIST, FIT, TUNE, setTune, TIERED, FLAT, setReward, CONTACT, SIM2REAL, GAIT_HZ, STAND_HOLD, BALANCE_HOLD, wrapPi, clamp,
        C_COMVEL, C_COMH, C_COMPOS, C_CAPTURE,
        C_TERRAIN, C_FOOTCLR, C_FOOTATT, C_PATCH, PATCH_CHANNELS,
        PATCH_N, PATCH_CELLS, PATCH_OFF, PATCH_FWD, PATCH_SPACING,
        RING_R, RING_DIRS, PATCH_ON, N_FAN,
        DATUM_SCALE, CLEAR_SCALE, ATT_SCALE, NORMAL_STEP, signedAngleAbout };
}
