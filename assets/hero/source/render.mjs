// Schwarzschild black hole with a thin accretion disk, ray traced.
//
// Units: r_s = 1 (so M = 1/2, photon sphere 1.5, ISCO 3). A photon's path in
// Schwarzschild coordinates obeys u'' + u = 1.5 u^2 (u = 1/r), which is exactly
// the orbit of a Newtonian particle under a = -1.5 h^2 x / r^5, h = |x × v|.
// Integrating that in flat 3-space gives the right bending for every pixel.
//
//   node render.mjs width=640 height=320 ss=2 out=preview.f32
//
// The hero images in ../ were made with (about 7 minutes on 5 cores):
//   node render.mjs width=2880 height=1440 ss=3 dist=40 fovX=42 elev=7 stars=1 starDensity=0.2 starTail=0.6 tPeak=6800 brightPow=4 workers=5 out=final.f32
//   python post.py final.f32 hero.png exposure=0.5 contrast=1.5 pivot=0.6 bloom=0.08 stars=3 sat=1.2 edge=0.05
// then hero.png was resized to 2880/1920/1280 px wide, and its central
// 1100 x 1100 px (centred on the hole at 1440, 720) was saved at 1080/720 px
// for phones, all as JPEG quality 84.
//
// Writes linear-light float32, six channels per pixel (disk RGB, then star
// RGB, so the sky can be re-weighted later) plus a .json sidecar; post.py
// turns it into display images.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEG = Math.PI / 180;

const DEFAULTS = {
    width: 640, height: 320, ss: 1,
    dist: 24, elev: 6, roll: 0, fovX: 64, lookY: 0, shiftX: 0, shiftY: 0,
    rIn: 3, rOut: 11, fadeIn: 0.55,
    tPeak: 9000, brightPow: 3, doppler: 1, gPow: 4, gain: 1,
    turb: 0.3, sat: 1,
    stars: 1, starDensity: 0.35, starGrid: 70, starSigma: 0.6, starTail: 2.2,
    seed: 7, workers: 4, maxSteps: 4000, lensStars: 1, out: 'bh.f32'
};

function parseArgs(argv) {
    const P = { ...DEFAULTS };
    for (const a of argv) {
        const [k, v] = a.split('=');
        if (!(k in P)) throw new Error('unknown param ' + k);
        P[k] = typeof DEFAULTS[k] === 'number' ? Number(v) : v;
    }
    return P;
}

// ── Colour: blackbody chromaticity via the Wyman–Sloan–Shirley CIE fit ──

function lobe(l, mu, s1, s2) {
    const s = l < mu ? s1 : s2;
    const t = (l - mu) / s;
    return Math.exp(-0.5 * t * t);
}

function blackbodyRGB(T) {
    let X = 0, Y = 0, Z = 0;
    for (let l = 380; l <= 780; l += 5) {
        const lm = l * 1e-9;
        const planck = 1 / (Math.pow(lm, 5) * (Math.exp(1.4388e-2 / (lm * T)) - 1));
        X += planck * (1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2));
        Y += planck * (0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1));
        Z += planck * (1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8));
    }
    const r = Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z);
    const g = Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z);
    const b = Math.max(0, 0.0557 * X - 0.2040 * Y + 1.0570 * Z);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return [r / lum, g / lum, b / lum];          // unit luminance
}

const BB_MIN = Math.log(800), BB_MAX = Math.log(60000), BB_N = 256;
const BB = new Float32Array(BB_N * 3);
for (let i = 0; i < BB_N; i++) {
    const c = blackbodyRGB(Math.exp(BB_MIN + (BB_MAX - BB_MIN) * i / (BB_N - 1)));
    BB[i * 3] = c[0]; BB[i * 3 + 1] = c[1]; BB[i * 3 + 2] = c[2];
}

function bbLookup(T, out) {
    let t = (Math.log(Math.max(800, Math.min(60000, T))) - BB_MIN) / (BB_MAX - BB_MIN) * (BB_N - 1);
    const i = Math.min(BB_N - 2, Math.floor(t));
    t -= i;
    for (let k = 0; k < 3; k++) out[k] = BB[i * 3 + k] * (1 - t) + BB[(i + 1) * 3 + k] * t;
}

