// The world: vehicles, pedestrians, and everything that can go wrong between
// them. Nothing here is under evolutionary control - drivers and walkers are
// hard-coded, take optimal routes, and obey the law. The ONLY thing the genome
// touches is the signals, so any difference in how many people got where they
// were going is attributable to the controller and nothing else.
//
// Vehicles follow the Intelligent Driver Model, which is the standard
// microscopic car-following law: a free-road acceleration term capped by the
// speed limit, minus an interaction term that grows as the gap to whatever is
// in front closes. Fed to it, in order of nearest-wins, are the car in front,
// the stop line, a pedestrian in the crossing about to be driven over, oncoming
// traffic when turning left across it, and the far side of the junction when
// there is no room to land (the "do not block the box" rule).
//
// Accidents are never scripted. They are what is left over when the signals
// leave two of those things pointing at the same square metre at the same time.
'use strict';

const SIM = {
    DT: 0.1,                 // physics step, seconds
    A_MAX: 1.7,              // comfortable acceleration, m/s^2
    B_COMF: 2.3,             // comfortable deceleration
    B_EMERG: 6.5,            // the most a driver will ever pull
    T_HEAD: 1.15,            // desired time headway
    S0: 2.4,                 // standstill gap
    STOP_DECEL: 3.0,         // the most someone will brake for a fresh amber;
                             // needing more than this IS the dilemma zone
    CRASH_R: 3.3,            // vehicle-to-vehicle conflict radius in the box
    PED_R: 1.7,              // vehicle-to-pedestrian strike radius
    CRASH_CLEAR: 25,         // seconds a wreck blocks the road before it is towed
    MAX_CARS: 300,
    MAX_PEDS: 160,
    YIELD_TTC: 5.0,          // gap a left-turner demands from oncoming traffic
    RING_GAP: 14,            // metres of island a roundabout entry needs clear
    RING_TTC: 3.2,           // ...and seconds before circulating traffic arrives
    SPAWN_GAP: 10
};

function idmAccel(v, v0, gap, dv) {
    if (gap <= 0.05) return -SIM.B_EMERG;
    const sStar = SIM.S0 + Math.max(0, v * SIM.T_HEAD + v * dv / (2 * Math.sqrt(SIM.A_MAX * SIM.B_COMF)));
    const free = 1 - Math.pow(v / v0, 4);
    const inter = (sStar / gap) * (sStar / gap);
    return SIM.A_MAX * (free - inter);
}

// ---------------------------------------------------------------------------
class World {
    constructor(city, opts) {
        this.city = city;
        this.opts = Object.assign({ episodeLen: 240, demand: 1, pedDemand: 1, incidents: true }, opts || {});
        // A bigger city needs a longer episode simply because a trip across it
        // takes longer. Without that, most of the demand physically cannot
        // arrive before the bell whatever the signals do, and "how many got
        // there" stops measuring the controller.
        this.episodeLen = this.opts.episodeLen * (city.spec.timeScale || 1);
        this.lights = city.lightInfo.map(info => createLight(city, info));
        this.linkCars = city.links.map(() => []);
        this.connCars = city.connectors.map(() => []);
        this.cars = [];
        this.peds = [];
        this.ctx = makeContext();
        this.nSig = this.lights.length;
        this.hist = new Int16Array(HIST_LEN * Math.max(1, this.nSig)).fill(-1);
        this.agg = new Float32Array(HIST_LEN * 4);
        this.crossW = new Float64Array(city.nodes.length * 4);
        this.crossI = new Float64Array(city.nodes.length * 4);
        this.crossC = new Float64Array(city.nodes.length * 4);
        this.crossPeds = new Map();
        this.controller = null;
        this.t = 0;
    }

    // --- setup --------------------------------------------------------------
    // Every genome in a generation is handed the SAME city, the SAME schedule of
    // trips and the SAME driver personalities. Common random numbers: without
    // them an eight-episode fitness measures the draw as much as the controller,
    // which is the single mistake that cost the chess sim the most.
    reset(seed, controller) {
        const rng = mulberry32(seed >>> 0);
        this.seed = seed >>> 0;
        this.controller = controller;
        this.t = 0;
        this.histTick = 0;
        this.cars.length = 0;
        this.peds.length = 0;
        this.pending = [];
        this.pendingPed = [];
        this.nextCarId = 1;
        this.nextPedId = 1;
        for (const a of this.linkCars) a.length = 0;
        for (const a of this.connCars) a.length = 0;
        for (const l of this.lights) resetLight(l, rng);
        this.m = {
            carsIn: 0, carsOut: 0, pedsIn: 0, pedsOut: 0,
            carDelay: 0, pedDelay: 0, crashes: 0, pedHits: 0,
            stops: 0, ebrakes: 0, redEntries: 0, throughVeh: 0
        };
        this.buildSchedule(rng);
        // Map features are static for the whole episode, so the two convolution
        // encoders run once per light here and never again.
        if (controller && controller.isBrain) {
            for (const l of this.lights) {
                l.mapFeat = new Float64Array(MAP_OUT);
                encodeMaps(controller.genome, this.city.map.pooled, l.info.ego, l.mapFeat);
            }
        } else {
            for (const l of this.lights) l.mapFeat = new Float64Array(MAP_OUT);
        }
        this.recomputeCrossings();
        for (const l of this.lights) readDetectors(this, l);
        // Prefill the ring so the first thirty seconds of decisions read a
        // plausible past instead of "these lights do not exist".
        for (let i = 0; i < HIST_LEN; i++) this.snapshot(i);
        this.histTick = 0;
        this.incidentsLeft = this.opts.incidents ? (this.city.spec.incident || 0) : 0;
        this.nextIncident = this.incidentsLeft ? 40 + rng() * 60 : Infinity;
        this._incRng = mulberry32(mixSeed(seed, 0x1CD));
        return this;
    }

