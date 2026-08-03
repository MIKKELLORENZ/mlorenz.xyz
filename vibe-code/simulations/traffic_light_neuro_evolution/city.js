// City layout generator.
//
// A city is a lattice of junctions joined by streets, plus a stub arm out of
// every perimeter junction ending in a PORTAL: every vehicle and every
// pedestrian enters and leaves the world through one, so "how many reached
// their destination" is a well-defined count.
//
// Streets are NOT necessarily straight. Junction boxes stay square and
// axis-aligned - the whole signal model, the crossings and the stop lines
// depend on that - but between two junctions a street may wander: the nodes
// themselves are jittered off the lattice and each street is a cubic curve that
// leaves each junction along its arm and bends in the middle. Some layouts also
// carry roundabouts (no signals, give way to whatever is already circulating)
// and a RING ROAD at a higher speed limit, joined to the city at every
// perimeter stub.
//
// Two invariants every generated city must satisfy, checked at build time:
//   * every origin-destination pair of portals is drivable
//   * the street network is CLOSED-LOOPED - no internal street is a bridge, so
//     nothing is a dead end and every block can be driven around
//
// Everything the rest of the simulation needs is baked here, once per layout:
//
//   nodes / edges / links   the road graph; a directed link carries a polyline
//   connectors              the actual paths through a junction or roundabout
//   route tables            all-pairs shortest paths for cars AND pedestrians
//                           (agents are hard-coded optimal-path and law-abiding;
//                            the only thing under evolutionary control is the
//                            signals, so routes must not be reactive)
//   pedGraph                sidewalk corners, kerb-following sidewalks, crossings
//   bitmap                  a 64x64 black-and-white road map of the whole city,
//                           pooled to 16x16 plus a 24x24 egocentric crop per light
//
// Geometry is in metres, y grows south (screen coordinates), and arm indices are
// compass directions 0=N 1=E 2=S 3=W throughout.
'use strict';

const DIRV = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const OPP = [2, 3, 0, 1];
const DIR_NAME = ['N', 'E', 'S', 'W'];

const ROAD = {
    LANE: 3.6,        // one lane each way; roadway half-width = LANE
    CORNER: 7.5,      // sidewalk corner offset at an ordinary junction
    STOP: 9.4,        // stop-line distance at an ordinary junction
    RING_R: 13,       // roundabout circulating radius
    RING_STOP: 21,    // give-way line distance at a roundabout
    RING_CORNER: 18,  // sidewalk corner offset at a roundabout
    RUNOUT: 11,       // straight run out of a junction before a street may bend
    SPEED: 13.9,      // 50 km/h on ordinary streets
    SPEED_HW: 22.2,   // 80 km/h on the ring road
    WALK: 1.35,
    CAR_LEN: 4.6,
    CAR_W: 1.9,
    SIDEWALK: 6.0,    // sidewalk offset from the street centreline
    MAPRES: 64,
    MAPPOOL: 16,
    EGO: 24,
    EGOPOOL: 12
};

// --- layout catalogue -------------------------------------------------------
// The curriculum walks down this list. Each tier adds something the one before
// it did not have: more junctions, lopsided demand, streets that bend,
// junctions with no signals at all, a rush-hour surge, missing streets and
// one-way pairs, a fast ring road that changes what the optimal route even is,
// and finally vehicles that break down mid-episode and block a street.
const CITY_TIERS = [
    {
        name: 'One crossroads', nx: 1, ny: 1, blockMin: 150, blockMax: 150,
        carRate: 0.30, pedRate: 0.10, timeScale: 1.0
    },
    {
        name: 'Two by two', nx: 2, ny: 2, blockMin: 120, blockMax: 150,
        carRate: 0.46, pedRate: 0.18, timeScale: 1.1
    },
    {
        name: 'Nine blocks, one arterial', nx: 3, ny: 3, blockMin: 95, blockMax: 165,
        carRate: 0.62, pedRate: 0.30, timeScale: 1.3, skew: 0.55
    },
    {
        name: 'Winding streets', nx: 3, ny: 4, blockMin: 90, blockMax: 190,
        carRate: 0.70, pedRate: 0.55, timeScale: 1.4, skew: 0.45,
        curvy: 0.95, jitter: 0.16
    },
    {
        name: 'Roundabouts and rush hour', nx: 4, ny: 4, blockMin: 95, blockMax: 180,
        carRate: 0.60, pedRate: 0.60, timeScale: 1.55, skew: 0.5, surge: 0.85,
        curvy: 0.55, jitter: 0.10, roundabouts: 3
    },
    {
        name: 'Missing links and one-ways', nx: 4, ny: 5, blockMin: 90, blockMax: 195,
        carRate: 0.62, pedRate: 0.65, timeScale: 1.7, skew: 0.6, surge: 0.85,
        curvy: 0.6, jitter: 0.12, drop: 3, oneWay: 2, roundabouts: 1
    },
    {
        name: 'Ring road', nx: 3, ny: 3, blockMin: 120, blockMax: 190,
        carRate: 0.60, pedRate: 0.55, timeScale: 1.8, skew: 0.5, surge: 0.6,
        curvy: 0.5, jitter: 0.08, ring: true, ringRoundabouts: 5, stub: 175
    },
    {
        name: 'Downtown, with incidents', nx: 5, ny: 5, blockMin: 85, blockMax: 200,
        carRate: 0.66, pedRate: 0.85, timeScale: 1.9, skew: 0.65, surge: 1.0,
        curvy: 0.7, jitter: 0.12, drop: 4, oneWay: 3, roundabouts: 2, incident: 2
    }
];

