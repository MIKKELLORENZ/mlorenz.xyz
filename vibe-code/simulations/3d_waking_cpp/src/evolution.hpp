/* evolution.hpp — the genetic algorithm. No gradients, ever. Port of evolution.js.
 *
 *   1. a few elites survive byte-for-byte — rank 0 is always an unmutated copy of
 *      the best walker of the generation, whatever else happens
 *   2. a handful of mutated elite copies try to improve on them
 *   3. elites breed with each other (row-wise crossover + light mutation)
 *   4. the rest come from rank-weighted parents across the better half, with
 *      mutation strength growing down the ranks — a gradient of risk
 *   5. a couple of fresh random brains keep the pool honest early, tapering to
 *      zero as the best-ever fitness climbs past immZeroFit
 *
 * STEP SIZE. The single most expensive lesson in the original file, and it cost a
 * 350-generation run that learned nothing at all. Measured — champion versus 24 of
 * its own offspring, all on the SAME three missions so the mission cancels out:
 *
 *     rate  sigma |  within 5% of parent | better than parent
 *     0.10  0.150 |                   0% |                 0%
 *     0.04  0.050 |                  33% |                13%
 *     0.02  0.015 |                  75% |                63%
 *
 * At 0.10/0.15 not one child in twenty-four landed anywhere near its parent: the
 * four unmutated elites survived, every one of their offspring was destroyed, and
 * the population mean FELL over three hundred generations. Selection was not slow,
 * it was disconnected. The defaults are 0.035 / 0.04, roughly a 20% success rate —
 * the classic 1/5th rule — and the smaller step also finds BETTER peaks, not just
 * safer ones.
 *
 * IDENTITY IS AN INDEX HERE, not a pointer. The JS tracks the champion's live seat
 * and the grace holder by object identity (`r.brain === this._injected`), which
 * survives the sort because JS sorts references. This carries the population by
 * value, so every Result knows the slot it came from and identity is that slot.
 */
#pragma once
#include <vector>
#include <string>
#include <cmath>
#include <algorithm>
#include <cstdio>
#include <cctype>
#include "nn.hpp"
#include "rng.hpp"
#include "json.hpp"

struct MutDefault { static constexpr double rate = 0.035, sigma = 0.04; };

/* ------------------------------------------------- parallel search tracks
 *
 * When the run stops improving, the mutation operator is usually why: too timid
 * and every child lands back in the basin it came from, too wild and none of them
 * survive long enough to be measured. Which one is wrong is not knowable in
 * advance, so the run finds out by experiment rather than by guess.
 *
 * MULTIPLIERS on whatever the run is currently using, not absolute values, so
 * successive rounds walk somewhere new instead of re-testing the same points
 * forever. Ordered by how different each recipe is from business as usual, so a
 * plateau that needs only a nudge is not answered with a shakeup. */
struct Recipe { const char* name; double rm, sm; };
inline const std::vector<Recipe>& TRACK_RECIPES() {
    static const std::vector<Recipe> r = {
        { "more sites", 2.0, 1.0 }, { "bigger steps", 1.0, 2.0 },
        { "gentler", 0.5, 0.6 },    { "many tiny tweaks", 2.5, 0.5 },
        { "few big jumps", 0.6, 2.5 }, { "aggressive", 3.5, 1.8 },
        { "shakeup", 5.0, 3.0 },    { "mild all-round", 1.4, 1.4 }
    };
    return r;
}
/* Absolute limits a track may not leave. Measured the hard way: raising mutation
 * to 0.035/0.050 to escape a local minimum collapsed standing from 100% to 22% in
 * a single run. The ceiling stops a recipe repeating that, the floor stops one
 * tuning itself into stasis. */
constexpr double TRACK_RATE_LO = 0.004, TRACK_RATE_HI = 0.12;
constexpr double TRACK_SIGMA_LO = 0.008, TRACK_SIGMA_HI = 0.20;
constexpr int TRACK_JUDGE_GENS = 12;
constexpr int DEME_JUDGE_GENS = 40;

struct Result { int idx; Net* brain; double fitness; double arrivals; };

struct DemeRec { std::string act; int n; double best, avg; };

struct HistRec {
    double best = 0, avg = 0;
    int stage = 1;
    double terrainDifficulty = 1;
    double stoodFrac = 0, balancedFrac = 0, avgArr = 0, bestArr = 0;
    double avgUpright = 0, maxUpright = 0, avgProg = 0, bestProg = 0;
    double avgSteps = 0, bestSteps = 0, avgStride = 0, bestStride = 0;
    double groundFrac = 0, roseFrac = 0, bestCom = 0, avgAlign = 0, leadAlign = 0;
    std::vector<DemeRec> demes;
    double leakyShare = -1, bestLeaky = -1;

    js::ValuePtr toJSON() const {
        auto o = js::Value::makeObj();
        o->set("best", best); o->set("avg", avg); o->set("stage", (double)stage);
        o->set("terrainDifficulty", terrainDifficulty);
        o->set("stoodFrac", stoodFrac); o->set("balancedFrac", balancedFrac);
        o->set("avgArr", avgArr); o->set("bestArr", bestArr);
        o->set("avgUpright", avgUpright); o->set("maxUpright", maxUpright);
        o->set("avgProg", avgProg); o->set("bestProg", bestProg);
        o->set("avgSteps", avgSteps); o->set("bestSteps", bestSteps);
        o->set("avgStride", avgStride); o->set("bestStride", bestStride);
        o->set("groundFrac", groundFrac); o->set("roseFrac", roseFrac);
        o->set("bestCom", bestCom); o->set("avgAlign", avgAlign); o->set("leadAlign", leadAlign);
        if (!demes.empty()) {
            auto d = js::Value::makeArr();
            for (auto& x : demes) {
                auto e = js::Value::makeObj();
                e->set("act", x.act); e->set("n", (double)x.n);
                e->set("best", x.best); e->set("avg", x.avg);
                d->push(e);
            }
            o->set("demes", d);
        }
        if (leakyShare >= 0) { o->set("leakyShare", leakyShare); o->set("bestLeaky", bestLeaky); }
        return o;
    }
    static HistRec fromJSON(const js::ValuePtr& v) {
        HistRec h;
        h.best = v->numOr("best", 0); h.avg = v->numOr("avg", 0);
        h.stage = (int)v->numOr("stage", 1);
        h.terrainDifficulty = v->numOr("terrainDifficulty", 1);
        h.stoodFrac = v->numOr("stoodFrac", 0); h.balancedFrac = v->numOr("balancedFrac", 0);
        h.avgArr = v->numOr("avgArr", 0); h.bestArr = v->numOr("bestArr", 0);
        h.avgUpright = v->numOr("avgUpright", 0); h.maxUpright = v->numOr("maxUpright", 0);
        h.avgProg = v->numOr("avgProg", 0); h.bestProg = v->numOr("bestProg", 0);
        h.avgSteps = v->numOr("avgSteps", 0); h.bestSteps = v->numOr("bestSteps", 0);
        h.avgStride = v->numOr("avgStride", 0); h.bestStride = v->numOr("bestStride", 0);
        h.groundFrac = v->numOr("groundFrac", 0); h.roseFrac = v->numOr("roseFrac", 0);
        h.bestCom = v->numOr("bestCom", 0);
        h.avgAlign = v->numOr("avgAlign", 0); h.leadAlign = v->numOr("leadAlign", 0);
        return h;
    }
};

