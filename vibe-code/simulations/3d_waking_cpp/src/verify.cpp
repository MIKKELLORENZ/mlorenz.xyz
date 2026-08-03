/* verify.cpp — the only reason to believe any of this.
 *
 * A port is a rewrite of a simulator whose behaviour is only known through the
 * original, and the failure mode that matters is not a crash: it is a
 * silently-different physics that a genetic algorithm then finds an exploit in.
 * This project family has been bitten twice — a drone that learned to farm ground
 * effect, a delivery sim that learned to hide behind a statue — and both looked
 * like progress on the dashboard for days.
 *
 * So nothing here reports "it ran". Every check compares against something that
 * was already known to be right:
 *
 *   --layout    the derived sensor layout against the numbers the JS build prints
 *   --inertia   the fast block-structured X^T·I·X against the dense reference,
 *               over random states, to machine precision
 *   --gravity   free fall excites no joint, and the base sees exactly -g in its
 *               own frame — the one closed-form answer the ABA gravity
 *               substitution has to reproduce
 *   --rng       the first draws of mulberry32, to diff against the JS stream
 *   --episode   a recorded JS episode replayed here, comparing the 333 sensor
 *               inputs and 33 outputs tick by tick. This is the whole stack:
 *               terrain, contacts, servos, ABA, the lag window and the network.
 *   --bench     wall clock per episode, for the speedup claim
 */
#include <cstdio>
#include <cstring>
#include <cmath>
#include <chrono>
#include <string>
#include <vector>
#include <iostream>
#include <filesystem>
#include "episode.hpp"
#include "evolution.hpp"

namespace fs = std::filesystem;

static int failures = 0;
static void check(bool ok, const std::string& what, const std::string& detail = "") {
    std::printf("  %-52s %s%s%s\n", what.c_str(), ok ? "PASS" : "FAIL",
                detail.empty() ? "" : "  ", detail.c_str());
    if (!ok) failures++;
}

/* ------------------------------------------------------------------ layout */
static void vLayout() {
    const Layout& L = LAY();
    const Model& M = HUMANOID();
    std::printf("layout\n");
    std::printf("  NJ %d  NC %d  NIN %d  NOUT %d  MAXHIST %d  net %d-48-32-%d\n",
                L.NJ, L.NC, L.NIN, L.NOUT, L.MAXHIST, L.NIN, L.NOUT);
    std::printf("  bodies %d  contacts %d  selfPairs %d  standHipY %.4f  crouchHipY %.4f  mass %.3f\n",
                (int)M.bodies.size(), (int)M.contacts.size(), (int)M.selfPairs.size(),
                M.standHipY, M.crouchHipY, M.totalMass);
    // The values the live JS build reports. A mismatch means a grafted brain would
    // be reading the wrong channel for everything after the divergence — silently,
    // with no error anywhere, which is exactly how this went wrong once before.
    // Updated 2026-08-01 with the terrain ring (20 -> 36) and the pendulum block
    // (COM height, COM over the feet, capture point: +5 channels, +15 inputs).
    check(L.NJ == 22, "NJ == 22");
    check(L.NC == 194, "NC == 194");
    check(L.NIN == 364, "NIN == 364");
    check(L.NOUT == 33, "NOUT == 33");
    check(L.MAXHIST == 31, "MAXHIST == 31");
    check((int)M.bodies.size() == 23, "bodies == 23");
    check((int)M.contacts.size() == 39, "contacts == 39");
    check((int)M.selfPairs.size() == 65, "selfPairs == 65");
    check(std::fabs(M.totalMass - 65.0) < 1e-9, "total mass == 65.0 kg");
    // Lag 0 of every channel comes first, so inputs[c] is channel c — every
    // comment in walker.hpp relies on it and a graft would silently break if not.
    bool planOk = true;
    for (int c = 0; c < L.NC; c++) if (L.planLag[c] != 0 || L.planCh[c] != c) planOk = false;
    check(planOk, "lag plan: inputs[c] is channel c for all c");
}

