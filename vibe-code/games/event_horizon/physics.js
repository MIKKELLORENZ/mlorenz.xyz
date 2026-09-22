/* physics.js — motion around a black hole, written as a river.
 *
 * THE MODEL. Everything in this file is the exact Schwarzschild solution of
 * general relativity (one non-rotating mass), expressed in Gullstrand–Painlevé
 * "rain" coordinates. In those coordinates the metric is
 *
 *     ds² = −dT² + |dx − V dT|²          V(x) = −sqrt(rs / r) · r̂      (c = 1)
 *
 * which reads: space is FLAT, but it pours into the hole like a river, at the
 * Newtonian escape speed, and everything in it obeys special relativity
 * relative to the water (Hamilton & Lisle 2008, "The river model of black
 * holes"). Two things make this the right form for a game:
 *
 *   1. Nothing special happens to the coordinates at the horizon. The river
 *      simply reaches the speed of light there, and a ship can be integrated
 *      straight through it and on to the singularity.
 *   2. The constant-T slices are exactly Euclidean, so a flat top-down map is
 *      an honest chart — distances on the screen are the distances freely
 *      falling observers would measure.
 *
 * STATE. A ship is (x, y, wx, wy): its position on the chart and the spatial
 * part of its four-velocity measured in the local river frame ("proper
 * velocity" relative to the water, w = γv). With γ = sqrt(1 + w²):
 *
 *     dx/dτ  = w + γV                     carried by the river, plus swimming
 *     dw_i/dτ = −γ w_j ∂_i V_j + A_i      the river's shear steers it
 *     dT/dτ  = γ                          rain time per unit of ship time
 *
 * A_i is the rocket. Set A = 0 and this is the geodesic equation — derived
 * from the Lagrangian of the metric above, not an approximation to it — so
 * perihelion precession, the last stable orbit at 3 rs, the photon sphere at
 * 1.5 rs and the horizon are all simply in there. test_headless.js checks each
 * of them against the closed-form results.
 *
 * TWO FAR-AWAY TIMES. T (rain time) is regular at the horizon and is what the
 * light pulses and the river particles are animated in. The "far clock" the
 * player is scored against is Schwarzschild time t, the bookkeeping of a
 * distant observer at rest, because it is the one every textbook means:
 *
 *     dτ/dt = sqrt(1 − rs/r) · sqrt(1 − v²)        gravity × speed, exactly
 *
 * where v is the speed a hovering observer at that spot would clock the ship
 * at. The two times differ by a function of r alone, so they agree about every
 * round trip and about anything that hovers or orbits at a fixed radius; they
 * differ only about what "now" means for somebody moving radially, which is a
 * convention and not a measurement. t runs away to infinity at the horizon —
 * that is the far observer never seeing you cross.
 *
 * UNITS. c = 1 throughout. Lengths are whatever the mission says they are
 * (rs for the black holes, planet radii for the Earth missions); world.rs is
 * the Schwarzschild radius in those units, and may be 0 for flat space.
 *
 * Small bodies other than the central one (a moon, a planet to slingshot
 * past) are Newtonian point masses on prescribed circular orbits. That is only
 * legitimate in a weak field, and they are only used there.
 */
"use strict";

const C_SI = 299792458;            // m/s
const G_SI = 6.6743e-11;           // m³/kg/s²
const MSUN_KG = 1.98847e30;
const G0_SI = 9.80665;             // one standard gravity, m/s²

/* Below this value of 1 − rs/r the far clock is declared to have run away.
 * The divergence is only logarithmic, so nothing of any size is thrown away. */
const FAR_CLOCK_EPS = 1e-7;

/* The singularity is where the run ends. Tidal forces grow as r^-3 and the
 * step size shrinks as r^1.5; stopping a few percent of rs from the centre
 * costs about a thousandth of the fall time. */
const R_END = 0.03;

