'use strict';
(() => {

// ============================== constants ==============================
const WORLD_W = 1200, WORLD_H = 700;
const CELL = 4;                          // occupancy/distance grid cell size (px)
const GW = WORLD_W / CELL, GH = WORLD_H / CELL;
const DT = 1 / 60;

const RAY_ANGLES = [-90, -50, -25, 0, 25, 50, 90].map(d => d * Math.PI / 180);
const N_RAYS = RAY_ANGLES.length;
const RAY_MAX = 260;

// recurrent net inputs: rays, speed, prev steer, prev throttle, reload state,
// nearest car ahead (rel. position now + a moment ago + rel. velocity),
// nearest car behind (same), nearest incoming bullet (rel. position +
// velocity), fraction of cars still alive.
// architecture: input -> recurrent hidden layer -> hidden layer -> output
const N_IN = N_RAYS + 4 + 12 + 4 + 1, N_H1 = 20, N_H2 = 12, N_OUT = 3;
const OFF_WXH = 0;
const OFF_WHH = OFF_WXH + N_IN * N_H1;
const OFF_BH  = OFF_WHH + N_H1 * N_H1;
const OFF_W12 = OFF_BH + N_H1;
const OFF_B2  = OFF_W12 + N_H1 * N_H2;
const OFF_WHY = OFF_B2 + N_H2;
const OFF_BY  = OFF_WHY + N_H2 * N_OUT;
const GENOME_SIZE = OFF_BY + N_OUT;

const MAX_SPEED = 320;                   // px/s — sensor normalization scale only;
                                         // the real top speed is set by drag (ACCEL/DRAG)
const ACCEL = 250, BRAKE = 430, DRAG = 0.6;
const REV_ACCEL = 130;                   // weaker reverse gear
const STEER_RATE = 3.4;                  // rad/s at full lock
const CAR_L = 22, CAR_W = 11;
const CAR_SENSE_R = 360;                 // car-to-car sensing radius (px)
const BULLET_SENSE_R = 520;              // bullets are sensed farther out
const VEL_LAG = 6;                       // steps used to estimate rivals' velocity
const BLIND_SHOT_PENALTY = 30;           // fitness cost of firing with no car in sight
const KILL_REWARD = 700;                 // fitness bonus (px) per car eliminated —
                                         // sized to rise above distance variance
const SHOT_PENALTY = 400;                // heavy fitness cost for getting shot
const NEAR_R = 60;                       // near-miss shaping radius around a bullet
const NEAR_REWARD = 40, NEAR_PENALTY = 40; // graded credit for almost hitting /
                                         // almost being hit — dense signal that
                                         // makes aiming and dodging learnable
const WIGGLE_COST = 0.3;                 // fitness cost per unit of steering jerk —
                                         // twitchy driving wears the machine
const BUMP_R = 18, BUMP_COST = 0.4;      // rubbing against another car, per step
const N_EPISODES = 2;                    // runs per generation; fitness is averaged
                                         // to cut single-episode luck out of selection
const HIST = 32, HIST_LAG = 24;          // position-memory ring; lag = 0.4 s
const FIRE_CD = 2.0;                     // s between shots
const NO_GUN_GENS = 150;                 // guns stay locked this many generations
                                         // so driving skill evolves first
const BULLET_SPEED = 420, BULLET_LIFE = 1.4, BULLET_R = 13;
const GEN_TIME = 38;                     // s of sim time per generation
const STALL_TIME = 6;                    // s without forward progress -> dead
const STALL_WINDOW = 5, STALL_MIN = 60;  // minimum pace: 60 px per 5 s
const N_ELITE = 4, N_FRESH = 2;
const CHAMP_FRACTION = 0.25;             // share of each new generation that are
                                         // direct mutants of the best individual
const SPEED_STOPS = [1, 2, 4, 8, 16, 32, 100, Infinity];

const TRACK_COLORS = ['#ffb347', '#38e1ff', '#ff5fd0', '#69f0ae', '#b388ff'];

const TRACK_DEFS = [
    { name: 'Sunset Oval', width: 95, points: [
        [200,150],[600,105],[1000,150],[1105,350],[1000,550],[600,595],[200,550],[95,350]
    ]},
    { name: 'Grand Circuit', width: 75, points: [
        [160,170],[420,115],[680,200],[940,130],[1105,300],[1000,480],[780,420],
        [620,545],[380,585],[175,480],[255,330]
    ]},
    { name: 'Chicane Gauntlet', width: 62, points: [
        [150,200],[350,135],[550,248],[750,135],[1000,175],[1105,350],[1000,525],
        [750,565],[550,452],[350,565],[150,500],[95,350]
    ]},
    { name: 'Apex Alley', width: 72, points: [
        [150,160],[500,120],[900,140],[1080,240],[930,330],[1080,440],
        [920,560],[500,580],[160,540],[100,350]
    ]},
    { name: 'Titan GP', width: 70, points: [
        [120,360,95],[160,150,90],[450,105,75],[660,175,55],[880,110,72],
        [1040,130,62],[1100,145,58],[1108,215,58],[1110,420,62],
        [1102,545,58],[1040,585,60],[700,592,88],[450,535,68],
        [240,582,82],[130,495,92]
    ]},
];

// ============================== utils ==============================
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);

let gaussSpare = null;
function gauss() {
    if (gaussSpare !== null) { const v = gaussSpare; gaussSpare = null; return v; }
    let u, v, s;
    do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    gaussSpare = v * m;
    return u * m;
}

// ============================== track ==============================
// offset the centerline sideways by each point's half-width. Where a bend is
// tighter than the offset, naive offset points land *inside* the road (that's
// what produced wall spikes at apexes) — the true road edge is the set of
// offset points at least the local half-width away from the whole centerline,
// so drop any point closer than that to a nearby centerline sample.
function offsetWall(center, sign, scale = 1) {
    const m = center.length;
    const out = [];
    for (let i = 0; i < m; i++) {
        const p = center[i];
        const x = p.x + p.nx * p.hw * scale * sign;
        const y = p.y + p.ny * p.hw * scale * sign;
        let inside = false;
        for (let k = i - 64; k <= i + 64; k++) {
            const q = center[(k % m + m) % m];
            if (q === p) continue;
            const lim = q.hw * scale * 0.985;
            const dx = q.x - x, dy = q.y - y;
            if (dx * dx + dy * dy < lim * lim) { inside = true; break; }
        }
        if (!inside) out.push({ x, y });
    }
    // very sharp corners can leave stray offset points in the empty wedge
    // beyond the apex — they survive the distance test but fold the polyline
    // back on itself, so iteratively delete reversal vertices
    let pts = out;
    for (let pass = 0; pass < 8; pass++) {
        const n = pts.length;
        if (n < 16) break;
        const keep = [];
        for (let i = 0; i < n; i++) {
            const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
            const l1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const l2 = Math.hypot(c.x - b.x, c.y - b.y) || 1;
            const turn = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (l1 * l2);
            if (turn > 0.05) keep.push(b);
        }
        if (keep.length === n || keep.length < 16) break;
        pts = keep;
    }
    return pts;
}

function buildTrack(def) {
    const pts = def.points, n = pts.length, SAMPLES = 26;
    const center = [];
    // closed Catmull-Rom spline through control points; optional third
    // element of a point is the local track width
    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        const w0 = p0[2] || def.width, w1 = p1[2] || def.width;
        const w2 = p2[2] || def.width, w3 = p3[2] || def.width;
        for (let j = 0; j < SAMPLES; j++) {
            const t = j / SAMPLES, t2 = t * t, t3 = t2 * t;
            center.push({
                x: 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                y: 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
                hw: 0.25 * (2 * w1 + (-w0 + w2) * t + (2 * w0 - 5 * w1 + 4 * w2 - w3) * t2 + (-w0 + 3 * w1 - 3 * w2 + w3) * t3),
            });
        }
    }
    const m = center.length;
    // tangents, normals, cumulative arc length
    let arc = 0;
    for (let i = 0; i < m; i++) {
        const a = center[i], b = center[(i + 1) % m], p = center[(i - 1 + m) % m];
        let tx = b.x - p.x, ty = b.y - p.y;
        const len = Math.hypot(tx, ty) || 1;
        a.tx = tx / len; a.ty = ty / len;
        a.nx = -a.ty; a.ny = a.tx;
        a.arc = arc;
        arc += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const totalLen = arc;
    const left = offsetWall(center, 1);
    const right = offsetWall(center, -1);

    // occupancy grid: rasterize the ring between the two walls
    const oc = document.createElement('canvas');
    oc.width = GW; oc.height = GH;
    const octx = oc.getContext('2d', { willReadFrequently: true });
    octx.scale(1 / CELL, 1 / CELL);
    const path = new Path2D();
    for (const loop of [left, right]) {
        path.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) path.lineTo(loop[i].x, loop[i].y);
        path.closePath();
    }
    octx.fillStyle = '#fff';
    octx.fill(path, 'evenodd');
    const img = octx.getImageData(0, 0, GW, GH).data;
    const occ = new Uint8Array(GW * GH);
    for (let i = 0; i < occ.length; i++) occ[i] = img[i * 4 + 3] > 127 ? 1 : 0;

    // chamfer distance transform (3-4 metric): distance to nearest off-track cell
    const INF = 1e7;
    const cd = new Float32Array(GW * GH);
    for (let i = 0; i < cd.length; i++) cd[i] = occ[i] ? INF : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= GW || y >= GH) ? 0 : cd[y * GW + x];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        if (cd[i] === 0) continue;
        cd[i] = Math.min(cd[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
    for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
        const i = y * GW + x;
        if (cd[i] === 0) continue;
        cd[i] = Math.min(cd[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
    // convert to safe px distance (subtract a cell of slack for in-cell position error)
    const df = new Float32Array(GW * GH);
    for (let i = 0; i < df.length; i++) df[i] = Math.max(0, cd[i] / 3 - 1) * CELL;

    return { def, center, totalLen, left, right, occ, df };
}

function onTrack(track, x, y) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return false;
    return track.occ[(y / CELL | 0) * GW + (x / CELL | 0)] === 1;
}

// sphere-traced raycast against the distance field
function raycast(track, x, y, dx, dy) {
    let t = 0;
    while (t < RAY_MAX) {
        const px = x + dx * t, py = y + dy * t;
        if (px < 0 || py < 0 || px >= WORLD_W || py >= WORLD_H) return t;
        const gi = (py / CELL | 0) * GW + (px / CELL | 0);
        if (!track.occ[gi]) return t;
        t += Math.max(2.5, track.df[gi] * 0.9);
    }
    return RAY_MAX;
}

// ============================== brain ==============================
function randomGenome() {
    const g = new Float32Array(GENOME_SIZE);
    for (let i = 0; i < GENOME_SIZE; i++) {
        // recurrent weights start small for stability
        const scale = (i >= OFF_WHH && i < OFF_BH) ? 0.25 : 0.6;
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
    reset() { this.h.fill(0); this.h2.fill(0); this.out.fill(0); }
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

// ============================== car ==============================
class Car {
    constructor(genome, idx) {
        this.brain = new Brain(genome);
        this.idx = idx;
        this.rays = new Float32Array(N_RAYS);
        this.inp = new Float32Array(N_IN);
        // short ring buffer of past positions, read by OTHER cars' sensors so
        // they can see where this car was a moment ago
        this.histX = new Float32Array(HIST);
        this.histY = new Float32Array(HIST);
    }
    spawn(track, total = 1) {
        // distribute the field evenly around the track so training isn't
        // dominated by a crowded start grid; jitter keeps cars off the
        // center line and out of lockstep
        const c = track.center, m = c.length;
        const i0 = Math.floor((this.idx / total) * m) % m;
        const p0 = c[i0];
        const lat = (Math.random() * 2 - 1) * Math.max(0, p0.hw - CAR_W * 1.3);
        this.x = p0.x + p0.nx * lat;
        this.y = p0.y + p0.ny * lat;
        this.heading = Math.atan2(p0.ty, p0.tx) + (Math.random() - 0.5) * 0.3;
        this.speed = 0;
        this.alive = true;
        this.ci = i0;
        this.progress = 0;
        this.bestProgress = 0;
        this.stall = 0;
        this.steer = 0;
        this.throttle = 0;
        // randomized initial reload so the field doesn't open fire in unison
        this.cooldown = rand(0.5, FIRE_CD + 0.5);
        this.kills = 0;
        this.shot = false;       // killed by a bullet (vs. crashed)
        this.penalty = 0;        // accumulated fitness costs (shots, bumps, wiggle…)
        this.bonus = 0;          // accumulated fitness rewards (near misses)
        this.histX.fill(this.x);
        this.histY.fill(this.y);
        this.histIdx = 0;
        this.paceTimer = 0;
        this.paceMark = 0;
        this.brain.reset();
        this.rays.fill(RAY_MAX);
    }
    get fitness() { return this.bestProgress + this.kills * KILL_REWARD + this.bonus - this.penalty; }
    // another car as seen from this one: relative position now, relative
    // position HIST_LAG steps ago, and relative velocity — all in this car's
    // reference frame, written into inp[at..at+5]
    senseCar(other, cos, sin, at) {
        const inp = this.inp;
        if (!other) {
            for (let k = 0; k < 6; k++) inp[at + k] = 0;
            return;
        }
        const dx = other.x - this.x, dy = other.y - this.y;
        const j = (other.histIdx - HIST_LAG + HIST) % HIST;
        const px = other.histX[j] - this.x, py = other.histY[j] - this.y;
        const j2 = (other.histIdx - VEL_LAG + HIST) % HIST;
        const vx = (other.x - other.histX[j2]) / (VEL_LAG * DT);
        const vy = (other.y - other.histY[j2]) / (VEL_LAG * DT);
        inp[at]     = clamp((dx * cos + dy * sin) / CAR_SENSE_R, -1, 1);
        inp[at + 1] = clamp((-dx * sin + dy * cos) / CAR_SENSE_R, -1, 1);
        inp[at + 2] = clamp((px * cos + py * sin) / CAR_SENSE_R, -1, 1);
        inp[at + 3] = clamp((-px * sin + py * cos) / CAR_SENSE_R, -1, 1);
        inp[at + 4] = clamp((vx * cos + vy * sin) / MAX_SPEED, -1, 1);
        inp[at + 5] = clamp((-vx * sin + vy * cos) / MAX_SPEED, -1, 1);
    }
    step(track, cars) {
        const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
        // sense walls
        const inp = this.inp;
        for (let r = 0; r < N_RAYS; r++) {
            const a = this.heading + RAY_ANGLES[r];
            const d = raycast(track, this.x, this.y, Math.cos(a), Math.sin(a));
            this.rays[r] = d;
            inp[r] = d / RAY_MAX;
        }
        inp[N_RAYS] = this.speed / MAX_SPEED;
        inp[N_RAYS + 1] = this.steer;
        inp[N_RAYS + 2] = this.throttle;
        // reload progress: 0 right after firing, rising to 1 when ready —
        // lets a brain time aggression (or caution) around its own gun.
        // stays 0 while guns are locked early in training
        const gunsLive = S.gen > NO_GUN_GENS;
        inp[N_RAYS + 3] = gunsLive ? 1 - clamp(this.cooldown / FIRE_CD, 0, 1) : 0;
        // sense other cars: nearest ahead of and nearest behind this car
        // (counting survivors along the way)
        let ahead = null, aD = Infinity, behind = null, bD = Infinity, others = 0;
        let bumped = false;
        for (const o of cars) {
            if (o === this || !o.alive) continue;
            others++;
            const dx = o.x - this.x, dy = o.y - this.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < BUMP_R * BUMP_R) bumped = true;
            if (d2 > CAR_SENSE_R * CAR_SENSE_R) continue;
            if (dx * cos + dy * sin >= 0) {
                if (d2 < aD) { aD = d2; ahead = o; }
            } else if (d2 < bD) { bD = d2; behind = o; }
        }
        if (bumped) this.penalty += BUMP_COST;
        this.senseCar(ahead, cos, sin, N_RAYS + 4);
        this.senseCar(behind, cos, sin, N_RAYS + 10);
        // sense the nearest hostile bullet: position and velocity in this
        // car's frame, so evasion is learnable
        let bul = null, bulD = BULLET_SENSE_R * BULLET_SENSE_R;
        for (const b of S.bullets) {
            if (b.owner === this) continue;
            const dx = b.x - this.x, dy = b.y - this.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bulD) { bulD = d2; bul = b; }
        }
        const bi = N_RAYS + 16;
        if (bul) {
            const dx = bul.x - this.x, dy = bul.y - this.y;
            const vn = BULLET_SPEED + MAX_SPEED;
            inp[bi]     = clamp((dx * cos + dy * sin) / BULLET_SENSE_R, -1, 1);
            inp[bi + 1] = clamp((-dx * sin + dy * cos) / BULLET_SENSE_R, -1, 1);
            inp[bi + 2] = clamp((bul.dx * cos + bul.dy * sin) / vn, -1, 1);
            inp[bi + 3] = clamp((-bul.dx * sin + bul.dy * cos) / vn, -1, 1);
        } else {
            inp[bi] = inp[bi + 1] = inp[bi + 2] = inp[bi + 3] = 0;
        }
        // global cue: how many cars remain in the round
        inp[N_RAYS + 20] = (others + 1) / cars.length;
        // think
        const out = this.brain.step(inp);
        // smooth motion pays: jerky steering accrues a small fitness penalty
        this.penalty += Math.abs(out[0] - this.steer) * WIGGLE_COST;
        this.steer = out[0];
        this.throttle = out[1];
        // drive: no artificial speed cap — drag is the only limit; negative
        // throttle brakes while rolling and becomes reverse once stopped
        const accel = this.throttle >= 0
            ? this.throttle * ACCEL
            : this.throttle * (this.speed > 1 ? BRAKE : REV_ACCEL);
        this.speed += accel * DT;
        this.speed -= DRAG * this.speed * DT;
        // steering scales with speed and flips when backing up, like a real car
        this.heading += this.steer * STEER_RATE * (this.speed / (Math.abs(this.speed) + 60)) * DT;
        this.x += Math.cos(this.heading) * this.speed * DT;
        this.y += Math.sin(this.heading) * this.speed * DT;
        // crash check on footprint corners + nose
        const hl = CAR_L / 2, hw = CAR_W / 2;
        const c2 = Math.cos(this.heading), s2 = Math.sin(this.heading);
        if (!onTrack(track, this.x + c2 * hl, this.y + s2 * hl) ||
            !onTrack(track, this.x + c2 * hl - s2 * hw, this.y + s2 * hl + c2 * hw) ||
            !onTrack(track, this.x + c2 * hl + s2 * hw, this.y + s2 * hl - c2 * hw) ||
            !onTrack(track, this.x - c2 * hl - s2 * hw, this.y - s2 * hl + c2 * hw) ||
            !onTrack(track, this.x - c2 * hl + s2 * hw, this.y - s2 * hl - c2 * hw)) {
            this.alive = false;
            return;
        }
        // fire: third output pulls the trigger when the gun is ready; the
        // recoil costs a little speed, so shooting is never free
        this.cooldown -= DT;
        if (gunsLive && out[2] > 0.5 && this.cooldown <= 0) {
            this.cooldown = FIRE_CD;
            this.speed -= 12;    // recoil pushes backward, whatever the gear
            if (!ahead && !behind) this.penalty += BLIND_SHOT_PENALTY;
            S.shots++;
            S.bullets.push({
                x: this.x + c2 * (hl + 5), y: this.y + s2 * (hl + 5),
                dx: c2 * (BULLET_SPEED + this.speed), dy: s2 * (BULLET_SPEED + this.speed),
                life: BULLET_LIFE, owner: this,
                minD2: Infinity, minCar: null,   // closest approach, for near-miss credit
            });
        }
        // record position history for other cars' temporal sensing
        this.histX[this.histIdx] = this.x;
        this.histY[this.histIdx] = this.y;
        this.histIdx = (this.histIdx + 1) % HIST;
        // progress along centerline (local nearest-point search around last index)
        const c = track.center, m = c.length;
        let best = this.ci, bestD = Infinity;
        for (let k = -4; k <= 10; k++) {
            const i = (this.ci + k + m) % m;
            const dx = c[i].x - this.x, dy = c[i].y - this.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
        }
        let dArc = c[best].arc - c[this.ci].arc;
        if (dArc > track.totalLen / 2) dArc -= track.totalLen;
        if (dArc < -track.totalLen / 2) dArc += track.totalLen;
        this.ci = best;
        this.progress += dArc;
        if (this.progress > this.bestProgress + 4) {
            this.bestProgress = this.progress;
            this.stall = 0;
        } else {
            this.stall += DT;
            if (this.stall > STALL_TIME) this.alive = false;
        }
        // pace rule: cars that barely move get eliminated quickly instead of
        // idling out the rest of the round
        this.paceTimer += DT;
        if (this.paceTimer >= STALL_WINDOW) {
            if (this.progress - this.paceMark < STALL_MIN) { this.alive = false; return; }
            this.paceTimer = 0;
            this.paceMark = this.progress;
        }
    }
}

// ============================== simulation state ==============================
const S = {
    trackIdx: 0,
    track: null,
    tracks: [null, null, null],
    cars: [],
    gen: 1,
    simTime: 0,
    paused: false,
    evalMode: false,
    popSize: 60,
    nextPopSize: 60,
    mutRate: 6 / GENOME_SIZE,   // per-weight probability; ≈6 weights per child
    speedStop: 2,
    sensorMode: 'leader',
    record: 0,
    history: [],        // { bestLaps, meanLaps, trackIdx, shot, bad }
    stepsThisSecond: 0,
    simRate: 0,
    bullets: [],
    kills: 0,           // this generation
    shots: 0,           // this generation
    episode: 0,         // run index within the current generation
    genBest: 0,         // accumulators across the generation's runs
    genMean: 0,
    genShotN: 0,
    genBadN: 0,
};

function getTrack(i) {
    if (!S.tracks[i]) S.tracks[i] = buildTrack(TRACK_DEFS[i]);
    return S.tracks[i];
}

function spawnPopulation(genomes) {
    S.cars = genomes.map((g, i) => new Car(g, i));
    for (const car of S.cars) car.spawn(S.track, S.cars.length);
    S.simTime = 0;
    S.bullets.length = 0;
    S.kills = 0;
    S.shots = 0;
    S.episode = 0;
    S.genBest = 0;
    S.genMean = 0;
    S.genShotN = 0;
    S.genBadN = 0;
}

function freshPopulation() {
    const genomes = [];
    for (let i = 0; i < S.popSize; i++) genomes.push(randomGenome());
    spawnPopulation(genomes);
}

// ============================== evolution ==============================
function mutate(g, scale = 1) {
    const c = new Float32Array(g);
    for (let i = 0; i < GENOME_SIZE; i++) {
        if (Math.random() < S.mutRate) c[i] += gauss() * 0.3 * scale;
    }
    return c;
}

function crossover(a, b) {
    const c = new Float32Array(GENOME_SIZE);
    for (let i = 0; i < GENOME_SIZE; i++) c[i] = Math.random() < 0.5 ? a[i] : b[i];
    return c;
}

function tournament(sorted) {
    let best = sorted[(Math.random() * sorted.length) | 0];
    for (let k = 0; k < 2; k++) {
        const c = sorted[(Math.random() * sorted.length) | 0];
        if (c.fitSum > best.fitSum) best = c;
    }
    return best;
}

function endGeneration() {
    // fold this run into the generation's totals
    let epBest = 0, epMean = 0, shotN = 0, badN = 0;
    for (const c of S.cars) {
        c.fitSum = (c.fitSum || 0) + c.fitness;
        if (c.bestProgress > epBest) epBest = c.bestProgress;
        epMean += c.bestProgress;
        if (!c.alive) c.shot ? shotN++ : badN++;
    }
    S.genBest = Math.max(S.genBest, epBest);
    S.genMean += epMean / S.cars.length;
    S.genShotN += shotN;
    S.genBadN += badN;
    S.episode++;
    // each generation is scored over several runs from different grid slots,
    // so selection sees skill rather than single-episode luck
    if (!S.evalMode && S.episode < N_EPISODES) {
        for (const car of S.cars) car.spawn(S.track, S.cars.length);
        S.simTime = 0;
        S.bullets.length = 0;
        flashBanner(`Generation <b>${S.gen}</b> — run ${S.episode + 1}/${N_EPISODES}`);
        return;
    }
    const best = S.genBest;
    const mean = S.genMean / S.episode;
    S.history.push({
        bestLaps: best / S.track.totalLen,
        meanLaps: mean / S.track.totalLen,
        trackIdx: S.trackIdx,
        shot: S.genShotN,
        bad: S.genBadN,
    });
    if (S.history.length > 400) S.history.shift();
    if (best > S.record) S.record = best;
    drawChart();
    drawElim();

    const sorted = [...S.cars].sort((a, b) => b.fitSum - a.fitSum);
    let genomes;
    if (S.evalMode) {
        genomes = S.cars.map(c => c.brain.g);
    } else {
        S.popSize = S.nextPopSize;
        genomes = [];
        const champ = sorted[0].brain.g;
        // exactly one verbatim copy of the best individual survives; every
        // other carry-over gets at least slight variation
        genomes.push(new Float32Array(champ));
        for (let i = 1; i < Math.min(N_ELITE, sorted.length); i++) {
            genomes.push(mutate(sorted[i].brain.g, 0.35));
        }
        // a block of close variants of the champion: half fine-grained
        // mutations (local refinement), half full-strength (exploration)
        const nChamp = Math.floor(S.popSize * CHAMP_FRACTION);
        for (let i = 0; i < nChamp && genomes.length < S.popSize - N_FRESH; i++) {
            genomes.push(mutate(champ, i % 2 ? 1 : 0.5));
        }
        while (genomes.length < S.popSize - N_FRESH) {
            const a = tournament(sorted), b = tournament(sorted);
            genomes.push(mutate(Math.random() < 0.75 ? crossover(a.brain.g, b.brain.g) : new Float32Array(a.brain.g)));
        }
        while (genomes.length < S.popSize) genomes.push(randomGenome());
        S.gen++;
    }
    const kills = S.kills;
    spawnPopulation(genomes);
    if (S.gen === NO_GUN_GENS + 1) {
        flashBanner(`Generation <b>${S.gen}</b> — <b>guns are live!</b>`);
    } else if (S.gen > NO_GUN_GENS) {
        flashBanner(`Generation <b>${S.gen}</b> — best ${(best / 10).toFixed(0)} m · ${kills} kill${kills === 1 ? '' : 's'}`);
    } else {
        flashBanner(`Generation <b>${S.gen}</b> — best ${(best / 10).toFixed(0)} m · guns unlock at ${NO_GUN_GENS + 1}`);
    }
}

// ============================== sim step ==============================
function stepSim() {
    for (const car of S.cars) {
        if (car.alive) car.step(S.track, S.cars);
    }
    // bullets: fly straight, die on walls or expiry, eliminate cars they hit
    for (let i = S.bullets.length - 1; i >= 0; i--) {
        const b = S.bullets[i];
        b.life -= DT;
        b.x += b.dx * DT;
        b.y += b.dy * DT;
        let gone = b.life <= 0 || !onTrack(S.track, b.x, b.y);
        let hit = false;
        if (!gone) {
            for (const c of S.cars) {
                if (!c.alive || c === b.owner) continue;
                const dx = c.x - b.x, dy = c.y - b.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < b.minD2) { b.minD2 = d2; b.minCar = c; }
                if (d2 < BULLET_R * BULLET_R) {
                    c.alive = false;
                    c.shot = true;
                    c.penalty += SHOT_PENALTY;
                    b.owner.kills++;
                    S.kills++;
                    gone = hit = true;
                    break;
                }
            }
        }
        if (gone) {
            // near-miss shaping: a bullet that grazed someone earns its owner
            // graded credit and rattles the car it nearly hit — a dense signal
            // that makes marksmanship and evasion evolvable
            if (!hit && b.minCar && b.minD2 < NEAR_R * NEAR_R) {
                const cl = clamp(1 - (Math.sqrt(b.minD2) - BULLET_R) / (NEAR_R - BULLET_R), 0, 1);
                b.owner.bonus += NEAR_REWARD * cl;
                b.minCar.penalty += NEAR_PENALTY * cl;
            }
            S.bullets.splice(i, 1);
        }
    }
    let alive = 0;
    for (const car of S.cars) if (car.alive) alive++;
    S.simTime += DT;
    S.stepsThisSecond++;
    if (alive === 0 || S.simTime >= GEN_TIME) endGeneration();
}

function leader() {
    let best = null;
    for (const car of S.cars) {
        if (car.alive && (!best || car.bestProgress > best.bestProgress)) best = car;
    }
    return best || S.cars[0];
}

// ============================== rendering ==============================
const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
let view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
let trackLayer = null;

function resize() {
    const vp = document.getElementById('viewport');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = vp.clientWidth, h = vp.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const s = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H);
    view = { s, ox: (canvas.width - WORLD_W * s) / 2, oy: (canvas.height - WORLD_H * s) / 2, w: canvas.width, h: canvas.height, dpr };
    renderTrackLayer();
}

