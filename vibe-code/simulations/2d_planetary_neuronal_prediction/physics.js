/* physics.js — the ground truth. Plain 2D Newtonian gravity, integrated as
 * faithfully as we can afford, plus the random system generator.
 *
 * UNITS. G = 1, distances in AU, masses in solar masses. A circular orbit of
 * radius 1 AU around a 1 M☉ star then has period 2π. Nothing in the model sees
 * these units directly — everything it reads is normalised by the system's own
 * length/mass/time scales (see model.js) — but keeping the raw numbers physical
 * makes the debug output readable.
 *
 * TRUTH INTEGRATOR. Yoshida 4th-order, built as the standard triple jump of
 * three leapfrog steps with weights (w1, w0, w1). It is symplectic, so the
 * energy error is bounded and oscillatory rather than secular: over the
 * horizons used here the relative energy drift is ~1e-12, which is five or six
 * orders of magnitude below the errors we are asking the networks to compete
 * on. That headroom is the whole point — if the "truth" wandered at the same
 * scale as a good prediction, the fitness function would be measuring the
 * integrator, not the brain.
 *
 * Every body feels every other body, INCLUDING the star. The star's wobble is
 * small (a Jupiter moves the Sun by about a thousandth of an AU) but it is real
 * and it is in here; nothing is pinned.
 */
"use strict";

const G_CONST = 1.0;

/* Softening. Two bodies at r → 0 produce an unbounded acceleration that no
 * integrator survives, and a rejected system draw costs a whole episode. A
 * softening of 1e-4 AU is ~15 000 km — far inside any orbit this generator
 * produces, so it never touches the dynamics we score, and it turns a division
 * by zero into a merely large number if a draw goes wrong. */
const SOFT = 1e-4;

/* ------------------------------------------------------------------ state */

class State {
    constructor(n) {
        this.n = n;
        this.x = new Float64Array(n); this.y = new Float64Array(n);
        this.vx = new Float64Array(n); this.vy = new Float64Array(n);
    }
    clone() {
        const s = new State(this.n);
        s.x.set(this.x); s.y.set(this.y); s.vx.set(this.vx); s.vy.set(this.vy);
        return s;
    }
    copyFrom(o) {
        this.x.set(o.x); this.y.set(o.y); this.vx.set(o.vx); this.vy.set(o.vy);
        return this;
    }
    posEquals(o, tol) {
        for (let i = 0; i < this.n; i++) {
            if (Math.abs(this.x[i] - o.x[i]) > tol || Math.abs(this.y[i] - o.y[i]) > tol) return false;
        }
        return true;
    }
}

/* ------------------------------------------------------- Newtonian forces */

/* a ← Σ_j G m_j (r_j - r_i) / |r_j - r_i|³, written into ax/ay.
 * Newton's third law is used to halve the pair loop, which is not just a speed
 * trick: it makes the force field exactly antisymmetric in floating point, so
 * total momentum is conserved to the last bit and the barycentre never creeps. */
function newtonAccel(st, m, ax, ay) {
    const n = st.n, x = st.x, y = st.y;
    ax.fill(0); ay.fill(0);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const dx = x[j] - x[i], dy = y[j] - y[i];
            const r2 = dx * dx + dy * dy + SOFT * SOFT;
            const inv = 1 / (r2 * Math.sqrt(r2));       // 1/r³
            const fx = G_CONST * dx * inv, fy = G_CONST * dy * inv;
            ax[i] += m[j] * fx; ay[i] += m[j] * fy;
            ax[j] -= m[i] * fx; ay[j] -= m[i] * fy;
        }
    }
}

/* ------------------------------------------------------------ integrators */

/* One kick-drift-kick leapfrog step. Reused both as the truth integrator's
 * inner step and (via `stepVerlet`) as the harness every predictor runs in, so
 * a network and Newton are always compared through the same update rule. */
