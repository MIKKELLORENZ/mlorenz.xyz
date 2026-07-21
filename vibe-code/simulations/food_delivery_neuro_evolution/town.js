// Procedural top-down town generator. Everything is deterministic from a seed.
// Pure data generation is separated from rendering so headless/Node smoke
// tests can build towns without a DOM.
//
// Geometry conventions: x right, y down. Angle 0 = east, increasing clockwise.
// rightNormal(d) = (-dy, dx) - a car heading east has the south lane on its right.
//
// Every edge is a POLYLINE (straight edges have 2 points): {pts, cum, len,
// halfW, laneOff, oneway, dirA, dirB}. dirA/dirB are compass codes (0=E 1=S
// 2=W 3=N) of the tangent LEAVING node a / node b along the edge - endpoint
// tangents are axis-aligned by construction (curvature lives mid-edge), so
// intersection logic (U-turn ban, corners, crosswalks) stays simple.
//
// Town variants (rotated by the town counter): 0 classic grid, 1 roundabout,
// 2 one-way couplet, 3 curves + roundabout + one-way.
'use strict';

const TOWN_W = 1600, TOWN_H = 1200;
const ROAD_HALF = 17;                 // half road width (34 total = two 14px lanes + shoulders)
const ONEWAY_HALF = 10;               // slim one-way street half width (single lane)
const LANE_OFFSET = 8.5;              // right-lane centerline offset from road centerline
const SIDEWALK_W = 8;
const NODE_HALF = ROAD_HALF + 5;      // intersection box half-size (corner-cut radius)
const STOPLINE_DIST = ROAD_HALF + 6;  // stop line distance from node center
const LIGHT_CYCLE = 20;               // seconds: 7 green + 2 yellow + 1 all-red per direction
const GRID_CELL = 64;
const RB_R = 30;                      // roundabout ring centerline radius

const ROOF_COLORS = ['#e8734a', '#d95f3b', '#b8bcc2', '#9aa0a8', '#8a6f5c', '#63b0a8', '#c9a04e', '#7f8a94', '#d9884a'];
const GRASS_BASE = '#7db94e';

// ---------------------------------------------------------------------------
// Polyline edge helpers (shared by routing, spawning, lane checks, rendering)
// ---------------------------------------------------------------------------

function _compass(dx, dy) {
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : (dy >= 0 ? 1 : 3);
}

// Fill cum/len/dirA/dirB from pts.
function _edgeFinalize(e) {
    const pts = e.pts;
    const cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) {
        cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    e.cum = cum;
    e.len = cum[pts.length - 1];
    e.dirA = _compass(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const n = pts.length - 1;
    e.dirB = _compass(pts[n - 1].x - pts[n].x, pts[n - 1].y - pts[n].y);
    e.x1 = pts[0].x; e.y1 = pts[0].y;
    e.x2 = pts[n].x; e.y2 = pts[n].y;
    return e;
}

// Point + unit tangent at arc length s along the edge polyline (a -> b).
function edgePointAt(e, s) {
    const pts = e.pts, cum = e.cum;
    s = clamp(s, 0, e.len);
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / segLen;
    const A = pts[i - 1], B = pts[i];
    const tx = (B.x - A.x) / segLen, ty = (B.y - A.y) / segLen;
    return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, tx, ty };
}

// Nearest point on the edge polyline: {d, s, tx, ty, side} where side is the
// signed perpendicular offset (positive = right of a->b travel direction).
function edgeNearest(e, x, y) {
    const pts = e.pts, cum = e.cum;
    let best = null;
    for (let i = 1; i < pts.length; i++) {
        const A = pts[i - 1], B = pts[i];
        const abx = B.x - A.x, aby = B.y - A.y;
        const len2 = abx * abx + aby * aby;
        if (len2 <= 0) continue;
        const t = clamp(((x - A.x) * abx + (y - A.y) * aby) / len2, 0, 1);
        const px = A.x + abx * t, py = A.y + aby * t;
        const d = Math.hypot(x - px, y - py);
        if (!best || d < best.d) {
            const segLen = Math.sqrt(len2);
            const tx = abx / segLen, ty = aby / segLen;
            best = { d, s: cum[i - 1] + t * segLen, tx, ty, side: tx * (y - py) - ty * (x - px) };
        }
    }
    return best;
}

