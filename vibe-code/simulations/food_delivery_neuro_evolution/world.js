// World simulation: car physics (kinematic bicycle), 14-ray x 4-category
// sensors, collision handling (static = fatal, dynamic = penalized),
// pedestrians, traffic-law tracking and the per-episode job state machine.
// Fixed timestep physics at 60 Hz; neural decisions every 3rd tick (20 Hz).
'use strict';

const DT = 1 / 60;
const NN_EVERY = 3;
const N_RAYS = 14;
const SENSOR_RANGE = 140;
const CAR_LEN = 18, CAR_W = 9;
// Speed LIMIT is 3x the old cap - nothing forces cars to use it. The net
// sees its own speed and picks its cruising pace; corners, sensors and the
// fatal rules make raw speed a trade-off, not a free win.
const CAR_MAXV = 360, CAR_MAXREV = 40;
const CAR_ACCEL = 240, CAR_BRAKE = 420;
const WHEELBASE = 12, MAX_STEER = 0.45;
const ACTION_SMOOTH = 0.22;            // per physics tick toward the raw NN action
// Pickups/deliveries require a genuine STANDSTILL at the door (<6 px/s held
// for the dwell time), not just slow rolling.
const ARRIVE_RADIUS = 26, ARRIVE_SPEED = 6, ARRIVE_DWELL = 0.4;
const RED_GRACE = 1.0;      // s: crossing within the all-red clearance is legal
const NOPROGRESS_TIMEOUT = 18;   // s unblocked without route progress
const NOPROGRESS_ABS = 60;       // s without progress from ANY cause (jams must dissolve)
const OFFROUTE_TICKS = 10;             // NN ticks (0.5 s) before a replan
const REPLAN_COOLDOWN = 2;
const MISS_DIST = 130;                 // replanning this close to the target door
                                       // counts as a MISSED delivery attempt
// Leg progress ramp: every px of NEW leg-best (lowest-ever) remaining route
// distance pays FIT.PROGRESS, capped per leg. A potential function over
// "closest the car has ever been to its current door" - replans, loops and
// re-driving can never pay the same px twice. Pays on EVERY leg: when it was
// carrying-only, the empty leg after a delivery was economically dead and
// cars parked there forever - the "one delivery wall".
const RAMP_PAY_CAP = 700;              // px of paid progress per leg
const N_PEDS = 16, PED_SPEED = 20, PED_R = 4;

function createWorld(town, jobs) {
    return {
        town, jobs, cars: [], peds: [], simTime: 0, tick: 0,
        phase: 0, episodeIdx: 0,
        // Car-to-car contact schedule: episode slots where episodeIdx %
        // carContactEvery === 0 run with full contact (collisions + radar);
        // the other slots are GHOST episodes - cars neither see nor hit each
        // other, so route driving is selected on undisturbed, while contact
        // slots keep collision avoidance under selection every generation.
        // (Per-slot, not per-generation: mixing inside the generation keeps
        // elite records and head-to-head comparisons on a stationary scale.)
        carContactEvery: 1, carContact: true,
        dynGrid: null, recordCarIdx: -1, lastRecord: null,
        pedRng: mulberry32(1), epRng: mulberry32(1)
    };
}

// ---------------------------------------------------------------------------
// Spawning / episode setup
// ---------------------------------------------------------------------------

function _jobFor(world, carIdx, jobsDone) {
    // Phases 0-1 use only the shortest jobs (the pool is sorted by route
    // length) so first deliveries are within reach of young populations.
    const n = world.phase <= 1 ? Math.min(24, world.jobs.length) : world.jobs.length;
    return world.jobs[(carIdx * 7 + jobsDone * 11 + world.episodeIdx * 13) % n];
}

function _newCar(idx, genome) {
    return {
        idx, genome,
        x: 0, y: 0, theta: 0, v: 0,
        steer: 0, throttle: 0, rawSteer: 0, rawThrottle: 0,
        alive: true, retired: null,
        inp: new Float64Array(NN_IN),
        route: null, routeIdx: 0, maxRouteDist: 0, nextLightIdx: 0,
        carrying: false, job: null, jobsDone: 0, leg: 'toDelivery', curPickupEarned: 0,
        offRouteTicks: 0, replanCooldown: 0,
        dwell: 0,
        progressTimer: 0, lastProgress: 0, sinceProgress: 0,
        coverageBase: 0, legCoverage: 0, legMisses: 0, lastFollow: null,
        approachBase: 0, legApproachMax: 0, _minTD: Infinity, _minTDv: 0, legStartDist: 0,
        bestRemain: Infinity, legRampPaid: 0,
        _frontCarPx: SENSOR_RANGE, _frontPedPx: SENSOR_RANGE,
        m: { deliveries: 0, pickups: 0, pickupEarned: 0, legProgress: 0, coverage: 0, approach: 0, distance: 0, carColl: 0, carCollFault: 0, pedColl: 0, crash: 0, wrongSideSec: 0, redLightRuns: 0, replans: 0, misses: 0, repeatMisses: 0 }
    };
}

function _setRoute(car, route) {
    car.route = route;
    car.routeIdx = 0;
    car.maxRouteDist = 0;
    car.nextLightIdx = 0;
    car.lastProgress = 0;
    car.progressTimer = 0;
    car.offRouteTicks = 0;
    car.lastFollow = null;
}

