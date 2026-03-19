// ══════════════════════════════════════════════════════════════
//          3D NOZZLE ASSEMBLY — Procedural Geometry
// ══════════════════════════════════════════════════════════════

class NozzleAssembly {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Clipping plane for cutaway view (cuts along Z axis)
    this.clippingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.clippingEnabled = true;

    this.buildAll();
  }

  // Convert sim-Y to world-Y
  sy(simY) { return simToWorld(simY); }
  // Convert sim-pixel radius to world radius
  sr(simR) { return simR * WS; }

  buildAll() {
    this.buildNozzleBody();
    this.buildHeaterBlock();
    this.buildHeatBreak();
    this.buildExtruderHousing();
    this.buildGears();
    this.buildBuildPlate();
    this.buildNozzleBore();
  }

  getClipArray() {
    return this.clippingEnabled ? [this.clippingPlane] : [];
  }

  // ── Nozzle body (brass) via LatheGeometry ──
  buildNozzleBody() {
    const bw = 1.75 * PX; // bore width in sim pixels
    const nd = 0.4 * PX;  // nozzle diameter (default)

    // Profile points for the outer nozzle shape (x = radius from center, y = height)
    // Working in world coordinates
    const outerPoints = [];
    const outerR = (bw / 2 + 7) * WS; // outer radius at top
    const nozzleR = (nd / 2 + 4) * WS; // outer radius at tip
    const topY = this.sy(GEOM.nT);
    const taperY = this.sy(GEOM.nLS);
    const tipY = this.sy(GEOM.nB);
    const bottomY = tipY - 2.5 * WS; // tip thickness

    outerPoints.push(new THREE.Vector2(0, topY + 2 * WS)); // center top cap
    outerPoints.push(new THREE.Vector2(outerR, topY + 2 * WS));
    outerPoints.push(new THREE.Vector2(outerR, topY));
    outerPoints.push(new THREE.Vector2(nozzleR, taperY));
    outerPoints.push(new THREE.Vector2(nozzleR, tipY));
    outerPoints.push(new THREE.Vector2(nozzleR, bottomY));
    outerPoints.push(new THREE.Vector2(0, bottomY)); // center bottom

    const nozzleGeo = new THREE.LatheGeometry(outerPoints, 64);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0xC9A84C,
      metalness: 0.8,
      roughness: 0.3,
      clippingPlanes: this.getClipArray(),
      clipShadows: true,
      side: THREE.DoubleSide
    });
    this.nozzleMesh = new THREE.Mesh(nozzleGeo, nozzleMat);
    this.group.add(this.nozzleMesh);

    // Nozzle bore (dark inside)
    const boreR = bw / 2 * WS;
    const nozzleBoreR = nd / 2 * WS;
    const borePoints = [];
    borePoints.push(new THREE.Vector2(boreR, topY + 2 * WS));
    borePoints.push(new THREE.Vector2(boreR, topY));
    borePoints.push(new THREE.Vector2(nozzleBoreR, taperY));
    borePoints.push(new THREE.Vector2(nozzleBoreR, tipY));
    borePoints.push(new THREE.Vector2(nozzleBoreR, bottomY));

    const boreGeo = new THREE.LatheGeometry(borePoints, 64);
    const boreMat = new THREE.MeshStandardMaterial({
      color: 0x1A0800,
      metalness: 0.3,
      roughness: 0.8,
      side: THREE.BackSide,
      clippingPlanes: this.getClipArray(),
      clipShadows: true
    });
    this.boreMesh = new THREE.Mesh(boreGeo, boreMat);
    this.group.add(this.boreMesh);
  }

  // ── Inner bore visualization (to see through nozzle) ──
  buildNozzleBore() {
    // Already built in buildNozzleBody
  }

  // ── Heater block (red/orange box) ──
  buildHeaterBlock() {
    const w = 84 * WS, h = (GEOM.mB - GEOM.mT) * WS, d = 60 * WS;
    const geo = new THREE.BoxGeometry(w, h, d);
    // Round the edges slightly
    const mat = new THREE.MeshStandardMaterial({
      color: 0xCC4444,
      metalness: 0.4,
      roughness: 0.5,
      emissive: 0xFF4020,
      emissiveIntensity: 0.1,
      clippingPlanes: this.getClipArray(),
      clipShadows: true
    });
    this.heaterBlock = new THREE.Mesh(geo, mat);
    const centerY = this.sy((GEOM.mT + GEOM.mB) / 2);
    this.heaterBlock.position.set(0, centerY, 0);
    this.group.add(this.heaterBlock);

    // Thermistor bead
    const thermGeo = new THREE.SphereGeometry(3 * WS, 16, 16);
    const thermMat = new THREE.MeshStandardMaterial({
      color: 0xFFB060,
      metalness: 0.6,
      roughness: 0.3,
      emissive: 0xFF8030,
      emissiveIntensity: 0.2
    });
    this.thermistor = new THREE.Mesh(thermGeo, thermMat);
    this.thermistor.position.set(w / 2 - 2 * WS, centerY, 0);
    this.group.add(this.thermistor);

    // Wire from thermistor
    const wireCurve = new THREE.LineCurve3(
      new THREE.Vector3(w / 2, centerY, 0),
      new THREE.Vector3(w / 2 + 15 * WS, centerY, 0)
    );
    const wireGeo = new THREE.TubeGeometry(wireCurve, 4, 0.4 * WS, 4, false);
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.4 });
    this.wire = new THREE.Mesh(wireGeo, wireMat);
    this.group.add(this.wire);
  }

  // ── Heat break fins ──
  buildHeatBreak() {
    const finCount = 6;
    const boreR = 1.75 * PX / 2 * WS;
    const finOuterR = 38 * WS;
    const finH = 6 * WS;

    for (let i = 0; i < finCount; i++) {
      const simY = GEOM.hT + i * ((GEOM.hB - GEOM.hT) / finCount);
      const y = this.sy(simY);

      // Ring geometry (annulus)
      const geo = new THREE.RingGeometry(boreR + 0.5 * WS, finOuterR, 64);
      // Extrude into a thin cylinder using CylinderGeometry
      const cylGeo = new THREE.CylinderGeometry(finOuterR, finOuterR, finH, 64);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xDEDAD3,
        metalness: 0.4,
        roughness: 0.4,
        clippingPlanes: this.getClipArray(),
        clipShadows: true
      });
      const fin = new THREE.Mesh(cylGeo, mat);
      fin.position.set(0, y - finH / 2, 0);

      // Cut out the bore hole — use a slightly larger bore to avoid z-fighting
      this.group.add(fin);
    }

    // Heat break tube connecting extruder to heater
    const tubeGeo = new THREE.CylinderGeometry(boreR + 2 * WS, boreR + 2 * WS,
      (GEOM.hB - GEOM.hT) * WS, 32);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0xB0B0B0,
      metalness: 0.7,
      roughness: 0.3,
      clippingPlanes: this.getClipArray(),
      clipShadows: true
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    tube.position.set(0, this.sy((GEOM.hT + GEOM.hB) / 2), 0);
    this.group.add(tube);
  }

  // ── Extruder housing ──
  buildExtruderHousing() {
    const w = 96 * WS, h = (GEOM.gH + 2) * WS, d = 50 * WS;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xE8E4DD,
      metalness: 0.1,
      roughness: 0.7,
      clippingPlanes: this.getClipArray(),
      clipShadows: true
    });
    this.housing = new THREE.Mesh(geo, mat);
    this.housing.position.set(0, this.sy(GEOM.gTE + GEOM.gH / 2), 0);
    this.group.add(this.housing);
  }

  // ── Gears ──
  buildGears() {
    const gearR = 16 * WS;
    const gearH = 8 * WS;
    const gY = this.sy(GEOM.gY + 1);

    // Create gear with teeth
    const createGear = (x) => {
      const group = new THREE.Group();

      // Main gear body
      const bodyGeo = new THREE.CylinderGeometry(gearR, gearR, gearH, 32);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xA0A0A0,
        metalness: 0.7,
        roughness: 0.3
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.rotation.x = Math.PI / 2; // lay flat
      group.add(body);

      // Teeth (simplified as small boxes around circumference)
      for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2;
        const toothGeo = new THREE.BoxGeometry(2 * WS, gearH * 0.8, 3 * WS);
        const tooth = new THREE.Mesh(toothGeo, bodyMat);
        tooth.position.set(
          Math.cos(angle) * (gearR + 1 * WS),
          0,
          Math.sin(angle) * (gearR + 1 * WS)
        );
        tooth.rotation.y = -angle;
        group.add(tooth);
      }

      // Axle
      const axleGeo = new THREE.CylinderGeometry(3.5 * WS, 3.5 * WS, gearH * 1.2, 16);
      const axleMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.2 });
      const axle = new THREE.Mesh(axleGeo, axleMat);
      axle.rotation.x = Math.PI / 2;
      group.add(axle);

      group.position.set(x, gY, 0);
      return group;
    };

    this.gearLeft = createGear(-30 * WS);
    this.gearRight = createGear(30 * WS);
    this.group.add(this.gearLeft);
    this.group.add(this.gearRight);
  }

  // ── Build plate ──
  buildBuildPlate() {
    const plateW = 12; // world units wide
    const plateH = 12 * WS;
    const plateD = 12; // world units deep
    const plateY = this.sy(GEOM.bY) - plateH / 2;

    const geo = new THREE.BoxGeometry(plateW, plateH, plateD);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xD8D2C6,
      metalness: 0.1,
      roughness: 0.6
    });
    this.buildPlate = new THREE.Mesh(geo, mat);
    this.buildPlate.position.set(0, plateY, 0);
    this.group.add(this.buildPlate);

    // PEI surface (thin layer on top)
    const peiGeo = new THREE.BoxGeometry(plateW, 0.5 * WS, plateD);
    const peiMat = new THREE.MeshStandardMaterial({
      color: 0xC8B878,
      metalness: 0.05,
      roughness: 0.8,
      transparent: true,
      opacity: 0.85
    });
    this.peiSurface = new THREE.Mesh(peiGeo, peiMat);
    this.peiSurface.position.set(0, plateY + plateH / 2 + 0.25 * WS, 0);
    this.group.add(this.peiSurface);
  }

  // ── Update per frame ──
  update(physics, dt) {
    const g = physics.gear;
    const t = physics.tick;

    // Rotate gears
    const retMul = physics.retraction.active ? -1 : 1;
    if (g.st) {
      const wobble = Math.sin(t * .3) * .015;
      this.gearLeft.rotation.z = wobble;
      this.gearRight.rotation.z = -wobble;
    } else {
      const rot = t * .04 * g.sp * retMul;
      this.gearLeft.rotation.z = rot;
      this.gearRight.rotation.z = -rot;
    }

    // Heater block emissive intensity based on temperature
    const m = physics.getMat();
    const heatRatio = clamp((physics.params.pt - m.mt) / 60, 0, 1);
    this.heaterBlock.material.emissiveIntensity = 0.05 + heatRatio * 0.25;
    const r = lerp(0.8, 1.0, heatRatio);
    const gb = lerp(0.27, 0.15, heatRatio);
    this.heaterBlock.material.color.setRGB(r, gb, gb);

    // Housing color when stalled
    if (g.st) {
      this.housing.material.color.setHex(0xF0E0E0);
    } else {
      this.housing.material.color.setHex(0xE8E4DD);
    }

    // Heat break fin thermal tinting
    // (simplified — could iterate fins but they're children of group)
  }

  // Update nozzle geometry when diameter changes
  updateNozzleDiameter(nd) {
    // Rebuild nozzle body with new diameter
    // For performance, we update the geometry lazily
    if (this.nozzleMesh) {
      this.group.remove(this.nozzleMesh);
      this.nozzleMesh.geometry.dispose();
      this.group.remove(this.boreMesh);
      this.boreMesh.geometry.dispose();
    }
    this.buildNozzleBody();
  }

  toggleCutaway(enabled) {
    this.clippingEnabled = enabled;
    // Update all materials
    this.group.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.clippingPlanes = this.getClipArray();
        child.material.needsUpdate = true;
      }
    });
  }

  dispose() {
    this.group.traverse(child => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}
