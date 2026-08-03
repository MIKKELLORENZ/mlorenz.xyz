/* terrain.hpp — the ground, as an analytic height field y = h(x, z).
 *
 * A height field (rather than a pile of collision boxes) is what makes terrain
 * cheap: every contact query is a closed-form evaluation, the surface normal is
 * an exact derivative, and the same numbers feed the walker's foveal height
 * patches. The price is that the surface has to stay single-valued, so stair
 * risers are modelled as very steep short ramps (~70 degrees) instead of true
 * vertical faces. That is a deliberate trade: a vertical wall in a height field
 * launches a toe-stubbing foot straight up, which teaches the population nonsense.
 *
 * Every terrain takes a `difficulty` in 0..1 — the curriculum turns this knob, so
 * the same terrain starts as a barely-perceptible undulation and grows into
 * something that needs real foot placement.
 *
 * NOTE: raycast() from the JS is not ported. The LiDAR it served was replaced by
 * the foot-referenced patches and the lateral fan, and nothing in the training
 * path calls it any more; carrying dead code across a port is how a second source
 * of truth gets started.
 *
 * PERFORMANCE. `sample` and `height` were 6.8% of runtime in the JS profile and
 * are called far more often than that suggests — 50 foveal cells plus 20 fan
 * points plus 4 normal probes per control tick, and once per contact point per
 * physics tick. They are marked hot and kept branch-light.
 */
#pragma once
#include <cmath>
#include <string>
#include "rng.hpp"

enum class TerrainId { FLAT, ROLLING, STAIRS, MIXED };

inline const char* terrainName(TerrainId t) {
    switch (t) {
        case TerrainId::ROLLING: return "rolling";
        case TerrainId::STAIRS:  return "stairs";
        case TerrainId::MIXED:   return "mixed";
        default:                 return "flat";
    }
}

class Terrain {
public:
    TerrainId id = TerrainId::FLAT;
    double difficulty = 0;
    double maxSlope = 0, lx = 0, lz = 0, ax = 0, az = 0, phx = 0, phz = 0;
    double rise = 0, tread = 0.34, riserW = 0, x0 = 0.6, flight = 0, landing = 1.3, period = 0;
    int steps = 0;
    bool hasRoll = false, hasStairs = false;
    double maxGrad = 0, mu = 0.85, restitutionDamp = 1.0;

    Terrain() = default;

    /* difficulty 0..1; `r` supplies per-episode variation and is drawn in exactly
     * the order the JS draws it — lx, lz, phx, phz, mu — because the whole
     * fairness argument rests on the two builds seeing the same stream. */
    Terrain(TerrainId tid, double diff, Rng& r) {
        id = tid;
        difficulty = std::max(0.0, std::min(1.0, diff));
        const double d = difficulty;

        // rolling: two long waves. Max |dh/dx| of a·sin(x/L) is a/L, so the
        // amplitude is derived from the slope we actually want, never guessed.
        maxSlope = std::tan((1 + 8*d) * 3.141592653589793 / 180.0);   // 1 deg -> 9 deg
        lx = 5.0 + 3.0 * r();
        lz = 6.0 + 3.0 * r();
        ax = maxSlope * lx * 0.6;
        az = maxSlope * lz * 0.4;
        phx = r() * 6.283;
        phz = r() * 6.283;

        /* Both the step height AND the number of steps scale with difficulty.
         * With a fixed 5 steps and a 0.06 m floor on the rise, the gentlest
         * setting still built a 0.36 m flight — knee-high on a body whose hip
         * stands at 0.84 m — so "difficulty 0.12" was not gentle at all. */
        rise = 0.02 + 0.13 * d;
        tread = 0.34;
        riserW = std::min(0.075, rise * 0.55);            // ~62-70 degree riser ramp
        steps = (int)std::max(2.0, std::floor(2 + 3*d + 0.5));
        /* Half-width of the flat pad around the spawn. It was 1.8 m, and that
         * alone made the staircase unreachable: the fleet's mean walked distance
         * is 0.65 m, so the average walker ran out of episode before the first
         * riser existed. A skill nothing in the population can reach cannot be
         * selected for. */
        x0 = 0.6;
        flight = steps * tread;
        landing = 1.3;
        period = 2*flight + 2*landing;

        hasRoll = (id == TerrainId::ROLLING || id == TerrainId::MIXED);
        hasStairs = (id == TerrainId::STAIRS || id == TerrainId::MIXED);
        if (id == TerrainId::MIXED) { ax *= 0.6; az *= 0.6; rise *= 0.8; }

        maxGrad = 0;
        if (hasRoll) maxGrad += ax/lx + az/lz;
        if (hasStairs) maxGrad += rise/riserW;

        // Coulomb friction. Domain randomisation nudges it per episode so a gait
        // that only works on one exact surface does not survive selection.
        mu = 0.85 + (r() - 0.5) * 0.25;
        restitutionDamp = 1.0;
    }

