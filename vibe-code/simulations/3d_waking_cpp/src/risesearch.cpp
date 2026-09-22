/* risesearch.cpp — search an open-loop rise that ENDS STANDING.
 *
 *   ./walk3d_risesearch --pose prone --knots 8 --T 4.5 --gens 200 --pop 256 \
 *                       --workers 64 --out dag/ref_prone.json
 *
 * probe_rise_search.js found rises for kneel / quadruped / prone scored on the
 * settled COM over the last 0.5 s of a 3 s window. Measured in the dagger
 * harness: they reach 0.84 m and then collapse, because the posture they end in
 * is bent forward and neither holding it nor handing over to the walking
 * champion keeps it up. So this search asks for what the handover actually
 * needs — the body upright, hips high, and still there a second later — and is
 * seeded from the old gene so it starts where that search finished.
 *
 * Same search space as before: NETWORK OUTPUT SPACE, one gene per (joint, knot)
 * in [0,1], mapped exactly as Walker::control does, so anything found here is
 * something a brain can emit. Linear interpolation between knots. Each
 * candidate is scored on several jitter seeds (noise on: 0.025 rad pose jitter
 * and sensor noise, no wind at stage 1), averaged — an open-loop rise that only
 * works from one exact pose is not a teacher.
 */
#include <atomic>
#include <thread>
#include <cstdio>
#include <cstring>
#include <random>
#include <fstream>
#include <algorithm>
#include <sstream>
#include "episode.hpp"
#include "posespec.hpp"
#include "refstate.hpp"

static int g_argc; static char** g_argv;
static const char* rawArg(const char* name) {
    const std::string key = std::string("--") + name;
    for (int i = 1; i < g_argc; i++)
        if (key == g_argv[i]) { if (i + 1 >= g_argc) return ""; const char* v = g_argv[i + 1]; return (v[0] == '-' && v[1] == '-') ? "" : v; }
    return nullptr;
}
static double argNum(const char* name, double d) { const char* v = rawArg(name); if (!v) return d; if (!*v) return 1; return std::strtod(v, nullptr); }
static std::string argStr(const char* name, const std::string& d) { const char* v = rawArg(name); return (v && *v) ? std::string(v) : d; }

static double g_residual = 0;   // >0: gene is an OFFSET on the finisher's outputs, scaled by this
/* --chain: a second, FIXED gene played open-loop right after the searched one
 * (time-indexed from T), before the finisher. Lets a prone gene be searched for
 * "get into the state the quadruped gene rises from". */
struct ChainGene { std::vector<double> gene; int K; double T; };
static std::vector<ChainGene> g_chains; static double g_chainT = 0;   // g_chainT = total chained time
struct GeneHook : ActionHook {
    const double* gene; int K; double T;
    void onAction(Walker& x, World& w) override {
        const int nj = x.nj;
        if (!g_chains.empty() && w.time > T && w.time <= T + g_chainT) {
            double t0 = T;
            for (const auto& c : g_chains) {
                if (w.time <= t0 + c.T) {
                    const double uu = clampd((w.time - t0) / c.T, 0, 1) * (c.K - 1);
                    const int i0 = std::min(c.K - 2, (int)std::floor(uu));
                    const double f = uu - i0;
                    for (int j = 0; j < nj; j++) { const double a = c.gene[(size_t)j * c.K + i0], b = c.gene[(size_t)j * c.K + i0 + 1]; x.out[j] = (float)(a + (b - a) * f); }
                    for (int i = nj; i < (int)x.out.size(); i++) x.out[i] = 0.5f;
                    return;
                }
                t0 += c.T;
            }
        }
        if (g_residual > 0) {
            /* Residual mode: the closed-loop finisher drives throughout and the
             * gene adds an offset that fades out over the last knot interval, so
             * the champion's balance reflexes are never switched off. */
            if (w.time > T) return;
            const double uu = clampd(w.time / T, 0, 1) * (K - 1);
            const int i0 = std::min(K - 2, (int)std::floor(uu));
            const double f = uu - i0;
            const double fade = std::min(1.0, (T - w.time) / (T / (K - 1)));
            for (int j = 0; j < nj; j++) {
                const double a = gene[(size_t)j * K + i0], b = gene[(size_t)j * K + i0 + 1];
                const double off = ((a + (b - a) * f) * 2 - 1) * g_residual * fade;
                x.out[j] = (float)clampd((double)x.out[j] + off, 0, 1);
            }
            return;
        }
        /* Past T the gene is silent and whatever brain the world was built with
         * drives — the FINISHER. The search then optimises for landing in a state
         * the closed-loop champion can stand up from, rather than for an
         * open-loop ending, which was measured to be chaotic. */
        if (w.time > T) return;
        const double uu = clampd(w.time / T, 0, 1) * (K - 1);
        const int i0 = std::min(K - 2, (int)std::floor(uu));
        const double f = uu - i0;
        for (int j = 0; j < nj; j++) { const double a = gene[(size_t)j * K + i0], b = gene[(size_t)j * K + i0 + 1]; x.out[j] = (float)(a + (b - a) * f); }
        for (int i = nj; i < (int)x.out.size(); i++) x.out[i] = 0.5f;
    }
};