function leapfrogKDK(st, m, h, ax, ay) {
    const n = st.n, hh = 0.5 * h;
    newtonAccel(st, m, ax, ay);
    for (let i = 0; i < n; i++) { st.vx[i] += hh * ax[i]; st.vy[i] += hh * ay[i]; }
    for (let i = 0; i < n; i++) { st.x[i] += h * st.vx[i]; st.y[i] += h * st.vy[i]; }
    newtonAccel(st, m, ax, ay);
    for (let i = 0; i < n; i++) { st.vx[i] += hh * ax[i]; st.vy[i] += hh * ay[i]; }
}

/* Yoshida's 4th-order triple jump. w0 + 2·w1 = 1 and w0³ + 2·w1³ = 0, which is
 * exactly the pair of conditions that cancels the leading 3rd-order error term
 * of the composition. */
const Y_W1 = 1 / (2 - Math.cbrt(2));
const Y_W0 = -Math.cbrt(2) * Y_W1;

function yoshida4(st, m, h, ax, ay) {
    leapfrogKDK(st, m, Y_W1 * h, ax, ay);
    leapfrogKDK(st, m, Y_W0 * h, ax, ay);
    leapfrogKDK(st, m, Y_W1 * h, ax, ay);
}

/* ------------------------------------------------------------------------- *
 * The predictor harness.
 *
 * ONE acceleration evaluation per tick, then a velocity-Verlet-style update:
 *
 *      x' = x + v·dt + ½·a·dt²
 *      v' = v + a·dt
 *
 * Every competitor — the evolved brain, exact Newton, and the do-nothing
 * baseline — goes through this identical function, differing only in what fills
 * `ax/ay`. That is what makes "the network beat coarse Newton" a meaningful
 * sentence: both had one force evaluation per tick and the same integrator, so
 * the only thing being compared is the force.
 *
 * It also defines the actual learning problem. `a` here is not the instantaneous
 * acceleration — it is whatever effective, averaged-over-the-step acceleration
 * makes this update land closest to the truth. For a finite dt that is provably
 * NOT the Newtonian 1/r², and the gap is the room the search has to work in.
 *
 * THE POSITION AND VELOCITY UPDATES MAY USE DIFFERENT EFFECTIVE ACCELERATIONS.
 * `bx/by` default to `ax/ay`, which is the classical scheme, but a predictor may
 * fill them separately. This is not a loophole, it is a consequence of the same
 * argument as above: the exact flow map over a finite step does not factor
 * through a single vector. The effective acceleration that best places the body
 * (a dt²-weighted average over the step) and the one that best sets its new
 * velocity (a dt-weighted average) are genuinely different quantities, and
 * forcing them equal throws away accuracy for nothing. The cost constraint that
 * makes the comparison fair is ONE FORCE EVALUATION PER TICK, and that is
 * untouched — Newton still gets its one evaluation, and for Newton the two are
 * equal because its `a` is the true instantaneous force with nothing to split.
 * ------------------------------------------------------------------------- */
function stepVerlet(st, dt, ax, ay, bx, by) {
    const n = st.n, h2 = 0.5 * dt * dt;
    const vax = bx || ax, vay = by || ay;
    for (let i = 0; i < n; i++) {
        st.x[i] += st.vx[i] * dt + h2 * ax[i];
        st.y[i] += st.vy[i] * dt + h2 * ay[i];
        st.vx[i] += dt * vax[i];
        st.vy[i] += dt * vay[i];
    }
}

/* ------------------------------------------------------------ diagnostics */

function totalEnergy(st, m) {
    const n = st.n;
    let ke = 0, pe = 0;
    for (let i = 0; i < n; i++) ke += 0.5 * m[i] * (st.vx[i] * st.vx[i] + st.vy[i] * st.vy[i]);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const dx = st.x[j] - st.x[i], dy = st.y[j] - st.y[i];
            pe -= G_CONST * m[i] * m[j] / Math.sqrt(dx * dx + dy * dy + SOFT * SOFT);
        }
    }
    return ke + pe;
}

function angularMomentum(st, m) {
    let l = 0;
    for (let i = 0; i < st.n; i++) l += m[i] * (st.x[i] * st.vy[i] - st.y[i] * st.vx[i]);
    return l;
}

