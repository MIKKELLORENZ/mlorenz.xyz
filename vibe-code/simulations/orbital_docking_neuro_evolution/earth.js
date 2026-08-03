/* earth.js — the planet. Textures generated procedurally at load, shaded with
 * a custom material, and — the part that matters — ORIENTED BY THE ACTUAL ORBIT.
 *
 * WHY THE EARTH HAS TO BE TOLD WHERE IT IS. The whole scene is drawn in LVLH,
 * the station-centred frame, because that is the frame a rendezvous happens in.
 * In that frame the Earth's *centre* never moves: it sits 6,791 km below you for
 * the entire mission. Draw a static sphere there and the result is a spacecraft
 * hanging motionless over a motionless planet — which is exactly what this
 * looked like, and it made a 93-minute orbit read as a hover.
 *
 * What actually moves is the SURFACE. The LVLH frame rotates once per orbit with
 * respect to inertial space, so the ground beneath streams past at 7.66 km/s.
 * The Earth mesh is therefore given the rotation that carries its own (Earth-
 * fixed) axes into LVLH:
 *
 *      local → LVLH  =  conj(q_B) ∘ Rz(θ)
 *
 * where q_B is the LVLH basis expressed in ECI, and Rz(θ) is the Earth's own
 * sidereal spin at 7.292e-5 rad/s. The first term is the orbit and dominates —
 * a full revolution every 92.8 minutes. The second is the planet's own day and
 * contributes about 30° over a two-hour rendezvous. Together they give a correct
 * ground track: you fly over the terminator, over coastlines, over the night
 * side with the cities lit.
 *
 * NO EXTERNAL IMAGES. Everything here is drawn into a canvas at load. The sim
 * has to work from file:// with no server and no network, which rules out
 * fetching a Blue Marble tile, and a repo full of megabyte textures is its own
 * problem. Fractal noise on the sphere gets close enough at the scale this is
 * ever seen from, and it costs about a quarter of a second once.
 */
"use strict";

const EARTH = {
    radius: 6371,                 // km — the background scene works in kilometres
    spin: 7.2921159e-5,           // rad/s, sidereal
    texW: 2048, texH: 1024
};

/* ------------------------------------------------------------ value noise */
/* 3D value noise on a hashed integer lattice, sampled on the sphere so there is
 * no seam at the dateline and no pinching at the poles — which is what you get
 * from 2D noise in equirectangular UV, and it is very obvious on a globe. */
function hash3(i, j, k) {
    let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    // Quintic smoothstep — C² continuous, so the fBm has no visible lattice.
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const l = (a, b, t) => a + (b - a) * t;
    const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
    const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
    const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
    const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
    return l(l(l(c000, c100, u), l(c010, c110, u), v),
        l(l(c001, c101, u), l(c011, c111, u), v), w);
}
function fbm(x, y, z, oct, lac, gain) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
        s += a * vnoise(x * f, y * f, z * f);
        n += a; a *= gain; f *= lac;
    }
    return s / n;
}
/* Ridged multifractal — the |1−2n| fold is what turns smooth blobs into
 * mountain chains and coastlines with fjords instead of circles. */
function ridged(x, y, z, oct) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
        const v = 1 - Math.abs(2 * vnoise(x * f, y * f, z * f) - 1);
        s += a * v * v; n += a; a *= 0.5; f *= 2.1;
    }
    return s / n;
}

