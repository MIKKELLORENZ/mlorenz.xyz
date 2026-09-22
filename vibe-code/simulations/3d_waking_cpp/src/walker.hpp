/* walker.hpp — one humanoid: what it feels, what it commands, what it scores.
 * Port of walker.js.
 *
 * Control is 50 Hz (the network) over a 500 Hz physics tick, which is the split a
 * real humanoid runs: a slow policy issuing joint TARGETS, and a fast servo loop
 * turning those into torque. The network never commands torque directly. That
 * single choice is what makes this learnable by mutation alone — a random network
 * commands "stand roughly still", not "fire every actuator flat out".
 *
 * The brain sees a TEMPORAL WINDOW: each channel is fed as its last DEPTH[ch]
 * control ticks, newest first, so rates and trends are readable without any
 * recurrence. Lag-0 of every channel comes first, so channel c is always
 * inputs[c].
 *
 * WHY THERE IS A RHYTHM LAYER. A feedforward network reading a mostly static
 * posture settles to a fixed point, and a fixed point is a walker standing still.
 * Measured: 120 random brains produced a best forward progress of 2 cm and a
 * median of exactly 0.00 m. So the leg joints get a rhythm term the network
 * MODULATES rather than generates: target = network offset + A·sin(phase + phi),
 * with A and phi network outputs and left/right locked in anti-phase. A starts at
 * zero for every newborn, so they still just stand, and the network has to
 * discover that oscillating pays. What it buys is that ONE mutation can produce a
 * step instead of needing a hundred coordinated ones.
 *
 * Signs follow the body frame throughout: +X forward, +Y up, +Z left.
 *
 * PORT NOTE: patchXZ (where the foveal cells were sampled) is not carried. It
 * exists in the JS so the renderer and the sampling test read the points the
 * brain actually used; nothing headless reads it, and writing 100 doubles per
 * control tick for a consumer that does not exist here is pure cost.
 */
#pragma once
#include <vector>
#include <cmath>
#include <cstring>
#include <algorithm>
#include "physics.hpp"
#include "body.hpp"
#include "terrain.hpp"
#include "nn.hpp"
#include "rng.hpp"

constexpr double DT = 1.0 / 500.0;          // physics tick
constexpr int CONTROL_EVERY = 10;           // -> 50 Hz control
constexpr double CTRL_DT = DT * CONTROL_EVERY;

/* Ground contact, per point.
 *
 * Normal: Hunt-Crossley, fn = KN·d·(1 + HC·closing speed), not the more obvious
 * KN·d - CN·v. A linear damper is discontinuous at the moment of separation — it
 * still pulls while the foot is already lifting, gets clamped to zero, and the
 * foot chatters in and out of contact at ~20 Hz. Measured: a walker just holding
 * its nominal pose spent 25% of its time airborne and skated backwards at 17 cm/s.
 *
 * Tangential: a stick spring anchored where the point first landed, yielding at
 * the Coulomb limit. This is what gives honest STATIC friction — a purely viscous
 * tangent lets a standing walker creep, and creeping is a free ride the fitness
 * function would happily pay for. */
namespace CONTACT {
    constexpr double KN = 120000;      // N/m per point
    constexpr double KN_SELF = 30000;  // N/m, limb against limb — a limit stop, not a floor
    // Bounds on the normal law — see the note at the force itself in
    // walker_impl.hpp. Statements about what a contact can physically do.
    constexpr double VN_MAX = 2.0;     // m/s approach the damping is extrapolated to
    constexpr double F_MAX_BW = 15;    // x body weight, at a SINGLE point
    constexpr double HC = 2.5;         // s/m, scaled by penetration
    constexpr double KT = 40000;       // N/m tangential stick spring
    constexpr double CT = 300;
}

/* Perturbations and sim-to-real. Deliberately mild: the point is a gait that does
 * not depend on the simulator being exact, not one that survives a hurricane. */
namespace SIM2REAL {
    constexpr double sensorNoise = 0.015;
    constexpr double actionNoise = 0.020;
    constexpr double torqueJitter = 0.02;
    constexpr double servoLag = 0.055;      // s, first-order on the commanded target
    /* rad/s ceiling on the fastest joint's setpoint travel. A real actuator has a
     * finite no-load speed; without one the servos could walk the whole body from
     * a folded squat to standing inside 0.1 s and launch it off the floor. */
    constexpr double setpointSlewMax = 7.0;
}

/* Divergence guard rails. Each is a bound on what this body can physically do,
 * not a tuned threshold. Mirrors walker.js, which carries the full reasoning. */
constexpr double DIVERGE_VH = 5.0;        // m/s HORIZONTAL; vertical is left alone
constexpr double DIVERGE_SPIN = 25.0;     // rad/s, four revolutions a second
constexpr double DIVERGE_FORCE_BW = 20;   // x body weight; a tripwire ABOVE the contact cap

/* The mechanical end stop, as a stiff spring-damper in torque. Swept over
 * k = 2000/6000/15000; 6000 was best on waypoints and fitness alike. */
constexpr double JOINT_STOP_K = 6000;   // N.m/rad
constexpr double JOINT_STOP_C = 60;     // N.m.s/rad, only while driving further in

constexpr double GAIT_HZ = 1.05;

/* Knobs the grid search is allowed to move. Set once at startup and read-only
 * thereafter, which is what makes them safe to share across threads. */
struct Tune { double cpgScale = 1.0; double servoScale = 1.0; };
inline Tune& TUNE() { static Tune t; return t; }

