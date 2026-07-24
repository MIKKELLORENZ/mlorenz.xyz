// GPS subsystem: A* over the road graph, lane-aware waypoint routes,
// route-following math (cross-track / heading error / progress counter),
// and the precomputed pickup->delivery job pool.
//
// Edges are polylines (see town.js). Endpoint tangents are always compass-
// aligned, so the directed no-U-turn A* works on compass codes; curvature and
// one-way narrowing are handled by the shared edge helpers.
'use strict';

const WAYPOINT_SPACING = 40;
const WP_ADVANCE_RADIUS = 18;
const OFFROUTE_DIST = 55;          // |cross-track| beyond this = off route
const RECOVER_DIST = 90;           // overshoot window: past the route end but
                                   // still this close, the GPS aims BACK at the
                                   // target (brake/reverse) instead of replanning
const RECOVER_SPEED = 70;          // px/s; faster overshoots skip the window -
                                   // flipping the heading cue on a car speeding
                                   // forward destabilizes its steering, and it
                                   // could not stop-and-reverse anyway
const TURN_SIGNIFICANT = 0.12;     // rad; smaller deviations are "straight"
const TURN_LOOKAHEAD = 420;        // px scanned ahead for the turn-preview inputs

function rightNormal(dx, dy) { return { x: -dy, y: dx }; }

// Compass code of the tangent LEAVING nodeId along the edge.
function _dirAway(edge, nodeId) { return edge.a === nodeId ? edge.dirA : edge.dirB; }

function buildAdjacency(town) {
    const adj = new Map();
    for (const n of town.nodes) adj.set(n.id, []);
    for (const e of town.edges) {
        adj.get(e.a).push({ to: e.b, edge: e });
        if (!e.oneway) adj.get(e.b).push({ to: e.a, edge: e });
    }
    town.adj = adj;
    return adj;
}

function _edgeById(town, id) { return town.edges[id] !== undefined && town.edges[id].id === id ? town.edges[id] : town.edges.find(e => e.id === id); }

// Node-side trim: how much of the edge near each node belongs to the
// intersection (short ring arcs keep most of their arc).
function _trimOf(e) { return Math.min(NODE_HALF, e.len * 0.33); }

// Arc position + travel sign for an arbitrary lane point {x,y,dirX,dirY,edgeId}.
function _laneRef(town, lane) {
    const e = _edgeById(town, lane.edgeId);
    if (!e) return null;
    const near = edgeNearest(e, lane.x, lane.y);
    if (!near) return null;
    const sign = e.oneway ? 1 : ((lane.dirX * near.tx + lane.dirY * near.ty) >= 0 ? 1 : -1);
    return { edge: e, s: near.s, sign };
}