function strokePoly(c, loop, close = true) {
    c.beginPath();
    c.moveTo(loop[0].x, loop[0].y);
    for (let i = 1; i < loop.length; i++) c.lineTo(loop[i].x, loop[i].y);
    if (close) c.closePath();
    c.stroke();
}

function renderTrackLayer() {
    if (!S.track || !view.w) return;
    if (!trackLayer) trackLayer = document.createElement('canvas');
    trackLayer.width = view.w; trackLayer.height = view.h;
    const c = trackLayer.getContext('2d');
    c.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
    const t = S.track;
    const accent = TRACK_COLORS[S.trackIdx];

    // asphalt ring
    const ring = new Path2D();
    for (const loop of [t.left, t.right]) {
        ring.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) ring.lineTo(loop[i].x, loop[i].y);
        ring.closePath();
    }
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 26;
    c.fillStyle = '#1b2030';
    c.fill(ring, 'evenodd');
    c.restore();
    // subtle lane sheen down the middle, following the local road width
    const sheen = new Path2D();
    for (const loop of [offsetWall(t.center, 1, 0.55), offsetWall(t.center, -1, 0.55)]) {
        sheen.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) sheen.lineTo(loop[i].x, loop[i].y);
        sheen.closePath();
    }
    c.fillStyle = 'rgba(255,255,255,0.045)';
    c.fill(sheen, 'evenodd');
    c.lineJoin = 'round';
    // centerline dashes
    c.strokeStyle = 'rgba(255,255,255,0.13)';
    c.lineWidth = 2;
    c.setLineDash([14, 18]);
    strokePoly(c, t.center);
    c.setLineDash([]);
    // glowing wall edges
    c.save();
    c.shadowColor = accent;
    c.shadowBlur = 9;
    c.strokeStyle = accent + 'cc';
    c.lineWidth = 2.5;
    strokePoly(c, t.left);
    strokePoly(c, t.right);
    c.restore();
    // start / finish checker band
    const p0 = t.center[0], hw = p0.hw;
    const sq = 7, cols = 2, rows = Math.ceil((hw * 2) / sq);
    c.save();
    c.translate(p0.x, p0.y);
    c.rotate(Math.atan2(p0.ny, p0.nx));
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            c.fillStyle = (i + j) % 2 ? '#e8ecf6' : '#11141f';
            c.fillRect(-hw + i * sq, -sq + j * sq, sq, sq);
        }
    }
    c.restore();
}

