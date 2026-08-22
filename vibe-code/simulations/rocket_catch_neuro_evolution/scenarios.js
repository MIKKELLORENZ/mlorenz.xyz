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
/* scenarios.js — the episode bank, and the curriculum that orders it.
 *
 * A scenario is a complete, reproducible statement of one descent: which
 * vehicle, where it starts, how fast, how tilted, how much propellant is left,
 * what the weather is doing, whether the tower is cleared for a catch, and what
 * the alternative is if it is not. Everything is a pure function of one integer
 * seed. Two brains flown on scenario 4711 meet exactly the same air, the same
 * gusts, the same engine failure at the same second — which is what makes the
 * paired comparison in evolution.js mean anything.
 *
 * THE CURRICULUM RUNS THE OTHER WAY ROUND FROM THE FLIGHT. Stage 0 starts the
 * booster at 700 m, already slow, already nearly upright, with its engines
 * running — twelve seconds from the rails. That is the last twelve seconds of
 * the real problem, and it is the only part of the problem where a random
 * network can accidentally do something that scores. Every later stage adds time
 * and energy to the front of it: 3 km and 200 m/s, then 6 km and 400 m/s and a
 * kilometre and a half of downrange to fly out with the grid fins, then 12 km
 * and 600 m/s and weather. The skill being trained is always "finish the
 * descent"; what changes is how much has to be got right before the part it
 * already knows begins.
 *
 * THE SHIP GETS ITS OWN LADDER because its problem is not a harder version of
 * the booster's, it is a different one. It falls flat on its back at 70 m/s
 * with four drag brakes and no engines running, and then has to rotate ninety
 * degrees and arrive at zero. Stages 4-6 start it in the flop and move the flip
 * further and further from the ground.
 *
 * ABOUT A THIRD OF EVERY STAGE IS A DIVERT. The tower is either never cleared,
 * or is taken away mid-descent — a fouled pad, a failed health check, the same
 * call SpaceX actually makes — and the vehicle has to notice and go somewhere
 * else. This is not decoration. Without it the "commit" output is free: a
 * network that always commits is never punished, the flag in the observation is
 * ignored, and the policy that comes out is one that would fly a 250 tonne
 * booster into the launch site on a day it was told not to.
 */
"use strict";

const M = (typeof require !== "undefined") ? require("./mathx.js") : window.MathX;
const V = (typeof require !== "undefined") ? require("./vehicle.js") : window.Vehicle;
const ATM = (typeof require !== "undefined") ? require("./atmosphere.js") : window.Atmosphere;
const NN = (typeof require !== "undefined") ? require("./nn.js") : window.NN;

const DEG = Math.PI / 180;

