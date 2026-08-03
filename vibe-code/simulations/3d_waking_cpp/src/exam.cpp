/* exam.cpp — the honest exam: how many waypoints, and how deep a crouch can it
 * leave? Port of exam.js, plus the selection loop that autoselect.sh used to do
 * with sed.
 *
 *   ./walk3d_exam training/champion.json 3          print the exam
 *   ./walk3d_exam --select --stage 3                exam the live champion and,
 *                                                   if it wins, keep it
 *
 * The training log reports waypoints as a mean over the episodes in the current
 * bank, which the fleet has by now seen. The number that matters has to come from
 * missions no generation ever trained on, and from the ledger-independent COUNT of
 * arrivals rather than from fitness — counted behaviours stay comparable across
 * reward changes, which ledger values do not.
 *
 * THE STAGE MATTERS ENORMOUSLY and getting it wrong invites exactly the
 * misdiagnosis this project already made once: a champion trained at stage 2 and
 * examined at stage 3 faces double-strength shoves and sharper course changes, so
 * a low score says "harder exam", not "worse walker". It scored 0.67 waypoints
 * instead of 2.33. The second positional argument is the STAGE, not a worker
 * count.
 *
 * WHY SELECTION LIVES HERE rather than in a shell script. The JS version parsed
 * this program's own printed summary back out with sed and grep, which means the
 * ranking depended on the exact spacing of a human-readable line. Reading the
 * numbers from the values that produced them removes a whole class of silent
 * failure — and the log lines it writes are byte-compatible with what the
 * dashboard already parses.
 */
#include <cstdio>
#include <cstring>
#include <ctime>
#include <iostream>
#include <filesystem>
#include <algorithm>
#include "episode.hpp"

namespace fs = std::filesystem;

/* Held out: no training generation draws from this range. */
static const int WALK_MISSIONS[] = { 900, 907, 913, 921, 934, 947, 955, 962, 969, 976, 983, 990 };
static const int RISE_SEEDS[] = { 971, 978, 985, 992, 999, 1006 };
static constexpr int N_WALK = 12, N_SEEDS = 6;

static std::string isoStamp(const char* format) {
    const std::time_t t = std::time(nullptr);
    std::tm g{};
#if defined(_WIN32)
    gmtime_s(&g, &t);
#else
    gmtime_r(&t, &g);
#endif
    char buf[64];
    std::strftime(buf, sizeof buf, format, &g);
    return buf;
}

struct WalkResult { double arr, metres, upright; int falls; };

static WalkResult walkMission(World& w, const Model& M, Net& net, int stage, int m) {
    WorldOpts o;
    o.stage = stage;
    o.terrainId = "varied";
    o.missionSeed = 1 + m * 37;
    o.noiseSeed = (uint32_t)(5000 + m * 13);
    o.noise = true;
    o.groundFrac = 0;                        // an explicit 0, honoured — see UNSET in world.hpp
    w.init(M, &net, o);
    long long t = 0;
    while (!w.isOver() && t++ < 140LL * 500) w.step();
    const Walker& x = w.walker;
    return { (double)x.arrivals, x.progressM, x.uprightTime, x.falls };
}

struct RiseResult { bool rose; double com, upright; };

/* A "rise" is the walker's own recovery test, not a height threshold picked to
 * make the number look good. */
static RiseResult riseFrom(World& w, const Model& M, Net& net, int stage, const Pose& pose, int seed) {
    WorldOpts o;
    o.stage = stage;
    o.terrainId = "varied";
    o.missionSeed = 1 + seed * 37;
    o.noiseSeed = (uint32_t)(5000 + seed * 13);
    o.noise = true;
    o.groundFrac = 0;
    w.init(M, &net, o);
    w.walker.reset(&w, w.spawn.x, w.spawn.z, w.startYaw, &pose);
    w.walker.timeLeft = 22;
    long long t = 0;
    while (!w.isOver() && t++ < 140LL * 500) w.step();
    const Walker& x = w.walker;
    return { x.recoveries > 0, x.bestComY, x.uprightTime };
}

struct Score { double wp, metres; int twoPlus, onePlus; };

static Score runExam(World& w, const Model& M, Net& net, int stage, bool verbose,
                     const std::string& label, double gen, double fitness) {
    if (verbose) {
        std::printf("exam of %s — generation %.0f, stage %d, training fitness %.0f\n\n",
                    label.c_str(), gen, stage, fitness);
        std::printf("walking, 12 held-out missions:\n");
    }
    double arrTot = 0, mTot = 0;
    int two = 0, one = 0;
    for (int i = 0; i < N_WALK; i++) {
        const int m = WALK_MISSIONS[i];
        const WalkResult r = walkMission(w, M, net, stage, m);
        arrTot += r.arr; mTot += r.metres;
        if (r.arr >= 2) two++;
        if (r.arr >= 1) one++;
        if (verbose)
            std::printf("  mission %d  waypoints %.0f  walked %.2f m  upright %.1f s  falls %d\n",
                        m, r.arr, r.metres, r.upright, r.falls);
    }
    const Score s { arrTot / N_WALK, mTot / N_WALK, two, one };
    if (verbose)
        std::printf("  ---- mean %.2f waypoints, %.2f m · reached >=1 on %d/%d · reached >=2 on %d/%d\n\n",
                    s.wp, s.metres, one, N_WALK, two, N_WALK);
    return s;
}

