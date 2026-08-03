// Deterministic RNG utilities shared by every module.
// Ported from the traffic-light / food-delivery sims so runs replay exactly
// from a seed, with the distributions this sim needs bolted on: the clearness
// index of a sky is beta-distributed, wind speed is Weibull, and load noise is
// an Ornstein-Uhlenbeck process. All three are drawn from the supplied uniform
// stream and nothing caches state at module level.
'use strict';

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Box-Muller. The spare value is deliberately NOT cached in a module-level
// variable: a shared spare leaks state between independently seeded streams and
// silently breaks --seed reproducibility (a trap the 3D-walk trainer hit).
function gaussian(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function hash32(x) {
    x = (x ^ 61) ^ (x >>> 16);
    x = (x + (x << 3)) | 0;
    x = x ^ (x >>> 4);
    x = Math.imul(x, 0x27d4eb2d);
    x = x ^ (x >>> 15);
    return x >>> 0;
}

function mixSeed(a, b, c, d) {
    let h = hash32(a >>> 0);
    h = hash32(h ^ Math.imul(b >>> 0, 0x9E3779B1));
    if (c !== undefined) h = hash32(h ^ Math.imul(c >>> 0, 0x85EBCA77));
    if (d !== undefined) h = hash32(h ^ Math.imul(d >>> 0, 0xC2B2AE3D));
    return h >>> 0;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

// Marsaglia-Tsang gamma, the standard building block for a beta draw. Only used
// at episode setup and once per weather step, so speed does not matter; the
// shape-below-one branch matters because sky clearness genuinely has beta
// parameters under one on an overcast site.
function gammaDraw(rng, shape) {
    if (shape < 1) {
        const u = Math.max(1e-12, rng());
        return gammaDraw(rng, shape + 1) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let i = 0; i < 64; i++) {
        let x, v;
        do { x = gaussian(rng); v = 1 + c * x; } while (v <= 0);
        v = v * v * v;
        const u = Math.max(1e-12, rng());
        if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
    }
    return d;
}

function betaDraw(rng, a, b) {
    const x = gammaDraw(rng, a);
    const y = gammaDraw(rng, b);
    return x / Math.max(1e-12, x + y);
}

// --- normal <-> uniform, for correlated non-normal series -------------------
// An AR(1) process is easy to write in gaussian space and impossible to write
// directly in Weibull or beta space. The trick used throughout weather.js is to
// run the memory in gaussian space and push it through the normal CDF into a
// uniform, then through the target inverse CDF. The marginal comes out exactly
// Weibull/beta and the autocorrelation comes out where it was asked for.
function erf(x) {
    // Abramowitz & Stegun 7.1.26, |eps| < 1.5e-7 - far tighter than anything
    // the sampled quantities are known to.
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
        - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
}
function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

// Acklam's rational approximation to the inverse normal CDF.
function normInv(p) {
    p = clamp(p, 1e-12, 1 - 1e-12);
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
        1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
        6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
        -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
        3.754408661907416e+00];
    const pl = 0.02425;
    let q, r;
    if (p < pl) {
        q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) {
        q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Inverse Weibull CDF: F(v) = 1 - exp(-(v/c)^k).
function weibullInv(u, k, c) {
    u = clamp(u, 1e-9, 1 - 1e-9);
    return c * Math.pow(-Math.log(1 - u), 1 / k);
}

// Inverse beta by bisection on the regularised incomplete beta. Twenty-eight
// halvings gets 4e-9, which is well past the resolution of a cloud.
function betaCdf(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Continued fraction (Lentz) for the regularised incomplete beta function.
    const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
    let f = 1, c = 1, d = 0;
    for (let i = 0; i <= 220; i++) {
        const m = i >> 1;
        let num;
        if (i === 0) num = 1;
        else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
        else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
        d = 1 + num * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        d = 1 / d;
        c = 1 + num / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        const cd = c * d;
        f *= cd;
        if (Math.abs(1 - cd) < 1e-10) break;
    }
    const v = front * (f - 1);
    // The continued fraction converges fast for x < (a+1)/(a+b+2) and slowly on
    // the other side, where the symmetry relation is used instead.
    if (x > (a + 1) / (a + b + 2)) return 1 - betaCdf(1 - x, b, a);
    return clamp(v, 0, 1);
}

function lgamma(z) {
    const g = 7;
    const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    let x = p[0];
    for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaInv(u, a, b) {
    u = clamp(u, 1e-9, 1 - 1e-9);
    let lo = 0, hi = 1;
    for (let i = 0; i < 28; i++) {
        const mid = 0.5 * (lo + hi);
        if (betaCdf(mid, a, b) < u) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
}

if (typeof module !== 'undefined') {
    module.exports = {
        mulberry32, gaussian, hash32, mixSeed, clamp, lerp,
        gammaDraw, betaDraw, erf, normCdf, normInv, weibullInv,
        betaCdf, betaInv, lgamma
    };
}
