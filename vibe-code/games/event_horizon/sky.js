/* sky.js — what you would actually see out of the window.
 *
 * The map is a chart. This is the photograph: where each star appears, how
 * bright and what colour, to somebody at radius r. It is ray-traced, not
 * faked — every star is put where a null geodesic of the Schwarzschild metric
 * says its light arrives from — but it is cheap, because of two symmetries:
 *
 *   • A light ray stays in the plane through the hole's centre, and its shape
 *     in that plane is one ODE,  u'' = −u + (3/2) rs u²  with u = 1/r.
 *   • Around the line from the observer to the hole everything is symmetric,
 *     so the whole sky is described by ONE function: look at angle α away from
 *     the hole, and the light you catch came from a direction ψ(α) on the true
 *     sky. Bending shows up as ψ ≠ π − α.
 *
 * skyMap() tabulates ψ(α) for the current radius (a couple of hundred rays),
 * and every star is then placed by inverting that table. The second image of
 * a star — light that went round the far side of the hole — is the same table
 * read at 2π − ψ. Together they pile up into the Einstein ring.
 *
 * WHOSE EYES. Angles here are measured by an observer falling with the river
 * (dropped from rest far away). That frame exists on both sides of the
 * horizon, which a hovering observer's does not, so the view carries straight
 * on through it. The ship's own motion relative to the river is then one
 * ordinary special-relativistic aberration, applied by aberrate().
 *
 * For a ray arriving at angle α from the hole's direction, as seen from the
 * river at radius r (β = sqrt(rs/r)):
 *
 *     impact parameter   b = r sin α / (1 − β cos α)
 *     colour shift       ν_seen / ν_far = 1 / (1 − β cos α)
 *
 * and the shadow is every direction whose ray, followed backwards, never
 * reaches the outside world: b below the critical (3√3/2) rs on the inward
 * side. At the horizon that is a disc 42° in radius — not the whole sky, which
 * is what a HOVERING observer there would see. Falling in, the universe does
 * not close up behind you.
 */
"use strict";

const SKY_BCRIT = 1.5 * Math.sqrt(3);
const SKY_K = 15;            // rays are log-spaced toward the shadow's edge; e^-15 of the range is the closest
const SKY_MAX_SWEEP = 5 * Math.PI;

/* Angular radius of the shadow, from the hole's direction, for the falling
 * observer at r. Solves r sin α = b_c (1 − β cos α) on the correct branch:
 * outside the photon sphere the critical ray is heading inward, inside it the
 * critical ray is heading outward. */
function shadowAngle(rs, r) {
    if (!(rs > 0)) return 0;
    const bc = SKY_BCRIT * rs;
    const beta = Math.sqrt(rs / r);
    const A = Math.sqrt(r * r + bc * bc * beta * beta);
    const delta = Math.atan2(bc * beta, r);
    const base = Math.asin(Math.min(1, bc / A));
    return r >= 1.5 * rs ? base - delta : Math.PI - base - delta;
}

/* Follow one ray backwards from the observer until it leaves for infinity,
 * and return the total angle it swept around the hole. */
function traceBack(rs, r, alpha) {
    const beta = Math.sqrt(rs / r);
    const sa = Math.sin(alpha);
    if (sa < 1e-9) return alpha > 1 ? 0 : SKY_MAX_SWEEP;
    const u0 = 1 / r;
    let u = u0, v = (Math.cos(alpha) - beta) / (r * sa), phi = 0;
    const lim = Math.max(u0, 1 / rs) * 1.02;
    for (let i = 0; i < 6000; i++) {
        /* Nearly radial rays cross from u0 to 0 in a sliver of angle, so the
         * step is tied to how fast u is changing as well as to the orbit. */
        let h = 0.02;
        const av = Math.abs(v);
        if (av > 1e-12) h = Math.min(h, 0.05 * u0 / av);
        const k1u = v,              k1v = -u + 1.5 * rs * u * u;
        const u2 = u + 0.5 * h * k1u, v2 = v + 0.5 * h * k1v;
        const k2u = v2,             k2v = -u2 + 1.5 * rs * u2 * u2;
        const u3 = u + 0.5 * h * k2u, v3 = v + 0.5 * h * k2v;
        const k3u = v3,             k3v = -u3 + 1.5 * rs * u3 * u3;
        const u4 = u + h * k3u,     v4 = v + h * k3v;
        const k4u = v4,             k4v = -u4 + 1.5 * rs * u4 * u4;
        const un = u + h * (k1u + 2 * k2u + 2 * k3u + k4u) / 6;
        const vn = v + h * (k1v + 2 * k2v + 2 * k3v + k4v) / 6;
        if (un <= 0) return phi + h * u / (u - un);      // escaped: finish the last step linearly
        u = un; v = vn; phi += h;
        if (u > lim || phi > SKY_MAX_SWEEP) return SKY_MAX_SWEEP;
    }
    return SKY_MAX_SWEEP;
}