static void runRiseBlocks(World& w, const Model& M, Net& net, int stage) {
    std::printf("rising from a crouch (depth 0 = the ordinary start, 1 = folded squat):\n");
    for (double d : { 0.25, 0.5, 0.75, 1.0 }) {
        int rose = 0; double com = 0;
        const Pose p = M.crouchAt(d);
        for (int s : RISE_SEEDS) { const RiseResult r = riseFrom(w, M, net, stage, p, s); rose += r.rose ? 1 : 0; com += r.com; }
        std::printf("  depth %.2f   rose %d/%d   mean peak com %.2f m\n", d, rose, N_SEEDS, com / N_SEEDS);
    }
    /* The rungs between the folded squat and the seat. This is the band the
     * curriculum used to jump over, so it is the band where progress will show up
     * first — before "seated" itself ever reads anything but 0/6. Reported as its
     * own block precisely so a partial win is visible instead of being rounded
     * away by the pass/fail on the full seat. */
    std::printf("\nrising from the seat ramp (0 = folded squat, 1 = full seated):\n");
    for (double t : { 0.25, 0.5, 0.75, 1.0 }) {
        int rose = 0; double com = 0;
        const Pose p = M.seatAt(t);
        for (int s : RISE_SEEDS) { const RiseResult r = riseFrom(w, M, net, stage, p, s); rose += r.rose ? 1 : 0; com += r.com; }
        std::printf("  seat %.2f    rose %d/%d   mean peak com %.2f m\n", t, rose, N_SEEDS, com / N_SEEDS);
    }
    std::printf("\nrising from the floor (the deferred problem — reported so it is not hidden):\n");
    for (const Pose& p : M.groundPoses) {
        int rose = 0; double com = 0;
        for (int s : RISE_SEEDS) { const RiseResult r = riseFrom(w, M, net, stage, p, s); rose += r.rose ? 1 : 0; com += r.com; }
        std::string nm = p.name;
        nm.resize(8, ' ');
        std::printf("  %s  rose %d/%d   mean peak com %.2f m\n", nm.c_str(), rose, N_SEEDS, com / N_SEEDS);
    }
}

