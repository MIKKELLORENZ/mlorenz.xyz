/* dagger.cpp — label states with a TEACHER and collect them for distillation.
 *
 *   ./walk3d_dagger --teacher training/champion_gen6951.json --beta 1 \
 *                   --episodes 240 --workers 64 --out dag/d0.bin
 *   ./walk3d_dagger --teacher T.json --student dag/s1.json --beta 0.5 ...
 *
 * WHY THIS EXISTS. Rising from the floor read 0/6 for every champion this
 * project produced, across ~4,400 generations of four different rise
 * programmes. The open-loop search (probe_rise_search.js) proved a rise IS
 * reachable — 0.39 m to 0.81 m settled from prone inside the real torque and
 * slew limits — so the capability exists and selection cannot see it: one
 * scalar per 130-second episode, a deceptive prefix (the COM must go DOWN
 * first), and a multi-second contact sequence. That is the signal-limited case,
 * and the answer that worked on Tetris and orbital docking is a per-decision
 * teacher, cloned by DAgger, then handed back to the GA.
 *
 * THE TEACHER is two things stitched by the walker's own `downed` flag:
 *
 *   · upright  → the shipped walking champion, labelling every state with what
 *                it would do there. Always achievable by construction.
 *   · downed   → the searched rise reference, PHASE-TRACKED: the reference is
 *                replayed once open-loop to record (joint angles, gravity
 *                direction, action) per control tick; at run time the label is
 *                the action at the reference frame nearest the walker's CURRENT
 *                state, a few ticks ahead. That is a function of the state, not
 *                of the clock, so a student that lags or slips is labelled
 *                "from where you are", never "where you should have been" — the
 *                DAgger labelling trap in the memory notes.
 *
 * A state too far from every reference frame is STRANDED: no sample is
 * written, and the fraction is reported, because a label invented there would
 * be a fabricated one.
 *
 * beta-mix: with probability --beta an episode is DRIVEN by the teacher, else by
 * the student; labels are the teacher's either way. beta 1 with no student is
 * pure cloning data; beta 0 is an honest on-policy measurement of the student.
 */
#include <atomic>
#include <thread>
#include <mutex>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <fstream>
#include <random>
#include <algorithm>
#include <map>
#include <array>
#include <sstream>
#include "episode.hpp"
#include "posespec.hpp"
#include "refstate.hpp"

/* ----------------------------------------------------------------- args */
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
static double argNum(const char* name, double d) {
    const char* v = rawArg(name); if (!v) return d; if (!*v) return 1; return std::strtod(v, nullptr);
}
static std::string argStr(const char* name, const std::string& d) {
    const char* v = rawArg(name); return (v && *v) ? std::string(v) : d;
}

/* --------------------------------------------------------- reference */
struct RefTraj {
    std::string name;
    int K = 0, nj = 0;
    std::vector<float> q;     // K x nj, normalised like C_QA
    std::vector<float> g;     // K x 3, gravity in the pelvis frame
    std::vector<float> u;     // K x nj, the action the reference issued
    double peakCom = 0, settledCom = 0;
    int endTick = 0;          // last frame the tracker plays to (the reference's own end)
};

/* A reference is one or more open-loop SEGMENTS played back to back — a
 * searched quadruped gene followed by the kneel gene it was searched to land
 * in — time-indexed exactly like walk3d_risesearch's --chain plays them (a
 * jump at each boundary, never a blend). One tick per CTRL_DT over the total. */
struct RefSeg { int K; double T; std::vector<double> gene; };
struct RefDef { std::string name; std::vector<RefSeg> segs; double Ttotal = 0; int ticks() const { return (int)std::round(Ttotal / CTRL_DT); } };

/* Replays one reference open-loop from its own pose and records what the body
 * did. Also re-measures the rise it produces, because a reference that no
 * longer rises in THIS build would teach nothing. */
struct RecordHook : ActionHook {
    const RefDef* ref; RefTraj* out; int K; int tick = 0;
    void onAction(Walker& x, World& w) override {
        const int nj = x.nj;
        if (tick < K) {
            jointNorm(x, *x.model, &out->q[(size_t)tick * nj]);
            gravNorm(x, &out->g[(size_t)tick * 3]);
        }
        double t0 = 0; const RefSeg* s = &ref->segs.back(); double tl = w.time - (ref->Ttotal - s->T);
        for (const auto& c : ref->segs) { if (w.time <= t0 + c.T) { s = &c; tl = w.time - t0; break; } t0 += c.T; }
        const double uu = clampd(tl / s->T, 0, 1) * (s->K - 1);
        const int i0 = std::min(s->K - 2, (int)std::floor(uu));
        const double f = uu - i0;
        for (int j = 0; j < nj; j++) {
            const double a = s->gene[(size_t)j * s->K + i0], b = s->gene[(size_t)j * s->K + i0 + 1];
            x.out[j] = (float)(a + (b - a) * f);
            if (tick < K) out->u[(size_t)tick * nj + j] = x.out[j];
        }
        for (int i = nj; i < (int)x.out.size(); i++) x.out[i] = 0.5f;
        tick++;
    }
};
/* The reference is recorded from a JITTERED replay, not the clean one: the
 * clean (exactly symmetric) replay is a measure-zero case that was measured to
 * collapse where every jittered replay stands. Several seeds are tried, the
 * gene is followed by the finisher (the walking champion) for as long again,
 * and the first seed that ends STANDING is kept. */