    // Poisson trip generation between portals. `skew` tilts the origin-
    // destination table toward one axis so a genuine arterial forms; `surge`
    // adds a rush-hour hump in the middle of the episode.
    buildSchedule(rng) {
        const city = this.city, spec = city.spec;
        const portals = city.portals;
        const axis = rng() < 0.5 ? 0 : 1;          // 0 = east-west arterial
        // Which edge of the map each portal sits on, and how popular that edge
        // is as a place to start a journey (`skew` builds an arterial).
        const side = portals.map(p => {
            const n = city.nodes[p];
            return OPP[n.arms.findIndex(a => !!a)];
        });
        const wt = portals.map((p, i) => {
            const horiz = side[i] === 1 || side[i] === 3;
            return 1 + (spec.skew || 0) * ((horiz ? 0 : 1) === axis ? 2 : 0);
        });
        const total = wt.reduce((a, b) => a + b, 0);
        const pick = () => {
            let u = rng() * total;
            for (let i = 0; i < wt.length; i++) { u -= wt[i]; if (u <= 0) return i; }
            return wt.length - 1;
        };
        // Destinations are strongly biased to the OPPOSITE edge of the map.
        //
        // This is the trip table, and it is not a detail. Approaches here have
        // one lane, so a car waiting to turn left holds up everything behind
        // it - which is exactly what happens on a real single-lane approach,
        // and why real junctions get a left-turn pocket. With a uniform trip
        // table a third of all movements are left turns, the queues never clear
        // whatever the signals do, and the controller stops mattering. Real
        // urban grids run roughly 70% through / 15% left / 15% right, and that
        // is what these weights produce.
        const SIDE_W = [0.62, 0.19, 0.19];         // opposite, and the two flanks
        const pickDest = (oi) => {
            const os = side[oi];
            let u = rng(), want;
            if (u < SIDE_W[0]) want = OPP[os];
            else if (u < SIDE_W[0] + SIDE_W[1]) want = (os + 1) % 4;
            else want = (os + 3) % 4;
            const pool = [];
            for (let i = 0; i < portals.length; i++) if (side[i] === want && i !== oi) pool.push(i);
            if (!pool.length) {
                for (let i = 0; i < portals.length; i++) if (i !== oi) pool.push(i);
            }
            return pool[Math.floor(rng() * pool.length)];
        };
        const rateAt = (t) => {
            const base = spec.carRate * this.opts.demand;
            if (!spec.surge) return base;
            const z = (t - this.episodeLen * 0.45) / (this.episodeLen * 0.16);
            return base * (1 + spec.surge * Math.exp(-z * z));
        };

        // New trips stop being generated part way through and the rest of the
        // episode is a drain period. Otherwise a car released in the last ten
        // seconds counts against the controller for not having arrived, which
        // is not a fact about the controller.
        this.demandWindow = this.episodeLen * 0.62;
        this.carSched = [];
        let t = 0;
        while (t < this.demandWindow) {
            t += expDraw(rng, rateAt(t));
            if (t >= this.demandWindow) break;
            const o = pick();
            const d = pickDest(o);
            if (d === o || d === undefined) continue;
            this.carSched.push({ t, o: portals[o], d: portals[d], rng: rng() });
        }
        // Pedestrians take LOCAL trips - a few blocks, the way people actually
        // walk. Portal-to-portal on foot would be a kilometre and could not
        // finish inside an episode, so nobody would ever arrive and the whole
        // pedestrian half of the score would read zero no matter what the
        // signals did.
        this.pedSched = [];
        const nCorners = city.nodes.length * 4;
        const maxWalk = Math.min(this.episodeLen * 0.4, 220);
        t = 0;
        const pedRate = spec.pedRate * this.opts.pedDemand;
        while (t < this.demandWindow && pedRate > 0) {
            t += expDraw(rng, pedRate);
            if (t >= this.demandWindow) break;
            const o = Math.floor(rng() * nCorners);
            let d = -1;
            for (let tries = 0; tries < 24; tries++) {
                const cand = Math.floor(rng() * nCorners);
                if (cand === o) continue;
                const ft = this.pedFreeTime(o, cand);
                if (ft >= 25 && ft <= maxWalk) { d = cand; break; }
            }
            if (d < 0) continue;
            this.pedSched.push({ t, o, d, v: lerp(1.05, 1.6, rng()) });
        }
        this.carIdx = 0; this.pedIdx = 0;
    }

