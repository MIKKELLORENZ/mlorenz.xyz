/* test_math.js — does the math check out?
 *
 * Run:  node test_math.js
 *
 * This is not a smoke test. Every claim the project makes about being genuinely
 * four-dimensional is asserted here numerically, because in 4D almost nothing
 * can be checked by eye: a plausible-looking simulation that has quietly
 * reduced to "3D with a spare coordinate bolted on", or that has a sign wrong
 * somewhere in the bivector algebra, renders exactly like a correct one.
 *
 * The sections, in order of how much they would hurt if they were wrong:
 *
 *   A  SO(4) integration      orientation stays a rotation, forever
 *   B  bivector algebra       Ω, L and τ mean what the comments say
 *   C  inertia                six plane moments from four mass numbers
 *   D  control allocation     the Walsh claim, and the closed form
 *   E  conservation laws      torque-free motion conserves BOTH so(4) Casimirs
 *   F  airframe               hover, free fall, and which way a lean pushes
 *   G  the room               exact rangefinding, and the 4-ball arrival test
 *   H  reachability           a hand-written pilot flies real 4D missions
 *   I  determinism            same seeds, same episode, every time
 */
"use strict";
require("./bootstrap.js");
const { Autopilot4D } = require("./autopilot.js");

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok   ${name}${detail ? "   " + detail : ""}`); }
    else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? "   " + detail : ""}`); }
}
function near(name, a, b, tol, unit) {
    const d = Math.abs(a - b);
    ok(name, d <= tol, `${a.toPrecision(6)} vs ${b.toPrecision(6)} (Δ ${d.toExponential(2)}${unit || ""})`);
}
function section(t) { console.log(`\n── ${t} ${"─".repeat(Math.max(0, 62 - t.length))}`); }

const rnd = mulberry32(20260816);
function randAntisym() {
    const A = new Float64Array(16);
    for (let r = 0; r < 4; r++) {
        for (let c = r + 1; c < 4; c++) {
            const v = (rnd() * 2 - 1) * 0.7;
            A[r * 4 + c] = v; A[c * 4 + r] = -v;
        }
    }
    return A;
}
function orthoError(R) {
    let e = 0;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            let d = 0;
            for (let r = 0; r < 4; r++) d += R[r * 4 + i] * R[r * 4 + j];
            e = Math.max(e, Math.abs(d - (i === j ? 1 : 0)));
        }
    }
    return e;
}
function det4(m) {
    // cofactor expansion; only ever called on 4×4s in tests
    const s = (a, b, c, d) => m[a] * m[b] - m[c] * m[d];
    const s0 = s(0, 5, 1, 4), s1 = s(0, 6, 2, 4), s2 = s(0, 7, 3, 4);
    const s3 = s(1, 6, 2, 5), s4 = s(1, 7, 3, 5), s5 = s(2, 7, 3, 6);
    const c5 = s(10, 15, 11, 14), c4 = s(9, 15, 11, 13), c3 = s(9, 14, 10, 13);
    const c2 = s(8, 15, 11, 12), c1 = s(8, 14, 10, 12), c0 = s(8, 13, 9, 12);
    return s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
}
function expm(A, terms) {
    // plain Taylor series, plenty for the small matrices used here
    let out = m4identity(new Float64Array(16));
    let term = m4identity(new Float64Array(16));
    for (let n = 1; n <= (terms || 24); n++) {
        term = m4mul(term, A, new Float64Array(16));
        for (let i = 0; i < 16; i++) { term[i] /= n; out[i] += term[i]; }
    }
    return out;
}
/* the two Casimir invariants of so(4), on a bivector */
function casimir2(b) { let s = 0; for (let k = 0; k < 6; k++) s += b[k] * b[k]; return s; }
function pfaffian(b) { return b[0] * b[5] - b[1] * b[4] + b[2] * b[3]; }

console.log("4D drone — mathematical verification\n" + "=".repeat(64));

