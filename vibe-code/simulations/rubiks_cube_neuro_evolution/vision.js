/* vision.js — the eyes. Renders the cube to pixels and hands the pixels to the
 * network. There is no other input path.
 *
 * ─── the premise ───────────────────────────────────────────────────────────
 *
 * Every other neuroevolution project in this folder hands its brains a
 * hand-designed sensor vector: ray distances, board occupancy, joint angles. The
 * feature engineering *is* most of the work, and when a run fails it is usually
 * because a sensor was misaligned rather than because evolution was slow.
 *
 * Here the brain gets a picture. The cube is rendered, downsampled, and the
 * resulting pixels are the entire observation — no facelet array, no colour
 * histogram, no "how many stickers are correct". Whether a population can evolve
 * from that is the experiment.
 *
 * ─── two panels, because one viewpoint is not enough ───────────────────────
 *
 * A cube seen from a corner shows three faces. A policy that can only see three
 * faces is playing a partially observable game and *cannot* solve the cube —
 * half the puzzle is behind it, and no amount of evolution fixes a missing
 * observation. So the render is two panels side by side: one looking down the
 * U/F/R corner, one down the opposite D/B/L corner. Together they show all six
 * faces exactly once. The two panels are the same shape and the same projection,
 * which is why a convolutional front end can share filters across them.
 *
 * ─── the renderer is a sparse matrix ───────────────────────────────────────
 *
 * A trainer does tens of millions of renders, so drawing polygons per frame is
 * out. But the geometry never changes: only the 54 colours do. The projection of
 * a face is *affine*, so every output pixel is a fixed convex combination of at
 * most a few facelet colours plus the constant body/background. That is a sparse
 * matrix with the facelet colours as the input vector, precomputed once:
 *
 *     pixel = base + Σ w_k · palette[ state[facelet_k] ]
 *
 * about 1.2 non-zeros per pixel, so a render is a few thousand multiply-adds.
 * Building it by supersampling (S×S samples per output pixel, exact
 * point-in-face inversion per sample) makes the result *identical* to rendering
 * at S× resolution and average-pooling down, which is what antialiasing is. The
 * shading and the sticker gaps are folded into the weights, so they are free.
 *
 * ─── the palette is chosen, not copied, and shading is the reason ─────────
 *
 * The obvious worry is red versus orange, and measuring it says the obvious worry
 * is the wrong one: a photographic cube's red and orange sit 0.44 apart in RGB,
 * which is no worse than an evenly spread six-colour set manages anyway. Raw
 * colour separability is not the problem.
 *
 * What a pixel actually carries is colour **times** the face's brightness, so the
 * quantity that has to stay separable is the 36 (colour × face) combinations —
 * and there the collisions are severe. With strong shading, yellow on the dimmest
 * face and orange on a mid-bright face come within 0.20 of each other: the network
 * would have to disambiguate them from position alone, having first been actively
 * misled. Hard shading costs more separability than it buys.
 *
 * So two changes, both measured (test_headless.js reports the number):
 *   · the six colours are spread in RGB — the three warm ones separated along the
 *     green channel, which is the only axis they have — taking the worst pair from
 *     0.37 to 0.50.
 *   · shading is *gentle*, 0.82…1.00 rather than 0.58…1.00, which takes the worst
 *     of the 36 combinations from 0.20 to 0.38.
 *
 * Losing the strong face cue costs nothing, because it was never the primary one:
 * each face occupies a fixed region of the panel, so *position* already says which
 * face a pixel belongs to and the brightness was only ever confirming it. The big
 * animated cube on the page shades harder, because it is for human eyes and they
 * want the depth cue.
 */
"use strict";

/* Six sticker colours, RGB in 0..1. The three warm ones (yellow, orange, red)
 * can only be separated along the green channel, so they are spaced evenly on it
 * at 1.00 / 0.50 / 0.00; that is the best three colours sharing one axis can do.
 * Worst pair 0.50, against 0.44 for the photographic set. */
