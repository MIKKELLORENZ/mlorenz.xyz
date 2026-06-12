// Japan #1 — Konbini through a day/night cycle. Rain, neon, distant city
// silhouettes, wet asphalt reflections, sliding-door customers, delivery
// scooters and clustered passerby with umbrellas.
(function () {
    'use strict';

    // Full day takes ~3 minutes; starts pre-dawn so neon dominates first
    // and the dawn arrives shortly after.
    const DAY_CYCLE_MS = 180000;
    const CYCLE_START = 0.85;

    // Commit to a fictional chain so it reads as branded signage instead of
    // the generic word "コンビニ". サンマート (Sun Mart): yellow/red/green
    // stripes, sun motif tile, geometric Gothic Japanese text.
    const BRAND_KANA = 'サンマート';
    const BRAND_LATIN = 'SUN MART';
    const FONT_KANA_BIG = "900 22px 'Yu Gothic UI','Yu Gothic','Hiragino Kaku Gothic ProN','Meiryo','MS Gothic',sans-serif";
    const FONT_KANA_SUB = "700 9px 'Yu Gothic UI','Yu Gothic','Hiragino Kaku Gothic ProN','Meiryo','MS Gothic',sans-serif";
    const FONT_KANA_TINY = "700 7px 'Yu Gothic UI','Yu Gothic','Hiragino Kaku Gothic ProN','Meiryo','MS Gothic',sans-serif";
    const FONT_LATIN = "900 9px 'Helvetica Neue','Arial Black',sans-serif";

    // sky/ground/etc keyed by cycle (0..1).
    // top: zenith color; horizon: low sky color; tint: subtle ambient cast;
    // dark: 0..1 driving neon intensity / window glow / star visibility.
    const ATMO_STOPS = [
        { t: 0.00, top: '#03050f', horizon: '#0a1024', tint: '#000000', dark: 1.00 }, // midnight
        { t: 0.18, top: '#0a1230', horizon: '#1c2548', tint: '#020306', dark: 0.95 }, // pre-dawn
        { t: 0.25, top: '#2a3a6a', horizon: '#c47a5a', tint: '#1a1410', dark: 0.65 }, // first light
        { t: 0.32, top: '#5a78b4', horizon: '#f0a878', tint: '#1a1410', dark: 0.30 }, // dawn glow
        { t: 0.42, top: '#5e8cc4', horizon: '#dec8b0', tint: '#000000', dark: 0.10 }, // morning
        { t: 0.55, top: '#6ea4d4', horizon: '#d8d2c4', tint: '#000000', dark: 0.04 }, // midday
        { t: 0.68, top: '#5a82b8', horizon: '#dcb088', tint: '#100804', dark: 0.18 }, // afternoon
        { t: 0.78, top: '#3a3868', horizon: '#d4684a', tint: '#1a0c0a', dark: 0.50 }, // sunset
        { t: 0.85, top: '#22244a', horizon: '#7a3a5a', tint: '#1a0c12', dark: 0.75 }, // late sunset
        { t: 0.92, top: '#0e1230', horizon: '#2a2444', tint: '#020306', dark: 0.92 }, // dusk
        { t: 1.00, top: '#03050f', horizon: '#0a1024', tint: '#000000', dark: 1.00 }, // back to midnight
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

    // Traffic-light cycle definition (state + dwell ms).
    const TRAFFIC_CYCLE = [
        { state: 'red', ms: 14000 },
        { state: 'green', ms: 13000 },
        { state: 'yellow', ms: 3000 },
    ];

    // Passerby variant pool. Spawned with weighted choice.
    const PASSERBY_VARIANTS = [
        { kind: 'umbrella-bag', weight: 3 },
        { kind: 'umbrella-plain', weight: 3 },
        { kind: 'briefcase', weight: 2 },
        { kind: 'hoodie', weight: 1 },
    ];

    function pickVariant() {
        const total = PASSERBY_VARIANTS.reduce((s, v) => s + v.weight, 0);
        let r = Math.random() * total;
        for (const v of PASSERBY_VARIANTS) {
            r -= v.weight;
            if (r <= 0) return v.kind;
        }
        return PASSERBY_VARIANTS[0].kind;
    }

    class KonbiniWallpaper extends Wallpaper {
        init() {
            // ---- Distant city windows ----
            const rand = this.rng(91021);
            this.cityWindows = [];
            for (let i = 0; i < 240; i++) {
                this.cityWindows.push({
                    x: rand(),
                    y: rand(),
                    bri: 0.3 + rand() * 0.7,
                    phase: rand() * Math.PI * 2,
                    flicker: rand() < 0.06,
                });
            }
            // City buildings: tall, varied
            this.buildings = [];
            const randB = this.rng(33);
            let bx = 0;
            while (bx < 1) {
                const bw = 0.05 + randB() * 0.10;
                const bh = 0.16 + randB() * 0.28;
                this.buildings.push({
                    x: bx, w: bw, h: bh,
                    antenna: randB() < 0.3,
                    notch: randB() < 0.35,
                    notchSide: randB() < 0.5 ? 0 : 1,
                });
                bx += bw + 0.002;
            }

            // ---- Clouds (no stars — they contradict a heavy-rain scene) ----
            const randS = this.rng(5511);
            this.clouds = [];
            for (let i = 0; i < 9; i++) {
                this.clouds.push({
                    x: randS(),
                    y: 0.06 + randS() * 0.18,
                    w: 0.16 + randS() * 0.28,
                    h: 0.04 + randS() * 0.05,
                    drift: 0.0010 + randS() * 0.0020,
                    densPhase: randS() * Math.PI * 2,
                });
            }
            // A second deterministic moon-veil cloud layer that ALWAYS sits in
            // front of the moon at any given cycle position, soft and slow.
            this.moonVeils = [];
            for (let i = 0; i < 4; i++) {
                this.moonVeils.push({
                    offset: -0.12 + randS() * 0.24,
                    wMul: 1.4 + randS() * 1.0,
                    hMul: 0.6 + randS() * 0.5,
                    densPhase: randS() * Math.PI * 2,
                });
            }

            // ---- Interior products ----
            this.products = [];
            const randP = this.rng(7);
            const typePool = ['bottle', 'box', 'bag', 'can', 'onigiri', 'ramen', 'ramen', 'bento', 'bento', 'snackbag'];
            for (let s = 0; s < 3; s++) {
                for (let i = 0; i < 18; i++) {
                    const type = typePool[(randP() * typePool.length) | 0];
                    // Tighter base-W ranges so products don't dominate each other.
                    const baseW = type === 'onigiri'   ? 0.030 + randP() * 0.012
                                : type === 'can'       ? 0.020 + randP() * 0.008
                                : type === 'bottle'    ? 0.018 + randP() * 0.008
                                : type === 'ramen'     ? 0.032 + randP() * 0.012
                                : type === 'bento'     ? 0.045 + randP() * 0.014
                                : type === 'snackbag'  ? 0.034 + randP() * 0.014
                                : 0.026 + randP() * 0.018;
                    const baseH = type === 'onigiri'   ? 0.42 + randP() * 0.12
                                : type === 'can'       ? 0.50 + randP() * 0.15
                                : type === 'bottle'    ? 0.70 + randP() * 0.18
                                : type === 'ramen'     ? 0.58 + randP() * 0.15
                                : type === 'bento'     ? 0.28 + randP() * 0.08
                                : type === 'snackbag'  ? 0.65 + randP() * 0.18
                                : 0.55 + randP() * 0.22;
                    this.products.push({
                        shelf: s,
                        x: randP(),
                        w: baseW,
                        h: baseH,
                        type,
                        hue: (randP() * 360) | 0,
                        sat: 30 + randP() * 50,
                        accent: (randP() * 360) | 0,
                        fillTone: randP(),
                    });
                }
            }

            // ---- Magazine spines ----
            const randM = this.rng(811);
            this.magazines = [];
            for (let i = 0; i < 28; i++) {
                this.magazines.push({
                    hue: (randM() * 360) | 0,
                    sat: 60 + randM() * 30,
                    light: 50 + randM() * 20,
                    bandHue: (randM() * 360) | 0,
                    height: 0.92 + randM() * 0.08,
                    width: 0.85 + randM() * 0.30,
                    titleY: 0.18 + randM() * 0.10,
                });
            }

            // ---- Door posters (decals stuck on glass) ----
            const randD = this.rng(404);
            this.doorPosters = [];
            const posterPalette = ['#e83a3a', '#ffb83a', '#2ab85a', '#3a78e8', '#c43a7a', '#1aa8c4'];
            for (let i = 0; i < 5; i++) {
                this.doorPosters.push({
                    side: i < 2 ? 'L' : i < 4 ? 'R' : 'C',
                    yk: 0.05 + randD() * 0.45,
                    xk: 0.05 + randD() * 0.70,
                    w: 0.20 + randD() * 0.30,
                    h: 0.16 + randD() * 0.18,
                    color: posterPalette[(randD() * posterPalette.length) | 0],
                    stripeColor: posterPalette[(randD() * posterPalette.length) | 0],
                    type: (randD() * 3) | 0,
                });
            }

            // ---- Side-pane posters ----
            this.sidePanePosters = [];
            for (let i = 0; i < 4; i++) {
                this.sidePanePosters.push({
                    side: i < 2 ? 'L' : 'R',
                    yk: 0.04 + randD() * 0.40,
                    w: 0.16 + randD() * 0.12,
                    h: 0.20 + randD() * 0.16,
                    color: posterPalette[(randD() * posterPalette.length) | 0],
                    stripeColor: posterPalette[(randD() * posterPalette.length) | 0],
                });
            }

            // ---- Rain split: near + far layers ----
            this.rainNear = [];
            for (let i = 0; i < 70; i++) this.rainNear.push(this.makeRainNear(false));
            this.rainFar = [];
            for (let i = 0; i < 180; i++) this.rainFar.push(this.makeRainFar(false));

            // ---- Ripples ----
            this.ripples = [];
            this.nextRippleMs = 200;

            // ---- Awning drips (pooled) ----
            this.awningDrips = [];
            this.nextDripMs = 1200;
            // Deterministic horizontal drip slots so they look like fixed seams
            const randAD = this.rng(317);
            this.dripSlots = [];
            for (let i = 0; i < 7; i++) this.dripSlots.push(0.10 + randAD() * 0.80);

            // ---- Puddles (irregular blob shapes) ----
            const randPud = this.rng(2247);
            this.puddles = [];
            for (let i = 0; i < 7; i++) {
                // Each puddle is described as a closed sequence of points
                // forming a blob silhouette.
                const cx = 0.04 + randPud() * 0.92;
                const cy = 0.84 + randPud() * 0.12;
                const baseW = 24 + randPud() * 60;
                const baseH = baseW * (0.16 + randPud() * 0.10);
                const nodes = 8 + ((randPud() * 4) | 0);
                const pts = [];
                for (let k = 0; k < nodes; k++) {
                    const ang = (k / nodes) * Math.PI * 2;
                    const noise = 0.70 + randPud() * 0.55;
                    pts.push({
                        dx: Math.cos(ang) * baseW * noise,
                        dy: Math.sin(ang) * baseH * noise,
                    });
                }
                this.puddles.push({
                    xk: cx,
                    yk: cy,
                    w: baseW,
                    h: baseH,
                    pts,
                    shimmerPhase: randPud() * Math.PI * 2,
                });
            }

            // ---- Wind / gust ----
            this.windPhase = 0;
            this.gustStrength = 0;
            this.nextGustMs = 5500 + Math.random() * 5000;

            // ---- Door state machine ----
            this.door = {
                state: 'closed',
                t: 0,
                openProgress: 0,
                nextEventMs: 18000 + Math.random() * 30000,
                customerDir: 1,         // +1 entering (left → right through door), -1 exiting
                customerVariant: 'umbrella-bag',
                holdMs: 1000,
                holdRemaining: 0,
            };

            // ---- Passerby clusters ----
            this.passersby = [];
            this.clusterRemaining = 0;
            this.nextClusterMs = 8000 + Math.random() * 6000;
            this.nextSpawnInClusterMs = 0;

            // ---- Scooter ----
            this.scooter = null;
            this.nextScooterMs = 40000 + Math.random() * 60000;

            // ---- Background headlight pass ----
            this.bgHeadlight = null;
            this.nextBgHeadlightMs = 14000 + Math.random() * 20000;

            // ---- Traffic light ----
            this.trafficLight = { state: TRAFFIC_CYCLE[0].state, stateMs: 0, stateIdx: 0 };

            // ---- Customer inside, browsing ----
            this.customerVisible = false;
            this.customerNextMs = 9000;
            this.customerVariant = 0;
            this.customerBaseDrift = 0.30;

            // ---- Sign flicker ----
            this.signFlickerNext = 0;
            this.signOn = 1;
            this.tagFlickerNext = 0;
            this.tagOn = 1;

            // ---- Interior fluorescent tube flicker (2 of 4 occasionally drop) ----
            this.fluorTubes = [
                { xk: 0.18, dropChance: 0,     dropMs: 0 },
                { xk: 0.42, dropChance: 0.018, dropMs: 0 },
                { xk: 0.66, dropChance: 0,     dropMs: 0 },
                { xk: 0.88, dropChance: 0.024, dropMs: 0 },
            ];

            // ---- Hot food steam ----
            this.foodSteam = [];
            this.nextFoodSteamMs = 3000;

            // ---- Reflection zone cache (populated in resize) ----
            this._reflectionZones = [];
            // ---- Anchored layout (populated in resize) ----
            this._layout = null;

            // ---- Interactive clicks ----
            this.handlePointerDown = (e) => {
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                const L = this._layout;
                if (!L) return;
                
                // 1. Did they click in the door region?
                if (x >= L.doorLeft && x <= L.doorLeft + L.doorW && y >= L.winTop && y <= L.winBottom) {
                    this.triggerDoorInteract();
                    return;
                }
                
                // 2. Did they click on the street (road region)?
                const h = this.height;
                const sidewalkBot = this.groundY + (h - this.groundY) * 0.22;
                if (y >= sidewalkBot && y <= h) {
                    this.triggerScooterInteract();
                    return;
                }
                
                // 3. Did they click on the sidewalk?
                if (y >= this.groundY && y < sidewalkBot) {
                    this.triggerPasserbyInteract();
                    return;
                }
            };
            this.canvas.addEventListener('pointerdown', this.handlePointerDown);
        }

        destroy() {
            if (this.handlePointerDown) {
                this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
            }
            super.destroy();
        }

        triggerDoorInteract() {
            const d = this.door;
            if (d.state === 'closed' || d.state === 'closing') {
                d.state = 'opening';
                d.t = 0;
                d.customerDir = Math.random() < 0.5 ? 1 : -1;
                d.customerVariant = Math.random() < 0.7 ? 'umbrella-bag' : 'umbrella-plain';
                d.holdMs = 2000 + Math.random() * 2000;
            }
        }

        triggerScooterInteract() {
            const w = this.width;
            if (!this.scooter) {
                const dir = Math.random() < 0.5 ? 1 : -1;
                this.scooter = {
                    x: dir > 0 ? -80 : w + 80,
                    dir,
                    speed: 150 + Math.random() * 60,
                    bobPhase: Math.random() * 100,
                    boxColor: Math.random() < 0.5 ? '#e83a3a' : '#3a78e8',
                };
            } else {
                this.scooter.speed += 80;
            }
        }

        triggerPasserbyInteract() {
            const dir = Math.random() < 0.5 ? 1 : -1;
            const w = this.width;
            const umbrellaColors = ['#7a0f1a', '#1f3a6a', '#3a3a3a', '#1a5a3a', '#5a3a1a', '#2a1a3a'];
            const coatColors = ['#06080d', '#0c0e1a', '#1a1418', '#0e1820'];
            
            const variantKind = Math.random();
            const kind = variantKind < 0.25 ? 'hoodie' : variantKind < 0.5 ? 'briefcase' : variantKind < 0.75 ? 'umbrella-bag' : 'umbrella-plain';

            this.passersby.push({
                x: dir > 0 ? -40 : w + 40,
                dir,
                speed: 38 + Math.random() * 18,
                bob: Math.random() * 10,
                coatCol: coatColors[(Math.random() * coatColors.length) | 0],
                umbrellaCol: umbrellaColors[(Math.random() * umbrellaColors.length) | 0],
                umbrellaTilt: (Math.random() - 0.5) * 0.35,
                yOffset: (Math.random() - 0.5) * 6,
                bagPosey: (Math.random() - 0.5) * 3,
                variant: kind,
            });
        }

        // --- Pool factories ---
        makeRainNear(seedTop) {
            return {
                x: Math.random() * 1.1 - 0.05,
                y: seedTop ? Math.random() * -0.25 : Math.random() * 1.0,
                len: 24 + Math.random() * 26,
                speed: 700 + Math.random() * 280,
                alpha: 0.40 + Math.random() * 0.30,
                width: 1.1 + Math.random() * 0.5,
            };
        }
        makeRainFar(seedTop) {
            return {
                x: Math.random() * 1.1 - 0.05,
                y: seedTop ? Math.random() * -0.25 : Math.random() * 1.0,
                len: 5 + Math.random() * 8,
                speed: 360 + Math.random() * 160,
                alpha: 0.10 + Math.random() * 0.18,
                width: 0.7,
            };
        }

        resize(w, h) {
            super.resize(w, h);
            // Sprite scale for actors/props authored in fixed local px.
            this.s = this.sceneScale(720, 0.8, 2.2);
            this.groundY = h * 0.80;
            this.storeY = h * 0.42;
            this.signCy = this.storeY - 34 * this.s;
            this.storeLeft = w * 0.20;
            this.storeRight = w * 0.78;

            const sw = this.storeRight - this.storeLeft;
            // Responsive fonts — sized from the storefront so signage stays
            // legible (and proportionate) at every resolution.
            const kanaStack = "'Yu Gothic UI','Yu Gothic','Hiragino Kaku Gothic ProN','Meiryo','MS Gothic',sans-serif";
            this._fontKanaBig = `900 ${Math.max(16, Math.round(sw * 0.040))}px ${kanaStack}`;
            this._fontKanaSub = `700 ${Math.max(8, Math.round(sw * 0.016))}px ${kanaStack}`;
            this._fontKanaTiny = `700 ${Math.max(6, Math.round(sw * 0.0125))}px ${kanaStack}`;
            this._fontLatin = `900 ${Math.max(8, Math.round(sw * 0.016))}px 'Helvetica Neue','Arial Black',sans-serif`;

            const winLeft = this.storeLeft + sw * 0.06;
            const winRight = this.storeLeft + sw * 0.94;
            const winTop = this.storeY + 22;
            const winBottom = this.groundY - 24;
            const winW = winRight - winLeft;
            const winH = winBottom - winTop;

            // Door cap scales with the viewport (the old 130px cap squeezed
            // the doorway at 1440p+).
            const doorW = Math.min(sw * 0.20, w * 0.11);
            const doorLeft = this.storeLeft + sw * 0.50 - doorW * 0.5;

            const fridgeW = winW * 0.26;
            const shelfArea = {
                x: winLeft + fridgeW + 6,
                w: winW - fridgeW - 12,
                y: winTop + 14,
                h: winH - 28,
            };

            const counterY = winBottom - 26;
            const counterH = 16;
            const counterLeft = winLeft + winW * 0.55;
            const counterRight = winRight - 6;

            // Vending machine cluster: a soda machine + smaller coffee machine.
            // Sized so the tops sit comfortably below the storefront sign — not
            // competing with the storefront vertically.
            const vmH = (this.groundY - this.storeY) * 0.74;
            const vmW = vmH * 0.50;
            const vmX = this.storeLeft - vmW - 22 * this.s;
            const vmY = this.groundY - vmH;
            const vm2H = vmH * 0.88;
            const vm2W = vm2H * 0.46;
            const vm2X = vmX - vm2W - 6 * this.s;
            const vm2Y = this.groundY - vm2H;

            // Street furniture offsets scale with the scene so the layout
            // composition holds at any resolution.
            const streetlightX = vm2X - 80 * this.s;
            const sandwichX = this.storeLeft - 60 * this.s;
            const trashX = this.storeRight + 10 * this.s;
            const bikeX = this.storeRight + 96 * this.s;

            this._layout = {
                sw, winLeft, winRight, winTop, winBottom, winW, winH,
                fridgeW,
                shelfArea,
                doorW, doorLeft,
                counterY, counterH, counterLeft, counterRight,
                vmW, vmH, vmX, vmY,
                vm2W, vm2H, vm2X, vm2Y,
                streetlightX,
                sandwichX,
                trashX,
                bikeX,
            };

            // ---- Precompute reflection zones ----
            // Each zone: x range + rgba color prefix + amplitude multiplier.
            this._reflectionZones = [
                {
                    x: winLeft, w: winW,
                    rgbaPrefix: 'rgba(232, 214, 156, ',
                    alphaScale: 0.34,
                    ampMul: 3.4,
                    yStep: 2,
                    isWindow: true,
                },
                {
                    x: this.storeLeft + sw * 0.16, w: sw * 0.68,
                    rgbaPrefix: 'rgba(126, 196, 252, ',
                    alphaScale: 0.22,
                    ampMul: 4.6,
                    yStep: 2,
                    isSign: true,
                },
                {
                    x: vmX, w: vmW,
                    rgbaPrefix: 'rgba(118, 178, 252, ',
                    alphaScale: 0.26,
                    ampMul: 4.0,
                    yStep: 3,
                    isVm1: true,
                },
                {
                    x: vm2X, w: vm2W,
                    rgbaPrefix: 'rgba(196, 152, 252, ',
                    alphaScale: 0.22,
                    ampMul: 3.6,
                    yStep: 3,
                    isVm2: true,
                },
            ];
            this._streetlightX = streetlightX;
        }

        currentAtmo(t) {
            const cycle = (t / DAY_CYCLE_MS + CYCLE_START) % 1;
            const { a, b, k } = pickStop(ATMO_STOPS, cycle);
            return {
                cycle,
                top: this.mixColor(a.top, b.top, k),
                horizon: this.mixColor(a.horizon, b.horizon, k),
                tint: this.mixColor(a.tint, b.tint, k),
                dark: a.dark + (b.dark - a.dark) * k,
            };
        }

        render(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const atmo = this.currentAtmo(t);
            this.atmo = atmo;

            // ---- Update wind / gust ----
            this.windPhase += dt * 0.001;
            this.nextGustMs -= dt;
            if (this.nextGustMs <= 0) {
                this.gustStrength = 6 + Math.random() * 10;
                this.nextGustMs = 5000 + Math.random() * 9000;
            } else {
                this.gustStrength *= Math.pow(0.5, dt / 1500);
            }
            const windBase = Math.sin(this.windPhase * 1.2) * 1.5;
            const windNow = windBase + this.gustStrength * Math.sin(this.windPhase * 2.6);

            // ---- Update traffic light ----
            this.trafficLight.stateMs += dt;
            const tcyc = TRAFFIC_CYCLE[this.trafficLight.stateIdx];
            if (this.trafficLight.stateMs >= tcyc.ms) {
                this.trafficLight.stateIdx = (this.trafficLight.stateIdx + 1) % TRAFFIC_CYCLE.length;
                this.trafficLight.state = TRAFFIC_CYCLE[this.trafficLight.stateIdx].state;
                this.trafficLight.stateMs = 0;
            }

            // ---- Update fluorescent tube flickers ----
            for (let i = 0; i < this.fluorTubes.length; i++) {
                const tube = this.fluorTubes[i];
                if (tube.dropMs > 0) {
                    tube.dropMs -= dt;
                } else if (tube.dropChance > 0 && Math.random() < tube.dropChance * (dt / 16)) {
                    tube.dropMs = 60 + Math.random() * 220;
                }
            }

            // ---- Update door state machine ----
            this.updateDoor(dt);

            // ---- Update interior customer ----
            this.customerNextMs -= dt;
            if (this.customerNextMs <= 0) {
                this.customerVisible = !this.customerVisible;
                if (this.customerVisible) this.customerVariant = (Math.random() * 3) | 0;
                this.customerNextMs = 7000 + Math.random() * 14000;
            }
            // Fade in/out (~400ms) instead of popping.
            {
                const target = this.customerVisible ? 1 : 0;
                const step = dt / 400;
                if (this.customerAlpha === undefined) this.customerAlpha = target;
                this.customerAlpha = target > this.customerAlpha
                    ? Math.min(target, this.customerAlpha + step)
                    : Math.max(target, this.customerAlpha - step);
            }

            // ---- Sign flickers ----
            this.signFlickerNext -= dt;
            if (this.signFlickerNext <= 0) {
                this.signOn = Math.random() < 0.04 ? 0.5 : 1;
                this.signFlickerNext = 80 + Math.random() * 280;
            }
            this.tagFlickerNext -= dt;
            if (this.tagFlickerNext <= 0) {
                this.tagOn = Math.random() < 0.06 ? 0.35 : 1;
                this.tagFlickerNext = 110 + Math.random() * 240;
            }

            // ===========================================================
            //                       RENDER PASS
            // ===========================================================

            // 1) Sky + sun/moon + stars
            this.drawSkyAndCelestial(atmo, t);
            // 2) Distant city
            this.drawDistantCity(atmo, t);
            // 2b) Background power lines (between distant poles)
            this.drawBackgroundPowerLines(atmo, windNow);
            // 3) Traffic light (small far dot, above buildings, behind storefront)
            this.drawTrafficLight(t);
            // 4) Atmospheric haze behind storefront
            this.drawAtmosphericHaze(atmo);
            // 5) Storefront frame
            this.drawStorefrontFrame();
            // 6) Interior background + ceiling fluorescents
            this.drawInteriorBackground(t);
            // 7) Fridge wall
            this.drawFridge(t);
            // 8) Magazine rack
            this.drawMagazineRack();
            // 9) Main shelves + products
            this.drawProducts(t);
            // 10) Hot food case + steam emit
            this.drawHotFoodCase(t, dt);
            // 10b) Cigarette wall behind the counter
            this.drawCigaretteWall();
            // 11) Counter + register + cashier
            this.drawCounterAndRegister();
            // 12) Browsing customer inside
            if (this.customerAlpha > 0.01) this.drawBrowsingCustomer(t);
            // 13) Window mullion stroke
            this.drawWindowMullion();
            // 14) Side-pane posters
            this.drawSidePanePosters();
            // 15) Sliding doors
            this.drawSlidingDoors(t, windNow);
            // 16) Door posters
            this.drawDoorPosters();
            // 16b) Payment-sticker stack (Suica/PASMO/PayPay/iD/QUICPay/nanaco)
            this.drawDoorStickerStack();
            // 17) Entering / exiting figure
            if (this.door.state !== 'closed') this.drawDoorFigure(t);
            // 18) Noren over doors (with wind + door-open boost)
            this.drawNoren(t, windNow);
            // 19) Sign (halo first, then panel, bands, kana)
            this.drawKonbiniSign(t, windNow);
            // 20) 24h tag
            this.drawOpen24Tag(t);
            // 21) Streetlight
            this.drawStreetlight();
            // 22) Vending cluster (back machine first)
            this.drawVendingCluster(t);
            // 22b) Nobori vertical banner (flutters with wind)
            this.drawNoboriBanner(t, windNow);
            // 23) Sandwich-board sign
            this.drawSandwichBoard();
            // 24) Trash bins + standing ashtray
            this.drawTrashBins();
            this.drawAshtray();
            // 25) Bike rack with multiple parked bikes
            this.drawBike();
            // 26) Ground fill
            this.drawGround();
            // 27) Puddles (base ellipses)
            this.drawPuddles(t, atmo, true);
            // 27b) Mullion shadows on the wet pavement (sharp dark lines forward)
            this.drawMullionShadows(atmo);
            // 28) Reflections (additive distorted bands)
            this.drawReflectionsLayered(t, atmo);
            // 28b) Colored light pools directly under VMs / sign
            this.drawColoredLightPools(t, atmo);
            // 29) Door spill (extra warm puddle while open)
            this.drawDoorSpill(atmo);
            // 29b) Ground-level mist (softens distant pavement)
            this.drawGroundMist(atmo);
            // 30) Background headlight pass
            this.updateAndDrawBgHeadlight(t, dt);
            // 31) Passerby cluster + scooter
            this.updateAndDrawPasserby(t, dt, windNow);
            this.updateAndDrawScooter(t, dt);
            // 32) Awning drips
            this.updateAndDrawAwningDrips(t, dt, windNow);
            // 33) Far rain
            this.drawFarRain(t, dt, windNow);
            // 34) Puddle sheen
            this.drawPuddles(t, atmo, false);
            // 35) Near rain
            this.drawNearRain(t, dt, windNow);
            // 35b) Rain catching light in front of bright sources (additive streaks)
            this.drawRainLightCatch(atmo);
            // 35c) Splash dots at rain ground impact
            this.drawSplashDots(t, dt);
            // 36) Ripples
            this.updateAndDrawRipples(dt);
            // 37) Foreground utility pole + cables — sits in front of everything
            //     except rain that's right at the camera
            this.drawForegroundUtilityPole(atmo, windNow);
        }

        // =========================================================
        // SKY + CELESTIAL + DISTANT CITY
        // =========================================================
        drawSkyAndCelestial(atmo, t) {
            const c = this.ctx;
            const w = this.width;

            const sky = c.createLinearGradient(0, 0, 0, this.groundY);
            sky.addColorStop(0, atmo.top);
            sky.addColorStop(1, atmo.horizon);
            c.fillStyle = sky;
            c.fillRect(0, 0, w, this.groundY);

            // Sun/moon arc. cycle: 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk.
            const cycle = atmo.cycle;
            const elevation = Math.sin(2 * Math.PI * cycle - Math.PI / 2); // -1..1
            const isDay = elevation > 0;
            const bodyX = w * (0.08 + cycle * 0.84);
            const bodyY = this.storeY * 0.95 - elevation * this.storeY * 0.78;

            if (isDay) {
                // Sun
                const sunR = 22 + 10 * Math.max(0, 1 - atmo.dark);
                c.save();
                c.globalCompositeOperation = 'lighter';
                const sunGlow = c.createRadialGradient(bodyX, bodyY, sunR * 0.4, bodyX, bodyY, sunR * 5);
                const warmth = 1 - this.clamp((elevation - 0.05) * 1.6, 0, 1);
                const sunColor = this.mixColor('#fff2c4', '#ffb070', warmth);
                sunGlow.addColorStop(0, sunColor);
                sunGlow.addColorStop(0.25, 'rgba(255, 200, 140, 0.30)');
                sunGlow.addColorStop(1, 'rgba(255, 180, 110, 0)');
                c.fillStyle = sunGlow;
                c.fillRect(bodyX - sunR * 5, bodyY - sunR * 5, sunR * 10, sunR * 10);
                c.fillStyle = sunColor;
                c.beginPath();
                c.arc(bodyX, bodyY, sunR, 0, Math.PI * 2);
                c.fill();
                c.restore();
            } else {
                // Moon (opposite-side arc) — veiled by clouds on a rainy night
                const moonCycle = (cycle + 0.5) % 1;
                const moonEl = Math.sin(2 * Math.PI * moonCycle - Math.PI / 2);
                if (moonEl > -0.2) {
                    const moonX = w * (0.08 + moonCycle * 0.84);
                    const moonY = this.storeY * 0.95 - moonEl * this.storeY * 0.72;
                    const moonR = 17;
                    c.save();
                    c.globalCompositeOperation = 'lighter';
                    // Wide hazy halo from moisture/clouds
                    const mglow = c.createRadialGradient(moonX, moonY, moonR * 0.3, moonX, moonY, moonR * 6);
                    mglow.addColorStop(0, `rgba(228, 228, 248, ${0.36 * atmo.dark})`);
                    mglow.addColorStop(0.4, `rgba(200, 210, 240, ${0.16 * atmo.dark})`);
                    mglow.addColorStop(1, 'rgba(200, 210, 240, 0)');
                    c.fillStyle = mglow;
                    c.fillRect(moonX - moonR * 6, moonY - moonR * 6, moonR * 12, moonR * 12);
                    // Soft moon disc — slightly transparent so cloud veil reads
                    c.fillStyle = `rgba(228, 226, 240, ${atmo.dark * 0.85})`;
                    c.beginPath();
                    c.arc(moonX, moonY, moonR, 0, Math.PI * 2);
                    c.fill();
                    c.restore();
                    // Cloud veil — drawn over the moon to break up the perfect circle
                    c.save();
                    for (let v = 0; v < this.moonVeils.length; v++) {
                        const veil = this.moonVeils[v];
                        const vx = moonX + moonR * veil.offset * 2;
                        const vy = moonY + moonR * 0.05;
                        const vw = moonR * veil.wMul;
                        const vh = moonR * veil.hMul;
                        const vd = 0.45 + 0.30 * Math.sin(t * 0.0003 + veil.densPhase);
                        const vg = c.createRadialGradient(vx, vy, vh * 0.1, vx, vy, vw);
                        const vTint = atmo.dark > 0.5 ? '90, 95, 120' : '150, 150, 170';
                        vg.addColorStop(0, `rgba(${vTint}, ${vd * atmo.dark * 0.85})`);
                        vg.addColorStop(0.7, `rgba(${vTint}, ${vd * atmo.dark * 0.30})`);
                        vg.addColorStop(1, `rgba(${vTint}, 0)`);
                        c.fillStyle = vg;
                        c.fillRect(vx - vw, vy - vh, vw * 2, vh * 2);
                    }
                    c.restore();
                }
            }

            // Drifting cloud layer (lighter than sky, slightly warm from city light pollution)
            c.save();
            for (let i = 0; i < this.clouds.length; i++) {
                const cl = this.clouds[i];
                const cx2 = ((cl.x + t * cl.drift * 0.001) % 1) * w;
                const cy2 = cl.y * this.storeY;
                const cw = cl.w * w;
                const ch = cl.h * this.storeY;
                const dens = 0.55 + 0.25 * Math.sin(t * 0.00012 + cl.densPhase);
                const grad = c.createRadialGradient(cx2, cy2, ch * 0.2, cx2, cy2, cw * 0.5);
                const baseAlpha = dens * (0.18 + atmo.dark * 0.10);
                const cloudTint = atmo.dark > 0.5 ? '180, 170, 200' : '230, 220, 230';
                grad.addColorStop(0, `rgba(${cloudTint}, ${baseAlpha})`);
                grad.addColorStop(0.6, `rgba(${cloudTint}, ${baseAlpha * 0.4})`);
                grad.addColorStop(1, `rgba(${cloudTint}, 0)`);
                c.fillStyle = grad;
                c.fillRect(cx2 - cw * 0.5, cy2 - ch, cw, ch * 2);
                // Wrap-around for clouds near the right edge
                if (cx2 + cw * 0.5 > w) {
                    c.fillStyle = grad;
                    c.fillRect(cx2 - cw * 0.5 - w, cy2 - ch, cw, ch * 2);
                }
            }
            c.restore();
        }

        drawDistantCity(atmo, t) {
            const c = this.ctx;
            const w = this.width, h = this.height;

            for (let i = 0; i < this.buildings.length; i++) {
                const b = this.buildings[i];
                const bx = b.x * w;
                const bw = b.w * w;
                const bh = b.h * h;
                const by = this.storeY - bh + 6;
                // Darker, slightly bluer in night
                const baseShade = atmo.dark > 0.5 ? '#080d1c' : '#1a2438';
                c.fillStyle = this.mixColor(baseShade, atmo.horizon, 0.08);
                c.fillRect(bx, by, bw, bh);
                if (b.antenna) {
                    c.fillStyle = baseShade;
                    c.fillRect(bx + bw * 0.5 - 0.5, by - 16, 1, 16);
                    c.fillRect(bx + bw * 0.5 - 2, by - 16, 4, 1.5);
                }
                if (b.notch) {
                    c.fillStyle = baseShade;
                    const nx = b.notchSide === 0 ? bx + bw * 0.10 : bx + bw * 0.62;
                    c.fillRect(nx, by - 6, bw * 0.28, 6);
                }
            }
            // City windows — meaningfully visible only at night.
            // Alpha is quantized into a small shared color table so the loop
            // doesn't build ~240 rgba strings per frame.
            const winK = Math.pow(atmo.dark, 0.7);
            if (winK > 0.05) {
                if (!this._cityWinColors) {
                    this._cityWinColors = [];
                    for (let q = 0; q <= 32; q++) {
                        this._cityWinColors[q] = `rgba(255, 218, 130, ${(q / 32).toFixed(3)})`;
                    }
                }
                for (let i = 0; i < this.cityWindows.length; i++) {
                    const cw = this.cityWindows[i];
                    const px = cw.x * w;
                    const py = this.storeY * 0.30 + cw.y * this.storeY * 0.65;
                    if (py > this.storeY - 4) continue;
                    let bri = cw.bri;
                    if (cw.flicker) bri *= 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.008 + cw.phase));
                    const q = Math.min(32, Math.round(bri * 0.78 * winK * 32));
                    if (q === 0) continue;
                    c.fillStyle = this._cityWinColors[q];
                    c.fillRect(px, py, 1.4, 1.4);
                }
            }
        }

        // Background power lines: thin cables spanning the sky between distant
        // utility poles. They sway slightly with wind.
        drawBackgroundPowerLines(atmo, windNow) {
            const c = this.ctx;
            const w = this.width;
            const polePairs = [
                { x1: w * 0.02, x2: w * 0.40, y1: this.storeY * 0.30, y2: this.storeY * 0.36, color: 'rgba(8, 12, 22, 0.75)' },
                { x1: w * 0.45, x2: w * 0.95, y1: this.storeY * 0.32, y2: this.storeY * 0.28, color: 'rgba(8, 12, 22, 0.75)' },
            ];
            for (const pp of polePairs) {
                for (let k = 0; k < 3; k++) {
                    const offset = (k - 1) * 3;
                    const sag = 10 + Math.abs(windNow) * 0.3;
                    c.strokeStyle = pp.color;
                    c.lineWidth = 0.8;
                    c.beginPath();
                    c.moveTo(pp.x1, pp.y1 + offset);
                    c.quadraticCurveTo((pp.x1 + pp.x2) * 0.5, (pp.y1 + pp.y2) * 0.5 + offset + sag, pp.x2, pp.y2 + offset);
                    c.stroke();
                }
            }
        }

        // Foreground utility pole + cross-arm + insulators + cables going to the
        // right edge. This is the dominant left-edge silhouette that adds depth
        // and shifts the visual weight, addressing the "rule of thirds" miss.
        drawForegroundUtilityPole(atmo, windNow) {
            const c = this.ctx;
            const h = this.height;
            const w = this.width;
            const poleX = w * 0.045;
            const poleW = 6;
            const poleTop = this.storeY * 0.05;
            const poleBot = this.groundY + 6;
            // Pole body
            c.fillStyle = '#0a0d18';
            c.fillRect(poleX, poleTop, poleW, poleBot - poleTop);
            // Subtle highlight on left edge
            c.fillStyle = 'rgba(60, 80, 100, 0.20)';
            c.fillRect(poleX, poleTop, 1, poleBot - poleTop);
            // Number tag
            c.fillStyle = '#3a3a3a';
            c.fillRect(poleX - 4, poleBot - 70, 14, 10);
            c.fillStyle = '#fff';
            c.font = "700 6px 'Yu Gothic UI', sans-serif";
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('NK-217', poleX + 3, poleBot - 65);
            // Step bolts (zigzag pegs up the side)
            c.fillStyle = '#1a1d28';
            for (let k = 0; k < 10; k++) {
                const ky = poleTop + 30 + k * 26;
                if (ky > poleBot - 50) break;
                const side = k % 2 === 0 ? -3 : 6;
                c.fillRect(poleX + side, ky, 3, 1.6);
            }
            // Two cross-arms with insulators
            const armY1 = poleTop + 36;
            const armY2 = poleTop + 64;
            for (const armY of [armY1, armY2]) {
                c.fillStyle = '#161a26';
                c.fillRect(poleX - 26, armY, 60, 4);
                // Insulators on top of the arm
                c.fillStyle = '#0a0d18';
                for (let k = 0; k < 4; k++) {
                    const ix = poleX - 22 + k * 16;
                    c.fillRect(ix, armY - 5, 3, 5);
                    // ceramic disc top
                    c.fillStyle = '#cfd5d8';
                    c.fillRect(ix - 1, armY - 6, 5, 1.6);
                    c.fillStyle = '#0a0d18';
                }
            }
            // Transformer barrel
            c.fillStyle = '#1a1e28';
            c.fillRect(poleX + 10, armY1 + 6, 14, 22);
            c.fillStyle = '#2a2f3c';
            c.fillRect(poleX + 10, armY1 + 6, 14, 2);
            c.fillRect(poleX + 10, armY1 + 26, 14, 2);
            c.fillStyle = '#cfd5d8';
            c.fillRect(poleX + 13, armY1 + 4, 1.6, 4);
            // Cables sweeping to the right edge (4 cables from each arm)
            c.save();
            c.strokeStyle = 'rgba(10, 13, 20, 0.85)';
            c.lineWidth = 1.2;
            const cableEndX = w + 30;
            for (const armY of [armY1, armY2]) {
                for (let k = 0; k < 4; k++) {
                    const ix = poleX - 22 + k * 16 + 1.5;
                    const iy = armY - 6;
                    // End point varies per cable so they don't perfectly converge
                    const endY = iy + 30 + k * 18 + windNow * 0.3;
                    const sag = 30 + k * 6;
                    c.beginPath();
                    c.moveTo(ix, iy);
                    c.quadraticCurveTo((ix + cableEndX) * 0.5, iy + sag, cableEndX, endY);
                    c.stroke();
                }
            }
            // Thicker high-tension cable across the top
            c.lineWidth = 1.8;
            c.strokeStyle = 'rgba(8, 11, 18, 0.95)';
            c.beginPath();
            c.moveTo(poleX + 3, poleTop + 14);
            c.quadraticCurveTo(w * 0.5, poleTop + 70 + windNow * 0.5, w + 30, poleTop + 30);
            c.stroke();
            c.restore();
        }

        drawTrafficLight(t) {
            const c = this.ctx;
            const w = this.width;
            const tx = w * 0.06;
            const ty = this.storeY * 0.45;
            const tl = this.trafficLight;
            // Tiny housing
            c.fillStyle = 'rgba(8, 12, 22, 0.85)';
            c.fillRect(tx - 2, ty - 5, 4, 14);
            c.fillStyle = 'rgba(15, 20, 32, 0.85)';
            c.fillRect(tx - 0.5, ty - 22, 1, 18);
            // Lamp colors
            let col;
            if (tl.state === 'red') col = 'rgba(255, 70, 60, 0.95)';
            else if (tl.state === 'green') col = 'rgba(80, 230, 130, 0.95)';
            else col = 'rgba(255, 200, 80, 0.95)';
            c.save();
            c.globalCompositeOperation = 'lighter';
            const grad = c.createRadialGradient(tx, ty, 0.5, tx, ty, 9);
            grad.addColorStop(0, col);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = grad;
            c.fillRect(tx - 9, ty - 9, 18, 18);
            c.restore();
            c.fillStyle = col;
            c.fillRect(tx - 1, ty - 1, 2, 2);
        }

        drawAtmosphericHaze(atmo) {
            if (atmo.dark < 0.10) return;
            const c = this.ctx;
            const w = this.width;
            const cx = (this.storeLeft + this.storeRight) * 0.5;
            const cy = (this.storeY + this.groundY) * 0.5;
            c.save();
            c.globalCompositeOperation = 'lighter';
            const haze = c.createRadialGradient(cx, cy, 30, cx, cy, w * 0.55);
            const ha = 0.10 * atmo.dark;
            haze.addColorStop(0, `rgba(255, 220, 150, ${ha})`);
            haze.addColorStop(0.5, `rgba(200, 180, 220, ${ha * 0.3})`);
            haze.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = haze;
            c.fillRect(0, this.storeY - 80, w, this.groundY - this.storeY + 160);
            c.restore();
        }

        // =========================================================
        // STOREFRONT FRAME
        // =========================================================
        drawStorefrontFrame() {
            const c = this.ctx;
            const L = this._layout;
            const sw = L.sw;

            // Side pillars + roof line
            c.fillStyle = '#080b14';
            c.fillRect(this.storeLeft - 14, this.storeY - 16, sw + 28, 6);
            c.fillStyle = '#0c111c';
            c.fillRect(this.storeLeft - 14, this.storeY - 10, sw + 28, 4);
            // pillars (slightly tapered shadow lines)
            c.fillStyle = '#0e1320';
            c.fillRect(this.storeLeft - 12, this.storeY - 6, 12, this.groundY - this.storeY + 6);
            c.fillRect(this.storeRight, this.storeY - 6, 12, this.groundY - this.storeY + 6);
            c.fillStyle = 'rgba(255, 255, 255, 0.05)';
            c.fillRect(this.storeLeft - 12, this.storeY - 6, 2, this.groundY - this.storeY + 6);
            c.fillRect(this.storeRight, this.storeY - 6, 2, this.groundY - this.storeY + 6);

            // Store body (interior wall behind glass — slightly cool tone)
            c.fillStyle = '#0e131e';
            c.fillRect(this.storeLeft, this.storeY, sw, this.groundY - this.storeY);

            // Awning band — compact, sits between the building roof and the
            // window. Provides a frame for the small "お弁当 / セール中 /
            // 新発売" banner. Restrained height so the storefront reads cleanly.
            const awnY = this.storeY - 2;
            const awnH = 15;
            // Top trim
            c.fillStyle = '#1a2030';
            c.fillRect(this.storeLeft - 6, awnY - 4, sw + 12, 4);
            // Main awning panel (off-white, lit from inside)
            c.fillStyle = '#f4f0e6';
            c.fillRect(this.storeLeft - 6, awnY, sw + 12, awnH);
            // Stripes on the awning: three thin stripes left, three right (orange/red/green)
            const stripes = ['#ff8a2a', '#e83a3a', '#23a85a'];
            const stripeW = 5;
            for (let i = 0; i < stripes.length; i++) {
                c.fillStyle = stripes[i];
                c.fillRect(this.storeLeft + 4 + i * (stripeW + 2), awnY + 4, stripeW, awnH - 8);
                c.fillRect(this.storeLeft + sw - 4 - (i + 1) * (stripeW + 2), awnY + 4, stripeW, awnH - 8);
            }
            // Brand band in the middle of the awning — proper typography
            c.save();
            c.font = this._fontKanaSub;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillStyle = '#162540';
            c.fillText('お弁当', this.storeLeft + sw * 0.32, awnY + awnH * 0.50);
            c.fillStyle = '#e8392a';
            c.fillText('セール中', this.storeLeft + sw * 0.50, awnY + awnH * 0.50);
            c.fillStyle = '#1ea84a';
            c.fillText('新発売', this.storeLeft + sw * 0.68, awnY + awnH * 0.50);
            c.restore();
            // Bottom trim
            c.fillStyle = '#1a2030';
            c.fillRect(this.storeLeft - 6, awnY + awnH, sw + 12, 3);

            // Panel seams on the storefront body (subtle vertical lines)
            c.fillStyle = 'rgba(255, 255, 255, 0.03)';
            for (let k = 1; k < 4; k++) {
                const sx = this.storeLeft + sw * (k / 4);
                c.fillRect(sx, this.storeY + 4, 1, this.groundY - this.storeY - 6);
            }

            // Door track (thin metallic strip at bottom of doors)
            c.fillStyle = '#52595e';
            c.fillRect(L.doorLeft - 4, L.winBottom - 2, L.doorW + 8, 4);
            c.fillStyle = '#1a1e25';
            c.fillRect(L.doorLeft - 4, L.winBottom - 2, L.doorW + 8, 1.4);
        }

        // Solid-block latin letters via fillRect, used on awning + sandwich board.
        // text: capital letters [A-Z, 0-9, space, lowercase h].
        drawBlockLatin(c, x, y, text, color, size) {
            c.fillStyle = color;
            const unit = size;
            const charW = unit * 4;
            const charH = unit * 5;
            const gap = unit * 1.2;
            let cx = x;
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                this.drawBlockLatinChar(c, cx, y, charW, charH, unit, ch);
                cx += charW + gap;
            }
        }

        drawBlockLatinChar(c, x, y, w, h, unit, ch) {
            const r = unit; // stroke thickness
            switch (ch) {
                case 'O':
                    c.fillRect(x, y, w, r);
                    c.fillRect(x, y + h - r, w, r);
                    c.fillRect(x, y, r, h);
                    c.fillRect(x + w - r, y, r, h);
                    break;
                case 'P':
                    c.fillRect(x, y, r, h);
                    c.fillRect(x, y, w, r);
                    c.fillRect(x + w - r, y, r, h * 0.55);
                    c.fillRect(x, y + h * 0.45 - r * 0.5, w, r);
                    break;
                case 'E':
                    c.fillRect(x, y, r, h);
                    c.fillRect(x, y, w, r);
                    c.fillRect(x, y + h * 0.5 - r * 0.5, w * 0.78, r);
                    c.fillRect(x, y + h - r, w, r);
                    break;
                case 'N':
                    c.fillRect(x, y, r, h);
                    c.fillRect(x + w - r, y, r, h);
                    {
                        // diagonal
                        c.save();
                        c.translate(x + r, y);
                        const len = Math.hypot(w - r * 2, h);
                        const ang = Math.atan2(h, w - r * 2);
                        c.rotate(ang);
                        c.fillRect(0, -r * 0.4, len, r);
                        c.restore();
                    }
                    break;
                case '2':
                    c.fillRect(x, y, w, r);                              // top bar
                    c.fillRect(x + w - r, y, r, h * 0.5);                // upper right
                    c.fillRect(x, y + h * 0.5 - r * 0.5, w, r);          // middle bar
                    c.fillRect(x, y + h * 0.5, r, h * 0.5);              // lower left
                    c.fillRect(x, y + h - r, w, r);                      // bottom bar
                    break;
                case '4':
                    c.fillRect(x, y, r, h * 0.55);                       // upper left
                    c.fillRect(x, y + h * 0.5 - r * 0.5, w, r);          // middle bar
                    c.fillRect(x + w - r, y, r, h);                      // right vertical
                    break;
                case 'h':
                    {
                        const hh = h * 0.78;
                        c.fillRect(x, y + h - hh, r, hh);
                        c.fillRect(x, y + h - hh * 0.55, w, r);
                        c.fillRect(x + w - r, y + h - hh * 0.55, r, hh * 0.55);
                    }
                    break;
                case ' ':
                    break;
                default:
                    c.fillRect(x, y, w, r);
                    c.fillRect(x, y + h - r, w, r);
                    c.fillRect(x, y, r, h);
                    c.fillRect(x + w - r, y, r, h);
                    break;
            }
        }

        // =========================================================
        // INTERIOR
        // =========================================================
        drawInteriorBackground(t) {
            const c = this.ctx;
            const L = this._layout;
            const { winLeft, winTop, winW, winH } = L;

            // Interior gradient (warmer than before, with subtle floor wash)
            const interior = c.createLinearGradient(0, winTop, 0, L.winBottom);
            interior.addColorStop(0, '#fdf6d2');
            interior.addColorStop(0.55, '#f2e8c2');
            interior.addColorStop(1, '#bdb392');
            c.fillStyle = interior;
            c.fillRect(winLeft, winTop, winW, winH);

            // Ceiling fluorescent grid — a band along top of interior
            const ceilY = winTop + 4;
            const ceilH = 6;
            c.fillStyle = 'rgba(232, 244, 250, 0.55)';
            c.fillRect(winLeft + 2, ceilY, winW - 4, ceilH);
            // Tube glow
            c.save();
            c.globalCompositeOperation = 'lighter';
            const tubeGlow = c.createLinearGradient(0, ceilY, 0, ceilY + 20);
            tubeGlow.addColorStop(0, 'rgba(240, 248, 255, 0.55)');
            tubeGlow.addColorStop(1, 'rgba(240, 248, 255, 0)');
            c.fillStyle = tubeGlow;
            c.fillRect(winLeft + 2, ceilY, winW - 4, 20);
            c.restore();
            // Individual tubes (4) with occasional dropouts
            for (let i = 0; i < this.fluorTubes.length; i++) {
                const tube = this.fluorTubes[i];
                const tubeX = winLeft + tube.xk * winW - 14;
                const tubeW = 28;
                const dropping = tube.dropMs > 0;
                const a = dropping ? 0.25 : 0.85;
                c.fillStyle = `rgba(248, 252, 255, ${a})`;
                c.fillRect(tubeX, ceilY + 1, tubeW, ceilH - 2);
            }
        }

        drawFridge(t) {
            const c = this.ctx;
            const L = this._layout;
            const { winLeft, winTop, winH, fridgeW } = L;

            // Cooler tint
            c.fillStyle = 'rgba(132, 174, 204, 0.42)';
            c.fillRect(winLeft, winTop, fridgeW, winH);

            // Fridge bezel
            c.strokeStyle = 'rgba(60, 80, 100, 0.55)';
            c.lineWidth = 1;
            c.strokeRect(winLeft + 1, winTop + 1, fridgeW - 2, winH - 2);

            // 4 shelves with vertical light strips
            const shelves = 4;
            c.strokeStyle = 'rgba(60, 90, 110, 0.55)';
            for (let s = 0; s < shelves; s++) {
                const sy = winTop + 16 + s * ((winH - 24) / shelves);
                c.beginPath();
                c.moveTo(winLeft + 4, sy);
                c.lineTo(winLeft + fridgeW - 4, sy);
                c.stroke();
                // shelf LED strip underneath
                c.fillStyle = 'rgba(220, 240, 250, 0.32)';
                c.fillRect(winLeft + 4, sy - 1.5, fridgeW - 8, 1);
            }

            // Bottles grouped by category color
            const cats = [
                { color: '#3a88e8', accent: '#1058b8', label: '#fff' }, // sports drink cyan
                { color: '#23a85a', accent: '#106a30', label: '#fff' }, // green tea
                { color: '#e83a3a', accent: '#8a1a1a', label: '#fff' }, // cola red
                { color: '#82664a', accent: '#3a2818', label: '#f2e0a8' }, // coffee brown
                { color: '#e4e8ec', accent: '#888c90', label: '#3a7ac8' }, // milk
            ];
            for (let s = 0; s < shelves; s++) {
                const sy = winTop + 16 + s * ((winH - 24) / shelves);
                const slots = 5;
                for (let k = 0; k < slots; k++) {
                    const bx = winLeft + 6 + k * ((fridgeW - 12) / slots);
                    const cat = cats[(k + s) % cats.length];
                    const bw = 5;
                    const bh = 11;
                    // bottle body
                    c.fillStyle = cat.color;
                    c.fillRect(bx, sy - bh - 1, bw, bh);
                    // cap
                    c.fillStyle = cat.accent;
                    c.fillRect(bx + 0.4, sy - bh - 3, bw - 0.8, 2);
                    // label band
                    c.fillStyle = cat.label;
                    c.fillRect(bx, sy - bh + 3, bw, 2.2);
                    // condensation shine
                    c.fillStyle = 'rgba(255, 255, 255, 0.45)';
                    c.fillRect(bx + 0.6, sy - bh + 1, 1, bh - 4);
                }
            }

            // Fridge division line (between fridge and main shelves)
            c.fillStyle = 'rgba(30, 50, 70, 0.7)';
            c.fillRect(winLeft + fridgeW - 1, winTop + 4, 2, winH - 8);
        }

        drawMagazineRack() {
            const c = this.ctx;
            const L = this._layout;
            const sa = L.shelfArea;
            // Compact slim rack on the far-left of the shelf area — narrower
            // and shorter than before. Single tier of small face-out covers
            // at top, dense spine row below.
            const rackX = sa.x + 2;
            const rackW = sa.w * 0.10;
            const rackY = sa.y + sa.h * 0.62;
            const rackH = sa.h * 0.38 - 4;
            // Backing
            c.fillStyle = 'rgba(36, 44, 52, 0.45)';
            c.fillRect(rackX, rackY - 2, rackW, rackH + 2);
            // Tier divider
            c.fillStyle = '#3a3a3a';
            c.fillRect(rackX, rackY + rackH * 0.42, rackW, 1.2);
            // Bottom shelf line
            c.fillRect(rackX, rackY + rackH - 1, rackW, 1.2);
            // TOP TIER: 4 small face-out covers
            const coverCols = 4;
            const coverW = (rackW - 3) / coverCols;
            const coverH = rackH * 0.36;
            for (let k = 0; k < coverCols; k++) {
                const m = this.magazines[k];
                const cx = rackX + 1.5 + k * coverW;
                const cy = rackY + 1;
                c.fillStyle = `hsl(${m.hue}, ${m.sat}%, ${m.light}%)`;
                c.fillRect(cx, cy, coverW - 0.5, coverH);
                // Title band
                c.fillStyle = `hsl(${m.bandHue}, 80%, 40%)`;
                c.fillRect(cx, cy + 0.5, coverW - 0.5, 1.2);
                // Highlight
                c.fillStyle = 'rgba(255,255,255,0.30)';
                c.fillRect(cx, cy, 0.5, coverH);
            }
            // BOTTOM TIER: thin vertical spines packed tightly
            const spineY = rackY + rackH * 0.48;
            const spineH = rackH * 0.50;
            const spineCount = 16;
            const spineW = rackW / spineCount;
            for (let i = 0; i < spineCount; i++) {
                const m = this.magazines[(i + 4) % this.magazines.length];
                const sx = rackX + i * spineW;
                const sh = spineH * m.height;
                const sy = spineY + spineH - sh;
                c.fillStyle = `hsl(${m.hue}, ${m.sat}%, ${m.light}%)`;
                c.fillRect(sx, sy, spineW * m.width, sh);
                c.fillStyle = `hsl(${m.bandHue}, 70%, 30%)`;
                c.fillRect(sx, sy + sh * m.titleY, spineW * m.width, 1.2);
            }

            // SALARYMAN doing tachiyomi (standing-reading), beside the rack —
            // small and proportional, not bulging out
            const salX = rackX + rackW + 8;
            const salY = sa.y + sa.h - 2;
            const figScale = 1.15 * this.s;
            c.save();
            c.translate(salX, salY);
            c.scale(figScale, figScale);
            // Coat
            c.fillStyle = 'rgba(20, 26, 38, 0.94)';
            c.fillRect(-8, -54, 16, 36);
            // Legs
            c.fillRect(-6, -18, 4, 18);
            c.fillRect(2, -18, 4, 18);
            // Shoes
            c.fillStyle = 'rgba(0,0,0,0.85)';
            c.fillRect(-7, -2, 5.5, 2);
            c.fillRect(1.5, -2, 5.5, 2);
            // Briefcase on floor
            c.fillStyle = 'rgba(40, 26, 16, 0.95)';
            c.fillRect(8, -10, 9, 10);
            c.fillStyle = '#2a1a0a';
            c.fillRect(10, -12, 6, 2);
            // Arms holding magazine
            c.fillStyle = 'rgba(20, 26, 38, 0.94)';
            c.fillRect(-3, -42, 12, 5);
            // Magazine he's reading
            c.fillStyle = '#f4e8d4';
            c.fillRect(0, -50, 12, 10);
            c.fillStyle = '#cc3a3a';
            c.fillRect(0, -50, 12, 2.2);
            c.fillStyle = 'rgba(20,16,12,0.55)';
            c.fillRect(2, -45, 8, 1);
            c.fillRect(2, -42, 6, 1);
            // Head — tilted down toward magazine
            c.fillStyle = 'rgba(228, 200, 178, 0.95)';
            c.beginPath();
            c.arc(0, -60, 6.4, 0, Math.PI * 2);
            c.fill();
            // Hair (short black)
            c.fillStyle = 'rgba(20, 16, 12, 0.94)';
            c.beginPath();
            c.arc(0, -62, 6.4, Math.PI, 0);
            c.fill();
            c.fillRect(-5, -64, 10, 2);
            // Glasses
            c.fillStyle = 'rgba(20, 16, 12, 0.85)';
            c.fillRect(-3.4, -60, 2.4, 1.2);
            c.fillRect(1, -60, 2.4, 1.2);
            c.fillRect(-1, -59.4, 2, 0.6);
            c.restore();
        }

        drawProducts(t) {
            const c = this.ctx;
            const L = this._layout;
            const sa = L.shelfArea;
            const shelfRows = 3;

            // Shelves with price-tag tape running along each shelf edge
            for (let s = 0; s < shelfRows; s++) {
                const sy = sa.y + s * (sa.h / shelfRows) + (sa.h / shelfRows) - 2;
                // Shelf line
                c.strokeStyle = 'rgba(60, 70, 70, 0.55)';
                c.lineWidth = 2;
                c.beginPath();
                c.moveTo(sa.x + sa.w * 0.13, sy);
                c.lineTo(sa.x + sa.w, sy);
                c.stroke();
                // Price-tag tape strip (white with red accent — common in konbini)
                c.fillStyle = 'rgba(248, 248, 240, 0.70)';
                c.fillRect(sa.x + sa.w * 0.13, sy, sa.w * 0.87, 2);
                c.fillStyle = '#cc3a3a';
                // Periodic ¥ price ticks
                for (let k = 0; k < 6; k++) {
                    const tx = sa.x + sa.w * 0.15 + k * (sa.w * 0.85 / 6);
                    c.fillRect(tx, sy + 0.4, 8, 1.2);
                }
            }

            for (let i = 0; i < this.products.length; i++) {
                const p = this.products[i];
                const rowY = sa.y + p.shelf * (sa.h / shelfRows) + (sa.h / shelfRows) - 2;
                const pw = p.w * sa.w * 0.9;
                const ph = (sa.h / shelfRows) * 0.7 * p.h;
                // Skip products that fall inside the magazine rack (bottom row, far left)
                const productStartX = sa.x + sa.w * 0.15;
                const px = productStartX + p.x * (sa.w * 0.83 - pw);
                const py = rowY - ph;
                const body = `hsla(${p.hue}, ${p.sat}%, 60%, 0.94)`;
                const dark = `hsla(${p.hue}, ${p.sat}%, 30%, 0.94)`;
                const light = `hsla(${p.hue}, ${p.sat}%, 80%, 0.78)`;

                if (p.type === 'bottle') {
                    c.fillStyle = body;
                    c.fillRect(px, py, pw * 0.4, ph);
                    c.fillStyle = dark;
                    c.fillRect(px, py, pw * 0.4, 2);
                    c.fillStyle = '#fff';
                    c.globalAlpha = 0.55;
                    c.fillRect(px, py + ph * 0.55, pw * 0.4, 2.5);
                    c.globalAlpha = 1;
                } else if (p.type === 'can') {
                    c.fillStyle = body;
                    c.fillRect(px, py, pw, ph);
                    c.fillStyle = dark;
                    c.fillRect(px, py, pw, 1.6);
                    c.fillStyle = light;
                    c.fillRect(px, py + ph - 1.6, pw, 1.6);
                    c.fillStyle = '#fff';
                    c.globalAlpha = 0.55;
                    c.fillRect(px, py + ph * 0.42, pw, 2);
                    c.globalAlpha = 1;
                } else if (p.type === 'ramen') {
                    // Cup ramen: cylinder body with foil lid + bright label band.
                    // Wider than bottles, with a heavier wraparound label and
                    // a tab on the lid suggesting a peel-back foil.
                    c.fillStyle = body;
                    c.fillRect(px, py + ph * 0.12, pw, ph * 0.88);
                    // contrasting lid (foil) — slightly wider than body
                    c.fillStyle = `hsla(${p.accent}, 30%, 88%, 0.95)`;
                    c.fillRect(px - 1, py, pw + 2, ph * 0.14);
                    // peel-tab
                    c.fillStyle = '#cc3a3a';
                    c.fillRect(px + pw * 0.35, py - 1, pw * 0.30, 2);
                    // wraparound brand band (big)
                    c.fillStyle = `hsla(${p.accent}, 80%, 55%, 0.95)`;
                    c.fillRect(px, py + ph * 0.36, pw, ph * 0.22);
                    // brand seam white
                    c.fillStyle = '#fff';
                    c.fillRect(px, py + ph * 0.42, pw, 1.8);
                    // small price tag below
                    c.fillStyle = '#ffd34a';
                    c.fillRect(px + pw * 0.25, py + ph - 4, pw * 0.5, 3);
                    c.fillStyle = '#1a1410';
                    c.fillRect(px + pw * 0.35, py + ph - 3.5, pw * 0.30, 1.2);
                } else if (p.type === 'bento') {
                    // Flat tray (rectangular, viewed from the side as a thin
                    // black slab) with a colored plastic lid on top.
                    c.fillStyle = '#1a1410';
                    c.fillRect(px, py + ph * 0.45, pw, ph * 0.55);
                    // Lid (colored translucent plastic)
                    c.fillStyle = `hsla(${p.hue}, ${p.sat}%, 65%, 0.85)`;
                    c.fillRect(px - 1, py + ph * 0.10, pw + 2, ph * 0.40);
                    // Lid sheen
                    c.fillStyle = 'rgba(255,255,255,0.45)';
                    c.fillRect(px, py + ph * 0.14, pw * 0.7, 1.2);
                    // Price strip on lid
                    c.fillStyle = '#cc3a3a';
                    c.fillRect(px + pw * 0.15, py + ph * 0.28, pw * 0.4, 2);
                    c.fillStyle = '#fff';
                    c.fillRect(px + pw * 0.18, py + ph * 0.30, pw * 0.34, 0.8);
                    // Hint of food visible through lid (multi-color dabs)
                    c.fillStyle = 'rgba(180, 60, 40, 0.50)';
                    c.fillRect(px + pw * 0.20, py + ph * 0.38, pw * 0.15, 1.4);
                    c.fillStyle = 'rgba(120, 180, 60, 0.50)';
                    c.fillRect(px + pw * 0.45, py + ph * 0.38, pw * 0.15, 1.4);
                    c.fillStyle = 'rgba(220, 200, 130, 0.50)';
                    c.fillRect(px + pw * 0.70, py + ph * 0.38, pw * 0.15, 1.4);
                } else if (p.type === 'snackbag') {
                    // Tall foil snack bag with reflective sheen and bold logo.
                    c.fillStyle = body;
                    c.beginPath();
                    c.moveTo(px, py + ph);
                    c.lineTo(px, py + ph * 0.12);
                    c.quadraticCurveTo(px + pw * 0.5, py - 2, px + pw, py + ph * 0.12);
                    c.lineTo(px + pw, py + ph);
                    c.closePath();
                    c.fill();
                    // Holographic foil sheen — diagonal highlight
                    c.fillStyle = 'rgba(255,255,255,0.32)';
                    c.fillRect(px + pw * 0.15, py + ph * 0.18, pw * 0.30, ph * 0.55);
                    // Big brand band
                    c.fillStyle = `hsla(${p.accent}, 85%, 55%, 0.95)`;
                    c.fillRect(px, py + ph * 0.40, pw, ph * 0.22);
                    // Label text seam
                    c.fillStyle = '#fff';
                    c.fillRect(px + pw * 0.1, py + ph * 0.47, pw * 0.8, 2);
                    // Top seal
                    c.fillStyle = dark;
                    c.fillRect(px + pw * 0.2, py + ph * 0.06, pw * 0.6, 1.6);
                } else if (p.type === 'box') {
                    c.fillStyle = body;
                    c.fillRect(px, py + ph * 0.2, pw, ph * 0.8);
                    c.fillStyle = light;
                    c.fillRect(px, py + ph * 0.2, pw, 1.6);
                    c.fillStyle = '#fff';
                    c.globalAlpha = 0.4;
                    c.fillRect(px + pw * 0.1, py + ph * 0.5, pw * 0.8, 1.2);
                    c.globalAlpha = 1;
                } else if (p.type === 'onigiri') {
                    // Triangle rice ball with nori band + filling triangle at apex
                    const apexX = px + pw * 0.5;
                    const apexY = py + ph * 0.06;
                    const blX = px + pw * 0.04;
                    const blY = py + ph;
                    const brX = px + pw - pw * 0.04;
                    const brY = py + ph;
                    c.fillStyle = '#fcf6e6';
                    c.beginPath();
                    c.moveTo(blX, blY);
                    c.quadraticCurveTo(px + pw * 0.18, py + ph * 0.5, apexX - pw * 0.10, apexY + ph * 0.05);
                    c.quadraticCurveTo(apexX, apexY - ph * 0.02, apexX + pw * 0.10, apexY + ph * 0.05);
                    c.quadraticCurveTo(px + pw * 0.82, py + ph * 0.5, brX, brY);
                    c.quadraticCurveTo(apexX, py + ph * 1.02, blX, blY);
                    c.closePath();
                    c.fill();
                    // Filling triangle at apex (salmon / tuna / umeboshi color)
                    const fillColors = ['#e8845a', '#c44a3a', '#c8345a'];
                    c.fillStyle = fillColors[(p.fillTone * 3) | 0];
                    c.beginPath();
                    c.moveTo(apexX - pw * 0.12, apexY + ph * 0.06);
                    c.lineTo(apexX, apexY);
                    c.lineTo(apexX + pw * 0.12, apexY + ph * 0.06);
                    c.closePath();
                    c.fill();
                    // Rice grain highlight
                    c.fillStyle = 'rgba(255, 255, 255, 0.30)';
                    c.beginPath();
                    c.moveTo(apexX - pw * 0.05, py + ph * 0.20);
                    c.quadraticCurveTo(px + pw * 0.30, py + ph * 0.55, px + pw * 0.34, py + ph * 0.85);
                    c.lineTo(px + pw * 0.28, py + ph * 0.85);
                    c.quadraticCurveTo(px + pw * 0.23, py + ph * 0.5, apexX - pw * 0.12, py + ph * 0.22);
                    c.closePath();
                    c.fill();
                    // Nori band — flat at the bottom
                    c.fillStyle = '#16201a';
                    const noriH = Math.max(3, ph * 0.32);
                    c.beginPath();
                    c.moveTo(px + pw * 0.06, py + ph - noriH);
                    c.lineTo(px + pw * 0.94, py + ph - noriH);
                    c.lineTo(brX, brY);
                    c.lineTo(blX, blY);
                    c.closePath();
                    c.fill();
                    c.fillStyle = 'rgba(120, 150, 100, 0.30)';
                    c.fillRect(px + pw * 0.12, py + ph - noriH + 1, pw * 0.30, 1);
                } else {
                    // bag (rounded top, optional seal)
                    c.fillStyle = body;
                    c.beginPath();
                    c.moveTo(px, py + ph);
                    c.lineTo(px, py + ph * 0.3);
                    c.quadraticCurveTo(px + pw * 0.5, py - 1, px + pw, py + ph * 0.3);
                    c.lineTo(px + pw, py + ph);
                    c.closePath();
                    c.fill();
                    c.fillStyle = dark;
                    c.fillRect(px + pw * 0.2, py + ph * 0.05, pw * 0.6, 1.6);
                    // accent stripe
                    c.fillStyle = `hsla(${p.accent}, 75%, 55%, 0.85)`;
                    c.fillRect(px + pw * 0.10, py + ph * 0.55, pw * 0.8, 2);
                }
            }

            // Aisle separators
            c.fillStyle = 'rgba(40, 50, 50, 0.55)';
            for (let k = 1; k <= 2; k++) {
                const ax = sa.x + (sa.w / 3) * k;
                c.fillRect(ax - 0.7, sa.y - 2, 1.4, sa.h);
            }
        }

        drawHotFoodCase(t, dt) {
            const c = this.ctx;
            const L = this._layout;
            // Wider three-compartment hot food display: oden pot | nikuman
            // steamer | fried chicken case.
            const caseX = L.counterLeft - 96;
            const caseY = L.counterY - 30;
            const caseW = 90;
            const caseH = 26;

            // Body / chassis
            c.fillStyle = '#2a1c14';
            c.fillRect(caseX, caseY, caseW, caseH);
            // Top warming bar (yellow strip)
            c.fillStyle = '#ffdf6a';
            c.fillRect(caseX + 2, caseY + 1, caseW - 4, 2.6);
            // Inner walls separating the three compartments
            const compW = (caseW - 6) / 3;
            for (let k = 0; k <= 3; k++) {
                c.fillStyle = '#1a1410';
                c.fillRect(caseX + 2 + k * compW, caseY + 4, 1, caseH - 6);
            }

            // Compartment 1 — Oden pot (left). Stainless rim + brown broth +
            // bobbing oden ingredients (daikon disc, fish-cake square,
            // boiled-egg circle).
            const odX = caseX + 3;
            const odY = caseY + 4;
            c.fillStyle = '#cfd5d8';
            c.fillRect(odX, odY, compW - 1, 2);
            c.fillStyle = '#7a5a3a';
            c.fillRect(odX, odY + 2, compW - 1, caseH - 8);
            // Oden ingredients
            c.fillStyle = '#f4e8c8';
            c.beginPath(); c.arc(odX + 6, odY + 12, 2.4, 0, Math.PI * 2); c.fill(); // daikon
            c.fillStyle = '#e8d4a0';
            c.fillRect(odX + 12, odY + 10, 4, 4); // fishcake square
            c.fillStyle = '#fff';
            c.beginPath(); c.arc(odX + 20, odY + 13, 2, 0, Math.PI * 2); c.fill(); // egg

            // Compartment 2 — Nikuman steamer (middle). Lid with handles + 4
            // round buns visible.
            const nkX = caseX + 3 + compW;
            const nkY = caseY + 4;
            c.fillStyle = '#cfd5d8';
            c.fillRect(nkX, nkY, compW - 1, 4);
            c.fillStyle = '#aab0b6';
            c.fillRect(nkX + compW * 0.4 - 2, nkY - 2, 4, 2); // handle
            c.fillStyle = '#e8e4d8';
            for (let k = 0; k < 4; k++) {
                const px = nkX + 3 + (k % 2) * 12;
                const py = nkY + 6 + Math.floor(k / 2) * 8;
                c.beginPath();
                c.arc(px + 3, py + 3, 3, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = 'rgba(180, 160, 130, 0.45)';
                c.fillRect(px + 1.4, py + 4.6, 3.2, 0.6);
                c.fillStyle = '#e8e4d8';
            }

            // Compartment 3 — Fried chicken case (right). Heat lamp glow +
            // chicken pieces on red-and-white checker liner.
            const fcX = caseX + 3 + compW * 2;
            const fcY = caseY + 4;
            c.fillStyle = 'rgba(255, 130, 60, 0.5)';
            c.fillRect(fcX, fcY, compW - 1, caseH - 8);
            // Checker liner
            for (let k = 0; k < 3; k++) {
                c.fillStyle = k % 2 === 0 ? '#e8e4d8' : '#cc3a3a';
                c.fillRect(fcX + k * 7, fcY + caseH - 11, 6, 1.2);
            }
            // Chicken pieces (golden lumps)
            for (let k = 0; k < 3; k++) {
                c.fillStyle = '#c47a32';
                c.beginPath();
                c.ellipse(fcX + 5 + k * 6, fcY + 14, 3.4, 2.4, 0, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = '#e89a40';
                c.fillRect(fcX + 4 + k * 6, fcY + 12, 2, 1);
            }

            // Compartment labels (tiny kanji)
            c.fillStyle = '#1a0c08';
            c.font = "700 6px 'Yu Gothic UI', sans-serif";
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('おでん', caseX + 3 + compW * 0.5, caseY + caseH - 2);
            c.fillText('肉まん', caseX + 3 + compW * 1.5, caseY + caseH - 2);
            c.fillText('から揚', caseX + 3 + compW * 2.5, caseY + caseH - 2);

            // Warm interior glow halo bleeding out of the case
            c.save();
            c.globalCompositeOperation = 'lighter';
            const innerGlow = c.createRadialGradient(caseX + caseW * 0.5, caseY + caseH * 0.5, 4, caseX + caseW * 0.5, caseY + caseH * 0.5, caseW * 0.6);
            innerGlow.addColorStop(0, 'rgba(255, 168, 90, 0.42)');
            innerGlow.addColorStop(1, 'rgba(255, 100, 40, 0)');
            c.fillStyle = innerGlow;
            c.fillRect(caseX - 20, caseY - 8, caseW + 40, caseH + 16);
            c.restore();

            // Steam emit — emit from oden + nikuman compartments
            this.nextFoodSteamMs -= dt;
            if (this.nextFoodSteamMs <= 0 && this.foodSteam.length < 5) {
                const emitOden = Math.random() < 0.5;
                const ex = emitOden ? caseX + 3 + compW * 0.4 + Math.random() * compW * 0.2
                                    : caseX + 3 + compW * 1.4 + Math.random() * compW * 0.2;
                this.foodSteam.push({
                    x: ex,
                    y: caseY + 4,
                    age: 0,
                    life: 3000 + Math.random() * 1800,
                    size: 4 + Math.random() * 4,
                });
                this.nextFoodSteamMs = 900 + Math.random() * 1400;
            }
            // Render steam
            for (let i = this.foodSteam.length - 1; i >= 0; i--) {
                const s = this.foodSteam[i];
                s.age += dt;
                if (s.age >= s.life) { this.foodSteam.splice(i, 1); continue; }
                const k = s.age / s.life;
                const sy = s.y - k * 28;
                const sx = s.x + Math.sin(k * 4 + s.life) * 4;
                const sr = s.size * (1 + k * 1.4);
                const a = (1 - k) * 0.38;
                c.fillStyle = `rgba(245, 240, 230, ${a})`;
                c.beginPath();
                c.arc(sx, sy, sr, 0, Math.PI * 2);
                c.fill();
            }
        }

        // Cigarette wall — a small grid of muted packs DIRECTLY BEHIND the
        // cashier counter only. Sized to fit between the register and the
        // ceiling, not stretching across the whole right wall.
        drawCigaretteWall() {
            const c = this.ctx;
            const L = this._layout;
            // Anchor the wall to the counter footprint, not the whole interior
            const wallW = (L.counterRight - L.counterLeft) * 0.55;
            const wallX = L.counterLeft + (L.counterRight - L.counterLeft) * 0.05;
            const wallH = 22;
            const wallY = L.counterY - wallH - 14;
            // Backing — pale yellow under harsh white fluorescent
            c.fillStyle = 'rgba(238, 230, 210, 0.85)';
            c.fillRect(wallX, wallY, wallW, wallH);
            c.strokeStyle = 'rgba(60, 50, 40, 0.45)';
            c.lineWidth = 0.6;
            c.strokeRect(wallX + 0.5, wallY + 0.5, wallW - 1, wallH - 1);
            // Tight grid of small cigarette packs
            const cols = 8, rows = 3;
            const packPalette = ['#1a1410', '#4a3018', '#8a3a2a', '#1a3a5a', '#6a5a3a', '#3a3a3a', '#a8a890', '#d8c4a8'];
            const padX = 1, padY = 1;
            const pw = (wallW - padX * (cols + 1)) / cols;
            const ph = (wallH - padY * (rows + 1)) / rows;
            for (let r = 0; r < rows; r++) {
                for (let k = 0; k < cols; k++) {
                    const px = wallX + padX + k * (pw + padX);
                    const py = wallY + padY + r * (ph + padY);
                    c.fillStyle = packPalette[(r * 7 + k * 3) % packPalette.length];
                    c.fillRect(px, py, pw, ph);
                    c.fillStyle = 'rgba(255,255,255,0.35)';
                    c.fillRect(px, py + ph * 0.55, pw, 0.5);
                }
            }
            // Glass shelf edges
            c.fillStyle = 'rgba(180, 200, 220, 0.18)';
            for (let r = 1; r < rows; r++) {
                const ry = wallY + padY + r * (ph + padY) - 1;
                c.fillRect(wallX + 1, ry, wallW - 2, 0.5);
            }
            // Top label "TOBACCO 喫煙"
            c.fillStyle = '#1a1410';
            c.font = "700 5px 'Yu Gothic UI', sans-serif";
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('TOBACCO', wallX + wallW * 0.5, wallY - 3);
        }

        drawCounterAndRegister() {
            const c = this.ctx;
            const L = this._layout;
            const { counterY, counterH, counterLeft, counterRight } = L;

            // Counter base
            c.fillStyle = '#8a6a44';
            c.fillRect(counterLeft, counterY, counterRight - counterLeft, counterH);
            c.fillStyle = '#a88458';
            c.fillRect(counterLeft, counterY, counterRight - counterLeft, 4);
            c.fillStyle = '#c8a878';
            c.fillRect(counterLeft, counterY, counterRight - counterLeft, 2);

            // Register
            const regX = counterLeft + 12;
            const regY = counterY - 12;
            c.fillStyle = '#1a2030';
            c.fillRect(regX, regY, 18, 12);
            c.fillStyle = '#0a1018';
            c.fillRect(regX, regY + 8, 18, 4);
            // Display
            c.fillStyle = '#10ffa0';
            c.fillRect(regX + 2, regY + 2, 14, 3);
            c.fillStyle = 'rgba(255,255,255,0.4)';
            c.fillRect(regX + 3, regY + 2.5, 6, 0.6);

            // Snack rack on counter
            const snacks = [
                { color: '#e83a3a', x: 32, h: 8 },
                { color: '#ffae45', x: 40, h: 6 },
                { color: '#2a8aff', x: 48, h: 10 },
                { color: '#f04a82', x: 56, h: 7 },
            ];
            for (const sn of snacks) {
                c.fillStyle = sn.color;
                c.fillRect(counterLeft + sn.x, counterY - sn.h, 6, sn.h);
                c.fillStyle = '#fff';
                c.globalAlpha = 0.4;
                c.fillRect(counterLeft + sn.x + 1, counterY - sn.h + 1, 4, 1);
                c.globalAlpha = 1;
            }

            // Coffee machine to the right of register
            const cmX = counterLeft + 76;
            const cmY = counterY - 18;
            c.fillStyle = '#cfd2d8';
            c.fillRect(cmX, cmY, 14, 18);
            c.fillStyle = '#8a8e94';
            c.fillRect(cmX, cmY, 14, 3);
            c.fillStyle = '#1a2030';
            c.fillRect(cmX + 3, cmY + 5, 8, 4);
            c.fillStyle = '#3afaa0';
            c.fillRect(cmX + 4, cmY + 6, 6, 1);
            // dispenser nozzles
            c.fillStyle = '#5a5e64';
            c.fillRect(cmX + 4, cmY + 12, 2, 3);
            c.fillRect(cmX + 8, cmY + 12, 2, 3);

            // Cashier silhouette behind register
            const cashX = regX + 30;
            const cashY = counterY - 5;
            const cScale = 1.15;
            c.save();
            c.translate(cashX, cashY);
            c.scale(cScale, cScale);
            // Cashier body
            c.fillStyle = 'rgba(50, 64, 90, 0.85)';
            c.fillRect(-5.5, -15, 11, 15);
            c.beginPath();
            c.arc(0, -18.5, 4.0, 0, Math.PI * 2);
            c.fill();
            // Visor cap
            c.fillStyle = '#23a85a';
            c.fillRect(-4.0, -21.2, 8.0, 1.6);
            // Tiny face shadow
            c.fillStyle = 'rgba(20, 26, 36, 0.55)';
            c.fillRect(-3.1, -19.8, 6.2, 1.4);
            // Name-tag dot
            c.fillStyle = '#ffdf6a';
            c.fillRect(-2.7, -11, 1.2, 1.2);
            c.restore();
        }

        drawBrowsingCustomer(t) {
            const c = this.ctx;
            const L = this._layout;
            // Drift along shelves on left half of interior
            const drift = 0.18 + (Math.sin(t * 0.0006) * 0.5 + 0.5) * 0.30;
            const cx = L.winLeft + L.winW * drift;
            const baseY = L.winBottom - 6;
            const bob = Math.sin(t * 0.0028) * 1.4;
            const stepK = Math.sin(t * 0.004);
            const figScale = 1.15 * this.s;

            // Variant 0 = bag, 1 = briefcase, 2 = empty hands
            const variant = this.customerVariant;
            // Coat color varies
            const coatColors = ['rgba(30, 36, 44, 0.78)', 'rgba(58, 38, 60, 0.78)', 'rgba(40, 50, 38, 0.78)'];

            c.save();
            c.globalAlpha = this.customerAlpha;
            c.translate(cx, baseY + bob);
            c.scale(figScale, figScale);

            c.fillStyle = coatColors[variant];
            // Coat: from y = -30 to y = -10
            c.fillRect(-4.5, -30, 9, 20);
            
            // Legs with step
            c.fillRect(-3.5, -10, 2, 8 + stepK * 2);
            c.fillRect(1.5, -10, 2, 8 - stepK * 2);
            
            // Head
            c.fillStyle = 'rgba(30, 36, 44, 0.88)';
            c.beginPath();
            c.arc(0, -34, 3.6, 0, Math.PI * 2);
            c.fill();
            
            // Tiny face dots (eyes)
            c.fillStyle = 'rgba(255, 230, 200, 0.6)';
            c.fillRect(-1.4, -34.6, 0.6, 0.6);
            c.fillRect(0.8, -34.6, 0.6, 0.6);

            if (variant === 0) {
                // shopping bag
                c.fillStyle = 'rgba(220, 220, 220, 0.7)';
                c.fillRect(4.5, -17, 3.6, 4.5);
                c.fillStyle = coatColors[variant];
                c.fillRect(4.5, -24, 1.4, 8);
            } else if (variant === 1) {
                // briefcase
                c.fillStyle = 'rgba(45, 28, 18, 0.85)';
                c.fillRect(4.5, -19, 5.4, 4.5);
                c.fillStyle = coatColors[variant];
                c.fillRect(4.5, -24, 1.4, 6.3);
            }
            c.restore();
        }

        drawWindowMullion() {
            const c = this.ctx;
            const L = this._layout;
            // Thin aluminum frame — was Tetris-bar thick before
            c.strokeStyle = '#0a0d18';
            c.lineWidth = 2;
            c.strokeRect(L.winLeft, L.winTop, L.winW, L.winH);
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(L.winLeft + L.winW * 0.5, L.winTop);
            c.lineTo(L.winLeft + L.winW * 0.5, L.winBottom);
            c.stroke();
            // Horizontal advertising sticker band at adult-eye-height (33% down)
            const bandY = L.winTop + L.winH * 0.33;
            c.fillStyle = 'rgba(255, 255, 255, 0.06)';
            c.fillRect(L.winLeft + 2, bandY, L.winW - 4, 1);
        }

        drawSidePanePosters() {
            const c = this.ctx;
            const L = this._layout;
            const halfW = L.winW * 0.5;
            for (const p of this.sidePanePosters) {
                const paneLeft = p.side === 'L' ? L.winLeft + 6 : L.winLeft + halfW + 6;
                const paneW = halfW - 12;
                const px = paneLeft + p.yk * 0.2 * paneW;
                const py = L.winTop + p.yk * (L.winH - 60);
                const pw = paneW * p.w;
                const ph = L.winH * p.h * 0.6;
                // Frame
                c.fillStyle = 'rgba(20, 24, 32, 0.6)';
                c.fillRect(px - 1, py - 1, pw + 2, ph + 2);
                // Body
                c.fillStyle = p.color;
                c.fillRect(px, py, pw, ph);
                // Stripe band
                c.fillStyle = p.stripeColor;
                c.fillRect(px, py + ph * 0.55, pw, ph * 0.18);
                // Text bars
                c.fillStyle = '#fff';
                c.fillRect(px + 2, py + 3, pw - 4, 1.4);
                c.fillRect(px + 2, py + 7, pw * 0.7, 1.2);
                c.fillRect(px + 2, py + ph - 5, pw * 0.5, 1.2);
            }
        }

        // =========================================================
        // SLIDING DOORS + DOOR ANIMATION
        // =========================================================
        updateDoor(dt) {
            const d = this.door;
            d.t += dt;
            if (d.state === 'closed') {
                d.nextEventMs -= dt;
                if (d.nextEventMs <= 0) {
                    d.state = 'opening';
                    d.t = 0;
                    d.customerDir = Math.random() < 0.5 ? 1 : -1;
                    d.customerVariant = Math.random() < 0.7 ? 'umbrella-bag' : 'umbrella-plain';
                    d.holdMs = 900 + Math.random() * 700;
                }
            } else if (d.state === 'opening') {
                d.openProgress = this.smoothstep(0, 550, d.t);
                if (d.openProgress >= 1) {
                    d.openProgress = 1;
                    d.state = 'open';
                    d.t = 0;
                    d.holdRemaining = d.holdMs;
                }
            } else if (d.state === 'open') {
                d.openProgress = 1;
                d.holdRemaining -= dt;
                if (d.holdRemaining <= 0) {
                    d.state = 'closing';
                    d.t = 0;
                }
            } else if (d.state === 'closing') {
                d.openProgress = 1 - this.smoothstep(0, 550, d.t);
                if (d.openProgress <= 0) {
                    d.openProgress = 0;
                    d.state = 'closed';
                    d.t = 0;
                    d.nextEventMs = 18000 + Math.random() * 30000;
                }
            }
        }

        drawSlidingDoors(t, windNow) {
            const c = this.ctx;
            const L = this._layout;
            const { doorLeft, doorW, winTop, winBottom, winH } = L;
            const op = this.door.openProgress;
            const slide = op * doorW * 0.42;

            // Door sensor strip
            c.fillStyle = '#1a2030';
            c.fillRect(doorLeft - 2, winTop, doorW + 4, 8);
            c.fillStyle = '#3afaa0';
            c.globalAlpha = 0.6 + 0.4 * Math.sin(t * 0.005);
            c.fillRect(doorLeft + doorW * 0.5 - 1, winTop + 3, 2, 2);
            c.globalAlpha = 1;

            // Left door panel
            c.fillStyle = 'rgba(216, 226, 218, 0.22)';
            c.fillRect(doorLeft - slide, winTop + 8, doorW * 0.5 - 1, winH - 8);
            // Right door panel
            c.fillStyle = 'rgba(216, 226, 218, 0.22)';
            c.fillRect(doorLeft + doorW * 0.5 + 1 + slide, winTop + 8, doorW * 0.5 - 1, winH - 8);

            // Door frames
            c.strokeStyle = '#080b14';
            c.lineWidth = 2.4;
            c.strokeRect(doorLeft - slide, winTop + 8, doorW * 0.5 - 1, winH - 8);
            c.strokeRect(doorLeft + doorW * 0.5 + 1 + slide, winTop + 8, doorW * 0.5 - 1, winH - 8);

            // Handles
            c.fillStyle = '#cdd5d8';
            c.fillRect(doorLeft + doorW * 0.5 - 8 - slide, winTop + winH * 0.5, 5, 2);
            c.fillRect(doorLeft + doorW * 0.5 + 3 + slide, winTop + winH * 0.5, 5, 2);
        }

        drawDoorPosters() {
            const c = this.ctx;
            const L = this._layout;
            const { doorLeft, doorW, winTop, winH } = L;
            const op = this.door.openProgress;
            const slide = op * doorW * 0.42;

            for (const p of this.doorPosters) {
                if (p.side === 'L' || (p.side === 'C' && p.xk < 0.5)) {
                    const px = doorLeft + p.xk * (doorW * 0.5 - 6) - slide;
                    const py = winTop + 14 + p.yk * (winH * 0.5);
                    const pw = (doorW * 0.5 - 6) * p.w * 0.7;
                    const ph = (winH * 0.5) * p.h * 0.4;
                    this.drawPoster(px, py, pw, ph, p);
                } else {
                    const px = doorLeft + doorW * 0.5 + 4 + p.xk * (doorW * 0.5 - 8) + slide;
                    const py = winTop + 14 + p.yk * (winH * 0.5);
                    const pw = (doorW * 0.5 - 6) * p.w * 0.7;
                    const ph = (winH * 0.5) * p.h * 0.4;
                    this.drawPoster(px, py, pw, ph, p);
                }
            }
        }

        // Small row of payment-method stickers on the lower door glass.
        // Reads as: Suica (green), PASMO (pink), PayPay (red), ID (gold),
        // QUICPay (orange), nanaco (orange-red).
        drawDoorStickerStack() {
            const c = this.ctx;
            const L = this._layout;
            const { doorLeft, doorW, winTop, winH } = L;
            const op = this.door.openProgress;
            const slide = op * doorW * 0.42;
            const stickers = [
                { fg: '#23a85a', text: 'IC' },
                { fg: '#e83a8a', text: 'PA' },
                { fg: '#e8242a', text: 'PP' },
                { fg: '#ffcc1f', text: 'iD' },
                { fg: '#ff8a2a', text: 'Q' },
                { fg: '#cc3a3a', text: '7' },
            ];
            const y = winTop + winH * 0.85;
            const w = 8, h = 10, gap = 1.4;
            // Left half (3 stickers) — moves with left door
            for (let i = 0; i < 3; i++) {
                const s = stickers[i];
                const x = doorLeft + doorW * 0.5 - 3 - (3 - i) * (w + gap) - slide;
                c.fillStyle = s.fg;
                c.fillRect(x, y, w, h);
                c.strokeStyle = 'rgba(0,0,0,0.5)';
                c.lineWidth = 0.6;
                c.strokeRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8);
                c.fillStyle = '#fff';
                c.font = "700 5px 'Helvetica Neue', sans-serif";
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(s.text, x + w * 0.5, y + h * 0.55);
            }
            // Right half (3 stickers) — moves with right door
            for (let i = 3; i < 6; i++) {
                const s = stickers[i];
                const x = doorLeft + doorW * 0.5 + 3 + (i - 3) * (w + gap) + slide;
                c.fillStyle = s.fg;
                c.fillRect(x, y, w, h);
                c.strokeStyle = 'rgba(0,0,0,0.5)';
                c.lineWidth = 0.6;
                c.strokeRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8);
                c.fillStyle = '#fff';
                c.font = "700 5px 'Helvetica Neue', sans-serif";
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(s.text, x + w * 0.5, y + h * 0.55);
            }
        }

        drawPoster(px, py, pw, ph, p) {
            const c = this.ctx;
            c.fillStyle = 'rgba(20, 24, 32, 0.55)';
            c.fillRect(px - 0.5, py - 0.5, pw + 1, ph + 1);
            c.fillStyle = p.color;
            c.fillRect(px, py, pw, ph);
            c.fillStyle = p.stripeColor;
            if (p.type === 0) {
                c.fillRect(px, py + ph * 0.6, pw, ph * 0.2);
            } else if (p.type === 1) {
                c.fillRect(px + pw * 0.6, py, pw * 0.4, ph);
            } else {
                c.fillRect(px, py, pw * 0.4, ph);
            }
            // text bars
            c.fillStyle = '#fff';
            c.fillRect(px + 1, py + 1.5, pw - 2, 1);
            c.fillRect(px + 1, py + 4, pw * 0.65, 1);
        }

        drawDoorFigure(t) {
            const c = this.ctx;
            const L = this._layout;
            const { doorLeft, doorW, winTop, winH, winBottom } = L;
            const d = this.door;

            // Threshold position derived from state phase
            // For opening: figure already at threshold, just becoming visible
            // For open: figure crosses (parameter goes 0..1 across hold)
            // For closing: figure exiting, fading
            let crossK = 0;
            if (d.state === 'opening') crossK = 0.20 + 0.20 * d.openProgress;
            else if (d.state === 'open') crossK = 0.40 + (1 - d.holdRemaining / d.holdMs) * 0.40;
            else if (d.state === 'closing') crossK = 0.80 + (1 - d.openProgress) * 0.15;

            // Direction +1 means entering (from outside left → inside right)
            // We render the figure inside the door rect, clipped.
            c.save();
            c.beginPath();
            c.rect(doorLeft - 2, winTop + 8, doorW + 4, winH - 8);
            c.clip();

            const cx = doorLeft + doorW * (d.customerDir > 0 ? crossK : (1 - crossK));
            const baseY = winBottom - 6;
            const figScale = 1.05 * this.s;

            // Fade with the door phase instead of popping into existence:
            // ghost-in while opening, solid while open, ghost-out closing.
            let alpha = 1;
            if (d.state === 'opening') alpha = d.openProgress;
            else if (d.state === 'closing') alpha = d.openProgress;
            c.globalAlpha = Math.max(0, Math.min(1, alpha));

            c.translate(cx, baseY);
            c.scale(d.customerDir * figScale, figScale);

            // Coat
            c.fillStyle = 'rgba(38, 46, 60, 0.92)';
            c.fillRect(-5, -32, 10, 22);
            // Legs (slight step)
            const step = Math.sin(d.t * 0.012) * 1.5;
            c.fillRect(-3.4, -12 + Math.max(0, step), 2.4, 12 - Math.max(0, step));
            c.fillRect(1, -12 + Math.max(0, -step), 2.4, 12 - Math.max(0, -step));
            // Head
            c.fillStyle = 'rgba(40, 30, 24, 0.92)';
            c.beginPath();
            c.arc(0, -36, 4, 0, Math.PI * 2);
            c.fill();
            // Bag
            if (d.customerVariant === 'umbrella-bag') {
                c.fillStyle = 'rgba(232, 232, 218, 0.85)';
                c.fillRect(5, -20, 4.5, 6);
            }
            c.restore();
        }

        drawNoren(t, windNow) {
            const c = this.ctx;
            const L = this._layout;
            const { doorLeft, doorW, winTop } = L;
            // Noren hangs from a rod at the very top of the door opening,
            // slightly inset so it reads as door-frame fabric rather than a
            // banner across the storefront.
            const norenInset = doorW * 0.08;
            const norenX = doorLeft + norenInset;
            const norenW = doorW - norenInset * 2;
            const norenY = winTop + 6;
            const norenH = 13;
            const sway = (windNow * 0.6 + this.door.openProgress * 3 * Math.sin(this.door.t * 0.012)) * 0.5;

            // Rod (thin metal bar above the fabric)
            c.fillStyle = '#5a5e64';
            c.fillRect(norenX - 2, norenY - 1, norenW + 4, 1.4);

            // Background fabric — deep indigo
            c.fillStyle = '#1a2a6a';
            c.fillRect(norenX, norenY, norenW, norenH);
            // Vertical fabric slits — only 3
            c.fillStyle = 'rgba(8, 14, 36, 0.6)';
            for (let k = 1; k < 4; k++) {
                const slX = norenX + (norenW / 4) * k + sway * k * 0.4;
                c.fillRect(slX, norenY + 3, 1, norenH - 3);
            }
            // Centered white kana mark — proper typography
            c.fillStyle = '#fff';
            c.font = this._fontKanaTiny;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('営業中', norenX + norenW * 0.5 + sway, norenY + norenH * 0.5);
        }

        drawDoorSpill(atmo) {
            const c = this.ctx;
            const L = this._layout;
            if (this.door.openProgress < 0.05) return;
            const { doorLeft, doorW } = L;
            const cx = doorLeft + doorW * 0.5;
            c.save();
            c.globalCompositeOperation = 'lighter';
            const spillR = doorW * 1.4;
            const spillH = (this.height - this.groundY) * 0.85;
            const grad = c.createRadialGradient(cx, this.groundY, 4, cx, this.groundY, spillR);
            const a = this.door.openProgress * (0.45 + atmo.dark * 0.25);
            grad.addColorStop(0, `rgba(255, 230, 170, ${a})`);
            grad.addColorStop(0.5, `rgba(255, 200, 130, ${a * 0.5})`);
            grad.addColorStop(1, 'rgba(255, 180, 100, 0)');
            c.fillStyle = grad;
            c.fillRect(cx - spillR, this.groundY - 4, spillR * 2, spillH + 4);
            c.restore();
        }

        // =========================================================
        // SIGN + BLOCK KANA
        // =========================================================
        drawKonbiniSign(t, windNow) {
            const c = this.ctx;
            const L = this._layout;
            const sw = L.sw;
            const signLeft = this.storeLeft + sw * 0.18;
            const signW = sw * 0.64;
            const signH = 56 * this.s;
            const signTop = this.signCy - signH * 0.5;
            const signBot = this.signCy + signH * 0.5;
            const cy = this.signCy;

            // Mounting struts
            const strutY1 = signBot;
            const strutY2 = this.storeY - 12;
            c.fillStyle = '#080b14';
            c.fillRect(signLeft + 10, strutY1, 4, strutY2 - strutY1);
            c.fillRect(signLeft + signW - 14, strutY1, 4, strutY2 - strutY1);
            c.fillStyle = '#2a2f3a';
            c.fillRect(signLeft + 9, strutY1 - 1, 6, 2);
            c.fillRect(signLeft + signW - 15, strutY1 - 1, 6, 2);
            c.fillRect(signLeft + 9, strutY2 - 1, 6, 2);
            c.fillRect(signLeft + signW - 15, strutY2 - 1, 6, 2);

            const pulse = 0.88 + 0.12 * Math.sin((t || 0) * 0.0014);
            const darkK = this.atmo ? this.atmo.dark : 1;
            const onK = this.signOn * pulse * (0.20 + 0.80 * darkK);

            // Bloom halo (warm-cool, wider + brighter than before)
            c.save();
            c.globalCompositeOperation = 'lighter';
            const halo = c.createRadialGradient(signLeft + signW * 0.5, cy, 14, signLeft + signW * 0.5, cy, signW * 1.1);
            halo.addColorStop(0, `rgba(255, 230, 200, ${0.45 * onK})`);
            halo.addColorStop(0.35, `rgba(255, 200, 140, ${0.22 * onK})`);
            halo.addColorStop(0.75, `rgba(180, 200, 255, ${0.10 * onK})`);
            halo.addColorStop(1, 'rgba(180, 200, 255, 0)');
            c.fillStyle = halo;
            c.fillRect(signLeft - signW * 0.6, cy - signH * 3, signW * 2.2, signH * 6);
            c.restore();

            // Sign back panel (warm white, two-tone with subtle gradient)
            c.globalAlpha = this.signOn;
            const panel = c.createLinearGradient(0, signTop, 0, signBot);
            panel.addColorStop(0, '#fefef8');
            panel.addColorStop(1, '#f4f0e0');
            c.fillStyle = panel;
            c.fillRect(signLeft, signTop, signW, signH);

            // Three horizontal brand stripes (red top, yellow accent, green bottom)
            c.fillStyle = '#e8392a';
            c.fillRect(signLeft, signTop, signW, 7);
            c.fillStyle = '#ffc23a';
            c.fillRect(signLeft, signTop + 7, signW, 3);
            c.fillStyle = '#1ea84a';
            c.fillRect(signLeft, signBot - 7, signW, 7);

            // Inset hairlines
            c.fillStyle = 'rgba(40, 30, 20, 0.10)';
            c.fillRect(signLeft, signTop + 10, signW, 1);
            c.fillRect(signLeft, signBot - 8, signW, 1);

            // Left sun-emblem tile (the brand mark)
            const tileX = signLeft + 8;
            const tileY = signTop + 14;
            const tileSize = signH - 26;
            // Sun disc
            c.fillStyle = '#ffb030';
            c.beginPath();
            c.arc(tileX + tileSize * 0.5, tileY + tileSize * 0.5, tileSize * 0.42, 0, Math.PI * 2);
            c.fill();
            // Sun rays — 8 little spokes around it
            c.save();
            c.translate(tileX + tileSize * 0.5, tileY + tileSize * 0.5);
            c.fillStyle = '#ff8a20';
            for (let r = 0; r < 8; r++) {
                c.save();
                c.rotate(r * Math.PI / 4 + Math.PI / 8);
                c.fillRect(tileSize * 0.46, -1, tileSize * 0.16, 2);
                c.restore();
            }
            c.restore();
            // Hot inner core
            c.fillStyle = '#fff4c8';
            c.beginPath();
            c.arc(tileX + tileSize * 0.5, tileY + tileSize * 0.5, tileSize * 0.22, 0, Math.PI * 2);
            c.fill();

            // Center brand text — real Japanese typography
            c.save();
            c.fillStyle = '#162540';
            c.font = this._fontKanaBig;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(BRAND_KANA, signLeft + signW * 0.5, cy - 4 * this.s);
            // English sub-text below (offset scales with the sign)
            c.fillStyle = '#e8392a';
            c.font = this._fontLatin;
            c.fillText(BRAND_LATIN, signLeft + signW * 0.5, cy + 16 * this.s);
            c.restore();

            c.globalAlpha = 1;
        }

        // Solid-block kana. variant: 0=コ 1=ン 2=ビ 3=ニ
        drawBlockKana(c, cx, cy, w, h, variant, color) {
            c.fillStyle = color;
            const r = Math.max(2, Math.min(w, h) * 0.16);   // stroke thickness
            const v = variant & 3;
            if (v === 0) {
                // コ: top horizontal, right vertical, bottom horizontal
                const w0 = w * 0.82;
                const h0 = h * 0.82;
                const x0 = cx - w0 * 0.5;
                const y0 = cy - h0 * 0.5;
                c.fillRect(x0, y0, w0, r);
                c.fillRect(x0 + w0 - r, y0, r, h0);
                c.fillRect(x0, y0 + h0 - r, w0, r);
            } else if (v === 1) {
                // ン: small tick top-right, then diagonal swooping down-left to bottom-right
                const w0 = w * 0.84;
                const h0 = h * 0.82;
                const x0 = cx - w0 * 0.5;
                const y0 = cy - h0 * 0.5;
                // tick (short horizontal upper-left)
                c.fillRect(x0, y0 + h0 * 0.10, w0 * 0.32, r);
                // diagonal
                c.save();
                c.translate(x0 + w0, y0 + h0 * 0.15);
                const len = Math.hypot(w0 * 0.95, h0 * 0.78);
                const ang = Math.atan2(h0 * 0.78, -w0 * 0.95);
                c.rotate(ang);
                c.fillRect(0, -r * 0.4, len, r);
                c.restore();
            } else if (v === 2) {
                // ビ (bi): vertical bar + two horizontals to the right + dakuten
                const w0 = w * 0.84;
                const h0 = h * 0.82;
                const x0 = cx - w0 * 0.45;
                const y0 = cy - h0 * 0.5;
                // vertical
                c.fillRect(x0, y0, r, h0);
                // upper horizontal (short)
                c.fillRect(x0, y0 + h0 * 0.18, w0 * 0.55, r);
                // middle horizontal (short)
                c.fillRect(x0, y0 + h0 * 0.55, w0 * 0.45, r);
                // bottom horizontal (long)
                c.fillRect(x0, y0 + h0 - r, w0 * 0.78, r);
                // dakuten: two small squares upper-right
                c.fillRect(x0 + w0 * 0.78, y0 + h0 * 0.02, r * 0.9, r * 0.9);
                c.fillRect(x0 + w0 * 0.90, y0 + h0 * 0.18, r * 0.9, r * 0.9);
            } else {
                // ニ: two horizontals (shorter on top, longer below)
                const w0 = w * 0.88;
                const h0 = h * 0.82;
                const x0 = cx - w0 * 0.5;
                const y0 = cy - h0 * 0.5;
                c.fillRect(x0 + w0 * 0.10, y0 + h0 * 0.25, w0 * 0.70, r);
                c.fillRect(x0, y0 + h0 - r, w0, r);
            }
        }

        drawOpen24Tag(t) {
            // Stacked sub-signage below the main brand sign:
            //   [ATM] [宅急便] [24時間営業] in a row
            // Each is its own backlit panel with independent flicker / glow.
            const c = this.ctx;
            const L = this._layout;
            const sw = L.sw;
            const signLeft = this.storeLeft + sw * 0.18;
            const signW = sw * 0.64;
            const rowY = this.signCy + (28 + 4) * this.s;
            const rowH = 13 * this.s;
            const darkK = this.atmo ? this.atmo.dark : 1;
            const baseOn = this.tagOn * (0.20 + 0.80 * darkK);
            // Three panels, fractional widths sum to 1.
            const panels = [
                { w: 0.20, bg: '#0a2c5e', fg: '#ffffff', text: 'ATM',         font: this._fontLatin,   glow: 'rgba(80, 160, 255,' },
                { w: 0.30, bg: '#ffcc1f', fg: '#1a1410', text: '宅急便',       font: this._fontKanaSub, glow: 'rgba(255, 200, 90,' },
                { w: 0.50, bg: '#d9241f', fg: '#ffffff', text: '24時間営業',   font: this._fontKanaSub, glow: 'rgba(255, 80, 50,'  },
            ];
            let px = signLeft;
            const gap = 4;
            const innerW = signW - gap * (panels.length - 1);
            for (let i = 0; i < panels.length; i++) {
                const p = panels[i];
                const pw = innerW * p.w;
                // Independent slight flicker phase per panel
                const onK = baseOn * (0.85 + 0.15 * Math.sin(t * 0.003 + i * 2.1));

                // Glow halo
                c.save();
                c.globalCompositeOperation = 'lighter';
                const halo = c.createRadialGradient(px + pw * 0.5, rowY + rowH * 0.5, 3, px + pw * 0.5, rowY + rowH * 0.5, pw * 0.95);
                halo.addColorStop(0, `${p.glow} ${0.45 * onK})`);
                halo.addColorStop(1, `${p.glow} 0)`);
                c.fillStyle = halo;
                c.fillRect(px - pw * 0.5, rowY - rowH * 0.5, pw * 2, rowH * 2);
                c.restore();

                c.globalAlpha = this.tagOn;
                c.fillStyle = p.bg;
                c.fillRect(px, rowY, pw, rowH);
                // bezel
                c.strokeStyle = 'rgba(20, 10, 10, 0.65)';
                c.lineWidth = 1;
                c.strokeRect(px + 0.5, rowY + 0.5, pw - 1, rowH - 1);
                // top sheen
                c.fillStyle = 'rgba(255, 255, 255, 0.10)';
                c.fillRect(px + 1, rowY + 1, pw - 2, 1.2);

                // text
                c.fillStyle = p.fg;
                c.font = p.font;
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(p.text, px + pw * 0.5, rowY + rowH * 0.55);

                // For the red 24h banner, prepend a small red dot icon
                if (i === 2) {
                    c.fillStyle = '#ffd34a';
                    c.beginPath();
                    c.arc(px + 9, rowY + rowH * 0.5, 2.2, 0, Math.PI * 2);
                    c.fill();
                }

                c.globalAlpha = 1;
                px += pw + gap;
            }

            // Vertical sub-pole sign hanging from sign-stack right edge: "営業中"
            // (now open). Painted as a tall narrow rectangle.
            const vertX = signLeft + signW + 6 * this.s;
            const vertW = 14 * this.s;
            const vertY = this.signCy - 24 * this.s;
            const vertH = 64 * this.s;
            c.save();
            c.globalCompositeOperation = 'lighter';
            const vGlow = c.createRadialGradient(vertX + vertW * 0.5, vertY + vertH * 0.5, 2, vertX + vertW * 0.5, vertY + vertH * 0.5, 30);
            vGlow.addColorStop(0, `rgba(255, 90, 60, ${0.42 * baseOn})`);
            vGlow.addColorStop(1, 'rgba(255, 90, 60, 0)');
            c.fillStyle = vGlow;
            c.fillRect(vertX - 16, vertY - 16, vertW + 32, vertH + 32);
            c.restore();
            c.fillStyle = '#cc1e1a';
            c.fillRect(vertX, vertY, vertW, vertH);
            c.fillStyle = 'rgba(255, 255, 255, 0.1)';
            c.fillRect(vertX, vertY, 1, vertH);
            c.fillStyle = '#fff';
            c.font = this._fontKanaTiny;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('営', vertX + vertW * 0.5, vertY + vertH * 0.20);
            c.fillText('業', vertX + vertW * 0.5, vertY + vertH * 0.50);
            c.fillText('中', vertX + vertW * 0.5, vertY + vertH * 0.80);
        }

        // =========================================================
        // STREET FURNITURE
        // =========================================================
        drawStreetlight() {
            const c = this.ctx;
            const x = this._streetlightX;
            const baseY = this.groundY;
            const s = this.s;
            // Pole
            c.fillStyle = '#0a0e16';
            c.fillRect(x - 1.5 * s, baseY - 130 * s, 3 * s, 130 * s);
            // Decorative band
            c.fillStyle = '#1a2030';
            c.fillRect(x - 3 * s, baseY - 24 * s, 6 * s, 4 * s);
            c.fillRect(x - 3 * s, baseY - 60 * s, 6 * s, 2 * s);
            // Arm
            c.fillRect(x, baseY - 130 * s, 18 * s, 3 * s);
            // Lamp shade
            c.fillStyle = '#161c28';
            c.fillRect(x + 14 * s, baseY - 140 * s, 8 * s, 12 * s);
            // Bulb glow
            const bulbX = x + 18 * s;
            const bulbY = baseY - 134 * s;
            c.save();
            c.globalCompositeOperation = 'lighter';
            const grad = c.createRadialGradient(bulbX, bulbY, 1, bulbX, bulbY, 80 * s);
            grad.addColorStop(0, 'rgba(255, 220, 140, 0.72)');
            grad.addColorStop(0.5, 'rgba(255, 220, 140, 0.22)');
            grad.addColorStop(1, 'rgba(255, 220, 140, 0)');
            c.fillStyle = grad;
            c.fillRect(bulbX - 82 * s, bulbY - 82 * s, 164 * s, 164 * s);
            // Tight bright core
            const core = c.createRadialGradient(bulbX, bulbY, 0.5, bulbX, bulbY, 8 * s);
            core.addColorStop(0, 'rgba(255, 250, 220, 0.95)');
            core.addColorStop(1, 'rgba(255, 240, 200, 0)');
            c.fillStyle = core;
            c.fillRect(bulbX - 9 * s, bulbY - 9 * s, 18 * s, 18 * s);
            c.restore();

            // Warm ground puddle under streetlight (separate from zones)
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.fillStyle = 'rgba(255, 200, 130, 0.24)';
            c.beginPath();
            c.ellipse(bulbX, this.groundY + 22 * s, 100 * s, 18 * s, 0, 0, Math.PI * 2);
            c.fill();
            c.restore();
        }

        drawVendingCluster(t) {
            const L = this._layout;
            // Back machine (smaller, coffee brand — darker)
            this.drawVendingMachine(this.ctx, L.vm2X, L.vm2Y, L.vm2W, L.vm2H, {
                bodyColor: '#3a2818',
                brandTop: '#a83426',
                bottleCols: 3,
                bottleRows: 4,
                brandKind: 'coffee',
                t,
            });
            // Front machine (taller, soda brand — bright)
            this.drawVendingMachine(this.ctx, L.vmX, L.vmY, L.vmW, L.vmH, {
                bodyColor: '#15355e',
                brandTop: '#ea3a3a',
                bottleCols: 4,
                bottleRows: 5,
                brandKind: 'soda',
                t,
            });
        }

        drawVendingMachine(c, x, y, vmW, vmH, opts) {
            const targetW = vmW || 100, targetH = vmH || 170;
            const designW = 100, designH = 170;
            const sx = targetW / designW;
            const sy = targetH / designH;
            const darkK = this.atmo ? this.atmo.dark : 1;
            const glowAlpha = 0.20 + 0.80 * darkK;
            const t = opts.t || 0;

            // Halo (uses on-screen size directly)
            c.save();
            c.globalCompositeOperation = 'lighter';
            const baseHaloColor = opts.brandKind === 'coffee' ? 'rgba(196, 142, 220, ' : 'rgba(120, 200, 255, ';
            const vmGlow = c.createRadialGradient(
                x + targetW * 0.5, y + targetH * 0.42, 10,
                x + targetW * 0.5, y + targetH * 0.42, 220 * Math.max(sx, sy)
            );
            vmGlow.addColorStop(0, `${baseHaloColor}${0.42 * glowAlpha})`);
            vmGlow.addColorStop(0.5, `${baseHaloColor}${0.14 * glowAlpha})`);
            vmGlow.addColorStop(1, `${baseHaloColor}0)`);
            c.fillStyle = vmGlow;
            c.fillRect(x - 130, y - 90, targetW + 260, targetH + 180);
            c.restore();

            // Draw at design size
            c.save();
            c.translate(x, y);
            c.scale(sx, sy);
            x = 0; y = 0;
            const W = designW, H = designH;

            // Body
            c.fillStyle = opts.bodyColor;
            c.fillRect(x, y, W, H);
            // Vertical body shading — strong enough that the cabinet reads
            // as a 3D box rather than a flat color panel.
            const bodyShade = c.createLinearGradient(x, y, x + W, y);
            bodyShade.addColorStop(0, 'rgba(255,255,255,0.14)');
            bodyShade.addColorStop(0.45, 'rgba(255,255,255,0)');
            bodyShade.addColorStop(1, 'rgba(0,0,0,0.30)');
            c.fillStyle = bodyShade;
            c.fillRect(x, y, W, H);
            // Bright edge highlight on the lit side.
            c.fillStyle = 'rgba(255,255,255,0.18)';
            c.fillRect(x, y, 2, H);

            // Top illuminated brand band (3-tier)
            c.fillStyle = '#fbcd2a';
            c.fillRect(x, y, W, 14);
            c.fillStyle = opts.brandTop;
            c.fillRect(x + 4, y + 2, W - 8, 8);
            // brand text bars
            c.fillStyle = '#fff';
            const bandY = y + 4;
            for (let k = 0; k < 6; k++) {
                c.fillRect(x + 12 + k * 13, bandY, 8, 4);
            }

            // Glass display area
            const dx = x + 6, dy = y + 18, dw = W - 12, dh = 108;
            c.fillStyle = '#e8f0f8';
            c.fillRect(dx, dy, dw, dh);
            const refl = c.createLinearGradient(dx, dy, dx + dw, dy);
            refl.addColorStop(0, 'rgba(255,255,255,0.32)');
            refl.addColorStop(0.5, 'rgba(255,255,255,0.05)');
            refl.addColorStop(1, 'rgba(255,255,255,0.22)');
            c.fillStyle = refl;
            c.fillRect(dx, dy, dw, dh);

            // Bottles
            const cols = opts.bottleCols;
            const rows = opts.bottleRows;
            const bottleColors = opts.brandKind === 'coffee'
                ? ['#3a2818', '#82664a', '#c8a87a', '#3a2818', '#5a3818', '#a87852']
                : ['#ff6a3a', '#3a8aff', '#3aff7e', '#fff04a', '#cf3a99', '#10aaaa', '#e8f0f0', '#a83426'];
            for (let r = 0; r < rows; r++) {
                for (let k = 0; k < cols; k++) {
                    const bw = (dw - 4) / cols;
                    const bh = (dh - 6) / rows;
                    const bx = dx + 2 + k * bw;
                    const by = dy + 2 + r * bh;
                    if (k === 0) {
                        c.fillStyle = 'rgba(80, 100, 120, 0.45)';
                        c.fillRect(dx + 2, by + bh - 1.5, dw - 4, 1.2);
                    }
                    const colIdx = (r * cols + k) % bottleColors.length;
                    c.fillStyle = bottleColors[colIdx];
                    c.fillRect(bx + bw * 0.20, by + 2, bw * 0.6, bh - 5);
                    c.fillStyle = this.mixColor(bottleColors[colIdx], '#000', 0.45);
                    c.fillRect(bx + bw * 0.30, by + 0.6, bw * 0.4, 2);
                    c.fillStyle = '#fff';
                    c.fillRect(bx + bw * 0.24, by + bh * 0.45, bw * 0.52, 2);
                    // price button
                    c.fillStyle = '#1a2030';
                    c.fillRect(bx + bw * 0.78, by + bh - 4, bw * 0.20, 3);
                    c.fillStyle = '#ea3a3a';
                    c.fillRect(bx + bw * 0.80, by + bh - 3.5, bw * 0.16, 2);
                }
            }

            // Display bezel
            c.strokeStyle = 'rgba(20, 30, 40, 0.55)';
            c.lineWidth = 1.4;
            c.strokeRect(dx - 1, dy - 1, dw + 2, dh + 2);

            // Bottom panel
            c.fillStyle = '#0a1224';
            c.fillRect(x + 4, y + 128, W - 8, 38);
            // Payment display
            c.fillStyle = '#1a3a55';
            c.fillRect(x + 8, y + 132, 32, 12);
            c.fillStyle = '#3afaa0';
            c.fillRect(x + 12, y + 136, 22, 2);
            c.fillRect(x + 12, y + 140, 16, 2);
            // Coin slot
            c.fillStyle = '#cfd5dc';
            c.fillRect(x + W - 26, y + 136, 18, 3);
            c.fillStyle = '#0a0c12';
            c.fillRect(x + W - 25, y + 137, 16, 1);
            // Bill slot
            c.fillStyle = '#cfd5dc';
            c.fillRect(x + W - 26, y + 144, 18, 2);
            // Change return tray (recessed)
            c.fillStyle = '#1a2030';
            c.fillRect(x + 8, y + 148, 26, 12);
            c.fillStyle = '#0a1018';
            c.fillRect(x + 9, y + 149, 24, 10);
            // tray gloss
            c.fillStyle = 'rgba(255,255,255,0.08)';
            c.fillRect(x + 9, y + 149, 24, 1);

            // Outer bezel
            c.strokeStyle = '#080b14';
            c.lineWidth = 2;
            c.strokeRect(x, y, W, H);

            c.restore();
        }

        drawSandwichBoard() {
            const c = this.ctx;
            const L = this._layout;
            // Anchor at the board's ground point, then draw in design px
            // under the scene scale so the prop tracks the storefront.
            c.save();
            c.translate(L.sandwichX, this.groundY);
            c.scale(this.s, this.s);
            const x = 0;
            const baseY = 0;
            // A-frame body
            c.fillStyle = '#1a1410';
            c.beginPath();
            c.moveTo(x, baseY);
            c.lineTo(x + 6, baseY - 30);
            c.lineTo(x + 26, baseY - 30);
            c.lineTo(x + 32, baseY);
            c.closePath();
            c.fill();
            // Chalkboard face
            c.fillStyle = '#0e1418';
            c.fillRect(x + 4, baseY - 28, 24, 24);
            c.fillStyle = '#3a4448';
            c.fillRect(x + 4, baseY - 28, 24, 1);
            c.fillRect(x + 4, baseY - 5, 24, 1);
            // Chalk text bars
            c.fillStyle = 'rgba(245, 235, 200, 0.85)';
            c.fillRect(x + 7, baseY - 24, 18, 1.4);
            c.fillStyle = 'rgba(255, 180, 100, 0.85)';
            c.fillRect(x + 7, baseY - 20, 12, 1.2);
            c.fillStyle = 'rgba(180, 230, 180, 0.85)';
            c.fillRect(x + 7, baseY - 17, 14, 1.2);
            c.fillStyle = 'rgba(245, 235, 200, 0.85)';
            c.fillRect(x + 7, baseY - 13, 10, 1.2);
            // Stand legs
            c.fillStyle = '#0a0c14';
            c.fillRect(x + 5, baseY - 2, 4, 2);
            c.fillRect(x + 23, baseY - 2, 4, 2);
            c.restore();
        }

        drawTrashBins() {
            const c = this.ctx;
            const L = this._layout;
            c.save();
            c.translate(L.trashX, this.groundY);
            c.scale(this.s, this.s);
            const x = 0;
            const baseY = 0;
            const bins = [
                { offset: 0,  cap: '#23a85a', label: '燃える', sub: 'BURN' },
                { offset: 18, cap: '#3a78e8', label: 'ペット', sub: 'PET'  },
                { offset: 36, cap: '#d92424', label: '缶',     sub: 'CAN'  },
            ];
            for (const b of bins) {
                const bx = x + b.offset;
                // Body
                c.fillStyle = '#2a3038';
                c.fillRect(bx, baseY - 32, 14, 32);
                // Side highlight
                c.fillStyle = 'rgba(255,255,255,0.07)';
                c.fillRect(bx, baseY - 32, 1, 32);
                c.fillStyle = 'rgba(0,0,0,0.30)';
                c.fillRect(bx + 12, baseY - 32, 2, 32);
                // Cap ring
                c.fillStyle = b.cap;
                c.fillRect(bx, baseY - 34, 14, 3);
                // Cap top sheen
                c.fillStyle = 'rgba(255,255,255,0.20)';
                c.fillRect(bx, baseY - 34, 14, 1);
                // Slot
                c.fillStyle = '#0a0c14';
                c.fillRect(bx + 2, baseY - 31, 10, 2);
                // Label panel (white card)
                c.fillStyle = 'rgba(255,255,255,0.78)';
                c.fillRect(bx + 1, baseY - 20, 12, 11);
                c.strokeStyle = 'rgba(0, 0, 0, 0.35)';
                c.lineWidth = 0.6;
                c.strokeRect(bx + 1.5, baseY - 19.5, 11, 10);
                // Kanji label (design-px font — the ctx is already scaled)
                c.save();
                c.fillStyle = '#16201e';
                c.font = "700 7px 'Yu Gothic UI','Meiryo','MS Gothic',sans-serif";
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(b.label, bx + 7, baseY - 16);
                c.font = "700 5px 'Helvetica Neue', sans-serif";
                c.fillText(b.sub, bx + 7, baseY - 11);
                c.restore();
            }
            c.restore();
        }

        // Tall narrow vertical banner (幟 nobori) flapping in the wind beside
        // the storefront. Reads "新商品" / "セール" with subtle wind sway.
        drawNoboriBanner(t, windNow) {
            const c = this.ctx;
            const L = this._layout;
            const baseY = this.groundY;
            const bx = L.sandwichX - 14 * this.s;
            const banH = 96 * this.s;
            const banW = 14 * this.s;
            const tipY = baseY - banH - 10 * this.s;
            // Pole
            c.fillStyle = '#0a0d18';
            c.fillRect(bx + banW * 0.5 - 1, tipY - 4, 2, banH + 14);
            // Banner panel (with wind warp)
            const sway = Math.sin(t * 0.003) * 2 + windNow * 0.1;
            c.save();
            c.fillStyle = '#cc1e1a';
            c.beginPath();
            c.moveTo(bx, tipY);
            c.quadraticCurveTo(bx + banW * 0.5 + sway * 0.5, tipY + banH * 0.5, bx + sway, tipY + banH);
            c.lineTo(bx + banW + sway, tipY + banH);
            c.quadraticCurveTo(bx + banW * 0.5 + sway * 0.5, tipY + banH * 0.5, bx + banW, tipY);
            c.closePath();
            c.fill();
            // Subtle inner shading
            c.fillStyle = 'rgba(0, 0, 0, 0.18)';
            c.fillRect(bx + banW - 2, tipY, 2, banH);
            // Banner text (vertical katakana) — y stops track the banner height
            c.fillStyle = '#fff8e8';
            c.font = this._fontKanaTiny;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('新', bx + banW * 0.5 + sway * 0.3, tipY + banH * 0.146);
            c.fillText('商', bx + banW * 0.5 + sway * 0.5, tipY + banH * 0.313);
            c.fillText('品', bx + banW * 0.5 + sway * 0.7, tipY + banH * 0.479);
            c.fillStyle = '#ffd34a';
            c.fillText('セ', bx + banW * 0.5 + sway * 0.6, tipY + banH * 0.667);
            c.fillText('ー', bx + banW * 0.5 + sway * 0.5, tipY + banH * 0.792);
            c.fillText('ル', bx + banW * 0.5 + sway * 0.4, tipY + banH * 0.917);
            c.restore();
            // Pole tip ball
            c.fillStyle = '#cfd5d8';
            c.beginPath();
            c.arc(bx + banW * 0.5, tipY - 4 * this.s, 2.2 * this.s, 0, Math.PI * 2);
            c.fill();
        }

        // Cylindrical standing ashtray near the entrance (smaller than trash
        // bins, distinctive metal sand-tray top).
        drawAshtray() {
            const c = this.ctx;
            const L = this._layout;
            c.save();
            c.translate(L.trashX + 60 * this.s, this.groundY);
            c.scale(this.s, this.s);
            const baseY = 0;
            const ax = 0;
            // Stand
            c.fillStyle = '#1a1d24';
            c.fillRect(ax, baseY - 26, 9, 26);
            c.fillStyle = 'rgba(255,255,255,0.08)';
            c.fillRect(ax, baseY - 26, 1, 26);
            // Sand tray
            c.fillStyle = '#8a8e94';
            c.fillRect(ax - 2, baseY - 30, 13, 5);
            c.fillStyle = '#d8c498';
            c.fillRect(ax - 1, baseY - 28, 11, 2);
            // Cigarette butts (tiny)
            c.fillStyle = '#f4f0e8';
            c.fillRect(ax + 2, baseY - 27, 1.4, 0.8);
            c.fillRect(ax + 5, baseY - 27, 1.4, 0.8);
            c.fillStyle = '#cc6644';
            c.fillRect(ax + 2.4, baseY - 27, 0.5, 0.8);
            c.restore();
        }

        drawBike() {
            // Park a row of 3 mama-chari bikes side-by-side in a rack.
            const c = this.ctx;
            const L = this._layout;
            const s = this.s;
            const baseY = this.groundY - 4 * s;
            const positions = [
                { x: L.bikeX,            scale: 1.0,  frameTint: '#0a0c14', basketTint: '#1a1c20', tiltDeg: -3, reflector: true,  light: true  },
                { x: L.bikeX + 38 * s,   scale: 0.95, frameTint: '#14242a', basketTint: '#1a1c20', tiltDeg: 1,  reflector: true,  light: false },
                { x: L.bikeX + 78 * s,   scale: 1.05, frameTint: '#1a1410', basketTint: '#241c14', tiltDeg: -2, reflector: false, light: false },
            ];
            // U-rack bar behind the bikes
            c.fillStyle = '#1a1d24';
            c.fillRect(L.bikeX - 12 * s, baseY - 14 * s, 130 * s, 3 * s);
            c.fillRect(L.bikeX - 12 * s, baseY - 14 * s, 3 * s, 12 * s);
            c.fillRect(L.bikeX + 115 * s, baseY - 14 * s, 3 * s, 12 * s);
            // Draw each bike
            for (const b of positions) {
                this.drawSingleBike(b.x, baseY, b.scale * s, b.frameTint, b.basketTint, b.tiltDeg * Math.PI / 180, b.reflector, b.light);
            }
        }

        drawSingleBike(x, baseY, scale, frameTint, basketTint, tiltRad, reflector, light) {
            const c = this.ctx;
            c.save();
            c.translate(x, baseY);
            c.scale(scale, scale);
            c.rotate(tiltRad);
            
            // Kickstand on rear wheel (rear is at x=34)
            c.strokeStyle = frameTint;
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(34, -2);
            c.lineTo(40, 0);
            c.stroke();
            
            // Wheels (front at x=0, rear at x=34)
            c.strokeStyle = frameTint;
            c.lineWidth = 2.6;
            c.beginPath();
            c.arc(0, -16, 14, 0, Math.PI * 2);
            c.stroke();
            c.beginPath();
            c.arc(34, -16, 14, 0, Math.PI * 2);
            c.stroke();
            
            // Spokes
            c.lineWidth = 0.7;
            for (let s = 0; s < 6; s++) {
                const ang = s * Math.PI / 6;
                c.beginPath();
                c.moveTo(Math.cos(ang) * 12, -16 + Math.sin(ang) * 12);
                c.lineTo(-Math.cos(ang) * 12, -16 - Math.sin(ang) * 12);
                c.stroke();
                
                c.beginPath();
                c.moveTo(34 + Math.cos(ang) * 12, -16 + Math.sin(ang) * 12);
                c.lineTo(34 - Math.cos(ang) * 12, -16 - Math.sin(ang) * 12);
                c.stroke();
            }
            
            // Frame stays & tubes
            c.strokeStyle = frameTint;
            c.lineWidth = 2.4;
            c.beginPath();
            // Chain stay: rear wheel axle (34, -16) to bottom bracket (20, -16)
            c.moveTo(34, -16);
            c.lineTo(20, -16);
            
            // Seat stay: rear wheel axle (34, -16) to seat cluster (20, -34)
            c.moveTo(34, -16);
            c.lineTo(20, -34);
            
            // Seat tube: bottom bracket (20, -16) to seat cluster (20, -34)
            c.moveTo(20, -16);
            c.lineTo(20, -34);
            
            // Down tube: bottom bracket (20, -16) to head tube bottom (8, -26)
            c.moveTo(20, -16);
            c.lineTo(8, -26);
            
            // Head tube: head tube bottom (8, -26) to head tube top (6, -34)
            c.moveTo(8, -26);
            c.lineTo(6, -34);
            
            // Low step-through top tube: seat cluster (20, -34) curving down and up to head tube (6, -34)
            c.moveTo(20, -34);
            c.quadraticCurveTo(12, -26, 6, -34);
            
            // Front forks: head tube bottom (8, -26) down to front wheel axle (0, -16)
            c.moveTo(8, -26);
            c.lineTo(0, -16);
            c.stroke();
            
            // Seat post & seat saddle (sits on seat cluster x=20, y=-34)
            c.fillStyle = frameTint;
            c.fillRect(19.2, -38, 1.6, 4); // seat post
            c.fillStyle = '#1a1c20'; // seat saddle (facing left)
            c.beginPath();
            c.moveTo(13, -41);
            c.lineTo(24, -41);
            c.lineTo(23, -38);
            c.lineTo(15, -38);
            c.closePath();
            c.fill();
            
            // Handlebars & stem (on head tube top x=6, y=-34)
            c.strokeStyle = frameTint;
            c.lineWidth = 2.0;
            c.beginPath();
            c.moveTo(6, -34);
            c.lineTo(6, -42); // stem
            c.lineTo(10, -42); // handlebar curve back
            c.stroke();
            
            // Front mama-chari basket (attached ahead of the stem)
            c.fillStyle = basketTint;
            c.fillRect(-8, -44, 12, 10);
            c.strokeStyle = 'rgba(60, 60, 60, 0.55)';
            c.lineWidth = 0.6;
            for (let k = 0; k < 4; k++) {
                c.beginPath();
                c.moveTo(-8 + k * 3, -44);
                c.lineTo(-8 + k * 3, -34);
                c.stroke();
            }
            
            // Rear reflector (small red square behind rear wheel)
            if (reflector) {
                c.fillStyle = '#d92424';
                c.fillRect(38, -24, 2.5, 2.5);
                c.fillStyle = 'rgba(255, 80, 60, 0.55)';
                c.fillRect(37.5, -24.5, 3.5, 3.5);
            }
            
            // Front headlight (mounted on front of basket, sometimes lit)
            if (light) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                const hgrad = c.createRadialGradient(-8, -39, 0.5, -8, -39, 10);
                hgrad.addColorStop(0, 'rgba(255, 220, 140, 0.75)');
                hgrad.addColorStop(1, 'rgba(255, 220, 140, 0)');
                c.fillStyle = hgrad;
                c.fillRect(-18, -49, 20, 20);
                c.restore();
                c.fillStyle = '#fff2a6';
                c.fillRect(-9, -40, 2, 2);
            }
            c.restore();
        }

        // =========================================================
        // GROUND + PUDDLES + REFLECTIONS
        // =========================================================
        drawGround() {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const ground = c.createLinearGradient(0, this.groundY, 0, h);
            ground.addColorStop(0, '#0c1018');
            ground.addColorStop(0.4, '#080b12');
            ground.addColorStop(1, '#030506');
            c.fillStyle = ground;
            c.fillRect(0, this.groundY, w, h - this.groundY);
            // Sidewalk zone (slightly raised, slightly different tone, in front
            // of the storefront)
            const sidewalkBot = this.groundY + (h - this.groundY) * 0.22;
            c.fillStyle = 'rgba(40, 38, 36, 0.35)';
            c.fillRect(0, this.groundY, w, sidewalkBot - this.groundY);
            // Curb edge — a thin lighter line where sidewalk meets road
            c.fillStyle = 'rgba(160, 155, 150, 0.18)';
            c.fillRect(0, sidewalkBot - 1, w, 1.2);
            c.fillStyle = 'rgba(0, 0, 0, 0.40)';
            c.fillRect(0, sidewalkBot, w, 1);
            // Yellow tactile paving strip (点字ブロック) — runs along the curb
            // edge. Dotted yellow rectangles.
            const tactileY = sidewalkBot - 7;
            for (let x = 0; x < w; x += 8) {
                c.fillStyle = 'rgba(220, 180, 30, 0.55)';
                c.fillRect(x, tactileY, 5, 5);
                c.fillStyle = 'rgba(0, 0, 0, 0.30)';
                c.fillRect(x + 1.5, tactileY + 1.5, 2, 2);
            }
            // Road markings — yellow center stripe far down (lane marker)
            const laneY = h - 14;
            c.fillStyle = 'rgba(210, 180, 30, 0.30)';
            for (let x = 0; x < w; x += 60) {
                c.fillRect(x, laneY, 28, 2);
            }
            // Drainage grate near the gutter (single one, deterministic position)
            const grateX = w * 0.78;
            const grateY = sidewalkBot + 4;
            c.fillStyle = 'rgba(15, 18, 24, 0.85)';
            c.fillRect(grateX, grateY, 38, 14);
            c.strokeStyle = 'rgba(70, 80, 90, 0.55)';
            c.lineWidth = 0.6;
            for (let k = 1; k < 6; k++) {
                c.beginPath();
                c.moveTo(grateX + k * 6, grateY + 1);
                c.lineTo(grateX + k * 6, grateY + 13);
                c.stroke();
            }
            // Welcome mat in front of the doors
            const L = this._layout;
            if (L) {
                const matX = L.doorLeft - 6;
                const matY = this.groundY - 2;
                const matW = L.doorW + 12;
                c.fillStyle = 'rgba(40, 32, 28, 0.85)';
                c.fillRect(matX, matY, matW, 6);
                c.fillStyle = 'rgba(80, 70, 60, 0.40)';
                c.fillRect(matX, matY, matW, 1);
                // Mat tread lines
                c.strokeStyle = 'rgba(20, 16, 12, 0.65)';
                c.lineWidth = 0.5;
                for (let k = 1; k < 6; k++) {
                    c.beginPath();
                    c.moveTo(matX, matY + k);
                    c.lineTo(matX + matW, matY + k);
                    c.stroke();
                }
            }
        }

        drawPuddles(t, atmo, baseOnly) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            // Blob points are authored in px around the fractional center —
            // scale them so puddles keep their footprint at any resolution.
            const ps = this.s;
            for (let i = 0; i < this.puddles.length; i++) {
                const p = this.puddles[i];
                const px = p.xk * w;
                const py = p.yk * h;
                if (baseOnly) {
                    c.fillStyle = 'rgba(18, 22, 30, 0.55)';
                    c.beginPath();
                    c.moveTo(px + p.pts[0].dx * ps, py + p.pts[0].dy * 0.30 * ps);
                    for (let k = 1; k < p.pts.length; k++) {
                        const pt = p.pts[k];
                        c.lineTo(px + pt.dx * ps, py + pt.dy * 0.30 * ps);
                    }
                    c.closePath();
                    c.fill();
                    // Inner darker fill for depth
                    c.fillStyle = 'rgba(8, 10, 16, 0.45)';
                    c.beginPath();
                    c.moveTo(px + p.pts[0].dx * 0.70 * ps, py + p.pts[0].dy * 0.22 * ps);
                    for (let k = 1; k < p.pts.length; k++) {
                        const pt = p.pts[k];
                        c.lineTo(px + pt.dx * 0.70 * ps, py + pt.dy * 0.22 * ps);
                    }
                    c.closePath();
                    c.fill();
                } else {
                    c.save();
                    c.globalCompositeOperation = 'lighter';
                    const shimmer = 0.55 + 0.45 * Math.sin(t * 0.003 + p.shimmerPhase);
                    c.fillStyle = `rgba(160, 200, 240, ${0.20 * shimmer})`;
                    c.beginPath();
                    c.moveTo(px + p.pts[0].dx * 0.85 * ps, py + p.pts[0].dy * 0.18 * ps);
                    for (let k = 1; k < p.pts.length; k++) {
                        const pt = p.pts[k];
                        c.lineTo(px + pt.dx * 0.85 * ps, py + pt.dy * 0.18 * ps);
                    }
                    c.closePath();
                    c.fill();
                    c.restore();
                }
            }
        }

        // Colored light pools cast by each vending machine and the streetlight
        // onto the wet pavement immediately under them. Distinct from the
        // distorted reflection bands further down.
        drawColoredLightPools(t, atmo) {
            const c = this.ctx;
            const L = this._layout;
            const darkK = 0.30 + 0.70 * atmo.dark;
            c.save();
            c.globalCompositeOperation = 'lighter';

            // Main soda VM — cool cyan pool
            const vm1cx = L.vmX + L.vmW * 0.5;
            const g1 = c.createRadialGradient(vm1cx, this.groundY + 4, 4, vm1cx, this.groundY + 20, L.vmW * 1.1);
            g1.addColorStop(0, `rgba(140, 210, 255, ${0.48 * darkK})`);
            g1.addColorStop(0.5, `rgba(120, 180, 250, ${0.22 * darkK})`);
            g1.addColorStop(1, 'rgba(80, 140, 240, 0)');
            c.fillStyle = g1;
            c.fillRect(vm1cx - L.vmW * 1.1, this.groundY, L.vmW * 2.2, 50);

            // Coffee VM — warm violet pool
            const vm2cx = L.vm2X + L.vm2W * 0.5;
            const g2 = c.createRadialGradient(vm2cx, this.groundY + 4, 3, vm2cx, this.groundY + 18, L.vm2W * 1.1);
            g2.addColorStop(0, `rgba(220, 160, 220, ${0.38 * darkK})`);
            g2.addColorStop(0.6, `rgba(180, 130, 200, ${0.18 * darkK})`);
            g2.addColorStop(1, 'rgba(150, 100, 180, 0)');
            c.fillStyle = g2;
            c.fillRect(vm2cx - L.vm2W * 1.1, this.groundY, L.vm2W * 2.2, 40);

            // Sign pool (small, directly under sign)
            const signX = this.storeLeft + L.sw * 0.5;
            const sg = c.createRadialGradient(signX, this.groundY + 4, 5, signX, this.groundY + 26, L.sw * 0.4);
            sg.addColorStop(0, `rgba(255, 220, 170, ${0.30 * darkK * this.signOn})`);
            sg.addColorStop(1, 'rgba(255, 200, 130, 0)');
            c.fillStyle = sg;
            c.fillRect(signX - L.sw * 0.4, this.groundY, L.sw * 0.8, 50);

            c.restore();
        }

        // Long sharp shadows cast forward by the window mullions when the
        // interior is bright. Adds the "lighthouse" feel of an overlit
        // storefront throwing dark lines onto the wet pavement.
        drawMullionShadows(atmo) {
            const c = this.ctx;
            const L = this._layout;
            const sharpK = 1 - this.clamp(atmo.dark * 0.4, 0, 0.4);
            c.save();
            c.fillStyle = `rgba(0, 0, 0, ${0.22 * sharpK})`;
            // Central mullion shadow
            const cx0 = L.winLeft + L.winW * 0.5;
            c.fillRect(cx0 - 1.5, this.groundY, 3, 6);
            // Side frame shadows
            c.fillStyle = `rgba(0, 0, 0, ${0.16 * sharpK})`;
            c.fillRect(L.winLeft - 2, this.groundY, 3, 8);
            c.fillRect(L.winLeft + L.winW - 1, this.groundY, 3, 8);
            c.restore();
        }

        // Low ground-level mist that softens distant buildings/pavement.
        drawGroundMist(atmo) {
            const c = this.ctx;
            const w = this.width;
            const mistY = this.groundY - 14;
            const mistH = 28;
            c.save();
            const grad = c.createLinearGradient(0, mistY, 0, mistY + mistH);
            const ma = 0.10 + atmo.dark * 0.08;
            grad.addColorStop(0, 'rgba(180, 195, 215, 0)');
            grad.addColorStop(0.5, `rgba(180, 195, 215, ${ma})`);
            grad.addColorStop(1, 'rgba(180, 195, 215, 0)');
            c.fillStyle = grad;
            c.fillRect(0, mistY, w, mistH);
            c.restore();
        }

        // Rain catching light as it passes in front of bright sources. Renders
        // small additive streaks over the storefront and vending machines.
        drawRainLightCatch(atmo) {
            const c = this.ctx;
            const L = this._layout;
            if (atmo.dark < 0.2) return;
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = `rgba(255, 240, 200, ${0.18 * atmo.dark})`;
            c.lineWidth = 0.8;
            // Random short streaks in front of the window glass
            for (let i = 0; i < 16; i++) {
                const x = L.winLeft + Math.random() * L.winW;
                const y = L.winTop + Math.random() * L.winH;
                c.beginPath();
                c.moveTo(x, y);
                c.lineTo(x - 3, y - 9);
                c.stroke();
            }
            c.strokeStyle = `rgba(180, 220, 255, ${0.20 * atmo.dark})`;
            // Streaks in front of vending machines
            for (let i = 0; i < 8; i++) {
                const x = L.vmX + Math.random() * L.vmW;
                const y = L.vmY + Math.random() * L.vmH;
                c.beginPath();
                c.moveTo(x, y);
                c.lineTo(x - 3, y - 9);
                c.stroke();
            }
            c.restore();
        }

        // Splash dots — tiny ellipses at the rain's ground-impact zones.
        drawSplashDots(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            if (!this._splashes) this._splashes = [];
            const spawnPerFrame = Math.min(3, Math.floor(dt / 16) + 1);
            for (let k = 0; k < spawnPerFrame; k++) {
                if (this._splashes.length < 60) {
                    this._splashes.push({
                        x: Math.random() * w,
                        y: this.groundY + 6 + Math.random() * (h - this.groundY - 14),
                        age: 0,
                        life: 220 + Math.random() * 180,
                    });
                }
            }
            for (let i = this._splashes.length - 1; i >= 0; i--) {
                const s = this._splashes[i];
                s.age += dt;
                if (s.age >= s.life) { this._splashes.splice(i, 1); continue; }
                const k = s.age / s.life;
                const a = (1 - k) * 0.55;
                const r = 0.5 + k * 1.6;
                c.fillStyle = `rgba(210, 225, 245, ${a})`;
                c.beginPath();
                c.ellipse(s.x, s.y, r, r * 0.55, 0, 0, Math.PI * 2);
                c.fill();
            }
        }

        drawReflectionsLayered(t, atmo) {
            const c = this.ctx;
            const h = this.height;
            c.save();
            c.globalCompositeOperation = 'lighter';
            const zones = this._reflectionZones;
            for (let zi = 0; zi < zones.length; zi++) {
                const z = zones[zi];
                let alphaScale = z.alphaScale;
                if (z.isSign) alphaScale *= this.signOn;
                else if (z.isVm1 || z.isVm2) alphaScale *= (0.30 + 0.70 * atmo.dark);

                const yStep = z.yStep;
                // Color strings only depend on row index + quantized
                // alphaScale; cache them so we don't build hundreds of
                // strings per frame (matters at 1440p+).
                const qKey = Math.round(alphaScale * 64);
                if (!z._rowColors || z._rowKey !== qKey) {
                    z._rowColors = [];
                    for (let y = this.groundY, i = 0; y < h; y += yStep, i++) {
                        const k = (y - this.groundY) / (h - this.groundY);
                        z._rowColors[i] = z.rgbaPrefix + ((1 - k) * alphaScale).toFixed(3) + ')';
                    }
                    z._rowKey = qKey;
                }
                for (let y = this.groundY, i = 0; y < h; y += yStep, i++) {
                    const k = (y - this.groundY) / (h - this.groundY);
                    const wob = Math.sin(t * 0.004 + y * 0.05 + zi * 1.3) * (2 + k * z.ampMul);
                    c.fillStyle = z._rowColors[i];
                    c.fillRect(z.x + wob, y, z.w, yStep);
                }
            }
            c.restore();
        }

        // =========================================================
        // AWNING DRIPS
        // =========================================================
        updateAndDrawAwningDrips(t, dt, windNow) {
            const c = this.ctx;
            const L = this._layout;
            this.nextDripMs -= dt;
            if (this.nextDripMs <= 0 && this.awningDrips.length < 8) {
                const slotK = this.dripSlots[(Math.random() * this.dripSlots.length) | 0];
                this.awningDrips.push({
                    x: this.storeLeft + L.sw * slotK,
                    y: this.storeY - 6 + 22,
                    vy: 60,
                    age: 0,
                });
                this.nextDripMs = 600 + Math.random() * 1500;
            }
            const dts = dt / 1000;
            for (let i = this.awningDrips.length - 1; i >= 0; i--) {
                const d = this.awningDrips[i];
                d.vy += 600 * dts;
                d.y += d.vy * dts;
                d.x += windNow * 0.05 * dts;
                d.age += dt;
                if (d.y > this.groundY + 4) {
                    // splash → ripple
                    this.ripples.push({
                        x: d.x,
                        y: this.groundY + 4 + Math.random() * 4,
                        age: 0,
                        life: 700,
                    });
                    this.awningDrips.splice(i, 1);
                    continue;
                }
                // Render — taller, warm-tinted streak
                c.strokeStyle = `rgba(240, 220, 170, ${0.45})`;
                c.lineWidth = 1.2;
                c.beginPath();
                c.moveTo(d.x, d.y - 6);
                c.lineTo(d.x, d.y);
                c.stroke();
            }
        }

        // =========================================================
        // RAIN
        // =========================================================
        drawFarRain(t, dt, windNow) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            c.strokeStyle = 'rgba(170, 200, 230, 0.45)';
            c.lineWidth = 0.7;
            const fall = dt / 1000;
            const drift = 0.14 + windNow * 0.01;
            for (let i = 0; i < this.rainFar.length; i++) {
                const r = this.rainFar[i];
                r.x += r.speed * drift / w * fall;
                r.y += r.speed / h * fall;
                if (r.y > 1.05 || r.x > 1.1) {
                    Object.assign(r, this.makeRainFar(true));
                }
                const x = r.x * w, y = r.y * h;
                const dx = r.len * drift, dy = r.len;
                c.globalAlpha = r.alpha;
                c.beginPath();
                c.moveTo(x, y);
                c.lineTo(x - dx, y - dy);
                c.stroke();
            }
            c.globalAlpha = 1;
        }

        drawNearRain(t, dt, windNow) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            c.strokeStyle = 'rgba(190, 215, 240, 0.65)';
            const fall = dt / 1000;
            const drift = 0.20 + windNow * 0.015;
            for (let i = 0; i < this.rainNear.length; i++) {
                const r = this.rainNear[i];
                r.x += r.speed * drift / w * fall;
                r.y += r.speed / h * fall;
                if (r.y > 1.05 || r.x > 1.1) {
                    Object.assign(r, this.makeRainNear(true));
                }
                const x = r.x * w, y = r.y * h;
                const dx = r.len * drift, dy = r.len;
                c.lineWidth = r.width;
                c.globalAlpha = r.alpha;
                c.beginPath();
                c.moveTo(x, y);
                c.lineTo(x - dx, y - dy);
                c.stroke();
            }
            c.globalAlpha = 1;
        }

        updateAndDrawRipples(dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            this.nextRippleMs -= dt;
            if (this.nextRippleMs <= 0) {
                this.ripples.push({
                    x: Math.random() * w,
                    y: this.groundY + 4 + Math.random() * (h - this.groundY - 8),
                    age: 0,
                    life: 600,
                });
                this.nextRippleMs = 70 + Math.random() * 130;
            }
            for (let i = this.ripples.length - 1; i >= 0; i--) {
                const rp = this.ripples[i];
                rp.age += dt;
                if (rp.age >= rp.life) { this.ripples.splice(i, 1); continue; }
                const k = rp.age / rp.life;
                const radius = 1 + k * 14;
                c.strokeStyle = `rgba(200, 220, 255, ${(1 - k) * 0.38})`;
                c.lineWidth = 1;
                c.beginPath();
                c.ellipse(rp.x, rp.y, radius, radius * 0.40, 0, 0, Math.PI * 2);
                c.stroke();
            }
        }

        // =========================================================
        // AGENTS
        // =========================================================
        updateAndDrawBgHeadlight(t, dt) {
            const c = this.ctx;
            const w = this.width;
            this.nextBgHeadlightMs -= dt;
            if (!this.bgHeadlight && this.nextBgHeadlightMs <= 0) {
                const dir = Math.random() < 0.5 ? 1 : -1;
                const h = this.height;
                const sidewalkBot = this.groundY + (h - this.groundY) * 0.22;
                let ly;
                if (dir > 0) {
                    ly = sidewalkBot + (h - 14 - sidewalkBot) * 0.55;
                } else {
                    ly = (h - 14) + (h - (h - 14)) * 0.40;
                }
                this.bgHeadlight = {
                    x: dir > 0 ? -120 : w + 120,
                    y: ly,
                    dir,
                    speed: 240 + Math.random() * 220,
                };
                this.nextBgHeadlightMs = 14000 + Math.random() * 24000;
            }
            if (this.bgHeadlight) {
                this.bgHeadlight.x += this.bgHeadlight.dir * this.bgHeadlight.speed * (dt / 1000);
                const bh = this.bgHeadlight;
                const hScale = bh.dir > 0 ? 0.85 : 1.20;
                c.save();
                c.globalCompositeOperation = 'lighter';
                const rad = 90 * hScale;
                const grad = c.createRadialGradient(bh.x, bh.y, 2 * hScale, bh.x, bh.y, rad);
                grad.addColorStop(0, 'rgba(255, 230, 170, 0.42)');
                grad.addColorStop(0.5, 'rgba(255, 200, 130, 0.18)');
                grad.addColorStop(1, 'rgba(255, 200, 130, 0)');
                c.fillStyle = grad;
                c.fillRect(bh.x - rad, bh.y - rad * 0.33, rad * 2, rad * 0.66);
                c.restore();
                // Tail-light streak behind
                c.save();
                c.globalCompositeOperation = 'lighter';
                const tx = bh.x - bh.dir * 30 * hScale;
                const trad = 36 * hScale;
                const tgrad = c.createRadialGradient(tx, bh.y + 4 * hScale, 1 * hScale, tx, bh.y + 4 * hScale, trad);
                tgrad.addColorStop(0, 'rgba(255, 80, 60, 0.42)');
                tgrad.addColorStop(1, 'rgba(255, 60, 40, 0)');
                c.fillStyle = tgrad;
                c.fillRect(tx - trad, bh.y - trad * 0.4, trad * 2, trad * 0.8);
                c.restore();

                if (bh.x < -140 || bh.x > w + 140) this.bgHeadlight = null;
            }
        }

        updateAndDrawPasserby(t, dt, windNow) {
            const c = this.ctx;
            const w = this.width;
            this.nextClusterMs -= dt;
            this.nextSpawnInClusterMs -= dt;

            // Start a new cluster?
            if (this.clusterRemaining === 0 && this.nextClusterMs <= 0) {
                this.clusterRemaining = 1 + ((Math.random() * 3) | 0); // 1..3
                this.nextSpawnInClusterMs = 0;
            }

            // Spawn next in cluster
            if (this.clusterRemaining > 0 && this.nextSpawnInClusterMs <= 0 && this.passersby.length < 4) {
                const dir = Math.random() < 0.5 ? 1 : -1;
                const umbrellaColors = ['#7a0f1a', '#1f3a6a', '#3a3a3a', '#1a5a3a', '#5a3a1a', '#2a1a3a'];
                const coatColors = ['#06080d', '#0c0e1a', '#1a1418', '#0e1820'];
                const variant = pickVariant();
                this.passersby.push({
                    x: dir > 0 ? -30 - Math.random() * 30 : w + 30 + Math.random() * 30,
                    dir,
                    speed: 32 + Math.random() * 32,
                    bob: Math.random() * 6,
                    umbrellaCol: umbrellaColors[(Math.random() * umbrellaColors.length) | 0],
                    coatCol: coatColors[(Math.random() * coatColors.length) | 0],
                    variant,
                    bagPosey: (Math.random() - 0.5) * 2,
                    yOffset: -2 + Math.random() * 4,
                    umbrellaTilt: (Math.random() - 0.5) * 0.35,
                    posture: Math.random() < 0.4 ? 'hunched' : 'upright',
                });
                this.clusterRemaining -= 1;
                this.nextSpawnInClusterMs = 400 + Math.random() * 2400;
                if (this.clusterRemaining === 0) {
                    this.nextClusterMs = 28000 + Math.random() * 32000;
                }
            }

            // Update + render
            for (let i = this.passersby.length - 1; i >= 0; i--) {
                const p = this.passersby[i];
                // Walk speed scales with sprite size so the gait reads right.
                p.x += p.dir * p.speed * this.s * (dt / 1000);
                p.bob += dt * 0.012;
                this.drawPasserby(p.x, this.groundY - 2 + p.yOffset, p.dir, p.bob, p, windNow);
                if (p.x < -60 * this.s || p.x > w + 60 * this.s) this.passersby.splice(i, 1);
            }
        }

        drawPasserby(x, baseY, dir, bob, p, windNow) {
            const c = this.ctx;
            const sway = Math.sin(bob) * 2 + windNow * 0.10;
            const stepL = Math.sin(bob * 1.6) * 1.8;
            // Larger so the figure reads as a person, not an umbrella icon.
            const figScale = 1.85 * this.s;
            c.save();
            c.translate(x, baseY);
            c.scale(dir * figScale, figScale);

            // Legs — slightly broader pants
            c.fillStyle = p.coatCol;
            c.fillRect(-3, -20 + Math.max(0, stepL), 2.6, 20 - Math.max(0, stepL));
            c.fillRect(0.4, -20 + Math.max(0, -stepL), 2.6, 20 - Math.max(0, -stepL));
            // Shoes
            c.fillStyle = '#000';
            c.fillRect(-3.6, -1, 3.8, 1.6);
            c.fillRect(0.2, -1, 3.8, 1.6);
            // Coat / torso — wider silhouette so the figure has presence
            c.fillStyle = p.coatCol;
            if (p.variant === 'hoodie') {
                // hoodie with hood up
                c.fillRect(-5.4, -36, 10.8, 19);
                // hood — fuller arc
                c.beginPath();
                c.arc(0, -38, 5.6, 0, Math.PI * 2);
                c.fill();
            } else {
                // coat with visible shoulders
                c.fillRect(-5.4, -36, 10.8, 19);
                // Slight shoulder slope (rectangle plus angled corners)
                c.beginPath();
                c.moveTo(-5.4, -36);
                c.quadraticCurveTo(0, -38.5, 5.4, -36);
                c.lineTo(5.4, -34);
                c.lineTo(-5.4, -34);
                c.closePath();
                c.fill();
                // Coat seam (subtle vertical center line)
                c.fillStyle = this.mixColor(p.coatCol, '#fff', 0.10);
                c.fillRect(-0.3, -36, 0.6, 19);
                c.fillStyle = p.coatCol;
            }
            // Sleeves / arms hanging down (visible against the coat)
            c.fillRect(-6.2, -32, 1.6, 12);
            c.fillRect(4.6, -32, 1.6, 12);
            // Bag / briefcase — anchored just outside the sleeve so it reads
            // as held in the hand, not embedded in the coat
            if (p.variant === 'umbrella-bag') {
                c.fillStyle = 'rgba(232, 232, 218, 0.92)';
                c.fillRect(6.6, -17 + p.bagPosey, 5, 6.5);
                c.strokeStyle = p.coatCol;
                c.lineWidth = 0.5;
                c.beginPath();
                c.moveTo(7, -17 + p.bagPosey);
                c.quadraticCurveTo(9, -20 + p.bagPosey, 11, -17 + p.bagPosey);
                c.stroke();
                c.fillStyle = '#cc3a3a';
                c.fillRect(7, -15 + p.bagPosey, 4.2, 0.8);
            } else if (p.variant === 'briefcase') {
                c.fillStyle = 'rgba(45, 28, 18, 0.95)';
                c.fillRect(6.6, -19 + p.bagPosey, 7, 5.5);
                c.fillStyle = '#2a1a0a';
                c.fillRect(8.4, -20 + p.bagPosey, 3.6, 1.2);
                // gold buckle
                c.fillStyle = '#c8a44a';
                c.fillRect(9.6, -17 + p.bagPosey, 1.4, 0.6);
            }
            // Head
            c.fillStyle = p.variant === 'hoodie' ? p.coatCol : 'rgba(245, 220, 190, 0.95)';
            if (p.variant !== 'hoodie') {
                c.beginPath();
                c.arc(0, -41, 4.0, 0, Math.PI * 2);
                c.fill();
                // Hair (dark fringe across forehead)
                c.fillStyle = 'rgba(20, 16, 12, 0.95)';
                c.beginPath();
                c.arc(0, -42, 4.0, Math.PI, Math.PI * 2);
                c.fill();
                // Face dots
                c.fillStyle = 'rgba(30, 30, 30, 0.85)';
                c.fillRect(-1.8, -41.4, 0.8, 0.8);
                c.fillRect(1, -41.4, 0.8, 0.8);
                c.fillStyle = 'rgba(200, 150, 130, 0.55)';
                c.fillRect(-0.4, -39.4, 0.8, 0.5);
            }

            // Umbrella — anchor at the hand (y=-34) and rotate rigidly
            if (p.variant !== 'hoodie') {
                // Combine tilt (wind) and a dynamic tiny sway (from walk/bob) to rotate the umbrella rigidly
                const walkSway = Math.sin(bob) * 0.05; // tiny rigid angle swing from walking
                const totalTilt = (p.umbrellaTilt || 0) + windNow * 0.015 + walkSway;
                
                c.save();
                c.translate(0, -34); // anchor at hand
                c.rotate(totalTilt);
                
                // Shaft from hand up to canopy top
                c.strokeStyle = '#05070d';
                c.lineWidth = 1.4;
                c.beginPath();
                c.moveTo(0, 0); 
                c.lineTo(0, -32);
                c.stroke();
                
                // Canopy fill
                c.fillStyle = p.umbrellaCol;
                c.beginPath();
                c.moveTo(-22, -26);
                c.quadraticCurveTo(-11, -34, 0, -38);
                c.quadraticCurveTo(11, -34, 22, -26);
                c.lineTo(20, -25);
                c.quadraticCurveTo(11, -31, 0, -35);
                c.quadraticCurveTo(-11, -31, -20, -25);
                c.closePath();
                c.fill();
                
                // Canopy ribs (lighter)
                c.strokeStyle = this.mixColor(p.umbrellaCol, '#fff', 0.25);
                c.lineWidth = 0.55;
                for (let i = -3; i <= 3; i++) {
                    const ex = i * 7;
                    const ey = -26 + (i === 0 ? -9 : -4);
                    c.beginPath();
                    c.moveTo(0, -35);
                    c.lineTo(ex, ey);
                    c.stroke();
                }
                
                // Canopy panel dividers (darker)
                c.strokeStyle = this.mixColor(p.umbrellaCol, '#000', 0.50);
                c.lineWidth = 0.45;
                for (let i = -3; i <= 3; i++) {
                    const ex = i * 7;
                    const ey = -26 + (i === 0 ? -9 : -4);
                    c.beginPath();
                    c.moveTo(0, -35);
                    c.lineTo(ex, ey);
                    c.stroke();
                }
                
                // Tip
                c.fillStyle = '#05070d';
                c.fillRect(-0.8, -41, 1.6, 3.5);
                
                c.restore();
                
                // Hand gripping shaft
                c.fillStyle = 'rgba(245, 220, 190, 0.95)';
                c.fillRect(-1.4, -34, 2.8, 2);
                c.restore();
            }
            c.restore();
        }

        updateAndDrawScooter(t, dt) {
            const c = this.ctx;
            const w = this.width;
            this.nextScooterMs -= dt;
            if (!this.scooter && this.nextScooterMs <= 0) {
                const dir = Math.random() < 0.5 ? 1 : -1;
                this.scooter = {
                    x: dir > 0 ? -80 : w + 80,
                    dir,
                    speed: 130 + Math.random() * 50,
                    bobPhase: 0,
                    boxColor: Math.random() < 0.5 ? '#e83a3a' : '#3a78e8',
                };
                this.nextScooterMs = 80000 + Math.random() * 100000;
            }
            if (this.scooter) {
                const sc = this.scooter;
                // Ride speed scales with sprite size.
                sc.x += sc.dir * sc.speed * this.s * (dt / 1000);
                sc.bobPhase += dt * 0.014;

                // Determine LHD lane y-position and scale based on direction
                const h = this.height;
                const sidewalkBot = this.groundY + (h - this.groundY) * 0.22;
                let sy, sScale;
                if (sc.dir > 0) { // Left-to-Right: Far lane, closer to curb
                    sy = sidewalkBot + (h - 14 - sidewalkBot) * 0.55;
                    sScale = 0.85 * this.s;
                } else { // Right-to-Left: Near lane, closer to viewer
                    sy = (h - 14) + (h - (h - 14)) * 0.40;
                    sScale = 1.15 * this.s;
                }

                this.drawScooter(sc.x, sy, sc.dir, sScale, sc.bobPhase, sc.boxColor, t);
                if (sc.x < -100 * this.s || sc.x > w + 100 * this.s) this.scooter = null;
            }
        }

        drawScooter(x, baseY, dir, scaleVal, bobPhase, boxColor, t) {
            const c = this.ctx;
            const bob = Math.sin(bobPhase) * 0.6;
            c.save();
            c.translate(x, baseY + bob);
            c.scale(dir * scaleVal, scaleVal);

            // Headlight beam first (additive, behind body for forward direction)
            c.save();
            c.globalCompositeOperation = 'lighter';
            const beamLen = 110;
            const beamGrad = c.createRadialGradient(8, -16, 2, 8, -16, 14);
            beamGrad.addColorStop(0, 'rgba(255, 240, 200, 0.85)');
            beamGrad.addColorStop(1, 'rgba(255, 220, 160, 0)');
            c.fillStyle = beamGrad;
            c.fillRect(-8, -32, 36, 32);
            // Cone polygon ahead
            c.fillStyle = 'rgba(255, 230, 170, 0.22)';
            c.beginPath();
            c.moveTo(10, -16);
            c.lineTo(10 + beamLen, -8);
            c.lineTo(10 + beamLen, 4);
            c.closePath();
            c.fill();
            // Wet-pavement smear
            c.fillStyle = 'rgba(255, 220, 150, 0.22)';
            c.beginPath();
            c.ellipse(36, 4, 38, 4, 0, 0, Math.PI * 2);
            c.fill();
            c.restore();

            // Wheels
            c.strokeStyle = '#0a0c14';
            c.lineWidth = 2.4;
            c.beginPath(); c.arc(-12, -7, 7, 0, Math.PI * 2); c.stroke();
            c.beginPath(); c.arc(18, -7, 7, 0, Math.PI * 2); c.stroke();
            c.fillStyle = '#0a0c14';
            c.beginPath(); c.arc(-12, -7, 3, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(18, -7, 3, 0, Math.PI * 2); c.fill();

            // Body / fairing
            c.fillStyle = '#1a1e26';
            c.beginPath();
            c.moveTo(-14, -10);
            c.quadraticCurveTo(-10, -18, 0, -18);
            c.lineTo(14, -18);
            c.quadraticCurveTo(20, -16, 22, -10);
            c.lineTo(22, -8);
            c.lineTo(-14, -8);
            c.closePath();
            c.fill();
            // Step floor
            c.fillStyle = '#0c1018';
            c.fillRect(-8, -10, 14, 2);
            // Handlebars
            c.strokeStyle = '#0a0c14';
            c.lineWidth = 1.4;
            c.beginPath(); c.moveTo(0, -18); c.lineTo(2, -28); c.lineTo(8, -28); c.stroke();

            // Delivery box on the back
            c.fillStyle = boxColor;
            c.fillRect(-22, -28, 16, 18);
            c.fillStyle = this.mixColor(boxColor, '#000', 0.4);
            c.fillRect(-22, -28, 16, 2.4);
            // Logo placeholder
            c.fillStyle = '#fff';
            c.fillRect(-19, -22, 10, 1.4);
            c.fillRect(-19, -19, 6, 1.2);
            c.fillRect(-19, -16, 8, 1.2);

            // Rider
            c.fillStyle = '#101418';
            c.fillRect(-2, -28, 6, 12);
            c.beginPath();
            c.arc(1, -32, 3.4, 0, Math.PI * 2);
            c.fill();
            // Helmet visor
            c.fillStyle = '#5b8ce8';
            c.fillRect(0, -33.4, 3.6, 1.4);

            // Headlight bulb
            c.fillStyle = '#fff2a6';
            c.fillRect(8, -17, 2, 2);
            c.restore();
        }

        // Backwards-compatible: keep drawKonbiniSign and drawVendingMachine names
        // available for any external reference (LiveWallpaper still uses class methods only).
    }

    LiveWallpaper.register({
        id: 'konbini',
        name: 'Japan · Konbini',
        description: 'A glowing convenience store on a rainy night.',
        factory: (canvas) => new KonbiniWallpaper(canvas),
    });
})();