/* ------------------------------------------------------------- the maps */
function buildEarthTextures() {
    const W = EARTH.texW, H = EARTH.texH;
    const day = document.createElement("canvas"); day.width = W; day.height = H;
    const night = document.createElement("canvas"); night.width = W >> 1; night.height = H >> 1;
    const cloud = document.createElement("canvas"); cloud.width = W; cloud.height = H;

    const dctx = day.getContext("2d");
    const dimg = dctx.createImageData(W, H);
    const dd = dimg.data;
    const cctx = cloud.getContext("2d");
    const cimg = cctx.createImageData(W, H);
    const cd = cimg.data;

    for (let j = 0; j < H; j++) {
        // Equirectangular: v → colatitude, u → longitude, sampled on the unit
        // sphere so the noise is isotropic and the poles do not pinch.
        const theta = (j + 0.5) / H * Math.PI;
        const st = Math.sin(theta), ct = Math.cos(theta);
        const lat = Math.abs(ct);                       // 0 equator … 1 pole
        for (let i = 0; i < W; i++) {
            const phi = (i + 0.5) / W * Math.PI * 2;
            const x = st * Math.cos(phi), y = st * Math.sin(phi), z = ct;
            const S = 2.3;

            /* ---- land / sea ---- */
            // Two scales: a low-frequency field that decides where continents
            // are at all, and a ridged one that gives them coastlines.
            const base = fbm(x * S, y * S, z * S, 6, 2.05, 0.52);
            const detail = ridged(x * S * 3.1 + 11, y * S * 3.1, z * S * 3.1, 5);
            // Push land away from the poles a little so the ice caps sit on
            // ocean and read as sea ice rather than as a white continent.
            const h = base * 0.82 + detail * 0.18 - lat * 0.05;
            const SEA = 0.505;
            const p = (j * W + i) * 4;

            if (h < SEA) {
                // Ocean: depth-shaded, with a brighter shelf at the coast.
                const d = Math.min(1, (SEA - h) / 0.14);
                const shelf = 1 - d;
                dd[p] = 8 + 26 * shelf;
                dd[p + 1] = 34 + 74 * shelf;
                dd[p + 2] = 78 + 96 * shelf;
            } else {
                const e = Math.min(1, (h - SEA) / 0.16);          // 0 coast … 1 highland
                // Biome by latitude with a noisy boundary, so the deserts and
                // the tree line are not perfect circles of latitude.
                const wob = fbm(x * 5.5 + 31, y * 5.5, z * 5.5, 3, 2, 0.5) - 0.5;
                const l = lat + wob * 0.10;
                let r, g, b;
                if (l > 0.78) { r = 232; g = 238; b = 244; }                 // ice
                else if (l > 0.62) { r = 120; g = 132; b = 112; }            // tundra
                else if (l > 0.44) { r = 74; g = 104; b = 60; }              // boreal
                else if (l > 0.30) { r = 96; g = 116; b = 62; }              // temperate
                else if (l > 0.20) { r = 158; g = 138; b = 88; }             // arid
                else { r = 62; g = 104; b = 52; }                            // tropical
                // Highlands go grey-brown and then snow-capped.
                const rock = Math.min(1, e * 1.35);
                r = r * (1 - rock) + 132 * rock;
                g = g * (1 - rock) + 118 * rock;
                b = b * (1 - rock) + 100 * rock;
                if (e > 0.72) {
                    const s = (e - 0.72) / 0.28;
                    r = r * (1 - s) + 246 * s; g = g * (1 - s) + 248 * s; b = b * (1 - s) + 252 * s;
                }
                dd[p] = r; dd[p + 1] = g; dd[p + 2] = b;
            }
            // Polar caps sit on top of everything.
            if (lat > 0.80) {
                // Wide, noisy edge. A hard threshold puts a visible staircase
                // of latitude bands across the cap, and at orbital altitude the
                // texture is magnified enough that the steps are obvious.
                const wob2 = fbm(x * 7.5 + 61, y * 7.5, z * 7.5, 3, 2, 0.5) - 0.5;
                const s = Math.max(0, Math.min(1, (lat - 0.80 + wob2 * 0.06) / 0.13));
                dd[p] = dd[p] * (1 - s) + 244 * s;
                dd[p + 1] = dd[p + 1] * (1 - s) + 248 * s;
                dd[p + 2] = dd[p + 2] * (1 - s) + 254 * s;
            }
            /* ALPHA MUST STAY 255. The specular mask used to be smuggled in
             * here — 255 on water, 26 on land — which cost nothing and broke
             * everything: a canvas backing store is PREMULTIPLIED, so writing
             * alpha 26 with a green of 104 stores a green of 10, and three.js
             * uploads that premultiplied value as-is. Every land pixel came
             * back at a tenth of its brightness, so the planet rendered as a
             * blown-out ocean with invisible continents. The mask is recovered
             * in the shader from the colour instead: ocean is the blue-dominant
             * part of the map, which it is by construction. */
            dd[p + 3] = 255;

            /* ---- clouds ----
             * Banded by latitude, because the real thing is: a wet band at the
             * equator, clear subtropics, storm tracks at mid latitudes. Without
             * the banding, fractal noise looks like a marble, not a planet. */
            const cf = fbm(x * 3.4 + 71, y * 3.4 + 13, z * 3.4, 6, 2.2, 0.55);
            const band = 0.55 + 0.45 * Math.cos(lat * Math.PI * 3.1);
            const swirl = ridged(x * 6.2 + 5, y * 6.2, z * 6.2 + 9, 4);
            let c = (cf * 0.72 + swirl * 0.28) * band * 1.45 - 0.42;
            c = Math.max(0, Math.min(1, c * 1.9));
            cd[p] = 255; cd[p + 1] = 255; cd[p + 2] = 255;
            cd[p + 3] = c * 235;
        }
    }
    dctx.putImageData(dimg, 0, 0);
    cctx.putImageData(cimg, 0, 0);

    /* ---- night lights ----
     * Clustered on temperate, low-lying land near coasts, which is where they
     * are. Drawn at half resolution and blurred by overdraw — city light is a
     * glow, not a pixel. */
    const nctx = night.getContext("2d");
    nctx.fillStyle = "#000"; nctx.fillRect(0, 0, night.width, night.height);
    nctx.globalCompositeOperation = "lighter";
    const NW = night.width, NH = night.height;
    for (let j = 0; j < NH; j += 1) {
        const theta = (j + 0.5) / NH * Math.PI;
        const st = Math.sin(theta), ct = Math.cos(theta);
        const lat = Math.abs(ct);
        if (lat > 0.72) continue;
        for (let i = 0; i < NW; i += 1) {
            const phi = (i + 0.5) / NW * Math.PI * 2;
            const x = st * Math.cos(phi), y = st * Math.sin(phi), z = ct;
            const S = 2.3;
            const base = fbm(x * S, y * S, z * S, 6, 2.05, 0.52);
            const detail = ridged(x * S * 3.1 + 11, y * S * 3.1, z * S * 3.1, 5);
            const h = base * 0.82 + detail * 0.18 - lat * 0.05;
            if (h < 0.505 || h > 0.60) continue;         // land, but lowland
            const pop = fbm(x * 9 + 101, y * 9, z * 9 + 55, 4, 2.3, 0.5);
            if (pop < 0.63) continue;
            const b = Math.min(1, (pop - 0.63) / 0.22);
            const r = 0.7 + b * 2.6;
            const g = nctx.createRadialGradient(i, j, 0, i, j, r * 2.2);
            g.addColorStop(0, `rgba(255,214,150,${0.55 * b})`);
            g.addColorStop(1, "rgba(255,190,110,0)");
            nctx.fillStyle = g;
            nctx.beginPath(); nctx.arc(i, j, r * 2.2, 0, 7); nctx.fill();
        }
    }

    const mk = (cv) => {
        const t = new THREE.CanvasTexture(cv);
        t.wrapS = THREE.RepeatWrapping;
        t.anisotropy = 4;
        return t;
    };
    return { day: mk(day), night: mk(night), cloud: mk(cloud) };
}

