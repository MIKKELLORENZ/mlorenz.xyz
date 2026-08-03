// Traffic signals: the phase state machine, the detectors that feed the brain,
// the assembly of one light's input vector, and the classical controllers the
// evolved brain is benchmarked against.
//
// A light has three phases and a hardware safety envelope it cannot violate,
// exactly like a real controller:
//
//   NS   north and south approaches get green; people cross the EAST and WEST
//        arms, i.e. the crossings parallel to the moving traffic
//   EW   the mirror image
//   PED  every vehicle movement stopped, every crossing open at once
//
// Between any two phases comes AMBER then ALL-RED, and the brain sets the
// length of both. That is where accidents come from. Amber that is too short
// leaves drivers in the dilemma zone - too close to stop comfortably, so by law
// and by physics they continue - and an all-red that is too short lets the next
// phase into the box while they are still in it. Amber and all-red that are too
// long are simply capacity thrown away, several seconds per cycle per junction.
// The controller has to find the middle, and nothing tells it where that is.
'use strict';

const PH = { NS: 0, EW: 1, PED: 2 };
const ST = { GREEN: 0, AMBER: 1, ALLRED: 2 };

const SIG = {
    DECIDE_DT: 1.0,        // one decision per simulated second (= one lag step)
    MIN_GREEN: 6,
    MIN_GREEN_PED: 10,
    MAX_GREEN: 75,         // forced change; the brain may starve an arm this long
    AMBER_MIN: 2.0,
    AMBER_MAX: 5.5,
    ALLRED_MIN: 0.0,
    ALLRED_MAX: 3.0,
    PED_WALK_WINDOW: 6.0,  // people may only step off in the first seconds of
                           // a green - after that the crossing shows a steady
                           // "don't walk" and only those already out finish
    DETECT_LEN: 90,        // loop-detector reach back from the stop line
    FLOW_WINDOW: 20        // seconds of departures kept for the flow channel
};

// Which approaches a phase serves, and which crossings it opens. During a
// north-south green the traffic itself shields the east and west crossings, so
// those are the ones that get a walk signal.
const SERVES = [[true, false, true, false], [false, true, false, true], [false, false, false, false]];
const OPENS = [[false, true, false, true], [true, false, true, false], [true, true, true, true]];

function armServed(phase, k) { return SERVES[phase][k]; }
function crossOpen(phase, k) { return OPENS[phase][k]; }

// --- light state ------------------------------------------------------------
function createLight(city, info) {
    return {
        info, sig: info.sig, node: info.node, x: info.x, y: info.y,
        phase: PH.NS, state: ST.GREEN,
        tPhase: 0, tState: 0, target: -1,
        amberDur: 3.5, allRedDur: 1.5,
        lastAction: 0, lastAmber: 0, lastAllRed: 0,
        sinceServed: [0, 0, 0],
        sinceGreenArm: [0, 0, 0, 0],
        det: new Float64Array(4 * 10),
        flow: [[], [], [], []],
        mapFeat: null,
        decideAcc: 0,
        // Live readouts kept for the renderer / probes.
        queue: [0, 0, 0, 0], pedWait: [0, 0, 0, 0], pedIn: [0, 0, 0, 0]
    };
}

function resetLight(l, rng) {
    // A fresh episode starts each junction on a random phase and a random point
    // in it, so a controller cannot win by memorising one global starting
    // alignment - it has to coordinate from wherever it finds itself.
    l.phase = rng() < 0.5 ? PH.NS : PH.EW;
    l.state = ST.GREEN;
    l.tPhase = rng() * 8;
    l.tState = l.tPhase;
    l.target = -1;
    l.amberDur = 3.5; l.allRedDur = 1.5;
    l.lastAction = 0; l.lastAmber = 0; l.lastAllRed = 0;
    l.sinceServed = [20, 20, 40];
    l.sinceServed[l.phase] = 0;
    l.sinceGreenArm = [20, 20, 20, 20];
    l.decideAcc = rng();        // stagger decisions so they do not all land on
                                // the same tick - real controllers are not
                                // synchronised by a global clock either
    for (let k = 0; k < 4; k++) l.flow[k].length = 0;
    l.det.fill(0);
}