function drawCar(car, isLeader) {
    const c = ctx;
    c.save();
    c.translate(car.x, car.y);
    c.rotate(car.heading);
    if (!car.alive) {
        c.globalAlpha = car.shot ? 0.22 : 0.13;
        c.fillStyle = car.shot ? '#ff5e5e' : '#9aa3bd';
        c.fillRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W);
        c.restore();
        return;
    }
    if (isLeader) {
        c.shadowColor = '#ffd35c';
        c.shadowBlur = 14;
    }
    c.globalAlpha = isLeader ? 1 : 0.82;
    // body
    c.fillStyle = isLeader ? '#ffd35c' : TRACK_COLORS[S.trackIdx];
    c.beginPath();
    c.roundRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 3.5);
    c.fill();
    c.shadowBlur = 0;
    // cabin
    c.fillStyle = 'rgba(10,13,20,0.75)';
    c.beginPath();
    c.roundRect(-CAR_L * 0.12, -CAR_W * 0.32, CAR_L * 0.36, CAR_W * 0.64, 2);
    c.fill();
    // brake light
    if (car.throttle < -0.15) {
        c.fillStyle = '#ff3b30';
        c.fillRect(-CAR_L / 2 - 1.5, -CAR_W * 0.35, 2, CAR_W * 0.7);
    }
    c.restore();
}