// Sub-polyline between arc lengths s0 < s1 (includes interior vertices).
function edgeSubPts(e, s0, s1) {
    const out = [];
    const p0 = edgePointAt(e, s0);
    out.push({ x: p0.x, y: p0.y });
    for (let i = 1; i < e.pts.length - 1; i++) {
        if (e.cum[i] > s0 + 1 && e.cum[i] < s1 - 1) out.push({ x: e.pts[i].x, y: e.pts[i].y });
    }
    const p1 = edgePointAt(e, s1);
    out.push({ x: p1.x, y: p1.y });
    return out;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function _roadLinePositions(rng, total, margin, minCount, maxCount) {
    // Walk across the span placing lines 215-330px apart; retry until the
    // count lands within [minCount, maxCount].
    for (let attempt = 0; attempt < 40; attempt++) {
        const lines = [];
        let pos = margin + rng() * 50;
        while (pos < total - margin) {
            lines.push(Math.round(pos));
            pos += 215 + rng() * 115;
        }
        if (lines.length >= minCount && lines.length <= maxCount) return lines;
    }
    // Fallback: evenly spaced minCount lines.
    const lines = [];
    for (let i = 0; i < minCount; i++) {
        lines.push(Math.round(margin + (total - 2 * margin) * (i / (minCount - 1))));
    }
    return lines;
}

function generateTown(seed, variant) {
    variant = ((variant | 0) % 4 + 4) % 4;
    const rng = mulberry32(mixSeed(seed, 0x70A0 + variant));
    const town = {
        seed, variant, W: TOWN_W, H: TOWN_H,
        vLines: _roadLinePositions(rng, TOWN_W, 85, 4, 6),
        hLines: _roadLinePositions(rng, TOWN_H, 80, 3, 5),
        nodes: [], edges: [], buildings: [], trees: [], decor: [],
        restaurants: [], homes: [], blocks: [], lights: [],
        roundabout: null, roundabouts: [], bulges: []
    };
    // Trim dead margin beyond the outermost roads so towns fill their canvas.
    town.W = Math.min(TOWN_W, town.vLines[town.vLines.length - 1] + 85);
    town.H = Math.min(TOWN_H, town.hLines[town.hLines.length - 1] + 80);
    const nv = town.vLines.length, nh = town.hLines.length;

    // Nodes at every line crossing.
    for (let j = 0; j < nh; j++) {
        for (let i = 0; i < nv; i++) {
            town.nodes.push({ id: j * nv + i, ix: i, iy: j, x: town.vLines[i], y: town.hLines[j], edges: [], light: null, port: false });
        }
    }
    const nodeAt = (i, j) => town.nodes[j * nv + i];

    // Candidate edges along every line between adjacent crossings.
    const allEdges = [];
    for (let j = 0; j < nh; j++) {
        for (let i = 0; i < nv - 1; i++) {
            allEdges.push({ a: nodeAt(i, j).id, b: nodeAt(i + 1, j).id, axis: 'h', perimeter: j === 0 || j === nh - 1 });
        }
    }
    for (let i = 0; i < nv; i++) {
        for (let j = 0; j < nh - 1; j++) {
            allEdges.push({ a: nodeAt(i, j).id, b: nodeAt(i, j + 1).id, axis: 'v', perimeter: i === 0 || i === nv - 1 });
        }
    }

    // Remove ~15% of interior edges while keeping the graph connected and
    // never creating dead ends (both endpoints keep degree >= 2).
    const kept = allEdges.slice();
    const degree = new Array(town.nodes.length).fill(0);
    for (const e of kept) { degree[e.a]++; degree[e.b]++; }
    const removable = kept.filter(e => !e.perimeter);
    for (let i = removable.length - 1; i > 0; i--) {
        const k = Math.floor(rng() * (i + 1));
        [removable[i], removable[k]] = [removable[k], removable[i]];
    }
    const removeTarget = Math.round(removable.length * 0.15);
    const removedSet = new Set();
    let removedCount = 0;
    const connectedWithout = () => {
        const adj = new Map();
        for (const e of kept) {
            if (removedSet.has(e)) continue;
            if (!adj.has(e.a)) adj.set(e.a, []);
            if (!adj.has(e.b)) adj.set(e.b, []);
            adj.get(e.a).push(e.b); adj.get(e.b).push(e.a);
        }
        const seen = new Set([0]);
        const stack = [0];
        while (stack.length) {
            const n = stack.pop();
            for (const m of (adj.get(n) || [])) if (!seen.has(m)) { seen.add(m); stack.push(m); }
        }
        return seen.size === town.nodes.length;
    };
    for (const e of removable) {
        if (removedCount >= removeTarget) break;
        if (degree[e.a] < 3 || degree[e.b] < 3) continue;
        removedSet.add(e);
        if (connectedWithout()) {
            degree[e.a]--; degree[e.b]--;
            removedCount++;
        } else {
            removedSet.delete(e);
        }
    }

    // Final edge list with polyline geometry.
    let eid = 0;
    for (const e of kept) {
        if (removedSet.has(e)) {
            const A = town.nodes[e.a], B = town.nodes[e.b];
            town.decor.push({ type: 'greenway', x1: A.x, y1: A.y, x2: B.x, y2: B.y });
            continue;
        }
        const A = town.nodes[e.a], B = town.nodes[e.b];
        const edge = _edgeFinalize({
            id: eid++, a: e.a, b: e.b, axis: e.axis,
            pts: [{ x: A.x, y: A.y }, { x: B.x, y: B.y }],
            halfW: ROAD_HALF, laneOff: LANE_OFFSET, oneway: false
        });
        town.edges.push(edge);
        A.edges.push(edge.id); B.edges.push(edge.id);
    }

    // Variant flavor: roundabouts, curves, slim one-ways, wide avenues.
    // Every variant keeps its signature feature; the rest is sprinkled with
    // moderate probability for extra variety.
    if (variant === 1 || variant === 3) _makeRoundabout(town, rng);
    if (variant === 1 && rng() < 0.3) _makeRoundabout(town, rng);
    if (variant === 2 && rng() < 0.5) _makeRoundabout(town, rng);
    const nCurves = (variant === 1 ? 1 : variant === 3 ? 2 : 0) +
        (((variant === 0 && rng() < 0.4) || (variant === 2 && rng() < 0.3)) ? 1 : 0);
    if (nCurves > 0) _makeCurves(town, rng, nCurves);
    if (variant === 2) _makeOneways(town, rng, 3);
    if (variant === 3) _makeOneways(town, rng, 1);
    if (variant === 0 || rng() < 0.45) _makeAvenue(town, rng);

    // Traffic lights: most 4-ways plus a share of 3-ways (never roundabout
    // ports; roundabouts self-regulate).
    const fourWays = town.nodes.filter(n => !n.port && n.edges.length === 4);
    const threeWays = town.nodes.filter(n => !n.port && n.edges.length === 3);
    for (const arr of [fourWays, threeWays]) {
        for (let i = arr.length - 1; i > 0; i--) {
            const k = Math.floor(rng() * (i + 1));
            [arr[i], arr[k]] = [arr[k], arr[i]];
        }
    }
    const light4 = Math.max(Math.min(2, fourWays.length), Math.round(fourWays.length * 0.7));
    const light3 = Math.round(threeWays.length * 0.3);
    for (let i = 0; i < light4; i++) {
        fourWays[i].light = { offset: Math.floor(rng() * LIGHT_CYCLE) };
        town.lights.push(fourWays[i].id);
    }
    for (let i = 0; i < light3; i++) {
        threeWays[i].light = { offset: Math.floor(rng() * LIGHT_CYCLE) };
        town.lights.push(threeWays[i].id);
    }

    _generateBlocks(town, rng, nv, nh, nodeAt);
    _assignPOIs(town, rng);
    _scatterTrees(town, rng);
    _buildStaticGrid(town);
    _buildSidewalkLoops(town);
    return town;
}

// Bow one or two long straight two-way edges into gentle curves. End tangents
// stay axis-aligned (sin^2 taper), so node geometry is untouched; the bulge
// side is recorded so the adjacent block and its sidewalk shift out of the way.
function _makeCurves(town, rng, count) {
    const cands = town.edges.filter(e =>
        !e.oneway && e.pts.length === 2 && e.len >= 235 &&
        !town.nodes[e.a].port && !town.nodes[e.b].port &&
        town.nodes[e.a].edges.length >= 3 && town.nodes[e.b].edges.length >= 3 &&
        !town.bulges.some(bu => bu.edgeId === e.id));
    for (let i = cands.length - 1; i > 0; i--) {
        const k = Math.floor(rng() * (i + 1));
        [cands[i], cands[k]] = [cands[k], cands[i]];
    }
    for (let c = 0; c < Math.min(count, cands.length); c++) {
        const e = cands[c];
        const amp = (16 + rng() * 8) * (rng() < 0.5 ? 1 : -1);   // signed: + = right of a->b
        const A = e.pts[0], B = e.pts[1];
        const ux = (B.x - A.x) / e.len, uy = (B.y - A.y) / e.len;
        const nx = -uy, ny = ux;                                  // right normal of a->b
        const pts = [];
        const N = 12;
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const off = amp * Math.pow(Math.sin(Math.PI * t), 2);
            pts.push({ x: A.x + (B.x - A.x) * t + nx * off, y: A.y + (B.y - A.y) * t + ny * off });
        }
        e.pts = pts;
        e.axis = 'c';
        _edgeFinalize(e);
        town.bulges.push({ edgeId: e.id, amp });
    }
}