/* --------------------------------------------------------------- the ladder
 * A weighted sum cannot express a hierarchy. It says every rung is EXCHANGEABLE
 * at a fixed rate, so enough standing always buys a waypoint's worth of score,
 * and evolution pays that exchange rate every time because standing is the
 * cheaper currency to mint. A sum CAN express a hierarchy under one rule: each
 * tier's maximum total must be smaller than one unit of the tier above. Then the
 * argmax of the sum is the lexicographic order — waypoints, then walking, then
 * standing — while the score stays a single smooth scalar a hill-climb can follow.
 *
 *   rise      <=  620   COM_RISE_CAP + RECOVER
 *   stand     <=  741   a perfect statue, whole clock
 *   walk/leg  <=  960   full gradient the entire way, then it stops
 *   arrive      1200   uncapped in count
 */
struct Fit {
    double POSTURE = 72;         // per second, stand phase only
    double STAND_BONUS = 180;    // one-off, first time it holds full height upright
    double UPRIGHT = 60;         // per second, balance phase only, only after standing
    double BALANCE_BONUS = 150;  // one-off, held the stand for BALANCE_HOLD seconds
    double PUSH_BONUS = 45;
    int    PUSH_CAP = 2;         // survived a shove — the first two only. Uncapped this
                                 // was a subsidy against walking: a walker in motion is
                                 // far easier to topple, and shoves keep arriving.
    double ALIVE_WALK = 8;       // per second during the walk phase
    double STEP = 25;
    int    STEP_CAP = 8;         // a foot genuinely lifted, swung and re-planted
    double STRIDE_PER_M = 500;   // …times how far forward it actually landed
    double STRIDE_MAX = 0.45;    // m, per step — beyond this it is a lunge
    double PROGRESS_PER_M = 900; // metres of closure toward the current waypoint
    double ARRIVE = 1200;
    /* Speed is the tie-break between two walkers that both arrive: worth a quarter
     * of an arrival, so it can separate equals without tempting a walker to trade
     * a waypoint for haste. The reference is a CLOSURE SPEED, not a time, because
     * legs run 1.3-4.4 m and a fixed deadline makes a short leg trivially fast and
     * a long one impossible. */
    double ARRIVE_SPEED = 300;
    double ARRIVE_SPEED_REF = 0.55;
    double TERRAIN_BONUS = 250;  // per arrival, x terrain difficulty
    double WIND_BONUS = 250;     // per arrival, x wind fraction
    /* A flat fall penalty cannot tell a controlled sit-down from going head-first
     * into the floor. Severity is the torso's speed at collapse: free below
     * FALL_FREE_SPEED, then linear. The base stays SMALL and the multiplier does
     * the work — early walkers fall constantly, and a large flat penalty prices
     * exploration out of the search entirely. */
    double FALL = -180;
    double FALL_FREE_SPEED = 0.8;
    double FALL_SPEED_W = 1.5;
    double FALL_MAX_MULT = 6;
    /* Getting up. RECOVER must be worth less than a typical fall costs, or falling
     * on purpose becomes a way to farm it. */
    double RECOVER = 120;
    int    RECOVER_CAP = 4;
    double COM_RISE_PER_M = 700; // directional: per metre of NEW best height; scaled by --rise-pay
    double COM_HOLD = 90;        // dense: per second, scaled by how high the mass is
    double COM_RISE_CAP = 500;   // …both together, capped per episode
    /* Floor of the rise GATE in fitness(). A walker that never lifts its mass
     * keeps this share of what it earned on a floor start; one that reaches
     * standing height keeps all of it. 0.45 rather than 0 on purpose — at zero,
     * an episode that fails to rise scores nothing and the gradient along
     * "walked a bit while still down" vanishes with it, which is the gradient a
     * fresh brain has to climb first. */
    double RISE_GATE = 0.45;
    double ENERGY_W = 0.05, ENERGY_CAP = 300;
    /* Effort spent while DOWN is metered at a fraction of the walking rate.
     * Measured over 40 floor starts: the busiest quarter paid -271 in energy
     * against a rise ladder capped at 500 and finished BELOW the quietest
     * (-6 vs +78) despite earning 2.5x the ledger. On the floor, effort is the
     * behaviour being asked for, not waste. */
    double ENERGY_DOWN_W = 0.25;
    double WANDER_W = 60, WANDER_SLACK = 1.4, WANDER_CAP = 400;
    double WALK_LEG_CAP = 960;   // just under one arrival, so arriving always wins
    double WALK_SHAPE_CAP = 250; // steps and stride are the rung below closure
    double WALK_PROGRESS_LEG = 0;// 0 = pay PROGRESS_PER_M per metre — full gradient
    /* Heading alignment: does the pelvis POINT at the waypoint while closing on
     * it? Deliberately a MULTIPLIER IN [1-w, 1] on closure income, not an additive
     * bonus. It cannot be farmed — a walker standing still and pirouetting to face
     * the waypoint earns exactly nothing, because zero closure times any
     * multiplier is zero — and it leaves every tier bound above untouched, so the
     * lexicographic ordering the whole ledger rests on cannot be perturbed by
     * tuning it. Exactly a tie-break. */
    double HEADING_W = 0;
    bool tiered = false;
};
inline Fit& FIT() { static Fit f; return f; }

/* Swap reward models. The physics never reads FIT, so this changes the ledger and
 * nothing else. Called once at startup, before any thread exists. */