struct Eval { double score, settled, upright, peak, dTarget; bool standing; };

/* --target <pose>: a DENSE term. "Standing after the chain and the finisher" is
 * a needle — from quadruped or prone every random gene scores the same zero
 * and the search has no gradient. The searched gene is instead asked to END
 * NEAR THE START POSE OF THE NEXT LINK (kneel for a quadruped gene, quadruped
 * for a prone gene): the distance from the body's (joints, gravity) descriptor
 * to that pose's, minimised over the gene's last 0.5 s, enters the score with
 * weight --target-w. Standing at the end still pays as before, so a gene that
 * reaches the pose AND lets the chain finish wins over one that only reaches it. */
static TargetState g_target; static double g_targetW = 0;

/* Score one gene from one jitter seed. The last `settle` seconds of the
 * episode decide it: mean COM height, mean torso uprightness, and whether the
 * walker's OWN recovery test would pass at the end. */
static double g_finish = 0;   // seconds the finisher drives after the gene
static Eval evalGene(World& w, const Model& M, Net& dummy, const std::string& pose, const double* gene, int K, double T,
                     double settle, uint32_t seed, bool noise) {
    WorldOpts o;
    /* The mission seed drives the POSE JITTER; the noise seed only drives sensor
     * and action noise, which an open-loop gene never sees. Keeping missionSeed
     * fixed made every "seed" the same start pose and the search overfit to it
     * (16/16 there, 2/17 on ordinary seeds). */
    o.stage = 1; o.terrainId = "flat"; o.terrainDifficulty = 0; o.missionSeed = 31 + 977 * (int)(seed % 100003u); o.noiseSeed = seed;
    o.noise = noise; o.groundFrac = 0; o.poseFrac = 0; o.seatFrac = 0; o.scaffoldFrac = 0;
    poseOpts(o, pose);
    w.init(M, &dummy, o);
    poseApply(w, M, pose);
    GeneHook h; h.gene = gene; h.K = K; h.T = T;
    w.walker.hook = &h;
    const int steps = (int)std::round((T + g_chainT + g_finish + settle) / CTRL_DT);
    const int from = steps - (int)std::round(settle / CTRL_DT);
    const int geneEnd = (int)std::round(T / CTRL_DT), tFrom = geneEnd - (int)std::round(0.5 / CTRL_DT);
    double acc = 0, up = 0, peak = 0, dT = 0; int n = 0;
    std::vector<float> qn; if (g_target.valid()) { qn.assign((size_t)M.nj, 0); dT = 1e9; }
    for (int k = 0; k < steps; k++) {
        for (int s = 0; s < CONTROL_EVERY; s++) w.step();
        const double c = w.walker.comHeight(&w.terrain);
        peak = std::max(peak, c);
        if (k >= from) { acc += c; up += w.walker.uprightness(); n++; }
        if (g_target.valid() && k >= tFrom && k <= geneEnd) {
            float g[3]; jointNorm(w.walker, M, qn.data()); gravNorm(w.walker, g);
            dT = std::min(dT, std::sqrt(stateDist2(qn.data(), g, g_target.q.data(), g_target.g, M.nj)));
        }
    }
    w.walker.hook = nullptr;
    const Walker& x = w.walker;
    const bool standing = x.uprightness() > 0.75 && x.groundClearance(w.terrain) > 0.78 * M.standHipY;
    Eval e; e.settled = acc / n; e.upright = up / n; e.peak = peak; e.standing = standing; e.dTarget = dT;
    e.score = e.settled + 0.3 * e.upright + (standing ? 0.2 : 0.0) - g_targetW * dT;
    return e;
}

