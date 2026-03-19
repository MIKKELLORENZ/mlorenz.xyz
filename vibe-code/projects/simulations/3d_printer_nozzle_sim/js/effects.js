// ══════════════════════════════════════════════════════════════
//          VISUAL EFFECTS — Vapor, Bubbles, Glow, Strings
// ══════════════════════════════════════════════════════════════

class EffectsRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.buildVaporSystem();
    this.buildBubbleSystem();
    this.buildThermalGlow();
    this.buildStringSystem();
    this.buildDieSwellIndicator();
  }

  sy(simY) { return simToWorld(simY); }

  // ── Vapor/Smoke — Billboard sprites ──
  buildVaporSystem() {
    // Create sprite texture
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.6)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    this.vaporTexture = new THREE.CanvasTexture(canvas);

    // Smoke texture (darker)
    const canvas2 = document.createElement('canvas');
    canvas2.width = 64; canvas2.height = 64;
    const ctx2 = canvas2.getContext('2d');
    const grad2 = ctx2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad2.addColorStop(0, 'rgba(70,50,30,0.5)');
    grad2.addColorStop(0.5, 'rgba(90,70,50,0.15)');
    grad2.addColorStop(1, 'rgba(120,100,80,0)');
    ctx2.fillStyle = grad2;
    ctx2.fillRect(0, 0, 64, 64);
    this.smokeTexture = new THREE.CanvasTexture(canvas2);

    this.vaporSprites = [];
    this.maxVapor = 50;
  }

  // ── Bubbles — Small translucent spheres ──
  buildBubbleSystem() {
    this.maxBubbles = 30;
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xCCDDEE,
      transparent: true,
      opacity: 0.3,
      roughness: 0.1,
      metalness: 0.0,
      transmission: 0.8,
      thickness: 0.5,
      side: THREE.DoubleSide
    });
    this.bubbleMesh = new THREE.InstancedMesh(geo, mat, this.maxBubbles);
    this.bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bubbleMesh.count = 0;
    this.bubbleMesh.frustumCulled = false;
    this.group.add(this.bubbleMesh);
    this._bubbleDummy = new THREE.Object3D();
  }

  // ── Thermal glow around heater block ──
  buildThermalGlow() {
    const glowGeo = new THREE.SphereGeometry(1, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xFF6030,
      transparent: true,
      opacity: 0.05,
      side: THREE.BackSide,
      depthWrite: false
    });
    this.thermalGlow = new THREE.Mesh(glowGeo, glowMat);
    const centerY = this.sy((GEOM.mT + GEOM.mB) / 2);
    this.thermalGlow.position.set(0, centerY, 0);
    this.thermalGlow.scale.set(
      90 * WS, (GEOM.mB - GEOM.mT) * WS * 0.8, 90 * WS
    );
    this.group.add(this.thermalGlow);

    // Secondary outer glow
    this.thermalGlow2 = new THREE.Mesh(glowGeo.clone(), glowMat.clone());
    this.thermalGlow2.material.opacity = 0.02;
    this.thermalGlow2.material.color.setHex(0xFF4020);
    this.thermalGlow2.position.copy(this.thermalGlow.position);
    this.thermalGlow2.scale.set(
      120 * WS, (GEOM.mB - GEOM.mT) * WS * 1.2, 120 * WS
    );
    this.group.add(this.thermalGlow2);
  }

  // ── String/ooze system ──
  buildStringSystem() {
    this.stringMeshes = [];
  }

  // ── Die swell indicator ──
  buildDieSwellIndicator() {
    // Bulge ring below nozzle tip - updated dynamically
    this.swellRing = null;
  }

  // ── Per-frame update ──
  update(physics) {
    this.updateVapor(physics);
    this.updateBubbles(physics);
    this.updateThermalGlow(physics);
    this.updateStrings(physics);
    this.updateDieSwell(physics);
  }

  updateVapor(physics) {
    // Remove old sprites
    for (const s of this.vaporSprites) {
      this.group.remove(s);
      s.material.dispose();
    }
    this.vaporSprites = [];

    // Create sprites for active vapor
    const maxShow = Math.min(physics.vapor.length, this.maxVapor);
    for (let i = 0; i < maxShow; i++) {
      const v = physics.vapor[i];
      const tex = v.type === "steam" ? this.vaporTexture : this.smokeTexture;
      const spriteMat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: v.life * 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(v.x, v.y, v.z);
      sprite.scale.set(v.r * 2, v.r * 2, 1);
      this.group.add(sprite);
      this.vaporSprites.push(sprite);
    }
  }

  updateBubbles(physics) {
    const bubbles = physics.bubbles;
    let count = 0;

    for (let i = 0; i < bubbles.length && count < this.maxBubbles; i++) {
      const b = bubbles[i];
      const x = b.r * Math.cos(b.theta) * WS;
      const z = b.r * Math.sin(b.theta) * WS;
      const y = simToWorld(b.y);

      this._bubbleDummy.position.set(x, y, z);
      const s = b.radius;
      this._bubbleDummy.scale.set(s, s, s);
      this._bubbleDummy.updateMatrix();
      this.bubbleMesh.setMatrixAt(count, this._bubbleDummy.matrix);
      count++;
    }
    this.bubbleMesh.count = count;
    if (count > 0) this.bubbleMesh.instanceMatrix.needsUpdate = true;
  }

  updateThermalGlow(physics) {
    const m = physics.getMat();
    const heatRatio = clamp((physics.params.pt - m.mt) / 60, 0, 1);

    this.thermalGlow.material.opacity = heatRatio * 0.08;
    this.thermalGlow2.material.opacity = heatRatio * 0.03;

    // Pulse slightly
    const pulse = 1 + Math.sin(physics.tick * 0.03) * 0.02;
    this.thermalGlow.scale.set(
      90 * WS * pulse, (GEOM.mB - GEOM.mT) * WS * 0.8, 90 * WS * pulse
    );
  }

  updateStrings(physics) {
    // Remove old strings
    for (const m of this.stringMeshes) {
      this.group.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.stringMeshes = [];

    const mat = physics.getMat();
    const matColor = new THREE.Color(mat.col);

    for (const s of physics.strings) {
      const x = s.r * Math.cos(s.theta) * WS;
      const z = s.r * Math.sin(s.theta) * WS;
      const topY = simToWorld(GEOM.nB + 2);
      const sway = Math.sin(s.sway + physics.tick * .05) * 2 * WS;

      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, topY, z),
        new THREE.Vector3(x + sway * .5, topY - s.len * .3 * WS, z),
        new THREE.Vector3(x + sway, topY - s.len * .6 * WS, z + sway * .3),
        new THREE.Vector3(x + sway * .3, topY - s.len * WS, z)
      ]);

      const geo = new THREE.TubeGeometry(curve, 8, s.thickness * WS * s.life * 0.5, 4, false);
      const stringMat = new THREE.MeshStandardMaterial({
        color: matColor,
        transparent: true,
        opacity: s.life * 0.6,
        roughness: 0.5
      });
      const mesh = new THREE.Mesh(geo, stringMat);
      this.group.add(mesh);
      this.stringMeshes.push(mesh);
    }
  }

  updateDieSwell(physics) {
    const ds = physics.dieSwell;
    if (ds <= 1.02) {
      if (this.swellRing) {
        this.group.remove(this.swellRing);
        this.swellRing.geometry.dispose();
        this.swellRing.material.dispose();
        this.swellRing = null;
      }
      return;
    }

    const nw = (physics.params.nd + physics.nozzleWear) * PX * WS;
    const swellR = nw / 2 * ds;
    const tipY = simToWorld(GEOM.nB);

    if (this.swellRing) {
      this.group.remove(this.swellRing);
      this.swellRing.geometry.dispose();
      this.swellRing.material.dispose();
    }

    const geo = new THREE.TorusGeometry(swellR, swellR * 0.3, 8, 32);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xD09040,
      transparent: true,
      opacity: 0.4,
      emissive: 0xCC7030,
      emissiveIntensity: 0.1,
      roughness: 0.5
    });
    this.swellRing = new THREE.Mesh(geo, mat);
    this.swellRing.position.set(0, tipY - 3 * WS, 0);
    this.swellRing.rotation.x = Math.PI / 2;
    this.group.add(this.swellRing);
  }

  dispose() {
    for (const s of this.vaporSprites) {
      this.group.remove(s);
      s.material.dispose();
    }
    for (const m of this.stringMeshes) {
      this.group.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.bubbleMesh.geometry.dispose();
    this.bubbleMesh.material.dispose();
    this.thermalGlow.geometry.dispose();
    this.thermalGlow.material.dispose();
    this.thermalGlow2.geometry.dispose();
    this.thermalGlow2.material.dispose();
    if (this.swellRing) {
      this.swellRing.geometry.dispose();
      this.swellRing.material.dispose();
    }
    this.scene.remove(this.group);
  }
}
