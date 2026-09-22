/* missions.js — the flight school: what each mission sets up, what counts as
 * finishing it, and what it is trying to teach.
 *
 * A mission is data plus a few hooks the Sim calls:
 *   setup(options) → the world, the ship, the engine, the clocks
 *   update(sim)    → runs every step; calls sim.win() / sim.lose()
 *   goals(sim)     → the checklist shown in the side panel
 *   debrief(sim)   → what just happened, in the player's own numbers
 *   pilot          → a scripted flight (see pilot.js) that test_headless.js
 *                    uses to prove the thing can be done, and the game uses
 *                    for "show me"
 *
 * Every number with a unit on it is real: Earth is Earth, the GPS shell is at
 * GPS altitude, Proxima is 4.246 light-years away and 1 g is 1.03 ly/yr², the
 * big hole is Sagittarius A*. The one fantasy is the engine.
 *
 * This file holds the shared helpers and the missions in ordinary gravity and
 * in no gravity at all. missions_bh.js adds the black holes.
 */
"use strict";

const MISSIONS = [];

const R_EARTH_M = 6.371e6;
const EARTH_MSUN = 3.00349e-6;
const LY_M = 9.4607304725808e15;
const YEAR_S = 3.15576e7;
const G_LY = G0_SI * YEAR_S * YEAR_S / LY_M;         // 1 g in light-years per year²: 1.0323
const SGR_A_MSUN = 4.3e6;
const LEVIATHAN_MSUN = 1e11;
const CYGNUS_MSUN = 21;

/* ------------------------------------------------------------ formatting */

function fmtDuration(sec) {
    const a = Math.abs(sec);
    if (!isFinite(sec)) return "∞";
    if (a < 1e-3) return (sec * 1e6).toFixed(a < 1e-5 ? 2 : 1) + " µs";
    if (a < 1) return (sec * 1e3).toFixed(1) + " ms";
    if (a < 120) return sec.toFixed(1) + " s";
    if (a < 7200) return Math.floor(a / 60) * Math.sign(sec) + " min " + Math.floor(a % 60) + " s";
    if (a < 172800) return Math.floor(a / 3600) * Math.sign(sec) + " h " + Math.floor((a % 3600) / 60) + " min";
    if (a < 2 * YEAR_S) return (sec / 86400).toFixed(1) + " days";
    return (sec / YEAR_S).toFixed(2) + " years";
}

/* A running clock face. The style is fixed per mission so the digits do not
 * jump between formats as the numbers grow. */
function fmtClock(sec, style) {
    if (!isFinite(sec)) return "∞";
    if (style === "years") return (sec / YEAR_S).toFixed(3) + " yr";
    if (style === "days") {
        const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
        return d + "d " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    }
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (style === "hms") return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(Math.floor(s)).padStart(2, "0");
    return String(h * 60 + m).padStart(2, "0") + ":" + s.toFixed(1).padStart(4, "0");      // "ms": mm:ss.s
}