int main(int argc, char** argv) {
    g_argc = argc; g_argv = argv;
    installOutRowScale();
    const Model& M = HUMANOID();
    const Layout& L = LAY();
    const std::string pose = argStr("pose", "prone");
    const int K = (int)argNum("knots", 9);
    const double T = argNum("T", 4.8), settle = argNum("settle", 1.0);
    const int gens = (int)argNum("gens", 200), pop = (int)argNum("pop", 256), elite = std::min(pop, (int)argNum("elite", 32));
    const int workers = (int)argNum("workers", 64), nseeds = (int)argNum("seeds", 3);
    const double sigma = argNum("sigma", 0.06), prate = argNum("rate", 0.15);
    const uint32_t seed = (uint32_t)argNum("seed", 7);
    const std::string outFile = argStr("out", "");
    const int nj = M.nj, NG = nj * K;

    Net dummy(L.NET_SIZES, nullptr, Act::RELU);
    const std::string finisherFile = argStr("finisher", "");
    g_finish = argNum("finish", 3.0);
    g_residual = argNum("residual", 0);
    const std::string chainFiles = argStr("chain", "");
    if (!chainFiles.empty()) {
        std::stringstream ss(chainFiles); std::string tok;
        while (std::getline(ss, tok, ',')) {
            js::ValuePtr v = js::readJSON(tok);
            ChainGene c; c.K = (int)v->numOr("knots", 6); c.T = v->numOr("T", 3);
            for (auto& e : v->get("gene")->arr) c.gene.push_back(e->num);
            g_chains.push_back(c); g_chainT += c.T;
            std::printf("chain: %s plays for %.1f s\n", tok.c_str(), c.T);
        }
    }
    const std::string targetPose = argStr("target", "");
    if (!targetPose.empty()) {
        g_target = targetForPose(M, targetPose); g_targetW = argNum("target-w", 0.5);
        std::printf("target: end the gene near the %s start pose (weight %.2f on the descriptor distance)\n", targetPose.c_str(), g_targetW);
    }
    if (!finisherFile.empty()) {
        js::ValuePtr saved = js::readJSON(finisherFile);
        js::ValuePtr raw = saved->get("net") ? saved->get("net") : saved;
        dummy = Net::fromJSON(raw);
        std::printf("finisher: %s drives for %.1f s after the gene\n", finisherFile.c_str(), g_finish);
    } else g_finish = 0;

    // seed from the baked scaffold for this pose, resampled onto the new knot times
    // — or, with --init, from a gene file written by an earlier search
    std::vector<double> init((size_t)NG, 0.5);
    std::vector<RiseRef> seeds;
    const std::string initFile = argStr("init", "");
    if (initFile == "none") { std::printf("seeding from the neutral posture (all knots 0.5)\n"); }
    else if (!initFile.empty()) {
        js::ValuePtr v = js::readJSON(initFile);
        RiseRef r; r.name = pose.c_str(); r.knots = (int)v->numOr("knots", 6); r.T = v->numOr("T", 3);
        for (auto& e : v->get("gene")->arr) r.gene.push_back(e->num);
        seeds.push_back(r);
        std::printf("seeding from %s (%d knots over %.1f s)\n", initFile.c_str(), r.knots, r.T);
    } else for (const auto& r : RISE_SCAFFOLD) seeds.push_back(r);
    for (const auto& r : seeds) if (pose == r.name) {
        for (int j = 0; j < nj; j++) for (int k = 0; k < K; k++) {
            const double t = T * k / (K - 1);
            /* Past the old end: HOLD its last knot. Commanding the standing
             * posture from there is the deceptive prefix the whole project
             * documents — it drives the COM down — and the hold at least keeps
             * 0.84 m for a few hundred ms, which is where the search starts. */
            if (t > r.T + 1e-9) { init[(size_t)j * K + k] = r.gene[(size_t)j * r.knots + r.knots - 1]; continue; }
            const double uu = t / r.T * (r.knots - 1);
            const int i0 = std::min(r.knots - 2, (int)std::floor(uu)); const double f = uu - i0;
            init[(size_t)j * K + k] = r.gene[(size_t)j * r.knots + i0] * (1 - f) + r.gene[(size_t)j * r.knots + i0 + 1] * f;
        }
        std::printf("seeded from the baked %s scaffold (%d knots over %.1f s)\n", r.name, r.knots, r.T);
    }

    std::vector<std::vector<double>> P((size_t)pop, init);
    std::mt19937 rng(seed);
    std::normal_distribution<double> N01(0, 1);
    std::uniform_real_distribution<double> U(0, 1);
    for (int i = 1; i < pop; i++) for (int g = 0; g < NG; g++) if (U(rng) < prate) P[(size_t)i][(size_t)g] = clampd(P[(size_t)i][(size_t)g] + N01(rng) * sigma, 0, 1);

    std::vector<double> fit((size_t)pop);
    std::vector<Eval> evs((size_t)pop);
    auto evaluateAll = [&]() {
        std::atomic<int> next{0};
        std::vector<std::thread> pool;
        for (int wi = 0; wi < workers; wi++) pool.emplace_back([&]{
            World w;
            for (;;) {
                const int i = next.fetch_add(1); if (i >= pop) break;
                double s = 0; Eval last{};
                for (int sd = 0; sd < nseeds; sd++) { last = evalGene(w, M, dummy, pose, P[(size_t)i].data(), K, T, settle, 17u + 31u * sd, true); s += last.score; }
                fit[(size_t)i] = s / nseeds; evs[(size_t)i] = last;
            }
        });
        for (auto& t : pool) t.join();
    };

    // the do-nothing and the seed, for scale
    {
        World w; std::vector<double> still((size_t)NG, 0.5);
        Eval e0 = evalGene(w, M, dummy, pose, still.data(), K, T, settle, 17, false);
        Eval e1 = evalGene(w, M, dummy, pose, init.data(), K, T, settle, 17, false);
        std::printf("hold-standing-posture: settled %.3f upright %.2f standing %d dT %.2f | seed gene: settled %.3f upright %.2f peak %.3f standing %d dT %.2f\n",
                    e0.settled, e0.upright, (int)e0.standing, e0.dTarget, e1.settled, e1.upright, e1.peak, (int)e1.standing, e1.dTarget);
    }

    std::vector<int> order((size_t)pop);
    for (int g = 0; g < gens; g++) {
        evaluateAll();
        for (int i = 0; i < pop; i++) order[(size_t)i] = i;
        std::stable_sort(order.begin(), order.end(), [&](int a, int b){ return fit[(size_t)a] > fit[(size_t)b]; });
        const int b = order[0];
        if (g % 10 == 0 || g == gens - 1)
            std::printf("gen %3d  best %.3f (settled %.3f upright %.2f peak %.3f standing %d dT %.2f)  elite mean %.3f\n", g, fit[(size_t)b],
                        evs[(size_t)b].settled, evs[(size_t)b].upright, evs[(size_t)b].peak, (int)evs[(size_t)b].standing, evs[(size_t)b].dTarget,
                        [&]{ double s = 0; for (int i = 0; i < elite; i++) s += fit[(size_t)order[(size_t)i]]; return s / elite; }());
        if (g == gens - 1) break;
        std::vector<std::vector<double>> Q; Q.reserve((size_t)pop);
        for (int i = 0; i < elite; i++) Q.push_back(P[(size_t)order[(size_t)i]]);
        while ((int)Q.size() < pop) {
            const int pa = order[(size_t)(U(rng) * elite)], pb = order[(size_t)(U(rng) * elite)];
            std::vector<double> c = P[(size_t)pa];
            if (U(rng) < 0.3) for (int j = 0; j < nj; j++) if (U(rng) < 0.5) for (int k = 0; k < K; k++) c[(size_t)j * K + k] = P[(size_t)pb][(size_t)j * K + k];
            const double sg = sigma * (U(rng) < 0.5 ? 1.0 : 0.3);
            for (int gg = 0; gg < NG; gg++) if (U(rng) < prate) c[(size_t)gg] = clampd(c[(size_t)gg] + N01(rng) * sg, 0, 1);
            Q.push_back(std::move(c));
        }
        P.swap(Q);
    }
    const int b = order[0];
    // final: re-measure the winner without noise and with 6 fresh seeds
    World w;
    Eval clean = evalGene(w, M, dummy, pose, P[(size_t)b].data(), K, T, settle, 17, false);
    int stood = 0; double s6 = 0, dT6 = 0;
    for (int sd = 0; sd < 6; sd++) { Eval e = evalGene(w, M, dummy, pose, P[(size_t)b].data(), K, T, settle, 1000u + 7u * sd, true); stood += e.standing; s6 += e.settled; dT6 += e.dTarget; }
    std::printf("winner: clean settled %.3f upright %.2f peak %.3f standing %d | 6 fresh jitter seeds: standing %d/6, mean settled %.3f, mean dT %.2f\n",
                clean.settled, clean.upright, clean.peak, (int)clean.standing, stood, s6 / 6, dT6 / 6);
    if (!outFile.empty()) {
        std::ofstream f(outFile);
        f << "{\"pose\":\"" << pose << "\",\"knots\":" << K << ",\"T\":" << T << ",\"nj\":" << nj
          << ",\"score\":" << clean.settled << ",\"upright\":" << clean.upright << ",\"standing6\":" << stood
          << ",\"target\":\"" << targetPose << "\",\"dTarget6\":" << dT6 / 6 << ",\"gene\":[";
        for (int gg = 0; gg < NG; gg++) { if (gg) f << ","; f << P[(size_t)b][(size_t)gg]; }
        f << "]}\n";
        std::printf("wrote %s\n", outFile.c_str());
    }
    return 0;
}
