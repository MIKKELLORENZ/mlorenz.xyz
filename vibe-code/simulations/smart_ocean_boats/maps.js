/* maps.js — three hand-crafted seas. Nothing is generated at runtime beyond
 * deterministic (fixed-seed) shoreline detailing of hand-placed landforms, so
 * every load produces the identical map.
 *
 * Units are meters. The boats are real-scale: 0.60 m LOA, 0.38 m beam.
 * Grid resolution: 0.25 m for collision/sensing, 0.5 m for routing.
 */
"use strict";

const MAP_DEFS = [
{
    name: "Skerry Archipelago",
    desc: "Open sunlit sea littered with granite skerries. A slow gyre circles the main isle and a steady south-westerly breeze pushes hulls off their line.",
    w: 100, h: 62,
    palette: {
        deep: [10, 62, 92], shallow: [42, 156, 176], sand: [232, 214, 160],
        land: [122, 158, 92], interior: [84, 126, 66], peak: null
    },
    blobs: [
        [24, 30, 8.5, 1.30, 1.0, 0.3],   // main isle
        [15, 9, 4.8], [35, 11, 3.0], [55, 14, 3.4], [61, 19, 2.2],
        [80, 11, 4.2], [91, 29, 2.6], [70, 39, 4.8, 1.2, 0.9, 0.9],
        [45, 47, 3.6], [62, 55, 3.0], [86, 54, 3.2],
        [48, 25, 1.2], [58, 35, 1.0], [30, 50, 1.3], [75, 25, 1.1],
        [12, 25, 1.4], [93, 42, 1.2], [40, 5, 1.1]
    ],
    channels: [],
    docks: [
        { x: 8,  y: 52, name: "West Harbor" },
        { x: 38, y: 31, name: "Isle Quay" },
        { x: 52, y: 6,  name: "North Shoal" },
        { x: 93, y: 17, name: "East Point" },
        { x: 74, y: 58, name: "South Bay" }
    ],
    spawn: { x: 10, y: 42, r: 5 },
    wind: { dir: 0.7, speed: 2.0, gust: 2.0 },
    currents: {
        drift: [0.12, -0.04],
        vortices: [{ x: 24, y: 30, r: 22, s: 0.40 }],
        tidalPeriod: 0
    }
},
{
    name: "Emerald Delta",
    desc: "A jungle river drops out of the highlands, forks around a mangrove island and spills into a silted bay. The downstream current is strong enough to carry a lazy boat clean past its dock.",
    w: 100, h: 62,
    palette: {
        deep: [16, 66, 74], shallow: [63, 143, 107], sand: [207, 192, 138],
        land: [78, 122, 58], interior: [53, 89, 42], peak: null
    },
    blobs: [
        [12, 6, 12], [10, 20, 11], [12, 34, 9], [6, 46, 8],
        [30, 14, 5], [28, 26, 6],
        [78, 6, 15, 1.2, 1.0, 0.2], [84, 20, 12], [74, 32, 9], [90, 38, 8],
        [43, 42, 5],                              // fork island
        [32, 55, 2.2], [68, 57, 2.6], [50, 59, 1.8]
    ],
    channels: [
        { pts: [[50, -2], [47, 8], [40, 16], [38, 24], [44, 32], [43, 38]], carve: 6.0, width: 5.5, speed: 0.65 },
        { pts: [[43, 38], [34, 42], [28, 47], [24, 54], [22, 63]],          carve: 5.0, width: 4.5, speed: 0.55 },
        { pts: [[43, 38], [52, 41], [58, 46], [62, 54], [63, 63]],          carve: 5.0, width: 4.5, speed: 0.55 }
    ],
    docks: [
        { x: 47, y: 6,  name: "Upriver Quay" },
        { x: 39, y: 22, name: "Bend Landing" },
        { x: 44, y: 33, name: "Fork Pier" },
        { x: 24, y: 52, name: "West Mouth" },
        { x: 61, y: 52, name: "East Mouth" },
        { x: 85, y: 57, name: "Bay Port" }
    ],
    spawn: { x: 50, y: 55, r: 5 },
    wind: { dir: 3.3, speed: 1.2, gust: 1.2 },
    currents: {
        drift: [-0.05, 0.06],
        vortices: [],
        tidalPeriod: 0
    }
},
{
    name: "Silver Fjord",
    desc: "Two narrow arms cut deep into snow-capped rock. Katabatic gusts funnel along the water and the tide breathes in and out of the fjords on a slow cycle.",
    w: 100, h: 62,
    palette: {
        deep: [8, 32, 58], shallow: [30, 104, 132], sand: [148, 158, 166],
        land: [96, 114, 124], interior: [62, 76, 86], peak: [232, 238, 243],
        shoreBand: 3, peakStart: 9, peakSpan: 8
    },
    blobs: [
        [8, 4, 9], [24, 4, 9, 1.4, 1.0, 0], [44, 5, 8], [60, 6, 7],
        [12, 22, 8, 1.6, 1.0, 0.1], [30, 21, 7, 1.5, 1.0, 0], [48, 22, 6.5], [60, 22, 5],
        [8, 44, 11], [24, 48, 11, 1.3, 1.0, 0.2], [42, 47, 10], [58, 46, 8],
        [30, 58, 10, 1.6, 1.0, 0], [60, 58, 8],
        [84, 14, 2.4], [88, 36, 2.0], [80, 50, 2.6]
    ],
    channels: [
        { pts: [[76, 13], [58, 13], [44, 12.5], [30, 12], [18, 12], [9, 13]],  carve: 5.0, width: 5.0, speed: 0.45, tidal: true },
        { pts: [[76, 31], [60, 32], [46, 33], [34, 34], [24, 36], [15, 38]],   carve: 5.0, width: 5.0, speed: 0.45, tidal: true }
    ],
    docks: [
        { x: 11, y: 13, name: "North Head" },
        { x: 18, y: 37, name: "Mid Head" },
        { x: 90, y: 10, name: "Sea Gate N" },
        { x: 88, y: 55, name: "Sea Gate S" },
        { x: 82, y: 31, name: "Outer Buoy" }
    ],
    spawn: { x: 88, y: 24, r: 5 },
    wind: { dir: Math.PI, speed: 2.6, gust: 2.6 },
    currents: {
        drift: [0.0, 0.08],
        vortices: [],
        tidalPeriod: 70
    }
},
{
    name: "Lantern Canals",
    desc: "A flooded stone quarter — a tight grid of narrow canals threading between blockhouses. Almost no open water to build speed, and every crossing is a hard turn.",
    w: 100, h: 62,
    palette: {
        deep: [18, 40, 60], shallow: [46, 110, 130], sand: [150, 140, 120],
        land: [120, 112, 96], interior: [86, 80, 68], peak: null
    },
    // near-solid landmass: a 4×3 grid of big overlapping blocks fills the map,
    // then the channels below carve the canals back out of it
    blobs: [
        [12, 12, 14], [37, 12, 14], [62, 12, 14], [87, 12, 13],
        [12, 31, 14], [37, 31, 14], [62, 31, 14], [87, 31, 13],
        [12, 50, 14], [37, 50, 14], [62, 50, 14], [87, 50, 13]
    ],
    channels: [
        // horizontal canals (carve = half-width of the water strip), inset from
        // the map edge so routes never graze the border wall
        { pts: [[6, 12], [94, 12]], carve: 3.1, width: 4.0, speed: 0.30 },
        { pts: [[6, 31], [94, 31]], carve: 3.5, width: 4.0, speed: 0.30 },
        { pts: [[6, 50], [94, 50]], carve: 3.1, width: 4.0, speed: 0.30 },
        // vertical canals (x=37 is a deliberately tight strait; x=62 tighter too)
        { pts: [[12, 6], [12, 56]], carve: 3.1, width: 4.0, speed: 0.30 },
        { pts: [[37, 6], [37, 56]], carve: 2.1, width: 3.5, speed: 0.30 },
        { pts: [[62, 6], [62, 56]], carve: 2.4, width: 3.5, speed: 0.30 },
        { pts: [[87, 6], [87, 56]], carve: 2.9, width: 4.0, speed: 0.30 },
        // diagonal cut-throughs — non-grid routes and awkward acute turns
        { pts: [[12, 31], [37, 12]], carve: 2.3, width: 3.0, speed: 0.30 },
        { pts: [[62, 50], [87, 31]], carve: 2.8, width: 3.5, speed: 0.30 }
    ],
    docks: [
        { x: 12, y: 12, name: "Old Lock" },
        { x: 62, y: 12, name: "North Gate" },
        { x: 37, y: 31, name: "Market Cross" },
        { x: 87, y: 50, name: "South Basin" },
        { x: 12, y: 50, name: "West Wharf" }
    ],
    spawn: { x: 37, y: 50, r: 4 },
    wind: { dir: 1.2, speed: 1.0, gust: 1.0 },
    currents: {
        drift: [0.03, 0.0],
        vortices: [],
        tidalPeriod: 0
    }
},
{
    name: "Open Ocean",
    desc: "Empty blue water to the horizon — no land, no hazards. Point at the mark and open the throttle: where a boat learns to foil flat-out and hold a dead-straight line.",
    w: 100, h: 62,
    palette: {
        deep: [8, 54, 92], shallow: [30, 120, 168], sand: [210, 200, 170],
        land: [120, 140, 110], interior: [90, 110, 80], peak: null
    },
    blobs: [],       // nothing at all — open water inside the border walls
    channels: [],
    docks: [
        { x: 22, y: 16, name: "Buoy Alpha" },
        { x: 78, y: 15, name: "Buoy Bravo" },
        { x: 82, y: 47, name: "Buoy Charlie" },
        { x: 18, y: 46, name: "Buoy Delta" }
    ],
    spawn: { x: 50, y: 31, r: 6 },
    wind: { dir: 0.5, speed: 0.6, gust: 0.6 },
    currents: {
        drift: [0.02, 0.0],
        vortices: [],
        tidalPeriod: 0
    }
}
];

