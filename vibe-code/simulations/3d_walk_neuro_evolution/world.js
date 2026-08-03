/* world.js — one episode: the whole population on one patch of ground, under
 * one weather, walking one identical mission.
 *
 * Fairness rule, inherited from the boats sim and worth restating because it is
 * the thing that makes selection mean anything: every walker spawns at the SAME
 * spot in the SAME pose on the SAME terrain, gets the SAME waypoints, the SAME
 * gusts, the SAME shoves at the SAME instants, and even the SAME stream of
 * sensor noise. Walkers do not collide or see each other. The only difference
 * between two of them is the weights in their heads. (The renderer draws them
 * as an overlapping ghost swarm, because that is literally where they are.)
 *
 * Every episode replays the entire curriculum in order:
 *
 *   0.0 – 1.6 s   STAND     rise out of the half-squat and reach full height
 *   1.6 – 3.2 s   BALANCE   hold it; from stage 2 on, take a shove
 *   3.2 s – end   WALK      chase waypoints; from stage 4 the ground tilts and
 *                           steps, from stage 5 the wind blows
 *
 * The first two windows are short on purpose. They were 2.5 s each until a
 * trace showed that 0 of 40 first-generation walkers were still upright at the
 * 5.0 s mark — so not one of them ever entered the walk phase, and the walking
 * half of the fitness function was unreachable dead code.
 *
 * so a walker physically cannot be scored for walking before it has stood and
 * held still — the gating lives in walker.tick(), the environment ramp lives
 * here, and stageFor() in evolution.js decides when the ramp advances.
 */
"use strict";

const PHASE_STAND = 1.6;
const PHASE_BALANCE = 3.2;
const ARRIVE_RADIUS = 0.55;
const START_BUDGET = 17;            // s on each walker's own clock
// Reaching a waypoint has to buy enough clock to actually attempt the next one.
// At 9 s it did not: a walker covers ~1.3-2.3 m per leg at roughly 0.2 m/s of
// honest closure, so nine seconds bought under half a leg and the second
// waypoint was unreachable even in principle. The whole point of the reward is
// that arriving compounds — it must hand back more time than the leg cost.
const ARRIVAL_TIME = 50;            // s added per waypoint reached — reaching one
                                    // buys the time to go after the next
const MAX_CLOCK = 90;
const RISE_GRACE = 5.0;             // s of extra clock and phase delay for a floor start
/* How far through the searched rise the reference drives before the brain takes
 * over. Dealt from a fixed ladder rather than sampled, so every generation
 * contains the easy rung: at 0.90 the brain only has to finish the last 0.3 s,
 * which is the first rewarding step this skill has ever had. 0.35 is close to
 * unaided. Must stay identical to SCAFFOLD_HANDOVER in world.hpp. */
const SCAFFOLD_HANDOVER = [0.90, 0.75, 0.55, 0.35];
const EPISODE_HARD_CAP = 130;       // s of wall-clock sim, last-resort backstop
const MAX_ARRIVALS = 40;

/* What the environment throws at the population at each stage. */
/* `ground` is the fraction of episodes that begin on the floor instead of in a
 * crouch, and `groundHard` how far down the pose list it is allowed to reach
 * (0 = seated only, 1 = anything including face-down). Both ramp with the
 * stage: a fleet that cannot rise from a crouch has no business being dropped
 * prone, and starting every episode on the floor from generation 1 leaves a
 * random brain with nothing at all to grip. */
/* `ground` is the fraction of episodes that start lower than the usual crouch,
 * and `crouchDepth` how much lower — 0 is the normal half-squat, 1 a folded
 * squat with the hips near the heels.
 *
 * The FLOOR poses (seated, supine, prone) are built and tested and deliberately
 * switched off. Measured: four hand-scripted rise attempts from every one of
 * them left the centre of mass at exactly its starting height, and six
 * independently evolved champions all gained under 2 cm. The obstacle is not
 * torque — the actuators can lift the body out of a fully folded squat with
 * room to spare — it is that lying down, the feet are not under the mass, so
 * extending the legs slides the body along the floor instead of raising it.
 * Getting up needs roll, tuck the feet under, then press: a multi-phase
 * sequence with no gradient leading into it, which is a project rather than a
 * parameter. Depth is the part of "getting up" that IS a ramp, so it is the
 * part being trained now. model.groundPoses stays for that later project. */