// --- small geometry helpers -------------------------------------------------
// Arc-length position and heading anywhere on a polyline. Links, connectors and
// sidewalks all carry {pts, cum}, so a curved street costs the physics and the
// renderer nothing extra over a straight one.
function polyAt(poly, s) {
    const p = poly.pts, cum = poly.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = clamp((s - cum[i - 1]) / seg, 0, 1);
    const x0 = p[(i - 1) * 2], y0 = p[(i - 1) * 2 + 1], x1 = p[i * 2], y1 = p[i * 2 + 1];
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, a: Math.atan2(y1 - y0, x1 - x0) };
}
const connPointAt = polyAt;

function cumulative(pts) {
    const cum = [0];
    for (let i = 1; i * 2 < pts.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
    }
    return cum;
}

function makePoly(pts) {
    const cum = cumulative(pts);
    return { pts, cum, len: cum[cum.length - 1] };
}

// Offset a centreline sideways (positive = to the right of travel). Used for
// lane centres and for sidewalks, so both follow a bending street.
function offsetPoly(pts, off) {
    const n = pts.length / 2;
    const out = new Array(pts.length);
    for (let i = 0; i < n; i++) {
        const j = Math.min(n - 1, i + 1), k = Math.max(0, i - 1);
        const dx = pts[j * 2] - pts[k * 2], dy = pts[j * 2 + 1] - pts[k * 2 + 1];
        const L = Math.hypot(dx, dy) || 1;
        out[i * 2] = pts[i * 2] + (-dy / L) * off;
        out[i * 2 + 1] = pts[i * 2 + 1] + (dx / L) * off;
    }
    return out;
}

// How fast a path can be taken. A driver will not pull more than about 3 m/s2
// sideways, so the tighter the bend the slower it has to be driven: a quarter
// turn through a junction is 17 km/h, half a roundabout is 26, and a straight
// street is whatever the sign says. Without this cars go round a 13 m island at
// 50 km/h, which is not just unrealistic - it is where the collisions come from.
const A_LAT = 3.0;
function cornerSpeed(poly, limit) {
    const p = poly.pts;
    let turn = 0;
    for (let i = 2; i * 2 + 1 < p.length; i++) {
        const a1 = Math.atan2(p[(i - 1) * 2 + 1] - p[(i - 2) * 2 + 1], p[(i - 1) * 2] - p[(i - 2) * 2]);
        const a2 = Math.atan2(p[i * 2 + 1] - p[(i - 1) * 2 + 1], p[i * 2] - p[(i - 1) * 2]);
        let d = a2 - a1;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        turn += Math.abs(d);
    }
    if (turn < 0.05) return limit;
    const radius = poly.len / turn;
    return clamp(Math.sqrt(A_LAT * radius), 4.0, limit);
}

function reversePts(pts) {
    const out = [];
    for (let i = pts.length / 2 - 1; i >= 0; i--) out.push(pts[i * 2], pts[i * 2 + 1]);
    return out;
}

