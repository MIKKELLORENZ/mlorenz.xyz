class MatrixRain {
    constructor() {
        this.canvas = document.getElementById('matrix-canvas');
        this.ctx = this.canvas.getContext('2d');
        // Track CSS pixel size and device pixel ratio for crisp rendering
        this.cssWidth = 0;
        this.cssHeight = 0;
        this.dpr = window.devicePixelRatio || 1;
        
        // Character sets
        this.characterSets = {
            katakana: "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン",
            hiragana: "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん",
            numbers: "0123456789",
            latin: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            special: "!@#$%^&*()_+-=[]{}|;':\",./<>?~`※∞§¶∆∅∇∈∴∵∼≈≡≠≤≥±×÷√∫∑∏∐∧∨∩∪⊂⊃⊆⊇⊥⊥∠∡∢∿⌀⌂⌊⌋⌈⌉⌐¬⊕⊗⊙⊚⊛⊜⊝⊞⊟⊠⊡⋄⋅⋆⋇⋈⋉⋊⋋⋌⋍⋎⋏",
            // A compact emoji set (use Array.from to keep surrogate pairs intact)
            emojis: "😀😁😂🤣😃😄😅😆😉😊😍😘😜🤪🤩🤖👾👻💀🎃✨⚡🔥❄️🌈🍀🍕🍩🍪🥨🍎🍌🍒🎵🎶🧠💡🚀🛸🎯❤🧡💛💚💙💜🖤"
        };
        
        // Default settings
        this.defaultSettings = {
            fallSpeed: 5, // increased default speed
            fadeRate: 0.05,
            completeFade: false, // option to fully dim fade
            fontSize: 18,
            boldFont: false,
            hue: 120,
            colorMode: 'classic',
            glowIntensity: 5,
            glowRadius: 8,
            mutationRate: 0.02,
            characterSets: {
                katakana: true,
                hiragana: true,
                numbers: true,
                latin: true,
                emojis: false,
                special: false
            }
        };
        
        // Current settings (copy of defaults)
        this.settings = JSON.parse(JSON.stringify(this.defaultSettings));
        
        // Array to store the y position and timing of each column
        this.drops = [];
        this.trailHues = []; // For rainbow trails mode
        this.trailGlowStrength = []; // Random glow strength per trail
        this.mutations = []; // Track mutations per column
        
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        this.setupUI();
        // Kick off RAF properly so we get a valid timestamp
        requestAnimationFrame((t) => this.animate(t));
    }
    
    getActiveCharacters() {
        let chars = "";
        Object.keys(this.characterSets).forEach(setName => {
            if (this.settings.characterSets[setName]) {
                chars += this.characterSets[setName];
            }
        });
        // Use grapheme segmentation for emojis and complex glyphs when available
        try {
            if (window.Intl && Intl.Segmenter) {
                const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
                return Array.from(seg.segment(chars), s => s.segment);
            }
        } catch (_) { /* fallback below */ }
        return Array.from(chars);
    }
    
    initializeDrops() {
        // Columns based on CSS pixels, not device pixels
        this.columns = Math.floor(this.cssWidth / this.settings.fontSize);
        this.drops = [];
        this.trailHues = [];
        this.trailGlowStrength = [];
        this.mutations = [];
        
        for (let i = 0; i < this.columns; i++) {
            this.drops[i] = Math.random() * -100;
            this.trailHues[i] = Math.random() * 360;
            this.trailGlowStrength[i] = 0.3 + Math.random() * 0.7; // Random glow strength
            this.mutations[i] = {};
        }
    }
    
    resizeCanvas() {
        this.cssWidth = window.innerWidth;
        this.cssHeight = window.innerHeight;
        this.dpr = window.devicePixelRatio || 1;
        // Set the internal pixel size for crisp rendering
        this.canvas.width = Math.floor(this.cssWidth * this.dpr);
        this.canvas.height = Math.floor(this.cssHeight * this.dpr);
        // Reset transform and scale to CSS pixels
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.initializeDrops();
    }
    
    setupUI() {
        const settingsIcon = document.getElementById('settings-icon');
        const settingsMenu = document.getElementById('settings-menu');
        const closeSettings = document.getElementById('close-settings');
        const resetDefaults = document.getElementById('reset-defaults');
        
        let mouseTimer;
        let cursorVisible = false;
        
        // Show/hide cursor and settings icon
        document.addEventListener('mousemove', () => {
            if (!cursorVisible) {
                document.body.classList.add('cursor-visible');
                settingsIcon.classList.add('visible');
                cursorVisible = true;
            }
            
            clearTimeout(mouseTimer);
            mouseTimer = setTimeout(() => {
                document.body.classList.remove('cursor-visible');
                settingsIcon.classList.remove('visible');
                cursorVisible = false;
            }, 2000);
        });
        
        // Settings menu controls
        settingsIcon.addEventListener('click', () => {
            settingsMenu.style.display = 'block';
        });
        
        closeSettings.addEventListener('click', () => {
            settingsMenu.style.display = 'none';
        });
        
        resetDefaults.addEventListener('click', () => {
            this.resetToDefaults();
        });
        
        // Setting controls
        this.setupSettingControls();
    // Sync UI with defaults on first load
    this.resetToDefaults();
    }
    
    resetToDefaults() {
        this.settings = JSON.parse(JSON.stringify(this.defaultSettings));
        
        // Update UI elements
        document.getElementById('fall-speed').value = this.settings.fallSpeed;
        document.getElementById('fall-speed-value').textContent = this.settings.fallSpeed;
        
        document.getElementById('fade-rate').value = this.settings.fadeRate;
        document.getElementById('fade-rate-value').textContent = this.settings.fadeRate;
        
        document.getElementById('font-size').value = this.settings.fontSize;
        document.getElementById('font-size-value').textContent = this.settings.fontSize;
        
        document.getElementById('bold-font').checked = this.settings.boldFont;
        
        document.getElementById('hue').value = this.settings.hue;
        document.getElementById('hue-value').textContent = this.settings.hue;
        
        document.getElementById('color-mode').value = this.settings.colorMode;
        
        document.getElementById('glow-intensity').value = this.settings.glowIntensity;
        document.getElementById('glow-intensity-value').textContent = this.settings.glowIntensity;
        
        document.getElementById('glow-radius').value = this.settings.glowRadius;
        document.getElementById('glow-radius-value').textContent = this.settings.glowRadius;
        
        document.getElementById('mutation-rate').value = this.settings.mutationRate;
        document.getElementById('mutation-rate-value').textContent = this.settings.mutationRate;
        
        // Update checkboxes
        Object.keys(this.settings.characterSets).forEach(setName => {
            const checkbox = document.getElementById(setName);
            if (checkbox) {
                checkbox.checked = this.settings.characterSets[setName];
            }
        });
        const cfCheckbox = document.getElementById('complete-fade');
        if (cfCheckbox) cfCheckbox.checked = this.settings.completeFade;
        
        // Reinitialize drops with new font size
        this.initializeDrops();
    }
    
    setupSettingControls() {
        // Fall Speed
        const fallSpeedSlider = document.getElementById('fall-speed');
        const fallSpeedValue = document.getElementById('fall-speed-value');
        fallSpeedSlider.addEventListener('input', (e) => {
            this.settings.fallSpeed = parseFloat(e.target.value);
            fallSpeedValue.textContent = e.target.value;
        });
        
        // Fade Rate
        const fadeRateSlider = document.getElementById('fade-rate');
        const fadeRateValue = document.getElementById('fade-rate-value');
        fadeRateSlider.addEventListener('input', (e) => {
            this.settings.fadeRate = parseFloat(e.target.value);
            fadeRateValue.textContent = e.target.value;
        });
        // Complete Fade
        const completeFadeCheckbox = document.getElementById('complete-fade');
        if (completeFadeCheckbox) {
            completeFadeCheckbox.checked = this.settings.completeFade;
            completeFadeCheckbox.addEventListener('change', (e) => {
                this.settings.completeFade = e.target.checked;
            });
        }
        
        // Font Size
        const fontSizeSlider = document.getElementById('font-size');
        const fontSizeValue = document.getElementById('font-size-value');
        fontSizeSlider.addEventListener('input', (e) => {
            this.settings.fontSize = parseInt(e.target.value);
            fontSizeValue.textContent = e.target.value;
            this.initializeDrops(); // Reinitialize with new font size
        });
        
        // Bold Font
        const boldFontCheckbox = document.getElementById('bold-font');
        boldFontCheckbox.addEventListener('change', (e) => {
            this.settings.boldFont = e.target.checked;
        });
        
        // Hue
        const hueSlider = document.getElementById('hue');
        const hueValue = document.getElementById('hue-value');
        hueSlider.addEventListener('input', (e) => {
            this.settings.hue = parseInt(e.target.value);
            hueValue.textContent = e.target.value;
            // Automatically switch to custom hue mode when hue is manually changed
            this.settings.colorMode = 'custom-hue';
            document.getElementById('color-mode').value = 'custom-hue';
        });
        
        // Color Mode
        const colorModeSelect = document.getElementById('color-mode');
        colorModeSelect.addEventListener('change', (e) => {
            this.settings.colorMode = e.target.value;
        });
        
        // Glow Intensity
        const glowSlider = document.getElementById('glow-intensity');
        const glowValue = document.getElementById('glow-intensity-value');
        glowSlider.addEventListener('input', (e) => {
            this.settings.glowIntensity = parseInt(e.target.value);
            glowValue.textContent = e.target.value;
        });
        
        // Glow Radius
        const glowRadiusSlider = document.getElementById('glow-radius');
        const glowRadiusValue = document.getElementById('glow-radius-value');
        glowRadiusSlider.addEventListener('input', (e) => {
            this.settings.glowRadius = parseInt(e.target.value);
            glowRadiusValue.textContent = e.target.value;
        });
        
        // Mutation Rate
        const mutationSlider = document.getElementById('mutation-rate');
        const mutationValue = document.getElementById('mutation-rate-value');
        mutationSlider.addEventListener('input', (e) => {
            this.settings.mutationRate = parseFloat(e.target.value);
            mutationValue.textContent = e.target.value;
        });
        
        // Character set checkboxes
        Object.keys(this.settings.characterSets).forEach(setName => {
            const checkbox = document.getElementById(setName);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    this.settings.characterSets[setName] = e.target.checked;
                });
            }
        });
    }
    
    getColor(column, row) {
        const time = Date.now() * 0.001;
        
        switch (this.settings.colorMode) {
            case 'rainbow-trails':
                return `hsl(${this.trailHues[column]}, 80%, 50%)`;
                
            case 'wave':
                const waveHue = (this.settings.hue + (column * 10) + (time * 50)) % 360;
                return `hsl(${waveHue}, 80%, 50%)`;
                
            case 'pulse':
                const pulseIntensity = (Math.sin(time * 3) + 1) * 0.5;
                const pulseBrightness = 30 + (pulseIntensity * 40);
                return `hsl(${this.settings.hue}, 80%, ${pulseBrightness}%)`;
                
            case 'fire':
                const fireHue = 0 + Math.sin(time * 2 + column * 0.1) * 20;
                const fireSat = 80 + Math.sin(time * 3 + column * 0.2) * 20;
                const fireBright = 40 + Math.sin(time * 4 + row * 0.1) * 30;
                return `hsl(${fireHue}, ${fireSat}%, ${fireBright}%)`;
                
            case 'ocean':
                const oceanHue = 180 + Math.sin(time * 1.5 + column * 0.15) * 60;
                const oceanBright = 40 + Math.sin(time * 2 + row * 0.1) * 30;
                return `hsl(${oceanHue}, 80%, ${oceanBright}%)`;
                
            case 'neon':
                const neonColors = [300, 60, 180, 0, 240]; // Pink, Yellow, Cyan, Red, Blue
                const neonIndex = Math.floor(time * 0.5 + column * 0.2) % neonColors.length;
                return `hsl(${neonColors[neonIndex]}, 100%, 60%)`;
                
            case 'cyberpunk':
                const cyberpunkHue = (time * 100 + column * 50) % 2 < 1 ? 300 : 180; // Pink or Cyan
                const cyberpunkBright = 50 + Math.sin(time * 5) * 20;
                return `hsl(${cyberpunkHue}, 100%, ${cyberpunkBright}%)`;
                
            case 'plasma':
                const plasmaR = Math.sin(time * 2 + column * 0.1 + row * 0.05) * 127 + 128;
                const plasmaG = Math.sin(time * 2.5 + column * 0.12 + row * 0.06) * 127 + 128;
                const plasmaB = Math.sin(time * 3 + column * 0.14 + row * 0.07) * 127 + 128;
                return `rgb(${Math.floor(plasmaR)}, ${Math.floor(plasmaG)}, ${Math.floor(plasmaB)})`;
                
            case 'random':
                const randomHue = (this.settings.hue + (Math.random() * 60 - 30) + 360) % 360;
                return `hsl(${randomHue}, 80%, 50%)`;
                
            case 'custom-hue':
                return `hsl(${this.settings.hue}, 80%, 50%)`;
                
            default: // classic
                return `hsl(${this.settings.hue}, 80%, 50%)`;
        }
    }
    
    applyMutation(char, column, row) {
        const mutationKey = `${column}-${row}`;
        
        // Check if we should apply a new mutation
        if (Math.random() < this.settings.mutationRate) {
            const activeChars = this.getActiveCharacters();
            if (activeChars.length > 0) {
                this.mutations[column][mutationKey] = {
                    char: activeChars[Math.floor(Math.random() * activeChars.length)],
                    timer: 30 + Math.random() * 60 // frames to keep mutation
                };
            }
        }
        
        // Use existing mutation if it exists
        if (this.mutations[column][mutationKey]) {
            const mutation = this.mutations[column][mutationKey];
            mutation.timer--;
            
            if (mutation.timer <= 0) {
                delete this.mutations[column][mutationKey];
                return char; // Return to original
            }
            
            return mutation.char;
        }
        
        return char;
    }
    
    draw(delta) {
        const activeChars = this.getActiveCharacters();
        if (activeChars.length === 0) return;

        const fadeAlpha = this.settings.completeFade ? 1 : this.settings.fadeRate;
        this.ctx.fillStyle = `rgba(0, 0, 0, ${fadeAlpha})`;
        // Use CSS pixel size for fillRect after scaling the context
        this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

        const fontWeight = this.settings.boldFont ? 'bold' : 'normal';
        this.ctx.font = `${fontWeight} ${this.settings.fontSize}px 'Courier New', monospace`;
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';

        for (let i = 0; i < this.drops.length; i++) {
            // Update drop position based on elapsed time
            if (!Number.isFinite(delta)) continue;
            this.drops[i] += this.settings.fallSpeed * delta;
            const row = Math.floor(this.drops[i]);

            // Random character from active character sets
            let char = activeChars[Math.floor(Math.random() * activeChars.length)];
            
            // Apply mutation
            char = this.applyMutation(char, i, row);
            
            // Get color for this position
            const color = this.getColor(i, row);
            
            // Optional: animate rainbow trail hue per column
            if (this.settings.colorMode === 'rainbow-trails') {
                this.trailHues[i] = (this.trailHues[i] + 60 * delta) % 360;
            }

            const x = i * this.settings.fontSize;
            const y = this.drops[i] * this.settings.fontSize;
            this.ctx.fillStyle = color;

            // Glow pre-pass for bloom effect
            if (this.settings.glowIntensity > 0) {
                const baseGlow = this.settings.glowRadius * this.trailGlowStrength[i] * (1 + this.settings.glowIntensity / 10);
                const effectiveGlow = Math.min(baseGlow, 30);
                this.ctx.shadowColor = color;
                this.ctx.shadowBlur = effectiveGlow;
                this.ctx.shadowOffsetX = 0;
                this.ctx.shadowOffsetY = 0;
                const glowAlpha = Math.min(1, 0.25 + this.settings.glowIntensity / 20);
                const prevAlpha = this.ctx.globalAlpha;
                this.ctx.globalAlpha = glowAlpha;
                this.ctx.fillText(char, x, y);
                this.ctx.globalAlpha = prevAlpha;
            }

            // Crisp glyph
            this.ctx.shadowBlur = 0;
            this.ctx.fillText(char, x, y);
            
            // Reset drop to top with random delay when it goes off screen
            if (this.drops[i] * this.settings.fontSize > this.cssHeight && Math.random() > 0.975) {
                this.drops[i] = -Math.random() * 100; // Start above screen
                // Reset trail properties
                if (this.settings.colorMode === 'rainbow-trails') {
                    this.trailHues[i] = Math.random() * 360;
                }
                this.trailGlowStrength[i] = 0.3 + Math.random() * 0.7; // New random glow strength
                // Clear mutations for this column
                this.mutations[i] = {};
            }
        }
        
        // Reset shadow to prevent affecting other elements
        this.ctx.shadowBlur = 0;
    }
    
    animate(timestamp) {
        if (!this.lastFrameTime) this.lastFrameTime = timestamp || performance.now();
        const now = timestamp || performance.now();
        const delta = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;
        this.draw(delta);
        requestAnimationFrame((t) => this.animate(t));
    }
}

// Initialize the Matrix rain effect when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MatrixRain();
});