inline void setReward(const std::string& model) {
    Fit& f = FIT();
    if (model == "tiered") {
        f.POSTURE = 36; f.STAND_BONUS = 90; f.UPRIGHT = 30; f.BALANCE_BONUS = 75;
        f.PUSH_BONUS = 22;
        f.ALIVE_WALK = 5;             // standing-tier income, ~69 over a full walk phase
        f.WALK_PROGRESS_LEG = 550;    // the whole leg's closure, however long the leg
        f.WALK_SHAPE_CAP = 150;       // STEP + STRIDE, the rung below closure
        f.WALK_LEG_CAP = 700;         // backstop on the two together
        f.tiered = true;
    } else {
        f.POSTURE = 72; f.STAND_BONUS = 180; f.UPRIGHT = 60; f.BALANCE_BONUS = 150;
        f.PUSH_BONUS = 45; f.ALIVE_WALK = 8;
        f.WALK_PROGRESS_LEG = 0; f.WALK_SHAPE_CAP = 250; f.WALK_LEG_CAP = 960;
        f.tiered = false;
    }
}

constexpr double STAND_HOLD = 0.6;    // s at full height before "stood" is credited
constexpr double BALANCE_HOLD = 2.0;  // s upright after standing before walking scores
/* How long a new maximum COM height must be SUSTAINED before the rise ratchet
 * pays for it. Short enough that a real rise never notices, long enough that a
 * flail cannot collect on a height it merely touched. Mirrors walker.js. */
constexpr double RISE_CREDIT_HOLD = 0.20;
constexpr double RISE_HOLD = 0.35;    // s upright at height before a recovery counts
constexpr double RISE_HANDOFF = 1.0;  // s the rise net keeps driving after a recovery (two-net brain)
constexpr double DOWN_TIMEOUT = 6.0;  // s down with no progress before we stop simulating

/* ------------------------------------- foot-referenced terrain perception
 *
 * The walker learns rolling terrain and cannot learn stairs — 7-9 waypoints on
 * one, 0-1 on the other, every run, no overlap. That is not a training-time
 * problem, it is an OBSERVABILITY problem: a stair was never in the inputs in a
 * frame the answer lives in. Probes ahead of the PELVIS answer a question no foot
 * is asking, and a LiDAR encodes proximity ALONG A RAY, so recovering "how high
 * is the ground there" is a nonlinear reconstruction spread over 80 channels that
 * a GA will not find.
 *
 * THE BUDGET IS WHAT SHAPES THIS. Hidden layer 1 is 48 wide, so every input costs
 * 48 weights. Under gradient descent, feeding 1024 raw map cells is free — backprop
 * builds the representation. Under selection it is fatal. So this foveates: fine
 * resolution under the feet where the answer is, coarse at range where only route
 * shape matters. */
constexpr int PATCH_N = 5;
constexpr double PATCH_SPACING = 0.09;   // 5 x 0.09 = 0.36 m, about one 0.34 m tread
constexpr double PATCH_FWD = 0.12;       // bias the patch toward where the foot is going
constexpr int PATCH_CELLS = PATCH_N * PATCH_N;
/* Heights are referenced to a SHARED datum — the ground under the LOWER foot —
 * and divided by a FIXED 0.5 m, never auto-scaled to what is in view. Shared,
 * because a self-referenced patch cannot tell that one foot is a step above the
 * other, which is the entire state of being mid-stair. Fixed, because a 0-1
 * normalised image makes a 0.17 m riser read as a different number depending on
 * what else is nearby. */
constexpr double DATUM_SCALE = 0.5;
constexpr double CLEAR_SCALE = 0.30;
constexpr double ATT_SCALE = 0.6;        // ~34 deg of sole-vs-surface angle
constexpr double NORMAL_STEP = 0.05;     // central difference, not an analytic derivative

/* ---------------------------------------------------------- the input layout
 * Every offset after the joint block is DERIVED from NJ. They used to be
 * literals, and the day the body gained a joint the network began reading joint
 * rates where it expected foot load, silently, with no error anywhere.
 *
 * DIFFERENCED WINDOWS, replacing six ad-hoc raw-lag ladders. Every history tap
 * is now (now - mean of the channel over a window), scaled by a measured gain:
 *
 *     tap = clamp((now - mean(W)) * gain, -1.5, 1.5)
 *
 * The old taps were RAW LAGGED SAMPLES, and for a slowly-varying channel the
 * reading at lag 30 is nearly the reading at lag 0 — a near-duplicate of an input
 * the network already has, which a GA has no reason to spend weights on. Ablation
 * was blunt about it: zeroing all thirty of COM velocity's history inputs left the
 * walker at 3.17 m against 3.17 m intact, while a random thirty-input lesion left
 * 0.09-0.23 m. A difference instead carries only novelty, is centred near zero,
 * and averages away roughly sqrt(N) of the sensor noise. See walker.js for the
 * full argument; this file must mirror it exactly or the C++ and JS walkers
 * perceive different pasts and every parity check downstream is meaningless. */
/* One sensor group, recorded as the layout is built so that documentation is
 * GENERATED from the thing it documents. A hand-written table of what the brain
 * senses is a second source of truth, and this file has already been bitten once
 * by exactly that: three blocks of eighteen literal channel offsets, and the day
 * the body gained a joint the network silently began reading joint rates where it
 * expected foot load. `walk3d_verify --inputs` prints this. */
struct SensorGroup {
    const char* name;
    const char* what;         // plain-language: what the number MEANS
    int ch0, nch;             // first channel and how many
    std::vector<int> wins;    // which difference windows are fed (indices into WIN)
    std::vector<double> gain; // parallel to wins
    int inputs;               // nch * (1 + wins.size())
};

