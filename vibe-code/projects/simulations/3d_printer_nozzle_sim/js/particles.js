// ══════════════════════════════════════════════════════════════
//          PARTICLE RENDERING — InstancedMesh System
// ══════════════════════════════════════════════════════════════

class ParticleRenderer {
  constructor(scene, maxParticles = 500) {
    this.scene = scene;
    this.maxParticles = maxParticles;

    // Pre-allocate reusable objects (critical for performance)
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._mat4 = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._scale = new THREE.Vector3();
    this._pos = new THREE.Vector3();

    this.buildGeometryPool();
    this.buildInstancedMeshes();
  }

  // Pre-generate pool of fiber shape variants — elongated dodecahedrons
  buildGeometryPool() {
    this.fiberGeometries = [];
    for (let v = 0; v < 15; v++) {
      // Use a dodecahedron with random scale stretching for wood-fiber look
      const geo = new THREE.DodecahedronGeometry(1, 0);
      // Stretch along one axis to create fiber-like shape
      const elongation = 1.2 + Math.random() * 0.8;
      const positions = geo.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        // Random vertex perturbation for irregularity
        const x = positions.getX(i) * (1 + (Math.random() - 0.5) * 0.3);
        const y = positions.getY(i) * elongation;
        const z = positions.getZ(i) * (1 + (Math.random() - 0.5) * 0.2);
        positions.setXYZ(i, x, y, z);
      }
      positions.needsUpdate = true;
      geo.computeVertexNormals();
      this.fiberGeometries.push(geo);
    }

