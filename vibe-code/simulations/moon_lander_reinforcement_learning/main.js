'use strict';

(() => {

const WORLD_W = 9600;
const WORLD_H = 760;
const VIEW_W = 1200;
const VIEW_H = 700;
const DT = 1 / 60;

const OXYGEN_MAX = 60;
const FUEL_MAX = 1700;
const GRAVITY = 27;
const MAIN_THRUST = 65;
const SIDE_THRUST = 27;
const TURN_ACCEL = 90 * Math.PI / 180;
const MAIN_FUEL_COST = 0.49;
const AUX_FUEL_COST = 0.14;
const SAFE_LANDING_SPEED = 57;
const SAFE_LANDING_ANGLE = Math.PI / 6;
const PAD_FUEL_REWARD = 330;
const PAD_OXYGEN_REWARD = 17;
const LANDING_BONUS = 50;

const LANDER_FEET_Y = 26;
const LANDER_BODY_Y = 20;
const LANDER_HALF_W = 18;

const PAD_SENSE_R = VIEW_W;
const RAY_MAX = 600;
const RAY_MEMORY = 10;
const RAY_LAG = 6;
const RAY_ANGLES = [-90, -60, -30, 0, 30, 60, 90].map(d => d * Math.PI / 180);
const N_RAYS = RAY_ANGLES.length;

const N_IN = 32, N_H1 = 24, N_H2 = 16, N_OUT = 3;
const OFF_WXH = 0;
const OFF_WHH = OFF_WXH + N_IN * N_H1;
const OFF_BH = OFF_WHH + N_H1 * N_H1;
const OFF_W12 = OFF_BH + N_H1;
const OFF_B2 = OFF_W12 + N_H1 * N_H2;
const OFF_WHY = OFF_B2 + N_H2;
const OFF_BY = OFF_WHY + N_H2 * N_OUT;
const GENOME_SIZE = OFF_BY + N_OUT;

const POP_DEFAULT = 64;
const N_EPISODES = 3;
const N_ELITE = 4;
const N_FRESH = 4;
const CHAMP_FRACTION = 0.28;
const SPEED_STOPS = [0.5, 1, 2, 4, 8, 16, 32, Infinity];

const SPEED_SCALE = 180;
const ACCEL_SCALE = 120;
const ANGVEL_SCALE = 3;

const LAND_REWARD = 1800;
const APPROACH_REWARD = 280;
const CRASH_PENALTY = 700;
const JERK_COST = 0.22;
const SPIN_COST = 0.065;
const FUEL_DRIFT_COST = 0.004;
const WANDER_COST = 10;
const LOW_RESOURCE_COST = 15;
const PAD_IDLE_GRACE = 1.4;
const PAD_IDLE_COST = 22;
const TOP_GHOSTS = 12;
const CAMERA_LERP = 0.14;
const POP_LIMIT = 64;
const SURVIVAL_CHAMPION_MUTANT_MIN = 5;
const SURVIVAL_CHAMPION_MUTANT_MAX = 7;
const SURVIVAL_FRESH_FRACTION = 0.14;
const BRAIN_STORAGE_KEY = 'neural_moon_landers_brain_v1';
const POLICY_STORAGE_KEY = 'neural_moon_landers_policy_v1';
const POLICY_LIBRARY_KEY = 'neural_moon_landers_policy_library_v1';
const CHAMPION_LIBRARY_KEY = 'neural_moon_landers_champion_library_v1';
const POLICY_TRIALS = 10;
const POLICY_GENS = 50;
const POLICY_PARALLEL = 2;

const POLICY_DEFAULTS = Object.freeze({
    approachReward: APPROACH_REWARD,
    crashPenalty: CRASH_PENALTY,
    spinCost: SPIN_COST,
    fuelDriftCost: FUEL_DRIFT_COST,
    wanderCost: WANDER_COST,
    lowResourceCost: LOW_RESOURCE_COST,
    padIdleGrace: PAD_IDLE_GRACE,
    padIdleCost: PAD_IDLE_COST,
    cueRangeMultiplier: 1.6,
    remoteCueSignalCap: 0.38,
    remoteApproachCap: 0.56,
    corridorScale: 2.2,
    verticalScale: 0.6,
    lowAltitudeScale: 0.92,
});

const POLICY_LIMITS = Object.freeze({
    approachReward: [180, 430],
    crashPenalty: [560, 980],
    spinCost: [0.035, 0.12],
    fuelDriftCost: [0.002, 0.008],
    wanderCost: [5, 18],
    lowResourceCost: [8, 32],
    padIdleGrace: [0.5, 2.5],
    padIdleCost: [8, 42],
    cueRangeMultiplier: [1.2, 2.45],
    remoteCueSignalCap: [0.18, 0.62],
    remoteApproachCap: [0.32, 0.8],
    corridorScale: [1.55, 3.0],
    verticalScale: [0.42, 0.82],
    lowAltitudeScale: [0.68, 1.12],
});

const POLICY_FIELDS = [
    { key: 'approachReward', label: 'Approach reward', step: '1' },
    { key: 'crashPenalty', label: 'Crash penalty', step: '1' },
    { key: 'spinCost', label: 'Spin cost', step: '0.001' },
    { key: 'fuelDriftCost', label: 'Fuel drift cost', step: '0.001' },
    { key: 'wanderCost', label: 'Wander cost', step: '0.1' },
    { key: 'lowResourceCost', label: 'Low resource cost', step: '0.1' },
    { key: 'padIdleGrace', label: 'Pad idle grace', step: '0.1' },
    { key: 'padIdleCost', label: 'Pad idle cost', step: '0.1' },
    { key: 'cueRangeMultiplier', label: 'Cue range multiplier', step: '0.01' },
    { key: 'remoteCueSignalCap', label: 'Remote cue cap', step: '0.01' },
    { key: 'remoteApproachCap', label: 'Remote approach cap', step: '0.01' },
    { key: 'corridorScale', label: 'Corridor scale', step: '0.01' },
    { key: 'verticalScale', label: 'Vertical scale', step: '0.01' },
    { key: 'lowAltitudeScale', label: 'Low altitude scale', step: '0.01' },
];

const TERRAIN_COLORS = ['#ffbe6b', '#7ad7ff', '#95e58f', '#ff8f6b'];
const TERRAIN_DEFS = [
    {
        name: 'Tranquility',
        baseY: 560,
        amp1: 32,
        amp2: 18,
        amp3: 9,
        wave1: 2.6,
        wave2: 6.2,
        wave3: 13.4,
        noise: 10,
        minY: 360,
        maxY: 650,
        padSpacingMin: 520,
        padSpacingMax: 760,
    },
    {
        name: 'Crater Ladder',
        baseY: 545,
        amp1: 46,
        amp2: 25,
        amp3: 14,
        wave1: 3.2,
        wave2: 7.0,
        wave3: 14.6,
        noise: 16,
        minY: 320,
        maxY: 655,
        padSpacingMin: 500,
        padSpacingMax: 690,
    },
    {
        name: 'Basalt Teeth',
        baseY: 530,
        amp1: 54,
        amp2: 34,
        amp3: 18,
        wave1: 3.8,
        wave2: 8.2,
        wave3: 16.4,
        noise: 22,
        minY: 300,
        maxY: 660,
        padSpacingMin: 460,
        padSpacingMax: 650,
    },
    {
        name: 'Needle Rift',
        baseY: 515,
        amp1: 64,
        amp2: 38,
        amp3: 22,
        wave1: 4.2,
        wave2: 9.0,
        wave3: 18.5,
        noise: 26,
        minY: 280,
        maxY: 668,
        padSpacingMin: 430,
        padSpacingMax: 610,
    },
];

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

function clampPolicyValue(key, value) {
    const limits = POLICY_LIMITS[key];
    return limits ? clamp(value, limits[0], limits[1]) : value;
}

function normalizePolicyConfig(config = {}) {
    const out = {};
    for (const key of Object.keys(POLICY_DEFAULTS)) {
        const value = config[key] ?? POLICY_DEFAULTS[key];
        out[key] = clampPolicyValue(key, value);
    }
    return out;
}

function mutatePolicyConfig(config, scale = 1) {
    const next = normalizePolicyConfig(config);
    for (const key of Object.keys(POLICY_DEFAULTS)) {
        const [lo, hi] = POLICY_LIMITS[key];
        const span = hi - lo;
        const delta = gauss() * span * 0.12 * scale;
        next[key] = clampPolicyValue(key, next[key] + delta);
    }
    return next;
}

function crossoverPolicyConfig(a, b) {
    const out = {};
    for (const key of Object.keys(POLICY_DEFAULTS)) {
        out[key] = Math.random() < 0.5 ? a[key] : b[key];
    }
    return normalizePolicyConfig(out);
}

function scorePolicyResult(result) {
    return result.peakPads * 1e6
        + result.finalPads * 1e5
        + result.meanPads * 1e4
        + result.peakScore * 20
        + result.meanScore;
}

function policySummary(policy) {
    return `pads-first · cue ${policy.cueRangeMultiplier.toFixed(2)} · approach ${policy.approachReward.toFixed(0)} · idle ${policy.padIdleCost.toFixed(0)} · wander ${policy.wanderCost.toFixed(1)}`;
}

function normalizeTrainingMode(mode) {
    return mode === 'survival' || mode === 'evolutionary' ? 'survival' : 'classic';
}

function trainingModeValue(mode) {
    return normalizeTrainingMode(mode) === 'survival' ? 'evolutionary' : 'reinforcement';
}

function algorithmLabel(mode) {
    return normalizeTrainingMode(mode) === 'survival' ? 'Evolutionary algorithm' : 'Reinforcement learning';
}

function parseLibrary(key) {
    try {
        return JSON.parse(localStorage.getItem(key)) || {};
    } catch (err) {
        return {};
    }
}

function saveLibrary(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function loadPolicyLibrary() {
    const library = parseLibrary(POLICY_LIBRARY_KEY);
    for (const [name, record] of Object.entries(library)) {
        record.config = normalizePolicyConfig(record.config || {});
        record.mode = normalizeTrainingMode(record.mode || 'classic');
    }
    const legacy = loadSavedPolicyRecord();
    if (legacy && !library[legacy.label || 'Imported winner']) {
        library[legacy.label || 'Imported winner'] = {
            config: legacy.config,
            mode: normalizeTrainingMode(legacy.algorithm || 'classic'),
            saved: legacy.saved || Date.now(),
        };
    }
    if (!library.Baseline) {
        library.Baseline = {
            config: normalizePolicyConfig(POLICY_DEFAULTS),
            mode: 'classic',
            saved: Date.now(),
        };
    }
    return library;
}

function loadChampionLibrary() {
    const library = parseLibrary(CHAMPION_LIBRARY_KEY);
    for (const record of Object.values(library)) {
        record.mode = normalizeTrainingMode(record.mode || 'classic');
    }
    return library;
}

function loadSavedPolicyRecord() {
    try {
        const data = JSON.parse(localStorage.getItem(POLICY_STORAGE_KEY));
        if (!data || !data.config) return null;
        const record = {
            ...data,
            config: normalizePolicyConfig(data.config),
            algorithm: data.algorithm || 'classic',
        };
        record.fitness = scorePolicyResult({
            peakPads: record.peakPads || 0,
            finalPads: record.finalPads || 0,
            meanPads: record.meanPads || 0,
            peakScore: record.peakScore || 0,
            meanScore: record.meanScore || 0,
        });
        return record;
    } catch (err) {
        return null;
    }
}

function savePolicyRecord(record) {
    try {
        localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify({
            label: record.label,
            config: normalizePolicyConfig(record.config),
            algorithm: record.algorithm || 'classic',
            peakPads: record.peakPads,
            finalPads: record.finalPads,
            peakScore: record.peakScore,
            meanPads: record.meanPads,
            meanScore: record.meanScore,
            saved: Date.now(),
        }));
        return true;
    } catch (err) {
        return false;
    }
}

let gaussSpare = null;
function gauss() {
    if (gaussSpare !== null) {
        const v = gaussSpare;
        gaussSpare = null;
        return v;
    }
    let u, v, s;
    do {
        u = Math.random() * 2 - 1;
        v = Math.random() * 2 - 1;
        s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    gaussSpare = v * m;
    return u * m;
}

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ t >>> 15, t | 1);
        r ^= r + Math.imul(r ^ r >>> 7, r | 61);
        return ((r ^ r >>> 14) >>> 0) / 4294967296;
    };
}