/* ------------------------------------------------- per-surface normalisation
 *
 * Measured on the gen-676 champion at stage 4, full difficulty, 24 episodes:
 *     rolling  37% of the bank  3.33 wp  9.92 m  88.8% of all fitness
 *     mixed    29%              0.14 wp  0.59 m   6.2%
 *     stairs   33%              0.00 wp  0.44 m   5.0%
 * A third of every generation is spent on stairs and it decides a twentieth of
 * the score. Stairs are not being learned slowly; they are invisible to selection.
 *
 * WHAT IS EQUALISED IS SPREAD, NOT MEAN. A constant offset does not change a
 * ranking, so the surface that dominates selection is the one whose scores VARY
 * most, not the one that scores highest. Recentred and rescaled rather than
 * z-scored, so the result stays in fitness units: the immigrant and crossover
 * gates compare the champion against absolute thresholds, and a z-score would
 * silently disable both. */
inline double meanOf(const std::vector<double>& a) {
    if (a.empty()) return 0;
    double s = 0; for (double v : a) s += v; return s / a.size();
}
inline std::vector<double> normaliseBySurface(const std::vector<std::vector<double>>& perEp,
                                              const std::vector<std::string>& surfaces) {
    const size_t n = perEp.size();
    std::vector<double> plain(n, 0.0);
    for (size_t b = 0; b < n; b++) plain[b] = meanOf(perEp[b]);
    if (!n || surfaces.empty()) return plain;

    std::vector<std::string> keys;
    std::vector<std::vector<int>> groups;
    for (size_t e = 0; e < surfaces.size(); e++) {
        auto it = std::find(keys.begin(), keys.end(), surfaces[e]);
        if (it == keys.end()) { keys.push_back(surfaces[e]); groups.emplace_back(); it = keys.end() - 1; }
        groups[(size_t)(it - keys.begin())].push_back((int)e);
    }
    // One surface in the bank is the old behaviour exactly.
    if (keys.size() < 2) return plain;

    // Each brain's mean on each surface.
    std::vector<std::vector<double>> per(keys.size(), std::vector<double>(n, 0.0));
    for (size_t k = 0; k < keys.size(); k++)
        for (size_t b = 0; b < n; b++) {
            double s = 0; int c = 0;
            for (int e : groups[k]) if ((size_t)e < perEp[b].size()) { s += perEp[b][e]; c++; }
            per[k][b] = c ? s / c : 0;
        }
    std::vector<double> mu(keys.size()), sd(keys.size());
    for (size_t k = 0; k < keys.size(); k++) {
        mu[k] = meanOf(per[k]);
        double s = 0;
        for (double v : per[k]) s += (v - mu[k]) * (v - mu[k]);
        sd[k] = std::sqrt(s / std::max((size_t)1, per[k].size()));
    }
    const double muAll = meanOf(mu), sdRef = meanOf(sd);
    /* A surface on which the whole fleet scores identically carries no
     * information, and dividing by its ~zero spread would amplify pure
     * floating-point noise into the dominant term — the exact failure this
     * function exists to prevent, inverted. */
    const double floorSd = std::max(1e-6, sdRef * 0.02);
    std::vector<double> out(n, 0.0);
    for (size_t k = 0; k < keys.size(); k++) {
        const double kk = sd[k] > floorSd ? sdRef / sd[k] : 1.0;
        for (size_t b = 0; b < n; b++) out[b] += muAll + (per[k][b] - mu[k]) * kk;
    }
    for (size_t b = 0; b < n; b++) out[b] /= (double)keys.size();
    return out;
}

struct EvoLimits {
    double immZeroFit = 6000, childZeroFit = 15000;
    bool evalMode = false, injectChampion = true;
    int plateauGens = 100, trackGens = 50, trackCount = 3, actCull = 250;
    double trackFrac = 0.36;
};

struct Deme { std::string act; int n = 0; std::vector<std::pair<double,double>> hist; };  // (best, avg)
struct Track { int n; double rate, sigma; std::string recipe; std::vector<std::pair<double,double>> hist; };  // (best, champ)
struct Migrant { Net net; int born, life; };

class Evolution {
public:
    int popSize;
    int gen = 1;
    Rng rng;
    bool interbreed = false;
    std::vector<Deme> demes;
    std::string demeEvent, probeEvent, migrantEvent, graceEvent;
    bool culled = false;

    std::vector<Net> brains;
    std::vector<HistRec> history;

    Net champion;
    bool hasChampion = false;
    double championFit = -1e18;
    int injectedIdx = -1;
    int lastLeaderGen = 0;

    Net graceNet;
    bool hasGrace = false;
    int graceLeft = 0, graceIdx = -1;

    std::vector<Migrant> migrants;
    int migrantCross = 0;

    bool hasTuned = false;
    double tunedRate = 0, tunedSigma = 0;
    int lastStage = -1, probeHoldUntil = 0, recipeAt = 0;
    bool roundOpen = false;
    int roundGens = 0, roundStartGen = 0, roundSettle = 5;
    double roundBaseRate = 0, roundBaseSigma = 0;
    int mainCount = 0;
    std::vector<Track> tracks;