static RefTraj recordRef(const Model& M, const RefDef& ref, Net& finisher) {
    const int K = ref.ticks(), geneTicks = K;
    RefTraj best; double bestScore = -1; uint32_t bestSeed = 0; bool bestStanding = false;
    for (int sd = 0; sd < 8; sd++) {
        RefTraj t; t.name = ref.name; t.K = K; t.nj = M.nj; t.endTick = K - 1;
        t.q.assign((size_t)K * M.nj, 0); t.g.assign((size_t)K * 3, 0); t.u.assign((size_t)K * M.nj, 0);
        World w;
        WorldOpts o;
        o.stage = 1; o.terrainId = "flat"; o.terrainDifficulty = 0; o.missionSeed = 31;
        o.noiseSeed = 17u + 31u * (uint32_t)sd; o.noise = true;
        o.groundFrac = 0; o.poseFrac = 0; o.seatFrac = 0; o.scaffoldFrac = 0;
        poseOpts(o, ref.name);
        w.init(M, &finisher, o);
        poseApply(w, M, ref.name);
        RecordHook h; h.ref = &ref; h.out = &t; h.K = K;
        w.walker.hook = &h;
        double acc = 0; int n = 0;
        for (int k = 0; k < 2 * geneTicks; k++) {
            if (k == geneTicks) w.walker.hook = nullptr;        // handover to the finisher
            for (int s = 0; s < CONTROL_EVERY; s++) w.step();
            const double c = w.walker.comHeight(&w.terrain);
            t.peakCom = std::max(t.peakCom, c);
            if (k >= 2 * geneTicks - 50) { acc += c; n++; }
        }
        w.walker.hook = nullptr;
        t.settledCom = n ? acc / n : 0;
        const Walker& x = w.walker;
        const bool standing = x.uprightness() > 0.75 && x.groundClearance(w.terrain) > 0.78 * M.standHipY;
        const double score = t.settledCom + (standing ? 1.0 : 0.0);
        if (score > bestScore) { bestScore = score; best = t; bestSeed = o.noiseSeed; bestStanding = standing; }
        if (standing) break;
    }
    std::printf("  %-10s recorded from jitter seed %u: peak %.3f m, %.3f m after the finisher, standing %d\n",
                ref.name.c_str(), bestSeed, best.peakCom, best.settledCom, (int)bestStanding);
    return best;
}

/* ---------------------------------------------------------- samples */
#pragma pack(push, 1)
struct SampleHdr { int32_t ep; uint8_t src; uint8_t driver; uint16_t pad; };
#pragma pack(pop)

struct Buf {
    std::vector<char> bytes;
    void put(int ep, int src, int driver, const float* in, int nin, const float* lab, int nout) {
        SampleHdr h { ep, (uint8_t)src, (uint8_t)driver, 0 };
        const size_t at = bytes.size();
        bytes.resize(at + sizeof h + sizeof(float) * (size_t)(nin + nout));
        std::memcpy(&bytes[at], &h, sizeof h);
        std::memcpy(&bytes[at + sizeof h], in, sizeof(float) * (size_t)nin);
        std::memcpy(&bytes[at + sizeof h + sizeof(float) * (size_t)nin], lab, sizeof(float) * (size_t)nout);
    }
};

/* ---------------------------------------------------------- teacher */
struct DagTune {
    double dMax = 1.2, dReanchor = 1.0, lam = 0.05; int look = 5, back = 2, fwd = 4, walkStride = 4, capPerEp = 1500, refEnd = 150; double tie = 0.02; bool trace = false, assume = true, riseTeacher = true;
};

