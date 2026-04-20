// ══════════════════════════════════════════════════════════════
//          FILAMENT, MOLTEN ZONE, EXTRUDATE, BEAD
// ══════════════════════════════════════════════════════════════

class FilamentRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.buildSolidFilament();
    this.buildMoltenZone();
    this.buildExtrudateStream();
    this.buildBead();
  }

  sy(simY) { return simToWorld(simY); }

  // ── Solid filament cylinder (above melt zone) ──
  buildSolidFilament() {
    const radius = 1.75 * PX / 2 * WS;
    const topY = this.sy(GEOM.fTY);
    const botY = this.sy(GEOM.mT);
    const height = topY - botY;

    const geo = new THREE.CylinderGeometry(radius, radius, height, 32);
    // Procedural wood grain texture
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    // Base color
    ctx.fillStyle = '#C8A878';
    ctx.fillRect(0, 0, 64, 512);
    // Wood grain lines
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 64; x++) {
        const grain = Math.sin(y * .15 + Math.sin(x * .3 + y * .02) * 3) * .5 + .5;
        const fiber = Math.sin(y * 2.3 + x * .8 + Math.sin(y * .07) * 5) * .12;
        const v = grain * .15 + fiber;
        const r = 160 + v * 80, g = 120 + v * 60, b = 60 + v * 40;
        ctx.fillStyle = `rgba(${r|0},${g|0},${b|0},.12)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 3);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xC8A878,
      map: texture,
      roughness: 0.7,
      metalness: 0.02,
      transparent: true,
      opacity: 0.95
    });
    this.solidFilament = new THREE.Mesh(geo, mat);
    this.solidFilament.position.set(0, botY + height / 2, 0);
    this.group.add(this.solidFilament);
  }

  // ── Molten zone inside nozzle (translucent orange) ──
  buildMoltenZone() {
    // Tapered cylinder matching bore profile
    const topR = 1.75 * PX / 2 * WS;
    const botR = 0.4 * PX / 2 * WS; // will be updated with nozzle diameter
    const topY = this.sy(GEOM.mT);
    const midY = this.sy(GEOM.nT);
    const botY = this.sy(GEOM.nB);

    // Upper straight section (melt zone in heater block)
    const upperH = topY - midY;
    const upperGeo = new THREE.CylinderGeometry(topR * 0.95, topR * 0.95, upperH, 32);
    const moltenMat = new THREE.MeshStandardMaterial({
      color: 0xD4944A,
      transparent: true,
      opacity: 0.5,
      emissive: 0xDD6620,
      emissiveIntensity: 0.15,
      roughness: 0.4,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
    this.moltenUpper = new THREE.Mesh(upperGeo, moltenMat);
    this.moltenUpper.position.set(0, midY + upperH / 2, 0);
    this.group.add(this.moltenUpper);

    // Lower tapered section (nozzle taper + land)
    const lowerH = midY - botY;
    const lowerGeo = new THREE.CylinderGeometry(topR * 0.95, botR * 0.95, lowerH, 32);
    this.moltenLower = new THREE.Mesh(lowerGeo, moltenMat.clone());
    this.moltenLower.position.set(0, botY + lowerH / 2, 0);
    this.group.add(this.moltenLower);
  }

  // ── Extrudate stream from nozzle to bed ──
  buildExtrudateStream() {
    this.streamGroup = new THREE.Group();
    this.group.add(this.streamGroup);
    this.updateExtrudateStream(0.4, 1.0, false);
  }

  updateExtrudateStream(nozzleDia, dieSwell, isFlowing) {
    // Clear previous
    while (this.streamGroup.children.length > 0) {
      const child = this.streamGroup.children[0];
      child.geometry.dispose();
      child.material.dispose();
      this.streamGroup.remove(child);
    }

    if (!isFlowing) return;

    const nw = nozzleDia * PX * WS;
    const topY = this.sy(GEOM.nB + 3);
    const botY = this.sy(GEOM.bY - 1);
    const streamLen = topY - botY;
    if (streamLen < 0.01) return;

    // Build curve with die swell bulge
    const points = [];
    const segments = 20;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const y = topY - t * streamLen;

      let halfW;
      if (t < .15) {
        halfW = (nw / 2) * lerp(1, dieSwell, smoothstep(0, .15, t));
      } else if (t < .4) {
        halfW = (nw / 2) * dieSwell * lerp(1, .7, smoothstep(.15, .4, t));
      } else {
        halfW = (nw / 2) * dieSwell * lerp(.7, .5, smoothstep(.4, 1, t));
      }

      points.push(new THREE.Vector3(0, y, 0));
    }

    // Use TubeGeometry with a custom path
    const path = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(path, segments, nw / 2 * dieSwell * 0.6, 16, false);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xD09040,
      transparent: true,
      opacity: 0.7,
      emissive: 0xCC7030,
      emissiveIntensity: 0.1,
      roughness: 0.5,
      metalness: 0.0
    });
    const stream = new THREE.Mesh(geo, mat);
    this.streamGroup.add(stream);
  }

  // ── Bead deposit on build plate ──
  buildBead() {
    // Dynamic ribbon geometry — updated each frame
    this.beadGeo = new THREE.BufferGeometry();
    const maxVerts = 2000;
    this.beadPositions = new Float32Array(maxVerts * 3);
    this.beadColors = new Float32Array(maxVerts * 3);
    this.beadGeo.setAttribute('position', new THREE.BufferAttribute(this.beadPositions, 3));
    this.beadGeo.setAttribute('color', new THREE.BufferAttribute(this.beadColors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.02,
      side: THREE.DoubleSide
    });
    this.beadMesh = new THREE.Mesh(this.beadGeo, mat);
    this.beadMesh.frustumCulled = false;
    this.group.add(this.beadMesh);
  }

  // ── Per-frame update ──
  update(physics) {
    const m = physics.getMat();
    const mTY = physics.meltTransitionY();
    const t = physics.tick;

    // Update solid filament color based on material
    const matColor = hexToRgbNorm(m.col);
    this.solidFilament.material.color.setRGB(matColor[0], matColor[1], matColor[2]);

    // Animate wood grain scroll
    if (this.solidFilament.material.map) {
      this.solidFilament.material.map.offset.y = (t * .002 * physics.gear.sp) % 1;
    }

    // Update molten zone color
    const meltColor = hexToRgbNorm(m.colMelt);
    this.moltenUpper.material.color.setRGB(meltColor[0], meltColor[1], meltColor[2]);
    this.moltenLower.material.color.setRGB(meltColor[0], meltColor[1], meltColor[2]);

    // Molten zone emissive based on temperature
    const heatRatio = clamp((physics.params.pt - m.mt) / 60, 0, 1);
    this.moltenUpper.material.emissiveIntensity = 0.08 + heatRatio * 0.2;
    this.moltenLower.material.emissiveIntensity = 0.08 + heatRatio * 0.2;

    // Update extrudate stream
    const g = physics.gear, cl = physics.clog;
    const isFlowing = g.sp > .1 && !cl.a && !physics.retraction.active;
    if (t % 10 === 0) { // don't rebuild every frame
      this.updateExtrudateStream(
        physics.params.nd + physics.nozzleWear,
        physics.dieSwell,
        isFlowing || physics.ooze > 0.1
      );
    }

    // Update bead ribbon
    this.updateBeadGeometry(physics);
  }

  updateBeadGeometry(physics) {
    const beads = physics.beads;
    if (beads.length < 2) return;

    const plateY = simToWorld(GEOM.bY) + 0.5 * WS;
    const m = physics.getMat();
    const baseColor = hexToRgbNorm(m.col);
    let vi = 0;

    // Build a simple ribbon from bead segments
    const maxSegs = Math.min(beads.length, 300);
    const start = Math.max(0, beads.length - maxSegs);

    for (let i = start + 1; i < beads.length && vi < 1990; i++) {
      const b0 = beads[i - 1], b1 = beads[i];
      const x0 = (b0.wx - physics.bedOffset) * WS * 0.1;
      const x1 = (b1.wx - physics.bedOffset) * WS * 0.1;
      const w0 = b0.w * WS * 0.2;
      const w1 = b1.w * WS * 0.2;

      if (x1 < -4 || x0 > 4) continue;

      // Quad (2 triangles)
      // v0 top-left, v1 top-right, v2 bottom-right, v3 bottom-left
      const j = vi * 3;
      // Triangle 1
      this.beadPositions[j] = x0; this.beadPositions[j + 1] = plateY + w0 * 0.3; this.beadPositions[j + 2] = 0;
      this.beadPositions[j + 3] = x1; this.beadPositions[j + 4] = plateY + w1 * 0.3; this.beadPositions[j + 5] = 0;
      this.beadPositions[j + 6] = x1; this.beadPositions[j + 7] = plateY; this.beadPositions[j + 8] = 0;

      const cb = b1.cb || 0;
      const c = cb > 0.2 ? lerpColor3(baseColor, [0.29, 0.16, 0.03], cb * 0.6) : baseColor;
      for (let k = 0; k < 3; k++) {
        this.beadColors[j + k * 3] = c[0];
        this.beadColors[j + k * 3 + 1] = c[1];
        this.beadColors[j + k * 3 + 2] = c[2];
      }
      vi += 3;
    }

    this.beadGeo.setDrawRange(0, vi);
    this.beadGeo.attributes.position.needsUpdate = true;
    this.beadGeo.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.group.traverse(child => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}