/* ---------------------------------------------------------------- inertia */
static void vInertia(int trials) {
    std::printf("block-structured X^T.I.X against the dense reference, %d random states\n", trials);
    Rng r(12345);
    double worst = 0, worstMag = 0;
    // Cover both cases the fast path branches on, and the general rotation the
    // floating base carries.
    for (int t = 0; t < trials; t++) {
        JointFrame jf;
        const int mode = t % 3;
        double E[9];
        if (mode == 2) {
            // general rotation, built from a random quaternion like the base's
            double q[4];
            double n = 0;
            for (int k = 0; k < 4; k++) { q[k] = r()*2 - 1; n += q[k]*q[k]; }
            n = std::sqrt(n);
            for (int k = 0; k < 4; k++) q[k] /= n;
            double R[9];
            quatToM3(q, R);
            E[0]=R[0]; E[1]=R[3]; E[2]=R[6];
            E[3]=R[1]; E[4]=R[4]; E[5]=R[7];
            E[6]=R[2]; E[7]=R[5]; E[8]=R[8];
            jf.axis = -1;
        } else {
            const int ax = t % 3;
            const double th = (r()*2 - 1) * 3.2;
            double rot[9];
            m3RotAxis(ax, th, rot);
            E[0]=rot[0]; E[1]=rot[3]; E[2]=rot[6];
            E[3]=rot[1]; E[4]=rot[4]; E[5]=rot[7];
            E[6]=rot[2]; E[7]=rot[5]; E[8]=rot[8];
            jf.axis = ax; jf.c = std::cos(th); jf.s = std::sin(th);
        }
        std::memcpy(jf.E, E, sizeof E);
        if (mode == 0) { jf.rx = jf.ry = jf.rz = 0; jf.zeroR = true; }   // the r == 0 branch
        else {
            jf.rx = (r()*2 - 1) * 0.5; jf.ry = (r()*2 - 1) * 0.5; jf.rz = (r()*2 - 1) * 0.5;
            jf.zeroR = false;
        }
        double X[36];
        x6Build(jf.E, X, jf.rx, jf.ry, jf.rz);

        // A general (non-symmetric) I, because the articulated-body inertia is only
        // symmetric to within accumulated rounding and the derivation must not lean
        // on more than that.
        double I[36];
        for (int k = 0; k < 36; k++) I[k] = (r()*2 - 1) * 40;
        double A[36], B[36];
        x6TransformInertiaDense(X, I, A);
        x6TransformInertiaBlock(jf, I, B);
        for (int k = 0; k < 36; k++) {
            const double d = std::fabs(A[k] - B[k]);
            const double m = std::fabs(A[k]);
            if (m > worstMag) worstMag = m;
            const double rel = d / std::max(1.0, m);
            if (rel > worst) worst = rel;
        }
    }
    std::printf("  worst relative difference %.3e (largest magnitude %.1f)\n", worst, worstMag);
    check(worst < 1e-13, "block form agrees with dense to machine precision");
}

/* ---------------------------------------------------------------- gravity */
static void vGravity() {
    /* With no contact, no torque and zero velocity the body is in free fall, and
     * that has a closed-form answer: not one joint accelerates, and the base sees
     * exactly -g along the world-up axis expressed in its own frame. It is the
     * single check that pins the a' = a - a_g substitution, which is the one place
     * a floating-base ABA can be subtly wrong and still look plausible. */
    std::printf("free fall: uniform gravity must excite no joint\n");
    const Model& M = HUMANOID();
    MultiBody mb;
    mb.build(M.bodies);
    Rng r(777);
    double worstJoint = 0, worstBase = 0;
    for (int t = 0; t < 40; t++) {
        for (int j = 0; j < M.nj; j++) {
            const BodyDef& b = M.bodies[j + 1];
            const double lo = std::max(-3.0, b.qmin), hi = std::min(3.0, b.qmax);
            mb.q[j + 1] = lo + (hi - lo) * r();
        }
        std::fill(mb.qd.begin(), mb.qd.end(), 0.0);
        double q[4]; double n = 0;
        for (int k = 0; k < 4; k++) { q[k] = r()*2 - 1; n += q[k]*q[k]; }
        n = std::sqrt(n);
        for (int k = 0; k < 4; k++) mb.bq[k] = q[k] / n;
        mb.bp[0] = r()*4 - 2; mb.bp[1] = 3 + r(); mb.bp[2] = r()*4 - 2;
        mb.fk();
        mb.clearForces();
        std::vector<double> tau((size_t)mb.nb, 0.0);
        mb.dynamics(tau.data());
        for (int j = 0; j < M.nj; j++) worstJoint = std::max(worstJoint, std::fabs(mb.qdd[6 + j]));
        // expected base linear acceleration: -g * (R^T . e_y)
        const double* R = mb.R.data();
        const double ex[3] = { -GRAVITY*R[3], -GRAVITY*R[4], -GRAVITY*R[5] };
        for (int k = 0; k < 3; k++) worstBase = std::max(worstBase, std::fabs(mb.qdd[3 + k] - ex[k]));
        for (int k = 0; k < 3; k++) worstBase = std::max(worstBase, std::fabs(mb.qdd[k]));
    }
    std::printf("  max |joint qdd| %.3e   max base error %.3e\n", worstJoint, worstBase);
    check(worstJoint < 1e-9, "no joint accelerates in free fall");
    check(worstBase < 1e-9, "base acceleration is exactly -g in its own frame");
}

