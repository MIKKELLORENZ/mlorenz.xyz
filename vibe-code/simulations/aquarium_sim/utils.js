// utils.js - Helper functions and utilities

// Create global namespace
window.AquariumSim = window.AquariumSim || {};

(function(ns) {
'use strict';

// Seeded random number generator for deterministic simulation
class SeededRandom {
    constructor(seed = Date.now()) {
        this.seed = seed;
        this.current = seed;
    }

    next() {
        this.current = (this.current * 1103515245 + 12345) & 0x7fffffff;
        return this.current / 0x7fffffff;
    }

    range(min, max) {
        return min + this.next() * (max - min);
    }

    int(min, max) {
        return Math.floor(this.range(min, max + 1));
    }

    chance(probability) {
        return this.next() < probability;
    }

    pick(array) {
        return array[this.int(0, array.length - 1)];
    }

    shuffle(array) {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.int(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
}

// Math utilities
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const inverseLerp = (a, b, value) => (value - a) / (b - a);
const remap = (value, inMin, inMax, outMin, outMax) => 
    lerp(outMin, outMax, inverseLerp(inMin, inMax, value));
const smoothstep = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// Vector utilities
const vec2 = {
    create: (x = 0, y = 0) => ({ x, y }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
    scale: (v, s) => ({ x: v.x * s, y: v.y * s }),
    length: (v) => Math.sqrt(v.x * v.x + v.y * v.y),
    normalize: (v) => {
        const len = vec2.length(v);
        return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
    },
    distance: (a, b) => vec2.length(vec2.sub(a, b)),
    dot: (a, b) => a.x * b.x + a.y * b.y,
    lerp: (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }),
    angle: (v) => Math.atan2(v.y, v.x),
    fromAngle: (angle, length = 1) => ({ x: Math.cos(angle) * length, y: Math.sin(angle) * length }),
    rotate: (v, angle) => ({
        x: v.x * Math.cos(angle) - v.y * Math.sin(angle),
        y: v.x * Math.sin(angle) + v.y * Math.cos(angle)
    })
};

// Formatting utilities
const formatNumber = (num, decimals = 1) => {
    if (num === undefined || num === null || isNaN(num)) return '—';
    return num.toFixed(decimals);
};

const formatTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    const days = Math.floor(hours / 24);
    const displayHours = hours % 24;
    
    if (days > 0) {
        return `Day ${days + 1}, ${String(displayHours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
    return `${String(displayHours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const formatDuration = (minutes) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
    return `${(minutes / 1440).toFixed(1)}d`;
};

// Color utilities
const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
};

const rgbToHex = (r, g, b) => 
    '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');

const lerpColor = (color1, color2, t) => {
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
    return rgbToHex(
        lerp(c1.r, c2.r, t),
        lerp(c1.g, c2.g, t),
        lerp(c1.b, c2.b, t)
    );
};

const rgba = (r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${a})`;

// Event bus for decoupled communication
class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (this.listeners.has(event)) {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
        }
    }

    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(cb => cb(data));
        }
    }
}

// Ring buffer for history data
class RingBuffer {
    constructor(capacity) {
        this.capacity = capacity;
        this.data = [];
        this.start = 0;
    }

    push(item) {
        if (this.data.length < this.capacity) {
            this.data.push(item);
        } else {
            this.data[this.start] = item;
            this.start = (this.start + 1) % this.capacity;
        }
    }

    toArray() {
        if (this.data.length < this.capacity) {
            return [...this.data];
        }
        return [...this.data.slice(this.start), ...this.data.slice(0, this.start)];
    }

    get length() {
        return this.data.length;
    }

    get last() {
        if (this.data.length === 0) return undefined;
        const index = this.data.length < this.capacity 
            ? this.data.length - 1 
            : (this.start - 1 + this.capacity) % this.capacity;
        return this.data[index];
    }

    clear() {
        this.data = [];
        this.start = 0;
    }
}

// Unique ID generator
let idCounter = 0;
const generateId = () => `entity_${++idCounter}_${Date.now().toString(36)}`;

// Deep clone utility
const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

// Debounce utility
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};

// Throttle utility
const throttle = (func, limit) => {
    let inThrottle;
    return (...args) => {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

// Check if value is in range
const inRange = (value, min, max) => value >= min && value <= max;

// Calculate stress from parameter being outside comfort range
const calculateParameterStress = (value, min, max, criticalMin, criticalMax) => {
    if (value >= min && value <= max) return 0;
    
    if (value < min) {
        const distance = min - value;
        const criticalDistance = min - criticalMin;
        return clamp(distance / criticalDistance, 0, 1);
    } else {
        const distance = value - max;
        const criticalDistance = criticalMax - max;
        return clamp(distance / criticalDistance, 0, 1);
    }
};

// Create a gradient stops array
const createGradientStops = (colors) => {
    return colors.map((color, i) => ({
        offset: i / (colors.length - 1),
        color
    }));
};

// Storage utilities
const storage = {
    save: (key, data) => {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('Failed to save to localStorage:', e);
            return false;
        }
    },
    
    load: (key) => {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Failed to load from localStorage:', e);
            return null;
        }
    },
    
    remove: (key) => {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            return false;
        }
    }
};

// Performance monitoring
class PerformanceMonitor {
    constructor(sampleSize = 60) {
        this.samples = [];
        this.sampleSize = sampleSize;
        this.lastTime = performance.now();
    }

    tick() {
        const now = performance.now();
        const delta = now - this.lastTime;
        this.lastTime = now;
        
        this.samples.push(delta);
        if (this.samples.length > this.sampleSize) {
            this.samples.shift();
        }
    }

    get fps() {
        if (this.samples.length === 0) return 0;
        const avgDelta = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        return 1000 / avgDelta;
    }

    get avgFrameTime() {
        if (this.samples.length === 0) return 0;
        return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    }
}

// Export to namespace
ns.SeededRandom = SeededRandom;
ns.clamp = clamp;
ns.lerp = lerp;
ns.inverseLerp = inverseLerp;
ns.remap = remap;
ns.smoothstep = smoothstep;
ns.easeInOut = easeInOut;
ns.vec2 = vec2;
ns.formatNumber = formatNumber;
ns.formatTime = formatTime;
ns.formatDuration = formatDuration;
ns.hexToRgb = hexToRgb;
ns.rgbToHex = rgbToHex;
ns.lerpColor = lerpColor;
ns.rgba = rgba;
ns.EventBus = EventBus;
ns.RingBuffer = RingBuffer;
ns.generateId = generateId;
ns.deepClone = deepClone;
ns.debounce = debounce;
ns.throttle = throttle;
ns.inRange = inRange;
ns.calculateParameterStress = calculateParameterStress;
ns.createGradientStops = createGradientStops;
ns.storage = storage;
ns.PerformanceMonitor = PerformanceMonitor;

})(window.AquariumSim);
