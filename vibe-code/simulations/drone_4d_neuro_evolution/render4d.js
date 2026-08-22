/* render4d.js — drawing a four-dimensional room on a two-dimensional screen.
 *
 * THE PROBLEM. You cannot show 4D. Every honest option throws something away,
 * and the dishonest options — colour-coding w, or drawing a "slice" and hoping
 * nobody notices it is a slice — make the drone look like it is cheating when
 * it is not, or like it is succeeding when it has not.
 *
 * WHAT THIS DOES. Split ℝ⁴ into two orthogonal 3-spaces that SHARE the vertical
 * and one horizontal axis, and draw both:
 *
 *      left view  →  span( ê_H , ŷ , ẑ )        ê_H = cosθ·x̂ + sinθ·ŵ
 *      right view →  span( ê_K , ŷ , ẑ )        ê_K = −sinθ·x̂ + cosθ·ŵ
 *
 * ê_H ⊥ ê_K, so between them the two pictures carry all four coordinates with
 * nothing hidden and nothing double-counted. At θ = 0 the left view is the
 * ordinary (x, y, z) room and the right view is (w, y, z) — the same room seen
 * "along the fourth direction". The drone is at the waypoint only when it is on
 * target in BOTH pictures, which is exactly the 4-ball condition and reads
 * immediately even to someone who has never thought about 4D.
 *
 * θ is a user control, and it is a real rotation of the projection basis in the
 * x–w plane, not a camera trick. Turning it continuously slides the "visible"
 * horizontal direction out of x and into w. The room stays a box under it,
 * exactly: projecting the hyperrectangle onto ê_H gives the interval
 * ±(HX·|cosθ| + HW·|sinθ|), so the outline is rescaled, never faked.
 *
 * THE AIRFRAME carries the fourth dimension too. Each rotor is drawn at the
 * projection of its true 4D position, pos + R·pᵢ, so as the drone rotates in a
 * plane the viewer cannot see, its silhouette visibly contracts and expands —
 * the same way a 3D object's shadow shortens as it turns. Rotors are then
 * tinted by their coordinate along the OTHER view's axis, so each picture also
 * hints at the depth it is itself missing.
 *
 * THE WAYPOINT is drawn twice in each view, and the second one is the whole
 * point. A dim wireframe sphere sits at the target's projected position with
 * the full arrival radius — that is where the waypoint is in this picture. A
 * bright solid sphere shows the exact CROSS-SECTION of the 4-ball at the
 * drone's own coordinate in the missing direction: radius √(R² − Δ²), which is
 * nothing at all when the drone is far away in the invisible axis and grows to
 * the full radius only when it is aligned. So "I am inside the dim sphere but
 * the bright one is tiny" is a picture of exactly the mistake a 3D-thinking
 * pilot would make, and the geometry is exact rather than illustrative.
 */
"use strict";

const VIEW_BG = 0x0b0e14;

/* The airframe is 0.4 m across in a 30 m room, which draws as a single pixel.
 * Every position used here is the drone's TRUE 4D position; only the offsets of
 * the rotors from the hub are magnified, so the silhouette still contracts and
 * expands honestly as the drone rotates through the invisible direction — it is
 * a scale model at the right place, not a fudged trajectory. Collision and
 * arrival use the real radii, which is why the hull can look close to a wall
 * without dying. */
const MODEL_SCALE = 13;
const PROP_R = 0.085;        // m, propeller radius — nearly touching at the corners
const DISC_SEGS = 22;
const BLADE_RPM = 26;        // visual only; real rotor speed is not simulated

/* Indexed triangle fan: centre vertex + rim, so an update rewrites SEGS+1
 * points rather than SEGS triangles. */
function makeDiscGeom(segs) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((segs + 1) * 3), 3));
    const idx = [];
    for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
    g.setIndex(idx);
    return g;
}

