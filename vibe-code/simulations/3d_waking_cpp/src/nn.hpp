/* nn.hpp — plain feedforward network, evolved only. No gradients anywhere.
 *
 * Straight port of nn.js. Two details are load-bearing and are NOT free choices:
 *
 *   · WEIGHTS ARE float, NOT double. The JS holds them in Float32Array, so every
 *     store rounds to single precision. Keeping them as double here would give
 *     the C++ a slightly different network after the very first mutation, and the
 *     oracle harness — which is the only reason to trust this port at all — would
 *     start reporting a divergence that is real but uninteresting. It also halves
 *     the genome's memory traffic, which on a 26,045-parameter net evaluated 50
 *     times a second by 192 brains is not nothing.
 *
 *   · ACCUMULATION IS double. The JS writes `let sum = w[bias]` and accumulates
 *     into a JS number, i.e. a double, from float32 operands. Accumulating in
 *     float instead would be faster and would diverge; the sum stays double.
 *
 * The hidden activation is a per-brain GENE, and the negative slope is per HIDDEN
 * UNIT so that ReLU and leaky ReLU can interbreed neuron by neuron.
 */
#pragma once
#include <vector>
#include <string>
#include <cmath>
#include <cstring>
#include <algorithm>
#include "rng.hpp"
#include "json.hpp"

constexpr double LRELU_SLOPE = 0.1;

enum class Act { TANH, LRELU, RELU, MIXED };

inline const char* actName(Act a) {
    switch (a) {
        case Act::TANH: return "tanh";
        case Act::LRELU: return "lrelu";
        case Act::RELU: return "relu";
        default: return "mixed";
    }
}
inline Act actFromName(const std::string& s) {
    if (s == "lrelu") return Act::LRELU;
    if (s == "relu") return Act::RELU;
    if (s == "mixed") return Act::MIXED;
    return Act::TANH;   // a file with no `act` predates the gene, and every one
                        // of those was evolved under tanh — a reconstruction, not a guess
}
inline bool knownAct(const std::string& s) {
    return s == "tanh" || s == "lrelu" || s == "relu";
}
inline double slopeValue(Act a) { return a == Act::LRELU ? LRELU_SLOPE : 0.0; }

/* OFF BY DEFAULT, and that is load-bearing: in deme mode a flip mutation would
 * quietly turn each "pure ReLU" deme into a hybrid pool and the A/B would stop
 * measuring what its own label says. The trainer switches it on only for an
 * interbreeding run, where mixing is the point. */
inline double& slopeFlipRef() { static double v = 0; return v; }
inline void setSlopeFlip(double v) { slopeFlipRef() = v; }

/* Output-layer init scale, and the per-output override. Small keeps newborns near
 * their trim pose; OUT_ROW_SCALE lets the 22 posture outputs stay tiny while the
 * rhythm outputs are seeded ~14x wider, so a fresh population contains a real
 * spread of attempted gaits and still stands. */
inline double& outInitRef() { static double v = 0.08; return v; }
/* Probability that a mutated weight is REDRAWN outright rather than nudged.
 * 0.03 is what every evolved lineage was selected under; a gradient-trained
 * net has never met it and is not robust to it (measured elsewhere: 774 -> 318
 * skill from twenty redrawn weights), so the trainer can set it to 0. */
inline double& mutResetRef() { static double v = 0.03; return v; }
inline std::vector<double>& outRowScaleRef() { static std::vector<double> v; return v; }

class Net {
public:
    std::vector<int> sizes;
    Act act = Act::TANH;
    /* Per-hidden-layer, per-unit negative slope. Empty for tanh, which is a
     * whole-network activation and does not mix with the other two. */
    std::vector<std::vector<float>> slopes;
    std::vector<std::vector<float>> weights;   // per layer: out x (in+1), bias last column

    Net() = default;

    Net(const std::vector<int>& sz, Rng* initRng, Act a) { init(sz, initRng, a); }