// ── Hashing and noise ──

function mix32(a) {
    a = Math.imul(a ^ (a >>> 16), 0x7feb352d);
    a = Math.imul(a ^ (a >>> 15), 0x846ca68b);
    return (a ^ (a >>> 16)) >>> 0;
}

function rnd3(ix, iy, iz, salt) {
    return mix32(mix32(mix32(ix * 73856093 ^ salt) + iy * 19349663) ^ (iz * 83492791)) / 4294967296;
}

// Value noise on a lattice that wraps every `per` cells in v (the angle).
function vnoise(u, v, per, salt) {
    const iu = Math.floor(u), iv = Math.floor(v);
    const fu = u - iu, fv = v - iv;
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    const v0 = ((iv % per) + per) % per, v1 = (v0 + 1) % per;
    const a = rnd3(iu, v0, 0, salt), b = rnd3(iu + 1, v0, 0, salt);
    const c = rnd3(iu, v1, 0, salt), d = rnd3(iu + 1, v1, 0, salt);
    return (a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv;   // 0..1
}

// Streaks: fine in radius, long in angle, four octaves, roughly -1..1.
function diskStreaks(r, phi) {
    let sum = 0, amp = 1, norm = 0;
    let fu = 26, per = 5;
    const lr = Math.log(r);
    for (let o = 0; o < 4; o++) {
        sum += amp * (vnoise(lr * fu, phi / (2 * Math.PI) * per, per, 11 + o) * 2 - 1);
        norm += amp; amp *= 0.55; fu *= 2.1; per *= 2;
    }
    return sum / norm;
}

// ── Sky: a resolution-independent star field. One candidate star per cell of
// a 3D grid, kept only if its direction lands inside that same cell, so each
// ray needs exactly one lookup and no star is ever clipped at a cell edge. ──

const starCol = [0, 0, 0];

function starAt(P, vx, vy, vz, out) {
    out[0] = out[1] = out[2] = 0;
    const inv = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
    const K = P.starGrid;
    const px = vx * inv * K, py = vy * inv * K, pz = vz * inv * K;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    if (rnd3(ix, iy, iz, 101) > P.starDensity) return;
    let sx = ix + 0.2 + 0.6 * rnd3(ix, iy, iz, 102);
    let sy = iy + 0.2 + 0.6 * rnd3(ix, iy, iz, 103);
    let sz = iz + 0.2 + 0.6 * rnd3(ix, iy, iz, 104);
    const L = K / Math.sqrt(sx * sx + sy * sy + sz * sz);
    sx *= L; sy *= L; sz *= L;
    const m = P.starMargin;
    if (sx - ix < m || ix + 1 - sx < m || sy - iy < m || iy + 1 - sy < m || sz - iz < m || iz + 1 - sz < m) return;
    const d2 = ((px - sx) ** 2 + (py - sy) ** 2 + (pz - sz) ** 2) / (K * K);
    const e = Math.exp(-0.5 * d2 / (P.sigmaRad * P.sigmaRad));
    if (e < 1e-4) return;
    const b = P.stars * (0.03 + P.starTail * Math.pow(rnd3(ix, iy, iz, 105), 9)) * e;
    bbLookup(3800 + 9000 * rnd3(ix, iy, iz, 106), starCol);
    for (let k = 0; k < 3; k++) out[k] = b * (0.45 + 0.55 * starCol[k]);
}

// ── Disk emission: Shakura–Sunyaev temperature profile, normalised to peak 1 ──

function tempProfileRaw(r, rIn) {
    if (r <= rIn) return 0;
    return Math.pow(r / rIn, -0.75) * Math.pow(1 - Math.sqrt(rIn / r), 0.25);
}

function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

const diskCol = [0, 0, 0];

// Shade one crossing of the disk plane at radius rr, angle phi. Returns the
// opacity and leaves the emitted colour (already scaled) in diskCol.
function shadeDisk(P, rr, phi, lam) {
    const f = tempProfileRaw(rr, P.rIn) / P.fMax;
    if (f <= 0) return 0;
    const ut = 1 / Math.sqrt(1 - 1.5 / rr);           // circular geodesic, M = 1/2
    const om = Math.sqrt(0.5 / (rr * rr * rr));
    const g = 1 / (ut * (1 - P.doppler * om * lam)); // E_obs / E_emit
    const fade = 1 - smoothstep(P.fadeIn * P.rOut, P.rOut, rr);
    const streak = Math.max(0, 1 + P.turb * diskStreaks(rr, phi));
    const I = P.gain * Math.pow(g, P.gPow) * Math.pow(f, P.brightPow) * fade * streak;
    bbLookup(P.tPeak * f * g, diskCol);
    for (let k = 0; k < 3; k++) diskCol[k] = I * (1 + P.sat * (diskCol[k] - 1));
    return Math.min(1, 3 * f * fade);
}

// ── One ray, integrated backwards from the camera with RK4 ──

const skyCol = [0, 0, 0];

function traceRay(P, C, dx, dy, dz, out) {
    let x = C.pos[0], y = C.pos[1], z = C.pos[2];
    let vx = dx, vy = dy, vz = dz;
    const ly = z * vx - x * vz;
    const cx = y * vz - z * vy, cz = x * vy - y * vx;
    const k = -1.5 * (cx * cx + ly * ly + cz * cz);   // -1.5 h^2
    const lam = -ly;                                  // photon's L about the disk axis, E = 1
    let R = 0, G = 0, B = 0, T = 1, SR = 0, SG = 0, SB = 0;
    for (let step = 0; step < P.maxSteps; step++) {
        const r = Math.sqrt(x * x + y * y + z * z);
        if (r < 1.0) break;                           // through the horizon
        if (r > P.rEsc && x * vx + y * vy + z * vz > 0) {
            if (P.stars > 0) {
                if (P.lensStars) starAt(P, vx, vy, vz, skyCol); else starAt(P, dx, dy, dz, skyCol);
                SR += T * skyCol[0]; SG += T * skyCol[1]; SB += T * skyCol[2];
            }
            break;
        }
        const h = Math.min(1.2, Math.max(0.008, 0.04 * r));
        // RK4 for x'' = k x / r^5
        let q = k / Math.pow(r, 5);
        const a1x = q * x, a1y = q * y, a1z = q * z;
        let x2 = x + 0.5 * h * vx, y2 = y + 0.5 * h * vy, z2 = z + 0.5 * h * vz;
        q = k / Math.pow(Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2), 5);
        const v2x = vx + 0.5 * h * a1x, v2y = vy + 0.5 * h * a1y, v2z = vz + 0.5 * h * a1z;
        const a2x = q * x2, a2y = q * y2, a2z = q * z2;
        let x3 = x + 0.5 * h * v2x, y3 = y + 0.5 * h * v2y, z3 = z + 0.5 * h * v2z;
        q = k / Math.pow(Math.sqrt(x3 * x3 + y3 * y3 + z3 * z3), 5);
        const v3x = vx + 0.5 * h * a2x, v3y = vy + 0.5 * h * a2y, v3z = vz + 0.5 * h * a2z;
        const a3x = q * x3, a3y = q * y3, a3z = q * z3;
        let x4 = x + h * v3x, y4 = y + h * v3y, z4 = z + h * v3z;
        q = k / Math.pow(Math.sqrt(x4 * x4 + y4 * y4 + z4 * z4), 5);
        const v4x = vx + h * a3x, v4y = vy + h * a3y, v4z = vz + h * a3z;
        const a4x = q * x4, a4y = q * y4, a4z = q * z4;
        const nx = x + h / 6 * (vx + 2 * v2x + 2 * v3x + v4x);
        const ny = y + h / 6 * (vy + 2 * v2y + 2 * v3y + v4y);
        const nz = z + h / 6 * (vz + 2 * v2z + 2 * v3z + v4z);
        vx += h / 6 * (a1x + 2 * a2x + 2 * a3x + a4x);
        vy += h / 6 * (a1y + 2 * a2y + 2 * a3y + a4y);
        vz += h / 6 * (a1z + 2 * a2z + 2 * a3z + a4z);
        // Crossing the disk plane?
        if ((y > 0) !== (ny > 0)) {
            const t = y / (y - ny);
            const hx = x + t * (nx - x), hz = z + t * (nz - z);
            const rr = Math.sqrt(hx * hx + hz * hz);
            if (rr >= P.rIn && rr <= P.rOut) {
                const alpha = shadeDisk(P, rr, Math.atan2(hz, hx), lam);
                if (alpha > 0) {
                    R += T * alpha * diskCol[0]; G += T * alpha * diskCol[1]; B += T * alpha * diskCol[2];
                    T *= 1 - alpha;
                    if (T < 0.004) { x = nx; y = ny; z = nz; break; }
                }
            }
        }
        x = nx; y = ny; z = nz;
    }
    out[0] = R; out[1] = G; out[2] = B; out[3] = SR; out[4] = SG; out[5] = SB;
}