/* Step size as a fraction of the local dynamical time sqrt(r³/M). RK4 at 0.02
 * holds the energy of a close orbit to a part in 10⁹ per revolution. */
const ETA = 0.02;

function rsMeters(massSolar) {
    return 2 * G_SI * MSUN_KG * massSolar / (C_SI * C_SI);
}

/* ------------------------------------------------------------ small bodies */

function bodyPos(b, t, out) {
    const a = b.phase + b.omega * t;
    out[0] = b.a * Math.cos(a);
    out[1] = b.a * Math.sin(a);
    return out;
}

/* Kepler's third law holds exactly for circular orbits in Schwarzschild
 * coordinate time, which is the time these bodies are driven by. */
function keplerOmega(rs, a) {
    return Math.sqrt(0.5 * rs / (a * a * a));
}

/* ------------------------------------------------------------ ship dynamics */

const _bp = [0, 0];

/* Right-hand side. o = [dx, dy, dwx, dwy, dT, d(t − τ)] per unit ship time.
 * (ax, ay) is the PROPER acceleration — what an accelerometer on board reads —
 * with its direction taken in the river frame's axes. */
function deriv(world, x, y, wx, wy, t, ax, ay, o) {
    const rs = world.rs;
    const r = Math.sqrt(x * x + y * y) || 1e-300;   // flat space has no centre to avoid
    const nx = x / r, ny = y / r;
    const w2 = wx * wx + wy * wy;
    const g = Math.sqrt(1 + w2);
    const wr = wx * nx + wy * ny;
    const beta = rs > 0 ? Math.sqrt(rs / r) : 0;

    /* Boost the rocket's push from the ship's rest frame into the river frame:
     * the spatial part of the four-acceleration is a + (w·a) w / (γ + 1). */
    const wa = wx * ax + wy * ay;
    let Ax = ax + wa * wx / (g + 1);
    let Ay = ay + wa * wy / (g + 1);
    let pot = 0;

    const bodies = world.bodies;
    if (bodies) {
        for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i];
            if (!b.mu) continue;
            bodyPos(b, t, _bp);
            const dx = x - _bp[0], dy = y - _bp[1];
            const d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
            const k = b.mu / (d2 * d);
            /* Direct pull, plus the indirect term: the chart is pinned to the
             * central mass, which is itself being tugged by this body. */
            const k0 = b.mu / (b.a * b.a * b.a);
            Ax -= k * dx + k0 * _bp[0];
            Ay -= k * dy + k0 * _bp[1];
            pot += b.mu / d;
        }
    }

    const k = g * beta / r;
    o[0] = wx - g * beta * nx;
    o[1] = wy - g * beta * ny;
    o[2] = k * (wx - 1.5 * wr * nx) + Ax;
    o[3] = k * (wy - 1.5 * wr * ny) + Ay;
    o[4] = g;
    /* dt/dτ − 1, arranged so that nothing of order one is subtracted from
     * anything else of order one: around the Earth the answer is ~1e-10 and a
     * naive γ − 1 would have no digits left. */
    const om = 1 - beta * beta;
    o[5] = om > FAR_CLOCK_EPS
        ? (w2 / (g + 1) - beta * wr + beta * beta) / om + pot
        : 0;
}

const _k1 = new Float64Array(6), _k2 = new Float64Array(6),
      _k3 = new Float64Array(6), _k4 = new Float64Array(6);