function _routeCoverage(car) {
    if (!car.route || car.route.total <= 0) return 0;
    return clamp(car.maxRouteDist / car.route.total, 0, 1);
}

// Approach credit [0,1] for the best attempt at the current leg's door:
// closest point reached, weighted by how slowly it was passed. This is the
// smooth ladder between "blast past the door at cruise speed" (0) and a
// registered standstill stop (1) - without it the step from full route
// coverage to a completed delivery is a reward cliff evolution never crossed.
function _approachOf(minTD, vAt) {
    if (!isFinite(minTD)) return 0;
    return clamp(1 - minTD / 60, 0, 1) * clamp(1 - vAt / 80, 0, 1);
}

// Coverage credit for the CURRENT leg, capped at 1: replans within a leg bank
// progress into legCoverage, but re-driving replanned loop routes can never
// pay more than reaching the door once would. Without the cap, orbiting a
// missed target farmed +1 coverage per lap.
function _legCoverageNow(car) {
    return Math.min(1, car.legCoverage + _routeCoverage(car));
}

// Evenly distributed spawn slots along every lane of the road network (both
// travel directions of every edge), spaced total/count apart with a seeded
// start offset. Guarantees separated spawns - important now that car-car
// contact is fatal.
function _spawnSlots(world, count, rng) {
    const town = world.town;
    const lanes = [];
    let total = 0;
    for (const e of town.edges) {
        const trim = Math.min(NODE_HALF, e.len * 0.33);
        const lo = trim + 20, hi = e.len - trim - 20;
        if (hi <= lo) continue;
        // One-way streets spawn a single lane in the legal direction.
        for (const sign of (e.oneway ? [1] : [1, -1])) {
            lanes.push({ e, sign, lo, hi, len: hi - lo, start: total });
            total += hi - lo;
        }
    }
    const slots = [];
    if (!lanes.length || total <= 0) return slots;
    const spacing = total / count;
    let pos = rng() * spacing;
    let li = 0;
    for (let i = 0; i < count; i++) {
        while (li < lanes.length - 1 && pos >= lanes[li].start + lanes[li].len) li++;
        const L = lanes[li];
        const s = L.lo + clamp(pos - L.start, 0, L.len);
        const q = edgePointAt(L.e, L.sign > 0 ? s : L.e.len - s);
        const tx = q.tx * L.sign, ty = q.ty * L.sign;
        const rn = rightNormal(tx, ty);
        slots.push({
            x: q.x + rn.x * L.e.laneOff, y: q.y + rn.y * L.e.laneOff,
            dirX: tx, dirY: ty, edgeId: L.e.id
        });
        pos += spacing;
    }
    return slots;
}

// Nearest door among the phase-limited job pool - doorKey picks whether the
// car heads for the job's restaurant ('restIdx', spawn-empty phases) or its
// home ('homeIdx', spawn-carrying phase 0). Since U-turns are banned, a door
// BEHIND the spawn direction really means a long loop around the block - so
// behind doors carry a heavy score penalty and ahead ones win.
function _jobForNearest(world, slot, doorKey) {
    const n = world.phase <= 1 ? Math.min(24, world.jobs.length) : world.jobs.length;
    let best = null, bestScore = Infinity;
    for (let j = 0; j < n; j++) {
        const lane = world.town.buildings[world.jobs[j][doorKey]].lane;
        const vx = lane.x - slot.x, vy = lane.y - slot.y;
        const behind = (vx * slot.dirX + vy * slot.dirY) < -20;
        // Note: a door right at the spawn slot means a near-free pickup. That
        // was measured to be a NECESSARY curriculum rung, not just noise -
        // banning doors within 60px collapsed learning on 2/3 benchmark
        // seeds (champions ~600 vs ~6000+), because delivery-leg driving is
        // first learned by lineages that start at a door.
        const score = Math.sqrt(dist2(lane.x, lane.y, slot.x, slot.y)) + (behind ? 600 : 0);
        if (score < bestScore) { bestScore = score; best = world.jobs[j]; }
    }
    return best;
}

function startEpisode(world, genomes, phase, episodeIdx, epSeed) {
    world.phase = phase;
    world.episodeIdx = episodeIdx;
    world.carContact = (episodeIdx % Math.max(1, Math.round(world.carContactEvery || 1))) === 0;
    world.simTime = 0;
    world.tick = 0;
    world.epRng = mulberry32(mixSeed(epSeed, episodeIdx, 0xE915));
    world.pedRng = mulberry32(mixSeed(epSeed, episodeIdx, 0x9ED5));
    world.cars = [];
    const rng = world.epRng;
    // Everyone spawns on an evenly distributed lane slot, aligned with the
    // lane direction. Phase 0 spawns cars ALREADY CARRYING with the nearest
    // home door as target: the terminal skill (drive a leg, then a registered
    // standstill at the door) is trained directly before the full
    // pickup->delivery chain is asked for. Phase 1 spawns empty aiming at the
    // nearest short-route pickup; phase 2 rotates jobs across the full pool.
    const slots = _spawnSlots(world, genomes.length, rng);
    for (let i = 0; i < genomes.length; i++) {
        const car = _newCar(i, genomes[i]);
        const slot = slots[i % Math.max(1, slots.length)];
        const carrySpawn = phase === 0;
        const job = (phase <= 1 ? _jobForNearest(world, slot, carrySpawn ? 'homeIdx' : 'restIdx') : null)
            || _jobFor(world, i, 0);
        car.job = job;
        car.x = slot.x;
        car.y = slot.y;
        car.theta = Math.atan2(slot.dirY, slot.dirX);
        car.carrying = carrySpawn;      // phase 0: no pickup credit at stake,
        car.leg = carrySpawn ? 'toDelivery' : 'toPickup';   // the 10k IS the carrot
        const door = world.town.buildings[carrySpawn ? job.homeIdx : job.restIdx].lane;
        const route = buildRoute(world.town, slot, door);
        if (route) {
            _setRoute(car, route);
        } else {
            // Should not happen on a connected graph; retire cleanly if it does.
            _setRoute(car, job.route);
            _retire(car, 'stuck');
        }
        car.legStartDist = car.route ? car.route.total : 0;
        // Arm the progress ramp for the first leg - every leg pays it.
        car.bestRemain = car.route ? car.route.total : Infinity;
        car.legRampPaid = 0;
        world.cars.push(car);
    }
    _spawnPeds(world);
}