function cross(ax, ay, bx, by) {
    return ax * by - ay * bx;
}

function buildTerrain(def, seed) {
    const rng = mulberry32(seed);
    const step = 50;
    const count = Math.floor(WORLD_W / step);
    const phase1 = rng() * Math.PI * 2;
    const phase2 = rng() * Math.PI * 2;
    const phase3 = rng() * Math.PI * 2;
    const points = [];
    for (let i = 0; i <= count; i++) {
        const x = i * step;
        const nx = x / WORLD_W;
        let y = def.baseY
            + Math.sin(nx * Math.PI * def.wave1 + phase1) * def.amp1
            + Math.sin(nx * Math.PI * def.wave2 + phase2) * def.amp2
            + Math.sin(nx * Math.PI * def.wave3 + phase3) * def.amp3
            + (rng() - 0.5) * def.noise;
        y = clamp(y, def.minY, def.maxY);
        points.push({ x, y });
    }

    const pads = [];
    let cursor = 440 + rng() * 90;
    let padId = 0;
    while (cursor < WORLD_W - 260) {
        const idx = clamp(Math.round(cursor / step), 3, points.length - 6);
        const span = rng() < 0.5 ? 2 : 3;
        const end = Math.min(points.length - 3, idx + span);
        let flatY = Infinity;
        for (let k = idx - 1; k <= end + 1; k++) flatY = Math.min(flatY, points[k].y);
        flatY = clamp(flatY - rng() * 8, def.minY, def.maxY);
        for (let k = idx; k <= end; k++) points[k].y = flatY;
        const x0 = points[idx].x;
        const width = points[end].x - points[idx].x;
        pads.push({
            id: padId++,
            x: x0,
            y: flatY,
            width,
            cx: x0 + width * 0.5,
            points: Math.floor(200 - width),
        });
        cursor = x0 + width + def.padSpacingMin + rng() * (def.padSpacingMax - def.padSpacingMin);
    }

    if (!pads.length) {
        const idx = 12;
        const end = idx + 2;
        const y = points[idx].y;
        for (let k = idx; k <= end; k++) points[k].y = y;
        const width = points[end].x - points[idx].x;
        pads.push({ id: 0, x: points[idx].x, y, width, cx: points[idx].x + width * 0.5, points: Math.floor(200 - width) });
    }

    return {
        seed,
        def,
        points,
        pads,
        startPad: pads[0],
    };
}

function findTerrainSegment(points, x) {
    if (x <= points[0].x) return 0;
    if (x >= points[points.length - 2].x) return points.length - 2;
    let lo = 0, hi = points.length - 2;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const p1 = points[mid];
        const p2 = points[mid + 1];
        if (x < p1.x) hi = mid - 1;
        else if (x > p2.x) lo = mid + 1;
        else return mid;
    }
    return clamp(lo, 0, points.length - 2);
}

function terrainInfoAt(template, x) {
    const pts = template.points;
    const idx = findTerrainSegment(pts, clamp(x, 0, WORLD_W));
    const p1 = pts[idx];
    const p2 = pts[idx + 1];
    const span = p2.x - p1.x || 1;
    const t = clamp((x - p1.x) / span, 0, 1);
    const y = lerp(p1.y, p2.y, t);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    const nx = dy / len;
    const ny = -dx / len;
    return { y, idx, tx, ty, nx, ny };
}

function raycastTerrain(template, x, y, dx, dy, maxDist = RAY_MAX) {
    const pts = template.points;
    const endX = x + dx * maxDist;
    const minX = Math.min(x, endX) - 4;
    const maxX = Math.max(x, endX) + 4;
    let start = findTerrainSegment(pts, clamp(minX, 0, WORLD_W));
    let end = findTerrainSegment(pts, clamp(maxX, 0, WORLD_W));
    if (start > end) { const tmp = start; start = end; end = tmp; }
    let best = maxDist;
    for (let i = start; i <= end; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const sx = b.x - a.x;
        const sy = b.y - a.y;
        const denom = cross(dx, dy, sx, sy);
        if (Math.abs(denom) < 1e-7) continue;
        const qpx = a.x - x;
        const qpy = a.y - y;
        const t = cross(qpx, qpy, sx, sy) / denom;
        const u = cross(qpx, qpy, dx, dy) / denom;
        if (t >= 0 && t <= best && u >= 0 && u <= 1) best = t;
    }
    return best;
}

function randomGenome() {
    const g = new Float32Array(GENOME_SIZE);
    for (let i = 0; i < GENOME_SIZE; i++) {
        const scale = (i >= OFF_WHH && i < OFF_BH) ? 0.25 : 0.55;
        g[i] = gauss() * scale;
    }
    return g;
}

class Brain {
    constructor(genome) {
        this.g = genome;
        this.h = new Float32Array(N_H1);
        this.hNext = new Float32Array(N_H1);
        this.h2 = new Float32Array(N_H2);
        this.out = new Float32Array(N_OUT);
    }
    reset() {
        this.h.fill(0);
        this.hNext.fill(0);
        this.h2.fill(0);
        this.out.fill(0);
    }
    step(inp) {
        const { g, h, hNext, h2, out } = this;
        for (let j = 0; j < N_H1; j++) {
            let s = g[OFF_BH + j];
            for (let i = 0; i < N_IN; i++) s += g[OFF_WXH + i * N_H1 + j] * inp[i];
            for (let i = 0; i < N_H1; i++) s += g[OFF_WHH + i * N_H1 + j] * h[i];
            hNext[j] = Math.tanh(s);
        }
        h.set(hNext);
        for (let j = 0; j < N_H2; j++) {
            let s = g[OFF_B2 + j];
            for (let i = 0; i < N_H1; i++) s += g[OFF_W12 + i * N_H2 + j] * h[i];
            h2[j] = Math.tanh(s);
        }
        for (let k = 0; k < N_OUT; k++) {
            let s = g[OFF_BY + k];
            for (let j = 0; j < N_H2; j++) s += g[OFF_WHY + j * N_OUT + k] * h2[j];
            out[k] = Math.tanh(s);
        }
        return out;
    }
}

class Lander {
    constructor(genome, idx) {
        this.idx = idx;
        this.brain = new Brain(genome);
        this.inp = new Float32Array(N_IN);
        this.rays = new Float32Array(N_RAYS);
        this.rayHistory = new Float32Array(N_RAYS * RAY_MEMORY);
        this.bestApproach = [];
        this.trail = [];
        this.fitSum = 0;
        this.scoreSum = 0;
        this.landSum = 0;
        this.spawn(null);
    }

    spawn(template) {
        this.template = template;
        this.padState = template ? new Uint8Array(template.pads.length) : new Uint8Array(0);
        this.bestApproach = template ? new Float32Array(template.pads.length) : new Float32Array(0);
        const pad = template ? template.startPad : { cx: 300, y: 300, width: 100 };
        this.x = pad.cx + (Math.random() * 2 - 1) * 16;
        this.y = pad.y - 200;
        this.vx = (Math.random() * 2 - 1) * 5;
        this.vy = (Math.random() * 2 - 1) * 4;
        this.ax = 0;
        this.ay = 0;
        this.angle = (Math.random() * 2 - 1) * 0.08;
        this.angularVelocity = 0;
        this.fuel = FUEL_MAX;
        this.oxygen = OXYGEN_MAX;
        this.score = 0;
        this.landings = 0;
        this.progress = 0;
        this.penalty = 0;
        this.lifeTime = 0;
        this.alive = true;
        this.crashed = false;
        this.controlsDisabled = false;
        this.landed = false;
        this.altitude = 0;
        this.groundY = pad.y;
        this.landedTimer = 0;
        this.currentPad = -1;
        this.sensorPad = -1;
        this.sensorPadInRange = false;
        this.prevMain = 0;
        this.prevTurn = 0;
        this.prevStrafe = 0;
        this.cmdMain = 0;
        this.cmdTurn = 0;
        this.cmdStrafe = 0;
        this.rays.fill(RAY_MAX);
        this.rayHistory.fill(RAY_MAX);
        this.histPtr = 0;
        this.trail.length = 0;
        this.brain.reset();
    }

    get fitness() {
        return this.score * 10 + this.progress - this.penalty;
    }