// Vehicle signal shown to an approach.
function armSignal(l, k) {
    if (!armServed(l.phase, k)) return 'red';
    if (l.state === ST.GREEN) return 'green';
    if (l.state === ST.AMBER) return 'amber';
    return 'red';
}

// Pedestrian signal shown to a crossing. 'walk' means it is legal to step off;
// 'clear' is the steady don't-walk shown while the phase runs out, when anyone
// already in the crossing keeps going but nobody new may start.
function pedSignal(l, k) {
    if (!crossOpen(l.phase, k)) return 'dont';
    if (l.state !== ST.GREEN) return 'clear';
    return l.tPhase < SIG.PED_WALK_WINDOW ? 'walk' : 'clear';
}

// --- state machine ----------------------------------------------------------
function minGreenFor(l) { return l.phase === PH.PED ? SIG.MIN_GREEN_PED : SIG.MIN_GREEN; }

// Ask for a phase change. Ignored while a change is already running or before
// the minimum green has elapsed - the safety envelope, not a suggestion.
function requestPhase(l, target, amber, allRed) {
    if (l.state !== ST.GREEN) return false;
    if (target < 0 || target === l.phase) return false;
    if (l.tPhase < minGreenFor(l)) return false;
    l.target = target;
    l.amberDur = clamp(amber, SIG.AMBER_MIN, SIG.AMBER_MAX);
    l.allRedDur = clamp(allRed, SIG.ALLRED_MIN, SIG.ALLRED_MAX);
    // A phase with no vehicle movements has nothing to warn, so it skips
    // straight to the all-red clearance.
    l.state = l.phase === PH.PED ? ST.ALLRED : ST.AMBER;
    l.tState = 0;
    return true;
}

function stepLight(l, dt) {
    l.tState += dt;
    l.tPhase += dt;
    for (let i = 0; i < 3; i++) l.sinceServed[i] += dt;
    l.sinceServed[l.phase] = 0;
    for (let k = 0; k < 4; k++) {
        if (l.state === ST.GREEN && armServed(l.phase, k)) l.sinceGreenArm[k] = 0;
        else l.sinceGreenArm[k] += dt;
    }
    if (l.state === ST.AMBER && l.tState >= l.amberDur) {
        l.state = ST.ALLRED; l.tState = 0;
    } else if (l.state === ST.ALLRED && l.tState >= l.allRedDur) {
        l.state = ST.GREEN; l.tState = 0; l.tPhase = 0;
        l.phase = l.target >= 0 ? l.target : l.phase;
        l.target = -1;
    }
    // Forced change: no approach may be starved indefinitely, whatever the
    // brain wants. This is a real controller's max-out timer.
    if (l.state === ST.GREEN && l.tPhase >= SIG.MAX_GREEN) {
        requestPhase(l, l.phase === PH.EW ? PH.NS : PH.EW, l.amberDur, l.allRedDur);
    }
}

// One byte of history: the phase and whether it is green or clearing.
function packState(l) { return l.phase + 4 * l.state; }

