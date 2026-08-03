/* render.js — the three.js view. Playback only; nothing here drives the sim.
 *
 * EVERYTHING IS DRAWN IN LVLH, with the station at the origin and the Earth
 * where the orbit says it is. That is the frame the whole problem lives in and
 * it is the one that makes the counter-intuitive part visible: fire forward and
 * you watch yourself rise and fall behind.
 *
 * TWO SCENES, ONE CAMERA ROTATION. The Earth is 6,371 km across and sits 6,791
 * km away; the vehicle is 4 m long and sometimes 2 m away. Putting both in one
 * depth buffer gives you a choice between an Earth that z-fights itself and a
 * spacecraft that disappears into the near plane. So the Earth and the stars
 * are drawn first into their own scene, at their own scale, through a camera
 * that shares the main camera's ORIENTATION but sits at the origin — which is
 * exactly right, because at these distances the Earth's appearance depends on
 * which way you are looking and not at all on where you are. Then the depth
 * buffer is cleared and the real scene is drawn on top.
 *
 * THE MAIN CAMERA'S NEAR AND FAR PLANES ARE RECOMPUTED EVERY FRAME from its
 * distance to what it is looking at. A fixed pair cannot span 1 m to 150 km:
 * near=0.1/far=200000 is a depth-buffer ratio of two million and the station
 * shimmers. Tying them to the current distance keeps the ratio at 1e6 or better
 * at every scale.
 */
"use strict";

