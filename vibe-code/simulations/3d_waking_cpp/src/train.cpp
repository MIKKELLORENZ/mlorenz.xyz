/* train.cpp — headless trainer. Same simulation the browser runs, no rendering,
 * one thread per core. Port of train.js.
 *
 *   ./walk3d_train --gens 400 --pop 192 --episodes 30 --workers 120
 *   ./walk3d_train --resume training/champion.json --gens 200
 *
 * WHY THE JOB IS (BRAIN, EPISODE) AND NOT A SLICE OF THE POPULATION.
 *
 * Episode length varies by an order of magnitude — a walker that falls at 5 s and
 * one that runs the full 130 s clock cost the same worker wildly different time —
 * so a static partition makes every generation wait for whichever worker drew the
 * longest-lived brains. Measured on the JS run at 128 workers: min 1120, median
 * 1155, max 1515 cpu-seconds, i.e. the busiest worker 96% busy and the median only
 * 73%, with about 30% of the machine sitting at the barrier.
 *
 * The JS answer was a queue of brain-chunks, and then a second split over the
 * episode bank once 192 jobs across 96 workers turned out to be too coarse to
 * smooth anything. Here the finest granularity is free: there is no marshalling,
 * because every thread reads the same population out of shared memory. So the
 * queue is simply every (brain, episode) pair — 192 x 30 = 5,760 items for 120
 * threads, 48 apiece — and load imbalance stops being a term.
 *
 * DETERMINISM IS UNAFFECTED, and this is the property the whole design rests on.
 * The environment is a pure function of (missionSeed, noiseSeed), both derived
 * from the generation and the ABSOLUTE episode index, and walkers never interact.
 * Which thread happens to run a pair cannot change its score, and every result is
 * written to its own slot and reduced afterwards in index order — so the reduction
 * is not a floating-point race either. The same --seed gives the same run
 * regardless of --workers.
 */
#include <atomic>
#include <thread>
#include <mutex>
#include <chrono>
#include <cstdio>
#include <cstdarg>
#include <cstring>
#include <ctime>
#include <iostream>
#include <sstream>
#include <fstream>
#include <algorithm>
#include <filesystem>
#include "episode.hpp"
#include "evolution.hpp"

namespace fs = std::filesystem;

/* Training missions live here and the held-out exam lives at 900-990. Keeping
 * them in disjoint blocks is the only thing that makes "held out" true. */
constexpr long long MISSION_BLOCK = 1000000;

/* ------------------------------------------------------------------- args */
static int g_argc; static char** g_argv;
static const char* rawArg(const char* name) {
    const std::string key = std::string("--") + name;
    for (int i = 1; i < g_argc; i++)
        if (key == g_argv[i]) {
            if (i + 1 >= g_argc) return "";
            const char* v = g_argv[i + 1];
            return (v[0] == '-' && v[1] == '-') ? "" : v;
        }
    return nullptr;
}
static bool hasArg(const char* name) { return rawArg(name) != nullptr; }
static double argNum(const char* name, double d) {
    const char* v = rawArg(name);
    if (!v) return d;
    if (!*v) return 1;                     // bare flag, like the JS `--x` => true
    return std::strtod(v, nullptr);
}
static std::string argStr(const char* name, const std::string& d) {
    const char* v = rawArg(name);
    return (v && *v) ? std::string(v) : d;
}

static std::string isoNow(long long epochSec = -1) {
    std::time_t t = epochSec >= 0 ? (std::time_t)epochSec : std::time(nullptr);
    std::tm g{};
#if defined(_WIN32)
    gmtime_s(&g, &t);
#else
    gmtime_r(&t, &g);
#endif
    char buf[64];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%S", &g);
    return std::string(buf) + ".000Z";
}
static double nowSec() {
    using namespace std::chrono;
    return duration<double>(system_clock::now().time_since_epoch()).count();
}
static std::string fmt(const char* f, ...) {
    va_list a; va_start(a, f);
    char buf[1024];
    std::vsnprintf(buf, sizeof buf, f, a);
    va_end(a);
    return std::string(buf);
}
static std::string pad(const std::string& s, int w) {
    return s.size() >= (size_t)w ? s : std::string((size_t)w - s.size(), ' ') + s;
}