const STAGES = [
    // `spin` is the chance a leg doubles back behind the walker, forcing it to
    // turn rather than only steering. Zero on stage 1 (it cannot walk yet) and
    // deliberately modest at stage 2, where the fleet currently lives: a fleet
    // that can reach 2.7 waypoints going forwards should not have most of its
    // legs replaced by a skill it has never practised.
    /* One new demand per rung. Stage 3 used to raise four at once — shoves x2,
     * turn x3.3, crouch depth x1.7, turn-arounds x1.55 — and the measured effect
     * of arriving there was immediate: a fleet worth 21,572 on stage 2 scored
     * 3,605 with a NEGATIVE average, 43% balancing, 0.09 m walked. That happened
     * twice, once through a faulty gate and once on an honestly earned
     * promotion, which is how you tell the stage is the problem and not the gate.
     *
     * So stage 3 is now purely "learn to turn": the course twists and doubles
     * back, and everything else stays exactly where stage 2 left it. The shoves
     * and the deeper crouches move to stage 4, alongside the terrain. */
    /* `terrain` is now a per-stage CEILING on ground relief, not an on/off flag.
     * Flat-only training is gone: from stage 2 the ground already moves under the
     * walker, gently, so terrain is something it grows up with rather than a wall
     * it hits at promotion. Stage 4 collapsed a 32,460-fitness fleet to 2,389 and
     * never recovered over 500 generations precisely because terrain arrived all
     * at once — at difficulty 0.15, the gentlest setting, which is how you know
     * the step change was the problem and not the roughness. */
    /* TERRAIN AND FLOOR STARTS NOW BEGIN AT STAGE 1.
     *
     * The old table saved them for later, and the arithmetic of "later" was
     * fatal. Effective difficulty is stage.terrain MULTIPLIED by the curriculum's
     * ramp, so a fleet parked on stage 2 trained at 0.12 x 0.15 = 0.018 — a rise
     * of 2.2 cm, times 0.8 on mixed ground, so 1.8 cm bumps. Meanwhile the first
     * stair riser sat 1.8 m from the spawn and the fleet's mean walked distance
     * was 0.65 m. The population had therefore never touched a stair, and the
     * held-out result said exactly that: 6.75 waypoints on the flat, 0.83 on
     * terrain. Terrain competence was not being under-trained, it was untrained.
     *
     * The thing that made front-loading unsafe before was that terrain arrived
     * as a step change for the whole fleet at once — stage 4 collapsed a 32,460
     * fleet to 2,389 and never recovered. That is fixed differently now: every
     * episode draws its own difficulty from a spread (see the terrain block in
     * the constructor), so a single generation contains easy and hard ground
     * simultaneously and selection has a gradient at every roughness at once,
     * instead of the whole population being moved onto a cliff together.
     *
     * WHAT IS STILL TAPERED, and why it is not the same thing. Terrain, floor
     * starts and crouch depth are SKILLS — the walker can get better at them, so
     * meeting them early is practice. Wind and shoves are DISTURBANCES: they add
     * variance to the measurement without teaching anything, so front-loading
     * them makes selection noisier about who is actually better. Those two still
     * ramp. */
    { n: 1, name: "stand",   pushes: 0,    wind: 0,    terrain: 0.35, turn: 0.15, spin: 0,    ground: 0.33, crouchDepth: 0.35, seat: 0.66, seatDepth: 0.15, pose: 0.10, scaffold: 0.60 },
    { n: 2, name: "balance", pushes: 0.20, wind: 0,    terrain: 0.55, turn: 0.30, spin: 0.18, ground: 0.33, crouchDepth: 0.45, seat: 0.66, seatDepth: 0.30, pose: 0.10, scaffold: 0.60 },
    // Stage 3 adds turning; the ground keeps getting rougher underneath it.
    { n: 3, name: "turn",    pushes: 0.35, wind: 0,    terrain: 0.75, turn: 0.70, spin: 0.30, ground: 0.33, crouchDepth: 0.55, seat: 0.66, seatDepth: 0.50, pose: 0.10, scaffold: 0.60 },
    // Stage 4 is where the disturbances start to bite, one notch at a time. It
    // used to raise shoves, wind, terrain and crouch depth together — the same
    // four-at-once mistake that made stage 3 a cliff and cost 170 generations
    // twice.
    { n: 4, name: "terrain", pushes: 0.50, wind: 0.35, terrain: 0.90, turn: 1.00, spin: 0.33, ground: 0.33, crouchDepth: 0.75, seat: 0.66, seatDepth: 0.75, pose: 0.10, scaffold: 0.60 },
    // Stage 5 consolidates: full shoves, full wind, the deepest starts.
    { n: 5, name: "wind",    pushes: 1.00, wind: 1.00, terrain: 1.00, turn: 1.00, spin: 0.33, ground: 0.33, crouchDepth: 1.00, seat: 0.66, seatDepth: 1.00, pose: 0.10, scaffold: 0.60 }
];