    // --- history ring -------------------------------------------------------
    snapshot(slot) {
        const base = (slot === undefined ? (this.histTick % HIST_LEN) : slot) * this.nSig;
        let ns = 0, ew = 0, ped = 0, q = 0;
        for (let i = 0; i < this.nSig; i++) {
            const l = this.lights[i];
            this.hist[base + i] = packState(l);
            if (l.state === ST.GREEN) {
                if (l.phase === PH.NS) ns++; else if (l.phase === PH.EW) ew++; else ped++;
            }
            for (let k = 0; k < 4; k++) q += l.queue[k];
        }
        const a = (slot === undefined ? (this.histTick % HIST_LEN) : slot) * 4;
        const n = Math.max(1, this.nSig);
        this.agg[a] = ns / n; this.agg[a + 1] = ew / n; this.agg[a + 2] = ped / n;
        this.agg[a + 3] = Math.min(1, q / (n * 24));
    }

    // Sample index 0 is now; 1..12 are the lag ladder in nn.js.
    histAt(sample, sig) {
        const lag = sample === 0 ? 0 : LAGS[sample - 1];
        const slot = ((this.histTick - lag) % HIST_LEN + HIST_LEN) % HIST_LEN;
        return this.hist[slot * this.nSig + sig];
    }
    aggAt(sample) {
        const lag = sample === 0 ? 0 : LAGS[sample - 1];
        const slot = ((this.histTick - lag) % HIST_LEN + HIST_LEN) % HIST_LEN;
        return this.agg.subarray(slot * 4, slot * 4 + 4);
    }

    // --- geometry helpers ---------------------------------------------------
    // Streets, junction paths and pavements are all polylines, so a bending
    // street costs exactly the same as a straight one here.
    // `lead` is seconds of drawing-only extrapolation, never more than one
    // step. The physics runs at a fixed 0.1s, so at slow playback speeds a step
    // happens once every several frames; coasting each body forward at its own
    // speed in between is what keeps the picture continuous. Nothing in the
    // simulation ever passes it - it cannot affect a decision or a collision.
    carPos(c, lead) {
        const path = c.conn || c.link;
        const s = lead ? Math.min(path.len, c.s + c.v * lead) : c.s;
        return polyAt(path, s);
    }

    pedPos(p, lead) {
        const e = p.edge;
        const s = lead ? Math.min(e.len, p.s + p.v * lead) : p.s;
        return polyAt(e, p.dir > 0 ? s : e.len - s);
    }

    // --- free-flow reference times ------------------------------------------
    // What the trip would have taken with every light green. Delay is measured
    // against this, so a controller is judged on the time it costs people, not
    // on how far they happened to be going.
    carFreeTime(from, to) {
        const city = this.city;
        if (!city._ff) city._ff = new Map();
        const key = from * 4096 + to;
        let v = city._ff.get(key);
        if (v !== undefined) return v;
        let dist = 0, at = from, guard = 0;
        while (at !== to && guard++ < 300) {
            const l = nextLinkTo(city, at, to);
            if (!l) break;
            dist += l.len;
            if (!city.nodes[l.to].portal) dist += 14;   // an average turn through a box
            at = l.to;
        }
        v = dist / ROAD.SPEED;
        city._ff.set(key, v);
        return v;
    }

    pedFreeTime(from, to) {
        const city = this.city, g = city.ped;
        if (!city._pf) city._pf = new Map();
        const key = from * 4096 + to;
        let v = city._pf.get(key);
        if (v !== undefined) return v;
        let dist = 0, at = from, guard = 0, reached = from === to;
        while (at !== to && guard++ < 600) {
            const eid = g.next[at * g.count + to];
            if (eid < 0) break;
            const e = g.edges[eid];
            dist += e.len;
            at = e.a === at ? e.b : e.a;
            if (at === to) reached = true;
        }
        v = reached ? dist / ROAD.WALK : Infinity;
        city._pf.set(key, v);
        return v;
    }

    // --- spawning -----------------------------------------------------------
    releaseCars() {
        while (this.carIdx < this.carSched.length && this.carSched[this.carIdx].t <= this.t) {
            const ev = this.carSched[this.carIdx++];
            this.m.carsIn++;
            this.pending.push({ ev, since: ev.t });
        }
        for (let i = 0; i < this.pending.length; i++) {
            if (this.cars.length >= SIM.MAX_CARS) break;
            const p = this.pending[i];
            const link = this.startLink(p.ev.o);
            if (!link) { this.pending.splice(i--, 1); continue; }
            const arr = this.linkCars[link.id];
            const tail = arr.length ? arr[arr.length - 1] : null;
            if (tail && tail.s < SIM.SPAWN_GAP) continue;      // the road is full
            this.spawnCar(link, p.ev);
            this.pending.splice(i--, 1);
        }
    }

    startLink(portalNode) {
        const n = this.city.nodes[portalNode];
        for (let k = 0; k < 4; k++) if (n.out[k]) return n.out[k];
        return null;
    }

    spawnCar(link, ev) {
        const c = {
            id: this.nextCarId++, link, conn: null, s: 0, v: ROAD.SPEED * 0.75,
            dest: ev.d, spawnT: ev.t, free: this.carFreeTime(ev.o, ev.d),
            nextLink: null, nextConn: null, committed: false, wreck: false,
            wreckUntil: 0, alive: true, moving: true, accel: 0,
            // A little spread in personality: the same layout should not be
            // solvable by memorising one deterministic platoon. The limit is
            // per street, so the ring road really is faster.
            speedFactor: lerp(0.88, 1.06, ev.rng),
            vMax: link.speed * lerp(0.88, 1.06, ev.rng)
        };
        c.vMax = link.speed * c.speedFactor;
        this.planAhead(c);
        this.cars.push(c);
        this.linkCars[link.id].push(c);
    }