    Evolution(int pop, uint32_t seed, const std::vector<std::string>& acts, bool wantInterbreed)
        : popSize(pop), rng(seed ? seed : 42u) {
        std::vector<std::string> list;
        for (auto& a : acts) if (knownAct(a)) list.push_back(a);
        if (list.empty()) list.push_back("tanh");
        /* INTERBREEDING MODE. One pool, seeded across the listed activations, with
         * no isolation: ReLU and leaky ReLU parents cross freely and their children
         * are mixed neuron by neuron. A different experiment from the demes and
         * deliberately so — the demes ask "which of these is better" and answer it
         * with a clean paired margin, while a single pool asks "what proportion
         * does selection settle on", which is a richer question but WEAKER
         * evidence: a GA sweeps whole genomes, so a slope's share can rise by
         * hitchhiking on an unrelated good mutation. Treat a drift from 50% as a
         * hint, not a result. */
        interbreed = wantInterbreed && list.size() > 1 &&
                     std::find(list.begin(), list.end(), std::string("tanh")) == list.end();
        /* The slope-flip mutation belongs to interbreeding and only to it — in
         * deme mode it would turn each "pure ReLU" deme into a hybrid pool and the
         * A/B would stop measuring what it claims to. */
        setSlopeFlip(interbreed ? 0.002 : 0.0);

        if (interbreed) demes.push_back({ "mixed", pop, {} });
        else {
            for (auto& a : list) demes.push_back({ a, 0, {} });
            for (int i = 0; i < pop; i++) demes[(size_t)(i % (int)demes.size())].n++;
        }

        const auto& sz = netSizes();
        brains.reserve((size_t)pop);
        if (interbreed) {
            // Alternate so the founding pool is an even mix and neither rectifier
            // starts with a numerical advantage.
            for (int i = 0; i < pop; i++)
                brains.emplace_back(sz, &rng, actFromName(list[(size_t)(i % (int)list.size())]));
        } else {
            for (auto& d : demes)
                for (int i = 0; i < d.n; i++) brains.emplace_back(sz, &rng, actFromName(d.act));
        }
        mainCount = pop;
    }

    /* The network shape is fixed by the sensor layout, which is compiled in. Held
     * behind a function so evolution.hpp does not have to include walker.hpp. */
    static std::vector<int>& netSizesRef() { static std::vector<int> v; return v; }
    static const std::vector<int>& netSizes() { return netSizesRef(); }

    /* Take in a migrant as BREEDING STOCK ONLY. It never takes a seat.
     *
     * Dropping a migrant into the pool and leaving it there does almost nothing: a
     * brain from a young island ranks near the bottom, and pickRank draws parents
     * from the better half only, so it is culled having never once been a parent.
     * The foreign structure arrives and is deleted before anything can recombine
     * with it — which is the entire reason to run a second island. So a migrant
     * lives outside the population, never evaluated, never ranked, never eligible
     * to become champion, and its only effect is the elite crossings it fathers
     * while its window is open. */
    void admitMigrant(const Net& net, int life) {
        migrants.push_back({ net.clone(), gen, std::max(1, life) });
    }
    std::vector<Migrant>& liveMigrants() {
        migrants.erase(std::remove_if(migrants.begin(), migrants.end(),
            [&](const Migrant& m) { return gen - m.born >= m.life; }), migrants.end());
        return migrants;
    }

    HistRec evolve(std::vector<Result> allResults, double mutRate, double mutSigma,
                   int gracePeriod, const EvoLimits& lim, HistRec stats);

private:
    struct Made { std::vector<Net> brains; int elites, fresh; };
    Made breedDeme(const std::vector<Result>& sorted, int n, double mutRate, double mutSigma,
                   bool noChildren, double immFrac, const std::string& act);
    std::vector<Net> breedTrack(const std::vector<Result>& sorted, const Track& t);
    void openRound(int nTracks, double tfrac, int tgens, double mutRate, double mutSigma,
                   double recent, double older, int pl);
    void judgeRound(const std::vector<std::vector<Result>>& trackResults);
    const std::vector<Result>* cullDemes(const std::vector<std::vector<Result>>& demeResults);
};