// Convert an interior 4-way into a roundabout: the node becomes a grass
// island, its four edges are shortened to port nodes on a ring of radius
// RB_R, and four one-way quarter arcs (right-hand circulation) connect the
// ports. Port tangents are axis-aligned, so the no-U-turn A* needs nothing
// special - and the one-way arcs make U-turns on the ring impossible anyway.
function _makeRoundabout(town, rng) {
    const cands = town.nodes.filter(n => {
        if (n.port || n.edges.length !== 4) return false;
        if (town.roundabouts.some(rb => dist2(n.x, n.y, rb.x, rb.y) < 320 * 320)) return false;
        return n.edges.every(id => {
            const e = town.edges[id];
            return e.pts.length === 2 && !e.oneway && e.len >= 150;
        });
    });
    if (!cands.length) return;
    const cx = town.W / 2, cy = town.H / 2;
    cands.sort((a, b) => (dist2(a.x, a.y, cx, cy) - dist2(b.x, b.y, cx, cy)) || (a.id - b.id));
    const R = cands[0];

    // One port per compass direction, on the ring.
    const portFor = {};   // compass code -> node
    for (const code of [0, 1, 2, 3]) {
        const dx = code === 0 ? 1 : code === 2 ? -1 : 0;
        const dy = code === 1 ? 1 : code === 3 ? -1 : 0;
        const p = { id: town.nodes.length, ix: -1, iy: -1, x: R.x + dx * RB_R, y: R.y + dy * RB_R, edges: [], light: null, port: true };
        town.nodes.push(p);
        portFor[code] = p;
    }
    // Re-anchor each incident edge to its port.
    for (const id of R.edges.slice()) {
        const e = town.edges[id];
        const away = e.a === R.id
            ? _compass(e.pts[1].x - e.pts[0].x, e.pts[1].y - e.pts[0].y)
            : _compass(e.pts[e.pts.length - 2].x - e.pts[e.pts.length - 1].x, e.pts[e.pts.length - 2].y - e.pts[e.pts.length - 1].y);
        const port = portFor[away];
        if (e.a === R.id) { e.a = port.id; e.pts[0] = { x: port.x, y: port.y }; }
        else { e.b = port.id; e.pts[e.pts.length - 1] = { x: port.x, y: port.y }; }
        _edgeFinalize(e);
        port.edges.push(e.id);
    }
    R.edges = [];   // island: no edges, unreachable, purely decorative

    // Right-hand circulation: W->S->E->N->W (canvas y-down; bearing right on
    // entry). Quarter arcs sampled every 15 degrees.
    const seq = [[2, 1], [1, 0], [0, 3], [3, 2]];   // [fromCode, toCode]
    const angOf = { 0: 0, 1: Math.PI / 2, 2: Math.PI, 3: -Math.PI / 2 };
    for (const [fc, tc] of seq) {
        const from = portFor[fc], to = portFor[tc];
        let a0 = angOf[fc], a1 = angOf[tc];
        while (a1 > a0) a1 -= 2 * Math.PI;          // circulation = decreasing angle
        const pts = [];
        const steps = 6;
        for (let i = 0; i <= steps; i++) {
            const a = a0 + (a1 - a0) * (i / steps);
            pts.push({ x: R.x + Math.cos(a) * RB_R, y: R.y + Math.sin(a) * RB_R });
        }
        const arc = _edgeFinalize({
            id: town.edges.length, a: from.id, b: to.id, axis: 'c',
            pts, halfW: ONEWAY_HALF, laneOff: 0, oneway: true, ring: true
        });
        town.edges.push(arc);
        from.edges.push(arc.id); to.edges.push(arc.id);
    }
    const rb = { x: R.x, y: R.y, r: RB_R, nodeId: R.id };
    town.roundabouts.push(rb);
    if (!town.roundabout) town.roundabout = rb;
    town.decor.push({ type: 'island', x: R.x, y: R.y, r: RB_R - ONEWAY_HALF - 3 });
}

// Widen one whole interior grid line into a broad avenue: bigger road width
// and lane offset, same two-way rules. Everything downstream (lane checks,
// spawns, doors, rendering) reads per-edge halfW/laneOff.
function _makeAvenue(town, rng) {
    const lines = [];
    for (let i = 1; i < town.vLines.length - 1; i++) lines.push({ axis: 'v', pos: town.vLines[i] });
    for (let j = 1; j < town.hLines.length - 1; j++) lines.push({ axis: 'h', pos: town.hLines[j] });
    if (!lines.length) return;
    const pick = lines[Math.floor(rng() * lines.length)];
    for (const e of town.edges) {
        if (e.oneway || e.ring || e.pts.length !== 2 || e.axis !== pick.axis) continue;
        if (town.nodes[e.a].port || town.nodes[e.b].port) continue;
        const on = pick.axis === 'h' ? (e.y1 === pick.pos && e.y2 === pick.pos)
                                     : (e.x1 === pick.pos && e.x2 === pick.pos);
        if (!on) continue;
        e.halfW = 21; e.laneOff = 10.5; e.avenue = true;
    }
}