const CELL = 0.25;        // collision / sensor grid resolution (m)
const RCELL = 0.5;        // routing grid resolution (m)

function genBlobPoly(blob, seed) {
    const [cx, cy, r, sx = 1, sy = 1, rot = 0] = blob;
    const rng = mulberry32(seed * 7919 + 13);
    const harm = [];
    for (let h = 0; h < 3; h++) {
        harm.push({ k: 2 + Math.floor(rng() * 5), a: 0.05 + rng() * 0.11, p: rng() * Math.PI * 2 });
    }
    const n = 44, pts = [];
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        let rad = 1;
        for (const h of harm) rad += h.a * Math.sin(h.k * th + h.p);
        const lx = Math.cos(th) * r * rad * sx;
        const ly = Math.sin(th) * r * rad * sy;
        pts.push([cx + lx * cr - ly * sr, cy + lx * sr + ly * cr]);
    }
    return pts;
}

function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
}

/* Two-pass chamfer distance transform (in cells) from all seed cells —
 * near-Euclidean, so shading bands stay circular instead of diamond-shaped. */
function distanceField(grid, gw, gh, seedValue) {
    const dist = new Float32Array(gw * gh);
    const D = Math.SQRT2;
    for (let i = 0; i < dist.length; i++) dist[i] = grid[i] === seedValue ? 0 : 1e9;
    for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
            const i = y * gw + x;
            let d = dist[i];
            if (x > 0) d = Math.min(d, dist[i - 1] + 1);
            if (y > 0) {
                d = Math.min(d, dist[i - gw] + 1);
                if (x > 0) d = Math.min(d, dist[i - gw - 1] + D);
                if (x < gw - 1) d = Math.min(d, dist[i - gw + 1] + D);
            }
            dist[i] = d;
        }
    }
    for (let y = gh - 1; y >= 0; y--) {
        for (let x = gw - 1; x >= 0; x--) {
            const i = y * gw + x;
            let d = dist[i];
            if (x < gw - 1) d = Math.min(d, dist[i + 1] + 1);
            if (y < gh - 1) {
                d = Math.min(d, dist[i + gw] + 1);
                if (x < gw - 1) d = Math.min(d, dist[i + gw + 1] + D);
                if (x > 0) d = Math.min(d, dist[i + gw - 1] + D);
            }
            dist[i] = d;
        }
    }
    return dist;
}

