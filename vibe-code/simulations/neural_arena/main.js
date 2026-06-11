'use strict';
(() => {

// ============================== constants ==============================
const WORLD_W = 1200, WORLD_H = 700;
const CELL = 4;                          // occupancy/distance grid cell size (px)
const GW = WORLD_W / CELL, GH = WORLD_H / CELL;
const DT = 1 / 60;
const BORDER = 14;                       // arena boundary wall thickness

// battle needs all-round awareness, so the rays sweep ±140°
const RAY_ANGLES = [-140, -95, -55, -25, 0, 25, 55, 95, 140].map(d => d * Math.PI / 180);
const N_RAYS = RAY_ANGLES.length;
const RAY_MAX = 300;

// recurrent net inputs: rays, speed, prev steer, prev throttle, reload state,
// own hull; nearest enemy (line-of-sight gated, with a fading memory trace
// once sight is lost, plus its damage and whether it is aiming at us);
// nearest ally (always sensed: radio, with its damage); nearest incoming
// bullet; fraction of foes and allies still alive; and the shrinking danger
// zone (margin + direction to center).
const I_SPD = N_RAYS, I_STR = N_RAYS + 1, I_THR = N_RAYS + 2, I_RDY = N_RAYS + 3, I_HP = N_RAYS + 4;
const I_EX = I_HP + 1, I_EY = I_EX + 1, I_EVX = I_EY + 1, I_EVY = I_EVX + 1;
const I_ESEE = I_EVY + 1, I_EHP = I_ESEE + 1, I_EAIM = I_EHP + 1;
const I_AX = I_EAIM + 1, I_AY = I_AX + 1, I_AVX = I_AY + 1, I_AVY = I_AVX + 1, I_AHP = I_AVY + 1;
const I_BUL = I_AHP + 1;                 // 4 inputs
const I_FOES = I_BUL + 4, I_PALS = I_FOES + 1;
const I_ZMARGIN = I_PALS + 1, I_ZX = I_ZMARGIN + 1, I_ZY = I_ZX + 1;
const N_IN = I_ZY + 1;                   // 35
const N_H1 = 20, N_H2 = 12, N_OUT = 3;
const OFF_WXH = 0;
const OFF_WHH = OFF_WXH + N_IN * N_H1;
const OFF_BH  = OFF_WHH + N_H1 * N_H1;
const OFF_W12 = OFF_BH + N_H1;
const OFF_B2  = OFF_W12 + N_H1 * N_H2;
const OFF_WHY = OFF_B2 + N_H2;
const OFF_BY  = OFF_WHY + N_H2 * N_OUT;
const GENOME_SIZE = OFF_BY + N_OUT;

const MAX_SPEED = 320;                   // px/s — sensor normalization scale only
const ACCEL = 250, BRAKE = 430, DRAG = 0.6;
const REV_ACCEL = 130;
const STEER_RATE = 3.4;
const CAR_L = 22, CAR_W = 11;
const CAR_R = 9;                         // collision circle for walls & car bumps
const CAR_SENSE_R = 380;
const BULLET_SENSE_R = 520;
const HIST = 32, VEL_LAG = 6;
const LOS_CHECKS = 4;                    // nearest candidates tested for visibility
const MEM_TIME = 4;                      // s an enemy sighting lingers after LOS breaks

const FIRE_CD = 1.6;                     // s between shots
const BULLET_SPEED = 460, BULLET_LIFE = 1.3, BULLET_R = 13;
const ROUND_TIME = 40;                   // s of sim time per round

// the danger zone: a circle that starts covering everything and closes toward
// the center late in the round, so camping is a tactic, not a stalemate
const ZONE_CX = 600, ZONE_CY = 350;
const ZONE_R0 = 720, ZONE_RMIN = 150;
const ZONE_START = 14, ZONE_END = ROUND_TIME;
const ZONE_GRACE = 2.5;                  // s outside the zone before it kills

// cars take several hits to destroy, and every landed hit pays out — fights
// become engagements with a wounded state instead of coin flips, which both
// cuts selection noise and creates room for tactics (retreat hurt, press an
// advantage, finish weakened enemies)
const MAX_HP = 3;
const REGEN_DELAY = 5;                   // s unhit before repair starts
const REGEN_TIME = 3;                    // s per hull point recovered

// fitness: survival is the objective; everything else shapes how to survive.
// Kills/assists are paid to individuals, never shared evenly — selection
// happens within a team's own pool, so an equally-shared team bonus is a
// constant that cancels out; cooperation has to pay person by person
const SURVIVE_RATE = 8;                  // fitness per second alive
const DAMAGE_REWARD = 100, HIT_PENALTY = 70;     // per hit landed / taken
const KILL_REWARD = 200, DEATH_PENALTY = 100;    // extra on the killing blow
const ASSIST_REWARD = 60, ASSIST_WINDOW = 5;     // recent damagers share a kill
const LAST_STAND = 180;                  // FFA: last car alive
const TIMEOUT_SURVIVOR = 60;             // FFA: alive when time runs out
const TEAM_WIN = 80, TEAM_WIN_ALIVE = 100, TEAM_EDGE = 50;
const NEAR_R = 55, NEAR_REWARD = 35, NEAR_PENALTY = 35;
const BLIND_SHOT_PENALTY = 8;            // firing with no visible enemy
// friendly fire stings but must not crush the expected value of shooting:
// if a random early shot costs more than it can earn, evolution breeds out
// the trigger entirely and team battles stalemate into pacifism
const FRIENDLY_HIT_PENALTY = 60, FRIENDLY_KILL_PENALTY = 150, FRIENDLY_VICTIM_PENALTY = 40;
const ZONE_DRAIN = 25;                   // fitness per second spent outside
const ZONE_DEATH_PENALTY = 120;
// wall contact: a brief brush is cheap, but the cost ramps with continuous
// contact until it outweighs the survival income — so grinding against a wall
// is a losing strategy while parking NEAR cover stays free
const WALL_BASE = 4;                     // fitness/s at first contact
const WALL_RAMP = 8;                     // extra fitness/s per second stuck
const WIGGLE_COST = 0.25;
const BUMP_COST = 0.4;                   // car-on-car contact, per step

const N_EPISODES = 3;                    // rounds per generation, fitness summed —
                                         // combat outcomes are noisy, so selection
                                         // needs several samples to see skill
const N_ELITE = 4, N_FRESH = 2;
const CHAMP_FRACTION = 0.25;
const SPEED_STOPS = [1, 2, 4, 8, 16, 32, 100, Infinity];

const ARENA_COLORS = ['#ffb347', '#69f0ae', '#ff5fd0'];
const TEAM_COLORS = ['#ff5e6e', '#4aa3ff'];
const FFA_COLOR = '#38e1ff';

// obstacles are axis-aligned rects {x,y,w,h} and circles {cx,cy,r}; the team
// layouts are 180°-rotationally symmetric so neither side gets better cover
const ARENA_DEFS = [
    { name: 'Pillars', rects: [
        { x: 265, y: 165, w: 70, h: 70 }, { x: 265, y: 465, w: 70, h: 70 },
        { x: 865, y: 165, w: 70, h: 70 }, { x: 865, y: 465, w: 70, h: 70 },
        { x: 555, y: 305, w: 90, h: 90 },
    ], circles: [
        { cx: 600, cy: 130, r: 34 }, { cx: 600, cy: 570, r: 34 },
        { cx: 150, cy: 350, r: 34 }, { cx: 1050, cy: 350, r: 34 },
    ]},
    { name: 'Bunkers', rects: [
        { x: 480, y: 150, w: 240, h: 22 }, { x: 480, y: 528, w: 240, h: 22 },
        { x: 589, y: 280, w: 22, h: 140 },
        { x: 240, y: 210, w: 130, h: 20 }, { x: 240, y: 210, w: 20, h: 110 },
        { x: 830, y: 470, w: 130, h: 20 }, { x: 940, y: 380, w: 20, h: 110 },
        { x: 240, y: 470, w: 130, h: 20 }, { x: 240, y: 380, w: 20, h: 110 },
        { x: 830, y: 210, w: 130, h: 20 }, { x: 940, y: 210, w: 20, h: 110 },
    ], circles: []},
    { name: 'Crossfire', rects: [
        { x: 490, y: 330, w: 220, h: 40 }, { x: 580, y: 240, w: 40, h: 220 },
        { x: 150, y: 150, w: 160, h: 24 }, { x: 890, y: 150, w: 160, h: 24 },
        { x: 150, y: 526, w: 160, h: 24 }, { x: 890, y: 526, w: 160, h: 24 },
    ], circles: [
        { cx: 320, cy: 350, r: 40 }, { cx: 880, cy: 350, r: 40 },
        { cx: 600, cy: 120, r: 36 }, { cx: 600, cy: 580, r: 36 },
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

// ============================== arena ==============================
function buildArena(def) {
    // occupancy grid: 1 = open floor, 0 = wall/obstacle
    const occ = new Uint8Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) {
        for (let gx = 0; gx < GW; gx++) {
            const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
            let free = x > BORDER && y > BORDER && x < WORLD_W - BORDER && y < WORLD_H - BORDER;
            if (free) for (const r of def.rects) {
                if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) { free = false; break; }
            }
            if (free) for (const c of def.circles) {
                const dx = x - c.cx, dy = y - c.cy;
                if (dx * dx + dy * dy < c.r * c.r) { free = false; break; }
            }
            occ[gy * GW + gx] = free ? 1 : 0;
        }
    }
    // chamfer distance transform (3-4 metric): distance to nearest blocked cell
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
    const df = new Float32Array(GW * GH);
    for (let i = 0; i < df.length; i++) df[i] = Math.max(0, cd[i] / 3 - 1) * CELL;
    return { def, occ, df };
}

function isOpen(arena, x, y) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return false;
    return arena.occ[(y / CELL | 0) * GW + (x / CELL | 0)] === 1;
}

function dfAt(arena, x, y) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return 0;
    return arena.df[(y / CELL | 0) * GW + (x / CELL | 0)];
}

// sphere-traced raycast against the distance field
function raycast(arena, x, y, dx, dy) {
    let t = 0;
    while (t < RAY_MAX) {
        const px = x + dx * t, py = y + dy * t;
        if (px < 0 || py < 0 || px >= WORLD_W || py >= WORLD_H) return t;
        const gi = (py / CELL | 0) * GW + (px / CELL | 0);
        if (!arena.occ[gi]) return t;
        t += Math.max(2.5, arena.df[gi] * 0.9);
    }
    return RAY_MAX;
}

// is the straight line between two points unobstructed? Same sphere tracing —
// this is what makes hiding behind cover real: no LOS, no enemy on the sensors
function hasLOS(arena, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const ux = dx / dist, uy = dy / dist;
    let t = 0;
    while (t < dist) {
        const px = x0 + ux * t, py = y0 + uy * t;
        const gi = (py / CELL | 0) * GW + (px / CELL | 0);
        if (!arena.occ[gi]) return false;
        t += Math.max(2.5, arena.df[gi] * 0.9);
    }
    return true;
}

function zoneRadius(t) {
    if (t <= ZONE_START) return ZONE_R0;
    const k = Math.min(1, (t - ZONE_START) / (ZONE_END - ZONE_START));
    return ZONE_R0 + (ZONE_RMIN - ZONE_R0) * k;
}

// ============================== brain ==============================
function randomGenome() {
    const g = new Float32Array(GENOME_SIZE);
    for (let i = 0; i < GENOME_SIZE; i++) {
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
    constructor(genome, idx, team) {     // team: -1 = FFA, 0 = red, 1 = blue
        this.brain = new Brain(genome);
        this.idx = idx;
        this.team = team;
        this.rays = new Float32Array(N_RAYS);
        this.inp = new Float32Array(N_IN);
        this.histX = new Float32Array(HIST);
        this.histY = new Float32Array(HIST);
    }
    spawn(spot, nEnemies0, nAllies0) {
        this.x = spot.x;
        this.y = spot.y;
        this.heading = spot.heading;
        this.nEnemies0 = nEnemies0;
        this.nAllies0 = nAllies0;
        this.speed = 0;
        this.alive = true;
        this.deathBy = null;             // 'shot' | 'zone'
        this.steer = 0;
        this.throttle = 0;
        this.cooldown = rand(0.4, FIRE_CD + 0.4);
        this.kills = 0;
        this.timeAlive = 0;
        this.zoneTimer = 0;
        this.wallTime = 0;               // consecutive seconds of wall contact
        this.hp = MAX_HP;
        this.lastDamageT = -99;
        this.regenT = 0;
        this.mem = null;                 // fading memory of the last enemy sighting
        this.damagers = [];              // recent attackers, for assist credit
        this.penalty = 0;
        this.bonus = 0;
        this.seen = null;                // nearest visible enemy, for fire logic & viz
        this.histX.fill(this.x);
        this.histY.fill(this.y);
        this.histIdx = 0;
        this.brain.reset();
        this.rays.fill(RAY_MAX);
    }
    get fitness() {
        // kills, damage and assists are paid into `bonus` as they happen
        return this.timeAlive * SURVIVE_RATE + this.bonus - this.penalty;
    }
    isEnemy(o) { return this.team === -1 || o.team !== this.team; }
    // relative velocity of another car, estimated from its position history,
    // rotated into this car's frame and written to inp[at], inp[at+1]
    senseVel(other, cos, sin, at) {
        const j = (other.histIdx - VEL_LAG + HIST) % HIST;
        const vx = (other.x - other.histX[j]) / (VEL_LAG * DT);
        const vy = (other.y - other.histY[j]) / (VEL_LAG * DT);
        this.inp[at]     = clamp((vx * cos + vy * sin) / MAX_SPEED, -1, 1);
        this.inp[at + 1] = clamp((-vx * sin + vy * cos) / MAX_SPEED, -1, 1);
    }
    step(arena, cars) {
        const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
        const inp = this.inp;
        // sense walls and cover
        for (let r = 0; r < N_RAYS; r++) {
            const a = this.heading + RAY_ANGLES[r];
            const d = raycast(arena, this.x, this.y, Math.cos(a), Math.sin(a));
            this.rays[r] = d;
            inp[r] = d / RAY_MAX;
        }
        inp[I_SPD] = this.speed / MAX_SPEED;
        inp[I_STR] = this.steer;
        inp[I_THR] = this.throttle;
        inp[I_RDY] = 1 - clamp(this.cooldown / FIRE_CD, 0, 1);
        inp[I_HP] = this.hp / MAX_HP;
        // sense rivals: enemies need line of sight (cover conceals you),
        // allies are always sensed (radio)
        let ally = null, allyD = Infinity, foes = 0, pals = 0;
        const cand = [];
        for (const o of cars) {
            if (o === this || !o.alive) continue;
            const enemy = this.isEnemy(o);
            enemy ? foes++ : pals++;
            const dx = o.x - this.x, dy = o.y - this.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > CAR_SENSE_R * CAR_SENSE_R) continue;
            if (enemy) cand.push({ o, d2 });
            else if (d2 < allyD) { allyD = d2; ally = o; }
        }
        cand.sort((a, b) => a.d2 - b.d2);
        let enemy = null;
        for (let i = 0; i < cand.length && i < LOS_CHECKS; i++) {
            const o = cand[i].o;
            if (hasLOS(arena, this.x, this.y, o.x, o.y)) { enemy = o; break; }
        }
        this.seen = enemy;
        // enemy block: a sighting refreshes a fading memory, so breaking LOS
        // doesn't wipe the enemy from the senses instantly — "he's behind
        // that wall" persists for a few seconds, which is what makes peeking,
        // stalking and ambushing around cover learnable
        if (enemy) this.mem = { car: enemy, x: enemy.x, y: enemy.y, hp: enemy.hp, t: S.simTime };
        if (this.mem && (!this.mem.car.alive || S.simTime - this.mem.t > MEM_TIME)) this.mem = null;
        const m = this.mem;
        if (m) {
            const ex = (enemy ? enemy.x : m.x) - this.x;
            const ey = (enemy ? enemy.y : m.y) - this.y;
            inp[I_EX] = clamp((ex * cos + ey * sin) / CAR_SENSE_R, -1, 1);
            inp[I_EY] = clamp((-ex * sin + ey * cos) / CAR_SENSE_R, -1, 1);
            inp[I_EHP] = m.hp / MAX_HP;
            if (enemy) {
                this.senseVel(enemy, cos, sin, I_EVX);
                inp[I_ESEE] = 1;
                // is that enemy pointing at me? 1 = dead-on — dodge fuel
                const ed = Math.hypot(ex, ey) || 1;
                inp[I_EAIM] = -(Math.cos(enemy.heading) * ex + Math.sin(enemy.heading) * ey) / ed;
            } else {
                inp[I_EVX] = inp[I_EVY] = inp[I_EAIM] = 0;
                inp[I_ESEE] = clamp(1 - (S.simTime - m.t) / MEM_TIME, 0, 1);
            }
        } else {
            inp[I_EX] = inp[I_EY] = inp[I_EVX] = inp[I_EVY] = 0;
            inp[I_ESEE] = inp[I_EHP] = inp[I_EAIM] = 0;
        }
        // ally block: position, motion and hull state of the nearest teammate
        if (ally) {
            const ax = ally.x - this.x, ay = ally.y - this.y;
            inp[I_AX] = clamp((ax * cos + ay * sin) / CAR_SENSE_R, -1, 1);
            inp[I_AY] = clamp((-ax * sin + ay * cos) / CAR_SENSE_R, -1, 1);
            this.senseVel(ally, cos, sin, I_AVX);
            inp[I_AHP] = ally.hp / MAX_HP;
        } else {
            inp[I_AX] = inp[I_AY] = inp[I_AVX] = inp[I_AVY] = inp[I_AHP] = 0;
        }
        // sense the nearest hostile bullet (own excluded; in team mode even
        // friendly bullets are dangerous, so all of them count)
        let bul = null, bulD = BULLET_SENSE_R * BULLET_SENSE_R;
        for (const b of S.bullets) {
            if (b.owner === this) continue;
            const dx = b.x - this.x, dy = b.y - this.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bulD) { bulD = d2; bul = b; }
        }
        if (bul) {
            const dx = bul.x - this.x, dy = bul.y - this.y;
            const vn = BULLET_SPEED + MAX_SPEED;
            inp[I_BUL]     = clamp((dx * cos + dy * sin) / BULLET_SENSE_R, -1, 1);
            inp[I_BUL + 1] = clamp((-dx * sin + dy * cos) / BULLET_SENSE_R, -1, 1);
            inp[I_BUL + 2] = clamp((bul.dx * cos + bul.dy * sin) / vn, -1, 1);
            inp[I_BUL + 3] = clamp((-bul.dx * sin + bul.dy * cos) / vn, -1, 1);
        } else {
            inp[I_BUL] = inp[I_BUL + 1] = inp[I_BUL + 2] = inp[I_BUL + 3] = 0;
        }
        inp[I_FOES] = foes / Math.max(1, this.nEnemies0);
        inp[I_PALS] = this.team === -1 ? 0 : pals / Math.max(1, this.nAllies0);
        // sense the danger zone: signed margin to the edge + direction to center
        const zr = zoneRadius(S.simTime);
        const zdx = ZONE_CX - this.x, zdy = ZONE_CY - this.y;
        const zd = Math.hypot(zdx, zdy);
        inp[I_ZMARGIN] = clamp((zr - zd) / 300, -1, 1);
        inp[I_ZX] = clamp((zdx * cos + zdy * sin) / 600, -1, 1);
        inp[I_ZY] = clamp((-zdx * sin + zdy * cos) / 600, -1, 1);
        // think
        const out = this.brain.step(inp);
        this.penalty += Math.abs(out[0] - this.steer) * WIGGLE_COST;
        this.steer = out[0];
        this.throttle = out[1];
        // drive: same physics as Neural Racers — drag-limited, reversible
        const accel = this.throttle >= 0
            ? this.throttle * ACCEL
            : this.throttle * (this.speed > 1 ? BRAKE : REV_ACCEL);
        this.speed += accel * DT;
        this.speed -= DRAG * this.speed * DT;
        this.heading += this.steer * STEER_RATE * (this.speed / (Math.abs(this.speed) + 60)) * DT;
        this.x += Math.cos(this.heading) * this.speed * DT;
        this.y += Math.sin(this.heading) * this.speed * DT;
        // walls don't kill here — they stop you. Push out along the distance
        // field gradient and scrub speed, so leaning on cover is survivable
        let touching = false;
        for (let it = 0; it < 3; it++) {
            const d = dfAt(arena, this.x, this.y);
            if (d >= CAR_R) break;
            touching = true;
            const gx = (dfAt(arena, this.x + 6, this.y) - dfAt(arena, this.x - 6, this.y)) / 12;
            const gy = (dfAt(arena, this.x, this.y + 6) - dfAt(arena, this.x, this.y - 6)) / 12;
            const gl = Math.hypot(gx, gy) || 1;
            const push = (CAR_R - d) + 0.5;
            this.x += gx / gl * push;
            this.y += gy / gl * push;
            this.speed *= 0.55;
        }
        if (touching) {
            this.wallTime += DT;
            this.penalty += (WALL_BASE + WALL_RAMP * this.wallTime) * DT;
        } else {
            this.wallTime = 0;
        }
        this.x = clamp(this.x, 2, WORLD_W - 2);
        this.y = clamp(this.y, 2, WORLD_H - 2);
        // the zone: linger outside and it kills
        if (zd > zr) {
            this.zoneTimer += DT;
            this.penalty += ZONE_DRAIN * DT;
            if (this.zoneTimer > ZONE_GRACE) {
                this.alive = false;
                this.deathBy = 'zone';
                this.penalty += ZONE_DEATH_PENALTY;
                return;
            }
        } else {
            this.zoneTimer = 0;
        }
        // out-of-combat repair: stay unhit for a while and the hull slowly
        // recovers — pulling back behind cover to heal is a real tactic
        if (this.hp < MAX_HP && S.simTime - this.lastDamageT > REGEN_DELAY) {
            this.regenT += DT;
            if (this.regenT >= REGEN_TIME) { this.hp++; this.regenT = 0; }
        } else if (this.hp >= MAX_HP) {
            this.regenT = 0;
        }
        // fire: trigger output, gated by reload; recoil keeps it honest
        this.cooldown -= DT;
        if (out[2] > 0.5 && this.cooldown <= 0) {
            this.cooldown = FIRE_CD;
            this.speed -= 10;
            if (!this.seen) this.penalty += BLIND_SHOT_PENALTY;
            S.shots++;
            const c2 = Math.cos(this.heading), s2 = Math.sin(this.heading);
            S.bullets.push({
                x: this.x + c2 * (CAR_L / 2 + 5), y: this.y + s2 * (CAR_L / 2 + 5),
                dx: c2 * (BULLET_SPEED + this.speed), dy: s2 * (BULLET_SPEED + this.speed),
                life: BULLET_LIFE, owner: this,
                minD2: Infinity, minCar: null,
            });
        }
        // record position history for other cars' temporal sensing
        this.histX[this.histIdx] = this.x;
        this.histY[this.histIdx] = this.y;
        this.histIdx = (this.histIdx + 1) % HIST;
        this.timeAlive += DT;
    }
}