struct Layout {
    int NJ = 0, NC = 0, NIN = 0, NOUT = 0, MAXHIST = 0, N_FAN = 0;
    std::vector<std::vector<int>> TEMPORAL;           // window indices per channel
    std::vector<std::vector<double>> TGAIN;           // parallel gains per channel
    std::vector<SensorGroup> groups;
    /* The flattened read plan. planWin is -1 for a present-tense tap. */
    std::vector<int> planWin, planCh;
    std::vector<double> planGain;
    int C_GRAV=0, C_GYRO=0, C_VEL=0, C_HEIGHT=0, C_UPRIGHT=0, C_QA=0, C_QD=0,
        C_LOAD=0, C_CONTACT=0, C_FOOTPOS=0, C_WPDIST=0, C_WPBEAR=0, C_GAIT=0,
        C_TERRAIN=0, C_WIND=0, C_EFFERENCE=0, C_COMVEL=0, C_COMH=0, C_COMPOS=0,
        C_CAPTURE=0, C_FOOTCLR=0, C_FOOTATT=0, C_PATCH=0;
    bool patchChannels = false;
    int O_CADENCE=0, O_AMP=0, O_PHASE=0;
    std::vector<int> NET_SIZES;
    std::vector<double> PATCH_OFF;
    /* The terrain ring: three radii, twelve compass directions, heading-relative
     * so index 0 is always straight ahead. Direction cosines are precomputed
     * because 36 samples a tick is otherwise 72 trig calls. */
    double RING_R[3] = {0.35, 0.65, 1.00};
    double RING_C[12], RING_S[12];
};
constexpr int RING_DIRS = 12;
constexpr int N_RING = 3 * RING_DIRS;

/* The difference windows, in control ticks at 50 Hz: 20-60 ms, 80-300 ms,
 * 320-1200 ms. DISJOINT on purpose — three nested or exponentially-weighted
 * averages are heavily correlated with one another, so each extra input would
 * mostly repeat the last; disjoint eras are close to independent, which is what
 * makes three inputs worth three inputs. Must match WIN in walker.js exactly. */
constexpr int NWIN = 3;
constexpr int WIN_A[NWIN] = { 1,  4, 16 };
constexpr int WIN_B[NWIN] = { 3, 15, 60 };