function rk4(world, s, h, ax, ay) {
    const t0 = s.tau + s.dil;
    deriv(world, s.x, s.y, s.wx, s.wy, t0, ax, ay, _k1);
    const hh = 0.5 * h;
    deriv(world, s.x + hh * _k1[0], s.y + hh * _k1[1], s.wx + hh * _k1[2], s.wy + hh * _k1[3],
          t0 + hh * (1 + _k1[5]), ax, ay, _k2);
    deriv(world, s.x + hh * _k2[0], s.y + hh * _k2[1], s.wx + hh * _k2[2], s.wy + hh * _k2[3],
          t0 + hh * (1 + _k2[5]), ax, ay, _k3);
    deriv(world, s.x + h * _k3[0], s.y + h * _k3[1], s.wx + h * _k3[2], s.wy + h * _k3[3],
          t0 + h * (1 + _k3[5]), ax, ay, _k4);
    const c = h / 6;
    s.x  += c * (_k1[0] + 2 * _k2[0] + 2 * _k3[0] + _k4[0]);
    s.y  += c * (_k1[1] + 2 * _k2[1] + 2 * _k3[1] + _k4[1]);
    s.wx += c * (_k1[2] + 2 * _k2[2] + 2 * _k3[2] + _k4[2]);
    s.wy += c * (_k1[3] + 2 * _k2[3] + 2 * _k3[3] + _k4[3]);
    s.T  += c * (_k1[4] + 2 * _k2[4] + 2 * _k3[4] + _k4[4]);
    s.dil += c * (_k1[5] + 2 * _k2[5] + 2 * _k3[5] + _k4[5]);
    s.tau += h;
}

/* Largest step the current state can take. Everything is a fraction of some
 * local timescale, so the same code is stable skimming a horizon and coasting
 * a million radii out. */
function maxStep(world, s, eta, aMag) {
    let h = Infinity;
    const r = Math.sqrt(s.x * s.x + s.y * s.y);
    if (world.rs > 0) {
        h = eta * Math.sqrt(2 * r * r * r / world.rs);
        /* Close to the singularity a ship with any angular momentum is
         * whipped inward by the −3ML²/r⁴ term far faster than the local
         * orbital time suggests, so also never cross more than a few percent
         * of r in one step. For any ordinary orbit this limit is the slacker
         * of the two and does nothing. */
        const g = Math.sqrt(1 + s.wx * s.wx + s.wy * s.wy);
        const v = Math.sqrt(s.wx * s.wx + s.wy * s.wy) + g * Math.sqrt(world.rs / r);
        h = Math.min(h, 2 * eta * r / v);
    }
    /* A hard burn changes w on the timescale 1/a, gravity or no gravity. */
    if (aMag > 0) h = Math.min(h, 2.5 * eta / aMag);
    const bodies = world.bodies;
    if (bodies) {
        const t = s.tau + s.dil;
        for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i];
            if (!b.mu) continue;
            bodyPos(b, t, _bp);
            const dx = s.x - _bp[0], dy = s.y - _bp[1];
            const d = Math.sqrt(dx * dx + dy * dy);
            h = Math.min(h, eta * Math.sqrt(d * d * d / b.mu));
        }
    }
    return h;
}

/* What, if anything, the ship has just run into. */
function collision(world, s) {
    const r = Math.sqrt(s.x * s.x + s.y * s.y);
    if (world.rs > 0 && !world.R && !(r >= R_END * world.rs)) return "singularity";
    if (world.R && r < world.R) return "surface";
    const bodies = world.bodies;
    if (bodies) {
        const t = s.tau + s.dil;
        for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i];
            if (!b.R) continue;
            bodyPos(b, t, _bp);
            const dx = s.x - _bp[0], dy = s.y - _bp[1];
            if (dx * dx + dy * dy < b.R * b.R) return "body:" + i;
        }
    }
    return null;
}

/* Advance the ship by dtau of its own time under a constant proper
 * acceleration. Returns null, or the name of whatever ended the flight. */
function advance(world, s, dtau, ax, ay) {
    let left = dtau, guard = 0;
    const aMag = Math.sqrt(ax * ax + ay * ay);
    while (left > 0 && guard++ < 20000) {
        const h = Math.min(left, maxStep(world, s, ETA, aMag));
        rk4(world, s, h, ax, ay);
        left -= h;
        if (world.rs > 0 && !s.farLost) {
            const r = Math.sqrt(s.x * s.x + s.y * s.y);
            if (1 - world.rs / r <= FAR_CLOCK_EPS) s.farLost = true;
        }
        const hit = collision(world, s);
        if (hit) return hit;
    }
    return null;
}