// Do two car bodies overlap? Separating-axis test on two oriented rectangles.
//
// This has to be a real body test rather than "are their centres within N
// metres". Two cars passing in opposite directions sit 3.6 m apart and never
// touch; a car poking across the opposing lane at the same 3.6 m certainly
// does. A distance threshold cannot tell those apart, and picking one that
// separates them wrongly convicts every lawful signal plan of causing crashes.
function obbOverlap(ax, ay, aa, bx, by, ba, len, wid) {
    const hl = len / 2, hw = wid / 2;
    const au = [Math.cos(aa), Math.sin(aa)], av = [-Math.sin(aa), Math.cos(aa)];
    const bu = [Math.cos(ba), Math.sin(ba)], bv = [-Math.sin(ba), Math.cos(ba)];
    const dx = bx - ax, dy = by - ay;
    const axes = [au, av, bu, bv];
    for (let i = 0; i < 4; i++) {
        const ex = axes[i][0], ey = axes[i][1];
        const t = Math.abs(dx * ex + dy * ey);
        const ra = hl * Math.abs(au[0] * ex + au[1] * ey) + hw * Math.abs(av[0] * ex + av[1] * ey);
        const rb = hl * Math.abs(bu[0] * ex + bu[1] * ey) + hw * Math.abs(bv[0] * ex + bv[1] * ey);
        if (t > ra + rb) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------

function makeCity(tier, seed) {
    const spec = CITY_TIERS[Math.max(0, Math.min(CITY_TIERS.length - 1, tier | 0))];
    const rng = mulberry32(seed >>> 0);
    const city = {
        tier: tier | 0, spec, seed: seed >>> 0, name: spec.name,
        nodes: [], edges: [], links: [], connectors: [], signals: [], portals: []
    };

    const addNode = (x, y, kind) => {
        const n = {
            id: city.nodes.length, x, y,
            portal: kind === 'portal',
            ring: kind === 'ring' || kind === 'ringCorner',
            round: false,
            arms: [null, null, null, null],
            out: [null, null, null, null],
            in: [null, null, null, null],
            signal: false, sigIdx: -1, deg: 0,
            stopR: kind === 'portal' ? 0 : ROAD.STOP,
            cornerR: ROAD.CORNER, ringR: 0
        };
        city.nodes.push(n);
        return n;
    };
    const addEdge = (a, b, dirA, opts) => {
        const e = {
            id: city.edges.length, a: a.id, b: b.id, dirA, dirB: OPP[dirA],
            len: Math.hypot(b.x - a.x, b.y - a.y),
            oneWay: 0, speed: (opts && opts.speed) || ROAD.SPEED,
            hw: !!(opts && opts.hw), stub: !!(opts && opts.stub),
            curve: 0
        };
        city.edges.push(e);
        a.arms[dirA] = e; b.arms[e.dirB] = e;
        a.deg++; b.deg++;
        return e;
    };

    // --- 1. junction positions ----------------------------------------------
    const nx = spec.nx, ny = spec.ny;
    const STUB = spec.stub || 95;
    const RING_OFF = 80;
    const xs = [STUB], ys = [STUB];
    for (let i = 1; i < nx; i++) xs.push(xs[i - 1] + Math.round(lerp(spec.blockMin, spec.blockMax, rng())));
    for (let j = 1; j < ny; j++) ys.push(ys[j - 1] + Math.round(lerp(spec.blockMin, spec.blockMax, rng())));
    city.width = xs[nx - 1] + STUB;
    city.height = ys[ny - 1] + STUB;

    // Nudge the lattice off true. Junction boxes stay axis-aligned, but the
    // streets between them no longer are, so every block is a slightly
    // different shape - which is what stops a controller learning one geometry
    // and calling it a city.
    const jit = spec.jitter || 0;
    const grid = [];
    for (let j = 0; j < ny; j++) {
        grid.push([]);
        for (let i = 0; i < nx; i++) {
            const spanX = nx > 1 ? (i + 1 < nx ? xs[i + 1] - xs[i] : xs[i] - xs[i - 1]) : 120;
            const spanY = ny > 1 ? (j + 1 < ny ? ys[j + 1] - ys[j] : ys[j] - ys[j - 1]) : 120;
            const dx = jit ? (rng() * 2 - 1) * spanX * jit : 0;
            const dy = jit ? (rng() * 2 - 1) * spanY * jit : 0;
            grid[j].push(addNode(xs[i] + dx, ys[j] + dy, 'junction'));
        }
    }

    // --- 2. streets ----------------------------------------------------------
    const internal = [];
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            if (i + 1 < nx) internal.push(addEdge(grid[j][i], grid[j][i + 1], 1));
            if (j + 1 < ny) internal.push(addEdge(grid[j][i], grid[j + 1][i], 2));
        }
    }

    // Perimeter stubs out to portals - the sources and sinks of all demand.
    // With a ring road they are split in two, with a ring junction in between.
    const stubs = [];
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const n = grid[j][i];
            if (i === 0) stubs.push({ node: n, dir: 3 });
            if (i === nx - 1) stubs.push({ node: n, dir: 1 });
            if (j === 0) stubs.push({ node: n, dir: 0 });
            if (j === ny - 1) stubs.push({ node: n, dir: 2 });
        }
    }

    const ringNodes = [[], [], [], []];
    for (const st of stubs) {
        const n = st.node, k = st.dir, d = DIRV[k];
        if (spec.ring) {
            const r = addNode(n.x + d[0] * RING_OFF, n.y + d[1] * RING_OFF, 'ring');
            addEdge(n, r, k, { stub: true });
            const p = addNode(n.x + d[0] * STUB, n.y + d[1] * STUB, 'portal');
            addEdge(r, p, k, { stub: true });
            city.portals.push(p.id);
            ringNodes[k].push(r);
        } else {
            const p = addNode(n.x + d[0] * STUB, n.y + d[1] * STUB, 'portal');
            addEdge(n, p, k, { stub: true });
            city.portals.push(p.id);
        }
    }

    // --- 3. the ring road ----------------------------------------------------
    // A fast road that loops the whole city, joined to it at every perimeter
    // stub. It is the only thing here with a different speed limit, and it
    // changes what the shortest route actually is: crossing town can be quicker
    // the long way round than straight through the middle.
    if (spec.ring) {
        const hw = { hw: true, speed: ROAD.SPEED_HW };
        const bySide = k => ringNodes[k].slice().sort((a, b) =>
            (k === 0 || k === 2) ? a.x - b.x : a.y - b.y);
        const N = bySide(0), E = bySide(1), Sd = bySide(2), W = bySide(3);
        const chain = (list, dir) => {
            for (let i = 0; i + 1 < list.length; i++) addEdge(list[i], list[i + 1], dir, hw);
        };
        chain(N, 1); chain(E, 2); chain(Sd, 1); chain(W, 2);
        const corner = (a, dirFromA, b, dirFromCorner, cx, cy) => {
            if (!a || !b) return;
            const c = addNode(cx, cy, 'ringCorner');
            addEdge(a, c, dirFromA, hw);
            addEdge(c, b, dirFromCorner, hw);
        };
        const f = l => l[0], last = l => l[l.length - 1];
        if (N.length && W.length) corner(f(N), 3, f(W), 2, f(W).x, f(N).y);
        if (N.length && E.length) corner(last(N), 1, f(E), 2, f(E).x, last(N).y);
        if (Sd.length && E.length) corner(last(Sd), 1, last(E), 0, last(E).x, last(Sd).y);
        if (Sd.length && W.length) corner(f(Sd), 3, last(W), 0, last(W).x, f(Sd).y);
    }

    // --- 4. removed streets + one-way pairs ----------------------------------
    const shuffled = internal.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
    }
    let dropped = 0;
    for (const e of shuffled) {
        if (dropped >= (spec.drop || 0)) break;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        if (a.deg <= 3 || b.deg <= 3) continue;
        a.arms[e.dirA] = null; b.arms[e.dirB] = null;
        a.deg--; b.deg--; e.removed = true;
        // Dropping a street may not turn some other street into the ONLY way in
        // or out of a block. Every internal street has to stay part of a loop,
        // so the city can always be driven around.
        if (hasBridge(city)) {
            a.arms[e.dirA] = e; b.arms[e.dirB] = e;
            a.deg++; b.deg++; e.removed = false;
        } else dropped++;
    }
    city.edges = city.edges.filter(e => !e.removed);
    city.edges.forEach((e, i) => { e.id = i; });

    let oneWays = 0;
    for (const e of shuffled) {
        if (oneWays >= (spec.oneWay || 0)) break;
        if (e.removed || e.hw || e.stub) continue;
        e.oneWay = rng() < 0.5 ? 1 : -1;
        oneWays++;
    }

    // --- 5. roundabouts ------------------------------------------------------
    // Junctions with no signals at all: everything gives way to whatever is
    // already going round. The evolved controller does not get to touch them, so
    // it has to cope with a neighbour it cannot command.
    const cands = [];
    if (spec.ring && spec.ringRoundabouts) {
        for (const n of city.nodes) if (n.ring && !n.portal && n.deg >= 3) cands.push(n);
    }
    if (spec.roundabouts) {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            if (grid[j][i].deg >= 3) cands.push(grid[j][i]);
        }
    }
    for (let i = cands.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = cands[i]; cands[i] = cands[j]; cands[j] = t;
    }
    const wantRound = (spec.roundabouts || 0) + (spec.ring ? (spec.ringRoundabouts || 0) : 0);
    for (let i = 0; i < Math.min(wantRound, cands.length); i++) {
        const n = cands[i];
        n.round = true;
        n.ringR = ROAD.RING_R;
        n.stopR = ROAD.RING_STOP;
        n.cornerR = ROAD.RING_CORNER;
    }

    // --- 6. how much the streets bend ----------------------------------------
    const curvy = spec.curvy || 0;
    for (const e of city.edges) {
        e.curve = curvy && !e.stub ? (rng() * 2 - 1) * Math.min(55, e.len * 0.16) * curvy : 0;
    }

    // --- 7-9. roadway, routing, sidewalks, map -------------------------------
    buildRoadway(city);
    buildCarRoutes(city);
    // A one-way that stranded some origin-destination pair is reverted rather
    // than shipped: an unreachable portal would silently drain fitness.
    if (!city.routesOk) {
        for (const e of city.edges) e.oneWay = 0;
        buildRoadway(city);
        buildCarRoutes(city);
    }
    buildPedGraph(city);
    buildBitmap(city);
    buildSignalContext(city);
    city.closedLoop = !hasBridge(city);
    return city;
}

