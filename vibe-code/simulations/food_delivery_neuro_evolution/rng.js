// Deterministic RNG utilities shared by every module.
// Ported from the moon lander / chess sims so runs are reproducible from seeds.
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

// Box-Muller gaussian drawing from a supplied uniform rng.
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

// 2D cross product of (ax,ay) x (bx,by).
function cross2(ax, ay, bx, by) { return ax * by - ay * bx; }

function dist2(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
}

// Wrap an angle to (-PI, PI].
function wrapAngle(a) {
    while (a <= -Math.PI) a += 2 * Math.PI;
    while (a > Math.PI) a -= 2 * Math.PI;
    return a;
}

if (typeof module !== 'undefined') {
    module.exports = { mulberry32, gaussian, hash32, mixSeed, clamp, lerp, cross2, dist2, wrapAngle };
}