// ============================== simulation state ==============================
const S = {
    mode: 'ffa',                 // 'ffa' | 'teams'
    arenaIdx: 0,
    arena: null,
    arenas: [null, null, null],
    cars: [],
    gen: 1,
    simTime: 0,
    paused: false,
    evalMode: false,
    popSize: 40,
    nextPopSize: 40,
    mutRate: 6 / GENOME_SIZE,
    speedStop: 2,
    sensorMode: 'leader',
    record: 0,
    history: [],                 // { best, mean, shot, zoned, arenaIdx }
    stepsThisSecond: 0,
    simRate: 0,
    bullets: [],
    kills: 0,
    shots: 0,
    redWins: 0,
    blueWins: 0,
    streakTeam: -1,              // team currently on a round-win streak
    streakLen: 0,
    episode: 0,
    genBest: 0,
    genMean: 0,
    genShotN: 0,
    genZonedN: 0,
};

function getArena(i) {
    if (!S.arenas[i]) S.arenas[i] = buildArena(ARENA_DEFS[i]);
    return S.arenas[i];
}

// ============================== spawning ==============================
function makeSpawnSpots(arena, n, mode) {
    const spots = [];
    const nRed = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
        let x = WORLD_W / 2, y = WORLD_H / 2, ok = false;
        for (let t = 0; t < 400 && !ok; t++) {
            if (mode === 'teams') {
                // red deploys on the left, blue on the right — the strips
                // reach far enough in that the front lines start within
                // sensor range, so combat (and its learning signal) exists
                // from generation 1 instead of two teams never meeting
                x = i < nRed ? rand(60, 440) : rand(760, 1140);
                y = rand(50, 650);
            } else {
                x = rand(40, 1160);
                y = rand(40, 660);
            }
            if (dfAt(arena, x, y) < CAR_R + 14) continue;
            ok = true;
            const minD = t > 200 ? 30 : 55;   // relax spacing if the strip is crowded
            for (const s of spots) {
                const dx = s.x - x, dy = s.y - y;
                if (dx * dx + dy * dy < minD * minD) { ok = false; break; }
            }
        }
        const heading = mode === 'teams'
            ? (i < nRed ? 0 : Math.PI) + rand(-0.5, 0.5)
            : rand(0, Math.PI * 2);
        spots.push({ x, y, heading });
    }
    return spots;
}

