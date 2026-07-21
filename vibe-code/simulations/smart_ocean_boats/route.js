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

class Router {
    constructor(map) {
        this.map = map;
        this.gw = map.rgw; this.gh = map.rgh; this.cs = map.rcell;
        this.walk = map.walk;
        this._g = new Float32Array(this.gw * this.gh);
        this._came = new Int32Array(this.gw * this.gh);
        this._closed = new Uint8Array(this.gw * this.gh);
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

    /* Straight segment fully over water (with margin)? */
    lineClear(ax, ay, bx, by) {
        const d = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(2, Math.ceil(d / 0.4));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
            if (this.map.isLand(x, y) || this.map.shoreDist(x, y) < 0.7) return false;
        }
        return true;
    }

    findPath(ax, ay, bx, by) {
        if (this.lineClear(ax, ay, bx, by)) return [[ax, ay], [bx, by]];
        const { gw, gh, cs, walk } = this;
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
        while (open.size) {
            const cur = open.pop();
            if (closed[cur]) continue;
            closed[cur] = 1;
            if (cur === target) { found = true; break; }
            const cx = cur % gw, cy = (cur / gw) | 0;
            for (let k = 0; k < 8; k++) {
                const nx = cx + DX[k], ny = cy + DY[k];
                if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
                const ni = ny * gw + nx;
                if (!walk[ni] || closed[ni]) continue;
                if (k >= 4 && (!walk[cy * gw + nx] || !walk[ny * gw + cx])) continue; // no corner cutting
                const ng = g[cur] + DC[k];
                if (ng < g[ni]) {
                    g[ni] = ng; came[ni] = cur;
                    open.push(ng + Math.hypot(tx - nx, ty - ny), ni);
                }
            }
        }
        if (!found) return [[ax, ay], [bx, by]];   // fallback: straight shot

        const cells = [];
        for (let c = target; c !== -1; c = came[c]) cells.push(c);
        cells.reverse();
        let pts = cells.map(c => [((c % gw) + 0.5) * cs, (((c / gw) | 0) + 0.5) * cs]);
        pts[0] = [ax, ay]; pts[pts.length - 1] = [bx, by];

        // String pulling: keep only the corners that matter.
        const out = [pts[0]];
        let anchor = 0;
        for (let i = 2; i < pts.length; i++) {
            if (!this.lineClear(pts[anchor][0], pts[anchor][1], pts[i][0], pts[i][1])) {
                out.push(pts[i - 1]);
                anchor = i - 1;
            }
        }
        out.push(pts[pts.length - 1]);
        return out;
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
        return { remainAlong: remain, straight, bearing, legHeading, wp };
    }
}

if (typeof module !== "undefined") module.exports = { Router, RouteTracker };