/* Place a unit cylinder (THREE builds them along +Y) so it spans from → to.
 *
 * The zero-length guard is not paranoia: an arm or motor can project to a point
 * when the drone turns so that the direction in question lies entirely along the
 * axis this view drops. Normalising that would divide by ~0 and put NaNs in the
 * matrix, and a single NaN silently removes the mesh from the frame. Hiding it
 * is the honest result — a degenerate projection genuinely has nothing to draw. */
const _cyA = new THREE.Vector3(), _cyB = new THREE.Vector3(), _cyQ = new THREE.Quaternion();
const _cyUp = new THREE.Vector3(0, 1, 0), _cyS = new THREE.Vector3();
function spanCylinder(mesh, from, to, radius) {
    _cyA.subVectors(to, from);
    const len = _cyA.length();
    if (!(len > 1e-6)) { mesh.visible = false; return; }
    mesh.visible = true;
    _cyB.copy(_cyA).divideScalar(len);
    _cyQ.setFromUnitVectors(_cyUp, _cyB);
    _cyS.set(radius, len, radius);
    mesh.matrix.compose(_cyB.copy(from).addScaledVector(_cyA, 0.5), _cyQ, _cyS);
}

function lerpColor(a, b, t) {
    return new THREE.Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}
const C_COLD = new THREE.Color(0x3ba7ff);   // negative in the hidden axis
const C_MID = new THREE.Color(0xe8edf5);
const C_WARM = new THREE.Color(0xff8a3d);   // positive in the hidden axis

class Projection {
    constructor(room, label) {
        this.label = label;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(VIEW_BG);
        this.scene.fog = new THREE.Fog(VIEW_BG, 45, 120);
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);

        this.scene.add(new THREE.HemisphereLight(0x9fbcd8, 0x1a1f2b, 1.15));
        const dl = new THREE.DirectionalLight(0xffffff, 0.75);
        dl.position.set(12, 26, 14);
        this.scene.add(dl);

