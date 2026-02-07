/* =============================================================
   SPACE DATA CENTER TYCOON  —  bundle.js
   =============================================================
   Changes implemented:
   (a) Launch control is now inline in a sidebar tab, not a modal
   (b) Rocket launch animation on canvas
   (c) Selectable satellites via click or list
   (d) Contract tab notification with glow + badge count
   (f) "Enable Connection" replaces Beam Data & Align Receiver
   (g) Zoom in/out on canvas with mouse wheel & buttons
   (h) Enemy satellites look distinct (red, angular)
   (i) Earth with day/night cycle
   ============================================================= */

/* ---- Audio ------------------------------------------------ */
class AudioBus {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.muted = false;
  }
  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  async load(name, url) {
    try {
      if (!this.ctx) this.init();
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      this.buffers[name] = await this.ctx.decodeAudioData(buf);
    } catch (_) { /* silent fail */ }
  }
  play(name, vol = 0.35) {
    if (this.muted || !this.ctx || !this.buffers[name]) return;
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    src.buffer = this.buffers[name];
    g.gain.value = vol;
    src.connect(g).connect(this.ctx.destination);
    src.start();
  }
}
const audio = new AudioBus();

/* ---- Helpers ---------------------------------------------- */
const $ = (id) => document.getElementById(id);
const fmt = (n) => {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
};
const fmtMoney = (n) => '$' + fmt(n);

/* ---- Input ------------------------------------------------ */
function initInput() {
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'l') switchTab('launch');
    else if (k === 's') $('btn-solar')?.click();
    else if (k === 'c') $('btn-connect')?.click();
    else if (k === 'j') $('btn-jammer')?.click();
    else if (k === '=' || k === '+') zoomIn();
    else if (k === '-') zoomOut();
  });
}

/* ---- Game State ------------------------------------------- */
const state = {
  money: 11000,
  totalData: 0,
  satisfaction: 70,
  reputation: 1.0,
  dataCenters: [],
  capacityLimit: 4,
  selectedCenter: -1,
  systems: {
    power: { level: 1, max: 8 },
    connection: { level: 1, max: 8, cooldown: 0 }
  },
  contracts: [],
  activeContracts: [],
  contractsCompleted: 0,
  ai: {
    centers: 1,
    satisfaction: 55,
    disruption: false,
    disruptionTimer: 0,
    score: 0,
    nextAction: 30
  },
  bonuses: {
    throughputMult: 1,
    costReduction: 0,
    contractBonus: 0
  },
  goals: [],
  tutorial: { step: 0, done: false },
  tick: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  rockets: [],
  jamActive: false,
  jamTimer: 0,
  lastOfferCount: 0,
  targetContract: null,
  activeTab: 'ops'
};

