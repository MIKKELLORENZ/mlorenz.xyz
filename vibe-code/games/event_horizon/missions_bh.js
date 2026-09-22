/* missions_bh.js — the black-hole half of the flight school.
 *
 * All of these use rs as the unit of length, so the horizon is at 1, the
 * photon sphere at 1.5 and the last stable orbit at 3, whatever the hole's
 * mass. The mass only sets how long a unit of time is and how hard the tides
 * pull — which is itself one of the lessons (see "tides").
 */
"use strict";

function holeCfg(massSolar, extra) {
    const cfg = {
        world: { rs: 1 }, unitMeters: rsMeters(massSolar), massSolar: massSolar,
        units: "rs", clock: "ms", cockpit: "hole",
        base: { kind: "far", rate1: 0, label: "Far clock" },
        overlays: { predict: true, rings: true, river: false, cone: false, contours: false, disc: true, pulses: false }
    };
    for (const k in extra) cfg[k] = extra[k];
    return cfg;
}

/* ============================================================ 4. SLOW TIME */

const DEEP_GAIN = 64;          // far-clock lead to earn, in units of rs/c  (≈ 2 years at this hole)

MISSIONS.push({
    id: "deepwell",
    chapter: "Black holes",
    title: "Borrowed time",
    tag: "Gravity slows clocks",
    brief: "Leviathan is a hundred billion Suns in one place. Its horizon is eleven light-days in radius, so its tides are gentle enough to ignore — but its gravity well is as deep as they come. " +
           "You want to see the station <b>two years further into its future</b> than your own clock will take you. There is only one way to travel in time, and it is down. Life support is good for ten years.",
    learn: [
        { h: "Deeper is slower", p: "A clock that hovers at radius r ticks at <b>√(1 − r<sub>s</sub>/r)</b> of the far-away rate. At 2 r<sub>s</sub> that is 71%; at 1.1 r<sub>s</sub>, 30%; at the horizon, zero. Turn on the clock-rate rings to see the well mapped out. Nothing feels slow to you — your heart, your thoughts and your watch all agree. It is the rest of the universe that seems to hurry." },
        { h: "Watch the traffic", p: "The game runs on <b>your</b> time. So as you sink, the far clock on the right runs faster, the station's beacon blinks faster, and the supply tugs circling out beyond it whip round their orbits more and more quickly. That is what gravitational time dilation looks like from the inside." },
        { h: "Standing still is the expensive part", p: "Orbiting is free. <b>Hovering</b> is not: the engine has to fight the whole pull, all the time, and the pull you feel grows without limit towards the horizon — (M/r²)/√(1 − r<sub>s</sub>/r). Watch the g-meter and the fuel gauge as you go down. Deeper buys more time per hour, and costs more fuel per hour. Choose." }
    ],
    hints: [
        "You start docked, with the hover autopilot holding you (<kbd>H</kbd> toggles it). With it on, <kbd>S</kbd> descends and <kbd>W</kbd> climbs.",
        "Somewhere around 1.5 – 2 r<sub>s</sub> is a good trade. Watch the fuel: at the autopilot's floor the tank lasts seconds. Use <kbd>.</kbd> to warp while you wait.",
        "When the lead reaches 2 years, climb straight back up to the station. Falling part of the way down is quicker and costs nothing."
    ],
    fact: "In the film Interstellar an hour on Miller's planet costs seven years outside — a factor of 61,000. That needs a hole spinning at nearly the maximum possible rate; around a non-spinning hole like this one, no stable orbit gets you past a factor of 1.4. To do better you have to hover, and pay for it.",

    setup: function () {
        /* The station does not orbit: it is a platform held at 20 rs by its
         * own engines, so its clock runs at sqrt(1 − rs/r) and it is still
         * there, straight above you, when you come back up. */
        const rSt = 20, phase = 0.9;
        return holeCfg(LEVIATHAN_MSUN, {
            ship: localState(1, rSt, phase, 0, 0), heading: phase, startHover: true,
            aMax: 1.0, aManual: 0.05, fuel: 60, timeScale: 12, clock: "days", viewR: 27, zoomMin: 9,
            station: { r: rSt, phase: phase, omega: 0, zone: 1.6, name: "Station" },
            base: { kind: "station", rate1: Math.sqrt(1 - 1 / rSt) - 1, label: "Station clock" },
            orbiters: [{ r: 24, phase: 0.3 }, { r: 25.5, phase: 4.4 }, { r: 7.5, phase: 5.2 }, { r: 6, phase: 2.2 }, { r: 4.5, phase: 3.9 }],
            lifeSupport: 320, pingEvery: 8, listenR: 20, pulseLife: 45,
            overlays: { predict: true, rings: true, river: false, cone: false, contours: true, disc: true, pulses: false }
        });
    },
    init: function (sim) { sim.marks.left = false; },
    update: function (sim) {
        const m = sim.marks, p = [0, 0];
        sim.stationPos(p);
        const dist = Math.hypot(sim.ship.x - p[0], sim.ship.y - p[1]);
        m.dist = dist;
        if (dist > 3 * sim.station.zone) m.left = true;
        if (sim.tau > sim.cfg.lifeSupport) sim.lose("time", "Life support ran out");
        else if (m.left && dist < sim.station.zone && sim.lead >= DEEP_GAIN) sim.win();
    },
    goals: function (sim) {
        const yr = sim.unitS / YEAR_S, m = sim.marks;
        return [
            { text: "Let the station's clock get 2 years ahead of yours", done: sim.lead >= DEEP_GAIN,
              note: "lead " + (sim.lead * yr).toFixed(2) + " yr" },
            { text: "Climb back up and dock with the station", done: sim.status === "won",
              note: m.dist !== undefined ? m.dist.toFixed(1) + " rs away" : "" },
            { text: "Life support", done: false, plain: true,
              note: ((sim.cfg.lifeSupport - sim.tau) * yr).toFixed(1) + " yr left" }
        ];
    },
    debrief: function (sim) {
        const yr = sim.unitS / YEAR_S;
        const you = sim.tau * yr, them = sim.baseClock * yr;
        return {
            stars: starsFor(sim.tau, 170, 250, true),
            title: "Two years, skipped",
            lines: [
                "You lived <b>" + you.toFixed(2) + " years</b>. The station lived <b>" + them.toFixed(2) + "</b>. You are really, physically younger than you would have been — this is a time machine, it only goes forwards, and it is completely real.",
                "Deepest point: " + sim.rMin.toFixed(2) + " r<sub>s</sub>, where a hovering clock runs at " + (100 * Math.sqrt(Math.max(0, 1 - 1 / sim.rMin))).toFixed(0) + "%. Peak load on the crew: <b>" + fmtNum(sim.maxG, 1) + " g</b>. Fuel burned: " + sim.fuelUsed.toFixed(1) + " c of Δv — a number no real rocket will ever see.",
                "That last figure is the honest lesson. Gravity will slow your clock for free only if you are willing to fall. Standing still in a deep well is the most expensive thing in the universe."
            ]
        };
    },
    pilot: "deepwell"
});