const COL = {
    space: 0x05070d,
    hull: 0xd8dee8,
    hullDark: 0x7c8798,
    array: 0x1b2f5a,
    arrayEdge: 0x4a6ea8,
    radiator: 0xb9c2cf,
    port: 0x4fe0a8,
    portRing: 0x2a8f68,
    chaser: 0xe8edf4,
    chaserTrim: 0x35b6ff,
    plume: 0xffc14d,
    plumeRcs: 0x8fd8ff,
    trail: 0x35b6ff,
    trailGhost: 0x2c4560,
    laser: 0xff5f6b,
    corridor: 0x4fe0a8,
    marker: 0xffc94d,
    earth: 0x1b4a8f,
    earthLand: 0x2f6b45,
    earthLimb: 0x6fb4ff
};

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setClearColor(COL.space);
        this.renderer.autoClear = false;

        this.scene = new THREE.Scene();
        this.bg = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1000);
        this.bgCam = new THREE.PerspectiveCamera(52, 1, 1, 60000);

        /* Space is brutally lit — one light source and no atmosphere to fill
         * the shadows — but a faithfully unlit capsule is a black blob against
         * a black sky, which is accurate and useless. The ambient and
         * hemisphere terms stand in for earthshine and the station's own albedo,
         * both of which are real and neither of which is this strong. */
        this.scene.add(new THREE.AmbientLight(0x2f3a48, 1.0));
        this.sun = new THREE.DirectionalLight(0xfff4e0, 1.55);
        this.sun.position.set(0.5, 0.7, -0.5).multiplyScalar(1000);
        this.scene.add(this.sun);
        this.scene.add(new THREE.HemisphereLight(0x33526f, 0x121a24, 0.75));

        this.view = "orbit";          // orbit | station | cockpit
        this.orbit = { yaw: 2.5, pitch: 0.35, dist: 22 };
        this._drag = null;
        this._bindInput();

        this._buildSky();
        this._buildEarth();
        this._buildStation();
        this._buildChaser();
        this._buildAids();

        this._tmp = new THREE.Vector3();
        this._q = new THREE.Quaternion();
    }

    /* ------------------------------------------------------------- input */
    _bindInput() {
        const c = this.canvas;
        const down = (e) => {
            if (this.view !== "orbit") return;
            this._drag = { x: e.clientX, y: e.clientY };
            c.style.cursor = "grabbing";
        };
        const move = (e) => {
            if (!this._drag) return;
            this.orbit.yaw -= (e.clientX - this._drag.x) * 0.008;
            this.orbit.pitch += (e.clientY - this._drag.y) * 0.008;
            this.orbit.pitch = Math.max(-1.45, Math.min(1.45, this.orbit.pitch));
            this._drag = { x: e.clientX, y: e.clientY };
        };
        const up = () => { this._drag = null; c.style.cursor = ""; };
        c.addEventListener("pointerdown", down);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        c.addEventListener("wheel", (e) => {
            e.preventDefault();
            // Multiplicative zoom over five decades of range: a fixed step is
            // either useless at 40 km or unusable at 4 m.
            this.orbit.dist *= Math.exp(e.deltaY * 0.0013);
            this.orbit.dist = Math.max(4, Math.min(400000, this.orbit.dist));
        }, { passive: false });
        c.addEventListener("dblclick", () => { this.orbit.dist = 22; });
    }

    setView(v) {
        this.view = v;
        if (v === "orbit") this.orbit.dist = Math.max(8, Math.min(this.orbit.dist, 200));
    }

    /* --------------------------------------------------------------- sky */
    _buildSky() {
        const N = 1600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
        let s = 12345;
        const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        for (let i = 0; i < N; i++) {
            // Uniform on the sphere: acos of a uniform, not a uniform angle —
            // otherwise the stars bunch at the poles.
            const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
            pos[i * 3] = r * Math.cos(th) * 40000;
            pos[i * 3 + 1] = r * Math.sin(th) * 40000;
            pos[i * 3 + 2] = u * 40000;
            const b = 0.35 + rnd() * 0.65;
            col[i * 3] = b; col[i * 3 + 1] = b * (0.92 + rnd() * 0.08); col[i * 3 + 2] = b;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        /* The star field is held on its own group so it can be rotated into
         * LVLH every frame. Stars are fixed in INERTIAL space, so in the
         * station-centred frame they wheel round once per orbit exactly as the
         * ground does. Leaving them pinned to the camera frame gives a sky that
         * stands still over a planet that moves, which reads as a bug even to
         * someone who could not say why. */
        this.starGrp = new THREE.Group();
        this.starGrp.add(new THREE.Points(g, new THREE.PointsMaterial({
            size: 170, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9
        })));
        this.bg.add(this.starGrp);
    }

    /* ------------------------------------------------------------- Earth */
    _buildEarth() {
        const tex = buildEarthTextures();
        const R = EARTH.radius;
        this.earthMat = earthMaterial(tex);
        this.earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 84), this.earthMat);
        this.bg.add(this.earth);

        this.cloudMat = cloudMaterial(tex);
        this.clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.004, 96, 64), this.cloudMat);
        this.bg.add(this.clouds);

        this.atmoMat = atmosphereMaterial();
        this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.028, 64, 44), this.atmoMat);
        this.bg.add(this.atmo);

        // A visible Sun, far outside the Earth's shell, plus a soft corona. It
        // is the only thing in frame that tells you where the light is coming
        // from when the Earth is out of shot.
        this.sunDisc = new THREE.Mesh(
            new THREE.SphereGeometry(150, 24, 16),
            new THREE.MeshBasicMaterial({ color: 0xfff6dd })
        );
        this.bg.add(this.sunDisc);
        this.sunGlow = new THREE.Mesh(
            new THREE.SphereGeometry(520, 24, 16),
            new THREE.MeshBasicMaterial({
                color: 0xffd98a, transparent: true, opacity: 0.16,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
            })
        );
        this.bg.add(this.sunGlow);
    }


    /* ---------------------------------------------------- shared textures */
    /* Procedural, drawn once into canvases. The point is not photorealism, it
     * is SCALE CUES: a hull with panel seams and a solar wing with visible
     * cells tell you how big the thing is and how far away it is, which a flat
     * grey box cannot do at any distance. */
    _makeTextures() {
        const panel = document.createElement("canvas");
        panel.width = 512; panel.height = 512;
        let x = panel.getContext("2d");
        x.fillStyle = "#e6eaf0"; x.fillRect(0, 0, 512, 512);
        // Micrometeoroid-blanket quilting: a soft grid plus a little mottling.
        x.strokeStyle = "rgba(120,133,150,0.55)"; x.lineWidth = 2;
        for (let i = 0; i <= 8; i++) {
            const p = i * 64 + 0.5;
            x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 512); x.stroke();
            x.beginPath(); x.moveTo(0, p); x.lineTo(512, p); x.stroke();
        }
        let sd = 7;
        const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
        for (let i = 0; i < 900; i++) {
            x.fillStyle = `rgba(${140 + rnd() * 90 | 0},${150 + rnd() * 90 | 0},${165 + rnd() * 85 | 0},${0.05 + rnd() * 0.12})`;
            x.fillRect(rnd() * 512, rnd() * 512, 6 + rnd() * 40, 6 + rnd() * 40);
        }
        // A few darker service panels and handrails.
        for (let i = 0; i < 22; i++) {
            x.fillStyle = `rgba(96,110,128,${0.25 + rnd() * 0.35})`;
            x.fillRect(rnd() * 480, rnd() * 480, 16 + rnd() * 46, 10 + rnd() * 26);
        }
        const cells = document.createElement("canvas");
        cells.width = 256; cells.height = 256;
        x = cells.getContext("2d");
        x.fillStyle = "#16305e"; x.fillRect(0, 0, 256, 256);
        for (let j = 0; j < 16; j++) {
            for (let i = 0; i < 16; i++) {
                const v = 0.72 + ((i * 7 + j * 13) % 5) * 0.05;
                x.fillStyle = `rgb(${(22 * v) | 0},${(52 * v) | 0},${(112 * v) | 0})`;
                x.fillRect(i * 16 + 1.5, j * 16 + 1.5, 13, 13);
                // Bus bars — the thin bright lines that make a panel read as
                // photovoltaic rather than as blue paint.
                x.fillStyle = "rgba(150,178,220,0.35)";
                x.fillRect(i * 16 + 1.5, j * 16 + 6, 13, 1);
                x.fillRect(i * 16 + 1.5, j * 16 + 11, 13, 1);
            }
        }
        const gold = document.createElement("canvas");
        gold.width = 128; gold.height = 128;
        x = gold.getContext("2d");
        x.fillStyle = "#c9a martin"; x.fillStyle = "#caa14e"; x.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 260; i++) {
            x.fillStyle = `rgba(${210 + rnd() * 45 | 0},${175 + rnd() * 55 | 0},${90 + rnd() * 60 | 0},${0.15 + rnd() * 0.4})`;
            x.fillRect(rnd() * 128, rnd() * 128, 2 + rnd() * 22, 2 + rnd() * 12);
        }
        const T = (cv, rx, ry) => {
            const t = new THREE.CanvasTexture(cv);
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(rx || 1, ry || 1);
            t.anisotropy = 4;
            return t;
        };
        this.tex = {
            hull: T(panel, 6, 2),
            hullSmall: T(panel, 2, 1),
            cells: T(cells, 10, 3),
            gold: T(gold, 3, 2)
        };
    }

    /* ----------------------------------------------------------- station */
    _buildStation() {
        this._makeTextures();
        this.stationGrp = new THREE.Group();
        this.scene.add(this.stationGrp);
        const G = this.stationGrp;

        const hullMat = new THREE.MeshStandardMaterial({
            color: 0xf0f3f7, map: this.tex.hull, roughness: 0.62, metalness: 0.16
        });
        const hullMat2 = new THREE.MeshStandardMaterial({
            color: 0xe8ecf2, map: this.tex.hullSmall, roughness: 0.62, metalness: 0.16
        });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x7d8794, roughness: 0.7, metalness: 0.35 });
        const goldMat = new THREE.MeshStandardMaterial({
            color: 0xd8b25e, map: this.tex.gold, roughness: 0.42, metalness: 0.75
        });
        const cellMat = new THREE.MeshStandardMaterial({
            color: 0x9fb4d8, map: this.tex.cells, roughness: 0.28, metalness: 0.55,
            side: THREE.DoubleSide
        });
        const radMat = new THREE.MeshStandardMaterial({
            color: 0xf2f5f8, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide
        });

        const add = (mesh, pos, rot) => {
            if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
            if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
            G.add(mesh);
            return mesh;
        };
        // Cylinders default to their axis along Y; the station's long axis is X.
        const RZ = [0, 0, -Math.PI / 2];

        /* Core module. A pressurised cylinder, not a box — and with ribs, so
         * that a 30 m module reads as 30 m instead of as an unscaled slab. */
        add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 30, 32), hullMat), [0, 0, 0], RZ);
        for (let i = -3; i <= 3; i++) {
            add(new THREE.Mesh(new THREE.TorusGeometry(2.26, 0.10, 8, 32), darkMat), [i * 4.2, 0, 0], [0, Math.PI / 2, 0]);
        }
        // End caps.
        add(new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 12, 0, 6.3, 0, Math.PI / 2), hullMat2), [15, 0, 0], [0, 0, -Math.PI / 2]);
        add(new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 12, 0, 6.3, 0, Math.PI / 2), hullMat2), [-15, 0, 0], [0, 0, Math.PI / 2]);

        /* THE DOCKING ADAPTER, which is the piece that was missing.
         *
         * The port sits at x = 16.4 and the core ends at x = 15.0. Nothing
         * joined them, so the ring and its little cone floated 1.4 m off the
         * end of the station looking like a detached prop. This tapered adapter
         * spans the gap. It is visual only — the collision model in station.js
         * deliberately excludes the port neck, because arriving at it is the
         * goal and the capture test owns that contact. */
        add(new THREE.Mesh(new THREE.CylinderGeometry(1.25, 2.05, 1.15, 28), hullMat2), [15.55, 0, 0], RZ);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.25, 0.55, 28), darkMat), [16.4, 0, 0], RZ);
        add(new THREE.Mesh(new THREE.TorusGeometry(2.08, 0.09, 8, 32), darkMat), [15.0, 0, 0], [0, Math.PI / 2, 0]);

        /* Node module, hanging below the core on the nadir side. */
        add(new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 7.0, 26), hullMat2), [-6, 0, 5.5], [0, 0, 0]);
        add(new THREE.Mesh(new THREE.SphereGeometry(2.0, 22, 12), hullMat2), [-6, 0, 8.9]);
        add(new THREE.Mesh(new THREE.TorusGeometry(2.06, 0.09, 8, 28), darkMat), [-6, 0, 6.6], [Math.PI / 2, 0, 0]);
        // A short gold-foil equipment bay, for colour.
        add(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.2, 20), goldMat), [-11.5, 0, 0], RZ);

        /* Truss and solar wings. The boom is what makes the arrays look
         * attached to something rather than floating alongside. */
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 84, 12), darkMat), [0, 0, 0], [0, 0, 0]);
        for (const s of [1, -1]) {
            for (let k = 0; k < 20; k++) {
                const y = s * (4 + k * 2.0);
                add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.055, 5, 10), darkMat), [0, y, 0], [Math.PI / 2, 0, 0]);
            }
            // Two wings a side, on a rotary joint.
            for (const off of [-8.5, 8.5]) {
                add(new THREE.Mesh(new THREE.BoxGeometry(15.4, 16.6, 0.14), cellMat), [off, s * 24, 0]);
                add(new THREE.Mesh(new THREE.BoxGeometry(15.9, 0.30, 0.34), darkMat), [off, s * 24 - 8.3, 0]);
                add(new THREE.Mesh(new THREE.BoxGeometry(15.9, 0.30, 0.34), darkMat), [off, s * 24 + 8.3, 0]);
                add(new THREE.Mesh(new THREE.BoxGeometry(0.30, 16.8, 0.34), darkMat), [off - 7.7, s * 24, 0]);
                add(new THREE.Mesh(new THREE.BoxGeometry(0.30, 16.8, 0.34), darkMat), [off + 7.7, s * 24, 0]);
            }
            add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 16), goldMat), [0, s * 7, 0]);
        }
        // Radiators, edge-on white panels aft.
        for (const s of [1, -1]) {
            add(new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.10, 9.6), radMat), [-12, s * 3.2, -7]);
            add(new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.24, 0.24), darkMat), [-12, s * 3.2, -11.8]);
        }

        /* ---- the docking port itself ---- */
        this.portGrp = new THREE.Group();
        G.add(this.portGrp);
        // Soft-capture ring.
        this.portGrp.add(new THREE.Mesh(
            new THREE.TorusGeometry(0.80, 0.10, 12, 40),
            new THREE.MeshStandardMaterial({ color: COL.portRing, roughness: 0.35, metalness: 0.6 })
        ));
        // The tunnel behind it, so the port is a hole and not a disc.
        const tun = new THREE.Mesh(
            new THREE.CylinderGeometry(0.78, 0.62, 1.0, 26, 1, true),
            new THREE.MeshStandardMaterial({ color: 0x59636f, side: THREE.DoubleSide, roughness: 0.8 })
        );
        tun.rotation.x = Math.PI / 2; tun.position.z = -0.52;
        this.portGrp.add(tun);
        const back = new THREE.Mesh(
            new THREE.CircleGeometry(0.62, 26),
            new THREE.MeshStandardMaterial({ color: 0x2b333d, roughness: 0.9 })
        );
        back.position.z = -1.02;
        this.portGrp.add(back);
        // Alignment petals — four tabs on the ring, which is what a real
        // soft-capture mechanism presents to the incoming probe.
        for (let k = 0; k < 4; k++) {
            const a = k * Math.PI / 2 + Math.PI / 4;
            const petal = new THREE.Mesh(
                new THREE.BoxGeometry(0.30, 0.10, 0.34),
                new THREE.MeshStandardMaterial({ color: 0x9fb0c2, roughness: 0.5, metalness: 0.5 })
            );
            petal.position.set(Math.cos(a) * 0.80, Math.sin(a) * 0.80, 0.16);
            petal.rotation.z = a;
            this.portGrp.add(petal);
        }
        // The five retroreflectors, drawn where the sensor model reads them.
        this.reflectorDots = [];
        for (let i = 0; i < 5; i++) {
            const d = new THREE.Mesh(
                new THREE.SphereGeometry(0.075, 10, 8),
                new THREE.MeshBasicMaterial({ color: COL.port })
            );
            this.portGrp.add(d);
            this.reflectorDots.push(d);
        }
    }

    /* ------------------------------------------------------------ chaser */
    _buildChaser() {
        this.chaser = new THREE.Group();
        this.scene.add(this.chaser);
        const C = this.chaser;

        const skin = new THREE.MeshStandardMaterial({
            color: 0xf2f5f9, map: this.tex.hullSmall, roughness: 0.45, metalness: 0.30
        });
        const dark = new THREE.MeshStandardMaterial({ color: 0x59636f, roughness: 0.65, metalness: 0.45 });
        const trim = new THREE.MeshStandardMaterial({ color: 0x35b6ff, roughness: 0.4, metalness: 0.4 });
        const glass = new THREE.MeshStandardMaterial({ color: 0x0e2233, roughness: 0.12, metalness: 0.9 });
        const RZ = [0, 0, -Math.PI / 2];
        const add = (m, pos, rot) => {
            if (pos) m.position.set(pos[0], pos[1], pos[2]);
            if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
            C.add(m); return m;
        };

        /* Capsule: a conical pressure vessel with a service trunk behind it and
         * a docking adapter on the nose, which is the Dragon layout. */
        add(new THREE.Mesh(new THREE.CylinderGeometry(1.20, 1.85, 3.0, 28), skin), [0.35, 0, 0], RZ);
        add(new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 0.35, 28), dark), [-1.25, 0, 0], RZ);
        // Trunk / service section aft.
        add(new THREE.Mesh(new THREE.CylinderGeometry(1.78, 1.78, 1.5, 28), new THREE.MeshStandardMaterial({
            color: 0x2a3442, roughness: 0.7, metalness: 0.3
        })), [-2.2, 0, 0], RZ);
        add(new THREE.Mesh(new THREE.TorusGeometry(1.80, 0.07, 8, 30), dark), [-1.45, 0, 0], [0, Math.PI / 2, 0]);

        /* Nose: shoulder, adapter collar, then the ring — and THE RING SITS
         * EXACTLY AT CRAFT.dockOffset.
         *
         * It was 0.75 m further forward, which put the capsule's own docking
         * hardware three quarters of a metre beyond the interface point the
         * physics uses. At contact the ring therefore drove straight through
         * the station's port and came to rest on the far side of it, so the
         * finished docking looked like the port had detached from the station
         * and stuck to the capsule. Everything forward of the pressure vessel
         * is now laid out backwards from dockOffset. */
        const D = CRAFT.dockOffset;
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.78, 1.20, 0.62, 28), skin), [D - 0.56, 0, 0], RZ);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.70, 0.78, 0.28, 26), dark), [D - 0.14, 0, 0], RZ);
        const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.075, 10, 32), trim),
            [D, 0, 0], [0, Math.PI / 2, 0]);
        this.dockRing = ring;
        // The probe tunnel, so the nose is a receptacle and not a plug.
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.45, 22, 1, true),
            new THREE.MeshStandardMaterial({ color: 0x39434f, side: THREE.DoubleSide, roughness: 0.85 })),
            [D - 0.24, 0, 0], RZ);

        // The laser head, beside the ring where the sensor model mounts it.
        add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.30, 0.24), dark),
            [LIDAR_MOUNT[0] - 0.10, 0.62, 0.30]);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.10, 14), glass),
            [LIDAR_MOUNT[0] + 0.08, 0.62, 0.30], RZ);

        // Windows, and a roll stripe so attitude is readable at a glance —
        // without it there is no way to see that the vehicle is 40° out of roll,
        // which is one of the six ways a docking fails.
        for (const a of [0.7, -0.7]) {
            add(new THREE.Mesh(new THREE.CircleGeometry(0.28, 18), glass),
                [1.15, Math.sin(a) * 1.28, Math.cos(a) * 1.28],
                [0, 0, 0]).lookAt(new THREE.Vector3(6, Math.sin(a) * 4, Math.cos(a) * 4));
        }
        add(new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.09, 0.30), trim), [0.5, 0, 1.66]);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.20), trim), [D - 0.60, 0, 0.96]);

        /* Thruster quads, drawn where the plumes come from. Four around the
         * waist for lateral control, two aft, two forward-canted for braking —
         * the −X nozzles visibly angled outboard, which is why braking is 9%
         * weaker than accelerating. */
        const quad = (pos, rot) => add(new THREE.Mesh(
            new THREE.CylinderGeometry(0.10, 0.16, 0.34, 10), dark), pos, rot);
        for (let k = 0; k < 4; k++) {
            const a = k * Math.PI / 2 + Math.PI / 4;
            quad([-0.35, Math.sin(a) * 1.76, Math.cos(a) * 1.76], [Math.PI / 2 - a, 0, 0]);
            quad([1.35, Math.sin(a) * 1.30, Math.cos(a) * 1.30], [Math.PI / 2 - a, 0, 0]);
        }
        for (const s of [1, -1]) {
            quad([-2.95, s * 0.9, 0], [0, 0, Math.PI / 2]);
            quad([-2.95, 0, s * 0.9], [0, 0, Math.PI / 2]);
            // Braking nozzles, canted 25° outboard.
            quad([D - 0.75, s * 1.12, 0], [0, 0, -Math.PI / 2 + s * 0.44]);
            quad([D - 0.75, 0, s * 1.12], [s * 0.44, 0, -Math.PI / 2]);
        }

        // Thruster plumes: six translation groups + three RCS couples.
        const plumeGeo = new THREE.ConeGeometry(0.24, 1.5, 10, 1, true);
        this.plumes = [];
        const dirs = [
            [[-1.9, 0, 0], [0, 0, -1]], [[2.0, 0, 0], [0, 0, 1]],
            [[0, -1.7, 0], [1, 0, 0]], [[0, 1.7, 0], [-1, 0, 0]],
            [[0, 0, -1.7], [0, 0, 0]], [[0, 0, 1.7], [0, 0, 0]]
        ];
        for (let i = 0; i < 6; i++) {
            const m = new THREE.Mesh(plumeGeo, new THREE.MeshBasicMaterial({
                color: COL.plume, transparent: true, opacity: 0.0,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
            }));
            this.chaser.add(m);
            this.plumes.push(m);
        }
        this._layoutPlumes();

        this.rcsPlumes = [];
        for (let i = 0; i < 6; i++) {
            const m = new THREE.Mesh(
                new THREE.ConeGeometry(0.11, 0.7, 8, 1, true),
                new THREE.MeshBasicMaterial({
                    color: COL.plumeRcs, transparent: true, opacity: 0,
                    blending: THREE.AdditiveBlending, depthWrite: false
                })
            );
            this.chaser.add(m);
            this.rcsPlumes.push(m);
        }
    }

    /* Plume k fires OPPOSITE to the thrust it produces: the +X group pushes the
     * vehicle forward by throwing propellant aft. Drawing them the other way
     * round is the single most common way one of these renders looks wrong to
     * anyone who has watched real footage. */
    _layoutPlumes() {
        const spec = [
            { pos: [-1.75, 0, 0], axis: [-1, 0, 0] },   // +X thrust, plume aft
            { pos: [1.75, 0.9, 0], axis: [1, 0, 0] },   // −X thrust (canted), plume forward
            { pos: [0, -1.55, 0], axis: [0, -1, 0] },   // +Y thrust
            { pos: [0, 1.55, 0], axis: [0, 1, 0] },
            { pos: [0, 0, -1.55], axis: [0, 0, -1] },   // +Z thrust
            { pos: [0, 0, 1.55], axis: [0, 0, 1] }
        ];
        const up = new THREE.Vector3(0, 1, 0);
        spec.forEach((s, i) => {
            const p = this.plumes[i];
            const a = new THREE.Vector3().fromArray(s.axis).normalize();
            p.position.set(s.pos[0] + a.x * 0.75, s.pos[1] + a.y * 0.75, s.pos[2] + a.z * 0.75);
            p.quaternion.setFromUnitVectors(up, a);
        });
        const rspec = [
            [[1.4, 0, 1.5], [0, 1, 0]], [[1.4, 0, -1.5], [0, -1, 0]],
            [[-1.4, 1.5, 0], [0, 0, 1]], [[-1.4, -1.5, 0], [0, 0, -1]],
            [[1.4, 1.5, 0], [0, 0, -1]], [[1.4, -1.5, 0], [0, 0, 1]]
        ];
        this._rspec = rspec;
    }

    /* --------------------------------------------------------------- aids */
    _buildAids() {
        /* Approach corridor: the cone the flight rules confine the last 200 m
         * to. Drawn as a translucent surface and NOTHING ELSE.
         *
         * It had an EdgesGeometry outline too, which on a 28-segment cone is 28
         * bright green lines radiating from a point — and that point is the
         * docking port, which is where the capsule is. From anywhere near the
         * end of an approach it looks exactly like a fan of laser beams firing
         * out of the vehicle in the wrong direction, and it completely buried
         * the five real laser returns it was sitting on top of. The corridor is
         * context, not an instrument; it should be barely there. */
        const h = 200, r = h * Math.tan(15 * Math.PI / 180);
        this.corridor = new THREE.Mesh(
            new THREE.ConeGeometry(r, h, 40, 1, true),
            /* ADDITIVE. A plain transparent surface DARKENS whatever is behind
             * it, so a 200 m cone seen edge-on painted a large grey-green wedge
             * across the sky and read as a rendering fault rather than as a
             * boundary. Additive can only ever brighten, which is what a volume
             * hint should do. */
            new THREE.MeshBasicMaterial({
                color: COL.corridor, transparent: true, opacity: 0.055,
                side: THREE.DoubleSide, depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        this.stationGrp.add(this.corridor);
        // A single ring at the corridor's mouth, so it reads as a boundary
        // rather than as a solid cone of gas.
        this.corridorRing = new THREE.Mesh(
            new THREE.TorusGeometry(r, 0.35, 6, 64),
            new THREE.MeshBasicMaterial({ color: COL.corridor, transparent: true, opacity: 0.35 })
        );
        this.stationGrp.add(this.corridorRing);

        // Relative-motion trail. Two of them: the path already flown, and a
        // faint ghost of the whole episode so the classic LVLH racetrack shape
        // is visible from the first frame.
        const mkTrail = (col, op, n) => {
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
            const l = new THREE.Line(g, new THREE.LineBasicMaterial({
                color: col, transparent: true, opacity: op
            }));
            l.frustumCulled = false;
            this.scene.add(l);
            return l;
        };
        this.trail = mkTrail(COL.trail, 0.9, 4000);
        this.ghost = mkTrail(COL.trailGhost, 0.55, 4000);

        /* Laser beams from the chaser's sensor to whichever reflectors it can
         * actually see this frame — the same visibility test the sensor itself
         * uses, so if a beam is not drawn the network is not getting that
         * return either.
         *
         * Drawn as thin CYLINDERS, not lines. `LineBasicMaterial.linewidth` is
         * silently ignored by every WebGL implementation, so a beam is always
         * exactly one pixel and disappears against the station's edges at any
         * distance worth looking from. A cylinder whose radius tracks the
         * camera distance stays a beam at 2 m and at 200 m. */
        this.lasers = [];
        const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
        for (let i = 0; i < 5; i++) {
            const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
                color: COL.laser, transparent: true, opacity: 0.30,
                blending: THREE.AdditiveBlending, depthWrite: false
            }));
            m.frustumCulled = false;
            this.scene.add(m);
            const dot = new THREE.Mesh(
                new THREE.SphereGeometry(1, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0xffd0d4, transparent: true, opacity: 0.95 })
            );
            this.scene.add(dot);
            this.lasers.push({ beam: m, dot });
        }
        // The sensor's field of view: a 25° half-angle cone off the nose,
        // clipped to a readable length. Outside it there are no returns at all,
        // which is why the vehicle has to learn to point before it can dock.
        this.fov = new THREE.Mesh(
            new THREE.ConeGeometry(Math.tan(LIDAR_FOV) * 60, 60, 32, 1, true),
            new THREE.MeshBasicMaterial({
                color: COL.laser, transparent: true, opacity: 0.05,
                side: THREE.DoubleSide, depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        this.scene.add(this.fov);

        // Far-away marker: at 100 km neither vessel is a pixel, so draw a
        // crosshair sprite at the station and one at the chaser.
        const mkMark = (col) => {
            const g = new THREE.BufferGeometry();
            const pts = [];
            for (const s of [[-1, 0, 0, 1, 0, 0], [0, -1, 0, 0, 1, 0], [0, 0, -1, 0, 0, 1]]) pts.push(...s);
            g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
            const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85 }));
            l.frustumCulled = false;
            this.scene.add(l);
            return l;
        };
        this.markStation = mkMark(COL.corridor);
        this.markChaser = mkMark(COL.marker);
    }

    /* -------------------------------------------------------------- draw */
    /* `f` is an interpolated playback frame; `world` supplies the static
     * scenario geometry (station attitude, port). */
    draw(f, ctx) {
        const stn = ctx.station;

        // Station attitude: its body axes expressed in LVLH, straight into a
        // three.js basis matrix. LVLH is (x along-track, y cross-track, z nadir)
        // and the scene uses the same axes, so nothing is remapped anywhere.
        const M = stn.bodyToLvlh();
        const m4 = new THREE.Matrix4().set(
            M[0][0], M[0][1], M[0][2], 0,
            M[1][0], M[1][1], M[1][2], 0,
            M[2][0], M[2][1], M[2][2], 0,
            0, 0, 0, 1);
        this.stationGrp.quaternion.setFromRotationMatrix(m4);

        const port = stn.port;
        this.portGrp.position.set(port.pos[0], port.pos[1], port.pos[2]);
        const pq = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1), new THREE.Vector3().fromArray(port.normal));
        this.portGrp.quaternion.copy(pq);
        stn.reflectors.forEach((r, i) => {
            const local = new THREE.Vector3(r[0] - port.pos[0], r[1] - port.pos[1], r[2] - port.pos[2])
                .applyQuaternion(pq.clone().invert());
            this.reflectorDots[i].position.copy(local);
        });
        // ConeGeometry's apex is at +height/2 on its own +Y, so mapping −Y onto
        // the port normal puts the apex ON the port and the mouth 200 m out.
        this.corridor.position.set(
            port.pos[0] + port.normal[0] * 100,
            port.pos[1] + port.normal[1] * 100,
            port.pos[2] + port.normal[2] * 100);
        this.corridor.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, -1, 0), new THREE.Vector3().fromArray(port.normal));
        this.corridorRing.position.set(
            port.pos[0] + port.normal[0] * 200,
            port.pos[1] + port.normal[1] * 200,
            port.pos[2] + port.normal[2] * 200);
        this.corridorRing.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1), new THREE.Vector3().fromArray(port.normal));

        // Chaser. The sim's quaternion is [w,x,y,z] and rotates BODY into ECI;
        // the scene is LVLH, so the body axes are converted through the LVLH
        // basis before being handed to three.js.
        this.chaser.position.set(f.p[0], f.p[1], f.p[2]);
        const bx = f.ax, by = f.ay, bz = f.az;
        const bm = new THREE.Matrix4().set(
            bx[0], by[0], bz[0], 0,
            bx[1], by[1], bz[1], 0,
            bx[2], by[2], bz[2], 0,
            0, 0, 0, 1);
        this.chaser.quaternion.setFromRotationMatrix(bm);

        for (let i = 0; i < 6; i++) {
            const d = f.f[i];
            this.plumes[i].material.opacity = d > 0 ? 0.25 + 0.6 * Math.min(1, d * 3) : 0;
            this.plumes[i].scale.setScalar(d > 0 ? 0.6 + 0.9 * Math.min(1, d * 3) : 0.001);
        }
        for (let k = 0; k < 3; k++) {
            const d = f.fr[k];
            const a = this.rcsPlumes[k * 2], b = this.rcsPlumes[k * 2 + 1];
            const on = Math.min(1, Math.abs(d) * 6);
            const spec = this._rspec;
            [a, b].forEach((p, j) => {
                const s = spec[k * 2 + j];
                const ax = new THREE.Vector3().fromArray(s[1]).multiplyScalar(d >= 0 ? 1 : -1);
                p.position.set(s[0][0] + ax.x * 0.35, s[0][1] + ax.y * 0.35, s[0][2] + ax.z * 0.35);
                p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax);
                p.material.opacity = on > 0.01 ? 0.5 * on : 0;
                p.scale.setScalar(on > 0.01 ? 0.7 + on * 0.6 : 0.001);
            });
        }

        this._updateLasers(f, ctx);
        this._updateCamera(f, ctx);

        // Markers only when the vessels are too small to see. `screenSize` is
        // the crosshair's world size chosen so it stays a constant few percent
        // of the frame at any zoom.
        const camDist = this.camera.position.distanceTo(this.chaser.position);
        const far = f.R > 400;
        const ms = Math.max(1, camDist * 0.035);
        this.markStation.visible = far; this.markChaser.visible = far;
        this.markStation.scale.setScalar(Math.max(1, this.camera.position.length() * 0.035));
        this.markChaser.position.copy(this.chaser.position);
        this.markChaser.scale.setScalar(ms);
        /* The corridor is only meaningful between about 15 m and 1 km. Beyond
         * that it is off screen; inside it, the camera is sitting INSIDE a
         * 200 m translucent cone, which just tints the whole frame green and
         * hides the one thing worth looking at. */
        this.corridor.visible = this.corridorRing.visible = f.R > 25 && f.R < 1200;

        this.render();
    }

    _updateLasers(f, ctx) {
        const stn = ctx.station;
        const refl = stn.reflectorsLvlh();
        const N = stn.portNormalLvlh();
        // The sensor is mounted 1.90 m up the body +X axis, beside the docking
        // ring — so the beams leave the NOSE, not the centre of mass.
        const mount = [
            f.p[0] + f.ax[0] * LIDAR_MOUNT[0],
            f.p[1] + f.ax[1] * LIDAR_MOUNT[0],
            f.p[2] + f.ax[2] * LIDAR_MOUNT[0]
        ];
        const camDist = Math.max(1, this.camera.position.distanceTo(
            new THREE.Vector3(mount[0], mount[1], mount[2])));
        // Thin. Five beams converging on a 0.6 m ring are nearly coincident at
        // 150 m, and with additive blending a generous radius turns them into
        // one saturated white bar across the screen.
        const rad = Math.max(0.008, camDist * 0.0007);
        const up = new THREE.Vector3(0, 1, 0);
        let any = false;
        for (let i = 0; i < 5; i++) {
            const los = V.sub(refl[i], mount);
            const d = V.len(los);
            const u = V.mul(los, 1 / Math.max(d, 1e-9));
            // Exactly the sensor's own visibility test — range, field of view,
            // and the corner cube's acceptance angle.
            const off = Math.acos(Math.max(-1, Math.min(1,
                u[0] * f.ax[0] + u[1] * f.ax[1] + u[2] * f.ax[2])));
            const ok = d <= LIDAR_RANGE && d > 0.05 && off <= LIDAR_FOV && -V.dot(u, N) > 0.15;
            const L = this.lasers[i];
            L.beam.visible = ok; L.dot.visible = ok;
            if (!ok) continue;
            any = true;
            L.beam.position.set(mount[0] + u[0] * d / 2, mount[1] + u[1] * d / 2, mount[2] + u[2] * d / 2);
            L.beam.quaternion.setFromUnitVectors(up, new THREE.Vector3(u[0], u[1], u[2]));
            L.beam.scale.set(rad, d, rad);
            // Fade with range. Five beams onto a 0.6 m ring are effectively
            // coincident from 200 m away, and five additive passes over the
            // same pixels saturate to a solid white bar across the frame.
            L.beam.material.opacity = 0.30 * Math.max(0.10, Math.min(1, 40 / d));
            L.dot.position.set(refl[i][0], refl[i][1], refl[i][2]);
            L.dot.scale.setScalar(rad * 2.4);
        }
        // Show the cone only while the vehicle is close enough for the laser to
        // matter and is not already locked on — once beams are drawn they say
        // everything the cone would.
        const showFov = f.R < 260 && f.R > 30 && !any;
        this.fov.visible = showFov;
        if (showFov) {
            const len = Math.min(60, Math.max(6, f.R));
            this.fov.scale.set(len / 60, len / 60, len / 60);
            this.fov.position.set(
                mount[0] + f.ax[0] * len / 2, mount[1] + f.ax[1] * len / 2, mount[2] + f.ax[2] * len / 2);
            this.fov.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, -1, 0), new THREE.Vector3(f.ax[0], f.ax[1], f.ax[2]));
        }
    }

    setTrail(points, upTo) {
        const put = (line, from, to) => {
            const a = line.geometry.attributes.position;
            const n = Math.min(a.count, to - from);
            for (let i = 0; i < n; i++) {
                const p = points[from + Math.floor(i * (to - from) / Math.max(1, n))];
                a.setXYZ(i, p[0], p[1], p[2]);
            }
            for (let i = n; i < a.count; i++) {
                const p = points[Math.max(0, to - 1)] || [0, 0, 0];
                a.setXYZ(i, p[0], p[1], p[2]);
            }
            a.needsUpdate = true;
        };
        put(this.ghost, 0, points.length);
        put(this.trail, 0, Math.max(2, upTo));
    }

    _updateCamera(f, ctx) {
        const stn = ctx.station;
        const P = stn.portPosLvlh(), N = stn.portNormalLvlh(), U = stn.portUpLvlh();
        const c = this.chaser.position;
        let target, dist;

        if (this.view === "station") {
            /* Mounted on the station beside the docking port, looking out along
             * the approach axis. This is the view that makes an off-axis
             * arrival obvious: the vehicle drifts off centre in frame.
             *
             * The mount has to clear the arriving vehicle, and by a real
             * margin. At 1.4 m out and 1.6 m to the zenith side the camera ends
             * up INSIDE the capsule at contact — the hull radius is 1.85 m —
             * and because the hull is single-sided it renders as nothing at
             * all, so the view showed an empty frame with the Earth in it and
             * looked for all the world like a broken camera. Set back behind
             * the port plane and well off to the side, it sees the last few
             * metres from outside. */
            const S = V.cross(N, U);
            const eye = [
                P[0] - N[0] * 2.5 + U[0] * 9.0 + S[0] * 3.0,
                P[1] - N[1] * 2.5 + U[1] * 9.0 + S[1] * 3.0,
                P[2] - N[2] * 2.5 + U[2] * 9.0 + S[2] * 3.0
            ];
            this.camera.position.set(eye[0], eye[1], eye[2]);
            this.camera.up.set(U[0], U[1], U[2]);
            this.camera.lookAt(c);
            dist = Math.max(3, this.camera.position.distanceTo(c));
        } else if (this.view === "cockpit") {
            /* From the nose, looking straight down the docking axis — what the
             * laser sees, more or less. */
            const eye = new THREE.Vector3(
                f.p[0] + f.ax[0] * 2.4, f.p[1] + f.ax[1] * 2.4, f.p[2] + f.ax[2] * 2.4);
            this.camera.position.copy(eye);
            this.camera.up.set(f.az[0], f.az[1], f.az[2]);
            this.camera.lookAt(
                eye.x + f.ax[0] * 100, eye.y + f.ax[1] * 100, eye.z + f.ax[2] * 100);
            dist = Math.max(20, f.R);
        } else {
            const o = this.orbit;
            const cp = Math.cos(o.pitch);
            this.camera.position.set(
                c.x + o.dist * cp * Math.cos(o.yaw),
                c.y + o.dist * cp * Math.sin(o.yaw),
                c.z + o.dist * Math.sin(o.pitch));
            this.camera.up.set(0, 0, -1);       // nadir is +z, so "up" is −z
            this.camera.lookAt(c);
            dist = o.dist;
        }

        // Depth range from the current scale. See the header.
        this.camera.near = Math.max(0.02, dist / 4000);
        this.camera.far = Math.max(2000, dist * 4000);
        this.camera.updateProjectionMatrix();

        /* The Sun is FIXED in inertial space, so in LVLH it swings all the way
         * round once per orbit. That is not decoration: it is why the vehicle
         * spends part of every 93-minute lap in the Earth's shadow with the
         * station lit only by earthshine, and it is the single cheapest cue
         * that what you are watching is happening in an orbit rather than in a
         * room. `sunDir` arrives already rotated into LVLH by main.js. */
        const sd = new THREE.Vector3().fromArray(ctx.sunDir || [1, 0, 0]).normalize();
        this.sun.position.copy(sd).multiplyScalar(10000);

        /* THE EARTH IS ORIENTED BY THE ORBIT, and this is what makes the scene
         * read as a spaceflight rather than a hover.
         *
         * In LVLH the Earth's centre never moves — it is 6,791 km straight down
         * for the whole mission. What moves is the ground, because the LVLH
         * frame turns once per orbit against inertial space. So the mesh gets
         * the rotation carrying Earth-fixed axes into LVLH: the inverse of the
         * LVLH basis, composed with the planet's own sidereal spin. The result
         * is a correct ground track at 7.66 km/s — coastlines and the
         * terminator sweep past underneath, once every 92.8 minutes. */
        const d = ctx.earthDist || 6791;
        const B = ctx.B;
        if (B) {
            const qB = Q.fromBasis(B.x, B.y, B.z);            // LVLH → ECI
            const qEci = Q.conj(qB);                          // ECI → LVLH
            const th = EARTH.spin * (ctx.tAbs || 0);
            const qSpin = Q.fromAxisAngle([0, 0, 1], th);     // Earth's own day
            const q = Q.mul(qEci, qSpin);
            // [w,x,y,z] → three.js (x,y,z,w).
            this._eq = this._eq || new THREE.Quaternion();
            this._eq.set(q[1], q[2], q[3], q[0]);
            this.earth.quaternion.copy(this._eq);
            this.clouds.quaternion.copy(this._eq);
            // The sky shares the ECI→LVLH rotation but not the Earth's own spin.
            this._sq = this._sq || new THREE.Quaternion();
            this._sq.set(qEci[1], qEci[2], qEci[3], qEci[0]);
            this.starGrp.quaternion.copy(this._sq);
            // Clouds drift a little against the surface, which is both true and
            // the cheapest way to stop the two spheres looking welded together.
            this.clouds.rotateZ(-0.00004 * (ctx.tAbs || 0));
        }
        for (const m of [this.earth, this.clouds, this.atmo]) m.position.set(0, 0, d);

        const cp = this.bgCam ? this.camera.position : null;
        this.earthMat.uniforms.sunDir.value.copy(sd);
        this.cloudMat.uniforms.sunDir.value.copy(sd);
        this.atmoMat.uniforms.sunDir.value.copy(sd);
        // The background camera sits at the origin looking along the main
        // camera's axis, so that — and not the main camera's position — is what
        // the specular and rim terms must be evaluated from.
        this.earthMat.uniforms.camPos.value.set(0, 0, 0);
        this.atmoMat.uniforms.camPos.value.set(0, 0, 0);

        this.sunDisc.position.copy(sd).multiplyScalar(30000);
        this.sunGlow.position.copy(this.sunDisc.position);
    }

    render() {
        this.bgCam.quaternion.copy(this.camera.quaternion);
        this.bgCam.up.copy(this.camera.up);
        this.bgCam.aspect = this.camera.aspect;
        this.bgCam.fov = this.camera.fov;
        this.bgCam.updateProjectionMatrix();
        this.renderer.clear();
        this.renderer.render(this.bg, this.bgCam);
        this.renderer.clearDepth();
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        if (!w || !h) return;
        // Cap the device pixel ratio: the Earth shell and the additive plumes
        // are fill-rate bound, and a 3× retina buffer costs more than every
        // other part of this page put together.
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }
}