// Nearest legal lane point for an arbitrary position+heading (used for
// replans and phase-1 spawns).
function nearestLanePoint(town, x, y, hx, hy) {
    let best = null, bestD = Infinity;
    for (const e of town.edges) {
        const near = edgeNearest(e, x, y);
        if (!near) continue;
        const s = clamp(near.s, _trimOf(e), Math.max(_trimOf(e), e.len - _trimOf(e)));
        const q = edgePointAt(e, s);
        const sign = e.oneway ? 1 : ((hx * q.tx + hy * q.ty) >= 0 ? 1 : -1);
        const tx = q.tx * sign, ty = q.ty * sign;
        const rn = rightNormal(tx, ty);
        const px = q.x + rn.x * e.laneOff, py = q.y + rn.y * e.laneOff;
        const score = Math.hypot(x - px, y - py);
        if (score < bestD) {
            bestD = score;
            best = { x: px, y: py, dirX: tx, dirY: ty, edgeId: e.id, s, sign };
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// A* + route assembly
// ---------------------------------------------------------------------------

function _astar(town, startId, goalId, goalX, goalY) {
    const adj = town.adj || buildAdjacency(town);
    const g = new Map([[startId, 0]]);
    const f = new Map([[startId, Math.hypot(town.nodes[startId].x - goalX, town.nodes[startId].y - goalY)]]);
    const came = new Map();
    const open = new Set([startId]);
    const closed = new Set();
    while (open.size) {
        let cur = null, curF = Infinity;
        for (const n of open) { const fn = f.get(n); if (fn < curF) { curF = fn; cur = n; } }
        if (cur === goalId) {
            const path = [cur];
            while (came.has(path[0])) path.unshift(came.get(path[0]));
            return path;
        }
        open.delete(cur); closed.add(cur);
        for (const { to, edge } of adj.get(cur)) {
            if (closed.has(to)) continue;
            const cand = g.get(cur) + edge.len + 12;   // small per-node cost prefers straighter routes
            if (cand < (g.has(to) ? g.get(to) : Infinity)) {
                came.set(to, cur);
                g.set(to, cand);
                f.set(to, cand + Math.hypot(town.nodes[to].x - goalX, town.nodes[to].y - goalY));
                open.add(to);
            }
        }
    }
    return null;
}

// A* over DIRECTED states (node, arrival direction) with the reverse
// transition banned - U-turns are impossible by construction, so a target
// behind the car forces the longer way around the block. `bannedGoalDir` is
// the arrival direction at the goal that would need a U-turn to depart onto
// the destination lane. Directions come from edge endpoint tangents, so
// curved edges and one-way ring arcs need nothing special. Returns the node
// sequence (nodes may repeat when the path loops a block).
function _astarNoUturn(town, startId, startDir, goalId, bannedGoalDir, goalX, goalY) {
    const adj = town.adj || buildAdjacency(town);
    const sKey = startId * 4 + startDir;
    const g = new Map([[sKey, 0]]);
    const f = new Map([[sKey, Math.hypot(town.nodes[startId].x - goalX, town.nodes[startId].y - goalY)]]);
    const came = new Map();
    const open = new Set([sKey]);
    const closed = new Set();
    while (open.size) {
        let cur = -1, curF = Infinity;
        for (const k of open) { const fk = f.get(k); if (fk < curF) { curF = fk; cur = k; } }
        if (cur < 0) return null;
        const node = cur >> 2, arr = cur & 3;
        if (node === goalId && arr !== bannedGoalDir) {
            const path = [node];
            let k = cur;
            while (came.has(k)) { k = came.get(k); path.unshift(k >> 2); }
            return path;
        }
        open.delete(cur); closed.add(cur);
        for (const { to, edge } of adj.get(node)) {
            const dc = _dirAway(edge, node);                 // departure tangent
            if (dc === (arr + 2) % 4) continue;              // no U-turns
            const arrDc = (_dirAway(edge, to) + 2) % 4;      // heading INTO `to`
            const nKey = to * 4 + arrDc;
            if (closed.has(nKey)) continue;
            const cand = g.get(cur) + edge.len + (dc === arr ? 0 : 25);   // corners cost a little
            if (cand < (g.has(nKey) ? g.get(nKey) : Infinity)) {
                came.set(nKey, cur);
                g.set(nKey, cand);
                f.set(nKey, cand + Math.hypot(town.nodes[to].x - goalX, town.nodes[to].y - goalY));
                open.add(nKey);
            }
        }
    }
    return null;
}

// Lane-offset polyline for traveling the edge between arc positions s0 -> s1
// (travel order; sign = +1 means a->b). Vertices are offset to the legal lane
// by the per-vertex right normal, which follows curves smoothly.
function _lanePts(e, s0, s1, sign) {
    const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    if (hi - lo < 2) {
        const q = edgePointAt(e, lo);
        const tx = q.tx * sign, ty = q.ty * sign;
        const rn = rightNormal(tx, ty);
        return [{ x: q.x + rn.x * e.laneOff, y: q.y + rn.y * e.laneOff }];
    }
    const sub = edgeSubPts(e, lo, hi).map(p => ({ x: p.x, y: p.y }));
    if (sign < 0) sub.reverse();
    if (e.laneOff === 0) return sub;
    const out = [];
    for (let i = 0; i < sub.length; i++) {
        const A = sub[Math.max(0, i - 1)], B = sub[Math.min(sub.length - 1, i + 1)];
        const dx = B.x - A.x, dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        const rn = rightNormal(dx / len, dy / len);
        out.push({ x: sub[i].x + rn.x * e.laneOff, y: sub[i].y + rn.y * e.laneOff });
    }
    return out;
}

// Unit travel tangent at arc position s.
function _laneTangent(e, s, sign) {
    const q = edgePointAt(e, clamp(s, 0, e.len));
    return { x: q.tx * sign, y: q.ty * sign };
}

function _lineIntersect(p1, d1, p2, d2) {
    const det = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(det) < 1e-6) return null;
    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / det;
    if (!Number.isFinite(t) || Math.abs(t) > 80) return null;
    return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

// Build the lane-aware waypoint route from a start lane point to an end lane
// point (the end is always approached along its legal lane direction).
function buildRoute(town, startLane, endLane) {
    if (!startLane || !endLane) return null;
    if (!town.adj) buildAdjacency(town);
    const sRef = _laneRef(town, startLane);
    const eRef = _laneRef(town, endLane);
    if (!sRef || !eRef) return null;
    const sEdge = sRef.edge, eEdge = eRef.edge;

    // Same edge, same direction, target ahead -> direct along-lane route.
    if (sEdge.id === eEdge.id && sRef.sign === eRef.sign) {
        const ahead = (eRef.s - sRef.s) * sRef.sign;
        if (ahead > 24) {
            return _finishRoute(town, _lanePts(sEdge, sRef.s, eRef.s, sRef.sign), [], endLane);
        }
    }

    const startNode = sRef.sign > 0 ? sEdge.b : sEdge.a;      // node ahead of the start
    const endNode = eRef.sign > 0 ? eEdge.a : eEdge.b;        // node behind the end lane
    const startDir = (_dirAway(sEdge, startNode) + 2) % 4;    // arrival heading INTO startNode
    // Arriving at the goal node heading opposite the destination lane would
    // require a U-turn to depart onto it - that arrival direction is banned.
    const bannedGoalDir = (_dirAway(eEdge, endNode) + 2) % 4;
    let nodePath;
    if (startNode === endNode && startDir !== bannedGoalDir) {
        nodePath = [startNode];
    } else {
        const gN = town.nodes[endNode];
        nodePath = _astarNoUturn(town, startNode, startDir, endNode, bannedGoalDir, gN.x, gN.y);
        // Resilience fallback only - on a strongly connected graph a
        // U-turn-free path always exists.
        if (!nodePath) nodePath = _astar(town, startNode, endNode, gN.x, gN.y);
        if (!nodePath) return null;
    }

    // Legs: travel spans over edges, trimmed near nodes; corners in between.
    const legs = [];
    legs.push({
        e: sEdge, sign: sRef.sign, s0: sRef.s,
        s1: sRef.sign > 0 ? Math.max(sRef.s, sEdge.len - _trimOf(sEdge)) : Math.min(sRef.s, _trimOf(sEdge)),
        viaNode: null
    });
    for (let i = 0; i < nodePath.length - 1; i++) {
        const u = nodePath[i], v = nodePath[i + 1];
        let edge = null;
        for (const cand of town.adj.get(u)) if (cand.to === v) { edge = cand.edge; break; }
        if (!edge) return null;
        const sign = edge.a === u ? 1 : -1;
        const tr = _trimOf(edge);
        legs.push({
            e: edge, sign,
            s0: sign > 0 ? tr : edge.len - tr,
            s1: sign > 0 ? edge.len - tr : tr,
            viaNode: u
        });
    }
    legs.push({
        e: eEdge, sign: eRef.sign,
        s0: eRef.sign > 0 ? _trimOf(eEdge) : eEdge.len - _trimOf(eEdge),
        s1: eRef.s,
        viaNode: nodePath[nodePath.length - 1]
    });

    const pts = [];
    const corners = [];
    for (const p of _lanePts(legs[0].e, legs[0].s0, legs[0].s1, legs[0].sign)) pts.push(p);
    for (let i = 1; i < legs.length; i++) {
        const prev = legs[i - 1], cur = legs[i];
        const node = town.nodes[cur.viaNode];
        const lanePts = _lanePts(cur.e, cur.s0, cur.s1, cur.sign);
        const p1 = pts[pts.length - 1];
        const p2 = lanePts[0];
        const t1 = _laneTangent(prev.e, prev.s1, prev.sign);
        const t2 = _laneTangent(cur.e, cur.s0, cur.sign);
        // Light stop-line record for the node we are about to cross
        // (rawPts[afterPtIndex - 2] must sample the approach point p1).
        if (node && node.light) {
            corners.push({
                nodeId: node.id,
                axis: Math.abs(t1.x) >= Math.abs(t1.y) ? 'h' : 'v',
                afterPtIndex: pts.length + 1
            });
        }
        if (t1.x * t2.x + t1.y * t2.y < 0.96) {
            // Quadratic bezier corner; control = tangent-line intersection.
            const c = _lineIntersect(p1, t1, p2, t2) || (node ? { x: node.x, y: node.y } : { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
            for (const t of [0.35, 0.7]) {
                const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, cc = t * t;
                pts.push({ x: a * p1.x + b * c.x + cc * p2.x, y: a * p1.y + b * c.y + cc * p2.y });
            }
        }
        for (const p of lanePts) pts.push(p);
    }
    pts.push({ x: endLane.x, y: endLane.y });
    return _finishRoute(town, pts, corners, endLane);
}

// Resample the raw polyline, compute cumulative lengths, turn previews and
// light stop-line route distances.
function _finishRoute(town, rawPts, lightCorners, endLane) {
    // Deduplicate near-identical consecutive points.
    const src = [rawPts[0]];
    for (let i = 1; i < rawPts.length; i++) {
        const p = rawPts[i], q = src[src.length - 1];
        if (dist2(p.x, p.y, q.x, q.y) > 4) src.push(p);
    }
    if (src.length < 2) return null;

    // Map light corner records to positions before resampling.
    const lightPts = lightCorners.map(c => ({
        nodeId: c.nodeId, axis: c.axis,
        x: rawPts[Math.max(0, c.afterPtIndex - 2)].x,
        y: rawPts[Math.max(0, c.afterPtIndex - 2)].y
    }));

    // Resample: keep original vertices, insert extra points every 40px.
    const pts = [src[0]];
    for (let i = 1; i < src.length; i++) {
        const A = src[i - 1], B = src[i];
        const segLen = Math.hypot(B.x - A.x, B.y - A.y);
        const n = Math.floor(segLen / WAYPOINT_SPACING);
        for (let k = 1; k <= n; k++) {
            const t = k / (n + 1);
            pts.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
        }
        pts.push(B);
    }

    const cum = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) {
        cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    const total = cum[pts.length - 1];
    if (total < 8) return null;

    // Per-vertex turn angle (deviation between incoming and outgoing segment).
    const turnAt = new Float64Array(pts.length);
    for (let i = 1; i < pts.length - 1; i++) {
        const a1 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
        const a2 = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
        turnAt[i] = wrapAngle(a2 - a1);
    }
    // For every waypoint: the first and second significant turns ahead.
    const turn1 = new Float64Array(pts.length);
    const turn2 = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
        let found = 0;
        for (let j = i + 1; j < pts.length - 1 && cum[j] - cum[i] < TURN_LOOKAHEAD; j++) {
            if (Math.abs(turnAt[j]) > TURN_SIGNIFICANT) {
                if (found === 0) { turn1[i] = turnAt[j]; found = 1; }
                else { turn2[i] = turnAt[j]; found = 2; break; }
            }
        }
    }

    // Stop-line route distances for lights on the route.
    const lights = [];
    for (const lp of lightPts) {
        let bestI = 0, bestD = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const d = dist2(pts[i].x, pts[i].y, lp.x, lp.y);
            if (d < bestD) { bestD = d; bestI = i; }
        }
        lights.push({ dist: Math.max(0, cum[bestI] - 2), nodeId: lp.nodeId, axis: lp.axis });
    }
    lights.sort((a, b) => a.dist - b.dist);

    return {
        pts, cum, total, turn1, turn2, lights,
        target: { x: endLane.x, y: endLane.y, dirX: endLane.dirX, dirY: endLane.dirY }
    };
}

// ---------------------------------------------------------------------------
// Route following (called on NN ticks). Car carries: routeIdx, maxRouteDist.
// ---------------------------------------------------------------------------

function followRoute(route, car) {
    const pts = route.pts;
    const last = pts.length - 1;
    // Advance the progress counter past waypoints we have reached.
    while (car.routeIdx < last - 1) {
        const A = pts[car.routeIdx], B = pts[car.routeIdx + 1];
        const abx = B.x - A.x, aby = B.y - A.y;
        const len2 = abx * abx + aby * aby;
        const t = len2 > 0 ? ((car.x - A.x) * abx + (car.y - A.y) * aby) / len2 : 1;
        if (t >= 1 || dist2(car.x, car.y, B.x, B.y) < WP_ADVANCE_RADIUS * WP_ADVANCE_RADIUS) {
            car.routeIdx++;
        } else break;
    }
    const i = Math.min(car.routeIdx, last - 1);
    const A = pts[i], B = pts[i + 1];
    const abx = B.x - A.x, aby = B.y - A.y;
    const segLen = Math.hypot(abx, aby) || 1;
    const ux = abx / segLen, uy = aby / segLen;
    const t = clamp(((car.x - A.x) * ux + (car.y - A.y) * uy) / segLen, 0, 1);
    const crossTrack = cross2(ux, uy, car.x - A.x, car.y - A.y);   // + = right of route
    const segAngle = Math.atan2(uy, ux);
    let headingErr = wrapAngle(segAngle - car.theta);
    let wpDist = Math.hypot(B.x - car.x, B.y - car.y);
    const routeDist = route.cum[i] + t * segLen;
    if (routeDist > car.maxRouteDist) car.maxRouteDist = routeDist;
    // Sailing straight past the route's end keeps cross-track at ~0 and
    // heading error at 0 - the GPS would stay silent forever. Detect
    // along-track overshoot of the FINAL point explicitly. Small overshoots
    // enter a RECOVERY window: the GPS points back at the target (heading
    // error flips ~180deg, inviting the net to brake/reverse) rather than
    // instantly rerouting the whole block. Fast or far pass-throughs flag
    // off-route so the replan machinery - and the miss penalty - kick in.
    const beyondEnd = i >= last - 1 &&
        ((car.x - B.x) * ux + (car.y - B.y) * uy) > 16;
    const endDist = Math.hypot(pts[last].x - car.x, pts[last].y - car.y);
    const recovering = beyondEnd && endDist <= RECOVER_DIST &&
        Math.abs(car.v || 0) <= RECOVER_SPEED;
    if (recovering) {
        headingErr = wrapAngle(Math.atan2(pts[last].y - car.y, pts[last].x - car.x) - car.theta);
        wpDist = endDist;
    }
    return {
        crossTrack, headingErr, wpDist,
        turn1: route.turn1[i], turn2: route.turn2[i],
        remainFrac: clamp(1 - routeDist / route.total, 0, 1),
        routeDist, beyondEnd, recovering,
        offRoute: Math.abs(crossTrack) > OFFROUTE_DIST || (beyondEnd && !recovering)
    };
}

// Compass heading (radians) of the route's tangent at an arc-length position
// `dist` px along the route, clamped to the route's extent. Used to feed the
// net the direction the GPS line points AHEAD of the car's current position -
// a look-ahead heading it can steer toward before the turn arrives.
function routeHeadingAt(route, dist) {
    const pts = route.pts, cum = route.cum, last = pts.length - 1;
    if (last < 1) return 0;
    const d = clamp(dist, 0, route.total);
    let i = 0;
    while (i < last - 1 && cum[i + 1] < d) i++;
    const A = pts[i], B = pts[i + 1];
    return Math.atan2(B.y - A.y, B.x - A.x);
}

// Next light-controlled stop line ahead on the route within `range` px.
// Returns {dist, state} or null.
function routeLightAhead(town, route, routeDist, simTime, range) {
    for (const L of route.lights) {
        if (L.dist < routeDist - 6) continue;
        if (L.dist - routeDist > range) return null;
        const node = town.nodes[L.nodeId];
        return { dist: Math.max(0, L.dist - routeDist), state: lightStateAt(node, L.axis === 'h' ? 'h' : 'v', simTime), light: L };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Job pool
// ---------------------------------------------------------------------------

function generateJobs(town, seed, count) {
    const rng = mulberry32(mixSeed(seed, 0x4A0B5));
    const jobs = [];
    const rests = town.restaurants, homes = town.homes;
    if (!rests.length || !homes.length) return jobs;
    let guard = count * 6;
    while (jobs.length < count && guard-- > 0) {
        const rIdx = rests[Math.floor(rng() * rests.length)];
        const hIdx = homes[Math.floor(rng() * homes.length)];
        const rest = town.buildings[rIdx], home = town.buildings[hIdx];
        if (!rest.lane || !home.lane) continue;
        const route = buildRoute(town, rest.lane, home.lane);
        if (!route || route.total < 150) continue;
        jobs.push({ restIdx: rIdx, homeIdx: hIdx, route });
    }
    // Shortest routes first: phase 0 draws from the front of the pool, giving
    // young populations reachable first deliveries.
    jobs.sort((a, b) => a.route.total - b.route.total);
    return jobs;
}

if (typeof module !== 'undefined') {
    module.exports = {
        WAYPOINT_SPACING, OFFROUTE_DIST, RECOVER_DIST, buildAdjacency, nearestLanePoint,
        buildRoute, followRoute, routeHeadingAt, routeLightAhead, generateJobs
    };
}