        // ---- the room: floor grid + wireframe shell, rescaled by θ
        this.roomGroup = new THREE.Group();
        this.scene.add(this.roomGroup);
        const box = new THREE.BoxGeometry(1, 1, 1);
        this.shell = new THREE.LineSegments(
            new THREE.EdgesGeometry(box),
            new THREE.LineBasicMaterial({ color: 0x2f4059 }));
        this.roomGroup.add(this.shell);
        this.floor = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ color: 0x141a25, transparent: true, opacity: 0.85 }));
        this.floor.rotation.x = -Math.PI / 2;
        this.roomGroup.add(this.floor);
        this.grid = new THREE.GridHelper(1, 12, 0x2b3a52, 0x1d2735);
        this.roomGroup.add(this.grid);

        // ---- the drone.
        // The fuselage is a unit sphere driven by a matrix built from the
        // PROJECTED body axes, so it squashes and stretches exactly as an
        // orthographic shadow of the real 4D hull would — no normalising, or
        // that cue would be thrown away.
        this.drone = new THREE.Group();
        this.scene.add(this.drone);
        this.body = new THREE.Mesh(
            new THREE.SphereGeometry(1, 20, 14),
            new THREE.MeshLambertMaterial({ color: 0xc9d6e8 }));
        this.body.matrixAutoUpdate = false;
        this.drone.add(this.body);
        this.nose = new THREE.Mesh(
            new THREE.ConeGeometry(0.34, 1, 12),
            new THREE.MeshLambertMaterial({ color: 0x63d0ff }));
        this.nose.matrixAutoUpdate = false;
        this.drone.add(this.nose);

        this.arms = []; this.motors = [];
        this.discFan = []; this.discRing = []; this.blades = [];
        const armMat = new THREE.MeshLambertMaterial({ color: 0x8494ab });
        const cyl = new THREE.CylinderGeometry(1, 1, 1, 7);   // unit, re-oriented per frame
        for (let i = 0; i < 8; i++) {
            const arm = new THREE.Mesh(cyl, armMat);
            arm.matrixAutoUpdate = false;
            this.drone.add(arm); this.arms.push(arm);

            const mot = new THREE.Mesh(cyl, new THREE.MeshLambertMaterial({ color: 0x3d4757 }));
            mot.matrixAutoUpdate = false;
            this.drone.add(mot); this.motors.push(mot);

            const fan = new THREE.Mesh(makeDiscGeom(DISC_SEGS), new THREE.MeshBasicMaterial({
                color: 0x9fd8ff, transparent: true, opacity: 0.16,
                side: THREE.DoubleSide, depthWrite: false
            }));
            this.drone.add(fan); this.discFan.push(fan);

            const rg = new THREE.BufferGeometry();
            rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DISC_SEGS * 3), 3));
            const ring = new THREE.LineLoop(rg, new THREE.LineBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0.75
            }));
            this.drone.add(ring); this.discRing.push(ring);

            const bg = new THREE.BufferGeometry();
            bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
            const bl = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0xffffff }));
            this.drone.add(bl); this.blades.push(bl);
        }
        // thrust axis, so "which way is up for the drone" is always visible
        {
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
            this.upLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x4ade80 }));
            this.drone.add(this.upLine);
        }

        // ---- waypoint: dim full-radius shell + bright exact cross-section
        this.wpShell = new THREE.Mesh(
            new THREE.SphereGeometry(1, 20, 14),
            new THREE.MeshBasicMaterial({ color: 0xffb443, wireframe: true, transparent: true, opacity: 0.28 }));
        this.scene.add(this.wpShell);
        this.wpCore = new THREE.Mesh(
            new THREE.SphereGeometry(1, 20, 14),
            new THREE.MeshLambertMaterial({ color: 0xffc857, transparent: true, opacity: 0.62 }));
        this.scene.add(this.wpCore);
        // a dropline to the floor, so height is readable
        {
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
            this.wpDrop = new THREE.Line(g, new THREE.LineBasicMaterial({
                color: 0xffb443, transparent: true, opacity: 0.35
            }));
            this.scene.add(this.wpDrop);
        }

        // ---- trail
        this.TRAIL_MAX = 900;
        const tg = new THREE.BufferGeometry();
        tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.TRAIL_MAX * 3), 3));
        tg.setDrawRange(0, 0);
        this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({
            color: 0x63d0ff, transparent: true, opacity: 0.75
        }));
        this.scene.add(this.trail);

        /* THE DRONE MUST NOT BE FRUSTUM-CULLED.
         *
         * The propellers, blades, thrust axis, waypoint dropline and trail are
         * all drawn by rewriting raw vertex positions every frame while the
         * object's own transform stays at the origin. three.js computes a
         * geometry's bounding sphere ONCE and caches it, so after the first
         * frame that sphere is a stale record of where the drone used to be —
         * and it sits near the spawn point while the drone wanders up to ~19 m
         * away. The renderer then culls the object whenever that stale sphere
         * leaves the view, which looks like the rotors blinking out for a few
         * seconds and coming back as the camera swings around.
         *
         * Recomputing bounding spheres every frame would fix it too, at the
         * cost of a full pass over every vertex of every prop, every frame.
         * These are a few dozen tiny objects that are always within a couple of
         * metres of the camera's focus, so culling them could never have saved
         * any work: switching it off is both the cheaper and the correct fix. */
        this.drone.traverse((o) => { o.frustumCulled = false; });
        this.trail.frustumCulled = false;
        this.wpDrop.frustumCulled = false;
    }

    /* half-extent of the room along this view's horizontal axis */
    setRoomExtent(room, halfH) {
        this.shell.scale.set(halfH * 2, room.HY, room.HZ * 2);
        this.shell.position.set(0, room.HY / 2, 0);
        this.floor.scale.set(halfH * 2, room.HZ * 2, 1);
        this.grid.scale.set(Math.max(halfH * 2, room.HZ * 2), 1, Math.max(halfH * 2, room.HZ * 2));
        this.grid.position.y = 0.01;
    }
}