    nearestPad(freshOnly = true, withinRangeOnly = false) {
        let bestIdx = -1;
        let bestD2 = withinRangeOnly ? PAD_SENSE_R * PAD_SENSE_R : Infinity;
        for (let i = 0; i < this.template.pads.length; i++) {
            if (freshOnly && this.padState[i]) continue;
            const pad = this.template.pads[i];
            const dx = pad.cx - this.x;
            const dy = pad.y - this.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    sense() {
        const policy = S.policy || POLICY_DEFAULTS;
        const rightX = Math.cos(this.angle);
        const rightY = Math.sin(this.angle);
        const upX = Math.sin(this.angle);
        const upY = -Math.cos(this.angle);
        const downAngle = this.angle + Math.PI / 2;
        for (let i = 0; i < N_RAYS; i++) {
            const a = downAngle + RAY_ANGLES[i];
            const d = raycastTerrain(this.template, this.x, this.y, Math.cos(a), Math.sin(a));
            this.rays[i] = d;
            this.inp[i] = d / RAY_MAX;
        }
        const lagPtr = (this.histPtr - RAY_LAG + RAY_MEMORY) % RAY_MEMORY;
        for (let i = 0; i < N_RAYS; i++) {
            this.inp[N_RAYS + i] = this.rayHistory[lagPtr * N_RAYS + i] / RAY_MAX;
        }

        const visiblePadIdx = this.nearestPad(true, true);
        let padIdx = visiblePadIdx;
        let missionCue = false;
        if (padIdx < 0 && this.landings > 0) {
            padIdx = this.nearestPad(true, false);
            missionCue = padIdx >= 0;
        }
        this.sensorPad = padIdx;
        this.sensorPadInRange = visiblePadIdx >= 0;
        if (padIdx >= 0) {
            const pad = this.template.pads[padIdx];
            const dx = pad.cx - this.x;
            const dy = pad.y - this.y;
            const dist = Math.hypot(dx, dy);
            const cueRange = missionCue ? PAD_SENSE_R * policy.cueRangeMultiplier : PAD_SENSE_R;
            this.inp[14] = clamp((dx * rightX + dy * rightY) / cueRange, -1, 1);
            this.inp[15] = clamp((dx * upX + dy * upY) / cueRange, -1, 1);
            this.inp[16] = missionCue
                ? clamp(1 - dist / (PAD_SENSE_R * (policy.cueRangeMultiplier + 0.6)), 0, policy.remoteCueSignalCap)
                : clamp(1 - dist / PAD_SENSE_R, 0, 1);
        } else {
            this.inp[14] = 0;
            this.inp[15] = 0;
            this.inp[16] = 0;
        }

        const ground = terrainInfoAt(this.template, this.x);
        const localVX = this.vx * rightX + this.vy * rightY;
        const localVY = this.vx * upX + this.vy * upY;
        const groundTX = this.vx * ground.tx + this.vy * ground.ty;
        const groundNY = this.vx * ground.nx + this.vy * ground.ny;
        const localAX = this.ax * rightX + this.ay * rightY;
        const localAY = this.ax * upX + this.ay * upY;
        const altitude = clamp(ground.y - (this.y + LANDER_FEET_Y), 0, RAY_MAX);
        this.altitude = altitude;
        this.groundY = ground.y;
        const speed = Math.hypot(this.vx, this.vy);
        const spinBias = clamp(Math.abs(this.angularVelocity) / (SAFE_LANDING_ANGLE * 2.8), 0, 1);
        const altitudeBias = clamp((altitude - 170) / (RAY_MAX * 0.46), 0, 1);
        const speedBias = clamp(speed / SPEED_SCALE, 0.2, 1.2);

        this.inp[17] = clamp(localVX / SPEED_SCALE, -1, 1);
        this.inp[18] = clamp(localVY / SPEED_SCALE, -1, 1);
        this.inp[19] = clamp(groundTX / SPEED_SCALE, -1, 1);
        this.inp[20] = clamp(groundNY / SPEED_SCALE, -1, 1);
        this.inp[21] = clamp(localAX / ACCEL_SCALE, -1, 1);
        this.inp[22] = clamp(localAY / ACCEL_SCALE, -1, 1);
        this.inp[23] = Math.sin(this.angle);
        this.inp[24] = Math.cos(this.angle);
        this.inp[25] = clamp(this.angularVelocity / ANGVEL_SCALE, -1, 1);
        this.inp[26] = altitude / RAY_MAX;
        this.inp[27] = this.fuel / FUEL_MAX;
        this.inp[28] = this.oxygen / OXYGEN_MAX;
        this.inp[29] = this.prevMain;
        this.inp[30] = this.prevTurn;
        this.inp[31] = this.prevStrafe;

        this.rayHistory[this.histPtr * N_RAYS] = this.rays[0];
        this.rayHistory[this.histPtr * N_RAYS + 1] = this.rays[1];
        this.rayHistory[this.histPtr * N_RAYS + 2] = this.rays[2];
        this.rayHistory[this.histPtr * N_RAYS + 3] = this.rays[3];
        this.rayHistory[this.histPtr * N_RAYS + 4] = this.rays[4];
        this.rayHistory[this.histPtr * N_RAYS + 5] = this.rays[5];
        this.rayHistory[this.histPtr * N_RAYS + 6] = this.rays[6];
        this.histPtr = (this.histPtr + 1) % RAY_MEMORY;

        if (padIdx >= 0) {
            const pad = this.template.pads[padIdx];
            const dx = pad.cx - this.x;
            const dy = pad.y - this.y;
            const dist = Math.hypot(dx, dy);
            const proximity = clamp(1 - dist / (missionCue ? PAD_SENSE_R * (policy.cueRangeMultiplier + 0.6) : PAD_SENSE_R), 0, 1);
            const corridor = clamp(1 - Math.abs(dx) / Math.max(185, pad.width * policy.corridorScale), 0, 1);
            const vertical = clamp(1 - Math.abs(dy) / (PAD_SENSE_R * policy.verticalScale), 0, 1);
            const lowEnough = clamp(1 - altitude / (RAY_MAX * policy.lowAltitudeScale), 0, 1);
            const attitude = clamp(1 - Math.abs(this.angle) / SAFE_LANDING_ANGLE, 0, 1);
            const descent = clamp(1 - Math.max(0, this.vy) / SAFE_LANDING_SPEED, 0, 1);
            const stable = 1 - spinBias;
            if (corridor > 0.08 && stable > 0.04) {
                const approachCap = missionCue ? policy.remoteApproachCap : 1;
                const approach = clamp(
                    proximity * 0.22 + corridor * 0.27 + vertical * 0.15 + lowEnough * 0.12 + attitude * 0.15 + descent * 0.06 + stable * 0.03,
                    0,
                    1,
                ) * approachCap;
                if (approach > this.bestApproach[padIdx]) {
                    this.progress += (approach - this.bestApproach[padIdx]) * policy.approachReward;
                    this.bestApproach[padIdx] = approach;
                }
            }
            this.penalty += (spinBias * 0.14 + (1 - corridor) * 0.05 + altitudeBias * 0.02) * policy.wanderCost * 0.34 * DT;
        } else {
            this.penalty += (0.2 + spinBias * 0.42 + altitudeBias * 0.18) * policy.wanderCost * speedBias * DT;
        }
    }

    successfulLanding(padIdx) {
        const pad = this.template.pads[padIdx];
        if (!this.padState[padIdx]) {
            this.padState[padIdx] = 1;
            this.score += pad.points;
            this.score += LANDING_BONUS;
            this.fuel = Math.min(FUEL_MAX, this.fuel + PAD_FUEL_REWARD);
            this.oxygen = Math.min(OXYGEN_MAX, this.oxygen + PAD_OXYGEN_REWARD);
            this.landings++;
            this.progress += LAND_REWARD + pad.points * 4;
        }
        this.vx = 0;
        this.vy = 0;
        this.angularVelocity = 0;
        this.angle = 0;
        this.landed = true;
        this.landedTimer = 0;
        this.currentPad = padIdx;
        if (this.landings >= this.template.pads.length) this.alive = false;
    }

    crash(vx, vy) {
        const policy = S.policy || POLICY_DEFAULTS;
        this.crashed = true;
        this.alive = false;
        this.landed = false;
        this.currentPad = -1;
        const impact = Math.hypot(vx, vy);
        this.penalty += policy.crashPenalty + Math.min(500, impact * 6);
    }

    step() {
        const policy = S.policy || POLICY_DEFAULTS;
        if (!this.alive) return;

        this.lifeTime += DT;

        this.oxygen -= DT;
        if (this.oxygen <= 0) {
            this.oxygen = 0;
            this.controlsDisabled = true;
        }

        const fuelFrac = this.fuel / FUEL_MAX;
        const oxygenFrac = this.oxygen / OXYGEN_MAX;
    if (fuelFrac < 0.28) this.penalty += (0.28 - fuelFrac) * policy.lowResourceCost * 0.75 * DT;
    if (oxygenFrac < 0.24) this.penalty += (0.24 - oxygenFrac) * policy.lowResourceCost * 1.1 * DT;

        this.sense();
        const out = this.brain.step(this.inp);

        const turn = out[0] < -0.25 ? -1 : out[0] > 0.25 ? 1 : 0;
        const main = out[1] > 0.2 ? 1 : 0;
        const strafe = out[2] < -0.25 ? -1 : out[2] > 0.25 ? 1 : 0;

        this.penalty += (Math.abs(turn - this.prevTurn) + Math.abs(strafe - this.prevStrafe) + Math.abs(main - this.prevMain)) * JERK_COST;
        this.penalty += Math.abs(this.angularVelocity) * policy.spinCost * DT;

        this.cmdTurn = turn;
        this.cmdMain = main;
        this.cmdStrafe = strafe;
        this.prevTurn = turn;
        this.prevMain = main;
        this.prevStrafe = strafe;

        const prevVX = this.vx;
        const prevVY = this.vy;
        if (!this.controlsDisabled && this.fuel > 0) {
            if (main) {
                const adjustedThrust = MAIN_THRUST * (1 + (FUEL_MAX - this.fuel) / FUEL_MAX);
                this.vx += adjustedThrust * Math.sin(this.angle) * DT;
                this.vy -= adjustedThrust * Math.cos(this.angle) * DT;
                this.fuel = Math.max(0, this.fuel - MAIN_FUEL_COST);
            }
            if (turn < 0) {
                this.angularVelocity -= TURN_ACCEL * DT;
                this.fuel = Math.max(0, this.fuel - AUX_FUEL_COST);
            } else if (turn > 0) {
                this.angularVelocity += TURN_ACCEL * DT;
                this.fuel = Math.max(0, this.fuel - AUX_FUEL_COST);
            }
            if (strafe > 0) {
                this.vx += SIDE_THRUST * Math.sin(this.angle - Math.PI / 2) * DT;
                this.vy -= SIDE_THRUST * Math.cos(this.angle - Math.PI / 2) * DT;
                this.fuel = Math.max(0, this.fuel - AUX_FUEL_COST);
            } else if (strafe < 0) {
                this.vx += SIDE_THRUST * Math.sin(this.angle + Math.PI / 2) * DT;
                this.vy -= SIDE_THRUST * Math.cos(this.angle + Math.PI / 2) * DT;
                this.fuel = Math.max(0, this.fuel - AUX_FUEL_COST);
            }
        }

        this.vy += GRAVITY * DT;
        this.x += this.vx * DT;
        this.y += this.vy * DT;
        this.angle += this.angularVelocity * DT;

        if (this.angle > Math.PI) this.angle -= Math.PI * 2;
        if (this.angle < -Math.PI) this.angle += Math.PI * 2;

        this.ax = (this.vx - prevVX) / DT;
        this.ay = (this.vy - prevVY) / DT;
        this.penalty += (MAIN_FUEL_COST * this.cmdMain + AUX_FUEL_COST * (Math.abs(this.cmdTurn) + Math.abs(this.cmdStrafe))) * policy.fuelDriftCost;

        if (this.x < 0 || this.x > WORLD_W) {
            this.crash(this.vx, this.vy);
            return;
        }

        const ground = terrainInfoAt(this.template, this.x);
        if (this.y + LANDER_FEET_Y >= ground.y) {
            this.y = ground.y - LANDER_FEET_Y;
            const verticalSpeed = this.vy;
            const crashVX = this.vx;
            const crashVY = this.vy;
            this.vx = 0;
            this.vy = 0;
            this.angularVelocity = 0;
            if (verticalSpeed > SAFE_LANDING_SPEED || Math.abs(this.angle) > SAFE_LANDING_ANGLE) {
                this.crash(crashVX, crashVY);
                return;
            }
            let padIdx = -1;
            for (let i = 0; i < this.template.pads.length; i++) {
                const pad = this.template.pads[i];
                if (this.x >= pad.x && this.x <= pad.x + pad.width) {
                    padIdx = i;
                    break;
                }
            }
            if (padIdx < 0) {
                this.crash(crashVX, crashVY);
                return;
            }
            if (!this.padState[padIdx]) this.successfulLanding(padIdx);
            else {
                this.landed = true;
                this.currentPad = padIdx;
                this.angle = 0;
            }
            if (this.controlsDisabled) this.alive = false;
        }

        if (this.landed && this.currentPad >= 0) {
            this.landedTimer += DT;
            const pad = this.template.pads[this.currentPad];
            if (this.y + LANDER_BODY_Y < pad.y - 1) {
                this.landed = false;
                this.currentPad = -1;
                this.landedTimer = 0;
            } else if (this.padState[this.currentPad] && this.landedTimer > policy.padIdleGrace) {
                this.penalty += policy.padIdleCost * DT;
            }
        } else {
            this.landedTimer = 0;
        }

        if (this.fuel <= 0 && this.landed) this.alive = false;

        if (this.trail.length > 72) this.trail.shift();
        this.trail.push({ x: this.x, y: this.y });
    }
}

const S = {
    terrainIdx: 0,
    template: null,
    agents: [],
    gen: 1,
    episode: 0,
    simTime: 0,
    paused: false,
    evalMode: false,
    popSize: POP_DEFAULT,
    nextPopSize: POP_DEFAULT,
    mutRate: 8 / GENOME_SIZE,
    speedStop: 3,
    sensorMode: 'leader',
    history: [],
    stepsThisSecond: 0,
    simRate: 0,
    stepCarry: 0,
    cameraX: 0,
    cameraY: 0,
    cameraReady: false,
    trainingEvolutionMode: 'classic',
    policy: normalizePolicyConfig(POLICY_DEFAULTS),
    policyLabel: 'Baseline',
    policyLibrary: {},
    championLibrary: {},
    seedChampionGenome: null,
    seedChampionName: '',
    explorer: {
        active: false,
        completed: false,
        best: null,
        round: 0,
        roundSeed: normalizePolicyConfig(POLICY_DEFAULTS),
        roundEvaluated: [],
        assignedThisRound: 0,
        targetTrials: POLICY_TRIALS,
        gensPerTrial: POLICY_GENS,
        viewMode: 'A',
        lanes: [
            { id: 0, name: 'A', usesMain: true, current: null, state: null },
            { id: 1, name: 'B', usesMain: false, current: null, state: null },
        ],
    },
    recordScore: 0,
    recordPads: 0,
    genBestScore: 0,
    genMeanScore: 0,
    genBestPads: 0,
    genMeanPads: 0,
    seedTicker: 1,
};

function nextSeed() {
    S.seedTicker = (S.seedTicker + 1) >>> 0;
    return (S.seedTicker * 2654435761) >>> 0;
}

function makeTemplate() {
    return buildTerrain(TERRAIN_DEFS[S.terrainIdx], nextSeed());
}

function prepareEpisode() {
    S.template = makeTemplate();
    for (const agent of S.agents) agent.spawn(S.template);
    S.simTime = 0;
    S.stepCarry = 0;
    S.cameraReady = false;
}

function spawnPopulation(genomes) {
    S.agents = genomes.map((g, i) => new Lander(g, i));
    S.episode = 0;
    S.genBestScore = 0;
    S.genMeanScore = 0;
    S.genBestPads = 0;
    S.genMeanPads = 0;
    prepareEpisode();
}

function buildPopulationFromSeed(seedGenome, popSize, mode) {
    const normalizedMode = normalizeTrainingMode(mode);
    const seed = new Float32Array(seedGenome);
    const genomes = [seed];
    if (normalizedMode === 'survival') {
        const freshN = Math.max(4, Math.round(popSize * SURVIVAL_FRESH_FRACTION));
        const champMutants = clamp(SURVIVAL_CHAMPION_MUTANT_MIN + ((Math.random() * 3) | 0), SURVIVAL_CHAMPION_MUTANT_MIN, SURVIVAL_CHAMPION_MUTANT_MAX);
        for (let i = 0; i < champMutants && genomes.length < popSize - freshN; i++) genomes.push(mutateSurvival(seed, i < 2 ? 0.65 : 1 + i * 0.08));
        while (genomes.length < popSize - freshN) genomes.push(crossover(seed, randomGenome()));
        while (genomes.length < popSize) genomes.push(randomGenome());
    } else {
        const freshN = Math.max(N_FRESH, Math.round(popSize * 0.12));
        const champMutants = 6;
        for (let i = 0; i < champMutants && genomes.length < popSize - freshN; i++) genomes.push(mutate(seed, i < 2 ? 0.45 : 0.9));
        while (genomes.length < popSize - freshN) {
            const mate = Math.random() < 0.7 ? seed : randomGenome();
            const child = Math.random() < 0.65 ? mutate(crossover(seed, mate), 0.55 + Math.random() * 0.4) : crossover(seed, mate);
            genomes.push(child);
        }
        while (genomes.length < popSize) genomes.push(randomGenome());
    }
    return genomes;
}

function freshPopulation() {
    const genomes = S.seedChampionGenome
        ? buildPopulationFromSeed(S.seedChampionGenome, S.popSize, S.trainingEvolutionMode)
        : Array.from({ length: S.popSize }, () => randomGenome());
    spawnPopulation(genomes);
}

function applyPolicyConfig(config, label = 'Custom Policy') {
    S.policy = normalizePolicyConfig(config);
    S.policyLabel = label;
}

function resetTrainingSession(clearHistory = true) {
    S.gen = 1;
    S.popSize = Math.min(POP_LIMIT, S.nextPopSize);
    S.recordScore = 0;
    S.recordPads = 0;
    if (clearHistory) S.history.length = 0;
    freshPopulation();
    if (clearHistory) {
        drawChart();
        drawLandings();
    }
    updateStats();
    if (typeof updatePolicyExplorerUI === 'function') updatePolicyExplorerUI();
}

function currentBestAgent() {
    const mode = S.trainingEvolutionMode;
    return [...S.agents].sort((a, b) => rankFitness(b, mode) - rankFitness(a, mode))[0] || S.agents[0] || null;
}

function mutate(g, scale = 1) {
    const copy = new Float32Array(g);
    for (let i = 0; i < GENOME_SIZE; i++) {
        if (Math.random() < S.mutRate) copy[i] += gauss() * 0.28 * scale;
    }
    return copy;
}

function mutateSurvival(g, scale = 1) {
    const copy = new Float32Array(g);
    const smallCount = 2 + ((Math.random() * 10) | 0);
    const largeCount = (Math.random() * 3) | 0;
    for (let i = 0; i < smallCount; i++) {
        const idx = (Math.random() * GENOME_SIZE) | 0;
        copy[idx] += gauss() * 0.14 * scale;
    }
    for (let i = 0; i < largeCount; i++) {
        const idx = (Math.random() * GENOME_SIZE) | 0;
        copy[idx] += gauss() * 0.55 * scale;
    }
    return copy;
}

function crossover(a, b) {
    const c = new Float32Array(GENOME_SIZE);
    for (let i = 0; i < GENOME_SIZE; i++) c[i] = Math.random() < 0.5 ? a[i] : b[i];
    return c;
}

function resolveEvolutionMode(baseMode) {
    return normalizeTrainingMode(baseMode);
}

function laneEvolutionMode() {
    return S.trainingEvolutionMode;
}

function rankFitness(agent, evolutionMode) {
    if (evolutionMode === 'survival') {
        return agent.landings * 200000
            + agent.score * 120
            + agent.progress * 0.25
            + agent.lifeTime * 220
            - agent.penalty * 0.3;
    }
    return agent.fitness;
}

function buildClassicGeneration(sorted, popSize) {
    const genomes = [];
    const champ = sorted[0].brain.g;
    genomes.push(new Float32Array(champ));
    for (let i = 1; i < Math.min(N_ELITE, sorted.length); i++) genomes.push(mutate(sorted[i].brain.g, 0.35));
    const nChamp = Math.floor(popSize * CHAMP_FRACTION);
    for (let i = 0; i < nChamp && genomes.length < popSize - N_FRESH; i++) {
        genomes.push(mutate(champ, i % 2 ? 1 : 0.55));
    }
    while (genomes.length < popSize - N_FRESH) {
        const a = tournament(sorted);
        const b = tournament(sorted);
        genomes.push(mutate(Math.random() < 0.75 ? crossover(a.brain.g, b.brain.g) : new Float32Array(a.brain.g)));
    }
    while (genomes.length < popSize) genomes.push(randomGenome());
    return genomes;
}

function buildSurvivalGeneration(sorted, popSize) {
    const genomes = [];
    const champ = sorted[0].brain.g;
    const freshN = Math.max(4, Math.round(popSize * SURVIVAL_FRESH_FRACTION));
    const champMutants = clamp(SURVIVAL_CHAMPION_MUTANT_MIN + ((Math.random() * 3) | 0), SURVIVAL_CHAMPION_MUTANT_MIN, SURVIVAL_CHAMPION_MUTANT_MAX);
    genomes.push(new Float32Array(champ));
    for (let i = 0; i < champMutants && genomes.length < popSize - freshN; i++) {
        genomes.push(mutateSurvival(champ, i < 2 ? 0.65 : 1.1 + i * 0.04));
    }
    const lesser = sorted.slice(1, Math.max(2, Math.min(sorted.length, Math.ceil(sorted.length * 0.6))));
    const breedCount = Math.max(8, Math.floor(popSize * 0.45));
    for (let i = 0; i < breedCount && genomes.length < popSize - freshN; i++) {
        if (!lesser.length) break;
        const mateIdx = Math.min(lesser.length - 1, Math.floor((i / Math.max(1, breedCount - 1)) * lesser.length));
        genomes.push(crossover(champ, lesser[mateIdx].brain.g));
    }
    while (genomes.length < popSize - freshN) {
        const a = lesser.length ? lesser[(Math.random() * lesser.length) | 0] : sorted[(Math.random() * sorted.length) | 0];
        const b = lesser.length ? lesser[(Math.random() * lesser.length) | 0] : sorted[(Math.random() * sorted.length) | 0];
        genomes.push(Math.random() < 0.5
            ? mutateSurvival(a.brain.g, 0.8 + Math.random() * 0.7)
            : crossover(a.brain.g, b.brain.g));
    }
    while (genomes.length < popSize) genomes.push(randomGenome());
    return genomes;
}

function buildNextGeneration(sorted, popSize, evolutionMode) {
    return evolutionMode === 'survival'
        ? buildSurvivalGeneration(sorted, popSize)
        : buildClassicGeneration(sorted, popSize);
}

function mutateForMode(g, evolutionMode, scale = 1) {
    return evolutionMode === 'survival' ? mutateSurvival(g, scale) : mutate(g, scale);
}

function tournament(sorted) {
    let best = sorted[(Math.random() * sorted.length) | 0];
    for (let i = 0; i < 2; i++) {
        const challenger = sorted[(Math.random() * sorted.length) | 0];
        if (challenger.fitSum > best.fitSum) best = challenger;
    }
    return best;
}

function tournamentPolicy(sorted) {
    let best = sorted[(Math.random() * sorted.length) | 0];
    for (let i = 0; i < 2; i++) {
        const challenger = sorted[(Math.random() * sorted.length) | 0];
        if (challenger.fitness > best.fitness) best = challenger;
    }
    return best;
}

function policyRecordFromTrial(trial) {
    const gens = Math.max(1, trial.generationsRun);
    const record = {
        label: trial.label,
        config: normalizePolicyConfig(trial.config),
        algorithm: trial.algorithm || 'classic',
        peakPads: trial.peakPads,
        finalPads: trial.finalPads,
        peakScore: trial.peakScore,
        meanPads: trial.meanPadsAccum / gens,
        meanScore: trial.meanScoreAccum / gens,
    };
    record.fitness = scorePolicyResult(record);
    return record;
}

function withPolicyContext(config, label, fn) {
    const prevPolicy = S.policy;
    const prevLabel = S.policyLabel;
    S.policy = normalizePolicyConfig(config);
    S.policyLabel = label;
    try {
        return fn();
    } finally {
        S.policy = prevPolicy;
        S.policyLabel = prevLabel;
    }
}

function createParallelSimState(config, label, evolutionMode) {
    return {
        policy: normalizePolicyConfig(config),
        label,
        evolutionMode,
        agents: [],
        template: null,
        gen: 1,
        episode: 0,
        simTime: 0,
        popSize: Math.min(POP_LIMIT, S.nextPopSize),
        genBestScore: 0,
        genMeanScore: 0,
        genBestPads: 0,
        genMeanPads: 0,
    };
}

function prepareEpisodeForState(state) {
    state.template = makeTemplate();
    for (const agent of state.agents) agent.spawn(state.template);
    state.simTime = 0;
}

function spawnPopulationForState(state, genomes) {
    state.agents = genomes.map((g, i) => new Lander(g, i));
    state.episode = 0;
    state.genBestScore = 0;
    state.genMeanScore = 0;
    state.genBestPads = 0;
    state.genMeanPads = 0;
    prepareEpisodeForState(state);
}

function freshPopulationForState(state) {
    const genomes = [];
    state.popSize = Math.min(POP_LIMIT, S.nextPopSize);
    for (let i = 0; i < state.popSize; i++) genomes.push(randomGenome());
    spawnPopulationForState(state, genomes);
}

function finishGenerationForState(state) {
    const evolutionMode = state.evolutionMode || 'classic';
    let epBestScore = 0;
    let epMeanScore = 0;
    let epBestPads = 0;
    let epMeanPads = 0;
    for (const agent of state.agents) {
        agent.fitSum += rankFitness(agent, evolutionMode);
        agent.scoreSum += agent.score;
        agent.landSum += agent.landings;
        epBestScore = Math.max(epBestScore, agent.score);
        epBestPads = Math.max(epBestPads, agent.landings);
        epMeanScore += agent.score;
        epMeanPads += agent.landings;
    }
    state.genBestScore = Math.max(state.genBestScore, epBestScore);
    state.genBestPads = Math.max(state.genBestPads, epBestPads);
    state.genMeanScore += epMeanScore / state.agents.length;
    state.genMeanPads += epMeanPads / state.agents.length;
    state.episode++;

    if (state.episode < N_EPISODES) {
        prepareEpisodeForState(state);
        return null;
    }

    const summary = {
        bestScore: state.genBestScore,
        bestPads: state.genBestPads,
        meanScore: state.genMeanScore / state.episode,
        meanPads: state.genMeanPads / state.episode,
        gen: state.gen,
    };

    const sorted = [...state.agents].sort((a, b) => b.fitSum - a.fitSum);
    state.popSize = Math.min(POP_LIMIT, S.nextPopSize);
    const genomes = buildNextGeneration(sorted, state.popSize, evolutionMode);
    state.gen++;
    spawnPopulationForState(state, genomes);
    return summary;
}

function stepSimForState(state) {
    return withPolicyContext(state.policy, state.label, () => {
        for (const agent of state.agents) if (agent.alive) agent.step();
        let alive = 0;
        for (const agent of state.agents) if (agent.alive) alive++;
        state.simTime += DT;
        S.stepsThisSecond++;
        if (alive === 0) return finishGenerationForState(state);
        return null;
    });
}

function activeExplorerLanes() {
    return S.explorer.lanes.filter(lane => lane.current);
}

function bestExplorerRecord(includeCurrent = false) {
    let best = S.explorer.best || S.savedPolicy;
    if (includeCurrent) {
        for (const lane of S.explorer.lanes) {
            if (!lane.current) continue;
            const current = policyRecordFromTrial(lane.current);
            if (!best || current.fitness > best.fitness) best = current;
        }
    }
    return best;
}

function buildExplorerCandidate() {
    const evaluated = [...S.explorer.roundEvaluated].sort((a, b) => b.fitness - a.fitness);
    const idx = S.explorer.assignedThisRound + 1;
    const seed = S.explorer.roundSeed || S.savedPolicy?.config || POLICY_DEFAULTS;
    let config;
    if (idx === 1) {
        config = normalizePolicyConfig(seed);
    } else if (idx === 2) {
        config = mutatePolicyConfig(seed, 0.35);
    } else if (evaluated.length < 2) {
        config = mutatePolicyConfig(seed, 0.9);
    } else if (idx <= 6) {
        config = mutatePolicyConfig(tournamentPolicy(evaluated).config, 0.55);
    } else {
        const a = tournamentPolicy(evaluated);
        const b = tournamentPolicy(evaluated);
        config = mutatePolicyConfig(crossoverPolicyConfig(a.config, b.config), 0.35);
    }
    S.explorer.assignedThisRound++;
    return {
        label: `R${S.explorer.round}-P${String(idx).padStart(2, '0')}`,
        config,
    };
}

function beginPolicyTrial(candidate) {
    S.evalMode = false;
    const evalBox = document.getElementById('eval-mode');
    if (evalBox) evalBox.checked = false;
    const algorithm = laneEvolutionMode('A');
    S.explorer.lanes[0].current = {
        ...candidate,
        algorithm,
        generationsRun: 0,
        peakPads: 0,
        finalPads: 0,
        peakScore: 0,
        meanPadsAccum: 0,
        meanScoreAccum: 0,
    };
    applyPolicyConfig(candidate.config, candidate.label);
    S.popSize = Math.min(POP_LIMIT, S.nextPopSize);
    resetTrainingSession(true);
    flashBanner(`Policy explorer — <b>${candidate.label}</b> (${S.explorer.assignedThisRound}/${S.explorer.targetTrials})`);
}

function beginHiddenPolicyTrial(lane, candidate) {
    const algorithm = laneEvolutionMode(lane.name);
    lane.current = {
        ...candidate,
        algorithm,
        generationsRun: 0,
        peakPads: 0,
        finalPads: 0,
        peakScore: 0,
        meanPadsAccum: 0,
        meanScoreAccum: 0,
    };
    lane.state = createParallelSimState(candidate.config, candidate.label, algorithm);
    freshPopulationForState(lane.state);
}

function assignNextPolicyToLane(lane) {
    if (S.explorer.assignedThisRound >= S.explorer.targetTrials) {
        lane.current = null;
        if (!lane.usesMain) lane.state = null;
        return false;
    }
    const candidate = buildExplorerCandidate();
    if (lane.usesMain) beginPolicyTrial(candidate);
    else beginHiddenPolicyTrial(lane, candidate);
    return true;
}

function startExplorerRound(seedConfig) {
    S.explorer.round++;
    S.explorer.roundSeed = normalizePolicyConfig(seedConfig);
    S.explorer.roundEvaluated = [];
    S.explorer.assignedThisRound = 0;
    for (const lane of S.explorer.lanes) {
        lane.current = null;
        if (!lane.usesMain) lane.state = null;
    }
    for (const lane of S.explorer.lanes.slice(0, POLICY_PARALLEL)) assignNextPolicyToLane(lane);
}

function startPolicyExplorer() {
    S.explorer.active = true;
    S.explorer.completed = false;
    S.explorer.round = 0;
    if (!S.explorer.best && S.savedPolicy) S.explorer.best = S.savedPolicy;
    const seed = S.savedPolicy?.config || S.policy || POLICY_DEFAULTS;
    startExplorerRound(seed);
}

function stopPolicyExplorer(reason = 'Policy explorer stopped — training the best policy so far') {
    const best = bestExplorerRecord(true) || S.savedPolicy || {
        label: 'Baseline',
        config: POLICY_DEFAULTS,
        algorithm: 'classic',
        peakPads: 0,
        finalPads: 0,
        peakScore: 0,
        meanPads: 0,
        meanScore: 0,
        fitness: 0,
    };
    savePolicyRecord(best);
    S.savedPolicy = best;
    S.explorer.active = false;
    S.explorer.completed = true;
    S.explorer.best = best;
    S.trainingEvolutionMode = best.algorithm || 'classic';
    S.evolutionMode = S.trainingEvolutionMode;
    if (document.getElementById('evolution-mode')) document.getElementById('evolution-mode').value = S.evolutionMode;
    for (const lane of S.explorer.lanes) {
        lane.current = null;
        if (!lane.usesMain) lane.state = null;
    }
    applyPolicyConfig(best.config, best.label);
    resetTrainingSession(true);
    flashBanner(reason);
}

function applySavedPolicyTraining() {
    const saved = loadSavedPolicyRecord();
    if (!saved) {
        flashBanner('No saved policy found');
        return;
    }
    S.savedPolicy = saved;
    S.explorer.active = false;
    S.explorer.completed = true;
    S.explorer.best = saved;
    S.trainingEvolutionMode = saved.algorithm || S.trainingEvolutionMode;
    S.evolutionMode = S.trainingEvolutionMode;
    if (document.getElementById('evolution-mode')) document.getElementById('evolution-mode').value = S.evolutionMode;
    for (const lane of S.explorer.lanes) {
        lane.current = null;
        if (!lane.usesMain) lane.state = null;
    }
    applyPolicyConfig(saved.config, saved.label || 'Saved');
    resetTrainingSession(true);
    flashBanner(`Applied saved policy <b>${saved.label || 'Saved'}</b>`);
}

function recordExplorerGeneration(bestPads, meanPads, bestScore, meanScore) {
    if (!S.explorer.active || !S.explorer.lanes[0].current) return false;
    const trial = S.explorer.lanes[0].current;
    trial.generationsRun++;
    trial.peakPads = Math.max(trial.peakPads, bestPads);
    trial.finalPads = bestPads;
    trial.peakScore = Math.max(trial.peakScore, bestScore);
    trial.meanPadsAccum += meanPads;
    trial.meanScoreAccum += meanScore;
    if (typeof updatePolicyExplorerUI === 'function') updatePolicyExplorerUI();
    if (trial.generationsRun < S.explorer.gensPerTrial) return false;

    const record = policyRecordFromTrial(trial);
    S.explorer.roundEvaluated.push(record);
    if (!S.explorer.best || record.fitness > S.explorer.best.fitness) {
        S.explorer.best = record;
        S.savedPolicy = record;
        savePolicyRecord(record);
    }
    S.explorer.lanes[0].current = null;

    if (S.explorer.roundEvaluated.length >= S.explorer.targetTrials && activeExplorerLanes().length === 0) {
        const roundBest = [...S.explorer.roundEvaluated].sort((a, b) => b.fitness - a.fitness)[0] || S.explorer.best || S.savedPolicy || { config: POLICY_DEFAULTS, label: 'Baseline', peakPads: 0 };
        const seedBest = S.explorer.best || roundBest;
        const roundNo = S.explorer.round;
        startExplorerRound(seedBest.config);
        flashBanner(`Explorer round <b>${roundNo}</b> winner <b>${roundBest.label}</b> · ${roundBest.peakPads.toFixed(1)} pads`);
        return true;
    }

    assignNextPolicyToLane(S.explorer.lanes[0]);
    return true;
}

function stepExplorerParallelLanes() {
    if (!S.explorer.active) return;
    for (const lane of S.explorer.lanes) {
        if (lane.usesMain || !lane.current || !lane.state) continue;
        const summary = stepSimForState(lane.state);
        if (!summary) continue;
        const trial = lane.current;
        trial.generationsRun++;
        trial.peakPads = Math.max(trial.peakPads, summary.bestPads);
        trial.finalPads = summary.bestPads;
        trial.peakScore = Math.max(trial.peakScore, summary.bestScore);
        trial.meanPadsAccum += summary.meanPads;
        trial.meanScoreAccum += summary.meanScore;
        if (trial.generationsRun < S.explorer.gensPerTrial) continue;

        const record = policyRecordFromTrial(trial);
        S.explorer.roundEvaluated.push(record);
        if (!S.explorer.best || record.fitness > S.explorer.best.fitness) {
            S.explorer.best = record;
            S.savedPolicy = record;
            savePolicyRecord(record);
        }
        lane.current = null;
        lane.state = null;

        if (S.explorer.roundEvaluated.length >= S.explorer.targetTrials && activeExplorerLanes().length === 0) {
            const roundBest = [...S.explorer.roundEvaluated].sort((a, b) => b.fitness - a.fitness)[0] || S.explorer.best || S.savedPolicy || { config: POLICY_DEFAULTS, label: 'Baseline', peakPads: 0 };
            const seedBest = S.explorer.best || roundBest;
            const roundNo = S.explorer.round;
            startExplorerRound(seedBest.config);
            flashBanner(`Explorer round <b>${roundNo}</b> winner <b>${roundBest.label}</b> · ${roundBest.peakPads.toFixed(1)} pads`);
            continue;
        }

        assignNextPolicyToLane(lane);
    }
}

function finishGeneration() {
    const evolutionMode = laneEvolutionMode('A');
    let epBestScore = 0;
    let epMeanScore = 0;
    let epBestPads = 0;
    let epMeanPads = 0;
    for (const agent of S.agents) {
        agent.fitSum += rankFitness(agent, evolutionMode);
        agent.scoreSum += agent.score;
        agent.landSum += agent.landings;
        epBestScore = Math.max(epBestScore, agent.score);
        epBestPads = Math.max(epBestPads, agent.landings);
        epMeanScore += agent.score;
        epMeanPads += agent.landings;
    }
    S.genBestScore = Math.max(S.genBestScore, epBestScore);
    S.genBestPads = Math.max(S.genBestPads, epBestPads);
    S.genMeanScore += epMeanScore / S.agents.length;
    S.genMeanPads += epMeanPads / S.agents.length;
    S.episode++;

    if (!S.evalMode && S.episode < N_EPISODES) {
        prepareEpisode();
        flashBanner(`Generation <b>${S.gen}</b> — episode ${S.episode + 1}/${N_EPISODES}`);
        return;
    }

    const bestScore = S.genBestScore;
    const bestPads = S.genBestPads;
    const meanScore = S.genMeanScore / S.episode;
    const meanPads = S.genMeanPads / S.episode;
    S.history.push({
        bestScore,
        meanScore,
        bestPads,
        meanPads,
        terrainIdx: S.terrainIdx,
    });
    if (S.history.length > 400) S.history.shift();
    if (bestScore > S.recordScore) S.recordScore = bestScore;
    if (bestPads > S.recordPads) S.recordPads = bestPads;
    drawChart();
    drawLandings();
    if (recordExplorerGeneration(bestPads, meanPads, bestScore, meanScore)) return;

    const sorted = [...S.agents].sort((a, b) => b.fitSum - a.fitSum);
    let genomes;
    if (S.evalMode) {
        genomes = sorted.map(agent => new Float32Array(agent.brain.g));
    } else {
        S.popSize = Math.min(POP_LIMIT, S.nextPopSize);
        genomes = buildNextGeneration(sorted, S.popSize, evolutionMode);
        S.gen++;
    }
    spawnPopulation(genomes);
    flashBanner(`Generation <b>${S.gen}</b> — best ${bestScore} · pads ${bestPads.toFixed(0)}`);
}

function stepSim() {
    for (const agent of S.agents) if (agent.alive) agent.step();
    let alive = 0;
    for (const agent of S.agents) if (agent.alive) alive++;
    S.simTime += DT;
    S.stepsThisSecond++;
    if (alive === 0) finishGeneration();
}

function explorerLane(name) {
    return S.explorer.lanes.find(lane => lane.name === name) || S.explorer.lanes[0];
}

function leaderForState(state) {
    if (!state || !state.agents || !state.agents.length) return null;
    let best = null;
    for (const agent of state.agents) {
        if (!best) {
            best = agent;
            continue;
        }
        if (agent.alive && !best.alive) {
            best = agent;
            continue;
        }
        if ((agent.alive === best.alive && agent.fitness > best.fitness) || (agent.score > best.score && agent.landings >= best.landings)) best = agent;
    }
    return best;
}

function leader() {
    return leaderForState(S);
}

function summarizeState(state) {
    if (!state || !state.agents || !state.agents.length) {
        return { alive: 0, total: 0, bestScore: 0, bestPads: 0, lead: null, gen: 0 };
    }
    let alive = 0;
    let bestScore = 0;
    let bestPads = 0;
    for (const agent of state.agents) {
        if (agent.alive) alive++;
        if (agent.score > bestScore) bestScore = agent.score;
        if (agent.landings > bestPads) bestPads = agent.landings;
    }
    return {
        alive,
        total: state.agents.length,
        bestScore,
        bestPads,
        lead: leaderForState(state),
        gen: state.gen || 0,
    };
}

function explorerLaneStatus(lane) {
    const state = lane.usesMain ? S : lane.state;
    if (!S.explorer.active) {
        if (lane.usesMain) {
            const snap = summarizeState(S);
            return `A training · g${snap.gen} · pads ${snap.bestPads} · score ${snap.bestScore}`;
        }
        return 'B inactive';
    }
    if (!state || !lane.current) return `${lane.name} waiting`;
    const snap = summarizeState(state);
    return `${lane.name} ${lane.current.label} · g${snap.gen} · pads ${snap.bestPads} · score ${snap.bestScore}`;
}

function updateLanePanels() {
    const laneA = explorerLane('A');
    const laneB = explorerLane('B');
    const aSnap = summarizeState(S);
    const bSnap = summarizeState(laneB.state);
    const aMode = S.explorer.active ? laneEvolutionMode('A') : S.trainingEvolutionMode;
    const bMode = S.explorer.active ? laneEvolutionMode('B') : null;

    $('lane-a-mode').textContent = algorithmLabel(aMode);
    $('lane-b-mode').textContent = bMode ? algorithmLabel(bMode) : 'Inactive';
    $('lane-a-policy').textContent = laneA.current
        ? `${laneA.current.label} · ${policySummary(laneA.current.config)}`
        : `${S.policyLabel} · ${policySummary(S.policy)}`;
    $('lane-b-policy').textContent = laneB.current
        ? `${laneB.current.label} · ${policySummary(laneB.current.config)}`
        : 'No active B lane';
    $('lane-a-gen').textContent = aSnap.gen;
    $('lane-b-gen').textContent = bSnap.gen || 0;
    $('lane-a-alive').textContent = `${aSnap.alive}/${aSnap.total}`;
    $('lane-b-alive').textContent = bSnap.total ? `${bSnap.alive}/${bSnap.total}` : '--';
    $('lane-a-pads').textContent = aSnap.bestPads;
    $('lane-b-pads').textContent = bSnap.bestPads;
    $('lane-a-score').textContent = aSnap.bestScore;
    $('lane-b-score').textContent = bSnap.bestScore;
}

function activeExplorerDisplay() {
    if (S.explorer.viewMode === 'B') {
        const laneB = explorerLane('B');
        if (S.explorer.active && laneB.current && laneB.state) {
            return {
                key: 'B',
                state: laneB.state,
                lane: laneB,
                template: laneB.state.template,
                policyLabel: laneB.current.label,
            };
        }
    }
    const laneA = explorerLane('A');
    return {
        key: 'A',
        state: S,
        lane: laneA,
        template: S.template,
        policyLabel: laneA.current?.label || S.policyLabel,
    };
}

function isHeadlessView() {
    return S.explorer.viewMode === 'headless';
}

function clearNetWithMessage(message) {
    const c = netCtx, W = netCv.width, H = netCv.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(147,161,184,0.9)';
    c.font = '12px sans-serif';
    c.textAlign = 'center';
    c.fillText(message, W / 2, H / 2);
}

const chartCv = document.getElementById('chart');
const chartCtx = chartCv.getContext('2d');

function drawChart() {
    const c = chartCtx, W = chartCv.width, H = chartCv.height;
    c.clearRect(0, 0, W, H);
    const h = S.history;
    if (!h.length) return;
    let max = 1;
    for (const e of h) max = Math.max(max, e.bestScore);
    const n = h.length;
    const px = i => n === 1 ? W : (i / (n - 1)) * (W - 4) + 2;
    const py = v => H - 4 - (v / max) * (H - 12);
    let runStart = 0;
    for (let i = 1; i <= n; i++) {
        if (i === n || h[i].terrainIdx !== h[runStart].terrainIdx) {
            chartCtx.fillStyle = TERRAIN_COLORS[h[runStart].terrainIdx] + '18';
            const x0 = runStart === 0 ? 0 : px(runStart);
            const x1 = i === n ? W : px(i);
            chartCtx.fillRect(x0, 0, x1 - x0, H);
            runStart = i;
        }
    }
    c.strokeStyle = 'rgba(147, 161, 184, 0.55)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].meanScore)) : c.moveTo(px(i), py(h[i].meanScore));
    c.stroke();
    c.strokeStyle = '#9ad6ff';
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].bestScore)) : c.moveTo(px(i), py(h[i].bestScore));
    c.stroke();
    c.fillStyle = 'rgba(147, 161, 184, 0.9)';
    c.font = '10px sans-serif';
    c.fillText(`${Math.round(max)} pts`, 4, 11);
}