struct TeacherHook : ActionHook {
    const Net* teacher = nullptr;
    const Net* post = nullptr;      // labels the post-rise handover; null = teacher
    const Net* riseNet = nullptr;   // --rise-net: a CLOSED-LOOP rise teacher labels every downed state; the references are unused
    std::vector<float> assumeLab;   // output-space encoding of the prone pose
    const std::vector<RefTraj>* refs = nullptr;
    const DagTune* T = nullptr;
    std::vector<float> scratch, qn, lab;
    Buf* buf = nullptr;
    int ep = 0; bool teacherDrives = true; bool useRise = true;
    /* --self-label: rise samples of a STUDENT-driven episode are held back
     * until the episode ends. If the student got up, they are written with the
     * student's OWN actions as labels (src 3): an achievable, on-policy label
     * for a rise that demonstrably works, where the phase-tracked open-loop
     * reference is a chaotic one. If it did not, the teacher labels stand
     * (--failed teacher) or the samples are dropped (--failed drop). */
    bool selfLabel = false; int failedPolicy = 0;
    std::vector<float> held; std::vector<uint8_t> heldSrc; int selfSamples = 0;
    /* "rose" (the walker's recovery flag fired) is NOT "got up": the shipped
     * brain fired it on ~55% of kneel starts and fell again within a second in
     * all but 3%. A rise counts as HELD only if no fall follows within 3 s. */
    int recoverTick = -1, fallsAtRecover = 0;
    bool heldUp() const { return recoverTick >= 0 && ticks - recoverTick >= 150 && fallsAfter == 0; }
    int fallsAfter = 0;
    // phase tracking
    bool riseMode = false, postRise = false; int refIdx = -1, k = -1, holdTicks = 0, postTicks = 0;
    // tallies
    int ticks = 0, riseTicks = 0, stranded = 0, walkSamples = 0, riseSamples = 0, epSamples = 0, assumeSamples = 0;
    std::vector<float> bestDists;

    void begin(int e, bool td) {
        ep = e; teacherDrives = td; riseMode = postRise = false; refIdx = -1; k = -1; holdTicks = postTicks = 0;
        ticks = riseTicks = stranded = walkSamples = riseSamples = epSamples = assumeSamples = selfSamples = 0; bestDists.clear();
        held.clear(); heldSrc.clear(); recoverTick = -1; fallsAtRecover = 0; fallsAfter = 0;
    }
    /* end of episode: decide what the held-back rise samples are labelled with */
    void flush(bool rose) {
        const Layout& L = LAY();
        const int nin = L.NIN, nout = L.NOUT, stride = nin + 2 * nout;
        for (size_t i = 0; i < heldSrc.size(); i++) {
            const float* in = &held[i * (size_t)stride];
            if (rose) { buf->put(ep, 3, 0, in, nin, in + nin + nout, nout); selfSamples++; }
            else if (failedPolicy == 0 && heldSrc[i] != 255) buf->put(ep, heldSrc[i], 0, in, nin, in + nin, nout);
        }
        held.clear(); heldSrc.clear();
    }

    /* nearest reference frame; returns squared distance, sets refIdx/k */
    double nearest(const Walker& x, bool global) {
        const int nj = x.nj;
        gravNorm(x, gtmp);
        jointNorm(x, *x.model, qn.data());
        double best = 1e18; int bi = refIdx, bk = k;
        auto scan = [&](int ri, int a, int b) {
            const RefTraj& r = (*refs)[(size_t)ri];
            a = std::max(0, a); b = std::min(r.K - 1, b);
            for (int kk = a; kk <= b; kk++) {
                const float* rq = &r.q[(size_t)kk * nj];
                const float* rg = &r.g[(size_t)kk * 3];
                double d = 0;
                for (int j = 0; j < nj; j++) { const double e = qn[(size_t)j] - rq[j]; d += e*e; }
                for (int c = 0; c < 3; c++) { const double e = gtmp[c] - rg[c]; d += 3.0*e*e; }
                if (d < best) { best = d; bi = ri; bk = kk; }
            }
        };
        if (global || refIdx < 0) {
            for (int ri = 0; ri < (int)refs->size(); ri++) scan(ri, 0, 1 << 30);
            /* Anchor to the EARLIEST frame that ties with the minimum: at the
             * start of a rise the body is static for many frames and an exact
             * argmin lands several frames ahead, which on a chaotic trajectory
             * is a different rise. */
            const RefTraj& r = (*refs)[(size_t)bi];
            for (int kk = 0; kk < bk; kk++) {
                const float* rq = &r.q[(size_t)kk * nj];
                const float* rg = &r.g[(size_t)kk * 3];
                double d = 0;
                for (int j = 0; j < nj; j++) { const double e = qn[(size_t)j] - rq[j]; d += e*e; }
                for (int c = 0; c < 3; c++) { const double e = gtmp[c] - rg[c]; d += 3.0*e*e; }
                if (d <= best + T->tie) { bk = kk; break; }
            }
            refIdx = bi; k = bk; return best;
        }
        /* Local tracking: the phase advances like a clock, and the state match
         * may only NUDGE it. A plain argmin over a forward window runs away —
         * at the start of a rise the body barely moves for many frames, the
         * distances tie, and k leaps to the end of the window every tick. */
        const RefTraj& r = (*refs)[(size_t)refIdx];
        double bestPen = 1e18; int bkk = std::min(r.K - 1, k + 1); double bd = 1e18;
        for (int kk = std::max(0, k - T->back); kk <= std::min(r.K - 1, k + T->fwd); kk++) {
            const float* rq = &r.q[(size_t)kk * nj];
            const float* rg = &r.g[(size_t)kk * 3];
            double d = 0;
            for (int j = 0; j < nj; j++) { const double e = qn[(size_t)j] - rq[j]; d += e*e; }
            for (int c = 0; c < 3; c++) { const double e = gtmp[c] - rg[c]; d += 3.0*e*e; }
            const double off = kk - (k + 1);
            const double pen = d + T->lam * off * off;
            if (pen < bestPen) { bestPen = pen; bkk = kk; bd = d; }
        }
        k = bkk;
        return bd;
    }
    float gtmp[3];

