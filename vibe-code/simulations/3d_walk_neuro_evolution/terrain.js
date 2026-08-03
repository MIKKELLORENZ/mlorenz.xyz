/* terrain.js — the ground, as an analytic height field y = h(x, z).
 *
 * A height field (rather than a pile of collision boxes) is what makes stage 4
 * cheap: every contact query is a closed-form evaluation, the surface normal is
 * an exact derivative, and the same four numbers feed the walker's foot-level
 * "terrain probe" sensor. The price is that the surface has to stay
 * single-valued, so stair risers are modelled as very steep short ramps (~70°)
 * instead of true vertical faces. That is a deliberate trade: a vertical wall in
 * a height field launches a toe-stubbing foot straight up, which teaches the
 * population nonsense.
 *
 * Every terrain takes a `difficulty` in 0..1 — the curriculum turns this knob,
 * so the same terrain starts as a barely-perceptible undulation and grows into
 * something that needs real foot placement.
 */
"use strict";

const TERRAIN_DEFS = [
    { id: "flat", name: "Flat", desc: "Level ground. Nothing trains here any more — kept for tests and A/Bs." },
    /* Not a surface: World reads this and draws one of the three real ones per
     * episode. Training on a single terrain produces a brain that specialises on
     * it, which is how the fleet ended up walking 6.75 waypoints on the flat and
     * 0.83 on anything else. */
    { id: "varied", name: "Varied", desc: "A different surface every episode — undulation, stairs, or both." },
    { id: "rolling", name: "Rolling", desc: "Long, gentle undulation — up to ~9° at full difficulty." },
    { id: "stairs", name: "Stairs", desc: "Flights up and down, 6–15 cm rise, 34 cm tread." },
    { id: "mixed", name: "Mixed", desc: "Undulation with a staircase crossing it." }
];

class Terrain {
    /* difficulty 0..1; rng is a mulberry32-style function for per-episode variation */
    constructor(id, difficulty, rng) {
        this.id = id;
        this.difficulty = Math.max(0, Math.min(1, difficulty));
        const d = this.difficulty;
        const r = rng || (() => 0.5);

        // rolling: two long waves. Max |dh/dx| of a·sin(x/L) is a/L, so the
        // amplitude is derived from the slope we actually want, never guessed.
        this.maxSlope = Math.tan((1 + 8 * d) * Math.PI / 180);      // 1° -> 9°
        this.lx = 5.0 + 3.0 * r();
        this.lz = 6.0 + 3.0 * r();
        this.ax = this.maxSlope * this.lx * 0.6;
        this.az = this.maxSlope * this.lz * 0.4;
        this.phx = r() * 6.283;
        this.phz = r() * 6.283;

        // stairs: a flight up, a landing, a flight down, repeating along +X
        /* Both the step height AND the number of steps scale with difficulty.
         * With a fixed 5 steps and a 0.06 m floor on the rise, the gentlest
         * setting still built a 0.36 m flight — knee-high on a body whose hip
         * stands at 0.84 m — so "difficulty 0.12" was not gentle at all, it was
         * a short staircase. Now the low end is a couple of shallow steps and
         * full difficulty is the same five-step flight as before. */
        this.rise = 0.02 + 0.13 * d;
        this.tread = 0.34;
        this.riserW = Math.min(0.075, this.rise * 0.55);            // ~62–70° riser ramp
        this.steps = Math.max(2, Math.round(2 + 3 * d));
        /* Half-width of the flat pad around the spawn. It was 1.8 m, and that
         * alone made the staircase unreachable: the fleet's mean walked distance
         * is 0.65 m, so the average walker ran out of episode before the first
         * riser existed, and only a champion on a good run ever saw one. A
         * skill nothing in the population can reach cannot be selected for.
         * 0.6 m still leaves a step or two to find its feet on. */
        this.x0 = 0.6;
        this.flight = this.steps * this.tread;
        this.landing = 1.3;
        this.period = 2 * this.flight + 2 * this.landing;

        this.hasRoll = id === "rolling" || id === "mixed";
        this.hasStairs = id === "stairs" || id === "mixed";
        if (id === "mixed") { this.ax *= 0.6; this.az *= 0.6; this.rise *= 0.8; }

        /* Steepest gradient anywhere on this surface. The LiDAR raycast is a
         * sphere trace, and a sphere trace is only correct if it knows a true
         * upper bound on |dh/dx| — step further than the surface can rise in
         * that distance and a ray tunnels straight through a stair riser. So
         * this is derived from the same numbers that build the surface rather
         * than picked, and it updates itself if those ever change. */
        this.maxGrad = 0;
        if (this.hasRoll) this.maxGrad += this.ax / this.lx + this.az / this.lz;
        if (this.hasStairs) this.maxGrad += this.rise / this.riserW;

        // Coulomb friction. Domain randomisation nudges it per episode so a gait
        // that only works on one exact surface does not survive selection.
        this.mu = 0.85 + (r() - 0.5) * 0.25;
        this.restitutionDamp = 1.0;
    }