const STAGES = [
    {
        id: 0, key: "booster-settle", vehicle: "booster",
        label: "Booster · settle onto the rails",
        /* NOW A SEAWARD RUN-IN, NOT A SETTLE. The vehicle starts offshore on an
         * inbound track, so the stage is "fly the last approach and be caught"
         * rather than "sink the last four hundred metres". Altitude and clock
         * are raised to match: the crossing takes time the old 60 s budget did
         * not have, and the old 260-620 m gave a glide ratio no booster can fly.
         *
         * The offshore distance is a GLIDE SLOPE, not a band of its own — see
         * the note on `glide` below. At 3.2-4.6 km that puts it 1.0-2.1 km out,
         * arriving over the tower at about a kilometre, which is where the real
         * landing burn lights. */
        alt: [3200, 4600], sink: [45, 95], glide: [0.30, 0.45], tilt: [1, 8], rate: [0, 1.5],
        prop: [34000, 48000], wind: [0.0, 0.25], tMax: 95, vh: 3, divertRange: [170, 340],
        preLit: 0, divertFrac: 0.10, downrange: 0,
        bearingSpread: 0.55, inbound: [0.92, 1.08]
    },
    {
        id: 1, key: "booster-short", vehicle: "booster",
        label: "Booster · from 3 km, engines out",
        alt: [2000, 3600], sink: [110, 230], glide: [0.32, 0.48], tilt: [2, 12], rate: [0, 3],
        prop: [50000, 64000], wind: [0.15, 0.5], tMax: 110, vh: 12, divertRange: [260, 750],
        preLit: 0, divertFrac: 0.25, downrange: 0,
        bearingSpread: 0.8, inbound: [0.92, 1.08]
    },
    {
        id: 2, key: "booster-terminal", vehicle: "booster",
        label: "Booster · 6 km, transonic, grid fins",
        alt: [3800, 7000], sink: [280, 440], glide: [0.32, 0.48], tilt: [2, 16], rate: [0, 5],
        prop: [58000, 72000], wind: [0.3, 0.75], tMax: 145, divertRange: [450, 1500],
        preLit: 0, divertFrac: 0.3, downrange: 1,
        bearingSpread: 1.0, inbound: [0.90, 1.10],
        // unpowered arrival: sink follows from altitude. `sink` is retained only
        // as documentation of the band this replaces.
        manifold: 0.84
    },
    {
        id: 3, key: "booster-full", vehicle: "booster",
        label: "Booster · 12 km, supersonic, weather",
        alt: [7500, 13000], sink: [430, 640], glide: [0.28, 0.44], tilt: [3, 22], rate: [0, 8],
        prop: [66000, 86000], wind: [0.55, 1.0], tMax: 150, divertRange: [700, 2600],
        preLit: 0, divertFrac: 0.34, downrange: 1, events: true,
        bearingSpread: 1.2, inbound: [0.88, 1.12],
        manifold: 0.84
    },
    {
        id: 4, key: "ship-flip", vehicle: "ship",
        label: "Ship · the flip, from 700 m",
        /* THE SHIP CANNOT MAKE A KILOMETRE AND NO SPAWN CAN GIVE IT ONE.
         * Integrated against its own drag model, a belly-flop translates 259 m
         * at 0.7 g of side load, 430 m at 1.5 g and 618 m at 3.1 g — and the
         * numbers are the SAME from 1.4 km, 3 km and 6 km, because ground speed
         * decays with a ~7 s time constant while the fall is drag-limited to 70
         * m/s. Altitude buys time the vehicle cannot spend. Reaching 1.3 km
         * would take 7.3 g at spawn, which is a structural failure dressed as a
         * curriculum. So the Ship comes in from seaward at the distance its
         * airframe can actually fly, which clears the shoreline (330 m) but is
         * not the kilometre the booster gets. */
        alt: [1400, 2200], sink: [55, 82], offset: [430, 560], tilt: [78, 95], rate: [0, 3],
        prop: [11000, 16000], wind: [0.0, 0.3], tMax: 110, vh: 4, divertRange: [150, 330],
        preLit: 0, preFlap: 45 * DEG, divertFrac: 0.15, flop: true,
        bearingSpread: 0.32, inbound: [0.85, 1.10]
    },
    {
        id: 5, key: "ship-flop", vehicle: "ship",
        label: "Ship · belly-flop from 4 km",
        alt: [2400, 5200], sink: [58, 85], offset: [450, 620], tilt: [70, 100], rate: [0, 6],
        prop: [14000, 21000], wind: [0.25, 0.65], tMax: 140, vh: 10, divertRange: [240, 700],
        preLit: 0, preFlap: 40 * DEG, divertFrac: 0.3, flop: true,
        bearingSpread: 0.34, inbound: [0.85, 1.10]
    },
    {
        id: 6, key: "ship-full", vehicle: "ship",
        label: "Ship · belly-flop from 10 km, weather",
        alt: [5500, 11000], sink: [55, 90], offset: [480, 700], tilt: [62, 108], rate: [0, 10],
        prop: [17000, 27000], wind: [0.5, 1.0], tMax: 190, vh: 16, divertRange: [400, 1500],
        preLit: 0, preFlap: 38 * DEG, divertFrac: 0.34, flop: true, events: true,
        bearingSpread: 0.38, inbound: [0.85, 1.10]
    }
];

for (const st of STAGES) {
    // Ship stages are belly-flops released near the pad and are not run-ins, so
    // they keep a wide bearing and no inbound track unless given one above.
    if (st.bearingSpread == null) st.bearingSpread = 1.75;
}

const N_STAGES = STAGES.length;

/* The unpowered equilibrium descent rate, solved against the real aero model.
 *
 * Bisection on |drag(v)| = m·g with the vehicle tail-first at zero angle of
 * attack and its fins centred. Monotone in v over the bracket — drag rises with
 * speed even through the transonic Cd hump — so bisection is safe and forty
 * iterations is far past double precision.
 *
 * This is called once per scenario construction, which is once per episode, and
 * costs about forty AeroModel evaluations against an episode of several
 * thousand — under a tenth of a per cent, and it buys a spawn state that is
 * actually on the manifold instead of near it. */