// --- closed-loop check ------------------------------------------------------
// An internal street that is the only connection between two parts of the city
// is a bridge: lose it and a whole area becomes a dead end. Portal stubs are
// exempt - they ARE the edge of the world - so the test runs on the internal
// graph only. Iterative DFS low-link bridge finding.
function hasBridge(city) {
    const N = city.nodes.length;
    const adj = Array.from({ length: N }, () => []);
    let count = 0;
    for (const e of city.edges) {
        if (e.removed || e.stub) continue;
        adj[e.a].push({ to: e.b, id: e.id });
        adj[e.b].push({ to: e.a, id: e.id });
        count++;
    }
    if (!count) return false;
    const disc = new Int32Array(N).fill(-1);
    const low = new Int32Array(N);
    let timer = 0, found = false;
    for (let s = 0; s < N; s++) {
        if (disc[s] >= 0 || !adj[s].length) continue;
        const stack = [{ u: s, pe: -1, i: 0 }];
        disc[s] = low[s] = timer++;
        while (stack.length) {
            const fr = stack[stack.length - 1];
            if (fr.i < adj[fr.u].length) {
                const nb = adj[fr.u][fr.i++];
                if (nb.id === fr.pe) continue;
                if (disc[nb.to] >= 0) {
                    if (disc[nb.to] < low[fr.u]) low[fr.u] = disc[nb.to];
                } else {
                    disc[nb.to] = low[nb.to] = timer++;
                    stack.push({ u: nb.to, pe: nb.id, i: 0 });
                }
            } else {
                stack.pop();
                if (stack.length) {
                    const p = stack[stack.length - 1];
                    if (low[fr.u] < low[p.u]) low[p.u] = low[fr.u];
                    if (low[fr.u] > disc[p.u]) found = true;
                }
            }
        }
    }
    return found;
}

