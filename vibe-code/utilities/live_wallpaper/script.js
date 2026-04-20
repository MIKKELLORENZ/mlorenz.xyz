class MatrixRain {
    constructor() {
        this.canvas = document.getElementById('matrix-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.cssWidth = 0;
        this.cssHeight = 0;
        this.dpr = window.devicePixelRatio || 1;
        this.paused = false;
        this.mouse = { x: -1000, y: -1000, active: false };
        this.bursts = [];
        this.fpsHistory = [];
        this.lastFpsUpdate = 0;

        this.characterSets = {
            katakana: "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン",
            hiragana: "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん",
            numbers: "0123456789",
            latin: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            special: "!@#$%^&*()_+-=[]{}|;':\",./<>?~`※∞§¶∆∅∇∈∴∵∼≈≡≠≤≥±×÷√∫∑∏",
            emojis: "😀😁😂🤣😃😄😅😆😉😊😍😘😜🤪🤩🤖👾👻💀🎃✨⚡🔥❄️🌈🍀🍕🍩🎵🎶🧠💡🚀🛸🎯❤🧡💛💚💙💜🖤"
        };

        this.defaultSettings = {
            fallSpeed: 5,
            fadeRate: 0.05,
            completeFade: false,
            fontSize: 18,
            boldFont: false,
            columnDensity: 0.6,
            depthLayers: 1,
            headBright: true,
            hue: 120,
            saturation: 80,
            brightness: 50,
            colorMode: 'classic',
            bgMode: 'black',
            bgTint: 5,
            glowIntensity: 0,
            glowRadius: 0,
            mutationRate: 0.02,
            mouseEffect: 'none',
            mouseRadius: 150,
            mouseStrength: 1,
            clickBurst: true,
            showFps: false,
            characterSets: {
                katakana: true, hiragana: true, numbers: true,
                latin: true, emojis: false, special: false
            }
        };

        this.settings = this.loadSettings();
        this.layers = [];
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.setupMouse();
        this.setupUI();
        this.syncUIFromSettings();
        requestAnimationFrame((t) => this.animate(t));
    }

    // ── Persistence ──
    loadSettings() {
        try {
            const saved = localStorage.getItem('matrix-wallpaper-settings');
            const version = localStorage.getItem('matrix-wallpaper-version');
            // Reset on version bump to apply new defaults
            if (saved && version === '4') {
                const parsed = JSON.parse(saved);
                return { ...JSON.parse(JSON.stringify(this.defaultSettings)), ...parsed,
                    characterSets: { ...this.defaultSettings.characterSets, ...(parsed.characterSets || {}) }
                };
            }
            localStorage.setItem('matrix-wallpaper-version', '4');
        } catch (_) {}
        return JSON.parse(JSON.stringify(this.defaultSettings));
    }

    saveSettings() {
        try {
            localStorage.setItem('matrix-wallpaper-settings', JSON.stringify(this.settings));
            localStorage.setItem('matrix-wallpaper-version', '4');
        } catch (_) {}
    }

    // ── Character Sets ──
    getActiveCharacters() {
        let chars = "";
        for (const name of Object.keys(this.characterSets)) {
            if (this.settings.characterSets[name]) chars += this.characterSets[name];
        }
        try {
            if (window.Intl && Intl.Segmenter) {
                const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
                return Array.from(seg.segment(chars), s => s.segment);
            }
        } catch (_) {}
        return Array.from(chars);
    }

    // ── Layers & Drops ──
    initializeLayers() {
        const numLayers = this.settings.depthLayers;
        this.layers = [];
        for (let L = 0; L < numLayers; L++) {
            const depthScale = numLayers === 1 ? 1 : 0.4 + (L / (numLayers - 1)) * 0.6;
            const effectiveFontSize = Math.round(this.settings.fontSize * depthScale);
            const spacing = effectiveFontSize / this.settings.columnDensity;
            const columns = Math.max(1, Math.floor(this.cssWidth / spacing));
            const drops = [];
            const trailHues = [];
            const trailGlow = [];
            const mutations = [];
            const offsets = []; // x-offsets for mouse interaction
            for (let i = 0; i < columns; i++) {
                drops.push(Math.random() * -100);
                trailHues.push(Math.random() * 360);
                trailGlow.push(0.3 + Math.random() * 0.7);
                mutations.push({});
                offsets.push({ x: 0, y: 0 });
            }
            this.layers.push({ depthScale, effectiveFontSize, spacing, columns, drops, trailHues, trailGlow, mutations, offsets });
        }
    }

    resizeCanvas() {
        this.cssWidth = window.innerWidth;
        this.cssHeight = window.innerHeight;
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.floor(this.cssWidth * this.dpr);
        this.canvas.height = Math.floor(this.cssHeight * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.initializeLayers();
    }

    // ── Mouse ──
    setupMouse() {
        document.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            this.mouse.active = true;
        });
        document.addEventListener('mouseleave', () => { this.mouse.active = false; });
        document.addEventListener('click', (e) => {
            if (this.settings.clickBurst && !e.target.closest('.settings-panel, .top-bar, .modal')) {
                this.bursts.push({ x: e.clientX, y: e.clientY, time: 0, maxTime: 1.2 });
            }
        });
    }

    getMouseDisplacement(px, py, layer) {
        if (this.settings.mouseEffect === 'none' || !this.mouse.active) return { dx: 0, dy: 0, factor: 0 };
        const mx = this.mouse.x, my = this.mouse.y;
        const dist = Math.hypot(px - mx, py - my);
        const radius = this.settings.mouseRadius;
        if (dist > radius) return { dx: 0, dy: 0, factor: 0 };
        const factor = (1 - dist / radius) * this.settings.mouseStrength;
        const angle = Math.atan2(py - my, px - mx);
        const effect = this.settings.mouseEffect;
        if (effect === 'repel') return { dx: Math.cos(angle) * factor * 40, dy: Math.sin(angle) * factor * 20, factor };
        if (effect === 'attract') return { dx: -Math.cos(angle) * factor * 30, dy: -Math.sin(angle) * factor * 15, factor };
        if (effect === 'highlight') return { dx: 0, dy: 0, factor };
        if (effect === 'ripple') {
            const wave = Math.sin(dist * 0.05 - performance.now() * 0.005) * factor * 20;
            return { dx: Math.cos(angle) * wave, dy: Math.sin(angle) * wave, factor };
        }
        if (effect === 'vortex') {
            const perpAngle = angle + Math.PI / 2;
            return { dx: Math.cos(perpAngle) * factor * 35, dy: Math.sin(perpAngle) * factor * 20, factor };
        }
        return { dx: 0, dy: 0, factor: 0 };
    }

    // ── Colors ──
    getColor(column, row, layerIdx) {
        const time = performance.now() * 0.001;
        const h = this.settings.hue;
        const s = this.settings.saturation;
        const l = this.settings.brightness;

        switch (this.settings.colorMode) {
            case 'rainbow-trails': {
                const layer = this.layers[layerIdx];
                return `hsl(${layer.trailHues[column]}, ${s}%, ${l}%)`;
            }
            case 'wave': {
                const waveHue = (h + column * 10 + time * 50) % 360;
                return `hsl(${waveHue}, ${s}%, ${l}%)`;
            }
            case 'pulse': {
                const pi = (Math.sin(time * 3) + 1) * 0.5;
                return `hsl(${h}, ${s}%, ${20 + pi * (l + 10)}%)`;
            }
            case 'fire': {
                const fh = Math.sin(time * 2 + column * 0.1) * 20;
                const fs = 80 + Math.sin(time * 3 + column * 0.2) * 20;
                const fl = 40 + Math.sin(time * 4 + row * 0.1) * 30;
                return `hsl(${fh}, ${fs}%, ${fl}%)`;
            }
            case 'ocean': {
                const oh = 180 + Math.sin(time * 1.5 + column * 0.15) * 60;
                const ol = 40 + Math.sin(time * 2 + row * 0.1) * 30;
                return `hsl(${oh}, ${s}%, ${ol}%)`;
            }
            case 'neon': {
                const neonColors = [300, 60, 180, 0, 240];
                const ni = Math.floor(time * 0.5 + column * 0.2) % neonColors.length;
                return `hsl(${neonColors[ni]}, 100%, 60%)`;
            }
            case 'cyberpunk': {
                const ch = (time * 100 + column * 50) % 2 < 1 ? 300 : 180;
                const cl = 50 + Math.sin(time * 5) * 20;
                return `hsl(${ch}, 100%, ${cl}%)`;
            }
            case 'plasma': {
                const pr = Math.sin(time * 2 + column * 0.1 + row * 0.05) * 127 + 128;
                const pg = Math.sin(time * 2.5 + column * 0.12 + row * 0.06) * 127 + 128;
                const pb = Math.sin(time * 3 + column * 0.14 + row * 0.07) * 127 + 128;
                return `rgb(${pr|0},${pg|0},${pb|0})`;
            }
            case 'aurora': {
                const ah = (120 + Math.sin(time * 0.5 + column * 0.08) * 60 + Math.cos(time * 0.3 + row * 0.02) * 40) % 360;
                const al = 40 + Math.sin(time * 0.7 + column * 0.1) * 25;
                return `hsl(${ah}, 85%, ${al}%)`;
            }
            case 'sunset': {
                const sh = (20 + Math.sin(time * 0.4 + column * 0.05) * 30 + row * 0.3) % 60;
                const sl = 45 + Math.sin(time * 0.6 + column * 0.1) * 20;
                return `hsl(${sh}, 90%, ${sl}%)`;
            }
            case 'toxic': {
                const th = 80 + Math.sin(time * 2 + column * 0.15) * 40;
                const tl = 35 + Math.sin(time * 3 + row * 0.08) * 30;
                return `hsl(${th}, 100%, ${tl}%)`;
            }
            case 'ice': {
                const ih = 190 + Math.sin(time * 0.8 + column * 0.1) * 30;
                const il = 55 + Math.sin(time * 1.2 + row * 0.05) * 25;
                return `hsl(${ih}, 70%, ${il}%)`;
            }
            case 'random': {
                const rh = (h + (Math.random() * 60 - 30) + 360) % 360;
                return `hsl(${rh}, ${s}%, ${l}%)`;
            }
            case 'custom-hue':
                return `hsl(${h}, ${s}%, ${l}%)`;
            default: // classic
                return `hsl(120, ${s}%, ${l}%)`;
        }
    }

    getHeadColor(column, row, layerIdx) {
        if (!this.settings.headBright) return this.getColor(column, row, layerIdx);
        const base = this.getColor(column, row, layerIdx);
        // Parse and brighten
        if (base.startsWith('hsl')) {
            return base.replace(/[\d.]+%\)$/, '90%)');
        }
        return '#ffffff';
    }

    // ── Mutation ──
    applyMutation(char, column, row, mutations) {
        const key = `${column}-${row}`;
        if (Math.random() < this.settings.mutationRate) {
            const activeChars = this.getActiveCharacters();
            if (activeChars.length > 0) {
                mutations[key] = { char: activeChars[Math.floor(Math.random() * activeChars.length)], timer: 30 + Math.random() * 60 };
            }
        }
        if (mutations[key]) {
            mutations[key].timer--;
            if (mutations[key].timer <= 0) { delete mutations[key]; return char; }
            return mutations[key].char;
        }
        return char;
    }

    // ── Background ──
    drawBackground() {
        const mode = this.settings.bgMode;
        if (mode === 'black') {
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
            return;
        }
        if (mode === 'dark-tint') {
            const t = this.settings.bgTint;
            const h = this.settings.hue;
            this.ctx.fillStyle = `hsl(${h}, 30%, ${t}%)`;
            this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
            return;
        }
        if (mode === 'gradient') {
            const h = this.settings.hue;
            const t = this.settings.bgTint;
            const grad = this.ctx.createLinearGradient(0, 0, 0, this.cssHeight);
            grad.addColorStop(0, `hsl(${h}, 20%, ${t + 3}%)`);
            grad.addColorStop(1, `hsl(${(h + 30) % 360}, 20%, ${Math.max(1, t - 2)}%)`);
            this.ctx.fillStyle = grad;
            this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
        }
    }

    // ── Bursts ──
    updateBursts(delta) {
        for (let i = this.bursts.length - 1; i >= 0; i--) {
            this.bursts[i].time += delta;
            if (this.bursts[i].time >= this.bursts[i].maxTime) this.bursts.splice(i, 1);
        }
    }

    getBurstFactor(px, py) {
        let factor = 0;
        for (const b of this.bursts) {
            const dist = Math.hypot(px - b.x, py - b.y);
            const radius = b.time * 400;
            const ring = Math.abs(dist - radius);
            if (ring < 60) {
                const fade = 1 - b.time / b.maxTime;
                factor += (1 - ring / 60) * fade;
            }
        }
        return Math.min(1, factor);
    }

    // ── Draw ──
    draw(delta) {
        const activeChars = this.getActiveCharacters();
        if (activeChars.length === 0) return;

        // Fade / background
        const fadeAlpha = this.settings.completeFade ? 1 : this.settings.fadeRate;
        if (fadeAlpha >= 1) {
            this.drawBackground();
        } else {
            this.ctx.fillStyle = `rgba(0, 0, 0, ${fadeAlpha})`;
            this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
        }

        for (let L = 0; L < this.layers.length; L++) {
            const layer = this.layers[L];
            const fontWeight = this.settings.boldFont ? 'bold' : 'normal';
            this.ctx.font = `${fontWeight} ${layer.effectiveFontSize}px 'Courier New', monospace`;
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'top';
            const depthAlpha = this.layers.length === 1 ? 1 : 0.3 + layer.depthScale * 0.7;

            for (let i = 0; i < layer.columns; i++) {
                if (!Number.isFinite(delta)) continue;
                const speedMod = layer.depthScale;
                layer.drops[i] += this.settings.fallSpeed * delta * speedMod;
                const row = Math.floor(layer.drops[i]);

                let char = activeChars[Math.floor(Math.random() * activeChars.length)];
                char = this.applyMutation(char, i, row, layer.mutations[i] || (layer.mutations[i] = {}));

                const baseX = i * layer.spacing;
                const baseY = layer.drops[i] * layer.effectiveFontSize;

                // Mouse displacement (smooth lerp)
                const disp = this.getMouseDisplacement(baseX, baseY, layer);
                const target = layer.offsets[i];
                target.x += (disp.dx - target.x) * Math.min(1, delta * 8);
                target.y += (disp.dy - target.y) * Math.min(1, delta * 8);
                const x = baseX + target.x;
                const y = baseY + target.y;

                const isHead = row === Math.floor(layer.drops[i]);
                const color = isHead ? this.getHeadColor(i, row, L) : this.getColor(i, row, L);

                // Burst brightening
                const burstFactor = this.getBurstFactor(baseX, baseY);

                // Mouse highlight brightening
                let highlightAlpha = 0;
                if (this.settings.mouseEffect === 'highlight' && disp.factor > 0) {
                    highlightAlpha = disp.factor * 0.6;
                }

                const finalAlpha = Math.min(1, depthAlpha + burstFactor * 0.5 + highlightAlpha);
                this.ctx.globalAlpha = finalAlpha;
                this.ctx.fillStyle = color;

                // Glow — applied as shadow on the single draw call, no separate bloom pass
                if (this.settings.glowIntensity > 0) {
                    const baseGlow = this.settings.glowRadius * (0.5 + layer.trailGlow[i] * 0.5) * (0.3 + this.settings.glowIntensity / 40);
                    this.ctx.shadowColor = color;
                    this.ctx.shadowBlur = Math.min(baseGlow + burstFactor * 8, 20);
                } else {
                    this.ctx.shadowBlur = 0;
                }

                this.ctx.fillText(char, x, y);
                this.ctx.shadowBlur = 0;

                // Rainbow trail hue advance
                if (this.settings.colorMode === 'rainbow-trails') {
                    layer.trailHues[i] = (layer.trailHues[i] + 60 * delta) % 360;
                }

                // Reset drop
                if (layer.drops[i] * layer.effectiveFontSize > this.cssHeight && Math.random() > 0.975) {
                    layer.drops[i] = -Math.random() * 100;
                    if (this.settings.colorMode === 'rainbow-trails') layer.trailHues[i] = Math.random() * 360;
                    layer.trailGlow[i] = 0.3 + Math.random() * 0.7;
                    layer.mutations[i] = {};
                }
            }
        }

        this.ctx.globalAlpha = 1;
        this.ctx.shadowBlur = 0;
    }

    // ── FPS ──
    updateFps(now) {
        if (now - this.lastFpsUpdate > 250) {
            const avg = this.fpsHistory.length > 0 ? this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length : 0;
            const el = document.getElementById('fps-counter');
            if (el) el.textContent = `${Math.round(avg)} FPS`;
            this.lastFpsUpdate = now;
        }
    }

    // ── Animation Loop ──
    animate(timestamp) {
        if (!this.lastFrameTime) this.lastFrameTime = timestamp || performance.now();
        const now = timestamp || performance.now();
        const delta = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        if (delta > 0 && delta < 1) {
            this.fpsHistory.push(1 / delta);
            if (this.fpsHistory.length > 30) this.fpsHistory.shift();
        }
        this.updateFps(now);

        if (!this.paused) {
            this.updateBursts(delta);
            this.draw(delta);
        }
        requestAnimationFrame((t) => this.animate(t));
    }

    // ── Screenshot ──
    takeScreenshot() {
        const link = document.createElement('a');
        link.download = `matrix-wallpaper-${Date.now()}.png`;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
        showToast('Screenshot saved');
    }

    // ── Fullscreen ──
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen();
        }
    }

    // ── Presets ──
    getBuiltinPresets() {
        return [
            { name: 'Classic Matrix', desc: 'The original green rain', builtin: true, settings: { ...this.defaultSettings, characterSets: { ...this.defaultSettings.characterSets } } },
            { name: 'Cyberpunk City', desc: 'Pink & cyan neon rain', builtin: true, settings: { ...this.defaultSettings, colorMode: 'cyberpunk', glowIntensity: 6, glowRadius: 6, fadeRate: 0.04, fallSpeed: 7, headBright: true, characterSets: { ...this.defaultSettings.characterSets } } },
            { name: 'Ocean Depths', desc: 'Deep blue cascading waves', builtin: true, settings: { ...this.defaultSettings, colorMode: 'ocean', fadeRate: 0.03, fallSpeed: 3, glowIntensity: 4, glowRadius: 6, fontSize: 20, characterSets: { ...this.defaultSettings.characterSets } } },
            { name: 'Firewall', desc: 'Blazing hot cascade', builtin: true, settings: { ...this.defaultSettings, colorMode: 'fire', fadeRate: 0.06, fallSpeed: 8, glowIntensity: 8, glowRadius: 5, boldFont: true, characterSets: { ...this.defaultSettings.characterSets } } },
            { name: 'Starfield', desc: 'Sparse, slow, ethereal', builtin: true, settings: { ...this.defaultSettings, fallSpeed: 1.5, fadeRate: 0.02, fontSize: 12, columnDensity: 0.5, glowIntensity: 10, glowRadius: 8, colorMode: 'ice', headBright: true, characterSets: { ...this.defaultSettings.characterSets, katakana: false, hiragana: false, latin: false, special: true } } },
            { name: 'Plasma Storm', desc: 'Psychedelic color chaos', builtin: true, settings: { ...this.defaultSettings, colorMode: 'plasma', fadeRate: 0.07, fallSpeed: 10, fontSize: 14, columnDensity: 1.5, glowIntensity: 4, boldFont: true, characterSets: { ...this.defaultSettings.characterSets } } },
            { name: 'Aurora Borealis', desc: 'Gentle northern lights', builtin: true, settings: { ...this.defaultSettings, colorMode: 'aurora', fadeRate: 0.025, fallSpeed: 2, fontSize: 22, depthLayers: 3, glowIntensity: 5, glowRadius: 8, characterSets: { ...this.defaultSettings.characterSets } } },
            { name: 'Toxic Rain', desc: 'Acid green overdrive', builtin: true, settings: { ...this.defaultSettings, colorMode: 'toxic', fadeRate: 0.08, fallSpeed: 12, fontSize: 14, columnDensity: 1.8, glowIntensity: 10, glowRadius: 5, boldFont: true, mutationRate: 0.08, characterSets: { ...this.defaultSettings.characterSets, special: true } } },
        ];
    }

    getCustomPresets() {
        try {
            return JSON.parse(localStorage.getItem('matrix-wallpaper-presets') || '[]');
        } catch (_) { return []; }
    }

    saveCustomPresets(presets) {
        try { localStorage.setItem('matrix-wallpaper-presets', JSON.stringify(presets)); } catch (_) {}
    }

    // ── UI Setup ──
    setupUI() {
        const topBar = document.getElementById('top-bar');
        const panel = document.getElementById('settings-panel');
        let mouseTimer;
        let cursorVisible = false;

        document.addEventListener('mousemove', () => {
            if (!cursorVisible) {
                document.body.classList.add('cursor-visible');
                topBar.classList.add('visible');
                cursorVisible = true;
            }
            clearTimeout(mouseTimer);
            mouseTimer = setTimeout(() => {
                if (!panel.classList.contains('open')) {
                    document.body.classList.remove('cursor-visible');
                    topBar.classList.remove('visible');
                    cursorVisible = false;
                }
            }, 2500);
        });

        // Buttons
        document.getElementById('btn-pause').addEventListener('click', () => this.togglePause());
        document.getElementById('btn-screenshot').addEventListener('click', () => this.takeScreenshot());
        document.getElementById('btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('btn-settings').addEventListener('click', () => panel.classList.toggle('open'));
        document.getElementById('close-panel').addEventListener('click', () => panel.classList.remove('open'));

        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
                if (tab.dataset.tab === 'presets') this.renderPresets();
            });
        });

        // BG mode toggling tint visibility
        document.getElementById('bg-mode').addEventListener('change', (e) => {
            this.settings.bgMode = e.target.value;
            document.getElementById('bg-tint-group').style.display = e.target.value === 'black' ? 'none' : 'flex';
            this.saveSettings();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
            const key = e.key.toLowerCase();
            if (key === ' ') { e.preventDefault(); this.togglePause(); }
            if (key === 's' && !e.ctrlKey) this.takeScreenshot();
            if (key === 'f') this.toggleFullscreen();
            if (key === 'g') panel.classList.toggle('open');
            if (key === 'escape') panel.classList.remove('open');
        });

        // Presets
        document.getElementById('save-preset').addEventListener('click', () => this.showSaveModal());
        document.getElementById('reset-defaults').addEventListener('click', () => this.resetToDefaults());

        // Save modal
        document.getElementById('modal-save').addEventListener('click', () => this.confirmSavePreset());
        document.getElementById('modal-cancel').addEventListener('click', () => {
            document.getElementById('save-modal').style.display = 'none';
        });
        document.getElementById('preset-name-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.confirmSavePreset();
        });

        this.setupSettingControls();
    }

    togglePause() {
        this.paused = !this.paused;
        document.getElementById('icon-pause').style.display = this.paused ? 'none' : 'block';
        document.getElementById('icon-play').style.display = this.paused ? 'block' : 'none';
        showToast(this.paused ? 'Paused' : 'Playing');
    }

    setupSettingControls() {
        const bind = (id, key, parse = parseFloat, reinit = false) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(`${id}-value`);
            if (!el) return;
            el.addEventListener('input', (e) => {
                this.settings[key] = parse(e.target.value);
                if (valEl) valEl.textContent = e.target.value;
                if (reinit) this.initializeLayers();
                this.saveSettings();
            });
        };
        const bindCheck = (id, key, cb) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', (e) => {
                this.settings[key] = e.target.checked;
                if (cb) cb();
                this.saveSettings();
            });
        };

        bind('fall-speed', 'fallSpeed');
        bind('fade-rate', 'fadeRate');
        bind('font-size', 'fontSize', parseInt, true);
        bind('column-density', 'columnDensity', parseFloat, true);
        bind('depth-layers', 'depthLayers', parseInt, true);
        bind('mutation-rate', 'mutationRate');
        bind('hue', 'hue', parseInt);
        bind('saturation', 'saturation', parseInt);
        bind('brightness', 'brightness', parseInt);
        bind('glow-intensity', 'glowIntensity', parseInt);
        bind('glow-radius', 'glowRadius', parseInt);
        bind('mouse-radius', 'mouseRadius', parseInt);
        bind('mouse-strength', 'mouseStrength');
        bind('bg-tint', 'bgTint', parseInt);

        bindCheck('bold-font', 'boldFont');
        bindCheck('complete-fade', 'completeFade');
        bindCheck('head-bright', 'headBright');
        bindCheck('click-burst', 'clickBurst');
        bindCheck('show-fps', 'showFps', () => {
            document.getElementById('fps-counter').classList.toggle('visible', this.settings.showFps);
        });

        // Hue preview
        const hueSlider = document.getElementById('hue');
        if (hueSlider) {
            const updatePreview = () => {
                const p = document.getElementById('hue-preview');
                if (p) p.style.background = `hsl(${this.settings.hue}, 80%, 50%)`;
            };
            hueSlider.addEventListener('input', updatePreview);
            updatePreview();
        }

        // Color mode
        document.getElementById('color-mode').addEventListener('change', (e) => {
            this.settings.colorMode = e.target.value;
            this.saveSettings();
        });

        // Mouse effect
        document.getElementById('mouse-effect').addEventListener('change', (e) => {
            this.settings.mouseEffect = e.target.value;
            this.saveSettings();
        });

        // Character sets
        for (const name of Object.keys(this.characterSets)) {
            const cb = document.getElementById(name);
            if (cb) {
                cb.addEventListener('change', (e) => {
                    this.settings.characterSets[name] = e.target.checked;
                    this.saveSettings();
                });
            }
        }
    }

    syncUIFromSettings() {
        const s = this.settings;
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
            const v = document.getElementById(`${id}-value`);
            if (v) v.textContent = val;
        };
        const setCheck = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = val;
        };

        setVal('fall-speed', s.fallSpeed);
        setVal('fade-rate', s.fadeRate);
        setVal('font-size', s.fontSize);
        setVal('column-density', s.columnDensity);
        setVal('depth-layers', s.depthLayers);
        setVal('mutation-rate', s.mutationRate);
        setVal('hue', s.hue);
        setVal('saturation', s.saturation);
        setVal('brightness', s.brightness);
        setVal('glow-intensity', s.glowIntensity);
        setVal('glow-radius', s.glowRadius);
        setVal('mouse-radius', s.mouseRadius);
        setVal('mouse-strength', s.mouseStrength);
        setVal('bg-tint', s.bgTint);

        setCheck('bold-font', s.boldFont);
        setCheck('complete-fade', s.completeFade);
        setCheck('head-bright', s.headBright);
        setCheck('click-burst', s.clickBurst);
        setCheck('show-fps', s.showFps);

        document.getElementById('color-mode').value = s.colorMode;
        document.getElementById('mouse-effect').value = s.mouseEffect;
        document.getElementById('bg-mode').value = s.bgMode;
        document.getElementById('bg-tint-group').style.display = s.bgMode === 'black' ? 'none' : 'flex';
        document.getElementById('fps-counter').classList.toggle('visible', s.showFps);

        for (const name of Object.keys(s.characterSets)) {
            setCheck(name, s.characterSets[name]);
        }

        const p = document.getElementById('hue-preview');
        if (p) p.style.background = `hsl(${s.hue}, 80%, 50%)`;
    }

    resetToDefaults() {
        this.settings = JSON.parse(JSON.stringify(this.defaultSettings));
        this.syncUIFromSettings();
        this.initializeLayers();
        this.saveSettings();
        showToast('Reset to defaults');
    }

    applyPreset(preset) {
        this.settings = JSON.parse(JSON.stringify(preset.settings));
        // Ensure all keys exist
        for (const k of Object.keys(this.defaultSettings)) {
            if (!(k in this.settings)) this.settings[k] = this.defaultSettings[k];
        }
        if (!this.settings.characterSets) this.settings.characterSets = { ...this.defaultSettings.characterSets };
        this.syncUIFromSettings();
        this.initializeLayers();
        this.saveSettings();
        showToast(`Loaded: ${preset.name}`);
    }

    renderPresets() {
        const grid = document.getElementById('presets-grid');
        grid.innerHTML = '';
        const all = [...this.getBuiltinPresets(), ...this.getCustomPresets()];
        for (const preset of all) {
            const card = document.createElement('div');
            card.className = 'preset-card';
            card.innerHTML = `<div class="preset-name">${preset.name}</div><div class="preset-desc">${preset.desc || ''}</div>`;
            if (!preset.builtin) {
                const del = document.createElement('button');
                del.className = 'delete-preset';
                del.textContent = '×';
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const customs = this.getCustomPresets().filter(p => p.name !== preset.name);
                    this.saveCustomPresets(customs);
                    this.renderPresets();
                    showToast('Preset deleted');
                });
                card.appendChild(del);
            }
            card.addEventListener('click', () => this.applyPreset(preset));
            grid.appendChild(card);
        }
    }

    showSaveModal() {
        document.getElementById('save-modal').style.display = 'flex';
        const input = document.getElementById('preset-name-input');
        input.value = '';
        input.focus();
    }

    confirmSavePreset() {
        const name = document.getElementById('preset-name-input').value.trim();
        if (!name) return;
        const customs = this.getCustomPresets();
        const existing = customs.findIndex(p => p.name === name);
        const preset = { name, desc: 'Custom preset', settings: JSON.parse(JSON.stringify(this.settings)) };
        if (existing >= 0) customs[existing] = preset;
        else customs.push(preset);
        this.saveCustomPresets(customs);
        document.getElementById('save-modal').style.display = 'none';
        this.renderPresets();
        showToast(`Saved: ${name}`);
    }
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    new MatrixRain();
});