function makeShip(x, y, wx, wy) {
    return { x: x, y: y, wx: wx, wy: wy, tau: 0, T: 0, dil: 0, farLost: false };
}

/* ------------------------------------------------------------ initial states */

/* Circular geodesic at radius r (needs r > 1.5 rs). dir = +1 anticlockwise. */
function circularState(rs, r, phi, dir) {
    const M = 0.5 * rs;
    const wt = Math.sqrt(M / (r - 3 * M)) * (dir || 1);
    const gam = 1 / Math.sqrt(1 - 3 * M / r);
    const wr = gam * Math.sqrt(rs / r);
    const c = Math.cos(phi), sn = Math.sin(phi);
    return makeShip(r * c, r * sn, wr * c - wt * sn, wr * sn + wt * c);
}

/* A ship whose velocity, as clocked by a hovering observer at that spot, is
 * (vr, vt). The hoverer moves outward through the river at β, so this is one
 * Lorentz boost. vr = vt = 0 is hovering. Outside the horizon only. */
function localState(rs, r, phi, vr, vt) {
    const beta = rs > 0 ? Math.sqrt(rs / r) : 0;
    const gs = 1 / Math.sqrt(1 - beta * beta);
    const gl = 1 / Math.sqrt(1 - vr * vr - vt * vt);
    const wr = gs * gl * (vr + beta);
    const wt = gl * vt;
    const c = Math.cos(phi), sn = Math.sin(phi);
    return makeShip(r * c, r * sn, wr * c - wt * sn, wr * sn + wt * c);
}

/* Proper acceleration needed to hold dr/dτ on a target, for a ship that may
 * also be moving sideways. The free radial equation is the famous one —
 * Newton, the centrifugal term, and the GR term that destroys close orbits —
 *     r̈ = −M/r² + L²/r³ − 3ML²/r⁴
 * and a radial push a adds a·(1 + w_r²/(γ+1) − β w_r) to it. */
function holdThrust(world, s, rTarget, kp, kd, rdotTarget) {
    const rs = world.rs, M = 0.5 * rs;
    const r = Math.sqrt(s.x * s.x + s.y * s.y);
    const nx = s.x / r, ny = s.y / r;
    const g = Math.sqrt(1 + s.wx * s.wx + s.wy * s.wy);
    const beta = Math.sqrt(rs / r);
    const wr = s.wx * nx + s.wy * ny;
    const L = s.x * s.wy - s.y * s.wx;
    const rdot = wr - g * beta;
    const free = -M / (r * r) + L * L / (r * r * r) - 3 * M * L * L / (r * r * r * r);
    const want = -kd * (rdot - (rdotTarget || 0)) - kp * (r - rTarget);
    const lever = 1 + wr * wr / (g + 1) - beta * wr;
    return lever > 1e-6 ? (want - free) / lever : Infinity;
}

/* ------------------------------------------------------------ diagnostics */

/* Everything the instruments show, from one state. Quantities that only exist
 * outside the horizon (anything defined by a hovering observer) come back as
 * NaN inside it, and `inside` says why. */