const PALETTES = {
    clear: [
        [0.96, 0.96, 0.96],   // U  white
        [0.98, 1.00, 0.06],   // D  yellow
        [1.00, 0.50, 0.02],   // L  orange
        [0.85, 0.00, 0.08],   // R  red
        [0.05, 0.68, 0.22],   // F  green
        [0.05, 0.28, 0.95],   // B  blue
    ],
    /* Measured off real cube stickers. Kept as an ablation, not as a warning:
     * its raw separability is fine (0.44) and the interesting question is whether
     * the *shaded* collisions it creates cost anything the network cannot recover
     * from position. */
    realistic: [
        [0.94, 0.94, 0.92],
        [0.99, 0.84, 0.08],
        [1.00, 0.35, 0.00],
        [0.72, 0.07, 0.20],
        [0.05, 0.60, 0.28],
        [0.05, 0.25, 0.70],
    ],
};

const BODY_RGB = [0.07, 0.07, 0.09];      // the plastic between stickers
const BG_RGB = [0.02, 0.02, 0.03];        // behind the cube

/* Per-face brightness, lit from above and slightly front-right, and deliberately
 * gentle: the ordering is the same as a hard-shaded render but the range is
 * 0.82…1.00 instead of 0.58…1.00. See the header — strong shading collapses the
 * 36 (colour × face) combinations the network has to tell apart, and the face cue
 * it buys is redundant with position. Indexed U D L R F B. */
const FACE_LIGHT = [1.00, 0.86, 0.90, 0.94, 0.97, 0.82];

/* What the human-facing renderer uses instead. Nothing reads this except view.js;
 * it is here so the two shading choices sit next to each other and the difference
 * is a decision rather than a divergence. */
const FACE_LIGHT_DISPLAY = [1.00, 0.62, 0.68, 0.86, 0.92, 0.58];

/* Camera directions for the two panels — opposite corners of the cube. Panel 0
 * sees U, F, R; panel 1 sees D, B, L. */
const CAMS = [[1, 1, 1], [-1, -1, -1]];