// ---------------------------------------------------------------------------
// Pedestrians: wander block sidewalk loops, cross at intersection corners.
// ---------------------------------------------------------------------------

function _townCrossings(town) {
    if (town._crossings) return town._crossings;
    const cross = [];   // {a:{loop,corner}, b:{loop,corner}, node, axis}
    const loops = town.sidewalkLoops;
    for (let la = 0; la < loops.length; la++) {
        for (let ca = 0; ca < 4; ca++) {
            const p = loops[la].pts[ca];
            for (let lb = la + 1; lb < loops.length; lb++) {
                for (let cb = 0; cb < 4; cb++) {
                    const q = loops[lb].pts[cb];
                    const dx = Math.abs(p.x - q.x), dy = Math.abs(p.y - q.y);
                    const roadSpan = 2 * (ROAD_HALF + SIDEWALK_W) + 6;
                    if ((dx < 6 && dy > 8 && dy < roadSpan) || (dy < 6 && dx > 8 && dx < roadSpan)) {
                        // Find nearest node to the midpoint (for light checks).
                        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
                        let node = null, best = Infinity;
                        for (const n of town.nodes) {
                            const d = dist2(n.x, n.y, mx, my);
                            if (d < best) { best = d; node = n; }
                        }
                        // Crossing a horizontal road (dy spans it) blocks 'h' traffic and vice versa.
                        cross.push({ a: { loop: la, corner: ca }, b: { loop: lb, corner: cb }, node, axis: dy > dx ? 'h' : 'v' });
                    }
                }
            }
        }
    }
    town._crossings = cross;
    return cross;
}

function _spawnPeds(world) {
    world.peds = [];
    const loops = world.town.sidewalkLoops;
    if (!loops.length) return;
    _townCrossings(world.town);
    const rng = world.pedRng;
    for (let i = 0; i < N_PEDS; i++) {
        const loop = Math.floor(rng() * loops.length);
        world.peds.push(_newPedOnLoop(world, loop, rng));
    }
}

function _newPedOnLoop(world, loopIdx, rng) {
    const pts = world.town.sidewalkLoops[loopIdx].pts;
    const seg = Math.floor(rng() * 4);
    const t = rng();
    const A = pts[seg], B = pts[(seg + 1) % 4];
    return {
        loop: loopIdx, seg, t, dir: rng() < 0.5 ? 1 : -1,
        x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t,
        crossing: null, wait: 0
    };
}

// True while a ped should hold the curb: at lit nodes whenever the cars'
// light isn't red, and anywhere while a MOVING car is near the crossing
// (140px - one sensor range, so any car that close can see the ped it must
// brake for). Stopped traffic counts as yielding and may be crossed in
// front of. Without this look-both-ways rule peds step blindly into traffic,
// and with fatal ped hits that executed even careful drivers at random.
function _crossingBlocked(world, c) {
    if (c.node.light && lightStateAt(c.node, c.axis, world.simTime) !== 'red') return true;
    const mx = (c.fx + c.tx) / 2, my = (c.fy + c.ty) / 2;
    for (const car of world.cars) {
        if (!car.alive) continue;
        // Never step off directly in front of a bumper, even a stopped one:
        // endless ped streams would pin a politely yielding car forever.
        if (dist2(car.x, car.y, mx, my) < 55 * 55) return true;
        if (Math.abs(car.v) >= 15 && dist2(car.x, car.y, mx, my) < 140 * 140) return true;
    }
    return false;
}

