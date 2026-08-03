/* render.js — the three.js view.
 *
 * Everything drawn is read straight out of the station state. The arm's links
 * are placed from the same forward kinematics the sensing uses, and the balls
 * are at the coordinates the physics put them at. Nothing is interpolated or
 * faked: if it looks wrong on screen, the simulation is wrong.
 *
 * The population is laid out as a grid of separate benches, because unlike the
 * boats and the walker these agents do NOT share a world — each arm gets its
 * own identical table (see world.js on common random numbers). Drawing them
 * overlapping would be a lie about what is being simulated.
 */
"use strict";

/* The bench has to read as a SURFACE, not as balls floating in space. That means
 * the table cannot be the same value as the floor behind it — the first version
 * had table 0xf2f4f7 on floor 0xe9edf1, three steps apart, and the screenshot
 * showed coloured spheres hovering over nothing with a few black sticks. The
 * table is now the lightest thing in the light scene and the floor is pushed
 * down and slightly cooler, so the slab separates on value alone and does not
 * need an outline to be legible at thumbnail size. */
const THEMES = {
    light: {
        /* Surface albedos assume the light budget below sums to about 1.05 on an
         * upward-facing face. The first version ran hemi 0.85 + sun 0.75 against
         * a 0xfafbfc table, which is 1.6x on near-white: the table, the floor
         * and the sky all clipped to pure 0xffffff and the whole bench looked
         * like objects floating in a void. Nothing here is "the light colour" or
         * "the material colour" on its own — it is the product that has to land
         * below 1.0, and these two blocks have to be changed together. */
        sky: 0xdbe3ec, floor: 0xb0bdcb, grid: 0x93a2b3,
        table: 0xe2e9f0, tableEdge: 0x7f8fa1, leg: 0x768393,
        hemiSky: 0xffffff, hemiGround: 0xb0bcc8, hemiIntensity: 0.55,
        sunColor: 0xffffff, sunIntensity: 0.50,
        fillColor: 0xcfe0f2, fillIntensity: 0.22,
        fogNear: 4.5, fogFar: 16,
        link: 0x51637a, joint: 0x2c3a4c, collar: 0xc7d2dd, base: 0x3c4a5e,
        jaw: 0xafbcca, pad: 0x39465a,
        leaderRing: 0x3bbf72, focusRing: 0x1f9de0,
        bucketOpacity: 0.55, shadow: 0.26, spec: 0x2a3444
    },
    dark: {
        sky: 0x0f1319, floor: 0x151b23, grid: 0x28313d,
        table: 0x2b3644, tableEdge: 0x0e131a, leg: 0x1d2530,
        hemiSky: 0x9fb2c9, hemiGround: 0x141a22, hemiIntensity: 0.48,
        sunColor: 0xdce8ff, sunIntensity: 0.50,
        fillColor: 0x35506e, fillIntensity: 0.26,
        fogNear: 4.5, fogFar: 16,
        // Lifted off the light-theme values: 0x46566b against a 0x0f1319 sky
        // reads as a hole punched through the scene rather than a metal link.
        link: 0x76899f, joint: 0x44566d, collar: 0xb4c3d2, base: 0x53667e,
        jaw: 0x9dabbb, pad: 0x2b3644,
        leaderRing: 0x5fe08a, focusRing: 0x4cc2ff,
        // a 0.45 wall over a dark table is invisible — the buckets became four
        // floating rims. Translucency has to be read against what is BEHIND it.
        bucketOpacity: 0.72, shadow: 0.34, spec: 0x8fa3bd
    }
};

const BENCH = { dx: 1.35, dz: 1.25 };

/* Link and joint sizes taper from shoulder to hand. A manipulator whose every
 * segment is the same 36 mm tube reads as three sticks and a lump; the taper is
 * what makes it read as an arm at a glance. Index 0 = upper arm. */