    planAhead(c) {
        if (!c.link) return;
        const to = c.link.to;
        if (to === c.dest) { c.nextLink = null; c.nextConn = null; return; }
        const nl = nextLinkTo(this.city, to, c.dest);
        c.nextLink = nl;
        c.nextConn = nl ? c.link.connByArm[nl.arm] : null;
    }

    releasePeds() {
        while (this.pedIdx < this.pedSched.length && this.pedSched[this.pedIdx].t <= this.t) {
            const ev = this.pedSched[this.pedIdx++];
            this.m.pedsIn++;
            if (this.peds.length >= SIM.MAX_PEDS) continue;
            const g = this.city.ped;
            if (g.next[ev.o * g.count + ev.d] < 0) continue;
            const p = {
                id: this.nextPedId++, node: ev.o, dest: ev.d, edge: null, dir: 1, s: 0,
                v: ev.v, spawnT: ev.t, free: this.pedFreeTime(ev.o, ev.d),
                alive: true, waiting: true, hit: false
            };
            this.peds.push(p);
        }
    }

    // --- pedestrian crossing bookkeeping ------------------------------------
    recomputeCrossings() {
        this.crossW.fill(0); this.crossI.fill(0); this.crossC.fill(0);
        this.crossPeds.clear();
        for (const p of this.peds) {
            if (!p.alive) continue;
            if (p.edge && p.edge.type === 'cross') {
                const i = p.edge.node * 4 + p.edge.arm;
                this.crossI[i]++;
                const rem = (p.edge.len - p.s) / p.v;
                if (rem > this.crossC[i]) this.crossC[i] = rem;
                let list = this.crossPeds.get(i);
                if (!list) { list = []; this.crossPeds.set(i, list); }
                list.push(p);
            } else if (p.waiting && p.wantEdge && p.wantEdge.type === 'cross') {
                this.crossW[p.wantEdge.node * 4 + p.wantEdge.arm]++;
            }
        }
    }

    pedAtCrossing(node, arm) {
        const i = node * 4 + arm;
        return { waiting: this.crossW[i], inside: this.crossI[i], clearTime: this.crossC[i] };
    }

    // --- one physics step ---------------------------------------------------
    step(dt) {
        dt = dt || SIM.DT;
        this.t += dt;
        this.releaseCars();
        this.releasePeds();
        this.maybeIncident();
        this.sortLanes();
        this.recomputeCrossings();
        this.stepPeds(dt);
        this.stepCars(dt);
        this.detectCollisions(dt);
        this.stepSignals(dt);
        return this.t < this.episodeLen;
    }

    maybeIncident() {
        if (this.incidentsLeft <= 0 || this.t < this.nextIncident) return;
        this.incidentsLeft--;
        this.nextIncident = this.t + 60 + this._incRng() * 60;
        // A vehicle simply stops dead in the road: no crash, no fault of the
        // signals, but the network has to cope with it.
        const candidates = this.cars.filter(c => c.alive && !c.wreck && c.link && c.s > 20);
        if (!candidates.length) return;
        const victim = candidates[Math.floor(this._incRng() * candidates.length)];
        victim.wreck = true;
        victim.v = 0;
        victim.wreckUntil = this.t + 45;
        victim.incident = true;
    }

    sortLanes() {
        for (const a of this.linkCars) a.length = 0;
        for (const a of this.connCars) a.length = 0;
        for (const c of this.cars) {
            if (!c.alive) continue;
            if (c.conn) this.connCars[c.conn.id].push(c);
            else this.linkCars[c.link.id].push(c);
        }
        // Front of the queue first (largest position along the lane). The index
        // is stashed on the car so the follow model does not have to search the
        // lane for itself on every step.
        for (const a of this.linkCars) {
            if (a.length > 1) a.sort((p, q) => q.s - p.s);
            for (let i = 0; i < a.length; i++) a[i]._idx = i;
        }
        for (const a of this.connCars) {
            if (a.length > 1) a.sort((p, q) => q.s - p.s);
            for (let i = 0; i < a.length; i++) a[i]._idx = i;
        }
    }

    // Does a left-turner have to give way to oncoming traffic right now?
    // On green, yes, to anything arriving inside YIELD_TTC. On amber the
    // oncoming stream is stopping too, so it only waits for a vehicle that is
    // practically on top of it - which is how a real driver waiting in the box
    // gets out on the change. On red it goes, and whether that is safe is
    // entirely down to how much all-red the controller granted.
    leftMustYield(conn, light, node) {
        const opp = node.in[(conn.inArm + 2) % 4];
        if (!opp) return false;
        const sg = armSignal(light, opp.inArm);
        if (sg === 'red') return false;
        // Anything from the opposing approach that is ALREADY in the junction
        // has to be let out first, whatever the signal now says. Missing this
        // is the classic way a left-turner pulls out into a car it can no
        // longer see on the approach because it is past the stop line.
        for (const oc of opp.outConns) {
            if (oc.turn === 'L') continue;
            const inside = this.connCars[oc.id];
            for (const o of inside) if (o.alive && o.s < oc.len * 0.92) return true;
        }
        const ttc = sg === 'amber' ? 1.6 : SIM.YIELD_TTC;
        const arr = this.linkCars[opp.id];
        for (let j = 0; j < arr.length; j++) {
            const o = arr[j];
            if (o.nextConn && o.nextConn.turn === 'L') continue;   // two left-turners pass
            const d = opp.len - o.s;
            if (d > 70) break;
            if (o.v > 1 && d / o.v < ttc) return true;
            if (o.v <= 1 && d < 6 && sg === 'green') return true;
        }
        return false;
    }