    void onAction(Walker& x, World& w) override {
        const Layout& L = LAY();
        const int nj = x.nj, nout = L.NOUT;
        ticks++;
        const bool down = x.downed;
        const double com = x.comHeight(&w.terrain);
        if (x.recoveries > 0 && recoverTick < 0) { recoverTick = ticks; fallsAtRecover = x.falls; }
        if (recoverTick >= 0 && ticks - recoverTick < 150 && x.falls > fallsAtRecover) fallsAfter = x.falls - fallsAtRecover;
        // ---- mode transitions ----
        if (postRise) {
            postTicks++;
            if (!down) { postRise = false; }
            else if (postTicks > 25 && com < 0.40) { postRise = false; riseMode = true; refIdx = -1; k = -1; holdTicks = 0; }
        }
        if (!riseMode && !postRise && down && T->riseTeacher && useRise) { riseMode = true; refIdx = -1; k = -1; holdTicks = 0; }
        /* Once a rise is under way it is played to the reference's end even if
         * the walker's `downed` flag clears early: the flag clears after 0.35 s
         * of "upright enough", which on a searched rise is mid-motion, and
         * handing the champion a body at full upward velocity drops it. The
         * search this reference came from always played the full gene. */

        int src = 0; bool have = true;
        if (riseMode && riseNet) {
            /* closed-loop rise teacher: its action in this very state, no
             * tracker, no stranding; hands over when the walker is no longer
             * down (the net was evolved to keep going to standing) */
            src = 1; riseTicks++;
            const float* o = riseNet->forward(x.inputs.data(), scratch.data());
            for (int i = 0; i < nout; i++) lab[(size_t)i] = o[i];
            if (!down) { riseMode = false; postRise = true; postTicks = 0; }
        } else if (riseMode) {
            src = 1; riseTicks++;
            const bool hadAnchor = refIdx >= 0;
            double d = nearest(x, !hadAnchor);
            if (hadAnchor && d > T->dReanchor * T->dReanchor) d = nearest(x, true);
            const double dist = std::sqrt(d);
            bestDists.push_back((float)dist);
            const RefTraj& r = (*refs)[(size_t)refIdx];
            /* The scaffold was searched and scored over its 3 s only; holding
             * its last knot longer collapses the body (measured: COM 0.84 m at
             * 2.8 s, 0.24 m by 3.6 s). Hand over to the walking champion at
             * the end — it rises from any crouch 6/6. */
            const int kEnd = std::min(r.endTick, T->refEnd);
            const int kl = std::min(kEnd, k + T->look);
            for (int j = 0; j < nj; j++) lab[(size_t)j] = r.u[(size_t)kl * nj + j];
            for (int i = nj; i < nout; i++) lab[(size_t)i] = 0.5f;
            // this tick is still the reference's; the champion takes the next one
            if (k >= kEnd) { riseMode = false; postRise = true; postTicks = 0; }
            if (dist > T->dMax) {
                stranded++;
                /* A heap that matches no reference frame: the fallback is to
                 * ASSUME the prone pose, which is where the prone rise starts.
                 * Recorded as its own source so its value can be measured; the
                 * anchor is dropped so tracking resumes the moment a frame is
                 * within reach. */
                refIdx = -1; k = -1;
                if (T->assume && !assumeLab.empty()) { src = 2; for (int i = 0; i < nout; i++) lab[(size_t)i] = assumeLab[(size_t)i]; }
                else if (selfLabel && !teacherDrives) src = 255;   /* no teacher label; kept only if the student rises */
                else have = false;
            }
            if (T->trace && ep == 0 && (ticks % 10) == 1)
                std::printf("trace ep0 t=%.2f ref=%s k=%d d=%.2f com=%.3f down=%d\n", w.time, r.name.c_str(), k, dist, com, (int)down);
        }
        if (!riseMode && src == 0) {
            const Net* who = (postRise && post) ? post : teacher;
            const float* o = who->forward(x.inputs.data(), scratch.data());
            for (int i = 0; i < nout; i++) lab[(size_t)i] = o[i];
        }
        // ---- record ----
        if (have && buf && epSamples < T->capPerEp) {
            const bool take = src != 0 || (ticks % T->walkStride) == 0;
            if (take) {
                if (selfLabel && !teacherDrives && src != 0) {
                    held.insert(held.end(), x.inputs.begin(), x.inputs.begin() + L.NIN);
                    held.insert(held.end(), lab.begin(), lab.begin() + nout);
                    held.insert(held.end(), x.out.begin(), x.out.begin() + nout);   // the student's own action
                    heldSrc.push_back((uint8_t)src);
                } else buf->put(ep, src, teacherDrives ? 1 : 0, x.inputs.data(), L.NIN, lab.data(), nout);
                epSamples++; if (src == 2) assumeSamples++; else if (src != 0) riseSamples++; else walkSamples++;
            }
        }
        // ---- execute ----
        if (teacherDrives) for (int i = 0; i < nout; i++) x.out[i] = (float)clampd(lab[(size_t)i], 0, 1);
    }
};