// Slim one-way streets: canonicalize direction a->b, narrow the road, single
// centered lane. Every conversion must keep the DIRECTED graph strongly
// connected (every node still reaches every node), else it is reverted.
function _makeOneways(town, rng, count) {
    const stronglyConnected = () => {
        const live = town.nodes.filter(n => n.edges.length > 0);
        if (!live.length) return true;
        const reach = (forward) => {
            const adj = new Map();
            for (const n of live) adj.set(n.id, []);
            for (const e of town.edges) {
                adj.get(e.a).push(e.b);
                if (!e.oneway) adj.get(e.b).push(e.a);
                else if (!forward) { /* backward pass uses reversed edges below */ }
            }
            if (!forward) {
                for (const [k, v] of adj) v.length = 0;
                for (const e of town.edges) {
                    adj.get(e.b).push(e.a);
                    if (!e.oneway) adj.get(e.a).push(e.b);
                }
            }
            const seen = new Set([live[0].id]);
            const stack = [live[0].id];
            while (stack.length) {
                const n = stack.pop();
                for (const m of adj.get(n) || []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
            }
            return seen.size === live.length;
        };
        return reach(true) && reach(false);
    };
    const cands = town.edges.filter(e =>
        !e.oneway && !e.ring && e.pts.length === 2 && e.len >= 150 && e.len <= 420 &&
        !town.nodes[e.a].port && !town.nodes[e.b].port &&
        town.nodes[e.a].edges.length >= 3 && town.nodes[e.b].edges.length >= 3);
    for (let i = cands.length - 1; i > 0; i--) {
        const k = Math.floor(rng() * (i + 1));
        [cands[i], cands[k]] = [cands[k], cands[i]];
    }
    let made = 0;
    for (const e of cands) {
        if (made >= count) break;
        const flip = rng() < 0.5;
        if (flip) {
            const t = e.a; e.a = e.b; e.b = t;
            e.pts.reverse();
            _edgeFinalize(e);
        }
        e.oneway = true; e.halfW = ONEWAY_HALF; e.laneOff = 0;
        if (stronglyConnected()) { made++; continue; }
        // Try the other direction before giving up on this edge.
        const t = e.a; e.a = e.b; e.b = t;
        e.pts.reverse();
        _edgeFinalize(e);
        if (stronglyConnected()) { made++; continue; }
        e.oneway = false; e.halfW = ROAD_HALF; e.laneOff = LANE_OFFSET;
        const t2 = e.a; e.a = e.b; e.b = t2;   // restore original orientation
        e.pts.reverse();
        _edgeFinalize(e);
    }
}

// Blocks between adjacent road lines, filled by layout type.
function _generateBlocks(town, rng, nv, nh, nodeAt) {
    const inset = ROAD_HALF + SIDEWALK_W + 3;
    for (let bj = 0; bj < nh - 1; bj++) {
        for (let bi = 0; bi < nv - 1; bi++) {
            let x0 = town.vLines[bi] + inset, x1 = town.vLines[bi + 1] - inset;
            let y0 = town.hLines[bj] + inset, y1 = town.hLines[bj + 1] - inset;
            // Edges bordering this block (used to face buildings toward live
            // roads and to dodge curve bulges).
            const sideEdge = {
                top: _findEdgeBetween(town, nodeAt(bi, bj).id, nodeAt(bi + 1, bj).id),
                bottom: _findEdgeBetween(town, nodeAt(bi, bj + 1).id, nodeAt(bi + 1, bj + 1).id),
                left: _findEdgeBetween(town, nodeAt(bi, bj).id, nodeAt(bi, bj + 1).id),
                right: _findEdgeBetween(town, nodeAt(bi + 1, bj).id, nodeAt(bi, bj + 1).id) ||
                       _findEdgeBetween(town, nodeAt(bi + 1, bj).id, nodeAt(bi + 1, bj + 1).id)
            };
            // A curved road bows into one of the neighboring blocks: measure
            // the actual polyline, and where it dips inside the block rect,
            // push that side in so lawns and buildings keep clear.
            for (const [side, e] of Object.entries(sideEdge)) {
                if (!e || e.pts.length === 2) continue;
                for (const p of e.pts) {
                    if (side === 'top' && p.y > town.hLines[bj] && p.y + e.halfW + SIDEWALK_W + 2 > y0) y0 = p.y + e.halfW + SIDEWALK_W + 2;
                    if (side === 'bottom' && p.y < town.hLines[bj + 1] && p.y - e.halfW - SIDEWALK_W - 2 < y1) y1 = p.y - e.halfW - SIDEWALK_W - 2;
                    if (side === 'left' && p.x > town.vLines[bi] && p.x + e.halfW + SIDEWALK_W + 2 > x0) x0 = p.x + e.halfW + SIDEWALK_W + 2;
                    if (side === 'right' && p.x < town.vLines[bi + 1] && p.x - e.halfW - SIDEWALK_W - 2 < x1) x1 = p.x - e.halfW - SIDEWALK_W - 2;
                }
            }
            if (x1 - x0 < 70 || y1 - y0 < 70) continue;
            const r = rng();
            const type = r < 0.52 ? 'residential' : r < 0.68 ? 'park' : r < 0.80 ? 'plaza' : 'mixed';
            const block = { x0, y0, x1, y1, bi, bj, type, tint: (rng() - 0.5) * 14 };
            town.blocks.push(block);
            if (type === 'park') {
                if (rng() < 0.6) {
                    town.decor.push({
                        type: 'pond', x: (x0 + x1) / 2 + (rng() - 0.5) * 40,
                        y: (y0 + y1) / 2 + (rng() - 0.5) * 30,
                        rx: 28 + rng() * 30, ry: 20 + rng() * 22
                    });
                }
                block.park = true;
                continue;
            }
            if (type === 'plaza') {
                const pw = Math.min(120, x1 - x0 - 20), ph = Math.min(90, y1 - y0 - 20);
                town.decor.push({ type: rng() < 0.5 ? 'plaza' : 'parking', x: (x0 + x1 - pw) / 2, y: (y0 + y1 - ph) / 2, w: pw, h: ph, rng: rng() });
            }
            if (type === 'residential' || type === 'mixed' || type === 'plaza') {
                _placeBuildingsOnSide(town, rng, block, 'top', sideEdge.top);
                _placeBuildingsOnSide(town, rng, block, 'bottom', sideEdge.bottom);
                if (y1 - y0 > 190) {
                    _placeBuildingsOnSide(town, rng, block, 'left', sideEdge.left);
                    _placeBuildingsOnSide(town, rng, block, 'right', sideEdge.right);
                }
            }
        }
    }
}

function _findEdgeBetween(town, aId, bId) {
    for (const e of town.edges) {
        if ((e.a === aId && e.b === bId) || (e.a === bId && e.b === aId)) return e;
    }
    return null;
}

function _placeBuildingsOnSide(town, rng, block, side, edge) {
    const horizontal = side === 'top' || side === 'bottom';
    const start = (horizontal ? block.x0 : block.y0) + 34;
    const end = (horizontal ? block.x1 : block.y1) - 34;
    if (end - start < 52) return;
    const maxDepth = Math.max(34, Math.min(66, ((horizontal ? block.y1 - block.y0 : block.x1 - block.x0) - 24) / 2));
    let cursor = start + rng() * 14;
    while (cursor + 46 <= end) {
        const w = 46 + rng() * 44;
        if (cursor + w > end) break;
        if (rng() < 0.14) { cursor += w * 0.6; continue; } // random gap
        const d = 34 + rng() * (maxDepth - 34);
        let bx, by, bw, bh, doorX, doorY;
        if (side === 'top') { bx = cursor; by = block.y0; bw = w; bh = d; doorX = bx + bw / 2; doorY = by; }
        else if (side === 'bottom') { bx = cursor; by = block.y1 - d; bw = w; bh = d; doorX = bx + bw / 2; doorY = block.y1; }
        else if (side === 'left') { bx = block.x0; by = cursor; bw = d; bh = w; doorX = block.x0; doorY = by + bh / 2; }
        else { bx = block.x1 - d; by = cursor; bw = d; bh = w; doorX = block.x1; doorY = by + bh / 2; }
        // Reject overlap with already placed buildings (corners of perpendicular sides).
        let clash = false;
        for (const o of town.buildings) {
            if (bx < o.x + o.w + 6 && bx + bw + 6 > o.x && by < o.y + o.h + 6 && by + bh + 6 > o.y) { clash = true; break; }
        }
        if (!clash) {
            const b = {
                x: bx, y: by, w: bw, h: bh, side,
                color: ROOF_COLORS[Math.floor(rng() * ROOF_COLORS.length)],
                detail: rng(), kind: 'plain',
                door: { x: doorX, y: doorY },
                faceEdge: edge ? edge.id : null,
                lane: null
            };
            if (edge) b.lane = _doorLanePoint(town, edge, b);
            town.buildings.push(b);
        }
        cursor += w + 8 + rng() * 16;
    }
}

// Snap a building door to the adjacent legal-lane centerline. Two-way roads:
// the lane whose travel direction has the building on its right. One-way
// roads: the single centered lane in the a->b direction. Curved edges carry
// no doors (they return null and the building simply isn't POI-eligible).
function _doorLanePoint(town, edge, b) {
    if (edge.axis === 'c') return null;
    const lo = NODE_HALF + 16, hi = edge.len - NODE_HALF - 16;
    if (hi <= lo) return null;
    if (edge.oneway) {
        const p = edgeNearest(edge, b.door.x, b.door.y);
        if (!p) return null;
        const s = clamp(p.s, lo, hi);
        const q = edgePointAt(edge, s);
        return { x: q.x, y: q.y, dirX: Math.round(q.tx), dirY: Math.round(q.ty), edgeId: edge.id };
    }
    if (edge.axis === 'h') {
        const south = b.door.y > edge.y1;            // building south of the road
        const dirX = south ? 1 : -1;                 // south side is the eastbound lane
        const laneY = edge.y1 + (south ? edge.laneOff : -edge.laneOff);
        const lo2 = Math.min(edge.x1, edge.x2) + NODE_HALF + 16;
        const hi2 = Math.max(edge.x1, edge.x2) - NODE_HALF - 16;
        if (hi2 <= lo2) return null;
        const laneX = clamp(b.door.x, lo2, hi2);
        return { x: laneX, y: laneY, dirX, dirY: 0, edgeId: edge.id };
    }
    const east = b.door.x > edge.x1;             // building east of the road
    const dirY = east ? -1 : 1;                  // east side is the northbound lane
    const laneX = edge.x1 + (east ? edge.laneOff : -edge.laneOff);
    const lo3 = Math.min(edge.y1, edge.y2) + NODE_HALF + 16;
    const hi3 = Math.max(edge.y1, edge.y2) - NODE_HALF - 16;
    if (hi3 <= lo3) return null;
    const laneY = clamp(b.door.y, lo3, hi3);
    return { x: laneX, y: laneY, dirX: 0, dirY, edgeId: edge.id };
}

function _assignPOIs(town, rng) {
    const eligible = [];
    for (let i = 0; i < town.buildings.length; i++) {
        if (town.buildings[i].lane) eligible.push(i);
    }
    for (let i = eligible.length - 1; i > 0; i--) {
        const k = Math.floor(rng() * (i + 1));
        [eligible[i], eligible[k]] = [eligible[k], eligible[i]];
    }
    const nRest = Math.min(10, Math.max(4, Math.floor(eligible.length * 0.18)));
    const nHome = Math.min(18, eligible.length - nRest);
    for (let i = 0; i < nRest; i++) {
        town.buildings[eligible[i]].kind = 'restaurant';
        town.restaurants.push(eligible[i]);
    }
    for (let i = nRest; i < nRest + nHome; i++) {
        town.buildings[eligible[i]].kind = 'home';
        town.homes.push(eligible[i]);
    }
}

function _treeFitsRoads(town, x, y, r) {
    // Keep trees clear of kept road polylines (greenways are fine).
    for (const e of town.edges) {
        const pad = e.halfW + r + 3;
        const near = edgeNearest(e, x, y);
        if (near && near.d < pad) return false;
    }
    for (const rb of town.roundabouts) {
        const pad = rb.r + ONEWAY_HALF + r;
        if (dist2(x, y, rb.x, rb.y) < pad * pad) return false;
    }
    return true;
}

function _scatterTrees(town, rng) {
    const tryPlace = (x, y, r) => {
        if (x < 20 || y < 20 || x > town.W - 20 || y > town.H - 20) return;
        if (!_treeFitsRoads(town, x, y, r)) return;
        for (const b of town.buildings) {
            if (x + r > b.x - 4 && x - r < b.x + b.w + 4 && y + r > b.y - 4 && y - r < b.y + b.h + 4) return;
        }
        for (const t of town.trees) {
            if (dist2(x, y, t.x, t.y) < (r + t.r) * (r + t.r) * 0.55) return;
        }
        town.trees.push({ x, y, r });
    };
    for (const block of town.blocks) {
        const w = block.x1 - block.x0, h = block.y1 - block.y0;
        if (block.type === 'park') {
            const clusters = 2 + Math.floor(rng() * 3);
            for (let c = 0; c < clusters; c++) {
                const cx = block.x0 + 24 + rng() * (w - 48);
                const cy = block.y0 + 24 + rng() * (h - 48);
                const n = 3 + Math.floor(rng() * 4);
                for (let t = 0; t < n; t++) {
                    tryPlace(cx + (rng() - 0.5) * 56, cy + (rng() - 0.5) * 56, 6 + rng() * 5.5);
                }
            }
        } else if (block.type === 'mixed' || rng() < 0.4) {
            const n = 1 + Math.floor(rng() * 4);
            for (let t = 0; t < n; t++) {
                tryPlace(block.x0 + 16 + rng() * (w - 32), block.y0 + 16 + rng() * (h - 32), 5.5 + rng() * 4.5);
            }
        }
    }
    // Green strips where roads were removed.
    for (const d of town.decor) {
        if (d.type !== 'greenway') continue;
        const n = 3 + Math.floor(rng() * 4);
        for (let t = 0; t < n; t++) {
            const f = 0.15 + rng() * 0.7;
            tryPlace(d.x1 + (d.x2 - d.x1) * f + (rng() - 0.5) * 18, d.y1 + (d.y2 - d.y1) * f + (rng() - 0.5) * 18, 6 + rng() * 5);
        }
    }
    // A little island greenery.
    for (const rb of town.roundabouts) {
        for (let t = 0; t < 3; t++) {
            const a = rng() * Math.PI * 2, rr = rng() * (rb.r - ONEWAY_HALF - 12);
            const x = rb.x + Math.cos(a) * rr, y = rb.y + Math.sin(a) * rr;
            town.trees.push({ x, y, r: 4.5 + rng() * 3 });
        }
    }
}

// ---------------------------------------------------------------------------
// Spatial hash of static obstacles (buildings as walls, trees) and roads.
// ---------------------------------------------------------------------------

function _buildStaticGrid(town) {
    const gw = Math.ceil(town.W / GRID_CELL), gh = Math.ceil(town.H / GRID_CELL);
    const cells = new Array(gw * gh);
    const insert = (cx0, cy0, cx1, cy1, item) => {
        for (let cy = Math.max(0, cy0); cy <= Math.min(gh - 1, cy1); cy++) {
            for (let cx = Math.max(0, cx0); cx <= Math.min(gw - 1, cx1); cx++) {
                const k = cy * gw + cx;
                (cells[k] || (cells[k] = [])).push(item);
            }
        }
    };
    for (const b of town.buildings) {
        insert(Math.floor(b.x / GRID_CELL), Math.floor(b.y / GRID_CELL),
            Math.floor((b.x + b.w) / GRID_CELL), Math.floor((b.y + b.h) / GRID_CELL),
            { type: 'wall', x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
    }
    for (const t of town.trees) {
        insert(Math.floor((t.x - t.r) / GRID_CELL), Math.floor((t.y - t.r) / GRID_CELL),
            Math.floor((t.x + t.r) / GRID_CELL), Math.floor((t.y + t.r) / GRID_CELL),
            { type: 'tree', x: t.x, y: t.y, r: t.r });
    }
    for (const e of town.edges) {
        const pad = e.halfW + SIDEWALK_W + 6;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of e.pts) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        insert(Math.floor((minX - pad) / GRID_CELL), Math.floor((minY - pad) / GRID_CELL),
            Math.floor((maxX + pad) / GRID_CELL), Math.floor((maxY + pad) / GRID_CELL),
            { type: 'road', edge: e });
    }
    town.grid = { cells, gw, gh, cell: GRID_CELL };
}

function townCellItems(town, x, y) {
    const g = town.grid;
    const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell);
    if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) return null;
    return g.cells[cy * g.gw + cx] || null;
}

