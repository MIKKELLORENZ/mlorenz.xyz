// Japan · Suburb — quiet edge-of-town street through a full day cycle.
// Two rows of houses (with kawara tile, AC outdoor units, antennas, gates,
// balcony laundry), an electric-pole tangle with insulators and a transformer,
// a sun-aware Mt-Fuji, rice paddy reflecting the sky, drifting clouds,
// crows, a stray cat, an occasional kei-truck, and an occasional shinkansen
// streaking across the elevated viaduct in the distance.

(function () {
    'use strict';

    const CONFIG = {
        DAY_CYCLE_MS: 240000,
        CYCLE_START: 0.40,

        // House row counts.
        FG_HOUSE_TARGET: 14,
        BG_HOUSE_TARGET: 12,

        // Power infrastructure.
        FG_POLE_COUNT: 6,

        // Star count (cached in init).
        STAR_COUNT: 220,

        // Cloud count.
        CLOUD_COUNT: 7,

        // Crow count.
        CROW_COUNT: 3,

        // Petal counts.
        FG_PETAL_COUNT: 28,
        BG_PETAL_COUNT: 12,

        // Actor cadence (ms).
        KEI_INTERVAL_MIN: 32000,
        KEI_INTERVAL_MAX: 70000,
        SHINKANSEN_INTERVAL_MIN: 22000,
        SHINKANSEN_INTERVAL_MAX: 54000,
        CROW_HOP_INTERVAL_MIN: 30000,
        CROW_HOP_INTERVAL_MAX: 70000,
        CAT_INTERVAL_MIN: 60000,
        CAT_INTERVAL_MAX: 130000,

        // House archetype distribution (cumulative).
        ARCHETYPE_WEIGHTS: [
            { type: 'minka',       w: 0.22 },
            { type: 'kawara_hip',  w: 0.20 },
            { type: 'machiya',     w: 0.12 },
            { type: 'modern_mono', w: 0.16 },
            { type: 'townhouse',   w: 0.18 },
            { type: 'shophouse',   w: 0.08 },
            { type: 'apartment',   w: 0.04 },
        ],
    };

    const SKY_STOPS = [
        { t: 0.00, top: '#02040c', horizon: '#070b1c', sun: '#cfd4e0', sunI: 0.06 }, // deep midnight
        { t: 0.08, top: '#050810', horizon: '#0a1024', sun: '#cfd4e0', sunI: 0.08 }, // late night
        { t: 0.16, top: '#0a1228', horizon: '#1a2244', sun: '#cfd4e0', sunI: 0.12 }, // pre-dawn cool
        { t: 0.22, top: '#1c1c44', horizon: '#5a3658', sun: '#ddc0a8', sunI: 0.30 }, // blue hour
        { t: 0.27, top: '#3a2452', horizon: '#b86070', sun: '#ffd0a0', sunI: 0.65 }, // dawn
        { t: 0.31, top: '#5a6aa8', horizon: '#ed9a78', sun: '#ffd8a4', sunI: 0.85 }, // sunrise glow
        { t: 0.36, top: '#7baadc', horizon: '#f4cea0', sun: '#fff0c8', sunI: 0.95 }, // post-dawn
        { t: 0.44, top: '#80b8e8', horizon: '#dde8f2', sun: '#fff4d0', sunI: 1.00 }, // morning clarity
        { t: 0.50, top: '#82c0f0', horizon: '#e0eef8', sun: '#fffcea', sunI: 1.00 }, // mid-morning
        { t: 0.55, top: '#80c2f0', horizon: '#e4f0fa', sun: '#fffcea', sunI: 1.00 }, // noon high blue
        { t: 0.62, top: '#7eb6ea', horizon: '#eee2c8', sun: '#fff4c8', sunI: 1.00 }, // mid-afternoon
        { t: 0.68, top: '#7898d8', horizon: '#f4cca0', sun: '#fff0bc', sunI: 1.00 }, // golden hour begins
        { t: 0.73, top: '#5a76b8', horizon: '#f0bc88', sun: '#ffd084', sunI: 1.00 }, // deep golden
        { t: 0.77, top: '#4a3870', horizon: '#ee9268', sun: '#ff9a4a', sunI: 0.85 }, // sunset
        { t: 0.81, top: '#2a1c48', horizon: '#cd6058', sun: '#ff6438', sunI: 0.55 }, // dusk
        { t: 0.86, top: '#161024', horizon: '#5a2c3a', sun: '#bc6048', sunI: 0.25 }, // late dusk
        { t: 0.91, top: '#08081c', horizon: '#1a1428', sun: '#cfd4e0', sunI: 0.12 }, // twilight
        { t: 1.00, top: '#02040c', horizon: '#070b1c', sun: '#cfd4e0', sunI: 0.06 }, // midnight loop
    ];

    function pickStop(stops, t) {
        for (let i = 0; i < stops.length - 1; i++) {
            if (t >= stops[i].t && t <= stops[i + 1].t) {
                const span = stops[i + 1].t - stops[i].t;
                const k = span > 0 ? (t - stops[i].t) / span : 0;
                return { a: stops[i], b: stops[i + 1], k };
            }
        }
        return { a: stops[0], b: stops[0], k: 0 };
    }

    function pickArchetype(rand) {
        const r = rand();
        let acc = 0;
        for (const a of CONFIG.ARCHETYPE_WEIGHTS) {
            acc += a.w;
            if (r < acc) return a.type;
        }
        return CONFIG.ARCHETYPE_WEIGHTS[0].type;
    }

    class SuburbWallpaper extends Wallpaper {
        // -----------------------------------------------------------
        // init / resize
        // -----------------------------------------------------------

        init() {
            const rand = this.rng(20424);

            // Foreground house row.
            this.houses = [];
            let cursor = -0.04;
            while (this.houses.length < CONFIG.FG_HOUSE_TARGET || cursor < 1.04) {
                const ww = 0.06 + rand() * 0.07;
                const tallness = rand() < 0.4 ? 0.85 + rand() * 0.45 : 0.55 + rand() * 0.3;
                const hh = ww * tallness;
                // Reroll once if the archetype repeats its neighbour, so the
                // row doesn't form blocks of identical house styles.
                let archetype = pickArchetype(rand);
                const prev = this.houses.length > 0 ? this.houses[this.houses.length - 1].archetype : null;
                if (archetype === prev) archetype = pickArchetype(rand);
                const isModern = archetype === 'modern_mono' || archetype === 'kawara_hip' || archetype === 'townhouse' || archetype === 'apartment';
                const r1 = rand(), r2 = rand();
                const isMachiya = archetype === 'machiya';
                // Roof color — kawara tile can be orange clay or blue-grey/charcoal.
                let roofCol;
                if (isModern) {
                    roofCol = r1 < 0.35 ? '#23272e' : (r1 < 0.65 ? '#2f343a' : '#3b3a36');
                } else if (isMachiya) {
                    roofCol = r1 < 0.5 ? '#3a342e' : '#322a26';
                } else {
                    // Traditional kawara: charcoal, blue-grey, or orange clay.
                    const t = r1;
                    roofCol = t < 0.45 ? '#36302c' : (t < 0.78 ? '#3a4248' : (t < 0.92 ? '#b35a30' : '#7a3c24'));
                }
                let bodyCol;
                if (isMachiya) {
                    // Dark wooden vertical-slat walls.
                    bodyCol = r2 < 0.5 ? '#4a3a2a' : (r2 < 0.85 ? '#3a2c20' : '#5a4838');
                } else if (isModern) {
                    bodyCol = r2 < 0.35 ? '#dddbd5' : (r2 < 0.6 ? '#c2c4be' : (r2 < 0.82 ? '#9aa0a0' : '#7c7e7a'));
                } else {
                    bodyCol = r2 < 0.35 ? '#d8c2a4' : (r2 < 0.6 ? '#c4ab8a' : (r2 < 0.82 ? '#a8917a' : '#b89c80'));
                }
                this.houses.push({
                    x: cursor,
                    w: ww,
                    h: hh,
                    depth: 1,
                    archetype,
                    roofCol,
                    bodyCol,
                    isModern,
                    isMachiya,
                    windowLit: rand() < 0.45,
                    twoFloor: rand() < 0.55 && tallness > 0.85,
                    door: rand() < 0.7,
                    chimney: !isModern && !isMachiya && rand() < 0.18,
                    chimneyPhase: rand() * Math.PI * 2,
                    balcony: archetype === 'townhouse' || archetype === 'apartment' || (rand() < 0.30 && tallness > 0.85),
                    sideWindow: rand() < 0.5,
                    ac: rand() < 0.70,
                    acSide: rand() < 0.5 ? 'L' : 'R',
                    antenna: rand() < 0.60,
                    antennaH: 0.4 + rand() * 0.5,
                    dish: rand() < 0.18,
                    gate: rand() < 0.45,
                    windowVariant: isMachiya ? 'koushi' : (rand() < 0.45 ? 'lattice' : (rand() < 0.5 ? 'shoji' : 'frosted')),
                    flickerOn: 1,
                    flickerNext: 600 + rand() * 2400,
                    solar: archetype === 'modern_mono',
                    onigawara: archetype === 'minka' || archetype === 'kawara_hip',
                    silWalk: 0,
                    silNext: 8000 + rand() * 30000,
                    laundry: null,
                    // Machiya extras.
                    noren: isMachiya && rand() < 0.55,
                    norenCol: rand() < 0.5 ? '#1a3a6a' : (rand() < 0.5 ? '#3a2820' : '#6a2424'),
                    // Plant pot near door.
                    plantPot: rand() < 0.40,
                    plantType: rand() < 0.5 ? 'bush' : (rand() < 0.5 ? 'bonsai' : 'pot'),
                    // Mailbox.
                    mailbox: rand() < 0.50,
                    // For apartment archetype: number of floors visible.
                    apartmentFloors: archetype === 'apartment' ? 2 + Math.floor(rand() * 2) : 0,
                });
                cursor += ww + 0.001 + rand() * 0.004;
            }

            // Background row (smaller, hazier, packed tighter).
            this.bgHouses = [];
            const brand = this.rng(99221);
            let bcur = -0.02;
            while (this.bgHouses.length < CONFIG.BG_HOUSE_TARGET || bcur < 1.02) {
                const ww = 0.035 + brand() * 0.035;
                const hh = ww * (0.6 + brand() * 0.35);
                this.bgHouses.push({
                    x: bcur,
                    w: ww,
                    h: hh,
                    roofCol: brand() < 0.5 ? '#3a3140' : '#2f3438',
                    bodyCol: brand() < 0.5 ? '#aaa9a3' : '#b7a78f',
                    isModern: brand() < 0.5,
                    windowLit: brand() < 0.35,
                });
                bcur += ww + 0.001 + brand() * 0.003;
            }

            // Poles — close near camera, smaller and tighter toward distance.
            this.poles = [];
            const prand = this.rng(311);
            for (let i = 0; i < CONFIG.FG_POLE_COUNT; i++) {
                const k = i / (CONFIG.FG_POLE_COUNT - 1);
                // Mild perspective bias + slight jitter so they don't look mechanical.
                const x = k * 1.06 - 0.03 + (prand() - 0.5) * 0.012;
                const transformerCount = i === 2 || i === 4 ? (prand() < 0.5 ? 2 : 1) : (prand() < 0.18 ? 1 : 0);
                this.poles.push({
                    x: x,
                    depth: 1,
                    h: 0.34 + prand() * 0.04,
                    tag: `NK-${String(100 + ((prand() * 900) | 0))}`,
                    transformer: transformerCount > 0,
                    transformerCount,
                    spliceBox: prand() < 0.35,
                    stayWire: i === 0 || i === CONFIG.FG_POLE_COUNT - 1 || prand() < 0.25,
                    streetLight: i === 1 || i === 3 || prand() < 0.18,
                    sign: prand() < 0.30 ? (prand() < 0.5 ? 'speed' : 'no-park') : null,
                    birdSpike: prand() < 0.40,
                    phaseOffset: prand() * Math.PI * 2,
                });
            }

            // Stars (cached).
            this.stars = [];
            const srand = this.rng(7773);
            for (let i = 0; i < CONFIG.STAR_COUNT; i++) {
                const mag = 0.3 + Math.pow(srand(), 2.2) * 0.7;
                this.stars.push({
                    x: srand(),
                    y: srand() * 0.55,
                    mag,
                    phase: srand() * Math.PI * 2,
                    bright: mag > 0.82,
                    tone: srand(),
                });
            }

            // Clouds.
            this.clouds = [];
            const crand = this.rng(403);
            for (let i = 0; i < CONFIG.CLOUD_COUNT; i++) {
                const depth = crand();
                const puffs = [];
                const n = 4 + Math.floor(crand() * 4);
                let px = 0;
                for (let k = 0; k < n; k++) {
                    puffs.push({
                        dx: px,
                        dy: (crand() - 0.5) * 6,
                        r: 14 + crand() * 16,
                    });
                    px += 10 + crand() * 16;
                }
                this.clouds.push({
                    x: crand(),
                    y: 0.10 + crand() * 0.22,
                    depth,
                    speed: 0.004 + depth * 0.006,
                    width: px,
                    puffs,
                });
            }

            // Foreground petals (anchored to main sakura).
            this.fgPetals = [];
            const ftPetalR = this.rng(55);
            for (let i = 0; i < CONFIG.FG_PETAL_COUNT; i++) {
                this.fgPetals.push(this.makePetal(ftPetalR, 1));
            }
            this.bgPetals = [];
            const bgPetalR = this.rng(77);
            for (let i = 0; i < CONFIG.BG_PETAL_COUNT; i++) {
                this.bgPetals.push(this.makePetal(bgPetalR, 0.55));
            }

            // Paddy plants — 6 rows.
            this.paddy = [];
            const prand2 = this.rng(91);
            for (let row = 0; row < 6; row++) {
                const rowK = row / 5;
                const count = 20 + row * 5;
                for (let i = 0; i < count; i++) {
                    this.paddy.push({
                        x: -0.02 + (i + prand2() * 0.5) / count,
                        rowK,
                        wobble: prand2() * Math.PI * 2,
                        size: 0.85 + prand2() * 0.3,
                    });
                }
            }

            // Crows.
            this.crows = [];
            const krand = this.rng(913);
            for (let i = 0; i < CONFIG.CROW_COUNT; i++) {
                this.crows.push({
                    state: 'perched',
                    perch: this.pickCrowPerch(krand, i),
                    headTilt: krand() * Math.PI * 2,
                    flightT: 0,
                    nextHopT: 15000 + krand() * 40000,
                    targetPerch: null,
                    flightX: 0,
                    flightY: 0,
                    flightFromX: 0,
                    flightFromY: 0,
                    flightToX: 0,
                    flightToY: 0,
                    flightDir: 1,
                });
            }

            // Cat — transient visitor (spawns from off-screen, wanders, leaves).
            this.cat = null;
            this.nextCatMs = 18000 + Math.random() * 40000;

            // Kei-truck.
            this.keiTruck = null;
            this.nextKeiTruckMs = 8000 + Math.random() * 12000;

            // Shinkansen.
            this.shinkansen = null;
            this.nextShinkansenMs = 12000 + Math.random() * 18000;

            // Sakura tree positions.
            this.sakuraFG = { x: 0.20, scale: 1.0 };
            this.sakuraBG = { x: 0.56, scale: 0.55 };

            // Reflection canvas (allocated in resize).
            this.reflCanvas = null;
            this.reflCtx = null;
        }

        makePetal(rand, scaleMul) {
            const depth = rand();
            return {
                spawn: 0, // assigned at first respawn
                ax: 0,
                ay: 0,
                vx: 0,
                vy: 0,
                depth,
                size: (3 + depth * 6) * scaleMul,
                drift: 10 + rand() * 18,
                phase: rand() * Math.PI * 2,
                rot: rand() * Math.PI * 2,
                rotSpeed: (rand() - 0.5) * 1.6,
                fall: 18 + rand() * 28 + depth * 30,
                fresh: true,
                scaleMul,
            };
        }

        pickCrowPerch(rand, i) {
            // 0,1 -> wire perches; 2 -> rooftop.
            if (i < 2) {
                return {
                    kind: 'wire',
                    poleA: i === 0 ? 1 : 3,
                    poleB: i === 0 ? 2 : 4,
                    wire: 1, // index into middle wires
                    sideT: 0.4 + rand() * 0.2,
                };
            }
            return { kind: 'roof', houseIdx: 6 + Math.floor(rand() * 4) };
        }

        resize(w, h) {
            super.resize(w, h);
            this.horizonY = h * 0.50;
            this.ridgeY = this.horizonY + 4;
            this.viaductY = h * 0.62;
            this.bgRowY = h * 0.72;
            this.fgRowY = h * 0.83;
            this.roadY = h * 0.86;
            this.paddyY = h * 0.92;
            this.paddyBot = h;
            // Backward-compat references.
            this.streetY = this.roadY;
            this.mountainY = this.horizonY + 4;
            // Sprite scale for road/wire actors authored in fixed local px
            // (kei truck, cat, crows, cyclist, shinkansen, …).
            this.as = this.sceneScale(720, 0.85, 2.0);

            // Allocate reflection offscreen.
            const reflW = Math.max(64, Math.floor(w));
            const reflH = Math.max(8, Math.floor(this.paddyBot - this.paddyY));
            if (!this.reflCanvas || this.reflCanvas.width !== reflW || this.reflCanvas.height !== reflH) {
                this.reflCanvas = document.createElement('canvas');
                this.reflCanvas.width = reflW;
                this.reflCanvas.height = reflH;
                this.reflCtx = this.reflCanvas.getContext('2d');
            }
        }

        // -----------------------------------------------------------
        // Sky / lighting math
        // -----------------------------------------------------------

        currentSky(t) {
            const cycle = (t / CONFIG.DAY_CYCLE_MS + CONFIG.CYCLE_START) % 1;
            const { a, b, k } = pickStop(SKY_STOPS, cycle);
            return {
                cycle,
                top: this.mixColor(a.top, b.top, k),
                horizon: this.mixColor(a.horizon, b.horizon, k),
                sun: this.mixColor(a.sun, b.sun, k),
                sunI: a.sunI + (b.sunI - a.sunI) * k,
            };
        }

        nightness(cycle) {
            if (cycle < 0.20) return 1;
            if (cycle < 0.30) return 1 - this.smoothstep(0.20, 0.30, cycle);
            if (cycle < 0.70) return 0;
            if (cycle < 0.86) return this.smoothstep(0.70, 0.86, cycle);
            return 1;
        }

        // -----------------------------------------------------------
        // Main render
        // -----------------------------------------------------------

        render(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const sky = this.currentSky(t);
            const night = this.nightness(sky.cycle);
            this.night = night;
            this.sky = sky;

            // Wind (shared by clouds, sakura, petals, laundry, paddy, wires).
            this.wind = 0.4 + 0.3 * Math.sin(t * 0.0003);
            this.windGust = Math.max(0, Math.sin(t * 0.00021) - 0.55) * 5;

            // Sun arc — half-day arc above horizon, half below.
            // cycle 0.25 = east horizon (sunrise); 0.50 = zenith (noon); 0.75 = west horizon (sunset).
            const theta = (sky.cycle - 0.25) * 2 * Math.PI;
            this.sunArcK = theta;
            this.sunX = w * (0.5 - 0.42 * Math.cos(theta));
            this.sunY = this.horizonY - Math.sin(theta) * this.horizonY * 0.82;
            this.sunVisible = this.sunY < this.horizonY + 20 && sky.sunI > 0.05;

            // Moon — opposite arc (phase-shifted half a cycle).
            const mTheta = (((sky.cycle + 0.5) % 1) - 0.25) * 2 * Math.PI;
            this.moonX = w * (0.5 - 0.42 * Math.cos(mTheta));
            this.moonY = this.horizonY - Math.sin(mTheta) * this.horizonY * 0.82;
            this.moonVisible = this.moonY < this.horizonY + 5 && night > 0.4;

            // ---- Draw sequence ----
            this.drawSky(t, dt);
            this.drawSunAndMoon(t);
            this.drawSunRays(t);
            this.drawClouds(t, dt);
            this.drawFarMountains(t);
            this.drawDistantTorii(t);
            this.drawFuji(t);
            this.drawMidMountains(t);
            this.drawShinkansenLayer(t, dt);
            this.drawBackgroundHouses(t);
            this.drawPolesBehind(t);
            this.drawForegroundHouses(t, dt);
            this.drawPersimmonTree(t);
            this.drawPolesFront(t);
            this.drawBirds(t, dt);
            this.drawCrows(t, dt);
            this.drawRoad(t);
            this.drawRoadFurniture(t);
            this.drawJizoStatue(t);
            this.drawKeiTruck(t, dt);
            this.drawCyclist(t, dt);
            this.drawDeliveryMoped(t, dt);
            this.drawSchoolChild(t, dt);
            this.drawCat(t, dt);
            this.drawPaddyMist(t);
            this.drawPaddyAndReflection(t);
            this.drawEgret(t, dt);
            this.drawBike(w * 0.84, h * 0.96);
            this.drawSakuraTree(this.sakuraBG.x * w, this.fgRowY + 2, t, this.sakuraBG.scale, true);
            this.drawSakuraTree(this.sakuraFG.x * w, this.fgRowY + 8, t, this.sakuraFG.scale, false);
            this.drawPetals(t, dt);
            this.drawFireflies(t, dt);
            this.drawAtmosphere(t);
            this.drawNightVeil();
        }

        // -----------------------------------------------------------
        // Sky background
        // -----------------------------------------------------------

        drawSky(t) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const sky = this.sky, night = this.night;

            const skyGrad = c.createLinearGradient(0, 0, 0, this.roadY);
            skyGrad.addColorStop(0, sky.top);
            skyGrad.addColorStop(0.60, sky.horizon);
            skyGrad.addColorStop(1, sky.horizon);
            c.fillStyle = skyGrad;
            c.fillRect(0, 0, w, this.roadY);

            // Milky way band — deep night only.
            if (night > 0.5) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                // Diagonal band across the sky.
                const mwGrad = c.createLinearGradient(0, this.horizonY * 0.10, w * 0.7, this.horizonY * 0.50);
                mwGrad.addColorStop(0, 'rgba(180, 195, 220, 0)');
                mwGrad.addColorStop(0.45, `rgba(190, 200, 230, ${0.10 * night})`);
                mwGrad.addColorStop(0.55, `rgba(220, 200, 230, ${0.09 * night})`);
                mwGrad.addColorStop(1, 'rgba(180, 195, 220, 0)');
                c.fillStyle = mwGrad;
                c.save();
                c.translate(w * 0.5, this.horizonY * 0.30);
                c.rotate(-0.35);
                c.fillRect(-w * 0.9, -32, w * 1.8, 64);
                c.restore();
                // Dust lanes (slight dimming).
                c.globalCompositeOperation = 'multiply';
                c.fillStyle = `rgba(40, 40, 60, ${0.30 * night})`;
                c.save();
                c.translate(w * 0.5, this.horizonY * 0.30);
                c.rotate(-0.35);
                c.fillRect(-w * 0.7, -6, w * 1.4, 4);
                c.restore();
                c.restore();
            }

            // Stars
            if (night > 0.15) {
                const baseA = 0.62 * night;
                for (let i = 0; i < this.stars.length; i++) {
                    const s = this.stars[i];
                    const tw = 0.7 + 0.3 * Math.sin(t * 0.001 + s.phase);
                    const a = baseA * s.mag * tw;
                    if (a <= 0.01) continue;
                    // Subtle star color (white, blue-white, yellow-white).
                    const colorTone = s.tone || 0;
                    let r0 = 240, g0 = 240, b0 = 255;
                    if (colorTone < 0.33) { r0 = 220; g0 = 230; b0 = 255; }
                    else if (colorTone < 0.66) { r0 = 250; g0 = 248; b0 = 230; }
                    c.fillStyle = `rgba(${r0}, ${g0}, ${b0}, ${a})`;
                    const x = s.x * w;
                    const y = s.y * this.horizonY;
                    const sz = s.bright ? 1.6 : 1.2;
                    c.fillRect(x, y, sz, sz);
                    if (s.bright && tw > 0.88) {
                        c.fillStyle = `rgba(${r0}, ${g0}, ${b0}, ${a * 0.7})`;
                        c.fillRect(x - 2.5, y + 0.5, 6, 0.5);
                        c.fillRect(x + 0.5, y - 2.5, 0.5, 6);
                    }
                }
                // Occasional shooting star (drawn briefly).
                if (!this._shootingStar && Math.random() < 0.0008) {
                    this._shootingStar = {
                        x: Math.random() * w,
                        y: Math.random() * this.horizonY * 0.6,
                        dx: 80 + Math.random() * 60,
                        dy: 20 + Math.random() * 20,
                        life: 700,
                    };
                }
                if (this._shootingStar) {
                    const sh = this._shootingStar;
                    sh.life -= 16.7;
                    if (sh.life <= 0) {
                        this._shootingStar = null;
                    } else {
                        const k = 1 - sh.life / 700;
                        const ex = sh.x + sh.dx * k;
                        const ey = sh.y + sh.dy * k;
                        c.strokeStyle = `rgba(255, 240, 220, ${0.95 * (1 - k) * night})`;
                        c.lineWidth = 1.4;
                        c.beginPath();
                        c.moveTo(ex - sh.dx * 0.14, ey - sh.dy * 0.14);
                        c.lineTo(ex, ey);
                        c.stroke();
                        c.strokeStyle = `rgba(255, 240, 220, ${0.4 * (1 - k) * night})`;
                        c.lineWidth = 3;
                        c.beginPath();
                        c.moveTo(ex - sh.dx * 0.12, ey - sh.dy * 0.12);
                        c.lineTo(ex, ey);
                        c.stroke();
                    }
                }
            }

            // Atmospheric haze band near the horizon — warmer at dawn/dusk.
            const warmth = sky.sunI > 0.4 && (sky.cycle < 0.35 || sky.cycle > 0.66) ? 0.20 : 0;
            const haze = c.createLinearGradient(0, this.horizonY - 30, 0, this.roadY);
            haze.addColorStop(0, `rgba(255, 180, 110, 0)`);
            haze.addColorStop(0.4, `rgba(255, 180, 110, ${0.18 * (1 - night)})`);
            haze.addColorStop(1, `rgba(220, 130, 80, ${0.10 * (1 - night) + warmth * 0.04})`);
            c.fillStyle = haze;
            c.fillRect(0, this.horizonY - 30, w, this.roadY - this.horizonY + 30);
        }

        drawSunAndMoon(t) {
            const c = this.ctx;
            const sky = this.sky;

            if (this.sunVisible) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                // Sun is hazier at horizon, tighter when high.
                const elevation = this.clamp(1 - this.sunY / this.horizonY, 0, 1);
                const flareR = 110 + (1 - elevation) * 140;
                const sunOuter = c.createRadialGradient(this.sunX, this.sunY, 4, this.sunX, this.sunY, flareR);
                sunOuter.addColorStop(0, `rgba(255, 220, 160, ${0.48 * sky.sunI})`);
                sunOuter.addColorStop(0.4, `rgba(255, 170, 110, ${0.18 * sky.sunI})`);
                sunOuter.addColorStop(1, 'rgba(255, 150, 100, 0)');
                c.fillStyle = sunOuter;
                c.fillRect(this.sunX - flareR, this.sunY - flareR, flareR * 2, flareR * 2);
                // Horizontal lens flare line near horizon.
                const nearHoriz = this.clamp(1 - Math.abs(this.sunY - this.horizonY) / 90, 0, 1);
                if (nearHoriz > 0) {
                    c.fillStyle = `rgba(255, 200, 150, ${0.18 * nearHoriz * sky.sunI})`;
                    c.fillRect(this.sunX - flareR, this.sunY - 1, flareR * 2, 2);
                }
                c.restore();
                c.fillStyle = sky.sun;
                c.beginPath();
                c.arc(this.sunX, this.sunY, 22 + 4 * (1 - sky.sunI), 0, Math.PI * 2);
                c.fill();
            }
            if (this.moonVisible) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                const halo = c.createRadialGradient(this.moonX, this.moonY, 4, this.moonX, this.moonY, 110);
                halo.addColorStop(0, `rgba(220, 230, 255, ${0.5 * this.night})`);
                halo.addColorStop(1, 'rgba(220, 230, 255, 0)');
                c.fillStyle = halo;
                c.fillRect(this.moonX - 110, this.moonY - 110, 220, 220);
                c.restore();
                // Moon body + maria.
                const moonGrad = c.createRadialGradient(this.moonX - 6, this.moonY - 6, 3, this.moonX, this.moonY, 20);
                moonGrad.addColorStop(0, '#fbfdff');
                moonGrad.addColorStop(1, '#b6c2d8');
                c.fillStyle = moonGrad;
                c.beginPath();
                c.arc(this.moonX, this.moonY, 19, 0, Math.PI * 2);
                c.fill();
                // Mare patches.
                c.fillStyle = 'rgba(150, 165, 195, 0.30)';
                c.beginPath(); c.arc(this.moonX - 4, this.moonY - 3, 5, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(this.moonX + 5, this.moonY + 2, 3.5, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(this.moonX + 1, this.moonY + 7, 2.5, 0, Math.PI * 2); c.fill();
            }
        }

        // -----------------------------------------------------------
        // Clouds
        // -----------------------------------------------------------

        drawClouds(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const cloudOpacity = this.clamp(1 - this.night * 1.5, 0, 1);
            if (cloudOpacity < 0.05) {
                // Wispy night cirrus only.
                this.drawNoctilucent(t);
                return;
            }
            const lightWarm = this.sky.sunI > 0.4 && (this.sky.cycle < 0.35 || this.sky.cycle > 0.66);
            for (let i = 0; i < this.clouds.length; i++) {
                const cl = this.clouds[i];
                cl.x += (cl.speed + this.wind * 0.001) * (dt / 1000);
                if (cl.x * w > w + cl.width + 50) cl.x = -(cl.width + 50) / w;
                const bx = cl.x * w;
                const by = cl.y * h;
                const scale = 0.5 + cl.depth * 0.7;
                // Underside shadow puff
                c.save();
                c.globalAlpha = cloudOpacity * (0.30 + cl.depth * 0.10);
                c.fillStyle = lightWarm ? '#7d5e6c' : '#5a647a';
                for (const p of cl.puffs) {
                    c.beginPath();
                    c.arc(bx + p.dx * scale, by + p.dy * scale + 3, p.r * scale, 0, Math.PI * 2);
                    c.fill();
                }
                c.restore();
                // Body puff
                c.save();
                c.globalAlpha = cloudOpacity * (0.55 + cl.depth * 0.30);
                c.fillStyle = lightWarm ? '#f4d0b6' : '#dbe0e8';
                for (const p of cl.puffs) {
                    c.beginPath();
                    c.arc(bx + p.dx * scale, by + p.dy * scale, p.r * scale, 0, Math.PI * 2);
                    c.fill();
                }
                c.restore();
                // Sun-lit top edge — small bright arc on the side facing sun.
                if (this.sunVisible) {
                    const dirX = Math.sign(this.sunX - bx);
                    c.save();
                    c.globalAlpha = cloudOpacity * 0.30 * this.sky.sunI;
                    c.fillStyle = '#fff5dc';
                    for (const p of cl.puffs) {
                        c.beginPath();
                        c.arc(bx + p.dx * scale + dirX * 2, by + p.dy * scale - 3, p.r * scale * 0.75, 0, Math.PI * 2);
                        c.fill();
                    }
                    c.restore();
                }
            }
        }

        drawNoctilucent(t) {
            const c = this.ctx;
            const w = this.width;
            c.save();
            c.strokeStyle = `rgba(180, 195, 220, ${0.10 * this.night})`;
            c.lineWidth = 1;
            for (let i = 0; i < 3; i++) {
                const yy = this.horizonY * (0.30 + i * 0.10) + Math.sin(t * 0.0002 + i) * 4;
                c.beginPath();
                c.moveTo(0, yy);
                for (let x = 0; x <= w; x += 40) {
                    c.lineTo(x, yy + Math.sin(x * 0.01 + i + t * 0.0003) * 2);
                }
                c.stroke();
            }
            c.restore();
        }

        // -----------------------------------------------------------
        // Mountains & Fuji
        // -----------------------------------------------------------

        drawFarMountains(t) {
            const c = this.ctx;
            const w = this.width;
            // Tint follows sky horizon — warms at sunset, cools at noon.
            const base = this.mixColor(this.sky.horizon, '#3a2a4a', 0.55);
            c.fillStyle = base;
            c.globalAlpha = 0.85;
            c.beginPath();
            c.moveTo(0, this.horizonY + 8);
            const pts = [
                { x: 0.00, y: this.horizonY + 8 },
                { x: 0.12, y: this.horizonY - 22 },
                { x: 0.26, y: this.horizonY - 10 },
                { x: 0.42, y: this.horizonY - 34 },
                { x: 0.55, y: this.horizonY - 16 },
                { x: 0.72, y: this.horizonY - 30 },
                { x: 0.88, y: this.horizonY - 14 },
                { x: 1.00, y: this.horizonY + 8 },
            ];
            this.smoothCurve(pts, w);
            c.lineTo(w, this.horizonY + 8);
            c.closePath();
            c.fill();
            c.globalAlpha = 1;

            // Atmospheric perspective wash.
            c.fillStyle = this.mixColor(this.sky.horizon, '#000', 0.05);
            c.globalAlpha = 0.18;
            c.fillRect(0, this.horizonY - 36, w, 40);
            c.globalAlpha = 1;
        }

        drawFuji(t) {
            const c = this.ctx;
            const w = this.width;
            const sky = this.sky;
            const fujiCx = w * 0.68;
            const fujiBase = this.horizonY + 24;
            const fujiTop = this.horizonY - 178;
            const baseHalf = 188;
            const peakHalf = 22;
            const totalH = fujiBase - fujiTop;
            const isWarmSky = sky.cycle < 0.35 || sky.cycle > 0.66;

            // Direction of light: positive => sun to right of peak.
            const lightDir = this.sunVisible ? Math.sign(this.sunX - fujiCx) : (this.moonVisible ? Math.sign(this.moonX - fujiCx) : -1);
            const lightStrength = this.sunVisible ? sky.sunI : (this.moonVisible ? 0.22 : 0.05);

            // Helper: trace Fuji's famous concave bell silhouette using cubics.
            const traceFuji = () => {
                c.moveTo(fujiCx - baseHalf, fujiBase);
                // Left flank: concave bell curve.
                c.bezierCurveTo(
                    fujiCx - baseHalf * 0.78, fujiBase - totalH * 0.12,
                    fujiCx - peakHalf * 2.3, fujiTop + totalH * 0.32,
                    fujiCx - peakHalf, fujiTop + 6
                );
                // Crater rim (slight dip in center).
                c.quadraticCurveTo(fujiCx, fujiTop + 11, fujiCx + peakHalf, fujiTop + 6);
                // Right flank.
                c.bezierCurveTo(
                    fujiCx + peakHalf * 2.3, fujiTop + totalH * 0.32,
                    fujiCx + baseHalf * 0.78, fujiBase - totalH * 0.12,
                    fujiCx + baseHalf, fujiBase
                );
                c.closePath();
            };

            // Base body — deeper purple-blue, blended toward horizon for atmosphere.
            const bodyCol = this.mixColor('#3a2858', this.sky.horizon, 0.38);
            c.fillStyle = bodyCol;
            c.beginPath();
            traceFuji();
            c.fill();

            // Clipped lighting passes.
            c.save();
            c.beginPath();
            traceFuji();
            c.clip();

            // Warm lit side gradient.
            const litX0 = lightDir >= 0 ? fujiCx - peakHalf * 0.5 : fujiCx - baseHalf;
            const litX1 = lightDir >= 0 ? fujiCx + baseHalf : fujiCx + peakHalf * 0.5;
            const warmA = this.clamp(0.42 * lightStrength, 0, 0.5);
            const warm = c.createLinearGradient(litX0, fujiTop, litX1, fujiBase);
            const warmCol = isWarmSky
                ? `rgba(230, 140, 120, ${warmA})`
                : `rgba(210, 196, 200, ${warmA * 0.6})`;
            warm.addColorStop(0, warmCol);
            warm.addColorStop(0.65, `rgba(200, 110, 100, ${warmA * 0.35})`);
            warm.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = warm;
            c.fillRect(fujiCx - baseHalf - 4, fujiTop - 10, baseHalf * 2 + 8, totalH + 20);

            // Cool shadow side gradient.
            const shadowA = 0.34 + (1 - lightStrength) * 0.14;
            const shadeGrad = c.createLinearGradient(litX1, fujiTop, litX0, fujiBase);
            shadeGrad.addColorStop(0, `rgba(28, 22, 50, ${shadowA})`);
            shadeGrad.addColorStop(0.6, `rgba(28, 22, 50, ${shadowA * 0.5})`);
            shadeGrad.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = shadeGrad;
            c.fillRect(fujiCx - baseHalf - 4, fujiTop - 10, baseHalf * 2 + 8, totalH + 20);

            // Faint station ridges crossing the silhouette (hint of 5-8 station lines).
            c.strokeStyle = `rgba(15, 10, 25, ${0.18 + (1 - lightStrength) * 0.10})`;
            c.lineWidth = 0.8;
            for (let k = 1; k <= 4; k++) {
                const ry = fujiTop + totalH * (0.30 + k * 0.13);
                const span = baseHalf * (0.18 + k * 0.18);
                c.beginPath();
                c.moveTo(fujiCx - span, ry + 1);
                c.quadraticCurveTo(fujiCx, ry - 1, fujiCx + span, ry + 1);
                c.stroke();
            }

            // Subtle erosion gullies running down the slopes.
            c.strokeStyle = 'rgba(10, 6, 20, 0.16)';
            c.lineWidth = 0.6;
            for (let k = 0; k < 7; k++) {
                const ox = (k - 3) * baseHalf * 0.22 + (k % 2 ? 4 : -2);
                const dir = ox >= 0 ? 1 : -1;
                c.beginPath();
                c.moveTo(fujiCx + ox * 0.4, fujiTop + totalH * 0.32);
                c.quadraticCurveTo(
                    fujiCx + ox * 0.75, fujiTop + totalH * 0.62,
                    fujiCx + ox + dir * 6, fujiBase - 4
                );
                c.stroke();
            }
            c.restore();

            // Snow cap — natural drip pattern. Lit side has shorter fingers,
            // shadow side gets longer, more pronounced ones.
            const snowR = this.rng(1234);
            const snowTop = fujiTop + 4;
            const snowMaxY = fujiTop + totalH * 0.42;
            // Number of finger tips across the cap.
            const N = 11;
            const fingers = [];
            for (let k = 0; k <= N; k++) {
                const kk = k / N;
                const xOff = (kk - 0.5) * 2;            // -1..1
                const side = Math.sign(xOff) || 0;
                const litBias = side === lightDir ? 0.55 : 1.35;
                const baseY = snowTop + Math.abs(xOff) * (snowMaxY - snowTop) * 1.0;
                // Noisy finger depth.
                const depth = (12 + snowR() * 28) * litBias * (1 - Math.pow(Math.abs(xOff), 1.8) * 0.4);
                fingers.push({
                    x: fujiCx + xOff * (peakHalf + (baseHalf - peakHalf) * 0.42),
                    y: baseY + depth,
                });
            }
            c.fillStyle = 'rgba(252, 250, 254, 0.98)';
            c.beginPath();
            // Trace top of snow cap (matches Fuji rim).
            c.moveTo(fujiCx - peakHalf - 2, snowTop + 2);
            c.quadraticCurveTo(fujiCx, snowTop + 9, fujiCx + peakHalf + 2, snowTop + 2);
            // Trace right flank down the snow line.
            for (let k = N; k >= Math.floor(N / 2) + 1; k--) {
                c.lineTo(fingers[k].x, fingers[k].y);
                // Add a notch between fingers.
                const prev = fingers[k - 1];
                const midX = (fingers[k].x + prev.x) * 0.5;
                const midY = Math.min(fingers[k].y, prev.y) - 4 - snowR() * 5;
                c.lineTo(midX, midY);
            }
            // Bottom center inverted V.
            c.lineTo(fujiCx, snowTop + (snowMaxY - snowTop) * 0.7);
            for (let k = Math.floor(N / 2) - 1; k >= 0; k--) {
                const next = fingers[k + 1];
                const midX = (fingers[k].x + next.x) * 0.5;
                const midY = Math.min(fingers[k].y, next.y) - 4 - snowR() * 5;
                c.lineTo(midX, midY);
                c.lineTo(fingers[k].x, fingers[k].y);
            }
            c.closePath();
            c.fill();

            // Snow shadow on the un-lit half (cool blue cast).
            c.save();
            c.beginPath();
            if (lightDir >= 0) {
                c.moveTo(fujiCx, snowTop + 8);
                c.lineTo(fujiCx - peakHalf, snowTop + 4);
                for (let k = Math.floor(N / 2); k >= 0; k--) {
                    c.lineTo(fingers[k].x, fingers[k].y);
                }
                c.lineTo(fujiCx, snowTop + (snowMaxY - snowTop) * 0.7);
            } else {
                c.moveTo(fujiCx, snowTop + 8);
                c.lineTo(fujiCx + peakHalf, snowTop + 4);
                for (let k = Math.floor(N / 2); k <= N; k++) {
                    c.lineTo(fingers[k].x, fingers[k].y);
                }
                c.lineTo(fujiCx, snowTop + (snowMaxY - snowTop) * 0.7);
            }
            c.closePath();
            c.fillStyle = isWarmSky
                ? 'rgba(196, 168, 200, 0.40)'
                : 'rgba(168, 178, 210, 0.42)';
            c.fill();
            c.restore();

            // Snow rim highlight on the lit side.
            const rimCol = isWarmSky
                ? `rgba(255, 218, 178, ${0.55 * lightStrength})`
                : `rgba(232, 232, 248, ${0.34 * lightStrength})`;
            c.strokeStyle = rimCol;
            c.lineWidth = 1.5;
            c.beginPath();
            if (lightDir >= 0) {
                c.moveTo(fujiCx + baseHalf, fujiBase);
                c.bezierCurveTo(
                    fujiCx + baseHalf * 0.78, fujiBase - totalH * 0.12,
                    fujiCx + peakHalf * 2.3, fujiTop + totalH * 0.32,
                    fujiCx + peakHalf, fujiTop + 6
                );
            } else {
                c.moveTo(fujiCx - baseHalf, fujiBase);
                c.bezierCurveTo(
                    fujiCx - baseHalf * 0.78, fujiBase - totalH * 0.12,
                    fujiCx - peakHalf * 2.3, fujiTop + totalH * 0.32,
                    fujiCx - peakHalf, fujiTop + 6
                );
            }
            c.stroke();

            // Lenticular cap cloud (kasagumo) — present at certain hours.
            const lentT = (sky.cycle + 0.13) % 1;
            const lentVisible = (lentT > 0.30 && lentT < 0.55) || (lentT > 0.70 && lentT < 0.80);
            if (lentVisible && this.night < 0.5) {
                c.save();
                const cy = fujiTop - 8 + Math.sin(t * 0.0002) * 2;
                const cw = 90;
                const lentA = this.clamp((1 - this.night) * 0.70, 0, 0.85);
                c.globalAlpha = lentA;
                // Underside warmer in golden hour.
                const lentGrad = c.createLinearGradient(fujiCx, cy - 6, fujiCx, cy + 6);
                lentGrad.addColorStop(0, isWarmSky ? '#fff0d8' : '#eef2f8');
                lentGrad.addColorStop(0.6, isWarmSky ? '#f2c8a8' : '#c8d2e0');
                lentGrad.addColorStop(1, isWarmSky ? '#a37868' : '#7d8aa0');
                c.fillStyle = lentGrad;
                c.beginPath();
                c.ellipse(fujiCx + 2, cy, cw * 0.55, 6.5, 0, 0, Math.PI * 2);
                c.fill();
                // Second smaller stack disc.
                c.globalAlpha = lentA * 0.7;
                c.beginPath();
                c.ellipse(fujiCx - 4, cy - 8, cw * 0.36, 3.5, 0, 0, Math.PI * 2);
                c.fill();
                c.restore();
            }
        }

        drawMidMountains(t) {
            const c = this.ctx;
            const w = this.width;
            // Mid-mountain layer with forest tree-line silhouette.
            const baseCol = this.mixColor('#3e2c40', this.sky.horizon, 0.18);
            c.fillStyle = baseCol;
            c.beginPath();
            c.moveTo(0, this.horizonY + 18);
            const pts = [
                { x: 0.00, y: this.horizonY + 18 },
                { x: 0.18, y: this.horizonY - 2 },
                { x: 0.32, y: this.horizonY + 14 },
                { x: 0.50, y: this.horizonY - 6 },
                { x: 0.68, y: this.horizonY + 10 },
                { x: 0.85, y: this.horizonY - 4 },
                { x: 1.00, y: this.horizonY + 18 },
            ];
            this.smoothCurve(pts, w);
            c.lineTo(w, this.horizonY + 18);
            c.closePath();
            c.fill();

            // Procedural conifer tree-line on top of mid-mountain layer.
            c.fillStyle = this.mixColor(baseCol, '#000', 0.30);
            const treeRand = this.rng(5151);
            for (let i = 0; i < 80; i++) {
                const k = i / 80;
                const sx = k * w;
                // Sample mid-mountain Y by linear interp between pts.
                const py = this.sampleSmoothY(pts, k);
                const th = 4 + treeRand() * 8;
                c.beginPath();
                c.moveTo(sx - 2.4, py + 2);
                c.lineTo(sx, py - th);
                c.lineTo(sx + 2.4, py + 2);
                c.closePath();
                c.fill();
            }
        }

        sampleSmoothY(pts, k) {
            // Approximate sample at fractional k by linear-interp between pts.
            for (let i = 0; i < pts.length - 1; i++) {
                if (k >= pts[i].x && k <= pts[i + 1].x) {
                    const span = pts[i + 1].x - pts[i].x;
                    const tt = span > 0 ? (k - pts[i].x) / span : 0;
                    return pts[i].y + (pts[i + 1].y - pts[i].y) * this.smoothstep(0, 1, tt);
                }
            }
            return pts[pts.length - 1].y;
        }

        smoothCurve(pts, w) {
            const c = this.ctx;
            for (let i = 1; i < pts.length; i++) {
                const p0 = pts[i - 1];
                const p1 = pts[i];
                const mx = (p0.x + p1.x) / 2 * w;
                const my = (p0.y + p1.y) / 2;
                c.quadraticCurveTo(p0.x * w, p0.y, mx, my);
            }
            const last = pts[pts.length - 1];
            c.lineTo(last.x * w, last.y);
        }

        // -----------------------------------------------------------
        // Shinkansen (elevated viaduct)
        // -----------------------------------------------------------

        drawShinkansenLayer(t, dt) {
            // Viaduct piers + sound barriers — dimmer when train not visible.
            this.updateShinkansen(dt);
            const c = this.ctx;
            const w = this.width;
            const y = this.viaductY;
            const active = !!this.shinkansen;
            const baseA = active ? 1.0 : 0.35;
            // Elevated viaduct deck shadow.
            c.fillStyle = `rgba(60, 56, 64, ${0.20 * baseA})`;
            c.fillRect(0, y - 2, w, 3);
            // Piers (concrete columns) — only render when train active.
            if (active) {
                c.fillStyle = 'rgba(90, 82, 88, 0.55)';
                for (let i = 0; i < 9; i++) {
                    const px = (i / 8) * w;
                    c.fillRect(px - 3, y + 4, 6, this.bgRowY - y - 4);
                    c.fillStyle = 'rgba(70, 64, 72, 0.55)';
                    c.fillRect(px - 5, y + 2, 10, 2);
                    c.fillStyle = 'rgba(90, 82, 88, 0.55)';
                }
            }
            // Sound barrier (faint by default, opaque when train visible).
            c.fillStyle = `rgba(178, 172, 168, ${0.40 * baseA})`;
            c.fillRect(0, y - 3, w, 3);
            // Catenary infrastructure — only when train active.
            if (active) {
                c.strokeStyle = 'rgba(60, 56, 60, 0.55)';
                c.lineWidth = 1;
                for (let i = 0; i < 7; i++) {
                    const px = (i / 6) * w + w * 0.04;
                    c.beginPath();
                    c.moveTo(px, y - 4);
                    c.lineTo(px, y - 20);
                    c.stroke();
                    c.beginPath();
                    c.moveTo(px - 8, y - 17);
                    c.lineTo(px + 8, y - 17);
                    c.stroke();
                }
                c.strokeStyle = 'rgba(40, 36, 40, 0.50)';
                c.lineWidth = 0.5;
                c.beginPath();
                c.moveTo(0, y - 18); c.lineTo(w, y - 18);
                c.moveTo(0, y - 15); c.lineTo(w, y - 15);
                c.stroke();
            }

            if (this.shinkansen) this.drawShinkansen(this.shinkansen, y);
        }

        updateShinkansen(dt) {
            if (!this.shinkansen) {
                this.nextShinkansenMs -= dt;
                if (this.nextShinkansenMs <= 0) {
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    const series = Math.random();
                    this.shinkansen = {
                        x: dir > 0 ? -560 : this.width + 560,
                        dir,
                        speed: 360 + Math.random() * 200,
                        cars: 6 + Math.floor(Math.random() * 3),
                        // 0: N700 white/blue (Tokaido); 1: E5 green/white (Tohoku); 2: E6 red/white (Akita).
                        series: series < 0.55 ? 0 : (series < 0.85 ? 1 : 2),
                    };
                    this.nextShinkansenMs = CONFIG.SHINKANSEN_INTERVAL_MIN + Math.random() * (CONFIG.SHINKANSEN_INTERVAL_MAX - CONFIG.SHINKANSEN_INTERVAL_MIN);
                }
                return;
            }
            this.shinkansen.x += this.shinkansen.dir * this.shinkansen.speed * this.as * (dt / 1000);
            const limit = (this.shinkansen.cars * 64 + 180) * this.as;
            if (this.shinkansen.x < -limit || this.shinkansen.x > this.width + limit) {
                this.shinkansen = null;
            }
        }

        drawShinkansen(s, baseY) {
            const c = this.ctx;
            const carW = 58, carH = 12;
            const nLen = 46;  // long pointy nose typical of N700/E5
            c.save();
            c.translate(s.x, baseY - carH * 0.5 * this.as);
            c.scale(s.dir * this.as, this.as);

            // Color palette by series.
            const palette = s.series === 1
                ? { body: '#f6faf2', stripe: '#1f6b3a', window: '#0e1418', windowFrame: '#244432' }
                : s.series === 2
                ? { body: '#f6f4ef', stripe: '#a82c2c', window: '#0e1418', windowFrame: '#4a1818' }
                : { body: '#f4f6f8', stripe: '#234c9a', window: '#0a1424', windowFrame: '#1a2a4a' };

            // --- Train body — multi-car ---
            for (let i = 0; i < s.cars; i++) {
                const cx = -nLen - 6 - i * (carW + 1);
                // Body
                c.fillStyle = palette.body;
                c.fillRect(cx, 0, carW, carH);
                // Lower side fairing skirt.
                c.fillStyle = this.mixColor(palette.body, '#000', 0.18);
                c.fillRect(cx, carH * 0.86, carW, carH * 0.14);
                // Color stripe along middle.
                c.fillStyle = palette.stripe;
                c.fillRect(cx, carH * 0.60, carW, carH * 0.18);
                // Window strip (dark glass).
                c.fillStyle = palette.window;
                c.fillRect(cx + 3, 2, carW - 6, carH * 0.42);
                // Individual passenger windows.
                c.fillStyle = palette.windowFrame;
                for (let k = 0; k < 7; k++) {
                    const wx = cx + 5 + k * ((carW - 10) / 7);
                    c.fillRect(wx, 2.5, (carW - 12) / 7 - 0.5, carH * 0.34);
                }
                // Coupler gap shadow.
                c.fillStyle = 'rgba(15, 18, 28, 0.5)';
                c.fillRect(cx + carW, carH * 0.30, 1, carH * 0.4);
                // Pantograph on middle cars.
                if (i === 1 || i === s.cars - 2) {
                    const px = cx + carW * 0.5;
                    c.strokeStyle = '#3a3a3a';
                    c.lineWidth = 0.7;
                    c.beginPath();
                    c.moveTo(px - 8, 0); c.lineTo(px - 4, -7);
                    c.lineTo(px + 4, -7); c.lineTo(px + 8, 0);
                    c.stroke();
                    c.beginPath();
                    c.moveTo(px - 10, -7); c.lineTo(px + 10, -7);
                    c.stroke();
                }
                // Pin-stripe contrasting line above color stripe.
                c.fillStyle = this.mixColor(palette.stripe, '#000', 0.4);
                c.fillRect(cx, carH * 0.58, carW, 0.6);
            }

            // --- Bullet nose (long curved snout, N700/E5 style) ---
            c.fillStyle = palette.body;
            c.beginPath();
            c.moveTo(0, carH * 0.20);
            // Top curve down to tip.
            c.bezierCurveTo(nLen * 0.55, carH * 0.10, nLen * 0.90, carH * 0.36, nLen, carH * 0.48);
            // Tip rounded slightly under.
            c.bezierCurveTo(nLen * 0.95, carH * 0.55, nLen * 0.85, carH * 0.60, nLen * 0.78, carH * 0.62);
            // Bottom curve back to body.
            c.bezierCurveTo(nLen * 0.55, carH * 0.88, nLen * 0.20, carH * 0.98, 0, carH);
            c.lineTo(-6, carH);
            c.lineTo(-6, carH * 0.20);
            c.closePath();
            c.fill();

            // Nose stripe blending into body stripe.
            c.fillStyle = palette.stripe;
            c.beginPath();
            c.moveTo(-6, carH * 0.60);
            c.lineTo(nLen * 0.30, carH * 0.62);
            c.bezierCurveTo(nLen * 0.55, carH * 0.68, nLen * 0.70, carH * 0.66, nLen * 0.78, carH * 0.62);
            c.bezierCurveTo(nLen * 0.55, carH * 0.85, nLen * 0.30, carH * 0.92, -6, carH * 0.80);
            c.closePath();
            c.fill();

            // Cockpit window — single curved windshield.
            c.fillStyle = palette.window;
            c.beginPath();
            c.moveTo(2, carH * 0.30);
            c.quadraticCurveTo(nLen * 0.50, carH * 0.22, nLen * 0.78, carH * 0.46);
            c.quadraticCurveTo(nLen * 0.50, carH * 0.50, 2, carH * 0.50);
            c.closePath();
            c.fill();
            // Window highlight reflection.
            c.fillStyle = 'rgba(255, 255, 255, 0.35)';
            c.beginPath();
            c.moveTo(nLen * 0.25, carH * 0.28);
            c.quadraticCurveTo(nLen * 0.45, carH * 0.26, nLen * 0.55, carH * 0.32);
            c.quadraticCurveTo(nLen * 0.42, carH * 0.34, nLen * 0.25, carH * 0.32);
            c.closePath();
            c.fill();

            // Headlight cluster.
            const headA = 0.7 + (this.night || 0) * 0.3;
            c.fillStyle = `rgba(255, 250, 210, ${headA})`;
            c.beginPath();
            c.arc(nLen * 0.84, carH * 0.52, 1.6, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(nLen * 0.80, carH * 0.58, 1.3, 0, Math.PI * 2);
            c.fill();
            // Headlight glow.
            c.save();
            c.globalCompositeOperation = 'lighter';
            const hg = c.createRadialGradient(nLen * 0.82, carH * 0.55, 1, nLen * 0.82, carH * 0.55, 18);
            hg.addColorStop(0, `rgba(255, 245, 190, ${0.6 * headA})`);
            hg.addColorStop(1, 'rgba(255, 245, 190, 0)');
            c.fillStyle = hg;
            c.fillRect(nLen * 0.65, carH * 0.30, 26, 26);
            c.restore();

            // Motion blur streaks behind the train.
            c.strokeStyle = `rgba(255, 255, 255, ${0.20})`;
            c.lineWidth = 0.8;
            const tailX = -nLen - 6 - s.cars * (carW + 1) - 10;
            for (let k = 0; k < 6; k++) {
                c.beginPath();
                c.moveTo(tailX - k * 28, carH * 0.25 + k * 1.2);
                c.lineTo(tailX - k * 28 - 50, carH * 0.25 + k * 1.2);
                c.stroke();
            }
            c.restore();
        }

        // -----------------------------------------------------------
        // Background house row (hazy, smaller, hill-like)
        // -----------------------------------------------------------

        drawBackgroundHouses(t) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const baseY = this.bgRowY;
            for (let i = 0; i < this.bgHouses.length; i++) {
                const hs = this.bgHouses[i];
                const hx = hs.x * w;
                const hw = hs.w * w;
                const hh = hs.h * h;
                const bodyY = baseY - hh;
                // Atmospheric perspective: blend toward sky horizon.
                const bodyC = this.mixColor(hs.bodyCol, this.sky.horizon, 0.55);
                const roofC = this.mixColor(hs.roofCol, this.sky.horizon, 0.45);
                c.fillStyle = bodyC;
                c.fillRect(hx, bodyY, hw, hh);
                // Roof
                const roofH = hh * 0.4;
                c.fillStyle = roofC;
                if (hs.isModern) {
                    c.fillRect(hx, bodyY - roofH * 0.4, hw, roofH * 0.4);
                } else {
                    c.beginPath();
                    c.moveTo(hx - 2, bodyY);
                    c.lineTo(hx + hw * 0.5, bodyY - roofH);
                    c.lineTo(hx + hw + 2, bodyY);
                    c.closePath();
                    c.fill();
                }
                // One window dot
                if (hs.windowLit && this.night > 0.3) {
                    c.fillStyle = `rgba(255, 200, 110, ${0.6 * this.night})`;
                    c.fillRect(hx + hw * 0.4, bodyY + hh * 0.35, 2.5, 2.5);
                } else {
                    c.fillStyle = 'rgba(30, 26, 30, 0.45)';
                    c.fillRect(hx + hw * 0.4, bodyY + hh * 0.35, 2.5, 2.5);
                }
            }
            // Ground strip (hazy gradient between bg houses and fg houses).
            const grad = c.createLinearGradient(0, baseY, 0, this.fgRowY);
            grad.addColorStop(0, this.mixColor(this.sky.horizon, '#4a3a2c', 0.45));
            grad.addColorStop(1, this.mixColor('#3a2a1c', this.sky.horizon, 0.15));
            c.fillStyle = grad;
            c.fillRect(0, baseY, w, this.fgRowY - baseY);
        }

        // -----------------------------------------------------------
        // Power infrastructure (poles + wires)
        // -----------------------------------------------------------

        polePoints() {
            const w = this.width, h = this.height;
            const pts = [];
            for (let i = 0; i < this.poles.length; i++) {
                const p = this.poles[i];
                const px = p.x * w;
                const top = this.fgRowY - p.h * h;
                pts.push({ x: px, top, transformer: p.transformer, tag: p.tag });
            }
            return pts;
        }

        drawPolesBehind(t) {
            const c = this.ctx;
            const pts = this.polePoints();
            this._polePts = pts;
            // Authentic Japanese power-line tangle:
            //  - Topmost: 3 high-voltage with insulator-supported sag
            //  - Middle: 2 distribution (with transformer drops)
            //  - Mid-lower: 2 communication cables
            //  - Bottom: thick fiber/telecom bundle
            const wireGroups = [
                { yOff: 4,  count: 3, gap: 5,  col: 'rgba(20, 16, 12, 0.92)', sag: 10, width: 1.0 },
                { yOff: 26, count: 2, gap: 5,  col: 'rgba(20, 16, 12, 0.90)', sag: 14, width: 1.0 },
                { yOff: 44, count: 2, gap: 4,  col: 'rgba(20, 16, 12, 0.85)', sag: 18, width: 0.9 },
                { yOff: 56, count: 1, gap: 0,  col: 'rgba(8, 6, 6, 0.95)',    sag: 22, width: 1.8 },
            ];
            const windWobble = Math.sin(t * 0.0006) * 0.6 + this.windGust * 0.2;
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i], b = pts[i + 1];
                for (const grp of wireGroups) {
                    for (let k = 0; k < grp.count; k++) {
                        const yOff = grp.yOff + k * grp.gap;
                        c.strokeStyle = grp.col;
                        c.lineWidth = grp.width;
                        c.beginPath();
                        c.moveTo(a.x, a.top + yOff);
                        const mx = (a.x + b.x) / 2;
                        const my = (a.top + b.top) / 2 + yOff + grp.sag + windWobble;
                        c.quadraticCurveTo(mx, my, b.x, b.top + yOff);
                        c.stroke();
                    }
                }
                // Diagonal service drops between consecutive pole bottoms — extra tangle.
                if (i < pts.length - 1 && i % 2 === 0) {
                    c.strokeStyle = 'rgba(20, 16, 12, 0.55)';
                    c.lineWidth = 0.6;
                    c.beginPath();
                    c.moveTo(a.x + 8, a.top + 52);
                    const my = (a.top + b.top) / 2 + 70 + windWobble;
                    c.quadraticCurveTo((a.x + b.x) / 2, my, b.x - 8, b.top + 50);
                    c.stroke();
                }
            }

            // Service drops with characteristic curl to multiple nearby houses.
            c.strokeStyle = 'rgba(18, 12, 10, 0.6)';
            c.lineWidth = 0.7;
            for (let p = 0; p < pts.length; p++) {
                const pole = pts[p];
                // Find up to 2 nearest houses.
                const candidates = [];
                for (let i = 0; i < this.houses.length; i++) {
                    const cx = (this.houses[i].x + this.houses[i].w / 2) * this.width;
                    const d = Math.abs(cx - pole.x);
                    candidates.push({ idx: i, d, cx });
                }
                candidates.sort((a, b) => a.d - b.d);
                for (let n = 0; n < 2; n++) {
                    if (candidates[n] && candidates[n].d < 100) {
                        const hs = this.houses[candidates[n].idx];
                        const hx = candidates[n].cx;
                        const hh = hs.h * this.height;
                        const hy = this.fgRowY - hh + 4;
                        const startY = pole.top + 38 + n * 6;
                        const sagMid = (startY + hy) * 0.5 + 6;
                        const midX = (pole.x + hx) * 0.5;
                        c.beginPath();
                        c.moveTo(pole.x + (hx > pole.x ? 4 : -4), startY);
                        c.quadraticCurveTo(midX, sagMid, hx, hy);
                        c.stroke();
                    }
                }
            }
        }

        drawPolesFront(t) {
            const c = this.ctx;
            const pts = this._polePts || this.polePoints();
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                const pole = this.poles[i];
                // Stay (guy) wire to ground — drawn first so pole sits over it.
                if (pole.stayWire) {
                    const sxDir = i < this.poles.length / 2 ? -1 : 1;
                    c.strokeStyle = 'rgba(50, 44, 40, 0.7)';
                    c.lineWidth = 0.7;
                    c.beginPath();
                    c.moveTo(p.x, p.top + 8);
                    c.lineTo(p.x + sxDir * 28, this.fgRowY - 4);
                    c.stroke();
                    // Yellow stay wire cover at bottom.
                    c.fillStyle = '#dcc466';
                    c.fillRect(p.x + sxDir * 22 - 1, this.fgRowY - 22, 2, 18);
                    c.strokeStyle = 'rgba(40, 30, 20, 0.6)';
                    c.lineWidth = 0.4;
                    c.strokeRect(p.x + sxDir * 22 - 1, this.fgRowY - 22, 2, 18);
                    // Concrete anchor block.
                    c.fillStyle = '#7a7670';
                    c.fillRect(p.x + sxDir * 28 - 4, this.fgRowY - 4, 8, 4);
                }
                // Concrete pole with subtle gradient (round in section).
                const poleGrad = c.createLinearGradient(p.x - 2.6, 0, p.x + 2.6, 0);
                poleGrad.addColorStop(0, '#8e8e88');
                poleGrad.addColorStop(0.45, '#bcbcb6');
                poleGrad.addColorStop(1, '#787872');
                c.fillStyle = poleGrad;
                c.beginPath();
                c.moveTo(p.x - 2.6, this.fgRowY);
                c.lineTo(p.x + 2.6, this.fgRowY);
                c.lineTo(p.x + 1.6, p.top);
                c.lineTo(p.x - 1.6, p.top);
                c.closePath();
                c.fill();
                // Pole segment lines (concrete sections every ~30px).
                c.strokeStyle = 'rgba(70, 65, 60, 0.55)';
                c.lineWidth = 0.5;
                const poleH = this.fgRowY - p.top;
                for (let seg = 1; seg < 4; seg++) {
                    const sy = p.top + poleH * (seg / 4);
                    c.beginPath();
                    c.moveTo(p.x - 2.4, sy);
                    c.lineTo(p.x + 2.4, sy);
                    c.stroke();
                }
                // Vertical climbing pegs (alternating little nubs).
                c.fillStyle = '#5a5448';
                for (let k = 0; k < 5; k++) {
                    const py = p.top + 20 + k * 22;
                    if (py > this.fgRowY - 6) break;
                    c.fillRect(p.x + (k % 2 ? 2.0 : -3.2), py, 1.4, 1.4);
                }
                // --- Crossarms ---
                c.strokeStyle = '#3a2820';
                c.lineWidth = 2;
                c.beginPath();
                c.moveTo(p.x - 22, p.top + 4); c.lineTo(p.x + 22, p.top + 4);
                c.stroke();
                c.lineWidth = 1.7;
                c.beginPath();
                c.moveTo(p.x - 17, p.top + 26); c.lineTo(p.x + 17, p.top + 26);
                c.stroke();
                c.lineWidth = 1.4;
                c.beginPath();
                c.moveTo(p.x - 13, p.top + 44); c.lineTo(p.x + 13, p.top + 44);
                c.stroke();
                // Insulators on top arm — pin-type with skirt.
                for (let k = -1; k <= 1; k++) {
                    const ix = p.x + k * 9;
                    c.fillStyle = '#e6e6e1';
                    c.beginPath();
                    c.arc(ix, p.top + 2.5, 1.5, 0, Math.PI * 2);
                    c.fill();
                    c.fillStyle = '#c4c4be';
                    c.fillRect(ix - 1.5, p.top + 3.5, 3, 1);
                    // Tiny stem to crossarm.
                    c.strokeStyle = '#3a2820';
                    c.lineWidth = 0.5;
                    c.beginPath();
                    c.moveTo(ix, p.top + 4.5); c.lineTo(ix, p.top + 6);
                    c.stroke();
                }
                // Insulators on middle arm (2 + post insulators).
                for (let k = 0; k < 2; k++) {
                    const ix = p.x + (k === 0 ? -8 : 8);
                    c.fillStyle = '#e6e6e1';
                    c.beginPath();
                    c.arc(ix, p.top + 25, 1.4, 0, Math.PI * 2);
                    c.fill();
                }
                // Bird spikes on top arm.
                if (pole.birdSpike) {
                    c.strokeStyle = '#3a3530';
                    c.lineWidth = 0.4;
                    for (let k = -3; k <= 3; k++) {
                        const sx = p.x + k * 3;
                        c.beginPath();
                        c.moveTo(sx, p.top + 4);
                        c.lineTo(sx, p.top - 2);
                        c.stroke();
                    }
                }
                // --- Transformers (1 or 2 stacked) ---
                if (pole.transformer) {
                    for (let tk = 0; tk < pole.transformerCount; tk++) {
                        const txOff = tk === 0 ? 5 : -12;
                        const tyTop = p.top + 30 + (tk === 1 ? 4 : 0);
                        // Body.
                        const tGrad = c.createLinearGradient(p.x + txOff, 0, p.x + txOff + 8, 0);
                        tGrad.addColorStop(0, '#1d1a16');
                        tGrad.addColorStop(0.5, '#2c2922');
                        tGrad.addColorStop(1, '#15120e');
                        c.fillStyle = tGrad;
                        c.beginPath();
                        c.moveTo(p.x + txOff, tyTop);
                        c.lineTo(p.x + txOff + 8, tyTop);
                        c.lineTo(p.x + txOff + 8, tyTop + 22);
                        c.quadraticCurveTo(p.x + txOff + 4, tyTop + 27, p.x + txOff, tyTop + 22);
                        c.closePath();
                        c.fill();
                        // Lid.
                        c.fillStyle = '#0a0908';
                        c.fillRect(p.x + txOff, tyTop - 1.5, 8, 2.5);
                        // Bushing (porcelain stub on top).
                        c.fillStyle = '#d8d4cc';
                        c.fillRect(p.x + txOff + 2, tyTop - 4.5, 1.5, 3);
                        c.fillRect(p.x + txOff + 4.5, tyTop - 4.5, 1.5, 3);
                        // Cooling fins (3 horizontal ridges).
                        c.strokeStyle = 'rgba(70, 60, 50, 0.8)';
                        c.lineWidth = 0.4;
                        for (let f = 0; f < 4; f++) {
                            const fy = tyTop + 5 + f * 4;
                            c.beginPath();
                            c.moveTo(p.x + txOff + 0.6, fy);
                            c.lineTo(p.x + txOff + 7.4, fy);
                            c.stroke();
                        }
                        // Mounting bracket.
                        c.strokeStyle = '#2a2520';
                        c.lineWidth = 0.6;
                        c.beginPath();
                        c.moveTo(p.x + (txOff > 0 ? 0 : 1.6), tyTop + 4);
                        c.lineTo(p.x + txOff + (txOff > 0 ? 0 : 8), tyTop + 4);
                        c.moveTo(p.x + (txOff > 0 ? 0 : 1.6), tyTop + 16);
                        c.lineTo(p.x + txOff + (txOff > 0 ? 0 : 8), tyTop + 16);
                        c.stroke();
                    }
                    // Lightning arrester stub.
                    c.strokeStyle = '#3a3530';
                    c.lineWidth = 0.7;
                    c.beginPath();
                    c.moveTo(p.x + 8, p.top + 28);
                    c.lineTo(p.x + 8, p.top + 22);
                    c.stroke();
                }
                // --- Splice box (cable junction) ---
                if (pole.spliceBox) {
                    c.fillStyle = '#5a564e';
                    c.fillRect(p.x - 7, p.top + 60, 6, 14);
                    c.strokeStyle = 'rgba(20, 15, 12, 0.7)';
                    c.lineWidth = 0.5;
                    c.strokeRect(p.x - 7, p.top + 60, 6, 14);
                    // Lid hinge dots.
                    c.fillStyle = '#2a2520';
                    c.fillRect(p.x - 6.5, p.top + 61, 1, 1);
                    c.fillRect(p.x - 6.5, p.top + 72, 1, 1);
                }
                // --- Pole-mounted streetlight ---
                if (pole.streetLight) {
                    const slY = p.top + 50;
                    const slDir = i % 2 === 0 ? 1 : -1;
                    c.strokeStyle = '#3a3530';
                    c.lineWidth = 1;
                    c.beginPath();
                    c.moveTo(p.x, slY);
                    c.quadraticCurveTo(p.x + slDir * 8, slY - 4, p.x + slDir * 14, slY);
                    c.stroke();
                    c.fillStyle = '#2a2520';
                    c.beginPath();
                    c.ellipse(p.x + slDir * 16, slY + 2, 3, 1.6, 0, 0, Math.PI * 2);
                    c.fill();
                    // Lamp on at night.
                    const lampOn = this.lampOn();
                    if (lampOn > 0.1) {
                        c.save();
                        c.globalCompositeOperation = 'lighter';
                        const halo = c.createRadialGradient(p.x + slDir * 16, slY + 2, 1, p.x + slDir * 16, slY + 2, 14);
                        halo.addColorStop(0, `rgba(255, 220, 140, ${0.7 * lampOn})`);
                        halo.addColorStop(1, 'rgba(255, 220, 140, 0)');
                        c.fillStyle = halo;
                        c.fillRect(p.x + slDir * 16 - 14, slY - 12, 28, 28);
                        c.restore();
                    }
                }
                // --- Sign ---
                if (pole.sign) {
                    const signY = p.top + 84;
                    if (pole.sign === 'speed') {
                        // Speed limit (round white sign with red border, "30").
                        c.fillStyle = '#f4f0e8';
                        c.beginPath();
                        c.arc(p.x + 6, signY, 4.5, 0, Math.PI * 2);
                        c.fill();
                        c.strokeStyle = '#c83830';
                        c.lineWidth = 0.9;
                        c.stroke();
                        c.fillStyle = '#1a1a1a';
                        c.font = '4px sans-serif';
                        c.textAlign = 'center';
                        c.textBaseline = 'middle';
                        c.fillText('30', p.x + 6, signY);
                    } else {
                        // No-parking sign (blue square with diagonal slash).
                        c.fillStyle = '#1a4ca8';
                        c.fillRect(p.x + 2, signY - 4, 8, 8);
                        c.strokeStyle = '#f0f0e8';
                        c.lineWidth = 0.5;
                        c.strokeRect(p.x + 2, signY - 4, 8, 8);
                        c.strokeStyle = '#c83830';
                        c.lineWidth = 1.2;
                        c.beginPath();
                        c.moveTo(p.x + 3, signY - 3); c.lineTo(p.x + 9, signY + 3);
                        c.stroke();
                    }
                }
                // Pole tag (yellow/white plate with carrier code).
                c.fillStyle = '#dcd084';
                c.fillRect(p.x - 5, p.top + 70, 10, 5);
                c.strokeStyle = 'rgba(40, 35, 30, 0.6)';
                c.lineWidth = 0.4;
                c.strokeRect(p.x - 5, p.top + 70, 10, 5);
                c.fillStyle = '#1a1410';
                c.font = '3px sans-serif';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(p.tag.slice(-3), p.x, p.top + 72.5);
            }
        }

        // -----------------------------------------------------------
        // Foreground houses
        // -----------------------------------------------------------

        drawForegroundHouses(t, dt) {
            for (let i = 0; i < this.houses.length; i++) {
                const hs = this.houses[i];
                // Per-house flicker decay.
                hs.flickerNext -= dt;
                if (hs.flickerNext <= 0) {
                    hs.flickerOn = Math.random() < 0.10 ? 0.45 : 1;
                    hs.flickerNext = 600 + Math.random() * 2200;
                }
                this.drawHouseShadow(hs, i);
            }
            for (let i = 0; i < this.houses.length; i++) {
                const hs = this.houses[i];
                this.drawHouse(hs, i, t, dt);
            }
        }

        drawHouseShadow(hs, i) {
            if (this.night > 0.4 || !this.sunVisible) return;
            const c = this.ctx;
            const w = this.width, h = this.height;
            const hx = hs.x * w;
            const hw = hs.w * w;
            const hh = hs.h * h;
            const bodyY = this.fgRowY - hh;
            // Horizontal shadow offset depends on sun side.
            const sunSide = Math.sign(this.sunX - (hx + hw / 2));
            const shadowLen = Math.max(8, 0.6 * hh * (1 - this.sky.sunI * 0.5));
            const dx = -sunSide * shadowLen * 0.6;
            c.fillStyle = `rgba(20, 18, 28, ${0.20 * this.sky.sunI})`;
            c.beginPath();
            c.moveTo(hx, this.fgRowY);
            c.lineTo(hx + hw, this.fgRowY);
            c.lineTo(hx + hw + dx, this.fgRowY + shadowLen * 0.20);
            c.lineTo(hx + dx, this.fgRowY + shadowLen * 0.20);
            c.closePath();
            c.fill();
        }

        drawHouse(hs, i, t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const hx = hs.x * w;
            const hw = hs.w * w;
            const hh = hs.h * h;
            const baseY = this.fgRowY;
            const bodyY = baseY - hh;
            const roofH = hh * 0.55;
            const roofY = bodyY - roofH;

            // Apartments use a totally different layout — delegate.
            if (hs.archetype === 'apartment') {
                this.drawApartment(hs, i, hx, hw, hh, bodyY, baseY, t, dt);
                if (hs.gate) this.drawHouseGate(hs, hx, hw, baseY);
                if (hs.plantPot) this.drawPlantPot(hs, hx, hw, baseY);
                if (hs.mailbox) this.drawMailbox(hs, hx, hw, baseY);
                return;
            }

            // Body
            c.fillStyle = hs.bodyCol;
            c.fillRect(hx, bodyY, hw, hh);

            // Body texture by archetype.
            if (hs.isMachiya) {
                // Vertical wooden slats (koshi格子).
                c.strokeStyle = 'rgba(20, 12, 8, 0.55)';
                c.lineWidth = 0.6;
                const slatCount = Math.max(8, Math.floor(hw / 3.4));
                for (let p = 1; p < slatCount; p++) {
                    const px = hx + (hw / slatCount) * p;
                    c.beginPath();
                    c.moveTo(px, bodyY + 2);
                    c.lineTo(px, baseY - 2);
                    c.stroke();
                }
                // Mid-height beam (nageshi).
                c.fillStyle = this.mixColor(hs.bodyCol, '#000', 0.55);
                c.fillRect(hx, bodyY + hh * 0.45, hw, 1.4);
            } else {
                // Panel lines.
                c.strokeStyle = 'rgba(60, 40, 30, 0.18)';
                c.lineWidth = 1;
                const panels = 4;
                for (let p = 1; p < panels; p++) {
                    const px = hx + (hw / panels) * p;
                    c.beginPath();
                    c.moveTo(px, bodyY + 2);
                    c.lineTo(px, baseY - 2);
                    c.stroke();
                }
            }

            // Foundation strip (concrete).
            c.fillStyle = '#7a7670';
            c.fillRect(hx, baseY - 4, hw, 4);
            c.fillStyle = 'rgba(20, 14, 10, 0.50)';
            c.fillRect(hx, baseY - 5, hw, 1);
            c.fillStyle = 'rgba(20, 14, 10, 0.50)';
            c.fillRect(hx, baseY - 1, hw, 1);

            // Roof by archetype
            const apexX = hx + hw * 0.5;
            const eaveY = bodyY;
            if (hs.archetype === 'modern_mono') {
                this.drawMonopitchRoof(hs, hx, hw, eaveY);
            } else if (hs.archetype === 'townhouse' || hs.archetype === 'shophouse') {
                this.drawFlatRoof(hs, hx, hw, eaveY);
            } else if (hs.archetype === 'kawara_hip') {
                this.drawKawaraHipRoof(hs, hx, hw, eaveY, roofH);
            } else if (hs.archetype === 'machiya') {
                this.drawMachiyaRoof(hs, hx, hw, eaveY, roofH, apexX, roofY);
            } else {
                this.drawMinkaRoof(hs, hx, hw, eaveY, roofH, apexX, roofY);
            }

            // Antenna / dish on rooftop.
            this.drawRoofAccessories(hs, hx, hw, eaveY, roofY, roofH);

            // Windows
            this.drawHouseWindows(hs, i, hx, hw, hh, bodyY, t, dt);

            // Door
            if (hs.door) {
                const dx = hx + hw * 0.20;
                const dy = bodyY + hh * 0.55;
                const dh = hh * 0.45;
                c.fillStyle = '#3a2a20';
                c.fillRect(dx, dy, 9, dh);
                c.fillStyle = 'rgba(255, 220, 180, 0.4)';
                c.fillRect(dx + 1.5, dy + 2, 6, 2);
                c.strokeStyle = '#1a1410';
                c.lineWidth = 1;
                c.strokeRect(dx, dy, 9, dh);
                // Genkan step
                c.fillStyle = '#231a14';
                c.fillRect(dx - 2, dy + dh, 13, 2);
            }

            // Side window
            if (hs.sideWindow) {
                const sx = hx + hw * 0.80;
                const sy = bodyY + hh * 0.30;
                c.fillStyle = hs.windowLit ? `rgba(255, 200, 110, ${0.7 * this.lampOn()})` : '#2a2418';
                c.fillRect(sx, sy, 5, 5);
                c.strokeStyle = '#1a1612';
                c.lineWidth = 0.8;
                c.strokeRect(sx, sy, 5, 5);
            }

            // AC outdoor unit.
            if (hs.ac) {
                const ax = hs.acSide === 'L' ? hx + 2 : hx + hw - 12;
                const ay = bodyY + hh * 0.55;
                c.fillStyle = '#dcdcd6';
                c.fillRect(ax, ay, 10, 7);
                c.strokeStyle = 'rgba(40, 35, 30, 0.6)';
                c.lineWidth = 0.6;
                c.strokeRect(ax, ay, 10, 7);
                c.fillStyle = '#1a1612';
                c.fillRect(ax + 1, ay + 1, 8, 5);
                c.strokeStyle = '#9a9a92';
                c.lineWidth = 0.4;
                for (let k = 1; k < 4; k++) {
                    c.beginPath();
                    c.moveTo(ax + 1, ay + 1 + k);
                    c.lineTo(ax + 9, ay + 1 + k);
                    c.stroke();
                }
            }

            // Balcony + laundry
            if (hs.balcony) {
                this.drawBalcony(hs, i, hx, hw, hh, bodyY, t);
            }

            // Front gate (low aluminium fence) — drawn over foundation.
            if (hs.gate) this.drawHouseGate(hs, hx, hw, baseY);

            // Machiya: hanging noren curtain at door.
            if (hs.isMachiya && hs.noren && hs.door) {
                const ndx = hx + hw * 0.20;
                const ndy = bodyY + hh * 0.55;
                const ndw = 12, ndh = 7;
                c.fillStyle = hs.norenCol;
                c.fillRect(ndx - 1.5, ndy, ndw, ndh);
                c.strokeStyle = 'rgba(20, 14, 10, 0.5)';
                c.lineWidth = 0.4;
                c.beginPath();
                c.moveTo(ndx + ndw * 0.3 - 1.5, ndy);
                c.lineTo(ndx + ndw * 0.3 - 1.5, ndy + ndh);
                c.moveTo(ndx + ndw * 0.7 - 1.5, ndy);
                c.lineTo(ndx + ndw * 0.7 - 1.5, ndy + ndh);
                c.stroke();
                // White character on noren.
                c.fillStyle = '#f0ece0';
                c.fillRect(ndx + ndw * 0.4 - 1.5, ndy + ndh * 0.3, 1.5, 2.5);
            }

            // Plant pot near entrance.
            if (hs.plantPot) this.drawPlantPot(hs, hx, hw, baseY);
            // Mailbox.
            if (hs.mailbox) this.drawMailbox(hs, hx, hw, baseY);

            // Chimney & smoke — the chimney itself is static (always drawn),
            // but smoke only appears when someone has actually lit the stove:
            // cool hours, and each house has its own slow on/off duty cycle.
            if (hs.chimney) {
                const cxx = hx + hw * 0.72;
                const cyTop = roofY + roofH * 0.20;
                const cww = Math.max(3, hw * 0.10);
                const chh = roofH * 0.55;
                c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.25);
                c.fillRect(cxx, cyTop, cww, chh);
                c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.50);
                c.fillRect(cxx, cyTop, cww, 1.5);

                // Lazy-init the smoke duty-cycle state.
                if (hs.smokeOn == null) {
                    hs.smokeOn = false;
                    hs.smokeNextToggle = 4000 + Math.random() * 18000;
                }
                const cycle = this.sky.cycle;
                // Cooler windows: late evening, overnight, and dawn. Daytime
                // households rarely run the stove.
                const coolHours = cycle < 0.30 || cycle > 0.72 || this.night > 0.25;
                hs.smokeNextToggle -= dt;
                if (hs.smokeNextToggle <= 0) {
                    if (hs.smokeOn) {
                        // Burned out — long quiet period.
                        hs.smokeOn = false;
                        hs.smokeNextToggle = 25000 + Math.random() * 90000;
                    } else if (coolHours && Math.random() < 0.45) {
                        // Lit a fire — burns for a while.
                        hs.smokeOn = true;
                        hs.smokeNextToggle = 18000 + Math.random() * 40000;
                    } else {
                        hs.smokeNextToggle = 6000 + Math.random() * 14000;
                    }
                }
                if (hs.smokeOn) {
                    const phase = hs.chimneyPhase + t * 0.0006;
                    for (let k = 0; k < 3; k++) {
                        const rise = ((phase + k * 0.4) % 1);
                        const sy = cyTop - rise * 26;
                        const sx = cxx + cww * 0.5 + Math.sin(phase * 5 + k) * (4 * rise + this.wind * 4);
                        const sr = 2 + rise * 6;
                        const a = (1 - rise) * 0.35;
                        c.fillStyle = `rgba(200, 180, 170, ${a})`;
                        c.beginPath();
                        c.arc(sx, sy, sr, 0, Math.PI * 2);
                        c.fill();
                    }
                }
            }
        }

        // Lamp/window dimming factor (0 by day, 1 by night, lingers slightly at dusk).
        lampOn() {
            return this.clamp(this.night * 1.3 + (this.sky.sunI < 0.6 ? 0.1 : 0), 0, 1);
        }

        drawMinkaRoof(hs, hx, hw, eaveY, roofH, apexX, roofY) {
            const c = this.ctx;
            const eaveOverhang = Math.max(5, hw * 0.10);
            const apexY = roofY;
            const leftEaveX = hx - eaveOverhang;
            const rightEaveX = hx + hw + eaveOverhang;
            c.fillStyle = hs.roofCol;
            c.beginPath();
            c.moveTo(leftEaveX, eaveY - 1);
            c.quadraticCurveTo(hx + hw * 0.20, apexY + roofH * 0.18, apexX - hw * 0.05, apexY);
            c.lineTo(apexX + hw * 0.05, apexY);
            c.quadraticCurveTo(hx + hw * 0.80, apexY + roofH * 0.18, rightEaveX, eaveY - 1);
            c.lineTo(hx + hw, eaveY);
            c.lineTo(hx, eaveY);
            c.closePath();
            c.fill();
            // Side shading
            c.fillStyle = 'rgba(0, 0, 0, 0.20)';
            c.beginPath();
            c.moveTo(apexX, apexY);
            c.quadraticCurveTo(hx + hw * 0.80, apexY + roofH * 0.18, rightEaveX, eaveY - 1);
            c.lineTo(hx + hw, eaveY);
            c.lineTo(apexX, eaveY);
            c.closePath();
            c.fill();
            // Ridge cap
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.50);
            c.fillRect(apexX - hw * 0.12, apexY - 1, hw * 0.24, 3);
            // Onigawara (decorative end-tiles)
            if (hs.onigawara) {
                c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.65);
                c.beginPath();
                c.arc(apexX - hw * 0.12, apexY - 1, 2.4, 0, Math.PI * 2);
                c.fill();
                c.beginPath();
                c.arc(apexX + hw * 0.12, apexY - 1, 2.4, 0, Math.PI * 2);
                c.fill();
            }
            // Tile rows — semicircular scallop bumps along ridge lines.
            this.drawKawaraTileRows(hs, apexX, apexY, eaveY, hw, eaveOverhang, roofH);
        }

        drawKawaraHipRoof(hs, hx, hw, eaveY, roofH) {
            const c = this.ctx;
            const apexX = hx + hw * 0.5;
            const eaveOverhang = Math.max(4, hw * 0.08);
            const apexY = eaveY - roofH * 0.85;
            const ridgeL = apexX - hw * 0.15;
            const ridgeR = apexX + hw * 0.15;
            c.fillStyle = hs.roofCol;
            c.beginPath();
            c.moveTo(hx - eaveOverhang, eaveY - 1);
            c.lineTo(ridgeL, apexY);
            c.lineTo(ridgeR, apexY);
            c.lineTo(hx + hw + eaveOverhang, eaveY - 1);
            c.lineTo(hx + hw, eaveY);
            c.lineTo(hx, eaveY);
            c.closePath();
            c.fill();
            // Side shading
            c.fillStyle = 'rgba(0, 0, 0, 0.22)';
            c.beginPath();
            c.moveTo(ridgeR, apexY);
            c.lineTo(hx + hw + eaveOverhang, eaveY - 1);
            c.lineTo(hx + hw, eaveY);
            c.lineTo(apexX, eaveY);
            c.lineTo(apexX, apexY);
            c.closePath();
            c.fill();
            // Ridge cap
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.50);
            c.fillRect(ridgeL, apexY - 1, ridgeR - ridgeL, 3);
            // Onigawara
            if (hs.onigawara) {
                c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.65);
                c.beginPath();
                c.arc(ridgeL, apexY - 1, 2.4, 0, Math.PI * 2);
                c.fill();
                c.beginPath();
                c.arc(ridgeR, apexY - 1, 2.4, 0, Math.PI * 2);
                c.fill();
            }
            this.drawKawaraTileRows(hs, apexX, apexY, eaveY, hw, eaveOverhang, roofH);
        }

        drawKawaraTileRows(hs, apexX, apexY, eaveY, hw, eaveOverhang, roofH) {
            const c = this.ctx;
            const rows = 4;
            for (let r = 1; r <= rows; r++) {
                const ratio = r / rows;
                const ry = apexY + (eaveY - apexY) * ratio;
                const halfW = hw * 0.5 * ratio + eaveOverhang * ratio;
                // Underline (darker tile shadow row).
                c.strokeStyle = 'rgba(0, 0, 0, 0.25)';
                c.lineWidth = 1;
                c.beginPath();
                c.moveTo(apexX - halfW, ry);
                c.quadraticCurveTo(apexX, ry + roofH * 0.05 * (1 - ratio), apexX + halfW, ry);
                c.stroke();
                // Scallop bumps along the row.
                const tileCount = Math.max(5, Math.floor((halfW * 2) / 6));
                c.fillStyle = this.mixColor(hs.roofCol, '#fff', 0.06);
                for (let k = 0; k < tileCount; k++) {
                    const tk = k / (tileCount - 1);
                    const bx = apexX - halfW + tk * (halfW * 2);
                    const sag = roofH * 0.05 * (1 - ratio) * (1 - Math.abs(tk - 0.5) * 2) * 0.6;
                    const by = ry + sag;
                    c.beginPath();
                    c.arc(bx, by - 0.5, 1.2, Math.PI, Math.PI * 2);
                    c.fill();
                }
            }
        }

        drawMonopitchRoof(hs, hx, hw, eaveY) {
            const c = this.ctx;
            const slope = hw * 0.12;
            c.fillStyle = hs.roofCol;
            c.beginPath();
            c.moveTo(hx - 2, eaveY);
            c.lineTo(hx - 2, eaveY - slope * 0.4);
            c.lineTo(hx + hw + 2, eaveY - slope);
            c.lineTo(hx + hw + 2, eaveY);
            c.closePath();
            c.fill();
            // Fascia shadow
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.45);
            c.fillRect(hx - 2, eaveY - 1, hw + 4, 1.6);
            // Solar panel grid with gradient + sheen.
            const px0 = hx + hw * 0.30;
            const py0 = eaveY - slope * 0.85;
            const pw = hw * 0.45;
            const ph = slope * 0.5;
            const panelGrad = c.createLinearGradient(px0, py0, px0 + pw, py0 + ph);
            panelGrad.addColorStop(0, '#16263c');
            panelGrad.addColorStop(0.5, '#0e1e30');
            panelGrad.addColorStop(1, '#0a1424');
            c.fillStyle = panelGrad;
            c.fillRect(px0, py0, pw, ph);
            c.strokeStyle = 'rgba(80, 110, 160, 0.6)';
            c.lineWidth = 0.5;
            const cells = 6;
            for (let k = 1; k < cells; k++) {
                const cx = px0 + (pw / cells) * k;
                c.beginPath();
                c.moveTo(cx, py0); c.lineTo(cx, py0 + ph);
                c.stroke();
            }
            c.beginPath();
            c.moveTo(px0, py0 + ph * 0.5); c.lineTo(px0 + pw, py0 + ph * 0.5);
            c.stroke();
            // Sheen — diagonal lighter band tracking sun side.
            if (this.sunVisible) {
                const dir = Math.sign(this.sunX - (hx + hw * 0.5));
                c.save();
                c.globalCompositeOperation = 'lighter';
                const sheenX = px0 + (dir > 0 ? pw * 0.7 : pw * 0.15);
                const sheen = c.createLinearGradient(sheenX, py0, sheenX + pw * 0.15, py0 + ph);
                sheen.addColorStop(0, `rgba(150, 190, 240, 0)`);
                sheen.addColorStop(0.5, `rgba(150, 190, 240, ${0.25 * this.sky.sunI})`);
                sheen.addColorStop(1, `rgba(150, 190, 240, 0)`);
                c.fillStyle = sheen;
                c.fillRect(px0, py0, pw, ph);
                c.restore();
            }
        }

        drawFlatRoof(hs, hx, hw, eaveY) {
            const c = this.ctx;
            // Slim parapet
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.20);
            c.fillRect(hx, eaveY - 3, hw, 3);
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.45);
            c.fillRect(hx, eaveY - 1, hw, 1);
            // Shop-house: roller shutter on ground floor.
            if (hs.archetype === 'shophouse') {
                const sy = eaveY + (this.fgRowY - eaveY) * 0.55;
                const sH = this.fgRowY - sy - 4;
                if (this.lampOn() < 0.3) {
                    // Open during day: interior visible
                    c.fillStyle = 'rgba(40, 30, 25, 0.85)';
                    c.fillRect(hx + 3, sy, hw - 6, sH);
                    c.fillStyle = `rgba(255, 220, 160, ${0.45})`;
                    c.fillRect(hx + 4, sy + 2, hw - 8, sH - 4);
                } else {
                    // Closed at night: shutter
                    c.fillStyle = '#7a7670';
                    c.fillRect(hx + 3, sy, hw - 6, sH);
                    c.strokeStyle = '#4a4640';
                    c.lineWidth = 0.4;
                    for (let k = 1; k * 2 < sH; k++) {
                        c.beginPath();
                        c.moveTo(hx + 3, sy + k * 2);
                        c.lineTo(hx + hw - 3, sy + k * 2);
                        c.stroke();
                    }
                }
            }
        }

        drawRoofAccessories(hs, hx, hw, eaveY, roofY, roofH) {
            const c = this.ctx;
            const apexX = hx + hw * 0.5;
            const topY = (hs.archetype === 'townhouse' || hs.archetype === 'shophouse') ? eaveY - 4 :
                         (hs.archetype === 'modern_mono') ? eaveY - hw * 0.12 :
                         roofY + 2;
            if (hs.antenna) {
                const ax = apexX + (hs.acSide === 'L' ? -hw * 0.25 : hw * 0.25);
                const ay = topY;
                const aH = roofH * hs.antennaH;
                c.strokeStyle = '#1a1612';
                c.lineWidth = 0.8;
                c.beginPath();
                c.moveTo(ax, ay);
                c.lineTo(ax, ay - aH);
                c.stroke();
                // Yagi cross-elements.
                c.lineWidth = 0.6;
                for (let k = 0; k < 3; k++) {
                    const cy = ay - aH * (0.45 + k * 0.18);
                    const xw = 5 - k;
                    c.beginPath();
                    c.moveTo(ax - xw, cy);
                    c.lineTo(ax + xw, cy);
                    c.stroke();
                }
            }
            if (hs.dish) {
                const dx = apexX + (hs.acSide === 'L' ? hw * 0.15 : -hw * 0.15);
                const dy = topY - 2;
                c.fillStyle = '#dcdcd2';
                c.beginPath();
                c.arc(dx, dy, 3, Math.PI, Math.PI * 2);
                c.fill();
                c.strokeStyle = '#1a1612';
                c.lineWidth = 0.5;
                c.beginPath();
                c.moveTo(dx, dy); c.lineTo(dx, dy + 4);
                c.stroke();
            }
        }

        drawHouseWindows(hs, i, hx, hw, hh, bodyY, t, dt) {
            const c = this.ctx;
            const baseY = this.fgRowY;
            // First-floor window
            const wx = hx + hw * 0.5 - 7;
            const wy = bodyY + hh * 0.40;
            const wWid = 14;
            const wHei = Math.min(14, hh * 0.32);
            const lampOn = this.lampOn();
            const lit = hs.windowLit && lampOn > 0.05;
            if (lit) {
                const intensity = lampOn * hs.flickerOn;
                c.fillStyle = `rgba(255, 200, 110, ${0.85 * intensity})`;
                c.fillRect(wx, wy, wWid, wHei);
                // Glow — one shared origin-anchored gradient, positioned via
                // translate and dimmed via globalAlpha, instead of allocating
                // a radial gradient per lit window per frame.
                if (!this._winGlowGrad) {
                    const g = c.createRadialGradient(0, 0, 2, 0, 0, 36);
                    g.addColorStop(0, 'rgba(255, 200, 110, 0.5)');
                    g.addColorStop(1, 'rgba(255, 200, 110, 0)');
                    this._winGlowGrad = g;
                }
                c.save();
                c.globalCompositeOperation = 'lighter';
                c.globalAlpha = intensity;
                c.translate(wx + wWid * 0.5, wy + wHei * 0.5);
                c.fillStyle = this._winGlowGrad;
                c.beginPath();
                c.arc(0, 0, 36, 0, Math.PI * 2);
                c.fill();
                c.restore();
                // Curtain silhouette (occasional walking past).
                hs.silNext -= dt;
                if (hs.silNext <= 0 && hs.silWalk <= 0) {
                    hs.silWalk = 1500;
                    hs.silNext = 30000 + Math.random() * 60000;
                }
                if (hs.silWalk > 0) {
                    hs.silWalk -= dt;
                    const k = 1 - hs.silWalk / 1500;
                    c.fillStyle = `rgba(40, 30, 25, ${0.55 * intensity})`;
                    const silX = wx + 1 + k * (wWid - 5);
                    c.fillRect(silX, wy + 1, 4, wHei - 3);
                }
            } else {
                c.fillStyle = '#3a3530';
                c.fillRect(wx, wy, wWid, wHei);
            }
            // Window variant lattice/shoji/frosted.
            c.strokeStyle = '#1a1612';
            c.lineWidth = 1;
            c.strokeRect(wx, wy, wWid, wHei);
            if (hs.windowVariant === 'lattice') {
                c.beginPath();
                c.moveTo(wx, wy + wHei * 0.5); c.lineTo(wx + wWid, wy + wHei * 0.5);
                c.moveTo(wx + wWid * 0.5, wy); c.lineTo(wx + wWid * 0.5, wy + wHei);
                c.stroke();
            } else if (hs.windowVariant === 'koushi') {
                // Dense vertical wood-lattice (machiya signature).
                c.lineWidth = 0.5;
                c.strokeStyle = 'rgba(30, 20, 14, 0.85)';
                for (let k = 1; k < 8; k++) {
                    const xx = wx + (wWid / 8) * k;
                    c.beginPath();
                    c.moveTo(xx, wy + 1); c.lineTo(xx, wy + wHei - 1);
                    c.stroke();
                }
                // 2 horizontals.
                c.beginPath();
                c.moveTo(wx + 1, wy + wHei * 0.33); c.lineTo(wx + wWid - 1, wy + wHei * 0.33);
                c.moveTo(wx + 1, wy + wHei * 0.66); c.lineTo(wx + wWid - 1, wy + wHei * 0.66);
                c.stroke();
            } else if (hs.windowVariant === 'shoji') {
                // Vertical sliding partition + thin paper grid
                c.lineWidth = 0.6;
                for (let k = 1; k < 4; k++) {
                    const xx = wx + (wWid / 4) * k;
                    c.beginPath();
                    c.moveTo(xx, wy + 1); c.lineTo(xx, wy + wHei - 1);
                    c.stroke();
                }
                c.beginPath();
                c.moveTo(wx + 1, wy + wHei * 0.5);
                c.lineTo(wx + wWid - 1, wy + wHei * 0.5);
                c.stroke();
            } else {
                // Frosted: faint overlay
                c.fillStyle = 'rgba(230, 235, 240, 0.18)';
                c.fillRect(wx + 0.5, wy + 0.5, wWid - 1, wHei - 1);
            }

            // Second-floor window
            if (hs.twoFloor) {
                const w2x = hx + hw * 0.5 - 6;
                const w2y = bodyY + hh * 0.14;
                if (lit) {
                    c.fillStyle = `rgba(255, 200, 110, ${0.55 * lampOn * hs.flickerOn})`;
                    c.fillRect(w2x, w2y, 12, 7);
                } else {
                    c.fillStyle = '#1a1410';
                    c.fillRect(w2x, w2y, 12, 7);
                }
                c.strokeStyle = '#1a1612';
                c.lineWidth = 1;
                c.strokeRect(w2x, w2y, 12, 7);
                c.beginPath();
                c.moveTo(w2x + 6, w2y); c.lineTo(w2x + 6, w2y + 7);
                c.stroke();
            }
        }

        drawBalcony(hs, i, hx, hw, hh, bodyY, t) {
            const c = this.ctx;
            const bxx = hx + hw * 0.55;
            const byy = bodyY + hh * 0.30;
            const bww = hw * 0.40;
            // Floor plate
            c.fillStyle = 'rgba(20, 15, 12, 0.55)';
            c.fillRect(bxx, byy, bww, 2);
            // Railing
            c.strokeStyle = 'rgba(20, 15, 12, 0.7)';
            c.lineWidth = 0.7;
            for (let k = 0; k < 6; k++) {
                const rx = bxx + 1 + k * (bww - 2) / 5;
                c.beginPath();
                c.moveTo(rx, byy + 2);
                c.lineTo(rx, byy + 9);
                c.stroke();
            }
            c.beginPath();
            c.moveTo(bxx, byy + 9); c.lineTo(bxx + bww, byy + 9);
            c.stroke();

            // Laundry (lazy-init on first sight).
            if (!hs.laundry) {
                const lrand = this.rng(((i + 1) * 91347) | 0);
                const items = [];
                const count = 1 + Math.floor(lrand() * 3);
                for (let k = 0; k < count; k++) {
                    const variant = lrand();
                    items.push({
                        offsetK: (k + 0.5) / count,
                        type: variant < 0.4 ? 'sheet' : (variant < 0.7 ? 'futon' : 'shirt'),
                        col: variant < 0.4 ? '#f0f0e8' : (variant < 0.7 ? '#d8a8a8' : '#a8c8d8'),
                        phase: lrand() * Math.PI * 2,
                    });
                }
                hs.laundry = items;
            }

            // Rod (always present — it's a fixed balcony fixture).
            c.strokeStyle = 'rgba(80, 70, 60, 0.9)';
            c.lineWidth = 0.7;
            c.beginPath();
            c.moveTo(bxx + 1, byy - 1);
            c.lineTo(bxx + bww - 1, byy - 1);
            c.stroke();

            // Items — only hung during daylight; residents bring laundry in
            // before dusk. Skip night/evening entirely.
            const cycle = this.sky ? this.sky.cycle : 0.5;
            const laundryOut = cycle > 0.34 && cycle < 0.70 && this.night < 0.15;
            if (!laundryOut) return;
            for (const it of hs.laundry) {
                const lx = bxx + (bww - 4) * it.offsetK + 2;
                const sway = Math.sin(t * 0.0009 + it.phase) * (0.6 + this.wind * 0.8 + this.windGust * 0.4);
                const ly = byy - 1;
                if (it.type === 'sheet') {
                    const w0 = bww * 0.18;
                    const h0 = byy - bodyY - 3;
                    c.fillStyle = it.col;
                    c.beginPath();
                    c.moveTo(lx - w0 * 0.5, ly);
                    c.lineTo(lx + w0 * 0.5, ly);
                    c.lineTo(lx + w0 * 0.5 + sway, ly + h0 * 0.6);
                    c.lineTo(lx - w0 * 0.5 + sway, ly + h0 * 0.6);
                    c.closePath();
                    c.fill();
                } else if (it.type === 'futon') {
                    const w0 = bww * 0.32;
                    const h0 = byy - bodyY - 4;
                    c.fillStyle = it.col;
                    c.beginPath();
                    c.moveTo(lx - w0 * 0.5, ly);
                    c.lineTo(lx + w0 * 0.5, ly);
                    c.lineTo(lx + w0 * 0.5 + sway * 0.7, ly + h0 * 0.55);
                    c.lineTo(lx - w0 * 0.5 + sway * 0.7, ly + h0 * 0.55);
                    c.closePath();
                    c.fill();
                    // Stripe
                    c.fillStyle = this.mixColor(it.col, '#000', 0.25);
                    c.fillRect(lx - w0 * 0.5, ly + (h0 * 0.55) * 0.3, w0, 1.5);
                } else {
                    const w0 = bww * 0.12;
                    const h0 = byy - bodyY - 4;
                    c.fillStyle = it.col;
                    c.beginPath();
                    c.moveTo(lx - w0 * 0.5, ly);
                    c.lineTo(lx + w0 * 0.5, ly);
                    c.lineTo(lx + w0 * 0.5 + sway * 0.5, ly + h0 * 0.45);
                    c.lineTo(lx - w0 * 0.5 + sway * 0.5, ly + h0 * 0.45);
                    c.closePath();
                    c.fill();
                }
            }
        }

        // -----------------------------------------------------------
        // Yard furniture (gate, plant pot, mailbox)
        // -----------------------------------------------------------

        drawHouseGate(hs, hx, hw, baseY) {
            const c = this.ctx;
            c.strokeStyle = 'rgba(190, 188, 182, 0.85)';
            c.lineWidth = 0.8;
            const gy0 = baseY - 8;
            const gw = Math.max(8, hw * 0.4);
            const gx0 = hx + hw * 0.5 - gw * 0.5;
            c.beginPath();
            c.moveTo(gx0, gy0); c.lineTo(gx0 + gw, gy0);
            c.stroke();
            c.beginPath();
            c.moveTo(gx0, gy0 - 3); c.lineTo(gx0 + gw, gy0 - 3);
            c.stroke();
            for (let k = 0; k <= 6; k++) {
                const gx = gx0 + (gw / 6) * k;
                c.beginPath();
                c.moveTo(gx, gy0 - 3); c.lineTo(gx, baseY);
                c.stroke();
            }
            // Gate posts.
            c.strokeStyle = 'rgba(120, 116, 110, 0.95)';
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(gx0, gy0 - 5); c.lineTo(gx0, baseY);
            c.moveTo(gx0 + gw, gy0 - 5); c.lineTo(gx0 + gw, baseY);
            c.stroke();
        }

        drawPlantPot(hs, hx, hw, baseY) {
            const c = this.ctx;
            const px = hs.archetype === 'shophouse' ? hx + hw * 0.85 : hx + hw * 0.07;
            const py = baseY - 1;
            if (hs.plantType === 'bonsai') {
                // Brown pot.
                c.fillStyle = '#7a4a30';
                c.fillRect(px - 3, py - 3, 6, 3);
                // Trunk.
                c.strokeStyle = '#3a2418';
                c.lineWidth = 1;
                c.beginPath();
                c.moveTo(px, py - 3); c.lineTo(px - 1, py - 7);
                c.stroke();
                // Foliage clusters.
                c.fillStyle = '#4a6a3a';
                c.beginPath(); c.arc(px - 2, py - 8, 2, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(px + 1, py - 9, 2.2, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(px + 3, py - 7, 1.8, 0, Math.PI * 2); c.fill();
            } else if (hs.plantType === 'bush') {
                // Hydrangea bush.
                c.fillStyle = '#3a2418';
                c.fillRect(px - 4, py - 3, 8, 3);
                c.fillStyle = '#4a6a3a';
                c.beginPath();
                c.ellipse(px, py - 6, 5, 4, 0, 0, Math.PI * 2);
                c.fill();
                // Pink/blue flower clusters — soil acidity, fixed per garden.
                if (hs.hydrangeaPink == null) hs.hydrangeaPink = Math.random() < 0.5;
                c.fillStyle = hs.hydrangeaPink ? 'rgba(220, 160, 200, 0.85)' : 'rgba(150, 180, 220, 0.85)';
                c.beginPath(); c.arc(px - 2, py - 7, 1.6, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(px + 1.5, py - 8, 1.8, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(px + 3, py - 6, 1.4, 0, Math.PI * 2); c.fill();
            } else {
                // Generic potted plant.
                c.fillStyle = '#5a4030';
                c.beginPath();
                c.moveTo(px - 3, py - 4);
                c.lineTo(px + 3, py - 4);
                c.lineTo(px + 2.4, py);
                c.lineTo(px - 2.4, py);
                c.closePath();
                c.fill();
                c.strokeStyle = '#7aaa50';
                c.lineWidth = 0.9;
                for (let k = -2; k <= 2; k++) {
                    c.beginPath();
                    c.moveTo(px + k * 0.6, py - 4);
                    c.lineTo(px + k * 1.6, py - 8 - Math.abs(k) * 0.5);
                    c.stroke();
                }
            }
        }

        drawMailbox(hs, hx, hw, baseY) {
            const c = this.ctx;
            const mx = hs.archetype === 'shophouse' ? hx + hw * 0.92 : hx + hw * 0.42;
            const my = baseY - 4;
            // Post.
            c.fillStyle = '#3a3530';
            c.fillRect(mx - 0.4, my, 0.8, 4);
            // Box.
            c.fillStyle = '#2a2520';
            c.fillRect(mx - 2.5, my - 5, 5, 5);
            // Mail slot.
            c.fillStyle = '#0a0908';
            c.fillRect(mx - 1.8, my - 3.5, 3.6, 0.6);
            // Reflector.
            c.fillStyle = '#c83830';
            c.fillRect(mx + 1.8, my - 5, 0.7, 0.7);
        }

        // -----------------------------------------------------------
        // Machiya roof (steep narrow hip-and-gable)
        // -----------------------------------------------------------

        drawMachiyaRoof(hs, hx, hw, eaveY, roofH, apexX, roofY) {
            const c = this.ctx;
            const eaveOverhang = Math.max(6, hw * 0.14);
            const apexY = roofY - roofH * 0.05;
            c.fillStyle = hs.roofCol;
            c.beginPath();
            c.moveTo(hx - eaveOverhang, eaveY - 1);
            c.lineTo(apexX - hw * 0.08, apexY);
            c.lineTo(apexX + hw * 0.08, apexY);
            c.lineTo(hx + hw + eaveOverhang, eaveY - 1);
            c.lineTo(hx + hw, eaveY);
            c.lineTo(hx, eaveY);
            c.closePath();
            c.fill();
            // Side shading.
            c.fillStyle = 'rgba(0, 0, 0, 0.22)';
            c.beginPath();
            c.moveTo(apexX, apexY);
            c.lineTo(apexX + hw * 0.08, apexY);
            c.lineTo(hx + hw + eaveOverhang, eaveY - 1);
            c.lineTo(hx + hw, eaveY);
            c.lineTo(apexX, eaveY);
            c.closePath();
            c.fill();
            // Ridge cap.
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.50);
            c.fillRect(apexX - hw * 0.10, apexY - 1, hw * 0.20, 2.6);
            // Onigawara on ridge ends.
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.65);
            c.beginPath();
            c.arc(apexX - hw * 0.10, apexY - 0.5, 2.4, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(apexX + hw * 0.10, apexY - 0.5, 2.4, 0, Math.PI * 2);
            c.fill();
            // Tile rows.
            this.drawKawaraTileRows(hs, apexX, apexY, eaveY, hw, eaveOverhang, roofH);
            // Hisashi (small awning) over door.
            const ax = hx + hw * 0.20 - 3;
            const ay = eaveY + (this.fgRowY - eaveY) * 0.50;
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.35);
            c.beginPath();
            c.moveTo(ax, ay);
            c.lineTo(ax + 15, ay);
            c.lineTo(ax + 13, ay + 2);
            c.lineTo(ax + 2, ay + 2);
            c.closePath();
            c.fill();
        }

        // -----------------------------------------------------------
        // Apartment block (2-3 floor concrete)
        // -----------------------------------------------------------

        drawApartment(hs, idx, hx, hw, hh, bodyY, baseY, t, dt) {
            const c = this.ctx;
            const floors = hs.apartmentFloors || 3;
            // Body.
            c.fillStyle = hs.bodyCol;
            c.fillRect(hx, bodyY, hw, hh);
            // Per-floor band.
            const floorH = hh / floors;
            c.fillStyle = this.mixColor(hs.bodyCol, '#000', 0.18);
            for (let f = 1; f < floors; f++) {
                c.fillRect(hx, bodyY + floorH * f - 0.6, hw, 1.2);
            }
            // Flat roof with parapet.
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.15);
            c.fillRect(hx - 1, bodyY - 3, hw + 2, 3);
            c.fillStyle = this.mixColor(hs.roofCol, '#000', 0.40);
            c.fillRect(hx - 1, bodyY - 1, hw + 2, 1);
            // Rooftop water tank (small box).
            c.fillStyle = '#bcb6ae';
            const tx = hx + hw * 0.65;
            c.fillRect(tx, bodyY - 9, 8, 6);
            c.strokeStyle = 'rgba(40, 35, 30, 0.6)';
            c.lineWidth = 0.4;
            c.strokeRect(tx, bodyY - 9, 8, 6);
            // Foundation.
            c.fillStyle = '#7a7670';
            c.fillRect(hx, baseY - 4, hw, 4);
            c.fillStyle = 'rgba(20, 14, 10, 0.4)';
            c.fillRect(hx, baseY - 5, hw, 1);
            // Outdoor open-corridor balcony per floor.
            const lampOn = this.lampOn();
            const lit = hs.windowLit && lampOn > 0.05;
            // Lazy-init the per-unit occupancy mask so each apartment has a
            // unique (random) pattern of lit windows instead of a uniform grid.
            if (!hs.apartmentUnits) {
                const arand = this.rng(((idx + 1) * 71317) | 0);
                hs.apartmentUnits = [];
                const unitsPerFloor = Math.max(2, Math.floor(hw / 14));
                for (let f = 0; f < floors; f++) {
                    const row = [];
                    for (let u = 0; u < unitsPerFloor; u++) {
                        row.push({ occupied: arand() > 0.35 });
                    }
                    hs.apartmentUnits.push(row);
                }
            }
            for (let f = 0; f < floors; f++) {
                const fy = bodyY + floorH * f;
                // Balcony railing.
                c.fillStyle = 'rgba(40, 35, 30, 0.55)';
                c.fillRect(hx, fy + floorH * 0.55, hw, 1.5);
                c.strokeStyle = 'rgba(40, 35, 30, 0.6)';
                c.lineWidth = 0.5;
                for (let k = 0; k <= 8; k++) {
                    const rx = hx + (hw / 8) * k;
                    c.beginPath();
                    c.moveTo(rx, fy + floorH * 0.56);
                    c.lineTo(rx, fy + floorH * 0.78);
                    c.stroke();
                }
                // Unit doors and windows (2-3 units per floor).
                const units = Math.max(2, Math.floor(hw / 14));
                for (let u = 0; u < units; u++) {
                    const ux = hx + (hw / units) * u + 1.5;
                    const uw = (hw / units) - 3;
                    // Door.
                    c.fillStyle = '#3a2820';
                    c.fillRect(ux + uw * 0.05, fy + floorH * 0.20, uw * 0.30, floorH * 0.36);
                    // Window — random per-unit occupancy.
                    const unit = (hs.apartmentUnits[f] && hs.apartmentUnits[f][u]) || { occupied: true };
                    const winLit = lit && unit.occupied;
                    c.fillStyle = winLit ? `rgba(255, 200, 110, ${0.7 * lampOn})` : '#1a1410';
                    c.fillRect(ux + uw * 0.40, fy + floorH * 0.22, uw * 0.50, floorH * 0.30);
                    // Window frame divider.
                    c.strokeStyle = 'rgba(20, 14, 10, 0.55)';
                    c.lineWidth = 0.5;
                    c.beginPath();
                    c.moveTo(ux + uw * 0.65, fy + floorH * 0.22);
                    c.lineTo(ux + uw * 0.65, fy + floorH * 0.52);
                    c.stroke();
                }
            }
            // External staircase silhouette on the right.
            c.fillStyle = 'rgba(20, 16, 12, 0.45)';
            c.fillRect(hx + hw - 3, bodyY, 3, hh);
            c.strokeStyle = 'rgba(60, 55, 48, 0.85)';
            c.lineWidth = 0.4;
            for (let s = 0; s < floors * 4; s++) {
                const sy = bodyY + (hh / (floors * 4)) * s;
                c.beginPath();
                c.moveTo(hx + hw - 3, sy); c.lineTo(hx + hw, sy);
                c.stroke();
            }
        }

        // -----------------------------------------------------------
        // Birds
        // -----------------------------------------------------------

        drawBirds(t, dt) {
            // Lightweight distant birds layer (kept simple — crows are separate).
            if (!this.birds) {
                this.birds = [];
                const brand = this.rng(112233);
                for (let i = 0; i < 5; i++) {
                    this.birds.push({
                        x: brand(),
                        y: 0.10 + brand() * 0.22,
                        speed: 0.012 + brand() * 0.016,
                        size: 1.2 + brand() * 1.0,
                        phase: brand() * Math.PI * 2,
                    });
                }
            }
            if (this.night > 0.6) return;
            const c = this.ctx;
            const w = this.width, h = this.height;
            c.strokeStyle = `rgba(60, 40, 50, ${0.55 * (1 - this.night)})`;
            c.lineWidth = 1;
            for (let i = 0; i < this.birds.length; i++) {
                const b = this.birds[i];
                b.x = (b.x + b.speed * (dt / 1000)) % 1.1;
                if (b.x > 1.05) b.x -= 1.1;
                const bx = b.x * w;
                const by = b.y * h + Math.sin(t * 0.0015 + b.phase) * 4;
                const flap = Math.sin(t * 0.008 + b.phase) * 0.5 + 1;
                const s = b.size;
                c.beginPath();
                c.moveTo(bx - s * 3, by);
                c.quadraticCurveTo(bx - s * 1.5, by - s * flap, bx, by);
                c.quadraticCurveTo(bx + s * 1.5, by - s * flap, bx + s * 3, by);
                c.stroke();
            }
        }

        // -----------------------------------------------------------
        // Crows
        // -----------------------------------------------------------

        drawCrows(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const pts = this._polePts || this.polePoints();
            for (let i = 0; i < this.crows.length; i++) {
                const cr = this.crows[i];
                if (cr.state === 'perched') {
                    cr.nextHopT -= dt;
                    if (cr.nextHopT <= 0 && this.night < 0.5) {
                        // Start flight: pick a new perch different from current.
                        const newPerch = this.pickCrowPerch(this.rng(((t | 0) + i * 137) | 0), Math.floor(Math.random() * 3));
                        cr.targetPerch = newPerch;
                        cr.state = 'flying';
                        cr.flightT = 0;
                        const from = this.crowPerchXY(cr.perch, pts);
                        const to = this.crowPerchXY(newPerch, pts);
                        cr.flightFromX = from.x;
                        cr.flightFromY = from.y;
                        cr.flightToX = to.x;
                        cr.flightToY = to.y;
                        cr.flightDir = Math.sign(to.x - from.x) || 1;
                    } else {
                        cr.headTilt += (Math.random() - 0.5) * 0.02;
                        const at = this.crowPerchXY(cr.perch, pts);
                        this.drawCrowPerched(at.x, at.y, cr.headTilt, t, i);
                    }
                } else if (cr.state === 'flying') {
                    cr.flightT += dt;
                    const dur = 1800;
                    const kLin = this.clamp(cr.flightT / dur, 0, 1);
                    // Smoothstep easing: the crow accelerates off the perch
                    // and decelerates into the landing instead of snapping.
                    const k = kLin * kLin * (3 - 2 * kLin);
                    const arc = Math.sin(k * Math.PI) * 30 * this.as;
                    const fx = cr.flightFromX + (cr.flightToX - cr.flightFromX) * k;
                    const fy = cr.flightFromY + (cr.flightToY - cr.flightFromY) * k - arc;
                    // Wings fold as it settles on the wire (last ~20%).
                    const flapAmp = kLin > 0.8 ? this.clamp((1 - kLin) / 0.2, 0, 1) : 1;
                    this.drawCrowFlying(fx, fy, cr.flightDir, t, i, flapAmp);
                    if (kLin >= 1) {
                        cr.perch = cr.targetPerch;
                        cr.state = 'perched';
                        cr.nextHopT = CONFIG.CROW_HOP_INTERVAL_MIN + Math.random() * (CONFIG.CROW_HOP_INTERVAL_MAX - CONFIG.CROW_HOP_INTERVAL_MIN);
                    }
                }
            }
        }

        crowPerchXY(perch, pts) {
            const w = this.width;
            if (perch.kind === 'wire') {
                const a = pts[this.clamp(perch.poleA, 0, pts.length - 1)];
                const b = pts[this.clamp(perch.poleB, 0, pts.length - 1)];
                const t = perch.sideT;
                const yOff = 24 + perch.wire * 5;
                const mx = (a.x + b.x) / 2;
                const my = (a.top + b.top) / 2 + yOff + 14;
                // Quadratic Bezier midpoint at parameter t.
                const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
                const y = (1 - t) * (1 - t) * (a.top + yOff) + 2 * (1 - t) * t * my + t * t * (b.top + yOff);
                return { x, y };
            }
            // roof
            const idx = this.clamp(perch.houseIdx, 0, this.houses.length - 1);
            const hs = this.houses[idx];
            const hx = hs.x * w + hs.w * w * 0.5;
            const hy = this.fgRowY - hs.h * this.height - 3;
            return { x: hx, y: hy };
        }

        drawCrowPerched(x, y, headTilt, t, i) {
            const c = this.ctx;
            c.save();
            c.translate(x, y);
            c.scale(this.as, this.as);
            c.fillStyle = '#0a080c';
            // Body (oval)
            c.beginPath();
            c.ellipse(0, 0, 5, 3, 0, 0, Math.PI * 2);
            c.fill();
            // Tail
            c.beginPath();
            c.moveTo(4, -1);
            c.lineTo(10, 1);
            c.lineTo(4, 1);
            c.closePath();
            c.fill();
            // Head
            c.beginPath();
            c.arc(-4, -3, 2.4, 0, Math.PI * 2);
            c.fill();
            // Beak
            c.beginPath();
            c.moveTo(-6, -3 + Math.sin(headTilt) * 0.4);
            c.lineTo(-9, -2.5);
            c.lineTo(-6, -2);
            c.closePath();
            c.fill();
            // Eye glint
            if (this.night < 0.6) {
                c.fillStyle = '#dcdcd2';
                c.fillRect(-4.5, -3.5, 0.6, 0.6);
            }
            // Legs
            c.strokeStyle = '#0a080c';
            c.lineWidth = 0.6;
            c.beginPath();
            c.moveTo(-1, 2); c.lineTo(-1, 5);
            c.moveTo(1, 2); c.lineTo(1, 5);
            c.stroke();
            c.restore();
        }

        drawCrowFlying(x, y, dir, t, i, flapAmp = 1) {
            const c = this.ctx;
            c.save();
            c.translate(x, y);
            // Sprite native orientation has head/beak on the LEFT; flip so
            // the head leads the flight direction.
            c.scale(-dir * this.as, this.as);
            c.fillStyle = '#0a080c';
            // Body
            c.beginPath();
            c.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
            c.fill();
            // Head
            c.beginPath();
            c.arc(-5, -1, 2.4, 0, Math.PI * 2);
            c.fill();
            // Beak
            c.beginPath();
            c.moveTo(-7, -1); c.lineTo(-10, -0.5); c.lineTo(-7, 0);
            c.closePath(); c.fill();
            // Wings — flapping (amplitude folds toward 0 on landing)
            const flap = Math.sin(t * 0.018 + i) * 0.7 * flapAmp;
            c.beginPath();
            c.moveTo(-3, -1);
            c.quadraticCurveTo(-1, -8 + flap * 5, 4, -3 + flap * 3);
            c.lineTo(2, -1);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(-3, 0);
            c.quadraticCurveTo(-1, 6 - flap * 5, 4, 2 - flap * 3);
            c.lineTo(2, 0);
            c.closePath();
            c.fill();
            // Tail
            c.beginPath();
            c.moveTo(4, 0); c.lineTo(9, -1); c.lineTo(9, 1);
            c.closePath(); c.fill();
            c.restore();
        }

        // -----------------------------------------------------------
        // Road & furniture
        // -----------------------------------------------------------

        drawRoad(t) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            // Asphalt gradient
            const grad = c.createLinearGradient(0, this.roadY, 0, this.paddyY);
            grad.addColorStop(0, '#2a241f');
            grad.addColorStop(1, '#1a1614');
            c.fillStyle = grad;
            c.fillRect(0, this.roadY, w, this.paddyY - this.roadY);
            // Curb
            c.strokeStyle = 'rgba(20, 15, 12, 0.9)';
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(0, this.roadY);
            c.lineTo(w, this.roadY);
            c.stroke();
            // White shoulder line (top)
            c.strokeStyle = `rgba(220, 215, 200, ${0.6 - this.night * 0.3})`;
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(0, this.roadY + 3);
            c.lineTo(w, this.roadY + 3);
            c.stroke();
            // Dashed centerline
            c.setLineDash([10, 16]);
            c.lineWidth = 1.2;
            c.strokeStyle = `rgba(220, 215, 200, ${0.35 - this.night * 0.2})`;
            const cy = this.roadY + (this.paddyY - this.roadY) * 0.55;
            c.beginPath();
            c.moveTo(0, cy);
            c.lineTo(w, cy);
            c.stroke();
            c.setLineDash([]);
            // Manhole cover.
            const mx = w * 0.62, my = this.roadY + (this.paddyY - this.roadY) * 0.45;
            c.fillStyle = '#0e0c0a';
            c.beginPath();
            c.ellipse(mx, my, 11, 3.2, 0, 0, Math.PI * 2);
            c.fill();
            c.strokeStyle = 'rgba(120, 110, 100, 0.5)';
            c.lineWidth = 0.5;
            c.beginPath();
            c.moveTo(mx - 8, my); c.lineTo(mx + 8, my);
            c.moveTo(mx, my - 2.5); c.lineTo(mx, my + 2.5);
            c.stroke();
            // Wet sheen at dawn/dusk.
            if ((this.sky.cycle > 0.20 && this.sky.cycle < 0.35) || (this.sky.cycle > 0.74 && this.sky.cycle < 0.88)) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                const sheen = c.createLinearGradient(0, this.roadY, 0, this.paddyY);
                sheen.addColorStop(0, 'rgba(255, 200, 160, 0)');
                sheen.addColorStop(0.5, `rgba(255, 200, 160, ${0.07})`);
                sheen.addColorStop(1, 'rgba(255, 200, 160, 0)');
                c.fillStyle = sheen;
                c.fillRect(0, this.roadY, w, this.paddyY - this.roadY);
                c.restore();
            }
            // Embankment between road and paddy.
            c.fillStyle = '#3a2a1c';
            c.fillRect(0, this.paddyY - 4, w, 4);
            c.fillStyle = '#251810';
            c.fillRect(0, this.paddyY - 1, w, 1);
        }

        drawRoadFurniture(t) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            // Streetlight at x=0.32 on the curb.
            const lx = w * 0.32;
            const ly = this.roadY;
            c.fillStyle = '#3a3530';
            c.fillRect(lx - 1.2, ly - 60, 2.4, 60);
            // Curved arm
            c.strokeStyle = '#3a3530';
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(lx, ly - 60);
            c.quadraticCurveTo(lx - 8, ly - 64, lx - 14, ly - 60);
            c.stroke();
            // Lamp head
            c.fillStyle = '#2a2520';
            c.beginPath();
            c.ellipse(lx - 16, ly - 58, 4, 2, 0, 0, Math.PI * 2);
            c.fill();
            // Lamp ON
            const lampOn = this.lampOn();
            if (lampOn > 0.05) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                // Light cone onto road
                const grad = c.createLinearGradient(lx - 16, ly - 58, lx - 16, this.paddyY);
                grad.addColorStop(0, `rgba(255, 220, 140, ${0.45 * lampOn})`);
                grad.addColorStop(1, 'rgba(255, 220, 140, 0)');
                c.fillStyle = grad;
                c.beginPath();
                c.moveTo(lx - 16, ly - 58);
                c.lineTo(lx - 30, this.paddyY);
                c.lineTo(lx, this.paddyY);
                c.closePath();
                c.fill();
                // Bulb glow
                const halo = c.createRadialGradient(lx - 16, ly - 58, 1, lx - 16, ly - 58, 16);
                halo.addColorStop(0, `rgba(255, 220, 140, ${0.9 * lampOn})`);
                halo.addColorStop(1, `rgba(255, 220, 140, 0)`);
                c.fillStyle = halo;
                c.beginPath();
                c.arc(lx - 16, ly - 58, 16, 0, Math.PI * 2);
                c.fill();
                c.restore();
                // Moths (2 orbiting)
                if (this.night > 0.6) {
                    for (let k = 0; k < 2; k++) {
                        const ang = t * 0.003 + k * Math.PI;
                        const ox = lx - 16 + Math.cos(ang) * 7;
                        const oy = ly - 58 + Math.sin(ang * 1.7) * 3;
                        c.fillStyle = 'rgba(220, 200, 160, 0.7)';
                        c.fillRect(ox - 0.7, oy - 0.5, 1.4, 1);
                    }
                }
            }
            // Stop sign 止まれ (inverted red triangle) at far corner.
            const sx = w * 0.06;
            const sy = this.roadY - 28;
            c.fillStyle = '#3a3530';
            c.fillRect(sx - 0.6, sy + 14, 1.2, 16);
            c.fillStyle = '#c8312a';
            c.beginPath();
            c.moveTo(sx - 9, sy);
            c.lineTo(sx + 9, sy);
            c.lineTo(sx, sy + 14);
            c.closePath();
            c.fill();
            c.strokeStyle = '#f0f0e8';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(sx - 8, sy + 1);
            c.lineTo(sx + 8, sy + 1);
            c.lineTo(sx, sy + 13);
            c.closePath();
            c.stroke();
            c.fillStyle = '#f0f0e8';
            c.font = 'bold 3px sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('止', sx, sy + 7);

            // Vending machine row (3 jihanki side by side at x≈0.86-0.94).
            this.drawVendingMachine(w * 0.86, this.roadY - 2, 0);
            this.drawVendingMachine(w * 0.88 + 18, this.roadY - 2, 1);
            this.drawVendingMachine(w * 0.88 + 36, this.roadY - 2, 2);

            // Traffic mirror (convex caa-mirror) at the corner.
            this.drawTrafficMirror(w * 0.12, this.roadY - 2);

            // Gomi station (trash collection netted mound).
            this.drawGomiStation(w * 0.48, this.roadY + (this.paddyY - this.roadY) * 0.92);

            // Drainage grate (sokko) along curb.
            this.drawDrainageGrate(w * 0.22, this.roadY + 1);
            this.drawDrainageGrate(w * 0.76, this.roadY + 1);
        }

        drawTrafficMirror(x, baseY) {
            const c = this.ctx;
            // Pole.
            c.fillStyle = '#3a3530';
            c.fillRect(x - 0.7, baseY - 36, 1.4, 36);
            // Bracket.
            c.strokeStyle = '#3a3530';
            c.lineWidth = 0.8;
            c.beginPath();
            c.moveTo(x, baseY - 36); c.lineTo(x - 6, baseY - 40);
            c.stroke();
            // Mirror back (orange).
            c.fillStyle = '#dc6c1c';
            c.beginPath();
            c.ellipse(x - 8, baseY - 41, 6, 5.5, 0, 0, Math.PI * 2);
            c.fill();
            c.strokeStyle = '#3a2418';
            c.lineWidth = 0.6;
            c.stroke();
            // Mirror surface (convex reflection — gradient of sky).
            const skyMix = this.mixColor(this.sky.horizon, this.sky.top, 0.4);
            const mirGrad = c.createRadialGradient(x - 9, baseY - 42, 0, x - 8, baseY - 41, 5);
            mirGrad.addColorStop(0, this.mixColor(skyMix, '#ffffff', 0.4));
            mirGrad.addColorStop(0.7, skyMix);
            mirGrad.addColorStop(1, this.mixColor(skyMix, '#000', 0.20));
            c.fillStyle = mirGrad;
            c.beginPath();
            c.ellipse(x - 8, baseY - 41, 5, 4.5, 0, 0, Math.PI * 2);
            c.fill();
            // Tiny silhouette of a power pole reflected in the mirror.
            c.fillStyle = `rgba(20, 14, 10, 0.45)`;
            c.fillRect(x - 8, baseY - 43, 0.5, 4);
        }

        drawGomiStation(x, baseY) {
            const c = this.ctx;
            // Concrete pad.
            c.fillStyle = '#7a7670';
            c.fillRect(x - 14, baseY - 2, 28, 2);
            // Trash bag mound (light grey).
            c.fillStyle = '#c8c4bc';
            c.beginPath();
            c.ellipse(x, baseY - 5, 12, 4.5, 0, Math.PI, 0);
            c.fill();
            c.fillStyle = '#e8e4dc';
            c.beginPath();
            c.ellipse(x - 4, baseY - 6, 4, 3, 0, Math.PI, 0);
            c.fill();
            c.beginPath();
            c.ellipse(x + 4, baseY - 5.5, 3.5, 2.5, 0, Math.PI, 0);
            c.fill();
            // Green protective net (cross-hatched).
            c.strokeStyle = 'rgba(60, 110, 70, 0.85)';
            c.lineWidth = 0.5;
            for (let k = 0; k < 6; k++) {
                const ky = baseY - 1 - k * 1.5;
                c.beginPath();
                c.moveTo(x - 13 + k * 0.3, ky);
                c.lineTo(x + 13 - k * 0.3, ky);
                c.stroke();
            }
            for (let k = -6; k <= 6; k++) {
                c.beginPath();
                c.moveTo(x + k * 2.2, baseY - 1);
                c.lineTo(x + k * 1.0, baseY - 10);
                c.stroke();
            }
            // Yellow weighted edge (warning chain).
            c.fillStyle = '#dcc466';
            c.fillRect(x - 14, baseY - 1.5, 28, 1);
        }

        drawDrainageGrate(x, baseY) {
            const c = this.ctx;
            // Recess in road.
            c.fillStyle = '#0e0c0a';
            c.fillRect(x - 8, baseY, 16, 3);
            // Grate bars.
            c.strokeStyle = '#3a3530';
            c.lineWidth = 0.5;
            for (let k = 0; k < 8; k++) {
                const gx = x - 7 + k * 2;
                c.beginPath();
                c.moveTo(gx, baseY + 0.5);
                c.lineTo(gx, baseY + 2.5);
                c.stroke();
            }
            // Highlight edge.
            c.strokeStyle = 'rgba(160, 150, 140, 0.5)';
            c.lineWidth = 0.4;
            c.beginPath();
            c.moveTo(x - 8, baseY); c.lineTo(x + 8, baseY);
            c.stroke();
        }

        drawVendingMachine(x, baseY, variant) {
            const c = this.ctx;
            const ww = 16, hh = 30;
            const bx = x - ww * 0.5;
            const by = baseY - hh;
            // Cabinet variants: 0 = red Coca-Cola, 1 = blue Pocari, 2 = white DyDo coffee, 3 = green tea.
            const palette = variant === 1
                ? { body: '#dadce0', header: '#2462b8', glow: '#7eb0ff' }
                : variant === 2
                ? { body: '#f0ece4', header: '#a83a3a', glow: '#ffc080' }
                : variant === 3
                ? { body: '#dadccc', header: '#3a7a48', glow: '#a8d088' }
                : { body: '#dcdcd2', header: '#c83a3a', glow: '#ff8a78' };
            // Side shadow + base.
            c.fillStyle = 'rgba(20, 14, 10, 0.45)';
            c.fillRect(bx - 0.5, baseY - 1, ww + 1, 2);
            // Cabinet body.
            c.fillStyle = palette.body;
            c.fillRect(bx, by, ww, hh);
            c.strokeStyle = '#3a3530';
            c.lineWidth = 0.6;
            c.strokeRect(bx, by, ww, hh);
            // Top header strip with brand colour.
            c.fillStyle = palette.header;
            c.fillRect(bx, by, ww, 4.5);
            // Brand text.
            c.fillStyle = '#f0ece0';
            c.font = 'bold 2.5px sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            const brand = variant === 1 ? 'POCARI' : (variant === 2 ? 'DyDo' : (variant === 3 ? 'OCHA' : 'COKE'));
            c.fillText(brand, x, by + 2.4);
            // Display windows (3 rows of bottles).
            const colors = ['#3a8c5a', '#c83a3a', '#3a5cc8', '#dcb83a', '#f0ece0', '#888'];
            for (let row = 0; row < 3; row++) {
                const rowY = by + 6 + row * 7;
                c.fillStyle = '#1a1814';
                c.fillRect(bx + 1, rowY, ww - 2, 6);
                for (let k = 0; k < 4; k++) {
                    c.fillStyle = colors[(row * 4 + k + variant) % colors.length];
                    c.fillRect(bx + 1.5 + k * 3.3, rowY + 1, 2.4, 4);
                    // Cap.
                    c.fillStyle = 'rgba(255, 255, 255, 0.4)';
                    c.fillRect(bx + 1.5 + k * 3.3, rowY + 1, 2.4, 0.6);
                }
            }
            // Hot/cold labels.
            c.fillStyle = '#dc3030';
            c.fillRect(bx + 1, by + 27, 2.5, 1.2);
            c.fillStyle = '#3070c8';
            c.fillRect(bx + 4.5, by + 27, 2.5, 1.2);
            // Coin slot strip / return tray.
            c.fillStyle = '#3a3530';
            c.fillRect(bx + 1, by + hh - 3, ww - 2, 2.5);
            // Return-tray opening.
            c.fillStyle = '#0a0908';
            c.fillRect(bx + 2, by + hh - 2.5, ww - 4, 1.2);
            // Glow at night.
            const lampOn = this.lampOn();
            if (lampOn > 0.1) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                const glowRgb = this.hexToRgb(palette.glow);
                const halo = c.createRadialGradient(x, by + hh * 0.5, 4, x, by + hh * 0.5, 32);
                halo.addColorStop(0, this.rgba(glowRgb.r, glowRgb.g, glowRgb.b, 0.35 * lampOn));
                halo.addColorStop(1, this.rgba(glowRgb.r, glowRgb.g, glowRgb.b, 0));
                c.fillStyle = halo;
                c.beginPath();
                c.arc(x, by + hh * 0.5, 32, 0, Math.PI * 2);
                c.fill();
                c.restore();
                // Lit display panels brighter.
                c.fillStyle = `rgba(255, 250, 230, ${0.18 * lampOn})`;
                for (let row = 0; row < 3; row++) {
                    c.fillRect(bx + 1, by + 6 + row * 7, ww - 2, 6);
                }
            }
        }

        // -----------------------------------------------------------
        // Kei truck
        // -----------------------------------------------------------

        drawKeiTruck(t, dt) {
            if (!this.keiTruck) {
                this.nextKeiTruckMs -= dt;
                if (this.nextKeiTruckMs <= 0) {
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    this.keiTruck = {
                        x: dir > 0 ? -90 : this.width + 90,
                        dir,
                        speed: 110 + Math.random() * 40,
                        bounce: 0,
                    };
                    this.nextKeiTruckMs = CONFIG.KEI_INTERVAL_MIN + Math.random() * (CONFIG.KEI_INTERVAL_MAX - CONFIG.KEI_INTERVAL_MIN);
                }
                return;
            }
            // Speed scales with sprite size so motion reads correctly.
            this.keiTruck.x += this.keiTruck.dir * this.keiTruck.speed * this.as * (dt / 1000);
            this.keiTruck.bounce += dt;
            if (this.keiTruck.x < -100 * this.as || this.keiTruck.x > this.width + 100 * this.as) {
                this.keiTruck = null;
                return;
            }
            const c = this.ctx;
            const k = this.keiTruck;
            const y = this.roadY + (this.paddyY - this.roadY) * 0.50;
            const wobble = Math.sin(k.bounce * 0.012) * 0.6;
            c.save();
            c.translate(k.x, y + wobble);
            // Sprite native orientation has the cab (front) on the LEFT;
            // flip so the cab leads in the direction of motion.
            c.scale(-k.dir * this.as, this.as);
            // Body silhouette shadow under truck
            c.fillStyle = 'rgba(10, 8, 6, 0.55)';
            c.fillRect(-26, 8, 56, 2);
            // Cargo bed
            c.fillStyle = '#cfcfc6';
            c.fillRect(-2, -8, 28, 14);
            c.strokeStyle = '#3a3530';
            c.lineWidth = 0.5;
            c.strokeRect(-2, -8, 28, 14);
            // Bed slats
            for (let i = 1; i < 4; i++) {
                const sx = -2 + (28 / 4) * i;
                c.beginPath();
                c.moveTo(sx, -8); c.lineTo(sx, 6);
                c.stroke();
            }
            // Cab
            c.fillStyle = '#f0f0e8';
            c.beginPath();
            c.moveTo(-26, 8);
            c.lineTo(-26, -4);
            c.quadraticCurveTo(-26, -10, -20, -10);
            c.lineTo(-4, -10);
            c.lineTo(-2, -8);
            c.lineTo(-2, 8);
            c.closePath();
            c.fill();
            c.strokeStyle = '#3a3530';
            c.lineWidth = 0.6;
            c.stroke();
            // Cab window
            c.fillStyle = '#3a4a5a';
            c.beginPath();
            c.moveTo(-23, -4);
            c.quadraticCurveTo(-23, -8, -19, -8);
            c.lineTo(-6, -8);
            c.lineTo(-5, -3);
            c.lineTo(-23, -3);
            c.closePath();
            c.fill();
            // Door line
            c.strokeStyle = '#3a3530';
            c.lineWidth = 0.5;
            c.beginPath();
            c.moveTo(-14, -3); c.lineTo(-14, 7);
            c.stroke();
            // Wheels
            c.fillStyle = '#1a1410';
            c.beginPath(); c.arc(-18, 9, 4, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(16, 9, 4, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#6a6660';
            c.beginPath(); c.arc(-18, 9, 1.6, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(16, 9, 1.6, 0, Math.PI * 2); c.fill();
            // License plate
            c.fillStyle = '#f4d860';
            c.fillRect(-4, 4, 6, 3);
            // Headlight at night
            if (this.lampOn() > 0.3) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                const halo = c.createRadialGradient(-26, -2, 1, -26, -2, 22);
                halo.addColorStop(0, `rgba(255, 240, 180, ${0.7 * this.lampOn()})`);
                halo.addColorStop(1, 'rgba(255, 240, 180, 0)');
                c.fillStyle = halo;
                c.beginPath();
                c.arc(-26, -2, 22, 0, Math.PI * 2);
                c.fill();
                c.restore();
                c.fillStyle = '#fff5cc';
                c.fillRect(-27, -3, 1.5, 2);
            }
            // Tail lights
            c.fillStyle = `rgba(200, 50, 40, ${0.7 + this.lampOn() * 0.3})`;
            c.fillRect(25, -3, 1.5, 2);
            c.fillRect(25, 3, 1.5, 2);
            c.restore();
        }

        // -----------------------------------------------------------
        // Cat
        // -----------------------------------------------------------

        drawCat(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            if (!this.cat) {
                this.nextCatMs -= dt;
                if (this.nextCatMs <= 0) {
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    this.cat = {
                        state: Math.random() < 0.35 ? 'sitting' : 'walking',
                        x: dir > 0 ? -0.04 : 1.04,
                        y: 1,
                        dir,
                        stateT: 0,
                        nextChange: 4000 + Math.random() * 9000,
                        gait: 0,
                        // Each cat is a different tabby — pick coat at spawn.
                        coat: Math.random() < 0.45 ? '#3a322a' : (Math.random() < 0.5 ? '#1f1a17' : '#b89a72'),
                    };
                    this.nextCatMs = CONFIG.CAT_INTERVAL_MIN + Math.random() * (CONFIG.CAT_INTERVAL_MAX - CONFIG.CAT_INTERVAL_MIN);
                }
                return;
            }
            const cat = this.cat;
            cat.stateT += dt;
            if (cat.state === 'sitting') {
                cat.nextChange -= dt;
                if (cat.nextChange <= 0) {
                    cat.state = 'walking';
                    // Random walk direction — may turn back, may continue.
                    if (Math.random() < 0.4) cat.dir = -cat.dir;
                    cat.stateT = 0;
                    cat.nextChange = 3000 + Math.random() * 9000;
                }
            } else if (cat.state === 'walking') {
                const speed = 0.015 + Math.random() * 0.001; // slight jitter
                cat.x += speed * cat.dir * this.as * (dt / 1000);
                cat.gait += dt;
                cat.nextChange -= dt;
                // Occasionally pause to sit mid-stroll.
                if (cat.nextChange <= 0 && cat.x > 0.06 && cat.x < 0.94) {
                    cat.state = 'sitting';
                    cat.nextChange = 2500 + Math.random() * 6000;
                }
            }
            // Despawn when fully off-screen on either side.
            if (cat.x < -0.05 || cat.x > 1.05) {
                this.cat = null;
                return;
            }
            const cx = cat.x * w;
            const cy = this.roadY + (this.paddyY - this.roadY) * 0.85;
            c.save();
            c.translate(cx, cy);
            // Sprite is drawn facing LEFT in native form; flip so head leads
            // the movement direction (dir=+1 means moving right → face right).
            c.scale(-cat.dir * this.as, this.as);
            c.fillStyle = cat.coat;
            if (cat.state === 'walking') {
                const gait = Math.sin(cat.gait * 0.012);
                // Body
                c.beginPath();
                c.ellipse(0, -3, 7, 2.4, 0, 0, Math.PI * 2);
                c.fill();
                // Head — slightly smaller and tucked into the front of the body.
                c.beginPath();
                c.arc(-6.6, -3.4, 2.1, 0, Math.PI * 2);
                c.fill();
                // Ears — symmetric pair pointing up from the top of the head.
                c.beginPath();
                c.moveTo(-8.0, -4.6); c.lineTo(-8.4, -6.4); c.lineTo(-7.0, -5.2); c.closePath();
                c.fill();
                c.beginPath();
                c.moveTo(-5.2, -4.6); c.lineTo(-4.8, -6.4); c.lineTo(-6.2, -5.2); c.closePath();
                c.fill();
                // Tail — starts at body's rear edge, curls up and back.
                c.strokeStyle = cat.coat;
                c.lineWidth = 1.6;
                c.lineCap = 'round';
                c.beginPath();
                c.moveTo(6.6, -3);
                c.quadraticCurveTo(10, -6, 8, -9);
                c.stroke();
                // Legs (alternating) — anchor at body underside (y=-1.4).
                c.lineWidth = 1.3;
                c.beginPath();
                c.moveTo(-3, -1.4); c.lineTo(-3 - gait * 1.5, 1);
                c.moveTo(-5, -1.4); c.lineTo(-5 + gait * 1.5, 1);
                c.moveTo(3, -1.4); c.lineTo(3 + gait * 1.5, 1);
                c.moveTo(5, -1.4); c.lineTo(5 - gait * 1.5, 1);
                c.stroke();
            } else {
                // Sitting (haunches tucked, front legs forward).
                c.beginPath();
                c.ellipse(0, -2, 5.5, 3, 0, 0, Math.PI * 2);
                c.fill();
                // Head sits on the front of the body.
                c.beginPath();
                c.arc(-4.6, -3.4, 2.2, 0, Math.PI * 2);
                c.fill();
                // Ears.
                c.beginPath();
                c.moveTo(-6.0, -4.8); c.lineTo(-6.4, -6.6); c.lineTo(-5.0, -5.4); c.closePath();
                c.fill();
                c.beginPath();
                c.moveTo(-3.2, -4.8); c.lineTo(-2.8, -6.6); c.lineTo(-4.2, -5.4); c.closePath();
                c.fill();
                // Front legs visible from the side of a sitting cat.
                c.strokeStyle = cat.coat;
                c.lineCap = 'round';
                c.lineWidth = 1.3;
                c.beginPath();
                c.moveTo(-3, 0); c.lineTo(-3, 1.2);
                c.moveTo(-1.6, 0); c.lineTo(-1.6, 1.2);
                c.stroke();
                // Tail flick (originates from rear of body).
                const flick = Math.sin(t * 0.003 + cat.gait * 0.0005) * 1.8;
                c.lineWidth = 1.6;
                c.beginPath();
                c.moveTo(5, -1.6);
                c.quadraticCurveTo(8.5, -3 + flick, 5.5, -5 + flick * 0.5);
                c.stroke();
            }
            // Eye glint at night — at the actual head position.
            if (this.night > 0.5) {
                const eyeX = cat.state === 'walking' ? -7.0 : -5.0;
                const eyeY = cat.state === 'walking' ? -3.6 : -3.6;
                c.fillStyle = `rgba(255, 240, 160, ${0.7 * this.night})`;
                c.fillRect(eyeX, eyeY, 0.6, 0.6);
            }
            c.restore();
        }

        // -----------------------------------------------------------
        // Paddy + reflection
        // -----------------------------------------------------------

        drawPaddyAndReflection(t) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const paddyTop = this.paddyY;
            const paddyBot = this.paddyBot;

            // Water base — leans harder into the sky color so dawn/dusk
            // visibly reflects in the flooded paddy.
            const water = c.createLinearGradient(0, paddyTop, 0, paddyBot);
            water.addColorStop(0, this.mixColor('#5a6850', this.sky.horizon, 0.42));
            water.addColorStop(0.5, this.mixColor('#3a4a3a', this.sky.horizon, 0.22));
            water.addColorStop(1, this.mixColor('#2a3828', this.sky.horizon, 0.08));
            c.fillStyle = water;
            c.fillRect(0, paddyTop, w, paddyBot - paddyTop);

            // Render reflection to offscreen canvas, then composite with horizontal ripple.
            if (this.reflCtx) {
                const rc = this.reflCtx;
                const rh = this.reflCanvas.height;
                const rw = this.reflCanvas.width;
                // Tint by sky horizon to give a sky-toned reflection.
                rc.fillStyle = this.mixColor(this.sky.horizon, '#000', 0.30);
                rc.fillRect(0, 0, rw, rh);
                // Flipped sky band at top of reflection.
                rc.save();
                rc.globalAlpha = 0.45;
                // Draw a horizontal band that mirrors the sky horizon brightness.
                rc.fillStyle = this.mixColor(this.sky.top, this.sky.horizon, 0.5);
                rc.fillRect(0, 0, rw, rh * 0.5);
                rc.restore();
                // Mirrored Fuji silhouette.
                const fujiCx = w * 0.68;
                rc.save();
                rc.globalAlpha = 0.42;
                rc.fillStyle = this.mixColor('#3a2a40', this.sky.horizon, 0.30);
                rc.beginPath();
                const refTopY = 4;
                rc.moveTo(fujiCx - 110, refTopY);
                rc.quadraticCurveTo(fujiCx - 60, refTopY + 60, fujiCx - 18, refTopY + 78);
                rc.lineTo(fujiCx + 18, refTopY + 78);
                rc.quadraticCurveTo(fujiCx + 60, refTopY + 60, fujiCx + 110, refTopY);
                rc.closePath();
                rc.fill();
                // Snow cap reflection
                rc.fillStyle = 'rgba(248, 232, 240, 0.45)';
                rc.beginPath();
                rc.arc(fujiCx, refTopY + 76, 14, Math.PI, Math.PI * 2);
                rc.fill();
                rc.restore();
                // Mirrored foreground house silhouettes (compact).
                rc.save();
                rc.globalAlpha = 0.35;
                rc.fillStyle = this.mixColor('#2a2620', this.sky.horizon, 0.30);
                for (let i = 0; i < this.houses.length; i += 2) {
                    const hs = this.houses[i];
                    const hx = hs.x * w;
                    const hw = hs.w * w;
                    const hh = hs.h * h;
                    rc.fillRect(hx, rh - (hh * 0.30), hw, hh * 0.30);
                }
                rc.restore();

                // Composite to main canvas with horizontal ripple.
                c.save();
                c.globalAlpha = 0.55;
                const strips = 18;
                const stripH = rh / strips;
                for (let s = 0; s < strips; s++) {
                    const sy = s * stripH;
                    const yWorld = paddyTop + sy;
                    const wobble = Math.sin(t * 0.0009 + s * 0.5) * 1.4;
                    c.drawImage(this.reflCanvas, 0, sy, rw, stripH, wobble, yWorld, w, stripH);
                }
                c.restore();
            }

            // Faint horizontal shimmer.
            c.strokeStyle = `rgba(240, 240, 240, ${0.10 - this.night * 0.07})`;
            c.lineWidth = 1;
            for (let k = 0; k < 4; k++) {
                const y = paddyTop + 8 + k * ((paddyBot - paddyTop - 8) / 4);
                c.beginPath();
                c.moveTo(0, y + Math.sin(t * 0.0014 + k) * 0.6);
                c.lineTo(w, y + Math.cos(t * 0.0014 + k) * 0.6);
                c.stroke();
            }

            // Paddy field boundary lines (azu — earth ridges between paddies).
            c.fillStyle = '#4a3622';
            c.fillRect(0, paddyTop + (paddyBot - paddyTop) * 0.32, w, 1.2);
            c.fillRect(0, paddyTop + (paddyBot - paddyTop) * 0.66, w, 1.2);
            // Slightly tilted ridge cross-paths.
            c.strokeStyle = 'rgba(74, 54, 34, 0.85)';
            c.lineWidth = 1.0;
            c.beginPath();
            c.moveTo(w * 0.30, paddyTop);
            c.lineTo(w * 0.31, paddyBot);
            c.moveTo(w * 0.78, paddyTop);
            c.lineTo(w * 0.77, paddyBot);
            c.stroke();

            // Rice plant rows — clear vertical alignment with wind sway.
            const rowCount = 8;
            for (let row = 0; row < rowCount; row++) {
                const rowK = row / (rowCount - 1);
                const py = paddyTop + 6 + rowK * (paddyBot - paddyTop - 8) * 0.92;
                const phBase = (4 + rowK * 6) * this.as;
                const plantsPerRow = Math.floor(30 + rowK * 60);
                // Row hue shifts slightly with depth.
                const hueK = 0.45 + rowK * 0.25;
                const stalkCol = this.mixColor('#557a32', '#9ec862', hueK);
                c.strokeStyle = stalkCol;
                c.lineWidth = 0.9;
                c.lineCap = 'round';
                for (let i = 0; i < plantsPerRow; i++) {
                    const k = (i + 0.5) / plantsPerRow;
                    const sway = Math.sin(t * 0.0014 + i * 0.4 + row) * (0.5 + this.wind * 0.7 + this.windGust * 0.3);
                    const px = k * w + sway;
                    const ph = phBase + Math.sin(i * 0.7 + row) * 0.6;
                    // Three blades per plant — fan shape.
                    c.beginPath();
                    c.moveTo(px, py);
                    c.lineTo(px - 1.0, py - ph * 0.9);
                    c.moveTo(px, py);
                    c.lineTo(px + 1.0, py - ph * 0.9);
                    c.moveTo(px, py);
                    c.lineTo(px, py - ph);
                    c.stroke();
                    // Tiny rice grain head (only mature/foreground rows).
                    if (rowK > 0.55) {
                        c.fillStyle = `rgba(${180 + rowK * 40 | 0}, ${160 + rowK * 30 | 0}, ${90 + rowK * 20 | 0}, 0.85)`;
                        c.fillRect(px - 0.4, py - ph - 0.6, 0.8, 1);
                    }
                }
            }
        }

        // -----------------------------------------------------------
        // Sakura
        // -----------------------------------------------------------

        drawSakuraTree(rootX, rootY, t, scale, far) {
            const c = this.ctx;
            const trunkH = 130 * scale;
            const trunkW = 14 * scale;
            const sway = Math.sin(t * 0.0007) * 0.018 + this.wind * 0.005;
            c.save();
            c.translate(rootX, rootY);
            c.rotate(sway);
            c.scale(1, 1);

            // 3-segment trunk: base -> fork -> two branches
            const forkY = -trunkH * 0.55;
            c.fillStyle = far ? '#3a2a20' : '#2e1d14';
            c.beginPath();
            c.moveTo(-trunkW * 0.5, 0);
            c.bezierCurveTo(-trunkW * 0.6, forkY * 0.7, trunkW * 0.4, forkY * 0.8, -trunkW * 0.2, forkY);
            c.lineTo(trunkW * 0.5, forkY);
            c.bezierCurveTo(trunkW * 0.9, forkY * 0.8, -trunkW * 0.1, forkY * 0.7, trunkW * 0.5, 0);
            c.closePath();
            c.fill();

            // Bark highlights
            c.strokeStyle = far ? '#5a4232' : '#6a4632';
            c.lineWidth = 0.8 * scale;
            for (let k = 0; k < 5; k++) {
                const ty = -10 - k * (Math.abs(forkY) / 5);
                c.beginPath();
                c.moveTo(-trunkW * 0.4, ty);
                c.quadraticCurveTo(0, ty - 3, trunkW * 0.4, ty);
                c.stroke();
            }

            // Branches: 2 main forks + secondary spreads
            const branches = [
                { ang: -Math.PI * 0.78, len: 70 * scale, w: 5 * scale },
                { ang: -Math.PI * 0.62, len: 95 * scale, w: 5 * scale },
                { ang: -Math.PI * 0.50, len: 110 * scale, w: 5 * scale },
                { ang: -Math.PI * 0.38, len: 95 * scale, w: 5 * scale },
                { ang: -Math.PI * 0.22, len: 70 * scale, w: 5 * scale },
            ];
            c.strokeStyle = far ? '#3a2a20' : '#2e1d14';
            c.lineCap = 'round';
            const branchEnds = [];
            for (const br of branches) {
                const ex = Math.cos(br.ang) * br.len;
                const ey = forkY + Math.sin(br.ang) * br.len;
                c.lineWidth = br.w;
                c.beginPath();
                c.moveTo(0, forkY + 4);
                c.quadraticCurveTo(ex * 0.4, forkY + ey * 0.4 - 6, ex, ey);
                c.stroke();
                branchEnds.push({ x: ex, y: ey, ang: br.ang });
            }

            // Blossom clusters anchored to branch ends + interpolated mid-points.
            const clusterCenters = [];
            const blossomRand = this.rng(scale > 0.8 ? 6661 : 7771);
            for (const be of branchEnds) {
                clusterCenters.push({ x: be.x, y: be.y, r: (26 + blossomRand() * 10) * scale });
                // intermediate cluster between trunk and branch end
                clusterCenters.push({ x: be.x * 0.6, y: be.y * 0.6 + forkY * 0.2, r: (18 + blossomRand() * 6) * scale });
            }
            // Central canopy cluster
            clusterCenters.push({ x: 0, y: forkY - 25 * scale, r: 36 * scale });

            // Darker base layer
            c.fillStyle = far ? 'rgba(200, 130, 160, 0.55)' : 'rgba(220, 140, 170, 0.60)';
            for (const cc of clusterCenters) {
                c.beginPath();
                c.arc(cc.x, cc.y, cc.r, 0, Math.PI * 2);
                c.fill();
            }
            // Lighter top layer
            c.fillStyle = far ? 'rgba(245, 190, 215, 0.70)' : 'rgba(255, 200, 220, 0.78)';
            for (const cc of clusterCenters) {
                c.beginPath();
                c.arc(cc.x - 3, cc.y - 4, cc.r * 0.78, 0, Math.PI * 2);
                c.fill();
            }
            // Even lighter — small overlapping puffs for variation
            c.fillStyle = 'rgba(255, 230, 240, 0.55)';
            for (const cc of clusterCenters) {
                const sub = 5;
                for (let s = 0; s < sub; s++) {
                    const ang = s * 1.97;
                    const r = cc.r * 0.4;
                    c.beginPath();
                    c.arc(cc.x + Math.cos(ang) * r * 0.8, cc.y + Math.sin(ang) * r * 0.5, cc.r * 0.35, 0, Math.PI * 2);
                    c.fill();
                }
            }
            // 5-petal blossom shapes scattered for foreground tree (more visible up close).
            if (!far) {
                const blossomR = this.rng(scale > 0.8 ? 9991 : 8881);
                for (let k = 0; k < 24; k++) {
                    const cc = clusterCenters[Math.floor(blossomR() * clusterCenters.length)];
                    const ang = blossomR() * Math.PI * 2;
                    const rr = blossomR() * cc.r * 0.85;
                    const bx = cc.x + Math.cos(ang) * rr;
                    const by = cc.y + Math.sin(ang) * rr;
                    // 5 petals around a yellow center.
                    const petalR = 1.4 * scale;
                    c.fillStyle = 'rgba(255, 235, 245, 0.92)';
                    for (let p = 0; p < 5; p++) {
                        const pa = p * (Math.PI * 2 / 5);
                        c.beginPath();
                        c.arc(bx + Math.cos(pa) * petalR * 0.6, by + Math.sin(pa) * petalR * 0.6, petalR, 0, Math.PI * 2);
                        c.fill();
                    }
                    // Yellow stamen center.
                    c.fillStyle = 'rgba(220, 180, 60, 0.85)';
                    c.beginPath();
                    c.arc(bx, by, 0.6 * scale, 0, Math.PI * 2);
                    c.fill();
                }
            } else {
                // Far tree: just accent dots (cheap).
                c.fillStyle = 'rgba(255, 240, 246, 0.9)';
                const accentR = this.rng(8881);
                for (let k = 0; k < 18; k++) {
                    const cc = clusterCenters[Math.floor(accentR() * clusterCenters.length)];
                    const ang = accentR() * Math.PI * 2;
                    const rr = accentR() * cc.r * 0.8;
                    c.beginPath();
                    c.arc(cc.x + Math.cos(ang) * rr, cc.y + Math.sin(ang) * rr, 1.2 * scale, 0, Math.PI * 2);
                    c.fill();
                }
            }

            // Hanging blossoms — small dangling clusters from a few branch ends.
            if (!far) {
                c.fillStyle = 'rgba(255, 210, 225, 0.78)';
                c.strokeStyle = 'rgba(120, 80, 90, 0.5)';
                c.lineWidth = 0.5;
                for (let k = 0; k < branchEnds.length; k++) {
                    if (k % 2 !== 0) continue;
                    const be = branchEnds[k];
                    const drop = 10 + (k % 3) * 6;
                    c.beginPath();
                    c.moveTo(be.x, be.y + 4 * scale);
                    c.lineTo(be.x + 1, be.y + drop * scale);
                    c.stroke();
                    c.beginPath();
                    c.arc(be.x + 1, be.y + drop * scale, 2.5 * scale, 0, Math.PI * 2);
                    c.fill();
                }
            }

            // Compute emitter bounds in world coords (for petal anchoring).
            const emitter = { worldX: rootX, worldY: rootY, forkY, scale };
            if (far) {
                this._bgEmitter = emitter;
            } else {
                this._fgEmitter = emitter;
            }
            c.restore();
        }

        // -----------------------------------------------------------
        // Petals
        // -----------------------------------------------------------

        drawPetals(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const dtS = dt / 1000;
            this._renderPetalGroup(this.fgPetals, this._fgEmitter, t, dtS, w, h, false);
            this._renderPetalGroup(this.bgPetals, this._bgEmitter, t, dtS, w, h, true);
        }

        _renderPetalGroup(group, emitter, t, dtS, w, h, far) {
            if (!emitter) return;
            const c = this.ctx;
            for (let i = 0; i < group.length; i++) {
                const p = group[i];
                if (p.fresh) {
                    // Spawn from emitter area.
                    const ang = Math.random() * Math.PI * 2;
                    const r = Math.random() * 60 * emitter.scale;
                    p.ax = emitter.worldX + Math.cos(ang) * r;
                    p.ay = emitter.worldY + emitter.forkY - 25 * emitter.scale + Math.sin(ang) * r * 0.6;
                    p.vx = (Math.random() - 0.5) * 8;
                    p.vy = 4 + Math.random() * 4;
                    p.fresh = false;
                }
                // Wind drift + gentle gravity.
                p.vx += (Math.sin(t * 0.001 + p.phase) * 2 + this.wind * 6 + this.windGust * 2 - p.vx * 0.6) * dtS;
                // Gust lift: occasionally negate gravity for foreground petals.
                const lift = this.windGust > 0.4 && (i % 3 === 0) ? -p.fall * 0.8 : 0;
                p.vy += ((p.fall - p.vy) * 0.4) * dtS;
                p.ax += p.vx * dtS;
                p.ay += p.vy * dtS + lift * dtS;
                p.rot += p.rotSpeed * dtS;
                if (p.ay > h + 10 || p.ax < -20 || p.ax > w + 20) {
                    p.fresh = true;
                    continue;
                }
                this.drawPetal(p.ax, p.ay, p.size, p.rot, p.depth, far);
            }
        }

        drawPetal(x, y, size, rot, depth, far) {
            const c = this.ctx;
            c.save();
            c.translate(x, y);
            c.rotate(rot);
            const flip = 0.55 + 0.45 * Math.abs(Math.cos(rot * 1.7));
            c.scale(1, flip);
            const alpha = (far ? 0.5 : 0.7) + depth * 0.25;
            const r = 255;
            const g = Math.round(200 - depth * 14);
            const b = Math.round(215 - depth * 18);
            c.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            c.beginPath();
            c.moveTo(0, -size * 0.85);
            c.bezierCurveTo(size * 0.20, -size * 0.95, size * 0.85, -size * 0.45, size * 0.55, size * 0.20);
            c.bezierCurveTo(size * 0.35, size * 0.85, -size * 0.35, size * 0.85, -size * 0.55, size * 0.20);
            c.bezierCurveTo(-size * 0.85, -size * 0.45, -size * 0.20, -size * 0.95, 0, -size * 0.85);
            c.lineTo(0, -size * 0.55);
            c.closePath();
            c.fill();
            c.fillStyle = `rgba(255, 235, 240, ${alpha * 0.65})`;
            c.beginPath();
            c.arc(0, size * 0.1, size * 0.22, 0, Math.PI * 2);
            c.fill();
            c.restore();
        }

        // -----------------------------------------------------------
        // Bike (foreground prop)
        // -----------------------------------------------------------

        drawBike(x, baseY) {
            const c = this.ctx;
            c.save();
            c.translate(x, baseY);
            const frame = '#3aa0a0';
            const frameDk = '#1d6868';
            const tire = '#5a4a3a';
            c.strokeStyle = tire;
            c.lineWidth = 2.4;
            c.beginPath(); c.arc(0, -16, 16, 0, Math.PI * 2); c.stroke();
            c.beginPath(); c.arc(46, -16, 16, 0, Math.PI * 2); c.stroke();
            c.strokeStyle = '#8a7a6a';
            c.lineWidth = 0.6;
            c.beginPath(); c.arc(0, -16, 13, 0, Math.PI * 2); c.stroke();
            c.beginPath(); c.arc(46, -16, 13, 0, Math.PI * 2); c.stroke();
            c.lineWidth = 0.5;
            for (let s = 0; s < 4; s++) {
                const ang = s * Math.PI / 4;
                c.beginPath();
                c.moveTo(0 + Math.cos(ang) * 14, -16 + Math.sin(ang) * 14);
                c.lineTo(0 - Math.cos(ang) * 14, -16 - Math.sin(ang) * 14);
                c.stroke();
                c.beginPath();
                c.moveTo(46 + Math.cos(ang) * 14, -16 + Math.sin(ang) * 14);
                c.lineTo(46 - Math.cos(ang) * 14, -16 - Math.sin(ang) * 14);
                c.stroke();
            }
            c.strokeStyle = frame;
            c.lineWidth = 2.6;
            c.beginPath();
            c.moveTo(0, -16); c.lineTo(20, -38);
            c.lineTo(46, -16); c.lineTo(26, -38); c.closePath();
            c.stroke();
            c.strokeStyle = frameDk;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(2, -16); c.lineTo(20, -38);
            c.moveTo(26, -38); c.lineTo(46, -16);
            c.stroke();
            c.strokeStyle = frame;
            c.lineWidth = 2.6;
            c.beginPath(); c.moveTo(26, -38); c.lineTo(26, -52); c.stroke();
            c.fillStyle = '#1a1410';
            c.fillRect(20, -54, 14, 3);
            c.beginPath();
            c.moveTo(20, -38); c.lineTo(14, -52); c.lineTo(6, -52);
            c.stroke();
            c.strokeStyle = '#d2a070';
            c.lineWidth = 1.4;
            c.strokeRect(2, -52, 14, 9);
            c.lineWidth = 0.5;
            for (let k = 1; k < 5; k++) {
                c.beginPath();
                c.moveTo(2 + k * 2.8, -52);
                c.lineTo(2 + k * 2.8, -43);
                c.stroke();
            }
            c.restore();
        }

        // -----------------------------------------------------------
        // Atmosphere & night veil
        // -----------------------------------------------------------

        drawAtmosphere(t) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const sky = this.sky, night = this.night;
            const hazeI = sky.sunI > 0.3 && (sky.cycle > 0.72 || sky.cycle < 0.32) ? 0.08 : 0.02;
            c.fillStyle = `rgba(255, 160, 90, ${hazeI})`;
            c.fillRect(0, 0, w, h);
            // Dust motes — only mid-afternoon to golden hour.
            if (sky.sunI > 0.7 && night < 0.2) {
                c.fillStyle = `rgba(255, 240, 200, 0.55)`;
                for (let k = 0; k < 24; k++) {
                    const mx = (k * 173 + (t * 0.04) % w) % w;
                    const my = (k * 91 + Math.sin(t * 0.001 + k) * 6) % (this.fgRowY * 0.6) + this.horizonY * 0.3;
                    c.fillRect(mx, my, 1, 1);
                }
            }
        }

        drawNightVeil() {
            const c = this.ctx;
            const w = this.width, h = this.height;
            if (this.night > 0.15) {
                c.fillStyle = `rgba(8, 10, 26, ${this.night * 0.48})`;
                c.fillRect(0, 0, w, h);
            }
        }

        // -----------------------------------------------------------
        // Distant torii gate
        // -----------------------------------------------------------

        drawDistantTorii(t) {
            const c = this.ctx;
            const w = this.width;
            const tx = w * 0.40;
            const ty = this.horizonY - 8;
            const tw = 22;
            const th = 18;
            // Tint blended toward horizon for distance.
            const baseCol = this.mixColor('#8a2a26', this.sky.horizon, 0.55);
            c.fillStyle = baseCol;
            // Pillars.
            c.fillRect(tx - tw * 0.5, ty - th, 1.4, th);
            c.fillRect(tx + tw * 0.5 - 1.4, ty - th, 1.4, th);
            // Lintel (kasagi - upper curved beam).
            c.fillRect(tx - tw * 0.65, ty - th - 2, tw * 1.3, 1.8);
            // Slight downward curve at ends.
            c.beginPath();
            c.moveTo(tx - tw * 0.65, ty - th - 2);
            c.quadraticCurveTo(tx - tw * 0.7, ty - th - 0.5, tx - tw * 0.7, ty - th + 1);
            c.lineTo(tx - tw * 0.62, ty - th + 1);
            c.lineTo(tx - tw * 0.62, ty - th - 0.5);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(tx + tw * 0.65, ty - th - 2);
            c.quadraticCurveTo(tx + tw * 0.7, ty - th - 0.5, tx + tw * 0.7, ty - th + 1);
            c.lineTo(tx + tw * 0.62, ty - th + 1);
            c.lineTo(tx + tw * 0.62, ty - th - 0.5);
            c.closePath();
            c.fill();
            // Lower beam (nuki).
            c.fillRect(tx - tw * 0.55, ty - th * 0.55, tw * 1.1, 1.2);
            // Center plaque (gakuzuka).
            c.fillRect(tx - 2, ty - th - 0.5, 4, 3);
        }

        // -----------------------------------------------------------
        // Sun rays (god rays through clouds at sunrise/sunset)
        // -----------------------------------------------------------

        drawSunRays(t) {
            if (!this.sunVisible || this.sky.sunI < 0.35) return;
            const c = this.ctx;
            const sky = this.sky;
            const w = this.width, h = this.height;
            const isWarm = sky.cycle < 0.36 || sky.cycle > 0.68;
            const rayA = this.clamp((sky.sunI - 0.35) * 0.32, 0, 0.18) * (isWarm ? 1.6 : 0.5);
            if (rayA < 0.01) return;
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.translate(this.sunX, this.sunY);
            const baseAng = Math.atan2(this.horizonY + 200 - this.sunY, 0 - 0) - Math.PI / 2;
            for (let k = 0; k < 5; k++) {
                const ang = baseAng + (k - 2) * 0.16 + Math.sin(t * 0.0002 + k) * 0.02;
                c.save();
                c.rotate(ang);
                const rg = c.createLinearGradient(0, 0, 0, 380);
                rg.addColorStop(0, `rgba(255, 220, 170, ${rayA * (1 - Math.abs(k - 2) * 0.20)})`);
                rg.addColorStop(0.5, `rgba(255, 200, 150, ${rayA * 0.5})`);
                rg.addColorStop(1, 'rgba(255, 200, 150, 0)');
                c.fillStyle = rg;
                c.beginPath();
                c.moveTo(-2, 0);
                c.lineTo(-26, 380);
                c.lineTo(26, 380);
                c.lineTo(2, 0);
                c.closePath();
                c.fill();
                c.restore();
            }
            c.restore();
        }

        // -----------------------------------------------------------
        // Persimmon tree (kaki) — between two foreground houses
        // -----------------------------------------------------------

        drawPersimmonTree(t) {
            const c = this.ctx;
            const w = this.width;
            const rootX = w * 0.36;
            const rootY = this.fgRowY + 8;
            const trunkH = 80;
            const sway = Math.sin(t * 0.0008) * 0.012 + this.wind * 0.004;
            c.save();
            c.translate(rootX, rootY);
            c.rotate(sway);
            // Trunk.
            c.fillStyle = '#3a2418';
            c.beginPath();
            c.moveTo(-2.5, 0);
            c.bezierCurveTo(-3, -trunkH * 0.5, -1.5, -trunkH * 0.7, -1, -trunkH);
            c.lineTo(2, -trunkH);
            c.bezierCurveTo(2.5, -trunkH * 0.7, 3.5, -trunkH * 0.5, 2.5, 0);
            c.closePath();
            c.fill();
            // Branches.
            c.strokeStyle = '#3a2418';
            c.lineCap = 'round';
            const branches = [
                { ang: -Math.PI * 0.82, len: 30 },
                { ang: -Math.PI * 0.65, len: 40 },
                { ang: -Math.PI * 0.50, len: 42 },
                { ang: -Math.PI * 0.35, len: 38 },
                { ang: -Math.PI * 0.18, len: 28 },
            ];
            const tips = [];
            for (const br of branches) {
                const ex = Math.cos(br.ang) * br.len;
                const ey = -trunkH + Math.sin(br.ang) * br.len;
                c.lineWidth = 2.4;
                c.beginPath();
                c.moveTo(0, -trunkH + 2);
                c.quadraticCurveTo(ex * 0.5, -trunkH + ey * 0.4 - 2, ex, ey);
                c.stroke();
                tips.push({ x: ex, y: ey });
            }
            // Foliage clusters.
            c.fillStyle = 'rgba(70, 95, 55, 0.92)';
            for (const tip of tips) {
                c.beginPath();
                c.ellipse(tip.x, tip.y, 16, 12, 0, 0, Math.PI * 2);
                c.fill();
            }
            c.fillStyle = 'rgba(95, 130, 70, 0.92)';
            for (const tip of tips) {
                c.beginPath();
                c.ellipse(tip.x - 3, tip.y - 4, 11, 8, 0, 0, Math.PI * 2);
                c.fill();
            }
            // Lighter highlight clumps.
            c.fillStyle = 'rgba(140, 170, 100, 0.75)';
            for (const tip of tips) {
                c.beginPath();
                c.ellipse(tip.x - 5, tip.y - 6, 5, 4, 0, 0, Math.PI * 2);
                c.fill();
            }
            // Persimmon fruits (orange) dotted across foliage — larger, more visible.
            const fruitR = this.rng(8181);
            for (let i = 0; i < 22; i++) {
                const tip = tips[Math.floor(fruitR() * tips.length)];
                const ox = tip.x + (fruitR() - 0.5) * 24;
                const oy = tip.y + (fruitR() - 0.5) * 16 + 2;
                // Fruit body — bright orange with subtle shading.
                c.fillStyle = '#ee7424';
                c.beginPath();
                c.arc(ox, oy, 3.2, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = 'rgba(160, 60, 14, 0.55)';
                c.beginPath();
                c.arc(ox + 1.0, oy + 1.0, 2.2, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = 'rgba(255, 210, 140, 0.65)';
                c.beginPath();
                c.arc(ox - 0.8, oy - 0.8, 1.2, 0, Math.PI * 2);
                c.fill();
                // Calyx (small green/brown crown on top).
                c.fillStyle = '#3a4a28';
                c.fillRect(ox - 1.2, oy - 3.4, 2.4, 0.8);
                c.fillRect(ox - 0.5, oy - 4.0, 1, 0.6);
            }
            c.restore();
        }

        // -----------------------------------------------------------
        // Jizo statue (small roadside Buddha with red bib)
        // -----------------------------------------------------------

        drawJizoStatue(t) {
            const c = this.ctx;
            const w = this.width;
            const jx = w * 0.16;
            const jy = this.roadY - 1;
            // Stone base (rectangular).
            c.fillStyle = '#9a948a';
            c.fillRect(jx - 4, jy - 3, 8, 3);
            c.fillStyle = '#7a746a';
            c.fillRect(jx - 4, jy - 1, 8, 1);
            // Body (rounded mound).
            c.fillStyle = '#c8c2b8';
            c.beginPath();
            c.moveTo(jx - 3, jy - 3);
            c.lineTo(jx - 3, jy - 9);
            c.quadraticCurveTo(jx, jy - 13, jx + 3, jy - 9);
            c.lineTo(jx + 3, jy - 3);
            c.closePath();
            c.fill();
            // Body shading.
            c.fillStyle = 'rgba(80, 76, 70, 0.30)';
            c.beginPath();
            c.moveTo(jx, jy - 11);
            c.lineTo(jx + 3, jy - 9);
            c.lineTo(jx + 3, jy - 3);
            c.lineTo(jx, jy - 3);
            c.closePath();
            c.fill();
            // Red bib (yodarekake).
            c.fillStyle = '#c83830';
            c.beginPath();
            c.moveTo(jx - 2.8, jy - 8);
            c.lineTo(jx + 2.8, jy - 8);
            c.lineTo(jx + 2.4, jy - 3);
            c.lineTo(jx - 2.4, jy - 3);
            c.closePath();
            c.fill();
            c.fillStyle = 'rgba(160, 30, 24, 0.6)';
            c.fillRect(jx - 2.5, jy - 4.5, 5, 0.5);
            // Face features (tiny dots).
            c.fillStyle = 'rgba(80, 70, 60, 0.8)';
            c.fillRect(jx - 1.2, jy - 11, 0.6, 0.6);
            c.fillRect(jx + 0.6, jy - 11, 0.6, 0.6);
            // Tiny smile.
            c.strokeStyle = 'rgba(80, 70, 60, 0.6)';
            c.lineWidth = 0.3;
            c.beginPath();
            c.arc(jx, jy - 10, 0.7, 0.2, Math.PI - 0.2);
            c.stroke();
            // Offering — small orange (mikan) at the base.
            c.fillStyle = '#e08a3a';
            c.beginPath();
            c.arc(jx - 5, jy - 0.6, 1, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#3a4a28';
            c.fillRect(jx - 5.2, jy - 1.6, 0.4, 0.4);
        }

        // -----------------------------------------------------------
        // Cyclist (mama-chari)
        // -----------------------------------------------------------

        drawCyclist(t, dt) {
            if (!this.cyclist) {
                this.nextCyclistMs = (this.nextCyclistMs == null ? 14000 + Math.random() * 26000 : this.nextCyclistMs - dt);
                if (this.nextCyclistMs <= 0) {
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    this.cyclist = {
                        x: dir > 0 ? -50 : this.width + 50,
                        dir,
                        speed: 60 + Math.random() * 30,
                        pedal: 0,
                        // 0: granny, 1: salaryman, 2: schoolgirl.
                        kind: Math.floor(Math.random() * 3),
                    };
                    this.nextCyclistMs = 30000 + Math.random() * 60000;
                }
                return;
            }
            const k = this.cyclist;
            k.x += k.dir * k.speed * this.as * (dt / 1000);
            k.pedal += dt;
            if (k.x < -60 || k.x > this.width + 60) {
                this.cyclist = null;
                return;
            }
            const c = this.ctx;
            const y = this.roadY + (this.paddyY - this.roadY) * 0.62;
            c.save();
            c.translate(k.x, y);
            // Sprite native orientation has the basket/handlebar (front) on the
            // LEFT; flip so the front leads in the direction of motion.
            c.scale(-k.dir * this.as, this.as);
            // Wheels.
            const wheelR = 4.5;
            const pedalRot = (k.pedal * 0.012) % (Math.PI * 2);
            c.strokeStyle = '#1a1410';
            c.lineWidth = 1.2;
            c.beginPath(); c.arc(-8, 5, wheelR, 0, Math.PI * 2); c.stroke();
            c.beginPath(); c.arc(8, 5, wheelR, 0, Math.PI * 2); c.stroke();
            // Spokes (rotating subtly).
            c.strokeStyle = 'rgba(60, 56, 50, 0.6)';
            c.lineWidth = 0.4;
            for (let s = 0; s < 4; s++) {
                const ang = pedalRot + s * Math.PI / 4;
                c.beginPath();
                c.moveTo(-8 + Math.cos(ang) * wheelR * 0.85, 5 + Math.sin(ang) * wheelR * 0.85);
                c.lineTo(-8 - Math.cos(ang) * wheelR * 0.85, 5 - Math.sin(ang) * wheelR * 0.85);
                c.stroke();
                c.beginPath();
                c.moveTo(8 + Math.cos(ang) * wheelR * 0.85, 5 + Math.sin(ang) * wheelR * 0.85);
                c.lineTo(8 - Math.cos(ang) * wheelR * 0.85, 5 - Math.sin(ang) * wheelR * 0.85);
                c.stroke();
            }
            // Frame.
            const frameCol = k.kind === 0 ? '#a8a8a4' : (k.kind === 1 ? '#3a3a3a' : '#c83a8a');
            c.strokeStyle = frameCol;
            c.lineWidth = 1.4;
            c.beginPath();
            c.moveTo(-8, 5); c.lineTo(2, -2); c.lineTo(8, 5);
            c.moveTo(-2, -3); c.lineTo(2, -2);
            c.moveTo(2, -2); c.lineTo(0, 5);
            c.stroke();
            // Basket up front.
            if (k.kind !== 1) {
                c.strokeStyle = '#9a8a78';
                c.lineWidth = 0.7;
                c.strokeRect(-10, -7, 6, 4);
                c.beginPath();
                for (let s = 0; s < 3; s++) {
                    c.moveTo(-10, -7 + s * 1.3); c.lineTo(-4, -7 + s * 1.3);
                }
                c.stroke();
                // Bag on top.
                c.fillStyle = '#dca070';
                c.fillRect(-9, -9, 4, 2);
            }
            // Saddle.
            c.fillStyle = '#1a1410';
            c.fillRect(-1, -4, 4, 1.4);
            // Handlebar.
            c.strokeStyle = '#3a3530';
            c.lineWidth = 0.8;
            c.beginPath();
            c.moveTo(-2, -3); c.lineTo(-6, -5); c.lineTo(-6, -7);
            c.stroke();
            // Rider body.
            const bobY = Math.sin(k.pedal * 0.018) * 0.4;
            const clothCol = k.kind === 0 ? '#7a3030' : (k.kind === 1 ? '#1a2a4a' : '#3a8c5a');
            c.fillStyle = clothCol;
            // Torso.
            c.beginPath();
            c.moveTo(-1, -5 + bobY);
            c.lineTo(3, -5 + bobY);
            c.lineTo(4, -10 + bobY);
            c.lineTo(-2, -10 + bobY);
            c.closePath();
            c.fill();
            // Head.
            c.fillStyle = '#e8c8a4';
            c.beginPath();
            c.arc(1, -12 + bobY, 1.8, 0, Math.PI * 2);
            c.fill();
            // Hat / hair.
            if (k.kind === 0) {
                // Granny: sun hat.
                c.fillStyle = '#e8d8a4';
                c.fillRect(-2, -13.4 + bobY, 6, 0.8);
                c.beginPath();
                c.arc(1, -13 + bobY, 2, Math.PI, 0);
                c.fill();
            } else if (k.kind === 1) {
                // Salaryman: black hair.
                c.fillStyle = '#1a1410';
                c.beginPath();
                c.arc(1, -13 + bobY, 2, Math.PI, 0);
                c.fill();
            } else {
                // Schoolgirl: brown hair + uniform skirt.
                c.fillStyle = '#5a3818';
                c.beginPath();
                c.arc(1, -13 + bobY, 2.2, Math.PI, 0);
                c.fill();
                c.fillRect(0, -10.5 + bobY, 1, 2.5);
                c.fillRect(2, -10.5 + bobY, 1, 2.5);
                // Pleated skirt.
                c.fillStyle = '#1a2a4a';
                c.fillRect(-2, -7 + bobY, 6, 2);
            }
            // Arms to handlebar.
            c.strokeStyle = clothCol;
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(-1, -9 + bobY); c.lineTo(-5, -7);
            c.stroke();
            // Legs (pedaling animation).
            const lA = Math.sin(pedalRot) * 1.8;
            const lB = Math.sin(pedalRot + Math.PI) * 1.8;
            c.strokeStyle = '#1a1410';
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(2, -5 + bobY); c.lineTo(0.5 + lA, 1);
            c.moveTo(2, -5 + bobY); c.lineTo(2.5 + lB, 1);
            c.stroke();
            c.restore();
        }

        // -----------------------------------------------------------
        // Delivery moped (small post-style bike)
        // -----------------------------------------------------------

        drawDeliveryMoped(t, dt) {
            if (!this.moped) {
                this.nextMopedMs = (this.nextMopedMs == null ? 22000 + Math.random() * 36000 : this.nextMopedMs - dt);
                if (this.nextMopedMs <= 0) {
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    this.moped = {
                        x: dir > 0 ? -50 : this.width + 50,
                        dir,
                        speed: 130 + Math.random() * 40,
                        bob: 0,
                        // 0: Sagawa green, 1: Yamato black-cat yellow.
                        kind: Math.random() < 0.5 ? 0 : 1,
                    };
                    this.nextMopedMs = 50000 + Math.random() * 90000;
                }
                return;
            }
            const m = this.moped;
            m.x += m.dir * m.speed * this.as * (dt / 1000);
            m.bob += dt;
            if (m.x < -60 || m.x > this.width + 60) {
                this.moped = null;
                return;
            }
            const c = this.ctx;
            const y = this.roadY + (this.paddyY - this.roadY) * 0.58;
            const wob = Math.sin(m.bob * 0.018) * 0.4;
            c.save();
            c.translate(m.x, y + wob);
            // Sprite native orientation has the front fairing on the LEFT;
            // flip so the front leads in the direction of motion.
            c.scale(-m.dir * this.as, this.as);
            // Shadow.
            c.fillStyle = 'rgba(10, 8, 6, 0.5)';
            c.fillRect(-12, 7, 26, 1.5);
            // Body.
            const bodyCol = m.kind === 0 ? '#2a4a2a' : '#1a1610';
            c.fillStyle = bodyCol;
            // Cargo box at rear.
            const boxCol = m.kind === 0 ? '#3a7a48' : '#dcbc38';
            c.fillStyle = boxCol;
            c.fillRect(2, -10, 12, 9);
            c.strokeStyle = '#1a1410';
            c.lineWidth = 0.5;
            c.strokeRect(2, -10, 12, 9);
            // Logo on box.
            c.fillStyle = m.kind === 0 ? '#f0ece0' : '#1a1410';
            c.fillRect(4, -8, 8, 1.4);
            c.fillRect(4, -5.5, 6, 1);
            // Frame + seat.
            c.fillStyle = bodyCol;
            c.fillRect(-8, -3, 12, 3);
            c.fillStyle = '#1a1410';
            c.fillRect(-2, -4, 6, 1.5);
            // Front fairing.
            c.fillStyle = bodyCol;
            c.beginPath();
            c.moveTo(-10, -3);
            c.lineTo(-12, -5);
            c.lineTo(-10, 0);
            c.closePath();
            c.fill();
            // Wheels.
            c.fillStyle = '#1a1410';
            c.beginPath(); c.arc(-9, 5, 3.5, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(8, 5, 3.5, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#6a6660';
            c.beginPath(); c.arc(-9, 5, 1.4, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(8, 5, 1.4, 0, Math.PI * 2); c.fill();
            // Rider.
            const helmCol = m.kind === 0 ? '#3a4a3a' : '#1a1410';
            c.fillStyle = helmCol;
            c.beginPath();
            c.arc(-3, -9, 2.2, 0, Math.PI * 2);
            c.fill();
            // Visor.
            c.fillStyle = 'rgba(40, 60, 100, 0.9)';
            c.fillRect(-4.6, -10, 3.2, 1.2);
            // Body / jacket.
            c.fillStyle = m.kind === 0 ? '#3a7a48' : '#dcbc38';
            c.beginPath();
            c.moveTo(-5, -7);
            c.lineTo(-1, -7);
            c.lineTo(0, -3);
            c.lineTo(-5, -3);
            c.closePath();
            c.fill();
            // Headlight at night.
            if (this.lampOn() > 0.3) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                const halo = c.createRadialGradient(-12, -3, 1, -12, -3, 18);
                halo.addColorStop(0, `rgba(255, 240, 180, ${0.7 * this.lampOn()})`);
                halo.addColorStop(1, 'rgba(255, 240, 180, 0)');
                c.fillStyle = halo;
                c.fillRect(-30, -22, 22, 22);
                c.restore();
            }
            // Tail light.
            c.fillStyle = `rgba(200, 50, 40, ${0.6 + this.lampOn() * 0.4})`;
            c.fillRect(13, -8, 1, 1.5);
            c.restore();
        }

        // -----------------------------------------------------------
        // School child with randoseru (rare)
        // -----------------------------------------------------------

        drawSchoolChild(t, dt) {
            // Only show at appropriate hours of the day cycle (morning or afternoon).
            const hourK = this.sky ? this.sky.cycle : 0.5;
            const isSchoolTime = (hourK > 0.30 && hourK < 0.38) || (hourK > 0.62 && hourK < 0.70);
            if (!this.schoolChild) {
                if (this.nextChildMs == null) this.nextChildMs = 30000 + Math.random() * 60000;
                if (isSchoolTime) this.nextChildMs -= dt;
                if (this.nextChildMs <= 0 && isSchoolTime) {
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    this.schoolChild = {
                        x: dir > 0 ? -20 : this.width + 20,
                        dir,
                        speed: 22 + Math.random() * 8,
                        step: 0,
                        // Pick the randoseru colour once at spawn so it doesn't
                        // flip as the child walks across integer pixel boundaries.
                        randoseruRed: Math.random() < 0.5,
                    };
                    this.nextChildMs = 80000 + Math.random() * 120000;
                }
                return;
            }
            const ch = this.schoolChild;
            ch.x += ch.dir * ch.speed * this.as * (dt / 1000);
            ch.step += dt;
            if (ch.x < -30 || ch.x > this.width + 30) {
                this.schoolChild = null;
                return;
            }
            const c = this.ctx;
            const y = this.roadY + (this.paddyY - this.roadY) * 0.78;
            const step = Math.sin(ch.step * 0.012);
            c.save();
            c.translate(ch.x, y);
            c.scale(ch.dir * this.as, this.as);
            // Legs.
            c.strokeStyle = '#1a1410';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(-0.5, -3); c.lineTo(-0.5 - step * 1.2, 1);
            c.moveTo(0.5, -3); c.lineTo(0.5 + step * 1.2, 1);
            c.stroke();
            // Skirt or shorts.
            c.fillStyle = '#1a2a4a';
            c.fillRect(-1.5, -5, 3, 2);
            // Body.
            c.fillStyle = '#f0ece0';
            c.fillRect(-1.5, -8, 3, 3);
            // Randoseru backpack (signature red/black) — chosen once at spawn.
            c.fillStyle = ch.randoseruRed ? '#a8302a' : '#1a1410';
            c.fillRect(-2.5, -8, 1.2, 4);
            c.fillStyle = ch.randoseruRed ? 'rgba(80, 24, 20, 0.7)' : 'rgba(60, 56, 50, 0.7)';
            c.fillRect(-2.5, -7, 1.2, 0.4);
            c.fillRect(-2.5, -5.5, 1.2, 0.4);
            // Head.
            c.fillStyle = '#e8c8a4';
            c.beginPath();
            c.arc(0, -10, 1.5, 0, Math.PI * 2);
            c.fill();
            // Hat (yellow cap with brim).
            c.fillStyle = '#dcc432';
            c.fillRect(-1.5, -11.5, 3, 0.8);
            c.beginPath();
            c.arc(0, -11.2, 1.6, Math.PI, 0);
            c.fill();
            c.restore();
        }

        // -----------------------------------------------------------
        // Fireflies (hotaru) at dusk
        // -----------------------------------------------------------

        drawFireflies(t, dt) {
            const cycle = this.sky ? this.sky.cycle : 0.5;
            // Visible in dusk twilight window.
            const visIn = this.smoothstep(0.74, 0.83, cycle);
            const visOut = 1 - this.smoothstep(0.84, 0.94, cycle);
            const visibility = Math.min(visIn, visOut);
            if (visibility < 0.05) {
                this._fireflies = null;
                return;
            }
            if (!this._fireflies) {
                const frand = this.rng(7172);
                this._fireflies = [];
                for (let i = 0; i < 14; i++) {
                    this._fireflies.push({
                        x: frand(),
                        y: 0.78 + frand() * 0.14,
                        phase: frand() * Math.PI * 2,
                        speedX: (frand() - 0.5) * 0.012,
                        speedY: (frand() - 0.5) * 0.006,
                        blink: 2 + frand() * 5,
                    });
                }
            }
            const c = this.ctx;
            const w = this.width, h = this.height;
            c.save();
            c.globalCompositeOperation = 'lighter';
            for (let i = 0; i < this._fireflies.length; i++) {
                const ff = this._fireflies[i];
                ff.x += ff.speedX * (dt / 1000);
                ff.y += (ff.speedY + Math.sin(t * 0.0008 + ff.phase) * 0.0008) * (dt / 1000);
                if (ff.x > 1.02) ff.x = -0.02;
                if (ff.x < -0.02) ff.x = 1.02;
                if (ff.y > 0.94) ff.y = 0.78;
                if (ff.y < 0.76) ff.y = 0.92;
                const blink = (Math.sin(t * 0.003 + ff.phase * ff.blink) + 1) * 0.5;
                if (blink < 0.3) continue;
                const a = blink * visibility * 0.9;
                const px = ff.x * w;
                const py = ff.y * h;
                const gr = c.createRadialGradient(px, py, 0.5, px, py, 6);
                gr.addColorStop(0, `rgba(200, 255, 140, ${a})`);
                gr.addColorStop(0.5, `rgba(160, 220, 100, ${a * 0.5})`);
                gr.addColorStop(1, 'rgba(140, 200, 90, 0)');
                c.fillStyle = gr;
                c.beginPath();
                c.arc(px, py, 6, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = `rgba(240, 255, 200, ${a})`;
                c.fillRect(px - 0.5, py - 0.5, 1, 1);
            }
            c.restore();
        }

        // -----------------------------------------------------------
        // Paddy morning mist (rises with dawn, fades by mid-morning)
        // -----------------------------------------------------------

        drawPaddyMist(t) {
            const cycle = this.sky ? this.sky.cycle : 0.5;
            const morning = this.smoothstep(0.26, 0.34, cycle) * (1 - this.smoothstep(0.40, 0.50, cycle));
            const evening = this.smoothstep(0.74, 0.82, cycle) * (1 - this.smoothstep(0.84, 0.92, cycle));
            const mistA = Math.max(morning, evening * 0.6);
            if (mistA < 0.05) return;
            const c = this.ctx;
            const w = this.width;
            const py = this.paddyY;
            c.save();
            for (let k = 0; k < 4; k++) {
                const yy = py - 12 + k * 6 + Math.sin(t * 0.0003 + k) * 1.4;
                const wob = Math.sin(t * 0.0004 + k * 0.6) * 4;
                const grad = c.createLinearGradient(0, yy - 6, 0, yy + 6);
                grad.addColorStop(0, `rgba(220, 220, 230, 0)`);
                grad.addColorStop(0.5, `rgba(220, 220, 230, ${0.22 * mistA})`);
                grad.addColorStop(1, `rgba(220, 220, 230, 0)`);
                c.fillStyle = grad;
                c.fillRect(-20 + wob, yy - 6, w + 40, 12);
            }
            c.restore();
        }

        // -----------------------------------------------------------
        // Egret (white heron) in the rice paddy
        // -----------------------------------------------------------

        drawEgret(t, dt) {
            // Only daytime, low probability of presence.
            if (this.night > 0.4) { this._egret = null; return; }
            if (!this._egret) {
                this._egretNext = (this._egretNext == null ? 45000 + Math.random() * 90000 : this._egretNext - dt);
                if (this._egretNext <= 0) {
                    this._egret = {
                        x: 0.10 + Math.random() * 0.75,
                        y: 0.6 + Math.random() * 0.30, // within paddy
                        bobPhase: Math.random() * Math.PI * 2,
                        stateT: 0,
                        state: 'standing',
                        dir: Math.random() < 0.5 ? 1 : -1,
                    };
                    this._egretNext = 120000 + Math.random() * 180000;
                }
                return;
            }
            const e = this._egret;
            e.stateT += dt;
            if (e.state === 'standing' && e.stateT > 8000 + Math.random() * 8000) {
                e.state = 'flying';
                e.stateT = 0;
            }
            if (e.state === 'flying') {
                e.x += e.dir * 0.04 * this.as * (dt / 1000);
                e.y -= 0.02 * (dt / 1000);
                if (e.x < -0.05 || e.x > 1.05 || e.y < 0.40) {
                    this._egret = null;
                    return;
                }
            }
            const c = this.ctx;
            const w = this.width;
            const px = e.x * w;
            const py = this.paddyY + e.y * (this.paddyBot - this.paddyY) * 0.5;
            c.save();
            c.translate(px, py);
            // Sprite native orientation has head/beak on the LEFT; flip so
            // the bird faces (and flies) in the direction of its dir vector.
            c.scale(-e.dir * this.as, this.as);
            if (e.state === 'standing') {
                const bob = Math.sin(t * 0.001 + e.bobPhase) * 0.4;
                // Legs.
                c.strokeStyle = '#3a2c20';
                c.lineWidth = 0.6;
                c.beginPath();
                c.moveTo(-0.5, 0); c.lineTo(-0.5, 6);
                c.moveTo(0.5, 0); c.lineTo(0.5, 6);
                c.stroke();
                // Body.
                c.fillStyle = '#f4f4ec';
                c.beginPath();
                c.ellipse(0, -1 + bob, 4, 2.4, 0, 0, Math.PI * 2);
                c.fill();
                // Neck — S-curve.
                c.strokeStyle = '#f4f4ec';
                c.lineWidth = 1.4;
                c.beginPath();
                c.moveTo(-2, -2 + bob);
                c.quadraticCurveTo(-3, -5, -1, -7);
                c.stroke();
                // Head.
                c.fillStyle = '#f4f4ec';
                c.beginPath();
                c.arc(-1, -8, 1.3, 0, Math.PI * 2);
                c.fill();
                // Beak (yellow-orange).
                c.fillStyle = '#dcb83a';
                c.beginPath();
                c.moveTo(-2, -8); c.lineTo(-5, -7.5); c.lineTo(-2, -7);
                c.closePath();
                c.fill();
                // Eye.
                c.fillStyle = '#1a1410';
                c.fillRect(-1.4, -8.2, 0.4, 0.4);
            } else {
                // Flying — wings spread, neck folded back.
                const flap = Math.sin(t * 0.008) * 0.8;
                c.fillStyle = '#f4f4ec';
                c.beginPath();
                c.ellipse(0, 0, 4, 1.8, 0, 0, Math.PI * 2);
                c.fill();
                // Wings.
                c.beginPath();
                c.moveTo(-2, 0);
                c.quadraticCurveTo(-2, -6 - flap * 3, 4, -2 + flap * 2);
                c.lineTo(2, 0); c.closePath();
                c.fill();
                c.beginPath();
                c.moveTo(-2, 0);
                c.quadraticCurveTo(-2, 6 + flap * 3, 4, 2 - flap * 2);
                c.lineTo(2, 0); c.closePath();
                c.fill();
                // Head out front + beak.
                c.beginPath();
                c.arc(-4, -1, 1.2, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = '#dcb83a';
                c.beginPath();
                c.moveTo(-5, -1); c.lineTo(-8, -0.5); c.lineTo(-5, -0.2);
                c.closePath();
                c.fill();
            }
            c.restore();
        }
    }

    LiveWallpaper.register({
        id: 'suburb',
        name: 'Japan · Suburb',
        description: 'Sakura, mountains, and a sleepy edge-of-town street through a day cycle.',
        factory: (canvas) => new SuburbWallpaper(canvas),
    });
})();
