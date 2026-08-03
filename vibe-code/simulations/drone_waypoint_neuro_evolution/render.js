/* render.js — the three.js view.
 *
 * Everything drawn here is read straight out of the simulation state: each
 * drone's position and quaternion are the ones the integrator produced, the
 * sensor rays are the same numbers that went into the network, and the room
 * boxes are the same AABBs the collision test uses. Nothing is animated,
 * interpolated or faked — if it looks wrong on screen, the sim is wrong.
 *
 * The whole fleet spawns on one pad (see world.js on fairness), so the drones
 * fly as a ghost swarm with the current leader picked out in solid colour. How
 * far the ghosts spread is a live read on how much variance is left in the gene
 * pool: a converged population flies almost as one aircraft.
 *
 * The room is drawn with BackSide materials, so the near walls disappear and
 * the camera is always looking into the box from outside it.
 */
"use strict";

const C = {
    sky: 0x0b1420,
    wall: 0x24384f,
    floor: 0x18293c,
    grid: 0x2c4560,
    obstacle: 0x3d5a78,
    obstacleEdge: 0x6d90b4,
    leader: 0x35b6ff,
    ghost: 0x6fa8d0,
    dead: 0xff5f6b,
    rotor: 0xffc94d,
    waypoint: 0x4fe0a8,
    next: 0xffc94d,
    ray: 0x35b6ff,
    rayHot: 0xff5f6b,
    trail: 0x35b6ff,
    pad: 0x35b6ff
};

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setClearColor(C.sky);
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(C.sky);
        this.scene.fog = new THREE.Fog(C.sky, 40, 110);

        this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
        this.scene.add(new THREE.HemisphereLight(0xbfd6f0, 0x25384c, 1.0));
        const sun = new THREE.DirectionalLight(0xffffff, 0.55);
        sun.position.set(14, 26, 10);
        this.scene.add(sun);

        // ---- orbit state. Hand-rolled: OrbitControls is a separate file and
        // this sim ships as plain script tags with no build step.
        //
        // The default distance is 7 m, not something that frames the whole room.
        // The drone is drawn at true scale — 0.32 m across — and a 26 m room
        // viewed whole renders it about three pixels wide. Everything worth
        // watching (attitude, rotor wind-up, how close it came to a pillar)
        // needs the camera near it; the room is what you zoom out to.
        this.orbit = { yaw: 0.7, pitch: 0.4, dist: 7 };
        this.followLeader = true;
        this._target = new THREE.Vector3();
        this._camTarget = new THREE.Vector3();
        this._bindInput();

        // ---- shared geometry, built once ----
        this.cube = new THREE.BoxGeometry(1, 1, 1);
        this.rotorGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.012, 12);
        this.sphere = new THREE.SphereGeometry(1, 20, 14);
        this.matLeader = new THREE.MeshLambertMaterial({ color: C.leader });
        this.matGhost = new THREE.MeshLambertMaterial({
            color: C.ghost, transparent: true, opacity: 0.22, depthWrite: false
        });
        this.matDead = new THREE.MeshLambertMaterial({
            color: C.dead, transparent: true, opacity: 0.14, depthWrite: false
        });
        this.matRotor = new THREE.MeshBasicMaterial({ color: C.rotor });
        // Ghost rotors must not compete with the leader's. Drawn in the same
        // flat gold, sixty drones' worth of rotor discs read as the brightest
        // thing on screen and the one drone you are actually watching disappears
        // into them.
        this.matRotorGhost = new THREE.MeshBasicMaterial({
            color: C.rotor, transparent: true, opacity: 0.3, depthWrite: false
        });

        this.drones = [];
        this._roomKey = null;
        this.roomGroup = new THREE.Group();
        this.scene.add(this.roomGroup);

        this._buildWaypoints();
        this._buildLeaderMark();
        this._buildRays();
        this._buildTrail();
    }

    /* A ring on the floor under the leader plus a line down to it. At true
     * scale a 0.32 m drone is a few pixels once you zoom out far enough to see
     * the room, and without a ground mark you lose it entirely. The mark also
     * does the job a shadow would: altitude is very hard to read from a
     * perspective view of a small object against a distant wall. */
    _buildLeaderMark() {
        this.mark = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 22),
            new THREE.MeshBasicMaterial({
                color: C.leader, side: THREE.DoubleSide, transparent: true, opacity: 0.5
            }));
        this.mark.rotation.x = -Math.PI / 2;
        this.scene.add(this.mark);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
        this.markDrop = new THREE.Line(g, new THREE.LineBasicMaterial({
            color: C.leader, transparent: true, opacity: 0.25
        }));
        this.scene.add(this.markDrop);
    }

    /* ------------------------------------------------------------ the room */
    _buildRoom(room) {
        const key = room.id;
        if (this._roomKey === key) return;
        this._roomKey = key;
        while (this.roomGroup.children.length) this.roomGroup.remove(this.roomGroup.children[0]);

        const { W, H, D } = room;

        // shell, seen from the inside
        const shell = new THREE.Mesh(this.cube, new THREE.MeshLambertMaterial({
            color: C.wall, side: THREE.BackSide, transparent: true, opacity: 0.55
        }));
        shell.scale.set(W, H, D);
        shell.position.set(W / 2, H / 2, D / 2);
        this.roomGroup.add(shell);

        // the room's outline, so the volume reads as a box even from odd angles
        this.roomGroup.add(new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)),
            new THREE.LineBasicMaterial({ color: C.grid })
        ).translateX(W / 2).translateY(H / 2).translateZ(D / 2));

        // floor + a metre grid for scale
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D),
            new THREE.MeshLambertMaterial({ color: C.floor }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(W / 2, 0.01, D / 2);
        this.roomGroup.add(floor);
        const grid = new THREE.GridHelper(Math.max(W, D), Math.max(W, D), C.grid, C.grid);
        grid.position.set(W / 2, 0.02, D / 2);
        grid.material.transparent = true;
        grid.material.opacity = 0.35;
        this.roomGroup.add(grid);

        // obstacles, with edges so the gaps between them are legible
        for (const o of room.obstacles) {
            const sx = o.max[0] - o.min[0], sy = o.max[1] - o.min[1], sz = o.max[2] - o.min[2];
            const m = new THREE.Mesh(this.cube, new THREE.MeshLambertMaterial({
                color: C.obstacle, transparent: true, opacity: 0.85
            }));
            m.scale.set(sx, sy, sz);
            m.position.set((o.min[0] + o.max[0]) / 2, (o.min[1] + o.max[1]) / 2, (o.min[2] + o.max[2]) / 2);
            this.roomGroup.add(m);
            const e = new THREE.LineSegments(
                new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz)),
                new THREE.LineBasicMaterial({ color: C.obstacleEdge }));
            e.position.copy(m.position);
            this.roomGroup.add(e);
        }

        // the pad everyone launches from
        const pad = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 24),
            new THREE.MeshBasicMaterial({ color: C.pad, side: THREE.DoubleSide }));
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(room.spawn[0], 0.03, room.spawn[2]);
        this.roomGroup.add(pad);
    }

    /* ------------------------------------------------------------- drones */
    _makeDrone() {
        const g = new THREE.Group();
        const body = new THREE.Mesh(this.cube, this.matLeader);
        body.scale.set(0.15, 0.055, 0.15);
        g.add(body);
        // two crossed arms
        for (const a of [1, -1]) {
            const arm = new THREE.Mesh(this.cube, this.matLeader);
            arm.scale.set(DRONE.ARM * 2, 0.018, 0.028);
            arm.rotation.y = a * Math.PI / 4;
            g.add(arm);
        }
        const rotors = [];
        for (const r of ROTORS) {
            const m = new THREE.Mesh(this.rotorGeo, this.matRotor);
            m.position.set(r.x, 0.035, r.z);
            g.add(m);
            rotors.push(m);
        }
        g.userData.rotors = rotors;
        g.userData.parts = g.children.filter(c => c.material !== this.matRotor);
        this.scene.add(g);
        return g;
    }

    _syncDroneCount(n) {
        while (this.drones.length < n) this.drones.push(this._makeDrone());
        for (let i = 0; i < this.drones.length; i++) this.drones[i].visible = i < n;
    }

    /* ------------------------------------------------- waypoint + overlays */
    _buildWaypoints() {
        this.wpMesh = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({
            color: C.waypoint, transparent: true, opacity: 0.24, depthWrite: false
        }));
        this.wpMesh.scale.setScalar(DRONE.WP_RADIUS);
        this.scene.add(this.wpMesh);
        this.wpCore = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: C.waypoint }));
        this.wpCore.scale.setScalar(0.13);
        this.scene.add(this.wpCore);
        // a dropline to the floor: a bare sphere in mid-air has no depth cue
        const dl = new THREE.BufferGeometry();
        dl.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
        this.wpDrop = new THREE.Line(dl, new THREE.LineBasicMaterial({
            color: C.waypoint, transparent: true, opacity: 0.4
        }));
        this.scene.add(this.wpDrop);
        // and the leader's bearing to it
        const bg = new THREE.BufferGeometry();
        bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
        this.wpLine = new THREE.Line(bg, new THREE.LineBasicMaterial({
            color: C.next, transparent: true, opacity: 0.5
        }));
        this.scene.add(this.wpLine);
    }

    _buildRays() {
        const g = new THREE.BufferGeometry();
        this._rayPos = new Float32Array(DRONE.SENSOR_N * 6);
        this._rayCol = new Float32Array(DRONE.SENSOR_N * 6);
        g.setAttribute("position", new THREE.BufferAttribute(this._rayPos, 3));
        g.setAttribute("color", new THREE.BufferAttribute(this._rayCol, 3));
        // Kept faint on purpose: 32 beams radiating from a 0.32 m airframe make
        // a sea urchin that swallows the drone at the middle of it. The useful
        // signal is which beams go SHORT, and the per-beam hot colouring in
        // _updateRays carries that without needing opacity as well.
        this.rays = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0.3
        }));
        this.rays.frustumCulled = false;
        this.scene.add(this.rays);
    }

    _buildTrail() {
        this.trailMax = 900;
        const g = new THREE.BufferGeometry();
        this._trailPos = new Float32Array(this.trailMax * 3);
        g.setAttribute("position", new THREE.BufferAttribute(this._trailPos, 3));
        g.setDrawRange(0, 0);
        this.trail = new THREE.Line(g, new THREE.LineBasicMaterial({
            color: C.trail, transparent: true, opacity: 0.55
        }));
        this.trail.frustumCulled = false;
        this.scene.add(this.trail);
        this._trailN = 0;
        this._trailKey = null;
    }

    /* ----------------------------------------------------------- the frame */
    frame(world, cfg) {
        const room = world.room;
        this._buildRoom(room);

        const leaderIdx = world.leaderIdx;
        const leader = world.drones[leaderIdx];
        const ghosts = Math.max(0, cfg.ghosts | 0);

        // Draw the leader plus the first `ghosts` other live drones. Capping the
        // swarm keeps a 64-drone population from turning the room into fog and
        // costs nothing in fidelity — the leader is what anyone is watching.
        const shown = [leader];
        for (const d of world.drones) {
            if (shown.length > ghosts) break;
            if (d !== leader && (cfg.showDead || d.alive)) shown.push(d);
        }
        this._syncDroneCount(shown.length);

        for (let i = 0; i < shown.length; i++) {
            const d = shown[i], g = this.drones[i];
            g.position.set(d.pos[0], d.pos[1], d.pos[2]);
            // three.js quaternions are (x,y,z,w); the sim stores (w,x,y,z)
            g.quaternion.set(d.q[1], d.q[2], d.q[3], d.q[0]);
            const mat = d === leader ? this.matLeader : (d.alive ? this.matGhost : this.matDead);
            for (const p of g.userData.parts) p.material = mat;
            // rotor discs spin at the rate the motor model says they are turning,
            // so a drone fighting for altitude visibly winds up
            const rotorMat = d === leader ? this.matRotor : this.matRotorGhost;
            for (let r = 0; r < 4; r++) {
                g.userData.rotors[r].rotation.y += d.spin[r] * 2.2;
                g.userData.rotors[r].material = rotorMat;
                g.userData.rotors[r].visible = d === leader || d.alive;
            }
            g.visible = true;
        }

        // ---- where the leader is, on the floor ----
        this.mark.position.set(leader.pos[0], 0.04, leader.pos[2]);
        const mp = this.markDrop.geometry.attributes.position;
        mp.array.set([leader.pos[0], 0.04, leader.pos[2],
                      leader.pos[0], leader.pos[1], leader.pos[2]]);
        mp.needsUpdate = true;

        // ---- the leader's waypoint ----
        const t = leader.target;
        if (t && cfg.showWaypoints) {
            this.wpMesh.visible = this.wpCore.visible = this.wpDrop.visible = true;
            this.wpMesh.position.set(t[0], t[1], t[2]);
            this.wpCore.position.copy(this.wpMesh.position);
            const dp = this.wpDrop.geometry.attributes.position;
            dp.array.set([t[0], 0.02, t[2], t[0], t[1], t[2]]);
            dp.needsUpdate = true;
            const bp = this.wpLine.geometry.attributes.position;
            bp.array.set([leader.pos[0], leader.pos[1], leader.pos[2], t[0], t[1], t[2]]);
            bp.needsUpdate = true;
            this.wpLine.visible = true;
        } else {
            this.wpMesh.visible = this.wpCore.visible = this.wpDrop.visible = this.wpLine.visible = false;
        }

        // ---- the leader's sensor sphere, exactly as the net sees it ----
        this.rays.visible = !!cfg.showRays;
        if (cfg.showRays) this._updateRays(leader, room);

        // ---- the leader's track ----
        this.trail.visible = !!cfg.showTrail;
        if (cfg.showTrail) this._updateTrail(world, leaderIdx);

        this._updateCamera(leader, room, cfg);
        this.renderer.render(this.scene, this.camera);
    }

    _updateRays(d, room) {
        const q = d.q, p = d.pos, R = DRONE.SENSOR_RANGE;
        const v = new Float64Array(3);
        for (let i = 0; i < DRONE.SENSOR_N; i++) {
            // draw only each cone's axis; the reading is the min over the cone
            const k = i * BEAM_STRIDE;
            qRot(q, SENSOR_DIRS[k], SENSOR_DIRS[k + 1], SENSOR_DIRS[k + 2], v);
            // d.rays holds 1 − dist/R, the value that actually reached the net
            const near = d.rays[i];
            const len = (1 - near) * R;
            const b = i * 6;
            this._rayPos[b] = p[0]; this._rayPos[b + 1] = p[1]; this._rayPos[b + 2] = p[2];
            this._rayPos[b + 3] = p[0] + v[0] * len;
            this._rayPos[b + 4] = p[1] + v[1] * len;
            this._rayPos[b + 5] = p[2] + v[2] * len;
            // cool when there is air, hot when something is close
            const hot = Math.max(0, Math.min(1, (near - 0.55) / 0.45));
            for (const o of [0, 3]) {
                this._rayCol[b + o] = 0.2 + 0.8 * hot;
                this._rayCol[b + o + 1] = 0.71 - 0.35 * hot;
                this._rayCol[b + o + 2] = 1.0 - 0.58 * hot;
            }
        }
        this.rays.geometry.attributes.position.needsUpdate = true;
        this.rays.geometry.attributes.color.needsUpdate = true;
    }

    _updateTrail(world, leaderIdx) {
        // Reset whenever the episode or the leader changes, otherwise the line
        // teleports across the room and draws a stripe through the scenery.
        const key = world.opts.missionSeed + ":" + leaderIdx + ":" + (world.tick < 8);
        if (key !== this._trailKey) { this._trailKey = key; this._trailN = 0; }
        const d = world.drones[leaderIdx];
        const n = this._trailN;
        if (n === 0 || Math.hypot(
            this._trailPos[(n - 1) * 3] - d.pos[0],
            this._trailPos[(n - 1) * 3 + 1] - d.pos[1],
            this._trailPos[(n - 1) * 3 + 2] - d.pos[2]) > 0.12) {
            if (n < this.trailMax) {
                this._trailPos[n * 3] = d.pos[0];
                this._trailPos[n * 3 + 1] = d.pos[1];
                this._trailPos[n * 3 + 2] = d.pos[2];
                this._trailN++;
            }
        }
        this.trail.geometry.setDrawRange(0, this._trailN);
        this.trail.geometry.attributes.position.needsUpdate = true;
    }

    _updateCamera(leader, room, cfg) {
        if (this.followLeader && leader) {
            this._target.set(leader.pos[0], leader.pos[1], leader.pos[2]);
        } else {
            this._target.set(room.W / 2, room.H / 2, room.D / 2);
        }
        this._camTarget.lerp(this._target, 0.08);
        const o = this.orbit;
        this.camera.position.set(
            this._camTarget.x + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist,
            this._camTarget.y + Math.sin(o.pitch) * o.dist,
            this._camTarget.z + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist
        );
        this.camera.lookAt(this._camTarget);
    }

    _bindInput() {
        const cv = this.canvas;
        let down = false, lx = 0, ly = 0;
        cv.addEventListener("pointerdown", e => {
            down = true; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId);
        });
        cv.addEventListener("pointerup", e => {
            down = false;
            if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
        });
        cv.addEventListener("pointermove", e => {
            if (!down) return;
            this.orbit.yaw -= (e.clientX - lx) * 0.006;
            this.orbit.pitch = Math.max(-0.35, Math.min(1.45, this.orbit.pitch + (e.clientY - ly) * 0.005));
            lx = e.clientX; ly = e.clientY;
        });
        cv.addEventListener("wheel", e => {
            e.preventDefault();
            this.orbit.dist = Math.max(2.5, Math.min(70, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.12)));
        }, { passive: false });
    }

    resize() {
        const dpr = Math.min(devicePixelRatio || 1, 1.75);
        const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / Math.max(1, h);
        this.camera.updateProjectionMatrix();
    }
}