// Signed lane position of a point given a heading: +1..0 = legal right half,
// negative = oncoming half. On one-way roads the sole legal direction is
// a->b: driving with it reads as lane +0.6 (legal), against it as lane -1
// with wrongWay set. Returns {lane, onRoad, edge, dist, halfW, wrongWay};
// dist is the perpendicular distance to the nearest covering road centerline
// (Infinity when no road covers this point - i.e. deep in the grass).
function lanePosition(town, x, y, hx, hy) {
    let best = null, bestN = null, bestD = Infinity;
    const items = townCellItems(town, x, y);
    if (items) {
        for (const it of items) {
            if (it.type !== 'road') continue;
            const near = edgeNearest(it.edge, x, y);
            if (!near) continue;
            // Allow a little slack past the polyline ends (intersection area).
            if (near.d < bestD) { bestD = near.d; best = it.edge; bestN = near; }
        }
    }
    if (!best || bestD > best.halfW + SIDEWALK_W) {
        return { lane: 0, onRoad: false, edge: null, dist: best ? bestD : Infinity, halfW: best ? best.halfW : ROAD_HALF, wrongWay: false };
    }
    const along = hx * bestN.tx + hy * bestN.ty;    // heading vs a->b tangent
    let lane, wrongWay = false;
    if (best.oneway) {
        wrongWay = along < 0;
        lane = wrongWay ? -1 : 0.6;                 // legal one-way driving reads as "right side"
    } else {
        // Signed lateral offset in the travel frame: side is right-of-(a->b);
        // traveling b->a flips which side is "right".
        lane = (along >= 0 ? bestN.side : -bestN.side) / best.halfW;
    }
    return {
        lane: clamp(lane, -1, 1), onRoad: bestD <= best.halfW + 2,
        edge: best, dist: bestD, halfW: best.halfW, wrongWay
    };
}