    /* Staircase profile along x: returns [height, dh/dx].
     *
     * Mirrored about the spawn, with a flat pad in the middle. It used to start
     * at x0 = +3.0 and extend only towards +X, and because startYaw is drawn
     * uniformly over +/-pi, roughly half of every stair course wandered off into
     * ground that was permanently flat — the waypoints looked like they only
     * appeared on the level, because for that episode the level was all there
     * was. Mirroring means any course with an X component meets a flight, from
     * whichever way the walker happens to be facing.
     *
     * The pad stays: the walker still gets a couple of metres of level ground to
     * find its feet on before the first riser. */
    _stairs(x, out) {
        const s = x < 0 ? -1 : 1;               // profile is even in x, slope is odd
        const u = Math.abs(x) - this.x0;
        if (u < 0) { out[0] = 0; out[1] = 0; return; }
        const p = u % this.period;
        const top = this.steps * this.rise;
        if (p < this.flight) {                                      // climbing
            const k = Math.floor(p / this.tread);
            const local = p - k * this.tread;
            if (local < this.riserW) { out[0] = (k + local / this.riserW) * this.rise; out[1] = this.rise / this.riserW; }
            else { out[0] = (k + 1) * this.rise; out[1] = 0; }
        } else if (p < this.flight + this.landing) {                // top landing
            out[0] = top; out[1] = 0;
        } else if (p < 2 * this.flight + this.landing) {            // descending
            const q = p - this.flight - this.landing;
            const k = Math.floor(q / this.tread);
            const local = q - k * this.tread;
            const treadTop = top - k * this.rise;
            if (local > this.tread - this.riserW) {
                const f = (local - (this.tread - this.riserW)) / this.riserW;
                out[0] = treadTop - f * this.rise; out[1] = -this.rise / this.riserW;
            } else { out[0] = treadTop; out[1] = 0; }
        } else {                                                    // bottom landing
            out[0] = 0; out[1] = 0;
        }
        // Chain rule for the mirror: h(|x|) is even, so dh/dx flips sign with x.
        out[1] *= s;
    }

    /* out = [height, nx, ny, nz]. The normal comes from the analytic gradient. */
    sample(x, z, out) {
        let h = 0, gx = 0, gz = 0;
        if (this.hasRoll) {
            h += this.ax * Math.sin(x / this.lx + this.phx) + this.az * Math.sin(z / this.lz + this.phz);
            gx += (this.ax / this.lx) * Math.cos(x / this.lx + this.phx);
            gz += (this.az / this.lz) * Math.cos(z / this.lz + this.phz);
        }
        if (this.hasStairs) {
            this._st = this._st || new Float64Array(2);
            this._stairs(x, this._st);
            h += this._st[0]; gx += this._st[1];
        }
        const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        out[0] = h; out[1] = -gx * inv; out[2] = inv; out[3] = -gz * inv;
    }

    height(x, z) {
        this._s4 = this._s4 || new Float64Array(4);
        this.sample(x, z, this._s4);
        return this._s4[0];
    }

    /* Height only, skipping the normal. sample() spends a sqrt and a divide
     * normalising a gradient the raycaster never looks at, and the raycaster
     * calls this ~1000 times per LiDAR tick, so the saving is the difference
     * between the sensor being affordable and not. */
    _hAt(x, z) {
        let h = 0;
        if (this.hasRoll) h += this.ax * Math.sin(x / this.lx + this.phx) + this.az * Math.sin(z / this.lz + this.phz);
        if (this.hasStairs) {
            this._rs = this._rs || new Float64Array(2);
            this._stairs(x, this._rs);
            h += this._rs[0];
        }
        return h;
    }