const _eqCache = new Map();
/* HOW LONG DOES IT ACTUALLY TAKE TO FALL? — ONE OWNER FOR THE ANSWER.
 *
 * The inbound ground speed is (distance)/(fall time), so a wrong fall time is a
 * wrong approach for every stage that uses one, and this file has now had the
 * fall time wrong twice in opposite directions. First the belly-flopping ship
 * was given the free-fall formula, which halved its time aloft and doubled its
 * inbound speed. Then the booster was left on free-fall on the reasoning that
 * "a booster tail-first does accelerate" — true, but it accelerates to a
 * terminal velocity of 260-285 m/s and reaches most of it inside the first few
 * hundred metres, so from 3.9 km free-fall says 21.7 s where the truth is 14.1.
 * Every booster stage was therefore aimed about 50% long.
 *
 * Quadratic drag with terminal velocity vt has a closed form, so there is no
 * excuse for either approximation:
 *
 *     v0 < vt (accelerating):   v = vt*tanh(a + g t/vt),  a  = atanh(v0/vt)
 *     v0 > vt (decelerating):   v = vt*coth(b + g t/vt),  b  = acoth(v0/vt)
 *
 * integrating to distance and inverting for t. A drag-braked ship sits at
 * v0 == vt and falls out as h/vt, which is what it was given by hand before.
 */
function fallTime(vt, v0, h) {
    const g = 9.80665;
    if (!(vt > 0) || !isFinite(vt)) return (Math.sqrt(v0 * v0 + 2 * g * h) - v0) / g;
    if (Math.abs(v0 - vt) < 1e-3 * vt) return h / vt;            // already at terminal
    const k = g * h / (vt * vt);
    if (v0 < vt) {
        const a = Math.atanh(v0 / vt);
        return (vt / g) * (Math.acosh(Math.cosh(a) * Math.exp(k)) - a);
    }
    const b = Math.atanh(vt / v0);                                 // acoth(v0/vt)
    return (vt / g) * (Math.asinh(Math.sinh(b) * Math.exp(k)) - b);
}

/* AND THE GROUND SPEED DOES NOT SURVIVE THE FALL EITHER.
 *
 * distance / fall-time is the speed a vehicle would need in a vacuum, and this
 * one is falling through the same air that gives it a terminal velocity. Drag
 * acts along the velocity vector, so the horizontal component is bled away by
 * the very fast vertical motion: traced, a booster given 70 m/s of ground speed
 * arrived with 39, covered 1300 m of the 1670 m it was aimed across, and stopped
 * 310 m short of the tower with the burn already finished. Every seaward spawn
 * was aimed to fall short and no controller could have fixed it, because the
 * shortfall is paid during the coast when there is nothing but fins to pay with.
 *
 * So the aim is solved rather than divided. Quadratic drag with terminal
 * velocity vt is the vector law
 *
 *     a = g_hat*g  -  (g/vt^2) * |V| * V
 *
 * — which reduces to the closed form above when V is vertical — and this
 * integrates it in two dimensions and bisects the initial ground speed until
 * the vehicle covers the distance in the time the fall gives it. Same model,
 * same constant, no second approximation to keep in step with the first.
 */
const _inCache = new Map();
function inboundSolve(vt, v0, h, dist) {
    /* Thirty bisection passes over a 1,250-step integration is far too much to
     * pay per episode, and it does not need paying: the answer is a smooth
     * function of four numbers, so it is cached on a coarse grid of them. */
    const key = `${Math.round(vt / 5)}|${Math.round(v0 / 5)}|${Math.round(h / 50)}|${Math.round(dist / 25)}`;
    const hit = _inCache.get(key);
    if (hit !== undefined) return hit;

    const g = 9.80665;
    const k = g / (vt * vt);
    const run = (s0) => {
        let u = v0, s = s0, fell = 0, x = 0, t = 0;
        const dt = 0.02;
        for (let n = 0; n < 20000 && fell < h; n++) {
            const V = Math.hypot(u, s) || 1e-9;
            u += (g - k * V * u) * dt;
            s += (-k * V * s) * dt;
            fell += u * dt; x += s * dt; t += dt;
        }
        return { x, t };
    };
    let lo = 0, hi = Math.max(50, 4 * dist / Math.max(1, fallTime(vt, v0, h)));
    let out;
    if (run(hi).x < dist) out = { vh: hi, tFall: run(hi).t };      // unreachable; give it everything
    else {
        for (let i = 0; i < 24; i++) {
            const mid = 0.5 * (lo + hi);
            if (run(mid).x < dist) lo = mid; else hi = mid;
        }
        const mid = 0.5 * (lo + hi);
        out = { vh: mid, tFall: run(mid).t };
    }
    _inCache.set(key, out);
    return out;
}