// --- detectors --------------------------------------------------------------
// Everything a real adaptive junction can actually measure: loops in the road
// counting and timing vehicles on each approach, the push-buttons and presence
// detectors at each crossing, and (over the network) what the neighbouring
// controllers are currently showing.
function readDetectors(world, l) {
    const city = world.city, n = city.nodes[l.node], d = l.det;
    for (let k = 0; k < 4; k++) {
        const b = k * 10;
        const inL = n.in[k], outL = n.out[k];
        d[b + 0] = n.arms[k] ? 1 : 0;
        let queue = 0, nearest = 1;
        if (inL) {
            const arr = world.linkCars[inL.id];
            for (let i = 0; i < arr.length; i++) {
                const c = arr[i];
                const gap = inL.len - c.s;
                if (gap > SIG.DETECT_LEN) continue;
                if (c.v < 2.2 || gap < 30) queue++;
                const t = gap / 120;
                if (t < nearest) nearest = t;
            }
        }
        l.queue[k] = queue;
        d[b + 1] = Math.min(1, queue / 10);
        d[b + 2] = nearest;
        // Departures over the last FLOW_WINDOW seconds.
        const f = l.flow[k];
        while (f.length && world.t - f[0] > SIG.FLOW_WINDOW) f.shift();
        d[b + 3] = Math.min(1, f.length / 20);
        const px = world.pedAtCrossing(l.node, k);
        l.pedWait[k] = px.waiting; l.pedIn[k] = px.inside;
        d[b + 4] = Math.min(1, px.waiting / 6);
        d[b + 5] = Math.min(1, px.inside / 4);
        d[b + 6] = Math.min(1, px.clearTime / 15);
        let spill = 0;
        if (outL) {
            const arr = world.linkCars[outL.id];
            spill = Math.min(1, (arr.length * (ROAD.CAR_LEN + 2.4)) / Math.max(20, outL.len));
        }
        d[b + 7] = spill;
        const sg = armSignal(l, k);
        d[b + 8] = sg === 'green' ? 1 : sg === 'amber' ? 0.5 : 0;
        d[b + 9] = Math.min(1, l.sinceGreenArm[k] / 90);
    }
}

// --- input assembly ---------------------------------------------------------
function makeContext() {
    return {
        core: new Float64Array(CORE_CH),
        arms: new Float64Array(N_ARMS * ARM_CH),
        adj: new Float64Array(N_ADJ * ADJ_CH),
        far: new Float64Array(N_FAR * FAR_CH),
        ownH: new Float64Array(OWNH_CH),
        netH: new Float64Array(NETH_CH),
        map: new Float64Array(MAP_OUT)
    };
}

// Decode a packed history byte into the three phase channels. Green reads 1,
// the clearance leaving that phase reads 0.4, and a light that does not exist
// reads 0 - so "absent" and "changing" are distinguishable.
function unpackTo(byte, out, off) {
    out[off] = out[off + 1] = out[off + 2] = 0;
    if (byte < 0) return;
    const phase = byte & 3, state = byte >> 2;
    out[off + phase] = state === 0 ? 1 : 0.4;
}

