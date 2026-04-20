// ══════════════════════════════════════════════════════════════
//          UI — DOM Sidebar Controls, Stats, Charts, Gauge
// ══════════════════════════════════════════════════════════════

class SimUI {
  constructor(physics, callbacks) {
    this.physics = physics;
    this.callbacks = callbacks; // { onReset, onRetract, onPause, onResume, onMaterialChange, onParamChange, onParamLive, onCameraPreset, onToggleCutaway, onExportCSV }
    this.running = true;
    this.openSections = {
      material: true, nozzle: true, particles: true, filament: false,
      environment: true, retraction: false, simulation: true
    };
    this.chartCanvases = {};
    this.build();
    this.updateStats();
  }

  build() {
    const sidebar = document.getElementById('sidebar');
    sidebar.innerHTML = '';

    // Action buttons
    sidebar.appendChild(this.buildActions());
    // Camera presets
    sidebar.appendChild(this.buildCameraPresets());
    // Material
    sidebar.appendChild(this.buildSection('material', 'Material', this.buildMaterialContent.bind(this)));
    // Nozzle
    sidebar.appendChild(this.buildSection('nozzle', 'Nozzle', this.buildNozzleContent.bind(this)));
    // Wood Particles
    sidebar.appendChild(this.buildSection('particles', 'Wood Particles', this.buildParticlesContent.bind(this)));
    // Filament
    sidebar.appendChild(this.buildSection('filament', 'Filament', this.buildFilamentContent.bind(this)));
    // Environment
    sidebar.appendChild(this.buildSection('environment', 'Environment', this.buildEnvironmentContent.bind(this)));
    // Retraction
    sidebar.appendChild(this.buildSection('retraction', 'Retraction', this.buildRetractionContent.bind(this)));
    // Simulation
    sidebar.appendChild(this.buildSection('simulation', 'Simulation', this.buildSimulationContent.bind(this)));
    // Status
    sidebar.appendChild(this.buildStatus());

    // Stats strip (bottom of left panel)
    this.buildStatsStrip();
    // Charts
    this.buildCharts();
    // Pressure gauge
    this.buildPressureGauge();
  }