inline HistRec Evolution::evolve(std::vector<Result> allResults, double mutRate, double mutSigma,
                                 int gracePeriod, const EvoLimits& lim, HistRec stats) {
    /* Split by POSITION before anything sorts, because position is the only record
     * of which line a brain belongs to. `allResults` arrives aligned with `brains`,
     * and the sort below destroys that alignment — reading the partition
     * afterwards would silently mix the tracks into the main line and the whole
     * experiment would measure nothing. */
    std::vector<std::vector<Result>> trackResults;
    {
        int off = mainCount;
        for (auto& t : tracks) {
            trackResults.emplace_back(allResults.begin() + off, allResults.begin() + off + t.n);
            off += t.n;
        }
    }
    std::vector<Result> results(allResults.begin(), allResults.begin() + mainCount);

    std::vector<std::vector<Result>> demeResults;
    {
        int off = 0;
        for (auto& d : demes) {
            demeResults.emplace_back(allResults.begin() + off, allResults.begin() + off + d.n);
            off += d.n;
        }
    }

    /* stable_sort, not sort. JS Array.prototype.sort is required to be stable, so
     * two brains on identical fitness keep their population order — and on a
     * converged pool where several elites are byte-identical clones, that ordering
     * is what decides which one is seated as rank 0. std::sort would scramble it
     * and quietly make the run unreproducible. */
    auto byFit = [](const Result& a, const Result& b) { return a.fitness > b.fitness; };
    std::stable_sort(results.begin(), results.end(), byFit);
    for (auto& tr : trackResults) std::stable_sort(tr.begin(), tr.end(), byFit);
    for (auto& dr : demeResults) std::stable_sort(dr.begin(), dr.end(), byFit);

    // ---- champion grace bookkeeping ----
    const int gp = gracePeriod;
    graceEvent.clear();
    int holderIdx = -1;
    if (gp <= 0) hasGrace = false;
    else {
        if (hasGrace) {
            for (size_t i = 0; i < results.size(); i++)
                if (results[i].idx == graceIdx) { holderIdx = (int)i; break; }
        }
        if (!hasGrace || holderIdx == -1) {
            graceNet = results[0].brain->clone();
            graceLeft = gp; hasGrace = true; holderIdx = 0;
            graceEvent = "grace: champion crowned";
        } else if (holderIdx == 0) {
            graceLeft = gp;
        } else {
            graceLeft--;
            if (graceLeft <= 0) {
                graceNet = results[0].brain->clone();
                graceLeft = gp; holderIdx = 0;
                graceEvent = "grace expired — title passes to the new best";
            } else {
                char buf[96];
                std::snprintf(buf, sizeof buf, "grace: beaten champion sheltered (%d gens left)", graceLeft);
                graceEvent = buf;
            }
        }
    }

    /* History records the MAIN line only. It is what plateau detection reads, and
     * a track breeding at five times the mutation rate produces wild fitness in
     * both directions — folded in, it would either mask a real plateau or invent
     * one, and either way the thing that decides whether to keep searching would
     * be measuring the search instead of the run. */
    const Result& best = results[0];
    double avg = 0;
    for (auto& r : results) avg += r.fitness;
    avg /= (double)results.size();
    HistRec rec = stats;
    rec.best = best.fitness;
    rec.avg = avg;

    /* Per-deme scores, recorded every generation whether or not a cull is ever
     * going to happen. They go into runlog.json, which is what the dashboard draws
     * — an activation A/B whose evidence only exists in a variable is not an
     * experiment. */
    for (size_t i = 0; i < demes.size(); i++) {
        const auto& dr = demeResults[i];
        double s = 0;
        for (auto& r : dr) s += r.fitness;
        demes[i].hist.emplace_back(dr.empty() ? -1e18 : dr[0].fitness, s / std::max<size_t>(1, dr.size()));
    }
    rec.demes.clear();
    for (auto& d : demes) rec.demes.push_back({ d.act, d.n, d.hist.back().first, d.hist.back().second });

    if (interbreed) {
        double sum = 0; int cnt = 0;
        for (auto& r : results) { const double s = r.brain->leakyShare(); if (s >= 0) { sum += s; cnt++; } }
        rec.leakyShare = cnt ? sum / cnt : -1;
        rec.bestLeaky = best.brain->leakyShare();
    }
    history.push_back(rec);

    /* ---- the champion, measured honestly ----
     * This used to be `best.fitness > championFit` against a running maximum, and
     * that is a trap on a noisy objective: the same fixed brain scores 1,031 to
     * 2,934 across missions (sd 471), so a record kept as a max over ~14,000 noisy
     * samples settles ~4 sd above the brain's true mean and can never be beaten
     * honestly. The crown then freezes on whichever brain won the lottery.
     *
     * The champion holds a live seat, so it was re-scored on this generation's
     * missions alongside everyone else. That makes a PAIRED comparison available,
     * and a paired comparison on identical missions is the only fair one.
     * championFit is a current measurement, not a high-water mark, and it is
     * allowed to fall when the missions are hard. */
    const Result* champSeat = nullptr;
    if (injectedIdx >= 0)
        for (auto& r : results) if (r.idx == injectedIdx) { champSeat = &r; break; }
    bool newLeader = false;
    if (!hasChampion || !champSeat) {
        championFit = best.fitness;
        champion = best.brain->clone();
        hasChampion = true;
        newLeader = true;
    } else if (best.fitness > champSeat->fitness) {
        championFit = best.fitness;
        champion = best.brain->clone();
        newLeader = true;
    } else {
        championFit = champSeat->fitness;
    }
    if (newLeader) lastLeaderGen = gen;

    /* ---- the activation cull, once ----
     * Deliberately BEFORE the plateau machinery: a cull replaces two thirds of the
     * population, which is exactly the kind of reshuffle the plateau detector is
     * not supposed to read as progress or as a stall. */
    demeEvent.clear();
    const std::vector<Result>* culledSrc = nullptr;
    if (!culled && demes.size() > 1 && lim.actCull > 0 && (int)history.size() >= lim.actCull) {
        culledSrc = cullDemes(demeResults);
        probeHoldUntil = std::max(probeHoldUntil, gen + lim.plateauGens);
    }

    /* ---- plateau detection and the track lifecycle ----
     *
     * NOT "the crown changed hands". That reads as the natural definition and it
     * is useless: the crown passes when the generation's best beats the champion's
     * own re-measured score, and best-of-512 beats one noisy sample of anything
     * nearly always. Measured on a fleet with ZERO real improvement, the champion
     * was replaced in 200 of 200 generations.
     *
     * So a plateau is what it actually means: the main line's best fitness has
     * stopped going up. Compared as the mean of the last few generations against
     * the mean of the few that ended `plateauGens` ago — smoothed, because a single
     * generation's best is an order statistic and swings hundreds of points on
     * mission luck alone. */
    probeEvent.clear();
    const int pl = lim.plateauGens;
    const int tgens = lim.trackGens;
    const int W = std::max(5, pl / 4);
    /* Fitness is not comparable across stages — a promotion changes what the
     * numbers mean — so a stage change restarts the window. Held for the FULL span
     * the comparison reaches back over, pl + W: at pl alone the window still had
     * one foot on the far side of the promotion, saw the collapse every promotion
     * causes, and called it a stall. */
    if (stats.stage != lastStage) {
        lastStage = stats.stage;
        probeHoldUntil = gen + pl + W;
    }

    if (roundOpen) {
        const double champScore = champSeat ? champSeat->fitness : best.fitness;
        for (size_t i = 0; i < tracks.size(); i++) {
            const auto& tr = trackResults[i];
            tracks[i].hist.emplace_back(tr.empty() ? -1e18 : tr[0].fitness, champScore);
        }
        roundGens++;
        if (roundGens >= tgens) judgeRound(trackResults);
    } else if (pl > 0 && gen >= probeHoldUntil) {
        if ((int)history.size() >= pl + W) {
            auto win = [&](int a, int b) {
                double s = 0; for (int i = a; i < b; i++) s += history[(size_t)i].best;
                return s / (b - a);
            };
            const int H = (int)history.size();
            const double recent = win(H - W, H);
            const double older = win(H - pl - W, H - pl);
            // 2% of headroom, so ordinary drift is not mistaken for progress.
            if (recent <= older * 1.02) {
                openRound(lim.trackCount, lim.trackFrac, tgens, mutRate, mutSigma, recent, older, pl);
                roundSettle = W;
            }
        }
    }

    /* Everything below breeds the MAIN line, at the adopted settings once a track
     * has won some; the values passed in are only the starting point. */
    if (hasTuned) { mutRate = tunedRate; mutSigma = tunedSigma; }
    int trackTotal = 0;
    for (auto& t : tracks) trackTotal += t.n;
    const int n = popSize - trackTotal;
    const double immFrac = lim.immZeroFit > 0
        ? std::max(0.0, std::min(1.0, 1 - championFit / lim.immZeroFit)) : 1.0;
    const bool noChildren = lim.childZeroFit > 0 && championFit >= lim.childZeroFit;

    /* Deal the main line's seats across the demes. When a plateau round is open
     * the main line shrinks, and it has to shrink EVENLY — handing the whole
     * reduction to one deme would change what the activation comparison is
     * measuring halfway through it. */
    std::vector<int> sizes(demes.size(), n / (int)demes.size());
    {
        int assigned = 0;
        for (int s : sizes) assigned += s;
        for (int i = 0; i < n - assigned; i++) sizes[(size_t)(i % (int)sizes.size())]++;
    }

    std::vector<Net> next;
    next.reserve((size_t)popSize);
    struct Block { int off, n, elites, fresh; };
    std::vector<Block> blocks;
    for (size_t i = 0; i < demes.size(); i++) {
        const int dn = sizes[i];
        demes[i].n = dn;
        const std::vector<Result>& src = culledSrc ? *culledSrc
            : (demeResults[i].empty() ? results : demeResults[i]);
        const int off = (int)next.size();
        Made made = breedDeme(src, dn, mutRate, mutSigma, noChildren, immFrac, demes[i].act);
        for (auto& b : made.brains) next.push_back(std::move(b));
        blocks.push_back({ off, dn, made.elites, made.fresh });
    }

    /* Seat the grace holder and the champion INSIDE THEIR OWN DEME. Both carry an
     * activation, and dropping a tanh champion into the lrelu block would put a
     * brain in a deme whose result no longer describes that deme — the comparison
     * would quietly start measuring a mixture. */
    auto blockOf = [&](Act a) -> Block& {
        const std::string nm = actName(a);
        for (size_t i = 0; i < demes.size(); i++) if (demes[i].act == nm) return blocks[i];
        return blocks[0];
    };

    // ---- seat the grace holder ----
    graceIdx = -1;
    if (gp > 0 && hasGrace) {
        Block& blk = blockOf(graceNet.act);
        // holderIdx indexes the sorted MAIN line; it only tells us the holder is
        // still the overall best, in which case its deme's own rank-0 elite is
        // already an untouched copy of it.
        if (holderIdx == 0 && next[(size_t)blk.off].act == graceNet.act) {
            graceNet = next[(size_t)blk.off].clone();
            graceIdx = blk.off;
        } else {
            const int slot = blk.off + std::max(blk.elites, blk.n - blk.fresh - 1);
            next[(size_t)slot] = graceNet.clone();
            graceIdx = slot;
        }
    }

    /* ---- re-inject the best-ever brain, byte for byte ----
     * Saving the champion to disk is not enough: without a live seat in the
     * breeding pool, selection noise drifts the population away from it and the
     * run silently regresses. This is the single highest-value line in the file. */
    injectedIdx = -1;
    if (hasChampion && (lim.evalMode || lim.injectChampion)) {
        Block& blk = blockOf(champion.act);
        const int slot = blk.off + (lim.evalMode ? std::max(0, blk.elites - 1)
                                                 : std::max(blk.elites, blk.n - blk.fresh - 2));
        next[(size_t)slot] = champion.clone();
        // Remembered by slot so next generation can find this exact seat's score
        // and compare the champion against the new best on equal missions. Without
        // this the crown is decided by luck.
        injectedIdx = slot;
    }

    /* ---- the tracks, each bred entirely within itself ----
     * No brain and no gene crosses between a track and the main line while a round
     * is running. That isolation is the experiment: the question is where a
     * lineage GETS TO under a different mutation setting after tens of
     * generations, and a track that keeps importing the main line's best would
     * answer a different, easier question and always come back saying roughly "the
     * same place you did". */
    mainCount = (int)next.size();
    for (size_t i = 0; i < tracks.size(); i++) {
        Track& t = tracks[i];
        /* BOUNDS-CHECKED, and this cost a run.
         *
         * `trackResults` was cut from `allResults` at the TOP of evolve, using the
         * tracks that existed THEN. openRound() runs in between and can create
         * tracks that have never been scored, so on the generation a plateau round
         * opens, `tracks` is longer than `trackResults` — three entries against
         * zero.
         *
         * The JS reads `trackResults[i]` there and gets `undefined`, which its very
         * next line tests for (`if (!src || !src.length)`). Translating that to
         * `const auto& src = trackResults[i]` binds a reference to nothing, and
         * `src.empty()` reads through it. It segfaulted at generation 125 — the
         * FIRST generation the plateau test could fire, since --fresh-history left
         * the history empty and the test needs plateauGens + W = 125 records. Two
         * hours of a run, and the failing branch had never once executed before.
         *
         * The general lesson for this port: every place the JS leans on
         * out-of-range being `undefined` is a null dereference here, and it will
         * sit dormant until exactly the rare path that motivated the check. */
        const std::vector<Result>* src = (i < trackResults.size() && !trackResults[i].empty())
                                       ? &trackResults[i] : nullptr;
        if (!src) {
            // First generation of a fresh round: sow the track from the leader,
            // keeping two unmutated so a bad draw cannot wipe out the starting
            // point before the track has run at all.
            const Net& seed = hasChampion ? champion : *results[0].brain;
            for (int k = 0; k < t.n; k++) {
                Net c = seed.clone();
                if (k >= 2) c.mutate(t.rate, t.sigma, rng);
                next.push_back(std::move(c));
            }
        } else {
            for (auto& b : breedTrack(*src, t)) next.push_back(std::move(b));
        }
    }

    brains = std::move(next);
    gen++;
    return rec;
}