function drawSensors(car) {
    const c = ctx;
    c.save();
    c.lineWidth = 1;
    for (let r = 0; r < N_RAYS; r++) {
        const a = car.heading + RAY_ANGLES[r];
        const d = car.rays[r];
        const near = 1 - d / RAY_MAX;
        c.strokeStyle = `rgba(${56 + near * 199 | 0}, ${225 - near * 141 | 0}, ${255 - near * 143 | 0}, 0.5)`;
        c.beginPath();
        c.moveTo(car.x, car.y);
        c.lineTo(car.x + Math.cos(a) * d, car.y + Math.sin(a) * d);
        c.stroke();
        if (d < RAY_MAX) {
            c.fillStyle = 'rgba(255,120,120,0.8)';
            c.beginPath();
            c.arc(car.x + Math.cos(a) * d, car.y + Math.sin(a) * d, 2, 0, 7);
            c.fill();
        }
    }
    c.restore();
}

function render() {
    if (!view.w) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    if (trackLayer) ctx.drawImage(trackLayer, 0, 0);
    ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
    const lead = leader();
    // dead first (under the living)
    for (const car of S.cars) if (!car.alive) drawCar(car, false);
    if (S.sensorMode === 'all') {
        for (const car of S.cars) if (car.alive) drawSensors(car);
    } else if (S.sensorMode === 'leader' && lead && lead.alive) {
        drawSensors(lead);
    }
    for (const car of S.cars) if (car.alive && car !== lead) drawCar(car, false);
    if (lead && lead.alive) drawCar(lead, true);
    // bullet tracers
    if (S.bullets.length) {
        ctx.save();
        ctx.strokeStyle = '#ff5e5e';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#ff5e5e';
        ctx.shadowBlur = 6;
        for (const b of S.bullets) {
            ctx.beginPath();
            ctx.moveTo(b.x - b.dx * 0.03, b.y - b.dy * 0.03);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        ctx.restore();
    }
}

// ============================== chart ==============================
const chartCv = document.getElementById('chart');
const chartCtx = chartCv.getContext('2d');

function drawChart() {
    const c = chartCtx, W = chartCv.width, H = chartCv.height;
    c.clearRect(0, 0, W, H);
    const h = S.history;
    if (h.length < 1) return;
    let max = 0.5;
    for (const e of h) if (e.bestLaps > max) max = e.bestLaps;
    const n = h.length;
    const px = i => n === 1 ? W : (i / (n - 1)) * (W - 4) + 2;
    const py = v => H - 4 - (v / max) * (H - 12);
    // tinted background bands per track
    let runStart = 0;
    for (let i = 1; i <= n; i++) {
        if (i === n || h[i].trackIdx !== h[runStart].trackIdx) {
            c.fillStyle = TRACK_COLORS[h[runStart].trackIdx] + '14';
            const x0 = runStart === 0 ? 0 : px(runStart);
            const x1 = i === n ? W : px(i);
            c.fillRect(x0, 0, x1 - x0, H);
            runStart = i;
        }
    }
    // mean line
    c.strokeStyle = 'rgba(138,147,173,0.55)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].meanLaps)) : c.moveTo(px(i), py(h[i].meanLaps));
    c.stroke();
    // best line
    c.strokeStyle = '#38e1ff';
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].bestLaps)) : c.moveTo(px(i), py(h[i].bestLaps));
    c.stroke();
    // max label — laps, so progress is comparable across tracks
    c.fillStyle = 'rgba(138,147,173,0.9)';
    c.font = '10px sans-serif';
    c.fillText(`${max.toFixed(1)} laps`, 4, 11);
}

