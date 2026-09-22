/* test_headless.js — Node assertion suite. Run: node test_headless.js
 *
 * The game's claim is that what you fly through is the real Schwarzschild
 * solution and not a Newtonian potential with relativistic decoration. That
 * claim is cheap to make and easy to break with one sign, so every headline
 * result of the geometry is checked here against its closed form: conserved
 * energy and angular momentum, Kepler's law in far time, the orbital clock
 * rate, the last stable orbit, perihelion precession, the fall times outside
 * and inside the horizon, the hover thrust, light bending, the photon sphere,
 * and the size of the shadow a falling observer sees.
 *
 * Later sections fly every mission with a scripted pilot, because "the
 * objective is reachable" is also a claim, and a level nobody can finish
 * teaches nothing.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FILES = ["physics.js", "sky.js", "sim.js", "missions.js", "missions_bh.js", "pilot.js"];
for (const f of FILES) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) { console.log(`(skipping ${f} — not written yet)`); continue; }
    vm.runInThisContext(fs.readFileSync(p, "utf8"), { filename: f });
}

let failures = 0, checks = 0;
function check(name, ok, extra) {
    checks++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failures++;
}
function near(a, b, rel) { return Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-300); }
function section(t) { console.log(`\n\x1b[36m── ${t}\x1b[0m`); }
const fx = (v, n) => Number(v).toPrecision(n || 6);

/* =========================================================== 1. geodesics */
section("geodesics: conserved quantities");
{
    const world = { rs: 1 };
    // An eccentric, strongly relativistic bound orbit: periapsis near 5 rs.
    const s = localState(1, 14, 0.3, -0.05, 0.19);
    const d0 = diagnose(world, s);
    let worstE = 0, worstL = 0, rMin = 1e9, rMax = 0;
    for (let i = 0; i < 4000; i++) {
        advance(world, s, 0.5, 0, 0);
        const d = diagnose(world, s);
        worstE = Math.max(worstE, Math.abs(d.E - d0.E));
        worstL = Math.max(worstL, Math.abs(d.L - d0.L));
        rMin = Math.min(rMin, d.r); rMax = Math.max(rMax, d.r);
    }
    check("energy E = γ − β·w_r is conserved in free fall", worstE < 1e-8, `drift ${worstE.toExponential(2)} over 2000 rs/c`);
    check("angular momentum is conserved in free fall", worstL < 1e-8, `drift ${worstL.toExponential(2)}`);
    check("the orbit is bound and stays outside the hole", rMin > 3 && rMax < 40, `r ∈ [${fx(rMin, 4)}, ${fx(rMax, 4)}] rs`);
}

section("circular orbits");
{
    const world = { rs: 1 };
    const R = 10, M = 0.5;
    const s = circularState(1, R, 0, 1);
    let sweep = 0, px = s.x, py = s.y, worst = 0;
    while (sweep < 2 * Math.PI) {
        advance(world, s, 0.05, 0, 0);
        sweep += Math.atan2(px * s.y - py * s.x, px * s.x + py * s.y);
        px = s.x; py = s.y;
        worst = Math.max(worst, Math.abs(Math.hypot(s.x, s.y) - R));
    }
    const tFar = s.tau + s.dil;
    const kepler = 2 * Math.PI * Math.sqrt(R * R * R / M);
    check("a circular orbit stays circular", worst < 1e-6, `max |r − 10| = ${worst.toExponential(2)}`);
    check("Kepler's third law is exact in far time", near(tFar, kepler, 2e-3), `${fx(tFar)} vs ${fx(kepler)}`);
    check("orbiting clock runs at sqrt(1 − 3M/r)", near(s.tau / tFar, Math.sqrt(1 - 3 * M / R), 1e-6),
        `${fx(s.tau / tFar)} vs ${fx(Math.sqrt(1 - 3 * M / R))}`);
    check("rain time and far time agree at fixed radius", near(s.T, tFar, 1e-9));
    const d = diagnose(world, s);
    check("speed seen by a hoverer is sqrt(M/(r − 2M))", near(d.vLoc, Math.sqrt(M / (R - 2 * M)), 1e-9), fx(d.vLoc));
    check("clock rate = gravity × speed", near(d.rate, d.grav * d.speed, 1e-12) && near(d.rate, Math.sqrt(1 - 3 * M / R), 1e-9));
}