/* Breed one activation deme from its own members only. This is the main line's
 * original recipe, so a run with a single deme produces exactly what it produced
 * before demes existed. */
inline Evolution::Made Evolution::breedDeme(const std::vector<Result>& sorted, int n,
                                            double mutRate, double mutSigma,
                                            bool noChildren, double immFrac, const std::string& act) {
    const int ELITES = std::min(4, n);
    const int MUT_ELITES = std::min(8, std::max(2, (int)(n * 0.16)));
    const int ELITE_CROSS = std::min(8, std::max(2, (int)(n * 0.16)));
    const int FRESH_MAX = n >= 32 ? 2 : 1;
    const int FRESH = (int)std::floor(FRESH_MAX * immFrac + 0.5);
    const int last = (int)sorted.size() - 1;

    std::vector<Net> out;
    out.reserve((size_t)n);
    for (int i = 0; i < ELITES && (int)out.size() < n; i++)
        out.push_back(sorted[(size_t)std::min(i, last)].brain->clone());
    for (int i = 0; i < MUT_ELITES && (int)out.size() < n; i++) {
        Net p = sorted[(size_t)std::min((int)(rng() * ELITES), last)].brain->clone();
        out.push_back(std::move(p.mutate(mutRate, mutSigma, rng)));
    }
    const int topPool = std::min(6, (int)sorted.size());
    for (int i = 0; i < ELITE_CROSS && (int)out.size() < n; i++) {
        if (noChildren) {
            Net p = sorted[(size_t)(int)(rng() * topPool)].brain->clone();
            out.push_back(std::move(p.mutate(mutRate * 0.5, mutSigma * 0.7, rng)));
        } else {
            int a = (int)(rng() * topPool), b = (int)(rng() * topPool);
            if (b == a) b = (b + 1) % topPool;
            Net c = Net::crossover(*sorted[(size_t)a].brain, *sorted[(size_t)b].brain, rng);
            out.push_back(std::move(c.mutate(mutRate * 0.5, mutSigma * 0.7, rng)));
        }
    }
    /* Elite x migrant. A guaranteed quota, because rank-weighted selection will
     * never produce one on its own — that is the whole point. Half the quota is
     * crossed the other way round, since Net::crossover is not symmetric: the
     * first parent supplies the rows that are not swapped, so which one leads
     * changes how much of each survives.
     *
     * NOT gated on noChildren, and that exemption is the whole feature. Past
     * childZeroFit the run switches crossover off entirely and hill-climbs — and
     * island A's champion sat at 15165 against a 15000 gate, so it did no
     * recombination at all and a migrant admitted into that pool could never breed
     * with anything no matter how it ranked. The gate exists to stop UNDIRECTED
     * crossover once the population has converged and two parents are near-copies
     * of each other; a migrant from another island is the opposite case by
     * construction, and mixing with it is the reason it was sent. */
    auto& live = liveMigrants();
    if (!live.empty() && migrantCross > 0) {
        const int quota = std::max(1, std::min(migrantCross, n / 8));
        int made = 0;
        for (int i = 0; i < quota && (int)out.size() < n; i++) {
            const Net& m = live[(size_t)(int)(rng() * live.size())].net;
            const Net& e = *sorted[(size_t)(int)(rng() * topPool)].brain;
            Net child = (i % 2 == 0) ? Net::crossover(e, m, rng) : Net::crossover(m, e, rng);
            out.push_back(std::move(child.mutate(mutRate * 0.5, mutSigma * 0.7, rng)));
            made++;
        }
        if (made) {
            char buf[160];
            std::snprintf(buf, sizeof buf,
                "%d elite x migrant hybrids bred (%d migrant%s in the breeding pool)",
                made, (int)live.size(), live.size() > 1 ? "s" : "");
            migrantEvent = buf;
        }
    }
    auto pickRank = [&]() {
        const double r = std::pow(rng(), 2.2);
        return std::min((int)sorted.size() - 1, (int)(r * sorted.size() * 0.55));
    };
    while ((int)out.size() < n - FRESH) {
        /* A risk gradient down the ranks, but a narrow one. It used to run 0.8x to
         * 2.4x on sigma, which put the whole bottom half of the population past the
         * point where any offspring survives, so half the compute produced nothing
         * but corpses. 0.7x to 1.6x keeps the tail adventurous and alive. */
        const double depth = (double)out.size() / n;
        const double mr = mutRate * (0.7 + depth * 0.7), ms = mutSigma * (0.7 + depth * 0.9);
        if (noChildren) {
            Net c = sorted[(size_t)pickRank()].brain->clone();
            out.push_back(std::move(c.mutate(mr, ms, rng)));
        } else {
            const Net& a = *sorted[(size_t)pickRank()].brain;
            const Net& b = *sorted[(size_t)pickRank()].brain;
            Net c = Net::crossover(a, b, rng);
            out.push_back(std::move(c.mutate(mr, ms, rng)));
        }
    }
    /* Immigrants. "mixed" is a label, not a constructible activation — a newcomer
     * has to be born one rectifier or the other, so it draws one. Passing "mixed"
     * straight to the constructor silently produced TANH immigrants, which would
     * have quietly reintroduced the activation the run was told to drop. */
    while ((int)out.size() < n) {
        const Act a = (act == "mixed") ? (rng() < 0.5 ? Act::RELU : Act::LRELU) : actFromName(act);
        out.emplace_back(netSizes(), &rng, a);
    }
    return { std::move(out), ELITES, FRESH };
}