const landCv = document.getElementById('landings');
const landCtx = landCv.getContext('2d');

function drawLandings() {
    const c = landCtx, W = landCv.width, H = landCv.height;
    c.clearRect(0, 0, W, H);
    const h = S.history;
    if (!h.length) return;
    let max = 1;
    for (const e of h) max = Math.max(max, e.bestPads);
    const n = h.length;
    const px = i => n === 1 ? W : (i / (n - 1)) * (W - 4) + 2;
    const py = v => H - 4 - (v / max) * (H - 16);
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(147, 161, 184, 0.62)';
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].meanPads)) : c.moveTo(px(i), py(h[i].meanPads));
    c.stroke();
    c.strokeStyle = '#ffbe6b';
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].bestPads)) : c.moveTo(px(i), py(h[i].bestPads));
    c.stroke();
    c.fillStyle = 'rgba(147, 161, 184, 0.9)';
    c.font = '10px sans-serif';
    c.fillText(`${max.toFixed(1)} pads`, 4, 11);
}

const netCv = document.getElementById('net');
const netCtx = netCv.getContext('2d');
const IN_LABELS = [
    'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7',
    'R1-', 'R2-', 'R3-', 'R4-', 'R5-', 'R6-', 'R7-',
    'padX', 'padY', 'padD', 'vX', 'vY', 'gX', 'gY', 'aX', 'aY',
    'sin', 'cos', 'spin', 'alt', 'fuel', 'oxy', 'main', 'turn', 'strafe'
];
const OUT_LABELS = ['turn', 'main', 'strafe'];

