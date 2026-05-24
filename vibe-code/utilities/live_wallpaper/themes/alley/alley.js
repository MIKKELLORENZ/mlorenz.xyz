// Japan · Alley — A quiet back-street fish shop at night. Inspired by a piece
// of pixel art: "なかむら観魚店" (Nakamura Kangyoten) — a tiny aquarium store
// where lit tanks glow into the alley, a noren hangs in the doorway, a person
// stands by the entrance, a kei-scooter is parked at the curb, hydrangeas
// crowd the planters, and the upstairs apartment windows are dark.
//
// Cycle is a slow late-night → pre-dawn shift that stays mostly dark. Living
// elements: swimming fish in two tanks, drifting bubbles, an upstairs window
// that occasionally lights, a moth around the streetlamp, swaying noren, the
// proprietor occasionally turning, and a stray cat that passes through the
// alley once in a while.

(function () {
    'use strict';

    // ~5 minute slow drift between deep night and very-late-night blue hour.
    const CYCLE_MS = 300000;

    const SKY_STOPS = [
        { t: 0.00, top: '#070a18', horizon: '#0e1a30', ambient: 0.00 }, // deep night
        { t: 0.25, top: '#0a1024', horizon: '#152444', ambient: 0.05 },
        { t: 0.50, top: '#0e1530', horizon: '#1c2c50', ambient: 0.12 }, // bluest hour
        { t: 0.75, top: '#0a1024', horizon: '#152444', ambient: 0.05 },
        { t: 1.00, top: '#070a18', horizon: '#0e1a30', ambient: 0.00 }, // back to deep night
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

    // Kanji for the storefront sign.
    const SHOP_NAME_KANA = 'なかむら観魚店';
    const SHOP_TEL = 'TEL 03-X576';
    const FONT_SIGN = "700 18px 'Yu Gothic UI','Yu Gothic','Hiragino Kaku Gothic ProN','Meiryo','MS Gothic',sans-serif";
    const FONT_SIGN_SUB = "600 8px 'Helvetica Neue','Arial',sans-serif";
    const FONT_TINY = "600 7px 'Yu Gothic UI','Meiryo','MS Gothic',sans-serif";

    // Fish silhouette types.
    const FISH_TYPES = ['koi', 'koi', 'goldfish', 'goldfish', 'tetra', 'tetra', 'tetra', 'angel'];

    class AlleyWallpaper extends Wallpaper {

        init() {
            // ---- Distant rooftops (very simple silhouettes) ----
            const randB = this.rng(40411);
            this.farRoofs = [];
            let bx = 0;
            while (bx < 1) {
                const bw = 0.04 + randB() * 0.10;
                const bh = 0.04 + randB() * 0.07;
                this.farRoofs.push({
                    x: bx, w: bw, h: bh,
                    antenna: randB() < 0.4,
                    pole: randB() < 0.2,
                });
                bx += bw + 0.002;
            }

            // ---- Stars (sparse, since it's a city night) ----
            const randS = this.rng(8181);
            this.stars = [];
            for (let i = 0; i < 60; i++) {
                this.stars.push({
                    x: randS(),
                    y: randS() * 0.36,
                    mag: 0.2 + randS() * 0.6,
                    phase: randS() * Math.PI * 2,
                });
            }

            // ---- Upper-floor windows of the fish-shop building ----
            // 4 windows in 2 rows. Each may be lit, off, or flicker.
            const randW = this.rng(2233);
            this.upperWindows = [];
            for (let i = 0; i < 4; i++) {
                this.upperWindows.push({
                    lit: randW() < 0.25,
                    flicker: randW() < 0.5,
                    flickerPhase: randW() * Math.PI * 2,
                    // TV-lit windows have a slight color shift over time.
                    tv: randW() < 0.4,
                });
            }

            // ---- Aquariums: two tanks, each with multiple swimming fish ----
            const randF = this.rng(733);
            this.tanks = [];
            for (let ti = 0; ti < 2; ti++) {
                const fish = [];
                const n = 4 + Math.floor(randF() * 3);
                for (let k = 0; k < n; k++) {
                    const type = FISH_TYPES[(randF() * FISH_TYPES.length) | 0];
                    fish.push({
                        type,
                        // Normalized x within tank.
                        x: randF(),
                        baseY: 0.20 + randF() * 0.60,
                        y: 0.50,
                        speed: 0.04 + randF() * 0.10,
                        dir: randF() < 0.5 ? 1 : -1,
                        phase: randF() * Math.PI * 2,
                        size: type === 'tetra' ? 1.4 + randF() * 0.6
                            : type === 'goldfish' ? 2.0 + randF() * 0.8
                            : type === 'angel' ? 2.4 + randF() * 0.6
                            : 2.6 + randF() * 0.8, // koi
                        hue: type === 'koi' ? (randF() < 0.5 ? 20 : 10)
                           : type === 'goldfish' ? 30
                           : type === 'tetra' ? 210
                           : 0,
                        bodyTone: 0.6 + randF() * 0.4,
                    });
                }
                this.tanks.push({
                    fish,
                    // Bubble streams; each tank has a bubbler.
                    bubbles: [],
                    nextBubbleMs: 200 + randF() * 800,
                    // Water shimmer phase.
                    shimmerPhase: randF() * Math.PI * 2,
                });
            }

            // ---- Plants in planters (hydrangeas + small bushes) ----
            const randP = this.rng(919);
            this.planters = [];
            for (let i = 0; i < 4; i++) {
                this.planters.push({
                    kind: i === 0 ? 'box' : (i === 3 ? 'box' : 'pot'),
                    flowerTone: randP(),
                    // Number of bloom puffs.
                    puffs: 5 + Math.floor(randP() * 5),
                    // Per-puff offsets for organic clustering.
                    puffOffsets: Array.from({ length: 8 }, () => ({
                        dx: (randP() - 0.5) * 22,
                        dy: -randP() * 12,
                        r: 4 + randP() * 3,
                        hue: randP() < 0.5 ? 'pink' : (randP() < 0.5 ? 'blue' : 'magenta'),
                    })),
                });
            }

            // ---- The proprietor figure standing near the door ----
            this.person = {
                // 0..1 sway phase.
                phase: 0,
                // Direction they face (-1 = left toward shop, +1 = right).
                facing: -1,
                // Occasional turn to face the other way.
                nextTurnMs: 12000 + Math.random() * 18000,
                // Head bob amplitude.
                bobAmp: 1,
            };

            // ---- Cat that occasionally walks through the alley ----
            this.cat = null;
            this.nextCatMs = 25000 + Math.random() * 35000;

            // ---- Moth fluttering around the streetlamp ----
            this.moth = {
                // Drift around the lamp on a noisy lissajous.
                t: 0,
                visible: true,
                nextToggleMs: 18000 + Math.random() * 18000,
            };

            // ---- Rain (sparse light drizzle — keeps the alley feeling damp) ----
            this.drizzle = [];
            for (let i = 0; i < 26; i++) {
                this.drizzle.push(this.makeDrizzle(false));
            }

            // ---- Window flicker (TV light from one window above) ----
            this.tvFlicker = { value: 0, target: 0, nextChangeMs: 240 };

            // ---- Lantern moths (decorative blink for tiny insects in light pool) ----
            this.gnats = [];
            for (let i = 0; i < 8; i++) {
                this.gnats.push({
                    phase: Math.random() * Math.PI * 2,
                    speed: 0.5 + Math.random() * 1.2,
                    orbitR: 4 + Math.random() * 16,
                    yOffset: (Math.random() - 0.5) * 18,
                });
            }

            // ---- Scooter wobble (very subtle — chain rattle from breeze) ----
            this.scooterPhase = 0;

            // ---- Vending machine glow phase (next-door property) ----
            this.vendingFlicker = { value: 1, nextMs: 500 };

            // ---- Layout cache (populated in resize) ----
            this._layout = null;
        }

        makeDrizzle(seedTop) {
            return {
                x: Math.random() * 1.05 - 0.025,
                y: seedTop ? Math.random() * -0.2 : Math.random(),
                len: 5 + Math.random() * 8,
                speed: 220 + Math.random() * 120,
                alpha: 0.08 + Math.random() * 0.16,
            };
        }

        resize(w, h) {
            super.resize(w, h);

            // Layout proportions — the fish shop occupies the central two-
            // thirds; a small vending alcove sits to its left and an alley
            // gap leads off to the right.
            this.groundY = h * 0.84;
            // Roofline of the 2-story building.
            this.roofY = h * 0.06;
            // Top of the awning (also the floor of the upper-story windows).
            this.awningTopY = h * 0.40;
            this.awningH = h * 0.06;
            this.awningBotY = this.awningTopY + this.awningH;

            // Storefront horizontal extents.
            this.shopLeft = w * 0.20;
            this.shopRight = w * 0.76;
            const sw = this.shopRight - this.shopLeft;

            // Upper floor (between roof and awning top).
            const upperTop = this.roofY + h * 0.04;
            const upperBot = this.awningTopY - 4;

            // Lower storefront (between awning bot and ground).
            const lowerTop = this.awningBotY + 2;
            const lowerBot = this.groundY;

            // Aquariums: left third of the storefront, two stacked tanks.
            const tanksW = sw * 0.30;
            const tanksLeft = this.shopLeft + sw * 0.04;
            const tanksRight = tanksLeft + tanksW;
            const tanksH = lowerBot - lowerTop - 18;
            const tankH = tanksH / 2;
            const tankTopY = lowerTop + 6;
            const tank2TopY = tankTopY + tankH;

            // Doorway: middle third.
            const doorW = sw * 0.22;
            const doorLeft = tanksRight + sw * 0.04;
            const doorRight = doorLeft + doorW;
            const doorTopY = lowerTop + 4;
            const doorBotY = lowerBot - 4;

            // Right pane: AC unit + window/grate.
            const rightLeft = doorRight + sw * 0.04;
            const rightRight = this.shopRight - sw * 0.04;

            // Vending machine to the left of shop.
            const vmW = Math.min(w * 0.05, 64);
            const vmH = (this.groundY - this.awningBotY) * 0.85;
            const vmX = this.shopLeft - vmW - 18;
            const vmY = this.groundY - vmH;

            // Streetlamp position — sits to the left of the vending machine,
            // with its arm reaching back toward the shop. Keeps the
            // composition's left edge anchored and lights the alley curb.
            const lampX = Math.max(20, vmX - 24);
            const lampY = h * 0.18;

            // Scooter — parked at the curb in the open stretch between the
            // door and the rightmost planter, in front of the AC vent panel.
            const scooterX = rightLeft + (rightRight - rightLeft) * 0.42;
            const scooterY = this.groundY - 2;

            // Person standing in the doorway entrance — visible in front of
            // the doorway's warm spill, where the proprietor would be.
            const personX = doorRight - doorW * 0.20;
            const personY = this.groundY - 2;

            // Planters along the curb — placed to flank, not block, the scooter.
            this._planterPositions = [
                { x: tanksLeft + tanksW * 0.18, y: this.groundY - 2, w: 48 },
                { x: tanksLeft + tanksW * 0.78, y: this.groundY - 2, w: 28 },
                { x: rightLeft + (rightRight - rightLeft) * 0.88, y: this.groundY - 2, w: 44 },
            ];

            this._layout = {
                sw, upperTop, upperBot, lowerTop, lowerBot,
                tanksLeft, tanksRight, tanksW, tanksH,
                tankTopY, tank2TopY, tankH,
                doorW, doorLeft, doorRight, doorTopY, doorBotY,
                rightLeft, rightRight,
                vmW, vmH, vmX, vmY,
                lampX, lampY,
                scooterX, scooterY,
                personX, personY,
            };
        }

        currentAtmo(t) {
            const cycle = (t / CYCLE_MS) % 1;
            const { a, b, k } = pickStop(SKY_STOPS, cycle);
            return {
                cycle,
                top: this.mixColor(a.top, b.top, k),
                horizon: this.mixColor(a.horizon, b.horizon, k),
                ambient: a.ambient + (b.ambient - a.ambient) * k,
            };
        }

        render(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const atmo = this.currentAtmo(t);

            // ---- Update TV flicker ----
            this.tvFlicker.nextChangeMs -= dt;
            if (this.tvFlicker.nextChangeMs <= 0) {
                this.tvFlicker.target = 0.4 + Math.random() * 0.6;
                this.tvFlicker.nextChangeMs = 120 + Math.random() * 300;
            }
            this.tvFlicker.value += (this.tvFlicker.target - this.tvFlicker.value) * Math.min(1, dt / 80);

            // ---- Update vending flicker (rare dropout) ----
            this.vendingFlicker.nextMs -= dt;
            if (this.vendingFlicker.nextMs <= 0) {
                this.vendingFlicker.value = Math.random() < 0.05 ? 0.55 : 1.0;
                this.vendingFlicker.nextMs = 180 + Math.random() * 320;
            }

            // ---- Update person facing turn ----
            this.person.phase += dt * 0.001;
            this.person.nextTurnMs -= dt;
            if (this.person.nextTurnMs <= 0) {
                this.person.facing *= -1;
                this.person.nextTurnMs = 12000 + Math.random() * 18000;
            }

            // ---- Update cat ----
            this.updateCat(dt);

            // ---- Update tank bubbles ----
            for (let i = 0; i < this.tanks.length; i++) {
                const tank = this.tanks[i];
                tank.shimmerPhase += dt * 0.001;
                tank.nextBubbleMs -= dt;
                if (tank.nextBubbleMs <= 0) {
                    tank.bubbles.push({
                        x: 0.06 + Math.random() * 0.08, // near left edge bubbler
                        y: 0.94,
                        r: 0.6 + Math.random() * 1.4,
                        speed: 0.25 + Math.random() * 0.30,
                        wobble: Math.random() * Math.PI * 2,
                    });
                    tank.nextBubbleMs = 240 + Math.random() * 800;
                }
                for (let j = tank.bubbles.length - 1; j >= 0; j--) {
                    const b = tank.bubbles[j];
                    b.y -= (b.speed * dt) / 1000;
                    b.wobble += dt * 0.004;
                    if (b.y < 0.04) tank.bubbles.splice(j, 1);
                }
            }

            // ---- Moth ----
            this.moth.t += dt * 0.001;
            this.moth.nextToggleMs -= dt;
            if (this.moth.nextToggleMs <= 0) {
                this.moth.visible = !this.moth.visible;
                this.moth.nextToggleMs = 16000 + Math.random() * 24000;
            }

            // ---- Scooter sway ----
            this.scooterPhase += dt * 0.0006;

            // ===========================================================
            //                       RENDER PASS
            // ===========================================================

            // 1) Sky
            this.drawSky(atmo);
            // 2) Stars
            this.drawStars(atmo, t);
            // 3) Distant rooftops
            this.drawFarRoofs(atmo);
            // 4) Power lines crossing sky
            this.drawPowerLines(atmo);
            // 5) Background alley walls extending outside the storefront
            this.drawBackgroundWalls(atmo);
            // 6) Vending machine on the left
            this.drawVendingMachine(t);
            // 7) The fish shop building (back walls + upstairs)
            this.drawBuilding(atmo, t);
            // 8) Upper-floor windows
            this.drawUpperWindows(t);
            // 9) Storefront — the rich detailed part
            this.drawAquariums(t);
            this.drawDoorway(t);
            this.drawRightPane(t);
            // 10) Awning + sign
            this.drawAwning();
            this.drawSignText();
            // 11) AC outdoor unit (right side)
            this.drawACUnit();
            // 12) Hanging shop lantern by the door
            this.drawHangingLantern(t);
            // 13) Curb / ground
            this.drawGround(atmo);
            // 14) Scooter (drawn before planters so a planter can sit in front)
            this.drawScooter();
            // 15) Person (in front of scooter — they're standing further forward)
            this.drawPerson(t);
            // 16) Planters + flowers (foreground curb objects)
            this.drawPlanters();
            // 17) Cat (passing through)
            if (this.cat) this.drawCat();
            // 18) Streetlamp (foreground left)
            this.drawStreetlamp(t);
            // 19) Light pool from streetlamp onto wet ground
            this.drawLightPool(atmo);
            // 20) Moth around streetlamp
            if (this.moth.visible) this.drawMoth();
            // 21) Drifting light gnats in light pool
            this.drawGnats(t);
            // 22) Drizzle
            this.drawDrizzle(t, dt);
            // 23) Foreground utility cables (subtle, sweeping across)
            this.drawForegroundCables(atmo);
            // 24) Vignette
            this.drawVignette();
        }

        // =========================================================
        // SKY + DISTANT
        // =========================================================
        drawSky(atmo) {
            const c = this.ctx;
            const grad = c.createLinearGradient(0, 0, 0, this.groundY);
            grad.addColorStop(0, atmo.top);
            grad.addColorStop(1, atmo.horizon);
            c.fillStyle = grad;
            c.fillRect(0, 0, this.width, this.groundY);
        }

        drawStars(atmo, t) {
            const c = this.ctx;
            const w = this.width;
            for (let i = 0; i < this.stars.length; i++) {
                const s = this.stars[i];
                const a = s.mag * (0.55 + 0.45 * Math.sin(t * 0.0018 + s.phase));
                c.fillStyle = `rgba(220, 230, 255, ${a * 0.5})`;
                c.fillRect((s.x * w) | 0, (s.y * this.roofY) | 0, 1, 1);
            }
        }

        drawFarRoofs(atmo) {
            const c = this.ctx;
            const w = this.width;
            const baseY = this.awningTopY - 2;
            for (let i = 0; i < this.farRoofs.length; i++) {
                const r = this.farRoofs[i];
                const x = r.x * w;
                const rw = r.w * w;
                const rh = r.h * this.height;
                c.fillStyle = '#060a18';
                c.fillRect(x, baseY - rh, rw, rh);
                if (r.antenna) {
                    c.fillStyle = '#040814';
                    c.fillRect(x + rw * 0.5, baseY - rh - 7, 1, 7);
                    c.fillRect(x + rw * 0.5 - 2, baseY - rh - 7, 4, 1);
                }
                if (r.pole) {
                    c.fillStyle = '#040814';
                    c.fillRect(x + rw * 0.2, baseY - rh - 5, 1, 5);
                }
            }
        }

        drawPowerLines(atmo) {
            const c = this.ctx;
            const w = this.width;
            c.save();
            c.strokeStyle = 'rgba(4, 6, 14, 0.85)';
            c.lineWidth = 0.9;
            // Three parallel cables sweeping from upper-left to upper-right with sag.
            const yBase = this.awningTopY - 80;
            for (let k = 0; k < 3; k++) {
                const yOff = (k - 1) * 4;
                c.beginPath();
                c.moveTo(-10, yBase + yOff);
                c.quadraticCurveTo(w * 0.5, yBase + yOff + 18, w + 10, yBase + yOff - 6);
                c.stroke();
            }
            // A second set of cables, slightly lower.
            const yBase2 = this.awningTopY - 48;
            c.strokeStyle = 'rgba(6, 8, 16, 0.7)';
            for (let k = 0; k < 2; k++) {
                const yOff = (k - 0.5) * 3;
                c.beginPath();
                c.moveTo(-10, yBase2 + yOff + 4);
                c.quadraticCurveTo(w * 0.4, yBase2 + yOff + 22, w + 10, yBase2 + yOff);
                c.stroke();
            }
            c.restore();
        }

        // =========================================================
        // BUILDING + BACKDROP
        // =========================================================
        drawBackgroundWalls(atmo) {
            const c = this.ctx;
            const w = this.width;
            // Adjacent buildings on either side of the fish shop. Dark walls
            // that suggest the alley extends. Slightly lighter on top so it
            // reads as facade rather than sky shadow.
            const leftW = this.shopLeft;
            const rightW = w - this.shopRight;
            // Left wall.
            c.fillStyle = '#0a1124';
            c.fillRect(0, this.roofY, leftW, this.groundY - this.roofY);
            // Right wall.
            c.fillRect(this.shopRight, this.roofY, rightW, this.groundY - this.roofY);
            // Vertical seams (paneling).
            c.fillStyle = 'rgba(0, 0, 0, 0.25)';
            for (let k = 1; k < 6; k++) {
                const sx = (k / 6) * leftW;
                c.fillRect(sx | 0, this.roofY, 1, this.groundY - this.roofY);
            }
            for (let k = 1; k < 5; k++) {
                const sx = this.shopRight + (k / 5) * rightW;
                c.fillRect(sx | 0, this.roofY, 1, this.groundY - this.roofY);
            }
            // A few dim windows in the right-side neighbor (apartment).
            const seedDim = [
                { x: this.shopRight + rightW * 0.18, y: this.awningTopY - 80 },
                { x: this.shopRight + rightW * 0.46, y: this.awningTopY - 110 },
                { x: this.shopRight + rightW * 0.66, y: this.awningTopY - 60 },
            ];
            for (const d of seedDim) {
                c.fillStyle = 'rgba(255, 210, 140, 0.10)';
                c.fillRect(d.x, d.y, 6, 4);
                c.fillStyle = 'rgba(60, 70, 90, 0.4)';
                c.fillRect(d.x - 0.5, d.y - 0.5, 7, 1);
            }
            // A tiny back-alley AC vent box on the right wall.
            c.fillStyle = '#1a2030';
            c.fillRect(this.shopRight + 8, this.groundY - 36, 18, 14);
            c.fillStyle = '#2a3142';
            c.fillRect(this.shopRight + 10, this.groundY - 34, 14, 4);
            c.fillStyle = '#060a16';
            c.fillRect(this.shopRight + 11, this.groundY - 34, 12, 3);
        }

        drawBuilding(atmo, t) {
            const c = this.ctx;
            const L = this._layout;

            // Building body — dark blue-grey facade.
            c.fillStyle = '#152040';
            c.fillRect(this.shopLeft, this.roofY, L.sw, this.groundY - this.roofY);

            // Upper floor wall has a slight texture band.
            c.fillStyle = '#101a36';
            c.fillRect(this.shopLeft, this.roofY, L.sw, L.upperBot - this.roofY);

            // Roofline (slightly tilted dark line + slight overhang).
            c.fillStyle = '#070b1c';
            c.fillRect(this.shopLeft - 4, this.roofY - 4, L.sw + 8, 4);
            c.fillStyle = '#1a2440';
            c.fillRect(this.shopLeft - 6, this.roofY - 2, L.sw + 12, 2);

            // Wall seams (vertical paneling for the storefront-level wall).
            c.fillStyle = 'rgba(0, 0, 0, 0.30)';
            const seamCount = 8;
            for (let k = 1; k < seamCount; k++) {
                const sx = this.shopLeft + (k / seamCount) * L.sw;
                c.fillRect(sx | 0, L.upperBot + 2, 1, L.lowerBot - L.upperBot - 4);
            }

            // Subtle horizontal joist where upper floor meets the awning area.
            c.fillStyle = '#060a18';
            c.fillRect(this.shopLeft, L.upperBot - 1, L.sw, 2);
        }

        drawUpperWindows(t) {
            const c = this.ctx;
            const L = this._layout;
            const upperRowH = L.upperBot - L.upperTop;
            const winW = L.sw * 0.18;
            const winH = upperRowH * 0.55;
            const winSpacing = L.sw * 0.05;
            const totalWinW = winW * 4 + winSpacing * 3;
            const startX = this.shopLeft + (L.sw - totalWinW) * 0.5;
            const winY = L.upperTop + (upperRowH - winH) * 0.5;

            for (let i = 0; i < 4; i++) {
                const wx = startX + i * (winW + winSpacing);
                const win = this.upperWindows[i];
                // Frame.
                c.fillStyle = '#060a16';
                c.fillRect(wx - 1, winY - 1, winW + 2, winH + 2);
                // Pane background — deep night reflection.
                c.fillStyle = '#080c1a';
                c.fillRect(wx, winY, winW, winH);
                // If lit, draw warm interior glow with shifting brightness.
                if (win.lit) {
                    let brightness = 1;
                    if (win.flicker) {
                        brightness = 0.7 + 0.3 * Math.sin(t * 0.003 + win.flickerPhase);
                    }
                    if (win.tv) {
                        // Cool flickering TV light.
                        const tvShift = (this.tvFlicker.value);
                        c.fillStyle = `rgba(150, 180, 220, ${0.55 * brightness * tvShift})`;
                        c.fillRect(wx + 1, winY + 1, winW - 2, winH - 2);
                    } else {
                        c.fillStyle = `rgba(255, 210, 140, ${0.42 * brightness})`;
                        c.fillRect(wx + 1, winY + 1, winW - 2, winH - 2);
                    }
                    // A silhouette curtain edge.
                    c.fillStyle = 'rgba(20, 18, 30, 0.6)';
                    c.fillRect(wx + 1, winY + 1, 2, winH - 2);
                    c.fillRect(wx + winW - 3, winY + 1, 2, winH - 2);
                }
                // Window cross-bar.
                c.fillStyle = '#0a0e1c';
                c.fillRect(wx + winW * 0.5 - 0.5, winY, 1, winH);
                c.fillRect(wx, winY + winH * 0.5 - 0.5, winW, 1);
                // Soft outer glow if lit.
                if (win.lit) {
                    c.save();
                    c.globalCompositeOperation = 'lighter';
                    const grad = c.createRadialGradient(
                        wx + winW * 0.5, winY + winH * 0.5, 0,
                        wx + winW * 0.5, winY + winH * 0.5, winW * 0.9
                    );
                    grad.addColorStop(0, win.tv ? 'rgba(120, 160, 220, 0.16)' : 'rgba(255, 210, 140, 0.13)');
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                    c.fillStyle = grad;
                    c.fillRect(wx - winW * 0.3, winY - winH * 0.3, winW * 1.6, winH * 1.6);
                    c.restore();
                }
            }
        }

        // =========================================================
        // STOREFRONT: AQUARIUMS
        // =========================================================
        drawAquariums(t) {
            const c = this.ctx;
            const L = this._layout;
            const { tanksLeft, tanksW, tankH, tankTopY, tank2TopY } = L;

            // Outer dark frame around the two tanks together.
            c.fillStyle = '#040810';
            c.fillRect(tanksLeft - 4, tankTopY - 4, tanksW + 8, tankH * 2 + 8);

            // Each tank.
            for (let i = 0; i < 2; i++) {
                const tankY = i === 0 ? tankTopY : tank2TopY;
                const tank = this.tanks[i];
                this.drawSingleTank(tanksLeft, tankY, tanksW, tankH, tank, t);
            }

            // Brushed-metal trim between tanks.
            c.fillStyle = '#2a3050';
            c.fillRect(tanksLeft - 2, tank2TopY - 2, tanksW + 4, 3);
            // Top trim with subtle highlight.
            c.fillStyle = '#2a3050';
            c.fillRect(tanksLeft - 4, tankTopY - 4, tanksW + 8, 3);
            c.fillStyle = '#404868';
            c.fillRect(tanksLeft - 4, tankTopY - 4, tanksW + 8, 1);
            // Bottom trim.
            c.fillStyle = '#1a2038';
            c.fillRect(tanksLeft - 4, tankTopY + tankH * 2 + 1, tanksW + 8, 3);
        }

        drawSingleTank(x, y, w, h, tank, t) {
            const c = this.ctx;
            // Water gradient — bright cyan/teal in middle, deeper at edges.
            const grad = c.createLinearGradient(x, y, x, y + h);
            grad.addColorStop(0, '#2c8cd0');
            grad.addColorStop(0.5, '#3aa8e4');
            grad.addColorStop(1, '#1a5c8a');
            c.fillStyle = grad;
            c.fillRect(x, y, w, h);

            // Caustic light bands on the bottom — shift over time.
            c.save();
            c.globalCompositeOperation = 'lighter';
            for (let k = 0; k < 4; k++) {
                const phase = tank.shimmerPhase + k * 0.7;
                const cx = x + w * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(phase)));
                const cy = y + h * 0.92;
                const cw = w * 0.4;
                const ch = 4;
                const g = c.createRadialGradient(cx, cy, 0, cx, cy, cw);
                g.addColorStop(0, 'rgba(180, 230, 255, 0.20)');
                g.addColorStop(1, 'rgba(180, 230, 255, 0)');
                c.fillStyle = g;
                c.fillRect(cx - cw, cy - ch, cw * 2, ch * 2);
            }
            c.restore();

            // Aquarium gravel / sand at the bottom.
            const gravelH = h * 0.10;
            c.fillStyle = '#0a3050';
            c.fillRect(x, y + h - gravelH, w, gravelH);
            // A few pebble dots in the gravel.
            for (let k = 0; k < 8; k++) {
                c.fillStyle = 'rgba(60, 100, 140, 0.6)';
                c.fillRect(x + ((k * 13 + 7) % w), y + h - gravelH + 2 + (k % 3), 2, 2);
            }

            // Plants in the back — vertical undulating lines.
            for (let p = 0; p < 4; p++) {
                const px = x + w * (0.18 + p * 0.18);
                const baseY = y + h - gravelH;
                const plantH = h * (0.35 + (p % 2) * 0.12);
                c.strokeStyle = `rgba(10, 60, 50, 0.85)`;
                c.lineWidth = 2;
                c.beginPath();
                c.moveTo(px, baseY);
                const sway = Math.sin(t * 0.001 + p) * 2;
                c.bezierCurveTo(
                    px + sway, baseY - plantH * 0.4,
                    px - sway, baseY - plantH * 0.7,
                    px + sway * 0.5, baseY - plantH
                );
                c.stroke();
            }

            // Bubbles rising from left side.
            for (const b of tank.bubbles) {
                const bx = x + b.x * w + Math.sin(b.wobble) * 1.5;
                const by = y + b.y * h;
                c.fillStyle = 'rgba(220, 240, 255, 0.85)';
                c.beginPath();
                c.arc(bx, by, b.r, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = 'rgba(255, 255, 255, 0.9)';
                c.fillRect(bx - 0.4, by - 0.4, 0.8, 0.8);
            }

            // Fish.
            for (const fish of tank.fish) {
                this.drawFish(x, y, w, h, fish, t);
            }

            // Tank reflection sheen on the glass front (subtle vertical bands).
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.fillStyle = 'rgba(255, 255, 255, 0.04)';
            c.fillRect(x + 2, y + 2, w * 0.3, h - 4);
            c.fillStyle = 'rgba(255, 255, 255, 0.02)';
            c.fillRect(x + w * 0.6, y + 2, w * 0.18, h - 4);
            c.restore();

            // Top water-line highlight.
            c.fillStyle = 'rgba(200, 240, 255, 0.45)';
            c.fillRect(x, y + 1, w, 1);
            // Dim top reflection on water surface.
            c.fillStyle = 'rgba(80, 160, 200, 0.45)';
            c.fillRect(x, y + 2, w, 1);
        }

        drawFish(tx, ty, tw, th, fish, t) {
            const c = this.ctx;
            // Update position.
            fish.x += (fish.dir * fish.speed * 0.016);
            if (fish.x > 1) { fish.x = 1; fish.dir = -1; }
            if (fish.x < 0) { fish.x = 0; fish.dir = 1; }
            fish.y = this.clamp(fish.baseY + Math.sin(t * 0.0009 + fish.phase) * 0.06, 0.12, 0.86);

            const fx = tx + fish.x * tw;
            const fy = ty + fish.y * th;
            const dir = fish.dir;
            const sz = fish.size;
            const wig = Math.sin(t * 0.012 + fish.phase) * 0.6;

            c.save();
            c.translate(fx, fy);
            c.scale(dir, 1);

            // Body color — silhouette colors derived from type/hue.
            let bodyCol;
            let accentCol = '#fff';
            if (fish.type === 'koi') {
                // White koi with red/orange splotches.
                bodyCol = '#f0e0d0';
                accentCol = fish.hue === 20 ? '#d04830' : '#e88040';
            } else if (fish.type === 'goldfish') {
                bodyCol = '#e0883a';
                accentCol = '#f8c060';
            } else if (fish.type === 'tetra') {
                // Small neon — silver body, blue stripe.
                bodyCol = '#c0c8d0';
                accentCol = '#4080d0';
            } else if (fish.type === 'angel') {
                bodyCol = '#102030';
                accentCol = '#f0f0f0';
            }

            // Body shape — simple ellipse-ish via fillRect blocks.
            if (fish.type === 'tetra') {
                c.fillStyle = bodyCol;
                c.fillRect(-3 * sz, -1 * sz, 5 * sz, 1.6 * sz);
                c.fillStyle = accentCol;
                c.fillRect(-3 * sz, -0.2 * sz, 5 * sz, 0.6 * sz);
                // Tail.
                c.fillStyle = bodyCol;
                c.fillRect(-4.2 * sz + wig, -0.6 * sz, 1.4 * sz, 1 * sz);
                // Eye.
                c.fillStyle = '#000';
                c.fillRect(1.5 * sz, -0.4 * sz, 0.6 * sz, 0.6 * sz);
            } else if (fish.type === 'angel') {
                // Flat tall body.
                c.fillStyle = bodyCol;
                c.fillRect(-2 * sz, -2.5 * sz, 4 * sz, 5 * sz);
                // Vertical stripes (white).
                c.fillStyle = accentCol;
                c.fillRect(-1 * sz, -2.5 * sz, 0.7 * sz, 5 * sz);
                c.fillRect(0.4 * sz, -2.5 * sz, 0.7 * sz, 5 * sz);
                // Fins (top/bottom).
                c.fillStyle = bodyCol;
                c.fillRect(-1 * sz, -3.6 * sz, 2 * sz, 1 * sz);
                c.fillRect(-1 * sz, 2.6 * sz, 2 * sz, 1 * sz);
                // Tail.
                c.fillRect(-3.4 * sz + wig, -0.8 * sz, 1.6 * sz, 1.6 * sz);
                // Eye.
                c.fillStyle = '#fff';
                c.fillRect(1 * sz, -1.2 * sz, 0.7 * sz, 0.7 * sz);
                c.fillStyle = '#000';
                c.fillRect(1.2 * sz, -1.0 * sz, 0.4 * sz, 0.4 * sz);
            } else {
                // Koi / goldfish — long body with patches.
                c.fillStyle = bodyCol;
                c.fillRect(-4 * sz, -1.4 * sz, 7 * sz, 2.4 * sz);
                // Head taper.
                c.fillRect(3 * sz, -1.0 * sz, 1.2 * sz, 1.8 * sz);
                // Splotches.
                c.fillStyle = accentCol;
                c.fillRect(-2 * sz, -1.4 * sz, 1.8 * sz, 1.2 * sz);
                c.fillRect(0.6 * sz, 0 * sz, 1.6 * sz, 1.0 * sz);
                // Tail fan.
                c.fillStyle = bodyCol;
                c.fillRect(-5.6 * sz + wig, -1.8 * sz, 1.6 * sz, 3.6 * sz);
                // Fins.
                c.fillRect(-1 * sz, 1 * sz, 1.4 * sz, 1 * sz);
                c.fillRect(-1.6 * sz, -2 * sz, 1 * sz, 0.8 * sz);
                // Eye.
                c.fillStyle = '#000';
                c.fillRect(3.4 * sz, -0.5 * sz, 0.7 * sz, 0.7 * sz);
            }

            c.restore();
        }

        // =========================================================
        // STOREFRONT: DOORWAY
        // =========================================================
        drawDoorway(t) {
            const c = this.ctx;
            const L = this._layout;
            const { doorLeft, doorRight, doorTopY, doorBotY, doorW } = L;

            // Doorway frame (dark recess).
            c.fillStyle = '#070a18';
            c.fillRect(doorLeft - 3, doorTopY - 3, doorW + 6, doorBotY - doorTopY + 6);

            // Inside-doorway glow — warm light spilling from the shop.
            const grad = c.createLinearGradient(doorLeft, doorTopY, doorLeft, doorBotY);
            grad.addColorStop(0, '#3c5878');
            grad.addColorStop(0.6, '#1a2c4a');
            grad.addColorStop(1, '#0a1024');
            c.fillStyle = grad;
            c.fillRect(doorLeft, doorTopY, doorW, doorBotY - doorTopY);

            // Hint of an interior figure / counter silhouette.
            c.fillStyle = 'rgba(8, 12, 24, 0.85)';
            c.fillRect(doorLeft + 4, doorTopY + 30, doorW - 8, doorBotY - doorTopY - 34);

            // Sliding door track at bottom.
            c.fillStyle = '#4a5060';
            c.fillRect(doorLeft - 3, doorBotY - 3, doorW + 6, 3);

            // Noren (split fabric curtain) hanging from the top of the doorway.
            this.drawNoren(doorLeft, doorTopY, doorW, t);

            // Door-side menu/notice posters.
            // Left poster (red with kanji bar).
            c.fillStyle = '#cc3a2a';
            c.fillRect(doorLeft - 12, doorTopY + 10, 10, 26);
            c.fillStyle = '#fff';
            c.fillRect(doorLeft - 11, doorTopY + 14, 8, 1.5);
            c.fillRect(doorLeft - 11, doorTopY + 20, 8, 1.5);
            c.fillRect(doorLeft - 11, doorTopY + 26, 8, 1.5);
            // Right poster (blue with white text).
            c.fillStyle = '#3a78a8';
            c.fillRect(doorRight + 2, doorTopY + 8, 12, 30);
            c.fillStyle = '#fff';
            c.fillRect(doorRight + 4, doorTopY + 12, 8, 1.5);
            c.fillRect(doorRight + 4, doorTopY + 18, 6, 1);
            c.fillRect(doorRight + 4, doorTopY + 22, 8, 1.5);
            c.fillRect(doorRight + 4, doorTopY + 28, 5, 1);
        }

        drawNoren(doorLeft, doorTopY, doorW, t) {
            const c = this.ctx;
            // Noren is a horizontal cloth banner split into 3 vertical panels.
            const norenH = 40;
            const norenY = doorTopY + 4;
            const panels = 3;
            const panelW = doorW / panels;
            const sway = Math.sin(t * 0.001) * 1.5;
            // Top hanging bar.
            c.fillStyle = '#1a1a22';
            c.fillRect(doorLeft - 2, norenY - 2, doorW + 4, 2);
            // Panels.
            for (let i = 0; i < panels; i++) {
                const px = doorLeft + i * panelW + 1;
                const pw = panelW - 2;
                const localSway = sway * (i === 1 ? 0.4 : 1.0);
                // Panel base (dark blue indigo).
                c.fillStyle = '#1a3a5e';
                c.fillRect(px + localSway, norenY, pw, norenH);
                // Slight side darker fold.
                c.fillStyle = '#0a2244';
                c.fillRect(px + localSway, norenY, 1, norenH);
                c.fillRect(px + pw - 1 + localSway, norenY, 1, norenH);
                // Kanji glyph (single character) painted in white on each panel.
                c.save();
                c.font = "700 12px 'Yu Gothic UI', 'Meiryo', sans-serif";
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillStyle = '#f0e8d0';
                const glyphs = ['観', '魚', '店'];
                c.fillText(glyphs[i], px + pw * 0.5 + localSway, norenY + 14);
                c.restore();
            }
            // Bottom edge fringe (small jagged line).
            c.fillStyle = '#0a2244';
            for (let i = 0; i < panels * 6; i++) {
                const fx = doorLeft + (i / (panels * 6)) * doorW;
                const fh = (i % 2 === 0) ? 2 : 3;
                c.fillRect(fx + sway * 0.4, norenY + norenH, 1.5, fh);
            }
        }

        // =========================================================
        // STOREFRONT: RIGHT PANE
        // =========================================================
        drawRightPane(t) {
            const c = this.ctx;
            const L = this._layout;
            const { rightLeft, rightRight, lowerTop, lowerBot } = L;
            const paneW = rightRight - rightLeft;
            const paneH = lowerBot - lowerTop;

            // Dark wall behind right pane.
            c.fillStyle = '#0a1024';
            c.fillRect(rightLeft, lowerTop, paneW, paneH);

            // Right pane has a small window with a louvered grate (vent for the AC).
            const grateW = paneW * 0.5;
            const grateH = paneH * 0.35;
            const grateX = rightLeft + (paneW - grateW) * 0.5;
            const grateY = lowerTop + 4;
            c.fillStyle = '#1a2238';
            c.fillRect(grateX, grateY, grateW, grateH);
            c.fillStyle = '#080c18';
            for (let i = 0; i < 5; i++) {
                const ly = grateY + 3 + i * ((grateH - 4) / 5);
                c.fillRect(grateX + 2, ly, grateW - 4, 1.5);
            }
            // Window frame.
            c.fillStyle = '#2a3450';
            c.fillRect(grateX - 1, grateY - 1, grateW + 2, 1);
            c.fillRect(grateX - 1, grateY + grateH, grateW + 2, 1);
            c.fillRect(grateX - 1, grateY - 1, 1, grateH + 2);
            c.fillRect(grateX + grateW, grateY - 1, 1, grateH + 2);

            // Below the window: a small posted notice / business hours sign.
            const noticeW = paneW * 0.4;
            const noticeH = 16;
            const noticeX = rightLeft + (paneW - noticeW) * 0.5;
            const noticeY = grateY + grateH + 8;
            c.fillStyle = '#e8e0c8';
            c.fillRect(noticeX, noticeY, noticeW, noticeH);
            c.fillStyle = '#1a1a22';
            c.fillRect(noticeX + 2, noticeY + 2, noticeW - 4, 1.5);
            c.fillRect(noticeX + 2, noticeY + 6, noticeW - 8, 1.2);
            c.fillRect(noticeX + 2, noticeY + 10, noticeW - 6, 1.2);
            c.fillRect(noticeX + 2, noticeY + 14, noticeW - 4, 1);
        }

        // =========================================================
        // AWNING + SIGN
        // =========================================================
        drawAwning() {
            const c = this.ctx;
            const L = this._layout;

            // Awning main body — a bright cerulean blue panel that runs across
            // the entire shop width.
            const awnTop = this.awningTopY;
            const awnH = this.awningH;

            // Awning shadow underneath (small drop shadow on storefront).
            c.fillStyle = 'rgba(0, 0, 0, 0.4)';
            c.fillRect(this.shopLeft - 8, awnTop + awnH, L.sw + 16, 4);

            // Trim above (dark band).
            c.fillStyle = '#0a1830';
            c.fillRect(this.shopLeft - 8, awnTop - 3, L.sw + 16, 3);

            // Main awning panel.
            const grad = this.ctx.createLinearGradient(0, awnTop, 0, awnTop + awnH);
            grad.addColorStop(0, '#3aa0e0');
            grad.addColorStop(0.6, '#287cbc');
            grad.addColorStop(1, '#1c5a98');
            c.fillStyle = grad;
            c.fillRect(this.shopLeft - 8, awnTop, L.sw + 16, awnH);

            // Highlight band along the top.
            c.fillStyle = 'rgba(180, 220, 250, 0.40)';
            c.fillRect(this.shopLeft - 8, awnTop + 1, L.sw + 16, 1.5);

            // Scalloped bottom edge — small semi-circles repeating across.
            const scallopR = awnH * 0.20;
            const scallopY = awnTop + awnH;
            const totalAwnW = L.sw + 16;
            const scallopCount = Math.floor(totalAwnW / (scallopR * 2));
            const scallopActualR = totalAwnW / (scallopCount * 2);
            c.fillStyle = '#1c5a98';
            for (let i = 0; i < scallopCount; i++) {
                const sx = this.shopLeft - 8 + scallopActualR + i * scallopActualR * 2;
                c.beginPath();
                c.arc(sx, scallopY, scallopActualR, 0, Math.PI);
                c.fill();
            }
            // Highlight on each scallop.
            c.fillStyle = 'rgba(140, 200, 240, 0.5)';
            for (let i = 0; i < scallopCount; i++) {
                const sx = this.shopLeft - 8 + scallopActualR + i * scallopActualR * 2;
                c.fillRect(sx - scallopActualR * 0.6, scallopY + 1, scallopActualR * 0.4, 1);
            }

            // Support pole / corner edges.
            c.fillStyle = '#0a1830';
            c.fillRect(this.shopLeft - 8, awnTop, 2, awnH);
            c.fillRect(this.shopRight + 6, awnTop, 2, awnH);
        }

        drawSignText() {
            const c = this.ctx;
            const L = this._layout;
            const awnTop = this.awningTopY;
            const awnH = this.awningH;

            c.save();
            c.textBaseline = 'middle';

            // Main kanji title.
            c.font = FONT_SIGN;
            c.fillStyle = '#f0f4fc';
            c.textAlign = 'left';
            const titleX = this.shopLeft + 8;
            const titleY = awnTop + awnH * 0.42;
            // Subtle text shadow.
            c.fillStyle = 'rgba(0, 20, 40, 0.55)';
            c.fillText(SHOP_NAME_KANA, titleX + 1, titleY + 1);
            c.fillStyle = '#f0f4fc';
            c.fillText(SHOP_NAME_KANA, titleX, titleY);

            // Sub-line (telephone).
            c.font = FONT_SIGN_SUB;
            c.fillStyle = '#c8dceb';
            c.fillText(SHOP_TEL, titleX, awnTop + awnH * 0.78);

            c.restore();
        }

        // =========================================================
        // AC OUTDOOR UNIT
        // =========================================================
        drawACUnit() {
            const c = this.ctx;
            const L = this._layout;
            // Mounted on the upper-right wall above the awning right corner.
            const acW = L.sw * 0.10;
            const acH = acW * 0.55;
            const acX = this.shopRight - acW - 4;
            const acY = this.awningTopY - acH - 6;
            // Backing / shadow.
            c.fillStyle = '#040810';
            c.fillRect(acX - 2, acY + 1, acW + 4, acH);
            // Main body.
            c.fillStyle = '#d8d4c8';
            c.fillRect(acX, acY, acW, acH);
            // Front grille.
            c.fillStyle = '#1a1e26';
            c.fillRect(acX + 2, acY + 4, acW - 4, acH - 8);
            // Fan opening — a circle suggested with concentric rings.
            const fanCx = acX + acW * 0.5;
            const fanCy = acY + acH * 0.5;
            const fanR = Math.min(acW, acH) * 0.3;
            c.strokeStyle = '#2a3040';
            c.lineWidth = 1;
            c.beginPath();
            c.arc(fanCx, fanCy, fanR, 0, Math.PI * 2);
            c.stroke();
            c.beginPath();
            c.arc(fanCx, fanCy, fanR * 0.7, 0, Math.PI * 2);
            c.stroke();
            // Vertical grille lines.
            for (let i = 0; i < 7; i++) {
                const lx = acX + 4 + i * ((acW - 8) / 7);
                if (Math.abs(lx - fanCx) < fanR * 0.7) continue;
                c.fillStyle = 'rgba(50, 60, 80, 0.6)';
                c.fillRect(lx, acY + 4, 0.7, acH - 8);
            }
            // Mounting bracket.
            c.fillStyle = '#3a3530';
            c.fillRect(acX - 3, acY + acH - 4, 3, 2);
            c.fillRect(acX + acW, acY + acH - 4, 3, 2);
            // Drip line dangling.
            c.fillStyle = '#2a2a2a';
            c.fillRect(acX + acW * 0.85, acY + acH, 1, 14);
        }

        // =========================================================
        // HANGING LANTERN
        // =========================================================
        drawHangingLantern(t) {
            const c = this.ctx;
            const L = this._layout;
            // Hanging from the awning above the doorway.
            const lx = L.doorLeft + L.doorW * 0.5;
            const sway = Math.sin(t * 0.0007) * 1.2;
            const cordTop = this.awningBotY + 2;
            const lanternTop = cordTop + 12;
            const lanternH = 18;
            const lanternW = 14;
            // Cord.
            c.fillStyle = '#1a1010';
            c.fillRect(lx - 0.5 + sway * 0.3, cordTop, 1, lanternTop - cordTop);
            // Lantern body — paper red.
            const lanX = lx - lanternW * 0.5 + sway;
            c.fillStyle = '#1a0808';
            c.fillRect(lanX - 1, lanternTop - 1, lanternW + 2, lanternH + 2);
            // Glow body — radial gradient inside.
            const innerGrad = c.createLinearGradient(0, lanternTop, 0, lanternTop + lanternH);
            innerGrad.addColorStop(0, '#dc4030');
            innerGrad.addColorStop(0.5, '#f06040');
            innerGrad.addColorStop(1, '#a02818');
            c.fillStyle = innerGrad;
            c.fillRect(lanX, lanternTop, lanternW, lanternH);
            // Vertical struts.
            c.fillStyle = '#601810';
            for (let k = 0; k < 3; k++) {
                c.fillRect(lanX + 1 + k * (lanternW / 3), lanternTop, 1, lanternH);
            }
            // Top + bottom caps.
            c.fillStyle = '#1a1010';
            c.fillRect(lanX - 1, lanternTop - 2, lanternW + 2, 2);
            c.fillRect(lanX - 1, lanternTop + lanternH, lanternW + 2, 2);
            // White kanji on the lantern (single character).
            c.save();
            c.font = "700 8px 'Yu Gothic UI', 'Meiryo', sans-serif";
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillStyle = '#fff0d0';
            c.fillText('鯉', lanX + lanternW * 0.5, lanternTop + lanternH * 0.5);
            c.restore();
            // Soft glow halo.
            c.save();
            c.globalCompositeOperation = 'lighter';
            const halo = c.createRadialGradient(lx + sway, lanternTop + lanternH * 0.5, 0, lx + sway, lanternTop + lanternH * 0.5, 40);
            halo.addColorStop(0, 'rgba(255, 140, 100, 0.40)');
            halo.addColorStop(0.5, 'rgba(255, 100, 80, 0.15)');
            halo.addColorStop(1, 'rgba(255, 80, 60, 0)');
            c.fillStyle = halo;
            c.fillRect(lx + sway - 40, lanternTop - 8, 80, lanternH + 24);
            c.restore();
        }

        // =========================================================
        // GROUND + PLANTERS + SCOOTER + PERSON
        // =========================================================
        drawGround(atmo) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            // Wet pavement gradient.
            const grad = c.createLinearGradient(0, this.groundY, 0, h);
            grad.addColorStop(0, '#0a0e1a');
            grad.addColorStop(0.4, '#0e1424');
            grad.addColorStop(1, '#04080f');
            c.fillStyle = grad;
            c.fillRect(0, this.groundY, w, h - this.groundY);
            // Curb edge — slight highlight where curb meets road.
            c.fillStyle = 'rgba(60, 80, 110, 0.30)';
            c.fillRect(0, this.groundY, w, 1);
            // Subtle vertical reflections under the storefront (lit windows reflecting).
            c.save();
            c.globalCompositeOperation = 'lighter';
            // Aquarium reflection — cyan band.
            const L = this._layout;
            const aqRefl = c.createLinearGradient(0, this.groundY, 0, h);
            aqRefl.addColorStop(0, 'rgba(60, 160, 220, 0.18)');
            aqRefl.addColorStop(1, 'rgba(60, 160, 220, 0)');
            c.fillStyle = aqRefl;
            c.fillRect(L.tanksLeft - 4, this.groundY, L.tanksW + 8, h - this.groundY);
            // Awning blue glow reflection (mild, full width).
            const awnRefl = c.createLinearGradient(0, this.groundY, 0, this.groundY + 60);
            awnRefl.addColorStop(0, 'rgba(60, 140, 200, 0.08)');
            awnRefl.addColorStop(1, 'rgba(60, 140, 200, 0)');
            c.fillStyle = awnRefl;
            c.fillRect(this.shopLeft - 8, this.groundY, L.sw + 16, 60);
            // Doorway warm spill.
            const doorRefl = c.createLinearGradient(0, this.groundY, 0, this.groundY + 36);
            doorRefl.addColorStop(0, 'rgba(220, 160, 120, 0.10)');
            doorRefl.addColorStop(1, 'rgba(220, 160, 120, 0)');
            c.fillStyle = doorRefl;
            c.fillRect(L.doorLeft, this.groundY, L.doorW, 36);
            c.restore();

            // Some tiny pavement cracks/scuffs.
            c.fillStyle = 'rgba(0, 0, 0, 0.35)';
            const crackSeeds = [
                { x: 0.12, y: 0.92, w: 0.04 },
                { x: 0.42, y: 0.94, w: 0.06 },
                { x: 0.68, y: 0.92, w: 0.05 },
                { x: 0.88, y: 0.95, w: 0.07 },
            ];
            for (const cr of crackSeeds) {
                c.fillRect(cr.x * w, cr.y * h, cr.w * w, 0.6);
            }
        }

        drawPlanters() {
            const c = this.ctx;
            for (const planter of this._planterPositions) {
                const { x, y, w } = planter;
                // Planter box.
                const pH = 14;
                const pW = w;
                const px = x - pW * 0.5;
                const py = y - pH;
                c.fillStyle = '#5a4838';
                c.fillRect(px, py, pW, pH);
                // Wood grain lines.
                c.fillStyle = '#3a2c20';
                c.fillRect(px, py + pH * 0.3, pW, 1);
                c.fillRect(px, py + pH * 0.6, pW, 1);
                // Soil top.
                c.fillStyle = '#2a1c14';
                c.fillRect(px, py, pW, 2);
                // Flower puffs above.
                const blooms = pW > 35 ? 7 : 4;
                for (let i = 0; i < blooms; i++) {
                    const bx = px + 4 + (i / Math.max(1, blooms - 1)) * (pW - 8);
                    const by = py - 4 - (i % 2) * 2;
                    // Cluster of 5 small fillRects.
                    const colors = i % 3 === 0
                        ? ['#d04088', '#e870b0', '#a02868']
                        : (i % 3 === 1 ? ['#5878c0', '#8aa8e0', '#3c5898'] : ['#c0488c', '#e078b0', '#982868']);
                    c.fillStyle = colors[1];
                    c.fillRect(bx - 4, by - 2, 8, 4);
                    c.fillStyle = colors[0];
                    c.fillRect(bx - 3, by - 4, 6, 2);
                    c.fillRect(bx - 3, by + 2, 6, 2);
                    // Tiny darker centers.
                    c.fillStyle = colors[2];
                    c.fillRect(bx - 1, by - 1, 2, 2);
                    // Leaf hint.
                    c.fillStyle = '#1a4030';
                    c.fillRect(bx - 5, by + 2, 2, 1);
                    c.fillRect(bx + 3, by + 2, 2, 1);
                }
            }
        }

        drawScooter() {
            const c = this.ctx;
            const L = this._layout;
            const baseX = L.scooterX;
            const baseY = L.scooterY;
            const wobble = Math.sin(this.scooterPhase) * 0.4;

            // Scooter geometry (side view, facing left).
            c.save();
            c.translate(baseX, baseY + wobble);
            // Scale up — the small pixel units are sized for a tiny preview;
            // at a normal viewport, the scooter should read ~80–100px wide.
            c.scale(2.4, 2.4);

            // Rear wheel.
            const wheelR = 5;
            c.fillStyle = '#0a0a0e';
            c.beginPath();
            c.arc(8, -wheelR, wheelR, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#2a2a30';
            c.beginPath();
            c.arc(8, -wheelR, wheelR * 0.4, 0, Math.PI * 2);
            c.fill();

            // Front wheel.
            c.fillStyle = '#0a0a0e';
            c.beginPath();
            c.arc(-22, -wheelR, wheelR, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#2a2a30';
            c.beginPath();
            c.arc(-22, -wheelR, wheelR * 0.4, 0, Math.PI * 2);
            c.fill();

            // Floorboard / rear cargo platform.
            c.fillStyle = '#404048';
            c.fillRect(-16, -10, 22, 3);

            // Rear box (delivery box).
            c.fillStyle = '#c83830';
            c.fillRect(2, -22, 14, 12);
            c.fillStyle = '#8a1c18';
            c.fillRect(2, -22, 14, 2);
            c.fillStyle = '#f8c860';
            c.fillRect(4, -19, 10, 1.5);
            c.fillRect(4, -16, 10, 0.8);

            // Seat.
            c.fillStyle = '#080808';
            c.fillRect(-6, -14, 12, 4);
            c.fillStyle = '#1a1a1c';
            c.fillRect(-6, -14, 12, 1);

            // Front body / leg shield (vertical panel toward front).
            c.fillStyle = '#c8c4bc';
            c.fillRect(-22, -22, 7, 16);
            c.fillStyle = '#8a8478';
            c.fillRect(-22, -22, 1, 16);
            c.fillStyle = '#a8a09c';
            c.fillRect(-15, -19, 2, 13);

            // Handlebars + headlight cluster.
            c.fillStyle = '#1a1a20';
            c.fillRect(-26, -28, 4, 7);
            c.fillStyle = '#404048';
            c.fillRect(-28, -28, 8, 2);
            // Headlight.
            c.fillStyle = '#f0e8b8';
            c.fillRect(-28, -25, 4, 3);
            // Mirror.
            c.fillStyle = '#1a1a20';
            c.fillRect(-26, -32, 1, 4);
            c.fillRect(-28, -32, 4, 1.5);

            // Side stand (kickstand).
            c.fillStyle = '#1a1a1c';
            c.fillRect(0, -5, 1.5, 5);

            // Shadow.
            c.fillStyle = 'rgba(0, 0, 0, 0.5)';
            c.fillRect(-26, -1, 36, 2);

            c.restore();
        }

        drawPerson(t) {
            const c = this.ctx;
            const L = this._layout;
            const baseX = L.personX;
            const baseY = L.personY;
            const phase = this.person.phase;
            const sway = Math.sin(phase * 0.6) * 0.5;

            c.save();
            c.translate(baseX, baseY);
            // Scale up the figure so the proprietor reads at storefront scale.
            c.scale(this.person.facing * 2.6, 2.6);

            // Pant legs.
            c.fillStyle = '#2a3850';
            c.fillRect(-3, -16, 2.5, 16);
            c.fillRect(1, -16, 2.5, 16);
            // Shoes.
            c.fillStyle = '#0a0a14';
            c.fillRect(-3.5, -1, 4, 2);
            c.fillRect(0.5, -1, 4, 2);

            // Torso — blue t-shirt.
            c.fillStyle = '#3870b8';
            c.fillRect(-5, -30, 10, 14);
            // Slight darker shadow on one side.
            c.fillStyle = '#285490';
            c.fillRect(2, -30, 3, 14);

            // Arms — hands held out slightly (one hand at side, one holding a small bag).
            c.fillStyle = '#3870b8';
            c.fillRect(-6, -29, 2, 9);
            c.fillRect(5, -29, 2, 9);
            // Skin (hands).
            c.fillStyle = '#d0a888';
            c.fillRect(-6, -20, 2, 2);
            c.fillRect(5, -20, 2, 2);

            // Head.
            c.fillStyle = '#d0a888';
            c.fillRect(-3 + sway * 0.3, -38, 6, 7);
            // Hair (dark).
            c.fillStyle = '#1a1010';
            c.fillRect(-3 + sway * 0.3, -38, 6, 3);
            c.fillRect(-3 + sway * 0.3, -36, 1.5, 1);
            c.fillRect(3.5 + sway * 0.3, -36, 1.5, 1);
            // Ear (subtle).
            c.fillStyle = '#a07868';
            c.fillRect(-4 + sway * 0.3, -34, 1, 2);

            // A little shopping bag in the trailing hand.
            c.fillStyle = '#e8d8b0';
            c.fillRect(-8.5, -19, 4, 5);
            c.fillStyle = '#a89058';
            c.fillRect(-8.5, -19, 4, 1);

            // Shadow at feet.
            c.fillStyle = 'rgba(0, 0, 0, 0.45)';
            c.fillRect(-5, 0, 10, 1.5);

            c.restore();
        }

        // =========================================================
        // CAT
        // =========================================================
        updateCat(dt) {
            this.nextCatMs -= dt;
            if (!this.cat && this.nextCatMs <= 0) {
                // Spawn a cat from one side.
                const dir = Math.random() < 0.5 ? 1 : -1;
                this.cat = {
                    x: dir === 1 ? -20 : this.width + 20,
                    dir,
                    speed: 28 + Math.random() * 18,
                    walkPhase: 0,
                    pauseMs: 0,
                };
                this.nextCatMs = 60000 + Math.random() * 60000;
            }
            if (this.cat) {
                if (this.cat.pauseMs > 0) {
                    this.cat.pauseMs -= dt;
                } else {
                    this.cat.x += (this.cat.dir * this.cat.speed * dt) / 1000;
                    this.cat.walkPhase += dt * 0.012;
                    // Random pause.
                    if (Math.random() < 0.001) {
                        this.cat.pauseMs = 800 + Math.random() * 2000;
                    }
                }
                // Despawn.
                if ((this.cat.dir === 1 && this.cat.x > this.width + 20) ||
                    (this.cat.dir === -1 && this.cat.x < -20)) {
                    this.cat = null;
                }
            }
        }

        drawCat() {
            const c = this.ctx;
            const cat = this.cat;
            const baseY = this.groundY - 2;
            const bob = cat.pauseMs > 0 ? 0 : Math.sin(cat.walkPhase) * 0.5;
            c.save();
            c.translate(cat.x, baseY + bob);
            c.scale(cat.dir, 1);

            // Body.
            c.fillStyle = '#1a1a22';
            c.fillRect(-6, -5, 12, 4);
            // Head.
            c.fillRect(4, -8, 5, 4);
            // Ears.
            c.fillRect(4, -10, 1.5, 2);
            c.fillRect(7, -10, 1.5, 2);
            // Tail.
            const tailLift = Math.sin(cat.walkPhase * 0.5) * 1.5;
            c.fillRect(-8, -6 - tailLift, 2, 3);
            c.fillRect(-9, -8 - tailLift, 2, 2);
            // Legs (4) — animated stride.
            const stride1 = Math.sin(cat.walkPhase) * 1.2;
            const stride2 = Math.sin(cat.walkPhase + Math.PI) * 1.2;
            c.fillRect(-4 + stride1, -1, 1.5, 2);
            c.fillRect(3 + stride2, -1, 1.5, 2);
            c.fillRect(-2 + stride2, -1, 1.5, 2);
            c.fillRect(1 + stride1, -1, 1.5, 2);
            // Tiny eye glint.
            c.fillStyle = '#e8e0a0';
            c.fillRect(7, -7, 0.8, 0.8);
            c.restore();

            // Shadow under cat.
            c.fillStyle = 'rgba(0, 0, 0, 0.4)';
            c.fillRect(cat.x - 7 * cat.dir, baseY + 0.5, 14, 1);
        }

        // =========================================================
        // STREETLAMP + MOTH + GNATS
        // =========================================================
        drawStreetlamp(t) {
            const c = this.ctx;
            const L = this._layout;
            const x = L.lampX;
            const topY = L.lampY;

            // Pole.
            c.fillStyle = '#0a0d18';
            c.fillRect(x - 1.5, topY, 3, this.groundY - topY);
            // Slight highlight stripe.
            c.fillStyle = 'rgba(60, 80, 100, 0.3)';
            c.fillRect(x - 1.5, topY, 1, this.groundY - topY);
            // Base.
            c.fillStyle = '#040810';
            c.fillRect(x - 5, this.groundY - 4, 10, 4);

            // Top arm extending right.
            c.fillStyle = '#0a0d18';
            c.fillRect(x, topY, 18, 1.5);
            // Lantern housing — vintage frosted glass.
            const lhX = x + 16;
            const lhY = topY - 4;
            const lhW = 8;
            const lhH = 14;
            // Outer dark frame.
            c.fillStyle = '#040810';
            c.fillRect(lhX - 1, lhY - 1, lhW + 2, lhH + 2);
            // Bulb glow inside.
            const grad = c.createLinearGradient(lhX, lhY, lhX, lhY + lhH);
            grad.addColorStop(0, '#fff4d0');
            grad.addColorStop(0.5, '#ffd680');
            grad.addColorStop(1, '#c48830');
            c.fillStyle = grad;
            c.fillRect(lhX, lhY, lhW, lhH);
            // Vertical struts.
            c.fillStyle = '#202020';
            for (let k = 0; k < 3; k++) {
                c.fillRect(lhX + 1 + k * (lhW / 3), lhY, 0.8, lhH);
            }
            // Top cap.
            c.fillStyle = '#0a0d18';
            c.fillRect(lhX - 2, lhY - 3, lhW + 4, 3);
            // Halo.
            c.save();
            c.globalCompositeOperation = 'lighter';
            const halo = c.createRadialGradient(lhX + lhW * 0.5, lhY + lhH * 0.5, 0, lhX + lhW * 0.5, lhY + lhH * 0.5, 60);
            halo.addColorStop(0, 'rgba(255, 220, 150, 0.35)');
            halo.addColorStop(0.5, 'rgba(255, 200, 120, 0.10)');
            halo.addColorStop(1, 'rgba(255, 180, 80, 0)');
            c.fillStyle = halo;
            c.fillRect(lhX - 60, lhY - 60, 120 + lhW, 120 + lhH);
            c.restore();

            // Save for moth + gnats positioning.
            this._lampLightCx = lhX + lhW * 0.5;
            this._lampLightCy = lhY + lhH * 0.5;
        }

        drawLightPool(atmo) {
            const c = this.ctx;
            const L = this._layout;
            const cx = this._lampLightCx || (L.lampX + 24);
            // Project a soft elliptical pool onto the wet ground directly below the lamp.
            const poolCx = cx;
            const poolCy = this.groundY + 8;
            const poolW = 60;
            const poolH = 16;
            c.save();
            c.globalCompositeOperation = 'lighter';
            const grad = c.createRadialGradient(poolCx, poolCy, 0, poolCx, poolCy, poolW);
            grad.addColorStop(0, 'rgba(255, 220, 160, 0.30)');
            grad.addColorStop(0.5, 'rgba(255, 200, 130, 0.12)');
            grad.addColorStop(1, 'rgba(255, 180, 90, 0)');
            c.fillStyle = grad;
            c.fillRect(poolCx - poolW, poolCy - poolH, poolW * 2, poolH * 2);
            c.restore();
        }

        drawMoth() {
            const c = this.ctx;
            const cx = this._lampLightCx || 0;
            const cy = this._lampLightCy || 0;
            // Lissajous-ish orbit.
            const tt = this.moth.t;
            const mx = cx + Math.cos(tt * 1.7) * 18 + Math.sin(tt * 2.3) * 6;
            const my = cy + Math.sin(tt * 1.3) * 12 + Math.cos(tt * 2.1) * 4;
            // Flutter (rapid wing flap).
            const flap = (Math.sin(tt * 18) + 1) * 0.5;
            // Body.
            c.fillStyle = '#3a2820';
            c.fillRect(mx - 0.5, my - 0.5, 1.5, 2);
            // Wings.
            c.fillStyle = `rgba(220, 200, 160, ${0.7 + flap * 0.3})`;
            c.fillRect(mx - 3, my - 1, 2, 2);
            c.fillRect(mx + 1.5, my - 1, 2, 2);
            // Wing detail.
            c.fillStyle = `rgba(100, 80, 60, ${0.6})`;
            c.fillRect(mx - 3 + flap, my - 0.5, 1, 1);
            c.fillRect(mx + 2 - flap, my - 0.5, 1, 1);
        }

        drawGnats(t) {
            const c = this.ctx;
            const cx = this._lampLightCx || 0;
            const cy = this._lampLightCy || 0;
            for (let i = 0; i < this.gnats.length; i++) {
                const g = this.gnats[i];
                const tt = t * 0.001 * g.speed + g.phase;
                const gx = cx + Math.cos(tt) * g.orbitR + Math.sin(tt * 1.7) * 3;
                const gy = cy + Math.sin(tt) * g.orbitR * 0.5 + g.yOffset;
                c.fillStyle = `rgba(255, 230, 180, ${0.4 + 0.4 * Math.sin(tt * 6)})`;
                c.fillRect(gx, gy, 0.8, 0.8);
            }
        }

        // =========================================================
        // VENDING MACHINE (neighbor property)
        // =========================================================
        drawVendingMachine(t) {
            const c = this.ctx;
            const L = this._layout;
            const { vmX, vmY, vmW, vmH } = L;

            // Outer dark casing.
            c.fillStyle = '#0a0e18';
            c.fillRect(vmX - 2, vmY - 2, vmW + 4, vmH + 4);

            // Body — a tall cool-blue vending machine.
            c.fillStyle = '#1a2848';
            c.fillRect(vmX, vmY, vmW, vmH);

            // Top header (brand band).
            c.fillStyle = '#2a4878';
            c.fillRect(vmX, vmY, vmW, vmH * 0.10);
            c.fillStyle = '#1a3868';
            c.fillRect(vmX, vmY + vmH * 0.10, vmW, 1);

            // Product display windows — 3 rows, 4 cols.
            const dispH = vmH * 0.55;
            const dispY = vmY + vmH * 0.12;
            const cols = 3;
            const rows = 4;
            const cellW = vmW / cols;
            const cellH = dispH / rows;
            for (let r = 0; r < rows; r++) {
                for (let cc = 0; cc < cols; cc++) {
                    const dx = vmX + cc * cellW;
                    const dy = dispY + r * cellH;
                    // Lit display cell (cool fluorescent).
                    const lit = (r + cc) % 3 !== 0 ? this.vendingFlicker.value : this.vendingFlicker.value * 0.85;
                    c.fillStyle = `rgba(220, 240, 255, ${0.4 * lit})`;
                    c.fillRect(dx + 1, dy + 1, cellW - 2, cellH - 2);
                    // A tiny can/bottle silhouette.
                    c.fillStyle = `rgba(20, 30, 50, ${0.75})`;
                    c.fillRect(dx + cellW * 0.3, dy + 2, cellW * 0.4, cellH - 4);
                    // Label band.
                    c.fillStyle = ['#c83a3a', '#3aa850', '#3a78c8'][r % 3];
                    c.fillRect(dx + cellW * 0.3, dy + cellH * 0.4, cellW * 0.4, 1.5);
                }
            }

            // Selection panel / coin slot (bottom area).
            const panelY = dispY + dispH + 2;
            const panelH = vmH - (panelY - vmY) - 4;
            c.fillStyle = '#0a1428';
            c.fillRect(vmX + 2, panelY, vmW - 4, panelH);
            // Buttons.
            for (let i = 0; i < 6; i++) {
                const bx = vmX + 3 + (i % 3) * ((vmW - 6) / 3);
                const by = panelY + 2 + Math.floor(i / 3) * 5;
                c.fillStyle = '#2a3858';
                c.fillRect(bx, by, (vmW - 6) / 3 - 1, 3);
            }
            // Coin slot.
            c.fillStyle = '#000';
            c.fillRect(vmX + vmW - 8, panelY + panelH - 8, 6, 1.5);
            // Bottom pickup tray.
            c.fillStyle = '#000';
            c.fillRect(vmX + 4, vmY + vmH - 8, vmW - 8, 5);

            // Glow halo.
            c.save();
            c.globalCompositeOperation = 'lighter';
            const halo = c.createRadialGradient(vmX + vmW * 0.5, vmY + vmH * 0.4, 0, vmX + vmW * 0.5, vmY + vmH * 0.4, vmW * 1.6);
            halo.addColorStop(0, `rgba(180, 210, 255, ${0.16 * this.vendingFlicker.value})`);
            halo.addColorStop(1, 'rgba(180, 210, 255, 0)');
            c.fillStyle = halo;
            c.fillRect(vmX - vmW, vmY - vmH * 0.5, vmW * 3, vmH * 2);
            c.restore();

            // Reflection on ground beneath.
            c.save();
            c.globalCompositeOperation = 'lighter';
            const refl = c.createLinearGradient(0, this.groundY, 0, this.groundY + 36);
            refl.addColorStop(0, `rgba(120, 160, 220, ${0.10 * this.vendingFlicker.value})`);
            refl.addColorStop(1, 'rgba(120, 160, 220, 0)');
            c.fillStyle = refl;
            c.fillRect(vmX - 4, this.groundY, vmW + 8, 36);
            c.restore();
        }

        // =========================================================
        // DRIZZLE + CABLES + VIGNETTE
        // =========================================================
        drawDrizzle(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            c.save();
            c.strokeStyle = 'rgba(180, 200, 230, 0.4)';
            c.lineWidth = 0.7;
            for (let i = 0; i < this.drizzle.length; i++) {
                const d = this.drizzle[i];
                const px = d.x * w;
                const py = d.y * h;
                c.globalAlpha = d.alpha;
                c.beginPath();
                c.moveTo(px, py);
                c.lineTo(px - 2, py + d.len);
                c.stroke();
                d.y += (d.speed * dt) / 1000 / h;
                d.x -= (dt * 0.05) / w;
                if (d.y > 1 || d.x < -0.05) {
                    Object.assign(d, this.makeDrizzle(true));
                }
            }
            c.restore();
        }

        drawForegroundCables(atmo) {
            const c = this.ctx;
            const w = this.width;
            c.save();
            c.strokeStyle = 'rgba(2, 4, 10, 0.95)';
            c.lineWidth = 1.4;
            const y = this.awningTopY - 16;
            c.beginPath();
            c.moveTo(-10, y);
            c.quadraticCurveTo(w * 0.5, y + 24, w + 10, y - 4);
            c.stroke();
            c.lineWidth = 1;
            c.strokeStyle = 'rgba(4, 6, 12, 0.85)';
            c.beginPath();
            c.moveTo(-10, y + 5);
            c.quadraticCurveTo(w * 0.5, y + 30, w + 10, y);
            c.stroke();
            c.restore();
        }

        drawVignette() {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const grad = c.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.3, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, 'rgba(0, 4, 12, 0.55)');
            c.fillStyle = grad;
            c.fillRect(0, 0, w, h);
        }

        destroy() {
            this.tanks = [];
            this.drizzle = [];
            this.gnats = [];
            this.cat = null;
        }
    }

    LiveWallpaper.register({
        id: 'alley',
        name: 'Japan · Alley',
        description: 'A back-street fish shop glowing softly into a damp midnight alley.',
        factory: (canvas) => new AlleyWallpaper(canvas),
    });
})();