/* -------------------------------------------------------------------- rng */
static void vRng(uint32_t seed, int n) {
    Rng r(seed);
    std::printf("mulberry32(%u) first %d draws — diff these against the JS stream\n", seed, n);
    for (int i = 0; i < n; i++) std::printf("  %.17g\n", r());
}

/* ---------------------------------------------------------------- episode */
/* Replay an episode recorded by tools/oracle_episode.js and compare the sensor
 * vector and the action, tick by tick. This exercises terrain sampling, contact,
 * self-collision, the servos, ABA, the lag window and the network in one shot —
 * if the inputs agree at tick k, everything upstream of them agreed. */
static void vEpisode(const std::string& path) {
    js::ValuePtr d = js::readJSON(path);
    std::printf("replaying %s\n", path.c_str());

    const std::string brainFile = d->strOr("brainFile", "");
    js::ValuePtr bj = d->get("brain");
    if (!bj) { std::printf("  dump has no brain\n"); failures++; return; }
    Net net = Net::fromJSON(bj);

    setReward(d->strOr("reward", "flat"));
    FIT().HEADING_W = d->numOr("headingW", 0);

    WorldOpts o;
    o.stage = (int)d->numOr("stage", 3);
    o.terrainId = d->strOr("terrainId", "varied");
    o.missionSeed = (int)d->numOr("missionSeed", 1);
    o.noiseSeed = (uint32_t)d->numOr("noiseSeed", 5000);
    o.noise = d->numOr("noise", 1) != 0;
    if (d->has("episodeSlot")) o.episodeSlot = (int)d->numOr("episodeSlot", 0);
    if (d->has("episodeCount")) o.episodeCount = (int)d->numOr("episodeCount", 0);
    if (d->has("groundFrac")) o.groundFrac = d->numOr("groundFrac", 0);

    const Model& M = HUMANOID();
    World w;
    w.init(M, &net, o);

    // Cheap structural checks first: if the episode did not even start the same
    // way, comparing tick 400 is meaningless.
    auto env = d->get("env");
    if (env) {
        check(std::fabs(w.startYaw - env->numOr("startYaw", 0)) < 1e-12, "startYaw matches");
        check(std::fabs(w.terrain.difficulty - env->numOr("terrainDifficulty", -1)) < 1e-12, "terrain difficulty matches");
        check(std::string(terrainName(w.terrain.id)) == env->strOr("terrainId", "?"), "terrain surface matches",
              std::string(terrainName(w.terrain.id)) + " vs " + env->strOr("terrainId", "?"));
        check(std::fabs(w.terrain.mu - env->numOr("mu", -1)) < 1e-12, "friction mu matches");
        check(std::fabs(w.frictionScale - env->numOr("frictionScale", -1)) < 1e-12, "frictionScale matches");
        check(std::fabs(w.riseGrace - env->numOr("riseGrace", -1)) < 1e-12, "riseGrace matches");
        check(w.walker.startPoseName == env->strOr("startPose", "?"), "start pose matches",
              w.walker.startPoseName + " vs " + env->strOr("startPose", "?"));
        auto pts = env->get("points");
        if (pts && !pts->arr.empty()) {
            const double px = pts->arr[0]->numOr("x", 0), pz = pts->arr[0]->numOr("z", 0);
            check(std::fabs(w.points[0].x - px) < 1e-12 && std::fabs(w.points[0].z - pz) < 1e-12,
                  "first waypoint matches");
        }
    }

    auto ticks = d->get("ticks");
    if (!ticks) { std::printf("  dump has no ticks\n"); failures++; return; }
    const Layout& L = LAY();
    size_t rec = 0;
    long long t = 0;
    double worstIn = 0, worstOut = 0, worstBp = 0;
    int worstInTick = -1;
    std::vector<double> driftIn;
    while (rec < ticks->arr.size() && !w.isOver() && t < 140LL * 500) {
        const bool wasControl = (w.tick % CONTROL_EVERY) == 0;
        w.step();
        if (!wasControl) { t++; continue; }
        const js::ValuePtr& r = ticks->arr[rec];
        auto in = r->get("in");
        auto out = r->get("out");
        auto bp = r->get("bp");
        double mi = 0, mo = 0, mb = 0;
        if (in) for (int i = 0; i < L.NIN && i < (int)in->arr.size(); i++)
            mi = std::max(mi, std::fabs((double)w.walker.inputs[(size_t)i] - in->arr[(size_t)i]->num));
        if (out) for (int i = 0; i < L.NOUT && i < (int)out->arr.size(); i++)
            mo = std::max(mo, std::fabs((double)w.walker.out[(size_t)i] - out->arr[(size_t)i]->num));
        if (bp) for (int i = 0; i < 3 && i < (int)bp->arr.size(); i++)
            mb = std::max(mb, std::fabs(w.walker.mb.bp[i] - bp->arr[(size_t)i]->num));
        if (mi > worstIn) { worstIn = mi; worstInTick = (int)rec; }
        worstOut = std::max(worstOut, mo);
        worstBp = std::max(worstBp, mb);
        driftIn.push_back(mi);
        rec++;
        t++;
    }
    std::printf("  compared %d control ticks\n", (int)rec);
    std::printf("  worst |d inputs| %.3e (tick %d)   worst |d out| %.3e   worst |d pelvis| %.3e m\n",
                worstIn, worstInTick, worstOut, worstBp);
    if (driftIn.size() >= 10) {
        std::printf("  drift: tick 1 %.2e   tick %d %.2e   tick %d %.2e\n",
                    driftIn[0], (int)driftIn.size()/2, driftIn[driftIn.size()/2],
                    (int)driftIn.size()-1, driftIn.back());
    }
    /* THE FIRST TICK IS THE REAL TEST. Everything the walker senses at tick 1 is a
     * pure function of the reset pose and the terrain, with no integration behind
     * it, so it isolates the sensing stack from any accumulated divergence. The
     * inputs are float32, so 1e-6 is the representable floor, not a slack budget.
     *
     * Later ticks are expected to drift and that is not a defect: sqrt(x*x+y*y)
     * differs from Math.hypot in the last ulp, libm's sin differs from V8's, and a
     * contact simulation is chaotic — two runs that differ by 1e-16 at t=0 differ
     * visibly by t=10 s in ANY implementation, including two runs of the JS on
     * different CPUs. What must not happen is a step change. */
    check(!driftIn.empty() && driftIn[0] < 2e-6, "tick 1 sensor vector matches the JS oracle");
    check(worstBp < 1e9, "no divergence to infinity");
    if (!driftIn.empty()) {
        size_t k = std::min(driftIn.size() - 1, (size_t)20);
        check(driftIn[k] < 1e-3, "sensor vector still agrees after 20 control ticks");
    }
}