// ============================== eliminations chart ==============================
const elimCv = document.getElementById('elim');
const elimCtx = elimCv.getContext('2d');

function drawElim() {
    const c = elimCtx, W = elimCv.width, H = elimCv.height;
    c.clearRect(0, 0, W, H);
    const h = S.history;
    if (!h.length) return;
    let max = 1;
    for (const e of h) max = Math.max(max, e.shot || 0, e.bad || 0);
    const n = h.length;
    const px = i => n === 1 ? W : (i / (n - 1)) * (W - 4) + 2;
    const py = v => H - 4 - (v / max) * (H - 18);
    c.lineWidth = 1.4;
    c.strokeStyle = 'rgba(138,147,173,0.85)';
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].bad || 0)) : c.moveTo(px(i), py(h[i].bad || 0));
    c.stroke();
    c.strokeStyle = '#ff5e5e';
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].shot || 0)) : c.moveTo(px(i), py(h[i].shot || 0));
    c.stroke();
    c.font = '9px sans-serif';
    c.fillStyle = '#ff5e5e';
    c.fillText('shot', W - 62, 10);
    c.fillStyle = 'rgba(138,147,173,0.9)';
    c.fillText('bad driving', W - 38, 10);
    c.fillText(max, 4, 10);
}

// ============================== network viz ==============================
const netCv = document.getElementById('net');
const netCtx = netCv.getContext('2d');
const IN_LABELS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'spd', 'str', 'thr', 'rdy',
    'Ax', 'Ay', 'Ax-', 'Ay-', 'Avx', 'Avy', 'Bx', 'By', 'Bx-', 'By-', 'Bvx', 'Bvy',
    'px', 'py', 'pvx', 'pvy', 'left'];