    void init(const std::vector<int>& sz, Rng* initRng, Act a) {
        sizes = sz;
        act = a == Act::MIXED ? Act::RELU : a;
        slopes.clear();
        if (act != Act::TANH) {
            for (size_t l = 0; l + 2 < sizes.size(); l++)
                slopes.emplace_back((size_t)sizes[l + 1], (float)slopeValue(act));
        }
        weights.clear();
        const auto& rowScale = outRowScaleRef();
        for (size_t l = 0; l + 1 < sizes.size(); l++) {
            const int nIn = sizes[l], nOut = sizes[l + 1];
            std::vector<float> w((size_t)nOut * (nIn + 1), 0.0f);
            if (initRng) {
                const bool isOut = (l + 2 == sizes.size());
                const double scale = (isOut ? outInitRef() : 1.0) * std::sqrt(2.0 / nIn);
                const int rowLen = nIn + 1;
                for (int o = 0; o < nOut; o++) {
                    const double rs = (isOut && (int)rowScale.size() > o) ? rowScale[o] : 1.0;
                    for (int i = 0; i < rowLen; i++)
                        w[(size_t)o * rowLen + i] = (float)(gaussRand(*initRng) * scale * rs);
                }
            }
            weights.push_back(std::move(w));
        }
        allocBuf();
    }

    void allocBuf() { buf.assign(scratchSize(), 0.0f); }

    /* Total float count a forward pass needs as scratch. */
    size_t scratchSize() const {
        size_t n = 0;
        for (int s : sizes) n += (size_t)s;
        return n;
    }

    /* The hot loop: 50 Hz per walker, times the population, times the episodes.
     * `isTanh` and the slope row are hoisted out of the unit loop for the same
     * reason the JS hoists them.
     *
     * CONST, and the activations live in a CALLER-SUPPLIED buffer. The JS keeps
     * them on the net, which is safe there because a worker thread owns its own
     * deserialised copy of every brain. Here the population is shared memory and
     * many threads evaluate the same brain on different episodes at once, so
     * activations on the net would be a data race — and a silent one, producing
     * plausible garbage rather than a crash. The buffer belongs to the Walker,
     * which is per-episode by construction. */
    const float* forward(const float* input, float* scratch) const {
        float* cur = scratch;
        std::memcpy(cur, input, sizeof(float) * (size_t)sizes[0]);
        float* next = scratch + sizes[0];
        const bool isTanh = (act == Act::TANH);
        for (size_t l = 0; l < weights.size(); l++) {
            const float* w = weights[l].data();
            const int nIn = sizes[l], nOut = sizes[l + 1];
            const bool last = (l == weights.size() - 1);
            const float* sl = (last || isTanh || slopes.empty()) ? nullptr : slopes[l].data();
            const int rowLen = nIn + 1;
            for (int o = 0; o < nOut; o++) {
                const float* row = w + (size_t)o * rowLen;
                double sum = row[nIn];                       // bias
                for (int i = 0; i < nIn; i++) sum += (double)row[i] * (double)cur[i];
                /* The OUTPUT layer is sigmoid whatever the gene says. Not a free
                 * choice: outputs are joint setpoints in 0..1 and the servo code
                 * reads them as such. */
                if (last) next[o] = (float)(1.0 / (1.0 + std::exp(-sum)));
                else if (isTanh) next[o] = (float)std::tanh(sum);
                else next[o] = (float)(sum > 0 ? sum : (double)sl[o] * sum);
            }
            cur = next;
            next += nOut;
        }
        return cur;
    }

    /* Single-threaded convenience for the exam and the verifier. */
    const float* forward(const float* input) {
        if (buf.size() != scratchSize()) buf.assign(scratchSize(), 0.0f);
        return forward(input, buf.data());
    }

    /* Fraction of hidden units that leak. 0 = pure ReLU, 1 = pure leaky. Once the
     * two interbreed, "which activation is winning" is a proportion, not a label. */
    double leakyShare() const {
        if (slopes.empty()) return -1;                        // tanh: not applicable
        size_t n = 0, k = 0;
        for (auto& s : slopes) for (float v : s) { n++; if (v > 0) k++; }
        return n ? (double)k / (double)n : 0.0;
    }