function _stepPeds(world, dt) {
    const town = world.town;
    const rng = world.pedRng;
    for (const p of world.peds) {
        if (p.crossing) {
            const c = p.crossing;
            if (p.wait > 0) {
                // Curb wait: re-check every tick; already-crossing peds keep
                // walking and approaching cars must brake for them.
                if (_crossingBlocked(world, c)) { p.wait = 0.4; continue; }
                p.wait = 0;
            }
            const len = Math.hypot(c.tx - c.fx, c.ty - c.fy) || 1;
            c.t += (PED_SPEED * dt) / len;
            if (c.t >= 1) {
                p.loop = c.toLoop; p.seg = c.toCorner; p.t = 0; p.crossing = null;
                p.x = c.tx; p.y = c.ty;
            } else {
                p.x = c.fx + (c.tx - c.fx) * c.t;
                p.y = c.fy + (c.ty - c.fy) * c.t;
            }
            continue;
        }
        const pts = town.sidewalkLoops[p.loop].pts;
        const from = pts[p.seg], to = pts[(p.seg + (p.dir === 1 ? 1 : 3)) % 4];
        const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        p.t += (PED_SPEED * dt) / len;
        if (p.t >= 1) {
            p.seg = (p.seg + (p.dir === 1 ? 1 : 3)) % 4;
            p.t = 0;
            // Maybe cross at this corner.
            if (rng() < 0.35) {
                const corner = p.seg;
                for (const c of town._crossings) {
                    let from2 = null, to2 = null;
                    if (c.a.loop === p.loop && c.a.corner === corner) { from2 = c.a; to2 = c.b; }
                    else if (c.b.loop === p.loop && c.b.corner === corner) { from2 = c.b; to2 = c.a; }
                    if (!from2) continue;
                    const fp = town.sidewalkLoops[from2.loop].pts[from2.corner];
                    const tp = town.sidewalkLoops[to2.loop].pts[to2.corner];
                    p.crossing = {
                        fx: fp.x, fy: fp.y, tx: tp.x, ty: tp.y, t: 0,
                        toLoop: to2.loop, toCorner: to2.corner, node: c.node, axis: c.axis
                    };
                    if (_crossingBlocked(world, p.crossing)) p.wait = 0.4;
                    break;
                }
            }
        } else {
            p.x = from.x + (to.x - from.x) * p.t;
            p.y = from.y + (to.y - from.y) * p.t;
        }
    }
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------

function _rebuildDynGrid(world) {
    const g = world.town.grid;
    const cells = new Array(g.gw * g.gh);
    for (const car of world.cars) {
        if (!car.alive) continue;   // eliminated ghosts are invisible to sensors
        const cx = Math.floor(car.x / g.cell), cy = Math.floor(car.y / g.cell);
        if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) continue;
        const k = cy * g.gw + cx;
        (cells[k] || (cells[k] = [])).push(car);
    }
    world.dynGrid = cells;
}

function _rayCircle(px, py, dx, dy, cx, cy, r, maxT) {
    const ox = cx - px, oy = cy - py;
    const b = ox * dx + oy * dy;
    if (b < 0) return -1;
    const d2 = ox * ox + oy * oy - b * b;
    const r2 = r * r;
    if (d2 > r2) return -1;
    const t = b - Math.sqrt(r2 - d2);
    return (t >= 0 && t <= maxT) ? t : -1;
}

function _rayAABB(px, py, dx, dy, x0, y0, x1, y1, maxT) {
    let tmin = 0, tmax = maxT;
    if (Math.abs(dx) < 1e-9) {
        if (px < x0 || px > x1) return -1;
    } else {
        let t1 = (x0 - px) / dx, t2 = (x1 - px) / dx;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return -1;
    }
    if (Math.abs(dy) < 1e-9) {
        if (py < y0 || py > y1) return -1;
    } else {
        let t1 = (y0 - py) / dy, t2 = (y1 - py) / dy;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return -1;
    }
    return tmin;
}

// Cast one ray, filling nearest-hit distances per category into res
// {wall, car, tree, person}. Distances start at SENSOR_RANGE.
function _castRay(world, self, px, py, angle, res) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const town = world.town;
    // Map border counts as wall.
    let tb = SENSOR_RANGE;
    if (dx > 1e-9) tb = Math.min(tb, (town.W - px) / dx);
    else if (dx < -1e-9) tb = Math.min(tb, -px / dx);
    if (dy > 1e-9) tb = Math.min(tb, (town.H - py) / dy);
    else if (dy < -1e-9) tb = Math.min(tb, -py / dy);
    if (tb >= 0 && tb < res.wall) res.wall = tb;

    // Walk static grid cells along the ray.
    const g = town.grid;
    const steps = Math.ceil(SENSOR_RANGE / g.cell) + 1;
    let lastKey = -1;
    for (let s = 0; s <= steps; s++) {
        const t = Math.min(s * g.cell, SENSOR_RANGE);
        const cx = Math.floor((px + dx * t) / g.cell), cy = Math.floor((py + dy * t) / g.cell);
        if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) continue;
        const key = cy * g.gw + cx;
        if (key === lastKey) continue;
        lastKey = key;
        const items = g.cells[key];
        if (items) {
            for (const it of items) {
                // Trees stay fatal to TOUCH but are not sensed: they only
                // stand on grass, and grass already kills first, so a tree
                // ray channel carried nothing but noise (removed in v2).
                if (it.type === 'wall') {
                    const hit = _rayAABB(px, py, dx, dy, it.x0, it.y0, it.x1, it.y1, SENSOR_RANGE);
                    if (hit >= 0 && hit < res.wall) res.wall = hit;
                }
            }
        }
        const dyn = world.dynGrid && world.dynGrid[key];
        if (dyn) {
            for (const oc of dyn) {
                if (oc === self) continue;
                const hit = _rayCircle(px, py, dx, dy, oc.x, oc.y, 8, SENSOR_RANGE);
                if (hit >= 0 && hit < res.car) res.car = hit;
            }
        }
    }
    // Pedestrians: few enough to test directly.
    for (const p of world.peds) {
        const hit = _rayCircle(px, py, dx, dy, p.x, p.y, PED_R, SENSOR_RANGE);
        if (hit >= 0 && hit < res.person) res.person = hit;
    }
}

