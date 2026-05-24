// Classic Matrix digital-rain wallpaper.
// Grid-aligned columns across three depth layers, precomputed color LUT,
// per-column state machine (fall/surge/stall), trail glyph morphing, ambient
// pulse, and rare horizontal "code wave" flashes.
(function () {
    'use strict';

    // ---------- glyph pool ----------
    const KATAKANA = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
    const DIGITS = '0123456789';
    const SYMBOLS = ':.=|*+-';
    const GLYPHS_POOL = KATAKANA.repeat(8) + DIGITS.repeat(2) + SYMBOLS;
    const POOL_LEN = GLYPHS_POOL.length;

    function pickGlyph() {
        return GLYPHS_POOL.charAt((Math.random() * POOL_LEN) | 0);
    }

    // ---------- layers ----------
    const LAYERS = [
        { name: 'far',  fontScale: 0.82, alphaMul: 0.45, speedMul: 1.35, density: 0.55, trailMin: 10, trailMax: 16, headBlur: 8 },
        { name: 'mid',  fontScale: 1.00, alphaMul: 0.85, speedMul: 1.00, density: 1.00, trailMin: 14, trailMax: 22, headBlur: 8 },
        { name: 'near', fontScale: 1.18, alphaMul: 1.00, speedMul: 0.78, density: 0.40, trailMin: 16, trailMax: 26, headBlur: 12 },
    ];

    // ---------- color anchors ----------
    const HEAD_WHITE = { r: 200, g: 255, b: 210 };
    const HEAD_GREEN = { r: 160, g: 255, b: 180 };
    const STEP1      = { r: 120, g: 255, b: 140 };
    const TRAIL_TOP  = { r:   0, g: 255, b:  65 };
    const TRAIL_MID  = { r:   0, g: 176, b:  48 };
    const TRAIL_TAIL = { r:   6, g:  36, b:  14 };
    const LUT_LEN = 24;

    function lerpColor(a, b, t) {
        return {
            r: a.r + (b.r - a.r) * t,
            g: a.g + (b.g - a.g) * t,
            b: a.b + (b.b - a.b) * t,
        };
    }

    function buildTrailLUT() {
        const lut = new Array(LUT_LEN);
        const midTail = lerpColor(TRAIL_MID, TRAIL_TAIL, 0.6);
        for (let k = 0; k < LUT_LEN; k++) {
            let c;
            if (k <= 3) {
                c = lerpColor(TRAIL_TOP, TRAIL_MID, k / 3);
            } else if (k <= 14) {
                c = lerpColor(TRAIL_MID, midTail, (k - 4) / 10);
            } else {
                c = lerpColor(midTail, TRAIL_TAIL, (k - 15) / 8);
            }
            lut[k] = { r: c.r | 0, g: c.g | 0, b: c.b | 0 };
        }
        return lut;
    }

    function randRange(lo, hi) { return lo + Math.random() * (hi - lo); }
    function randInt(lo, hi)   { return lo + ((Math.random() * (hi - lo + 1)) | 0); }

    class MatrixWallpaper extends Wallpaper {
        init() {
            this.TRAIL_LUT = buildTrailLUT();
            this.cols = [];
            this.baseFontSize = 16;
            this.cellW = 10;
            this.cellH = 17;
            this.gridCols = 0;
            this.gridRows = 0;
            this.codeWaveNextAt = 0;
            this.fontStrings = new Map(); // layer name → memoized font string
            this._scanlineCache = null;
        }

        seedColumn(layer, gridX) {
            const fontSize = Math.max(10, Math.round(this.baseFontSize * layer.fontScale));
            const trail = randInt(layer.trailMin, layer.trailMax);
            const glyphs = new Array(trail + 1);
            for (let i = 0; i < glyphs.length; i++) glyphs[i] = pickGlyph();
            const racer = Math.random() < 0.05;
            const baseSpeed = this.cellH * randRange(8, 14) * layer.speedMul * (racer ? 1.8 : 1);
            return {
                layer,
                gridX,
                x: (gridX + 0.5) * this.cellW,
                fontSize,
                headRow: -randInt(2, 12),
                speed: baseSpeed,
                baseSpeed,
                trail,
                glyphs,
                mutateEvery: randRange(60, 140),
                mutateTimer: Math.random() * 140,
                state: 'fall',
                stateTimer: 0,
                stateDuration: 0,
                brightHead: Math.random() < 0.12,
                waveFlashUntil: 0,
            };
        }

        resize(w, h) {
            super.resize(w, h);
            this.baseFontSize = this.clamp(Math.round(w / 90), 14, 22);
            this.cellW = Math.max(6, Math.round(this.baseFontSize * 0.60));
            this.cellH = Math.max(8, Math.round(this.baseFontSize * 1.05));
            this.gridCols = Math.ceil(w / this.cellW);
            this.gridRows = Math.ceil(h / this.cellH) + 4;

            // Rebuild memoized font strings per layer
            this.fontStrings.clear();
            for (const L of LAYERS) {
                const fs = Math.max(10, Math.round(this.baseFontSize * L.fontScale));
                this.fontStrings.set(L.name, `${fs}px "Consolas", "Menlo", "Courier New", monospace`);
            }

            // Rebuild columns. For each layer pick `density * gridCols` distinct grid X slots.
            this.cols = [];
            for (const layer of LAYERS) {
                const count = Math.max(8, Math.ceil(this.gridCols * layer.density));
                const used = new Set();
                for (let i = 0; i < count; i++) {
                    // For mid layer use every slot in order; for sparser layers pick random unused slots.
                    let gx;
                    if (layer.density >= 1) {
                        gx = i % this.gridCols;
                    } else {
                        let attempts = 0;
                        do {
                            gx = (Math.random() * this.gridCols) | 0;
                            attempts++;
                        } while (used.has(gx) && attempts < 6);
                        used.add(gx);
                    }
                    this.cols.push(this.seedColumn(layer, gx));
                }
            }

            // Sort by layer order so render passes are contiguous per font/blur setting.
            const order = { far: 0, mid: 1, near: 2 };
            this.cols.sort((a, b) => order[a.layer.name] - order[b.layer.name]);

            this._scanlineCache = null;

            // Schedule first code-wave 30–90s out.
            this.codeWaveNextAt = performance.now() + randRange(30000, 90000);
        }

        // Tick state machine for a single column.
        tickState(col, dt) {
            col.stateTimer += dt;
            if (col.state === 'fall') {
                const p = dt / 1000;
                // surge transition
                if (Math.random() < 0.08 * p) {
                    col.state = 'surge';
                    col.stateTimer = 0;
                    col.stateDuration = randRange(350, 900);
                    col.speed = col.baseSpeed * 2.8;
                    return;
                }
                // stall transition (only check if didn't already transition to surge)
                if (Math.random() < 0.04 * p) {
                    col.state = 'stall';
                    col.stateTimer = 0;
                    col.stateDuration = randRange(200, 550);
                    col.speed = 0;
                    return;
                }
            } else {
                if (col.stateTimer >= col.stateDuration) {
                    col.state = 'fall';
                    col.stateTimer = 0;
                    col.speed = col.baseSpeed;
                }
            }
        }

        respawn(col) {
            col.headRow = -randInt(2, 12);
            const racer = Math.random() < 0.05;
            col.baseSpeed = this.cellH * randRange(8, 14) * col.layer.speedMul * (racer ? 1.8 : 1);
            col.speed = col.baseSpeed;
            col.state = 'fall';
            col.stateTimer = 0;
            col.stateDuration = 0;
            col.brightHead = Math.random() < 0.12;
            col.waveFlashUntil = 0;
            col.trail = randInt(col.layer.trailMin, col.layer.trailMax);
            col.glyphs = new Array(col.trail + 1);
            for (let i = 0; i < col.glyphs.length; i++) col.glyphs[i] = pickGlyph();
            col.mutateEvery = randRange(60, 140);
            col.mutateTimer = Math.random() * 140;
        }

        // Per-frame trail morph: pick ~0.6% of visible cells and swap them.
        morphTrails() {
            const totalCells = this.cols.length * 18; // approximate avg trail length
            const budget = Math.max(2, Math.round(totalCells * 0.006));
            const mutated = new Set();
            for (let i = 0; i < budget; i++) {
                const ci = (Math.random() * this.cols.length) | 0;
                if (mutated.has(ci)) continue;
                mutated.add(ci);
                const col = this.cols[ci];
                if (!col || col.glyphs.length < 3) continue;
                // Skip head (idx 0) — head is updated by its own mutate timer.
                const k = 1 + ((Math.random() * (col.glyphs.length - 1)) | 0);
                col.glyphs[k] = pickGlyph();
            }
        }

        maybeFireCodeWave(t) {
            if (t < this.codeWaveNextAt) return;
            const yMid = Math.random() * this.height;
            const bandH = this.cellH * randRange(2, 4);
            const flashUntil = t + 180;
            for (const col of this.cols) {
                const y = col.headRow * this.cellH;
                if (y >= yMid - bandH && y <= yMid + bandH) {
                    col.waveFlashUntil = flashUntil;
                }
            }
            this.codeWaveNextAt = t + randRange(30000, 60000);
        }

        render(t, dt) {
            const c = this.ctx;
            const w = this.width, h = this.height;
            const cellH = this.cellH;
            const cellW = this.cellW;

            // 1. Background fade — gentle, LUT defines the actual trail.
            c.fillStyle = 'rgba(0,6,3,0.055)';
            c.fillRect(0, 0, w, h);

            // Advance state, position, head-glyph swap, respawn.
            const dtSec = dt / 1000;
            for (let i = 0; i < this.cols.length; i++) {
                const col = this.cols[i];
                this.tickState(col, dt);

                // Advance head position in rows/sec.
                if (col.state !== 'stall') {
                    col.headRow += (col.speed / cellH) * dtSec;
                }

                // Head glyph swap on timer.
                col.mutateTimer += dt;
                if (col.mutateTimer >= col.mutateEvery) {
                    col.mutateTimer = 0;
                    // Ring buffer shift: trail[k] = trail[k-1], new head.
                    for (let k = col.glyphs.length - 1; k > 0; k--) {
                        col.glyphs[k] = col.glyphs[k - 1];
                    }
                    col.glyphs[0] = pickGlyph();
                }

                // Respawn when fully off-screen.
                if ((col.headRow - col.trail) * cellH > h) {
                    this.respawn(col);
                }
            }

            // Trail morph (mid/back cells only).
            this.morphTrails();

            // Code-wave scheduler.
            this.maybeFireCodeWave(t);

            // Ambient pulse — global breath on heads / step-1.
            const ambient = 1 + 0.06 * Math.sin(t * 0.00078);

            c.textAlign = 'left';
            c.textBaseline = 'top';

            // 2. Trail pass — far → mid → near; no shadow, no per-cell font changes.
            c.shadowBlur = 0;
            c.shadowColor = 'transparent';
            let currentLayerName = null;
            const LUT = this.TRAIL_LUT;
            for (let i = 0; i < this.cols.length; i++) {
                const col = this.cols[i];
                if (col.layer.name !== currentLayerName) {
                    currentLayerName = col.layer.name;
                    c.font = this.fontStrings.get(currentLayerName);
                }
                const layerAlpha = col.layer.alphaMul;
                const trail = col.trail;
                const headY = col.headRow * cellH;
                const drawX = col.x - cellW * 0.5;
                // Draw older first so newer overdraws (negligible since cells don't overlap, but consistent).
                for (let k = trail; k >= 2; k--) {
                    const y = headY - k * cellH;
                    if (y < -cellH || y > h + cellH) continue;
                    const lutI = k < LUT_LEN ? k : LUT_LEN - 1;
                    const color = LUT[lutI];
                    const fade = 1 - k / (trail + 1);
                    const alpha = layerAlpha * Math.pow(fade, 0.85);
                    if (alpha < 0.02) continue;
                    c.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha.toFixed(3)})`;
                    c.fillText(col.glyphs[k], drawX, y);
                }
            }

            // 3. Step-1 pass (head + 1, pure bright green) — no shadow.
            currentLayerName = null;
            for (let i = 0; i < this.cols.length; i++) {
                const col = this.cols[i];
                if (col.layer.name !== currentLayerName) {
                    currentLayerName = col.layer.name;
                    c.font = this.fontStrings.get(currentLayerName);
                }
                const y = (col.headRow - 1) * cellH;
                if (y < -cellH || y > h + cellH) continue;
                const alpha = Math.min(1, col.layer.alphaMul * 0.95 * ambient);
                c.fillStyle = `rgba(${STEP1.r},${STEP1.g},${STEP1.b},${alpha.toFixed(3)})`;
                c.fillText(col.glyphs[1] || pickGlyph(), col.x - cellW * 0.5, y);
            }

            // 4. Head pass — shadow per layer.
            currentLayerName = null;
            let currentBlur = -1;
            for (let i = 0; i < this.cols.length; i++) {
                const col = this.cols[i];
                if (col.layer.name !== currentLayerName) {
                    currentLayerName = col.layer.name;
                    c.font = this.fontStrings.get(currentLayerName);
                    if (col.layer.headBlur !== currentBlur) {
                        c.shadowBlur = col.layer.headBlur;
                        currentBlur = col.layer.headBlur;
                    }
                }
                const y = col.headRow * cellH;
                if (y < -cellH || y > h + cellH) continue;
                const head = col.brightHead ? HEAD_WHITE : HEAD_GREEN;
                const shadow = col.brightHead
                    ? 'rgba(180,255,200,0.9)'
                    : 'rgba(120,255,140,0.9)';
                c.shadowColor = shadow;
                const alpha = Math.min(1, col.layer.alphaMul * ambient);
                c.fillStyle = `rgba(${head.r},${head.g},${head.b},${alpha.toFixed(3)})`;
                c.fillText(col.glyphs[0], col.x - cellW * 0.5, y);
            }
            c.shadowBlur = 0;
            c.shadowColor = 'transparent';

            // 5. Code-wave overdraw (bright flash for cells whose flash window is active).
            let waveDrew = false;
            for (let i = 0; i < this.cols.length; i++) {
                const col = this.cols[i];
                if (col.waveFlashUntil <= t) continue;
                const y = col.headRow * cellH;
                if (y < -cellH || y > h + cellH) continue;
                if (!waveDrew) {
                    waveDrew = true;
                    c.shadowBlur = 18;
                    c.shadowColor = 'rgba(220,255,230,0.95)';
                }
                c.font = this.fontStrings.get(col.layer.name);
                const remain = (col.waveFlashUntil - t) / 180; // 1 → 0
                const eased = this.smoothstep(0, 1, remain);
                c.fillStyle = `rgba(220,255,230,${(0.7 + 0.3 * eased).toFixed(3)})`;
                c.fillText(col.glyphs[0], col.x - cellW * 0.5, y);
            }
            if (waveDrew) {
                c.shadowBlur = 0;
                c.shadowColor = 'transparent';
            }

            // 6. Scanlines.
            if (!this._scanlineCache || this._scanlineCache.w !== w || this._scanlineCache.h !== h) {
                const off = document.createElement('canvas');
                off.width = Math.max(1, Math.floor(w));
                off.height = Math.max(1, Math.floor(h));
                const oc = off.getContext('2d');
                oc.fillStyle = 'rgba(0,0,0,0.16)';
                for (let y = 0; y < h; y += 3) oc.fillRect(0, y, w, 1);
                this._scanlineCache = { w, h, canvas: off };
            }
            c.globalAlpha = 0.28;
            c.drawImage(this._scanlineCache.canvas, 0, 0);
            c.globalAlpha = 1;

            // 7. Green-tinted vignette.
            const vign = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.50, w / 2, h / 2, Math.max(w, h) * 0.82);
            vign.addColorStop(0, 'rgba(0,8,4,0)');
            vign.addColorStop(1, 'rgba(0,8,4,0.55)');
            c.fillStyle = vign;
            c.fillRect(0, 0, w, h);
        }

        destroy() {
            this.cols = [];
            this._scanlineCache = null;
            this.fontStrings.clear();
        }
    }

    LiveWallpaper.register({
        id: 'matrix',
        name: 'Matrix Rain',
        description: 'Cascading green glyphs in the digital downpour.',
        factory: (canvas) => new MatrixWallpaper(canvas),
    });
})();