function actColor(v, alpha) {
    return v >= 0 ? `rgba(154,214,255,${alpha})` : `rgba(255,190,107,${alpha})`;
}

function drawNet(agent) {
    const c = netCtx, W = netCv.width, H = netCv.height;
    c.clearRect(0, 0, W, H);
    if (!agent) return;
    const g = agent.brain.g, h = agent.brain.h, h2 = agent.brain.h2, inp = agent.inp, out = agent.brain.out;
    const xIn = 26, xH1 = W * 0.42, xH2 = W * 0.67, xOut = W - 42;
    const yIn = i => 10 + i * ((H - 20) / (N_IN - 1));
    const yH1 = i => 12 + i * ((H - 24) / (N_H1 - 1));
    const yH2 = i => 20 + i * ((H - 40) / (N_H2 - 1));
    const yOut = i => H / 2 + (i - 1) * 54;
    c.lineWidth = 1;
    for (let i = 0; i < N_IN; i++) {
        for (let j = 0; j < N_H1; j++) {
            const sig = g[OFF_WXH + i * N_H1 + j] * inp[i];
            if (Math.abs(sig) < 0.18) continue;
            c.strokeStyle = actColor(sig, clamp(Math.abs(sig) * 0.55, 0.05, 0.46));
            c.beginPath();
            c.moveTo(xIn + 4, yIn(i));
            c.lineTo(xH1 - 4, yH1(j));
            c.stroke();
        }
    }
    for (let i = 0; i < N_H1; i++) {
        for (let j = 0; j < N_H2; j++) {
            const sig = g[OFF_W12 + i * N_H2 + j] * h[i];
            if (Math.abs(sig) < 0.18) continue;
            c.strokeStyle = actColor(sig, clamp(Math.abs(sig) * 0.55, 0.05, 0.46));
            c.beginPath();
            c.moveTo(xH1 + 4, yH1(i));
            c.lineTo(xH2 - 4, yH2(j));
            c.stroke();
        }
    }
    for (let i = 0; i < N_H2; i++) {
        for (let j = 0; j < N_OUT; j++) {
            const sig = g[OFF_WHY + i * N_OUT + j] * h2[i];
            if (Math.abs(sig) < 0.14) continue;
            c.strokeStyle = actColor(sig, clamp(Math.abs(sig) * 0.6, 0.05, 0.58));
            c.beginPath();
            c.moveTo(xH2 + 4, yH2(i));
            c.lineTo(xOut - 4, yOut(j));
            c.stroke();
        }
    }
    c.font = '8px sans-serif';
    c.textAlign = 'right';
    for (let i = 0; i < N_IN; i++) {
        c.fillStyle = actColor(inp[i], 0.2 + Math.abs(inp[i]) * 0.8);
        c.beginPath();
        c.arc(xIn, yIn(i), 3.4, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(147,161,184,0.88)';
        c.fillText(IN_LABELS[i], xIn - 7, yIn(i) + 2.5);
    }
    for (let i = 0; i < N_H1; i++) {
        c.fillStyle = actColor(h[i], 0.18 + Math.abs(h[i]) * 0.82);
        c.beginPath();
        c.arc(xH1, yH1(i), 4, 0, Math.PI * 2);
        c.fill();
    }
    for (let i = 0; i < N_H2; i++) {
        c.fillStyle = actColor(h2[i], 0.18 + Math.abs(h2[i]) * 0.82);
        c.beginPath();
        c.arc(xH2, yH2(i), 4, 0, Math.PI * 2);
        c.fill();
    }
    c.textAlign = 'left';
    for (let i = 0; i < N_OUT; i++) {
        c.fillStyle = actColor(out[i], 0.22 + Math.abs(out[i]) * 0.78);
        c.beginPath();
        c.arc(xOut, yOut(i), 5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(147,161,184,0.88)';
        c.fillText(`${OUT_LABELS[i]} ${out[i].toFixed(2)}`, xOut + 9, yOut(i) + 3);
    }
}

const $ = id => document.getElementById(id);
const banner = $('gen-banner');
let bannerTimer = 0;
const policyInputs = {};

function flashBanner(html) {
    banner.innerHTML = html;
    banner.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.add('hidden'), 2200);
}

function setStatusMeta() {
    $('status-mode').textContent = algorithmLabel(S.trainingEvolutionMode);
    $('status-policy').textContent = S.policyLabel;
    $('status-seed').textContent = S.seedChampionName || 'None';
    $('status-terrain').textContent = TERRAIN_DEFS[S.terrainIdx].name;
    $('champion-note').textContent = S.seedChampionName
        ? `Seeded from champion "${S.seedChampionName}". The exact genome is copied into the next fresh population.`
        : 'No champion seed loaded. Training starts from random individuals.';
}

function switchTerrain(i) {
    if (i === S.terrainIdx) return;
    S.terrainIdx = i;
    document.querySelectorAll('.terrain-tab').forEach(btn => btn.classList.toggle('active', +btn.dataset.terrain === i));
    const genomes = S.agents.length ? S.agents.map(agent => new Float32Array(agent.brain.g)) : [];
    if (genomes.length) spawnPopulation(genomes);
    else freshPopulation();
    setStatusMeta();
    flashBanner(`Switched to <b>${TERRAIN_DEFS[i].name}</b> — same brains, new terrain`);
}

function buildPolicyEditor() {
    const grid = $('policy-field-grid');
    grid.innerHTML = '';
    for (const field of POLICY_FIELDS) {
        const row = document.createElement('div');
        row.className = 'field-row';

        const label = document.createElement('label');
        label.htmlFor = `policy-${field.key}`;
        label.textContent = field.label;

        const input = document.createElement('input');
        input.id = `policy-${field.key}`;
        input.className = 'policy-number';
        input.type = 'number';
        input.step = field.step;
        input.min = String(POLICY_LIMITS[field.key][0]);
        input.max = String(POLICY_LIMITS[field.key][1]);
        input.addEventListener('input', () => {
            S.policy = collectPolicyInputs();
            if (!$('policy-config-name').value.trim()) S.policyLabel = 'Custom';
            updateStats();
        });

        policyInputs[field.key] = input;
        row.appendChild(label);
        row.appendChild(input);
        grid.appendChild(row);
    }
}

function collectPolicyInputs() {
    const config = {};
    for (const field of POLICY_FIELDS) {
        const parsed = parseFloat(policyInputs[field.key].value);
        config[field.key] = Number.isFinite(parsed) ? parsed : POLICY_DEFAULTS[field.key];
    }
    return normalizePolicyConfig(config);
}

function syncPolicyEditorFromState() {
    for (const field of POLICY_FIELDS) {
        const value = S.policy[field.key];
        policyInputs[field.key].value = field.step === '1' ? String(Math.round(value)) : String(Number(value.toFixed(3)));
    }
    $('policy-config-name').value = S.policyLabel === 'Baseline' || S.policyLabel === 'Custom' ? '' : S.policyLabel;
}

function refreshPolicyConfigList() {
    const select = $('policy-config-list');
    const names = Object.keys(S.policyLibrary).sort((a, b) => a.localeCompare(b));
    select.innerHTML = '';
    for (const name of names) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    }
}