    /* relu / lrelu while every unit agrees, "mixed" once they do not. Purely a
     * label for logs and charts — forward() always reads the slopes. */
    Net& relabel() {
        if (slopes.empty()) return *this;
        const double share = leakyShare();
        act = share == 0 ? Act::RELU : share == 1 ? Act::LRELU : Act::MIXED;
        return *this;
    }

    Net clone() const {
        Net n;
        n.sizes = sizes;
        n.act = act;
        n.slopes = slopes;
        n.weights = weights;
        n.allocBuf();
        return n;
    }

    Net& mutate(double rate, double sigma, Rng& rng) {
        for (auto& w : weights) {
            for (size_t i = 0; i < w.size(); i++) {
                if (rng() < rate) {
                    if (rng() < mutResetRef()) w[i] = (float)(gaussRand(rng) * 0.5);     // rare full reset
                    else w[i] = (float)((double)w[i] + gaussRand(rng) * sigma);
                }
            }
        }
        const double flip = slopeFlipRef();
        if (!slopes.empty() && flip > 0) {
            bool touched = false;
            for (auto& s : slopes)
                for (size_t i = 0; i < s.size(); i++)
                    if (rng() < flip) { s[i] = s[i] > 0 ? 0.0f : (float)LRELU_SLOPE; touched = true; }
            if (touched) relabel();
        }
        return *this;
    }

    /* mutateSparse — change exactly k weights, chosen by COUNT and not by a
     * per-weight probability.
     *
     * mutate() above flips a coin on every weight, so the number it changes is
     * Binomial(20225, rate). At the default rate that is 708 +/- 26, and the
     * standard deviation is the whole point: every mutated child in the
     * population receives essentially the same SIZE of change. Counted across a
     * generation of 192, the smallest move anywhere in the population was 354
     * weights — 1.7% of the network — so the population could not refine, only
     * jump, and no rate produces 25 reliably. This exists to ask for 25.
     *
     * No full-reset branch, deliberately: mutate() overwrites a weight outright
     * three times in a hundred, which is the opposite of a refinement. The
     * rank-weighted children still call mutate(), so that escape path stays in
     * the population. No slope flips either — changing which rectifier a neuron
     * is is a structural edit, not a small step.
     *
     * rowFocus spends the whole budget inside ONE neuron's incoming row, on the
     * same argument row-wise crossover makes directly below: a row is a
     * functional unit. Since 87% of this net's weights are the input layer, a
     * scattered draw is almost always "how a few hidden units read the world".
     *
     * Indices are drawn WITH replacement — negligible at k=25, about 3% of draws
     * collide at k=1100 — accepted for a draw order simple enough to mirror.
     *
     * DRAW ORDER IS LOAD-BEARING. Must match Net.mutateSparse in nn.js
     * instruction for instruction or the trainer and the oracle diverge. */
    Net& mutateSparse(int k, double sigma, Rng& rng, bool rowFocus) {
        if (rowFocus) {
            int nRows = 0;
            for (size_t l = 0; l + 1 < sizes.size(); l++) nRows += sizes[l + 1];
            int r = (int)(rng() * nRows);
            size_t l = 0;
            while (r >= sizes[l + 1]) { r -= sizes[l + 1]; l++; }
            const int rowLen = sizes[l] + 1;
            auto& w = weights[l];
            const size_t base = (size_t)r * (size_t)rowLen;
            const int m = std::min(k, rowLen);
            for (int i = 0; i < m; i++) {
                const size_t j = base + (size_t)(int)(rng() * rowLen);
                w[j] = (float)((double)w[j] + gaussRand(rng) * sigma);
            }
        } else {
            size_t W = 0;
            for (auto& w : weights) W += w.size();
            for (int i = 0; i < k; i++) {
                size_t j = (size_t)(rng() * (double)W);
                size_t l = 0;
                while (j >= weights[l].size()) { j -= weights[l].size(); l++; }
                weights[l][j] = (float)((double)weights[l][j] + gaussRand(rng) * sigma);
            }
        }
        return *this;
    }

