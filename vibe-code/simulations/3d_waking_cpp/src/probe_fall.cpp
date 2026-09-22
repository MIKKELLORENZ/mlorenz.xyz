/* probe_fall.cpp — run the trainer's OWN episode path (runEpisode, rise-only,
 * start pose "fall:x") on one brain and print what each episode scored. Built
 * to reconcile a rise-only trial that reported 21% standing with a harness
 * that reported 0/60 from the same start. */
#include <cstdio>
#include <cstdlib>
#include "episode.hpp"
int main(int argc, char** argv) {
    installOutRowScale();
    const Model& M = HUMANOID();
    js::ValuePtr saved = js::readJSON(argv[1]);
    js::ValuePtr raw = saved->get("net") ? saved->get("net") : saved;
    Net net = Net::fromJSON(raw);
    const char* pose = argc > 2 ? argv[2] : "fall:1.0";
    const int n = argc > 3 ? std::atoi(argv[3]) : 12;
    const bool riseOnly = argc > 4 ? std::atoi(argv[4]) != 0 : true;
    RISE_ONLY_SECONDS = 10; RISE_SETTLE_WINDOW = 1.0;
    World w;
    for (int e = 0; e < n; e++) {
        WorldOpts o; o.stage = 5; o.terrainId = "flat"; o.terrainDifficulty = std::getenv("TDIFF") ? std::atof(std::getenv("TDIFF")) : 1.0; o.noise = true;
        o.riseTrial = pose; o.riseOnly = riseOnly;
        o.groundFrac = 0; o.poseFrac = 0; o.seatFrac = 0; o.scaffoldFrac = 0;
        const long long m = 123456 + e; o.missionSeed = (int)(1 + m * 37); o.noiseSeed = (uint32_t)(5000 + m * 13);
        o.episodeSlot = e; o.episodeCount = n;
        EpOut r = runEpisode(w, M, &net, o);
        std::printf("ep %2d startedDown %d rose %d settled %.3f meanCom %.3f peak %.3f upright %.1fs  (%s)\n",
                    e, (int)r.startedDown, (int)r.rose, r.settled, r.meanCom, r.comPeak, r.upright, w.walker.startPoseName.c_str());
        std::printf("      end t=%.2fs falls %d recov %d diverged %d downed %d timeLeft %.2f com %.3f up %.2f\n", w.time, w.walker.falls, w.walker.recoveries, (int)w.walker.diverged, (int)w.walker.downed, w.walker.timeLeft, w.walker.comHeight(&w.terrain), w.walker.uprightness());
    }
    return 0;
}