/* -------------------------------------------------------------- the senses
 * Printed FROM the layout, never from a hand-kept list beside it. */
static void vInputs() {
    const Layout& L = LAY();
    std::printf("What the brain sees, 50 times a second.\n\n");
    std::printf("Each SENSOR below is read fresh every control tick. Most are also fed as a\n"
                "few older readings (the \"lags\" column, in ticks of 20 ms), because a\n"
                "feedforward network has no memory of its own — showing it the last few\n"
                "values is what lets it perceive a RATE or a TREND. That is why %d sensors\n"
                "become %d input neurons.\n\n", L.NC, L.NIN);
    std::printf("%-26s %5s %5s  %-26s %s\n", "sensor", "n", "inputs", "history fed (ticks back)", "what it means");
    std::printf("%s\n", std::string(140, '-').c_str());
    int totCh = 0, totIn = 0;
    for (const auto& g : L.groups) {
        std::string lags;
        for (size_t i = 0; i < g.lags.size(); i++) {
            if (i) lags += ",";
            lags += std::to_string(g.lags[i]);
        }
        if (g.lags.size() == 1) lags = "now only";
        std::printf("%-26s %5d %5d   %-26s %s\n", g.name, g.nch, g.inputs, lags.c_str(), g.what);
        totCh += g.nch;
        totIn += g.inputs;
    }
    std::printf("%s\n", std::string(140, '-').c_str());
    std::printf("%-26s %5d %5d\n\n", "TOTAL", totCh, totIn);
    check(totCh == L.NC, "group channel counts sum to NC");
    check(totIn == L.NIN, "group input counts sum to NIN — the table IS the network");
    std::printf("\nOutputs (%d), all squashed to 0..1:\n", L.NOUT);
    std::printf("  %-8d %-22s %s\n", L.NJ, "joint targets", "an angle for each joint; 0.5 = its relaxed standing pose");
    std::printf("  %-8d %-22s %s\n", 1, "cadence", "how fast its internal metronome ticks, 0.55x to 1.7x");
    std::printf("  %-8d %-22s %s\n", 5, "rhythm depth", "how far to swing hips / knees / ankles / hip-roll / arms");
    std::printf("  %-8d %-22s %s\n", 5, "rhythm timing", "where in the beat each of those five swings peaks");
    std::printf("\nThe network never commands torque. It sets joint TARGETS at 50 Hz and a\n"
                "servo loop chases them at 500 Hz — which is why a random newborn stands\n"
                "still instead of thrashing, and why one mutation can produce a step.\n");
}