/* ---- UI refs ---------------------------------------------- */
const ui = {};
function cacheUI() {
  const ids = [
    'money', 'money-rate', 'data-rate', 'data-total', 'satisfaction',
    'reputation', 'center-count', 'mission-time', 'ai-score',
    'alert-bar', 'orbit-canvas', 'orbit-container',
    'throughput', 'contracts-active', 'data-beamed', 'beam-status',
    'beam-indicator',
    'btn-solar', 'solar-cost', 'solar-level',
    'btn-connect', 'connect-cost', 'connect-cooldown',
    'btn-jammer', 'jammer-cost',
    'power-bar', 'connect-bar',
    'satellite-list', 'goal-list', 'tab-btn-contracts',
    'tutorial-panel',
    'contract-list', 'active-contract-list',
    'ai-centers', 'ai-satisfaction', 'ai-disruption',
    'upgrade-list', 'upgrade-locked',
    'log',
    'btn-launch', 'launch-cost', 'payload-slider', 'payload-val',
    'throttle-slider', 'throttle-val', 'angle-slider', 'angle-val',
    'launch-readout',
    'selection-info',
    'zoom-in', 'zoom-out', 'zoom-reset',
    'launch-contract-banner'
  ];
  ids.forEach(id => { ui[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = $(id); });
}

/* ---- Orbit Renderer --------------------------------------- */
const orbitRenderer = (() => {
  let canvas, ctx, W, H, stars = [], animFrame;
  let dayNightAngle = 0;
  let lastTime = 0;

  function resize() {
    const cont = $('orbit-container');
    if (!cont) return;
    const r = window.devicePixelRatio || 1;
    W = cont.clientWidth;
    H = cont.clientHeight;
    canvas.width = W * r;
    canvas.height = H * r;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(r, 0, 0, r, 0, 0);
  }

  function initStars(n = 220) {
    stars = [];
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * 3000 - 1000,
        y: Math.random() * 3000 - 1000,
        r: Math.random() * 1.3 + 0.3,
        a: Math.random() * 0.6 + 0.4,
        twinkle: Math.random() * Math.PI * 2
      });
    }
  }

  function spawnRocket(targetOrbit) {
    state.rockets.push({
      x: W / 2,
      y: H,
      targetOrbitRadius: targetOrbit,
      progress: 0,     // 0 → 1 ascent, then satellite appears
      trail: [],
      phase: 'ascend', // ascend → deploy
      deployTimer: 0
    });
  }

  /* --- Drawing Helpers --- */

  function drawStars(timeSec) {
    const z = state.zoom;
    const ox = state.panX;
    const oy = state.panY;
    stars.forEach(s => {
      const sx = (s.x + ox) * z + W / 2;
      const sy = (s.y + oy) * z + H / 2;
      if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) return;
      const flicker = 0.7 + 0.3 * Math.sin(timeSec * 2 + s.twinkle);
      ctx.globalAlpha = s.a * flicker;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(sx, sy, s.r * z, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawEarth(timeSec, dt) {
    const z = state.zoom;
    const cx = W / 2 + state.panX * z;
    const cy = H / 2 + state.panY * z;
    const baseR = Math.min(W, H) * 0.10;
    const r = baseR * z;

    dayNightAngle = (dayNightAngle + dt * 0.01) % (Math.PI * 2);

    // Atmosphere glow (soft outer halo)
    const atmoGrad = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.25);
    atmoGrad.addColorStop(0, 'rgba(80,160,255,0.10)');
    atmoGrad.addColorStop(0.5, 'rgba(59,130,246,0.04)');
    atmoGrad.addColorStop(1, 'rgba(59,130,246,0)');
    ctx.fillStyle = atmoGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.25, 0, Math.PI * 2);
    ctx.fill();

    // Planet base — deep ocean gradient with spherical shading
    const oceanGrad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
    oceanGrad.addColorStop(0, '#1e6b9a');
    oceanGrad.addColorStop(0.45, '#164e72');
    oceanGrad.addColorStop(0.8, '#0d3a56');
    oceanGrad.addColorStop(1, '#082638');
    ctx.fillStyle = oceanGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Clip to planet
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Scrolling longitude offset (horizontal pan gives illusion of rotation)
    const lonOffset = dayNightAngle;

    // Draw continents as spherically-projected blobs
    // Each continent defined by [lon, lat, sizeX, sizeY] in radians
    const continentDefs = [
      // North America
      { lon: -1.6, lat: 0.7, sx: 0.55, sy: 0.45, color: '#1d7a3d', children: [
        { dlon: -0.1, dlat: 0.15, sx: 0.2, sy: 0.15, color: '#228a44' },
      ]},
      // South America
      { lon: -1.0, lat: -0.2, sx: 0.28, sy: 0.55, color: '#1e8a42', children: [
        { dlon: 0.05, dlat: -0.1, sx: 0.15, sy: 0.25, color: '#25964d' },
      ]},
      // Europe
      { lon: 0.15, lat: 0.75, sx: 0.3, sy: 0.22, color: '#1f7a3a', children: [] },
      // Africa
      { lon: 0.3, lat: 0.0, sx: 0.35, sy: 0.55, color: '#22904a', children: [
        { dlon: 0.0, dlat: 0.1, sx: 0.18, sy: 0.28, color: '#2a9e55' },
      ]},
      // Asia
      { lon: 1.2, lat: 0.6, sx: 0.7, sy: 0.45, color: '#1b7f3c', children: [
        { dlon: 0.2, dlat: -0.1, sx: 0.3, sy: 0.2, color: '#208540' },
      ]},
      // Australia
      { lon: 2.1, lat: -0.4, sx: 0.3, sy: 0.22, color: '#249150', children: [] },
      // Antarctica
      { lon: 0.0, lat: -1.25, sx: 1.2, sy: 0.2, color: '#c0d8cc', children: [] },
    ];

    // Project a point from (lon, lat) onto the visible disc
    function projectSphere(lon, lat) {
      const x = Math.cos(lat) * Math.sin(lon);
      const y = -Math.sin(lat);
      const zz = Math.cos(lat) * Math.cos(lon);
      return { x: x * r, y: y * r, visible: zz > -0.1 };
    }

    // Draw each continent as an elliptical blob
    function drawContinent(def) {
      const clon = def.lon + lonOffset;
      const clat = def.lat;
      const center = projectSphere(clon, clat);
      if (!center.visible) return;

      // Foreshortening: squeeze the ellipse based on depth
      const depth = Math.cos(clat) * Math.cos(clon + lonOffset - def.lon);
      const foreshorten = Math.max(0.15, Math.cos(clon));

      const ex = def.sx * r * foreshorten;
      const ey = def.sy * r * 0.95;

      if (ex < 1 || ey < 1) return;

      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.ellipse(cx + center.x, cy + center.y, ex, ey, 0, 0, Math.PI * 2);
      ctx.fill();

      // Inner highlight
      ctx.fillStyle = 'rgba(46,160,80,0.18)';
      ctx.beginPath();
      ctx.ellipse(cx + center.x - ex * 0.1, cy + center.y - ey * 0.1, ex * 0.55, ey * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      // Children (sub-regions)
      if (def.children) {
        def.children.forEach(ch => {
          const subCenter = projectSphere(clon + ch.dlon, clat + ch.dlat);
          if (!subCenter.visible) return;
          const subForeshorten = Math.max(0.15, Math.cos(clon + ch.dlon));
          const sx2 = ch.sx * r * subForeshorten;
          const sy2 = ch.sy * r * 0.95;
          if (sx2 < 1 || sy2 < 1) return;
          ctx.fillStyle = ch.color;
          ctx.beginPath();
          ctx.ellipse(cx + subCenter.x, cy + subCenter.y, sx2, sy2, 0, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    continentDefs.forEach(drawContinent);

    // Cloud wisps (rotate slightly faster)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = r * 0.035;
    ctx.lineCap = 'round';
    const cloudOff = lonOffset * 1.2;
    for (let ci = 0; ci < 6; ci++) {
      const cLon = cloudOff + ci * 1.1;
      const cLat = (ci % 3 - 1) * 0.45;
      const cp = projectSphere(cLon, cLat);
      if (!cp.visible) continue;
      ctx.beginPath();
      ctx.arc(cx + cp.x, cy + cp.y, r * (0.2 + ci * 0.05), -0.4, 0.4);
      ctx.stroke();
    }

    // Day/night terminator — smooth gradient across the disc
    const sunLon = -lonOffset + Math.PI; // sun is opposite the rotation
    const sunX = Math.sin(sunLon);
    const grad = ctx.createLinearGradient(
      cx + sunX * r * 1.1, cy, cx - sunX * r * 1.1, cy
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.38, 'rgba(0,0,0,0)');
    grad.addColorStop(0.52, 'rgba(0,0,15,0.30)');
    grad.addColorStop(0.68, 'rgba(0,0,20,0.50)');
    grad.addColorStop(1, 'rgba(0,2,20,0.65)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // City lights on night side
    const cityCoords = [
      [-1.5, 0.7], [-1.3, 0.6], [-0.9, -0.4], [0.2, 0.8],
      [0.3, 0.0], [0.35, 0.15], [1.3, 0.6], [1.5, 0.55],
      [2.0, -0.35], [1.0, 0.4], [-1.6, 0.55], [0.6, 0.75],
    ];
    ctx.fillStyle = 'rgba(255, 210, 80, 0.7)';
    cityCoords.forEach(([cLon, cLat]) => {
      const sp = projectSphere(cLon + lonOffset, cLat);
      if (!sp.visible) return;
      const lx = cx + sp.x;
      const ly = cy + sp.y;
      // Check if on dark side
      const relX = sp.x / r;
      const darkSide = relX * sunX < -0.05;
      if (darkSide) {
        ctx.shadowColor = 'rgba(255, 210, 80, 0.5)';
        ctx.shadowBlur = 3 * z;
        ctx.beginPath();
        ctx.arc(lx, ly, 1.3 * z, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.shadowBlur = 0;

    // Spherical shading overlay (gives 3D curvature feel)
    const sphereShade = ctx.createRadialGradient(
      cx - r * 0.3, cy - r * 0.3, r * 0.1, cx + r * 0.1, cy + r * 0.1, r * 1.05
    );
    sphereShade.addColorStop(0, 'rgba(255,255,255,0.06)');
    sphereShade.addColorStop(0.5, 'rgba(0,0,0,0)');
    sphereShade.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = sphereShade;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // end planet clip

    // Atmosphere rim
    const rimGrad = ctx.createRadialGradient(cx, cy, r * 0.94, cx, cy, r * 1.06);
    rimGrad.addColorStop(0, 'rgba(100,180,255,0)');
    rimGrad.addColorStop(0.5, 'rgba(100,180,255,0.12)');
    rimGrad.addColorStop(1, 'rgba(100,180,255,0)');
    ctx.fillStyle = rimGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
    ctx.fill();

    // Sunlit limb highlight
    const sunAngle = Math.atan2(0, sunX) + Math.PI;
    ctx.strokeStyle = 'rgba(160,215,255,0.18)';
    ctx.lineWidth = 1.8 * z;
    ctx.beginPath();
    ctx.arc(cx, cy, r, sunAngle - 0.9, sunAngle + 0.9);
    ctx.stroke();
  }

  function getEarthRadius() {
    return Math.min(W, H) * 0.10;
  }

  function getOrbitRadius(index) {
    const baseR = getEarthRadius();
    return baseR + 80 + index * 48;
  }

  function getOrbitAngularSpeed(index) {
    const baseR = getEarthRadius();
    const orbitR = getOrbitRadius(index);
    const ratio = baseR / Math.max(orbitR, baseR + 1);
    return 0.0024 * Math.pow(ratio, 1.1);
  }

  function drawOrbitRings() {
    const z = state.zoom;
    const cx = W / 2 + state.panX * z;
    const cy = H / 2 + state.panY * z;
    const n = Math.max(state.capacityLimit, state.dataCenters.length + 2);
    for (let i = 0; i < n; i++) {
      const r = getOrbitRadius(i) * z;
      ctx.strokeStyle = i < state.dataCenters.length
        ? 'rgba(59,130,246,0.2)'
        : 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawDataCenter(i, dt) {
    const z = state.zoom;
    const cx = W / 2 + state.panX * z;
    const cy = H / 2 + state.panY * z;
    const dc = state.dataCenters[i];
    const orbitR = getOrbitRadius(i) * z;
    const angle = dc.angle + dt * getOrbitAngularSpeed(i);
    dc.angle = angle;

    const x = cx + Math.cos(angle) * orbitR;
    const y = cy + Math.sin(angle) * orbitR;
    dc.screenX = x;
    dc.screenY = y;

    const s = 7.5 * z; // size
    const selected = state.selectedCenter === i;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);

    // Selection ring
    if (selected) {
      ctx.strokeStyle = 'rgba(6,182,212,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Main body - rounded rectangle
    ctx.fillStyle = '#1e40af';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    roundRect(ctx, -s * 0.6, -s * 0.4, s * 1.2, s * 0.8, 3);
    ctx.fill();
    ctx.stroke();

    // Solar panels (left & right)
    ctx.fillStyle = '#1e3a5f';
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1;
    // Left panel
    ctx.fillRect(-s * 1.5, -s * 0.25, s * 0.7, s * 0.5);
    ctx.strokeRect(-s * 1.5, -s * 0.25, s * 0.7, s * 0.5);
    // Right panel
    ctx.fillRect(s * 0.8, -s * 0.25, s * 0.7, s * 0.5);
    ctx.strokeRect(s * 0.8, -s * 0.25, s * 0.7, s * 0.5);
    // Panel grid lines
    ctx.strokeStyle = 'rgba(96,165,250,0.3)';
    ctx.lineWidth = 0.5;
    for (let g = 1; g <= 2; g++) {
      const gy = -s * 0.25 + g * s * 0.5 / 3;
      ctx.beginPath();
      ctx.moveTo(-s * 1.5, gy); ctx.lineTo(-s * 0.8, gy);
      ctx.moveTo(s * 0.8, gy); ctx.lineTo(s * 1.5, gy);
      ctx.stroke();
    }

    // Antenna
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.4);
    ctx.lineTo(0, -s * 0.9);
    ctx.stroke();
    // Dish
    ctx.beginPath();
    ctx.arc(0, -s * 0.9, s * 0.2, Math.PI, 0);
    ctx.stroke();

    // Status LED
    ctx.fillStyle = dc.online ? '#22c55e' : '#ef4444';
    ctx.shadowColor = dc.online ? '#22c55e' : '#ef4444';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(s * 0.3, -s * 0.15, 2 * z, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  function drawEnemySatellite(i, timeSec) {
    const z = state.zoom;
    const cx = W / 2 + state.panX * z;
    const cy = H / 2 + state.panY * z;
    const enemyIndex = state.capacityLimit + 1 + i;
    const orbitR = getOrbitRadius(enemyIndex) * z;
    const angle = timeSec * getOrbitAngularSpeed(enemyIndex) * 1.35 + i * 1.5;

    const x = cx + Math.cos(angle) * orbitR;
    const y = cy + Math.sin(angle) * orbitR;
    const s = 6.5 * z; // slightly smaller than player sats

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);

    // Faint red outer glow
    ctx.shadowColor = 'rgba(239,68,68,0.35)';
    ctx.shadowBlur = 6 * z;

    // Main body - rounded rectangle (same shape as player, red tint)
    ctx.fillStyle = '#7f1d1d';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    roundRect(ctx, -s * 0.55, -s * 0.35, s * 1.1, s * 0.7, 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Solar panels (left & right) - dark maroon
    ctx.fillStyle = '#5c1a1a';
    ctx.strokeStyle = '#b91c1c';
    ctx.lineWidth = 1;
    ctx.fillRect(-s * 1.3, -s * 0.2, s * 0.6, s * 0.4);
    ctx.strokeRect(-s * 1.3, -s * 0.2, s * 0.6, s * 0.4);
    ctx.fillRect(s * 0.7, -s * 0.2, s * 0.6, s * 0.4);
    ctx.strokeRect(s * 0.7, -s * 0.2, s * 0.6, s * 0.4);

    // Panel grid lines
    ctx.strokeStyle = 'rgba(185,28,28,0.3)';
    ctx.lineWidth = 0.5;
    for (let g = 1; g <= 2; g++) {
      const gy = -s * 0.2 + g * s * 0.4 / 3;
      ctx.beginPath();
      ctx.moveTo(-s * 1.3, gy); ctx.lineTo(-s * 0.7, gy);
      ctx.moveTo(s * 0.7, gy); ctx.lineTo(s * 1.3, gy);
      ctx.stroke();
    }

    // Antenna
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.35);
    ctx.lineTo(0, -s * 0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -s * 0.75, s * 0.15, Math.PI, 0);
    ctx.stroke();

    // Status LED - always red/orange
    ctx.fillStyle = '#f97316';
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(s * 0.25, -s * 0.1, 1.8 * z, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  function drawBeamEffects(timeSec) {
    if (state.dataCenters.length === 0) return;
    const z = state.zoom;
    const cx = W / 2 + state.panX * z;
    const cy = H / 2 + state.panY * z;

    state.dataCenters.forEach((dc, i) => {
      if (!dc.online) return;
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 4 + i * 0.8);
      ctx.strokeStyle = `rgba(34,197,94,${0.15 + pulse * 0.15})`;
      ctx.lineWidth = 1.5 * z;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(dc.screenX || 0, dc.screenY || 0);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function drawJamEffect(timeSec) {
    if (!state.jamActive) return;
    const z = state.zoom;
    const cx = W / 2 + state.panX * z;
    const cy = H / 2 + state.panY * z;
    const baseR = getEarthRadius();

    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 8);
    const r = (baseR + 120) * z;
    const grad = ctx.createRadialGradient(cx, cy, baseR * z, cx, cy, r);
    grad.addColorStop(0, `rgba(239,68,68,${0.05 + pulse * 0.05})`);
    grad.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRockets(timeSec, dt) {
    const z = state.zoom;
    const cx = W / 2 + state.panX * z;
    const cy = H / 2 + state.panY * z;
    const step = dt * 60;

    for (let i = state.rockets.length - 1; i >= 0; i--) {
      const rk = state.rockets[i];
      const isAI = rk.owner === 'ai';
      const speedMult = 0.5 + (rk.throttle || 0.85) * 0.5;

      if (rk.phase === 'ascend') {
        rk.progress += dt * 0.18 * speedMult;

        const orbitR = rk.targetOrbitRadius * z;
        const targetX = cx + Math.cos(rk.targetAngle) * orbitR;
        const targetY = cy + Math.sin(rk.targetAngle) * orbitR;

        // Launch from Earth surface with parabolic gravity-turn arc
        const earthR = getEarthRadius() * z;
        const launchAngle = Math.atan2(targetY - cy, targetX - cx);
        const startX = cx + Math.cos(launchAngle) * earthR;
        const startY = cy + Math.sin(launchAngle) * earthR;

        // Control point offset perpendicular to flight path for parabolic curve
        const midX = (startX + targetX) / 2;
        const midY = (startY + targetY) / 2;
        const perpAngle = launchAngle + Math.PI / 2;
        const arcBulge = (orbitR - earthR) * 0.45;
        const ctrlX = midX + Math.cos(perpAngle) * arcBulge;
        const ctrlY = midY + Math.sin(perpAngle) * arcBulge;

        const t = easeOutCubic(Math.min(rk.progress, 1));
        // Quadratic bezier: start → ctrl → target
        const omt = 1 - t;
        const rx = omt * omt * startX + 2 * omt * t * ctrlX + t * t * targetX;
        const ry = omt * omt * startY + 2 * omt * t * ctrlY + t * t * targetY;

        rk.screenX = rx;
        rk.screenY = ry;

        // Compute tangent direction along the bezier curve
        const tangentX = 2 * (1 - t) * (ctrlX - startX) + 2 * t * (targetX - ctrlX);
        const tangentY = 2 * (1 - t) * (ctrlY - startY) + 2 * t * (targetY - ctrlY);
        const bodyAngle = Math.atan2(tangentY, tangentX);

        // Trail particles (60 max, orange→red fade)
        const trailColor = isAI ? [239, 68, 68] : [249, 115, 22];
        rk.trail.push({ x: rx, y: ry, a: 1, s: (2 + (rk.payload || 0.75) * 2) });
        if (rk.trail.length > 60) rk.trail.shift();
        rk.trail.forEach((p) => {
          p.a -= dt * 1.1;
          if (p.a > 0) {
            const fadeG = Math.max(0, trailColor[1] - (1 - p.a) * 80);
            ctx.fillStyle = `rgba(${trailColor[0]},${fadeG},${trailColor[2]},${p.a * 0.6})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.5, p.s * p.a) * z, 0, Math.PI * 2);
            ctx.fill();
          }
        });

        // Stage separation at ~33%
        if (rk.progress >= 0.33 && !rk.stagesSeparated) {
          rk.stagesSeparated = true;
          const bAngle = bodyAngle;
          for (let b = 0; b < 3; b++) {
            rk.boosters.push({
              x: rx, y: ry,
              vx: Math.cos(bAngle + Math.PI + (b - 1) * 0.4) * (1.5 + Math.random()),
              vy: Math.sin(bAngle + Math.PI + (b - 1) * 0.4) * (1.5 + Math.random()),
              rot: Math.random() * Math.PI * 2,
              spin: (Math.random() - 0.5) * 0.15,
              life: 1
            });
          }
        }

        // Draw falling booster debris
        if (rk.boosters) {
          rk.boosters.forEach(b => {
            b.x += b.vx * step;
            b.y += b.vy * step;
            b.vy += 4.8 * dt;
            b.rot += b.spin * step;
            b.life -= 0.72 * dt;
            if (b.life > 0) {
              ctx.save();
              ctx.translate(b.x, b.y);
              ctx.rotate(b.rot);
              ctx.fillStyle = `rgba(180,180,190,${b.life * 0.7})`;
              ctx.fillRect(-2 * z, -4 * z, 4 * z, 8 * z);
              ctx.restore();
              ctx.fillStyle = `rgba(249,150,50,${b.life * 0.4})`;
              ctx.beginPath();
              ctx.arc(b.x, b.y, 2 * z * b.life, 0, Math.PI * 2);
              ctx.fill();
            }
          });
        }

        // Stage separation flash
        if (rk.progress >= 0.33 && rk.progress < 0.38) {
          const flashAlpha = 1 - (rk.progress - 0.33) / 0.05;
          ctx.fillStyle = `rgba(255,255,200,${flashAlpha * 0.3})`;
          ctx.beginPath();
          ctx.arc(rx, ry, 15 * z, 0, Math.PI * 2);
          ctx.fill();
        }

        // Rocket body — orient along the bezier tangent
        const rScale = 0.8 + (rk.payload || 0.75) * 0.4;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(bodyAngle + Math.PI / 2);

        // Flame
        const fl = (8 + Math.sin(timeSec * 12) * 3) * rScale;
        const fl2 = fl * (0.5 + Math.random() * 0.3);
        ctx.fillStyle = isAI ? '#ef4444' : '#f97316';
        ctx.beginPath();
        ctx.moveTo(-3.5 * z * rScale, 6 * z * rScale);
        ctx.lineTo(0, (6 + fl) * z * rScale);
        ctx.lineTo(3.5 * z * rScale, 6 * z * rScale);
        ctx.fill();
        ctx.fillStyle = isAI ? '#f97316' : '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(-1.5 * z * rScale, 6 * z * rScale);
        ctx.lineTo(0, (6 + fl2) * z * rScale);
        ctx.lineTo(1.5 * z * rScale, 6 * z * rScale);
        ctx.fill();

        // Exhaust glow
        ctx.fillStyle = isAI ? 'rgba(239,68,68,0.12)' : 'rgba(249,115,22,0.12)';
        ctx.beginPath();
        ctx.arc(0, (6 + fl * 0.5) * z * rScale, 6 * z * rScale, 0, Math.PI * 2);
        ctx.fill();

        // Body
        ctx.fillStyle = isAI ? '#991b1b' : '#e2e8f0';
        ctx.beginPath();
        ctx.moveTo(0, -12 * z * rScale);
        ctx.lineTo(-4.5 * z * rScale, 6 * z * rScale);
        ctx.lineTo(4.5 * z * rScale, 6 * z * rScale);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = isAI ? '#ef4444' : '#94a3b8';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Fins
        ctx.fillStyle = isAI ? '#7f1d1d' : '#94a3b8';
        ctx.beginPath();
        ctx.moveTo(-4.5 * z * rScale, 6 * z * rScale);
        ctx.lineTo(-7 * z * rScale, 8 * z * rScale);
        ctx.lineTo(-3 * z * rScale, 4 * z * rScale);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(4.5 * z * rScale, 6 * z * rScale);
        ctx.lineTo(7 * z * rScale, 8 * z * rScale);
        ctx.lineTo(3 * z * rScale, 4 * z * rScale);
        ctx.closePath();
        ctx.fill();

        // Nose
        ctx.fillStyle = isAI ? '#dc2626' : '#ef4444';
        ctx.beginPath();
        ctx.moveTo(0, -12 * z * rScale);
        ctx.lineTo(-2.5 * z * rScale, -6 * z * rScale);
        ctx.lineTo(2.5 * z * rScale, -6 * z * rScale);
        ctx.closePath();
        ctx.fill();

        // Window (player only)
        if (!isAI) {
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(0, -3 * z * rScale, 1.5 * z * rScale, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();

        if (rk.progress >= 1) {
          rk.phase = 'deploy';
          rk.deployTimer = 25;
        }
      } else if (rk.phase === 'deploy') {
        rk.deployTimer--;
        const orbitR = rk.targetOrbitRadius * z;
        const dx = cx + Math.cos(rk.targetAngle) * orbitR;
        const dy = cy + Math.sin(rk.targetAngle) * orbitR;

        if (rk.deployTimer > 12) {
          const flash = (rk.deployTimer - 12) / 13;
          const ringColor = isAI ? `rgba(239,68,68,${flash * 0.4})` : `rgba(59,130,246,${flash * 0.4})`;
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 2 * z;
          ctx.beginPath();
          ctx.arc(dx, dy, (1 - flash) * 25 * z, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = isAI ? `rgba(239,68,68,${flash * 0.2})` : `rgba(59,130,246,${flash * 0.2})`;
          ctx.beginPath();
          ctx.arc(dx, dy, 15 * z * flash, 0, Math.PI * 2);
          ctx.fill();
        }
        if (rk.deployTimer <= 0) {
          // Deploy pending satellite now that animation is complete
          if (rk.pendingDC) {
            state.dataCenters.push(rk.pendingDC);
            renderSatelliteList();
          }
          state.rockets.splice(i, 1);
        }
      }
    }
  }

  function drawLaunchPreview() {
    if (state.activeTab !== 'launch') return;
    if (!ui.angleSlider || !ui.throttleSlider) return;
    if (state.activeContracts.length === 0) return;

    const pending = state.rockets.filter(r => r.pendingDC).length;
    const nextIndex = state.dataCenters.length + pending;
    if (nextIndex >= state.capacityLimit) return;

    const z = state.zoom;
    const cx = W / 2 + state.panX * z;
    const cy = H / 2 + state.panY * z;
    const orbitR = getOrbitRadius(nextIndex) * z;
    const angle = (parseInt(ui.angleSlider.value) / 180) * Math.PI * 2;
    const throttle = parseInt(ui.throttleSlider.value) / 100;

    const tx = cx + Math.cos(angle) * orbitR;
    const ty = cy + Math.sin(angle) * orbitR;
    const markerSize = (6 + throttle * 7) * z;

    const throttleScore = 1 - Math.abs(throttle - 0.85) * 3;
    const angleScore = 1 - Math.abs((parseInt(ui.angleSlider.value) - 50)) / 50;
    const score = 0.5 * Math.max(0, throttleScore) + 0.5 * Math.max(0, angleScore);
    const color = score > 0.65 ? 'rgba(34,197,94,0.85)' : score > 0.35 ? 'rgba(234,179,8,0.85)' : 'rgba(239,68,68,0.85)';

    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 * z;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.translate(tx, ty);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -markerSize);
    ctx.lineTo(markerSize * 0.6, markerSize);
    ctx.lineTo(-markerSize * 0.6, markerSize);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * z;
    ctx.beginPath();
    ctx.arc(0, 0, markerSize * 1.6, -0.6, 0.6);
    ctx.stroke();
    ctx.restore();
  }

  const launchCamera = {
    active: false,
    rocket: null,
    startZoom: 1,
    startPanX: 0,
    startPanY: 0,
    targetZoom: 1.45,
    phase: 'follow'
  };

  function focusRocket(rocket) {
    if (state.zoom >= 1.1) return;
    launchCamera.active = true;
    launchCamera.rocket = rocket;
    launchCamera.startZoom = state.zoom;
    launchCamera.startPanX = state.panX;
    launchCamera.startPanY = state.panY;
    launchCamera.phase = 'follow';
  }

  function updateLaunchCamera() {
    if (!launchCamera.active || !launchCamera.rocket) return;
    const rk = launchCamera.rocket;

    if (launchCamera.phase === 'follow') {
      if (rk.phase !== 'ascend') launchCamera.phase = 'return';
      if (rk.screenX != null && rk.screenY != null) {
        const targetPanX = (rk.screenX - W / 2) / state.zoom;
        const targetPanY = (rk.screenY - H / 2) / state.zoom;
        state.panX += (targetPanX - state.panX) * 0.08;
        state.panY += (targetPanY - state.panY) * 0.08;
      }
      state.zoom += (launchCamera.targetZoom - state.zoom) * 0.06;
      return;
    }

    state.panX += (launchCamera.startPanX - state.panX) * 0.06;
    state.panY += (launchCamera.startPanY - state.panY) * 0.06;
    state.zoom += (launchCamera.startZoom - state.zoom) * 0.06;

    if (Math.abs(state.zoom - launchCamera.startZoom) < 0.01
      && Math.abs(state.panX - launchCamera.startPanX) < 0.5
      && Math.abs(state.panY - launchCamera.startPanY) < 0.5) {
      state.zoom = launchCamera.startZoom;
      state.panX = launchCamera.startPanX;
      state.panY = launchCamera.startPanY;
      launchCamera.active = false;
      launchCamera.rocket = null;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  /* --- Click detection for satellite selection --- */
  function handleCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let found = -1;
    const hitRadius = 22 * state.zoom;

    for (let i = 0; i < state.dataCenters.length; i++) {
      const dc = state.dataCenters[i];
      if (dc.screenX == null) continue;
      const dx = mx - dc.screenX;
      const dy = my - dc.screenY;
      if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
        found = i;
        break;
      }
    }
    selectSatellite(found);
  }

  /* --- Main render loop --- */
  function render(time) {
    if (!ctx) { animFrame = requestAnimationFrame(render); return; }
    const timeSec = time * 0.001;
    const dt = Math.min((time - lastTime) * 0.001 || 0, 0.05);
    lastTime = time;
    ctx.clearRect(0, 0, W, H);

    updateLaunchCamera();

    drawStars(timeSec);
    drawEarth(timeSec, dt);
    drawOrbitRings();
    drawLaunchPreview();
    drawBeamEffects(timeSec);
    drawJamEffect(timeSec);

    state.dataCenters.forEach((_, i) => drawDataCenter(i, dt));
    for (let i = 0; i < state.ai.centers; i++) drawEnemySatellite(i, timeSec);

    drawRockets(timeSec, dt);

    animFrame = requestAnimationFrame(render);
  }

  function init() {
    canvas = $('orbit-canvas');
    ctx = canvas.getContext('2d');
    resize();
    initStars();
    canvas.addEventListener('click', handleCanvasClick);
    window.addEventListener('resize', resize);
    render(0);
  }

  return { init, resize, spawnRocket, getOrbitRadius, focusRocket, get W() { return W; }, get H() { return H; } };
})();

/* ---- Zoom ------------------------------------------------- */
function zoomIn()  { state.zoom = Math.min(state.zoom * 1.15, 3); }
function zoomOut() { state.zoom = Math.max(state.zoom / 1.15, 0.4); }
function zoomReset() { state.zoom = 1; state.panX = 0; state.panY = 0; }

function initZoom() {
  const cont = $('orbit-container');
  cont.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }, { passive: false });

  // Pan with middle mouse or shift+drag
  let panning = false, lastX = 0, lastY = 0;
  cont.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      panning = true;
      lastX = e.clientX;
      lastY = e.clientY;
      e.preventDefault();
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    state.panX += (e.clientX - lastX) / state.zoom;
    state.panY += (e.clientY - lastY) / state.zoom;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { panning = false; });

  ui.zoomIn.addEventListener('click', zoomIn);
  ui.zoomOut.addEventListener('click', zoomOut);
  ui.zoomReset.addEventListener('click', zoomReset);
}

/* ---- Satellite Selection ---------------------------------- */
function selectSatellite(index) {
  state.selectedCenter = index;
  renderSatelliteList();
  renderSelectionInfo();
}

function renderSelectionInfo() {
  const el = ui.selectionInfo;
  if (state.selectedCenter < 0 || state.selectedCenter >= state.dataCenters.length) {
    el.classList.add('hidden');
    return;
  }
  const dc = state.dataCenters[state.selectedCenter];
  el.classList.remove('hidden');
  el.innerHTML = `
    <h4>🛰️ ${dc.name}</h4>
    <div class="si-row"><span class="si-label">Status</span><span class="si-value">${dc.online ? '🟢 Online' : '🔴 Offline'}</span></div>
    <div class="si-row"><span class="si-label">Orbit</span><span class="si-value">#${state.selectedCenter + 1}</span></div>
    <div class="si-row"><span class="si-label">Throughput</span><span class="si-value">${fmt(dc.throughput)}/s</span></div>
    <div class="si-row"><span class="si-label">Uptime</span><span class="si-value">${Math.floor(dc.uptime / 60)}m ${dc.uptime % 60}s</span></div>
  `;
}

function renderSatelliteList() {
  const list = ui.satelliteList;
  if (!list) return;
  if (state.dataCenters.length === 0) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:4px;">No satellites deployed yet.</div>';
    return;
  }
  list.innerHTML = state.dataCenters.map((dc, i) => `
    <div class="sat-item ${state.selectedCenter === i ? 'selected' : ''}" data-idx="${i}">
      <span class="sat-dot ${dc.online ? 'online' : 'offline'}"></span>
      <span class="sat-name">${dc.name}</span>
      <span class="sat-throughput">${fmt(dc.throughput)}/s</span>
    </div>
  `).join('');
  list.querySelectorAll('.sat-item').forEach(el => {
    el.addEventListener('click', () => selectSatellite(parseInt(el.dataset.idx)));
  });
}

/* ---- Launch ----------------------------------------------- */
const launchSystem = (() => {

  function launch() {
    if (state.activeContracts.length === 0) {
      showAlert('Accept a contract before launching a satellite.');
      logMsg('Launch blocked — accept a contract first.', 'bad');
      return;
    }
    const cost = getLaunchCost();
    if (state.money < cost) {
      logMsg('Insufficient funds for launch!', 'bad');
      return;
    }
    if (state.dataCenters.length + state.rockets.filter(r => r.pendingDC).length >= state.capacityLimit) {
      logMsg('Capacity limit reached! Purchase expansion upgrade.', 'bad');
      return;
    }

    const payload = parseInt(ui.payloadSlider.value) / 100;
    const throttle = parseInt(ui.throttleSlider.value) / 100;
    const angle = parseInt(ui.angleSlider.value);

    // Score based on throttle and angle sweet spots
    // Optimal throttle is 80-90%, optimal angle is 40-60°
    const throttleScore = 1 - Math.abs(throttle - 0.85) * 3;
    const angleScore = 1 - Math.abs(angle - 50) / 50;
    const score = 0.35 * payload + 0.35 * Math.max(0, throttleScore) + 0.3 * Math.max(0, angleScore);
    const success = score > 0.42;

    state.money -= cost;

    if (success) {
      const dcIndex = state.dataCenters.length + state.rockets.filter(r => r.pendingDC).length;
      const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];
      const dc = {
        name: 'SDC-' + (names[dcIndex] || dcIndex),
        angle: (angle / 180) * Math.PI * 2,
        online: true,
        throughput: 0,
        uptime: 0,
        screenX: 0,
        screenY: 0
      };

      // Spawn rocket animation — satellite added when rocket finishes
      const orbitR = orbitRenderer.getOrbitRadius(dcIndex);
      const rocket = {
        targetOrbitRadius: orbitR,
        targetAngle: dc.angle,
        progress: 0,
        trail: [],
        phase: 'ascend',
        deployTimer: 0,
        owner: 'player',
        payload: payload,
        throttle: throttle,
        stagesSeparated: false,
        boosters: [],
        pendingDC: dc
      };
      state.rockets.push(rocket);
      orbitRenderer.focusRocket(rocket);

      const grade = score > 0.85 ? 'A+' : score > 0.7 ? 'A' : score > 0.5 ? 'B' : 'C';
      logMsg(`Launch successful! ${dc.name} deploying. Grade: ${grade}`, 'good');
      floatNum(ui.btnLaunch, '-' + fmtMoney(cost), false);
      audio.play('launch');

      // Screen shake
      const cont = $('orbit-container');
      if (cont) {
        cont.classList.add('shake');
        setTimeout(() => cont.classList.remove('shake'), 500);
      }

      if (score >= 0.85) {
        state.bonuses.throughputMult += 0.05;
        logMsg('Perfect launch! +5% throughput bonus', 'info');
      }
    } else {
      logMsg('Launch failed! Rocket destabilized. Check throttle & angle.', 'bad');
      floatNum(ui.btnLaunch, '-' + fmtMoney(cost), false);
    }

    renderAll();
  }

  function onTabSwitch(tab) {
    // no-op, timing marker removed
  }

  return { launch, onTabSwitch };
})();

/* ---- Costs ------------------------------------------------ */
function getLaunchCost() {
  const base = 3500;
  const scale = state.dataCenters.length * 900;
  // Payload above 80% adds up to 15% extra cost
  const payloadPenalty = ui.payloadSlider ? Math.max(0, (parseInt(ui.payloadSlider.value) - 80) / 20) * 0.15 : 0;
  return Math.round((base + scale) * (1 + payloadPenalty) * (1 - state.bonuses.costReduction));
}
function getSolarCost() {
  return Math.round(1200 * Math.pow(1.5, state.systems.power.level - 1) * (1 - state.bonuses.costReduction));
}
function getConnectionCost() {
  return Math.round(1400 * Math.pow(1.5, state.systems.connection.level - 1) * (1 - state.bonuses.costReduction));
}
function getJammerCost() { return 1600 + state.ai.centers * 400; }

/* ---- Systems ---------------------------------------------- */
function initSystems() {
  ui.btnSolar.addEventListener('click', () => {
    const cost = getSolarCost();
    if (state.money < cost || state.systems.power.level >= state.systems.power.max) return;
    state.money -= cost;
    state.systems.power.level++;
    logMsg(`Solar array upgraded to level ${state.systems.power.level}`, 'good');
    floatNum(ui.btnSolar, '-' + fmtMoney(cost), false);
    audio.play('upgrade');
    renderAll();
  });

  ui.btnConnect.addEventListener('click', () => {
    const cost = getConnectionCost();
    if (state.money < cost || state.systems.connection.level >= state.systems.connection.max) return;
    state.money -= cost;
    state.systems.connection.level++;
    logMsg(`Connection systems upgraded to level ${state.systems.connection.level}`, 'good');
    floatNum(ui.btnConnect, '-' + fmtMoney(cost), false);
    audio.play('upgrade');
    renderAll();
  });

  ui.btnJammer.addEventListener('click', () => {
    const cost = getJammerCost();
    if (state.money < cost || state.jamActive) return;
    state.money -= cost;
    state.jamActive = true;
    state.jamTimer = 20;
    logMsg('Orbital jammer deployed! AI disrupted for 20s', 'info');
    audio.play('jam');
    renderAll();
  });
}

/* ---- Upgrades --------------------------------------------- */
const upgrades = [
  { id: 'orbital-ai', name: 'Orbital AI Co-pilot', cost: 5000, desc: '+15% throughput', bought: false,
    effect() { state.bonuses.throughputMult += 0.15; } },
  { id: 'thermal-sinks', name: 'Thermal Sinks', cost: 4000, desc: '+10% throughput', bought: false,
    effect() { state.bonuses.throughputMult += 0.10; } },
  { id: 'contracts', name: 'Contract Broker', cost: 3500, desc: 'Better contract offers', bought: false,
    effect() { state.bonuses.contractBonus += 0.20; } },
  { id: 'expansion', name: 'Orbital Expansion', cost: 8000, desc: '+2 capacity slots', bought: false,
    effect() { state.capacityLimit += 2; } },
  { id: 'jammer', name: 'Jammer Array', cost: 6000, desc: 'Unlock orbital jammer', bought: false,
    effect() { ui.btnJammer.style.display = ''; } },
  { id: 'efficiency', name: 'Energy Efficiency', cost: 5500, desc: '10% cost reduction', bought: false,
    effect() { state.bonuses.costReduction = Math.min(state.bonuses.costReduction + 0.10, 0.3); } },
  { id: 'expansion-2', name: 'Deep Orbit Expansion', cost: 15000, desc: '+3 capacity slots', bought: false,
    req: 'expansion',
    effect() { state.capacityLimit += 3; } },
  { id: 'adv-ai', name: 'Advanced AI Network', cost: 12000, desc: '+25% throughput', bought: false,
    req: 'orbital-ai',
    effect() { state.bonuses.throughputMult += 0.25; } },
];

function renderUpgrades() {
  const list = ui.upgradeList;
  if (!list) return;
  const available = upgrades.filter(u => !u.bought && (!u.req || upgrades.find(r => r.id === u.req)?.bought));
  const locked = upgrades.filter(u => !u.bought && u.req && !upgrades.find(r => r.id === u.req)?.bought);

  list.innerHTML = available.map(u => `
    <div class="card">
      <div class="card-header">
        <span class="card-title">${u.name}</span>
        <span class="card-cost">${fmtMoney(u.cost)}</span>
      </div>
      <p class="card-desc">${u.desc}</p>
      <button class="card-btn" data-upgrade="${u.id}" ${state.money < u.cost ? 'disabled' : ''}>Purchase</button>
    </div>
  `).join('');

  if (ui.upgradeLocked) {
    ui.upgradeLocked.innerHTML = locked.length ?
      `<p style="font-size:11px;color:var(--text-dim);margin-top:8px;">🔒 ${locked.length} upgrade(s) locked — purchase prerequisites first.</p>` : '';
  }

  list.querySelectorAll('[data-upgrade]').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = upgrades.find(x => x.id === btn.dataset.upgrade);
      if (!u || u.bought || state.money < u.cost) return;
      state.money -= u.cost;
      u.bought = true;
      u.effect();
      logMsg(`Upgrade purchased: ${u.name}`, 'good');
      audio.play('upgrade');
      renderAll();
    });
  });
}

/* ---- AI Rival --------------------------------------------- */
function tickAI() {
  state.ai.nextAction--;
  if (state.ai.nextAction <= 0) {
    state.ai.nextAction = 25 + Math.floor(Math.random() * 15);
    const action = Math.random();
    if (action < 0.4 && state.ai.centers < state.capacityLimit + 2) {
      state.ai.centers++;
      state.ai.score += 50;
      // Spawn AI rocket from Earth
      const aiOrbitR = orbitRenderer.getOrbitRadius(state.capacityLimit + 1) + (state.ai.centers - 1) * 32;
      state.rockets.push({
        targetOrbitRadius: aiOrbitR,
        targetAngle: Math.random() * Math.PI * 2,
        progress: 0,
        trail: [],
        phase: 'ascend',
        deployTimer: 0,
        owner: 'ai',
        payload: 0.75,
        throttle: 0.85,
        stagesSeparated: false,
        boosters: []
      });
      logMsg(`⚠ AI rival launched satellite #${state.ai.centers}`, 'bad');
    } else if (action < 0.7) {
      state.ai.satisfaction = Math.min(95, state.ai.satisfaction + 5);
      state.ai.score += 30;
    } else {
      state.ai.disruption = true;
      state.ai.disruptionTimer = 8;
      const satPenalty = state.dataCenters.length <= 2 ? 1 : 3;
      state.satisfaction = Math.max(30, state.satisfaction - satPenalty);
      logMsg('⚠ AI competitor disrupting your signals!', 'bad');
      audio.play('alert');
    }
  }

  // Tick-based disruption cooldown (prevents background-tab desync)
  if (state.ai.disruption) {
    state.ai.disruptionTimer--;
    if (state.ai.disruptionTimer <= 0) {
      state.ai.disruption = false;
    }
  }
}

function renderAI() {
  if (ui.aiCenters) ui.aiCenters.textContent = state.ai.centers;
  if (ui.aiSatisfaction) ui.aiSatisfaction.textContent = state.ai.satisfaction + '%';
  if (ui.aiDisruption) ui.aiDisruption.textContent = state.ai.disruption ? '⚠ Active' : 'Clear';
  if (ui.aiScore) ui.aiScore.textContent = state.ai.score;
}

/* ---- Tutorial --------------------------------------------- */
const tutorialSteps = [
  {
    title: 'Secure first contract',
    msg: 'Open Contracts and accept your first mission to unlock Launch.',
    action: { label: 'Open Contracts', type: 'tab', value: 'contracts' },
    check: () => state.activeContracts.length > 0
  },
  {
    title: 'Boost solar output',
    msg: 'Deploy solar panels to stabilize power throughput.',
    action: { label: 'Highlight Solar', type: 'focus', value: 'btnSolar' },
    check: () => state.systems.power.level > 1
  },
  {
    title: 'Strengthen links',
    msg: 'Upgrade connection systems to increase data flow.',
    action: { label: 'Highlight Connection', type: 'focus', value: 'btnConnect' },
    check: () => state.systems.connection.level > 1
  },
  {
    title: 'Deliver contract',
    msg: 'Keep satellites online to finish a contract and unlock more offers.',
    action: { label: 'View Contracts', type: 'tab', value: 'contracts' },
    check: () => state.contractsCompleted > 0
  },
];

function tickTutorial() {
  if (state.tutorial.done) return;
  const step = tutorialSteps[state.tutorial.step];
  if (!step) { state.tutorial.done = true; hideAlert(); return; }
  showAlert(step.msg);
  if (step.check()) {
    state.tutorial.step++;
    if (state.tutorial.step >= tutorialSteps.length) {
      state.tutorial.done = true;
      hideAlert();
      logMsg('Tutorial complete! You\'re on your own now.', 'info');
    }
  }
}

function clearPulseTargets() {
  [ui.tabBtnContracts, ui.btnSolar, ui.btnConnect, ui.btnLaunch].forEach(el => {
    if (el) el.classList.remove('pulse-target');
  });
}

function applyTutorialHighlight(stepIndex) {
  clearPulseTargets();
  if (state.tutorial.done) return;
  if (stepIndex === 0 || stepIndex === 3) {
    ui.tabBtnContracts?.classList.add('pulse-target');
  }
  if (stepIndex === 1) ui.btnSolar?.classList.add('pulse-target');
  if (stepIndex === 2) ui.btnConnect?.classList.add('pulse-target');
}

function renderTutorialPanel() {
  const panel = ui.tutorialPanel;
  if (!panel) return;

  if (state.tutorial.done) {
    panel.innerHTML = `
      <div class="briefing-title">Ops Briefing</div>
      <div class="briefing-note">Tutorial complete. You are cleared for autonomous ops.</div>
    `;
    clearPulseTargets();
    return;
  }

  const stepIndex = state.tutorial.step;
  const step = tutorialSteps[stepIndex];
  const stepsHtml = tutorialSteps.map((s, i) => {
    const status = i < stepIndex ? 'done' : (i === stepIndex ? 'active' : '');
    return `
      <div class="briefing-step ${status}">
        <span class="briefing-dot"></span>
        <span>${s.title}</span>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="briefing-title">Ops Briefing</div>
    <div class="briefing-note">${step.msg}</div>
    <div class="briefing-steps">${stepsHtml}</div>
    <button class="briefing-action" data-action="${step.action.type}" data-value="${step.action.value}">${step.action.label}</button>
  `;

  const actionBtn = panel.querySelector('[data-action]');
  if (actionBtn) {
    actionBtn.onclick = () => {
      const action = actionBtn.dataset.action;
      const value = actionBtn.dataset.value;
      if (action === 'tab') {
        switchTab(value);
      } else if (action === 'focus') {
        const el = ui[value];
        if (el) {
          el.classList.add('pulse-target');
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    };
  }

  applyTutorialHighlight(stepIndex);
}

/* ---- Goals ------------------------------------------------ */
const goalDefs = [
  { text: 'Deploy first satellite', reward: 1500, check: () => state.dataCenters.length >= 1 },
  { text: 'Earn $15,000', reward: 2000, check: () => state.money >= 15000 },
  { text: 'Deploy 3 satellites', reward: 2500, check: () => state.dataCenters.length >= 3 },
  { text: 'Complete a contract', reward: 3000, check: () => state.contractsCompleted >= 1 },
  { text: 'Purchase 2 upgrades', reward: 3500, check: () => upgrades.filter(u => u.bought).length >= 2 },
  { text: 'Reach 80% satisfaction', reward: 4000, check: () => state.satisfaction >= 80 },
  { text: 'Deploy max capacity', reward: 5000, check: () => state.dataCenters.length >= state.capacityLimit },
];

function initGoals() {
  state.goals = goalDefs.map(g => ({ text: g.text, reward: g.reward, check: g.check, done: false }));
}

function tickGoals() {
  state.goals.forEach(g => {
    if (!g.done && g.check()) {
      g.done = true;
      const reward = g.reward || 2000;
      state.money += reward;
      logMsg(`🏆 Goal complete: ${g.text} — +${fmtMoney(reward)}`, 'good');
      floatNum(ui.goalList, '+' + fmtMoney(reward), true);
      audio.play('upgrade');
      showAlert(`🎉 Goal achieved: ${g.text}!`);
      setTimeout(hideAlert, 3500);
    }
  });
}

function renderGoals() {
  if (!ui.goalList) return;
  ui.goalList.innerHTML = state.goals.map(g => `
    <div class="goal-item ${g.done ? 'completed' : ''}">
      <span class="goal-check">${g.done ? '✅' : '⬜'}</span>
      <span>${g.text}</span>
    </div>
  `).join('');
}

/* ---- Random Events ---------------------------------------- */
const randomEvents = [
  {
    name: 'Solar Flare',
    msg: '☀️ Solar flare detected! Throughput boosted +25% for 15 seconds.',
    effect() {
      state.bonuses.throughputMult += 0.25;
      logMsg(this.msg, 'good');
      showAlert(this.msg);
      setTimeout(() => {
        state.bonuses.throughputMult = Math.max(1, state.bonuses.throughputMult - 0.25);
        logMsg('Solar flare subsided. Throughput returning to normal.', 'info');
        hideAlert();
      }, 15000);
    }
  },
  {
    name: 'Micro-Meteorite',
    msg: '☄️ Micro-meteorite impact! A satellite is temporarily offline for 10 seconds.',
    effect() {
      const online = state.dataCenters.filter(dc => dc.online);
      if (online.length === 0) return;
      const target = online[Math.floor(Math.random() * online.length)];
      target.online = false;
      logMsg(`${this.msg} (${target.name})`, 'bad');
      showAlert(`☄️ ${target.name} hit by micro-meteorite!`);
      audio.play('alert');
      setTimeout(() => {
        target.online = true;
        logMsg(`${target.name} back online after meteorite repairs.`, 'good');
        hideAlert();
      }, 10000);
    }
  },
  {
    name: 'Emergency Funding',
    msg: '💸 Emergency government funding received! +$2,500',
    effect() {
      state.money += 2500;
      logMsg(this.msg, 'good');
      floatNum(ui.money, '+$2,500', true);
    }
  },
  {
    name: 'Equipment Glitch',
    msg: '⚡ Power grid glitch! Solar output reduced for 15 seconds.',
    effect() {
      if (state.systems.power.level <= 1) return;
      state.systems.power.level--;
      logMsg(this.msg, 'bad');
      showAlert(this.msg);
      audio.play('alert');
      setTimeout(() => {
        state.systems.power.level++;
        logMsg('Power grid stabilized. Output restored.', 'good');
        hideAlert();
      }, 15000);
    }
  },
  {
    name: 'Bonus Data Burst',
    msg: '📈 Orbital alignment bonus! +1,200 data delivered instantly.',
    effect() {
      state.totalData += 1200;
      // Also credit to active contracts
      state.activeContracts.forEach(c => { c.dataDelivered += Math.floor(1200 / Math.max(1, state.activeContracts.length)); });
      logMsg(this.msg, 'good');
      floatNum(ui.dataRate, '+1.2K data', true);
    }
  }
];

let nextEventTick = 45 + Math.floor(Math.random() * 30);

function tickRandomEvents() {
  if (state.tick < nextEventTick) return;
  nextEventTick = state.tick + 45 + Math.floor(Math.random() * 30);
  // Only trigger if player has at least 1 satellite
  if (state.dataCenters.length === 0) return;
  const event = randomEvents[Math.floor(Math.random() * randomEvents.length)];
  event.effect();
}

/* ---- Contracts -------------------------------------------- */
const contractTemplates = [
  { name: 'Data Relay', dataNeeded: 800, reward: 3000, time: 60 },
  { name: 'Secure Transfer', dataNeeded: 1200, reward: 5000, time: 90 },
  { name: 'Global Broadcast', dataNeeded: 2000, reward: 8000, time: 120 },
  { name: 'Emergency Uplink', dataNeeded: 500, reward: 2200, time: 45 },
  { name: 'Deep Space Relay', dataNeeded: 3000, reward: 12000, time: 150 },
  { name: 'Quantum Backup', dataNeeded: 1500, reward: 6000, time: 80 },
];

function spawnContract() {
  if (state.contracts.length >= 5) return;
  const tmpl = contractTemplates[Math.floor(Math.random() * contractTemplates.length)];
  const bonus = 1 + state.bonuses.contractBonus;
  state.contracts.push({
    id: 'C' + Date.now() + '-' + Math.floor(Math.random() * 10000),
    name: tmpl.name,
    dataNeeded: Math.round(tmpl.dataNeeded * (0.9 + Math.random() * 0.3)),
    reward: Math.round(tmpl.reward * bonus),
    timeLeft: tmpl.time,
    dataDelivered: 0
  });
  updateContractNotification();
}

function updateContractNotification() {
  const btn = ui.tabBtnContracts;
  if (!btn) return;
  const count = state.contracts.length;
  if (count > state.lastOfferCount) {
    btn.classList.add('notify');
    setTimeout(() => btn.classList.remove('notify'), 4000);
  }
  state.lastOfferCount = count;
  // Update badge
  let badge = btn.querySelector('.badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge';
      btn.appendChild(badge);
    }
    badge.textContent = count;
  } else if (badge) {
    badge.remove();
  }
}

function tickContracts() {
  // Tick active contracts
  const thr = computeThroughput();
  for (let i = state.activeContracts.length - 1; i >= 0; i--) {
    const c = state.activeContracts[i];
    c.dataDelivered += thr;
    c.timeLeft--;
    if (c.dataDelivered >= c.dataNeeded) {
      state.money += c.reward;
      state.reputation = Math.min(5, state.reputation + 0.05);
      state.satisfaction = Math.min(100, state.satisfaction + 2);
      state.contractsCompleted++;
      logMsg(`✅ Contract "${c.name}" completed! +${fmtMoney(c.reward)}`, 'good');
      floatNum(ui.activeContractList, '+' + fmtMoney(c.reward), true);
      audio.play('contract');
      state.activeContracts.splice(i, 1);
    } else if (c.timeLeft <= 0) {
      state.satisfaction = Math.max(20, state.satisfaction - 5);
      state.reputation = Math.max(0.5, state.reputation - 0.1);
      logMsg(`❌ Contract "${c.name}" expired!`, 'bad');
      state.activeContracts.splice(i, 1);
    }
  }
}

function renderContracts() {
  if (ui.contractList) {
    const thr = computeThroughput();
    ui.contractList.innerHTML = state.contracts.map(c => {
      const neededRate = Math.ceil(c.dataNeeded / c.timeLeft);
      const canMeet = thr >= neededRate;
      return `
      <div class="card contract-available">
        <div class="card-header">
          <span class="card-title">${c.name}</span>
          <span class="contract-reward">${fmtMoney(c.reward)}</span>
        </div>
        <p class="card-desc">Deliver ${fmt(c.dataNeeded)} data in ${c.timeLeft}s
          <span class="contract-rate-hint">(~${fmt(neededRate)}/s needed${canMeet ? '' : ' ⚠'})</span>
        </p>
        <div class="card-actions">
          <button class="card-btn" data-contract="${c.id}">Accept</button>
          <button class="card-btn card-btn-launch" data-launch-contract="${c.id}">🚀 Accept & Launch</button>
        </div>
      </div>
    `}).join('') || '<p style="font-size:12px;color:var(--text-dim)">No offers available.</p>';

    ui.contractList.querySelectorAll('[data-contract]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.contract;
        const idx = state.contracts.findIndex(c => String(c.id) === id);
        if (idx < 0) return;
        const c = state.contracts.splice(idx, 1)[0];
        state.activeContracts.push(c);
        logMsg(`Contract "${c.name}" accepted`, 'info');
        audio.play('click');
        updateContractNotification();
        renderContracts();
      });
    });

    ui.contractList.querySelectorAll('[data-launch-contract]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.launchContract;
        const idx = state.contracts.findIndex(c => String(c.id) === id);
        if (idx < 0) return;
        const c = state.contracts.splice(idx, 1)[0];
        state.activeContracts.push(c);
        state.targetContract = c.id;
        logMsg(`Contract "${c.name}" accepted — switching to Launch`, 'info');
        updateContractNotification();
        switchTab('launch');
        renderAll();
      });
    });
  }

  if (ui.activeContractList) {
    const thr = computeThroughput();
    ui.activeContractList.innerHTML = state.activeContracts.map(c => {
      const pct = Math.min(100, (c.dataDelivered / c.dataNeeded) * 100);
      const remaining = c.dataNeeded - c.dataDelivered;
      const eta = thr > 0 ? Math.ceil(remaining / thr) : Infinity;
      const isTarget = state.targetContract === c.id;
      return `
        <div class="card contract-active ${isTarget ? 'contract-target' : ''}">
          <div class="card-header">
            <span class="card-title">${c.name}</span>
            <span class="contract-reward">${fmtMoney(c.reward)}</span>
          </div>
          <p class="card-desc">${fmt(c.dataDelivered)}/${fmt(c.dataNeeded)} · ${c.timeLeft}s left${eta < Infinity ? ' · ETA ' + eta + 's' : ''}</p>
          <div class="contract-progress"><div class="contract-progress-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('') || '<p style="font-size:12px;color:var(--text-dim)">No active contracts.</p>';
  }
}

/* ---- Launch Contract Banner ------------------------------- */
function renderLaunchBanner() {
  const el = ui.launchContractBanner;
  if (!el) return;

  if (state.activeContracts.length === 0) {
    el.classList.add('hidden');
    return;
  }

  let contract = state.targetContract
    ? state.activeContracts.find(c => c.id === state.targetContract)
    : null;
  if (!contract) contract = state.activeContracts[state.activeContracts.length - 1];
  if (!contract) { el.classList.add('hidden'); return; }

  const thr = computeThroughput();
  const remaining = contract.dataNeeded - contract.dataDelivered;
  const neededRate = contract.timeLeft > 0 ? Math.ceil(remaining / contract.timeLeft) : remaining;
  const enough = thr >= neededRate;

  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="banner-contract-name">📋 ${contract.name} <span class="banner-reward">${fmtMoney(contract.reward)}</span></div>
    <div class="banner-contract-details">
      Need ${fmt(remaining)} more data in ${contract.timeLeft}s
      <span class="${enough ? 'banner-ok' : 'banner-warn'}">
        (${fmt(thr)}/s ${enough ? '✓ on track' : '— need more satellites!'})
      </span>
    </div>
  `;
}

/* ---- Throughput ------------------------------------------- */
function computeThroughput() {
  if (state.dataCenters.length === 0) return 0;
  const onlineCount = state.dataCenters.filter(dc => dc.online).length;
  const centerBase = onlineCount * 16;
  const powerBoost = 1 + (state.systems.power.level - 1) * 0.18;
  const connectionBoost = 1 + (state.systems.connection.level - 1) * 0.2;
  const bonus = state.bonuses.throughputMult;
  const jamPenalty = state.ai.disruption ? 0.75 : 1;
  return Math.round(centerBase * powerBoost * connectionBoost * bonus * jamPenalty);
}

/* ---- UI Helpers ------------------------------------------- */
function showAlert(msg) {
  if (ui.alertBar) {
    ui.alertBar.textContent = msg;
    ui.alertBar.classList.remove('hidden');
  }
}
function hideAlert() {
  if (ui.alertBar) ui.alertBar.classList.add('hidden');
}

function logMsg(msg, cls = '') {
  if (!ui.log) return;
  const d = document.createElement('div');
  d.className = 'entry ' + cls;
  const t = new Date();
  d.textContent = `[${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}] ${msg}`;
  ui.log.prepend(d);
  if (ui.log.children.length > 50) ui.log.lastChild.remove();
}

function floatNum(anchor, text, isGain) {
  if (!anchor) return;
  const el = document.createElement('div');
  el.className = 'float-num ' + (isGain ? 'gain' : 'loss');
  el.textContent = text;
  const rect = anchor.getBoundingClientRect();
  el.style.left = rect.left + rect.width / 2 - 30 + 'px';
  el.style.top = rect.top - 10 + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

/* ---- Tabs ------------------------------------------------- */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  launchSystem.onTabSwitch(tab);
  state.activeTab = tab;

  if (tab === 'contracts') {
    const btn = ui.tabBtnContracts;
    if (btn) btn.classList.remove('notify');
  }
  if (tab === 'launch') {
    renderLaunchBanner();
  }
}

/* ---- Render All ------------------------------------------- */
function renderAll() {
  const thr = computeThroughput();

  // HUD
  if (ui.money) ui.money.textContent = fmtMoney(state.money);
  if (ui.moneyRate) ui.moneyRate.textContent = '+' + fmtMoney(thr * 1.2) + '/s';
  if (ui.dataRate) ui.dataRate.textContent = fmt(thr) + '/s';
  if (ui.dataTotal) ui.dataTotal.textContent = fmt(state.totalData) + ' total';
  if (ui.satisfaction) ui.satisfaction.textContent = Math.round(state.satisfaction) + '%';
  if (ui.reputation) ui.reputation.textContent = state.reputation.toFixed(2);
  if (ui.centerCount) ui.centerCount.textContent = state.dataCenters.length + '/' + state.capacityLimit;

  // Mission time
  const mins = Math.floor(state.tick / 60);
  const secs = state.tick % 60;
  if (ui.missionTime) ui.missionTime.textContent = mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');

  // Stats bar
  if (ui.throughput) ui.throughput.textContent = fmt(thr);
  if (ui.contractsActive) ui.contractsActive.textContent = state.activeContracts.length;
  if (ui.dataBeamed) ui.dataBeamed.textContent = fmt(state.totalData);
  if (ui.beamStatus) ui.beamStatus.textContent = state.dataCenters.some(dc => dc.online) ? 'Active' : 'Ready';
  if (ui.beamIndicator) ui.beamIndicator.classList.toggle('active', state.dataCenters.some(dc => dc.online));

  // Action buttons
  if (ui.solarCost) ui.solarCost.textContent = fmtMoney(getSolarCost());
  if (ui.solarLevel) ui.solarLevel.textContent = state.systems.power.level + '/' + state.systems.power.max;
  ui.btnSolar.disabled = state.money < getSolarCost() || state.systems.power.level >= state.systems.power.max;

  if (ui.connectCost) ui.connectCost.textContent = fmtMoney(getConnectionCost());
  if (ui.connectCooldown) {
    ui.connectCooldown.textContent = state.systems.connection.level + '/' + state.systems.connection.max;
  }
  ui.btnConnect.disabled = state.money < getConnectionCost() || state.systems.connection.level >= state.systems.connection.max;

  if (ui.jammerCost) ui.jammerCost.textContent = fmtMoney(getJammerCost());
  ui.btnJammer.disabled = state.money < getJammerCost() || state.jamActive;

  // System bars
  if (ui.powerBar) ui.powerBar.style.width = (state.systems.power.level / state.systems.power.max * 100) + '%';
  if (ui.connectBar) ui.connectBar.style.width = (state.systems.connection.level / state.systems.connection.max * 100) + '%';

  // Launch cost update on slider change
  if (ui.launchCost) ui.launchCost.textContent = fmtMoney(getLaunchCost());
  const pendingLaunches = state.rockets.filter(r => r.pendingDC).length;
  if (ui.btnLaunch) ui.btnLaunch.disabled = state.activeContracts.length === 0
    || state.money < getLaunchCost()
    || (state.dataCenters.length + pendingLaunches) >= state.capacityLimit;

  if (ui.launchReadout) {
    if (state.activeContracts.length === 0) {
      ui.launchReadout.textContent = 'Accept a contract to unlock Launch.';
    } else {
      ui.launchReadout.textContent = 'Set throttle & angle, then launch! Preview marker shows target.';
    }
  }

  // Slider displays
  if (ui.payloadSlider && ui.payloadVal) ui.payloadVal.textContent = ui.payloadSlider.value + '%';
  if (ui.throttleSlider && ui.throttleVal) ui.throttleVal.textContent = ui.throttleSlider.value + '%';
  if (ui.angleSlider && ui.angleVal) ui.angleVal.textContent = ui.angleSlider.value + '°';

  // Throughput per satellite
  const perDC = state.dataCenters.length > 0 ? thr / state.dataCenters.filter(dc => dc.online).length || 0 : 0;
  state.dataCenters.forEach(dc => { dc.throughput = dc.online ? perDC : 0; });

  renderSatelliteList();
  renderSelectionInfo();
  renderAI();
  renderGoals();
  renderTutorialPanel();
  renderContracts();
  renderLaunchBanner();
}

/* ---- Game Tick (1s) --------------------------------------- */
function gameTick() {
  state.tick++;
  const thr = computeThroughput();
  const income = Math.round(thr * 1.2);

  state.money += income;
  state.totalData += thr;

  // System cooldowns
  if (state.systems.connection.cooldown > 0) state.systems.connection.cooldown--;

  // Jammer timer
  if (state.jamActive) {
    state.jamTimer--;
    if (state.jamTimer <= 0) {
      state.jamActive = false;
      logMsg('Orbital jammer expired', 'info');
    }
  }

  // Uptime
  state.dataCenters.forEach(dc => { if (dc.online) dc.uptime++; });

  // Satisfaction drift
  if (thr > 0) {
    state.satisfaction = Math.min(100, state.satisfaction + 0.1);
  } else if (state.dataCenters.length > 0) {
    state.satisfaction = Math.max(20, state.satisfaction - 0.2);
  }

  tickAI();
  tickContracts();
  tickGoals();
  tickTutorial();
  tickRandomEvents();

  // Spawn contracts periodically
  if (state.tick % 18 === 0) spawnContract();
  // Re-render upgrades periodically
  if (state.tick % 20 === 0) renderUpgrades();

  renderAll();
}

/* ---- Init ------------------------------------------------- */
function init() {
  cacheUI();
  initInput();
  initTabs();
  initSystems();
  initZoom();
  initGoals();
  orbitRenderer.init();

  // Launch button
  ui.btnLaunch.addEventListener('click', () => launchSystem.launch());
  // Slider listeners — payload affects launch cost dynamically
  ui.payloadSlider?.addEventListener('input', () => {
    ui.payloadVal.textContent = ui.payloadSlider.value + '%';
    if (ui.launchCost) ui.launchCost.textContent = fmtMoney(getLaunchCost());
  });
  ui.throttleSlider?.addEventListener('input', () => { ui.throttleVal.textContent = ui.throttleSlider.value + '%'; });
  ui.angleSlider?.addEventListener('input', () => { ui.angleVal.textContent = ui.angleSlider.value + '°'; });

  // Load sounds (silent fail if missing)
  ['launch', 'upgrade', 'jam', 'alert', 'contract', 'click'].forEach(s => {
    audio.load(s, `assets/sounds/${s}.mp3`);
  });

  // Initial render
  renderUpgrades();
  renderAll();
  logMsg('Space Data Center online. Accept a contract to unlock Launch.', 'info');

  // Game loop
  setInterval(gameTick, 1000);
}

document.addEventListener('DOMContentLoaded', init);