section("the last stable orbit (3 rs)");
{
    const world = { rs: 1 };
    const kick = function (r0, dv) {
        // Circular speed, nudged radially by dv as a hoverer would see it.
        const M = 0.5, v = Math.sqrt(M / (r0 - 2 * M));
        const s = localState(1, r0, 0, dv, v);
        let lo = r0, hi = r0, end = null;
        for (let i = 0; i < 6000 && !end; i++) {
            end = advance(world, s, 0.25, 0, 0);
            const r = Math.hypot(s.x, s.y);
            lo = Math.min(lo, r); hi = Math.max(hi, r);
            if (r > 60) end = "escaped";
        }
        return { lo, hi, end };
    };
    const a = kick(4.0, -0.004);
    check("at 4 rs a nudged orbit just wobbles", !a.end && a.lo > 3.6 && a.hi < 4.6, `r ∈ [${fx(a.lo, 4)}, ${fx(a.hi, 4)}]`);
    const b = kick(2.8, -0.004);
    check("at 2.8 rs the same nudge inward is fatal", b.end === "singularity", String(b.end));
    // Outward, it climbs away first — but it is still carrying more energy than
    // the top of the barrier, so when it comes back it goes over and in.
    const c = kick(2.8, +0.004);
    check("nudged outward it climbs to 3.5 rs, returns, and is lost anyway", c.hi > 3.3 && c.end === "singularity", `peaked at ${fx(c.hi, 4)} rs, then ${c.end}`);
}

section("perihelion precession");
{
    const world = { rs: 1 };
    // Start at apoapsis of a mildly eccentric orbit far out, so first order holds.
    const M = 0.5, rApo = 260;
    const s = localState(1, rApo, 0, 0, 0.8 * Math.sqrt(M / rApo));
    let sweep = 0, px = s.x, py = s.y, prevR = rApo, prevPrev = rApo, apoSweep = null, rPeri = 1e9;
    for (let i = 0; i < 400000 && apoSweep === null; i++) {
        advance(world, s, 2, 0, 0);
        sweep += Math.atan2(px * s.y - py * s.x, px * s.x + py * s.y);
        px = s.x; py = s.y;
        const r = Math.hypot(s.x, s.y);
        rPeri = Math.min(rPeri, r);
        if (prevR > prevPrev && prevR > r && sweep > 3) apoSweep = sweep;
        prevPrev = prevR; prevR = r;
    }
    const p = 2 * rApo * rPeri / (rApo + rPeri);            // semi-latus rectum
    const expect = 6 * Math.PI * M / p;
    const got = apoSweep - 2 * Math.PI;
    check("apsides advance by 6πM/p per orbit", Math.abs(got - expect) < 0.12 * expect,
        `${fx(got, 4)} rad vs ${fx(expect, 4)} (first order)`);
}

section("falling in");
{
    const world = { rs: 1 };
    // Rain: at rest in the river, i.e. dropped from rest at infinity.
    const r0 = 8, s = makeShip(r0, 0, 0, 0);
    let tauH = null, end = null;
    while (!end) {
        end = advance(world, s, 0.01, 0, 0);
        if (tauH === null && Math.hypot(s.x, s.y) <= 1) tauH = s.tau;
    }
    const tTotal = (2 / 3) * (Math.pow(r0, 1.5) - Math.pow(R_END, 1.5));
    const tHor = (2 / 3) * (Math.pow(r0, 1.5) - 1);
    check("rain reaches the singularity in (2/3)·r^1.5", near(s.tau, tTotal, 2e-3), `${fx(s.tau)} vs ${fx(tTotal)}`);
    check("and crosses the horizon at the expected moment", Math.abs(tauH - tHor) < 0.02, `${fx(tauH)} vs ${fx(tHor)}`);
    check("rain time IS the rain's own time", near(s.T, s.tau, 1e-9));
    check("the far clock ran away at the horizon", s.farLost === true);

    // The longest possible life inside: the E = 0 geodesic, π/2 · rs/c in all.
    const rS = 0.999, wr = 1 / Math.sqrt(1 / rS - 1);
    const z = makeShip(rS, 0, wr, 0);
    let e2 = null; while (!e2) e2 = advance(world, z, 0.002, 0, 0);
    const F = (r) => Math.asin(Math.sqrt(r)) - Math.sqrt(r * (1 - r));
    const expect = F(rS) - F(R_END);
    check("E = 0 fall from the horizon lasts ∫sqrt(r/(1−r))dr", near(z.tau, expect, 2e-3), `${fx(z.tau)} vs ${fx(expect)} (π/2 = 1.5708 from r = 1 to 0)`);

    // Struggling makes it shorter: burn outward the whole way down.
    const y = makeShip(rS, 0, wr, 0);
    let e3 = null; while (!e3) e3 = advance(world, y, 0.002, -3, 0);
    check("thrusting INWARD from E = 0 shortens the fall", y.tau < z.tau, `${fx(y.tau, 4)} < ${fx(z.tau, 4)}`);
}