/* ============================================================ 5. THE LAST STABLE ORBIT */

MISSIONS.push({
    id: "isco",
    chapter: "Black holes",
    title: "The last safe orbit",
    tag: "Where orbits stop working",
    brief: "Sagittarius A* — four million Suns, at the centre of our own galaxy. You are in a quiet circular orbit at 8 r<sub>s</sub>. " +
           "Work your way down until your whole orbit lies inside 4.5 r<sub>s</sub>, prove it holds for a lap, and get back out. Around Newton's gravity that would be routine. Here there is a floor.",
    learn: [
        { h: "Newton has no floor. Einstein does.", p: "In Newton's gravity you can orbit as close to a point mass as you like — go faster, and the centrifugal barrier always wins. General relativity adds one more term to the radial equation, <b>−3ML²/r⁴</b>, and close in it beats everything. Below <b>3 r<sub>s</sub></b> no circular orbit is stable: the slightest nudge and you either spiral straight in, or swing outwards, come back, and spiral in then." },
        { h: "The energy landscape", p: "The chart on the right is the hill your radial motion rolls on, drawn for your current angular momentum. Far out it looks like Newton's: a valley you can sit in. As you shed angular momentum the valley gets shallower, slides inward to 3 r<sub>s</sub>… and vanishes. After that there is only a slope, and it goes one way." },
        { h: "Orbits that don't close", p: "Look at the dashed line. Your ellipse no longer joins up with itself — it swings round a little further each lap, drawing a rosette. Mercury does this too, by 43 arc-seconds a century; explaining that was general relativity's first success. Down here it is tens of degrees per lap." }
    ],
    hints: [
        "<kbd>X</kbd> (retrograde) + <kbd>W</kbd> lowers the far side of your orbit. Use <kbd>Shift</kbd> for fine burns.",
        "A dashed line that turns red means that path ends in the hole. Add speed (<kbd>Z</kbd> + <kbd>W</kbd>) until it doesn't.",
        "Once the whole orbit is between 3 and 4.5 r<sub>s</sub>, hands off for one lap. Then climb back above 8."
    ],
    fact: "This is why the glowing discs of gas around black holes have a hole in the middle. Gas spirals down to 3 r<sub>s</sub> in stable orbits, then drops straight in. The dark gap in the Event Horizon Telescope's pictures is partly that.",

    setup: function () {
        return holeCfg(SGR_A_MSUN, {
            ship: circularState(1, 8, 0.4, 1), heading: 0.4 + Math.PI / 2,
            aMax: 0.005, fuel: 0.55, timeScale: 9, viewR: 11, zoomMin: 7,
            band: { r0: 3.0, r1: 4.5, label: "target" },
            overlays: { predict: true, rings: true, river: false, cone: false, contours: false, disc: true, pulses: false, potential: true }
        });
    },
    init: function (sim) { sim.marks.lapDone = false; sim.marks.best = Infinity; },
    update: function (sim) {
        const m = sim.marks, b = sim.cfg.band;
        if (!m.lapDone) {
            const lap = coastSweep(sim, sim.d.r <= b.r1 && sim.d.r >= 1);
            if (lap > 0) m.lapHi = Math.max(m.lapHi || 0, sim.d.r); else m.lapHi = 0;
            if (lap >= 2 * Math.PI) { m.lapDone = true; m.best = m.lapHi; sim.events.push({ type: "leg", name: "Lap complete — now climb out" }); }
        } else if (sim.d.r >= 8) sim.win();
    },
    goals: function (sim) {
        const m = sim.marks, ap = apsides(sim.world, sim.d), b = sim.cfg.band;
        const inside = ap.peri >= 1 && ap.apo <= b.r1;
        return [
            { text: "Get your whole orbit inside 4.5 r<sub>s</sub>", done: m.lapDone || inside,
              note: ap.peri > 0 ? ap.peri.toFixed(2) + " – " + (isFinite(ap.apo) ? ap.apo.toFixed(2) : "∞") + " rs" : "this path ends in the hole" },
            { text: "Coast one full lap down there", done: m.lapDone,
              note: m.lapDone ? "" : Math.min(100, Math.round(100 * (m.coast || 0) / (2 * Math.PI))) + "%" },
            { text: "Climb back out past 8 r<sub>s</sub>", done: sim.status === "won" }
        ];
    },
    debrief: function (sim) {
        const m = sim.marks;
        return {
            stars: starsFor(m.best, 3.9, 4.25, true),
            title: "Out again",
            lines: [
                "Your lap stayed inside <b>" + m.best.toFixed(2) + " r<sub>s</sub></b>. The edge of stability is at exactly 3: an orbit there is like a pencil balanced on its point. (Three stars needs a lap inside 3.9 — round the orbit off with several short burns, one at each low point.)",
                "Closest approach of the whole flight: " + sim.rMin.toFixed(2) + " r<sub>s</sub>. Down there you were moving at a large fraction of the speed of light, and your clock ran at about " + (100 * Math.sqrt(Math.max(0, 1 - 1.5 / Math.max(1.5, m.best)))).toFixed(0) + "% of the far rate — for free, with the engine off. Orbits are the cheap way to slow time; they just do not go very deep.",
                "Fuel used: " + sim.fuelUsed.toFixed(3) + " c."
            ]
        };
    },
    pilot: "isco"
});