function equilibriumSink(ty, alt, mass) {
    const key = `${ty.key}|${Math.round(alt / 25)}|${Math.round(mass / 500)}`;
    const hit = _eqCache.get(key);
    if (hit !== undefined) return hit;

    const AERO = (typeof require !== "undefined") ? require("./aero.js") : window.Aero;
    const model = new AERO.AeroModel(ty);
    const act = new V.Actuators(ty);
    const air = ATM.airAt(alt);
    const w0 = new Float64Array(3);
    const vB = new Float64Array(3);
    const weight = mass * ATM.gravityAt(alt);

    // net upward body force at descent speed v (drag opposes the motion)
    const netAt = (v) => {
        vB[0] = 0; vB[1] = 0; vB[2] = -v;      // tail-first, alpha = 0
        const o = model.compute(vB, w0, ty.length * 0.45, air, act);
        return o.fz - weight;                   // >0 means drag exceeds weight
    };

    let lo = 1, hi = 1200;
    if (netAt(hi) < 0) { _eqCache.set(key, hi); return hi; }   // cannot balance
    for (let i = 0; i < 40; i++) {
        const mid = 0.5 * (lo + hi);
        if (netAt(mid) < 0) lo = mid; else hi = mid;
    }
    const v = 0.5 * (lo + hi);
    _eqCache.set(key, v);
    return v;
}

function lerp(r, a, b) { return a + r * (b - a); }