class World {
    constructor(model, brains, opts) {
        this.model = model;
        this.opts = opts;
        this.stage = STAGES[Math.max(0, Math.min(STAGES.length - 1, (opts.stage || 1) - 1))];
        this.rng = mulberry32(4100 + (opts.missionSeed || 1) * 7919);
        this.time = 0;
        this.tick = 0;
        this.phase = "stand";
        this.events = [];
        this.noise = opts.noise !== false;
        this.arriveRadius = ARRIVE_RADIUS;
        this.arrivalTime = ARRIVAL_TIME;

        // ---- per-episode domain randomisation, drawn once and shared by all ----
        const r = this.rng;
        this.frictionScale = 1 + (r() - 0.5) * 0.30;
        this.torqueScale = 1 + (r() - 0.5) * 0.16;
        this.gainScale = 1 + (r() - 0.5) * 0.20;
        if (!this.noise) { this.frictionScale = 1; this.torqueScale = 1; this.gainScale = 1; }
        // One jitter draw for the whole fleet: every walker starts in the same
        // imperfect pose, so a lucky spawn cannot be mistaken for a good brain.
        this.jitterPose = new Float64Array(model.nj);
        if (this.noise) for (let j = 0; j < model.nj; j++) this.jitterPose[j] = (r() * 2 - 1) * 0.025;

        /* ---- terrain ----
         *
         * Difficulty is drawn PER EPISODE from a spread below the stage ceiling,
         * not set once for the whole fleet. This is what makes front-loading
         * terrain safe. With a single shared difficulty, raising it moves every
         * genome onto harder ground on the same generation, and if that is past
         * what the fleet can do, every score collapses together and selection
         * has nothing to rank — the stage-4 cliff, measured twice. With a
         * spread, one generation contains gentle and rough missions at the same
         * time: a genome that can only handle gentle ground still scores on
         * those episodes, one that handles rough ground scores on more of them,
         * and the difference between them is visible immediately rather than
         * after the ramp catches up.
         *
         * The floor of 0.2 of the ceiling keeps a genuinely easy tail in the
         * distribution at every stage, so a fleet that stumbles can always find
         * its footing again on some fraction of its missions.
         *
         * STRATIFIED, not i.i.d. The spread above is right; drawing it
         * independently per episode is not. With seven episodes, the REALISED
         * mix of a generation's bank — how many staircases, how rough, how many
         * floor starts — is itself a random variable, and it swings hard.
         * Measured with `mission_variance.js`: one unchanged brain scores 7,786
         * on generation 90's bank and 416 on generation 100's, an 18.7x swing
         * with not one weight altered, and it reproduces the live run's "best
         * fitness" curve to the digit. A curve like that is a picture of the
         * calendar, and the champion gets unseated by it.
         *
         * So the COMPOSITION is fixed and only the INSTANCES vary: episode slot
         * e owns band e of the difficulty range and surface e % 3, and the floor
         * starts are dealt out evenly across the slots. Every generation meets
         * the same distribution; no generation meets the same missions. */
        const E = opts.episodeCount | 0, eSlot = opts.episodeSlot | 0;
        const strat = E > 1 && eSlot >= 0 && eSlot < E;
        /* Bresenham: exactly floor(n*frac) of the n slots, spread evenly rather
         * than bunched at one end — a block of floor starts at the easy end of
         * the difficulty ladder would just be a different bias. */
        const quota = (i, n, frac) => Math.floor((i + 1) * frac) > Math.floor(i * frac);
        const gcd = (a, b) => b ? gcd(b, a % b) : a;

        const terrCeil = (opts.terrainDifficulty != null ? opts.terrainDifficulty : 1) * this.stage.terrain;
        let terrFrac;
        if (opts.terrainFixed) terrFrac = 1;
        else if (strat) terrFrac = (eSlot + r()) / E;    // this slot owns one band, jittered inside it
        else terrFrac = r();
        const terrDiff = opts.terrainFixed ? terrCeil : terrCeil * (0.2 + 0.8 * terrFrac);
        /* "varied" is not a surface — it means draw one per episode, so the
         * fleet meets undulation, staircases and both together instead of
         * specialising on whichever single one the run was launched with. */
        let terrId = opts.terrainId || "rolling";
        if (terrId === "varied") terrId = ["rolling", "stairs", "mixed"][strat ? eSlot % 3 : Math.floor(r() * 3) % 3];
        if (terrCeil <= 0) terrId = "flat";
        this.terrain = new Terrain(terrId, terrDiff, r);

        // ---- weather ----
        this.windFrac = this.stage.wind * (opts.windScale != null ? opts.windScale : 1);
        this.windOn = this.windFrac > 0.001;
        this.windSpeed = 0;
        this.windDir = r() * Math.PI * 2;
        this.windTarget = this.windFrac * (4 + r() * 6);            // m/s
        this.wind = [0, 0, 0];

        // ---- shoves ----
        this.pushLevel = this.stage.pushes * (opts.pushScale != null ? opts.pushScale : 1);
        // nextPush is set below, once the rise grace is known — a walker on its
        // back should not be shoved while it is still getting up.

        // ---- the shared mission ----
        /* Stratified too, and it is not a small term. The waypoint chain is laid
         * out relative to the start heading, so yaw does not change where the
         * walker is asked to go — but the terrain is a fixed field in world
         * coordinates, so yaw decides whether the route crosses the ridges or
         * runs along them. Uniform over a full turn, seven episodes can land
         * mostly along-ridge one generation and mostly across-ridge the next.
         *
         * The slot ordering is deliberately NOT the terrain's. Keyed to eSlot
         * directly, the gentlest ground would always be paired with the same
         * heading and the bank would trade one bias for another; a stride
         * coprime with the episode count permutes the bands instead. */
        let yawFrac;
        if (strat) {
            let k = 2;
            while (k < E && gcd(k, E) !== 1) k++;
            yawFrac = (((eSlot * k) % E) + r()) / E;
        } else yawFrac = r();
        this.startYaw = (yawFrac * 2 - 1) * Math.PI;
        this.spawn = { x: 0, z: 0 };
        this.points = [];
        this._pointRng = mulberry32(6700 + (opts.missionSeed || 1) * 3571);
        this._lastHeading = this.startYaw;
        this._spawnPoint();

        /* ---- where everyone starts ----
         * One draw for the whole fleet, like the pose jitter and the weather:
         * if half the population were dropped prone and half started standing,
         * the score would be measuring the draw and not the brain. */
        const gFrac = opts.groundFrac != null ? opts.groundFrac : this.stage.ground;
        const maxDepth = opts.crouchDepth != null ? opts.crouchDepth : this.stage.crouchDepth;
        this.startPose = null;
        /* A slice of the ground starts are a genuine floor pose — sitting on the
         * backside, or fallen on one side — rather than a deep crouch. Rising
         * from those is unsolved: a scripted probe found the failure is
         * geometric, not a lack of torque (the feet are not under the mass), so
         * this is an experiment and may simply not converge.
         *
         * It is kept deliberately small. With 7 episodes per generation a
         * seatFrac of 0.2 on a 0.35 ground fraction puts roughly one episode in
         * fourteen on the floor, so the walking signal stays dominant and the
         * skill the fleet already has cannot be bred out by a rung it cannot yet
         * climb. The arms can now feel the floor and cannot pass through the
         * chest, which is what makes pressing up physically meaningful at all. */
        const seatFrac = opts.seatFrac != null ? opts.seatFrac : (this.stage.seat || 0);
        /* Stratified like the terrain, and for the same reason: a 0.45 ground
         * fraction over seven i.i.d. episodes delivers anywhere from one floor
         * start to six, and a bank with six is a different exam from a bank with
         * one. Dealt evenly across the slots, every generation gets the same
         * count. Seat starts are a subset of the ground starts so the two
         * quotas cannot collide. */
        const groundHit = strat ? quota(eSlot, E, gFrac) : null;
        const seatHit = strat ? (groundHit && quota(eSlot, E, gFrac * seatFrac)) : null;
        if (gFrac > 0 && seatFrac > 0 && model.groundPoses && (strat ? seatHit : r() < gFrac * seatFrac)) {
            // The gentler two: seated and side-lying. Supine and prone are a
            // different problem again and would only dilute the attempt.
            // Seated only. The side-lying pose is not recoverable by ANY command
            // sequence — a scripted attempt peaks at 0.30 m against a standing
            // 0.84 — because it needs a roll-over first. Spending the floor
            // budget on a rung nothing can climb just deletes episodes that could
            // have taught the rung that IS climbable: from the tucked sit a
            // scripted rise reaches 0.60 m.
            /* Ramped, not jumped. The full seat used to be handed over whole,
             * and the exam has read 0/6 on it for every champion this project
             * has produced while the folded squat one rung below reads 3/6.
             * `seatAt` interpolates between them, so the fleet meets the seat
             * the way it met crouch depth — a little further back each stage,
             * with a rise gradient the whole way.
             *
             * Drawn across a band rather than always the deepest, for the same
             * reason the crouch draw is: the shallow rungs are banked skill and
             * a fleet that only ever sees the hardest one trades them away. */
            const maxSeat = opts.seatDepth != null ? opts.seatDepth : (this.stage.seatDepth || 0);
            /* riseAt, not seatAt. seatAt interpolated crouch -> "seated" and
             * measured out as a slightly SHALLOWER squat — hip 86 deg against the
             * deep crouch's 92 — and every rung of it touched the ground with FOOT
             * and nothing else. So the whole rise curriculum trained one contact
             * configuration and the exam then asked for a different one. riseAt
             * walks the contact sets instead: Foot, Foot+Shank, +Hand, Hand.
             * Exactly one r() either way, so the draw stream is unchanged and the
             * C++ trainer still replays the same episodes. */
            this.startPose = model.riseAt(maxSeat * (0.25 + 0.75 * r()));
        }
        /* ---- the pose pool ----
         * A slice of the ground budget spent on one of model.startPoses instead
         * of a rung on the crouch/seat ramp. The ramp varies one thing — how far
         * down the walker starts — and every rung on it is square to the world,
         * symmetric, and standing on its feet. The pool is the other axis: on the
         * hands, on one arm, on the knees, rolled onto an edge, folded to one
         * side. Nothing in the ramp has ever loaded hip roll or twisted the waist.
         *
         * Drawn AFTER the seat test and BEFORE the crouch test, and it consumes
         * exactly one r() when it fires — the C++ trainer replays this same
         * sequence and `verify --episode` compares the draws in order, so where a
         * draw sits in the stream is part of the interface, not an implementation
         * detail.
         *
         * Every asymmetric pose is in the pool alongside its mirror, so the draw
         * cannot hand the fleet a systematic left-right bias the way a single
         * warrior3 would: a pool that only ever balances on the left foot trains
         * a walker that only balances on the left foot. */
        /* `pose` is a share of ALL episodes, not of the ground episodes. It used
         * to be nested inside groundFrac, so `ground 0.45, pose 0.30` meant the
         * fourteen floor poses got 13.5% of spawns rather than the 30% the table
         * appeared to say.
         *
         * READ THE COMPOSITION, NOT THE ROW. Fixing pose's own denominator was
         * not enough and made things worse for a while: seat, pose and crouch are
         * three sequential tests, each honest about itself and none of them about
         * the total. With `ground 0.45, seat 0.30, pose 0.40` the seat took
         * 0.45*0.30 first, pose took 0.40 of the survivors, crouch took 0.45 of
         * what was left of that, and only 28% of episodes began standing — where
         * the request had been 60%. stoodFrac fell 0.89 -> 0.53 in three
         * generations and stayed there, which reads exactly like the fleet
         * forgetting how to stand and was nothing of the kind: the population was
         * unchanged and the exam had got much harder.
         *
         * So the numbers in the table are now set from the MEASURED mix rather
         * than from what each row looks like on its own. At every stage:
         *
         *   standing 58.2%   pose 20.3%   crouch 15.2%   seat 6.4%
         *
         * spawn_mix.js prints that table; change any of the three fractions and
         * re-run it rather than reasoning about the product. */
        const poseFrac = opts.poseFrac != null ? opts.poseFrac : (this.stage.pose || 0);
        const poseHit = strat ? quota(eSlot, E, poseFrac) : null;
        if (!this.startPose && poseFrac > 0 && model.startPoses &&
            (strat ? poseHit : r() < poseFrac)) {
            const pool = model.startPoses;
            this.startPose = pool[Math.min(pool.length - 1, (r() * pool.length) | 0)];
        }
        if (!this.startPose && gFrac > 0 && maxDepth > 0 && (strat ? groundHit : r() < gFrac) && model.crouchAt) {
            // draw a depth rather than always using the deepest: the fleet needs
            // to keep the shallow rise it has banked, not trade it for the deep one
            this.startPose = model.crouchAt(0.25 * maxDepth + 0.75 * maxDepth * r());
        }
        /* ---- rise scaffolding ----
         *
         * A share of the rise-rung episodes have a SEARCHED reference trajectory
         * drive the joints for the first part of the rise, handing over to the
         * brain mid-motion. See the note in walker.js control() for why: the rise
         * has never had a reward gradient leading into it, because commanding the
         * standing posture from the floor drives the COM down first and punishes
         * the correct behaviour for its whole prefix.
         *
         * TWO DRAWS, TAKEN UNCONDITIONALLY. Not inside the `if` where they are
         * used — every episode consumes exactly two numbers here whether or not
         * it ends up scaffolded, and whether or not rise_scaffold.js is even
         * loaded. A branch-dependent draw count would make the stream depend on
         * the pose that happened to be drawn, and the C++ trainer and the JS
         * oracle would stop replaying the same episodes.
         *
         * The handover ladder is dealt from a fixed set rather than sampled on a
         * continuum, for the same reason the elite fleet deals density bands: a
         * generation must always contain the easy rung. At 0.90 the brain only
         * has to finish the last 0.3 s of a rise and the reward is immediately
         * positive — that is the first step of the ladder that has been missing.
         * Unscaffolded rise episodes remain in the bank at (1 - scaffoldFrac), so
         * a brain that can only rise with help still scores nothing on those. */
        const sHit = r(), sPick = r();
        this.scaffoldGene = null;
        this.scaffoldKnots = 0;
        this.scaffoldT = 0;
        this.scaffoldUntil = 0;
        this.scaffoldAt = 0;
        const sFrac = opts.scaffoldFrac != null ? opts.scaffoldFrac : (this.stage.scaffold || 0);
        /* Keyed off the POSE NAME, not off a field, and that is deliberate. The
         * obvious test is "does this pose carry a rise parameter" — but in JS
         * only riseAt sets `riseT`, while in C++ BOTH crouchAt and riseAt set
         * `seatT`. Testing the field would have scaffolded crouch episodes in the
         * trainer and not in the oracle, and the two builds would have drifted
         * apart while every test still passed. The name is generated by the same
         * `rise%.2f` format on both sides, so it is the one thing that cannot
         * disagree. */
        const isRise = this.startPose && typeof this.startPose.name === "string" &&
                       this.startPose.name.lastIndexOf("rise", 0) === 0;
        if (sFrac > 0 && typeof RISE_SCAFFOLD !== "undefined" && isRise) {
            const u = this.startPose.riseT;
            const ref = u >= 0.90 ? RISE_SCAFFOLD.prone
                      : u >= 0.65 ? RISE_SCAFFOLD.quadruped
                      : u >= 0.35 ? RISE_SCAFFOLD.kneel : null;
            if (ref && sHit < sFrac) {
                const h = SCAFFOLD_HANDOVER[Math.min(SCAFFOLD_HANDOVER.length - 1,
                    (sPick * SCAFFOLD_HANDOVER.length) | 0)];
                this.scaffoldGene = ref.gene;
                this.scaffoldKnots = ref.knots;
                this.scaffoldT = ref.T;
                this.scaffoldUntil = h * ref.T;
                this.scaffoldAt = h;
            }
        }
        /* An explicitly pinned pose REPLACES whatever was drawn, and does so
         * AFTER all three draws rather than instead of them. That ordering is the
         * whole point: every r() the draws would have consumed is still consumed
         * in the same order, so the mission RNG stream is bit-identical to an
         * unpinned episode and nothing downstream — terrain, waypoints, gusts —
         * shifts underneath it. Skipping the draws instead would desynchronise the
         * stream from the C++ trainer, and draw ORDER is interface here.
         *
         * Only the browser's watch mode sets this. Training must never pin a pose:
         * the spawn mix exists precisely so the fleet meets a distribution, and a
         * pinned population would be scored on one rung of it.
         *
         * The one exception is a RISE TRIAL, below, where pinning the pose is the
         * entire point and the generation is excluded from promotion because of
         * it. */
        if (opts.startPose) this.startPose = opts.startPose;

        /* ---- rise trial ----
         *
         * Every Nth generation the whole fleet starts on the floor in one fixed
         * pose and is ranked on mean COM height alone. Pinning is legitimate here
         * precisely because the generation is quarantined: it never updates the
         * champion, never advances the stage, and never enters the history the
         * plateau detector reads.
         *
         * The scaffold is switched OFF for the trial, and that is the point of
         * the exercise — the scaffold exists to create a gradient during ordinary
         * training, but a trial that measures rising must measure the brain
         * unaided or it is measuring the reference.
         *
         * Applied after every draw, so the mission stream is untouched. */
        if (opts.riseTrial) {
            const want = typeof opts.riseTrial === "string" ? opts.riseTrial : "prone";
            const pool = (model.groundPoses || []).concat(model.startPoses || []);
            const p = pool.find(q => q.name === want);
            if (p) this.startPose = p;
            this.scaffoldGene = null;
            this.scaffoldKnots = 0;
            this.scaffoldT = 0;
            this.scaffoldUntil = 0;
            this.scaffoldAt = 0;
            this.riseTrial = want;
        } else {
            this.riseTrial = null;
        }
        // Rising takes time an ordinary crouch does not need, so the phase
        // boundaries and the clock both slide when the episode starts low.
        this.riseGrace = this.startPose ? RISE_GRACE * (this.startPose.depth || 1) : 0;
        this.phaseStand = PHASE_STAND + this.riseGrace;
        this.phaseBalance = PHASE_BALANCE + this.riseGrace;
        this.nextPush = this.pushLevel > 0 ? this.phaseStand + 1.0 : Infinity;

        // ---- the population ----
        this.walkers = brains.map((b, i) => {
            const w = new Walker(b, i, model);
            w.reset(this, this.spawn.x, this.spawn.z, this.startYaw, this.startPose);
            w.timeLeft = (opts.startBudget || START_BUDGET) + this.riseGrace;
            w.rng = mulberry32(opts.noiseSeed || 20260729);         // identical stream for all
            return w;
        });
        this.leaderIdx = 0;
    }