/* Shift a state into the barycentric frame: origin at the centre of mass and
 * zero net momentum. Without the momentum part the whole system slides across
 * the map at a constant rate, which every predictor learns to reproduce for
 * free and which therefore inflates every score with a term measuring nothing. */
function toBarycentre(st, m) {
    let M = 0, cx = 0, cy = 0, px = 0, py = 0;
    for (let i = 0; i < st.n; i++) {
        M += m[i];
        cx += m[i] * st.x[i]; cy += m[i] * st.y[i];
        px += m[i] * st.vx[i]; py += m[i] * st.vy[i];
    }
    cx /= M; cy /= M; px /= M; py /= M;
    for (let i = 0; i < st.n; i++) {
        st.x[i] -= cx; st.y[i] -= cy;
        st.vx[i] -= px; st.vy[i] -= py;
    }
    return st;
}

/* ------------------------------------------------------- system generation */

/* Kepler orbit → cartesian, in 2D. `mu` is G(M_central + m). Returns the
 * position and velocity relative to the central body. */
function keplerToCartesian(a, e, argPeri, meanAnom, mu) {
    // Solve M = E − e·sin E. Newton from a decent starting guess converges in
    // 3–4 iterations for the eccentricities this generator produces.
    let E = meanAnom + (e < 0.8 ? e * Math.sin(meanAnom) : Math.PI);
    for (let k = 0; k < 24; k++) {
        const f = E - e * Math.sin(E) - meanAnom;
        const fp = 1 - e * Math.cos(E);
        const d = f / fp;
        E -= d;
        if (Math.abs(d) < 1e-14) break;
    }
    const cosE = Math.cos(E), sinE = Math.sin(E);
    const b = Math.sqrt(1 - e * e);
    const r = a * (1 - e * cosE);
    const px = a * (cosE - e), py = a * b * sinE;
    const s = Math.sqrt(mu * a) / r;
    const pvx = -s * sinE, pvy = s * b * cosE;
    const c = Math.cos(argPeri), sn = Math.sin(argPeri);
    return {
        x: c * px - sn * py, y: sn * px + c * py,
        vx: c * pvx - sn * pvy, vy: sn * pvx + c * pvy
    };
}

/* Difficulty rungs. Each one widens the system generator AND lengthens the
 * rollout the population is scored over, so a promotion always costs accuracy
 * before it buys anything — which is what gives the ladder a natural stopping
 * point rather than racing to the top in ten generations. */
const LEVELS = [
    { label: "calm", nMin: 3, nMax: 4, eMax: 0.05, horizon: 32, binaryP: 0, massSpread: 2.5 },
    { label: "spread", nMin: 3, nMax: 5, eMax: 0.14, horizon: 64, binaryP: 0, massSpread: 3.0 },
    { label: "eccentric", nMin: 4, nMax: 6, eMax: 0.24, horizon: 128, binaryP: 0, massSpread: 3.4 },
    { label: "crowded", nMin: 5, nMax: 8, eMax: 0.34, horizon: 256, binaryP: 0.15, massSpread: 3.8 },
    { label: "wild", nMin: 6, nMax: 10, eMax: 0.45, horizon: 512, binaryP: 0.35, massSpread: 4.2 }
];
const N_LEVELS = LEVELS.length;
function levelOf(l) { return LEVELS[Math.max(0, Math.min(N_LEVELS - 1, l | 0))]; }

/* One draw of a planetary system. Returns null if the draw is degenerate; the
 * caller (makeSystem) retries. Orbits are laid out with a minimum period ratio
 * because adjacent near-circular orbits closer than about 1.4× in semi-major
 * axis are not stable over the horizons here, and a system that ejects a planet
 * mid-episode turns the fitness into a lottery on which draw you got. */