inline const Layout& LAY() {
    static const Layout L = []{
        Layout L;
        /* T_STD is all three windows, reaching 1200 ms. T_LITE is the middle
         * window alone and exists purely for budget: joint angles, joint rates and
         * the efference copy are 66 channels between them, and three windows each
         * would be 198 inputs — more than half the vector for a third of the
         * sensors. One window still takes them from 40-80 ms to 300 ms of reach. */
        const std::vector<int> T_STD {0,1,2};
        const std::vector<int> T_LITE {1};
        const std::vector<int> T_NONE {};

        const int NJ = HUMANOID().nj;
        L.NJ = NJ;
        auto here = [&]{ return (int)L.TEMPORAL.size(); };
        /* `gains` is indexed by WINDOW, not by position in `set`, so a channel can
         * move between T_STD and T_LITE without its numbers being re-shuffled.
         * Every value is MEASURED — probe_delta_gains.js reports the 95th
         * percentile of |now - mean(W)| over real walking and floor-pose episodes,
         * and gain is 1/p95 so a typical large excursion lands at 1.0. An ungained
         * difference arrives as a near-zero input mutation has no reason to touch;
         * an over-gained one sits pinned at the clamp. Both look like "the GA is
         * slow" from outside. */
        auto put = [&](const char* name, const char* what, int n,
                       const std::vector<int>& set, std::vector<double> gains) {
            std::vector<double> g;
            for (int w : set) g.push_back(gains.at((size_t)w));
            SensorGroup sg { name, what, here(), n, set, g, n * (1 + (int)set.size()) };
            for (int i = 0; i < n; i++) { L.TEMPORAL.push_back(set); L.TGAIN.push_back(g); }
            L.groups.push_back(sg);
        };

        L.C_GRAV = here();     put("gravity direction", "which way is down, in the pelvis's own frame — the inner ear", 3, T_STD, {16, 4.8, 2.4});
        L.C_GYRO = here();     put("pelvis turn rate", "how fast the hips are rotating about each axis", 3, T_STD, {4.8, 2.4, 2.7});
        L.C_VEL = here();      put("pelvis velocity", "how fast the hips are travelling, in the pelvis's own frame", 3, T_STD, {13, 4.8, 4.6});
        L.C_HEIGHT = here();   put("hip height", "hip clearance above the ground below, 1.0 = standing tall", 1, T_STD, {41, 11, 3.5});
        L.C_UPRIGHT = here();  put("uprightness", "1 = torso vertical, 0 = past ~60 degrees over", 1, T_STD, {25, 6.3, 2.5});
        L.C_QA = here();       put("joint angles", "where every joint currently is, scaled to its own limits", NJ, T_LITE, {9.2, 2.9, 2.1});
        L.C_QD = here();       put("joint speeds", "how fast every joint is moving", NJ, T_LITE, {6, 3.3, 4});
        L.C_LOAD = here();     put("foot load", "weight on each foot as a fraction of body weight", 2, T_STD, {2.3, 1.4, 1.8});
        L.C_CONTACT = here();  put("foot contact", "is each foot touching the ground at all: 0 or 1", 2, T_STD, {1.5, 1.1, 1.2});
        L.C_FOOTPOS = here();  put("foot positions", "where each foot is relative to the hips (x,y,z each)", 6, T_STD, {11, 3.5, 2.4});
        L.C_WPDIST = here();   put("waypoint distance", "how far to the target it is walking to", 1, T_NONE, {});
        L.C_WPBEAR = here();   put("waypoint bearing", "which way the target is, as sin/cos of the angle off the nose", 2, T_NONE, {});
        L.C_GAIT = here();     put("gait clock", "an internal metronome, as sin/cos — the beat it steps to", 2, T_NONE, {});
        L.N_FAN = N_RING;
        L.C_TERRAIN = here();  put("terrain ring",
            "ground height all round, 3 rings out to 1 m x 12 directions — the road shape, including behind", L.N_FAN, T_NONE, {});
        L.C_WIND = here();     put("wind", "wind direction relative to facing, times its strength", 2, T_NONE, {});
        L.C_EFFERENCE = here();put("last action", "the command it issued last tick — a copy of its own motor output", NJ, T_LITE, {1.4, 1.1, 1.2});
        /* Centre-of-mass velocity in the pelvis frame, on a long ladder. Pelvis
         * velocity misses the momentum stored in the limbs: a swinging leg moves
         * the centre of mass while the pelvis reads almost unchanged, so the
         * walker could not sense the one quantity that decides whether a recovery
         * step will arrive in time. Realisable on hardware — a real humanoid
         * computes its COM from joint encoders and known link masses. */
        L.C_COMVEL = here();   put("centre-of-mass velocity",
            "how fast the body's whole mass is moving — catches a swinging leg the pelvis cannot feel", 3, T_STD, {17, 8, 9.3});
        /* ------------------------------------------------ the inverted pendulum
         *
         * COM HEIGHT WAS NOT AN INPUT, and the rise tier is PAID ON IT.
         * comHeight() drives COM_HOLD, COM_RISE_PER_M and bestComY — the whole
         * "get up off the floor" ladder — while the only height the walker could
         * sense was the PELVIS origin. On the floor those are not the same
         * quantity: the dense term's stated intent is that "a walker propped on
         * one elbow already outscores one lying flat", and the pelvis is on the
         * ground in both cases. This file states the rule itself, about heading —
         * a reward for a quantity that is not in the observation is a reward for
         * luck. Rising from the floor reads 0/6 for every champion so far.
         *
         * The velocity channel is not a substitute: it computes the COM offset
         * every tick, differences it, and throws the POSITION away.
         *
         * CAPTURE POINT is the other half and is not recoverable by selection.
         * xi = com + v*sqrt(h/g) is where the mass would come to rest, i.e. WHERE
         * A FOOT MUST LAND not to fall. It needs a square root of one channel
         * times another — the same argument already accepted for foot attitude. */
        L.C_COMH = here();     put("centre-of-mass height",
            "how high the body's mass actually is — NOT the hips, which lie on the floor either way", 1, T_STD, {62, 17, 4});
        L.C_COMPOS = here();   put("mass over the feet",
            "where the mass sits relative to the midpoint of the feet: forward/back and left/right", 2, T_STD, {4.3, 1.3, 0.93});
        L.C_CAPTURE = here();  put("capture point",
            "where a foot must land to stop the fall — the inverted-pendulum answer", 2, T_STD, {5.5, 1.6, 1.2});
        /* Appended last, so every offset above keeps its value. Clearance and
         * attitude ride L_MID so they also yield a RATE; clearance rate is the
         * toe-scuff predictor, which is the failure that ends most stair attempts. */
        L.C_FOOTCLR = here();  put("foot clearance",
            "height of each sole above the ground DIRECTLY under it — not under the hips", 2, T_STD, {12, 3.6, 2.2});
        L.C_FOOTATT = here();  put("foot tilt",
            "angle between each sole and the slope it is over, two axes per foot", 4, T_STD, {3.7, 0.67, 0.6});
        L.C_PATCH = here();    put("ground under the feet",
            "a 5x5 height map under each foot, 9 cm spacing — where the next step lands", 2 * PATCH_CELLS, T_NONE, {});
        L.patchChannels = true;

        L.NC = (int)L.TEMPORAL.size();
        L.NIN = L.NC;
        for (auto& t : L.TEMPORAL) L.NIN += (int)t.size();
        /* One deeper than the deepest window: the rolling sum shifts by adding the
         * frame entering at lag WIN_A and removing the one leaving at WIN_B + 1, so
         * that departing frame has to still be in the ring when it is read. */
        L.MAXHIST = WIN_B[NWIN - 1] + 2;

        /* Flattened read plan: the PRESENT reading of every channel first — so
         * inputs[c] is still channel c, which every comment here relies on — then
         * each window in order. Built once, walked linearly at 50 Hz. */
        for (int ch = 0; ch < L.NC; ch++) {
            L.planWin.push_back(-1); L.planCh.push_back(ch); L.planGain.push_back(1.0);
        }
        for (int w = 0; w < NWIN; w++)
            for (int ch = 0; ch < L.NC; ch++) {
                const auto& t = L.TEMPORAL[(size_t)ch];
                const auto it = std::find(t.begin(), t.end(), w);
                if (it == t.end()) continue;
                L.planWin.push_back(w); L.planCh.push_back(ch);
                L.planGain.push_back(L.TGAIN[(size_t)ch][(size_t)(it - t.begin())]);
            }
        L.O_CADENCE = NJ;
        L.O_AMP = L.O_CADENCE + 1;
        L.O_PHASE = L.O_AMP + 5;                 // 5 rhythm groups
        L.NOUT = L.O_PHASE + 5;
        L.NET_SIZES = { L.NIN, 48, 32, L.NOUT };
        L.PATCH_OFF.resize(PATCH_N);
        for (int i = 0; i < PATCH_N; i++) L.PATCH_OFF[i] = (i - (PATCH_N - 1) / 2.0) * PATCH_SPACING;
        for (int k = 0; k < RING_DIRS; k++) {
            const double a = k * 2 * 3.141592653589793 / RING_DIRS;
            L.RING_C[k] = std::cos(a);
            L.RING_S[k] = std::sin(a);
        }
        return L;
    }();
    return L;
}

