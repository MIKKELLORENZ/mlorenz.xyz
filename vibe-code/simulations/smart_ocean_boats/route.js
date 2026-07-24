/* route.js — the "GPS unit": A* over the water grid plus a leg tracker that
 * feeds the navigation inputs (distance along route, straight-line distance,
 * bearing to target, heading of the current stretch). */
"use strict";

class MinHeap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
        this.k.push(key); this.v.push(val);
        let i = this.k.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.k[p] <= this.k[i]) break;
            [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
            [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
            i = p;
        }
    }
    pop() {
        const val = this.v[0];
        const lk = this.k.pop(), lv = this.v.pop();
        if (this.k.length) {
            this.k[0] = lk; this.v[0] = lv;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < this.k.length && this.k[l] < this.k[m]) m = l;
                if (r < this.k.length && this.k[r] < this.k[m]) m = r;
                if (m === i) break;
                [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
                [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
                i = m;
            }
        }
        return val;
    }
}

// Shore-clearance policy (metres). Routes keep PREF_CLEAR off the shore for any
// straight or shortcut segment; the A* search additionally pays a penalty for
// running within CLEAR_SAFE of land, so it prefers the roomiest route and only
// hugs a shoreline when a narrow channel leaves no alternative.
const PREF_CLEAR = 1.5;
const CLEAR_SAFE = 2.5;
const CLEAR_W = 1.6;      // penalty weight: extra cell-cost per metre of deficit
const WALL = 0.3;        // map border treated as solid by isLand — clear it too

class Router {
    constructor(map) {
        this.map = map;
        this.gw = map.rgw; this.gh = map.rgh; this.cs = map.rcell;
        this.walk = map.walk;
        this._g = new Float32Array(this.gw * this.gh);
        this._came = new Int32Array(this.gw * this.gh);
        this._closed = new Uint8Array(this.gw * this.gh);
        // clearance (m to nearest shore) sampled at each routing cell centre,
        // so A* can weight cells by how much sea-room they have
        this.rdist = new Float32Array(this.gw * this.gh);
        for (let ry = 0; ry < this.gh; ry++) {
            for (let rx = 0; rx < this.gw; rx++) {
                const cxm = (rx + 0.5) * this.cs, cym = (ry + 0.5) * this.cs;
                const gx = Math.min(map.gw - 1, Math.round(cxm / map.cell));
                const gy = Math.min(map.gh - 1, Math.round(cym / map.cell));
                const edge = Math.min(cxm, cym, map.w - cxm, map.h - cym) - WALL;
                this.rdist[ry * this.gw + rx] = Math.min(map.distLand[gy * map.gw + gx], Math.max(0, edge));
            }
        }
    }

    /* Clearance (m) to the nearest obstacle at a point — real shore or the map
     * border wall, whichever is closer. */
    _clearAt(x, y) {
        const edge = Math.min(x, y, this.map.w - x, this.map.h - y) - WALL;
        return Math.min(this.map.shoreDist(x, y), Math.max(0, edge));
    }

    /* Guarded Laplacian smoothing: nudge each interior waypoint toward the
     * midpoint of its neighbours to soften the turn — but only when the new
     * spot keeps the preferred clearance. Open bends get a gentler racing line;
     * genuinely tight canal corners can't move and stay put. */
    _smooth(pts) {
        if (pts.length < 3) return pts;
        const c = pts.map(p => [p[0], p[1]]);
        for (let iter = 0; iter < 2; iter++) {
            for (let i = 1; i < c.length - 1; i++) {
                const mx = (c[i - 1][0] + c[i + 1][0]) / 2, my = (c[i - 1][1] + c[i + 1][1]) / 2;
                for (const f of [0.5, 0.3, 0.15]) {
                    const nx = c[i][0] + (mx - c[i][0]) * f, ny = c[i][1] + (my - c[i][1]) * f;
                    if (this._clearAt(nx, ny) >= PREF_CLEAR &&
                        this.lineClear(c[i - 1][0], c[i - 1][1], nx, ny, PREF_CLEAR) &&
                        this.lineClear(nx, ny, c[i + 1][0], c[i + 1][1], PREF_CLEAR)) {
                        c[i][0] = nx; c[i][1] = ny; break;
                    }
                }
            }
        }
        return c;
    }

    _cellOf(x, y) {
        const cx = Math.max(0, Math.min(this.gw - 1, (x / this.cs) | 0));
        const cy = Math.max(0, Math.min(this.gh - 1, (y / this.cs) | 0));
        return [cx, cy];
    }

