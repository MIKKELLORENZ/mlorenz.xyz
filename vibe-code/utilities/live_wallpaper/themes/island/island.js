// Deserted Island — Johnny Castaway homage in stylized vector form.
// Day/night cycle, layered sea with lapping foam, palm with pinnate fronds,
// humanoid castaway with varied behaviors, boats with wakes, gulls, crabs,
// jumping fish, drifting bottles, and a crackling campfire.
(function () {
    'use strict';

    const DAY_CYCLE_MS = 120000;
    // Start cycle just past sunrise so the scene opens in early morning light.
    const CYCLE_START = 0.24;

    const SKY_STOPS = [
        { t: 0.00, top: '#06102a', horizon: '#1a2348', sea: '#0a1a36', cloud: '#1c2a4a' },
        { t: 0.10, top: '#0c1432', horizon: '#1e2754', sea: '#0e1e3a', cloud: '#222f54' },
        { t: 0.16, top: '#2c2a52', horizon: '#6c4868', sea: '#2c3866', cloud: '#9a7a88' },
        { t: 0.22, top: '#5c6394', horizon: '#e89878', sea: '#3a5a90', cloud: '#f2c0a0' },
        { t: 0.28, top: '#7ab8f0', horizon: '#ffd9a8', sea: '#3f78b0', cloud: '#ffffff' },
        { t: 0.40, top: '#74c2f4', horizon: '#cfe7ff', sea: '#3782c0', cloud: '#ffffff' },
        { t: 0.50, top: '#5fc1f8', horizon: '#cfe4ff', sea: '#2e7ab8', cloud: '#ffffff' },
        { t: 0.62, top: '#6cbeec', horizon: '#fae0b8', sea: '#367ab8', cloud: '#fff4dc' },
        { t: 0.72, top: '#6a72c0', horizon: '#ffa860', sea: '#3a5688', cloud: '#ffd0a0' },
        { t: 0.80, top: '#3e2f5c', horizon: '#ff6048', sea: '#2a3460', cloud: '#ff9c84' },
        { t: 0.86, top: '#221a48', horizon: '#5a2848', sea: '#1a204c', cloud: '#3a2848' },
        { t: 0.94, top: '#0c1230', horizon: '#1a1c40', sea: '#0e1a3a', cloud: '#1c2244' },
        { t: 1.00, top: '#06102a', horizon: '#1a2348', sea: '#0a1a36', cloud: '#1c2a4a' },
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

    function easeInOut(x) { return x * x * (3 - 2 * x); }

    class IslandWallpaper extends Wallpaper {
        init() {
            // ----- Stars -----
            const r1 = this.rng(8675309);
            this.stars = [];
            for (let i = 0; i < 220; i++) {
                this.stars.push({
                    x: r1(),
                    y: r1() * 0.55,
                    size: 0.4 + Math.pow(r1(), 2.2) * 1.8,
                    phase: r1() * Math.PI * 2,
                    twinkleSpeed: 0.4 + r1() * 1.6,
                    tint: r1(), // 0..1 — bias toward warm vs cool
                });
            }

            // ----- Clouds: predefined cumulus profiles (flat-ish bottom, puffy top) -----
            const r2 = this.rng(7733);
            this.clouds = [];
            for (let i = 0; i < 7; i++) {
                const scale = 32 + r2() * 60;
                const puffCount = 4 + Math.floor(r2() * 3);
                const puffs = [];
                let widthAccum = -scale * 0.6;
                for (let k = 0; k < puffCount; k++) {
                    const sizeJ = 0.65 + r2() * 0.45;
                    const r = scale * sizeJ;
                    puffs.push({
                        dx: widthAccum + r * 0.5,
                        dy: -r * (0.45 + r2() * 0.15),
                        r: r,
                    });
                    widthAccum += r * 0.7;
                }
                this.clouds.push({
                    phase: r2(),
                    speed: 0.0014 + r2() * 0.0030,
                    yK: 0.10 + r2() * 0.36,
                    scale,
                    puffs,
                    width: widthAccum + scale * 0.5,
                });
            }

            // ----- Beach: pebbles, shells, tufts, driftwood, SOS, coconuts -----
            const r3 = this.rng(42);
            this.pebbles = [];
            for (let i = 0; i < 32; i++) {
                this.pebbles.push({
                    x: 0.13 + r3() * 0.74,
                    size: 1.0 + r3() * 2.8,
                    yJ: (r3() - 0.5) * 10,
                    shade: r3(),
                    rot: r3() * Math.PI,
                });
            }
            this.tufts = [];
            for (let i = 0; i < 14; i++) {
                this.tufts.push({
                    x: 0.16 + r3() * 0.66,
                    yJ: (r3() - 0.5) * 4,
                    size: 3.0 + r3() * 4.0,
                    blades: 4 + Math.floor(r3() * 3),
                    bendK: r3(),
                });
            }
            this.shells = [];
            for (let i = 0; i < 8; i++) {
                this.shells.push({
                    x: 0.18 + r3() * 0.62,
                    yJ: (r3() - 0.5) * 6,
                    size: 1.8 + r3() * 2.2,
                    rot: r3() * Math.PI * 2,
                    kind: r3() < 0.45 ? 'fan' : (r3() < 0.7 ? 'spiral' : 'conch'),
                });
            }
            this.driftwoods = [
                { x: 0.16, len: 30, ang: -0.14, thick: 4 },
                { x: 0.82, len: 18, ang: 0.22, thick: 3 },
            ];
            // SOS arranged in stones on the sand
            this.sosStones = [];
            const sosLetters = [
                // S (5x5 grid)
                [[0,0],[1,0],[2,0],[0,1],[0,2],[1,2],[2,2],[2,3],[0,4],[1,4],[2,4]],
                // O
                [[0,0],[1,0],[2,0],[0,1],[2,1],[0,2],[2,2],[0,3],[2,3],[0,4],[1,4],[2,4]],
                // S
                [[0,0],[1,0],[2,0],[0,1],[0,2],[1,2],[2,2],[2,3],[0,4],[1,4],[2,4]],
            ];
            for (let li = 0; li < sosLetters.length; li++) {
                for (const pt of sosLetters[li]) {
                    this.sosStones.push({
                        gx: li * 4 + pt[0],
                        gy: pt[1],
                        sizeJ: 0.85 + r3() * 0.4,
                    });
                }
            }

            // Coconuts: cluster at base of palm (positions relative to crown center)
            this.coconuts = [
                { dx: -5, dy: 7, r: 4.2 },
                { dx: 4, dy: 8, r: 4.0 },
                { dx: -1, dy: 12, r: 4.4 },
                { dx: 6, dy: 4, r: 3.6 },
            ];

            // Footprints left by pacing castaway (decay over time)
            this.footprints = [];
            this.lastFootprintX = null;

            // ----- Animated lists -----
            this.gulls = [];
            this.boats = [];
            this.crabs = [];
            this.fishJumps = [];
            this.shootingStars = [];
            this.bottle = null; // {x, y, vx, settled, age}
            this.smokePuffs = [];

            this.nextBoatMs = 6000;
            this.nextGullMs = 4500;
            this.nextCrabMs = 12000;
            this.nextFishMs = 9000;
            this.nextShootMs = 22000;
            this.nextBottleMs = 65000;
            this.nextSmokeMs = 0;

            // ----- Castaway state -----
            this.castawayState = 'sit';
            this.stateTimer = 0;
            this.stateDuration = 11000;
            this.castawayX = 0;
            this.castawayFacing = 1;
            this.paceDir = 1;
            this.fireFlicker = 0;
            this.rockSkipPhase = 0; // for skip-rock animation
            this.thrownRock = null; // {x,y,vx,vy,bounce}

            // Castaway always walks to destinations; never teleports.
            this.castawayYOffset = 0;    // for climb/wade vertical adjustments
            this.walkTarget = null;
            this.walkNextState = null;
            this.walkNextFacing = null;
            this.walkSpeed = 18;          // px/s when ambling
            this.runSpeed = 56;           // px/s when fleeing

            // Fire smoulders into being and dies down slowly — never popped on/off.
            this.fireLevel = 0;           // 0 = out, 1 = blazing
            this.fireBurnRate = 1 / 75000;  // drains over ~75s when untended

            // Climb / swim / shark
            this.climbPhase = 0;          // 0=base, 1=top
            this.climbDir = 1;
            this.swimSubstate = null;     // 'wade-in' | 'swim' | 'panic' | 'rush' | 'wade-out'
            this.swimSubTimer = 0;
            this.swimStrokePhase = 0;
            this.sharkFin = null;         // {x, y, vx, life, hasPassed}

            // Wind base offset for palm sway (varies slowly so it feels alive)
            this.windPhase = Math.random() * Math.PI * 2;
        }

        resize(w, h) {
            super.resize(w, h);
            this.horizonY = h * 0.60;
            this.islandY = h * 0.74;
            this.palmBaseX = w * 0.72;
            this.palmBaseY = this.islandY - 2;
            this.castawayBaseX = w * 0.36;
            this.castawayBaseY = this.islandY - 2;
            this.castawayX = this.castawayBaseX;
            this.campfireX = w * 0.48;
            this.campfireY = this.islandY - 2;
            this.castUnit = Math.max(3.0, Math.min(5.0, h / 200));
        }

        // ===================== Sky / atmosphere =====================
        currentSky(t) {
            const cycle = (t / DAY_CYCLE_MS + CYCLE_START) % 1;
            const { a, b, k } = pickStop(SKY_STOPS, cycle);
            const ke = easeInOut(k);
            return {
                cycle,
                top: this.mixColor(a.top, b.top, ke),
                horizon: this.mixColor(a.horizon, b.horizon, ke),
                sea: this.mixColor(a.sea, b.sea, ke),
                cloud: this.mixColor(a.cloud, b.cloud, ke),
            };
        }

        nightness(cycle) {
            if (cycle < 0.10) return 1;
            if (cycle < 0.26) return 1 - (cycle - 0.10) / 0.16;
            if (cycle < 0.74) return 0;
            if (cycle < 0.92) return (cycle - 0.74) / 0.18;
            return 1;
        }

        // ===================== Render =====================
        render(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const sky = this.currentSky(t);
            const night = this.nightness(sky.cycle);

            // ---- Sky gradient (down to a bit past horizon for atmospheric haze) ----
            const skyGrad = c.createLinearGradient(0, 0, 0, this.horizonY);
            skyGrad.addColorStop(0, sky.top);
            skyGrad.addColorStop(0.75, this.mixColor(sky.top, sky.horizon, 0.55));
            skyGrad.addColorStop(1, sky.horizon);
            c.fillStyle = skyGrad;
            c.fillRect(0, 0, w, this.horizonY);

            // ---- Stars + shooting stars ----
            if (night > 0.05) {
                this.drawStars(t, night);
                this.updateShootingStars(t, dt, night);
            }

            // ---- Sun / Moon positions (need them before clouds for occlusion) ----
            const sunVisible = sky.cycle > 0.18 && sky.cycle < 0.85;
            let sunX = -1000, sunY = -1000, warmth = 0;
            const sunRadius = 26;
            if (sunVisible) {
                const k = (sky.cycle - 0.18) / (0.85 - 0.18);
                sunX = w * k;
                sunY = this.horizonY - Math.sin(k * Math.PI) * (this.horizonY * 0.82);
                warmth = Math.pow(1 - Math.sin(k * Math.PI), 1.8);
            }
            const moonCycle = (sky.cycle + 0.5) % 1;
            let moonX = -1000, moonY = -1000;
            if (!sunVisible) {
                const k = this.clamp((moonCycle - 0.18) / (0.85 - 0.18), 0, 1);
                moonX = w * k;
                moonY = this.horizonY - Math.sin(k * Math.PI) * (this.horizonY * 0.72);
            }

            // ---- Clouds (avoid solar disc) ----
            this.drawClouds(t, sky, night, sunVisible ? { x: sunX, y: sunY } : null);

            // ---- Sun / Moon ----
            if (sunVisible) {
                this.drawSun(sunX, sunY, sunRadius, warmth);
                this.lightX = sunX; this.lightY = sunY; this.lightIsSun = true;
            } else {
                this.drawMoon(moonX, moonY, sky.cycle);
                this.lightX = moonX; this.lightY = moonY; this.lightIsSun = false;
            }

            // ---- Distant boats (behind sea) ----
            this.updateBoats(t, dt, sky, night);

            // ---- Sea ----
            this.drawSea(t, sky, night);

            // ---- Fish jumps (in sea — drawn over sea but behind island) ----
            this.updateFishJumps(t, dt, night);

            // ---- Shark fin (when swim-panic substate spawns one) ----
            if (this.sharkFin) this.updateSharkFin(t, dt, night);

            // ---- Island silhouette + sand ----
            this.drawIsland(t, sky, night);

            // ---- Beach decor (behind subjects but on top of sand) ----
            this.drawBeachDecor(t, night);

            // ---- Bottle washed up ----
            this.updateBottle(t, dt, night);

            // ---- Crabs ----
            this.updateCrabs(t, dt, night);

            // ---- Footprints (drawn before castaway so they sit underneath) ----
            this.drawFootprints(dt, night);

            // ---- Campfire ----
            // Fire is lit by the 'buildfire' action and burns down on its own.
            // Drawn at any level > 0 (just stones+ash when very low).
            if (this.castawayState !== 'buildfire') {
                this.fireLevel = Math.max(0, this.fireLevel - dt * this.fireBurnRate);
            }
            this.fireFlicker += dt;
            this.drawCampfire(this.campfireX, this.campfireY, this.fireFlicker, night, this.fireLevel);
            if (this.fireLevel > 0.15) this.updateSmoke(t, dt, night, this.fireLevel);

            // ---- Palm tree ----
            this.drawPalm(t, night);

            // ---- Castaway ----
            this.updateCastaway(dt);
            this.drawCastawayShadow(t, night);
            this.drawCastaway(t, night);

            // ---- Thrown rock (skip-rock pose) ----
            this.updateThrownRock(dt, night);

            // ---- Gulls (foreground sky) ----
            this.updateGulls(t, dt, night);

            // ---- Subtle night veil (cools the whole scene) ----
            if (night > 0.1) {
                c.fillStyle = `rgba(8, 14, 32, ${night * 0.20})`;
                c.fillRect(0, 0, w, h);
            }
        }

        // ===================== Stars =====================
        drawStars(t, night) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            for (let i = 0; i < this.stars.length; i++) {
                const s = this.stars[i];
                const twinkle = 0.5 + 0.5 * Math.sin(t * 0.001 * s.twinkleSpeed + s.phase);
                const a = night * (0.35 + 0.65 * twinkle);
                const r = s.tint < 0.6 ? 255 : 200;
                const g = s.tint < 0.6 ? 250 : 220;
                const b = s.tint < 0.6 ? 220 : 255;
                c.fillStyle = `rgba(${r},${g},${b},${a})`;
                c.beginPath();
                c.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
                c.fill();
                // bright cross sparkle for biggest stars
                if (s.size > 1.7 && twinkle > 0.7) {
                    c.fillStyle = `rgba(${r},${g},${b},${a * 0.6})`;
                    c.fillRect(s.x * w - s.size * 1.6, s.y * h - 0.3, s.size * 3.2, 0.6);
                    c.fillRect(s.x * w - 0.3, s.y * h - s.size * 1.6, 0.6, s.size * 3.2);
                }
            }
        }

        updateShootingStars(t, dt, night) {
            this.nextShootMs -= dt;
            if (this.nextShootMs <= 0 && this.shootingStars.length < 2 && night > 0.4) {
                const startX = Math.random() * this.width * 0.6;
                const startY = Math.random() * this.horizonY * 0.4;
                this.shootingStars.push({
                    x: startX, y: startY,
                    vx: 220 + Math.random() * 200,
                    vy: 80 + Math.random() * 80,
                    life: 1.0,
                });
                this.nextShootMs = 18000 + Math.random() * 30000;
            }
            const c = this.ctx;
            this.shootingStars = this.shootingStars.filter(s => {
                s.x += s.vx * (dt / 1000);
                s.y += s.vy * (dt / 1000);
                s.life -= dt / 700;
                if (s.life <= 0) return false;
                const a = night * s.life * 0.9;
                c.strokeStyle = `rgba(255, 245, 220, ${a})`;
                c.lineWidth = 1.2;
                c.lineCap = 'round';
                c.beginPath();
                c.moveTo(s.x, s.y);
                c.lineTo(s.x - s.vx * 0.08, s.y - s.vy * 0.08);
                c.stroke();
                // head dot
                c.fillStyle = `rgba(255, 255, 240, ${a})`;
                c.beginPath();
                c.arc(s.x, s.y, 1.4, 0, Math.PI * 2);
                c.fill();
                return true;
            });
        }

        // ===================== Sun & Moon =====================
        colorWithAlpha(rgbStr, a) {
            const m = rgbStr.match(/rgb\((\d+),(\d+),(\d+)\)/);
            if (!m) return rgbStr;
            return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
        }

        drawSun(sunX, sunY, sunRadius, warmth) {
            const c = this.ctx;
            const sunCol = this.mixColor('#fff4c8', '#ff7e3e', warmth);
            // Soft outer warm bloom
            c.save();
            c.globalCompositeOperation = 'lighter';
            const halo = c.createRadialGradient(sunX, sunY, 12, sunX, sunY, 260);
            halo.addColorStop(0, this.colorWithAlpha(sunCol, 0.55));
            halo.addColorStop(0.18, this.colorWithAlpha(sunCol, 0.32));
            halo.addColorStop(0.45, this.colorWithAlpha(sunCol, 0.15));
            halo.addColorStop(0.80, this.colorWithAlpha(sunCol, 0.04));
            halo.addColorStop(1, this.colorWithAlpha(sunCol, 0));
            c.fillStyle = halo;
            c.fillRect(sunX - 260, sunY - 260, 520, 520);
            c.restore();

            // Disc
            c.fillStyle = sunCol;
            c.beginPath();
            c.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
            c.fill();
            // Hot core
            const coreGrad = c.createRadialGradient(
                sunX - sunRadius * 0.22, sunY - sunRadius * 0.22, 2,
                sunX, sunY, sunRadius
            );
            coreGrad.addColorStop(0, this.colorWithAlpha(this.mixColor(sunCol, '#ffffff', 0.65), 0.85));
            coreGrad.addColorStop(0.7, this.colorWithAlpha(sunCol, 0));
            c.fillStyle = coreGrad;
            c.beginPath();
            c.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
            c.fill();
        }

        drawMoon(moonX, moonY, cycle) {
            const c = this.ctx;
            // Soft halo
            c.save();
            c.globalCompositeOperation = 'lighter';
            const halo = c.createRadialGradient(moonX, moonY, 4, moonX, moonY, 130);
            halo.addColorStop(0, 'rgba(220, 235, 255, 0.55)');
            halo.addColorStop(0.45, 'rgba(220, 235, 255, 0.18)');
            halo.addColorStop(1, 'rgba(220, 235, 255, 0)');
            c.fillStyle = halo;
            c.beginPath();
            c.arc(moonX, moonY, 130, 0, Math.PI * 2);
            c.fill();
            c.restore();

            // Disc with soft shading
            const moonR = 19;
            const moonGrad = c.createRadialGradient(moonX - 5, moonY - 5, 2, moonX, moonY, moonR);
            moonGrad.addColorStop(0, '#fbfdff');
            moonGrad.addColorStop(0.55, '#e9efff');
            moonGrad.addColorStop(1, '#b8c2d8');
            c.fillStyle = moonGrad;
            c.beginPath();
            c.arc(moonX, moonY, moonR, 0, Math.PI * 2);
            c.fill();

            // Maria / craters
            c.fillStyle = 'rgba(150, 170, 200, 0.32)';
            c.beginPath(); c.arc(moonX - 6, moonY + 2, 2.6, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(moonX + 5, moonY - 4, 1.9, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(moonX + 3, moonY + 7, 2.1, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(moonX - 9, moonY - 6, 1.5, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(moonX + 8, moonY + 3, 1.1, 0, Math.PI * 2); c.fill();
        }

        // ===================== Clouds =====================
        drawClouds(t, sky, night, sunPos) {
            const c = this.ctx;
            const w = this.width;
            const cloudAlpha = 0.85 * (1 - night * 0.5);
            const lit = sky.cloud;
            const shade = this.mixColor(lit, '#3a4060', 0.32);

            c.save();
            c.globalAlpha = cloudAlpha;
            for (let i = 0; i < this.clouds.length; i++) {
                const cloud = this.clouds[i];
                const cx = ((t * cloud.speed + cloud.phase * (w + 600)) % (w + 600)) - 300;
                const cy = this.horizonY * cloud.yK;
                if (sunPos) {
                    const dx = cx - sunPos.x, dy = cy - sunPos.y;
                    if (dx * dx + dy * dy < (cloud.scale + 110) * (cloud.scale + 110)) continue;
                }
                this.drawCloud(cx, cy, cloud, lit, shade);
            }
            c.restore();
        }

        drawCloud(x, y, cloud, lit, shade) {
            const c = this.ctx;
            // First pass: lit body
            c.fillStyle = lit;
            c.beginPath();
            for (const p of cloud.puffs) {
                c.moveTo(x + p.dx + p.r, y + p.dy);
                c.arc(x + p.dx, y + p.dy, p.r, 0, Math.PI * 2);
            }
            // Flat bottom — a wide low ellipse fills the gaps between puffs
            const bottomW = cloud.width * 0.42;
            c.moveTo(x + bottomW, y);
            c.ellipse(x, y, bottomW, cloud.scale * 0.18, 0, 0, Math.PI * 2);
            c.fill();

            // Second pass: subtle shadow on the underside of each puff
            c.save();
            c.globalCompositeOperation = 'multiply';
            c.fillStyle = this.colorWithAlpha(shade, 0.35);
            c.beginPath();
            for (const p of cloud.puffs) {
                c.moveTo(x + p.dx + p.r * 0.95, y + p.dy + p.r * 0.18);
                c.ellipse(x + p.dx, y + p.dy + p.r * 0.18, p.r * 0.95, p.r * 0.35, 0, 0, Math.PI * 2);
            }
            c.fill();
            c.restore();
        }

        // ===================== Sea =====================
        drawSea(t, sky, night) {
            const c = this.ctx;
            const w = this.width, h = this.height;

            // Base sea gradient (darker with depth)
            const seaGrad = c.createLinearGradient(0, this.horizonY, 0, h);
            seaGrad.addColorStop(0, sky.sea);
            seaGrad.addColorStop(0.55, this.mixColor(sky.sea, '#000022', 0.30));
            seaGrad.addColorStop(1, this.mixColor(sky.sea, '#000018', 0.55));
            c.fillStyle = seaGrad;
            c.fillRect(0, this.horizonY, w, h - this.horizonY);

            // Distance band: a thin lighter band right at horizon for atmospheric haze
            const hazeGrad = c.createLinearGradient(0, this.horizonY, 0, this.horizonY + 18);
            hazeGrad.addColorStop(0, this.colorWithAlpha(this.mixColor(sky.horizon, sky.sea, 0.4), 0.55));
            hazeGrad.addColorStop(1, this.colorWithAlpha(sky.sea, 0));
            c.fillStyle = hazeGrad;
            c.fillRect(0, this.horizonY, w, 18);

            // Wave strokes — multiple translucent ripple layers, denser near viewer
            const seaH = h - this.horizonY;
            c.lineCap = 'round';
            for (let layer = 0; layer < 34; layer++) {
                const k = layer / 33;
                const y = this.horizonY + 4 + seaH * (k * k * 1.05);
                const wavelength = 80 + k * 160;
                const speed = 0.0005 + k * 0.0014;
                const amp = 1.2 + k * 4.5;
                const alpha = (0.08 + k * 0.22) * (1 - night * 0.30);
                const tint = k > 0.55 ? '255, 245, 255' : '200, 220, 250';
                c.strokeStyle = `rgba(${tint}, ${alpha})`;
                c.lineWidth = 0.55 + k * 0.7;
                c.beginPath();
                for (let x = 0; x <= w; x += 8) {
                    const yy = y
                        + Math.sin((x / wavelength) + t * speed + layer * 0.31) * amp
                        + Math.sin((x / (wavelength * 0.42)) + t * speed * 1.7) * amp * 0.32
                        + Math.sin((x / (wavelength * 1.7)) + t * speed * 0.5) * amp * 0.18;
                    if (x === 0) c.moveTo(x, yy);
                    else c.lineTo(x, yy);
                }
                c.stroke();
            }

            // Specular highlight tracking light source
            if (this.lightY !== undefined && this.lightY < this.horizonY) {
                const lx = this.lightX;
                c.save();
                c.globalCompositeOperation = 'lighter';
                const col = this.lightIsSun ? '255, 220, 160' : '210, 220, 255';
                const startY = this.horizonY + 2;
                const endY = h;
                for (let y = startY; y < endY; y += 4) {
                    const k = (y - startY) / (endY - startY);
                    const wob = Math.sin(t * 0.003 + k * 8) * (6 + k * 14);
                    const wob2 = Math.sin(t * 0.0042 + k * 13) * (3 + k * 6);
                    const width = (1 - k) * 38 + 16;
                    const a = (1 - k) * 0.20 * (1 - night * 0.35);
                    const grad = c.createRadialGradient(lx + wob + wob2, y, 2, lx + wob + wob2, y, width);
                    grad.addColorStop(0, `rgba(${col}, ${a})`);
                    grad.addColorStop(1, `rgba(${col}, 0)`);
                    c.fillStyle = grad;
                    c.fillRect(lx + wob - width, y - 2, width * 2, 4);
                }
                c.restore();
            }
        }

        // ===================== Island =====================
        drawIsland(t, sky, night) {
            const c = this.ctx;
            const w = this.width;

            // Underwater shoal — a soft lighter tint right where the island enters water
            const shoalCol = this.mixColor(this.mixColor(sky.sea, '#a8d4f0', 0.45), '#000', night * 0.6);
            c.fillStyle = shoalCol;
            c.beginPath();
            c.moveTo(w * 0.06, this.islandY + 22);
            c.quadraticCurveTo(w * 0.50, this.islandY - 8, w * 0.94, this.islandY + 22);
            c.quadraticCurveTo(w * 0.50, this.islandY + 46, w * 0.06, this.islandY + 22);
            c.closePath();
            c.fill();

            // Rock / sand base silhouette
            const baseCol = this.mixColor('#4a3a26', '#100c08', night);
            c.fillStyle = baseCol;
            c.beginPath();
            c.moveTo(w * 0.10, this.islandY + 22);
            c.quadraticCurveTo(w * 0.28, this.islandY - 36, w * 0.50, this.islandY - 18);
            c.quadraticCurveTo(w * 0.70, this.islandY - 32, w * 0.84, this.islandY + 6);
            c.quadraticCurveTo(w * 0.92, this.islandY + 22, w * 0.88, this.islandY + 38);
            c.lineTo(w * 0.10, this.islandY + 38);
            c.closePath();
            c.fill();

            // Sand top layer
            const sandCol = this.mixColor('#e8c084', '#1a120a', night);
            c.fillStyle = sandCol;
            c.beginPath();
            c.moveTo(w * 0.12, this.islandY + 18);
            c.quadraticCurveTo(w * 0.30, this.islandY - 26, w * 0.50, this.islandY - 10);
            c.quadraticCurveTo(w * 0.68, this.islandY - 22, w * 0.83, this.islandY + 2);
            c.quadraticCurveTo(w * 0.88, this.islandY + 10, w * 0.80, this.islandY + 18);
            c.quadraticCurveTo(w * 0.65, this.islandY, w * 0.50, this.islandY + 12);
            c.quadraticCurveTo(w * 0.32, this.islandY - 4, w * 0.18, this.islandY + 20);
            c.closePath();
            c.fill();

            // Sand sheen
            const sheen = this.mixColor(sandCol, '#fff', 0.22);
            c.strokeStyle = sheen;
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(w * 0.22, this.islandY - 4);
            c.quadraticCurveTo(w * 0.32, this.islandY - 14, w * 0.50, this.islandY - 6);
            c.quadraticCurveTo(w * 0.66, this.islandY - 14, w * 0.78, this.islandY - 2);
            c.stroke();

            // ----- Wet-sand band -----
            // The lower edge of the sand stays wet from waves; tide oscillates.
            const tide = Math.sin(t * 0.0008) * 4 + 18;
            const wetTop = this.islandY + 12;
            const wetCol = this.mixColor(sandCol, '#143040', 0.55);
            c.save();
            const wetGrad = c.createLinearGradient(0, wetTop, 0, wetTop + 14);
            wetGrad.addColorStop(0, this.colorWithAlpha(wetCol, 0));
            wetGrad.addColorStop(0.6, this.colorWithAlpha(wetCol, 0.55));
            wetGrad.addColorStop(1, this.colorWithAlpha(wetCol, 0.75));
            c.fillStyle = wetGrad;
            c.beginPath();
            c.moveTo(w * 0.12, this.islandY + 18);
            c.quadraticCurveTo(w * 0.30, this.islandY + 12, w * 0.50, this.islandY + 14);
            c.quadraticCurveTo(w * 0.70, this.islandY + 12, w * 0.88, this.islandY + 22);
            c.lineTo(w * 0.88, this.islandY + 38);
            c.lineTo(w * 0.10, this.islandY + 38);
            c.closePath();
            c.fill();
            c.restore();

            // ----- Foam wash at the shoreline (animated lapping) -----
            this.drawShoreFoam(t, w, tide, night);
        }

        drawShoreFoam(t, w, tide, night) {
            const c = this.ctx;
            // Wave breaks happen at two scales: a fast inner edge and a slow outer reach.
            const innerY = this.islandY + 18 + Math.sin(t * 0.0021) * 1.6;
            const outerY = this.islandY + 24 + Math.sin(t * 0.0011) * 2.4;
            const foamA = (0.62 - night * 0.20);

            // Outer translucent wash
            c.fillStyle = `rgba(245, 252, 255, ${foamA * 0.45})`;
            c.beginPath();
            c.moveTo(w * 0.12, outerY + 2);
            for (let x = w * 0.12; x <= w * 0.88; x += 6) {
                const y = outerY + Math.sin((x * 0.05) + t * 0.004) * 1.6
                                 + Math.sin((x * 0.013) + t * 0.0022) * 1.2;
                c.lineTo(x, y);
            }
            c.lineTo(w * 0.88, outerY + 6);
            c.lineTo(w * 0.88, outerY + 10);
            c.lineTo(w * 0.12, outerY + 10);
            c.closePath();
            c.fill();

            // Inner crisp foam line — dotted/frothy
            c.strokeStyle = `rgba(255, 255, 255, ${foamA * 0.85})`;
            c.lineWidth = 1.1;
            c.beginPath();
            for (let x = w * 0.14; x <= w * 0.86; x += 4) {
                const y = innerY + Math.sin((x * 0.07) + t * 0.005) * 1.2
                                 + Math.sin((x * 0.022) + t * 0.0028) * 0.8;
                if (x === w * 0.14) c.moveTo(x, y);
                else c.lineTo(x, y);
            }
            c.stroke();

            // Tiny foam stipple along that line
            c.fillStyle = `rgba(255, 255, 255, ${foamA * 0.75})`;
            for (let x = w * 0.16; x <= w * 0.86; x += 7) {
                const y = innerY + Math.sin((x * 0.07) + t * 0.005) * 1.2;
                const r = 0.6 + 0.6 * Math.abs(Math.sin((x * 0.5) + t * 0.003));
                c.beginPath();
                c.arc(x, y - 0.5, r, 0, Math.PI * 2);
                c.fill();
            }
        }

        // ===================== Beach decor =====================
        drawBeachDecor(t, night) {
            const c = this.ctx;
            const w = this.width;

            // Driftwood
            for (const dw of this.driftwoods) {
                const dwX = dw.x * w;
                const dwY = this.islandY + 4;
                c.save();
                c.translate(dwX, dwY);
                c.rotate(dw.ang);
                c.fillStyle = this.mixColor('#5a3a22', '#0a0604', night);
                c.fillRect(-dw.len * 0.5, -dw.thick * 0.5, dw.len, dw.thick);
                c.fillStyle = this.mixColor('#3a2210', '#000', night);
                c.fillRect(-dw.len * 0.5, dw.thick * 0.5 - 1, dw.len, 1);
                // ring scars at the ends
                c.strokeStyle = this.mixColor('#3a2210', '#000', night);
                c.lineWidth = 0.8;
                c.beginPath();
                c.arc(-dw.len * 0.5 + 1, 0, dw.thick * 0.4, 0, Math.PI * 2);
                c.arc(dw.len * 0.5 - 1, 0, dw.thick * 0.4, 0, Math.PI * 2);
                c.stroke();
                // wood grain
                c.strokeStyle = this.mixColor('#3a2210', '#000', night * 0.5 + 0.2);
                c.lineWidth = 0.4;
                c.beginPath();
                c.moveTo(-dw.len * 0.45, -0.5);
                c.lineTo(dw.len * 0.45, -0.5);
                c.stroke();
                c.restore();
            }

            // SOS sign in stones (small, on the sand)
            this.drawSOS(night);

            // Pebbles
            const pebCol = this.mixColor('#6b5239', '#0a0604', night);
            const pebDk = this.mixColor('#3a2818', '#040200', night);
            const pebHi = this.mixColor(pebCol, '#fff', 0.18);
            for (let i = 0; i < this.pebbles.length; i++) {
                const p = this.pebbles[i];
                const px = p.x * w;
                const py = this.islandY + 8 + p.yJ;
                c.save();
                c.translate(px, py);
                c.rotate(p.rot);
                c.fillStyle = p.shade > 0.55 ? pebCol : pebDk;
                c.beginPath();
                c.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
                c.fill();
                // top hilight
                c.fillStyle = this.colorWithAlpha(pebHi, 0.5);
                c.beginPath();
                c.ellipse(-p.size * 0.25, -p.size * 0.18, p.size * 0.4, p.size * 0.15, 0, 0, Math.PI * 2);
                c.fill();
                c.restore();
            }

            // Shells
            for (let i = 0; i < this.shells.length; i++) {
                const sh = this.shells[i];
                const sx = sh.x * w;
                const sy = this.islandY + 10 + sh.yJ;
                c.save();
                c.translate(sx, sy);
                c.rotate(sh.rot);
                if (sh.kind === 'fan') {
                    const fanBody = this.mixColor('#f3d8b0', '#1a120a', night);
                    c.fillStyle = fanBody;
                    c.beginPath();
                    c.moveTo(0, 0);
                    c.arc(0, 0, sh.size, -Math.PI * 0.85, -Math.PI * 0.15);
                    c.closePath();
                    c.fill();
                    // ribs
                    c.strokeStyle = this.mixColor('#c9a878', '#100806', night);
                    c.lineWidth = 0.5;
                    for (let k = 0; k <= 5; k++) {
                        const a = -Math.PI * 0.85 + k * (Math.PI * 0.70 / 5);
                        c.beginPath();
                        c.moveTo(0, 0);
                        c.lineTo(Math.cos(a) * sh.size, Math.sin(a) * sh.size);
                        c.stroke();
                    }
                    // hinge
                    c.fillStyle = this.mixColor(fanBody, '#000', 0.35);
                    c.beginPath();
                    c.arc(0, 0, 0.6, 0, Math.PI * 2);
                    c.fill();
                } else if (sh.kind === 'spiral') {
                    c.fillStyle = this.mixColor('#e8c8a8', '#180c08', night);
                    c.beginPath();
                    c.ellipse(0, 0, sh.size, sh.size * 0.68, 0, 0, Math.PI * 2);
                    c.fill();
                    c.strokeStyle = this.mixColor('#a07c54', '#0a0604', night);
                    c.lineWidth = 0.4;
                    for (let r = 0.3; r <= 1; r += 0.22) {
                        c.beginPath();
                        c.ellipse(0, 0, sh.size * r, sh.size * r * 0.68, 0, 0, Math.PI * 2);
                        c.stroke();
                    }
                } else {
                    // Conch: teardrop with whorls
                    const body = this.mixColor('#f0d4a8', '#1a100a', night);
                    c.fillStyle = body;
                    c.beginPath();
                    c.moveTo(-sh.size, 0);
                    c.quadraticCurveTo(0, -sh.size * 0.8, sh.size, -sh.size * 0.3);
                    c.quadraticCurveTo(sh.size * 0.7, sh.size * 0.5, -sh.size, 0);
                    c.closePath();
                    c.fill();
                    // whorl lines
                    c.strokeStyle = this.mixColor('#b08458', '#180c08', night);
                    c.lineWidth = 0.4;
                    for (let r = 0.3; r <= 1; r += 0.25) {
                        c.beginPath();
                        c.moveTo(-sh.size + sh.size * (1 - r), -sh.size * 0.2 * r);
                        c.quadraticCurveTo(sh.size * r * 0.2, -sh.size * 0.5 * r, sh.size * r, -sh.size * 0.2 * r);
                        c.stroke();
                    }
                }
                c.restore();
            }

            // Grass tufts — sweeping curved blades
            const tuftCol = this.mixColor('#46663a', '#08120a', night);
            const tuftHl = this.mixColor('#88b070', '#10180e', night);
            const tuftMid = this.mixColor('#5a8050', '#0a160c', night);
            const wind = Math.sin(t * 0.0014 + this.windPhase) * 0.18;
            c.lineWidth = 1.0;
            for (let i = 0; i < this.tufts.length; i++) {
                const tf = this.tufts[i];
                const tx = tf.x * w;
                const ty = this.islandY + 4 + tf.yJ;
                for (let k = 0; k < tf.blades; k++) {
                    const ang = (k - (tf.blades - 1) / 2) * 0.22 + wind * (0.4 + tf.bendK * 0.7);
                    const tipX = tx + Math.sin(ang) * tf.size;
                    const tipY = ty - Math.cos(ang) * tf.size;
                    const ctrlX = tx + Math.sin(ang * 0.6) * tf.size * 0.4 + ang * 1.2;
                    const ctrlY = ty - tf.size * 0.55;
                    let col = tuftCol;
                    if (k === Math.floor(tf.blades / 2)) col = tuftHl;
                    else if (k === Math.floor(tf.blades / 2) + 1) col = tuftMid;
                    c.strokeStyle = col;
                    c.beginPath();
                    c.moveTo(tx, ty);
                    c.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
                    c.stroke();
                }
                // base dot
                c.fillStyle = this.mixColor(tuftCol, '#000', 0.4);
                c.beginPath();
                c.arc(tx, ty, 1.2, 0, Math.PI * 2);
                c.fill();
            }
        }

        drawSOS(night) {
            const c = this.ctx;
            const w = this.width;
            // Place the SOS on the highest, driest part of the sand between the campfire and the palm.
            // Bigger cells + darker volcanic stones so it reads clearly against the warm sand.
            const baseX = w * 0.555;
            const baseY = this.islandY - 11;   // above the sand crest at this x, well clear of the foam
            const cell = 6;
            const stoneCol = this.mixColor('#221814', '#000', night);
            const stoneEdge = this.mixColor('#0a0604', '#000', night);
            const stoneHi = this.mixColor('#5a4636', '#0a0604', night);
            // Each stone gets a soft cast shadow on the sand for extra legibility
            for (const s of this.sosStones) {
                const sx = baseX + s.gx * cell;
                const sy = baseY + s.gy * cell;
                // shadow
                c.fillStyle = `rgba(20, 12, 6, ${0.32 * (1 - night * 0.5)})`;
                c.beginPath();
                c.ellipse(sx + 0.6, sy + 0.8, 2.4 * s.sizeJ, 0.8 * s.sizeJ, 0, 0, Math.PI * 2);
                c.fill();
                // outer ring
                c.fillStyle = stoneEdge;
                c.beginPath();
                c.ellipse(sx, sy, 2.4 * s.sizeJ, 1.6 * s.sizeJ, 0, 0, Math.PI * 2);
                c.fill();
                // stone body
                c.fillStyle = stoneCol;
                c.beginPath();
                c.ellipse(sx, sy, 2.0 * s.sizeJ, 1.3 * s.sizeJ, 0, 0, Math.PI * 2);
                c.fill();
                // top hilite (catching sun)
                c.fillStyle = this.colorWithAlpha(stoneHi, 0.65);
                c.beginPath();
                c.ellipse(sx - 0.6 * s.sizeJ, sy - 0.5 * s.sizeJ, 0.9 * s.sizeJ, 0.4 * s.sizeJ, 0, 0, Math.PI * 2);
                c.fill();
            }
        }

        // ===================== Footprints =====================
        // Decay-only renderer; new prints are pushed when pacing.
        drawFootprints(dt, night) {
            const c = this.ctx;
            for (let i = this.footprints.length - 1; i >= 0; i--) {
                const fp = this.footprints[i];
                fp.life -= dt / 18000; // ~18s lifetime
                if (fp.life <= 0) {
                    this.footprints.splice(i, 1);
                    continue;
                }
                const a = fp.life * 0.45 * (1 - night * 0.4);
                c.fillStyle = `rgba(40, 26, 14, ${a})`;
                c.save();
                c.translate(fp.x, fp.y);
                c.rotate(fp.rot);
                c.beginPath();
                c.ellipse(0, 0, 2.6, 1.6, 0, 0, Math.PI * 2);
                c.fill();
                c.restore();
            }
        }

        addFootprint(x, y, facing) {
            const offset = (this.footprints.length % 2 === 0) ? 1.4 : -1.4;
            this.footprints.push({
                x: x + offset * 0.5,
                y: y + 2,
                rot: facing > 0 ? 0.05 : -0.05,
                life: 1.0,
            });
            // Cap memory
            if (this.footprints.length > 60) this.footprints.shift();
        }

        // ===================== Boats =====================
        updateBoats(t, dt, sky, night) {
            this.nextBoatMs -= dt;
            if (this.nextBoatMs <= 0 && this.boats.length < 2) {
                const dir = Math.random() < 0.5 ? 1 : -1;
                const r = Math.random();
                const kind = r < 0.6 ? 'sail' : (r < 0.85 ? 'rowboat' : 'fisher');
                this.boats.push({
                    x: dir > 0 ? -120 : this.width + 120,
                    y: this.horizonY + 6 + Math.random() * 18,
                    dir,
                    speed: (kind === 'sail' ? 16 : kind === 'fisher' ? 13 : 9) + Math.random() * 8,
                    kind,
                    bobPhase: Math.random() * Math.PI * 2,
                    wake: [],
                });
                this.nextBoatMs = 28000 + Math.random() * 26000;
            }
            this.boats = this.boats.filter(b => {
                b.x += b.dir * b.speed * (dt / 1000);
                if (b.x < -180 || b.x > this.width + 180) return false;
                const bob = Math.sin(t * 0.002 + b.bobPhase) * 1.2;
                // Drop wake points
                if (Math.random() < 0.5) {
                    b.wake.push({ x: b.x - b.dir * 18, y: b.y + 6, life: 1, dir: b.dir });
                    if (b.wake.length > 18) b.wake.shift();
                }
                // Draw wake first (behind boat)
                this.drawWake(b.wake, dt, night);
                this.drawBoat(b.x, b.y + bob, b.dir, b.kind, night);
                return true;
            });
        }

        drawWake(wake, dt, night) {
            const c = this.ctx;
            for (let i = wake.length - 1; i >= 0; i--) {
                const p = wake[i];
                p.life -= dt / 2200;
                if (p.life <= 0) { wake.splice(i, 1); continue; }
                const a = p.life * 0.35 * (1 - night * 0.3);
                c.strokeStyle = `rgba(240, 248, 255, ${a})`;
                c.lineWidth = 0.6 + (1 - p.life) * 1.4;
                c.beginPath();
                c.moveTo(p.x - 6 * (1 - p.life), p.y);
                c.lineTo(p.x + 6 * (1 - p.life), p.y);
                c.stroke();
            }
        }

        drawBoat(x, y, dir, kind, night) {
            const c = this.ctx;
            const hullCol = this.mixColor('#2a2418', '#0a0804', night);
            const hullLite = this.mixColor(hullCol, '#fff', 0.22);
            const mastCol = this.mixColor('#3a2a18', '#0a0604', night);
            c.save();
            c.translate(x, y);
            c.scale(dir, 1);

            if (kind === 'sail') {
                const sailCol = this.mixColor('#f4ecd2', '#1a1612', night);
                const sailSh = this.mixColor(sailCol, '#000', 0.20);
                // Hull
                c.fillStyle = hullCol;
                c.beginPath();
                c.moveTo(-26, 0);
                c.quadraticCurveTo(0, 4, 26, 0);
                c.quadraticCurveTo(22, 9, 18, 9);
                c.lineTo(-16, 9);
                c.quadraticCurveTo(-22, 9, -26, 0);
                c.closePath();
                c.fill();
                c.fillStyle = hullLite;
                c.fillRect(-22, 1, 40, 1);
                // Mast
                c.strokeStyle = mastCol;
                c.lineWidth = 1.6;
                c.beginPath();
                c.moveTo(2, 0); c.lineTo(2, -34);
                c.stroke();
                // Main sail — curved (filled with a slight billow)
                c.fillStyle = sailCol;
                c.beginPath();
                c.moveTo(2, -34);
                c.quadraticCurveTo(14, -28, 20, -4);
                c.lineTo(2, -2);
                c.closePath();
                c.fill();
                // Shadow side of sail
                c.fillStyle = sailSh;
                c.beginPath();
                c.moveTo(2, -34);
                c.quadraticCurveTo(8, -22, 6, -2);
                c.lineTo(2, -2);
                c.closePath();
                c.fill();
                // Jib
                c.fillStyle = sailCol;
                c.beginPath();
                c.moveTo(2, -28);
                c.quadraticCurveTo(-8, -16, -14, -3);
                c.lineTo(2, -3);
                c.closePath();
                c.fill();
                // Pennant
                c.strokeStyle = this.mixColor('#c8203a', '#1a0408', night);
                c.lineWidth = 1.2;
                c.beginPath();
                c.moveTo(2, -34); c.lineTo(8, -33);
                c.stroke();
            } else if (kind === 'fisher') {
                // Small fishing boat with cabin
                c.fillStyle = hullCol;
                c.beginPath();
                c.moveTo(-22, 0);
                c.quadraticCurveTo(0, 3, 22, 0);
                c.quadraticCurveTo(18, 8, 14, 8);
                c.lineTo(-14, 8);
                c.quadraticCurveTo(-20, 8, -22, 0);
                c.closePath();
                c.fill();
                // Cabin
                c.fillStyle = this.mixColor('#8a7458', '#1a1208', night);
                c.fillRect(-6, -7, 12, 7);
                // Cabin window
                c.fillStyle = this.mixColor('#a8d8e8', '#0a1218', night);
                c.fillRect(-4, -6, 8, 3);
                // Mast and pennant
                c.strokeStyle = mastCol;
                c.lineWidth = 1.2;
                c.beginPath();
                c.moveTo(6, -7); c.lineTo(8, -18);
                c.stroke();
                c.fillStyle = this.mixColor('#c8203a', '#1a0408', night);
                c.fillRect(8, -18, 4, 2);
                // Hull stripe
                c.fillStyle = hullLite;
                c.fillRect(-18, 1, 36, 1);
            } else {
                // Rowboat
                c.fillStyle = hullCol;
                c.beginPath();
                c.moveTo(-20, 0);
                c.quadraticCurveTo(0, 3, 20, 0);
                c.lineTo(14, 7);
                c.lineTo(-14, 7);
                c.closePath();
                c.fill();
                c.fillStyle = hullLite;
                c.fillRect(-18, 0, 36, 1);
                // Bench
                c.fillStyle = mastCol;
                c.fillRect(-6, 1, 12, 1.5);
                // Tiny rower
                c.fillStyle = this.mixColor('#d8a874', '#15100a', night);
                c.beginPath(); c.arc(0, -3, 1.6, 0, Math.PI * 2); c.fill();
                c.fillStyle = this.mixColor('#a8552a', '#180a04', night);
                c.fillRect(-1.4, -2, 2.8, 2.6);
                // Oars
                c.strokeStyle = mastCol;
                c.lineWidth = 1.2;
                c.beginPath();
                c.moveTo(-2, 0); c.lineTo(-15, -8);
                c.moveTo(2, 0); c.lineTo(15, -8);
                c.stroke();
                c.fillStyle = mastCol;
                c.fillRect(-17, -10, 4, 2);
                c.fillRect(13, -10, 4, 2);
            }
            c.restore();
        }

        // ===================== Palm tree =====================
        drawPalm(t, night) {
            const c = this.ctx;
            const x = this.palmBaseX;
            const baseY = this.palmBaseY;
            const wind = Math.sin(t * 0.0009 + this.windPhase) * 0.04
                       + Math.sin(t * 0.0023) * 0.02;
            const lean = -0.04; // trunk leans slightly toward camera-left
            const trunkCol = this.mixColor('#6a4a2a', '#0a0604', night);
            const trunkDk = this.mixColor('#3a2410', '#050302', night);
            const trunkLite = this.mixColor('#a87a44', '#1a0e06', night);
            const leafBase = this.mixColor('#3a7a44', '#08160e', night);
            const leafLite = this.mixColor('#84c878', '#0e2014', night);
            const leafMid = this.mixColor('#56a050', '#0a1a0e', night);
            const leafDk = this.mixColor('#1d4a25', '#040a06', night);

            c.save();
            c.translate(x, baseY);
            c.rotate(lean + wind * 0.5);

            const trunkH = 168;

            // ----- Trunk: tapered with slight S-curve -----
            // Build trunk as two parallel curves
            const trunkBaseW = 9;
            const trunkTopW = 5;
            const curve = 7; // sideways midpoint offset

            c.fillStyle = trunkDk;
            c.beginPath();
            c.moveTo(-trunkBaseW, 0);
            c.bezierCurveTo(-trunkBaseW + 2, -trunkH * 0.3,
                            -trunkTopW + curve * 0.6, -trunkH * 0.7,
                            -trunkTopW + 2, -trunkH);
            c.lineTo(trunkTopW + 2, -trunkH);
            c.bezierCurveTo(trunkTopW + curve * 1.2, -trunkH * 0.7,
                            trunkBaseW + curve * 0.4, -trunkH * 0.3,
                            trunkBaseW, 0);
            c.closePath();
            c.fill();

            // Lit side of trunk (left, where the morning sun shines)
            c.save();
            c.beginPath();
            c.moveTo(-trunkBaseW, 0);
            c.bezierCurveTo(-trunkBaseW + 2, -trunkH * 0.3,
                            -trunkTopW + curve * 0.6, -trunkH * 0.7,
                            -trunkTopW + 2, -trunkH);
            c.lineTo(0, -trunkH);
            c.bezierCurveTo(curve * 0.6, -trunkH * 0.7,
                            curve * 0.2, -trunkH * 0.3,
                            -1, 0);
            c.closePath();
            c.clip();
            c.fillStyle = trunkCol;
            c.fillRect(-trunkBaseW - 4, -trunkH - 4, trunkBaseW * 2 + 8, trunkH + 8);
            c.restore();

            // Bark rings (leaf scars): horizontal slightly curved bands
            c.strokeStyle = trunkDk;
            c.lineWidth = 0.9;
            const ringCount = 16;
            for (let i = 0; i < ringCount; i++) {
                const k = (i + 1) / (ringCount + 1);
                const ty = -k * trunkH;
                // approximate trunk center & width at this height
                const tCenter = -1 * (1 - k) + (k * curve);
                const halfW = (trunkBaseW * (1 - k) + trunkTopW * k) - 0.4;
                c.beginPath();
                c.moveTo(tCenter - halfW, ty + 1);
                c.quadraticCurveTo(tCenter, ty - 2, tCenter + halfW, ty + 1);
                c.stroke();
                // tiny upper hilight on lit side
                c.strokeStyle = trunkLite;
                c.lineWidth = 0.5;
                c.beginPath();
                c.moveTo(tCenter - halfW * 0.8, ty - 0.4);
                c.quadraticCurveTo(tCenter - halfW * 0.2, ty - 1.6, tCenter + halfW * 0.3, ty - 0.2);
                c.stroke();
                c.strokeStyle = trunkDk;
                c.lineWidth = 0.9;
            }

            // ----- Crown position (trunk top) -----
            const topX = curve * 0.2;
            const topY = -trunkH - 1;

            // Crown knob (a small dark cap where fronds emerge)
            c.fillStyle = trunkDk;
            c.beginPath();
            c.ellipse(topX, topY + 1, 6, 3, 0, 0, Math.PI * 2);
            c.fill();

            // ----- Fronds -----
            // Each frond: { angle, len, droop, depth (0=back/dark, 1=front) }
            const fronds = [
                // Back row (drawn first, darker)
                { a: -Math.PI * 0.92, len: 88, droop: 26, depth: 0 },
                { a: -Math.PI * 0.08, len: 88, droop: 26, depth: 0 },
                { a: -Math.PI * 0.72, len: 76, droop: 18, depth: 0 },
                { a: -Math.PI * 0.28, len: 76, droop: 18, depth: 0 },
                { a: -Math.PI * 0.50, len: 60, droop: 4,  depth: 0 },
                // Front row
                { a: -Math.PI * 0.50, len: 70, droop: 8,  depth: 1, wind: 0 },
                { a: -Math.PI * 0.85, len: 98, droop: 40, depth: 1, wind: 1 },
                { a: -Math.PI * 0.15, len: 98, droop: 40, depth: 1, wind: 2 },
                { a: -Math.PI * 0.65, len: 102, droop: 48, depth: 1, wind: 3 },
                { a: -Math.PI * 0.35, len: 102, droop: 48, depth: 1, wind: 4 },
                { a: -Math.PI * 0.40, len: 86, droop: 30, depth: 1, wind: 5 },
                { a: -Math.PI * 0.60, len: 86, droop: 30, depth: 1, wind: 6 },
            ];
            for (const f of fronds) {
                const localWind = f.depth === 1
                    ? Math.sin(t * 0.0017 + (f.wind || 0) * 0.9) * 0.05
                    : 0;
                const angle = f.a + wind + localWind;
                this.drawFrond(topX, topY, angle, f.len, f.droop, f.depth,
                               leafBase, leafLite, leafMid, leafDk);
            }

            // ----- Coconut cluster (drawn just under the crown knob, between fronds) -----
            this.drawCoconuts(topX, topY, night);

            c.restore();
        }

        drawFrond(topX, topY, angle, len, droop, depth, leafBase, leafLite, leafMid, leafDk) {
            const c = this.ctx;
            // Compute rachis curve endpoints/control
            const endX = topX + Math.cos(angle) * len;
            const endY = topY + Math.sin(angle) * len + droop;
            const cx = topX + Math.cos(angle) * len * 0.55;
            const cy = topY + Math.sin(angle) * len * 0.45 + droop * 0.30;

            const baseCol = depth === 0 ? leafDk : leafBase;
            const litCol = depth === 0 ? leafBase : leafLite;
            const midCol = depth === 0 ? leafDk : leafMid;

            // Walk along the rachis and draw leaflets perpendicular to the tangent
            const leafletCount = 22;
            for (let k = 1; k <= leafletCount; k++) {
                const r = k / (leafletCount + 1);
                const omr = 1 - r;
                const px = omr * omr * topX + 2 * omr * r * cx + r * r * endX;
                const py = omr * omr * topY + 2 * omr * r * cy + r * r * endY;
                // tangent
                const tx = 2 * omr * (cx - topX) + 2 * r * (endX - cx);
                const ty = 2 * omr * (cy - topY) + 2 * r * (endY - cy);
                const tlen = Math.hypot(tx, ty) || 1;
                const tnX = tx / tlen, tnY = ty / tlen;
                const nx = -tnY, ny = tnX;

                // Leaflet length follows sin curve: short at base & tip, long mid-way
                const leafLen = 16 * Math.sin(Math.PI * r) * (0.85 + r * 0.15);
                // Down-droop bias
                const droopBias = leafLen * 0.45;

                // Two leaflets per node, one each side
                for (const side of [-1, 1]) {
                    const tipX = px + nx * side * leafLen + tnX * leafLen * 0.18;
                    const tipY = py + ny * side * leafLen + tnY * leafLen * 0.18 + droopBias;
                    this.drawLeaflet(px, py, tipX, tipY, 1.4, side > 0 ? litCol : midCol);
                }
            }

            // Rachis: a darker spine line for definition
            c.strokeStyle = baseCol;
            c.lineWidth = depth === 0 ? 1.2 : 1.6;
            c.lineCap = 'round';
            c.beginPath();
            c.moveTo(topX, topY);
            c.quadraticCurveTo(cx, cy, endX, endY);
            c.stroke();

            // Bright spine highlight on front fronds
            if (depth === 1) {
                c.strokeStyle = leafLite;
                c.lineWidth = 0.7;
                c.beginPath();
                c.moveTo(topX, topY);
                c.quadraticCurveTo(cx, cy - 0.6, endX, endY - 0.6);
                c.stroke();
            }
        }

        drawLeaflet(baseX, baseY, tipX, tipY, halfWidth, color) {
            const c = this.ctx;
            const dx = tipX - baseX, dy = tipY - baseY;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len * halfWidth;
            const ny = dx / len * halfWidth;
            // Filled lance shape: base wide, tip pointed, slight curve
            const midX = (baseX + tipX) * 0.5;
            const midY = (baseY + tipY) * 0.5;
            c.fillStyle = color;
            c.beginPath();
            c.moveTo(baseX - nx, baseY - ny);
            c.quadraticCurveTo(midX - nx * 0.7 + dx * 0.05, midY - ny * 0.7 + dy * 0.05, tipX, tipY);
            c.quadraticCurveTo(midX + nx * 0.7 + dx * 0.05, midY + ny * 0.7 + dy * 0.05, baseX + nx, baseY + ny);
            c.closePath();
            c.fill();
        }

        drawCoconuts(cx, cy, night) {
            const c = this.ctx;
            // Husks
            const husk = this.mixColor('#3a200e', '#070302', night);
            const huskShade = this.mixColor('#1a0e06', '#000', night);
            const huskHi = this.mixColor('#a87544', '#1a0e06', night);
            for (const co of this.coconuts) {
                const x = cx + co.dx, y = cy + co.dy;
                c.fillStyle = husk;
                c.beginPath();
                c.arc(x, y, co.r, 0, Math.PI * 2);
                c.fill();
                // shadow bottom
                c.fillStyle = this.colorWithAlpha(huskShade, 0.55);
                c.beginPath();
                c.arc(x + co.r * 0.18, y + co.r * 0.25, co.r * 0.85, 0, Math.PI * 2);
                c.fill();
                // hilite
                c.fillStyle = this.colorWithAlpha(huskHi, 0.85);
                c.beginPath();
                c.arc(x - co.r * 0.35, y - co.r * 0.35, co.r * 0.32, 0, Math.PI * 2);
                c.fill();
            }
        }

        // ===================== Castaway =====================
        // Where each action wants the castaway standing, and which way to face once there.
        // null target = anywhere is fine (no walk needed). null facing = keep current.
        actionDef(name) {
            const w = this.width;
            switch (name) {
                case 'sit':       return { target: this.castawayBaseX, facing: 1,  dur: [10000, 14000] };
                case 'wave':      return { target: null,                facing: 1,  dur: [6000, 9000] };
                case 'pace':      return { target: null,                facing: null,dur: [9000, 14000] };
                case 'fish':      return { target: w * 0.18,            facing: -1, dur: [14000, 20000] };
                case 'stretch':   return { target: null,                facing: 1,  dur: [6000, 9000] };
                case 'lookout':   return { target: this.castawayBaseX,  facing: 1,  dur: [7000, 11000] };
                case 'dig':       return { target: w * 0.44,            facing: 1,  dur: [10000, 14000] };
                case 'drink':     return { target: this.castawayBaseX,  facing: 1,  dur: [7000, 10000] };
                case 'sleep':     return { target: this.castawayBaseX,  facing: 1,  dur: [16000, 22000] };
                case 'skip':      return { target: w * 0.22,            facing: -1, dur: [9000, 12000] };
                case 'climb':     return { target: this.palmBaseX - this.castUnit * 2.4, facing: 1, dur: [11000, 11000] };
                case 'swim':      return { target: w * 0.16,            facing: -1, dur: [14000, 14000] };
                case 'buildfire': return { target: this.campfireX + this.castUnit * 1.6, facing: -1, dur: [4500, 4500] };
                default:          return { target: null, facing: 1, dur: [8000, 12000] };
            }
        }

        updateCastaway(dt) {
            // ----- Walking to a queued destination -----
            if (this.castawayState === 'walk') {
                const dir = this.walkTarget > this.castawayX ? 1 : -1;
                this.castawayFacing = dir;
                this.castawayX += dir * this.walkSpeed * (dt / 1000);
                // Footprints drop along the trail
                if (this.lastFootprintX == null || Math.abs(this.castawayX - this.lastFootprintX) > 22) {
                    this.addFootprint(this.castawayX, this.castawayBaseY, this.castawayFacing);
                    this.lastFootprintX = this.castawayX;
                }
                if ((dir > 0 && this.castawayX >= this.walkTarget) ||
                    (dir < 0 && this.castawayX <= this.walkTarget)) {
                    this.castawayX = this.walkTarget;
                    this.startAction(this.walkNextState, this.walkNextFacing);
                    this.walkTarget = null;
                    this.walkNextState = null;
                }
                return;
            }

            // ----- Running (used for shark panic / fleeing) -----
            if (this.castawayState === 'run') {
                const dir = this.walkTarget > this.castawayX ? 1 : -1;
                this.castawayFacing = dir;
                this.castawayX += dir * this.runSpeed * (dt / 1000);
                if (this.lastFootprintX == null || Math.abs(this.castawayX - this.lastFootprintX) > 18) {
                    this.addFootprint(this.castawayX, this.castawayBaseY, this.castawayFacing);
                    this.lastFootprintX = this.castawayX;
                }
                if ((dir > 0 && this.castawayX >= this.walkTarget) ||
                    (dir < 0 && this.castawayX <= this.walkTarget)) {
                    this.castawayX = this.walkTarget;
                    this.startAction(this.walkNextState, this.walkNextFacing);
                    this.walkTarget = null;
                    this.walkNextState = null;
                }
                return;
            }

            this.stateTimer += dt;
            if (this.stateTimer >= this.stateDuration) {
                this.stateTimer = 0;
                this.chooseNextCastawayState();
                return;
            }

            // ----- Per-state per-frame logic -----
            if (this.castawayState === 'pace') {
                const speed = 14;
                this.castawayX += (this.paceDir || 1) * speed * (dt / 1000);
                const minX = this.width * 0.26;
                const maxX = this.width * 0.56;
                if (this.castawayX < minX) {
                    this.castawayX = minX; this.paceDir = 1; this.castawayFacing = 1;
                }
                if (this.castawayX > maxX) {
                    this.castawayX = maxX; this.paceDir = -1; this.castawayFacing = -1;
                }
                if (this.lastFootprintX == null || Math.abs(this.castawayX - this.lastFootprintX) > 22) {
                    this.addFootprint(this.castawayX, this.castawayBaseY, this.castawayFacing);
                    this.lastFootprintX = this.castawayX;
                }
            } else if (this.castawayState !== 'walk' && this.castawayState !== 'run') {
                this.lastFootprintX = null;
            }

            if (this.castawayState === 'skip') {
                this.rockSkipPhase += dt / 1000;
                if (this.rockSkipPhase > 1.0 && this.rockSkipPhase < 1.1 && !this.thrownRock) {
                    this.thrownRock = {
                        x: this.castawayX + (this.castawayFacing * 14),
                        y: this.castawayBaseY - this.castUnit * 6,
                        vx: this.castawayFacing * 180,
                        vy: -40,
                        bounce: 0,
                    };
                }
                if (this.rockSkipPhase > 2.4) {
                    this.rockSkipPhase = 0;
                    this.thrownRock = null;
                }
            }

            if (this.castawayState === 'buildfire') {
                // Grow fire from current level to 1 over the action duration
                this.fireLevel = Math.min(1, this.fireLevel + dt / 4000);
            }

            if (this.castawayState === 'climb') {
                this.updateClimb(dt);
            }

            if (this.castawayState === 'swim') {
                this.updateSwim(dt);
            }
        }

        // Routes the next chosen action through a walk (or run) if the castaway
        // isn't already at the destination. Otherwise activates it directly.
        chooseNextCastawayState() {
            const states = ['sit', 'wave', 'pace', 'fish', 'stretch', 'lookout', 'dig', 'drink', 'sleep', 'skip', 'climb', 'swim', 'buildfire'];
            const weights = {
                sit: 2.5, wave: 1.2, pace: 2.0, fish: 1.5, stretch: 1.0, lookout: 1.2,
                dig: 1.0, drink: 0.9, sleep: 0.8, skip: 1.1, climb: 0.9, swim: 0.7,
                buildfire: 0,  // never chosen randomly; only as an explicit precursor
            };
            // Bias toward buildfire when fire is out or low so the camp stays lit naturally.
            if (this.fireLevel < 0.18) weights.buildfire = 2.4;

            let total = 0;
            for (const s of states) if (s !== this.castawayState) total += weights[s];
            let pick = Math.random() * total;
            let chosen = states[0];
            for (const s of states) {
                if (s === this.castawayState) continue;
                pick -= weights[s];
                if (pick <= 0) { chosen = s; break; }
            }

            const def = this.actionDef(chosen);
            // Reset transient pose state
            this.rockSkipPhase = 0;
            this.thrownRock = null;
            this.swimSubstate = null;
            this.swimSubTimer = 0;
            this.climbPhase = 0;
            this.climbDir = 1;
            this.castawayYOffset = 0;

            const targetX = def.target;
            const needWalk = (targetX !== null && Math.abs(this.castawayX - targetX) > 3);

            if (needWalk) {
                this.walkTarget = targetX;
                this.walkNextState = chosen;
                this.walkNextFacing = def.facing;
                this.castawayState = 'walk';
                this.castawayFacing = (targetX > this.castawayX) ? 1 : -1;
                this.stateDuration = 999999; // walk ends when target reached
            } else {
                this.startAction(chosen, def.facing);
            }
        }

        startAction(name, facing) {
            const def = this.actionDef(name);
            this.castawayState = name;
            this.stateTimer = 0;
            const [lo, hi] = def.dur;
            this.stateDuration = lo + Math.random() * (hi - lo);
            if (facing !== null) this.castawayFacing = facing;
            if (name === 'pace') {
                this.paceDir = Math.random() < 0.5 ? -1 : 1;
                this.castawayFacing = this.paceDir;
            }
        }

        // ----- Climb update (up the trunk, brief pause at top, then back down) -----
        updateClimb(dt) {
            // climbPhase 0=at base, 1=at crown. up at 4s, pause 1s, down at 3s.
            if (this.climbDir > 0) {
                this.climbPhase += dt / 4000;
                if (this.climbPhase >= 1) {
                    this.climbPhase = 1;
                    this.climbDir = 0; // pause at top
                    this.climbPauseLeft = 1100;
                }
            } else if (this.climbDir === 0) {
                this.climbPauseLeft -= dt;
                if (this.climbPauseLeft <= 0) this.climbDir = -1;
            } else {
                this.climbPhase -= dt / 3000;
                if (this.climbPhase <= 0) {
                    this.climbPhase = 0;
                    // End action
                    this.stateTimer = this.stateDuration;
                }
            }
            // Vertical offset: trunk is ~168px tall, climb up to ~150px (near crown)
            this.castawayYOffset = -150 * this.climbPhase;
        }

        // ----- Swim update (wade in, swim out, shark appears, panic-flee back) -----
        updateSwim(dt) {
            if (!this.swimSubstate) {
                this.swimSubstate = 'wade-in';
                this.swimSubTimer = 0;
                this.castawayYOffset = 0;
            }
            this.swimSubTimer += dt;
            this.swimStrokePhase += dt / 1000;

            const shoreX = this.width * 0.16;
            const sea = this.horizonY + 32; // y where character "swims" in the water

            switch (this.swimSubstate) {
                case 'wade-in':
                    // step further into the water; sink as they go
                    this.castawayX -= 14 * (dt / 1000);
                    this.castawayYOffset = Math.min(this.castUnit * 3.2, this.castawayYOffset + this.castUnit * 1.4 * dt / 1000);
                    if (this.swimSubTimer > 2400) {
                        this.swimSubstate = 'swim';
                        this.swimSubTimer = 0;
                    }
                    break;
                case 'swim':
                    this.castawayX -= 22 * (dt / 1000);
                    // Stay horizontal in the water (vertical offset just past water surface)
                    this.castawayYOffset = this.castUnit * 3.4;
                    if (this.swimSubTimer > 3200 && !this.sharkFin) {
                        // Spawn shark fin a little further out, approaching from offshore
                        this.sharkFin = {
                            x: this.castawayX - 70,
                            y: this.castawayBaseY + this.castUnit * 3.6,
                            vx: 24,
                            life: 6.0,
                            hasPassed: false,
                        };
                    }
                    if (this.swimSubTimer > 4400) {
                        this.swimSubstate = 'panic';
                        this.swimSubTimer = 0;
                    }
                    break;
                case 'panic':
                    // Vertical, arms thrashing in place
                    this.castawayYOffset = this.castUnit * 2.6;
                    if (this.swimSubTimer > 1500) {
                        this.swimSubstate = 'rush';
                        this.swimSubTimer = 0;
                    }
                    break;
                case 'rush':
                    // Splash back toward shore quickly
                    this.castawayX += 60 * (dt / 1000);
                    this.castawayYOffset = Math.max(0, this.castawayYOffset - this.castUnit * 1.8 * dt / 1000);
                    this.castawayFacing = 1;
                    if (this.castawayX >= shoreX) {
                        this.castawayX = shoreX;
                        this.swimSubstate = 'wade-out';
                        this.swimSubTimer = 0;
                    }
                    break;
                case 'wade-out':
                    // climb up onto shore and end
                    this.castawayX += 12 * (dt / 1000);
                    this.castawayYOffset = Math.max(0, this.castawayYOffset - this.castUnit * 2.2 * dt / 1000);
                    if (this.castawayYOffset <= 0.1) {
                        this.castawayYOffset = 0;
                        // End the swim action
                        this.stateTimer = this.stateDuration;
                    }
                    break;
            }
        }

        drawCastawayShadow(t, night) {
            const c = this.ctx;
            const state = this.castawayState;
            if (state === 'sleep') return;
            // No ground shadow when in the water or up a tree
            if (this.castawayYOffset !== 0) return;
            if (state === 'climb') return;
            if (state === 'swim') return;
            const lightWarm = this.lightIsSun ? 0.6 : 0.3;
            c.fillStyle = `rgba(20, 14, 8, ${0.40 * (1 - night * 0.55) * lightWarm})`;
            c.beginPath();
            c.ellipse(this.castawayX + this.castawayFacing * 0.6, this.castawayBaseY + 1.5,
                      this.castUnit * 2.4, this.castUnit * 0.5, 0, 0, Math.PI * 2);
            c.fill();
        }

        drawCastaway(t, night) {
            const c = this.ctx;
            const u = this.castUnit;
            const x = this.castawayX;
            const y = this.castawayBaseY + this.castawayYOffset;
            const skin = this.mixColor('#e8b78a', '#22150a', night);
            const skinDk = this.mixColor('#a87a52', '#150a04', night);
            const shirt = this.mixColor('#d8d0b6', '#1a1812', night);
            const shirtDk = this.mixColor('#988e72', '#0e0c08', night);
            const pants = this.mixColor('#8a7858', '#1a160e', night);
            const hair = this.mixColor('#3a2a18', '#080404', night);
            const shoe = this.mixColor('#4a3624', '#0a0604', night);

            c.save();
            c.translate(x, y);
            c.scale(this.castawayFacing, 1);

            const state = this.castawayState;
            const breathe = Math.sin(t * 0.003) * 0.18;

            switch (state) {
                case 'walk':
                    this.posePace(u, t, skin, shirt, shirtDk, pants, hair, shoe);
                    break;
                case 'run':
                    this.poseRun(u, t, skin, shirt, shirtDk, pants, hair, shoe);
                    break;
                case 'sit':
                    this.poseSit(u, t, skin, skinDk, shirt, shirtDk, pants, hair, breathe);
                    break;
                case 'wave':
                    this.poseWave(u, t, skin, shirt, shirtDk, pants, hair, shoe, breathe);
                    break;
                case 'pace':
                    this.posePace(u, t, skin, shirt, shirtDk, pants, hair, shoe);
                    break;
                case 'fish':
                    this.poseFish(u, t, skin, shirt, shirtDk, pants, hair, shoe, breathe, night);
                    break;
                case 'stretch':
                    this.poseStretch(u, t, skin, shirt, shirtDk, pants, hair, shoe);
                    break;
                case 'lookout':
                    this.poseLookout(u, t, skin, shirt, shirtDk, pants, hair, shoe, breathe);
                    break;
                case 'dig':
                    this.poseDig(u, t, skin, shirt, shirtDk, pants, hair, shoe, night);
                    break;
                case 'drink':
                    this.poseDrink(u, t, skin, shirt, shirtDk, pants, hair, shoe, night);
                    break;
                case 'sleep':
                    this.poseSleep(u, t, skin, shirt, shirtDk, pants, hair, shoe, night);
                    break;
                case 'skip':
                    this.poseSkipRock(u, t, skin, shirt, shirtDk, pants, hair, shoe);
                    break;
                case 'climb':
                    this.poseClimb(u, t, skin, shirt, shirtDk, pants, hair, shoe, night);
                    break;
                case 'swim':
                    this.poseSwim(u, t, skin, shirt, shirtDk, pants, hair, shoe, night);
                    break;
                case 'buildfire':
                    this.poseBuildFire(u, t, skin, shirt, shirtDk, pants, hair, shoe, night);
                    break;
            }

            c.restore();
        }

        // --- Helpers for body parts ---

        // neckTopY defaults to standing (-9u). Pass a different value to plant the
        // head above a torso whose top sits elsewhere (e.g. seated poses).
        drawHead(u, skin, hair, breathe, eyeForward, neckTopY) {
            if (neckTopY === undefined) neckTopY = -9 * u;
            const c = this.ctx;
            const cy = neckTopY - 1 * u + breathe * 0.5;
            // Neck
            c.fillStyle = skin;
            c.fillRect(-0.35 * u, neckTopY + breathe, 0.7 * u, 0.7 * u);
            // Head
            c.beginPath();
            c.arc(0, cy, 1.15 * u, 0, Math.PI * 2);
            c.fill();
            // Subtle cheek shading
            c.fillStyle = this.mixColor(skin, '#000', 0.15);
            c.beginPath();
            c.arc(0.5 * u, cy + 0.2 * u, 0.5 * u, 0, Math.PI * 2);
            c.fill();
            // Hair: a scruffy cap with some wisps
            c.fillStyle = hair;
            c.beginPath();
            c.arc(0, cy - 0.15 * u, 1.22 * u, Math.PI * 1.05, Math.PI * 1.95, false);
            c.lineTo(1.0 * u, cy);
            c.lineTo(-1.0 * u, cy);
            c.closePath();
            c.fill();
            // Hair scruff tufts
            c.beginPath();
            c.arc(-0.7 * u, cy - 1.15 * u, 0.35 * u, 0, Math.PI * 2);
            c.arc( 0.0 * u, cy - 1.25 * u, 0.45 * u, 0, Math.PI * 2);
            c.arc( 0.6 * u, cy - 1.10 * u, 0.30 * u, 0, Math.PI * 2);
            c.fill();
            // Sideburn scruff
            c.fillRect(-1.18 * u, cy, 0.35 * u, 0.85 * u);
            // Beard scruff
            c.fillStyle = this.mixColor(hair, skin, 0.45);
            c.fillRect(0.0 * u, cy + 0.85 * u, 0.7 * u, 0.32 * u);
            // Eye dot
            if (eyeForward !== false) {
                c.fillStyle = '#000';
                c.fillRect(0.42 * u, cy - 0.05 * u, 0.20 * u, 0.22 * u);
                // Tiny nose shadow
                c.fillStyle = this.mixColor(skin, '#000', 0.30);
                c.fillRect(0.65 * u, cy + 0.18 * u, 0.18 * u, 0.30 * u);
                // Mouth dash
                c.fillStyle = this.mixColor(skin, '#000', 0.50);
                c.fillRect(0.45 * u, cy + 0.62 * u, 0.30 * u, 0.10 * u);
            }
        }

        drawTorso(u, shirt, shirtDk, breathe) {
            const c = this.ctx;
            // Tapered shirt body
            c.fillStyle = shirt;
            c.beginPath();
            c.moveTo(-1.35 * u, -5 * u);
            c.lineTo( 1.35 * u, -5 * u);
            c.lineTo( 1.05 * u, -9 * u + breathe);
            c.lineTo(-1.05 * u, -9 * u + breathe);
            c.closePath();
            c.fill();
            // Shirt seam
            c.strokeStyle = this.mixColor(shirt, '#000', 0.25);
            c.lineWidth = 0.5;
            c.beginPath();
            c.moveTo(0, -5 * u);
            c.lineTo(0, -9 * u + breathe);
            c.stroke();
            // Shadow side
            c.fillStyle = shirtDk;
            c.beginPath();
            c.moveTo( 0.2 * u, -5 * u);
            c.lineTo( 1.35 * u, -5 * u);
            c.lineTo( 1.05 * u, -9 * u + breathe);
            c.lineTo( 0.2 * u, -9 * u + breathe);
            c.closePath();
            c.fill();
            // Collar V
            c.fillStyle = this.mixColor(shirt, '#fff', 0.20);
            c.beginPath();
            c.moveTo(-0.45 * u, -9 * u + breathe);
            c.lineTo( 0.45 * u, -9 * u + breathe);
            c.lineTo( 0.00 * u, -8.4 * u + breathe);
            c.closePath();
            c.fill();
        }

        drawLeg(u, x, footY, pants, shoe, bend) {
            const c = this.ctx;
            // Thigh + shin as a tapered shape, foot at end
            const hipY = -5 * u;
            c.fillStyle = pants;
            c.beginPath();
            c.moveTo(x - 0.35 * u, hipY);
            c.lineTo(x + 0.35 * u, hipY);
            c.lineTo(x + 0.30 * u + bend, footY);
            c.lineTo(x - 0.30 * u + bend, footY);
            c.closePath();
            c.fill();
            // Pant cuff
            c.fillStyle = this.mixColor(pants, '#000', 0.35);
            c.fillRect(x - 0.32 * u + bend, footY - 0.18 * u, 0.64 * u, 0.18 * u);
            // Foot/shoe
            c.fillStyle = shoe;
            c.beginPath();
            c.ellipse(x + bend + 0.15 * u, footY + 0.18 * u, 0.55 * u, 0.22 * u, 0, 0, Math.PI * 2);
            c.fill();
        }

        drawArm(c, u, sx, sy, angle, shirt, shirtDk, skin, raised) {
            const upperLen = 2.0 * u;
            const foreLen = 1.8 * u;
            const upperW = 0.55 * u;
            const elbowX = sx + Math.cos(angle) * upperLen;
            const elbowY = sy + Math.sin(angle) * upperLen;
            const bend = raised ? -0.28 : 0.18;
            const handAng = angle + bend;
            const handX = elbowX + Math.cos(handAng) * foreLen;
            const handY = elbowY + Math.sin(handAng) * foreLen;
            // Upper arm sleeve
            c.strokeStyle = shirt;
            c.lineCap = 'round';
            c.lineWidth = upperW;
            c.beginPath();
            c.moveTo(sx, sy);
            c.lineTo(elbowX, elbowY);
            c.stroke();
            // Sleeve shadow on underside (only when arm is down-ish)
            if (!raised) {
                c.strokeStyle = shirtDk;
                c.lineWidth = upperW * 0.4;
                c.beginPath();
                c.moveTo(sx + 0.1 * u, sy + 0.3 * u);
                c.lineTo(elbowX + 0.1 * u, elbowY + 0.3 * u);
                c.stroke();
            }
            // Forearm
            c.strokeStyle = skin;
            c.lineWidth = upperW * 0.82;
            c.beginPath();
            c.moveTo(elbowX, elbowY);
            c.lineTo(handX, handY);
            c.stroke();
            // Hand
            c.fillStyle = skin;
            c.beginPath();
            c.arc(handX, handY, upperW * 0.55, 0, Math.PI * 2);
            c.fill();
            return { elbowX, elbowY, handX, handY };
        }

        // --- Poses ---

        drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, breathe, stepCycle) {
            const c = this.ctx;
            // Legs with optional walk swing
            const swing = (stepCycle || 0);
            const legL = -0.7 * u, legR = 0.0 * u;
            this.drawLeg(u, legL, 0, pants, shoe, -swing * 0.4 * u);
            this.drawLeg(u, legR, 0, pants, shoe,  swing * 0.4 * u);
            // Belt
            c.fillStyle = this.mixColor(pants, '#000', 0.45);
            c.fillRect(-1.25 * u, -5 * u, 2.5 * u, 0.4 * u);
            // Belt buckle
            c.fillStyle = this.mixColor('#c0a050', '#1a1308', 0);
            c.fillRect(-0.18 * u, -4.92 * u, 0.36 * u, 0.32 * u);
            // Torso
            this.drawTorso(u, shirt, shirtDk, breathe);
            // Head
            this.drawHead(u, skin, hair, breathe, true);
        }

        // Castaway sitting on the sand with knees drawn up, arms wrapped round them.
        // Bum at y=0 (planted on the sand), torso rises above.
        poseSit(u, t, skin, skinDk, shirt, shirtDk, pants, hair, breathe) {
            const c = this.ctx;
            // Soft hip-print shadow
            c.fillStyle = `rgba(20,14,8,0.30)`;
            c.beginPath();
            c.ellipse(0.4 * u, 0, 2.4 * u, 0.5 * u, 0, 0, Math.PI * 2);
            c.fill();

            // Legs: thighs forward to knees (raised), shins down to feet on the sand
            const kneeX = 2.2 * u, kneeY = -2.4 * u;
            const hipX = -0.2 * u, hipY = -0.5 * u;
            const footX = 2.4 * u, footY = 0;
            // Thigh
            c.fillStyle = pants;
            c.beginPath();
            c.moveTo(hipX - 0.5 * u, hipY - 0.4 * u);
            c.lineTo(hipX + 0.5 * u, hipY + 0.4 * u);
            c.lineTo(kneeX + 0.5 * u, kneeY + 0.4 * u);
            c.lineTo(kneeX - 0.5 * u, kneeY - 0.4 * u);
            c.closePath();
            c.fill();
            // Shin
            c.beginPath();
            c.moveTo(kneeX - 0.4 * u, kneeY - 0.2 * u);
            c.lineTo(kneeX + 0.4 * u, kneeY + 0.2 * u);
            c.lineTo(footX + 0.4 * u, footY - 0.1 * u);
            c.lineTo(footX - 0.4 * u, footY - 0.5 * u);
            c.closePath();
            c.fill();
            // Pant cuff
            c.fillStyle = this.mixColor(pants, '#000', 0.35);
            c.beginPath();
            c.moveTo(footX - 0.42 * u, footY - 0.55 * u);
            c.lineTo(footX + 0.42 * u, footY - 0.15 * u);
            c.lineTo(footX + 0.42 * u, footY + 0.05 * u);
            c.lineTo(footX - 0.42 * u, footY - 0.35 * u);
            c.closePath();
            c.fill();
            // Foot/shoe
            c.fillStyle = this.mixColor('#4a3624', '#0a0604', 0);
            c.beginPath();
            c.ellipse(footX + 0.3 * u, footY + 0.1 * u, 0.6 * u, 0.22 * u, 0, 0, Math.PI * 2);
            c.fill();
            // Back leg, similar but tucked slightly (smaller knee height)
            const backKneeX = 1.6 * u, backKneeY = -1.8 * u;
            const backFootX = 1.6 * u, backFootY = 0.0;
            c.fillStyle = this.mixColor(pants, '#000', 0.18);
            c.beginPath();
            c.moveTo(hipX - 0.4 * u, hipY - 0.3 * u);
            c.lineTo(hipX + 0.4 * u, hipY + 0.3 * u);
            c.lineTo(backKneeX + 0.4 * u, backKneeY + 0.3 * u);
            c.lineTo(backKneeX - 0.4 * u, backKneeY - 0.3 * u);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(backKneeX - 0.35 * u, backKneeY - 0.15 * u);
            c.lineTo(backKneeX + 0.35 * u, backKneeY + 0.15 * u);
            c.lineTo(backFootX + 0.35 * u, backFootY - 0.1 * u);
            c.lineTo(backFootX - 0.35 * u, backFootY - 0.4 * u);
            c.closePath();
            c.fill();

            // Torso — upright, bum on ground, top at about y = -4.5u
            const torsoTopY = -4.6 * u + breathe;
            c.fillStyle = shirt;
            c.beginPath();
            c.moveTo(-1.3 * u, -0.6 * u);
            c.lineTo( 1.3 * u, -0.6 * u);
            c.lineTo( 1.0 * u, torsoTopY);
            c.lineTo(-1.0 * u, torsoTopY);
            c.closePath();
            c.fill();
            c.fillStyle = shirtDk;
            c.beginPath();
            c.moveTo( 0.2 * u, -0.6 * u);
            c.lineTo( 1.3 * u, -0.6 * u);
            c.lineTo( 1.0 * u, torsoTopY);
            c.lineTo( 0.2 * u, torsoTopY);
            c.closePath();
            c.fill();
            // Belt at the bottom of torso (where pants begin)
            c.fillStyle = this.mixColor(pants, '#000', 0.45);
            c.fillRect(-1.2 * u, -0.85 * u, 2.4 * u, 0.3 * u);
            // Collar V
            c.fillStyle = this.mixColor(shirt, '#fff', 0.20);
            c.beginPath();
            c.moveTo(-0.45 * u, torsoTopY);
            c.lineTo( 0.45 * u, torsoTopY);
            c.lineTo( 0.00 * u, torsoTopY + 0.6 * u);
            c.closePath();
            c.fill();

            // Arms wrapping forward around the raised knee
            // shoulder at (sx, sy=torsoTopY+0.4u), hand at (~knee)
            const shoulderY = torsoTopY + 0.4 * u;
            this.drawArm(c, u,  0.9 * u, shoulderY, -0.42, shirt, shirtDk, skin, false);
            this.drawArm(c, u, -0.6 * u, shoulderY,  0.25, shirt, shirtDk, skin, false);

            // Head above torso
            this.drawHead(u, skin, hair, breathe, true, torsoTopY);
        }

        poseWave(u, t, skin, shirt, shirtDk, pants, hair, shoe, breathe) {
            const c = this.ctx;
            this.drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, breathe, 0);
            // Back arm at side
            this.drawArm(c, u, -0.9 * u, -8.6 * u, Math.PI / 2 + 0.05, shirt, shirtDk, skin, false);
            // Waving arm
            const waveAng = -Math.PI * 0.85 + Math.sin(t * 0.008) * 0.35;
            this.drawArm(c, u, 0.9 * u, -8.6 * u, waveAng, shirt, shirtDk, skin, true);
        }

        posePace(u, t, skin, shirt, shirtDk, pants, hair, shoe) {
            const c = this.ctx;
            const stepCycle = Math.sin(t * 0.012);
            // Bob the body up and down very subtly with footfall
            const bob = Math.abs(Math.sin(t * 0.012)) * 0.4;
            c.save();
            c.translate(0, -bob);
            this.drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, 0, stepCycle * 0.6);
            // Arms swing opposite to legs
            const swing = stepCycle * 0.45;
            this.drawArm(c, u, -0.9 * u, -8.6 * u, Math.PI / 2 - swing, shirt, shirtDk, skin, false);
            this.drawArm(c, u,  0.9 * u, -8.6 * u, Math.PI / 2 + swing, shirt, shirtDk, skin, false);
            c.restore();
        }

        poseFish(u, t, skin, shirt, shirtDk, pants, hair, shoe, breathe, night) {
            const c = this.ctx;
            this.drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, breathe, 0);
            // Both arms forward holding rod
            this.drawArm(c, u, 0.4 * u, -8.6 * u, -Math.PI * 0.18, shirt, shirtDk, skin, false);
            const handR = this.drawArm(c, u, 0.9 * u, -8.6 * u, -Math.PI * 0.08, shirt, shirtDk, skin, false);
            // Rod
            const rodCol = this.mixColor('#a87040', '#1a0f08', night);
            c.strokeStyle = rodCol;
            c.lineWidth = 0.8;
            const rodX1 = handR.handX, rodY1 = handR.handY;
            const rodX2 = rodX1 + 7 * u, rodY2 = rodY1 - 4 * u;
            c.beginPath();
            c.moveTo(rodX1, rodY1);
            c.quadraticCurveTo(rodX1 + 3 * u, rodY1 - 1 * u, rodX2, rodY2);
            c.stroke();
            // Reel
            c.fillStyle = this.mixColor('#2a2018', '#000', night);
            c.beginPath();
            c.arc(rodX1 + 0.6 * u, rodY1 + 0.2 * u, 0.5 * u, 0, Math.PI * 2);
            c.fill();
            // Cast line out to the sea, sagging slightly
            const wob = Math.sin(t * 0.004) * 0.4 * u;
            const floatX = rodX2 + 28 * u + wob;
            const floatY = (this.horizonY - this.castawayBaseY) + 12;
            c.strokeStyle = this.mixColor('#cccccc', '#222', night);
            c.lineWidth = 0.4;
            c.beginPath();
            c.moveTo(rodX2, rodY2);
            const lineMidX = (rodX2 + floatX) * 0.5;
            const lineMidY = (rodY2 + floatY) * 0.5 + 5 * u;
            c.quadraticCurveTo(lineMidX, lineMidY, floatX, floatY);
            c.stroke();
            // Float (bobber)
            c.fillStyle = this.mixColor('#ff5040', '#1a0a08', night);
            c.beginPath();
            c.arc(floatX, floatY - 0.3 * u, 0.55 * u, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = this.mixColor('#ffffff', '#222', night);
            c.beginPath();
            c.arc(floatX, floatY - 0.3 * u, 0.25 * u, 0, Math.PI * 2);
            c.fill();
            // Ripple under float
            c.strokeStyle = `rgba(220, 235, 255, ${0.5 * (1 - night * 0.4)})`;
            c.lineWidth = 0.5;
            c.beginPath();
            c.ellipse(floatX, floatY + 0.3 * u, 1.6 * u, 0.4 * u, 0, 0, Math.PI * 2);
            c.stroke();
            c.beginPath();
            c.ellipse(floatX, floatY + 0.3 * u, 2.4 * u, 0.55 * u, 0, 0, Math.PI * 2);
            c.strokeStyle = `rgba(220, 235, 255, ${0.25 * (1 - night * 0.4)})`;
            c.stroke();
        }

        poseStretch(u, t, skin, shirt, shirtDk, pants, hair, shoe) {
            const c = this.ctx;
            const lift = Math.sin(t * 0.003) * 0.25;
            this.drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, 0, 0);
            this.drawArm(c, u, -0.9 * u, -8.6 * u, -Math.PI / 2 - 0.2 - lift, shirt, shirtDk, skin, false);
            this.drawArm(c, u,  0.9 * u, -8.6 * u, -Math.PI / 2 + 0.2 + lift, shirt, shirtDk, skin, false);
        }

        poseLookout(u, t, skin, shirt, shirtDk, pants, hair, shoe, breathe) {
            const c = this.ctx;
            this.drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, breathe * 0.5, 0);
            this.drawArm(c, u, -0.9 * u, -8.6 * u, Math.PI / 2 + 0.05, shirt, shirtDk, skin, false);
            this.drawArm(c, u,  0.9 * u, -8.6 * u, -Math.PI * 0.58, shirt, shirtDk, skin, false);
            // Hand at brow shading eyes
            c.fillStyle = skin;
            c.beginPath();
            c.arc(0.4 * u, -10.4 * u, 0.65 * u, 0, Math.PI * 2);
            c.fill();
            // Shadow under brow
            c.fillStyle = 'rgba(0,0,0,0.30)';
            c.fillRect(-0.6 * u, -10.4 * u, 1.6 * u, 0.4 * u);
        }

        poseDig(u, t, skin, shirt, shirtDk, pants, hair, shoe, night) {
            const c = this.ctx;
            const swing = Math.sin(t * 0.006);
            // Lean forward slightly
            c.save();
            c.rotate(0.12);
            this.drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, 0, 0);
            // Both arms downward gripping stick
            const armAng = Math.PI * 0.35 + swing * 0.25;
            const lArm = this.drawArm(c, u, -0.6 * u, -8.6 * u, armAng - 0.1, shirt, shirtDk, skin, false);
            const rArm = this.drawArm(c, u,  0.9 * u, -8.6 * u, armAng + 0.05, shirt, shirtDk, skin, false);
            // Stick / paddle
            const stickCol = this.mixColor('#7a5430', '#1a0c06', night);
            c.strokeStyle = stickCol;
            c.lineWidth = 0.7 * u;
            c.lineCap = 'round';
            c.beginPath();
            const stickEndX = lArm.handX + Math.cos(armAng - 0.15) * 4 * u;
            const stickEndY = lArm.handY + Math.sin(armAng - 0.15) * 4 * u;
            c.moveTo(lArm.handX, lArm.handY);
            c.lineTo(stickEndX, stickEndY);
            c.stroke();
            c.restore();
            // Pile of dug-up sand in front
            c.fillStyle = this.mixColor('#c69c5e', '#180e08', night);
            c.beginPath();
            c.ellipse(2 * u, 0.1 * u, 1.6 * u, 0.5 * u, 0, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = this.mixColor('#e8c084', '#1a120a', night);
            c.beginPath();
            c.ellipse(2 * u, -0.1 * u, 1.2 * u, 0.3 * u, 0, 0, Math.PI * 2);
            c.fill();
        }

        poseDrink(u, t, skin, shirt, shirtDk, pants, hair, shoe, night) {
            const c = this.ctx;
            const tilt = 0.06 + Math.sin(t * 0.002) * 0.04;
            this.drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, 0, 0);
            // Back arm at side
            this.drawArm(c, u, -0.9 * u, -8.6 * u, Math.PI / 2 + 0.1, shirt, shirtDk, skin, false);
            // Front arm raised holding coconut to mouth
            const armAng = -Math.PI * 0.42 - tilt;
            const cup = this.drawArm(c, u, 0.9 * u, -8.6 * u, armAng, shirt, shirtDk, skin, true);
            // Coconut cup
            const coconutCol = this.mixColor('#3a200e', '#070302', night);
            c.fillStyle = coconutCol;
            c.beginPath();
            c.arc(cup.handX, cup.handY, 1.2 * u, 0, Math.PI * 2);
            c.fill();
            // Straw
            c.strokeStyle = this.mixColor('#e8d090', '#1a1208', night);
            c.lineWidth = 0.3 * u;
            c.beginPath();
            c.moveTo(cup.handX - 0.3 * u, cup.handY - 0.6 * u);
            c.lineTo(cup.handX - 0.1 * u, cup.handY - 1.8 * u);
            c.stroke();
        }

        poseSleep(u, t, skin, shirt, shirtDk, pants, hair, shoe, night) {
            const c = this.ctx;
            // Lying on back; body horizontal at ground level
            const breath = Math.sin(t * 0.0024) * 0.3;
            // Shadow ellipse beneath
            c.fillStyle = `rgba(20, 14, 8, ${0.40 * (1 - night * 0.55)})`;
            c.beginPath();
            c.ellipse(0.5 * u, 0, 5 * u, 0.7 * u, 0, 0, Math.PI * 2);
            c.fill();
            // Legs (lying flat, slightly bent at knees)
            c.fillStyle = pants;
            c.fillRect(-1.5 * u, -1.2 * u, 4 * u, 1.0 * u);
            // Knees raised slightly
            c.beginPath();
            c.moveTo(2.5 * u, -1.2 * u);
            c.lineTo(3.6 * u, -1.4 * u);
            c.lineTo(3.8 * u, -0.2 * u);
            c.lineTo(2.5 * u, -0.2 * u);
            c.closePath();
            c.fill();
            // Belt
            c.fillStyle = this.mixColor(pants, '#000', 0.4);
            c.fillRect(-1.5 * u, -1.3 * u, 0.4 * u, 1.1 * u);
            // Torso lying down
            c.fillStyle = shirt;
            c.beginPath();
            c.moveTo(-3.5 * u, -1.0 * u);
            c.lineTo(-1.4 * u, -1.4 * u - breath);
            c.lineTo(-1.4 * u, -0.2 * u);
            c.lineTo(-3.5 * u, -0.3 * u);
            c.closePath();
            c.fill();
            c.fillStyle = shirtDk;
            c.beginPath();
            c.moveTo(-3.5 * u, -1.0 * u);
            c.lineTo(-1.4 * u, -1.4 * u - breath);
            c.lineTo(-1.4 * u, -1.1 * u);
            c.lineTo(-3.5 * u, -0.7 * u);
            c.closePath();
            c.fill();
            // Arm crossed over chest
            c.strokeStyle = shirt;
            c.lineCap = 'round';
            c.lineWidth = 0.55 * u;
            c.beginPath();
            c.moveTo(-2.0 * u, -0.8 * u);
            c.lineTo(-1.0 * u, -1.0 * u - breath);
            c.stroke();
            c.strokeStyle = skin;
            c.lineWidth = 0.45 * u;
            c.beginPath();
            c.moveTo(-1.0 * u, -1.0 * u - breath);
            c.lineTo( 0.6 * u, -0.8 * u);
            c.stroke();
            c.fillStyle = skin;
            c.beginPath();
            c.arc(0.6 * u, -0.8 * u, 0.3 * u, 0, Math.PI * 2);
            c.fill();
            // Head (using drift wood as a pillow)
            c.fillStyle = this.mixColor('#5a3a22', '#0a0604', night);
            c.fillRect(-5.0 * u, -0.9 * u, 1.8 * u, 0.7 * u);
            c.fillStyle = skin;
            c.beginPath();
            c.arc(-4.0 * u, -1.4 * u, 1.0 * u, 0, Math.PI * 2);
            c.fill();
            // Hair (back of head)
            c.fillStyle = hair;
            c.beginPath();
            c.arc(-4.4 * u, -1.6 * u, 1.0 * u, Math.PI * 0.0, Math.PI * 1.5, false);
            c.fill();
            // Closed eye (line)
            c.strokeStyle = '#000';
            c.lineWidth = 0.18 * u;
            c.beginPath();
            c.moveTo(-3.5 * u, -1.4 * u);
            c.lineTo(-3.1 * u, -1.4 * u);
            c.stroke();
            // Zzz floating above
            c.fillStyle = `rgba(255,255,255,${0.5 + 0.3 * Math.sin(t * 0.003)})`;
            c.font = `${1.4 * u}px monospace`;
            const zPhase = (t * 0.0008) % 1;
            for (let i = 0; i < 3; i++) {
                const k = (zPhase + i / 3) % 1;
                const alpha = (1 - k) * 0.6;
                c.fillStyle = `rgba(255,255,255,${alpha})`;
                c.fillText('z', -3 * u + k * 4 * u, -3 * u - k * 4 * u);
            }
        }

        poseSkipRock(u, t, skin, shirt, shirtDk, pants, hair, shoe) {
            const c = this.ctx;
            this.drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, 0, 0);
            // Back arm at side
            this.drawArm(c, u, -0.9 * u, -8.6 * u, Math.PI / 2 + 0.05, shirt, shirtDk, skin, false);
            // Throwing arm: animate windup -> release
            const cycle = this.rockSkipPhase; // 0..2.4
            let armAng;
            if (cycle < 1.0) {
                armAng = -Math.PI * 0.55 + cycle * Math.PI * 0.55; // windup back
            } else if (cycle < 1.15) {
                armAng = -Math.PI * 0.2; // mid-throw
            } else {
                armAng = -Math.PI * 0.05; // follow-through
            }
            this.drawArm(c, u, 0.9 * u, -8.6 * u, armAng, shirt, shirtDk, skin, true);
        }

        // Run: same as pace but faster strides and more pronounced bob/arm-swing
        poseRun(u, t, skin, shirt, shirtDk, pants, hair, shoe) {
            const c = this.ctx;
            const stepCycle = Math.sin(t * 0.020);
            const bob = Math.abs(stepCycle) * 0.8;
            c.save();
            c.translate(0, -bob);
            // Forward lean
            c.rotate(0.08);
            this.drawStandingBase(u, skin, shirt, shirtDk, pants, hair, shoe, 0, stepCycle * 0.9);
            const swing = stepCycle * 0.9;
            this.drawArm(c, u, -0.9 * u, -8.6 * u, Math.PI / 2 - swing - 0.2, shirt, shirtDk, skin, false);
            this.drawArm(c, u,  0.9 * u, -8.6 * u, Math.PI / 2 + swing - 0.2, shirt, shirtDk, skin, false);
            c.restore();
        }

        // Climbing the palm trunk: arms reach up gripping, legs bent gripping below.
        // (The castaway is translated to the trunk x and lifted by climbPhase via castawayYOffset.)
        poseClimb(u, t, skin, shirt, shirtDk, pants, hair, shoe, night) {
            const c = this.ctx;
            const grip = Math.sin(t * 0.006) * 0.06; // small grab-shift wobble
            // Legs bent gripping trunk (knees splayed slightly)
            c.fillStyle = pants;
            // Left leg: thigh outward, shin in toward trunk
            c.beginPath();
            c.moveTo(-0.6 * u, -5 * u);
            c.lineTo(-1.6 * u, -3.6 * u);
            c.lineTo(-1.4 * u, -2.6 * u);
            c.lineTo(-0.2 * u, -3.4 * u);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(-1.6 * u, -3.6 * u);
            c.lineTo(-1.2 * u, -3.2 * u);
            c.lineTo(-0.4 * u, -1.4 * u);
            c.lineTo(-0.7 * u, -1.0 * u);
            c.closePath();
            c.fill();
            // Right leg (mirrored, behind)
            c.fillStyle = this.mixColor(pants, '#000', 0.20);
            c.beginPath();
            c.moveTo(0.4 * u, -5 * u);
            c.lineTo(1.4 * u, -3.6 * u);
            c.lineTo(1.2 * u, -2.6 * u);
            c.lineTo(0.0 * u, -3.4 * u);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(1.4 * u, -3.6 * u);
            c.lineTo(1.0 * u, -3.2 * u);
            c.lineTo(0.5 * u, -1.4 * u);
            c.lineTo(0.9 * u, -1.0 * u);
            c.closePath();
            c.fill();
            // Bare feet gripping trunk
            c.fillStyle = this.mixColor('#a87a52', '#1a1008', night);
            c.fillRect(-0.85 * u, -1.0 * u, 0.6 * u, 0.4 * u);
            c.fillStyle = this.mixColor('#a87a52', '#1a1008', night);
            c.fillRect(0.55 * u, -1.0 * u, 0.6 * u, 0.4 * u);

            // Belt + torso pressed against trunk
            c.fillStyle = this.mixColor(pants, '#000', 0.45);
            c.fillRect(-1.0 * u, -5 * u, 2.0 * u, 0.4 * u);
            c.fillStyle = shirt;
            c.beginPath();
            c.moveTo(-1.1 * u, -5 * u);
            c.lineTo( 1.1 * u, -5 * u);
            c.lineTo( 0.8 * u, -8.8 * u);
            c.lineTo(-0.8 * u, -8.8 * u);
            c.closePath();
            c.fill();
            // Shirt shadow on the trunk side
            c.fillStyle = shirtDk;
            c.beginPath();
            c.moveTo(0.2 * u, -5 * u);
            c.lineTo(1.1 * u, -5 * u);
            c.lineTo(0.8 * u, -8.8 * u);
            c.lineTo(0.2 * u, -8.8 * u);
            c.closePath();
            c.fill();

            // Arms reaching up gripping the trunk
            this.drawArm(c, u, -0.9 * u, -8.4 * u, -Math.PI * 0.5 - 0.18 + grip, shirt, shirtDk, skin, true);
            this.drawArm(c, u,  0.9 * u, -8.4 * u, -Math.PI * 0.5 + 0.18 - grip, shirt, shirtDk, skin, true);

            // Head tilted up
            this.drawHead(u, skin, hair, 0, true, -8.8 * u);
        }

        // Swimming / wading / panicking. The current substate decides the silhouette.
        poseSwim(u, t, skin, shirt, shirtDk, pants, hair, shoe, night) {
            const c = this.ctx;
            const sub = this.swimSubstate;

            if (sub === 'wade-in' || sub === 'wade-out') {
                // Half-submerged standing pose; just torso + head visible above water.
                this.poseWading(u, t, skin, shirt, shirtDk, pants, hair, night);
                return;
            }
            if (sub === 'swim') {
                // Horizontal silhouette: body lies on the water surface, arms stroke.
                const stroke = Math.sin(this.swimStrokePhase * 4) * 0.6;
                // Body: a torso lying flat, head poking out front
                c.save();
                c.rotate(-0.05);
                // back
                c.fillStyle = shirt;
                c.beginPath();
                c.ellipse(-1.4 * u, 0, 2.6 * u, 0.7 * u, 0, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = shirtDk;
                c.beginPath();
                c.ellipse(-1.4 * u, 0.25 * u, 2.4 * u, 0.32 * u, 0, 0, Math.PI * 2);
                c.fill();
                // head
                c.fillStyle = skin;
                c.beginPath();
                c.arc(0.6 * u, -0.2 * u, 0.9 * u, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = hair;
                c.beginPath();
                c.arc(0.4 * u, -0.6 * u, 0.85 * u, Math.PI * 1.05, Math.PI * 1.95, false);
                c.lineTo(1.0 * u, -0.2 * u);
                c.lineTo(-0.2 * u, -0.2 * u);
                c.closePath();
                c.fill();
                // eye + mouth
                c.fillStyle = '#000';
                c.fillRect(0.9 * u, -0.25 * u, 0.18 * u, 0.18 * u);
                // Forward arm reaching (stroke)
                c.strokeStyle = skin;
                c.lineWidth = 0.55 * u;
                c.lineCap = 'round';
                c.beginPath();
                c.moveTo(0.1 * u, -0.1 * u);
                c.lineTo(1.4 * u + Math.abs(stroke) * u, -0.4 * u - stroke * 0.6 * u);
                c.stroke();
                // splash where arm meets water
                c.strokeStyle = `rgba(240,250,255,${0.7 - night * 0.3})`;
                c.lineWidth = 0.6;
                c.beginPath();
                c.arc(1.4 * u, -0.2 * u, 0.4 * u + Math.abs(stroke) * u * 0.4, 0, Math.PI * 2);
                c.stroke();
                // kicking legs (small foam at trailing end)
                c.strokeStyle = `rgba(240,250,255,${0.55 - night * 0.3})`;
                c.lineWidth = 1.0;
                for (let k = 0; k < 4; k++) {
                    const fx = -3.6 * u - k * 0.6 * u;
                    const fy = (k % 2 === 0 ? -0.1 : 0.1) * u + Math.sin(this.swimStrokePhase * 5 + k) * 0.15 * u;
                    c.beginPath();
                    c.arc(fx, fy, 0.4 + k * 0.15, 0, Math.PI * 2);
                    c.stroke();
                }
                c.restore();
                return;
            }
            if (sub === 'panic') {
                // Vertical, arms flailing, mouth open
                const flail = Math.sin(t * 0.025);
                // torso just above water
                c.fillStyle = shirt;
                c.beginPath();
                c.moveTo(-1.0 * u, 0);
                c.lineTo( 1.0 * u, 0);
                c.lineTo( 0.75 * u, -2.6 * u);
                c.lineTo(-0.75 * u, -2.6 * u);
                c.closePath();
                c.fill();
                // head
                this.drawHead(u, skin, hair, 0, true, -2.6 * u);
                // mouth open (panicked) — small dark oval
                c.fillStyle = '#1a0a08';
                c.beginPath();
                c.ellipse(0.5 * u, -3.1 * u, 0.22 * u, 0.16 * u, 0, 0, Math.PI * 2);
                c.fill();
                // Arms flailing up
                this.drawArm(c, u, -0.7 * u, -2.4 * u, -Math.PI * 0.55 - flail * 0.4, shirt, shirtDk, skin, true);
                this.drawArm(c, u,  0.7 * u, -2.4 * u, -Math.PI * 0.45 + flail * 0.4, shirt, shirtDk, skin, true);
                // splash arcs around the body
                c.strokeStyle = `rgba(240, 250, 255, ${0.75 - night * 0.3})`;
                c.lineWidth = 0.9;
                for (let i = 0; i < 4; i++) {
                    const a = i * Math.PI * 0.5 + t * 0.005;
                    c.beginPath();
                    c.arc(0, -0.2 * u, 1.6 * u + i * 0.3, a, a + 0.6);
                    c.stroke();
                }
                return;
            }
            if (sub === 'rush') {
                // Rushing back: vertical, arms pumping forward, looks back over shoulder
                const stroke = Math.sin(t * 0.025);
                // torso
                c.fillStyle = shirt;
                c.beginPath();
                c.moveTo(-0.95 * u, 0);
                c.lineTo( 0.95 * u, 0);
                c.lineTo( 0.75 * u, -2.6 * u);
                c.lineTo(-0.75 * u, -2.6 * u);
                c.closePath();
                c.fill();
                this.drawHead(u, skin, hair, 0, true, -2.6 * u);
                // Arms swinging
                this.drawArm(c, u, -0.7 * u, -2.4 * u, Math.PI * 0.18 + stroke * 0.5, shirt, shirtDk, skin, false);
                this.drawArm(c, u,  0.7 * u, -2.4 * u, Math.PI * 0.18 - stroke * 0.5, shirt, shirtDk, skin, false);
                // big splashes
                c.strokeStyle = `rgba(240, 250, 255, ${0.85 - night * 0.3})`;
                c.lineWidth = 1.2;
                for (let k = 0; k < 5; k++) {
                    const sx = (-2 - k * 0.6) * u;
                    c.beginPath();
                    c.arc(sx, -0.15 * u, 0.5 * u + k * 0.15, 0, Math.PI * 2);
                    c.stroke();
                }
                return;
            }
        }

        // Wading pose used during wade-in / wade-out (legs hidden under water surface)
        poseWading(u, t, skin, shirt, shirtDk, pants, hair, night) {
            const c = this.ctx;
            const breathe = Math.sin(t * 0.003) * 0.18;
            // Torso just above water surface (y ≈ 0). No legs drawn.
            c.fillStyle = shirt;
            c.beginPath();
            c.moveTo(-1.3 * u, 0);
            c.lineTo( 1.3 * u, 0);
            c.lineTo( 1.0 * u, -4 * u + breathe);
            c.lineTo(-1.0 * u, -4 * u + breathe);
            c.closePath();
            c.fill();
            c.fillStyle = shirtDk;
            c.beginPath();
            c.moveTo( 0.2 * u, 0);
            c.lineTo( 1.3 * u, 0);
            c.lineTo( 1.0 * u, -4 * u + breathe);
            c.lineTo( 0.2 * u, -4 * u + breathe);
            c.closePath();
            c.fill();
            // Arms held up to keep balance
            this.drawArm(c, u, -0.9 * u, -3.6 * u, -Math.PI * 0.35, shirt, shirtDk, skin, true);
            this.drawArm(c, u,  0.9 * u, -3.6 * u, -Math.PI * 0.65, shirt, shirtDk, skin, true);
            // Head
            this.drawHead(u, skin, hair, breathe, true, -4 * u);
            // Water line ripples around hips
            c.strokeStyle = `rgba(240, 250, 255, ${0.6 - night * 0.3})`;
            c.lineWidth = 0.6;
            for (let r = 0.6; r <= 2.4; r += 0.4) {
                c.beginPath();
                c.ellipse(0, 0.1 * u, r * u, 0.25 * u, 0, 0, Math.PI * 2);
                c.stroke();
            }
        }

        // Crouched, miming building a fire. Arms work in front of the body.
        poseBuildFire(u, t, skin, shirt, shirtDk, pants, hair, shoe, night) {
            const c = this.ctx;
            // Crouch: torso lower, knees bent
            const stoke = Math.sin(t * 0.012);
            // Legs (crouching - thighs angled forward+down)
            c.fillStyle = pants;
            // Left leg
            c.beginPath();
            c.moveTo(-0.5 * u, -3.6 * u);
            c.lineTo( 0.3 * u, -3.6 * u);
            c.lineTo( 1.4 * u, -1.4 * u);
            c.lineTo( 0.7 * u, -1.0 * u);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo( 1.4 * u, -1.4 * u);
            c.lineTo( 0.7 * u, -1.0 * u);
            c.lineTo( 0.6 * u, 0);
            c.lineTo( 1.4 * u, 0);
            c.closePath();
            c.fill();
            // Back leg, slightly behind
            c.fillStyle = this.mixColor(pants, '#000', 0.22);
            c.beginPath();
            c.moveTo(-0.6 * u, -3.5 * u);
            c.lineTo( 0.0 * u, -3.5 * u);
            c.lineTo( 1.0 * u, -1.4 * u);
            c.lineTo( 0.4 * u, -1.0 * u);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo( 1.0 * u, -1.4 * u);
            c.lineTo( 0.4 * u, -1.0 * u);
            c.lineTo( 0.3 * u, 0);
            c.lineTo( 1.0 * u, 0);
            c.closePath();
            c.fill();
            // Feet
            c.fillStyle = this.mixColor('#4a3624', '#0a0604', 0);
            c.beginPath();
            c.ellipse(0.9 * u, 0.05 * u, 0.55 * u, 0.18 * u, 0, 0, Math.PI * 2);
            c.fill();
            // Belt
            c.fillStyle = this.mixColor(pants, '#000', 0.45);
            c.fillRect(-0.95 * u, -3.7 * u, 1.6 * u, 0.32 * u);
            // Torso leaning forward
            c.save();
            c.translate(-0.15 * u, -3.6 * u);
            c.rotate(0.20);
            c.fillStyle = shirt;
            c.beginPath();
            c.moveTo(-1.2 * u, 0);
            c.lineTo( 1.2 * u, 0);
            c.lineTo( 0.95 * u, -3.6 * u);
            c.lineTo(-0.95 * u, -3.6 * u);
            c.closePath();
            c.fill();
            c.fillStyle = shirtDk;
            c.beginPath();
            c.moveTo( 0.2 * u, 0);
            c.lineTo( 1.2 * u, 0);
            c.lineTo( 0.95 * u, -3.6 * u);
            c.lineTo( 0.2 * u, -3.6 * u);
            c.closePath();
            c.fill();
            // Hands working in front (one higher when stoke is at peak, mimicking blowing/stacking)
            const armA = -Math.PI * 0.1 + stoke * 0.18;
            const armB = -Math.PI * 0.18 - stoke * 0.10;
            this.drawArm(c, u,  0.9 * u, -3.4 * u, armA, shirt, shirtDk, skin, false);
            this.drawArm(c, u, -0.7 * u, -3.4 * u, armB, shirt, shirtDk, skin, false);
            // Head looking down at the pit
            this.drawHead(u, skin, hair, 0, true, -3.6 * u);
            c.restore();
            // A small bundle of kindling near the hands (a few twig strokes)
            const twigCol = this.mixColor('#7a5430', '#1a0c06', night);
            c.strokeStyle = twigCol;
            c.lineWidth = 0.6;
            c.beginPath();
            c.moveTo(1.2 * u, -2.0 * u);
            c.lineTo(2.6 * u, -1.4 * u);
            c.moveTo(1.4 * u, -1.8 * u);
            c.lineTo(2.7 * u, -1.6 * u);
            c.moveTo(1.6 * u, -1.6 * u);
            c.lineTo(2.6 * u, -1.2 * u);
            c.stroke();
        }

        updateThrownRock(dt, night) {
            if (!this.thrownRock) return;
            const c = this.ctx;
            const r = this.thrownRock;
            r.vy += 280 * (dt / 1000); // gravity
            r.x += r.vx * (dt / 1000);
            r.y += r.vy * (dt / 1000);
            // Bounce on water (only above sea level)
            const waterY = this.castawayBaseY + 2;
            if (r.y >= waterY && r.bounce < 4) {
                r.bounce++;
                r.vy = -r.vy * 0.55;
                r.vx *= 0.85;
                // Splash ring
                this.fishJumps.push({
                    type: 'splash',
                    x: r.x, y: waterY,
                    life: 0.6,
                });
            }
            if (r.bounce >= 4 || r.x < -50 || r.x > this.width + 50) {
                this.thrownRock = null;
                return;
            }
            c.fillStyle = this.mixColor('#3a2c1c', '#0a0604', night);
            c.beginPath();
            c.arc(r.x, r.y, 1.6, 0, Math.PI * 2);
            c.fill();
        }

        // ===================== Campfire & smoke =====================
        // level: 0..1. 0 = no fire (just stone ring + ash), 1 = blazing.
        // Flames scale smoothly with level so the fire dies down gracefully.
        drawCampfire(x, baseY, flicker, night, level) {
            if (level <= 0.001) {
                // Just the cold pit — stones and a smudge of ash.
                this.drawColdFirePit(x, baseY, night);
                return;
            }
            const c = this.ctx;
            const u = this.castUnit;
            const s = u / 3.6;
            // Smooth ease so flames grow visibly even at low level (no sudden pop).
            const e = Math.sqrt(level);  // emphasises low-end growth
            c.save();
            c.translate(x, baseY);
            c.scale(s, s);

            // Stone ring around fire
            c.fillStyle = this.mixColor('#4a3a2a', '#0a0604', night);
            for (let i = -2; i <= 2; i++) {
                const sx = i * 5;
                c.beginPath();
                c.ellipse(sx, 1, 2.5, 1.5, 0, 0, Math.PI * 2);
                c.fill();
            }
            c.fillStyle = this.mixColor('#8a7050', '#1a120a', night);
            for (let i = -2; i <= 2; i++) {
                const sx = i * 5;
                c.beginPath();
                c.ellipse(sx - 0.6, 0.6, 1.0, 0.4, 0, 0, Math.PI * 2);
                c.fill();
            }

            // Logs (crossed) — gradually char as the fire dies
            const logCol = this.mixColor(
                this.mixColor('#3a2418', '#1a1008', 1 - level),
                '#0a0604', night
            );
            c.fillStyle = logCol;
            c.fillRect(-10, -2, 20, 3);
            const logCol2 = this.mixColor(
                this.mixColor('#5a3624', '#2a160e', 1 - level),
                '#1a0a06', night
            );
            c.fillStyle = logCol2;
            c.save();
            c.translate(0, -1);
            c.rotate(0.30);
            c.fillRect(-10, -2, 20, 3);
            c.restore();
            c.strokeStyle = this.mixColor('#3a2210', '#000', night);
            c.lineWidth = 0.5;
            c.beginPath();
            c.arc(-10, -0.5, 1.5, 0, Math.PI * 2);
            c.arc(10, -0.5, 1.5, 0, Math.PI * 2);
            c.stroke();

            // Embers under logs — bright even at low level (they outlast the flames)
            const emberFlick = 0.85 + 0.15 * Math.sin(flicker * 0.018);
            const emberA = 0.65 * emberFlick * (0.6 + level * 0.4);
            c.fillStyle = `rgba(255, 130, 50, ${emberA})`;
            c.beginPath(); c.arc(-3, -1, 1.4, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(3, -1, 1.4, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(0, 0, 1.6, 0, Math.PI * 2); c.fill();

            // Flame heights scale with sqrt(level)
            const fh = e; // flame multiplier
            const f1 = Math.sin(flicker * 0.012) * 1.5;
            const f2 = Math.sin(flicker * 0.022 + 1.7) * 1.2;
            const f3 = Math.sin(flicker * 0.038 + 2.3) * 0.8;

            // Outer glow halo
            c.save();
            c.globalCompositeOperation = 'lighter';
            const haloR = 24 + 24 * e;
            const gr = c.createRadialGradient(0, -7 * fh, 1, 0, -7 * fh, haloR);
            gr.addColorStop(0, `rgba(255, 200, 90, ${0.70 * emberFlick * level})`);
            gr.addColorStop(0.4, `rgba(255, 130, 50, ${0.25 * level})`);
            gr.addColorStop(1, 'rgba(255, 100, 40, 0)');
            c.fillStyle = gr;
            c.beginPath();
            c.arc(0, -7 * fh, haloR, 0, Math.PI * 2);
            c.fill();
            c.restore();

            // Outer flame
            c.fillStyle = `rgba(255, 130, 60, ${0.92 * level})`;
            c.beginPath();
            c.moveTo(-5 * fh + f1, -3);
            c.quadraticCurveTo(-4 * fh, (-13 + f1) * fh, 0, (-18 + f2) * fh);
            c.quadraticCurveTo(4 * fh, (-13 - f1) * fh, (5 - f2) * fh, -3);
            c.closePath();
            c.fill();
            // Mid flame
            c.fillStyle = `rgba(255, 180, 70, ${0.96 * level})`;
            c.beginPath();
            c.moveTo(-3 * fh + f3, -3);
            c.quadraticCurveTo(-2.5 * fh, (-10 + f1) * fh, 0, (-14 + f2) * fh);
            c.quadraticCurveTo(2.5 * fh, (-10 - f1) * fh, (3 - f3) * fh, -3);
            c.closePath();
            c.fill();
            // Inner flame
            c.fillStyle = `rgba(255, 230, 140, ${0.95 * level})`;
            c.beginPath();
            c.moveTo(-1.6 * fh, -3);
            c.quadraticCurveTo(-1.5 * fh, (-8 + f2) * fh, 0, (-10 + f1) * fh);
            c.quadraticCurveTo(1.5 * fh, (-8 - f2) * fh, 1.6 * fh, -3);
            c.closePath();
            c.fill();
            // White-hot core (only when fire is strong)
            if (level > 0.4) {
                c.fillStyle = `rgba(255, 250, 220, ${0.85 * (level - 0.4) / 0.6})`;
                c.beginPath();
                c.moveTo(-0.7 * fh, -3);
                c.quadraticCurveTo(0, (-6 + f1 * 0.4) * fh, 0.7 * fh, -3);
                c.closePath();
                c.fill();
            }
            // Spark embers floating up
            if (level > 0.2) {
                for (let i = 0; i < 3; i++) {
                    const ex = Math.sin(flicker * 0.005 + i * 2) * 4;
                    const ey = -((flicker * 0.04 + i * 30) % 50) - 4;
                    const ea = Math.max(0, 1 - (-ey) / 50) * level;
                    c.fillStyle = `rgba(255, 200, 90, ${ea * 0.9})`;
                    c.beginPath();
                    c.arc(ex, ey, 0.5, 0, Math.PI * 2);
                    c.fill();
                }
            }
            c.restore();
        }

        // Pit with stones and a smear of dark ash — what's left when the fire's out.
        drawColdFirePit(x, baseY, night) {
            const c = this.ctx;
            const u = this.castUnit;
            const s = u / 3.6;
            c.save();
            c.translate(x, baseY);
            c.scale(s, s);
            c.fillStyle = this.mixColor('#4a3a2a', '#0a0604', night);
            for (let i = -2; i <= 2; i++) {
                const sx = i * 5;
                c.beginPath();
                c.ellipse(sx, 1, 2.5, 1.5, 0, 0, Math.PI * 2);
                c.fill();
            }
            c.fillStyle = this.mixColor('#8a7050', '#1a120a', night);
            for (let i = -2; i <= 2; i++) {
                const sx = i * 5;
                c.beginPath();
                c.ellipse(sx - 0.6, 0.6, 1.0, 0.4, 0, 0, Math.PI * 2);
                c.fill();
            }
            // ash smear in center
            c.fillStyle = this.mixColor('#3a3024', '#070504', night);
            c.beginPath();
            c.ellipse(0, 0.4, 5, 1.4, 0, 0, Math.PI * 2);
            c.fill();
            c.restore();
        }

        updateSmoke(t, dt, night, fireLevel) {
            const lvl = fireLevel === undefined ? 1 : fireLevel;
            this.nextSmokeMs -= dt;
            if (this.nextSmokeMs <= 0) {
                this.smokePuffs.push({
                    x: this.campfireX + (Math.random() - 0.5) * 4,
                    y: this.campfireY - 24 * Math.sqrt(lvl),
                    life: 1.0,
                    vy: -8 - Math.random() * 4,
                    drift: (Math.random() - 0.5) * 4,
                    size: 4 + Math.random() * 3,
                });
                // Smoke comes in puffs less frequently as the fire dies
                this.nextSmokeMs = (400 + Math.random() * 400) / Math.max(0.25, lvl);
            }
            const c = this.ctx;
            this.smokePuffs = this.smokePuffs.filter(p => {
                p.life -= dt / 4500;
                if (p.life <= 0) return false;
                p.y += p.vy * (dt / 1000);
                p.x += p.drift * (dt / 1000);
                const a = p.life * 0.30 * (1 - night * 0.3) * (0.5 + 0.5 * lvl);
                const r = p.size * (1.6 - p.life);
                c.fillStyle = `rgba(180, 180, 180, ${a})`;
                c.beginPath();
                c.arc(p.x, p.y, r, 0, Math.PI * 2);
                c.fill();
                return true;
            });
        }

        // ===================== Gulls =====================
        updateGulls(t, dt, night) {
            this.nextGullMs -= dt;
            if (this.nextGullMs <= 0 && this.gulls.length < 4) {
                const dir = Math.random() < 0.5 ? 1 : -1;
                const altK = Math.random();
                this.gulls.push({
                    x: dir > 0 ? -40 : this.width + 40,
                    y: this.horizonY * (0.10 + altK * 0.42),
                    dir,
                    speed: 28 + altK * 50 + Math.random() * 20,
                    flapPhase: Math.random() * Math.PI * 2,
                    flapSpeed: 4 + Math.random() * 4,
                    scale: 0.5 + altK * 0.85,
                    glide: Math.random() < 0.3, // some gulls glide rather than flap
                });
                this.nextGullMs = 7000 + Math.random() * 12000;
            }
            this.gulls = this.gulls.filter(g => {
                g.x += g.dir * g.speed * (dt / 1000);
                if (!g.glide) g.flapPhase += g.flapSpeed * (dt / 1000);
                if (g.x < -60 || g.x > this.width + 60) return false;
                this.drawGull(g, t, night);
                return true;
            });
        }

        drawGull(g, t, night) {
            const c = this.ctx;
            const flap = g.glide ? 0.5 : (0.5 + 0.5 * Math.sin(g.flapPhase));
            const wing = flap * 5 * g.scale;
            c.save();
            c.translate(g.x, g.y);
            c.scale(g.dir * g.scale, g.scale);
            const col = this.mixColor('#222', '#000', night);
            const wingCol = this.mixColor('#444', '#000', night);
            // Wings (two arcs)
            c.strokeStyle = col;
            c.lineWidth = 1.8;
            c.lineCap = 'round';
            c.beginPath();
            c.moveTo(-9, 0);
            c.quadraticCurveTo(-5, -wing, 0, -0.4);
            c.quadraticCurveTo(5, -wing, 9, 0);
            c.stroke();
            // Wing tip black bands (gull-look)
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(-9, 0); c.lineTo(-7, 0.3);
            c.moveTo(9, 0); c.lineTo(7, 0.3);
            c.stroke();
            // Body
            c.fillStyle = wingCol;
            c.beginPath();
            c.ellipse(0, 0.2, 1.6, 0.9, 0, 0, Math.PI * 2);
            c.fill();
            // Tiny beak hint
            c.fillStyle = this.mixColor('#e88030', '#1a0c04', night);
            c.fillRect(1.5, 0, 1.2, 0.5);
            c.restore();
        }

        // ===================== Crabs =====================
        updateCrabs(t, dt, night) {
            this.nextCrabMs -= dt;
            if (this.nextCrabMs <= 0 && this.crabs.length < 1) {
                const dir = Math.random() < 0.5 ? 1 : -1;
                this.crabs.push({
                    x: dir > 0 ? this.width * 0.12 : this.width * 0.86,
                    y: this.islandY + 14 + Math.random() * 6,
                    dir,
                    speed: 16 + Math.random() * 8,
                    legPhase: 0,
                    life: 1.0,
                });
                this.nextCrabMs = 15000 + Math.random() * 25000;
            }
            this.crabs = this.crabs.filter(cr => {
                cr.x += cr.dir * cr.speed * (dt / 1000);
                // Stride speed matches travel speed so legs look like they propel the body.
                cr.legPhase += dt * 0.018;
                if (cr.x < this.width * 0.10 || cr.x > this.width * 0.88) {
                    cr.life -= dt / 1200;
                    if (cr.life <= 0) return false;
                }
                this.drawCrab(cr, night);
                return true;
            });
        }

        // Cute crab with two visible walking legs that lift and plant each side,
        // plus a slight body-bob so it never appears to glide.
        drawCrab(cr, night) {
            const c = this.ctx;
            const u = this.castUnit * 0.5;
            // Body bobs gently up/down as the steps land.
            const bob = Math.abs(Math.sin(cr.legPhase * 0.5)) * 1.0;
            c.save();
            c.translate(cr.x, cr.y - bob);
            c.scale(cr.dir, 1);

            const body = this.mixColor('#d8401e', '#1a0a04', night);
            const bodyDk = this.mixColor('#8a2410', '#0a0402', night);
            const legCol = this.mixColor('#9a2c14', '#0a0402', night);

            // --- Legs: 2 per side, alternating walk cycle ---
            // Each leg has a "lift" phase (curled up) and a "plant" phase (extended down).
            c.strokeStyle = legCol;
            c.lineWidth = 0.95;
            c.lineCap = 'round';
            for (const sideSign of [-1, 1]) {
                for (let pair = 0; pair < 2; pair++) {
                    const phase = cr.legPhase * 2 + sideSign * 1.4 + pair * Math.PI;
                    const stepCycle = Math.sin(phase);
                    // Lift = how high off the sand the foot is right now (0 = planted)
                    const lift = Math.max(0, stepCycle) * 1.2;
                    // Forward stride = small fore-aft swing
                    const stride = Math.cos(phase) * 0.7;
                    // Hip position on body
                    const hipX = sideSign * 0.5 * u + (pair === 0 ? sideSign * 0.4 * u : -sideSign * 0.1 * u);
                    const hipY = 0;
                    // Foot position (planted on sand or lifted)
                    const footX = sideSign * (1.5 + 0.3 * pair) * u + stride;
                    const footY = u * 0.9 + bob - lift;  // counter the body bob so planted feet stay on sand
                    // Knee position (joint between hip and foot, raised by lift)
                    const kneeX = (hipX + footX) * 0.5;
                    const kneeY = Math.min(hipY, footY) - 0.8 - lift * 0.4;
                    c.beginPath();
                    c.moveTo(hipX, hipY);
                    c.quadraticCurveTo(kneeX, kneeY, footX, footY);
                    c.stroke();
                    // Tiny foot dot when planted (looks like a footprint)
                    if (lift < 0.2) {
                        c.fillStyle = bodyDk;
                        c.beginPath();
                        c.arc(footX, footY, 0.5, 0, Math.PI * 2);
                        c.fill();
                    }
                }
            }

            // --- Body ---
            c.fillStyle = body;
            c.beginPath();
            c.ellipse(0, 0, u * 1.4, u * 0.9, 0, 0, Math.PI * 2);
            c.fill();
            // Shell highlight (cute, large)
            c.fillStyle = this.colorWithAlpha(this.mixColor(body, '#fff', 0.35), 0.75);
            c.beginPath();
            c.ellipse(-0.25 * u, -0.32 * u, u * 0.55, u * 0.26, 0, 0, Math.PI * 2);
            c.fill();
            // Shell speckles
            c.fillStyle = this.colorWithAlpha(bodyDk, 0.5);
            c.beginPath(); c.arc(0.3 * u, 0.0, 0.5, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(-0.05 * u, 0.25 * u, 0.4, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc(0.55 * u, 0.2 * u, 0.4, 0, Math.PI * 2); c.fill();

            // --- Eyes on stalks (cute, big) ---
            c.strokeStyle = bodyDk;
            c.lineWidth = 0.6;
            c.beginPath();
            c.moveTo(-0.45 * u, -0.6 * u); c.lineTo(-0.45 * u, -1.05 * u);
            c.moveTo( 0.45 * u, -0.6 * u); c.lineTo( 0.45 * u, -1.05 * u);
            c.stroke();
            // Eyeball whites
            c.fillStyle = '#fff';
            c.beginPath(); c.arc(-0.45 * u, -1.15 * u, 0.55, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc( 0.45 * u, -1.15 * u, 0.55, 0, Math.PI * 2); c.fill();
            // Pupils — look in the direction of travel
            c.fillStyle = '#000';
            c.beginPath(); c.arc(-0.45 * u + 0.18, -1.15 * u, 0.30, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.arc( 0.45 * u + 0.18, -1.15 * u, 0.30, 0, Math.PI * 2); c.fill();

            // --- Pincers ---
            c.fillStyle = body;
            c.beginPath();
            c.moveTo(u * 1.2, -0.2 * u);
            c.quadraticCurveTo(u * 2.2, -0.6 * u, u * 2.0, 0.4 * u);
            c.quadraticCurveTo(u * 1.5, 0.3 * u, u * 1.2, 0.3 * u);
            c.closePath();
            c.fill();
            c.beginPath();
            c.moveTo(-u * 1.2, -0.2 * u);
            c.quadraticCurveTo(-u * 2.2, -0.6 * u, -u * 2.0, 0.4 * u);
            c.quadraticCurveTo(-u * 1.5, 0.3 * u, -u * 1.2, 0.3 * u);
            c.closePath();
            c.fill();
            // Pincer slits
            c.strokeStyle = bodyDk;
            c.lineWidth = 0.5;
            c.beginPath();
            c.moveTo( u * 1.9, -0.2 * u); c.lineTo( u * 2.05, 0.05 * u);
            c.moveTo(-u * 1.9, -0.2 * u); c.lineTo(-u * 2.05, 0.05 * u);
            c.stroke();

            // Tiny smile
            c.strokeStyle = bodyDk;
            c.lineWidth = 0.5;
            c.beginPath();
            c.arc(0, -0.05 * u, 0.30 * u, 0.2, Math.PI - 0.2);
            c.stroke();

            c.restore();
        }

        // ===================== Fish jumps + splashes =====================
        updateFishJumps(t, dt, night) {
            this.nextFishMs -= dt;
            if (this.nextFishMs <= 0) {
                const x = this.width * (0.06 + Math.random() * 0.18);
                this.fishJumps.push({
                    type: 'fish',
                    x,
                    y: this.horizonY + 60 + Math.random() * 60,
                    vx: (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 20),
                    vy: -80 - Math.random() * 30,
                    life: 1.0,
                    apex: -1,
                });
                this.nextFishMs = 6000 + Math.random() * 8000;
            }
            const c = this.ctx;
            this.fishJumps = this.fishJumps.filter(f => {
                if (f.type === 'splash') {
                    f.life -= dt / 700;
                    if (f.life <= 0) return false;
                    const r = (1 - f.life) * 10;
                    const a = f.life * 0.7 * (1 - night * 0.3);
                    c.strokeStyle = `rgba(240, 250, 255, ${a})`;
                    c.lineWidth = 1.2;
                    c.beginPath();
                    c.ellipse(f.x, f.y, r, r * 0.35, 0, 0, Math.PI * 2);
                    c.stroke();
                    return true;
                } else {
                    f.vy += 220 * (dt / 1000);
                    f.x += f.vx * (dt / 1000);
                    f.y += f.vy * (dt / 1000);
                    const enterY = this.horizonY + 60;
                    if (f.y >= enterY && f.vy > 0) {
                        // splash on re-entry
                        this.fishJumps.push({ type: 'splash', x: f.x, y: enterY, life: 1.0 });
                        return false;
                    }
                    // Draw fish
                    const bodyCol = this.mixColor('#7aa8b8', '#0a1418', night);
                    const bellyCol = this.mixColor('#cce4f0', '#1a2228', night);
                    const ang = Math.atan2(f.vy, f.vx);
                    c.save();
                    c.translate(f.x, f.y);
                    c.rotate(ang);
                    if (f.vx < 0) c.scale(1, -1);
                    c.fillStyle = bodyCol;
                    c.beginPath();
                    c.ellipse(0, 0, 6, 2.4, 0, 0, Math.PI * 2);
                    c.fill();
                    // Belly
                    c.fillStyle = bellyCol;
                    c.beginPath();
                    c.ellipse(0, 1, 4.5, 1.2, 0, 0, Math.PI * 2);
                    c.fill();
                    // Tail
                    c.fillStyle = bodyCol;
                    c.beginPath();
                    c.moveTo(-5, 0);
                    c.lineTo(-9, -3);
                    c.lineTo(-9, 3);
                    c.closePath();
                    c.fill();
                    // Eye
                    c.fillStyle = '#000';
                    c.beginPath();
                    c.arc(3.5, -0.6, 0.55, 0, Math.PI * 2);
                    c.fill();
                    c.fillStyle = '#fff';
                    c.beginPath();
                    c.arc(3.6, -0.8, 0.2, 0, Math.PI * 2);
                    c.fill();
                    c.restore();
                    return true;
                }
            });
        }

        // ===================== Shark fin (appears during 'swim' panic) =====================
        updateSharkFin(t, dt, night) {
            const f = this.sharkFin;
            f.x += f.vx * (dt / 1000);
            f.life -= dt / 1000;
            if (f.life <= 0 || f.x > this.castawayX + 200) {
                this.sharkFin = null;
                return;
            }
            const c = this.ctx;
            const wobble = Math.sin(t * 0.005) * 1.5;
            // Trailing wake
            c.save();
            c.strokeStyle = `rgba(240, 250, 255, ${0.55 - night * 0.3})`;
            c.lineWidth = 1.0;
            for (let i = 0; i < 6; i++) {
                const k = i / 5;
                const wx = f.x - i * 5;
                const wy = f.y + Math.sin(t * 0.004 + i) * 1.5 + 4;
                c.beginPath();
                c.arc(wx, wy, 1.2 + k * 0.6, 0, Math.PI * 2);
                c.stroke();
            }
            c.restore();
            // Fin: dark sharp triangle with a slight curve
            const finCol = this.mixColor('#1a1e2c', '#000', night * 0.5 + 0.2);
            const finDk = this.mixColor('#0a0d18', '#000', night);
            c.fillStyle = finCol;
            c.beginPath();
            c.moveTo(f.x - 9, f.y + 3);
            c.quadraticCurveTo(f.x - 2, f.y - 9 + wobble * 0.4, f.x + 9, f.y + 3);
            c.quadraticCurveTo(f.x, f.y + 1, f.x - 9, f.y + 3);
            c.closePath();
            c.fill();
            // Trailing edge shadow
            c.fillStyle = finDk;
            c.beginPath();
            c.moveTo(f.x + 4, f.y + 1);
            c.quadraticCurveTo(f.x + 2, f.y - 5 + wobble * 0.3, f.x - 1, f.y - 8 + wobble * 0.4);
            c.quadraticCurveTo(f.x + 2, f.y + 2, f.x + 4, f.y + 1);
            c.closePath();
            c.fill();
            // Tip hilite
            c.fillStyle = this.colorWithAlpha(this.mixColor(finCol, '#fff', 0.45), 0.6);
            c.beginPath();
            c.arc(f.x - 1, f.y - 4 + wobble * 0.4, 0.8, 0, Math.PI * 2);
            c.fill();
            // Small splash bow-wave at the fin's base
            c.strokeStyle = `rgba(255,255,255,${0.6 - night * 0.3})`;
            c.lineWidth = 0.8;
            c.beginPath();
            c.moveTo(f.x - 10, f.y + 5);
            c.quadraticCurveTo(f.x, f.y + 4, f.x + 10, f.y + 5);
            c.stroke();
        }

        // ===================== Message in a bottle =====================
        updateBottle(t, dt, night) {
            this.nextBottleMs -= dt;
            if (this.nextBottleMs <= 0 && !this.bottle) {
                this.bottle = {
                    x: this.width * 0.86,
                    y: this.islandY + 18,
                    vx: -20,
                    settled: false,
                    age: 0,
                };
                this.nextBottleMs = 60000 + Math.random() * 80000;
            }
            if (!this.bottle) return;
            const b = this.bottle;
            b.age += dt;
            if (!b.settled) {
                b.x += b.vx * (dt / 1000);
                b.vx *= 0.985;
                if (Math.abs(b.vx) < 1) b.settled = true;
            }
            if (b.age > 25000) {
                this.bottle = null;
                return;
            }
            const c = this.ctx;
            c.save();
            c.translate(b.x, b.y);
            c.rotate(0.1);
            const glass = this.mixColor('#6a9870', '#08120c', night);
            const glassLite = this.mixColor(glass, '#fff', 0.4);
            // Bottle body
            c.fillStyle = glass;
            c.beginPath();
            c.moveTo(-6, -2);
            c.lineTo(4, -2);
            c.lineTo(7, -1);
            c.lineTo(7, 1);
            c.lineTo(4, 2);
            c.lineTo(-6, 2);
            c.closePath();
            c.fill();
            // Neck/cork
            c.fillStyle = this.mixColor('#8a6038', '#1a0e08', night);
            c.fillRect(7, -0.8, 1.5, 1.6);
            // Hilite
            c.fillStyle = this.colorWithAlpha(glassLite, 0.7);
            c.fillRect(-5, -1.5, 8, 0.4);
            // Tiny note inside
            c.fillStyle = this.mixColor('#f0e0b8', '#1a140a', night);
            c.fillRect(-2, -0.8, 3, 1.6);
            c.restore();
        }
    }

    LiveWallpaper.register({
        id: 'island',
        name: 'Deserted Island',
        description: 'Castaway under a wheeling sun and moon.',
        factory: (canvas) => new IslandWallpaper(canvas),
    });
})();
