/* body.hpp — the humanoid. Port of body.js.
 *
 * Deliberately blocky: every segment is a box, so the thing you see on screen is
 * exactly the thing the physics integrates. What is NOT simplified is the
 * articulation — 19 visible links, 22 actuated 1-DoF joints, plus the 6-DoF
 * floating pelvis. Multi-axis joints (hip, ankle, waist, shoulder) are built as
 * short chains of 1-DoF revolutes through weightless carrier links, which keeps
 * every joint a scalar the network can command and a servo can drive.
 *
 * Frame convention: +X forward, +Y up, +Z to the doll's LEFT.
 *   · rotation about +Z ("pitch") swings a downward-hanging limb FORWARD
 *   · rotation about +X ("roll") swings it to the doll's RIGHT
 *   · rotation about +Y ("yaw") turns the doll LEFT
 */
#pragma once
#include <vector>
#include <string>
#include <array>
#include <cmath>
#include <algorithm>
#include "physics.hpp"

/* Segment geometry (m). Everything downstream — inertia, contact points, the
 * rendered mesh — is derived from these, never hand-copied. */
struct Seg {
    static constexpr double ankleH   = 0.066;   // sole to ankle joint
    static constexpr double footHeel = 0.075;
    static constexpr double footToe  = 0.183;
    static constexpr double footW    = 0.100;
    static constexpr double shank    = 0.418;
    static constexpr double thigh    = 0.417;
    /* Hip separation and thigh width are a CLEARANCE BUDGET, not two free
     * numbers: 90 mm of air between the legs, which the mirrored roll limits are
     * then sized against. */
    static constexpr double hipZ     = 0.105;
    static constexpr double thighZ   = 0.120;
    static constexpr double waistY   = 0.100;
    static constexpr double torso    = 0.390;
    static constexpr double torsoZ   = 0.300;
    static constexpr double shoulderZ= 0.215;
    static constexpr double upperArm = 0.316;
    static constexpr double forearm  = 0.248;
    static constexpr double hand     = 0.100;   // a flat paddle hand — four palm
    static constexpr double handW    = 0.090;   // corners can plant and press,
    static constexpr double handT    = 0.028;   // where one wrist point could not
    static constexpr double headGap  = 0.050;
    static constexpr double head     = 0.230;
};
constexpr double TOTAL_MASS = 65.0;
constexpr double TOTAL_HEIGHT = Seg::ankleH + Seg::shank + Seg::thigh + Seg::waistY
                              + Seg::torso + Seg::headGap + Seg::head;

/* Joint indices — the order buildHumanoid() adds them in. Joint j drives body j+1. */
enum JointIdx {
    J_WAIST_YAW = 0, J_WAIST_PITCH,
    J_L_SHOULDER, J_L_SHOULDER_ROLL, J_L_ELBOW, J_L_WRIST,
    J_R_SHOULDER, J_R_SHOULDER_ROLL, J_R_ELBOW, J_R_WRIST,
    J_L_HIP_YAW, J_L_HIP_ROLL, J_L_HIP_PITCH, J_L_KNEE, J_L_ANK_PITCH, J_L_ANK_ROLL,
    J_R_HIP_YAW, J_R_HIP_ROLL, J_R_HIP_PITCH, J_R_KNEE, J_R_ANK_PITCH, J_R_ANK_ROLL,
    J_COUNT
};

struct Pose {
    std::string name;
    double pitch = 0, roll = 0;
    std::vector<double> q;
    /* `depth` feeds riseGrace. The JS reads `startPose.depth || 1`, so a pose
     * without one — every floor pose — behaves as depth 1, and so does a crouch
     * drawn at exactly 0. Stored explicitly here and read through the same rule. */
    double depth = 1;
    double seatT = -1;
    double graceDepth() const { return depth == 0 ? 1.0 : depth; }
};

struct ContactPt { int body; double p[3]; int foot; };
struct Sphere { int body; double p[3]; double r; int side; };   // side: 0=L, 1=R, 2=Torso

struct Model {
    std::vector<BodyDef> bodies;
    int nj = 0;
    int footBody[2] = {0, 0};
    int torsoBody = 2;
    std::vector<std::string> jointNames;
    std::vector<double> nominal, crouch, kp, kd, tauMax, range, span;
    std::vector<ContactPt> contacts;
    std::vector<std::pair<Sphere, Sphere>> selfPairs;
    std::vector<Pose> groundPoses;
    /* The pose pool. Fourteen postures a walker can wake up in, on top of the
     * crouch/seat ramp — see the block at the end of buildHumanoid(). Unlike
     * groundPoses, which world.js only ever used as a truthiness guard, these are
     * actually drawn from. */
    std::vector<Pose> startPoses;
    double totalMass = 0, weight = 0, height = 0;
    double standHipY = 0, crouchHipY = 0;