/* Breed one track from its own members only. Same shape as the main line —
 * elites, mutated elites, then rank-weighted crossover — but no immigrants and no
 * champion seat: a random newcomer would dilute the very thing being measured, and
 * the champion belongs to the main line. */
inline std::vector<Net> Evolution::breedTrack(const std::vector<Result>& sorted, const Track& t) {
    const int n = t.n;
    const int ELITES = std::min(3, n);
    const int MUT_ELITES = std::min(6, std::max(1, (int)(n * 0.16)));
    std::vector<Net> out;
    out.reserve((size_t)n);
    for (int i = 0; i < ELITES && (int)out.size() < n; i++) out.push_back(sorted[(size_t)i].brain->clone());
    for (int i = 0; i < MUT_ELITES && (int)out.size() < n; i++) {
        Net c = sorted[(size_t)(int)(rng() * ELITES)].brain->clone();
        out.push_back(std::move(c.mutate(t.rate, t.sigma, rng)));
    }
    auto pick = [&]() {
        const double r = std::pow(rng(), 2.2);
        return std::min((int)sorted.size() - 1, (int)(r * sorted.size() * 0.55));
    };
    while ((int)out.size() < n) {
        const double depth = (double)out.size() / n;
        const double mr = t.rate * (0.7 + depth * 0.7), ms = t.sigma * (0.7 + depth * 0.9);
        const Net& a = *sorted[(size_t)pick()].brain;
        const Net& b = *sorted[(size_t)pick()].brain;
        Net c = Net::crossover(a, b, rng);
        out.push_back(std::move(c.mutate(mr, ms, rng)));
    }
    return out;
}