/* ============================================================ 6. BENDING LIGHT */

MISSIONS.push({
    id: "lightbend",
    chapter: "Black holes",
    title: "Bending light",
    tag: "Light falls too",
    brief: "Your ship is parked 12 r<sub>s</sub> from the hole. Three receivers need a laser pulse, and the hole is in the way. " +
           "There is no trick shot here and no mirrors — light simply does not travel in straight lines near a mass.",
    learn: [
        { h: "Light follows the curve", p: "Light has no mass, and gravity bends it anyway, because gravity is not a force acting on things — it is the shape of the spacetime they move through. Far from the hole a ray passing at distance b is turned by <b>2r<sub>s</sub>/b</b> radians. Eddington measured exactly this for starlight grazing the Sun in 1919 (1.75 arc-seconds), and made Einstein famous overnight." },
        { h: "Two ways round", p: "A receiver directly behind the hole can be hit by going over the top <b>or</b> underneath. Seen from there, your laser would appear twice, on opposite sides of the hole. A source exactly behind appears as a complete circle: an <b>Einstein ring</b>. Astronomers use rings and arcs like that to weigh galaxies." },
        { h: "The photon sphere", p: "Aim closer and the bend grows without limit. At <b>1.5 r<sub>s</sub></b> light can circle the hole. Rays that come in just outside that make a loop, or two, before leaving — so with a steady enough hand you can shoot yourself in the back. Anything aimed inside b = 2.6 r<sub>s</sub> never comes out at all; that disc is the black \"shadow\" in the photographs, 2.6 times bigger than the horizon itself." }
    ],
    hints: [
        "Click the chart to aim roughly, <kbd>←</kbd> <kbd>→</kbd> to swing, <kbd>Shift</kbd> for fine, <kbd>Q</kbd> <kbd>E</kbd> for 0.01° steps. <kbd>Space</kbd> fires.",
        "Old beams stay on the chart. Use them: if one passes just left of a receiver, nudge and fire again.",
        "The third receiver is on your own hull. Skim the photon sphere."
    ],
    fact: "In 2019 the Event Horizon Telescope photographed the shadow of the black hole in the galaxy M87: a dark disc 2.6 r<sub>s</sub> in radius, ringed by light that had been bent round it — exactly this picture.",

    setup: function () {
        const x0 = -12;
        return holeCfg(SGR_A_MSUN, {
            ship: localState(1, 12, Math.PI, 0, 0), heading: 0,
            aMax: 0, fuel: Infinity, timeScale: 16, viewR: 17,
            laser: {
                aim: 0.35,
                targets: [
                    { id: "a", x: 8, y: 8.5, r: 0.75, name: "Relay A" },
                    { id: "b", x: 13, y: 0, r: 0.75, name: "Relay B" },
                    { id: "self", self: true, r: 0.75, name: "Your own hull" }
                ],
                need: ["a", "b"]
            },
            overlays: { predict: false, rings: true, river: false, cone: false, contours: false, disc: false, pulses: false }
        });
    },
    update: function (sim) {
        const L = sim.laser;
        if (L.hits.a && L.hits.b && L.hits.self) sim.win();
    },
    goals: function (sim) {
        const L = sim.laser;
        return [
            { text: "Hit Relay A, off to one side", done: !!L.hits.a },
            { text: "Hit Relay B, directly behind the hole", done: !!L.hits.b },
            { text: "Bonus: hit your own hull, the long way round", done: !!L.hits.self },
            { text: "Pulses fired", done: false, plain: true, note: String(L.shots) }
        ];
    },
    canFinish: function (sim) { return !!(sim.laser.hits.a && sim.laser.hits.b); },
    debrief: function (sim) {
        const L = sim.laser, n = (L.hits.a ? 1 : 0) + (L.hits.b ? 1 : 0) + (L.hits.self ? 1 : 0);
        const lines = ["Receivers hit: <b>" + n + " of 3</b>, with " + L.shots + " pulses."];
        if (L.hits.b) lines.push("Relay B was straight behind the hole, and you reached it with a ray bent by <b>" + (L.hits.b.bend * 180 / Math.PI).toFixed(0) + "°</b>. The mirror-image shot on the other side works just as well: that is the two-image rule of gravitational lensing.");
        if (L.hits.self) lines.push("The pulse that came back to you turned through <b>" + (L.hits.self.bend * 180 / Math.PI).toFixed(0) + "°</b>, skimming the photon sphere at " + L.hits.self.rMin.toFixed(3) + " r<sub>s</sub>. If you looked along that line you would see the back of your own ship.");
        else lines.push("The third target needs a ray that passes about 1.55 r<sub>s</sub> from the centre — a hair outside the photon sphere — and the aim has to be right to a few hundredths of a degree. Light that close is balanced on a knife edge, just like the orbits at 3 r<sub>s</sub> were.");
        return { stars: Math.max(1, n), title: n === 3 ? "All three" : "Signal delivered", lines: lines };
    },
    pilot: "lightbend"
});