function drawSystem(rng, lv) {
    const nBody = lv.nMin + Math.floor(rng() * (lv.nMax - lv.nMin + 1));
    const m = new Float64Array(nBody);
    const st = new State(nBody);

    const mStar = 0.7 + 0.8 * rng();
    m[0] = mStar;
    st.x[0] = 0; st.y[0] = 0; st.vx[0] = 0; st.vy[0] = 0;

    let first = 1;
    let aMin = 0.35 + 0.4 * rng();
    let muInner = G_CONST * mStar;

    // Optional close binary companion. This is the case where "the sun is also
    // affected" stops being a footnote: a 0.1–0.4 M☉ companion swings the
    // primary across a visible fraction of the frame, and any predictor that
    // treats the central body as nailed down loses badly.
    if (rng() < lv.binaryP && nBody >= 4) {
        const mc = mStar * (0.08 + 0.35 * rng());
        // Wide enough that the binary's own period is only a few times shorter
        // than the innermost planet's. A tight 0.1 AU pair orbits ~70× faster
        // than a planet at 5 AU, and since the tick is set by the fastest orbit
        // in the system, that one pair would shrink the timestep until every
        // other body in the frame sat almost still for the whole rollout.
        const ab = 0.30 + 0.35 * rng();
        m[1] = mc;
        const k = keplerToCartesian(ab, 0.02 + 0.1 * rng(), rng() * 2 * Math.PI, rng() * 2 * Math.PI,
            G_CONST * (mStar + mc));
        st.x[1] = k.x; st.y[1] = k.y; st.vx[1] = k.vx; st.vy[1] = k.vy;
        first = 2;
        muInner = G_CONST * (mStar + mc);
        aMin = Math.max(aMin, 3.6 * ab);     // circumbinary planets need real clearance
    }

    // Orbit spacing is chosen from a TARGET SPAN rather than a fixed per-gap
    // ratio. A fixed ratio compounds: nine planets at 1.9× each span a factor of
    // 170 in radius, so the inner one orbits two thousand times for every orbit
    // of the outer one and no single timestep can serve both. Picking the total
    // span first and dividing it among however many planets there are keeps
    // every system resolvable at one tick length, whatever its body count. The
    // 1.28 floor is dynamical, not cosmetic — closer than that and neighbouring
    // near-circular orbits are simply not stable over these horizons.
    const nPlanet = nBody - first;
    const span = 3.0 + 6.0 * rng();
    const growth = Math.max(1.28, Math.pow(span, 1 / Math.max(1, nPlanet - 1)));

    let a = aMin;
    for (let i = first; i < nBody; i++) {
        // log-uniform masses: Mars-ish (3e-7) up to a few Jupiters (3e-3), so a
        // system usually contains bodies whose mutual pull differs by four
        // orders of magnitude. That range is the reason the model outputs
        // kernel *coefficients* rather than a raw force — see model.js.
        const mp = mStar * Math.pow(10, -6.4 + lv.massSpread * rng());
        m[i] = mp;
        const e = lv.eMax * Math.pow(rng(), 1.6);
        const k = keplerToCartesian(a, e, rng() * 2 * Math.PI, rng() * 2 * Math.PI, muInner + G_CONST * mp);
        st.x[i] = k.x; st.y[i] = k.y; st.vx[i] = k.vx; st.vy[i] = k.vy;
        // Step outward only when there is another planet to place. Advancing
        // past the last one and then testing the bound rejected a third of all
        // otherwise-perfect draws for being too big at a radius nothing
        // occupies.
        if (i < nBody - 1) {
            a *= growth * (0.92 + 0.16 * rng());
            if (a > 12) return null;
        }
    }
    toBarycentre(st, m);
    return { m, state: st, nBody };
}

/* Reference scales, computed ONCE from the initial state and then frozen for
 * the whole episode.
 *
 * Freezing matters. If the model re-derived its length scale from the state it
 * is currently predicting, a drifting rollout would quietly rescale its own
 * inputs and the error would feed back on itself. Frozen, they are just three
 * constants any real observer would also have.
 *
 * The length scale is the MEDIAN orbital radius, over the bodies that actually
 * orbit. Two refinements, both learned the hard way:
 *
 *   · not the RMS — RMS is dragged around by whichever body happens to be
 *     furthest out, so one cold outer planet inflates the reference length and
 *     the timestep derived from it can no longer resolve the inner orbits;
 *   · not over ALL bodies — the primary sits on the barycentre at r ≈ 0, and in
 *     a three-body system that lone zero drags the median down onto the
 *     innermost planet. Bodies inside 5% of the outermost radius are treated as
 *     central and left out, which also correctly excludes a close binary
 *     companion. */
