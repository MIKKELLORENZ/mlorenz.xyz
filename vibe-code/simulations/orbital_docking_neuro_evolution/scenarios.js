/* scenarios.js — the initial conditions, and the curriculum they belong to.
 *
 * Every generation flies a BANK of scenarios and every brain in that
 * generation flies the identical bank. That is common random numbers, and on
 * this task it is worth more than any amount of population size: two brains
 * that differ by one mutation are then ranked on their difference rather than
 * on which of them happened to draw the 30 km start and which drew the 130 km
 * one. Without it the fitness curve is a plot of the scenario calendar.
 *
 * THE BANK IS STRATIFIED, NOT SAMPLED. Six independent draws from the unlocked
 * stages will, often enough to matter, contain four easy ones — and then the
 * generation has almost no selection pressure on the thing the curriculum just
 * unlocked. So the bank takes one scenario from each unlocked stage, gives the
 * newest stage a second seat, and fills any remainder by rotating. The score
 * for a generation is then a score over a fixed spread of difficulty and is
 * comparable to the generation before it.
 *
 * SIX STAGES, and each one ADDS to the mix rather than replacing it:
 *
 *   0  Terminal approach   30–80 m, in the corridor, laser already locked
 *   1  Proximity ops       120–500 m, off-axis — fly around to the corridor
 *   2  Near rendezvous     1–5 km — orbital mechanics starts to bite
 *   3  Far rendezvous      20–150 km — phase, coast MOST OF AN ORBIT, brake
 *   4  Out of plane        as 3, plus an inclination difference and eccentricity
 *   5  Degraded            biased station attitude, alternate ports, noisy nav,
 *                          less propellant, a tighter clock
 *
 * THE FAR STAGES ARE NOT "STAGE 2 BUT BIGGER". At 100 km the vessel is already
 * closing at 18 m/s and every one of those metres per second is free, supplied
 * by a 10.6 km difference in orbital altitude. The correct action for most of
 * an hour is to do nothing at all. A brain that has learned to push toward the
 * target — the obvious policy, and the one that wins stages 0 and 1 — arrives
 * with an enormous closing rate, no propellant, and flies straight past. The
 * curriculum has to teach the opposite reflex without unteaching the first one,
 * which is why the bank always keeps the earlier stages in it.
 */
"use strict";

const DEG = Math.PI / 180;

const STAGES = [
    {
        id: 0, label: "Terminal", short: "terminal",
        rangeMin: 30, rangeMax: 80,
        offAxis: 20 * DEG,          // how far off the corridor axis the start may be
        /* STATION-KEEPING AT A HOLD POINT, essentially at rest.
         *
         * This started as an inbound 0.02–0.35 m/s and it made the first rung
         * of the curriculum unlearnable. A vessel handed 0.2 m/s of closing
         * rate at 60 m coasts to 22 m on its own — 64% of the log-range
         * journey, free — while a brain that fires toward the station
         * accelerates into the approach-envelope abort and is killed at 35 m
         * having done WORSE than the fleet that sat still. Acting was strictly
         * dominated by inaction and the population correctly learned to be
         * inert.
         *
         * Starting from rest on the V-bar is also a genuine equilibrium of the
         * relative dynamics — the vehicle stays exactly where it is put — so
         * free drift now earns nothing and every metre of closure has to be
         * bought with a thruster. That is what makes stage 0 a first lesson
         * instead of a trap. It is also what a real terminal approach looks
         * like: you arrive at a hold point and stop. */
        vRange: [0.0, 0.03],        // closing speed magnitude at t=0
        vLateral: 0.02,
        attErr: 25 * DEG, rate0: 0.15 * DEG,
        prop: 40, tLimit: 480,
        navNoise: 1.0, attBias: 2 * DEG, ports: [0],
        drift: false
    },
    {
        id: 1, label: "Proximity", short: "proximity",
        rangeMin: 120, rangeMax: 500,
        offAxis: 110 * DEG,
        // Also near rest — same reasoning as stage 0, though the drift matters
        // less here because 300 m off-axis is not closable by coasting anyway.
        vRange: [0.0, 0.08], vLateral: 0.05,
        attErr: 180 * DEG, rate0: 0.5 * DEG,
        prop: 80, tLimit: 2400,
        navNoise: 1.0, attBias: 3 * DEG, ports: [0],
        drift: false
    },
    {
        id: 2, label: "Near rendezvous", short: "near",
        rangeMin: 1000, rangeMax: 5000,
        offAxis: 180 * DEG,
        vRange: [0, 0], vLateral: 0,
        attErr: 180 * DEG, rate0: 1.0 * DEG,
        prop: 140, tLimit: 6000,
        navNoise: 1.0, attBias: 3 * DEG, ports: [0],
        drift: true, driftFrac: 0.55
    },
    {
        id: 3, label: "Far rendezvous", short: "far",
        rangeMin: 20000, rangeMax: 150000,
        offAxis: 180 * DEG,
        vRange: [0, 0], vLateral: 0,
        attErr: 180 * DEG, rate0: 1.5 * DEG,
        prop: 200, tLimit: 13000,
        navNoise: 1.0, attBias: 3 * DEG, ports: [0],
        drift: true, driftFrac: 1.0
    },
    {
        id: 4, label: "Out of plane", short: "plane",
        rangeMin: 20000, rangeMax: 150000,
        offAxis: 180 * DEG,
        vRange: [0, 0], vLateral: 0,
        attErr: 180 * DEG, rate0: 1.5 * DEG,
        prop: 240, tLimit: 15000,
        navNoise: 1.0, attBias: 4 * DEG, ports: [0],
        drift: true, driftFrac: 1.0,
        crossTrack: [1500, 12000],       // m of out-of-plane amplitude
        ecc: 0.0015
    },
    {
        id: 5, label: "Degraded", short: "degraded",
        rangeMin: 8000, rangeMax: 120000,
        offAxis: 180 * DEG,
        vRange: [0, 0], vLateral: 0,
        attErr: 180 * DEG, rate0: 2.0 * DEG,
        prop: 170, tLimit: 11000,
        navNoise: 4.0, attBias: 18 * DEG, ports: [0, 1, 2],
        drift: true, driftFrac: 1.0,
        crossTrack: [0, 9000],
        ecc: 0.0025
    }
];