/* The table ψ(α) at radius r. alpha ascends from just outside the shadow to π
 * (looking straight away from the hole); psi descends to 0. */
function skyMap(rs, r, n) {
    n = n || 180;
    const m = {
        rs: rs, r: r, n: n, flat: !(rs > 0) || rs / r < 1e-5,
        shadow: 0, span: Math.PI, beta: rs > 0 ? Math.sqrt(rs / r) : 0,
        alpha: new Float64Array(n), psi: new Float64Array(n)
    };
    if (m.flat) {
        m.beta = 0;
        for (let i = 0; i < n; i++) { m.alpha[i] = Math.PI * i / (n - 1); m.psi[i] = Math.PI - m.alpha[i]; }
        return m;
    }
    m.shadow = shadowAngle(rs, r);
    m.span = Math.PI - m.shadow;
    for (let i = 0; i < n; i++) {
        const s = i / (n - 1);
        m.alpha[i] = m.shadow + m.span * Math.exp(-SKY_K * (1 - s));
        m.psi[i] = i === n - 1 ? 0 : traceBack(rs, r, m.alpha[i]);
    }
    /* Round-off at the very edge can leave the first few entries out of order;
     * the table has to be strictly monotonic to be inverted. */
    for (let i = n - 2; i >= 0; i--) if (!(m.psi[i] > m.psi[i + 1])) m.psi[i] = m.psi[i + 1] + 1e-9;
    return m;
}

/* ψ for a given α, by interpolation. */
function skyLookup(m, alpha) {
    if (m.flat) return Math.PI - alpha;
    if (alpha <= m.alpha[0]) return m.psi[0];
    const s = 1 + Math.log((alpha - m.shadow) / m.span) / SKY_K;      // fractional index / (n − 1)
    const f = Math.min(m.n - 1.000001, Math.max(0, s * (m.n - 1)));
    const i = Math.floor(f), t = f - i;
    return m.psi[i] + t * (m.psi[i + 1] - m.psi[i]);
}

/* α for a given ψ: where on the sky a star at true angle ψ shows up. Near the
 * edge ψ is linear in log(α − shadow), which is exactly how the table is
 * spaced, so the interpolation is done in the index and converted after.
 * Returns NaN for ψ beyond the last tabulated winding. */
function skyInverse(m, psi) {
    if (m.flat) return Math.PI - psi;
    const p = m.psi, n = m.n;
    if (psi > p[0]) return NaN;
    if (psi <= 0) return Math.PI;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (p[mid] >= psi) lo = mid; else hi = mid;
    }
    const t = (p[lo] - psi) / (p[lo] - p[hi]);
    const s = (lo + t) / (n - 1);
    return m.shadow + m.span * Math.exp(-SKY_K * (1 - s));
}

/* Where one star appears. s = its true direction (unit 3-vector; the orbital
 * plane is z = 0), (nx, ny) = the observer's outward radial direction.
 * Writes up to two images into out as [x, y, z, magnification, colour shift]
 * each and returns how many there are. Directions are in the river frame. */