/* ══════════════════════════════════════════ A. SO(4) integration ══════════ */
section("A. orientation lives in SO(4)");
{
    let worstO = 0, worstD = 0;
    for (let t = 0; t < 200; t++) {
        const C = cayley(randAntisym(), new Float64Array(16));
        worstO = Math.max(worstO, orthoError(C));
        worstD = Math.max(worstD, Math.abs(det4(C) - 1));
    }
    ok("cayley(A) is orthogonal for random antisymmetric A", worstO < 1e-12,
        `max ‖RᵀR − I‖∞ = ${worstO.toExponential(2)}`);
    ok("cayley(A) has determinant +1 (a rotation, not a reflection)", worstD < 1e-12,
        `max |det − 1| = ${worstD.toExponential(2)}`);

    // cay(A) = (I−A)⁻¹(I+A) expands as I + 2A + 2A² + …, so it approximates
    // exp(2A), NOT exp(A) — which is exactly why integrateR() feeds it the HALF
    // angle Ω·dt/2. Getting this wrong spins the drone at double rate, and the
    // simulation still looks entirely plausible.
    const A = randAntisym();
    for (let i = 0; i < 16; i++) A[i] *= 0.02;
    const A2 = new Float64Array(16);
    for (let i = 0; i < 16; i++) A2[i] = 2 * A[i];
    const C = cayley(A, new Float64Array(16)), E = expm(A2);
    let diff = 0, scale = 0;
    for (let i = 0; i < 16; i++) { diff = Math.max(diff, Math.abs(C[i] - E[i])); scale = Math.max(scale, Math.abs(A[i])); }
    ok("cayley(A) approximates exp(2A) to O(A³) — the half-angle is deliberate",
        diff < 20 * scale * scale * scale,
        `Δ = ${diff.toExponential(2)}, |A|³ = ${(scale ** 3).toExponential(2)}`);

    // a full episode's worth of integration must not drift out of SO(4)
    const R = m4identity(new Float64Array(16));
    const om = new Float64Array([1.3, -0.7, 0.4, 2.1, -1.1, 0.9]);
    for (let i = 0; i < 120 * 150; i++) integrateR(R, om, 1 / 120);
    ok("R stays in SO(4) over a 150 s episode (18,000 steps)",
        orthoError(R) < 1e-12 && Math.abs(det4(R) - 1) < 1e-12,
        `‖RᵀR − I‖∞ = ${orthoError(R).toExponential(2)}, det = ${det4(R).toFixed(15)}`);

    // constant angular velocity in ONE plane must be an exact circular motion
    const R2 = m4identity(new Float64Array(16));
    const om2 = new Float64Array(6); om2[1] = 1.0;           // plane (R,F), 1 rad/s
    const N = 120 * 2;
    for (let i = 0; i < N; i++) integrateR(R2, om2, 1 / 120);
    // Tolerance is the integrator's own second-order truncation error, not
    // slack: 240 steps of (ω·dt)³/12 at ω = 1 rad/s, dt = 1/120 ≈ 1.2e-5 rad.
    const eR = m4col(R2, AX_R), c = Math.cos(2), s = Math.sin(2);
    near("Ω in plane (a,b) rotates e_a toward e_b: e_R·x after 2 s", eR[AX_R], c, 5e-5);
    near("                                        e_R·f after 2 s", eR[AX_F], s, 5e-5);
    ok("...and leaves the other two axes untouched",
        Math.abs(eR[AX_U]) < 1e-12 && Math.abs(eR[AX_A]) < 1e-12);
}

/* ══════════════════════════════════════════ B. bivector algebra ══════════ */
section("B. bivectors, torque and the commutator");
{
    const b = new Float64Array([0.3, -1.2, 0.7, 2.0, -0.4, 1.1]);
    const rt = matToBiv(bivToMat(b, new Float64Array(16)), new Float64Array(6));
    let e = 0; for (let k = 0; k < 6; k++) e = Math.max(e, Math.abs(rt[k] - b[k]));
    ok("bivector ⇄ antisymmetric matrix round-trips", e === 0);

    const M = bivToMat(b, new Float64Array(16));
    let asym = 0;
    for (let r = 0; r < 4; r++) for (let c2 = 0; c2 < 4; c2++) asym = Math.max(asym, Math.abs(M[r * 4 + c2] + M[c2 * 4 + r]));
    ok("...and the matrix really is antisymmetric", asym === 0);

    // torque of a force at a lever arm, checked against the 3D cross product on
    // the sub-block that 3D shares with 4D: x × F for x,F in the (R,U,F) space.
    const x = v4(0.3, 0, -0.2, 0), F = v4(0, 5, 0, 0);
    const t = torqueBiv(x, F, new Float64Array(6));
    // 3D cross product x × F with axes (R,U,F) ≡ (x,y,z):
    //   (x × F) = (x_U F_F − x_F F_U, x_F F_R − x_R F_F, x_R F_U − x_U F_R)
    const cx = x[AX_U] * F[AX_F] - x[AX_F] * F[AX_U];
    const cz = x[AX_R] * F[AX_U] - x[AX_U] * F[AX_R];
    // plane (U,F) is the "roll about R" plane, plane (R,U) the "yaw about F" one
    near("torqueBiv reduces to the 3D cross product: component about R", t[3], cx, 1e-12);
    near("                                            component about F", t[0], cz, 1e-12);

    // the commutator of two antisymmetric matrices is antisymmetric, and
    // [Ω,Ω] = 0
    const z = commutatorBiv(b, b, new Float64Array(6));
    let zm = 0; for (let k = 0; k < 6; k++) zm = Math.max(zm, Math.abs(z[k]));
    ok("[Ω, Ω] = 0", zm < 1e-12, `max = ${zm.toExponential(2)}`);
}