const N_STAGES = STAGES.length;

/* The station's reference orbit: 413 km circular, 51.64° — the ISS's, because
 * the numbers people recognise are the ones worth using. 5,569 s period,
 * 7,663 m/s, mean motion 1.128e-3 rad/s. Scenarios perturb e and i from here. */
const REF_ORBIT = { a: 6791000, e: 0.0002, i: 51.64 * DEG, raan: 0, argp: 0, M: 0 };

/* Build one scenario. Deterministic in (stage, seed) — this is a pure function
 * and nothing downstream may mutate it, because a bank is shared by every
 * brain in a generation and by every worker in the pool. */
function makeScenario(stage, seed) {
    const S = STAGES[Math.max(0, Math.min(N_STAGES - 1, stage | 0))];
    const rng = mulberry32((seed * 2654435761) ^ (stage * 40503) ^ 0x9E3779B9);
    const u = () => rng();
    const sym = () => rng() * 2 - 1;

    const el = {
        a: REF_ORBIT.a,
        e: S.ecc ? u() * S.ecc : REF_ORBIT.e,
        i: REF_ORBIT.i,
        raan: u() * 2 * Math.PI,
        argp: u() * 2 * Math.PI,
        M: u() * 2 * Math.PI
    };
    const n = meanMotion(el.a);

    /* ---- where the chaser starts, in LVLH ---- */
    let p, v = [0, 0, 0];
    const range = S.rangeMin + u() * (S.rangeMax - S.rangeMin);

    if (S.drift) {
        /* A REAL orbit, not a point dropped in space. The chaser is placed in
         * its own near-circular orbit, offset in altitude, and the along-track
         * separation follows from that:
         *
         *      z₀ = −Δa        (higher orbit is negative z, z is nadir)
         *      ẋ₀ = 1.5 n z₀   (higher orbit is slower — it FALLS BEHIND)
         *
         * so the vessel drifts at −3πΔa per orbit, exactly the classical
         * phasing rate, and the relative motion is a straight secular drift
         * with no wobble. A scenario built by picking a position and setting
         * the velocity to zero would instead be a vessel hovering in defiance
         * of orbital mechanics, and the brain trained on it would learn a
         * physics that does not exist.
         *
         * `driftFrac` of the separation is along-track (closable by waiting);
         * the rest is a radial or cross-track offset that is not. */
        const ahead = u() < 0.5 ? 1 : -1;
        const alongTrack = ahead * range * (S.driftFrac || 1) * (0.75 + 0.25 * u());
        // Choose Δa so the drift closes the gap in between half and two orbits.
        const orbits = 0.5 + 1.5 * u();
        const dz = alongTrack / (3 * Math.PI * orbits);      // = Δa, signed
        p = [alongTrack, 0, dz];
        v = [1.5 * n * dz, 0, 0];
        // A radial offset the drift cannot fix, so the brain still has to burn.
        const rad = sym() * range * 0.02;
        p[2] += rad;
        if (S.crossTrack) {
            /* Out of plane. A cross-track offset in LVLH is a genuine
             * inclination or node difference, and it oscillates at exactly the
             * orbit rate — you cannot remove it anywhere except at a node,
             * where the offset passes through zero and its rate is maximal.
             * That is the whole lesson of stage 4 and it costs real Δv. */
            const amp = S.crossTrack[0] + u() * (S.crossTrack[1] - S.crossTrack[0]);
            const ph = u() * 2 * Math.PI;
            p[1] = amp * Math.sin(ph);
            v[1] = amp * n * Math.cos(ph);
        }
    } else {
        /* Close in, where the corridor geometry matters more than the orbit.
         * Place the vessel on a cone about the port normal. */
        const N = [1, 0, 0];                       // port normal in LVLH (forward port)
        const off = u() * S.offAxis;
        const az = u() * 2 * Math.PI;
        // Build a direction `off` radians away from N.
        const a1 = [0, 1, 0], a2 = [0, 0, 1];
        const d = [
            Math.cos(off) * N[0] + Math.sin(off) * (Math.cos(az) * a1[0] + Math.sin(az) * a2[0]),
            Math.cos(off) * N[1] + Math.sin(off) * (Math.cos(az) * a1[1] + Math.sin(az) * a2[1]),
            Math.cos(off) * N[2] + Math.sin(off) * (Math.cos(az) * a1[2] + Math.sin(az) * a2[2])
        ];
        p = [16.4 + d[0] * range, d[1] * range, d[2] * range];
        const closing = S.vRange[0] + u() * (S.vRange[1] - S.vRange[0]);
        v = [
            -d[0] * closing + sym() * S.vLateral,
            -d[1] * closing + sym() * S.vLateral,
            -d[2] * closing + sym() * S.vLateral
        ];
    }

    /* ---- attitude ---- */
    // Start pointing roughly at the target, then rotate away by up to attErr.
    const toTarget = V.unit(V.mul(p, -1));
    let q = quatFromTo([1, 0, 0], toTarget);
    if (S.attErr > 0) {
        const ax = V.unit([sym(), sym(), sym()]);
        q = Q.norm(Q.mul(Q.fromAxisAngle(ax.some(Boolean) ? ax : [0, 0, 1], sym() * S.attErr), q));
    }
    // A random roll about the nose, always — there is no reason for a vessel to
    // arrive with its roll already solved and it is a separate skill.
    q = Q.norm(Q.mul(q, Q.fromAxisAngle([1, 0, 0], u() * 2 * Math.PI)));
    const w = [sym() * S.rate0, sym() * S.rate0, sym() * S.rate0];

    const portIndex = S.ports[(u() * S.ports.length) | 0];
    const attBias = [sym() * S.attBias, sym() * S.attBias, sym() * S.attBias];

    return {
        stage: S.id, seed, label: S.label,
        el, n,
        rel: { p, v },
        q0: q, w0: w,
        station: { attBias, portIndex },
        prop: S.prop, tLimit: S.tLimit,
        navNoise: S.navNoise,
        R0: V.len(V.sub(p, [16.4, 0, 0])),
        // Filled in by world.js's calibrate(): the score a do-nothing policy
        // gets and the score the scripted autopilot gets. Fitness is reported
        // as an advantage between the two, which is what makes a 30 m approach
        // and a 130 km rendezvous contribute equally to one number.
        sNull: null, sPilot: null, pilotDocked: null
    };
}