/* ------------------------------------------------------------- materials */
/* One shader instead of a stack of meshes. It has to do four things a standard
 * material cannot: put the city lights on the night side only, soften the
 * terminator over the few degrees it actually spans, give the ocean a specular
 * highlight the land does not have, and tint the limb blue where the line of
 * sight passes through more atmosphere. */
function earthMaterial(tex) {
    return new THREE.ShaderMaterial({
        uniforms: {
            dayMap: { value: tex.day },
            nightMap: { value: tex.night },
            sunDir: { value: new THREE.Vector3(1, 0, 0) },   // world space
            camPos: { value: new THREE.Vector3() }
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWN;
            varying vec3 vWP;
            varying vec3 vON;
            void main() {
                vUv = uv;
                vWN = normalize(mat3(modelMatrix) * normal);
                // OBJECT-space normal as well. Lighting needs the world normal;
                // anything painted ON the surface needs this one. See below.
                vON = normalize(normal);
                vWP = (modelMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform sampler2D dayMap;
            uniform sampler2D nightMap;
            uniform vec3 sunDir;
            uniform vec3 camPos;
            varying vec2 vUv;
            varying vec3 vWN;
            varying vec3 vWP;
            varying vec3 vON;

            /* PROCEDURAL DETAIL, because the texture cannot win this fight.
             * From 420 km up the Earth fills the sky, so a 2048-wide map is
             * magnified to the point where a single texel spans several pixels
             * and the surface goes smooth and plasticky. Quadrupling the map
             * would cost seconds of load and still lose. Three octaves of hash
             * noise evaluated on the surface point instead give the eye
             * something at every scale, for nothing. The magnification here is
             * effectively constant — the ground is always 420 km away — so it
             * can be applied at a fixed strength without aliasing at range. */
            float h31(vec3 p) {
                return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
            }
            float vn(vec3 p) {
                vec3 i = floor(p), f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = mix(mix(mix(h31(i + vec3(0,0,0)), h31(i + vec3(1,0,0)), f.x),
                                  mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                              mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x),
                                  mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
                return a;
            }
            void main() {
                vec4 d = texture2D(dayMap, vUv);
                /* SAMPLED IN OBJECT SPACE, and this is not a detail.
                 *
                 * It was sampled from the world normal, which rotates with the
                 * mesh — so the detail pattern stayed nailed to the LVLH frame
                 * while the map moved underneath it. The result was two
                 * superimposed surfaces, one gliding past and one standing
                 * perfectly still, which is far more obviously wrong than
                 * having no detail at all. Anything painted ON the planet must
                 * be a function of where it is ON the planet. */
                vec3 sp = normalize(vON);
                float det = vn(sp * 190.0) * 0.5 + vn(sp * 430.0) * 0.32 + vn(sp * 950.0) * 0.18;
                // Land takes more texture than water does.
                float landness = 1.0 - smoothstep(0.02, 0.20, d.b - d.g);
                d.rgb *= 1.0 + (det - 0.5) * (0.10 + 0.26 * landness);
                vec3 N = normalize(vWN);
                float ndl = dot(N, sunDir);

                // The terminator is not a line. Widening it over ~20 degrees is
                // what makes dawn read as dawn instead of as a hard edge.
                float lit = smoothstep(-0.18, 0.28, ndl);
                // Warm the light where it grazes — cheap atmospheric reddening.
                vec3 warm = mix(vec3(1.18, 0.80, 0.58), vec3(1.0), smoothstep(0.0, 0.45, ndl));
                vec3 dayCol = d.rgb * max(ndl, 0.0) * warm * 0.92;

                // Ocean specular. d.a is the specular mask baked into the day
                // map's alpha channel: 1 on water, 0.1 on land.
                vec3 V = normalize(camPos - vWP);
                vec3 Hv = normalize(sunDir + V);
                // Ocean mask from the colour: water is the only thing on the
                // map whose blue dominates its green.
                float ocean = smoothstep(0.02, 0.20, d.b - d.g);
                float spec = pow(max(dot(N, Hv), 0.0), 42.0) * ocean * 0.40;

                vec3 night = texture2D(nightMap, vUv).rgb * (1.0 - lit) * 2.4;
                vec3 col = mix(vec3(0.0), dayCol, lit) + night + spec * lit;

                // Limb: more air along a grazing line of sight.
                float rim = 1.0 - abs(dot(N, V));
                col += vec3(0.16, 0.34, 0.66) * pow(rim, 3.2) * (0.20 + 0.50 * lit);

                /* Soft-knee tone map. Day albedo, specular, limb scattering and
                 * the additive airglow shell all sum well past 1.0 over a sunlit
                 * ocean, and without this the whole day side clips to a flat
                 * white blob with an orange fringe — which is exactly what it
                 * did. Rolling off the highlights keeps the coastlines readable
                 * where the terminator is brightest. */
                col = col / (1.0 + col * 0.42);
                gl_FragColor = vec4(col, 1.0);
            }`
    });
}

function cloudMaterial(tex) {
    return new THREE.ShaderMaterial({
        uniforms: { cloudMap: { value: tex.cloud }, sunDir: { value: new THREE.Vector3(1, 0, 0) } },
        transparent: true,
        depthWrite: false,
        vertexShader: `
            varying vec2 vUv; varying vec3 vWN;
            void main() {
                vUv = uv;
                vWN = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform sampler2D cloudMap; uniform vec3 sunDir;
            varying vec2 vUv; varying vec3 vWN;
            void main() {
                float a = texture2D(cloudMap, vUv).a;
                float ndl = dot(normalize(vWN), sunDir);
                float lit = smoothstep(-0.20, 0.30, ndl);
                vec3 warm = mix(vec3(1.3, 0.82, 0.62), vec3(1.0), smoothstep(0.0, 0.5, ndl));
                // Cloud tops catch the sun before the ground does, so they stay
                // faintly visible a little way past the terminator.
                gl_FragColor = vec4(vec3(1.0) * warm * (0.10 + 0.90 * lit), a * (0.12 + 0.88 * lit));
            }`
    });
}

/* The airglow shell: a back-faced sphere just above the surface, additive, with
 * the intensity driven by how obliquely the line of sight cuts through it.
 * Cheap stand-in for scattering, and it is the single biggest thing separating
 * "sphere with a map on it" from "planet". */
function atmosphereMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: new THREE.Vector3(1, 0, 0) }, camPos: { value: new THREE.Vector3() } },
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexShader: `
            varying vec3 vWN; varying vec3 vWP;
            void main() {
                vWN = normalize(mat3(modelMatrix) * normal);
                vWP = (modelMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 sunDir; uniform vec3 camPos;
            varying vec3 vWN; varying vec3 vWP;
            void main() {
                vec3 N = normalize(vWN);
                vec3 V = normalize(camPos - vWP);
                float rim = pow(1.0 - abs(dot(N, V)), 2.6);
                float lit = smoothstep(-0.45, 0.35, dot(N, sunDir));
                // Sunrise reddening exactly at the terminator, where the light
                // has travelled furthest through the air.
                float dusk = 1.0 - smoothstep(0.0, 0.35, abs(dot(N, sunDir)));
                vec3 col = mix(vec3(0.28, 0.52, 1.0), vec3(1.0, 0.45, 0.22), dusk * 0.75);
                gl_FragColor = vec4(col * rim * lit * 0.55, rim * lit * 0.55);
            }`
    });
}

if (typeof module !== "undefined") {
    module.exports = { EARTH, buildEarthTextures, earthMaterial, cloudMaterial, atmosphereMaterial, fbm, ridged };
}