function diagnose(world, s) {
    const rs = world.rs;
    const r = Math.sqrt(s.x * s.x + s.y * s.y) || 1e-300;
    const nx = s.x / r, ny = s.y / r;
    const w2 = s.wx * s.wx + s.wy * s.wy;
    const g = Math.sqrt(1 + w2);
    const wr = s.wx * nx + s.wy * ny;
    const wt = s.wy * nx - s.wx * ny;
    const beta = rs > 0 ? Math.sqrt(rs / r) : 0;
    const b2 = beta * beta;
    const d = {
        r: r, beta: beta, gamma: g, wr: wr, wt: wt,
        E: g - beta * wr,
        E1: w2 / (g + 1) - beta * wr,             // E − 1, without the cancellation
        L: s.x * s.wy - s.y * s.wx,
        rdot: wr - g * beta,
        vRiver: Math.sqrt(w2) / g,
        inside: b2 >= 1,
        grav: NaN, gravLoss: NaN, vLoc: NaN, speed: NaN, speedLoss: NaN, rate: NaN,
        beaconOut: 0, starIn: (g + wr) / (1 + beta)
    };
    if (b2 < 1) {
        const sq = Math.sqrt(1 - b2);
        /* γ_loc − 1 without cancellation (see deriv). */
        const gl1 = (w2 / (g + 1) - beta * wr + b2 / (1 + sq)) / sq;
        const gl = 1 + Math.max(0, gl1);
        d.grav = sq;                          // clock rate of a hoverer here
        d.gravLoss = b2 / (1 + sq);           // 1 − grav
        d.speed = 1 / gl;                     // extra factor from the ship's speed
        d.speedLoss = (gl - 1) / gl;          // 1 − speed
        d.vLoc = Math.sqrt(Math.max(0, (gl - 1) * (gl + 1))) / gl;
        d.rate = sq / gl;                     // dτ/dt, exactly grav × speed
        d.beaconOut = (1 - beta) / (g - wr);  // ν received far away / ν sent
    }
    return d;
}

/* The radial "energy landscape": (dr/dτ)² = E² − V²(r). Plotted as (V² − 1)/2
 * it goes over to Newton's −M/r + L²/2r² far from the hole. */
function veff2(rs, L, r) {
    return (1 - rs / r) * (1 + L * L / (r * r));
}

/* Turning points of the free orbit the ship is on right now: the radii where
 * E² = V²(r). Returns { peri, apo }, with peri = 0 for an orbit that goes into
 * the hole and apo = Infinity for one that leaves. Exact, not Keplerian — near
 * a hole the two differ a great deal. */
function apsides(world, d) {
    const rs = world.rs, E2 = d.E * d.E, L = d.L;
    const f = function (r) { return E2 - veff2(rs, L, r); };
    const rLo = Math.max(world.R || 0, rs * 1.0000001, 1e-12);
    let peri = 0, apo = Infinity;
    /* The ship's own radius is always allowed (f ≥ 0 there, give or take
     * round-off — on a circular orbit it is a double root), so each search
     * walks away from it until the motion becomes forbidden, then closes in. */
    let a = d.r;
    for (let i = 0; i < 400; i++) {
        const b = Math.max(rLo, a * 0.97);
        if (f(b) < 0) { peri = bisect(f, a, b); break; }
        if (b === rLo) break;
        a = b;
    }
    a = d.r;
    for (let i = 0; i < 600; i++) {
        const b = a * 1.05;
        if (f(b) < 0) { apo = bisect(f, a, b); break; }
        a = b;
    }
    return { peri: peri, apo: apo };
}

/* Root of f between `ok` (where f is taken to be ≥ 0) and `bad` (f < 0). */
function bisect(f, ok, bad) {
    for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (ok + bad);
        if (f(mid) < 0) bad = mid; else ok = mid;
    }
    return 0.5 * (ok + bad);
}

/* Light-travel time, in far-away time, for a radial ray from r1 out to r2.
 * Closed form in rain coordinates: dr/dT = 1 − sqrt(rs/r). Diverges as r1 → rs. */
function lightTimeOut(rs, r1, r2) {
    if (rs <= 0) return r2 - r1;
    const F = function (r) {
        const u = Math.sqrt(r / rs);
        return u * u + 2 * u + 2 * Math.log(Math.abs(u - 1));
    };
    return rs * (F(r2) - F(r1));
}

/* Difference in stretching acceleration per metre of height, in 1/s², at
 * radius r for a hole whose rs is rsM metres: 2GM/r³ = c² rs / r³. */
function tidalPerMeter(rsM, rOverRs) {
    return C_SI * C_SI / (rsM * rsM * rOverRs * rOverRs * rOverRs);
}