    /* Next waypoint: a stride or two away, turned by at most the stage's limit.
     * Early stages keep the course nearly straight so a walker that can only go
     * forwards still scores; later ones make it turn. */
    _spawnPoint() {
        const prev = this.points.length ? this.points[this.points.length - 1] : this.spawn;
        const maxTurn = (0.35 + 1.6 * this.stage.turn);
        /* Some legs double back. Without this the course never turned more than
         * ±47° at stage 2 (±112° even at stage 5), so a waypoint was always
         * roughly ahead and the hip-yaw joints were never under selection
         * pressure — the fleet could score without ever learning to turn around.
         *
         * Never on the FIRST leg: that one still has to be reachable by a
         * newborn that can only topple forwards, or the bottom of the ladder
         * stops paying and the whole curriculum stalls. */
        const spin = this.points.length > 0 && this._pointRng() < (this.stage.spin || 0);
        const h = spin
            // Behind, but not exactly astern — a dead-on reversal is a
            // degenerate case the walker could solve by falling backwards.
            ? this._lastHeading + Math.PI + (this._pointRng() * 2 - 1) * 0.7
            : this._lastHeading + (this._pointRng() * 2 - 1) * maxTurn;
        // The first waypoint sits close enough that a wobbling early-generation
        // walker can plausibly touch it; later ones open out.
        const near = this.points.length === 0;
        const d = near ? 1.3 + this._pointRng() * 1.0 : 2.2 + this._pointRng() * 2.2;
        /* On terrain stages, put the waypoint somewhere the ground is doing
         * something. Left to chance the course simply drifted, and since the
         * turn limit is narrow the whole leg could sit on one landing — the
         * waypoints appeared to spawn only on the level. Draw a handful of
         * candidates inside the heading regime already chosen above and take the
         * one with the biggest height change from the previous point, so a leg
         * on stairs or hills actually crosses them.
         *
         * The jitter is bounded by the same maxTurn, so this biases WHERE within
         * the allowed cone the point lands; it never widens the cone and never
         * overrides a turn-around leg. On flat ground every candidate ties at
         * zero and the first one is taken, leaving stages 1-3 exactly as they
         * were. */
        /* Only hunt for relief once terrain is part of the lesson. At stage 2 the
         * ground is deliberately gentle, and actively seeking the worst of it
         * turned a 0.12 ceiling into 0.42 m steps — a knee-high riser for a body
         * whose hip stands at 0.84 m. Below the threshold the waypoint lands
         * wherever the course takes it, so early walkers meet slopes without
         * being sent looking for them. */
        const wantRelief = (this.stage.terrain || 0) >= 0.25 && this.terrain;
        const tries = wantRelief ? 6 : 1;
        let best = null, bestRelief = -1;
        for (let i = 0; i < tries; i++) {
            /* Jitter, then clamp back INSIDE the cone this leg is allowed. The
             * first version added up to maxTurn/2 on top of an h that was
             * already up to maxTurn, so it reached 1.5x the stage limit — the
             * comment claimed the cone was never widened and the cone was
             * widened. On a turn-around leg there is no cone to respect, so the
             * clamp is skipped there. */
            let hj = h + (i === 0 ? 0 : (this._pointRng() * 2 - 1) * maxTurn * 0.5);
            if (!spin && i > 0) {
                const off = Math.atan2(Math.sin(hj - this._lastHeading), Math.cos(hj - this._lastHeading));
                hj = this._lastHeading + Math.max(-maxTurn, Math.min(maxTurn, off));
            }
            const dj = i === 0 ? d : d * (0.75 + 0.5 * this._pointRng());
            const c = { x: prev.x + Math.cos(hj) * dj, z: prev.z - Math.sin(hj) * dj, h: hj };
            c.y = this.terrain.height(c.x, c.z);
            // Height change over the leg, plus the roughness sampled along it, so
            // a point across a flight beats one that merely ends higher.
            let relief = Math.abs(c.y - (prev.y || 0));
            for (let s = 1; s <= 3; s++) {
                const t = s / 4;
                const mx = prev.x + (c.x - prev.x) * t, mz = prev.z + (c.z - prev.z) * t;
                relief += Math.abs(this.terrain.height(mx, mz) - (prev.y || 0)) * 0.5;
            }
            if (relief > bestRelief) { bestRelief = relief; best = c; }
        }
        this._lastHeading = best.h;
        const p = { x: best.x, z: best.z, y: best.y };
        this.points.push(p);
        return p;
    }