/* Split part of the population off into independent tracks. */
inline void Evolution::openRound(int nTracks, double tfrac, int tgens, double mutRate,
                                 double mutSigma, double recent, double older, int pl) {
    const double baseRate = hasTuned ? tunedRate : mutRate;
    const double baseSigma = hasTuned ? tunedSigma : mutSigma;
    const int per = std::max(12, (int)std::floor((popSize * tfrac) / nTracks));
    // Never let the tracks crowd the main line below half the population — it
    // still has to be a working GA while the search runs.
    const int maxTotal = (int)std::floor(popSize * 0.45);
    const int count = std::max(1, std::min(nTracks, maxTotal / per));

    tracks.clear();
    std::string names;
    const auto& R = TRACK_RECIPES();
    for (int i = 0; i < count; i++) {
        const Recipe& rc = R[(size_t)((recipeAt + i) % (int)R.size())];
        Track t;
        t.n = per; t.recipe = rc.name;
        t.rate = std::max(TRACK_RATE_LO, std::min(TRACK_RATE_HI, baseRate * rc.rm));
        t.sigma = std::max(TRACK_SIGMA_LO, std::min(TRACK_SIGMA_HI, baseSigma * rc.sm));
        tracks.push_back(t);
        char buf[96];
        std::snprintf(buf, sizeof buf, "%s %.3f/%.3f", rc.name, baseRate * rc.rm, baseSigma * rc.sm);
        if (i) names += " | ";
        names += buf;
    }
    recipeAt = (recipeAt + count) % (int)R.size();
    roundOpen = true; roundGens = 0; roundStartGen = gen;
    roundBaseRate = baseRate; roundBaseSigma = baseSigma;
    char buf[512];
    std::snprintf(buf, sizeof buf,
        "plateau: best fitness flat over %d gens (%.0f -> %.0f) — splitting off %d x %d into tracks [%s] for %d gens",
        pl, older, recent, count, per, names.c_str(), tgens);
    probeEvent = buf;
}

/* End a round: did any track's lineage actually overtake the leader?
 *
 * Judged on the mean over the round's last TRACK_JUDGE_GENS generations, not on a
 * single generation and not on the best moment the track ever had. Every brain
 * alive in a given generation ran the same missions, so comparing a track's best
 * against the champion's own re-measured score generation by generation is a
 * paired comparison; averaging a dozen of them is what stops one lucky mission set
 * crowning a track that is not actually better. A track also has to have LED in
 * most of those generations, not merely have out-averaged the leader on the
 * strength of one spike. */
inline void Evolution::judgeRound(const std::vector<std::vector<Result>>& trackResults) {
    struct J { size_t i; double mt, mc, margin; int wins, of; std::string recipe; double rate, sigma; };
    std::vector<J> judged;
    for (size_t i = 0; i < tracks.size(); i++) {
        const Track& t = tracks[i];
        const int k = std::min((int)t.hist.size(), TRACK_JUDGE_GENS);
        double mt = 0, mc = 0;
        int wins = 0;
        for (int g = (int)t.hist.size() - k; g < (int)t.hist.size(); g++) {
            mt += t.hist[(size_t)g].first;
            mc += t.hist[(size_t)g].second;
            if (t.hist[(size_t)g].first > t.hist[(size_t)g].second) wins++;
        }
        const int nn = std::max(1, k);
        judged.push_back({ i, mt/nn, mc/nn, mt/nn - mc/nn, wins, k, t.recipe, t.rate, t.sigma });
    }
    std::string report;
    for (size_t i = 0; i < judged.size(); i++) {
        char b[160];
        std::snprintf(b, sizeof b, "%s %.0fv%.0f (%d/%d)",
            judged[i].recipe.c_str(), judged[i].mt, judged[i].mc, judged[i].wins, judged[i].of);
        if (i) report += ", ";
        report += b;
    }
    std::vector<J> beat;
    for (auto& j : judged) if (j.margin > 0 && j.wins > j.of * 0.6) beat.push_back(j);
    std::stable_sort(beat.begin(), beat.end(), [](const J& a, const J& b) { return a.margin > b.margin; });

    char buf[768];
    if (!beat.empty()) {
        const J& w = beat[0];
        const auto& src = trackResults[w.i];
        if (!src.empty()) {
            champion = src[0].brain->clone();
            championFit = src[0].fitness;
            hasChampion = true;
        }
        hasTuned = true; tunedRate = w.rate; tunedSigma = w.sigma;
        std::snprintf(buf, sizeof buf,
            "track \"%s\" OVERTOOK the leader after %d gens (%.0f vs %.0f, led %d/%d) — adopting it and mutation %.3f/%.3f. [%s]",
            w.recipe.c_str(), roundGens, w.mt, w.mc, w.wins, w.of, w.rate, w.sigma, report.c_str());
    } else {
        const auto& R = TRACK_RECIPES();
        std::snprintf(buf, sizeof buf,
            "no track beat the leader in %d gens [%s] — dissolving; next plateau will try %s",
            roundGens, report.c_str(), R[(size_t)(recipeAt % (int)R.size())].name);
    }
    probeEvent = buf;
    /* Dissolve either way, and let the plateau test speak again shortly. A losing
     * round rolls straight into the next set of recipes — the run is still flat, so
     * the question still answers yes — while a winning one only re-opens if the
     * adoption failed to move anything. The short settle first: the population has
     * just had a third of itself replaced, so a handful of generations pass before
     * the fleet's best is a description of the run again rather than of the
     * reshuffle. */
    probeHoldUntil = gen + roundSettle;
    tracks.clear();
    roundOpen = false;
}

/* Decide the activation once, on the most evidence the run will ever have.
 *
 * Judged on the SMOOTHED mean of each deme's best over the last DEME_JUDGE_GENS
 * generations, not on the best moment a deme ever had and not on one generation.
 * Every deme ran the identical mission bank in every one of those generations, so
 * this is a paired comparison — the only kind worth making on an objective where
 * the same unchanged brain swings 18.7x on mission luck alone.
 *
 * `best` rather than `avg`: the run's product is its champion, and a deme can
 * carry a wide unproductive tail without that being a fault. */