class Renderer4D {
    constructor(canvas, room) {
        this.canvas = canvas;
        this.room = room;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setScissorTest(true);

        this.views = [new Projection(room, "x y z"), new Projection(room, "w y z")];
        this.theta = 0;
        // camera orbit, shared by both views so they stay comparable
        this.orbit = { az: 0.72, el: 0.34, dist: 30 };
        this.setTheta(0);
        this.resize();
    }

    /* the two orthogonal horizontal directions, as 4-vectors */
    setTheta(t) {
        this.theta = t;
        const c = Math.cos(t), s = Math.sin(t);
        this.axH = [c, 0, 0, s];
        this.axK = [-s, 0, 0, c];
        const r = this.room;
        this.views[0].setRoomExtent(r, r.HX * Math.abs(c) + r.HW * Math.abs(s));
        this.views[1].setRoomExtent(r, r.HX * Math.abs(s) + r.HW * Math.abs(c));
        this.views[0].label = t === 0 ? "x · y · z" : `(x cos θ + w sin θ) · y · z`;
        this.views[1].label = t === 0 ? "w · y · z" : `(w cos θ − x sin θ) · y · z`;
    }

    /* 4D world point → this view's 3D coordinates */
    _proj(p, ax, out) {
        out.set(p[0] * ax[0] + p[3] * ax[3], p[1], p[2]);
        return out;
    }

    resize() {
        const w = this.canvas.clientWidth || 960, h = this.canvas.clientHeight || 540;
        this.renderer.setSize(w, h, false);
        this.w = w; this.h = h;
    }

    /* Each view chases its OWN image of the drone, but the two share the orbit
     * angles and distance. Sharing the angles is what keeps the pictures
     * comparable — the same body rotation looks the same in both — while
     * separate targets are unavoidable, because the drone's projected position
     * genuinely differs between two different projections. Following is damped
     * so that a fast pass does not whip the room around. */
    _placeCamera(P, aspect) {
        const o = this.orbit, cam = P.camera;
        if (!P.focus) P.focus = new THREE.Vector3(0, 6, 0);
        if (P.focusTarget) {
            P.focus.lerp(P.focusTarget, 0.055);
            P.focus.y = Math.max(P.focus.y, 2.5);
        }
        const t = P.focus;
        cam.aspect = aspect;
        cam.position.set(
            t.x + o.dist * Math.cos(o.el) * Math.sin(o.az),
            t.y + o.dist * Math.sin(o.el),
            t.z + o.dist * Math.cos(o.el) * Math.cos(o.az));
        cam.lookAt(t);
        cam.updateProjectionMatrix();
    }

    /* Project a BODY-frame 4-vector into this view's 3-space: rotate by R, then
     * collapse (x,w) onto the view's horizontal axis. */
    _projBody(R, b, ax, out) {
        let wx = 0, wy = 0, wz = 0, ww = 0;
        for (let k = 0; k < 4; k++) {
            wx += R[k] * b[k]; wy += R[4 + k] * b[k];
            wz += R[8 + k] * b[k]; ww += R[12 + k] * b[k];
        }
        out.set(wx * ax[0] + ww * ax[3], wy, wz);
        out.hidden = wx * this._oth[0] + ww * this._oth[3];   // component this view drops
        return out;
    }