    waypointFor(w) {
        while (w.legIdx >= this.points.length) this._spawnPoint();
        return this.points[w.legIdx];
    }

    onArrival(w) {
        if (w.arrivals >= MAX_ARRIVALS) { w.done = true; return; }
        if (w.timeLeft > MAX_CLOCK) w.timeLeft = MAX_CLOCK;
        w.beginLeg(this, this.waypointFor(w));
        if (w.idx === this.leaderIdx) this.events.push(`walker ${w.idx} reached waypoint #${w.arrivals}`);
    }

    _updWind() {
        if (!this.windOn) return;
        const r = this.rng;
        this.windSpeed += (this.windTarget - this.windSpeed) * 0.004 + (r() - 0.5) * 0.25 * this.windFrac;
        this.windSpeed = Math.max(0, Math.min(this.windTarget * 1.8, this.windSpeed));
        this.windDir += (r() - 0.5) * 0.02;
        this.wind[0] = Math.cos(this.windDir) * this.windSpeed;
        this.wind[2] = -Math.sin(this.windDir) * this.windSpeed;
    }

    /* One shove, identical for every walker, so surviving it is skill not luck. */
    _maybePush() {
        if (this.time < this.nextPush) return;
        const r = this.rng;
        const mag = this.pushLevel * (60 + r() * 120);
        const dir = r() * Math.PI * 2;
        const fx = Math.cos(dir) * mag, fz = Math.sin(dir) * mag;
        for (const w of this.walkers) {
            if (w.done) continue;
            w.pushX = fx; w.pushZ = fz; w.pushLeft = 0.12;
            w.pendingPush = 1.5;
        }
        this.events.push(`shove ${mag.toFixed(0)} N`);
        this.nextPush = this.time + 2.5 + r() * 3.5;
    }