    /* Staircase profile along x: [height, dh/dx].
     *
     * Mirrored about the spawn, with a flat pad in the middle. It used to extend
     * only towards +X, and because startYaw is drawn uniformly over +/-pi, roughly
     * half of every stair course wandered off into ground that was permanently
     * flat — the waypoints looked like they only appeared on the level, because
     * for that episode the level was all there was. */
    inline void stairs(double x, double& h, double& g) const {
        const double s = x < 0 ? -1.0 : 1.0;      // profile is even in x, slope is odd
        const double u = std::fabs(x) - x0;
        if (u < 0) { h = 0; g = 0; return; }
        const double p = std::fmod(u, period);
        const double top = steps * rise;
        if (p < flight) {                                              // climbing
            const double k = std::floor(p / tread);
            const double local = p - k*tread;
            if (local < riserW) { h = (k + local/riserW) * rise; g = rise/riserW; }
            else { h = (k + 1) * rise; g = 0; }
        } else if (p < flight + landing) {                             // top landing
            h = top; g = 0;
        } else if (p < 2*flight + landing) {                           // descending
            const double q = p - flight - landing;
            const double k = std::floor(q / tread);
            const double local = q - k*tread;
            const double treadTop = top - k*rise;
            if (local > tread - riserW) {
                const double f = (local - (tread - riserW)) / riserW;
                h = treadTop - f*rise; g = -rise/riserW;
            } else { h = treadTop; g = 0; }
        } else {                                                       // bottom landing
            h = 0; g = 0;
        }
        // Chain rule for the mirror: h(|x|) is even, so dh/dx flips sign with x.
        g *= s;
    }

    /* out = [height, nx, ny, nz]. The normal comes from the analytic gradient. */
    inline void sample(double x, double z, double* out) const {
        double h = 0, gx = 0, gz = 0;
        if (hasRoll) {
            h  += ax * std::sin(x/lx + phx) + az * std::sin(z/lz + phz);
            gx += (ax/lx) * std::cos(x/lx + phx);
            gz += (az/lz) * std::cos(z/lz + phz);
        }
        if (hasStairs) { double sh, sg; stairs(x, sh, sg); h += sh; gx += sg; }
        const double inv = 1.0 / std::sqrt(gx*gx + 1 + gz*gz);
        out[0] = h; out[1] = -gx*inv; out[2] = inv; out[3] = -gz*inv;
    }

    /* Height only, skipping the normal. sample() spends a sqrt and a divide
     * normalising a gradient most callers never look at, and the foveal patches
     * alone call this 50 times per control tick per walker. */
    inline double height(double x, double z) const {
        double h = 0;
        if (hasRoll) h += ax * std::sin(x/lx + phx) + az * std::sin(z/lz + phz);
        if (hasStairs) { double sh, sg; stairs(x, sh, sg); h += sh; }
        return h;
    }
};