    // How fast this driver wants to be going right now: the limit for the piece
    // of road they are on, and - once the bend or the roundabout ahead comes
    // into view - slow enough to arrive at it at ITS limit. Braking is the
    // ordinary kinematic v^2 = u^2 + 2as, so cars ease off before a corner
    // rather than discovering it at the last metre.
    desiredSpeed(c) {
        const here = c.conn ? c.conn.vLimit : c.link.vLimit;
        let v0 = Math.min(c.vMax, here);
        if (!c.conn && c.nextConn) {
            const d = c.link.len - c.s;
            const target = c.nextConn.vLimit;
            if (d < 45 && target < v0) {
                v0 = Math.min(v0, Math.sqrt(target * target + 2 * SIM.B_COMF * Math.max(0, d)));
            }
        }
        return Math.max(2.0, v0);
    }

    // --- roundabouts --------------------------------------------------------
    // Where a car is around the island, as an angle. Circulation runs in the
    // direction of DECREASING angle (right-hand traffic, so entering vehicles
    // bear right), which makes "how far ahead of me is that car" a simple
    // wrapped angular difference.
    _ringAngle(node, car) {
        const p = this.carPos(car);
        return Math.atan2(p.y - node.y, p.x - node.x);
    }

    // Arc distance from `from` to `to` travelling in the circulation direction.
    _ringArc(node, from, to) {
        let d = from - to;
        const TAU = Math.PI * 2;
        d = ((d % TAU) + TAU) % TAU;
        return d * node.ringR;
    }

    // Give way on entry: nothing may join the island if something already going
    // round will reach this entry first. A car that will leave before it gets
    // here is ignored, otherwise every roundabout locks solid.
    roundaboutBusy(node, arm) {
        const entryA = Math.atan2(DIRV[arm][1], DIRV[arm][0]);
        for (let k = 0; k < 4; k++) {
            const inL = node.in[k];
            if (!inL) continue;
            for (const conn of inL.outConns) {
                for (const o of this.connCars[conn.id]) {
                    if (!o.alive) continue;
                    const oa = this._ringAngle(node, o);
                    const toEntry = this._ringArc(node, oa, entryA);
                    // A TIME gap, not a distance: a car coming round at 8 m/s
                    // eats twenty metres of island while you are still pulling
                    // away from the give-way line.
                    if (toEntry > SIM.RING_GAP && toEntry / Math.max(3, o.v) > SIM.RING_TTC) continue;
                    const exitA = Math.atan2(DIRV[conn.outArm][1], DIRV[conn.outArm][0]);
                    if (this._ringArc(node, oa, exitA) < toEntry - 0.5) continue;  // leaves first
                    return true;
                }
            }
        }
        return false;
    }

    // Following on the island itself. Cars going round are on different
    // connectors, so ordinary in-lane car-following cannot see them.
    roundaboutAhead(node, car, consider) {
        const myA = this._ringAngle(node, car);
        for (let k = 0; k < 4; k++) {
            const inL = node.in[k];
            if (!inL) continue;
            for (const conn of inL.outConns) {
                if (conn === car.conn) continue;          // same lane, already handled
                for (const o of this.connCars[conn.id]) {
                    if (!o.alive || o === car) continue;
                    const gap = this._ringArc(node, myA, this._ringAngle(node, o)) - ROAD.CAR_LEN;
                    if (gap >= -0.5 && gap < 22) consider(gap, o.v, 'ring');
                }
            }
        }
    }