const norm3 = v => { const L = Math.hypot(v[0], v[1], v[2]); return [v[0] / L, v[1] / L, v[2] / L]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/* An orthographic camera looking down `dir` toward the origin.
 *
 * Orthographic, not perspective, on purpose: it keeps the projection of each
 * face affine, which is what makes the sparse-matrix trick above exact. A
 * perspective camera would make every face a projective map and every pixel's
 * facelet membership a per-pixel divide — correct, but it would buy nothing the
 * network needs and cost the precomputation.
 *
 * `project` returns screen coordinates in cube units with Y already pointing
 * down, ready to be scaled into pixels. view.js uses the same function for the
 * big animated cube, so the human and the network are looking through one lens.
 */
function buildProjector(dir) {
    const c = norm3(dir);
    const right = norm3(cross3([0, 1, 0], c));
    const up = norm3(cross3(c, right));
    return {
        dir: c, right, up,
        project: p => [dot3(p, right), -dot3(p, up)],
        depth: p => dot3(p, c),                       // larger = nearer the camera
        /* Half-extent of the projected unit cube [-1,1]³ along each screen axis:
         * the corner that maximises |p·axis| is the one with matching signs. */
        halfW: Math.abs(right[0]) + Math.abs(right[1]) + Math.abs(right[2]),
        halfH: Math.abs(up[0]) + Math.abs(up[1]) + Math.abs(up[2]),
    };
}

const PROJ = CAMS.map(buildProjector);

/* Which faces a panel can see. Strictly positive: a face edge-on to the camera
 * contributes no pixels and would only add degenerate quads. */
function visibleFaces(proj, C) {
    const out = [];
    for (let f = 0; f < 6; f++) if (dot3(C.FACE_N[f], proj.dir) > 1e-9) out.push(f);
    return out;
}

/* ------------------------------------------------------------- render plan */

/* Precompute the sparse render matrix for a given resolution.
 *
 * The image is one buffer of C×H×W, plane-major (all of channel 0, then channel
 * 1, …), because that is the layout a convolution wants and reordering per frame
 * would cost more than everything else here. W = 2·res so the two panels sit
 * side by side in one image; a filter sliding across the seam sees a strip of
 * background, which is the same thing it sees at the outer edges.
 *
 * opts:
 *   res       panel size in pixels; image is (2·res) × res
 *   ss        supersample factor per axis (default 3 → 9 samples per pixel)
 *   margin    fraction of the panel left empty around the cube
 *   gap       sticker inset as a fraction of a facelet, showing body colour
 *   palette   "clear" | "realistic"
 *   center    map pixels from [0,1] to [-1,1] (default true — tanh likes it)
 *   shade     apply FACE_LIGHT (default true)
 */
/* An unfolded-net projection: the six faces laid flat in a cross.
 *
 *        U
 *    L   F   R   B
 *        D
 *
 * Why this exists. The isometric pair is the honest picture of a cube and it is what
 * the project is named for, but it is measurably hard to read at this resolution: the
 * side faces are foreshortened, so the worst-read facelet owns only about four output
 * pixels at res 16, and three of the six faces are seen at a slant in each panel. The
 * round-6 diagnostic put a number on the cost — a brain handed the 54 facelets directly
 * reached 15% at depth 7 where the best pixel brain reached 8%, on identical everything
 * else. Roughly half the deep-end score was going to legibility rather than to the
 * puzzle.
 *
 * Unfolding removes the projection entirely: every facelet is an axis-aligned square of
 * identical area, nothing occludes anything, and no face is foreshortened. It is still
 * vision — a picture the network has to parse, with the same sparse-matrix renderer,
 * the same palette and the same convolution reading it — but it spends its pixels on
 * information instead of on perspective.
 *
 * Shading is deliberately *not* applied here. In the isometric view a pixel carries
 * colour x face-brightness and gentle shading buys separability; in an unfolded net the
 * position of a facelet already says which face it belongs to, so brightness variation
 * would only compress the colour distances the network needs. */
function buildUnfoldedPlan(C, opts) {
    const res = opts.res | 0;
    const ss = Math.max(1, opts.ss === undefined ? 3 : opts.ss | 0);
    const gap = opts.gap === undefined ? 0.14 : opts.gap;
    const pal = PALETTES[opts.palette || "clear"];
    if (!pal) throw new Error("unknown palette: " + opts.palette);
    const center = opts.center !== false;

    /* Face size in pixels, forced to a multiple of three so that a facelet is an exact
     * integer number of pixels.
     *
     * That is the point of the whole projection. With `fs = 3k` each facelet is a k x k
     * block on the pixel grid, so a first convolution of kernel k and stride k reads
     * exactly one facelet per filter position — the network is handed the decoding
     * problem already solved, and can spend its capacity on the puzzle. Under the
     * isometric view the same filter sees a slanted fraction of two or three facelets
     * and has to learn to undo a projection first.
     *
     * res 12 -> k = 2 (24x18 image, smaller than the isometric pair)
     * res 18 -> k = 3 (36x27) */
    const fs = 3 * Math.max(1, Math.round(res / 6));
    const W = fs * 4, H = fs * 3;
    const nPix = W * H;

    /* Grid position of each face in the cross, indexed by the FACE_NAMES order
     * ["U","D","L","R","F","B"]. */
    const CELL = { 0: [1, 0], 1: [1, 2], 2: [0, 1], 3: [2, 1], 4: [1, 1], 5: [3, 1] };

    const constRGB = new Float64Array(nPix * 3);
    const buckets = new Array(nPix);
    const wSample = 1 / (ss * ss);

    for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
            const pix = py * W + px;
            for (let sy = 0; sy < ss; sy++) {
                for (let sx = 0; sx < ss; sx++) {
                    const X = px + (sx + 0.5) / ss, Y = py + (sy + 0.5) / ss;
                    const gx = Math.floor(X / fs), gy = Math.floor(Y / fs);
                    let face = -1;
                    for (const f of Object.keys(CELL)) {
                        if (CELL[f][0] === gx && CELL[f][1] === gy) { face = +f; break; }
                    }
                    let hitFacelet = -1;
                    if (face >= 0) {
                        const a = (X - gx * fs) / fs, b = (Y - gy * fs) / fs;
                        const fa = a * 3, fb = b * 3;
                        const col = Math.min(2, fa | 0), row = Math.min(2, fb | 0);
                        const la = fa - col, lb = fb - row;
                        hitFacelet = (la < gap || la > 1 - gap || lb < gap || lb > 1 - gap)
                            ? -2 : face * 9 + row * 3 + col;
                    }
                    if (hitFacelet >= 0) {
                        const bk = buckets[pix] || (buckets[pix] = new Map());
                        bk.set(hitFacelet, (bk.get(hitFacelet) || 0) + wSample);
                    } else {
                        const rgb = hitFacelet === -2 ? BODY_RGB : BG_RGB;
                        const lit = hitFacelet === -2 ? 0.8 : 1;
                        constRGB[pix * 3] += wSample * rgb[0] * lit;
                        constRGB[pix * 3 + 1] += wSample * rgb[1] * lit;
                        constRGB[pix * 3 + 2] += wSample * rgb[2] * lit;
                    }
                }
            }
        }
    }

    let nnz = 0;
    for (let p = 0; p < nPix; p++) if (buckets[p]) nnz += buckets[p].size;
    const rowPix = new Int32Array(nnz);
    const rowFacelet = new Uint8Array(nnz);
    const rowW = new Float32Array(nnz);
    let k = 0;
    for (let p = 0; p < nPix; p++) {
        if (!buckets[p]) continue;
        for (const [f, w] of buckets[p]) { rowPix[k] = p; rowFacelet[k] = f; rowW[k] = w; k++; }
    }
    const base = new Float32Array(nPix * 3);
    const cScale = center ? 2 : 1, cShift = center ? -1 : 0;
    for (let p = 0; p < nPix; p++) {
        for (let ch = 0; ch < 3; ch++) base[p * 3 + ch] = constRGB[p * 3 + ch] * cScale + cShift;
    }
    for (let i = 0; i < nnz; i++) rowW[i] *= cScale;

    return {
        res, W, H, channels: 3, palette: pal, nnz,
        base, rowPix, rowFacelet, rowW, view: "unfolded",
        frameSize: 3 * W * H,
    };
}