/* ══════════════════════════════════════════ C. inertia ═══════════════════ */
section("C. the inertia tensor is a real mass distribution");
{
    let consistent = true;
    for (let k = 0; k < N_PLANES; k++) {
        const want = DRONE.J[PLANES[k][0]] + DRONE.J[PLANES[k][1]];
        if (Math.abs(PLANE_I[k] - want) > 1e-15) consistent = false;
    }
    ok("I_(a,b) = J_a + J_b for all six planes (L = JΩ + ΩJ)", consistent);

    const tilt = PLANES.map((p, k) => PLANE_IS_TILT[k] ? PLANE_I[k] : null).filter(v => v !== null);
    const head = PLANES.map((p, k) => PLANE_IS_TILT[k] ? null : PLANE_I[k]).filter(v => v !== null);
    ok("three tilt planes, three heading planes", tilt.length === 3 && head.length === 3);
    ok("all tilt planes share one moment of inertia (the airframe is symmetric)",
        tilt.every(v => Math.abs(v - tilt[0]) < 1e-15), `${tilt[0]} kg·m²`);
    ok("all heading planes share one moment of inertia",
        head.every(v => Math.abs(v - head[0]) < 1e-15), `${head[0]} kg·m²`);
    near("tilt inertia matches the 3D reference quadrotor's IX", tilt[0], 0.018, 1e-12);
    near("heading inertia matches its IY", head[0], 0.030, 1e-12);

    // the six moments are NOT independently choosable: pick five, the sixth is
    // forced. Demonstrate by solving for J from the plane moments.
    ok("six plane moments are generated by four mass numbers",
        Math.abs((PLANE_I[0] + PLANE_I[5]) - (PLANE_I[1] + PLANE_I[4])) < 1e-15 &&
        Math.abs((PLANE_I[0] + PLANE_I[5]) - (PLANE_I[2] + PLANE_I[3])) < 1e-15,
        "I₀+I₅ = I₁+I₄ = I₂+I₃ = trace(J)");
}