function referenceScales(st, m) {
    let M = 0;
    for (let i = 0; i < st.n; i++) M += m[i];
    const all = [];
    for (let i = 0; i < st.n; i++) all.push(Math.hypot(st.x[i], st.y[i]));
    const rmax = Math.max(...all);
    const r = all.filter(v => v > 0.05 * rmax).sort((a, b) => a - b);
    const mid = r.length >> 1;
    const L = Math.max(r.length ? (r.length % 2 ? r[mid] : 0.5 * (r[mid - 1] + r[mid])) : rmax, 1e-3);
    const V = Math.sqrt(G_CONST * M / L);
    return { M, L, V, A: G_CONST * M / (L * L), T: L / V, R0: rmax };
}

/* The shortest orbital period in the system, as a Keplerian estimate about the
 * total mass. This sets the tick length, because it is the timescale that
 * decides whether the simulation is resolved at all: a tick longer than a small
 * fraction of it aliases the fastest body, and no force law — learned or
 * Newtonian — can predict a body it only samples eight times per orbit.
 *
 * Bodies inside 2% of the outermost radius are skipped, and that threshold is
 * doing real work. The primary does not orbit, it sits ON the barycentre, but
 * "sits on" means a Jupiter-sized wobble of ~1e-3 AU rather than exactly zero —
 * and a Keplerian period computed for r = 1e-3 comes out at a few microseconds.
 * With a naive `r > 0` filter that phantom sets the timestep, every system in
 * every level fails the resolution rule, and the generator returns almost
 * nothing. The orbit spacing guarantees any real planet sits beyond 11% of the
 * outermost radius, so 2% cannot exclude a body that genuinely orbits. */
function shortestPeriod(st, m) {
    let M = 0;
    for (let i = 0; i < st.n; i++) M += m[i];
    const r = [];
    for (let i = 0; i < st.n; i++) r.push(Math.hypot(st.x[i], st.y[i]));
    const rmax = Math.max(...r);
    let p = Infinity;
    for (let i = 0; i < st.n; i++) {
        if (r[i] < 0.02 * rmax) continue;
        p = Math.min(p, 2 * Math.PI * Math.sqrt(r[i] * r[i] * r[i] / (G_CONST * M)));
    }
    return Number.isFinite(p) ? p : 2 * Math.PI * Math.sqrt(rmax * rmax * rmax / (G_CONST * M));
}

/* ------------------------------------------------------------------ system */

class PlanetSystem {
    constructor(m, state0, tickFrac) {
        this.m = m;
        this.n = m.length;
        this.state0 = state0;
        this.ref = referenceScales(state0, m);
        this.pMin = shortestPeriod(state0, m);
        // The tick is a fixed fraction of the FASTEST orbit in this particular
        // system, not of the system's mean timescale. Every system is then
        // equally well resolved regardless of how big or spread out it is,
        // which is what lets one genome be scored fairly across all five
        // difficulty levels. It also makes dt/T_ref genuinely informative — it
        // now varies from system to system, and the model is given it as an
        // input so its correction terms can depend on the step size.
        this.dt = tickFrac * this.pMin;
        this.ticksPerFastestOrbit = this.pMin / this.dt;
        this._ax = new Float64Array(this.n);
        this._ay = new Float64Array(this.n);
    }