/* ---------------------------------------------------------- episodes */
struct EpSpec { int idx; std::string pose; std::string terrain; int mission; bool crouch = false; };
struct EpResult {
    int idx; std::string pose, terrain, surface; bool teacherDrives;
    double arrivals, metres, upright, com; int falls, recoveries, ticks, riseTicks, stranded, walkS, riseS, selfS; bool held;
    float d50, d90, dmax;
};

int main(int argc, char** argv) {
    g_argc = argc; g_argv = argv;
    installOutRowScale();
    const Model& M = HUMANOID();
    const Layout& L = LAY();

    const std::string teacherFile = argStr("teacher", "");
    const std::string studentFile = argStr("student", "");
    const std::string outFile = argStr("out", "");
    const double beta = argNum("beta", 1.0);
    const int episodes = (int)argNum("episodes", 120);
    const int workers = std::max(1, (int)argNum("workers", 32));
    const int stage = (int)argNum("stage", 5);
    const uint32_t seed = (uint32_t)argNum("seed", 1);
    const int block = (int)argNum("block", 20000);
    const double floorFrac = argNum("floor-frac", 0.5);
    const double floorFlat = argNum("floor-flat", 0.6);
    const double floorDiff = argNum("floor-diff", -1);      // >=0 pins terrain difficulty on floor starts
    /* Crouch starts (the stage's own crouchAt ramp, depth 0.25-1.0) labelled by
     * the WALKING teacher, which rises from every crouch 6/6. Without them the
     * student never sees a crouch and leaps out of one. */
    const double crouchFrac = argNum("crouch-frac", 0);
    const int exact = (int)argNum("exact", 0);              // 1: replicate walk3d_risesearch's evaluation seeds exactly
    const int verbose = (int)argNum("verbose", 0);
    DagTune T;
    T.dMax = argNum("d-max", 1.5); T.dReanchor = argNum("d-reanchor", 1.0);
    T.look = (int)argNum("look", 5); T.walkStride = (int)argNum("walk-stride", 4);
    T.capPerEp = (int)argNum("cap", 1500);
    T.lam = argNum("lam", 0.05); T.back = (int)argNum("back", 2); T.fwd = (int)argNum("fwd", 4);
    T.trace = argNum("trace", 0) != 0;
    T.refEnd = (int)argNum("ref-end", 1 << 30); T.assume = argNum("assume", 1) != 0;
    T.dMax = argNum("d-max", 1.2); T.tie = argNum("tie", 0.02);
    T.riseTeacher = argNum("rise-teacher", 1) != 0;   // 0 = the walking champion labels everything
    const int selfLabel = (int)argNum("self-label", 0);
    const std::string failedPolicy = argStr("failed", "teacher");   // teacher | drop
    const std::string poseList = argStr("poses", "prone:3,quadruped:3,kneel:2,supine:1,side:1,curled:1,seated:1,hugknees:1,sidesit:1");

    if (teacherFile.empty()) { std::fprintf(stderr, "--teacher is required\n"); return 2; }
    auto loadNet = [&](const std::string& f) {
        js::ValuePtr saved = js::readJSON(f);
        js::ValuePtr raw = saved->get("net") ? saved->get("net") : saved;
        std::vector<int> sz;
        if (auto s = raw->get("sizes")) for (auto& e : s->arr) sz.push_back((int)e->num);
        if (sz != L.NET_SIZES) { std::fprintf(stderr, "%s: wrong brain shape\n", f.c_str()); std::exit(3); }
        return Net::fromJSON(raw);
    };
    Net teacher = loadNet(teacherFile);
    /* --post-teacher: the net that labels (and drives) the hand-over after a
     * rise reference ends, until the walker's `downed` flag clears; also the
     * finisher used when recording the references. Defaults to the walking
     * teacher. References are searched with a specific finisher and end in
     * states only that finisher may know how to complete. */
    const std::string postFile = argStr("post-teacher", "");
    Net postTeacher; const bool havePost = !postFile.empty();
    if (havePost) postTeacher = loadNet(postFile);
    Net& refFinisher = havePost ? postTeacher : teacher;
    const std::string riseNetFile = argStr("rise-net", "");
    Net riseNet; const bool haveRiseNet = !riseNetFile.empty();
    if (haveRiseNet) { riseNet = loadNet(riseNetFile); std::printf("rise teacher: %s labels every downed state (closed loop)\n", riseNetFile.c_str()); }
    /* --crouch-teacher: a different net labels (and, when driving, drives) the
     * crouch-start episodes. The GA-polished walker rises from a deep crouch
     * only ~40% of the time where the original champion is 6/6; crouched
     * states are far from walking states, so the two teachers do not collide. */
    const std::string crouchTeacherFile = argStr("crouch-teacher", "");
    Net crouchTeacher; const bool haveCrouchTeacher = !crouchTeacherFile.empty();
    if (haveCrouchTeacher) crouchTeacher = loadNet(crouchTeacherFile);
    Net student; const bool haveStudent = !studentFile.empty();
    /* --student-rise: the student's second net (two-net brain) — drives while
     * the walker is down and for RISE_HANDOFF s after it recovers */
    const std::string studentRiseFile = argStr("student-rise", "");
    Net studentRise; const bool haveStudentRise = !studentRiseFile.empty();
    if (haveStudentRise) studentRise = loadNet(studentRiseFile);
    /* --student-rise-pose name=file,name=file: per-pose SPECIALIST rise nets,
     * used for episodes starting in that pose; --student-rise for the rest */
    std::vector<std::pair<std::string, Net>> studentRisePose;
    { std::stringstream ss(argStr("student-rise-pose", "")); std::string tok;
      while (std::getline(ss, tok, ',')) { const size_t eq = tok.find('='); if (eq != std::string::npos) studentRisePose.push_back({ tok.substr(0, eq), loadNet(tok.substr(eq + 1)) }); } }
    if (haveStudent) student = loadNet(studentFile);

    // ---- references ----
    Net dummy(L.NET_SIZES, nullptr, Act::RELU);
    std::vector<RefTraj> refs;
    /* --refs a.json,b.json replaces the baked scaffold with searched references
     * from walk3d_risesearch: each {pose, knots, T, gene}, or a chained one
     * {pose, segments:[{knots, T, gene}, ...]} written by chain_ref.py. */
    std::vector<RefDef> refDefs;
    const std::string refFiles = argStr("refs", "");
    auto segFrom = [](js::ValuePtr v) { RefSeg s; s.K = (int)v->numOr("knots", 6); s.T = v->numOr("T", 3); for (auto& e : v->get("gene")->arr) s.gene.push_back(e->num); return s; };
    if (refFiles.empty()) {
        for (const auto& r : RISE_SCAFFOLD) { RefDef d; d.name = r.name; d.segs.push_back({ r.knots, r.T, r.gene }); d.Ttotal = r.T; refDefs.push_back(d); }
    } else {
        std::stringstream ss(refFiles); std::string tok;
        while (std::getline(ss, tok, ',')) {
            js::ValuePtr v = js::readJSON(tok);
            RefDef d; d.name = v->strOr("pose", "prone");
            if (auto segs = v->get("segments")) for (auto& e : segs->arr) d.segs.push_back(segFrom(e));
            else d.segs.push_back(segFrom(v));
            for (const auto& s : d.segs) d.Ttotal += s.T;
            refDefs.push_back(d);
        }
    }
    std::printf("reference trajectories (open-loop replay in this build):\n");
    for (const auto& r : refDefs) {
        std::printf("  %-10s %zu segment(s), %.1f s, %d ticks\n", r.name.c_str(), r.segs.size(), r.Ttotal, r.ticks());
        refs.push_back(recordRef(M, r, refFinisher));
    }

    /* --assume-pose: which pose a stranded walker is told to adopt. prone is the
     * floor of the ladder; quadruped is worth trying because prone and quadruped
     * share the same base pitch (-1.50 vs -1.57), so "adopt the quadruped joint
     * angles" from prone is a push-up, not a roll. */
    const std::string assumePose = argStr("assume-pose", "prone");
    std::vector<float> assumeLab((size_t)L.NOUT, 0.5f);
    {
        const Pose* ap = nullptr;
        for (const auto& p : M.groundPoses) if (p.name == assumePose) ap = &p;
        for (const auto& p : M.startPoses) if (p.name == assumePose) ap = &p;
        if (!ap) { std::fprintf(stderr, "unknown --assume-pose %s\n", assumePose.c_str()); return 2; }
        for (int j = 0; j < M.nj; j++) assumeLab[(size_t)j] = (float)clampd((ap->q[(size_t)j] - M.nominal[(size_t)j]) / (2 * M.range[(size_t)j]) + 0.5, 0, 1);
    }

    // ---- episode plan ----
    std::vector<std::pair<std::string,int>> poses;
    {
        std::stringstream ss(poseList); std::string tok;
        while (std::getline(ss, tok, ',')) {
            // weight after the LAST colon, so "crouch:1.0:2" is pose crouch:1.0 with weight 2
            const size_t c = tok.rfind(':');
            const bool hasW = c != std::string::npos && tok.find(':') != std::string::npos && (isPoseSpec(tok.substr(0, c)) || tok.find(':') == c);
            poses.push_back({ hasW ? tok.substr(0, c) : tok, hasW ? std::atoi(tok.c_str() + c + 1) : 1 });
        }
    }
    std::vector<EpSpec> plan;
    {
        std::mt19937 rng(seed * 7919u + 13u);
        std::uniform_real_distribution<double> U(0, 1);
        int wsum = 0; for (auto& p : poses) wsum += p.second;
        for (int i = 0; i < episodes; i++) {
            EpSpec e; e.idx = i; e.mission = block + i;
            if (U(rng) < crouchFrac) { e.crouch = true; e.pose = ""; e.terrain = "varied"; }
            else if (U(rng) < floorFrac) {
                int pick = (int)(U(rng) * wsum), acc = 0;
                for (auto& p : poses) { acc += p.second; if (pick < acc) { e.pose = p.first; break; } }
                if (e.pose.empty()) e.pose = poses.back().first;
                e.terrain = U(rng) < floorFlat ? "flat" : "varied";
            } else { e.pose = ""; e.terrain = "varied"; }
            plan.push_back(e);
        }
    }

    // ---- run ----
    std::atomic<int> next{0};
    std::vector<EpResult> results(plan.size());
    std::vector<Buf> bufs(workers);
    std::vector<std::thread> pool;
    for (int wi = 0; wi < workers; wi++) pool.emplace_back([&, wi]{
        World w;
        TeacherHook h; h.teacher = &teacher; h.refs = &refs; h.T = &T;
        h.scratch.assign(teacher.scratchSize(), 0); h.qn.assign(M.nj, 0); h.lab.assign(L.NOUT, 0); h.assumeLab = assumeLab;
        h.buf = outFile.empty() ? nullptr : &bufs[wi];
        h.selfLabel = selfLabel != 0 && h.buf; h.failedPolicy = failedPolicy == "drop" ? 1 : 0;
        for (;;) {
            const int i = next.fetch_add(1);
            if (i >= (int)plan.size()) break;
            const EpSpec& e = plan[i];
            std::mt19937 rng(seed * 1000003u + (uint32_t)i * 97u);
            const bool td = !haveStudent || std::uniform_real_distribution<double>(0, 1)(rng) < beta;
            WorldOpts o;
            o.stage = stage; o.terrainId = e.terrain; o.missionSeed = 1 + e.mission * 37;
            o.noiseSeed = (uint32_t)(5000 + e.mission * 13); o.noise = true;
            if (exact) { o.missionSeed = 31; o.noiseSeed = 1000u + 7u * (uint32_t)i; o.terrainDifficulty = 0; }
            else { o.episodeSlot = i; o.episodeCount = (int)plan.size(); }
            o.groundFrac = 0; o.poseFrac = 0; o.seatFrac = 0; o.scaffoldFrac = 0;
            if (e.crouch) { o.groundFrac = 1; }
            h.useRise = !e.crouch;
            h.teacher = (e.crouch && haveCrouchTeacher) ? &crouchTeacher : &teacher;
            h.post = havePost ? &postTeacher : nullptr;
            h.riseNet = haveRiseNet ? &riseNet : nullptr;
            if (!e.pose.empty()) { poseOpts(o, e.pose); if (floorDiff >= 0) o.terrainDifficulty = floorDiff; }
            w.init(M, td ? (Net*)((e.crouch && haveCrouchTeacher) ? &crouchTeacher : &teacher) : &student, o);
            if (!e.pose.empty()) poseApply(w, M, e.pose);
            w.walker.riseBrain = (!td && haveStudentRise) ? &studentRise : nullptr;
            if (!td) for (auto& kv : studentRisePose) if (kv.first == e.pose) w.walker.riseBrain = &kv.second;
            h.begin(i, td);
            w.walker.hook = &h;
            long long guard = 0;
            while (!w.isOver() && guard++ < 140LL * 500) w.step();
            w.walker.hook = nullptr;
            const Walker& x = w.walker;
            /* a floor start rose if it recovered at all; a walking start only
             * counts if EVERY fall in it was recovered from */
            if (h.selfLabel) h.flush(e.pose.empty() && !e.crouch ? (x.falls > 0 && x.recoveries >= x.falls) : h.heldUp());
            EpResult r;
            r.idx = i; r.pose = e.pose; r.terrain = e.terrain; r.surface = terrainName(w.terrain.id); r.teacherDrives = td;
            r.arrivals = x.arrivals; r.metres = x.progressM; r.upright = x.uprightTime; r.com = x.bestComY; r.held = h.heldUp();
            r.falls = x.falls; r.recoveries = x.recoveries; r.ticks = h.ticks; r.riseTicks = h.riseTicks;
            r.stranded = h.stranded; r.walkS = h.walkSamples; r.riseS = h.riseSamples + h.assumeSamples; r.selfS = h.selfSamples;
            r.d50 = r.d90 = r.dmax = 0;
            if (!h.bestDists.empty()) {
                std::vector<float> d = h.bestDists; std::sort(d.begin(), d.end());
                r.d50 = d[d.size() / 2]; r.d90 = d[(size_t)(d.size() * 0.9)]; r.dmax = d.back();
            }
            results[(size_t)i] = r;
            if (verbose) std::printf("ep %3d %-9s %-7s noise %u  recov %d falls %d upright %.1fs  rise ticks %d\n", i, e.pose.c_str(), e.terrain.c_str(),
                                     o.noiseSeed, x.recoveries, x.falls, x.uprightTime, h.riseTicks);
        }
    });
    for (auto& t : pool) t.join();

    // ---- write samples ----
    if (!outFile.empty()) {
        std::ofstream f(outFile, std::ios::binary);
        const char magic[8] = { 'W','D','A','G','1',0,0,0 };
        f.write(magic, 8);
        const int32_t nin = L.NIN, nout = L.NOUT;
        f.write((const char*)&nin, 4); f.write((const char*)&nout, 4);
        size_t total = 0;
        for (auto& b : bufs) { f.write(b.bytes.data(), (std::streamsize)b.bytes.size()); total += b.bytes.size(); }
        std::printf("wrote %s (%.1f MB)\n", outFile.c_str(), total / 1048576.0);
    }

    // ---- report ----
    int nWalk = 0, nWalkT = 0, nWalkS = 0; double wpT = 0, wpS = 0, mT = 0, mS = 0; int fallsT = 0, fallsS = 0, recT = 0, recS = 0, fellT = 0, fellS = 0;
    std::map<std::string, std::array<int,6>> byPose;   // rose, n (teacher) ; rose, n (student) ; held (teacher) ; held (student)
    std::map<std::string, double> comByPose;
    long long ticks = 0, riseTicks = 0, stranded = 0, walkS = 0, riseS = 0, selfS = 0;
    std::vector<float> d90s;
    for (auto& r : results) {
        ticks += r.ticks; riseTicks += r.riseTicks; stranded += r.stranded; walkS += r.walkS; riseS += r.riseS; selfS += r.selfS;
        if (r.riseTicks > 0) d90s.push_back(r.d90);
        if (r.pose.empty() && !plan[(size_t)r.idx].crouch) {
            nWalk++;
            if (r.teacherDrives) { nWalkT++; wpT += r.arrivals; mT += r.metres; fallsT += r.falls; if (r.falls) { fellT++; if (r.recoveries) recT++; } }
            else { nWalkS++; wpS += r.arrivals; mS += r.metres; fallsS += r.falls; if (r.falls) { fellS++; if (r.recoveries) recS++; } }
        } else {
            auto& a = byPose[r.pose.empty() ? std::string("crouch") : r.pose];
            if (r.teacherDrives) { a[1]++; if (r.recoveries) a[0]++; if (r.held) a[4]++; } else { a[3]++; if (r.recoveries) a[2]++; if (r.held) a[5]++; }
            comByPose[r.pose.empty() ? std::string("crouch") : r.pose] += r.com;
        }
    }
    std::printf("\nwalking starts: %d episodes\n", nWalk);
    if (nWalkT) std::printf("  teacher-driven %3d: %.2f wp  %.2f m  falls/ep %.2f  recovered after a fall %d/%d\n", nWalkT, wpT/nWalkT, mT/nWalkT, (double)fallsT/nWalkT, recT, fellT);
    if (nWalkS) std::printf("  student-driven %3d: %.2f wp  %.2f m  falls/ep %.2f  recovered after a fall %d/%d\n", nWalkS, wpS/nWalkS, mS/nWalkS, (double)fallsS/nWalkS, recS, fellS);
    std::printf("floor starts, rose (recovered to standing) by pose:\n");
    for (auto& kv : byPose) {
        const auto& a = kv.second;
        std::printf("  %-10s teacher %2d/%-2d  student %2d/%-2d  held %2d/%-2d  mean peak com %.2f m\n", kv.first.c_str(), a[0], a[1], a[2], a[3], a[4], a[5],
                    comByPose[kv.first] / (a[1] + a[3]));
    }
    std::sort(d90s.begin(), d90s.end());
    std::printf("rise ticks %lld of %lld; stranded %.1f%%; per-episode d90 median %.2f p90 %.2f (d-max %.2f)\n",
                riseTicks, ticks, riseTicks ? 100.0 * stranded / riseTicks : 0.0,
                d90s.empty() ? 0.0 : d90s[d90s.size()/2], d90s.empty() ? 0.0 : d90s[(size_t)(d90s.size()*0.9)], T.dMax);
    std::printf("samples: walk %lld  rise %lld  (self-labelled %lld)\n", walkS, riseS, selfS);
    // machine-readable line for the round script
    std::printf("SUMMARY wpT=%.3f wpS=%.3f nWalkT=%d nWalkS=%d strandedPct=%.2f walkS=%lld riseS=%lld\n",
                nWalkT ? wpT/nWalkT : 0.0, nWalkS ? wpS/nWalkS : 0.0, nWalkT, nWalkS,
                riseTicks ? 100.0 * stranded / riseTicks : 0.0, walkS, riseS);
    return 0;
}