/* Build one scenario. `seed` alone determines everything. */
function makeScenario(stageId, seed) {
    const st = STAGES[stageId];
    const rng = NN.mulberry32((seed * 2654435761) ^ (stageId * 40503) ^ 0x9e3779b9);
    // burn a few draws so neighbouring seeds do not produce neighbouring worlds
    for (let i = 0; i < 6; i++) rng();

    const ty = V.TYPES[st.vehicle];
    const windStrength = lerp(rng(), st.wind[0], st.wind[1]);
    const wind = new ATM.WindField(rng, windStrength);

    /* --- where is it going? ------------------------------------------------ */
    let catchAllowed = 1, revokeAt = null, grantAt = null;
    const divertRoll = rng();
    let groundTarget;

    const jitter = (t, r) => ({
        kind: t.kind,
        x: t.x + (rng() * 2 - 1) * r,
        y: t.y + (rng() * 2 - 1) * r,
        radius: t.radius
    });
    /* The safe area, placed seaward at a range this stage can actually fly to.
     * The bearing is biased into the southern half-plane, which is where the
     * water is, but is not fixed — a memorised coordinate is not a diversion. */
    const safeArea = () => {
        const r = lerp(rng(), st.divertRange[0], st.divertRange[1]);
        const th = -Math.PI * 0.5 + (rng() * 2 - 1) * 1.15;
        return { kind: "safe", x: Math.cos(th) * r, y: Math.sin(th) * r, radius: V.DIVERT.radius };
    };

    if (divertRoll < st.divertFrac) {
        // no tower today, or it is taken away partway down
        if (rng() < 0.45) { catchAllowed = 1; revokeAt = lerp(rng(), 2, st.tMax * 0.45); }
        else catchAllowed = 0;
        groundTarget = (st.vehicle === "ship" && rng() < 0.55) ? jitter(V.PAD, 12) : safeArea();
    } else {
        // tower is the plan; the ground target is the backup it should know about
        groundTarget = (st.vehicle === "ship" && rng() < 0.5) ? jitter(V.PAD, 12) : safeArea();
        if (rng() < 0.10) { catchAllowed = 0; grantAt = lerp(rng(), 1, st.tMax * 0.3); }
    }

    /* --- the aim point the initial state is built around ------------------- */
    const aimX = catchAllowed || grantAt != null ? V.TOWER.gateX : groundTarget.x;
    const aimY = catchAllowed || grantAt != null ? V.TOWER.gateY : groundTarget.y;

    /* --- position --------------------------------------------------------- */
    const alt = lerp(rng(), st.alt[0], st.alt[1]);
    /* Approach bearing, measured from the gate. Biased into the outward half —
     * away from the tower — because that is where the water is and because the
     * tower is 146 m of steel standing 19 m from the catch point: a vehicle
     * that starts on the far side of it has to cross its plan area on the way
     * in. The spread is still ±100°, so approaches from abeam are common and a
     * network cannot assume a fixed run-in heading. */
    /* THE VEHICLE ARRIVES FROM THE SEA, WHICH IS -Y.
     *
     * This used to be `bearing = PI/2 + spread`, i.e. centred on +Y, under a
     * comment claiming that was "where the water is". It is not: the land plane
     * runs to +Y and the sea to -Y with the shoreline at y = -330, so every
     * approach was being flown in ACROSS THE LAUNCH SITE. The bearing is now
     * centred on -Y, matching both the flipped arms and the real thing, where a
     * booster comes back downrange over water.
     *
     * The spread is still wide, so a network cannot assume a fixed run-in
     * heading — but it no longer has to learn one that points inland. */
    const bearing = -Math.PI * 0.5 + (rng() * 2 - 1) * st.bearingSpread;
    /* HOW FAR OFFSHORE IS A SLOPE, NOT A NUMBER PER STAGE.
     *
     * The four booster stages used to carry four unrelated offset bands, and
     * they did not describe one trajectory: stage 1 sat 1.4-2.6 km out at 2-3.6
     * km altitude (a 1:1.3 descent) while stage 2 sat 1.0-1.9 km out at 3.8-7 km
     * (1:3.7). A vehicle cannot be on both, so the curriculum was not showing
     * successive slices of the same approach, it was showing four different
     * approaches and calling the difference difficulty.
     *
     * A returning Super Heavy falls at roughly terminal velocity — about 280
     * m/s, near the 310 m/s at which a Falcon 9 relights — while its grid fins
     * fly out the cross-range, and it lights the landing burn at about 1 km
     * altitude on thirteen engines before throttling to three to steer into the
     * catch. That is a descent of roughly 1:2.5, and it is the same 1:2.5 at
     * every height, so `glide` is drawn once and multiplied by whatever altitude
     * the stage drew. The stages then differ in energy and weather, which is
     * what they were always supposed to differ in.
     *
     * The floor keeps every spawn over water: land is +Y, so the shoreline is at
     * SITE.shoreY and a spawn inside it would be a booster returning across the
     * launch site, which is the arrangement the arms were turned around to stop.
     */
    const off = st.glide
        ? Math.max(-V.SITE.shoreY + 200, alt * lerp(rng(), st.glide[0], st.glide[1]))
        : lerp(rng(), st.offset[0], st.offset[1]);
    const p0 = M.v3();
    p0[0] = aimX + Math.cos(bearing) * off;
    p0[1] = aimY + Math.sin(bearing) * off;
    p0[2] = alt;

    /* --- velocity --------------------------------------------------------- */
    /* STAGES THAT REPRESENT AN UNPOWERED ARRIVAL SIT ON THE DESCENT MANIFOLD.
     *
     * Altitude and sink rate used to be drawn independently, which produces
     * states the vehicle cannot be in: stage 2 spanned 3.8-7 km and 280-440 m/s
     * as two separate uniforms, so it generated 7 km at 280 m/s — far below what
     * an unpowered booster does at that height — and 3.8 km at 440 m/s, above
     * it. A booster that has not lit its engines has exactly one degree of
     * freedom here, and it is altitude: everything else follows from the drag
     * balance. Roughly a third of stage-2 draws were arriving slower than
     * physics allows, i.e. with part of the braking problem already solved for
     * free, and no policy trained on them learns the burn the real arrival needs.
     *
     * THE MANIFOLD IS SOLVED AGAINST THE AERO MODEL, NOT AGAINST A CONSTANT.
     *
     * It used to be v_term = sqrt(2mg / (rho·Cd·A)) with Cd_eff = 0.84, a number
     * read off an unpowered drop. That drop had not converged — the same
     * non-convergence that nearly produced a "30% drag error" report earlier —
     * and 0.84 is not a plausible answer in the first place: the axial Cd table
     * in aero.js runs 1.20 to 1.68 across Mach. Too small a Cd means too large a
     * terminal velocity, and the consequences were structural rather than
     * cosmetic:
     *
     *     stage 2   111 of 400 spawns already over the 65 kPa limit
     *     stage 3   224 of 400  — 56% of them
     *
     * Those vehicles break up in the opening frames no matter what any
     * controller does, which is exactly what the feasibility probe found: on
     * stage 3, free fall and maximum braking both broke up 19 times in 24 with
     * identical peak q. It was not a control problem and no amount of gain
     * tuning would ever have touched it.
     *
     * Note WHY the margin was so thin that a wrong Cd fell straight through it:
     * at terminal velocity q = mg/(Cd·A) exactly, independent of altitude, so
     * the whole manifold sits at ONE dynamic pressure. With the true Cd that is
     * about 38 kPa against a 65 kPa limit; with 0.84 it was 56 kPa, and the
     * +/-15% dispersion on speed is +/-32% on q, which walks straight over the
     * limit. A dispersion band has to be checked against the structural limit
     * and this one never was.
     *
     * So the sink rate is now found by solving drag(v) = weight against the
     * actual AeroModel — the same code the flight uses, at zero angle of attack,
     * including the Mach table — by bisection. There is no coefficient to get
     * wrong, and it tracks aero.js automatically if the table changes.
     *
     * Stages 0 and 1 deliberately do NOT do this. They are not unpowered
     * arrivals: they are mid-burn states, a vehicle that has already killed most
     * of its velocity, and being below terminal is the whole point of them. */
    let sink;
    if (st.manifold) {
        const m0 = ty.dryMass + Math.min(ty.propMax, lerp(0.5, st.prop[0], st.prop[1]));
        const vTerm = equilibriumSink(ty, alt, m0);
        /* The dispersion is clamped so the fastest draw still sits inside the
         * structural envelope with margin. Without this the top of the band is
         * a vehicle that is already failing. */
        const rho = ATM.airAt(alt).rho;
        const vCap = Math.sqrt(2 * 0.80 * ty.qMax / Math.max(1e-6, rho));
        sink = Math.min(vTerm * lerp(rng(), 0.92, 1.10), vCap);
    } else {
        sink = lerp(rng(), st.sink[0], st.sink[1]);
    }
    const v0 = M.v3();
    v0[2] = -sink;
    /* AND IT ARRIVES MOVING, ON A TRACK THAT ROUGHLY REACHES THE GATE.
     *
     * Putting the spawn a kilometre offshore and leaving the horizontal
     * velocity at zero does not model an approach, it models a vehicle dropped
     * out of a hover a kilometre out — which no booster can fly in from, and
     * which would have made every episode unwinnable while looking like a
     * harder curriculum. A returning booster is on a ballistic arc with real
     * downrange speed, so the ground track is aimed at the gate and sized to
     * the time it has left:
     *
     *     v_h ~ (horizontal distance) / (time to fall), scattered
     *
     * The scatter is what keeps it a control problem: on the low draws it has
     * to fly the last stretch under power, on the high ones it arrives long and
     * must bleed the overshoot off. Dead-centre would let a policy coast in. */
    if (st.inbound) {
        const hFall = Math.max(30, alt - (V.TOWER.armZ - ty.catchPinZ));
        /* Terminal velocity: the drag brakes hold a flopping ship at its entry
         * sink, and a tail-first booster settles on the equilibrium the same
         * bisection finds for the unpowered stages. See fallTime(). */
        const mAvg = ty.dryMass + Math.min(ty.propMax, 0.5 * (st.prop[0] + st.prop[1]));
        const vTerm = st.flop ? sink : equilibriumSink(ty, alt * 0.5, mAvg);
        const need = inboundSolve(vTerm, sink, hFall, off).vh;
        const vh = need * lerp(rng(), st.inbound[0], st.inbound[1]);
        // unit vector from the spawn point back toward the aim point
        const dx = aimX - p0[0], dy = aimY - p0[1];
        const d = Math.max(1, Math.hypot(dx, dy));
        /* A little cross-track so the run-in is never dead-centre: a policy that
         * only ever sees a perfectly aimed track never learns to correct one. */
        const cx = -dy / d, cy = dx / d, cross = (rng() * 2 - 1) * (st.vh || 8);
        v0[0] = (dx / d) * vh + cx * cross;
        v0[1] = (dy / d) * vh + cy * cross;
    }
    /* ELSE-IF, NOT IF. These two branches ASSIGN v0 rather than adding to it,
     * so as plain `if`s the drift branch silently overwrote the inbound track
     * for every stage with downrange = 0 — stage 0 came out at 2 m/s of ground
     * speed instead of ~120, which would have made a 1.4 km run-in unflyable
     * while looking like a correctly configured approach. */
    else if (st.downrange) {
        // A returning booster is still flying downrange: the horizontal velocity
        // points roughly back toward the aim point, which is the situation the
        // grid fins exist to fix.
        const toAimX = aimX - p0[0], toAimY = aimY - p0[1];
        const d = Math.hypot(toAimX, toAimY) || 1;
        const closing = lerp(rng(), 0.25, 0.85) * Math.min(sink * 0.55, d / 12);
        v0[0] = toAimX / d * closing + (rng() * 2 - 1) * 22;
        v0[1] = toAimY / d * closing + (rng() * 2 - 1) * 22;
    } else {
        // Drift, not downrange velocity. Scaled per stage: the settle scenario
        // is meant to be about the last twelve seconds, and forty metres of
        // lateral error accumulated on the way down turns it into a different
        // and much harder exercise.
        const vh = st.vh || 8;
        v0[0] = (rng() * 2 - 1) * vh;
        v0[1] = (rng() * 2 - 1) * vh;
    }

    /* --- attitude --------------------------------------------------------- */
    const q0 = M.q4();
    const tiltDeg = lerp(rng(), st.tilt[0], st.tilt[1]);
    if (st.flop) {
        /* Belly-flop. The long axis lies nearly horizontal along a random
         * heading and the tiled face (+X body) points at the ground. Built from
         * the basis directly rather than from Euler angles, because "tiles down"
         * is a statement about a basis vector and composing it out of angles is
         * how you end up with a Ship that reenters shiny-side first. */
        const head = rng() * Math.PI * 2;
        const pitchUp = (tiltDeg - 90) * DEG;      // + = nose above horizon
        const ez = M.v3();                          // body +Z (nose) in world
        ez[0] = Math.cos(head) * Math.cos(pitchUp);
        ez[1] = Math.sin(head) * Math.cos(pitchUp);
        ez[2] = Math.sin(pitchUp);
        M.vnorm(ez, ez);
        const ex = M.v3();                          // body +X (belly) — down
        M.vset(ex, 0, 0, -1);
        // orthogonalise the belly against the axis
        const d = M.vdot(ex, ez);
        ex[0] -= d * ez[0]; ex[1] -= d * ez[1]; ex[2] -= d * ez[2];
        M.vnorm(ex, ex);
        const ey = M.v3();
        M.vcross(ey, ez, ex);
        M.qFromBasis(q0, ex, ey, ez);
        // a little roll error, because the flop is never perfectly level
        const roll = M.q4();
        M.qFromAxisAngle(roll, 0, 0, 1, (rng() * 2 - 1) * 14 * DEG);
        M.qmul(q0, q0, roll);
    } else if (st.inbound) {
        /* A VEHICLE ON AN INBOUND TRACK ARRIVES FLYING RETROGRADE, and building
         * it nose-up instead was creating an illegal spawn.
         *
         * The run-in gives the booster real ground speed — 167 m/s on stage 1
         * against a 167 m/s sink — so the relative wind is 45 degrees off
         * vertical. Point the body up and that 45 degrees is angle of attack:
         * 29 kPa times 0.79 rad is 23 kPa·rad against a 22.5 limit, so the
         * airframe failed on the first physics step and no controller ever had
         * the vehicle. Measured, that was 26 of 60 stage-1 flights breaking up
         * at spawn altitude, and it did not move when the pilot's own angle of
         * attack cap was tightened from 32 degrees to 12 — which is what a
         * failure that happens BEFORE the first command looks like.
         *
         * So the axis is built along -v: tail into the airflow, which is what a
         * returning booster actually does and what the grid fins hold it at.
         * `tilt` then means what it says — an error off the trimmed attitude,
         * not an absolute angle from vertical. */
        const ez = M.v3();
        M.vset(ez, -v0[0], -v0[1], -v0[2]);
        if (M.vlen(ez) < 1) M.vset(ez, 0, 0, 1);
        M.vnorm(ez, ez);
        const az = rng() * Math.PI * 2;
        const off = M.q4();
        M.qFromAxisAngle(off, Math.cos(az), Math.sin(az), 0, tiltDeg * DEG);
        /* Rotation carrying +Z onto the retrograde axis, then the tilt error on
         * top of it. Built from the axis-angle between the two vectors so there
         * is no basis to get handed in the wrong order. */
        const cx = -ez[1], cy = ez[0], cs = Math.hypot(cx, cy);
        const ang = Math.acos(M.clamp(ez[2], -1, 1));
        if (cs > 1e-9) M.qFromAxisAngle(q0, cx / cs, cy / cs, 0, ang);
        M.qmul(q0, q0, off);
    } else {
        // Tail-first: nose up, tipped by tiltDeg about a random horizontal axis.
        const az = rng() * Math.PI * 2;
        M.qFromAxisAngle(q0, Math.cos(az), Math.sin(az), 0, tiltDeg * DEG);
    }

    const w0 = M.v3();
    const rateMag = lerp(rng(), st.rate[0], st.rate[1]) * DEG;
    const ra = rng() * Math.PI * 2;
    w0[0] = Math.cos(ra) * rateMag;
    w0[1] = Math.sin(ra) * rateMag;
    w0[2] = (rng() * 2 - 1) * rateMag * 0.4;

    /* --- hardware --------------------------------------------------------- */
    const prop = Math.min(ty.propMax, lerp(rng(), st.prop[0], st.prop[1]));

    let engineOutAt = null;
    if (st.events && rng() < 0.18) engineOutAt = lerp(rng(), 1, st.tMax * 0.5);

    return {
        stage: stageId, seed, key: st.key, label: st.label,
        vehicle: st.vehicle,
        p0, v0, q0, w0, prop,
        wind, windStrength,
        catchAllowed, revokeAt, grantAt, engineOutAt,
        groundTarget,
        tMax: st.tMax,
        preLit: st.preLit || 0,
        preThrottle: st.preThrottle || 0,
        preFlap: st.preFlap != null ? st.preFlap : null
    };
}