/* ------------------------------------------------------------------ the GA
 * Drive the Evolution class through its RARE branches on synthetic fitness, with
 * no physics at all. This exists because the trainer segfaulted at generation 125
 * in the plateau-track seeding path — the first generation that path could
 * possibly run, two hours into a live run, in code that had been "working" all
 * morning.
 *
 * The GA's interesting branches are exactly the ones a smoke test never reaches:
 * a plateau round opening, the same round being judged, an activation cull, a
 * migrant crossing. Synthetic fitness reaches all of them in seconds, and a flat
 * fitness curve is what MAKES the plateau fire, so the test gets it for free. */
static void vEvolve() {
    std::printf("GA branch coverage on synthetic fitness (no physics)\n");
    const int POP = 64;
    auto runCase = [&](const char* what, const std::vector<std::string>& acts,
                       bool interbreed, int actCull, bool migrants, int gens) {
        Evolution evo(POP, 7, acts, interbreed);
        EvoLimits lim;
        lim.plateauGens = 20; lim.trackGens = 10; lim.trackCount = 3;
        lim.trackFrac = 0.36; lim.actCull = actCull;
        Rng noise(99);
        bool opened = false, judged = false, culled = false, crossed = false;
        int badSize = -1;
        for (int g = 0; g < gens; g++) {
            std::vector<Result> res((size_t)evo.brains.size());
            for (size_t i = 0; i < evo.brains.size(); i++) {
                // Deliberately FLAT with a little noise: a rising curve would never
                // trip the plateau detector, which is the branch under test.
                res[i] = { (int)i, &evo.brains[i], 1000.0 + noise() * 50.0, 0.0 };
            }
            HistRec st;
            st.stage = 3;
            if (migrants && g == 5) {
                Rng r((uint32_t)(g + 1));
                evo.admitMigrant(Net(Evolution::netSizes(), &r, Act::RELU), 12);
                evo.migrantCross = 8;
            }
            evo.evolve(std::move(res), 0.035, 0.04, 3, lim, st);
            if (evo.roundOpen) opened = true;
            if (opened && !evo.roundOpen && !evo.probeEvent.empty()) judged = true;
            if (!evo.demeEvent.empty()) culled = true;
            if (!evo.migrantEvent.empty()) { crossed = true; evo.migrantEvent.clear(); }
            // The population must stay exactly popSize through every reshuffle;
            // a track round that leaked or lost seats would corrupt the next
            // generation's partition rather than crash where the bug is.
            if ((int)evo.brains.size() != POP && badSize < 0) badSize = g;
        }
        std::string detail = std::string(opened ? "opened " : "") + (judged ? "judged " : "")
                           + (culled ? "culled " : "") + (crossed ? "migrant-crossed" : "");
        check(badSize < 0, std::string(what) + ": population stays " + std::to_string(POP),
              badSize < 0 ? detail : "broke at gen " + std::to_string(badSize));
        return opened && judged;
    };
    // A plateau round has to OPEN and be JUDGED: opening is where the segfault was,
    // judging is where the tracks are read back.
    const bool cycled = runCase("plateau tracks", { "relu" }, false, 0, true, 60);
    check(cycled, "a plateau round opened AND was judged");
    // Three demes, culled to the winner — a reshuffle of two thirds of the pool.
    runCase("activation demes + cull", { "tanh", "lrelu", "relu" }, false, 30, false, 60);
    // One interbreeding pool, where slopes mix neuron by neuron.
    runCase("interbreeding pool", { "relu", "lrelu" }, true, 0, true, 40);
}