function makeCamera(P) {
    const el = P.elev * DEG;
    const pos = [0, P.dist * Math.sin(el), -P.dist * Math.cos(el)];
    const f = norm([-pos[0], P.lookY - pos[1], -pos[2]]);
    const r0 = norm(cross(f, [0, 1, 0]));
    const u0 = cross(r0, f);
    const c = Math.cos(P.roll * DEG), s = Math.sin(P.roll * DEG);
    const right = [0, 1, 2].map(i => r0[i] * c + u0[i] * s);
    const up = [0, 1, 2].map(i => -r0[i] * s + u0[i] * c);
    return { pos, f, right, up, tx: Math.tan(P.fovX * DEG / 2) };
}

function norm(a) { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

// ── Driver ──

function derive(P) {
    let fMax = 0;
    for (let r = P.rIn; r < P.rIn * 12; r += 0.0005) fMax = Math.max(fMax, tempProfileRaw(r, P.rIn));
    P.fMax = fMax;
    P.rEsc = Math.max(P.dist * 1.25, 40);
    P.sigmaRad = P.starSigma * (P.fovX * DEG) / P.width;   // star size tied to the output pixel
    P.starMargin = 4 * P.sigmaRad * P.starGrid;
    return P;
}

function renderRows(P, buf, id, n) {
    const C = makeCamera(P);
    const W = P.width, H = P.height, ss = P.ss;
    const ty = C.tx * H / W;
    const px = [0, 0, 0, 0, 0, 0];
    for (let j = id; j < H; j += n) {
        for (let i = 0; i < W; i++) {
            const acc = [0, 0, 0, 0, 0, 0];
            for (let b = 0; b < ss; b++) {
                for (let a = 0; a < ss; a++) {
                    const u = ((i + (a + 0.5) / ss) / W * 2 - 1 + P.shiftX) * C.tx;
                    const v = (1 - (j + (b + 0.5) / ss) / H * 2 + P.shiftY) * ty;
                    let dx = C.f[0] + u * C.right[0] + v * C.up[0];
                    let dy = C.f[1] + u * C.right[1] + v * C.up[1];
                    let dz = C.f[2] + u * C.right[2] + v * C.up[2];
                    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    traceRay(P, C, dx / l, dy / l, dz / l, px);
                    for (let c = 0; c < 6; c++) acc[c] += px[c];
                }
            }
            const o = (j * W + i) * 6, s2 = ss * ss;
            for (let c = 0; c < 6; c++) buf[o + c] = acc[c] / s2;
        }
        if (id === 0 && j % (n * 8) === 0) parentPort.postMessage({ progress: j / H });
    }
}

if (isMainThread) {
    const P = derive(parseArgs(process.argv.slice(2)));
    const sab = new SharedArrayBuffer(P.width * P.height * 6 * 4);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: P.workers }, (_, id) => new Promise((resolve, reject) => {
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: { P, sab, id, n: P.workers } });
        w.on('message', m => process.stdout.write(`\r${(m.progress * 100).toFixed(0)}%  `));
        w.on('error', reject);
        w.on('exit', code => code === 0 ? resolve() : reject(new Error('worker exit ' + code)));
    })));
    writeFileSync(P.out, Buffer.from(sab));
    writeFileSync(P.out.replace(/\.f32$/, '.json'), JSON.stringify({ width: P.width, height: P.height, params: P }, null, 1));
    console.log(`\r${P.out}: ${P.width}x${P.height} ss${P.ss} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} else {
    const { P, sab, id, n } = workerData;
    renderRows(P, new Float32Array(sab), id, n);
}