section("hovering");
{
    const world = { rs: 1 };
    for (const R of [6, 2, 1.25]) {
        const s = localState(1, R, 0, 0, 0);
        const beta = Math.sqrt(1 / R), gam = 1 / Math.sqrt(1 - 1 / R);
        const a0 = holdThrust(world, s, R, 0, 0);
        const ok1 = near(a0, gam * beta * beta / (2 * R), 1e-9);
        let worst = 0;
        for (let i = 0; i < 2000; i++) {
            const a = holdThrust(world, s, R, 0.5, 1.5);
            const r = Math.hypot(s.x, s.y);
            advance(world, s, 0.02, a * s.x / r, a * s.y / r);
            worst = Math.max(worst, Math.abs(Math.hypot(s.x, s.y) - R));
        }
        const rate = s.tau / (s.tau + s.dil);
        check(`hover at ${R} rs: thrust = (M/r²)/sqrt(1 − rs/r), clock at sqrt(1 − rs/r)`,
            ok1 && worst < 1e-5 && near(rate, Math.sqrt(1 - 1 / R), 1e-5),
            `a = ${fx(a0, 5)} c²/rs, rate ${fx(rate, 5)}, wander ${worst.toExponential(1)}`);
    }
}

section("the two far-away times agree about round trips");
{
    // T − t must be the known function of r alone, along ANY path, however
    // it was flown. This is the end-to-end check on the far-clock integral.
    const world = { rs: 1 };
    const h = (r) => { const u = Math.sqrt(r); return 2 * u + Math.log((u - 1) / (u + 1)); };
    const s = localState(1, 9, 0, 0, 0.2);
    const c0 = (s.T - s.tau - s.dil) - h(9);
    let worst = 0, rLo = 9;
    for (let i = 0; i < 3000; i++) {
        const r = Math.hypot(s.x, s.y);
        // A deliberately messy flight: dive, then fight back out, while turning.
        const push = r < 1.6 ? 1.4 : (i < 900 ? -0.05 : 0.08);
        advance(world, s, 0.05, push * s.x / r - 0.01 * s.y / r, push * s.y / r + 0.01 * s.x / r);
        const rr = Math.hypot(s.x, s.y);
        rLo = Math.min(rLo, rr);
        worst = Math.max(worst, Math.abs((s.T - s.tau - s.dil) - h(rr) - c0));
    }
    check("T − t = 2√(r·rs) + rs·ln((√r−√rs)/(√r+√rs)) along a powered dive", worst < 2e-6 && rLo < 2,
        `max error ${worst.toExponential(2)}, dived to ${fx(rLo, 4)} rs`);
}

section("special relativity (no gravity at all)");
{
    const world = { rs: 0 };
    const a = 0.15, tau = 13.8;
    const s = makeShip(1, 0, 0, 0);
    advance(world, s, tau, a, 0);
    const d = diagnose(world, s);
    check("constant thrust gives v = tanh(aτ), never c", near(d.vRiver, Math.tanh(a * tau), 1e-5), `${fx(d.vRiver)} c after Δv = ${fx(a * tau, 3)} c`);
    check("distance (cosh(aτ) − 1)/a", near(s.x - 1, (Math.cosh(a * tau) - 1) / a, 1e-5));
    check("far time sinh(aτ)/a", near(s.tau + s.dil, Math.sinh(a * tau) / a, 1e-5), `${fx(s.tau + s.dil)} vs ship ${tau}`);
}