/* ============================================================ 7. TIDES */

MISSIONS.push({
    id: "tides",
    chapter: "Black holes",
    title: "Pick your black hole",
    tag: "Tides, and why big holes are gentle",
    brief: "A probe has to be released below 2 r<sub>s</sub>, and you have to come back. Two holes are on offer: a stellar-mass one, 21 Suns, and Sagittarius A*, four million. " +
           "One of these is a routine job. The other is not survivable. <b>Choose.</b>",
    learn: [
        { h: "What actually kills you", p: "Not gravity — in free fall you feel none of it. What you feel is the <b>difference</b> in gravity between your head and your feet: the tide. It stretches you along the line to the hole and squeezes you from the sides. The word is <i>spaghettification</i> and it is a technical term." },
        { h: "Tides scale the wrong way", p: "The stretch per metre is 2GM/r³. At the horizon r grows in step with M, so the tide there falls as <b>1/M²</b>. A small black hole is a knife; a huge one is a gentle slope. For a hole of a few Suns you are torn apart hundreds of kilometres before the horizon. For Sagittarius A* you would cross the horizon without noticing anything at all." },
        { h: "Same hole, different size", p: "Notice that the chart looks identical for both. Horizon at 1, photon sphere at 1.5, last orbit at 3. A black hole has no surface, no material, no features: only a mass. Scale the mass and everything — every distance, every duration — scales with it. The only thing that changes is how steep the gradient is across something the size of you." }
    ],
    hints: [
        "Watch the <b>tide</b> gauge: that is the stretch between your head and feet, in g. The hull fails at 10.",
        "The easy way down: <kbd>H</kbd> for hover, hold <kbd>S</kbd> to descend below 2 r<sub>s</sub>, then <kbd>W</kbd> to climb past 10.",
        "The cheap way down: fall most of the way and brake late. Falling is free."
    ],
    fact: "For a 2-metre person, the tide at the horizon is about twenty million g for a 10-solar-mass hole, and a ten-thousandth of a g for Sagittarius A*. The crossover — uncomfortable but survivable — is around ten thousand Suns.",
    variants: [
        { id: "small", name: "Cygnus X-1", sub: "21 Suns · horizon radius 62 km" },
        { id: "big", name: "Sagittarius A*", sub: "4.3 million Suns · horizon radius 12.7 million km" }
    ],
    mustChoose: true,

    setup: function (opt) {
        const small = opt && opt.variant === "small";
        if (small) {
            return holeCfg(CYGNUS_MSUN, {
                variant: "small", ship: localState(1, 190, 0.5, -0.02, 0.012), heading: 0.5 + Math.PI,
                aMax: 0.0012, fuel: 0.6, timeScale: 90, viewR: 230, tideLimit: 10, clock: "ms",
                depth: 2, exit: 10,
                overlays: { predict: true, rings: true, river: false, cone: false, contours: false, disc: false, pulses: false }
            });
        }
        return holeCfg(SGR_A_MSUN, {
            variant: "big", ship: circularState(1, 12, 0.5, 1), heading: 0.5 + Math.PI / 2,
            aMax: 0.7, aManual: 0.05, fuel: 9, timeScale: 9, viewR: 15, zoomMin: 4.5, tideLimit: 10,
            depth: 2, exit: 10,
            overlays: { predict: true, rings: true, river: false, cone: false, contours: false, disc: true, pulses: false }
        });
    },
    init: function (sim) { sim.marks.dropped = false; },
    update: function (sim) {
        const m = sim.marks;
        if (!m.dropped && sim.d.r < sim.cfg.depth) { m.dropped = true; m.dropTau = sim.tau; sim.events.push({ type: "leg", name: "Probe released — now get out" }); }
        if (m.dropped && sim.d.r > sim.cfg.exit) sim.win();
    },
    goals: function (sim) {
        return [
            { text: "Descend below 2 r<sub>s</sub> and release the probe", done: sim.marks.dropped, note: sim.d.r.toFixed(2) + " rs" },
            { text: "Climb back out past 10 r<sub>s</sub>", done: sim.status === "won" },
            { text: "Tide across your body", done: false, plain: true, flag: sim.tideG() > 3,
              note: sim.tideG() < 0.01 ? sim.tideG().toExponential(1) + " g" : fmtNum(sim.tideG(), 2) + " g" }
        ];
    },
    debrief: function (sim) {
        const small = sim.cfg.variant === "small";
        if (sim.status === "lost" && sim.failCode === "tides") {
            const km = sim.d.r * sim.unitM / 1000;
            return {
                stars: 0, title: "Spaghettified",
                lines: [
                    "The hull failed at <b>" + sim.d.r.toFixed(0) + " r<sub>s</sub></b> — " + fmtNum(km, 0) + " km out, nowhere near the horizon. The difference in pull between your head and your feet had reached 10 g and was doubling every few seconds.",
                    "At the horizon of this hole it would have been about " + fmtNum(tidalPerMeter(sim.rsM, 1) * 2 / G0_SI, 0) + " g. Nothing made of atoms gets there in one piece.",
                    small ? "Try the big one. It is two hundred thousand times heavier — and at its horizon the tide is forty billion times weaker." : ""
                ].filter(Boolean)
            };
        }
        return {
            stars: starsFor(sim.fuelUsed, 3.2, 5.5, true),
            title: "Probe delivered",
            lines: [
                "You went down to <b>" + sim.rMin.toFixed(2) + " r<sub>s</sub></b> of a four-million-Sun black hole and the worst tide you felt was <b>" + sim.maxTide.toExponential(1) + " g</b> — less than the tide the Moon raises on you right now.",
                "Hovering and climbing out were another matter: the engine peaked at " + fmtNum(sim.maxG, 0) + " g. Gravity you fall with is harmless. Gravity you resist is not.",
                "Fuel used: " + sim.fuelUsed.toFixed(2) + " c."
            ]
        };
    },
    pilot: "tides"
});