function buildContext(world, l, ctx) {
    const info = l.info, city = world.city;
    const c = ctx.core;
    c[CORE.NX] = info.nx; c[CORE.NY] = info.ny;
    c[CORE.IS_NS] = l.state === ST.GREEN && l.phase === PH.NS ? 1 : 0;
    c[CORE.IS_EW] = l.state === ST.GREEN && l.phase === PH.EW ? 1 : 0;
    c[CORE.IS_PED] = l.state === ST.GREEN && l.phase === PH.PED ? 1 : 0;
    c[CORE.IS_AMBER] = l.state === ST.AMBER ? 1 : 0;
    c[CORE.IS_ALLRED] = l.state === ST.ALLRED ? 1 : 0;
    c[CORE.TIMER] = Math.min(1.5, l.tPhase / 60);
    c[CORE.MIN_OK] = l.tPhase >= minGreenFor(l) ? 1 : 0;
    c[CORE.MAX_PRESS] = Math.min(1, l.tPhase / SIG.MAX_GREEN);
    c[CORE.SINCE_NS] = Math.min(1.5, l.sinceServed[PH.NS] / 90);
    c[CORE.SINCE_EW] = Math.min(1.5, l.sinceServed[PH.EW] / 90);
    c[CORE.SINCE_PED] = Math.min(1.5, l.sinceServed[PH.PED] / 120);

    let qc = 0, qp = 0;
    for (let k = 0; k < 4; k++) { qc += l.queue[k]; qp += l.pedWait[k]; }
    c[CORE.WAIT_CARS] = Math.min(1.5, qc / 30);
    c[CORE.WAIT_PEDS] = Math.min(1.5, qp / 12);
    c[CORE.LOCAL_DELAY] = Math.min(1.5, l.sinceGreenArm.reduce((a, b) => Math.max(a, b), 0) / 60);
    const prog = world.t / Math.max(1, world.episodeLen);
    c[CORE.CLK_SIN] = Math.sin(prog * Math.PI * 2);
    c[CORE.CLK_COS] = Math.cos(prog * Math.PI * 2);
    c[CORE.LAST_HOLD] = l.lastAction === 0 ? 1 : 0;
    c[CORE.LAST_NS] = l.lastAction === 1 ? 1 : 0;
    c[CORE.LAST_EW] = l.lastAction === 2 ? 1 : 0;
    c[CORE.LAST_PED] = l.lastAction === 3 ? 1 : 0;
    c[CORE.LAST_AMBER] = l.lastAmber;
    c[CORE.LAST_ALLRED] = l.lastAllRed;
    c[CORE.ARM_COUNT] = info.armCount / 4;

    ctx.arms.set(l.det);

    // Road-connected neighbours, one slot per compass arm, each carrying that
    // neighbour's phase at all thirteen sample points.
    ctx.adj.fill(0);
    for (let k = 0; k < 4; k++) {
        const a = info.adj[k];
        const b = k * ADJ_CH;
        if (!a) continue;
        const other = world.lights[a.sig];
        ctx.adj[b + 0] = 1;
        ctx.adj[b + 1] = a.dist;
        ctx.adj[b + 2] = a.dx;
        ctx.adj[b + 3] = a.dy;
        ctx.adj[b + 4] = other.info.idNorm;
        // How much traffic that neighbour is currently sending at us.
        let q = 0;
        if (a.inLink >= 0) {
            const arr = world.linkCars[a.inLink];
            for (let i = 0; i < arr.length; i++) if (arr[i].v < 2.2) q++;
        }
        ctx.adj[b + 5] = Math.min(1, q / 10);
        let tot = 0;
        for (let j = 0; j < 4; j++) tot += other.queue[j];
        ctx.adj[b + 6] = Math.min(1, tot / 30);
        ctx.adj[b + 7] = Math.min(1, a.travel / 30);
        for (let s = 0; s < NSAMP; s++) {
            unpackTo(world.histAt(s, a.sig), ctx.adj, b + 8 + s * 3);
        }
    }

    // The rest of the network: the four nearest lights this one is not directly
    // connected to, current state only.
    ctx.far.fill(0);
    for (let i = 0; i < N_FAR; i++) {
        const f = info.far[i];
        const b = i * FAR_CH;
        if (!f) continue;
        const other = world.lights[f.sig];
        ctx.far[b + 0] = 1;
        ctx.far[b + 1] = f.dx;
        ctx.far[b + 2] = f.dy;
        ctx.far[b + 3] = other.info.idNorm;
        ctx.far[b + 4] = other.state === ST.GREEN && other.phase === PH.NS ? 1 : 0;
        ctx.far[b + 5] = other.state === ST.GREEN && other.phase === PH.EW ? 1 : 0;
        let tot = 0;
        for (let j = 0; j < 4; j++) tot += other.queue[j];
        ctx.far[b + 6] = Math.min(1, tot / 30);
    }

    for (let s = 0; s < NSAMP; s++) unpackTo(world.histAt(s, l.sig), ctx.ownH, s * 3);
    for (let s = 0; s < NSAMP; s++) {
        const agg = world.aggAt(s);
        for (let j = 0; j < 4; j++) ctx.netH[s * 4 + j] = agg[j];
    }
    ctx.map.set(l.mapFeat);
    return ctx;
}

// --- controllers ------------------------------------------------------------
// Every controller returns {target, amber, allRed}; target -1 means hold.