    // What is in front of this car, in metres of clear road and at what speed.
    frontObstacle(c) {
        let gap = 1e6, lead = c.v, kind = 'none';
        const consider = (g, v, k) => { if (g < gap) { gap = g; lead = v; kind = k; } };

        if (c.conn) {
            const conn = c.conn;
            const arr = this.connCars[conn.id];
            const i = c._idx;
            if (i > 0) consider(arr[i - 1].s - c.s - ROAD.CAR_LEN, arr[i - 1].v, 'car');
            else {
                const outArr = this.linkCars[conn.toLink];
                if (outArr && outArr.length) {
                    const tail = outArr[outArr.length - 1];
                    consider((conn.len - c.s) + tail.s - ROAD.CAR_LEN, tail.v, 'car');
                }
            }
            // Streams merging into the same exit lane: whoever is nearer the
            // exit has it, and the other one falls in behind. Symmetric, so it
            // cannot deadlock.
            const rem = conn.len - c.s;
            for (const mid of conn.merges) {
                const arr2 = this.connCars[mid];
                if (!arr2.length) continue;
                const o = arr2[0];
                const rem2 = this.city.connectors[mid].len - o.s;
                if (rem2 < rem) consider(rem - rem2 - ROAD.CAR_LEN, o.v, 'merge');
            }
            // Everyone else who came out of the same lane. They queued behind
            // each other on a single-lane approach and their paths only part
            // company gradually, so a straight-ahead car released while a
            // left-turner is still swinging across the box catches it.
            const fromL = this.city.links[conn.fromLink];
            for (const oc of fromL.outConns) {
                if (oc === conn) continue;
                const arr2 = this.connCars[oc.id];
                for (let j = arr2.length - 1; j >= 0; j--) {
                    const o = arr2[j];
                    if (!o.alive || o.s <= c.s) continue;
                    consider(o.s - c.s - ROAD.CAR_LEN, o.v, 'car');
                    break;
                }
            }
            const node = this.city.nodes[conn.node];
            if (conn.round) this.roundaboutAhead(node, c, consider);
            // Someone stepped into the crossing on the way out after we entered.
            if (this.crossI[node.id * 4 + conn.outArm] > 0) {
                const g = (conn.len - (node.stopR - node.cornerR)) - c.s;
                if (g > 0.4) consider(g, 0, 'ped');
            }
            // A permissive left turn waits INSIDE the junction for a gap, which
            // is what actually happens, and is why the length of the all-red
            // matters: that car has to be out of the box before the cross
            // street is released.
            if (conn.turn === 'L' && node.signal) {
                if (this.leftMustYield(conn, this.lights[node.sigIdx], node)) {
                    const g = conn.yieldS + SIM.S0 - c.s;
                    if (g > 0.4) consider(g, 0, 'yield');
                }
            }
            return { gap, lead, kind };
        }

        const l = c.link;
        const arr = this.linkCars[l.id];
        const i = c._idx;
        if (i > 0) consider(arr[i - 1].s - c.s - ROAD.CAR_LEN, arr[i - 1].v, 'car');

        const toStop = l.len - c.s;
        const node = this.city.nodes[l.to];
        if (node.portal) return { gap, lead, kind };      // the exit: drive off

        const conn = c.nextConn;
        if (!conn) { consider(toStop, 0, 'noroute'); return { gap, lead, kind }; }

        // Anything from THIS lane that is still inside the junction. It has to
        // be every connector leaving the lane, not just the one this car wants:
        // the approach has a single lane, so the car that got into the box
        // first blocks everyone behind it whichever way each of them is
        // turning. (A left-turner waiting for a gap really does hold up the
        // through traffic behind it - that is why single-lane approaches with
        // left turns have such poor capacity.)
        let minAhead = Infinity, leadV = 0;
        for (const oc of l.outConns) {
            const cArr = this.connCars[oc.id];
            if (!cArr.length) continue;
            const last = cArr[cArr.length - 1];
            if (last.s < minAhead) { minAhead = last.s; leadV = last.v; }
        }
        if (minAhead < Infinity) {
            consider(toStop + minAhead - ROAD.CAR_LEN, leadV, 'car');
        } else {
            const outArr = this.linkCars[conn.toLink];
            if (outArr.length) {
                const tail = outArr[outArr.length - 1];
                consider(toStop + conn.len + tail.s - ROAD.CAR_LEN, tail.v, 'car');
            }
        }

        if (!c.committed) {
            const light = node.signal ? this.lights[node.sigIdx] : null;
            let mustStop = false;
            if (light) {
                const sg = armSignal(light, l.inArm);
                if (sg === 'red') mustStop = true;
                else if (sg === 'amber') {
                    // The dilemma zone. Stopping needs v^2/2d of deceleration;
                    // if that is more than a driver can reasonably pull, the law
                    // and physics both say continue - and whether that ends in a
                    // collision is down to how much all-red the brain gave.
                    const need = toStop > 0.1 ? (c.v * c.v) / (2 * toStop) : 99;
                    if (need <= SIM.STOP_DECEL) mustStop = true;
                    else c.committed = true;
                }
            }
            // At a roundabout there is no signal at all: you give way to the
            // island and go when it is clear. Nothing the evolved controller
            // does can help or hinder here, which is the point of having them.
            if (node.round && this.roundaboutBusy(node, l.inArm)) mustStop = true;
            if (mustStop) {
                consider(toStop, 0, 'signal');
            } else {
                // Do not block the box: only enter if there is somewhere to land.
                const outArr = this.linkCars[conn.toLink];
                if (outArr.length) {
                    const tail = outArr[outArr.length - 1];
                    if (tail.s < ROAD.CAR_LEN + 3) consider(toStop, 0, 'spillback');
                }
                // Someone is in the crossing we would drive over on the way in.
                if (this.crossI[node.id * 4 + l.inArm] > 0) consider(toStop, 0, 'ped');
                // ...or the one on the way out.
                if (this.crossI[node.id * 4 + conn.outArm] > 0) {
                    consider(toStop + conn.len * 0.75, 0, 'ped');
                }
                // A left-turner slows for oncoming traffic on the APPROACH, not
                // only once it is already in the box: a car doing 12 m/s cannot
                // stop inside the three metres between the stop line and the
                // yield point, so checking only after it has entered means it
                // arrives at the conflict point at speed. The obstacle is put
                // at the yield point itself, so it coasts smoothly up to where
                // it is supposed to wait.
                if (conn.turn === 'L' && light &&
                    this.leftMustYield(conn, light, node)) {
                    consider(toStop + conn.yieldS, 0, 'yield');
                }
            }
        }
        return { gap, lead, kind };
    }