// Traffic light state for cars approaching a node along an axis at sim time t.
// Returns 'green' | 'yellow' | 'red'. Nodes without lights are always 'green'.
// Phase layout includes a 1s ALL-RED clearance after each yellow (p 10-11
// and p 0-1): traffic that legally entered on yellow can clear the box
// before the cross direction launches. The same second is the non-fatal
// grace window in the red-crossing check (lightRedAge <= RED_GRACE).
function lightStateAt(node, axis, t) {
    if (!node.light) return 'green';
    const p = ((t + node.light.offset) % LIGHT_CYCLE + LIGHT_CYCLE) % LIGHT_CYCLE;
    if (axis === 'v') {                            // north-south traffic
        return p >= 1 && p < 8 ? 'green' : p >= 8 && p < 10 ? 'yellow' : 'red';
    }
    return p >= 11 && p < 18 ? 'green' : p >= 18 ? 'yellow' : 'red';
}

// Seconds since this axis' light last turned red; 0 when it is not red.
function lightRedAge(node, axis, t) {
    if (lightStateAt(node, axis, t) !== 'red') return 0;
    const p = ((t + node.light.offset) % LIGHT_CYCLE + LIGHT_CYCLE) % LIGHT_CYCLE;
    if (axis === 'v') return p >= 10 ? p - 10 : p + 10;   // red spans 10-20 and 0-1
    return p;                                             // red spans 0-11
}

