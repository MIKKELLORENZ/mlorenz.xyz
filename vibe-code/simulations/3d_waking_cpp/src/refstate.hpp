/* refstate.hpp — the (joint angles, gravity direction) state descriptor shared
 * by the DAgger phase tracker and the rise search's pose target.
 *
 * Joint angles are normalised exactly like the network's C_QA inputs; gravity
 * is the pelvis-frame down vector. The distance between two descriptors is the
 * one the tracker uses: sum of squared joint differences plus 3x the squared
 * gravity difference. Kept in one place so "how far is this body from that
 * pose" means the same thing in both tools.
 */
#pragma once
#include <cmath>
#include <string>
#include <vector>
#include "world.hpp"
#include "posespec.hpp"

inline void jointNorm(const Walker& x, const Model& M, float* q) {
    for (int j = 0; j < x.nj; j++) {
        const BodyDef& b = M.bodies[j + 1];
        q[j] = (float)clampd(2*(x.mb.q[j+1] - b.qmin)/M.span[j] - 1, -1.2, 1.2);
    }
}
inline void gravNorm(const Walker& x, float* g) {
    const double* R = x.mb.R.data();
    g[0] = (float)(-R[3]); g[1] = (float)(-R[4]); g[2] = (float)(-R[5]);
}
inline double stateDist2(const float* qa, const float* ga, const float* qb, const float* gb, int nj) {
    double d = 0;
    for (int j = 0; j < nj; j++) { const double e = qa[j] - qb[j]; d += e*e; }
    for (int c = 0; c < 3; c++) { const double e = ga[c] - gb[c]; d += 3.0*e*e; }
    return d;
}

/* The descriptor of a START POSE (named or spec), read off a freshly placed
 * body before any control tick: what "having reached the kneel pose" means. */
struct TargetState {
    std::vector<float> q; float g[3] = {0, 0, 0}; int nj = 0; std::string pose;
    bool valid() const { return nj > 0; }
};
inline TargetState targetForPose(const Model& M, const std::string& pose) {
    TargetState t; t.pose = pose; t.nj = M.nj; t.q.assign((size_t)M.nj, 0);
    Net dummy(LAY().NET_SIZES, nullptr, Act::RELU);
    World w; WorldOpts o;
    o.stage = 1; o.terrainId = "flat"; o.terrainDifficulty = 0; o.missionSeed = 31; o.noiseSeed = 1; o.noise = false;
    o.groundFrac = 0; o.poseFrac = 0; o.seatFrac = 0; o.scaffoldFrac = 0;
    poseOpts(o, pose);
    w.init(M, &dummy, o);
    poseApply(w, M, pose);
    /* read as placed, before any control tick — the same instant the tracker's
     * reference frame 0 is recorded at, so the two descriptors agree */
    jointNorm(w.walker, M, t.q.data());
    gravNorm(w.walker, t.g);
    return t;
}