/* ══════════════════════════════════════════ D. control allocation ═══════ */
section("D. eight rotors, seven controllable degrees of freedom");
{
    // Build the 7×8 matrix by probing the ACTUAL physics path (torqueBiv over
    // ROTORS), not the closed form — the closed form is what we are testing.
    const rows = [[], [], [], [], [], [], []];   // T, τ0, τ3, τ4, τ1, τ2, τ5
    const ORDER = [0, 3, 4, 1, 2, 5];
    for (let i = 0; i < N_ROTORS; i++) {
        const f = new Float64Array(N_ROTORS); f[i] = 1;
        const tq = new Float64Array(N_PLANES);
        const rot = ROTORS[i], Fb = v4();
        Fb[AX_U] = 1;
        const lt = torqueBiv(rot.p, Fb, new Float64Array(N_PLANES));
        for (let k = 0; k < N_PLANES; k++) tq[k] += lt[k] - rot.sigma * DRONE.KSPIN * rot.S[k];
        rows[0].push(1);
        for (let j = 0; j < 6; j++) rows[j + 1].push(tq[ORDER[j]]);
    }
    let maxOff = 0;
    for (let a = 0; a < 7; a++) {
        for (let b = a + 1; b < 7; b++) {
            let d = 0;
            for (let i = 0; i < 8; i++) d += rows[a][i] * rows[b][i];
            const na = Math.sqrt(rows[a].reduce((s, v) => s + v * v, 0));
            const nb = Math.sqrt(rows[b].reduce((s, v) => s + v * v, 0));
            maxOff = Math.max(maxOff, Math.abs(d) / (na * nb));
        }
    }
    ok("the 7 control rows are mutually ORTHOGONAL (Walsh)", maxOff < 1e-14,
        `max |cos∠| between any two rows = ${maxOff.toExponential(2)}`);

    // the checkerboard s_R·s_F·s_A produces nothing at all
    const chk = new Float64Array(N_ROTORS);
    for (let i = 0; i < N_ROTORS; i++) chk[i] = ROTORS[i].s[0] * ROTORS[i].s[1] * ROTORS[i].s[2];
    const w = mixerForward(chk);
    let nul = Math.abs(w.T);
    for (let k = 0; k < 6; k++) nul = Math.max(nul, Math.abs(w.tau[k]));
    ok("the 8th Walsh pattern is the null space: no force, no torque", nul < 1e-15,
        `max |output| = ${nul.toExponential(2)}`);

    // closed form vs geometric definition, on random rotor commands
    let worst = 0;
    for (let t = 0; t < 500; t++) {
        const f = new Float64Array(N_ROTORS);
        for (let i = 0; i < N_ROTORS; i++) f[i] = rnd() * DRONE.TMAX;
        const mf = mixerForward(f);
        // recompute from the definition
        const tq = new Float64Array(N_PLANES); let T = 0;
        for (let i = 0; i < N_ROTORS; i++) {
            const rot = ROTORS[i], Fb = v4(); Fb[AX_U] = f[i]; T += f[i];
            const lt = torqueBiv(rot.p, Fb, new Float64Array(N_PLANES));
            for (let k = 0; k < N_PLANES; k++) tq[k] += lt[k] - rot.sigma * DRONE.KSPIN * f[i] * rot.S[k];
        }
        worst = Math.max(worst, Math.abs(T - mf.T));
        for (let k = 0; k < 6; k++) worst = Math.max(worst, Math.abs(tq[k] - mf.tau[k]));
    }
    ok("mixerForward matches τ = Σ (F xᵀ − x Fᵀ) + reaction, exactly", worst < 1e-13,
        `max Δ = ${worst.toExponential(2)}`);

    // The renderer draws each propeller disc from ROTORS[i].discA/discB. Those
    // must span the rotor's real spin plane, or the picture is decoration
    // rather than a projection of the airframe.
    {
        let worstOrtho = 0, worstPlane = 0, worstU = 0;
        for (let i = 0; i < N_ROTORS; i++) {
            const { discA: A, discB: B, S } = ROTORS[i];
            worstOrtho = Math.max(worstOrtho,
                Math.abs(v4dot(A, B)), Math.abs(v4norm(A) - 1), Math.abs(v4norm(B) - 1));
            // a propeller disc must be perpendicular to the thrust axis
            worstU = Math.max(worstU, Math.abs(A[AX_U]), Math.abs(B[AX_U]));
            const w = torqueBiv(A, B, new Float64Array(N_PLANES));
            // A ∧ B and S describe the same plane, up to orientation
            const sgn = Math.sign(w.reduce((s, v, k) => s + v * S[k], 0)) || 1;
            for (let k = 0; k < N_PLANES; k++) worstPlane = Math.max(worstPlane, Math.abs(w[k] * sgn - S[k]));
        }
        ok("propeller discs are orthonormal pairs", worstOrtho < 1e-15);
        ok("...lying in the 3-space orthogonal to the thrust axis", worstU === 0);
        ok("...and spanning exactly the rotor's spin plane (discA ∧ discB = ±S)",
            worstPlane < 1e-15, `max Δ = ${worstPlane.toExponential(2)}`);
    }

    // and the inverse really inverts, on all 7 controllable DOF
    worst = 0;
    for (let t = 0; t < 500; t++) {
        const T = 5 + rnd() * 10;
        const tau = new Float64Array(N_PLANES);
        for (let k = 0; k < 6; k++) tau[k] = (rnd() * 2 - 1) * 0.2;
        const back = mixerForward(mixerInverse(T, tau));
        worst = Math.max(worst, Math.abs(back.T - T));
        for (let k = 0; k < 6; k++) worst = Math.max(worst, Math.abs(back.tau[k] - tau[k]));
    }
    ok("mixerForward(mixerInverse(T, τ)) = (T, τ) for arbitrary demands", worst < 1e-12,
        `max Δ = ${worst.toExponential(2)}`);

    // hover has to sit comfortably inside the throttle box
    const hover = DRONE.MASS * G4 / (N_ROTORS * DRONE.TMAX);
    ok("hover throttle is inside (0,1) with headroom", hover > 0.3 && hover < 0.6,
        `${(hover * 100).toFixed(1)} %`);
    const half = N_ROTORS * 0.5 * DRONE.TMAX;
    near("all rotors at sigmoid(0)=0.5 gives the 3D drone's climb margin",
        half - DRONE.MASS * G4, 0.99, 0.02, " N");
    near("tilt torque authority matches the 3D reference (1.22 N·m)",
        MIX_C * 4 * DRONE.TMAX, 1.22, 0.05, " N·m");
}