    /* Distance from (o) along the unit direction (d) to the ground, or maxD if
     * the ray leaves the range without hitting. This is what the walker's LiDAR
     * is built on.
     *
     * Sphere tracing rather than fixed steps. Define f(t) = ray_y(t) - h(x,z)
     * along the ray: f is the signed clearance above the surface, and because
     * the surface is Lipschitz with constant maxGrad, f cannot fall to zero
     * faster than (|dy| + maxGrad·|d_horizontal|) per metre. Stepping by exactly
     * that bound is therefore guaranteed never to skip a hit, while still taking
     * long strides across open ground. A fixed step fine enough for a 7.5 cm
     * stair riser would need ~40 evaluations on every ray including the ones
     * pointing at empty sky.
     *
     * The bound also has to survive a horizontal ray: there |dy| is 0 and the
     * whole step budget comes from the gradient term, which is why the
     * denominator is a sum and not a max. */
    raycast(ox, oy, oz, dx, dy, dz, maxD) {
        const hor = Math.hypot(dx, dz);
        const rate = Math.abs(dy) + this.maxGrad * hor;
        // A ray straight up over perfectly flat ground can never hit anything.
        if (rate < 1e-9) return maxD;

        let t = 0;
        let f = oy - this._hAt(ox, oz);
        if (f <= 0) return 0;                       // origin already underground

        /* Loop invariant: f > 0 at t. Checked above, and re-established below by
         * only advancing when the new sample is still above the surface.
         *
         * The budget of 160 with a 2 cm floor on the step covers 3.2 m, i.e. the
         * whole 2.5 m range, so the march can never simply run out of iterations
         * and report a miss. That failure is not hypothetical: at 48 iterations
         * a ray skimming a hair above the ground — precisely what a head-mounted
         * sensor looking along flat terrain produces, and 34% of all rays here —
         * decayed to a 3 mm clearance, collapsed to minimum steps, and timed out
         * 50 cm short of a real hit. */
        for (let it = 0; it < 160; it++) {
            const safe = f / rate;
            /* Terminate on the UNCAPPED safe distance. If the surface cannot
             * reach the ray within the remaining range, there is provably no hit
             * and we are done. Testing the capped step here instead was a bug:
             * it reported "no hit" whenever the next 0.4 m stride happened to
             * cross maxD, silently blinding the sensor to everything in the last
             * stretch of its own range — measured at 53 cm of error against a
             * brute-force march before the fix. */
            if (t + safe >= maxD) return maxD;
            /* Floor the step at 2 cm. A grazing ray's safe step tends to zero,
             * and without a floor it crawls. Tunnelling would need the surface
             * to rise above the ray and drop back below it inside one step, and
             * it cannot: the only feature narrower than 2 cm is a stair riser,
             * which is a monotonic ramp UP onto a tread that stays high — so a
             * skipped riser is still caught on the tread behind it. */
            const step = Math.max(0.02, Math.min(safe, 0.4));
            let nt = t + step;
            if (nt > maxD) nt = maxD;
            const nf = (oy + dy * nt) - this._hAt(ox + dx * nt, oz + dz * nt);
            if (nf <= 0) {
                /* Bracketed: above the surface at t, below it at nt. Refine by
                 * false position rather than bisection — f is very nearly linear
                 * in t across one step, so interpolating on the f values lands
                 * on the root immediately, while bisection only ever halves the
                 * bracket. It matters because the bracket is a whole 0.4 m step
                 * at its widest: three bisections of that left a straight-down
                 * ray onto flat ground reading 1.175 m instead of 1.200 m. */
                let lo = t, hi = nt, flo = f, fhi = nf;
                for (let k = 0; k < 3; k++) {
                    const den = flo - fhi;
                    const mid = den > 1e-12 ? lo + (hi - lo) * (flo / den) : 0.5 * (lo + hi);
                    const mf = (oy + dy * mid) - this._hAt(ox + dx * mid, oz + dz * mid);
                    if (mf > 0) { lo = mid; flo = mf; } else { hi = mid; fhi = mf; }
                }
                const den = flo - fhi;
                return den > 1e-12 ? lo + (hi - lo) * (flo / den) : 0.5 * (lo + hi);
            }
            t = nt; f = nf;
        }
        return maxD;
    }
}

if (typeof module !== "undefined") module.exports = { Terrain, TERRAIN_DEFS };
