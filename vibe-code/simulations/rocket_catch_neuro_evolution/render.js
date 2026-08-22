/* render.js — a passable three.js view of the thing the simulation is doing.
 *
 * Deliberately modest. Everything here exists to make the state of the physics
 * legible: which way the vehicle is pointing, which fins are deflected, how many
 * engines are lit, and how far it is from a set of steel arms 110 m up. There is
 * no attempt at a photograph.
 *
 * Two details are not cosmetic and are worth stating:
 *
 *  · THE HARDWARE IS DRAWN WHERE THE PHYSICS PUTS IT. Grid fins are at body
 *    z = 63.5 because that is where aero.js applies their force; the catch pins
 *    are at z = 61 because that is what world.js tests against the rails. If the
 *    drawing and the model disagree the render will show a clean catch on an
 *    episode the simulation scored as a miss, and it is the render that is
 *    lying. (The docking project in this collection drew a docking ring 0.75 m
 *    forward of the modelled one and the finished docking looked like the port
 *    had detached and stuck to the capsule.)
 *
 *  · THE SCENE IS METRES, ONE TO ONE. A 72 m booster and a 146 m tower are drawn
 *    at their real sizes, which is most of why the catch reads as difficult:
 *    the capture tolerance is 1.7 m on an object nine metres wide.
 *
 * ON COLOUR, BECAUSE IT COST AN AFTERNOON. This three predates automatic colour
 * management: a hex written into a material and a 2-D canvas handed to a
 * texture are both taken as LINEAR, and both are painted in sRGB by anyone who
 * picked them by eye. Everything here therefore goes through srgb() or through
 * drawTex(), which tags its output sRGB — except data maps (roughness, normals,
 * alpha), which are genuinely linear and must not be tagged. Skip it and an
 * outdoor scene renders as a white desert at any exposure you choose.
 *
 * There is a night mode. It is entirely cosmetic — setNight() moves the sky,
 * the two key lights, the fog, the environment probe and the site lighting, and
 * reads nothing the simulation owns — so it can be flipped mid-flight, and
 * ?night selects it at load.
 */
"use strict";