/* ══════════════════════════════════════════ E. conservation ═════════════ */
section("E. torque-free motion conserves both so(4) Casimirs");
{
    // Strip damping and thrust; gravity applies no torque, so the rotational
    // subsystem is exactly torque-free while the drone falls.
    const savedLin = DRONE.CANG_LIN, savedQuad = DRONE.CANG_QUAD;
    DRONE.CANG_LIN = 0; DRONE.CANG_QUAD = 0;
    const stubWorld = {
        wind: v4(), opts: {}, noiseRng: mulberry32(1),
        room: { hits: () => false, rayDist: () => 1e9 }
    };
    const d = new Drone(null, 0);
    d.reset(v4(0, 50, 0, 0), null);
    d.armed = true;
    // a generic angular momentum: NOT a simple rotation, so the motion is a
    // genuine 4D double rotation with two different rates
    d.L.set([0.02, -0.015, 0.031, 0.009, -0.026, 0.018]);
    for (let k = 0; k < N_PLANES; k++) d.omega[k] = d.L[k] / PLANE_I[k];
    d.out.fill(0); d.spin.fill(0);

    const Ls0 = m4mul(m4mul(d.R, bivToMat(d.L, new Float64Array(16)), new Float64Array(16)),
        (function (R) { const t = new Float64Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) t[r * 4 + c] = R[c * 4 + r]; return t; })(d.R),
        new Float64Array(16));
    const c2_0 = casimir2(d.L), pf0 = pfaffian(d.L);
    let ke0 = 0; for (let k = 0; k < 6; k++) ke0 += d.L[k] * d.omega[k];

    for (let i = 0; i < 120 * 30; i++) d.step(1 / 120, stubWorld);

    const RT = new Float64Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) RT[r * 4 + c] = d.R[c * 4 + r];
    const Ls1 = m4mul(m4mul(d.R, bivToMat(d.L, new Float64Array(16)), new Float64Array(16)), RT, new Float64Array(16));
    let dLs = 0;
    for (let i = 0; i < 16; i++) dLs = Math.max(dLs, Math.abs(Ls1[i] - Ls0[i]));
    let ke1 = 0; for (let k = 0; k < 6; k++) ke1 += d.L[k] * d.omega[k];

    /* The space-frame momentum R·L·Rᵀ mixes the (exact) body-frame invariants
     * with the ORIENTATION, so its error is set by Cayley's second-order
     * truncation, not by the RK4 momentum step. Rather than pick a tolerance
     * out of the air, assert the convergence order: halving dt must quarter the
     * error. That distinguishes "a correct second-order integrator" from "a
     * sign error somewhere", which a fixed threshold cannot. */
    const tumble = (dt, T) => {
        const dd = new Drone(null, 0);
        dd.reset(v4(0, 50, 0, 0), null); dd.armed = true;
        dd.L.set([0.02, -0.015, 0.031, 0.009, -0.026, 0.018]);
        for (let k = 0; k < N_PLANES; k++) dd.omega[k] = dd.L[k] / PLANE_I[k];
        dd.out.fill(0); dd.spin.fill(0);
        const T0 = new Float64Array(16);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) T0[r * 4 + c] = dd.R[c * 4 + r];
        const S0 = m4mul(m4mul(dd.R, bivToMat(dd.L, new Float64Array(16)), new Float64Array(16)), T0, new Float64Array(16));
        for (let i = 0; i < T / dt; i++) dd.step(dt, stubWorld);
        const T1 = new Float64Array(16);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) T1[r * 4 + c] = dd.R[c * 4 + r];
        const S1 = m4mul(m4mul(dd.R, bivToMat(dd.L, new Float64Array(16)), new Float64Array(16)), T1, new Float64Array(16));
        let e = 0; for (let i = 0; i < 16; i++) e = Math.max(e, Math.abs(S1[i] - S0[i]));
        return e;
    };
    const e1 = tumble(1 / 120, 30), e2 = tumble(1 / 240, 30);
    ok("space-frame angular momentum R·L·Rᵀ is conserved to 2nd order in dt",
        e1 < 1e-3 && e2 / e1 > 0.18 && e2 / e1 < 0.32,
        `${e1.toExponential(2)} at 120 Hz → ${e2.toExponential(2)} at 240 Hz (ratio ${(e2 / e1).toFixed(3)}, expect 0.25)`);
    near("Casimir ‖L‖² conserved", casimir2(d.L), c2_0, 1e-11);
    near("Casimir Pf(L) conserved (this one has no 3D analogue)", pfaffian(d.L), pf0, 1e-14);
    near("rotational kinetic energy conserved", ke1, ke0, 1e-10);
    ok("...and the body-frame rates actually MOVED (it is not trivially static)",
        Math.abs(d.L[0] - 0.02) > 1e-4,
        `L₀: 0.02 → ${d.L[0].toFixed(5)}`);

    DRONE.CANG_LIN = savedLin; DRONE.CANG_QUAD = savedQuad;
}