section("weak field: the GPS numbers");
{
    const R_E = 6.371e6, rs = rsMeters(MSUN_KG ? 3.0035e-6 : 0) / R_E;   // Earth = 3.0035e-6 M☉
    const world = { rs: rs, R: 1 };
    const s = circularState(rs, 26.56e6 / R_E, 0, 1);
    const d = diagnose(world, s);
    const day = 86400e6;                                   // µs per day
    const ground = rs / (1 + Math.sqrt(1 - rs));           // what a ground clock loses
    const gravGain = (ground - d.gravLoss) * day;
    const speedLoss = d.speedLoss * day;
    check("GPS gravity term ≈ +45.7 µs/day", Math.abs(gravGain - 45.7) < 0.4, fx(gravGain, 4));
    check("GPS speed term ≈ −7.2 µs/day", Math.abs(speedLoss - 7.2) < 0.1, fx(-speedLoss, 4));
    // and the integrated far clock carries that precision
    advance(world, s, 2e6, 0, 0);
    const rate = s.dil / s.tau;
    check("integrated drift keeps ten digits", near(rate, d.gravLoss + d.speedLoss, 1e-4), `${rate.toExponential(5)} vs ${(d.gravLoss + d.speedLoss).toExponential(5)}`);
}

/* =========================================================== 2. light */
section("light");
{
    const rs = 1;
    // Weak bending: fire a ray past the hole at impact parameter b = 50 rs.
    const b = 50, p = { x: -4000, y: b, kx: 1, ky: 0 };
    const b0 = Math.abs(photonImpact(rs, p));
    // Direction of travel ON THE CHART is k + V: the river's drift is part of it.
    const heading = function (q) {
        const o = [0, 0, 0, 0]; photonDeriv(rs, q.x, q.y, q.kx, q.ky, o);
        return Math.atan2(o[1], o[0]);
    };
    const h0 = heading(p);
    let worst = 0;
    for (let i = 0; i < 800; i++) { advancePhoton(rs, p, 10); worst = Math.max(worst, Math.abs(Math.abs(photonImpact(rs, p)) - b0)); }
    const bend = h0 - heading(p);
    const M = 0.5, expect = 4 * M / b0 + (15 * Math.PI / 4) * (M / b0) * (M / b0);
    check("impact parameter is conserved along a ray", worst < 1e-6 * b, worst.toExponential(2));
    check("deflection = 4M/b + (15π/4)(M/b)²", near(bend, expect, 0.02), `${fx(bend, 5)} vs ${fx(expect, 5)} rad`);

    // The photon sphere: light fired sideways by a hoverer at 1.5 rs circles.
    const q = photonFromHoverer(rs, 1.5, 0, Math.PI / 2);
    let w2 = 0;
    for (let i = 0; i < 40; i++) { advancePhoton(rs, q, 0.1); w2 = Math.max(w2, Math.abs(Math.hypot(q.x, q.y) - 1.5)); }
    check("light orbits at 1.5 rs", w2 < 1e-4, `wander ${w2.toExponential(2)} over a quarter turn`);
    check("and that ray has the critical impact parameter (3√3/2) rs", near(Math.abs(photonImpact(rs, q)), B_CRIT, 1e-6));

    // Radial light-travel time, closed form against the integrator.
    const ray = { x: 1.05, y: 0, kx: 1, ky: 0 };
    let T = 0; while (ray.x < 20) { advancePhoton(rs, ray, 0.01); T += 0.01; }
    check("outgoing radial ray: T = rs·[u² + 2u + 2ln(u−1)]", near(T, lightTimeOut(rs, 1.05, ray.x), 2e-3), `${fx(T, 5)} vs ${fx(lightTimeOut(rs, 1.05, ray.x), 5)}`);

    // Inside the horizon an "outward" ray still falls.
    const inn = { x: 0.9, y: 0, kx: 1, ky: 0 };
    advancePhoton(rs, inn, 0.05);
    check("inside the horizon, light aimed outward moves inward", inn.x < 0.9, `0.9 → ${fx(inn.x, 5)}`);
}