    stepCars(dt) {
        const city = this.city;
        for (let i = 0; i < this.cars.length; i++) {
            const c = this.cars[i];
            if (!c.alive) continue;
            if (c.wreck) {
                c.v = 0;
                if (this.t >= c.wreckUntil) { c.alive = false; }
                continue;
            }
            const ob = this.frontObstacle(c);
            let a = idmAccel(c.v, this.desiredSpeed(c), ob.gap, c.v - ob.lead);
            a = clamp(a, -SIM.B_EMERG, SIM.A_MAX);
            if (a < -4.5 && c.v > 4) this.m.ebrakes++;
            c.accel = a;
            c.v = Math.max(0, c.v + a * dt);
            // A "stop" is a car that was rolling and has now come to rest.
            // Counting it needs a latch: no single 0.1 s step can take a car
            // from cruising to standstill, so a same-step comparison never fires.
            if (c.v > 2) c.moving = true;
            else if (c.v < 0.3 && c.moving) { c.moving = false; this.m.stops++; }
            c.s += c.v * dt;

            if (c.conn) {
                if (c.s >= c.conn.len) {
                    const out = city.links[c.conn.toLink];
                    c.s -= c.conn.len;
                    c.conn = null;
                    c.link = out;
                    c.vMax = out.speed * c.speedFactor;
                    c.committed = false;
                    this.planAhead(c);
                }
                continue;
            }
            if (c.s >= c.link.len) {
                const node = city.nodes[c.link.to];
                if (node.portal || c.link.to === c.dest) {
                    c.alive = false;
                    c.arrived = true;
                    this.m.carsOut++;
                    this.m.carDelay += Math.max(0, (this.t - c.spawnT) - c.free);
                    continue;
                }
                if (!c.nextConn) {                      // nowhere to go: leave
                    c.alive = false;
                    continue;
                }
                if (node.signal) {
                    const light = this.lights[node.sigIdx];
                    if (armSignal(light, c.link.inArm) === 'red' && !c.committed) this.m.redEntries++;
                    light.flow[c.link.inArm].push(this.t);
                }
                this.m.throughVeh++;
                c.s -= c.link.len;
                c.conn = c.nextConn;
                c.link = null;
            }
        }
        // Drop finished / towed vehicles.
        if (this.cars.length > 32) {
            let w = 0;
            for (let i = 0; i < this.cars.length; i++) if (this.cars[i].alive) this.cars[w++] = this.cars[i];
            this.cars.length = w;
        }
    }

    // --- pedestrians --------------------------------------------------------
    stepPeds(dt) {
        const city = this.city, g = city.ped;
        for (let i = 0; i < this.peds.length; i++) {
            const p = this.peds[i];
            if (!p.alive) continue;
            if (p.edge) {
                p.s += p.v * dt;
                if (p.s < p.edge.len) continue;
                p.node = p.dir > 0 ? p.edge.b : p.edge.a;
                p.edge = null;
                p.s = 0;
            }
            if (p.node === p.dest) {
                p.alive = false; p.arrived = true;
                this.m.pedsOut++;
                this.m.pedDelay += Math.max(0, (this.t - p.spawnT) - p.free);
                continue;
            }
            const eid = g.next[p.node * g.count + p.dest];
            if (eid < 0) { p.alive = false; continue; }
            const e = g.edges[eid];
            p.wantEdge = e;
            if (e.type === 'cross' && !this.mayCross(e, p)) { p.waiting = true; continue; }
            p.waiting = false;
            p.edge = e;
            p.dir = e.a === p.node ? 1 : -1;
            p.s = 0;
        }
        if (this.peds.length > 32) {
            let w = 0;
            for (let i = 0; i < this.peds.length; i++) if (this.peds[i].alive) this.peds[w++] = this.peds[i];
            this.peds.length = w;
        }
    }

    // Law-abiding: step off only on a walk signal, and at an unsignalised
    // crossing only when there is a real gap in the traffic.
    mayCross(e, p) {
        const node = this.city.nodes[e.node];
        if (node.signal) return pedSignal(this.lights[node.sigIdx], e.arm) === 'walk';
        const inL = node.in[e.arm], outL = node.out[e.arm];
        const need = e.len / p.v;
        for (const l of [inL, outL]) {
            if (!l) continue;
            const arr = this.linkCars[l.id];
            for (const c of arr) {
                const d = l === inL ? l.len - c.s : c.s;
                if (d < 4) return false;
                if (c.v > 0.5 && d / c.v < need + 1.5 && d < 45) return false;
            }
        }
        return true;
    }