const RNDR = (function () {
    const V = window.Vehicle, T = V.TOWER;

    /* THE FRAME MAPPING, WRITTEN DOWN ONCE.
     *
     * The simulation is Z-up (x east, y north, z up). three.js is Y-up. Every
     * position in this file goes through
     *      (x, y, z)_sim  ->  (x, z, -y)_scene
     * which is a -90 degree rotation about X, and every rotation goes through
     * the matching similarity transform, which for a quaternion (x,y,z,w) is
     * just (x, z, -y, w).
     *
     * The -y is the part that is easy to drop, and dropping it mirrors the
     * scene: fins end up on the wrong side of the hull, deflections read
     * backwards, and the sea is drawn inland. Use these two helpers rather than
     * writing the mapping out by hand.
     */
    const sx = (x, y, z) => [x, z, -y];

    /* ------------------------------------------------------------ helpers */
    function noiseCanvas(size, fn) {
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const ctx = c.getContext("2d");
        const img = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const rgb = fn(x / size, y / size);
            img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    function hash2(x, y) {
        let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return h - Math.floor(h);
    }

    /* A canvas texture from a draw callback. Everything painted rather than
     * per-pixel goes through here: it is an order of magnitude faster to build
     * than noiseCanvas and the results are smooth instead of hashy.
     *
     * THE ENCODING IS NOT OPTIONAL. This three has no automatic colour
     * management: a texture is fed to the shader exactly as its bytes stand and
     * is assumed to be linear, while a 2-D canvas is painted in sRGB — so
     * "rgb(180,170,145)" sand, which is a 0.44 linear albedo, arrives as a 0.71
     * one. Every colour map in this file was that much too bright at once,
     * which under ACES came out as a white beach, a white tower and a white
     * rocket. Tagging them sRGB makes the renderer decode on sample and makes
     * the numbers painted here mean what they look like. DATA maps — roughness,
     * normals — are genuinely linear and must NOT be tagged. */
    function drawTex(w, h, fn, clamp, linear) {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        fn(c.getContext("2d"), w, h);
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        t.encoding = linear ? THREE.LinearEncoding : THREE.sRGBEncoding;
        t.anisotropy = 8;
        return t;
    }

    /* THE SAME ENCODING TRAP AS drawTex, FOR PLAIN COLOURS.
     *
     * A hex written into a material here is used as a LINEAR value, so
     * 0xc4b997 — which looks like beach sand in any colour picker — arrives as
     * a 0.77 albedo, which is fresh snow, and an outdoor scene built from
     * eye-picked hexes comes out white under any exposure that is not
     * comically dark. Colours chosen by eye go through this; the ones that were
     * already tuned against the old lighting are left alone, because they were
     * tuned as linear whether or not anyone said so. */
    function srgb(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

    /* Smooth value noise. hash2 alone is white noise and reads as television
     * static at any size; two octaves of this reads as weathering. */
    function vnoise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const a = hash2(xi, yi), b = hash2(xi + 1, yi);
        const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
    function fbm(x, y, oct) {
        let s = 0, amp = 0.5, f = 1, norm = 0;
        for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); norm += amp; f *= 2; amp *= 0.5; }
        return s / norm;
    }

    /* TILEABLE fbm, for anything whose tile is big enough to see the edge of.
     *
     * The ground map is one 512² tile stretched over 625 m of Florida and
     * repeated to the horizon. Ordinary fbm does not wrap, so every tile
     * boundary is a discontinuity — and at that size the boundaries are 625 m
     * apart, which draws a visible chequerboard across the whole landscape.
     * Wrapping the lattice coordinates on a period that doubles with each
     * octave makes every octave periodic and the seam disappears. Inputs are
     * in [0,1). */
    function tvnoise(x, y, per) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const w = (a, b) => hash2(((a % per) + per) % per, ((b % per) + per) % per);
        const a = w(xi, yi), b = w(xi + 1, yi), c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
    function tfbm(x, y, period, oct) {
        let s = 0, amp = 0.5, f = period, norm = 0;
        for (let i = 0; i < oct; i++) {
            s += amp * tvnoise(x * f, y * f, f);
            norm += amp; f *= 2; amp *= 0.5;
        }
        return s / norm;
    }

    /* ------------------------------------------------------ shared textures
     * Built once, on first use, and handed to every material that wants them.
     * A booster is rebuilt on every new seed; regenerating a 1024² canvas each
     * time is a visible hitch and a texture leak. */
    const TEX = {};
    function tex(name, make) {
        if (!TEX[name]) {
            const t = make();
            /* SHARED, AND THE TEARDOWN HAS TO KNOW IT. buildVehicle disposes
             * every texture the outgoing vehicle referenced, which was correct
             * when each vehicle built its own; a cached texture handed to the
             * next booster after being disposed has to be re-uploaded, which is
             * the hitch the cache exists to remove. disposeTree() checks this
             * flag.
             *
             * An own property, not userData: THIS three's Texture has no
             * userData at all (it arrived several revisions later), so writing
             * through it throws on the very first texture built and takes the
             * whole renderer down with it. */
            t.__shared = true;
            TEX[name] = t;
        }
        return TEX[name];
    }

    /* Free a subtree's GPU resources, and only the ones it actually owns.
     *
     * Two things in here are shared and must survive: any texture out of the
     * TEX cache, and a Sprite's geometry — every Sprite in three points at ONE
     * module-level quad, so disposing it from one sprite's teardown tears down
     * the buffers behind every other sprite in the scene. */
    function disposeTree(root) {
        root.traverse((o) => {
            if (o.geometry && !o.isSprite) o.geometry.dispose();
            if (!o.material) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                for (const k of ["map", "roughnessMap", "normalMap", "alphaMap", "emissiveMap"]) {
                    const t = m[k];
                    if (t && !t.__shared) t.dispose();
                }
                m.dispose();
            }
        });
    }

    /* Rolled stainless. Starship's skin is not a mirror — it is mill-finish
     * sheet with the roll direction running around the hull, so the streaks are
     * horizontal in texture space (u runs around the circumference) and the
     * mottling between them is what catches the light. */
    function steelMap() {
        return tex("steel", () => drawTex(512, 512, (g, w, h) => {
            g.fillStyle = "#c9d2da"; g.fillRect(0, 0, w, h);
            // broad cloudy variation in the anneal
            for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
                const n = fbm(x / 46, y / 120, 3);
                g.fillStyle = "rgba(255,255,255," + (n * 0.20).toFixed(3) + ")";
                g.fillRect(x, y, 2, 2);
                if (n < 0.42) { g.fillStyle = "rgba(96,108,122," + ((0.42 - n) * 0.42).toFixed(3) + ")"; g.fillRect(x, y, 2, 2); }
            }
            // roll streaks, horizontal
            for (let i = 0; i < 1400; i++) {
                const y = Math.random() * h, len = 40 + Math.random() * 420;
                const x = Math.random() * w;
                const a = 0.028 + Math.random() * 0.06;
                g.strokeStyle = (Math.random() < 0.5 ? "rgba(255,255,255," : "rgba(88,99,112,") + a.toFixed(3) + ")";
                g.lineWidth = Math.random() < 0.8 ? 1 : 2;
                g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y); g.stroke();
            }
            // faint vertical sheet joints
            g.strokeStyle = "rgba(120,131,144,0.30)"; g.lineWidth = 1;
            for (let k = 0; k < 4; k++) {
                const x = (k + 0.5) * (w / 4);
                g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
            }
        }));
    }

    /* Roughness for the same skin. Stainless is only shiny where it is smooth,
     * and the streaks are exactly where it is not — a constant roughness makes
     * the hull read as painted plastic no matter what the colour is. */
    function steelRough() {
        // linear: this is a data map, not a colour one
        return tex("steelR", () => drawTex(256, 256, (g, w, h) => {
            g.fillStyle = "#4a4a4a"; g.fillRect(0, 0, w, h);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x += 2) {
                const n = fbm(x / 24, y / 70, 3);
                const v = Math.round(56 + n * 120);
                g.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
                g.fillRect(x, y, 2, 1);
            }
            for (let i = 0; i < 500; i++) {
                const y = Math.random() * h, x = Math.random() * w;
                g.strokeStyle = "rgba(210,210,210,0.22)"; g.lineWidth = 1;
                g.beginPath(); g.moveTo(x, y); g.lineTo(x + 30 + Math.random() * 160, y); g.stroke();
            }
        }, false, true));
    }

    /* The Ship's windward face: hexagonal black ceramic, laid in offset rows,
     * with the gaps between them showing as a lighter grid. A flat black
     * cylinder segment reads as a shadow; the tiles are the single most
     * recognisable thing on the vehicle. */
    function tileMap() {
        return tex("tile", () => drawTex(512, 512, (g, w, h) => {
            g.fillStyle = "#6f7278"; g.fillRect(0, 0, w, h);        // the gaps
            const R = 15, dx = R * 1.732, dy = R * 1.5;
            for (let row = -1; row * dy < h + R; row++) {
                for (let col = -1; col * dx < w + R; col++) {
                    const cx = col * dx + (row & 1 ? dx / 2 : 0), cy = row * dy;
                    const n = hash2(col, row);
                    const v = Math.round(16 + n * 16);
                    g.fillStyle = "rgb(" + v + "," + (v + 1) + "," + (v + 3) + ")";
                    g.beginPath();
                    for (let k = 0; k < 6; k++) {
                        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
                        const px = cx + Math.cos(a) * (R - 1.1), py = cy + Math.sin(a) * (R - 1.1);
                        k ? g.lineTo(px, py) : g.moveTo(px, py);
                    }
                    g.closePath(); g.fill();
                    // a highlight on the upper edge so the tiles have relief
                    g.strokeStyle = "rgba(150,155,165,0.20)"; g.lineWidth = 1;
                    g.beginPath();
                    g.arc(cx, cy, R - 1.6, Math.PI * 1.05, Math.PI * 1.95);
                    g.stroke();
                }
            }
        }));
    }

    /* Soot. Multiplied over the hull near the engine deck: every one of these
     * vehicles comes back with a black skirt and a set of streaks that run up
     * from the bells, and without it the bottom eight metres look factory-new
     * on a stage that has just flown. */
    function sootMap() {
        return tex("soot", () => drawTex(256, 256, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            // v = 0 is the engine plane; darkest there, gone by a third up
            const grd = g.createLinearGradient(0, h, 0, 0);
            grd.addColorStop(0.0, "rgba(14,14,16,0.92)");
            grd.addColorStop(0.10, "rgba(20,20,23,0.72)");
            grd.addColorStop(0.30, "rgba(30,30,34,0.30)");
            grd.addColorStop(0.55, "rgba(40,40,44,0.06)");
            grd.addColorStop(1.0, "rgba(0,0,0,0)");
            g.fillStyle = grd; g.fillRect(0, 0, w, h);
            // licking streaks
            for (let i = 0; i < 90; i++) {
                const x = Math.random() * w, len = 20 + Math.random() * 130;
                const gg = g.createLinearGradient(0, h, 0, h - len);
                const a = 0.10 + Math.random() * 0.30;
                gg.addColorStop(0, "rgba(10,10,12," + a.toFixed(3) + ")");
                gg.addColorStop(1, "rgba(10,10,12,0)");
                g.fillStyle = gg;
                g.fillRect(x, h - len, 2 + Math.random() * 7, len);
            }
        }));
    }

    /* One engine plume, painted. The bright throat, the shock diamonds in the
     * first third, and the long fade are all in the texture, so the plume is
     * two cones and no per-frame geometry work. */
    function plumeMap() {
        return tex("plume", () => {
            const t = drawTex(64, 256, (g, w, h) => {
                g.clearRect(0, 0, w, h);
                // v = 1 (canvas top) is the nozzle
                for (let y = 0; y < h; y++) {
                    const v = 1 - y / (h - 1);                 // 1 at the throat
                    const s = 1 - v;                            // distance downstream
                    /* HOLD, THEN FADE. A plain power falloff from the throat
                     * makes the brightest part of the flame a point and the
                     * rest a taper, which draws as a white needle. A real
                     * exhaust is at full brightness for the whole shock train
                     * and only then breaks up, so this holds flat for the first
                     * fifth and falls off over the rest. */
                    let a = (s < 0.18 ? 1.0 : Math.pow(1 - (s - 0.18) / 0.82, 1.5)) * 0.98;
                    // shock diamonds, decaying
                    a *= 1 + 0.75 * Math.exp(-s * 5.5) * Math.max(0, Math.sin(s * 42 - 0.6));
                    const warm = Math.min(1, s * 1.9);
                    const r = 255, gg = Math.round(250 - warm * 88), b = Math.round(232 - warm * 182);
                    g.fillStyle = "rgba(" + r + "," + gg + "," + b + "," + Math.max(0, Math.min(1, a)).toFixed(3) + ")";
                    g.fillRect(0, y, w, 1);
                }
                // soften the rim so the cone has no hard silhouette
                const rim = g.createLinearGradient(0, 0, w, 0);
                rim.addColorStop(0, "rgba(0,0,0,0.72)");
                rim.addColorStop(0.5, "rgba(0,0,0,0)");
                rim.addColorStop(1, "rgba(0,0,0,0.72)");
                g.globalCompositeOperation = "destination-out";
                g.fillStyle = rim; g.fillRect(0, 0, w, h);
            }, false);
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
            return t;
        });
    }

    /* A soft round blob. Nozzle glow, dust, smoke, cloud, star — every additive
     * billboard in the scene is this one texture tinted differently. */
    function glowMap() {
        return tex("glow", () => drawTex(128, 128, (g, w, h) => {
            const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
            grd.addColorStop(0, "rgba(255,255,255,1)");
            grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
            grd.addColorStop(0.55, "rgba(255,255,255,0.16)");
            grd.addColorStop(1, "rgba(255,255,255,0)");
            g.fillStyle = grd; g.fillRect(0, 0, w, h);
        }, true));
    }

    /* A puffy blob for cumulus and for the smoke column: the same round falloff
     * with lumps bitten out of it, which is what stops a cloud reading as a
     * sphere. */
    function puffMap() {
        return tex("puff", () => drawTex(256, 256, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            for (let i = 0; i < 26; i++) {
                const a = hash2(i, 3) * Math.PI * 2, r = 22 + hash2(i, 7) * 54;
                const cx = 128 + Math.cos(a) * r * (0.5 + hash2(i, 11) * 0.7);
                const cy = 128 + Math.sin(a) * r * 0.55;
                const rr = 26 + hash2(i, 13) * 46;
                const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
                grd.addColorStop(0, "rgba(255,255,255,0.92)");
                grd.addColorStop(0.42, "rgba(248,250,254,0.60)");
                grd.addColorStop(0.74, "rgba(238,243,250,0.18)");
                grd.addColorStop(1, "rgba(255,255,255,0)");
                g.fillStyle = grd;
                g.beginPath(); g.arc(cx, cy, rr, 0, 6.2832); g.fill();
            }
            // trim the square corners so a scaled sprite never shows an edge
            g.globalCompositeOperation = "destination-in";
            const cut = g.createRadialGradient(128, 128, 40, 128, 128, 126);
            cut.addColorStop(0, "rgba(0,0,0,1)");
            cut.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = cut; g.fillRect(0, 0, w, h);
        }, true));
    }

    /* Surf. One band of foam that scrolls along the beach; the alpha is what
     * makes it read as water rather than as a white stripe. */
    function foamMap() {
        return tex("foam", () => drawTex(512, 64, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            for (let y = 0; y < h; y++) {
                const v = y / (h - 1);
                for (let x = 0; x < w; x += 2) {
                    const n = fbm(x / 18 + v * 3, y / 9, 3);
                    // the break is a ridge partway across the band
                    const ridge = Math.exp(-Math.pow((v - (0.42 + n * 0.16)) / 0.16, 2));
                    const a = Math.max(0, ridge * (0.35 + n * 0.85) - 0.10);
                    if (a > 0.01) {
                        g.fillStyle = "rgba(238,246,250," + Math.min(0.92, a).toFixed(3) + ")";
                        g.fillRect(x, y, 2, 1);
                    }
                }
            }
        }));
    }

    class Scene {
        constructor(canvas) {
            this.canvas = canvas;
            this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.renderer.setClearColor(0x8599b8);
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.05;

            this.scene = new THREE.Scene();
            /* THE FOG COLOUR IS THE SKY SHADER'S HORIZON COLOUR, AND BOTH ARE
             * LINEAR. Any other value draws a seam along the horizon where
             * fully-fogged ground meets the dome — and the sky used to have one,
             * because fog is applied inside a built-in material and therefore
             * gets tone-mapped and sRGB-encoded on the way out, while the sky
             * dome's own ShaderMaterial wrote gl_FragColor raw. The two could
             * not match whatever numbers were typed in. The sky shader now ends
             * with the same tonemapping/encodings includes every built-in
             * material uses, so a colour written here and the same colour
             * written there land on the same pixel value.
             *
             * Which is why these are (0.52, 0.60, 0.72) and not the paler
             * numbers they look like: they are pre-tone-map.
             *
             * EXPONENTIAL, NOT LINEAR. Linear fog from 900 m to 9 km is opaque
             * at nine kilometres, and this vehicle spends most of its flight
             * ABOVE nine kilometres looking down — so the entire landscape was
             * a flat sheet of haze colour on every shot that mattered, and no
             * amount of retuning the ground's albedo could have fixed it,
             * because the ground was barely being drawn. Exponential-squared
             * fog leaves the near field crisp (7% at 3 km) and still buries the
             * 20 km edge of the land plane (96%), which is the only thing the
             * old opaque-by-9-km rule was buying. */
            this.scene.fog = new THREE.FogExp2(0x8599b8, 9.0e-5);
            this.night = false;
            this.plumeGain = 1.0;
            /* Simulation time, mirrored here for the sky's twinkle and the
             * water. Kept off wall-clock for the same reason every other effect
             * is: a paused frame must hold still and a replay must look the
             * same twice. */
            this.simT = 0;

            /* NEAR AND FAR ARE A Z-FIGHTING BUDGET, NOT A VIEWING PREFERENCE.
             * Depth-buffer precision goes as near/far: at 0.5 and 60 000 this
             * scene had a ratio of 120 000, which spends almost the entire
             * 24-bit buffer on the first few metres and leaves the shoreline
             * two kilometres away with metres of resolution. That is what made
             * the water shimmer against the sand. 2 and 30 000 is a ratio of
             * 15 000 — a factor of eight more precision everywhere — and costs
             * nothing here: nothing is ever 2 m from the camera, the sky dome
             * is at 28 000, and the fog is opaque by 9 000 so the far plane is
             * never visible. */
            this.camera = new THREE.PerspectiveCamera(52, 1, 2, 30000);
            this.camMode = "chase";
            this.orbit = { az: 2.2, el: 0.28, dist: 260, target: new THREE.Vector3(0, T.height * 0.55, 0) };
            this.drag = null;

            /* Night-only hardware lives here and nowhere else, so setNight() is
             * one visible flag rather than a list of objects to remember. */
            this.nightGroup = new THREE.Group();
            this.nightGroup.visible = false;
            this.scene.add(this.nightGroup);

            this.buildEnv();
            this.buildSky();
            this.buildLights();
            this.buildGround();
            this.buildScenery();
            this.buildClouds();
            this.buildTower();
            this.vehicle = null;
            this.rig = null;
            this.sensorsOn = false;
            this.trail = this.buildTrail();
            this.buildEffects();

            this.bindInput();
        }

        /* THE ENVIRONMENT MAP IS WHY THE STEEL LOOKS LIKE STEEL.
         *
         * A MeshStandardMaterial's metallic term is entirely a reflection: with
         * no environment there is nothing to reflect, so raising metalness only
         * ever darkens the surface, which is the trap the vehicle materials
         * used to be tuned around (see buildVehicle). Two tiny equirectangular
         * canvases — sky above, ground below, a sun blob in the right place —
         * put through the PMREM prefilter give every rough metal in the scene
         * something to catch, for one 256×128 texture per mode and no runtime
         * cost at all. */
        buildEnv() {
            const paint = (night) => drawTex(256, 128, (g, w, h) => {
                const sky = g.createLinearGradient(0, 0, 0, h * 0.5);
                if (night) {
                    sky.addColorStop(0, "#04060d");
                    sky.addColorStop(1, "#101828");
                } else {
                    sky.addColorStop(0, "#2f5fa8");
                    sky.addColorStop(1, "#cfe0ee");
                }
                g.fillStyle = sky; g.fillRect(0, 0, w, h * 0.5);
                g.fillStyle = night ? "#0a0d12" : "#6d6a5c";
                g.fillRect(0, h * 0.5, w, h * 0.5);
                // the sun (or the moon), at the azimuth the light comes from
                const cx = night ? w * 0.28 : w * 0.72, cy = night ? h * 0.20 : h * 0.30;
                const r = night ? 9 : 22;
                const b = g.createRadialGradient(cx, cy, 0, cx, cy, r);
                b.addColorStop(0, night ? "rgba(190,205,235,1)" : "rgba(255,250,235,1)");
                b.addColorStop(1, night ? "rgba(190,205,235,0)" : "rgba(255,240,200,0)");
                g.fillStyle = b; g.fillRect(cx - r, cy - r, r * 2, r * 2);
            }, true);

            const pm = new THREE.PMREMGenerator(this.renderer);
            pm.compileEquirectangularShader();
            const mk = (n) => {
                const t = paint(n);
                t.mapping = THREE.EquirectangularReflectionMapping;
                t.encoding = THREE.sRGBEncoding;   // painted in sRGB, like every other canvas here
                const rt = pm.fromEquirectangular(t).texture;
                t.dispose();
                return rt;
            };
            this.envDay = mk(false);
            this.envNight = mk(true);
            pm.dispose();
            this.scene.environment = this.envDay;
        }

        buildSky() {
            /* 24×16 was enough for three flat gradient bands. Stars are a
             * per-fragment function of the interpolated direction, and on a
             * coarse sphere that direction bends across each face — the
             * constellations visibly warp when the camera turns. 64×40 is still
             * one draw call of nothing. */
            const g = new THREE.SphereGeometry(28000, 64, 40);
            const m = new THREE.ShaderMaterial({
                side: THREE.BackSide, depthWrite: false, fog: false,
                uniforms: {
                    uNight: { value: 0 },
                    uSunDir: { value: new THREE.Vector3(-0.48, 0.46, 0.75) },
                    uMoonDir: { value: new THREE.Vector3(0.44, 0.42, -0.79) },
                    uTime: { value: 0 }
                },
                vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
                fragmentShader: `varying vec3 vP;
                  uniform float uNight, uTime;
                  uniform vec3 uSunDir, uMoonDir;
                  float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453123); }
                  void main(){
                    vec3 d = normalize(vP);
                    float h = clamp(d.y*0.5+0.5, 0.0, 1.0);

                    /* ---- day. Linear values: they are tone-mapped below. ---- */
                    vec3 c = mix(vec3(0.52,0.60,0.72), vec3(0.115,0.245,0.92), smoothstep(0.48,0.63,h));
                    c = mix(c, vec3(0.030,0.094,0.337), smoothstep(0.63,0.97,h));
                    float sd = max(dot(d, uSunDir), 0.0);
                    /* Aerial perspective: the air near the horizon on the sun's
                     * side is the brightest part of a real sky and the part a
                     * flat three-stop gradient never has. */
                    c = mix(c, vec3(0.95,0.86,0.70), pow(sd,2.5)*(1.0-smoothstep(0.44,0.62,h))*0.55);
                    c += vec3(1.0,0.80,0.52) * pow(sd, 30.0) * 0.55;
                    /* The disc, at very nearly its real half-degree. Wider and
                     * it reads as a lens flare rather than as the sun. */
                    c += vec3(1.0,0.97,0.90) * smoothstep(0.999950, 0.999976, sd) * 40.0;

                    /* ---- night ---- */
                    vec3 n = mix(vec3(0.0145,0.021,0.036), vec3(0.009,0.014,0.028), smoothstep(0.42,0.62,h));
                    n = mix(n, vec3(0.0035,0.006,0.016), smoothstep(0.62,0.99,h));
                    if (uNight > 0.01 && d.y > -0.03) {
                        /* Stars as a jittered point lattice: one cell in sixty
                         * holds a star, placed at a random spot inside its cell
                         * so the field has no grid in it. */
                        vec3 sp = d * 190.0;
                        vec3 cell = floor(sp);
                        float r0 = h31(cell);
                        if (r0 > 0.9835) {
                            vec3 off = vec3(h31(cell+1.7), h31(cell+5.3), h31(cell+9.1));
                            float dd = length(fract(sp) - off);
                            float tw = 0.62 + 0.38*sin(uTime*2.1 + r0*97.0);
                            float mag = 0.25 + 0.75*h31(cell+13.9);
                            n += vec3(0.80,0.86,1.0) * smoothstep(0.30,0.0,dd)
                                 * tw * mag * 3.4 * smoothstep(-0.03,0.14,d.y);
                        }
                        // the galactic band, barely there — it just stops the sky being flat
                        /* Narrow and very faint. Wide enough and bright
                         * enough, this stops being the galaxy and becomes a
                         * searchlight lying across the sky. */
                        float band = 1.0 - abs(dot(d, normalize(vec3(0.62,0.34,0.71))));
                        n += vec3(0.0075,0.0080,0.0130) * pow(max(0.0, band*1.01), 26.0);
                    }
                    float md = max(dot(d, uMoonDir), 0.0);
                    n += vec3(0.42,0.50,0.72) * pow(md, 14.0) * 0.055;
                    n += vec3(0.90,0.93,1.0) * smoothstep(0.99986, 0.99993, md) * 3.2;

                    gl_FragColor = vec4(mix(c, n, uNight), 1.0);
                    #include <tonemapping_fragment>
                    #include <encodings_fragment>
                  }`
            });
            this.sky = new THREE.Mesh(g, m);
            this.sky.renderOrder = -1;
            this.scene.add(this.sky);
        }

        buildLights() {
            /* THE SUN USED TO BE BELOW THE HORIZON. It sat at y = −500, so the
             * scene's key light shone upward: nothing had a lit top, the
             * shadow map was cast from underground, and the only reason it did
             * not read as obviously wrong is that the hemisphere light was
             * carrying the whole image. It is now at a late-afternoon 28°,
             * seaward and to the west, which is also where the sky shader puts
             * the sun disc — the two are driven from the same direction below. */
            /* THE EXPOSURE BUDGET. Four sources now light this scene where
             * there used to be three, and one of them — the environment probe —
             * is an ambient term that did not exist at all. Moving the sun above
             * the horizon on its own roughly doubled the ground's irradiance,
             * because it had been contributing nothing to an upward-facing
             * surface. So the hemisphere and fill are both cut hard: the probe
             * does the job the hemisphere light was faking, and does it with the
             * sky's actual colour gradient rather than a two-colour blend. */
            const sun = new THREE.DirectionalLight(0xfff0d8, 2.05);
            sun.position.set(-1180, 1130, 1840);
            /* One shadow map, scoped tight. The shadow camera is a 420 m box
             * over the launch site — the only place a shadow is ever read
             * against something — so the whole 40 km scene never dilutes the
             * map. Everything outside the box simply casts nothing, which at
             * these distances is invisible. The map is 2048²: at 1024 the
             * chopsticks' shadow on the tower was four pixels wide. */
            sun.castShadow = true;
            sun.shadow.mapSize.set(2048, 2048);
            const sc = sun.shadow.camera;
            sc.near = 200; sc.far = 4200;
            sc.left = -420; sc.right = 420; sc.top = 420; sc.bottom = -420;
            sun.shadow.bias = -0.0006;
            sun.shadow.normalBias = 0.6;
            sun.target.position.set(0, 0, 0);
            this.scene.add(sun.target);
            this.scene.add(sun);
            this.sun = sun;
            /* Keep the shader's sun disc on the light's own direction. Two
             * numbers that mean "where the sun is" always drift apart. */
            this.sky.material.uniforms.uSunDir.value.copy(sun.position).normalize();

            this.hemi = new THREE.HemisphereLight(0xbcd8f5, 0x6a5f45, 0.24);
            this.scene.add(this.hemi);
            this.fill = new THREE.DirectionalLight(0x9fc0e8, 0.22);
            this.fill.position.set(700, 900, -300);
            this.scene.add(this.fill);

            /* The engine light: one point light shared by every plume, warm,
             * with intensity written from thrust each frame. Per-engine lights
             * would be 13 lights for one effect.
             *
             * THE RANGE IS THE WHOLE STORY, NOT THE INTENSITY.
             *
             * This three does not use inverse-square for point lights unless
             * physicallyCorrectLights is on. It uses (1 − d/range)^decay, which
             * at a 900 m range is still 0.79 at a HUNDRED METRES — so the
             * engine light was not a pool of light under the vehicle, it was a
             * near-uniform wash over most of the visible landscape, and every
             * frame with the engines up came out flat and blown. At 220 m the
             * same curve is 0.56 at 50 m and 0.06 at 150 m, which is a lit
             * area roughly the size of the apron: what a landing burn actually
             * does at night. */
            this.plumeLight = new THREE.PointLight(0xffc890, 0, 220, 2);
            this.scene.add(this.plumeLight);

            /* Night key: a moon, cold and weak, from the opposite quarter so
             * the vehicle is rim-lit rather than flat. Off by default; setNight
             * swaps which of the two casts the shadow. */
            const moon = new THREE.DirectionalLight(0xa8bade, 0.0);
            moon.position.set(1620, 1550, -2900);
            moon.target.position.set(0, 0, 0);
            moon.castShadow = true;
            moon.shadow.mapSize.set(1024, 1024);
            const mc = moon.shadow.camera;
            mc.near = 500; mc.far = 6000;
            mc.left = -420; mc.right = 420; mc.top = 420; mc.bottom = -420;
            moon.shadow.bias = -0.0008;
            moon.shadow.normalBias = 0.8;
            this.scene.add(moon.target);
            this.scene.add(moon);
            this.moon = moon;
            this.sky.material.uniforms.uMoonDir.value.copy(moon.position).normalize();
        }

        /* ------------------------------------------------------- night mode
         * Cosmetic and total: the sky, the two key lights, the fog, the water,
         * the environment every metal reflects, and the site lighting that is
         * only ever switched on when it is dark. Nothing here is read by
         * anything else in the file, so it can be flipped at any moment mid
         * flight. */
        setNight(on) {
            on = !!on;
            if (on === this.night) return;
            this.night = on;
            this.sky.material.uniforms.uNight.value = on ? 1 : 0;

            this.sun.intensity = on ? 0.0 : 2.05;
            this.sun.castShadow = !on;
            this.moon.intensity = on ? 0.30 : 0.0;
            this.moon.castShadow = on;
            this.hemi.intensity = on ? 0.10 : 0.24;
            this.hemi.color.setHex(on ? 0x2b3c5c : 0xbcd8f5);
            this.hemi.groundColor.setHex(on ? 0x0b0e14 : 0x6a5f45);
            this.fill.intensity = on ? 0.06 : 0.22;

            /* The fog colour has to be the sky's horizon colour in whichever
             * mode is showing, or the horizon grows a seam. Both are linear. */
            if (on) { this.scene.fog.color.setRGB(0.0145, 0.021, 0.036); this.scene.fog.density = 1.15e-4; }
            else { this.scene.fog.color.setRGB(0.5216, 0.6000, 0.7216); this.scene.fog.density = 9.0e-5; }
            this.renderer.setClearColor(this.scene.fog.color);
            this.scene.environment = on ? this.envNight : this.envDay;
            /* Everything is darker, so open up. Without this the night is
             * technically correct and unwatchable. */
            this.renderer.toneMappingExposure = on ? 1.55 : 1.05;

            if (this.seaMat) {
                this.seaMat.color.setHex(on ? 0x040a12 : 0x2c5468);
                this.seaMat.roughness = on ? 0.10 : 0.18;
            }
            if (this.swellMat) this.swellMat.color.setHex(on ? 0x0b1522 : 0x35627a);
            if (this.foamMat) this.foamMat.opacity = on ? 0.32 : 0.85;
            if (this.lagoonMat) this.lagoonMat.color.copy(srgb(on ? 0x0a1018 : 0x33566b));
            /* Clouds are lit by the sky, and at night the sky is not lighting
             * anything. Left white they float above a dark scene like paper
             * cut-outs. */
            if (this.cloudMats) for (const m of this.cloudMats) {
                m.color.setHex(on ? 0x141b2c : 0xffffff);
            }
            this.nightGroup.visible = on;
            /* The whole point of a dark scene is that the plume is the brightest
             * thing in it. */
            this.plumeGain = on ? 2.1 : 1.0;
        }

        buildGround() {
            /* CAPE CANAVERAL IS NOT A DESERT. The old ground was flat grey-tan
             * hash noise, which reads as gravel; the Cape is a barrier island —
             * pale quartz sand with saw-palmetto and coastal scrub growing
             * straight out of it in patches. So the ground map carries the
             * patchiness and the scrub instancing sits on top of it, rather
             * than six hundred tufts trying to sell a colour on their own. */
            const tex = drawTex(512, 512, (g, w, h) => {
                for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
                    const big = tfbm(x / w, y / h, 5, 4);
                    const fine = hash2(x, y);
                    // sand, with shell grit
                    let r = 162 + big * 22 + fine * 14;
                    let gg = 152 + big * 21 + fine * 13;
                    let b = 122 + big * 18 + fine * 12;
                    /* THE CAPE IS MOSTLY GREEN, NOT MOSTLY SAND. Open beach is
                     * the last thirty metres before the water; everything
                     * behind the dune line is saw palmetto and coastal scrub
                     * over sand, and a ground map that is all sand renders a
                     * white desert with a rocket on it. The threshold is low
                     * enough that vegetation is the majority of the surface. */
                    const veg = Math.max(0, big - 0.34) / 0.66;
                    const v2 = Math.pow(veg, 1.3) * (0.55 + 0.45 * hash2(x * 0.7, y * 0.7));
                    r += (58 - r) * v2 * 0.95;
                    gg += (72 - gg) * v2 * 0.95;
                    b += (40 - b) * v2 * 0.95;
                    g.fillStyle = "rgb(" + (r | 0) + "," + (gg | 0) + "," + (b | 0) + ")";
                    g.fillRect(x, y, 2, 2);
                }
            });
            /* THE TILE HAS TO BE BIGGER THAN THE FEATURES IN IT. At 180 repeats
             * one tile covered 220 m, so the palmetto patches inside it were 40 m
             * across and averaged into a flat tone by the time the camera was a
             * kilometre up — a uniform pale sheet, which is exactly what a
             * desert looks like and exactly what this is not. 64 repeats puts a
             * tile at 625 m and the patches at a bit over a hundred, which reads
             * as scrubland from any altitude the vehicle flies at. */
            tex.repeat.set(64, 64);

            /* THE SHORELINE, AND WHY THE WATER USED TO SHIMMER.
             *
             * There were two forty-kilometre planes here — land at y = −0.15
             * and sea at y = +0.02 — overlapping in plan view across twenty
             * kilometres, seventeen centimetres apart. No depth buffer resolves
             * seventeen centimetres at two kilometres, so the two surfaces
             * traded pixels every time the camera moved. The fix is not an
             * offset or a polygon bias, it is to stop them overlapping: land
             * ENDS at the shore, water BEGINS there, and a wet-sand strip at a
             * third distinct height covers the seam. No two of the three are
             * ever coplanar and no two ever occupy the same ground.
             *
             * WHERE THE SHORE GOES IS DECIDED BY THE PHYSICS, NOT BY TASTE.
             * scenarios.js puts the divert areas on a seaward bearing at
             * 150–2600 m and vehicle.js puts the concrete pad 170 m seaward,
             * so the shore has to sit between the pad and the diverts. 330 m
             * clears the pad's far edge by 120 m. Nothing here may move a
             * physics target to make the scenery tidier, so the closest
             * stage-0 diverts do straddle the surf line — which is honest: they
             * are 150 m offshore of a beach that is 330 m away. */
            const SHORE = -V.SITE.shoreY;   // one owner: vehicle.js
            const land = new THREE.Mesh(
                new THREE.PlaneGeometry(40000, 40000),
                new THREE.MeshStandardMaterial({
                    map: tex, roughness: 0.98, metalness: 0.0, envMapIntensity: 0.45
                }));
            land.rotation.x = -Math.PI / 2;
            land.position.set(0, -0.15, SHORE - 20000);
            land.receiveShadow = true;
            this.scene.add(land);

            /* Wet sand: darker, slightly rougher, and thirteen centimetres
             * below the dry sand so the boundary is a real edge rather than a
             * fight. It laps a few metres over the water to hide that seam too. */
            const wet = new THREE.Mesh(
                new THREE.PlaneGeometry(40000, 46),
                new THREE.MeshStandardMaterial({ color: srgb(0x9a8f74), roughness: 0.34, metalness: 0.04, envMapIntensity: 0.5 }));
            wet.rotation.x = -Math.PI / 2;
            wet.position.set(0, -0.28, SHORE + 6);
            wet.receiveShadow = true;
            this.scene.add(wet);

            /* THE SURF. The single cue that says "Atlantic beach" rather than
             * "the sand stops here", and the reason the shoreline no longer
             * reads as a ruled line forty kilometres long. It is a transparent
             * band with depthWrite off, sitting 17 cm above the dry sand and
             * 30 cm above the wet — high enough that no depth precision
             * argument applies, low enough to be invisible as a step — and it
             * scrolls along the beach on simulation time like everything else. */
            const foam = foamMap();
            foam.repeat.set(260, 1);
            this.foamTex = foam;
            this.foamMat = new THREE.MeshBasicMaterial({
                map: foam, transparent: true, opacity: 0.85, depthWrite: false,
                side: THREE.DoubleSide, fog: true
            });
            const surf = new THREE.Mesh(new THREE.PlaneGeometry(40000, 34), this.foamMat);
            surf.rotation.x = -Math.PI / 2;
            surf.position.set(0, 0.02, SHORE + 9);
            surf.renderOrder = 2;
            this.scene.add(surf);

            /* The sea, seaward of the site — which is NEGATIVE y in simulation
             * coordinates, because that is where scenarios.js puts the divert
             * area. Scene z is minus simulation y, so seaward is +z here. The
             * first version had it at -z, i.e. inland, with every diverting
             * booster ditching in a field.
             *
             * Two scrolling normal maps at different speeds and headings is the
             * whole water shader. A reflective Water/Reflector renders the
             * scene a second time and is the only genuinely expensive option in
             * this file; at the distances this is seen from it would not be
             * visible anyway. */
            const nrm = noiseCanvas(128, (u, v) => {
                const a = hash2(Math.floor(u * 48), Math.floor(v * 48));
                const b = hash2(Math.floor(u * 12) + 5, Math.floor(v * 12) + 11);
                return [118 + a * 44, 118 + b * 44, 235];
            });
            nrm.repeat.set(420, 420);
            const nrm2 = nrm.clone();
            nrm2.needsUpdate = true;
            nrm2.repeat.set(170, 170);
            this.waterTex = [nrm, nrm2];
            /* With an environment map in the scene the sea finally has
             * something to reflect, so the metalness term earns its keep and
             * the water takes the sky's colour instead of being a flat blue
             * plane. This is also what carries the moon path at night. */
            this.seaMat = new THREE.MeshStandardMaterial({
                color: 0x2c5468, roughness: 0.18, metalness: 0.55,
                normalMap: nrm, normalScale: new THREE.Vector2(0.5, 0.5),
                envMapIntensity: 1.25
            });
            const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), this.seaMat);
            sea.rotation.x = -Math.PI / 2;
            sea.position.set(0, -0.55, SHORE + 20000);
            this.scene.add(sea);
            this.seaLevelY = -0.55;

            // a second, larger-scale swell drawn just above the first
            this.swellMat = new THREE.MeshStandardMaterial({
                color: 0x35627a, roughness: 0.26, metalness: 0.3,
                transparent: true, opacity: 0.45, depthWrite: false,
                normalMap: nrm2, normalScale: new THREE.Vector2(0.85, 0.85)
            });
            const swell = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), this.swellMat);
            swell.rotation.x = -Math.PI / 2;
            swell.position.set(0, -0.5, SHORE + 20000);
            swell.renderOrder = 1;
            this.scene.add(swell);

            /* THE BANANA RIVER. The Cape is a barrier island with the Indian
             * and Banana rivers behind it, and from the pad the inland horizon
             * is water as often as it is scrub. Drawn with a polygon offset
             * rather than a height offset: at two kilometres the depth buffer
             * resolves about twenty centimetres, which is the same order as any
             * height you could pick, so a bias applied in depth space is the
             * only version of this that cannot shimmer. */
            /* THE BANKS HAVE TO BE SOFT. A rectangle of water on a plane of
             * sand draws two dead-straight parallel edges twenty-six kilometres
             * long, which is a canal, not a river — and a perfectly straight
             * line in a natural landscape is the first thing the eye finds.
             * The alpha map feathers both banks and wobbles them, so what is
             * still a rectangle reads as a shoreline. */
            const lagoonAlpha = drawTex(512, 128, (g2, w2, h2) => {
                for (let y = 0; y < h2; y++) {
                    const v = y / (h2 - 1);
                    for (let x = 0; x < w2; x += 2) {
                        const wob = (tfbm(x / w2, 0.31, 6, 3) - 0.5) * 0.34;
                        const edge = Math.min(v - (0.13 + wob), (0.87 + wob) - v);
                        const a = Math.max(0, Math.min(1, edge / 0.09));
                        g2.fillStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
                        g2.fillRect(x, y, 2, 1);
                    }
                }
            }, false, true);
            lagoonAlpha.wrapT = THREE.ClampToEdgeWrapping;
            /* THREE REPEATS, NOT ELEVEN. This band is twenty-six kilometres
             * long and is always seen at a few degrees of grazing incidence, so
             * a texture repeating every 2.4 km minifies to well under a pixel
             * along its length and the feathered banks alias into a ladder of
             * rungs across the river. At three repeats the wobble is 8 km long
             * — which is the right scale for a river anyway. */
            lagoonAlpha.repeat.set(3, 1);
            lagoonAlpha.anisotropy = 16;
            /* NO NORMAL MAP ON THIS ONE, AND NOT MUCH GLOSS.
             *
             * It had the sea's ripple map at 170 repeats — one tile every
             * 150 m — on a surface that is only ever seen five kilometres away
             * and a couple of degrees above the horizontal. At that incidence
             * a tile is well under a pixel across, and a normal map that
             * minifies past a pixel does not average to flat: it aliases, and
             * on a roughness-0.2 metal every alias is a specular spike. The
             * river came out as a ladder of bright rungs. A distant river needs
             * no ripples; it needs to be the right colour and to sit still. */
            const lagoonMat = new THREE.MeshStandardMaterial({
                color: srgb(0x33566b), roughness: 0.42, metalness: 0.25,
                alphaMap: lagoonAlpha, transparent: true, depthWrite: false,
                envMapIntensity: 0.9,
                polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12
            });
            this.lagoonMat = lagoonMat;
            /* Far enough back to be scenery. At two kilometres they crossed the
             * whole frame on every approach and read as two blue motorways
             * under the vehicle; the river belongs on the inland horizon, not
             * in the landing site. */
            for (const [z, d] of [[-5400, 1700], [-8600, 2600]]) {
                const lg = new THREE.Mesh(new THREE.PlaneGeometry(26000, d), lagoonMat);
                lg.rotation.x = -Math.PI / 2;
                lg.position.set(0, 0.03, z);
                lg.renderOrder = 1;
                this.scene.add(lg);
            }

            /* Launch site apron. Concrete is not one grey — it is poured in
             * bays, stained by everything that has ever been spilled on it, and
             * scorched where the exhaust has been. */
            const apronTex = drawTex(512, 512, (g, w, h) => {
                for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
                    const n = fbm(x / 55, y / 55, 3), f = hash2(x, y);
                    const v = 128 + n * 34 + f * 12;
                    g.fillStyle = "rgb(" + (v | 0) + "," + ((v * 0.99) | 0) + "," + ((v * 0.94) | 0) + ")";
                    g.fillRect(x, y, 2, 2);
                }
                g.strokeStyle = "rgba(78,76,72,0.55)"; g.lineWidth = 2;
                for (let k = 1; k < 4; k++) {
                    g.beginPath(); g.moveTo(k * w / 4, 0); g.lineTo(k * w / 4, h); g.stroke();
                    g.beginPath(); g.moveTo(0, k * h / 4); g.lineTo(w, k * h / 4); g.stroke();
                }
            });
            apronTex.repeat.set(9, 9);
            const apron = new THREE.Mesh(
                new THREE.CircleGeometry(160, 64),
                new THREE.MeshStandardMaterial({ map: apronTex, color: srgb(0xa8a49c), roughness: 0.94, metalness: 0.03, envMapIntensity: 0.5 })
            );
            apron.rotation.x = -Math.PI / 2;
            apron.position.y = 0.05;
            apron.receiveShadow = true;
            this.scene.add(apron);

            // the concrete landing pad — same pour, scorched in the middle
            const padTex = apronTex.clone();
            padTex.needsUpdate = true;
            padTex.repeat.set(2, 2);
            this.padMesh = new THREE.Mesh(
                new THREE.CircleGeometry(V.PAD.radius, 64),
                new THREE.MeshStandardMaterial({ map: padTex, color: srgb(0xb2ada3), roughness: 0.9, metalness: 0.03, envMapIntensity: 0.5 })
            );
            this.padMesh.rotation.x = -Math.PI / 2;
            this.padMesh.receiveShadow = true;
            this.scene.add(this.padMesh);
            /* NO ROTATION ON THIS ONE. It is a child of padMesh, which is
             * already lying flat, so rotating it again stands it on its edge —
             * which is exactly what it did: a yellow half-hoop sticking up out
             * of the ground next to the tower. In the parent's local frame,
             * "up" is +z. */
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(V.PAD.radius - 2.5, V.PAD.radius, 48),
                new THREE.MeshBasicMaterial({ color: 0xffcc44, side: THREE.DoubleSide })
            );
            ring.position.z = 0.12;
            this.padMesh.add(ring);

            // the divert / safe area marker
            this.safeMesh = new THREE.Mesh(
                new THREE.RingGeometry(1, 1.06, 64),
                new THREE.MeshBasicMaterial({ color: 0x54d6a0, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
            );
            this.safeMesh.rotation.x = -Math.PI / 2;
            this.scene.add(this.safeMesh);
        }

        /* Everything in here is scenery. It reads nothing, writes nothing, and
         * carries no collider — a decorative prop with a collider is a physics
         * change wearing a costume. It exists because a 72 m booster over an
         * empty plane has no scale cues at all, and "how high is it" is the one
         * thing a viewer needs to read off this scene.
         *
         * Seaward is +z (see buildGround). Inland is −z. */
        buildScenery() {
            const SHORE = -V.SITE.shoreY;   // one owner: vehicle.js
            const g = new THREE.Group();
            const white = new THREE.MeshStandardMaterial({ color: srgb(0xdde2e7), roughness: 0.42, metalness: 0.25, envMapIntensity: 0.8 });
            const grey = new THREE.MeshStandardMaterial({ color: srgb(0x9aa0a6), roughness: 0.8, metalness: 0.12, envMapIntensity: 0.6 });
            const conc = new THREE.MeshStandardMaterial({ color: srgb(0x8d8b86), roughness: 0.95, envMapIntensity: 0.5 });
            const dune = new THREE.MeshStandardMaterial({ color: srgb(0xc4b997), roughness: 0.99, envMapIntensity: 0.45 });
            const foliage = new THREE.MeshStandardMaterial({ color: srgb(0x4f6b39), roughness: 1.0, envMapIntensity: 0.5 });

            /* Dune ridge, just inshore of the wet sand. Three overlapping
             * flattened spheres per segment reads as a wind-blown ridge and is
             * cheaper than any heightfield. */
            for (let i = -22; i <= 22; i++) {
                const x = i * 170 + (hash2(i, 3) - 0.5) * 90;
                const h = 3 + hash2(i, 9) * 2.5;
                const d = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), dune);
                d.scale.set(120 + hash2(i, 1) * 70, h, 26 + hash2(i, 5) * 14);
                d.position.set(x, -0.4, SHORE - 34 - hash2(i, 7) * 16);
                g.add(d);
            }
            /* Sea oats on the dune crest — the plant that actually holds a
             * Florida dune together, and at this distance three hundred
             * instanced blades of it. */
            const oat = new THREE.InstancedMesh(
                new THREE.ConeGeometry(0.55, 2.6, 4),
                new THREE.MeshStandardMaterial({ color: srgb(0x9a9a63), roughness: 1.0 }), 300);
            {
                const m = new THREE.Matrix4(), q = new THREE.Quaternion();
                const p = new THREE.Vector3(), s = new THREE.Vector3();
                const ax = new THREE.Vector3(0, 1, 0);
                for (let i = 0; i < 300; i++) {
                    const x = (hash2(i, 51) - 0.5) * 7200;
                    const z = SHORE - 30 - hash2(i, 53) * 26;
                    const sc = 0.7 + hash2(i, 57) * 0.9;
                    p.set(x, 1.6 + hash2(i, 59) * 1.4, z);
                    s.set(sc, sc * (1 + hash2(i, 61)), sc);
                    q.setFromAxisAngle(ax, hash2(i, 63) * 6.28);
                    m.compose(p, q, s);
                    oat.setMatrixAt(i, m);
                }
                oat.instanceMatrix.needsUpdate = true;
                g.add(oat);
            }

            /* Tank farm: the cryo horseshoe west of the pad. Eight verticals
             * and three horizontals, at the real ~30 m — which is the point,
             * because it puts a known height next to a 146 m tower. */
            for (let i = 0; i < 8; i++) {
                const t = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 30, 14), white);
                t.position.set(-215 - (i % 4) * 26, 15, -60 - Math.floor(i / 4) * 34);
                g.add(t);
                const cap = new THREE.Mesh(new THREE.SphereGeometry(5, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), white);
                cap.position.set(t.position.x, 30, t.position.z);
                g.add(cap);
            }
            for (let i = 0; i < 3; i++) {
                const t = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 26, 12), grey);
                t.rotation.z = Math.PI / 2;
                t.position.set(-190, 4.4, -150 - i * 16);
                g.add(t);
            }

            /* Orbital launch mount, seaward of the tower and clear of the
             * catch line — a ring on six legs. */
            const mnt = new THREE.Group();
            const ring = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 4.5, 18, 1, true), grey);
            ring.position.y = 18;
            mnt.add(ring);
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 18, 1.6), grey);
                leg.position.set(Math.cos(a) * 7, 9, Math.sin(a) * 7);
                mnt.add(leg);
            }
            const plinth = new THREE.Mesh(new THREE.CylinderGeometry(13, 15, 1.4, 20), conc);
            plinth.position.y = 0.7;
            mnt.add(plinth);
            mnt.position.set(-38, 0, 34);
            g.add(mnt);

            /* THE SKYLINE IS THE ONE PLACE THIS SITE IS RECOGNISABLE.
             *
             * Nothing in the foreground says Florida rather than Boca Chica —
             * both are flat sand next to water. What says Cape Canaveral is the
             * silhouette five kilometres inland: a single 160 m assembly
             * building that dwarfs everything around it, a couple of low
             * hangars, and a water tower. Drawn as boxes, in the haze, because
             * that is all any of it ever is from a pad. */
            const vabMat = new THREE.MeshStandardMaterial({ color: srgb(0xa8adb2), roughness: 0.85, metalness: 0.08 });
            const vab = new THREE.Group();
            const hi = new THREE.Mesh(new THREE.BoxGeometry(218, 160, 158), vabMat);
            hi.position.y = 80;
            vab.add(hi);
            const lo = new THREE.Mesh(new THREE.BoxGeometry(78, 64, 158),
                new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughness: 0.88 }));
            lo.position.set(148, 32, 0);
            vab.add(lo);
            // the door bands, which are the only reason it reads as a building
            for (const [x, w2] of [[-54, 34], [54, 34]]) {
                const dr = new THREE.Mesh(new THREE.BoxGeometry(w2, 130, 1.5),
                    new THREE.MeshStandardMaterial({ color: 0x6d747b, roughness: 0.9 }));
                dr.position.set(x, 66, 79.6);
                vab.add(dr);
            }
            vab.position.set(-3900, 0, -4300);
            vab.rotation.y = 0.3;
            g.add(vab);

            const bld = [[-2600, 30, -2900, 190, 110], [-3050, 22, -3350, 150, 90],
                         [1900, 26, -3100, 170, 95], [2400, 18, -2600, 120, 80]];
            for (const [x, h, z, w, d] of bld) {
                const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), grey);
                b.position.set(x, h / 2, z);
                g.add(b);
            }
            // water tower — a sphere on legs, and a very Florida thing to see
            {
                const wt = new THREE.Group();
                const ball = new THREE.Mesh(new THREE.SphereGeometry(11, 16, 12), white);
                ball.position.y = 44;
                wt.add(ball);
                for (let i = 0; i < 4; i++) {
                    const a = (i / 4) * Math.PI * 2;
                    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 40, 6), grey);
                    leg.position.set(Math.cos(a) * 7, 20, Math.sin(a) * 7);
                    wt.add(leg);
                }
                wt.position.set(-1750, 0, -1980);
                g.add(wt);
            }

            /* NEIGHBOURING PADS. Three lightning masts in a triangle with a
             * catenary strung between them is the single most identifiable
             * piece of hardware on the eastern range, and at 180 m they are the
             * only thing on the horizon that is taller than the tower being
             * landed on — which is exactly the scale comparison the scene
             * wants. */
            for (const [px, pz, rot] of [[1450, -520, -0.4], [-1250, 620, 0.7]]) {
                const pad = new THREE.Group();
                const tips = [];
                for (let i = 0; i < 3; i++) {
                    const a = (i / 3) * Math.PI * 2 + rot;
                    const x = Math.cos(a) * 120, z = Math.sin(a) * 120;
                    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.6, 178, 6), grey);
                    mast.position.set(x, 89, z);
                    pad.add(mast);
                    tips.push(new THREE.Vector3(x, 178, z));
                }
                // the catenary between the mast tips: sags, or it reads as a fence
                const wire = new THREE.LineBasicMaterial({ color: 0x4a5058, transparent: true, opacity: 0.8 });
                for (let i = 0; i < 3; i++) {
                    const a = tips[i], b = tips[(i + 1) % 3];
                    const pts = [];
                    for (let k = 0; k <= 12; k++) {
                        const t2 = k / 12;
                        pts.push(new THREE.Vector3(
                            a.x + (b.x - a.x) * t2,
                            a.y + (b.y - a.y) * t2 - 26 * Math.sin(Math.PI * t2),
                            a.z + (b.z - a.z) * t2));
                    }
                    pad.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
                }
                const deck = new THREE.Mesh(new THREE.CylinderGeometry(96, 100, 5, 24), conc);
                deck.position.y = 2.5;
                pad.add(deck);
                const gantry = new THREE.Mesh(new THREE.BoxGeometry(16, 74, 16), grey);
                gantry.position.set(0, 37, -34);
                pad.add(gantry);
                pad.position.set(px, 0, pz);
                g.add(pad);
                this.padLightTips = (this.padLightTips || []).concat(tips.map(t =>
                    new THREE.Vector3(t.x + px, t.y, t.z + pz)));
            }

            // access road, running inland and vanishing into the fog
            const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 5200), conc.clone());
            road.material.color.setHex(0x5f5c58);
            road.rotation.x = -Math.PI / 2;
            road.position.set(-120, -0.06, -2700);
            g.add(road);

            /* Scrubland: nine hundred palmetto clumps in ONE draw call. An
             * InstancedMesh matters here — nine hundred separate meshes is nine
             * hundred draw calls a frame for something the viewer reads as
             * texture. Saw palmetto is a low fan, not a tuft of grass, so this
             * is a flattened sphere rather than the cone it used to be. */
            const tuft = new THREE.InstancedMesh(
                new THREE.SphereGeometry(1.6, 9, 6), foliage, 900);
            const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion();
            const pos = new THREE.Vector3(), scl = new THREE.Vector3();
            const upA = new THREE.Vector3(0, 1, 0);
            let n = 0;
            for (let i = 0; i < 900; i++) {
                const a = hash2(i, 17) * Math.PI * 2;
                const r = 90 + Math.sqrt(hash2(i, 23)) * 2200;
                const x = Math.cos(a) * r, z = Math.sin(a) * r;
                if (z > SHORE - 40) continue;                    // never on the beach or in the sea
                if (Math.hypot(x, z) < 90) continue;             // never on the apron
                if (z < -4600 && z > -6300) continue;            // never in the lagoon
                const s = 0.7 + hash2(i, 31) * 1.5;
                pos.set(x, 0.5 * s, z);
                scl.set(s * 1.5, s * (0.35 + hash2(i, 37) * 0.35), s * 1.5);
                qq.setFromAxisAngle(upA, hash2(i, 41) * 6.28);
                mtx.compose(pos, qq, scl);
                tuft.setMatrixAt(n++, mtx);
            }
            tuft.count = n;
            tuft.instanceMatrix.needsUpdate = true;
            g.add(tuft);

            /* CABBAGE PALMS, in two instanced passes — one for the trunks, one
             * for the crowns. Building a real palm and cloning it is ninety
             * meshes and ninety draw calls for a prop nobody looks at directly;
             * a bare trunk with a flattened dark-green crown on top is what a
             * palm is at a hundred metres, which is the nearest any of these
             * ever get. */
            {
                const NP = 130;
                const trunk = new THREE.InstancedMesh(
                    new THREE.CylinderGeometry(0.30, 0.55, 1, 6),
                    new THREE.MeshStandardMaterial({ color: srgb(0x6b6152), roughness: 1.0 }), NP);
                const crown = new THREE.InstancedMesh(
                    new THREE.SphereGeometry(1, 10, 6),
                    new THREE.MeshStandardMaterial({ color: srgb(0x38562c), roughness: 1.0 }), NP);
                let k = 0;
                for (let i = 0; i < NP; i++) {
                    const a = hash2(i, 83) * Math.PI * 2;
                    const r = 240 + Math.sqrt(hash2(i, 89)) * 2400;
                    const x = Math.cos(a) * r, z = Math.sin(a) * r;
                    if (z > SHORE - 90) continue;
                    if (z < -4600 && z > -6300) continue;
                    const hgt = 8 + hash2(i, 97) * 9;
                    const lean = (hash2(i, 101) - 0.5) * 0.22;
                    qq.setFromAxisAngle(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), lean);
                    pos.set(x, hgt * 0.5, z);
                    scl.set(1, hgt, 1);
                    mtx.compose(pos, qq, scl);
                    trunk.setMatrixAt(k, mtx);
                    const cs = 3.0 + hash2(i, 103) * 1.8;
                    pos.set(x + Math.sin(lean) * Math.cos(a) * hgt, hgt + cs * 0.35, z + Math.sin(lean) * Math.sin(a) * hgt);
                    scl.set(cs, cs * 0.52, cs);
                    qq.setFromAxisAngle(upA, hash2(i, 107) * 6.28);
                    mtx.compose(pos, qq, scl);
                    crown.setMatrixAt(k, mtx);
                    k++;
                }
                trunk.count = crown.count = k;
                trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true;
                g.add(trunk); g.add(crown);
            }

            // buoys, so the water has a scale cue too
            for (let i = 0; i < 3; i++) {
                const b = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 3.2, 8),
                    new THREE.MeshStandardMaterial({ color: 0xd8562f, roughness: 0.7 }));
                b.position.set(-260 + i * 300, -0.2, SHORE + 260 + i * 140);
                g.add(b);
            }

            this.scene.add(g);
            this.buildSiteLights();
        }

        /* -------------------------------------------------- night lighting
         * All of it in nightGroup, all of it emissive rather than lit: a real
         * floodlit launch site needs a dozen spot lights and this scene has a
         * budget of about two. Additive quads reading as glare do the same job
         * at no per-object cost, and the only actual lights added are the two
         * xenon washes on the tower itself, which is the one place a viewer
         * looks. */
        buildSiteLights() {
            const NG = this.nightGroup;
            const glow = glowMap();
            /* `size` is metres for an area glow — a flood washing a wall, the
             * spill off a building — and a fraction of the viewport for a point
             * source, which is what an obstruction light is. Getting that
             * backwards is what turned the tower beacon into a beach ball (see
             * buildBeacon), and the tower's own red lights are the same
             * hardware seen from the same forty metres. */
            const lamp = (x, y, z, color, size, op, point) => {
                const s = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: glow, color, transparent: true, opacity: op == null ? 0.85 : op,
                    blending: THREE.AdditiveBlending, depthWrite: false,
                    sizeAttenuation: !point, fog: !point
                }));
                s.position.set(x, y, z);
                s.scale.set(size, size, 1);
                NG.add(s);
                return s;
            };

            // apron perimeter: sodium-yellow, on masts
            for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                const x = Math.cos(a) * 152, z = Math.sin(a) * 152;
                const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 14, 5),
                    new THREE.MeshStandardMaterial({ color: srgb(0x50565c), roughness: 0.9 }));
                mast.position.set(x, 7, z);
                NG.add(mast);
                lamp(x, 14.4, z, 0xffcf86, 7, 0.7);
            }
            // the two arms, washed from below
            for (const s of [1, -1]) lamp(s * 16, 116, -34, 0xdce8ff, 26, 0.42);
            // red obstruction lights up the tower, at the real 45 m spacing
            for (const y of [46, 92, 138]) for (const s of [1, -1])
                lamp(s * 6.4, y, 0, 0xff3b28, 0.012, 0.9, true);
            // the neighbouring pads' mast tips
            for (const t of (this.padLightTips || [])) lamp(t.x, t.y + 3, t.z, 0xff3b28, 0.010, 0.85, true);
            // the assembly building, and the road out to it
            for (let i = 0; i < 22; i++)
                lamp(-3900 + (i % 11 - 5) * 40, 8 + (i > 10 ? 154 : 0), -4300 + 82, 0xfff0c4, 26, 0.5);
            for (let i = 0; i < 26; i++)
                lamp(-120 + (i & 1 ? 7 : -7), 9, -260 - i * 200, 0xffd79a, 7, 0.55);

            /* Two xenon washes. These ARE lights, not sprites, because the
             * vehicle has to be lit by something on the way in or the terminal
             * phase happens in silhouette. Long range, low intensity, aimed up
             * the tower face. */
            for (const s of [1, -1]) {
                const l = new THREE.PointLight(0xbfd4ff, 1.5, 420, 1.6);
                l.position.set(s * 46, 12, -52);
                NG.add(l);
            }
            const rail = new THREE.PointLight(0xffd9a0, 2.2, 220, 1.7);
            rail.position.set(0, 124, -26);
            NG.add(rail);

            /* Moon glitter: one stretched additive quad on the water, on the
             * moon's bearing. It is a cheat and it is the difference between a
             * sea at night and a black hole where the sea was. */
            const glit = new THREE.Mesh(
                new THREE.PlaneGeometry(340, 9000),
                new THREE.MeshBasicMaterial({
                    map: glow, color: 0xaec4ee, transparent: true, opacity: 0.20,
                    blending: THREE.AdditiveBlending, depthWrite: false, fog: true
                }));
            glit.rotation.x = -Math.PI / 2;
            glit.position.set(2200, -0.35, 4200);
            glit.rotation.z = -0.46;
            glit.renderOrder = 3;
            NG.add(glit);
        }

        /* Cumulus, five kilometres out and two up. Sprites, because a cloud
         * that has to be right from every angle is a volume shader and a cloud
         * that only has to be right from inside the same 40 km bowl is a
         * billboard. They sit inside the fog, which is what stops them looking
         * pasted on. */
        buildClouds() {
            const puff = puffMap();
            const g = new THREE.Group();
            this.cloudMats = [];
            for (let i = 0; i < 30; i++) {
                const a = hash2(i, 131) * Math.PI * 2;
                const r = 3000 + hash2(i, 137) * 4200;
                /* A fair-weather cumulus base over Florida sits around 900 m
                 * and the tops go to two or three kilometres. Putting them
                 * there rather than at some convenient distance is what makes
                 * the 12 km entry scenarios read as high — the vehicle comes
                 * down THROUGH something. */
                const y = 1500 + hash2(i, 139) * 1900;
                const s = 620 + hash2(i, 149) * 1000;
                const m = new THREE.SpriteMaterial({
                    map: puff, color: 0xffffff, transparent: true,
                    opacity: 0.62 + hash2(i, 151) * 0.34, depthWrite: false, fog: true
                });
                const sp = new THREE.Sprite(m);
                sp.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
                sp.scale.set(s, s * (0.42 + hash2(i, 157) * 0.24), 1);
                sp.renderOrder = 4;
                this.cloudMats.push(m);
                g.add(sp);
            }
            this.clouds = g;
            this.scene.add(g);
        }

        /* Mechazilla: a lattice tower with two arms. Built from boxes because a
         * lattice made of boxes reads as a lattice and costs nothing. */
        buildTower() {
            /* Galvanised structural steel, which is not the same material as
             * the vehicle's rolled stainless: greyer, rougher, and with the
             * spangle of a hot-dip finish rather than roll streaks. */
            const galv = tex("galv", () => drawTex(256, 256, (g2, w, h) => {
                for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
                    const n = fbm(x / 20, y / 20, 3), f = hash2(x, y);
                    const v = 150 + n * 62 + f * 22;
                    g2.fillStyle = "rgb(" + (v | 0) + "," + ((v * 1.01) | 0) + "," + ((v * 1.04) | 0) + ")";
                    g2.fillRect(x, y, 2, 2);
                }
            }));
            galv.repeat.set(2, 8);
            const steel = new THREE.MeshStandardMaterial({
                map: galv, color: srgb(0xc6ced5), roughness: 0.62, metalness: 0.45, envMapIntensity: 0.9
            });
            const dark = new THREE.MeshStandardMaterial({ color: srgb(0x7b838a), roughness: 0.72, metalness: 0.35, envMapIntensity: 0.8 });
            const g = new THREE.Group();
            const hw = T.halfWidth;
            for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                const col = new THREE.Mesh(new THREE.BoxGeometry(1.1, T.height, 1.1), steel);
                col.position.set(sx * hw, T.height / 2, sy * hw);
                g.add(col);
            }
            for (let z = 8; z < T.height; z += 11) {
                for (const [ax, ay] of [[1, 0], [0, 1]]) {
                    for (const s of [1, -1]) {
                        const b = new THREE.Mesh(
                            new THREE.BoxGeometry(ax ? hw * 2 : 0.7, 0.7, ay ? hw * 2 : 0.7), dark);
                        b.position.set(ax ? 0 : s * hw, z, ay ? 0 : s * hw);
                        g.add(b);
                    }
                }
            }
            /* Diagonal bracing. A tower of horizontals and verticals is a
             * ladder; the diagonals are what makes the silhouette read as a
             * launch tower, and they are the detail the eye uses to judge how
             * far away it is.
             *
             * ONE DRAW CALL. Two braces per bay per face over twelve bays is
             * ninety-six boxes, and every one of them casts, so as separate
             * meshes it is nearly two hundred draw calls a frame for a detail
             * that is a few pixels wide. They are all the same box in the same
             * material and differ only by a transform, which is the exact case
             * InstancedMesh exists for — the same argument as the scrubland. */
            {
                const bay = 11, diag = Math.hypot(hw * 2, bay);
                const ang = Math.atan2(hw * 2, bay);
                const bays = [];
                for (let z = 8; z + bay < T.height; z += bay) bays.push(z);
                const br = new THREE.InstancedMesh(
                    new THREE.BoxGeometry(0.42, diag, 0.42), dark, bays.length * 8);
                const m = new THREE.Matrix4(), q = new THREE.Quaternion();
                const p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
                const zAx = new THREE.Vector3(0, 0, 1), xAx = new THREE.Vector3(1, 0, 0);
                let n = 0;
                for (const z of bays) {
                    for (const [ax, ay] of [[1, 0], [0, 1]]) {
                        for (const s of [1, -1]) {
                            for (const d of [1, -1]) {
                                p.set(ax ? 0 : s * hw, z + bay / 2, ay ? 0 : s * hw);
                                q.setFromAxisAngle(ax ? zAx : xAx, d * ang);
                                m.compose(p, q, one);
                                br.setMatrixAt(n++, m);
                            }
                        }
                    }
                }
                br.count = n;
                br.instanceMatrix.needsUpdate = true;
                g.add(br);
            }
            /* The service elevator shaft, on the inland face. It never moves and
             * it carries no collider — it is here because a bare lattice has no
             * indication of which face is the working face. */
            {
                const shaft = new THREE.Mesh(new THREE.BoxGeometry(3.4, T.height - 6, 2.6), steel);
                shaft.position.set(0, (T.height - 6) / 2, hw + 1.3);
                g.add(shaft);
                for (let z = 10; z < T.height - 8; z += 9) {
                    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.35, 0.35), dark);
                    rail.position.set(0, z, hw + 2.7);
                    g.add(rail);
                }
            }
            // the arms — two beams reaching out in +y at the rail height
            /* The chopsticks. They reach out along +y in simulation
             * coordinates, which is -z in the scene — the same minus sign as
             * everywhere else, and getting it wrong points them inland while
             * the vehicle approaches from the sea. Drawn at full size: 32 m of
             * reach, 4 m deep, with the load rails on top, because the whole
             * point of the picture is that the catch box is small compared to
             * the hardware around it. */
            this.arms = new THREE.Group();
            const railMat = new THREE.MeshStandardMaterial({ color: srgb(0x3d444a), roughness: 0.5, metalness: 0.45, envMapIntensity: 0.8 });
            for (const sgn of [1, -1]) {
                const arm = new THREE.Group();
                const beam = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.0, T.armReach), steel);
                beam.position.set(0, 0, -T.armSide * (T.armInner + T.armReach / 2));
                arm.add(beam);
                const rail = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.8, T.armReach * 0.85), railMat);
                rail.position.set(0, 2.3, -T.armSide * (T.armInner + T.armReach * 0.45));
                arm.add(rail);
                for (let k = 0; k < 5; k++) {
                    const rib = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.2, 0.5), railMat);
                    rib.position.set(0, -1.4, -T.armSide * (T.armInner + 3 + k * 6.5));
                    arm.add(rib);
                }
                /* Hazard chevrons on the top of the rail — the surface the pins
                 * come to rest on. Purely a paint job, and the only strong
                 * colour on the tower: it puts a visual marker exactly where the
                 * capture box is, which is otherwise a 1.8 m target on a 32 m
                 * beam. */
                const chev = new THREE.MeshStandardMaterial({ color: srgb(0xf0b429), roughness: 0.75, metalness: 0.1 });
                for (let k = 0; k < 9; k++) {
                    const c2 = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.14, 1.1), chev);
                    c2.position.set(0, 2.72, -T.armSide * (T.armInner + 2 + k * 2.9));
                    arm.add(c2);
                }
                // the actuator that closes the arm, and its trunnion
                const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 11, 10), railMat);
                cyl.rotation.x = Math.PI / 2;
                cyl.position.set(-sgn * 1.9, -1.0, -T.armSide * (T.armInner + 7));
                arm.add(cyl);
                const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 8, 8),
                    new THREE.MeshStandardMaterial({ color: 0xd7dde2, roughness: 0.2, metalness: 0.85 }));
                rod.rotation.x = Math.PI / 2;
                rod.position.set(-sgn * 1.9, -1.0, -T.armSide * (T.armInner + 16));
                arm.add(rod);
                arm.position.x = sgn * T.gateHalfGap;
                this.arms.add(arm);
            }
            // the carriage the arms hang from, riding the tower face
            const carriage = new THREE.Mesh(new THREE.BoxGeometry(T.halfWidth * 2 + 3, 8, 4), steel);
            carriage.position.set(0, 0, -(T.halfWidth + 1));
            this.arms.add(carriage);
            this.arms.position.y = T.armZ;
            g.add(this.arms);

            /* The launch mount used to be a plain cylinder here at z = -34,
             * which is directly beneath the arms — i.e. underneath the point
             * the vehicle is caught at. It now lives in buildScenery(), off to
             * one side, as a ring on legs. */

            // three.js is Y-up; the simulation is Z-up. The whole scene is built
            // in the renderer's frame and simulation vectors are mapped on the
            // way in — (x, y, z)_sim → (x, z, −y)_three.
            this.buildBeacon(g);
            g.traverse(o => { if (o.isMesh) o.castShadow = true; });
            this.scene.add(g);
            this.tower = g;

            // a marker ring at the gate, so the target is visible
            /* The capture box, drawn at its true size: 1.8 m across the arms by
             * 5 m along them, 120 m up. It is meant to look small. */
            const c = V.TOWER.capture;
            const gate = new THREE.Mesh(
                new THREE.PlaneGeometry(c.across * 2, c.along * 2),
                new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
            );
            gate.rotation.x = -Math.PI / 2;
            gate.position.set(T.gateX, T.armZ + 0.5, -T.gateY);
            this.scene.add(gate);
            this.gateRing = gate;
        }

        /* An aircraft-warning light on the tower top. Two lines, and it is the
         * only thing in the scene that says the site is switched on. */
        buildBeacon(g) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8),
                new THREE.MeshBasicMaterial({ color: 0xff3322 }));
            b.position.set(0, T.height + 2.5, 0);
            g.add(b);
            this.beacon = b;
            /* The halo, and it does NOT attenuate with distance.
             *
             * A 1.5 m sphere at 146 m is three pixels from anywhere useful, so
             * the blink needs a glare sprite to be readable at all — but sized
             * in metres it is 22 m across, and the tower camera sits forty
             * metres from it, so the beacon rendered as a hand-sized orange
             * ball with a white corona in the middle of every catch. What a
             * warning light actually does is subtend the same small angle from
             * every distance it is meant to be seen from. sizeAttenuation off
             * makes the scale a fraction of the viewport instead of a length,
             * which is the honest model of a point source. */
            const halo = new THREE.Sprite(new THREE.SpriteMaterial({
                map: glowMap(), color: 0xff5544, transparent: true, opacity: 0.0,
                blending: THREE.AdditiveBlending, depthWrite: false,
                sizeAttenuation: false, fog: false
            }));
            halo.position.copy(b.position);
            halo.scale.set(0.030, 0.030, 1);
            g.add(halo);
            this.beaconHalo = halo;
        }

        buildTrail() {
            const N = 900;
            const geo = new THREE.BufferGeometry();
            const pos = new Float32Array(N * 3);
            geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
            geo.setDrawRange(0, 0);
            const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff9a4d, transparent: true, opacity: 0.75 }));
            line.frustumCulled = false;
            this.scene.add(line);
            return { line, pos, n: 0, N };
        }

        clearTrail() { this.trail.n = 0; this.trail.line.geometry.setDrawRange(0, 0); }

        pushTrail(x, y, z) {
            const t = this.trail;
            if (t.n >= t.N) {
                t.pos.copyWithin(0, 3);
                t.n = t.N - 1;
            }
            t.pos[t.n * 3] = x; t.pos[t.n * 3 + 1] = z; t.pos[t.n * 3 + 2] = -y;
            t.n++;
            t.line.geometry.attributes.position.needsUpdate = true;
            t.line.geometry.setDrawRange(0, t.n);
        }

        /* ------------------------------------------------- the sensor rig ---
         * WHAT THE NETWORK ACTUALLY SEES, drawn in the scene.
         *
         * There are no rangefinders on this vehicle and nothing here is a ray
         * cast at the world. The two hundred inputs are derived state: which
         * way the vehicle is pointing, how fast the air is going past it and
         * from what angle, where the tower is relative to the catch pins, where
         * the ground target is, how much propellant is left, and where every
         * actuator has actually got to. So the overlay draws vectors and
         * reference frames, not beams — because drawing beams would be a lie
         * about how the thing works.
         *
         * Everything body-fixed lives under `rig.body`, whose transform is
         * copied from the vehicle each frame. That means the strip stations and
         * the axis triad are written once, in body coordinates, and never have
         * to be rotated by hand.
         */
        buildSensorRig(ty) {
            /* REBUILT ONLY WHEN THE VEHICLE ACTUALLY CHANGES. buildVehicle runs
             * on every new seed — every few seconds once episodes are
             * auto-advancing — and the rig owns six canvas textures, twenty
             * geometries and four arrow helpers. Rebuilding all of that per
             * scenario and dropping the old set on the floor is a GPU leak that
             * grows for as long as the tab is open. Only the strip stations
             * depend on the vehicle at all, so most of the time there is
             * nothing to do. */
            if (this.rig && this.rig.ty === ty) return this.rig;
            if (this.rig) {
                this.scene.remove(this.rig.root);
                disposeTree(this.rig.root);
            }
            const root = new THREE.Group();
            root.visible = false;
            const body = new THREE.Group();
            root.add(body);

            /* Drawn THROUGH the hull on purpose: a sensor overlay you cannot
             * see because the vehicle is in the way explains nothing. */
            const lineMat = (color, opacity, width) => {
                const m = new THREE.LineBasicMaterial({
                    color, transparent: true, opacity: opacity, depthTest: false, depthWrite: false
                });
                m.linewidth = width || 1;
                return m;
            };
            const seg = (mat, n) => {
                const geo = new THREE.BufferGeometry();
                geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
                const l = new THREE.Line(geo, mat);
                l.frustumCulled = false;
                l.renderOrder = 999;
                return l;
            };
            const arrow = (color, parent) => {
                const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 10, color, 4, 2.2);
                a.line.material.depthTest = false; a.line.material.transparent = true;
                a.cone.material.depthTest = false; a.cone.material.transparent = true;
                a.line.renderOrder = 999; a.cone.renderOrder = 999;
                parent.add(a);
                return a;
            };

            /* A text label that always faces the camera and never shrinks. */
            const label = (text, color) => {
                const c = document.createElement("canvas");
                c.width = 256; c.height = 64;
                const g = c.getContext("2d");
                g.font = "bold 30px ui-monospace, monospace";
                g.textAlign = "center"; g.textBaseline = "middle";
                g.lineWidth = 6; g.strokeStyle = "rgba(6,10,16,0.92)";
                g.strokeText(text, 128, 34); g.fillStyle = color;
                g.fillText(text, 128, 34);
                const t = new THREE.CanvasTexture(c);
                const s = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: t, transparent: true, depthTest: false, sizeAttenuation: false
                }));
                s.scale.set(0.145, 0.036, 1);
                s.renderOrder = 1000;
                root.add(s);
                return s;
            };

            const L = ty.length, R = ty.radius;

            // --- body-fixed: the frame every attitude input is expressed in ---
            const nose = arrow(0x63d9ff, body);      // body +Z: what "tilt" measures
            const belly = arrow(0xffa657, body);     // body +X: the roll reference
            const side = arrow(0xb98bff, body);      // body +Y

            /* The twenty strip stations. This is not decoration: the aero model
             * cuts the body into twenty slices and gives each one the flow that
             * is actually passing it, including the part that comes from the
             * vehicle's own rotation. Seeing where they sit makes the pitch
             * damping obvious. */
            const strips = [];
            for (let i = 0; i < 20; i++) {
                const g = new THREE.BufferGeometry();
                const N = 25, p = new Float32Array(N * 3);
                for (let k = 0; k < N; k++) {
                    const a = (k / (N - 1)) * Math.PI * 2;
                    p[k * 3] = Math.cos(a) * R * 1.02;
                    p[k * 3 + 1] = (i + 0.5) / 20 * L;
                    p[k * 3 + 2] = Math.sin(a) * R * 1.02;
                }
                g.setAttribute("position", new THREE.BufferAttribute(p, 3));
                const l = new THREE.Line(g, lineMat(0x8fd8ff, 0.3));
                l.frustumCulled = false; l.renderOrder = 998;
                body.add(l);
                strips.push(l);
            }

            // the airflow the vehicle is flying through, arriving at the nose
            const air = arrow(0xff6b6b, body);
            const alphaArc = seg(lineMat(0xffd166, 0.95), 18);   // angle of attack
            body.add(alphaArc);
            const rateRing = seg(lineMat(0x8fffcf, 0.9), 33);    // body rate
            body.add(rateRing);

            // --- world-fixed: where things are, which is the other half ------
            const vel = arrow(0xffe66d, root);
            const gate = seg(lineMat(0x6ee7a0, 0.95), 2);
            const ground = seg(lineMat(0x9fb6d0, 0.6), 2);
            const vert = seg(lineMat(0xffffff, 0.28), 2);
            root.add(gate); root.add(ground); root.add(vert);

            this.scene.add(root);
            this.rig = {
                root, body, nose, belly, side, air, vel, strips,
                alphaArc, rateRing, gate, ground, vert, ty,
                labels: {
                    nose: label("nose axis · tilt", "#9fe8ff"),
                    air: label("airflow · α", "#ff9d92"),
                    vel: label("velocity", "#ffe66d"),
                    gate: label("to the rails", "#8ff0b8"),
                    ground: label("to the pad", "#c3d4e6"),
                    agl: label("", "#dfe8f2")
                }
            };
            return this.rig;
        }

        setSensorsVisible(on) {
            this.sensorsOn = !!on;
            if (this.rig) this.rig.root.visible = !!on;
        }

        updateSensorRig(world) {
            const rig = this.rig, veh = this.vehicle;
            if (!rig || !veh || !rig.root.visible || !world) return;
            const ty = world.type, tel = world.tel, L = ty.length;
            const V3 = THREE.Vector3;

            rig.body.position.copy(veh.group.position);
            rig.body.quaternion.copy(veh.group.quaternion);

            /* Vectors are drawn at a length the eye can read at any range: a
             * fixed fraction of the vehicle for the frame axes, and a
             * compressed scale for the ones that carry a magnitude, because
             * velocity spans 1 to 600 m/s in the same flight. */
            const compress = (v, ref) => L * (0.28 + 0.72 * Math.min(1, Math.log10(1 + Math.abs(v)) / Math.log10(1 + ref)));
            const com = world.mp.com;

            rig.nose.position.set(0, com, 0);
            rig.nose.setDirection(new V3(0, 1, 0));
            rig.nose.setLength(L * 0.62, L * 0.07, L * 0.035);
            rig.belly.position.set(0, com, 0);
            rig.belly.setDirection(new V3(1, 0, 0));
            rig.belly.setLength(L * 0.3, L * 0.05, L * 0.028);
            rig.side.position.set(0, com, 0);
            rig.side.setDirection(new V3(0, 0, -1));
            rig.side.setLength(L * 0.22, L * 0.045, L * 0.024);

            /* Relative airflow. tel.vB is the air's velocity in body axes, so
             * the flow ARRIVES from −vB — the arrow is drawn upstream of the
             * vehicle pointing at it, which is what an angle of attack is
             * measured against. */
            const vb = tel.vB;
            const bx = vb[0], by = vb[2], bz = -vb[1];      // body → local scene axes
            const vlen = Math.hypot(bx, by, bz);
            const showAir = vlen > 1.0;
            rig.air.visible = showAir;
            rig.alphaArc.visible = showAir;
            if (showAir) {
                const d = new V3(bx / vlen, by / vlen, bz / vlen);
                const len = compress(tel.vrel, 400) * 0.75;
                rig.air.position.copy(d.clone().multiplyScalar(-len).add(new V3(0, com, 0)));
                rig.air.setDirection(d);
                rig.air.setLength(len, L * 0.06, L * 0.03);

                /* The angle of attack, drawn as the arc it is: from the nose
                 * axis round to the flow. This is the quantity that breaks
                 * airframes when it is multiplied by dynamic pressure. */
                const a0 = new V3(0, 1, 0), a1 = d.clone().multiplyScalar(-1);
                const p = rig.alphaArc.geometry.attributes.position.array;
                const r = L * 0.34;
                for (let i = 0; i < 18; i++) {
                    const t = i / 17;
                    const v = a0.clone().multiplyScalar(1 - t).add(a1.clone().multiplyScalar(t));
                    if (v.lengthSq() < 1e-9) v.set(0, 1, 0);
                    v.normalize().multiplyScalar(r);
                    p[i * 3] = v.x; p[i * 3 + 1] = com + v.y; p[i * 3 + 2] = v.z;
                }
                rig.alphaArc.geometry.attributes.position.needsUpdate = true;
            }

            /* Body angular rate: a ring in the plane the vehicle is turning in,
             * sized by how fast. A tumble is unmistakable. */
            const w = world.w;
            const wx = w[0], wy = w[2], wz = -w[1];
            const wl = Math.hypot(wx, wy, wz);
            rig.rateRing.visible = wl > 0.02;
            if (rig.rateRing.visible) {
                const n = new V3(wx / wl, wy / wl, wz / wl);
                const u = Math.abs(n.y) > 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0);
                const e1 = new V3().crossVectors(n, u).normalize();
                const e2 = new V3().crossVectors(n, e1);
                const r = L * (0.09 + 0.20 * Math.min(1, wl / 0.9));
                const p = rig.rateRing.geometry.attributes.position.array;
                for (let i = 0; i < 33; i++) {
                    const a = (i / 32) * Math.PI * 2;
                    const v = e1.clone().multiplyScalar(Math.cos(a) * r).add(e2.clone().multiplyScalar(Math.sin(a) * r));
                    p[i * 3] = v.x; p[i * 3 + 1] = com + v.y; p[i * 3 + 2] = v.z;
                }
                rig.rateRing.geometry.attributes.position.needsUpdate = true;
            }

            for (const s of rig.strips) s.visible = true;

            // --------------------------------------------------- world frame
            const gp = veh.group.position;
            const comW = new V3(0, com, 0).applyQuaternion(veh.group.quaternion).add(gp);

            const sp = Math.hypot(world.v[0], world.v[1], world.v[2]);
            rig.vel.visible = sp > 0.6;
            if (rig.vel.visible) {
                const d = new V3(world.v[0] / sp, world.v[2] / sp, -world.v[1] / sp);
                const len = compress(sp, 400);
                rig.vel.position.copy(comW);
                rig.vel.setDirection(d);
                rig.vel.setLength(len, L * 0.07, L * 0.035);
                rig.labels.vel.position.copy(comW).add(d.clone().multiplyScalar(len * 1.06));
            }

            const setSeg = (line, a, b) => {
                const p = line.geometry.attributes.position.array;
                p[0] = a.x; p[1] = a.y; p[2] = a.z;
                p[3] = b.x; p[4] = b.y; p[5] = b.z;
                line.geometry.attributes.position.needsUpdate = true;
            };

            /* To the rails, measured FROM THE CATCH PINS, because that is the
             * point that has to arrive — not the centre of mass and not the
             * engine deck, which are 61 m away from it. */
            const pin = new V3(0, ty.catchPinZ, 0).applyQuaternion(veh.group.quaternion).add(gp);
            const gateP = new V3(V.TOWER.gateX, V.TOWER.armZ, -V.TOWER.gateY);
            rig.gate.visible = !!world.catchAllowed;
            rig.labels.gate.visible = rig.gate.visible;
            if (rig.gate.visible) {
                setSeg(rig.gate, pin, gateP);
                rig.labels.gate.position.copy(pin).lerp(gateP, 0.5);
            }

            /* The other destination, and its name matters: a Ship diverting to
             * concrete and a booster diverting to open water are scored under
             * completely different tolerances. */
            const gt = world.sc.groundTarget;
            const gtP = new V3(gt.x, 0.5, -gt.y);
            setSeg(rig.ground, gp, gtP);
            rig.labels.ground.position.copy(gp).lerp(gtP, 0.55);
            this.setLabel(rig.labels.ground, gt.kind === "pad" ? "to the pad" : "to the divert area");

            setSeg(rig.vert, gp, new V3(gp.x, 0, gp.z));

            const noseW = new V3(0, 1, 0).applyQuaternion(veh.group.quaternion);
            rig.labels.nose.position.copy(comW).add(noseW.clone().multiplyScalar(L * 0.72));
            if (showAir) {
                const d = new V3(bx / vlen, by / vlen, bz / vlen).applyQuaternion(veh.group.quaternion);
                rig.labels.air.position.copy(comW).add(d.clone().multiplyScalar(-compress(tel.vrel, 400) * 0.95));
            }
            rig.labels.air.visible = showAir;
            /* Quantised on purpose. setLabel repaints a canvas and re-uploads
             * a texture, and an altitude that changes in the last decimal every
             * frame turns one label into a per-frame texture upload. */
            const agl = tel.agl;
            this.setLabel(rig.labels.agl,
                (agl < 1000 ? (Math.round(agl / 5) * 5).toFixed(0) + " m" : (agl / 1000).toFixed(2) + " km") + " AGL");
            rig.labels.agl.position.set(gp.x, gp.y * 0.5, gp.z);
        }

        /* Repaint a sprite's text in place. Cheap enough at 60 Hz for one label. */
        setLabel(sprite, text) {
            if (sprite.userData.text === text) return;
            sprite.userData.text = text;
            const c = sprite.material.map.image, g = c.getContext("2d");
            g.clearRect(0, 0, c.width, c.height);
            g.font = "bold 30px ui-monospace, monospace";
            g.textAlign = "center"; g.textBaseline = "middle";
            g.lineWidth = 6; g.strokeStyle = "rgba(6,10,16,0.92)";
            g.strokeText(text, 128, 34);
            g.fillStyle = "#dfe8f2";
            g.fillText(text, 128, 34);
            sprite.material.map.needsUpdate = true;
        }

        /* -------------------------------------------------------- vehicle */
        buildVehicle(typeKey) {
            /* Removing a group from the scene does NOT free its buffers — three
             * keeps them until something calls dispose(). This runs on every new
             * seed, and episodes auto-advance every few seconds, so a booster's
             * 33 engine bells, three lattice fins and welded ring seams were
             * being handed to the GPU again every time and never handed back.
             * Left alone the tab grows until the renderer falls over. */
            if (this.vehicle) {
                this.scene.remove(this.vehicle.group);
                disposeTree(this.vehicle.group);
            }
            const ty = V.TYPES[typeKey];
            const group = new THREE.Group();

            /* METALNESS USED TO BE DELIBERATELY LOW, AND THAT WAS A WORKAROUND.
             * A MeshStandardMaterial's metallic term is entirely reflection, so
             * with no environment map the shiniest stainless steel in the world
             * renders as a black tube and the only way to get a bright hull was
             * to turn the metal down to 0.35 and let the diffuse term carry it —
             * which is the look of painted aluminium, not of steel. buildEnv()
             * now puts a prefiltered sky/ground probe in the scene, so the
             * metalness can go where it belongs and the roughness map decides
             * where the hull is glossy. */
            const steel = new THREE.MeshStandardMaterial({
                map: steelMap(), roughnessMap: steelRough(),
                color: 0xf2f5f8, roughness: 1.0, metalness: 0.92, envMapIntensity: 1.15
            });
            const tile = new THREE.MeshStandardMaterial({
                map: tileMap(), color: 0xffffff, roughness: 0.88, metalness: 0.04, envMapIntensity: 0.4
            });
            const dark = new THREE.MeshStandardMaterial({ color: 0x6c737a, roughness: 0.5, metalness: 0.65, envMapIntensity: 0.9 });

            // The body is drawn along +Y in its own frame and the group is then
            // oriented by the simulation quaternion, which maps body +Z to +Y.
            const bodyLen = ty.length * (1 - ty.noseFrac);
            /* The hull map repeats three times around and once every nine
             * metres, so one 512² tile covers a 72 m stage without any pixel of
             * it being stretched more than about 2:1.
             *
             * CACHED PER VEHICLE TYPE, NOT CLONED PER BUILD. The repeat differs
             * between the two stages, so this needs its own texture object —
             * but buildVehicle runs on every new seed, and a clone made here
             * inherits the cache's `shared` flag through Texture.copy, so
             * disposeTree would decline to free it and every episode would leak
             * two textures for as long as the tab was open. There are exactly
             * two vehicles, so there are exactly two of these, forever. */
            const rep = (t, key) => tex(key, () => {
                const c = t.clone(); c.needsUpdate = true;
                c.repeat.set(3, bodyLen / 9);
                return c;
            });
            const hull = steel.clone();
            hull.map = rep(steel.map, "hullMap:" + typeKey);
            hull.roughnessMap = rep(steel.roughnessMap, "hullRough:" + typeKey);
            const body = new THREE.Mesh(new THREE.CylinderGeometry(ty.radius, ty.radius, bodyLen, 48, 1, true), hull);
            body.position.y = bodyLen / 2;
            group.add(body);

            /* SOOT. Every one of these stages comes back with a black skirt: the
             * bottom few metres are scorched by its own exhaust and streaked
             * where the plume has licked back up the hull. Drawn as a
             * transparent sleeve 4 cm outside the skin rather than baked into
             * the hull map, because it only covers the bottom sixth and baking
             * it in would cost the hull map five times the resolution. */
            {
                const scorchH = Math.min(bodyLen, ty.length * 0.20);
                const sm = new THREE.Mesh(
                    new THREE.CylinderGeometry(ty.radius + 0.04, ty.radius + 0.04, scorchH, 48, 1, true),
                    new THREE.MeshStandardMaterial({
                        map: sootMap(), transparent: true, roughness: 0.95, metalness: 0.0,
                        color: 0xffffff, depthWrite: false, side: THREE.DoubleSide
                    }));
                sm.position.y = scorchH / 2;
                sm.renderOrder = 1;
                group.add(sm);
            }

            // welded ring seams
            for (let z = 4; z < bodyLen; z += 8) {
                const r = new THREE.Mesh(new THREE.CylinderGeometry(ty.radius + 0.05, ty.radius + 0.05, 0.18, 48, 1, true), dark);
                r.position.y = z;
                group.add(r);
            }

            /* Stringer stiffeners: eight shallow vertical ribs. They break the
             * hull's specular highlight into strips, which is what stops a
             * 9 m cylinder reading as a flat grey band whichever way the light
             * is coming from. */
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2 + 0.19;
                const st = new THREE.Mesh(
                    new THREE.BoxGeometry(0.5, bodyLen * 0.94, 0.16),
                    new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.42, metalness: 0.8, envMapIntensity: 1.0 }));
                st.position.set(Math.cos(a) * (ty.radius + 0.07), bodyLen * 0.5, Math.sin(a) * (ty.radius + 0.07));
                st.rotation.y = -a;
                group.add(st);
            }

            /* Hull markings. Two panels on opposite flanks carrying the stage
             * designation and a set of station tick marks — the ticks are the
             * useful half: they are a ruler on the side of the vehicle, so the
             * viewer can read a roll rate off the hull without the sensor
             * overlay switched on. */
            {
                const label = (typeKey === "booster" ? "SUPER HEAVY" : "STARSHIP");
                // cached: the same two panels are repainted on every new seed otherwise
                const mk = tex("decal:" + typeKey, () => drawTex(512, 256, (g2, w, h) => {
                    g2.clearRect(0, 0, w, h);
                    g2.fillStyle = "#20242a";
                    g2.font = "bold 66px ui-monospace, monospace";
                    g2.textAlign = "center"; g2.textBaseline = "middle";
                    g2.fillText(label, w / 2, 86);
                    g2.font = "bold 34px ui-monospace, monospace";
                    g2.fillStyle = "#3b4149";
                    g2.fillText(typeKey === "booster" ? "B-17" : "S-42", w / 2, 150);
                    g2.fillStyle = "#2b3037";
                    for (let k = 0; k < 16; k++) {
                        const long = (k % 4) === 0;
                        g2.fillRect(40 + k * 27, 196, long ? 5 : 3, long ? 26 : 14);
                    }
                }, true));
                /* WHICH FACE. CylinderGeometry measures theta from +Z toward
                 * +X, and the scene's local +X is body +X. On the booster that
                 * is the tower-facing side — the one azimuth with no grid fin
                 * on it — and on the Ship it is the tiled belly, so the Ship's
                 * panel goes on the opposite face, which is the bare steel one.
                 * Putting a decal on the heat shield would be the same class of
                 * mistake as drawing the fins on the wrong side. */
                const arc = 0.62;
                const centre = typeKey === "booster" ? Math.PI / 2 : -Math.PI / 2;
                const dec = new THREE.Mesh(
                    new THREE.CylinderGeometry(ty.radius + 0.09, ty.radius + 0.09, 11, 24, 1, true,
                        centre - arc / 2, arc),
                    new THREE.MeshStandardMaterial({
                        map: mk, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide,
                        roughness: 0.6, metalness: 0.1, color: 0xffffff
                    }));
                dec.position.y = bodyLen * (typeKey === "booster" ? 0.72 : 0.60);
                group.add(dec);
            }

            if (typeKey === "ship") {
                const nose = new THREE.Mesh(new THREE.SphereGeometry(ty.radius, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), steel);
                nose.scale.y = (ty.length - bodyLen) / ty.radius;
                nose.position.y = bodyLen;
                group.add(nose);
                /* The tiled flank: half the vehicle is black ceramic and half is
                 * bare steel, and which half is facing the airflow is the whole
                 * point of the belly flop — so it must be drawn on the +X body
                 * side, the side aero.js treats as the belly. */
                const heat = new THREE.Mesh(
                    new THREE.CylinderGeometry(ty.radius + 0.08, ty.radius + 0.08, bodyLen, 36, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
                    tile);
                heat.position.y = bodyLen / 2;
                /* CylinderGeometry measures theta from +Z toward +X, so a
                 * segment centred on theta = 0 faces scene +Z. The belly is
                 * body +X, which is scene +X, so this needs +90 degrees. At
                 * -90 the ship reentered shiny-side first. */
                heat.rotation.y = Math.PI / 2;
                group.add(heat);
            } else {
                /* The hot-stage ring: a vented collar at the very top, and on a
                 * Block 3 booster it is FIXED — there is nothing to jettison on
                 * the way down, unlike the V1/V2 vehicle whose ring came off
                 * after boostback. Drawn open, because a plain solid collar
                 * reads as a nosecone and this vehicle does not have one. */
                const ringH = 2.4, ringY = ty.length - ringH * 0.5;
                const cap = new THREE.Mesh(
                    new THREE.CylinderGeometry(ty.radius, ty.radius * 0.99, ringH, 36, 1, true), dark);
                cap.position.y = ringY;
                group.add(cap);
                for (let i = 0; i < 12; i++) {
                    const a = (i / 12) * Math.PI * 2;
                    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.9, ringH * 0.62, 0.5),
                        new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.95, metalness: 0.05 }));
                    vent.position.set(Math.cos(a) * (ty.radius + 0.06), ringY, Math.sin(a) * (ty.radius + 0.06));
                    vent.rotation.y = -a;
                    group.add(vent);
                }
            }

            /* Engine bells. A Raptor's exit is 1.3 m ACROSS, not 1.3 m in
             * radius — the bells used to be drawn at double size, which is why
             * only thirteen of them would fit on a nine-metre booster and the
             * outer ring had to be left off. At the right size all 33 fit, in
             * the real 3 / 10 / 20 arrangement, and the outer twenty read as
             * what they are: hardware that is present, and dead, all the way
             * down. Only the inner thirteen are wired to a plume, because only
             * those are in the vehicle's engine ladder. */
            const RVAC = 1.2;                    // 2.4 m exit
            const RSL = 0.65;                    // 1.3 m exit
            /* Regeneratively-cooled bells are not smooth cones — they are a
             * bundle of brazed tubes, so the silhouette is fluted and the
             * throat end is a dark machined block. Sixteen radial segments and
             * a darker, rougher metal is all that costs. */
            const bellMat = new THREE.MeshStandardMaterial({
                color: 0x4a4f56, roughness: 0.42, metalness: 0.88, envMapIntensity: 0.85
            });
            const throatMat = new THREE.MeshStandardMaterial({
                color: 0x2a2d32, roughness: 0.65, metalness: 0.55
            });
            const layout = typeKey === "booster"
                ? [{ n: 3, r: 0.9, rad: RSL, live: true }, { n: 10, r: 2.4, rad: RSL, live: true },
                   { n: 20, r: 3.9, rad: RSL, live: false }]
                : [{ n: 3, r: 0.85, rad: RSL, live: true }, { n: 3, r: 2.7, rad: RVAC, live: false }];
            /* THE LIVE ENGINES HANG OFF A PIVOT AT THE THROAT, NOT OFF THE
             * VEHICLE. A gimballed engine rotates about its injector, so the
             * exit sweeps and the throat does not — and the whole assembly, bell
             * and plume together, has to swing as one unit or the flame comes
             * out of the side of a bell that is still pointing straight down.
             * update() writes one quaternion per pivot and nothing else. */
            const engines = [];
            for (const ring of layout) {
                for (let i = 0; i < ring.n; i++) {
                    const a = (i / ring.n) * Math.PI * 2 + (ring.live ? 0 : Math.PI / ring.n);
                    const h = ring.rad * 2.0;
                    const bell = new THREE.Mesh(
                        new THREE.CylinderGeometry(ring.rad * 0.62, ring.rad, h, 16, 1, true), bellMat);
                    const lip = new THREE.Mesh(
                        new THREE.CylinderGeometry(ring.rad * 1.02, ring.rad * 1.02, 0.14, 16, 1, true), throatMat);
                    const inj = new THREE.Mesh(
                        new THREE.CylinderGeometry(ring.rad * 0.5, ring.rad * 0.62, ring.rad * 0.9, 12), throatMat);
                    if (ring.live) {
                        const pivot = new THREE.Group();
                        pivot.position.set(Math.cos(a) * ring.r, h, Math.sin(a) * ring.r);
                        bell.position.y = -h * 0.5;
                        lip.position.y = -h;
                        inj.position.y = ring.rad * 0.45;
                        pivot.add(bell); pivot.add(lip); pivot.add(inj);
                        group.add(pivot);
                        engines.push({ pivot, exit: h, rad: ring.rad });
                    } else {
                        bell.position.set(Math.cos(a) * ring.r, h * 0.5, Math.sin(a) * ring.r);
                        lip.position.set(bell.position.x, 0.07, bell.position.z);
                        inj.position.set(bell.position.x, h + ring.rad * 0.45, bell.position.z);
                        group.add(bell); group.add(lip); group.add(inj);
                    }
                }
            }

            /* ------------------------------------------------------- plumes
             * Three parts per engine, and each is doing a different job:
             *
             *  · CORE — narrow, near-white, with the shock diamonds painted
             *    into its texture. This is the part that reads as "an engine is
             *    running" from a kilometre away.
             *  · FLARE — wide, orange, low opacity. It is what makes the plume
             *    look hot rather than look like a cone of light, and at altitude
             *    it is what blooms as the ambient pressure falls away.
             *  · GLOW — an additive billboard at the exit plane. Without it the
             *    brightest point of the plume is wherever two cone walls
             *    happen to overlap, which moves as the camera moves.
             *
             * All three live under the engine's gimbal pivot, so the exhaust
             * geometry is settled once here and never re-derived per frame.
             * They are built pointing along the pivot's local −Y, which is
             * straight out of the bell; update() rotates the pivot, not these. */
            const plumeTex = plumeMap();
            const plumes = [];
            for (const e of engines) {
                const holder = new THREE.Group();
                holder.position.y = -e.exit;                    // the exit plane
                const mkCone = (rad, len, color, op) => {
                    const m = new THREE.Mesh(
                        new THREE.ConeGeometry(rad, len, 16, 1, true),
                        new THREE.MeshBasicMaterial({
                            map: plumeTex, color, transparent: true, opacity: op,
                            blending: THREE.AdditiveBlending, depthWrite: false,
                            side: THREE.DoubleSide, fog: false
                        }));
                    /* ConeGeometry's apex is at +h/2. The apex is the throat, so
                     * the cone hangs entirely below the exit plane and opens
                     * downstream. */
                    m.position.y = -len / 2;
                    m.castShadow = false;
                    return m;
                };
                /* THE FLARE IS WIDER THAN THE CORE IS LONG, ROUGHLY. A 1.3 m
                 * exit throwing a 20 m pencil is what the first version drew
                 * and it read as a laser: an exhaust is a plume, and the
                 * proportion that sells it is length to about a dozen exit
                 * diameters with a translucent sheath two or three across. */
                const core = mkCone(e.rad * 1.05, 15, 0xfff4dc, 0.95);
                const flare = mkCone(e.rad * 3.1, 22, 0xff7a1e, 0.55);
                flare.renderOrder = 3;
                core.renderOrder = 4;
                const glow = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: glowMap(), color: 0xffd9a0, transparent: true, opacity: 0.9,
                    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
                }));
                glow.scale.set(e.rad * 5, e.rad * 5, 1);
                glow.renderOrder = 5;
                holder.add(flare); holder.add(core); holder.add(glow);
                holder.visible = false;
                e.pivot.add(holder);
                plumes.push({ holder, core, flare, glow, rad: e.rad });
            }

            // grid fins
            const fins = [];
            for (const f of ty.fins) {
                /* Body azimuth az means body position (r*cos az, r*sin az, z),
                 * which in the scene is (r*cos az, z, -r*sin az) — note the
                 * minus. Rotating the pivot about scene +Y by +az then points
                 * its local +X along that same radius, so the panel hinges about
                 * the radial axis exactly as aero.js assumes. The first version
                 * had both signs flipped: self-consistent, and a mirror image of
                 * the vehicle the physics was flying. */
                const pivot = new THREE.Group();
                const rr = ty.radius + 0.3;
                pivot.position.set(Math.cos(f.az) * rr, f.z, -Math.sin(f.az) * rr);
                /* THE EULER ORDER IS LOAD-BEARING, and defaulting it put two of
                 * the three fins through the hull.
                 *
                 * This pivot carries two rotations: `y` orients it so local +X
                 * is the radius, and `x` is the deflection, which must turn
                 * about that radius. Three.js composes the default 'XYZ' order
                 * as R = RX·RY — so RY runs first and RX is then applied about
                 * the PARENT's x axis, not about the radius this pivot just
                 * aligned itself to. The only fin unaffected is the one whose
                 * radius already lies along scene x (az 180°), which is why the
                 * defect appeared on some fins and not others and looked
                 * intermittent from outside.
                 *
                 * Measured with the default order: at 45° of deflection the
                 * panel's nearest point sat 2.17 m from the body axis, i.e.
                 * 2.3 m INSIDE a 4.5 m hull. With 'YXZ' the composition is
                 * R = RY·RX, the deflection turns about the radius as intended,
                 * and the closest approach over the whole ±45° travel is
                 * 4.80 m. See the grid-fin sweep assertion in test_headless.js,
                 * which is trigonometry rather than a screenshot. */
                pivot.rotation.order = "YXZ";
                pivot.rotation.y = f.az;     // local +X points radially outward
                /* 7.5 m tall by 3.75 m wide, drawn at those dimensions: span
                 * out from the hull along local X, chord along the body. */
                const span = 3.75, chord = 7.5;
                /* Titanium, cast and unpainted: warmer and darker than the
                 * hull, and rough enough that it never picks up the same
                 * highlight — which is what keeps the fins legible against the
                 * steel behind them at any attitude. */
                const latt = new THREE.MeshStandardMaterial({ color: 0x8e8c88, roughness: 0.58, metalness: 0.75, envMapIntensity: 0.85 });
                const frame = new THREE.Mesh(new THREE.BoxGeometry(span, chord, 0.55), dark);
                frame.position.x = span * 0.5;
                pivot.add(frame);
                /* The cell grid, at the real ~1 m pitch. A grid fin is not a
                 * paddle — the open lattice is the entire reason it works at
                 * Mach 3 and it is the most recognisable piece of hardware on a
                 * returning booster, so it is drawn as cells rather than as
                 * seven bars. */
                for (let k = -3; k <= 3; k++) {
                    const bar = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, 0.95), latt);
                    bar.position.set(span * 0.5, k * (chord / 7.5), 0);
                    pivot.add(bar);
                }
                for (let k = -2; k <= 2; k++) {
                    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, chord, 0.95), latt);
                    bar.position.set(span * 0.5 + k * (span / 5), 0, 0);
                    pivot.add(bar);
                }
                // the hinge shaft and its housing on the hull
                const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, chord * 0.55, 10), dark);
                hinge.rotation.z = Math.PI / 2;
                hinge.position.x = -0.2;
                pivot.add(hinge);
                group.add(pivot);
                fins.push(pivot);
            }

            /* Flaps. THE PIVOT SITS ON THE HULL AND NOTHING BELOW IT EVER
             * MOVES. The previous version put the pivot on the centreline and
             * hung the panel off it on a 3.3 m arm, so rotating the pivot swept
             * the panel around the vehicle's axis: it left the hull entirely at
             * one end of its travel and passed through it at the other, which
             * is the "floating flaps" defect. A hinge is a line ON the surface,
             * the panel's inboard edge lies along it, and deflection is a pure
             * rotation of the pivot — the panel's local transform is set once,
             * at build time, and never touched again.
             *
             * Geometry comes from vehicle.js so the drawn hinge and the
             * aerodynamic hinge cannot drift apart. */
            const flaps = [];
            for (const f of ty.flaps) {
                const pivot = new THREE.Group();
                const rr = ty.radius + 0.05;     // clear of the hull skin, not inside it
                /* Body (x, y, z) maps to scene (x, z, −y). The hinge is at
                 * azimuth `hingeAz` off the belly centreline, on the `side`
                 * flank, and its axis is the body long axis — which is scene
                 * +Y, so a rotation.y IS a rotation about the hinge line, once
                 * the pivot is standing on it. */
                pivot.position.set(
                    Math.cos(f.hingeAz) * rr,
                    f.z,
                    -f.side * Math.sin(f.hingeAz) * rr);
                const panel = new THREE.Mesh(new THREE.BoxGeometry(f.span, f.chord, 0.4), tile);
                panel.position.set(f.span * 0.5, 0, 0);   // extends out from the hinge
                pivot.add(panel);
                // a visible hinge fairing, so the joint reads as a joint
                const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, f.chord, 10), dark);
                pivot.add(spine);
                pivot.userData.side = f.side;
                group.add(pivot);
                flaps.push(pivot);
            }

            // legs
            const legs = [];
            if (ty.hasLegs) {
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2;
                    const pivot = new THREE.Group();
                    pivot.position.set(Math.cos(a) * ty.radius * 0.9, 2.0, -Math.sin(a) * ty.radius * 0.9);
                    pivot.rotation.y = a;
                    const leg = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.9, 1.4), dark);
                    leg.position.x = 3.2;
                    pivot.add(leg);
                    group.add(pivot);
                    legs.push(pivot);
                }
            }

            // catch pins
            const pins = [];
            if (ty.canBeCaught) {
                for (const s of [1, -1]) {
                    const pin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.6),
                        new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.4, metalness: 0.8 }));
                    pin.position.set(s * (ty.radius + 0.7), ty.catchPinZ, 0);
                    group.add(pin);
                    pins.push(pin);
                }
            }

            /* The vehicle casts, its plumes do not — an additive-blended cone
             * throwing a hard shadow reads as a solid object hanging under the
             * engines. */
            group.traverse(o => { if (o.isMesh) o.castShadow = true; });
            for (const pl of plumes) pl.holder.traverse(o => { o.castShadow = false; });
            this.scene.add(group);
            this.vehicle = { group, ty, fins, flaps, legs, plumes, engines, pins, typeKey };
            /* The rig carries the vehicle's own dimensions — strip stations,
             * arrow lengths — so it is rebuilt whenever the vehicle changes. */
            this.buildSensorRig(ty);
            this.setSensorsVisible(this.sensorsOn);
            return this.vehicle;
        }

        /* Map a simulation vector (x east, y north, z up) into the scene. */
        static toScene(v, out) { out.set(v[0], v[2], -v[1]); return out; }

        update(world, frame) {
            const veh = this.vehicle;
            if (!veh) return;
            const p = frame ? frame.p : world.p;
            const q = frame ? frame.q : world.q;

            veh.group.position.set(p[0], p[2], -p[1]);
            /* Simulation quaternions are body→world in a Z-up frame; the scene is
             * Y-up. The mapping (x,y,z)→(x,z,−y) is a −90° rotation about X, and
             * the same similarity transform has to be applied to the rotation:
             * q_scene = R · q_sim · R⁻¹ with R that rotation. Written out for a
             * quaternion (x,y,z,w) it is simply (x, z, −y, w). */
            veh.group.quaternion.set(q[0], q[2], -q[1], q[3]);

            const fin = frame ? frame.fin : Array.from(world.act.fin);
            for (let i = 0; i < veh.fins.length; i++) veh.fins[i].rotation.x = fin[i] || 0;

            const flap = frame ? frame.flap : Array.from(world.act.flap);
            for (let i = 0; i < veh.flaps.length; i++) {
                const d = flap[i] || 0;
                const pv = veh.flaps[i];
                /* The panel's outward direction in body coords is
                 * (−cos d, side·sin d, 0) — leeward along the flank when
                 * tucked, straight out from the flank at ninety degrees, which
                 * is the same u that aero.js uses to place the centroid. In the
                 * scene that direction is (−cos d, 0, −side·sin d), and a
                 * pivot rotated by θ about +Y points its local +X at
                 * (cos θ, 0, −sin θ). Solving both components gives θ = π − side·d.
                 * ONLY the pivot's rotation is written; touching the panel's
                 * position here is what detached the flaps in the first place. */
                pv.rotation.y = Math.PI - pv.userData.side * d;
            }

            const legF = frame ? frame.leg : world.act.legFrac;
            /* Stowed means folded UP against the hull, not sticking straight out
             * — at rotation zero the leg boxes lie along the pivot's local +X,
             * which is radially outward, so an undeployed Ship was drawn with
             * six legs already spread like a landed lander. -90 degrees lays
             * them along the body. */
            for (const l of veh.legs) l.rotation.z = -(Math.PI / 2) + legF * (Math.PI / 2 - 0.55);

            const thr = frame ? frame.thr : world.act.throttle;
            const eng = frame ? frame.eng : world.act.liveEngines();
            const gx = frame ? frame.gx : world.act.gimbalX;
            const gy = frame ? frame.gy : world.act.gimbalY;

            /* WHICH WAY THE FLAME POINTS, DERIVED RATHER THAN APPROXIMATED.
             *
             * world.js builds the thrust vector in body axes as
             *      F_body = T · ( sin gy , −sin gx , √(1 − sin²gy − sin²gx) )
             * and the exhaust leaves along −F. Mapping body → scene with the
             * file's one mapping, (x, y, z) → (x, z, −y), the exhaust direction
             * in the vehicle's own frame is
             *      ( −sin gy , −tz , −sin gx ).
             *
             * The old code set rotation.z = gy and rotation.x = π + gx, which
             * under the default XYZ Euler order comes out as
             *      ( −sin gy , −cos gx·cos gy , −cos gy·sin gx )
             * — the same vector to first order, and off by at most 0.52° at
             * the corner of the ±15° gimbal box, so the flame was never
             * visibly wrong. It was only ever *nearly* right. Deriving the
             * vector instead and handing it to setFromUnitVectors costs the
             * same and makes the drawn exhaust axis and the modelled thrust
             * axis the same line by construction, which is the standing rule
             * in this file. Checked over the whole gimbal box: the residual is
             * 1e-6 degrees, i.e. float noise. */
            const sgy = Math.sin(gy), sgx = Math.sin(gx);
            const tz = Math.sqrt(Math.max(0, 1 - sgy * sgy - sgx * sgx));
            this._exh = this._exh || new THREE.Vector3();
            this._down = this._down || new THREE.Vector3(0, -1, 0);
            this._exh.set(-sgy, -tz, -sgx).normalize();

            /* Ambient pressure shapes the plume: at sea level it is a tight
             * pencil, and by the time it is thin enough up there the same flow
             * is over-expanded into a bloom several times the exit diameter.
             * p[2] is altitude, so this reads simulation state and writes none. */
            const alt = Math.max(0, p[2]);
            const bloom = 1 + 2.4 * Math.min(1, alt / 22000);
            const tSim = frame ? frame.t : (world ? world.t : 0);

            /* The bells swing whether they are lit or not — a gimbal that only
             * moves when there is a flame on the end of it is a flame that
             * teleports the moment an engine relights. */
            for (const e of veh.engines) e.pivot.quaternion.setFromUnitVectors(this._down, this._exh);

            for (let i = 0; i < veh.plumes.length; i++) {
                const pl = veh.plumes[i];
                const on = i < eng && thr > 0.02;
                pl.holder.visible = on;
                if (!on) continue;
                /* Combustion is not steady and a plume drawn at a constant
                 * length reads as a cardboard cone. The flicker is keyed off
                 * SIMULATION time and the engine index, so a paused frame holds
                 * still and a replay flickers identically. */
                const fl = 0.88 + 0.24 * hash2(Math.floor(tSim * 38) + i * 13, 5);
                const len = (0.48 + thr * 0.85) * fl;
                const wide = (0.72 + thr * 0.42) * bloom;
                pl.core.scale.set(wide, len, wide);
                const fw = wide * (0.9 + 0.45 * (bloom - 1));
                pl.flare.scale.set(fw, len * 0.9, fw);
                const gain = this.plumeGain;
                pl.core.material.opacity = Math.min(1, (0.60 + 0.38 * thr) * gain);
                pl.flare.material.opacity = Math.min(0.95, (0.34 + 0.34 * thr) * gain);
                const gs = pl.rad * (4.5 + 4.5 * thr) * fl;
                pl.glow.scale.set(gs, gs, 1);
                pl.glow.material.opacity = Math.min(1, (0.40 + 0.45 * thr) * gain);
            }

            this.pushTrail(p[0], p[1], p[2]);
            if (this.sensorsOn) this.updateSensorRig(world);

            /* --- effects. All of this READS simulation state and writes none of
             * it, and none of it runs during training, because training never
             * constructs a Scene at all. */
            const t = frame ? frame.t : (world ? world.t : 0);
            this.updateEffects(t, p, thr, eng);
        }

        /* Scrolling water, a blinking beacon, engine dust and a splash. Driven
         * by SIMULATION time rather than wall-clock so that a paused playback
         * holds still and a replay of the same episode looks the same twice. */
        updateEffects(t, p, thr, eng) {
            this.simT = t;
            if (this.waterTex) {
                this.waterTex[0].offset.set(t * 0.0032, t * 0.0018);
                this.waterTex[1].offset.set(-t * 0.0011, t * 0.0026);
            }
            /* The surf runs along the beach and breathes in and out. Two very
             * slightly different periods, so the two never sync into a pulse. */
            if (this.foamTex) {
                this.foamTex.offset.set(t * 0.004, 0.10 * Math.sin(t * 0.55));
                this.foamMat.opacity = (this.night ? 0.32 : 0.85) * (0.78 + 0.22 * Math.sin(t * 0.9 + 1.1));
            }
            if (this.sky) this.sky.material.uniforms.uTime.value = t;
            if (this.beacon) {
                const on = (t % 2) < 0.55;
                this.beacon.material.color.setHex(on ? 0xff3322 : 0x551311);
                if (this.beaconHalo) this.beaconHalo.material.opacity = on ? (this.night ? 0.95 : 0.55) : 0.0;
            }

            const thrust = (thr > 0.02 ? thr : 0) * (eng || 0);

            if (this.plumeLight) {
                /* THE ENGINE LIGHT IS BOUNDED BY ENGINE COUNT, NOT SCALED BY IT.
                 *
                 * `thrust` is throttle TIMES the number of lit engines, so a
                 * booster on thirteen ran this light at 2.2 + 13×2.6 ≈ 36 —
                 * which is not a landing burn lighting the pad, it is a
                 * floodlight, and it washed the apron and the tower to white
                 * every time the engines came up. Thirteen bells do not
                 * illuminate thirteen times as far as one: they are a metre
                 * apart on the same deck and the light falls off from the same
                 * place. So the count saturates quickly and the throttle
                 * carries the rest. */
                const flick = 0.8 + 0.4 * hash2(Math.floor(t * 40), 7);
                const lit = thr > 0.02 ? thr * Math.min(1, 0.45 + (eng || 0) * 0.18) : 0;
                /* At night the plume is the only real light source in the
                 * scene, so it still has to carry the tower and the apron —
                 * but from a much lower base. */
                const gain = this.night ? 1.6 : 1.0;
                this.plumeLight.intensity = lit > 0 ? (0.7 + lit * 2.4) * flick * gain : 0;
                this.plumeLight.position.set(p[0], Math.max(2.5, p[2] - 9), -p[1]);
            }

            /* Dust blowback: a ring of sand thrown out from the point on the
             * ground directly under the vehicle, whenever an engine is lit low
             * enough for the exhaust to reach it. */
            const agl = p[2];
            if (this.dust) {
                const live = thrust > 0 && agl < 55 && agl > -5;
                const seaward = -p[1] > 330;              // over water: splash, not sand
                this.dust.group.visible = live && !seaward;
                if (live && !seaward) {
                    this.dust.group.position.set(p[0], 0.2, -p[1]);
                    const grow = 1 - Math.max(0, agl) / 55;
                    const amt = Math.min(1, thrust / 3) * grow;
                    for (let i = 0; i < this.dust.parts.length; i++) {
                        const d = this.dust.parts[i];
                        const ph = (t * 0.55 + d.userData.ph) % 1;
                        const rr = 6 + ph * (30 + 44 * grow);
                        d.position.set(Math.cos(d.userData.a) * rr, 0.6 + ph * 7 * grow, Math.sin(d.userData.a) * rr);
                        const s = 2.5 + ph * 9;
                        d.scale.set(s, s, s);
                        d.material.opacity = 0.5 * (1 - ph) * amt;
                    }
                    /* THE COLUMN. The flat ring alone reads as a shockwave on
                     * the ground; what a landing burn actually throws up is a
                     * boiling cloud that climbs the vehicle. These are sprites
                     * rather than ground-parallel quads for exactly that reason
                     * — they have to look like volume from the chase camera,
                     * which is above them. Lit warm from below when the engines
                     * are close to the deck. */
                    for (let i = 0; i < this.dust.puffs.length; i++) {
                        const s = this.dust.puffs[i], u = s.userData;
                        const ph = (t * 0.30 + u.ph) % 1;
                        const rr = 4 + ph * (26 + 40 * grow);
                        s.position.set(Math.cos(u.a) * rr, 2 + ph * ph * (34 + 46 * grow), Math.sin(u.a) * rr);
                        const sc = 9 + ph * 34;
                        s.scale.set(sc, sc, 1);
                        s.material.opacity = 0.42 * Math.sin(Math.PI * ph) * amt;
                        // the base of the column is inside the fireball
                        const heat = Math.max(0, 1 - ph * 3.2) * amt;
                        s.material.color.setRGB(0.76 + heat * 0.24, 0.70 + heat * 0.14, 0.58 - heat * 0.30);
                    }
                }
            }

            /* Splash: fired once, when the vehicle first reaches the water. */
            if (this.splash) {
                const overWater = -p[1] > 330;
                /* p[2] is the ENGINE PLANE. A ship ditching belly-first
                 * touches the water with the engine plane still a hull radius
                 * up, so the trigger is 6 m, not zero. */
                if (overWater && agl < 6 && this.splash.firedAt < 0) this.splash.firedAt = t;
                if (this.splash.firedAt >= 0) {
                    const age = t - this.splash.firedAt;
                    const gone = age > 3.2;
                    this.splash.group.visible = !gone;
                    if (!gone) {
                        this.splash.group.position.set(p[0], this.seaLevelY + 0.2, -p[1]);
                        const r = 4 + age * 26;
                        this.splash.ring.scale.set(r, r, r);
                        this.splash.ring.material.opacity = 0.75 * Math.max(0, 1 - age / 3.2);
                        for (let i = 0; i < this.splash.parts.length; i++) {
                            const s = this.splash.parts[i];
                            const u = s.userData;
                            s.position.set(u.vx * age, Math.max(0, u.vy * age - 4.9 * age * age), u.vz * age);
                            s.material.opacity = 0.8 * Math.max(0, 1 - age / 2.4);
                            const sc = 2 + age * 2.5;
                            s.scale.set(sc, sc, sc);
                        }
                    }
                } else this.splash.group.visible = false;
            }
        }

        /* Pooled: built once, recycled forever. Creating a sprite or a material
         * inside the frame loop shows up as a stutter that reads as a physics
         * problem, which is a bad hour to spend. */
        buildEffects() {
            const puff = puffMap();
            const sandMat = new THREE.MeshBasicMaterial({
                map: puff, color: 0xc2b083, transparent: true, opacity: 0, depthWrite: false, fog: true
            });
            const dg = new THREE.Group();
            const parts = [];
            for (let i = 0; i < 96; i++) {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sandMat.clone());
                m.rotation.x = -Math.PI / 2;
                m.userData.a = (i / 96) * Math.PI * 2 + hash2(i, 61) * 0.4;
                m.userData.ph = hash2(i, 67);
                dg.add(m);
                parts.push(m);
            }
            const puffs = [];
            for (let i = 0; i < 44; i++) {
                const s = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: puff, color: 0xc2b083, transparent: true, opacity: 0,
                    depthWrite: false, fog: true
                }));
                s.userData.a = hash2(i, 83) * Math.PI * 2;
                s.userData.ph = hash2(i, 89);
                dg.add(s);
                puffs.push(s);
            }
            dg.visible = false;
            this.scene.add(dg);
            this.dust = { group: dg, parts, puffs };

            const sg = new THREE.Group();
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.92, 1, 40),
                new THREE.MeshBasicMaterial({ color: 0xeaf3f7, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
            ring.rotation.x = -Math.PI / 2;
            sg.add(ring);
            const sparts = [];
            for (let i = 0; i < 40; i++) {
                const m = new THREE.Sprite(
                    new THREE.SpriteMaterial({ map: puff, color: 0xf2f8fa, transparent: true, opacity: 0, depthWrite: false, fog: true }));
                const a = hash2(i, 71) * Math.PI * 2, sp = 8 + hash2(i, 73) * 22;
                m.userData = { vx: Math.cos(a) * sp * 0.55, vy: 14 + hash2(i, 79) * 16, vz: Math.sin(a) * sp * 0.55 };
                sg.add(m);
                sparts.push(m);
            }
            sg.visible = false;
            this.scene.add(sg);
            this.splash = { group: sg, ring, parts: sparts, firedAt: -1 };
        }

        /* Called when a new episode starts, so one-shot effects can re-arm. */
        resetEffects() {
            if (this.splash) { this.splash.firedAt = -1; this.splash.group.visible = false; }
            if (this.dust) this.dust.group.visible = false;
        }

        setTargets(sc) {
            const gt = sc.groundTarget;
            if (gt.kind === "pad") {
                this.padMesh.position.set(gt.x, 0.06, -gt.y);
                this.padMesh.visible = true;
                this.safeMesh.visible = false;
            } else {
                this.padMesh.position.set(V.PAD.x, 0.06, -V.PAD.y);
                this.padMesh.visible = true;
                this.safeMesh.visible = true;
                this.safeMesh.position.set(gt.x, 0.2, -gt.y);
                this.safeMesh.scale.set(gt.radius, gt.radius, gt.radius);
            }
        }

        setCatchLight(ok) {
            const c = ok ? 0x6ee7a0 : 0xff6b6b;
            this.gateRing.material.color.setHex(c);
        }

        /* ---------------------------------------------------------- camera */
        bindInput() {
            const c = this.canvas;
            /* Dragging always rotates, whatever view is selected. Grabbing the
             * scene and having nothing move because the camera happens to be in
             * chase mode is not a mode, it is a broken control — so the first
             * drag takes the camera into orbit and tells the UI it did. */
            const toOrbit = () => {
                if (this.camMode !== "orbit") {
                    // inherit the current camera pose so the view does not jump
                    const cam = this.camera, t = this.orbit.target;
                    const dx = cam.position.x - t.x, dy = cam.position.y - t.y, dz = cam.position.z - t.z;
                    const d = Math.max(30, Math.hypot(dx, dy, dz));
                    this.orbit.dist = Math.min(6000, d);
                    this.orbit.az = Math.atan2(dz, dx);
                    this.orbit.el = Math.asin(Math.max(-1, Math.min(1, dy / d)));
                    this.camMode = "orbit";
                    if (this.onCamModeChange) this.onCamModeChange("orbit");
                }
            };
            c.addEventListener("pointerdown", (e) => {
                this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
                try { c.setPointerCapture(e.pointerId); } catch (err) { }
                e.preventDefault();
            });
            c.addEventListener("pointermove", (e) => {
                if (!this.drag) return;
                const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
                this.drag.moved += Math.abs(dx) + Math.abs(dy);
                if (this.drag.moved > 3) toOrbit();
                this.orbit.az -= dx * 0.006;
                this.orbit.el = Math.max(-0.35, Math.min(1.35, this.orbit.el + dy * 0.005));
                this.drag.x = e.clientX; this.drag.y = e.clientY;
                e.preventDefault();
            });
            const end = (e) => {
                this.drag = null;
                if (e && e.pointerId != null) { try { c.releasePointerCapture(e.pointerId); } catch (err) { } }
            };
            c.addEventListener("pointerup", end);
            c.addEventListener("pointercancel", end);
            c.addEventListener("pointerleave", end);
            c.addEventListener("wheel", (e) => {
                e.preventDefault();
                toOrbit();
                this.orbit.dist = Math.max(25, Math.min(9000, this.orbit.dist * Math.exp(e.deltaY * 0.0012)));
            }, { passive: false });
            // a touch drag must not scroll the page underneath it
            c.style.touchAction = "none";
        }

        placeCamera(world, frame) {
            const p = frame ? frame.p : (world ? world.p : [0, 0, 200]);
            const tgt = new THREE.Vector3(p[0], p[2], -p[1]);
            const cam = this.camera;
            const T2 = window.Vehicle.TOWER;

            if (this.camMode === "tower") {
                cam.position.set(T2.gateHalfGap + 26, T2.armZ + 16, -T2.gateY - 34);
                cam.lookAt(tgt);
            } else if (this.camMode === "pad") {
                cam.position.set(150, 22, 150);
                cam.lookAt(tgt);
            } else if (this.camMode === "chase") {
                const d = Math.max(70, Math.min(420, 60 + p[2] * 0.28));
                /* Below two kilometres, slide the look-at point toward the rails
                 * so the tower comes into frame as the vehicle closes on it.
                 * A chase camera locked on the vehicle alone shows a cylinder
                 * against an empty sky right up until the moment it matters. */
                const k = 0.5 * Math.max(0, Math.min(1, 1 - p[2] / 2000));
                const look = tgt.clone().lerp(new THREE.Vector3(T2.gateX, T2.armZ, -T2.gateY), k);
                cam.position.set(look.x + d * 0.85, look.y + d * 0.36, look.z + d * 0.85);
                cam.lookAt(look);
            } else { // orbit — the target follows the vehicle so a drag stays framed
                const o = this.orbit;
                o.target.copy(tgt);
                const ce = Math.cos(o.el), se = Math.sin(o.el);
                cam.position.set(
                    tgt.x + Math.cos(o.az) * ce * o.dist,
                    tgt.y + se * o.dist + 12,
                    tgt.z + Math.sin(o.az) * ce * o.dist);
                cam.lookAt(tgt);
            }
        }

        resize(w, h, dprCap) {
            /* The dpr cap is not cosmetic. On a high-DPI laptop this scene is
             * fill-rate bound and rendering a 3× backing store costs more than
             * everything else in the frame put together. */
            const dpr = Math.min(window.devicePixelRatio || 1, dprCap || 1.6);
            this.renderer.setPixelRatio(dpr);
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }

        render() { this.renderer.render(this.scene, this.camera); }
    }

    return { Scene };
})();

window.RNDR = RNDR;