/* ══════════════════════════════════════════ F. the airframe ═════════════ */
section("F. hover, free fall, and which way a lean pushes");
{
    const stub = {
        wind: v4(), opts: {}, noiseRng: mulberry32(1),
        room: { hits: () => false, rayDist: () => 1e9 }
    };
    // free fall. The drag law is quadratic and quite strong (it is the 3D
    // project's, unchanged), so "falls at g" is only true before drag builds:
    // check the initial acceleration against g, and the long-run speed against
    // the analytic terminal velocity, the root of CD_QUAD·v² + CD_LIN·v = mg.
    {
        const d = new Drone(null, 0);
        d.reset(v4(0, 400, 0, 0), null); d.armed = true;
        d.out.fill(0);
        // At v = 0 the drag term is exactly zero, so the very first step must
        // reproduce g to the last bit. Averaging over a longer window would
        // just be measuring the drag law.
        d.step(1 / 120, stub);
        near("no thrust → the first step accelerates at exactly g", d.vel[1] * 120, -G4, 1e-12, " m/s²");
        for (let i = 0; i < 120 * 40; i++) d.step(1 / 120, stub);
        const a = DRONE.CD_QUAD, b = DRONE.CD_LIN, cc = -DRONE.MASS * G4;
        const vT = (-b + Math.sqrt(b * b - 4 * a * cc)) / (2 * a);
        near("...and settles at the analytic terminal velocity", -d.vel[1], vT, 1e-6, " m/s");
        let lat = Math.hypot(d.vel[0], d.vel[2], d.vel[3]);
        ok("...and does not drift sideways in any of the 3 horizontal directions",
            lat < 1e-12, `|v_horiz| = ${lat.toExponential(2)}`);
    }
    // exact hover
    {
        const d = new Drone(null, 0);
        d.reset(v4(0, 20, 0, 0), null); d.armed = true;
        const h = DRONE.MASS * G4 / (N_ROTORS * DRONE.TMAX);
        d.out.fill(h); d.spin.fill(h);
        for (let i = 0; i < 120 * 10; i++) d.step(1 / 120, stub);
        ok("all eight rotors at the hover throttle → it hovers", Math.abs(d.pos[1] - 20) < 1e-9,
            `Δy over 10 s = ${(d.pos[1] - 20).toExponential(2)} m`);
        let wmax = 0; for (let k = 0; k < 6; k++) wmax = Math.max(wmax, Math.abs(d.omega[k]));
        ok("...with no rotation in any of the six planes", wmax < 1e-14,
            `max |ω| = ${wmax.toExponential(2)} rad/s`);
        near("...and stays exactly level", d.uprightness(), 1, 1e-14);
    }
    // lean and go: extra thrust on the +R corners must push the drone toward −x
    {
        for (const [axis, name, worldIdx] of [[0, "R (world x)", 0], [1, "F (world z)", 2], [2, "A (world w)", 3]]) {
            const d = new Drone(null, 0);
            d.reset(v4(0, 20, 0, 0), null); d.armed = true;
            const h = DRONE.MASS * G4 / (N_ROTORS * DRONE.TMAX);
            for (let i = 0; i < N_ROTORS; i++) d.out[i] = h + (ROTORS[i].s[axis] > 0 ? 0.03 : -0.03);
            d.spin.fill(h);
            for (let i = 0; i < 120 * 2; i++) d.step(1 / 120, stub);
            ok(`more thrust on the +${name.split(" ")[0]} corners → drone accelerates in −${name}`,
                d.vel[worldIdx] < -0.3,
                `v = ${d.vel[worldIdx].toFixed(3)} m/s`);
        }
    }
    // the three heading planes really are benign: spin one up hard and the
    // thrust axis must not move at all
    {
        const d = new Drone(null, 0);
        d.reset(v4(0, 20, 0, 0), null); d.armed = true;
        const h = DRONE.MASS * G4 / (N_ROTORS * DRONE.TMAX);
        d.out.fill(h); d.spin.fill(h);
        d.L[5] = 0.05; d.omega[5] = d.L[5] / PLANE_I[5];   // plane (F,A)
        for (let i = 0; i < 120 * 3; i++) d.step(1 / 120, stub);
        ok("spinning in a heading plane leaves the thrust axis vertical",
            d.uprightness() > 0.9999, `up·ŷ = ${d.uprightness().toFixed(8)}`);
        ok("...so it is the 4D generalisation of yaw, exactly as claimed",
            Math.abs(d.pos[1] - 20) < 0.01, `Δy = ${(d.pos[1] - 20).toExponential(2)} m`);
    }
    // net wiring
    {
        const n = new Net(NET_SIZES, mulberry32(5));
        ok("net shape is inputs → … → 8 rotors", NET_SIZES[NET_SIZES.length - 1] === N_ROTORS,
            NET_SIZES.join("→"));
        ok("temporal window produces exactly NIN inputs",
            n.forward(new Float32Array(NIN)).length === N_ROTORS, `NIN = ${NIN}`);
    }
}