const LINK_R = [[0.018, 0.023], [0.0145, 0.018], [0.0115, 0.0145]];  // [far end, near end]
const JOINT_R = [0.017, 0.015, 0.013];
const COLLAR_R = [0.027, 0.023, 0.019];

/* Scratch for setBasis — allocated once, because this runs per joint per bench
 * per frame. */
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _bh = new THREE.Vector3(), _bm = new THREE.Matrix4();

/* Orient a mesh so its local +Y lies along `yAxis`, using `xHint` to pin the
 * roll. This replaces a `lookAt` that pointed straight down — which is exactly
 * the degenerate case for lookAt's implicit (0,1,0) up vector, and is why the
 * gripper used to render as two flat plates at arbitrary angles. */
function setBasis(obj, xHint, yAxis) {
    _by.set(yAxis.x, yAxis.y, yAxis.z).normalize();
    _bh.set(xHint.x, xHint.y, xHint.z);
    _bz.crossVectors(_bh, _by);
    if (_bz.lengthSq() < 1e-9) _bz.set(0, 0, 1).cross(_by);
    _bz.normalize();
    _bx.crossVectors(_by, _bz).normalize();
    _bm.makeBasis(_bx, _by, _bz);
    obj.quaternion.setFromRotationMatrix(_bm);
}

class Renderer {
    constructor(canvas, theme) {
        this.canvas = canvas;
        this.themeName = theme || "light";
        this.theme = THEMES[this.themeName];

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60);

        this.orbit = { yaw: -0.5, pitch: 0.62, dist: 1.9, target: new THREE.Vector3(0, 0.1, 0) };
        this.benches = [];
        this.focus = 0;
        this.gridCols = 1;