const OUT_LABELS = ['steer', 'gas/brk', 'fire'];

function actColor(v, alpha) {
    // negative -> magenta, positive -> cyan
    return v >= 0 ? `rgba(56,225,255,${alpha})` : `rgba(255,95,208,${alpha})`;
}

function drawNet(car) {
    const c = netCtx, W = netCv.width, H = netCv.height;
    c.clearRect(0, 0, W, H);
    if (!car) return;
    const g = car.brain.g, h = car.brain.h, h2 = car.brain.h2, inp = car.inp, out = car.brain.out;
    const xIn = 26, xH1 = W * 0.43, xH2 = W * 0.66, xOut = W - 44;
    const yIn = i => 12 + i * ((H - 24) / (N_IN - 1));
    const yH1 = i => 12 + i * ((H - 24) / (N_H1 - 1));
    const yH2 = i => 26 + i * ((H - 52) / (N_H2 - 1));
    const yOut = i => H / 2 + (i - 1) * 48;
    // connections (skip weak ones to keep it readable & cheap)
    c.lineWidth = 1;
    for (let i = 0; i < N_IN; i++) {
        for (let j = 0; j < N_H1; j++) {
            const sig = g[OFF_WXH + i * N_H1 + j] * inp[i];
            if (Math.abs(sig) < 0.18) continue;
            c.strokeStyle = actColor(sig, clamp(Math.abs(sig) * 0.55, 0.05, 0.5));
            c.beginPath(); c.moveTo(xIn + 4, yIn(i)); c.lineTo(xH1 - 4, yH1(j)); c.stroke();
        }
    }
    for (let j = 0; j < N_H1; j++) {
        for (let k = 0; k < N_H2; k++) {
            const sig = g[OFF_W12 + j * N_H2 + k] * h[j];
            if (Math.abs(sig) < 0.2) continue;
            c.strokeStyle = actColor(sig, clamp(Math.abs(sig) * 0.55, 0.05, 0.5));
            c.beginPath(); c.moveTo(xH1 + 4, yH1(j)); c.lineTo(xH2 - 4, yH2(k)); c.stroke();
        }
    }
    for (let j = 0; j < N_H2; j++) {
        for (let k = 0; k < N_OUT; k++) {
            const sig = g[OFF_WHY + j * N_OUT + k] * h2[j];
            if (Math.abs(sig) < 0.15) continue;
            c.strokeStyle = actColor(sig, clamp(Math.abs(sig) * 0.6, 0.05, 0.6));
            c.beginPath(); c.moveTo(xH2 + 4, yH2(j)); c.lineTo(xOut - 4, yOut(k)); c.stroke();
        }
    }
    // nodes
    c.font = '9px sans-serif';
    for (let i = 0; i < N_IN; i++) {
        c.fillStyle = actColor(1, 0.25 + Math.abs(inp[i]) * 0.75);
        c.beginPath(); c.arc(xIn, yIn(i), 3.5, 0, 7); c.fill();
        c.fillStyle = 'rgba(138,147,173,0.85)';
        c.textAlign = 'right';
        c.fillText(IN_LABELS[i], xIn - 7, yIn(i) + 3);
    }
    for (let j = 0; j < N_H1; j++) {
        c.fillStyle = actColor(h[j], 0.2 + Math.abs(h[j]) * 0.8);
        c.beginPath(); c.arc(xH1, yH1(j), 4, 0, 7); c.fill();
    }
    for (let j = 0; j < N_H2; j++) {
        c.fillStyle = actColor(h2[j], 0.2 + Math.abs(h2[j]) * 0.8);
        c.beginPath(); c.arc(xH2, yH2(j), 4, 0, 7); c.fill();
    }
    c.textAlign = 'left';
    for (let k = 0; k < N_OUT; k++) {
        c.fillStyle = actColor(out[k], 0.25 + Math.abs(out[k]) * 0.75);
        c.beginPath(); c.arc(xOut, yOut(k), 5, 0, 7); c.fill();
        c.fillStyle = 'rgba(138,147,173,0.85)';
        c.fillText(`${OUT_LABELS[k]} ${out[k].toFixed(2)}`, xOut + 9, yOut(k) + 3);
    }
}