const _rayRes = { wall: 0, car: 0, person: 0 };

function computeInputs(world, car) {
    const inp = car.inp;
    let fCar = SENSOR_RANGE, fPed = SENSOR_RANGE;
    for (let r = 0; r < N_RAYS; r++) {
        _rayRes.wall = SENSOR_RANGE; _rayRes.car = SENSOR_RANGE;
        _rayRes.person = SENSOR_RANGE;
        _castRay(world, car, car.x, car.y, car.theta + r * (2 * Math.PI / N_RAYS), _rayRes);
        // ONE type-blind channel per ray (v5): every obstacle kind is equally
        // fatal, so the net just sees the distance to the nearest object of
        // any kind. Ghost episodes leave other cars out entirely (invisible
        // AND intangible - the net drives as if the roads were empty).
        const carD = world.carContact ? _rayRes.car : SENSOR_RANGE;
        inp[r] = Math.min(_rayRes.wall, carD, _rayRes.person) / SENSOR_RANGE;
        // The progress watchdog still needs to know whether the car is held
        // up by TRAFFIC (queues/yielding pause the timer) rather than by a
        // wall (genuinely stuck - times out), so the per-category distances
        // of the three forward rays are kept internally, off the NN inputs.
        if (r === 0 || r === 1 || r === N_RAYS - 1) {
            if (carD < fCar) fCar = carD;
            if (_rayRes.person < fPed) fPed = _rayRes.person;
        }
    }
    car._frontCarPx = fCar;
    car._frontPedPx = fPed;
    inp[14] = car.v / CAR_MAXV;
    const f = followRoute(car.route, car);
    car.lastFollow = f;
    inp[15] = Math.sin(f.headingErr);
    inp[16] = Math.cos(f.headingErr);
    inp[17] = clamp(f.crossTrack / 68, -1, 1);
    inp[18] = clamp(f.wpDist / 300, 0, 1);
    inp[19] = -f.turn1 / Math.PI;         // + = left turn ahead
    inp[20] = -f.turn2 / Math.PI;
    inp[21] = f.remainFrac;
    inp[22] = car.carrying ? 1 : 0;
    const light = routeLightAhead(world.town, car.route, f.routeDist, world.simTime, 200);
    if (light && light.state !== 'green') {
        inp[23] = light.dist / 200;
        inp[24] = light.state === 'red' ? 1 : 0.5;
    } else {
        inp[23] = 1;
        inp[24] = 0;
    }
    // Lawfully holding at a red must not look like stagnation: reds last up
    // to 10s and running them is fatal, so the progress watchdog pauses while
    // the car waits near a non-green light (it resumes every green phase, so
    // true stagnators still time out).
    car._lightWait = !!(light && light.state !== 'green' && light.dist < 90);
    inp[25] = car.x / world.town.W;
    inp[26] = car.y / world.town.H;
    inp[27] = Math.sin(car.theta);
    inp[28] = Math.cos(car.theta);
    inp[29] = car.steer;
    inp[30] = car.throttle;
    const lane = lanePosition(world.town, car.x, car.y, Math.cos(car.theta), Math.sin(car.theta));
    inp[31] = lane.lane;
    car._lane = lane;
    // Dwell progress: rises 0->1 while a pickup/delivery registers, snaps
    // back to 0 the moment the job advances - a direct "stop is done, GO"
    // signal the net can learn to release the brake on.
    inp[32] = clamp(car.dwell / ARRIVE_DWELL, 0, 1);
    return f;
}

// ---------------------------------------------------------------------------
// Per-tick world update
// ---------------------------------------------------------------------------

function _checkStaticCrash(world, car) {
    const town = world.town;
    const c = Math.cos(car.theta), s = Math.sin(car.theta);
    const hl = CAR_LEN / 2, hw = CAR_W / 2;
    for (let k = 0; k < 4; k++) {
        const lx = (k & 1) ? -hl : hl;
        const ly = (k & 2) ? -hw : hw;
        const px = car.x + lx * c - ly * s;
        const py = car.y + lx * s + ly * c;
        if (px < 0 || py < 0 || px > town.W || py > town.H) return true;
        const items = townCellItems(town, px, py);
        if (!items) continue;
        for (const it of items) {
            if (it.type === 'wall') {
                if (px >= it.x0 && px <= it.x1 && py >= it.y0 && py <= it.y1) return true;
            } else if (it.type === 'tree') {
                const dr = it.r + 1;
                if (dist2(px, py, it.x, it.y) < dr * dr) return true;
            }
        }
    }
    return false;
}

function _retire(car, why) {
    // ANY end while still holding food - timeout, wall, grass, red light,
    // pedestrian, collision - forfeits that pickup's credit. It used to
    // survive death (only parking forfeited), which made a fast crash at the
    // door out-score slowing down by up to ~1700 points: the selected
    // phenotype was the kamikaze courier. Now the pickup pays out durably
    // only through a delivery or by still holding the food when the episode
    // clock runs out - staying alive strictly dominates dying.
    if (car.carrying && car.m) {
        car.m.pickupEarned = Math.max(0, car.m.pickupEarned - car.curPickupEarned);
        car.curPickupEarned = 0;
    }
    car.alive = false;
    car.retired = why;
    car.v = 0;
}

