/* render.js — the three.js view.
 *
 * Everything drawn here is read straight out of the physics state: each link's
 * boxes come from the same `model.bodies[i].boxes` list that produced its
 * inertia tensor, and each link's transform is the multibody's own world
 * rotation and position. Nothing is animated, interpolated or faked — if the
 * doll looks wrong on screen, the simulation is wrong.
 *
 * The population is drawn where it actually is: all walkers share one spawn on
 * one patch of ground (see world.js on fairness), so they overlap as a ghost
 * swarm with the current leader picked out in solid colour. The spread of the
 * ghosts is a live read on how much variance is left in the gene pool.
 */
"use strict";

/* Two environments, same simulation. The walker colours barely move between
 * them — a green doll on a pale floor and the same green on a dark floor read
 * as the same object, which is what you want when comparing runs across a
 * theme switch. What does change is everything the eye is NOT meant to look at:
 * sky, floor, grid, and the light rig.
 *
 * Under the dark palette the hemisphere light's ground term has to come down
 * with the floor, or the doll picks up bounce light from a surface that is no
 * longer there and floats free of its own shadow. The sun is also eased off:
 * the same 0.75 that reads as daylight on a near-white floor blows out to a
 * glare against a dark one. */
const THEMES = {
    light: {
        sky: 0xdfe6ee,
        ground: 0xeef1f4,
        groundLine: 0xc3ccd6,
        hemiSky: 0xffffff, hemiGround: 0xb9c4cf, hemiIntensity: 0.85,
        sunColor: 0xffffff, sunIntensity: 0.75,
        fogNear: 18, fogFar: 55,
        leader: 0x4fd07a,
        /* Actuators and the face plate. A dark, slightly cool neutral rather
         * than a second hue: the drums are on every joint of every doll, so a
         * saturated accent would out-shout the walker it is attached to. */
        joint: 0x36495e,
        // thin bearing collars either side of each drum — the highlight that
        // makes a cylinder read as a machined part rather than a peg
        collar: 0xf3f7fa,
        ghost: 0x7fd6a2,
        ghostOpacity: 0.16,
        waypoint: 0x35b6ff,
        waypointNext: 0xffc94d,
        com: 0xff5f6b
    },
    dark: {
        sky: 0x0f1319,
        ground: 0x1b212b,
        groundLine: 0x2f3947,
        hemiSky: 0x9fb2c9, hemiGround: 0x141a22, hemiIntensity: 0.55,
        sunColor: 0xdce8ff, sunIntensity: 0.55,
        // Pull the fog in slightly: against a dark sky the horizon has less
        // contrast to fade into, so the same distances read as a hard edge.
        fogNear: 15, fogFar: 48,
        leader: 0x5fe08a,
        // Lifted off the light-theme value: 0x36495e against a 0x0f1319 sky is
        // barely two steps from the background, and the joints would read as
        // holes punched through the doll rather than parts bolted onto it.
        joint: 0x4d6480,
        collar: 0xd6e2ee,
        // Ghosts need MORE opacity here, not less. At 0.16 against a near-black
        // floor the swarm all but vanished, and the spread of the ghosts is the
        // live read on how much variance is left in the gene pool — losing it
        // costs the view its most useful signal.
        ghost: 0x74d7a0,
        ghostOpacity: 0.26,
        waypoint: 0x4cc2ff,
        waypointNext: 0xffd166,
        com: 0xff6b76
    }
};

// Mutated in place by setTheme so every existing reference stays valid.
const COLORS = Object.assign({}, THEMES.light);

class Renderer {
    constructor(canvas, model) {
        this.model = model;
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setClearColor(COLORS.sky);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(COLORS.sky);
        this.scene.fog = new THREE.Fog(COLORS.sky, COLORS.fogNear, COLORS.fogFar);
        this.theme = "light";

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);