function refreshChampionList() {
    const select = $('champion-list');
    const names = Object.keys(S.championLibrary).sort((a, b) => a.localeCompare(b));
    select.innerHTML = '';
    for (const name of names) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    }
}

function saveCurrentPolicyConfig(name) {
    const trimmed = name.trim();
    if (!trimmed) {
        flashBanner('Enter a policy configuration name first');
        return;
    }
    S.policy = collectPolicyInputs();
    S.policyLabel = trimmed;
    S.policyLibrary[trimmed] = {
        config: S.policy,
        mode: S.trainingEvolutionMode,
        saved: Date.now(),
    };
    saveLibrary(POLICY_LIBRARY_KEY, S.policyLibrary);
    refreshPolicyConfigList();
    setStatusMeta();
    flashBanner(`Saved policy config <b>${trimmed}</b>`);
}

function loadPolicyConfigByName(name) {
    const record = S.policyLibrary[name];
    if (!record) {
        flashBanner('Select a policy configuration to load');
        return;
    }
    applyPolicyConfig(record.config, name);
    S.trainingEvolutionMode = normalizeTrainingMode(record.mode || S.trainingEvolutionMode);
    $('training-mode').value = trainingModeValue(S.trainingEvolutionMode);
    syncPolicyEditorFromState();
    resetTrainingSession(true);
    setStatusMeta();
    flashBanner(`Loaded policy config <b>${name}</b>`);
}