function buildRenderPlan(C, opts) {
    if (opts && opts.view === "unfolded") return buildUnfoldedPlan(C, opts);
    const res = opts.res | 0;
    const ss = Math.max(1, opts.ss === undefined ? 3 : opts.ss | 0);
    const margin = opts.margin === undefined ? 0.06 : opts.margin;
    const gap = opts.gap === undefined ? 0.14 : opts.gap;
    const pal = PALETTES[opts.palette || "clear"];
    if (!pal) throw new Error("unknown palette: " + opts.palette);
    const center = opts.center !== false;
    const shade = opts.shade !== false;

    const W = res * 2, H = res;
    const nPix = W * H;

    /* Accumulate per pixel: a constant RGB and a small map facelet → weight.
     * Weights already carry 1/ss² and the face shading, so nothing is scaled at
     * render time. */
    const constRGB = new Float64Array(nPix * 3);
    const buckets = new Array(nPix);
    const wSample = 1 / (ss * ss);

    for (let panel = 0; panel < 2; panel++) {
        const proj = PROJ[panel];
        const faces = visibleFaces(proj, C);
        /* Scale so the projected cube fits the panel with `margin` to spare.
         * Both panels use the same scale — the hexagons are congruent — so the
         * two halves of the image are pixel-comparable, which matters for a
         * shared convolutional filter. */
        const scale = (res * (1 - 2 * margin) / 2) / Math.max(proj.halfW, proj.halfH);
        const cx = panel * res + res / 2, cy = res / 2;

        /* Per visible face: screen position of the face centre and the screen
         * vectors of one unit step in the face's own (u, v) basis. The map
         * (a,b) ↦ screen is then affine and invertible, so a sample point can be
         * turned straight back into face coordinates. */
        const maps = faces.map(f => {
            const c0 = proj.project(C.FACE_N[f]);
            const eu = proj.project(C.FACE_U[f]);
            const ev = proj.project(C.FACE_V[f]);
            const det = eu[0] * ev[1] - eu[1] * ev[0];
            if (Math.abs(det) < 1e-12) return null;      // face edge-on, unreachable here
            return {
                f,
                ox: cx + c0[0] * scale, oy: cy + c0[1] * scale,
                /* inverse of [eu ev] scaled into pixels */
                i00: ev[1] / (det * scale), i01: -ev[0] / (det * scale),
                i10: -eu[1] / (det * scale), i11: eu[0] / (det * scale),
                light: shade ? FACE_LIGHT[f] : 1,
            };
        }).filter(Boolean);

        for (let py = 0; py < res; py++) {
            for (let px = 0; px < res; px++) {
                const pix = py * W + panel * res + px;
                for (let sy = 0; sy < ss; sy++) {
                    for (let sx = 0; sx < ss; sx++) {
                        const X = panel * res + px + (sx + 0.5) / ss;
                        const Y = py + (sy + 0.5) / ss;
                        let hitFacelet = -1, hitLight = 1;
                        for (const m of maps) {
                            const dx = X - m.ox, dy = Y - m.oy;
                            const a = m.i00 * dx + m.i01 * dy;
                            const b = m.i10 * dx + m.i11 * dy;
                            if (a < -1 || a > 1 || b < -1 || b > 1) continue;
                            /* Inside this face. Which facelet, and are we on a
                             * sticker or in the plastic gap between them? */
                            const fa = (a + 1) * 1.5, fb = (b + 1) * 1.5;
                            const col = Math.min(2, fa | 0), row = Math.min(2, fb | 0);
                            const la = fa - col, lb = fb - row;
                            if (la < gap || la > 1 - gap || lb < gap || lb > 1 - gap) {
                                hitFacelet = -2;                 // body plastic
                            } else {
                                hitFacelet = m.f * 9 + row * 3 + col;
                                hitLight = m.light;
                            }
                            break;      // the three visible faces tile without overlap
                        }
                        if (hitFacelet >= 0) {
                            const b = buckets[pix] || (buckets[pix] = new Map());
                            b.set(hitFacelet, (b.get(hitFacelet) || 0) + wSample * hitLight);
                        } else {
                            const rgb = hitFacelet === -2 ? BODY_RGB : BG_RGB;
                            /* the body is lit too, but by an average of the faces
                             * around it — a single flat value reads as a shadowed
                             * edge, which is what it is */
                            const lit = hitFacelet === -2 ? 0.8 : 1;
                            constRGB[pix * 3] += wSample * rgb[0] * lit;
                            constRGB[pix * 3 + 1] += wSample * rgb[1] * lit;
                            constRGB[pix * 3 + 2] += wSample * rgb[2] * lit;
                        }
                    }
                }
            }
        }
    }

    /* Flatten the buckets into three parallel arrays, one entry per (pixel,
     * facelet) pair, grouped by pixel. Channel offsets are added at render time
     * because the three channels share a weight. */
    let nnz = 0;
    for (let p = 0; p < nPix; p++) if (buckets[p]) nnz += buckets[p].size;
    const rowPix = new Int32Array(nnz);
    const rowFacelet = new Uint8Array(nnz);
    const rowW = new Float32Array(nnz);
    let k = 0;
    for (let p = 0; p < nPix; p++) {
        if (!buckets[p]) continue;
        for (const [f, w] of buckets[p]) { rowPix[k] = p; rowFacelet[k] = f; rowW[k] = w; k++; }
    }

    /* Centering is a pure affine change of the output, so it folds into the
     * precomputed numbers: 2x−1 on the constant part, ×2 on every weight. */
    const base = new Float32Array(nPix * 3);
    const cScale = center ? 2 : 1, cShift = center ? -1 : 0;
    for (let p = 0; p < nPix; p++) {
        for (let ch = 0; ch < 3; ch++) base[p * 3 + ch] = constRGB[p * 3 + ch] * cScale + cShift;
    }
    for (let i = 0; i < nnz; i++) rowW[i] *= cScale;

    return {
        res, W, H, channels: 3, palette: pal, nnz,
        rowPix, rowFacelet, rowW, base,
        /* plane-major output size for one frame */
        frameSize: 3 * W * H,
    };
}