/* ============================================================ 8. POINT OF NO RETURN */

const MAX_INSIDE = Math.PI / 2;     // longest possible life inside the horizon, in rs/c

MISSIONS.push({
    id: "plunge",
    chapter: "Black holes",
    title: "Point of no return",
    tag: "What the horizon really is",
    brief: "The last lesson is one-way. You are hovering at 5 r<sub>s</sub> above Sagittarius A*, beacon flashing once a minute by your own clock, and mission control is listening. " +
           "Switch off the hover (<kbd>H</kbd>) and see for yourself what happens at a horizon. Then try to come back.",
    learn: [
        { h: "Space is falling", p: "Turn on the <b>river</b>. One exact way to read Einstein's equations near a black hole: space itself flows inward, like water towards a drain, at the Newtonian escape speed √(r<sub>s</sub>/r)·c. Everything — ships, light — moves through that water and obeys special relativity relative to it. At the horizon the water reaches the speed of light. Inside, it is faster." },
        { h: "The circle around your ship", p: "That circle is everywhere a flash of light from your ship could be a moment from now: it spreads at c, while the river carries it inward. Your future has to lie <b>inside</b> it. Far out, the circle surrounds you, and you can go any way you like. At the horizon its outer edge just touches you. Inside, it does not contain you at all: every possible future — even light aimed straight out — is closer to the centre than you are now. The singularity is not a place in front of you. It is a time ahead of you." },
        { h: "Two stories, both true", p: "Let go, and about twelve minutes later by your own clock you will cross the horizon, and feel nothing: there is no wall, no jolt, nothing marks the spot. Mission control never sees it. Each ping has further to climb out of a faster river, so they arrive further and further apart, redder and fainter, and the last one before the horizon takes forever. Watch the gaps in the signal log. Nobody is wrong; the two accounts are simply about different sets of events, and no signal can ever pass between them to argue about it." },
        { h: "Don't struggle (much)", p: "From a standing start at the horizon the longest possible survival time inside is <b>π/2 · r<sub>s</sub>/c</b> — 67 seconds for this hole — and you get it by doing nothing. If you arrive already falling fast, a burn outwards early on buys some of that back. After that every newton makes it shorter: inside, thrust in <i>any</i> direction is thrust towards the end." }
    ],
    hints: [
        "<kbd>H</kbd> releases the hover. After that the engine is yours — <kbd>↑</kbd>/<kbd>W</kbd> thrusts, <kbd>C</kbd> points the nose away from the hole.",
        "To last longest inside: creep down on hover (<kbd>S</kbd>) as low as the autopilot will take you, then let go.",
        "Inside, a burn straight outwards (<kbd>C</kbd> + <kbd>W</kbd>) helps — but only until your energy line in the chart touches the bottom of the hill. Then stop. Every second of thrust after that is a second off your life.",
        "Watch the window. The black disc grows — but even at the horizon it covers much less than half the sky."
    ],
    fact: "What you see as you cross is not the future of the universe speeding past — that is what a ship <i>hovering</i> near the horizon would see. Falling in, the outside world looks slowed and reddened, and you only ever see a finite stretch of its history.",

    setup: function () {
        return holeCfg(SGR_A_MSUN, {
            ship: localState(1, 5, 0.9, 0, 0), heading: 0.9,
            aMax: 1.6, fuel: Infinity, timeScale: 1.4, insideTimeScale: 0.22, viewR: 7,
            startHover: true, pingEvery: 60 / (rsMeters(SGR_A_MSUN) / C_SI), listenR: 9, pulseLife: 26, zoomMin: 2.6,
            overlays: { predict: true, rings: true, river: true, cone: true, contours: false, disc: false, pulses: true }
        });
    },
    onSingularity: function (sim) {
        sim.marks.inside = sim.tau - sim.tauCross;
        sim.win();
    },
    update: function (sim) {
        /* At the crossing, fly a ghost with the engine off to the end, so the
         * debrief can say what doing nothing would have been worth. */
        if (sim.tauCross !== null && sim.marks.coastInside === undefined) {
            const g = { x: sim.ship.x, y: sim.ship.y, wx: sim.ship.wx, wy: sim.ship.wy, tau: 0, T: 0, dil: 0, farLost: true };
            let end = null, n = 0;
            while (!end && n++ < 100000) end = advance(sim.world, g, 0.01, 0, 0);
            sim.marks.coastInside = g.tau;
        }
    },
    goals: function (sim) {
        const inside = sim.tauCross !== null;
        return [
            { text: "Release the hover and fall", done: !sim.hover && sim.d.rdot < -1e-3 || inside },
            { text: "Cross the horizon", done: inside, note: inside ? "" : sim.d.r.toFixed(3) + " rs" },
            { text: inside ? "Now try to get back out" : "…", done: false, plain: true,
              note: inside ? fmtDuration((sim.tau - sim.tauCross) * sim.unitS) + " inside" : "" }
        ];
    },
    debrief: function (sim) {
        const t = sim.marks.inside, s = sim.unitS, heard = sim.pings.filter(function (p) { return p.THeard !== null; }).length;
        return {
            stars: starsFor(t / MAX_INSIDE, 0.75, 0.55),
            title: "The end of the line",
            lines: [
                "You survived <b>" + (t * s).toFixed(1) + " s</b> inside the horizon. With the engine off from the moment you crossed it would have been " + (sim.marks.coastInside * s).toFixed(1) + " s; the longest any path allows is " + (MAX_INSIDE * s).toFixed(1) + " s.",
                "You sent " + sim.pings.length + " pings. Mission control has heard <b>" + heard + "</b> of them so far, and the gaps were still growing. The ones you sent from inside will never arrive — not late, never. On their screens you are still there, just above the horizon, dimmer and redder every hour.",
                "Nothing marked the crossing. No wall, no flash: locally, spacetime at the horizon of a big black hole is as ordinary as it is where you are sitting. The horizon is not a thing. It is the last moment at which leaving was still one of your futures."
            ]
        };
    },
    pilot: "plunge"
});