/* ------------------------------------------------------------------ bench */
static void vBench(const std::string& brainFile, int n, int stage) {
    const Model& M = HUMANOID();
    Net net;
    if (!brainFile.empty()) {
        js::ValuePtr saved = js::readJSON(brainFile);
        net = Net::fromJSON(saved->get("net") ? saved->get("net") : saved);
    } else {
        Rng r(1);
        net = Net(LAY().NET_SIZES, &r, Act::RELU);
    }
    World w;
    const auto t0 = std::chrono::steady_clock::now();
    double totalFit = 0, totalProg = 0;
    long long ticks = 0;
    for (int e = 0; e < n; e++) {
        WorldOpts o;
        o.stage = stage;
        o.terrainId = "varied";
        const long long m = 1000000 + e;
        o.missionSeed = (int)(1 + m * 37);
        o.noiseSeed = (uint32_t)(5000 + m * 13);
        o.episodeSlot = e % 30;
        o.episodeCount = 30;
        const EpOut r = runEpisode(w, M, &net, o);
        totalFit += r.fitness;
        totalProg += r.progress;
        ticks += w.tick;
    }
    const double el = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    std::printf("bench: %d episodes in %.2f s = %.1f ms/episode (%.2f us per physics tick)\n",
                n, el, el * 1000 / n, el * 1e6 / std::max(1LL, ticks));
    std::printf("  mean fitness %.0f, mean walked %.2f m — printed so a 'fast' build that\n"
                "  stopped simulating anything is visible rather than merely quick\n",
                totalFit / n, totalProg / n);
}

/* Print the start-pose pool so the JS and C++ tables can be diffed. A pose table
 * is 14 postures x 22 joints of hand-fitted numbers living in two languages, and
 * "the poses look the same" is not a check — a single sign flipped in a mirror
 * gives a pose that renders plausibly and falls sideways. The checksum is the
 * cheap half: if it matches, the two builds draw the same pose from the same
 * index, which is what every cross-build comparison silently assumes. */
static void vPoses() {
    const Model& M = HUMANOID();
    std::printf("\n-- start poses (%d) --\n", (int)M.startPoses.size());
    std::printf("%-12s %8s %8s %9s %11s\n", "name", "pitch", "roll", "sum|q|", "checksum");
    for (const auto& p : M.startPoses) {
        double abs1 = 0, chk = 0;
        for (int j = 0; j < M.nj; j++) { abs1 += std::fabs(p.q[j]); chk += p.q[j] * (j + 1); }
        std::printf("%-12s %8.4f %8.4f %9.4f %11.5f\n",
                    p.name.c_str(), p.pitch, p.roll, abs1, chk);
    }
}


int main(int argc, char** argv) {
    installOutRowScale();
    Evolution::netSizesRef() = LAY().NET_SIZES;

    std::vector<std::string> args(argv + 1, argv + argc);
    auto has = [&](const std::string& f) { return std::find(args.begin(), args.end(), f) != args.end(); };
    auto val = [&](const std::string& f, const std::string& d) {
        auto it = std::find(args.begin(), args.end(), f);
        return (it != args.end() && it + 1 != args.end()) ? *(it + 1) : d;
    };
    const bool all = args.empty() || has("--all");

    if (has("--poses")) { vPoses(); if (!has("--all")) { return failures ? 1 : 0; } }
    if (has("--inputs")) { vInputs(); if (!has("--all")) { return failures ? 1 : 0; } }
    if (all || has("--layout")) vLayout();
    if (all || has("--inertia")) vInertia((int)std::stoi(val("--inertia", "400")));
    if (all || has("--gravity")) vGravity();
    if (all || has("--evolve")) vEvolve();
    if (has("--rng")) vRng((uint32_t)std::stoul(val("--rng", "4100")), 12);
    if (has("--episode")) vEpisode(val("--episode", ""));
    if (has("--bench")) vBench(val("--brain", ""), std::stoi(val("--bench", "20")), std::stoi(val("--stage", "3")));

    if (failures) { std::printf("\n%d CHECK%s FAILED\n", failures, failures > 1 ? "S" : ""); return 1; }
    std::printf("\nall checks passed\n");
    return 0;
}