function respawnField() {
    const n = S.cars.length;
    const spots = makeSpawnSpots(S.arena, n, S.mode);
    let red = 0;
    for (const c of S.cars) if (c.team === 0) red++;
    for (let i = 0; i < n; i++) {
        const c = S.cars[i];
        const nE = c.team === -1 ? n - 1 : (c.team === 0 ? n - red : red);
        const nA = c.team === -1 ? 0 : (c.team === 0 ? red : n - red) - 1;
        c.spawn(spots[i], nE, nA);
    }
    S.simTime = 0;
    S.bullets.length = 0;
}

function spawnCars(genomes) {
    const n = genomes.length, nRed = Math.floor(n / 2);
    S.cars = genomes.map((g, i) =>
        new Car(g, i, S.mode === 'teams' ? (i < nRed ? 0 : 1) : -1));
    respawnField();
    S.kills = 0;
    S.shots = 0;
    S.episode = 0;
    S.genBest = -Infinity;
    S.genMean = 0;
    S.genShotN = 0;
    S.genZonedN = 0;
}

function freshPopulation() {
    const genomes = [];
    for (let i = 0; i < S.popSize; i++) genomes.push(randomGenome());
    spawnCars(genomes);
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

// breed one pool (whole field in FFA; each team separately in team mode, so
// red and blue co-evolve against each other instead of blending)
function evolvePool(pool, size) {
    const sorted = [...pool].sort((a, b) => b.fitSum - a.fitSum);
    const champ = sorted[0].brain.g;
    const genomes = [new Float32Array(champ)];
    for (let i = 1; i < Math.min(N_ELITE, sorted.length) && genomes.length < size; i++) {
        genomes.push(mutate(sorted[i].brain.g, 0.35));
    }
    const nChamp = Math.floor(size * CHAMP_FRACTION);
    for (let i = 0; i < nChamp && genomes.length < size - N_FRESH; i++) {
        genomes.push(mutate(champ, i % 2 ? 1 : 0.5));
    }
    while (genomes.length < size - N_FRESH) {
        const a = tournament(sorted), b = tournament(sorted);
        genomes.push(mutate(Math.random() < 0.75 ? crossover(a.brain.g, b.brain.g) : new Float32Array(a.brain.g)));
    }
    while (genomes.length < size) genomes.push(randomGenome());
    return genomes.slice(0, size);
}

function endGeneration() {
    // fold this round into the generation's totals
    let epBest = -Infinity, epMean = 0, shotN = 0, zonedN = 0;
    for (const c of S.cars) {
        c.fitSum = (c.fitSum || 0) + c.fitness;
        if (c.fitness > epBest) epBest = c.fitness;
        epMean += c.fitness;
        if (!c.alive) c.deathBy === 'shot' ? shotN++ : zonedN++;
    }
    S.genBest = Math.max(S.genBest, epBest);
    S.genMean += epMean / S.cars.length;
    S.genShotN += shotN;
    S.genZonedN += zonedN;
    S.episode++;
    if (!S.evalMode && S.episode < N_EPISODES) {
        respawnField();
        flashBanner(`Generation <b>${S.gen}</b> — round ${S.episode + 1}/${N_EPISODES}`);
        return;
    }
    const best = S.genBest;
    S.history.push({
        best,
        mean: S.genMean / S.episode,
        shot: S.genShotN,
        zoned: S.genZonedN,
        arenaIdx: S.arenaIdx,
    });
    if (S.history.length > 400) S.history.shift();
    if (best > S.record) S.record = best;
    drawChart();
    drawElim();

    let genomes;
    if (S.evalMode) {
        genomes = S.cars.map(c => c.brain.g);
    } else {
        S.popSize = S.nextPopSize;
        if (S.mode === 'teams') {
            const red = S.cars.filter(c => c.team === 0);
            const blue = S.cars.filter(c => c.team === 1);
            const nRed = Math.floor(S.popSize / 2);
            const redG = evolvePool(red, nRed);
            const blueG = evolvePool(blue, S.popSize - nRed);
            // cross-pool migration: co-evolution can lock into one-sided
            // dominance (the losing pool's selection signal collapses when
            // everyone dies alike). If a team is on a streak, the losers get
            // a mutated copy of the winners' champion to study
            if (S.streakLen >= 3) {
                const from = S.streakTeam === 0 ? redG : blueG;
                const to = S.streakTeam === 0 ? blueG : redG;
                to[to.length - 1] = mutate(from[0]);
            }
            genomes = redG.concat(blueG);
        } else {
            genomes = evolvePool(S.cars, S.popSize);
        }
        S.gen++;
    }
    const kills = S.kills;
    spawnCars(genomes);
    if (S.mode === 'teams') {
        flashBanner(`Generation <b>${S.gen}</b> — wins <b class="red">${S.redWins}</b> : <b class="blue">${S.blueWins}</b> · ${kills} kills`);
    } else {
        flashBanner(`Generation <b>${S.gen}</b> — best ${Math.round(best)} · ${kills} kill${kills === 1 ? '' : 's'}`);
    }
}

// ============================== sim step ==============================
let stepParity = 0;
function stepSim() {
    const cars = S.cars;
    // alternate iteration direction so neither team systematically moves
    // first within a tick (initiative would otherwise be asymmetric)
    stepParity ^= 1;
    if (stepParity) {
        for (let i = 0; i < cars.length; i++) if (cars[i].alive) cars[i].step(S.arena, cars);
    } else {
        for (let i = cars.length - 1; i >= 0; i--) if (cars[i].alive) cars[i].step(S.arena, cars);
    }
    // cars are solid: overlapping pairs get pushed apart, with a small cost
    const minD = CAR_R * 2;
    for (let i = 0; i < cars.length; i++) {
        const a = cars[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < cars.length; j++) {
            const b = cars[j];
            if (!b.alive) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < minD * minD && d2 > 0.01) {
                const d = Math.sqrt(d2);
                const push = (minD - d) / 2, ux = dx / d, uy = dy / d;
                a.x -= ux * push; a.y -= uy * push;
                b.x += ux * push; b.y += uy * push;
                a.penalty += BUMP_COST;
                b.penalty += BUMP_COST;
            }
        }
    }
    // bullets: fly straight, die on cover or expiry, eliminate cars they hit
    for (let i = S.bullets.length - 1; i >= 0; i--) {
        const b = S.bullets[i];
        b.life -= DT;
        b.x += b.dx * DT;
        b.y += b.dy * DT;
        let gone = b.life <= 0 || !isOpen(S.arena, b.x, b.y);
        let hit = false;
        if (!gone) {
            for (const c of cars) {
                if (!c.alive || c === b.owner) continue;
                const dx = c.x - b.x, dy = c.y - b.y;
                const d2 = dx * dx + dy * dy;
                if (b.owner.isEnemy(c) && d2 < b.minD2) { b.minD2 = d2; b.minCar = c; }
                if (d2 < BULLET_R * BULLET_R) {
                    gone = hit = true;
                    const hostile = b.owner.isEnemy(c);
                    c.hp--;
                    c.lastDamageT = S.simTime;
                    c.speed *= 0.6;          // stagger
                    c.damagers.push({ car: b.owner, t: S.simTime });
                    if (hostile) {
                        // every landed hit pays — fitness flows from
                        // skirmishes, not just confirmed kills
                        b.owner.bonus += DAMAGE_REWARD;
                        c.penalty += HIT_PENALTY;
                    } else {
                        b.owner.penalty += FRIENDLY_HIT_PENALTY;
                        c.penalty += FRIENDLY_VICTIM_PENALTY;
                    }
                    if (c.hp <= 0) {
                        c.alive = false;
                        c.deathBy = 'shot';
                        c.penalty += DEATH_PENALTY;
                        if (hostile) {
                            b.owner.kills++;
                            b.owner.bonus += KILL_REWARD;
                            S.kills++;
                            // assist credit: whoever softened the target up
                            // recently shares in the kill — individually
                            // attributed, so focus fire is actually selected for
                            const credited = new Set([b.owner]);
                            for (const a of c.damagers) {
                                if (!credited.has(a.car) && a.car.isEnemy(c) &&
                                    S.simTime - a.t < ASSIST_WINDOW) {
                                    credited.add(a.car);
                                    a.car.bonus += ASSIST_REWARD;
                                }
                            }
                        } else {
                            b.owner.penalty += FRIENDLY_KILL_PENALTY;
                        }
                    }
                    break;
                }
            }
        }
        if (gone) {
            // near-miss shaping: graded credit for grazing an enemy, and a
            // rattle for the enemy it grazed — dense signal for marksmanship
            if (!hit && b.minCar && b.minD2 < NEAR_R * NEAR_R) {
                const cl = clamp(1 - (Math.sqrt(b.minD2) - BULLET_R) / (NEAR_R - BULLET_R), 0, 1);
                b.owner.bonus += NEAR_REWARD * cl;
                b.minCar.penalty += NEAR_PENALTY * cl;
            }
            S.bullets.splice(i, 1);
        }
    }
    S.simTime += DT;
    S.stepsThisSecond++;
    // end-of-round conditions
    let alive = 0, red = 0, blue = 0;
    for (const c of cars) {
        if (!c.alive) continue;
        alive++;
        if (c.team === 0) red++;
        else if (c.team === 1) blue++;
    }
    const timeUp = S.simTime >= ROUND_TIME;
    if (S.mode === 'teams') {
        if (red === 0 || blue === 0 || timeUp) {
            let winner = -1;
            if (red > 0 && blue === 0) winner = 0;
            else if (blue > 0 && red === 0) winner = 1;
            if (winner >= 0) {
                for (const c of cars) if (c.team === winner) {
                    c.bonus += TEAM_WIN;
                    if (c.alive) c.bonus += TEAM_WIN_ALIVE;
                }
                winner === 0 ? S.redWins++ : S.blueWins++;
            } else if (timeUp && red !== blue) {
                // timeout: the team with more survivors takes the edge
                winner = red > blue ? 0 : 1;
                for (const c of cars) if (c.team === winner) c.bonus += TEAM_EDGE;
                winner === 0 ? S.redWins++ : S.blueWins++;
            }
            if (winner >= 0) {
                if (winner === S.streakTeam) S.streakLen++;
                else { S.streakTeam = winner; S.streakLen = 1; }
            }
            endGeneration();
        }
    } else {
        if (alive <= 1 || timeUp) {
            if (alive === 1) {
                for (const c of cars) if (c.alive) c.bonus += timeUp ? TIMEOUT_SURVIVOR : LAST_STAND;
            } else if (timeUp) {
                for (const c of cars) if (c.alive) c.bonus += TIMEOUT_SURVIVOR;
            }
            endGeneration();
        }
    }
}