/* ============================================================ 9. FREE FLIGHT */

MISSIONS.push({
    id: "sandbox",
    chapter: "Laboratory",
    title: "Free flight",
    tag: "No objectives. Everything switched on.",
    brief: "Unlimited fuel, a strong engine, every instrument and overlay available, and nothing to achieve. Pick a hole and go and find things out.",
    learn: [
        { h: "Things to try", p: "Hover just above the horizon and watch the far clock race. Find the circular orbit at exactly 3 r<sub>s</sub> and see how long you can hold it. Drop in from far away with L = 2 (in the energy chart) and watch the zoom-whirl orbit circle at 2 r<sub>s</sub> before flying back out. Fall through the horizon facing outwards with the river and the light circle on." },
        { h: "What the chart is", p: "The map is an exact flat slice of the spacetime in \"rain\" coordinates — the coordinates of observers who fell in from rest far away. Distances on it are the distances they would measure. It is not a photograph. The round window is the photograph: a ray-traced view towards the hole, with your own speed's aberration and Doppler shift applied." },
        { h: "What is left out", p: "Real black holes spin, which drags space round with them and lets stable orbits reach much closer in. Real ones near anything interesting are wrapped in hot gas. And your engine, which shrugs off thousands of g, does not exist. Everything else here is the real equations." }
    ],
    hints: [
        "<kbd>H</kbd> hover · <kbd>Z</kbd>/<kbd>X</kbd> prograde / retrograde · <kbd>C</kbd>/<kbd>V</kbd> nose out / in · <kbd>,</kbd> <kbd>.</kbd> time-warp · <kbd>R</kbd> restart",
        "The hand throttle is sized for trimming orbits. For anything heavy — holding position, climbing out from near the horizon — use the hover autopilot (<kbd>H</kbd>, then <kbd>W</kbd>/<kbd>S</kbd>): it has forty times the thrust.",
        "Toggle the overlays in the View card."
    ],
    fact: "Every closed-form result this simulation is checked against — Kepler's law in far time, the 6πM/p precession, the fall times, the photon sphere, the 42° shadow at the horizon — is in test_headless.js next to this file.",
    variants: [
        { id: "sgr", name: "Sagittarius A*", sub: "4.3 million Suns — gentle tides" },
        { id: "lev", name: "Leviathan", sub: "10¹¹ Suns — a time unit is 11 days" },
        { id: "cyg", name: "Cygnus X-1", sub: "21 Suns — tides switched off, or you would not get close" }
    ],
    setup: function (opt) {
        const v = opt && opt.variant;
        const mass = v === "lev" ? LEVIATHAN_MSUN : v === "cyg" ? CYGNUS_MSUN : SGR_A_MSUN;
        return holeCfg(mass, {
            variant: v || "sgr", ship: circularState(1, 9, 0.2, 1), heading: 0.2 + Math.PI / 2,
            aMax: 1.2, aManual: 0.03, fuel: Infinity, timeScale: 8, insideTimeScale: 0.3, viewR: 13, zoomMin: 3.2,
            pingEvery: 4, listenR: 25, pulseLife: 60, clock: v === "lev" ? "days" : "ms",
            overlays: { predict: true, rings: true, river: true, cone: true, contours: true, disc: true, pulses: false, potential: true }
        });
    },
    update: function () {},
    goals: function () { return []; },
    debrief: function (sim) {
        return { stars: 0, title: sim.status === "won" ? "Done" : "Flight over", lines: [
            "Ship clock " + fmtDuration(sim.tau * sim.unitS) + (sim.ship.farLost ? "; the far clock ran off the end of its scale when you crossed the horizon." : ", far clock " + fmtDuration(sim.tFar * sim.unitS) + "."),
            "Closest approach " + sim.rMin.toFixed(3) + " r<sub>s</sub>."
        ] };
    },
    onSingularity: function (sim) { sim.marks.inside = sim.tau - sim.tauCross; }
});

if (typeof module !== "undefined") {
    module.exports = { holeCfg, DEEP_GAIN, MAX_INSIDE };
}