function skyImages(m, nx, ny, sx, sy, sz, out) {
    const c = Math.max(-1, Math.min(1, sx * nx + sy * ny));
    const psi = Math.acos(c);
    const sp = Math.sqrt(Math.max(1e-12, 1 - c * c));
    // unit vector across the line of sight to the hole, towards the star
    const ex = (sx - c * nx) / sp, ey = (sy - c * ny) / sp, ez = sz / sp;
    let count = 0;
    for (let k = 0; k < 2; k++) {
        /* A second image needs the light bent by more than the star's angle
         * from the far side. For a star on the observer's own side of the sky
         * that is over 90 degrees, and the image is thousands of times fainter
         * than the first: not worth the lookups. */
        if (k === 1 && psi < 1.35) break;
        const target = k === 0 ? psi : 2 * Math.PI - psi;
        const a = skyInverse(m, target);
        if (!(a === a)) continue;
        let mag = 1;
        if (!m.flat) {
            const e = 0.004;
            const a1 = skyInverse(m, Math.max(1e-6, target - e)), a2 = skyInverse(m, target + e);
            if (a1 === a1 && a2 === a2) {
                /* solid angle of the image over solid angle of the source */
                mag = Math.abs(Math.sin(a) * (a1 - a2) / (2 * e)) / Math.max(1e-4, sp);
            } else mag = 0;
        }
        const sgn = k === 0 ? 1 : -1;
        const ca = Math.cos(a), sa = Math.sin(a);
        const o = 5 * count;
        out[o] = -ca * nx + sgn * sa * ex;
        out[o + 1] = -ca * ny + sgn * sa * ey;
        out[o + 2] = sgn * sa * ez;
        out[o + 3] = mag;
        out[o + 4] = 1 / (1 - m.beta * ca);
        count++;
        if (m.flat) break;
    }
    return count;
}

/* Special-relativistic aberration. d = unit vector TOWARDS a source, as seen
 * in a frame in which the observer moves with velocity v (in the plane).
 * Writes the direction the observer sees, and returns the Doppler factor. */
function aberrate(dx, dy, dz, vx, vy, out) {
    const v2 = vx * vx + vy * vy;
    if (v2 < 1e-14) { out[0] = dx; out[1] = dy; out[2] = dz; return 1; }
    const g = 1 / Math.sqrt(1 - v2);
    const dv = dx * vx + dy * vy;
    const den = 1 + dv;
    /* d' = [ d/γ + v̂((d·v̂)(1 − 1/γ) + |v|) ] / (1 + d·v) */
    const f = (dv * (1 - 1 / g) / v2 + 1);
    out[0] = (dx / g + vx * f) / den;
    out[1] = (dy / g + vy * f) / den;
    out[2] = (dz / g) / den;
    return g * den;
}

/* ------------------------------------------------------------ the star field */

function skyRng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* A fixed catalogue: a uniform scatter, plus a denser band tilted out of the
 * orbital plane so that there is a recognisable structure for the hole to
 * bend. Deterministic, so every player sees the same sky. */
function makeStars(nField, nBand, seed) {
    const rnd = skyRng(seed || 20260920);
    const stars = [];
    const tints = [
        [155, 176, 255], [170, 191, 255], [202, 215, 255], [248, 247, 255],
        [255, 244, 234], [255, 210, 161], [255, 187, 120]
    ];
    const pick = function () {
        const u = rnd();
        return tints[u < 0.04 ? 0 : u < 0.12 ? 1 : u < 0.3 ? 2 : u < 0.52 ? 3 : u < 0.74 ? 4 : u < 0.9 ? 5 : 6];
    };
    const gauss = function () { return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()); };
    for (let i = 0; i < nField; i++) {
        const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), q = Math.sqrt(1 - z * z);
        stars.push({ x: q * Math.cos(a), y: q * Math.sin(a), z: z, mag: Math.pow(rnd(), 3.2), tint: pick() });
    }
    // Band: a great circle tilted 58° about the x axis, 7° thick.
    const tilt = 58 * Math.PI / 180, ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let i = 0; i < nBand; i++) {
        const a = 2 * Math.PI * rnd(), lat = gauss() * 0.12;
        const x = Math.cos(lat) * Math.cos(a), y0 = Math.cos(lat) * Math.sin(a), z0 = Math.sin(lat);
        stars.push({ x: x, y: y0 * ct - z0 * st, z: y0 * st + z0 * ct, mag: 0.55 * Math.pow(rnd(), 2.4), tint: pick(), band: true });
    }
    return stars;
}

if (typeof module !== "undefined") {
    module.exports = { SKY_BCRIT, shadowAngle, traceBack, skyMap, skyLookup, skyInverse, skyImages, aberrate, skyRng, makeStars };
}
