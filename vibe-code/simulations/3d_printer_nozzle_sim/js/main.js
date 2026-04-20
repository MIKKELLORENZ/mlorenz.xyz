// ══════════════════════════════════════════════════════════════
//          MAIN — Scene Setup, Camera, Animation Loop
// ══════════════════════════════════════════════════════════════

class WoodFilamentSimulator3D {
  constructor() {
    this.running = true;
    this.clock = new THREE.Clock();

    this.initScene();
    this.initCamera();
    this.initLights();
    this.initRenderer();
    this.initOrbitControls();

    // Physics engine
    this.physics = new PhysicsEngine();

    // 3D renderers
    this.nozzle = new NozzleAssembly(this.scene);
    this.particleRenderer = new ParticleRenderer(this.scene, 500);
    this.filament = new FilamentRenderer(this.scene);
    this.effects = new EffectsRenderer(this.scene);

    // UI
    this.ui = new SimUI(this.physics, {
      onReset: () => this.reset(),
      onRetract: () => this.doRetract(),
      onPause: () => { this.running = false; },
      onResume: () => { this.running = true; },
      onMaterialChange: (k) => this.changeMaterial(k),
      onParamChange: (key, val) => this.onParamHardReset(key, val),
      onParamLive: (key, val) => { /* already set on physics.params */ },
      onCameraPreset: (id) => this.setCameraPreset(id),
      onToggleCutaway: (enabled) => this.toggleCutaway(enabled),
      onExportCSV: () => this.ui.exportCSV()
    });

    // Know-how modal
    this.buildKnowHowModal();

    // Start
    this.animate();

    // Handle resize
    window.addEventListener('resize', () => this.onResize());
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1714);
    // Subtle fog for depth
    this.scene.fog = new THREE.FogExp2(0x1a1714, 0.04);
  }

  initCamera() {
    const container = document.getElementById('viewport');
    const w = container.clientWidth, h = container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 200);
    // Default: front cross-section view
    // Assembly spans y=-1 (build plate) to y=12 (extruder), center ~y=5
    this.camera.position.set(0, 6, 12);
    this.camera.lookAt(0, 6, 0);
  }

  initLights() {
    // Ambient
    const ambient = new THREE.AmbientLight(0xB0A898, 0.4);
    this.scene.add(ambient);

    // Key light (warm, from upper-right front)
    const key = new THREE.DirectionalLight(0xFFEEDD, 0.8);
    key.position.set(8, 15, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 15;
    key.shadow.camera.bottom = -5;
    this.scene.add(key);

    // Fill light (cool, from left)
    const fill = new THREE.DirectionalLight(0xAABBDD, 0.3);
    fill.position.set(-8, 6, 6);
    this.scene.add(fill);

    // Rim light (from behind)
    const rim = new THREE.DirectionalLight(0xFFDDCC, 0.2);
    rim.position.set(0, 4, -10);
    this.scene.add(rim);

    // Point light inside heater block area for glow
    this.heaterLight = new THREE.PointLight(0xFF6030, 0.3, 8);
    const heaterY = simToWorld((GEOM.mT + GEOM.mB) / 2);
    this.heaterLight.position.set(0, heaterY, 0);
    this.scene.add(this.heaterLight);
  }

  initRenderer() {
    const container = document.getElementById('viewport');
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);
  }

  initOrbitControls() {
    // Simple orbit controls (manual implementation since we're using vanilla three.min.js)
    this.orbit = {
      theta: 0,
      phi: Math.PI / 3,
      radius: 12,
      target: new THREE.Vector3(0, 6, 0),
      autoRotate: false,
      autoRotateSpeed: 0.002,
      isDragging: false,
      lastX: 0, lastY: 0
    };

    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', (e) => {
      this.orbit.isDragging = true;
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
      this.orbit.autoRotate = false;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!this.orbit.isDragging) return;
      const dx = e.clientX - this.orbit.lastX;
      const dy = e.clientY - this.orbit.lastY;
      this.orbit.theta -= dx * 0.005;
      this.orbit.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.orbit.phi - dy * 0.005));
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
    });

    canvas.addEventListener('mouseup', () => { this.orbit.isDragging = false; });
    canvas.addEventListener('mouseleave', () => { this.orbit.isDragging = false; });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.radius = Math.max(3, Math.min(30, this.orbit.radius + e.deltaY * 0.01));
    }, { passive: false });

    // Touch support
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.orbit.isDragging = true;
        this.orbit.lastX = e.touches[0].clientX;
        this.orbit.lastY = e.touches[0].clientY;
        this.orbit.autoRotate = false;
      }
    });
    canvas.addEventListener('touchmove', (e) => {
      if (!this.orbit.isDragging || e.touches.length !== 1) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - this.orbit.lastX;
      const dy = e.touches[0].clientY - this.orbit.lastY;
      this.orbit.theta -= dx * 0.005;
      this.orbit.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.orbit.phi - dy * 0.005));
      this.orbit.lastX = e.touches[0].clientX;
      this.orbit.lastY = e.touches[0].clientY;
    }, { passive: false });
    canvas.addEventListener('touchend', () => { this.orbit.isDragging = false; });

    this.updateCamera();
  }

  updateCamera() {
    const o = this.orbit;
    if (o.autoRotate) o.theta += o.autoRotateSpeed;

    const x = o.radius * Math.sin(o.phi) * Math.sin(o.theta);
    const y = o.radius * Math.cos(o.phi);
    const z = o.radius * Math.sin(o.phi) * Math.cos(o.theta);

    this.camera.position.set(
      o.target.x + x,
      o.target.y + y,
      o.target.z + z
    );
    this.camera.lookAt(o.target);
  }

  // ── Camera presets ──
  setCameraPreset(id) {
    const o = this.orbit;
    switch (id) {
      case 'front':
        o.theta = 0; o.phi = Math.PI / 2.2; o.radius = 12;
        o.target.set(0, 6, 0);
        o.autoRotate = false;
        break;
      case 'orbit':
        o.autoRotate = true;
        o.autoRotateSpeed = 0.005;
        break;
      case 'top':
        o.theta = 0; o.phi = 0.15; o.radius = 16;
        o.target.set(0, 6, 0);
        o.autoRotate = false;
        break;
      case 'closeup':
        o.theta = 0.3; o.phi = Math.PI / 2; o.radius = 5;
        o.target.set(0, simToWorld(GEOM.nB) + 0.5, 0);
        o.autoRotate = false;
        break;
    }
    this.updateCamera();
  }

  toggleCutaway(enabled) {
    this.nozzle.toggleCutaway(enabled);
  }

  // ── Material change ──
  changeMaterial(k) {
    const m = MAT[k];
    this.physics.params.mat = k;
    this.physics.params.pt = m.pt;
    this.reset();
  }

  // ── Hard reset param (clears particles) ──
  onParamHardReset(key, val) {
    this.physics.particles = [];
    this.physics.bedParticles = [];
    this.physics.bedOffset = 0;
    this.physics.clog = { a: false, ps: [], sv: 0, pr: 0, cn: 0 };
    this.physics.spring = { c: 0, e: 0 };
    this.physics.prePopulated = false;
    this.physics.vapor = [];
    this.physics.bubbles = [];
    this.physics.strings = [];
    this.physics.beads = [];
    this.physics.drips = [];
  }

  // ── Full reset ──
  reset() {
    this.physics.reset();
    this.ui.updateStats();
  }

  // ── Retract ──
  doRetract() {
    if (this.physics.retraction.active) return;
    this.physics.retraction = {
      active: true, t: 0, dist: this.physics.params.ret
    };
  }

  // ── Know-how modal ──
  buildKnowHowModal() {
    const helpBtn = document.getElementById('help-btn');
    const modal = document.getElementById('knowhow-modal');
    const closeBtn = document.getElementById('knowhow-close');
    const content = document.getElementById('knowhow-content');

    if (content) {
      let html = '';
      for (const item of KNOW_HOW) {
        html += `<div class="kh-item"><div class="kh-title">${item.t}</div><div class="kh-desc">${item.d}</div></div>`;
      }
      content.innerHTML = html;
    }

    if (helpBtn && modal) {
      helpBtn.addEventListener('click', () => modal.classList.add('show'));
    }
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => modal.classList.remove('show'));
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
      });
    }
  }

  // ── Resize ──
  onResize() {
    const container = document.getElementById('viewport');
    const w = container.clientWidth, h = container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ── Animation loop ──
  animate() {
    requestAnimationFrame(() => this.animate());

    if (this.running) {
      // Run physics step
      this.physics.step();

      // Update 3D renderers
      this.nozzle.update(this.physics);
      this.particleRenderer.update(this.physics);
      this.filament.update(this.physics);
      this.effects.update(this.physics);

      // Heater light intensity
      const m = this.physics.getMat();
      const heatRatio = clamp((this.physics.params.pt - m.mt) / 60, 0, 1);
      this.heaterLight.intensity = 0.1 + heatRatio * 0.4;

      // Update UI every 15 frames
      if (this.physics.tick % 15 === 0) {
        this.ui.updateStats();
      }
    }

    // Always update camera (for orbit controls)
    this.updateCamera();

    // Render
    this.renderer.render(this.scene, this.camera);
  }
}

// ── Start ──
window.addEventListener('DOMContentLoaded', () => {
  window.sim = new WoodFilamentSimulator3D();
});