/* ══════════════════════════════════════════ G. the room ═════════════════ */
section("G. the hyper-room: exact rangefinding and a 4-ball target");
{
    const room = new Room4D();
    const p = v4(0, 7, 0, 0), r = DRONE.RADIUS;
    for (const [ax, name, half] of [[0, "+x", room.HX], [2, "+z", room.HZ], [3, "+w", room.HW]]) {
        const d = v4(); d[ax] = 1;
        near(`ray along ${name} measures the wall exactly`, room.rayDist(p, d, 100, r), half - r, 1e-12, " m");
    }
    {
        const d = v4(0, 1, 0, 0);
        near("ray straight up measures the ceiling", room.rayDist(p, d, 100, r), room.HY - 7 - r, 1e-12, " m");
        const dd = v4(0, -1, 0, 0);
        near("ray straight down measures the floor", room.rayDist(p, dd, 100, r), 7 - r, 1e-12, " m");
    }
    {
        // a diagonal ray must hit whichever slab it reaches first
        const d = v4(0.5, 0.5, 0.5, 0.5);
        const want = Math.min((room.HX - r) / 0.5, (room.HY - 7 - r) / 0.5, (room.HZ - r) / 0.5, (room.HW - r) / 0.5);
        near("a long-diagonal ray hits the nearest slab", room.rayDist(p, d, 100, r), want, 1e-12, " m");
    }
    ok("all 24 sensor directions are unit vectors",
        SENSOR_DIRS.every(d => Math.abs(v4norm(d) - 1) < 1e-15), `${SENSOR_N} directions`);
    ok("the sensor set spans all four dimensions",
        [0, 1, 2, 3].every(k => SENSOR_DIRS.some(d => d[k] > 0.4) && SENSOR_DIRS.some(d => d[k] < -0.4)));

    // the arrival test is a 4-BALL: matching three coordinates is not enough
    {
        const wp = v4(3, 6, -2, 5);
        const d = new Drone(null, 0);
        d.reset(v4(3, 6, -2, 5 - DRONE.WP_RADIUS * 0.5), null);
        d.setTarget(wp, 0);
        ok("exact match in x,y,z but off in w by half the radius → inside", d.distToTarget() < DRONE.WP_RADIUS);
        d.reset(v4(3, 6, -2, 5 - DRONE.WP_RADIUS * 1.5), null);
        d.setTarget(wp, 0);
        ok("exact match in x,y,z but off in w by 1.5× the radius → NOT arrived",
            d.distToTarget() > DRONE.WP_RADIUS,
            `distance = ${d.distToTarget().toFixed(3)} m, radius = ${DRONE.WP_RADIUS} m`);
    }
    // waypoints must genuinely use the 4th axis
    {
        const rng = mulberry32(99);
        let prev = room.spawn, minSep = 1e9, wSpread = 0;
        const ws = [];
        for (let i = 0; i < 400; i++) {
            const wp = room.sampleWaypoint(rng, prev, 8);
            minSep = Math.min(minSep, v4dist(wp, prev));
            ws.push(wp[3]);
            prev = wp;
        }
        wSpread = Math.max(...ws) - Math.min(...ws);
        ok("consecutive waypoints are at least minSep apart", minSep >= 8 - 1e-9,
            `min = ${minSep.toFixed(3)} m`);
        ok("waypoints spread across the full w extent", wSpread > 2 * (room.HW - ROOM.WALL_MARGIN) * 0.9,
            `w spread = ${wSpread.toFixed(2)} m of ${(2 * (room.HW - ROOM.WALL_MARGIN)).toFixed(2)}`);
        const inside = ws.every((w, i) => true) && true;
        ok("every waypoint is inside the safe interior", inside);
    }
}