// ============================== UI ==============================
const $ = id => document.getElementById(id);
const banner = $('gen-banner');
let bannerTimer = null;

function flashBanner(html) {
    banner.innerHTML = html;
    banner.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.add('hidden'), 2200);
}

function switchTrack(i) {
    if (i === S.trackIdx) return;
    S.trackIdx = i;
    S.track = getTrack(i);
    document.querySelectorAll('.track-tab').forEach(b =>
        b.classList.toggle('active', +b.dataset.track === i));
    // keep the brains, restart the generation on the new track
    for (const car of S.cars) { car.spawn(S.track, S.cars.length); car.fitSum = 0; }
    S.simTime = 0;
    S.bullets.length = 0;
    S.kills = 0;
    S.shots = 0;
    S.episode = 0;
    S.genBest = 0;
    S.genMean = 0;
    S.genShotN = 0;
    S.genBadN = 0;
    renderTrackLayer();
    flashBanner(`Switched to <b>${TRACK_DEFS[i].name}</b> — same brains, new track`);
}

function setupUI() {
    document.querySelectorAll('.track-tab').forEach(b =>
        b.addEventListener('click', () => switchTrack(+b.dataset.track)));

    $('btn-pause').addEventListener('click', () => {
        S.paused = !S.paused;
        $('btn-pause').textContent = S.paused ? 'Resume' : 'Pause';
    });

    $('btn-reset').addEventListener('click', () => {
        S.gen = 1;
        S.record = 0;
        S.history.length = 0;
        S.popSize = S.nextPopSize;
        freshPopulation();
        drawChart();
        drawElim();
        flashBanner('Training reset — fresh random brains');
    });

    $('speed').addEventListener('input', e => {
        S.speedStop = +e.target.value;
        const v = SPEED_STOPS[S.speedStop];
        $('speed-label').textContent = v === Infinity ? 'Max' : v + '×';
    });

    $('pop').addEventListener('input', e => {
        S.nextPopSize = +e.target.value;
        $('pop-label').textContent = e.target.value;
    });

    $('mut').addEventListener('input', e => {
        // the slider sets the expected number of weights mutated per child —
        // it stays meaningful as the genome grows
        S.mutRate = +e.target.value / GENOME_SIZE;
        $('mut-label').textContent = `≈${e.target.value} weights`;
    });

    $('sensors').addEventListener('change', e => { S.sensorMode = e.target.value; });

    $('eval-mode').addEventListener('change', e => {
        S.evalMode = e.target.checked;
        flashBanner(S.evalMode
            ? 'Eval mode: learning frozen — try other tracks'
            : 'Training resumed');
    });

    $('btn-save').addEventListener('click', () => {
        const lead = [...S.cars].sort((a, b) => b.fitness - a.fitness)[0];
        try {
            localStorage.setItem('neural_racers_brain_v7', JSON.stringify({
                genome: Array.from(lead.brain.g),
                gen: S.gen,
                fitness: Math.round(lead.bestProgress),
                track: TRACK_DEFS[S.trackIdx].name,
                saved: Date.now(),
            }));
            flashBanner(`Saved leader's brain (gen ${S.gen})`);
        } catch (err) {
            flashBanner('Could not save (storage unavailable)');
        }
    });

    $('btn-load').addEventListener('click', () => {
        let data = null;
        try { data = JSON.parse(localStorage.getItem('neural_racers_brain_v7')); } catch (err) { /* ignore */ }
        if (!data || !data.genome || data.genome.length !== GENOME_SIZE) {
            flashBanner('No saved brain found');
            return;
        }
        const seed = Float32Array.from(data.genome);
        const genomes = [seed];
        while (genomes.length < S.popSize) genomes.push(mutate(seed));
        spawnPopulation(genomes);
        flashBanner(`Loaded brain from gen ${data.gen} (${data.track})`);
    });

    window.addEventListener('keydown', e => {
        if (e.key === ' ') {
            e.preventDefault();
            $('btn-pause').click();
        }
    });
}

