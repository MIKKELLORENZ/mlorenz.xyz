/* rng.hpp — mulberry32, bit-for-bit with the JS original.
 *
 * This is the one place in the port where "close enough" is not close enough.
 * Every fairness property in this simulation rests on the environment being a
 * pure function of (missionSeed, noiseSeed): the same terrain, the same gusts,
 * the same shove at the same instant, the same stream of sensor noise for every
 * walker. If the C++ stream diverges from the JS one by a single draw, the two
 * builds stop simulating the same universe and no comparison between them means
 * anything — which would cost the oracle harness that the whole port is validated
 * against.
 *
 * The JS is:
 *     a |= 0; a = (a + 0x6D2B79F5) | 0;
 *     let t = Math.imul(a ^ (a >>> 15), 1 | a);
 *     t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
 *     return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 *
 * `|0` reinterprets as int32, `>>>` as uint32, and Math.imul is a 32-bit
 * truncating multiply. All three are the identity on uint32 arithmetic mod 2^32,
 * so plain uint32_t reproduces it exactly — no casting dance required.
 */
#pragma once
#include <cstdint>
#include <cmath>

struct Rng {
    uint32_t a;
    /* Box-Muller produces two gaussians at a time. The spare lives ON THE STREAM
     * and not at file scope, which is not a style preference: a module-level
     * spare made `--seed` a lie in the JS, because what a given seed produced
     * depended on how many gaussians anything else in the process had drawn
     * first. Two identical runs in one process diverged. Same trap in C++, worse,
     * because the threads here are real. */
    double spare = 0;
    bool haveSpare = false;

    Rng() : a(0) {}
    explicit Rng(uint32_t seed) : a(seed) {}

    inline double operator()() {
        a += 0x6D2B79F5u;
        uint32_t t = a;
        t = (t ^ (t >> 15)) * (1u | a);
        t = ((t + ((t ^ (t >> 7)) * (61u | t))) ^ t);
        return (double)(t ^ (t >> 14)) / 4294967296.0;
    }
    inline void reseed(uint32_t seed) { a = seed; haveSpare = false; spare = 0; }
};

inline double gaussRand(Rng& r) {
    if (r.haveSpare) { r.haveSpare = false; return r.spare; }
    double u = 0, v = 0;
    while (u == 0) u = r();
    while (v == 0) v = r();
    const double m = std::sqrt(-2.0 * std::log(u));
    r.spare = m * std::sin(2.0 * 3.141592653589793 * v);
    r.haveSpare = true;
    return m * std::cos(2.0 * 3.141592653589793 * v);
}

/* Bounded, stateless approximate gaussian, used for sensor and actuator noise.
 * Stateless matters here for the same reason the spare above is per-stream:
 * walkers interleave, and sharing a cached spare between them would cross their
 * noise streams and quietly break the rule that every walker hears the identical
 * disturbance. */
inline double nrand(Rng& r) { return (r() + r() + r() - 1.5) * 1.1547; }
