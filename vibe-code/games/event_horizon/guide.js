/* guide.js — the field guide: one short page per idea.
 *
 * Reference text, reachable from anywhere in the game. Each page says what the
 * idea is, gives the one formula worth remembering, anchors it to something
 * that has actually been measured, and points at the mission where you can
 * feel it. Numbers quoted here are the accepted ones; where the game simplifies
 * (no spin, a magic engine), the last page says so.
 */
"use strict";

const GUIDE = [
    {
        id: "freefall", title: "Free fall", one: "Falling feels like nothing. That is the clue.",
        body: [
            "Drop a ball inside a falling lift and it floats in front of you. Astronauts float for the same reason: not because gravity is absent — at the height of the space station it is still 90% of its strength on the ground — but because they and everything around them are falling together.",
            "Einstein called this his happiest thought. If a freely falling observer feels no gravity, then locally gravity is <b>not there</b>: it is not a force pulling on things, but something about the shape of space and time that tells free things which paths are straight. Everything in general relativity grows from that.",
            "In the game, your accelerometer (“you feel”) reads zero whenever the engine is off — in low Earth orbit, skimming a black hole, even while crossing a horizon. The only thing that ever makes you heavy is refusing to fall."
        ],
        formula: "free fall &nbsp;⇔&nbsp; zero proper acceleration", mission: "orbit"
    },
    {
        id: "orbits", title: "Orbits", one: "An orbit is a fall that keeps missing the ground.",
        body: [
            "Throw something sideways fast enough and the ground curves away beneath it as quickly as it drops. For a circular orbit of radius r around a mass M that speed is √(GM/r): 7.7 km/s just above the Earth, 1 km/s out at the Moon. Higher orbits are <b>slower</b>, and take longer: T² ∝ r³, Kepler's third law.",
            "To change an orbit you change your speed, and the orbit changes on the <b>opposite</b> side: burn forwards and the far side rises; burn backwards and it sinks. Two forward burns half an orbit apart move you from one circle to a higher one — the Hohmann transfer every real mission uses.",
            "An orbit needs no fuel to maintain. That is why moons and planets are still where they are after four billion years."
        ],
        formula: "v<sub>circ</sub> = √(GM / r) &nbsp;&nbsp;&nbsp; T = 2π √(r³ / GM)", mission: "gps"
    },
    {
        id: "lightspeed", title: "The speed limit", one: "You can keep accelerating for ever and never reach c.",
        body: [
            "The speed of light is the same for every observer, however they are moving. That one fact forces speeds to combine differently from everyday experience: 0.9 c plus 0.9 c is 0.994 c, not 1.8 c. Keep the engine burning and your speed creeps towards c without ever arriving.",
            "What does grow without limit is γ (gamma), the Lorentz factor. It is 1 at rest, 1.15 at half the speed of light, 2 at 0.87 c, 7 at 0.99 c. γ is the factor by which your clock runs slow, your length contracts, and your kinetic energy grows, as measured by someone you are moving past.",
            "This is tested every second of every day. Particle accelerators would not work without it, and muons made by cosmic rays 15 km up reach the ground only because, at γ ≈ 20, their 2.2-microsecond lifetime is stretched long enough to make the trip."
        ],
        formula: "γ = 1 / √(1 − v²/c²)", mission: "proxima"
    },
    {
        id: "twins", title: "The twin paradox", one: "The traveller really does come home younger.",
        body: [
            "One twin flies to a star and back at high speed; the other stays home. When they meet again the traveller has aged less. Not apparently — actually: fewer heartbeats, fewer birthdays.",
            "It sounds paradoxical because motion is relative: from the ship, isn't it the Earth that moved? But the two histories are not alike. The traveller fired engines and turned round; the stay-at-home never did. A clock measures the length of its own path through spacetime, and between the same two meetings the straight, unaccelerated path is always the <b>longest</b>.",
            "You can follow the bookkeeping with light signals. Send a pulse home every three months: on the way out they arrive stretched far apart, on the way back squeezed together — and the long gaps last for most of Earth's calendar, because the turn-round happens at the far end and the news of it takes years to arrive.",
            "In 1971 Hafele and Keating flew atomic clocks round the world on airliners, east and west, and found the predicted differences: tens to hundreds of nanoseconds."
        ],
        formula: "Δτ<sub>ship</sub> = ∫ √(1 − v²/c²) dt", mission: "proxima"
    },
    {
        id: "gravtime", title: "Gravity slows time", one: "Clocks deeper in a gravity well tick slower.",
        body: [
            "A clock at rest at radius r from a mass M ticks at √(1 − r<sub>s</sub>/r) of the rate of a clock far away, where r<sub>s</sub> = 2GM/c² is the mass's Schwarzschild radius. On the surface of the Earth the deficit is 0.7 parts in a billion; on a neutron star, 20%; at a black hole's horizon the factor goes to zero.",
            "Nothing feels different to the person with the slow clock. Their watch, their pulse and their thoughts all slow together. What they notice, if they look up, is the rest of the universe running fast and blue-shifted.",
            "This has been measured directly. In 1959 Pound and Rebka detected the shift over the 22 metres of a Harvard tower. Today's best optical clocks can tell that one of them has been raised by a <b>millimetre</b>.",
            "Note the word “at rest”. Holding still in a gravitational field takes force — a floor, or an engine. A clock that is simply falling keeps the rate of its own free-fall path, which is why orbits are the cheap way to use this effect and hovering is the expensive one."
        ],
        formula: "dτ / dt = √(1 − r<sub>s</sub>/r) × √(1 − v²/c²)", mission: "deepwell"
    },
    {
        id: "gps", title: "GPS", one: "The piece of general relativity in your pocket.",
        body: [
            "A GPS receiver works out where it is by timing radio signals from satellites 20,200 km up. Light covers 30 cm in a nanosecond, so the satellite clocks have to agree with clocks on the ground to a few nanoseconds.",
            "Two relativistic effects pull them apart. The satellites move at 3.9 km/s, which slows their clocks by 7 microseconds a day. They also sit higher in the Earth's gravity well, which speeds them up by 46 microseconds a day. The net result: +38 µs a day, or an error of 11 km a day if nothing were done about it.",
            "So something is done. The clocks are built to run slow by exactly 4.465 parts in ten billion before launch, and tick at the right rate once in orbit."
        ],
        formula: "+45.7 µs/day (gravity) &nbsp;−&nbsp; 7.2 µs/day (speed) &nbsp;=&nbsp; +38.5 µs/day", mission: "gps"
    },
    {
        id: "blackhole", title: "Black holes and horizons", one: "A region that nothing, including light, can leave.",
        body: [
            "Squeeze any mass inside its Schwarzschild radius r<sub>s</sub> = 2GM/c² and nothing can hold it up: it collapses, and leaves behind a region of spacetime from which no path leads out. For the Sun r<sub>s</sub> is 3 km; for the Earth, 9 mm.",
            "The boundary of that region is the <b>event horizon</b>. It is not a surface. There is nothing there — no membrane, no wall, nothing to hit. A falling observer crossing the horizon of a large black hole notices nothing at the moment of crossing. The horizon is defined by what happens afterwards: it is the last place from which leaving was possible.",
            "A black hole has no other features. Mass (and, for real ones, spin) is all there is, and everything about it scales with the mass: the hole at the centre of our galaxy, Sagittarius A*, is 4.3 million Suns and 12.7 million km in radius; the one in the galaxy M87 is 6.5 billion Suns and bigger than the Solar System."
        ],
        formula: "r<sub>s</sub> = 2GM / c² &nbsp;≈&nbsp; 2.95 km per solar mass", mission: "plunge"
    },
    {
        id: "river", title: "The river of space", one: "One exact way to picture it: space itself falls in.",
        body: [
            "Einstein's equations for a non-rotating black hole can be written in a form with a beautifully simple reading. Space is flat, but it <b>flows</b>: inward, at the speed something would have if it fell from rest far away, √(r<sub>s</sub>/r) × c. Everything moves through that flowing space obeying ordinary special relativity.",
            "Far out the current is slow and a gentle thrust holds you against it. At the horizon it reaches the speed of light, and a light ray aimed straight outwards stands still, like a fish swimming flat out at the lip of a waterfall. Inside, the current is faster than light, and swimming upstream — for fish, ships or photons — is not slow but impossible.",
            "This is not an analogy bolted on for the game: it is the Gullstrand–Painlevé form of the Schwarzschild metric, and it is how the ship is actually flown here. It also explains a subtle point: gravitational time dilation and speed time dilation are one effect. A hovering clock is slow for the same reason a fast clock is — it is moving, at √(r<sub>s</sub>/r)·c, through the river."
        ],
        formula: "ds² = −c²dT² + |d<b>x</b> − <b>V</b> dT|², &nbsp; <b>V</b> = −√(r<sub>s</sub>/r) c r̂", mission: "plunge"
    },
    {
        id: "lightcone", title: "Light cones", one: "Your future is wherever light from here could get to.",
        body: [
            "Nothing outruns light, so every possible future of yours lies inside the region a flash of light from you, now, could reach. Draw time upwards and that region is a cone; look at it from above, a moment later, and it is a circle. The game can draw that circle round your ship.",
            "In empty space the circle is centred on you: you can go anywhere. Near a mass the river carries the circle inward as it spreads, so it sits off-centre, towards the hole. At the horizon its outer edge passes exactly through you: the best you could possibly do, moving outward at the speed of light, is stay where you are.",
            "Inside the horizon the circle no longer contains you at all. Every direction you can move in — forwards, backwards, straight “out” — ends closer to the centre than you are now. The centre has stopped being a place you could avoid and become a time you will reach."
        ],
        formula: "dr/dT = ±c − √(r<sub>s</sub>/r) c &nbsp;&nbsp; (light, in rain coordinates)", mission: "plunge"
    },
    {
        id: "photonsphere", title: "The photon sphere and the shadow", one: "At 1.5 r<sub>s</sub>, light itself can orbit.",
        body: [
            "Gravity bends light more the closer it passes. At exactly 1.5 r<sub>s</sub> a ray aimed sideways is bent into a circle. The orbit is unstable — the slightest error and the light spirals in or peels away — but rays that arrive just outside it can loop the hole once, twice or more before leaving.",
            "That sets the size of what you see. Any ray aimed closer than 2.6 r<sub>s</sub> from the centre (the critical “impact parameter”, 3√3/2) is captured. So from far away a black hole looks like a dark disc 2.6 times bigger than its horizon, edged by a thin bright ring of light that has circled it. That is the <b>shadow</b> the Event Horizon Telescope photographed in M87 in 2019 and in our own galaxy in 2022.",
            "Stand at the photon sphere and look sideways, and in principle you see the back of your own head."
        ],
        formula: "r<sub>photon</sub> = 3GM/c² = 1.5 r<sub>s</sub> &nbsp;&nbsp;&nbsp; b<sub>crit</sub> = (3√3/2) r<sub>s</sub>", mission: "lightbend"
    },
    {
        id: "isco", title: "The last stable orbit", one: "Inside 3 r<sub>s</sub>, orbits fall apart.",
        body: [
            "In Newton's gravity you can orbit a point mass as closely as you like. In Einstein's, the equation for your distance from the centre gains an extra attractive term, −3GML²/c²r⁴, which is negligible far away and overwhelming close in.",
            "The result is a floor. Outside 3 r<sub>s</sub> circular orbits are stable: nudge one and it wobbles. Between 1.5 and 3 r<sub>s</sub> circular orbits still exist but are balanced on a knife edge. Inside 1.5 r<sub>s</sub> there are none.",
            "This is why the discs of hot gas around black holes have an inner edge. Gas spirals in slowly through stable orbits, radiating as it goes, until it reaches 3 r<sub>s</sub> — and then drops straight in. By that point it has given up 5.7% of its rest mass as light. Nuclear fusion manages 0.7%. Falling into a black hole is the most efficient engine in nature, and it is what makes quasars visible across the universe."
        ],
        formula: "r̈ = −GM/r² + L²/r³ − 3GML²/(c²r⁴) &nbsp;&nbsp;&nbsp; r<sub>ISCO</sub> = 6GM/c² = 3 r<sub>s</sub>", mission: "isco"
    },
    {
        id: "precession", title: "Orbits that do not close", one: "The ellipse turns a little with every lap.",
        body: [
            "Newton's elliptical orbits close exactly: the low point is in the same direction every time. The same extra term that destroys close orbits makes wider ones <b>precess</b>: each lap the low point advances by 6πGM/c²p radians, where p sets the size of the ellipse.",
            "For Mercury that is 43 seconds of arc per century — tiny, but astronomers had been puzzled by exactly that discrepancy since 1859. When Einstein found in November 1915 that his new theory gave the number with nothing adjusted, he wrote that he was “beside himself with joy” for days.",
            "Near a black hole the advance is not arc-seconds but tens or hundreds of degrees a lap, and an orbit draws a rosette. Stars have now been watched doing this around Sagittarius A*. Close to the last stable orbit, a path can circle the hole several times at its low point before swinging back out: a “zoom-whirl”."
        ],
        formula: "Δφ = 6πGM / (c² p) &nbsp; per orbit", mission: "isco"
    },
    {
        id: "lensing", title: "Bending light", one: "Mass is a lens.",
        body: [
            "A ray of light passing a mass at distance b is deflected by 4GM/c²b = 2r<sub>s</sub>/b radians — exactly twice what you get by naïvely treating light as a fast Newtonian particle. For starlight grazing the Sun that is 1.75 seconds of arc. Eddington's eclipse expeditions measured it in 1919; the result was front-page news and made Einstein a celebrity.",
            "Because light can pass on either side of a mass, a source behind one appears <b>twice</b>, on opposite sides, and if the alignment is perfect the images merge into a circle: an Einstein ring. Astronomers see hundreds of these around galaxies and clusters, and use them to weigh the lens — including the dark matter in it, which can be found no other way.",
            "In the game, the round window is drawn this way: every star is placed where its light really arrives from, and stars behind the hole have second images squeezed against the edge of the shadow."
        ],
        formula: "α = 4GM / (c² b) = 2 r<sub>s</sub> / b", mission: "lightbend"
    },
    {
        id: "redshift", title: "Redshift", one: "Light climbing out of a well arrives tired; light from a receding source arrives stretched.",
        body: [
            "Light sent upward from deep in a gravity well arrives with a lower frequency — redder, and with its ticks further apart. It has to: if a deep clock ticks slowly as judged from far away, then the waves it sends, one crest per tick, must arrive slowly too. For a hovering sender the factor is √(1 − r<sub>s</sub>/r).",
            "Motion adds the Doppler shift on top: approaching sources are blue-shifted, receding ones red-shifted, and even purely sideways motion gives a small redshift from time dilation alone.",
            "Put the two together for a ship falling into a black hole and the received frequency falls to zero at the horizon. Watching from far away you never see the ship cross: its image slows, reddens through infrared into radio, and fades. The ship's own experience is quite different — see “Inside the horizon”."
        ],
        formula: "ν<sub>far</sub> / ν<sub>sent</sub> = (1 − β) / (γ − w<sub>r</sub>) &nbsp;&nbsp; → &nbsp; √(1 − r<sub>s</sub>/r) when hovering", mission: "plunge"
    },
    {
        id: "tides", title: "Tides", one: "It is not the pull that gets you. It is the difference in pull.",
        body: [
            "In free fall you feel no gravity — but only at a point. Your feet, nearer the mass, are pulled harder than your head, and your left and right sides are pulled along lines that converge. The result is a stretch along the direction to the mass and a squeeze across it. The Moon does this to the Earth's oceans twice a day.",
            "The stretching acceleration per metre of height is 2GM/r³. At a black hole's horizon r is proportional to M, so the tide there falls as 1/M². At the horizon of a ten-solar-mass hole it is tens of millions of g across a human body; you would be pulled into a thin stream of atoms (“spaghettified”) hundreds of kilometres out. At the horizon of Sagittarius A* it is a ten-thousandth of a g and you would not notice.",
            "Tides are what gravity <b>really</b> is, in Einstein's picture: the part of it that free fall cannot remove. They are the curvature of spacetime."
        ],
        formula: "Δa = (2GM / r³) × height &nbsp;&nbsp;&nbsp; at the horizon: ∝ 1 / M²", mission: "tides"
    },
    {
        id: "inside", title: "Inside the horizon", one: "The singularity is not a place ahead of you. It is a time.",
        body: [
            "Inside the horizon the roles of “inward” and “later” become entangled. Reaching smaller r is as unavoidable as reaching next Tuesday: all of your possible futures point that way. You cannot hover, you cannot orbit, and you cannot see the centre — no light comes out from it.",
            "You <b>can</b> still see out. Light from the rest of the universe keeps falling in after you, and you go on seeing the stars, red-shifted and crowded towards a band around the sky as the black shadow ahead grows. Contrary to a popular story, you do not see the whole future of the universe flash past: you only ever receive a finite stretch of outside history before the end.",
            "The end comes quickly. The longest possible time from horizon to singularity, by any path and with any engine, is π GM/c³: 15 microseconds for a hole of one solar mass, 67 seconds for Sagittarius A*, a little over a day for the giant in M87. The path that achieves it is free fall from rest at the horizon. Thrusting “away” shortens it.",
            "What happens <b>at</b> the singularity nobody knows. General relativity predicts infinite tides there, which is the theory announcing that it has stopped being the right theory."
        ],
        formula: "τ<sub>max</sub> = π GM / c³ = (π/2) r<sub>s</sub> / c", mission: "plunge"
    },
    {
        id: "now", title: "What does “now” mean far away?", one: "Less than you would think.",
        body: [
            "The game shows two clocks: yours, and the one you left behind. Yours is unambiguous. But which reading of the distant clock is happening “right now”, while you are apart and moving? Relativity's answer is that there is no fact of the matter: different, equally good conventions give different answers. Only comparisons made at the same place — leaving, and coming back — are absolute.",
            "The game uses the convention of a distant observer at rest (Schwarzschild time), because it is the one in which the textbook rule <b>rate = gravity × speed</b> holds exactly at every instant. Every convention agrees about what the clocks read when you are reunited.",
            "That convention has a famous oddity: it assigns an infinite time to your arrival at a horizon. That is why the far clock runs away and shows ∞ as you cross. It does not mean the universe ends, or that you see its future. It means that no moment on the distant observer's calendar can be matched to events at or inside the horizon — which is another way of saying that they can never see or be affected by them."
        ],
        formula: "only meetings are absolute", mission: "deepwell"
    },
    {
        id: "honesty", title: "What is real here, and what is not", one: "The physics is exact. The engine is fiction.",
        body: [
            "<b>Exact:</b> the ship's motion is the true equation of motion in the Schwarzschild spacetime, thrust included — not Newtonian gravity with corrections. The last stable orbit, the precession, the photon sphere, the horizon and the fall times are not programmed in; they emerge, and a test suite checks each against its textbook formula. The clocks are integrated along your actual path. The Earth missions run on the same code, which is why the GPS numbers come out right. Light pulses and laser shots are real light rays. The window is ray-traced.",
            "<b>Simplified:</b> real black holes spin, which drags space around with them, moves the last stable orbit inward (to ½ r<sub>s</sub> at maximum spin) and makes the huge time-dilation factor in the film <i>Interstellar</i> possible; here they do not. The hot gas disc is decoration and does not hurt you. Other planets and stations have no gravity of their own. Hawking radiation is ignored because for any hole bigger than a mountain it is utterly negligible.",
            "<b>Fiction:</b> the engine. Hovering at 2 r<sub>s</sub> above Sagittarius A* takes a hundred thousand g, sustained, and a fuel supply many times the ship's mass-energy. No real spacecraft will ever do what yours does casually. That is the true reason nobody will use a black hole as a time machine: not that it would not work, but that standing still next to one costs more than anything else in the universe."
        ],
        formula: "tested: run <code>node test_headless.js</code>", mission: "sandbox"
    }
];

if (typeof module !== "undefined") module.exports = { GUIDE };