/* Rhythm groups. Each gets one amplitude output and one phase output; the two
 * sides of a pair are locked in anti-phase, which is both correct for walking and
 * halves what evolution has to find.
 *
 * Hip roll is the one group that is IN phase, and it matters more than it looks.
 * Both hip-roll joints share the +X axis, so rolling them the same way tips the
 * pelvis sideways and moves the centre of mass over one foot — which is the only
 * way a biped can unload the other foot enough to swing it. Anti-phase just
 * splays both legs symmetrically and shifts no weight whatsoever; with that
 * wiring the load stayed pinned at 50/50 no matter how large the amplitude, and
 * stepping was mechanically impossible rather than merely hard to learn. */
struct CpgGroup { double amax; int j0, j1; double off0, off1; };
inline const std::vector<CpgGroup>& CPG_GROUPS() {
    static const double PI = 3.141592653589793;
    static const std::vector<CpgGroup> g = {
        { 0.55, J_L_HIP_PITCH, J_R_HIP_PITCH, 0, PI },
        { 0.75, J_L_KNEE,      J_R_KNEE,      0, PI },
        { 0.35, J_L_ANK_PITCH, J_R_ANK_PITCH, 0, PI },
        { 0.20, J_L_HIP_ROLL,  J_R_HIP_ROLL,  0, 0  },
        { 0.50, J_L_SHOULDER,  J_R_SHOULDER,  PI, 0 }
    };
    return g;
}

/* Seed the rhythm outputs ~14x wider than the posture outputs. A fresh population
 * then contains a real spread of attempted gaits — amplitudes and phase offsets
 * that actually differ — while every one of them still holds a sane standing
 * posture. Without this the entire first generation is one individual wearing 48
 * hats, and the run never leaves the plateau. */
inline void installOutRowScale() {
    const Layout& L = LAY();
    std::vector<double> a((size_t)L.NOUT, 1.0);
    for (int i = L.O_AMP; i < L.NOUT; i++) a[i] = 14.0;
    outRowScaleRef() = a;
}

/* Signed angle from u to v measured about axis `a` (a must be unit). Both vectors
 * are projected onto the plane perpendicular to `a` first, so this is the rotation
 * about that one axis and nothing else — which is what makes "pitch" and "roll"
 * separable rather than two readings of the same tilt. */
inline double signedAngleAbout(double ux, double uy, double uz,
                               double vx, double vy, double vz,
                               double ax, double ay, double az) {
    const double du = ux*ax + uy*ay + uz*az, dv = vx*ax + vy*ay + vz*az;
    const double px = ux - du*ax, py = uy - du*ay, pz = uz - du*az;
    const double qx = vx - dv*ax, qy = vy - dv*ay, qz = vz - dv*az;
    const double cx = py*qz - pz*qy, cy = pz*qx - px*qz, cz = px*qy - py*qx;
    return std::atan2(cx*ax + cy*ay + cz*az, px*qx + py*qy + pz*qz);
}
inline double wrapPi(double a) {
    const double PI = 3.141592653589793;
    while (a > PI) a -= 2*PI;
    while (a < -PI) a += 2*PI;
    return a;
}
inline double clampd(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }

class World;   // forward

struct Walker;
struct World;
struct ActionHook {
    virtual ~ActionHook() = default;
    virtual void onAction(Walker& x, World& w) = 0;
};

class Walker {
public:
    Net* brain = nullptr;
    /* Two-net brain: an evolved RISE net drives while the walker is down and
     * for RISE_HANDOFF seconds after it recovers, the walking net otherwise.
     * Null = the single-net brain the browser shipped with. Distilling a 65%
     * riser into the walking net kept 20% of it; keeping the two nets apart
     * keeps both skills whole. Must stay identical to walker.js. */
    Net* riseBrain = nullptr;
    double riseHold = 0;
    /* A crouch start is "down" by the episode rules but it is the walking
     * net's own start posture: g95 holds 42/60 from the deepest crouch where
     * every rise net (kneel specialists) collapsed. The rise net therefore
     * takes a crouch-start episode only after a real fall. */
    bool crouchStart = false;
    const Model* model = nullptr;
    MultiBody mb;
    int nj = 0;
    Rng rng;

    std::vector<float> inputs, out;
    std::vector<double> target, cmd, base, amp, ph, tau;
    std::vector<double> anchor;
    std::vector<uint8_t> anchored;
    std::vector<double> ptForce;
    /* Flat MAXHIST x NC, not a vector of vectors. The trainer reuses one Walker
     * per thread across thousands of episodes, and a nested container reallocates
     * every inner row on each rebuild; flat also walks the lag plan in cache
     * order, which is what the 50 Hz assembly loop does. */
    std::vector<float> histBuf;
    std::vector<float> nnBuf;      // the network's activation scratch — see Net::forward
    int histWrite = 0;
    std::vector<double> winSum;      // NWIN x NC rolling window sums
    int nTicks = 0;                  // control ticks since reset

    // ---- episode state ----
    bool done = false, diverged = false, downed = false, startedDown = false;
    double peakPtForce = 0;   // largest single-point normal force this tick
    bool stood = false, balanced = false, riseRefSet = false;
    std::string startPoseName = "crouch";
    double timeLeft = 0, fallTimer = 0, fallSeverity = 0, downTimer = 0, riseTimer = 0;
    double comPeak = 0;        // decaying max COM height — what a fall fell FROM
    int falls = 0, recoveries = 0;
    double riseIncome = 0, bestComY = 0, standTimer = 0, stoodAt = 0;
    // candidate new-best height and how long it has been held; see walker_impl
    double riseCand = 0, riseCandT = 0;
    /* Time-weighted mean COM height — the ranking signal for rise-trial
     * generations. A MEAN and not a maximum: the thrash-farming lesson is that
     * any max-over-episode statistic pays for a spike that collapses. Must stay
     * identical to Walker.meanCom in walker.js. */
    double comSum = 0, comTime = 0;
    double meanCom() const { return comTime > 0 ? comSum / comTime : 0.0; }