function leader() {
    let best = null;
    for (const car of S.cars) {
        if (car.alive && (!best || car.fitness > best.fitness)) best = car;
    }
    return best || S.cars[0];
}

// ============================== rendering ==============================
const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
let view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
let arenaLayer = null;

function resize() {
    const vp = document.getElementById('viewport');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = vp.clientWidth, h = vp.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const s = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H);
    view = { s, ox: (canvas.width - WORLD_W * s) / 2, oy: (canvas.height - WORLD_H * s) / 2, w: canvas.width, h: canvas.height, dpr };
    renderArenaLayer();
}

function renderArenaLayer() {
    if (!S.arena || !view.w) return;
    if (!arenaLayer) arenaLayer = document.createElement('canvas');
    arenaLayer.width = view.w; arenaLayer.height = view.h;
    const c = arenaLayer.getContext('2d');
    c.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
    const def = S.arena.def;
    const accent = ARENA_COLORS[S.arenaIdx];
    // floor
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 26;
    c.fillStyle = '#161b2b';
    c.beginPath();
    c.roundRect(BORDER, BORDER, WORLD_W - 2 * BORDER, WORLD_H - 2 * BORDER, 10);
    c.fill();
    c.restore();
    // faint floor grid
    c.save();
    c.beginPath();
    c.roundRect(BORDER, BORDER, WORLD_W - 2 * BORDER, WORLD_H - 2 * BORDER, 10);
    c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.028)';
    c.lineWidth = 1;
    for (let x = 60; x < WORLD_W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, WORLD_H); c.stroke(); }
    for (let y = 50; y < WORLD_H; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(WORLD_W, y); c.stroke(); }
    c.restore();
    // boundary glow
    c.save();
    c.shadowColor = accent;
    c.shadowBlur = 9;
    c.strokeStyle = accent + 'cc';
    c.lineWidth = 2.5;
    c.beginPath();
    c.roundRect(BORDER, BORDER, WORLD_W - 2 * BORDER, WORLD_H - 2 * BORDER, 10);
    c.stroke();
    c.restore();
    // obstacles: dark blocks with glowing edges — the cover that matters
    c.save();
    c.shadowColor = accent;
    c.shadowBlur = 7;
    c.lineWidth = 2;
    c.strokeStyle = accent + 'b8';
    c.fillStyle = '#0c0f19';
    for (const r of def.rects) {
        c.beginPath();
        c.roundRect(r.x, r.y, r.w, r.h, 4);
        c.fill();
        c.stroke();
    }
    for (const ci of def.circles) {
        c.beginPath();
        c.arc(ci.cx, ci.cy, ci.r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
    }
    c.restore();
}