/* A generation's training diet: `n` scenarios drawn from a mix of stages.
 * `mix` is an array of weights, one per stage, normally produced by the
 * curriculum in evolution.js. Common random numbers: every individual in the
 * generation flies THIS list, not a list of its own. */
function trainingBank(mix, n, genSeed, stratify) {
    const rng = NN.mulberry32((genSeed * 2246822519) >>> 0);
    let tot = 0;
    for (const w of mix) tot += w;
    const out = [];

    /* STRATIFIED: EXACTLY THE INTENDED SHARE OF EACH STAGE, EVERY GENERATION.
     *
     * Drawing the stage per episode makes the diet multinomial, and at twenty
     * episodes over three stages that is a lot of variance in the thing the
     * fleet is being graded on. Measured over consecutive generations the split
     * moves between 9/5/6 and 9/3/8, and a generation that draws three stage-1
     * episodes saw entry sink rates spanning 188-200 m/s out of a possible
     * 111-230 — most of the stage simply absent that generation.
     *
     * It compounds with the noise this is meant to control. Re-scoring the same
     * elite genomes on a different bank costs them 1.17 sd of their apparent
     * lead, which is larger than the damage any breeding operator does, so the
     * dominant term in what selection sees is which episodes turned up. The
     * exam bank has always been stratified for exactly this reason; the
     * training bank never was.
     *
     * Largest remainder, so the counts sum to n and the residue goes to the
     * heaviest-weighted stages rather than to whichever one sorts first. */
    if (stratify) {
        const want = [], base = [];
        let used = 0;
        for (let s = 0; s < mix.length; s++) {
            const exact = tot > 0 ? (mix[s] / tot) * n : 0;
            const k = Math.floor(exact);
            base.push(k); want.push({ s, frac: exact - k });
            used += k;
        }
        want.sort((a, b) => b.frac - a.frac);
        for (let i = 0; i < n - used; i++) base[want[i % want.length].s]++;
        for (let s = 0; s < base.length; s++)
            for (let i = 0; i < base[s]; i++) out.push(makeScenario(s, 1 + Math.floor(rng() * 1e9)));
        return out;
    }

    for (let i = 0; i < n; i++) {
        let r = rng() * tot, s = 0;
        while (s < mix.length - 1 && r > mix[s]) { r -= mix[s]; s++; }
        // Seeds are drawn from a huge space and the exam bank uses a disjoint
        // block, so a training scenario can never coincide with an exam one.
        out.push(makeScenario(s, 1 + Math.floor(rng() * 1e9)));
    }
    return out;
}