/* =========================================================== 3. the sky */
if (typeof skyMap === "function") {
    section("the view out of the window");
    const flat = skyMap(0, 10, 64);
    let worstFlat = 0;
    for (let i = 0; i < flat.n; i++) worstFlat = Math.max(worstFlat, Math.abs(flat.psi[i] - (Math.PI - flat.alpha[i])));
    check("with no mass the sky is undistorted", worstFlat < 1e-6, worstFlat.toExponential(2));

    check("a falling observer at the horizon sees a 42° shadow", Math.abs(shadowAngle(1, 1) * 180 / Math.PI - 42.1) < 0.1,
        fx(shadowAngle(1, 1) * 180 / Math.PI, 5) + "°");
    const far = shadowAngle(1, 400);
    check("far away the shadow is (3√3/2)rs/r, shrunk by the fall", near(far, (B_CRIT / 400) * (1 - Math.sqrt(1 / 400)), 0.01), fx(far, 5));
    check("the shadow grows smoothly through the photon sphere", shadowAngle(1, 1.49) > shadowAngle(1, 1.51) &&
        Math.abs(shadowAngle(1, 1.49) - shadowAngle(1, 1.51)) < 0.02);
    check("and tends to half the sky at the singularity", Math.abs(shadowAngle(1, 1e-4) - Math.PI / 2) < 0.02, fx(shadowAngle(1, 1e-4), 5));

    const m = skyMap(1, 30, 200);
    let mono = true;
    for (let i = 1; i < m.n; i++) if (m.psi[i] >= m.psi[i - 1]) mono = false;
    check("the ray map is monotonic (so it can be inverted)", mono, `${m.n} rays, max sweep ${fx(m.psi[0], 4)} rad`);
    const a = 0.9, inv = skyInverse(m, skyLookup(m, a));
    check("inverse lookup returns the ray it came from", Math.abs(inv - a) < 1e-4, `${fx(inv, 6)} vs ${fx(a, 6)}`);

    /* End to end, against the OTHER integrator. The table is built from the
     * orbit equation u(φ) traced backwards; this fires real photons forwards
     * through the river from a star at true angle Ψ, finds the one that hits
     * the observer, and asks which direction it arrived from. Two independent
     * routes to the same number, for the direct image and for the one that
     * went round the back of the hole. */
    const rObs = 30, PsiStar = 2.6;
    const sX = Math.cos(PsiStar), sY = Math.sin(PsiStar);
    const shoot = function (b) {
        const p = { x: 3000 * sX - b * sY, y: 3000 * sY + b * sX, kx: -sX, ky: -sY };
        for (let i = 0; i < 400000; i++) {
            const x0 = p.x, y0 = p.y, k0 = p.kx;
            const far = Math.hypot(p.x, p.y) > 120;
            if (!advancePhoton(1, p, far ? 4 : 0.05)) return null;
            if (x0 < rObs && p.x >= rObs) {
                const f = (rObs - x0) / (p.x - x0);
                return { y: y0 + f * (p.y - y0), kx: k0 + f * (p.kx - k0) };
            }
            if (Math.hypot(p.x, p.y) > 4000) return null;
        }
        return null;
    };
    /* A ray that is swallowed, or bent clean round, counts as "bent too far":
     * +1. Otherwise the sign of where it crossed the observer's line. */
    const side = function (b) { const h = shoot(b); return !h || h.y > 0 ? 1 : -1; };
    const solve = function (lo, hi) {
        const slo = side(lo);
        for (let i = 0; i < 50; i++) {
            const mid = 0.5 * (lo + hi);
            if (side(mid) === slo) lo = mid; else hi = mid;
        }
        const h = shoot(hi) || shoot(lo);
        return Math.acos(h.kx);
    };
    const direct = solve(-26, -12), table1 = skyInverse(m, PsiStar);
    check("direct image: photon integrator and ray table agree", Math.abs(direct - table1) < 2e-3,
        `${fx(direct, 5)} vs ${fx(table1, 5)} rad (undeflected would be ${fx(Math.PI - PsiStar, 5)})`);
    const second = solve(2.7, 9), table2 = skyInverse(m, 2 * Math.PI - PsiStar);
    check("second image, round the far side: they agree there too", Math.abs(second - table2) < 2e-3,
        `${fx(second, 5)} vs ${fx(table2, 5)} rad, shadow edge at ${fx(m.shadow, 5)}`);

    const img = new Float64Array(10);
    const cnt = skyImages(m, 1, 0, sX, sY, 0, img);
    check("a star behind the hole has two images, on opposite sides", cnt === 2 && img[1] > 0 && img[6] < 0,
        `magnifications ${fx(img[3], 3)} and ${fx(img[8], 3)}`);
    const ab = [0, 0, 0], dop = aberrate(1, 0, 0, 0.6, 0, ab);
    check("aberration: head-on Doppler is sqrt((1+v)/(1−v))", near(dop, 2, 1e-12) && near(ab[0], 1, 1e-12));
    const ab2 = [0, 0, 0]; aberrate(0, 1, 0, 0.6, 0, ab2);
    check("aberration: a star abeam swings forward to cos θ = v", near(ab2[0], 0.6, 1e-12) && near(Math.hypot(ab2[0], ab2[1], ab2[2]), 1, 1e-12));
    const inside = skyMap(1, 0.5, 200);
    check("there is still a sky to see inside the horizon", inside.n > 50 && inside.alpha[0] > shadowAngle(1, 0.5) - 1e-9);
}