function carColor(car) {
    return car.team === -1 ? FFA_COLOR : TEAM_COLORS[car.team];
}

function drawCar(car, isLeader) {
    const c = ctx;
    c.save();
    c.translate(car.x, car.y);
    c.rotate(car.heading);
    if (!car.alive) {
        c.globalAlpha = 0.18;
        c.fillStyle = car.deathBy === 'shot' ? '#ff5e5e' : '#ffb060';
        c.fillRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W);
        c.restore();
        return;
    }
    if (isLeader) {
        c.shadowColor = '#ffd35c';
        c.shadowBlur = 14;
    }
    c.globalAlpha = isLeader ? 1 : 0.85;
    c.fillStyle = carColor(car);
    c.beginPath();
    c.roundRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 3.5);
    c.fill();
    c.shadowBlur = 0;
    // gun barrel
    c.fillStyle = 'rgba(232,236,246,0.85)';
    c.fillRect(CAR_L / 2 - 2, -1.5, 8, 3);
    // cabin
    c.fillStyle = 'rgba(10,13,20,0.75)';
    c.beginPath();
    c.roundRect(-CAR_L * 0.12, -CAR_W * 0.32, CAR_L * 0.36, CAR_W * 0.64, 2);
    c.fill();
    if (isLeader) {
        c.strokeStyle = '#ffd35c';
        c.lineWidth = 1.4;
        c.beginPath();
        c.roundRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 3.5);
        c.stroke();
    }
    c.restore();
    // hull pips, shown once a car has taken damage — the tactical state
    // (who is wounded, who is retreating to heal) stays readable
    if (car.hp < MAX_HP) {
        c.save();
        c.globalAlpha = 0.9;
        for (let i = 0; i < MAX_HP; i++) {
            c.fillStyle = i < car.hp
                ? (car.hp === 1 ? '#ff5e5e' : '#ffd35c')
                : 'rgba(255,255,255,0.16)';
            c.fillRect(car.x - 8 + i * 6, car.y - 15, 4.5, 3);
        }
        c.restore();
    }
}