/* Shortest-arc quaternion taking `a` to `b`. */
function quatFromTo(a, b) {
    const u1 = V.unit(a), u2 = V.unit(b);
    const d = V.dot(u1, u2);
    if (d > 0.999999) return [1, 0, 0, 0];
    if (d < -0.999999) {
        let ax = V.cross(u1, [1, 0, 0]);
        if (V.len(ax) < 1e-6) ax = V.cross(u1, [0, 1, 0]);
        return Q.fromAxisAngle(ax, Math.PI);
    }
    const c = V.cross(u1, u2);
    return Q.norm([1 + d, c[0], c[1], c[2]]);
}

/* --------------------------------------------------------------- the bank */
/* One stratified bank of `size` scenarios spanning every unlocked stage.
 *
 * Slot 0 is always the newest stage and slot 1 is always stage 0 — the newest
 * because that is what the generation is supposed to be learning, and stage 0
 * because it is the anchor that catches catastrophic forgetting on the very
 * generation it starts. The rest rotate through the unlocked stages, offset by
 * the block index so that across a few generations every stage gets more than
 * one seed without any single generation being unbalanced. */
function buildBank(topStage, size, block) {
    const top = Math.max(0, Math.min(N_STAGES - 1, topStage | 0));
    const k = Math.max(2, size | 0);
    const out = [];
    const seedOf = (st, j) => 1000003 * (block + 1) + 7919 * st + 131 * j;
    out.push(makeScenario(top, seedOf(top, 0)));
    out.push(makeScenario(0, seedOf(0, 1)));
    for (let j = 2; j < k; j++) {
        const st = (block + j) % (top + 1);
        out.push(makeScenario(st, seedOf(st, j)));
    }
    return out;
}

/* The held-out exam. Fixed seeds far outside anything the training bank can
 * generate, every unlocked stage, several seeds each. The champion is decided
 * here and nowhere else — the training score is measured on the very episodes
 * the population was selected against, so one lucky generation would otherwise
 * hold the title forever. */
function buildExam(topStage, seedsPerStage) {
    const top = Math.max(0, Math.min(N_STAGES - 1, topStage | 0));
    const k = Math.max(1, seedsPerStage | 0);
    const out = [];
    for (let st = 0; st <= top; st++) {
        for (let j = 0; j < k; j++) out.push(makeScenario(st, 880000 + st * 1013 + j * 65537));
    }
    return out;
}

if (typeof module !== "undefined") {
    module.exports = {
        STAGES, N_STAGES, REF_ORBIT, DEG,
        makeScenario, buildBank, buildExam, quatFromTo
    };
}