function deletePolicyConfigByName(name) {
    if (!name || !S.policyLibrary[name]) {
        flashBanner('Select a policy configuration to delete');
        return;
    }
    delete S.policyLibrary[name];
    saveLibrary(POLICY_LIBRARY_KEY, S.policyLibrary);
    refreshPolicyConfigList();
    flashBanner(`Deleted policy config <b>${name}</b>`);
}

function saveCurrentChampion(name) {
    const trimmed = name.trim();
    if (!trimmed) {
        flashBanner('Enter a champion name first');
        return;
    }
    const champion = currentBestAgent();
    if (!champion) {
        flashBanner('No champion available yet');
        return;
    }
    S.championLibrary[trimmed] = {
        genome: Array.from(champion.brain.g),
        mode: S.trainingEvolutionMode,
        policy: S.policy,
        policyLabel: S.policyLabel,
        generation: S.gen,
        saved: Date.now(),
    };
    saveLibrary(CHAMPION_LIBRARY_KEY, S.championLibrary);
    refreshChampionList();
    flashBanner(`Saved champion <b>${trimmed}</b>`);
}

function loadChampionByName(name) {
    const record = S.championLibrary[name];
    if (!record) {
        flashBanner('Select a champion to load');
        return;
    }
    S.seedChampionGenome = Float32Array.from(record.genome);
    S.seedChampionName = name;
    resetTrainingSession(true);
    setStatusMeta();
    flashBanner(`Loaded champion <b>${name}</b> as the seed individual`);
}

function clearChampionSeed() {
    S.seedChampionGenome = null;
    S.seedChampionName = '';
    setStatusMeta();
    flashBanner('Champion seed cleared');
}

function setupUI() {
    buildPolicyEditor();
    syncPolicyEditorFromState();
    refreshPolicyConfigList();
    refreshChampionList();
    $('training-mode').value = trainingModeValue(S.trainingEvolutionMode);
    document.querySelectorAll('.terrain-tab').forEach(btn => btn.addEventListener('click', () => switchTerrain(+btn.dataset.terrain)));

    $('btn-pause').addEventListener('click', () => {
        S.paused = !S.paused;
        $('btn-pause').textContent = S.paused ? 'Resume' : 'Pause';
    });

    $('btn-reset').addEventListener('click', () => {
        resetTrainingSession(true);
        flashBanner('Training reset — fresh random brains');
    });

    $('speed').addEventListener('input', e => {
        S.speedStop = +e.target.value;
        S.stepCarry = 0;
        const v = SPEED_STOPS[S.speedStop];
        $('speed-label').textContent = v === Infinity ? 'Max' : v + 'x';
    });

    $('pop').addEventListener('input', e => {
        S.nextPopSize = Math.min(POP_LIMIT, +e.target.value);
        $('pop-label').textContent = S.nextPopSize;
    });

    $('mut').addEventListener('input', e => {
        S.mutRate = +e.target.value / GENOME_SIZE;
        $('mut-label').textContent = `~${e.target.value} weights`;
    });

    $('training-mode').addEventListener('change', e => {
        S.trainingEvolutionMode = normalizeTrainingMode(e.target.value);
        resetTrainingSession(true);
        setStatusMeta();
        flashBanner(`Training mode switched to <b>${e.target.selectedOptions[0].textContent}</b>`);
    });

    $('sensors').addEventListener('change', e => { S.sensorMode = e.target.value; });

    $('eval-mode').addEventListener('change', e => {
        S.evalMode = e.target.checked;
        flashBanner(S.evalMode ? 'Eval mode: evolution frozen' : 'Training resumed');
    });

    $('btn-save-policy').addEventListener('click', () => saveCurrentPolicyConfig($('policy-config-name').value));
    $('btn-load-policy').addEventListener('click', () => loadPolicyConfigByName($('policy-config-list').value));
    $('btn-delete-policy').addEventListener('click', () => deletePolicyConfigByName($('policy-config-list').value));

    $('btn-save-champion').addEventListener('click', () => saveCurrentChampion($('champion-name').value));
    $('btn-load-champion').addEventListener('click', () => loadChampionByName($('champion-list').value));
    $('btn-clear-champion').addEventListener('click', clearChampionSeed);

    window.addEventListener('keydown', e => {
        if (e.key === ' ') {
            e.preventDefault();
            $('btn-pause').click();
        }
    });

    setStatusMeta();
}

const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
let view = { w: 0, h: 0, dpr: 1, s: 1, ox: 0, oy: 0 };
const bgStars = [];
for (let i = 0; i < 120; i++) bgStars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.2, a: Math.random() * 0.55 + 0.15 });

function resize() {
    const vp = document.getElementById('viewport');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = vp.clientWidth;
    const h = vp.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    view.dpr = dpr;
    view.w = canvas.width;
    view.h = canvas.height;
    view.s = Math.min(canvas.width / VIEW_W, canvas.height / VIEW_H);
    view.ox = (canvas.width - VIEW_W * view.s) / 2;
    view.oy = (canvas.height - VIEW_H * view.s) / 2;
}

function cameraFor(agent) {
    const x = clamp(agent.x - VIEW_W * 0.46, 0, Math.max(0, WORLD_W - VIEW_W));
    const y = clamp(agent.y - VIEW_H * 0.52, 0, Math.max(0, WORLD_H - VIEW_H));
    if (!S.cameraReady) {
        S.cameraX = x;
        S.cameraY = y;
        S.cameraReady = true;
    } else {
        S.cameraX += (x - S.cameraX) * CAMERA_LERP;
        S.cameraY += (y - S.cameraY) * CAMERA_LERP;
    }
    return { x: S.cameraX, y: S.cameraY };
}

function visibleRange(template, cam) {
    const pts = template.points;
    const start = findTerrainSegment(pts, cam.x - 90);
    const end = findTerrainSegment(pts, cam.x + VIEW_W + 90);
    return { start, end: Math.min(pts.length - 1, end + 1) };
}