function drawSensors(car) {
    const c = ctx;
    c.save();
    c.lineWidth = 1;
    for (let r = 0; r < N_RAYS; r++) {
        const a = car.heading + RAY_ANGLES[r];
        const d = car.rays[r];
        const near = 1 - d / RAY_MAX;
        c.strokeStyle = `rgba(${56 + near * 199 | 0}, ${225 - near * 141 | 0}, ${255 - near * 143 | 0}, 0.45)`;
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
    // line of sight to the enemy it currently sees
    if (car.seen && car.seen.alive) {
        c.strokeStyle = 'rgba(255,211,92,0.55)';
        c.setLineDash([5, 5]);
        c.beginPath();
        c.moveTo(car.x, car.y);
        c.lineTo(car.seen.x, car.seen.y);
        c.stroke();
        c.setLineDash([]);
    }
    c.restore();
}

function render() {
    if (!view.w) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    if (arenaLayer) ctx.drawImage(arenaLayer, 0, 0);
    ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
    // danger zone: red haze outside, dashed ring at the edge
    const zr = zoneRadius(S.simTime);
    if (zr < ZONE_R0) {
        ctx.save();
        const p = new Path2D();
        p.rect(BORDER, BORDER, WORLD_W - 2 * BORDER, WORLD_H - 2 * BORDER);
        p.arc(ZONE_CX, ZONE_CY, zr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,70,70,0.07)';
        ctx.fill(p, 'evenodd');
        ctx.strokeStyle = 'rgba(255,95,95,0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.arc(ZONE_CX, ZONE_CY, zr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
    const lead = leader();
    for (const car of S.cars) if (!car.alive) drawCar(car, false);
    if (S.sensorMode === 'all') {
        for (const car of S.cars) if (car.alive) drawSensors(car);
    } else if (S.sensorMode === 'leader' && lead && lead.alive) {
        drawSensors(lead);
    }
    for (const car of S.cars) if (car.alive && car !== lead) drawCar(car, false);
    if (lead && lead.alive) drawCar(lead, true);
    // bullet tracers, tinted by the shooter's side
    if (S.bullets.length) {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.shadowBlur = 6;
        for (const b of S.bullets) {
            const col = b.owner.team === -1 ? '#ffd35c' : TEAM_COLORS[b.owner.team];
            ctx.strokeStyle = col;
            ctx.shadowColor = col;
            ctx.beginPath();
            ctx.moveTo(b.x - b.dx * 0.03, b.y - b.dy * 0.03);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        ctx.restore();
    }
}

// ============================== charts ==============================
const chartCv = document.getElementById('chart');
const chartCtx = chartCv.getContext('2d');

function drawChart() {
    const c = chartCtx, W = chartCv.width, H = chartCv.height;
    c.clearRect(0, 0, W, H);
    const h = S.history;
    if (h.length < 1) return;
    let max = 100, min = 0;
    for (const e of h) {
        if (e.best > max) max = e.best;
        if (e.mean < min) min = e.mean;
    }
    const n = h.length;
    const px = i => n === 1 ? W : (i / (n - 1)) * (W - 4) + 2;
    const py = v => H - 4 - ((v - min) / (max - min)) * (H - 12);
    // tinted background bands per arena
    let runStart = 0;
    for (let i = 1; i <= n; i++) {
        if (i === n || h[i].arenaIdx !== h[runStart].arenaIdx) {
            c.fillStyle = ARENA_COLORS[h[runStart].arenaIdx] + '14';
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
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].mean)) : c.moveTo(px(i), py(h[i].mean));
    c.stroke();
    // best line
    c.strokeStyle = '#38e1ff';
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].best)) : c.moveTo(px(i), py(h[i].best));
    c.stroke();
    c.fillStyle = 'rgba(138,147,173,0.9)';
    c.font = '10px sans-serif';
    c.fillText(`${Math.round(max)} fitness`, 4, 11);
}