    /* Integrate the truth forward `ticks` ticks, recording the state after
     * every one. `substeps` Yoshida steps per tick; 24 puts the truth's own
     * error ~1e-12 relative, far below anything a network reaches. */
    integrateTruth(ticks, substeps) {
        const st = this.state0.clone();
        const h = this.dt / substeps;
        const frames = [st.clone()];
        const e0 = totalEnergy(st, this.m);
        let maxR = 0, minSep = Infinity, worstE = 0;
        for (let t = 0; t < ticks; t++) {
            for (let s = 0; s < substeps; s++) yoshida4(st, this.m, h, this._ax, this._ay);
            frames.push(st.clone());
            for (let i = 0; i < this.n; i++) {
                maxR = Math.max(maxR, Math.hypot(st.x[i], st.y[i]));
                for (let j = i + 1; j < this.n; j++) {
                    minSep = Math.min(minSep, Math.hypot(st.x[j] - st.x[i], st.y[j] - st.y[i]));
                }
            }
            worstE = Math.max(worstE, Math.abs((totalEnergy(st, this.m) - e0) / e0));
        }
        return { frames, maxR, minSep, energyDrift: worstE, e0 };
    }

    newtonAccelInto(st, ax, ay) { newtonAccel(st, this.m, ax, ay); }
}

/* Draw a system that survives its own horizon, then prove it before returning
 * it. Four rejection rules, each of which exists because the alternative is a
 * fitness function measuring something other than the brain:
 *
 *   · RESOLUTION — the fastest body must get at least MIN_TICKS_PER_ORBIT ticks
 *     per orbit. Below that it is aliased, and no force law, learned or
 *     Newtonian, can predict a body it barely samples. Such a system does not
 *     make the task harder, it makes it impossible, which is different.
 *   · ESCAPE and CLOSE APPROACH — the signature of a chaotic scattering. One
 *     ejection mid-episode turns that episode's score into a lottery on which
 *     draw you got.
 *   · TRUTH QUALITY — if the reference integrator's own energy drifts more than
 *     1e-9, the "truth" is no longer far enough above the errors being scored,
 *     and the fitness starts measuring the integrator.
 *
 * This is the direct descendant of a lesson from the walker sim: when the
 * fitness curve turns out to be tracking which episodes you happened to draw
 * rather than what the brain learned, no amount of extra generations helps. */
const MIN_TICKS_PER_ORBIT = 20;
const MAX_TRUTH_DRIFT = 1e-9;

function makeSystem(seed, opts) {
    const o = opts || {};
    const lv = levelOf(o.level || 0);
    const horizon = o.horizon || lv.horizon;
    const substeps = o.substeps || 24;
    const tickFrac = o.tickFrac || 0.02;
    const rng = mulberry32(seed >>> 0);
    for (let attempt = 0; attempt < 20; attempt++) {
        const draw = drawSystem(rng, lv);
        if (!draw) continue;
        const sys = new PlanetSystem(draw.m, draw.state, tickFrac);
        if (sys.ticksPerFastestOrbit < MIN_TICKS_PER_ORBIT) continue;
        const truth = sys.integrateTruth(horizon, substeps);
        // Escape is measured against the system's own initial extent, not
        // against the reference length. Tying it to `ref.L` made the rule mean
        // completely different things for a compact system and a spread-out one,
        // and silently rejected most well-behaved wide systems.
        if (!Number.isFinite(truth.maxR) || truth.maxR > 2.5 * sys.ref.R0) continue;
        if (truth.minSep < 0.02 * sys.ref.L) continue;
        if (!(truth.energyDrift < MAX_TRUTH_DRIFT)) continue;
        sys.truth = truth;
        sys.horizon = horizon;
        sys.level = o.level || 0;
        sys.seed = seed >>> 0;
        sys.attempts = attempt + 1;
        return sys;
    }
    return null;
}

if (typeof module !== "undefined") {
    module.exports = {
        G_CONST, SOFT, State, newtonAccel, leapfrogKDK, yoshida4, stepVerlet,
        totalEnergy, angularMomentum, toBarycentre, keplerToCartesian,
        LEVELS, N_LEVELS, levelOf, referenceScales, shortestPeriod,
        PlanetSystem, makeSystem, MIN_TICKS_PER_ORBIT, MAX_TRUTH_DRIFT,
        Y_W0, Y_W1
    };
}