function drawBackground(cam) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(view.w * 0.5, view.h * 0.32, 0, view.w * 0.5, view.h * 0.6, view.h * 0.85);
    g.addColorStop(0, '#172131');
    g.addColorStop(0.55, '#0d1420');
    g.addColorStop(1, '#070b12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    for (const star of bgStars) {
        ctx.globalAlpha = star.a;
        ctx.fillStyle = '#f3f7ff';
        ctx.beginPath();
        ctx.arc((star.x * view.w - cam.x * 0.06) % view.w, (star.y * view.h - cam.y * 0.03 + view.h) % view.h, star.r * view.dpr, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawTerrain(template, cam, lead) {
    const { start, end } = visibleRange(template, cam);
    const pts = template.points;
    const fill = ctx.createLinearGradient(0, cam.y + 120, 0, cam.y + VIEW_H);
    fill.addColorStop(0, '#5d616b');
    fill.addColorStop(0.45, '#454a55');
    fill.addColorStop(1, '#2e333d');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[start].x, cam.y + VIEW_H + 120);
    for (let i = start; i <= end; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[end].x, cam.y + VIEW_H + 120);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(228, 234, 244, 0.28)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(pts[start].x, pts[start].y);
    for (let i = start + 1; i <= end; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    const activePad = lead ? lead.sensorPad : -1;
    const landed = lead ? lead.padState : null;
    for (let i = 0; i < template.pads.length; i++) {
        const pad = template.pads[i];
        if (pad.x + pad.width < cam.x - 60 || pad.x > cam.x + VIEW_W + 60) continue;
        const isLanded = landed ? landed[i] : 0;
        ctx.strokeStyle = isLanded ? 'rgba(141, 151, 167, 0.9)' : i === activePad ? '#ffbe6b' : '#f0f6ff';
        ctx.lineWidth = i === activePad ? 5 : 3;
        ctx.beginPath();
        ctx.moveTo(pad.x, pad.y);
        ctx.lineTo(pad.x + pad.width, pad.y);
        ctx.stroke();
        if (!isLanded) {
            ctx.strokeStyle = 'rgba(255, 190, 107, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pad.cx, pad.y);
            ctx.lineTo(pad.cx, pad.y - 22);
            ctx.stroke();
        }
    }
}

function drawHeadlessSummary() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#09101a';
    ctx.fillRect(0, 0, view.w, view.h);
    const laneA = explorerLane('A');
    const laneB = explorerLane('B');
    const aState = summarizeState(S);
    const bState = summarizeState(laneB.state);
    ctx.fillStyle = '#ebf2ff';
    ctx.font = '600 24px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText(S.explorer.active ? 'Headless Explorer' : 'Headless Winner Training', 36, 54);
    ctx.font = '14px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillStyle = '#93a1b8';
    ctx.fillText('Rendering is throttled to a lightweight summary so high-speed training costs less GPU time.', 36, 82);

    const blocks = S.explorer.active
        ? [
            { x: 36, y: 120, title: `Lane A · ${algorithmLabel(laneEvolutionMode('A'))}`, lane: laneA, snap: aState },
            { x: 36, y: 270, title: `Lane B · ${algorithmLabel(laneEvolutionMode('B'))}`, lane: laneB, snap: bState },
        ]
        : [
            { x: 36, y: 120, title: `Winner Training · ${algorithmLabel(S.trainingEvolutionMode)}`, lane: laneA, snap: aState },
        ];
    for (const block of blocks) {
        ctx.fillStyle = 'rgba(19,25,38,0.78)';
        ctx.fillRect(block.x, block.y, Math.min(420, view.w - 72), 118);
        ctx.strokeStyle = 'rgba(146,167,199,0.16)';
        ctx.strokeRect(block.x + 0.5, block.y + 0.5, Math.min(420, view.w - 72) - 1, 117);
        ctx.fillStyle = '#ebf2ff';
        ctx.font = '600 18px Bahnschrift, Segoe UI, sans-serif';
        ctx.fillText(`${block.title} · ${block.lane.current?.label || 'waiting'}`, block.x + 16, block.y + 28);
        ctx.font = '14px Bahnschrift, Segoe UI, sans-serif';
        ctx.fillStyle = '#93a1b8';
        ctx.fillText(`gen ${block.snap.gen} · alive ${block.snap.alive}/${block.snap.total}`, block.x + 16, block.y + 56);
        ctx.fillText(`best pads ${block.snap.bestPads} · best score ${block.snap.bestScore}`, block.x + 16, block.y + 80);
        ctx.fillText(block.lane.current ? policySummary(block.lane.current.config) : 'idle until the next assignment', block.x + 16, block.y + 104);
    }
}

function drawTrail(agent) {
    if (!agent.trail.length) return;
    ctx.strokeStyle = 'rgba(154, 214, 255, 0.24)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(agent.trail[0].x, agent.trail[0].y);
    for (let i = 1; i < agent.trail.length; i++) ctx.lineTo(agent.trail[i].x, agent.trail[i].y);
    ctx.stroke();
}

function drawSensors(agent, alpha) {
    const downAngle = agent.angle + Math.PI / 2;
    ctx.strokeStyle = `rgba(154, 214, 255, ${alpha})`;
    ctx.lineWidth = 0.9;
    for (let i = 0; i < N_RAYS; i++) {
        const a = downAngle + RAY_ANGLES[i];
        const d = agent.rays[i];
        ctx.beginPath();
        ctx.moveTo(agent.x, agent.y);
        ctx.lineTo(agent.x + Math.cos(a) * d, agent.y + Math.sin(a) * d);
        ctx.stroke();
    }
    if (agent.sensorPad >= 0 && agent.sensorPadInRange) {
        const pad = agent.template.pads[agent.sensorPad];
        ctx.strokeStyle = `rgba(255, 190, 107, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(agent.x, agent.y);
        ctx.lineTo(pad.cx, pad.y);
        ctx.stroke();
    }
}

function drawLander(agent, alpha, highlight) {
    ctx.save();
    ctx.translate(agent.x, agent.y);
    ctx.rotate(agent.angle);
    ctx.globalAlpha *= alpha;
    const flamePulse = 0.62 + 0.38 * Math.sin(S.simTime * 16 + agent.idx * 0.8);

    ctx.fillStyle = highlight ? 'rgba(118, 142, 182, 0.22)' : 'rgba(90, 105, 138, 0.16)';
    ctx.beginPath();
    ctx.ellipse(0, 23, 23, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (agent.cmdMain) {
        ctx.fillStyle = 'rgba(255, 184, 90, 0.18)';
        ctx.beginPath();
        ctx.moveTo(-11, 10);
        ctx.quadraticCurveTo(-6, 24, 0, 32 + flamePulse * 18);
        ctx.quadraticCurveTo(6, 24, 11, 10);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffd08a';
        ctx.beginPath();
        ctx.moveTo(-6, 11);
        ctx.quadraticCurveTo(-3, 20, 0, 24 + flamePulse * 11);
        ctx.quadraticCurveTo(3, 20, 6, 11);
        ctx.closePath();
        ctx.fill();
    }

    if (agent.cmdStrafe) {
        ctx.fillStyle = 'rgba(255, 184, 90, 0.15)';
        const dir = agent.cmdStrafe > 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(dir * 16, -4);
        ctx.quadraticCurveTo(dir * (23 + flamePulse * 6), 0, dir * 16, 4);
        ctx.closePath();
        ctx.fill();
    }

    if (agent.cmdTurn) {
        ctx.fillStyle = 'rgba(255, 184, 90, 0.13)';
        const dir = agent.cmdTurn > 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(dir * 13, -15);
        ctx.quadraticCurveTo(dir * (19 + flamePulse * 4), -9, dir * 13, -3);
        ctx.closePath();
        ctx.fill();
    }

    const hull = ctx.createLinearGradient(-18, -26, 18, 18);
    hull.addColorStop(0, highlight ? '#f7fbff' : '#dbe3f1');
    hull.addColorStop(0.52, highlight ? '#e3ebf7' : '#c3cedf');
    hull.addColorStop(1, highlight ? '#b8c9e3' : '#99aac8');
    ctx.fillStyle = hull;
    ctx.strokeStyle = highlight ? 'rgba(154, 214, 255, 0.95)' : 'rgba(145, 160, 184, 0.58)';
    ctx.lineWidth = highlight ? 1.5 : 1.05;
    ctx.shadowColor = highlight ? 'rgba(154, 214, 255, 0.18)' : 'transparent';
    ctx.shadowBlur = highlight ? 10 : 0;
    ctx.beginPath();
    ctx.moveTo(-14, 10);
    ctx.lineTo(-17, -7);
    ctx.quadraticCurveTo(-17, -22, -8, -26);
    ctx.lineTo(8, -26);
    ctx.quadraticCurveTo(17, -22, 17, -7);
    ctx.lineTo(14, 10);
    ctx.quadraticCurveTo(0, 18, -14, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(111, 128, 158, 0.8)';
    ctx.fillRect(-19, 3, 4, 9);
    ctx.fillRect(15, 3, 4, 9);

    ctx.strokeStyle = highlight ? 'rgba(235, 242, 255, 0.95)' : 'rgba(173, 184, 202, 0.88)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-9, 9);
    ctx.lineTo(-17, 18);
    ctx.lineTo(-22, 22);
    ctx.moveTo(9, 9);
    ctx.lineTo(17, 18);
    ctx.lineTo(22, 22);
    ctx.moveTo(-24, 22);
    ctx.lineTo(-11, 22);
    ctx.moveTo(24, 22);
    ctx.lineTo(11, 22);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(98, 109, 136, 0.95)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(1, -35);
    ctx.stroke();
    ctx.fillStyle = '#ff6d67';
    ctx.beginPath();
    ctx.arc(1, -37.5, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#5b8fd5';
    ctx.beginPath();
    ctx.arc(0, -9, 6.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(222, 237, 255, 0.65)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, -9, 6.3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.arc(-2, -11, 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(132, 145, 170, 0.52)';
    ctx.beginPath();
    ctx.arc(-10, -19, 1.1, 0, Math.PI * 2);
    ctx.arc(10, -19, 1.1, 0, Math.PI * 2);
    ctx.arc(-11, 6, 1.1, 0, Math.PI * 2);
    ctx.arc(11, 6, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawOverlay(lead) {
    const template = S.template;
    const terrain = TERRAIN_DEFS[S.terrainIdx];
    const padsLeft = lead ? lead.template.pads.length - lead.landings : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(8, 11, 18, 0.72)';
    ctx.fillRect(18, 18, 360, 96);
    ctx.strokeStyle = 'rgba(147, 161, 184, 0.18)';
    ctx.strokeRect(18.5, 18.5, 359, 95);
    ctx.fillStyle = '#ebf2ff';
    ctx.font = '600 13px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText(`${terrain.name} · seed ${template.seed >>> 0} · ${algorithmLabel(S.trainingEvolutionMode)}`, 30, 42);
    ctx.font = '12px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillStyle = '#93a1b8';
    ctx.fillText(`leader score ${lead ? lead.score : 0} · pads ${lead ? lead.landings : 0}/${lead ? lead.template.pads.length : 0} · pads left ${padsLeft}`, 30, 64);
    ctx.fillText(`fuel ${lead ? Math.round(lead.fuel / FUEL_MAX * 100) : 0}% · oxygen ${lead ? Math.round(lead.oxygen / OXYGEN_MAX * 100) : 0}%`, 30, 84);
    ctx.fillText(`clearance ${lead ? Math.round(lead.altitude) : 0}px · rays ${RAY_MAX}px · ${S.policyLabel}`, 30, 104);
}

function render() {
    if (!S.template || !view.w) return;
    const lead = leader();
    if (!lead) return;
    const cam = cameraFor(lead);
    drawBackground(cam);
    ctx.setTransform(view.s, 0, 0, view.s, view.ox - cam.x * view.s, view.oy - cam.y * view.s);
    drawTerrain(S.template, cam, lead);
    drawTrail(lead);

    const ghosts = S.sensorMode === 'all'
        ? S.agents.filter(agent => agent.alive && agent !== lead)
        : S.sensorMode === 'ghosts'
            ? [...S.agents].filter(agent => agent.alive && agent !== lead).sort((a, b) => b.fitness - a.fitness).slice(0, TOP_GHOSTS)
            : [];

    for (let i = ghosts.length - 1; i >= 0; i--) {
        drawLander(ghosts[i], 0.17, false);
    }

    if (S.sensorMode !== 'off') drawSensors(lead, 0.28);
    drawLander(lead, 1, true);
    drawOverlay(lead);
}

function updateStats() {
    const summary = summarizeState(S);
    setStatusMeta();
    $('stat-gen').textContent = summary.gen;
    $('stat-episode').textContent = `${Math.min(S.episode + 1, N_EPISODES)} / ${N_EPISODES}`;
    $('stat-alive').textContent = `${summary.alive}/${summary.total}`;
    $('stat-best-score').textContent = summary.bestScore;
    $('stat-best-pads').textContent = summary.bestPads;
    $('stat-record-pads').textContent = S.recordPads;
    $('stat-record-score').textContent = S.recordScore;
    $('stat-fuel').textContent = `${summary.lead ? Math.round(summary.lead.fuel / FUEL_MAX * 100) : 0}%`;
    $('stat-oxygen').textContent = `${summary.lead ? Math.round(summary.lead.oxygen / OXYGEN_MAX * 100) : 0}%`;
    $('stat-sps').textContent = `${(S.simRate / 60).toFixed(S.simRate < 600 ? 1 : 0)}x`;
}

let frameCount = 0;
let rateTimer = performance.now();

function frame() {
    if (!view.w) resize();
    if (!S.paused) {
        const target = SPEED_STOPS[S.speedStop];
        const t0 = performance.now();
        if (target === Infinity) {
            let burst = 0;
            while (performance.now() - t0 < 11 && burst < 350) {
                for (let k = 0; k < 8; k++) stepSim();
                burst++;
            }
        } else {
            S.stepCarry += target;
            while (S.stepCarry >= 1 && performance.now() - t0 < 14) {
                stepSim();
                S.stepCarry -= 1;
            }
        }
    }
    render();
    frameCount++;
    if (frameCount % 6 === 0) drawNet(leader());
    if (frameCount % 10 === 0) updateStats();
    const now = performance.now();
    if (now - rateTimer >= 1000) {
        S.simRate = S.stepsThisSecond * 1000 / (now - rateTimer);
        S.stepsThisSecond = 0;
        rateTimer = now;
    }
    requestAnimationFrame(frame);
}

S.policyLibrary = loadPolicyLibrary();
S.championLibrary = loadChampionLibrary();
const rememberedMode = S.policyLibrary.Baseline?.mode;
if (rememberedMode) S.trainingEvolutionMode = normalizeTrainingMode(rememberedMode);
applyPolicyConfig(S.policyLibrary.Baseline?.config || POLICY_DEFAULTS, 'Baseline');
setupUI();
resize();
resetTrainingSession(true);
updateStats();
new ResizeObserver(resize).observe(document.getElementById('viewport'));
requestAnimationFrame(frame);

})();