    /* SETTLED height: the mean COM over the last half second of the episode.
     * lateFrom is set by the world; 1e18 means "never", so an ordinary episode
     * pays nothing for keeping these fields.
     *
     * This is the score the open-loop trajectory search used to find a rise at
     * all (0.812 m from prone against 0.158 m for lying still), so it is known to
     * have a usable gradient on exactly this problem. It asks the one question
     * that matters — where did you END UP — and a walker that lunges upward and
     * falls back scores no better than one that never moved. */
    double lateWhenLeft = -1, lateSum = 0, lateTime = 0;   // <0 = never accumulate
    double settledCom() const { return lateTime > 0 ? lateSum / lateTime : 0.0; }

    /* Settled height, plus a quarter weight on the whole-episode mean.
     *
     * The settled term alone is nearly flat for a fleet that cannot yet hold any
     * height: every brain finishes on the floor and scores the same, which is a
     * plateau with no gradient to climb. The whole-episode mean breaks that tie
     * in favour of getting higher SOONER and staying there longer, which is the
     * behaviour the settled term will eventually reward outright. A quarter,
     * because it must not become worthwhile to spike upward and collapse — the
     * thrash-farming trap. */
    double riseScore() const { return settledCom() + 0.25 * meanCom(); }
    /* True only while a searched reference is driving the joints. The FALLING
     * edge is the handover, where the rise ratchet is re-baselined so scaffolded
     * height is never paid for. */
    bool scaffolded = false;
    double footLoad[2] = {0,0};
    int footContact[2] = {0,0};
    int steps = 0;
    double strideSum = 0;
    double footAir[2] = {0,0};
    bool footAirborne[2] = {false,false};
    double footOff[4] = {0,0,0,0};
    double fitScore = 0, penalty = 0, energy = 0;
    int arrivals = 0;
    double progressM = 0, alignSum = 0;
    int legIdx = 0;
    double legStartTime = 0, legInitDist = 1, bestDist = 1e9, pathLen = 0, usefulLen = 0;
    double pendingPush = 0;
    int pushesSurvived = 0;
    double legWalkScore = 0, legShapeScore = 0, legBudget = 0;
    double pushLeft = 0, pushX = 0, pushZ = 0;
    double uprightTime = 0, walkTime = 0;
    double phase = 0, cadence = 1, gaitGain = 0;

private:
    double lastPx = 0, lastPz = 0;
    double comPrev[3] = {0,0,0};
    bool comHave = false;
    double comPrevW[3] = {0,0,0};      // world frame, for the capture point
    bool comHaveW = false;
    double sole[6] = {0,0,0,0,0,0};
    double patchDatum = 0;
    double servoLagMemoDt = -1, servoLagMemo = 0;
    // scratch, reused: a walker is reset thousands of times per generation
    double p3[3], v3[3], sp3[3], sv3[3], s4[4];

public:
    void build(Net* b, const Model& m) {
        brain = b;
        model = &m;
        mb.build(m.bodies);
        nj = m.nj;
        const Layout& L = LAY();
        inputs.assign((size_t)L.NIN, 0.0f);
        out.assign((size_t)L.NOUT, 0.0f);
        target.assign(nj, 0.0); cmd.assign(nj, 0.0); base.assign(nj, 0.0);
        amp.assign(CPG_GROUPS().size(), 0.0); ph.assign(CPG_GROUPS().size(), 0.0);
        tau.assign(nj + 1, 0.0);
        const size_t np = m.contacts.size();
        anchor.assign(np * 3, 0.0);
        anchored.assign(np, 0);
        ptForce.assign(np, 0.0);
        // assign() keeps capacity, so rebuilding a reused Walker allocates nothing
        histBuf.assign((size_t)L.MAXHIST * (size_t)L.NC, 0.0f);
        /* Rolling sum per window, so a mean over 45 frames costs one add and one
         * subtract rather than 45 reads. double on purpose: this accumulator is
         * updated every control tick for a whole episode and in float the
         * add/subtract pair would drift. */
        winSum.assign((size_t)NWIN * (size_t)L.NC, 0.0);
        nTicks = 0;
        nnBuf.assign(b->scratchSize(), 0.0f);
    }

    /* ------------------------------------------------------------------ reset */
    void reset(const World* world, double x, double z, double yaw, const Pose* pose);
    /* After a scripted fall (start pose "fall:x"): keep the body exactly where
     * it landed, zero every score and timer as reset() does, and mark the
     * episode as a floor start. Training-only. */
    void rebaseAfterFall(const World* world);

    /* --------------------------------------------------------------- geometry */
    inline double groundClearance(const Terrain& T) const {
        return mb.bp[1] - T.height(mb.bp[0], mb.bp[2]);
    }
    /* 1 when the torso is vertical, 0 once it is past ~60 degrees off. */
    inline double uprightness() const {
        const double* R = &mb.R[(size_t)model->torsoBody * 9];
        return clampd((R[4] - 0.5) / 0.5, 0, 1);   // torso +Y axis, world Y component
    }
    /* Heading: the pelvis' forward axis, flattened onto the ground plane. */
    inline double heading() const { return std::atan2(-mb.R[6], mb.R[0]); }