// --- links + connectors -----------------------------------------------------
// Build every directed link and every path through every junction from the
// current edge set. Idempotent, so the one-way revert path just calls it again.
function buildRoadway(city) {
    city.links = [];
    city.connectors = [];
    city.signals = [];
    for (const n of city.nodes) {
        n.out = [null, null, null, null];
        n.in = [null, null, null, null];
        n.signal = false; n.sigIdx = -1;
    }

    // The centreline of a street: out of each junction along its arm for a
    // straight run, then a cubic curve across the middle. Keeping the run-outs
    // axis-aligned is what lets junctions stay square while streets bend.
    for (const e of city.edges) {
        const a = city.nodes[e.a], b = city.nodes[e.b];
        const da = DIRV[e.dirA], db = DIRV[e.dirB];
        const p0x = a.x + da[0] * a.stopR, p0y = a.y + da[1] * a.stopR;
        const p3x = b.x + db[0] * b.stopR, p3y = b.y + db[1] * b.stopR;
        const span = Math.hypot(p3x - p0x, p3y - p0y);
        const run = Math.min(ROAD.RUNOUT, span * 0.28);
        const q0x = p0x + da[0] * run, q0y = p0y + da[1] * run;
        const q3x = p3x + db[0] * run, q3y = p3y + db[1] * run;
        const vx = q3x - q0x, vy = q3y - q0y;
        const L = Math.hypot(vx, vy) || 1;
        const px = -vy / L, py = vx / L;
        const d = L * 0.34;
        const c1x = q0x + da[0] * d + px * e.curve, c1y = q0y + da[1] * d + py * e.curve;
        const c2x = q3x + db[0] * d + px * e.curve, c2y = q3y + db[1] * d + py * e.curve;
        const pts = [p0x, p0y];
        const N = e.curve ? 14 : 4;
        for (let i = 0; i <= N; i++) {
            const t = i / N, it = 1 - t;
            pts.push(
                it * it * it * q0x + 3 * it * it * t * c1x + 3 * it * t * t * c2x + t * t * t * q3x,
                it * it * it * q0y + 3 * it * it * t * c1y + 3 * it * t * t * c2y + t * t * t * q3y
            );
        }
        pts.push(p3x, p3y);
        e.centre = makePoly(pts);
    }

    const addLink = (e, fromId, dirFrom) => {
        const from = city.nodes[fromId], to = city.nodes[fromId === e.a ? e.b : e.a];
        const dirTo = OPP[dirFrom];
        const centre = fromId === e.a ? e.centre.pts : reversePts(e.centre.pts);
        const poly = makePoly(offsetPoly(centre, ROAD.LANE * 0.5));
        const ux = DIRV[dirFrom][0], uy = DIRV[dirFrom][1];
        const link = {
            id: city.links.length, edge: e.id, from: from.id, to: to.id,
            arm: dirFrom, inArm: dirTo, heading: dirFrom,
            pts: poly.pts, cum: poly.cum, len: poly.len,
            sx: poly.pts[0], sy: poly.pts[1],
            ex: poly.pts[poly.pts.length - 2], ey: poly.pts[poly.pts.length - 1],
            ux, uy, rx: -uy, ry: ux,
            speed: e.speed, hw: e.hw,
            // A winding street cannot be driven at the posted limit either.
            vLimit: cornerSpeed(poly, e.speed),
            outConns: []
        };
        city.links.push(link);
        from.out[dirFrom] = link;
        to.in[dirTo] = link;
        return link;
    };
    for (const e of city.edges) {
        if (e.oneWay >= 0) addLink(e, e.a, e.dirA);
        if (e.oneWay <= 0) addLink(e, e.b, e.dirB);
    }

    for (const n of city.nodes) {
        if (n.portal) continue;
        for (let k = 0; k < 4; k++) {
            const inL = n.in[k];
            if (!inL) continue;
            for (let m = 0; m < 4; m++) {
                if (m === k) continue;               // no U-turns
                const outL = n.out[m];
                if (!outL) continue;
                const turn = m === (k + 2) % 4 ? 'S' : m === (k + 3) % 4 ? 'R' : 'L';
                const poly = makePoly(n.round ? roundaboutPath(n, inL, outL, k, m)
                    : junctionPath(inL, outL, turn));
                const conn = {
                    id: city.connectors.length, node: n.id, inArm: k, outArm: m, turn,
                    round: n.round, fromLink: inL.id, toLink: outL.id,
                    pts: poly.pts, cum: poly.cum, len: poly.len,
                    vLimit: cornerSpeed(poly, Math.min(inL.speed, outL.speed))
                };
                city.connectors.push(conn);
                inL.outConns.push(conn);
            }
        }
        // Signals only where there are at least three arms and it is not a
        // roundabout. Two-arm nodes are plain bends.
        n.signal = n.deg >= 3 && !n.round;
        if (n.signal) { n.sigIdx = city.signals.length; city.signals.push(n.id); }
    }

    for (const l of city.links) {
        l.connByArm = [null, null, null, null];
        for (const c of l.outConns) l.connByArm[c.outArm] = c;
    }
    for (const c of city.connectors) {
        c.merges = city.connectors
            .filter(o => o.id !== c.id && o.node === c.node && o.toLink === c.toLink)
            .map(o => o.id);
    }
    buildConflicts(city);
    buildYieldPoints(city);
}

// An ordinary junction: a quadratic Bezier from the stop line to the exit,
// bending around where the two lane centrelines would meet.
function junctionPath(inL, outL, turn) {
    const p0x = inL.ex, p0y = inL.ey, p2x = outL.sx, p2y = outL.sy;
    const horiz = Math.abs(inL.ux) > 0.5;
    const cx = turn === 'S' ? (p0x + p2x) / 2 : (horiz ? p2x : p0x);
    const cy = turn === 'S' ? (p0y + p2y) / 2 : (horiz ? p0y : p2y);
    const N = 10, pts = [];
    for (let i = 0; i <= N; i++) {
        const t = i / N, it = 1 - t;
        pts.push(
            it * it * p0x + 2 * it * t * cx + t * t * p2x,
            it * it * p0y + 2 * it * t * cy + t * t * p2y
        );
    }
    return pts;
}