/* The held-out exam. Fixed seeds in a reserved block, stratified over every
 * stage and over the catch/divert split so the reported number cannot be moved
 * by getting lucky with the draw. It is the ONLY thing allowed to crown a
 * champion. */
const EXAM_BASE = 2000000000;

function examBank(perStage) {
    const out = [];
    for (let s = 0; s < N_STAGES; s++) {
        for (let i = 0; i < perStage; i++) {
            out.push(makeScenario(s, EXAM_BASE + s * 100003 + i * 7919));
        }
    }
    return out;
}

function describe(sc) {
    const d = [];
    d.push(sc.label);
    d.push(`${(sc.p0[2] / 1000).toFixed(2)} km`);
    d.push(`${(-sc.v0[2]).toFixed(0)} m/s down`);
    const off = Math.hypot(sc.p0[0] - V.TOWER.gateX, sc.p0[1] - V.TOWER.gateY);
    d.push(`${off > 900 ? (off / 1000).toFixed(1) + " km" : off.toFixed(0) + " m"} out`);
    d.push(`wind ${sc.wind.peak().toFixed(0)} m/s`);
    if (!sc.catchAllowed && sc.grantAt == null) d.push("NO CATCH — divert");
    else if (sc.revokeAt != null) d.push(`catch revoked at T+${sc.revokeAt.toFixed(0)}s`);
    else if (sc.grantAt != null) d.push(`catch cleared at T+${sc.grantAt.toFixed(0)}s`);
    else d.push("catch cleared");
    if (sc.engineOutAt != null) d.push(`engine out T+${sc.engineOutAt.toFixed(0)}s`);
    return d.join(" · ");
}

if (typeof module !== "undefined") {
    module.exports = { STAGES, N_STAGES, makeScenario, trainingBank, examBank, describe, EXAM_BASE, equilibriumSink, fallTime, inboundSolve };
} else {
    /* equilibriumSink and EXAM_BASE are on the page too: the reference pilot in
     * golden_test.js needs the terminal velocity for its braking law, and it is
     * the same controller in both worlds. An export list that differs between
     * Node and the browser is a bug the tests cannot see — the suite runs under
     * Node, where the symbol resolves, and the page throws on the first tick. */
    window.Scenarios = { STAGES, N_STAGES, makeScenario, trainingBank, examBank, describe, EXAM_BASE, equilibriumSink, fallTime, inboundSolve };
}

})();