/* ------------------------------------------------------------ free-fall preview */

/* Coast the ship forward with the engine off and record where it goes. This is
 * the dashed line on the map, and it is the real equation of motion, so a
 * close orbit shows up as the precessing rosette it actually is, and a doomed
 * one as a spiral into the hole. */
function predict(world, s0, opt) {
    const maxPts = opt.maxPts || 900;
    const maxSweep = opt.maxSweep || 4.4 * Math.PI;
    const rFar = opt.rFar || Infinity;
    const maxTau = opt.maxTau || Infinity;
    const eta = opt.eta || 0.045;
    const pts = opt.buffer && opt.buffer.length >= 2 * maxPts ? opt.buffer : new Float32Array(2 * maxPts);
    const s = { x: s0.x, y: s0.y, wx: s0.wx, wy: s0.wy, tau: s0.tau, T: s0.T, dil: s0.dil, farLost: s0.farLost };
    const startInside = world.rs > 0 && Math.hypot(s.x, s.y) < world.rs;
    let n = 0, sweep = 0, status = "open";
    let rMin = Infinity, rMax = 0, iMin = 0, iMax = 0;
    let px = s.x, py = s.y;
    const tau0 = s.tau;
    while (n < maxPts) {
        const r = Math.sqrt(s.x * s.x + s.y * s.y);
        pts[2 * n] = s.x; pts[2 * n + 1] = s.y;
        if (r < rMin) { rMin = r; iMin = n; }
        if (r > rMax) { rMax = r; iMax = n; }
        n++;
        if (!startInside && world.rs > 0 && !world.R && r <= world.rs) { status = "plunge"; break; }
        if (r > rFar && s.x * (s.wx) + s.y * (s.wy) > 0 && n > 2) { status = "far"; break; }
        if (Math.abs(sweep) >= maxSweep) { status = "orbit"; break; }
        if (s.tau - tau0 > maxTau) { status = "open"; break; }
        let h = maxStep(world, s, eta, 0);
        if (!isFinite(h)) h = opt.flatStep || 1;
        rk4(world, s, h, 0, 0);
        const hit = collision(world, s);
        sweep += Math.atan2(px * s.y - py * s.x, px * s.x + py * s.y);
        px = s.x; py = s.y;
        if (hit) {
            if (n < maxPts) { pts[2 * n] = s.x; pts[2 * n + 1] = s.y; n++; }
            status = hit === "singularity" ? "plunge" : "crash";
            const rr = Math.hypot(s.x, s.y);
            if (rr < rMin) { rMin = rr; iMin = n - 1; }
            break;
        }
    }
    return { pts: pts, n: n, status: status, sweep: sweep, rMin: rMin, rMax: rMax, iMin: iMin, iMax: iMax };
}

/* ------------------------------------------------------------ light */

/* A photon is (x, y, kx, ky): where it is, and the unit vector it travels
 * along as seen in the local river frame. In rain time,
 *     dx/dT = k + V                                  light swims at c; the river carries it
 *     dk/dT = −(3β k_r / 2r) · (n − k_r k)           the shear turns it
 * (the second line is the null limit of the ship equation, renormalised so
 * that k stays a unit vector). Inside the horizon |V| > 1, so even a photon
 * aimed straight out is carried inward. */
function photonDeriv(rs, x, y, kx, ky, o) {
    const r = Math.sqrt(x * x + y * y);
    const nx = x / r, ny = y / r;
    const beta = rs > 0 ? Math.sqrt(rs / r) : 0;
    const kr = kx * nx + ky * ny;
    const c = -1.5 * beta * kr / r;
    o[0] = kx - beta * nx;
    o[1] = ky - beta * ny;
    o[2] = c * (nx - kr * kx);
    o[3] = c * (ny - kr * ky);
}

const _p1 = new Float64Array(4), _p2 = new Float64Array(4),
      _p3 = new Float64Array(4), _p4 = new Float64Array(4);