// A roundabout: in off the give-way line, round the island, out again. Right-
// hand traffic, so entering vehicles bear right and circulate N -> W -> S -> E.
// A right turn is a quarter of the island, straight on is a half and a left is
// three quarters - which is why a roundabout costs a left-turner more than a
// signal does, and costs everybody else far less.
function roundaboutPath(n, inL, outL, k, m) {
    const R = n.ringR;
    const quarters = (k - m + 4) % 4;
    const sweep = quarters * (Math.PI / 2);
    const a0 = Math.atan2(DIRV[k][1], DIRV[k][0]);
    const steps = Math.max(4, quarters * 5);
    const pts = [inL.ex, inL.ey];
    for (let i = 0; i <= steps; i++) {
        const a = a0 - sweep * (i / steps);
        pts.push(n.x + Math.cos(a) * R, n.y + Math.sin(a) * R);
    }
    pts.push(outL.sx, outL.sy);
    return pts;
}

// Which pairs of paths through a junction genuinely conflict.
//
// This matters more than it looks. Two cars from the SAME approach - one going
// straight, one turning right - leave the stop line from the same point and
// diverge, so a naive "any two cars within 3 metres of each other have crashed"
// test reports a collision every time a queue discharges. Two cars from
// OPPOSITE approaches going straight pass 3.6 m apart and never touch. The only
// real conflicts are paths that cross and paths that merge.
function buildConflicts(city) {
    const byNode = new Map();
    for (const c of city.connectors) {
        c.conflicts = new Set();
        if (!byNode.has(c.node)) byNode.set(c.node, []);
        byNode.get(c.node).push(c);
    }
    const CLEAR = 2.8;
    for (const list of byNode.values()) {
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                if (a.inArm === b.inArm) continue;
                let hit = a.toLink === b.toLink;
                if (!hit) {
                    outer:
                    for (let p = 0; p < a.pts.length; p += 2) {
                        for (let q = 0; q < b.pts.length; q += 2) {
                            const dx = a.pts[p] - b.pts[q], dy = a.pts[p + 1] - b.pts[q + 1];
                            if (dx * dx + dy * dy < CLEAR * CLEAR) { hit = true; break outer; }
                        }
                    }
                }
                if (hit) { a.conflicts.add(b.id); b.conflicts.add(a.id); }
            }
        }
    }
}

// How far into a junction a permissive left-turner may pull while it waits for a
// gap. Real drivers do not sit at the stop line - they move into the box, which
// is the only reason a single-lane approach with a left-turner in it does not
// stall for the whole green. But they stop SHORT of the opposing through lane,
// and where exactly that is depends on the geometry, so it is measured here
// rather than guessed: creep forward until the body would foul a car anywhere on
// the opposing straight-ahead path, then back off a car's length.
function buildYieldPoints(city) {
    for (const conn of city.connectors) {
        conn.yieldS = conn.len;
        if (conn.turn !== 'L' || conn.round) continue;
        const n = city.nodes[conn.node];
        const oppIn = n.in[(conn.inArm + 2) % 4];
        const opp = oppIn ? oppIn.connByArm[conn.inArm] : null;
        if (!opp) continue;
        let first = conn.len;
        outer:
        for (let s = 0; s <= conn.len; s += 0.4) {
            const a = polyAt(conn, s);
            for (let u = 0; u <= opp.len; u += 0.6) {
                const b = polyAt(opp, u);
                if (obbOverlap(a.x, a.y, a.a, b.x, b.y, b.a, ROAD.CAR_LEN + 0.8, ROAD.CAR_W + 0.8)) {
                    first = s; break outer;
                }
            }
        }
        conn.yieldS = Math.max(1.2, first - 1.4);
    }
}

// --- vehicle shortest paths -------------------------------------------------
// Floyd-Warshall over nodes with free-flow travel TIME plus a fixed penalty per
// junction, which keeps optimal routes from zig-zagging block by block the way a
// pure distance metric would. Because the cost is time and the ring road has a
// higher speed limit, the long way round genuinely wins for some trips.
function buildCarRoutes(city) {
    const N = city.nodes.length;
    const INF = 1e15;
    const d = new Float64Array(N * N).fill(INF);
    const nextLink = new Int32Array(N * N).fill(-1);
    for (let i = 0; i < N; i++) d[i * N + i] = 0;
    for (const l of city.links) {
        const w = l.len / l.speed + (city.nodes[l.to].round ? 5 : 4);
        if (w < d[l.from * N + l.to]) {
            d[l.from * N + l.to] = w;
            nextLink[l.from * N + l.to] = l.id;
        }
    }
    for (let k = 0; k < N; k++) {
        for (let i = 0; i < N; i++) {
            const dik = d[i * N + k];
            if (dik >= INF) continue;
            for (let j = 0; j < N; j++) {
                const alt = dik + d[k * N + j];
                if (alt < d[i * N + j] - 1e-9) {
                    d[i * N + j] = alt;
                    nextLink[i * N + j] = nextLink[i * N + k];
                }
            }
        }
    }
    city.carDist = d;
    city.carNext = nextLink;
    city.routesOk = true;
    for (const a of city.portals) {
        for (const b of city.portals) {
            if (a !== b && d[a * N + b] >= INF) { city.routesOk = false; return; }
        }
    }
}