const elimCv = document.getElementById('elim');
const elimCtx = elimCv.getContext('2d');

function drawElim() {
    const c = elimCtx, W = elimCv.width, H = elimCv.height;
    c.clearRect(0, 0, W, H);
    const h = S.history;
    if (!h.length) return;
    let max = 1;
    for (const e of h) max = Math.max(max, e.shot || 0, e.zoned || 0);
    const n = h.length;
    const px = i => n === 1 ? W : (i / (n - 1)) * (W - 4) + 2;
    const py = v => H - 4 - (v / max) * (H - 18);
    c.lineWidth = 1.4;
    c.strokeStyle = 'rgba(255,176,96,0.9)';
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].zoned || 0)) : c.moveTo(px(i), py(h[i].zoned || 0));
    c.stroke();
    c.strokeStyle = '#ff5e5e';
    c.beginPath();
    for (let i = 0; i < n; i++) i ? c.lineTo(px(i), py(h[i].shot || 0)) : c.moveTo(px(i), py(h[i].shot || 0));
    c.stroke();
    c.font = '9px sans-serif';
    c.fillStyle = '#ff5e5e';
    c.fillText('shot', W - 58, 10);
    c.fillStyle = 'rgba(255,176,96,0.95)';
    c.fillText('zoned', W - 34, 10);
    c.fillStyle = 'rgba(138,147,173,0.9)';
    c.fillText(max, 4, 10);
}

// ============================== network viz ==============================
const netCv = document.getElementById('net');
const netCtx = netCv.getContext('2d');
const IN_LABELS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9',
    'spd', 'str', 'thr', 'rdy', 'hp',
    'Ex', 'Ey', 'Evx', 'Evy', 'see', 'Ehp', 'aim',
    'Ax', 'Ay', 'Avx', 'Avy', 'Ahp',
    'px', 'py', 'pvx', 'pvy',
    'foes', 'pals', 'zone', 'zx', 'zy'];
const OUT_LABELS = ['steer', 'gas/brk', 'fire'];