    // Plastic particle geometry (sphere)
    this.plasticGeo = new THREE.SphereGeometry(1, 8, 6);
  }

  buildInstancedMeshes() {
    // Wood fiber instanced mesh — use first variant as representative
    const fiberMat = new THREE.MeshStandardMaterial({
      color: 0xC8A878,
      roughness: 0.85,
      metalness: 0.05,
      vertexColors: false
    });
    // We'll use per-instance color via InstancedBufferAttribute
    this.fiberMesh = new THREE.InstancedMesh(
      this.fiberGeometries[0], fiberMat, this.maxParticles
    );
    this.fiberMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Per-instance color buffer
    this.fiberColors = new Float32Array(this.maxParticles * 3);
    this.fiberMesh.instanceColor = new THREE.InstancedBufferAttribute(this.fiberColors, 3);
    this.fiberMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.fiberMesh.count = 0;
    this.fiberMesh.frustumCulled = false;
    this.scene.add(this.fiberMesh);

    // Plastic particle instanced mesh
    const plasticMat = new THREE.MeshStandardMaterial({
      color: 0xD0B898,
      roughness: 0.6,
      metalness: 0.05
    });
    this.plasticMesh = new THREE.InstancedMesh(
      this.plasticGeo, plasticMat, this.maxParticles
    );
    this.plasticMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.plasticColors = new Float32Array(this.maxParticles * 3);
    this.plasticMesh.instanceColor = new THREE.InstancedBufferAttribute(this.plasticColors, 3);
    this.plasticMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.plasticMesh.count = 0;
    this.plasticMesh.frustumCulled = false;
    this.scene.add(this.plasticMesh);
  }

  // Convert particle color string to RGB array [0-1]
  parseColor(colorStr) {
    if (colorStr.startsWith('#')) {
      return hexToRgbNorm(colorStr);
    }
    // Parse "rgb(r,g,b)" format
    const m = colorStr.match(/(\d+)/g);
    if (m && m.length >= 3) {
      return [parseInt(m[0]) / 255, parseInt(m[1]) / 255, parseInt(m[2]) / 255];
    }
    return [0.8, 0.66, 0.47]; // fallback wood color
  }

  getParticleColor(pt, mat) {
    let rgb;
    if (pt.sk) {
      rgb = pt.br ? [0.83, 0.27, 0.27] : [0.8, 0.2, 0.2]; // red for stuck/bridged
    } else if (pt.cb > .2) {
      const base = this.parseColor(pt.cl);
      const dark = [0.16, 0.1, 0.03];
      const t = pt.cb * .8;
      rgb = lerpColor3(base, dark, t);
    } else if (pt.mp > 0) {
      const base = this.parseColor(pt.cl);
      const melt = hexToRgbNorm(mat.colMelt);
      rgb = lerpColor3(base, melt, pt.mp * .4);
    } else {
      rgb = this.parseColor(pt.cl);
    }

    // Moisture tint
    if (pt.moist && pt.fr) {
      rgb = lerpColor3(rgb, [0.53, 0.6, 0.67], 0.15);
    }

    return rgb;
  }

  update(physics) {
    const particles = physics.particles;
    const mat = physics.getMat();
    let fiberIdx = 0, plasticIdx = 0;

    for (const pt of particles) {
      if (pt.y > GEOM.H + 20 || pt.y < GEOM.fTY - 10) continue;

      const pos = physics.getParticleWorldPos(pt);
      const radius = pt.radius * WS;
      const rgb = this.getParticleColor(pt, mat);

      if (pt.tp === "w") {
        if (fiberIdx >= this.maxParticles) continue;

        // Position
        this._pos.set(pos.x, pos.y, pos.z);

        // Rotation including fiber angle and velocity-based rotation
        this._euler.set(pt.fiberAngle, pt.ro, 0);
        this._quat.setFromEuler(this._euler);

        // Scale with stretching
        const stretch = pt.stretch || 1;
        const baseScale = radius * 0.8;
        this._scale.set(
          baseScale * stretch,
          baseScale / Math.sqrt(stretch),
          baseScale
        );

        this._dummy.position.copy(this._pos);
        this._dummy.quaternion.copy(this._quat);
        this._dummy.scale.copy(this._scale);
        this._dummy.updateMatrix();

        this.fiberMesh.setMatrixAt(fiberIdx, this._dummy.matrix);
        this.fiberColors[fiberIdx * 3] = rgb[0];
        this.fiberColors[fiberIdx * 3 + 1] = rgb[1];
        this.fiberColors[fiberIdx * 3 + 2] = rgb[2];

        // Alpha via opacity encoding (frozen particles slightly transparent)
        fiberIdx++;
      } else {
        if (plasticIdx >= this.maxParticles) continue;

        this._pos.set(pos.x, pos.y, pos.z);
        this._scale.set(radius, radius, radius);
        this._dummy.position.copy(this._pos);
        this._dummy.quaternion.identity();
        this._dummy.scale.copy(this._scale);
        this._dummy.updateMatrix();

        this.plasticMesh.setMatrixAt(plasticIdx, this._dummy.matrix);
        this.plasticColors[plasticIdx * 3] = rgb[0];
        this.plasticColors[plasticIdx * 3 + 1] = rgb[1];
        this.plasticColors[plasticIdx * 3 + 2] = rgb[2];

        plasticIdx++;
      }
    }

    // Update counts and mark for GPU upload
    this.fiberMesh.count = fiberIdx;
    if (fiberIdx > 0) {
      this.fiberMesh.instanceMatrix.needsUpdate = true;
      this.fiberMesh.instanceColor.needsUpdate = true;
    }

    this.plasticMesh.count = plasticIdx;
    if (plasticIdx > 0) {
      this.plasticMesh.instanceMatrix.needsUpdate = true;
      this.plasticMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.fiberMesh.geometry.dispose();
    this.fiberMesh.material.dispose();
    this.plasticMesh.geometry.dispose();
    this.plasticMesh.material.dispose();
    this.scene.remove(this.fiberMesh);
    this.scene.remove(this.plasticMesh);
    for (const g of this.fiberGeometries) g.dispose();
    this.plasticGeo.dispose();
  }
}