function nextLinkTo(city, from, to) {
    const id = city.carNext[from * city.nodes.length + to];
    return id < 0 ? null : city.links[id];
}

// --- pedestrian graph -------------------------------------------------------
// Four sidewalk corners per junction (0=NE 1=SE 2=SW 3=NW), joined around the
// junction by a marked crossing wherever an arm carries a road and by a plain
// corner walk where it does not. Sidewalks run corner to corner along every
// street and follow that street's curve.
const CORNER_OFF = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

function cornerPos(city, nodeId, c) {
    const n = city.nodes[nodeId];
    return { x: n.x + CORNER_OFF[c][0] * n.cornerR, y: n.y + CORNER_OFF[c][1] * n.cornerR };
}

function buildPedGraph(city) {
    const P = city.nodes.length * 4;
    const pos = new Float64Array(P * 2);
    for (let n = 0; n < city.nodes.length; n++) {
        for (let c = 0; c < 4; c++) {
            const p = cornerPos(city, n, c);
            pos[(n * 4 + c) * 2] = p.x;
            pos[(n * 4 + c) * 2 + 1] = p.y;
        }
    }
    const pedEdges = [];
    const addPed = (a, b, type, node, arm, pts) => {
        const poly = makePoly(pts || [pos[a * 2], pos[a * 2 + 1], pos[b * 2], pos[b * 2 + 1]]);
        // No mutable per-episode state lives on a city: one layout is shared by
        // every genome in a generation and cached across generations.
        const e = {
            id: pedEdges.length, a, b, len: poly.len, type, node, arm,
            pts: poly.pts, cum: poly.cum
        };
        pedEdges.push(e);
        return e;
    };

    for (const n of city.nodes) {
        for (let k = 0; k < 4; k++) {
            const c1 = (k + 3) % 4, c2 = k;
            addPed(n.id * 4 + c1, n.id * 4 + c2, n.arms[k] ? 'cross' : 'corner', n.id, k);
        }
    }
    for (const e of city.edges) {
        const a = city.nodes[e.a], b = city.nodes[e.b];
        const ca = [(e.dirA + 3) % 4, e.dirA];
        const cb = [(e.dirB + 3) % 4, e.dirB];
        for (const c1 of ca) {
            let best = -1, bd = Infinity;
            for (const c2 of cb) {
                const dx = pos[(b.id * 4 + c2) * 2] - pos[(a.id * 4 + c1) * 2];
                const dy = pos[(b.id * 4 + c2) * 2 + 1] - pos[(a.id * 4 + c1) * 2 + 1];
                const dd = dx * dx + dy * dy;
                if (dd < bd) { bd = dd; best = c2; }
            }
            // Which side of the street this pavement is on, so it can follow the
            // street's curve instead of cutting straight across it.
            const ax = pos[(a.id * 4 + c1) * 2], ay = pos[(a.id * 4 + c1) * 2 + 1];
            const st = polyAt(e.centre, Math.min(e.centre.len, ROAD.RUNOUT));
            const side = ((ax - st.x) * Math.sin(st.a) - (ay - st.y) * Math.cos(st.a)) < 0 ? 1 : -1;
            const walk = offsetPoly(e.centre.pts, side * ROAD.SIDEWALK);
            const pts = [ax, ay].concat(walk, [pos[(b.id * 4 + best) * 2], pos[(b.id * 4 + best) * 2 + 1]]);
            addPed(a.id * 4 + c1, b.id * 4 + best, 'walk', -1, -1, pts);
        }
    }

    // A crossing carries an 8 s expected-wait penalty so pedestrians prefer
    // routes with fewer of them, which is what real people do and keeps their
    // paths stable under evolution.
    const INF = 1e15;
    const d = new Float64Array(P * P).fill(INF);
    const nxt = new Int32Array(P * P).fill(-1);
    for (let i = 0; i < P; i++) d[i * P + i] = 0;
    for (const e of pedEdges) {
        const w = e.len / ROAD.WALK + (e.type === 'cross' ? 8 : 0);
        if (w < d[e.a * P + e.b]) { d[e.a * P + e.b] = w; nxt[e.a * P + e.b] = e.id; }
        if (w < d[e.b * P + e.a]) { d[e.b * P + e.a] = w; nxt[e.b * P + e.a] = e.id; }
    }
    for (let k = 0; k < P; k++) {
        for (let i = 0; i < P; i++) {
            const dik = d[i * P + k];
            if (dik >= INF) continue;
            for (let j = 0; j < P; j++) {
                const alt = dik + d[k * P + j];
                if (alt < d[i * P + j] - 1e-9) { d[i * P + j] = alt; nxt[i * P + j] = nxt[i * P + k]; }
            }
        }
    }
    city.ped = { count: P, pos, edges: pedEdges, dist: d, next: nxt };

    const cross = new Int32Array(city.nodes.length * 4).fill(-1);
    for (const e of pedEdges) if (e.type === 'cross') cross[e.node * 4 + e.arm] = e.id;
    city.ped.crossOf = cross;
}

