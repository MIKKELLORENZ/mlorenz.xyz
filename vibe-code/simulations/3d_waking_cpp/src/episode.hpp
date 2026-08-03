/* episode.hpp — run one brain on one mission and report what it did.
 *
 * The one place an episode is defined, shared by the trainer, the exam and the
 * verifier. Having three copies of the loop is how the trainer and the benchmark
 * ended up running 200-second episodes on cities the benchmark ran for 380 in a
 * sister project, which hid a crash penalty that never fired.
 */
#pragma once
#include <string>
#include "world.hpp"
#include "walker_impl.hpp"

struct EpOut {
    double fitness = 0, arrivals = 0, upright = 0, progress = 0;
    double steps = 0, stride = 0, dist = 0, comPeak = 0, align = 0;
    bool stood = false, balanced = false, startedDown = false, rose = false;
    const char* surface = "?";
};

/* `w` is supplied by the caller so a worker thread can keep one World alive for
 * the whole run and pay its allocations once. */
inline EpOut runEpisode(World& w, const Model& M, Net* brain, const WorldOpts& o) {
    w.init(M, brain, o);
    long long guard = 0;
    while (!w.isOver() && guard++ < 140LL * 500) w.step();
    const Walker& x = w.walker;
    EpOut r;
    r.fitness = x.fitness();
    r.arrivals = x.arrivals;
    r.stood = x.stood;
    r.balanced = x.balanced;
    r.upright = x.uprightTime;
    r.progress = x.progressM;
    r.steps = x.steps;
    r.stride = x.strideSum;
    r.dist = std::sqrt(x.mb.bp[0]*x.mb.bp[0] + x.mb.bp[2]*x.mb.bp[2]);
    r.startedDown = x.startedDown;
    // "rose" only counts on episodes that actually started on the floor, otherwise
    // a walker that never fell would score 0 and drag the mean down for doing
    // nothing wrong.
    r.rose = x.startedDown && x.recoveries > 0;
    r.comPeak = x.bestComY;
    r.align = x.meanAlign();
    r.surface = terrainName(w.terrain.id);
    return r;
}