    /* Depth is a continuous parameter between the ordinary crouch a run starts
     * from (0) and a deep folded squat near the floor (1), so "get up" stops
     * being a cliff and becomes a ramp the curriculum can walk down one notch at
     * a time — which is how every other skill here was actually learned. */
    Pose crouchAt(double depth) const {
        Pose po;
        const double d = std::max(0.0, std::min(1.0, depth));
        po.q = crouch;
        // deepen the squat while keeping anklePitch = -(hipPitch + knee), the
        // condition that holds the soles flat
        const double hip = crouch[J_L_HIP_PITCH] + d * 1.05;
        const double knee = crouch[J_L_KNEE] - d * 0.95;
        const int trip[2][3] = { {J_L_HIP_PITCH, J_L_KNEE, J_L_ANK_PITCH},
                                 {J_R_HIP_PITCH, J_R_KNEE, J_R_ANK_PITCH} };
        for (auto& t : trip) { po.q[t[0]] = hip; po.q[t[1]] = knee; po.q[t[2]] = -(hip + knee); }
        po.q[J_WAIST_PITCH] = crouch[J_WAIST_PITCH] - d * 0.45;   // fold forward over the knees
        po.q[J_L_SHOULDER] = crouch[J_L_SHOULDER] + d * 0.85;
        po.q[J_R_SHOULDER] = crouch[J_R_SHOULDER] + d * 0.85;
        char buf[32]; std::snprintf(buf, sizeof buf, "crouch%.2f", d);
        po.name = buf;
        po.pitch = 0; po.roll = 0; po.depth = d;
        return po;
    }

    /* The rung that was missing. Between crouchAt(1) and "seated" there was a
     * cliff the exam measured for weeks without either side of it moving: from a
     * folded squat champions rise 3/6, from the seat 0/6, and nothing in between
     * was ever presented to them. The two poses are not different in kind — in
     * the squat the pelvis is above the feet with the soles flat, in the seat it
     * is on the floor behind them, and everything between is exactly the
     * continuum a rise has to traverse in reverse.
     *
     * `depth` keeps counting upward past 1 so riseGrace keeps growing with the
     * difficulty. */
    Pose seatAt(double t) const {
        const double u = std::max(0.0, std::min(1.0, t));
        const Pose a = crouchAt(1.0);
        const Pose& seated = groundPoses[0];      // "seated" is first by construction
        Pose po;
        po.q.resize(nj);
        for (int j = 0; j < nj; j++) po.q[j] = a.q[j] + (seated.q[j] - a.q[j]) * u;
        char buf[32]; std::snprintf(buf, sizeof buf, "seat%.2f", u);
        po.name = buf;
        po.pitch = a.pitch + (seated.pitch - a.pitch) * u;
        po.roll  = a.roll  + (seated.roll  - a.roll)  * u;
        po.depth = 1 + u;
        po.seatT = u;
        return po;
    }
};

/* Inertia of a solid box about its own centre. */
inline std::array<double,3> boxInertia(double m, double a, double b, double c) {
    return { m*(b*b + c*c)/12, m*(a*a + c*c)/12, m*(a*a + b*b)/12 };
}

struct Box { double c[3]; double d[3]; double m; };

/* Merge a list of boxes into one rigid body. */
struct Composite { double mass; double com[3]; double inertia[3]; };
inline Composite composite(const std::vector<Box>& boxes) {
    double m = 0, cx = 0, cy = 0, cz = 0;
    for (auto& b : boxes) { m += b.m; cx += b.m*b.c[0]; cy += b.m*b.c[1]; cz += b.m*b.c[2]; }
    if (m <= 0) return { 0, {0,0,0}, {0,0,0} };
    cx /= m; cy /= m; cz /= m;
    double ix = 0, iy = 0, iz = 0;
    for (auto& b : boxes) {
        auto bi = boxInertia(b.m, b.d[0], b.d[1], b.d[2]);
        const double dx = b.c[0]-cx, dy = b.c[1]-cy, dz = b.c[2]-cz;
        ix += bi[0] + b.m*(dy*dy + dz*dz);
        iy += bi[1] + b.m*(dx*dx + dz*dz);
        iz += bi[2] + b.m*(dx*dx + dy*dy);
    }
    return { m, {cx,cy,cz}, {ix,iy,iz} };
}