function photonRk4(rs, p, h) {
    photonDeriv(rs, p.x, p.y, p.kx, p.ky, _p1);
    const hh = 0.5 * h;
    photonDeriv(rs, p.x + hh * _p1[0], p.y + hh * _p1[1], p.kx + hh * _p1[2], p.ky + hh * _p1[3], _p2);
    photonDeriv(rs, p.x + hh * _p2[0], p.y + hh * _p2[1], p.kx + hh * _p2[2], p.ky + hh * _p2[3], _p3);
    photonDeriv(rs, p.x + h * _p3[0], p.y + h * _p3[1], p.kx + h * _p3[2], p.ky + h * _p3[3], _p4);
    const c = h / 6;
    p.x += c * (_p1[0] + 2 * _p2[0] + 2 * _p3[0] + _p4[0]);
    p.y += c * (_p1[1] + 2 * _p2[1] + 2 * _p3[1] + _p4[1]);
    p.kx += c * (_p1[2] + 2 * _p2[2] + 2 * _p3[2] + _p4[2]);
    p.ky += c * (_p1[3] + 2 * _p2[3] + 2 * _p3[3] + _p4[3]);
    const m = Math.sqrt(p.kx * p.kx + p.ky * p.ky);
    p.kx /= m; p.ky /= m;
}

/* Advance a photon by dT of rain time. Returns false once it has reached the
 * singularity and should be dropped. */
function advancePhoton(rs, p, dT) {
    let left = dT, guard = 0;
    while (left > 0 && guard++ < 4000) {
        const r = Math.sqrt(p.x * p.x + p.y * p.y);
        if (rs > 0 && r < 0.08 * rs) return false;
        let h = left;
        if (rs > 0) h = Math.min(h, 0.05 * r / Math.max(1, Math.sqrt(rs / r)));
        photonRk4(rs, p, h);
        left -= h;
    }
    return true;
}

/* A photon fired from a HOVERING emitter, at an angle measured in the
 * emitter's own frame. The hoverer moves outward through the river at β, so
 * the direction has to be aberrated into the river frame before it is used. */
function photonFromHoverer(rs, x, y, angle) {
    const r = Math.sqrt(x * x + y * y);
    const nx = x / r, ny = y / r;
    const beta = rs > 0 ? Math.sqrt(rs / r) : 0;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const dr = dx * nx + dy * ny;                  // along the boost
    const tx = dx - dr * nx, ty = dy - dr * ny;    // across it
    const den = 1 + beta * dr;
    const g = Math.sqrt(1 - beta * beta);
    const kr = (dr + beta) / den;
    let kx = kr * nx + tx * g / den, ky = kr * ny + ty * g / den;
    const m = Math.sqrt(kx * kx + ky * ky);
    return { x: x, y: y, kx: kx / m, ky: ky / m };
}

/* Conserved along every light ray: its impact parameter b = L/E. Light with
 * b below (3√3/2) rs is captured. Used by the tests. */
function photonImpact(rs, p) {
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    const beta = rs > 0 ? Math.sqrt(rs / r) : 0;
    const kr = (p.kx * p.x + p.ky * p.y) / r;
    return (p.x * p.ky - p.y * p.kx) / (1 - beta * kr);
}

const B_CRIT = 1.5 * Math.sqrt(3);   // critical impact parameter, in rs

if (typeof module !== "undefined") {
    module.exports = {
        C_SI, G_SI, MSUN_KG, G0_SI, FAR_CLOCK_EPS, R_END, ETA, B_CRIT,
        rsMeters, bodyPos, keplerOmega, deriv, rk4, maxStep, collision, advance,
        makeShip, circularState, localState, holdThrust, diagnose, veff2, apsides, bisect,
        lightTimeOut, tidalPerMeter, predict,
        photonDeriv, photonRk4, advancePhoton, photonFromHoverer, photonImpact
    };
}