    _nearestWalkable(cx, cy) {
        if (this.walk[cy * this.gw + cx]) return [cx, cy];
        for (let r = 1; r < 40; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= this.gw || ny >= this.gh) continue;
                if (this.walk[ny * this.gw + nx]) return [nx, ny];
            }
        }
        return [cx, cy];
    }

    /* Straight segment fully over water, staying at least `margin` m off shore? */
    lineClear(ax, ay, bx, by, margin) {
        if (margin == null) margin = 0.7;
        const d = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(2, Math.ceil(d / 0.4));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
            if (this.map.isLand(x, y) || this._clearAt(x, y) < margin) return false;
        }
        return true;
    }

    findPath(ax, ay, bx, by) {
        // Only take the direct line if it keeps a comfortable berth off the shore.
        if (this.lineClear(ax, ay, bx, by, PREF_CLEAR)) return [[ax, ay], [bx, by]];
        const { gw, gh, cs, walk, rdist } = this;
        let [sx, sy] = this._nearestWalkable(...this._cellOf(ax, ay));
        let [tx, ty] = this._nearestWalkable(...this._cellOf(bx, by));
        const g = this._g, came = this._came, closed = this._closed;
        g.fill(1e18); came.fill(-1); closed.fill(0);
        const start = sy * gw + sx, target = ty * gw + tx;
        g[start] = 0;
        const open = new MinHeap();
        open.push(Math.hypot(tx - sx, ty - sy), start);
        const DX = [1, -1, 0, 0, 1, 1, -1, -1];
        const DY = [0, 0, 1, -1, 1, -1, 1, -1];
        const DC = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
        let found = false;
        // best-effort target if the search can't reach the goal: the closed cell
        // that came nearest to it (never a straight line through land)
        let bestNode = start, bestH = Math.hypot(tx - sx, ty - sy);
        while (open.size) {
            const cur = open.pop();
            if (closed[cur]) continue;
            closed[cur] = 1;
            if (cur === target) { found = true; break; }
            const cx = cur % gw, cy = (cur / gw) | 0;
            const h = Math.hypot(tx - cx, ty - cy);
            if (h < bestH) { bestH = h; bestNode = cur; }
            for (let k = 0; k < 8; k++) {
                const nx = cx + DX[k], ny = cy + DY[k];
                if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
                const ni = ny * gw + nx;
                if (!walk[ni] || closed[ni]) continue;
                if (k >= 4 && (!walk[cy * gw + nx] || !walk[ny * gw + cx])) continue; // no corner cutting
                // pay a penalty for hugging the shore, so roomier routes win
                // unless a narrow channel leaves no choice
                const clr = rdist[ni];
                const pen = clr >= CLEAR_SAFE ? 0 : (CLEAR_SAFE - clr) * CLEAR_W;
                const ng = g[cur] + DC[k] * (1 + pen);
                if (ng < g[ni]) {
                    g[ni] = ng; came[ni] = cur;
                    open.push(ng + Math.hypot(tx - nx, ty - ny), ni);
                }
            }
        }

        const cells = [];
        for (let c = found ? target : bestNode; c !== -1; c = came[c]) cells.push(c);
        cells.reverse();
        let pts = cells.map(c => [((c % gw) + 0.5) * cs, (((c / gw) | 0) + 0.5) * cs]);
        pts[0] = [ax, ay];
        if (found) pts[pts.length - 1] = [bx, by];   // exact goal
        else pts.push([bx, by]);                      // last resort: hop to goal

        // String pulling: keep only the corners that matter, and only shortcut
        // across a segment that itself holds the preferred clearance — so tight
        // spots stay on the roomier A* corners instead of cutting the bend.
        const out = [pts[0]];
        let anchor = 0;
        for (let i = 2; i < pts.length; i++) {
            if (!this.lineClear(pts[anchor][0], pts[anchor][1], pts[i][0], pts[i][1], PREF_CLEAR)) {
                out.push(pts[i - 1]);
                anchor = i - 1;
            }
        }
        out.push(pts[pts.length - 1]);
        return this._smooth(out);
    }
}

/* Tracks progress along one route. */
class RouteTracker {
    constructor(path) {
        this.path = path;
        this.idx = 1;                      // current waypoint we steer for
        this.total = 0;
        for (let i = 0; i < path.length - 1; i++) {
            this.total += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
        }
        this.total = Math.max(this.total, 0.001);
    }

    get target() { return this.path[this.path.length - 1]; }

    /* Returns navigation readouts; advances waypoints as the boat passes them. */
    update(x, y) {
        const p = this.path;
        while (this.idx < p.length - 1) {
            const wp = p[this.idx];
            if (Math.hypot(wp[0] - x, wp[1] - y) < 3.0) this.idx++;
            else break;
        }
        const wp = p[this.idx];
        let remain = Math.hypot(wp[0] - x, wp[1] - y);
        for (let i = this.idx; i < p.length - 1; i++) {
            remain += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
        }
        const goal = this.target;
        const straight = Math.hypot(goal[0] - x, goal[1] - y);
        const a = p[this.idx - 1] || [x, y];
        const legHeading = Math.atan2(wp[1] - a[1], wp[0] - a[0]);
        const bearing = Math.atan2(wp[1] - y, wp[0] - x);
        // signed perpendicular offset from the current leg line, projected onto
        // the leg's starboard normal so + = right of the line (same sign
        // convention as the boat's bearing/yaw inputs).
        const xte = (y - a[1]) * Math.cos(legHeading) - (x - a[0]) * Math.sin(legHeading);
        return { remainAlong: remain, straight, bearing, legHeading, wp, xte };
    }
}

if (typeof module !== "undefined") module.exports = { Router, RouteTracker };