    // --- conflicts ----------------------------------------------------------
    detectCollisions(dt) {
        const city = this.city;
        for (const n of city.nodes) {
            if (n.portal) continue;
            // Everything inside the junction box, plus anything close enough to
            // the kerb to still be a danger to somebody on the crossing.
            const inBox = [], near = [];
            for (let k = 0; k < 4; k++) {
                const inL = n.in[k];
                if (inL) {
                    const arr = this.linkCars[inL.id];
                    for (let i = 0; i < arr.length; i++) {
                        if (inL.len - arr[i].s > 16) break;
                        near.push(arr[i]);
                    }
                    for (const conn of inL.outConns) {
                        const arr2 = this.connCars[conn.id];
                        for (const c of arr2) if (c.alive && !c.wreck) { inBox.push(c); near.push(c); }
                    }
                }
                const outL = n.out[k];
                if (outL) {
                    const arr = this.linkCars[outL.id];
                    for (let i = arr.length - 1; i >= 0; i--) {
                        if (arr[i].s > 16) break;
                        near.push(arr[i]);
                    }
                }
            }
            // Vehicle against vehicle: two car BODIES overlapping. Cars from one
            // approach fanning out to different exits and opposing streams
            // passing 3.6 m apart are both fine; a body across another body's
            // path is not.
            for (let i = 0; i < inBox.length; i++) {
                const a = inBox[i];
                // The lane lists were built before this step's motion, so a car
                // may have left the box in the meantime.
                if (!a.alive || a.wreck || !a.conn) continue;
                const pa = this.carPos(a);
                for (let j = i + 1; j < inBox.length; j++) {
                    const b = inBox[j];
                    if (!b.alive || b.wreck || !b.conn) continue;
                    const pb = this.carPos(b);
                    const dx = pa.x - pb.x, dy = pa.y - pb.y;
                    if (dx * dx + dy * dy > 36) continue;
                    if (obbOverlap(pa.x, pa.y, pa.a, pb.x, pb.y, pb.a, ROAD.CAR_LEN, ROAD.CAR_W)) {
                        this.crash(a, b); break;
                    }
                }
            }
            // Vehicle against pedestrian.
            for (let k = 0; k < 4; k++) {
                const list = this.crossPeds.get(n.id * 4 + k);
                if (!list) continue;
                for (const p of list) {
                    if (!p.alive || !p.edge) continue;   // may have stepped up onto the kerb
                    const pp = this.pedPos(p);
                    for (const c of near) {
                        if (!c.alive || c.wreck || c.v < 0.6) continue;
                        const pc = this.carPos(c);
                        const dx = pc.x - pp.x, dy = pc.y - pp.y;
                        if (dx * dx + dy * dy < SIM.PED_R * SIM.PED_R) { this.strike(c, p); break; }
                    }
                }
            }
        }
    }

    crash(a, b) {
        this.m.crashes++;
        for (const c of [a, b]) {
            c.wreck = true; c.v = 0; c.committed = false;
            c.wreckUntil = this.t + SIM.CRASH_CLEAR;
            this.m.carDelay += Math.max(0, (this.t - c.spawnT) - c.free) + 30;
        }
    }

    strike(c, p) {
        this.m.pedHits++;
        p.alive = false; p.hit = true;
        this.m.pedDelay += Math.max(0, (this.t - p.spawnT) - p.free) + 60;
        c.wreck = true; c.v = 0;
        c.wreckUntil = this.t + SIM.CRASH_CLEAR;
    }

    // --- signals ------------------------------------------------------------
    stepSignals(dt) {
        // One network-wide snapshot per simulated second, which is exactly one
        // step of the lag ladder the brains read.
        this._secAcc = (this._secAcc || 0) + dt;
        if (this._secAcc >= SIG.DECIDE_DT) {
            this._secAcc -= SIG.DECIDE_DT;
            this.histTick++;
            this.snapshot();
        }
        for (const l of this.lights) {
            l.decideAcc += dt;
            if (l.decideAcc >= SIG.DECIDE_DT) {
                l.decideAcc -= SIG.DECIDE_DT;
                readDetectors(this, l);
                const a = this.controller.decide(this, l, this.ctx);
                if (a && a.target >= 0) {
                    requestPhase(l, a.target, a.amber !== undefined ? a.amber : 3.5,
                        a.allRed !== undefined ? a.allRed : 1.6);
                }
            }
            stepLight(l, dt);
        }
    }

    // --- outcome ------------------------------------------------------------
    // Everything still on the road when the bell rings has cost people time
    // too, so its delay is banked as well - otherwise a controller could score
    // by simply never letting anyone finish.
    finish() {
        const m = this.m;
        for (const c of this.cars) {
            if (!c.alive || c.arrived) continue;
            m.carDelay += Math.max(0, (this.t - c.spawnT) - c.free);
        }
        for (const p of this.pending) m.carDelay += Math.max(0, this.t - p.ev.t);
        for (const p of this.peds) {
            if (!p.alive || p.arrived) continue;
            m.pedDelay += Math.max(0, (this.t - p.spawnT) - p.free);
        }
        m.simTime = this.t;
        m.carThroughput = m.carsIn ? m.carsOut / m.carsIn : 0;
        m.pedThroughput = m.pedsIn ? m.pedsOut / m.pedsIn : 0;
        m.meanCarDelay = m.carsIn ? m.carDelay / m.carsIn : 0;
        m.meanPedDelay = m.pedsIn ? m.pedDelay / m.pedsIn : 0;
        return m;
    }

    run(maxSeconds) {
        const until = maxSeconds === undefined ? this.episodeLen : Math.min(this.episodeLen, maxSeconds);
        while (this.t < until) this.step(SIM.DT);
        return this.finish();
    }
}

if (typeof module !== 'undefined') {
    module.exports = { SIM, idmAccel, World };
}
