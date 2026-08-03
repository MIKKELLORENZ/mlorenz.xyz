/* greens.js — axisymmetric Green's functions for circular current loops.
 *
 * Everything in this simulator that couples one conductor to another goes
 * through this file: coil-to-coil mutual inductance, coil-to-plasma force,
 * plasma-to-sensor flux. All of it is the field of a single circular filament
 * of radius `a` sitting at height `z0`, evaluated at a point (R, Z).
 *
 * ASSUMPTION THAT EVERYTHING RESTS ON: perfect axisymmetry. Every conductor is
 * a circle centred on the machine axis, every field is poloidal, and nothing
 * ever varies with the toroidal angle. That is why a 2-D (R, Z) cross-section
 * is the whole world here. It is also why nothing in this simulator can ever
 * show you a kink mode, a tearing mode, a toroidal field ripple or a locked
 * mode — none of them are axisymmetric, so none of them exist in this geometry.
 */
"use strict";

const MU0 = 4e-7 * Math.PI;

/* Complete elliptic integrals K(m) and E(m), parameter convention m = k²
 * (the same convention as scipy.special.ellipk / ellipe).
 *
 * Arithmetic-geometric mean. Converges quadratically, so ~6 iterations gets
 * double precision anywhere away from m = 1. We are going to call this a few
 * hundred thousand times while building the machine's field tables, so it is
 * worth it being a tight loop with no allocation.
 *
 * ASSUMPTION: m is clamped strictly below 1. m = 1 is the singular case where
 * the evaluation point sits exactly on the loop, and K diverges logarithmically.
 * The callers below soften that by never letting a field point approach a
 * conductor closer than its finite minor radius.
 */
function ellipke(m, out) {
    if (m < 0) m = 0;
    if (m > 1 - 1e-12) m = 1 - 1e-12;
    let a = 1, b = Math.sqrt(1 - m), c = Math.sqrt(m);
    let sum = 0.5 * c * c;      // n = 0 term of Σ 2^(n-1) c_n²
    let pow = 1;                // 2^(n-1) for n = 1
    for (let n = 0; n < 24; n++) {
        const an = 0.5 * (a + b);
        const bn = Math.sqrt(a * b);
        c = 0.5 * (a - b);
        a = an; b = bn;
        sum += pow * c * c;
        pow *= 2;
        if (c < 1e-15) break;
    }
    const K = Math.PI / (2 * a);
    out[0] = K;
    out[1] = K * (1 - sum);
    return out;
}

const _ke = [0, 0];

/* Poloidal flux Ψ = 2πR·A_φ linked at (R, Z) by a unit current in a circular
 * loop of radius `a` at height `z0`. Units: Wb per ampere, i.e. this IS the
 * mutual inductance between the source loop and a hypothetical loop through
 * the field point.
 *
 * ASSUMPTION: filamentary conductors — zero cross-section. Real coils have a
 * winding pack ~5 cm across, so this over-estimates the coupling of anything
 * that gets very close. `rc` is the softening radius that stands in for that
 * finite cross-section; inside it the point is pushed back out to the surface
 * of the conductor, which is the right answer for the field OUTSIDE a uniform
 * current tube and a defensible lie inside it.
 */
function loopPsi(a, z0, R, Z, rc) {
    let dr = R - a, dz = Z - z0;
    const d2 = dr * dr + dz * dz;
    if (rc > 0 && d2 < rc * rc) {
        const d = Math.sqrt(d2) || 1e-9;
        const s = rc / d;
        dr *= s; dz *= s;
        R = a + dr; Z = z0 + dz;
    }
    if (R < 1e-6) return 0;
    const sum = (a + R) * (a + R) + dz * dz;
    const m = 4 * a * R / sum;
    const k = Math.sqrt(m);
    if (k < 1e-12) return 0;
    ellipke(m, _ke);
    return MU0 * Math.sqrt(a * R) * ((2 / k - k) * _ke[0] - (2 / k) * _ke[1]);
}

/* Poloidal field (B_R, B_Z) at (R, Z) from a unit current in the same loop.
 * Written into `out`. Same softening story as loopPsi.
 *
 * ASSUMPTION: vacuum. There is no iron core anywhere in this machine, so μ = μ0
 * everywhere and superposition holds exactly. TCV is an air-core machine so
 * this one is actually fair; on an iron-core tokamak it would be badly wrong.
 */
function loopField(a, z0, R, Z, rc, out) {
    let dr = R - a, dz = Z - z0;
    const d2 = dr * dr + dz * dz;
    if (rc > 0 && d2 < rc * rc) {
        const d = Math.sqrt(d2) || 1e-9;
        const s = rc / d;
        dr *= s; dz *= s;
        R = a + dr; Z = z0 + dz;
    }
    if (R < 1e-6) { out[0] = 0; out[1] = 0; return out; }
    const sum = (a + R) * (a + R) + dz * dz;
    const dif = (a - R) * (a - R) + dz * dz;
    const m = 4 * a * R / sum;
    ellipke(m, _ke);
    const K = _ke[0], E = _ke[1];
    const den = Math.sqrt(sum);
    const c = MU0 / (2 * Math.PI);
    out[1] = c / den * (K + E * (a * a - R * R - dz * dz) / dif);
    out[0] = c * dz / (R * den) * (-K + E * (a * a + R * R + dz * dz) / dif);
    return out;
}

/* Mutual inductance between two coaxial circular loops. Symmetric by
 * construction, which the test suite checks — an asymmetric inductance matrix
 * is not merely inelegant, it makes the circuit solve non-conservative and the
 * whole thing quietly gains or loses energy. */
function mutual(a1, z1, a2, z2, rc) {
    return loopPsi(a1, z1, a2, z2, rc);
}

/* Self-inductance of a circular loop of major radius `a` made of conductor of
 * minor radius `rc`, with N turns.
 *
 * ASSUMPTION: uniform current density in the conductor (the -7/4 form). A real
 * winding pack is neither circular nor uniform, and a real vessel segment is a
 * rectangular strip, so this is good to maybe 10-20%. It sets the L/R time
 * constants, so a 20% error here is a 20% error in how fast the coils respond —
 * which is exactly the sort of thing the domain randomisation in the training
 * loop is there to cover.
 */
function selfInductance(a, rc, turns) {
    const N = turns || 1;
    return N * N * MU0 * a * (Math.log(8 * a / rc) - 1.75);
}

if (typeof module !== "undefined") {
    module.exports = { MU0, ellipke, loopPsi, loopField, mutual, selfInductance };
}