    double comHeight(const Terrain* T) const {
        const Model& M = *model;
        double m = 0, y = 0, p[3];
        for (size_t i = 0; i < M.bodies.size(); i++) {
            const BodyDef& b = M.bodies[i];
            if (b.mass <= 0) continue;
            mb.worldPoint((int)i, b.com[0], b.com[1], b.com[2], p);
            m += b.mass; y += b.mass * p[1];
        }
        if (m <= 0) return 0;
        const double g = T ? T->height(mb.bp[0], mb.bp[2]) : 0.0;
        return y / m - g;
    }

    /* --------------------------------------------------- sensing + control */
    /* Optional per-tick hook, called after the network's outputs are in `out` and
     * before they are turned into setpoints. Null for the trainer, the exam and
     * the verifier; walk3d_dagger installs one to label states with a teacher
     * and, when the teacher drives, to overwrite `out` with its action. */
    ActionHook* hook = nullptr;
    void control(World& world);
    void stepPhysics(World& world, double dt);
    void tickBook(World& world);

    /* Mean alignment over the metres that counted. 1.0 = walked straight at the
     * waypoint throughout; ~0.0 = crab-walked the whole way. Returns 1 when
     * nothing was closed so an episode with no progress cannot drag the fleet
     * average toward "sideways" for a walker that simply never moved. */
    double meanAlign() const { return progressM > 1e-6 ? alignSum / progressM : 1.0; }

    /* How squarely the pelvis points at the waypoint: 1 facing it, 0 at ninety
     * degrees or anywhere behind. Same relative bearing the brain already senses
     * on C_WPBEAR — a reward for a quantity that is not in the observation is a
     * reward for luck. */
    double headingAlign(double wx, double wz) const {
        const double rel = wrapPi(std::atan2(-(wz - mb.bp[2]), wx - mb.bp[0]) - heading());
        return std::max(0.0, std::cos(rel));
    }

    /* Live fitness. Progress is banked as it is earned, so this is only the ledger
     * minus the capped penalties. */
    double fitness() const {
        const Fit& F = FIT();
        double f = fitScore + penalty;
        f -= std::min(F.ENERGY_CAP, F.ENERGY_W * energy);
        const double excess = std::max(0.0, pathLen - usefulLen - legInitDist * F.WANDER_SLACK);
        f -= std::min(F.WANDER_CAP, F.WANDER_W * excess);
        /* On an episode that STARTED on the floor, everything earned is scaled by
         * how high the walker ever got its mass. Not another additive term: the
         * whole rise ladder is capped at 620 against 1200 for a single waypoint,
         * so a brain going from never rising to rising perfectly gained under 1%
         * of its total — shaped correctly and worth nothing selection could see.
         *
         * A multiplier fixes that without touching the tier bounds, the same
         * reason heading is a multiplier here and not a bonus: an additive
         * heading term got farmed, a closure multiplier could not be. Getting up
         * is not paid, it GATES being paid for the walking that follows.
         *
         * Positive scores only. Scaling a negative total by less than one would
         * shrink the penalty, rewarding a walker for failing to rise. */
        if (startedDown && f > 0) {
            const double riseFrac = clampd(bestComY / model->standHipY, 0.0, 1.0);
            f *= F.RISE_GATE + (1.0 - F.RISE_GATE) * riseFrac;
        }
        return f;
    }

    /* Called by World when a new leg starts. */
    void beginLeg(double worldTime, double wx, double wz) {
        const Fit& F = FIT();
        legStartTime = worldTime;
        legInitDist = std::max(0.5, std::sqrt((wx - mb.bp[0])*(wx - mb.bp[0]) + (wz - mb.bp[2])*(wz - mb.bp[2])));
        bestDist = legInitDist;
        legWalkScore = 0;
        legShapeScore = 0;
        // Size the budget to THIS leg: full closure at the full per-metre rate,
        // plus the shape allowance that shares the pot. Exhausted at the waypoint,
        // never short of it.
        legBudget = F.PROGRESS_PER_M * legInitDist + F.WALK_SHAPE_CAP;
    }

private:
    void contactsStep(World& world, double dt);
    void selfCollide();
    void windStep(World& world);
    void pushStep(double dt);
    void servos(World& world, double dt);
    double fallSeverityNow();

    /* Walking income, against this leg's budget. It used to be a flat constant
     * shared with _payShape, which meant income stopped after 0.79 m of a leg
     * 1.3-2.3 m long: past the cap every further metre toward the waypoint paid
     * nothing, so a hill-climbing GA had a flat surface for the last ~60% of every
     * leg and no way across it. The budget refills per leg, so it is the
     * SUBSTITUTION that is bounded, not the skill. */
    void payWalk(double pts) {
        const double room = legBudget - legWalkScore;
        if (!(room > 0)) return;
        const double p = std::min(pts, room);
        legWalkScore += p;
        fitScore += p;
    }
    /* Steps and stride are the rung BELOW closure, so they get their own, much
     * smaller allowance. Sharing one pot would let a walker spend the leg's whole
     * budget shuffling on the spot — which is the shape of every exploit this
     * reward has produced so far. */
    void payShape(double pts) {
        const double room = FIT().WALK_SHAPE_CAP - legShapeScore;
        if (!(room > 0)) return;
        const double p = std::min(pts, room);
        legShapeScore += p;
        payWalk(p);
    }
    /* Closure toward the waypoint, paid as a fraction of THIS leg. `align` is the
     * heading multiplier; a negative value means "unweighted". */
    void payProgress(double closed, double align) {
        const Fit& F = FIT();
        const double w = F.HEADING_W;
        const double k = (w > 0 && align >= 0) ? (1 - w) + w * align : 1.0;
        if (F.WALK_PROGRESS_LEG > 0) payWalk(F.WALK_PROGRESS_LEG * (closed / legInitDist) * k);
        else payWalk(closed * F.PROGRESS_PER_M * k);
    }
    void arrive(World& world, double d);
};