inline Model buildHumanoid() {
    constexpr int AX_X = 0, AX_Y = 1, AX_Z = 2;
    auto MF = [](double f) { return f * TOTAL_MASS; };     // Winter's segment mass fractions
    Model M;
    auto& B = M.bodies;

    struct Joint { double qmin, qmax, kp, kd, tauMax, armature, nominal, crouch; };
    auto add = [&](const char* name, int parent, int axis, double rx, double ry, double rz,
                   const Composite& g, const Joint* j) -> int {
        BodyDef b;
        b.name = name; b.parent = parent; b.axis = axis;
        b.r[0] = rx; b.r[1] = ry; b.r[2] = rz;
        b.mass = g.mass;
        for (int k = 0; k < 3; k++) { b.com[k] = g.com[k]; b.inertia[k] = g.inertia[k]; }
        if (j) {
            b.qmin = j->qmin; b.qmax = j->qmax; b.kp = j->kp; b.kd = j->kd;
            b.tauMax = j->tauMax; b.armature = j->armature;
            b.nominal = j->nominal; b.crouch = j->crouch;
        }
        B.push_back(b);
        return (int)B.size() - 1;
    };
    const Composite CARRIER = { 0, {0,0,0}, {0,0,0} };

    /* --- 0: pelvis (floating base). Its frame origin sits at the hip centre. --- */
    const Composite pelvis = composite({ { {0, 0.030, 0}, {0.240, 0.220, 0.300}, MF(0.142) } });
    add("pelvis", -1, AX_Y, 0, 0, 0, pelvis, nullptr);

    /* --- waist: yaw then pitch, carrying the torso+head --- */
    { Joint j{ -0.70, 0.70, 320, 20, 140, 0.10, 0, 0 };
      add("waistYawLink", 0, AX_Y, 0, Seg::waistY, 0, CARRIER, &j); }
    const double torsoTop = Seg::torso;
    const Composite torso = composite({
        { {0, torsoTop*0.5, 0}, {0.260, torsoTop, Seg::torsoZ}, MF(0.355) },
        { {0, torsoTop + Seg::headGap + Seg::head*0.5, 0}, {0.200, Seg::head, 0.200}, MF(0.081) }
    });
    /* Waist pitch reaches much further forward than a walking-only joint needs:
     * a sit-up starts with the trunk, and 34 degrees does not clear the hips.
     * Negative is forward flexion here. */
    int iTorso;
    { Joint j{ -1.20, 0.45, 600, 36, 260, 0.10, 0, -0.15 };
      iTorso = add("torso", 1, AX_Z, 0, 0, 0, torso, &j); }
    M.torsoBody = iTorso;

    /* --- arms: shoulder pitch + roll + elbow + wrist, one side then the other --- */
    const Composite upperArm = composite({ { {0, -Seg::upperArm*0.5, 0}, {0.090, Seg::upperArm, 0.090}, MF(0.028) } });
    const Composite forearm  = composite({ { {0, -Seg::forearm*0.5, 0},  {0.080, Seg::forearm, 0.080},  MF(0.016) } });
    const Composite handG    = composite({ { {0, -Seg::hand*0.5, 0}, {Seg::handT, Seg::hand, Seg::handW}, MF(0.006) } });
    /* Three DoF per arm. A one-axis shoulder is not a humanoid shoulder, and the
     * missing roll had a second cost: with the arm locked in the sagittal plane
     * it had nowhere to go but through the hip. Roll is deeply asymmetric because
     * the arm runs into the ribs long before it reaches the midline. */
    const double ARM_ABDUCT = 1.90, ARM_ADDUCT = 0.20, ARM_REST = 0.12;
    for (int side = 0; side < 2; side++) {
        const char* tag = side == 0 ? "L" : "R";
        const double sz = side == 0 ? 1.0 : -1.0;
        auto nm = [&](const char* s) { return std::string(tag) + s; };
        int sp, ua, fa;
        { Joint j{ -1.60, 1.60, 110, 7, 60, 0.04, 0, -0.20 };
          sp = add(nm("ShoulderPitchLink").c_str(), iTorso, AX_Z, 0, Seg::torso, sz*Seg::shoulderZ, CARRIER, &j); }
        { Joint j{ sz > 0 ? -ARM_ABDUCT : -ARM_ADDUCT, sz > 0 ? ARM_ADDUCT : ARM_ABDUCT,
                   100, 6, 55, 0.04, -sz*ARM_REST, -sz*ARM_REST };
          ua = add(nm("UpperArm").c_str(), sp, AX_X, 0, 0, 0, upperArm, &j); }
        { Joint j{ 0.00, 2.40, 70, 4, 40, 0.02, 0.25, 0.30 };
          fa = add(nm("Forearm").c_str(), ua, AX_Z, 0, -Seg::upperArm, 0, forearm, &j); }
        // Wrist pitch, so the palm can lie FLAT on the floor instead of meeting it
        // at whatever angle the forearm happens to hold.
        { Joint j{ -1.20, 1.20, 45, 3, 25, 0.012, 0, 0 };
          add(nm("Hand").c_str(), fa, AX_Z, 0, -Seg::forearm, 0, handG, &j); }
    }

    /* --- legs: hip yaw / roll / pitch, knee, ankle pitch / roll --- */
    const Composite thigh = composite({ { {0, -Seg::thigh*0.5, 0}, {0.130, Seg::thigh, Seg::thighZ}, MF(0.100) } });
    const Composite shank = composite({ { {0, -Seg::shank*0.5, 0}, {0.110, Seg::shank, 0.120}, MF(0.0465) } });
    const double footCx = (Seg::footToe - Seg::footHeel) * 0.5;
    const Composite foot = composite({ { {footCx, -Seg::ankleH*0.5, 0},
        {Seg::footToe + Seg::footHeel, Seg::ankleH, Seg::footW}, MF(0.0145) } });
    for (int side = 0; side < 2; side++) {
        const char* tag = side == 0 ? "L" : "R";
        const double sz = side == 0 ? 1.0 : -1.0;
        auto nm = [&](const char* s) { return std::string(tag) + s; };
        int hy, hr, th, sh, ap;
        { Joint j{ -0.60, 0.60, 300, 18, 110, 0.10, 0, 0 };
          hy = add(nm("HipYawLink").c_str(), 0, AX_Y, 0, 0, sz*Seg::hipZ, CARRIER, &j); }
        /* Hip roll is MIRRORED. Rotation about +X swings a hanging limb to the
         * doll's right, so for the left leg positive roll is adduction and for
         * the right leg it is abduction. A symmetric limit is what let both legs
         * swing toward the centreline at once and pass through each other. */
        const double ADDUCT = 0.22, ABDUCT = 0.55;
        { Joint j{ sz > 0 ? -ABDUCT : -ADDUCT, sz > 0 ? ADDUCT : ABDUCT, 700, 40, 220, 0.12, 0, 0 };
          hr = add(nm("HipRollLink").c_str(), hy, AX_X, 0, 0, 0, CARRIER, &j); }
        { Joint j{ -0.90, 1.80, 800, 45, 240, 0.12, 0.05, 0.55 };
          th = add(nm("Thigh").c_str(), hr, AX_Z, 0, 0, 0, thigh, &j); }
        { Joint j{ -2.40, 0.00, 800, 45, 260, 0.12, -0.10, -1.16 };
          sh = add(nm("Shank").c_str(), th, AX_Z, 0, -Seg::thigh, 0, shank, &j); }
        { Joint j{ -0.90, 0.90, 700, 40, 190, 0.10, 0.05, 0.61 };
          ap = add(nm("AnklePitchLink").c_str(), sh, AX_Z, 0, -Seg::shank, 0, CARRIER, &j); }
        { Joint j{ -0.45, 0.45, 420, 24, 140, 0.08, 0, 0 };
          M.footBody[side] = add(nm("Foot").c_str(), ap, AX_X, 0, 0, 0, foot, &j); }
    }

    /* ---------------------------------------------- joint bookkeeping, first
     * The pose helpers below read M.crouch, so the tables have to exist before
     * them. (The JS gets away with defining crouchAt earlier only because it is a
     * closure that is not called until later.) */
    const int nj = (int)B.size() - 1;
    M.nj = nj;
    M.nominal.resize(nj); M.crouch.resize(nj); M.kp.resize(nj); M.kd.resize(nj);
    M.tauMax.resize(nj); M.range.resize(nj); M.span.resize(nj);
    for (int j = 0; j < nj; j++) {
        const BodyDef& b = B[j + 1];
        std::string n = b.name;
        if (n.size() > 4 && n.compare(n.size() - 4, 4, "Link") == 0) n = n.substr(0, n.size() - 4);
        M.jointNames.push_back(n);
        M.nominal[j] = b.nominal;
        M.crouch[j] = b.crouch;
        M.kp[j] = b.kp;
        M.kd[j] = b.kd;
        M.tauMax[j] = b.tauMax;
        M.range[j] = std::max(b.qmax - b.nominal, b.nominal - b.qmin);
        M.span[j] = b.qmax - b.qmin;
    }

    /* ---------------------------------------------------------- ground poses
     * Where a walker starts when it is not starting on its feet. `pitch` is about
     * +Z, which tips the body's up-axis toward -X, so +90 degrees lands it on its
     * back and +90 of roll puts it on its side. Ordered by how hard they are to
     * get out of, because the curriculum introduces them in that order. */
    auto gp = [&](const char* name, double pitch, double roll,
                  std::initializer_list<std::pair<int,double>> edits) {
        Pose p;
        p.name = name; p.pitch = pitch; p.roll = roll;
        p.q.assign(nj, 0.0);
        for (auto& e : edits) p.q[e.first] = e.second;
        p.depth = 1;                 // the JS reads `depth || 1` for these
        return p;
    };
    /* Sitting with the knees UP and the feet close to the body — how someone
     * actually sits on the ground, and the only sitting posture a rise can start
     * from. With the legs straight out in front, standing means first hauling
     * both feet back underneath, a long blind sequence with no reward gradient
     * along it: six champions all scored 0/6 and a scripted attempt could not do
     * it either, so the POSE was the wall, not the search. Must stay first —
     * seatAt() interpolates toward it by index. */
    M.groundPoses.push_back(gp("seated", 0.22, 0, {
        {J_WAIST_PITCH, -0.28},
        {J_L_HIP_PITCH, 1.50}, {J_R_HIP_PITCH, 1.50},
        {J_L_KNEE, -1.95}, {J_R_KNEE, -1.90},
        {J_L_ANK_PITCH, 0.50}, {J_R_ANK_PITCH, 0.50},
        {J_L_SHOULDER, -0.70}, {J_R_SHOULDER, -0.70},
        {J_L_ELBOW, 0.35}, {J_R_ELBOW, 0.35},
        {J_L_WRIST, -0.70}, {J_R_WRIST, -0.70}
    }));
    M.groundPoses.push_back(gp("side", 0.35, 1.45, {
        {J_L_HIP_PITCH, 1.20}, {J_R_HIP_PITCH, 0.85},
        {J_L_KNEE, -1.30}, {J_R_KNEE, -0.95},
        {J_L_SHOULDER, 0.7}, {J_R_SHOULDER, 1.1},
        {J_L_SHOULDER_ROLL, -0.5}, {J_R_SHOULDER_ROLL, 0.3},
        {J_L_ELBOW, 1.1}, {J_R_ELBOW, 0.8},
        {J_L_WRIST, -0.5}, {J_R_WRIST, -0.4}
    }));
    M.groundPoses.push_back(gp("curled", 0.6, 1.35, {
        {J_WAIST_PITCH, -0.5},
        {J_L_HIP_PITCH, 1.70}, {J_R_HIP_PITCH, 1.65},
        {J_L_KNEE, -2.00}, {J_R_KNEE, -1.90},
        {J_L_SHOULDER, 1.2}, {J_R_SHOULDER, 1.2},
        {J_L_ELBOW, 1.6}, {J_R_ELBOW, 1.6}
    }));
    M.groundPoses.push_back(gp("supine", 1.50, 0, {
        {J_L_HIP_PITCH, 0.35}, {J_R_HIP_PITCH, 0.30},
        {J_L_KNEE, -0.45}, {J_R_KNEE, -0.40},
        {J_L_SHOULDER, -0.6}, {J_R_SHOULDER, -0.6},
        {J_L_SHOULDER_ROLL, -0.7}, {J_R_SHOULDER_ROLL, 0.7},
        {J_L_ELBOW, 0.4}, {J_R_ELBOW, 0.4},
        {J_L_WRIST, -0.6}, {J_R_WRIST, -0.6}
    }));
    M.groundPoses.push_back(gp("prone", -1.50, 0, {
        {J_L_HIP_PITCH, -0.20}, {J_R_HIP_PITCH, -0.15},
        {J_L_KNEE, -0.30}, {J_R_KNEE, -0.25},
        {J_L_SHOULDER, 1.4}, {J_R_SHOULDER, 1.4},
        {J_L_SHOULDER_ROLL, -0.6}, {J_R_SHOULDER_ROLL, 0.6},
        {J_L_ELBOW, 1.5}, {J_R_ELBOW, 1.5},
        // palms flat under the shoulders, which is where a press-up starts
        {J_L_WRIST, -0.9}, {J_R_WRIST, -0.9}
    }));

    /* ------------------------------------------------------------ the pose pool
     * Mirrors body.js exactly — same names, same angles, same order, because the
     * two builds have to draw the same pose from the same RNG index or every
     * cross-check between them is meaningless.
     *
     * Fourteen postures on top of the crouch/seat ramp. The ramp varies ONE thing,
     * how far down the walker starts, and every rung on it is the same shape:
     * square to the world, symmetric, weight through the feet. Nothing in it has
     * ever loaded hip roll, twisted the waist, put weight through one arm, or put
     * the pelvis on the floor with the legs folded to one side.
     *
     * Each was fitted against the body rather than typed: the JS-side
     * pose_check.js declares which contacts belong on the ground and moves the
     * joints until they are, inside the limits, without driving a limb through
     * another, and with any weight-bearing palm laid flat instead of stood on its
     * edge. Several looked completely normal and were wrong — the reverse tabletop
     * hung off its palms with both feet 19 cm in the air, because shoulder to
     * fingertip is 0.664 m against a 0.42 m thigh. */
    M.startPoses.push_back(gp("bridge", 1.57, 0, {
        {J_WAIST_PITCH, 0.40},
        {J_L_HIP_PITCH, -0.05}, {J_R_HIP_PITCH, -0.05},
        {J_L_KNEE, -1.22}, {J_R_KNEE, -1.22},
        {J_L_SHOULDER, -1.60}, {J_R_SHOULDER, -1.60},
        {J_L_SHOULDER_ROLL, 0.07}, {J_R_SHOULDER_ROLL, -0.07},
        {J_L_ELBOW, 1.15}, {J_R_ELBOW, 1.15},
        {J_L_WRIST, -0.26}, {J_R_WRIST, -0.26}
    }));
    M.startPoses.push_back(gp("horse", 0, 0, {
        {J_WAIST_PITCH, -0.15},
        {J_L_HIP_ROLL, -0.55}, {J_R_HIP_ROLL, 0.55},
        {J_L_HIP_PITCH, 0.80}, {J_R_HIP_PITCH, 0.80},
        {J_L_KNEE, -1.35}, {J_R_KNEE, -1.35},
        {J_L_ANK_PITCH, 0.55}, {J_R_ANK_PITCH, 0.55},
        {J_L_SHOULDER, 0.45}, {J_R_SHOULDER, 0.45},
        {J_L_SHOULDER_ROLL, -0.45}, {J_R_SHOULDER_ROLL, 0.45},
        {J_L_ELBOW, 0.75}, {J_R_ELBOW, 0.75},
        {J_L_WRIST, -0.20}, {J_R_WRIST, -0.20}
    }));
    M.startPoses.push_back(gp("kneel", 0, 0, {
        {J_WAIST_PITCH, 0.40},
        {J_L_KNEE, -1.5708}, {J_R_KNEE, -1.5708},
        {J_L_ANK_PITCH, -0.90}, {J_R_ANK_PITCH, -0.90},
        {J_L_SHOULDER, -0.90}, {J_R_SHOULDER, -0.90},
        {J_L_SHOULDER_ROLL, -0.20}, {J_R_SHOULDER_ROLL, 0.20},
        {J_L_ELBOW, 0.30}, {J_R_ELBOW, 0.30},
        {J_L_WRIST, -0.40}, {J_R_WRIST, -0.40}
    }));
    M.startPoses.push_back(gp("quadruped", -1.5708, 0, {
        {J_L_HIP_PITCH, 1.57}, {J_R_HIP_PITCH, 1.57},
        {J_L_KNEE, -1.57}, {J_R_KNEE, -1.57},
        {J_L_ANK_PITCH, -0.85}, {J_R_ANK_PITCH, -0.85},
        {J_L_SHOULDER, 1.40}, {J_R_SHOULDER, 1.40},
        {J_L_SHOULDER_ROLL, 0.05}, {J_R_SHOULDER_ROLL, -0.05},
        {J_L_ELBOW, 1.26}, {J_R_ELBOW, 1.26},
        {J_L_WRIST, -0.05}, {J_R_WRIST, -0.05}
    }));
    M.startPoses.push_back(gp("hugknees", 0.95, 0, {
        {J_WAIST_PITCH, -0.40},
        {J_L_HIP_PITCH, 1.55}, {J_R_HIP_PITCH, 1.55},
        {J_L_KNEE, -2.05}, {J_R_KNEE, -2.00},
        {J_L_ANK_PITCH, 0.45}, {J_R_ANK_PITCH, 0.45},
        {J_L_SHOULDER, 0.70}, {J_R_SHOULDER, 0.70},
        {J_L_SHOULDER_ROLL, -0.30}, {J_R_SHOULDER_ROLL, 0.30},
        {J_L_ELBOW, 1.55}, {J_R_ELBOW, 1.55},
        {J_L_WRIST, 0.20}, {J_R_WRIST, 0.20}
    }));
    M.startPoses.push_back(gp("crow", -1.10, 0, {
        {J_WAIST_PITCH, -0.60},
        {J_L_HIP_PITCH, 1.75}, {J_R_HIP_PITCH, 1.75},
        {J_L_KNEE, -2.30}, {J_R_KNEE, -2.30},
        {J_L_ANK_PITCH, -0.50}, {J_R_ANK_PITCH, -0.50},
        {J_L_SHOULDER, 1.35}, {J_R_SHOULDER, 1.35},
        {J_L_SHOULDER_ROLL, -0.45}, {J_R_SHOULDER_ROLL, 0.45},
        {J_L_ELBOW, 0.85}, {J_R_ELBOW, 0.85},
        {J_L_WRIST, -0.60}, {J_R_WRIST, -0.60}
    }));
    M.startPoses.push_back(gp("warrior2", -0.30, 0, {
        {J_L_HIP_YAW, 0.60},
        {J_L_HIP_ROLL, -0.55}, {J_L_HIP_PITCH, 0.95}, {J_L_KNEE, -0.76}, {J_L_ANK_PITCH, 0.17},
        {J_R_HIP_ROLL, 0.55}, {J_R_HIP_PITCH, 0.03}, {J_R_ANK_PITCH, 0.42},
        {J_L_SHOULDER_ROLL, -1.55}, {J_R_SHOULDER_ROLL, 1.55},
        {J_L_ELBOW, 0.05}, {J_R_ELBOW, 0.05}
    }));
    M.startPoses.push_back(gp("warrior3", -1.4508, 0, {
        {J_WAIST_PITCH, 0.10},
        {J_L_HIP_PITCH, 1.4508}, {J_L_KNEE, -0.05}, {J_L_ANK_PITCH, 0.05},
        {J_R_HIP_PITCH, -0.05}, {J_R_KNEE, -0.05},
        {J_L_SHOULDER, 0.05}, {J_R_SHOULDER, 0.05},
        {J_L_SHOULDER_ROLL, -0.35}, {J_R_SHOULDER_ROLL, 0.35},
        {J_L_ELBOW, 0.10}, {J_R_ELBOW, 0.10}
    }));
    M.startPoses.push_back(gp("sideplank", -0.03, -1.09, {
        {J_WAIST_PITCH, 0.05},
        {J_L_HIP_PITCH, -0.08}, {J_R_HIP_PITCH, -0.08},
        {J_L_KNEE, -0.06}, {J_R_KNEE, -0.06},
        {J_L_ANK_PITCH, 0.10}, {J_R_ANK_PITCH, 0.90}, {J_R_ANK_ROLL, 0.45},
        {J_R_SHOULDER, 0.12}, {J_R_SHOULDER_ROLL, 1.08}, {J_R_WRIST, -1.20},
        {J_L_SHOULDER_ROLL, -1.55}, {J_L_ELBOW, 0.10}
    }));
    M.startPoses.push_back(gp("sidesit", 0.70, 0.45, {
        {J_L_HIP_YAW, -0.38}, {J_L_HIP_ROLL, 0.22},
        {J_L_HIP_PITCH, 1.80}, {J_L_KNEE, -2.10}, {J_L_ANK_PITCH, 0.50},
        {J_R_HIP_YAW, -0.60}, {J_R_HIP_ROLL, 0.55},
        {J_R_HIP_PITCH, 0.95}, {J_R_KNEE, -1.93}, {J_R_ANK_PITCH, 0.74},
        {J_R_SHOULDER, -1.07}, {J_R_SHOULDER_ROLL, -0.20}, {J_R_WRIST, -1.10},
        {J_L_SHOULDER, 0.55}, {J_L_SHOULDER_ROLL, -0.40}, {J_L_ELBOW, 1.00}
    }));

    /* The mirrors, generated rather than typed out a second time.
     *
     * The rule is read off the joint AXES, not hard-coded: a joint about Z is
     * sagittal and keeps its sign, a joint about X or Y is lateral and flips, and
     * the two limb chains swap. Base roll flips with them, base pitch does not.
     *
     * Generating them matters. These poses cost a fitter and several rounds of
     * looking at renders, and a hand-written mirror is a second chance to get one
     * sign wrong — producing a pose that looks almost right and falls sideways.
     * Only the four asymmetric poses get one; the other six are their own
     * reflections and a duplicate would quietly double their share of the draw. */
    {
        auto jname = [&](int j) {
            std::string n = B[j + 1].name;
            if (n.size() > 4 && n.compare(n.size() - 4, 4, "Link") == 0) n = n.substr(0, n.size() - 4);
            return n;
        };
        std::vector<int> mmap(nj); std::vector<double> msign(nj);
        for (int j = 0; j < nj; j++) {
            std::string n = jname(j), other = n;
            if (n[0] == 'L') other = "R" + n.substr(1);
            else if (n[0] == 'R') other = "L" + n.substr(1);
            mmap[j] = j;
            for (int i = 0; i < nj; i++) if (jname(i) == other) { mmap[j] = i; break; }
            msign[j] = B[j + 1].axis == 2 ? 1.0 : -1.0;
        }
        const char* toMirror[] = { "warrior2", "warrior3", "sideplank", "sidesit" };
        for (const char* nm : toMirror) {
            const Pose* src = nullptr;
            for (const auto& p : M.startPoses) if (p.name == nm) { src = &p; break; }
            if (!src) continue;                    // never silently mirror nothing
            Pose m = *src;
            m.name = std::string(nm) + "'";
            m.roll = -src->roll;
            m.q.assign(nj, 0.0);
            for (int j = 0; j < nj; j++) m.q[j] = msign[j] * src->q[mmap[j]];
            M.startPoses.push_back(m);
        }
    }

    /* ---------------------------------------------------------- contact points
     * Every point that can touch the ground. `foot` is 0/1 for the sole corners
     * (the load sensor sums them per foot) and -1 elsewhere. Knees, hands, hips,
     * torso, head and arms are here so a walker that loses it actually collapses
     * onto the ground and lies there, instead of sinking through a floor only its
     * soles can feel. */
    auto idxOf = [&](const std::string& name) {
        for (size_t i = 0; i < B.size(); i++) if (B[i].name == name) return (int)i;
        return -1;
    };
    const double contactPts[4][3] = {
        { -Seg::footHeel, -Seg::ankleH,  Seg::footW*0.5 },
        { -Seg::footHeel, -Seg::ankleH, -Seg::footW*0.5 },
        {  Seg::footToe,  -Seg::ankleH,  Seg::footW*0.5 },
        {  Seg::footToe,  -Seg::ankleH, -Seg::footW*0.5 }
    };
    auto pushC = [&](int body, double x, double y, double z, int foot) {
        ContactPt c; c.body = body; c.p[0]=x; c.p[1]=y; c.p[2]=z; c.foot = foot;
        M.contacts.push_back(c);
    };
    for (int s = 0; s < 2; s++)
        for (auto& p : contactPts) pushC(M.footBody[s], p[0], p[1], p[2], s);
    for (int side = 0; side < 2; side++) {
        const std::string tag = side == 0 ? "L" : "R";
        pushC(idxOf(tag + "Shank"), 0.075, -0.035, 0, -1);            // knee
        // Four palm corners, not one wrist point: a single point generates no
        // moment, so it can push but cannot stop the forearm pivoting around it.
        const int h = idxOf(tag + "Hand");
        for (double hx : { -Seg::handT*0.5, Seg::handT*0.5 })
            for (double hz : { -Seg::handW*0.5, Seg::handW*0.5 })
                pushC(h, hx, -Seg::hand, hz, -1);
    }
    for (double sx : { -0.11, 0.11 }) for (double sz : { -0.14, 0.14 }) pushC(0, sx, -0.08, sz, -1);
    // Front and back of the chest. sx is the fore-aft axis, so these catch a
    // face-down or flat-on-the-back landing.
    for (double sx : { -0.13, 0.13 }) for (double sy : { 0.10, 0.34 }) pushC(iTorso, sx, sy, 0, -1);
    /* …and the LATERAL extremes. Every torso point above sits at z = 0, but z is
     * the chest-width axis, so a walker that toppled sideways had nothing between
     * the mid-plane of its ribcage and the floor and sank up to 150 mm. */
    for (double sz : { -Seg::torsoZ*0.5, Seg::torsoZ*0.5 })
        for (double sy : { 0.10, 0.34 }) pushC(iTorso, 0, sy, sz, -1);
    const double headY = Seg::torso + Seg::headGap + Seg::head*0.5, hrad = Seg::head*0.5;
    pushC(iTorso, 0, headY, 0, -1);
    for (double hx : { -hrad, hrad }) pushC(iTorso, hx, headY, 0, -1);
    for (double hz : { -hrad, hrad }) pushC(iTorso, 0, headY, hz, -1);
    // Upper arm and forearm had no ground contact at all — only the palms — so an
    // arm flung out during a fall passed straight through the floor.
    for (int side = 0; side < 2; side++) {
        const std::string tag = side == 0 ? "L" : "R";
        pushC(idxOf(tag + "UpperArm"), 0, -Seg::upperArm*0.6, 0, -1);
        pushC(idxOf(tag + "Forearm"),  0, -Seg::forearm*0.6, 0, -1);
    }

    /* ------------------------------------------------- self-collision spheres
     * Joint limits alone cannot stop the legs crossing without being tighter than
     * any real hip — a sweep of the reachable joint space found a thigh passing
     * 176 mm through the other one in 45.8% of poses — so the limbs carry
     * collision spheres and the solver pushes them apart. Spheres rather than
     * boxes on purpose: this runs every physics tick, and a sphere pair is one
     * distance where an OBB pair is fifteen projections. */
    std::vector<Sphere> legSpheres;
    for (int side = 0; side < 2; side++) {
        const std::string tag = side == 0 ? "L" : "R";
        const int th = idxOf(tag + "Thigh"), sh = idxOf(tag + "Shank");
        legSpheres.push_back({ th, {0, -Seg::thigh*0.35, 0}, Seg::thighZ*0.5, side });
        legSpheres.push_back({ th, {0, -Seg::thigh*0.75, 0}, Seg::thighZ*0.5, side });
        legSpheres.push_back({ sh, {0, -Seg::shank*0.30, 0}, 0.058, side });
        legSpheres.push_back({ sh, {0, -Seg::shank*0.70, 0}, 0.055, side });
        legSpheres.push_back({ M.footBody[side], {0.05, -Seg::ankleH*0.5, 0}, 0.055, side });
    }
    // only across the midline: a limb never collides with its own chain
    for (auto& a : legSpheres) for (auto& b : legSpheres)
        if (a.side == 0 && b.side == 1) M.selfPairs.emplace_back(a, b);

    /* Arms against the chest. The shoulder offset clears the torso in the REST
     * pose, but shoulder roll can swing an arm inward across the body and nothing
     * was checking it. The torso carries its own spheres, tagged so the midline
     * rule above leaves them alone. */
    std::vector<Sphere> torsoSpheres;
    for (double ty : { 0.10, 0.24, 0.36 })
        torsoSpheres.push_back({ iTorso, {0, ty, 0}, Seg::torsoZ*0.42, 2 });
    std::vector<Sphere> armSpheres;
    for (int side = 0; side < 2; side++) {
        const std::string tag = side == 0 ? "L" : "R";
        const int ua = idxOf(tag + "UpperArm"), fa = idxOf(tag + "Forearm");
        armSpheres.push_back({ ua, {0, -Seg::upperArm*0.45, 0}, 0.052, side });
        armSpheres.push_back({ ua, {0, -Seg::upperArm*0.85, 0}, 0.050, side });
        armSpheres.push_back({ fa, {0, -Seg::forearm*0.50, 0}, 0.046, side });
        armSpheres.push_back({ fa, {0, -Seg::forearm*0.90, 0}, 0.044, side });
    }
    for (auto& a : armSpheres) for (auto& t : torsoSpheres) M.selfPairs.emplace_back(a, t);
    // …and the arms against each other across the midline, so they cannot fold
    // through one another in front of the chest.
    for (auto& a : armSpheres) for (auto& b : armSpheres)
        if (a.side == 0 && b.side == 1) M.selfPairs.emplace_back(a, b);

    M.totalMass = 0;
    for (auto& b : B) M.totalMass += b.mass;
    M.weight = M.totalMass * 9.81;
    M.height = TOTAL_HEIGHT;
    // Hip height in each keyframe pose, straight from the leg kinematics.
    auto hipY = [&](const std::vector<double>& pose) {
        return Seg::ankleH + Seg::shank * std::cos(pose[J_L_HIP_PITCH] + pose[J_L_KNEE])
             + Seg::thigh * std::cos(pose[J_L_HIP_PITCH]);
    };
    M.standHipY = hipY(M.nominal);
    M.crouchHipY = hipY(M.crouch);
    return M;
}

/* One shared, immutable instance — the JS builds HUMANOID once at load and every
 * walker points at it. Threads only ever read it. */
inline const Model& HUMANOID() {
    static const Model m = buildHumanoid();
    return m;
}