/* Render one cube state into `out` at `off`, plane-major (R plane, G plane, B
 * plane). `out` is a Float32Array big enough for plan.frameSize from `off`. */
function renderInto(plan, state, out, off) {
    const { W, H, base, rowPix, rowFacelet, rowW, palette, nnz } = plan;
    const nPix = W * H;
    /* base is interleaved (it was built per pixel); scatter it into planes */
    for (let p = 0; p < nPix; p++) {
        out[off + p] = base[p * 3];
        out[off + nPix + p] = base[p * 3 + 1];
        out[off + 2 * nPix + p] = base[p * 3 + 2];
    }
    for (let i = 0; i < nnz; i++) {
        const p = rowPix[i], w = rowW[i], c = palette[state[rowFacelet[i]]];
        out[off + p] += w * c[0];
        out[off + nPix + p] += w * c[1];
        out[off + 2 * nPix + p] += w * c[2];
    }
    return out;
}

/* Same picture, as 8-bit RGBA for a canvas. Only the page calls this — it is the
 * "this is what the brain sees" inset, and it must come from the same plan as
 * the training input or the inset would be a drawing of a different thing. */
function renderToRGBA(plan, state, rgba, centered) {
    const buf = new Float32Array(plan.frameSize);
    renderInto(plan, state, buf, 0);
    const nPix = plan.W * plan.H;
    for (let p = 0; p < nPix; p++) {
        for (let ch = 0; ch < 3; ch++) {
            let v = buf[ch * nPix + p];
            if (centered !== false) v = (v + 1) / 2;
            rgba[p * 4 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
        }
        rgba[p * 4 + 3] = 255;
    }
    return rgba;
}

/* ------------------------------------------------------ observation assembly */

/* The full input vector: a stack of the last `frames` renders, then the
 * non-spatial extras.
 *
 * ─── the single most important line in this project ──────────────────────
 *
 * A deterministic policy that sees only the current cube *cannot* solve the
 * cube, no matter how well it is trained. The observation would be a function of
 * the state alone, so the action would be too, so the cube would follow a
 * deterministic orbit — and since the state space is finite the orbit is
 * eventually periodic. Apply U, look, decide U', look: the observation is the one
 * you saw two steps ago, so is the action, and the brain flips between two cubes
 * forever. Every "the GA learns nothing" failure of a first attempt at this task
 * is that, and it is an *observability* bug wearing a learning bug's clothes.
 *
 * Two fixes, both cheap, both on by default:
 *   · the move clock — how far through the budget we are. It makes the
 *     observation strictly non-repeating, so a cycle is at least *possible* to
 *     break, though the network still has to learn to use it.
 *   · the move history — a one-hot window of the last `moveHist` actions. This
 *     is the useful one: "I just did U" is exactly the fact needed to not do U'
 *     next, and it is available without the network having to decode a clock.
 *
 * Frame history is a third, different thing: it says what *changed*, which is
 * how you tell a turn of the top layer from a turn of the bottom one without
 * having to memorise absolute sticker positions. It is the same differenced
 * temporal window that the walking project needed, arrived at for the same
 * reason.
 *
 * A config can switch all three off. `configs.js` keeps one that does, because a
 * failure mode you can reproduce on demand is worth more than one you remember.
 */
function observationLayout(plan, cfg) {
    const frames = Math.max(1, cfg.frames | 0 || 1);
    const hist = Math.max(0, cfg.moveHist | 0);
    const nMoves = cfg.nMoves;
    const imageSize = frames * plan.frameSize;
    const extras = hist * nMoves + (cfg.clock === false ? 0 : 1) + (cfg.stickerHint ? 1 : 0);
    return {
        frames, hist, nMoves, imageSize, extras,
        channels: frames * 3, H: plan.H, W: plan.W,
        planeAt: 0, extrasAt: imageSize,
        size: imageSize + extras,
    };
}

/* Rolling observation buffer for one episode. Frames are stored newest-first so
 * that channel 0..2 is always "now" whatever the history depth — a brain trained
 * at frames = 3 and probed at frames = 1 would then at least be looking at the
 * right picture, which makes ablations comparable. */
class Observer {
    constructor(plan, layout) {
        this.plan = plan;
        this.L = layout;
        this.vec = new Float32Array(layout.size);
        this.scratch = new Float32Array(plan.frameSize);
        this.hist = new Int8Array(Math.max(1, layout.hist)).fill(-1);
    }

    reset(state) {
        this.vec.fill(0);
        this.hist.fill(-1);
        /* A fresh episode has no past, and zero-filling the older frames would
         * tell the network "everything was black a move ago" — a signal that
         * only ever occurs on move 0 and that it will happily latch onto. Fill
         * every frame with the *current* picture instead: no motion, which is
         * true, and no free move counter. */
        renderInto(this.plan, state, this.scratch, 0);
        for (let f = 0; f < this.L.frames; f++) {
            this.vec.set(this.scratch, f * this.plan.frameSize);
        }
        this.t = 0;
        this._extras();
        return this.vec;
    }

    /* Advance one move: shift the frame stack, render the new state, record the
     * action that produced it. */
    push(state, moveLocal, budget) {
        const fs = this.plan.frameSize;
        for (let f = this.L.frames - 1; f > 0; f--) {
            this.vec.copyWithin(f * fs, (f - 1) * fs, f * fs);
        }
        renderInto(this.plan, state, this.vec, 0);
        if (this.L.hist > 0) {
            for (let i = this.L.hist - 1; i > 0; i--) this.hist[i] = this.hist[i - 1];
            this.hist[0] = moveLocal;
        }
        this.t++;
        this.budget = budget;
        this._extras();
        return this.vec;
    }

    _extras() {
        const L = this.L;
        let at = L.extrasAt;
        for (let i = 0; i < L.hist; i++) {
            for (let m = 0; m < L.nMoves; m++) this.vec[at + m] = this.hist[i] === m ? 1 : 0;
            at += L.nMoves;
        }
        if (L.extras > L.hist * L.nMoves) {
            const b = this.budget || 20;
            this.vec[at++] = Math.min(1, this.t / b) * 2 - 1;      // centred clock
        }
    }
}

/* ----------------------------------------------------- the ablation control */

/* The same episode, but the observation is the 54 facelets one-hot instead of
 * pixels. This is not a feature — it is the control that answers "is the pixel
 * encoding the bottleneck, or is the task hard?". Without it, a run that
 * plateaus tells you nothing about which half of the experiment failed. */
function facelet1Hot(state, out, off) {
    out.fill(0, off, off + 324);
    for (let i = 0; i < 54; i++) out[off + i * 6 + state[i]] = 1;
    return out;
}

if (typeof module !== "undefined") {
    module.exports = {
        PALETTES, BODY_RGB, BG_RGB, FACE_LIGHT, FACE_LIGHT_DISPLAY, CAMS, PROJ,
        buildProjector, visibleFaces, buildRenderPlan, renderInto, renderToRGBA,
        observationLayout, Observer, facelet1Hot,
    };
}
