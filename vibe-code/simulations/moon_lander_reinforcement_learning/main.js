'use strict';

(() => {

/*
 * Moon Lander Neuroevolution v3.5
 *
 * Core changes:
 * - deterministic, shared evaluation scenarios (common random numbers)
 * - continuous 20 Hz controller over stable 60 Hz physics
 * - feed-forward controller with Xavier initialization
 * - pad-first robust multi-episode fitness
 * - potential-based approach shaping and locked mission targets
 * - realistic landing envelope including horizontal/angular impact limits
 * - corrected grounded/takeoff state
 * - adaptive mutation, BLX crossover, elitism, immigrants, hall of fame
 * - physics-informed bootstrap policy for substantially faster early learning
 * - responsive predictive camera with smooth population and leader tracking
 * - strict leader ranking by pads, next-pad distance, then travelled distance
 * - compact activation-panel camera controls with 97% leader bias
 * - balanced evolutionary selection restored as the recommended default
 * - extended 125,000 px courses with 125+ pads on every terrain
 * - Titan Gauntlet terrain with mountains, valleys, and long plateaus
 * - vessel-view-aware averaged neural activation display
 * - compact advanced fitness-shaping controls
 * - swept hull/leg/full-foot collision detection with strict impact mortality
 * - throttleable descent engine with floor, slew limits, and ignition dwell
 * - fixed-thrust pulse RCS with minimum on/off valve dwell
 * - one protected all-time elite evaluated on deterministic scenario bank
 */

const WORLD_W = 125000;
const WORLD_H = 760;
const TERRAIN_PATTERN_W = 9600;
const MIN_PADS_PER_MAP = 125;
const VIEW_W = 1200;
const VIEW_H = 700;
const DT = 1 / 60;

// Simulation resources and forces. Fuel rates are expressed per simulated second.
const OXYGEN_MAX = 72;
const FUEL_MAX = 1700;
const GRAVITY = 27;
const MAIN_THRUST = 65;
const SIDE_THRUST = 25;
const TURN_ACCEL = 105 * Math.PI / 180;
const ANGULAR_DAMPING = 0.42;
const MAX_ANGULAR_SPEED = 210 * Math.PI / 180;
const MAIN_FUEL_RATE = 29.4;
const AUX_FUEL_RATE = 8.4;
const DRY_MASS_FACTOR = 0.72;
const FUEL_MASS_FACTOR = 0.28;

// Landing envelope. A valid landing must satisfy every condition. These
// limits are intentionally unforgiving: a leg strike at a large angle or a
// high-energy pad impact is a crash rather than a free snap-to-pad.
const SAFE_LANDING_VERTICAL_SPEED = 28;
const SAFE_LANDING_HORIZONTAL_SPEED = 15;
const SAFE_LANDING_ANGLE = 10 * Math.PI / 180;
const SAFE_LANDING_ANGULAR_SPEED = 26 * Math.PI / 180;
const SAFE_LANDING_UPWARD_SPEED = 4;
const TAKEOFF_THROTTLE = 0.46;

// Engine mechanics are decoupled from the 60 Hz physics integration. The
// neural network requests controls, but physical actuators obey their own
// response and dwell limits.
const MAIN_MIN_THROTTLE = 0.18;
const MAIN_IGNITION_COMMAND = 0.11;
const MAIN_SHUTDOWN_COMMAND = 0.055;
const MAIN_THROTTLE_SLEW_UP = 0.55;   // fraction of full thrust per second
const MAIN_THROTTLE_SLEW_DOWN = 0.70; // fraction of full thrust per second
const MAIN_MIN_ON_TIME = 0.60;        // deliberate landing-engine burn
const MAIN_MIN_OFF_TIME = 0.45;       // restart / valve-settle gap
const RCS_COMMAND_THRESHOLD = 0.24;
const RCS_MIN_ON_TIME = 0.030;        // pulse valve minimum open time
const RCS_MIN_OFF_TIME = 0.030;       // pulse valve minimum closed time

// Swept collision geometry prevents fast craft from tunnelling through a
// mountain or pad between physics frames. Terrain contact is checked across
// the hull, lower body, and landing-leg rods—not only at the two foot centres.
const COLLISION_SWEEP_STEP = 2.5;
const COLLISION_MAX_SWEEP_STEPS = 24;
const TERRAIN_CONTACT_EPSILON = 0.35;
const LANDER_COLLISION_RADIUS = 39;
const LANDER_SOLID_LOCAL_POINTS = Object.freeze([
    [-12, -26], [-5, -28], [5, -28], [12, -26],
    [-16, -18], [16, -18], [-17, -8], [17, -8],
    [-16, 2], [16, 2], [-14, 10], [14, 10],
    [-8, 15], [0, 17], [8, 15],
    [-11, 11], [-14, 14], [-18, 18],
    [11, 11], [14, 14], [18, 18],
]);
const MAX_EPISODE_TIME = 2700;
const NO_PROGRESS_TIMEOUT = 36;
const CONTROL_INTERVAL = 3;

const PAD_FUEL_REWARD = 330;
const PAD_OXYGEN_REWARD = 18;
const LANDING_BONUS = 50;

const LANDER_FEET_Y = 26;
const LANDER_BODY_Y = 20;
const LANDER_HALF_W = 23;
const LANDER_FOOT_HALF_WIDTH = 8;

const PAD_SENSE_R = VIEW_W;
const RAY_MAX = 650;
const RAY_ANGLES = [-85, -65, -45, -25, 0, 25, 45, 65, 85].map(d => d * Math.PI / 180);
const N_RAYS = RAY_ANGLES.length;

// The world is fully observable enough that recurrence only added instability.
// A feed-forward controller is easier to evolve and has fewer failure modes.
const N_IN = 42, N_H1 = 32, N_H2 = 24, N_OUT = 3;
const OFF_WXH = 0;
const OFF_BH = OFF_WXH + N_IN * N_H1;
const OFF_W12 = OFF_BH + N_H1;
const OFF_B2 = OFF_W12 + N_H1 * N_H2;
const OFF_WHY = OFF_B2 + N_H2;
const OFF_BY = OFF_WHY + N_H2 * N_OUT;
const GENOME_SIZE = OFF_BY + N_OUT;
const BRAIN_VERSION = 3;

const POP_DEFAULT = 64;
const N_EPISODES = 4;
const N_FIXED_EPISODES = N_EPISODES;
const N_ELITE = 1;
const N_FRESH = 8;
const CHAMP_FRACTION = 0.24;
const SPEED_STOPS = [0.5, 1, 2, 4, 8, 16, 32, Infinity];

const SPEED_SCALE = 180;
const ANGVEL_SCALE = 3;
const ACTION_RESPONSE = 0.35;

const PAD_FITNESS_VALUE = 1_000_000;
const SCORE_FITNESS_VALUE = 900;
const LAND_REWARD = 1500;
const APPROACH_REWARD = 320;
const CRASH_PENALTY = 850;
const JERK_COST = 0.065;
const SPIN_COST = 0.075;
const FUEL_DRIFT_COST = 0.004;
const WANDER_COST = 9;
const LOW_RESOURCE_COST = 16;
const PAD_IDLE_GRACE = 1.1;
const PAD_IDLE_COST = 25;
const TOP_GHOSTS = 12;
const CAMERA_DEFAULT_MODE = 'average';
const CAMERA_AVERAGE_SMOOTH_TIME = 0.72;
const CAMERA_AVERAGE_LEADER_BIAS = 0.97;
const CAMERA_BIAS_STORAGE_KEY = 'neural_moon_landers_camera_leader_bias_v2';
const CAMERA_LEADER_SMOOTH_TIME = 0.84;
const CAMERA_LEADER_SWITCH_TIME = 2.6;
const CAMERA_LEADER_SWITCH_DAMP_TIME = 0.68;
const CAMERA_LOOKAHEAD_X_TIME = 0.48;
const CAMERA_LOOKAHEAD_Y_TIME = 0.28;
const CAMERA_MAX_LOOKAHEAD_X = 180;
const CAMERA_MAX_LOOKAHEAD_Y = 100;
const CAMERA_CATCHUP_DISTANCE = 260;
const CAMERA_CATCHUP_MIN_FACTOR = 0.48;
const CAMERA_MAX_SPEED = 7200;
const POP_LIMIT = 160;
const SURVIVAL_CHAMPION_MUTANT_MIN = 6;
const SURVIVAL_CHAMPION_MUTANT_MAX = 10;
const SURVIVAL_FRESH_FRACTION = 0.12;
const BRAIN_STORAGE_KEY = 'neural_moon_landers_brain_v3';
const POLICY_STORAGE_KEY = 'neural_moon_landers_policy_v2';
const POLICY_LIBRARY_KEY = 'neural_moon_landers_policy_library_v1';
const CHAMPION_LIBRARY_KEY = 'neural_moon_landers_champion_library_v3';
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

const TERRAIN_COLORS = ['#ffbe6b', '#7ad7ff', '#95e58f', '#ff8f6b', '#c7a4ff'];
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
    {
        name: 'Titan Gauntlet',
        baseY: 520,
        amp1: 82,
        amp2: 52,
        amp3: 29,
        wave1: 4.8,
        wave2: 10.6,
        wave3: 22.0,
        noise: 30,
        minY: 145,
        maxY: 690,
        padSpacingMin: 470,
        padSpacingMax: 720,
        profile: 'extreme',
        featureLength: 3200,
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
    // Both available algorithms are evolutionary. Older UI values named
    // "reinforcement" map to the balanced evolutionary strategy, while the
    // explicitly survival-oriented variant remains opt-in.
    return mode === 'survival' || mode === 'evolutionary-survival'
        ? 'survival'
        : 'classic';
}

function trainingModeValue(mode) {
    return normalizeTrainingMode(mode) === 'survival' ? 'survival' : 'evolutionary';
}

function algorithmLabel(mode) {
    return normalizeTrainingMode(mode) === 'survival'
        ? 'Evolutionary · survival'
        : 'Evolutionary · balanced';
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

function hash32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
}

function mixSeed(a, b, c = 0, d = 0) {
    return hash32(
        (a >>> 0)
        ^ Math.imul((b + 0x9e3779b9) >>> 0, 0x85ebca6b)
        ^ Math.imul((c + 0xc2b2ae35) >>> 0, 0x27d4eb2f)
        ^ Math.imul((d + 0x165667b1) >>> 0, 0x9e3779b1)
    );
}

function seededGaussian(rng) {
    let u = 0;
    let v = 0;
    while (u <= Number.EPSILON) u = rng();
    while (v <= Number.EPSILON) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
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

    // Terrain frequencies are based on the original map width rather than the
    // now much longer world. This preserves local slopes and difficulty while
    // allowing each course to contain well over 125 pads.
    const extremeFeatures = [];
    if (def.profile === 'extreme') {
        const featureLength = def.featureLength || 3200;
        const featureCount = Math.ceil(WORLD_W / featureLength);
        for (let i = 0; i < featureCount; i++) {
            const featureRng = mulberry32(mixSeed(seed, i, 0x74a7c15d));
            const x0 = i * featureLength;
            const flatStart = x0 + featureLength * (0.05 + featureRng() * 0.08);
            const flatLength = featureLength * (0.22 + featureRng() * 0.17);
            extremeFeatures.push({
                flatStart,
                flatEnd: flatStart + flatLength,
                flatY: clamp(def.baseY + (featureRng() * 2 - 1) * 125, def.minY + 75, def.maxY - 35),
                flatEdge: 170 + featureRng() * 110,
                mountainX: x0 + featureLength * (0.43 + featureRng() * 0.14),
                mountainWidth: 185 + featureRng() * 180,
                mountainHeight: 150 + featureRng() * 165,
                valleyX: x0 + featureLength * (0.73 + featureRng() * 0.13),
                valleyWidth: 260 + featureRng() * 250,
                valleyDepth: 105 + featureRng() * 145,
            });
        }
    }

    const smooth01 = value => {
        const t = clamp(value, 0, 1);
        return t * t * (3 - 2 * t);
    };

    for (let i = 0; i <= count; i++) {
        const x = i * step;
        const nx = x / TERRAIN_PATTERN_W;
        let y = def.baseY
            + Math.sin(nx * Math.PI * def.wave1 + phase1) * def.amp1
            + Math.sin(nx * Math.PI * def.wave2 + phase2) * def.amp2
            + Math.sin(nx * Math.PI * def.wave3 + phase3) * def.amp3
            + (rng() - 0.5) * def.noise;

        if (extremeFeatures.length) {
            for (const feature of extremeFeatures) {
                const mountainZ = (x - feature.mountainX) / feature.mountainWidth;
                const valleyZ = (x - feature.valleyX) / feature.valleyWidth;
                y -= feature.mountainHeight * Math.exp(-0.5 * mountainZ * mountainZ);
                y += feature.valleyDepth * Math.exp(-0.5 * valleyZ * valleyZ);

                const enter = smooth01((x - feature.flatStart) / feature.flatEdge);
                const exit = smooth01((feature.flatEnd - x) / feature.flatEdge);
                const flatWeight = enter * exit;
                if (flatWeight > 0) y = lerp(y, feature.flatY, flatWeight * 0.94);
            }
        }

        y = clamp(y, def.minY, def.maxY);
        points.push({ x, y });
    }

    const pads = [];
    let cursor = 440 + rng() * 90;
    let padId = 0;

    const placePad = (requestedX, forceNarrow = false) => {
        const idx = clamp(Math.round(requestedX / step), 3, points.length - 6);
        const span = forceNarrow ? 2 : (rng() < 0.5 ? 2 : 3);
        const end = Math.min(points.length - 3, idx + span);
        let flatY = Infinity;
        for (let k = idx - 1; k <= end + 1; k++) flatY = Math.min(flatY, points[k].y);
        flatY = clamp(flatY - rng() * 8, def.minY, def.maxY);
        for (let k = idx; k <= end; k++) points[k].y = flatY;
        const x0 = points[idx].x;
        const width = points[end].x - points[idx].x;
        const pad = {
            id: padId++,
            x: x0,
            y: flatY,
            width,
            cx: x0 + width * 0.5,
            points: Math.floor(200 - width),
        };
        pads.push(pad);
        return pad;
    };

    while (cursor < WORLD_W - 260) {
        const pad = placePad(cursor);
        const randomGap = def.padSpacingMin + rng() * (def.padSpacingMax - def.padSpacingMin);
        cursor = pad.x + pad.width + randomGap;
    }

    // The long world and spacing limits normally produce substantially more
    // than 125 pads. This deterministic fallback makes the guarantee explicit
    // even if a future terrain definition uses wider spacing.
    if (pads.length < MIN_PADS_PER_MAP) {
        const targetGap = (WORLD_W - 900) / MIN_PADS_PER_MAP;
        for (let i = 0; i < MIN_PADS_PER_MAP && pads.length < MIN_PADS_PER_MAP; i++) {
            const requestedX = 450 + i * targetGap;
            const tooClose = pads.some(pad => Math.abs(pad.cx - requestedX) < 180);
            if (!tooClose) placePad(requestedX, true);
        }
        pads.sort((a, b) => a.x - b.x);
        for (let i = 0; i < pads.length; i++) pads[i].id = i;
    }

    if (!pads.length) {
        placePad(600, true);
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

function randomGenome(rng = Math.random) {
    const g = new Float32Array(GENOME_SIZE);

    const initLayer = (offset, fanIn, fanOut) => {
        const limit = Math.sqrt(6 / (fanIn + fanOut));
        const count = fanIn * fanOut;
        for (let i = 0; i < count; i++) g[offset + i] = (rng() * 2 - 1) * limit;
    };

    initLayer(OFF_WXH, N_IN, N_H1);
    initLayer(OFF_W12, N_H1, N_H2);
    initLayer(OFF_WHY, N_H2, N_OUT);

    // A slightly negative main-throttle bias keeps random agents from
    // burning all fuel before evolution discovers useful behaviour.
    g[OFF_BY + 1] = -0.55;
    return g;
}


function createBootstrapGenome() {
    const g = new Float32Array(GENOME_SIZE);

    // Route a compact set of physically meaningful signals through the two
    // hidden layers. This is not a solved policy; it is a stabilising prior
    // that prevents every first-generation agent from simply free-falling.
    const routedInputs = [
        30, // world-space horizontal target error
        22, // horizontal velocity
        26, // sin(angle)
        28, // angular velocity
        23, // vertical velocity
        29, // altitude
        18, // body-space target x
        25, // body-space downward velocity
        39, // landed
        41, // bias input
    ];

    for (let neuron = 0; neuron < routedInputs.length; neuron++) {
        g[OFF_WXH + routedInputs[neuron] * N_H1 + neuron] = 1.35;
        g[OFF_W12 + neuron * N_H2 + neuron] = 1.25;
    }

    // Turn: remain upright and remove angular velocity.
    g[OFF_WHY + 2 * N_OUT] = -2.25;
    g[OFF_WHY + 3 * N_OUT] = -1.35;

    // Main engine: brake hard when descending quickly, use less thrust high
    // above the terrain, and leave a pad promptly after landing.
    g[OFF_BY + 1] = 0.22;
    g[OFF_WHY + 4 * N_OUT + 1] = 2.35;
    g[OFF_WHY + 5 * N_OUT + 1] = -0.48;
    g[OFF_WHY + 7 * N_OUT + 1] = 0.45;
    g[OFF_WHY + 8 * N_OUT + 1] = 1.10;

    // Lateral control: move toward the target while damping horizontal speed.
    g[OFF_WHY + 0 * N_OUT + 2] = 2.20;
    g[OFF_WHY + 1 * N_OUT + 2] = -1.80;
    g[OFF_WHY + 6 * N_OUT + 2] = 0.75;

    return g;
}

class Brain {
    constructor(genome) {
        if (!(genome instanceof Float32Array) || genome.length !== GENOME_SIZE) {
            throw new Error(`Invalid brain genome. Expected ${GENOME_SIZE} values for brain v${BRAIN_VERSION}.`);
        }
        this.g = genome;
        this.h = new Float32Array(N_H1);
        this.h2 = new Float32Array(N_H2);
        this.out = new Float32Array(N_OUT);
    }

    reset() {
        this.h.fill(0);
        this.h2.fill(0);
        this.out.fill(0);
    }

    step(inp) {
        const { g, h, h2, out } = this;

        for (let j = 0; j < N_H1; j++) {
            let sum = g[OFF_BH + j];
            for (let i = 0; i < N_IN; i++) sum += g[OFF_WXH + i * N_H1 + j] * inp[i];
            h[j] = Math.tanh(sum);
        }

        for (let j = 0; j < N_H2; j++) {
            let sum = g[OFF_B2 + j];
            for (let i = 0; i < N_H1; i++) sum += g[OFF_W12 + i * N_H2 + j] * h[i];
            h2[j] = Math.tanh(sum);
        }

        for (let k = 0; k < N_OUT; k++) {
            let sum = g[OFF_BY + k];
            for (let j = 0; j < N_H2; j++) sum += g[OFF_WHY + j * N_OUT + k] * h2[j];
            out[k] = Math.tanh(sum);
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
        this.prevRays = new Float32Array(N_RAYS);
        this.trail = [];

        // Generation-level accumulators are intentionally not reset between
        // episodes. They are reset by constructing the next population.
        this.fitSum = 0;
        this.scoreSum = 0;
        this.landSum = 0;
        this.episodeFitness = [];
        this.selectionFitness = -Infinity;

        this.spawn(null, null);
    }

    spawn(template, initialState = null) {
        this.template = template;
        this.padState = template ? new Uint8Array(template.pads.length) : new Uint8Array(0);

        const fallbackPad = template ? template.startPad : { cx: 300, y: 300, width: 100 };
        const spawn = initialState || {
            x: fallbackPad.cx,
            y: fallbackPad.y - 195,
            vx: 0,
            vy: 0,
            angle: 0,
            angularVelocity: 0,
        };

        this.x = spawn.x;
        this.y = spawn.y;
        this.vx = spawn.vx;
        this.vy = spawn.vy;
        this.ax = 0;
        this.ay = 0;
        this.angle = spawn.angle;
        this.angularVelocity = spawn.angularVelocity;

        this.fuel = FUEL_MAX;
        this.oxygen = OXYGEN_MAX;
        this.score = 0;
        this.landings = 0;
        this.progress = 0;
        this.penalty = 0;
        this.lifeTime = 0;
        this.distanceCovered = 0;
        this.spawnX = spawn.x;
        this.spawnY = spawn.y;

        this.alive = true;
        this.crashed = false;
        this.missionComplete = false;
        this.deathReason = '';
        this.landed = false;
        this.altitude = 0;
        this.groundY = fallbackPad.y;
        this.landedTimer = 0;
        this.currentPad = -1;
        this.targetPad = -1;
        this.previousTargetPad = -1;
        this.previousPotential = null;
        this.bestTargetPotential = 0;
        this.lastProgressTime = 0;
        this.controlCounter = 0;
        this.sensorPad = -1;
        this.sensorPadInRange = false;

        this.prevMain = 0;
        this.prevTurn = 0;
        this.prevStrafe = 0;
        this.cmdMain = 0;
        this.cmdTurn = 0;
        this.cmdStrafe = 0;

        // Requested controls are filtered by physical actuator models before
        // they affect motion. Main thrust is continuously throttleable above
        // a floor; RCS channels are fixed-thrust pulse valves.
        this.actualMain = 0;
        this.actualTurn = 0;
        this.actualStrafe = 0;
        this.mainEngineOn = false;
        this.mainEngineOnTime = 0;
        this.mainEngineOffTime = MAIN_MIN_OFF_TIME;
        this.turnPulse = { state: 0, onTime: 0, offTime: RCS_MIN_OFF_TIME };
        this.strafePulse = { state: 0, onTime: 0, offTime: RCS_MIN_OFF_TIME };

        this.rays.fill(RAY_MAX);
        this.prevRays.fill(RAY_MAX);
        this.trail.length = 0;
        this.brain.reset();

        if (template) this.selectTargetPad(true);
    }

    get fitness() {
        return this.landings * PAD_FITNESS_VALUE
            + this.score * SCORE_FITNESS_VALUE
            + this.progress
            - this.penalty;
    }

    nearestPad(freshOnly = true, withinRangeOnly = false) {
        if (!this.template) return -1;
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

    selectTargetPad(force = false) {
        if (!this.template) return -1;
        if (!force && this.targetPad >= 0 && !this.padState[this.targetPad]) return this.targetPad;

        const oldTarget = this.targetPad;
        this.targetPad = this.nearestPad(true, false);
        if (this.targetPad !== oldTarget) {
            this.previousTargetPad = -1;
            this.previousPotential = null;
            this.bestTargetPotential = 0;
            this.lastProgressTime = this.lifeTime;
        }
        return this.targetPad;
    }

    targetPotential(padIdx, policy) {
        if (padIdx < 0) return 0;
        const pad = this.template.pads[padIdx];
        const dx = pad.cx - this.x;
        const dy = pad.y - this.y;
        const dist = Math.hypot(dx, dy);
        const corridorWidth = Math.max(150, pad.width * policy.corridorScale);
        const corridor = Math.exp(-Math.abs(dx) / corridorWidth);
        const proximity = Math.exp(-dist / 780);
        const altitude = Math.max(0, pad.y - (this.y + LANDER_FEET_Y));
        const lowAltitude = Math.exp(-altitude / 330);
        const attitude = Math.exp(-Math.abs(this.angle) / 0.32);
        const spin = Math.exp(-Math.abs(this.angularVelocity) / 0.8);
        const horizontalSafety = Math.exp(-Math.abs(this.vx) / 34);
        const desiredDownSpeed = clamp(altitude * 0.105, 7, SAFE_LANDING_VERTICAL_SPEED * 0.78);
        const descentSafety = Math.exp(-Math.abs(this.vy - desiredDownSpeed) / 38);

        let potential = proximity * 0.20
            + corridor * 0.22
            + lowAltitude * 0.13
            + attitude * 0.13
            + spin * 0.06
            + horizontalSafety * 0.12
            + descentSafety * 0.14;

        if (dist > PAD_SENSE_R) potential *= policy.remoteApproachCap;
        return clamp(potential, 0, 1);
    }

    sense(policy) {
        const rightX = Math.cos(this.angle);
        const rightY = Math.sin(this.angle);
        const upX = Math.sin(this.angle);
        const upY = -Math.cos(this.angle);
        const downAngle = this.angle + Math.PI / 2;

        for (let i = 0; i < N_RAYS; i++) {
            const rayAngle = downAngle + RAY_ANGLES[i];
            const distance = raycastTerrain(
                this.template,
                this.x,
                this.y,
                Math.cos(rayAngle),
                Math.sin(rayAngle),
                RAY_MAX,
            );
            this.rays[i] = distance;
            this.inp[i] = distance / RAY_MAX;
            this.inp[N_RAYS + i] = clamp((distance - this.prevRays[i]) / 80, -1, 1);
            this.prevRays[i] = distance;
        }

        const padIdx = this.selectTargetPad();
        this.sensorPad = padIdx;

        let dx = 0;
        let dy = 0;
        let distance = PAD_SENSE_R * 2;
        let padWidth = 0;
        if (padIdx >= 0) {
            const pad = this.template.pads[padIdx];
            dx = pad.cx - this.x;
            dy = pad.y - this.y;
            distance = Math.hypot(dx, dy);
            padWidth = pad.width;
        }

        this.sensorPadInRange = padIdx >= 0 && distance <= PAD_SENSE_R;
        const cueRange = this.sensorPadInRange
            ? PAD_SENSE_R
            : PAD_SENSE_R * policy.cueRangeMultiplier;

        const bodyTargetX = dx * rightX + dy * rightY;
        const bodyTargetDown = -(dx * upX + dy * upY);
        const localSideVelocity = this.vx * rightX + this.vy * rightY;
        const localDownVelocity = -(this.vx * upX + this.vy * upY);

        const ground = terrainInfoAt(this.template, this.x);
        const altitude = clamp(ground.y - (this.y + LANDER_FEET_Y), 0, RAY_MAX);
        this.altitude = altitude;
        this.groundY = ground.y;

        const base = N_RAYS * 2;
        this.inp[base] = clamp(bodyTargetX / cueRange, -1, 1);
        this.inp[base + 1] = clamp(bodyTargetDown / cueRange, -1, 1);
        this.inp[base + 2] = padIdx < 0
            ? 0
            : this.sensorPadInRange
                ? clamp(1 - distance / PAD_SENSE_R, 0, 1)
                : clamp(1 - distance / (PAD_SENSE_R * (policy.cueRangeMultiplier + 0.8)), 0, policy.remoteCueSignalCap);
        this.inp[base + 3] = clamp(padWidth / 180, 0, 1);

        this.inp[22] = clamp(this.vx / SPEED_SCALE, -1, 1);
        this.inp[23] = clamp(this.vy / SPEED_SCALE, -1, 1);
        this.inp[24] = clamp(localSideVelocity / SPEED_SCALE, -1, 1);
        this.inp[25] = clamp(localDownVelocity / SPEED_SCALE, -1, 1);
        this.inp[26] = Math.sin(this.angle);
        this.inp[27] = Math.cos(this.angle);
        this.inp[28] = clamp(this.angularVelocity / ANGVEL_SCALE, -1, 1);
        this.inp[29] = altitude / RAY_MAX;
        this.inp[30] = clamp(dx / PAD_SENSE_R, -1, 1);
        this.inp[31] = clamp(dy / PAD_SENSE_R, -1, 1);
        this.inp[32] = clamp(1 - Math.max(0, this.vy) / SAFE_LANDING_VERTICAL_SPEED, -1, 1);
        this.inp[33] = clamp(1 - Math.abs(this.vx) / SAFE_LANDING_HORIZONTAL_SPEED, -1, 1);
        this.inp[34] = this.fuel / FUEL_MAX;
        this.inp[35] = this.oxygen / OXYGEN_MAX;
        // Feed the physical actuator state back into the controller. This is
        // essential once commands no longer translate into instantaneous force.
        this.inp[36] = this.actualMain;
        this.inp[37] = this.actualTurn;
        this.inp[38] = this.actualStrafe;
        this.inp[39] = this.landed ? 1 : 0;
        this.inp[40] = clamp(this.lifeTime / MAX_EPISODE_TIME, 0, 1);
        this.inp[41] = 1;

        if (padIdx >= 0) {
            const potential = this.targetPotential(padIdx, policy);
            if (this.previousPotential !== null && this.previousTargetPad === padIdx) {
                const delta = clamp(potential - this.previousPotential, -0.06, 0.06);
                this.progress += delta * policy.approachReward;
            }
            this.previousPotential = potential;
            this.previousTargetPad = padIdx;
            if (potential > this.bestTargetPotential + 0.01) {
                this.bestTargetPotential = potential;
                this.lastProgressTime = this.lifeTime;
            }

            const corridor = clamp(1 - Math.abs(dx) / Math.max(170, padWidth * policy.corridorScale), 0, 1);
            const nearGround = clamp(1 - altitude / 300, 0, 1);
            const unsafeHorizontal = Math.max(0, Math.abs(this.vx) - SAFE_LANDING_HORIZONTAL_SPEED) / SPEED_SCALE;
            const unsafeVertical = Math.max(0, this.vy - SAFE_LANDING_VERTICAL_SPEED) / SPEED_SCALE;
            this.penalty += (
                Math.abs(this.angularVelocity) * 0.08
                + (1 - corridor) * 0.05
                + nearGround * (unsafeHorizontal * 0.8 + unsafeVertical)
            ) * policy.wanderCost * DT;
        }
    }

    updateMainActuator(dt) {
        if (this.fuel <= 0) {
            this.mainEngineOn = false;
            this.mainEngineOnTime = 0;
            this.mainEngineOffTime = 0;
            this.actualMain = 0;
            return;
        }

        const wantsOn = this.cmdMain >= MAIN_IGNITION_COMMAND;
        const wantsOff = this.cmdMain <= MAIN_SHUTDOWN_COMMAND;

        if (!this.mainEngineOn) {
            this.mainEngineOnTime = 0;
            this.mainEngineOffTime += dt;
            this.actualMain = 0;
            if (wantsOn && this.mainEngineOffTime >= MAIN_MIN_OFF_TIME) {
                this.mainEngineOn = true;
                this.mainEngineOnTime = 0;
                this.mainEngineOffTime = 0;
                this.actualMain = MAIN_MIN_THROTTLE;
            }
            return;
        }

        this.mainEngineOnTime += dt;
        this.mainEngineOffTime = 0;
        if (wantsOff && this.mainEngineOnTime >= MAIN_MIN_ON_TIME) {
            this.mainEngineOn = false;
            this.mainEngineOnTime = 0;
            this.mainEngineOffTime = 0;
            this.actualMain = 0;
            return;
        }

        const target = clamp(this.cmdMain, MAIN_MIN_THROTTLE, 1);
        const maxDelta = (target > this.actualMain
            ? MAIN_THROTTLE_SLEW_UP
            : MAIN_THROTTLE_SLEW_DOWN) * dt;
        this.actualMain += clamp(target - this.actualMain, -maxDelta, maxDelta);
        this.actualMain = clamp(this.actualMain, MAIN_MIN_THROTTLE, 1);
    }

    updatePulseActuator(actuator, request, dt) {
        if (this.fuel <= 0) {
            actuator.state = 0;
            actuator.onTime = 0;
            actuator.offTime = 0;
            return 0;
        }

        const desired = Math.abs(request) >= RCS_COMMAND_THRESHOLD
            ? (request > 0 ? 1 : -1)
            : 0;

        if (actuator.state === 0) {
            actuator.onTime = 0;
            actuator.offTime += dt;
            if (desired !== 0 && actuator.offTime >= RCS_MIN_OFF_TIME) {
                actuator.state = desired;
                actuator.onTime = 0;
                actuator.offTime = 0;
            }
            return actuator.state;
        }

        actuator.onTime += dt;
        actuator.offTime = 0;
        if (desired !== actuator.state && actuator.onTime >= RCS_MIN_ON_TIME) {
            // Reversing direction always passes through a genuine off gap.
            actuator.state = 0;
            actuator.onTime = 0;
            actuator.offTime = 0;
        }
        return actuator.state;
    }

    updateActuators(dt) {
        this.updateMainActuator(dt);
        this.actualTurn = this.updatePulseActuator(this.turnPulse, this.cmdTurn, dt);
        this.actualStrafe = this.updatePulseActuator(this.strafePulse, this.cmdStrafe, dt);
        this.prevMain = this.actualMain;
        this.prevTurn = this.actualTurn;
        this.prevStrafe = this.actualStrafe;
    }

    localPointAt(localX, localY, x = this.x, y = this.y, angle = this.angle) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return {
            x: x + localX * c - localY * s,
            y: y + localX * s + localY * c,
        };
    }

    footPositionsAt(x = this.x, y = this.y, angle = this.angle) {
        return {
            left: this.localPointAt(-LANDER_HALF_W, LANDER_FEET_Y, x, y, angle),
            right: this.localPointAt(LANDER_HALF_W, LANDER_FEET_Y, x, y, angle),
        };
    }

    footSamplePositionsAt(x = this.x, y = this.y, angle = this.angle) {
        // Sample the complete rendered foot bars, not only their centre points.
        // This makes an outer foot edge striking a mountain an immediate crash.
        return [
            this.localPointAt(-LANDER_HALF_W - LANDER_FOOT_HALF_WIDTH, LANDER_FEET_Y, x, y, angle),
            this.localPointAt(-LANDER_HALF_W, LANDER_FEET_Y, x, y, angle),
            this.localPointAt(-LANDER_HALF_W + LANDER_FOOT_HALF_WIDTH, LANDER_FEET_Y, x, y, angle),
            this.localPointAt(LANDER_HALF_W - LANDER_FOOT_HALF_WIDTH, LANDER_FEET_Y, x, y, angle),
            this.localPointAt(LANDER_HALF_W, LANDER_FEET_Y, x, y, angle),
            this.localPointAt(LANDER_HALF_W + LANDER_FOOT_HALF_WIDTH, LANDER_FEET_Y, x, y, angle),
        ];
    }

    footPositions() {
        return this.footPositionsAt();
    }

    solidCollisionAt(x, y, angle) {
        for (const [localX, localY] of LANDER_SOLID_LOCAL_POINTS) {
            const point = this.localPointAt(localX, localY, x, y, angle);
            const ground = terrainInfoAt(this.template, point.x).y;
            if (point.y >= ground - TERRAIN_CONTACT_EPSILON) return point;
        }
        return null;
    }

    sweptTerrainContact(previousX, previousY, previousAngle, nextX, nextY, nextAngle) {
        const translation = Math.hypot(nextX - previousX, nextY - previousY);
        const angleDelta = nextAngle - previousAngle;
        const rotationTravel = Math.abs(angleDelta) * LANDER_COLLISION_RADIUS;
        const steps = clamp(
            Math.ceil(Math.max(translation, rotationTravel) / COLLISION_SWEEP_STEP),
            1,
            COLLISION_MAX_SWEEP_STEPS,
        );

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = lerp(previousX, nextX, t);
            const y = lerp(previousY, nextY, t);
            const angle = previousAngle + angleDelta * t;
            const solidPoint = this.solidCollisionAt(x, y, angle);
            const feet = this.footPositionsAt(x, y, angle);
            const footSamples = this.footSamplePositionsAt(x, y, angle);
            const footHits = footSamples.map(point => {
                const terrain = terrainInfoAt(this.template, point.x);
                return {
                    point,
                    groundY: terrain.y,
                    hit: point.y >= terrain.y - TERRAIN_CONTACT_EPSILON,
                };
            });
            const anyFootHit = footHits.some(sample => sample.hit);

            if (solidPoint || anyFootHit) {
                return {
                    x, y, angle, feet, footSamples, footHits,
                    solidPoint,
                    anyFootHit,
                    padIdx: solidPoint ? -1 : this.contactPad(footSamples, footHits),
                };
            }
        }
        return null;
    }

    contactPad(footSamples, footHits) {
        if (!footSamples?.length || !footHits?.some(sample => sample.hit)) return -1;
        const minFootX = Math.min(...footSamples.map(point => point.x));
        const maxFootX = Math.max(...footSamples.map(point => point.x));

        for (let i = 0; i < this.template.pads.length; i++) {
            const pad = this.template.pads[i];
            const margin = 3;
            if (minFootX < pad.x + margin || maxFootX > pad.x + pad.width - margin) continue;

            let touchesPad = false;
            let validPadSurface = true;
            for (let j = 0; j < footSamples.length; j++) {
                const point = footSamples[j];
                const sample = footHits[j];
                const groundY = terrainInfoAt(this.template, point.x).y;

                // Every part of both feet must be above the same flat pad. If an
                // outer edge is over a mountain slope, contactPad rejects it and
                // the swept contact is processed as a crash.
                if (Math.abs(groundY - pad.y) > 1.5 || point.y > pad.y + 1.5) {
                    validPadSurface = false;
                    break;
                }
                if (sample.hit && Math.abs(sample.groundY - pad.y) <= 1.5) touchesPad = true;
            }
            if (validPadSurface && touchesPad) return i;
        }
        return -1;
    }

    isSafeLanding(vx, vy, angularVelocity, angle) {
        return vy >= -SAFE_LANDING_UPWARD_SPEED
            && vy <= SAFE_LANDING_VERTICAL_SPEED
            && Math.abs(vx) <= SAFE_LANDING_HORIZONTAL_SPEED
            && Math.abs(angle) <= SAFE_LANDING_ANGLE
            && Math.abs(angularVelocity) <= SAFE_LANDING_ANGULAR_SPEED;
    }

    successfulLanding(padIdx) {
        const pad = this.template.pads[padIdx];
        const firstVisit = !this.padState[padIdx];

        if (firstVisit) {
            this.padState[padIdx] = 1;
            this.score += pad.points + LANDING_BONUS;
            this.fuel = Math.min(FUEL_MAX, this.fuel + PAD_FUEL_REWARD);
            this.oxygen = Math.min(OXYGEN_MAX, this.oxygen + PAD_OXYGEN_REWARD);
            this.landings++;
            this.progress += LAND_REWARD + pad.points * 4;
        }

        this.y = pad.y - LANDER_FEET_Y;
        this.vx = 0;
        this.vy = 0;
        this.angularVelocity = 0;
        this.angle = 0;
        this.ax = 0;
        this.ay = 0;
        this.landed = true;
        this.landedTimer = 0;
        this.currentPad = padIdx;

        if (firstVisit) {
            this.targetPad = -1;
            this.previousTargetPad = -1;
            this.previousPotential = null;
            this.bestTargetPotential = 0;
            this.lastProgressTime = this.lifeTime;
        }

        if (this.landings >= this.template.pads.length) {
            this.missionComplete = true;
            this.alive = false;
            this.deathReason = 'mission-complete';
            this.progress += PAD_FITNESS_VALUE * 0.5;
        }
    }

    terminate(reason, extraPenalty = 0) {
        this.alive = false;
        this.landed = false;
        this.currentPad = -1;
        this.deathReason = reason;
        this.penalty += extraPenalty;
    }

    crash(vx, vy, angularVelocity, angle, policy) {
        this.crashed = true;
        const impact = Math.hypot(vx, vy);
        const attitudeError = Math.abs(angle) + Math.abs(angularVelocity) * 0.35;
        this.terminate(
            'crash',
            policy.crashPenalty + Math.min(650, impact * 7 + attitudeError * 120),
        );
    }

    updateTrail() {
        if (this.trail.length > 80) this.trail.shift();
        this.trail.push({ x: this.x, y: this.y });
    }

    step(policy) {
        if (!this.alive) return;

        this.lifeTime += DT;
        this.oxygen = Math.max(0, this.oxygen - DT);

        if (this.oxygen <= 0) {
            this.terminate('oxygen', policy.crashPenalty * 0.65);
            return;
        }
        if (
            this.lifeTime >= MAX_EPISODE_TIME
            || this.lifeTime - this.lastProgressTime >= NO_PROGRESS_TIMEOUT
        ) {
            this.terminate('timeout', policy.crashPenalty * 0.35);
            return;
        }

        const fuelFraction = this.fuel / FUEL_MAX;
        const oxygenFraction = this.oxygen / OXYGEN_MAX;
        if (fuelFraction < 0.24) this.penalty += (0.24 - fuelFraction) * policy.lowResourceCost * DT;
        if (oxygenFraction < 0.20) this.penalty += (0.20 - oxygenFraction) * policy.lowResourceCost * 1.25 * DT;

        if (this.controlCounter <= 0) {
            this.sense(policy);
            const output = this.brain.step(this.inp);

            const targetTurn = Math.abs(output[0]) < 0.035 ? 0 : output[0];
            const rawThrottle = clamp((output[1] + 1) * 0.5, 0, 1);
            const targetMain = rawThrottle * rawThrottle;
            const targetStrafe = Math.abs(output[2]) < 0.035 ? 0 : output[2];

            const oldTurn = this.cmdTurn;
            const oldMain = this.cmdMain;
            const oldStrafe = this.cmdStrafe;

            this.cmdTurn += (targetTurn - this.cmdTurn) * ACTION_RESPONSE;
            this.cmdMain += (targetMain - this.cmdMain) * ACTION_RESPONSE;
            this.cmdStrafe += (targetStrafe - this.cmdStrafe) * ACTION_RESPONSE;

            this.penalty += (
                Math.abs(this.cmdTurn - oldTurn)
                + Math.abs(this.cmdMain - oldMain)
                + Math.abs(this.cmdStrafe - oldStrafe)
            ) * JERK_COST;

            this.controlCounter = CONTROL_INTERVAL - 1;
        } else {
            this.controlCounter--;
        }

        this.updateActuators(DT);
        this.penalty += Math.abs(this.angularVelocity) * policy.spinCost * DT;

        if (this.landed) {
            this.landedTimer += DT;
            const pad = this.template.pads[this.currentPad];

            // Correct ground-state handling: remain supported by the pad until
            // enough main thrust is requested to overcome lunar gravity.
            this.y = pad.y - LANDER_FEET_Y;
            this.vx = 0;
            this.vy = 0;
            this.angularVelocity = 0;
            this.angle = 0;
            this.ax = 0;
            this.ay = 0;

            if (this.actualMain <= TAKEOFF_THROTTLE || this.fuel <= 0) {
                if (this.landedTimer > policy.padIdleGrace) this.penalty += policy.padIdleCost * DT;
                if (this.fuel <= 0) this.terminate('fuel', policy.crashPenalty * 0.45);
                this.updateTrail();
                return;
            }

            this.landed = false;
            this.currentPad = -1;
            this.landedTimer = 0;
            this.y -= 1.25;
            this.vy = -1.5;
        } else {
            this.landedTimer = 0;
        }

        const previousX = this.x;
        const previousY = this.y;
        const previousAngle = this.angle;
        const previousVX = this.vx;
        const previousVY = this.vy;
        const rightX = Math.cos(this.angle);
        const rightY = Math.sin(this.angle);
        const massFactor = DRY_MASS_FACTOR + FUEL_MASS_FACTOR * fuelFraction;
        const accelerationScale = 1 / Math.max(0.55, massFactor);

        if (this.fuel > 0) {
            const mainAcceleration = MAIN_THRUST * this.actualMain * accelerationScale;
            this.vx += Math.sin(this.angle) * mainAcceleration * DT;
            this.vy -= Math.cos(this.angle) * mainAcceleration * DT;

            const sideAcceleration = SIDE_THRUST * this.actualStrafe * accelerationScale;
            this.vx += rightX * sideAcceleration * DT;
            this.vy += rightY * sideAcceleration * DT;

            this.angularVelocity += this.actualTurn * TURN_ACCEL * accelerationScale * DT;
            this.angularVelocity *= Math.exp(-ANGULAR_DAMPING * DT);
            this.angularVelocity = clamp(this.angularVelocity, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);

            const fuelUsed = (
                this.actualMain * MAIN_FUEL_RATE
                + (Math.abs(this.actualTurn) + Math.abs(this.actualStrafe)) * AUX_FUEL_RATE
            ) * DT;
            this.fuel = Math.max(0, this.fuel - fuelUsed);
            this.penalty += fuelUsed * policy.fuelDriftCost;
        }

        this.vy += GRAVITY * DT;
        this.x += this.vx * DT;
        this.y += this.vy * DT;
        this.distanceCovered += Math.hypot(this.x - previousX, this.y - previousY);
        this.angle += this.angularVelocity * DT;

        if (this.angle > Math.PI) this.angle -= Math.PI * 2;
        if (this.angle < -Math.PI) this.angle += Math.PI * 2;

        this.ax = (this.vx - previousVX) / DT;
        this.ay = (this.vy - previousVY) / DT;

        if (this.x < -LANDER_HALF_W || this.x > WORLD_W + LANDER_HALF_W || this.y < -500 || this.y > WORLD_H + 200) {
            this.crash(this.vx, this.vy, this.angularVelocity, this.angle, policy);
            return;
        }

        const contact = this.sweptTerrainContact(
            previousX,
            previousY,
            previousAngle,
            this.x,
            this.y,
            this.angle,
        );

        if (contact) {
            // Freeze at the first swept impact so a high-speed craft cannot
            // tunnel through terrain or appear intact on the far side.
            this.x = contact.x;
            this.y = contact.y;
            this.angle = contact.angle;

            const impactVX = this.vx;
            const impactVY = this.vy;
            const impactAngularVelocity = this.angularVelocity;
            const impactAngle = this.angle;

            if (
                !contact.solidPoint
                && contact.padIdx >= 0
                && this.isSafeLanding(impactVX, impactVY, impactAngularVelocity, impactAngle)
            ) {
                this.successfulLanding(contact.padIdx);
            } else {
                this.crash(impactVX, impactVY, impactAngularVelocity, impactAngle, policy);
                return;
            }
        }

        this.updateTrail();
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
    mutRate: 28 / GENOME_SIZE,
    mutationSigma: 0.18,
    stagnation: 0,
    bestSelectionFitness: -Infinity,
    globalChampionGenome: null,
    globalChampionFitness: -Infinity,
    scenarioBaseSeed: hash32(Date.now()),
    currentScenario: null,
    speedStop: 3,
    sensorMode: 'all',
    history: [],
    stepsThisSecond: 0,
    simRate: 0,
    stepCarry: 0,
    cameraMode: CAMERA_DEFAULT_MODE,
    cameraX: 0,
    cameraY: 0,
    cameraVX: 0,
    cameraVY: 0,
    cameraReady: false,
    cameraLastTime: 0,
    cameraLeaderIdx: -1,
    cameraSwitchStart: 0,
    cameraSwitchFromX: 0,
    cameraSwitchFromY: 0,
    cameraLeaderBias: CAMERA_AVERAGE_LEADER_BIAS,
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
        roundScenarioSeed: hash32(Date.now() ^ 0xa5a5a5a5),
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
    return hash32(S.seedTicker ^ Date.now());
}

function makeEpisodeScenario(state) {
    const fixedEpisode = state.episode < N_FIXED_EPISODES;
    const generationKey = fixedEpisode ? 0 : state.gen;
    const terrainSeed = mixSeed(
        state.scenarioBaseSeed,
        S.terrainIdx,
        generationKey,
        state.episode,
    );
    const template = buildTerrain(TERRAIN_DEFS[S.terrainIdx], terrainSeed);
    const rng = mulberry32(mixSeed(terrainSeed, 0x51ed270b));
    const pad = template.startPad;

    return {
        template,
        spawn: {
            x: pad.cx + (rng() * 2 - 1) * Math.min(18, pad.width * 0.12),
            y: pad.y - (175 + rng() * 55),
            vx: (rng() * 2 - 1) * 7,
            vy: (rng() * 2 - 1) * 4,
            angle: (rng() * 2 - 1) * 0.11,
            angularVelocity: (rng() * 2 - 1) * 0.08,
        },
    };
}

function prepareEpisodeFor(state) {
    const scenario = makeEpisodeScenario(state);
    state.currentScenario = scenario;
    state.template = scenario.template;
    for (const agent of state.agents) agent.spawn(state.template, scenario.spawn);
    state.simTime = 0;
}

function prepareEpisode() {
    prepareEpisodeFor(S);
    S.stepCarry = 0;
    S.cameraReady = false;
    S.cameraVX = 0;
    S.cameraVY = 0;
    S.cameraLastTime = 0;
    S.cameraLeaderIdx = -1;
}

function spawnPopulationFor(state, genomes) {
    state.agents = genomes.map((genome, index) => {
        const agent = new Lander(genome, index);
        agent.isProtectedElite = index === 0 && validGenome(state.globalChampionGenome);
        return agent;
    });
    state.episode = 0;
    state.genBestScore = 0;
    state.genMeanScore = 0;
    state.genBestPads = 0;
    state.genMeanPads = 0;
    prepareEpisodeFor(state);
}

function spawnPopulation(genomes) {
    spawnPopulationFor(S, genomes);
    S.stepCarry = 0;
    S.cameraReady = false;
    S.cameraVX = 0;
    S.cameraVY = 0;
    S.cameraLastTime = 0;
    S.cameraLeaderIdx = -1;
}

function validGenome(genome) {
    return genome && genome.length === GENOME_SIZE;
}

function buildPopulationFromSeed(seedGenome, popSize, mode, state = S) {
    if (!validGenome(seedGenome)) {
        return Array.from({ length: popSize }, () => randomGenome());
    }

    const normalizedMode = normalizeTrainingMode(mode);
    const seed = new Float32Array(seedGenome);
    const genomes = [seed];
    const freshCount = normalizedMode === 'survival'
        ? Math.max(6, Math.round(popSize * SURVIVAL_FRESH_FRACTION))
        : Math.max(N_FRESH, Math.round(popSize * 0.10));

    const mutationScale = normalizedMode === 'survival' ? 1.02 : 0.85;
    while (genomes.length < popSize - freshCount) {
        if (genomes.length < 12) {
            genomes.push(mutateGenome(seed, state, mutationScale * (0.65 + genomes.length * 0.05)));
        } else {
            const mate = randomGenome();
            genomes.push(mutateGenome(blendCrossover(seed, mate), state, mutationScale));
        }
    }
    while (genomes.length < popSize) genomes.push(randomGenome());
    return genomes;
}

function freshPopulation() {
    let genomes;
    if (S.seedChampionGenome && validGenome(S.seedChampionGenome)) {
        genomes = buildPopulationFromSeed(S.seedChampionGenome, S.popSize, S.trainingEvolutionMode, S);
    } else {
        const bootstrap = createBootstrapGenome();
        genomes = [bootstrap];
        const bootstrapCount = Math.min(18, Math.max(8, Math.floor(S.popSize * 0.22)));
        while (genomes.length < bootstrapCount) {
            genomes.push(mutateGenome(bootstrap, S, 0.55 + genomes.length * 0.035));
        }
        while (genomes.length < S.popSize) genomes.push(randomGenome());
    }
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
    S.stagnation = 0;
    S.bestSelectionFitness = -Infinity;
    S.globalChampionFitness = -Infinity;
    S.globalChampionGenome = null;

    if (clearHistory) {
        S.history.length = 0;
        if (!S.explorer.active) S.scenarioBaseSeed = nextSeed();
    }

    freshPopulation();

    if (clearHistory) {
        drawChart();
        drawLandings();
    }
    updateStats();
    if (typeof updatePolicyExplorerUI === 'function') updatePolicyExplorerUI();
}

function currentBestAgent() {
    return [...S.agents].sort((a, b) => {
        const aFitness = Number.isFinite(a.selectionFitness) ? a.selectionFitness : a.fitness;
        const bFitness = Number.isFinite(b.selectionFitness) ? b.selectionFitness : b.fitness;
        return bFitness - aFitness;
    })[0] || S.agents[0] || null;
}

function rankFitness(agent, evolutionMode) {
    const padDominantScore = agent.landings * PAD_FITNESS_VALUE;
    const missionBonus = agent.missionComplete ? PAD_FITNESS_VALUE * 0.5 : 0;
    const base = padDominantScore
        + missionBonus
        + agent.score * SCORE_FITNESS_VALUE
        + agent.progress
        - agent.penalty;

    if (normalizeTrainingMode(evolutionMode) === 'survival') {
        const resources = (agent.fuel / FUEL_MAX + agent.oxygen / OXYGEN_MAX) * 0.5;
        return base + agent.lifeTime * 6 + resources * 650;
    }
    return base;
}

function aggregateEpisodeFitness(agent) {
    const values = [...agent.episodeFitness].sort((a, b) => a - b);
    if (!values.length) return -Infinity;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const middle = values.length >> 1;
    const median = values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) * 0.5;
    const worst = values[0];

    // The worst-case term prevents a controller that succeeds once and fails
    // everywhere else from dominating a consistently good controller.
    return mean * 0.58 + median * 0.27 + worst * 0.15;
}

function mutationValueForIndex(index) {
    if (index >= OFF_WXH && index < OFF_BH) {
        return (Math.random() * 2 - 1) * Math.sqrt(6 / (N_IN + N_H1));
    }
    if (index >= OFF_W12 && index < OFF_B2) {
        return (Math.random() * 2 - 1) * Math.sqrt(6 / (N_H1 + N_H2));
    }
    if (index >= OFF_WHY && index < OFF_BY) {
        return (Math.random() * 2 - 1) * Math.sqrt(6 / (N_H2 + N_OUT));
    }
    return gauss() * 0.08;
}

function mutateGenome(genome, state = S, scale = 1) {
    const child = new Float32Array(genome);
    const stagnationBoost = 1 + Math.min(2.2, (state.stagnation || 0) * 0.09);
    const sigma = (state.mutationSigma || 0.18) * scale * stagnationBoost;
    const mutationRate = clamp((state.mutRate || S.mutRate) * (1 + Math.min(1.4, (state.stagnation || 0) * 0.05)), 1 / GENOME_SIZE, 0.18);
    const resetRate = 0.0008 * scale * stagnationBoost;
    let mutations = 0;

    for (let i = 0; i < GENOME_SIZE; i++) {
        if (Math.random() < resetRate) {
            child[i] = mutationValueForIndex(i);
            mutations++;
        } else if (Math.random() < mutationRate) {
            child[i] = clamp(child[i] + gauss() * sigma, -5, 5);
            mutations++;
        }
    }

    if (mutations === 0) {
        const index = (Math.random() * GENOME_SIZE) | 0;
        child[index] = clamp(child[index] + gauss() * sigma, -5, 5);
    }
    return child;
}

function blendCrossover(a, b) {
    const child = new Float32Array(GENOME_SIZE);
    for (let i = 0; i < GENOME_SIZE; i++) {
        // BLX-style interpolation preserves useful weight combinations much
        // better than independent uniform gene swapping.
        const alpha = -0.10 + Math.random() * 1.20;
        child[i] = clamp(a[i] * alpha + b[i] * (1 - alpha), -5, 5);
    }
    return child;
}

function mutate(g, scale = 1) {
    return mutateGenome(g, S, scale);
}

function mutateSurvival(g, scale = 1) {
    return mutateGenome(g, S, scale * 1.18);
}

function crossover(a, b) {
    return blendCrossover(a, b);
}

function resolveEvolutionMode(baseMode) {
    return normalizeTrainingMode(baseMode);
}

function laneEvolutionMode() {
    return S.trainingEvolutionMode;
}

function rankBiasedParent(sorted, poolFraction = 0.55) {
    const poolSize = Math.max(2, Math.ceil(sorted.length * poolFraction));
    const u = Math.random();
    const index = Math.min(poolSize - 1, Math.floor(u * u * poolSize));
    return sorted[index];
}

function buildNextGeneration(sorted, popSize, evolutionMode, state = S) {
    const genomes = [];
    const freshCount = normalizeTrainingMode(evolutionMode) === 'survival'
        ? Math.max(6, Math.round(popSize * SURVIVAL_FRESH_FRACTION))
        : Math.max(N_FRESH, Math.round(popSize * 0.10));
    const mutationScale = normalizeTrainingMode(evolutionMode) === 'survival' ? 1.02 : 0.92;

    // Exactly one protected elite occupies index 0. It is the best genome seen
    // across the entire session and is copied byte-for-byte, never crossed or
    // mutated. Because all four evaluation scenarios are fixed for the session,
    // its measured performance is deterministic from generation to generation.
    const protectedElite = validGenome(state.globalChampionGenome)
        ? state.globalChampionGenome
        : sorted[0]?.brain.g;
    if (validGenome(protectedElite) && genomes.length < popSize) {
        genomes.push(new Float32Array(protectedElite));
    }

    const champion = validGenome(protectedElite) ? protectedElite : sorted[0].brain.g;
    const championMutants = Math.max(8, Math.floor(popSize * CHAMP_FRACTION));
    for (let i = 0; i < championMutants && genomes.length < popSize - freshCount; i++) {
        const pairScale = mutationScale * (0.55 + (i >> 1) * 0.06);
        genomes.push(mutateGenome(champion, state, pairScale));
    }

    while (genomes.length < popSize - freshCount) {
        const parentA = rankBiasedParent(sorted);
        if (Math.random() < 0.72) {
            const parentB = rankBiasedParent(sorted);
            const child = blendCrossover(parentA.brain.g, parentB.brain.g);
            genomes.push(mutateGenome(child, state, mutationScale * (0.75 + Math.random() * 0.45)));
        } else {
            genomes.push(mutateGenome(parentA.brain.g, state, mutationScale * (0.65 + Math.random() * 0.55)));
        }
    }

    while (genomes.length < popSize) genomes.push(randomGenome());
    return genomes;
}

function mutateForMode(g, evolutionMode, scale = 1, state = S) {
    return mutateGenome(g, state, normalizeTrainingMode(evolutionMode) === 'survival' ? scale * 1.05 : scale);
}

function tournament(sorted) {
    let best = rankBiasedParent(sorted, 0.75);
    for (let i = 0; i < 2; i++) {
        const challenger = rankBiasedParent(sorted, 0.75);
        if (challenger.selectionFitness > best.selectionFitness) best = challenger;
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
        mutRate: S.mutRate,
        mutationSigma: S.mutationSigma,
        stagnation: 0,
        bestSelectionFitness: -Infinity,
        globalChampionGenome: null,
        globalChampionFitness: -Infinity,
        scenarioBaseSeed: S.explorer.roundScenarioSeed,
        currentScenario: null,
        genBestScore: 0,
        genMeanScore: 0,
        genBestPads: 0,
        genMeanPads: 0,
    };
}

function prepareEpisodeForState(state) {
    prepareEpisodeFor(state);
}

function spawnPopulationForState(state, genomes) {
    spawnPopulationFor(state, genomes);
}

function freshPopulationForState(state) {
    state.popSize = Math.min(POP_LIMIT, S.nextPopSize);
    const bootstrap = createBootstrapGenome();
    const genomes = [bootstrap];
    const bootstrapCount = Math.min(18, Math.max(8, Math.floor(state.popSize * 0.22)));
    while (genomes.length < bootstrapCount) {
        genomes.push(mutateGenome(bootstrap, state, 0.55 + genomes.length * 0.035));
    }
    while (genomes.length < state.popSize) genomes.push(randomGenome());
    spawnPopulationFor(state, genomes);
}

function finishGenerationForState(state) {
    const evolutionMode = state.evolutionMode || 'classic';

    for (const agent of state.agents) {
        const episodeFitness = rankFitness(agent, evolutionMode);
        agent.episodeFitness.push(episodeFitness);
        agent.fitSum += episodeFitness;
        agent.scoreSum += agent.score;
        agent.landSum += agent.landings;
    }
    state.episode++;

    if (state.episode < N_EPISODES) {
        prepareEpisodeFor(state);
        return null;
    }

    let bestScore = 0;
    let bestPads = 0;
    let meanScore = 0;
    let meanPads = 0;
    for (const agent of state.agents) {
        agent.selectionFitness = aggregateEpisodeFitness(agent);
        const avgScore = agent.scoreSum / N_EPISODES;
        const avgPads = agent.landSum / N_EPISODES;
        bestScore = Math.max(bestScore, avgScore);
        bestPads = Math.max(bestPads, avgPads);
        meanScore += avgScore;
        meanPads += avgPads;
    }
    meanScore /= state.agents.length;
    meanPads /= state.agents.length;

    const sorted = [...state.agents].sort((a, b) => b.selectionFitness - a.selectionFitness);
    const generationBest = sorted[0]?.selectionFitness ?? -Infinity;

    if (generationBest > state.bestSelectionFitness + 1) {
        state.bestSelectionFitness = generationBest;
        state.globalChampionFitness = generationBest;
        state.globalChampionGenome = sorted[0] ? new Float32Array(sorted[0].brain.g) : state.globalChampionGenome;
        state.stagnation = 0;
    } else {
        state.stagnation++;
    }

    const summary = {
        bestScore,
        bestPads,
        meanScore,
        meanPads,
        gen: state.gen,
    };

    state.popSize = Math.min(POP_LIMIT, S.nextPopSize);
    const genomes = buildNextGeneration(sorted, state.popSize, evolutionMode, state);
    state.gen++;
    spawnPopulationFor(state, genomes);
    return summary;
}

function stepSimForState(state) {
    for (const agent of state.agents) {
        if (agent.alive) agent.step(state.policy);
    }

    let alive = 0;
    for (const agent of state.agents) if (agent.alive) alive++;
    state.simTime += DT;
    S.stepsThisSecond++;

    if (alive === 0) return finishGenerationForState(state);
    return null;
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
    S.explorer.roundScenarioSeed = nextSeed();
    S.scenarioBaseSeed = S.explorer.roundScenarioSeed;
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

    for (const agent of S.agents) {
        const episodeFitness = rankFitness(agent, evolutionMode);
        agent.episodeFitness.push(episodeFitness);
        agent.fitSum += episodeFitness;
        agent.scoreSum += agent.score;
        agent.landSum += agent.landings;
    }
    S.episode++;

    if (S.episode < N_EPISODES) {
        prepareEpisode();
        flashBanner(`Generation <b>${S.gen}</b> — episode ${S.episode + 1}/${N_EPISODES}`);
        return;
    }

    let bestScore = 0;
    let bestPads = 0;
    let meanScore = 0;
    let meanPads = 0;

    for (const agent of S.agents) {
        agent.selectionFitness = aggregateEpisodeFitness(agent);
        const averageScore = agent.scoreSum / N_EPISODES;
        const averagePads = agent.landSum / N_EPISODES;
        bestScore = Math.max(bestScore, averageScore);
        bestPads = Math.max(bestPads, averagePads);
        meanScore += averageScore;
        meanPads += averagePads;
    }
    meanScore /= S.agents.length;
    meanPads /= S.agents.length;

    const sorted = [...S.agents].sort((a, b) => b.selectionFitness - a.selectionFitness);
    const generationBest = sorted[0]?.selectionFitness ?? -Infinity;

    if (generationBest > S.bestSelectionFitness + 1) {
        S.bestSelectionFitness = generationBest;
        S.globalChampionFitness = generationBest;
        S.globalChampionGenome = sorted[0] ? new Float32Array(sorted[0].brain.g) : S.globalChampionGenome;
        S.stagnation = 0;
    } else {
        S.stagnation++;
    }

    S.genBestScore = bestScore;
    S.genBestPads = bestPads;
    S.genMeanScore = meanScore;
    S.genMeanPads = meanPads;

    S.history.push({
        bestScore,
        meanScore,
        bestPads,
        meanPads,
        terrainIdx: S.terrainIdx,
    });
    if (S.history.length > 400) S.history.shift();

    S.recordScore = Math.max(S.recordScore, bestScore);
    S.recordPads = Math.max(S.recordPads, bestPads);
    drawChart();
    drawLandings();

    if (recordExplorerGeneration(bestPads, meanPads, bestScore, meanScore)) return;

    let genomes;
    S.popSize = Math.min(POP_LIMIT, S.nextPopSize);
    if (S.evalMode) {
        genomes = sorted.slice(0, S.popSize).map(agent => new Float32Array(agent.brain.g));
        while (genomes.length < S.popSize) genomes.push(new Float32Array(sorted[0].brain.g));
    } else {
        genomes = buildNextGeneration(sorted, S.popSize, evolutionMode, S);
    }

    S.gen++;
    spawnPopulation(genomes);
    flashBanner(
        `Generation <b>${S.gen}</b> — avg-best ${bestScore.toFixed(1)} · pads ${bestPads.toFixed(2)}`
        + (S.stagnation ? ` · stagnation ${S.stagnation}` : ''),
    );
}

function stepSim() {
    for (const agent of S.agents) {
        if (agent.alive) agent.step(S.policy);
    }

    let alive = 0;
    for (const agent of S.agents) if (agent.alive) alive++;
    S.simTime += DT;
    S.stepsThisSecond++;

    if (alive === 0) finishGeneration();

    // The original code defined a second policy-explorer lane but never
    // advanced it, causing policy-search rounds to stall permanently.
    stepExplorerParallelLanes();
}

function explorerLane(name) {
    return S.explorer.lanes.find(lane => lane.name === name) || S.explorer.lanes[0];
}

function distanceToNextPad(agent) {
    if (!agent?.template?.pads?.length) return Infinity;

    let padIdx = agent.targetPad;
    if (!(padIdx >= 0 && padIdx < agent.template.pads.length && !agent.padState[padIdx])) {
        padIdx = agent.nearestPad(true, false);
    }
    if (padIdx < 0) return 0;

    const pad = agent.template.pads[padIdx];
    return Math.hypot(pad.cx - agent.x, pad.y - (agent.y + LANDER_FEET_Y));
}

function compareLeaderCandidates(a, b) {
    if (a.landings !== b.landings) return a.landings - b.landings;

    const aNext = distanceToNextPad(a);
    const bNext = distanceToNextPad(b);
    if (Math.abs(aNext - bNext) > 0.01) return bNext - aNext; // shorter is better

    if (Math.abs(a.distanceCovered - b.distanceCovered) > 0.01) return a.distanceCovered - b.distanceCovered;
    if (a.score !== b.score) return a.score - b.score;
    if (a.fitness !== b.fitness) return a.fitness - b.fitness;
    return b.idx - a.idx;
}

function leaderForState(state) {
    if (!state || !state.agents || !state.agents.length) return null;

    // Strict lexicographic order: most pads, shortest remaining distance to the
    // next unvisited pad, then greatest total flight distance. Score and fitness
    // are only exact-tie fallbacks and never override the requested hierarchy.
    let best = state.agents[0];
    for (let i = 1; i < state.agents.length; i++) {
        if (compareLeaderCandidates(state.agents[i], best) > 0) best = state.agents[i];
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
    'Terrain far left', 'Terrain left 65°', 'Terrain left 45°', 'Terrain left 25°',
    'Terrain directly below', 'Terrain right 25°', 'Terrain right 45°', 'Terrain right 65°',
    'Terrain far right', 'Far-left range change', 'Left 65° range change', 'Left 45° range change',
    'Left 25° range change', 'Below range change', 'Right 25° range change', 'Right 45° range change',
    'Right 65° range change', 'Far-right range change', 'Target sideways', 'Target downward',
    'Target proximity', 'Landing-pad width', 'World speed X', 'World speed Y',
    'Body sideways speed', 'Body downward speed', 'Craft tilt sine', 'Craft upright cosine',
    'Rotation speed', 'Ground clearance', 'Pad offset X', 'Pad offset Y',
    'Vertical speed safety', 'Horizontal speed safety', 'Fuel remaining', 'Oxygen remaining',
    'Main-engine throttle', 'Turn RCS state', 'Side RCS state', 'Standing on pad',
    'Mission time', 'Constant bias',
];
const OUT_LABELS = ['turn', 'main', 'strafe'];

function actColor(v, alpha) {
    return v >= 0 ? `rgba(154,214,255,${alpha})` : `rgba(255,190,107,${alpha})`;
}

function activationGroupForMode(lead = leader()) {
    if (!lead) return [];

    const alive = S.agents
        .filter(agent => agent.alive)
        .sort((a, b) => compareLeaderCandidates(b, a));
    const ordered = [lead, ...alive.filter(agent => agent !== lead)];

    if (S.sensorMode === 'all') return ordered;
    if (S.sensorMode === 'ghosts') return ordered.slice(0, TOP_GHOSTS);
    return [lead];
}

function activationGroupDescription(group) {
    if (!group.length) return 'No active vessel';
    if (S.sensorMode === 'all') return `All visible vessels · mean activation (${group.length})`;
    if (S.sensorMode === 'ghosts') return `Top ${group.length} vessels · mean activation`;
    return S.sensorMode === 'off' ? 'Leader activation · sensor rays hidden' : 'Leader activation';
}

function activationSnapshot(agents) {
    if (!agents || !agents.length) return null;
    const count = agents.length;
    const inp = new Float32Array(N_IN);
    const h = new Float32Array(N_H1);
    const h2 = new Float32Array(N_H2);
    const out = new Float32Array(N_OUT);
    const sigIH = new Float32Array(N_IN * N_H1);
    const sigH12 = new Float32Array(N_H1 * N_H2);
    const sigH2O = new Float32Array(N_H2 * N_OUT);

    for (const agent of agents) {
        const g = agent.brain.g;
        for (let i = 0; i < N_IN; i++) {
            const source = agent.inp[i];
            inp[i] += source;
            const base = i * N_H1;
            for (let j = 0; j < N_H1; j++) sigIH[base + j] += g[OFF_WXH + base + j] * source;
        }
        for (let i = 0; i < N_H1; i++) {
            const source = agent.brain.h[i];
            h[i] += source;
            const base = i * N_H2;
            for (let j = 0; j < N_H2; j++) sigH12[base + j] += g[OFF_W12 + base + j] * source;
        }
        for (let i = 0; i < N_H2; i++) {
            const source = agent.brain.h2[i];
            h2[i] += source;
            const base = i * N_OUT;
            for (let j = 0; j < N_OUT; j++) sigH2O[base + j] += g[OFF_WHY + base + j] * source;
        }
        for (let i = 0; i < N_OUT; i++) out[i] += agent.brain.out[i];
    }

    const inv = 1 / count;
    for (const values of [inp, h, h2, out, sigIH, sigH12, sigH2O]) {
        for (let i = 0; i < values.length; i++) values[i] *= inv;
    }
    return { inp, h, h2, out, sigIH, sigH12, sigH2O, count };
}

function drawNet(agents) {
    const c = netCtx, W = netCv.width, H = netCv.height;
    c.clearRect(0, 0, W, H);
    const group = Array.isArray(agents) ? agents : agents ? [agents] : [];
    const snapshot = activationSnapshot(group);
    const title = document.getElementById('neural-activation-title');
    if (title) title.textContent = activationGroupDescription(group);
    if (!snapshot) return;

    const { inp, h, h2, out, sigIH, sigH12, sigH2O } = snapshot;
    // Reserve the left side for readable sensor names and compress the actual
    // network toward the right. This keeps all 42 inputs understandable without
    // making the activation panel wider.
    const xIn = clamp(W * 0.43, 132, 158);
    const xOut = W - 58;
    const networkSpan = Math.max(95, xOut - xIn);
    const xH1 = xIn + networkSpan * 0.42;
    const xH2 = xIn + networkSpan * 0.72;
    const yIn = i => 10 + i * ((H - 20) / (N_IN - 1));
    const yH1 = i => 12 + i * ((H - 24) / (N_H1 - 1));
    const yH2 = i => 20 + i * ((H - 40) / (N_H2 - 1));
    const yOut = i => H / 2 + (i - 1) * 54;
    c.lineWidth = 1;
    for (let i = 0; i < N_IN; i++) {
        for (let j = 0; j < N_H1; j++) {
            const sig = sigIH[i * N_H1 + j];
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
            const sig = sigH12[i * N_H2 + j];
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
            const sig = sigH2O[i * N_OUT + j];
            if (Math.abs(sig) < 0.14) continue;
            c.strokeStyle = actColor(sig, clamp(Math.abs(sig) * 0.6, 0.05, 0.58));
            c.beginPath();
            c.moveTo(xH2 + 4, yH2(i));
            c.lineTo(xOut - 4, yOut(j));
            c.stroke();
        }
    }
    c.font = '8.4px Bahnschrift, Segoe UI, sans-serif';
    c.textAlign = 'left';
    for (let i = 0; i < N_IN; i++) {
        c.fillStyle = actColor(inp[i], 0.2 + Math.abs(inp[i]) * 0.8);
        c.beginPath();
        c.arc(xIn, yIn(i), 3.4, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(166,178,198,0.92)';
        c.fillText(IN_LABELS[i], 5, yIn(i) + 2.7, Math.max(40, xIn - 14));
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

function ensureTerrainTabs() {
    const existing = [...document.querySelectorAll('.terrain-tab')];
    if (!existing.length) return;
    const container = existing[0].parentElement;
    if (!container) return;

    for (let i = 0; i < TERRAIN_DEFS.length; i++) {
        if (document.querySelector(`.terrain-tab[data-terrain="${i}"]`)) continue;
        const button = existing[existing.length - 1].cloneNode(true);
        button.dataset.terrain = String(i);
        button.classList.remove('active');
        button.textContent = TERRAIN_DEFS[i].name;
        container.appendChild(button);
    }
}

function switchTerrain(i) {
    if (!Number.isInteger(i) || i < 0 || i >= TERRAIN_DEFS.length || i === S.terrainIdx) return;
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
        brainVersion: BRAIN_VERSION,
        genomeSize: GENOME_SIZE,
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
    if (record.brainVersion !== BRAIN_VERSION || !record.genome || record.genome.length !== GENOME_SIZE) {
        flashBanner(`Champion <b>${name}</b> uses an incompatible older brain format`);
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


function loadCameraLeaderBias() {
    try {
        const raw = localStorage.getItem(CAMERA_BIAS_STORAGE_KEY);
        if (raw === null || raw === '') return CAMERA_AVERAGE_LEADER_BIAS;
        const stored = Number(raw);
        return Number.isFinite(stored) ? clamp(stored, 0, 1) : CAMERA_AVERAGE_LEADER_BIAS;
    } catch (err) {
        return CAMERA_AVERAGE_LEADER_BIAS;
    }
}

function saveCameraLeaderBias(value) {
    try {
        localStorage.setItem(CAMERA_BIAS_STORAGE_KEY, String(value));
    } catch (err) {
        // Camera control remains functional when storage is unavailable.
    }
}

function setCameraLeaderBias(value, persist = true) {
    const numeric = Number(value);
    S.cameraLeaderBias = clamp(Number.isFinite(numeric) ? numeric : CAMERA_AVERAGE_LEADER_BIAS, 0, 1);
    if (persist) saveCameraLeaderBias(S.cameraLeaderBias);
    syncCameraBiasControl();
}

function syncCameraBiasControl() {
    const slider = document.getElementById('camera-leader-bias');
    const value = document.getElementById('camera-leader-bias-value');
    const note = document.getElementById('camera-leader-bias-note');
    const percent = Math.round(S.cameraLeaderBias * 100);
    if (slider && Number(slider.value) !== percent) slider.value = String(percent);
    if (value) value.textContent = `${percent}%`;
    if (note) {
        note.textContent = S.cameraMode === 'leader'
            ? 'Leader mode already follows the best vessel at 100%.'
            : percent === 0
                ? 'Following the population average.'
                : percent === 100
                    ? 'Following the best vessel.'
                    : `Blending ${100 - percent}% population average with ${percent}% best vessel.`;
    }
}

function rightSidePanelFor(element) {
    if (!element) return null;
    let node = element;
    let fallback = null;
    while (node && node !== document.body) {
        if (node.matches?.('aside, .sidebar, .right-sidebar, .sidebar-right, .camera-panel, .panel, .card, section')) {
            fallback = node;
            const rect = node.getBoundingClientRect?.();
            if (rect && rect.width >= 150 && rect.height >= 180 && rect.left > window.innerWidth * 0.58) return node;
        }
        node = node.parentElement;
    }
    return fallback;
}

function collapseVacatedCameraSidebar(panel) {
    if (!panel || panel.id === 'neural-activation-panel') return;

    const remainingInteractive = panel.querySelector('input, select, button, canvas, textarea');
    const remainingText = (panel.textContent || '')
        .replace(/Following the best vessel\.?/gi, '')
        .replace(/Following the population average\.?/gi, '')
        .replace(/Best-vessel bias/gi, '')
        .replace(/Leader mode already follows[^.]*\.?/gi, '')
        .replace(/Camera/gi, '')
        .trim();
    if (remainingInteractive || remainingText.length > 8) return;

    const parent = panel.parentElement;
    panel.style.display = 'none';
    panel.setAttribute('aria-hidden', 'true');

    // Flex layouts collapse naturally. For a fixed three-column grid, remove
    // the now-empty final column so the simulation regains the wasted width.
    if (!parent) return;
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.display !== 'grid' && parentStyle.display !== 'inline-grid') return;

    const visibleChildren = [...parent.children].filter(child => child !== panel && getComputedStyle(child).display !== 'none');
    if (visibleChildren.length === 2 && visibleChildren[0].getBoundingClientRect().width > visibleChildren[1].getBoundingClientRect().width) {
        const sideWidth = Math.max(220, Math.round(visibleChildren[1].getBoundingClientRect().width));
        parent.style.gridTemplateColumns = `minmax(0, 1fr) ${sideWidth}px`;
    }
}

function setupCameraBiasControl(cameraModeControl) {
    S.cameraLeaderBias = loadCameraLeaderBias();

    const originalModeRow = cameraModeControl?.closest('.field-row, .control-row, .setting-row, label');
    const oldPanel = rightSidePanelFor(originalModeRow || cameraModeControl);
    const activationPanel = document.getElementById('neural-activation-panel');
    let controlsHost = document.getElementById('activation-camera-controls');
    if (!controlsHost && activationPanel) {
        controlsHost = document.createElement('div');
        controlsHost.id = 'activation-camera-controls';
        activationPanel.appendChild(controlsHost);
    }

    if (cameraModeControl && controlsHost) {
        let modeRow = document.getElementById('activation-camera-mode-row');
        if (!modeRow) {
            modeRow = document.createElement('div');
            modeRow.id = 'activation-camera-mode-row';
            modeRow.className = 'activation-camera-row';
            const label = document.createElement('label');
            label.htmlFor = cameraModeControl.id;
            label.textContent = 'Camera tracking';
            modeRow.append(label, cameraModeControl);
            controlsHost.appendChild(modeRow);
        }
        if (originalModeRow && originalModeRow !== modeRow && !originalModeRow.querySelector('input, select, button, canvas, textarea')) {
            originalModeRow.remove();
        }
    }

    let wrapper = document.getElementById('camera-leader-bias-control');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'camera-leader-bias-control';
        wrapper.className = 'camera-leader-bias-control';

        const label = document.createElement('label');
        label.htmlFor = 'camera-leader-bias';
        label.textContent = 'Best-vessel bias';
        label.title = '0% follows the population average. 100% follows the vessel with the most pad landings, then the shortest distance to its next pad, then the greatest distance covered.';

        const slider = document.createElement('input');
        slider.id = 'camera-leader-bias';
        slider.type = 'range';
        slider.min = '0';
        slider.max = '100';
        slider.step = '1';
        slider.setAttribute('aria-label', 'Camera best-vessel bias');
        slider.title = label.title;
        slider.addEventListener('input', event => setCameraLeaderBias(Number(event.target.value) / 100));

        const value = document.createElement('output');
        value.id = 'camera-leader-bias-value';
        value.htmlFor = 'camera-leader-bias';

        const note = document.createElement('small');
        note.id = 'camera-leader-bias-note';

        wrapper.append(label, slider, value, note);
    }

    if (controlsHost && wrapper.parentElement !== controlsHost) controlsHost.appendChild(wrapper);
    else if (!controlsHost && !wrapper.parentElement) document.body.appendChild(wrapper);

    requestAnimationFrame(() => {
        if (oldPanel) collapseVacatedCameraSidebar(oldPanel);
        for (const candidate of document.querySelectorAll('aside, section, .panel, .card, .sidebar, .right-sidebar')) {
            if (candidate.id === 'neural-activation-panel') continue;
            const text = (candidate.textContent || '').toLowerCase();
            const rect = candidate.getBoundingClientRect?.();
            const farRightAndEmpty = rect
                && rect.width >= 150
                && rect.left > window.innerWidth * 0.78
                && !candidate.querySelector('input, select, button, canvas, textarea')
                && text.trim().length < 40;
            if (text.includes('following the best vessel') || text.includes('best-vessel bias') || farRightAndEmpty) {
                collapseVacatedCameraSidebar(candidate);
            }
        }
    });
    syncCameraBiasControl();
}


function setupTrainingModeControl() {
    const select = $('training-mode');
    if (!select) return;
    select.innerHTML = '';
    const modes = [
        ['evolutionary', 'Evolutionary · Balanced (recommended)'],
        ['survival', 'Evolutionary · Survival'],
    ];
    for (const [value, text] of modes) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
    }
    select.value = trainingModeValue(S.trainingEvolutionMode);
}

function setupVesselViewControl() {
    const select = $('sensors');
    if (!select) return;
    const labels = new Map([
        ['leader', 'Leader only'],
        ['ghosts', 'Top 12 vessels'],
        ['all', 'All vessels'],
        ['off', 'Leader only · hide sensor rays'],
    ]);
    for (const option of select.options || []) {
        if (labels.has(option.value)) option.textContent = labels.get(option.value);
    }
    const label = document.querySelector('label[for="sensors"]');
    if (label) label.textContent = 'Vessel view';
    select.value = S.sensorMode;
}

function setupFitnessShapingDisclosure() {
    const grid = $('policy-field-grid');
    if (!grid || document.getElementById('fitness-shaping-disclosure')) return;

    const ids = [
        'policy-field-grid', 'policy-config-name', 'policy-config-list',
        'btn-save-policy', 'btn-load-policy', 'btn-delete-policy',
    ];
    const rows = [];
    for (const id of ids) {
        const el = $(id);
        if (!el) continue;
        const row = el.closest('.field-row, .control-row, .setting-row, .button-row') || el;
        if (!rows.includes(row)) rows.push(row);
    }
    const topLevelRows = rows.filter(row => !rows.some(other => other !== row && other.contains(row)));
    topLevelRows.sort((a, b) => {
        if (a === b) return 0;
        return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    if (!topLevelRows.length) return;

    const details = document.createElement('details');
    details.id = 'fitness-shaping-disclosure';
    details.style.marginTop = '10px';
    details.style.border = '1px solid rgba(147,161,184,0.16)';
    details.style.borderRadius = '10px';
    details.style.padding = '8px 10px';

    const summary = document.createElement('summary');
    summary.textContent = 'Fitness shaping · advanced';
    summary.style.cursor = 'pointer';
    summary.style.fontWeight = '600';

    const note = document.createElement('p');
    note.textContent = 'These values change evolutionary rewards and penalties. They do not directly control the neural-network outputs.';
    note.style.margin = '8px 0';
    note.style.opacity = '0.72';
    note.style.fontSize = '12px';
    note.style.lineHeight = '1.35';

    const content = document.createElement('div');
    content.className = 'fitness-shaping-content';
    const first = topLevelRows[0];
    first.parentElement.insertBefore(details, first);
    details.append(summary, note, content);
    for (const row of topLevelRows) content.appendChild(row);
}

function setupActivationPanel() {
    if (!netCv || document.getElementById('neural-activation-panel')) return;
    const originalParent = netCv.parentElement;
    const originalSection = netCv.closest('.panel, .card, section');

    const style = document.createElement('style');
    style.id = 'neural-activation-panel-style';
    style.textContent = `
        #neural-activation-panel {
            position: fixed;
            left: 16px;
            top: 132px;
            z-index: 18;
            width: min(410px, 31vw);
            padding: 10px 12px 12px;
            border: 1px solid rgba(147, 161, 184, 0.18);
            border-radius: 12px;
            background: rgba(8, 12, 20, 0.72);
            backdrop-filter: blur(8px);
            box-shadow: 0 10px 35px rgba(0, 0, 0, 0.18);
            pointer-events: none;
        }
        #neural-activation-title {
            margin: 0 0 7px;
            color: rgba(235, 242, 255, 0.92);
            font: 600 12px Bahnschrift, Segoe UI, sans-serif;
            letter-spacing: 0.01em;
        }
        #neural-activation-panel #net {
            display: block;
            width: 100%;
            height: auto;
            max-height: calc(100vh - 285px);
        }

        #activation-camera-controls {
            pointer-events: auto;
            margin-top: 9px;
            padding-top: 9px;
            border-top: 1px solid rgba(147, 161, 184, 0.16);
        }
        .activation-camera-row,
        #camera-leader-bias-control {
            display: grid;
            grid-template-columns: 112px minmax(0, 1fr) 42px;
            align-items: center;
            gap: 8px;
            color: rgba(195, 207, 225, 0.88);
            font: 500 11px Bahnschrift, Segoe UI, sans-serif;
        }
        .activation-camera-row {
            grid-template-columns: 112px minmax(0, 1fr);
            margin-bottom: 7px;
        }
        .activation-camera-row select {
            min-width: 0;
            width: 100%;
        }
        #camera-leader-bias-control input[type="range"] {
            width: 100%;
            min-width: 0;
        }
        #camera-leader-bias-value {
            text-align: right;
            font-variant-numeric: tabular-nums;
            color: rgba(235, 242, 255, 0.95);
        }
        #camera-leader-bias-note {
            grid-column: 1 / -1;
            opacity: 0.68;
            line-height: 1.25;
            margin-top: -1px;
        }
        @media (max-width: 1050px) {
            #neural-activation-panel {
                width: min(330px, 42vw);
                top: 124px;
            }
        }
        @media (max-width: 720px) {
            #neural-activation-panel {
                left: 8px;
                top: auto;
                bottom: 8px;
                width: min(300px, calc(100vw - 16px));
                opacity: 0.88;
            }
        }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('aside');
    panel.id = 'neural-activation-panel';
    panel.setAttribute('aria-label', 'Neural-network activation');
    const title = document.createElement('div');
    title.id = 'neural-activation-title';
    title.textContent = 'All visible vessels · mean activation';
    const controlsHost = document.createElement('div');
    controlsHost.id = 'activation-camera-controls';
    panel.append(title, netCv, controlsHost);
    document.body.appendChild(panel);

    // Remove a now-empty legacy card without making assumptions about the
    // rest of the page layout.
    if (originalSection && originalSection !== panel) {
        const meaningful = originalSection.querySelector('canvas, input, select, button, textarea');
        if (!meaningful) originalSection.style.display = 'none';
    } else if (originalParent && !originalParent.children.length) {
        originalParent.style.display = 'none';
    }
}

function setupUI() {
    buildPolicyEditor();
    syncPolicyEditorFromState();
    refreshPolicyConfigList();
    refreshChampionList();

    const populationInput = $('pop');
    if (populationInput) {
        const htmlPopulation = Number(populationInput.value);
        S.nextPopSize = Number.isFinite(htmlPopulation)
            ? Math.min(POP_LIMIT, Math.max(8, htmlPopulation))
            : POP_DEFAULT;
        S.popSize = S.nextPopSize;
        $('pop-label').textContent = S.nextPopSize;
    }

    const mutationInput = $('mut');
    if (mutationInput) {
        const desiredMutations = Math.round(S.mutRate * GENOME_SIZE);
        const maxMutations = Number(mutationInput.max) || desiredMutations;
        mutationInput.value = String(Math.min(desiredMutations, maxMutations));
        S.mutRate = Number(mutationInput.value) / GENOME_SIZE;
        $('mut-label').textContent = `~${mutationInput.value} weights`;
    }

    setupTrainingModeControl();
    setupVesselViewControl();
    setupFitnessShapingDisclosure();
    setupActivationPanel();
    ensureTerrainTabs();
    document.querySelectorAll('.terrain-tab').forEach(btn => btn.addEventListener('click', () => switchTerrain(+btn.dataset.terrain)));

    const cameraModeControl = $('camera-mode') || $('camera-follow');
    if (cameraModeControl) {
        cameraModeControl.value = S.cameraMode;
        cameraModeControl.addEventListener('change', e => setCameraMode(e.target.value));
    }
    setupCameraBiasControl(cameraModeControl);
    window.setMoonLanderCameraMode = setCameraMode;
    window.setMoonLanderCameraLeaderBias = setCameraLeaderBias;

    $('btn-pause').addEventListener('click', () => {
        S.paused = !S.paused;
        $('btn-pause').textContent = S.paused ? 'Resume' : 'Pause';
    });

    $('btn-reset').addEventListener('click', () => {
        resetTrainingSession(true);
        flashBanner('Training reset — physics-informed seed plus diverse random brains');
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

    $('sensors').addEventListener('change', e => {
        S.sensorMode = e.target.value;
        drawNet(activationGroupForMode());
    });

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

function smoothDampScalar(current, target, velocity, smoothTime, maxSpeed, deltaTime) {
    smoothTime = Math.max(0.0001, smoothTime);
    deltaTime = clamp(deltaTime, 1 / 240, 1 / 20);
    const omega = 2 / smoothTime;
    const x = omega * deltaTime;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

    let change = current - target;
    const originalTarget = target;
    const maxChange = maxSpeed * smoothTime;
    change = clamp(change, -maxChange, maxChange);
    target = current - change;

    const temp = (velocity + omega * change) * deltaTime;
    let nextVelocity = (velocity - omega * temp) * decay;
    let output = target + (change + temp) * decay;

    if ((originalTarget - current > 0) === (output > originalTarget)) {
        output = originalTarget;
        nextVelocity = 0;
    }
    return { value: output, velocity: nextVelocity };
}

function averageLanderKinematics() {
    const agents = S.agents;
    if (!agents.length) return null;

    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    for (const agent of agents) {
        x += agent.x;
        y += agent.y;
        vx += agent.vx;
        vy += agent.vy;
    }

    const invCount = 1 / agents.length;
    const average = {
        x: x * invCount,
        y: y * invCount,
        vx: vx * invCount,
        vy: vy * invCount,
    };

    // The default camera still includes the population average, but strongly
    // follows the strict leader: pads first, next-pad proximity second, travel third.
    // A fixed blend avoids abrupt changes while making the strongest run more
    // prominent than a pure arithmetic average would.
    const lead = leaderForState(S);
    if (!lead) return average;

    return {
        x: lerp(average.x, lead.x, S.cameraLeaderBias),
        y: lerp(average.y, lead.y, S.cameraLeaderBias),
        vx: lerp(average.vx, lead.vx, S.cameraLeaderBias),
        vy: lerp(average.vy, lead.vy, S.cameraLeaderBias),
    };
}

function cameraPredictedFocus(focus) {
    if (!focus) return null;
    return {
        x: focus.x + clamp(focus.vx * CAMERA_LOOKAHEAD_X_TIME, -CAMERA_MAX_LOOKAHEAD_X, CAMERA_MAX_LOOKAHEAD_X),
        y: focus.y + clamp(focus.vy * CAMERA_LOOKAHEAD_Y_TIME, -CAMERA_MAX_LOOKAHEAD_Y, CAMERA_MAX_LOOKAHEAD_Y),
        vx: focus.vx,
        vy: focus.vy,
    };
}

function setCameraMode(mode) {
    const normalized = mode === 'leader' ? 'leader' : 'average';
    const control = document.getElementById('camera-mode') || document.getElementById('camera-follow');
    if (control && control.value !== normalized) control.value = normalized;
    if (normalized === S.cameraMode) {
        syncCameraBiasControl();
        return;
    }
    S.cameraMode = normalized;
    S.cameraLeaderIdx = -1;
    S.cameraSwitchStart = 0;
    syncCameraBiasControl();
}

function cameraFor(agent) {
    const now = performance.now() / 1000;
    const dt = S.cameraLastTime ? clamp(now - S.cameraLastTime, 1 / 240, 1 / 20) : 1 / 60;
    S.cameraLastTime = now;

    let focus = null;
    let smoothTime = CAMERA_AVERAGE_SMOOTH_TIME;
    let horizontalAnchor = 0.5;

    if (S.cameraMode === 'leader' && agent) {
        focus = cameraPredictedFocus({ x: agent.x, y: agent.y, vx: agent.vx, vy: agent.vy });
        smoothTime = CAMERA_LEADER_SMOOTH_TIME;
        horizontalAnchor = 0.46;

        if (S.cameraLeaderIdx !== agent.idx) {
            S.cameraLeaderIdx = agent.idx;
            S.cameraSwitchStart = now;
            S.cameraSwitchFromX = S.cameraReady
                ? S.cameraX + VIEW_W * horizontalAnchor
                : focus.x;
            S.cameraSwitchFromY = S.cameraReady
                ? S.cameraY + VIEW_H * 0.52
                : focus.y;
        }

        const transition = clamp((now - S.cameraSwitchStart) / CAMERA_LEADER_SWITCH_TIME, 0, 1);
        if (transition < 1) {
            const eased = transition * transition * transition * (transition * (transition * 6 - 15) + 10);
            focus = {
                x: lerp(S.cameraSwitchFromX, focus.x, eased),
                y: lerp(S.cameraSwitchFromY, focus.y, eased),
                vx: focus.vx,
                vy: focus.vy,
            };
            // The target path is already eased. Keeping a short secondary
            // damping time avoids the previous double-smoothing lag while
            // retaining a very gentle leader hand-off.
            smoothTime = CAMERA_LEADER_SWITCH_DAMP_TIME;
        }
    } else {
        focus = cameraPredictedFocus(
            averageLanderKinematics()
            || (agent ? { x: agent.x, y: agent.y, vx: agent.vx, vy: agent.vy } : null),
        );
        S.cameraLeaderIdx = -1;
    }

    if (!focus) return { x: S.cameraX, y: S.cameraY };

    const targetX = clamp(focus.x - VIEW_W * horizontalAnchor, 0, Math.max(0, WORLD_W - VIEW_W));
    const targetY = clamp(focus.y - VIEW_H * 0.52, 0, Math.max(0, WORLD_H - VIEW_H));

    if (!S.cameraReady) {
        S.cameraX = targetX;
        S.cameraY = targetY;
        S.cameraVX = 0;
        S.cameraVY = 0;
        S.cameraReady = true;
    } else {
        // Responsiveness increases only when the camera has fallen visibly
        // behind. Small movements retain the configured soft damping, while
        // large target gaps are closed quickly without snapping.
        const cameraError = Math.hypot(targetX - S.cameraX, targetY - S.cameraY);
        const catchupRatio = clamp(cameraError / CAMERA_CATCHUP_DISTANCE, 0, 1);
        const catchupFactor = lerp(1, CAMERA_CATCHUP_MIN_FACTOR, catchupRatio);
        const responsiveSmoothTime = smoothTime * catchupFactor;

        const sx = smoothDampScalar(S.cameraX, targetX, S.cameraVX, responsiveSmoothTime, CAMERA_MAX_SPEED, dt);
        const sy = smoothDampScalar(S.cameraY, targetY, S.cameraVY, responsiveSmoothTime, CAMERA_MAX_SPEED, dt);
        S.cameraX = sx.value;
        S.cameraY = sy.value;
        S.cameraVX = sx.velocity;
        S.cameraVY = sy.velocity;
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

    if (agent.actualMain > 0) {
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

    if (agent.actualStrafe) {
        ctx.fillStyle = 'rgba(255, 184, 90, 0.15)';
        const dir = agent.actualStrafe > 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(dir * 16, -4);
        ctx.quadraticCurveTo(dir * (23 + flamePulse * 6), 0, dir * 16, 4);
        ctx.closePath();
        ctx.fill();
    }

    if (agent.actualTurn) {
        ctx.fillStyle = 'rgba(255, 184, 90, 0.13)';
        const dir = agent.actualTurn > 0 ? -1 : 1;
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
    // The physical contact points and the rendered foot centres now match.
    // Wider feet improve visual stability and make the support rod terminate
    // exactly at the middle of each landing foot.
    ctx.moveTo(-9, 9);
    ctx.lineTo(-18, 18);
    ctx.lineTo(-LANDER_HALF_W, LANDER_FEET_Y);
    ctx.moveTo(9, 9);
    ctx.lineTo(18, 18);
    ctx.lineTo(LANDER_HALF_W, LANDER_FEET_Y);
    ctx.moveTo(-LANDER_HALF_W - 8, LANDER_FEET_Y);
    ctx.lineTo(-LANDER_HALF_W + 8, LANDER_FEET_Y);
    ctx.moveTo(LANDER_HALF_W - 8, LANDER_FEET_Y);
    ctx.lineTo(LANDER_HALF_W + 8, LANDER_FEET_Y);
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

    // Keep the landing count upright and readable regardless of craft angle.
    ctx.save();
    const badgeAlpha = highlight ? 0.96 : Math.max(0.48, Math.min(0.72, alpha * 3.2));
    ctx.globalAlpha *= badgeAlpha;
    ctx.font = '600 10px Bahnschrift, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const badgeText = String(agent.landings);
    const badgeWidth = Math.max(16, ctx.measureText(badgeText).width + 9);
    const badgeY = agent.y - 49;
    ctx.fillStyle = highlight ? 'rgba(12, 20, 32, 0.90)' : 'rgba(10, 16, 26, 0.72)';
    ctx.beginPath();
    ctx.roundRect(agent.x - badgeWidth / 2, badgeY - 7, badgeWidth, 14, 5);
    ctx.fill();
    ctx.strokeStyle = highlight ? 'rgba(154, 214, 255, 0.92)' : 'rgba(170, 184, 207, 0.48)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = highlight ? '#eef7ff' : 'rgba(228, 236, 248, 0.92)';
    ctx.fillText(badgeText, agent.x, badgeY + 0.4);
    ctx.restore();
}

function drawOverlay(lead) {
    const template = S.template;
    const terrain = TERRAIN_DEFS[S.terrainIdx];
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
    ctx.fillText(`leader pads ${lead ? lead.landings : 0}/${lead ? lead.template.pads.length : 0} · next ${lead ? Math.round(distanceToNextPad(lead)) : 0}px · travel ${lead ? Math.round(lead.distanceCovered) : 0}px`, 30, 64);
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

    const visibleGroup = activationGroupForMode(lead);
    const ghosts = visibleGroup.filter(agent => agent !== lead);

    for (let i = ghosts.length - 1; i >= 0; i--) {
        drawLander(ghosts[i], S.sensorMode === 'all' ? 0.13 : 0.19, false);
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
    if (frameCount % 6 === 0) drawNet(activationGroupForMode());
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
// Start with the balanced evolutionary strategy that reliably learns
// controlled flight. The survival variant remains available as an opt-in.
S.trainingEvolutionMode = 'classic';
applyPolicyConfig(S.policyLibrary.Baseline?.config || POLICY_DEFAULTS, 'Baseline');
setupUI();
resize();
resetTrainingSession(true);
updateStats();
new ResizeObserver(resize).observe(document.getElementById('viewport'));
requestAnimationFrame(frame);

})();