  // ── Helper: create slider ──
  createSlider(label, key, min, max, step, unit, accent, isLive, info) {
    const div = document.createElement('div');
    div.className = 'slider-group';

    const header = document.createElement('div');
    header.className = 'slider-header';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'slider-label';
    labelSpan.textContent = label;
    if (info) {
      const infoBtn = document.createElement('span');
      infoBtn.className = 'info-btn';
      infoBtn.title = info;
      infoBtn.textContent = 'i';
      labelSpan.appendChild(infoBtn);
    }
    header.appendChild(labelSpan);

    const valueSpan = document.createElement('span');
    valueSpan.className = 'slider-value';
    valueSpan.style.color = accent || '#666';
    const val = this.physics.params[key];
    valueSpan.textContent = val.toFixed(step < .01 ? 3 : step < 1 ? 2 : 0) + (unit ? ' ' + unit : '');
    header.appendChild(valueSpan);

    div.appendChild(header);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = this.physics.params[key];
    input.style.accentColor = accent || '#666';
    input.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      valueSpan.textContent = v.toFixed(step < .01 ? 3 : step < 1 ? 2 : 0) + (unit ? ' ' + unit : '');
      this.physics.params[key] = v;
      if (isLive) {
        if (this.callbacks.onParamLive) this.callbacks.onParamLive(key, v);
      } else {
        if (this.callbacks.onParamChange) this.callbacks.onParamChange(key, v);
      }
    });
    div.appendChild(input);

    // Store reference for updating
    input._key = key;
    input._valueSpan = valueSpan;
    input._step = step;
    input._unit = unit;

    return div;
  }

  // ── Action buttons ──
  buildActions() {
    const div = document.createElement('div');
    div.className = 'card actions-bar';

    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'btn btn-pause';
    pauseBtn.textContent = '⏸ Pause';
    pauseBtn.addEventListener('click', () => {
      this.running = !this.running;
      pauseBtn.textContent = this.running ? '⏸ Pause' : '▶ Resume';
      pauseBtn.className = this.running ? 'btn btn-pause' : 'btn btn-resume';
      if (this.running) this.callbacks.onResume?.();
      else this.callbacks.onPause?.();
    });
    this.pauseBtn = pauseBtn;
    div.appendChild(pauseBtn);

    const retractBtn = document.createElement('button');
    retractBtn.className = 'btn btn-retract';
    retractBtn.textContent = '↑ Retract';
    retractBtn.addEventListener('click', () => this.callbacks.onRetract?.());
    div.appendChild(retractBtn);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-reset';
    resetBtn.textContent = '↺ Reset';
    resetBtn.addEventListener('click', () => this.callbacks.onReset?.());
    div.appendChild(resetBtn);

    return div;
  }

  // ── Camera presets ──
  buildCameraPresets() {
    const div = document.createElement('div');
    div.className = 'card camera-presets';

    const label = document.createElement('div');
    label.className = 'section-title';
    label.textContent = 'VIEW';
    div.appendChild(label);

    const row = document.createElement('div');
    row.className = 'btn-row';

    const presets = [
      { name: 'Front', id: 'front' },
      { name: '3D', id: 'orbit' },
      { name: 'Top', id: 'top' },
      { name: 'Close', id: 'closeup' }
    ];
    for (const p of presets) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-preset';
      btn.textContent = p.name;
      btn.addEventListener('click', () => this.callbacks.onCameraPreset?.(p.id));
      row.appendChild(btn);
    }

    // Cutaway toggle
    const cutBtn = document.createElement('button');
    cutBtn.className = 'btn btn-preset active';
    cutBtn.textContent = '✂ Cut';
    cutBtn.addEventListener('click', () => {
      cutBtn.classList.toggle('active');
      this.callbacks.onToggleCutaway?.(cutBtn.classList.contains('active'));
    });
    row.appendChild(cutBtn);

    div.appendChild(row);
    return div;
  }

  // ── Collapsible section ──
  buildSection(key, title, contentFn) {
    const div = document.createElement('div');
    div.className = 'card';

    const header = document.createElement('div');
    header.className = 'section-head';
    header.innerHTML = `<span>${title}</span><svg class="chevron ${this.openSections[key] ? 'open' : ''}" width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 3.5L5 6.5L7.5 3.5" fill="none" stroke="#888" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    header.addEventListener('click', () => {
      this.openSections[key] = !this.openSections[key];
      content.style.display = this.openSections[key] ? 'block' : 'none';
      header.querySelector('.chevron').classList.toggle('open', this.openSections[key]);
    });
    div.appendChild(header);

    const content = document.createElement('div');
    content.className = 'section-content';
    content.style.display = this.openSections[key] ? 'block' : 'none';
    contentFn(content);
    div.appendChild(content);

    return div;
  }

  // ── Material section ──
  buildMaterialContent(container) {
    const row = document.createElement('div');
    row.className = 'btn-row';
    for (const [k, m] of Object.entries(MAT)) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-mat' + (this.physics.params.mat === k ? ' active' : '');
      btn.textContent = m.l.replace(' Wood', '');
      btn.addEventListener('click', () => {
        row.querySelectorAll('.btn-mat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.callbacks.onMaterialChange?.(k);
        // Update temp slider range
        this.updateTempSlider();
        this.updateMaterialInfo();
      });
      row.appendChild(btn);
    }
    container.appendChild(row);

    // Material info
    this.matInfoEl = document.createElement('div');
    this.matInfoEl.className = 'mat-info';
    this.updateMaterialInfo();
    container.appendChild(this.matInfoEl);

    // Temp slider
    this.tempSliderContainer = document.createElement('div');
    container.appendChild(this.tempSliderContainer);
    this.updateTempSlider();
  }

  updateMaterialInfo() {
    const m = this.physics.getMat();
    if (this.matInfoEl) {
      this.matInfoEl.innerHTML = `<strong>${m.l}</strong> — ${m.mt}°C min · ${m.fl}× flow · ${m.ds}× swell`;
    }
  }

  updateTempSlider() {
    if (!this.tempSliderContainer) return;
    this.tempSliderContainer.innerHTML = '';
    const m = this.physics.getMat();
    this.tempSliderContainer.appendChild(
      this.createSlider('Print temp', 'pt', m.mt, m.mt + 80, 5, '°C', '#C44', false,
        'Nozzle temperature.')
    );
  }

  // ── Nozzle section ──
  buildNozzleContent(container) {
    container.appendChild(this.createSlider('Diameter', 'nd', .2, 1, .05, 'mm', '#5A8F5A', false, 'Nominal land bore diameter.'));
    container.appendChild(this.createSlider('Wall tolerance', 'wt', .6, 1, .01, '', '#C44', false, 'Usable bore fraction.'));

    this.effBoreEl = document.createElement('div');
    this.effBoreEl.className = 'info-row';
    container.appendChild(this.effBoreEl);
  }

  // ── Particles section ──
  buildParticlesContent(container) {
    container.appendChild(this.createSlider('Mean size', 'pm', .02, .2, .005, 'mm', '#8B6914', false, 'Average diameter.'));
    container.appendChild(this.createSlider('Std dev', 'ps', .005, .1, .005, 'mm', '#8B6914', false, 'Size spread.'));

    const row = document.createElement('div');
    row.className = 'slider-row';
    row.appendChild(this.createSlider('Sieve cutoff', 'mp', .05, .4, .01, 'mm', '#D08020', false, 'Max particle size.'));
    row.appendChild(this.createSlider('Cluster', 'cc', 0, .1, .005, '', '#A07020', false, 'Clump probability.'));
    container.appendChild(row);
  }

  // ── Filament section ──
  buildFilamentContent(container) {
    container.appendChild(this.createSlider('Nominal OD', 'fn', 1.65, 1.85, .01, 'mm', '#8855AA', false, 'Target diameter.'));
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.appendChild(this.createSlider('OD variation', 'fv', 0, .1, .005, 'mm', '#8855AA', false, 'Diameter variation.'));
    row.appendChild(this.createSlider('Var freq', 'ff', .001, .03, .001, '', '#8855AA', false, 'Spatial frequency.'));
    container.appendChild(row);
  }

  // ── Environment section ──
  buildEnvironmentContent(container) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.appendChild(this.createSlider('Ambient', 'amb', 15, 60, 1, '°C', '#E08040', true, 'Room temperature.'));
    row.appendChild(this.createSlider('Fan', 'fan', 0, 100, 5, '%', '#3878AA', true, 'Part cooling fan.'));
    container.appendChild(row);
    container.appendChild(this.createSlider('Moisture', 'moist', 0, .15, .005, '%', '#5588BB', true, 'Wood absorbs moisture.'));
  }

  // ── Retraction section ──
  buildRetractionContent(container) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.appendChild(this.createSlider('Distance', 'ret', 0, 5, .1, 'mm', '#3878AA', true, 'How far to pull filament back.'));
    row.appendChild(this.createSlider('Speed', 'retSpd', 10, 60, 5, 'mm/s', '#3878AA', true, 'Retraction speed.'));
    container.appendChild(row);

    // Drive type buttons
    const driveRow = document.createElement('div');
    driveRow.className = 'btn-row';
    for (const dt of ['direct', 'bowden']) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-drive' + (this.physics.params.drive === dt ? ' active' : '');
      btn.textContent = dt === 'direct' ? 'Direct Drive' : 'Bowden';
      btn.addEventListener('click', () => {
        driveRow.querySelectorAll('.btn-drive').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.physics.params.drive = dt;
      });
      driveRow.appendChild(btn);
    }
    container.appendChild(driveRow);
  }

  // ── Simulation section ──
  buildSimulationContent(container) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.appendChild(this.createSlider('Flow rate', 'fr', 1, 8, .5, '×', '#3377BB', true, 'Speed multiplier.'));
    row.appendChild(this.createSlider('Density', 'pd', 1, 8, 1, '', '#8B6914', true, 'Particles per cycle.'));
    container.appendChild(row);
  }

  // ── Status indicators ──
  buildStatus() {
    const div = document.createElement('div');
    div.className = 'card status-card';

    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = 'STATUS';
    div.appendChild(title);

    this.statusGrid = document.createElement('div');
    this.statusGrid.className = 'status-grid';
    div.appendChild(this.statusGrid);

    this.filWearEl = document.createElement('div');
    this.filWearEl.className = 'info-row small';
    div.appendChild(this.filWearEl);

    return div;
  }

  // ── Stats strip ──
  buildStatsStrip() {
    const strip = document.getElementById('stats-strip');
    if (!strip) return;
    this.statsEls = {};
    const items = [
      { l: 'Passed', k: 'p', c: '#5A8F5A' },
      { l: 'Clogged', k: 'c', c: '#C44' },
      { l: 'Bridged', k: 'b', c: '#D08020' },
      { l: 'Jams', k: 'j', c: '#8855AA' },
      { l: 'Grinds', k: 'g', c: '#C66' },
      { l: 'Clog%', k: 'pct', c: '#5A8F5A' }
    ];
    for (const item of items) {
      const box = document.createElement('div');
      box.className = 'stat-box';
      box.innerHTML = `<div class="stat-label">${item.l}</div><div class="stat-value" style="color:${item.c}" id="stat-${item.k}">0</div>`;
      strip.appendChild(box);
      this.statsEls[item.k] = box.querySelector('.stat-value');
    }
  }

  // ── Charts ──
  buildCharts() {
    const container = document.getElementById('charts');
    if (!container) return;

    const charts = [
      { key: 'p', color: '#5A8F5A', label: 'Passed' },
      { key: 'c', color: '#C44', label: 'Clogged' },
      { key: 'r', color: '#D08020', label: 'Clog %' },
      { key: 'f', color: '#963', label: 'Fouling' }
    ];

    for (const ch of charts) {
      const row = document.createElement('div');
      row.className = 'chart-row';
      row.innerHTML = `<div class="chart-label">${ch.label} <span id="chart-val-${ch.key}" style="color:${ch.color};font-weight:600"></span></div>`;
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 24;
      canvas.className = 'chart-canvas';
      row.appendChild(canvas);
      container.appendChild(row);
      this.chartCanvases[ch.key] = { canvas, color: ch.color };
    }
  }

  // ── Pressure gauge (SVG) ──
  buildPressureGauge() {
    const container = document.getElementById('gauge');
    if (!container) return;
    container.innerHTML = `
      <svg width="56" height="42" style="display:block;margin:0 auto">
        <circle cx="28" cy="28" r="22" fill="none" stroke="#E0DDD8" stroke-width="3"/>
        <circle id="gauge-arc" cx="28" cy="28" r="22" fill="none" stroke="#5A8F5A" stroke-width="3"
          stroke-dasharray="0 170" stroke-dashoffset="-15" stroke-linecap="round" transform="rotate(-135 28 28)"/>
        <line id="gauge-needle" x1="28" y1="28" x2="28" y2="10" stroke="#5A8F5A" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="28" cy="28" r="2.5" fill="#444"/>
        <text id="gauge-text" x="28" y="42" text-anchor="middle" font-size="7" fill="#999" font-weight="600">0.00 bar</text>
      </svg>`;

    // CSV export
    const csvBtn = document.createElement('button');
    csvBtn.className = 'btn btn-csv';
    csvBtn.textContent = 'CSV ↓';
    csvBtn.addEventListener('click', () => this.callbacks.onExportCSV?.());
    container.appendChild(csvBtn);
  }

  // ── Update all UI elements per frame ──
  updateStats() {
    const p = this.physics;
    const s = p.stats;
    const tot = s.p + s.c;
    const cRt = tot > 0 ? ((s.c / tot) * 100).toFixed(1) : "0.0";

    // Stats strip
    if (this.statsEls) {
      if (this.statsEls.p) this.statsEls.p.textContent = s.p;
      if (this.statsEls.c) this.statsEls.c.textContent = s.c;
      if (this.statsEls.b) this.statsEls.b.textContent = s.b;
      if (this.statsEls.j) this.statsEls.j.textContent = s.j;
      if (this.statsEls.g) this.statsEls.g.textContent = s.g;
      if (this.statsEls.pct) {
        this.statsEls.pct.textContent = cRt + '%';
        this.statsEls.pct.style.color = parseFloat(cRt) > 10 ? '#C44' : '#5A8F5A';
      }
    }

    // Status dots
    if (this.statusGrid) {
      const g = p.gear, cl = p.clog;
      const dots = [
        { on: g.st, warn: true, label: g.st ? 'STALLED' : `Gears ${(g.sp * 100).toFixed(0)}%` },
        { on: g.gd > .05, warn: true, label: g.gd > .05 ? `Grind ${(g.gd * 100).toFixed(0)}%` : 'No grind' },
        { on: cl.pr > .3, warn: cl.pr > 1, label: `P ${cl.pr.toFixed(2)} bar` },
        { on: p.fouling > .005, warn: p.fouling > .05, label: `Foul −${p.fouling.toFixed(3)}` },
        { on: p.heatCreep > .3, warn: p.heatCreep > .6, label: p.heatCreep > .3 ? `Creep ${(p.heatCreep * 100).toFixed(0)}%` : 'Thermal OK' },
        { on: p.buckling > .15, warn: p.buckling > .5, label: p.buckling > .15 ? `Buck ${(p.buckling * 100).toFixed(0)}%` : 'No buck' },
        { on: p.moisture > .02, warn: p.moisture > .08, label: p.moisture > .02 ? `Moist ${(p.moisture * 100).toFixed(1)}%` : 'Dry' },
        { on: p.viscousHeat > .02, warn: p.viscousHeat > .1, label: p.viscousHeat > .02 ? `V-ht +${(p.viscousHeat * 100).toFixed(1)}%` : 'V-ht OK' },
        { on: p.underExtrusion > .2, warn: p.underExtrusion > .5, label: p.underExtrusion > .2 ? `U-ext ${(p.underExtrusion * 100).toFixed(0)}%` : 'Extr OK' },
        { on: p.dieSwell > 1.1, warn: p.dieSwell > 1.2, label: `Swell ${p.dieSwell.toFixed(2)}×` }
      ];

      let html = '';
      for (const d of dots) {
        const color = d.on ? (d.warn ? '#D44' : '#E80') : '#5A8F5A';
        const shadow = d.on ? `0 0 3px ${color}` : 'none';
        html += `<div class="dot-row"><div class="dot" style="background:${color};box-shadow:${shadow}"></div>${d.label}</div>`;
      }
      this.statusGrid.innerHTML = html;
    }

    // Effective bore
    if (this.effBoreEl) {
      const ef = p.effectiveBore();
      this.effBoreEl.innerHTML = `<span class="info-label">Eff</span><span class="info-value" style="color:${ef < p.params.nd * .6 ? '#C44' : '#888'}">${ef.toFixed(3)}</span>`;
      if (p.nozzleWear > .001) {
        this.effBoreEl.innerHTML += `<span class="info-label" style="color:#D08020;margin-left:8px">Wear</span><span class="info-value" style="color:#D08020">+${p.nozzleWear.toFixed(4)}</span>`;
      }
    }

    // Filament / wear info
    if (this.filWearEl) {
      const fd = p.filamentDia;
      const fdColor = fd > p.params.fn + .02 ? '#C44' : fd < p.params.fn - .02 ? '#3878AA' : '#5A8F5A';
      this.filWearEl.innerHTML = `Fil <span style="color:${fdColor};font-weight:600">${fd.toFixed(3)}</span> · Wear <span style="color:${p.nozzleWear > .01 ? '#D08020' : '#5A8F5A'};font-weight:600">+${p.nozzleWear.toFixed(4)}</span>`;
    }

    // Pressure gauge
    this.updateGauge();

    // Charts
    this.updateCharts();
  }

  updateGauge() {
    const pr = this.physics.clog.pr;
    const pct = clamp(pr / 2, 0, 1);
    const col = pct > .7 ? '#D44' : pct > .4 ? '#E80' : '#5A8F5A';
    const angle = -135 + pct * 270;
    const r = 18;
    const nx = 28 + Math.cos(angle * Math.PI / 180) * r;
    const ny = 28 + Math.sin(angle * Math.PI / 180) * r;

    const arc = document.getElementById('gauge-arc');
    const needle = document.getElementById('gauge-needle');
    const text = document.getElementById('gauge-text');
    if (arc) {
      arc.setAttribute('stroke', col);
      arc.setAttribute('stroke-dasharray', `${pct * 170} 170`);
    }
    if (needle) {
      needle.setAttribute('x2', nx);
      needle.setAttribute('y2', ny);
      needle.setAttribute('stroke', col);
    }
    if (text) text.textContent = pr.toFixed(2) + ' bar';
  }

  updateCharts() {
    const cd = this.physics.chartData;
    for (const [key, { canvas, color }] of Object.entries(this.chartCanvases)) {
      const data = cd[key];
      if (!data || data.length < 2) continue;

      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const mx = Math.max(1, ...data);

      // Fill
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < data.length; i++) {
        ctx.lineTo((i / (data.length - 1)) * w, h - (data[i] / mx) * h * .85 - 1);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = color + '18';
      ctx.fill();

      // Line
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = h - (data[i] / mx) * h * .85 - 1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Update value label
      const valEl = document.getElementById('chart-val-' + key);
      if (valEl) valEl.textContent = data[data.length - 1];
    }
  }

  exportCSV() {
    const s = this.physics.stats;
    const rows = [
      ["metric", "value"], ["passed", s.p], ["clogged", s.c], ["bridged", s.b],
      ["jams", s.j], ["grinds", s.g],
      ["clog_pct", (s.p + s.c > 0 ? ((s.c / (s.p + s.c)) * 100).toFixed(2) : "0")],
      ["fouling", this.physics.fouling.toFixed(5)],
      ["nozzle_wear_mm", this.physics.nozzleWear.toFixed(4)],
      [], ["t", "passed", "clogged", "bridged", "jams", "fouling", "wear"],
      ...this.physics.csvData.map(r => [r.t, r.p, r.c, r.b, r.j, r.f.toFixed(5), r.w?.toFixed(5) || 0])
    ];
    const b = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = "clog_report.csv"; a.click();
    URL.revokeObjectURL(u);
  }
}
