/* NOTE ON THE IIFE WRAPPER AROUND THIS FILE.
 *
 * Every module here is a Node CommonJS file AND is loaded by the page as a
 * plain <script> tag, because these simulations are expected to run from a
 * file:// URL with no server, no bundler and no network. Under Node each file
 * gets its own scope; under a script tag they all share one, and nine files
 * that each begin `const M = ...` and `const DEG = Math.PI/180` collide on the
 * first one and take the rest of the page down with them. The wrapper gives
 * each file its own scope in both worlds. `module` is still visible inside it
 * under Node, so the export at the bottom is unaffected.
 */
;(function () {
/* atmosphere.js — the air the rocket falls through, and the wind that pushes it.
 *
 * Two things live here and they have very different jobs.
 *
 * THE STANDARD ATMOSPHERE is a lookup: density, temperature, pressure and speed
 * of sound as a function of altitude. It is the ISA, piecewise-analytic, good to
 * 32 km, which comfortably covers everything either vehicle does in this sim.
 * Density is the one that matters — it spans a factor of ten between the top of
 * a booster's terminal descent and the pad, which is exactly why a control
 * surface that is nearly useless at the start of the episode is the only thing
 * steering at the end of it. Speed of sound matters because a Super Heavy comes
 * down through Mach 2 and the cross-flow drag of a cylinder very nearly doubles
 * across the transonic band.
 *
 * THE WIND is the reason this task is not a solved control problem. It is
 * written as a PURE FUNCTION of (altitude, time, episode parameters) — no
 * integrator state anywhere — for one specific reason: every fairness claim in
 * this project (common random numbers, paired duels, a reproducible exam bank)
 * requires that re-flying scenario 47 gives bit-identical air. A stateful
 * Ornstein-Uhlenbeck gust generator ticked once per physics step would make the
 * wind depend on how long the vehicle had been alive, so two brains that flew
 * different trajectories through the same scenario would meet different weather
 * and their scores would not be comparable. A frozen-turbulence sum of sinusoids
 * has none of that and costs about the same.
 *
 * The wind model is three layers stacked:
 *   1. a power-law boundary layer that veers with altitude (Ekman-ish),
 *   2. an optional jet — a Gaussian bump in speed at some altitude, which is
 *      what actually kills landings: the vehicle trims for the wind it is in and
 *      then flies out of it in three seconds,
 *   3. frozen turbulence: a handful of spatial modes in altitude that drift past
 *      in time, so a descending vehicle sweeps through them at a rate set by its
 *      own sink rate.
 */
"use strict";

const R_GAS = 287.05287;      // J/(kg·K), dry air
const GAMMA = 1.4;
const G0 = 9.80665;

/* ISA layers: [base altitude m, base temp K, base pressure Pa, lapse K/m] */
const ISA_LAYERS = [
    [0, 288.15, 101325.0, -0.0065],
    [11000, 216.65, 22632.06, 0.0],
    [20000, 216.65, 5474.889, 0.001],
    [32000, 228.65, 868.0187, 0.0028]
];

/* Air state at a geometric altitude. Returns the same object every call — the
 * physics loop calls this a few hundred thousand times per episode and this is
 * the hottest allocation site in the whole program if you let it be one. */
const _air = { rho: 1.225, T: 288.15, p: 101325, a: 340.29 };

function airAt(h) {
    if (h < 0) h = 0;
    if (h > 47000) h = 47000;
    let i = 0;
    while (i < ISA_LAYERS.length - 1 && h >= ISA_LAYERS[i + 1][0]) i++;
    const L = ISA_LAYERS[i];
    const dh = h - L[0], lapse = L[3];
    let T, p;
    if (lapse === 0) {
        T = L[1];
        p = L[2] * Math.exp(-G0 * dh / (R_GAS * T));
    } else {
        T = L[1] + lapse * dh;
        p = L[2] * Math.pow(T / L[1], -G0 / (lapse * R_GAS));
    }
    _air.T = T;
    _air.p = p;
    _air.rho = p / (R_GAS * T);
    _air.a = Math.sqrt(GAMMA * R_GAS * T);
    return _air;
}

/* Gravity falls off measurably over a 12 km descent (0.4%) — irrelevant to the
 * outcome, free to include, and it keeps the energy bookkeeping honest. */
function gravityAt(h) {
    const re = 6371000;
    const r = re / (re + Math.max(0, h));
    return G0 * r * r;
}

/* ------------------------------------------------------------------ wind --- */

/* A wind field is built once per episode from a seeded RNG and then only ever
 * evaluated. All the randomness lives in the constructor. */
class WindField {
    /* `strength` in [0,1] scales the whole field; scenarios use it as the single
     * knob that turns a calm day into a bad one, so the curriculum can ramp
     * weather without re-deciding twelve parameters. */
    constructor(rng, strength) {
        const s = strength == null ? 1 : strength;
        this.strength = s;

        // Boundary layer: speed at the 100 m reference height, and how fast it
        // grows going up. 0.11 is open water, 0.25 is rough terrain; the pad is
        // coastal so we sit near the low end.
        const dir0 = rng() * Math.PI * 2;
        this.uRef = (1.5 + rng() * 11.0) * s;             // m/s at 100 m
        this.alpha = 0.10 + rng() * 0.13;
        this.dir0 = dir0;
        this.veer = (rng() * 2 - 1) * 0.9;                 // rad of direction change per decade of altitude

        // The jet. Half the episodes get one. It is placed low on purpose —
        // a 40 m/s layer at 9 km is a nuisance, the same layer at 700 m is the
        // episode.
        this.jetOn = rng() < 0.55 ? 1 : 0;
        this.jetH = 300 + rng() * 4200;
        this.jetW = 250 + rng() * 900;
        this.jetV = (4 + rng() * 22) * s * this.jetOn;
        this.jetDir = rng() * Math.PI * 2;

        // Frozen turbulence: 5 modes per horizontal axis with wavelengths from
        // 60 m to 2.5 km, drifting in time. The long modes read as slow shear,
        // the short ones as the buffeting a belly-flopping ship actually feels.
        this.modes = [];
        for (let k = 0; k < 5; k++) {
            const lam = 60 * Math.pow(3.1, k * (0.55 + rng() * 0.35));
            // von Karman-ish rolloff: energy falls with wavenumber
            const amp = (0.9 + rng() * 1.5) * s * Math.pow(lam / 400, 0.34);
            this.modes.push({
                lam,
                amp,
                px: rng() * Math.PI * 2,
                py: rng() * Math.PI * 2,
                pz: rng() * Math.PI * 2,
                om: (0.25 + rng() * 1.4) * (rng() < 0.5 ? -1 : 1) / Math.max(1, lam / 120)
            });
        }
        // Vertical gusts are real but much weaker than horizontal ones.
        this.vertScale = 0.35;

        this._out = [0, 0, 0];
    }

    /* Wind velocity in world coordinates (x east, y north, z up), m/s. */
    at(h, t) {
        const o = this._out;
        if (h < 0) h = 0;

        // 1. boundary layer
        const hh = Math.max(h, 2);
        const spd = this.uRef * Math.pow(hh / 100, this.alpha);
        const dir = this.dir0 + this.veer * Math.log10(hh / 100 + 1e-6);
        let wx = spd * Math.cos(dir);
        let wy = spd * Math.sin(dir);

        // 2. jet
        if (this.jetV > 0) {
            const d = (h - this.jetH) / this.jetW;
            const g = Math.exp(-d * d);
            wx += this.jetV * g * Math.cos(this.jetDir);
            wy += this.jetV * g * Math.sin(this.jetDir);
        }

        // 3. frozen turbulence. Gusts die out near the surface (the ground
        // suppresses the large eddies), which matters because otherwise a
        // 15 m/s gust at 20 m altitude makes the final second pure luck.
        let gz = 0;
        const nearGround = Math.min(1, h / 180);
        for (let k = 0; k < this.modes.length; k++) {
            const m = this.modes[k];
            const kk = (2 * Math.PI) / m.lam;
            const a = m.amp * nearGround;
            wx += a * Math.sin(kk * h + m.px + m.om * t);
            wy += a * Math.sin(kk * h * 0.87 + m.py + m.om * t * 1.13);
            gz += a * this.vertScale * Math.sin(kk * h * 1.31 + m.pz + m.om * t * 0.79);
        }

        o[0] = wx; o[1] = wy; o[2] = gz;
        return o;
    }

    /* Peak horizontal speed anywhere in the column, for scenario reporting. */
    peak() {
        let best = 0;
        for (let h = 0; h < 14000; h += 100) {
            const w = this.at(h, 0);
            const s = Math.hypot(w[0], w[1]);
            if (s > best) best = s;
        }
        return best;
    }
}

if (typeof module !== "undefined") {
    module.exports = { airAt, gravityAt, WindField, G0, R_GAS, GAMMA };
}
else {
    window.Atmosphere = { airAt, gravityAt, WindField, G0, R_GAS, GAMMA };
}

})();