int main(int argc, char** argv) {
    installOutRowScale();
    const Model& M = HUMANOID();

    bool select = false;
    int stage = 2;
    bool stageAuto = false;
    std::string file, dirArg;
    std::vector<std::string> pos;
    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        if (a == "--select") select = true;
        else if (a == "--stage" && i + 1 < argc) {
            const std::string v = argv[++i];
            if (v == "auto") stageAuto = true; else stage = std::atoi(v.c_str());
        }
        else if (a == "--dir" && i + 1 < argc) dirArg = argv[++i];
        else pos.push_back(a);
    }
    const fs::path exeDir = fs::absolute(fs::path(argv[0])).parent_path();
    fs::path dir = dirArg.empty() ? exeDir : fs::path(dirArg);
    const fs::path train = dir / "training";

    if (!pos.empty()) file = pos[0];
    // Second positional is the STAGE, and the file's own history says why that is
    // written down twice.
    if (pos.size() > 1) stage = std::atoi(pos[1].c_str());
    if (file.empty()) file = (train / "champion.json").string();
    fs::path fp(file);
    if (fp.is_relative()) fp = exeDir / fp;

    /* --stage auto: take the stage the run is ACTUALLY on, from its own log.
     *
     * A fixed exam stage is a footgun whenever the curriculum ramps. A champion
     * trained at stage 2 and examined at stage 3 meets double-strength shoves and
     * sharper course changes, so a low score says "harder exam", not "worse
     * walker" — this project once read 0.67 waypoints instead of 2.33 that way and
     * spent an afternoon on it. It is worse than a one-off misreading here,
     * because the ratchet compares today's score against one banked at a different
     * stage: every promotion would look like a collapse and the incumbent would
     * freeze forever.
     *
     * The run writes its stage into runlog.json every generation, so the exam can
     * simply ask instead of being told. */
    if (stageAuto) {
        js::ValuePtr rl;
        if (js::tryReadJSON((train / "runlog.json").string(), rl) && rl->type == js::Value::ARR && !rl->arr.empty())
            stage = (int)rl->arr.back()->numOr("stage", stage);
    }

    if (select) {
        /* Selection has to live where nothing sleeps. The laptop-side autobaker
         * died twice and left the repo pinned to whatever brain happened to be
         * current at the time; this loop keeps the winner on the node and the
         * laptop only ever has to FETCH one, which is a one-shot action that does
         * not care about uptime. */
        const fs::path cand = train / "champion.json";
        if (!fs::exists(cand)) { std::cerr << "no champion.json yet\n"; return 2; }
        js::ValuePtr saved;
        if (!js::tryReadJSON(cand.string(), saved)) { std::cerr << "champion.json unreadable\n"; return 2; }
        js::ValuePtr raw = saved->get("net") ? saved->get("net") : saved;
        std::vector<int> sz;
        if (auto s = raw->get("sizes")) for (auto& e : s->arr) sz.push_back((int)e->num);
        if (sz != LAY().NET_SIZES) {
            js::appendLine((train / "autoselect.log").string(),
                "[" + isoStamp("%Y-%m-%d %H:%M:%S") + "] champion.json has the wrong brain shape — skipping");
            return 3;
        }
        Net net = Net::fromJSON(raw);
        const double gen = saved->numOr("gen", 0);
        World w;
        const Score s = runExam(w, M, net, stage, false, "", gen, saved->numOr("fitness", 0));

        double curWp = 0, curMt = 0;
        js::ValuePtr cur;
        bool restaged = false;
        const fs::path scoreFile = train / "best_holdout_score.json";
        if (js::tryReadJSON(scoreFile.string(), cur)) {
            curWp = cur->numOr("waypoints", 0);
            curMt = cur->numOr("metres", 0);
            /* An incumbent banked at a different stage is not comparable, and
             * keeping it would freeze the ratchet permanently: every promotion
             * makes the exam harder, so the new stage's scores would never clear a
             * bar set on the easy one. Re-establish the bar at the current stage
             * instead, and say so — a silently reset ratchet is worse than a frozen
             * one. */
            const int wasStage = (int)cur->numOr("stage", stage);
            if (wasStage != stage) {
                restaged = true;
                curWp = 0; curMt = 0;
            }
        }
        // Ranking is mean waypoints, tie-broken on metres — counted behaviours,
        // not ledger values, so they stay comparable across reward changes.
        const bool better = (s.wp > curWp + 1e-9) || (std::fabs(s.wp - curWp) <= 1e-9 && s.metres > curMt + 1e-9);
        char line[512];
        if (better) {
            fs::copy_file(cand, train / "best_holdout.json", fs::copy_options::overwrite_existing);
            auto o = js::Value::makeObj();
            o->set("gen", gen);
            o->set("waypoints", std::stod(js::numToStr(std::round(s.wp * 100) / 100)));
            o->set("metres", std::stod(js::numToStr(std::round(s.metres * 100) / 100)));
            o->set("twoPlus", (double)s.twoPlus);
            o->set("missions", (double)N_WALK);
            o->set("stage", (double)stage);
            o->set("pickedAt", isoStamp("%Y-%m-%dT%H:%M:%SZ"));
            js::writeFileAtomic(scoreFile.string(), js::stringify(o));
            std::snprintf(line, sizeof line,
                "[%s] NEW BEST gen %.0f: %.2f wp / %.2f m, >=2 on %d/%d (was %g wp / %g m)%s",
                isoStamp("%Y-%m-%d %H:%M:%S").c_str(), gen, s.wp, s.metres, s.twoPlus, N_WALK, curWp, curMt,
                restaged ? " — bar reset, the run moved to a new stage" : "");
        } else {
            std::snprintf(line, sizeof line,
                "[%s] gen %.0f: %.2f wp / %.2f m — not better than %g wp / %g m (stage %d)",
                isoStamp("%Y-%m-%d %H:%M:%S").c_str(), gen, s.wp, s.metres, curWp, curMt, stage);
        }
        js::appendLine((train / "autoselect.log").string(), line);
        std::cout << line << "\n";
        return 0;
    }

    js::ValuePtr saved = js::readJSON(fp.string());
    js::ValuePtr raw = saved->get("net") ? saved->get("net") : saved;
    std::vector<int> sz;
    if (auto s = raw->get("sizes")) for (auto& e : s->arr) sz.push_back((int)e->num);
    /* A brain saved before an input-layer change cannot run against this build, and
     * the failure without this guard is a crash out of forward() that looks like a
     * physics bug rather than a stale file. It happens every time the architecture
     * grows: the previous run leaves its champion.json behind, and the selection
     * loop picks it up before the new run has written its first one. */
    if (sz != LAY().NET_SIZES) {
        std::string a, b;
        for (size_t i = 0; i < sz.size(); i++) { if (i) a += "-"; a += std::to_string(sz[i]); }
        for (size_t i = 0; i < LAY().NET_SIZES.size(); i++) { if (i) b += "-"; b += std::to_string(LAY().NET_SIZES[i]); }
        std::cerr << "cannot exam " << fp.filename().string() << ": it is a " << a
                  << " brain and this build is " << b << ". Stale champion from a previous architecture?\n";
        return 3;
    }
    Net net = Net::fromJSON(raw);
    World w;
    runExam(w, M, net, stage, true, fp.filename().string(), saved->numOr("gen", 0), saved->numOr("fitness", 0));
    runRiseBlocks(w, M, net, stage);
    return 0;
}
