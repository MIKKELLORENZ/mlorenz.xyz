// Base Wallpaper class + global registry.
// Theme files extend Wallpaper and call LiveWallpaper.register(...).

(function (global) {
    'use strict';

    class Wallpaper {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            // CSS-pixel size of the canvas; updated each resize.
            this.width = canvas.width;
            this.height = canvas.height;
            this.dpr = 1;
        }

        // Called once after construction.
        init() {}

        // Called when the canvas CSS size changes (also called once after init).
        // w, h are in CSS pixels.
        resize(w, h) {
            this.width = w;
            this.height = h;
        }

        // Called every animation frame.
        // t = total ms since wallpaper start; dt = ms since last frame (clamped).
        render(t, dt) {}

        // Called when switching away to free resources.
        destroy() {}

        // ---------- shared helpers ----------

        clear(color) {
            const c = this.ctx;
            if (color) {
                c.fillStyle = color;
                c.fillRect(0, 0, this.width, this.height);
            } else {
                c.clearRect(0, 0, this.width, this.height);
            }
        }

        lerp(a, b, t) { return a + (b - a) * t; }

        clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

        smoothstep(a, b, t) {
            const x = this.clamp((t - a) / (b - a), 0, 1);
            return x * x * (3 - 2 * x);
        }

        // Viewport-relative scale for sprites drawn in fixed local pixels.
        // Architecture lays out proportionally (w/h fractions), but actors and
        // props authored in absolute px need this multiplier to keep their
        // size relative to buildings consistent across resolutions.
        sceneScale(ref = 720, lo = 0.8, hi = 2.2) {
            return this.clamp(this.height / ref, lo, hi);
        }

        // Deterministic [0,1) PRNG (mulberry32) for reproducible scene layouts.
        rng(seed) {
            let s = seed >>> 0;
            return function () {
                s = (s + 0x6D2B79F5) >>> 0;
                let t = s;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }

        hexToRgb(hex) {
            // Tolerate already-parsed rgb()/rgba() strings so chained mixColor() calls work.
            if (typeof hex === 'string' && /^rgba?\(/.test(hex)) {
                const m = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                if (m) return { r: +m[1], g: +m[2], b: +m[3] };
            }
            const h = hex.replace('#', '');
            const n = parseInt(h.length === 3
                ? h.split('').map(c => c + c).join('')
                : h, 16);
            return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
        }

        // Mix two hex colors. t in [0,1].
        mixColor(a, b, t) {
            const ca = this.hexToRgb(a);
            const cb = this.hexToRgb(b);
            return `rgb(${Math.round(ca.r + (cb.r - ca.r) * t)},${Math.round(ca.g + (cb.g - ca.g) * t)},${Math.round(ca.b + (cb.b - ca.b) * t)})`;
        }

        rgba(r, g, b, a) { return `rgba(${r|0},${g|0},${b|0},${a})`; }
    }

    // ---------- Registry ----------
    const registry = [];

    const LiveWallpaper = {
        register(def) {
            if (!def || !def.id || !def.factory) {
                console.warn('LiveWallpaper.register: missing id or factory', def);
                return;
            }
            if (registry.some(r => r.id === def.id)) {
                console.warn('LiveWallpaper.register: duplicate id', def.id);
                return;
            }
            registry.push({
                id: def.id,
                name: def.name || def.id,
                description: def.description || '',
                factory: def.factory,
            });
        },
        list() { return registry.slice(); },
        get(id) { return registry.find(r => r.id === id) || null; },
    };

    global.Wallpaper = Wallpaper;
    global.LiveWallpaper = LiveWallpaper;
})(window);