inline const std::vector<Result>* Evolution::cullDemes(const std::vector<std::vector<Result>>& demeResults) {
    int K = DEME_JUDGE_GENS;
    for (auto& d : demes) K = std::min(K, (int)d.hist.size());
    struct J { size_t i; double mean; int wins; };
    std::vector<J> judged;
    for (size_t i = 0; i < demes.size(); i++) {
        double m = 0;
        const auto& h = demes[i].hist;
        for (int g = (int)h.size() - K; g < (int)h.size(); g++) m += h[(size_t)g].first;
        judged.push_back({ i, m / std::max(1, K), 0 });
    }
    // How often each deme actually led, generation by generation — a mean can be
    // carried by one spike, and "led most weeks" is the claim.
    for (int g = 0; g < K; g++) {
        size_t bi = 0; double bv = -1e300;
        for (size_t i = 0; i < demes.size(); i++) {
            const auto& h = demes[i].hist;
            const double v = h[h.size() - K + g].first;
            if (v > bv) { bv = v; bi = i; }
        }
        judged[bi].wins++;
    }
    std::vector<J> rank = judged;
    std::stable_sort(rank.begin(), rank.end(), [](const J& a, const J& b) { return a.mean > b.mean; });
    const J& win = rank[0];
    std::string report;
    for (size_t i = 0; i < rank.size(); i++) {
        char b[128];
        std::snprintf(b, sizeof b, "%s %.0f (led %d/%d)",
            demes[rank[i].i].act.c_str(), rank[i].mean, rank[i].wins, K);
        if (i) report += ", ";
        report += b;
    }

    const std::vector<Result>& survivors = demeResults[win.i];
    int total = 0;
    for (auto& d : demes) total += d.n;
    /* The champion may belong to a deme that just lost. It cannot stay: the run is
     * a single-activation GA from here and its incumbent has to be a brain of that
     * activation, or the next generation seats a foreigner in the only deme there
     * is. */
    std::string championNote;
    const std::string winAct = demes[win.i].act;
    if (hasChampion && std::string(actName(champion.act)) != winAct && !survivors.empty()) {
        const std::string old = actName(champion.act);
        champion = survivors[0].brain->clone();
        championFit = survivors[0].fitness;
        hasGrace = false;
        char b[256];
        std::snprintf(b, sizeof b, "; the %s champion goes with it — %s's best takes the crown at %.0f",
            old.c_str(), winAct.c_str(), championFit);
        championNote = b;
    }

    Deme keep = demes[win.i];
    keep.n = total;
    demes.clear();
    demes.push_back(keep);
    culled = true;
    std::string upper = winAct;
    for (auto& ch : upper) ch = (char)std::toupper((unsigned char)ch);
    char buf[768];
    std::snprintf(buf, sizeof buf,
        "activation cull after %d gens on %d paired generations: %s takes the whole population [%s]%s",
        (int)history.size(), K, upper.c_str(), report.c_str(), championNote.c_str());
    demeEvent = buf;
    return &demeResults[win.i];
}

/* ------------------------------------------------------------------ curriculum
 * Decides which stage the NEXT generation runs in. A stage advances on a
 * population-level milestone (what the fleet can actually do) or on a generation
 * fallback, whichever comes first. The milestones are deliberately population-wide
 * fractions, not the best walker's score: one lucky individual standing up does
 * not mean the gene pool is ready for shoves. */
struct Curriculum {
    double balancedThr = 0.80;   // fleet fraction that stands and holds it -> shoves
    double arrThr1 = 0.30;       // mean waypoints per walker -> turning courses
    double arrThr2 = 1.20;       // -> the ground starts to tilt and step
    double arrThr3 = 2.20;       // -> the wind comes up
    int stage2Gen = 50, stage3Gen = 400, stage4Gen = 620, stage5Gen = 800;
    // Floors the generation fallback may not cross. floorProg3 is metres of honest
    // closure by the average walker — the fleet sat at ~0.6 m through its best
    // stage-2 generations, so this floor holds it where the waypoints are until
    // walking is real rather than incidental.
    double floor2 = 0.30, floorProg3 = 0.90, floor4 = 0.02, floor5 = 0.40;
    int stageLock = 0, maxStage = 0;
    // Negative means "not supplied"; an explicit grid-search value overrides.
    double terrainDifficulty = -1;
};

struct StagePick { int stage; double terrainDifficulty; };

inline StagePick stageFor(int gen, const std::vector<HistRec>& history, const Curriculum& c) {
    const double td = c.terrainDifficulty >= 0 ? c.terrainDifficulty : 1.0;
    if (c.stageLock) return { c.stageLock, td };
    const int from = std::max(0, (int)history.size() - 5);
    const int cnt = (int)history.size() - from;
    auto mean = [&](double HistRec::*f) {
        if (!cnt) return 0.0;
        double s = 0;
        for (int i = from; i < (int)history.size(); i++) s += history[(size_t)i].*f;
        return s / cnt;
    };
    /* The ratchet only turns one way. An advanced stage makes life harder, so the
     * metric that triggered it dips right after — letting the stage fall back
     * produces a sawtooth that trains nothing. Every gate PROMOTES; none may
     * demote. Written as a plain assignment the stage-2 gate clobbers a fleet
     * already on stage 3, which ran that way from generation 170 to 250:
     * st3 · st3 · st2 · st3 · st3 · st2. std::max is the whole ratchet. */
    int s = history.empty() ? 1 : std::max(1, history.back().stage);
    const double bal = mean(&HistRec::balancedFrac);
    const double arr = mean(&HistRec::avgArr);
    const double prog = mean(&HistRec::avgProg);
    /* The gate for stage 2 is "balanced", not "stood". Reaching full height is
     * nearly free (the newborn's trim pose IS standing), so gating on it promoted
     * the fleet into shove-testing at generation 2, before a single walker could
     * hold still. Every gate has to be something the stage below it teaches.
     *
     * The generation fallback exists so a threshold set too high cannot stall a run
     * forever. It is NOT licence to promote a fleet that cannot do the stage below,
     * and used unguarded that is exactly what it did — so each fallback also has to
     * clear a floor set far below the real gate. */
    if ((gen >= c.stage2Gen && bal >= c.floor2) || bal >= c.balancedThr) s = std::max(s, 2);
    /* The stage-3 fallback used to read balancedFrac, and that is the very mistake
     * this function's preamble warns against: balance is what stage ONE teaches,
     * banked by generation 3, so the floor was satisfied before the fleet could
     * take a step. Stage 3 is the walking stage, so its gate has to be metres. */
    if (s >= 2 && ((gen >= c.stage3Gen && prog >= c.floorProg3) || arr >= c.arrThr1)) s = std::max(s, 3);
    if (s >= 3 && ((gen >= c.stage4Gen && arr >= c.floor4) || arr >= c.arrThr2)) s = std::max(s, 4);
    if (s >= 4 && ((gen >= c.stage5Gen && arr >= c.floor5) || arr >= c.arrThr3)) s = std::max(s, 5);
    if (c.maxStage) s = std::min(s, c.maxStage);
    /* THE GLOBAL TERRAIN RAMP IS GONE. It used to scale difficulty by the fleet's
     * recent metres walked, which reads as prudent and was in fact a trap: terrain
     * difficulty was gated on walking competence, and walking competence on terrain
     * was the thing being trained. The job that ramp was doing — never present the
     * whole fleet with a cliff — is now done properly by drawing a per-episode
     * difficulty spread in World. */
    return { s, td };
}