function brainController(genome) {
    return {
        name: 'brain',
        isBrain: true,
        genome,
        decide(world, l, ctx) {
            buildContext(world, l, ctx);
            const out = nnForward(genome, ctx);
            let bi = 0;
            for (let i = 1; i < 4; i++) if (out[i] > out[bi]) bi = i;
            l.lastAction = bi;
            l.lastAmber = out[4]; l.lastAllRed = out[5];
            const amber = lerp(SIG.AMBER_MIN, SIG.AMBER_MAX, (out[4] + 1) / 2);
            const allRed = lerp(SIG.ALLRED_MIN, SIG.ALLRED_MAX, (out[5] + 1) / 2);
            return { target: bi === 0 ? -1 : bi - 1, amber, allRed };
        }
    };
}

// The reference every run is measured against: a fixed-time plan, the way most
// junctions on earth still run. Nothing adaptive, no pedestrian phase - people
// cross on the parallel green.
function fixedTimeController(opts) {
    const green = (opts && opts.green) || 34;
    return {
        name: 'fixed-time',
        decide(world, l) {
            if (l.tPhase < green) return { target: -1 };
            return { target: l.phase === PH.NS ? PH.EW : PH.NS, amber: 3.8, allRed: 2.4 };
        }
    };
}

// A strong classical baseline: vehicle-actuated with gap-out and max-out, plus
// a queue-imbalance override and an all-pedestrian phase when enough people are
// waiting. This is what a good engineer installs, and it is what the evolved
// brain has to beat to be worth anything.
function actuatedController() {
    return {
        name: 'actuated',
        decide(world, l) {
            const other = l.phase === PH.NS ? PH.EW : PH.NS;
            let servedQ = 0, otherQ = 0, nearest = 1, pedWaiting = 0;
            for (let k = 0; k < 4; k++) {
                if (armServed(l.phase, k)) {
                    servedQ += l.queue[k];
                    nearest = Math.min(nearest, l.det[k * 10 + 2]);
                } else if (armServed(other, k)) otherQ += l.queue[k];
                pedWaiting += l.pedWait[k];
            }
            const amber = 3.8, allRed = 2.4;
            if (l.phase === PH.PED) {
                return l.tPhase >= 12 ? { target: otherQ >= servedQ ? other : PH.NS, amber, allRed } : { target: -1 };
            }
            if (pedWaiting >= 7 && l.sinceServed[PH.PED] > 90 && l.tPhase >= 10) {
                return { target: PH.PED, amber, allRed };
            }
            if (l.tPhase >= 45) return { target: other, amber, allRed };
            if (l.tPhase < 8) return { target: -1 };
            const gapOut = nearest > 30 / 120;          // nothing within 30 m
            if (gapOut && otherQ > 0) return { target: other, amber, allRed };
            if (otherQ >= servedQ + 4 && l.tPhase >= 12) return { target: other, amber, allRed };
            return { target: -1 };
        }
    };
}

// The floor: switch at random. A controller that cannot beat this has learned
// nothing at all.
function randomController(seed) {
    const rng = mulberry32(seed >>> 0);
    return {
        name: 'random',
        decide(world, l) {
            if (rng() > 0.07) return { target: -1 };
            const t = Math.floor(rng() * 3);
            return {
                target: t,
                amber: lerp(SIG.AMBER_MIN, SIG.AMBER_MAX, rng()),
                allRed: lerp(SIG.ALLRED_MIN, SIG.ALLRED_MAX, rng())
            };
        }
    };
}

if (typeof module !== 'undefined') {
    module.exports = {
        PH, ST, SIG, SERVES, OPENS, armServed, crossOpen,
        createLight, resetLight, armSignal, pedSignal, minGreenFor,
        requestPhase, stepLight, packState, readDetectors,
        makeContext, buildContext, unpackTo,
        brainController, fixedTimeController, actuatedController, randomController
    };
}