int main(int argc, char** argv) {
    g_argc = argc; g_argv = argv;
    std::ios::sync_with_stdio(false);

    installOutRowScale();
    Evolution::netSizesRef() = LAY().NET_SIZES;

    struct {
        int gens, pop, episodes, workers, grace, stageLock, save;
        uint32_t seed;
        double mutRate, mutSigma, headingW, cpgScale, servoScale, trackFrac;
        long long deadline;
        int plateauGens, trackGens, trackCount, actCull, exportEvery, exportCount,
            injectLife, injectCross;
        bool surfaceNorm, interbreed, quiet, freshHistory;
        std::string terrain, out, resume, reward, injectDir, exportDir, island;
        std::vector<std::string> acts;
    } CFG;

    CFG.gens = (int)argNum("gens", 300);
    CFG.pop = (int)argNum("pop", 48);
    CFG.episodes = (int)argNum("episodes", 3);
    {
        const int hw = std::max(1u, std::thread::hardware_concurrency());
        int want = (int)argNum("workers", std::max(1, hw - 2));
        /* Cap to what the machine actually has, and SAY SO when the request is
         * trimmed. The JS had a hard cap of 32 that silently swallowed --workers on
         * any bigger machine: a 128-core node asked for 120, got 32, and ran at 25%
         * utilisation while the log cheerfully reported the requested figure. */
        if (want > hw) { std::cout << "--workers " << want << " exceeds " << hw
                                   << " logical CPUs; using " << hw << "\n"; want = hw; }
        CFG.workers = std::max(1, want);
    }
    CFG.seed = (uint32_t)argNum("seed", 1234);
    CFG.mutRate = argNum("mut-rate", MutDefault::rate);
    CFG.mutSigma = argNum("mut-sigma", MutDefault::sigma);
    CFG.grace = (int)argNum("grace", 3);
    CFG.stageLock = (int)argNum("stage-lock", 0);
    CFG.terrain = argStr("terrain", "rolling");
    CFG.out = argStr("out", "training");
    CFG.resume = argStr("resume", "");
    CFG.freshHistory = argNum("fresh-history", 0) != 0;
    CFG.save = (int)argNum("save-every", 10);
    CFG.reward = argStr("reward", "flat");
    CFG.cpgScale = argNum("cpg-scale", 1);
    CFG.servoScale = argNum("servo-scale", 1);
    CFG.deadline = (long long)argNum("deadline", 0);
    CFG.plateauGens = (int)argNum("plateau-gens", 100);
    CFG.trackGens = (int)argNum("track-gens", 50);
    CFG.trackFrac = argNum("track-frac", 0.36);
    CFG.trackCount = (int)argNum("track-count", 3);
    CFG.surfaceNorm = argNum("surface-norm", 0) != 0;
    CFG.headingW = argNum("heading-w", 0);
    CFG.injectDir = argStr("inject-dir", "");
    CFG.exportDir = argStr("export-dir", "");
    CFG.island = argStr("island", "isl");
    CFG.exportEvery = (int)argNum("export-every", 20);
    CFG.exportCount = (int)argNum("export-count", 2);
    CFG.injectLife = (int)argNum("inject-life", 12);
    CFG.injectCross = (int)argNum("inject-cross", 8);
    CFG.actCull = (int)argNum("act-cull", 250);
    CFG.interbreed = argNum("interbreed", 0) != 0;
    CFG.quiet = hasArg("quiet");
    {
        std::stringstream ss(argStr("acts", "tanh"));
        std::string tok;
        while (std::getline(ss, tok, ',')) {
            while (!tok.empty() && tok.front() == ' ') tok.erase(tok.begin());
            while (!tok.empty() && tok.back() == ' ') tok.pop_back();
            if (!tok.empty()) CFG.acts.push_back(tok);
        }
        std::string bad;
        for (auto& a : CFG.acts) if (!knownAct(a)) { if (!bad.empty()) bad += ", "; bad += a; }
        if (!bad.empty()) {
            std::cout << "!! unknown activation(s) " << bad << " — known: tanh, lrelu, relu\n";
            return 1;
        }
    }

    setReward(CFG.reward);
    TUNE().cpgScale = CFG.cpgScale;
    TUNE().servoScale = CFG.servoScale;
    FIT().HEADING_W = CFG.headingW;

    const fs::path exeDir = fs::absolute(fs::path(argv[0])).parent_path();
    fs::path outDir = fs::path(CFG.out);
    if (outDir.is_relative()) outDir = exeDir / outDir;
    fs::create_directories(outDir);

    const Model& M = HUMANOID();
    Evolution evo(CFG.pop, CFG.seed, CFG.acts, CFG.interbreed);
    if (CFG.interbreed && !evo.interbreed) {
        std::cout << "!! --interbreed needs two or more activations and cannot include tanh\n";
        return 1;
    }
    if (evo.interbreed) {
        std::cout << "activation: INTERBREEDING in one pool of " << CFG.pop
                  << " — crossover carries each neuron's slope, so children are mixed unit by unit\n";
    } else if (CFG.acts.size() > 1) {
        std::cout << "activation A/B:";
        for (auto& d : evo.demes) std::cout << " " << d.act << " x" << d.n;
        std::cout << " — bred separately on identical missions"
                  << (CFG.actCull > 0 ? fmt(", culled to the winner at generation %d\n", CFG.actCull)
                                      : std::string(", never culled\n"));
    }

    /* ------------------------------------------------------------- resume */
    if (!CFG.resume.empty()) {
        /* --resume takes a COMMA-SEPARATED list, and more than one is not a
         * convenience — it is diversity. Seeding an entire population from a single
         * brain hands generation 1 to one lineage, and if that lineage sits in a
         * local minimum the run starts inside it: mutation alone rarely walks a
         * population out of a basin it was born in. */
        std::vector<std::string> files;
        std::stringstream ss(CFG.resume);
        std::string tok;
        while (std::getline(ss, tok, ',')) if (!tok.empty()) files.push_back(tok);
        struct Loaded { std::string file; Net net; double fitness; js::ValuePtr saved; };
        std::vector<Loaded> loaded;
        for (auto& f : files) {
            fs::path p = fs::path(f);
            if (p.is_relative()) p = exeDir / p;
            js::ValuePtr saved = js::readJSON(p.string());
            js::ValuePtr raw = saved->get("net") ? saved->get("net") : saved;
            /* Refuse a brain whose shape no longer describes this body, rather than
             * letting fromJSON build one quietly. It happens every time the sensor
             * layout changes: the previous run leaves its champion.json behind and
             * the selection loop picks it up. */
            std::vector<int> sz;
            if (auto s = raw->get("sizes")) for (auto& e : s->arr) sz.push_back((int)e->num);
            if (sz != LAY().NET_SIZES) {
                std::string a, b;
                for (size_t i = 0; i < sz.size(); i++) { if (i) a += "-"; a += std::to_string(sz[i]); }
                for (size_t i = 0; i < LAY().NET_SIZES.size(); i++) { if (i) b += "-"; b += std::to_string(LAY().NET_SIZES[i]); }
                std::cout << "!! cannot resume from " << f << ": it is a " << a
                          << " brain and this build is " << b << "\n";
                return 3;
            }
            loaded.push_back({ f, Net::fromJSON(raw), saved->numOr("fitness", 0), saved });
        }
        // The champion slot belongs to the first file listed; the others are
        // ancestry, not incumbents.
        evo.champion = loaded[0].net.clone();
        evo.hasChampion = true;
        evo.championFit = loaded[0].fitness;
        /* Split the pool evenly, each block keeping a couple of pristine copies so a
         * seed cannot be lost to a bad mutation draw in its first generation. */
        const int per = (int)(evo.brains.size() / loaded.size());
        for (size_t i = 0; i < evo.brains.size(); i++) {
            const int k = std::min((int)loaded.size() - 1, (int)(i / std::max(1, per)));
            const bool pristine = ((int)i - k * per) < 2;
            evo.brains[i] = loaded[(size_t)k].net.clone();
            if (!pristine) evo.brains[i].mutate(CFG.mutRate, CFG.mutSigma, evo.rng);
        }
        /* An interbreeding pool seeded from ONE brain inherits that brain's slopes,
         * so resuming from a pure leaky champion would start at 100% leaky with no
         * ReLU genes anywhere for crossover to recombine. Half the seats therefore
         * get their slopes rewritten to the other rectifier — cheap in a way it
         * would not be for tanh, since the two agree exactly on every positive
         * pre-activation, so a hard-rectified copy keeps all of the learned weights. */
        if (evo.interbreed) {
            for (size_t i = 0; i < evo.brains.size(); i++) {
                Net& b = evo.brains[i];
                if (b.slopes.empty()) continue;
                const float v = (float)slopeValue(actFromName(CFG.acts[i % CFG.acts.size()]));
                for (auto& s : b.slopes) std::fill(s.begin(), s.end(), v);
                b.relabel();
            }
        }
        /* History is restored only from a single-file resume. stageFor's anti-stall
         * fallbacks are keyed on the generation number, so a resume that left gen at
         * 1 would silently re-arm every one of them. A grafted seed deliberately
         * carries no history: the world changed under it, so it has to re-earn its
         * promotions. --fresh-history is the same argument for a change the graft
         * cannot see — when the SCORING changes the brain is untouched but its
         * recorded fitness is in the old currency, and the plateau detector fed both
         * would compare stratified scores with i.i.d. ones and call it a stall. */
        auto hist = loaded[0].saved->get("history");
        if (loaded.size() == 1 && hist && hist->type == js::Value::ARR && !CFG.freshHistory) {
            for (auto& e : hist->arr) evo.history.push_back(HistRec::fromJSON(e));
            evo.gen = (int)evo.history.size() + 1;
        } else if (CFG.freshHistory && hist && hist->type == js::Value::ARR) {
            std::cout << "  dropped " << hist->arr.size()
                      << " gens of history — scoring changed, fitness is not comparable\n";
        }
        for (auto& l : loaded)
            std::cout << "seeded from " << l.file << " (fitness " << fmt("%.0f", l.fitness) << ")\n";
        std::cout << "  population " << evo.brains.size() << " split across " << loaded.size()
                  << " seed" << (loaded.size() > 1 ? "s" : "") << ", "
                  << evo.history.size() << " gens of history restored\n";
    }

    if (CFG.deadline > 0) {
        const double mins = (CFG.deadline - nowSec()) / 60.0;
        std::cout << "deadline " << isoNow(CFG.deadline) << " — " << fmt("%.0f", mins) << " min from now\n";
    }
    std::cout << (CFG.plateauGens > 0
        ? fmt("plateau tracks: if best fitness is flat over %d gens, split %.0f%% of the pool into %d independent tracks seeded from the leader, run them %d gens, adopt any that overtakes it\n",
              CFG.plateauGens, CFG.trackFrac * 100, CFG.trackCount, CFG.trackGens)
        : std::string("plateau tracks: off\n"));
    std::cout << "brain " << LAY().NIN << "-48-32-" << LAY().NOUT
              << ", " << CFG.workers << " threads, pop " << CFG.pop
              << " x " << CFG.episodes << " episodes = "
              << (size_t)CFG.pop * CFG.episodes << " jobs/generation\n";

    /* Stamp the chart boundary from the TRAINER, not from a launch script. The JS
     * left this to whichever shell script started the run, three of them forgot,
     * and the dashboard drew two lineages on one axis — the dead run's generations
     * 16-536 and the live run's 1-154, with the line running up to 536 and then
     * falling back. The process that knows where the run begins should be the one
     * that says so. */
    {
        auto cf = js::Value::makeObj();
        cf->set("gen", (double)evo.gen);
        cf->set("since", isoNow());
        js::writeFileAtomic((outDir / "chart_from.json").string(), js::stringify(cf));
    }

    std::vector<HistRec> runLog = evo.history;

    auto saveChampion = [&](const std::string& tag) -> std::string {
        if (!evo.hasChampion) return "";
        const std::string file = (outDir / ("champion" + tag + ".json")).string();
        auto o = js::Value::makeObj();
        o->set("net", evo.champion.toJSON());
        o->set("fitness", evo.championFit);
        o->set("gen", (double)evo.gen);
        auto ns = js::Value::makeArr();
        for (int s : LAY().NET_SIZES) ns->push(js::Value::make((double)s));
        o->set("netSizes", ns);
        o->set("savedAt", isoNow());
        auto h = js::Value::makeArr();
        for (auto& r : evo.history) h->push(r.toJSON());
        o->set("history", h);
        js::writeFileAtomic(file, js::stringify(o));
        return file;
    };
    auto saveRunLog = [&]() {
        auto a = js::Value::makeArr();
        for (auto& r : runLog) a->push(r.toJSON());
        js::writeFileAtomic((outDir / "runlog.json").string(), js::stringify(a));
    };

    /* ------------------------------------------------- island immigration */
    auto takeMigrants = [&]() {
        fs::path dir = fs::path(CFG.injectDir);
        if (dir.is_relative()) dir = exeDir / dir;
        std::error_code ec;
        if (!fs::exists(dir, ec)) return;                 // not created yet — normal
        std::vector<fs::path> files;
        for (auto& e : fs::directory_iterator(dir, ec))
            if (e.is_regular_file() && e.path().extension() == ".json") files.push_back(e.path());
        if (files.empty()) return;
        std::sort(files.begin(), files.end());
        const fs::path done = dir / "consumed";
        fs::create_directories(done, ec);
        for (auto& src : files) {
            try {
                js::ValuePtr saved = js::readJSON(src.string());
                js::ValuePtr raw = saved->get("net") ? saved->get("net") : saved;
                std::vector<int> sz;
                if (auto s = raw->get("sizes")) for (auto& e : s->arr) sz.push_back((int)e->num);
                /* The shape check is not a formality: the two islands can drift
                 * apart — a sensor change on one side and not the other — and
                 * fromJSON would happily build a net whose weight matrices no
                 * longer describe this body. Refuse and say so, rather than train
                 * on a brain nobody bred. */
                if (sz != LAY().NET_SIZES) {
                    std::cout << "  migrant " << src.filename().string() << " REFUSED: shape mismatch\n";
                } else {
                    evo.admitMigrant(Net::fromJSON(raw), CFG.injectLife);
                    std::cout << "  migrant " << src.filename().string()
                              << " taken in as breeding stock ONLY — it gets no seat"
                              << " (its island's generation " << (int)saved->numOr("gen", 0)
                              << "). It crosses with our elites for " << CFG.injectLife
                              << " generations at " << CFG.injectCross << " children each;"
                              << " only those children compete, and only by out-scoring"
                              << " the incumbents on our own missions.\n";
                }
            } catch (const std::exception& e) {
                std::cout << "  migrant " << src.filename().string() << " unreadable (" << e.what() << ")\n";
            }
            std::error_code mv;
            fs::rename(src, done / src.filename(), mv);
            if (mv) fs::remove(src, mv);
        }
    };
    /* Send this island's best few to the peer's inject directory. Written under a
     * dot-name and then renamed, because the peer scans that directory between its
     * own generations and a half-written file would be parsed as a corrupt brain.
     * rename is atomic within a filesystem; copy is not. */
    auto exportEmigrants = [&]() {
        fs::path dir = fs::path(CFG.exportDir);
        if (dir.is_relative()) dir = exeDir / dir;
        std::error_code ec;
        fs::create_directories(dir, ec);
        const int count = std::max(1, std::min(CFG.exportCount, (int)evo.brains.size()));
        const std::string stamp = CFG.island + "_g" + std::to_string(evo.gen);
        int sent = 0;
        for (int i = 0; i < count; i++) {
            auto o = js::Value::makeObj();
            o->set("net", evo.brains[(size_t)i].toJSON());
            o->set("fitness", i == 0 ? evo.championFit : 0.0);
            o->set("gen", (double)evo.gen);
            o->set("rank", (double)i);
            o->set("from", CFG.island);
            const fs::path tmp = dir / ("." + stamp + "_" + std::to_string(i) + ".json");
            { std::ofstream f(tmp, std::ios::binary); f << js::stringify(o); }
            std::error_code mv;
            fs::rename(tmp, dir / (stamp + "_" + std::to_string(i) + ".json"), mv);
            if (!mv) sent++; else fs::remove(tmp, mv);
        }
        if (sent) std::cout << "  sent " << sent << " emigrant" << (sent > 1 ? "s" : "")
                            << " (ranks 0-" << (sent - 1) << ") to the peer island\n";
    };

    /* --------------------------------------------------------- the workers */
    const int POP_MAX = CFG.pop;
    const int E = CFG.episodes;
    std::vector<EpOut> epOut((size_t)POP_MAX * E);
    std::vector<const char*> surfaces((size_t)E, "?");
    WorldOpts baseOpts;
    std::atomic<long long> jobCounter{0};
    long long jobTotal = 0;

    auto workerFn = [&](int) {
        World w;                                  // one per thread, reused: see world.hpp
        for (;;) {
            const long long k = jobCounter.fetch_add(1, std::memory_order_relaxed);
            if (k >= jobTotal) return;
            const int i = (int)(k / E), e = (int)(k % E);
            WorldOpts o = baseOpts;
            const long long m = (long long)baseOpts.missionSeed + e;   // missionBase + e
            o.missionSeed = (int)(1 + m * 37);
            o.noiseSeed = (uint32_t)(5000 + m * 13);
            o.episodeSlot = e;
            o.episodeCount = E;
            epOut[(size_t)i * E + e] = runEpisode(w, M, &evo.brains[(size_t)i], o);
        }
    };

    const double t0 = nowSec();
    int prevStage = -1;
    for (int g = 0; g < CFG.gens; g++) {
        Curriculum curr;
        curr.stageLock = CFG.stageLock;
        const StagePick st = stageFor(evo.gen, evo.history, curr);
        /* The champion is the best brain of the CURRENT stage, and fitness is not
         * comparable across stages, so a promotion silently retires the outgoing
         * stage's best. One run peaked at 3,920 on stage 2 and that brain is simply
         * gone — overwritten ten generations later by a stage-3 champion worth
         * 1,161. Bank the outgoing champion before the ground moves. */
        if (prevStage != -1 && st.stage != prevStage) {
            const std::string f = saveChampion(fmt("_st%d_gen%d", prevStage, evo.gen));
            std::cout << "stage " << prevStage << " -> " << st.stage
                      << "; banked the outgoing champion to " << fs::path(f).filename().string() << "\n";
        }
        prevStage = st.stage;

        baseOpts = WorldOpts{};
        baseOpts.stage = st.stage;
        baseOpts.terrainDifficulty = st.terrainDifficulty;
        baseOpts.terrainId = CFG.terrain;
        baseOpts.noise = true;
        /* A fresh block of `episodes` missions per generation, offset clear of the
         * held-out exam. The old numbering was `missionBase = gen`, which walks
         * straight into the exam's 900-990 block around generation 900 and silently
         * turns held-out missions into training ones — the exam would still print a
         * number, and the number would be a lie. Long runs reach generation 900.
         *
         * missionSeed carries the BASE here and the worker adds its episode index;
         * the per-episode seeds are derived from the absolute index, so how the work
         * is split cannot change a single score. */
        baseOpts.missionSeed = (int)(MISSION_BLOCK + (long long)evo.gen * E);

        if (!CFG.injectDir.empty()) { evo.migrantCross = CFG.injectCross; takeMigrants(); }

        const int n = (int)evo.brains.size();
        if ((int)epOut.size() < n * E) epOut.resize((size_t)n * E);
        jobTotal = (long long)n * E;
        jobCounter.store(0, std::memory_order_relaxed);
        {
            std::vector<std::thread> pool;
            pool.reserve((size_t)CFG.workers);
            for (int t = 0; t < CFG.workers; t++) pool.emplace_back(workerFn, t);
            for (auto& t : pool) t.join();
        }

        /* Reduce in index order, single-threaded. Deterministic by construction:
         * the same additions in the same order regardless of --workers. */
        struct Acc {
            double fitness=0, arrivals=0, stood=0, balanced=0, upright=0, progress=0,
                   steps=0, stride=0, dist=0, ground=0, rose=0, comPeak=0, align=0;
        };
        std::vector<Acc> acc((size_t)n);
        std::vector<std::vector<double>> perEp((size_t)n, std::vector<double>((size_t)E, 0.0));
        for (int i = 0; i < n; i++) {
            Acc& a = acc[(size_t)i];
            for (int e = 0; e < E; e++) {
                const EpOut& r = epOut[(size_t)i * E + e];
                perEp[(size_t)i][(size_t)e] = r.fitness;
                a.fitness += r.fitness / E;
                a.arrivals += r.arrivals / E;
                a.stood += (r.stood ? 1.0 : 0.0) / E;
                a.balanced += (r.balanced ? 1.0 : 0.0) / E;
                a.upright += r.upright / E;
                a.progress += r.progress / E;
                a.steps += r.steps / E;
                a.stride += r.stride / E;
                a.dist += r.dist / E;
                a.ground += (r.startedDown ? 1.0 : 0.0) / E;
                a.rose += (r.rose ? 1.0 : 0.0) / E;
                a.comPeak += r.comPeak / E;
                a.align += r.align / E;
                if (i == 0) surfaces[(size_t)e] = r.surface;
            }
        }

        /* Fitness the selector actually ranks on. With --surface-norm this is the
         * per-surface-equalised score rather than the plain bank mean; the raw mean
         * stays in `acc` for the log so both remain visible. */
        std::vector<double> ranked;
        if (CFG.surfaceNorm) {
            std::vector<std::string> surf((size_t)E);
            for (int e = 0; e < E; e++) surf[(size_t)e] = surfaces[(size_t)e];
            ranked = normaliseBySurface(perEp, surf);
        } else {
            ranked.resize((size_t)n);
            for (int i = 0; i < n; i++) ranked[(size_t)i] = acc[(size_t)i].fitness;
        }
        std::vector<Result> results((size_t)n);
        for (int i = 0; i < n; i++)
            results[(size_t)i] = { i, &evo.brains[(size_t)i], ranked[(size_t)i], acc[(size_t)i].arrivals };

        /* Curriculum statistics describe the MAIN line only. While a plateau round
         * is running, part of the population is deliberately breeding at up to five
         * times the usual mutation rate and mostly falling over; that belongs in the
         * experiment, not in the numbers the stage ratchet reads. Folded in, a
         * search for a way forward would look like the fleet getting worse and could
         * hold back a promotion it had already earned. */
        const int N = std::min(evo.mainCount, n);
        HistRec stats;
        stats.stage = st.stage;
        stats.terrainDifficulty = st.terrainDifficulty;
        auto sum = [&](double Acc::*f) { double s = 0; for (int i = 0; i < N; i++) s += acc[(size_t)i].*f; return s; };
        auto maxOf = [&](double Acc::*f) { double m = -1e300; for (int i = 0; i < N; i++) m = std::max(m, acc[(size_t)i].*f); return m; };
        stats.stoodFrac = sum(&Acc::stood) / N;
        stats.balancedFrac = sum(&Acc::balanced) / N;
        stats.avgArr = sum(&Acc::arrivals) / N;
        stats.bestArr = maxOf(&Acc::arrivals);
        stats.avgUpright = sum(&Acc::upright) / N;
        stats.maxUpright = maxOf(&Acc::upright);
        stats.avgProg = sum(&Acc::progress) / N;
        stats.bestProg = maxOf(&Acc::progress);
        stats.avgSteps = sum(&Acc::steps) / N;
        stats.bestSteps = maxOf(&Acc::steps);
        stats.avgStride = sum(&Acc::stride) / N;
        stats.bestStride = maxOf(&Acc::stride);
        stats.groundFrac = sum(&Acc::ground) / N;
        stats.roseFrac = sum(&Acc::rose) / N;
        stats.bestCom = maxOf(&Acc::comPeak);
        stats.avgAlign = sum(&Acc::align) / N;
        /* Fleet mean heading alignment, and the alignment of whoever walked
         * furthest — not the best alignment in the fleet, which a walker that never
         * moved would win with a vacuous 1.0. */
        {
            int lead = 0;
            for (int i = 1; i < N; i++) if (acc[(size_t)i].progress > acc[(size_t)lead].progress) lead = i;
            stats.leadAlign = N ? acc[(size_t)lead].align : 0;
        }

        EvoLimits lim;
        lim.plateauGens = CFG.plateauGens;
        lim.trackGens = CFG.trackGens;
        lim.trackFrac = CFG.trackFrac;
        lim.trackCount = CFG.trackCount;
        lim.actCull = CFG.actCull;
        const HistRec rec = evo.evolve(std::move(results), CFG.mutRate, CFG.mutSigma, CFG.grace, lim, stats);
        runLog.push_back(rec);

        if (!evo.demeEvent.empty()) { std::cout << "  " << evo.demeEvent << "\n"; evo.demeEvent.clear(); }
        if (!evo.probeEvent.empty()) { std::cout << "  " << evo.probeEvent << "\n"; evo.probeEvent.clear(); }
        if (!evo.migrantEvent.empty()) { std::cout << "  " << evo.migrantEvent << "\n"; evo.migrantEvent.clear(); }
        // After evolve, so `gen` is the generation that just finished and the ranks
        // being exported are the ones it produced.
        if (!CFG.exportDir.empty() && CFG.exportEvery > 0 && evo.gen % CFG.exportEvery == 0) exportEmigrants();

        if (!CFG.quiet) {
            const double el = nowSec() - t0;
            std::string line =
                "gen " + pad(std::to_string(evo.gen - 1), 4) + " " +
                "st" + std::to_string(st.stage) +
                (st.stage >= 4 ? "/" + fmt("%.2f", st.terrainDifficulty) : "  ") + " " +
                "best " + pad(fmt("%.0f", rec.best), 7) + " avg " + pad(fmt("%.0f", rec.avg), 7) +
                " | stood " + pad(fmt("%.0f", stats.stoodFrac * 100), 3) + "%" +
                " bal " + pad(fmt("%.0f", stats.balancedFrac * 100), 3) + "%" +
                " upright " + fmt("%.1f", stats.avgUpright) + "/" + fmt("%.1f", stats.maxUpright) + "s" +
                " | steps " + fmt("%.1f", stats.avgSteps) + "/" + fmt("%.0f", stats.bestSteps) +
                " stride " + fmt("%.2f", stats.avgStride) + "/" + fmt("%.2f", stats.bestStride) + " m" +
                " walked " + fmt("%.2f", stats.avgProg) + "/" + fmt("%.2f", stats.bestProg) + " m" +
                " align " + fmt("%.2f", stats.avgAlign) + "/" + fmt("%.2f", stats.leadAlign) + " ";
            // floor starts and how many of them ended with the walker back on its
            // feet — the get-up rung, which is invisible otherwise
            if (stats.groundFrac > 0)
                line += "| floor " + fmt("%.0f", stats.groundFrac * 100) + "% rose " +
                        fmt("%.0f", stats.roseFrac * 100) + "% com " + fmt("%.2f", stats.bestCom) + "m ";
            // bestArr is a MEAN over the generation's episodes, so it is fractional:
            // 0.33 means the best walker reached a waypoint in one of three episodes.
            // Printed with %.0f it rounded to "0" and the log claimed nobody had ever
            // arrived, for thirty generations after the first walker actually did.
            line += "wp " + fmt("%.2f", stats.avgArr) + "/" + fmt("%.2f", stats.bestArr) +
                    " | " + fmt("%.1f", el / (g + 1)) + "s/gen";
            if (evo.hasTuned) line += fmt(" mut %.3f/%.3f", evo.tunedRate, evo.tunedSigma);
            if (evo.roundOpen) {
                line += fmt(" TRACKS %d/%d [", evo.roundGens, CFG.trackGens);
                for (size_t i = 0; i < evo.tracks.size(); i++) {
                    if (i) line += " ";
                    const auto& h = evo.tracks[i].hist;
                    std::string nm = evo.tracks[i].recipe.substr(0, evo.tracks[i].recipe.find(' '));
                    line += nm + " " + (h.empty() ? "-" : fmt("%.0f", h.back().first));
                }
                line += "]";
            }
            if (evo.demes.size() > 1) {
                line += " ACTS [";
                for (size_t i = 0; i < evo.demes.size(); i++) {
                    if (i) line += " ";
                    const auto& h = evo.demes[i].hist;
                    line += evo.demes[i].act + " " + (h.empty() ? "-" : fmt("%.0f", h.back().first));
                }
                line += "]";
            }
            if (rec.leakyShare >= 0)
                line += fmt(" leaky %.0f%%/%.0f%%", rec.leakyShare * 100, rec.bestLeaky * 100);
            if (!evo.graceEvent.empty()) line += "  " + evo.graceEvent;
            std::cout << line << "\n" << std::flush;
        }

        // The run log used to be written once, at the end. A long run that died at
        // generation 28 therefore left no curves at all. Flush it alongside every
        // champion save instead.
        if (CFG.save && (g + 1) % CFG.save == 0) { saveChampion(""); saveRunLog(); }

        /* Checked AFTER the generation completes, never in the middle of one: a
         * half-scored generation is not a generation, and stopping inside one would
         * leave the champion file describing a population that never finished being
         * measured. */
        if (CFG.deadline > 0 && nowSec() >= (double)CFG.deadline) {
            std::cout << "\ndeadline reached at generation " << (evo.gen - 1) << " — stopping cleanly\n";
            break;
        }
    }
    const std::string f = saveChampion("");
    saveRunLog();
    std::cout << "\ndone in " << fmt("%.1f", (nowSec() - t0) / 60) << " min — champion "
              << fmt("%.0f", evo.championFit) << " saved to " << f << "\n";
    return 0;
}