    /* Row-wise crossover: whole neurons (a row of incoming weights + bias) swap
     * between parents. Swapping individual weights scrambles what each neuron
     * computes; swapping neurons keeps functional units intact.
     *
     * Crossing tanh with a rectifier is meaningless — the same row computes a
     * different function everywhere — so that pairing returns a plain copy of the
     * first parent. ReLU and leaky ReLU DO cross: they agree exactly on the
     * positive side, so a transplanted neuron keeps doing most of its job, and
     * its SLOPE comes with it. A row that is blended rather than copied takes the
     * LEAKIER of the two slopes, because averaging weights from a unit that was
     * allowed to go negative into one that was not is the case where flattening
     * the negative side loses the most. */
    static Net crossover(const Net& a, const Net& b, Rng& rng) {
        Net child = a.clone();
        const bool canMix = a.act != Act::TANH && b.act != Act::TANH;
        if (!canMix && a.act != b.act) return child;
        for (size_t l = 0; l < child.weights.size(); l++) {
            float* wc = child.weights[l].data();
            const float* wb = b.weights[l].data();
            const int rowLen = a.sizes[l] + 1, nOut = a.sizes[l + 1];
            const bool isHidden = l < child.weights.size() - 1;
            float* sc = (isHidden && !child.slopes.empty()) ? child.slopes[l].data() : nullptr;
            const float* sb = (isHidden && !b.slopes.empty()) ? b.slopes[l].data() : nullptr;
            for (int o = 0; o < nOut; o++) {
                const double r = rng();
                if (r < 0.45) {
                    for (int i = 0; i < rowLen; i++) wc[(size_t)o * rowLen + i] = wb[(size_t)o * rowLen + i];
                    if (sc && sb) sc[o] = sb[o];
                } else if (r < 0.52) {
                    for (int i = 0; i < rowLen; i++) {
                        const size_t k = (size_t)o * rowLen + i;
                        wc[k] = (float)(0.5 * ((double)wc[k] + (double)wb[k]));
                    }
                    if (sc && sb) sc[o] = std::max(sc[o], sb[o]);
                }
            }
        }
        return child.relabel();
    }

    /* ------------------------------------------------------------------ json */
    js::ValuePtr toJSON() const {
        auto o = js::Value::makeObj();
        auto sz = js::Value::makeArr();
        for (int s : sizes) sz->push(js::Value::make((double)s));
        o->set("sizes", sz);
        o->set("act", std::string(actName(act)));
        if (slopes.empty()) o->set("slopes", js::Value::makeNull());
        else {
            auto sl = js::Value::makeArr();
            for (auto& s : slopes) sl->push(js::numArray(s.data(), s.size()));
            o->set("slopes", sl);
        }
        auto w = js::Value::makeArr();
        for (auto& l : weights) w->push(js::numArray(l.data(), l.size()));
        o->set("weights", w);
        return o;
    }

    static Net fromJSON(const js::ValuePtr& v) {
        Net n;
        std::vector<int> sz;
        if (auto s = v->get("sizes")) for (auto& e : s->arr) sz.push_back((int)e->num);
        const std::string an = v->strOr("act", "tanh");
        n.init(sz, nullptr, actFromName(an));
        auto w = v->get("weights");
        if (!w) throw std::runtime_error("brain file has no weights");
        for (size_t l = 0; l < n.weights.size() && l < w->arr.size(); l++) {
            auto& src = w->arr[l]->arr;
            for (size_t i = 0; i < n.weights[l].size() && i < src.size(); i++)
                n.weights[l][i] = (float)src[i]->num;
        }
        auto sl = v->get("slopes");
        if (!n.slopes.empty() && sl && sl->type == js::Value::ARR) {
            for (size_t l = 0; l < n.slopes.size() && l < sl->arr.size(); l++) {
                auto& src = sl->arr[l]->arr;
                for (size_t i = 0; i < n.slopes[l].size() && i < src.size(); i++)
                    n.slopes[l][i] = (float)src[i]->num;
            }
            n.relabel();
        }
        return n;
    }

private:
    std::vector<float> buf;   // only for the single-threaded convenience overload
};