        const amb = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, COLORS.hemiIntensity);
        this.hemi = amb;
        this.scene.add(amb);
        this.sun = new THREE.DirectionalLight(COLORS.sunColor, COLORS.sunIntensity);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        const sc = this.sun.shadow.camera;
        sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 32;
        this.scene.add(this.sun);
        this.scene.add(this.sun.target);

        /* ---- shared geometry ----
         * Every doll part is one of a handful of unit primitives scaled into
         * place, so the whole swarm — 40 ghosts deep — costs three geometries
         * plus one per distinct taper ratio. `_geo` caches those by ratio. */
        this.cube = new THREE.BoxGeometry(1, 1, 1);
        this.sphere = new THREE.SphereGeometry(1, 14, 10);
        this._geoCache = Object.create(null);
        this.skin = typeof buildSkin === "function" ? buildSkin(model) : null;

        this.matLeader = new THREE.MeshLambertMaterial({ color: COLORS.leader });
        this.matJoint = new THREE.MeshLambertMaterial({ color: COLORS.joint });
        this.matCollar = new THREE.MeshLambertMaterial({ color: COLORS.collar });
        this.matGhost = new THREE.MeshLambertMaterial({ color: COLORS.ghost, transparent: true, opacity: 0.16, depthWrite: false });

        this.dolls = [];
        this._terrainKey = null;
        this._camTarget = new THREE.Vector3(0, 0.9, 0);
        this._comBuf = new Float64Array(6);
        this.orbit = { yaw: 2.35, pitch: 0.28, dist: 6.4 };
        this._initTerrain();
        this._initMarkers();
        this._bindMouse();
    }

    /* Switch environment. Materials are created once and reused, so changing
     * the palette alone would repaint nothing already on screen — every live
     * material, light and the fog have to be walked and updated by hand. The
     * ghost swarm is rebuilt lazily per walker, so its shared material is
     * updated here and the per-doll meshes inherit it. */
    setTheme(name) {
        const t = THEMES[name] || THEMES.light;
        Object.assign(COLORS, t);
        this.theme = THEMES[name] ? name : "light";

        this.renderer.setClearColor(t.sky);
        this.scene.background = new THREE.Color(t.sky);
        this.scene.fog.color.setHex(t.sky);
        this.scene.fog.near = t.fogNear;
        this.scene.fog.far = t.fogFar;

        this.hemi.color.setHex(t.hemiSky);
        this.hemi.groundColor.setHex(t.hemiGround);
        this.hemi.intensity = t.hemiIntensity;
        this.sun.color.setHex(t.sunColor);
        this.sun.intensity = t.sunIntensity;

        if (this.ground) this.ground.material.color.setHex(t.ground);
        if (this.grid) {
            // GridHelper bakes its two colours into vertex colours at
            // construction, so recolouring the material tints nothing. Rebuild.
            this.scene.remove(this.grid);
            this.grid.geometry.dispose();
            this.grid.material.dispose();
            const g = new THREE.GridHelper(this.terrainSize, this.terrainSize, t.groundLine, t.groundLine);
            g.material.opacity = 0.5;
            g.material.transparent = true;
            g.position.copy(this.grid.position);
            g.visible = this.grid.visible;
            this.grid = g;
            this.scene.add(g);
        }
        // The draped grid uses a plain material, so unlike GridHelper it really
        // can just be recoloured.
        if (this.gridDrape) this.gridDrape.material.color.setHex(t.groundLine);

        this.matLeader.color.setHex(t.leader);
        this.matJoint.color.setHex(t.joint);
        this.matCollar.color.setHex(t.collar);
        this.matGhost.color.setHex(t.ghost);
        this.matGhost.opacity = t.ghostOpacity;
        if (this.comDot) this.comDot.material.color.setHex(t.com);
        // The frame loop already repaints these from COLORS every tick, so this
        // only matters while paused — which is exactly when someone flips the
        // theme and expects the markers to follow.
        for (const g of (this.wpPool || [])) {
            if (g.userData && g.userData.mat) g.userData.mat.color.setHex(t.waypoint);
        }
        return this.theme;
    }

    /* --------------------------------------------------------------- terrain */
    _initTerrain() {
        this.terrainSize = 44;
        /* 132 segments over 44 m is a 33 cm cell, and a stair tread is 34 cm —
         * the render mesh was sampling the staircase at almost exactly one point
         * per step, so risers aliased into a vague ramp and anything drawn on
         * the TRUE height field appeared to sink into the ground wherever the
         * tessellation cut a corner. (That was found via the old LiDAR hit dots,
         * which traced the field exactly — measured 0.00 mm error — so the mesh
         * was provably the one at fault. The sensor is gone; the mismatch it
         * exposed is a property of the mesh and is still worth the vertices.)
         * Measured mean |mesh - true| over the height field:
         *
         *            cell     stairs    mixed    rolling
         *     132   33.3 cm   24.8 mm   19.9 mm   0.1 mm
         *     264   16.7 cm   11.6 mm    9.3 mm   0.0 mm
         *     440   10.0 cm    5.6 mm    4.4 mm   0.0 mm
         *
         * Rolling was never the problem — it is smooth and the mesh already
         * matched it exactly. 264 halves the stair error for 4x the vertices
         * (17k -> 70k), which is affordable because the mesh is only re-sampled
         * when the leader has walked a metre or two, not per frame. The residual
         * worst case (~70 mm, at a riser) is irreducible by subdivision: a
         * vertical step is a discontinuity, and linear interpolation always
         * ramps it across one cell however small that cell is. */
        this.terrainSeg = 264;
        const g = new THREE.PlaneGeometry(this.terrainSize, this.terrainSize, this.terrainSeg, this.terrainSeg);
        g.rotateX(-Math.PI / 2);
        this.groundGeo = g;
        this.ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: COLORS.ground }));
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);
        this.grid = new THREE.GridHelper(this.terrainSize, this.terrainSize, COLORS.groundLine, COLORS.groundLine);
        this.grid.material.opacity = 0.5;
        this.grid.material.transparent = true;
        this.scene.add(this.grid);

        /* A grid DRAPED over the height field.
         *
         * The flat GridHelper above is only honest on flat ground, and it was
         * hidden everywhere else — which left rolling and stairs as untextured
         * Lambert-shaded surfaces where a 9-degree slope and a 15 cm riser look
         * almost identical, especially head-on. A grid that follows the surface
         * is the cheapest possible contour map: the spacing of the lines reads
         * as gradient, and a stair tread shows up as a run of lines bunching at
         * the riser.
         *
         * Sampled from the same height function as the mesh, every GRID_EVERY-th
         * vertex, so the lines sit exactly on the surface they describe rather
         * than on an independent approximation of it. */
        this.GRID_EVERY = 6;                       // 44/264*6 = 1.00 m spacing
        const n = this.terrainSeg + 1;
        const lines = Math.floor((n - 1) / this.GRID_EVERY) + 1;
        // Two directions, each `lines` polylines of n points, as segment pairs.
        const segs = 2 * lines * (n - 1) * 2;
        const dg = new THREE.BufferGeometry();
        dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs * 3), 3));
        this.gridDrapeGeo = dg;
        this.gridDrape = new THREE.LineSegments(dg, new THREE.LineBasicMaterial({
            color: COLORS.groundLine, transparent: true, opacity: 0.28
        }));
        this.gridDrape.frustumCulled = false;
        this.scene.add(this.gridDrape);
        this._groundOrigin = [1e9, 1e9];
    }

    /* Rebuild the draped grid from the height field. Called only when the ground
     * mesh itself is re-sampled, which is every couple of metres of walking. */
    _updateGridDrape(terrain, ox, oz) {
        const n = this.terrainSeg + 1, half = this.terrainSize / 2;
        const step = this.terrainSize / this.terrainSeg;
        const arr = this.gridDrapeGeo.attributes.position.array;
        // Lifted clear of the surface by a hair, so the lines are not stitched
        // into it by depth-buffer precision at grazing camera angles.
        const LIFT = 0.012;
        let k = 0;
        const put = (x, z) => { arr[k++] = x; arr[k++] = terrain.height(x + ox, z + oz) + LIFT; arr[k++] = z; };
        for (let i = 0; i < n; i += this.GRID_EVERY) {
            const c = -half + i * step;
            for (let j = 0; j < n - 1; j++) {
                const a = -half + j * step, b = a + step;
                put(a, c); put(b, c);          // line running along x
                put(c, a); put(c, b);          // line running along z
            }
        }
        // Anything unwritten (the last partial row) collapses to a zero-length
        // segment at the origin rather than being left as stale geometry.
        while (k < arr.length) arr[k++] = 0;
        this.gridDrapeGeo.attributes.position.needsUpdate = true;
        this.gridDrape.position.set(ox, 0, oz);
    }

    /* Re-sample the height field around the leader. Cheap enough to redo when
     * the leader has wandered a couple of metres, which is far less often than
     * every frame. */
    _updateTerrain(terrain, cx, cz, force) {
        const step = this.terrainSize / this.terrainSeg;
        const ox = Math.round(cx / step) * step, oz = Math.round(cz / step) * step;
        if (!force && Math.abs(ox - this._groundOrigin[0]) < 1.5 && Math.abs(oz - this._groundOrigin[1]) < 1.5) return;
        this._groundOrigin = [ox, oz];
        const pos = this.groundGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i) + ox, z = pos.getZ(i) + oz;
            pos.setY(i, terrain.height(x, z));
        }
        pos.needsUpdate = true;
        this.groundGeo.computeVertexNormals();
        this.ground.position.set(ox, 0, oz);
        this.grid.position.set(ox, 0.004, oz);
        /* Flat ground keeps the cheap GridHelper; everything with relief gets the
         * draped one. Never both — two grids at slightly different heights moire
         * against each other. */
        const flat = terrain.id === "flat";
        this.grid.visible = flat;
        this.gridDrape.visible = !flat;
        if (!flat) this._updateGridDrape(terrain, ox, oz);
    }

    /* --------------------------------------------------------------- markers */
    _initMarkers() {
        this.wpGroup = new THREE.Group();
        this.scene.add(this.wpGroup);
        this.wpPool = [];
        const ringGeo = new THREE.TorusGeometry(0.55, 0.035, 8, 28);
        ringGeo.rotateX(-Math.PI / 2);
        const poleGeo = new THREE.CylinderGeometry(0.022, 0.022, 1.1, 8);
        for (let i = 0; i < 6; i++) {
            const g = new THREE.Group();
            const mat = new THREE.MeshLambertMaterial({ color: COLORS.waypoint, transparent: true, opacity: 0.85 });
            const ring = new THREE.Mesh(ringGeo, mat);
            ring.position.y = 0.02;
            const pole = new THREE.Mesh(poleGeo, mat);
            pole.position.y = 0.55;
            g.add(ring); g.add(pole);
            g.userData.mat = mat;
            this.wpGroup.add(g);
            this.wpPool.push(g);
        }
        // ground projection of the leader's centre of mass — the single most
        // informative dot on the screen: while it stays inside the feet, the
        // walker is stable; the instant it leaves, the walker is falling.
        const comGeo = new THREE.SphereGeometry(0.045, 12, 10);
        this.comDot = new THREE.Mesh(comGeo, new THREE.MeshBasicMaterial({ color: COLORS.com }));
        this.scene.add(this.comDot);
    }

    /* ----------------------------------------------------------------- dolls */

    /* A unit tapered cylinder: radius 1 at y = -0.5, `ratio` at y = +0.5,
     * height 1. Cached per ratio, so the whole doll shares a handful. */
    _tubeGeo(ratio, seg) {
        const key = "t" + ratio.toFixed(3) + "_" + seg;
        let g = this._geoCache[key];
        if (!g) { g = new THREE.CylinderGeometry(ratio, 1, 1, seg, 1, false); this._geoCache[key] = g; }
        return g;
    }

    /* Aim a unit tube from `a` to `b` and squash its cross-section.
     *
     * The two transverse scales depend on which way the tube points, because
     * the rotation that aims it also carries the cross-section around with it.
     * Every part is axis-aligned in its own link frame (see skin.js), so this
     * is six exact cases rather than a general quaternion — and being exact is
     * what lets a chest be 0.113 x 0.149 instead of round. */
    _placeTube(m, p) {
        const a = p.a, b = p.b;
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        let tA, tB;
        if (ay >= ax && ay >= az) {
            // local +Y -> world +/-Y; local x,z stay on world x,z
            if (dy < 0) m.rotation.set(0, 0, Math.PI);
            tA = p.sx; tB = p.sz;
        } else if (ax >= az) {
            // local +Y -> world +/-X, local +X -> world -/+Y
            m.rotation.set(0, 0, dx > 0 ? -Math.PI / 2 : Math.PI / 2);
            tA = p.sy; tB = p.sz;
        } else {
            // local +Y -> world +/-Z, local +Z -> world -/+Y
            m.rotation.set(dz > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0);
            tA = p.sx; tB = p.sy;
        }
        m.position.set((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
        m.scale.set(p.r0 * tA, Math.hypot(dx, dy, dz), p.r0 * tB);
    }

    /* One skin part -> one or more meshes on `link`. A drum is three: the dark
     * housing and a pale bearing collar at each end. */
    _addPart(link, p, mat, ghost) {
        const push = (geo, material) => {
            const m = new THREE.Mesh(geo, material);
            m.castShadow = !ghost;
            link.add(m);
            return m;
        };
        if (p.k === "box") {
            const m = push(this.cube, mat);
            m.position.set(p.c[0], p.c[1], p.c[2]);
            m.scale.set(p.d[0], p.d[1], p.d[2]);
        } else if (p.k === "ball") {
            const m = push(this.sphere, p.dark && !ghost ? this.matJoint : mat);
            m.position.set(p.c[0], p.c[1], p.c[2]);
            m.scale.set(p.r * p.sx, p.r * p.sy, p.r * p.sz);
        } else if (p.k === "tube") {
            const m = push(this._tubeGeo(p.r1 / p.r0, 14), p.dark && !ghost ? this.matJoint : mat);
            this._placeTube(m, p);
        } else if (p.k === "drum") {
            const h = [0, 0, 0], t = [0, 0, 0];
            h[p.axis] = -p.len * 0.5; t[p.axis] = p.len * 0.5;
            const span = (from, to, r) => ({ a: from, b: to, r0: r, r1: r, sx: 1, sy: 1, sz: 1 });
            this._placeTube(push(this._tubeGeo(1, 16), this.matJoint), span(h, t, p.r));
            /* Collars are bands AROUND the housing, set back from its ends —
             * not caps over them. Two earlier arrangements were worse: flush
             * caps put a collar's end face exactly coplanar with the drum's and
             * z-fought into a pinwheel, and proud caps then made every knee a
             * solid white disc when viewed down its own axis, which is the
             * commonest angle on a walking doll. Set back, the outermost face
             * is the dark drum and the collar reads as a ring behind it. Both
             * cap planes sit strictly inside the housing, so nothing is
             * coplanar with anything. */
            for (const s of [-1, 1]) {
                const c0 = [0, 0, 0], c1 = [0, 0, 0];
                c0[p.axis] = s * p.len * 0.46;
                c1[p.axis] = s * p.len * 0.26;
                this._placeTube(push(this._tubeGeo(1, 16), this.matCollar), span(c0, c1, p.r * 1.07));
            }
        }
    }

    _makeDoll(ghost) {
        const g = new THREE.Group();
        g.matrixAutoUpdate = false;
        const mat = ghost ? this.matGhost : this.matLeader;
        const links = [];
        for (let i = 0; i < this.model.bodies.length; i++) {
            const b = this.model.bodies[i];
            const link = new THREE.Group();
            link.matrixAutoUpdate = false;
            /* The skin replaces the collision boxes for drawing only. If it is
             * ever missing a link — a body added to body.js and not here — fall
             * back to that link's boxes so a limb can go ugly but never
             * invisible. */
            const skinned = (this.skin && this.skin.parts[i]) || [];
            if (skinned.length) {
                for (const p of skinned) {
                    if (ghost && !p.core) continue;
                    this._addPart(link, p, mat, ghost);
                }
            } else {
                for (const box of (b.boxes || [])) this._addPart(link, { k: "box", c: box.c, d: box.d }, mat, ghost);
            }
            g.add(link);
            links.push(link);
        }
        g.userData.links = links;
        g.userData.ghost = ghost;
        this.scene.add(g);
        return g;
    }

    _ensureDolls(n) {
        while (this.dolls.length < n) this.dolls.push(this._makeDoll(this.dolls.length > 0));
        for (let i = 0; i < this.dolls.length; i++) this.dolls[i].visible = i < n;
    }

    _applyPose(doll, mb) {
        const links = doll.userData.links;
        for (let i = 0; i < links.length; i++) {
            const R = mb.R, P = mb.P, r = i * 9, p = i * 3;
            links[i].matrix.set(
                R[r], R[r + 1], R[r + 2], P[p],
                R[r + 3], R[r + 4], R[r + 5], P[p + 1],
                R[r + 6], R[r + 7], R[r + 8], P[p + 2],
                0, 0, 0, 1
            );
        }
    }

    /* ------------------------------------------------------------------ mouse */
    _bindMouse() {
        const c = this.canvas;
        let drag = null;
        c.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
        c.addEventListener("pointerup", e => { drag = null; c.releasePointerCapture(e.pointerId); });
        c.addEventListener("pointermove", e => {
            if (!drag) return;
            this.orbit.yaw -= (e.clientX - drag.x) * 0.007;
            this.orbit.pitch = Math.max(-0.25, Math.min(1.35, this.orbit.pitch + (e.clientY - drag.y) * 0.005));
            drag = { x: e.clientX, y: e.clientY };
        });
        c.addEventListener("wheel", e => {
            e.preventDefault();
            this.orbit.dist = Math.max(1.6, Math.min(30, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.12)));
        }, { passive: false });
    }

    resize() {
        const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /* ----------------------------------------------------------------- frame */
    frame(world, cfg) {
        if (!world) return;
        const walkers = world.walkers;
        const leader = walkers[world.leaderIdx] || walkers[0];

        // which walkers get drawn: the leader always, plus the next best few
        const ghosts = Math.max(0, Math.min(cfg.ghosts | 0, walkers.length - 1));
        const order = walkers.slice().sort((a, b) => b.fitness() - a.fitness()).slice(0, ghosts + 1);
        if (order[0] !== leader) { order.splice(order.indexOf(leader), 1); order.unshift(leader); }
        this._ensureDolls(order.length);
        for (let i = 0; i < order.length; i++) this._applyPose(this.dolls[i], order[i].mb);

        const lp = leader.mb.bp;
        this._updateTerrain(world.terrain, lp[0], lp[2], this._terrainKey !== world.terrain);
        this._terrainKey = world.terrain;

        // waypoints
        const first = leader.legIdx;
        for (let i = 0; i < this.wpPool.length; i++) {
            const g = this.wpPool[i];
            const p = world.points[first + i];
            if (!p || !cfg.showWaypoints) { g.visible = false; continue; }
            g.visible = true;
            g.position.set(p.x, world.terrain.height(p.x, p.z), p.z);
            g.userData.mat.color.setHex(i === 0 ? COLORS.waypointNext : COLORS.waypoint);
            g.userData.mat.opacity = i === 0 ? 0.95 : Math.max(0.12, 0.6 - i * 0.12);
        }

        // centre-of-mass ground projection
        if (cfg.showCom) {
            const com = this._comBuf;
            leader.mb.comState(com);
            this.comDot.visible = true;
            this.comDot.position.set(com[0], world.terrain.height(com[0], com[2]) + 0.03, com[2]);
        } else this.comDot.visible = false;

        // Camera: orbit a point at chest height above the ground under the
        // leader — not the leader's pelvis, which sinks to the floor the moment
        // it falls and drags the whole view down with it.
        const tx = lp[0], tz = lp[2];
        const ty = world.terrain.height(tx, tz) + 0.85;
        this._camTarget.x += (tx - this._camTarget.x) * 0.12;
        this._camTarget.y += (ty - this._camTarget.y) * 0.12;
        this._camTarget.z += (tz - this._camTarget.z) * 0.12;
        const o = this.orbit;
        this.camera.position.set(
            this._camTarget.x + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist,
            this._camTarget.y + Math.sin(o.pitch) * o.dist,
            this._camTarget.z + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist
        );
        this.camera.lookAt(this._camTarget);
        this.sun.position.set(this._camTarget.x + 6, this._camTarget.y + 11, this._camTarget.z + 5);
        this.sun.target.position.copy(this._camTarget);
        this.sun.target.updateMatrixWorld();

        this.renderer.render(this.scene, this.camera);
    }
}