        this._buildEnvironment();
        const G = THREE;
        this._geo = {
            ball: new G.SphereGeometry(BALL_R, 20, 14),
            shadow: new G.CircleGeometry(1, 18),
            link: LINK_R.map(r => new G.CylinderGeometry(r[0], r[1], 1, 16)),
            joint: JOINT_R.map(r => new G.SphereGeometry(r, 14, 10)),
            collar: COLLAR_R.map(r => new G.CylinderGeometry(r, r, r * 1.5, 18)),
            // gripper: a housing around the wrist axis, a palm plate, two
            // fingers running along the approach vector, and two rubber pads
            housing: new G.CylinderGeometry(0.019, 0.022, 0.05, 16),
            palm: new G.BoxGeometry(0.058, 0.016, 0.034),
            finger: new G.BoxGeometry(0.011, 0.058, 0.026),
            pad: new G.BoxGeometry(0.008, 0.024, 0.024),
            plate: new G.CylinderGeometry(0.060, 0.068, 0.011, 24),
            column: new G.CylinderGeometry(0.034, 0.046, 1, 20),
            turret: new G.CylinderGeometry(0.038, 0.038, 0.028, 20)
        };
        this._mat = {};
        this._rebuildMaterials();
        this.resize();
        this._bindInput();
    }

    _rebuildMaterials() {
        const t = this.theme;
        const M = (c, opts) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, opts || {}));
        // the arm is the only thing in the scene that should read as machined
        // metal, so it is the only thing that gets a specular highlight
        const P = (c, sh) => new THREE.MeshPhongMaterial({ color: c, shininess: sh, specular: t.spec });
        this._mat.link = P(t.link, 26);
        this._mat.joint = P(t.joint, 34);
        this._mat.collar = P(t.collar, 44);
        this._mat.base = P(t.base, 20);
        this._mat.leg = M(t.leg);
        this._mat.jaw = P(t.jaw, 40);
        this._mat.pad = M(t.pad);
        this._mat.table = M(t.table);
        this._mat.tableEdge = M(t.tableEdge);
        this._mat.shadow = new THREE.MeshBasicMaterial({
            color: 0x000000, transparent: true, opacity: t.shadow, depthWrite: false
        });
        this._mat.ball = COLOR_HEX.map(c => new THREE.MeshPhongMaterial({
            color: c, shininess: 70, specular: 0x555555
        }));
        this._mat.bucket = COLOR_HEX.map(c => new THREE.MeshLambertMaterial({
            color: c, transparent: true, opacity: t.bucketOpacity, side: THREE.DoubleSide
        }));
        // solid rim ring: a translucent open cylinder alone reads as a smear of
        // colour, and the rim is what makes it read as a container with a mouth
        this._mat.bucketRim = COLOR_HEX.map(c => M(c));
    }

    _buildEnvironment() {
        const t = this.theme;
        this.scene.background = new THREE.Color(t.sky);
        this.scene.fog = new THREE.Fog(t.sky, t.fogNear, t.fogFar);

        this.hemi = new THREE.HemisphereLight(t.hemiSky, t.hemiGround, t.hemiIntensity);
        this.scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(t.sunColor, t.sunIntensity);
        this.sun.position.set(2.2, 4, 1.6);
        this.scene.add(this.sun);
        // a cool fill from the opposite side keeps the shadowed face of every
        // link off pure black and gives the cylinders a readable roll
        this.fill = new THREE.DirectionalLight(t.fillColor, t.fillIntensity);
        this.fill.position.set(-2.6, 1.4, -2.0);
        this.scene.add(this.fill);

        this.floor = new THREE.Mesh(
            new THREE.PlaneGeometry(60, 60),
            new THREE.MeshLambertMaterial({ color: t.floor })
        );
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.y = -0.45;
        this.scene.add(this.floor);

        this.grid = new THREE.GridHelper(40, 80, t.grid, t.grid);
        this.grid.position.y = -0.449;
        this.grid.material.opacity = 0.35;
        this.grid.material.transparent = true;
        this.scene.add(this.grid);

        this.root = new THREE.Group();
        this.scene.add(this.root);
    }

    setTheme(name) {
        this.themeName = name;
        this.theme = THEMES[name];
        const t = this.theme;
        this.scene.background.set(t.sky);
        this.scene.fog.color.set(t.sky);
        this.scene.fog.near = t.fogNear; this.scene.fog.far = t.fogFar;
        this.hemi.color.set(t.hemiSky); this.hemi.groundColor.set(t.hemiGround);
        this.hemi.intensity = t.hemiIntensity;
        this.sun.color.set(t.sunColor); this.sun.intensity = t.sunIntensity;
        this.fill.color.set(t.fillColor); this.fill.intensity = t.fillIntensity;
        this.floor.material.color.set(t.floor);
        this.grid.material.color.set(t.grid);
        for (const k of ["link", "joint", "collar", "base", "leg", "jaw", "pad", "table", "tableEdge"]) {
            this._mat[k].color.set(t[k]);
            if (this._mat[k].specular) this._mat[k].specular.set(t.spec);
        }
        this._mat.shadow.opacity = t.shadow;
        this._mat.bucket.forEach(m => { m.opacity = t.bucketOpacity; });
    }

    /* ------------------------------------------------------------- benches */
    _makeBench() {
        const g = new THREE.Group();
        const t = this.theme;

        // table slab, with a thin darker apron so the surface has an edge
        const w = TABLE.x1 - TABLE.x0, d = TABLE.z1 - TABLE.z0;
        const cx = (TABLE.x0 + TABLE.x1) / 2, cz = (TABLE.z0 + TABLE.z1) / 2;
        const apron = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, d), this._mat.tableEdge);
        apron.position.set(cx, -0.030, cz);
        g.add(apron);
        const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.014, d), this._mat.table);
        slab.position.set(cx, -0.007, cz);
        g.add(slab);
        const legGeo = new THREE.BoxGeometry(0.022, 0.40, 0.022);
        for (const sx of [TABLE.x0 + 0.05, TABLE.x1 - 0.05])
            for (const sz of [TABLE.z0 + 0.05, TABLE.z1 - 0.05]) {
                const leg = new THREE.Mesh(legGeo, this._mat.leg);
                leg.position.set(sx, -0.248, sz);
                g.add(leg);
            }

        // buckets — a translucent wall, a solid floor, and a solid rim
        g.userData.buckets = [];
        for (let i = 0; i < BUCKET.xs.length; i++) {
            const b = new THREE.Mesh(
                new THREE.CylinderGeometry(BUCKET.r, BUCKET.r * 0.82, BUCKET.rim, 24, 1, true),
                this._mat.bucket[i]
            );
            b.position.set(BUCKET.xs[i], BUCKET.rim / 2, BUCKET.z);
            g.add(b);
            const base = new THREE.Mesh(
                new THREE.CircleGeometry(BUCKET.r * 0.82, 24), this._mat.bucketRim[i]
            );
            base.rotation.x = -Math.PI / 2;
            base.position.set(BUCKET.xs[i], 0.004, BUCKET.z);
            g.add(base);
            const rim = new THREE.Mesh(
                new THREE.TorusGeometry(BUCKET.r, 0.0065, 8, 26), this._mat.bucketRim[i]
            );
            rim.rotation.x = -Math.PI / 2;
            rim.position.set(BUCKET.xs[i], BUCKET.rim, BUCKET.z);
            g.add(rim);
            g.userData.buckets.push(b);
        }

        // arm
        const arm = new THREE.Group();
        const plate = new THREE.Mesh(this._geo.plate, this._mat.base);
        plate.position.set(ARM.base.x, 0.006, ARM.base.z);
        arm.add(plate);
        const column = new THREE.Mesh(this._geo.column, this._mat.base);
        column.scale.set(1, ARM.pedestal - 0.012, 1);
        column.position.set(ARM.base.x, 0.012 + (ARM.pedestal - 0.012) / 2, ARM.base.z);
        arm.add(column);
        const turret = new THREE.Mesh(this._geo.turret, this._mat.base);
        turret.position.set(ARM.base.x, ARM.pedestal - 0.014, ARM.base.z);
        arm.add(turret);

        const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); arm.add(m); return m; };
        arm.userData.links = this._geo.link.map(gm => mk(gm, this._mat.link));
        arm.userData.joints = this._geo.joint.map(gm => mk(gm, this._mat.joint));
        arm.userData.collars = this._geo.collar.map(gm => mk(gm, this._mat.collar));
        arm.userData.housing = mk(this._geo.housing, this._mat.jaw);
        arm.userData.palm = mk(this._geo.palm, this._mat.jaw);
        arm.userData.fingers = [mk(this._geo.finger, this._mat.jaw), mk(this._geo.finger, this._mat.jaw)];
        arm.userData.pads = [mk(this._geo.pad, this._mat.pad), mk(this._geo.pad, this._mat.pad)];
        g.add(arm);
        g.userData.arm = arm;

        // A contact shadow under the hand. Depth is the hard thing to read in a
        // single fixed projection, and this is what tells you whether the
        // gripper is over the ball or a hand's width behind it.
        // each shadow owns its material because the opacity is a per-object
        // function of height
        const hs = new THREE.Mesh(this._geo.shadow, this._mat.shadow.clone());
        hs.rotation.x = -Math.PI / 2;
        hs.renderOrder = 1;
        g.add(hs);
        g.userData.handShadow = hs;

        // ball pool — grown on demand, hidden when unused
        g.userData.balls = [];
        g.userData.ballShadows = [];

        // status ring under the bench (leader / focus highlight)
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.44, 0.5, 32),
            new THREE.MeshBasicMaterial({ color: t.focusRing, transparent: true, opacity: 0.0, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(0, -0.44, 0);
        g.add(ring);
        g.userData.ring = ring;

        this.root.add(g);
        return g;
    }

    _ensureBenches(n) {
        while (this.benches.length < n) this.benches.push(this._makeBench());
        for (let i = 0; i < this.benches.length; i++) this.benches[i].visible = i < n;
    }

    layout(n) {
        const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
        this.gridCols = cols;
        const rows = Math.ceil(n / cols);
        for (let i = 0; i < n; i++) {
            const c = i % cols, r = (i / cols) | 0;
            this.benches[i].position.set(
                (c - (cols - 1) / 2) * BENCH.dx, 0, (r - (rows - 1) / 2) * BENCH.dz
            );
        }
        this._span = { cols, rows };
    }

    /* --------------------------------------------------------------- draw */
    draw(stations, opts) {
        opts = opts || {};
        const show = Math.min(stations.length, opts.maxBenches || 12);
        this._ensureBenches(show);
        if (this._lastShow !== show) { this.layout(show); this._lastShow = show; }

        for (let i = 0; i < show; i++) {
            const s = stations[i], g = this.benches[i];
            this._drawArm(g, s);
            this._drawBalls(g, s);
            const isFocus = i === this.focus;
            const isLeader = i === (opts.leader === undefined ? -1 : opts.leader);
            // the ring exists to pick one bench out of a grid; in solo view it
            // is a metre-wide arc across the foreground identifying the only
            // bench on screen
            g.userData.ring.material.opacity = opts.soloView ? 0.0
                : (isFocus ? 0.85 : (isLeader ? 0.55 : 0.0));
            g.userData.ring.material.color.set(isFocus ? this.theme.focusRing : this.theme.leaderRing);
        }
        this._updateCamera(opts.soloView ? this.benches[Math.min(this.focus, show - 1)] : null);
        this.renderer.render(this.scene, this.camera);
    }

    /* Lay a contact shadow on the table under a point. It shrinks and fades with
     * height, which is the cue that reads as "this is 20 cm up" rather than
     * "this is 20 cm further back". */
    _shadow(mesh, p, radius) {
        const h = Math.max(0, p.y);
        const k = 1 / (1 + h * 4);
        mesh.visible = h < 0.45 && p.x > TABLE.x0 && p.x < TABLE.x1 && p.z > TABLE.z0 && p.z < TABLE.z1;
        if (!mesh.visible) return;
        mesh.position.set(p.x, 0.0016, p.z);
        const s = radius * (0.45 + 0.55 * k);
        mesh.scale.set(s, s, 1);
        // fades quadratically, so it is a contact cue at the table and almost
        // gone by the top of the carry — a shadow that stays solid at height
        // reads as a second object lying on the bench
        mesh.material.opacity = this.theme.shadow * k * k;
    }

    _drawArm(g, s) {
        const arm = g.userData.arm;
        const f = s.arm.fk();
        const pts = [f.shoulder, f.elbow, f.wrist, f.tip];
        const L = arm.userData.links, J = arm.userData.joints, C = arm.userData.collars;
        // the joint axis of every revolute joint above the base is horizontal and
        // perpendicular to the reach plane
        const axis = { x: -f.radial.z, y: 0, z: f.radial.x };

        for (let i = 0; i < 3; i++) {
            const a = pts[i], b = pts[i + 1];
            const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
            const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
            const len = dir.length();
            L[i].position.copy(mid);
            L[i].scale.set(1, len, 1);
            L[i].quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
            J[i].position.set(a.x, a.y, a.z);
            C[i].position.set(a.x, a.y, a.z);
            setBasis(C[i], { x: 0, y: 1, z: 0 }, axis);
        }

        /* The hand. Fingers run along the approach vector and open along the
         * horizontal perpendicular to the reach plane, which is the same axis
         * the physics closes them on. `grasp` sits at ARM.graspOffset past the
         * tip, so the fingers have to straddle it — if they visibly did not,
         * the picture would be lying about where a ball gets captured. */
        const ap = s.arm.aperture();
        const half = 0.010 + ap * (ARM.jawHalf - 0.010);
        const app = f.approach, tip = f.tip;
        const at = (dist) => ({
            x: tip.x + app.x * dist, y: tip.y + app.y * dist, z: tip.z + app.z * dist
        });
        const side = (p, s2) => ({ x: p.x + axis.x * s2, y: p.y, z: p.z + axis.z * s2 });

        const housing = arm.userData.housing;
        housing.position.copy(at(-0.004));
        setBasis(housing, axis, app);
        const palm = arm.userData.palm;
        palm.position.copy(at(0.028));
        setBasis(palm, axis, app);

        const fingerMid = at(0.064);
        arm.userData.fingers.forEach((m, k) => {
            const p = side(fingerMid, k === 0 ? half : -half);
            m.position.set(p.x, p.y, p.z);
            setBasis(m, axis, app);
        });
        const padMid = at(0.082);
        arm.userData.pads.forEach((m, k) => {
            const p = side(padMid, (k === 0 ? 1 : -1) * (half - 0.007));
            m.position.set(p.x, p.y, p.z);
            setBasis(m, axis, app);
        });

        this._shadow(g.userData.handShadow, f.grasp, 0.042);
    }

    _drawBalls(g, s) {
        const pool = g.userData.balls, shadows = g.userData.ballShadows;
        while (pool.length < s.balls.length) {
            const m = new THREE.Mesh(this._geo.ball, this._mat.ball[0]);
            g.add(m); pool.push(m);
            const sh = new THREE.Mesh(this._geo.shadow, this._mat.shadow.clone());
            sh.rotation.x = -Math.PI / 2;
            sh.renderOrder = 1;
            g.add(sh); shadows.push(sh);
        }
        for (let i = 0; i < pool.length; i++) {
            const b = s.balls[i];
            if (!b || b.lost) { pool[i].visible = false; shadows[i].visible = false; continue; }
            pool[i].visible = true;
            pool[i].material = this._mat.ball[b.color];
            pool[i].position.set(b.x, b.y, b.z);
            if (b.inBucket >= 0) shadows[i].visible = false;
            else this._shadow(shadows[i], b, BALL_R * 1.05);
        }
    }

    /* -------------------------------------------------------------- camera */
    _updateCamera(soloBench) {
        const o = this.orbit;
        let cx = 0, cz = 0, dist = o.dist;
        if (soloBench) {
            cx = soloBench.position.x; cz = soloBench.position.z;
        } else if (this._span) {
            dist = o.dist * Math.max(1, Math.max(this._span.cols * BENCH.dx, this._span.rows * BENCH.dz) / 1.1);
        }
        // aim a little above the table and a little behind its centre: the
        // buckets are at the back, and framing on the bench origin buried them
        // under the arm
        const target = new THREE.Vector3(cx, 0.11, cz - 0.03);
        this.camera.position.set(
            cx + Math.sin(o.yaw) * Math.cos(o.pitch) * dist,
            target.y + Math.sin(o.pitch) * dist,
            cz - 0.03 + Math.cos(o.yaw) * Math.cos(o.pitch) * dist
        );
        this.camera.lookAt(target);
    }

    resize() {
        const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    _bindInput() {
        const c = this.canvas;
        let drag = null;
        c.addEventListener("pointerdown", e => {
            drag = { x: e.clientX, y: e.clientY };
            c.setPointerCapture(e.pointerId);
        });
        c.addEventListener("pointermove", e => {
            if (!drag) return;
            this.orbit.yaw -= (e.clientX - drag.x) * 0.006;
            this.orbit.pitch = Math.max(0.08, Math.min(1.45, this.orbit.pitch + (e.clientY - drag.y) * 0.005));
            drag = { x: e.clientX, y: e.clientY };
        });
        const stop = () => { drag = null; };
        c.addEventListener("pointerup", stop);
        c.addEventListener("pointercancel", stop);
        c.addEventListener("wheel", e => {
            e.preventDefault();
            // the near limit used to be 0.7, which put the camera inside the
            // gripper — a whole bench is 1.1 m across, so 0.95 is already tight
            this.orbit.dist = Math.max(0.95, Math.min(6, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.12)));
        }, { passive: false });
    }
}