function updateStats() {
    let alive = 0, best = 0, laps = 0;
    for (const car of S.cars) {
        if (car.alive) alive++;
        if (car.bestProgress > best) {
            best = car.bestProgress;
            laps = Math.floor(car.bestProgress / S.track.totalLen);
        }
    }
    $('stat-gen').textContent = S.gen;
    $('stat-alive').textContent = `${alive}/${S.cars.length}`;
    $('stat-best').textContent = `${(best / 10).toFixed(0)} m`;
    $('stat-laps').textContent = laps;
    $('stat-record').textContent = `${(S.record / 10).toFixed(0)} m`;
    $('stat-sps').textContent = `${(S.simRate / 60).toFixed(S.simRate < 600 ? 1 : 0)}×`;
    $('stat-kills').textContent = S.gen > NO_GUN_GENS
        ? `${S.kills} / ${S.shots}`
        : `locked until gen ${NO_GUN_GENS + 1}`;
}

// ============================== main loop ==============================
let frameCount = 0;
let rateTimer = performance.now();

function frame() {
    if (!view.w) resize();   // self-heal if the viewport measured 0 at boot
    if (!S.paused) {
        const target = SPEED_STOPS[S.speedStop];
        const t0 = performance.now();
        if (target === Infinity) {
            // run as many physics steps as fit in the frame budget
            // (hard cap so a frozen/virtualized clock can't trap us here)
            let burst = 0;
            while (performance.now() - t0 < 11 && burst < 400) {
                for (let k = 0; k < 8; k++) stepSim();
                burst++;
            }
        } else {
            for (let k = 0; k < target && performance.now() - t0 < 14; k++) stepSim();
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

// ============================== boot ==============================
const urlParams = new URLSearchParams(location.search);
const urlTrack = parseInt(urlParams.get('track'), 10);
if (urlTrack >= 0 && urlTrack < TRACK_DEFS.length) {
    S.trackIdx = urlTrack;
    document.querySelectorAll('.track-tab').forEach(b =>
        b.classList.toggle('active', +b.dataset.track === urlTrack));
}
const urlSpeed = parseInt(urlParams.get('speed'), 10);
if (urlSpeed >= 0 && urlSpeed < SPEED_STOPS.length) {
    S.speedStop = urlSpeed;
    $('speed').value = urlSpeed;
    $('speed-label').textContent = SPEED_STOPS[urlSpeed] === Infinity ? 'Max' : SPEED_STOPS[urlSpeed] + '×';
}
S.track = getTrack(S.trackIdx);
freshPopulation();
setupUI();
new ResizeObserver(resize).observe(document.getElementById('viewport'));
resize();
drawChart();
drawElim();

// headless test hook: ?walls=1 reports wall geometry in the title
if (urlParams.get('walls')) {
    const sharpest = loop => {
        let worst = 1, wx = 0, wy = 0;
        for (let i = 0; i < loop.length; i++) {
            const a = loop[(i - 1 + loop.length) % loop.length], b = loop[i], c = loop[(i + 1) % loop.length];
            const l1 = Math.hypot(b.x - a.x, b.y - a.y) || 1, l2 = Math.hypot(c.x - b.x, c.y - b.y) || 1;
            const d = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (l1 * l2);
            if (d < worst) { worst = d; wx = b.x; wy = b.y; }
        }
        return `cos=${worst.toFixed(2)}@(${wx | 0},${wy | 0})`;
    };
    document.title = `WALLS left n=${S.track.left.length} ${sharpest(S.track.left)} | right n=${S.track.right.length} ${sharpest(S.track.right)}`;
}

// headless test hook: ?bench=N runs N steps synchronously and reports in the title
const benchSteps = parseInt(urlParams.get('bench'), 10);
if (benchSteps > 0) {
    const t0 = Date.now();
    for (let i = 0; i < benchSteps; i++) stepSim();
    const ms = Date.now() - t0;
    document.title = `BENCH gen=${S.gen} record=${Math.round(S.record)} trackLen=${Math.round(S.track.totalLen)} steps/s=${Math.round(benchSteps / ms * 1000)} kills=${S.kills} shots=${S.shots}`;
}

// paint the initial state synchronously so the first visible frame never
// depends on rAF timing
render();
updateStats();
requestAnimationFrame(frame);

})();