    /* state: { pos, R, target, trail, spin, alive, dt } */
    update(state) {
        const axes = [this.axH, this.axK];
        this.phase = (this.phase || 0) + (state.dt || 0.016) * BLADE_RPM;
        const v = new THREE.Vector3(), pA = new THREE.Vector3(), pB = new THREE.Vector3();
        const bodyR = new THREE.Vector3(), bodyU = new THREE.Vector3(), bodyF = new THREE.Vector3();
        const eR = v4(), eU = v4(), eF = v4();
        eR[AX_R] = 1; eU[AX_U] = 1; eF[AX_F] = 1;

        for (let vi = 0; vi < 2; vi++) {
            const P = this.views[vi], ax = axes[vi];
            this._oth = axes[1 - vi];
            const dp = this._proj(state.pos, ax, new THREE.Vector3());
            P.drone.position.set(0, 0, 0);
            P.focusTarget = dp;

            // ---- fuselage: a unit sphere carried by the PROJECTED body axes, so
            // the hull squashes exactly as an orthographic shadow of the real 4D
            // body would when it turns through the direction this view drops.
            this._projBody(state.R, eR, ax, bodyR);
            this._projBody(state.R, eU, ax, bodyU);
            this._projBody(state.R, eF, ax, bodyF);
            const BW = MODEL_SCALE * 0.085, BH = MODEL_SCALE * 0.046, BL = MODEL_SCALE * 0.115;
            P.body.matrix.set(
                bodyR.x * BW, bodyU.x * BH, bodyF.x * BL, dp.x,
                bodyR.y * BW, bodyU.y * BH, bodyF.y * BL, dp.y,
                bodyR.z * BW, bodyU.z * BH, bodyF.z * BL, dp.z,
                0, 0, 0, 1);
            // nose cone, pointing along projected body +F (the cone's own axis is +Y)
            const NL = MODEL_SCALE * 0.075;
            P.nose.matrix.set(
                bodyR.x * BW * 0.9, bodyF.x * NL, -bodyU.x * BH, dp.x + bodyF.x * BL * 1.15,
                bodyR.y * BW * 0.9, bodyF.y * NL, -bodyU.y * BH, dp.y + bodyF.y * BL * 1.15,
                bodyR.z * BW * 0.9, bodyF.z * NL, -bodyU.z * BH, dp.z + bodyF.z * BL * 1.15,
                0, 0, 0, 1);

            // ---- eight arms, motors and propellers
            const rProp = PROP_R * MODEL_SCALE;
            for (let i = 0; i < 8; i++) {
                const rot = ROTORS[i];
                this._projBody(state.R, rot.p, ax, v);
                const hid = v.hidden * MODEL_SCALE;
                v.multiplyScalar(MODEL_SCALE).add(dp);

                // tint by the coordinate along the axis THIS view cannot show
                const u = Math.max(-1, Math.min(1, hid / (DRONE.ARM * MODEL_SCALE * 0.6)));
                const tint = u < 0 ? lerpColor(C_MID, C_COLD, -u) : lerpColor(C_MID, C_WARM, u);

                spanCylinder(P.arms[i], dp, v, MODEL_SCALE * 0.016);
                // motor: a short can standing along the projected thrust axis
                _cyA.copy(bodyU).multiplyScalar(MODEL_SCALE * 0.022);
                spanCylinder(P.motors[i], v, _cyB.copy(v).add(_cyA), MODEL_SCALE * 0.019);

                // propeller disc — the EXACT projection of the rotor's real spin
                // plane, drawn from the two body vectors that span it.
                this._projBody(state.R, rot.discA, ax, pA);
                this._projBody(state.R, rot.discB, ax, pB);
                const cy = _cyA.copy(bodyU).multiplyScalar(MODEL_SCALE * 0.03);
                const cx = v.x + cy.x, cyy = v.y + cy.y, cz = v.z + cy.z;

                const fa = P.discFan[i].geometry.attributes.position.array;
                const ra = P.discRing[i].geometry.attributes.position.array;
                fa[0] = cx; fa[1] = cyy; fa[2] = cz;
                for (let s = 0; s < DISC_SEGS; s++) {
                    const a = (s / DISC_SEGS) * Math.PI * 2, c = Math.cos(a) * rProp, sn = Math.sin(a) * rProp;
                    const x = cx + pA.x * c + pB.x * sn;
                    const y = cyy + pA.y * c + pB.y * sn;
                    const z = cz + pA.z * c + pB.z * sn;
                    fa[3 + s * 3] = x; fa[4 + s * 3] = y; fa[5 + s * 3] = z;
                    ra[s * 3] = x; ra[s * 3 + 1] = y; ra[s * 3 + 2] = z;
                }
                P.discFan[i].geometry.attributes.position.needsUpdate = true;
                P.discRing[i].geometry.attributes.position.needsUpdate = true;

                // two crossed blades, spinning at a rate that reads the throttle
                // and in the direction the rotor actually turns
                const thr = Math.max(0, Math.min(1, state.spin ? state.spin[i] : 0.5));
                const ang = this.phase * (0.35 + thr) * rot.sigma;
                const ba = P.blades[i].geometry.attributes.position.array;
                for (let b = 0; b < 2; b++) {
                    const a = ang + b * Math.PI / 2;
                    const c = Math.cos(a) * rProp, sn = Math.sin(a) * rProp;
                    const dx = pA.x * c + pB.x * sn, dy = pA.y * c + pB.y * sn, dz = pA.z * c + pB.z * sn;
                    ba[b * 6] = cx - dx; ba[b * 6 + 1] = cyy - dy; ba[b * 6 + 2] = cz - dz;
                    ba[b * 6 + 3] = cx + dx; ba[b * 6 + 4] = cyy + dy; ba[b * 6 + 5] = cz + dz;
                }
                P.blades[i].geometry.attributes.position.needsUpdate = true;

                P.discRing[i].material.color = tint;
                P.blades[i].material.color = tint;
                P.discFan[i].material.opacity = 0.08 + thr * 0.18;
            }

            // the thrust axis
            {
                const L = MODEL_SCALE * 0.42;
                const pa = P.upLine.geometry.attributes.position;
                pa.array[0] = dp.x; pa.array[1] = dp.y; pa.array[2] = dp.z;
                pa.array[3] = dp.x + bodyU.x * L; pa.array[4] = dp.y + bodyU.y * L;
                pa.array[5] = dp.z + bodyU.z * L;
                pa.needsUpdate = true;
            }

            // waypoint: full-radius shell + exact cross-section at the drone's
            // own coordinate along the axis this view cannot show
            if (state.target) {
                const tp = this._proj(state.target, ax, new THREE.Vector3());
                P.wpShell.position.copy(tp);
                P.wpShell.scale.setScalar(DRONE.WP_RADIUS);
                P.wpShell.visible = true;
                const oth = this._oth;
                const dHid = (state.target[0] - state.pos[0]) * oth[0]
                    + (state.target[3] - state.pos[3]) * oth[3];
                const r2 = DRONE.WP_RADIUS * DRONE.WP_RADIUS - dHid * dHid;
                if (r2 > 1e-4) {
                    P.wpCore.position.copy(tp);
                    P.wpCore.scale.setScalar(Math.sqrt(r2));
                    P.wpCore.visible = true;
                } else P.wpCore.visible = false;
                const pa = P.wpDrop.geometry.attributes.position;
                pa.array[0] = tp.x; pa.array[1] = 0; pa.array[2] = tp.z;
                pa.array[3] = tp.x; pa.array[4] = tp.y; pa.array[5] = tp.z;
                pa.needsUpdate = true;
                P.wpDrop.visible = true;
            } else {
                P.wpShell.visible = P.wpCore.visible = P.wpDrop.visible = false;
            }

            // trail
            const tr = state.trail, n = Math.min(tr.length, P.TRAIL_MAX);
            const arr = P.trail.geometry.attributes.position.array;
            for (let i = 0; i < n; i++) {
                const q = tr[tr.length - n + i];
                arr[i * 3] = q[0] * ax[0] + q[3] * ax[3];
                arr[i * 3 + 1] = q[1];
                arr[i * 3 + 2] = q[2];
            }
            P.trail.geometry.attributes.position.needsUpdate = true;
            P.trail.geometry.setDrawRange(0, n);
            P.body.material.color.set(state.alive ? 0xc9d6e8 : 0xff5b5b);
        }
    }

    render() {
        const half = Math.floor(this.w / 2);
        for (let i = 0; i < 2; i++) {
            const x = i === 0 ? 0 : half;
            const w = i === 0 ? half - 1 : this.w - half;
            this.renderer.setViewport(x, 0, w, this.h);
            this.renderer.setScissor(x, 0, w, this.h);
            this._placeCamera(this.views[i], w / this.h);
            this.renderer.render(this.views[i].scene, this.views[i].camera);
        }
    }
}