    step() {
        const controlTick = this.tick % CONTROL_EVERY === 0;
        const wasWalk = this.phase === "walk";
        this.phase = this.time < this.phaseStand ? "stand" : this.time < this.phaseBalance ? "balance" : "walk";
        if (!wasWalk && this.phase === "walk") {
            for (const w of this.walkers) if (!w.done) w.beginLeg(this, this.waypointFor(w));
        }

        if (controlTick) {
            this._updWind();
            if (this.pushLevel > 0 && this.phase !== "stand") this._maybePush();
            for (const w of this.walkers) { if (!w.done) w.control(this); }
        }
        for (const w of this.walkers) { if (!w.done) w.stepPhysics(this, DT); }
        if (controlTick) {
            for (const w of this.walkers) { if (!w.done) w.tick(this); }
            // Leader = the best walker still on its feet. A walker that banked a
            // good score and then fell can still top the table, and following a
            // corpse around is not what the camera is for. Falls back to the
            // outright best once everyone is down.
            let best = -1, bf = -1e18, anyBest = 0, abf = -1e18;
            for (const w of this.walkers) {
                const f = w.fitness();
                if (f > abf) { abf = f; anyBest = w.idx; }
                if (!w.done && f > bf) { bf = f; best = w.idx; }
            }
            this.leaderIdx = best >= 0 ? best : anyBest;
        }
        this.time += DT;
        this.tick++;
    }

    isOver() {
        if (this.time >= EPISODE_HARD_CAP) return true;
        for (const w of this.walkers) if (!w.done) return false;
        return true;
    }

    /* Population-level readouts the curriculum and the charts run on. */
    summary() {
        const n = this.walkers.length;
        let stood = 0, balanced = 0, arr = 0, upT = 0, prog = 0, steps = 0, stride = 0, best = -1e18, bestArr = 0;
        for (const w of this.walkers) {
            if (w.stood) stood++;
            if (w.balanced) balanced++;
            arr += w.arrivals;
            prog += w.progressM;
            steps += w.steps;
            stride += w.strideSum;
            upT += w.uprightTime;
            const f = w.fitness();
            if (f > best) { best = f; bestArr = w.arrivals; }
        }
        return {
            stoodFrac: stood / n, balancedFrac: balanced / n,
            avgArr: arr / n, avgProg: prog / n, avgSteps: steps / n, avgStride: stride / n, avgUpright: upT / n, best, bestArr
        };
    }
}

if (typeof module !== "undefined") {
    module.exports = { World, STAGES, PHASE_STAND, PHASE_BALANCE, START_BUDGET, ARRIVE_RADIUS, ARRIVAL_TIME, RISE_GRACE };
}