function fmtNum(v, digits) {
    if (!isFinite(v)) return "∞";
    return Number(v).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/* ------------------------------------------------------------ shared logic */

/* Angle swept with the engine off while `ok` stays true. The orbital missions
 * are all won the same way: get onto the orbit, then take your hands off and
 * let it prove itself for a lap. */
function coastSweep(sim, ok) {
    const m = sim.marks;
    if (m.lastSweep === undefined) { m.lastSweep = sim.sweep; m.coast = 0; }
    const d = Math.abs(sim.sweep - m.lastSweep);
    m.lastSweep = sim.sweep;
    if (ok && sim.throttle === 0) m.coast += d; else m.coast = 0;
    return m.coast;
}

function starsFor(value, three, two, lowerIsBetter) {
    if (lowerIsBetter) return value <= three ? 3 : value <= two ? 2 : 1;
    return value >= three ? 3 : value >= two ? 2 : 1;
}

function earthWorld() {
    return { rs: rsMeters(EARTH_MSUN) / R_EARTH_M, R: 1 + 100e3 / R_EARTH_M };   // "surface" = the Kármán line
}

/* Rate of a clock on the ground, minus one. */
function groundRate1(rs) { return -rs / (1 + Math.sqrt(1 - rs)); }

function kmps(vOverC) { return vOverC * C_SI / 1000; }

/* ============================================================ 1. FALLING AROUND */

MISSIONS.push({
    id: "orbit",
    chapter: "Gravity",
    title: "Falling around the Earth",
    tag: "Orbits are free fall",
    brief: "You are 7,000 km up and moving too slowly: left alone, you will fall into the atmosphere within the hour. " +
           "Nothing up here holds you up. The only way to stay is to fall <b>around</b> the Earth instead of into it.",
    learn: [
        { h: "An orbit is a fall that keeps missing", p: "Newton's picture: fire a cannonball sideways from a mountaintop. Faster, and it lands further away. Fast enough, and the ground curves away beneath it as quickly as it falls. It never lands. It is still falling — it is in orbit." },
        { h: "Weightless is not the same as no gravity", p: "At this height Earth's pull is still more than a fifth of what it is on the ground. Astronauts float because they and their ship are falling together. Your accelerometer reads <b>zero</b> whenever the engine is off — remember that. It is the most important sentence in this whole game, and Einstein built general relativity on it." },
        { h: "Read the dashed line", p: "The dashed curve is where you will coast if you do nothing. Red means it ends on the planet. Burn <b>along</b> your direction of travel and watch the far side of the curve lift clear." }
    ],
    hints: [
        "Hold <kbd>Z</kbd> to swing the nose prograde (along your motion), then hold <kbd>W</kbd> or <kbd>↑</kbd> to burn.",
        "Stop when the dashed line clears the atmosphere all the way round.",
        "Then let go. One lap with the engine off completes the mission. <kbd>.</kbd> speeds time up."
    ],
    fact: "The International Space Station falls around the Earth every 92 minutes at 7.66 km/s. Its crew feel about 90% of surface gravity — and float.",

    setup: function () {
        const world = earthWorld();
        const r0 = 2.1;
        const vc = Math.sqrt(0.5 * world.rs / r0);
        return {
            world: world, ship: localState(world.rs, r0, 2.2, 0, 0.68 * vc), heading: 2.2 + Math.PI / 2,
            aMax: 1.1e-10, fuel: 1.5e-5, timeScale: 9000, unitMeters: R_EARTH_M,
            base: { kind: "ground", rate1: groundRate1(world.rs), label: "Ground clock" },
            units: "earth", clock: "hms", viewR: 3.2, cockpit: "body",
            overlays: { predict: true, rings: false, river: false, cone: false, contours: false, disc: false, pulses: false },
            body: { kind: "earth", name: "Earth" }
        };
    },
    update: function (sim) {
        const lap = coastSweep(sim, true);
        if (lap >= 2 * Math.PI) sim.win();
    },
    goals: function (sim) {
        const ap = apsides(sim.world, sim.d);
        const clear = ap.peri > sim.world.R;
        return [
            { text: "Raise the low point of your path clear of the atmosphere", done: clear,
              note: clear ? "lowest point " + fmtNum((ap.peri - 1) * R_EARTH_M / 1000, 0) + " km up" : "path ends in the atmosphere" },
            { text: "Coast one full lap with the engine off", done: sim.status === "won",
              note: Math.min(100, Math.round(100 * (sim.marks.coast || 0) / (2 * Math.PI))) + "%" }
        ];
    },
    debrief: function (sim) {
        const dv = kmps(sim.fuelUsed);
        return {
            stars: starsFor(dv, 1.55, 2.4, true),
            title: "You are in orbit",
            lines: [
                "You spent <b>" + dv.toFixed(2) + " km/s</b> of fuel — and then none at all for a whole lap. An orbit costs nothing to keep. That is why the Moon is still there.",
                "While you were up there your clock and the ground's drifted apart by <b>" + fmtDuration(Math.abs(sim.lead) * sim.unitS) + "</b>. Tiny, but it is not zero, and it is not an error. The next mission is about that number."
            ]
        };
    },
    pilot: "orbit"
});

/* ============================================================ 2. GPS */

MISSIONS.push({
    id: "gps",
    chapter: "Gravity",
    title: "Relativity in your pocket",
    tag: "Clocks tick differently up here",
    brief: "Carry an atomic clock from low orbit up to the GPS shell, 20,200 km above the ground, and park it there. " +
           "Then watch what the clock does. Your phone depends on the answer.",
    learn: [
        { h: "Changing orbit", p: "Burn prograde and the <b>opposite</b> side of your orbit rises. Coast up to that high point, burn prograde again, and the low side comes up to meet it. Two burns, half an ellipse between them: a Hohmann transfer. Notice that the higher orbit is the <b>slower</b> one." },
        { h: "Two effects, opposite signs", p: "A moving clock runs slow — special relativity. A clock higher in a gravity well runs <b>fast</b> compared with one deeper down — general relativity. A GPS satellite does both: its speed costs it 7 µs a day, its altitude gains it 46. The instruments on the right show both terms live, measured against a clock on the ground." },
        { h: "Why it matters", p: "GPS works by timing radio signals, and light covers 300 metres in a microsecond. Left uncorrected, the net +38 µs a day would push every position fix off by about 11 km per day. The satellite clocks are deliberately built to tick slow on the ground so that they tick right in orbit." }
    ],
    hints: [
        "Hold <kbd>Z</kbd> + <kbd>W</kbd> until the dashed line's far side touches the green band.",
        "Coast up (use <kbd>.</kbd> to warp). At the top, <kbd>Z</kbd> + <kbd>W</kbd> again until the orbit is round.",
        "Hold <kbd>Shift</kbd> for quarter power when you are close. <kbd>X</kbd> points retrograde if you overshoot."
    ],
    fact: "Every GPS satellite's clock is offset by −4.465 parts in 10¹⁰ before launch. It is the most widely used piece of general relativity on Earth.",

    setup: function () {
        const world = earthWorld();
        return {
            world: world, ship: circularState(world.rs, 1.1, -0.6, 1), heading: -0.6 + Math.PI / 2,
            aMax: 1.1e-10, fuel: 1.75e-5, timeScale: 1.6e4, unitMeters: R_EARTH_M,
            base: { kind: "ground", rate1: groundRate1(world.rs), label: "Ground clock" },
            units: "earth", clock: "hms", viewR: 5.6, cockpit: "body",
            band: { r0: 3.92, r1: 4.42, label: "GPS shell" },
            overlays: { predict: true, rings: false, river: false, cone: false, contours: false, disc: false, pulses: false },
            body: { kind: "earth", name: "Earth" }
        };
    },
    update: function (sim) {
        const b = sim.cfg.band;
        const lap = coastSweep(sim, sim.d.r >= b.r0 && sim.d.r <= b.r1);
        if (lap >= Math.PI) sim.win();
    },
    goals: function (sim) {
        const b = sim.cfg.band, ap = apsides(sim.world, sim.d);
        const high = ap.apo >= b.r0, round = ap.peri >= b.r0 && ap.apo <= b.r1;
        return [
            { text: "Raise the high point of your orbit into the GPS shell", done: high || round },
            { text: "Round the orbit off so that all of it lies inside the shell", done: round,
              note: isFinite(ap.apo) ? fmtNum((ap.peri - 1) * 6371, 0) + " – " + fmtNum((ap.apo - 1) * 6371, 0) + " km" : "escaping!" },
            { text: "Coast half a lap inside the shell", done: sim.status === "won",
              note: Math.min(100, Math.round(100 * (sim.marks.coast || 0) / Math.PI)) + "%" }
        ];
    },
    debrief: function (sim) {
        const d = sim.d, day = 86400e6, ground = -groundRate1(sim.world.rs);
        const grav = (ground - d.gravLoss) * day, speed = -d.speedLoss * day;
        return {
            stars: starsFor(kmps(sim.fuelUsed), 3.75, 4.4, true),
            title: "Clock delivered",
            lines: [
                "Up here your clock gains <b>" + grav.toFixed(1) + " µs a day</b> from being higher in Earth's gravity, and loses <b>" + Math.abs(speed).toFixed(1) + " µs a day</b> to its own speed. Net: <b>" + (grav + speed >= 0 ? "+" : "") + (grav + speed).toFixed(1) + " µs a day</b>. The real GPS figures are +45.7, −7.2 and +38.5.",
                "Those numbers were not typed in. The ship is flown through the curved spacetime around the Earth and its clock is integrated along the way — the same code that takes you into a black hole later.",
                "Fuel used: " + kmps(sim.fuelUsed).toFixed(2) + " km/s. A perfect two-burn transfer takes 3.32."
            ]
        };
    },
    pilot: "gps"
});

/* ============================================================ 3. PROXIMA AT 1 g */

const SOL_X = -2.123, PROX_X = 2.123;       // 4.246 light-years apart

MISSIONS.push({
    id: "proxima",
    chapter: "The speed limit",
    title: "Proxima Centauri at one g",
    tag: "Fast clocks run slow",
    brief: "No gravity this time — just distance. Proxima Centauri is 4.246 light-years away and your engine can push at a comfortable 1 g for as long as you like. " +
           "Fly there, turn round, and come home. Then compare your calendar with Earth's.",
    learn: [
        { h: "You cannot catch light", p: "Hold the throttle open and watch the speedometer: 0.5 c, 0.9 c, 0.99 c… and never 1. Each extra bit of thrust buys less speed than the last, because speeds do not add the way everyday experience says. What keeps growing without limit is γ (gamma), and γ is what your clock cares about." },
        { h: "Moving clocks run slow", p: "At 0.87 c, γ = 2: for every two years that pass on Earth, one passes for you. This is not an illusion and not a mechanical fault. It is how much time there <b>is</b> along your path through spacetime. Your route between the two meetings with Earth is simply a shorter one, as measured by a clock." },
        { h: "The twins", p: "\"But from my seat, Earth is the one moving — why isn't Earth's clock the slow one?\" Because the situations are not the same. You fired an engine and turned round; Earth did not. Listen to the pings: you send one every three months of your time. Earth hears them spaced far apart on your way out, then crowded together as you race home behind them." },
        { h: "Look out of the window", p: "The view is real physics too. As you speed up the stars crowd towards the point you are flying at and turn blue; behind you they thin out and redden. At 0.99 c nearly the whole sky is squeezed into a bright patch dead ahead." }
    ],
    hints: [
        "Point at Proxima (<kbd>←</kbd> <kbd>→</kbd>, or hold the mouse on it) and hold <kbd>W</kbd>.",
        "When the panel says <b>FLIP</b>, hold <kbd>X</kbd> (retrograde) and keep burning to brake.",
        "Arrive inside the ring slower than 0.35 c, then do it all again to get home."
    ],
    fact: "1 g is 1.03 light-years per year per year — so one year of steady 1 g thrust, by your own clock, gets you to 77% of light speed. Keep it up and you could cross the whole Milky Way in about 12 years of your own life (22 if you want to stop at the far side). 100,000 years would pass at home.",

    setup: function () {
        return {
            world: { rs: 0 }, ship: makeShip(SOL_X, 0, 0, 0), heading: 0,
            aMax: G_LY, fuel: Infinity, timeScale: 0.22, unitMeters: LY_M,
            base: { kind: "far", rate1: 0, label: "Earth clock" },
            units: "ly", clock: "years", viewR: 3.3, cockpit: "heading", flatStep: 0.05,
            places: [
                { id: "sol", x: SOL_X, y: 0, r: 0.3, name: "Sol", kind: "sun" },
                { id: "prox", x: PROX_X, y: 0, r: 0.3, name: "Proxima", kind: "reddwarf" }
            ],
            pingEvery: 0.25, listenAt: { x: SOL_X, y: 0 }, pulseLife: 9,
            overlays: { predict: false, rings: false, river: false, cone: false, contours: false, disc: false, pulses: true }
        };
    },
    init: function (sim) { sim.marks.leg = 0; },
    update: function (sim) {
        const s = sim.ship, m = sim.marks, places = sim.cfg.places;
        const target = places[m.leg === 0 ? 1 : 0];
        const dist = Math.hypot(s.x - target.x, s.y - target.y);
        m.dist = dist; m.target = target;
        /* Distance needed to stop from here at full thrust: (γ − 1)/a. */
        m.brake = (sim.d.gamma - 1) / sim.aMax;
        if (dist < target.r && sim.d.vRiver < 0.35) {
            if (m.leg === 0) { m.leg = 1; m.tauThere = s.tau; m.tThere = sim.tFar; sim.events.push({ type: "leg", name: "Proxima reached" }); }
            else sim.win();
        }
    },
    goals: function (sim) {
        const m = sim.marks, closing = m.dist !== undefined && m.brake >= m.dist - 0.02 && sim.d.vRiver > 0.05;
        return [
            { text: "Reach Proxima Centauri, slower than 0.35 c", done: m.leg > 0,
              note: m.leg === 0 && m.dist !== undefined ? m.dist.toFixed(2) + " ly to go" : "" },
            { text: "Come home to Sol, slower than 0.35 c", done: sim.status === "won",
              note: m.leg === 1 && m.dist !== undefined ? m.dist.toFixed(2) + " ly to go" : "" },
            { text: closing ? "FLIP — brake now" : "Stopping distance from this speed", done: false, flag: closing,
              note: (m.brake || 0).toFixed(2) + " ly" }
        ];
    },
    debrief: function (sim) {
        const you = sim.tau, earth = sim.tFar;
        return {
            stars: starsFor(you, 7.8, 9.5, true),
            title: "Welcome home",
            lines: [
                "Your calendar says <b>" + you.toFixed(2) + " years</b>. Earth's says <b>" + earth.toFixed(2) + " years</b>. Everyone you left is " + (earth - you).toFixed(2) + " years older than you expected — and that is permanent.",
                "The engine delivered <b>" + sim.fuelUsed.toFixed(1) + " c</b> worth of push in total. In Newton's universe that would be " + sim.fuelUsed.toFixed(1) + " times the speed of light. In this one you never reached 1.",
                "A perfectly timed flight — flip exactly half-way, both ways — takes 7.1 years of ship time and 11.7 of Earth's."
            ]
        };
    },
    pilot: "proxima"
});

if (typeof module !== "undefined") {
    module.exports = {
        MISSIONS, R_EARTH_M, EARTH_MSUN, LY_M, YEAR_S, G_LY, SGR_A_MSUN, LEVIATHAN_MSUN, CYGNUS_MSUN, SOL_X, PROX_X,
        fmtDuration, fmtClock, fmtNum, coastSweep, starsFor, earthWorld, groundRate1, kmps
    };
}