// Car-car contact via two-circle capsules (front/rear circles r=5 at +/-4
// along the heading). A single fat circle read opposite-lane passing - lane
// centers sit only 17px apart - as a crash; capsules match the 18x9 body
// closely enough that correct two-way traffic clears with room to spare
// while nose contact at any angle still registers.
const CAR_HIT_R = 5, CAR_HIT_OFF = CAR_LEN / 2 - CAR_HIT_R;
function _carsTouch(a, b) {
    const ax = Math.cos(a.theta) * CAR_HIT_OFF, ay = Math.sin(a.theta) * CAR_HIT_OFF;
    const bx = Math.cos(b.theta) * CAR_HIT_OFF, by = Math.sin(b.theta) * CAR_HIT_OFF;
    const rr = (2 * CAR_HIT_R) * (2 * CAR_HIT_R);
    for (let i = -1; i <= 1; i += 2) {
        for (let j = -1; j <= 1; j += 2) {
            if (dist2(a.x + ax * i, a.y + ay * i, b.x + bx * j, b.y + by * j) < rr) return true;
        }
    }
    return false;
}

function _advanceJob(world, car) {
    // Arrived: complete the current leg and start the next one.
    car.coverageBase += _legCoverageNow(car);
    car.legCoverage = 0;
    car.legMisses = 0;
    car.approachBase += 1;          // a registered stop is a perfect approach
    car.legApproachMax = 0;
    car._minTD = Infinity;
    if (car.leg === 'toPickup') {
        car.m.pickups++;
        // Pickup fitness scales with the distance actually driven to earn it:
        // near-spawn "free" pickups stay as the curriculum rung that teaches
        // the standstill stop, but at 0.15x they can no longer out-score
        // honest route driving (which the flat 2000 reward used to do -
        // statue lineages parked at lucky doors dominated every roster).
        const earned = clamp(car.legStartDist / 150, 0.15, 1);
        car.m.pickupEarned += earned;
        car.curPickupEarned = earned;
        car.carrying = true;
        car.leg = 'toDelivery';
        // The precomputed job route starts exactly at the pickup door lane.
        _setRoute(car, car.job.route);
        car.legStartDist = car.route.total;
        car.bestRemain = car.route.total;   // re-arm the progress ramp
        car.legRampPaid = 0;
    } else {
        car.m.deliveries++;
        car.carrying = false;
        car.curPickupEarned = 0;
        car.jobsDone++;
        // The home's stored lane point (with edge id) is where the car is now.
        const homeLane = world.town.buildings[car.job.homeIdx].lane;
        // Curriculum phases keep CHAIN legs short too: the next restaurant is
        // the nearest one ahead, like the spawn assignment. Rotation-assigned
        // next jobs sat 700-950px across town - a difficulty cliff right
        // after a delivery; probes showed cars driving 1+ leg-lengths toward
        // them and dying or expiring, so pickups never happened ("1 delivery
        // wall"). Phase 2 keeps the full rotation.
        const nextJob = (world.phase <= 1
            ? _jobForNearest(world, { x: homeLane.x, y: homeLane.y, dirX: Math.cos(car.theta), dirY: Math.sin(car.theta) }, 'restIdx')
            : null) || _jobFor(world, car.idx, car.jobsDone);
        car.job = nextJob;
        car.leg = 'toPickup';
        const route = buildRoute(world.town, homeLane, world.town.buildings[nextJob.restIdx].lane);
        if (route) {
            _setRoute(car, route);
            car.legStartDist = route.total;
            car.bestRemain = route.total;   // re-arm the progress ramp
            car.legRampPaid = 0;
        } else _retire(car, 'stuck');
    }
    car.dwell = 0;
}