// ---------------------------------------------------------------------------
// Pedestrian sidewalk loops: one rectangular loop per block, plus curb corner
// records at intersections used for crossings.
// ---------------------------------------------------------------------------

function _buildSidewalkLoops(town) {
    const off = ROAD_HALF + SIDEWALK_W / 2;
    town.sidewalkLoops = [];
    for (const b of town.blocks) {
        let x0 = town.vLines[b.bi] + off, x1 = town.vLines[b.bi + 1] - off;
        let y0 = town.hLines[b.bj] + off, y1 = town.hLines[b.bj + 1] - off;
        // Respect curve-bulged block rects (block coords already pushed in).
        x0 = Math.max(x0, b.x0 - SIDEWALK_W / 2 - 2);
        x1 = Math.min(x1, b.x1 + SIDEWALK_W / 2 + 2);
        y0 = Math.max(y0, b.y0 - SIDEWALK_W / 2 - 2);
        y1 = Math.min(y1, b.y1 + SIDEWALK_W / 2 + 2);
        if (x1 - x0 < 30 || y1 - y0 < 30) continue;
        const pts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
        // Nudge corners that would land on a roundabout ring.
        for (const rb of town.roundabouts) {
            const clear = rb.r + ONEWAY_HALF + SIDEWALK_W / 2 + 3;
            for (const p of pts) {
                const d = Math.sqrt(dist2(p.x, p.y, rb.x, rb.y));
                if (d < clear && d > 0.01) {
                    p.x = rb.x + (p.x - rb.x) / d * clear;
                    p.y = rb.y + (p.y - rb.y) / d * clear;
                }
            }
        }
        town.sidewalkLoops.push({ pts });
    }
}

// ---------------------------------------------------------------------------
// Static pre-render (browser only): grass, roads, markings, buildings, trees.
// ---------------------------------------------------------------------------

function _strokeEdgePath(ctx, e) {
    ctx.beginPath();
    ctx.moveTo(e.pts[0].x, e.pts[0].y);
    for (let i = 1; i < e.pts.length; i++) ctx.lineTo(e.pts[i].x, e.pts[i].y);
    ctx.stroke();
}