function buildMap(def) {
    const w = def.w, h = def.h;
    const gw = Math.round(w / CELL), gh = Math.round(h / CELL);
    const land = new Uint8Array(gw * gh);

    const polys = def.blobs.map((b, i) => genBlobPoly(b, i + 1));
    const boxes = polys.map(p => {
        let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
        for (const [x, y] of p) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
        return [minx, miny, maxx, maxy];
    });

    for (let gy = 0; gy < gh; gy++) {
        const py = (gy + 0.5) * CELL;
        for (let gx = 0; gx < gw; gx++) {
            const px = (gx + 0.5) * CELL;
            for (let i = 0; i < polys.length; i++) {
                const b = boxes[i];
                if (px < b[0] || px > b[2] || py < b[1] || py > b[3]) continue;
                if (pointInPoly(px, py, polys[i])) { land[gy * gw + gx] = 1; break; }
            }
        }
    }

    // Carve guaranteed waterways along channel polylines (rivers, fjord arms).
    for (const ch of def.channels) {
        if (!ch.carve) continue;
        for (let gy = 0; gy < gh; gy++) {
            const py = (gy + 0.5) * CELL;
            for (let gx = 0; gx < gw; gx++) {
                if (!land[gy * gw + gx]) continue;
                const px = (gx + 0.5) * CELL;
                for (let s = 0; s < ch.pts.length - 1; s++) {
                    const [ax, ay] = ch.pts[s], [bx, by] = ch.pts[s + 1];
                    if (distToSeg(px, py, ax, ay, bx, by) < ch.carve) { land[gy * gw + gx] = 0; break; }
                }
            }
        }
    }

    // Distance fields (meters): water→shore for shading + sensing, land→shore for terrain shading.
    const distLand = distanceField(land, gw, gh, 1);   // distance from any cell to nearest land
    const distWater = distanceField(land, gw, gh, 0);
    for (let i = 0; i < distLand.length; i++) { distLand[i] *= CELL; distWater[i] *= CELL; }

    // Routing grid: walkable water cells with a safety margin off the shore.
    const rgw = Math.round(w / RCELL), rgh = Math.round(h / RCELL);
    const walk = new Uint8Array(rgw * rgh);
    for (let ry = 0; ry < rgh; ry++) {
        for (let rx = 0; rx < rgw; rx++) {
            const gx = Math.min(gw - 1, Math.round((rx + 0.5) * RCELL / CELL));
            const gy = Math.min(gh - 1, Math.round((ry + 0.5) * RCELL / CELL));
            walk[ry * rgw + rx] = (!land[gy * gw + gx] && distLand[gy * gw + gx] > 0.8) ? 1 : 0;
        }
    }

    const map = {
        def, name: def.name, w, h,
        gw, gh, cell: CELL, land, distLand, distWater,
        rgw, rgh, rcell: RCELL, walk,
        docks: def.docks.map(d => ({ ...d })),
        spawn: { ...def.spawn }
    };

    map.isLand = function (x, y) {
        if (x < 0.3 || y < 0.3 || x > w - 0.3 || y > h - 0.3) return true;  // map edge is a wall
        const gx = (x / CELL) | 0, gy = (y / CELL) | 0;
        return land[gy * gw + gx] === 1;
    };
    map.shoreDist = function (x, y) {
        if (x < 0 || y < 0 || x >= w || y >= h) return 0;
        const gx = (x / CELL) | 0, gy = (y / CELL) | 0;
        return distLand[gy * gw + gx];
    };

    /* Water velocity (m/s) at a point — currents the boat drifts with. */
    map.current = function (x, y, t) {
        const c = def.currents;
        let vx = c.drift[0], vy = c.drift[1];
        for (const v of c.vortices) {
            const dx = x - v.x, dy = y - v.y;
            const d = Math.hypot(dx, dy);
            if (d < v.r && d > 0.5) {
                const fall = 1 - d / v.r;
                const mag = v.s * fall * (d / (v.r * 0.35) < 1 ? d / (v.r * 0.35) : 1);
                vx += (-dy / d) * mag; vy += (dx / d) * mag;
            }
        }
        for (const ch of def.channels) {
            let best = 1e9, dirx = 0, diry = 0;
            for (let s = 0; s < ch.pts.length - 1; s++) {
                const [ax, ay] = ch.pts[s], [bx, by] = ch.pts[s + 1];
                const d = distToSeg(x, y, ax, ay, bx, by);
                if (d < best) {
                    best = d;
                    const len = Math.hypot(bx - ax, by - ay) || 1;
                    dirx = (bx - ax) / len; diry = (by - ay) / len;
                }
            }
            if (best < ch.width * 2) {
                let mag = ch.speed * Math.exp(-(best * best) / (ch.width * ch.width));
                if (ch.tidal && def.currents.tidalPeriod > 0) {
                    mag *= Math.sin((2 * Math.PI * t) / def.currents.tidalPeriod);
                }
                vx += dirx * mag; vy += diry * mag;
            }
        }
        return [vx, vy];
    };

    map.snapToWater = function (x, y, margin) {
        margin = margin || 1.2;
        if (!map.isLand(x, y) && map.shoreDist(x, y) >= margin) return [x, y];
        let best = null, bestD = 1e9;
        for (let r = 1; r < 80; r++) {
            for (let a = 0; a < 16; a++) {
                const th = (a / 16) * Math.PI * 2;
                const px = x + Math.cos(th) * r * 0.5, py = y + Math.sin(th) * r * 0.5;
                if (px < 1 || py < 1 || px > w - 1 || py > h - 1) continue;
                if (!map.isLand(px, py) && map.shoreDist(px, py) >= margin) {
                    const d = Math.hypot(px - x, py - y);
                    if (d < bestD) { bestD = d; best = [px, py]; }
                }
            }
            if (best) return best;
        }
        return [x, y];
    };

    for (const d of map.docks) {
        const [sx, sy] = map.snapToWater(d.x, d.y, 1.0);
        d.x = sx; d.y = sy;
    }
    const [spx, spy] = map.snapToWater(map.spawn.x, map.spawn.y, 1.5);
    map.spawn.x = spx; map.spawn.y = spy;

    return map;
}

if (typeof module !== "undefined") module.exports = { MAP_DEFS, buildMap, CELL, RCELL };