// --- road bitmap ------------------------------------------------------------
// A black-and-white plan of the city at MAPRES x MAPRES, the "compact road map"
// handed to every brain. The whole city is fitted into the square with a small
// margin so two cities of different aspect ratio still produce comparable
// pictures.
function buildBitmap(city) {
    const R = ROAD.MAPRES;
    const bm = new Uint8Array(R * R);
    const span = Math.max(city.width, city.height) * 1.02;
    const ox = (span - city.width) / 2, oy = (span - city.height) / 2;
    const cell = span / R;
    city.map = { res: R, span, ox, oy, cell, bits: bm };

    const mark = (x, y) => {
        const i = Math.floor((x + ox) / cell), j = Math.floor((y + oy) / cell);
        if (i >= 0 && i < R && j >= 0 && j < R) bm[j * R + i] = 1;
    };
    for (const e of city.edges) {
        const halfW = (e.hw ? ROAD.LANE * 1.3 : ROAD.LANE) + 0.6;
        const steps = Math.ceil(e.centre.len / (cell * 0.5)) + 1;
        for (let s = 0; s <= steps; s++) {
            const p = polyAt(e.centre, (s / steps) * e.centre.len);
            const nx = -Math.sin(p.a), ny = Math.cos(p.a);
            for (let w = -halfW; w <= halfW; w += cell * 0.5) mark(p.x + nx * w, p.y + ny * w);
        }
    }
    for (const n of city.nodes) {
        if (n.portal) continue;
        const r = n.round ? n.stopR * 0.8 : ROAD.CORNER;
        for (let dx = -r; dx <= r; dx += cell * 0.5) {
            for (let dy = -r; dy <= r; dy += cell * 0.5) {
                if (n.round && Math.hypot(dx, dy) > r) continue;
                mark(n.x + dx, n.y + dy);
            }
        }
    }

    const P = ROAD.MAPPOOL, f = R / P;
    const pooled = new Float64Array(P * P);
    for (let j = 0; j < P; j++) {
        for (let i = 0; i < P; i++) {
            let s = 0;
            for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) s += bm[(j * f + b) * R + (i * f + a)];
            pooled[j * P + i] = s / (f * f);
        }
    }
    city.map.pooled = pooled;
}

function egoCrop(city, x, y) {
    const R = ROAD.MAPRES, E = ROAD.EGO, P = ROAD.EGOPOOL, f = E / P;
    const m = city.map;
    const ci = Math.floor((x + m.ox) / m.cell), cj = Math.floor((y + m.oy) / m.cell);
    const crop = new Float64Array(E * E);
    for (let j = 0; j < E; j++) {
        for (let i = 0; i < E; i++) {
            const si = ci - (E >> 1) + i, sj = cj - (E >> 1) + j;
            crop[j * E + i] = (si >= 0 && si < R && sj >= 0 && sj < R) ? m.bits[sj * R + si] : 0;
        }
    }
    const pooled = new Float64Array(P * P);
    for (let j = 0; j < P; j++) {
        for (let i = 0; i < P; i++) {
            let s = 0;
            for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) s += crop[(j * f + b) * E + (i * f + a)];
            pooled[j * P + i] = s / (f * f);
        }
    }
    return pooled;
}

// --- per-signal static context ---------------------------------------------
function buildSignalContext(city) {
    const S = city.signals.length;
    const scale = Math.max(city.width, city.height);
    city.lightInfo = [];
    for (let s = 0; s < S; s++) {
        const n = city.nodes[city.signals[s]];
        // Road-connected neighbours, per compass arm. An arm that ends in a
        // portal, a roundabout or an unsignalised bend has no neighbour and
        // reads as absent - the controller has to notice it is on its own in
        // that direction.
        const adj = [];
        for (let k = 0; k < 4; k++) {
            const e = n.arms[k];
            let info = null;
            if (e) {
                const otherId = e.a === n.id ? e.b : e.a;
                const o = city.nodes[otherId];
                if (o.signal) {
                    info = {
                        sig: o.sigIdx, node: otherId,
                        dx: (o.x - n.x) / scale, dy: (o.y - n.y) / scale,
                        dist: e.len / scale, travel: e.len / e.speed,
                        inLink: n.in[k] ? n.in[k].id : -1
                    };
                }
            }
            adj.push(info);
        }
        const adjSet = new Set(adj.filter(Boolean).map(a => a.sig));
        const far = [];
        for (let t = 0; t < S; t++) {
            if (t === s || adjSet.has(t)) continue;
            const o = city.nodes[city.signals[t]];
            far.push({ sig: t, d: Math.hypot(o.x - n.x, o.y - n.y), dx: (o.x - n.x) / scale, dy: (o.y - n.y) / scale });
        }
        far.sort((a, b) => a.d - b.d);
        far.length = Math.min(4, far.length);

        city.lightInfo.push({
            sig: s, node: n.id, x: n.x, y: n.y,
            nx: n.x / city.width, ny: n.y / city.height,
            idNorm: S > 1 ? s / (S - 1) : 0.5,
            arms: [0, 1, 2, 3].map(k => !!n.arms[k]),
            armCount: n.deg,
            adj, far,
            ego: egoCrop(city, n.x, n.y)
        });
    }
}

if (typeof module !== 'undefined') {
    module.exports = {
        ROAD, DIRV, OPP, DIR_NAME, CITY_TIERS,
        makeCity, nextLinkTo, cornerPos, egoCrop, polyAt, connPointAt,
        obbOverlap, hasBridge, makePoly, offsetPoly, cornerSpeed
    };
}