function actColor(v, alpha) {
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

function switchMode(m) {
    if (m === S.mode) return;
    S.mode = m;
    document.querySelectorAll('.mode-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === m));
    $('stat-score-box').classList.toggle('hidden', m !== 'teams');
    // re-deal the current brains into the new structure; gen count and
    // history carry over, the round restarts
    const genomes = S.cars.map(c => c.brain.g);
    spawnCars(genomes);
    flashBanner(m === 'teams'
        ? 'Team battle: <b class="red">red</b> vs <b class="blue">blue</b> — same brains, two gene pools'
        : 'Free-for-all — same brains, one gene pool');
}

function switchArena(i) {
    if (i === S.arenaIdx) return;
    S.arenaIdx = i;
    S.arena = getArena(i);
    document.querySelectorAll('.arena-tab').forEach(b =>
        b.classList.toggle('active', +b.dataset.arena === i));
    const genomes = S.cars.map(c => c.brain.g);
    spawnCars(genomes);
    renderArenaLayer();
    flashBanner(`Switched to <b>${ARENA_DEFS[i].name}</b> — same brains, new battlefield`);
}

function setupUI() {
    document.querySelectorAll('.mode-tab').forEach(b =>
        b.addEventListener('click', () => switchMode(b.dataset.mode)));
    document.querySelectorAll('.arena-tab').forEach(b =>
        b.addEventListener('click', () => switchArena(+b.dataset.arena)));

    $('btn-pause').addEventListener('click', () => {
        S.paused = !S.paused;
        $('btn-pause').textContent = S.paused ? 'Resume' : 'Pause';
    });

    $('btn-reset').addEventListener('click', () => {
        S.gen = 1;
        S.record = 0;
        S.redWins = 0;
        S.blueWins = 0;
        S.streakTeam = -1;
        S.streakLen = 0;
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
        S.mutRate = +e.target.value / GENOME_SIZE;
        $('mut-label').textContent = `≈${e.target.value} weights`;
    });

    $('sensors').addEventListener('change', e => { S.sensorMode = e.target.value; });

    $('eval-mode').addEventListener('change', e => {
        S.evalMode = e.target.checked;
        flashBanner(S.evalMode
            ? 'Eval mode: learning frozen — try other arenas or the other mode'
            : 'Training resumed');
    });

    $('btn-save').addEventListener('click', () => {
        const lead = [...S.cars].sort((a, b) => b.fitness - a.fitness)[0];
        try {
            localStorage.setItem('neural_arena_brain_v2', JSON.stringify({
                genome: Array.from(lead.brain.g),
                gen: S.gen,
                fitness: Math.round(lead.fitness),
                mode: S.mode,
                arena: ARENA_DEFS[S.arenaIdx].name,
                saved: Date.now(),
            }));
            flashBanner(`Saved leader's brain (gen ${S.gen})`);
        } catch (err) {
            flashBanner('Could not save (storage unavailable)');
        }
    });

    $('btn-load').addEventListener('click', () => {
        let data = null;
        try { data = JSON.parse(localStorage.getItem('neural_arena_brain_v2')); } catch (err) { /* ignore */ }
        if (!data || !data.genome || data.genome.length !== GENOME_SIZE) {
            flashBanner('No saved brain found');
            return;
        }
        const seed = Float32Array.from(data.genome);
        const genomes = [seed];
        while (genomes.length < S.popSize) genomes.push(mutate(seed));
        spawnCars(genomes);
        flashBanner(`Loaded brain from gen ${data.gen} (${data.arena})`);
    });

    window.addEventListener('keydown', e => {
        if (e.key === ' ') {
            e.preventDefault();
            $('btn-pause').click();
        }
    });
}

function updateStats() {
    let alive = 0, red = 0, blue = 0, best = -Infinity;
    for (const car of S.cars) {
        if (car.alive) {
            alive++;
            if (car.team === 0) red++;
            else if (car.team === 1) blue++;
        }
        if (car.fitness > best) best = car.fitness;
    }
    $('stat-gen').textContent = S.gen;
    $('stat-alive').innerHTML = S.mode === 'teams'
        ? `<span class="red">${red}</span> v <span class="blue">${blue}</span>`
        : `${alive}/${S.cars.length}`;
    $('stat-best').textContent = Math.round(Math.max(0, best));
    $('stat-record').textContent = Math.round(S.record);
    $('stat-sps').textContent = `${(S.simRate / 60).toFixed(S.simRate < 600 ? 1 : 0)}×`;
    $('stat-kills').textContent = `${S.kills} / ${S.shots}`;
    if (S.mode === 'teams') {
        $('stat-score').innerHTML = `<span class="red">Red ${S.redWins}</span> — <span class="blue">${S.blueWins} Blue</span>`;
    }
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
            // hard cap so a frozen/virtualized clock can't trap us here
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
if (urlParams.get('mode') === 'teams') {
    S.mode = 'teams';
    document.querySelectorAll('.mode-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === 'teams'));
    $('stat-score-box').classList.remove('hidden');
}
const urlArena = parseInt(urlParams.get('arena'), 10);
if (urlArena >= 0 && urlArena < ARENA_DEFS.length) {
    S.arenaIdx = urlArena;
    document.querySelectorAll('.arena-tab').forEach(b =>
        b.classList.toggle('active', +b.dataset.arena === urlArena));
}
const urlSpeed = parseInt(urlParams.get('speed'), 10);
if (urlSpeed >= 0 && urlSpeed < SPEED_STOPS.length) {
    S.speedStop = urlSpeed;
    $('speed').value = urlSpeed;
    $('speed-label').textContent = SPEED_STOPS[urlSpeed] === Infinity ? 'Max' : SPEED_STOPS[urlSpeed] + '×';
}
S.arena = getArena(S.arenaIdx);
freshPopulation();
setupUI();
new ResizeObserver(resize).observe(document.getElementById('viewport'));
resize();
drawChart();
drawElim();

// headless test hook: ?bench=N runs N steps synchronously and reports in the title
const benchSteps = parseInt(urlParams.get('bench'), 10);
if (benchSteps > 0) {
    const t0 = Date.now();
    for (let i = 0; i < benchSteps; i++) stepSim();
    const ms = Date.now() - t0;
    let alive = 0;
    for (const c of S.cars) if (c.alive) alive++;
    document.title = `BENCH mode=${S.mode} gen=${S.gen} record=${Math.round(S.record)} alive=${alive}/${S.cars.length} kills=${S.kills} shots=${S.shots} wins=${S.redWins}:${S.blueWins} steps/s=${Math.round(benchSteps / Math.max(1, ms) * 1000)}`;
}

// paint the initial state synchronously so the first visible frame never
// depends on rAF timing
render();
updateStats();
requestAnimationFrame(frame);

})();