/* =========================================================== 4. missions */
if (typeof MISSIONS !== "undefined" && typeof flyMission === "function") {
    section("every mission can be flown");
    for (const m of MISSIONS) {
        if (!m.pilot) { console.log(`      ${m.id}: no scripted pilot`); continue; }
        const res = flyMission(m);
        check(`${m.id} — ${m.title}`, res.won, res.note);
    }
    // …and the one that is supposed to be impossible, is.
    const tides = MISSIONS.find((m) => m.id === "tides");
    const small = flyMission(tides, { variant: "small" });
    check("tides (small hole) — the hull fails long before the horizon",
        small.sim.status === "lost" && small.sim.failCode === "tides" && small.sim.d.r > 20,
        `${small.sim.reason} at ${fx(small.sim.d.r, 4)} rs, tide ${fx(small.sim.tideG(), 3)} g`);
}

/* =========================================================== 5. inside the horizon */
if (typeof MISSIONS !== "undefined" && typeof flyMission === "function") {
    section("inside the horizon: what buys time, and what costs it");
    /* The known result (Lewis & Kwan 2007): the longest life inside belongs
     * to the E = 0 geodesic. Arriving with E > 0, a burn outward helps until
     * E reaches zero and hurts after that; a burn inward always hurts. The
     * star ratings of the last mission are set from these same flights. */
    const M = MISSIONS.find((m) => m.id === "plunge"), saved = PILOTS.plunge;
    const toFloor = (sim, mem) => { if (!mem.go && !sim.hoverFloor) return { hover: true, climb: -1 }; mem.go = true; return null; };
    const fly = function (pilot) { PILOTS.plunge = pilot; const r = flyMission(M); return { frac: r.sim.marks.inside / MAX_INSIDE, stars: r.stars }; };
    const inward = fly((sim) => sim.d.inside ? { hover: false, align: "in", thrust: 1 } : { hover: false });
    const coast = fly(() => ({ hover: false }));
    const floor = fly((sim, mem) => toFloor(sim, mem) || { hover: false });
    const smart = fly((sim, mem) => toFloor(sim, mem) || (sim.d.inside && sim.d.E > 0.01 ? { hover: false, align: "out", thrust: 1 } : { hover: false }));
    const stubborn = fly((sim, mem) => toFloor(sim, mem) || (sim.d.inside ? { hover: false, align: "out", thrust: 1 } : { hover: false }));
    PILOTS.plunge = saved;
    const pc = (v) => (100 * v.frac).toFixed(0) + "% (" + v.stars + "★)";
    check("burning inward is worse than doing nothing", inward.frac < coast.frac, `${pc(inward)} < ${pc(coast)}`);
    check("letting go from as low as the engine can hold is better", floor.frac > coast.frac + 0.15, `${pc(floor)} > ${pc(coast)}`);
    check("a burn outward until E = 0 is better still", smart.frac > floor.frac, `${pc(smart)} > ${pc(floor)}`);
    check("…but burning outward all the way down throws it away again", stubborn.frac < smart.frac, `${pc(stubborn)} < ${pc(smart)}`);
    check("nothing beats π/2 · rs/c", Math.max(inward.frac, coast.frac, floor.frac, smart.frac, stubborn.frac) < 1);
    check("and the three strategies earn one, two and three stars", coast.stars === 1 && floor.stars === 2 && smart.stars === 3);

    section("the hover autopilot knows its limits");
    const sb = new Sim(MISSIONS.find((m) => m.id === "sandbox"));
    let lo = Infinity;
    for (let f = 0; f < 60 * 40 && sb.status === "flying"; f++) { sb.step(1 / 60, sb.timeScale / 60, { hover: true, climb: -1 }); lo = Math.min(lo, sb.d.r); }
    check("told to descend for ever, it stops where it can still hold the ship", sb.status === "flying" && sb.hoverFloor && lo > 1.05 && sb.throttle < 0.85,
        `floor at ${fx(lo, 5)} rs, ${(100 * sb.throttle).toFixed(0)}% thrust, clock rate ${fx(Math.sqrt(1 - 1 / lo), 3)}`);
}

console.log(`\n${failures ? "\x1b[31m" : "\x1b[32m"}${checks - failures}/${checks} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