function renderTownStatic(town) {
    const cv = document.createElement('canvas');
    cv.width = town.W; cv.height = town.H;
    const ctx = cv.getContext('2d');

    ctx.fillStyle = GRASS_BASE;
    ctx.fillRect(0, 0, town.W, town.H);
    for (const b of town.blocks) {
        ctx.fillStyle = b.type === 'park' ? '#6fb244' : `hsl(${95 + b.tint}, 45%, ${52 + b.tint * 0.4}%)`;
        ctx.fillRect(b.x0 - 8, b.y0 - 8, b.x1 - b.x0 + 16, b.y1 - b.y0 + 16);
    }

    // Decor under roads: greenways.
    for (const d of town.decor) {
        if (d.type === 'greenway') {
            ctx.strokeStyle = '#74b548';
            ctx.lineWidth = ROAD_HALF * 2;
            ctx.beginPath(); ctx.moveTo(d.x1, d.y1); ctx.lineTo(d.x2, d.y2); ctx.stroke();
        }
    }

    // Sidewalk strips then asphalt (polyline-aware; curves render smoothly).
    ctx.lineJoin = 'round';
    for (const e of town.edges) {
        ctx.strokeStyle = '#c6ccd2';
        ctx.lineWidth = (e.halfW + SIDEWALK_W) * 2;
        ctx.lineCap = 'square';
        _strokeEdgePath(ctx, e);
    }
    for (const e of town.edges) {
        ctx.strokeStyle = '#50565c';
        ctx.lineWidth = e.halfW * 2;
        _strokeEdgePath(ctx, e);
    }
    // Intersection patches (asphalt squares slightly larger to clean the joins).
    for (const n of town.nodes) {
        if (!n.edges.length || n.port) continue;
        let hw = 0;
        for (const eid of n.edges) hw = Math.max(hw, town.edges[eid].halfW);
        ctx.fillStyle = '#50565c';
        ctx.fillRect(n.x - hw, n.y - hw, hw * 2, hw * 2);
    }
    // Roundabout island on top of the ring asphalt.
    for (const d of town.decor) {
        if (d.type !== 'island') continue;
        ctx.fillStyle = '#6fb244';
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(244,246,248,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r + 1, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#57c8e8';
        ctx.beginPath(); ctx.arc(d.x, d.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(d.x, d.y, 5.6, 0, Math.PI * 2); ctx.stroke();
    }

    // Centerline dashes on two-way roads (skip intersection boxes).
    ctx.strokeStyle = 'rgba(244,246,248,0.85)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([9, 9]);
    for (const e of town.edges) {
        if (e.oneway) continue;
        const m = NODE_HALF + 4;
        if (e.len <= m * 2 + 8) continue;
        const sub = edgeSubPts(e, m, e.len - m);
        ctx.beginPath();
        ctx.moveTo(sub[0].x, sub[0].y);
        for (let i = 1; i < sub.length; i++) ctx.lineTo(sub[i].x, sub[i].y);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // One-way arrows (chevrons pointing along the legal direction).
    ctx.fillStyle = 'rgba(244,246,248,0.85)';
    for (const e of town.edges) {
        if (!e.oneway || e.ring) continue;
        for (const f of [0.28, 0.52, 0.76]) {
            const p = edgePointAt(e, e.len * f);
            const bx = p.x - p.tx * 5, by = p.y - p.ty * 5;
            ctx.beginPath();
            ctx.moveTo(p.x + p.tx * 4, p.y + p.ty * 4);
            ctx.lineTo(bx - p.ty * 4, by + p.tx * 4);
            ctx.lineTo(bx + p.ty * 4, by - p.tx * 4);
            ctx.closePath();
            ctx.fill();
        }
    }
    // Ring circulation arrows.
    for (const e of town.edges) {
        if (!e.ring) continue;
        const p = edgePointAt(e, e.len * 0.5);
        const bx = p.x - p.tx * 4, by = p.y - p.ty * 4;
        ctx.beginPath();
        ctx.moveTo(p.x + p.tx * 3.4, p.y + p.ty * 3.4);
        ctx.lineTo(bx - p.ty * 3.2, by + p.tx * 3.2);
        ctx.lineTo(bx + p.ty * 3.2, by - p.tx * 3.2);
        ctx.closePath();
        ctx.fill();
    }

    // Crosswalk zebras + stop lines at every approach of every intersection.
    // Approach direction = compass tangent from the node outward along the edge.
    const DIRV = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
    for (const n of town.nodes) {
        if (n.port || !n.edges.length) continue;
        for (const eid of n.edges) {
            const e = town.edges[eid];
            if (!e) continue;
            const code = e.a === n.id ? e.dirA : e.dirB;
            const dv = DIRV[code];
            const hw = e.halfW;
            // Zebra: a striped band across the road just outside the node box.
            const bandC = ROAD_HALF + 7;
            ctx.fillStyle = 'rgba(244,246,248,0.88)';
            const stripes = Math.max(3, Math.floor((hw * 2 - 3) / 5.4));
            for (let k = 0; k < stripes; k++) {
                const along = -hw + 2 + k * 5.4;
                if (dv.x !== 0) ctx.fillRect(n.x + dv.x * bandC - 3, n.y + along, 6, 3.4);
                else ctx.fillRect(n.x + along, n.y + dv.y * bandC - 3, 3.4, 6);
            }
            // Stop line only where a light controls this approach, on the
            // incoming lane (right side for traffic heading INTO the node).
            if (n.light) {
                ctx.strokeStyle = 'rgba(244,246,248,0.95)';
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                if (dv.x !== 0) {
                    const sx = n.x + dv.x * STOPLINE_DIST;
                    if (dv.x === 1) { ctx.moveTo(sx, n.y - hw + 1); ctx.lineTo(sx, n.y); }
                    else { ctx.moveTo(sx, n.y); ctx.lineTo(sx, n.y + hw - 1); }
                } else {
                    const sy = n.y + dv.y * STOPLINE_DIST;
                    if (dv.y === 1) { ctx.moveTo(n.x, sy); ctx.lineTo(n.x + hw - 1, sy); }
                    else { ctx.moveTo(n.x - hw + 1, sy); ctx.lineTo(n.x, sy); }
                }
                ctx.stroke();
            }
        }
    }

    // Ponds, plazas, parking.
    for (const d of town.decor) {
        if (d.type === 'pond') {
            ctx.fillStyle = '#57c8e8';
            ctx.beginPath(); ctx.ellipse(d.x, d.y, d.rx, d.ry, 0, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke();
        } else if (d.type === 'plaza') {
            ctx.fillStyle = '#cfd4cf';
            ctx.fillRect(d.x, d.y, d.w, d.h);
        } else if (d.type === 'parking') {
            ctx.fillStyle = '#8b9198';
            ctx.fillRect(d.x, d.y, d.w, d.h);
            ctx.strokeStyle = 'rgba(244,246,248,0.75)';
            ctx.lineWidth = 1.4;
            const stalls = Math.floor(d.w / 18);
            for (let s = 0; s <= stalls; s++) {
                ctx.beginPath();
                ctx.moveTo(d.x + s * 18, d.y + 4);
                ctx.lineTo(d.x + s * 18, d.y + Math.min(26, d.h - 8));
                ctx.stroke();
            }
        }
    }

    // Buildings: shadow, walls, roof, details.
    for (const b of town.buildings) {
        ctx.fillStyle = 'rgba(30,40,30,0.25)';
        ctx.fillRect(b.x + 3, b.y + 4, b.w, b.h);
        ctx.fillStyle = _shade(b.color, -26);
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5);
        // Rooftop details keyed off the per-building random detail value.
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        if (b.detail < 0.4) {                     // AC units
            ctx.fillRect(b.x + b.w * 0.2, b.y + b.h * 0.25, 7, 7);
            ctx.fillRect(b.x + b.w * 0.6, b.y + b.h * 0.55, 7, 7);
        } else if (b.detail < 0.7) {              // ridge line
            ctx.fillRect(b.x + b.w / 2 - 1, b.y + 4, 2, b.h - 8);
        } else {                                  // skylight
            ctx.fillStyle = 'rgba(140,200,235,0.8)';
            ctx.fillRect(b.x + b.w * 0.3, b.y + b.h * 0.3, b.w * 0.25, b.h * 0.22);
        }
        // Door mark on the street-facing edge.
        ctx.fillStyle = 'rgba(40,44,48,0.85)';
        const ds = 5;
        if (b.side === 'top') ctx.fillRect(b.door.x - ds / 2, b.y - 1, ds, 3.5);
        else if (b.side === 'bottom') ctx.fillRect(b.door.x - ds / 2, b.y + b.h - 2.5, ds, 3.5);
        else if (b.side === 'left') ctx.fillRect(b.x - 1, b.door.y - ds / 2, 3.5, ds);
        else ctx.fillRect(b.x + b.w - 2.5, b.door.y - ds / 2, 3.5, ds);
        // POI base badges (rings drawn dynamically for active jobs).
        if (b.kind === 'restaurant') {
            ctx.fillStyle = '#ff8c42';
            ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 5.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 2.2, 0, Math.PI * 2); ctx.fill();
        } else if (b.kind === 'home') {
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 3.4, 0, Math.PI * 2); ctx.fill();
        }
    }

    // Trees: dark base + light crown.
    for (const t of town.trees) {
        ctx.fillStyle = '#3f8f43';
        ctx.beginPath(); ctx.arc(t.x + 1, t.y + 1.5, t.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5cae57';
        ctx.beginPath(); ctx.arc(t.x - t.r * 0.15, t.y - t.r * 0.2, t.r * 0.82, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.35, t.r * 0.3, 0, Math.PI * 2); ctx.fill();
    }

    return cv;
}

function _shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
    r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
    return `rgb(${r},${g},${b})`;
}

if (typeof module !== 'undefined') {
    module.exports = {
        TOWN_W, TOWN_H, ROAD_HALF, ONEWAY_HALF, LANE_OFFSET, SIDEWALK_W, NODE_HALF,
        STOPLINE_DIST, LIGHT_CYCLE, GRID_CELL, RB_R,
        generateTown, townCellItems, lanePosition, lightStateAt, lightRedAge,
        edgePointAt, edgeNearest, edgeSubPts
    };
}