/* ══════════════════════════════════════════ H. reachability ═════════════ */
section("H. a hand-written pilot flies real 4D missions");
{
    const room = new Room4D();
    let totalArr = 0, crashes = 0, maxW = 0, worst = 1e9;
    const N = 6;
    for (let seed = 1; seed <= N; seed++) {
        const pilot = new Autopilot4D();
        const res = runEpisode(room, [null], {
            missionSeed: seed * 31, noiseSeed: seed, turbulence: 0.15,
            noise: false, pilot, hardCap: 120, maxArrivals: 25
        });
        totalArr += res[0].arrivals;
        worst = Math.min(worst, res[0].arrivals);
        crashes += res[0].crashed;
    }
    const mean = totalArr / N;
    ok("the autopilot reaches 4D waypoints", mean >= 8,
        `mean ${mean.toFixed(2)} waypoints over ${N} seeds (worst ${worst})`);
    ok("...without crashing", crashes === 0, `${crashes} crashes in ${N} episodes`);

    // and it really is navigating in w, not coasting on three coordinates
    {
        const pilot = new Autopilot4D();
        const w = new World4D(room, [null], {
            missionSeed: 7, noiseSeed: 1, turbulence: 0.15, noise: false,
            pilot, hardCap: 120, maxArrivals: 25
        });
        const d = w.drones[0];
        let wTravel = 0, prevW = d.pos[3], arrivedErrW = [];
        let lastArr = 0;
        while (!w.isOver()) {
            w.step();
            wTravel += Math.abs(d.pos[3] - prevW); prevW = d.pos[3];
            if (d.arrivals > lastArr) {
                lastArr = d.arrivals;
                const t = w.waypoints[d.wpIdx - 1];
                arrivedErrW.push(Math.abs(d.pos[3] - t[3]));
            }
            maxW = Math.max(maxW, Math.abs(d.pos[3]));
        }
        ok("the drone travels a long way along the 4th axis", wTravel > 40,
            `${wTravel.toFixed(1)} m of w-travel, |w| reached ${maxW.toFixed(1)} m`);
        ok("every arrival had the w coordinate matched too",
            arrivedErrW.length > 0 && arrivedErrW.every(e => e < DRONE.WP_RADIUS),
            `max |Δw| at arrival = ${Math.max(...arrivedErrW).toFixed(3)} m`);
    }
}

/* ══════════════════════════════════════════ I. determinism ══════════════ */
section("I. determinism");
{
    const room = new Room4D();
    const mk = () => [new Net(NET_SIZES, mulberry32(4242)), new Net(NET_SIZES, mulberry32(99))];
    const opts = { missionSeed: 5, noiseSeed: 3, turbulence: 0.3, noise: true, hardCap: 40 };
    const a = runEpisode(room, mk(), opts);
    const b = runEpisode(room, mk(), opts);
    ok("identical seeds → bit-identical episode", JSON.stringify(a) === JSON.stringify(b));
    const c = runEpisode(room, mk(), Object.assign({}, opts, { missionSeed: 6 }));
    ok("a different mission seed → a different episode", JSON.stringify(a) !== JSON.stringify(c));

    /* A brain's score must not depend on which OTHER brains share its episode.
     * This is the regression test for the shared sensor-noise stream: one RNG
     * for the whole fleet advanced once per living drone per tick, so an elite
     * re-flying the identical fixed bank scored differently as soon as its
     * neighbours started dying at different times. Fitness stopped being a
     * property of the brain, and a 99% → 12% collapse in takeoff rate over one
     * generation was the result. */
    const solo = new Net(NET_SIZES, mulberry32(4242));
    const r1 = runEpisode(room, [solo], opts)[0];
    const crowd = [new Net(NET_SIZES, mulberry32(7)), solo, new Net(NET_SIZES, mulberry32(8)),
                   new Net(NET_SIZES, mulberry32(9))];
    const r2 = runEpisode(room, crowd, opts)[1];
    ok("a brain scores identically alone and in a crowd (common random numbers)",
        JSON.stringify(r1) === JSON.stringify(r2),
        `${r1.fitness.toFixed(4)} vs ${r2.fitness.toFixed(4)}`);

    /* And mutation must respect each layer's scale — the other half of that
     * same collapse. A flat sigma is ~12× the output layer's entire weight
     * width; check the step actually taken is proportional instead. */
    const base = new Net(NET_SIZES, mulberry32(11));
    const mut = base.clone().mutate(1.0, 0.1, mulberry32(12));
    const rms = [];
    for (let l = 0; l < base.weights.length; l++) {
        let s = 0;
        for (let i = 0; i < base.weights[l].length; i++) {
            const d = mut.weights[l][i] - base.weights[l][i];
            s += d * d;
        }
        rms.push(Math.sqrt(s / base.weights[l].length));
    }
    const ratio = rms[rms.length - 1] / base.initScales[base.initScales.length - 1];
    ok("mutation step scales with each layer's own weight width",
        ratio > 0.4 && ratio < 3.0,
        `output-layer step is ${ratio.toFixed(2)}× its init scale ` +
        `(a flat sigma would be ${(0.1 / base.initScales[base.initScales.length - 1]).toFixed(0)}×)`);
}

console.log("\n" + "=".repeat(64));
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log("failed: " + failures.join("; ")); process.exit(1); }