function stepWorld(world) {
    const dt = DT;
    world.tick++;
    world.simTime += dt;
    const nnTick = (world.tick % NN_EVERY) === 0;
    if (nnTick) _rebuildDynGrid(world);

    _stepPeds(world, dt);

    let anyAlive = false;
    for (const car of world.cars) {
        if (!car.alive) continue;
        anyAlive = true;

        if (nnTick) {
            const f = computeInputs(world, car);
            let record = null;
            if (car.idx === world.recordCarIdx) record = new Array(NN_ARCH.length);
            const out = nnForward(car.genome, car.inp, record);
            if (record) world.lastRecord = record;
            car.rawSteer = out[0];
            car.rawThrottle = out[1];

            // Red-light crossing check against route stop lines. Running a
            // red is FATAL (plus its fitness penalty). This must stay BEFORE
            // the replan block: f.routeDist is measured along the route these
            // stop lines belong to, while a replan swaps car.route and resets
            // nextLightIdx - checking afterwards would compare an old-route
            // distance against the new route's lights from index 0 and kill
            // the car at lights it never reached.
            const rd = f.routeDist;
            const lights = car.route.lights;
            while (car.nextLightIdx < lights.length && rd > lights[car.nextLightIdx].dist + 4) {
                const L = lights[car.nextLightIdx];
                const node = world.town.nodes[L.nodeId];
                car.nextLightIdx++;
                if (lightRedAge(node, L.axis, world.simTime) > RED_GRACE) {
                    car.m.redLightRuns++;
                    _retire(car, 'redlight');
                    break;
                }
            }
            if (!car.alive) continue;

            // Off-route detection -> replan with hysteresis + cooldown. A car
            // mid-dwell at its target is delivering, not lost - never let an
            // overshoot replan race an in-progress pickup/delivery.
            if (f.offRoute && car.dwell <= 0) car.offRouteTicks++;
            else car.offRouteTicks = 0;
            if (car.offRouteTicks >= OFFROUTE_TICKS && car.replanCooldown <= 0) {
                car.m.replans++;
                car.legCoverage = _legCoverageNow(car);
                const target = car.leg === 'toPickup'
                    ? world.town.buildings[car.job.restIdx].lane
                    : world.town.buildings[car.job.homeIdx].lane;
                // Needing a reroute while already at the door = a missed
                // pickup/delivery attempt (overshot it or slid off beside it).
                // The coverage clause makes fast overshoots speed-independent:
                // every route ends AT the door, so >=92% covered means the
                // approach itself failed even if momentum carried the car far.
                // Repeat misses on the SAME stop (circling the block) are
                // tracked separately and cost far more fitness than the first.
                const tp = car.route.target;
                if (dist2(car.x, car.y, tp.x, tp.y) < MISS_DIST * MISS_DIST ||
                    _routeCoverage(car) >= 0.92) {
                    car.m.misses++;
                    car.legMisses++;
                    if (car.legMisses > 1) car.m.repeatMisses++;
                }
                // Bank this attempt's approach credit (per-leg MAX, so
                // orbiting a missed door cannot farm it) and rearm.
                car.legApproachMax = Math.max(car.legApproachMax, _approachOf(car._minTD, car._minTDv));
                car._minTD = Infinity;
                const start = nearestLanePoint(world.town, car.x, car.y, Math.cos(car.theta), Math.sin(car.theta));
                const route = start ? buildRoute(world.town, start, target) : null;
                if (route) _setRoute(car, route);
                else car.offRouteTicks = 0;   // keep the old route, try again later
                car.replanCooldown = REPLAN_COOLDOWN;
            }

            // Wrong-side accounting (NN tick covers 3 physics ticks). Driving
            // against a one-way street counts the same way (lane reads -1).
            if (car._lane && car._lane.onRoad && (car._lane.lane < -0.15 || car._lane.wrongWay)) {
                car.m.wrongSideSec += dt * NN_EVERY;
            }
        }
        car.replanCooldown -= dt;

        // Smooth applied actions toward the latest raw NN outputs.
        car.steer += ACTION_SMOOTH * (car.rawSteer - car.steer);
        car.throttle += ACTION_SMOOTH * (car.rawThrottle - car.throttle);

        // Kinematic bicycle.
        const accel = car.throttle > 0 ? car.throttle * CAR_ACCEL : car.throttle * CAR_BRAKE;
        car.v += accel * dt;
        car.v *= (1 - 0.6 * dt);
        car.v = clamp(car.v, -CAR_MAXREV, CAR_MAXV);
        // Stiction / parking brake: gentle brake or neutral at low speed pins
        // a true standstill. Deliveries REQUIRE |v|<6, and without this the
        // net had to hold an exact zero - any brake residue at v~0
        // accelerates backwards out of the arrival band, which kept the
        // whole population from ever registering stops from a moving
        // approach. A firm reverse (throttle < -0.15) still backs out.
        if (Math.abs(car.v) < 12 && car.throttle <= 0.02 && car.throttle > -0.15) car.v = 0;
        car.theta += (car.v / WHEELBASE) * Math.tan(car.steer * MAX_STEER) * dt;
        car.theta = wrapAngle(car.theta);
        car.x += Math.cos(car.theta) * car.v * dt;
        car.y += Math.sin(car.theta) * car.v * dt;
        car.m.distance += Math.abs(car.v) * dt;

        // Fatal static collisions.
        if (_checkStaticCrash(world, car)) {
            car.m.crash = 1;
            _retire(car, 'crash');
            continue;
        }

        // Leaving the road is immediately fatal: the car center may use the
        // asphalt plus a small shoulder tolerance, nothing more. Slim one-way
        // streets use their own (narrower) width.
        const lp = lanePosition(world.town, car.x, car.y, Math.cos(car.theta), Math.sin(car.theta));
        car._lane = lp;
        if (!(lp.dist <= lp.halfW + 4)) {      // covers Infinity (no road here)
            car.m.crash = 1;
            _retire(car, 'grass');
            continue;
        }

        // Progress watchdog (route distance must keep growing). Time spent
        // lawfully waiting - holding for a red, boxed in behind another car,
        // or yielding to a pedestrian - never counts toward the stagnation
        // limit: queues under fatal rules would otherwise be executions.
        // A single absolute ceiling still guarantees that genuine gridlock
        // (and frozen-eval episodes) always resolve.
        if (car.maxRouteDist > car.lastProgress + 4) {
            car.lastProgress = car.maxRouteDist;
            car.progressTimer = 0;
            car.sinceProgress = 0;
        } else {
            car.sinceProgress += dt;
            const held = (car._frontCarPx < 34 || car._frontPedPx < 40 || car._lightWait) &&
                Math.abs(car.v) < 30;
            if (!held) car.progressTimer += dt;
            if (car.progressTimer > NOPROGRESS_TIMEOUT || car.sinceProgress > NOPROGRESS_ABS) {
                _retire(car, 'timeout'); continue;   // _retire forfeits any carried pickup
            }
        }

        // Leg progress ramp: pay for every px the car gets CLOSER to its
        // current door than it has ever been this leg (leg-best remaining
        // route distance). The dense gradient toward pickups AND deliveries -
        // door-side shaping alone (~250 approach) sat an order of magnitude
        // below run-to-run traffic noise and the frontier stalled. A replan
        // onto a longer loop pays nothing until the old best is beaten, so
        // orbiting can't farm it, and a new leg only starts via a registered
        // standstill, so leg-cycling can't either.
        if (car.route) {
            const remain = Math.max(0, car.route.total - car.maxRouteDist);
            if (remain < car.bestRemain) {
                const gain = Math.min(car.bestRemain - remain, RAMP_PAY_CAP - car.legRampPaid);
                if (gain > 0) { car.legRampPaid += gain; car.m.legProgress += gain; }
                car.bestRemain = remain;
            }
        }

        // Pickup / delivery dwell + approach tracking (closest point to the
        // current door and the speed it was passed at).
        const target = car.route.target;
        const d2t = dist2(car.x, car.y, target.x, target.y);
        const dtd = Math.sqrt(d2t);
        if (dtd < car._minTD) { car._minTD = dtd; car._minTDv = Math.abs(car.v); }
        car.m.approach = car.approachBase +
            Math.max(car.legApproachMax, _approachOf(car._minTD, car._minTDv));
        if (d2t < ARRIVE_RADIUS * ARRIVE_RADIUS && Math.abs(car.v) < ARRIVE_SPEED) {
            car.dwell += dt;
            if (car.dwell >= ARRIVE_DWELL) _advanceJob(world, car);
        } else {
            car.dwell = 0;
        }

    }

    // Dynamic collisions: car-car contact eliminates BOTH cars on the spot
    // (skipped entirely in ghost episodes - cars pass through each other);
    // hitting a pedestrian is heavily penalized (the ped respawns elsewhere).
    for (let i = 0; i < world.cars.length; i++) {
        const a = world.cars[i];
        if (!a.alive) continue;
        if (world.carContact) for (let j = i + 1; j < world.cars.length; j++) {
            const b = world.cars[j];
            if (!b.alive) continue;
            if (dist2(a.x, a.y, b.x, b.y) < 20 * 20 && _carsTouch(a, b)) {
                // Fault attribution for mostly head-on crashes (headings more
                // than ~120 deg apart): the car in its legal right lane bears
                // a reduced fitness penalty, the wrong-side driver a heavier
                // one. Ambiguous geometry (rear-end, side impacts, off-road,
                // near the centerline) stays symmetric.
                let fa = 1, fb = 1;
                if (Math.cos(a.theta - b.theta) < -0.5 && a._lane && b._lane) {
                    const right = l => l.onRoad && !l.wrongWay && l.lane > 0.15;
                    const wrong = l => l.onRoad && (l.wrongWay || (!(l.edge && l.edge.oneway) && l.lane < -0.15));
                    if (right(a._lane) && wrong(b._lane)) { fa = 0.35; fb = 2.0; }
                    else if (right(b._lane) && wrong(a._lane)) { fb = 0.35; fa = 2.0; }
                }
                a.m.carColl++; b.m.carColl++;
                a.m.carCollFault += fa;
                b.m.carCollFault += fb;
                _retire(a, 'collision');
                _retire(b, 'collision');
                break;
            }
        }
        if (!a.alive) continue;
        // Hitting a pedestrian is FATAL (plus its heavy fitness penalty);
        // the pedestrian respawns elsewhere. Contact with a standing or
        // creeping car is the ped's blunder, not a hit: the car survives
        // unpenalized - stopping FOR people must remain a safe move.
        // Contact uses the same three-circle capsule as car-car: a single
        // fat circle (10+PED_R = 14px) overlapped the 12.5px lateral gap
        // between a correctly laned car and a law-abiding sidewalk ped, so
        // every legal pass counted as a hit.
        const pcx = Math.cos(a.theta) * CAR_HIT_OFF, pcy = Math.sin(a.theta) * CAR_HIT_OFF;
        const pedRR = (CAR_HIT_R + PED_R) * (CAR_HIT_R + PED_R);
        for (const p of world.peds) {
            if (dist2(a.x, a.y, p.x, p.y) > 26 * 26) continue;
            if (dist2(a.x + pcx, a.y + pcy, p.x, p.y) < pedRR ||
                dist2(a.x - pcx, a.y - pcy, p.x, p.y) < pedRR ||
                dist2(a.x, a.y, p.x, p.y) < pedRR) {
                Object.assign(p, _newPedOnLoop(world, Math.floor(world.pedRng() * world.town.sidewalkLoops.length), world.pedRng));
                if (Math.abs(a.v) >= 15) {
                    a.m.pedColl++;
                    _retire(a, 'pedestrian');
                }
                break;
            }
        }
    }

    // Live coverage metric (completed legs + capped current-leg progress).
    for (const car of world.cars) {
        car.m.coverage = car.coverageBase + _legCoverageNow(car);
    }
    return anyAlive;
}

if (typeof module !== 'undefined') {
    module.exports = {
        DT, NN_EVERY, N_RAYS, SENSOR_RANGE, CAR_LEN, CAR_W, CAR_MAXV,
        createWorld, startEpisode, stepWorld, computeInputs
    };
}
